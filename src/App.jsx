import { useRef, useMemo, useState, useEffect, useLayoutEffect, Suspense, Component } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Center, Text3D, useGLTF, Stats, useScroll, ScrollControls, Scroll, Environment } from '@react-three/drei'
import { EffectComposer, Bloom, ChromaticAberration, Noise, Vignette } from '@react-three/postprocessing'
import { Vector2 } from 'three'
import { Physics, RigidBody } from '@react-three/rapier'

import { useControls } from 'leva'
import * as THREE from 'three'
import { useLoader } from '@react-three/fiber'


// ─── Error Boundary ────────────────────────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    console.warn('Canvas error caught:', error.message)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          onClick={() => this.setState({ hasError: false })}
          style={{
            width: '100vw', height: '100vh', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            background: '#000', color: '#fff', cursor: 'pointer',
            fontFamily: 'system-ui', fontSize: '14px', flexDirection: 'column', gap: '8px',
          }}
        >
          <span style={{ fontSize: '24px' }}>⚡</span>
          <span>WebGL context lost — click to reload</span>
        </div>
      )
    }
    return this.props.children
  }
}



// ─── Spine Path (single instanced spine along a curve) ─────────────────────────
function SpinePath({ geometry, material, points, gap = 0, speed = 0.02, speedRef, scale = 1.5, direction = 1 }) {
  const instancedRef = useRef()
  const curveRef = useRef(null)
  const offsetRef = useRef(0)
  const countRef = useRef(0)
  const dummyMatrix = useMemo(() => new THREE.Object3D(), [])

  const CACHE_STEPS = 256

  const { count, posCache, tanCache, curve } = useMemo(() => {
    if (!geometry) return { count: 0, posCache: [], tanCache: [], curve: null }
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5)

    const curveLength = curve.getLength()
    geometry.computeBoundingBox()
    const bbox = geometry.boundingBox
    const size = new THREE.Vector3()
    bbox.getSize(size)
    const linkLength = Math.max(size.x, size.y, size.z)
    const c = Math.ceil(curveLength / (linkLength + gap))

    // Pre-bake CACHE_STEPS+1 samples (0 … 1 inclusive) so idx1 never wraps
    // to the start of a non-closed curve and sends instances flying
    const posCache = []
    const tanCache = []
    for (let i = 0; i <= CACHE_STEPS; i++) {
      const t = i / CACHE_STEPS
      posCache.push(curve.getPointAt(t))
      tanCache.push(curve.getTangentAt(t))
    }
    return { count: c, posCache, tanCache, curve }
  }, [geometry, points, gap])

  useLayoutEffect(() => {
    curveRef.current = curve
    countRef.current = count
  }, [curve, count])

  useFrame((_, delta) => {
    const instanced = instancedRef.current
    const n = countRef.current
    if (!instanced || n === 0 || posCache.length === 0) return

    const effectiveSpeed = speedRef ? speedRef.current : speed
    offsetRef.current = (offsetRef.current + delta * effectiveSpeed * direction) % 1
    if (offsetRef.current < 0) offsetRef.current += 1
    const spacing = 1 / n

    for (let i = 0; i < n; i++) {
      const t = (i * spacing + offsetRef.current) % 1
      const raw = t * CACHE_STEPS          // always in [0, CACHE_STEPS)
      const idx0 = Math.floor(raw)         // 0 … CACHE_STEPS-1
      const idx1 = idx0 + 1               // 1 … CACHE_STEPS — safe, array has CACHE_STEPS+1 entries
      const frac = raw - idx0

      // Lerp between adjacent cache samples — eliminates stepping at slow speeds
      const p0 = posCache[idx0], p1 = posCache[idx1]
      const tan0 = tanCache[idx0], tan1 = tanCache[idx1]
      const px = p0.x + (p1.x - p0.x) * frac
      const py = p0.y + (p1.y - p0.y) * frac
      const pz = p0.z + (p1.z - p0.z) * frac
      const tx = tan0.x + (tan1.x - tan0.x) * frac
      const ty = tan0.y + (tan1.y - tan0.y) * frac
      const tz = tan0.z + (tan1.z - tan0.z) * frac

      dummyMatrix.position.set(px, py, pz)
      dummyMatrix.lookAt(px + tx, py + ty, pz + tz)
      dummyMatrix.rotateX(Math.PI)
      dummyMatrix.rotateZ(t * Math.PI * 4 + offsetRef.current * Math.PI * 2)
      dummyMatrix.updateMatrix()
      instanced.setMatrixAt(i, dummyMatrix.matrix)
    }
    instanced.instanceMatrix.needsUpdate = true
  })

  if (!geometry || count === 0) return null

  return (
    <group scale={scale}>
      <instancedMesh
        ref={instancedRef}
        args={[geometry, material, count]}
        frustumCulled={false}
      />
    </group>
  )
}


