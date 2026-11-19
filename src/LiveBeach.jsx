import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, advance, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, PerformanceMonitor, Sky as PhysicalSky } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette, Noise, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import gsap from 'gsap'
import { CloudLayer, Sand, Ocean, Palms, Headlands, Boulders, Gulls } from './Environment'
import { Letters } from './Letters'
import { GoldDust } from './GoldDust'
import { bus, beach, reducedMotion, SUN_DIR } from './store'
import { goldEnv } from './goldEnv'

// The live 3D beach. The public page plays a video recorded from this scene;
// add ?live to the address to run it in real time, or ?capture=landscape|portrait to record it.

const IS_MOBILE =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || Math.min(window.screen.width, window.screen.height) < 820)

const SUN_POS = new THREE.Vector3(...SUN_DIR).normalize().multiplyScalar(1000)

/* Keeps the words in frame on any screen */
function CameraRig({ capture }) {
  const { camera, size } = useThree()
  const target = useMemo(() => new THREE.Vector3(0, 1.0, -3), [])
  const beat = useRef({ k: 0 })

  useEffect(() => bus.on('beat', () => gsap.fromTo(beat.current, { k: 1 }, { k: 0, duration: 0.4, ease: 'power2.out' })), [])

  useFrame(({ clock }) => {
    const aspect = size.width / size.height
    // Tall screens stack the words on two lines: a wider lens from a little higher keeps them apart.
    // Recordings leave extra room at the sides, because phones crop the video to fit their screen.
    const tall = aspect < 0.95
    const fov = tall ? 45 : 30
    const vFov = THREE.MathUtils.degToRad(fov)
    const margin = tall ? (capture ? 1.5 : 1.15) : capture ? 1.45 : 1.3
    const fitDist = (beach.textWidth * margin) / (2 * Math.tan(vFov / 2) * aspect)
    const dist = Math.max(13, fitDist)
    const t = reducedMotion || capture ? 0 : clock.elapsedTime
    const height = tall ? dist * 0.38 + 1 : dist * 0.16 + 1.2
    camera.position.set(Math.sin(t * 0.1) * 0.5, height + Math.sin(t * 0.2) * 0.06, dist + 0.8)
    camera.fov = fov + beat.current.k * 0.2
    camera.updateProjectionMatrix()
    camera.lookAt(target.x, tall ? 1.5 : target.y, target.z)
  })
  return null
}

/* Reflections for the gold: the same sky and sand, rendered once into an environment map */
function GoldReflections() {
  return (
    <Environment resolution={256} frames={1} scene={goldEnv}>
      <PhysicalSky distance={450} sunPosition={SUN_POS} turbidity={3.2} rayleigh={1.1} mieCoefficient={0.004} mieDirectionalG={0.8} />
      <mesh rotation-x={-Math.PI / 2} position-y={-1}>
        <circleGeometry args={[400, 32]} />
        <meshBasicMaterial color="#cdbb9c" />
      </mesh>
      <Lightformer form="rect" intensity={0.6} color="#ffe2b8" position={[0, 4, 14]} rotation-y={Math.PI} scale={[30, 6, 1]} />
    </Environment>
  )
}

function Scene({ capture }) {
  const lite = IS_MOBILE && !capture
  return (
    <>
      <color attach="background" args={['#cfe0ee']} />
      <fog attach="fog" args={['#c8dbea', 120, 1100]} />
      <hemisphereLight args={['#bcd6ff', '#d9c7a6', 1.6]} />
      <directionalLight
        position={SUN_POS.clone().normalize().multiplyScalar(80)}
        intensity={7}
        color="#fff0d8"
        castShadow
        shadow-mapSize={lite ? [1024, 1024] : [2048, 2048]}
        shadow-camera-left={-28}
        shadow-camera-right={28}
        shadow-camera-top={28}
        shadow-camera-bottom={-28}
        shadow-camera-far={160}
        shadow-bias={-0.0003}
        shadow-normalBias={0.02}
      />
      <GoldReflections />
      <PhysicalSky distance={450000} sunPosition={SUN_POS} turbidity={3.2} rayleigh={1.1} mieCoefficient={0.004} mieDirectionalG={0.8} />
      <CloudLayer />
      <Headlands />
      <Gulls />
      <Sand />
      <Ocean />
      <Boulders />
      <Palms />
      <Letters />
      <GoldDust />
      <CameraRig capture={capture} />
      <EffectComposer multisampling={capture ? 4 : lite ? 0 : 2} disableNormalPass>
        <Bloom mipmapBlur luminanceThreshold={1.4} luminanceSmoothing={0.3} intensity={0.35} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette offset={0.35} darkness={0.4} />
        {!lite && !capture && <Noise opacity={0.03} premultiply />}
      </EffectComposer>
    </>
  )
}

export default function LiveBeach({ capture = false }) {
  const maxDpr = IS_MOBILE ? 1.25 : 1.5
  const [dpr, setDpr] = useState(capture ? 1 : IS_MOBILE ? 1 : 1.25)

  // Recording: the capture script steps time itself and asks for exactly one frame at a time
  useEffect(() => {
    if (!capture) return
    window.__advance = () => advance(performance.now())
  }, [capture])

  return (
    <Canvas
      shadows
      dpr={dpr}
      frameloop={capture ? 'never' : 'always'}
      camera={{ fov: 30, near: 0.1, far: 1200, position: [0, 6, 13] }}
      gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.42, preserveDrawingBuffer: capture }}
    >
      {!capture && (
        <PerformanceMonitor
          onDecline={() => setDpr((d) => Math.max(0.75, d - 0.25))}
          onIncline={() => setDpr((d) => Math.min(maxDpr, d + 0.25))}
          flipflops={4}
          onFallback={() => setDpr(0.75)}
        />
      )}
      <Suspense fallback={null}>
        <Scene capture={capture} />
      </Suspense>
    </Canvas>
  )
}
