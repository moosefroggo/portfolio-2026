import React, { useRef, useMemo, useState, useEffect, useLayoutEffect, Suspense, Component } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Center, Text3D, useGLTF, Stats, useScroll, ScrollControls, Scroll, Environment, Html, Text } from '@react-three/drei'
import { EffectComposer, Bloom, ChromaticAberration, Noise, Vignette, SelectiveBloom, Selection, Select } from '@react-three/postprocessing'
import * as THREE from 'three'
import { Physics, RigidBody } from '@react-three/rapier'
import { useControls } from 'leva'

// --- CONSTANTS & CONFIG ---
export const warpOffset = new THREE.Vector2(0.002, 0.002)

const ETHOS_POS = [70, 0, -15]
const CAMERA_PATH = [
  { t: 0.00, pos: [-7, 2, 18], look: [0, 2, 0], fov: 60, roll: 0 },
  { t: 0.08, pos: [40, 0.3, 14], look: ETHOS_POS, fov: 64, roll: 0 },
  { t: 0.24, pos: [65, 0, 12], look: ETHOS_POS, fov: 60, roll: 0 },
  { t: 0.30, pos: [80, 0.5, 12], look: [80, 0, 0], fov: 68, roll: 0 },
  { t: 0.38, pos: [100, 0, 9], look: [100, 0, 0], fov: 62, roll: -1 },
  { t: 0.44, pos: [100, 0, 6], look: [100, 0, 0], fov: 52, roll: 0 },
  { t: 0.52, pos: [110, 0.3, 10], look: [110, 0, 0], fov: 60, roll: 1 },
  { t: 0.58, pos: [120, 0, 9], look: [120, 0, 0], fov: 58, roll: -0.5 },
  { t: 0.62, pos: [120, 0, 6], look: [120, 0, 0], fov: 52, roll: 0 },
  { t: 0.70, pos: [130, 0.3, 10], look: [130, 0, 0], fov: 60, roll: 0.5 },
  { t: 0.76, pos: [140, 0, 9], look: [140, 0, 0], fov: 58, roll: -0.5 },
  { t: 0.80, pos: [140, 0, 6], look: [140, 0, 0], fov: 52, roll: 0 },
  { t: 0.86, pos: [140, 0, -2], look: [140, -3.2, -30], fov: 54, roll: 0 },
  { t: 0.93, pos: [140, 0, -12], look: [140, -3.2, -30], fov: 52, roll: 0 },
  { t: 1.00, pos: [140, 0, -20], look: [140, -3.2, -30], fov: 50, roll: 0 },
  { t: 1.10, pos: [140, -3.2, -100], look: [140, -3.2, -110], fov: 36, roll: 0 },
]

const SECTION_STOPS = [0.00, 0.16, 0.44, 0.62, 0.96, 1.10]
const WHEEL_THRESHOLD = 60
const HERO_CONFIG = {
  letters: [
    { char: 'M', yOffset: 0, zOffset: 0 },
    { char: 'U', yOffset: 0, zOffset: 0 },
    { char: 'S', yOffset: 0, zOffset: 0 },
    { char: 'T', yOffset: 0, zOffset: 0 },
    { char: 'A', yOffset: 0, zOffset: 0 },
    { char: 'F', yOffset: 0, zOffset: 0 },
    { char: 'A', yOffset: 0, zOffset: 0 },
  ],
  spacing: 4.2,
  groupY: 2.8,
  targetFraction: 0.72,
  subtitleText: 'An endlessly curios product designer currently building AI-based leak protection system at Dell, and developing a SaaS capstone application at School of Information.',
  subtitleYOffset: -5.8,
  subtitleFontSize: 0.6,
  subtitleLetterSpacing: 0.15,
  spineRotationSpeed: 0,
}

// --- UTILS ---
const clamp = (val, min, max) => Math.max(min, Math.min(max, val))
const smoothstep = (x) => x * x * (3 - 2 * x)
const dampValue = (current, target, smoothing, delta) => THREE.MathUtils.damp(current, target, smoothing, delta)

