import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, advance, useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import gsap from 'gsap'

// Looking down at the water's edge: lacy foam over smooth sand, shells and seaweed,
// and a clear turquoise wave that builds, breaks and washes the words out of the sand.

const SLOPE = 0.05 // sand rises toward the viewer
const sandY = (x, z) => SLOPE * z + 0.16 * Math.min(z + 3, 0) + 0.012 * Math.sin(x * 2.1 + z * 0.7) * Math.cos(z * 1.6 - x * 0.5)
const SUN = new THREE.Vector3(2.5, 7, -6).normalize()

// The whole scene runs at this fraction of its designed pace: calm, unhurried water
const SPEED = 0.6

// Everything the shaders and the timeline share
const shore = {
  front: -3.2, // where the water's edge is (z), before lapping and wobble
  maxFront: -3.2, // furthest the water has reached this cycle (for wet sand and erased letters)
  wet: 0, // how wet the sand behind the edge still is
  reveal: 0, // how much of the writing has appeared
  crestZ: -18, // the incoming wave's crest
  crestH: 0,
  surge: 0, // 1 while the broken wave is rushing up the sand
  flow: 0, // accumulated water movement, used to drift the foam
}

const GLSL = /* glsl */ `
  uniform float uTime, uFront, uMaxFront, uWet, uReveal, uCrestZ, uCrestH, uSurge, uFlow;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec2 hash2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
  float sandY(vec2 p){ return ${SLOPE.toFixed(3)} * p.y + 0.16 * min(p.y + 3.0, 0.0) + 0.012 * sin(p.x * 2.1 + p.y * 0.7) * cos(p.y * 1.6 - p.x * 0.5); }
  float wobble(float x){
    return 0.55 * sin(x * 0.31 + uTime * 0.22) + 0.6 * (noise(vec2(x * 0.42, uTime * 0.12)) - 0.5) + 0.25 * (noise(vec2(x * 1.6, uTime * 0.35)) - 0.5);
  }
  float frontZ(float x){ return uFront + wobble(x); }
  float maxFrontZ(float x){ return uMaxFront + wobble(x) * 0.6; }
  // distance between the foam cells: thin lines where two cells meet = lacy foam
  float cellEdge(vec2 x){
    vec2 n = floor(x), f = fract(x);
    float F1 = 8.0, F2 = 8.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash2(n + g);
      o = 0.5 + 0.45 * sin(uTime * 0.5 + 6.2831 * o);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < F1) { F2 = F1; F1 = d; } else if (d < F2) { F2 = d; }
    }
    return sqrt(F2) - sqrt(F1);
  }
`

function useShoreUniforms() {
  return useMemo(
    () => ({
      uTime: { value: 0 },
      uFront: { value: shore.front },
      uMaxFront: { value: shore.maxFront },
      uWet: { value: 0 },
      uReveal: { value: 0 },
      uCrestZ: { value: shore.crestZ },
      uCrestH: { value: 0 },
      uSurge: { value: 0 },
      uFlow: { value: 0 },
      uText: { value: null },
      uTextRect: { value: new THREE.Vector4(-5.5, 0.4, 11, 2.75) },
      uTextTexel: { value: new THREE.Vector2(1 / 2048, 1 / 512) },
      uLines: { value: 1 },
      uSun: { value: SUN },
    }),
    []
  )
}

/* ---------- "COMING SOON" pressed into the sand (rendered once into a texture) ---------- */
async function makeTextTexture(tall) {
  try {
    await document.fonts.load('600 200px Cinzel')
  } catch {
    /* fall back to a serif */
  }
  const W = tall ? 1024 : 2048
  const H = tall ? 1024 : 512
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  const draw = (blur) => {
    const layer = document.createElement('canvas')
    layer.width = W
    layer.height = H
    const l = layer.getContext('2d')
    l.fillStyle = '#000'
    l.fillRect(0, 0, W, H)
    l.filter = `blur(${blur}px)`
    l.fillStyle = '#fff'
    l.textAlign = 'center'
    l.textBaseline = 'middle'
    if ('letterSpacing' in l) l.letterSpacing = tall ? '10px' : '18px'
    if (tall) {
      l.font = `600 200px Cinzel, "Times New Roman", serif`
      l.fillText('COMING', W / 2, H * 0.3)
      l.fillText('SOON', W / 2, H * 0.72)
    } else {
      l.font = `600 205px Cinzel, "Times New Roman", serif`
      l.fillText('COMING SOON', W / 2, H * 0.54)
    }
    return l.getImageData(0, 0, W, H).data
  }
  const sharp = draw(3) // the groove
  const wide = draw(14) // the sand pushed up around it
  const out = g.createImageData(W, H)
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = sharp[i]
    out.data[i + 1] = wide[i]
    out.data[i + 2] = 0
    out.data[i + 3] = 255
  }
  g.putImageData(out, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.NoColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  return tex
}

