import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { SLOPE, BAY, SUN_DIR, sandHeight, shoreHeight, beach } from './store'

// Modelled on the granite-boulder coves of the Seychelles: a curved bay of pale sand,
// a clear turquoise lagoon, a reef breaking far out, jungle headlands and leaning palms.

const SUN = new THREE.Vector3(...SUN_DIR).normalize()

const NOISE_GLSL = /* glsl */ `
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y);
  }
  float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
  float shore(vec3 w){ return ${SLOPE.toFixed(4)} * (w.z + ${BAY.toFixed(4)} * w.x * w.x); }
`

/* ---------- small JS value noise for geometry ---------- */
function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return s - Math.floor(s)
}
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const xf = x - xi, yf = y - yi, zf = z - zi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf)
  const l = (a, b, t) => a + (b - a) * t
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz)
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w
  )
}
const fbm3 = (x, y, z, o = 4) => {
  let v = 0, a = 0.5
  for (let i = 0; i < o; i++) {
    v += a * noise3(x, y, z)
    x *= 2.02; y *= 2.02; z *= 2.02; a *= 0.5
  }
  return v
}
let seed = 7
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

/* ---------- Cumulus-ish cloud layer over the physical sky ---------- */
export function CloudLayer() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        fog: false,
        uniforms: { uTime: { value: 0 }, uSunDir: { value: SUN } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform vec3 uSunDir; varying vec3 vDir;
          ${NOISE_GLSL}
          void main() {
            vec3 d = normalize(vDir);
            if (d.y < 0.0) discard;
            vec2 uv = d.xz / (d.y + 0.12) * 1.4;
            vec2 q = uv + vec2(uTime * 0.004, 0.0);
            float base = fbm(q * 0.9 + fbm(q * 0.6) * 0.8);
            float c = smoothstep(0.55, 0.75, base);
            c *= smoothstep(0.01, 0.08, d.y) * (1.0 - smoothstep(0.3, 0.6, d.y));
            float shade = fbm(q * 2.4 + 3.0);
            vec3 col = mix(vec3(1.05, 1.08, 1.15), vec3(2.6, 2.5, 2.35), smoothstep(0.35, 0.75, shade));
            gl_FragColor = vec4(col, c * 0.92);
          }`,
      }),
    []
  )
  useFrame(({ clock }) => (mat.uniforms.uTime.value = clock.elapsedTime))
  return (
    <mesh material={mat} frustumCulled={false} renderOrder={-1}>
      <sphereGeometry args={[900, 64, 32]} />
    </mesh>
  )
}

/* ---------- Sand: ripples, wet sheen at the waterline, sunlight caustics under water ---------- */
export function Sand() {
  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(130, 80, 390, 240)
    g.rotateX(-Math.PI / 2)
    g.translate(0, 0, -14)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) p.setY(i, sandHeight(p.getX(i), p.getZ(i)))
    g.computeVertexNormals()
    return g
  }, [])

  const uniforms = useMemo(() => ({ uWetLine: { value: -1 }, uWet: { value: 0 }, uLevel: { value: -0.55 }, uTime: { value: 0 } }), [])
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: '#f0dfc0', roughness: 0.95 })
    m.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, uniforms)
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      s.fragmentShader = s.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 vW; uniform float uWetLine, uWet, uLevel, uTime;
           ${NOISE_GLSL}
           float wetness() {
             float w = uWet * smoothstep(uWetLine + 0.03, uWetLine - 0.2, vW.y);
             float band = smoothstep(uLevel + 0.32 + noise(vW.xz * 0.9) * 0.1, uLevel + 0.02, vW.y);
             return max(w, band);
           }
           float caustic(vec2 p) {
             float a = noise(p * 2.2 + vec2(uTime * 0.35, uTime * 0.2));
             float b = noise(p * 2.6 - vec2(uTime * 0.25, -uTime * 0.3) + 4.0);
             return pow(1.0 - abs(a - b), 10.0);
           }`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           float grain = h21(floor(vW.xz * 110.0)) * 0.05 - 0.025;
           diffuseColor.rgb *= 1.0 + (fbm(vW.xz * 0.12) - 0.5) * 0.14;
           diffuseColor.rgb += grain;
           // tiny dark specks of shell and mineral
           diffuseColor.rgb *= 1.0 - step(0.985, h21(floor(vW.xz * 40.0))) * 0.35;
           float wet = wetness();
           diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.7, 0.66, 0.6), wet);
           float under = uLevel - vW.y;
           if (under > 0.0) {
             float c = caustic(vW.xz * 0.8) * smoothstep(0.0, 0.25, under) * smoothstep(4.0, 0.6, under);
             diffuseColor.rgb = diffuseColor.rgb * mix(vec3(1.0), vec3(0.75, 0.95, 0.95), smoothstep(0.0, 1.5, under)) + c * 0.55;
           }`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
           float rp = sin(vW.z * 7.0 + noise(vW.xz * 0.6) * 7.0 + vW.x * 0.6);
           vec3 bump = vec3(rp * 0.01, 0.0, rp * 0.03) * (0.4 + noise(vW.xz * 0.3)) * (1.0 - wetness());
           normal = normalize(normal + (viewMatrix * vec4(bump, 0.0)).xyz);`
        )
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.25, wetness());`)
    }
    return m
  }, [uniforms])

  useFrame(({ clock }) => {
    uniforms.uWetLine.value = beach.wetLine
    uniforms.uWet.value = beach.wet
    uniforms.uLevel.value = beach.level
    uniforms.uTime.value = clock.elapsedTime
  })
  const seabed = useMemo(() => {
    const g = new THREE.PlaneGeometry(900, 420, 180, 84)
    g.rotateX(-Math.PI / 2)
    g.translate(0, 0, -50 - 210 + 2)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) p.setY(i, Math.max(shoreHeight(p.getX(i), p.getZ(i)), -14) - 0.02)
    g.computeVertexNormals()
    return g
  }, [])

  return (
    <>
      <mesh geometry={geom} material={mat} receiveShadow />
      <mesh geometry={seabed} material={mat} receiveShadow />
    </>
  )
}

/* ---------- Lagoon: clear shallows, turquoise to deep blue, swash and a distant reef break ---------- */
export function Ocean() {
  const ref = useRef()
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uSunDir: { value: SUN },
          uSky: { value: new THREE.Color(1.15, 1.55, 2.1) },
        },
        vertexShader: /* glsl */ `
          uniform float uTime;
          varying vec3 vW;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            float far = smoothstep(4.0, 40.0, -w.z);
            w.y += far * (0.06 * sin(w.z * 0.35 + uTime * 0.9) + 0.03 * sin(w.x * 0.21 - uTime * 0.6));
            vW = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uSunDir, uSky;
          varying vec3 vW;
          ${NOISE_GLSL}
          vec3 waterNormal(vec2 p, float t, float strength) {
            vec2 g = vec2(0.0);
            vec4 W[6];
            W[0] = vec4( 0.1,  1.0, 0.7, 0.05);
            W[1] = vec4( 0.6,  0.8, 1.6, 0.018);
            W[2] = vec4(-0.5,  0.9, 2.7, 0.010);
            W[3] = vec4( 0.9, -0.2, 4.9, 0.005);
            W[4] = vec4(-0.8, -0.5, 8.3, 0.003);
            W[5] = vec4( 0.3, -0.9, 13.1, 0.0016);
            for (int i = 0; i < 6; i++) {
              vec2 dir = normalize(W[i].xy);
              float k = W[i].z;
              float ph = dot(dir, p) * k + t * sqrt(9.8 * k) * 0.6;
              g += dir * k * W[i].w * cos(ph);
            }
            g += (vec2(noise(p * 3.0 + t * 0.5), noise(p * 3.0 - t * 0.4 + 9.0)) - 0.5) * 0.05;
            return normalize(vec3(-g.x * strength, 1.0, -g.y * strength));
          }
          void main() {
            float depth = vW.y - shore(vW);
            if (depth < -0.02) discard;
            vec3 V = normalize(cameraPosition - vW);
            float dist = length(vW - cameraPosition);
            vec3 N = waterNormal(vW.xz, uTime, mix(0.5, 1.0, smoothstep(0.0, 2.0, depth)));
            N = normalize(mix(N, vec3(0.0, 1.0, 0.0), smoothstep(40.0, 250.0, dist) * 0.75));

            // colour by depth: clear, turquoise, aquamarine, deep ocean blue
            vec3 c1 = vec3(0.6, 1.05, 0.95);
            vec3 c2 = vec3(0.1, 0.85, 0.85);
            vec3 c3 = vec3(0.02, 0.5, 0.72);
            vec3 c4 = vec3(0.01, 0.12, 0.3);
            vec3 col = mix(c1, c2, smoothstep(0.0, 0.9, depth));
            col = mix(col, c3, smoothstep(0.8, 3.5, depth));
            col = mix(col, c4, smoothstep(5.0, 14.0, depth));
            col *= 1.0 + (fbm(vW.xz * 0.15) - 0.5) * 0.35; // seagrass and sand patches

            float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
            col = mix(col, uSky, clamp(fres * 0.75, 0.0, 0.55));
            vec3 R = reflect(-V, N);
            float sp = max(dot(R, uSunDir), 0.0);
            col += vec3(1.0, 0.92, 0.8) * pow(sp, 400.0) * 6.0;

            // swash foam at the edge, breaking line on the reef far out
            float n = noise(vW.xz * 1.6 + vec2(uTime * 0.3, 0.0));
            float edge = smoothstep(0.07 + n * 0.08, 0.0, depth);
            float bubbles = smoothstep(0.55, 0.85, fbm(vW.xz * 2.5 + vec2(0.0, -uTime * 0.5))) * smoothstep(0.3, 0.02, depth);
            float reefZ = -62.0 + 6.0 * sin(vW.x * 0.03) + 4.0 * noise(vW.xz * 0.05);
            float crest = exp(-pow((vW.z - reefZ) / 1.6, 2.0)) * smoothstep(0.35, 0.7, fbm(vec2(vW.x * 0.15 - uTime * 0.2, uTime * 0.15)));
            float wash = exp(-pow((vW.z - reefZ - 3.5) / 3.5, 2.0)) * fbm(vW.xz * 0.4 + uTime * 0.1) * 0.6;
            float foam = clamp(edge * 0.9 + bubbles * 0.45 + crest * 0.95 + wash * 0.5, 0.0, 1.0);
            col = mix(col, vec3(2.0, 2.0, 1.95), foam);

            float alpha = mix(0.18, 0.97, smoothstep(0.0, 2.2, depth));
            alpha = max(alpha, fres * 0.9);
            alpha = max(alpha, foam * 0.92) * smoothstep(-0.02, 0.03, depth);
            col = mix(col, uSky * 0.95, smoothstep(250.0, 900.0, dist));
            gl_FragColor = vec4(col, alpha);
          }`,
      }),
    []
  )
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    // swash: a quick run-up then a slow backwash, every ~7 seconds
    const ph = (t % 7) / 7
    const swash = ph < 0.3 ? Math.sin((ph / 0.3) * Math.PI * 0.5) : Math.cos(((ph - 0.3) / 0.7) * Math.PI * 0.5)
    beach.level = beach.base + 0.1 * swash * swash + 0.015 * Math.sin(t * 2.3)
    ref.current.position.y = beach.level
    mat.uniforms.uTime.value = t
  })
  return (
    <mesh ref={ref} material={mat} rotation-x={-Math.PI / 2} position-z={-180} raycast={() => null}>
      <planeGeometry args={[800, 420, 300, 210]} />
    </mesh>
  )
}

/* ---------- Jungle headlands: forested ridges with granite at the waterline ---------- */
function headlandGeometry(side) {
  const W = 90, D = 140
  const g = new THREE.PlaneGeometry(W, D, 220, 300)
  g.rotateX(-Math.PI / 2)
  g.translate(side * (14 + W / 2), 0, -D / 2 + 6)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i)
    const ax = Math.abs(x)
    // a ridge that rises away from the beach and runs out to sea, then tapers into a point
    const inland = THREE.MathUtils.smoothstep(ax, 13 + Math.max(0, -z) * 0.12, 40)
    const point = 1 - THREE.MathUtils.smoothstep(-z, 50, 120)
    const ridge = fbm3(x * 0.025, 0.0, z * 0.025) * 1.5 + fbm3(x * 0.08, 3.0, z * 0.08) * 0.5
    let h = inland * point * (6 + 26 * ridge)
    h += inland * (fbm3(x * 0.5, 1.0, z * 0.5) - 0.5) * 2.2 // tree canopy bumps
    h -= (1 - inland) * 0.8
    p.setY(i, h + shoreHeight(x, z))
  }
  g.computeVertexNormals()
  return g
}

export function Headlands() {
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 })
    m.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vW; varying vec3 vN;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz; vN = normalize(mat3(modelMatrix) * objectNormal);')
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vW; varying vec3 vN;\n${NOISE_GLSL}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           float canopy = fbm(vW.xz * 0.8);
           float crowns = fbm(vW.xz * 1.8 + vW.y);
           vec3 jungle = mix(vec3(0.03, 0.09, 0.03), vec3(0.14, 0.26, 0.07), canopy) * (0.6 + 0.8 * crowns);
           jungle = mix(jungle, vec3(0.24, 0.32, 0.1), step(0.72, fbm(vW.xz * 2.1)) * 0.6);
           float steep = 1.0 - vN.y;
           vec3 granite = mix(vec3(0.42, 0.36, 0.33), vec3(0.62, 0.55, 0.5), fbm(vW.xz * 1.3 + vW.y));
           float rockiness = max(smoothstep(1.8, 0.1, vW.y) * smoothstep(0.1, 0.35, steep + 0.2), smoothstep(0.75, 0.95, steep + (canopy - 0.5) * 0.3));
           vec3 c = mix(jungle, granite, rockiness);
           c = mix(c, vec3(0.86, 0.8, 0.68), smoothstep(0.25, -0.2, vW.y) * 0.6);
           diffuseColor.rgb = c;`
        )
    }
    return m
  }, [])
  const left = useMemo(() => headlandGeometry(-1), [])
  const right = useMemo(() => headlandGeometry(1), [])
  const island = useMemo(() => {
    const g = new THREE.SphereGeometry(1, 64, 32)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i)
      p.setY(i, Math.max(y, -0.05) * (0.8 + fbm3(p.getX(i) * 3, y * 3, p.getZ(i) * 3) * 0.5))
    }
    g.computeVertexNormals()
    return g
  }, [])
  return (
    <group>
      <mesh geometry={left} material={mat} receiveShadow castShadow />
      <mesh geometry={right} material={mat} receiveShadow />
      <mesh geometry={island} material={mat} position={[-70, -1.2, -330]} scale={[55, 18, 22]} />
      <mesh geometry={island} material={mat} position={[120, -1.2, -420]} scale={[40, 11, 18]} />
    </group>
  )
}

