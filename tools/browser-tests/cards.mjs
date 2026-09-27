// Browser test for the swipe-card reading view (cards.js + the hooks in mobile.js): Cards as the default view, the List | Cards switch, the deck's
// contents and order, real touch swipes, keyboard, tap forwarding (vote/save/share), Listen follow, deep links, the sections hint,
// the compact audio player, and layout on small phones. Tests open the LIST unless they say otherwise (view: 'default' = nothing stored). Nothing here spends Sarvam credit (no recording is used).
//   node cards.mjs [screenshotDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from './cdp.mjs';
import { start } from './static.mjs';

const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'hb-cards-shots-'));
fs.mkdirSync(OUT, { recursive: true });
const { server } = await start({ port: 8794, audioDir: fs.mkdtempSync(path.join(os.tmpdir(), 'hb-noaudio-')) });
const B = 'http://127.0.0.1:8794';

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  -> ' + x)); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const c = await launch(9381);
const J = async (e) => JSON.parse(await c.ev(`JSON.stringify(${e})`));
const waitFor = async (expr, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await c.ev(expr)) return true; await c.sleep(60); } return false; };

const FAKE_TTS = `(() => { const log = window.__spoken = []; let cur = null, t = null, sp = false; window.__ttsMs = 4000;
  const synth = { get speaking() { return sp; }, pending: false,
    speak(u) { cur = u; sp = true; log.push(u.text); setTimeout(() => { if (cur === u && u.onstart) u.onstart({}); }, 5); t = setTimeout(() => { if (cur === u) { sp = false; cur = null; u.onend && u.onend({}); } }, window.__ttsMs); },
    cancel() { if (cur) { const u = cur; cur = null; clearTimeout(t); sp = false; setTimeout(() => u.onerror && u.onerror({ error: 'interrupted' }), 0); } }, pause() {}, resume() {}, getVoices() { return []; } };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (x) { this.text = x; this.rate = 1; }; })();`;
