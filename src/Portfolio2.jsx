import React, { useRef, useMemo, useState, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Text, Text3D, Center, useGLTF, Stats, Line, useTexture } from '@react-three/drei'
import { EffectComposer, Bloom, ChromaticAberration, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'

// 🟢 Global warp offset for velocity-driven chromatic aberration
export const warpOffset = new THREE.Vector2(0.002, 0.002)

// ═════════════════════════════════════════════════════════════════════════════
// 1. CONFIGURATION & CAMERA PATH
// ═════════════════════════════════════════════════════════════════════════════

// Ethos position — a dark empty zone the camera pans toward
const ETHOS_POS = [70, 0, -15]

const CAMERA_PATH = [
    { t: 0.00, pos: [0, 1, 16],    look: [0, 0, 0],        fov: 70, roll: 0 },
    // ── Ethos: camera travels to X≈65, looks toward busts at X=70 ──
    { t: 0.08, pos: [40, 0.3, 14], look: ETHOS_POS,        fov: 64, roll: 0 },
    { t: 0.24, pos: [65, 0, 12],   look: ETHOS_POS,        fov: 60, roll: 0 },
    // ── Transition to project rail (30-unit gap: ethos X=70 → cards X=100) ──
    { t: 0.30, pos: [80, 0.5, 12], look: [80, 0, 0],       fov: 68, roll: 0 },
    // ── Card 1 — X=100 ──
    { t: 0.38, pos: [100, 0, 9],   look: [100, 0, 0],      fov: 62, roll: -1 },
    { t: 0.44, pos: [100, 0, 6],   look: [100, 0, 0],      fov: 52, roll: 0 },
    // ── Card 2 — X=120 ──
    { t: 0.52, pos: [110, 0.3, 10], look: [110, 0, 0],     fov: 60, roll: 1 },
    { t: 0.58, pos: [120, 0, 9],   look: [120, 0, 0],      fov: 58, roll: -0.5 },
    { t: 0.62, pos: [120, 0, 6],   look: [120, 0, 0],      fov: 52, roll: 0 },
    // ── Card 3 — X=140 ──
    { t: 0.70, pos: [130, 0.3, 10], look: [130, 0, 0],     fov: 60, roll: 0.5 },
    { t: 0.76, pos: [140, 0, 9],   look: [140, 0, 0],      fov: 58, roll: -0.5 },
    { t: 0.80, pos: [140, 0, 6],   look: [140, 0, 0],      fov: 52, roll: 0 },
    // ── Bio section ──
    { t: 0.86, pos: [140, 0, 0],   look: [140, -1, -20],   fov: 42, roll: 0 },
    { t: 0.93, pos: [140, 0, -15], look: [140, -1, -35],   fov: 42, roll: 0 },
    { t: 1.00, pos: [140, 0, -25], look: [140, -1, -45],   fov: 42, roll: 0 },
]

// Section snap stops — camera always rests at one of these t-values
const SECTION_STOPS = [
    0.00,   // hero
    0.16,   // ethos (checkpoints 1+2)
    0.22,   // ethos (checkpoint 3 — progress=0.875 > threshold 0.80)
    0.44,   // card 1 park
    0.62,   // card 2 park
    0.80,   // card 3 park
    0.96,   // bio
]
const WHEEL_THRESHOLD = 60   // deltaY pixels to trigger a section advance
const SECTION_LABELS  = ['HERO', 'ETHOS', 'ETHOS', 'NEXUS', 'AURA', 'ECHO', 'BIO']

const PROJECT_CARDS = [
    {
        pos: [100, 0, 0], rot: [0, -0.15, 0], color: '#00aaff', appear: 0.44,
        title: 'Engine Immobilizer', subtitle: '01 // Motive',
        desc: 'Allowing managers to remotely immobilize stolen vehicles',
        tech: ['Blender', 'Figma', 'Origami Studio'],
        stats: { role: 'Senior Product Designer', year: '2024', client: 'Motive' },
        objectType: 'truck_immobilizer',
    },
    {
        pos: [120, -0.5, 0], rot: [0, 0.2, 0], color: '#ff3366', appear: 0.62,
        title: 'AURA', subtitle: '02 // HEALTH OS',
        desc: 'Minimalist patient management system with biometric integrations. Built for speed and accessibility across clinical environments.',
        tech: ['Next.js', 'Tailwind', 'Prisma'],
        stats: { role: 'FULLSTACK', year: '2023', client: 'AURA HLTH' },
        objectType: 'workflows',
    },
    {
        pos: [140, 0.5, 0], rot: [0, -0.1, 0.02], color: '#44ff88', appear: 0.80,
        title: 'ECHO', subtitle: '03 // WEB3 PROTOCOL',
        desc: 'Decentralized identity verification layer built on Ethereum. Custom smart contracts paired with a buttery smooth Framer Motion frontend.',
        tech: ['Solidity', 'Ethers.js', 'Framer'],
        stats: { role: 'WEB3 DEV', year: '2023', client: 'ECHO LABS' },
        objectType: 'icosahedron',
    },
]

// ═════════════════════════════════════════════════════════════════════════════
// 2. HERO CONFIGURATION — edit here to tune the hero section
// ═════════════════════════════════════════════════════════════════════════════

const HERO_CONFIG = {
    // Per-letter tweaks: yOffset and zOffset are in world units (pre-scale)
    letters: [
        { char: 'M', yOffset: 0,    zOffset: 0 },
        { char: 'U', yOffset: 0,    zOffset: 0 },
        { char: 'S', yOffset: 0,    zOffset: 0 },
        { char: 'T', yOffset: 0,    zOffset: 0 },
        { char: 'A', yOffset: 0,    zOffset: 0 },
        { char: 'F', yOffset: 0,    zOffset: 0 },
        { char: 'A', yOffset: 0,    zOffset: 0 },
    ],
    spacing: 3.6,            // units between letter centers (pre-scale)
    groupY: 1.2,             // vertical offset of the whole hero group
    targetFraction: 0.72,    // fraction of viewport width that MUSTAFA fills

    subtitleText: 'PRODUCT DESIGNER & CREATIVE ENGINEER',
    subtitleYOffset: -3.8,   // Y below letter baseline (pre-scale)
    subtitleFontSize: 0.9,   // font size (pre-scale)
    subtitleLetterSpacing: 0.15,
    spineRotationSpeed: 1.5,     // radians/sec — spin of individual spine pieces around their tangent axis
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

function CameraController({ scrollRef }) {
    const { camera } = useThree()
    const lookAtTarget = useMemo(() => new THREE.Vector3(), [])
    const prevScroll = useRef(0)
    const velocityRef = useRef(0)

    const _targetPos = useMemo(() => new THREE.Vector3(), [])
    const _targetLook = useMemo(() => new THREE.Vector3(), [])
    const _startPos = useMemo(() => new THREE.Vector3(), [])
    const _endPos = useMemo(() => new THREE.Vector3(), [])
    const _startLook = useMemo(() => new THREE.Vector3(), [])
    const _endLook = useMemo(() => new THREE.Vector3(), [])

    useFrame((_, delta) => {
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
        const targetFov = baseFov + velocityRef.current * 12
        // Exaggerate path roll during scroll for a thrown-through-space feel
        const pathRoll = THREE.MathUtils.lerp(start.roll, end.roll, easeT) * (Math.PI / 180)
        const targetRoll = pathRoll * (1 + velocityRef.current * 3.5)

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
    const orbRef     = useRef()
    const illumRef   = useRef()
    const rimRef     = useRef()

    const _dir      = useMemo(() => new THREE.Vector3(), [])
    const _orbPos   = useMemo(() => new THREE.Vector3(), [])
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

        const breathe = 1 + Math.sin(state.clock.elapsedTime * 2.2) * 0.04
        if (orbRef.current) orbRef.current.scale.setScalar(breathe)
    })

    return (
        <>
            <group ref={orbRef}>
                {/* Glass shell — reflective crystal, lit from inside */}
                <mesh>
                    <sphereGeometry args={[0.22, 64, 64]} />
                    <meshPhysicalMaterial
                        color="#cce4ff"
                        emissive="#2244aa"
                        emissiveIntensity={0.18}
                        roughness={0.0}
                        metalness={0.0}
                        clearcoat={1.0}
                        clearcoatRoughness={0.0}
                        ior={1.65}
                        reflectivity={1.0}
                        envMapIntensity={3.5}
                        transparent
                        opacity={0.22}
                        toneMapped={false}
                        side={THREE.FrontSide}
                    />
                </mesh>
                {/* Inner glow core */}
                <mesh scale={0.55}>
                    <sphereGeometry args={[0.22, 32, 32]} />
                    <meshBasicMaterial color="#99ccff" transparent opacity={0.82} toneMapped={false} />
                </mesh>
                {/* Hot nucleus for bloom */}
                <mesh scale={0.22}>
                    <sphereGeometry args={[0.22, 16, 16]} />
                    <meshBasicMaterial color="#ffffff" transparent opacity={0.95} toneMapped={false} />
                </mesh>
                {/* Inner light — illuminates the glass shell from inside */}
                <pointLight intensity={18} color="#88aaff" distance={3} decay={2} />
            </group>

            <group ref={rimRef}>
                {/* Spike left — tip points away from centre */}
                <mesh position={[-0.58, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                    <coneGeometry args={[0.042, 0.32, 6]} />
                    <meshPhysicalMaterial
                        color="#aaccff" emissive="#6688cc" emissiveIntensity={1.2}
                        roughness={0} metalness={0.2} clearcoat={1} clearcoatRoughness={0}
                        transparent opacity={0.85} toneMapped={false}
                    />
                </mesh>
                {/* Spike right */}
                <mesh position={[0.58, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
                    <coneGeometry args={[0.042, 0.32, 6]} />
                    <meshPhysicalMaterial
                        color="#aaccff" emissive="#6688cc" emissiveIntensity={1.2}
                        roughness={0} metalness={0.2} clearcoat={1} clearcoatRoughness={0}
                        transparent opacity={0.85} toneMapped={false}
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
    () => [makePoly(64, 1.3), makePoly(6, 0.85), new Float32Array([-1.1,0,0, 1.1,0,0]), new Float32Array([0,-1.1,0, 0,1.1,0])], // hexagon + cross + ring
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
const CORRIDOR_COUNT  = 8
const CORRIDOR_ZSTART = -8
const CORRIDOR_ZSTEP  = 16
// Staggered X/Y for depth impact — equal spacing on Z is the constant
const CORRIDOR_X = [0, -4, 4, -2,  2, -4,  4,  0]
const CORRIDOR_Y = [0,  1, -1, 1.5, -0.5, 0.5, -1.2, 0]
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
        const mat   = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, toneMapped: false, depthWrite: false })
        g.add(new THREE.LineSegments(edges, mat))
        mats.push(mat)
    }
    for (const child of node.children) g.add(buildEdgesGroup(child, color, mats))
    return g
}

function makeHologramClones(scene, color, targetSize) {
    const box    = new THREE.Box3().setFromObject(scene)
    const size   = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const s      = targetSize / Math.max(size.x, size.y, size.z, 0.001)

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
        const m = new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0.4, transparent: true, opacity: 0, roughness: 0.05, metalness: 0.8, side: THREE.DoubleSide, toneMapped: false, depthWrite: false })
        c.material = m; solidMats.push(m)
    })
    return { wire, solid, wireMats, solidMats }
}

