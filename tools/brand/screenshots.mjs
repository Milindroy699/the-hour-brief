// Store screenshots from the real UI (headless Chrome, the app look, latest edition in the repo):
//   node tools/brand/screenshots.mjs                 all sets
//   node tools/brand/screenshots.mjs --only app-store   only the App Store sets (leaves the Play files alone)
// -> mobile/play-store/screenshots/*.png         (1080x1920, Google Play phone size)
//    mobile/app-store/screenshots/*.png          (1320x2868, App Store iPhone 6.9-inch)
//    mobile/app-store/screenshots-ipad/*.png     (2064x2752, App Store iPad 13-inch; required because the app runs on iPad)
// The App Store sets also show the swipe cards and the Your sections screen. The Audio screen uses a dry-run recording (tones)
// only so the UI shows its "AI voice ready" state; no audio is played on screen.
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

const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';
const SETS = [
  { dir: 'mobile/play-store/screenshots', w: 412, h: 732 * 1, dpr: 1080 / 412, full: false },        // 1080 x 1919
  { dir: 'mobile/app-store/screenshots', w: 440, h: 956, dpr: 3, full: true },                      // 1320 x 2868 (iPhone 6.9-inch)
  { dir: 'mobile/app-store/screenshots-ipad', w: 1032, h: 1376, dpr: 2, full: true },               // 2064 x 2752 (iPad 13-inch)
].filter((x) => !ONLY || x.dir.includes(ONLY));
// The three editions before the latest were played, so the quiz shows a streak (dates follow the latest edition).
const LATEST = /data-edition-date="(\d{4}-\d{2}-\d{2})"/.exec(fs.readFileSync(path.join(root, 'index.html'), 'utf8'))[1];
const dayBefore = (n) => new Date(Date.parse(LATEST + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
const seed = { r: { [dayBefore(3)]: { s: 3, t: 5 }, [dayBefore(2)]: { s: 4, t: 5 }, [dayBefore(1)]: { s: 5, t: 5 } } };
const QUIET = { n: 0, last: '2020-01-01', done: true, cardsDone: true };     // no "Make it yours" / "Try swipe cards" card in the shots
const pre = `window.HB_AUDIO_BASE='${B}/__audio'; (() => { const A = window.Audio; window.Audio = function (...a) { const el = new A(...a); window.__audio = el; return el; }; window.Audio.prototype = A.prototype; })();
  window.Capacitor = { isNativePlatform: () => true, Plugins: {} };`;   // the app look

for (const set of SETS) {
  const out = path.join(root, set.dir);
  fs.mkdirSync(out, { recursive: true });
  if (set.full) for (const f of fs.readdirSync(out)) if (f.endsWith('.png')) fs.rmSync(path.join(out, f));    // no stale names from older runs
  const N = set.full
    ? { feed: '01-feed', highlights: '02-highlights', cards: '03-cards', audio: '04-audio', quiz: '05-quiz', sections: '06-sections' }
    : { feed: '01-feed', highlights: '02-highlights', audio: '03-audio', quiz: '04-quiz' };
  for (const dark of [false, true]) {
    const id = await c.preload(pre);
    await c.send('Emulation.setDeviceMetricsOverride', { width: set.w, height: set.h, deviceScaleFactor: set.dpr, mobile: true });
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    await c.goto(B + '/about.html', 200);
    await c.ev(`localStorage.clear(); localStorage.setItem('hb-tip-v1', ${JSON.stringify(JSON.stringify(QUIET))}); localStorage.setItem('hb-quiz-v1', ${JSON.stringify(JSON.stringify(seed))}); 'ok'`);
    await c.goto(B + '/', 2500);
    await c.ev(`document.documentElement.style.scrollBehavior = 'auto'; document.fonts.ready.then(() => 'ok')`);
    const at = async (sel, off) => { await c.ev(`(window.scrollTo(0, Math.max(0, document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect().top + scrollY - ${off})), 'ok')`); await c.sleep(500); };
    const tag = dark ? '-dark' : '';
    await c.ev(`window.scrollTo(0, 0); 'ok'`); await c.sleep(400);
    await c.shot(path.join(out, `${N.feed}${tag}.png`));
    await at('#ai .lane-head', 70); await c.shot(path.join(out, `${N.highlights}${tag}.png`));
    if (set.full) {                                            // the swipe cards: the first story of the first section
      await c.ev(`window.scrollTo(0, 0); document.querySelectorAll('.vs-in button')[1].click()`); await c.sleep(1500);
      await c.ev(`HBCards.goTo(1, false)`); await c.sleep(700);
      await c.shot(path.join(out, `${N.cards}${tag}.png`));
      await c.ev(`HBCards.close({ keep: true })`); await c.sleep(400);
    }
    await c.ev(`document.querySelector('.tab[data-tab=audio]').click()`); await c.sleep(900);
    await c.ev(`[...document.querySelectorAll('.hub-row')].find((r) => r.querySelector('b').textContent === 'AI & Tech').click()`); await c.sleep(1500);
    await c.shot(path.join(out, `${N.audio}${tag}.png`));
    await c.ev(`document.querySelector('.hub-close').click(); HBListen.stop()`); await c.sleep(300);
    await at('#quiz .lane-head', 70);
    await c.ev(`document.querySelectorAll('.quiz-opt')[JSON.parse(document.getElementById('quiz-data').textContent).questions[0].answer].click()`); await c.sleep(500);   // the right answer
    await at('#quiz .lane-head', 70); await c.shot(path.join(out, `${N.quiz}${tag}.png`));
    if (set.full) {                                            // Your sections
      await c.ev(`window.scrollTo(0, 0); document.querySelector('.ab-menu').click()`); await c.sleep(500);
      await c.ev(`document.querySelector('.rd-item[data-act=sections]').click()`); await c.sleep(600);
      await c.shot(path.join(out, `${N.sections}${tag}.png`));
      await c.ev(`document.querySelector('.rd-sheet .rd-close').click()`); await c.sleep(300);
    }
    await c.unpreload(id);
  }
}
c.close(); server.close();
console.log('done');
