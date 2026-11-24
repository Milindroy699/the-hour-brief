// Browser test for the quiz rewards and the app shell around them (2026-11-22): the Daily quiz | Leagues | Badges tabs and the
// header that follows them, the result tiers (medal, label, wording) for every score, the streak flame stages, the milestone
// screen and the new-badge card, the trophy case, the Early bird / Century badges, ?join= opening Leagues, ?demo=, the floating
// tab bar shrinking while scrolling, the story pictures in the list, and the feature counts sent for all of it.
//   node rewards.mjs [screenshotDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from './cdp.mjs';
import { start } from './static.mjs';

const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'hb-rewards-shots-'));
fs.mkdirSync(OUT, { recursive: true });
const { server } = await start({ port: 8796, audioDir: fs.mkdtempSync(path.join(os.tmpdir(), 'hb-noaudio-')) });
const B = 'http://127.0.0.1:8796';
let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  -> ' + x)); };
const c = await launch(9386);
const J = async (e) => { const r = await c.ev(`JSON.stringify(${e})`); if (r && typeof r === 'object' && r.__error) throw new Error('page eval failed: ' + r.__error); return JSON.parse(r); };
const waitFor = async (expr, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await c.ev(expr)) return true; await c.sleep(60); } return false; };

const HTML = fs.readFileSync(path.resolve(import.meta.dirname, '../../index.html'), 'utf8');
const DATE = (HTML.match(/"date":\s*"(\d{4}-\d{2}-\d{2})"/) || [])[1];
const QUIZ = JSON.parse((HTML.match(/<script type="application\/json" id="quiz-data">([\s\S]*?)<\/script>/) || [])[1]);
const N = QUIZ.questions.length;
const day = (n) => new Date(Date.parse(DATE + 'T00:00:00Z') - n * 864e5).toISOString().slice(0, 10);
// Every day an edition (so a streak counts), the social file absent (no Sunday recap), and the feature counts captured.
const BASE = `(() => {
  window.__uses = [];
  const f = window.fetch;
  window.fetch = (u, o) => {
    u = String(u);
    if (u.indexOf('/social/') >= 0) return Promise.resolve(new Response('', { status: 404 }));
    if (u.indexOf('editions.json') >= 0) { const a = []; for (let k = 40; k >= 0; k--) a.push({ date: new Date(Date.parse('${DATE}T00:00:00Z') - k * 864e5).toISOString().slice(0, 10), edition: 100 - k }); return Promise.resolve(new Response(JSON.stringify(a), { status: 200 })); }
    if (u.indexOf('/api/') >= 0) { try { const b = JSON.parse(o && o.body || '{}'); if (b.uses) window.__uses.push(...b.uses.map((x) => x[0])); } catch (e) {} return Promise.resolve(new Response('{}', { status: 200 })); }
    return f(u, o);
  };
  navigator.sendBeacon = (u, d) => { d.text().then((t) => { try { window.__uses.push(...JSON.parse(t).uses.map((x) => x[0])); } catch (e) {} }); return true; };
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };
  window.HB_COUNT_TEST = true;
})();`;
let ids = [];
async function open({ store = {}, query = '?quiz=1', width = 390, height = 844, dark = false, wait = 2200, reduced = false } = {}) {
  for (const id of ids) await c.unpreload(id);
  ids = [await c.preload(BASE)];
  await c.viewport(width, height, true, dark);
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
  await c.goto(B + '/about.html', 200);
  await c.ev(`localStorage.clear(); sessionStorage.clear(); sessionStorage.setItem('hb-view-v1', 'list'); localStorage.setItem('hb-swipe-hint-v1', '1'); ${Object.entries(store).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(typeof v === 'string' ? v : JSON.stringify(v))});`).join(' ')} 'ok'`);
  await c.goto(B + '/' + query, wait);
}
// Play today's quiz, getting `right` of the questions right (the first ones)
async function play(right) {
  for (let i = 0; i < N; i++) {
    const want = i < right ? QUIZ.questions[i].answer : (QUIZ.questions[i].answer + 1) % QUIZ.questions[i].options.length;
    await c.ev(`(() => { const o = [...document.querySelectorAll('.quiz-opt')].filter((x) => !x.disabled && x.offsetParent); o[${want}].click(); })()`);
    await c.sleep(120);
    await c.ev(`[...document.querySelectorAll('.quiz-btn.primary')].filter((x) => x.offsetParent && /Next question|See my score/.test(x.textContent)).pop().click()`);
    await c.sleep(160);
  }
  await c.sleep(900);
}
const streakStore = (n, extra = {}) => { const r = {}; for (let k = 1; k <= n; k++) r[day(k)] = { s: N, t: N, a: [] }; return { 'hb-quiz-v1': Object.assign({ r }, extra) }; };
const closeCele = async () => { for (let k = 0; k < 6; k++) { const any = await c.ev(`(() => { const g = document.querySelector('.qz-ms-go'), x = document.querySelector('.qz-bp-x'); if (g) { g.click(); return 1; } if (x) { x.click(); return 1; } return 0; })()`); if (!any) break; await c.sleep(450); } };

// ---- Tabs and the header ----
await open();
let t = await J(`(() => ({ tabs: [...document.querySelectorAll('.qz-seg-btn')].map((b) => [b.textContent, b.getAttribute('aria-selected')]), title: document.querySelector('#quiz .lane-head h2').textContent, tag: getComputedStyle(document.querySelector('#quiz .lane-head .lane-tag')).display, panes: [...document.querySelectorAll('.qz-pane')].map((p) => p.hidden) }))()`);
check('Challenge has three tabs, Daily quiz selected, and no label above the title', JSON.stringify(t.tabs) === JSON.stringify([['Daily quiz', 'true'], ['Leagues', 'false'], ['Badges', 'false']]) && t.tag === 'none' && JSON.stringify(t.panes) === '[false,true,true]', JSON.stringify(t));
const quizTitle = t.title;
for (const [tab, title] of [['leagues', 'Play against your friends, class or team'], ['badges', 'Your trophy case'], ['quiz', quizTitle]]) {
  await c.ev(`document.getElementById('qz-tab-${tab}').click()`); await c.sleep(250);
  t = await J(`({ title: document.querySelector('#quiz .lane-head h2').textContent, shown: [...document.querySelectorAll('.qz-pane')].filter((p) => !p.hidden).map((p) => p.id) })`);
  check(`the ${tab} tab shows its own pane and the title follows it ("${title}")`, t.title === title && t.shown.length === 1 && t.shown[0] === 'qz-pane-' + tab, JSON.stringify(t));
}
await c.ev(`document.getElementById('qz-tab-badges').click()`); await c.sleep(150);
await c.ev(`document.getElementById('qz-tab-badges').focus()`);
await c.ev(`document.getElementById('qz-tab-badges').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`); await c.sleep(200);
t = await J(`document.querySelector('.qz-seg-btn.on').textContent`);
check('arrow keys move between the tabs (Badges → Daily quiz wraps round)', t === 'Daily quiz', t);
await c.ev(`document.getElementById('qz-tab-leagues').click()`); await c.sleep(200);
await c.goto(B + '/?quiz=1', 1800);
t = await J(`document.querySelector('.qz-seg-btn.on').textContent`);
check('the chosen tab is remembered for the session (a reload stays on Leagues)', t === 'Leagues', t);
await open({ query: '?quiz=1&join=ABCDEF' });
t = await J(`document.querySelector('.qz-seg-btn.on').textContent`);
check('a league invite link (?join=) opens on the Leagues tab', t === 'Leagues', t);

// ---- Result tiers ----
const TIERS = [[N, 'perfect', 'Perfect'], [N - 1, 'sharp', 'Sharp'], [Math.ceil(N / 2), 'solid', 'Solid'], [1, 'keepgoing', 'Keep going'], [0, 'keepgoing', 'Keep going']];
for (const [right, tier, label] of TIERS) {
  await open();
  await play(right);
  await closeCele();
  t = await J(`(() => { const m = document.querySelector('.qz-medal'); return { cls: document.querySelector('.qz-hero').className, label: document.querySelector('.qz-tier').textContent, medal: m && m.getAttribute('src'), loaded: !!m && m.complete && m.naturalWidth > 0, score: document.querySelector('.quiz-score').textContent, msg: document.querySelector('.qz-hero .quiz-msg').textContent, missed: document.querySelectorAll('.qz-miss').length, head: (document.querySelector('.qz-missed-head') || {}).textContent || '' }; })()`);
  check(`${right}/${N}: the ${label} medal and label`, t.cls.includes('qz-tier-' + tier) && t.label === label && t.medal === '/brand/rewards/medals/' + tier + '.webp' && t.loaded, JSON.stringify(t));
  check(`${right}/${N}: "${right} of ${N}", kind wording, and the ${N - right} missed question(s) listed with their answers`, t.score === right + 'of ' + N && t.msg.length > 20 && t.missed === N - right && (N - right === 0 ? !t.head : t.head === 'Review missed (' + (N - right) + ')'), JSON.stringify(t));
}
t = await J(`[...document.querySelectorAll('.qz-miss-a')].every((a) => /^Answer: /.test(a.textContent))`);
check('every missed row shows "Answer: …"', t === true, t);

// ---- Streak flame stages ----
for (const [n, stage] of [[1, 'spark'], [3, 'flame'], [7, 'blaze'], [30, 'inferno'], [100, 'legend']]) {
  await open({ store: streakStore(n) });
  t = await J(`(() => { const p = document.querySelector('.qz-st-pill'); const i = p && p.querySelector('img'); return { txt: p.textContent, img: i && i.getAttribute('src') }; })()`);
  check(`a ${n}-day streak shows the ${stage} flame in the streak card`, t.img === '/brand/rewards/flames/' + stage + '.webp' && t.txt.startsWith(n + '-day streak'), JSON.stringify(t));
}

// ---- Milestone screen + badge card ----
await open({ store: streakStore(6, { b: { first: day(6), streak3: day(4), perfect: day(6) } }) });
await play(N);
await waitFor(`!!document.querySelector('.qz-milestone.in')`, 3000);
t = await J(`(() => { const m = document.querySelector('.qz-milestone'); return m && { num: m.querySelector('.qz-ms-num').textContent, flame: m.querySelector('.qz-ms-flame').getAttribute('src'), badge: (m.querySelector('.qz-ms-badge b') || {}).textContent, role: m.getAttribute('role'), modal: m.getAttribute('aria-modal'), focus: document.activeElement && document.activeElement.textContent, dots: m.querySelectorAll('.qz-ms-day.on').length }; })()`);
await c.shot(OUT + '/milestone.png');
check('finishing day 7 opens the milestone screen: 7, the blaze flame, the Week warrior badge on it', t && t.num === '7' && t.flame === '/brand/rewards/flames/blaze.webp' && t.badge === 'Week warrior', JSON.stringify(t));
check('it is a modal dialog with focus on "Share my streak"', t && t.role === 'dialog' && t.modal === 'true' && t.focus === 'Share my streak', JSON.stringify(t));
check('its week dots light only the days actually played this week', t && t.dots >= 1 && t.dots <= 7, JSON.stringify(t));
t = await J(`document.documentElement.classList.contains('qz-cele-open') && getComputedStyle(document.body).overflow`);
check('the page behind cannot scroll while it is open', t === 'hidden', t);
await c.ev(`document.querySelector('.qz-ms-go').click()`); await c.sleep(900);
t = await J(`(() => { const b = document.querySelector('.qz-badgepop'); return { milestone: !!document.querySelector('.qz-milestone'), badge: b && b.querySelector('.qz-bp-name').textContent, img: b && b.querySelector('.qz-bp-img').getAttribute('src') }; })()`);
check('Continue closes it, and a badge not shown on it follows on its own card (Sharp mind: the 5th perfect score; Week warrior was on the milestone)', !t.milestone && t.badge === 'Sharp mind' && t.img === '/brand/rewards/badges/sharp.webp', JSON.stringify(t));

await open({ store: { 'hb-quiz-v1': { r: {} } } });
await play(N);
await waitFor(`!!document.querySelector('.qz-badgepop.in')`, 3000);
t = await J(`(() => { const b = document.querySelector('.qz-badgepop'); return b && { name: b.querySelector('.qz-bp-name').textContent, img: b.querySelector('.qz-bp-img').getAttribute('src'), prog: b.querySelector('.qz-bp-pl b').textContent, on: b.querySelectorAll('.qz-bp-segs i.on').length }; })()`);
await c.shot(OUT + '/badge.png');
check('a first-ever perfect quiz pops the "First quiz" badge card with its medallion and "Badge 1 of 10"', t && t.name === 'First quiz' && t.img === '/brand/rewards/badges/first.webp' && t.prog === 'Badge 1 of 10' && t.on === 1, JSON.stringify(t));
await c.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`); await c.sleep(700);
t = await J(`document.querySelector('.qz-bp-name') && document.querySelector('.qz-bp-name').textContent`);
const prog2 = await J(`(document.querySelector('.qz-bp-pl b') || {}).textContent`);
check('Escape closes it and the next new badge follows (Perfect score), counted "Badge 2 of 10"', t === 'Perfect score' && prog2 === 'Badge 2 of 10', JSON.stringify({ t, prog2 }));
await c.ev(`document.querySelector('.qz-bp-card .quiz-btn.primary').click()`); await c.sleep(900);
t = await J(`({ pop: !!document.querySelector('.qz-cele'), tab: document.querySelector('.qz-seg-btn.on').textContent, open: document.documentElement.classList.contains('qz-cele-open') })`);
check('"See all badges" closes the card and opens the Badges tab', !t.pop && t.tab === 'Badges' && !t.open, JSON.stringify(t));