/* ---------- Granite boulders, rounded and streaked like the Seychelles ---------- */
function boulderGeometry(seedOffset) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 6).deleteAttribute('normal').deleteAttribute('uv'))
  const p = g.attributes.position
  const v = new THREE.Vector3()
  const colors = []
  const c = new THREE.Color()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const n = fbm3(v.x * 0.9 + seedOffset, v.y * 0.9, v.z * 0.9)
    v.multiplyScalar(0.75 + n * 0.55)
    if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.3 // flattened, settled base
    p.setXYZ(i, v.x, v.y, v.z)
    // vertical weathering streaks, pink-grey granite
    const streak = Math.pow(Math.abs(Math.sin(v.x * 7 + v.z * 5 + fbm3(v.x * 2, v.y * 0.5, v.z * 2) * 6)), 6)
    const base = 0.55 + 0.25 * fbm3(v.x * 4, v.y * 4, v.z * 4)
    c.setRGB(0.66 * base + 0.08, 0.56 * base + 0.06, 0.52 * base + 0.06).multiplyScalar(1 - streak * 0.35 * THREE.MathUtils.clamp(v.y + 0.6, 0, 1))
    colors.push(c.r, c.g, c.b)
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  g.computeVertexNormals()
  return g
}

export function Boulders() {
  const list = useMemo(() => {
    const spots = [
      // left cluster
      [-8.6, -4.5, [3.2, 2.6, 2.8], 0.4],
      [-11.2, -6.8, [4.5, 3.8, 3.6], 1.1],
      [-6.9, -7.5, [1.5, 1.1, 1.4], 2.2],
      [-13.5, -2.5, [2.6, 2.4, 2.4], 0.8],
      [-9.8, -10.5, [2.4, 1.6, 2.2], 3.0],
      // right cluster
      [9.5, -5.5, [3.6, 3.0, 3.0], 1.7],
      [12.6, -8.5, [5, 4.2, 4], 2.6],
      [7.6, -8.2, [1.4, 0.9, 1.2], 0.2],
      [14.5, -3.8, [2.8, 2.6, 2.6], 3.3],
      // a few out in the lagoon
      [-4.5, -16, [1.3, 0.7, 1.1], 1.4],
      [5.5, -22, [2.0, 1.2, 1.6], 2.4],
    ]
    return spots.map(([x, z, s, r], i) => ({ g: boulderGeometry(i * 3.7), pos: [x, sandHeight(x, z) - s[1] * 0.12, z], s, r }))
  }, [])
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 })
    m.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vW;\n${NOISE_GLSL}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           // feldspar and mica speckle
           float sp = h21(floor(vW.xz * 140.0 + vW.y * 97.0));
           diffuseColor.rgb *= 0.93 + 0.14 * sp;
           diffuseColor.rgb *= 1.0 - step(0.96, sp) * 0.3;
           diffuseColor.rgb *= 0.85 + 0.3 * fbm(vW.xz * 3.0 + vW.y * 2.0);
           diffuseColor.rgb *= mix(0.7, 1.0, smoothstep(-0.6, 0.4, vW.y)); // darker where the sea wets it`
        )
    }
    return m
  }, [])
  return list.map((b, i) => (
    <mesh key={i} geometry={b.g} material={mat} position={b.pos} scale={b.s} rotation-y={b.r} castShadow receiveShadow />
  ))
}

