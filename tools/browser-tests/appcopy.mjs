// Browser test for the app's copy of itself (sw.js, tools/app/manifest.mjs, capacitor-bridge.js appCopy; owner, 2026-11-25:
// "bundle the app code inside the app", with live updates). In app mode, on a COPY of the site (so a new version can be
// published mid-test): the first open keeps every manifest file on the phone; with the network off the app still opens on
// Home, Brief, Challenge and Voices; a new version downloads in the background, only the changed files, and is used from
// the next open; the kill switch drops the copy; the website never installs it.
//   node appcopy.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from './cdp.mjs';
import { start } from './static.mjs';

const REPO = path.resolve(import.meta.dirname, '../..');
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-site-'));
const copy = (rel) => { const s = path.join(REPO, rel), d = path.join(SITE, rel); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.cpSync(s, d, { recursive: true }); };
['index.html', 'leaders.html', 'week.html', 'about.html', 'privacy.html', 'contact.html', 'corrections.html', 'podcasts.html', 'sw.js', 'editions.json', 'leaders-data.json',
  'mobile.js', 'cards.js', 'listen.js', 'quiz.js', 'home.js', 'capacitor-bridge.js', 'mobile.css', 'reader.css', 'app.css', 'quiz.css', 'webfonts', 'fonts', 'brand/backgrounds', 'brand/stories',
  'brand/rewards', 'brand/logo-128.png', 'brand/logo-256.png', 'brand/icon-192.png', 'brand/favicon-32.png', 'brand/apple-touch-icon.png', 'archive'].forEach(copy);
const { server } = await start({ port: 8796, audioDir: fs.mkdtempSync(path.join(os.tmpdir(), 'hb-noaudio-')), root: SITE });
const B = 'http://127.0.0.1:8796';
let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  -> ' + x)); };
const c = await launch(9386, { home: true });
await c.send('Network.enable');
await c.send('Network.setBlockedURLs', { urls: ['*clarity.ms*', '*/_vercel/insights*'] });
const J = async (e) => { const r = await c.ev(`JSON.stringify(${e})`); if (r && typeof r === 'object' && r.__error) throw new Error('page eval failed: ' + r.__error); return r === undefined ? undefined : JSON.parse(r); };
const waitFor = async (expr, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await c.ev(expr)) return true; await c.sleep(100); } return false; };
const APP = `(() => { const f = window.fetch; window.fetch = (u, o) => { u = String(u); if (u.indexOf('/api/') >= 0) return Promise.resolve(new Response('{}', { status: 200 })); return f(u, o); };
  navigator.sendBeacon = () => true; window.HB_COUNT_TEST = true; window.__msgs = [];
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', (e) => { window.__msgs.push(e.data && e.data.type); window.__last = e.data; });
  window.__app = []; window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { App: { addListener: (n, fn) => { window.__app.push([n, fn]); return { remove() {} }; } } } }; })();`;
