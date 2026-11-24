// Deep links (2026-11-22). Two parts:
//  1. In the app (local, a stand-in for Capacitor): a link the phone hands to the app (appUrlOpen) lands on the right page and
//     that page opens the right thing — an edition, a story, a quiz challenge, a league invite, the weekly recap, a Voices
//     article, Audio and Challenge, the home page — and links to other sites are left alone.
//  2. Live (--live): each shared link on the-hour-brief.vercel.app answers and points where it should; the iOS and Android
//     link-association files are served and claim those paths; what Apple's and Google's servers currently hold.
//   node deeplinks.mjs [--live]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from './cdp.mjs';
import { start } from './static.mjs';

const LIVE = process.argv.includes('--live');
const SITE = 'https://the-hour-brief.vercel.app';
let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  -> ' + x)); };
const ROOT = path.resolve(import.meta.dirname, '../..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const TODAY = (HTML.match(/data-edition-date="(\d{4}-\d{2}-\d{2})"/) || [])[1];
const PAST = fs.readdirSync(path.join(ROOT, 'archive')).filter((f) => /^\d{4}-\d{2}-\d{2}\.html$/.test(f) && f.slice(0, 10) !== TODAY).sort().pop().slice(0, 10);
const PAST_HTML = fs.readFileSync(path.join(ROOT, 'archive', PAST + '.html'), 'utf8');
const STORY = (PAST_HTML.match(/data-story-id="([a-z]+-\d+)"/) || [])[1];
const VOICE = (JSON.parse(fs.readFileSync(path.join(ROOT, 'leaders-data.json'), 'utf8')).briefs || []).map((b) => b.id).filter(Boolean)[0];

// ---- 1. In the app ----
const { server } = await start({ port: 8797, audioDir: fs.mkdtempSync(path.join(os.tmpdir(), 'hb-noaudio-')) });
const B = 'http://127.0.0.1:8797';
const c = await launch(9387);
const J = async (e) => { const r = await c.ev(`JSON.stringify(${e})`); if (r && typeof r === 'object' && r.__error) throw new Error('page eval failed: ' + r.__error); return JSON.parse(r); };
const waitFor = async (expr, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await c.ev(expr)) return true; await c.sleep(80); } return false; };
// The app: Capacitor with an App plugin that remembers the appUrlOpen listener; the server's APIs answer quietly.
const APP = `(() => {
  window.__appUrl = null;
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: { App: { addListener: (ev, fn) => { if (ev === 'appUrlOpen') window.__appUrl = fn; return { remove() {} }; } } } };
  const f = window.fetch;
  window.fetch = (u, o) => {
    u = String(u);
    if (u.indexOf('/api/league') >= 0) return Promise.resolve(new Response(JSON.stringify({ name: 'Bandra Office', label: 'Office', members: 4 }), { status: 200 }));
    if (u.indexOf('/api/') >= 0 || u.indexOf('/social/') >= 0) return Promise.resolve(new Response('{}', { status: u.indexOf('/social/') >= 0 ? 404 : 200 }));
    return f(u, o);
  };
})();`;
await c.preload(APP);
await c.viewport(390, 844, true);
await c.goto(B + '/about.html', 300);
await c.ev(`localStorage.clear(); sessionStorage.setItem('hb-view-v1', 'list'); localStorage.setItem('hb-swipe-hint-v1', '1'); 'ok'`);
// Hand a link to the app the way iOS / Android do (from the home page), then read where it went.
async function tap(url) {
  await c.goto(B + '/', 1600);
  await waitFor(`typeof window.__appUrl === 'function'`, 3000);
  await c.ev(`window.__appUrl({ url: ${JSON.stringify(url.replace(SITE, B))} })`);
  await c.sleep(2400);
  return J(`location.pathname + location.search + location.hash`);
}
let t = await tap(`${SITE}/e/${PAST}`);
check(`/e/<date> opens that edition (${PAST})`, t.startsWith(`/archive/${PAST}.html`), t);
t = await tap(`${SITE}/e/latest`);
check('/e/latest opens today\'s edition', t === '/' || t.startsWith('/?') || t.startsWith('/#'), t);
t = await tap(`${SITE}/s/${PAST}/${STORY}`);
let s = await J(`(() => { const el = document.getElementById(${JSON.stringify(STORY)}) || document.querySelector('[data-story-id="${STORY}"]'); const r = el && el.getBoundingClientRect(); return { top: r ? Math.round(r.top) : null, h: innerHeight }; })()`);
check(`/s/<date>/<story> opens that story in that edition, scrolled into view`, t.startsWith(`/archive/${PAST}.html`) && t.endsWith('#' + STORY) && s.top != null && s.top >= -5 && s.top < s.h * 0.6, JSON.stringify({ t, s }));
t = await tap(`${SITE}/q/${PAST}/3`);
s = await J(`(() => { const v = document.querySelector('.quiz-versus, .qz-beat, #quiz'); return { beat: /beat=3/.test(location.search), quiz: !!document.getElementById('quiz') }; })()`);
check('/q/<date>/<score> opens that edition\'s quiz with the friend\'s score to beat', t.startsWith(`/archive/${PAST}.html`) && t.endsWith('#quiz') && s.beat && s.quiz, JSON.stringify({ t, s }));
t = await tap(`${SITE}/l/ABCDEF?n=Bandra%20Office`);
await waitFor(`!!document.querySelector('.qz-join .quiz-friend')`, 4000);
s = await J(`(() => ({ tab: (document.querySelector('.qz-seg-btn.on') || {}).textContent || null, join: (document.querySelector('.qz-join .quiz-friend') || {}).textContent || '', page: document.documentElement.classList.contains('hb-quiz-page') }))()`);
check('/l/<code> opens Challenge on Leagues with the invite to join that league', t.startsWith('/?join=ABCDEF') && s.join.indexOf('Bandra Office') >= 0 && (s.tab === null || s.tab === 'Leagues'), JSON.stringify({ t, s }));
t = await tap(`${SITE}/week.html?d=${TODAY}&src=linkedin`);
s = await J(`({ title: document.getElementById('title') && document.getElementById('title').textContent, back: !!document.querySelector('.ab-back, [aria-label^="Back"]') })`);
check('the weekly recap link opens the recap page, with a way back', t.startsWith('/week.html?d=' + TODAY) && s.back, JSON.stringify({ t, s }));
if (VOICE) {
  t = await tap(`${SITE}/leaders.html#a=${VOICE}`);
  await waitFor(`!!document.querySelector('.tl-art-title') && document.querySelector('.tl-art-title').offsetParent !== null`, 5000);
  s = await J(`(() => { const t = document.querySelector('.tl-art-title'); return { hash: location.hash, art: !!t && t.offsetParent !== null && t.textContent.length > 5 }; })()`);
  check('a Voices article link opens Voices on that article', t.startsWith('/leaders.html') && s.hash === '#a=' + VOICE && s.art, JSON.stringify({ t, s }));
}
t = await tap(`${SITE}/?quiz=1`);
s = await J(`document.documentElement.classList.contains('hb-quiz-page')`);
check('/?quiz=1 opens Challenge', s === true, JSON.stringify({ t, s }));
t = await tap(`${SITE}/?audio=1`);
await c.sleep(600);
s = await J(`document.documentElement.classList.contains('hb-hub-open')`);
check('/?audio=1 opens Audio', s === true, JSON.stringify({ t, s }));
t = await tap(`${SITE}/?src=whatsapp`);
check('the home page link (with a source tag) opens Today', t.startsWith('/?src=whatsapp') || t === '/', t);
await c.goto(B + '/', 1600);
await waitFor(`typeof window.__appUrl === 'function'`, 3000);
await c.ev(`window.__appUrl({ url: 'https://example.com/elsewhere' })`); await c.sleep(1200);
t = await J(`location.href`);
check('a link to another site is left alone (the app stays where it was)', t === B + '/', t);
const errs = c.errors.filter((e) => !/r2\.dev|__audio|net::ERR|Failed to load resource|CORS|ViewTransition/.test(e));
check('no script errors while following the links', errs.length === 0, errs.join(' | '));
c.close(); server.close();

