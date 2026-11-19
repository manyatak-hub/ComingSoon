import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { bus } from './store'

// Soft, glowing motes of gold: released when letters dissolve, and drifting up with the music.
const MAX = 1600

export function GoldDust() {
  const parts = useMemo(
    () => Array.from({ length: MAX }, () => ({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), seed: Math.random() * 10 })),
    []
  )
  const cursor = useRef(0)
  const { geom, mat } = useMemo(() => {
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3))
    geom.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(MAX), 1))
    geom.setAttribute('size', new THREE.BufferAttribute(new Float32Array(MAX).map(() => 0.6 + Math.random()), 1))
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float alpha;
        attribute float size;
        varying float vA;
        uniform float uScale;
        void main() {
          vA = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale * 90.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float core = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vec3(1.0, 0.82, 0.45) * (0.6 + core), core * core * vA);
        }`,
    })
    return { geom, mat }
  }, [])

  useEffect(
    () =>
      bus.on('dust', ({ at, count = 30, rise = 1, spread = 0.4 }) => {
        for (let n = 0; n < count; n++) {
          const q = parts[cursor.current]
          cursor.current = (cursor.current + 1) % MAX
          q.max = q.life = 2.5 + Math.random() * 2.5
          q.p.set(at.x + (Math.random() - 0.5) * spread * 2, at.y + (Math.random() - 0.3) * spread, at.z + (Math.random() - 0.5) * 0.4)
          q.v.set((Math.random() - 0.5) * 0.5, rise * (0.3 + Math.random() * 0.7), (Math.random() - 0.2) * 0.4)
        }
      }),
    [parts]
  )

  useFrame(({ gl }, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    mat.uniforms.uScale.value = gl.getPixelRatio()
    const pos = geom.attributes.position.array
    const alpha = geom.attributes.alpha.array
    for (let i = 0; i < MAX; i++) {
      const q = parts[i]
      if (q.life <= 0) {
        alpha[i] = 0
        continue
      }
      q.life -= dt
      q.v.multiplyScalar(1 - 0.9 * dt)
      q.v.y += 0.05 * dt
      q.p.addScaledVector(q.v, dt)
      q.p.x += Math.sin(q.life * 2 + q.seed) * 0.004
      const k = q.life / q.max
      alpha[i] = Math.min(1, (1 - k) * 6) * k * (0.7 + 0.3 * Math.sin(q.life * 9 + q.seed))
      pos[i * 3] = q.p.x
      pos[i * 3 + 1] = q.p.y
      pos[i * 3 + 2] = q.p.z
    }
    geom.attributes.position.needsUpdate = true
    geom.attributes.alpha.needsUpdate = true
  })

  return <points geometry={geom} material={mat} frustumCulled={false} raycast={() => null} />
}