// Preserves original GLB textures, adds holographic emissive tint + transparency.
function makeTexturedHologramClone(scene, accentColor, targetSize) {
    const box    = new THREE.Box3().setFromObject(scene)
    const size   = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const s      = targetSize / Math.max(size.x, size.y, size.z, 0.001)

    const clone = scene.clone(true)
    clone.scale.setScalar(s)
    clone.position.set(-center.x * s, -center.y * s, -center.z * s)

    const mats = []
    clone.traverse(c => {
        if (!c.isMesh || !c.material) return
        const orig = Array.isArray(c.material) ? c.material[0] : c.material
        const m = new THREE.MeshStandardMaterial({
            map:          orig.map          ?? null,
            normalMap:    orig.normalMap    ?? null,
            roughnessMap: orig.roughnessMap ?? null,
            metalnessMap: orig.metalnessMap ?? null,
            roughness:    orig.roughness    ?? 0.6,
            metalness:    orig.metalness    ?? 0.4,
            emissive:     new THREE.Color(accentColor),
            emissiveIntensity: 0.3,
            transparent:  true,
            opacity:      0,
            toneMapped:   false,
        })
        c.material = m
        mats.push(m)
    })
    return { clone, mats }
}

function TruckImmobilizerScene({ hovered, appeared }) {
    const { scene: truckScene } = useGLTF('/Truck.glb')
    const { scene: immScene }   = useGLTF('/Engine Immobilizer.glb')

    const truckGroupRef = useRef()
    const immGroupRef   = useRef()
    const truckOpRef    = useRef(0)
    const immOpRef      = useRef(0)

    const { clone: truckClone, mats: truckMats } =
        useMemo(() => makeTexturedHologramClone(truckScene, '#00aaff', 2.2), [truckScene])

    const { clone: immClone, mats: immMats } =
        useMemo(() => makeTexturedHologramClone(immScene, '#ffaa22', 1.0), [immScene])

    useFrame((state, delta) => {
        truckOpRef.current = dampValue(truckOpRef.current, appeared ? 0.5 : 0, 5, delta)
        truckMats.forEach(m => { m.opacity = truckOpRef.current })

        immOpRef.current = dampValue(immOpRef.current, appeared ? 0.9 : 0, 5, delta)
        immMats.forEach(m => { m.opacity = immOpRef.current })

        if (truckGroupRef.current) truckGroupRef.current.rotation.y += delta * 0.22
        if (immGroupRef.current)   immGroupRef.current.lookAt(state.camera.position)
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

            {/* Signal line immobilizer → truck */}
            {appeared && (
                <Line
                    points={[[1.6, 0.9, 0.3], [-0.4, -0.3, 0]]}
                    color="#ffaa22"
                    lineWidth={1}
                    transparent
                    opacity={hovered ? 0.75 : 0.35}
                    toneMapped={false}
                />
            )}
        </group>
    )
}

useGLTF.preload('/Truck.glb')
useGLTF.preload('/Engine Immobilizer.glb')

function WorkflowsScene({ hovered, appeared }) {
    const { scene: wfScene } = useGLTF('/workflows.glb')

    const groupRef = useRef()
    const opRef    = useRef(0)

    const { clone: wfClone, mats: wfMats } =
        useMemo(() => makeTexturedHologramClone(wfScene, '#ff3366', 2.8), [wfScene])

    useFrame((_, delta) => {
        opRef.current = dampValue(opRef.current, appeared ? 0.9 : 0, 5, delta)
        wfMats.forEach(m => { m.opacity = opRef.current })
        if (groupRef.current) groupRef.current.rotation.y += delta * 0.18
    })

    return (
        <group>
            <group ref={groupRef} position={[0, 0, 0]}>
                <primitive object={wfClone} />
                <pointLight color="#ff3366" intensity={appeared ? 3 : 0} distance={8} decay={2} />
            </group>
        </group>
    )
}

useGLTF.preload('/workflows.glb')

function CaseStudyObject({ objectType, color, hovered, appeared }) {
    const meshRef = useRef()
    const wireRef = useRef()
    const pulseRef = useRef()
    const solidOpacityRef = useRef(0)
    const wireOpacityRef = useRef(0)

    const geometry = useMemo(() => {
        switch (objectType) {
            case 'octahedron':  return new THREE.OctahedronGeometry(1.4, 0)
            case 'torus':       return new THREE.TorusGeometry(1.1, 0.38, 16, 48)
            case 'icosahedron': return new THREE.IcosahedronGeometry(1.3, 1)
            default:            return new THREE.OctahedronGeometry(1.4, 0)
        }
    }, [objectType])

    useFrame((_, delta) => {
        if (!meshRef.current || !wireRef.current) return
        const speed = hovered ? 2.2 : 1.0
        meshRef.current.rotation.x += delta * 0.003 * speed
        meshRef.current.rotation.y += delta * 0.007 * speed
        wireRef.current.rotation.x = meshRef.current.rotation.x
        wireRef.current.rotation.y = meshRef.current.rotation.y

        solidOpacityRef.current = dampValue(solidOpacityRef.current, hovered ? 0.72 : 0.0, 5, delta)
        wireOpacityRef.current  = dampValue(wireOpacityRef.current,  hovered ? 0.25 : (appeared ? 0.85 : 0.0), 5, delta)

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
        return <TruckImmobilizerScene hovered={hovered} appeared={appeared} />
    }
    if (objectType === 'workflows') {
        return <WorkflowsScene hovered={hovered} appeared={appeared} />
    }

    return (
        <group>
            <mesh ref={wireRef} geometry={geometry}>
                <meshBasicMaterial color={color} wireframe transparent opacity={0} toneMapped={false} />
            </mesh>
            <mesh ref={meshRef} geometry={geometry} visible={false}>
                <meshPhysicalMaterial color={color} transparent opacity={0} roughness={0.1} metalness={0.9} emissive={color} emissiveIntensity={0.3} toneMapped={false} side={THREE.DoubleSide} />
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

    const xPos = (side === 'left' ? -1 : 1) * 2.8
    const anchor = side === 'left' ? 'right' : 'left'

    return (
        <group ref={groupRef} position={[xPos, 0, 0.1]}>
            <Text position={[0, 0.65, 0]} fontSize={0.09} color="#4466aa" anchorX={anchor} letterSpacing={0.12} material-toneMapped={false} material-transparent={true} material-opacity={0}>ROLE ──────────────────</Text>
            <Text position={[0, 0.48, 0]} fontSize={0.14} color={color}    anchorX={anchor} letterSpacing={0.08} material-toneMapped={false} material-transparent={true} material-opacity={0}>{stats.role}</Text>
            <Text position={[0, 0.18, 0]} fontSize={0.09} color="#4466aa" anchorX={anchor} letterSpacing={0.12} material-toneMapped={false} material-transparent={true} material-opacity={0}>YEAR ──────────────────</Text>
            <Text position={[0, 0.02, 0]} fontSize={0.14} color={color}    anchorX={anchor} letterSpacing={0.08} material-toneMapped={false} material-transparent={true} material-opacity={0}>{stats.year}</Text>
            <Text position={[0, -0.28, 0]} fontSize={0.09} color="#4466aa" anchorX={anchor} letterSpacing={0.12} material-toneMapped={false} material-transparent={true} material-opacity={0}>Company ─────────────────</Text>
            <Text position={[0, -0.44, 0]} fontSize={0.14} color={color}    anchorX={anchor} letterSpacing={0.08} material-toneMapped={false} material-transparent={true} material-opacity={0}>{stats.client}</Text>
            <Text position={[0, -0.74, 0]} fontSize={0.085} color="#334466" anchorX={anchor} letterSpacing={0.1}  material-toneMapped={false} material-transparent={true} material-opacity={0}>{tech.join('  ·  ')} {blink ? '|' : ' '}</Text>
        </group>
    )
}

// ─── Targeting reticle — L-brackets that lock in on hover ────────────────────
function LBracket({ position, flipX, flipY, color }) {
    const sx = flipX ? -1 : 1
    const sy = flipY ? -1 : 1
    return (
        <group position={position}>
            <HudLine x1={0} y1={0} z1={0} x2={sx * 0.35} y2={0}          z2={0} color={color} />
            <HudLine x1={0} y1={0} z1={0} x2={0}          y2={sy * 0.35} z2={0} color={color} />
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
        scaleRef.current  = dampValue(scaleRef.current,  hovered ? 1.0 : 1.6, 7, delta)
        opacityRef.current = dampValue(opacityRef.current, appeared ? (hovered ? 1.0 : 0.35) : 0.0, 5, delta)
        groupRef.current.scale.setScalar(scaleRef.current)
        const op = opacityRef.current
        matsRef.current.forEach(m => { m.opacity = op })
    })

    const r = radius
    return (
        <group ref={groupRef}>
            <LBracket position={[-r,  r, 0.1]} flipX={false} flipY={false} color={color} />
            <LBracket position={[ r,  r, 0.1]} flipX={true}  flipY={false} color={color} />
            <LBracket position={[-r, -r, 0.1]} flipX={false} flipY={true}  color={color} />
            <LBracket position={[ r, -r, 0.1]} flipX={true}  flipY={true}  color={color} />
            <HudLine x1={-0.08} y1={0} z1={0.1} x2={-0.02} y2={0} z2={0.1} color={color} />
            <HudLine x1={0.02}  y1={0} z1={0.1} x2={0.08}  y2={0} z2={0.1} color={color} />
            <HudLine x1={0} y1={-0.08} z1={0.1} x2={0} y2={-0.02} z2={0.1} color={color} />
            <HudLine x1={0} y1={0.02}  z1={0.1} x2={0} y2={0.08}  z2={0.1} color={color} />
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
function ProjectCard({ config, scrollRef }) {
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
        >
            <CaseStudyObject objectType={config.objectType} color={config.color} hovered={hovered} appeared={appeared} />
            <TargetingReticle hovered={hovered} appeared={appeared} color={config.color} radius={2.0} />
            <ScanReveal color={config.color} active={scanActive} onComplete={() => setAppeared(true)} />
            <HudPanel stats={config.stats} tech={config.tech} color={config.color} appeared={appeared} side="left" />

            <group position={[0, 1.95, 0.1]}>
                <Center>
                    <Text3D font="/fonts/Niki/Niki_Regular.json" size={0.45} depth={0.05} letterSpacing={0.05} curveSegments={12}>
                        {config.title}
                        <meshStandardMaterial color={config.color} transparent opacity={appeared ? 1 : 0} toneMapped={false} emissive={config.color} emissiveIntensity={0.2} />
                    </Text3D>
                </Center>
            </group>
            <Text position={[0, 1.55, 0.1]} fontSize={0.1}  color="#445577"      anchorX="center" anchorY="middle" letterSpacing={0.15} material-toneMapped={false} material-transparent={true} material-opacity={appeared ? 1 : 0}>{config.subtitle}</Text>
            <Text position={[0, -1.8, 0.1]} fontSize={0.13} color="#667799"      anchorX="center" anchorY="top"    maxWidth={4.5} lineHeight={1.6} material-toneMapped={false} material-transparent={true} material-opacity={appeared ? 0.85 : 0}>{config.desc}</Text>

            {appeared && <HudLine x1={-2.2} y1={-2.55} z1={0} x2={2.2} y2={-2.55} z2={0} color={config.color} opacity={0.3} />}
        </group>
    )
}

function WritingSpineLetter({ points, sourceGeometry, material, position = [0, 0, 0], delay = 0 }) {
    const instancedRef = useRef()
    const offsetRef = useRef(0)
    const drawProgressRef = useRef(0)
    const dummyMatrix = useMemo(() => new THREE.Object3D(), [])
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

        if (state.clock.elapsedTime > delay) {
            drawProgressRef.current = dampValue(drawProgressRef.current, 1, 5, delta)
        }

        // Speed decelerates naturally as drawing progresses, stops at 1.0
        const movementSpeed = 0.5 * Math.max(0, 1 - drawProgressRef.current)
        offsetRef.current = (offsetRef.current + delta * movementSpeed) % 1

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

            dummyMatrix.position.set(px, py, pz)
            dummyMatrix.lookAt(px + tx, py + ty, pz + tz)

            dummyMatrix.rotateZ(t * Math.PI * 8 + state.clock.elapsedTime * HERO_CONFIG.spineRotationSpeed)

            if (t > drawProgressRef.current) {
                dummyMatrix.scale.set(0, 0, 0)
            } else {
                dummyMatrix.scale.set(1, 1, 1)
            }

            dummyMatrix.updateMatrix()
            instanced.setMatrixAt(i, dummyMatrix.matrix)
        }
        instanced.instanceMatrix.needsUpdate = true
    })

    return (
        <group position={position}>
            <instancedMesh ref={instancedRef} args={[sourceGeometry, material, count]} />
        </group>
    )
}

