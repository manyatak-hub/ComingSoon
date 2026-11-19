// Sunset lounge / deep-house party music, synthesized live with the Web Audio API.
// Soft four-on-the-floor kick, shaker, finger snaps, warm sub bass,
// electric-piano chords, an airy pad and a vibraphone hook, all in a reverb hall.
// No audio files, no licensing worries.

const BPM = 118
const STEP = 60 / BPM / 4 // one 16th note in seconds
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12)

// Am9 – Fmaj9 – Cmaj9 – G(add9), one chord per bar
const BARS = [
  { root: 45, chord: [55, 60, 64, 71] },
  { root: 41, chord: [57, 60, 64, 67] },
  { root: 48, chord: [55, 59, 62, 64] },
  { root: 43, chord: [55, 59, 62, 69] },
]
// Vibraphone hook over 4 bars (16 steps each), null = rest
const HOOK = [
  [76, null, null, 72, null, null, 74, null, 76, null, null, null, 79, null, null, null],
  [77, null, null, 76, null, null, 72, null, null, null, 69, null, null, null, null, null],
  [76, null, null, 74, null, null, 71, null, 72, null, null, 74, null, null, 76, null],
  [74, null, null, null, 71, null, null, null, 69, null, null, null, null, null, null, null],
]
const BASS = [
  [0, 0, 3],
  [3, 0, 1],
  [7, 12, 2],
  [10, 0, 2],
  [14, 7, 2],
] // [step, semitone offset, length in steps]
const KEYS = [
  [0, 5],
  [6, 2],
  [10, 4],
] // electric piano stabs: [step, length]

export class PartyMusic {
  constructor() {
    this.live = null // the AudioContext that plays the finished loop
    this.loop = null // AudioBuffer holding one seamless 4-bar loop
    this.rendering = null
    this.playing = false
    this.onBeat = null
  }