// ─── Spine Model (dual paths: back + front) ────────────────────────────────────
function SpineModel({ gap = 0, scrollRef }) {
  const { scene: glbScene, nodes } = useGLTF('/spine.glb')

  const spineGroupRef = useRef()
  const animSpeedRef = useRef(0.02)

  // ── Controls ──
  const { speed, scale: spineScale } = useControls('Spine Global', {
    speed: { value: 0.02, min: 0, max: 0.2, step: 0.001 },
    scale: { value: 1.5, min: 0.5, max: 3, step: 0.1 },
  })

  const backControls = useControls('Spine Back (L→R)', {
    backX: { value: 6, min: 1, max: 15, step: 0.5, label: 'X Spread' },
    backY: { value: 0, min: -5, max: 5, step: 0.1, label: 'Y Offset' },
    backZ: { value: -5, min: -12, max: 0, step: 0.5, label: 'Z Depth' },
    backCurveY: { value: 1.0, min: -3, max: 5, step: 0.1, label: 'Arc Height' },
  })

  const frontControls = useControls('Spine Front (R→L)', {
    frontX: { value: 6, min: 1, max: 15, step: 0.5, label: 'X Spread' },
    frontY: { value: -0.5, min: -5, max: 5, step: 0.1, label: 'Y Offset' },
    frontZ: { value: 2, min: -2, max: 8, step: 0.5, label: 'Z Depth' },
    frontCurveY: { value: -1.0, min: -5, max: 3, step: 0.1, label: 'Arc Height' },
  })

  const sourceMesh = useMemo(() => {
    let mesh = null
    glbScene.traverse((child) => {
      if (child.isMesh && !mesh) mesh = child
    })
    return mesh
  }, [glbScene, nodes])

  const material = useMemo(() => {
    if (!sourceMesh) return null
    return new THREE.MeshPhysicalMaterial({
      color: '#b8d6ff',
      transmission: 0.98,
      thickness: 1.5,
      roughness: 0.05,
      metalness: 0.0,
      ior: 1.5,
      envMapIntensity: 3.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.0,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      attenuationColor: new THREE.Color('#b8d6ff'),
      attenuationDistance: 2.0,
    })
  }, [sourceMesh])

  // Back path: left → right, behind text
  const backPoints = useMemo(() => [
    new THREE.Vector3(-backControls.backX, backControls.backCurveY + backControls.backY, backControls.backZ),
    new THREE.Vector3(-backControls.backX * 0.5, backControls.backCurveY * 0.5 + backControls.backY, backControls.backZ * 0.8),
    new THREE.Vector3(0, backControls.backY, backControls.backZ * 0.6),
    new THREE.Vector3(backControls.backX * 0.5, backControls.backCurveY * 0.5 + backControls.backY, backControls.backZ * 0.8),
    new THREE.Vector3(backControls.backX, backControls.backCurveY + backControls.backY, backControls.backZ),
  ], [backControls.backX, backControls.backY, backControls.backZ, backControls.backCurveY])

  // Front path: right → left, in front of text
  const frontPoints = useMemo(() => [
    new THREE.Vector3(frontControls.frontX, frontControls.frontCurveY + frontControls.frontY, frontControls.frontZ),
    new THREE.Vector3(frontControls.frontX * 0.5, frontControls.frontCurveY * 0.5 + frontControls.frontY, frontControls.frontZ * 0.8),
    new THREE.Vector3(0, frontControls.frontY, frontControls.frontZ * 0.6),
    new THREE.Vector3(-frontControls.frontX * 0.5, frontControls.frontCurveY * 0.5 + frontControls.frontY, frontControls.frontZ * 0.8),
    new THREE.Vector3(-frontControls.frontX, frontControls.frontCurveY + frontControls.frontY, frontControls.frontZ),
  ], [frontControls.frontX, frontControls.frontY, frontControls.frontZ, frontControls.frontCurveY])

  // ── Scroll-reactive behaviour ──────────────────────────────────────────────
  useFrame((_, delta) => {
    if (!spineGroupRef.current) return
    const t = scrollRef?.current ?? 0

    // Speed: full → slow → pause → very slow rail → stop
    let targetSpeed = speed
    if (t > 0.10) {
      const slowFactor = 1 - THREE.MathUtils.clamp((t - 0.10) / 0.04, 0, 1)
      targetSpeed = speed * slowFactor          // slow between 10-14%
    }
    if (t > 0.40 && t < 0.75) targetSpeed = speed * 0.04  // near-stop in projects
    if (t > 0.75) targetSpeed = 0                          // fully stopped in resume
    animSpeedRef.current = THREE.MathUtils.damp(animSpeedRef.current, targetSpeed, 5, delta)

    // Structural Reclassification: 90° Y-axis rotation at project entry
    // The pause happens at 10-14%, the rotation begins at 14%
    let targetRotY = 0
    if (t > 0.14) {
      const rotProgress = THREE.MathUtils.clamp((t - 0.14) / 0.06, 0, 1)
      targetRotY = (rotProgress * Math.PI) / 2
    }
    spineGroupRef.current.rotation.y = THREE.MathUtils.damp(
      spineGroupRef.current.rotation.y, targetRotY, 3, delta
    )

    // Edge position: spine moves to left edge in detail/resume sections
    let targetX = 0
    if (t > 0.44 && t < 0.75) {
      const edgeProgress = THREE.MathUtils.clamp((t - 0.44) / 0.06, 0, 1)
      targetX = -8 * edgeProgress
    } else if (t >= 0.75) {
      targetX = -9
    }
    spineGroupRef.current.position.x = THREE.MathUtils.damp(
      spineGroupRef.current.position.x, targetX, 2.5, delta
    )
  })

  if (!sourceMesh) return null

  return (
    <group ref={spineGroupRef}>
      {/* Back spine: left → right, behind text */}
      <SpinePath
        geometry={sourceMesh.geometry}
        material={material}
        points={backPoints}
        gap={gap}
        speed={speed}
        speedRef={animSpeedRef}
        scale={spineScale}
        direction={1}
      />
      {/* Front spine: right → left, in front of text */}
      <SpinePath
        geometry={sourceMesh.geometry}
        material={material}
        points={frontPoints}
        gap={gap}
        speed={speed}
        speedRef={animSpeedRef}
        scale={spineScale}
        direction={-1}
      />
    </group>
  )
}


// ─── Neon Installation ─────────────────────────────────────────────────────────
function NeonInstallation() {
  const diamondRef = useRef()
  const ringRef = useRef()

  const {
    diamondColor, diamondSpeedY, diamondSpeedX,
    ringEmissive, ringIntensity, ringSpeedZ,
    posX, posY, posZ,
  } = useControls('Neon Installation', {
    diamondColor: { value: '#3366ff', label: 'Diamond Color' },
    diamondSpeedY: { value: 0.05, min: 0, max: 0.3, step: 0.005, label: 'Diamond Speed Y' },
    diamondSpeedX: { value: 0.018, min: 0, max: 0.2, step: 0.005, label: 'Diamond Speed X' },
    ringEmissive: { value: '#cc1122', label: 'Ring Color' },
    ringIntensity: { value: 3.5, min: 0, max: 12, step: 0.1, label: 'Ring Intensity' },
    ringSpeedZ: { value: 0.025, min: 0, max: 0.2, step: 0.005, label: 'Ring Speed' },
    posX: { value: 0, min: -20, max: 20, step: 0.5, label: 'Pos X' },
    posY: { value: 1, min: -10, max: 10, step: 0.5, label: 'Pos Y' },
    posZ: { value: -20, min: -50, max: -5, step: 0.5, label: 'Pos Z' },
  })

  const diamondEdges = useMemo(() => {
    const geo = new THREE.OctahedronGeometry(8, 0)
    return new THREE.EdgesGeometry(geo)
  }, [])

  const ringGeo = useMemo(() => new THREE.TorusGeometry(5.5, 0.06, 6, 80), [])

  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    if (diamondRef.current) {
      diamondRef.current.rotation.y = t * diamondSpeedY
      diamondRef.current.rotation.x = t * diamondSpeedX
    }
    if (ringRef.current) {
      ringRef.current.rotation.z = t * ringSpeedZ
    }
  })

  return (
    <group position={[posX, posY, posZ]}>
      {/* Large wireframe diamond — glows blue with bloom */}
      <lineSegments ref={diamondRef} geometry={diamondEdges}>
        <lineBasicMaterial color={diamondColor} />
      </lineSegments>
      {/* Tilted neon ring — glows red with bloom */}
      <mesh ref={ringRef} geometry={ringGeo} rotation={[Math.PI * 0.35, 0.3, 0]}>
        <meshStandardMaterial
          color="#0a0005"
          emissive={ringEmissive}
          emissiveIntensity={ringIntensity}
          roughness={0.1}
          metalness={0.3}
        />
      </mesh>
    </group>
  )
}


