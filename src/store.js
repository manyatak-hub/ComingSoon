// Shared state between the GSAP timeline, the shaders and the UI.

export const SLOPE = 0.12 // the beach rises 0.12 units for every unit toward the camera
export const BAY = 0.006 // the shoreline curves out to sea toward both ends, like a real cove
// Height of the smooth beach profile (no ripples or dunes): shared by sand, water and letters
export const shoreHeight = (x, z) => SLOPE * (z + BAY * x * x)

// Dunes the palms and grasses grow on (x, z, radius, height). The big wave flows around them.
export const DUNES = [
  [-9.5, -1.5, 3.2, 0.55],
  [10.5, -2.5, 3.2, 0.55],
]

export const sandHeight = (x, z) => {
  let h = shoreHeight(x, z) + 0.02 * Math.sin(x * 1.7 + z * 0.6) * Math.cos(z * 1.3 - x * 0.4)
  for (const [dx, dz, r, a] of DUNES) h += a * Math.exp(-((x - dx) ** 2 + (z - dz) ** 2) / (r * r))
  return h
}

export const SUN_DIR = [0.75, 0.4, 0.55] // late-afternoon sun from behind the viewer's right shoulder

export const beach = {
  base: -0.55, // tide level driven by GSAP
  level: -0.55, // base + gentle lapping, read every frame
  wetLine: -1, // how far up the last wave reached
  wet: 0, // 1 = freshly soaked sand, fades back to 0
  textWidth: 9, // set by the letters, read by the camera
}

// Minimal event bus (gold dust, beat pulses)
const listeners = {}
export const bus = {
  on(evt, fn) {
    ;(listeners[evt] ||= new Set()).add(fn)
    return () => listeners[evt].delete(fn)
  },
  emit(evt, payload) {
    listeners[evt]?.forEach((fn) => fn(payload))
  },
}

export const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
