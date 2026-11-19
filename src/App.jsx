import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PartyMusic } from './audio'
import { bus } from './store'

// The public page plays a video recorded from our 3D shoreline, so it runs smoothly on any phone.
//   ?live                       runs the shoreline scene in real time instead
//   ?cove                       runs the earlier tropical-cove scene in real time
//   ?capture=landscape|portrait renders the shoreline for recording (no text, no music)
const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
const CAPTURE = params.get('capture')
const COVE = params.has('cove')
const LIVE = params.has('live') || COVE

const ShoreScene = lazy(() => import('./ShoreScene.jsx'))
const LiveBeach = lazy(() => import('./LiveBeach.jsx'))
const Live3D = (props) => (COVE ? <LiveBeach {...props} /> : <ShoreScene {...props} />)

// Where the brand line sits inside each video, as a fraction of the video's height,
// so it always lands just under the gold letters however the video is cropped.
const VIDEOS = {
  landscape: { name: 'beach-landscape', w: 1920, h: 1080, brandY: 0.768 },
  portrait: { name: 'beach-portrait', w: 720, h: 1280, brandY: 0.805 },
}

function useOrientation() {
  const get = () => (window.innerWidth / window.innerHeight < 0.95 ? 'portrait' : 'landscape')
  const [o, setO] = useState(get)
  useEffect(() => {
    const on = () => setO(get())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return o
}

/* Map a point in the video (object-fit: cover) to a screen position */
function useBrandTop(v) {
  const [top, setTop] = useState(null)
  useLayoutEffect(() => {
    const place = () => {
      const W = window.innerWidth
      const H = window.innerHeight
      const scale = Math.max(W / v.w, H / v.h)
      const shownH = v.h * scale
      setTop((H - shownH) / 2 + v.brandY * shownH)
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [v])
  return top
}

function BeachVideo({ v }) {
  const ref = useRef()
  useEffect(() => {
    // some mobile browsers need a nudge to start a muted inline video
    ref.current?.play?.().catch(() => {})
  }, [v.name])
  return (
    <video
      ref={ref}
      key={v.name}
      className="beach-video"
      poster={`/media/${v.name}.jpg`}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden="true"
    >
      <source src={`/media/${v.name}.mp4`} type="video/mp4" />
      <source src={`/media/${v.name}.webm`} type="video/webm" />
    </video>
  )
}

export default function App() {
  if (CAPTURE) {
    return (
      <main className="stage capture">
        <Suspense fallback={null}>
          <ShoreScene capture />
        </Suspense>
      </main>
    )
  }
  return <Page />
}

function Page() {
  const music = useMemo(() => new PartyMusic(), [])
  const [on, setOn] = useState(false)
  const busy = useRef(false)
  const orientation = useOrientation()
  const v = VIDEOS[orientation]
  const brandTop = useBrandTop(v)

  useEffect(() => {
    music.onBeat = (downbeat) => bus.emit('beat', downbeat)
    // compose the music loop in the background once the page has loaded
    const id = setTimeout(() => music.prepare().catch(() => {}), 1500)
    return () => {
      clearTimeout(id)
      music.stop()
    }
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
      {LIVE ? (
        <Suspense fallback={null}>
          <Live3D />
        </Suspense>
      ) : (
        <BeachVideo v={v} />
      )}

      <h1 className="sr-only">Coming Soon: Bastian Beachfront, Alibaug</h1>

      <div className="brand" style={brandTop != null && !LIVE ? { top: brandTop } : undefined} aria-hidden="true">
        <p className="brand-name">Bastian Beachfront</p>
        <span className="brand-rule" />
        <p className="brand-place">Alibaug</p>
      </div>

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