/* ---------- Coconut palms with individual leaflets ---------- */
function buildPalm({ height, lean, bend, twist }) {
  // trunk
  const pts = []
  for (let i = 0; i <= 20; i++) {
    const t = i / 20
    pts.push(new THREE.Vector3(Math.sin(t * bend) / bend * lean * height, t * height * (1 - 0.15 * lean * lean), Math.sin(t * 2.2 + twist) * 0.25))
  }
  const curve = new THREE.CatmullRomCurve3(pts)
  const TUB = 140, RAD = 12
  const trunk = new THREE.TubeGeometry(curve, TUB, 1, RAD, false)
  const tp = trunk.attributes.position
  const tcol = []
  const ctr = new THREE.Vector3(), v = new THREE.Vector3()
  for (let i = 0; i <= TUB; i++) {
    const t = i / TUB
    curve.getPointAt(t, ctr)
    const r = 0.24 - 0.1 * t + 0.08 * Math.exp(-t * 18) + 0.012 * Math.sin(i * 1.7) // flared base, ring scars
    const ring = 0.86 + 0.14 * Math.sin(i * 1.7)
    for (let j = 0; j <= RAD; j++) {
      const k = i * (RAD + 1) + j
      v.fromBufferAttribute(tp, k).sub(ctr).multiplyScalar(r).add(ctr)
      tp.setXYZ(k, v.x, v.y, v.z)
      const g = (0.42 + 0.06 * Math.sin(j * 2.1 + i)) * ring
      tcol.push(g * 0.95, g * 0.85, g * 0.72)
    }
  }
  trunk.setAttribute('color', new THREE.Float32BufferAttribute(tcol, 3))
  trunk.computeVertexNormals()

  // fronds: a drooping rachis with leaflets on both sides
  const crown = pts[pts.length - 1]
  const tip = curve.getTangentAt(1)
  const verts = []
  const cols = []
  const idx = []
  const NF = 15
  for (let f = 0; f < NF; f++) {
    const az = (f / NF) * Math.PI * 2 + rand() * 0.4
    const young = f % 4 === 0
    const elev = young ? 0.9 + rand() * 0.3 : 0.2 + rand() * 0.45
    const L = (young ? 2.6 : 3.4) + rand() * 0.8
    const droop = young ? 0.08 : 0.28 + rand() * 0.12
    const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az))
    const side = new THREE.Vector3(-dir.z, 0, dir.x)
    const rachis = (t) =>
      crown.clone().add(tip.clone().multiplyScalar(0.1)).addScaledVector(dir, L * t * Math.cos(elev)).add(new THREE.Vector3(0, L * t * Math.sin(elev) - droop * (L * t) ** 2, 0))
    const NL = 34
    for (let k = 0; k < NL; k++) {
      const t = 0.12 + (k / NL) * 0.88
      const base = rachis(t)
      const fwd = rachis(Math.min(1, t + 0.02)).sub(base).normalize()
      const len = (0.95 * Math.sin(Math.PI * Math.min(1, t * 1.05)) + 0.2) * (young ? 0.8 : 1)
      for (const s of [-1, 1]) {
        if (rand() < 0.06) continue // a few torn leaflets
        const out = side.clone().multiplyScalar(s).addScaledVector(fwd, 0.55).normalize()
        const sag = 0.35 + t * 0.4
        const w = 0.055
        const segs = 3
        const start = verts.length / 3
        for (let q = 0; q <= segs; q++) {
          const u = q / segs
          const pnt = base.clone().addScaledVector(out, len * u).add(new THREE.Vector3(0, -sag * len * u * u - 0.08 * u, 0))
          const half = w * (1 - u * 0.85)
          verts.push(pnt.x + fwd.x * half, pnt.y + fwd.y * half, pnt.z + fwd.z * half)
          verts.push(pnt.x - fwd.x * half, pnt.y - fwd.y * half, pnt.z - fwd.z * half)
          const dry = young ? 0 : Math.max(0, u - 0.7) * (0.6 + rand() * 0.6)
          const g = 0.75 + rand() * 0.25
          const cr = (0.16 + dry * 0.35) * g, cg = (0.3 + dry * 0.12) * g, cb = (0.07 + dry * 0.02) * g
          cols.push(cr, cg, cb, cr * 0.85, cg * 0.85, cb * 0.85)
        }
        for (let q = 0; q < segs; q++) {
          const a = start + q * 2
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
        }
      }
    }
  }
  const fronds = new THREE.BufferGeometry()
  fronds.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  fronds.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  fronds.setIndex(idx)
  fronds.computeVertexNormals()

  // coconuts
  const nuts = []
  for (let n = 0; n < 6; n++) {
    const a = n * 1.05 + rand()
    const g = new THREE.SphereGeometry(0.13, 10, 8)
    g.translate(crown.x + Math.cos(a) * 0.2, crown.y - 0.28 - rand() * 0.12, crown.z + Math.sin(a) * 0.2)
    nuts.push(g)
  }
  return { trunk, fronds, nuts: mergeGeometries(nuts), crown }
}