// ─── Particle Field ────────────────────────────────────────────────────────────
function ParticleField({ count = 500 }) {
  const ref = useRef()

  const { particleSize, particleColor, particleOpacity, particleSpeed } = useControls('Particles', {
    particleSize: { value: 0.028, min: 0.005, max: 0.2, step: 0.005, label: 'Size' },
    particleColor: { value: '#8899cc', label: 'Color' },
    particleOpacity: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Opacity' },
    particleSpeed: { value: 1.0, min: 0, max: 5, step: 0.1, label: 'Speed Mult' },
  })

  const [positions, speeds] = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const spd = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      // eslint-disable-next-line react-hooks/purity
      pos[i * 3] = (Math.random() - 0.5) * 60
      // eslint-disable-next-line react-hooks/purity
      pos[i * 3 + 1] = (Math.random() - 0.5) * 50
      // eslint-disable-next-line react-hooks/purity
      pos[i * 3 + 2] = (Math.random() - 0.5) * 60
      // eslint-disable-next-line react-hooks/purity
      spd[i] = Math.random() * 0.4 + 0.1
    }
    return [pos, spd]
  }, [count])

  useFrame((_, delta) => {
    if (!ref.current) return
    const pos = ref.current.geometry.attributes.position.array
    for (let i = 0; i < count; i++) {
      pos[i * 3 + 1] -= delta * speeds[i] * 0.15 * particleSpeed
      if (pos[i * 3 + 1] < -25) pos[i * 3 + 1] = 25
    }
    ref.current.geometry.attributes.position.needsUpdate = true
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={particleSize} color={particleColor} transparent opacity={particleOpacity} sizeAttenuation depthWrite={false} />
    </points>
  )
}


// ─── Physics Letter ────────────────────────────────────────────────────────────
const PhysicsLetter = ({ char, position, size, font, curveSegments, bevelSize, bevelThickness, extrudeDepth, material }) => {
  const api = useRef()
  const impulseApplied = useRef(false)

  useFrame(() => {
    if (!impulseApplied.current && api.current) {
      api.current.applyImpulse({
        x: (Math.random() - 0.5) * 0.1, y: 0, z: (Math.random() - 0.5) * 0.1
      }, true)
      api.current.applyTorqueImpulse({
        x: (Math.random() - 0.5) * 0.1,
        y: (Math.random() - 0.5) * 0.1,
        z: (Math.random() - 0.5) * 0.1
      }, true)
      impulseApplied.current = true
    }
  })

  return (
    <RigidBody ref={api} position={position} type="dynamic" colliders="cuboid" restitution={0.6}>
      <Text3D
        font={font} size={size} height={extrudeDepth}
        curveSegments={curveSegments}
        bevelEnabled={bevelSize > 0} bevelSize={bevelSize} bevelThickness={bevelThickness}
        material={material}
      >
        {char}
      </Text3D>
    </RigidBody>
  )
}



// ─── Animated Letter ───────────────────────────────────────────────────────────
const AnimatedLetter = ({ char, targetPosition, hasFallen, size, font, curveSegments, bevelSize, bevelThickness, extrudeDepth, material }) => {
  const group = useRef()
  const startY = hasFallen ? targetPosition[1] - 10 : targetPosition[1]
  const endY = targetPosition[1]

  useFrame((_, delta) => {
    if (group.current) {
      group.current.position.y = THREE.MathUtils.damp(group.current.position.y, endY, 8, delta)
    }
  })

  return (
    <group ref={group} position={[targetPosition[0], startY, targetPosition[2]]}>
      <Text3D
        font={font} size={size} height={extrudeDepth}
        curveSegments={curveSegments}
        bevelEnabled={bevelSize > 0} bevelSize={bevelSize} bevelThickness={bevelThickness}
        material={material}
      >
        {char}
      </Text3D>
    </group>
  )
}


// ─── Word ──────────────────────────────────────────────────────────────────────
const Word = ({ text, position, size = 1, letterSpacing = 0.08, isFallen, hasFallen, font, curveSegments, bevelSize, bevelThickness, extrudeDepth, material }) => {
  const group = useRef()
  const letters = text.split('')
  const [animatedSize, setAnimatedSize] = useState(0)
  const time = useRef(0)
  const displaySize = isFallen ? size : animatedSize

  useLayoutEffect(() => {
    if (group.current && !hasFallen) group.current.position.set(0, 0, 0)
    if (hasFallen) { setAnimatedSize(0); time.current = 0 }
  }, [hasFallen])

  useFrame((_, delta) => {
    if (isFallen) {
      if (animatedSize !== size) setAnimatedSize(size)
      if (group.current) group.current.position.set(position[0], position[1], position[2])
      return
    }
    time.current += delta
    const delay = hasFallen ? 0 : 1.0
    if (time.current < delay) return
    if (animatedSize < size) {
      const nextSize = THREE.MathUtils.damp(animatedSize, size, 4, delta)
      if (Math.abs(nextSize - size) < 0.001) setAnimatedSize(size)
      else setAnimatedSize(nextSize)
    }
    if (group.current) {
      group.current.position.x = THREE.MathUtils.damp(group.current.position.x, position[0], 6, delta)
      group.current.position.y = THREE.MathUtils.damp(group.current.position.y, position[1], 6, delta)
      group.current.position.z = THREE.MathUtils.damp(group.current.position.z, position[2], 6, delta)
    }
  })

  const getCharWidth = (char) => {
    const s = displaySize
    if (char === 'I' || char === 'i') return s * 0.4
    if (char === 'J' || char === 'j') return s * 0.5
    if (char === 'L' || char === 'l') return s * 0.7
    if (char === 'r' || char === 'R') return s * 1.0
    if (char === 'n' || char === 'N' || char === 'e' || char === 'E') return s * 1.4
    return s * 1.0
  }

  const totalWidth = letters.reduce((acc, char, i) => {
    const width = getCharWidth(char)
    const spacing = i < letters.length - 1 ? letterSpacing * (displaySize / size) : 0
    return acc + width + spacing
  }, 0)

  let offsetX = -totalWidth / 2

  return (
    <group ref={group} position={position}>
      {letters.map((char, i) => {
        const charWidth = getCharWidth(char)
        const x = offsetX
        // eslint-disable-next-line react-hooks/immutability
        offsetX += charWidth + letterSpacing * (displaySize / size)
        if (isFallen) {
          return <PhysicsLetter key={`p-${i}`} char={char} position={[x, 0, 0]} size={displaySize} font={font} curveSegments={curveSegments} bevelSize={bevelSize} bevelThickness={bevelThickness} extrudeDepth={extrudeDepth} material={material} />
        } else {
          return <AnimatedLetter key={`a-${i}`} char={char} targetPosition={[x, 0, 0]} hasFallen={hasFallen} size={displaySize} font={font} curveSegments={curveSegments} bevelSize={bevelSize} bevelThickness={bevelThickness} extrudeDepth={extrudeDepth} material={material} />
        }
      })}
    </group>
  )
}


