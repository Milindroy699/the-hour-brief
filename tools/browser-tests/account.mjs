// Browser test for accounts and the first-run welcome (account.js, api/_account.js; owner, 2026-11-26). Runs the real account
// code (api/league.js -> _account.js) against an in-memory stand-in for the KV store, and the site from this repo, in app mode:
// a new reader gets the welcome and creates an account with a number and PIN; a second phone signs in and both phones'
// progress is merged; a wrong PIN is refused; sign-out, delete; someone who used the app before gets no welcome; the
// website gets none; the Home reminder for anonymous readers. Nothing live.
//   node account.mjs [screenshotDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { launch } from './cdp.mjs';
import { start } from './static.mjs';

const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'hb-acct-shots-'));
fs.mkdirSync(OUT, { recursive: true });

// ---- a small Upstash-style KV ----
const store = new Map(), exp = new Map();
const alive = (k) => { if (exp.has(k) && exp.get(k) < Date.now()) { store.delete(k); exp.delete(k); } return store.has(k); };
function cmd(a) {
  const [c, ...x] = a.map(String); const C = c.toUpperCase();
  if (C === 'GET') return alive(x[0]) ? store.get(x[0]) : null;
  if (C === 'SET') { const nx = x.includes('NX'); if (nx && alive(x[0])) return null; store.set(x[0], x[1]); const e = x.indexOf('EX'); if (e > 0) exp.set(x[0], Date.now() + 1000 * +x[e + 1]); return 'OK'; }
  if (C === 'DEL') { let n = 0; x.forEach((k) => { if (store.delete(k)) n++; }); return n; }
  if (C === 'INCR') { const v = (+(alive(x[0]) ? store.get(x[0]) : 0) || 0) + 1; store.set(x[0], String(v)); return v; }
  if (C === 'EXPIRE') { exp.set(x[0], Date.now() + 1000 * +x[1]); return 1; }
  const h = () => { if (!alive(x[0])) store.set(x[0], {}); return store.get(x[0]); };
  if (C === 'HSET') { const o = h(); for (let i = 1; i + 1 < x.length; i += 2) o[x[i]] = x[i + 1]; return 1; }
  if (C === 'HGET') return alive(x[0]) ? store.get(x[0])[x[1]] ?? null : null;
  if (C === 'HMGET') return x.slice(1).map((f) => (alive(x[0]) ? store.get(x[0])[f] ?? null : null));
  if (C === 'HGETALL') return alive(x[0]) ? Object.entries(store.get(x[0])).flat() : [];
  if (C === 'HLEN') return alive(x[0]) ? Object.keys(store.get(x[0])).length : 0;
  if (C === 'SADD') { if (!alive(x[0])) store.set(x[0], new Set()); x.slice(1).forEach((v) => store.get(x[0]).add(v)); return 1; }
  if (C === 'SREM') { if (alive(x[0])) x.slice(1).forEach((v) => store.get(x[0]).delete(v)); return 1; }
  if (C === 'SMEMBERS') return alive(x[0]) ? [...store.get(x[0])] : [];
  return null;
}
const kvServer = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => {
    const send = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'POST' && req.url === '/pipeline') return send(JSON.parse(b).map((a) => ({ result: cmd(a) })));
    if (req.method === 'POST') return send({ result: cmd(JSON.parse(b)) });
    send({ result: cmd(req.url.slice(1).split('/').map(decodeURIComponent)) });
  });
});
await new Promise((r) => kvServer.listen(8895, '127.0.0.1', r));
process.env.KV_REST_API_URL = 'http://127.0.0.1:8895';
process.env.KV_REST_API_TOKEN = 'test';
process.env.CRON_SECRET = 'test-pepper';
const league = createRequire(import.meta.url)('../../api/league.js');