export function Palms() {
  const palms = useMemo(() => {
    seed = 11
    const spec = [
      { pos: [-9.2, -1.2], height: 7.5, lean: 0.55, bend: 1.4, twist: 0.0, ry: 0.15 },
      { pos: [-11.5, 0.8], height: 6.4, lean: 0.35, bend: 1.0, twist: 1.0, ry: -0.2 },
      { pos: [-12.8, -3.6], height: 8.6, lean: 0.18, bend: 0.8, twist: 2.0, ry: 0.4 },
      { pos: [10.2, -1.8], height: 7.2, lean: 0.6, bend: 1.5, twist: 0.5, ry: Math.PI - 0.1 },
      { pos: [12.6, 0.2], height: 8.2, lean: 0.25, bend: 0.9, twist: 1.6, ry: Math.PI + 0.3 },
      { pos: [13.8, -4.4], height: 6.0, lean: 0.4, bend: 1.2, twist: 2.4, ry: Math.PI - 0.5 },
    ]
    return spec.map((s) => ({ ...s, ...buildPalm(s), y: sandHeight(s.pos[0], s.pos[1]) - 0.15, off: rand() * 10 }))
  }, [])
  const refs = useRef([])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    palms.forEach((p, i) => {
      const g = refs.current[i]
      if (g) g.rotation.z = Math.sin(t * 0.5 + p.off) * 0.006 + Math.sin(t * 1.3 + p.off) * 0.003
    })
  })
  return palms.map((p, i) => (
    <group key={i} position={[p.pos[0], p.y, p.pos[1]]} rotation-y={p.ry} ref={(el) => (refs.current[i] = el)}>
      <mesh geometry={p.trunk} castShadow receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.95} />
      </mesh>
      <mesh geometry={p.fronds} castShadow>
        <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.65} />
      </mesh>
      <mesh geometry={p.nuts} castShadow>
        <meshStandardMaterial color="#5e4a22" roughness={0.5} />
      </mesh>
    </group>
  ))
}