// ---- Trophy case ----
t = await J(`(() => ({ count: document.querySelector('.qz-tc-count').textContent, stats: [...document.querySelectorAll('.qz-tc-stat b')].map((b) => b.textContent), on: document.querySelectorAll('.qz-tc-badges li.on').length, locked: document.querySelectorAll('.qz-tc-badges li.locked').length, imgsOk: [...document.querySelectorAll('.qz-tc-img')].every((i) => i.complete && i.naturalWidth > 0), stages: document.querySelectorAll('.qz-tc-stage').length, cur: (document.querySelector('.qz-tc-stage.cur b') || {}).textContent }))()`);
await c.shot(OUT + '/trophy.png');
check('the trophy case counts the badges earned, with the days, best streak, perfect scores and accuracy', /^2 of 10 badges/.test(t.count) && t.stats[0] === '1' && t.stats[2] === '1' && t.stats[3] === '100%', JSON.stringify(t));
check('every badge has its art (2 earned in colour, 8 greyed with progress), and all images load', t.on === 2 && t.locked === 8 && t.imgsOk, JSON.stringify(t));
check('the five flame stages are shown, the current one (Spark) highlighted', t.stages === 5 && t.cur === 'Spark', JSON.stringify(t));

// ---- New badges: Early bird, Century ----
{
  const r = {}; for (let k = 1; k <= 99; k++) r[day(k)] = { s: 3, t: N, a: [], h: k <= 4 ? 7 : 12 };
  await open({ store: { 'hb-quiz-v1': { r, b: { first: day(99), played10: day(90), streak3: day(97), streak7: day(93), streak30: day(70) } } } });
  await play(2);
  const hour = await c.ev('new Date().getHours()');
  await waitFor(`!!document.querySelector('.qz-cele')`, 2500);
  const names = [];
  for (let k = 0; k < 4; k++) { const n = await J(`(document.querySelector('.qz-bp-name') || document.querySelector('.qz-ms-badge b') || {}).textContent || null`); if (n) names.push(n); await closeCele(); await c.sleep(500); if (!(await c.ev(`!!document.querySelector('.qz-cele')`))) break; }
  check('the 100th quiz earns Century' + (hour < 8 ? ', and a 5th one before 8 AM Early bird' : ''), names.includes('Century') && (hour < 8 ? names.includes('Early bird') : !names.includes('Early bird')), JSON.stringify({ names, hour }));
  t = await J(`(JSON.parse(localStorage.getItem('hb-quiz-v1')).r['${DATE}'] || {}).h`);
  check('the hour a quiz was finished is kept with the result (for Early bird)', t === hour, JSON.stringify({ t, hour }));
}

