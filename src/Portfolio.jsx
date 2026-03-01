import React, { useRef, useMemo, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useScroll, ScrollControls, Scroll } from '@react-three/drei'
import * as THREE from 'three'

// 🟢 Global warp offset for velocity-driven chromatic aberration
// eslint-disable-next-line react-refresh/only-export-components
export const warpOffset = new THREE.Vector2(0.002, 0.002)

// ═════════════════════════════════════════════════════════════════════════════
// 1. UTILITIES & MATH
// ═════════════════════════════════════════════════════════════════════════════

const clamp = (v, min, max) => Math.min(Math.max(v, min), max)

// ═════════════════════════════════════════════════════════════════════════════
// 2. 3D COMPONENTS
// ═════════════════════════════════════════════════════════════════════════════

function InteractiveParticleField({ count = 300 }) {
    const ref = useRef()
    const [basePositions, currentPositions, velocities] = useMemo(() => {
        const base = new Float32Array(count * 3)
        const current = new Float32Array(count * 3)
        const vel = new Float32Array(count * 3)
        for (let i = 0; i < count; i++) {
            // eslint-disable-next-line react-hooks/purity
            const x = Math.random() * 90 - 10
            // eslint-disable-next-line react-hooks/purity
            const y = (Math.random() - 0.5) * 30
            // eslint-disable-next-line react-hooks/purity
            const z = (Math.random() - 0.5) * 40
            base[i * 3] = current[i * 3] = x
            base[i * 3 + 1] = current[i * 3 + 1] = y
            base[i * 3 + 2] = current[i * 3 + 2] = z
        }
        return [base, current, vel]
    }, [count])

    useFrame((state) => {
        const points = ref.current
        if (!points) return
        const pos = points.geometry.attributes.position.array
        const mouse = state.mouse
        const raycaster = state.raycaster
        raycaster.setFromCamera(mouse, state.camera)

        for (let i = 0; i < count; i++) {
            const ix = i * 3, iy = i * 3 + 1, iz = i * 3 + 2
            const dx = pos[ix] - raycaster.ray.origin.x
            const dy = pos[iy] - raycaster.ray.origin.y
            const dz = pos[iz] - raycaster.ray.origin.z
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

            if (dist < 4) {
                const force = (4 - dist) / 4
                // eslint-disable-next-line react-hooks/immutability
                velocities[ix] = velocities[ix] + (dx / dist) * force * 0.15
                // eslint-disable-next-line react-hooks/immutability
                velocities[iy] = velocities[iy] + (dy / dist) * force * 0.15
                // eslint-disable-next-line react-hooks/immutability
                velocities[iz] = velocities[iz] + (dz / dist) * force * 0.15
            }

            // eslint-disable-next-line react-hooks/immutability
            velocities[ix] *= 0.95
            // eslint-disable-next-line react-hooks/immutability
            velocities[iy] *= 0.95
            // eslint-disable-next-line react-hooks/immutability
            velocities[iz] *= 0.95

            pos[ix] += velocities[ix] + (basePositions[ix] - pos[ix]) * 0.05
            pos[iy] += velocities[iy] + (basePositions[iy] - pos[iy]) * 0.05
            pos[iz] += velocities[iz] + (basePositions[iz] - pos[iz]) * 0.05
        }
        points.geometry.attributes.position.needsUpdate = true
    })

    return (
        <points ref={ref}>
            <bufferGeometry>
                <bufferAttribute attach="attributes-position" count={count} array={currentPositions} itemSize={3} />
            </bufferGeometry>
            <pointsMaterial size={0.05} color="#8899cc" transparent opacity={0.4} sizeAttenuation depthWrite={false} />
        </points>
    )
}

