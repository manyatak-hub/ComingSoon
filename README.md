# Bastian Beachfront Alibaug: Coming Soon

A "Coming Soon" page looking down at the water's edge. "COMING SOON" is written into the sand among shells and seaweed; a clear turquoise wave builds, breaks into lacy foam and washes the words away, then slides back leaving shining wet sand. "Bastian Beachfront, Alibaug" sits beneath. Tap anywhere to start or stop the lounge music.

## How it works

The shoreline is a real-time 3D scene (React Three Fiber, postprocessing, GSAP, custom water and sand shaders) in `src/ShoreScene.jsx`. Rendering it live is too heavy for many phones, so the public page plays a **video recorded from that scene**: one for wide screens and one for phones. The page itself is only about 50 KB of code.

The music is synthesized with the Web Audio API. It is rendered once into a seamless loop shortly after the page loads, so playback never stutters.

| Address | What it shows |
| --- | --- |
| `/` | The video page (default) |
| `/?live` | The shoreline scene in real time |
| `/?cove` | The earlier tropical-cove scene in real time (`src/LiveBeach.jsx`) |
| `/?capture=landscape` or `/?capture=portrait` | The scene prepared for recording (no text or music) |

## Run locally

```bash
npm install
npm run dev
```

## Re-record the videos after changing the scene

This needs Playwright with Chromium, and ffmpeg.

```bash
npm run build
npx vite preview --port 4173
```

In a second terminal:

```bash
node tools/capture.cjs landscape frames-landscape
node tools/capture.cjs portrait frames-portrait
tools/encode.sh frames-landscape public/media/beach-landscape.mp4 public/media/beach-landscape.jpg
tools/encode.sh frames-portrait public/media/beach-portrait.mp4 public/media/beach-portrait.jpg
```

The recorder steps a fake clock exactly 1/30 s per frame, so the video stays smooth however slow the machine is. The encoder fades the last second into the first so the video loops without a jump.

## Deploy

Pushing to `main` deploys to Vercel automatically.

## Credits

The Cinzel font is by Natanael Gama and licensed under the SIL Open Font License. `tools/make-font.cjs` converts it into the 3D font file in `src/fonts/`.