const NATIVE = `window.Capacitor = { isNativePlatform: () => true, Plugins: {} };`;
const NO_AUDIO = `window.HB_AUDIO_BASE = ${JSON.stringify(B + '/__audio')}; delete window.speechSynthesis; delete window.SpeechSynthesisUtterance;`;
const d0 = new Date(), TODAY = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0');
const LONG_AGO = '2020-01-01';
// The cards in the deck: the cover, then for each section its card and its stories, then the quiz (so it follows the latest edition).
const HTML = fs.readFileSync(path.resolve(import.meta.dirname, '../../index.html'), 'utf8');
const STORIES = (HTML.match(/class="item" data-story-id="/g) || []).length;
const TOTAL = STORIES + 3 + 2;
const QUIET = { n: 0, last: LONG_AGO, done: true };     // no hint
let ids = [];

async function open({ native = true, width = 390, height = 844, dark = false, prefs = null, tip = QUIET, view = 'list', size = null, hash = '', query = '', wait = 1800, tts = false, extra = '' } = {}) {
  for (const id of ids) await c.unpreload(id);
  ids = [];
  const pre = [tts ? `window.HB_AUDIO_BASE = ${JSON.stringify(B + '/__audio')}; ${FAKE_TTS}` : NO_AUDIO];
  if (extra) pre.push(extra);
  if (native) pre.push(NATIVE);
  for (const p of pre) ids.push(await c.preload(p));
  await c.viewport(width, height, width < 700, dark);
  await c.goto(B + '/about.html', 200);
  await c.ev(`localStorage.clear(); ${prefs ? `localStorage.setItem('hb-prefs-v1', ${JSON.stringify(JSON.stringify(prefs))});` : ''} ${tip ? `localStorage.setItem('hb-tip-v1', ${JSON.stringify(JSON.stringify(tip))});` : ''} ${view !== 'default' ? `localStorage.setItem('hb-view-v1', '${view}');` : ''} ${size != null ? `localStorage.setItem('hb-textsize', '${size}');` : ''} 'ok'`);
  await c.goto(B + '/' + query + hash, wait);
}
const cardsBtn = `document.querySelectorAll('.vs-in button')[1]`;
const openDeck = async ({ cover = false } = {}) => {              // the deck opens on the cover card; most tests want the first section card, as before
  await c.ev(`${cardsBtn}.click()`);
  const ok = await waitFor(`!!window.HBCards && HBCards.isOpen()`, 4000);
  if (ok && !cover) { await c.ev(`HBCards.goTo(1, false)`); await c.sleep(150); }
  return ok;
};
const pos = () => c.ev(`document.querySelector('.dk-count').textContent`);
const kinds = () => J(`[...document.querySelectorAll('.dk-card')].map((k) => k.className.replace('dk-card dk-', ''))`);
const storyIds = () => J(`[...document.querySelectorAll('.dk-card.dk-story')].map((k) => k.getAttribute('data-id'))`);
const feedIds = (lanes) => J(`${JSON.stringify(lanes)}.flatMap((l) => [...document.querySelectorAll('#' + l + ' .item[data-story-id]')].map((i) => i.getAttribute('data-story-id')))`);
const secOrder = () => J(`[...document.querySelectorAll('.dk-intro .dk-title')].map((h) => h.textContent)`);
const hasTip = (which) => c.ev(`!!document.querySelector('.hb-tip${which ? `[data-tip="${which}"]` : ''}')`);
const tipState = () => J(`JSON.parse(localStorage.getItem('hb-tip-v1') || 'null')`);
const view = () => c.ev(`localStorage.getItem('hb-view-v1')`);

// ---------- 1. the switch, and where cards exist ----------
await open();
let t = await J(`({ has: typeof window.HBCards, sw: !!document.querySelector('.view-switch'), shown: !!document.querySelector('.view-switch') && !document.querySelector('.view-switch').hidden, btns: [...document.querySelectorAll('.vs-in button')].map((b) => b.textContent + ':' + b.getAttribute('aria-pressed')), before: document.querySelector('.view-switch').nextElementSibling.className, after: document.querySelector('.view-switch').previousElementSibling.className })`);
check('the app shows a List | Cards switch between the section chips and the tools row, List selected', t.shown && eq(t.btns, ['List:true', 'Cards:false']) && /reader-tools/.test(t.before) && /nav/.test(t.after), JSON.stringify(t));
check('cards.js is not loaded until someone asks for Cards (nothing extra on the normal list)', t.has === 'undefined', JSON.stringify(t));
await c.ev(`document.querySelector('.ab-menu').click()`); await waitFor(`!!document.querySelector('.rd-menu')`);
t = await J(`(() => { const b = document.querySelector('.rd-item[data-act=cards]'); return b && b.textContent; })()`);
check('the menu has a "Swipe cards" entry too', t === 'Swipe cardsRead one story at a time', JSON.stringify(t));
await c.ev(`document.querySelector('.rd-sheet .rd-close').click()`);
await open({ native: false });
check('the phone website has the switch as well', (await c.ev(`!!document.querySelector('.view-switch') && !document.querySelector('.view-switch').hidden`)) === true);
await open({ native: false, width: 1280 });
check('the desktop website does not (and never loads cards.js)', (await c.ev(`(!document.querySelector('.view-switch') || document.querySelector('.view-switch').hidden) && typeof window.HBCards === 'undefined'`)) === true);
await open({ native: false, width: 1280, query: '?classic=1' });
check('desktop with ?classic=1: no switch either', (await c.ev(`!document.querySelector('.view-switch') || document.querySelector('.view-switch').hidden`)) === true);
await open({ native: true, width: 820, height: 1100 });
check('the iPad-sized app has it', (await c.ev(`!!document.querySelector('.view-switch') && !document.querySelector('.view-switch').hidden`)) === true);

// ---------- 2. opening the deck; what it contains, in the reader's order ----------
await open();
check('tapping Cards opens the deck over the feed and remembers the choice', await openDeck() && (await view()) === 'cards' && (await c.ev(`document.documentElement.classList.contains('hb-deck-open') && getComputedStyle(document.documentElement).overflow === 'hidden'`)));
const k = await kinds();
const feedAll = await feedIds(['ai', 'biz', 'mkt']);
check('the deck is the cover, then a section card and its stories for each section, then the quiz', k[0] === 'cover' && k[1] === 'intro' && k.filter((x) => x === 'cover').length === 1 && k[k.length - 1] === 'quiz' && k.filter((x) => x === 'intro').length === 3 && k.filter((x) => x === 'story').length === feedAll.length && !k.includes('end'), JSON.stringify(k));
check('the stories come in the feed\'s own order', eq(await storyIds(), feedAll));
t = await J(`(() => { const lane = document.querySelector('#ai'), card = document.querySelector('.dk-intro'); const lt = lane.querySelector('.lane-takeaway').cloneNode(true); lt.querySelector('.takeaway-label').remove(); return { title: card.querySelector('.dk-title').textContent, tag: lane.querySelector('.lane-tag').childNodes[0].textContent.trim(), meta: card.querySelector('.dk-metaline').textContent, take: card.querySelector('.dk-take').textContent.replace('Takeaway', '').trim(), want: lt.textContent.trim(), n: card.querySelectorAll('.dk-go').length, items: lane.querySelectorAll('.item[data-story-id]').length, kick: card.querySelector('.dk-kick').textContent }; })()`);
check('a section card shows its name, reading time and story count, its takeaway and a numbered list of its stories', t.title === t.tag && /min read · \d+ stories/.test(t.meta) && t.take === t.want && t.n === t.items && t.kick === 'Section 1 of 3', JSON.stringify(t));
await c.shot(`${OUT}/cards_intro.png`);
t = await J(`(() => { const h = document.querySelector('.dk-intro .dk-hint'), r = h.getBoundingClientRect(); return { tag: h.tagName, text: h.textContent, h: Math.round(r.height), l: Math.round(r.left), r: Math.round(r.right), w: innerWidth, bottom: Math.round(r.bottom), tab: Math.round(document.querySelector('.tab-bar').getBoundingClientRect().top), inScroll: !!h.closest('.dk-scroll') }; })()`);
check('"Swipe to start" on a section card is a real button, pinned in view (no scrolling to find it), easy to tap and inside the screen', t.tag === 'BUTTON' && t.text === 'Swipe to start \u2192' && t.h >= 44 && t.l >= 0 && t.r <= t.w && t.bottom <= t.tab && !t.inScroll, JSON.stringify(t));
await c.ev(`document.querySelector('.dk-intro .dk-hint').click()`); await c.sleep(900);
t = await J(`({ pos: document.querySelector('.dk-count').textContent, sec: document.querySelector('.dk-sec-pos').textContent, id: document.querySelector('.dk-card:not([inert])').getAttribute('data-id') })`);
check('tapping it swipes to the first story of that section, just as a swipe would', t.pos === `3 / ${TOTAL}` && t.sec === 'Story 1 of 7' && t.id === 'ai-1', JSON.stringify(t));
await c.ev(`HBCards.goTo(1, false)`); await c.sleep(500);
await c.ev(`document.querySelectorAll('.dk-intro .dk-go')[1].click()`); await c.sleep(900);
check('tapping a story in that list jumps to it', (await c.ev(`document.querySelector('.dk-sec-pos').textContent`)) === 'Story 2 of 7' && (await pos()) === `4 / ${TOTAL}`, await pos());
t = await J(`(() => { const card = document.querySelectorAll('.dk-story')[1], it = document.querySelector('#ai-2'); const paras = [...it.querySelectorAll('.story-body > p')].map((p) => p.textContent.replace(/\\s+/g, ' ').trim()); const tk = it.querySelector('.takeaway').cloneNode(true); tk.querySelector('.takeaway-label').remove(); return { h: card.querySelector('.dk-title').textContent === it.querySelector('h3').textContent.trim(), body: JSON.stringify([...card.querySelectorAll('.dk-body p')].map((p) => p.textContent)) === JSON.stringify(paras), clampedInFeed: it.classList.contains('is-collapsed'), take: card.querySelector('.dk-take').textContent.replace('Takeaway', '').trim() === tk.textContent.trim(), src: card.querySelector('.dk-src a').href === it.querySelector('.src a').href, ext: card.querySelector('.dk-src a').target + '/' + card.querySelector('.dk-src a').rel }; })()`);
check('a story card has the headline, the whole summary (unclamped), the takeaway and the source link, copied from the feed', t.h && t.body && t.take && t.src && t.ext === '_blank/noopener noreferrer', JSON.stringify(t));
await c.shot(`${OUT}/cards_story.png`);

// text is copied as text, never as markup
await c.ev(`HBCards.close(); document.querySelector('#ai-1 h3').textContent = '<img src=x onerror="window.__xss=1"> Tom & Jerry'; 'ok'`);
await openDeck();
t = await J(`({ imgs: document.querySelectorAll('.hb-deck img').length, xss: window.__xss || 0, title: document.querySelector('.dk-story .dk-title').textContent })`);
check('markup in a headline is shown as text and never runs', t.imgs === 0 && t.xss === 0 && /^<img src=x/.test(t.title), JSON.stringify(t));

// order follows the reader's own choices
await open({ prefs: { order: ['mkt', 'ai', 'biz', 'quiz'], off: ['biz'] } });
await openDeck();
check('the reader\'s section order and hidden sections carry over (Stock Market first, Product & Business left out)', eq(await secOrder(), ['Stock Market', 'AI & Tech']) && eq(await storyIds(), await feedIds(['mkt', 'ai'])) && (await kinds()).slice(-1)[0] === 'quiz', JSON.stringify(await secOrder()));
await open({ prefs: { order: ['quiz', 'ai', 'biz', 'mkt'], off: [] } });
await openDeck();
t = await kinds();
check('a quiz the reader moved to the top stays where they put it (after the cover), and a closing card is added at the end', t[0] === 'cover' && t[1] === 'quiz' && t[t.length - 1] === 'end', JSON.stringify(t));
await open({ prefs: { order: [], off: ['quiz'] } });
await openDeck();
t = await kinds();
check('with the quiz switched off there is no quiz card, and the deck ends with a closing card', !t.includes('quiz') && t[t.length - 1] === 'end', JSON.stringify(t));

// ---------- 3. moving between cards ----------
await open();
await openDeck();
await c.swipe(195, 420, -250, 0); await c.sleep(800);
t = await J(`({ pos: document.querySelector('.dk-count').textContent, sl: Math.round(document.querySelector('.dk-track').scrollLeft), w: document.querySelector('.dk-track').clientWidth, sec: document.querySelector('.dk-sec-pos').textContent })`);
check('a real swipe to the left moves to the next card, snapped exactly to it', t.pos === `3 / ${TOTAL}` && t.sl === 2 * t.w && t.sec === 'Story 1 of 7', JSON.stringify(t));
await c.swipe(195, 420, 250, 0); await c.sleep(800);
check('a swipe to the right goes back', (await pos()) === `2 / ${TOTAL}`);
await c.swipe(195, 420, -60, 0, 300); await c.sleep(800);
check('even a short flick moves on, never leaving two cards half-showing', (await pos()) === `3 / ${TOTAL}` && (await c.ev(`document.querySelector('.dk-track').scrollLeft % document.querySelector('.dk-track').clientWidth`)) === 0);
await c.ev(`document.querySelector('.dk-next').click()`); await c.sleep(800);
check('the Next button works (an alternative to swiping)', (await pos()) === `4 / ${TOTAL}`);
await c.ev(`document.querySelector('.dk-prev').click()`); await c.sleep(800);
check('and Previous', (await pos()) === `3 / ${TOTAL}`);
await c.ev(`document.querySelector('.dk-track').focus()`);
await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }); await c.sleep(800);
check('the right arrow key moves on', (await pos()) === `4 / ${TOTAL}`);
await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 }); await c.sleep(1000);
t = await J(`({ pos: document.querySelector('.dk-count').textContent, next: document.querySelector('.dk-next').disabled, kind: document.querySelector('.dk-card:not([inert])').className })`);
check('End goes to the last card (the quiz), where Next is disabled', t.pos === `${TOTAL} / ${TOTAL}` && t.next && /dk-quiz/.test(t.kind), JSON.stringify(t));
await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 }); await c.sleep(1000);
check('Home returns to the start (the cover), where Previous is disabled', (await pos()) === `1 / ${TOTAL}` && (await c.ev(`document.querySelector('.dk-prev').disabled`)) === true);
t = await J(`(() => { const all = [...document.querySelectorAll('.dk-card')]; return { inert: all.filter((x) => x.inert).length, n: all.length }; })()`);
check('only the card in view can be tabbed to or read by a screen reader (the others are inert)', t.inert === t.n - 1, JSON.stringify(t));
await c.ev(`document.querySelector('.dk-next').click()`); await c.sleep(1000);
t = await J(`({ live: document.querySelector('.dk-live').textContent, role: document.querySelector('.hb-deck').getAttribute('role'), rd: document.querySelector('.hb-deck').getAttribute('aria-roledescription'), label: document.querySelector('.dk-card:not([inert])').getAttribute('aria-label') })`);
check('it is announced as a carousel, and each card change is announced (here "Section 1 of 3: AI & Tech. AI & Tech")', t.role === 'region' && t.rd === 'carousel' && /^Section 1 of 3: AI & Tech\. AI & Tech/.test(t.live) && /Section 1 of 3/.test(t.label), JSON.stringify(t));
await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await c.sleep(400);
check('Esc closes the deck and goes back to the list (and remembers List)', (await c.ev(`!HBCards.isOpen() && document.querySelector('.hb-deck').hidden && !document.documentElement.classList.contains('hb-deck-open')`)) && (await view()) === 'list');

