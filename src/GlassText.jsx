import React, { useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text, Text3D } from '@react-three/drei'
import * as THREE from 'three'
import { useControls } from 'leva'

const SUBTITLE_FONT = '/fonts/Oxanium-VariableFont_wght.ttf'

const HERO_CONFIG = {
    subtitleText: 'An endlessly curios product designer currently building AI-based leak protection system at Dell, and developing a SaaS capstone application at School of Information.',
}

export function AnimatedChromeText({ text = "MUSTAFA" }) {
    const groupRef = useRef()
    const meshesRef = useRef([])
    const originalPositionsRef = useRef([])
    const stateRef = useRef({ animProgress: 0 })

    const { bendAmount, glassOpacity, glassIOR, glassTransmission, glassRoughness, dispersion } = useControls('Chrome Text Glass', {
        bendAmount: { value: 0.15, min: 0, max: 1, step: 0.05 },
        glassOpacity: { value: 0.92, min: 0, max: 1, step: 0.02 },
        glassIOR: { value: 1.8, min: 1, max: 3, step: 0.1 },
        glassTransmission: { value: 1.0, min: 0, max: 1, step: 0.05 },
        glassRoughness: { value: 0.05, min: 0, max: 0.3, step: 0.02 },
        dispersion: { value: 0.02, min: 0, max: 0.2, step: 0.01 },
    })

    // Capture original geometry positions on first render
    useEffect(() => {
        if (!groupRef.current) return
        meshesRef.current = []
        originalPositionsRef.current = []

        groupRef.current.traverse(child => {
            if (child.isMesh && child.geometry) {
                meshesRef.current.push(child)
                const pos = child.geometry.attributes.position.array.slice()
                originalPositionsRef.current.push(new Float32Array(pos))
            }
        })
    }, [])

    useFrame((state, delta) => {
        stateRef.current.animProgress = Math.min(stateRef.current.animProgress + delta * 1.25, 1)
        const progress = stateRef.current.animProgress

        if (!groupRef.current) return

        const formProgress = Math.min(progress / 0.5, 1)

        if (progress < 0.5) {
            const easeIn = formProgress * formProgress
            groupRef.current.scale.set(easeIn, easeIn, easeIn)
        } else {
            groupRef.current.scale.set(1, 1, 1)
            const floatOffset = Math.sin(state.clock.elapsedTime * 1.2) * 0.3
            groupRef.current.position.y = floatOffset

            // Apply beam bend to geometry
            const bendFactor = bendAmount * Math.sin(state.clock.elapsedTime * 1.5)

            meshesRef.current.forEach((mesh, meshIdx) => {
                if (!mesh.geometry.attributes.position) return

                const positions = mesh.geometry.attributes.position
                const originalPos = originalPositionsRef.current[meshIdx]

                for (let i = 0; i < originalPos.length; i += 3) {
                    const x = originalPos[i]
                    const y = originalPos[i + 1]
                    const z = originalPos[i + 2]

                    // Parabolic bend: center (x=0) bows out, edges curve back
                    const normalizedX = x / 10 // Normalize to -1 to 1 range
                    const bendDeformation = bendFactor * (1 - normalizedX * normalizedX)

                    positions.array[i] = x
                    positions.array[i + 1] = y
                    positions.array[i + 2] = z + bendDeformation
                }
                positions.needsUpdate = true
            })
        }
    })

    return (
        <group ref={groupRef} position={[-8, 2, 0]}>
            {/* Background to show glass transparency */}
            <mesh position={[0, 0, -5]}>
                <planeGeometry args={[40, 20]} />
                <meshStandardMaterial
                    color="#1a3a5c"
                    emissive="#0066ff"
                    emissiveIntensity={0.4}
                    metalness={0.4}
                    roughness={0.6}
                />
            </mesh>

            {/* Premium lighting for high-end glass look */}
            <pointLight position={[10, 5, 8]} intensity={2} color="#ffffff" />
            <pointLight position={[-15, 8, 5]} intensity={1.5} color="#6699ff" />
            <pointLight position={[0, -5, 10]} intensity={1.2} color="#ff9944" />

            {/* Floating light orbs to show refraction */}
            <mesh position={[5, 3, -8]}>
                <sphereGeometry args={[0.6, 32, 32]} />
                <meshStandardMaterial
                    emissive="#00ff88"
                    emissiveIntensity={1.5}
                    color="#00ff88"
                />
            </mesh>
            <mesh position={[-15, -2, -8]}>
                <sphereGeometry args={[0.5, 32, 32]} />
                <meshStandardMaterial
                    emissive="#ff0088"
                    emissiveIntensity={1.3}
                    color="#ff0088"
                />
            </mesh>
            <mesh position={[8, -4, -10]}>
                <sphereGeometry args={[0.4, 32, 32]} />
                <meshStandardMaterial
                    emissive="#44ff44"
                    emissiveIntensity={1.4}
                    color="#44ff44"
                />
            </mesh>

            <Text3D
                font="/fonts/MD Nichrome/MD Nichrome_Bold.json"
                size={4.5}
                height={0.8}
                curveSegments={12}
                bevelEnabled
                bevelThickness={0.05}
                bevelSize={0.04}
                bevelSegments={6}
                letterSpacing={0.15}
            >
                {text}
                <meshPhysicalMaterial
                    color="#ffffff"
                    transparent
                    opacity={glassOpacity}
                    metalness={0.0}
                    roughness={glassRoughness}
                    clearcoat={0.8}
                    clearcoatRoughness={0.02}
                    ior={glassIOR + dispersion * 0.5}
                    transmission={glassTransmission}
                    envMapIntensity={3.5 + dispersion * 2}
                    toneMapped={false}
                    side={THREE.DoubleSide}
                    onBeforeCompile={(shader) => {
                        shader.uniforms.dispersion = { value: dispersion }
                        shader.fragmentShader = shader.fragmentShader.replace(
                            '#include <output_fragment>',
                            `
                            vec3 dispersed = outgoingLight;
                            dispersed.r += sin(dispersed.r * 3.14159 + dispersion * 10.0) * dispersion * 0.1;
                            dispersed.b -= cos(dispersed.b * 3.14159 + dispersion * 8.0) * dispersion * 0.08;
                            outgoingLight = dispersed;
                            #include <output_fragment>
                            `
                        )
                    }}
                />
            </Text3D>
        </group>
    )
}