// --- CORE ENGINE ---
const SCROLL_SMOOTHING = 3
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

  const activeCameraPath = useMemo(() => [
    { t: 0.00, pos: [0, 3, 16], look: [5, 0, 0], fov: 70, roll: 0 },
    ...CAMERA_PATH.slice(1)
  ], [])

  useFrame((state, delta) => {
    const t = scrollRef.current || 0
    const rawVelocity = Math.abs(t - prevScroll.current) / Math.max(delta, 0.001)
    prevScroll.current = t
    velocityRef.current = dampValue(velocityRef.current, clamp(rawVelocity * 40, 0, 1), 14, delta)

    let startIndex = 0
    for (let i = 0; i < activeCameraPath.length - 1; i++) {
      if (t >= activeCameraPath[i].t && t <= activeCameraPath[i + 1].t) { startIndex = i; break }
    }
    if (t >= activeCameraPath[activeCameraPath.length - 1].t) startIndex = activeCameraPath.length - 2

    const start = activeCameraPath[startIndex]
    const end = activeCameraPath[startIndex + 1]
    const localT = end.t > start.t ? (t - start.t) / (end.t - start.t) : 1
    const easeT = smoothstep(clamp(localT, 0, 1))

    _startPos.set(...start.pos); _endPos.set(...end.pos)
    _startLook.set(...start.look); _endLook.set(...end.look)
    _targetPos.lerpVectors(_startPos, _endPos, easeT)
    _targetLook.lerpVectors(_startLook, _endLook, easeT)

    const baseFov = THREE.MathUtils.lerp(start.fov, end.fov, easeT)
    const narrowFactor = Math.max(0, 1.6 - camera.aspect)
    const aspectBoost = narrowFactor * 30
    _targetPos.z += narrowFactor * 10
    const targetFov = baseFov + velocityRef.current * 12 + aspectBoost
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

// --- HERO COMPONENTS ---
function WritingSpineLetter({ points, sourceGeometry, material, position = [0, 0, 0], delay = 0, cogScale = 0.72 }) {
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
    if (state.clock.elapsedTime > delay) drawProgressRef.current = dampValue(drawProgressRef.current, 1, 5, delta)
    if (drawProgressRef.current > 0.99) offsetRef.current = dampValue(offsetRef.current, 0, 8, delta)
    else offsetRef.current = (offsetRef.current + delta * 0.5 * Math.max(0, 1 - drawProgressRef.current)) % 1

    const spacing = 1 / count
    for (let i = 0; i < count; i++) {
      const t = (i * spacing + offsetRef.current) % 1
      const raw = t * CACHE_STEPS
      const idx0 = Math.floor(raw)
      const frac = raw - idx0
      const p0 = posCache[idx0], p1 = posCache[Math.min(idx0 + 1, CACHE_STEPS)]
      const tan0 = tanCache[idx0], tan1 = tanCache[Math.min(idx0 + 1, CACHE_STEPS)]
      const px = p0.x + (p1.x - p0.x) * frac, py = p0.y + (p1.y - p0.y) * frac, pz = p0.z + (p1.z - p0.z) * frac
      const tx = tan0.x + (tan1.x - tan0.x) * frac, ty = tan0.y + (tan1.y - tan0.y) * frac, tz = tan0.z + (tan1.z - tan0.z) * frac
      dummyMatrix.position.set(px, py, pz)
      dummyMatrix.lookAt(px + tx, py + ty, pz + tz)
      dummyMatrix.rotateZ(t * Math.PI * 8 + state.clock.elapsedTime * HERO_CONFIG.spineRotationSpeed)
      if (t > drawProgressRef.current) dummyMatrix.scale.set(0, 0, 0)
      else dummyMatrix.scale.set(cogScale, cogScale, cogScale)
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

const v3 = (x, y, z = 0) => new THREE.Vector3(x, y, z)
const withZ = (pts, amp = 0.35) => pts.map((p, i) => new THREE.Vector3(p.x, p.y, Math.sin((i / Math.max(pts.length - 1, 1)) * Math.PI * 2) * amp))

const RAW_M = [v3(1.7244, -2), v3(1.7244, 2), v3(0, -1.8222), v3(-1.7244, 2), v3(-1.7244, -2)]
const RAW_U = [v3(-1.2978, 2.0296), v3(-1.2978, -0.5481), v3(-1.2044, -1.17), v3(-0.9415, -1.6252), v3(-0.5353, -1.9048), v3(0, -2), v3(0.5353, -1.9048), v3(0.9415, -1.6252), v3(1.2044, -1.17), v3(1.2978, -0.5481), v3(1.2978, 2.0296), v3(1.45, 2.0296)]
const RAW_S = [v3(-1.1141, -1.3541), v3(-0.9448, -1.62), v3(-0.6933, -1.8237), v3(-0.3707, -1.9541), v3(0.0119, -2), v3(0.4862, -1.9232), v3(0.8422, -1.7148), v3(1.066, -1.4075), v3(1.1437, -1.0341), v3(0.8039, -0.3555), v3(0.0563, 0.0615), v3(-0.6913, 0.4684), v3(-1.0311, 1.117), v3(-0.9624, 1.4571), v3(-0.757, 1.7489), v3(-0.4161, 1.9529), v3(0.0593, 2.0296), v3(0.4052, 1.9896), v3(0.68, 1.8785), v3(0.8859, 1.7096), v3(1.0252, 1.4963)]
const RAW_T0 = [v3(0, -2), v3(0, 1.9704)], RAW_T1 = [v3(-1.6, 1.9704), v3(1.9, 1.9704)]
const RAW_A0 = [v3(-1.09, -0.7378), v3(1.09, -0.7378)], RAW_A1 = [v3(1.6, -2), v3(0.8, 0), v3(0, 2), v3(-0.8, 0), v3(-1.6, -2)]
const RAW_F0 = [v3(-0.8, -2), v3(-0.8, 2), v3(1.2, 2)], RAW_F1 = [v3(-0.8, 0.1), v3(1.1, 0.1)]

const MUSTAFA_LETTERS_PATHS = {
  M: [withZ(RAW_M, 0.30)], U: [withZ(RAW_U, 0.28)], S: [withZ(RAW_S, 0.22)],
  T: [withZ(RAW_T0, 0.35), withZ(RAW_T1, 0.20)], A: [withZ(RAW_A0, 0.18), withZ(RAW_A1, 0.30)],
  F: [withZ(RAW_F0, 0.30), withZ(RAW_F1, 0.18)],
}

function SpineLetterHero({ char, sourceGeometry, material, position = [0, 0, 0], scale = 1, delay = 0, cogScale = 0.72 }) {
  const paths = MUSTAFA_LETTERS_PATHS[char] || MUSTAFA_LETTERS_PATHS.M
  return (
    <group position={position} scale={scale}>
      {paths.map((pts, idx) => <WritingSpineLetter key={idx} points={pts} sourceGeometry={sourceGeometry} material={material} delay={delay + idx * 0.4} cogScale={cogScale} />)}
    </group>
  )
}

function AnimatedSpotLightHero() {
  const spotRef = useRef()
  useFrame((state) => { if (spotRef.current) spotRef.current.position.x = Math.sin(state.clock.elapsedTime * 0.8) * 20 })
  return <spotLight ref={spotRef} position={[0, 12, 8]} angle={0.6} penumbra={0.3} intensity={150} color="#ffffff" castShadow decay={1} />
}

function SpineHeroSection() {
  const { size } = useThree()
  const { scene: spineScene } = useGLTF('/spine.glb')
  const spineGeometry = useMemo(() => {
    let mesh = null
    spineScene.traverse(child => { if (child.isMesh && !mesh) mesh = child })
    return mesh?.geometry ?? null
  }, [spineScene])
  const material = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#b8d6ff', metalness: 0.6, roughness: 0.02, clearcoat: 1.0, clearcoatRoughness: 0.0, emissive: '#0a1a33', emissiveIntensity: 0.4 }), [])

  const { letterScale, actualSpacing } = useMemo(() => {
    const cfg = HERO_CONFIG
    const visW = (2 * Math.tan(((70 * Math.PI) / 180) / 2) * 16) * (size.width / size.height)
    const scale = (visW * cfg.targetFraction) / ((cfg.letters.length - 1) * cfg.spacing)
    return { letterScale: scale, actualSpacing: cfg.spacing * scale }
  }, [size.width, size.height])

  if (!spineGeometry) return null
  const startX = -((HERO_CONFIG.letters.length - 1) / 2) * actualSpacing
  const responsiveXOffset = (size.width / size.height) > 1.5 ? 5 : 2

  return (
    <group position={[responsiveXOffset, HERO_CONFIG.groupY + 1.5, 0]}>
      {HERO_CONFIG.letters.map((l, i) => <SpineLetterHero key={i} char={l.char} sourceGeometry={spineGeometry} material={material} position={[startX + i * actualSpacing, l.yOffset * letterScale, l.zOffset]} scale={letterScale} delay={0.3 + i * 0.6} />)}
      <Html position={[0, HERO_CONFIG.subtitleYOffset * letterScale, 0]} center distanceFactor={1.2} style={{ width: '800px', textAlign: 'center', fontSize: `${HERO_CONFIG.subtitleFontSize * letterScale * 16}px`, color: '#aabbdd', fontFamily: 'Arial, sans-serif', lineHeight: '1.5', pointerEvents: 'none' }}>
        <div dangerouslySetInnerHTML={{ __html: HERO_CONFIG.subtitleText }} />
      </Html>
      <AnimatedSpotLightHero />
    </group>
  )
}


// ─── Error Boundary ────────────────────────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(error, errorInfo) { console.error('ErrorBoundary caught:', error, errorInfo) }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', color: '#fff', background: '#000', height: '100vh' }}>
          <h1>Something went wrong.</h1>
          <button onClick={() => window.location.reload()} style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}>Reload Page</button>
        </div>
      )
    }
    return this.props.children
  }
}