/* ---------- Sand ---------- */
function Sand({ u }) {
  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(70, 70, 280, 280)
    g.rotateX(-Math.PI / 2)
    g.translate(0, 0, -15)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) p.setY(i, sandY(p.getX(i), p.getZ(i)))
    g.computeVertexNormals()
    return g
  }, [])
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: '#efd8b2', roughness: 0.92 })
    m.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, u)
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      s.fragmentShader = s.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 vW;
           uniform sampler2D uText; uniform vec4 uTextRect; uniform vec2 uTextTexel; uniform float uLines; uniform vec3 uSun;
           ${GLSL}
           float writing(vec2 uv) {
             if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
             vec2 t = texture2D(uText, uv).rg;
             // reveal left to right (and line by line when stacked)
             float key = uLines > 1.5 ? (uv.x * 0.5 + (uv.y < 0.5 ? 0.0 : 0.5)) : uv.x;
             float shown = 1.0 - smoothstep(uReveal * 1.1 - 0.08, uReveal * 1.1 - 0.01, key);
             return (-t.r + 0.45 * max(t.g - t.r * 0.8, 0.0)) * shown;
           }
           vec2 textUV(vec2 p) { return vec2((p.x - uTextRect.x) / uTextRect.z, 1.0 - (p.y - uTextRect.y) / uTextRect.w); }
           float eraseAt(vec2 p) { return clamp((maxFrontZ(p.x) - p.y) * 1.2 + 0.1, 0.0, 1.0); }`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           vec2 p = vW.xz;
           diffuseColor.rgb *= 1.0 + (fbm(p * 0.25) - 0.5) * 0.12;
           diffuseColor.rgb += hash(floor(p * 140.0)) * 0.05 - 0.025;
           diffuseColor.rgb *= 1.0 - step(0.992, hash(floor(p * 55.0))) * 0.3;
           float d = frontZ(p.x) - p.y;                       // > 0: under water
           float wetBand = smoothstep(-1.4, 0.0, d);          // damp strip just above the edge
           float wetOld = uWet * step(0.0, maxFrontZ(p.x) - p.y) * (0.6 + 0.4 * noise(p * 0.8));
           float wet = max(wetBand, wetOld);
           diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.6, 0.58), wet);
           // letters: grooves read darker
           vec2 tuv = textUV(p);
           float er = eraseAt(p);
           float hgt = writing(tuv) * (1.0 - er);
           diffuseColor.rgb *= 1.0 + hgt * 0.35;
           if (d > 0.0) {
             float a = noise(p * 2.4 + vec2(uTime * 0.6, uTime * 0.3));
             float b = noise(p * 2.7 - vec2(uTime * 0.4, -uTime * 0.5) + 3.0);
             float caustic = pow(1.0 - abs(a - b), 12.0) * smoothstep(0.0, 0.6, d) * smoothstep(0.3, 0.7, noise(p * 0.5 + uTime * 0.05));
             diffuseColor.rgb = diffuseColor.rgb * mix(vec3(1.0), vec3(0.7, 0.92, 0.9), smoothstep(0.0, 3.0, d)) + caustic * 0.22;
           }`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
           {
             vec2 p2 = vW.xz;
             float er2 = eraseAt(p2);
             vec2 tuv2 = textUV(p2);
             float hx = writing(tuv2 + vec2(uTextTexel.x * 2.0, 0.0)) - writing(tuv2 - vec2(uTextTexel.x * 2.0, 0.0));
             float hz = writing(tuv2 - vec2(0.0, uTextTexel.y * 2.0)) - writing(tuv2 + vec2(0.0, uTextTexel.y * 2.0));
             vec3 tn = vec3(-hx, 0.0, -hz) * 1.6 * (1.0 - er2);
             // fine wind ripples on the dry sand
             float rp = sin(p2.y * 11.0 + noise(p2 * 0.8) * 6.0 + p2.x * 0.7);
             float dry = 1.0 - smoothstep(-1.4, 0.0, frontZ(p2.x) - p2.y);
             tn += vec3(rp * 0.01, 0.0, rp * 0.03) * dry * (0.4 + noise(p2 * 0.4));
             normal = normalize(normal + (viewMatrix * vec4(tn, 0.0)).xyz);
           }`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
           {
             vec2 p3 = vW.xz;
             float d3 = frontZ(p3.x) - p3.y;
             float w3 = max(smoothstep(-1.4, 0.0, d3), uWet * step(0.0, maxFrontZ(p3.x) - p3.y));
             roughnessFactor = mix(roughnessFactor, 0.42, w3);
           }`
        )
    }
    return m
  }, [u])
  return <mesh geometry={geom} material={mat} receiveShadow />
}

