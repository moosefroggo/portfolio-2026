import React, { useRef, useMemo, useState, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Text, useGLTF, Stats, Line, useTexture, useProgress, Html } from '@react-three/drei'
import { EffectComposer, Bloom, SelectiveBloom, ChromaticAberration, Vignette, Selection, Select } from '@react-three/postprocessing'
import * as THREE from 'three'

// 🟢 Global warp offset for velocity-driven chromatic aberration
export const warpOffset = new THREE.Vector2(0.002, 0.002)

// 🎡 Per-card drag rotation state (module-level, read in useFrame)
const dragRotState = {
    isDragging: false,
    lastX: 0, lastY: 0,
    cardIndex: -1,        // which card is being dragged (0-1)
    rotX: [0, 0],        // accumulated pitch per card
    rotY: [0, 0],        // accumulated yaw per card
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. CONFIGURATION & CAMERA PATH
// ═════════════════════════════════════════════════════════════════════════════

// Ethos position — a dark empty zone the camera pans toward
const ETHOS_POS = [70, 0, -15]

const CAMERA_PATH = [
    { t: 0.00, pos: [0, 1, 16], look: [0, 0, 0], fov: 70, roll: 0 },
    // ── Ethos: camera travels to X≈65, looks toward busts at X=70 ──
    { t: 0.08, pos: [40, 0.3, 14], look: ETHOS_POS, fov: 64, roll: 0 },
    { t: 0.24, pos: [65, 0, 12], look: ETHOS_POS, fov: 60, roll: 0 },
    // ── Transition to project rail (30-unit gap: ethos X=70 → cards X=100) ──
    { t: 0.30, pos: [80, 0.5, 12], look: [80, 0, 0], fov: 68, roll: 0 },
    // ── Card 1 — X=100 ──
    { t: 0.38, pos: [100, 0, 9], look: [100, 0, 0], fov: 62, roll: -1 },
    { t: 0.44, pos: [100, 0, 6], look: [100, 0, 0], fov: 52, roll: 0 },
    // ── Card 2 — X=120 ──
    { t: 0.52, pos: [110, 0.3, 10], look: [110, 0, 0], fov: 60, roll: 1 },
    { t: 0.58, pos: [120, 0, 9], look: [120, 0, 0], fov: 58, roll: -0.5 },
    { t: 0.62, pos: [120, 0, 6], look: [120, 0, 0], fov: 52, roll: 0 },
    // ── Card 3 — X=140 ──
    { t: 0.70, pos: [130, 0.3, 10], look: [130, 0, 0], fov: 60, roll: 0.5 },
    { t: 0.76, pos: [140, 0, 9], look: [140, 0, 0], fov: 58, roll: -0.5 },
    { t: 0.80, pos: [140, 0, 6], look: [140, 0, 0], fov: 52, roll: 0 },
    // ── Bio section ──
    { t: 0.86, pos: [140, 0, -2], look: [140, -3.2, -30], fov: 54, roll: 0 },
    { t: 0.93, pos: [140, 0, -12], look: [140, -3.2, -30], fov: 52, roll: 0 },
    { t: 1.00, pos: [140, 0, -20], look: [140, -3.2, -30], fov: 50, roll: 0 },
    // ── Dossier — shifted deep to Z=-100 to clear Bio debris ──
    { t: 1.10, pos: [140, -3.2, -100], look: [140, -3.2, -110], fov: 36, roll: 0 },
]

// Section snap stops — camera always rests at one of these t-values
const SECTION_STOPS = [
    0.00,   // hero
    0.16,   // ethos
    0.44,   // card 1 park
    0.62,   // card 2 park
    0.96,   // bio patch
    1.10,   // dossier (close-up camera on bust + resume panel)
]
const WHEEL_THRESHOLD = 60   // deltaY pixels to trigger a section advance
const SECTION_LABELS = ['HERO', 'ETHOS', 'NEXUS', 'Workflows', 'BIO', 'DOSSIER']
// Visual positions in the nav bar (independent of scroll stops)
const SECTION_BAR_POSITIONS = [0.00, 0.13, 0.30, 0.47, 0.67, 1.00]

// Shared flag: true when mouse is over an HTML UI element (not the canvas)
const uiHoveredRef = { current: false }

// ─── Font options for subtitle testing ────────────────────────────────────────
const SUBTITLE_FONT = '/fonts/Oxanium-VariableFont_wght.ttf'

const PROJECT_CARDS = [
    {
        pos: [100, 0, 0], rot: [0, -0.15, 0], color: '#00aaff', appear: 0.44,
        title: 'Engine Immobilizer', subtitle: '01 // Motive',
        desc: 'Allowing managers to remotely immobilize stolen vehicles',
        tech: ['Blender', 'Figma', 'Origami Studio'],
        stats: { role: 'Senior Product Designer', year: '2024', company: 'Motive' },
        objectType: 'truck_immobilizer',
    },
    {
        pos: [120, -0.5, 0], rot: [0, 0.2, 0], color: '#44ff88', appear: 0.62,
        title: 'Workflows', subtitle: '02 // Educative',
        desc: 'A central hub for project and documentation management helping fast moving teams optimize for outcomes',
        tech: ['Figma', 'Rive', 'JavaScript', 'Miro'],
        stats: { role: 'UX Design & Strategy', year: '2023', company: 'Educative' },
        objectType: 'workflows',
    },
]

// ═════════════════════════════════════════════════════════════════════════════
// 2. HERO CONFIGURATION — edit here to tune the hero section
// ═════════════════════════════════════════════════════════════════════════════

const HERO_CONFIG = {
    // Per-letter tweaks: yOffset and zOffset are in world units (pre-scale)
    letters: [
        { char: 'M', yOffset: 0, zOffset: 0 },
        { char: 'U', yOffset: 0, zOffset: 0 },
        { char: 'S', yOffset: 0, zOffset: 0 },
        { char: 'T', yOffset: 0, zOffset: 0 },
        { char: 'A', yOffset: 0, zOffset: 0 },
        { char: 'F', yOffset: 0, zOffset: 0 },
        { char: 'A', yOffset: 0, zOffset: 0 },
    ],
    spacing: 4.2,            // units between letter centers (pre-scale)
    groupY: 2.8,             // vertical offset of the whole hero group
    targetFraction: 0.72,    // fraction of viewport width that MUSTAFA fills

    subtitleText: 'An endlessly curios product designer currently building AI-based leak protection system at Dell, and developing a SaaS capstone application at School of Information.',
    subtitleYOffset: -5.8,   // Y below letter baseline (pre-scale)
    subtitleFontSize: 0.6,   // font size (pre-scale)
    subtitleLetterSpacing: 0.15,
    spineRotationSpeed: 0.3,     // radians/sec — spin of individual spine pieces around their tangent axis
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. UTILITIES
// ═════════════════════════════════════════════════════════════════════════════

const clamp = (val, min, max) => Math.max(min, Math.min(max, val))
const remap = (val, inMin, inMax, outMin, outMax) => outMin + ((clamp(val, inMin, inMax) - inMin) * (outMax - outMin)) / (inMax - inMin)
const smoothstep = (x) => x * x * (3 - 2 * x)
const dampValue = (current, target, smoothing, delta) => THREE.MathUtils.damp(current, target, smoothing, delta)

// ═════════════════════════════════════════════════════════════════════════════
// 3. CORE ENGINE
// ═════════════════════════════════════════════════════════════════════════════

const SCROLL_SMOOTHING = 3  // higher = snappier, lower = more damped

function ScrollSmoother({ currentSectionRef, scrollRef }) {
    useFrame((_, delta) => {
        const target = SECTION_STOPS[currentSectionRef.current]
        scrollRef.current = dampValue(scrollRef.current, target, SCROLL_SMOOTHING, delta)
    })
    return null
}

// Max camera strafe offset in world units — camera drifts toward mouse position
const PROJ_NUDGE_X = 1.6   // horizontal lean (world units)
const PROJ_NUDGE_Y = 0.9   // vertical lift (world units)

function CameraController({ scrollRef }) {
    const { camera } = useThree()
    const lookAtTarget = useMemo(() => new THREE.Vector3(), [])
    const prevScroll = useRef(0)
    const velocityRef = useRef(0)
    const nudgeXRef = useRef(0)
    const nudgeYRef = useRef(0)

    const _targetPos = useMemo(() => new THREE.Vector3(), [])
    const _targetLook = useMemo(() => new THREE.Vector3(), [])
    const _startPos = useMemo(() => new THREE.Vector3(), [])
    const _endPos = useMemo(() => new THREE.Vector3(), [])
    const _startLook = useMemo(() => new THREE.Vector3(), [])
    const _endLook = useMemo(() => new THREE.Vector3(), [])

    useFrame((state, delta) => {
        const t = scrollRef.current || 0

        const rawVelocity = Math.abs(t - prevScroll.current) / Math.max(delta, 0.001)
        prevScroll.current = t
        // Higher multiplier = spikes faster; higher damping factor = decays faster → sharper jerk
        velocityRef.current = dampValue(velocityRef.current, clamp(rawVelocity * 40, 0, 1), 14, delta)

        let startIndex = 0
        for (let i = 0; i < CAMERA_PATH.length - 1; i++) {
            if (t >= CAMERA_PATH[i].t && t <= CAMERA_PATH[i + 1].t) { startIndex = i; break }
        }
        if (t >= CAMERA_PATH[CAMERA_PATH.length - 1].t) startIndex = CAMERA_PATH.length - 2

        const start = CAMERA_PATH[startIndex]
        const end = CAMERA_PATH[startIndex + 1]
        const localT = end.t > start.t ? (t - start.t) / (end.t - start.t) : 1
        const easeT = smoothstep(clamp(localT, 0, 1))

        _startPos.set(...start.pos); _endPos.set(...end.pos)
        _startLook.set(...start.look); _endLook.set(...end.look)
        _targetPos.lerpVectors(_startPos, _endPos, easeT)
        _targetLook.lerpVectors(_startLook, _endLook, easeT)

        const baseFov = THREE.MathUtils.lerp(start.fov, end.fov, easeT)
        // Narrow-screen compensation — wider FOV + camera pulled back so cards don't clip sides
        // Threshold 1.6: starts compensation earlier (covers typical laptops/tablets)
        const narrowFactor = Math.max(0, 1.6 - camera.aspect)
        const aspectBoost = narrowFactor * 30   // more aggressive widening
        _targetPos.z += narrowFactor * 10        // significant depth pullback
        const targetFov = baseFov + velocityRef.current * 12 + aspectBoost
        // Exaggerate path roll during scroll for a thrown-through-space feel
        const pathRoll = THREE.MathUtils.lerp(start.roll, end.roll, easeT) * (Math.PI / 180)
        const targetRoll = pathRoll * (1 + velocityRef.current * 3.5)

        // ── Mouse parallax nudge: active only in project card section ────────
        // Blend weight — project cards AND bio/resume section
        // ramp in: 0.38-0.44, full: 0.44-0.70, ramp in again: 0.86-0.93, full: 0.93-1.10
        const projBlend = clamp(
            t < 0.38 ? 0 :
                t < 0.44 ? (t - 0.38) / 0.06 :
                    t <= 0.70 ? 1 - (Math.max(0, t - 0.62) / 0.08) :
                        t < 0.86 ? 0 :
                            t < 0.93 ? (t - 0.86) / 0.07 : 1,
            0, 1
        )
        const mx = uiHoveredRef.current ? 0 : clamp(state.pointer.x, -1, 1)
        const my = uiHoveredRef.current ? 0 : clamp(state.pointer.y, -1, 1)

        // Damp toward the nudge target, then bake it into the PATH target
        // before the lerp — this way the lerp smooths toward the nudged
        // destination instead of the nudge accumulating post-lerp each frame.
        nudgeXRef.current = dampValue(nudgeXRef.current, mx * PROJ_NUDGE_X * projBlend, 2.5, delta)
        nudgeYRef.current = dampValue(nudgeYRef.current, my * PROJ_NUDGE_Y * projBlend, 2.5, delta)
        _targetPos.x += nudgeXRef.current
        _targetPos.y += nudgeYRef.current

        const lerpFactor = 1 - Math.exp(-6 * delta)
        camera.position.lerp(_targetPos, lerpFactor)
        lookAtTarget.lerp(_targetLook, lerpFactor)

        camera.lookAt(lookAtTarget)
        camera.fov = dampValue(camera.fov, targetFov, 6, delta)
        camera.rotation.z = dampValue(camera.rotation.z, targetRoll, 6, delta)
        camera.updateProjectionMatrix()

        const chromaticStr = 0.001 + velocityRef.current * 0.045
        warpOffset.set(chromaticStr, chromaticStr)
    })
    return null
}

function CursorFX() {
    const orbRef = useRef()
    const illumRef = useRef()
    const rimRef = useRef()

    const _dir = useMemo(() => new THREE.Vector3(), [])
    const _orbPos = useMemo(() => new THREE.Vector3(), [])
    const _illumPos = useMemo(() => new THREE.Vector3(), [])

    useFrame((state, delta) => {
        _dir.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera)
        _dir.sub(state.camera.position).normalize()

        _orbPos.copy(state.camera.position).addScaledVector(_dir, 5)
        if (orbRef.current) orbRef.current.position.lerp(_orbPos, 0.12)

        if (rimRef.current) {
            rimRef.current.position.lerp(_orbPos, 0.08)
            rimRef.current.rotation.z += delta * 0.9
            rimRef.current.rotation.x += delta * 0.4
        }

        _illumPos.copy(state.camera.position).addScaledVector(_dir, 14)
        if (illumRef.current) illumRef.current.position.lerp(_illumPos, 0.10)

        const overUI = uiHoveredRef.current
        if (orbRef.current) orbRef.current.visible = !overUI
        if (rimRef.current) rimRef.current.visible = !overUI
        if (illumRef.current) illumRef.current.visible = !overUI

        const breathe = 1 + Math.sin(state.clock.elapsedTime * 2.2) * 0.04
        if (orbRef.current) orbRef.current.scale.setScalar(breathe * 0.65)
    })

    return (
        <>
            <group ref={orbRef}>
                {/* BackSide pass — darkened inner shell gives depth/curvature illusion */}
                <mesh renderOrder={98}>
                    <sphereGeometry args={[0.22, 32, 32]} />
                    <meshStandardMaterial
                        color="#0a1a44"
                        emissive="#112266"
                        emissiveIntensity={0.6}
                        roughness={0.0}
                        metalness={0.95}
                        transparent
                        opacity={0.55}
                        toneMapped={false}
                        side={THREE.BackSide}
                        depthTest={false}
                    />
                </mesh>
                {/* FrontSide glass shell — high metalness for specular highlight */}
                <mesh renderOrder={100}>
                    <sphereGeometry args={[0.22, 32, 32]} />
                    <meshStandardMaterial
                        color="#ddeeff"
                        emissive="#3355cc"
                        emissiveIntensity={0.55}
                        roughness={0.0}
                        metalness={0.85}
                        envMapIntensity={4.0}
                        transparent
                        opacity={0.45}
                        toneMapped={false}
                        side={THREE.FrontSide}
                        depthTest={false}
                    />
                </mesh>
                {/* Inner glow core */}
                <mesh scale={0.52} renderOrder={101}>
                    <sphereGeometry args={[0.22, 16, 16]} />
                    <meshBasicMaterial color="#88bbff" transparent opacity={0.7} toneMapped={false} depthTest={false} />
                </mesh>
                {/* Hot nucleus for bloom */}
                <mesh scale={0.20} renderOrder={102}>
                    <sphereGeometry args={[0.22, 16, 16]} />
                    <meshBasicMaterial color="#ffffff" transparent opacity={1.0} toneMapped={false} depthTest={false} />
                </mesh>
                {/* Inner light — illuminates the glass shell from inside */}
                <pointLight intensity={32} color="#aaccff" distance={2.5} decay={2} />
            </group>

            <group ref={rimRef}>
                {/* Spike left — tip points away from centre */}
                <mesh position={[-0.36, 0, 0]} rotation={[0, 0, Math.PI / 2]} renderOrder={100}>
                    <coneGeometry args={[0.026, 0.18, 6]} />
                    <meshStandardMaterial
                        color="#aaccff" emissive="#6688cc" emissiveIntensity={1.2}
                        roughness={0} metalness={0.2}
                        transparent opacity={0.85} toneMapped={false} depthTest={false}
                    />
                </mesh>
                {/* Spike right */}
                <mesh position={[0.36, 0, 0]} rotation={[0, 0, -Math.PI / 2]} renderOrder={100}>
                    <coneGeometry args={[0.026, 0.18, 6]} />
                    <meshStandardMaterial
                        color="#aaccff" emissive="#6688cc" emissiveIntensity={1.2}
                        roughness={0} metalness={0.2}
                        transparent opacity={0.85} toneMapped={false} depthTest={false}
                    />
                </mesh>
            </group>

            <group ref={illumRef}>
                <pointLight intensity={24} color="#99bbff" distance={30} decay={1.5} />
            </group>
        </>
    )
}

function InteractiveParticleField({ count = 300 }) {
    const ref = useRef()
    const [basePositions, currentPositions, velocities] = useMemo(() => {
        const base = new Float32Array(count * 3)
        const current = new Float32Array(count * 3)
        const vel = new Float32Array(count * 3)
        for (let i = 0; i < count; i++) {
            base[i * 3] = current[i * 3] = Math.random() * 220 - 10
            base[i * 3 + 1] = current[i * 3 + 1] = (Math.random() - 0.5) * 30
            base[i * 3 + 2] = current[i * 3 + 2] = (Math.random() - 0.5) * 40
        }
        return [base, current, vel]
    }, [count])

    const mouse3D = useMemo(() => new THREE.Vector3(), [])

    useFrame((state, delta) => {
        if (!ref.current) return
        mouse3D.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera)
        mouse3D.sub(state.camera.position).normalize().multiplyScalar(5).add(state.camera.position)

        const positions = ref.current.geometry.attributes.position.array
        for (let i = 0; i < count; i++) {
            const ix = i * 3, iy = i * 3 + 1, iz = i * 3 + 2
            basePositions[iy] -= delta * 0.3
            if (basePositions[iy] < -15) basePositions[iy] = 15

            const dx = positions[ix] - mouse3D.x, dy = positions[iy] - mouse3D.y, dz = positions[iz] - mouse3D.z
            const dist2 = dx * dx + dy * dy + dz * dz

            if (dist2 < 16) {
                const dist = Math.sqrt(dist2)
                const force = (4 - dist) / 4
                velocities[ix] += (dx / dist) * force * 0.15
                velocities[iy] += (dy / dist) * force * 0.15
                velocities[iz] += (dz / dist) * force * 0.15
            }

            velocities[ix] += (basePositions[ix] - positions[ix]) * 0.03
            velocities[iy] += (basePositions[iy] - positions[iy]) * 0.03
            velocities[iz] += (basePositions[iz] - positions[iz]) * 0.03
            velocities[ix] *= 0.92; velocities[iy] *= 0.92; velocities[iz] *= 0.92

            positions[ix] += velocities[ix]; positions[iy] += velocities[iy]; positions[iz] += velocities[iz]
        }
        ref.current.geometry.attributes.position.needsUpdate = true
    })

    return (
        <points ref={ref}>
            <bufferGeometry>
                <bufferAttribute attach="attributes-position" count={count} array={currentPositions} itemSize={3} />
            </bufferGeometry>
            <pointsMaterial size={0.04} color="#8899cc" transparent opacity={0.4} depthWrite={false} />
        </points>
    )
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. SIGIL CORRIDOR
// ═════════════════════════════════════════════════════════════════════════════

function makePoly(sides, r) {
    const v = []
    for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * Math.PI * 2 - Math.PI / 2
        v.push(Math.cos(a) * r, Math.sin(a) * r, 0)
    }
    return new Float32Array(v)
}

