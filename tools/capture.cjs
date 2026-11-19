// Record the 3D beach frame by frame with a fake clock: node capture.cjs <landscape|portrait> <outDir> [maxFrames]
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [orient, out, maxFrames] = process.argv.slice(2);
  const [W, H] = orient === 'portrait' ? [1080, 1920] : [1920, 1080];
  const FPS = 30, XF = 1.0; // extra second used to cross-fade the loop seam
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.clock.install({ time: 0 });
  await p.goto(`${process.env.URL || "http://localhost:4173"}/?capture=${orient}`);
  for (let i = 0; i < 600; i++) {
    const ready = await p.evaluate(() => !!(window.__advance && window.__cycle));
    if (ready) break;
    await p.clock.runFor(20);
    await p.waitForTimeout(50);
    await p.evaluate(() => window.__advance && window.__advance());
  }
  const cycle = await p.evaluate(() => window.__cycle);
  const total = maxFrames ? Number(maxFrames) : Math.ceil((cycle + XF) * FPS);
  console.log(orient, 'cycle', cycle.toFixed(3), 's, frames', total);
  fs.writeFileSync(`${out}/meta.json`, JSON.stringify({ cycle, fps: FPS, xf: XF, total }));
  const t0 = Date.now();
  for (let f = 0; f < total; f++) {
    await p.clock.runFor(1000 / FPS);
    await p.evaluate(() => window.__advance());
    await p.screenshot({ path: `${out}/${String(f).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 93 });
    if (f % 30 === 0) console.log(orient, f, '/', total, `${((Date.now() - t0) / 1000 / (f + 1)).toFixed(2)}s per frame`);
  }
  console.log(orient, 'done in', Math.round((Date.now() - t0) / 1000), 's');
  await b.close();
})();
