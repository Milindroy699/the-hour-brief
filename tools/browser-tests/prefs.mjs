// Browser test for "Your sections" (mobile.js): show/hide + reorder the sections, the "Make it yours" card on the second day in the apps,
// deep links, desktop, the quiz link, and how Listen follows the choices (recording jumps + device voice).
// The recording is a dry-run (tones) generated for the real latest edition. No Sarvam credit is used.
//   node prefs.mjs [screenshotDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch } from './cdp.mjs';
import { start } from './static.mjs';

const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'hb-prefs-shots-'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-rec-'));
execFileSync('node', ['generate.mjs', '--dry', '--date', 'latest', '--out', tmp], { cwd: path.resolve(import.meta.dirname, '../audio'), stdio: 'ignore' });
const date = fs.readdirSync(path.join(tmp, 'audio'))[0];
const manifest = JSON.parse(fs.readFileSync(path.join(tmp, 'audio', date, 'manifest.json'), 'utf8'));
const cues = manifest.modes.quick.cues;
const cue = (id) => cues.find((c) => c.id === id);
const { server, ctl } = await start({ port: 8789, audioDir: tmp });
const B = 'http://127.0.0.1:8789';

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  -> ' + x)); };
const c = await launch(9380);
const J = async (e) => JSON.parse(await c.ev(`JSON.stringify(${e})`));
const waitFor = async (expr, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await c.ev(expr)) return true; await c.sleep(60); } return false; };

const NATIVE = `window.Capacitor = { isNativePlatform: () => true, Plugins: {} };`;
const AUDIO_BASE = `window.HB_AUDIO_BASE = ${JSON.stringify(B + '/__audio')};`;      // never the real bucket (its CORS only allows the site)
const AUDIO_HOOK = `(() => { const A = window.Audio; window.Audio = function (...a) { const el = new A(...a); window.__audio = el; return el; }; window.Audio.prototype = A.prototype; })();`;
const FAKE_TTS = `(() => { const log = window.__spoken = []; let cur = null, t = null, sp = false; window.__ttsMs = 30;
  const synth = { get speaking() { return sp; }, pending: false,
    speak(u) { cur = u; sp = true; log.push(u.text); setTimeout(() => { if (cur === u && u.onstart) u.onstart({}); }, 5); t = setTimeout(() => { if (cur === u) { sp = false; cur = null; u.onend && u.onend({}); } }, window.__ttsMs); },
    cancel() { if (cur) { const u = cur; cur = null; clearTimeout(t); sp = false; setTimeout(() => u.onerror && u.onerror({ error: 'interrupted' }), 0); } }, pause() {}, resume() {}, getVoices() { return []; } };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (x) { this.text = x; this.rate = 1; }; })();`;