// a scroll that stops short (seen in Android WebViews) is finished
await open();
await openDeck();
await c.ev(`Element.prototype.scrollTo = function (o) { if (o && typeof o === 'object' && o.left != null) this.scrollLeft = this.scrollLeft + (o.left - this.scrollLeft) * 0.4; }; 'ok'`);
await c.ev(`document.querySelector('.dk-next').click()`); await c.sleep(1200);
t = await J(`({ pos: document.querySelector('.dk-count').textContent, off: document.querySelector('.dk-track').scrollLeft - 2 * document.querySelector('.dk-track').clientWidth })`);
check('even if the browser stops the scroll partway, the card ends up exactly in place', t.pos === `3 / ${TOTAL}` && Math.abs(t.off) < 2, JSON.stringify(t));

// Chrome on Android sometimes leaves a snapping track a little past (or short of) a card after a smooth scroll. Force that here by
// turning the browser's own snapping off and parking the track off-centre, as the browser did on the emulator.
const OFFSET = `(() => { const t = document.querySelector('.dk-track'), k = document.querySelectorAll('.dk-card')[%N%]; return Math.round((k.getBoundingClientRect().left - t.getBoundingClientRect().left) * 10) / 10; })()`;
const PARK = (n, by) => `(() => { const t = document.querySelector('.dk-track'), k = document.querySelectorAll('.dk-card')[${n}]; t.style.scrollSnapType = 'none'; t.scrollLeft = k.getBoundingClientRect().left - t.getBoundingClientRect().left + t.scrollLeft + (${by}); })()`;
await open();
await openDeck();
await c.sleep(500);
await c.ev(PARK(2, 11.6)); await c.sleep(900);
t = await J(OFFSET.replace('%N%', 2));
check('a track left 11.6px past a card by the browser is put exactly on it once scrolling stops', Math.abs(t) <= 2 && (await pos()) === `3 / ${TOTAL}`, String(t));
await c.ev(PARK(3, -30)); await c.sleep(900);
t = await J(OFFSET.replace('%N%', 3));
check('and one left 30px short of a card is too', Math.abs(t) <= 2 && (await pos()) === `4 / ${TOTAL}`, String(t));
await c.ev(`document.querySelector('.hb-deck').dispatchEvent(new Event('touchstart')); 'ok'`);
await c.ev(PARK(4, 15)); await c.sleep(900);
t = await J(OFFSET.replace('%N%', 4));
check('but while a finger is on the deck it is never moved from under it', Math.abs(t) > 10, String(t));
await c.ev(`document.querySelector('.hb-deck').dispatchEvent(new Event('touchend')); 'ok'`); await c.sleep(1400);
t = await J(OFFSET.replace('%N%', 4));
check('and when the finger lifts, it settles onto the card', Math.abs(t) <= 2, String(t));

// ---------- 4. long stories scroll inside the card ----------
await open({ height: 600 });
await openDeck();
await c.ev(`document.querySelector('.dk-next').click()`); await c.sleep(900);
t = await J(`(() => { const sc = document.querySelector('.dk-card:not([inert]) .dk-scroll'); return { over: sc.scrollHeight > sc.clientHeight + 20, more: sc.classList.contains('more'), overflowY: getComputedStyle(sc).overflowY }; })()`);
check('a story taller than the screen scrolls inside its card, with a fade at the bottom saying there is more', t.over && t.more && t.overflowY === 'auto', JSON.stringify(t));
await c.swipe(195, 320, 0, -320); await c.sleep(700);
t = await J(`(() => { const sc = document.querySelector('.dk-card:not([inert]) .dk-scroll'); return { top: Math.round(sc.scrollTop), pos: document.querySelector('.dk-count').textContent, actionsBottom: Math.round(document.querySelector('.dk-card:not([inert]) .dk-actions').getBoundingClientRect().bottom), tab: Math.round(document.querySelector('.tab-bar').getBoundingClientRect().top) }; })()`);
check('a vertical swipe scrolls that story (not the deck), and the buttons stay pinned in reach above the tab bar', t.top > 100 && t.pos === `3 / ${TOTAL}` && t.actionsBottom <= t.tab, JSON.stringify(t));
await c.swipe(195, 320, 0, -900); await c.sleep(700);
check('scrolled to the end of the story, the fade goes away (takeaway and source are visible)', (await c.ev(`!document.querySelector('.dk-card:not([inert]) .dk-scroll').classList.contains('more')`)) === true);
await c.swipe(195, 320, -250, 0); await c.sleep(800);
check('a sideways swipe on the same card still moves on', (await pos()) === `4 / ${TOTAL}`);

// ---------- 5. the buttons on a card work the real ones ----------
await open();
await openDeck();
await c.ev(`document.querySelector('.dk-next').click()`); await c.sleep(900);
await c.ev(`window.__hits = []; ['.vote-like', '.vote-dislike', '.story-share'].forEach((s) => document.querySelector('#ai-1 ' + s).addEventListener('click', () => window.__hits.push(s), true)); window.__shared = null; navigator.share = (o) => { window.__shared = o; return Promise.resolve(); }; 'ok'`);
await c.ev(`document.querySelector('.dk-card:not([inert]) .dk-like').click(); document.querySelector('.dk-card:not([inert]) .dk-dislike').click(); document.querySelector('.dk-card:not([inert]) .dk-share').click(); 'ok'`); await c.sleep(300);
t = await J(`({ hits: window.__hits, shared: window.__shared && window.__shared.url })`);
check('Like, Dislike and Share on a card press the feed\'s own buttons (so votes and sharing behave exactly as before)', eq(t.hits, ['.vote-like', '.vote-dislike', '.story-share']) && /\/s\/\d{4}-\d{2}-\d{2}\/ai-1/.test(t.shared || ''), JSON.stringify(t));
await c.ev(`(() => { const r = document.querySelector('#ai-1 .vote-row'); r.querySelector('.vote-like .vote-count').textContent = '7'; r.querySelector('.vote-like').classList.add('voted-like'); r.querySelector('.vote-like').disabled = true; })()`); await c.sleep(300);
t = await J(`(() => { const b = document.querySelector('.dk-card:not([inert]) .dk-like'); return { n: b.querySelector('.dk-n').textContent, on: b.classList.contains('on'), dis: b.disabled }; })()`);
check('when the feed\'s vote count and state change, the card shows the same', t.n === '7' && t.on && t.dis, JSON.stringify(t));
await c.ev(`document.querySelector('.dk-card:not([inert]) .dk-save').click()`); await c.sleep(300);
t = await J(`({ card: document.querySelector('.dk-card:not([inert]) .dk-save').getAttribute('aria-pressed'), feed: document.querySelector('#ai-1 .story-save').getAttribute('aria-pressed'), saved: JSON.parse(localStorage.getItem('hb-saved-v1') || '[]').map((x) => x.id) })`);
check('Save on a card saves the story (it appears in Saved) and the card shows it as saved', t.card === 'true' && t.feed === 'true' && eq(t.saved, ['ai-1']), JSON.stringify(t));
await c.ev(`document.querySelector('.dk-card:not([inert]) .dk-save').click()`); await c.sleep(300);
check('tapping it again removes it', (await c.ev(`document.querySelector('.dk-card:not([inert]) .dk-save').getAttribute('aria-pressed')`)) === 'false');

