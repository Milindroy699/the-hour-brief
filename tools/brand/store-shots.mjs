// Store screenshots, framed: a caption on the brand background above the real app UI (headless Chrome, the app look,
// the latest edition in the repo, light mode except the last). Replaces screenshots.mjs's bare shots (2026-11-21).
//   node tools/brand/store-shots.mjs [--raw-only] [--only 6.3in]
// -> mobile/play-store/screenshots/        1080x1920  (Google Play phone)
//    mobile/app-store/screenshots/         1320x2868  (iPhone 6.9-inch)
//    mobile/app-store/screenshots-6.5in/   1242x2688  (iPhone 6.5-inch)
//    mobile/app-store/screenshots-6.3in/   1206x2622  (iPhone with Dynamic Island, medium display)
//    mobile/app-store/screenshots-ipad/    2064x2752  (iPad 13-inch)
//    mobile/app-store/screenshots-duo/     1398x2034  (iPhone Duo)
// Leagues show sample generated names (a mocked league API); everything else is the real edition.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { launch } from '../browser-tests/cdp.mjs';
import { start } from '../browser-tests/static.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const req = createRequire(path.join(root, 'tools/video/package.json'));
const satoriMod = await import(req.resolve('satori')); const satori = satoriMod.default && typeof satoriMod.default === 'function' ? satoriMod.default : (satoriMod.default && satoriMod.default.default) || satoriMod.satori;
const { Resvg } = req('@resvg/resvg-js');

const RAW_ONLY = process.argv.includes('--raw-only');
const RAW = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-shots-'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-rec-'));
execFileSync('node', ['generate.mjs', '--dry', '--date', 'latest', '--out', tmp], { cwd: path.join(root, 'tools/audio'), stdio: 'ignore' });
const { server } = await start({ port: 8804, audioDir: tmp });
const B = 'http://127.0.0.1:8804';
const c = await launch(9396, { home: true });          // the phone and app layout (Home, Brief, Voices, Challenge)