// ---- Demo links ----
await open({ query: '?demo=streak30', wait: 2600 });
t = await J(`(() => { const m = document.querySelector('.qz-milestone'); return m && { num: m.querySelector('.qz-ms-num').textContent, flame: m.querySelector('.qz-ms-flame').getAttribute('src') }; })()`);
check('?demo=streak30 shows the 30-day milestone with the inferno flame, without playing', t && t.num === '30' && t.flame.endsWith('inferno.webp'), JSON.stringify(t));
t = await J(`localStorage.getItem('hb-quiz-v1')`);
check('and saves nothing', !t || !JSON.parse(t).b, t);

// ---- Reduced motion: no confetti ----
await open({ query: '?demo=badge', wait: 2600, reduced: true });
t = await J(`({ pop: !!document.querySelector('.qz-badgepop'), confetti: document.querySelectorAll('.qz-confetti img').length })`);
check('with reduced motion the badge card still shows, without confetti', t.pop && t.confetti === 0, JSON.stringify(t));

// ---- Floating tab bar ----
await open({ query: '' });
t = await J(`(() => { const r = document.querySelector('.tab-bar').getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(innerWidth - r.right), gap: Math.round(innerHeight - r.bottom), h: Math.round(r.height), radius: getComputedStyle(document.querySelector('.tab-bar')).borderTopLeftRadius }; })()`);
check('the tab bar floats: a rounded pill inset from the sides and the bottom', t.l >= 8 && t.r >= 8 && t.gap >= 6 && parseFloat(t.radius) >= 20, JSON.stringify(t));
const fullH = t.h, tabH = await J(`getComputedStyle(document.documentElement).getPropertyValue('--hb-tab-h')`);
await c.ev(`document.documentElement.style.scrollBehavior = 'auto'; window.__sc = setInterval(() => window.scrollBy(0, 14), 16)`);
await c.sleep(450);
t = await J(`(() => ({ mini: document.documentElement.classList.contains('hb-tabs-mini'), h: Math.round(document.querySelector('.tab-bar').getBoundingClientRect().height), lb: getComputedStyle(document.querySelector('.tab-lb')).opacity, tabH: getComputedStyle(document.documentElement).getPropertyValue('--hb-tab-h') }))()`);
check('scrolling down shrinks it to icons only', t.mini && t.h < fullH && t.lb === '0', JSON.stringify(t));
check('while --hb-tab-h holds still, so nothing anchored to it jumps', t.tabH === tabH, JSON.stringify({ t, tabH }));
await c.ev(`clearInterval(window.__sc)`); await c.sleep(1000);
t = await J(`({ mini: document.documentElement.classList.contains('hb-tabs-mini'), h: Math.round(document.querySelector('.tab-bar').getBoundingClientRect().height), tabH: getComputedStyle(document.documentElement).getPropertyValue('--hb-tab-h') })`);
check('it comes back to full size once scrolling stops', !t.mini && t.h === fullH && t.tabH === tabH, JSON.stringify(t));
await c.ev(`window.scrollBy(0, 300)`); await c.sleep(120); await c.ev(`window.scrollBy(0, -200)`); await c.sleep(380);
t = await J(`document.documentElement.classList.contains('hb-tabs-mini')`);
check('scrolling back up brings it back straight away', t === false, t);