// ---------- 6. Listen follows along; the reader is never yanked ----------
// (real Listen with a fake voice; each utterance takes __ttsMs, so a story is read in a fraction of a second)
const FAST = `window.__ttsMs = 250;`, SLOW = `window.__ttsMs = 60000;`;
const cardKey = `(() => { const k = document.querySelector('.dk-card:not([inert])'); return k.classList.contains('dk-cover') ? 'cover' : k.classList.contains('dk-intro') ? 'section:' + k.querySelector('.dk-title').textContent : k.getAttribute('data-id') || k.className; })()`;
await open({ tts: true });
await openDeck({ cover: true });
await c.ev(`${FAST} window.__seen = []; window.__iv = setInterval(() => { const k = ${cardKey}; if (window.__seen[window.__seen.length - 1] !== k) window.__seen.push(k); }, 40); HBListen.start('quick')`);
await waitFor(`window.__seen.includes('ai-2')`, 20000);
t = await J(`window.__seen`);
check('while Listen reads, the deck turns by itself: the cover for the introduction, the section card, then each story in turn', t[0] === 'cover' && t[1] === 'section:AI & Tech' && t[2] === 'ai-1' && t[3] === 'ai-2', JSON.stringify(t));
await waitFor(`window.__seen.includes('section:Product & Business')`, 25000);
t = await J(`window.__seen.filter((x) => !/^ai-/.test(x))`);
check('and it moves on from one section to the next (AI & Tech, then Product & Business)', t.includes('section:AI & Tech') && t.indexOf('section:Product & Business') > t.indexOf('section:AI & Tech'), JSON.stringify(t));
await c.ev(`clearInterval(window.__iv); HBListen.stop(); ${SLOW}`); await c.sleep(300);

// touching the deck holds the following off
await open({ tts: true });
await openDeck({ cover: true });
await c.ev(`${SLOW} HBListen.start('quick')`); await waitFor(`HBListen.state() === 'playing'`, 4000);
await c.ev(`document.querySelector('.hb-deck').dispatchEvent(new Event('touchstart')); document.querySelector('.hb-deck').dispatchEvent(new Event('touchend')); document.querySelector('.hb-pl-next').click()`); await c.sleep(900);
t = await J(`({ card: ${cardKey}, listen: HBListen.current().id })`);
check('but not right after the reader touched the deck themselves: Listen moves on, the deck stays where they are', t.card === 'cover' && t.listen === 'lane:ai', JSON.stringify(t));
await c.ev(`HBListen.stop()`);

// opened while something is playing
await open({ tts: true });
await c.ev(`${SLOW} HBListen.start('quick')`); await waitFor(`HBListen.state() === 'playing'`, 4000);
await c.ev(`document.querySelector('.hb-pl-next').click(); document.querySelector('.hb-pl-next').click()`); await c.sleep(500);
const readingNow = await c.ev(`HBListen.current().id`);
await openDeck({ cover: true });
t = await J(`({ card: ${cardKey}, reading: ${JSON.stringify(readingNow)} })`);
check('opened while a story is being read, the deck starts on that story', readingNow === 'story:ai-1' && t.card === 'ai-1', JSON.stringify(t));
await c.ev(`HBListen.stop()`);
await open({ tts: true });
await c.ev(`${SLOW} HBListen.start('quick')`); await waitFor(`HBListen.state() === 'playing'`, 4000);
await c.ev(`document.querySelector('.hb-pl-next').click()`); await c.sleep(400);
await openDeck({ cover: true });
check('opened while a section is being introduced, it starts on that section\'s card', (await c.ev(cardKey)) === 'section:AI & Tech');
await c.ev(`HBListen.stop()`);

// the marker, pause, and the end of the brief
await open({ tts: true });
await openDeck({ cover: true });
await c.ev(`${SLOW} HBListen.start('quick')`); await waitFor(`HBListen.state() === 'playing'`, 4000);
await c.ev(`document.querySelector('.hb-pl-next').click(); document.querySelector('.hb-pl-next').click()`); await c.sleep(900);
t = await J(`({ marked: [...document.querySelectorAll('.dk-card.dk-playing')].map((k) => k.getAttribute('data-id')), card: ${cardKey} })`);
check('the card being read is marked (a purple edge), and only that one', eq(t.marked, ['ai-1']) && t.card === 'ai-1', JSON.stringify(t));
await c.ev(`document.querySelector('.hb-pl-play').click()`); await c.sleep(300);
check('paused: Listen has stopped, and the deck does not chase anything', (await c.ev(`HBListen.state()`)) === 'paused');
await c.ev(`HBListen.stop()`); await c.sleep(300);
check('when playback stops the marker goes', (await c.ev(`document.querySelectorAll('.dk-card.dk-playing').length`)) === 0);
await c.ev(`HBListen.start('quick')`); await waitFor(`HBListen.state() === 'playing'`, 4000);
await c.ev(`for (let i = 0; i < 40 && HBListen.current().id !== 'outro'; i++) document.querySelector('.hb-pl-next').click()`); await c.sleep(900);
t = await J(`({ id: HBListen.current().id, card: document.querySelector('.dk-card:not([inert])').classList.contains('dk-quiz') })`);
check('the closing lines of the brief ("try the quiz") land on the quiz card', t.id === 'outro' && t.card, JSON.stringify(t));
await c.ev(`HBListen.stop()`);

// ---------- 7. links, the list, and remembering ----------
await open({ hash: '#ai-2', view: 'cards' });
check('a shared story link opens the deck on that story when Cards is the reader\'s choice', (await c.ev(`HBCards.isOpen() && document.querySelector('.dk-card:not([inert])').getAttribute('data-id')`)) === 'ai-2');
await open({ hash: '#ai-2' });
t = await J(`({ deck: typeof window.HBCards !== 'undefined' && HBCards.isOpen(), top: Math.round(document.querySelector('#ai-2').getBoundingClientRect().top) })`);
check('the same link with the list as the choice scrolls the feed to it as before, with no deck', !t.deck && t.top >= 0 && t.top < 200, JSON.stringify(t));
await open({ view: 'cards' });
check('if Cards was the last view used, the app opens straight into it', (await c.ev(`!!window.HBCards && HBCards.isOpen()`)) === true);
await c.ev(`document.querySelector('.dk-tolist').click()`); await c.sleep(400);
await c.ev(`(location.reload(), 'ok')`); await c.sleep(2200);
check('after choosing List it opens on the list next time', (await c.ev(`!(window.HBCards && HBCards.isOpen())`)) === true && (await view()) === 'list');
await open();
await openDeck();
await c.ev(`HBCards.goTo(4, false)`); await c.sleep(500);
const story3 = await c.ev(`document.querySelector('.dk-card:not([inert])').getAttribute('data-id')`);
await c.ev(`document.querySelector('.dk-tolist').click()`); await c.sleep(500);
t = await J(`({ top: Math.round(document.getElementById(${JSON.stringify(story3)}).getBoundingClientRect().top), deck: HBCards.isOpen() })`);
check('going back to the list lands on the story you were reading', !t.deck && t.top >= 0 && t.top < 140, JSON.stringify(t));
await open();
await openDeck();
await c.ev(`HBCards.goTo(HBCards.count() - 1, false)`); await c.sleep(600);
t = await J(`(() => { document.querySelector('.dk-quiz .dk-cta').click(); const k = document.querySelector('#quiz .quiz-card').getBoundingClientRect(); return { deck: HBCards.isOpen(), cardTop: Math.round(k.top), scrollYNow: Math.round(scrollY), view: localStorage.getItem('hb-view-v1') }; })()`);
check('"Play the quiz" is one instant change of screen: the deck is gone and the first question is already in place (in the very same moment, nothing scrolls past)', !t.deck && t.cardTop >= 60 && t.cardTop <= 110 && t.scrollYNow > 5000 && t.view === 'cards', JSON.stringify(t));
await c.sleep(1500);
t = await J(`({ cardTop: Math.round(document.querySelector('#quiz .quiz-card').getBoundingClientRect().top), opts: document.querySelectorAll('#quiz .quiz-opt').length })`);
check('and it stays there, with the question and its answers on screen, and Cards stays your choice for next time', t.cardTop >= 60 && t.cardTop <= 110 && t.opts >= 2, JSON.stringify(t));
await open();
await openDeck();
t = await J(`(() => { document.querySelector('.tab[data-tab=quiz]').click(); return { deck: HBCards.isOpen(), quizTop: Math.round(document.getElementById('quiz').getBoundingClientRect().top), view: localStorage.getItem('hb-view-v1') }; })()`);
check('the Challenge tab does the same from the deck: instantly on the quiz section, Cards still your choice', !t.deck && t.quizTop >= 0 && t.quizTop <= 110 && t.view === 'cards', JSON.stringify(t));
await open();
await openDeck();
await c.ev(`HBCards.goTo(5, false)`); await c.sleep(400);
await c.ev(`document.querySelector('.tab[data-tab=today]').click()`); await c.sleep(900);
check('the Today tab, while cards are showing, goes back to the first card (the cover)', (await pos()) === `1 / ${TOTAL}`);
check('while cards are showing, Today is the tab that is highlighted', (await c.ev(`document.querySelector('.tab[aria-current=page]').getAttribute('data-tab')`)) === 'today');
await open();
await openDeck();
await c.ev(`HBCards.goTo(3, false)`); await c.sleep(400);
await c.ev(`document.querySelector('#biz').setAttribute('data-pref-off', ''); document.querySelector('#biz').style.display = 'none'; document.dispatchEvent(new CustomEvent('hb:prefs')); 'ok'`); await c.sleep(500);
check('changing the section choices while the deck is open rebuilds it without that section, and keeps your place', eq(await secOrder(), ['AI & Tech', 'Stock Market']) && (await c.ev(`document.querySelector('.dk-card:not([inert])').getAttribute('data-id')`)) === 'ai-2', JSON.stringify(await secOrder()));