// ─── Spine Typography ──────────────────────────────────────────────────────────
const MANUAL_PATHS = {
  'S': [[1, 1, 0, 0, 1, 0, 0, 0.5, 0, 1, 0.5, 0, 1, 0, 0, 0, 0, 0]],
  'E': [[1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0], [0, 0.5, 0, 0.8, 0.5, 0]],
  'N': [[0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0]],
  'I': [[0.5, 0, 0, 0.5, 1, 0]],
  'O': [[0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0]],
  'R': [[0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0, 0, 0.5, 0], [0.5, 0.5, 0, 1, 0, 0]],
  'P': [[0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0, 0, 0.5, 0]],
  'D': [[0, 0, 0, 0, 1, 0, 0.8, 0.9, 0, 1, 0.5, 0, 0.8, 0.1, 0, 0, 0, 0]],
  'U': [[0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0]],
  'C': [[1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]],
  'T': [[0, 1, 0, 1, 1, 0], [0.5, 1, 0, 0.5, 0, 0]],
  'G': [[1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0.5, 0, 0.5, 0.5, 0]],
}

function SpineLetter({ char, size, material, geometry, speedRef, scale = 1, position = [0, 0, 0] }) {
  const points = useMemo(() => {
    const raw = MANUAL_PATHS[char] || MANUAL_PATHS['I']
    return raw.map(segment => {
      const pts = []
      for (let i = 0; i < segment.length; i += 3) {
        pts.push(new THREE.Vector3(segment[i] * size, segment[i + 1] * size, segment[i + 2] * size))
      }
      return pts
    })
  }, [char, size])

  return (
    <group scale={scale} position={position}>
      {points.map((p, i) => (
        <SpinePath
          key={i}
          geometry={geometry}
          material={material}
          points={p}
          speedRef={speedRef}
          scale={1}
          direction={i % 2 === 0 ? 1 : -1}
        />
      ))}
    </group>
  )
}

function SpineWord({ text, size, material, geometry, speedRef, letterSpacing = 0.5, position = [0, 0, 0] }) {
  const letters = text.split('')
  const totalWidth = letters.length * (size * 0.8 + letterSpacing)
  let currentX = -totalWidth / 2

  return (
    <group position={position}>
      {letters.map((char, i) => {
        const x = currentX
        // eslint-disable-next-line react-hooks/immutability
        currentX += size * 0.8 + letterSpacing
        if (char === ' ') return null
        return (
          <SpineLetter
            key={i}
            char={char}
            size={size}
            material={material}
            geometry={geometry}
            speedRef={speedRef}
            position={[x, 0, 0]}
          />
        )
      })}
    </group>
  )
}