// ---- Story pictures in the list ----
t = await J(`(() => { const lanes = ['ai', 'biz', 'mkt'].map((l) => { const its = [...document.querySelectorAll('section.lane.' + l + ' .item[data-story-id]')]; return { n: its.length, lead: its[0] && its[0].querySelector('.story-art-lead') && its[0].querySelector('.story-art-lead').getAttribute('src'), thumbs: its.slice(1).filter((i) => i.querySelector('.story-art-thumb')).length }; }); return { lanes, alt: [...document.querySelectorAll('.story-art')].every((i) => i.getAttribute('alt') === '') }; })()`);
check('each section\'s first story has a wide picture from its own set, the others a small one; all decorative (empty alt)', t.lanes.every((l, k) => !l.n || (l.lead && l.lead.startsWith('/brand/stories/' + ['tech', 'biz', 'mkt'][k] + '-') && l.thumbs === l.n - 1)) && t.alt, JSON.stringify(t));
await c.ev(`window.scrollTo(0, 99999)`); await c.sleep(1500);
t = await J(`[...document.querySelectorAll('.story-art')].filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.getAttribute('src'))`);
check('every story picture loads', t.length === 0, JSON.stringify(t));

// ---- Feature counts ----
await open();
await c.ev(`document.getElementById('qz-tab-badges').click()`); await c.sleep(200);
await c.ev(`document.getElementById('qz-tab-leagues').click()`); await c.sleep(200);
await c.ev(`document.querySelector('.quiz-opt').click()`); await c.sleep(3600);
t = await J(`window.__uses`);
check('the counts sent include opening, Challenge, the Badges tab and starting the quiz', ['open', 'today', 'challenge_open', 'badges_view', 'quiz_start'].every((u) => t.includes(u)), JSON.stringify(t));

// ---- Dark mode renders ----
await open({ dark: true, store: streakStore(6) });
await play(3);
await closeCele();
await c.shot(OUT + '/dark-result.png');
t = await J(`(() => { const m = document.querySelector('.qz-miss-q'); return m ? getComputedStyle(m).color : null; })()`);
check('dark mode: the missed-question text is light on its dark rose card (readable)', t && parseInt(t.match(/\d+/)[0], 10) > 150, t);

const errs = c.errors.filter((e) => !/r2\.dev|__audio|net::ERR|Failed to load resource|CORS|ViewTransition/.test(e));
check('no script errors anywhere in the run', errs.length === 0, errs.join(' | '));
console.log(`\n${pass} passed, ${fail} failed · screenshots in ${OUT}`);
c.close(); server.close();
process.exit(fail ? 1 : 0);