// ─── Neon Installation ──────────────────────────────────────────────────────────
function NeonInstallation() {
  const { neonY, neonZ, neonScale, bloomInt } = useControls('Neon Installation', {
    neonY: { value: 2, min: -20, max: 20, step: 0.1 },
    neonZ: { value: -30, min: -100, max: 0, step: 1 },
    neonScale: { value: 1.5, min: 0.1, max: 10, step: 0.1 },
    bloomInt: { value: 2, min: 0, max: 10, step: 0.1 },
  })

  return (
    <group position={[0, neonY, neonZ]} scale={neonScale}>
      <mesh>
        <torusKnotGeometry args={[10, 0.1, 300, 20, 2, 3]} />
        <meshStandardMaterial color="#00ffff" emissive="#00ffff" emissiveIntensity={bloomInt} />
      </mesh>
      <pointLight color="#00ffff" intensity={10} distance={50} />
    </group>
  )
}


// ─── Particle Field ─────────────────────────────────────────────────────────────
function ParticleField() {
  const count = 2000
  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 100
      pos[i * 3 + 1] = (Math.random() - 0.5) * 100
      pos[i * 3 + 2] = (Math.random() - 0.5) * 100
    }
    return pos
  }, [])

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.1} color="#ffffff" transparent opacity={0.4} sizeAttenuation />
    </points>
  )
}