// ─── HelloText ─────────────────────────────────────────────────────────────────
function HelloText({ isFallen, hasFallen }) {
  const meshRef = useRef()

  const {
    metalness, roughness, envMapIntensity, color,
    rotateX, rotateY, rotateZ, font,
    curveSegments, bevelSize, bevelThickness, extrudeDepth, side
  } = useControls('Chrome Text', {
    metalness: { value: 1.0, min: 0, max: 1, step: 0.01 },
    roughness: { value: 0.08, min: 0, max: 1, step: 0.01 },
    envMapIntensity: { value: 4.0, min: 0, max: 10, step: 0.1 },
    color: { value: '#c0c8d0' },
    rotateX: { value: 0, min: -Math.PI, max: Math.PI, step: 0.01, label: 'Rotate X' },
    rotateY: { value: 0, min: -Math.PI, max: Math.PI, step: 0.01, label: 'Rotate Y' },
    rotateZ: { value: 0, min: -Math.PI, max: Math.PI, step: 0.01, label: 'Rotate Z' },
    font: {
      value: '/fonts/Boiga/Boiga Fill B_Regular.json',
      options: {
        // ── Root ──────────────────────────────────────────
        'Nan Jaune': '/nan-jaune.json',
        // ── Analog ────────────────────────────────────────
        'Analog': '/fonts/Analog/Analog_Regular.json',
        'Analog Bold': '/fonts/Analog/Analog Bold_Regular.json',
        'Analog Bold Oblique': '/fonts/Analog/Analog Bold Oblique_Regular.json',
        'Analog Light': '/fonts/Analog/Analog Light_Regular.json',
        'Analog Medium': '/fonts/Analog/Analog Medium_Regular.json',
        'Analog Thin': '/fonts/Analog/Analog Thin_Regular.json',
        // ── Aura Seraph ───────────────────────────────────
        'Aura Seraph': '/fonts/Aura Seraph/Aura Seraph_Regular.json',
        // ── Auxtera Circa ─────────────────────────────────
        'Auxtera Circa': '/fonts/Auxtera Circa/Auxtera Circa_Circa.json',
        // ── Boiga ─────────────────────────────────────────
        'Boiga Fill': '/fonts/Boiga/Boiga Fill B_Regular.json',
        'Boiga Outline': '/fonts/Boiga/Boiga Outline B_Regular.json',
        // ── Brzo ──────────────────────────────────────────
        'Brzo Basic': '/fonts/Brzo/Brzo Basic_Regular.json',
        'Brzo Air': '/fonts/Brzo/Brzo Air_Regular.json',
        'Brzo Gloss': '/fonts/Brzo/Brzo Gloss_Regular.json',
        'Brzo Chrome Away': '/fonts/Brzo Chrome/Brzo Chrome Away_Regular.json',
        'Brzo Chrome Home': '/fonts/Brzo Chrome/Brzo Chrome Home_Regular.json',
        // ── HOK Display ───────────────────────────────────
        'HOK Display': '/fonts/HOK Display/HOK Display_Regular.json',
        // ── Klaus ─────────────────────────────────────────
        'Klaus Bold': '/fonts/Klaus/Klaus_Bold.json',
        'Klaus Black': '/fonts/Klaus/Klaus Black_Regular.json',
        'Klaus Medium': '/fonts/Klaus/Klaus Medium_Regular.json',
        'Klaus Semibold': '/fonts/Klaus/Klaus Semibold_Regular.json',
        // ── Lc Pukara ─────────────────────────────────────
        'Lc Pukara Black': '/fonts/Lc Pukara/Lc Pukara Black_Black.json',
        // ── MD Nichrome ───────────────────────────────────
        'MD Nichrome Bold': '/fonts/MD Nichrome/MD Nichrome_Bold.json',
        'MD Nichrome Black': '/fonts/MD Nichrome/MD Nichrome Black_Regular.json',
        'MD Nichrome Dark': '/fonts/MD Nichrome/MD Nichrome Dark_Regular.json',
        // ── Manifold CF ───────────────────────────────────
        'Manifold CF Bold': '/fonts/Manifold CF/Manifold CF_Bold.json',
        'Manifold CF Extra Bold': '/fonts/Manifold CF/Manifold CF Extra Bold_Regular.json',
        'Manifold CF Heavy': '/fonts/Manifold CF/Manifold CF Heavy_Regular.json',
        'Manifold CF Demi Bold': '/fonts/Manifold CF/Manifold CF Demi Bold_Regular.json',
        'Manifold CF Medium': '/fonts/Manifold CF/Manifold CF Medium_Regular.json',
        // ── Manifold Extended CF ──────────────────────────
        'Manifold Extended Bold': '/fonts/Manifold Extended CF/Manifold Extended CF_Bold.json',
        'Manifold Extended X-Bold': '/fonts/Manifold Extended CF/Manifold Extended CF Extra Bold_Regular.json',
        'Manifold Extended Heavy': '/fonts/Manifold Extended CF/Manifold Extended CF Heavy_Regular.json',
        'Manifold Extended Demi': '/fonts/Manifold Extended CF/Manifold Extended CF Demi Bold_Regular.json',
        'Manifold Extended Medium': '/fonts/Manifold Extended CF/Manifold Extended CF Medium_Regular.json',
        // ── Niki ──────────────────────────────────────────
        'Niki': '/fonts/Niki/Niki_Regular.json',
        // ── Nostra ────────────────────────────────────────
        'Nostra': '/fonts/Nostra/Nostra v1.0 Sett_Regular.json',
        'Nostra Italic': '/fonts/Nostra/Nostra v1.0 Sett_Italic.json',
        // ── Seraphs ───────────────────────────────────────
        'Seraphs': '/fonts/Seraphs/Seraphs V4_Regular.json',
        'Seraphs Slab Bold': '/fonts/Seraphs Slab/Seraphs Slab Bold_Regular.json',
        'Seraphs Slab Medium': '/fonts/Seraphs Slab/Seraphs Slab Medium_Regular.json',
        // ── Stravinsky ────────────────────────────────────
        'Stravinsky Bold': '/fonts/Stravinsky/Stravinsky TRIAL_Bold.json',
        'Stravinsky Extrabold': '/fonts/Stravinsky/Stravinsky TRIAL Extrabold_Regular.json',
        'Stravinsky Medium': '/fonts/Stravinsky/Stravinsky TRIAL Medium_Regular.json',
        // ── Streco ────────────────────────────────────────
        'Streco Superfat': '/fonts/Streco/Streco Superfat_Regular.json',
        'Streco Stencil': '/fonts/Streco/Streco Stencil Superfat_Regular.json',
        // ── The Future ────────────────────────────────────
        'The Future Bold': '/fonts/The Future/The Future_Bold.json',
        'The Future Black': '/fonts/The Future/The Future Black_Regular.json',
        'The Future Medium': '/fonts/The Future/The Future Medium_Regular.json',
        // ── The Future Mono ───────────────────────────────
        'The Future Mono Bold': '/fonts/The Future Mono/The Future Mono_Bold.json',
        'The Future Mono Black': '/fonts/The Future Mono/The Future Mono Black_Regular.json',
        'The Future Mono Medium': '/fonts/The Future Mono/The Future Mono Medium_Regular.json',
        // ── VC Gosh ───────────────────────────────────────
        'VC Gosh Bold': '/fonts/VC Gosh/VC Gosh Bold_Regular.json',
        'VC Gosh Cond Bold': '/fonts/VC Gosh/VC Gosh Cond Bold_Regular.json',
        'VC Gosh SmCond Bold': '/fonts/VC Gosh/VC Gosh SmCond Bold_Regular.json',
        'VC Gosh Wide XBold': '/fonts/VC Gosh/VC Gosh Wide XBold_Regular.json',
        'VC Gosh XCond Bold': '/fonts/VC Gosh/VC Gosh XCond Bold_Regular.json',
        'VC Gosh XWide Bold': '/fonts/VC Gosh/VC Gosh XWide Bold_Regular.json',
        // ── VCTR Mono ─────────────────────────────────────
        'VCTR Mono Bold': '/fonts/VCTR Mono/VCTR Mono v0.11 Bold_Regular.json',
        'VCTR Mono Black': '/fonts/VCTR Mono/VCTR Mono v0.11 Black_Regular.json',
        'VCTR Mono Medium': '/fonts/VCTR Mono/VCTR Mono v0.11 Medium_Regular.json',
        // ── ottenburg Display ─────────────────────────────
        'ottenburg Bold': '/fonts/ottenburg Display/ottenburg Display Bold_Regular.json',
        'ottenburg SemiBold': '/fonts/ottenburg Display/ottenburg Display SemiBold_Regular.json',
        'ottenburg Medium': '/fonts/ottenburg Display/ottenburg Display Medium_Regular.json',
        'ottenburg Regular': '/fonts/ottenburg Display/ottenburg Display_Regular.json',
      }
    },
    curveSegments: { value: 12, min: 3, max: 32, step: 1, label: 'Curve Segments' },
    bevelSize: { value: 0.03, min: 0, max: 0.2, step: 0.005, label: 'Bevel Size' },
    bevelThickness: { value: 0.03, min: 0, max: 0.3, step: 0.005, label: 'Bevel Thickness' },
    extrudeDepth: { value: 0.4, min: 0.01, max: 1.5, step: 0.01, label: 'Extrude Depth' },
    side: {
      value: THREE.FrontSide,
      options: { 'Front Only (no hole artifacts)': THREE.FrontSide, 'Double Sided': THREE.DoubleSide },
      label: 'Material Side',
    },
  })

  // Spine segment geometry for letters
  const { scene: glbScene } = useGLTF('/spine.glb')
  const spineGeometry = useMemo(() => {
    let geo = null
    glbScene.traverse((child) => {
      if (child.isMesh && !geo) geo = child.geometry
    })
    return geo
  }, [glbScene])

  const animSpeedRef = useRef(0.02)

  const sharedMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    transmission: 0.95,
    thickness: 1.0,
    roughness: 0.1,
    metalness: 0.1,
    ior: 1.5,
    envMapIntensity: 2.0,
    transparent: true,
  }), [])

  // Structural props that need a shader recompile
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    sharedMat.metalness = metalness
    // eslint-disable-next-line react-hooks/immutability
    sharedMat.roughness = roughness
    // eslint-disable-next-line react-hooks/immutability
    sharedMat.color.set(color)
    // eslint-disable-next-line react-hooks/immutability
    sharedMat.side = side
    // eslint-disable-next-line react-hooks/immutability
    sharedMat.needsUpdate = true
  }, [metalness, roughness, color, side, sharedMat])

  // envMapIntensity is a plain uniform — sync every frame so it always
  // reflects the control value regardless of when the HDRI loads
  useFrame(() => {
    // eslint-disable-next-line react-hooks/immutability
    sharedMat.envMapIntensity = envMapIntensity
  })

  const geomProps = { curveSegments, bevelSize, bevelThickness, extrudeDepth }

  return (
    <Center>
      <group ref={meshRef} rotation={[rotateX, rotateY, rotateZ]}>
        {isFallen || hasFallen ? (
          <>
            <Word text="SENIOR" position={[0, 4, -5]} isFallen={isFallen} hasFallen={hasFallen} font={font} {...geomProps} material={sharedMat} />
            <Word text="PRODUCT" position={[0, 0, -3]} isFallen={isFallen} hasFallen={hasFallen} font={font} {...geomProps} material={sharedMat} />
            <Word text="DESIGNER" position={[0, -4, -2]} isFallen={isFallen} hasFallen={hasFallen} font={font} {...geomProps} material={sharedMat} />
          </>
        ) : (
          <>
            <SpineWord text="SENIOR" size={3} position={[0, 4, -5]} geometry={spineGeometry} material={sharedMat} speedRef={animSpeedRef} />
            <SpineWord text="PRODUCT" size={3} position={[0, 0, -3]} geometry={spineGeometry} material={sharedMat} speedRef={animSpeedRef} />
            <SpineWord text="DESIGNER" size={3} position={[0, -4, -2]} geometry={spineGeometry} material={sharedMat} speedRef={animSpeedRef} />
          </>
        )}
      </group>
    </Center>
  )
}