// Chrome 113 (the Android WebView) ignores scrollIntoView({behavior:'instant'}) and eases instead. Imitate that and check the deck
// still hands over in one step (it must not rely on scrollIntoView for its instant jumps).
await open();
await openDeck();
await c.ev(`HBCards.goTo(HBCards.count() - 1, false)`); await c.sleep(500);
await c.ev(`Element.prototype.scrollIntoView = function () { window.scrollTo({ top: this.getBoundingClientRect().top + scrollY - 72, behavior: 'smooth' }); }; 'ok'`);
t = await J(`(() => { document.querySelector('.dk-quiz .dk-cta').click(); const k = document.querySelector('#quiz .quiz-card').getBoundingClientRect(); return { deck: HBCards.isOpen(), cardTop: Math.round(k.top) }; })()`);
check('on a Chrome that eases scrollIntoView, "Play the quiz" still lands on the question in one step', !t.deck && t.cardTop >= 60 && t.cardTop <= 110, JSON.stringify(t));
await open();
await openDeck();
await c.ev(`HBCards.goTo(5, false)`); await c.sleep(500);
const readingId = await c.ev(`document.querySelector('.dk-card:not([inert])').getAttribute('data-id')`);
await c.ev(`Element.prototype.scrollIntoView = function () { window.scrollTo({ top: this.getBoundingClientRect().top + scrollY - 72, behavior: 'smooth' }); }; 'ok'`);
t = await J(`(() => { document.querySelector('.dk-tolist').click(); const k = document.getElementById(${JSON.stringify(readingId)}).getBoundingClientRect(); return { deck: HBCards.isOpen(), top: Math.round(k.top) }; })()`);
check('and going back to the list lands on the story you were reading in one step, too', !t.deck && t.top >= 40 && t.top <= 110, JSON.stringify(t));

// ---------- 8. Cards is the default view ----------
await open({ view: 'default', wait: 2600 });
t = await J(`({ deck: !!window.HBCards && HBCards.isOpen(), first: document.querySelector('.dk-card:not([inert])') && document.querySelector('.dk-card:not([inert])').className, visible: document.body.style.visibility, view: localStorage.getItem('hb-view-v1'), tab: (document.querySelector('.tab[aria-current=page]') || {}).dataset.tab })`);
check('with nothing stored (a new install, or anyone who has not chosen), the app opens on the swipe cards, starting with the cover card', t.deck && /dk-cover/.test(t.first) && t.view === 'cards' && t.tab === 'today', JSON.stringify(t));
check('the page is shown again once the deck is up (nothing left hidden)', t.visible === '');
await open({ view: 'default', native: false, wait: 2600 });
check('the phone website opens on the cards too', (await c.ev(`!!window.HBCards && HBCards.isOpen()`)) === true);
await open({ view: 'default', native: false, width: 1280, wait: 2000 });
check('the desktop website is untouched: the normal page, no deck, nothing hidden', (await c.ev(`typeof window.HBCards === 'undefined' && document.body.style.visibility === ''`)) === true);
await open({ view: 'default', wait: 2600 });
await c.ev(`document.querySelector('.dk-tolist').click()`); await c.sleep(400);
await c.ev(`(location.reload(), 'ok')`); await c.sleep(2400);
check('choosing List is remembered: the next open is the list', !(await c.ev(`window.HBCards && HBCards.isOpen()`)) && (await view()) === 'list');
await c.ev(`${cardsBtn}.click()`); await c.sleep(1200);
check('and choosing Cards again is remembered too', (await view()) === 'cards');

// links that point into the list open the list
await open({ view: 'default', hash: '#quiz', wait: 2600 });
t = await J(`({ deck: !!window.HBCards && HBCards.isOpen(), quizTop: Math.round(document.getElementById('quiz').getBoundingClientRect().top), visible: document.body.style.visibility })`);
check('a link to #quiz opens the list on the quiz, not the deck', !t.deck && t.quizTop < 300 && t.visible === '', JSON.stringify(t));
await open({ view: 'default', query: '?join=ABC123', wait: 2600 });
check('a league invite (?join=) opens the list, where the join box is', !(await c.ev(`!!window.HBCards && HBCards.isOpen()`)));
await open({ view: 'default', query: '?beat=3', hash: '#quiz', wait: 2600 });
check('a friend\'s score link (?beat=) opens the list on the quiz', !(await c.ev(`!!window.HBCards && HBCards.isOpen()`)));
await open({ view: 'default', hash: '#ai-2', wait: 2600 });
check('a shared story link opens the deck on that story', (await c.ev(`HBCards.isOpen() && document.querySelector('.dk-card:not([inert])').getAttribute('data-id')`)) === 'ai-2');
await open({ view: 'default', native: false, query: '?classic=1', width: 1280, wait: 2000 });
check('?classic=1 on the website stays the old layout', (await c.ev(`typeof window.HBCards === 'undefined'`)) === true);

// if cards.js cannot load (offline, blocked) the reader gets the list, not a blank page
await open({ view: 'default', wait: 4800, extra: `(() => { const d = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src'); Object.defineProperty(HTMLScriptElement.prototype, 'src', { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, v === '/cards.js' ? '/no-such-cards.js' : v); } }); })();` });
t = await J(`({ deck: !!window.HBCards, visible: document.body.style.visibility, listShown: getComputedStyle(document.querySelector('section.lane')).display !== 'none', toast: !!document.getElementById('mob-toast') && !document.getElementById('mob-toast').hidden })`);
check('if the deck cannot load, the list appears (page not left hidden) and no error message is thrown at the reader', !t.deck && t.visible === '' && t.listShown && !t.toast, JSON.stringify(t));

