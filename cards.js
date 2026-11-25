/*
 * cards.js — the swipe-card reading view: the same stories, one per screen (phones and the apps).
 *
 * Loaded on demand by mobile.js (like listen.js). The vertical feed stays the source of truth: this file only reads
 * it, builds a deck of cards from it, and forwards taps (vote, save, share) to the feed's own buttons, so Listen,
 * votes, saves and shared links are untouched. Text is copied with textContent only, never as HTML (the two small
 * icons are cloned from the feed's own buttons).
 *
 * Deck: a cover card (title, tagline, the day's "before the news" quote), then for each section an intro card and one
 * card per story, in the reader's own section order (hidden sections skipped), then a closing card — always last —
 * offering the audio version and the quiz as two tiles (the quiz lane itself is not a card of its own: that would be
 * two cards making the same offer). A horizontal scroll-snap track, so swiping, momentum and snapping are the
 * browser's own. Audio is a floating round button that opens into a small player; the deck turns to whatever Listen
 * is reading.
 */
(function () {
  'use strict';
  if (window.HBCards) return;

  var VIEW_KEY = 'hb-view-v1';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canInert = 'inert' in HTMLElement.prototype;

  var deck = null, track = null, ui = {}, cards = [], idx = 0, shown = false;
  var lastTouch = 0, downAt = 0, lastScrollAt = 0, goal = null, goalAt = 0, goalMs = 0, returnFocus = null, scrollRaf = 0, settleT = 0, fixT = 0, syncRaf = 0;
  var mirrorObs = null, deckW = 0, playIdx = -1, lastFollowId = null, fabEl = null, fabOpen = false, fabAuto = 0, listenRaf = 0;
  var hasSwiped = false, idleT = 0, swipeHintEl = null, swipeHintT = 0, idxAtTouch = null;

  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function btn(cls, text, label) {
    var b = mk('button', cls, text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    return b;
  }
  // List or Cards lasts for this visit only (sessionStorage): every fresh open starts on the cards (owner, 2026-11-25).
  function setView(v) { try { sessionStorage.setItem(VIEW_KEY, v); } catch (e) { /* not remembered */ } }
  // A light tick as the scrubber crosses into a new card — the native plugin in the app, the Vibration API on the
  // phone web (Android only; iOS Safari has no equivalent, so it is simply silent there).
  function haptic() {
    try {
      var P = window.Capacitor && window.Capacitor.Plugins;
      if (P && P.Haptics) P.Haptics.impact({ style: 'LIGHT' });
      else if (navigator.vibrate) navigator.vibrate(8);
    } catch (e) { /* ignore */ }
  }
  function cloneInto(to, from) { Array.prototype.forEach.call(from.childNodes, function (n) { to.appendChild(n.cloneNode(true)); }); }
  function icon(paths, circles) {
    var ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    paths.forEach(function (d) { var p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); s.appendChild(p); });
    (circles || []).forEach(function (c) { var e = document.createElementNS(ns, 'circle'); e.setAttribute('cx', c[0]); e.setAttribute('cy', c[1]); e.setAttribute('r', c[2]); s.appendChild(e); });
    return s;
  }
  function svg(path) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2.4');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', path);
    s.appendChild(p);
    return s;
  }

  // ---- What the feed offers ----
  function laneShown(l) { return l && !l.hidden && !l.hasAttribute('data-pref-off') && l.style.display !== 'none'; }
  function laneName(lane) {
    var t = lane.querySelector('.lane-tag');
    if (!t) return lane.id;
    var c = t.cloneNode(true), tm = c.querySelector('.lane-time');
    if (tm) tm.remove();
    return c.textContent.trim() || lane.id;
  }
  function laneTime(lane) {
    var tm = lane.querySelector('.lane-tag .lane-time');
    return tm ? tm.textContent.replace(/^[\s·]+/, '').trim() : '';
  }
  function plain(node, dropLabel) {
    if (!node) return '';
    var c = node.cloneNode(true), l = c.querySelector('.takeaway-label');
    if (l && dropLabel) l.remove();
    return c.textContent.replace(/\s+/g, ' ').trim();
  }

  // One section only (owner, 2026-11-25: an Explore tile on Home "should not show the other sections"): its intro and
  // stories, then a closing card that offers the other sections as tiles, the whole brief, and the way back to Home.
  var laneOnly = null;
  function collect() {
    if (laneOnly && laneShown(laneOnly)) {
      var li = Array.prototype.slice.call(laneOnly.querySelectorAll('.item[data-story-id]'));
      if (li.length) {
        var ln = laneName(laneOnly), lo = [{ kind: 'intro', lane: laneOnly, name: ln, items: li, sec: 1, secTotal: 1, only: true }];
        li.forEach(function (it, i) { lo.push({ kind: 'story', lane: laneOnly, name: ln, item: it, n: i + 1, of: li.length }); });
        lo.push({ kind: 'more', lane: laneOnly, name: ln });
        return lo;
      }
    }
    laneOnly = null;
    var out = [{ kind: 'cover', name: 'The Hour Brief' }], lanes = [];
    // Sundays: the week's recap is a card of its own, and the deck starts on it (owner, 2026-11-22). mobile.js fetches it;
    // if it arrives after the deck is up, weeklyArrived() below adds it.
    var wk = window.HBWeeklyNow && window.HBWeeklyNow();
    if (wk) out.unshift({ kind: 'week', name: 'This week', w: wk });
    document.querySelectorAll('section.lane[id]').forEach(function (l) { if (laneShown(l)) lanes.push(l); });
    var secTotal = lanes.filter(function (l) { return l.id !== 'quiz' && l.querySelector('.item[data-story-id]'); }).length, sec = 0;
    lanes.forEach(function (lane) {
      if (lane.id === 'quiz') return;   // not a card of its own: the closing card already offers it as a tile
      var items = Array.prototype.slice.call(lane.querySelectorAll('.item[data-story-id]'));
      if (!items.length) return;
      sec += 1;
      var name = laneName(lane);
      out.push({ kind: 'intro', lane: lane, name: name, items: items, sec: sec, secTotal: secTotal });
      items.forEach(function (it, i) { out.push({ kind: 'story', lane: lane, name: name, item: it, n: i + 1, of: items.length }); });
    });
    out.push({ kind: 'end', name: 'The Hour Brief' });   // always last now: the Listen and quiz tiles live here, not on the cover, so this card is never optional
    return out;
  }

  // ---- Cards ----
  function face(kind, label) {
    var card = mk('article', 'dk-card dk-' + kind);
    card.setAttribute('role', 'group');
    card.setAttribute('aria-roledescription', 'slide');
    card.setAttribute('aria-label', label);
    // .dk-card is three screens wide (its left two thirds overlap the cards before it and are empty); .dk-hold is the
    // screen-sized right third, position: sticky, and holds the face. See "Stacked deck" in app.css for why.
    var hold = mk('div', 'dk-hold');
    var f = mk('div', 'dk-face');
    var sc = mk('div', 'dk-scroll');
    sc.addEventListener('scroll', function () { fade(sc); }, { passive: true });
    f.appendChild(sc);
    hold.appendChild(f);
    card.appendChild(hold);
    card.appendChild(mk('div', 'dk-snap'));          // the scroll-snap point: exactly where this card rests
    return { card: card, face: f, scroll: sc };
  }
  // A card taller than the screen scrolls inside itself; a soft fade at the bottom says there is more.
  function fade(sc) { sc.classList.toggle('more', sc.scrollHeight - sc.scrollTop - sc.clientHeight > 6); }
  function fadeAll() { cards.forEach(function (c) { var sc = c.el && c.el.querySelector('.dk-scroll'); if (sc) fade(sc); }); }
  function heading(tag, cls, text) {
    var h = mk(tag, cls, text);
    h.tabIndex = -1;
    return h;
  }

  // The top of the page, as the first card: what the list opens with (edition, the quote, the intro, the audio version, the quiz).
  function editionLine() {
    var ed = document.querySelector('.edition');
    if (!ed) return '';
    var parts = ed.innerHTML.split(/<br\s*\/?>/i).map(function (x) { return x.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }).filter(Boolean);
    if (parts.length > 1) parts[1] = parts[1].replace(/\s+\d{4}$/, '');
    return parts.join(' · ');
  }
  var HEADPHONES = ['M4 15v-3a8 8 0 0 1 16 0v3', 'M4 15h3v5H5a1 1 0 0 1-1-1v-4z', 'M20 15h-3v5h2a1 1 0 0 0 1-1v-4z'];
  function tile(cls, iconEl, title) {
    var t = mk('div', 'dk-tile ' + cls);
    var ic = mk('span', 'dk-tile-ic');
    ic.appendChild(iconEl);
    var tx = mk('div', 'dk-tile-tx');
    tx.appendChild(mk('strong', '', title));
    tx.appendChild(mk('small'));
    t.appendChild(ic);
    t.appendChild(tx);
    return t;
  }

  // The cover: the edition line and the title (so it still reads as The Hour Brief, not a blank screen), then
  // "before the news" takes the rest of the card — no explainer paragraph, no Listen/quiz tiles (those live on the
  // closing card now, the "now that you've read it" moment, not here).
  function buildCover(c) {
    var b = face('cover', 'Introduction: today’s brief');
    var line = editionLine();
    c.line = line;
    b.scroll.appendChild(mk('p', 'dk-kick', line || 'Today'));
    // No "The Hour Brief" title here any more: the deck's header (see build()) already shows it, right above (owner,
    // 2026-11-18). The cover opens on the edition line, then the tagline.
    var tgSrc = document.querySelector('.tagline');
    if (tgSrc) b.scroll.appendChild(mk('p', 'dk-tagline', plain(tgSrc)));
    var qt = document.querySelector('.pause-text');
    if (qt) {
      var fig = mk('figure', 'dk-quote');
      var lab = document.querySelector('.pause-label');
      fig.appendChild(mk('p', 'dk-quote-label', lab ? plain(lab) : 'Before the news'));
      fig.appendChild(mk('blockquote', 'dk-quote-text', plain(qt)));
      var at = document.querySelector('.pause-attr');
      if (at) {
        var cap = mk('figcaption', 'dk-quote-by'), link = at.querySelector('a');
        cap.appendChild(document.createTextNode(plain(at).replace(link ? plain(link) : '', '').trim() + (link ? ' ' : '')));
        if (link && /^https?:/i.test(link.href)) {
          var a = mk('a', '', plain(link));
          a.href = link.href;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          cap.appendChild(a);
        }
        fig.appendChild(cap);
      }
      b.scroll.appendChild(fig);
    }
    var start = btn('dk-hint', 'See today’s stories');
    start.addEventListener('click', function () { goTo(cards.indexOf(c) + 1, true); });
    var bar = mk('div', 'dk-actions dk-startbar');
    bar.appendChild(start);
    b.face.appendChild(bar);
    return b.card;
  }

  // The Sunday recap: the week's five stories, each with why it mattered, then on to today's cover.
  var LANE_NAMES = { ai: 'AI & Tech', biz: 'Business', mkt: 'Stock Market' };
  function buildWeek(c) {
    var w = c.w, b = face('week', 'This week: ' + w.title);
    b.scroll.appendChild(mk('p', 'dk-kick', 'This week · ' + w.range));
    b.scroll.appendChild(heading('h2', 'dk-title dk-title-lg', w.title));
    if (w.intro) b.scroll.appendChild(mk('p', 'dk-week-intro', w.intro));
    var ol = mk('ol', 'dk-week-list');
    w.items.forEach(function (it) {
      var li = mk('li');
      var when = it.date ? new Date(it.date + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
      li.appendChild(mk('span', 'dk-week-meta', (LANE_NAMES[it.lane] || '') + (when ? ' · ' + when : '')));
      li.appendChild(mk('b', '', it.headline || ''));
      if (it.why) li.appendChild(mk('p', '', it.why));
      ol.appendChild(li);
    });
    b.scroll.appendChild(ol);
    var full = mk('a', 'dk-week-full', 'Open the full recap');
    full.href = w.url + '&src=app-cards';
    b.scroll.appendChild(full);
    var next = btn('dk-hint', 'Today’s brief');
    next.addEventListener('click', function () { goTo(cards.indexOf(c) + 1, true); });
    var bar = mk('div', 'dk-actions dk-startbar');
    bar.appendChild(next);
    b.face.appendChild(bar);
    return b.card;
  }
  // The recap came back after the deck was drawn: add its card, and start on it if the reader hasn't moved yet.
  function weeklyArrived() {
    if (!shown || laneOnly || cards.some(function (x) { return x.kind === 'week'; }) || !(window.HBWeeklyNow && window.HBWeeklyNow())) return;
    var atStart = idx === 0;
    render();
    goTo(atStart ? 0 : idx + 1, false);
  }
  if (window.HBWeekly) window.HBWeekly().then(function () { weeklyArrived(); });

  // The closing card's audio and quiz tiles follow Listen and the quiz chip, which are built a moment after the page.
  function syncClosing() {
    var c = cards[cards.length - 1];
    if (!c || c.kind !== 'end' || !c.listen) return;
    var cta = document.querySelector('.listen-cta'), g = document.querySelector('.listen-go'), L = window.HBListen;
    var ok = !!(cta && !cta.hidden && g);
    c.listen.el.hidden = !ok;
    if (ok) {
      var m = cta.querySelector('.listen-cta-btn[data-mode=quick] .hb-cta-min') || cta.querySelector('.listen-cta-btn .hb-cta-min');
      c.listen.el.querySelector('small').textContent = m ? m.textContent.trim() : '';
      c.listen.go.textContent = '';
      cloneInto(c.listen.go, g);
      c.listen.go.setAttribute('aria-label', g.getAttribute('aria-label') || 'Play today’s brief');
      c.listen.el.classList.toggle('playing', !!L && L.state && L.state() === 'playing');
    }
    var chip = document.querySelector('.quiz-chip'), qs = document.getElementById('quiz');
    if (chip && (getComputedStyle(chip).display === 'none' || !qs || qs.hidden || qs.hasAttribute('data-pref-off'))) chip = null;      // the quiz is off (or has nothing today)
    c.quiz.el.hidden = !chip;
    if (chip) {
      var t = chip.querySelector('.qc-title'), sub = chip.querySelector('.qc-sub'), go = chip.querySelector('.qc-go');
      c.quiz.el.querySelector('strong').textContent = t ? t.textContent.trim() : 'Today’s quiz';
      c.quiz.el.querySelector('small').textContent = sub ? sub.textContent.trim() : '';
      c.quiz.link.textContent = go ? go.textContent.trim() : 'Play →';
    }
  }

  // Just the section's own highlight now, not a list of every story's headline in it — the stories themselves are
  // the next cards, one at a time; repeating all their titles here first was the same "too much detail" complaint
  // the cover already got.
  function buildIntro(c) {
    var b = face('intro', c.only ? c.name : 'Section ' + c.sec + ' of ' + c.secTotal + ': ' + c.name);
    b.scroll.appendChild(mk('p', 'dk-kick', c.only ? 'Today’s ' + c.items.length + (c.items.length === 1 ? ' story' : ' stories') : 'Section ' + c.sec + ' of ' + c.secTotal));
    b.scroll.appendChild(heading('h2', 'dk-title dk-title-lg', c.name));
    var time = laneTime(c.lane);
    b.scroll.appendChild(mk('p', 'dk-metaline', (time ? time + ' · ' : '') + c.items.length + (c.items.length === 1 ? ' story' : ' stories')));
    // Plain running text, not the boxed "Takeaway" callout a story card gets — this is reading as the section's own
    // summary, not a pull-quote from within it, and a boxed label next to a lane name read oddly here.
    var tk = c.lane.querySelector('.lane-takeaway');
    if (tk) b.scroll.appendChild(mk('p', 'dk-body-lg', plain(tk, true)));
    var start = btn('dk-hint', 'Swipe to start');
    start.addEventListener('click', function () { goTo(idx + 1, true); });
    var bar = mk('div', 'dk-actions dk-startbar');       // pinned below the scrolling part, so it is always in reach
    bar.appendChild(start);
    b.face.appendChild(bar);
    return b.card;
  }

  function actionButtons(c, it) {
    var row = it.querySelector('.vote-row');
    var acts = mk('div', 'dk-actions');
    c.sync = [];
    function proxy(kind, real, build, sync) {
      if (!real) return;
      var b = btn('dk-act dk-' + kind);
      build(b, real);
      b.addEventListener('click', function () { real.click(); });
      acts.appendChild(b);
      c.sync.push(function () { sync(b, real); });
    }
    function vote(kind, on) {
      proxy(kind, row && row.querySelector('.vote-' + kind), function (b, real) {
        b.setAttribute('aria-label', real.getAttribute('aria-label') || kind);
        b.appendChild(mk('span', 'dk-emoji', kind === 'like' ? '👍' : '👎'));
        b.appendChild(mk('span', 'dk-n', '0'));
      }, function (b, real) {
        var n = real.querySelector('.vote-count');
        b.querySelector('.dk-n').textContent = n ? n.textContent : '0';
        b.classList.toggle('on', real.classList.contains(on));
        b.disabled = real.disabled;
      });
    }
    vote('like', 'voted-like');
    vote('dislike', 'voted-dislike');
    var save = row && row.querySelector('.story-save');
    proxy('save', save, function (b, real) { cloneInto(b, real); }, function (b, real) {
      var on = real.getAttribute('aria-pressed') === 'true';
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', real.getAttribute('aria-label') || 'Save this story for later');
    });
    var share = row && row.querySelector('.story-share');
    proxy('share', share, function (b, real) {
      cloneInto(b, real);
      b.setAttribute('aria-label', real.getAttribute('aria-label') || 'Share this story');
    }, function () { /* nothing to mirror */ });
    c.sync.forEach(function (f) { f(); });
    return acts;
  }

  function buildStory(c) {
    var it = c.item, h3 = it.querySelector('h3');
    var headline = h3 ? h3.textContent.trim() : '';
    var b = face('story', 'Story ' + c.n + ' of ' + c.of + ' in ' + c.name);
    b.card.setAttribute('data-id', it.getAttribute('data-story-id'));
    b.scroll.appendChild(mk('p', 'dk-kick', c.name + ' · Story ' + c.n + ' of ' + c.of));   // now the only place a story names its section, with the header gone
    var art = window.HBStoryArtSrc && window.HBStoryArtSrc(it);       // the list's default picture for this story (mobile.js)
    if (art) { var im = mk('img', 'dk-art'); im.src = art; im.alt = ''; im.decoding = 'async'; b.scroll.appendChild(im); }
    b.scroll.appendChild(heading('h3', 'dk-title', headline));
    var paras = it.querySelectorAll('.story-body > p');
    if (!paras.length) paras = it.querySelectorAll(':scope > div > p:not(.takeaway)');
    var body = mk('div', 'dk-body');
    Array.prototype.forEach.call(paras, function (p) { body.appendChild(mk('p', p.classList.contains('correction') ? 'correction' : '', plain(p))); });   // a "Corrected" note keeps its look
    b.scroll.appendChild(body);
    var tk = it.querySelector('.takeaway');
    if (tk) {
      var t = mk('p', 'dk-take');
      t.appendChild(mk('span', 'takeaway-label', 'Takeaway'));
      t.appendChild(document.createTextNode(' ' + plain(tk, true)));
      b.scroll.appendChild(t);
    }
    var src = it.querySelector('.src a');
    if (src && /^https?:/i.test(src.href)) {
      var row = mk('p', 'dk-src');
      var a = mk('a', '', src.textContent.replace(/\s*→\s*$/, '').trim() + ' →');
      a.href = src.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      row.appendChild(a);
      b.scroll.appendChild(row);
    }
    b.face.appendChild(actionButtons(c, it));
    return b.card;
  }

  // The closing card: always the last one in the deck now (see collect()), so it is where the Listen and quiz tiles
  // live, not up on the cover — the cover is just "before the news" now, this is the "now that you've read it" card.
  function buildMore(c) {
    var b = face('end dk-more', 'The end of ' + c.name);
    b.scroll.appendChild(mk('p', 'dk-kick', 'That’s ' + c.name));
    b.scroll.appendChild(heading('h2', 'dk-title dk-title-lg', 'Explore another section'));
    var grid = mk('div', 'dk-more-grid');
    document.querySelectorAll('section.lane[id]').forEach(function (l) {
      if (l === c.lane || l.id === 'quiz' || !laneShown(l)) return;
      var n = l.querySelectorAll('.item[data-story-id]').length;
      if (!n) return;
      var t = btn('dk-more-tile dk-more-' + (['ai', 'biz', 'mkt'].filter(function (k) { return l.classList.contains(k); })[0] || 'ai'));
      t.appendChild(mk('strong', '', laneName(l)));
      t.appendChild(mk('small', '', n + (n === 1 ? ' story' : ' stories')));
      t.addEventListener('click', function () { showLane(l); });
      grid.appendChild(t);
    });
    var all = btn('dk-more-tile dk-more-all');
    all.appendChild(mk('strong', '', 'The whole brief'));
    all.appendChild(mk('small', '', 'Every section, from the top'));
    all.addEventListener('click', function () { showLane(null); });
    grid.appendChild(all);
    b.scroll.appendChild(grid);
    var home = btn('dk-cta', 'Back to Home');
    home.addEventListener('click', backHome);
    b.scroll.appendChild(home);
    return b.card;
  }
  function backHome() { var HC = window.HBChrome; if (HC && HC.tab) HC.tab('home'); else close({ keep: true }); }
  // Switch the open deck to one section (or, with null, the whole brief) and start at its first card.
  function showLane(l) {
    laneOnly = l || null;
    render();
    syncBack();
    goTo(0, false);
    fadeAll();
    paint();
    announce();
  }
  // In one section the header's left button goes back to Home (where the Explore tiles are); otherwise it is the logo.
  function syncBack() {
    if (!ui.head) return;
    var on = !!laneOnly;
    if (ui.homeBack) ui.homeBack.hidden = !on;
    if (ui.logo) ui.logo.hidden = on;
  }

  function buildEnd(c) {
    var b = face('end', 'The end of today’s brief');
    b.scroll.appendChild(mk('p', 'dk-kick', 'That’s the brief'));
    b.scroll.appendChild(heading('h2', 'dk-title dk-title-lg', 'You’re all caught up'));
    b.scroll.appendChild(mk('p', 'dk-body-lg', 'That is everything for today. Try the quiz, or listen back to the brief.'));

    var lt = tile('dk-listen', icon(HEADPHONES), 'Listen to today’s brief');      // shown once Listen is ready (it loads a moment after the page)
    lt.hidden = true;
    var go = btn('dk-tile-go');
    go.addEventListener('click', function () {
      var g = document.querySelector('.listen-go');
      if (g) g.click();
      setFab(true);   // open into the player's own controls, not just start it silently
    });
    lt.appendChild(go);
    c.listen = { el: lt, go: go };
    b.scroll.appendChild(lt);

    var qtile = tile('dk-quizt', icon(['M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z', 'M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z']), 'Today’s quiz');
    qtile.hidden = true;
    var qgo = mk('span', 'dk-tile-link');
    qtile.appendChild(qgo);
    qtile.setAttribute('role', 'button');
    qtile.tabIndex = 0;
    function toQuiz() { close({ keep: true, to: document.querySelector('#quiz .quiz-card') || document.getElementById('quiz') }); }
    qtile.addEventListener('click', toQuiz);
    qtile.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toQuiz(); } });
    c.quiz = { el: qtile, link: qgo };
    b.scroll.appendChild(qtile);

    // Website only: the moment someone has read the whole brief is the best time to offer it every morning.
    var G = window.HBGrowth, ap = G && G.appPrompt && G.appPrompt('end-card', 'Get tomorrow’s brief at 8am', 'Free app: a morning nudge, offline reading and audio');
    if (ap) b.scroll.appendChild(ap);

    var back = btn('dk-cta', 'Back to the list');
    back.addEventListener('click', function () { close(); });
    b.scroll.appendChild(back);
    return b.card;
  }

  // ---- The deck ----
  function build() {
    if (deck) return;
    deck = mk('section', 'hb-deck' + (sda && !reduceMotion ? ' dk-sda' : ''));
    deck.hidden = true;
    deck.setAttribute('role', 'region');
    deck.setAttribute('aria-roledescription', 'carousel');
    deck.setAttribute('aria-label', 'Today’s stories, one card at a time');

    // The app header, the same one Audio and Challenge show (logo, wordmark, Saved, Menu; mobile.js's HBChrome does
    // the work). Cards ran without it for a while to give the card the most room; the owner asked to try it back
    // (2026-11-18), so Today looks like the other screens. The List/Cards switch sits just under it (--dk-head-h).
    var HC = window.HBChrome;
    var head = ui.head = mk('header', 'hub-top dk-head');
    var logo = mk('img', 'ab-logo');
    logo.src = '/brand/logo-128.png';
    logo.alt = '';
    logo.width = logo.height = 34;
    var brand = mk('div', 'ab-brand');
    var word = mk('div', 'wordmark');
    word.innerHTML = 'The Hour <span>Brief</span>';
    brand.appendChild(word);
    var acts = mk('div', 'ab-actions');
    var saved = btn('ab-btn reader-saved', '', 'Saved stories');
    saved.innerHTML = (HC ? HC.icons.star : '') + '<span class="rd-count"></span>';
    saved.addEventListener('click', function () { if (HC) HC.saved(saved); });
    var menu = btn('ab-btn ab-menu', '', 'Menu: past editions, sections, text size, reminder, share');
    menu.innerHTML = HC ? HC.icons.sliders : '';
    menu.addEventListener('click', function () { if (HC) HC.menu(menu); });
    acts.appendChild(saved);
    acts.appendChild(menu);
    // A past edition: a back arrow (to Past editions) where the logo sits, as on the list (mobile.js HBChrome.back).
    var back = HC && HC.back && HC.back();
    if (back) {
      var bb = btn('ab-btn ab-back', '', back.label);
      bb.innerHTML = HC.icons.back;
      bb.addEventListener('click', back.go);
      logo = bb;
    }
    ui.logo = logo;
    var hb = ui.homeBack = btn('ab-btn ab-back dk-home-back', '', 'Back to Home');
    hb.innerHTML = HC ? HC.icons.back : '';
    hb.hidden = true;
    hb.addEventListener('click', backHome);
    head.appendChild(hb);
    head.appendChild(logo);
    head.appendChild(brand);
    head.appendChild(acts);
    deck.appendChild(head);
    if (window.ResizeObserver) new ResizeObserver(syncHeadH).observe(head);

    track = mk('div', 'dk-track');
    track.tabIndex = 0;
    track.setAttribute('aria-label', 'Swipe or use the arrow keys to move between cards');
    deck.appendChild(track);

    // Bottom pager (owner's call, 2026-11-18): previous arrow, "Section · 3 / 12", next arrow. Replaces the scrubber bar
    // (a dot sliding from the first card to the last) and the small arrows that used to sit on the card's edges.
    var foot = ui.foot = mk('footer', 'dk-foot dk-pager');
    ui.prev = btn('dk-nav dk-prev', '', 'Previous card');
    ui.prev.appendChild(svg('M15 5l-7 7 7 7'));
    ui.count = mk('span', 'dk-count');
    ui.next = btn('dk-nav dk-next', '', 'Next card');
    ui.next.appendChild(svg('M9 5l7 7-7 7'));
    ui.live = mk('div', 'dk-live');
    ui.live.setAttribute('role', 'status');
    ui.live.setAttribute('aria-live', 'polite');
    foot.appendChild(ui.prev);
    foot.appendChild(ui.count);
    foot.appendChild(ui.next);
    deck.appendChild(foot);
    deck.appendChild(ui.live);
    document.body.appendChild(deck);
    if (HC && HC.refreshSaved) HC.refreshSaved();      // its count badge can only be filled once it's in the document
    buildFab();

    ui.prev.addEventListener('click', function () { onManualNav(); goTo(idx - 1, true); });
    ui.next.addEventListener('click', function () { onManualNav(); goTo(idx + 1, true); });
    track.addEventListener('scroll', onScroll, { passive: true });
    ['touchstart', 'pointerdown', 'wheel'].forEach(function (t) { deck.addEventListener(t, touched, { passive: true }); });
    ['touchstart', 'pointerdown'].forEach(function (t) { deck.addEventListener(t, function () { downAt = Date.now(); }, { passive: true }); });
    ['touchend', 'touchcancel', 'pointerup', 'pointercancel'].forEach(function (t) {
      deck.addEventListener(t, function () { downAt = 0; setTimeout(align, 350); setTimeout(align, 900); }, { passive: true });
    });
    // A second, independent way to notice a real swipe happened: compare which card was showing when the finger went
    // down on the track against which one is showing shortly after it lifts. This does not depend on onScroll firing
    // or on the goal/moving bookkeeping at all, so it still teaches the gesture even if a particular browser's scroll
    // events behave differently than expected.
    track.addEventListener('touchstart', function () { idxAtTouch = idx; }, { passive: true });
    track.addEventListener('touchend', function () {
      var started = idxAtTouch;
      idxAtTouch = null;
      setTimeout(function () { if (started !== null && idx !== started) onSwiped(); }, 500);
    }, { passive: true });
    watchSideSwipes();
    deck.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    document.addEventListener('hb:prefs', function () { if (shown) refresh(); });
    document.addEventListener('hb:hub', function () { if (shown) syncFab(); });
    document.addEventListener('hb:listen', function () { if (shown) onListenSoon(); });
  }

  function touched() { lastTouch = Date.now(); goal = null; cancelNudge(); }   // the reader has taken over: forget any move in progress
  // The header's height (safe area included), for placing the floating List/Cards switch just below it (app.css).
  function syncHeadH() {
    if (ui.head && ui.head.offsetHeight) document.documentElement.style.setProperty('--dk-head-h', ui.head.offsetHeight + 'px');
  }

  // A sideways swipe the track never got. On iPhone, while a card's text is still gliding after a flick up or down, the
  // next touch belongs to that text scroller, so a swipe to the next card made straight after scrolling went nowhere
  // (owner, 2026-11-18). If a clearly sideways swipe ends and the track didn't move at all, make the move here. Any
  // scroll of the track since the finger went down means the browser handled it, and then this does nothing.
  function watchSideSwipes() {
    var sw = null;
    function sideScroller(el) {                           // something inside the card that scrolls sideways itself (a wide table)
      for (; el && el !== track; el = el.parentElement) {
        if (el.scrollWidth > el.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowX)) return true;
      }
      return false;
    }
    track.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      sw = e.touches.length === 1 && t && !sideScroller(e.target) ?
        { x: t.clientX, y: t.clientY, lx: t.clientX, ly: t.clientY, at: Date.now(), left: track.scrollLeft, from: idx } : null;
    }, { passive: true });
    track.addEventListener('touchmove', function (e) {
      var t = e.touches[0];
      if (!sw) return;
      if (e.touches.length > 1 || !t) { sw = null; return; }
      sw.lx = t.clientX; sw.ly = t.clientY;
    }, { passive: true });
    function end() {
      var s = sw;
      sw = null;
      if (!s) return;
      var dx = s.lx - s.x, dy = s.ly - s.y;
      if (Math.abs(dx) < 48 || Math.abs(dx) < 2 * Math.abs(dy) || Date.now() - s.at > 900) return;
      var to = s.from + (dx < 0 ? 1 : -1);
      if (to < 0 || to >= cards.length) return;
      setTimeout(function () {                            // let any scroll events from a swipe the track did take arrive first
        if (lastScrollAt >= s.at || Math.abs(track.scrollLeft - s.left) > 2 || idx !== s.from || !shown) return;
        goTo(to, true);
        onSwiped();
      }, 90);
    }
    track.addEventListener('touchend', end, { passive: true });
    track.addEventListener('touchcancel', end, { passive: true });
  }

  // Swipe is the point of this view, so the prev/next buttons are trained wheels: full and visible until the reader
  // demonstrably swipes once (idx changing from the track's own scroll, not from goTo — see onScroll), at which point
  // they fade back rather than sit there as clutter. A button or key press always brings them back, since that reader
  // is clearly relying on them. Either way, if nothing moves for a while they return on their own, in case whoever is
  // reading has gotten stuck.
  function showNav() { if (ui.edgenav) ui.edgenav.classList.remove('dk-quiet'); }
  function quietNav() { if (hasSwiped && ui.edgenav) ui.edgenav.classList.add('dk-quiet'); }
  function armIdle() { clearTimeout(idleT); idleT = setTimeout(showNav, window.HB_CARD_IDLE_MS || 6000); }
  function onManualNav() { showNav(); armIdle(); }
  function onSwiped() {
    hasSwiped = true;
    quietNav();
    armIdle();
    dismissSwipeHint();
    nudgeDone();
  }

  var SWIPE_HINT_KEY = 'hb-swipe-hint-v1';
  function swipeHintSeen() { try { return !!localStorage.getItem(SWIPE_HINT_KEY); } catch (e) { return true; } }   // can't remember it: don't keep showing it
  function dismissSwipeHint() {
    clearTimeout(swipeHintT);
    if (swipeHintEl) { swipeHintEl.remove(); swipeHintEl = null; }
  }
  function maybeShowSwipeHint() {
    // The cover and each section card already carry their own "swipe to start" prompt; this one is for the first
    // story card, which has none, so it is keyed to the card kind rather than a fixed index.
    var c = cards[idx];
    if (!shown || swipeHintEl || hasSwiped || !c || c.kind !== 'story' || swipeHintSeen()) return;
    try { localStorage.setItem(SWIPE_HINT_KEY, '1'); } catch (e) { /* shown once is enough either way */ }
    showSwipeHint('Swipe to continue', 4000);
  }
  function showSwipeHint(text, ms) {
    dismissSwipeHint();
    swipeHintEl = mk('div', 'dk-swipehint');
    swipeHintEl.setAttribute('role', 'status');
    var ic = mk('span', 'dk-swipehint-ic');
    ic.appendChild(svg('M15 5l-7 7 7 7'));
    swipeHintEl.appendChild(ic);
    swipeHintEl.appendChild(mk('span', '', text));
    deck.appendChild(swipeHintEl);
    swipeHintT = setTimeout(dismissSwipeHint, ms);
  }

  function onKey(e) {
    touched();
    if (e.key === 'Escape') { e.preventDefault(); if (fabOpen) setFab(false); else close(); return; }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var k = e.key, i = null;
    if (k === 'ArrowRight') i = idx + 1;
    else if (k === 'ArrowLeft') i = idx - 1;
    else if (k === 'Home') i = 0;
    else if (k === 'End') i = cards.length - 1;
    else return;
    e.preventDefault();
    onManualNav();
    goTo(i, true);
  }

  function onResize() {
    if (!shown || !track) return;
    if (window.requestAnimationFrame) requestAnimationFrame(function () {
      if (shown && track.clientWidth !== deckW) { deckW = track.clientWidth; track.scrollLeft = cardLeft(idx); }
      if (shown) { fadeAll(); positionFab(); stack(); }
    });
  }

  function indexOfStory(id) {
    for (var i = 0; i < cards.length; i++) if (cards[i].kind === 'story' && cards[i].item.getAttribute('data-story-id') === id) return i;
    return -1;
  }
  function indexOfLane(id) {
    for (var i = 0; i < cards.length; i++) if (cards[i].kind === 'intro' && cards[i].lane.id === id) return i;
    return -1;
  }
  // The story the reader has reached in the list, so reopening Cards resumes there instead of restarting at the
  // cover every time — close() already scrolls the list to match the card being read; this is the other direction,
  // for a reader who went List -> Cards -> List -> Cards without an explicit target (a shared link, Listen playing).
  // The story being read in the list: the last one whose top has reached the reading line, just under the sticky header
  // (logo bar + section chips). Measured, not a fixed number: the header grew on 2026-11-19 and a fixed 120px then picked
  // the story above the one in view, so List -> Cards resumed one story early.
  function readingLine() {
    var y = 0;
    ['.masthead-band', '.nav'].forEach(function (sel) {
      var e = document.querySelector(sel), r = e && e.getBoundingClientRect();
      if (r && r.height && r.top < 240 && r.bottom > y) y = r.bottom;
    });
    return (y || 72) + 48;
  }
  function listStoryId() {
    var items = document.querySelectorAll('.item[data-story-id]'), best = null, bestTop = -Infinity, line = readingLine();
    for (var k = 0; k < items.length; k++) {
      var top = items[k].getBoundingClientRect().top;
      if (top <= line && top > bestTop) { bestTop = top; best = items[k]; }
    }
    return best ? best.getAttribute('data-story-id') : null;
  }

  function render() {
    cards = collect();
    track.textContent = '';
    cards.forEach(function (c, i) {
      c.el = c.kind === 'week' ? buildWeek(c) : c.kind === 'cover' ? buildCover(c) : c.kind === 'intro' ? buildIntro(c) : c.kind === 'story' ? buildStory(c) : c.kind === 'more' ? buildMore(c) : buildEnd(c);
      c.el.style.zIndex = String(cards.length - i);      // stacked deck: every card sits above the ones after it (fixed, never animated)
      track.appendChild(c.el);
    });
    watchMirror();
    syncClosing();
    markPlaying();
    stack();
  }

  function paint() {
    var c = cards[idx];
    if (!c) return;
    var where = c.kind === 'cover' ? 'Cover' : c.kind === 'end' ? 'Wrap-up' : c.name;
    ui.count.textContent = where + ' · ' + (idx + 1) + ' / ' + cards.length;
    ui.prev.disabled = idx <= 0;
    ui.next.disabled = idx >= cards.length - 1;
    cards.forEach(function (x, i) {
      if (canInert) x.el.inert = i !== idx;
      else x.el.setAttribute('aria-hidden', String(i !== idx));
      // The cards waiting behind the current one are held on screen (sticky); only the next two are ever seen, so the
      // rest aren't drawn at all. Card idx+3 is still off-screen when this flips mid-swipe, so it never shows.
      x.el.classList.toggle('dk-far', i > idx + 2);
    });
    syncFab();
    maybeShowSwipeHint();
    // Where the reader is, for this visit: if the app reloads (Android can, after the phone is locked), the deck comes back
    // on this card (mobile.js deckTarget) instead of the start.
    try { sessionStorage.setItem('hb-deck-at', JSON.stringify({ id: c.kind === 'story' ? c.item.dataset.storyId : c.lane ? c.lane.id : '', lane: laneOnly ? laneOnly.id : '', d: location.pathname })); } catch (e) { /* not kept */ }
  }

  function announce() {
    var c = cards[idx];
    if (!c) return;
    var h = c.el.querySelector('.dk-title');
    ui.live.textContent = (c.el.getAttribute('aria-label') || '') + (h ? '. ' + h.textContent : '');
  }

  // Stacked deck (owner's call, 2026-11-18): the next card waits just behind the current one, a little smaller and lower so
  // it peeks out on the right; swiping slides the current card off with a slight tilt while the one behind rises into
  // place, and going back brings the earlier card in over the top. Swiping, the arrows and the keyboard work as before.
  // Where the browser supports scroll-driven animations (Chrome/Android WebView, Safari 26+), the whole effect is CSS
  // (.dk-sda in app.css), run by the browser in lockstep with the scroll, with no per-frame JavaScript at all. A JS
  // version driven by scroll events always trailed the finger by a frame, which read as a judder (owner, 2026-11-18).
  // Older browsers keep the JS version below, kept lean: only the cards near the screen, only values that changed.
  // Transforms go on each card's face, never on the .dk-card (the scroll-snap target: Chrome snaps to a transformed
  // target's moved box). Reduced motion: no effect at all.
  var sda = !!(window.CSS && CSS.supports && CSS.supports('animation-timeline: --dk') && CSS.supports('view-timeline-name: --dk'));
  var stacked = [];                                   // faces the JS fallback has styled, so it can clear them later
  // Same motion as the CSS keyframes (dk-stack in app.css), as a function of d = how many cards ahead of the screen this
  // one is. Where each card sits is position: sticky's job (see app.css), so this only adds the small drop, shrink and
  // tilt: a frame of lag in those is invisible, unlike the sideways shift the old version had to keep up with.
  function stack() {
    if (!track || !cards.length || reduceMotion || sda) return;
    var w = track.clientWidth || 1, pos = track.scrollLeft / w;
    var lo = Math.max(0, Math.floor(pos) - 1), hi = Math.min(cards.length - 1, Math.ceil(pos) + 3), now = [];
    for (var i = lo; i <= hi; i++) {
      var c = cards[i], face = c.face || (c.face = c.el.querySelector('.dk-face'));
      if (!face) continue;
      var d = i - pos, t = '', op = '', k;
      if (d >= 2) {                                       // two or more ahead: further back, invisible
        t = 'translate3d(0,28px,0) scale(0.9)';
        op = '0';
      } else if (d > 1) {                                 // coming up behind the next card, fading in
        k = d - 1;
        t = 'translate3d(0,' + (14 + k * 14).toFixed(1) + 'px,0) scale(' + (0.95 - k * 0.05).toFixed(4) + ')';
        op = (1 - k).toFixed(3);
      } else if (d > 0) {                                 // next up, waiting just behind: peeks out at the bottom
        t = 'translate3d(0,' + (d * 14).toFixed(1) + 'px,0) scale(' + (1 - d * 0.05).toFixed(4) + ')';
      } else if (d < 0 && d >= -1.5) {                    // leaving (or coming back) over the top, tilting a little
        t = 'rotate(' + (d * 4).toFixed(2) + 'deg)';
      }
      if (face.style.transform !== t) face.style.transform = t;
      if (face.style.opacity !== op) face.style.opacity = op;
      var hint = t ? 'transform' : '';
      if (face.style.willChange !== hint) face.style.willChange = hint;
      now.push(face);
    }
    stacked.forEach(function (f) {                        // cards that drifted out of range go back to rest
      if (now.indexOf(f) < 0) { f.style.transform = ''; f.style.opacity = ''; f.style.willChange = ''; }
    });
    stacked = now;
  }

  function onScroll() {
    lastScrollAt = Date.now();
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(function () {
      scrollRaf = 0;
      stack();
      var w = track.clientWidth || 1, i = Math.round(track.scrollLeft / w);
      i = Math.max(0, Math.min(cards.length - 1, i));
      // While a move we started is still animating, the scroll position is between the old card and the new one: keep the
      // target as the current card (otherwise the header and markers flicker back to the old card for the first half).
      var moving = goal !== null && Date.now() - goalAt < goalMs;
      if (i !== idx && !moving) { idx = i; paint(); onSwiped(); }
      clearTimeout(settleT);
      settleT = setTimeout(function () { announce(); fadeAll(); align(); }, 200);
    });
  }

  // Where a card sits in the track (measured, because cards are a fraction of a pixel wider than the screen on some phones).
  // Layout offsets, not getBoundingClientRect: the stacked-deck transforms (stack()) move cards visually, and a measured
  // rect would include that shift and land the track between cards.
  function cardLeft(i) { return cards[i].el.offsetLeft - cards[0].el.offsetLeft; }
  function isDown() { return !!downAt && Date.now() - downAt < 10000; }
  // Chrome on Android sometimes ends a scroll on a snapping track a little past a card, or short of it, and leaves it
  // there. Once scrolling has stopped, sit the track exactly on a card (never while a finger is on it or still moving).
  function align() {
    if (!shown || !track || !cards.length || isDown() || Date.now() - lastScrollAt < 120) return;
    if (goal !== null && Date.now() - goalAt < goalMs) return;                  // a move we started is still expected to be running
    var w = track.clientWidth || 1, i = Math.max(0, Math.min(cards.length - 1, Math.round(track.scrollLeft / w)));
    var want = cardLeft(i);
    if (Math.abs(track.scrollLeft - want) > 2) track.scrollLeft = want;
  }
  function alignTo(i) {
    if (!shown || isDown() || Date.now() - lastScrollAt < 150 || Date.now() - lastTouch < 300) return;
    var want = cardLeft(i);
    if (Math.abs(track.scrollLeft - want) > 2) track.scrollLeft = want;
  }

  // Move to a card (smooth or instant), then make sure it arrived exactly.
  function goTo(i, smooth) {
    if (!track || !cards.length) return;
    i = Math.max(0, Math.min(cards.length - 1, i));
    var from = idx, animate = smooth && !reduceMotion && Math.abs(i - from) <= 2;   // a long jump (Home, End, a list item) is instant
    deckW = track.clientWidth;
    track.scrollTo({ left: cardLeft(i), top: 0, behavior: animate ? 'smooth' : 'auto' });
    idx = i;
    paint();
    if (!animate && window.requestAnimationFrame) requestAnimationFrame(stack);   // an instant jump fires no scroll frames
    goal = i;
    goalAt = Date.now();
    goalMs = animate ? 1100 : 100;
    clearTimeout(fixT);
    var tries = 0;
    (function check() {
      fixT = setTimeout(function () {
        if (Date.now() - lastScrollAt < 150 && ++tries < 5) return check();     // still moving (a slow phone): look again
        if (goal === i) { alignTo(i); goal = null; }
      }, goalMs + 100);
    })();
  }

  // ---- Keeping the deck and the feed in step ----
  function watchMirror() {
    if (mirrorObs) mirrorObs.disconnect();
    if (!window.MutationObserver) return;
    mirrorObs = new MutationObserver(function () {
      if (syncRaf) return;
      syncRaf = requestAnimationFrame(function () { syncRaf = 0; cards.forEach(function (c) { if (c.sync) c.sync.forEach(function (f) { f(); }); }); });
    });
    cards.forEach(function (c) {
      if (c.kind !== 'story') return;
      var row = c.item.querySelector('.vote-row');
      if (row) mirrorObs.observe(row, { subtree: true, childList: true, characterData: true, attributes: true });
    });
  }

  function refresh() {
    var cur = cards[idx], id = cur && cur.kind === 'story' ? cur.item.getAttribute('data-story-id') : null;
    render();
    var i = id ? indexOfStory(id) : -1;
    goTo(i >= 0 ? i : Math.min(idx, cards.length - 1), false);
    fadeAll();
  }

  // ---- Audio: a round floating button that opens into a small player, and the deck follows what Listen is reading ----
  // Everything is forwarded to Listen's own player and start button (they stay in the page, hidden while the deck shows), so
  // Listen, the Audio screen and this button can never disagree.
  function textOf(root, sel) { var e = root.querySelector(sel); return e ? e.textContent.trim() : ''; }
  function livePlayer() { var p = document.querySelector('.hb-player'); return p && !p.hidden ? p : null; }
  function hubOpen() { var L = window.HBListen; return !!(L && L.hubOpen && L.hubOpen()); }
  function click(root, sel) { var e = root && root.querySelector(sel); if (e && !e.disabled) e.click(); }

  function buildFab() {
    fabEl = mk('div', 'dk-fab');
    fabEl.hidden = true;
    ui.ball = btn('dk-fab-ball', '', 'Audio: open the player');
    ui.ball.setAttribute('aria-expanded', 'false');
    ui.ball.appendChild(icon(HEADPHONES));
    var eq = mk('span', 'dk-eq');
    eq.setAttribute('aria-hidden', 'true');
    for (var k = 0; k < 3; k++) eq.appendChild(mk('i'));
    ui.ball.appendChild(eq);
    ui.ball.addEventListener('click', function () { setFab(true); });

    ui.panel = mk('div', 'dk-fab-panel');
    ui.panel.hidden = true;
    ui.panel.setAttribute('role', 'group');
    ui.panel.setAttribute('aria-label', 'Audio player');
    var head = mk('div', 'dk-fp-head');
    ui.fLane = mk('span', 'dk-fp-lane');
    var col = btn('dk-fp-b dk-fp-collapse', '', 'Collapse the audio player');
    col.appendChild(icon(['M6 9l6 6 6-6']));
    col.addEventListener('click', function () { setFab(false); ui.ball.focus({ preventScroll: true }); });
    head.appendChild(ui.fLane);
    head.appendChild(col);
    ui.fTitle = mk('p', 'dk-fp-title');
    ui.fSub = mk('p', 'dk-fp-sub');
    var ctl = mk('div', 'dk-fp-ctl');
    ui.fPrev = btn('dk-fp-b', '', 'Previous story');
    ui.fPrev.addEventListener('click', function () { click(livePlayer(), '.hb-pl-prev'); });
    ui.fPlay = btn('dk-fp-b dk-fp-play', '', 'Play');
    ui.fPlay.addEventListener('click', function () {
      var p = livePlayer();
      if (p) { click(p, '.hb-pl-play'); return; }
      var g = document.querySelector('.listen-go');
      if (g) g.click();
      clearTimeout(fabAuto);
      fabAuto = setTimeout(function () { if (fabOpen) setFab(false); }, 1500);     // started from the idle panel: get out of the way of the cards
    });
    ui.fNext = btn('dk-fp-b', '', 'Next story');
    ui.fNext.addEventListener('click', function () { click(livePlayer(), '.hb-pl-next'); });
    ui.fRate = mk('div', 'dk-fp-rate');
    var slower = btn('dk-fp-r', '−', 'Slower');
    slower.addEventListener('click', function () { click(livePlayer(), '.hb-pl-rate-minus'); });
    ui.fRateVal = mk('span', 'dk-fp-rv');
    var faster = btn('dk-fp-r', '+', 'Faster');
    faster.addEventListener('click', function () { click(livePlayer(), '.hb-pl-rate-plus'); });
    ui.fRate.appendChild(slower);
    ui.fRate.appendChild(ui.fRateVal);
    ui.fRate.appendChild(faster);
    ui.fStop = btn('dk-fp-b dk-fp-stop', '', 'Stop listening and close the player');
    ui.fStop.addEventListener('click', function () { click(livePlayer(), '.hb-pl-close'); setFab(false); });
    [ui.fPrev, ui.fPlay, ui.fNext, ui.fRate, ui.fStop].forEach(function (e) { ctl.appendChild(e); });
    ui.fGoto = btn('dk-fp-goto', 'Show what’s playing');
    ui.fGoto.addEventListener('click', function () { if (playIdx >= 0) goTo(playIdx, true); });
    [head, ui.fTitle, ui.fSub, ctl, ui.fGoto].forEach(function (e) { ui.panel.appendChild(e); });
    fabEl.appendChild(ui.ball);
    fabEl.appendChild(ui.panel);
    // What a finger does here is about audio, not about the cards: it must not pause the deck following, or nudge its scrolling.
    ['touchstart', 'touchend', 'touchcancel', 'pointerdown', 'pointerup', 'pointercancel', 'wheel'].forEach(function (t) { fabEl.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: true }); });
    fabEl.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Escape' && fabOpen) { e.preventDefault(); setFab(false); ui.ball.focus({ preventScroll: true }); }
    });
    deck.appendChild(fabEl);
  }

  function setFab(open) {
    fabOpen = !!open;
    clearTimeout(fabAuto);
    syncFab();
    if (fabOpen) { try { ui.fPlay.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  // The button sits above the card's pinned buttons, at the right, so it never covers Like / Share / the footer.
  function positionFab() {
    if (!deck || !fabEl || fabEl.hidden || !track) return;
    var d = deck.getBoundingClientRect(), t = track.getBoundingClientRect(), c = cards[idx], acts = c && c.el.querySelector('.dk-actions');
    fabEl.style.bottom = Math.round((d.bottom - t.bottom) + 10 + (acts ? acts.getBoundingClientRect().height : 0) + 12) + 'px';
  }

  function syncFab() {
    if (!fabEl) return;
    var cta = document.querySelector('.listen-cta'), p = livePlayer();
    var off = !shown || !(p || (cta && !cta.hidden)) || hubOpen();
    fabEl.hidden = off;
    deck.classList.toggle('dk-has-fab', !off);
    if (off) return;
    var L = window.HBListen, playing = !!L && L.state && L.state() === 'playing';
    fabEl.classList.toggle('playing', playing);
    ui.ball.hidden = fabOpen;
    ui.panel.hidden = !fabOpen;
    ui.ball.setAttribute('aria-label', playing ? 'Audio: playing. Open the player' : 'Audio: open the player');
    ui.ball.setAttribute('aria-expanded', String(fabOpen));
    if (fabOpen) {
      var live = !!p, m = cta && cta.querySelector('.listen-cta-btn .hb-cta-min');
      ui.fLane.textContent = live ? textOf(p, '.hb-pl-lane') : 'Audio';
      ui.fTitle.textContent = live ? textOf(p, '.hb-pl-title') : 'Listen to today’s brief';
      ui.fSub.textContent = live ? textOf(p, '.hb-pl-voice') : (m ? m.textContent.trim() : '');
      ui.fSub.hidden = !ui.fSub.textContent;
      [ui.fPrev, ui.fNext, ui.fRate, ui.fStop].forEach(function (e) { e.hidden = !live; });
      var src = live ? p.querySelector('.hb-pl-play') : document.querySelector('.listen-go');
      if (src) { ui.fPlay.textContent = ''; cloneInto(ui.fPlay, src); ui.fPlay.setAttribute('aria-label', src.getAttribute('aria-label') || 'Play'); }
      if (live) {
        [[ui.fPrev, '.hb-pl-prev'], [ui.fNext, '.hb-pl-next'], [ui.fStop, '.hb-pl-close']].forEach(function (x) {
          var s2 = p.querySelector(x[1]);
          if (s2 && !x[0].firstChild) cloneInto(x[0], s2);
          if (s2) x[0].disabled = s2.disabled;
        });
        ui.fRateVal.textContent = textOf(p, '.hb-pl-rate-val');
      }
      ui.fGoto.hidden = !(live && playIdx >= 0 && playIdx !== idx);
    }
    positionFab();
  }

  // Which card holds the part Listen is reading: its introduction is the cover, a section its section card, a story its card,
  // and its closing lines the quiz card (or the last one).
  function unitIndex(cur) {
    var id = cur && cur.id || '';
    if (id === 'intro') return 0;
    if (id.indexOf('lane:') === 0) return indexOfLane(id.slice(5));
    if (id.indexOf('story:') === 0) return indexOfStory(id.slice(6));
    if (id === 'outro') return cards.length - 1;
    return -1;
  }
  function markPlaying() { cards.forEach(function (c, i) { if (c.el) c.el.classList.toggle('dk-playing', i === playIdx); }); }
  function listenNow() {
    var L = window.HBListen, st = L && L.state && L.state(), cur = L && L.current && L.current();
    return { live: st === 'playing' || st === 'paused', cur: cur };
  }
  // Runs whenever Listen changes state or moves to the next part: mirrors it here, and turns the deck to what is being read
  // (unless the reader has just been swiping, so it never fights a finger).
  function onListen() {
    if (!shown) return;
    syncClosing();
    var n = listenNow(), i = n.live ? unitIndex(n.cur) : -1;
    if (i !== playIdx) { playIdx = i; markPlaying(); }
    syncFab();
    if (!n.live) { lastFollowId = null; return; }
    if (!n.cur || n.cur.id === lastFollowId) return;
    lastFollowId = n.cur.id;
    if (i < 0 || i === idx || Date.now() - lastTouch < 4000) return;
    goTo(i, true);
  }
  function onListenSoon() { if (listenRaf) return; listenRaf = requestAnimationFrame(function () { listenRaf = 0; onListen(); }); }

  // ---- Open and close ----
  function open(o) {
    o = o || {};
    build();
    var wantLane = o.lane ? document.getElementById(o.lane) : null;
    if (wantLane && !laneShown(wantLane)) wantLane = null;
    if (shown) {
      if (wantLane !== laneOnly) { showLane(wantLane); if (!o.id) return true; }
      if (o.id) { var j = indexOfStory(o.id); if (j >= 0) goTo(j, true); }
      return true;
    }
    laneOnly = wantLane;
    syncBack();
    // The story being read in the list, measured BEFORE the deck opens: with hb-deck-open on the root the header stops
    // being sticky, so measuring afterwards misses it and resumes one story early.
    var readingId = listStoryId();
    render();
    if (!cards.some(function (c) { return c.kind === 'story'; })) return false;
    if (laneOnly) readingId = null;                   // one section: always from its start
    returnFocus = document.activeElement;
    deck.hidden = false;
    shown = true;
    document.documentElement.classList.add('hb-deck-open');
    syncHeadH();
    var i = -1;
    if (o.id) { i = indexOfStory(o.id); if (i < 0) i = indexOfLane(o.id); }
    var now = listenNow();
    if (now.live && now.cur) lastFollowId = now.cur.id;              // opening mid-play: start on it, then follow the NEXT part
    if (i < 0 && now.live) i = unitIndex(now.cur);
    if (i < 0 && readingId) i = indexOfStory(readingId);
    if (i < 0) i = 0;
    deckW = track.clientWidth;
    goTo(i, false);
    fadeAll();
    lastTouch = 0;
    downAt = 0;
    setView('cards');
    playIdx = -1;
    fabOpen = false;
    onListen();
    announce();
    armIdle();
    var h = cards[idx].el.querySelector('.dk-title');
    if (h) { try { h.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    document.dispatchEvent(new CustomEvent('hb:deck'));
    maybeNudge();
    return true;
  }

  // ---- First-run nudge (owner, 2026-11-18): show a new reader that the cards move by swiping ----
  // On opening Cards, the current card slides a little to the left and back, showing the next card waiting behind it,
  // with a "Swipe to flip through" pill. Again once more if they still haven't touched it. Shown on the first three
  // opens at most, and never again once they have swiped (onSwiped marks it done). The slide is a plain CSS animation
  // on .dk-hold, so it never touches the scroll position or the snap points. Reduced motion: the pill only.
  var NUDGE_KEY = 'hb-deck-nudge-v1', nudgeT = [], nudged = null;
  function nudgeCount() { try { var v = localStorage.getItem(NUDGE_KEY); return v === 'done' ? -1 : (parseInt(v, 10) || 0); } catch (e) { return -1; } }
  function nudgeDone() { try { localStorage.setItem(NUDGE_KEY, 'done'); } catch (e) { /* fine */ } cancelNudge(); }
  function cancelNudge() {
    nudgeT.forEach(clearTimeout);
    nudgeT = [];
    if (nudged) { nudged.classList.remove('dk-nudge'); nudged = null; }
  }
  function maybeNudge() {
    var n = nudgeCount();
    if (n < 0 || n >= 3 || hasSwiped || idx >= cards.length - 1) return;
    try { localStorage.setItem(NUDGE_KEY, String(n + 1)); } catch (e) { return; }
    var openedAt = lastTouch;
    function once(withPill) {
      if (!shown || hasSwiped || lastTouch !== openedAt) return;       // they've started on their own
      var hold = cards[idx] && cards[idx].el.querySelector('.dk-hold');
      if (!hold) return;
      if (withPill) showSwipeHint('Swipe to flip through the cards', 4200);
      if (reduceMotion) return;
      hold.classList.remove('dk-nudge');
      void hold.offsetWidth;                                             // restart the animation if it ran before
      hold.classList.add('dk-nudge');
      nudged = hold;
    }
    nudgeT.push(setTimeout(function () { once(true); }, 700));
    nudgeT.push(setTimeout(function () { once(false); }, 3400));
  }

  // An instant jump to an element. Not scrollIntoView({behavior:'instant'}): Chrome 113 (Android WebView) ignores that, eases
  // instead (the page's CSS is smooth) and can stop short. scrollTo with 'instant' does jump.
  function jumpTo(el, center) {
    var r = el.getBoundingClientRect(), margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    var top = r.top + window.pageYOffset - (center ? Math.max(margin, (window.innerHeight - r.height) / 2) : margin);
    window.scrollTo({ top: Math.max(0, top), left: 0, behavior: 'instant' });
  }

  // keep: leave the reader's saved choice (Cards) alone, because this is only a trip to the quiz or similar.
  // to: an element to land the list on (default: what was being read); center: put it mid-screen instead of at the top. The jump is instant, made in the same moment the
  // deck goes, so the reader sees one change of screen, never the feed scrolling past.
  function close(o) {
    o = o || {};
    if (!shown) return;
    var c = cards[idx];
    deck.hidden = true;
    shown = false;
    document.documentElement.classList.remove('hb-deck-open');
    fabOpen = false;
    clearTimeout(fabAuto);
    clearTimeout(idleT);
    dismissSwipeHint();
    cancelNudge();
    playIdx = -1;
    lastFollowId = null;
    if (fabEl) fabEl.hidden = true;
    deck.classList.remove('dk-has-fab');
    if (mirrorObs) mirrorObs.disconnect();
    if (!o.keep) setView('list');
    var target = o.to || (c && (c.kind === 'story' ? c.item : c.lane));
    if (target) jumpTo(target, o.center);
    document.dispatchEvent(new CustomEvent('hb:deck'));
    if (returnFocus && returnFocus.focus && document.contains(returnFocus)) { try { returnFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    returnFocus = null;
  }

  window.HBCards = {
    open: open,
    close: close,
    isOpen: function () { return shown; },
    goTo: function (i, smooth) { goTo(i, smooth !== false); },
    count: function () { return cards.length; },
    index: function () { return idx; }      // for capacitor-bridge.js: safe to switch editions only while still on the cover
  };
  document.dispatchEvent(new CustomEvent('hb:cards-ready'));
})();