// ─── Spine Model ───────────────────────────────────────────────────────────────
function SpineModel({ scrollRef }) {
  const { scene } = useGLTF('/spine.glb')
  const ref = useRef()

  useFrame((state, delta) => {
    if (ref.current) {
      const t = scrollRef.current || 0
      ref.current.rotation.y = t * Math.PI * 2
      ref.current.position.x = Math.sin(t * Math.PI) * 10
    }
  })

  return <primitive ref={ref} object={scene} position={[0, -5, -20]} scale={2} />
}


// ─── Components ──────────────────────────────────────────────────────────────
function EthosOverlay() { return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><h2 style={{ color: '#fff' }}>ETHOS</h2></div> }
function PortfolioOverlay() { return <div style={{ height: '200vh' }}><h2 style={{ color: '#fff', textAlign: 'center' }}>PORTFOLIO</h2></div> }
function HelloText({ isFallen, hasFallen }) { return <Text position={[0, 2, -5]} fontSize={1} color="#fff">{hasFallen ? 'ALIVE' : 'HELLO'}</Text> }


// ─── Scroll Camera Handler (Integrated) ──────────────────────────────────────
function ScrollCameraHandler({ isFallen, setIsFallen, setHasFallen, scrollRef, currentSectionRef }) {
  const { camera } = useThree()

  // Camera keyframes for each section
  const keyframes = useMemo(() => ({
    // Hero: front view
    heroPos: new THREE.Vector3(0, 0, 8),
    heroLook: new THREE.Vector3(0, 0, 0),
    // Fall: rotate to top-down
    fallPos: new THREE.Vector3(0, 12, -3),
    fallLook: new THREE.Vector3(0, 0, -4),
    // Work: settled overhead with slight drift
    workPos: new THREE.Vector3(0, 18, -5),
    workLook: new THREE.Vector3(0, 5, -8),
    // Resume: dive into the scene
    resumePos: new THREE.Vector3(2, 8, -12),
    resumeLook: new THREE.Vector3(0, 0, -18),
    // Bio: pull back to wide view
    bioPos: new THREE.Vector3(0, 3, -6),
    bioLook: new THREE.Vector3(0, 0, -10),
  }), [])

  const currentPos = useMemo(() => new THREE.Vector3(), [])
  const currentLook = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    const t = scrollRef.current

    // Physics trigger
    if (t > 0.06 && !isFallen) {
      setIsFallen(true)
      setHasFallen(true)
    } else if (t < 0.04 && isFallen) {
      setIsFallen(false)
    }

    // 5-stage camera interpolation
    if (t < 0.08) {
      const s = t / 0.08
      currentPos.lerpVectors(keyframes.heroPos, keyframes.heroPos, s)
      currentLook.lerpVectors(keyframes.heroLook, keyframes.heroLook, s)
    } else if (t < 0.15) {
      const s = (t - 0.08) / 0.07
      const ease = s * s * (3 - 2 * s) // smoothstep
      currentPos.lerpVectors(keyframes.heroPos, keyframes.fallPos, ease)
      currentLook.lerpVectors(keyframes.heroLook, keyframes.fallLook, ease)
    } else if (t < 0.45) {
      const s = (t - 0.15) / 0.30
      const ease = s * s * (3 - 2 * s)
      currentPos.lerpVectors(keyframes.fallPos, keyframes.workPos, ease)
      currentLook.lerpVectors(keyframes.fallLook, keyframes.workLook, ease)
    } else if (t < 0.75) {
      const s = (t - 0.45) / 0.30
      const ease = s * s * (3 - 2 * s)
      currentPos.lerpVectors(keyframes.workPos, keyframes.resumePos, ease)
      currentLook.lerpVectors(keyframes.workLook, keyframes.resumeLook, ease)
    } else {
      const s = (t - 0.75) / 0.25
      const ease = s * s * (3 - 2 * s)
      currentPos.lerpVectors(keyframes.resumePos, keyframes.bioPos, ease)
      currentLook.lerpVectors(keyframes.resumeLook, keyframes.bioLook, ease)
    }

    camera.position.copy(currentPos)
    camera.lookAt(currentLook)
  })

  return null
}


