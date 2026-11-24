// Browser test for Home, You and the themes (2026-11-25, preview/home): the phone layout Home · Brief · Voices · Challenge,
// where a plain open lands (Home) and where links land (Brief), every way out of Home, You in place of the Menu, the
// day/night themes and the two locked ones (Newsprint with Week warrior, Markets with Month master), the website on a
// desktop left as it was, and the feature counts. Runs against a local copy of the site (static.mjs); nothing live.
//   node home.mjs [screenshotDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from './cdp.mjs';
import { start } from './static.mjs';

const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'hb-home-shots-'));
fs.mkdirSync(OUT, { recursive: true });
await start({ port: 8797, audioDir: fs.mkdtempSync(path.join(os.tmpdir(), 'hb-noaudio-')) });
const B = 'http://127.0.0.1:8797';
let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  -> ' + x)); };
const c = await launch(9387, { home: true });
await c.send('Network.enable');
await c.send('Network.setBlockedURLs', { urls: ['*clarity.ms*', '*/_vercel/insights*'] });   // the website's analytics: never from a test
const J = async (e) => { const r = await c.ev(`JSON.stringify(${e})`); if (r && typeof r === 'object' && r.__error) throw new Error('page eval failed: ' + r.__error); return JSON.parse(r); };
const waitFor = async (expr, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await c.ev(expr)) return true; await c.sleep(60); } return false; };

