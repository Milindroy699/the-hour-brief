// Browser test for the premium app skin: app bar, fonts, tab bar, section chips, Listen card, the Audio hub (recording and
// device voice), the quiz (streak card, insight, past quizzes), dark mode, the info pages, and the native-only menu items.
// The recording is a dry-run (tones) for the real latest edition, so no Sarvam credit is used.
//   node premium.mjs [screenshotDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch } from './cdp.mjs';
import { start } from './static.mjs';

const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'hb-premium-shots-'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-rec-'));
execFileSync('node', ['generate.mjs', '--dry', '--date', 'latest', '--out', tmp], { cwd: path.resolve(import.meta.dirname, '../audio'), stdio: 'ignore' });
const date = fs.readdirSync(path.join(tmp, 'audio'))[0];
const manifest = JSON.parse(fs.readFileSync(path.join(tmp, 'audio', date, 'manifest.json'), 'utf8'));
const cues = manifest.modes.quick.cues;
const cue = (id) => cues.find((c) => c.id === id);
const LATEST = /data-edition-date="(\d{4}-\d{2}-\d{2})"/.exec(fs.readFileSync(path.join(path.resolve(import.meta.dirname, '../..'), 'index.html'), 'utf8'))[1];
const daysBefore = (n) => new Date(Date.parse(LATEST + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
const EPISODES = { v: 1, episodes: [0, 1, 2].map((n) => ({ date: daysBefore(n), edition: 40 - n, minutes: 6 + n, duration: 390 + n * 30, bytes: 3000000, voice: 'neha' })) };
fs.writeFileSync(path.join(tmp, 'episodes.json'), JSON.stringify(EPISODES));
const { server } = await start({ port: 8790, audioDir: tmp });
const B = 'http://127.0.0.1:8790';

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  -> ' + x)); };
const c = await launch(9381);
const J = async (e) => JSON.parse(await c.ev(`JSON.stringify(${e})`));
const waitFor = async (expr, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await c.ev(expr)) return true; await c.sleep(60); } return false; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const NATIVE = `window.Capacitor = { isNativePlatform: () => true, Plugins: {} };`;
const AUDIO_BASE = `window.HB_AUDIO_BASE = ${JSON.stringify(B + '/__audio')};`;
const AUDIO_HOOK = `(() => { const A = window.Audio; window.Audio = function (...a) { const el = new A(...a); window.__audio = el; return el; }; window.Audio.prototype = A.prototype; })();`;
const FAKE_TTS = `(() => { const log = window.__spoken = []; let cur = null, t = null, sp = false; window.__ttsMs = 30;
  const synth = { get speaking() { return sp; }, pending: false,
    speak(u) { cur = u; sp = true; log.push(u.text); setTimeout(() => { if (cur === u && u.onstart) u.onstart({}); }, 5); t = setTimeout(() => { if (cur === u) { sp = false; cur = null; u.onend && u.onend({}); } }, window.__ttsMs); },
    cancel() { if (cur) { const u = cur; cur = null; clearTimeout(t); sp = false; setTimeout(() => u.onerror && u.onerror({ error: 'interrupted' }), 0); } }, pause() {}, resume() {}, getVoices() { return []; } };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (x) { this.text = x; this.rate = 1; }; })();`;

let ids = [];
async function open({ path: p = '/', native = false, width = 390, dark = false, tts = false, manifestOk = true, quiz = null, prefs = { order: [], off: [] }, wait = 1600, extra = '' } = {}) {
  for (const id of ids) await c.unpreload(id);
  ids = [];
  const pre = [AUDIO_BASE, AUDIO_HOOK];
  if (native) pre.push(NATIVE);
  pre.push(tts ? FAKE_TTS : `delete window.speechSynthesis; delete window.SpeechSynthesisUtterance;`);
  if (extra) pre.push(extra);
  for (const s of pre) ids.push(await c.preload(s));
  await fetch(`${B}/__ctl?manifest=${manifestOk ? 'ok' : '404'}&audio=ok`);
  await c.viewport(width, 844, width < 700, dark);
  await c.goto(B + '/about.html', 200);
  await c.ev(`localStorage.clear(); localStorage.setItem('hb-prefs-v1', ${JSON.stringify(JSON.stringify(prefs))}); ${quiz ? `localStorage.setItem('hb-quiz-v1', ${JSON.stringify(JSON.stringify(quiz))});` : ''} 'ok'`);
  await c.goto(B + p, wait);
  await c.ev(`document.documentElement.style.scrollBehavior = 'auto'; 'ok'`);
}
const scrollTo = (sel, off = 100) => c.ev(`(window.scrollTo(0, Math.max(0, document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect().top + scrollY - ${off})), 'ok')`);
const btn = `document.querySelector('.listen-cta button[data-mode=quick]')`;
const overflow = () => c.ev(`document.documentElement.scrollWidth > innerWidth`);

// ---------- 1. app bar, fonts, tab bar (phone, light) ----------
await open();
let t = await J(`(() => { const logo = document.querySelector('.ab-logo'); const bs = [...document.querySelectorAll('.ab-actions .ab-btn')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  return { logo: logo && logo.naturalWidth > 0, word: document.querySelector('.wordmark').textContent, screen: document.querySelector('.ab-screen').textContent, bs, bg: getComputedStyle(document.querySelector('.masthead-band')).backgroundColor, edition: !!document.querySelector('.masthead-inner > .edition') && getComputedStyle(document.querySelector('.masthead-inner > .edition')).display }; })()`);
check('app bar: the new logo, wordmark "The Hour Brief", screen name "Feed", and three 44px buttons (text size, saved, menu)', t.logo && /the hour brief/i.test(t.word) && t.screen === 'Feed' && t.bs.length === 3 && t.bs.every((b) => b[0] >= 44 && b[1] >= 44) && t.bg === 'rgb(255, 255, 255)' && t.edition === 'none', JSON.stringify(t));
await c.ev(`document.fonts.ready.then(() => 'ok')`);
t = await J(`({ fam: [...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')))].sort() })`);
check('the three self-hosted fonts load (Inter, Newsreader, Space Grotesk): nothing comes from a third party', eq(t.fam, ['Inter', 'Newsreader', 'Space Grotesk']), JSON.stringify(t));
t = await J(`(() => { const p = document.querySelector('.pause-edition'), h = document.querySelector('#ai .lane-count'), time = document.querySelector('#ai .lane-time'); return { ed: p && p.textContent, count: h && h.textContent, time: time && time.textContent, serif: getComputedStyle(document.querySelector('.pause-text')).fontFamily.slice(0, 10) }; })()`);
check('"Before the news" card carries the edition; section badge says "N min read" with a story count; the quote is in Newsreader', /^Edition \d+ · \w{3}, \d+ \w{3}$/.test(t.ed) && /^\d+ stories$/.test(t.count) && /min read$/.test(t.time) && /Newsreader/.test(t.serif), JSON.stringify(t));
t = await J(`(() => { const bar = document.querySelector('.tab-bar'), r = bar.getBoundingClientRect(); const tabs = [...bar.querySelectorAll('.tab')].map((x) => ({ n: x.dataset.tab, cur: x.getAttribute('aria-current'), h: Math.round(x.getBoundingClientRect().height), tag: x.tagName, href: x.getAttribute('href') })); return { fixed: getComputedStyle(bar).position, bottom: Math.round(innerHeight - r.bottom), tabs }; })()`);
check('bottom tab bar: Today, Audio, Challenge, Archive; fixed to the bottom; Today is current; every tab is at least 44px tall', t.fixed === 'fixed' && t.bottom === 0 && eq(t.tabs.map((x) => x.n), ['today', 'audio', 'quiz', 'archive']) && t.tabs[0].cur === 'page' && t.tabs.every((x) => x.h >= 44) && t.tabs[3].tag === 'A' && t.tabs[3].href === '/archive/', JSON.stringify(t));
check('no sideways scrolling at 390px', (await overflow()) === false);
t = await J(`({ scroll: document.querySelector('.nav').scrollLeft, all: Math.round(document.querySelector('.nav-all').getBoundingClientRect().left), snap: getComputedStyle(document.querySelector('.nav')).scrollSnapType })`);
check('the chip row opens at its start with the normal margin (no scroll-snap jump), "All" first', t.scroll === 0 && t.all === 16 && t.snap === 'none', JSON.stringify(t));
await c.shot(`${OUT}/p_top.png`);

// ---------- 2. tabs and chips follow the page ----------
await c.ev(`document.querySelector('.tab[data-tab=quiz]').click()`); await waitFor(`Math.abs(document.querySelector('#quiz').getBoundingClientRect().top) < 140`, 6000); await c.sleep(300);
t = await J(`({ y: Math.round(document.querySelector('#quiz').getBoundingClientRect().top), cur: document.querySelector('.tab[aria-current]').dataset.tab, label: document.querySelector('.ab-screen').textContent, chip: (document.querySelector('.nav a.is-current') || {}).textContent })`);
check('Challenge tab jumps to the quiz; the tab, the app bar label ("Quiz") and the section chip all follow', t.y < 140 && t.cur === 'quiz' && t.label === 'Quiz' && t.chip === 'Quiz', JSON.stringify(t));
await c.ev(`document.querySelector('.tab[data-tab=today]').click()`); await waitFor(`scrollY < 5`, 6000); await c.sleep(300);
t = await J(`({ y: scrollY, cur: document.querySelector('.tab[aria-current]').dataset.tab, chip: (document.querySelector('.nav a.is-current') || {}).textContent })`);
check('Today tab returns to the top; the "All" chip is the current one', t.y < 5 && t.cur === 'today' && t.chip === 'All', JSON.stringify(t));
await scrollTo('#biz .lane-head', 90); await c.sleep(600);
check('scrolling into Product & Business highlights that chip', (await c.ev(`(document.querySelector('.nav a.is-current') || {}).textContent`)) === 'Product & Business');
check('the page’s own scrollspy class does not restyle chips (only .is-current is filled)', (await c.ev(`[...document.querySelectorAll('.nav a')].filter((a) => getComputedStyle(a).backgroundColor === 'rgb(27, 27, 31)').length`)) === 1);

// ---------- 3. the Listen card ----------
await open({ tts: true });
await scrollTo('.listen-cta', 90);
t = await J(`({ tile: ${btn}.textContent, go: !!document.querySelector('.listen-go'), live: !document.querySelector('.listen-live').hidden, note: document.querySelector('.listen-cta-note').textContent })`);
check('Listen card: a "Quick brief" tile with length and voice, a round play button, a live dot and the AI-voice note', /^Quick brief\d+ min · Neha \(AI\)$/.test(t.tile) && t.go && t.live && t.note === 'Read by Neha, an AI voice.', JSON.stringify(t));
await c.shot(`${OUT}/p_listen.png`);
await c.ev(`document.querySelector('.listen-go').click()`); await waitFor(`window.__audio && __audio.currentTime > 0.5`, 6000);
t = await J(`({ st: HBListen.state(), src: HBListen.source(), label: document.querySelector('.listen-go').getAttribute('aria-label'), player: !document.querySelector('.hb-player').hidden })`);
check('the round play button starts the recording and turns into Pause; the mini player appears above the tab bar', t.st === 'playing' && t.src === 'rec' && t.label === 'Pause' && t.player && (await c.ev(`document.querySelector('.hb-player').getBoundingClientRect().bottom <= document.querySelector('.tab-bar').getBoundingClientRect().top + 1`)) === true, JSON.stringify(t));
await c.ev(`document.querySelector('.hb-pl-now').click()`); await waitFor(`!document.querySelector('.hb-hub').hidden`, 2000);
check('tapping the mini player’s title opens the full Audio hub (which hides the mini player)', (await c.ev(`!document.querySelector('.hb-hub').hidden && getComputedStyle(document.querySelector('.hb-player')).display === 'none' && document.querySelector('.tab[aria-current]').dataset.tab === 'audio'`)) === true);

// ---------- 4. the Audio hub with the recording ----------
t = await J(`(() => { const rows = [...document.querySelectorAll('.hub-ch:not(.hub-eps) .hub-row')]; return { pill: document.querySelector('.hub-pill').textContent, voice: document.querySelector('.hub-voice b').textContent, title: document.querySelector('.hub-title').textContent, ed: document.querySelector('.hub-ed').textContent, rows: rows.map((r) => [r.querySelector('.hub-t').textContent, r.querySelector('b').textContent, r.className.replace('hub-row ', '')]), head: document.querySelector('.hub-top .ab-screen').textContent, close: (() => { const b = document.querySelector('.hub-close'), r = b.getBoundingClientRect(); return { w: Math.round(r.width), fill: getComputedStyle(b.querySelector('svg')).fill }; })(), lock: document.documentElement.classList.contains('hb-hub-open') }; })()`);
check('hub: "AI voice ready", narrator Neha, five chapters with real timestamps (intro, three sections, wrap-up); the ✕ button is visible', t.pill === 'AI voice ready' && /Neha/.test(t.voice) && t.rows.length === 5 && t.rows[0][1] === 'Introduction' && t.rows[1][1] === 'AI & Tech' && t.rows[4][1] === 'Wrap-up' && t.rows.every((r) => /^\d\d:\d\d$/.test(r[0])) && t.close.w >= 44 && t.close.fill !== 'none' && t.lock && t.head === 'Audio', JSON.stringify(t));
const mm = (sec) => `${String(Math.floor(Math.round(sec) / 60)).padStart(2, '0')}:${String(Math.round(sec) % 60).padStart(2, '0')}`;
check('hub: the chapter times are the recording’s own (each section starts where the manifest says, at 1×)', eq(await J(`[...document.querySelectorAll('.hub-ch:not(.hub-eps) .hub-row .hub-t')].map((x) => x.textContent)`), ['intro', 'lane:ai', 'lane:biz', 'lane:mkt', 'outro'].map((id) => mm(cue(id).start))), JSON.stringify(await J(`[...document.querySelectorAll('.hub-ch:not(.hub-eps) .hub-row .hub-t')].map((x) => x.textContent)`)));
t = await J(`({ w: parseFloat(document.querySelector('.hub-bar i').style.width), cur: document.querySelector('.hub-cur').textContent, rem: document.querySelector('.hub-rem').textContent, tot: document.querySelector('.hub-tot').textContent, now: document.querySelector('.hub-ch:not(.hub-eps) .hub-row.now b') && document.querySelector('.hub-ch:not(.hub-eps) .hub-row.now b').textContent, play: document.querySelector('.hub-play').getAttribute('aria-label') })`);
check('hub while playing: progress bar and clock move, the current chapter is marked, the big button says Pause', t.w > 0 && /^\d\d:\d\d$/.test(t.cur) && /^Remaining -\d\d:\d\d$/.test(t.rem) && /^\d\d:\d\d$/.test(t.tot) && t.now === 'Introduction' && t.play === 'Pause', JSON.stringify(t));
await c.ev(`[...document.querySelectorAll('.hub-ch:not(.hub-eps) .hub-row')].find((r) => r.querySelector('b').textContent === 'Stock Market').click()`); await c.sleep(1200);
t = await J(`({ now: document.querySelector('.hub-ch:not(.hub-eps) .hub-row.now b').textContent, time: __audio.currentTime, done: [...document.querySelectorAll('.hub-ch:not(.hub-eps) .hub-row.done b')].map((b) => b.textContent), st: HBListen.state() })`);
check('tapping a chapter jumps the recording there: it becomes current, earlier chapters show as done', t.now === 'Stock Market' && t.time >= cue('lane:mkt').start - 0.3 && t.time < cue('lane:mkt').start + 3 && eq(t.done, ['Introduction', 'AI & Tech', 'Product & Business']) && t.st === 'playing', JSON.stringify(t));
await c.shot(`${OUT}/p_hub.png`);
await c.ev(`document.querySelector('.hub-play').click()`); await c.sleep(300);
check('the big button pauses the recording', (await c.ev(`HBListen.state() === 'paused' && __audio.paused && document.querySelector('.hub-play').getAttribute('aria-label') === 'Play'`)) === true);
await c.ev(`document.querySelector('.hub-rate-plus').click()`); await c.sleep(200);
check('the faster button steps up (1× → 1.25×) and applies to the recording', (await c.ev(`document.querySelector('.hub-rate-val').textContent === '1.25×' && __audio.playbackRate === 1.25`)) === true);
await c.ev(`document.querySelector('.hub-rate-minus').click()`); await c.sleep(200); await c.ev(`document.querySelector('.hub-rate-minus').click()`); await c.sleep(200);
check('the slower button steps down, going below 1× (1.25× → 1× → .85×), and stops there', (await c.ev(`document.querySelector('.hub-rate-val').textContent`)) === '.85×' && (await c.ev(`document.querySelector('.hub-rate-minus').disabled`)) === true && (await c.ev(`__audio.playbackRate`)) === 0.85);
await c.ev(`document.querySelector('.hub-rate-minus').click()`); await c.sleep(150);
check('the disabled slower button does not go past the bottom', (await c.ev(`document.querySelector('.hub-rate-val').textContent`)) === '.85×');
for (let i = 0; i < 4; i++) await c.ev(`document.querySelector('.hub-rate-plus').click()`);
await c.sleep(300);
check('and the faster button reaches the top and disables itself there (1.75×, no wraparound)', (await c.ev(`document.querySelector('.hub-rate-val').textContent`)) === '1.75×' && (await c.ev(`document.querySelector('.hub-rate-plus').disabled`)) === true, await c.ev(`document.querySelector('.hub-rate-val').textContent`));
await c.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`); await c.sleep(200);
t = await J(`({ hidden: document.querySelector('.hb-hub').hidden, lock: document.documentElement.classList.contains('hb-hub-open'), tab: document.querySelector('.tab[aria-current]').dataset.tab, mini: getComputedStyle(document.querySelector('.hb-player')).display })`);
check('Escape closes the hub: scrolling is unlocked, the Today tab is current, the mini player is back', t.hidden && !t.lock && t.tab === 'today' && t.mini !== 'none', JSON.stringify(t));

// hub follows the reader's sections
await open({ tts: true, prefs: { order: ['mkt', 'ai', 'biz', 'quiz'], off: ['biz'] } });
await c.ev(`document.querySelector('.tab[data-tab=audio]').click()`); await waitFor(`!document.querySelector('.hb-hub').hidden`, 2000); await c.sleep(300);
t = await J(`[...document.querySelectorAll('.hub-ch:not(.hub-eps) .hub-row b')].map((b) => b.textContent)`);
check('the hub lists the reader’s sections: Stock Market first, Product & Business left out', eq(t, ['Introduction', 'Stock Market', 'AI & Tech', 'Wrap-up']), JSON.stringify(t));
await c.ev(`document.querySelector('.hub-close').click()`);

// ---------- 5. the hub with the device voice, and with nothing to play ----------
await open({ tts: true, manifestOk: false });
await c.ev(`document.querySelector('.tab[data-tab=audio]').click()`); await waitFor(`!document.querySelector('.hb-hub').hidden`, 2000); await c.sleep(300);
t = await J(`({ pill: document.querySelector('.hub-pill').textContent, voice: document.querySelector('.hub-voice b').textContent, nums: [...document.querySelectorAll('.hub-ch:not(.hub-eps) .hub-t')].map((x) => x.textContent) })`);
check('device voice: the hub says so, and chapters are numbered (no invented timestamps)', t.pill === 'Device voice' && /device/i.test(t.voice) && eq(t.nums, ['1', '2', '3', '4', '5']), JSON.stringify(t));
await c.ev(`window.__ttsMs = 500; document.querySelector('.hub-play').click()`); await c.sleep(1500);
t = await J(`({ st: HBListen.state(), src: HBListen.source(), spoken: window.__spoken.length, now: (document.querySelector('.hub-ch:not(.hub-eps) .hub-row.now b') || {}).textContent, w: parseFloat(document.querySelector('.hub-bar i').style.width) })`);
check('device voice: the big button plays it and the bar moves', t.st === 'playing' && t.src === 'tts' && t.spoken > 0 && t.now && t.w > 0, JSON.stringify(t));
await c.ev(`document.querySelector('.hub-close').click(); HBListen.stop()`);
await open({ tts: false, manifestOk: false });
await c.ev(`document.querySelector('.tab[data-tab=audio]').click()`); await waitFor(`!document.querySelector('.hb-hub').hidden`, 2000); await c.sleep(300);
t = await J(`({ pill: document.querySelector('.hub-pill').textContent, play: document.querySelector('.hub-play').disabled, msg: document.querySelector('.hub-msg').textContent })`);
check('nothing can play: the hub says "Audio unavailable" with a plain message and a disabled button (no crash)', t.pill === 'Audio unavailable' && t.play && /isn.t available/.test(t.msg), JSON.stringify(t));
await c.ev(`document.querySelector('.hub-close').click()`);

// ---------- 5b. All episodes: every recording since the first, newest first ----------
await open({ tts: true });
await c.ev(`document.querySelector('.tab[data-tab=audio]').click()`); await waitFor(`!document.querySelector('.hb-hub').hidden`, 2000);
await waitFor(`document.querySelectorAll('.hub-eps li').length === 3`, 3000);
t = await J(`(() => { const rows = [...document.querySelectorAll('.hub-eps li')].map((li) => { const r = li.firstElementChild; return { tag: r.tagName, href: r.getAttribute('href'), cur: r.getAttribute('aria-current'), no: r.querySelector('.hub-t').textContent, title: r.querySelector('b').textContent, sub: r.querySelector('small').textContent, here: (r.querySelector('.hub-here') || {}).textContent }; }); return { head: document.querySelector('.hub-eph h3').textContent, count: document.querySelector('.hub-eph span').textContent, rows, hidden: document.querySelector('.hub-eps').hidden }; })()`);
const nice = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
check('All episodes lists every recording, newest first, with edition number, date, length and voice; the count says how far back it goes', t.head === 'All episodes' && /^3 episodes · since \d{1,2} \w+$/.test(t.count) && !t.hidden && eq(t.rows.map((r) => r.title), [0, 1, 2].map((n) => nice(daysBefore(n)))) && t.rows[0].no === '040' && t.rows[1].sub === '7 min · Neha (AI voice)', JSON.stringify(t));
check('the page you are on is marked ("This page", not a link); the others link to that edition with the Audio screen open', t.rows[0].tag === 'DIV' && t.rows[0].cur === 'true' && t.rows[0].here === 'This page' && t.rows[1].tag === 'A' && t.rows[1].href === `/archive/${daysBefore(1)}.html?audio=1` && t.rows[2].href === `/archive/${daysBefore(2)}.html?audio=1`, JSON.stringify(t.rows));
await c.shot(`${OUT}/p_episodes.png`);
await c.ev(`document.querySelector('.hub-eps li:nth-child(2) a').click()`);
await waitFor(`location.pathname === '/archive/${daysBefore(1)}.html'`, 4000); await c.sleep(1500);
t = await J(`({ path: location.pathname + location.search, hub: !!document.querySelector('.hb-hub') && !document.querySelector('.hb-hub').hidden, rows: [...document.querySelectorAll('.hub-eps li')].map((li) => li.firstElementChild.getAttribute('aria-current') === 'true'), edition: document.querySelector('.hub-ed') && document.querySelector('.hub-ed').textContent })`);
check('tapping an earlier episode opens that day\'s edition with the Audio screen already open, and now that row is the marked one', t.path === `/archive/${daysBefore(1)}.html?audio=1` && t.hub && eq(t.rows, [false, true, false]), JSON.stringify(t));
// no list published yet (or it cannot be fetched): the section quietly stays away
fs.renameSync(path.join(tmp, 'episodes.json'), path.join(tmp, 'episodes.off'));
await open({ tts: true });
await c.ev(`document.querySelector('.tab[data-tab=audio]').click()`); await waitFor(`!document.querySelector('.hb-hub').hidden`, 2000); await c.sleep(1200);
check('without an episode list the section is simply not shown (no empty heading, no error)', (await c.ev(`document.querySelector('.hub-eph').hidden && document.querySelector('.hub-eps').hidden`)) === true);
fs.renameSync(path.join(tmp, 'episodes.off'), path.join(tmp, 'episodes.json'));
fs.writeFileSync(path.join(tmp, 'episodes.json'), '{"v":1,"episodes":[{"date":"nope","minutes":3},{"date":"2026-09-01","minutes":0},null,{"date":"' + LATEST + '","edition":1,"minutes":5,"voice":""}]}');
await open({ tts: true });
await c.ev(`document.querySelector('.tab[data-tab=audio]').click()`); await waitFor(`!document.querySelector('.hb-hub').hidden`, 2000); await c.sleep(1200);
t = await J(`({ n: document.querySelectorAll('.hub-eps li').length, sub: (document.querySelector('.hub-eps small') || {}).textContent, count: document.querySelector('.hub-eph span').textContent })`);
check('a damaged list is cleaned: bad rows are dropped, a missing voice just says "AI voice"', t.n === 1 && t.sub === '5 min · AI voice' && t.count === '1 episode', JSON.stringify(t));
fs.writeFileSync(path.join(tmp, 'episodes.json'), JSON.stringify(EPISODES));
await open({ width: 360, tts: true });
await c.ev(`document.querySelector('.tab[data-tab=audio]').click()`); await waitFor(`!document.querySelector('.hb-hub').hidden`, 2000); await waitFor(`document.querySelectorAll('.hub-eps li').length === 3`, 3000);
check('360px wide: the episode rows fit (no sideways scrolling, rows are tall enough to tap)', (await c.ev(`document.querySelector('.hub-scroll').scrollWidth <= document.querySelector('.hub-scroll').clientWidth && [...document.querySelectorAll('.hub-eps li')].every((li) => li.getBoundingClientRect().height >= 60)`)) === true);
await c.ev(`document.querySelector('.hub-close').click()`);

// ---------- 6. the quiz ----------
// Dates come from the latest edition (index.html), so this keeps working as the site moves on: the three days before it were played.
const TODAY = /data-edition-date="(\d{4}-\d{2}-\d{2})"/.exec(fs.readFileSync(path.join(path.resolve(import.meta.dirname, '../..'), 'index.html'), 'utf8'))[1];
const dayBefore = (n) => new Date(Date.parse(TODAY + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
const past = { r: { [dayBefore(3)]: { s: 3, t: 5 }, [dayBefore(2)]: { s: 4, t: 5 }, [dayBefore(1)]: { s: 5, t: 5 } } };
const weekdayIdx = (new Date(TODAY + 'T00:00:00Z').getUTCDay() + 6) % 7;                 // Monday = 0
// Expected week strip: a played day is 'done', today is 'today', later days are 'later', earlier unplayed days are 'missed'.
const played = (n) => n <= 3 && n >= 1;
const strip = (doneToday) => Array.from({ length: 7 }, (_, k) => k === weekdayIdx ? (doneToday ? 'done' : 'today') : k > weekdayIdx ? 'later' : played(weekdayIdx - k) ? 'done' : 'missed');
await open({ quiz: past, wait: 2200 });
t = await J(`({ chip: [document.querySelector('.qc-title').textContent, document.querySelector('.qc-sub').textContent, document.querySelector('.qc-go').textContent], disc: document.querySelector('.qc-disc').className })`);
check('quiz chip in the feed: title, streak line and "Play →" (a streak of 3 is on the line)', /^Today’s quiz · 5 questions$/.test(t.chip[0]) && /3-day streak/.test(t.chip[1]) && t.chip[2] === 'Play →', JSON.stringify(t));
await scrollTo('#quiz .lane-head', 90); await c.sleep(300);
t = await J(`({ pill: document.querySelector('.qz-st-pill').textContent, best: (document.querySelector('.qz-st-best') || {}).textContent, days: [...document.querySelectorAll('.qz-day')].map((d) => d.className.replace('qz-day ', '')), letters: [...document.querySelectorAll('.qz-dl')].map((x) => x.textContent).join(''), drill: document.querySelector('.qz-drill').textContent })`);
check('streak card: "3-day streak", best 3, a Monday–Sunday strip from the real results (played days checked, today marked, the rest ahead)', /3-day streak/.test(t.pill) && /Best streak 3/.test(t.best) && eq(t.days, strip(false)) && t.letters === 'MTWTFSS' && /0 of 5 answered/.test(t.drill), JSON.stringify(t));
t = await J(`({ topic: document.querySelector('.quiz-topic').textContent, count: document.querySelector('.quiz-count').textContent, segs: document.querySelectorAll('.quiz-dot').length, now: document.querySelectorAll('.quiz-dot.now').length })`);
check('question header: section badge ("AI & Tech" from the story), "Question 1 of 5", five progress segments', t.topic === 'AI & Tech' && t.count === 'Question 1 of 5' && t.segs === 5 && t.now === 1, JSON.stringify(t));
await c.ev(`(() => { const q = JSON.parse(document.getElementById('quiz-data').textContent).questions[0]; document.querySelectorAll('.quiz-opt')[(q.answer + 1) % q.options.length].click(); })()`); await c.sleep(400);       // a wrong answer, whatever today's quiz is
t = await J(`({ good: document.querySelectorAll('.quiz-opt.is-correct').length, bad: document.querySelectorAll('.quiz-opt.is-wrong').length, label: document.querySelector('.quiz-why-label').textContent, from: !!document.querySelector('.quiz-from'), next: document.querySelector('.quiz-feedback .quiz-btn').textContent, drill: document.querySelector('.qz-drill').textContent, faded: getComputedStyle([...document.querySelectorAll('.quiz-opt')].find((o) => !o.classList.contains('is-correct') && !o.classList.contains('is-wrong'))).opacity })`);
check('after an answer: correct and wrong tiles, an "Insight" callout, the story link, "Next question", and the card shows "1 of 5 answered"', t.good === 1 && t.bad === 1 && t.label === 'Insight' && t.from && /Next question/.test(t.next) && /1 of 5 answered · 4 to go/.test(t.drill) && Number(t.faded) < 1, JSON.stringify(t));
await c.shot(`${OUT}/p_quiz.png`);
for (let i = 0; i < 5; i++) {
  if (i) await c.ev(`document.querySelectorAll('.quiz-opt')[0].click()`);
  await c.sleep(200);
  await c.ev(`document.querySelector('.quiz-feedback .quiz-btn').click()`); await c.sleep(200);
}
await waitFor(`!!document.querySelector('.quiz-result')`, 3000); await c.sleep(600);
t = await J(`({ chip: [document.querySelector('.qc-title').textContent, document.querySelector('.qc-go').textContent, document.querySelector('.qc-disc').className], drill: document.querySelector('.qz-drill').textContent, pill: document.querySelector('.qz-st-pill').textContent, done: document.querySelectorAll('.qz-day.done').length, past: [...document.querySelectorAll('.qz-past')].map((r) => [r.getAttribute('href'), r.querySelector('.qz-past-score').textContent, r.querySelector('.qz-past-no').textContent]) })`);
check('after the quiz: the chip says "Quiz done" with a check and "Review →"; the card shows completion and a 4-day streak; today’s square is checked', /^Quiz done: \d\/5$/.test(t.chip[0]) && t.chip[1] === 'Review →' && /done/.test(t.chip[2]) && /completed/i.test(t.drill) && /4-day streak/.test(t.pill) && t.done === strip(true).filter((x) => x === 'done').length, JSON.stringify(t));
check('past quizzes come from the reader’s own results (newest first), with edition numbers and links to that edition’s quiz', eq(t.past.map((r) => r[1]), ['5/5', '4/5', '3/5']) && t.past[0][0] === `/archive/${dayBefore(1)}.html#quiz` && /^\d{3}$/.test(t.past[0][2]), JSON.stringify(t.past));
await scrollTo('.qz-past-box', 200); await c.sleep(300); await c.shot(`${OUT}/p_quiz_done.png`);
// the shareable score picture is drawn on the device: new brand, logo, correct size
await c.ev(`navigator.canShare = () => true; window.__sh = null; navigator.share = (d) => { window.__sh = d; return Promise.resolve(); }; 'ok'`);
await c.ev(`[...document.querySelectorAll('.quiz-btn')].find((b) => /Share my score/.test(b.textContent)).click()`);
check('sharing a score hands the system a picture (PNG file) plus the text and link', await waitFor(`!!window.__sh && !!window.__sh.files && window.__sh.files[0].type === 'image/png'`, 4000));
const b64 = await c.ev(`(async () => { const f = window.__sh.files[0]; const bmp = await createImageBitmap(f); window.__dim = [bmp.width, bmp.height]; const buf = new Uint8Array(await f.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x); return btoa(s); })()`);
fs.writeFileSync(`${OUT}/p_score_card.png`, Buffer.from(b64, 'base64'));
t = await J(`({ dim: window.__dim, text: window.__sh.text })`);
check('the score picture is 1080x1080 and the message carries the link', eq(t.dim, [1080, 1080]) && /\/q\/\d{4}-\d{2}-\d{2}\/\d/.test(t.text), JSON.stringify(t));

// ---------- 6b. moving between questions scrolls the new (shorter) card into view: the reported bug was having to
// scroll back up manually to reach the next question, because it renders much shorter than the answered one it replaces ----------
await open({ quiz: past, wait: 2200 });
await scrollTo('#quiz .lane-head', 90); await c.sleep(300);
await c.ev(`document.querySelectorAll('.quiz-opt')[0].click()`); await c.sleep(400);
await c.ev(`document.querySelector('.quiz-feedback .quiz-btn').click()`);
await c.sleep(900);   // the smooth scroll to settle
t = await J(`({ count: document.querySelector('.quiz-count').textContent, top: document.querySelector('#quiz-q').getBoundingClientRect().top, active: document.activeElement && document.activeElement.id })`);
check('moving to the next question scrolls it into view on its own (no manual scrolling needed), and keyboard focus follows it', t.count === 'Question 2 of 5' && t.top > -10 && t.top < 160 && t.active === 'quiz-q', JSON.stringify(t));
await c.ev(`document.querySelectorAll('.quiz-opt')[0].click()`); await c.sleep(1200);   // the smooth scroll to settle
t = await J(`(() => { const b = document.querySelector('.quiz-feedback .quiz-btn'), r = b.getBoundingClientRect(), tb = document.querySelector('.tab-bar'), lim = tb && getComputedStyle(tb).display !== 'none' ? tb.getBoundingClientRect().top : innerHeight; return { onscreen: r.top >= 0 && r.bottom <= lim - 8, top: Math.round(r.top), bottom: Math.round(r.bottom), tabTop: Math.round(lim) }; })()`);
check('the "Next question" button is fully visible right after answering: above the bottom tab bar, not hidden behind it', t.onscreen, JSON.stringify(t));
// finish the quiz (advance through the remaining questions) and confirm the result card is scrolled into view too, not just question-to-question
await c.ev(`document.querySelector('.quiz-feedback .quiz-btn').click()`); await c.sleep(200);          // -> Q3
await c.ev(`document.querySelectorAll('.quiz-opt')[0].click()`); await c.sleep(200);
await c.ev(`document.querySelector('.quiz-feedback .quiz-btn').click()`); await c.sleep(200);          // -> Q4
await c.ev(`document.querySelectorAll('.quiz-opt')[0].click()`); await c.sleep(200);
await c.ev(`document.querySelector('.quiz-feedback .quiz-btn').click()`); await c.sleep(200);          // -> Q5
await c.ev(`document.querySelectorAll('.quiz-opt')[0].click()`); await c.sleep(400);
await c.ev(`document.querySelector('.quiz-feedback .quiz-btn').click()`);                              // "See my score"
await c.sleep(900);
t = await J(`({ hasResult: !!document.querySelector('.quiz-result'), top: (document.querySelector('.quiz-result') || {}).getBoundingClientRect ? document.querySelector('.quiz-result').getBoundingClientRect().top : null })`);
check('finishing the quiz scrolls the score card into view too', t.hasResult && t.top > -10 && t.top < 160, JSON.stringify(t));
// but an already-completed quiz shown on page load must NOT auto-scroll: only a live "just answered" transition should
await open({ quiz: { r: Object.assign({}, past.r, { [TODAY]: { s: 4, t: 5, a: [0, 0, 0, 0, 0] } }) }, wait: 2200 });
t = await J(`({ scrollY, hasResult: !!document.querySelector('.quiz-result') })`);
check('an already-answered quiz shown on page load stays where it loaded (only a fresh next/finish scrolls)', t.hasResult && t.scrollY === 0, JSON.stringify(t));


// ---------- 6c. the quiz chip takes you to the quiz, and a scroll that stops short (seen in Android WebViews) is finished ----------
await open({ quiz: past, wait: 2200 });
await c.ev(`document.querySelector('.quiz-chip').click()`); await c.sleep(1600);
t = await J(`({ top: Math.round(document.getElementById('quiz').getBoundingClientRect().top), nav: Math.round(document.querySelector('.nav').getBoundingClientRect().bottom) })`);
check('the quiz chip lands on the quiz section, just under the sticky chips', t.top >= 0 && t.top <= t.nav + 30, JSON.stringify(t));
const STOP_SHORT = `Element.prototype.scrollIntoView = function () { const r = this.getBoundingClientRect(); window.scrollBy({ top: r.top * 0.4, behavior: 'auto' }); }`;
await open({ quiz: past, wait: 2200 });
await c.ev(`${STOP_SHORT}; 'ok'`);
await c.ev(`document.querySelector('.quiz-chip').click()`); await c.sleep(1800);
t = await J(`({ top: Math.round(document.getElementById('quiz').getBoundingClientRect().top), nav: Math.round(document.querySelector('.nav').getBoundingClientRect().bottom) })`);
check('even if the browser stops the scroll partway, the chip still ends on the quiz', t.top >= 0 && t.top <= t.nav + 30, JSON.stringify(t));
await scrollTo('#quiz .lane-head', 90); await c.sleep(300);
await c.ev(`${STOP_SHORT}; document.querySelectorAll('.quiz-opt')[0].click()`); await c.sleep(1800);
t = await J(`(() => { const b = document.querySelector('.quiz-feedback .quiz-btn'), r = b.getBoundingClientRect(), tb = document.querySelector('.tab-bar'); return { bottom: Math.round(r.bottom), tabTop: Math.round(tb.getBoundingClientRect().top), top: Math.round(r.top) }; })()`);
check('even if the browser stops the scroll partway, "Next question" still ends up above the tab bar', t.top >= 0 && t.bottom <= t.tabTop - 8, JSON.stringify(t));
await c.ev(`document.querySelector('.quiz-feedback .quiz-btn').click()`); await c.sleep(1800);
t = await J(`({ count: document.querySelector('.quiz-count').textContent, top: Math.round(document.querySelector('.quiz-card').getBoundingClientRect().top), nav: Math.round(document.querySelector('.nav').getBoundingClientRect().bottom) })`);
check('even if the browser stops the scroll partway, the next question ends up right under the sticky chips', t.count === 'Question 2 of 5' && t.top >= t.nav - 4 && t.top <= t.nav + 30, JSON.stringify(t));
// a reader who scrolls by hand right after Next is left alone (the correction never fights a finger)
await c.ev(`document.querySelectorAll('.quiz-opt')[0].click()`); await c.sleep(300);
await c.ev(`document.querySelector('.quiz-feedback .quiz-btn').click()`); await c.sleep(150);
await c.ev(`window.dispatchEvent(new Event('touchstart')); window.scrollTo(0, scrollY - 900); 'ok'`); await c.sleep(1800);
t = await J(`({ top: Math.round(document.querySelector('.quiz-card').getBoundingClientRect().top) })`);
check('a reader who scrolls by hand right after "Next question" is not pulled back', t.top > 300, JSON.stringify(t));

// ---------- 7. dark mode, and a narrow phone ----------
await open({ dark: true, quiz: past });
t = await J(`({ body: getComputedStyle(document.body).backgroundColor, bar: getComputedStyle(document.querySelector('.masthead-band')).backgroundColor, tab: getComputedStyle(document.querySelector('.tab-bar')).backgroundColor, ink: getComputedStyle(document.body).color })`);
check('dark mode: near-black canvas, dark app bar and tab bar, light text', t.body === 'rgb(18, 19, 22)' && t.bar === 'rgb(26, 27, 32)' && /26, 27, 32|0\.1019/.test(t.tab) && t.ink === 'rgb(236, 236, 241)', JSON.stringify(t));
await c.shot(`${OUT}/p_dark_top.png`);
await c.ev(`document.querySelector('.tab[data-tab=audio]').click()`); await waitFor(`!document.querySelector('.hb-hub').hidden`, 2000); await c.sleep(300); await c.shot(`${OUT}/p_dark_hub.png`);
await c.ev(`document.querySelector('.hub-close').click()`);
for (const w of [360, 412]) {
  await open({ width: w, quiz: past, tts: true });
  const flow = [];
  flow.push(await overflow());
  await c.ev(`document.querySelector('.tab[data-tab=audio]').click()`); await waitFor(`!document.querySelector('.hb-hub').hidden`, 2000); await c.sleep(200);
  flow.push(await c.ev(`document.querySelector('.hb-hub').scrollWidth > innerWidth || document.querySelector('.hub-scroll').scrollWidth > document.querySelector('.hub-scroll').clientWidth`));
  await c.ev(`document.querySelector('.hub-close').click()`);
  await c.ev(`document.querySelector('.listen-go') && document.querySelector('.listen-go').click()`); await c.sleep(1200);
  const fit = await J(`(() => { const p = document.querySelector('.hb-player'), c = document.querySelector('.hb-pl-close'); if (!p || p.hidden) return null; const pr = p.getBoundingClientRect(), cr = c.getBoundingClientRect(); return { closeFullyOnscreen: cr.right <= innerWidth && cr.left >= 0, closeWithinPlayer: cr.right <= pr.right + 1 }; })()`);
  check(w + "px: the mini player's row (transport + speed +/- + close) fits inside the player, nothing pushed off past its edge or the screen", fit && fit.closeFullyOnscreen && fit.closeWithinPlayer, JSON.stringify(fit));
  await c.ev(`HBListen.stop()`);

  await scrollTo('#quiz', 90); await c.sleep(300);
  flow.push(await overflow());
  check(`${w}px wide: no sideways scrolling on the feed, the hub or the quiz`, flow.every((x) => x === false), JSON.stringify(flow));
}

// ---------- 7b. the desktop website wears the same skin ----------
await open({ width: 1280, quiz: past, tts: true });
t = await J(`(() => { const box = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect() : null; }; const vis = (sel) => [...document.querySelectorAll(sel)].some((e) => { const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && r.width > 0 && r.height > 0; });
  const page = box('.page'), tab = box('.tab-bar'), nav = document.querySelector('.nav'), chips = [...nav.querySelectorAll('a')].filter((a) => getComputedStyle(a).display !== 'none').map((a) => a.textContent.trim());
  return { app: vis('.ab-actions'), tab: vis('.tab-bar'), pageW: Math.round(page.width), pageCentred: Math.abs(page.left + page.width / 2 - innerWidth / 2) < 2, tabW: Math.round(tab.width), tabCentred: Math.abs(tab.left + tab.width / 2 - innerWidth / 2) < 2, tabBottom: Math.round(innerHeight - tab.bottom), chips, chipsFit: nav.scrollWidth <= nav.clientWidth + 1, side: getComputedStyle(document.querySelector('.side-col')).position, over: document.documentElement.scrollWidth > innerWidth, listen: vis('.listen-cta'), streak: vis('.qz-streak'), bg: getComputedStyle(document.querySelector('.masthead-band')).backgroundColor, grid: getComputedStyle(document.querySelector('.page')).display }; })()`);
check('desktop: the same app in one centred column (680px), an app bar with its buttons, Listen and the streak card', t.app && t.listen && t.streak && t.pageW === 680 && t.pageCentred && t.grid === 'block' && t.side === 'static' && t.bg === 'rgb(255, 255, 255)' && !t.over, JSON.stringify(t));
check('desktop: the tab bar is a floating pill (centred, lifted off the bottom); the chip row fits without scrolling (Past editions and Contact live in the tabs, menu and footer)', t.tab && t.tabCentred && t.tabW <= 540 && t.tabBottom > 8 && eq(t.chips, ['All', 'AI & Tech', 'Product & Business', 'Stock Market', 'Quiz']) && t.chipsFit, JSON.stringify(t));
t = await J(`(() => { const tk = document.querySelector('.ticker'); return tk ? { cols: getComputedStyle(tk).gridTemplateColumns.split(' ').length, cells: tk.children.length } : null; })()`);
check('desktop: the market ticker is one row of cards (a column per cell, no empty grey slot)', !t || t.cols === t.cells, JSON.stringify(t));
await c.ev(`document.querySelector('.tab[data-tab=audio]').click()`); await waitFor(`!document.querySelector('.hb-hub').hidden`, 2000); await c.sleep(300);
t = await J(`(() => { const card = document.querySelector('.hub-card').getBoundingClientRect(); return { centred: Math.abs(card.left + card.width / 2 - innerWidth / 2) < 2, w: Math.round(card.width), close: document.querySelector('.hub-close').getBoundingClientRect().right < innerWidth - 300 }; })()`);
check('desktop: the Audio screen is a centred column too (the ✕ sits at its edge, not the window edge)', t.centred && t.w <= 680 && t.close, JSON.stringify(t));
await c.shot(`${OUT}/p_desktop_hub.png`);
await c.ev(`document.querySelector('.hub-close').click()`);
await c.ev(`document.querySelector('.ab-menu').click()`); await waitFor(`!!document.querySelector('.rd-menu')`);
t = await J(`(() => { const r = document.querySelector('.rd-sheet').getBoundingClientRect(); return { centred: Math.abs(r.left + r.width / 2 - innerWidth / 2) < 2, mid: r.top > 40 && r.bottom < innerHeight - 40, items: [...document.querySelectorAll('.rd-item')].map((b) => b.dataset.act) }; })()`);
check('desktop: the menu opens as a centred dialog, with "Get it by email" (the signup box is now below the feed)', t.centred && t.mid && eq(t.items, ['sections', 'textsize', 'share', 'email']), JSON.stringify(t));
await c.ev(`document.querySelector('.rd-item[data-act=email]').click()`); await c.sleep(900);
check('"Get it by email" scrolls to the signup box and focuses its email field', (await c.ev(`document.activeElement && document.activeElement.type === 'email'`)) === true);
await c.shot(`${OUT}/p_desktop.png`);
await open({ width: 1280, path: '/?classic=1', quiz: past });
t = await J(`({ bg: getComputedStyle(document.querySelector('.masthead-band')).backgroundColor, tab: !!document.querySelector('.tab-bar') && getComputedStyle(document.querySelector('.tab-bar')).display !== 'none', grid: getComputedStyle(document.querySelector('.page')).display, all: !!document.querySelector('.nav-all') && getComputedStyle(document.querySelector('.nav-all')).display !== 'none' })`);
check('desktop with ?classic=1: the old wide layout comes back (dark masthead band, two-column grid, no tab bar)', t.bg !== 'rgb(255, 255, 255)' && t.grid === 'grid' && !t.tab && !t.all, JSON.stringify(t));
await open({ width: 820, quiz: past });
t = await J(`(() => { const p = document.querySelector('.page').getBoundingClientRect(); return { w: Math.round(p.width), over: document.documentElement.scrollWidth > innerWidth, tab: getComputedStyle(document.querySelector('.tab-bar')).position }; })()`);
check('tablet (820px): the same column, no sideways scrolling, tab pill fixed', t.w === 680 && !t.over && t.tab === 'fixed', JSON.stringify(t));

// ---------- 8. the info pages ----------
await open({ path: '/about.html' });
t = await J(`({ screen: document.querySelector('.ab-screen').textContent, tabs: [...document.querySelectorAll('.tab')].map((x) => x.tagName + ' ' + x.getAttribute('href')), back: getComputedStyle(document.querySelector('.back-link')).display, oneRow: document.querySelector('.masthead-inner').getBoundingClientRect().height < 80 })`);
check('About page: the same app bar ("About"), tabs that are plain links back to the feed, the old "back" link hidden, one tidy row', t.screen === 'About' && eq(t.tabs, ['A /', 'A /?audio=1', 'A /#quiz', 'A /archive/']) && t.back === 'none' && t.oneRow, JSON.stringify(t));
await c.ev(`document.querySelector('.ab-menu').click()`); await waitFor(`!!document.querySelector('.rd-menu')`);
check('its menu has no "Sections" item (there are none here)', (await c.ev(`[...document.querySelectorAll('.rd-item')].map((b) => b.dataset.act).includes('sections')`)) === false);
await open({ path: '/?audio=1', tts: true });
check('/?audio=1 (from another page’s Audio tab) opens the hub on the feed', await waitFor(`!!document.querySelector('.hb-hub') && !document.querySelector('.hb-hub').hidden`, 3000));

// ---------- 9. native-only menu items ----------
await open({ native: true, prefs: { order: ['ai', 'biz', 'mkt', 'quiz'], off: [] }, extra: `navigator.share = (p) => { window.__shared = (window.__shared || 0) + 1; window.__sharedUrl = p.url; return Promise.resolve(); }; document.addEventListener('DOMContentLoaded', () => { const b = document.createElement('button'); b.id = 'cap-remind'; b.style.display = 'none'; b.addEventListener('click', () => { window.__reminded = (window.__reminded || 0) + 1; }); document.body.appendChild(b); });`, wait: 900 });
await c.ev(`(document.querySelector('.rd-sheet') && document.querySelector('.rd-sheet .rd-close').click(), 'ok')`); await c.sleep(300);
await c.ev(`document.querySelector('.ab-menu').click()`); await waitFor(`!!document.querySelector('.rd-menu')`);
t = await J(`[...document.querySelectorAll('.rd-item')].map((b) => b.dataset.act)`);
check('in the apps the menu also offers the daily reminder and sharing (the existing native buttons are reused)', eq(t, ['sections', 'textsize', 'reminder', 'share', 'email']), JSON.stringify(t));
await c.ev(`document.querySelector('.rd-item[data-act=reminder]').click()`); await c.sleep(150);
await c.ev(`document.querySelector('.ab-menu').click()`); await waitFor(`!!document.querySelector('.rd-menu')`);
await c.ev(`document.querySelector('.rd-item[data-act=share]').click()`); await c.sleep(150);
check('choosing them opens the reminder sheet and the native share of this edition', (await c.ev(`window.__reminded === 1 && window.__shared === 1 && /\\/e\\/\\d{4}-\\d{2}-\\d{2}$/.test(window.__sharedUrl)`)) === true, JSON.stringify(await J(`({ r: window.__reminded, s: window.__shared, u: window.__sharedUrl })`)));

check('no JavaScript errors', c.errors.length === 0, c.errors.slice(0, 3).join(' | '));
console.log(`\n${pass} passed, ${fail} failed · screenshots in ${OUT}`);
c.close(); server.close(); process.exit(fail ? 1 : 0);