/* ---------- Water: clear turquoise, lacy foam, a glassy breaking crest ---------- */
function Water({ u }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: u,
        vertexShader: /* glsl */ `
          ${GLSL}
          varying vec3 vW; varying float vD; varying float vDepth; varying float vCrest;
          float crestShape(float s) {
            // gentle back, steep face toward the beach
            return s < 0.0 ? exp(-pow(s / 2.6, 2.0)) : exp(-pow(s / 0.7, 2.0));
          }
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            float sy = sandY(w.xz);
            float d = frontZ(w.x) - w.z;
            float sheet = 0.05 * smoothstep(0.0, 2.0, d) + uSurge * 0.16 * smoothstep(0.0, 1.2, d) * smoothstep(5.0, 1.5, d);
            float crest = uCrestH * crestShape(w.z - uCrestZ) * (0.85 + 0.15 * sin(w.x * 0.4 + uTime));
            float swell = 0.035 * sin(w.z * 1.1 - uTime * 1.6 + w.x * 0.2) * smoothstep(0.5, 4.0, d);
            w.y = max(0.0, sy) + sheet + crest + swell;
            vW = w.xyz; vD = d; vDepth = w.y - sy; vCrest = crest;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          ${GLSL}
          uniform vec3 uSun;
          varying vec3 vW; varying float vD; varying float vDepth; varying float vCrest;
          void main() {
            vec2 p = vW.xz;
            float d = frontZ(p.x) - p.y;
            if (d < 0.0) discard;
            float depth = max(vDepth, 0.0);

            // ripples -> normal
            vec2 q = p * 2.0;
            float t = uTime;
            vec2 g = vec2(0.0);
            g += vec2(0.6, 0.8) * 0.05 * cos(dot(q, vec2(0.6, 0.8)) * 1.3 + t * 1.6);
            g += vec2(-0.7, 0.7) * 0.035 * cos(dot(q, vec2(-0.7, 0.7)) * 2.1 + t * 2.1);
            g += vec2(0.2, -1.0) * 0.02 * cos(dot(q, vec2(0.2, -1.0)) * 3.7 + t * 2.7);
            g += (vec2(noise(q * 1.5 + t * 0.4), noise(q * 1.5 - t * 0.35 + 5.0)) - 0.5) * 0.12;
            float sc0 = p.y - uCrestZ;
            float hc = sc0 < 0.0 ? exp(-pow(sc0 / 2.6, 2.0)) : exp(-pow(sc0 / 0.7, 2.0));
            float dhc = (sc0 < 0.0 ? -2.0 * sc0 / (2.6 * 2.6) : -2.0 * sc0 / (0.7 * 0.7)) * hc * uCrestH;
            vec3 N = normalize(vec3(-g.x, 1.0, -g.y - dhc * 1.4));
            vec3 V = normalize(cameraPosition - vW);

            // colour: clear over sand, turquoise, then deep teal
            vec3 clear = vec3(0.6, 0.92, 0.84);
            vec3 turq = vec3(0.05, 0.66, 0.66);
            vec3 deep = vec3(0.01, 0.24, 0.34);
            vec3 col = mix(clear, turq, 1.0 - exp(-depth * 2.6));
            col = mix(col, deep, 1.0 - exp(-depth * 0.5));
            col *= 0.92 + 0.16 * fbm(p * 0.3 + uTime * 0.02);

            // the incoming wave: dark trough behind, glassy sunlit face, white lip along the top
            float k = clamp(uCrestH / 1.1, 0.0, 1.0);
            float sc = p.y - uCrestZ + 0.25 * sin(p.x * 0.35 + uTime * 0.6);
            float trough = k * exp(-pow((sc + 2.6) / 1.3, 2.0));
            float face = k * exp(-pow((sc + 0.5) / 0.9, 2.0));
            float lip = k * smoothstep(0.3, 0.6, k) * exp(-pow((sc - 0.1) / 0.4, 2.0)) * 1.4 * (0.55 + 0.45 * noise(vec2(p.x * 1.8, uTime * 2.0)));
            col = mix(col, vec3(0.0, 0.14, 0.22), trough * 0.8);
            col = mix(col, vec3(0.1, 0.95, 0.86), face * 0.8);
            col += vec3(0.05, 0.45, 0.4) * face * 0.9; // sun shining through the wave
            float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
            col = mix(col, vec3(0.85, 0.94, 1.0), fres * 0.3);
            vec3 R = reflect(-V, N);
            col += vec3(1.0, 0.96, 0.88) * pow(max(dot(R, uSun), 0.0), 900.0) * 1.2;

            // foam: frothy edge, lace near the edge and after the wave breaks, white-water from the break
            vec2 fp = vec2(p.x, p.y - uFlow);
            float n = fbm(fp * 0.9);
            float patches = smoothstep(0.42, 0.72, fbm(fp * 0.35 + 3.0));
            float edge = smoothstep(0.5 + n * 0.5, 0.0, d) * (0.7 + 0.3 * noise(fp * 6.0));
            float cells = cellEdge(fp * 1.5 + vec2(0.0, n * 0.9));
            float nearEdge = exp(-d / (1.0 + uSurge * 2.0));
            float lace = (1.0 - smoothstep(0.03, 0.13, cells)) * max(nearEdge, patches * 0.15 * smoothstep(9.0, 2.0, d));
            float fine = (1.0 - smoothstep(0.02, 0.08, cellEdge(fp * 4.0 + 7.0))) * nearEdge * 0.55;
            float white = uSurge * exp(-d / 3.5) * smoothstep(0.2, 0.6, fbm(fp * 1.2 + uTime * 0.25));
            float breakup = smoothstep(0.3, 0.62, fbm(fp * 0.55 + 11.0));
            float foam = clamp(edge + lace * 0.8 * (0.35 + 0.65 * breakup) + fine * breakup + white + lip, 0.0, 1.0);
            vec3 foamCol = mix(vec3(0.82, 0.9, 0.92), vec3(1.0), 0.5 + 0.5 * noise(fp * 9.0));
            col = mix(col, foamCol, foam);
            float glow = face;

            float alpha = mix(0.22, 0.96, 1.0 - exp(-depth * 1.6));
            alpha = max(alpha, foam * 0.97);
            alpha = max(alpha, glow * 0.85);
            alpha *= smoothstep(0.0, 0.05, d);
            gl_FragColor = vec4(col, alpha);
          }`,
      }),
    [u]
  )
  return (
    <mesh material={mat} rotation-x={-Math.PI / 2} position-z={-25} raycast={() => null} renderOrder={2}>
      <planeGeometry args={[70, 60, 350, 360]} />
    </mesh>
  )
}