function makeStar(n, outer, inner) {
    const v = []
    for (let i = 0; i <= n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2
        const r = i % 2 === 0 ? outer : inner
        v.push(Math.cos(a) * r, Math.sin(a) * r, 0)
    }
    return new Float32Array(v)
}

function makeTri(r, flip = false) {
    const v = []
    for (let i = 0; i <= 3; i++) {
        const a = (i / 3) * Math.PI * 2 + (flip ? 0 : Math.PI)
        v.push(Math.cos(a) * r, Math.sin(a) * r, 0)
    }
    return new Float32Array(v)
}

const SIGIL_VARIANTS = [
    () => [makePoly(64, 1.3), makeTri(1.0), makeTri(1.0, true)],                          // hexagram + ring
    () => [makePoly(64, 1.3), makeStar(5, 1.0, 0.38)],                                    // pentagram + ring
    () => [makePoly(64, 1.3), makeStar(4, 0.95, 0.38), makePoly(4, 0.5)],                 // octagram + square + ring
    () => [makePoly(64, 1.3), makePoly(6, 0.85), new Float32Array([-1.1, 0, 0, 1.1, 0, 0]), new Float32Array([0, -1.1, 0, 0, 1.1, 0])], // hexagon + cross + ring
    () => [makePoly(64, 1.3), makeTri(0.9), makeTri(0.9, true), makePoly(4, 0.45)],       // hexagram + inner square + ring
]

function Sigil({ variant = 0, position, scale = 1, rotSpeeds = [0.1, 0.15, 0.08], color = '#3366ff' }) {
    const groupRef = useRef()
    const strokes = useMemo(() => SIGIL_VARIANTS[variant % SIGIL_VARIANTS.length](), [variant])

    useFrame((_, delta) => {
        if (!groupRef.current) return
        groupRef.current.rotation.x += rotSpeeds[0] * delta
        groupRef.current.rotation.y += rotSpeeds[1] * delta
        groupRef.current.rotation.z += rotSpeeds[2] * delta
    })

    return (
        <group ref={groupRef} position={position} scale={scale}>
            {strokes.map((pts, i) => (
                <line key={i}>
                    <bufferGeometry>
                        <bufferAttribute attach="attributes-position" args={[pts, 3]} />
                    </bufferGeometry>
                    <lineBasicMaterial color={color} transparent opacity={0.75} toneMapped={false} />
                </line>
            ))}
        </group>
    )
}

// 8 sigils, equal spacing, starting just behind the hero text, receding into fog
const CORRIDOR_COUNT = 8
const CORRIDOR_ZSTART = -8
const CORRIDOR_ZSTEP = 16
// Staggered X/Y for depth impact — equal spacing on Z is the constant
const CORRIDOR_X = [0, -4, 4, -2, 2, -4, 4, 0]
const CORRIDOR_Y = [0, 1, -1, 1.5, -0.5, 0.5, -1.2, 0]
const CORRIDOR_COLORS = ['#4477ff', '#5544ff', '#3366ee', '#6644ff', '#2255dd', '#5566ff', '#4433ee', '#3355ff']

function SigilCorridor() {
    return (
        <group>
            {Array.from({ length: CORRIDOR_COUNT }, (_, i) => (
                <Sigil
                    key={i}
                    variant={i % SIGIL_VARIANTS.length}
                    position={[CORRIDOR_X[i], CORRIDOR_Y[i], CORRIDOR_ZSTART - i * CORRIDOR_ZSTEP]}
                    scale={1.3 - i * 0.04}
                    rotSpeeds={[
                        (0.08 + i * 0.01) * (i % 2 === 0 ? 1 : -1),
                        0.12 + i * 0.01,
                        (0.06 + i * 0.01) * (i % 3 === 0 ? 1 : -1),
                    ]}
                    color={CORRIDOR_COLORS[i]}
                />
            ))}
        </group>
    )
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. COMPONENTS & SECTIONS
// ═════════════════════════════════════════════════════════════════════════════

// ─── Case Study Object — wireframe that solidifies on hover ──────────────────
// ─── Holographic GLB helpers ──────────────────────────────────────────────────

// Recursively mirrors the scene hierarchy but replaces every Mesh with
// LineSegments built from EdgesGeometry — only feature edges, no triangle noise.
function buildEdgesGroup(node, color, mats) {
    const g = new THREE.Group()
    g.matrix.copy(node.matrix)
    g.matrixAutoUpdate = false
    if (node.isMesh) {
        const edges = new THREE.EdgesGeometry(node.geometry, 20)
        const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, toneMapped: false, depthWrite: false })
        g.add(new THREE.LineSegments(edges, mat))
        mats.push(mat)
    }
    for (const child of node.children) g.add(buildEdgesGroup(child, color, mats))
    return g
}

function makeHologramClones(scene, color, targetSize) {
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const s = targetSize / Math.max(size.x, size.y, size.z, 0.001)

    // Clean edge lines — no triangle mesh noise
    const wireMats = []
    const wire = buildEdgesGroup(scene, color, wireMats)
    wire.scale.setScalar(s)
    wire.position.set(-center.x * s, -center.y * s, -center.z * s)

    // Translucent solid fill shown on hover
    const solid = scene.clone(true)
    solid.scale.setScalar(s)
    solid.position.set(-center.x * s, -center.y * s, -center.z * s)
    const solidMats = []
    solid.traverse(c => {
        if (!c.isMesh) return
        const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, transparent: true, opacity: 0, roughness: 0.05, metalness: 0.8, side: THREE.DoubleSide, toneMapped: false, depthWrite: false })
        c.material = m; solidMats.push(m)
    })
    return { wire, solid, wireMats, solidMats }
}

// Preserves original GLB textures, adds holographic emissive tint + transparency.
function makeTexturedHologramClone(scene, accentColor, targetSize) {
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const s = targetSize / Math.max(size.x, size.y, size.z, 0.001)

    const clone = scene.clone(true)
    clone.scale.setScalar(s)
    clone.position.set(-center.x * s, -center.y * s, -center.z * s)

    const mats = []
    clone.traverse(c => {
        if (!c.isMesh || !c.material) return
        const orig = Array.isArray(c.material) ? c.material[0] : c.material
        const m = new THREE.MeshStandardMaterial({
            map: orig.map ?? null,
            normalMap: orig.normalMap ?? null,
            roughnessMap: orig.roughnessMap ?? null,
            metalnessMap: orig.metalnessMap ?? null,
            emissiveMap: orig.map ?? null,
            roughness: orig.roughness ?? 0.6,
            metalness: orig.metalness ?? 0.4,
            emissive: new THREE.Color(accentColor),
            emissiveIntensity: 0.3,
            transparent: true,
            opacity: 0,
            toneMapped: false,
        })
        c.material = m
        mats.push(m)
    })
    return { clone, mats }
}

function TruckImmobilizerScene({ hovered, appeared, cardIndex }) {
    const { scene: truckScene } = useGLTF('/Truck.glb')
    const { scene: immScene } = useGLTF('/Engine Immobilizer.glb')

    const truckGroupRef = useRef()
    const immGroupRef = useRef()
    const truckOpRef = useRef(0)
    const immOpRef = useRef(0)
    const autoRotY = useRef(0)

    const { clone: truckClone, mats: truckMats } =
        useMemo(() => makeTexturedHologramClone(truckScene, '#00aaff', 2.2), [truckScene])

    const { clone: immClone, mats: immMats } =
        useMemo(() => makeTexturedHologramClone(immScene, '#ffaa22', 1.0), [immScene])

    useFrame((state, delta) => {
        truckOpRef.current = dampValue(truckOpRef.current, appeared ? 0.5 : 0, 5, delta)
        truckMats.forEach(m => { m.opacity = truckOpRef.current })

        immOpRef.current = dampValue(immOpRef.current, appeared ? 0.9 : 0, 5, delta)
        immMats.forEach(m => { m.opacity = immOpRef.current })

        if (truckGroupRef.current) {
            if (!dragRotState.isDragging || dragRotState.cardIndex !== cardIndex)
                autoRotY.current += delta * 0.22
            truckGroupRef.current.rotation.y = autoRotY.current + dragRotState.rotY[cardIndex]
            truckGroupRef.current.rotation.x = dragRotState.rotX[cardIndex]
        }
        if (immGroupRef.current) immGroupRef.current.lookAt(state.camera.position)
    })

    return (
        <group>
            {/* Truck — textured hologram, center-left */}
            <group ref={truckGroupRef} position={[-0.4, -0.3, 0]}>
                <primitive object={truckClone} />
            </group>

            {/* Engine Immobilizer — textured hologram, upper-right */}
            <group ref={immGroupRef} position={[1.6, 0.9, 0.3]}>
                <primitive object={immClone} />
                <pointLight color="#ffaa22" intensity={appeared ? 2.5 : 0} distance={4} decay={2} />
            </group>

            {/* Signal spine link immobilizer → truck */}
            {appeared && (
                <SpineChain
                    start={[1.6, 0.9, 0.3]}
                    end={[-0.4, -0.3, 0]}
                    mid={[0.6, -0.2, 0.15]}
                    color="#ffaa22"
                    active={hovered}
                    interactive={false}
                    segments={12}
                    cogScale={0.15}
                />
            )}
        </group>
    )
}

useGLTF.preload('/Truck.glb')
useGLTF.preload('/Engine Immobilizer.glb')

// Module-level ref so VideoScreen can be lifted outside <Select enabled>
// and WorkflowsScene can still drive its opacity.
const wfVideoOpRef = { current: 0 }

const CORNER_STYLES = [
    { top: 6, left: 6, borderTop: '2px solid #44ff88', borderLeft: '2px solid #44ff88' },
    { top: 6, right: 6, borderTop: '2px solid #44ff88', borderRight: '2px solid #44ff88' },
    { bottom: 6, left: 6, borderBottom: '2px solid #44ff88', borderLeft: '2px solid #44ff88' },
    { bottom: 6, right: 6, borderBottom: '2px solid #44ff88', borderRight: '2px solid #44ff88' },
]

function VideoScreen() {
    const containerRef = useRef()

    useFrame(() => {
        if (containerRef.current) containerRef.current.style.opacity = wfVideoOpRef.current
    })

    return (
        <group position={[3.4, 0.15, 0.9]} rotation={[0, -0.42, 0]}>
            <Html transform occlude={false} style={{ pointerEvents: 'none' }} distanceFactor={3.5}>
                <div ref={containerRef} style={{ opacity: 0, fontFamily: "'Courier New', monospace", userSelect: 'none', width: '262px' }}>
                    <style>{`
                        @keyframes hud-blink { 0%,100%{opacity:1} 50%{opacity:0} }
                        @keyframes hud-scan  { 0%{top:-15%} 100%{top:115%} }
                        .hud-dot  { animation: hud-blink 1.1s step-end infinite }
                        .hud-scan { position:absolute;left:0;right:0;height:20%;
                                    background:linear-gradient(to bottom,transparent,rgba(68,255,136,0.05),transparent);
                                    animation:hud-scan 2.8s linear infinite;pointer-events:none }
                    `}</style>

                    {/* ── Header ── */}
                    <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '5px 9px',
                        background: 'rgba(68,255,136,0.07)',
                        border: '1px solid rgba(68,255,136,0.35)',
                        borderBottom: 'none',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 8, letterSpacing: '0.15em', color: '#44ff88' }}>
                            <span className="hud-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: '#44ff88', display: 'inline-block' }} />
                            MISSION BRIEFING
                        </div>
                        <span style={{ fontSize: 8, color: 'rgba(68,255,136,0.55)', letterSpacing: '0.1em' }}>WF-2023</span>
                    </div>

                    {/* ── Video feed ── */}
                    <div style={{
                        position: 'relative', lineHeight: 0, overflow: 'hidden',
                        border: '1px solid rgba(68,255,136,0.35)', borderTop: 'none', borderBottom: 'none'
                    }}>
                        <video src="/workflows-video.mp4" autoPlay loop muted playsInline
                            style={{
                                width: '262px', height: '148px', objectFit: 'cover', display: 'block',
                                filter: 'contrast(1.05) brightness(0.88)'
                            }} />

                        {/* Scanlines */}
                        <div style={{
                            position: 'absolute', inset: 0, pointerEvents: 'none',
                            background: 'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.13) 2px,rgba(0,0,0,0.13) 3px)'
                        }} />
                        {/* Moving sweep */}
                        <div className="hud-scan" />

                        {/* Corner brackets */}
                        {CORNER_STYLES.map((s, i) => (
                            <div key={i} style={{ position: 'absolute', width: 12, height: 12, pointerEvents: 'none', ...s }} />
                        ))}

                        {/* Top-right label */}
                        <div style={{
                            position: 'absolute', top: 9, right: 22, fontSize: 7,
                            color: 'rgba(68,255,136,0.65)', letterSpacing: '0.12em'
                        }}>SIG 4/5</div>
                    </div>

                    {/* ── Footer ── */}
                    <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '4px 9px',
                        background: 'rgba(68,255,136,0.04)',
                        border: '1px solid rgba(68,255,136,0.35)',
                        borderTop: 'none',
                    }}>
                        <span style={{ fontSize: 7, color: 'rgba(68,255,136,0.5)', letterSpacing: '0.1em' }}>$1M Customer Acquired</span>
                        <span className="hud-dot" style={{ fontSize: 7, color: 'rgba(68,255,136,0.65)', letterSpacing: '0.1em' }}>● REC</span>
                    </div>
                </div>
            </Html>
        </group>
    )
}

function WorkflowsScene({ hovered, appeared, cardIndex }) {
    const { scene: wfScene } = useGLTF('/workflows.glb')

    const groupRef = useRef()
    const opRef = useRef(0)
    const autoRotY = useRef(0)

    const { clone: wfClone, mats: wfMats } =
        useMemo(() => makeTexturedHologramClone(wfScene, '#44ff88', 2.8), [wfScene])

    useFrame((_, delta) => {
        opRef.current = dampValue(opRef.current, appeared ? 0.9 : 0, 5, delta)
        wfVideoOpRef.current = opRef.current
        wfMats.forEach(m => { m.opacity = opRef.current })
        if (groupRef.current) {
            if (!dragRotState.isDragging || dragRotState.cardIndex !== cardIndex)
                autoRotY.current += delta * 0.18
            groupRef.current.rotation.y = autoRotY.current + dragRotState.rotY[cardIndex]
            groupRef.current.rotation.x = dragRotState.rotX[cardIndex]
        }
    })

    return (
        <group>
            <group ref={groupRef}>
                <primitive object={wfClone} />
                <pointLight color="#44ff88" intensity={appeared ? 1.2 : 0} distance={8} decay={2} />
            </group>
        </group>
    )
}

useGLTF.preload('/workflows.glb')