let ids = [];
// Fresh storage each time (optionally seeded), then the edition page.
async function open({ prefs = null, tip = null, blockTip = false, native = false, width = 412, dark = false, hash = '', query = '', audio = false, tts = false, manifestOk = true, wait = 1300 } = {}) {
  for (const id of ids) await c.unpreload(id);
  ids = [];
  const pre = [AUDIO_BASE];
  if (native) pre.push(NATIVE);
  if (blockTip) pre.push(`(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'hb-tip-v1') throw new Error('blocked'); return set.call(this, k, v); }; })();`);
  if (audio) pre.push(AUDIO_HOOK);
  pre.push(tts ? FAKE_TTS : `delete window.speechSynthesis; delete window.SpeechSynthesisUtterance;`);
  for (const p of pre) ids.push(await c.preload(p));
  await fetch(`${B}/__ctl?manifest=${manifestOk ? 'ok' : '404'}&audio=ok`);
  await c.viewport(width, 915, width < 700, dark);
  await c.goto(B + '/about.html', 200);
  await c.ev(`localStorage.clear(); ${prefs ? `localStorage.setItem('hb-prefs-v1', ${JSON.stringify(JSON.stringify(prefs))});` : ''} ${tip ? `localStorage.setItem('hb-tip-v1', ${JSON.stringify(JSON.stringify(tip))});` : ''} 'ok'`);
  await c.goto(B + '/' + query + hash, wait);
}
const order = () => J(`[...document.querySelectorAll('section.lane')].map(s => s.id)`);
const shown = () => J(`[...document.querySelectorAll('section.lane')].filter(s => getComputedStyle(s).display !== 'none').map(s => s.id)`);
const pills = () => J(`[...document.querySelectorAll('.nav a:not(.nav-all)')].map(a => ({ t: a.textContent.trim(), hidden: getComputedStyle(a).display === 'none' }))`);
const stored = () => J(`JSON.parse(localStorage.getItem('hb-prefs-v1') || 'null')`);
const tipStored = () => J(`JSON.parse(localStorage.getItem('hb-tip-v1') || 'null')`);
const hasTip = () => c.ev(`!!document.querySelector('.hb-tip')`);
const noSheet = () => c.ev(`!document.querySelector('.rd-sheet')`);
const d0 = new Date(), TODAY = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0');
const LONG_AGO = '2020-01-01';
const sheet = `document.querySelector('.rd-sheet')`;
const row = (id) => `document.querySelector('.rd-prefs li[data-id="${id}"]')`;
const openSheet = async () => {                       // the menu (top right) -> Sections
  await c.ev(`document.querySelector('.ab-menu').click()`); await waitFor(`!!document.querySelector('.rd-menu')`);
  await c.ev(`document.querySelector('.rd-item[data-act=sections]').click()`); await waitFor(`!!document.querySelector('.rd-prefs')`);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- 1. the website on a phone: default, then the sheet ----------
await open();
check('default: canonical order, every section visible', eq(await order(), ['ai', 'biz', 'mkt', 'quiz']) && eq(await shown(), ['ai', 'biz', 'mkt', 'quiz']), JSON.stringify(await order()));
check('the menu button sits in the app bar (top right), and the website never pops the sheet up by itself', (await c.ev(`!!document.querySelector('.ab-actions .ab-menu') && !document.querySelector('.rd-sheet')`)) === true);
await openSheet();
let t = await J(`({ dialog: ${sheet}.getAttribute('role'), title: ${sheet}.querySelector('h2').textContent, names: [...document.querySelectorAll('.rd-prefs .rd-sw-name')].map(n => n.textContent), on: [...document.querySelectorAll('.rd-prefs input')].map(i => i.checked), upFirst: ${row('ai')}.querySelector('.rd-up').disabled, downLast: ${row('quiz')}.querySelector('.rd-down').disabled, done: ${sheet}.querySelector('.rd-close').textContent })`);
check('the sheet lists the four sections, all on, with sensible arrows', t.dialog === 'dialog' && t.title === 'Your sections' && eq(t.names, ['AI & Tech', 'Product & Business', 'Stock Market', 'Daily quiz']) && t.on.every(Boolean) && t.upFirst && t.downLast && t.done === 'Done', JSON.stringify(t));
await c.shot(`${OUT}/prefs_sheet.png`);

// ---------- 1b. Contact us · About · Privacy live in the footer ----------
await c.ev(`${sheet}.querySelector('.rd-close').click()`);
t = await J(`(() => { const r = document.querySelector('.site-links'), f = document.querySelector('footer.colophon'); const a = [...r.querySelectorAll('a')]; return { inFooter: !!f && f.contains(r) && f.firstElementChild === r, texts: a.map((x) => x.textContent), hrefs: a.map((x) => x.getAttribute('href')), shown: getComputedStyle(r).display !== 'none', above: !!document.querySelector('.nav').previousElementSibling && document.querySelector('.nav').previousElementSibling.classList.contains('site-links') }; })()`);
check('phone: the "Contact us · About · Privacy" row leads the footer (and is no longer above the pills)', t.inFooter && t.shown && !t.above && eq(t.texts, ['Contact us', 'About', 'Privacy']) && eq(t.hrefs, ['/contact.html', '/about.html', '/privacy.html']), JSON.stringify(t));
await openSheet();

// ---------- 2. switch a section off ----------
await c.ev(`${row('mkt')}.querySelector('input').click()`); await c.sleep(200);
t = await J(`({ off: document.querySelector('#mkt').hasAttribute('data-pref-off'), quizBody: document.body.classList.contains('hb-quiz-off') })`);
const st = await stored();
check('switching Stock Market off hides it, its pill and marks it for Listen; the choice is saved', eq(await shown(), ['ai', 'biz', 'quiz']) && t.off && !t.quizBody && eq(st.off, ['mkt']) && (await pills()).find((p) => p.t === 'Stock Market').hidden, JSON.stringify({ shown: await shown(), st }));

// ---------- 3. reorder ----------
await c.ev(`${row('quiz')}.querySelector('.rd-up').click()`); await c.sleep(200);
await c.ev(`${row('quiz')}.querySelector('.rd-up').click()`); await c.sleep(200);
t = await J(`({ focus: document.activeElement.className, inRow: !!(document.activeElement.closest('li') && document.activeElement.closest('li').dataset.id) })`);
check('Move up twice: the quiz is now second, sections and pills follow, and keyboard focus stays on the arrow', eq(await order(), ['ai', 'quiz', 'biz', 'mkt']) && eq((await pills()).slice(0, 4).map((p) => p.t), ['AI & Tech', 'Quiz', 'Product & Business', 'Stock Market']) && /rd-up/.test(t.focus), JSON.stringify({ o: await order(), t }));
check('nothing is destroyed by moving: each section still has its stories', (await c.ev(`document.querySelectorAll('#ai .item').length > 3 && document.querySelectorAll('#mkt .item').length > 2 && !!document.querySelector('#quiz #quiz-root')`)) === true);
check('the order is saved', eq((await stored()).order, ['ai', 'quiz', 'biz', 'mkt']), JSON.stringify(await stored()));
await c.shot(`${OUT}/prefs_sheet_changed.png`);

// ---------- 4. at least one section stays on ----------
await c.ev(`${row('ai')}.querySelector('input').click()`); await c.sleep(150);
await c.ev(`${row('biz')}.querySelector('input').click()`); await c.sleep(150);
t = await J(`({ before: ${row('quiz')}.querySelector('input').checked })`);
await c.ev(`${row('quiz')}.querySelector('input').click()`); await c.sleep(200);
t = await J(`({ still: ${row('quiz')}.querySelector('input').checked, msg: document.querySelector('.rd-prefs-msg').textContent })`);
check('the last section on cannot be switched off (and the sheet says why)', t.still && /at least one/i.test(t.msg) && eq(await shown(), ['quiz']), JSON.stringify({ t, shown: await shown() }));

// ---------- 5. quiz off hides the quiz chip ----------
await c.ev(`${row('ai')}.querySelector('input').click()`); await c.sleep(150);
await c.ev(`${row('quiz')}.querySelector('input').click()`); await c.sleep(200);
await c.ev(`${sheet}.querySelector('.rd-close').click()`); await c.sleep(200);
t = await J(`({ chip: document.querySelector('.quiz-chip') ? getComputedStyle(document.querySelector('.quiz-chip')).display : 'none', body: document.body.classList.contains('hb-quiz-off'), sheet: !!${sheet}, focus: document.activeElement.className })`);
check('quiz off: its chip under the pills is gone too; Done closes the sheet and returns focus to the menu button', t.chip === 'none' && t.body && !t.sheet && /ab-menu/.test(t.focus), JSON.stringify(t));

// ---------- 6. it survives a reload, with no sheet ----------
const before = { o: await order(), s: await shown(), p: await pills() };
await c.ev(`(location.reload(), 'ok')`); await c.sleep(1400);
check('after a reload the same order and visibility are back (and no sheet)', eq(await order(), before.o) && eq(await shown(), before.s) && eq(await pills(), before.p) && (await c.ev(`!document.querySelector('.rd-sheet')`)) === true, JSON.stringify({ was: before.s, now: await shown() }));

// ---------- 7. reset ----------
await openSheet();
await c.ev(`${sheet}.querySelector('.rd-reset').click()`); await c.sleep(250);
check('Reset to default: original order, everything on', eq(await order(), ['ai', 'biz', 'mkt', 'quiz']) && eq(await shown(), ['ai', 'biz', 'mkt', 'quiz']) && (await c.ev(`[...document.querySelectorAll('.rd-prefs input')].every(i => i.checked)`)) && (await c.ev(`!document.body.classList.contains('hb-quiz-off')`)), JSON.stringify(await order()));
await c.ev(`${sheet}.querySelector('.rd-close').click()`);

// ---------- 8. the apps: nothing at the door; "Make it yours" is offered once, on the second day ----------
await open({ native: true, wait: 600 }); await c.sleep(1800);
check('native, first launch: no sheet and no card (nothing to decide before the first read)', (await noSheet()) && !(await hasTip()));
check('and nothing is saved as a choice: the default order stays untouched, one visit is counted', (await stored()) === null && eq(await tipStored(), { n: 1, last: TODAY, done: false }) && eq(await order(), ['ai', 'biz', 'mkt', 'quiz']), JSON.stringify({ p: await stored(), t: await tipStored() }));
await c.ev(`(location.reload(), 'ok')`); await c.sleep(1800);
check('opening it again the same day: still no card, and the same day is not counted twice', !(await hasTip()) && (await tipStored()).n === 1, JSON.stringify(await tipStored()));

await open({ native: true, tip: { n: 1, last: LONG_AGO, done: false }, wait: 600 }); await c.sleep(1800);
t = await J(`(() => { const k = document.querySelector('.hb-tip'); if (!k) return null; const r = k.getBoundingClientRect(), first = document.querySelector('section.lane'), bs = [...k.querySelectorAll('button')].map((b) => { const x = b.getBoundingClientRect(); return { t: b.textContent, h: Math.round(x.height), l: Math.round(x.left), r: Math.round(x.right) }; }); return { title: k.querySelector('strong').textContent, body: k.querySelector('.hb-tip-text span').textContent, l: Math.round(r.left), r: Math.round(r.right), w: innerWidth, before: k.nextElementSibling === first, bs, bg: getComputedStyle(k).backgroundColor, role: k.tagName, sheet: !!document.querySelector('.rd-sheet') }; })()`);
check('native, second day: a small card appears (not a sheet), just above the first section', t && t.title === 'Make it yours' && t.before && !t.sheet && t.role === 'ASIDE', JSON.stringify(t));
check('it says what it does in one line and offers Choose / Not now, both easy to tap and inside the screen', t && /which sections/.test(t.body) && eq(t.bs.map((b) => b.t), ['Choose', 'Not now']) && t.bs.every((b) => b.h >= 40 && b.l >= 0 && b.r <= t.w) && t.l >= 0 && t.r <= t.w, JSON.stringify(t));
check('the card does not repeat itself if the same day is opened again', await (async () => { await c.ev(`(location.reload(), 'ok')`); await c.sleep(1800); return (await c.ev(`document.querySelectorAll('.hb-tip').length`)) === 1 && (await tipStored()).n === 2; })(), JSON.stringify(await tipStored()));
await c.shot(`${OUT}/prefs_tip.png`);
await c.ev(`document.querySelector('.hb-tip-go').click()`); await c.sleep(400);
check('Choose opens Your sections (titled "Your sections", closes with Done) and the card goes away', (await c.ev(`${sheet}.querySelector('h2').textContent`)) === 'Your sections' && (await c.ev(`${sheet}.querySelector('.rd-close').textContent`)) === 'Done' && !(await hasTip()));
await c.ev(`${sheet}.querySelector('.rd-close').click()`); await c.sleep(200);
await c.ev(`(() => { const o = JSON.parse(localStorage.getItem('hb-tip-v1')); o.last = '${LONG_AGO}'; localStorage.setItem('hb-tip-v1', JSON.stringify(o)); return 'ok'; })()`);
await c.ev(`(location.reload(), 'ok')`); await c.sleep(1800);
check('after choosing, it never comes back on a later day', !(await hasTip()) && (await noSheet()) && (await tipStored()).done === true, JSON.stringify(await tipStored()));

await open({ native: true, tip: { n: 4, last: LONG_AGO, done: false }, wait: 600 }); await c.sleep(1800);
await c.ev(`document.querySelector('.hb-tip-no').click()`); await c.sleep(200);
check('Not now removes the card, opens nothing, and leaves the sections as they were', !(await hasTip()) && (await noSheet()) && (await stored()) === null && eq(await order(), ['ai', 'biz', 'mkt', 'quiz']), JSON.stringify(await stored()));
await c.ev(`(() => { const o = JSON.parse(localStorage.getItem('hb-tip-v1')); o.last = '${LONG_AGO}'; localStorage.setItem('hb-tip-v1', JSON.stringify(o)); return 'ok'; })()`);
await c.ev(`(location.reload(), 'ok')`); await c.sleep(1800);
check('and a "Not now" is final: not asked again on a later day either', !(await hasTip()) && (await tipStored()).done === true, JSON.stringify(await tipStored()));
await c.ev(`document.querySelector('.ab-menu').click()`); await waitFor(`!!document.querySelector('.rd-menu')`);
check('the menu still has Sections (Show, hide and reorder) for anyone who wants it any time', (await c.ev(`document.querySelector('.rd-item[data-act=sections]').textContent`)) === 'SectionsShow, hide and reorder');
await c.ev(`document.querySelector('.rd-sheet .rd-close').click()`);

await open({ native: true, tip: { n: 1, last: LONG_AGO, done: false }, wait: 600, hash: '#ai-2' }); await c.sleep(1800);
check('opened from a shared story link on the second day: not interrupted (the visit still counts)', !(await hasTip()) && (await tipStored()).n === 2, JSON.stringify(await tipStored()));
await open({ native: true, tip: { n: 1, last: LONG_AGO, done: false }, wait: 600, query: '?utm_source=share' }); await c.sleep(1800);
check('opened with tracking parameters (a share): not interrupted either', !(await hasTip()), JSON.stringify(await tipStored()));
await open({ native: true, prefs: { order: [], off: [] }, tip: { n: 3, last: LONG_AGO, done: false }, wait: 600 }); await c.sleep(1800);
check('anyone who already has saved sections (the old first-launch sheet stored the default) is never asked', !(await hasTip()) && (await noSheet()));
await open({ native: true, prefs: { order: ['biz', 'ai', 'mkt', 'quiz'], off: [] }, tip: { n: 3, last: LONG_AGO, done: false }, wait: 600 }); await c.sleep(1800);
check('a reader who already customised: no card, and the saved order applies', !(await hasTip()) && eq(await order(), ['biz', 'ai', 'mkt', 'quiz']), JSON.stringify(await order()));
await open({ native: true, tip: { n: 1, last: LONG_AGO, done: false }, blockTip: true, wait: 600 }); await c.sleep(1800);
check('if the answer cannot be remembered (storage blocked) it is not shown, rather than asking every time', !(await hasTip()));
await open({ native: false, tip: { n: 5, last: LONG_AGO, done: false }, wait: 600 }); await c.sleep(1800);
check('the phone website is never interrupted this way, and nothing is counted there', !(await hasTip()) && eq(await tipStored(), { n: 5, last: LONG_AGO, done: false }), JSON.stringify(await tipStored()));
await open({ native: false, tip: { n: 5, last: LONG_AGO, done: false }, width: 1280, wait: 600 }); await c.sleep(1800);
check('the desktop website neither', !(await hasTip()) && (await tipStored()).n === 5);

for (const w of [360, 412]) {
  await open({ native: true, tip: { n: 1, last: LONG_AGO, done: false }, width: w, wait: 600 }); await c.sleep(1600);
  t = await J(`(() => { const k = document.querySelector('.hb-tip'); if (!k) return null; const r = k.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), h: Math.round(r.height), over: [...k.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > k.getBoundingClientRect().right + 0.5).length, sw: document.documentElement.scrollWidth, w: innerWidth }; })()`);
  check(`${w}px wide: the card fits inside the screen and nothing spills out of it`, t && t.l >= 0 && t.r <= t.w && t.over === 0 && t.sw <= t.w, JSON.stringify(t));
}
await open({ native: true, tip: { n: 1, last: LONG_AGO, done: false }, dark: true, wait: 600 }); await c.sleep(1600);
t = await J(`(() => { const k = document.querySelector('.hb-tip'); return k && { bg: getComputedStyle(k).backgroundColor, ink: getComputedStyle(k.querySelector('strong')).color, go: getComputedStyle(k.querySelector('.hb-tip-go')).backgroundColor }; })()`);
check('dark mode: the card is dark, its title readable, the button in the brand colour', t && /^rgb\(30, 27, 51\)$/.test(t.bg) && t.ink !== t.bg && /^rgb\(108, 83, 245\)$/.test(t.go), JSON.stringify(t));
await c.shot(`${OUT}/prefs_tip_dark.png`);

// ---------- 9. a shared story in a switched-off section still opens ----------
await open({ prefs: { order: [], off: ['mkt'] }, hash: '#mkt-2', wait: 1500 });
t = await J(`({ display: getComputedStyle(document.querySelector('#mkt')).display, off: document.querySelector('#mkt').hasAttribute('data-pref-off'), saved: JSON.parse(localStorage.getItem('hb-prefs-v1')).off })`);
check('deep link into a hidden section shows that section for this visit only (the choice is not changed)', t.display !== 'none' && !t.off && eq(t.saved, ['mkt']), JSON.stringify(t));

// ---------- 10. the desktop website follows the choices too (and ?classic=1 opts out) ----------
await open({ prefs: { order: ['quiz', 'mkt', 'biz', 'ai'], off: ['ai'] }, width: 1280 });
check('desktop: the choices apply here too (order and hidden sections), and no first-launch sheet on the website', eq(await order(), ['quiz', 'mkt', 'biz', 'ai']) && eq(await shown(), ['quiz', 'mkt', 'biz']) && (await c.ev(`!document.querySelector('.rd-sheet')`)) === true, JSON.stringify({ o: await order(), s: await shown() }));
check('desktop: the footer row (Contact us · About · Privacy) is shown', (await c.ev(`getComputedStyle(document.querySelector('.site-links')).display !== 'none'`)) === true);
await open({ prefs: { order: ['quiz', 'mkt', 'biz', 'ai'], off: ['ai'] }, width: 1280, query: '?classic=1' });
check('desktop with ?classic=1: the old layout, so the choices are ignored', eq(await order(), ['ai', 'biz', 'mkt', 'quiz']) && eq(await shown(), ['ai', 'biz', 'mkt', 'quiz']), JSON.stringify(await order()));

// ---------- 11. the quiz does not link to a story that is switched off ----------
await open({ prefs: { order: [], off: ['ai'] }, wait: 2000 });
await c.ev(`document.querySelector('.quiz-opt') && (document.querySelector('.quiz-opt').click(), 'ok')`); await c.sleep(400);
check('quiz answer whose story is in a hidden section: no "From ..." link to nowhere', (await c.ev(`!!document.querySelector('.quiz-why')`)) && (await c.ev(`!document.querySelector('.quiz-from')`)) === true);
await open({ wait: 2000 });
await c.ev(`document.querySelector('.quiz-opt') && (document.querySelector('.quiz-opt').click(), 'ok')`); await c.sleep(400);
check('and with every section on the link is there as before', (await c.ev(`!!document.querySelector('.quiz-from')`)) === true);

// ---------- 12. Listen follows the choices: the recording ----------
const btn = `document.querySelector('.listen-cta button[data-mode=quick]')`;
const pl = (s) => `document.querySelector('.hb-player ${s}')`;
const cur = `(() => { const s = document.querySelector('.item.hb-listening'); if (s) return s.dataset.storyId; const l = document.querySelector('.lane-head.hb-listening'); if (l) return 'lane:' + l.closest('section').id; return document.querySelector('.hb-player .hb-pl-title').textContent; })()`;
async function walk() {                               // press Next until it stops; the list of what was reached
  const seen = [await c.ev(cur)];
  for (let i = 0; i < 60; i++) {
    if (await c.ev(`${pl('.hb-pl-next')}.disabled`)) break;
    await c.ev(`${pl('.hb-pl-next')}.click()`); await c.sleep(230);
    seen.push(await c.ev(cur));
  }
  return seen;
}
const allStories = await (async () => { await open(); return J(`[...document.querySelectorAll('.item[data-story-id]')].map(i => i.dataset.storyId)`); })();
const inLane = (p) => allStories.filter((s) => s.startsWith(p + '-'));

await open({ audio: true, tts: true, prefs: { order: [], off: ['biz'] }, wait: 1200 }); await c.sleep(900);
const minsNow = await c.ev(`${btn}.textContent`);
await c.ev(`${btn}.click()`); await waitFor(`window.__audio && __audio.currentTime > 0.5`, 6000);
let seq = await walk();
const want = ['Today’s brief', 'lane:ai', ...inLane('ai'), 'lane:mkt', ...inLane('mkt'), 'That’s the brief'];
check('recording, Product & Business off: Next walks intro → AI → Stock Market → outro, skipping the hidden section', eq(seq, want), JSON.stringify(seq) + '\nwant ' + JSON.stringify(want));
await c.ev(`${pl('.hb-pl-close')}.click()`); await c.sleep(200);
await c.ev(`${btn}.click()`); await waitFor(`window.__audio && __audio.currentTime > 0.3`, 6000);
const lastAi = inLane('ai').slice(-1)[0];
while ((await c.ev(cur)) !== lastAi) { await c.ev(`${pl('.hb-pl-next')}.click()`); await c.sleep(250); }
await c.sleep(500);
await c.ev(`(__audio.currentTime = ${cue('story:' + lastAi).end - 1.2}, 'ok')`);
const jumped = await waitFor(`(${cur}) === 'lane:mkt'`, 8000);
t = await J(`({ time: __audio.currentTime, st: HBListen.state(), src: HBListen.source() })`);
check('played on its own past the last AI story, the recording skips the hidden section and lands on Stock Market', jumped && t.time >= cue('lane:mkt').start - 0.3 && t.time < cue('lane:mkt').start + 3 && t.st === 'playing' && t.src === 'rec', JSON.stringify({ t, wantAt: cue('lane:mkt').start }));
await c.ev(`${pl('.hb-pl-close')}.click()`);

await open({ audio: true, tts: true, wait: 1200 }); await c.sleep(900);
const minsAll = await c.ev(`${btn}.textContent`);
const n = (s) => Number((/(\d+) min/.exec(s) || [])[1]);
check('the length shown reflects what will be played (fewer minutes with a section off)', n(minsNow) < n(minsAll) || (n(minsNow) === n(minsAll) && false), `${minsNow} vs ${minsAll}`);

// reorder: Stock Market first
await open({ audio: true, tts: true, prefs: { order: ['mkt', 'ai', 'biz', 'quiz'], off: [] }, wait: 1200 }); await c.sleep(900);
await c.ev(`${btn}.click()`); await waitFor(`window.__audio && __audio.currentTime > 0.3`, 6000);
seq = await walk();
const wantOrder = ['Today’s brief', 'lane:mkt', ...inLane('mkt'), 'lane:ai', ...inLane('ai'), 'lane:biz', ...inLane('biz'), 'That’s the brief'];
check('recording, Stock Market moved first: Next walks the sections in the reader’s order', eq(seq, wantOrder), JSON.stringify(seq));
await c.ev(`${pl('.hb-pl-close')}.click()`); await c.sleep(200);
await c.ev(`${btn}.click()`); await waitFor(`window.__audio && __audio.currentTime > 0.3`, 6000);
await c.ev(`(__audio.currentTime = ${cue('intro').end - 0.6}, 'ok')`);
const first = await waitFor(`(${cur}) === 'lane:mkt'`, 8000);
t = await J(`({ time: __audio.currentTime })`);
check('the intro flows straight into Stock Market (the recording jumps ahead to it)', first && t.time >= cue('lane:mkt').start - 0.3 && t.time < cue('lane:mkt').start + 3, JSON.stringify({ t, wantAt: cue('lane:mkt').start }));
const lastMkt = inLane('mkt').slice(-1)[0];
while ((await c.ev(cur)) !== lastMkt) { await c.ev(`${pl('.hb-pl-next')}.click()`); await c.sleep(250); }
await c.sleep(400);
await c.ev(`(__audio.currentTime = ${cue('story:' + lastMkt).end - 1.2}, 'ok')`);
check('and from the last Stock Market story it jumps back to the AI section', await waitFor(`(${cur}) === 'lane:ai'`, 8000), await c.ev(cur));
await c.ev(`${pl('.hb-pl-close')}.click()`);

// quiz off: the recorded outro points at the quiz, so the brief ends on the last story
await open({ audio: true, tts: true, prefs: { order: [], off: ['quiz'] }, wait: 1200 }); await c.sleep(900);
await c.ev(`${btn}.click()`); await waitFor(`window.__audio && __audio.currentTime > 0.3`, 6000);
seq = await walk();
check('quiz off: no outro about a quiz you cannot see (the brief ends on the last story)', !seq.includes('That’s the brief') && seq[seq.length - 1] === allStories.slice(-1)[0], JSON.stringify(seq.slice(-3)));
await c.ev(`(__audio.currentTime = ${cue('story:' + allStories.slice(-1)[0]).end - 1.2}, 'ok')`);
const done = await waitFor(`HBListen.state() === 'done'`, 8000);
t = await J(`({ st: HBListen.state(), paused: __audio.paused, time: __audio.currentTime, dur: __audio.duration })`);
check('and it finishes cleanly at the end of that story, not after the unused outro', done && t.paused && t.time < t.dur - 0.5, JSON.stringify(t));
await c.ev(`${pl('.hb-pl-close')}.click()`);

// only the quiz left: nothing to listen to
await open({ audio: true, tts: true, prefs: { order: [], off: ['ai', 'biz', 'mkt'] }, wait: 1200 }); await c.sleep(900);
check('only the quiz on: no Listen card (there is nothing to read)', (await c.ev(`!document.querySelector('.listen-cta') || document.querySelector('.listen-cta').hidden`)) === true);

// changing the choice while listening stops the audio
await open({ audio: true, tts: true, wait: 1200 }); await c.sleep(900);
await c.ev(`${btn}.click()`); await waitFor(`window.__audio && __audio.currentTime > 0.3`, 6000);
await openSheet();
await c.ev(`${row('biz')}.querySelector('input').click()`); await c.sleep(400);
t = await J(`({ st: HBListen.state(), hidden: document.querySelector('.hb-player').hidden, paused: __audio.paused })`);
check('changing sections while it plays stops the audio and closes the player (no stale playlist)', t.st === 'idle' && t.hidden && t.paused, JSON.stringify(t));
await c.ev(`${sheet}.querySelector('.rd-close').click()`); await c.sleep(200);
await c.ev(`${btn}.click()`); await waitFor(`window.__audio && __audio.currentTime > 0.3`, 6000);
seq = await walk();
check('and the next listen uses the new list', !seq.some((s) => s.startsWith('biz-') || s === 'lane:biz') && seq.includes('lane:mkt'), JSON.stringify(seq));
await c.ev(`${pl('.hb-pl-close')}.click()`);

// ---------- 13. Listen follows the choices: the device voice ----------
await open({ tts: true, manifestOk: false, prefs: { order: ['mkt', 'ai', 'biz', 'quiz'], off: ['biz'] }, wait: 1200 }); await c.sleep(600);
await c.ev(`window.__ttsMs = 20; ${btn}.click()`);
await waitFor(`HBListen.state() === 'done'`, 20000);
t = await J(`(() => { const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' '); const said = norm(window.__spoken.join(' ')); const head = (id) => norm(document.querySelector('.item[data-story-id="' + id + '"] h3').textContent).split(' ').slice(0, 6).join(' ');
  return { done: HBListen.state(), ai: said.includes(head('ai-1')), biz: said.includes(head('biz-1')), mkt: said.includes(head('mkt-1')), mktBeforeAi: said.indexOf(head('mkt-1')) >= 0 && said.indexOf(head('mkt-1')) < said.indexOf(head('ai-1')) }; })()`);
check('device voice: hidden section is not read, the others are read in the reader’s order', t.done === 'done' && t.ai && t.mkt && !t.biz && t.mktBeforeAi, JSON.stringify(t));

// ---------- visuals ----------
await open({ prefs: { order: ['mkt', 'ai', 'biz', 'quiz'], off: ['biz'] }, dark: true, width: 360, wait: 1500 });
t = await J(`(() => { const nav = document.querySelector('.nav'), all = nav.querySelector('.nav-all'), first = [...nav.querySelectorAll('a:not(.nav-all)')].find((a) => getComputedStyle(a).display !== 'none'); const chip = document.querySelector('.quiz-chip'), tools = document.querySelector('.reader-tools'); const cr = chip.getBoundingClientRect(), tr = tools.getBoundingClientRect(); const bs = [...tools.querySelectorAll('.reader-btn')].map((b) => Math.round(b.getBoundingClientRect().top)); return { scroll: nav.scrollLeft, first: first.textContent.trim(), left: Math.round(all.getBoundingClientRect().left), chipH: Math.round(cr.height), chipW: Math.round(cr.width), toolsW: Math.round(tr.width), bar: [...document.querySelectorAll('.ab-actions .ab-btn')].map((b) => { const r = b.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right) }; }) }; })()`);
check('a reordered chip row starts at the beginning (All, then the first section), not scrolled sideways by scroll-snap', t.scroll === 0 && t.first === 'Stock Market' && t.left >= 0, JSON.stringify(t));
check('360px: the quiz chip is one full-width tile, and the app bar keeps its three buttons on screen', t.chipH <= 84 && t.chipW >= t.toolsW - 2 && t.bar.every((r) => r.l >= 0 && r.r <= 360), JSON.stringify(t));
await c.shot(`${OUT}/prefs_page_dark.png`);
await openSheet(); await c.sleep(200); await c.shot(`${OUT}/prefs_sheet_dark.png`);
const geo = await J(`(() => { const r = ${sheet}.getBoundingClientRect(); return { l: r.left, r: innerWidth - r.right, over: document.documentElement.scrollWidth > innerWidth, rows: [...document.querySelectorAll('.rd-prefs li')].map(li => { const b = li.getBoundingClientRect(); return [Math.round(b.height), Math.round(li.querySelector('.rd-up').getBoundingClientRect().width)]; }) }; })()`);
check('360px wide (dark): the sheet fits, no sideways scroll, tap targets are at least 44px', geo.l >= 0 && geo.r >= 0 && !geo.over && geo.rows.every((r) => r[0] >= 44 && r[1] >= 44), JSON.stringify(geo));
check('no JavaScript errors', c.errors.length === 0, c.errors.slice(0, 3).join(' | '));
console.log(`\n${pass} passed, ${fail} failed · screenshots in ${OUT}`);
c.close(); server.close(); process.exit(fail ? 1 : 0);