// ─── Ethos Overlay ─────────────────────────────────────────────────────────────
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
      // Fade in background 8% - 11% (during/after fall)
      const bgIn = THREE.MathUtils.mapLinear(t, 0.08, 0.11, 0, 1)
      // Fade out background 20% - 24%
      const bgOut = THREE.MathUtils.mapLinear(t, 0.20, 0.24, 1, 0)
      const bgOpacity = Math.min(Math.max(bgIn, 0), 1) * Math.min(Math.max(bgOut, 0), 1)

      // Move text up 10% - 22%
      const yProgress = THREE.MathUtils.mapLinear(t, 0.10, 0.22, 0, 1)
      const translateY = THREE.MathUtils.lerp(100, -100, THREE.MathUtils.clamp(yProgress, 0, 1))

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
        <h1 style={{ fontSize: '3rem', letterSpacing: '4px', marginBottom: '1rem', color: '#ff3366' }}>MY ETHOS</h1>
        <p style={{ fontSize: '1.2rem', lineHeight: '1.8', color: '#8899cc' }}>
          We do not build templates. We do not write boilerplate. We sculpt digital space.
          The web is not a printed page; it is a physical environment waiting to be shaped.
        </p>
      </div>
    </div>
  )
}


// ─── Portfolio Overlay ─────────────────────────────────────────────────────────
// HTML content rendered inside drei's <Scroll html> — scrolls with the 3D scene
function PortfolioOverlay() {
  const scroll = useScroll()
  const workRef = useRef()
  const resumeRef = useRef()
  const bioRef = useRef()
  const prevOffsetRef = useRef(-1)

  useFrame(() => {
    const offset = scroll.offset
    if (Math.abs(offset - prevOffsetRef.current) < 0.0005) return
    prevOffsetRef.current = offset

    // Work section: fade in after Ethos (approx >24%)
    if (workRef.current) {
      const workIn = THREE.MathUtils.mapLinear(offset, 0.24, 0.30, 0, 1)
      const workOut = THREE.MathUtils.mapLinear(offset, 0.45, 0.50, 1, 0)
      const workOpacity = Math.min(Math.max(workIn, 0), 1) * Math.min(Math.max(workOut, 0), 1)
      workRef.current.style.opacity = workOpacity
      workRef.current.style.transform = `translateY(${(1 - Math.min(Math.max(workIn, 0), 1)) * 40}px)`
    }

    // Resume section: fade in after Work
    if (resumeRef.current) {
      const resumeIn = THREE.MathUtils.mapLinear(offset, 0.52, 0.60, 0, 1)
      const resumeOut = THREE.MathUtils.mapLinear(offset, 0.78, 0.84, 1, 0)
      const resumeOpacity = Math.min(Math.max(resumeIn, 0), 1) * Math.min(Math.max(resumeOut, 0), 1)
      resumeRef.current.style.opacity = resumeOpacity
      resumeRef.current.style.transform = `translateY(${(1 - Math.min(Math.max(resumeIn, 0), 1)) * 40}px)`
    }

    // Bio section: fade in near the end
    if (bioRef.current) {
      const bioIn = THREE.MathUtils.mapLinear(offset, 0.86, 0.94, 0, 1)
      const bioOpacity = Math.min(Math.max(bioIn, 0), 1)
      bioRef.current.style.opacity = bioOpacity
      bioRef.current.style.transform = `translateY(${(1 - bioOpacity) * 40}px)`
    }
  })

  return (
    <>
      {/* ─── Work Section ─────────────────────────────── */}
      <div ref={workRef} className="scroll-section work-section" style={{ opacity: 0 }}>
        <div className="work-header">
          <h2>Work That<br />Matters</h2>
          <p>Designing at the intersection of complexity and clarity — enterprise products used by thousands daily.</p>
        </div>

        <div className="case-studies">
          <a href="https://www.mstf.me/immobilizer" target="_blank" rel="noopener" className="case-card">
            <div className="case-card-number">01</div>
            <div className="case-card-content">
              <div className="case-card-meta"><span>Product Design</span><span>·</span><span>Motive</span></div>
              <h3>Preventing Vehicle Theft with Engine Immobilizer</h3>
              <p>Introduced the ability to remotely immobilize vehicles on the Motive platform — a comprehensive safety feature protecting fleet operators and their assets.</p>
            </div>
            <div className="case-card-arrow">→</div>
          </a>

          <a href="https://www.mstf.me/workflows" target="_blank" rel="noopener" className="case-card">
            <div className="case-card-number">02</div>
            <div className="case-card-content">
              <div className="case-card-meta"><span>Product Design</span><span>·</span><span>Enterprise</span></div>
              <h3>Workflows: Building the Future of Work Management</h3>
              <p>Improving productivity of tech teams through a dedicated work platform — rethinking how engineering organizations manage complex, cross-functional projects.</p>
            </div>
            <div className="case-card-arrow">→</div>
          </a>

          <a href="https://www.mstf.me/onboarding" target="_blank" rel="noopener" className="case-card">
            <div className="case-card-number">03</div>
            <div className="case-card-content">
              <div className="case-card-meta"><span>UX Design</span><span>·</span><span>Enterprise</span></div>
              <h3>Reinventing Onboarding for Engineers</h3>
              <p>Optimizing time to productivity for engineering hires — redesigning the first-week experience to reduce ramp-up time and improve new hire confidence.</p>
            </div>
            <div className="case-card-arrow">→</div>
          </a>

          <a href="https://www.mstf.me/dark-mode" target="_blank" rel="noopener" className="case-card">
            <div className="case-card-number">04</div>
            <div className="case-card-content">
              <div className="case-card-meta"><span>Design System</span><span>·</span><span>Enterprise</span></div>
              <h3>Introducing Dark Mode to the Design System</h3>
              <p>Adding one of the most requested features to the product within 1 week — a systematic approach to theming across an entire component library.</p>
            </div>
            <div className="case-card-arrow">→</div>
          </a>
        </div>
      </div>


      {/* ─── Resume Section ─────────────────────────────── */}
      <div ref={resumeRef} className="scroll-section resume-section" style={{ opacity: 0 }}>
        <div className="resume-header">
          <h2>Experience & Skills</h2>
        </div>

        <div className="resume-layout">
          <div className="resume-column">
            <h3>Experience</h3>

            <div className="exp-entry">
              <div className="exp-entry-header">
                <h4>Product Designer</h4>
                <span className="dates">2024 — Present</span>
              </div>
              <div className="company">Dell Technologies</div>
              <p>Building scalable AI solutions for the next generation of data centers. Designing seamless experiences for complex enterprise problems in niche industries.</p>
            </div>

            <div className="exp-entry">
              <div className="exp-entry-header">
                <h4>Product Designer</h4>
                <span className="dates">2022 — 2024</span>
              </div>
              <div className="company">Motive</div>
              <p>Designed safety-critical features for the fleet management platform. Shipped Engine Immobilizer and workflow tools serving thousands of fleet operators.</p>
            </div>

            <div className="exp-entry">
              <div className="exp-entry-header">
                <h4>UX Designer</h4>
                <span className="dates">2020 — 2022</span>
              </div>
              <div className="company">Previous Role</div>
              <p>Designed consumer and enterprise experiences across mobile and web. Led user research initiatives and built foundational design system components.</p>
            </div>
          </div>

          <div className="resume-column">
            <h3>Skills</h3>

            <div className="skill-group">
              <h4>Design</h4>
              <div className="skill-tags">
                <span className="skill-tag">Product Design</span>
                <span className="skill-tag">Design Systems</span>
                <span className="skill-tag">Interaction Design</span>
                <span className="skill-tag">Prototyping</span>
                <span className="skill-tag">User Research</span>
                <span className="skill-tag">Visual Design</span>
              </div>
            </div>

            <div className="skill-group">
              <h4>Tools</h4>
              <div className="skill-tags">
                <span className="skill-tag">Figma</span>
                <span className="skill-tag">Framer</span>
                <span className="skill-tag">After Effects</span>
                <span className="skill-tag">Blender</span>
                <span className="skill-tag">Three.js</span>
              </div>
            </div>

            <div className="skill-group">
              <h4>Development</h4>
              <div className="skill-tags">
                <span className="skill-tag">React</span>
                <span className="skill-tag">TypeScript</span>
                <span className="skill-tag">CSS</span>
                <span className="skill-tag">WebGL</span>
                <span className="skill-tag">GLSL</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Bio Section ─────────────────────────────── */}
      <div ref={bioRef} className="scroll-section bio-section" style={{ opacity: 0 }}>
        <div className="bio-content">
          <h2 className="bio-name">Mustafa Ali Akbar</h2>
          <div className="bio-divider" />
          <p className="bio-tagline">Product Designer</p>
          <p className="bio-text">
            A medium-agnostic product designer who bridges the gap between design and engineering.
            I believe the best digital experiences come from understanding both the pixels
            and the code behind them. Currently building scalable AI solutions at Dell.
            When I'm not designing, you'll find me experimenting with WebGL, generative art,
            and creative coding.
          </p>
          <div className="bio-links">
            <a href="mailto:mustafa@mstf.me" className="bio-link bio-link--primary">Get in Touch</a>
            <a href="https://www.linkedin.com/in/mustafa-ali-akbar-a5195387/" target="_blank" rel="noopener" className="bio-link">LinkedIn</a>
            <a href="https://drive.google.com/file/d/1lFeiToMUnMRtD6pC40q_PyZW01hf9Kus/view?usp=sharing" target="_blank" rel="noopener" className="bio-link">Resume</a>
          </div>
        </div>
      </div>
    </>
  )
}


