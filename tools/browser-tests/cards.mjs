// Browser test for the swipe-card reading view (cards.js + the hooks in mobile.js): the List | Cards switch, the deck's
// contents and order, real touch swipes, keyboard, tap forwarding (vote/save/share), Listen follow, deep links, the one-time
// nudge, and layout on small phones. Nothing here spends Sarvam credit (no recording is used).
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

const NATIVE = `window.Capacitor = { isNativePlatform: () => true, Plugins: {} };`;
const NO_AUDIO = `window.HB_AUDIO_BASE = ${JSON.stringify(B + '/__audio')}; delete window.speechSynthesis; delete window.SpeechSynthesisUtterance;`;
const d0 = new Date(), TODAY = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0');
const LONG_AGO = '2020-01-01';
const QUIET = { n: 0, last: LONG_AGO, done: true, cardsDone: true };     // no nudge
let ids = [];

async function open({ native = true, width = 390, height = 844, dark = false, prefs = null, tip = QUIET, view = null, size = null, hash = '', query = '', wait = 1800 } = {}) {
  for (const id of ids) await c.unpreload(id);
  ids = [];
  const pre = [NO_AUDIO];
  if (native) pre.push(NATIVE);
  for (const p of pre) ids.push(await c.preload(p));
  await c.viewport(width, height, width < 700, dark);
  await c.goto(B + '/about.html', 200);
  await c.ev(`localStorage.clear(); ${prefs ? `localStorage.setItem('hb-prefs-v1', ${JSON.stringify(JSON.stringify(prefs))});` : ''} ${tip ? `localStorage.setItem('hb-tip-v1', ${JSON.stringify(JSON.stringify(tip))});` : ''} ${view ? `localStorage.setItem('hb-view-v1', '${view}');` : ''} ${size != null ? `localStorage.setItem('hb-textsize', '${size}');` : ''} 'ok'`);
  await c.goto(B + '/' + query + hash, wait);
}
const cardsBtn = `document.querySelectorAll('.vs-in button')[1]`;
const openDeck = async () => { await c.ev(`${cardsBtn}.click()`); return waitFor(`!!window.HBCards && HBCards.isOpen()`, 4000); };
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
check('the deck is a section card, then its stories, for each section, then the quiz', k[0] === 'intro' && k[k.length - 1] === 'quiz' && k.filter((x) => x === 'intro').length === 3 && k.filter((x) => x === 'story').length === feedAll.length && !k.includes('end'), JSON.stringify(k));
check('the stories come in the feed\'s own order', eq(await storyIds(), feedAll));
t = await J(`(() => { const lane = document.querySelector('#ai'), card = document.querySelector('.dk-intro'); const lt = lane.querySelector('.lane-takeaway').cloneNode(true); lt.querySelector('.takeaway-label').remove(); return { title: card.querySelector('.dk-title').textContent, tag: lane.querySelector('.lane-tag').childNodes[0].textContent.trim(), meta: card.querySelector('.dk-metaline').textContent, take: card.querySelector('.dk-take').textContent.replace('Takeaway', '').trim(), want: lt.textContent.trim(), n: card.querySelectorAll('.dk-go').length, items: lane.querySelectorAll('.item[data-story-id]').length, kick: card.querySelector('.dk-kick').textContent }; })()`);
check('a section card shows its name, reading time and story count, its takeaway and a numbered list of its stories', t.title === t.tag && /min read · \d+ stories/.test(t.meta) && t.take === t.want && t.n === t.items && t.kick === 'Section 1 of 3', JSON.stringify(t));
await c.shot(`${OUT}/cards_intro.png`);
await c.ev(`document.querySelectorAll('.dk-intro .dk-go')[1].click()`); await c.sleep(900);
check('tapping a story in that list jumps to it', (await c.ev(`document.querySelector('.dk-sec-pos').textContent`)) === 'Story 2 of 7' && (await pos()) === '3 / 22', await pos());
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
check('a quiz the reader moved to the top stays where they put it, and a closing card is added at the end', t[0] === 'quiz' && t[t.length - 1] === 'end', JSON.stringify(t));
await open({ prefs: { order: [], off: ['quiz'] } });
await openDeck();
t = await kinds();
check('with the quiz switched off there is no quiz card, and the deck ends with a closing card', !t.includes('quiz') && t[t.length - 1] === 'end', JSON.stringify(t));