// ─── Letter paths for MUSTAFA (manually designed 3-D waypoints) ───────────────
//  Each path is an array of THREE.Vector3 control points tracing the letter stroke.
//  Coordinate space: x=[-1.5, 1.5], y=[-2, 2], z varies for depth twist.
const v3 = (x, y, z = 0) => new THREE.Vector3(x, y, z)

const LETTER_M = [v3(-1.5, -2), v3(-1.5, 2, 0.4), v3(0, 0.2, -0.4), v3(1.5, 2, 0.4), v3(1.5, -2)]
const LETTER_U = [v3(-1.3, 2), v3(-1.3, -1.2, 0.3), v3(-0.5, -2.2, -0.3), v3(0.5, -2.2, 0.3), v3(1.3, -1.2, -0.3), v3(1.3, 2)]
const LETTER_S = [v3(1.3, 1.8, -0.3), v3(0.3, 2.2, 0.2), v3(-1.1, 1.8, 0.3), v3(-1.3, 0.8, -0.2), v3(-0.2, 0.1, 0), v3(0.2, -0.1, 0), v3(1.3, -0.8, 0.2), v3(1.1, -1.8, -0.3), v3(-0.3, -2.2, 0.2), v3(-1.3, -1.8, 0.3)]
const LETTER_T_CROSS = [v3(-1.5, 2, 0.2), v3(0, 2, -0.2), v3(1.5, 2, 0.2)]
const LETTER_T_STEM = [v3(0, 2, -0.2), v3(0, 0, 0.3), v3(0, -2, -0.3)]
const LETTER_A = [v3(-1.4, -2, 0.2), v3(-0.7, 0, -0.3), v3(0, 2, 0.3), v3(0.7, 0, -0.3), v3(1.4, -2, 0.2)]
const LETTER_A_CROSS = [v3(-0.7, 0, -0.2), v3(0, 0, 0.2), v3(0.7, 0, -0.2)]
const LETTER_F_VERT = [v3(-1.2, -2, 0.2), v3(-1.2, 0, -0.2), v3(-1.2, 2, 0.3)]
const LETTER_F_TOP = [v3(-1.2, 2, 0.3), v3(0, 2, -0.2), v3(1.3, 2, 0.3)]
const LETTER_F_MID = [v3(-1.2, 0.2, -0.2), v3(0, 0.2, 0.2), v3(0.9, 0.2, -0.2)]

