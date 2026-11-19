# Coming Soon

A 3D "Coming Soon" page set in a tropical granite-boulder cove. Gold letters rise out of the sand, and a slow wave washes them away into gold dust. Tap anywhere to start or stop the lounge music.

Built with React, Three.js, React Three Fiber, Drei, postprocessing and GSAP. The music is synthesized live with the Web Audio API, so there are no audio files.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

This outputs one self-contained `dist/index.html`.

## Deploy on Vercel

Import this repository at vercel.com/new. The Vite settings are detected automatically (build command `npm run build`, output directory `dist`).

## Credits

The Cinzel font is by Natanael Gama and licensed under the SIL Open Font License. `tools/make-font.cjs` converts it into the 3D font file in `src/fonts/`.
