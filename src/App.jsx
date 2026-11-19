import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, Sky as PhysicalSky } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette, Noise, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import gsap from 'gsap'
import { CloudLayer, Sand, Ocean, Palms, Headlands, Boulders, Gulls } from './Environment'
import { Letters } from './Letters'
import { GoldDust } from './GoldDust'
import { PartyMusic } from './audio'
import { bus, sandHeight, beach, reducedMotion, goldEnv, SUN_DIR } from './store'

const SUN_POS = new THREE.Vector3(...SUN_DIR).normalize().multiplyScalar(1000)

/* Keeps the words in frame on any screen, with a slow, cinematic drift */
function CameraRig() {
  const { camera, size } = useThree()
  const target = useMemo(() => new THREE.Vector3(0, 1.0, -3), [])
  const beat = useRef({ k: 0 })

  useEffect(() => bus.on('beat', () => gsap.fromTo(beat.current, { k: 1 }, { k: 0, duration: 0.4, ease: 'power2.out' })), [])

  useFrame(({ clock }) => {
    const aspect = size.width / size.height
    // Tall phone screens stack the words on two lines: a wider lens from a little higher keeps them apart
    const tall = aspect < 0.95
    const fov = tall ? 45 : 30
    const vFov = THREE.MathUtils.degToRad(fov)
    const fitDist = (beach.textWidth * (tall ? 1.15 : 1.3)) / (2 * Math.tan(vFov / 2) * aspect)
    const dist = Math.max(13, fitDist)
    const t = reducedMotion ? 0 : clock.elapsedTime
    const height = tall ? dist * 0.38 + 1 : dist * 0.16 + 1.2
    camera.position.set(Math.sin(t * 0.1) * 0.5, height + Math.sin(t * 0.2) * 0.06, dist + 0.8)
    camera.fov = fov + beat.current.k * 0.2
    camera.updateProjectionMatrix()
    camera.lookAt(target.x, tall ? 1.5 : target.y, target.z)
  })
  return null
}

/* Reflections for the gold: a warm sunset studio made of light panels (no image downloads) */
function GoldenHourReflections() {
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

function Scene() {
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
        shadow-mapSize={[4096, 4096]}
        shadow-camera-left={-70}
        shadow-camera-right={70}
        shadow-camera-top={70}
        shadow-camera-bottom={-70}
        shadow-camera-far={200}
        shadow-bias={-0.0003}
        shadow-normalBias={0.02}
      />
      <GoldenHourReflections />
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
      <CameraRig />
      <EffectComposer multisampling={4} disableNormalPass>
        <Bloom mipmapBlur luminanceThreshold={1.4} luminanceSmoothing={0.3} intensity={0.35} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette offset={0.35} darkness={0.4} />
        <Noise opacity={0.03} premultiply />
      </EffectComposer>
    </>
  )
}

export default function App() {
  const music = useMemo(() => new PartyMusic(), [])
  const [on, setOn] = useState(false)
  const busy = useRef(false)

  useEffect(() => {
    music.onBeat = (downbeat) => {
      bus.emit('beat')
      // a few motes of gold drift up on every beat while the music plays
      const x = (Math.random() - 0.5) * 14
      const z = -1 + Math.random() * 4
      bus.emit('dust', { at: new THREE.Vector3(x, sandHeight(x, z) + 0.2, z), count: downbeat ? 14 : 6, rise: 0.8, spread: 1.2 })
    }
    return () => music.stop()
  }, [music])

  // Tap anywhere: play / pause
  const toggle = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      if (music.playing) {
        music.stop()
        setOn(false)
      } else {
        await music.start()
        setOn(true)
        bus.emit('dust', { at: new THREE.Vector3(0, 0.6, 0.6), count: 120, rise: 1.2, spread: 5 })
      }
    } finally {
      busy.current = false
    }
  }, [music])

  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  return (
    <main className="stage" onClick={toggle}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ fov: 30, near: 0.1, far: 1200, position: [0, 6, 13] }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.42 }}
      >
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>

      <header className="top">
        <span className="rule" aria-hidden="true" />
        <p className="eyebrow">Something extraordinary is on the horizon</p>
        <span className="rule" aria-hidden="true" />
      </header>

      <footer className="bottom">
        <div className={`sound ${on ? 'is-on' : ''}`} role="status" aria-live="polite">
          <span className="eq" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>{on ? 'Tap anywhere to pause' : 'Tap anywhere for music'}</span>
        </div>
      </footer>
    </main>
  )
}