export function WarehouseHeroSection() {
    return (
        <group position={[0, 2, 0]}>
            {/* ── Animated chrome text with arc formation and float ── */}
            <AnimatedChromeText text="MUSTAFA" />

            {/* Subtitle */}
            <Text position={[0, -3.5, 0]} font={SUBTITLE_FONT} fontSize={0.55}
                anchorX="center" anchorY="middle" letterSpacing={0.18}
                color="#555555" material-toneMapped={false}>
                {HERO_CONFIG.subtitleText}
            </Text>

            {/* ── WAREHOUSE: Simple clean setup ── */}

            {/* Floor - large polished surface */}
            <mesh position={[0, -2, 0]} receiveShadow>
                <boxGeometry args={[150, 0.5, 150]} />
                <meshStandardMaterial color="#2a2a2a" metalness={0.8} roughness={0.2} envMapIntensity={3.0} />
            </mesh>

            {/* Left wall */}
            <mesh position={[-50, 5, 0]} castShadow receiveShadow>
                <boxGeometry args={[2, 25, 150]} />
                <meshStandardMaterial color="#1a1a1a" metalness={0.3} roughness={0.7} />
            </mesh>

            {/* Right wall */}
            <mesh position={[50, 5, 0]} castShadow receiveShadow>
                <boxGeometry args={[2, 25, 150]} />
                <meshStandardMaterial color="#1a1a1a" metalness={0.3} roughness={0.7} />
            </mesh>

            {/* Back wall */}
            <mesh position={[0, 5, -60]} castShadow receiveShadow>
                <boxGeometry args={[100, 25, 2]} />
                <meshStandardMaterial color="#0f0f0f" metalness={0.2} roughness={0.8} />
            </mesh>

            {/* Ceiling */}
            <mesh position={[0, 14, 0]} receiveShadow>
                <boxGeometry args={[100, 1, 150]} />
                <meshStandardMaterial color="#0a0a0a" metalness={0.5} roughness={0.5} />
            </mesh>

            {/* Support pillars */}
            {[[-35, 5, -30], [35, 5, -30], [-35, 5, 30], [35, 5, 30]].map((pos, i) => (
                <mesh key={`pillar-${i}`} position={pos} castShadow receiveShadow>
                    <cylinderGeometry args={[2, 2, 17, 8]} />
                    <meshStandardMaterial color="#1a1a1a" metalness={0.4} roughness={0.6} />
                </mesh>
            ))}

            {/* Dramatic main spotlight */}
            <spotLight position={[0, 16, 8]} angle={0.6} penumbra={0.2} intensity={250} color="#ffffff" castShadow shadow-mapSize-width={4096} shadow-mapSize-height={4096} decay={1} />

            {/* Side accent lights */}
            <spotLight position={[-40, 12, 0]} angle={0.4} penumbra={0.3} intensity={50} color="#5577ff" castShadow />
            <spotLight position={[40, 12, 0]} angle={0.4} penumbra={0.3} intensity={50} color="#ff7755" castShadow />
        </group>
    )
}