// ---------- 3. moving between cards ----------
await open();
await openDeck();
await c.swipe(195, 420, -250, 0); await c.sleep(800);
t = await J(`({ pos: document.querySelector('.dk-count').textContent, sl: Math.round(document.querySelector('.dk-track').scrollLeft), w: document.querySelector('.dk-track').clientWidth, sec: document.querySelector('.dk-sec-pos').textContent })`);
check('a real swipe to the left moves to the next card, snapped exactly to it', t.pos === '2 / 22' && t.sl === t.w && t.sec === 'Story 1 of 7', JSON.stringify(t));
await c.swipe(195, 420, 250, 0); await c.sleep(800);
check('a swipe to the right goes back', (await pos()) === '1 / 22');
await c.swipe(195, 420, -60, 0, 300); await c.sleep(800);
check('even a short flick moves on, never leaving two cards half-showing', (await pos()) === '2 / 22' && (await c.ev(`document.querySelector('.dk-track').scrollLeft % document.querySelector('.dk-track').clientWidth`)) === 0);
await c.ev(`document.querySelector('.dk-next').click()`); await c.sleep(800);
check('the Next button works (an alternative to swiping)', (await pos()) === '3 / 22');
await c.ev(`document.querySelector('.dk-prev').click()`); await c.sleep(800);
check('and Previous', (await pos()) === '2 / 22');
await c.ev(`document.querySelector('.dk-track').focus()`);
await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }); await c.sleep(800);
check('the right arrow key moves on', (await pos()) === '3 / 22');
await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 }); await c.sleep(1000);
t = await J(`({ pos: document.querySelector('.dk-count').textContent, next: document.querySelector('.dk-next').disabled, kind: document.querySelector('.dk-card:not([inert])').className })`);
check('End goes to the last card (the quiz), where Next is disabled', t.pos === '22 / 22' && t.next && /dk-quiz/.test(t.kind), JSON.stringify(t));
await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 }); await c.sleep(1000);
check('Home returns to the start, where Previous is disabled', (await pos()) === '1 / 22' && (await c.ev(`document.querySelector('.dk-prev').disabled`)) === true);
t = await J(`(() => { const all = [...document.querySelectorAll('.dk-card')]; return { inert: all.filter((x) => x.inert).length, n: all.length }; })()`);
check('only the card in view can be tabbed to or read by a screen reader (the others are inert)', t.inert === t.n - 1, JSON.stringify(t));
await c.ev(`document.querySelector('.dk-next').click()`); await c.sleep(1000);
t = await J(`({ live: document.querySelector('.dk-live').textContent, role: document.querySelector('.hb-deck').getAttribute('role'), rd: document.querySelector('.hb-deck').getAttribute('aria-roledescription'), label: document.querySelector('.dk-card:not([inert])').getAttribute('aria-label') })`);
check('it is announced as a carousel, and each card change is announced ("Story 1 of 7 in AI & Tech. headline")', t.role === 'region' && t.rd === 'carousel' && /^Story 1 of 7 in AI & Tech\. /.test(t.live) && /Story 1 of 7/.test(t.label), JSON.stringify(t));
await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await c.sleep(400);
check('Esc closes the deck and goes back to the list (and remembers List)', (await c.ev(`!HBCards.isOpen() && document.querySelector('.hb-deck').hidden && !document.documentElement.classList.contains('hb-deck-open')`)) && (await view()) === 'list');

// a scroll that stops short (seen in Android WebViews) is finished
await open();
await openDeck();
await c.ev(`Element.prototype.scrollTo = function (o) { if (o && typeof o === 'object' && o.left != null) this.scrollLeft = this.scrollLeft + (o.left - this.scrollLeft) * 0.4; }; 'ok'`);
await c.ev(`document.querySelector('.dk-next').click()`); await c.sleep(1200);
t = await J(`({ pos: document.querySelector('.dk-count').textContent, off: document.querySelector('.dk-track').scrollLeft - document.querySelector('.dk-track').clientWidth })`);
check('even if the browser stops the scroll partway, the card ends up exactly in place', t.pos === '2 / 22' && Math.abs(t.off) < 2, JSON.stringify(t));