const LATEST = /data-edition-date="(\d{4}-\d{2}-\d{2})"/.exec(fs.readFileSync(path.join(root, 'index.html'), 'utf8'))[1];
const dayBefore = (n) => new Date(Date.parse(LATEST + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
// today's result: 4 of 5, with the real answers (the last one missed)
const QZ = JSON.parse(/<script[^>]*id="quiz-data"[^>]*>([\s\S]*?)<\/script>/.exec(fs.readFileSync(path.join(root, 'index.html'), 'utf8'))[1]).questions;
const picks = QZ.map((q, i) => (i === QZ.length - 1 ? (q.answer + 1) % q.options.length : q.answer));
const quizSeed = { r: { [dayBefore(3)]: { s: 3, t: 5 }, [dayBefore(2)]: { s: 4, t: 5 }, [dayBefore(1)]: { s: 5, t: 5 }, [LATEST]: { s: QZ.length - 1, t: QZ.length, a: picks } } };
const QUIET = { n: 0, last: '2020-01-01', done: true };
// a sample league for the quiz shot (generated names, as the app gives players)
const board = (code, name, kind) => ({ code, name, kind, label: kind === 'office' ? 'Office' : '', max: kind === 'office' ? 300 : 30, members: kind === 'office' ? 42 : 5, date: LATEST, isMember: true, me: 'Calm Wombat 80',
  today: [{ h: 'Swift Otter 12', s: 5, rank: 1 }, { h: 'Calm Wombat 80', s: 4, me: true, rank: 2 }, { h: 'Lucky Heron 44', s: 4, rank: 2 }, { h: 'Bold Panda 7', s: 3, rank: 4 }],
  todayCount: kind === 'office' ? 31 : 4, yet: [], yetCount: kind === 'office' ? 11 : 1, week: [], weekCount: 0, hist: [] });
const pre = `window.HB_AUDIO_BASE='${B}/__audio'; window.HB_NO_SW = true; window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };
  (() => { const of = window.fetch; window.fetch = (u, o) => { u = String(u);
    if (u.includes('/api/league')) { const code = (new URL(u, location.href).searchParams.get('code')) || 'K7Q2MX';
      return Promise.resolve(new Response(JSON.stringify(code === 'R4D9TP' ? ${JSON.stringify(board('R4D9TP', 'Acme Product team', 'office'))} : ${JSON.stringify(board('K7Q2MX', 'Swift Otters', 'friends'))}), { status: 200, headers: { 'Content-Type': 'application/json' } })); }
    if (u.includes('/api/quiz-stats')) return Promise.resolve(new Response(JSON.stringify({ ok: true, n: 1284, dist: [40, 96, 210, 388, 350, 200] }), { status: 200 }));
    return of(u, o); }; })();`;

// The scenes (2026-11-26: the new app: the welcome, Home by day and by night, a story, Listen, the full-screen quiz and its
// score, Voices): [file, caption, sub, dark frame, { at: local time, store: what this phone has, path, go }]
const named = { 'hb-onb-v1': 'done:2026-11-01', 'hb-name-v1': 'Priya', 'hb-nudge-v2': JSON.stringify({ first: Date.now(), last: Date.now(), home: { n: 0, at: 0, no: 0, stop: true }, score: 0, save: 0, dot: Date.now() }) };
const streakSeed = { r: { [dayBefore(4)]: { s: 4, t: 5 }, [dayBefore(3)]: { s: 3, t: 5 }, [dayBefore(2)]: { s: 4, t: 5 }, [dayBefore(1)]: { s: 5, t: 5 } }, b: { first: dayBefore(4), streak3: dayBefore(2) }, bs: 4 };
const answers = QZ.map((q) => q.answer);
const SCENES = [
  ['01-welcome', 'The news that actually mattered', 'Every morning, in one sitting: AI, business and Indian markets', true, { at: '09:00', store: {}, wait: 3200 }],
  ['02-home', 'Your morning, at a glance', 'Top stories, Voices and your daily quiz in one place', false, { at: '09:30', store: { ...named, 'hb-quiz-v1': streakSeed } }],
  ['03-story', 'Every story in under a minute', 'A short summary, the takeaway and the source', false, { at: '09:30', store: { ...named, 'hb-quiz-v1': streakSeed }, go: async () => {
    await c.ev(`document.querySelector('.hm-lead').click(); 'ok'`); await c.sleep(1800); } }],
  ['04-listen', 'Hear the whole brief', 'Read aloud in minutes, even with your screen off', false, { at: '09:30', store: { ...named, 'hb-quiz-v1': streakSeed }, go: async () => {
    await c.ev(`document.querySelector('.hm-listen').click(); 'ok'`); await c.sleep(2600); } }],
  ['05-quiz', 'Five questions on today’s news', 'One at a time, with the why behind every answer', true, { at: '09:30', store: { ...named, 'hb-quiz-v1': streakSeed }, go: async () => {
    await c.ev(`HBQuizPlay(); 'ok'`); await c.sleep(900);
    await c.ev(`document.querySelectorAll('.qz-play .quiz-opt')[${answers[0]}].click(); 'ok'`); await c.sleep(1100); } }],
  ['06-score', 'Keep your streak. Beat your friends.', 'Share your score, earn badges and play in leagues', true, { at: '09:30', store: { ...named, 'hb-quiz-v1': streakSeed }, go: async () => {
    await c.ev(`HBQuizPlay(); 'ok'`); await c.sleep(800);
    for (const a of answers) { await c.ev(`document.querySelectorAll('.qz-play .quiz-opt')[${a}].click(); 'ok'`); await c.sleep(700); await c.ev(`document.querySelector('.qz-play .qz-ans-next').click(); 'ok'`); await c.sleep(700); }
    await c.sleep(6000);
    await c.ev(`document.querySelectorAll('.qz-cele, .qz-perfect').forEach((x) => x.remove()); document.querySelector('.qz-play-stage').scrollTop = 0; 'ok'`); await c.sleep(500); } }],
  ['07-voices', 'The best minds, every week', 'Long reads on tech, product, business and finance', false, { at: '09:30', store: named, path: '/leaders.html', wait: 3200 }],
  ['08-night', 'Dawn by day, Midnight by night', 'A calmer screen after 8 PM, with themes to unlock', true, { at: '21:30', store: { ...named, 'hb-quiz-v1': streakSeed } }],
];
const clock = (iso) => `(() => { const D = Date, fixed = new D('${iso}').getTime(), t0 = D.now(); window.Date = class extends D { constructor(...a) { super(...(a.length ? a : [fixed + (D.now() - t0)])); } static now() { return fixed + (D.now() - t0); } }; })();`;

async function capture(w, h, dpr, dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, , , , sc] of SCENES) {
    const ids = [await c.preload(pre), await c.preload(clock(`${LATEST}T${sc.at}:00`))];
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: true });
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await c.goto(B + '/about.html', 200);
    const store = { 'hb-tip-v1': JSON.stringify(QUIET), 'hb-deck-nudge-v1': 'done', 'hb-swipe-hint-v1': '1', 'hb-league-v1': JSON.stringify({ mid: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', leagues: [{ code: 'R4D9TP', name: 'Acme Product team', kind: 'office' }, { code: 'K7Q2MX', name: 'Swift Otters', kind: 'friends' }] }), ...sc.store };
    await c.ev(`localStorage.clear(); sessionStorage.clear(); ${Object.entries(store).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(typeof v === 'string' ? v : JSON.stringify(v))});`).join(' ')} 'ok'`);
    await c.goto(B + (sc.path || '/'), sc.wait || 3000);
    await c.ev(`document.documentElement.style.scrollBehavior = 'auto'; document.fonts.ready.then(() => 'ok')`);
    if (sc.go) await sc.go();
    await c.shot(path.join(dir, `${file}.png`));
    for (const id of ids) await c.unpreload(id);
  }
}

// ---- framing: brand background, caption, the UI with rounded corners ----
const font = (f) => fs.readFileSync(path.join(root, 'fonts', f));
const FONTS = [
  { name: 'Inter', data: font('inter-latin-700-normal.woff'), weight: 700, style: 'normal' },
  { name: 'Inter', data: font('inter-latin-400-normal.woff'), weight: 400, style: 'normal' },
];
async function frame(rawFile, outFile, W, H, caption, sub, dark) {
  const shot = fs.readFileSync(rawFile);
  const pad = Math.round(W * 0.07), capH = Math.round(H * 0.2);
  const imgW = W - pad * 2, imgH = H - capH - Math.round(H * 0.035);
  const node = { type: 'div', props: { style: { width: W, height: H, display: 'flex', flexDirection: 'column', alignItems: 'center',
    background: dark ? 'linear-gradient(180deg, #17142e 0%, #0c0d15 100%)' : 'linear-gradient(180deg, #4b2fd6 0%, #2a1a8a 100%)', fontFamily: 'Inter' },
    children: [
      { type: 'div', props: { style: { height: capH, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: `0 ${pad}px`, textAlign: 'center' }, children: [
        { type: 'div', props: { style: { color: '#fff', fontSize: Math.round(W * 0.066), fontWeight: 700, lineHeight: 1.12, letterSpacing: '-0.02em' }, children: caption } },
        { type: 'div', props: { style: { color: 'rgba(255,255,255,0.78)', fontSize: Math.round(W * 0.034), fontWeight: 400, marginTop: Math.round(H * 0.012), lineHeight: 1.3 }, children: sub } },
      ] } },
      { type: 'div', props: { style: { width: imgW, height: imgH, display: 'flex', overflow: 'hidden', borderRadius: Math.round(W * 0.05), boxShadow: '0 30px 80px rgba(0,0,0,0.35)', border: `${Math.max(2, Math.round(W * 0.004))}px solid rgba(255,255,255,0.18)` }, children: [
        { type: 'img', props: { src: `data:image/png;base64,${shot.toString('base64')}`, width: imgW, style: { width: imgW, objectFit: 'cover', objectPosition: 'top' } } },
      ] } },
    ] } };
  const svg = await satori(node, { width: W, height: H, fonts: FONTS });
  fs.writeFileSync(outFile, new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng());
}

const SETS = [
  { dir: 'mobile/play-store/screenshots', W: 1080, H: 1920 },
  { dir: 'mobile/app-store/screenshots', W: 1320, H: 2868 },
  { dir: 'mobile/app-store/screenshots-6.5in', W: 1242, H: 2688 },
  { dir: 'mobile/app-store/screenshots-6.3in', W: 1206, H: 2622 },          // "iPhone with Dynamic Island (medium display)"

  { dir: 'mobile/app-store/screenshots-ipad', W: 2064, H: 2752, ipad: true },
  { dir: 'mobile/app-store/screenshots-duo', W: 1398, H: 2034, ipad: true },       // "iPhone Duo" (unfolded, tablet-like width)
];
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';
for (const set of SETS.filter((x) => !ONLY || x.dir.includes(ONLY))) {
  // the UI is captured at a phone (or iPad) CSS size whose shape matches the frame's picture area
  const W = set.W, H = set.H, pad = Math.round(W * 0.07), imgW = W - pad * 2, imgH = H - Math.round(H * 0.2) - Math.round(H * 0.035);
  const cssW = set.ipad ? 820 : 393, dpr = 3, cssH = Math.round(cssW * imgH / imgW);
  const rawDir = path.join(RAW, set.dir.replace(/\//g, '_'));
  await capture(cssW, cssH, set.ipad ? 2 : dpr, rawDir);
  if (RAW_ONLY) { console.log('raw shots in', rawDir); continue; }
  const out = path.join(root, set.dir);
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(out)) if (f.endsWith('.png')) fs.rmSync(path.join(out, f));
  for (const [file, caption, sub, dark] of SCENES) await frame(path.join(rawDir, `${file}.png`), path.join(out, `${file}.png`), W, H, caption, sub, dark);
  console.log('wrote', set.dir);
}
c.close(); server.close();
console.log('done');
