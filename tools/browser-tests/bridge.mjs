// Browser test for capacitor-bridge.js (native-app-only glue) and the site-wide scroll-restoration fix:
//   - history.scrollRestoration is set to 'manual' on every page, so a reload lands at the top instead of wherever the
//     reader last scrolled to (a real browser default that only shows up on reload, never on a first load).
//   - the "new edition" watcher opens today's edition automatically once it is safe to do so (at rest near the top,
//     the swipe-card deck still on its cover if open, no audio playing or paused, the quiz not left half-answered),
//     rather than making the reader tap a banner. If it isn't safe, a small banner offers to switch now, or waits and
//     switches on its own once idle. None of this runs outside the native apps.
//   node bridge.mjs [screenshotDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from './cdp.mjs';
import { start } from './static.mjs';

const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'hb-bridge-shots-'));
fs.mkdirSync(OUT, { recursive: true });
const { server } = await start({ port: 8799, audioDir: fs.mkdtempSync(path.join(os.tmpdir(), 'hb-na-')) });
const B = 'http://127.0.0.1:8799';

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  -> ' + x)); };
const c = await launch(9406);
const J = async (e) => JSON.parse(await c.ev(`JSON.stringify(${e})`));
const waitFor = async (expr, ms = 4000) => { const t0 = Date.now(); const test = typeof expr === 'function' ? expr : () => c.ev(expr); while (Date.now() - t0 < ms) { if (await test()) return true; await c.sleep(60); } return false; };

const CURRENT = /data-edition-date="(\d{4}-\d{2}-\d{2})"/.exec(fs.readFileSync(path.resolve(import.meta.dirname, '../../index.html'), 'utf8'))[1];
const dayAfter = (d) => new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
const LATEST = dayAfter(CURRENT);

const NATIVE = `window.Capacitor = { isNativePlatform: () => true, Plugins: {} };`;
// A navigation counter that survives a reload (sessionStorage, not a JS variable, which a fresh document would reset),
// so the test can tell "did it actually reload" apart from "did the page just repaint". Every open() starts it at 0.
const NAV_COUNT = `sessionStorage.setItem('__nav__', String((+sessionStorage.getItem('__nav__') || 0) + 1));`;
// Reports LATEST the first time /editions.json is fetched, then an old date after (also via sessionStorage, so a real
// reload — the very thing under test — does not see "a newer edition" again and loop).
const fakeEditions = (date, delayMs) => `(() => {
  var orig = window.fetch;
  window.fetch = function (url, opts) {
    if (typeof url === 'string' && url.indexOf('/editions.json') === 0) {
      var served = sessionStorage.getItem('__served__');
      var d = served ? '2000-01-01' : ${JSON.stringify(date)};
      sessionStorage.setItem('__served__', '1');
      var body = JSON.stringify({ editions: [{ date: d }] });
      var make = function () { return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }); };
      return ${delayMs ? `new Promise(function (res) { setTimeout(function () { res(make()); }, ${delayMs}); })` : 'Promise.resolve(make())'};
    }
    return orig.apply(this, arguments);
  };
})();`;
const FAKE_EDITIONS = (retryMs) => `window.HB_RETRY_MS = ${retryMs}; ${NAV_COUNT} ${fakeEditions(LATEST)}`;
const NO_NEWER = `${NAV_COUNT} ${fakeEditions('2000-01-01')}`;
const LISTEN_PLAYING = `window.HBListen = { state: function () { return 'playing'; } };`;
// Real cards.js is left to load on its own (Cards is the default view); once it does, this pushes the deck past the
// cover card, as if the reader had swiped once. The matching editions.json fetch is deliberately delayed (see below)
// so the first check happens after that, not before cards.js has even loaded.
const DECK_PAST_COVER = `(function poll() {
  if (window.HBCards && typeof window.HBCards.goTo === 'function') { window.HBCards.goTo(1, false); return; }
  setTimeout(poll, 30);
})();`;
const SCROLLED_DOWN = `Object.defineProperty(document, 'scrollingElement', { get: function () { return { scrollTop: 500 }; }, configurable: true });`;
const QUIZ_MIDWAY = `(() => { var orig = Document.prototype.querySelectorAll; Document.prototype.querySelectorAll = function (sel) {
  if (sel === '.quiz-dot') return new Array(5);
  if (sel === '.quiz-dot.ok, .quiz-dot.no') return new Array(2);
  return orig.call(this, sel);
}; })();`;

let ids = [];
async function open(path_, extras = [], { width = 390, wait = 700 } = {}) {
  for (const id of ids) await c.unpreload(id);
  ids = [];
  for (const p of extras) ids.push(await c.preload(p));
  await c.viewport(width, 844, width < 700, false);
  await c.goto(B + '/about.html', 300);
  await c.ev(`localStorage.clear(); sessionStorage.clear(); 'ok'`);
  await c.goto(B + path_, wait);
}
const banner = () => c.ev(`!!document.getElementById('cap-newedition')`);
const navCount = () => c.ev(`+sessionStorage.getItem('__nav__') || 0`);
const scrollRestoration = () => c.ev(`history.scrollRestoration`);

// ---------- 1. scroll restoration: every page, native or not ----------
await open('/', [], { wait: 500 });
check("today's edition: history.scrollRestoration is 'manual' (so a reload lands at the top, not wherever the reader last scrolled)", (await scrollRestoration()) === 'manual');
for (const p of ['/about.html', '/contact.html', '/privacy.html', '/archive/']) {
  await open(p, [], { wait: 500 });
  check(`${p}: the same fix is in place`, (await scrollRestoration()) === 'manual', await scrollRestoration());
}
await open('/', [NATIVE], { wait: 500 });
check('and in the native app too', (await scrollRestoration()) === 'manual');