// ---------- 4. long stories scroll inside the card ----------
await open({ height: 600 });
await openDeck();
await c.ev(`document.querySelector('.dk-next').click()`); await c.sleep(900);
t = await J(`(() => { const sc = document.querySelector('.dk-card:not([inert]) .dk-scroll'); return { over: sc.scrollHeight > sc.clientHeight + 20, more: sc.classList.contains('more'), overflowY: getComputedStyle(sc).overflowY }; })()`);
check('a story taller than the screen scrolls inside its card, with a fade at the bottom saying there is more', t.over && t.more && t.overflowY === 'auto', JSON.stringify(t));
await c.swipe(195, 320, 0, -320); await c.sleep(700);
t = await J(`(() => { const sc = document.querySelector('.dk-card:not([inert]) .dk-scroll'); return { top: Math.round(sc.scrollTop), pos: document.querySelector('.dk-count').textContent, actionsBottom: Math.round(document.querySelector('.dk-card:not([inert]) .dk-actions').getBoundingClientRect().bottom), tab: Math.round(document.querySelector('.tab-bar').getBoundingClientRect().top) }; })()`);
check('a vertical swipe scrolls that story (not the deck), and the buttons stay pinned in reach above the tab bar', t.top > 100 && t.pos === '2 / 22' && t.actionsBottom <= t.tab, JSON.stringify(t));
await c.swipe(195, 320, 0, -900); await c.sleep(700);
check('scrolled to the end of the story, the fade goes away (takeaway and source are visible)', (await c.ev(`!document.querySelector('.dk-card:not([inert]) .dk-scroll').classList.contains('more')`)) === true);
await c.swipe(195, 320, -250, 0); await c.sleep(800);
check('a sideways swipe on the same card still moves on', (await pos()) === '3 / 22');

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
await open();
await openDeck();
await c.ev(`document.querySelector('#ai-3').classList.add('hb-listening'); 'ok'`); await c.sleep(1200);
check('while a story is being read aloud, the deck turns to it', (await c.ev(`document.querySelector('.dk-card:not([inert])').getAttribute('data-id')`)) === 'ai-3');
await c.ev(`document.querySelector('#ai-3').classList.remove('hb-listening'); document.querySelector('.hb-deck').dispatchEvent(new Event('touchstart')); document.querySelector('#ai-5').classList.add('hb-listening'); 'ok'`); await c.sleep(1200);
check('but not right after the reader touched the deck themselves', (await c.ev(`document.querySelector('.dk-card:not([inert])').getAttribute('data-id')`)) === 'ai-3');
await open();
await c.ev(`document.querySelector('#mkt .lane-head').classList.add('hb-listening'); 'ok'`);
await openDeck();
check('opened while something is playing, it starts on what is being read (a section start opens on its section card)', (await c.ev(`document.querySelector('.dk-card:not([inert])').classList.contains('dk-intro') && document.querySelector('.dk-sec-name').textContent`)) === 'Stock Market');

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
await c.ev(`HBCards.goTo(3, false)`); await c.sleep(500);
const story3 = await c.ev(`document.querySelector('.dk-card:not([inert])').getAttribute('data-id')`);
await c.ev(`document.querySelector('.dk-tolist').click()`); await c.sleep(500);
t = await J(`({ top: Math.round(document.getElementById(${JSON.stringify(story3)}).getBoundingClientRect().top), deck: HBCards.isOpen() })`);
check('going back to the list lands on the story you were reading', !t.deck && t.top >= 0 && t.top < 140, JSON.stringify(t));
await open();
await openDeck();
await c.ev(`HBCards.goTo(HBCards.count() - 1, false)`); await c.sleep(600);
await c.ev(`document.querySelector('.dk-quiz .dk-cta').click()`); await c.sleep(1800);
t = await J(`({ deck: HBCards.isOpen(), quiz: Math.round(document.getElementById('quiz').getBoundingClientRect().top), view: localStorage.getItem('hb-view-v1') })`);
check('the quiz card takes you to the quiz in the list, and Cards stays your choice for next time', !t.deck && t.quiz >= 0 && t.quiz < 160 && t.view === 'cards', JSON.stringify(t));
await open();
await openDeck();
await c.ev(`document.querySelector('.tab[data-tab=quiz]').click()`); await c.sleep(1800);
check('the Challenge tab does the same from the deck', (await c.ev(`!HBCards.isOpen() && document.getElementById('quiz').getBoundingClientRect().top < 160`)) === true);
await open();
await openDeck();
await c.ev(`HBCards.goTo(4, false)`); await c.sleep(400);
await c.ev(`document.querySelector('.tab[data-tab=today]').click()`); await c.sleep(900);
check('the Today tab, while cards are showing, goes back to the first card', (await pos()) === '1 / 22');
check('while cards are showing, Today is the tab that is highlighted', (await c.ev(`document.querySelector('.tab[aria-current=page]').getAttribute('data-tab')`)) === 'today');
await open();
await openDeck();
await c.ev(`HBCards.goTo(2, false)`); await c.sleep(400);
await c.ev(`document.querySelector('#biz').setAttribute('data-pref-off', ''); document.querySelector('#biz').style.display = 'none'; document.dispatchEvent(new CustomEvent('hb:prefs')); 'ok'`); await c.sleep(500);
check('changing the section choices while the deck is open rebuilds it without that section, and keeps your place', eq(await secOrder(), ['AI & Tech', 'Stock Market']) && (await c.ev(`document.querySelector('.dk-card:not([inert])').getAttribute('data-id')`)) === 'ai-2', JSON.stringify(await secOrder()));