// ---------- 8b. the app bar is under the deck, so its actions are in the deck header ----------
await open({ view: 'default', wait: 2600 });
t = await J(`({ btns: [...document.querySelectorAll('.dk-top button')].map((b) => b.getAttribute('aria-label')), aa: !!document.querySelector('.dk-size') })`);
check('the deck header offers Saved stories, the Menu and List', eq(t.btns, ['Saved stories', 'Menu', 'Back to the scrolling list']) && !t.aa, JSON.stringify(t));
await c.ev(`document.querySelector('.dk-menu').click()`); await waitFor(`!!document.querySelector('.rd-menu')`);
t = await J(`({ items: [...document.querySelectorAll('.rd-item')].map((b) => b.getAttribute('data-act')), foot: [...document.querySelectorAll('.rd-menu-foot a')].map((a) => a.textContent), deckStill: HBCards.isOpen() })`);
check('the Menu opens over the deck with Sections, Text size, the reminder/share/email items and the Contact · About · Privacy links (no redundant "Swipe cards" item)', t.items.includes('sections') && t.items.includes('textsize') && t.items.includes('share') && !t.items.includes('cards') && eq(t.foot, ['Contact us', 'About', 'Privacy']) && t.deckStill, JSON.stringify(t));
await c.ev(`document.querySelector('.rd-sheet .rd-close').click()`); await c.sleep(300);
await c.ev(`document.querySelector('.dk-saved').click()`); await waitFor(`!!document.querySelector('.rd-sheet')`);
check('Saved stories opens over the deck', (await c.ev(`document.querySelector('.rd-sheet h2').textContent`)) === 'Saved stories' && (await c.ev(`HBCards.isOpen()`)));
await c.ev(`document.querySelector('.rd-sheet .rd-close').click()`); await c.sleep(300);
await c.ev(`document.querySelector('.dk-menu').click()`); await waitFor(`!!document.querySelector('.rd-menu')`);
t = await J(`(() => { const has = !!document.querySelector('.rd-item[data-act=email]'); if (has) document.querySelector('.rd-item[data-act=email]').click(); const box = document.querySelector('.subscribe-box').getBoundingClientRect(); return { has, deck: HBCards.isOpen(), top: Math.round(box.top), bottom: Math.round(box.bottom), tab: Math.round(document.querySelector('.tab-bar').getBoundingClientRect().top) }; })()`);
check('"Get it by email" from the deck leaves the deck and shows the whole sign-up box on screen (above the tab bar)', t.has && !t.deck && t.top >= 60 && t.bottom <= t.tab, JSON.stringify(t));
await open({ view: 'default', wait: 2600 });
await c.ev(`document.querySelector('.dk-menu').click()`); await waitFor(`!!document.querySelector('.rd-menu')`);
await c.ev(`document.querySelector('.rd-item[data-act=sections]').click()`); await waitFor(`!!document.querySelector('.rd-prefs')`);
await c.ev(`document.querySelector('.rd-prefs li[data-id=biz] input').click()`); await c.sleep(600);
await c.ev(`document.querySelector('.rd-sheet .rd-close').click()`); await c.sleep(400);
check('changing sections from the deck rebuilds the deck without that section', eq(await secOrder(), ['AI & Tech', 'Stock Market']) && (await c.ev(`HBCards.isOpen()`)), JSON.stringify(await secOrder()));

// the Today tab returns to the cards after a trip to the quiz
await open({ view: 'default', wait: 2600 });
await c.ev(`HBCards.goTo(HBCards.count() - 1, false)`); await c.sleep(500);
await c.ev(`document.querySelector('.dk-quiz .dk-cta').click()`); await c.sleep(900);
check('after "Play the quiz" you are on the list', !(await c.ev(`HBCards.isOpen()`)));
await c.ev(`document.querySelector('.tab[data-tab=today]').click()`); await c.sleep(1200);
check('the Today tab brings the cards back (Cards is still your choice)', (await c.ev(`HBCards.isOpen()`)) === true && (await view()) === 'cards');

// ---------- 8c. the sections hint (a later day), now inside the deck ----------
const fresh = { n: 0, last: LONG_AGO, done: false, secOn: '' };
await open({ view: 'default', tip: { ...fresh, n: 1 }, wait: 2800 });
t = await J(`(() => { const k = document.querySelector('.hb-deck > .hb-tip'); if (!k) return null; const r = k.getBoundingClientRect(), tr = document.querySelector('.dk-track').getBoundingClientRect(), top = document.querySelector('.dk-top').getBoundingClientRect(); return { tip: k.dataset.tip, title: k.querySelector('strong').textContent, btns: [...k.querySelectorAll('button')].map((b) => b.textContent), between: r.top >= top.bottom - 1 && r.bottom <= tr.top + 1, inside: r.left >= 0 && r.right <= innerWidth, cards: !!document.querySelector('.hb-tip[data-tip=cards]') }; })()`);
check('day 2, Cards showing: the "Make it yours" hint sits inside the deck, under the top bar, with Choose / Not now', t && t.tip === 'sections' && t.title === 'Make it yours' && eq(t.btns, ['Choose', 'Not now']) && t.between && t.inside, JSON.stringify(t));
check('there is no "Try swipe cards" hint any more (Cards is already the default)', !t.cards);
await c.shot(`${OUT}/cards_sections_hint.png`);
await c.ev(`document.querySelector('.hb-tip-go').click()`); await c.sleep(500);
check('Choose opens Your sections over the deck, the hint goes, and the deck stays', (await c.ev(`document.querySelector('.rd-sheet h2').textContent`)) === 'Your sections' && !(await hasTip()) && (await c.ev(`HBCards.isOpen()`)));
await open({ view: 'default', tip: { ...fresh, n: 1 }, wait: 2800 });
await c.ev(`document.querySelector('.hb-tip-no').click()`); await c.sleep(300);
check('Not now removes it and it does not return', !(await hasTip()) && (await tipState()).done === true);
await open({ view: 'default', tip: { ...fresh, n: 1, secOn: LONG_AGO }, wait: 2800 });
check('ignored on its first day, it is not shown again on a later day', !(await hasTip()), JSON.stringify(await tipState()));
await open({ view: 'default', prefs: { order: [], off: [] }, tip: { ...fresh, n: 1 }, wait: 2800 });
check('someone who already has saved sections is not asked', !(await hasTip()));
await open({ view: 'default', tip: { ...fresh, n: 1 }, hash: '#ai-2', wait: 2800 });
check('opened from a shared story link: no hint', !(await hasTip()));
await open({ view: 'default', native: false, tip: { ...fresh, n: 5 }, wait: 2800 });
check('the website never shows it (and nothing is counted there)', !(await hasTip()) && eq(await tipState(), { ...fresh, n: 5 }));
await open({ view: 'default', tip: { ...fresh, n: 0 }, wait: 2800 });
check('day 1 (a brand-new install): no hint, one visit counted', !(await hasTip()) && (await tipState()).n === 1);
await open({ view: 'list', tip: { ...fresh, n: 1 } });
check('with the List chosen, the hint still appears above the first section, as before', (await c.ev(`!!document.querySelector('.hb-tip[data-tip=sections]') && !document.querySelector('.hb-deck .hb-tip')`)) === true);