/* ---------- Spray thrown up where the broken wave runs ---------- */
const SPRAY = 2500
function Spray() {
  const parts = useMemo(() => Array.from({ length: SPRAY }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3() })), [])
  const cursor = useRef(0)
  const lastFront = useRef(shore.front)
  const { geom, mat } = useMemo(() => {
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPRAY * 3), 3))
    geom.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(SPRAY), 1))
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 1 } },
      vertexShader: `attribute float alpha; varying float vA; uniform float uScale;
        void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = min(uScale * 14.0 / -mv.z, 6.0 * uScale); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(0.95), smoothstep(0.5, 0.1, d) * vA * 0.6); }`,
    })
    return { geom, mat }
  }, [])
  useFrame(({ gl, size }, rawDt) => {
    const dt = Math.min(rawDt, 0.05) * SPEED
    mat.uniforms.uScale.value = gl.getPixelRatio() * (size.height / 1080) * 1.6
    const speed = (shore.front - lastFront.current) / Math.max(dt, 1e-4)
    lastFront.current = shore.front
    const emit = Math.max(0, shore.surge * Math.min(speed, 6) * 18) + (shore.crestH > 0.45 ? 30 : 0)
    for (let n = 0; n < emit; n++) {
      const q = parts[cursor.current]
      cursor.current = (cursor.current + 1) % SPRAY
      const x = (Math.random() - 0.5) * 30
      const atCrest = shore.crestH > 0.45 && Math.random() < 0.5
      const z = atCrest ? shore.crestZ + 0.4 : shore.front + 0.55 * Math.sin(x * 0.31) - 0.2
      q.life = 0.6 + Math.random() * 0.7
      q.p.set(x, Math.max(0, sandY(x, z)) + (atCrest ? shore.crestH : 0.08), z)
      q.v.set((Math.random() - 0.5) * 0.8, 1 + Math.random() * 2.2, 0.8 + Math.random() * 1.8)
    }
    const pos = geom.attributes.position.array
    const al = geom.attributes.alpha.array
    for (let i = 0; i < SPRAY; i++) {
      const q = parts[i]
      if (q.life <= 0) {
        al[i] = 0
        continue
      }
      q.life -= dt
      q.v.y -= 6 * dt
      q.p.addScaledVector(q.v, dt)
      al[i] = Math.min(1, q.life * 2.5)
      pos[i * 3] = q.p.x
      pos[i * 3 + 1] = q.p.y
      pos[i * 3 + 2] = q.p.z
    }
    geom.attributes.position.needsUpdate = true
    geom.attributes.alpha.needsUpdate = true
  })
  return <points geometry={geom} material={mat} frustumCulled={false} renderOrder={3} />
}