// --- SCENE ---
function Scene() {
  const [isFallen, setIsFallen] = useState(false)
  const [hasFallen, setHasFallen] = useState(false)
  const scrollProgressRef = useRef(0)
  const currentSectionRef = useRef(0)

  const {
    bloomIntensity, bloomThreshold, bloomRadius,
    aberration, noiseOpacity,
    vignetteDarkness, vignetteOffset,
  } = useControls('FX', {
    bloomIntensity: { value: 2.2, min: 0, max: 10, step: 0.1, label: 'Bloom Intensity' },
    bloomThreshold: { value: 0.30, min: 0, max: 1, step: 0.01, label: 'Bloom Threshold' },
    bloomRadius: { value: 0.9, min: 0, max: 1, step: 0.01, label: 'Bloom Radius' },
    aberration: { value: 0.003, min: 0, max: 0.02, step: 0.0005, label: 'Aberration' },
    noiseOpacity: { value: 0.09, min: 0, max: 0.5, step: 0.01, label: 'Noise Opacity' },
    vignetteDarkness: { value: 0.85, min: 0, max: 1, step: 0.01, label: 'Vignette Darkness' },
    vignetteOffset: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Vignette Offset' },
  })

  const { envMode, envPreset, envRotX, envRotY, envRotZ, envBlur, flatColor, gradientCenter, gradientEdge } = useControls('Environment', {
    envMode: {
      value: 'preset',
      options: { 'Preset (HDRI)': 'preset', 'Flat': 'flat', 'Gradient (Chrome)': 'gradient' },
      label: 'Mode',
    },
    envPreset: {
      value: 'studio',
      options: ['apartment', 'city', 'dawn', 'forest', 'lobby', 'night', 'park', 'studio', 'sunset', 'warehouse'],
      label: 'Preset',
    },
    flatColor: { value: '#ffffff', label: 'Flat Color' },
    gradientCenter: { value: '#ffffff', label: 'Gradient Center' },
    gradientEdge: { value: '#cccccc', label: 'Gradient Edge' },
    envRotX: { value: 0, min: -Math.PI, max: Math.PI, step: 0.01, label: 'Rotation X' },
    envRotY: { value: 0, min: -Math.PI, max: Math.PI, step: 0.01, label: 'Rotation Y' },
    envRotZ: { value: 0, min: -Math.PI, max: Math.PI, step: 0.01, label: 'Rotation Z' },
    envBlur: { value: 0, min: 0, max: 1, step: 0.01, label: 'Blur' },
  })

  const { fogNear, fogFar } = useControls('Fog', {
    fogNear: { value: 22, min: 0, max: 100, step: 1, label: 'Fog Near' },
    fogFar: { value: 70, min: 10, max: 400, step: 5, label: 'Fog Far' },
  })

  // Wheel-to-section snapping logic
  useEffect(() => {
    let wheelAccum = 0
    let locked = false
    const onWheel = (e) => {
      e.preventDefault()
      if (locked) return
      const normalized = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY
      wheelAccum += normalized
      if (wheelAccum >= WHEEL_THRESHOLD) {
        wheelAccum = 0; locked = true
        currentSectionRef.current = Math.min(currentSectionRef.current + 1, SECTION_STOPS.length - 1)
        setTimeout(() => { locked = false }, 800)
      } else if (wheelAccum <= -WHEEL_THRESHOLD) {
        wheelAccum = 0; locked = true
        currentSectionRef.current = Math.max(currentSectionRef.current - 1, 0)
        setTimeout(() => { locked = false }, 800)
      }
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <>
      <Stats />
      <fog attach="fog" args={['#000000', fogNear, fogFar]} />
      <color attach="background" args={['#050510']} />
      <AtmosphericLighting scrollRef={scrollProgressRef} />
      {envMode === 'flat' ? (
        <Environment resolution={64} background={false}>
          <mesh scale={100}>
            <sphereGeometry />
            <meshBasicMaterial color={flatColor} side={THREE.BackSide} />
          </mesh>
        </Environment>
      ) : envMode === 'gradient' ? (
        <Environment resolution={64} background={false}>
          <RadialGradientEnvironment centerColor={gradientCenter} edgeColor={gradientEdge} />
        </Environment>
      ) : (
        <Environment preset={envPreset} background={false} rotation={[envRotX, envRotY, envRotZ]} blur={envBlur} />
      )}
      <ParticleField />
      <NeonInstallation />

      <Suspense fallback={null}>
        <SpineModel scrollRef={scrollProgressRef} />
      </Suspense>

      <Suspense fallback={null}>
        <ScrollSmoother currentSectionRef={currentSectionRef} scrollRef={scrollProgressRef} />
        <CameraController scrollRef={scrollProgressRef} />
        <SpineHeroSection />
      </Suspense>

      <Physics gravity={[0, -30, 0]} paused={!isFallen}>
        <ScrollCameraHandler isFallen={isFallen} setIsFallen={setIsFallen} setHasFallen={setHasFallen} scrollRef={scrollProgressRef} currentSectionRef={currentSectionRef} />

        <Suspense fallback={null}>
          <HelloText isFallen={isFallen} hasFallen={hasFallen} />
        </Suspense>

        <EthosOverlay />
        <PortfolioOverlay />

        <RigidBody type="fixed" position={[0, -30, 0]}>
          <mesh>
            <boxGeometry args={[50, 1, 50]} />
            <meshBasicMaterial visible={false} />
          </mesh>
        </RigidBody>
      </Physics>

      <EffectComposer disableNormalPass>
        <SelectiveBloom luminanceThreshold={0.4} intensity={1.6} levels={4} />
        <ChromaticAberration offset={warpOffset} />
        <Noise opacity={noiseOpacity} />
        <Vignette eskil={false} offset={vignetteOffset} darkness={vignetteDarkness} />
      </EffectComposer>
    </>
  )
}


// --- LIGHTING ---
function AtmosphericLighting({ scrollRef }) {
  const spotRef = useRef()
  const rimRef = useRef()

  const {
    spotColor, spotBase, spotPulse, spotAngle, spotPenumbra, spotDistance, spotDecay,
    spotX, spotY, spotZ,
    rimColor, rimBase, rimPulse,
    rimX, rimY, rimZ,
    catchColor, catchIntensity, catchDistance,
    redColor, redIntensity, redX, redY, redZ, redDistance,
    ambientColor, ambientIntensity,
    underColor, underIntensity,
  } = useControls('Lighting', {
    spotColor: { value: '#ddeeff', label: 'Spot Color' },
    spotBase: { value: 28, min: 0, max: 100, step: 1, label: 'Spot Base' },
    spotPulse: { value: 4, min: 0, max: 20, step: 0.5, label: 'Spot Pulse Amp' },
    spotAngle: { value: 0.12, min: 0.01, max: 1.0, step: 0.005, label: 'Spot Angle' },
    spotPenumbra: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Spot Penumbra' },
    spotDistance: { value: 65, min: 10, max: 200, step: 5, label: 'Spot Distance' },
    spotDecay: { value: 1.6, min: 0, max: 5, step: 0.1, label: 'Spot Decay' },
    spotX: { value: 0, min: -20, max: 20, step: 0.5, label: 'Spot X' },
    spotY: { value: 16, min: 0, max: 40, step: 0.5, label: 'Spot Y' },
    spotZ: { value: 3, min: -10, max: 20, step: 0.5, label: 'Spot Z' },
    rimColor: { value: '#1a3aaa', label: 'Rim Color' },
    rimBase: { value: 5, min: 0, max: 40, step: 0.5, label: 'Rim Base' },
    rimPulse: { value: 1, min: 0, max: 10, step: 0.5, label: 'Rim Pulse Amp' },
    rimX: { value: 0, min: -20, max: 20, step: 0.5, label: 'Rim X' },
    rimY: { value: 4, min: -10, max: 20, step: 0.5, label: 'Rim Y' },
    rimZ: { value: -16, min: -40, max: 0, step: 0.5, label: 'Rim Z' },
    catchColor: { value: '#c0d0e8', label: 'Catch Color' },
    catchIntensity: { value: 3, min: 0, max: 40, step: 0.5, label: 'Catch Intensity' },
    catchDistance: { value: 30, min: 5, max: 100, step: 5, label: 'Catch Distance' },
    redColor: { value: '#cc1122', label: 'Red Fill Color' },
    redIntensity: { value: 5, min: 0, max: 50, step: 0.5, label: 'Red Fill Intensity' },
    redX: { value: -10, min: -30, max: 30, step: 0.5, label: 'Red Fill X' },
    redY: { value: 1, min: -10, max: 20, step: 0.5, label: 'Red Fill Y' },
    redZ: { value: 6, min: -20, max: 20, step: 0.5, label: 'Red Fill Z' },
    redDistance: { value: 25, min: 5, max: 100, step: 5, label: 'Red Fill Distance' },
    ambientColor: { value: '#050510', label: 'Ambient Color' },
    ambientIntensity: { value: 0.04, min: 0, max: 2, step: 0.01, label: 'Ambient Intensity' },
    underColor: { value: '#0a0a2a', label: 'Under Fill Color' },
    underIntensity: { value: 4, min: 0, max: 20, step: 0.5, label: 'Under Fill Intensity' },
  })

  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    const scrollT = scrollRef?.current ?? 0
    let spotMult = 1.0
    let pulseMult = 1.0

    if (scrollT > 0.14) {
      const flatProgress = THREE.MathUtils.clamp((scrollT - 0.14) / 0.06, 0, 1)
      spotMult = THREE.MathUtils.lerp(1.0, 0.60, flatProgress)
      pulseMult = THREE.MathUtils.lerp(1.0, 0.0, flatProgress)
    }
    if (scrollT > 0.75) {
      const neutralProgress = THREE.MathUtils.clamp((scrollT - 0.75) / 0.10, 0, 1)
      spotMult = THREE.MathUtils.lerp(0.60, 0.35, neutralProgress)
    }

    const spotPulseVal = pulseMult > 0 ? Math.sin(t * 0.35) * spotPulse * pulseMult : 0
    const rimPulseVal = pulseMult > 0 ? Math.sin(t * 0.25 + 1.5) * rimPulse * pulseMult : 0
    if (spotRef.current) spotRef.current.intensity = (spotBase + spotPulseVal) * spotMult
    if (rimRef.current) rimRef.current.intensity = (rimBase + rimPulseVal) * spotMult
  })

  return (
    <>
      <ambientLight intensity={ambientIntensity} color={ambientColor} />
      <spotLight
        ref={spotRef}
        position={[spotX, spotY, spotZ]}
        target-position={[0, 0, -2]}
        color={spotColor}
        intensity={spotBase}
        angle={spotAngle}
        penumbra={spotPenumbra}
        distance={spotDistance}
        decay={spotDecay}
        castShadow={false}
      />
      <pointLight ref={rimRef} position={[rimX, rimY, rimZ]} color={rimColor} intensity={rimBase} distance={40} decay={2} />
      <pointLight position={[0, -6, 2]} color={underColor} intensity={underIntensity} distance={20} decay={2} />
      <pointLight position={[12, 0, 0]} color={catchColor} intensity={catchIntensity} distance={catchDistance} decay={2} />
      <pointLight position={[-12, 0, 0]} color={catchColor} intensity={catchIntensity} distance={catchDistance} decay={2} />
      <pointLight position={[redX, redY, redZ]} color={redColor} intensity={redIntensity} distance={redDistance} decay={2} />
    </>
  )
}


