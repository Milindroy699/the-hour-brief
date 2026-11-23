// Promo-video assets (owner, 2026-11-23): reusable pictures for the daily promo video (post kit › Promo video).
//   node tools/brand/promo-assets.mjs
// -> brand/promo/screens/*.png   six framed phone screenshots of the current app, 1080x1920 (also fine for the stores)
//    brand/promo/raw/*.png       the same screens unframed (B-roll for an edit)
//    brand/promo/endcard-9x16.png, endcard-16x9.png, endcard-1x1.png   the last 3 seconds of a video: logo, the
//                                promise, a QR to /app?src=promo-video (brand/promo/qr.svg, made with segno) and the stores
// The UI is the real app (headless Chrome, the app look, the latest edition in the repo); quiz results and badges are a
// sample reader's (a 7-day streak, today 5/5). Re-run after a design change; the files keep their names.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launch } from '../browser-tests/cdp.mjs';
import { start } from '../browser-tests/static.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const req = createRequire(path.join(root, 'tools/video/package.json'));
const satoriMod = await import(req.resolve('satori')); const satori = satoriMod.default && typeof satoriMod.default === 'function' ? satoriMod.default : (satoriMod.default && satoriMod.default.default) || satoriMod.satori;
const { Resvg } = req('@resvg/resvg-js');
const OUT = path.join(root, 'brand/promo');
fs.mkdirSync(path.join(OUT, 'screens'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true });

const HTML = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const LATEST = /data-edition-date="(\d{4}-\d{2}-\d{2})"/.exec(HTML)[1];
const QZ = JSON.parse(/<script[^>]*id="quiz-data"[^>]*>([\s\S]*?)<\/script>/.exec(HTML)[1]).questions;
const back = (n) => new Date(Date.parse(LATEST + 'T00:00:00Z') - n * 864e5).toISOString().slice(0, 10);
const results = {};
for (let k = 1; k <= 6; k++) results[back(k)] = { s: k % 3 ? 4 : 5, t: QZ.length, a: [] };
results[LATEST] = { s: QZ.length, t: QZ.length, a: QZ.map((q) => q.answer), h: 8 };
const quizSeed = { r: results, b: { first: back(6), streak3: back(4), perfect: back(3), streak7: LATEST, played10: LATEST }, bs: 7 };

// [file, caption, sub, how to get there]
const SCENES = [
  ['01-cards', 'Your 7-minute morning brief', 'AI, business and Indian markets, one card at a time', async () => {
    await c.ev(`document.querySelectorAll('.tab-switch button')[1].click(); 'ok'`); await c.sleep(1600);
    await c.ev(`HBCards.goTo([...document.querySelectorAll('.hb-deck .dk-card')].findIndex((x) => x.classList.contains('dk-story')), false); 'ok'`); await c.sleep(1000); }],
  ['02-quiz', 'A 1-minute quiz on the news', 'Earn medals and keep your streak alive', async () => {
    await c.goto(B + '/?quiz=1', 2600);
    await c.ev(`(() => { const s = document.querySelector('.hb-quizpage .hub-scroll'); const h = document.querySelector('.qz-hero'); s.scrollTop = h.getBoundingClientRect().top + s.scrollTop - 150; })(); 'ok'`); await c.sleep(900); }],
  ['03-badges', 'Badges, streaks and leagues', 'Play with friends, your class or your office', async () => {
    await c.goto(B + '/?quiz=1', 2600);
    await c.ev(`document.getElementById('qz-tab-badges').click(); 'ok'`); await c.sleep(1400); }],
  ['04-listen', 'Or listen in 7 minutes', 'Also on Spotify and Apple Podcasts', async () => {
    await c.ev(`document.querySelector('.tab[data-tab=audio]').click(); 'ok'`); await c.sleep(1800); }],
  ['05-voices', 'What the best minds said this week', 'Long reads on tech, product, business and finance', async () => {
    await c.goto(B + '/leaders.html', 3000); }],
  ['06-list', 'Every story, with its source', 'Free on iPhone and Android', async () => {
    await c.ev(`window.scrollTo(0, document.getElementById('ai').getBoundingClientRect().top + scrollY - 120); 'ok'`); await c.sleep(1200); }],
];