function CaseStudyObject({ objectType, color, hovered, appeared, cardIndex }) {
    const meshRef = useRef()
    const wireRef = useRef()
    const pulseRef = useRef()
    const solidOpacityRef = useRef(0)
    const wireOpacityRef = useRef(0)
    const autoRotX = useRef(0)
    const autoRotY = useRef(0)

    const geometry = useMemo(() => {
        switch (objectType) {
            case 'octahedron': return new THREE.OctahedronGeometry(1.4, 0)
            case 'torus': return new THREE.TorusGeometry(1.1, 0.38, 16, 48)
            case 'icosahedron': return new THREE.IcosahedronGeometry(1.3, 1)
            default: return new THREE.OctahedronGeometry(1.4, 0)
        }
    }, [objectType])

    useFrame((_, delta) => {
        if (!meshRef.current || !wireRef.current) return
        const speed = hovered ? 2.2 : 1.0
        if (!dragRotState.isDragging || dragRotState.cardIndex !== cardIndex) {
            autoRotX.current += delta * 0.003 * speed
            autoRotY.current += delta * 0.007 * speed
        }
        const finalX = autoRotX.current + dragRotState.rotX[cardIndex]
        const finalY = autoRotY.current + dragRotState.rotY[cardIndex]
        meshRef.current.rotation.x = finalX
        meshRef.current.rotation.y = finalY
        wireRef.current.rotation.x = finalX
        wireRef.current.rotation.y = finalY

        solidOpacityRef.current = dampValue(solidOpacityRef.current, hovered ? 0.72 : 0.0, 5, delta)
        wireOpacityRef.current = dampValue(wireOpacityRef.current, hovered ? 0.25 : (appeared ? 0.85 : 0.0), 5, delta)

        meshRef.current.material.opacity = solidOpacityRef.current
        meshRef.current.visible = solidOpacityRef.current > 0.01
        wireRef.current.material.opacity = wireOpacityRef.current

        if (pulseRef.current) {
            pulseRef.current.rotation.x += delta * 1.1
            pulseRef.current.rotation.z += delta * 0.7
            pulseRef.current.material.opacity = dampValue(pulseRef.current.material.opacity, hovered ? 0.6 : 0.0, 6, delta)
        }
    })

    if (objectType === 'truck_immobilizer') {
        return <TruckImmobilizerScene hovered={hovered} appeared={appeared} cardIndex={cardIndex} />
    }
    if (objectType === 'workflows') {
        return <WorkflowsScene hovered={hovered} appeared={appeared} cardIndex={cardIndex} />
    }

    return (
        <group>
            <mesh ref={wireRef} geometry={geometry}>
                <meshBasicMaterial color={color} wireframe transparent opacity={0} toneMapped={false} />
            </mesh>
            <mesh ref={meshRef} geometry={geometry} visible={false}>
                <meshStandardMaterial color={color} transparent opacity={0} roughness={0.1} metalness={0.9} emissive={color} emissiveIntensity={0.3} toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh ref={pulseRef}>
                <torusGeometry args={[1.9, 0.015, 8, 64]} />
                <meshBasicMaterial color={color} transparent opacity={0} toneMapped={false} />
            </mesh>
            <pointLight color={color} intensity={appeared ? 3 : 0} distance={8} decay={2} />
        </group>
    )
}

// ─── HUD data panel — diegetic readout floating in 3D ────────────────────────
function HudLine({ x1, y1, z1, x2, y2, z2, color, opacity = 1 }) {
    return (
        <Line points={[[x1, y1, z1], [x2, y2, z2]]} color={color} lineWidth={0.8} transparent opacity={opacity} toneMapped={false} />
    )
}

function HudPanel({ stats, tech, color, appeared, side = 'left' }) {
    const groupRef = useRef()
    const opacityRef = useRef(0)
    const matsRef = useRef([])
    const [blink, setBlink] = useState(true)
    useEffect(() => {
        const id = setInterval(() => setBlink(b => !b), 530)
        return () => clearInterval(id)
    }, [])

    useFrame((_, delta) => {
        if (!groupRef.current) return
        if (matsRef.current.length === 0)
            groupRef.current.traverse(child => { if (child.material) matsRef.current.push(child.material) })
        opacityRef.current = dampValue(opacityRef.current, appeared ? 1 : 0, 4, delta)
        const op = opacityRef.current
        matsRef.current.forEach(m => { m.opacity = op })
    })

    const xPos = (side === 'left' ? -1 : 1) * 4
    const anchor = side === 'left' ? 'left' : 'right'

    return (
        <group ref={groupRef} position={[xPos, 0, 0.1]}>
            <Text position={[0, 0.65, 0]} font="/fonts/Rocket%20Command/rocketcommandexpand.ttf" fontSize={0.09} color="#4466aa" anchorX={anchor} letterSpacing={0.12} material-toneMapped={false} material-transparent={true} material-opacity={0}>ROLE ──────────────────</Text>
            <Text position={[0, 0.48, 0]} font="/fonts/Rocket%20Command/rocketcommandexpand.ttf" fontSize={0.14} color={color} anchorX={anchor} letterSpacing={0.08} material-toneMapped={false} material-transparent={true} material-opacity={0}>{stats.role}</Text>
            <Text position={[0, 0.18, 0]} font="/fonts/Rocket%20Command/rocketcommandexpand.ttf" fontSize={0.09} color="#4466aa" anchorX={anchor} letterSpacing={0.12} material-toneMapped={false} material-transparent={true} material-opacity={0}>YEAR ──────────────────</Text>
            <Text position={[0, 0.02, 0]} font="/fonts/Rocket%20Command/rocketcommandexpand.ttf" fontSize={0.14} color={color} anchorX={anchor} letterSpacing={0.08} material-toneMapped={false} material-transparent={true} material-opacity={0}>{stats.year}</Text>
            <Text position={[0, -0.28, 0]} font="/fonts/Rocket%20Command/rocketcommandexpand.ttf" fontSize={0.09} color="#4466aa" anchorX={anchor} letterSpacing={0.12} material-toneMapped={false} material-transparent={true} material-opacity={0}>Company ─────────────────</Text>
            <Text position={[0, -0.44, 0]} font="/fonts/Rocket%20Command/rocketcommandexpand.ttf" fontSize={0.14} color={color} anchorX={anchor} letterSpacing={0.08} material-toneMapped={false} material-transparent={true} material-opacity={0}>{stats.company}</Text>
            <Text position={[0, -0.74, 0]} font="/fonts/Rocket%20Command/rocketcommandexpand.ttf" fontSize={0.085} color="#334466" anchorX={anchor} letterSpacing={0.1} material-toneMapped={false} material-transparent={true} material-opacity={0}>{tech.join('  ·  ')} {blink ? '|' : ' '}</Text>
        </group>
    )
}

// ─── Targeting reticle — L-brackets that lock in on hover ────────────────────
function LBracket({ position, flipX, flipY, color }) {
    const sx = flipX ? -1 : 1
    const sy = flipY ? -1 : 1
    return (
        <group position={position}>
            <HudLine x1={0} y1={0} z1={0} x2={sx * 0.35} y2={0} z2={0} color={color} />
            <HudLine x1={0} y1={0} z1={0} x2={0} y2={sy * 0.35} z2={0} color={color} />
        </group>
    )
}

function TargetingReticle({ hovered, appeared, color, radius = 2.0 }) {
    const groupRef = useRef()
    const scaleRef = useRef(1.6)
    const opacityRef = useRef(0)
    const matsRef = useRef([])

    useFrame((_, delta) => {
        if (!groupRef.current) return
        if (matsRef.current.length === 0)
            groupRef.current.traverse(child => { if (child.material) matsRef.current.push(child.material) })
        scaleRef.current = dampValue(scaleRef.current, hovered ? 1.0 : 1.6, 7, delta)
        opacityRef.current = dampValue(opacityRef.current, appeared ? (hovered ? 1.0 : 0.35) : 0.0, 5, delta)
        groupRef.current.scale.setScalar(scaleRef.current)
        const op = opacityRef.current
        matsRef.current.forEach(m => { m.opacity = op })
    })

    const r = radius
    return (
        <group ref={groupRef}>
            <LBracket position={[-r, r, 0.1]} flipX={false} flipY={false} color={color} />
            <LBracket position={[r, r, 0.1]} flipX={true} flipY={false} color={color} />
            <LBracket position={[-r, -r, 0.1]} flipX={false} flipY={true} color={color} />
            <LBracket position={[r, -r, 0.1]} flipX={true} flipY={true} color={color} />
            <HudLine x1={-0.08} y1={0} z1={0.1} x2={-0.02} y2={0} z2={0.1} color={color} />
            <HudLine x1={0.02} y1={0} z1={0.1} x2={0.08} y2={0} z2={0.1} color={color} />
            <HudLine x1={0} y1={-0.08} z1={0.1} x2={0} y2={-0.02} z2={0.1} color={color} />
            <HudLine x1={0} y1={0.02} z1={0.1} x2={0} y2={0.08} z2={0.1} color={color} />
        </group>
    )
}

// ─── Scan line reveal ─────────────────────────────────────────────────────────
function ScanReveal({ color, active, onComplete }) {
    const meshRef = useRef()
    const progressRef = useRef(-2.5)
    const doneRef = useRef(false)

    useFrame((_, delta) => {
        if (!meshRef.current || doneRef.current || !active) return
        progressRef.current += delta * 4.5
        meshRef.current.position.y = progressRef.current
        const opacity = progressRef.current > 2.2 ? Math.max(0, 1 - (progressRef.current - 2.2) * 6) : 1.0
        meshRef.current.material.opacity = opacity * 0.55
        if (progressRef.current > 2.8) {
            doneRef.current = true
            meshRef.current.visible = false
            onComplete?.()
        }
    })

    return (
        <mesh ref={meshRef} position={[0, -2.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[12, 0.04]} />
            <meshBasicMaterial color={color} transparent opacity={0} toneMapped={false} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
    )
}

// ─── Project zone grid — fills void behind cards ──────────────────────────────
function ProjectZoneGrid({ scrollRef }) {
    const groupRef = useRef()
    const opacityRef = useRef(0)
    const matsRef = useRef([]) // [{mat, dim}]

    const lines = useMemo(() => {
        const pts = []
        const xMin = 88, xMax = 155, zMin = -7, zMax = 7
        for (const y of [-3.5, 3.5]) {
            for (let z = zMin; z <= zMax; z += 4) pts.push({ p1: [xMin, y, z], p2: [xMax, y, z], dim: true })
            for (let x = xMin; x <= xMax; x += 8) pts.push({ p1: [x, y, zMin], p2: [x, y, zMax], dim: false })
        }
        for (const x of [100, 120, 140]) {
            for (const z of [zMin, zMax]) pts.push({ p1: [x, -3.5, z], p2: [x, 3.5, z], dim: false })
        }
        return pts
    }, [])

    useFrame((_, delta) => {
        if (!groupRef.current) return
        if (matsRef.current.length === 0)
            groupRef.current.traverse(child => { if (child.material) matsRef.current.push({ mat: child.material, dim: !!child.userData.dim }) })
        const t = scrollRef.current ?? 0
        opacityRef.current = dampValue(opacityRef.current, (t >= 0.35 && t <= 0.85) ? 1 : 0, 3, delta)
        const op = opacityRef.current
        matsRef.current.forEach(({ mat, dim }) => { mat.opacity = op * (dim ? 0.06 : 0.12) })
    })

    return (
        <group ref={groupRef}>
            {lines.map((l, i) => (
                <Line key={i} points={[l.p1, l.p2]} color="#2244aa" lineWidth={0.5} transparent opacity={0} toneMapped={false} userData={{ dim: l.dim }} />
            ))}
        </group>
    )
}

// ─── Project card — full assembly ─────────────────────────────────────────────
function ProjectCard({ config, scrollRef, cardIndex }) {
    const [hovered, setHovered] = useState(false)
    const [appeared, setAppeared] = useState(false)
    const [scanActive, setScanActive] = useState(false)
    const scanFiredRef = useRef(false)

    useFrame(() => {
        const t = scrollRef?.current ?? 0
        if (!scanFiredRef.current && t >= config.appear - 0.015) {
            scanFiredRef.current = true
            setScanActive(true)
        }
    })

    return (
        <group
            position={config.pos}
            rotation={config.rot}
            onPointerOver={e => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'crosshair' }}
            onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto' }}
            onClick={e => e.stopPropagation()}
        >
            <CaseStudyObject objectType={config.objectType} color={config.color} hovered={hovered} appeared={appeared} cardIndex={cardIndex} />
            <TargetingReticle hovered={hovered} appeared={appeared} color={config.color} radius={2.0} />
            <ScanReveal color={config.color} active={scanActive} onComplete={() => setAppeared(true)} />
            <HudPanel stats={config.stats} tech={config.tech} color={config.color} appeared={appeared} side="left" />

            <Text position={[0, 1.95, 0.1]} font="/fonts/Rocket%20Command/rocketcommandexpand.ttf" fontSize={0.45} anchorX="center" anchorY="middle" letterSpacing={0.05} color={config.color} material-toneMapped={false} material-transparent={true} material-opacity={appeared ? 1 : 0}>{config.title}</Text>
            <Text position={[0, 1.55, 0.1]} fontSize={0.1} color="#445577" anchorX="center" anchorY="middle" letterSpacing={0.15} material-toneMapped={false} material-transparent={true} material-opacity={appeared ? 1 : 0}>{config.subtitle}</Text>
            <Text position={[0, -1.55, 0.1]} font={SUBTITLE_FONT} fontSize={0.13} color="#667799" anchorX="center" anchorY="top" maxWidth={4.5} lineHeight={1.6} material-toneMapped={false} material-transparent={true} material-opacity={appeared ? 0.85 : 0}>{config.desc}</Text>

            {appeared && <HudLine x1={-2.2} y1={-2.55} z1={0} x2={2.2} y2={-2.55} z2={0} color={config.color} opacity={0.3} />}
        </group>
    )
}

function WritingSpineLetter({ points, sourceGeometry, material, position = [0, 0, 0], delay = 0, cogScale = 0.72 }) {
    const instancedRef = useRef()
    const offsetRef = useRef(0)
    const drawProgressRef = useRef(0)
    const dummyMatrix = useMemo(() => new THREE.Object3D(), [])
    const hovInstRef = useRef(-1)
    const spreadOffsetsRef = useRef([])
    const frameCountRef = useRef(0)
    const lastEnterFrameRef = useRef(-100)
    const CACHE_STEPS = 128

    const { count, posCache, tanCache } = useMemo(() => {
        if (!sourceGeometry) return { count: 0, posCache: [], tanCache: [] }
        const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5)

        sourceGeometry.computeBoundingBox()
        const size = new THREE.Vector3()
        sourceGeometry.boundingBox.getSize(size)
        const linkLength = Math.max(size.x, size.y, size.z)
        const c = Math.ceil(curve.getLength() / (linkLength + 0.05))

        const pc = [], tc = []
        for (let i = 0; i <= CACHE_STEPS; i++) {
            const t = i / CACHE_STEPS
            pc.push(curve.getPointAt(t))
            tc.push(curve.getTangentAt(t))
        }
        return { count: c, posCache: pc, tanCache: tc }
    }, [points, sourceGeometry])

    useFrame((state, delta) => {
        const instanced = instancedRef.current
        if (!instanced || count === 0) return

        // Clear hover if no instance reported pointer-over in the last 2 frames
        frameCountRef.current++
        if (frameCountRef.current - lastEnterFrameRef.current > 2) hovInstRef.current = -1

        if (state.clock.elapsedTime > delay) {
            drawProgressRef.current = dampValue(drawProgressRef.current, 1, 5, delta)
        }

        if (drawProgressRef.current > 0.99) {
            // Converge all instances of the same letter to offset 0 so they look identical at rest
            offsetRef.current = dampValue(offsetRef.current, 0, 8, delta)
        } else {
            // Speed decelerates naturally as drawing progresses
            const movementSpeed = 0.5 * Math.max(0, 1 - drawProgressRef.current)
            offsetRef.current = (offsetRef.current + delta * movementSpeed) % 1
        }

        const SPREAD_RADIUS = 8
        const SPREAD_STRENGTH = 0.85
        const hovIdx = hovInstRef.current

        const spacing = 1 / count
        for (let i = 0; i < count; i++) {
            const t = (i * spacing + offsetRef.current) % 1
            const raw = t * CACHE_STEPS
            const idx0 = Math.floor(raw)
            const frac = raw - idx0
            const p0 = posCache[idx0], p1 = posCache[Math.min(idx0 + 1, CACHE_STEPS)]
            const tan0 = tanCache[idx0], tan1 = tanCache[Math.min(idx0 + 1, CACHE_STEPS)]

            const px = p0.x + (p1.x - p0.x) * frac
            const py = p0.y + (p1.y - p0.y) * frac
            const pz = p0.z + (p1.z - p0.z) * frac
            const tx = tan0.x + (tan1.x - tan0.x) * frac
            const ty = tan0.y + (tan1.y - tan0.y) * frac
            const tz = tan0.z + (tan1.z - tan0.z) * frac

            // Soft-selection spread — same Blender proportional edit style
            if (!spreadOffsetsRef.current[i]) spreadOffsetsRef.current[i] = 0
            const dist = hovIdx >= 0 ? Math.abs(i - hovIdx) : SPREAD_RADIUS
            const falloff = dist < SPREAD_RADIUS ? Math.pow(1 - dist / SPREAD_RADIUS, 2) : 0
            spreadOffsetsRef.current[i] = dampValue(spreadOffsetsRef.current[i], SPREAD_STRENGTH * falloff, 10, delta)
            const spr = spreadOffsetsRef.current[i]

            dummyMatrix.position.set(px, py + spr, pz)
            dummyMatrix.lookAt(px + tx, py + spr + ty, pz + tz)

            dummyMatrix.rotateZ(t * Math.PI * 8 + state.clock.elapsedTime * HERO_CONFIG.spineRotationSpeed)

            if (t > drawProgressRef.current) {
                dummyMatrix.scale.set(0, 0, 0)
            } else {
                dummyMatrix.scale.set(cogScale, cogScale, cogScale)
            }

            dummyMatrix.updateMatrix()
            instanced.setMatrixAt(i, dummyMatrix.matrix)
        }
        instanced.instanceMatrix.needsUpdate = true
    })

    return (
        <group position={position}>
            <instancedMesh
                ref={instancedRef}
                args={[sourceGeometry, material, count]}
                onPointerOver={e => { hovInstRef.current = e.instanceId ?? -1; lastEnterFrameRef.current = frameCountRef.current }}
                onPointerMove={e => { hovInstRef.current = e.instanceId ?? -1; lastEnterFrameRef.current = frameCountRef.current }}
            />
        </group>
    )
}