// ---- 2. Live ----
if (LIVE) {
  const get = async (u, opts = {}) => { const r = await fetch(u, { redirect: 'manual', ...opts }); return { status: r.status, type: r.headers.get('content-type') || '', loc: r.headers.get('location') || '', body: r.status === 200 ? await r.text() : '' }; };
  const ua = { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' } };
  for (const [u, dest, what] of [[`/e/${PAST}`, `/archive/${PAST}.html`, 'an edition'], [`/s/${PAST}/${STORY}`, `#${STORY}`, 'a story'], [`/q/${PAST}/3`, 'beat=3', 'a quiz challenge'], ['/l/ABCDEF?n=Test', 'join=ABCDEF', 'a league invite']]) {
    const r = await get(SITE + u, ua);
    check(`live ${u} (${what}) answers with a landing page that leads to ${dest}`, r.status === 200 && r.body.indexOf(dest) >= 0 && /og:title/.test(r.body), JSON.stringify({ status: r.status, loc: r.loc, has: r.body.indexOf(dest) >= 0 }));
  }
  let r = await get(SITE + '/app?src=deeplink-test', ua);
  check('live /app answers (the store link page)', r.status === 200 || (r.status >= 300 && r.status < 400), JSON.stringify({ status: r.status, loc: r.loc }));
  for (const u of [`/week.html?d=${TODAY}`, '/leaders.html', '/voices', '/?quiz=1', '/']) {
    r = await get(SITE + u, ua);
    check(`live ${u} answers`, r.status === 200, String(r.status));
  }
  r = await get(SITE + '/.well-known/apple-app-site-association');
  let aasa = null; try { aasa = JSON.parse(r.body); } catch (e) {}
  const paths = aasa ? aasa.applinks.details[0].components.map((x) => x['/']) : [];
  check('the iOS association file is served as JSON and claims the shared links, the recap, Voices, editions and home', r.status === 200 && /json/.test(r.type) && ['/e/*', '/s/*', '/q/*', '/l/*', '/', '/week.html', '/leaders.html', '/voices', '/archive/*'].every((p) => paths.includes(p)) && !paths.includes('/app'), JSON.stringify({ status: r.status, type: r.type, paths }));
  r = await get('https://app-site-association.cdn-apple.com/a/v1/the-hour-brief.vercel.app');
  let cdn = []; try { cdn = JSON.parse(r.body).applinks.details[0].components.map((x) => x['/']); } catch (e) {}
  console.log((cdn.includes('/week.html') ? 'INFO ' : 'WAIT ') + 'Apple\'s copy (what iPhones use): ' + (cdn.includes('/week.html') ? 'up to date' : 'still the old one (' + cdn.join(' ') + '), refreshes on Apple\'s schedule'));
  r = await get(SITE + '/.well-known/assetlinks.json');
  let al = null; try { al = JSON.parse(r.body); } catch (e) {}
  check('the Android association file is served as JSON for app.thehourbrief', r.status === 200 && /json/.test(r.type) && al && al[0].target.package_name === 'app.thehourbrief' && al[0].target.sha256_cert_fingerprints.length >= 1, JSON.stringify({ status: r.status, type: r.type }));
  r = await get(`https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=${encodeURIComponent(SITE)}&relation=delegate_permission/common.handle_all_urls`);
  let st = []; try { st = JSON.parse(r.body).statements || []; } catch (e) {}
  check('Google\'s link checker reads it and sees the app (so Android opens these links in the app)', st.some((x) => x.target && x.target.androidApp && x.target.androidApp.packageName === 'app.thehourbrief'), r.body.slice(0, 300));
  const man = fs.readFileSync(path.join(ROOT, 'mobile/android/app/src/main/AndroidManifest.xml'), 'utf8');
  check('the Android app claims every path on the site (autoVerify, no path filter)', /android:autoVerify="true"/.test(man) && /android:host="the-hour-brief\.vercel\.app"/.test(man) && !/android:path(Prefix|Pattern)?=/.test(man), 'manifest');
  const ent = fs.readFileSync(path.join(ROOT, 'mobile/ios/App/App/App.entitlements'), 'utf8');
  check('the iPhone app claims the domain (Associated Domains)', /applinks:the-hour-brief\.vercel\.app/.test(ent), 'entitlements');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