const { server } = await start({ port: 8807, audioDir: fs.mkdtempSync(path.join(os.tmpdir(), 'hb-noaudio-')) });
const B = 'http://127.0.0.1:8807';
const c = await launch(9397);
const W = 1080, H = 1920, pad = Math.round(W * 0.07), capH = Math.round(H * 0.2), imgW = W - pad * 2, imgH = H - capH - Math.round(H * 0.035);
const cssW = 393, cssH = Math.round(cssW * imgH / imgW);
const pre = `window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };
  (() => { const f = window.fetch; window.fetch = (u, o) => String(u).indexOf('/api/') >= 0 ? Promise.resolve(new Response('{}', { status: 200 })) : f(u, o); })();`;
for (const [file, , , go] of SCENES) {
  const id = await c.preload(pre);
  await c.send('Emulation.setDeviceMetricsOverride', { width: cssW, height: cssH, deviceScaleFactor: 3, mobile: true });
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await c.goto(B + '/about.html', 200);
  await c.ev(`localStorage.clear(); localStorage.setItem('hb-view-v1', 'list'); localStorage.setItem('hb-tip-v1', JSON.stringify({ n: 0, last: '2020-01-01', done: true }));
    localStorage.setItem('hb-quiz-v1', ${JSON.stringify(JSON.stringify(quizSeed))}); localStorage.setItem('hb-deck-nudge-v1', 'done'); localStorage.setItem('hb-swipe-hint-v1', '1'); 'ok'`);
  await c.goto(B + '/', 2800);
  await c.ev(`document.documentElement.style.scrollBehavior = 'auto'; document.fonts.ready.then(() => 'ok')`);
  await go();
  await c.shot(path.join(OUT, 'raw', `${file}.png`));
  await c.unpreload(id);
}
c.close(); server.close();