// ─── Letter paths for MUSTAFA — extracted from ReliefSingleLineSVG-Regular ───
//  Coordinate space normalised to font cap height 675 → world height ±2.
//  A subtle z sine-wave is added so spines have depth as they flow along the glyph.
const v3 = (x, y, z = 0) => new THREE.Vector3(x, y, z)

// Helper: add z-depth wave along a point list so the spines twist in 3-D
function withZ(pts, amp = 0.35) {
    return pts.map((p, i) => new THREE.Vector3(p.x, p.y, Math.sin((i / Math.max(pts.length - 1, 1)) * Math.PI * 2) * amp))
}

const RAW_M = [v3(1.7244, -2), v3(1.7244, 2), v3(0, -1.8222), v3(-1.7244, 2), v3(-1.7244, -2)]
const RAW_U = [v3(-1.2978, 2.0296), v3(-1.2978, -0.5481), v3(-1.2044, -1.17), v3(-0.9415, -1.6252), v3(-0.5353, -1.9048), v3(0, -2), v3(0.5353, -1.9048), v3(0.9415, -1.6252), v3(1.2044, -1.17), v3(1.2978, -0.5481), v3(1.2978, 2.0296)]
const RAW_S = [v3(-1.1141, -1.3541), v3(-0.9448, -1.62), v3(-0.6933, -1.8237), v3(-0.3707, -1.9541), v3(0.0119, -2), v3(0.4862, -1.9232), v3(0.8422, -1.7148), v3(1.066, -1.4075), v3(1.1437, -1.0341), v3(0.8039, -0.3555), v3(0.0563, 0.0615), v3(-0.6913, 0.4684), v3(-1.0311, 1.117), v3(-0.9624, 1.4571), v3(-0.757, 1.7489), v3(-0.4161, 1.9529), v3(0.0593, 2.0296), v3(0.4052, 1.9896), v3(0.68, 1.8785), v3(0.8859, 1.7096), v3(1.0252, 1.4963)]
const RAW_T0 = [v3(0, -2), v3(0, 1.9704)]
const RAW_T1 = [v3(-1.75, 1.9704), v3(1.75, 1.9704)]
const RAW_A0 = [v3(-1.09, -0.7378), v3(1.09, -0.7378)]
const RAW_A1 = [v3(1.6, -2), v3(0.8, 0), v3(0, 2), v3(-0.8, 0), v3(-1.6, -2)]
const RAW_F0 = [v3(-0.8, -2), v3(-0.8, 2), v3(1.2, 2)]
const RAW_F1 = [v3(-0.8, 0.1), v3(1.1, 0.1)]

const LETTER_M = withZ(RAW_M, 0.30)
const LETTER_U = withZ(RAW_U, 0.28)
const LETTER_S = withZ(RAW_S, 0.22)
const LETTER_T_0 = withZ(RAW_T0, 0.35)
const LETTER_T_1 = withZ(RAW_T1, 0.20)
const LETTER_A_0 = withZ(RAW_A0, 0.18)
const LETTER_A_1 = withZ(RAW_A1, 0.30)
const LETTER_F_0 = withZ(RAW_F0, 0.30)
const LETTER_F_1 = withZ(RAW_F1, 0.18)

// Multi-stroke letters use an array of paths rendered as separate SpinePaths
const MUSTAFA_LETTERS = {
    M: [LETTER_M],
    U: [LETTER_U],
    S: [LETTER_S],
    T: [LETTER_T_0, LETTER_T_1],
    A: [LETTER_A_0, LETTER_A_1],
    F: [LETTER_F_0, LETTER_F_1],
}

// WritingSpineLetter already handles a single path — wrap it for multi-stroke support
function SpineLetter2({ char, sourceGeometry, material, position = [0, 0, 0], scale = 1, delay = 0, cogScale = 0.72 }) {
    const paths = MUSTAFA_LETTERS[char] || [LETTER_M]
    return (
        <group position={position} scale={scale}>
            {paths.map((pts, idx) => (
                <WritingSpineLetter
                    key={idx}
                    points={pts}
                    sourceGeometry={sourceGeometry}
                    material={material}
                    delay={delay + idx * 0.4}
                    cogScale={cogScale}
                />
            ))}
        </group>
    )
}

// ─── Star field — slowly emerges after hero loads ─────────────────────────────
const STAR_COUNT = 220
const STARS_PER_SEC = 30      // how many stars start fading in per second
const STAR_FADE = 0.5    // seconds each star takes to fully appear
const STAR_DELAY = 0    // seconds after mount before first star appears

function StarField() {
    const pointsRef = useRef()
    const groupRef = useRef()

    const { positions, targets, colors, delays } = useMemo(() => {
        const positions = new Float32Array(STAR_COUNT * 3)
        const targets = new Float32Array(STAR_COUNT * 3)
        const colors = new Float32Array(STAR_COUNT * 3) // starts black
        const delays = new Float32Array(STAR_COUNT)

        // Shuffle so stars don't appear in a predictable spatial order
        const order = Array.from({ length: STAR_COUNT }, (_, i) => i)
        for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]]
        }

        for (let i = 0; i < STAR_COUNT; i++) {
            const theta = Math.random() * Math.PI * 2
            const phi = Math.acos(2 * Math.random() - 1)
            const r = 20 + Math.random() * 35

            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
            positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.55
            positions[i * 3 + 2] = r * Math.cos(phi)

            const b = 0.55 + Math.random() * 0.45
            targets[i * 3] = b * (Math.random() > 0.6 ? 0.78 : 1.0)
            targets[i * 3 + 1] = b * 0.88
            targets[i * 3 + 2] = b

            delays[order[i]] = STAR_DELAY + i / STARS_PER_SEC
        }

        return { positions, targets, colors, delays }
    }, [])

    useFrame((state) => {
        if (!pointsRef.current) return
        // Keep stars centered on camera so they appear everywhere
        if (groupRef.current) groupRef.current.position.copy(state.camera.position)
        const t = state.clock.elapsedTime
        let dirty = false

        for (let i = 0; i < STAR_COUNT; i++) {
            const elapsed = t - delays[i]
            if (elapsed <= 0) continue
            const p = Math.min(elapsed / STAR_FADE, 1)
            const ci = i * 3
            const nr = targets[ci] * p
            const ng = targets[ci + 1] * p
            const nb = targets[ci + 2] * p
            if (Math.abs(colors[ci] - nr) > 0.002) {
                colors[ci] = nr
                colors[ci + 1] = ng
                colors[ci + 2] = nb
                dirty = true
            }
        }

        if (dirty) pointsRef.current.geometry.attributes.color.needsUpdate = true
    })

    return (
        <group ref={groupRef}>
            <points ref={pointsRef}>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" array={positions} count={STAR_COUNT} itemSize={3} />
                    <bufferAttribute attach="attributes-color" array={colors} count={STAR_COUNT} itemSize={3} />
                </bufferGeometry>
                <pointsMaterial vertexColors size={1.4} sizeAttenuation={false} toneMapped={false} />
            </points>
        </group>
    )
}

function HeroSection() {
    const { size } = useThree()
    const { scene: spineScene } = useGLTF('/spine.glb')

    const spineGeometry = useMemo(() => {
        let mesh = null
        spineScene.traverse(child => { if (child.isMesh && !mesh) mesh = child })
        return mesh?.geometry ?? null
    }, [spineScene])

    const material = useMemo(() => new THREE.MeshPhysicalMaterial({
        color: '#b8d6ff',
        metalness: 0.6,
        roughness: 0.02,
        clearcoat: 1.0,
        clearcoatRoughness: 0.0,
        emissive: '#0a1a33',
        emissiveIntensity: 0.4,
    }), [])

    // Responsive scale: fit MUSTAFA into targetFraction of the viewport width.
    // Camera starts at Z=16, FOV=70 — compute world-space width visible at Z=0.
    const { letterScale, actualSpacing } = useMemo(() => {
        const cfg = HERO_CONFIG
        const fovRad = (70 * Math.PI) / 180
        const visH = 2 * Math.tan(fovRad / 2) * 16          // ~22.4 world units tall
        const visW = visH * (size.width / size.height)       // depends on aspect ratio
        const totalSpan = (cfg.letters.length - 1) * cfg.spacing
        const scale = (visW * cfg.targetFraction) / totalSpan
        return { letterScale: scale, actualSpacing: cfg.spacing * scale }
    }, [size.width, size.height])

    if (!spineGeometry) return null

    const cfg = HERO_CONFIG
    const startX = -((cfg.letters.length - 1) / 2) * actualSpacing

    return (
        <group position={[0, cfg.groupY, 0]}>
            {cfg.letters.map((letterCfg, i) => (
                <SpineLetter2
                    key={i}
                    char={letterCfg.char}
                    sourceGeometry={spineGeometry}
                    material={material}
                    position={[
                        startX + i * actualSpacing,
                        letterCfg.yOffset * letterScale,
                        letterCfg.zOffset,
                    ]}
                    scale={letterScale}
                    delay={0.3 + i * 0.6}
                />
            ))}

            <Text position={[0, cfg.subtitleYOffset * letterScale, 0]} font={SUBTITLE_FONT} fontSize={cfg.subtitleFontSize * letterScale} anchorX="center" anchorY="middle" letterSpacing={0} color="#8899cc" material-toneMapped={false} maxWidth={(cfg.letters.length - 1) * actualSpacing} textAlign="center" lineHeight={1.5}>{cfg.subtitleText}</Text>
        </group>
    )
}

useGLTF.preload('/spine.glb')
useGLTF.preload('/me.glb')
useGLTF.preload('/also-me.glb')

// ═════════════════════════════════════════════════════════════════════════════
// ETHOS SECTION — Scroll-driven timeline + rotating busts
// ═════════════════════════════════════════════════════════════════════════════

const ETHOS_ENTER = 0.08   // scroll fraction: ethos begins
const ETHOS_EXIT = 0.24   // scroll fraction: ethos ends

const ETHOS_CHECKPOINTS = [
    {
        label: 'CRAFT',
        text: 'Build products that solve human problems, look delightful, are fun to use.',
    },
    {
        label: 'SYSTEMS',
        text: 'I break the product down to its individual cogs, then I rebuild and rearrange those cogs to solve problems.',
    },
    {
        label: 'VISION',
        text: 'Design is a neccessity and it is everywhere, I look at the tangible world around me for inspiration to build products for the future.',
    },
]

// ─── Single checkpoint row ────────────────────────────────────────────────────
function EthosCheckpoint({ checkpoint, active }) {
    return (
        <div className={`ethos-checkpoint ${active ? 'active' : ''}`}>
            <div className="ethos-bullet-wrap">
                <div className={`ethos-bullet ${active ? 'active' : ''}`}>
                    <div className="ethos-bullet-inner" />
                </div>
            </div>
            <div className="ethos-checkpoint-content">
                <div className={`ethos-label ${active ? 'active' : ''}`}>
                    {checkpoint.label.split('').map((char, i) => (
                        <span
                            key={i}
                            className="ethos-label-char"
                            style={{
                                animationDelay: active ? `${i * 0.04}s` : '0s',
                                opacity: active ? undefined : 0,
                            }}
                        >
                            {char}
                        </span>
                    ))}
                </div>
                <p className="ethos-text">{checkpoint.text}</p>
            </div>
        </div>
    )
}