// ---------- 8d. the cover card: the top of the page comes first ----------
await open({ tts: true });
await openDeck({ cover: true });
await c.sleep(400);
t = await J(`(() => { const k = document.querySelector('.dk-cover'), q = (s) => k.querySelector(s), top = (s) => Math.round(q(s).getBoundingClientRect().top), ed = document.querySelector('.edition'), parts = ed.innerHTML.split('<br>').map((x) => x.replace(/<[^>]*>/g, '').trim()); return { first: k === document.querySelector('.dk-card'), kick: q('.dk-kick').textContent, edition: parts[0], word: q('.dk-wordmark').textContent, tag: q('.dk-metaline').textContent === document.querySelector('.tagline').textContent.trim(), label: q('.dk-quote-label').textContent, quote: q('.dk-quote-text').textContent === document.querySelector('.pause-text').textContent.trim(), by: q('.dk-quote-by').textContent, link: q('.dk-quote-by a') && q('.dk-quote-by a').getAttribute('href') === document.querySelector('.pause-attr a').getAttribute('href') && q('.dk-quote-by a').target + '/' + q('.dk-quote-by a').rel, intro: q('.dk-intro-p').textContent.startsWith('The Hour Brief is a daily read'), free: !!q('.dk-free'), pos: [top('.dk-quote'), top('.dk-listen'), top('.dk-quizt'), top('.dk-intro-p')], start: q('.dk-hint').textContent, startInScroll: !!q('.dk-hint').closest('.dk-scroll'), sec: document.querySelector('.dk-sec-name').textContent, sub: document.querySelector('.dk-sec-pos').textContent }; })()`);
check('the first card is the top of the page: edition line, "The Hour Brief", the tagline, the quote with its author and source link, and the intro paragraph', t.first && t.kick.includes(t.edition) && t.word === 'The Hour Brief' && t.tag && t.label === 'Before the news' && t.quote && /Seth Godin/.test(t.by) && t.link === '_blank/noopener noreferrer' && t.intro && t.free, JSON.stringify(t));
check('the Listen and quiz tiles come straight after the quote (before the long intro), so they are on screen without scrolling', t.pos[0] < t.pos[1] && t.pos[1] < t.pos[2] && t.pos[2] < t.pos[3] && t.pos[2] < 620, JSON.stringify(t.pos));
check('a "Start reading" button is pinned below, and the header names the edition', t.start === 'Start reading →' && !t.startInScroll && t.sec === 'The Hour Brief' && t.sub.includes(t.edition), JSON.stringify(t));
t = await J(`(() => { const l = document.querySelector('.dk-listen'), q = document.querySelector('.dk-quizt'); return { listen: !l.hidden, lt: l.querySelector('strong').textContent, ls: l.querySelector('small').textContent, lbtn: l.querySelector('.dk-tile-go').getAttribute('aria-label'), quiz: !q.hidden, qt: q.querySelector('strong').textContent, qs: q.querySelector('small').textContent, ql: q.querySelector('.dk-tile-link').textContent, qrole: q.getAttribute('role') }; })()`);
check('the Listen tile says what it is and how long ("Listen to today\'s brief", minutes and voice) with a play button, and the quiz tile carries the quiz chip\'s title, subtitle and "Play →"', t.listen && t.lt === 'Listen to today’s brief' && /min/.test(t.ls) && /Play/.test(t.lbtn) && t.quiz && /quiz/i.test(t.qt) && t.qs.length > 0 && /Play|Review/.test(t.ql) && t.qrole === 'button', JSON.stringify(t));
await c.shot(`${OUT}/cards_cover.png`);
await c.ev(`document.querySelector('.dk-listen .dk-tile-go').click()`); await waitFor(`HBListen.state() === 'playing'`, 4000); await c.sleep(300);
t = await J(`({ st: HBListen.state(), tile: document.querySelector('.dk-listen').classList.contains('playing'), btn: document.querySelector('.dk-listen .dk-tile-go').getAttribute('aria-label') })`);
check('the Listen tile\'s button starts the brief, and turns into Pause', t.st === 'playing' && t.tile && /Pause/.test(t.btn), JSON.stringify(t));
await c.ev(`HBListen.stop()`);
await c.ev(`document.querySelector('.dk-cover .dk-hint').click()`); await c.sleep(900);
check('"Start reading" moves on to the first section', (await pos()) === `2 / ${TOTAL}` && (await c.ev(`document.querySelector('.dk-sec-pos').textContent`)) === 'Section 1 of 3');
await c.ev(`HBCards.goTo(0, false)`); await c.sleep(400);
t = await J(`(() => { document.querySelector('.dk-quizt').click(); const k = document.querySelector('#quiz .quiz-card').getBoundingClientRect(); return { deck: HBCards.isOpen(), cardTop: Math.round(k.top), view: localStorage.getItem('hb-view-v1') }; })()`);
check('the quiz tile takes you straight to the first question (one step), and Cards stays your choice', !t.deck && t.cardTop >= 60 && t.cardTop <= 110 && t.view === 'cards', JSON.stringify(t));
await open();
await openDeck({ cover: true });
check('with no audio on the device, the cover has no Listen tile (and the quiz tile is still there)', (await c.ev(`document.querySelector('.dk-listen').hidden && !document.querySelector('.dk-quizt').hidden`)) === true);
await open({ tts: true, prefs: { order: [], off: ['quiz'] } });
await openDeck({ cover: true });
check('with the quiz switched off, the cover has no quiz tile', (await c.ev(`document.querySelector('.dk-quizt').hidden`)) === true);
await open({ tts: true, dark: true });
await openDeck({ cover: true });
await c.shot(`${OUT}/cards_cover_dark.png`);

// ---------- 8e. audio: a round floating button that opens into a player ----------
await open({ tts: true });
await openDeck();
await c.ev(`document.querySelector('.dk-next').click()`); await c.sleep(900);
const FAB = `(() => { const r = (e) => { const x = e.getBoundingClientRect(); return { l: Math.round(x.left), r: Math.round(x.right), t: Math.round(x.top), b: Math.round(x.bottom), w: Math.round(x.width), h: Math.round(x.height) }; }; const ball = document.querySelector('.dk-fab-ball'), panel = document.querySelector('.dk-fab-panel'); return { ballShown: !ball.hidden && getComputedStyle(ball).display !== 'none', ball: r(ball), panelShown: !panel.hidden && getComputedStyle(panel).display !== 'none', panel: r(panel), acts: (document.querySelector('.dk-card:not([inert]) .dk-actions') ? r(document.querySelector('.dk-card:not([inert]) .dk-actions')) : null), track: r(document.querySelector('.dk-track')), w: innerWidth, expanded: ball.getAttribute('aria-expanded'), lbl: ball.getAttribute('aria-label'), pagePlayer: document.querySelector('.hb-player') ? getComputedStyle(document.querySelector('.hb-player')).display : 'none' }; })()`;
t = await J(FAB);
check('with audio available, a round button floats over the cards (a circle, at the right, above the card\'s buttons, inside the screen)', t.ballShown && !t.panelShown && t.ball.w === t.ball.h && t.ball.w >= 52 && t.ball.r <= t.w - 8 && t.ball.b <= t.acts.t && t.ball.t > t.track.t && t.expanded === 'false' && /Audio/.test(t.lbl), JSON.stringify(t));
await c.shot(`${OUT}/cards_fab_collapsed.png`);
await c.ev(`document.querySelector('.dk-fab-ball').click()`); await c.sleep(300);
t = await J(FAB);
check('tapping it opens a small player (Audio, "Listen to today\'s brief", a play button) in the same corner, inside the screen and clear of the card buttons', !t.ballShown && t.panelShown && t.panel.r <= t.w && t.panel.l >= 0 && t.panel.b <= t.acts.t && (await c.ev(`document.querySelector('.dk-fp-title').textContent`)) === 'Listen to today’s brief' && (await c.ev(`!!document.querySelector('.dk-fp-play')`)), JSON.stringify(t));
await c.shot(`${OUT}/cards_fab_open_idle.png`);
await c.ev(`document.querySelector('.dk-fp-collapse').click()`); await c.sleep(200);
t = await J(FAB);
check('the arrow collapses it back to the round button', t.ballShown && !t.panelShown);
await c.ev(`document.querySelector('.dk-fab-ball').click()`); await c.sleep(200);
await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await c.sleep(200);
t = await J(FAB);
check('Esc closes the player panel first (the deck stays); the next Esc leaves the deck', t.ballShown && !t.panelShown && (await c.ev(`HBCards.isOpen()`)));
await c.ev(`document.querySelector('.dk-fab-ball').click()`); await c.sleep(200);
await c.ev(`${SLOW} document.querySelector('.dk-fp-play').click()`); await waitFor(`HBListen.state() === 'playing'`, 4000);
await c.sleep(2100);
t = await J(FAB);
check('starting the audio from the idle panel plays it and tucks the panel away, leaving the round button (now pulsing, with sound bars)', (await c.ev(`HBListen.state()`)) === 'playing' && t.ballShown && !t.panelShown && (await c.ev(`document.querySelector('.dk-fab').classList.contains('playing') && getComputedStyle(document.querySelector('.dk-eq')).display !== 'none'`)), JSON.stringify(t));
check('the page\'s own mini player is not shown over the cards (its controls live in the round button)', t.pagePlayer === 'none', t.pagePlayer);
await c.ev(`document.querySelector('.dk-fab-ball').click()`); await c.sleep(300);
t = await J(`({ lane: document.querySelector('.dk-fp-lane').textContent, title: document.querySelector('.dk-fp-title').textContent, sub: document.querySelector('.dk-fp-sub').textContent, prev: !document.querySelector('.dk-fp-ctl .dk-fp-b:nth-child(1)').hidden, next: !document.querySelector('.dk-fp-ctl .dk-fp-b:nth-child(3)').hidden, rate: !document.querySelector('.dk-fp-rate').hidden, stop: !document.querySelector('.dk-fp-stop').hidden, plTitle: document.querySelector('.hb-player .hb-pl-title').textContent, plLane: document.querySelector('.hb-player .hb-pl-lane').textContent, cur: HBListen.current().id })`);
check('open while playing, the panel shows what is being read, with previous, pause, next, speed and stop, matching Listen\'s own player', t.title === t.plTitle && t.lane === t.plLane && t.prev && t.next && t.rate && t.stop && /Device voice|AI voice/.test(t.sub), JSON.stringify(t));
await c.shot(`${OUT}/cards_fab_open_playing.png`);
const before = await c.ev(`HBListen.current().id`);
await c.ev(`document.querySelector('.dk-fp-ctl .dk-fp-b:nth-child(3)').click()`); await c.sleep(700);
const after = await c.ev(`HBListen.current().id`);
check('Next in the panel moves Listen on, and the deck follows to it', before !== after && (await c.ev(cardKey)) === (after.startsWith('story:') ? after.slice(6) : 'section:AI & Tech'), JSON.stringify({ before, after, card: await c.ev(cardKey) }));
const rate0 = await c.ev(`document.querySelector('.dk-fp-rv').textContent`);
await c.ev(`document.querySelector('.dk-fp-rate .dk-fp-r:last-child').click()`); await c.sleep(300);
t = await J(`({ panel: document.querySelector('.dk-fp-rv').textContent, player: document.querySelector('.hb-player .hb-pl-rate-val').textContent })`);
check('the speed buttons work from the panel (Faster changes the speed, and the panel and Listen agree)', t.panel !== rate0 && t.panel === t.player, JSON.stringify({ rate0, ...t }));
await c.ev(`HBCards.goTo(HBCards.count() - 2, false)`); await c.sleep(500);
t = await J(`({ goto: !document.querySelector('.dk-fp-goto').hidden, txt: document.querySelector('.dk-fp-goto').textContent })`);
check('when you have wandered off the card being read, the panel offers "Show what\'s playing"', t.goto && /playing/.test(t.txt), JSON.stringify(t));
const playingCard = after.startsWith('story:') ? after.slice(6) : 'section:AI & Tech';
await c.ev(`document.querySelector('.dk-fp-goto').click()`); await c.sleep(1000);
check('and it takes you back to that card', (await c.ev(cardKey)) === playingCard, JSON.stringify({ playingCard, now: await c.ev(cardKey) }));
await c.ev(`document.querySelector('.dk-fp-play').click()`); await c.sleep(300);
check('pause works from the panel', (await c.ev(`HBListen.state()`)) === 'paused');
await c.ev(`document.querySelector('.dk-fp-stop').click()`); await c.sleep(500);
t = await J(FAB);
check('stop ends the audio and folds the panel away; the round button stays for next time', (await c.ev(`HBListen.state()`)) === 'idle' && t.ballShown && !t.panelShown);
await c.ev(`document.querySelector('.dk-tolist').click()`); await c.sleep(400);
await c.ev(`HBListen.start('quick')`); await waitFor(`HBListen.state() === 'playing'`, 4000);
check('on the list, the normal mini player is back', (await c.ev(`getComputedStyle(document.querySelector('.hb-player')).display !== 'none' && !document.querySelector('.hb-player').hidden`)) === true);
await c.ev(`HBListen.stop()`);
await open();
await openDeck({ cover: true });
check('with no audio on the device there is no round button at all', (await c.ev(`document.querySelector('.dk-fab').hidden`)) === true);
await open({ tts: true });
await openDeck({ cover: true });
await c.ev(`document.querySelector('.tab[data-tab=audio]').click()`); await waitFor(`!document.querySelector('.hb-hub').hidden`, 3000);
check('the round button steps aside while the full Audio screen is open', (await c.ev(`document.querySelector('.dk-fab').hidden`)) === true);
await c.ev(`document.querySelector('.hub-close').click()`); await c.sleep(400);
check('and returns when it closes', (await c.ev(`!document.querySelector('.dk-fab').hidden`)) === true);