// --- ROBOT ARM ---
function RobotArm({ scrollRef }) {
  const { scene, nodes } = useGLTF('/Robot%20Arm.glb')
  const groupRef = useRef()
  const liftRef = useRef(0)

  const {
    posX, posY, posZ, armScale, rotY,
    upperArmTarget, elbowTarget, handTarget,
    fingerCurl, thumbCurl, liftAmount,
  } = useControls('Robot Arm', {
    posX: { value: 3, min: -15, max: 15, step: 0.1, label: 'X' },
    posY: { value: -14, min: -25, max: 5, step: 0.1, label: 'Y (base)' },
    posZ: { value: -12, min: -25, max: 0, step: 0.5, label: 'Z' },
    armScale: { value: 3, min: 0.1, max: 10, step: 0.1, label: 'Scale' },
    rotY: { value: 0.3, min: -Math.PI, max: Math.PI, step: 0.01, label: 'Rotation Y' },
    upperArmTarget: { value: -1.1, min: -Math.PI, max: Math.PI, step: 0.01, label: 'Upperarm X' },
    elbowTarget: { value: 0.5, min: -Math.PI, max: Math.PI, step: 0.01, label: 'Elbow X' },
    handTarget: { value: 0.7, min: -Math.PI, max: Math.PI, step: 0.01, label: 'Hand X (palm up)' },
    fingerCurl: { value: 0.35, min: -1, max: 2, step: 0.01, label: 'Finger Curl' },
    thumbCurl: { value: 0.25, min: -1.5, max: 1.5, step: 0.01, label: 'Thumb Spread' },
    liftAmount: { value: 8, min: 0, max: 20, step: 0.1, label: 'Lift Amount' },
  })

  useMemo(() => {
    if (nodes['Arm.001']) nodes['Arm.001'].frustumCulled = false
  }, [nodes])

  const fingerBones = useMemo(() => [
    nodes['Index 1'], nodes['Index 2'], nodes['Index 3'],
    nodes['Middle 1'], nodes['Middle 2'], nodes['Middle 3'],
    nodes['Ring 1'], nodes['Ring 2'], nodes['Ring 3'],
    nodes['Little 1'], nodes['Little 2'], nodes['Little 3'],
  ].filter(Boolean), [nodes])

  useFrame((_, delta) => {
    const t = scrollRef?.current ?? 0
    const progress = THREE.MathUtils.clamp((t - 0.78) / 0.12, 0, 1)
    const ease = progress * progress * (3 - 2 * progress)
    liftRef.current = THREE.MathUtils.damp(liftRef.current, ease * liftAmount, 3, delta)
    if (groupRef.current) groupRef.current.position.y = posY + liftRef.current

    if (nodes['Upperarm']) nodes['Upperarm'].rotation.x = THREE.MathUtils.damp(nodes['Upperarm'].rotation.x, ease * upperArmTarget, 4, delta)
    if (nodes['Elbow']) nodes['Elbow'].rotation.x = THREE.MathUtils.damp(nodes['Elbow'].rotation.x, ease * elbowTarget, 4, delta)
    if (nodes['Hand']) nodes['Hand'].rotation.x = THREE.MathUtils.damp(nodes['Hand'].rotation.x, ease * handTarget, 4, delta)
    fingerBones.forEach(bone => { bone.rotation.x = THREE.MathUtils.damp(bone.rotation.x, ease * fingerCurl, 4, delta) })
    if (nodes['Thumb 1']) nodes['Thumb 1'].rotation.z = THREE.MathUtils.damp(nodes['Thumb 1'].rotation.z, ease * thumbCurl, 4, delta)
    if (nodes['Thumb 2']) nodes['Thumb 2'].rotation.z = THREE.MathUtils.damp(nodes['Thumb 2'].rotation.z, ease * thumbCurl * 0.6, 4, delta)
  })

  return (
    <group ref={groupRef} position={[posX, posY, posZ]} rotation={[0, rotY, 0]} scale={armScale}>
      <primitive object={scene} />
    </group>
  )
}


