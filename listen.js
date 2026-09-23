/*
 * listen.js — "Listen to today's brief" for The Hour Brief.
 *
 * Loaded on demand by mobile.js (reader mode only, and only where the device has speech
 * synthesis). It reads the edition aloud with the device's own text-to-speech, so no audio
 * is generated, uploaded or stored and nothing leaves the device.
 *
 *  - Quick: each section's takeaway, then every story's headline and takeaway.
 *  - Full:  each story's headline, summary and takeaway.
 *  - A mini player (previous / play-pause / next story, speed, close) sits at the bottom;
 *    the story being read is highlighted and scrolled into view.
 *  - Speech is queued sentence by sentence: long utterances get cut off by some engines, and
 *    it makes pause, skip and speed changes instant. Pause = stop here, resume = replay this
 *    sentence (speechSynthesis.pause() is unreliable on Android).
 *
 * Mode and speed are remembered on this device (localStorage "hb-listen-v1").
 */
(function () {
  // Two ways to speak. Browsers and iOS web views have the Web Speech API; the Android WebView
  // does not, so the Android app talks to the device's TTS engine through the Capacitor
  // TextToSpeech plugin. Both are wrapped as { speak(text, rate, hooks), cancel(), busy(), watch }.
  function webEngine() {
    var synth = window.speechSynthesis;
    if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') return null;
    return {
      watch: true,                       // reports when speech actually starts
      speak: function (text, rate, h) {
        var ut = new window.SpeechSynthesisUtterance(text);
        ut.lang = document.documentElement.lang || 'en';
        ut.rate = rate;
        ut.onstart = h.start;
        ut.onend = h.end;
        ut.onerror = function (e) { h.error(e && e.error); };
        h.keep = ut;                     // keep a reference: some engines drop callbacks on collected utterances
        synth.speak(ut);
      },
      cancel: function () { synth.cancel(); },
      busy: function () { return synth.speaking || synth.pending; },
    };
  }
  function pluginEngine() {
    var P = window.Capacitor && window.Capacitor.Plugins;
    var T = P && P.TextToSpeech;
    if (!T) return null;
    return {
      watch: false,                      // no start event; a rejected speak() is the failure signal
      speak: function (text, rate, h) {
        h.start();
        T.speak({ text: text, lang: 'en-US', rate: rate, pitch: 1, volume: 1, queueStrategy: 0 })
          .then(function () { h.end(); }, function () { h.error('plugin'); });
      },
      cancel: function () { var p = T.stop(); if (p && p.catch) p.catch(function () {}); },
      busy: function () { return true; },
    };
  }
  var synth = webEngine() || pluginEngine();
  if (!synth) return;

  var mq = window.matchMedia('(max-width: 640px)');
  var Cap0 = window.Capacitor;
  var NATIVE = !!(Cap0 && typeof Cap0.isNativePlatform === 'function' && Cap0.isNativePlatform());
  function reader() { return mq.matches || NATIVE; }

  var KEY = 'hb-listen-v1';
  var WPM = 165;                       // typical device voice at 1x
  var RATES = [1, 1.25, 1.5, 1.75, 0.85];
  var MAX_CHUNK = 190;                 // characters per utterance
  var ABBR = /\b(?:U\.S|U\.K|U\.N|E\.U|Inc|Corp|Ltd|Co|Mr|Mrs|Ms|Dr|St|vs|No|approx|est|Jr|Sr)\.$/i;

  var S = { mode: 'quick', rate: 1, units: {}, list: [], ui: 0, ci: 0, state: 'idle', gen: 0, started: false, timer: 0, dog: 0, cur: null };
  var cta = null, player = null, nowEl = null, laneEl = null, playBtn = null, prevBtn = null, nextBtn = null, rateBtn = null;
  var lit = null;

  function load() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (o.mode === 'full' || o.mode === 'quick') S.mode = o.mode;
      if (RATES.indexOf(o.rate) >= 0) S.rate = o.rate;
    } catch (e) { /* ignore */ }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ mode: S.mode, rate: S.rate })); } catch (e) { /* ignore */ }
  }

  function mk(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(cls, label, html) {
    var b = mk('button', cls);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    if (html) b.innerHTML = html;
    return b;
  }
  function svg(paths) {
    return '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">' + paths + '</svg>';
  }
  var I_PLAY = svg('<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>');
  var I_PAUSE = svg('<rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/>');
  var I_PREV = svg('<rect x="5" y="5" width="2.4" height="14" rx="1"/><path d="M19 6.2v11.6a.8.8 0 0 1-1.25.66l-8.2-5.8a.8.8 0 0 1 0-1.32l8.2-5.8A.8.8 0 0 1 19 6.2z"/>');
  var I_NEXT = svg('<rect x="16.6" y="5" width="2.4" height="14" rx="1"/><path d="M5 6.2v11.6a.8.8 0 0 0 1.25.66l8.2-5.8a.8.8 0 0 0 0-1.32l-8.2-5.8A.8.8 0 0 0 5 6.2z"/>');
  var I_CLOSE = svg('<path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z"/>');
  var I_REPLAY = svg('<path d="M12 5V2L7 6.5 12 11V8a5 5 0 1 1-5 5H5a7 7 0 1 0 7-8z"/>');
  var I_HEAD = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M4 14h3a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2v-4z"/><path d="M20 14h-3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h1a2 2 0 0 0 2-2v-4z"/></svg>';

  // ---- Turning the page into something worth hearing ----
  function speakable(t) {
    return String(t || '')
      .replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, ' ')
      .replace(/\s*&\s*/g, ' and ')
      .replace(/\s*[→›»]\s*/g, ' ')
      .replace(/\s+[—–]\s+/g, ', ')
      .replace(/~/g, 'about ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function stop1(t) { return /[.!?…]["'”’)\]]*$/.test(t) ? t : t + '.'; }
  function withoutLabel(node) {
    var c = node.cloneNode(true);
    var l = c.querySelector('.takeaway-label');
    if (l) l.remove();
    return speakable(c.textContent);
  }

  // Sentences, merged up to MAX_CHUNK; over-long sentences are split at commas, then at spaces.
  function chunk(text) {
    var out = [];
    var re = /[\s\S]*?[.!?…]["'”’)\]]*(?:\s+|$)/g;
    var parts = [], m, last = 0;
    while ((m = re.exec(text)) && m[0]) { parts.push(m[0].trim()); last = re.lastIndex; }
    if (last < text.length) parts.push(text.slice(last).trim());
    var sents = [];
    parts.forEach(function (p) {
      if (!p) return;
      if (sents.length && ABBR.test(sents[sents.length - 1])) sents[sents.length - 1] += ' ' + p;
      else sents.push(p);
    });
    var cur = '';
    function flush() { if (cur) out.push(cur); cur = ''; }
    sents.forEach(function (s) {
      while (s.length > MAX_CHUNK) {
        var cut = s.lastIndexOf(', ', MAX_CHUNK);
        if (cut < 60) cut = s.lastIndexOf('; ', MAX_CHUNK);
        if (cut < 60) cut = s.lastIndexOf(' ', MAX_CHUNK);
        if (cut < 1) cut = MAX_CHUNK;
        flush();
        out.push(s.slice(0, cut + 1).trim());
        s = s.slice(cut + 1).trim();
      }
      if (cur && (cur + ' ' + s).length > MAX_CHUNK) flush();
      cur = cur ? cur + ' ' + s : s;
    });
    flush();
    return out.filter(Boolean);
  }
  function firstWords(text, max) {
    var c = chunk(text), out = '';
    for (var i = 0; i < c.length; i++) { if (out && (out + ' ' + c[i]).length > max) break; out = out ? out + ' ' + c[i] : c[i]; }
    return out;
  }

  function editionIntro() {
    var page = document.querySelector('[data-edition-date]');
    var iso = page && page.getAttribute('data-edition-date');
    var ed = document.querySelector('.edition');
    var n = ed && /Edition\s+0*(\d+)/i.exec(ed.textContent);
    var when = '';
    if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      try { when = new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); } catch (e) { /* ignore */ }
    }
    return 'The Hour Brief' + (n ? ', edition ' + n[1] : '') + (when ? ', ' + when : '') + '.';
  }

  function build(mode) {
    var units = [{ kind: 'intro', el: null, lane: 'The Hour Brief', title: 'Today’s brief', pos: '', chunks: chunk(editionIntro()) }];
    document.querySelectorAll('section.lane').forEach(function (lane) {
      var tagEl = lane.querySelector('.lane-tag');
      var tagClone = tagEl && tagEl.cloneNode(true);
      var tagTime = tagClone && tagClone.querySelector('.lane-time');     // "· 5 min" reading-time badge
      if (tagTime) tagTime.remove();
      var tag = speakable(tagClone ? tagClone.textContent : '') || 'This section';
      var lt = lane.querySelector('.lane-takeaway');
      var items = lane.querySelectorAll('.item[data-story-id]');
      units.push({
        kind: 'lane', el: lane.querySelector('.lane-head'), lane: tag, title: tag, pos: '',
        chunks: chunk(stop1(tag) + (lt ? ' ' + stop1(withoutLabel(lt)) : '')),
      });
      items.forEach(function (it, i) {
        var h3 = it.querySelector('h3');
        var head = h3 ? speakable(h3.textContent) : '';
        if (!head) return;
        var tk = it.querySelector('.takeaway');
        var paras = [];
        it.querySelectorAll('p').forEach(function (p) { if (!p.classList.contains('takeaway')) paras.push(speakable(p.textContent)); });
        var body = paras.join(' ');
        var parts = [stop1(head)];
        if (mode === 'full') {
          if (body) parts.push(stop1(body));
          if (tk) parts.push('Takeaway. ' + stop1(withoutLabel(tk)));
        } else if (tk) {
          parts.push(stop1(withoutLabel(tk)));
        } else if (body) {
          parts.push(firstWords(body, 230));
        }
        units.push({ kind: 'story', el: it, lane: tag, title: head, pos: (i + 1) + ' of ' + items.length, chunks: chunk(parts.join(' ')) });
      });
    });
    if (document.getElementById('quiz')) units.push({ kind: 'outro', el: null, lane: 'The Hour Brief', title: 'That’s the brief', pos: '', chunks: chunk('That is today’s brief. Try the quiz below to see what stuck.') });
    else units.push({ kind: 'outro', el: null, lane: 'The Hour Brief', title: 'That’s the brief', pos: '', chunks: chunk('That is today’s brief. See you tomorrow.') });
    units.forEach(function (u) {
      u.words = u.chunks.reduce(function (n, c) { return n + (c.match(/\S+/g) || []).length; }, 0);
    });
    return units;
  }
  function minutes(mode) {
    var w = S.units[mode].reduce(function (n, u) { return n + u.words; }, 0);
    return Math.max(1, Math.round(w / (WPM * S.rate)));
  }

  // ---- Highlight + scroll ----
  function light(el) {
    if (lit && lit !== el) lit.classList.remove('hb-listening');
    lit = el || null;
    if (!el) return;
    el.classList.add('hb-listening');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try { el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' }); } catch (e) { el.scrollIntoView(); }
  }

  // ---- Playback ----
  function clearTimers() { clearTimeout(S.timer); clearTimeout(S.dog); }
  function speakChunk() {
    var u = S.list[S.ui];
    if (!u || S.state !== 'playing') return;
    var text = u.chunks[S.ci];
    if (!text) { advance(); return; }
    var gen = S.gen;
    var hooks = {
      start: function () { if (gen === S.gen) { S.started = true; clearTimeout(S.dog); } },
      end: function () { if (gen === S.gen) advance(); },
      error: function (er) {
        if (gen !== S.gen) return;
        if (er === 'interrupted' || er === 'canceled') return;
        fail();
      },
    };
    S.cur = hooks;
    S.started = false;
    clearTimeout(S.dog);
    if (synth.watch) S.dog = setTimeout(function () { if (gen === S.gen && !S.started) fail(); }, 8000);
    try { synth.speak(text, S.rate, hooks); } catch (e) { fail(); }
  }
  // Start (or restart) the current chunk; used after any jump, pause/resume and speed change.
  function go() {
    clearTimers();
    S.gen++;
    try { synth.cancel(); } catch (e) { /* ignore */ }
    S.timer = setTimeout(speakChunk, 90);
  }
  function enter(i) {
    S.ui = Math.max(0, Math.min(S.list.length - 1, i));
    S.ci = 0;
    var u = S.list[S.ui];
    light(u.el);
    render();
  }
  function advance() {
    var u = S.list[S.ui];
    if (S.ci + 1 < u.chunks.length) { S.ci++; S.gen++; speakChunk(); return; }
    if (S.ui + 1 < S.list.length) { enter(S.ui + 1); S.gen++; speakChunk(); return; }
    finish();
  }
  function finish() {
    clearTimers();
    S.state = 'done';
    light(null);
    render();
  }
  function fail() {
    clearTimers();
    S.gen++;
    try { synth.cancel(); } catch (e) { /* ignore */ }
    S.state = 'error';
    render();
  }

  function begin(mode) {
    var carry = S.state === 'playing' || S.state === 'paused';
    var el = carry && S.list[S.ui] && S.list[S.ui].el;
    S.mode = mode;
    S.list = S.units[mode];
    save();
    ensurePlayer();
    var at = 0;
    if (el) {                          // switching length mid-listen: carry on from the same story
      for (var i = 0; i < S.list.length; i++) if (S.list[i].el === el) { at = i; break; }
    }
    S.state = 'playing';
    enter(at);
    go();
  }
  function toggle() {
    if (S.state === 'playing') { S.state = 'paused'; clearTimers(); S.gen++; try { synth.cancel(); } catch (e) { /* ignore */ } render(); }
    else if (S.state === 'paused') { S.state = 'playing'; render(); go(); }
    else if (S.state === 'done' || S.state === 'error') { var retry = S.state === 'error'; S.state = 'playing'; enter(retry ? S.ui : 0); go(); }
  }
  function skip(dir) {
    if (S.state === 'done') return;
    var to = S.ui + dir;
    if (dir < 0 && S.ci > 0) to = S.ui;          // first tap on "previous" restarts this story
    if (to < 0 || to > S.list.length - 1) return;
    S.state = 'playing';
    enter(to);
    go();
  }
  function stop() {
    clearTimers();
    S.gen++;
    try { synth.cancel(); } catch (e) { /* ignore */ }
    S.state = 'idle';
    light(null);
    if (player) player.hidden = true;
    document.body.classList.remove('hb-listening');
    render();
  }

  // ---- UI ----
  function ensurePlayer() {
    if (!player) {
      player = mk('div', 'hb-player');
      player.setAttribute('role', 'region');
      player.setAttribute('aria-label', 'Listen to this edition');
      var now = mk('div', 'hb-pl-now');
      laneEl = mk('span', 'hb-pl-lane');
      nowEl = mk('span', 'hb-pl-title');
      now.appendChild(laneEl);
      now.appendChild(nowEl);
      var ctl = mk('div', 'hb-pl-ctl');
      prevBtn = btn('hb-pl-b hb-pl-prev', 'Previous story', I_PREV);
      playBtn = btn('hb-pl-b hb-pl-play', 'Pause', I_PAUSE);
      nextBtn = btn('hb-pl-b hb-pl-next', 'Next story', I_NEXT);
      rateBtn = btn('hb-pl-b hb-pl-rate', 'Speed');
      var close = btn('hb-pl-b hb-pl-close', 'Stop listening and close the player', I_CLOSE);
      prevBtn.addEventListener('click', function () { skip(-1); });
      nextBtn.addEventListener('click', function () { skip(1); });
      playBtn.addEventListener('click', toggle);
      rateBtn.addEventListener('click', function () {
        S.rate = RATES[(RATES.indexOf(S.rate) + 1) % RATES.length];
        save();
        if (S.state === 'playing') go();
        render();
      });
      close.addEventListener('click', function () { stop(); var b = cta && cta.querySelector('button'); if (b) b.focus({ preventScroll: true }); });
      [prevBtn, playBtn, nextBtn, rateBtn, close].forEach(function (b) { ctl.appendChild(b); });
      player.appendChild(now);
      player.appendChild(ctl);
      document.body.appendChild(player);
    }
    player.hidden = false;
    document.body.classList.add('hb-listening');
  }

  function render() {
    if (cta) {
      var on = S.state !== 'idle';
      cta.querySelectorAll('button[data-mode]').forEach(function (b) {
        var m = b.getAttribute('data-mode');
        b.setAttribute('aria-pressed', String(on && S.mode === m));
        b.querySelector('.hb-cta-min').textContent = minutes(m) + ' min';
      });
    }
    if (!player || player.hidden) return;
    var u = S.list[S.ui] || {};
    if (S.state === 'error') {
      laneEl.textContent = 'Listen';
      nowEl.textContent = 'Speech isn’t available right now. Check your device’s text-to-speech settings.';
    } else if (S.state === 'done') {
      laneEl.textContent = 'Listen';
      nowEl.textContent = 'That’s the brief. Thanks for listening.';
    } else {
      laneEl.textContent = (u.lane || '') + (u.pos ? ' · ' + u.pos : '') + (S.state === 'paused' ? ' · Paused' : '');
      nowEl.textContent = u.title || '';
    }
    var playing = S.state === 'playing';
    var again = S.state === 'done' || S.state === 'error';
    playBtn.innerHTML = playing ? I_PAUSE : again ? I_REPLAY : I_PLAY;
    playBtn.setAttribute('aria-label', playing ? 'Pause' : again ? 'Play again' : 'Play');
    prevBtn.disabled = S.state === 'done' || (S.ui === 0 && S.ci === 0);
    nextBtn.disabled = S.state === 'done' || S.ui >= S.list.length - 1;
    rateBtn.textContent = String(S.rate).replace(/^0\./, '.') + '×';
    rateBtn.setAttribute('aria-label', 'Speed ' + S.rate + ' times. Tap to change.');
  }

  function ensureCta() {
    var host = document.querySelector('.reader-tools');
    if (!host || !S.units.quick.some(function (u) { return u.kind === 'story'; })) return;
    if (!cta) {
      cta = mk('div', 'listen-cta');
      cta.setAttribute('role', 'group');
      cta.setAttribute('aria-label', 'Listen to today’s brief');
      var t = mk('div', 'listen-cta-t');
      t.innerHTML = I_HEAD;
      t.appendChild(mk('span', '', 'Listen to today’s brief'));
      var row = mk('div', 'listen-cta-b');
      [['quick', 'Quick', 'headlines and takeaways'], ['full', 'Full', 'every story in full']].forEach(function (m) {
        var b = mk('button', 'listen-cta-btn');
        b.type = 'button';
        b.setAttribute('data-mode', m[0]);
        b.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-label', 'Listen: ' + m[1].toLowerCase() + ' version, ' + m[2]);
        b.innerHTML = '<span class="hb-cta-name"></span><span class="hb-cta-min"></span>';
        b.querySelector('.hb-cta-name').textContent = m[1];
        b.addEventListener('click', function () {
          if (S.state === 'playing' && S.mode === m[0]) toggle();       // tapping the active length pauses
          else if (S.state === 'paused' && S.mode === m[0]) toggle();
          else begin(m[0]);
        });
        row.appendChild(b);
      });
      cta.appendChild(t);
      cta.appendChild(row);
    }
    if (cta.parentNode !== host.parentNode || cta.previousElementSibling !== host) host.insertAdjacentElement('afterend', cta);
    cta.hidden = !reader();
    render();
  }

  // Coming back to the app after the OS suspended speech: carry on from this sentence.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && S.state === 'playing' && !synth.busy()) go();
  });
  window.addEventListener('pagehide', function () { try { synth.cancel(); } catch (e) { /* ignore */ } });
  mq.addEventListener('change', function () { if (cta) cta.hidden = !reader(); if (!reader()) stop(); });

  function init() {
    load();
    S.units = { quick: build('quick'), full: build('full') };
    S.list = S.units[S.mode];
    ensureCta();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.HBListen = { start: begin, stop: stop, state: function () { return S.state; } };
})();