const appId = await c.preload(APP);
await c.viewport(412, 915, true, false);
const offline = (on) => c.send('Network.emulateNetworkConditions', { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
const JP = async (e) => JSON.parse(await c.ev(`(${e}).then((x) => JSON.stringify(x))`));
const cached = () => JP(`caches.open('hb-core-v1').then((c) => c.keys()).then((k) => k.map((r) => new URL(r.url).pathname))`);

// ---------- 1. first open: the copy is made ----------
await c.goto(B + '/about.html', 400);
await c.ev(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('hb-swipe-hint-v1','1'); localStorage.setItem('hb-deck-nudge-v1','done'); 1`);
await c.goto(B + '/', 3000);
check('in the app, the page installs the copy (sw.js)', await waitFor(`navigator.serviceWorker && navigator.serviceWorker.controller !== null`, 8000), await J(`String(!!navigator.serviceWorker)`));
const man = JSON.parse(await (await fetch(B + '/app-manifest.json')).text());
let keys = await cached();
check(`every manifest file is on the phone (${Object.keys(man.files).length})`, Object.keys(man.files).every((p) => keys.includes(p)), Object.keys(man.files).filter((p) => !keys.includes(p)).slice(0, 5).join(', '));

// ---------- 2. no network: the app still opens ----------
await offline(true);
await c.goto(B + '/', 3500);
let t = await J(`({ home: !!(window.HBHome && HBHome.isOpen()), stories: document.querySelectorAll('.item[data-story-id]').length, tabs: document.querySelectorAll('.tab-bar:not([data-early]) .tab').length })`);
check('offline: the app opens on Home with today\'s stories and the tabs', t.home && t.stories > 5 && t.tabs === 4, JSON.stringify(t));
await c.goto(B + '/?brief=1', 3000);
check('offline: Brief opens the cards', await J(`!!(window.HBCards && HBCards.isOpen())`));
await c.goto(B + '/?quiz=1', 3000);
check('offline: Challenge opens', await J(`document.documentElement.classList.contains('hb-quiz-page')`));
await c.goto(B + '/leaders.html', 3500);
check('offline: Voices opens with its pieces', await J(`document.querySelectorAll('.tl-card, article, .brief').length > 0 || document.body.textContent.length > 2000`));
const recent = Object.keys(man.files).filter((p) => /^\/archive\/\d/.test(p)).pop();
await c.goto(B + recent, 2500);
check('offline: a recent past edition opens', await J(`document.querySelectorAll('.item[data-story-id]').length > 5`), recent);
await offline(false);

// ---------- 3. a new version: only the changed files, used from the next open ----------
await c.goto(B + '/', 3000);
const marker = 'hb-new-version-' + Date.now();
fs.writeFileSync(path.join(SITE, 'index.html'), fs.readFileSync(path.join(SITE, 'index.html'), 'utf8').replace('</body>', `<i id="${marker}" hidden></i></body>`));
await c.ev(`window.__msgs = []; navigator.serviceWorker.controller.postMessage({ type: 'hb-check' }); 1`);
check('a new version is announced once it has downloaded', await waitFor(`window.__msgs.includes('hb-updated')`, 8000), await J(`window.__msgs`));
await c.sleep(300);
t = await J(`window.__last`);
check('only the changed file was downloaded (1 of ' + Object.keys(man.files).length + ')', t && t.files === 1, JSON.stringify(t));
check('the open page is left alone until the next open', await J(`!document.getElementById('${marker}')`));
await c.goto(B + '/', 3000);
check('the next open uses the new version', await J(`!!document.getElementById('${marker}')`));
await offline(true);
await c.goto(B + '/', 3000);
check('and it is what the phone keeps (offline too)', await J(`!!document.getElementById('${marker}')`));
await offline(false);

// ---------- 4. coming back to the app on Home with new code waiting: it switches; in the quiz it doesn't ----------
fs.appendFileSync(path.join(SITE, 'home.js'), '\n/* v2 */\n');
await c.ev(`window.__msgs = []; navigator.serviceWorker.controller.postMessage({ type: 'hb-check' }); 1`);
await waitFor(`window.__msgs.includes('hb-updated')`, 8000);
await c.ev(`window.__keep = 1; HBQuizPlay(); 1`); await c.sleep(500);
await c.ev(`window.__app.filter((x) => x[0] === 'appStateChange').forEach((x) => x[1]({ isActive: true })); 1`); await c.sleep(1200);
check('back in the app mid-quiz: no reload', await J(`window.__keep === 1`));
await c.ev(`document.querySelector('.qz-play-x').click(); 1`); await c.sleep(300);
await c.ev(`window.__app.filter((x) => x[0] === 'appStateChange').forEach((x) => x[1]({ isActive: true })); 1`);
check('back in the app on Home: it switches to the new code', await waitFor(`window.__keep !== 1`, 5000));

// ---------- 5. the kill switch, and the website ----------
process.env.APP_CACHE = 'off';
await c.goto(B + '/', 2500);
await c.ev(`navigator.serviceWorker.controller && navigator.serviceWorker.controller.postMessage({ type: 'hb-check' }); 1`);
check('APP_CACHE=off: the phones drop the copy', await waitFor(`caches.keys().then((k) => !k.some((x) => /^hb-core/.test(x)))`, 8000));
delete process.env.APP_CACHE;
await c.unpreload(appId);
await c.preload(`window.HB_COUNT_TEST = true;`);
await c.goto(B + '/about.html', 300);
await c.ev(`navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister()))).then(() => caches.keys()).then((ks) => Promise.all(ks.map((k) => caches.delete(k))))`);
await c.goto(B + '/', 3000);
check('the website (no app) never installs it', await c.ev(`navigator.serviceWorker.getRegistrations().then((r) => r.length === 0)`));

const errs = c.errors.filter((e) => !/favicon|ERR_INTERNET_DISCONNECTED|ERR_FAILED|net::|r2\.dev|ViewTransition|Failed to load resource/.test(e));
check('no script errors anywhere in the run', !errs.length, errs.slice(0, 3).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
fs.rmSync(SITE, { recursive: true, force: true });
c.close(); server.close(); process.exit(fail ? 1 : 0);