// ---------- 8. the nudge ----------
const fresh = { n: 0, last: LONG_AGO, done: false, cardsDone: false, secOn: '', cardsOn: '' };
await open({ tip: { ...fresh, n: 1 } });
check('day 2, no saved sections: the sections card comes first, and only that one', (await hasTip('sections')) && !(await hasTip('cards')) && (await c.ev(`document.querySelectorAll('.hb-tip').length`)) === 1);
await open({ tip: { ...fresh, n: 1, done: true, secOn: LONG_AGO } });
t = await J(`({ card: !!document.querySelector('.hb-tip[data-tip=cards]'), title: (document.querySelector('.hb-tip strong') || {}).textContent, btns: [...document.querySelectorAll('.hb-tip button')].map((b) => b.textContent), before: document.querySelector('.hb-tip') && document.querySelector('.hb-tip').nextElementSibling.tagName })`);
check('on a later day the Cards card appears ("Try swipe cards": Try / Not now), above the first section', t.card && t.title === 'Try swipe cards' && eq(t.btns, ['Try', 'Not now']) && t.before === 'SECTION', JSON.stringify(t));
await c.shot(`${OUT}/cards_nudge.png`);
await c.ev(`(location.reload(), 'ok')`); await c.sleep(1800);
check('it is still there if you reopen the app the same day', (await hasTip('cards')) === true);
await c.ev(`document.querySelector('.hb-tip-go').click()`); await c.sleep(1200);
t = await J(`({ deck: HBCards.isOpen(), tip: !!document.querySelector('.hb-tip'), state: JSON.parse(localStorage.getItem('hb-tip-v1')), view: localStorage.getItem('hb-view-v1') })`);
check('Try opens the deck, retires the card for good, and makes Cards the choice', t.deck && !t.tip && t.state.cardsDone === true && t.view === 'cards', JSON.stringify(t));
await open({ tip: { ...fresh, n: 1, done: true, secOn: LONG_AGO } });
await c.ev(`document.querySelector('.hb-tip-no').click()`); await c.sleep(200);
const st1 = await tipState();
await c.ev(`(() => { const o = JSON.parse(localStorage.getItem('hb-tip-v1')); o.last = '${LONG_AGO}'; o.cardsOn = '${LONG_AGO}'; localStorage.setItem('hb-tip-v1', JSON.stringify(o)); })()`);
await c.ev(`(location.reload(), 'ok')`); await c.sleep(1800);
check('Not now is final: not offered again on a later day', !(await hasTip()) && st1.cardsDone === true && (await view()) === null);
await open({ tip: { ...fresh, n: 1, done: true, secOn: LONG_AGO, cardsOn: LONG_AGO } });
check('a card that was shown on an earlier day and ignored does not come back', !(await hasTip()), JSON.stringify(await tipState()));
await open({ tip: { ...fresh, n: 1, secOn: LONG_AGO } });
check('the sections card is likewise shown through its first day only (ignoring it once is enough)', !(await hasTip('sections')), JSON.stringify(await tipState()));
await open({ prefs: { order: [], off: [] }, tip: { ...fresh, n: 1 } });
check('someone with saved sections (everyone before this update) gets the Cards card straight away instead', (await hasTip('cards')) && !(await hasTip('sections')));
await open({ tip: { ...fresh, n: 1, done: true }, view: 'cards' });
check('someone who already uses Cards is not offered them', !(await hasTip()));
await open({ tip: { ...fresh, n: 1, done: true } });
await c.ev(`${cardsBtn}.click()`); await c.sleep(1200);
check('opening Cards on your own also retires the card', (await tipState()).cardsDone === true && !(await hasTip()));
await open({ tip: { ...fresh, n: 1, done: true }, hash: '#ai-2' });
check('opened from a shared link: no card', !(await hasTip()));
await open({ tip: { ...fresh, n: 1, done: true }, query: '?utm_source=share' });
check('opened from a tracked share link: no card', !(await hasTip()));
await open({ native: false, tip: { ...fresh, n: 5, done: true } });
check('the website never shows it', !(await hasTip()) && eq(await tipState(), { ...fresh, n: 5, done: true }));
await open({ tip: { ...fresh, n: 0 } });
check('day 1 (a brand-new install): no card, one visit counted', !(await hasTip()) && (await tipState()).n === 1);

