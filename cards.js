/*
 * cards.js — the swipe-card reading view: the same stories, one per screen (phones and the apps).
 *
 * Loaded on demand by mobile.js (like listen.js). The vertical feed stays the source of truth: this file only reads
 * it, builds a deck of cards from it, and forwards taps (vote, save, share) to the feed's own buttons, so Listen,
 * votes, saves and shared links are untouched. Text is copied with textContent only, never as HTML (the two small
 * icons are cloned from the feed's own buttons).
 *
 * Deck: a cover card (the top of the page: edition, the quote, the intro, the audio version, the quiz), then for each
 * section an intro card and one card per story, in the reader's own section order (hidden sections skipped), with the quiz
 * where the reader put it and a closing card if the quiz is not last. A horizontal scroll-snap track, so swiping,
 * momentum and snapping are the browser's own. Audio is a floating round button that opens into a small player; the
 * deck turns to whatever Listen is reading.
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
  function setView(v) { try { localStorage.setItem(VIEW_KEY, v); } catch (e) { /* not remembered */ } }
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

  function collect() {
    var out = [{ kind: 'cover', name: 'The Hour Brief' }], lanes = [];
    document.querySelectorAll('section.lane[id]').forEach(function (l) { if (laneShown(l)) lanes.push(l); });
    var secTotal = lanes.filter(function (l) { return l.id !== 'quiz' && l.querySelector('.item[data-story-id]'); }).length, sec = 0;
    lanes.forEach(function (lane) {
      if (lane.id === 'quiz') { out.push({ kind: 'quiz', lane: lane, name: 'Quiz' }); return; }
      var items = Array.prototype.slice.call(lane.querySelectorAll('.item[data-story-id]'));
      if (!items.length) return;
      sec += 1;
      var name = laneName(lane);
      out.push({ kind: 'intro', lane: lane, name: name, items: items, sec: sec, secTotal: secTotal });
      items.forEach(function (it, i) { out.push({ kind: 'story', lane: lane, name: name, item: it, n: i + 1, of: items.length }); });
    });
    if (out[out.length - 1].kind !== 'quiz') out.push({ kind: 'end', name: 'The Hour Brief' });
    return out;
  }

  // ---- Cards ----
  function face(kind, label) {
    var card = mk('article', 'dk-card dk-' + kind);
    card.setAttribute('role', 'group');
    card.setAttribute('aria-roledescription', 'slide');
    card.setAttribute('aria-label', label);
    var f = mk('div', 'dk-face');
    var sc = mk('div', 'dk-scroll');
    sc.addEventListener('scroll', function () { fade(sc); }, { passive: true });
    f.appendChild(sc);
    card.appendChild(f);
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

  function buildCover(c) {
    var b = face('cover', 'Introduction: today’s brief');
    var line = editionLine();
    c.line = line;
    b.scroll.appendChild(mk('p', 'dk-kick', line || 'Today'));
    var h = heading('h2', 'dk-title dk-title-lg dk-wordmark');
    h.appendChild(document.createTextNode('The Hour '));
    h.appendChild(mk('span', '', 'Brief'));
    b.scroll.appendChild(h);
    var tag = document.querySelector('.tagline');
    if (tag) b.scroll.appendChild(mk('p', 'dk-metaline', plain(tag)));
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
    var lt = tile('dk-listen', icon(HEADPHONES), 'Listen to today’s brief');      // shown once Listen is ready (it loads a moment after the page)
    lt.hidden = true;
    var go = btn('dk-tile-go');
    go.addEventListener('click', function () { var g = document.querySelector('.listen-go'); if (g) g.click(); });
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

    var about = document.querySelector('.about > p');
    if (about) b.scroll.appendChild(mk('p', 'dk-intro-p', plain(about)));
    var free = document.querySelector('.about .free-line');
    if (free) b.scroll.appendChild(mk('p', 'dk-free', plain(free)));

    var start = btn('dk-hint', 'Start reading →');
    start.addEventListener('click', function () { goTo(1, true); });
    var bar = mk('div', 'dk-actions dk-startbar');
    bar.appendChild(start);
    b.face.appendChild(bar);
    return b.card;
  }

  // The cover's audio and quiz tiles follow Listen and the quiz chip, which are built a moment after the page.
  function syncCover() {
    var c = cards[0];
    if (!c || c.kind !== 'cover' || !c.listen) return;
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

  function buildIntro(c) {
    var b = face('intro', 'Section ' + c.sec + ' of ' + c.secTotal + ': ' + c.name);
    b.scroll.appendChild(mk('p', 'dk-kick', 'Section ' + c.sec + ' of ' + c.secTotal));
    b.scroll.appendChild(heading('h2', 'dk-title dk-title-lg', c.name));
    var time = laneTime(c.lane);
    b.scroll.appendChild(mk('p', 'dk-metaline', (time ? time + ' · ' : '') + c.items.length + (c.items.length === 1 ? ' story' : ' stories')));
    var tk = c.lane.querySelector('.lane-takeaway');
    if (tk) {
      var p = mk('p', 'dk-take');
      p.appendChild(mk('span', 'takeaway-label', 'Takeaway'));
      p.appendChild(document.createTextNode(' ' + plain(tk, true)));
      b.scroll.appendChild(p);
    }
    var ol = mk('ol', 'dk-list');
    c.items.forEach(function (it) {
      var h3 = it.querySelector('h3');
      if (!h3) return;
      var li = mk('li');
      var a = btn('dk-go', h3.textContent.trim());
      a.setAttribute('data-goto', it.getAttribute('data-story-id'));
      li.appendChild(a);
      ol.appendChild(li);
    });
    b.scroll.appendChild(ol);
    var start = btn('dk-hint', 'Swipe to start →');
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
    proxy('save', save, function (b, real) { cloneInto(b, real); b.appendChild(mk('span', 'dk-lb', 'Save')); }, function (b, real) {
      var on = real.getAttribute('aria-pressed') === 'true';
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', real.getAttribute('aria-label') || 'Save this story for later');
    });
    var share = row && row.querySelector('.story-share');
    proxy('share', share, function (b, real) {
      cloneInto(b, real);
      b.appendChild(mk('span', 'dk-lb', 'Share'));
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
    b.scroll.appendChild(heading('h3', 'dk-title', headline));
    var paras = it.querySelectorAll('.story-body > p');
    if (!paras.length) paras = it.querySelectorAll(':scope > div > p:not(.takeaway)');
    var body = mk('div', 'dk-body');
    Array.prototype.forEach.call(paras, function (p) { body.appendChild(mk('p', '', plain(p))); });
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

  function buildQuiz(c) {
    var chip = document.querySelector('.quiz-chip');
    var title = chip && chip.querySelector('.qc-title') ? chip.querySelector('.qc-title').textContent.trim() : 'Today’s quiz';
    var sub = chip && chip.querySelector('.qc-sub') ? chip.querySelector('.qc-sub').textContent.trim() : 'See what stuck.';
    var done = !!(chip && /review/i.test((chip.querySelector('.qc-go') || {}).textContent || ''));
    var b = face('quiz', 'The quiz');
    b.scroll.appendChild(mk('p', 'dk-kick', 'Challenge'));
    b.scroll.appendChild(heading('h2', 'dk-title dk-title-lg', title));
    b.scroll.appendChild(mk('p', 'dk-metaline', sub));
    b.scroll.appendChild(mk('p', 'dk-body-lg', done ? 'You have played today’s quiz. Look back at your answers, or keep your streak going tomorrow.' : 'Five quick questions on what you just read. It takes about a minute.'));
    var go = btn('dk-cta', done ? 'Review your answers' : 'Play the quiz');
    go.addEventListener('click', function () {
      // Hand over instantly, straight onto the question: the deck is replaced by the quiz in one step, with none of the feed scrolling past.
      close({ keep: true, to: document.querySelector('#quiz .quiz-card') || c.lane });
    });
    b.scroll.appendChild(go);
    return b.card;
  }

  function buildEnd() {
    var b = face('end', 'The end of today’s brief');
    b.scroll.appendChild(mk('p', 'dk-kick', 'That’s the brief'));
    b.scroll.appendChild(heading('h2', 'dk-title dk-title-lg', 'You’re all caught up'));
    b.scroll.appendChild(mk('p', 'dk-body-lg', 'That is everything for today. See you tomorrow.'));
    var go = btn('dk-cta', 'Back to the list');
    go.addEventListener('click', function () { close(); });
    b.scroll.appendChild(go);
    return b.card;
  }

  // ---- The deck ----
  function build() {
    if (deck) return;
    deck = mk('section', 'hb-deck');
    deck.hidden = true;
    deck.setAttribute('role', 'region');
    deck.setAttribute('aria-roledescription', 'carousel');
    deck.setAttribute('aria-label', 'Today’s stories, one card at a time');

    var top = mk('header', 'dk-top');
    var sec = mk('div', 'dk-sec');
    ui.secName = mk('span', 'dk-sec-name');
    ui.secPos = mk('span', 'dk-sec-pos');
    sec.appendChild(ui.secName);
    sec.appendChild(ui.secPos);
    top.appendChild(sec);
    var R = window.HBReader;                       // the app bar is under the deck, so Saved and the Menu (sections, text size, reminder, contact) live here too
    if (R && R.saved) {
      var sv = btn('dk-top-btn dk-ico dk-saved', '', 'Saved stories');
      sv.appendChild(icon(['M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z']));
      sv.addEventListener('click', function () { R.saved(); });
      top.appendChild(sv);
    }
    if (R && R.menu) {
      var mn = btn('dk-top-btn dk-ico dk-menu', '', 'Menu');
      mn.appendChild(icon(['M4 6h9', 'M17 6h3', 'M4 12h3', 'M11 12h9', 'M4 18h9', 'M17 18h3'], [[15, 6, 2], [9, 12, 2], [15, 18, 2]]));
      mn.addEventListener('click', function () { R.menu(); });
      top.appendChild(mn);
    }
    ui.list = btn('dk-top-btn dk-tolist', 'List', 'Back to the scrolling list');
    ui.list.addEventListener('click', function () { close(); });
    top.appendChild(ui.list);
    deck.appendChild(top);

    track = mk('div', 'dk-track');
    track.tabIndex = 0;
    track.setAttribute('aria-label', 'Swipe or use the arrow keys to move between cards');
    deck.appendChild(track);

    var foot = mk('footer', 'dk-foot');
    ui.prev = btn('dk-nav dk-prev', '', 'Previous card');
    ui.prev.appendChild(svg('M15 5l-7 7 7 7'));
    ui.next = btn('dk-nav dk-next', '', 'Next card');
    ui.next.appendChild(svg('M9 5l7 7-7 7'));
    var bar = mk('div', 'dk-bar');
    ui.fill = mk('i');
    bar.appendChild(ui.fill);
    ui.count = mk('span', 'dk-count');
    ui.live = mk('div', 'dk-live');
    ui.live.setAttribute('role', 'status');
    ui.live.setAttribute('aria-live', 'polite');
    foot.appendChild(ui.prev);
    foot.appendChild(bar);
    foot.appendChild(ui.count);
    foot.appendChild(ui.next);
    deck.appendChild(foot);
    deck.appendChild(ui.live);
    document.body.appendChild(deck);
    buildFab();

    ui.prev.addEventListener('click', function () { goTo(idx - 1, true); });
    ui.next.addEventListener('click', function () { goTo(idx + 1, true); });
    track.addEventListener('scroll', onScroll, { passive: true });
    track.addEventListener('click', function (e) {
      var g = e.target.closest && e.target.closest('[data-goto]');
      if (!g) return;
      var i = indexOfStory(g.getAttribute('data-goto'));
      if (i >= 0) goTo(i, true);
    });
    ['touchstart', 'pointerdown', 'wheel'].forEach(function (t) { deck.addEventListener(t, touched, { passive: true }); });
    ['touchstart', 'pointerdown'].forEach(function (t) { deck.addEventListener(t, function () { downAt = Date.now(); }, { passive: true }); });
    ['touchend', 'touchcancel', 'pointerup', 'pointercancel'].forEach(function (t) {
      deck.addEventListener(t, function () { downAt = 0; setTimeout(align, 350); setTimeout(align, 900); }, { passive: true });
    });
    deck.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    document.addEventListener('hb:prefs', function () { if (shown) refresh(); });
    document.addEventListener('hb:hub', function () { if (shown) syncFab(); });
    document.addEventListener('hb:listen', function () { if (shown) onListenSoon(); });
  }

  function touched() { lastTouch = Date.now(); goal = null; }         // the reader has taken over: forget any move in progress

  function onKey(e) {
    touched();
    if (e.key === 'Escape') { e.preventDefault(); if (fabOpen) setFab(false); else close(); return; }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var k = e.key;
    if (k === 'ArrowRight') goTo(idx + 1, true);
    else if (k === 'ArrowLeft') goTo(idx - 1, true);
    else if (k === 'Home') goTo(0, true);
    else if (k === 'End') goTo(cards.length - 1, true);
    else return;
    e.preventDefault();
  }

  function onResize() {
    if (!shown || !track) return;
    if (window.requestAnimationFrame) requestAnimationFrame(function () {
      if (shown && track.clientWidth !== deckW) { deckW = track.clientWidth; track.scrollLeft = cardLeft(idx); }
      if (shown) { fadeAll(); positionFab(); }
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

  function render() {
    cards = collect();
    track.textContent = '';
    cards.forEach(function (c) {
      c.el = c.kind === 'cover' ? buildCover(c) : c.kind === 'intro' ? buildIntro(c) : c.kind === 'story' ? buildStory(c) : c.kind === 'quiz' ? buildQuiz(c) : buildEnd();
      track.appendChild(c.el);
    });
    watchMirror();
    syncCover();
    markPlaying();
  }

  function paint() {
    var c = cards[idx];
    if (!c) return;
    ui.secName.textContent = c.kind === 'story' || c.kind === 'intro' ? c.name : c.kind === 'quiz' ? 'Quiz' : 'The Hour Brief';
    ui.secPos.textContent = c.kind === 'story' ? 'Story ' + c.n + ' of ' + c.of : c.kind === 'intro' ? 'Section ' + c.sec + ' of ' + c.secTotal : c.kind === 'quiz' ? 'Test what stuck' : c.kind === 'cover' ? (c.line || 'Today’s brief') : 'All caught up';
    ui.count.textContent = (idx + 1) + ' / ' + cards.length;
    ui.fill.style.width = cards.length > 1 ? Math.round(idx / (cards.length - 1) * 100) + '%' : '100%';
    ui.prev.disabled = idx <= 0;
    ui.next.disabled = idx >= cards.length - 1;
    cards.forEach(function (x, i) {
      if (canInert) x.el.inert = i !== idx;
      else x.el.setAttribute('aria-hidden', String(i !== idx));
    });
    syncFab();
  }

  function announce() {
    var c = cards[idx];
    if (!c) return;
    var h = c.el.querySelector('.dk-title');
    ui.live.textContent = (c.el.getAttribute('aria-label') || '') + (h ? '. ' + h.textContent : '');
  }

  function onScroll() {
    lastScrollAt = Date.now();
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(function () {
      scrollRaf = 0;
      var w = track.clientWidth || 1, i = Math.round(track.scrollLeft / w);
      i = Math.max(0, Math.min(cards.length - 1, i));
      // While a move we started is still animating, the scroll position is between the old card and the new one: keep the
      // target as the current card (otherwise the header and markers flicker back to the old card for the first half).
      var moving = goal !== null && Date.now() - goalAt < goalMs;
      if (i !== idx && !moving) { idx = i; paint(); }
      clearTimeout(settleT);
      settleT = setTimeout(function () { announce(); fadeAll(); align(); }, 200);
    });
  }

  // Where a card sits in the track (measured, because cards are a fraction of a pixel wider than the screen on some phones).
  function cardLeft(i) { return cards[i].el.getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft; }
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
    if (id === 'outro') { for (var i = 0; i < cards.length; i++) if (cards[i].kind === 'quiz') return i; return cards.length - 1; }
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
    syncCover();
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
    if (shown) { if (o.id) { var j = indexOfStory(o.id); if (j >= 0) goTo(j, true); } return true; }
    render();
    if (!cards.some(function (c) { return c.kind === 'story'; })) return false;
    returnFocus = document.activeElement;
    deck.hidden = false;
    shown = true;
    document.documentElement.classList.add('hb-deck-open');
    var i = -1;
    if (o.id) { i = indexOfStory(o.id); if (i < 0) i = indexOfLane(o.id); }
    var now = listenNow();
    if (now.live && now.cur) lastFollowId = now.cur.id;              // opening mid-play: start on it, then follow the NEXT part
    if (i < 0 && now.live) i = unitIndex(now.cur);
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
    var h = cards[idx].el.querySelector('.dk-title');
    if (h) { try { h.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    document.dispatchEvent(new CustomEvent('hb:deck'));
    return true;
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