// ---------- 9. layout ----------
for (const [w, h] of [[360, 740], [390, 844], [412, 915], [820, 1100]]) {
  await open({ width: w, height: h });
  await openDeck();
  await c.ev(`document.querySelector('.dk-next').click()`); await c.sleep(900);
  t = await J(`(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(), face = r('.dk-card:not([inert]) .dk-face'), tab = r('.tab-bar'), foot = r('.dk-foot'), acts = r('.dk-card:not([inert]) .dk-actions'), top = [...document.querySelectorAll('.dk-top button')].map((b) => { const x = b.getBoundingClientRect(); return { l: Math.round(x.left), r: Math.round(x.right), h: Math.round(x.height) }; }); return { faceL: Math.round(face.left), faceR: Math.round(face.right), w: innerWidth, sw: document.documentElement.scrollWidth, footBottom: Math.round(foot.bottom), tab: Math.round(tab.top), actsBottom: Math.round(acts.bottom), footTop: Math.round(foot.top), top, nav: [...document.querySelectorAll('.dk-nav')].map((b) => Math.round(b.getBoundingClientRect().height)), acts: [...document.querySelectorAll('.dk-card:not([inert]) .dk-act')].map((b) => { const x = b.getBoundingClientRect(); return { h: Math.round(x.height), l: Math.round(x.left), r: Math.round(x.right) }; }) }; })()`);
  check(`${w}px wide: the card, its buttons and the controls all fit inside the screen and above the tab bar`, t.faceL >= 0 && t.faceR <= t.w && t.sw <= t.w && t.footBottom <= t.tab + 2 && t.actsBottom <= t.footTop && t.top.every((b) => b.l >= 0 && b.r <= t.w && b.h >= 40) && t.nav.every((x) => x >= 44) && t.acts.length === 4 && t.acts.every((b) => b.h >= 44 && b.l >= 0 && b.r <= t.w), JSON.stringify(t));
}
await open({ size: 3, height: 780 });
await openDeck();
await c.ev(`document.querySelector('.dk-next').click()`); await c.sleep(900);
t = await J(`(() => { const sc = document.querySelector('.dk-card:not([inert]) .dk-scroll'), a = document.querySelector('.dk-card:not([inert]) .dk-actions').getBoundingClientRect(); return { over: sc.scrollHeight > sc.clientHeight, fs: getComputedStyle(document.querySelector('.dk-title')).fontSize, actsOk: a.bottom <= document.querySelector('.tab-bar').getBoundingClientRect().top, sw: document.documentElement.scrollWidth <= innerWidth }; })()`);
check('at the largest text size the story scrolls inside its card, the buttons stay in reach, and nothing spills sideways', t.over && t.actsOk && t.sw && parseFloat(t.fs) > 26, JSON.stringify(t));
await open({ dark: true });
await openDeck();
await c.ev(`document.querySelector('.dk-next').click()`); await c.sleep(900);
t = await J(`(() => { const f = document.querySelector('.dk-card:not([inert]) .dk-face'); return { bg: getComputedStyle(f).backgroundColor, ink: getComputedStyle(document.querySelector('.dk-title')).color, page: getComputedStyle(document.querySelector('.hb-deck')).backgroundColor }; })()`);
check('dark mode: a dark card on a dark page with light text', /^rgb\(26, 27, 32\)$/.test(t.bg) && /^rgb\(18, 19, 22\)$/.test(t.page) && t.ink !== t.bg, JSON.stringify(t));
await c.shot(`${OUT}/cards_dark.png`);
await open();
await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await c.ev(`(location.reload(), 'ok')`); await c.sleep(2000);
await openDeck();
await c.ev(`document.querySelector('.dk-next').click()`); await c.sleep(120);
check('with reduced motion on, moving between cards is instant', (await pos()) === `3 / ${TOTAL}` && (await c.ev(`document.querySelector('.dk-track').scrollLeft === 2 * document.querySelector('.dk-track').clientWidth`)) === true);
await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

// ---------- 10. nothing broke ----------
const errs = c.errors.filter((e) => !/r2\.dev|__audio|net::ERR|Failed to load resource|CORS/.test(e));
check('no script errors anywhere in the run', errs.length === 0, errs.join(' | '));

console.log(`\n${pass} passed, ${fail} failed · screenshots in ${OUT}`);
c.close();
server.close();
process.exit(fail ? 1 : 0);