// Multi-stroke letters use an array of paths rendered as separate SpinePaths
const MUSTAFA_LETTERS = {
    M: [LETTER_M],
    U: [LETTER_U],
    S: [LETTER_S],
    T: [LETTER_T_CROSS, LETTER_T_STEM],
    A: [LETTER_A, LETTER_A_CROSS],
    F: [LETTER_F_VERT, LETTER_F_TOP, LETTER_F_MID],
}

// WritingSpineLetter already handles a single path — wrap it for multi-stroke support
function SpineLetter2({ char, sourceGeometry, material, position = [0, 0, 0], scale = 1, delay = 0 }) {
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
                />
            ))}
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
        metalness: 0.2,
        roughness: 0.05,
        transmission: 0.85,
        thickness: 1.2,
        ior: 1.5,
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

            <group position={[0, cfg.subtitleYOffset * letterScale, 0]}>
                <Center>
                    <Text3D font="/fonts/Niki/Niki_Regular.json" size={cfg.subtitleFontSize * letterScale} depth={0.01} letterSpacing={0.08} curveSegments={8}>
                        {cfg.subtitleText}
                        <meshStandardMaterial color="#8899cc" toneMapped={false} />
                    </Text3D>
                </Center>
            </group>
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
        text: 'We do not build templates. We sculpt digital space — every pixel intentional, every interaction considered.',
    },
    {
        label: 'SYSTEMS',
        text: 'Design systems that breathe. Code architecture that scales. Obsessive attention to the seams between form and function.',
    },
    {
        label: 'VISION',
        text: 'The web is not a printed page. It is a living medium — and we shape it into something that moves people.',
    },
]

