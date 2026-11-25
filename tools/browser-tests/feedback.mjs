// Browser test for the owner's 2026-11-25 feedback round (found on Android): opening a story or a section from Home never
// shows the list in between; an Explore tile opens that section alone, ending on a card with the others; the answer card's
// Next is pinned; the score puts Share above the fold with the answers folded; "Back to the quiz" answers the first touch;
// pull-to-refresh only fires at the real top; You's header matches the others; Android drops the live blurs.
// Runs against a local copy of the site (static.mjs) in app mode; nothing live.
//   node feedback.mjs [screenshotDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from './cdp.mjs';
import { start } from './static.mjs';

const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'hb-fb-shots-'));
fs.mkdirSync(OUT, { recursive: true });
const { server } = await start({ port: 8798, audioDir: fs.mkdtempSync(path.join(os.tmpdir(), 'hb-noaudio-')) });
const B = 'http://127.0.0.1:8798';
let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  -> ' + x)); };
const c = await launch(9388, { home: true });
await c.send('Network.enable');
await c.send('Network.setBlockedURLs', { urls: ['*clarity.ms*', '*/_vercel/insights*'] });
const J = async (e) => { const r = await c.ev(`JSON.stringify(${e})`); if (r && typeof r === 'object' && r.__error) throw new Error('page eval failed: ' + r.__error); return r === undefined ? undefined : JSON.parse(r); };
const waitFor = async (expr, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await c.ev(expr)) return true; await c.sleep(60); } return false; };
await c.preload(`(() => { const f = window.fetch; window.fetch = (u, o) => { u = String(u);
  if (u.indexOf('/social/') >= 0 || u.indexOf('r2.dev') >= 0) return Promise.resolve(new Response('', { status: 404 }));
  if (u.indexOf('/api/') >= 0) return Promise.resolve(new Response('{}', { status: 200 }));
  return f(u, o); }; navigator.sendBeacon = () => true; window.HB_COUNT_TEST = true;
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {} }; })();`);
await c.viewport(412, 915, true, false);
async function fresh(p = '/', wait = 3500) {
  await c.goto(B + '/about.html', 400);
  await c.ev(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('hb-swipe-hint-v1','1'); localStorage.setItem('hb-deck-nudge-v1','done'); 1`);
  await c.goto(B + p, wait);
}
const touchTap = async (x, y) => { await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await c.sleep(60); await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
const center = (sel) => J(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
// a watcher: was there ever a frame with neither Home nor the deck (nor the quiz page) on screen?
const WATCH = `window.__gap = 0; (function tick() { const cl = document.documentElement.classList; if (!cl.contains('hb-home-open') && !cl.contains('hb-deck-open') && !cl.contains('hb-quiz-page')) window.__gap++; if (window.__watch !== false) requestAnimationFrame(tick); })(); 1`;

// ---------- 1. a story from Home: no frame of the list in between ----------
await fresh();
check('Android is marked (html.hb-android) and the tab bar has no live blur', await J(`document.documentElement.classList.contains('hb-android') && getComputedStyle(document.querySelector('.tab-bar:not([data-early])')).backdropFilter === 'none'`));
await c.ev(WATCH);
await c.ev(`document.querySelector('.hm-lead').click()`);
await waitFor(`window.HBCards && HBCards.isOpen() && !HBHome.isOpen()`, 4000); await c.sleep(200);
let t = await J(`({ gap: window.__gap, deck: HBCards.isOpen(), home: HBHome.isOpen(), lit: (document.querySelector('.tab-bar:not([data-early]) .tab[aria-current=page]') || {}).dataset?.tab })`);
await c.ev(`window.__watch = false; 1`);
check('a story card on Home opens the deck with no frame of the list in between, Brief lit', t.gap === 0 && t.deck && !t.home && t.lit === 'today', JSON.stringify(t));

// ---------- 2. Brief tab from Home: same ----------
await c.ev(`document.querySelector('.tab-bar:not([data-early]) .tab[data-tab=home]').click()`); await waitFor(`HBHome.isOpen()`); await c.sleep(300);
await c.ev(`window.__watch = true; ` + WATCH);
await c.ev(`document.querySelector('.tab-bar:not([data-early]) .tab[data-tab=today]').click()`); await waitFor(`HBCards.isOpen() && !HBHome.isOpen()`); await c.sleep(200);
t = await J(`({ gap: window.__gap, deck: HBCards.isOpen(), idx: document.querySelector('.dk-count').textContent })`);
await c.ev(`window.__watch = false; 1`);
check('the Brief tab from Home: the deck (where you left it), no frame of the list in between', t.gap === 0 && t.deck, JSON.stringify(t));

// ---------- 3. an Explore tile: that section alone ----------
await c.ev(`document.querySelector('.tab-bar:not([data-early]) .tab[data-tab=home]').click()`); await waitFor(`HBHome.isOpen()`); await c.sleep(300);
const tileSel = await J(`document.querySelector('.hm-tile.hm-t-biz') ? '.hm-tile.hm-t-biz' : '.hm-tile'`);
const tileName = await J(`document.querySelector('${tileSel} b').textContent`);
await c.ev(`document.querySelector('${tileSel}').click()`);
await waitFor(`HBCards.isOpen() && !HBHome.isOpen()`); await c.sleep(300);
t = await J(`(() => { const cards = [...document.querySelectorAll('.dk-track > .dk-card')]; return { n: cards.length, first: cards[0].getAttribute('aria-label'), last: cards[cards.length - 1].className, names: [...new Set(cards.slice(1, -1).map((c) => c.getAttribute('aria-label').split(':')[0]))],
  back: !document.querySelector('.dk-home-back').hidden, logo: document.querySelector('.dk-head .ab-logo').hidden, tiles: [...document.querySelectorAll('.dk-more-tile strong')].map((e) => e.textContent) }; })()`);
check('an Explore tile opens only that section: its intro, its stories, then the "more" card', t.first === tileName && /dk-more/.test(t.last) && t.n >= 3, JSON.stringify(t));
check('the closing card offers the other sections and the whole brief, not this one', t.tiles.indexOf(tileName) < 0 && t.tiles.indexOf('The whole brief') >= 0 && t.tiles.length >= 2, JSON.stringify(t.tiles));
check('in one section the header shows a back arrow to Home, before the logo', t.back && !t.logo, JSON.stringify(t));
await c.shot(`${OUT}/01-section.png`);
await c.ev(`HBCards.goTo(HBCards.count() - 1, false)`); await c.sleep(400);
await c.shot(`${OUT}/02-section-end.png`);
const other = t.tiles[0];
await c.ev(`[...document.querySelectorAll('.dk-more-tile')].find((b) => b.querySelector('strong').textContent === ${JSON.stringify(other)}).click()`); await c.sleep(500);
t = await J(`({ first: document.querySelector('.dk-track > .dk-card').getAttribute('aria-label'), count: document.querySelector('.dk-count').textContent })`);
check('a tile on the closing card switches to that section, from its start', t.first === other && t.count.indexOf('1 /') > 0, JSON.stringify(t));
await c.ev(`HBCards.goTo(HBCards.count() - 1, false)`); await c.sleep(300);
await c.ev(`document.querySelector('.dk-more .dk-cta').click()`); await waitFor(`HBHome.isOpen()`); await c.sleep(300);
check('"Back to Home" on the closing card goes Home', await J(`HBHome.isOpen() && !HBCards.isOpen()`));
await c.ev(`document.querySelector('.tab-bar:not([data-early]) .tab[data-tab=today]').click()`); await waitFor(`HBCards.isOpen()`); await c.sleep(300);
t = await J(`({ first: document.querySelector('.dk-track > .dk-card').getAttribute('aria-label'), back: !document.querySelector('.dk-home-back').hidden })`);
check('the Brief tab afterwards is the whole brief again (cover first, no back arrow)', !t.back && !/Product|Stock|AI/.test(t.first), JSON.stringify(t));

// ---------- 4. the card you were on survives a reload ----------
await c.ev(`HBCards.goTo(4, false)`); await c.sleep(400);
const was = await J(`document.querySelector('.dk-count').textContent`);
await c.goto(B + '/?brief=1', 3500);
t = await J(`({ deck: !!(window.HBCards && HBCards.isOpen()), at: (document.querySelector('.dk-count') || {}).textContent })`);
check('after a reload (Android can, once the phone is locked) the deck comes back on the same card', t.deck && t.at === was, JSON.stringify(t) + ' was ' + was);

// ---------- 5. pull to refresh: only at the real top ----------
const ptr = async (sel) => {
  const p = await center(sel);
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: 200 }] });
  for (let y = 210; y <= 420; y += 30) { await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y }] }); await c.sleep(16); }
  const armed = await J(`!!document.querySelector('#cap-ptr.armed')`);
  await c.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await c.ev(`(() => { const e = document.getElementById('cap-ptr'); if (e) { e.classList.remove('armed'); } })()`);
  return armed;
};
await c.preload(`window.Capacitor.Plugins = {}; 1`);
await fresh();
const hasPtr = await J(`!!document.getElementById('cap-ptr')`);
if (hasPtr) {
  await c.ev(`document.querySelector('.hm-scroll').scrollTop = 600`); await c.sleep(200);
  check('pulling down on Home scrolled down does not arm pull-to-refresh (it used to reload the app)', !(await ptr('.hm-scroll')));
  await c.ev(`document.querySelector('.hm-scroll').scrollTop = 0`); await c.sleep(200);
  check('at the very top of Home, pulling down still arms it', await ptr('.hm-scroll'));
} else check('pull-to-refresh is present in app mode (capacitor-bridge.js)', false, 'no #cap-ptr: the bridge did not load in this harness');

// ---------- 6. the quiz: Next pinned, back pill on first touch, the score ----------
await c.viewport(360, 640, true, false);
await fresh();
await c.ev(`HBQuizPlay()`); await c.sleep(700);
await c.ev(`document.querySelectorAll('.qz-play .quiz-opt')[1].click()`); await c.sleep(900);
t = await J(`(() => { const n = document.querySelector('.qz-ans-next').getBoundingClientRect(), s = document.querySelector('.qz-play-stage'); return { bottom: Math.round(n.bottom), vh: innerHeight, scrolls: s.scrollHeight > s.clientHeight }; })()`);
check('on a small phone the answer card scrolls but Next stays on screen', t.bottom <= t.vh && t.bottom > t.vh - 120, JSON.stringify(t));
await c.ev(`document.querySelector('.qz-play-stage').scrollTop = 9999`); await c.sleep(200);
t = await J(`Math.round(document.querySelector('.qz-ans-next').getBoundingClientRect().bottom)`);
check('and at the end of the card it is still in the same place', t <= 640 && t > 520, String(t));
await c.ev(`document.querySelector('.qz-play .qz-ans-story').click()`); await waitFor(`HBCards.isOpen() && !!document.querySelector('.qz-back')`); await c.sleep(500);
const pb = await center('.qz-back');
await touchTap(pb.x, pb.y); await c.sleep(500);
check('"Back to the quiz" answers the first touch (on the finger lifting)', await J(`document.documentElement.classList.contains('qz-playing') && !document.querySelector('.qz-back')`));
for (let i = 0; i < 5; i++) {
  if (await J(`!!document.querySelector('.qz-play .qz-ans-next')`)) { await c.ev(`document.querySelector('.qz-play .qz-ans-next').click()`); await c.sleep(800); }
  if (await J(`!!document.querySelector('.qz-play .qz-res')`)) break;
  await c.ev(`document.querySelectorAll('.qz-play .quiz-opt')[0].click()`); await c.sleep(800);
}
await waitFor(`!!document.querySelector('.qz-play .qz-res')`, 3000); await c.sleep(1500);
await c.ev(`for (const x of document.querySelectorAll('.qz-cele')) x.remove(); 1`);
await c.viewport(390, 844, true, false); await c.sleep(300);
t = await J(`(() => { const sh = document.querySelector('.qz-play .qz-share').getBoundingClientRect(), list = document.querySelector('.qz-play .qz-rv-list'), head = document.querySelector('.qz-play .qz-missed-head');
  return { share: Math.round(sh.bottom), vh: innerHeight, folded: list.hidden, head: head.textContent, rows: document.querySelectorAll('.qz-play .qz-rv').length, red: getComputedStyle(document.querySelector('.qz-play .qz-missed')).backgroundColor }; })()`);
check('the score: Share is above the fold, the answers are folded under "Review answers"', t.share < t.vh - 60 && t.folded && /^Review answers/.test(t.head) && t.rows === 5, JSON.stringify(t));
await c.ev(`document.querySelector('.qz-play .qz-missed-head').click()`); await c.sleep(200);
check('a tap opens the answers', await J(`!document.querySelector('.qz-play .qz-rv-list').hidden && document.querySelector('.qz-play .qz-missed-head').getAttribute('aria-expanded') === 'true'`));
await c.shot(`${OUT}/03-score.png`);

// ---------- 7. You: the same header as the other screens ----------
await c.ev(`document.querySelector('.qz-play-done').click()`); await c.sleep(300);
await c.ev(`document.querySelector('.tab-bar:not([data-early]) .tab[data-tab=home]').click()`); await waitFor(`HBHome.isOpen()`); await c.sleep(300);
await c.ev(`document.querySelector('.hb-home .ab-you').click()`); await c.sleep(500);
t = await J(`({ you: Math.round(document.querySelector('.you-top').getBoundingClientRect().height), home: Math.round(document.querySelector('.hm-top').getBoundingClientRect().height), hero: !!document.querySelector('.you-hero .you-stats') })`);
check('You: the header is the same height as the other screens, the numbers in one card at the top', Math.abs(t.you - t.home) <= 2 && t.hero, JSON.stringify(t));
await c.shot(`${OUT}/04-you.png`);

// ---------- 8. Home's Listen: a compact pill ----------
await c.ev(`document.querySelector('.hb-you .you-back').click()`); await c.sleep(300);
t = await J(`(() => { const b = document.querySelector('.hm-listen').getBoundingClientRect(); return { w: Math.round(b.width), right: Math.round(innerWidth - b.right), text: document.querySelector('.hm-listen').textContent.trim() }; })()`);
check('Home\'s Listen is a compact pill on the right ("Listen")', t.w < 150 && t.right <= 20 && t.text === 'Listen', JSON.stringify(t));

const errs = c.errors.filter((e) => !/r2\.dev|favicon|ERR_FAILED|CORS|ViewTransition/.test(e));
check('no script errors anywhere in the run', !errs.length, errs.slice(0, 3).join(' | '));
console.log(`\n${pass} passed, ${fail} failed · screenshots in ${OUT}`);
c.close(); server.close(); process.exit(fail ? 1 : 0);