// ─── Scroll Camera Handler (5-stage) ─────────────────────────────────────────
function ScrollCameraHandler({ isFallen, setIsFallen, setHasFallen, scrollRef }) {
  const scroll = useScroll()
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
    const t = scroll.offset
    if (scrollRef) scrollRef.current = t

    // Physics trigger
    if (t > 0.06 && !isFallen) {
      setIsFallen(true)
      setHasFallen(true)
    } else if (t < 0.04 && isFallen) {
      setIsFallen(false)
    }

    // 5-stage camera interpolation
    if (t < 0.08) {
      // Stage 1: Hero (0-8%)
      const s = t / 0.08
      currentPos.lerpVectors(keyframes.heroPos, keyframes.heroPos, s)
      currentLook.lerpVectors(keyframes.heroLook, keyframes.heroLook, s)
    } else if (t < 0.15) {
      // Stage 2: Fall transition (8-15%)
      const s = (t - 0.08) / 0.07
      const ease = s * s * (3 - 2 * s) // smoothstep
      currentPos.lerpVectors(keyframes.heroPos, keyframes.fallPos, ease)
      currentLook.lerpVectors(keyframes.heroLook, keyframes.fallLook, ease)
    } else if (t < 0.45) {
      // Stage 3: Work section (15-45%) — gentle drift
      const s = (t - 0.15) / 0.30
      const ease = s * s * (3 - 2 * s)
      currentPos.lerpVectors(keyframes.fallPos, keyframes.workPos, ease)
      currentLook.lerpVectors(keyframes.fallLook, keyframes.workLook, ease)
    } else if (t < 0.75) {
      // Stage 4: Resume section (45-75%)
      const s = (t - 0.45) / 0.30
      const ease = s * s * (3 - 2 * s)
      currentPos.lerpVectors(keyframes.workPos, keyframes.resumePos, ease)
      currentLook.lerpVectors(keyframes.workLook, keyframes.resumeLook, ease)
    } else {
      // Stage 5: Bio section (75-100%)
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


// ─── Radial Gradient Environment ──────────────────────────────────────────────
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
    vertexShader: `
      varying vec3 vPosition;
      void main() {
        vPosition = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uCenterColor;
      uniform vec3 uEdgeColor;
      varying vec3 vPosition;
      void main() {
        float radial = length(vPosition.xy);
        vec3 color = mix(uCenterColor, uEdgeColor, radial);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  }), [centerColor, edgeColor])

  return (
    <mesh ref={shaderRef} scale={100}>
      <sphereGeometry args={[1, 32, 32]} />
      <shaderMaterial
        {...shader}
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  )
}


// ─── Atmospheric Lighting ─────────────────────────────────────────────────────
function AtmosphericLighting({ scrollRef }) {
  const spotRef = useRef()
  const rimRef = useRef()

  const {
    // Spotlight
    spotColor, spotBase, spotPulse, spotAngle, spotPenumbra, spotDistance, spotDecay,
    spotX, spotY, spotZ,
    // Rim
    rimColor, rimBase, rimPulse,
    rimX, rimY, rimZ,
    // Chrome catches
    catchColor, catchIntensity, catchDistance,
    // Red fill
    redColor, redIntensity, redX, redY, redZ, redDistance,
    // Ambient
    ambientColor, ambientIntensity,
    // Under-fill
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

    // Narrative lighting stages:
    // Hero (0–14%):    full drama — high spotlight, pulsing
    // Projects (14%+): flatten — remove pulse, dim spot (functional mode)
    // Resume (75%+):   neutral — further dim, minimal motion
    let spotMult = 1.0
    let pulseMult = 1.0

    if (scrollT > 0.14) {
      const flatProgress = THREE.MathUtils.clamp((scrollT - 0.14) / 0.06, 0, 1)
      spotMult = THREE.MathUtils.lerp(1.0, 0.60, flatProgress)
      pulseMult = THREE.MathUtils.lerp(1.0, 0.0, flatProgress)  // no pulse in work mode
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


// ─── Robot Arm ─────────────────────────────────────────────────────────────────
// Bones are driven procedurally (FK). The palm-up "holding powder" pose
// animates in as the user enters the bio section (scroll ~78–90%).
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

  // Disable frustum culling on the skinned mesh — bone poses change its
  // effective bounds and Three.js would otherwise cull it off-screen incorrectly
  useMemo(() => {
    // eslint-disable-next-line react-hooks/immutability
    if (nodes['Arm.001']) nodes['Arm.001'].frustumCulled = false
  }, [nodes])

  // Cache the finger bone array once — avoids per-frame allocation
  const fingerBones = useMemo(() => [
    nodes['Index 1'], nodes['Index 2'], nodes['Index 3'],
    nodes['Middle 1'], nodes['Middle 2'], nodes['Middle 3'],
    nodes['Ring 1'], nodes['Ring 2'], nodes['Ring 3'],
    nodes['Little 1'], nodes['Little 2'], nodes['Little 3'],
  ].filter(Boolean), [nodes])

  useFrame((_, delta) => {
    const t = scrollRef?.current ?? 0

    // Animate into view during bio section (scroll 78–90%)
    const progress = THREE.MathUtils.clamp((t - 0.78) / 0.12, 0, 1)
    const ease = progress * progress * (3 - 2 * progress) // smoothstep

    // Lift the whole group upward from off-screen
    liftRef.current = THREE.MathUtils.damp(liftRef.current, ease * liftAmount, 3, delta)
    if (groupRef.current) groupRef.current.position.y = posY + liftRef.current

    // FK bone rotations toward the palm-up "offering" pose
    const upper = nodes['Upperarm']
    const elbow = nodes['Elbow']
    const hand = nodes['Hand']
    const thumb1 = nodes['Thumb 1']
    const thumb2 = nodes['Thumb 2']

    if (upper) {
      // eslint-disable-next-line react-hooks/immutability
      upper.rotation.x = THREE.MathUtils.damp(upper.rotation.x, ease * upperArmTarget, 4, delta)
    }
    if (elbow) {
      // eslint-disable-next-line react-hooks/immutability
      elbow.rotation.x = THREE.MathUtils.damp(elbow.rotation.x, ease * elbowTarget, 4, delta)
    }
    if (hand) {
      // eslint-disable-next-line react-hooks/immutability
      hand.rotation.x = THREE.MathUtils.damp(hand.rotation.x, ease * handTarget, 4, delta)
    }

    // Finger curl: slightly cupped palm, not a fist
    fingerBones.forEach(bone => {
      bone.rotation.x = THREE.MathUtils.damp(bone.rotation.x, ease * fingerCurl, 4, delta)
    })

    // Thumb spreads outward (Z axis for abduction)
    if (thumb1) thumb1.rotation.z = THREE.MathUtils.damp(thumb1.rotation.z, ease * thumbCurl, 4, delta)
    if (thumb2) thumb2.rotation.z = THREE.MathUtils.damp(thumb2.rotation.z, ease * thumbCurl * 0.6, 4, delta)
  })

  return (
    <group ref={groupRef} position={[posX, posY, posZ]} rotation={[0, rotY, 0]} scale={armScale}>
      <primitive object={scene} />
    </group>
  )
}


// ─── Scene ────────────────────────────────────────────────────────────────────
function Scene() {
  const [isFallen, setIsFallen] = useState(false)
  const [hasFallen, setHasFallen] = useState(false)
  const scrollProgressRef = useRef(0)

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

  return (
    <>
      <Stats />
      <fog attach="fog" args={['#000000', fogNear, fogFar]} />
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
        <RobotArm scrollRef={scrollProgressRef} />
      </Suspense>

      <Physics gravity={[0, -30, 0]} paused={!isFallen}>
        <ScrollControls pages={20} damping={0.1}>
          <ScrollCameraHandler isFallen={isFallen} setIsFallen={setIsFallen} setHasFallen={setHasFallen} scrollRef={scrollProgressRef} />

          <Suspense fallback={null}>
            <HelloText isFallen={isFallen} hasFallen={hasFallen} />
          </Suspense>

          {/* HTML overlay — scrolls with the 3D scene */}
          <Scroll html style={{ width: '100%', pointerEvents: 'none' }}>
            <EthosOverlay />
            <PortfolioOverlay />
          </Scroll>
        </ScrollControls>

        {/* Invisible ground */}
        <RigidBody type="fixed" position={[0, -30, 0]}>
          <mesh>
            <boxGeometry args={[50, 1, 50]} />
            <meshBasicMaterial visible={false} />
          </mesh>
        </RigidBody>
      </Physics>

      <EffectComposer>
        <Bloom
          mipmapBlur
          intensity={bloomIntensity}
          luminanceThreshold={bloomThreshold}
          luminanceSmoothing={0.9}
          radius={bloomRadius}
        />
        <ChromaticAberration offset={new Vector2(aberration, aberration)} radialModulation={true} modulationOffset={0.5} />
        <Noise opacity={noiseOpacity} />
        <Vignette eskil={false} offset={vignetteOffset} darkness={vignetteDarkness} />
      </EffectComposer>
    </>
  )
}


// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <ErrorBoundary>
      <Canvas
        camera={{ position: [0, 0, 8], fov: 45 }}
        gl={{ antialias: true }}
        dpr={[1, 1.5]}
        style={{ background: '#000000', width: '100vw', height: '100vh' }}
      >
        <Scene />
      </Canvas>
    </ErrorBoundary>
  )
}

useGLTF.preload('/spine.glb')
useGLTF.preload('/Robot%20Arm.glb')