// ---- drawing ----
const font = (f) => fs.readFileSync(path.join(root, 'fonts', f));
const FONTS = [
  { name: 'Inter', data: font('inter-latin-700-normal.woff'), weight: 700, style: 'normal' },
  { name: 'Inter', data: font('inter-latin-400-normal.woff'), weight: 400, style: 'normal' },
];
const png = (file, svg, w) => fs.writeFileSync(file, new Resvg(svg, { fitTo: { mode: 'width', value: w } }).render().asPng());
const dataUri = (file, type) => `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
const NIGHT = 'linear-gradient(160deg, #2a1f78 0%, #14122b 60%, #0d0c1f 100%)';
const el = (style, children, type = 'div') => ({ type, props: { style: { display: 'flex', ...style }, children } });

for (const [file, caption, sub] of SCENES) {
  const shot = dataUri(path.join(OUT, 'raw', `${file}.png`), 'image/png');
  const node = el({ width: W, height: H, flexDirection: 'column', alignItems: 'center', background: NIGHT, fontFamily: 'Inter' }, [
    el({ height: capH, flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: `0 ${pad}px`, textAlign: 'center' }, [
      el({ color: '#fff', fontSize: 70, fontWeight: 700, lineHeight: 1.12, letterSpacing: '-0.02em' }, caption),
      el({ color: 'rgba(255,255,255,0.78)', fontSize: 36, marginTop: 22, lineHeight: 1.3 }, sub),
    ]),
    el({ width: imgW, height: imgH, overflow: 'hidden', borderRadius: 56, border: '6px solid rgba(255,255,255,0.22)', boxShadow: '0 30px 80px rgba(0,0,0,0.4)' }, [
      { type: 'img', props: { src: shot, width: imgW, style: { width: imgW, objectFit: 'cover', objectPosition: 'top' } } },
    ]),
  ]);
  png(path.join(OUT, 'screens', `${file}.png`), await satori(node, { width: W, height: H, fonts: FONTS }), W);
}

// End cards: what the last seconds of every promo video show.
const logo = dataUri(path.join(root, 'brand/logo-256.png'), 'image/png');
const qr = dataUri(path.join(OUT, 'qr.svg'), 'image/svg+xml');
const phone = dataUri(path.join(OUT, 'raw', '01-cards.png'), 'image/png');
const rawBuf = fs.readFileSync(path.join(OUT, 'raw', '01-cards.png'));
const PHONE_RATIO = rawBuf.readUInt32BE(20) / rawBuf.readUInt32BE(16);   // height / width, from the PNG header
const storePill = (label, size) => el({ padding: `${Math.round(size * 0.45)}px ${Math.round(size * 0.9)}px`, borderRadius: 999, border: '2px solid rgba(255,255,255,0.5)', color: '#fff', fontSize: size, fontWeight: 700 }, label);
function card(w, h, layout) {
  const s = Math.min(w, h);
  const brand = el({ alignItems: 'center', gap: Math.round(s * 0.025) }, [
    { type: 'img', props: { src: logo, width: Math.round(s * 0.1), height: Math.round(s * 0.1), style: { borderRadius: Math.round(s * 0.022) } } },
    el({ color: '#fff', fontSize: Math.round(s * 0.06), fontWeight: 700, letterSpacing: '-0.02em' }, 'The Hour Brief'),
  ]);
  const promise = el({ flexDirection: 'column', alignItems: layout === 'wide' ? 'flex-start' : 'center', textAlign: layout === 'wide' ? 'left' : 'center' }, [
    el({ color: '#fff', fontSize: Math.round(s * 0.058), fontWeight: 700, lineHeight: 1.15, maxWidth: layout === 'wide' ? w * 0.42 : w * 0.86 }, 'AI, business and Indian markets in 7 minutes'),
    el({ color: '#e8b04b', fontSize: Math.round(s * 0.034), fontWeight: 700, marginTop: Math.round(s * 0.02) }, 'Read · listen · play the daily quiz'),
  ]);
  const qrBox = el({ flexDirection: 'column', alignItems: 'center', gap: Math.round(s * 0.018) }, [
    el({ background: '#fff', padding: Math.round(s * 0.02), borderRadius: Math.round(s * 0.03) }, [{ type: 'img', props: { src: qr, width: Math.round(s * 0.3), height: Math.round(s * 0.3) } }]),
    el({ color: '#fff', fontSize: Math.round(s * 0.03), fontWeight: 700 }, 'Scan to get the free app'),
  ]);
  const stores = el({ gap: Math.round(s * 0.02) }, [storePill('App Store', Math.round(s * 0.028)), storePill('Google Play', Math.round(s * 0.028))]);
  const shotEl = (pw) => el({ width: pw, height: Math.round(pw * PHONE_RATIO), overflow: 'hidden', borderRadius: Math.round(pw * 0.09), border: '5px solid rgba(255,255,255,0.25)', boxShadow: '0 24px 60px rgba(0,0,0,0.45)' }, [
    { type: 'img', props: { src: phone, width: pw, style: { width: pw, objectFit: 'cover', objectPosition: 'top' } } }]);
  let kids;
  if (layout === 'tall') kids = [brand, promise, shotEl(Math.round(w * 0.5)), qrBox, stores];
  else if (layout === 'wide') kids = [el({ flexDirection: 'column', gap: Math.round(s * 0.05), justifyContent: 'center' }, [brand, promise, stores]), shotEl(Math.round(h * 0.5)), qrBox];
  else kids = [brand, promise, qrBox, stores];
  return el({ width: w, height: h, background: NIGHT, fontFamily: 'Inter', flexDirection: layout === 'wide' ? 'row' : 'column', alignItems: 'center', justifyContent: 'space-around', padding: Math.round(s * 0.05) }, kids);
}
for (const [name, w, h, layout] of [['endcard-9x16', 1080, 1920, 'tall'], ['endcard-16x9', 1920, 1080, 'wide'], ['endcard-1x1', 1080, 1080, 'square']]) {
  png(path.join(OUT, `${name}.png`), await satori(card(w, h, layout), { width: w, height: h, fonts: FONTS }), w);
}
console.log('promo assets ->', path.relative(root, OUT));
