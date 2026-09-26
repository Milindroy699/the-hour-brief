/*
 * cards.js — the swipe-card reading view: the same stories, one per screen (phones and the apps).
 *
 * Loaded on demand by mobile.js (like listen.js). The vertical feed stays the source of truth: this file only reads
 * it, builds a deck of cards from it, and forwards taps (vote, save, share) to the feed's own buttons, so Listen,
 * votes, saves and shared links are untouched. Text is copied with textContent only, never as HTML (the two small
 * icons are cloned from the feed's own buttons).
 *
 * Deck: section intro card, then one card per story, in the reader's own section order (hidden sections skipped),
 * with the quiz where the reader put it and a closing card if the quiz is not last. A horizontal scroll-snap track,
 * so swiping, momentum and snapping are the browser's own.
 */
(function () {
  'use strict';
  if (window.HBCards) return;

  var VIEW_KEY = 'hb-view-v1';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canInert = 'inert' in HTMLElement.prototype;

  var deck = null, track = null, ui = {}, cards = [], idx = 0, shown = false;
  var lastTouch = 0, returnFocus = null, scrollRaf = 0, settleT = 0, fixT = 0, syncRaf = 0;
  var followObs = null, mirrorObs = null, bodyObs = null, playerRO = null, playerEl = null, deckW = 0;

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
    var out = [], lanes = [];
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
    if (!out.length || out[out.length - 1].kind !== 'quiz') out.push({ kind: 'end', name: 'The Hour Brief' });
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
    b.scroll.appendChild(mk('p', 'dk-hint', 'Swipe to start →'));
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
      close({ keep: true, noScroll: true });
      var ch = document.querySelector('.quiz-chip');
      if (ch) ch.click(); else { var q = document.getElementById('quiz'); if (q) q.scrollIntoView({ block: 'start' }); }
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
    if (window.HBReader && window.HBReader.textSize) {
      var aa = btn('dk-top-btn dk-size', 'Aa', 'Text size');
      aa.addEventListener('click', function () { window.HBReader.textSize(); });
      top.appendChild(aa);
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
    deck.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    document.addEventListener('hb:prefs', function () { if (shown) refresh(); });
    document.addEventListener('hb:hub', function () { if (shown) fitSoon(); });
  }

  function touched() { lastTouch = Date.now(); }

  function onKey(e) {
    touched();
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
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
      if (shown && track.clientWidth !== deckW) { deckW = track.clientWidth; track.scrollLeft = idx * deckW; }
      if (shown) fadeAll();
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
      c.el = c.kind === 'intro' ? buildIntro(c) : c.kind === 'story' ? buildStory(c) : c.kind === 'quiz' ? buildQuiz(c) : buildEnd();
      track.appendChild(c.el);
    });
    watchMirror();
  }

  function paint() {
    var c = cards[idx];
    if (!c) return;
    ui.secName.textContent = c.kind === 'story' || c.kind === 'intro' ? c.name : c.kind === 'quiz' ? 'Quiz' : 'The Hour Brief';
    ui.secPos.textContent = c.kind === 'story' ? 'Story ' + c.n + ' of ' + c.of : c.kind === 'intro' ? 'Section ' + c.sec + ' of ' + c.secTotal : c.kind === 'quiz' ? 'Test what stuck' : 'All caught up';
    ui.count.textContent = (idx + 1) + ' / ' + cards.length;
    ui.fill.style.width = cards.length > 1 ? Math.round(idx / (cards.length - 1) * 100) + '%' : '100%';
    ui.prev.disabled = idx <= 0;
    ui.next.disabled = idx >= cards.length - 1;
    cards.forEach(function (x, i) {
      if (canInert) x.el.inert = i !== idx;
      else x.el.setAttribute('aria-hidden', String(i !== idx));
    });
  }

  function announce() {
    var c = cards[idx];
    if (!c) return;
    var h = c.el.querySelector('.dk-title');
    ui.live.textContent = (c.el.getAttribute('aria-label') || '') + (h ? '. ' + h.textContent : '');
  }

  function onScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(function () {
      scrollRaf = 0;
      var w = track.clientWidth || 1, i = Math.round(track.scrollLeft / w);
      i = Math.max(0, Math.min(cards.length - 1, i));
      if (i !== idx) { idx = i; paint(); }
      clearTimeout(settleT);
      settleT = setTimeout(function () { announce(); fadeAll(); }, 180);
    });
  }

  // Move to a card. Some WebViews end a smooth scroll early, so after a moment check it arrived and finish the job
  // (never while the reader has a finger on the deck).
  function goTo(i, smooth) {
    if (!track || !cards.length) return;
    i = Math.max(0, Math.min(cards.length - 1, i));
    var animate = smooth && !reduceMotion;
    deckW = track.clientWidth;
    track.scrollTo({ left: i * deckW, top: 0, behavior: animate ? 'smooth' : 'auto' });
    idx = i;
    paint();
    clearTimeout(fixT);
    fixT = setTimeout(function () {
      if (shown && Date.now() - lastTouch > 500 && Math.abs(track.scrollLeft - i * track.clientWidth) > 4) track.scrollLeft = i * track.clientWidth;
    }, animate ? 650 : 80);
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

  // Listen marks the story being read with .hb-listening: turn to it, unless the reader has just touched the deck.
  function follow(t) {
    if (Date.now() - lastTouch < 4000) return;
    var item = t.closest && t.closest('.item[data-story-id]'), i = -1;
    if (item) i = indexOfStory(item.getAttribute('data-story-id'));
    else if (t.classList.contains('lane-head')) { var lane = t.closest('section.lane'); if (lane) i = indexOfLane(lane.id); }
    if (i >= 0 && i !== idx) goTo(i, true);
  }
  function startFollow() {
    stopFollow();
    var first = document.querySelector('section.lane');
    if (!first || !window.MutationObserver) return;
    followObs = new MutationObserver(function (ms) {
      for (var k = 0; k < ms.length; k++) {
        var t = ms[k].target;
        if (t.classList && t.classList.contains('hb-listening')) { follow(t); break; }
      }
    });
    followObs.observe(first.parentNode, { subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  function stopFollow() { if (followObs) { followObs.disconnect(); followObs = null; } }

  function refresh() {
    var cur = cards[idx], id = cur && cur.kind === 'story' ? cur.item.getAttribute('data-story-id') : null;
    render();
    var i = id ? indexOfStory(id) : -1;
    goTo(i >= 0 ? i : Math.min(idx, cards.length - 1), false);
    fadeAll();
  }

  function litIndex() {
    var lit = document.querySelector('.item.hb-listening[data-story-id], .lane-head.hb-listening');
    if (!lit) return -1;
    if (lit.classList.contains('item')) return indexOfStory(lit.getAttribute('data-story-id'));
    var lane = lit.closest('section.lane');
    return lane ? indexOfLane(lane.id) : -1;
  }

  // The mini player floats above the tab bar while Listen plays: leave exactly its height free, so it never covers the
  // deck's buttons (measured, because its height changes with the title and the text size).
  function fitPlayer() {
    if (!deck) return;
    var p = document.querySelector('.hb-player'), h = 0;
    if (p && getComputedStyle(p).display !== 'none') h = p.getBoundingClientRect().height;
    deck.style.setProperty('--dk-player', h ? Math.ceil(h) + 16 + 'px' : '0px');
    if (p !== playerEl) {
      if (playerRO) { playerRO.disconnect(); playerRO = null; }
      playerEl = p;
      if (p && window.ResizeObserver) { playerRO = new ResizeObserver(fitPlayer); playerRO.observe(p); }
    }
  }
  function fitSoon() { fitPlayer(); setTimeout(function () { if (shown) fitPlayer(); }, 350); }
  function startFit() {
    fitPlayer();
    if (bodyObs || !window.MutationObserver) return;
    bodyObs = new MutationObserver(fitSoon);
    bodyObs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  function stopFit() {
    if (bodyObs) { bodyObs.disconnect(); bodyObs = null; }
    if (playerRO) { playerRO.disconnect(); playerRO = null; playerEl = null; }
  }

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
    if (i < 0) i = litIndex();
    if (i < 0) i = 0;
    deckW = track.clientWidth;
    goTo(i, false);
    fadeAll();
    lastTouch = 0;
    setView('cards');
    startFollow();
    startFit();
    announce();
    var h = cards[idx].el.querySelector('.dk-title');
    if (h) { try { h.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    document.dispatchEvent(new CustomEvent('hb:deck'));
    return true;
  }

  // keep: leave the reader's saved choice (Cards) alone, because this is only a trip to the quiz or similar.
  function close(o) {
    o = o || {};
    if (!shown) return;
    var c = cards[idx];
    deck.hidden = true;
    shown = false;
    document.documentElement.classList.remove('hb-deck-open');
    stopFollow();
    stopFit();
    if (mirrorObs) mirrorObs.disconnect();
    if (!o.keep) setView('list');
    if (!o.noScroll && c) {
      var target = c.kind === 'story' ? c.item : c.lane;
      if (target && target.scrollIntoView) target.scrollIntoView({ block: 'start', behavior: 'instant' });   // the page's own CSS is smooth
    }
    document.dispatchEvent(new CustomEvent('hb:deck'));
    if (returnFocus && returnFocus.focus && document.contains(returnFocus)) { try { returnFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    returnFocus = null;
  }

  window.HBCards = {
    open: open,
    close: close,
    isOpen: function () { return shown; },
    goTo: function (i, smooth) { goTo(i, smooth !== false); },
    count: function () { return cards.length; }
  };
  document.dispatchEvent(new CustomEvent('hb:cards-ready'));
})();