// ---- the site, with /api/account and /api/league run by the real function ----
const { server: files } = await start({ port: 8894, audioDir: fs.mkdtempSync(path.join(os.tmpdir(), 'hb-noaudio-')) });
const site = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/account' || u.pathname === '/api/league') {
    let b = ''; req.on('data', (d) => { b += d; }); req.on('end', async () => {
      req.query = Object.fromEntries(u.searchParams); try { req.body = JSON.parse(b || '{}'); } catch (e) { req.body = {}; }
      const r = { _s: 200, _h: {}, setHeader(k, v) { this._h[k] = v; }, status(s) { this._s = s; return this; },
        json(o) { res.writeHead(this._s, { ...this._h, 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); }, end() { res.writeHead(this._s, this._h); res.end(); }, send(t) { res.writeHead(this._s, this._h); res.end(t); } };
      try { await league(req, r); } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  if (u.pathname.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
  const p = http.request({ host: '127.0.0.1', port: 8894, path: req.url, method: req.method, headers: req.headers }, (pr) => { res.writeHead(pr.statusCode, pr.headers); pr.pipe(res); });
  req.pipe(p);
});
await new Promise((r) => site.listen(8893, '127.0.0.1', r));
const B = 'http://127.0.0.1:8893';

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  -> ' + x)); };
const c = await launch(9389, { home: true });
await c.send('Network.enable');
await c.send('Network.setBlockedURLs', { urls: ['*clarity.ms*', '*/_vercel/insights*', '*r2.dev*'] });
const J = async (e) => { const r = await c.ev(`JSON.stringify(${e})`); if (r && typeof r === 'object' && r.__error) throw new Error('page eval failed: ' + r.__error); return r === undefined ? undefined : JSON.parse(r); };
const waitFor = async (expr, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await c.ev(expr)) return true; await c.sleep(80); } return false; };
const APP = `window.HB_COUNT_TEST = true; window.HB_ONB_TEST = true; window.HB_NO_SW = true; navigator.sendBeacon = () => true;
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {} };`;
let appId = await c.preload(APP);
await c.viewport(412, 915, true, false);
async function fresh(p = '/', store = {}, wait = 3500) {
  await c.goto(B + '/about.html', 400);
  await c.ev(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('hb-swipe-hint-v1','1'); localStorage.setItem('hb-deck-nudge-v1','done');
    ${Object.entries(store).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(typeof v === 'string' ? v : JSON.stringify(v))});`).join(' ')} 1`);
  await c.goto(B + p, wait);
}
const tap = (sel) => c.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
const type = (sel, v) => c.ev(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input')); return true; })()`);
const text = () => J(`(document.querySelector('.hb-onb') || {}).textContent || ''`);
const PHONE = '98765 43210';

// ---------- 1. someone new: the welcome ----------
await fresh();
check('a new reader in the app gets the welcome', await waitFor(`!!document.querySelector('.hb-onb .onb-welcome')`, 4000));
let t = await J(`({ video: (document.querySelector('.onb-hero video') || {}).getAttribute?.('src'), title: document.querySelector('.onb-title').textContent, tabsHidden: getComputedStyle(document.querySelector('.tab-bar:not([data-early])')).visibility })`);
check('welcome: the hourglass clip, the promise, the tabs out of the way', t.video === '/brand/motion/hourglass.mp4' && /mattered/.test(t.title) && t.tabsHidden === 'hidden', JSON.stringify(t));
await c.shot(`${OUT}/01-welcome.png`);
await tap('.onb-next'); await c.sleep(450);
t = await J(`[...document.querySelectorAll('.onb-slide:not([hidden]) .onb-row b')].map((b) => b.textContent)`);
const lanes = await J(`document.querySelector('.onb-slide:not([hidden]) .onb-row-t span').textContent`);
check('what\'s inside: the brief (with today\'s sections), Listen, the quiz, Voices', t.join('|') === 'Today’s brief|Listen|The daily quiz|Voices' && /AI & Tech/.test(lanes), t.join('|') + ' / ' + lanes);
await c.shot(`${OUT}/02-inside.png`);
await tap('.onb-next'); await c.sleep(450);
check('how it works: three tips', (await J(`document.querySelectorAll('.onb-slide:not([hidden]) .onb-tip').length`)) === 3);
await c.shot(`${OUT}/03-how.png`);
await tap('.onb-next'); await c.sleep(450);
t = await J(`({ phone: !!document.querySelector('.acc-primary'), skip: [...document.querySelectorAll('.acc-link')].some((b) => /anonymous/.test(b.textContent)), google: !!document.querySelector('.acc-google'), foot: document.querySelector('.onb-foot').hidden })`);
check('sign-in: phone number, "stay anonymous"; no Google/Apple without native sign-in in the build', t.phone && t.skip && !t.google && t.foot, JSON.stringify(t));
await c.shot(`${OUT}/04-signin.png`);

// ---------- 2. create an account ----------
await c.ev(`localStorage.setItem('hb-saved-v1', JSON.stringify([{ k: 'd1:s1', h: 'Saved on phone one' }])); 1`);
await tap('.acc-panel .acc-primary'); await c.sleep(300);
await type('.acc-field input', '12345'); await tap('.acc-panel .acc-primary'); await c.sleep(300);
check('a short number is refused with a reason', /10-digit/.test(await text()));
await type('.acc-field input', PHONE); await tap('.acc-panel .acc-primary');
check('a new number asks for a new PIN, twice', await waitFor(`document.querySelectorAll('.acc-pin').length === 2`, 4000));
await type('.acc-pin', '1111'); await c.ev(`document.querySelectorAll('.acc-pin')[1].value = '1111'; 1`); await tap('.acc-panel .acc-primary');
check('an easy PIN (1111) is refused', await waitFor(`/not too easy|1234 or 1111/.test(document.querySelector('.acc-msg').textContent)`, 4000), await text());
await c.ev(`document.querySelectorAll('.acc-pin')[0].value = '4821'; document.querySelectorAll('.acc-pin')[1].value = '4822'; 1`); await tap('.acc-panel .acc-primary'); await c.sleep(200);
check('two different PINs are caught', /match/.test(await text()));
await c.ev(`document.querySelectorAll('.acc-pin')[1].value = '4821'; 1`); await tap('.acc-panel .acc-primary');
check('"You\'re signed in"', await waitFor(`/signed in/.test((document.querySelector('.acc-done') || {}).textContent || '')`, 5000), await text());
await c.shot(`${OUT}/05-done.png`);
await waitFor(`!document.querySelector('.hb-onb')`, 6000);
t = await J(`({ acct: JSON.parse(localStorage.getItem('hb-acct-v1') || 'null'), onb: localStorage.getItem('hb-onb-v1') })`);
check('signed in on this phone, the welcome done', !!(t.acct && t.acct.token && t.acct.account.phone === '•• 10') && /^done:/.test(t.onb), JSON.stringify(t));
const keys = [...store.keys()];
check('the server keeps no phone number, only a keyed hash and the last two digits', !JSON.stringify([...store.entries()]).includes('9876543210') && keys.some((k) => k.startsWith('acct:ph:')), keys.join(','));
const uid = [...store.entries()].find(([k]) => k.startsWith('acct:ph:'))[1];
check('the account has this phone\'s saved story', JSON.parse(store.get('acct:' + uid).data).saved.some((x) => x.k === 'd1:s1'));

// ---------- 3. what you do is kept in step ----------
await c.sleep(600);
await c.ev(`localStorage.setItem('hb-quiz-v1', JSON.stringify({ r: { '2026-11-20': { s: 4, t: 5 } }, b: { first: '2026-11-20' }, bs: 1 })); HBAccount.sync()`);
await c.sleep(1000);
check('a sync sends the quiz result to the account', !!JSON.parse(store.get('acct:' + uid).data).quiz.r['2026-11-20']);

// ---------- 4. a second phone ----------
await fresh('/', { 'hb-onb-v1': 'done:2026-11-01', 'hb-quiz-v1': { r: { '2026-11-21': { s: 5, t: 5 } }, b: { perfect: '2026-11-21' }, bs: 1 }, 'hb-saved-v1': [{ k: 'd2:s9', h: 'Saved on phone two' }] });
check('someone who used the app before gets no welcome', await J(`!document.querySelector('.hb-onb')`));
await c.ev(`HBAccount.openSignIn('you')`); await c.sleep(400);
await tap('.acc-panel .acc-primary'); await c.sleep(300);
await type('.acc-field input', '+91 98765 43210'); await tap('.acc-panel .acc-primary');
check('a known number asks for its PIN', await waitFor(`document.querySelectorAll('.acc-pin').length === 1`, 4000));
await c.ev(`document.querySelector('.acc-pin').value = '0000'; 1`); await tap('.acc-panel .acc-primary');
check('a wrong PIN is refused, with the tries left', await waitFor(`/4 tries left/.test(document.querySelector('.acc-msg').textContent)`, 4000), await text());
await c.ev(`document.querySelector('.acc-pin').value = '4821'; 1`); await tap('.acc-panel .acc-primary');
await waitFor(`/signed in/.test((document.querySelector('.acc-done') || {}).textContent || '')`, 5000);
await c.sleep(2600);                                     // the layer closes and the page starts again with the merged copy
t = await J(`({ quiz: Object.keys(JSON.parse(localStorage.getItem('hb-quiz-v1')).r).sort(), saved: JSON.parse(localStorage.getItem('hb-saved-v1')).map((x) => x.k).sort(), badges: Object.keys(JSON.parse(localStorage.getItem('hb-quiz-v1')).b).sort() })`);
check('phone two now has both phones\' quiz days, badges and saved stories', t.quiz.join() === '2026-11-20,2026-11-21' && t.saved.join() === 'd1:s1,d2:s9' && t.badges.join() === 'first,perfect', JSON.stringify(t));

// ---------- 5. You: the account; sign out; delete ----------
await c.ev(`document.querySelector('.hb-home .ab-you') ? document.querySelector('.hb-home .ab-you').click() : HBChrome.you()`); await c.sleep(600);
t = await J(`({ hero: (document.querySelector('.acc-you') || {}).textContent, rows: [...document.querySelectorAll('.hb-you .rd-item')].map((b) => b.dataset.act) })`);
check('You shows the account and offers sign out and delete', /Signed in · •• 10/.test(t.hero || '') && t.rows.includes('signout') && t.rows.includes('delete'), JSON.stringify(t));
await c.shot(`${OUT}/06-you.png`);
await c.ev(`[...document.querySelectorAll('.hb-you .rd-item')].find((b) => b.dataset.act === 'delete').click(); 1`); await c.sleep(400);
check('delete asks first', /Delete your account\?/.test(await text()));
await tap('.acc-danger');
await waitFor(`!localStorage.getItem('hb-acct-v1')`, 5000);
check('deleted: gone from the server (account, PIN, number link, both phones\' sessions)', ![...store.keys()].some((k) => alive(k) && (k.startsWith('acct:') || k.startsWith('sess:'))), [...store.keys()].join(','));
check('and this phone keeps its own copy', await J(`JSON.parse(localStorage.getItem('hb-saved-v1')).length === 2`));

// ---------- 6. skip, and the quiet reminder later ----------
await fresh();
await waitFor(`!!document.querySelector('.hb-onb')`, 4000);
await tap('.onb-skip'); await c.sleep(400);
check('Skip goes straight to sign-in', await J(`!!document.querySelector('.onb-acc:not([hidden])')`));
await c.ev(`[...document.querySelectorAll('.acc-link')].find((b) => /anonymous/.test(b.textContent)).click(); 1`);
await waitFor(`!document.querySelector('.hb-onb')`, 3000);
check('"Stay anonymous" closes it for good', await J(`/^done:/.test(localStorage.getItem('hb-onb-v1')) && !localStorage.getItem('hb-acct-v1')`));
await c.ev(`localStorage.setItem('hb-quiz-v1', JSON.stringify({ r: { '2026-11-20': { s: 3, t: 5 }, '2026-11-21': { s: 4, t: 5 } }, b: {}, bs: 2 })); 1`);
await c.goto(B + '/', 3500);
check('anonymous with two quizzes played: a small sign-in card on Home', await waitFor(`!!document.querySelector('.hm-scroll .acc-nudge')`, 4000));
await c.goto(B + '/', 3500);
check('not again the next time (a week apart)', await J(`!document.querySelector('.hm-scroll .acc-nudge')`));

// ---------- 7. the website ----------
await c.unpreload(appId);
appId = await c.preload(`window.HB_COUNT_TEST = true; window.HB_ONB_TEST = true; window.HB_NO_SW = true; navigator.sendBeacon = () => true;`);
await fresh();
check('the website (phone browser) gets no welcome', await J(`!document.querySelector('.hb-onb')`));

const errs = c.errors.filter((e) => !/favicon|r2\.dev|ERR_|ViewTransition|Failed to load resource|404/.test(e));
check('no script errors anywhere in the run', !errs.length, errs.slice(0, 3).join(' | '));
console.log(`\n${pass} passed, ${fail} failed · screenshots in ${OUT}`);
c.close(); files.close(); site.close(); kvServer.close(); process.exit(fail ? 1 : 0);