// ─── Typing text hook ─────────────────────────────────────────────────────────
function useTypingEffect(text, active, speed = 30) {
    const [displayed, setDisplayed] = useState('')
    const indexRef = useRef(0)
    const prevActive = useRef(false)

    useEffect(() => {
        // Reset when becoming inactive
        if (!active) {
            indexRef.current = 0
            setDisplayed('')
            prevActive.current = false
            return
        }

        // Already fully typed
        if (prevActive.current && indexRef.current >= text.length) return
        prevActive.current = true

        const interval = setInterval(() => {
            indexRef.current++
            if (indexRef.current > text.length) {
                clearInterval(interval)
                return
            }
            setDisplayed(text.slice(0, indexRef.current))
        }, speed)

        return () => clearInterval(interval)
    }, [active, text, speed])

    return displayed
}

// ─── Single checkpoint row ────────────────────────────────────────────────────
function EthosCheckpoint({ checkpoint, active, index }) {
    const typedText = useTypingEffect(checkpoint.text, active, 25)
    const isComplete = typedText.length === checkpoint.text.length

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
                <p className="ethos-text">
                    {typedText}
                    {active && !isComplete && <span className="ethos-cursor">|</span>}
                </p>
            </div>
        </div>
    )
}

// ─── Ethos Overlay (fixed HTML outside Canvas) ───────────────────────────────
// Reads scrollRef via requestAnimationFrame — no Canvas/useFrame needed.
function EthosOverlay({ scrollRef }) {
    const wrapperRef = useRef()
    const lineRef = useRef()
    const [activeCount, setActiveCount] = useState(0)
    const prevCountRef = useRef(0)

    // Thresholds: fraction of ethos progress at which each checkpoint fires
    const THRESHOLDS = [0.12, 0.48, 0.80]

    useEffect(() => {
        let rafId
        const tick = () => {
            const t = scrollRef.current ?? 0
            const raw = (t - ETHOS_ENTER) / (ETHOS_EXIT - ETHOS_ENTER)
            const progress = Math.max(0, Math.min(1, raw))

            // Fade panel in/out at section edges
            const fadeIn  = Math.min(1, Math.max(0, (t - ETHOS_ENTER) / 0.025))
            const fadeOut = Math.min(1, Math.max(0, (ETHOS_EXIT  - t) / 0.025))
            const opacity = Math.min(fadeIn, fadeOut)
            if (wrapperRef.current) wrapperRef.current.style.opacity = opacity

            // Grow the vertical line
            if (lineRef.current) lineRef.current.style.height = `${progress * 100}%`

            // Activate checkpoints discretely (only triggers a setState on change)
            const newCount = THRESHOLDS.filter(th => progress >= th).length
            if (newCount !== prevCountRef.current) {
                prevCountRef.current = newCount
                setActiveCount(newCount)
            }

            rafId = requestAnimationFrame(tick)
        }
        rafId = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(rafId)
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

// ─── Main Ethos Section (3D) — busts + accent lights only ────────────────────
function EthosSection({ scrollRef }) {
    const groupRef = useRef()

    useFrame(() => {
        if (!groupRef.current) return
        const t = scrollRef.current ?? 0
        groupRef.current.visible = t >= ETHOS_ENTER - 0.03 && t <= ETHOS_EXIT + 0.03
    })

    return (
        <group ref={groupRef} position={ETHOS_POS}>
            <RotatingBust
                url="/me.glb"
                position={[6, 1.8, 1]}
                tiltAxis={[0.2, 0, 0.1]}
                rotSpeed={0.28}
                scale={4}
            />
            <RotatingBust
                url="/also-me.glb"
                position={[5.5, -1.6, -2.5]}
                tiltAxis={[-1, 0, -0.08]}
                rotSpeed={-0.2}
                scale={4}
            />
            <pointLight position={[7, 2, 2]} intensity={205} color="#6699ff" distance={12} decay={2} />
            <pointLight position={[4, -2, -1]} intensity={1.8} color="#ff3366" distance={9} decay={2} />
        </group>
    )
}

function ProjectsSection({ scrollRef }) {
    return (
        <group>
            <ProjectZoneGrid scrollRef={scrollRef} />
            {PROJECT_CARDS.map((config, i) => (
                <ProjectCard key={i} config={config} scrollRef={scrollRef} />
            ))}
        </group>
    )
}

// ─── Bio constants ────────────────────────────────────────────────────────────
const BIO_ENTER  = 0.86
const BIO_FULL   = 0.93
const BIO_CENTER = [140, 0, -35]

const PLACEHOLDER_IMAGES = [
    'https://picsum.photos/seed/bio1/600/900',
    'https://picsum.photos/seed/bio2/600/900',
    'https://picsum.photos/seed/bio3/600/900',
]

const DEBRIS_PIECES = [
    { startPos: [-20, 2, 8],   geo: 'oct', color: '#3366ff', speed: 2.8 },
    { startPos: [10, -3, 6],   geo: 'ico', color: '#2244cc', speed: 3.2 },
    { startPos: [30, 1, -4],   geo: 'box', color: '#1133aa', speed: 2.5 },
    { startPos: [70, 3, 10],   geo: 'oct', color: '#4455ff', speed: 3.8 },
    { startPos: [75, -2, -6],  geo: 'ico', color: '#3344ee', speed: 2.9 },
    { startPos: [100, 0, 4],   geo: 'oct', color: '#00aaff', speed: 4.2 },
    { startPos: [120, -1, 3],  geo: 'tor', color: '#ff3366', speed: 3.6 },
    { startPos: [140, 1, 5],   geo: 'ico', color: '#44ff88', speed: 4.8 },
    { startPos: [50, 4, -8],   geo: 'box', color: '#2255dd', speed: 3.1 },
    { startPos: [90, -4, 7],   geo: 'oct', color: '#1144bb', speed: 3.4 },
    { startPos: [110, 2, -5],  geo: 'ico', color: '#3355cc', speed: 2.7 },
    { startPos: [130, -3, 6],  geo: 'tor', color: '#0099ee', speed: 3.9 },
]

function DebrisPiece({ piece, progress, exploded }) {
    const meshRef = useRef()
    const posRef  = useRef(new THREE.Vector3(...piece.startPos))
    const scaleRef = useRef(0)

    const geometry = useMemo(() => {
        switch (piece.geo) {
            case 'oct': return new THREE.OctahedronGeometry(0.18, 0)
            case 'ico': return new THREE.IcosahedronGeometry(0.15, 0)
            case 'tor': return new THREE.TorusGeometry(0.14, 0.05, 6, 12)
            case 'box': return new THREE.BoxGeometry(0.22, 0.22, 0.22)
            default:    return new THREE.OctahedronGeometry(0.18, 0)
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
    const groupRef  = useRef()
    const photoRef  = useRef()
    const glassRef  = useRef()

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
    const targetPos  = useMemo(() => new THREE.Vector3(...worldPos), [worldPos])
    const opacityRef = useRef(0)
    const scaleRef   = useRef(0.3)

    // Per-shard slightly varied IOR — makes each piece feel unique
    const ior = useMemo(() => 1.45 + (index / totalShards) * 0.25, [index, totalShards])

    // UV-remapped photo geometry
    const photoGeo = useMemo(() => {
        const geo = new THREE.PlaneGeometry(worldSize[0], worldSize[1])
        const uvAttr = geo.attributes.uv
        const [u0, v0] = uvOffset
        const [uw, uh] = uvSize
        const uvMap = [[u0, v0+uh], [u0+uw, v0+uh], [u0, v0], [u0+uw, v0]]
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
            scaleRef.current   = dampValue(scaleRef.current, 1.0, 5, delta)
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
                <meshPhysicalMaterial
                    transparent opacity={0}
                    roughness={0.02} metalness={0}
                    ior={ior}
                    clearcoat={1.0} clearcoatRoughness={0.01}
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
                    uvSize:   [1 / COLS, 1 / ROWS],
                    worldPos: [(col + 0.5) * (SHARD_W + GAP) - totalW / 2, (ROWS - row - 0.5) * (SHARD_H + GAP) - totalH / 2, (Math.random() - 0.5) * 1.2],
                    worldSize: [SHARD_W, SHARD_H],
                    rotation: [(Math.random()-0.5)*0.12, (Math.random()-0.5)*0.08, (Math.random()-0.5)*0.06],
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
        if (light1Ref.current) { light1Ref.current.color.setHSL(h, 0.8, 0.5);              light1Ref.current.intensity = 8 + Math.sin(t * 0.7) * 3 }
        if (light2Ref.current) { light2Ref.current.color.setHSL((h+0.33)%1, 0.7, 0.4);    light2Ref.current.intensity = 6 + Math.sin(t * 0.5 + 1.2) * 2.5 }
        if (light3Ref.current) { light3Ref.current.color.setHSL((h+0.66)%1, 0.6, 0.35);   light3Ref.current.intensity = 4 + Math.sin(t * 0.9 + 2.4) * 2 }
    })

    if (!active) return null
    return (
        <>
            <pointLight ref={light1Ref} position={[-4, 3, 3]}  intensity={0} distance={14} decay={2} />
            <pointLight ref={light2Ref} position={[4, -2, 2]}  intensity={0} distance={12} decay={2} />
            <pointLight ref={light3Ref} position={[0, 0, -4]}  intensity={0} distance={10} decay={2} />
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

function ScrollBar({ scrollRef, currentSectionRef }) {
    const fillRef  = useRef()
    const dotRefs  = useRef([])
    const lblRefs  = useRef([])

    useEffect(() => {
        let raf
        const ACCENT = '#00aaff'
        const PAST   = '#1e3a66'
        const IDLE   = '#08111f'

        function loop() {
            const t      = scrollRef.current ?? 0
            const active = currentSectionRef.current ?? 0

            if (fillRef.current) fillRef.current.style.width = `${t * 100}%`

            dotRefs.current.forEach((dot, i) => {
                if (!dot) return
                const isActive = i === active
                const isPast   = SECTION_STOPS[i] < t + 0.01
                dot.style.background  = isActive ? ACCENT : isPast ? PAST : IDLE
                dot.style.borderColor = isActive ? ACCENT : isPast ? '#2a4a88' : '#182440'
                dot.style.boxShadow   = isActive ? `0 0 10px ${ACCENT}, 0 0 22px ${ACCENT}55` : isPast ? `0 0 5px #1e3a6688` : 'none'
                dot.style.transform   = `translate(-50%,-50%) rotate(45deg) scale(${isActive ? 1.6 : 1})`
            })

            lblRefs.current.forEach((lbl, i) => {
                if (!lbl) return
                const isActive = i === active
                lbl.style.color   = isActive ? ACCENT : '#2d4070'
                lbl.style.opacity = isActive ? '1' : '0.55'
            })

            raf = requestAnimationFrame(loop)
        }
        raf = requestAnimationFrame(loop)
        return () => cancelAnimationFrame(raf)
    }, [scrollRef, currentSectionRef])

    return (
        <div style={{
            position: 'absolute', bottom: '36px', left: '50%',
            transform: 'translateX(-50%)', width: 'min(660px, 68vw)',
            zIndex: 100, pointerEvents: 'none',
        }}>
            {/* End-cap left */}
            <div style={{ position: 'absolute', left: 0, top: '-5px', width: '1px', height: '11px', background: 'rgba(60,90,160,0.4)' }} />
            {/* End-cap right */}
            <div style={{ position: 'absolute', right: 0, top: '-5px', width: '1px', height: '11px', background: 'rgba(60,90,160,0.4)' }} />

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
                {SECTION_STOPS.map((stop, i) => (
                    <div key={i} style={{
                        position: 'absolute', left: `${stop * 100}%`, top: 0,
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
                            color: '#2d4070', fontFamily: 'monospace',
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

export function BioOverlay({ scrollRef }) {
    const wrapperRef = useRef()
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        let rafId
        const tick = () => {
            const t = scrollRef.current ?? 0
            const progress = Math.max(0, Math.min(1, (t - BIO_FULL) / 0.05))
            if (wrapperRef.current) wrapperRef.current.style.opacity = progress
            setVisible(t >= BIO_ENTER)
            rafId = requestAnimationFrame(tick)
        }
        rafId = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(rafId)
    }, [scrollRef])

    if (!visible) return null

    return (
        <div ref={wrapperRef} style={{ position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 40, opacity: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 8vw', boxSizing: 'border-box' }}>
            <div style={{ maxWidth: '340px', color: '#fff' }}>
                <div style={{ fontSize: '10px', letterSpacing: '4px', color: '#3366ff', marginBottom: '20px', fontFamily: 'monospace' }}>SYS://IDENTITY_RESOLVED</div>
                <h2 style={{ fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 900, letterSpacing: '6px', margin: '0 0 8px 0', textTransform: 'uppercase', lineHeight: 1 }}>MUSTAFA</h2>
                <div style={{ fontSize: '11px', letterSpacing: '3px', color: '#445577', marginBottom: '32px', fontFamily: 'monospace' }}>SENIOR PRODUCT DESIGNER · CREATIVE ENGINEER</div>
                <p style={{ fontSize: '14px', lineHeight: 1.8, color: '#8899bb', margin: '0 0 40px 0', fontFamily: 'monospace' }}>
                    I design systems that think and interfaces that feel inevitable. Five years building products at the intersection of craft and engineering — where the seams between form and function disappear.
                </p>
                <div style={{ width: '100%', height: '1px', background: 'linear-gradient(90deg, #3366ff, transparent)', marginBottom: '32px', opacity: 0.4 }} />
                <div style={{ display: 'flex', gap: '32px', pointerEvents: 'auto' }}>
                    {['RESUME', 'GITHUB', 'CONTACT'].map(label => (
                        <a key={label} href="#" style={{ fontSize: '11px', letterSpacing: '3px', color: '#fff', textDecoration: 'none', fontFamily: 'monospace', borderBottom: '1px solid #3366ff', paddingBottom: '3px', transition: 'color 0.2s' }}
                            onMouseEnter={e => e.target.style.color = '#3366ff'}
                            onMouseLeave={e => e.target.style.color = '#fff'}
                        >{label}</a>
                    ))}
                </div>
            </div>
        </div>
    )
}

function BioSection({ scrollRef }) {
    const groupRef = useRef()
    const [phase, setPhase] = useState('idle')
    const phaseRef = useRef('idle')
    const timerRef = useRef(0)

    useFrame((_, delta) => {
        if (!groupRef.current) return
        const t = scrollRef.current ?? 0
        groupRef.current.visible = t >= BIO_ENTER - 0.04

        if (t < BIO_ENTER - 0.04) {
            if (phaseRef.current !== 'idle') { phaseRef.current = 'idle'; setPhase('idle'); timerRef.current = 0 }
            return
        }

        timerRef.current += delta
        if (phaseRef.current === 'idle'     && t >= BIO_ENTER)          { phaseRef.current = 'debris';    setPhase('debris');    timerRef.current = 0 }
        if (phaseRef.current === 'debris'   && timerRef.current > 1.4)   { phaseRef.current = 'collapse';  setPhase('collapse');  timerRef.current = 0 }
        if (phaseRef.current === 'collapse' && timerRef.current > 0.4)   { phaseRef.current = 'appeared';  setPhase('appeared');  timerRef.current = 0 }
        if (phaseRef.current === 'appeared' && timerRef.current > 0.6)   { phaseRef.current = 'afterglow'; setPhase('afterglow') }
    })

    const debrisActive = ['debris', 'collapse'].includes(phase)
    const exploded     = ['appeared', 'afterglow'].includes(phase)
    const portraitOn   = ['appeared', 'afterglow'].includes(phase)
    const afterglowOn  = phase === 'afterglow'
    const flashActive  = phase === 'collapse'

    return (
        <group ref={groupRef} position={BIO_CENTER} visible={false}>
            {DEBRIS_PIECES.map((piece, i) => (
                <DebrisPiece key={i}
                    piece={{ ...piece, startPos: [piece.startPos[0]-BIO_CENTER[0], piece.startPos[1]-BIO_CENTER[1], piece.startPos[2]-BIO_CENTER[2]] }}
                    progress={debrisActive ? 1 : 0}
                    exploded={exploded}
                />
            ))}
            <CollapseFlash active={flashActive} />
            <group position={[-2.2, 0, 0]}>
                <FragmentedPortrait appeared={portraitOn} exploded={phase === 'collapse'} />
            </group>
            <RaveAfterglowLights active={afterglowOn} />
            <BioGrid active={afterglowOn} />
            {portraitOn && (
                <mesh position={[-2.2, 0, -0.5]}>
                    <planeGeometry args={[4, 7]} />
                    <meshBasicMaterial color="#0a0a20" transparent opacity={0.6} toneMapped={false} side={THREE.DoubleSide} />
                </mesh>
            )}
        </group>
    )
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. MAIN SCENE & APP EXPORT
// ═════════════════════════════════════════════════════════════════════════════

function Scene({ scrollRef, currentSectionRef }) {
    return (
        <>
            <ScrollSmoother currentSectionRef={currentSectionRef} scrollRef={scrollRef} />
            <CameraController scrollRef={scrollRef} />

            <ambientLight intensity={0.3} />
            <directionalLight position={[5, 5, 5]} intensity={1.5} color="#ffffff" />
            <directionalLight position={[-3, 3, -5]} intensity={0.4} color="#8888ff" />
            <Environment preset="night" />

            <EffectComposer disableNormalPass>
                <Bloom luminanceThreshold={0.5} mipmapBlur intensity={1.2} />
                <ChromaticAberration offset={warpOffset} />
                <Vignette eskil={false} offset={0.1} darkness={1.1} />
            </EffectComposer>

            <color attach="background" args={['#050510']} />
            <fog attach="fog" args={['#050510', 25, 60]} />

            <CursorFX />
            <InteractiveParticleField count={300} />

            <HeroSection />
            <SigilCorridor />
            <EthosSection scrollRef={scrollRef} />
            <ProjectsSection scrollRef={scrollRef} />
            <BioSection scrollRef={scrollRef} />
            
            <Stats />
        </>
    )
}

// EthosOverlay removed — ethos is now an in-scene 3D component (EthosSection)

export default function Portfolio() {
    const scrollRef = useRef(0)
    const currentSectionRef = useRef(0)

    useEffect(() => {
        return () => { document.body.style.cursor = 'auto' }
    }, [])

    // Wheel-to-section snapping — one section per gesture, locked until settled
    useEffect(() => {
        let wheelAccum = 0
        let locked = false

        const onWheel = (e) => {
            e.preventDefault()
            if (locked) return

            wheelAccum += e.deltaY

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

            {/* GLOBAL HUD */}
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 50, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '40px', boxSizing: 'border-box' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', color: '#fff', textTransform: 'uppercase', letterSpacing: '2px', fontSize: '12px' }}>
                    <div style={{ fontWeight: 'bold' }}>MUSTAFA // PORTFOLIO</div>
                    <div style={{ pointerEvents: 'auto' }}>
                        Building at <a href="#" target="_blank" style={{ color: '#ff3366', textDecoration: 'none' }}>YOUR COMPANY</a>
                    </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', color: '#8899cc', fontSize: '12px', letterSpacing: '1px' }}>
                    <div style={{ display: 'flex', gap: '20px', pointerEvents: 'auto' }}>
                        <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>RESUME</a>
                        <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>TWITTER</a>
                        <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>GITHUB</a>
                    </div>
                    <div style={{ pointerEvents: 'auto' }}>
                        <a href="mailto:hello@mustafa.com" style={{ color: '#fff', textDecoration: 'none' }}>HELLO@MUSTAFA.COM</a>
                    </div>
                </div>
            </div>

            <EthosOverlay scrollRef={scrollRef} />
            <BioOverlay scrollRef={scrollRef} />
            <ScrollBar scrollRef={scrollRef} currentSectionRef={currentSectionRef} />

            <Canvas camera={{ position: [0, 1, 16], fov: 70 }}>
                <React.Suspense fallback={null}>
                    <Scene scrollRef={scrollRef} currentSectionRef={currentSectionRef} />
                </React.Suspense>
            </Canvas>

        </div>
    )
}