// ─── Ethos Overlay (fixed HTML outside Canvas) ───────────────────────────────
// Bullet 1 fires on scroll entry. Bullets 2 & 3 auto-sequence via timers.
function EthosOverlay({ scrollRef }) {
    const wrapperRef = useRef()
    const lineRef = useRef()
    const [activeCount, setActiveCount] = useState(0)
    const activeRef = useRef(0)   // ref mirror so RAF sees latest value
    const timersRef = useRef([])
    const scheduledRef = useRef(false)

    useEffect(() => {
        let rafId

        const clearTimers = () => {
            timersRef.current.forEach(clearTimeout)
            timersRef.current = []
            scheduledRef.current = false
        }

        const bump = (n) => {
            activeRef.current = n
            setActiveCount(n)
            // Grow line to match active count
            if (lineRef.current)
                lineRef.current.style.height = `${(n / ETHOS_CHECKPOINTS.length) * 100}%`
        }

        const tick = () => {
            const t = scrollRef.current ?? 0

            // Fade panel in/out at section edges
            const fadeIn = Math.min(1, Math.max(0, (t - ETHOS_ENTER) / 0.025))
            const fadeOut = Math.min(1, Math.max(0, (ETHOS_EXIT - t) / 0.025))
            if (wrapperRef.current) wrapperRef.current.style.opacity = Math.min(fadeIn, fadeOut)

            const raw = (t - ETHOS_ENTER) / (ETHOS_EXIT - ETHOS_ENTER)
            const progress = Math.max(0, Math.min(1, raw))
            const inSection = progress >= 0.12

            if (!inSection) {
                // User scrolled away — reset for next visit
                if (activeRef.current > 0) {
                    clearTimers()
                    bump(0)
                }
            } else if (activeRef.current === 0) {
                // Just entered — fire bullet 1 immediately, schedule 2 & 3 in sequence
                bump(1)
                if (!scheduledRef.current) {
                    scheduledRef.current = true
                    timersRef.current[0] = setTimeout(() => bump(2), 1100)
                    timersRef.current[1] = setTimeout(() => bump(3), 2200)
                }
            }

            rafId = requestAnimationFrame(tick)
        }

        rafId = requestAnimationFrame(tick)
        return () => {
            cancelAnimationFrame(rafId)
            clearTimers()
        }
    }, [scrollRef])

    return (
        <div ref={wrapperRef} className="ethos-overlay" style={{ opacity: 0 }}>
            <div className="ethos-panel">
                <div className="ethos-panel-header">
                    <span className="ethos-eyebrow">PHILOSOPHY</span>
                    <h2 className="ethos-title">My Ethos</h2>
                </div>

                <div className="ethos-timeline-side">
                    <div className="ethos-line-track">
                        <div ref={lineRef} className="ethos-line" style={{ height: '0%' }} />
                    </div>
                    <div className="ethos-checkpoints">
                        {ETHOS_CHECKPOINTS.map((cp, i) => (
                            <EthosCheckpoint
                                key={i}
                                checkpoint={cp}
                                active={i < activeCount}
                                index={i}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}

// ─── Rotating busts ───────────────────────────────────────────────────────────
function RotatingBust({ url, position, tiltAxis, rotSpeed = 0.3, scale = 1 }) {
    const { scene } = useGLTF(url)
    const groupRef = useRef()
    const cloned = useMemo(() => scene.clone(true), [scene])

    useFrame((_, delta) => {
        if (!groupRef.current) return
        groupRef.current.rotation.y += delta * rotSpeed
    })

    return (
        <group position={position} rotation={tiltAxis}>
            <group ref={groupRef} scale={scale}>
                <primitive object={cloned} />
            </group>
        </group>
    )
}

// ─── Sigil model ──────────────────────────────────────────────────────────────
// Geometry is offset from origin in Blender export — centroid at ~[−0.448, 0.567, 112.808]
const SIGIL2_OFFSET = [0.448, -0.567, -112.808]

function SigilModel({ position, scale = 1 }) {
    const { scene } = useGLTF('/sigil2.glb')
    const cloned = useMemo(() => {
        const c = scene.clone(true)
        c.traverse(child => {
            if (!child.isMesh) return
            // Replace material — original has alpha=0 (invisible) and wrong color
            child.material = new THREE.MeshStandardMaterial({
                color: '#6699ff',
                emissive: '#6699ff',
                emissiveIntensity: 1.4,
                side: THREE.DoubleSide,
                toneMapped: false,
            })
        })
        return c
    }, [scene])
    const spinRef = useRef()

    useFrame((_, delta) => {
        if (spinRef.current) spinRef.current.rotation.y += delta * 0.08
    })

    return (
        <group position={position} scale={scale}>
            <group ref={spinRef}>
                <group rotation={[Math.PI / 2, 0, 0]}>
                    <primitive object={cloned} position={SIGIL2_OFFSET} />
                </group>
            </group>
        </group>
    )
}

useGLTF.preload('/sigil2.glb')

// ─── Pillar with bust on top ───────────────────────────────────────────────────
function Pillar({ position, bustUrl, bustRotSpeed = 0.05, bustScale = 3 }) {
    const MAT = { color: '#080812', emissive: '#1a2d55', emissiveIntensity: 0.5, metalness: 0.85, roughness: 0.25, toneMapped: false }
    return (
        <group position={position}>
            {/* Base slab */}
            <mesh position={[0, -2.0, 0]}>
                <boxGeometry args={[0.9, 0.18, 0.9]} />
                <meshStandardMaterial {...MAT} />
            </mesh>
            {/* Column */}
            <mesh>
                <cylinderGeometry args={[0.13, 0.16, 4, 8]} />
                <meshStandardMaterial {...MAT} />
            </mesh>
            {/* Top cap */}
            <mesh position={[0, 2.1, 0]}>
                <boxGeometry args={[0.8, 0.16, 0.8]} />
                <meshStandardMaterial {...MAT} emissive="#3355cc" emissiveIntensity={0.8} />
            </mesh>
            {/* Bust */}
            <RotatingBust
                url={bustUrl}
                position={[0, 2.6, 0]}
                tiltAxis={[0, 0, 0]}
                rotSpeed={bustRotSpeed}
                scale={bustScale}
            />
        </group>
    )
}

// ─── Main Ethos Section (3D) ──────────────────────────────────────────────────
const ETHOS_SIGIL_POS = [3, 0, 11]
const ETHOS_LEFT_PIL = [-7, 0, 11]
const ETHOS_RIGHT_PIL = [13, 0, 11]
const ETHOS_CHAIN_Y = 2.1   // height of pillar tops

function EthosSection({ scrollRef }) {
    const groupRef = useRef()

    useFrame(() => {
        if (!groupRef.current) return
        const t = scrollRef.current ?? 0
        groupRef.current.visible = t >= ETHOS_ENTER - 0.03 && t <= ETHOS_EXIT + 0.03
    })

    return (
        <group ref={groupRef} position={ETHOS_POS}>
            {/* Sigil — centred between the pillars */}
            <SigilModel position={ETHOS_SIGIL_POS} scale={3} />

            {/* Left pillar — me */}
            <Pillar position={ETHOS_LEFT_PIL} bustUrl="/me.glb" bustRotSpeed={0.05} bustScale={5} />

            {/* Right pillar — robot me */}
            <Pillar position={ETHOS_RIGHT_PIL} bustUrl="/also-me.glb" bustRotSpeed={-0.04} bustScale={5} />

            {/* Spine chain connecting the two pillar tops */}
            <SpineChain
                start={[ETHOS_LEFT_PIL[0], ETHOS_CHAIN_Y, ETHOS_LEFT_PIL[2]]}
                end={[ETHOS_RIGHT_PIL[0], ETHOS_CHAIN_Y, ETHOS_RIGHT_PIL[2]]}
                mid={[3, ETHOS_CHAIN_Y - 2.8, 11]}
                color="#3366ff"
                active={false}
                interactive={false}
                segments={30}
                cogScale={0.52}
            />

            <pointLight position={[3, 4, 6]} intensity={180} color="#6699ff" distance={16} decay={2} />
            <pointLight position={[-7, 2, 4]} intensity={40} color="#3355ff" distance={10} decay={2} />
            <pointLight position={[13, 2, 4]} intensity={40} color="#3355ff" distance={10} decay={2} />
        </group>
    )
}

function ProjectsSection({ scrollRef }) {
    return (
        <group>
            <ProjectZoneGrid scrollRef={scrollRef} />
            {PROJECT_CARDS.map((config, i) => (
                <ProjectCard key={i} config={config} scrollRef={scrollRef} cardIndex={i} />
            ))}
        </group>
    )
}

// ─── Bio constants ────────────────────────────────────────────────────────────
const BIO_ENTER = 0.86
const BIO_FULL = 0.93
const BIO_CENTER = [140, -3.2, -25]

const PLACEHOLDER_IMAGES = [
    'https://picsum.photos/seed/bio1/600/900',
    'https://picsum.photos/seed/bio2/600/900',
    'https://picsum.photos/seed/bio3/600/900',
]

const DEBRIS_PIECES = [
    { startPos: [-20, 2, 8], geo: 'oct', color: '#3366ff', speed: 2.8 },
    { startPos: [10, -3, 6], geo: 'ico', color: '#2244cc', speed: 3.2 },
    { startPos: [30, 1, -4], geo: 'box', color: '#1133aa', speed: 2.5 },
    { startPos: [70, 3, 10], geo: 'oct', color: '#4455ff', speed: 3.8 },
    { startPos: [75, -2, -6], geo: 'ico', color: '#3344ee', speed: 2.9 },
    { startPos: [100, 0, 4], geo: 'oct', color: '#00aaff', speed: 4.2 },
    { startPos: [120, -1, 3], geo: 'tor', color: '#ff3366', speed: 3.6 },
    { startPos: [140, 1, 5], geo: 'ico', color: '#44ff88', speed: 4.8 },
    { startPos: [50, 4, -8], geo: 'box', color: '#2255dd', speed: 3.1 },
    { startPos: [90, -4, 7], geo: 'oct', color: '#1144bb', speed: 3.4 },
    { startPos: [110, 2, -5], geo: 'ico', color: '#3355cc', speed: 2.7 },
    { startPos: [130, -3, 6], geo: 'tor', color: '#0099ee', speed: 3.9 },
]

function DebrisPiece({ piece, progress, exploded }) {
    const meshRef = useRef()
    const posRef = useRef(new THREE.Vector3(...piece.startPos))
    const scaleRef = useRef(0)

    const geometry = useMemo(() => {
        switch (piece.geo) {
            case 'oct': return new THREE.OctahedronGeometry(0.18, 0)
            case 'ico': return new THREE.IcosahedronGeometry(0.15, 0)
            case 'tor': return new THREE.TorusGeometry(0.14, 0.05, 6, 12)
            case 'box': return new THREE.BoxGeometry(0.22, 0.22, 0.22)
            default: return new THREE.OctahedronGeometry(0.18, 0)
        }
    }, [piece.geo])

    const target = useMemo(() => new THREE.Vector3(...BIO_CENTER), [])

    useFrame((_, delta) => {
        if (!meshRef.current) return
        if (exploded) {
            const away = posRef.current.clone().sub(target).normalize()
            posRef.current.addScaledVector(away, delta * piece.speed * 3)
            scaleRef.current = dampValue(scaleRef.current, 0, 8, delta)
        } else if (progress > 0) {
            posRef.current.lerp(target, delta * piece.speed * 0.6)
            scaleRef.current = dampValue(scaleRef.current, 0.8, 5, delta)
        }
        meshRef.current.position.copy(posRef.current)
        meshRef.current.scale.setScalar(scaleRef.current)
        meshRef.current.rotation.x += delta * 1.2
        meshRef.current.rotation.y += delta * 0.9
        meshRef.current.material.opacity = scaleRef.current * 0.7
    })

    return (
        <mesh ref={meshRef} geometry={geometry} position={piece.startPos}>
            <meshBasicMaterial color={piece.color} wireframe transparent opacity={0} toneMapped={false} />
        </mesh>
    )
}

function CollapseFlash({ active }) {
    const meshRef = useRef()
    const opacityRef = useRef(0)
    const firedRef = useRef(false)
    const { camera } = useThree()
    const _fwd = useMemo(() => new THREE.Vector3(), [])

    useFrame((_, delta) => {
        if (!meshRef.current) return
        if (active && !firedRef.current) { firedRef.current = true; opacityRef.current = 1.0 }
        if (opacityRef.current > 0) {
            opacityRef.current = dampValue(opacityRef.current, 0, 8, delta)
            meshRef.current.material.opacity = opacityRef.current
            meshRef.current.visible = opacityRef.current > 0.01
            _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion)
            meshRef.current.position.copy(camera.position).addScaledVector(_fwd, 2)
            meshRef.current.quaternion.copy(camera.quaternion)
        }
    })

    return (
        <mesh ref={meshRef} visible={false}>
            <planeGeometry args={[80, 80]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0} toneMapped={false} depthWrite={false} depthTest={false} />
        </mesh>
    )
}

function GlassShard({ index, totalShards, uvOffset, uvSize, worldPos, worldSize, rotation, texture, exploded, appeared }) {
    const groupRef = useRef()
    const photoRef = useRef()
    const glassRef = useRef()

    const explodeOffset = useMemo(() => {
        const angle = (index / totalShards) * Math.PI * 2 + Math.random() * 0.8
        const radius = 2 + Math.random() * 3
        return new THREE.Vector3(
            Math.cos(angle) * radius,
            Math.sin(angle) * radius + (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 4
        )
    }, [index, totalShards])

    const currentPos = useRef(new THREE.Vector3(...worldPos).add(explodeOffset))
    const targetPos = useMemo(() => new THREE.Vector3(...worldPos), [worldPos])
    const opacityRef = useRef(0)
    const scaleRef = useRef(0.3)

    // UV-remapped photo geometry
    const photoGeo = useMemo(() => {
        const geo = new THREE.PlaneGeometry(worldSize[0], worldSize[1])
        const uvAttr = geo.attributes.uv
        const [u0, v0] = uvOffset
        const [uw, uh] = uvSize
        const uvMap = [[u0, v0 + uh], [u0 + uw, v0 + uh], [u0, v0], [u0 + uw, v0]]
        for (let i = 0; i < 4; i++) uvAttr.setXY(i, uvMap[i][0], uvMap[i][1])
        uvAttr.needsUpdate = true
        return geo
    }, [worldSize, uvOffset, uvSize])

    // Glass slab — thin box so edges are visible, creating the depth illusion
    const glassGeo = useMemo(() => new THREE.BoxGeometry(worldSize[0], worldSize[1], 0.1), [worldSize])

    useFrame((_, delta) => {
        if (!groupRef.current) return
        if (appeared) {
            currentPos.current.lerp(targetPos, delta * 4.5)
            opacityRef.current = dampValue(opacityRef.current, 1.0, 5, delta)
            scaleRef.current = dampValue(scaleRef.current, 1.0, 5, delta)
        } else if (exploded) {
            currentPos.current.lerp(targetPos.clone().add(explodeOffset.clone().multiplyScalar(2)), delta * 6)
            opacityRef.current = dampValue(opacityRef.current, 0, 10, delta)
        }
        groupRef.current.position.copy(currentPos.current)
        groupRef.current.scale.setScalar(scaleRef.current)
        if (photoRef.current?.material) photoRef.current.material.opacity = opacityRef.current
        if (glassRef.current?.material) glassRef.current.material.opacity = opacityRef.current * 0.82
    })

    return (
        <group ref={groupRef} rotation={rotation}>
            {/* Photo plane — set back behind the glass slab */}
            <mesh ref={photoRef} geometry={photoGeo} position={[0, 0, -0.07]}>
                <meshStandardMaterial map={texture} transparent opacity={0} toneMapped={false} />
            </mesh>
            {/* Glass slab — clearcoat reflections, no transmission (perf) */}
            <mesh ref={glassRef} geometry={glassGeo}>
                <meshStandardMaterial
                    transparent opacity={0}
                    roughness={0.02} metalness={0.1}
                    envMapIntensity={2.5}
                    color="#cce8ff"
                    toneMapped={false}
                />
            </mesh>
        </group>
    )
}

function FragmentedPortrait({ appeared, exploded }) {
    const textures = useTexture(PLACEHOLDER_IMAGES)
    const COLS = 4, ROWS = 6, SHARD_W = 0.72, SHARD_H = 0.96, GAP = 0.045

    const shards = useMemo(() => {
        const result = []
        const totalW = COLS * (SHARD_W + GAP)
        const totalH = ROWS * (SHARD_H + GAP)
        for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
                const index = row * COLS + col
                const texIndex = Math.floor(index / (COLS * ROWS / textures.length)) % textures.length
                result.push({
                    index, texIndex,
                    uvOffset: [col / COLS, 1 - (row + 1) / ROWS],
                    uvSize: [1 / COLS, 1 / ROWS],
                    worldPos: [(col + 0.5) * (SHARD_W + GAP) - totalW / 2, (ROWS - row - 0.5) * (SHARD_H + GAP) - totalH / 2, (Math.random() - 0.5) * 1.2],
                    worldSize: [SHARD_W, SHARD_H],
                    rotation: [(Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.06],
                })
            }
        }
        return result
    }, [textures.length])

    return (
        <group>
            {shards.map((s, i) => (
                <GlassShard key={i} index={i} totalShards={shards.length} uvOffset={s.uvOffset} uvSize={s.uvSize} worldPos={s.worldPos} worldSize={s.worldSize} rotation={s.rotation} texture={textures[s.texIndex]} appeared={appeared} exploded={exploded} />
            ))}
        </group>
    )
}

function RaveAfterglowLights({ active }) {
    const light1Ref = useRef(), light2Ref = useRef(), light3Ref = useRef()
    const hueRef = useRef(0.6)

    useFrame((state, delta) => {
        if (!active) return
        hueRef.current = (hueRef.current + delta * 0.012) % 1
        const h = hueRef.current
        const t = state.clock.elapsedTime
        if (light1Ref.current) { light1Ref.current.color.setHSL(h, 0.8, 0.5); light1Ref.current.intensity = 8 + Math.sin(t * 0.7) * 3 }
        if (light2Ref.current) { light2Ref.current.color.setHSL((h + 0.33) % 1, 0.7, 0.4); light2Ref.current.intensity = 6 + Math.sin(t * 0.5 + 1.2) * 2.5 }
        if (light3Ref.current) { light3Ref.current.color.setHSL((h + 0.66) % 1, 0.6, 0.35); light3Ref.current.intensity = 4 + Math.sin(t * 0.9 + 2.4) * 2 }
    })

    if (!active) return null
    return (
        <>
            <pointLight ref={light1Ref} position={[-4, 3, 3]} intensity={0} distance={14} decay={2} />
            <pointLight ref={light2Ref} position={[4, -2, 2]} intensity={0} distance={12} decay={2} />
            <pointLight ref={light3Ref} position={[0, 0, -4]} intensity={0} distance={10} decay={2} />
        </>
    )
}

function BioGrid({ active }) {
    const groupRef = useRef()
    const matsRef = useRef([])

    const lines = useMemo(() => {
        const pts = []
        const size = 12, step = 2
        for (let i = -size; i <= size; i += step) {
            pts.push({ p1: [i, -4, -size], p2: [i, -4, size] })
            pts.push({ p1: [-size, -4, i], p2: [size, -4, i] })
        }
        return pts
    }, [])

    useFrame((state) => {
        if (!groupRef.current || !active) return
        if (matsRef.current.length === 0)
            groupRef.current.traverse(child => { if (child.material) matsRef.current.push(child.material) })
        const baseOpacity = 0.08 + Math.sin(state.clock.elapsedTime * 0.8) * 0.03
        matsRef.current.forEach(m => { m.opacity = baseOpacity })
    })

    if (!active) return null
    return (
        <group ref={groupRef}>
            {lines.map((l, i) => <Line key={i} points={[l.p1, l.p2]} color="#2244aa" lineWidth={0.5} transparent opacity={0.08} toneMapped={false} />)}
        </group>
    )
}

// ScrollBar shows all sections except the last (DOSSIER lives outside the progress arc)
const SCROLLBAR_STOPS = SECTION_STOPS.slice(0, -1)
const SCROLLBAR_LABELS = SECTION_LABELS.slice(0, -1)
const SCROLLBAR_HIDE_T = SECTION_STOPS[SECTION_STOPS.length - 2] + 0.05  // starts fading just past BIO

function ScrollBar({ scrollRef, currentSectionRef }) {
    const fillRef = useRef()
    const dotRefs = useRef([])
    const lblRefs = useRef([])
    const wrapRef = useRef()
    const opacityRef = useRef(1)

    useEffect(() => {
        let raf
        const ACCENT = '#00aaff'
        const PAST = '#1e3a66'
        const IDLE = '#08111f'

        function loop() {
            const t = scrollRef.current ?? 0
            const active = currentSectionRef.current ?? 0

            // Fade out when entering dossier section
            const targetOp = t >= SCROLLBAR_HIDE_T ? 0 : 1
            opacityRef.current += (targetOp - opacityRef.current) * 0.08
            if (wrapRef.current) wrapRef.current.style.opacity = opacityRef.current

            if (fillRef.current) fillRef.current.style.width = `${Math.min(t / SCROLLBAR_STOPS[SCROLLBAR_STOPS.length - 1], 1) * 100}%`

            dotRefs.current.forEach((dot, i) => {
                if (!dot) return
                const isActive = i === active
                const isPast = SCROLLBAR_STOPS[i] < t + 0.01
                dot.style.background = isActive ? ACCENT : isPast ? PAST : IDLE
                dot.style.borderColor = isActive ? ACCENT : isPast ? '#2a4a88' : '#182440'
                dot.style.boxShadow = isActive ? `0 0 10px ${ACCENT}, 0 0 22px ${ACCENT}55` : isPast ? `0 0 5px #1e3a6688` : 'none'
                dot.style.transform = `translate(-50%,-50%) rotate(45deg) scale(${isActive ? 1.6 : 1})`
            })

            lblRefs.current.forEach((lbl, i) => {
                if (!lbl) return
                const isActive = i === active
                lbl.style.color = isActive ? ACCENT : '#2d4070'
                lbl.style.opacity = isActive ? '1' : '0.55'
            })

            raf = requestAnimationFrame(loop)
        }
        raf = requestAnimationFrame(loop)
        return () => cancelAnimationFrame(raf)
    }, [scrollRef, currentSectionRef])

    return (
        <div ref={wrapRef} style={{
            position: 'absolute', bottom: '36px', left: '50%',
            transform: 'translateX(-50%)', width: 'min(396px, 40.8vw)',
            zIndex: 100, pointerEvents: 'none', transition: 'none',
        }}>
            {/* End-cap left */}
            <div style={{ position: 'absolute', left: 0, top: '-5px', width: '1px', height: '11px', background: 'rgba(60,90,160,0.4)' }} />
            {/* End-cap right */}
            {/* <div style={{ position: 'absolute', right: 0, top: '-5px', width: '1px', height: '11px', background: 'rgba(60,90,160,0.4)' }} /> */}

            {/* Track */}
            <div style={{ position: 'relative', height: '1px', background: 'rgba(40,70,140,0.3)' }}>
                {/* Glowing fill */}
                <div ref={fillRef} style={{
                    position: 'absolute', top: 0, left: 0, height: '1px', width: '0%',
                    background: 'linear-gradient(90deg, transparent, #00aaff66, #00aaff)',
                    boxShadow: '0 0 6px #00aaff88',
                    transition: 'width 60ms linear',
                }} />

                {/* Checkpoints */}
                {SECTION_STOPS.map((_, i) => (
                    <div key={i} style={{
                        position: 'absolute', left: `${(i / (SECTION_STOPS.length - 1)) * 100}%`, top: 0,
                        pointerEvents: 'auto', cursor: 'pointer',
                    }} onClick={() => { currentSectionRef.current = i }}>
                        {/* Tick above track */}
                        <div style={{
                            position: 'absolute', width: '1px', height: '5px',
                            background: 'rgba(60,100,180,0.35)',
                            left: 0, top: '-5px', transform: 'translateX(-50%)',
                        }} />
                        {/* Diamond */}
                        <div ref={el => dotRefs.current[i] = el} style={{
                            position: 'absolute', width: '7px', height: '7px',
                            border: '1px solid #182440', background: '#08111f',
                            transform: 'translate(-50%,-50%) rotate(45deg)',
                            transition: 'background 0.25s, box-shadow 0.25s, transform 0.25s, border-color 0.25s',
                        }} />
                        {/* Label */}
                        <div ref={el => lblRefs.current[i] = el} style={{
                            position: 'absolute', top: '13px', left: '50%',
                            transform: 'translateX(-50%)',
                            fontSize: '8px', letterSpacing: '2px',
                            color: '#2d4070', fontFamily: 'var(--font-mono)',
                            whiteSpace: 'nowrap', userSelect: 'none',
                            transition: 'color 0.25s, opacity 0.25s',
                        }}>
                            {SECTION_LABELS[i]}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

// BioOverlay replaced by in-scene ModularResumePatch
export function BioOverlay() { return null }

// ─── Dossier overlay — full-height resume panel, shown on final scroll stop ──
const DOSSIER_CSS = `
@keyframes dossier-in {
    from { opacity: 0; transform: translate(-50%, -46%) scale(0.96); }
    to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
.dossier-panel {
    position: fixed;
    left: 75%; top: 50%;
    transform: translate(-50%, -50%);
    width: min(580px, 48vw);
    height: min(780px, 86vh);
    background: rgba(6, 7, 20, 0.72);
    backdrop-filter: blur(22px) saturate(1.4);
    -webkit-backdrop-filter: blur(22px) saturate(1.4);
    border: 1px solid rgba(100, 130, 220, 0.22);
    border-radius: 4px;
    display: flex; flex-direction: column;
    pointer-events: auto;
    box-shadow: 0 0 0 1px rgba(60,90,200,0.08), 0 24px 80px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.06);
    z-index: 80;
    transition: opacity 0.45s ease, transform 0.45s cubic-bezier(0.16,1,0.3,1);
    overflow: hidden;
}
.dossier-panel:not(.hidden) { animation: dossier-in 0.45s cubic-bezier(0.16,1,0.3,1) both; }
.dossier-panel.hidden { opacity: 0; transform: translate(-50%, -46%) scale(0.96); pointer-events: none; }
.dossier-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 10px 14px 8px;
    border-bottom: 1px solid rgba(100,130,220,0.15);
    flex-shrink: 0;
}
.dossier-header-label {
    font-family: var(--font-mono); font-size: 8px; letter-spacing: 0.28em;
    color: rgba(136,160,255,0.6); text-transform: uppercase;
    display: flex; align-items: center; gap: 7px;
}
.dossier-header-dot {
    width: 5px; height: 5px; border-radius: 50%;
    background: #3366ff; box-shadow: 0 0 6px #3366ff;
    animation: dossier-blink 1.4s step-end infinite;
}
@keyframes dossier-blink { 0%,100%{opacity:1} 50%{opacity:0} }
.dossier-header-id { font-family: var(--font-mono); font-size: 8px; color: rgba(100,130,180,0.35); letter-spacing: 0.12em; }
.dossier-panel .resume-body {
    flex: 1; overflow-y: auto; padding: 18px 18px 12px;
    scrollbar-width: thin; scrollbar-color: rgba(80,120,220,0.25) transparent;
}
.dossier-panel .resume-body::-webkit-scrollbar { width: 3px; }
.dossier-panel .resume-body::-webkit-scrollbar-thumb { background: rgba(80,120,220,0.25); border-radius: 2px; }
.dossier-resume-name { font-family: var(--font-mono); font-size: 13px; letter-spacing: 0.2em; color: #eef2ff; margin: 0 0 2px; }
.dossier-resume-role { font-family: var(--font-mono); font-size: 8px; letter-spacing: 0.22em; color: rgba(136,160,255,0.55); margin: 0 0 14px; }
.dossier-resume-section { font-family: var(--font-mono); font-size: 7.5px; letter-spacing: 0.25em; color: rgba(100,130,200,0.45); margin: 16px 0 8px; padding-bottom: 5px; border-bottom: 1px solid rgba(100,130,220,0.1); }
.dossier-resume-entry { margin: 0 0 12px; }
.dossier-resume-entry-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2px; }
.dossier-resume-entry-title { font-family: var(--font-mono); font-size: 10px; color: #c8d8ff; letter-spacing: 0.06em; }
.dossier-resume-entry-date { font-family: var(--font-mono); font-size: 8px; color: rgba(100,130,180,0.45); letter-spacing: 0.08em; }
.dossier-resume-entry-sub { font-family: var(--font-mono); font-size: 8px; color: rgba(136,160,255,0.5); letter-spacing: 0.1em; margin-bottom: 3px; }
.dossier-resume-entry-desc { font-family: 'Space Mono', monospace; font-size: 8.5px; color: rgba(180,200,240,0.5); line-height: 1.7; letter-spacing: 0.02em; }
.dossier-resume-skills { display: flex; flex-wrap: wrap; gap: 5px; }
.dossier-resume-skill { font-family: var(--font-mono); font-size: 7.5px; letter-spacing: 0.12em; color: rgba(100,140,220,0.65); padding: 2px 7px; border: 1px solid rgba(80,110,200,0.18); border-radius: 2px; }
.dossier-panel .dl-btn-row {
    display: flex; flex-shrink: 0;
    border-top: 1px solid rgba(100,130,220,0.15);
}
.dossier-panel .dl-btn {
    display: block; flex: 1; padding: 11px 0;
    background: transparent;
    color: rgba(136,160,255,0.7);
    font-family: var(--font-mono); font-size: 9px;
    letter-spacing: 0.25em; text-transform: uppercase;
    text-align: center; text-decoration: none;
    border: none; border-right: 1px solid rgba(100,130,220,0.15);
    cursor: pointer;
    transition: background 0.18s ease, color 0.18s ease;
    box-sizing: border-box;
}
.dossier-panel .dl-btn:last-child { border-right: none; }
.dossier-panel .dl-btn:hover { background: rgba(50,90,220,0.14); color: #ffffff; }
.dossier-panel .dl-btn.copied { background: rgba(0,80,40,0.22); color: #00ff88; }
`

const CONTACT_EMAIL = 'mustafa.akbar.me@gmail.com'

function DossierOverlay({ scrollRef }) {
    const panelRef = useRef()
    const visRef = useRef(false)
    const [copied, setCopied] = useState(false)

    const copyEmail = () => {
        navigator.clipboard.writeText(CONTACT_EMAIL)
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
    }

    useEffect(() => {
        let rafId
        const tick = () => {
            const t = scrollRef.current ?? 0
            const now = t >= DIPTYCH_ENTER
            if (now !== visRef.current) {
                visRef.current = now
                if (panelRef.current)
                    panelRef.current.classList.toggle('hidden', !now)
            }
            rafId = requestAnimationFrame(tick)
        }
        rafId = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(rafId)
    }, [scrollRef])

    return (
        <>
            <style>{DOSSIER_CSS}</style>
            <div ref={panelRef} className="dossier-panel hidden">
                <div className="dossier-header">
                    <div className="dossier-header-label">
                        <span className="dossier-header-dot" />
                        DOSSIER // MUSTAFA ALI AKBAR
                    </div>
                    <span className="dossier-header-id">UX-26</span>
                </div>

                <div className="resume-body">
                    <div className="dossier-resume-name">MUSTAFA ALI AKBAR</div>
                    <div className="dossier-resume-role">SENIOR PRODUCT DESIGNER</div>

                    <div className="dossier-resume-section">EXPERIENCE</div>

                    <div className="dossier-resume-entry">
                        <div className="dossier-resume-entry-header">
                            <span className="dossier-resume-entry-title">DELL / UT AUSTIN</span>
                            <span className="dossier-resume-entry-date">NOW</span>
                        </div>
                        <div className="dossier-resume-entry-sub">AI PRODUCT DESIGN // HARDWARE DESIGN</div>
                        <div className="dossier-resume-entry-desc">Building am AI-based leak alert system to protect Dell's PowerEdge servers.</div>
                    </div>

                    <div className="dossier-resume-entry">
                        <div className="dossier-resume-entry-header">
                            <span className="dossier-resume-entry-title">CBRE</span>
                            <span className="dossier-resume-entry-date">2025</span>
                        </div>
                        <div className="dossier-resume-entry-sub">VISUAL DESIGN // INTERACTION DESIGN // FRONTEND DEVELOPMENT</div>
                        <div className="dossier-resume-entry-desc">Revamped the visual language of SmartFM product through an immersive three.js demo </div>
                    </div>

                    <div className="dossier-resume-entry">
                        <div className="dossier-resume-entry-header">
                            <span className="dossier-resume-entry-title">MOTIVE</span>
                            <span className="dossier-resume-entry-date">2024</span>
                        </div>
                        <div className="dossier-resume-entry-sub">SENIOR PRODUCT DESIGNER // ENTERPRISE SYSTEMS</div>
                        <div className="dossier-resume-entry-desc">Led UX for Engine Immobilizer - remote vehicle security system allowing fleet managers to immobilize vehicles in real-time.</div>
                    </div>

                    <div className="dossier-resume-entry">
                        <div className="dossier-resume-entry-header">
                            <span className="dossier-resume-entry-title">EDUCATIVE</span>
                            <span className="dossier-resume-entry-date">2023</span>
                        </div>
                        <div className="dossier-resume-entry-sub">UX DESIGN & STRATEGY // LEARNING SYSTEMS</div>
                        <div className="dossier-resume-entry-desc">Designed Workflows — a central hub for project and documentation management, helping fast-moving teams optimize for outcomes.</div>
                    </div>

                    <div className="dossier-resume-section">TOOLS & SKILLS</div>
                    <div className="dossier-resume-skills">
                        {['Figma', 'Blender', 'Rive', 'Origami Studio', 'Miro', 'React', 'Three.js', 'Framer', 'Prototyping', 'Systems Design', 'Motion Design', 'User Research'].map(s => (
                            <span key={s} className="dossier-resume-skill">{s}</span>
                        ))}
                    </div>

                    <div className="dossier-resume-section">EDUCATION</div>
                    <div className="dossier-resume-entry">
                        <div className="dossier-resume-entry-header">
                            <span className="dossier-resume-entry-title">The University of Texas at Austin</span>
                            <span className="dossier-resume-entry-date">2025</span>
                        </div>
                        <div className="dossier-resume-entry-sub">SCHOOL OF INFORMATION // SAAS</div>
                    </div>
                </div>

                <div className="dl-btn-row">
                    <a href="/Resume%20-%20Mustafa%20Akbar.pdf" download="Resume - Mustafa Akbar.pdf" className="dl-btn">↓ Download PDF</a>
                    <button onClick={copyEmail} className={`dl-btn${copied ? ' copied' : ''}`}>{copied ? 'Copied ✓' : '@ Email'}</button>
                </div>
            </div>
        </>
    )
}

// ═════════════════════════════════════════════════════════════════════════════
// MODULAR RESUME PATCH BAY
// ═════════════════════════════════════════════════════════════════════════════

const COMPANY_NODES = [
    { id: 'cbre', pos: [-5.5, 2.4, 0], title: 'CBRE', desc: 'VISUAL LANG // 2025\nINTERACTION DESIGN', color: '#ff3366' },
    { id: 'motive', pos: [-5.5, 0.8, 0], title: 'MOTIVE', desc: 'PRODUCT UX // 2024\nENTERPRISE SYSTEMS', color: '#ffaa22' },
    { id: 'educative', pos: [-5.5, -0.8, 0], title: 'EDUCATIVE', desc: 'UX DESIGN // 2023\nLEARNING SYSTEMS', color: '#00aaff' },
    { id: 'dell', pos: [-5.5, -2.4, 0], title: 'DELL', desc: 'CAPSTONE // NOW\nSCHOOL OF INFO', color: '#44ff88' },
]
const HUB_POS = [0, 0, 0]
const CUBE_POS = [5.5, 0, 0]

// Company jack — hex bolt shape, label to the left, data readout to the right
function SynthNode({ config, isActive, onClick, onHover, onHoverOut }) {
    const meshRef = useRef()
    const [hovered, setHovered] = useState(false)

    useFrame((_, delta) => {
        if (meshRef.current) meshRef.current.rotation.z += delta * (hovered ? 1.5 : 0.2)
    })

    return (
        <group position={config.pos}>
            <mesh
                ref={meshRef}
                rotation={[Math.PI / 2, 0, 0]}
                onPointerOver={e => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'crosshair'; onHover?.() }}
                onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto'; onHoverOut?.() }}
                onClick={e => { e.stopPropagation(); onClick() }}
            >
                <cylinderGeometry args={[0.45, 0.55, 0.35, 6]} />
                <meshStandardMaterial
                    color={isActive ? config.color : '#111118'}
                    metalness={0.9} roughness={0.2}
                    emissive={config.color}
                    emissiveIntensity={isActive ? 0.5 : (hovered ? 0.2 : 0)}
                    toneMapped={false}
                />
            </mesh>
            <mesh position={[0, 0, 0.18]}>
                <circleGeometry args={[0.17, 16]} />
                <meshBasicMaterial color="#000" />
            </mesh>
            <pointLight color={config.color} intensity={isActive ? 1.5 : 0} distance={3} />

            {/* Label — to the left of the jack */}
            <Text
                position={[-0.7, 0, 0]}
                font="/fonts/Rocket%20Command/rocketcommandexpand.ttf"
                fontSize={0.2} letterSpacing={0.08} anchorX="right" anchorY="middle"
                color={hovered || isActive ? config.color : '#2a3d55'}
                material-toneMapped={false}
            >{config.title}</Text>

            {/* Data readout — to the right, toward the resume hub */}
            {(isActive || hovered) && (
                <group>
                    <Line points={[[0.5, 0, 0], [1.0, 0.5, 0], [1.5, 0.5, 0]]}
                        color={config.color} lineWidth={0.7} transparent opacity={0.5} />
                    <Text
                        position={[1.6, 0.5, 0]}
                        font={SUBTITLE_FONT}
                        fontSize={0.14} lineHeight={1.5} anchorX="left" anchorY="middle"
                        color="#aabbcc" material-toneMapped={false} material-transparent={true}
                    >{config.desc}</Text>
                </group>
            )}
        </group>
    )
}

// Central resume hub — glowing icosahedron with orbiting ring
function ResumeHub({ currentSectionRef }) {
    const meshRef = useRef()
    const ringRef = useRef()
    const [hovered, setHovered] = useState(false)
    useFrame((_, delta) => {
        if (meshRef.current) meshRef.current.rotation.y += delta * 0.4
        if (ringRef.current) ringRef.current.rotation.z -= delta * 0.6
    })
    const goToDossier = (e) => {
        e.stopPropagation()
        if (currentSectionRef) currentSectionRef.current = SECTION_STOPS.length - 1
    }
    return (
        <group position={HUB_POS}>
            <mesh ref={meshRef}
                onClick={goToDossier}
                onPointerEnter={e => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'crosshair' }}
                onPointerLeave={() => { setHovered(false); document.body.style.cursor = 'auto' }}
            >
                <icosahedronGeometry args={[0.7, 1]} />
                <meshStandardMaterial
                    color="#eef2ff" emissive="#3366ff" emissiveIntensity={hovered ? 1.2 : 0.6}
                    metalness={0.8} roughness={0.1} toneMapped={false}
                />
            </mesh>
            <mesh ref={ringRef}>
                <torusGeometry args={[1.1, 0.02, 8, 64]} />
                <meshBasicMaterial color="#3366ff" transparent opacity={0.45} toneMapped={false} />
            </mesh>
            <pointLight color="#3366ff" intensity={2.5} distance={7} />
            <Text position={[0, -1.1, 0]}
                font="/fonts/Rocket%20Command/rocketcommandexpand.ttf"
                fontSize={0.22} letterSpacing={0.1} anchorX="center" anchorY="middle"
                color="#ffffff" material-toneMapped={false}
            >RESUME.SYS</Text>
            <Text position={[0, -1.45, 0]}
                font="/fonts/Rocket%20Command/rocketcommandexpand.ttf"
                fontSize={0.13} letterSpacing={0.05} anchorX="center" anchorY="middle"
                color="#3a5080" material-toneMapped={false}
            >MUSTAFA ALEEM // UX ARCHITECT</Text>
        </group>
    )
}

// Locked cube — represents the next role; click to reveal message
function LockedCube({ clicked, onCubeClick, onHover, onHoverOut }) {
    const meshRef = useRef()
    const wireRef = useRef()
    const [hovered, setHovered] = useState(false)

    useFrame((_, delta) => {
        const speed = hovered ? 1.2 : 0.35
        if (meshRef.current) {
            meshRef.current.rotation.y += delta * speed
            meshRef.current.rotation.x += delta * speed * 0.4
        }
        if (wireRef.current) {
            wireRef.current.rotation.copy(meshRef.current.rotation)
        }
    })

    return (
        <group
            position={CUBE_POS}
            onPointerEnter={e => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'crosshair'; onHover?.() }}
            onPointerLeave={() => { setHovered(false); document.body.style.cursor = 'auto'; onHoverOut?.() }}
        >
            <mesh
                ref={meshRef}
                onClick={e => { e.stopPropagation(); onCubeClick() }}
            >
                <boxGeometry args={[1.1, 1.1, 1.1]} />
                <meshStandardMaterial
                    color="#06060f"
                    emissive={clicked ? '#3366ff' : (hovered ? '#112244' : '#000011')}
                    emissiveIntensity={clicked ? 0.8 : (hovered ? 0.4 : 0.15)}
                    metalness={0.9} roughness={0.15} toneMapped={false}
                />
            </mesh>
            <mesh ref={wireRef}>
                <boxGeometry args={[1.16, 1.16, 1.16]} />
                <meshBasicMaterial
                    color={clicked ? '#3366ff' : (hovered ? '#334466' : '#1a2233')}
                    wireframe transparent
                    opacity={clicked ? 0.9 : (hovered ? 0.55 : 0.28)}
                    toneMapped={false}
                />
            </mesh>

            {clicked && <pointLight color="#3366ff" intensity={3} distance={6} />}

            {/* Label below */}
            <Text position={[0, -0.9, 0]}
                font="/fonts/Rocket%20Command/rocketcommandexpand.ttf"
                fontSize={0.22} letterSpacing={0.1} anchorX="center" anchorY="middle"
                color={clicked ? '#3366ff' : (hovered ? '#334466' : '#1a2233')}
                material-toneMapped={false}
            >{clicked ? 'NEXT_ROLE' : '???'}</Text>

            {/* "Hire me" reveal text */}
            {clicked && (
                <Text position={[0, 1.3, 0]}
                    font="/fonts/Rocket%20Command/rocketcommandexpand.ttf"
                    fontSize={0.21} lineHeight={1.5} anchorX="center" anchorY="bottom"
                    color="#00ff88" maxWidth={4}
                    material-toneMapped={false} material-transparent={true}
                >{'HIRE ME TO\nUNLOCK THIS'}</Text>
            )}

            {/* Hover hint */}
            {!clicked && hovered && (
                <Text position={[0, 1.0, 0]}
                    font="/fonts/Rocket%20Command/rocketcommandexpand.ttf"
                    fontSize={0.15} anchorX="center" anchorY="bottom"
                    color="#334466" material-toneMapped={false}
                >[ CLICK ]</Text>
            )}
        </group>
    )
}

useGLTF.preload('/spine.glb')

// Samples a quadratic bezier, orients each spine cog along the tangent
function SpineChain({ start, end, mid, color, active, interactive = true, segments = 20, rotationSpeed = 1.5, paused = false, cogScale = 0.28 }) {
    const { scene } = useGLTF('/spine.glb')
    const _up = useMemo(() => new THREE.Vector3(0, 0, 1), [])
    const spinRefs = useRef([])
    const posRefs = useRef([])
    const hoveredIdxRef = useRef(-1)
    const spreadOffsets = useRef([])
    const frameCountRef = useRef(0)
    const lastEnterFrameRef = useRef(-100)
    const directions = useMemo(() => Array.from({ length: segments }, () => Math.random() < 0.5 ? 1 : -1), [segments])
    const speedRef = useRef(1)

    const transforms = useMemo(() => {
        const s = new THREE.Vector3(...start)
        const m = new THREE.Vector3(...mid)
        const e = new THREE.Vector3(...end)
        return Array.from({ length: segments }, (_, i) => {
            const t = i / segments
            const tm = (i + 0.5) / segments   // midpoint t for tangent
            const mt = 1 - t, mtm = 1 - tm
            const pos = new THREE.Vector3(
                mt * mt * s.x + 2 * mt * t * m.x + t * t * e.x,
                mt * mt * s.y + 2 * mt * t * m.y + t * t * e.y,
                mt * mt * s.z + 2 * mt * t * m.z + t * t * e.z,
            )
            // Quadratic bezier derivative (tangent)
            const tan = new THREE.Vector3(
                2 * mtm * (m.x - s.x) + 2 * tm * (e.x - m.x),
                2 * mtm * (m.y - s.y) + 2 * tm * (e.y - m.y),
                2 * mtm * (m.z - s.z) + 2 * tm * (e.z - m.z),
            ).normalize()
            const quat = new THREE.Quaternion().setFromUnitVectors(_up, tan)
            return { pos: pos.toArray(), quat }
        })
    }, [start, end, mid, segments, _up])

    const clones = useMemo(
        () => transforms.map(() => {
            const c = scene.clone(true)
            c.traverse(child => { if (child.isMesh) child.material = child.material.clone() })
            return c
        }),
        // only rebuild if segment count or base scene changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [scene, segments]
    )

    useEffect(() => {
        clones.forEach(c => c.traverse(child => {
            if (!child.isMesh) return
            child.material.emissive?.set(color)
            child.material.emissiveIntensity = active ? 0.9 : 0.08
            child.material.toneMapped = false
        }))
    }, [active, color, clones])

    useFrame((_, delta) => {
        // Clear hover if no cog refreshed the frame counter in the last 8 frames
        // (2 was too tight — edge-on cogs miss pointerOver intermittently, causing snapping)
        frameCountRef.current++
        if (frameCountRef.current - lastEnterFrameRef.current > 8) hoveredIdxRef.current = -1

        // Spin each cog — smoothly decelerates/accelerates on pause/resume
        speedRef.current = dampValue(speedRef.current, paused ? 0 : 1, 5, delta)
        spinRefs.current.forEach((ref, i) => {
            if (ref) ref.rotation.z += delta * rotationSpeed * directions[i] * speedRef.current
        })

        // Soft-selection spread — Blender proportional edit style
        const SPREAD_RADIUS = 7   // influence in index units
        const SPREAD_STRENGTH = 0.85  // world-unit max lift
        const hovIdx = hoveredIdxRef.current
        transforms.forEach((t, i) => {
            const posRef = posRefs.current[i]
            if (!posRef) return
            if (!spreadOffsets.current[i]) spreadOffsets.current[i] = 0
            const dist = hovIdx >= 0 ? Math.abs(i - hovIdx) : SPREAD_RADIUS
            const falloff = dist < SPREAD_RADIUS ? Math.pow(1 - dist / SPREAD_RADIUS, 2) : 0
            spreadOffsets.current[i] = dampValue(spreadOffsets.current[i], SPREAD_STRENGTH * falloff, 10, delta)
            posRef.position.set(t.pos[0], t.pos[1] + spreadOffsets.current[i], t.pos[2])
        })
    })

    return (
        <group>
            {transforms.map((t, i) => (
                // outer group: orient cog along bezier tangent; inner group: spin
                <group key={i}
                    ref={el => { if (el) posRefs.current[i] = el }}
                    position={t.pos}
                    quaternion={t.quat}
                    onPointerOver={interactive ? (e => { e.stopPropagation(); hoveredIdxRef.current = i; lastEnterFrameRef.current = frameCountRef.current }) : undefined}
                    onPointerMove={interactive ? (e => { e.stopPropagation(); hoveredIdxRef.current = i; lastEnterFrameRef.current = frameCountRef.current }) : undefined}>
                    <group ref={el => { if (el) { el.rotation.z = i * 0.22; spinRefs.current[i] = el } }}>
                        <primitive object={clones[i]} scale={cogScale} rotation={[Math.PI, 0, 0]} />
                    </group>
                </group>
            ))}
        </group>
    )
}

function ModularResumePatch({ visible, currentSectionRef }) {
    const groupRef = useRef()
    const [activeId, setActiveId] = useState(null)
    const [cubeClicked, setCubeClicked] = useState(false)
    const [hoveredNodeId, setHoveredNodeId] = useState(null)
    const [cubeHovered, setCubeHovered] = useState(false)
    const [companyPaused, setCompanyPaused] = useState(() => COMPANY_NODES.map(() => false))
    const staggerTimers = useRef([])

    // When cube is hovered, stagger-pause each company chain; resume all on hover out
    useEffect(() => {
        staggerTimers.current.forEach(clearTimeout)
        staggerTimers.current = []
        if (cubeHovered) {
            COMPANY_NODES.forEach((_, i) => {
                const delay = 60 + Math.random() * 380
                staggerTimers.current[i] = setTimeout(
                    () => setCompanyPaused(prev => { const n = [...prev]; n[i] = true; return n }),
                    delay
                )
            })
        } else {
            setCompanyPaused(COMPANY_NODES.map(() => false))
        }
        return () => staggerTimers.current.forEach(clearTimeout)
    }, [cubeHovered])

    useFrame((_, delta) => {
        if (!groupRef.current) return
        groupRef.current.position.y = dampValue(groupRef.current.position.y, visible ? 0 : 10, 4, delta)
    })

    if (!visible) return null

    return (
        <group ref={groupRef}>
            {/* Company → Resume spine chains */}
            {COMPANY_NODES.map((node, i) => (
                <SpineChain
                    key={node.id}
                    start={node.pos} end={HUB_POS}
                    mid={[(node.pos[0] + HUB_POS[0]) / 2, node.pos[1] - 1.8, 0]}
                    color={node.color}
                    active={activeId === node.id}
                    paused={companyPaused[i] || hoveredNodeId === node.id}
                />
            ))}

            {/* Resume → Cube spine chain */}
            <SpineChain
                start={HUB_POS} end={CUBE_POS} mid={[2.75, -2.0, 0]}
                color="#3366ff"
                active={cubeClicked}
                paused={cubeHovered}
            />

            {COMPANY_NODES.map(node => (
                <SynthNode
                    key={node.id} config={node}
                    isActive={activeId === node.id}
                    onClick={() => setActiveId(id => id === node.id ? null : node.id)}
                    onHover={() => setHoveredNodeId(node.id)}
                    onHoverOut={() => setHoveredNodeId(null)}
                />
            ))}

            <ResumeHub currentSectionRef={currentSectionRef} />
            <LockedCube
                clicked={cubeClicked}
                onCubeClick={() => setCubeClicked(true)}
                onHover={() => setCubeHovered(true)}
                onHoverOut={() => setCubeHovered(false)}
            />
        </group>
    )
}

// ─── Glitch bust — me flickers into robot-hologram every few seconds ──────────
function GlitchBust({ position = [0, 0, 0], scale = 4, rotSpeed = 0.06 }) {
    const { scene: humanScene } = useGLTF('/me.glb')
    const { scene: robotScene } = useGLTF('/also-me.glb')

    const humanClone = useMemo(() => humanScene.clone(true), [humanScene])
    const robotClone = useMemo(() => {
        const c = robotScene.clone(true)
        c.traverse(child => {
            if (!child.isMesh || !child.material) return
            const orig = Array.isArray(child.material) ? child.material[0] : child.material
            // Robot appears with chromatic aberration hologram effect
            child.material = new THREE.MeshStandardMaterial({
                map: orig.map,
                normalMap: orig.normalMap,
                roughnessMap: orig.roughnessMap,
                metalnessMap: orig.metalnessMap,
                color: orig.color ?? new THREE.Color(0xffffff),
                roughness: orig.roughness ?? 0.6,
                metalness: orig.metalness ?? 0.4,
                transparent: true,
                opacity: 0.8,
                toneMapped: false,
                side: THREE.DoubleSide,
            })
        })
        return c
    }, [robotScene])

    const spinRef = useRef()
    const humanRef = useRef()
    const robotRef = useRef()
    const jitterRef = useRef()
    const g = useRef({ phase: 'human', timer: 0, ft: 0, next: 3 + Math.random() * 4 })

    const wander = useRef({ target: 0, timer: 0, next: 2 + Math.random() * 3 })

    useFrame((state, delta) => {
        const w = wander.current
        w.timer += delta
        if (w.timer >= w.next) {
            w.target = (Math.random() - 0.5) * 0.55
            w.timer = 0
            w.next = 2.5 + Math.random() * 4.0
        }
        if (spinRef.current)
            spinRef.current.rotation.y = dampValue(spinRef.current.rotation.y, w.target, 0.6, delta)

        const s = g.current
        s.timer += delta

        if (s.phase === 'human') {
            if (s.timer > s.next) { s.phase = 'to_robot'; s.ft = 0; s.timer = 0 }

        } else if (s.phase === 'to_robot' || s.phase === 'to_human') {
            s.ft += delta
            const show = Math.floor(s.ft * 80) % 2 === 0
            if (humanRef.current) humanRef.current.visible = s.phase === 'to_robot' ? show : !show
            if (robotRef.current) robotRef.current.visible = s.phase === 'to_robot' ? !show : show
            if (jitterRef.current) {
                jitterRef.current.position.x = (Math.random() - 0.5) * 0.09
                jitterRef.current.position.y = (Math.random() - 0.5) * 0.06
            }
            if (s.ft > 0.28) {
                const landing = s.phase === 'to_robot' ? 'robot' : 'human'
                s.phase = landing; s.timer = 0
                if (humanRef.current) humanRef.current.visible = landing === 'human'
                if (robotRef.current) robotRef.current.visible = landing === 'robot'
                if (jitterRef.current) { jitterRef.current.position.x = 0; jitterRef.current.position.y = 0 }
                if (landing === 'human') s.next = 3 + Math.random() * 5
            }

        } else if (s.phase === 'robot') {
            if (s.timer > 1.0 + Math.random() * 0.8) { s.phase = 'to_human'; s.ft = 0 }
        }
    })

    return (
        <group position={position} scale={scale}>
            <group ref={jitterRef}>
                <group ref={spinRef}>
                    <group ref={humanRef}><primitive object={humanClone} /></group>
                    <group ref={robotRef} visible={false}><primitive object={robotClone} /></group>
                </group>
            </group>
        </group>
    )
}

// ─── Diptych — bust + resume side-by-side revealed on final scroll ────────────
const DIPTYCH_ENTER = 1.06   // appears as camera approaches dossier stop

const RESUME_CSS = `
.dossier { width:240px; background:#f7f6f2; color:#111; font-family:'Georgia',serif;
           padding:28px 24px; box-shadow:0 4px 32px rgba(0,0,0,0.22); user-select:none }
.dossier h1 { font-size:17px; font-weight:700; letter-spacing:0.06em; margin:0 0 3px }
.dossier .role { font-size:8.5px; letter-spacing:0.22em; color:#555; margin:0 0 16px; font-family:'Courier New',monospace }
.dossier hr { border:none; border-top:1px solid #ccc; margin:0 0 14px }
.dossier .section { font-size:7.5px; letter-spacing:0.2em; color:#888; margin:0 0 6px; font-family:'Courier New',monospace }
.dossier .entry { font-size:10px; line-height:1.7; margin:0 0 10px; color:#222 }
.dossier .entry strong { display:block; font-size:10px; font-weight:700 }
.dossier .entry span { font-size:9px; color:#666 }
.dossier .skills { font-size:9px; color:#444; line-height:2; letter-spacing:0.04em }
`

// ─── Photo Ring — circular gallery of images for the Dossier section ──────────
const PHOTO_PATHS = [
    '/photos/DSCN3675 (1).png',
    '/photos/E8BBA5C7-1659-4C8E-9044-9555075F11A0.png',
    '/photos/IMG_1830.png',
    '/photos/IMG_3979.png',
    '/photos/IMG_7194.png',
    '/photos/IMG_7737.png',
    '/photos/IMG_8804.png',
    '/photos/PXL_20250318_174316350.png',
    '/photos/PXL_20250318_174319952 (1).png',
    '/photos/PXL_20251026_025829577.png',
    '/photos/exported_8647493E-CA66-4175-AA6D-9ACDC7C9E1A2.png'
]

function SinglePhoto({ path, angle, radius, center, hoveredIdx, setHoveredIdx, index, appeared }) {
    const meshRef = useRef()
    const tex = useTexture(path)
    const opRef = useRef(0)
    const scaleRef = useRef(1)

    useFrame((state, delta) => {
        if (!meshRef.current) return

        const isHovered = hoveredIdx === index
        const targetOp = appeared ? (isHovered ? 1 : 0.4) : 0
        opRef.current = dampValue(opRef.current, targetOp, 4, delta)
        scaleRef.current = dampValue(scaleRef.current, isHovered ? 1.4 : 1, 6, delta)

        const x = center[0] + Math.cos(angle) * (radius + (isHovered ? 1.5 : 0))
        const y = center[1] + (index % 2 === 0 ? 0.4 : -0.4) + Math.sin(state.clock.elapsedTime + index) * 0.2
        const z = center[2] + Math.sin(angle) * (radius + (isHovered ? 1.5 : 0))

        meshRef.current.position.set(x, y, z)
        meshRef.current.lookAt(center[0], center[1], center[2])
        meshRef.current.scale.setScalar(scaleRef.current)
        meshRef.current.material.opacity = opRef.current
        meshRef.current.material.emissiveIntensity = 0.15 + (isHovered ? 0.35 : 0) + Math.sin(state.clock.elapsedTime * 4 + index) * 0.05
    })

    return (
        <mesh
            ref={meshRef}
            onPointerOver={e => { e.stopPropagation(); setHoveredIdx(index); document.body.style.cursor = 'pointer' }}
            onPointerOut={() => { setHoveredIdx(-1); document.body.style.cursor = 'auto' }}
        >
            <planeGeometry args={[1.5, 2.2]} />
            <meshStandardMaterial
                map={tex}
                emissive="#00ccff"
                emissiveMap={tex}
                transparent
                opacity={0}
                side={THREE.DoubleSide}
                toneMapped={false}
                depthWrite={false}
            />
        </mesh>
    )
}

function PhotoRing({ appeared }) {
    const [hoveredIdx, setHoveredIdx] = useState(-1)
    const groupRef = useRef()
    const radius = 5.5
    const center = [-2, -4.5, 0]

    useFrame((_, delta) => {
        if (groupRef.current && hoveredIdx === -1) {
            groupRef.current.rotation.y += delta * 0.12
        }
    })

    return (
        <group ref={groupRef}>
            {PHOTO_PATHS.map((path, i) => {
                const angle = (i / PHOTO_PATHS.length) * Math.PI * 2
                return (
                    <SinglePhoto
                        key={path}
                        path={path}
                        angle={angle}
                        radius={radius}
                        center={center}
                        hoveredIdx={hoveredIdx}
                        setHoveredIdx={setHoveredIdx}
                        index={i}
                        appeared={appeared}
                    />
                )
            })}
        </group>
    )
}

function BustDiptych({ scrollRef }) {
    const opRef = useRef()
    const [appeared, setAppeared] = useState(false)

    useFrame((_, delta) => {
        const t = scrollRef.current ?? 0
        const show = t >= DIPTYCH_ENTER
        if (appeared !== show) setAppeared(show)
        if (opRef.current) {
            const targetScale = show ? 1 : 0
            const s = dampValue(opRef.current.scale.x, targetScale, 4, delta)
            opRef.current.scale.setScalar(s)
            // No vertical jump, stays fixed at deepest Z
            opRef.current.position.y = 0
        }
    })

    return (
        <group ref={opRef} position={[0, 0, -85]} scale={0}>
            <GlitchBust position={[-2, -4.5, 0]} scale={6} rotSpeed={0.04} />
            <SigilModel position={[-1, -4.5, 7.5]} scale={1.8} />
            <PhotoRing appeared={appeared} />
        </group>
    )
}

function BioSection({ scrollRef, currentSectionRef }) {
    const groupRef = useRef()
    const [phase, setPhase] = useState('idle')
    const phaseRef = useRef('idle')
    const timerRef = useRef(0)
    const tRef = useRef(0)

    useFrame((_, delta) => {
        if (!groupRef.current) return
        const t = scrollRef.current ?? 0
        tRef.current = t
        groupRef.current.visible = t >= BIO_ENTER - 0.04

        if (t < BIO_ENTER - 0.04) {
            if (phaseRef.current !== 'idle') { phaseRef.current = 'idle'; setPhase('idle'); timerRef.current = 0 }
            return
        }

        timerRef.current += delta
        if (phaseRef.current === 'idle' && t >= BIO_ENTER) { phaseRef.current = 'debris'; setPhase('debris'); timerRef.current = 0 }
        if (phaseRef.current === 'debris' && timerRef.current > 1.4) { phaseRef.current = 'collapse'; setPhase('collapse'); timerRef.current = 0 }
        if (phaseRef.current === 'collapse' && timerRef.current > 0.4) { phaseRef.current = 'appeared'; setPhase('appeared'); timerRef.current = 0 }
        if (phaseRef.current === 'appeared' && timerRef.current > 0.6) { phaseRef.current = 'afterglow'; setPhase('afterglow') }
    })

    const flashActive = phase === 'collapse'
    const patchVisible = ['appeared', 'afterglow'].includes(phase) && tRef.current < 1.04

    return (
        <group ref={groupRef} position={BIO_CENTER} visible={false}>
            <CollapseFlash active={flashActive} />
            <RaveAfterglowLights active={patchVisible} />
            <BioGrid active={patchVisible} />
            <ModularResumePatch visible={patchVisible} currentSectionRef={currentSectionRef} />
            <BustDiptych scrollRef={scrollRef} />
        </group>
    )
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. MAIN SCENE & APP EXPORT
// ═════════════════════════════════════════════════════════════════════════════

// Cards live at SECTION_STOPS indices 3, 4 → cardIndex 0, 1
function DragController({ currentSectionRef }) {
    const { gl } = useThree()

    useEffect(() => {
        const el = gl.domElement

        const onDown = (e) => {
            const ci = currentSectionRef.current - 2
            if (ci < 0 || ci > 2) return
            dragRotState.isDragging = true
            dragRotState.cardIndex = ci
            dragRotState.lastX = e.clientX
            dragRotState.lastY = e.clientY
            el.setPointerCapture(e.pointerId)
        }

        const onMove = (e) => {
            if (!dragRotState.isDragging) return
            const ci = dragRotState.cardIndex
            dragRotState.rotY[ci] += (e.clientX - dragRotState.lastX) * 0.009
            dragRotState.rotX[ci] += (e.clientY - dragRotState.lastY) * 0.009
            dragRotState.rotX[ci] = Math.max(-Math.PI * 0.55, Math.min(Math.PI * 0.55, dragRotState.rotX[ci]))
            dragRotState.lastX = e.clientX
            dragRotState.lastY = e.clientY
        }

        const onUp = (e) => {
            if (!dragRotState.isDragging) return
            dragRotState.isDragging = false
            try { el.releasePointerCapture(e.pointerId) } catch (_) { }
        }

        el.addEventListener('pointerdown', onDown)
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        return () => {
            el.removeEventListener('pointerdown', onDown)
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
        }
    }, [gl, currentSectionRef])

    return null
}

function Scene({ scrollRef, currentSectionRef }) {
    return (
        <Selection>
            <ScrollSmoother currentSectionRef={currentSectionRef} scrollRef={scrollRef} />
            <CameraController scrollRef={scrollRef} />
            <DragController currentSectionRef={currentSectionRef} />

            <ambientLight intensity={0.3} />
            <directionalLight position={[5, 5, 5]} intensity={1.5} color="#ffffff" />
            <directionalLight position={[-3, 3, -5]} intensity={0.4} color="#8888ff" />
            <Environment preset="night" />

            <EffectComposer disableNormalPass>
                <SelectiveBloom luminanceThreshold={0.5} intensity={1.2} levels={4} />
                <ChromaticAberration offset={warpOffset} />
                <Vignette eskil={false} offset={0.1} darkness={1.1} />
            </EffectComposer>

            <color attach="background" args={['#050510']} />
            <fog attach="fog" args={['#050510', 25, 60]} />

            <CursorFX />
            <Select enabled>
                <InteractiveParticleField count={300} />
                <StarField />
                <HeroSection />
                <EthosSection scrollRef={scrollRef} />
                <ProjectsSection scrollRef={scrollRef} />
                <BioSection scrollRef={scrollRef} currentSectionRef={currentSectionRef} />
            </Select>

            {/* VideoScreen rendered outside Select enabled — no bloom bleed */}
            <group position={[120, -0.5, 0]} rotation={[0, 0.2, 0]}>
                <VideoScreen />
            </group>

            <Stats />
        </Selection>
    )
}

// EthosOverlay removed — ethos is now an in-scene 3D component (EthosSection)

// ═════════════════════════════════════════════════════════════════════════════
// PROJECT TERMINAL OVERLAY
// ═════════════════════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════════════════════
// LOADING SCREEN
// ═════════════════════════════════════════════════════════════════════════════
const LOAD_STATUSES = [
    'INITIALIZING WEBGL CONTEXT',
    'LOADING GEOMETRY BUFFERS',
    'COMPILING SHADER PROGRAMS',
    'UPLOADING TEXTURE DATA',
    'BUILDING SCENE GRAPH',
    'CALIBRATING CAMERA PATH',
    'SYSTEM READY',
]
const SEGMENTS = 22

function LoadingScreen() {
    const { progress, active } = useProgress()
    const [gone, setGone] = useState(false)
    const [exit, setExit] = useState(false)

    useEffect(() => {
        if (progress >= 100 && !active) {
            const t1 = setTimeout(() => setExit(true), 350)
            const t2 = setTimeout(() => setGone(true), 1300)
            return () => { clearTimeout(t1); clearTimeout(t2) }
        }
    }, [progress, active])

    if (gone) return null

    const filled = Math.round((progress / 100) * SEGMENTS)
    const msgIdx = Math.min(Math.floor((progress / 100) * LOAD_STATUSES.length), LOAD_STATUSES.length - 1)

    return (
        <div className="loader-root" style={{ opacity: exit ? 0 : 1 }}>
            <div className="loader-scanlines" />
            <div className="loader-corner tl" />
            <div className="loader-corner tr" />
            <div className="loader-corner bl" />
            <div className="loader-corner br" />

            <div className="loader-center">
                <div className="loader-eyebrow">SYS://PORTFOLIO_2026 · IDENTITY_UNRESOLVED</div>
                <div className="loader-title" data-text="PORTFOLIO">PORTFOLIO</div>
                <div className="loader-rule" />
                <div className="loader-bar-wrap">
                    {Array.from({ length: SEGMENTS }, (_, i) => (
                        <div key={i} className={`loader-seg${i < filled ? ' active' : ''}`} />
                    ))}
                </div>
                <div className="loader-meta">
                    <span className="loader-pct">{Math.round(progress).toString().padStart(3, '0')}%</span>
                    <span className="loader-status">{LOAD_STATUSES[msgIdx]}</span>
                </div>
            </div>

            <div className="loader-bottom">
                <span>RENDER ENGINE // THREE.JS r{THREE.REVISION}</span>
                <span>WEBGL 2.0 · 60FPS TARGET</span>
            </div>
        </div>
    )
}


function CopyEmailHud() {
    const [hovered, setHovered] = useState(false)
    const [copied, setCopied] = useState(false)
    const copy = () => {
        navigator.clipboard.writeText(CONTACT_EMAIL)
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
    }
    return (
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}>
            <button onClick={copy} title="Copy email" style={{
                position: 'absolute', right: '100%', marginRight: 8,
                opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none',
                background: 'none',
                border: '1px solid rgba(255,255,255,0.25)',
                color: copied ? '#00ff88' : '#aabbdd',
                cursor: 'pointer',
                padding: '2px 8px',
                fontSize: 10,
                letterSpacing: '0.12em',
                fontFamily: 'var(--font-mono)',
                lineHeight: '18px',
                transition: 'opacity 0.15s, color 0.2s',
                whiteSpace: 'nowrap',
            }}>
                {copied ? '✓' : '⧉'}
            </button>
            <GlitchLink href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL.toUpperCase()}
            </GlitchLink>
        </div>
    )
}

const SCROLL_HINT_CSS = `
@keyframes scrollWheelDrop {
    0%   { transform: translateY(0); opacity: 1; }
    60%  { transform: translateY(8px); opacity: 0; }
    61%  { transform: translateY(0); opacity: 0; }
    100% { transform: translateY(0); opacity: 1; }
}
.scroll-hint {
    position: absolute; bottom: 72px; left: 50%; transform: translateX(-50%);
    display: flex; flex-direction: column; align-items: center; gap: 7px;
    pointer-events: none;
}
.scroll-hint-mouse {
    width: 20px; height: 32px;
    border: 1.5px solid rgba(136,153,204,0.45); border-radius: 10px;
    display: flex; justify-content: center; padding-top: 5px; box-sizing: border-box;
}
.scroll-hint-wheel {
    width: 2px; height: 6px;
    background: rgba(136,153,204,0.7); border-radius: 2px;
    animation: scrollWheelDrop 1.8s ease-in-out infinite;
}
.scroll-hint-label {
    font-size: 8px; letter-spacing: 0.3em; color: rgba(136,153,204,0.4);
    font-family: 'Courier New', monospace; text-transform: uppercase;
}

@keyframes glitch-link-1 {
    0% { clip-path: inset(20% 0 10% 0); transform: translate(-1px, -1px); }
    20% { clip-path: inset(60% 0 40% 0); transform: translate(1px, 1px); }
    40% { clip-path: inset(10% 0 70% 0); transform: translate(-1px, 1px); }
    60% { clip-path: inset(40% 0 20% 0); transform: translate(1px, -1px); }
    80% { clip-path: inset(80% 0 5% 0); transform: translate(-1px, 1px); }
    100% { clip-path: inset(30% 0 40% 0); transform: translate(1px, -1px); }
}
@keyframes glitch-gradient-shimmer {
    0% { background-position: 0% 50%; }
    100% { background-position: 200% 50%; }
}
.glitch-link {
    position: relative;
    display: inline-block;
    background: linear-gradient(90deg, #8899cc 0%, #99aab5 25%, #ffffff 50%, #9ab4b4 75%, #8899cc 100%);
    background-size: 200% auto;
    background-clip: text;
    -webkit-background-clip: text;
    color: transparent !important;
    animation: glitch-gradient-shimmer 6s linear infinite;
    transition: opacity 0.2s;
    text-decoration: none;
}
.glitch-link:hover { 
    color: #fff !important; 
    background: none; 
    -webkit-text-fill-color: #fff;
}
.glitch-link::before,
.glitch-link::after {
    content: attr(data-text);
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    background: #050510;
    display: none;
    -webkit-text-fill-color: initial;
}
.glitch-link:hover::before {
    display: block;
    left: 2px;
    text-shadow: -1px 0 #ff00c1;
    clip-path: inset(10% 0 70% 0);
    animation: glitch-link-1 0.4s infinite linear alternate-reverse;
}
.glitch-link:hover::after {
    display: block;
    left: -2px;
    text-shadow: 1px 0 #00fff9;
    clip-path: inset(70% 0 10% 0);
    animation: glitch-link-1 0.3s infinite linear alternate-reverse;
}
`

function ScrollHint({ scrollRef }) {
    const elRef = useRef(null)
    useEffect(() => {
        let raf
        const tick = () => {
            if (elRef.current) {
                const t = scrollRef.current
                const opacity = Math.max(0, 1 - t / 0.07)
                elRef.current.style.opacity = opacity
            }
            raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [scrollRef])
    return (
        <div ref={elRef} className="scroll-hint">
            <style>{SCROLL_HINT_CSS}</style>
            <div className="scroll-hint-mouse">
                <div className="scroll-hint-wheel" />
            </div>
            <div className="scroll-hint-label">SCROLL</div>
        </div>
    )
}

function GlitchLink({ href, children, ...props }) {
    return (
        <a href={href} className="glitch-link" data-text={children.toString().toUpperCase()} target="_blank" rel="noreferrer" {...props}>
            {children}
        </a>
    )
}

export default function Portfolio() {
    const scrollRef = useRef(0)
    const currentSectionRef = useRef(0)
    useEffect(() => {
        const onMove = (e) => {
            const overUI = e.target.tagName !== 'CANVAS'
            uiHoveredRef.current = overUI
            document.body.classList.toggle('ui-hovered', overUI)
        }
        window.addEventListener('mousemove', onMove)
        return () => {
            window.removeEventListener('mousemove', onMove)
            document.body.classList.remove('ui-hovered')
        }
    }, [])

    // Wheel-to-section snapping — one section per gesture, locked until settled
    useEffect(() => {
        let wheelAccum = 0
        let locked = false

        const onWheel = (e) => {
            e.preventDefault()
            if (locked) return

            // Normalize across deltaMode: pixels (0) → as-is, lines (1) → ×40, pages (2) → ×800
            const normalized = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY
            wheelAccum += normalized

            if (wheelAccum >= WHEEL_THRESHOLD) {
                wheelAccum = 0
                locked = true
                currentSectionRef.current = Math.min(currentSectionRef.current + 1, SECTION_STOPS.length - 1)
                setTimeout(() => { locked = false }, 800)
            } else if (wheelAccum <= -WHEEL_THRESHOLD) {
                wheelAccum = 0
                locked = true
                currentSectionRef.current = Math.max(currentSectionRef.current - 1, 0)
                setTimeout(() => { locked = false }, 800)
            }
        }

        window.addEventListener('wheel', onWheel, { passive: false })
        return () => window.removeEventListener('wheel', onWheel)
    }, [])

    return (
        <div style={{ width: '100vw', height: '100vh', background: '#050510', overflow: 'hidden' }}>
            <LoadingScreen />

            {/* GLOBAL HUD */}
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 50, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '0 40px', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', color: '#fff', textTransform: 'uppercase', letterSpacing: '2px', fontSize: '13px', pointerEvents: 'auto', padding: '24px 0' }}>
                    <div style={{ fontWeight: 'bold' }}>MUSTAFA // PORTFOLIO</div>
                    <div>
                        Open for work
                    </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', color: '#8899cc', fontSize: '13px', letterSpacing: '1px', pointerEvents: 'auto', padding: '24px 0' }}>
                    <div style={{ display: 'flex', gap: '20px' }}>
                        <GlitchLink href="https://drive.google.com/file/d/1lFeiToMUnMRtD6pC40q_PyZW01hf9Kus/view?usp=sharing">RESUME</GlitchLink>
                        <GlitchLink href="https://www.linkedin.com/in/mustafa-ali-akbar-a5195387/">LINKEDIN</GlitchLink>
                        <GlitchLink href="https://github.com/moosefroggo">GITHUB</GlitchLink>
                    </div>
                    <div>
                        <CopyEmailHud />
                    </div>
                </div>
            </div>

            <ScrollHint scrollRef={scrollRef} />
            <EthosOverlay scrollRef={scrollRef} />
            <BioOverlay scrollRef={scrollRef} />
            <DossierOverlay scrollRef={scrollRef} />
            <ScrollBar scrollRef={scrollRef} currentSectionRef={currentSectionRef} />

            <Canvas camera={{ position: [0, 1, 16], fov: 70 }} dpr={[1, 1.5]}>
                <React.Suspense fallback={null}>
                    <Scene scrollRef={scrollRef} currentSectionRef={currentSectionRef} />
                </React.Suspense>
            </Canvas>
        </div>
    )
}