const HTML = fs.readFileSync(path.resolve(import.meta.dirname, '../../index.html'), 'utf8');
const DATE = (HTML.match(/"date":\s*"(\d{4}-\d{2}-\d{2})"/) || [])[1];
const day = (n) => new Date(Date.parse(DATE + 'T00:00:00Z') - n * 864e5).toISOString().slice(0, 10);
const STORIES = (HTML.match(/class="item" data-story-id="/g) || []).length;
// Every day an edition, no Sunday recap, no network calls to /api (counted instead), no recorded audio.
const BASE = `(() => {
  window.__uses = [];
  const f = window.fetch;
  window.fetch = (u, o) => {
    u = String(u);
    if (u.indexOf('/social/') >= 0 || u.indexOf('r2.dev') >= 0) return Promise.resolve(new Response('', { status: 404 }));
    if (u.indexOf('editions.json') >= 0) { const a = []; for (let k = 40; k >= 0; k--) a.push({ date: new Date(Date.parse('${DATE}T00:00:00Z') - k * 864e5).toISOString().slice(0, 10), edition: 100 - k }); return Promise.resolve(new Response(JSON.stringify({ editions: a }), { status: 200 })); }
    if (u.indexOf('/api/interactions') >= 0) return Promise.resolve(new Response(JSON.stringify({ [window.__topVoice || 'x']: { views: 99, likes: 3, comments: 0 } }), { status: 200 }));
    if (u.indexOf('/api/') >= 0) { try { const b = JSON.parse(o && o.body || '{}'); if (b.uses) window.__uses.push(...b.uses.map((x) => x[0])); } catch (e) {} return Promise.resolve(new Response('{}', { status: 200 })); }
    return f(u, o);
  };
  navigator.sendBeacon = (u, d) => { d.text().then((t) => { try { window.__uses.push(...JSON.parse(t).uses.map((x) => x[0])); } catch (e) {} }); return true; };
  window.HB_COUNT_TEST = true;
})();`;
const clock = (iso) => `(() => { const D = Date, fixed = new D('${iso}').getTime(); window.Date = class extends D { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } }; })();`;
const VOICES = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../leaders-data.json'), 'utf8')).briefs;
const oldest = VOICES.slice().sort((a, b) => (a.generatedAt || '').localeCompare(b.generatedAt || ''))[0];

let ids = [];
const NATIVE = `window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };`;
async function open({ path: p = '/', width = 390, height = 844, at = DATE + 'T09:30:00', store = {}, skin = null, top = oldest.id, wait = 2600, native = false } = {}) {
  for (const id of ids) await c.unpreload(id);
  ids = [await c.preload(BASE), await c.preload(clock(at)), await c.preload(`window.__topVoice = ${JSON.stringify(top)};`)];
  if (native) ids.push(await c.preload(NATIVE));
  await c.viewport(width, height, width < 700, false);
  await c.goto(B + '/about.html', 300);
  await c.ev(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('hb-swipe-hint-v1', '1'); localStorage.setItem('hb-deck-nudge-v1', 'done');
    ${skin ? `localStorage.setItem('hb-skin-v1', '${skin}');` : ''}
    ${Object.entries(store).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(typeof v === 'string' ? v : JSON.stringify(v))});`).join(' ')} 'ok'`);
  await c.goto(B + p, wait);
}
const state = () => J(`({ home: !!(window.HBHome && HBHome.isOpen()), deck: !!(window.HBCards && HBCards.isOpen()), quiz: document.documentElement.classList.contains('hb-quiz-page'),
  you: !!document.querySelector('.hb-you:not([hidden])'), lit: (document.querySelector('.tab-bar:not([data-early]) .tab[aria-current=page]') || {}).dataset?.tab || '',
  url: location.pathname + location.search + location.hash, skin: document.documentElement.dataset.skin || '', theme: document.documentElement.dataset.theme || '',
  hidden: document.documentElement.classList.contains('hb-boot') && !document.documentElement.classList.contains('hb-reveal') })`);
const tab = (n) => c.ev(`document.querySelector('.tab-bar:not([data-early]) .tab[data-tab=${n}]').click()`);
const errs = () => c.errors.filter((e) => !/r2\.dev|favicon|ERR_FAILED|CORS/.test(e));

// ---------- 1. a plain open lands on Home ----------
const played2 = { r: { [day(1)]: { s: 4, t: 5 }, [day(2)]: { s: 5, t: 5 } }, b: { first: day(2) }, bs: 2 };
await open({ store: { 'hb-quiz-v1': played2 } });
let t = await state();
check('a plain open of today\'s edition lands on Home, Home lit, no deck, page shown', t.home && !t.deck && t.lit === 'home' && !t.hidden && t.url === '/', JSON.stringify(t));
t = await J(`[...document.querySelectorAll('.tab-bar:not([data-early]) .tab')].map((x) => x.dataset.tab + ':' + x.textContent.trim())`);
check('the tabs are Home · Brief · Voices · Challenge', t.join('|') === 'home:Home|today:Brief|leaders:Voices|quiz:Challenge', t.join('|'));
t = await J(`(() => { const s = document.querySelector('.hm-scroll'); return { greet: s.querySelector('.hm-greet').textContent, kick: s.querySelector('.hm-kick').textContent,
  mix: [...s.querySelectorAll('.hm-mix > *')].map((x) => x.className.split(' ').pop()), tiles: [...s.querySelectorAll('.hm-tile b')].map((x) => x.textContent),
  tops: s.querySelectorAll('.hm-story').length, voices: s.querySelectorAll('.hm-vcard').length, labels: [...s.querySelectorAll('.hm-label')].map((x) => x.textContent),
  listen: !!document.querySelector('.hm-listen') && getComputedStyle(document.querySelector('.hm-listen')).display !== 'none', quizBig: !!s.querySelector('.hm-qzbig'),
  arts: [...s.querySelectorAll('.hm-art')].every((i) => /\\/brand\\/stories\\//.test(i.src)) }; })()`);
check('greeting by the hour, with the real story count', t.greet.indexOf('Good morning.') === 0 && t.greet.indexOf(STORIES + ' stories') > 0, t.greet);
check('the edition line reads "Edition N · day"', /^Edition \d+ · \w{3}, \d+ \w{3} \d{4}$/.test(t.kick), t.kick);
check('Today\'s mix: the lead story, the newest Voices piece, the quiz', t.mix.join(',') === 'hm-lead,hm-voice,hm-qz-sm', t.mix.join(','));
check('Explore: each section, then Voices, This week, Past editions, Listen', t.tiles.slice(-4).join('|') === 'Voices|This week|Past editions|Listen' && t.tiles.length >= 6, t.tiles.join('|'));
check('Top stories, Most read in Voices, the quiz card and the Listen bar are there', t.tops >= 3 && t.voices >= 3 && t.quizBig && t.listen && t.labels.indexOf('Most read in Voices') >= 0, JSON.stringify(t));
check('story pictures are the edition\'s own story art', t.arts);
await c.sleep(600);
t = await J(`[...document.querySelectorAll('.hm-vcard .hm-card-t')].map((x) => x.textContent)`);
check('Most read in Voices is ranked by real views (the most viewed comes first)', t[0] === oldest.title, t[0] + ' vs ' + oldest.title);
t = await J(`(() => { const a = document.querySelector('.hm-ach'); return a ? { t: a.textContent, play: !!a.querySelector('.hm-ach-go') } : null; })()`);
check('a 2-day streak not yet played today: the streak strip asks to keep it, with Play', t && /2-day streak/i.test(t.t) && t.play && /1 more day to On a roll/.test(t.t), JSON.stringify(t));
t = await J(`(() => { const ch = document.querySelector('.hm-chip'); return { n: ch.textContent.trim(), on: ch.classList.contains('on'), you: !!document.querySelector('.hm-top .ab-you') }; })()`);
check('the header has the streak chip and the You avatar (no Menu)', t.n === '2' && t.on && t.you, JSON.stringify(t));
await c.shot(`${OUT}/01-home-dawn.png`);

// ---------- 2. the ways out of Home ----------
await tab('today'); await waitFor(`window.HBCards && HBCards.isOpen()`, 4000); await c.sleep(300);
t = await state();
check('Brief opens the edition in Cards, Brief lit, the address says ?brief=1', !t.home && t.deck && t.lit === 'today' && t.url === '/?brief=1', JSON.stringify(t));
check('the List | Cards switch shows on Brief', await c.ev(`!document.querySelector('.tab-switch').hidden`));
await tab('home'); await c.sleep(400);
t = await state();
check('Home again: the deck closes, the address is plain', t.home && !t.deck && t.lit === 'home' && t.url === '/', JSON.stringify(t));
check('the List | Cards switch is hidden on Home', await c.ev(`document.querySelector('.tab-switch').hidden`));
check('closing the deck from Home keeps Cards as the view', (await c.ev(`sessionStorage.getItem('hb-view-v1')`)) !== 'list');
await tab('quiz'); await c.sleep(400);
t = await state();
check('Challenge opens over the edition, Home closes', t.quiz && !t.home && t.lit === 'quiz' && t.url === '/?quiz=1', JSON.stringify(t));
await tab('home'); await c.sleep(400);
t = await state();
check('and back to Home from Challenge', t.home && !t.quiz && t.lit === 'home', JSON.stringify(t));
const leadId = await c.ev(`document.querySelector('section.lane .item[data-story-id]').dataset.storyId`);
await c.ev(`document.querySelector('.hm-lead').click()`); await waitFor(`window.HBCards && HBCards.isOpen()`, 4000); await c.sleep(500);
t = await J(`({ id: (document.querySelector('.dk-card:not([inert])') || {}).dataset?.id, home: HBHome.isOpen() })`);
check('tapping the lead story opens Cards on that story', t.id === leadId && !t.home, JSON.stringify(t));
await tab('home'); await c.sleep(400);
const lane2 = await J(`(() => { const l = [...document.querySelectorAll('section.lane')].filter((x) => x.querySelector('.item[data-story-id]'))[1]; return { first: l.querySelector('.item[data-story-id]').dataset.storyId }; })()`);
await c.ev(`document.querySelectorAll('.hm-tile')[1].click()`); await waitFor(`window.HBCards && HBCards.isOpen()`, 4000); await c.sleep(500);
t = await c.ev(`(document.querySelector('.dk-card:not([inert])') || {}).dataset?.id`);
check('an Explore section tile opens Cards at that section\'s first story', t === lane2.first, t + ' vs ' + lane2.first);
await tab('home'); await c.sleep(400);
await c.ev(`document.querySelector('.hm-listen').click()`); await waitFor(`window.HBListen && HBListen.hubOpen()`, 4000); await c.sleep(300);
t = await state();
check('the Listen bar opens Audio over Home (Home stays lit beneath)', (await c.ev(`HBListen.hubOpen()`)) && t.home && t.lit === 'home', JSON.stringify(t));
await tab('home'); await c.sleep(400);
check('Home tab closes Audio', !(await c.ev(`HBListen.hubOpen()`)) && (await state()).home);
const n0 = await c.ev(`document.querySelector('.hm-nudge').textContent`);
check('the first nudge is "Swipe today\'s N cards"', n0 === 'Swipe today’s ' + STORIES + ' cards', n0);
check('the quiz nudge says it is waiting', await c.ev(`[...document.querySelectorAll('.hm-nudge')].some((b) => b.textContent === 'Your quiz is waiting' && b.classList.contains('hot'))`));

// ---------- 3. links land on Brief, not Home ----------
await open({ path: '/?brief=1' });
t = await state();
check('?brief=1 (a refresh on Brief) opens the edition, not Home', !t.home && t.deck && t.lit === 'today', JSON.stringify(t));
await open({ path: '/#' + leadId });
t = await J(`({ home: !!(window.HBHome && HBHome.isOpen()), id: (document.querySelector('.dk-card:not([inert])') || {}).dataset?.id })`);
check('a shared story link opens Cards on that story, not Home', !t.home && t.id === leadId, JSON.stringify(t));
await open({ path: '/?quiz=1' });
t = await state();
check('?quiz=1 opens Challenge, not Home', t.quiz && !t.home && t.lit === 'quiz', JSON.stringify(t));
await open({ path: '/leaders.html', wait: 3000 });
t = await J(`({ tabs: [...document.querySelectorAll('.tab-bar:not([data-early]) .tab')].map((x) => x.dataset.tab + '=' + x.getAttribute('href')), lit: (document.querySelector('.tab-bar:not([data-early]) .tab[aria-current=page]') || {}).dataset?.tab, you: !!document.querySelector('.ab-you') })`);
check('Voices has the same tabs (Home → /, Brief → /?brief=1) and the avatar', t.tabs.join('|') === 'home=/|today=/?brief=1|leaders=/leaders.html|quiz=/?quiz=1' && t.lit === 'leaders' && t.you, JSON.stringify(t));

// ---------- 4. You ----------
await open({ store: { 'hb-quiz-v1': played2 } });
await c.ev(`document.querySelector('.hm-top .ab-you').click()`); await c.sleep(300);
t = await J(`(() => { const y = document.querySelector('.hb-you'); return { open: !y.hidden, stats: [...y.querySelectorAll('.you-stat')].map((s) => s.textContent), themes: [...y.querySelectorAll('.you-theme')].map((b) => b.textContent + (b.classList.contains('locked') ? ' [locked]' : '') + (b.classList.contains('on') ? ' [on]' : '')),
  groups: [...y.querySelectorAll('.you-h')].map((h) => h.textContent), acts: [...y.querySelectorAll('.rd-item')].map((b) => b.dataset.act), focus: document.activeElement && document.activeElement.className }; })()`);
check('the avatar opens You, focus on its back button', t.open && /you-back/.test(t.focus), JSON.stringify(t));
check('You shows the streak, the best streak and the badges', t.stats[0] === '2day streak' && t.stats[1] === '2best streak' && t.stats[2] === '1/10badges', t.stats.join(' | '));
check('themes: Day and night chosen, Newsprint and Markets locked with their badge', /^Day and night.*\[on\]$/.test(t.themes[0]) && /Newsprint.*Week warrior: 2 of 7.*\[locked\]/.test(t.themes[1]) && /Markets.*Month master: 2 of 30.*\[locked\]/.test(t.themes[2]), t.themes.join(' | '));
check('You holds what the Menu held: reading, library, podcasts, share, channels', ['textsize', 'sections', 'saved', 'week', 'archive', 'share', 'whatsapp', 'telegram'].every((a) => t.acts.indexOf(a) >= 0), t.acts.join(','));
await c.shot(`${OUT}/02-you.png`);
await c.ev(`document.querySelectorAll('.you-theme')[1].click()`); await c.sleep(300);
t = await J(`({ skin: document.documentElement.dataset.skin, toast: (document.getElementById('mob-toast') || {}).textContent || '' })`);
check('a locked theme says how to earn it and changes nothing', t.skin === 'dawn' && /7 days in a row/.test(t.toast), JSON.stringify(t));
await c.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`); await c.sleep(200);
check('Escape closes You', !(await state()).you);
await c.ev(`document.querySelector('.hm-top .ab-you').click()`); await c.sleep(200);
await c.ev(`document.querySelector('.you-stat').click()`); await c.sleep(600);
t = await J(`({ quiz: document.documentElement.classList.contains('hb-quiz-page'), you: !!document.querySelector('.hb-you:not([hidden])'), badges: !!document.querySelector('.qz-tab-badges[aria-selected=true], [data-tab=badges][aria-selected=true]') || sessionStorage.getItem('hb-qz-tab') === 'badges' })`);
check('the streak tile opens Challenge on Badges', t.quiz && !t.you && t.badges, JSON.stringify(t));
await tab('today'); await waitFor(`window.HBCards && HBCards.isOpen()`, 4000); await c.sleep(400);
await c.ev(`document.querySelector('.hb-deck .ab-menu').click()`); await c.sleep(300);
t = await J(`({ you: !!document.querySelector('.hb-you:not([hidden])'), menu: !!document.querySelector('.rd-sheet'), cls: document.querySelector('.hb-deck .ab-menu').className })`);
check('the Cards header has the avatar too, and it opens You, not the Menu', t.you && !t.menu && /ab-you/.test(t.cls), JSON.stringify(t));

// ---------- 5. themes ----------
await open({ at: DATE + 'T22:30:00' });
t = await state();
check('after 8 PM: Midnight (dark colours), Good evening', t.skin === 'midnight' && t.theme === 'dark' && (await c.ev(`document.querySelector('.hm-greet').textContent.indexOf('Good evening.') === 0`)), JSON.stringify(t));
await c.shot(`${OUT}/03-home-midnight.png`);
await open({ at: DATE + 'T05:30:00' });
check('before 6 AM: still Midnight', (await state()).skin === 'midnight');
await open({ at: DATE + 'T06:05:00' });
check('from 6 AM: Dawn (light colours)', (await state()).skin === 'dawn' && (await state()).theme === 'light');
await open({ skin: 'newsprint' });
check('Newsprint saved but not earned: Day and night instead', (await state()).skin === 'dawn');
const week = { r: {}, b: { first: day(8), streak3: day(5), streak7: day(1) }, bs: 7 };
for (let k = 1; k <= 7; k++) week.r[day(k)] = { s: 4, t: 5 };
await open({ store: { 'hb-quiz-v1': week } });
await c.ev(`document.querySelector('.hm-top .ab-you').click()`); await c.sleep(300);
t = await J(`[...document.querySelectorAll('.you-theme')].map((b) => b.classList.contains('locked'))`);
check('Week warrior earned: Newsprint unlocked, Markets still locked', t.join() === 'false,false,true', t.join());
await c.ev(`document.querySelectorAll('.you-theme')[1].click()`); await c.sleep(300);
t = await J(`({ skin: document.documentElement.dataset.skin, theme: document.documentElement.dataset.theme, on: document.querySelectorAll('.you-theme')[1].classList.contains('on'), bg: getComputedStyle(document.querySelector('.hb-you')).backgroundColor })`);
check('picking Newsprint applies it at once (cream page)', t.skin === 'newsprint' && t.theme === 'light' && t.on && t.bg === 'rgb(243, 237, 225)', JSON.stringify(t));
await c.ev(`document.querySelector('.you-back').click()`); await c.sleep(200);
await c.shot(`${OUT}/04-home-newsprint.png`);
await c.ev(`location.reload()`); await c.sleep(2600);
check('Newsprint stays after a reload, set before the first paint', (await c.ev(`document.documentElement.dataset.skin`)) === 'newsprint');
const month = { r: {}, b: { first: day(31), streak7: day(25), streak30: day(1) }, bs: 30 };
for (let k = 1; k <= 30; k++) month.r[day(k)] = { s: 4, t: 5 };
await open({ store: { 'hb-quiz-v1': month }, skin: 'markets', at: DATE + 'T11:00:00' });
t = await state();
check('Month master earned: Markets applies (dark colours, green accent)', t.skin === 'markets' && t.theme === 'dark' && (await c.ev(`getComputedStyle(document.documentElement).getPropertyValue('--hb-primary').trim()`)) === '#1f9d6b', JSON.stringify(t));
await c.shot(`${OUT}/05-home-markets.png`);

// ---------- 6. quiz done today ----------
const done = { r: { [DATE]: { s: 4, t: 5 }, [day(1)]: { s: 5, t: 5 } }, b: { first: day(1) }, bs: 2 };
await open({ store: { 'hb-quiz-v1': done } });
t = await J(`({ qz: document.querySelector('.hm-qzbig').textContent, nudge: [...document.querySelectorAll('.hm-nudge')].map((b) => b.textContent), ach: (document.querySelector('.hm-ach') || {}).textContent || '' })`);
check('quiz played today: the quiz card shows the score and leads to the league', /You scored 4 of 5/.test(t.qz) && /See the league/.test(t.qz), t.qz);
check('and the nudge becomes "See your league"', t.nudge.indexOf('See your league') >= 0 && t.nudge.indexOf('Your quiz is waiting') < 0, t.nudge.join('|'));
check('a streak in progress shows how far to the next badge', /2-day streak/i.test(t.ach) && /One more day to On a roll/.test(t.ach), t.ach);
await open({});
check('no streak, nothing played: no streak strip', !(await c.ev(`!!document.querySelector('.hm-ach')`)));

// ---------- 7. the desktop website is unchanged ----------
await open({ width: 1280, height: 900, wait: 2000 });
t = await J(`({ home: !!window.HBHome, skin: document.documentElement.dataset.skin || '', tabs: [...document.querySelectorAll('.tab-bar:not([data-early]) .tab')].map((x) => x.dataset.tab).join('|'), menu: !!document.querySelector('.ab-menu:not(.ab-you)') })`);
check('desktop: no Home, no themes, the old tabs and the Menu', !t.home && !t.skin && t.tabs === 'today|audio|leaders|quiz' && t.menu, JSON.stringify(t));

// ---------- 7b. the audio player is a sheet over Home, not a screen ----------
await open({ store: { 'hb-quiz-v1': played2 } });
await waitFor(`window.HBListen && HBListen.openHub`, 4000);
await c.ev(`document.querySelector('.hm-listen').click()`); await c.sleep(700);
t = await J(`(() => { const h = document.querySelector('.hb-hub-sheet'); const r = h && h.getBoundingClientRect(); return { sheet: !!h && !h.hidden, top: r && Math.round(r.top), scrim: !!document.querySelector('.hub-scrim:not([hidden])'), min: !!document.querySelector('.hub-min'), state: HBListen.state(), lit: (document.querySelector('.tab-bar:not([data-early]) .tab[aria-current=page]') || {}).dataset?.tab, home: HBHome.isOpen() }; })()`);
check('Listen on Home starts today\'s episode and expands the player from the bottom', t.sheet && t.top > 20 && t.top < 140 && t.scrim && t.min && t.state !== 'idle', JSON.stringify(t));
check('the player is not a screen: Home stays open and lit beneath', t.home && t.lit === 'home', JSON.stringify(t));
await c.shot(`${OUT}/06-player-sheet.png`);
await c.ev(`document.querySelector('.hub-min').click()`); await c.sleep(300);
check('Minimise closes it back to the bar', !(await c.ev(`HBListen.hubOpen()`)) && (await c.ev(`!!document.querySelector('.hub-scrim[hidden]')`)));
await c.ev(`HBListen.openHub()`); await c.sleep(300);
await c.ev(`document.querySelector('.hub-scrim').dispatchEvent(new Event('touchmove'))`); await c.sleep(300);
check('scrolling outside the player minimises it', !(await c.ev(`HBListen.hubOpen()`)));
await c.ev(`HBListen.stop()`); await c.sleep(200);
await c.ev(`[...document.querySelectorAll('.hm-tile')].find((b) => /Listen/.test(b.textContent)).click()`); await c.sleep(500);
t = await J(`({ open: HBListen.hubOpen(), state: HBListen.state(), eph: document.querySelector('.hub-eph h3').textContent })`);
check('Explore › Listen opens the player at its past episodes without starting playback', t.open && t.state === 'idle' && t.eph === 'Past episodes', JSON.stringify(t));
await c.ev(`HBListen.closeHub()`);
await c.ev(`document.querySelector('.hm-top .ab-you').click()`); await c.sleep(300);
check('You › Library lists Audio episodes', await c.ev(`!!document.querySelector('.hb-you [data-act=episodes]')`));
await c.ev(`document.querySelector('.hb-you [data-act=episodes]').click()`); await c.sleep(400);
check('and it opens the player (You closes)', (await c.ev(`HBListen.hubOpen()`)) && !(await state()).you);
await c.ev(`HBListen.closeHub()`);

// ---------- 7c. the full-screen quiz ----------
const QZ = JSON.parse((HTML.match(/<script type="application\/json" id="quiz-data">([\s\S]*?)<\/script>/) || [])[1]).questions;
await open({ store: { 'hb-quiz-v1': played2 } });
const y0 = await c.ev(`scrollY`);
await c.ev(`document.querySelector('.hm-qz').click()`); await c.sleep(500);
t = await J(`(() => { const p = document.querySelector('.qz-play'); return { open: !!p && !p.hidden, q: (p.querySelector('.quiz-q') || {}).textContent, opts: p.querySelectorAll('.quiz-opt').length, tabs: getComputedStyle(document.querySelector('.tab-bar:not([data-early])')).visibility, home: HBHome.isOpen() }; })()`);
check('Play on Home opens the quiz full screen, question 1, the tabs out of the way', t.open && t.q === QZ[0].q && t.opts === QZ[0].options.length && t.tabs === 'hidden' && t.home, JSON.stringify(t));
await c.shot(`${OUT}/07-quiz-question.png`);
const wrong = (QZ[0].answer + 1) % QZ[0].options.length;
await c.ev(`document.querySelectorAll('.qz-play .quiz-opt')[${wrong}].click()`); await c.sleep(1000);
t = await J(`(() => { const a = document.querySelector('.qz-play .qz-ans'); return a ? { v: a.querySelector('.qz-ans-v').textContent, ans: a.querySelector('.qz-ans-a b').textContent, mine: (a.querySelector('.qz-ans-mine') || {}).textContent, why: (a.querySelector('.qz-ans-why p') || {}).textContent, story: !!a.querySelector('.qz-ans-story'), next: a.querySelector('.qz-ans-next').textContent, focus: document.activeElement.className } : null; })()`);
check('a wrong pick: its own answer card (Not quite, the answer, your pick, why, the story)', t && /Not quite/.test(t.v) && t.ans === QZ[0].options[QZ[0].answer] && /You picked/.test(t.mine) && t.why === QZ[0].why && t.story && t.next === 'Next question' && /qz-ans-v/.test(t.focus), JSON.stringify(t));
await c.shot(`${OUT}/08-quiz-answer.png`);
await c.ev(`document.querySelector('.qz-ans-next').click()`); await c.sleep(400);
check('Next shows question 2 on its own screen', (await c.ev(`(document.querySelector('.qz-play .quiz-q') || {}).textContent`)) === QZ[1].q);
await c.ev(`document.querySelector('.qz-play-x').click()`); await c.sleep(300);
await tab('quiz'); await c.sleep(400);
t = await J(`({ player: !!document.querySelector('.qz-play:not([hidden])'), intro: (document.querySelector('#quiz .qz-intro') || {}).textContent || '' })`);
check('closing mid-quiz: Challenge shows Continue (1 of N answered)', !t.player && /answered 1 of/.test(t.intro) && /Continue/.test(t.intro), JSON.stringify(t));
await c.ev(`document.querySelector('#quiz .qz-intro-go').click()`); await c.sleep(400);
check('Continue picks up at question 2', (await c.ev(`(document.querySelector('.qz-play .quiz-q') || {}).textContent`)) === QZ[1].q);
for (let k = 1; k < QZ.length; k++) {
  await c.ev(`document.querySelectorAll('.qz-play .quiz-opt')[${QZ[k].answer}].click()`); await c.sleep(800);
  if (k === 1) check('a right pick: Correct', /Correct/.test(await c.ev(`document.querySelector('.qz-ans-v').textContent`)));
  await c.ev(`document.querySelector('.qz-ans-next').click()`); await c.sleep(450);
}
await c.sleep(1200);
t = await J(`(() => { const p = document.querySelector('.qz-play'); return { result: !!p.querySelector('.quiz-result'), score: (p.querySelector('.quiz-score') || {}).textContent, done: !!p.querySelector('.qz-play-done'), saved: (JSON.parse(localStorage.getItem('hb-quiz-v1')).r['${DATE}'] || {}).s }; })()`);
check('the score comes up in the player, saved, with Done', t.result && t.saved === QZ.length - 1 && t.done, JSON.stringify(t));
await c.shot(`${OUT}/09-quiz-score.png`);
await c.ev(`for (const x of document.querySelectorAll('.qz-cele')) x.remove(); 'ok'`);
await c.ev(`document.querySelector('.qz-play-done').click()`); await c.sleep(500);
t = await J(`({ player: !!document.querySelector('.qz-play:not([hidden])'), y: scrollY, inline: !!document.querySelector('#quiz .quiz-result'), quiz: document.documentElement.classList.contains('hb-quiz-page') })`);
check('Done closes the player; the page never scrolled under it', !t.player && t.y === y0 && t.inline, JSON.stringify(t));
await tab('home'); await c.sleep(400);
check('Home now shows today\'s score on the quiz card', /You scored \d of \d/.test(await c.ev(`document.querySelector('.hm-qzbig').textContent`)));

// ---------- 8. in the app, a dark-mode phone, the Sunday recap, past editions ----------
await open({ store: { 'hb-quiz-v1': played2 }, native: true });
t = await state();
check('in the app (iOS): a plain open lands on Home too', t.home && t.lit === 'home' && (await c.ev(`document.documentElement.classList.contains('hb-native') || !!window.Capacitor`)), JSON.stringify(t));
await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await c.sleep(300);
t = await J(`({ skin: document.documentElement.dataset.skin, bg: getComputedStyle(document.querySelector('.hb-home')).backgroundColor })`);
check('a phone in dark mode still gets Dawn by day (the app\'s own day/night)', t.skin === 'dawn' && t.bg === 'rgb(250, 247, 244)', JSON.stringify(t));
await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
const SUN = (() => { const d = new Date(Date.parse(DATE + 'T00:00:00Z')); return d.getUTCDay() === 0; })();
if (SUN) console.log('(skipped: Sunday recap check, the edition under test is a Sunday)');
await open({ store: { 'hb-quiz-v1': played2 } });
await c.ev(`window.HBWeeklyNow = () => ({ date: '${DATE}', range: '18–24 Nov', title: 'What actually mattered this week', intro: '', items: [{ headline: 'a' }, { headline: 'b' }], url: '/week.html?d=${DATE}' }); HBHome.close(); HBHome.open(); 'ok'`);
await c.sleep(300);
t = await J(`[...document.querySelectorAll('.hm-mix > *')].map((x) => x.className.split(' ').pop())`);
check('on a Sunday the week\'s recap leads Today\'s mix', t[0] === 'hm-weekcard', t.join(','));
await open({ store: { 'hb-quiz-v1': played2 } });
await c.ev(`sessionStorage.setItem('hb-view-v1', 'list'); 'ok'`);
await tab('today'); await c.sleep(500);
t = await state();
check('a reader on List this visit: Brief shows the list, not Cards', !t.home && !t.deck && t.lit === 'today', JSON.stringify(t));
await tab('home'); await c.sleep(300);
await c.ev(`document.querySelectorAll('.hm-tile')[1].click()`); await c.sleep(1800);   // a smooth scroll (html { scroll-behavior: smooth })
t = await J(`(() => { const l = [...document.querySelectorAll('section.lane')].filter((x) => x.querySelector('.item[data-story-id]'))[1]; const r = l.getBoundingClientRect(); return { home: HBHome.isOpen(), deck: !!(window.HBCards && HBCards.isOpen()), top: Math.round(r.top), y: Math.round(scrollY) }; })()`);
check('and an Explore tile scrolls the list to that section', !t.home && !t.deck && t.top >= 0 && t.top < 220, JSON.stringify(t));
const past = fs.readdirSync(path.resolve(import.meta.dirname, '../../archive')).filter((f) => /^\d{4}-\d{2}-\d{2}\.html$/.test(f)).sort().slice(-2)[0];
await open({ path: '/archive/' + past, wait: 3000 });
t = await J(`({ home: !!(window.HBHome && HBHome.isOpen()), lit: (document.querySelector('.tab-bar:not([data-early]) .tab[aria-current=page]') || {}).dataset?.tab || '', tabs: [...document.querySelectorAll('.tab-bar:not([data-early]) .tab')].map((x) => x.dataset.tab + '=' + x.getAttribute('href')).join('|'), hidden: getComputedStyle(document.body).visibility })`);
check('a past edition: no Home, no tab lit, Home and Brief lead to today', !t.home && t.lit === '' && t.tabs.indexOf('home=/|today=/?brief=1') === 0 && t.hidden === 'visible', JSON.stringify(t));
await open({ path: '/archive/', wait: 2500 });
t = await J(`({ tabs: [...document.querySelectorAll('.tab-bar:not([data-early]) .tab')].map((x) => x.dataset.tab).join('|'), you: !!document.querySelector('.ab-you') })`);
check('Past editions: the new tabs and the avatar', t.tabs === 'home|today|leaders|quiz' && t.you, JSON.stringify(t));

// ---------- 9. counts and errors ----------
await open({ store: { 'hb-quiz-v1': played2 } });
await c.ev(`document.querySelector('.hm-lead').click()`); await c.sleep(400);
await tab('home'); await c.sleep(200);
await c.ev(`document.querySelector('.hm-top .ab-you').click()`); await c.sleep(200);
await c.ev(`window.dispatchEvent(new Event('pagehide')); document.dispatchEvent(new Event('visibilitychange'))`); await c.sleep(3600);
t = await J(`window.__uses`);
check('Home, a tap on Home and You are counted', ['home', 'home_tap', 'you'].every((f) => t.indexOf(f) >= 0), t.join(','));
check('no JavaScript errors', errs().length === 0, errs().join(' | '));

console.log(`\n${pass} passed, ${fail} failed · screenshots in ${OUT}`);
c.close();
process.exit(fail ? 1 : 0);
