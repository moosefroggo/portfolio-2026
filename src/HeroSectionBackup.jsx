// ═════════════════════════════════════════════════════════════════════════════
// BACKUP: Original Spine Vertebrae Hero Section
// ═════════════════════════════════════════════════════════════════════════════
// This was the original hero with animated spine letters.
// To restore: swap <WarehouseHeroSection /> → <SpineHeroSection /> in Scene
// and revert CAMERA_PATH[0] to: { t: 0.00, pos: [0, 1, 16], look: [0, 0, 0], fov: 70, roll: 0 }
// and Canvas camera to: camera={{ position: [0, 1, 16], fov: 70 }}

function SpineHeroSection() {
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

export default SpineHeroSection