/* ---------- Shells and seaweed ---------- */
let seed = 3
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

function scallopGeometry() {
  const g = new THREE.BufferGeometry()
  const R = 24, A = 40
  const pos = [], col = [], idx = []
  for (let i = 0; i <= R; i++) {
    const r = i / R
    for (let j = 0; j <= A; j++) {
      const a = -1.15 + (j / A) * 2.3
      const rib = Math.pow(Math.abs(Math.sin(a * 8.5)), 0.6) * 0.035 * r
      const dome = 0.16 * Math.sin(Math.min(1, r) * Math.PI * 0.9) * Math.cos(a * 0.9)
      pos.push(Math.sin(a) * r, dome + rib, -Math.cos(a) * r * 0.95)
      const band = 0.5 + 0.5 * Math.sin(r * 22)
      const base = [0.97, 0.84, 0.7]
      const tint = [0.82, 0.48, 0.34]
      const k = 0.6 * band * r
      col.push(base[0] * (1 - k) + tint[0] * k, base[1] * (1 - k) + tint[1] * k, base[2] * (1 - k) + tint[2] * k)
    }
  }
  for (let i = 0; i < R; i++)
    for (let j = 0; j < A; j++) {
      const a = i * (A + 1) + j
      idx.push(a, a + A + 1, a + 1, a + 1, a + A + 1, a + A + 2)
    }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

function conchGeometry() {
  // a tapering spiral shell
  const pts = []
  for (let i = 0; i <= 30; i++) {
    const t = i / 30
    pts.push(new THREE.Vector2(0.001 + 0.22 * Math.sin(Math.PI * Math.pow(t, 0.7)) * (1 - t * 0.5) + 0.02 * Math.sin(t * 40), t * 0.9))
  }
  const g = new THREE.LatheGeometry(pts, 24)
  g.rotateZ(Math.PI / 2)
  const p = g.attributes.position
  const col = []
  for (let i = 0; i < p.count; i++) {
    const s = 0.5 + 0.5 * Math.sin(p.getX(i) * 30 + Math.atan2(p.getZ(i), p.getY(i)) * 2)
    col.push(0.93 - s * 0.2, 0.84 - s * 0.25, 0.74 - s * 0.3)
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return g
}

function seaweedGeometry(cx, cz, spread) {
  const tubes = []
  for (let k = 0; k < 160; k++) {
    const pts = []
    const r = Math.sqrt(rnd()) * spread * 0.5
    const th = rnd() * Math.PI * 2
    let x = cx + Math.cos(th) * r
    let z = cz + Math.sin(th) * r * 0.6
    let a = rnd() * Math.PI * 2
    for (let i = 0; i < 9; i++) {
      pts.push(new THREE.Vector3(x, sandY(x, z) + 0.02 + rnd() * 0.05, z))
      a += (rnd() - 0.5) * 1.6
      x += Math.cos(a) * 0.2
      z += Math.sin(a) * 0.2
    }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 0.06 + rnd() * 0.05, 6, false)
    tube.scale(1, 0.3, 1) // flattened ribbons lying on the sand
    tube.translate(0, sandY(cx, cz) * 0.55, 0)
    tubes.push(tube)
  }
  for (let k = 0; k < 14; k++) {
    const b = new THREE.SphereGeometry(0.045 + rnd() * 0.03, 8, 6)
    const x = cx + (rnd() - 0.5) * spread
    const z = cz + (rnd() - 0.5) * spread * 0.6
    b.translate(x, sandY(x, z) + 0.04, z)
    b.deleteAttribute('uv')
    tubes.push(b)
  }
  tubes.forEach((t) => t.attributes.uv && t.deleteAttribute('uv'))
  return mergeAll(tubes)
}

function mergeAll(list) {
  // minimal merge for non-indexed + indexed geometries with position/normal only
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g))
  let n = 0
  geos.forEach((g) => (n += g.attributes.position.count))
  const pos = new Float32Array(n * 3)
  const nor = new Float32Array(n * 3)
  let o = 0
  geos.forEach((g) => {
    pos.set(g.attributes.position.array, o * 3)
    nor.set(g.attributes.normal.array, o * 3)
    o += g.attributes.position.count
  })
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  return out
}

