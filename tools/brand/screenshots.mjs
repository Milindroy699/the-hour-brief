// Store screenshots from the real UI (headless Chrome, phone layout, latest edition in the repo):
//   node tools/brand/screenshots.mjs
// -> mobile/play-store/screenshots/*.png   (1080x1920, Google Play phone size)
//    mobile/app-store/screenshots/*.png    (1290x2796, App Store 6.7-inch)
// The Audio screen uses a dry-run recording (tones) only so the UI shows its "AI voice ready" state; no audio is played on screen.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch } from '../browser-tests/cdp.mjs';
import { start } from '../browser-tests/static.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-rec-'));
execFileSync('node', ['generate.mjs', '--dry', '--date', 'latest', '--out', tmp], { cwd: path.join(root, 'tools/audio'), stdio: 'ignore' });
const { server } = await start({ port: 8791, audioDir: tmp });
const B = 'http://127.0.0.1:8791';
const c = await launch(9392);

const SETS = [
  { dir: 'mobile/play-store/screenshots', w: 412, h: 732 * 1, dpr: 1080 / 412 },        // 1080 x 1919
  { dir: 'mobile/app-store/screenshots', w: 430, h: 932, dpr: 3 },                      // 1290 x 2796
];
const seed = { r: { '2026-09-21': { s: 3, t: 5 }, '2026-09-22': { s: 4, t: 5 }, '2026-09-23': { s: 5, t: 5 } } };
const pre = `window.HB_AUDIO_BASE='${B}/__audio'; (() => { const A = window.Audio; window.Audio = function (...a) { const el = new A(...a); window.__audio = el; return el; }; window.Audio.prototype = A.prototype; })();
  window.Capacitor = { isNativePlatform: () => true, Plugins: {} };`;   // the app look (the first-run sheet is skipped below)

for (const set of SETS) {
  const out = path.join(root, set.dir);
  fs.mkdirSync(out, { recursive: true });
  for (const dark of [false, true]) {
    const id = await c.preload(pre);
    await c.send('Emulation.setDeviceMetricsOverride', { width: set.w, height: set.h, deviceScaleFactor: set.dpr, mobile: true });
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    await c.goto(B + '/about.html', 200);
    await c.ev(`localStorage.clear(); localStorage.setItem('hb-prefs-v1', '{"order":[],"off":[]}'); localStorage.setItem('hb-quiz-v1', ${JSON.stringify(JSON.stringify(seed))}); 'ok'`);
    await c.goto(B + '/', 2500);
    await c.ev(`document.documentElement.style.scrollBehavior = 'auto'; document.fonts.ready.then(() => 'ok')`);
    const at = async (sel, off) => { await c.ev(`(window.scrollTo(0, Math.max(0, document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect().top + scrollY - ${off})), 'ok')`); await c.sleep(500); };
    const tag = dark ? '-dark' : '';
    await c.ev(`window.scrollTo(0, 0); 'ok'`); await c.sleep(400);
    await c.shot(path.join(out, `01-feed${tag}.png`));
    await at('#ai .lane-head', 70); await c.shot(path.join(out, `02-highlights${tag}.png`));
    await c.ev(`document.querySelector('.tab[data-tab=audio]').click()`); await c.sleep(900);
    await c.ev(`[...document.querySelectorAll('.hub-row')].find((r) => r.querySelector('b').textContent === 'AI & Tech').click()`); await c.sleep(1500);
    await c.shot(path.join(out, `03-audio${tag}.png`));
    await c.ev(`document.querySelector('.hub-close').click(); HBListen.stop()`); await c.sleep(300);
    await at('#quiz .lane-head', 70);
    await c.ev(`document.querySelectorAll('.quiz-opt')[0].click()`); await c.sleep(500);
    await at('#quiz .lane-head', 70); await c.shot(path.join(out, `04-quiz${tag}.png`));
    await c.unpreload(id);
  }
}
c.close(); server.close();
console.log('done');