/* ---------- Seabirds gliding far out ---------- */
export function Gulls() {
  const birds = useMemo(
    () =>
      Array.from({ length: 4 }, (_, i) => ({
        r: 22 + i * 7,
        y: 12 + i * 2.5,
        z: -55 - i * 10,
        speed: 0.035 + i * 0.008,
        phase: i * 1.7,
        flap: i * 2.3,
      })),
    []
  )
  const wing = useMemo(() => {
    const g = new THREE.PlaneGeometry(0.9, 0.16)
    g.translate(0.45, 0, 0)
    return g
  }, [])
  const refs = useRef([])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    birds.forEach((b, i) => {
      const o = refs.current[i]
      if (!o) return
      const a = b.phase + t * b.speed
      o.position.set(Math.cos(a) * b.r, b.y + Math.sin(t * 0.5 + i) * 0.6, b.z + Math.sin(a) * 6)
      o.rotation.y = -a + Math.PI / 2
      const f = Math.sin(t * 7 + b.flap) * (Math.sin(t * 0.4 + b.flap) > 0.4 ? 0.5 : 0.06) + 0.12
      o.children[0].rotation.z = f
      o.children[1].rotation.z = Math.PI - f
    })
  })
  return birds.map((b, i) => (
    <group key={i} ref={(el) => (refs.current[i] = el)}>
      {[0, 1].map((k) => (
        <group key={k}>
          <mesh geometry={wing} rotation-x={-Math.PI / 2}>
            <meshBasicMaterial color="#3d3a3a" side={THREE.DoubleSide} fog={false} />
          </mesh>
        </group>
      ))}
    </group>
  ))
}