function Shoreline({ tall }) {
  const items = useMemo(() => {
    seed = 3
    const scallop = scallopGeometry()
    const conch = conchGeometry()
    // clusters in the lower corners, like shells left at the tide line
    const corners = tall
      ? [
          [-3.4, 6.4],
          [3.5, 5.6],
        ]
      : [
          [-8.4, 4.4],
          [8.6, 3.9],
        ]
    const shells = []
    corners.forEach(([cx, cz], ci) => {
      for (let k = 0; k < 9; k++) {
        const x = cx + (rnd() - 0.5) * 2.6
        const z = cz + (rnd() - 0.5) * 1.6
        const conchy = rnd() < 0.3
        shells.push({
          geom: conchy ? conch : scallop,
          pos: [x, sandY(x, z) + 0.01, z],
          rot: [conchy ? 0 : -0.15 + rnd() * 0.3, rnd() * Math.PI * 2, conchy ? 0.2 : rnd() * 0.2],
          s: (conchy ? 0.85 : 0.5) + rnd() * 0.25,
        })
      }
      if (ci === 0) {
        // a couple of strays in the middle distance
        for (let k = 0; k < 3; k++) {
          const x = (rnd() - 0.5) * (tall ? 5 : 12)
          const z = 4 + rnd() * 2
          shells.push({ geom: scallop, pos: [x, sandY(x, z) + 0.01, z], rot: [0, rnd() * 6, 0], s: 0.35 + rnd() * 0.15 })
        }
      }
    })
    const weed = corners.map(([cx, cz]) => seaweedGeometry(cx + (cx < 0 ? -0.6 : 0.6), cz + 0.3, 2.8))
    return { shells, weed }
  }, [tall])
  return (
    <group>
      {items.shells.map((s, i) => (
        <mesh key={i} geometry={s.geom} position={s.pos} rotation={s.rot} scale={s.s} castShadow receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.45} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {items.weed.map((g, i) => (
        <mesh key={i} geometry={g} castShadow receiveShadow>
          <meshStandardMaterial color="#2a2812" roughness={0.28} metalness={0.05} />
        </mesh>
      ))}
    </group>
  )
}

/* ---------- The story, on a loop ---------- */
function useShoreTimeline() {
  useEffect(() => {
    let tl
    const cycle = () => {
      tl = gsap.timeline({ onComplete: cycle })
      tl.timeScale(SPEED)
      tl.call(() => {
        Object.assign(shore, { front: -3.2, maxFront: -3.2, wet: 0, reveal: 0, crestZ: -18, crestH: 0, surge: 0 })
      })
      // the words appear, as if written into the sand
      tl.to(shore, { reveal: 1, duration: 2.6, ease: 'power1.inOut' }, 0.6)
      // a big wave builds out at sea and rolls in
      tl.to(shore, { crestZ: -4.2, duration: 3.2, ease: 'power1.in' }, 5.2)
      tl.to(shore, { crestH: 1.1, duration: 3.0, ease: 'power2.in' }, 5.2)
      // it breaks and rushes up the beach over the words
      tl.to(shore, { crestH: 0, duration: 0.7, ease: 'power2.out' }, 8.4)
      tl.to(shore, { surge: 1, duration: 0.4 }, 8.3)
      tl.to(shore, { front: 6.5, duration: 2.6, ease: 'power2.out' }, 8.4)
      tl.to(shore, { surge: 0, duration: 1.6 }, 10.2)
      tl.call(() => (shore.wet = 1), null, 9.5)
      // and slides back, leaving smooth, shining sand
      tl.to(shore, { front: -3.2, duration: 3.4, ease: 'sine.inOut' }, 11.2)
      tl.to(shore, { wet: 0, duration: 3.2, ease: 'power1.in' }, 13.4)
      tl.to({}, { duration: 0.2 }, 16.6)
    }
    cycle()
    window.__cycle = tl.duration() / SPEED // real seconds per loop, read by the recorder
    return () => tl?.kill()
  }, [])
}

function Driver({ u }) {
  useShoreTimeline()
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime * SPEED
    // small waves keep lapping at the edge
    const ph = (t % 5.5) / 5.5
    const lap = ph < 0.35 ? Math.sin((ph / 0.35) * Math.PI * 0.5) : Math.cos(((ph - 0.35) / 0.65) * Math.PI * 0.5)
    const lapAmt = shore.surge > 0.05 || shore.front > -2 ? 0.3 : 1
    const front = shore.front + lap * 0.9 * lapAmt
    shore.maxFront = Math.max(shore.maxFront, shore.front)
    u.uFlow.value += (front - u.uFront.value) * 0.9
    u.uTime.value = t
    u.uFront.value = front
    u.uMaxFront.value = shore.maxFront
    u.uWet.value = shore.wet
    u.uReveal.value = shore.reveal
    u.uCrestZ.value = shore.crestZ
    u.uCrestH.value = shore.crestH
    u.uSurge.value = shore.surge
  })
  return null
}

