import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import fontJson from './fonts/cinzel.typeface.json'
import gsap from 'gsap'
import { shoreHeight, sandHeight, beach, bus, goldEnv } from './store'

const font = new FontLoader().parse(fontJson)
const BURIED = -1.5 // how far below the sand a letter hides
const LEAN = -0.22 // a slight backward lean, like a carved monument

// One line on wide screens, two stacked lines on tall phones
const LAYOUTS = {
  line: [{ text: 'COMING SOON', z: 0.4, size: 1.0 }],
  stack: [
    { text: 'COMING', z: -1.3, size: 1.0 },
    { text: 'SOON', z: 1.1, size: 1.0 },
  ],
}

const geoCache = {}
function glyphGeometry(ch, size) {
  const key = ch + size
  if (geoCache[key]) return geoCache[key]
  const g = new TextGeometry(ch, {
    font,
    size,
    depth: 0.16,
    curveSegments: 12,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.022,
    bevelSegments: 5,
  })
  g.computeBoundingBox()
  const bb = g.boundingBox
  g.translate(-(bb.min.x + bb.max.x) / 2, 0, -0.08)
  return (geoCache[key] = g)
}

function buildLetters(layout) {
  const letters = []
  let widest = 0
  LAYOUTS[layout].forEach((line, li) => {
    const scale = line.size / font.data.resolution
    const track = 0.14 * line.size // generous tracking reads as engraved, formal
    const chars = [...line.text]
    const widths = chars.map((ch) => font.data.glyphs[ch].ha * scale)
    const total = widths.reduce((a, b) => a + b, 0) + track * (chars.length - 1)
    widest = Math.max(widest, total)
    let x = -total / 2
    chars.forEach((ch, i) => {
      const cx = x + widths[i] / 2
      x += widths[i] + track
      if (ch === ' ') return
      letters.push({
        key: `${layout}-${li}-${i}`,
        geom: glyphGeometry(ch, line.size),
        size: line.size,
        pos: [cx, sandHeight(cx, line.z) - 0.04, line.z],
      })
    })
  })
  return { letters, width: widest }
}

export function Letters() {
  const { size } = useThree()
  const layout = size.width / size.height < 0.95 ? 'stack' : 'line'
  return <LetterSet key={layout} layout={layout} />
}

function LetterSet({ layout }) {
  const { letters, width } = useMemo(() => buildLetters(layout), [layout])
  const meshes = useRef([])
  const wiped = useRef(letters.map(() => true))
  const gold = useMemo(
    () =>
      letters.map(
        () =>
          new THREE.MeshPhysicalMaterial({
            color: '#f0c56a',
            metalness: 1,
            roughness: 0.2,
            clearcoat: 0.4,
            clearcoatRoughness: 0.2,
            envMapIntensity: 2.4,
            transparent: true,
          })
      ),
    [letters]
  )

  useEffect(() => {
    beach.textWidth = width
  }, [width])

  // The story, on a loop: gold letters rise from the sand -> hold -> a slow wave washes them away
  useEffect(() => {
    let tl
    const all = () => meshes.current.filter(Boolean)
    const cycle = () => {
      tl = gsap.timeline({ onComplete: cycle })
      tl.call(() => {
        all().forEach((m, i) => {
          m.position.set(0, BURIED, 0)
          m.rotation.set(0, 0, 0)
          m.scale.setScalar(1)
          gold[i].opacity = 1
        })
        wiped.current = letters.map(() => false)
      })
      tl.to({}, { duration: 0.8 })
      all().forEach((m, i) => {
        tl.to(m.position, { y: 0, duration: 2.0, ease: 'power3.out' }, 0.8 + i * 0.13)
        tl.call(() => bus.emit('dust', { at: letterPoint(i, 0.1), count: 10, rise: 0.6 }), null, 1.0 + i * 0.13)
      })
      tl.to({}, { duration: 3.6 }) // let people read it
      tl.to(beach, { base: 0.5, duration: 3.6, ease: 'sine.inOut' })
      tl.call(() => {
        beach.wetLine = 0.56
        beach.wet = 1
      })
      tl.to(beach, { base: -0.55, duration: 4.4, ease: 'sine.inOut' })
      tl.to(beach, { wet: 0, duration: 5.5, ease: 'power1.in' }, '<0.6')
      tl.to({}, { duration: 0.6 })
    }
    cycle()
    return () => tl?.kill()
  }, [letters, gold])

  const v = useMemo(() => new THREE.Vector3(), [])
  function letterPoint(i, h) {
    const l = letters[i]
    return v.set(l.pos[0], l.pos[1] + l.size * h, l.pos[2]).clone()
  }

  // gold reflects its own sunset studio; the rest of the beach uses plain lighting
  useFrame(() => {
    if (goldEnv.environment && gold[0] && gold[0].envMap !== goldEnv.environment) {
      gold.forEach((m) => {
        m.envMap = goldEnv.environment
        m.needsUpdate = true
      })
    }
  })

  // As the water reaches a letter, it sinks back into the sand and dissolves into gold dust
  useFrame(() => {
    letters.forEach((l, i) => {
      const m = meshes.current[i]
      if (!m || wiped.current[i]) return
      if (beach.level > shoreHeight(l.pos[0], l.pos[2]) + 0.1) {
        wiped.current[i] = true
        gsap.killTweensOf(m.position)
        const d = 2.2 + Math.random() * 0.5
        gsap.to(m.position, { y: BURIED * 0.7, z: 0.35, duration: d, ease: 'sine.inOut' })
        gsap.to(m.rotation, { x: 0.25, duration: d, ease: 'sine.out' })
        gsap.to(gold[i], { opacity: 0, duration: d * 0.8, ease: 'power1.in' })
        bus.emit('dust', { at: letterPoint(i, 0.5), count: 46, rise: 1.4, spread: l.size * 0.6 })
      }
    })
  })

  return (
    <group>
      {letters.map((l, i) => (
        <group key={l.key} position={l.pos} rotation-x={LEAN}>
          <mesh
            ref={(el) => (meshes.current[i] = el)}
            geometry={l.geom}
            material={gold[i]}
            position-y={BURIED}
            castShadow
          />
        </group>
      ))}
    </group>
  )
}