// ---------- 9. layout ----------
for (const [w, h] of [[360, 740], [390, 844], [412, 915], [820, 1100]]) {
  await open({ width: w, height: h });
  await openDeck();
  await c.ev(`document.querySelector('.dk-next').click()`); await c.sleep(900);
  t = await J(`(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(), face = r('.dk-card:not([inert]) .dk-face'), tab = r('.tab-bar'), foot = r('.dk-foot'), acts = r('.dk-card:not([inert]) .dk-actions'), top = [...document.querySelectorAll('.dk-top button')].map((b) => { const x = b.getBoundingClientRect(); return { l: Math.round(x.left), r: Math.round(x.right), h: Math.round(x.height) }; }); return { faceL: Math.round(face.left), faceR: Math.round(face.right), w: innerWidth, sw: document.documentElement.scrollWidth, footBottom: Math.round(foot.bottom), tab: Math.round(tab.top), actsBottom: Math.round(acts.bottom), footTop: Math.round(foot.top), top, nav: [...document.querySelectorAll('.dk-nav')].map((b) => Math.round(b.getBoundingClientRect().height)), acts: [...document.querySelectorAll('.dk-card:not([inert]) .dk-act')].map((b) => { const x = b.getBoundingClientRect(); return { h: Math.round(x.height), l: Math.round(x.left), r: Math.round(x.right) }; }) }; })()`);
  check(`${w}px wide: the card, its buttons and the controls all fit inside the screen and above the tab bar`, t.faceL >= 0 && t.faceR <= t.w && t.sw <= t.w && t.footBottom <= t.tab + 2 && t.actsBottom <= t.footTop && t.top.every((b) => b.l >= 0 && b.r <= t.w && b.h >= 40) && t.nav.every((x) => x >= 44) && t.acts.length === 4 && t.acts.every((b) => b.h >= 44 && b.l >= 0 && b.r <= t.w), JSON.stringify(t));
}
await open({ height: 700 });
await openDeck();
await c.ev(`document.body.classList.add('hb-listening'); 'ok'`); await c.sleep(300);
t = await J(`({ foot: Math.round(document.querySelector('.dk-foot').getBoundingClientRect().bottom), tab: Math.round(document.querySelector('.tab-bar').getBoundingClientRect().top) })`);
check('while listening, the deck leaves room for the mini player above the tab bar', t.foot <= t.tab - 80, JSON.stringify(t));
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
check('with reduced motion on, moving between cards is instant', (await pos()) === '2 / 22' && (await c.ev(`document.querySelector('.dk-track').scrollLeft === document.querySelector('.dk-track').clientWidth`)) === true);
await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

// ---------- 10. nothing broke ----------
const errs = c.errors.filter((e) => !/r2\.dev|__audio|net::ERR|Failed to load resource|CORS/.test(e));
check('no script errors anywhere in the run', errs.length === 0, errs.join(' | '));

console.log(`\n${pass} passed, ${fail} failed · screenshots in ${OUT}`);
c.close();
server.close();
process.exit(fail ? 1 : 0);