  // Build the mixing chain (compressor, reverb hall, echo) on any audio context
  _build(ctx) {
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0.6
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.ratio.value = 3
    comp.attack.value = 0.01
    comp.release.value = 0.2
    this.master.connect(comp).connect(ctx.destination)

    this.reverb = ctx.createConvolver()
    const len = Math.floor(ctx.sampleRate * 2.8)
    const ir = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2)
    }
    this.reverb.buffer = ir
    const rvb = ctx.createGain()
    rvb.gain.value = 0.32
    this.reverb.connect(rvb).connect(this.master)

    this.delay = ctx.createDelay(1)
    this.delay.delayTime.value = STEP * 3
    const fb = ctx.createGain()
    fb.gain.value = 0.3
    const dl = ctx.createGain()
    dl.gain.value = 0.28
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 3200
    this.delay.connect(tone).connect(fb).connect(this.delay)
    tone.connect(dl).connect(this.master)
    dl.connect(this.reverb)

    const n = ctx.sampleRate
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
  }

  // Compose the loop ahead of time, off the main thread, so playback can never stutter.
  // Two passes are rendered and the second kept, so reverb and echo tails wrap seamlessly.
  prepare() {
    if (this.rendering) return this.rendering
    this.rendering = (async () => {
      const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext
      const rate = 44100
      const loopLen = Math.round(64 * STEP * rate)
      const off = new Offline(2, loopLen * 2, rate)
      this._build(off)
      for (let i = 0; i < 128; i++) this._playStep(i % 64, i * STEP)
      const rendered = await off.startRendering()
      const loop = new AudioBuffer({ length: loopLen, numberOfChannels: 2, sampleRate: rate })
      for (let c = 0; c < 2; c++) loop.copyToChannel(rendered.getChannelData(c).subarray(loopLen, loopLen * 2), c)
      this.loop = loop
      return loop
    })()
    return this.rendering
  }

  async start() {
    if (this.playing) return
    this.playing = true
    if (!this.live) {
      this.live = new (window.AudioContext || window.webkitAudioContext)()
      this.out = this.live.createGain()
      this.out.gain.value = 0
      this.out.connect(this.live.destination)
    }
    // resume inside the tap so mobile browsers allow sound
    const resumed = this.live.state === 'suspended' ? this.live.resume() : Promise.resolve()
    const loop = await this.prepare()
    await resumed
    if (!this.playing) return
    const t = this.live.currentTime
    if (!this.src) {
      this.src = this.live.createBufferSource()
      this.src.buffer = loop
      this.src.loop = true
      this.src.connect(this.out)
      this.src.start(t + 0.05)
      this.t0 = t + 0.05
    }
    this.out.gain.cancelScheduledValues(t)
    this.out.gain.setValueAtTime(this.out.gain.value, t)
    this.out.gain.linearRampToValueAtTime(1, t + 1.2)
    this._watchBeats()
  }

  stop() {
    if (!this.live || !this.playing) return
    this.playing = false
    const t = this.live.currentTime
    this.out.gain.cancelScheduledValues(t)
    this.out.gain.setValueAtTime(this.out.gain.value, t)
    this.out.gain.linearRampToValueAtTime(0, t + 0.7)
    setTimeout(() => !this.playing && this.live.suspend(), 800)
  }

  // Report each beat to the visuals by reading the audio clock (cheap, drift-free)
  _watchBeats() {
    let last = -1
    const beat = 60 / BPM
    const tick = () => {
      if (!this.playing) return
      const b = Math.floor((this.live.currentTime - this.t0) / beat)
      if (b !== last && b >= 0) {
        last = b
        this.onBeat?.(b % 4 === 0)
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  _playStep(step, t) {
    const barIdx = Math.floor(step / 16)
    const bar = BARS[barIdx]
    const s = step % 16

    if (s % 4 === 0) {
      this._kick(t)
    }
    if (s === 4 || s === 12) this._snap(t)
    this._shaker(t, s % 4 === 2 ? 0.07 : 0.025)
    if (s === 14 && barIdx === 3) this._openHat(t)

    BASS.forEach(([st, off, len]) => st === s && this._bass(midi(bar.root + off), t, len * STEP))
    KEYS.forEach(([st, len]) => st === s && bar.chord.forEach((nn) => this._epiano(midi(nn), t, len * STEP)))
    if (s === 0) this._pad(bar.chord.map(midi), t, STEP * 16)
    const h = HOOK[barIdx][s]
    if (h) this._vibes(midi(h), t)
  }

  _out(node, reverbSend = 0) {
    node.connect(this.master)
    if (reverbSend) {
      const g = this.ctx.createGain()
      g.gain.value = reverbSend
      node.connect(g).connect(this.reverb)
    }
  }

  _kick(t) {
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.frequency.setValueAtTime(120, t)
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.85, t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42)
    o.connect(g)
    this._out(g)
    o.start(t)
    o.stop(t + 0.45)
  }

  _noise(t, type, freq, q, peak, decay, send = 0) {
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    const f = this.ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
    src.connect(f).connect(g)
    this._out(g, send)
    src.start(t, Math.random() * 0.5)
    src.stop(t + decay + 0.05)
  }

  _shaker(t, vol) {
    this._noise(t, 'bandpass', 7000, 0.8, vol, 0.06)
  }
  _openHat(t) {
    this._noise(t, 'highpass', 7500, 0.5, 0.06, 0.35, 0.3)
  }
  _snap(t) {
    this._noise(t, 'bandpass', 2200, 1.4, 0.32, 0.12, 0.6)
  }

  _bass(freq, t, dur) {
    const o = this.ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = freq
    const o2 = this.ctx.createOscillator()
    o2.type = 'triangle'
    o2.frequency.value = freq * 2
    const g2 = this.ctx.createGain()
    g2.gain.value = 0.18
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.01)
    g.gain.setTargetAtTime(0.0001, t + dur * 0.8, 0.05)
    o.connect(g)
    o2.connect(g2).connect(g)
    this._out(g)
    o.start(t)
    o2.start(t)
    o.stop(t + dur + 0.3)
    o2.stop(t + dur + 0.3)
  }

  // FM electric piano: soft bell-like attack that mellows out
  _epiano(freq, t, dur) {
    const car = this.ctx.createOscillator()
    car.frequency.value = freq
    const mod = this.ctx.createOscillator()
    mod.frequency.value = freq
    const mg = this.ctx.createGain()
    mg.gain.setValueAtTime(freq * 1.6, t)
    mg.gain.exponentialRampToValueAtTime(freq * 0.08, t + 0.35)
    mod.connect(mg).connect(car.frequency)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.025, t + 0.25)
    g.gain.setTargetAtTime(0.0001, t + dur, 0.08)
    car.connect(g)
    this._out(g, 0.5)
    car.start(t)
    mod.start(t)
    car.stop(t + dur + 0.6)
    mod.stop(t + dur + 0.6)
  }

  _pad(freqs, t, dur) {
    const f = this.ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(500, t)
    f.frequency.linearRampToValueAtTime(1300, t + dur * 0.5)
    f.frequency.linearRampToValueAtTime(600, t + dur)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.022, t + 0.9)
    g.gain.setValueAtTime(0.022, t + dur - 0.3)
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.4)
    f.connect(g)
    this._out(g, 0.8)
    freqs.forEach((fr) =>
      [-6, 6].forEach((cents) => {
        const o = this.ctx.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = fr
        o.detune.value = cents
        o.connect(f)
        o.start(t)
        o.stop(t + dur + 0.5)
      })
    )
  }

  _vibes(freq, t) {
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4)
    const trem = this.ctx.createGain()
    const lfo = this.ctx.createOscillator()
    lfo.frequency.value = 5.5
    const lg = this.ctx.createGain()
    lg.gain.value = 0.25
    lfo.connect(lg).connect(trem.gain)
    trem.gain.value = 0.75
    g.connect(trem)
    this._out(trem, 0.6)
    trem.connect(this.delay)
    ;[
      [1, 1],
      [4, 0.12],
    ].forEach(([ratio, amp]) => {
      const o = this.ctx.createOscillator()
      o.frequency.value = freq * ratio
      const og = this.ctx.createGain()
      og.gain.value = amp
      o.connect(og).connect(g)
      o.start(t)
      o.stop(t + 1.5)
    })
    lfo.start(t)
    lfo.stop(t + 1.5)
  }
}