function ManifestoSection() {
    return null
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. CAMERA & CONTROLS
// ═════════════════════════════════════════════════════════════════════════════

function CameraController({ scrollRef }) {
    const scroll = useScroll()
    const { camera } = useThree()

    useFrame(() => {
        const t = scroll.offset
        if (scrollRef) scrollRef.current = t

        // Standard camera path based on scroll
        const startPos = new THREE.Vector3(0, 1, 16)
        const midPos = new THREE.Vector3(5, 2, 8)
        const endPos = new THREE.Vector3(0, 0, 4)

        if (t < 0.5) {
            camera.position.lerpVectors(startPos, midPos, t * 2)
        } else {
            camera.position.lerpVectors(midPos, endPos, (t - 0.5) * 2)
        }
        camera.lookAt(0, 0, 0)
    })

    return null
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. OVERLAYS & HTML
// ═════════════════════════════════════════════════════════════════════════════

function EthosOverlay() {
    const scroll = useScroll()
    const overlayRef = useRef()
    const contentRef = useRef()
    const prevOffsetRef = useRef(-1)

    useFrame(() => {
        const t = scroll.offset
        if (Math.abs(t - prevOffsetRef.current) < 0.0005) return
        prevOffsetRef.current = t

        if (overlayRef.current && contentRef.current) {
            // Fade in background 10% - 13%
            const bgIn = THREE.MathUtils.mapLinear(t, 0.10, 0.13, 0, 1)
            // Fade out background 23% - 25%
            const bgOut = THREE.MathUtils.mapLinear(t, 0.23, 0.25, 1, 0)
            const bgOpacity = Math.min(Math.max(bgIn, 0), 1) * Math.min(Math.max(bgOut, 0), 1)

            // Move text up 12% - 24%
            const yProgress = THREE.MathUtils.mapLinear(t, 0.12, 0.24, 0, 1)
            const translateY = THREE.MathUtils.lerp(100, -100, clamp(yProgress, 0, 1))

            overlayRef.current.style.opacity = bgOpacity
            overlayRef.current.style.pointerEvents = bgOpacity > 0.5 ? 'auto' : 'none'
            contentRef.current.style.transform = `translateY(${translateY}px)`
        }
    })

    return (
        <div
            ref={overlayRef}
            style={{
                position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh',
                background: 'rgba(5, 5, 16, 0.95)', color: '#fff', zIndex: 100,
                display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
                opacity: 0, pointerEvents: 'none'
            }}
        >
            <div ref={contentRef} style={{ maxWidth: '600px', textAlign: 'left', transform: 'translateY(100px)' }}>
                <h1 style={{ fontSize: '3rem', letterSpacing: '4px', marginBottom: '1rem' }}>MY ETHOS</h1>
                <p style={{ fontSize: '1.2rem', lineHeight: '1.8', color: '#8899cc' }}>
                    We do not build templates. We do not write boilerplate. We sculpt digital space.
                    The web is not a printed page; it is a physical environment waiting to be shaped.
                </p>
            </div>
        </div>
    )
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. MAIN SCENE & APP EXPORT
// ═════════════════════════════════════════════════════════════════════════════

function Scene({ scrollRef }) {
    return (
        <>
            <CameraController scrollRef={scrollRef} />

            <ambientLight intensity={0.3} />
            <directionalLight position={[5, 5, 5]} intensity={1.5} color="#ffffff" />

            <InteractiveParticleField count={400} />
            <ManifestoSection />

            {/* 3D Background Objects */}
            <mesh position={[0, 0, -10]}>
                <sphereGeometry args={[2, 32, 32]} />
                <meshStandardMaterial color="#223344" wireframe />
            </mesh>
        </>
    )
}

export default function Portfolio() {
    const scrollRef = useRef(0)

    useEffect(() => {
        return () => { document.body.style.cursor = 'auto' }
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

            <Canvas camera={{ position: [0, 1, 16], fov: 70 }}>
                <React.Suspense fallback={null}>
                    <ScrollControls pages={6} damping={0.2}>
                        <Scene scrollRef={scrollRef} />
                        <Scroll html style={{ width: '100vw', height: '100vh', pointerEvents: 'none' }}>
                            <EthosOverlay />
                        </Scroll>
                    </ScrollControls>
                </React.Suspense>
            </Canvas>
        </div>
    )
}