function Rig({ tall, capture }) {
  const { camera } = useThree()
  useFrame(({ clock }) => {
    const t = capture ? 0 : clock.elapsedTime
    if (tall) {
      camera.fov = 50
      camera.position.set(Math.sin(t * 0.1) * 0.2, 13, 9.2)
      camera.lookAt(0, 0, 0.6)
    } else {
      camera.fov = 36
      camera.position.set(Math.sin(t * 0.1) * 0.3, 12, 10.5)
      camera.lookAt(0, 0, -0.6)
    }
    camera.updateProjectionMatrix()
  })
  return null
}

function Scene({ capture }) {
  const { size } = useThree()
  const tall = size.width / size.height < 0.95
  const u = useShoreUniforms()
  useEffect(() => {
    let alive = true
    makeTextTexture(tall).then((tex) => {
      if (!alive) return
      u.uText.value = tex
      u.uLines.value = tall ? 2 : 1
      u.uTextTexel.value.set(1 / tex.image.width, 1 / tex.image.height)
      u.uTextRect.value.set(...(tall ? [-3.0, 0.3, 6.0, 6.0] : [-5.3, 0.9, 10.6, 2.65]))
      window.__textReady = true
    })
    return () => {
      alive = false
    }
  }, [tall, u])
  return (
    <>
      <color attach="background" args={['#0d4f63']} />
      <hemisphereLight args={['#d6ecff', '#e9d2ad', 1.1]} />
      <directionalLight
        position={SUN.clone().multiplyScalar(30)}
        intensity={3.2}
        color="#fff4e2"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <Sand u={u} />
      <Shoreline tall={tall} />
      <Water u={u} />
      <Spray />
      <Driver u={u} />
      <Rig tall={tall} capture={capture} />
      <EffectComposer multisampling={capture ? 4 : 0} disableNormalPass>
        <Bloom mipmapBlur luminanceThreshold={1.2} luminanceSmoothing={0.3} intensity={0.15} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette offset={0.3} darkness={0.45} />
      </EffectComposer>
    </>
  )
}

export default function ShoreScene({ capture = false }) {
  const [dpr] = useState(capture ? 1 : Math.min(window.devicePixelRatio || 1, 1.5))
  useEffect(() => {
    if (capture) window.__advance = () => advance(performance.now())
  }, [capture])
  return (
    <Canvas
      shadows
      dpr={dpr}
      frameloop={capture ? 'never' : 'always'}
      camera={{ fov: 36, near: 0.1, far: 300, position: [0, 12, 10.5] }}
      gl={{ antialias: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0, preserveDrawingBuffer: capture }}
    >
      <Suspense fallback={null}>
        <Scene capture={capture} />
      </Suspense>
    </Canvas>
  )
}