function RadialGradientEnvironment({ centerColor, edgeColor }) {
  const shaderRef = useRef()
  useFrame(() => {
    if (shaderRef.current?.material?.uniforms) {
      shaderRef.current.material.uniforms.uCenterColor.value.set(centerColor)
      shaderRef.current.material.uniforms.uEdgeColor.value.set(edgeColor)
    }
  })
  const shader = useMemo(() => ({
    uniforms: {
      uCenterColor: { value: new THREE.Color(centerColor) },
      uEdgeColor: { value: new THREE.Color(edgeColor) },
    },
    vertexShader: `varying vec3 vPosition; void main() { vPosition = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uCenterColor; uniform vec3 uEdgeColor; varying vec3 vPosition; void main() { float radial = length(vPosition.xy); vec3 color = mix(uCenterColor, uEdgeColor, radial); gl_FragColor = vec4(color, 1.0); }`
  }), [centerColor, edgeColor])
  return (
    <mesh ref={shaderRef} scale={100}>
      <sphereGeometry args={[1, 32, 32]} />
      <shaderMaterial {...shader} side={THREE.BackSide} depthWrite={false} />
    </mesh>
  )
}


// --- APP ---
export default function App() {
  return (
    <ErrorBoundary>
      <div style={{ width: '100vw', height: '100vh', background: '#050510', overflow: 'hidden' }}>
        <Canvas camera={{ position: [0, -4, 14], fov: 65 }} gl={{ antialias: true }} dpr={[1, 1.5]}>
          <Selection>
            <Scene />
          </Selection>
        </Canvas>
      </div>
    </ErrorBoundary>
  )
}

useGLTF.preload('/spine.glb')
useGLTF.preload('/Robot%20Arm.glb')