// ---------- 2. no newer edition: nothing happens ----------
await open('/', [NATIVE, NO_NEWER], { wait: 900 });
check('with no newer edition, nothing appears and nothing reloads', !(await banner()) && (await navCount()) === 1, await navCount());

// ---------- 3. idle (the common case): opens on its own, no tap, no banner flash ----------
await open('/', [NATIVE, FAKE_EDITIONS(300)], { wait: 100 });
check("today's edition opens by itself — the reader never sees a banner or has to tap anything", await waitFor(async () => (await navCount()) === 2, 3000));
await c.sleep(500);
check('and it reloads exactly once (no loop)', (await navCount()) === 2, await navCount());
check('and it lands at the top (the scroll-restoration fix applies to this reload too)', (await c.ev(`(document.scrollingElement || document.documentElement).scrollTop`)) === 0);

// ---------- 4. busy: audio playing — a banner appears, but it does not interrupt anything ----------
await open('/', [NATIVE, FAKE_EDITIONS(60000), LISTEN_PLAYING], { wait: 700 });
check('while audio is playing, a banner offers the new edition instead of forcing it', await waitFor(banner, 3000) && (await navCount()) === 1);
const t = await J(`(() => { const b = document.getElementById('cap-newedition'), go = b.querySelector('.cap-ne-go'); return { title: (go.firstChild && go.firstChild.textContent) || '', hasSmall: !!go.querySelector('small'), small: (go.querySelector('small') || {}).textContent || '', hasX: !!b.querySelector('.cap-ne-x') }; })()`);
check('it says the edition is ready and that it opens automatically, with a way to switch now or dismiss', /New edition ready/i.test(t.title) && /automatically/i.test(t.small) && t.hasX, JSON.stringify(t));
await c.sleep(900);
check('and it keeps waiting rather than interrupting playback', (await navCount()) === 1 && (await banner()));

// ---------- 5. busy, then goes idle: opens on its own once free, still with no tap ----------
await open('/', [NATIVE, FAKE_EDITIONS(300), LISTEN_PLAYING], { wait: 700 });
await waitFor(banner, 3000);
await c.ev(`window.HBListen.state = function () { return 'idle'; }; 'ok'`);
check('once playback stops, it opens on its own without any tap', await waitFor(async () => (await navCount()) === 2, 3000));

// ---------- 6. busy: the swipe-card deck open past its cover ----------
await open('/', [NATIVE, `window.HB_RETRY_MS = 60000; ${NAV_COUNT} ${fakeEditions(LATEST, 700)}`, DECK_PAST_COVER], { wait: 100 });
await waitFor(async () => (await c.ev(`window.HBCards && window.HBCards.index && window.HBCards.index()`)) === 1, 3000);
check('with the deck moved past the cover card, it waits rather than pulling the reader off what they are reading', await waitFor(banner, 3000) && (await navCount()) === 1);
await c.sleep(900);
check('and does not force it while that stays true', (await navCount()) === 1 && (await banner()));

// ---------- 7. busy: scrolled down the list ----------
await open('/', [NATIVE, FAKE_EDITIONS(60000), SCROLLED_DOWN], { wait: 700 });
check('scrolled into the list, it waits too', await waitFor(banner, 3000) && (await navCount()) === 1);

// ---------- 8. busy: the quiz half-answered ----------
await open('/', [NATIVE, FAKE_EDITIONS(60000), QUIZ_MIDWAY], { wait: 700 });
check('with the quiz half-answered, it waits rather than resetting the reader mid-quiz', await waitFor(banner, 3000) && (await navCount()) === 1);

// ---------- 9. the banner's own button opens it right away, busy or not ----------
await open('/', [NATIVE, FAKE_EDITIONS(60000), LISTEN_PLAYING], { wait: 700 });
await waitFor(banner, 3000);
await c.ev(`document.querySelector('#cap-newedition .cap-ne-go').click()`);
check("tapping the banner opens the new edition immediately, even while busy (the reader's own choice overrides the wait)", await waitFor(async () => (await navCount()) === 2, 3000));

// ---------- 10. dismissing it is respected: no banner, and it does not open on its own for that edition ----------
await open('/', [NATIVE, FAKE_EDITIONS(60000), LISTEN_PLAYING], { wait: 700 });
await waitFor(banner, 3000);
await c.ev(`document.querySelector('#cap-newedition .cap-ne-x').click()`);
check('the × removes the banner', !(await banner()));
await c.sleep(900);
check('and it is not opened for the reader after that either', (await navCount()) === 1 && !(await banner()));
const dismissed = await c.ev(`localStorage.getItem('hb-newedition-dismissed-${LATEST}')`);
check("the dismissal is remembered against that edition's date", dismissed === '1', String(dismissed));

// ---------- 11. none of this runs outside the app ----------
await open('/', [FAKE_EDITIONS(300)], { wait: 1500 });
check('on the website (not the app), nothing opens on its own and no banner appears, even idle with a newer edition available', (await navCount()) === 1 && !(await banner()));

const errs = c.errors.filter((e) => !/r2\.dev|__audio|net::ERR|CORS/.test(e));
check('no script errors anywhere in the run', errs.length === 0, errs.join(' | '));

console.log(`\n${pass} passed, ${fail} failed · screenshots in ${OUT}`);
c.close();
server.close();
process.exit(fail ? 1 : 0);
