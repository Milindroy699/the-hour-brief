/*
 * listen.js — "Listen to today's brief" for The Hour Brief.
 *
 * Loaded on demand by mobile.js (reader mode only, and only where the device has speech
 * synthesis). It reads the edition aloud with the device's own text-to-speech, so no audio
 * is generated, uploaded or stored and nothing leaves the device.
 *
 *  - Quick: each section's takeaway, then every story's headline and takeaway.
 *  - Full:  each story's headline, summary and takeaway (about 13 minutes at 1.25x). Switched off
 *           for now (see OFFER_FULL); the code is kept so it can be offered again.
 *  - A mini player (previous / play-pause / next story, speed, close) sits at the bottom;
 *    the story being read is highlighted and scrolled into view.
 *  - Speech is queued sentence by sentence: long utterances get cut off by some engines, and
 *    it makes pause, skip and speed changes instant. Pause = stop here, resume = replay this
 *    sentence (speechSynthesis.pause() is unreliable on Android).
 *
 * If a recording of today's edition exists (a manifest on R2, made by the daily audio job in
 * tools/audio), Quick plays that recording in an AI voice through an <audio> element, with the
 * manifest's story timings driving highlight, skip and the lock-screen controls. Full is not
 * recorded (it would cost too much): it is always read by the device voice, free, and starts at
 * 1.25x. Anything missing or failing falls back to the device voice described above.
 *
 * Speed is remembered per length on this device (localStorage "hb-listen-v1").
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
  var synth = webEngine() || pluginEngine();      // null where the device cannot speak: recorded audio only

  var mq = window.matchMedia('(max-width: 640px)');
  var Cap0 = window.Capacitor;
  var NATIVE = !!(Cap0 && typeof Cap0.isNativePlatform === 'function' && Cap0.isNativePlatform());
  function reader() { return mq.matches || NATIVE; }

  // The longer "Full" reading (device voice, 1.25x, about 13 minutes) is switched off for now.
  // Change this default to true (or set window.HB_OFFER_FULL = true) to offer it again.
  var OFFER_FULL = typeof window.HB_OFFER_FULL === 'boolean' ? window.HB_OFFER_FULL : false;
  var MODES = OFFER_FULL ? ['quick', 'full'] : ['quick'];

  var KEY = 'hb-listen-v1';
  var WPM = 165;                       // typical device voice at 1x
  var RATES = [1, 1.25, 1.5, 1.75, 0.85];
  var MAX_CHUNK = 190;                 // characters per utterance
  var ABBR = /\b(?:U\.S|U\.K|U\.N|E\.U|Inc|Corp|Ltd|Co|Mr|Mrs|Ms|Dr|St|vs|No|approx|est|Jr|Sr)\.$/i;

  var AUDIO_BASE = window.HB_AUDIO_BASE || 'https://pub-1dafea4a948540db8413a044895e083c.r2.dev';   // R2 bucket with the recordings

  // src: 'rec' = recorded audio, 'tts' = the device voice.  cues[mode][i] is the recording's timing for unit i.
  var S = { mode: 'quick', rate: 1, rates: { quick: 1, full: 1.25 }, units: {}, list: [], ui: 0, ci: 0, state: 'idle', gen: 0, started: false, timer: 0, dog: 0, cur: null,
    src: 'tts', manifest: null, date: '', cues: {}, bad: {}, seekTo: null, seeking: false };
  var cta = null, player = null, nowEl = null, laneEl = null, badgeEl = null, noteEl = null, playBtn = null, prevBtn = null, nextBtn = null, rateBtn = null;
  var audio = null;
  var lit = null;

  function load() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (o.rates && RATES.indexOf(o.rates.quick) >= 0) S.rates.quick = o.rates.quick;
      if (o.rates && RATES.indexOf(o.rates.full) >= 0) S.rates.full = o.rates.full;
    } catch (e) { /* ignore */ }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ rates: S.rates })); } catch (e) { /* ignore */ }
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
    var units = [{ id: 'intro', kind: 'intro', el: null, lane: 'The Hour Brief', title: 'Today’s brief', pos: '', chunks: chunk(editionIntro()) }];
    document.querySelectorAll('section.lane').forEach(function (lane) {
      var tagEl = lane.querySelector('.lane-tag');
      var tagClone = tagEl && tagEl.cloneNode(true);
      var tagTime = tagClone && tagClone.querySelector('.lane-time');     // "· 5 min" reading-time badge
      if (tagTime) tagTime.remove();
      var tag = speakable(tagClone ? tagClone.textContent : '') || 'This section';
      var lt = lane.querySelector('.lane-takeaway');
      var items = lane.querySelectorAll('.item[data-story-id]');
      if (!items.length) return;                 // e.g. the quiz section: nothing to read
      units.push({
        id: 'lane:' + (lane.id || ''), kind: 'lane', el: lane.querySelector('.lane-head'), lane: tag, title: tag, pos: '',
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
        units.push({ id: 'story:' + it.getAttribute('data-story-id'), kind: 'story', el: it, lane: tag, title: head, pos: (i + 1) + ' of ' + items.length, chunks: chunk(parts.join(' ')) });
      });
    });
    if (document.getElementById('quiz')) units.push({ id: 'outro', kind: 'outro', el: null, lane: 'The Hour Brief', title: 'That’s the brief', pos: '', chunks: chunk('That is today’s brief. Try the quiz below to see what stuck.') });
    else units.push({ id: 'outro', kind: 'outro', el: null, lane: 'The Hour Brief', title: 'That’s the brief', pos: '', chunks: chunk('That is today’s brief. See you tomorrow.') });
    units.forEach(function (u) {
      u.words = u.chunks.reduce(function (n, c) { return n + (c.match(/\S+/g) || []).length; }, 0);
    });
    return units;
  }
  function minutes(mode) {
    if (hasRec(mode)) return Math.max(1, Math.round(S.manifest.modes[mode].duration / 60 / S.rates[mode]));
    var w = S.units[mode].reduce(function (n, u) { return n + u.words; }, 0);
    return Math.max(1, Math.round(w / (WPM * S.rates[mode])));
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

  // ---- Recorded audio ----
  function hasRec(mode) { return !!S.cues[mode] && !S.bad[mode]; }
  function avail(mode) { return hasRec(mode) || !!synth; }
  function voiceName() { var v = (S.manifest && S.manifest.voice) || ''; return v ? v.charAt(0).toUpperCase() + v.slice(1) : 'AI'; }
  function recUrl(mode) { return AUDIO_BASE + '/audio/' + S.date + '/' + S.manifest.modes[mode].file; }

  // Timings are used only if every unit on this page has one (the page and the recording must agree).
  function mapCues(mode) {
    var m = S.manifest && S.manifest.modes && S.manifest.modes[mode];
    if (!m || !/^[a-z]+\.[0-9a-f]{8}\.mp3$/.test(m.file) || !Array.isArray(m.cues) || !(m.duration > 0)) return;
    var byId = {}, out = [];
    m.cues.forEach(function (c) { byId[c.id] = c; });
    for (var i = 0; i < S.units[mode].length; i++) {
      var c = byId[S.units[mode][i].id];
      if (!c || !(c.end > c.start) || (i && c.start < out[i - 1].start)) return;
      out.push(c);
    }
    S.cues[mode] = out;
  }
  function loadManifest(done) {
    var page = document.querySelector('[data-edition-date]');
    var date = page && page.getAttribute('data-edition-date');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !window.fetch) { done(); return; }
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, 6000);
    fetch(AUDIO_BASE + '/audio/' + date + '/manifest.json', { cache: 'no-cache', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('no recording'); return r.json(); })
      .then(function (m) {
        if (!m || m.v !== 1 || !m.modes) return;
        S.manifest = m;
        S.date = date;
        MODES.forEach(mapCues);      // Full has no recording today, but would be used if one existed
      })
      .catch(function () { /* no recording today: the device voice is used */ })
      .then(function () { clearTimeout(t); done(); });
  }

  function ensureAudio() {
    if (audio) return audio;
    audio = new Audio();
    audio.preload = 'auto';
    try { audio.preservesPitch = true; audio.webkitPreservesPitch = true; } catch (e) { /* ignore */ }
    audio.addEventListener('timeupdate', recSync);
    audio.addEventListener('seeked', function () { S.seeking = false; recSync(); });
    audio.addEventListener('ended', function () { if (S.src === 'rec' && S.state !== 'idle') finish(); });
    audio.addEventListener('error', function () { if (S.src === 'rec' && S.state !== 'idle' && audio.getAttribute('src')) recFail(); });
    // Lock-screen or headset controls can pause/resume the element directly: keep our state truthful.
    audio.addEventListener('pause', function () { if (S.src === 'rec' && S.state === 'playing' && !audio.ended && !S.seeking) { S.state = 'paused'; render(); } });
    audio.addEventListener('play', function () { if (S.src === 'rec' && S.state === 'paused') { S.state = 'playing'; render(); } });
    return audio;
  }
  // Follow the recording: highlight whichever story is being read.
  function recSync() {
    if (S.src !== 'rec' || S.state !== 'playing' || S.seeking || !audio) return;
    var cues = S.cues[S.mode], t = audio.currentTime, j = 0;
    while (j + 1 < cues.length && cues[j + 1].start <= t + 0.05) j++;
    if (j !== S.ui) { S.ui = j; S.ci = 0; light(S.list[j].el); render(); mediaMeta(); }
  }
  function recGo() {
    var a = ensureAudio(), url = recUrl(S.mode);
    if (a.getAttribute('src') !== url) a.src = url;
    a.playbackRate = S.rate;
    if (S.seekTo != null) {
      S.seeking = true;
      a.currentTime = S.seekTo;
      S.seekTo = null;
      setTimeout(function () { S.seeking = false; }, 1500);     // safety: never stay stuck waiting for "seeked"
    }
    var p = a.play();
    if (p && p.catch) p.catch(function (e) { if (S.src === 'rec' && S.state === 'playing' && !(e && e.name === 'AbortError')) recFail(); });
    mediaMeta();
  }
  // The recording would not play: carry on from this story in the device voice (or say so if it cannot speak).
  function recFail() {
    S.bad[S.mode] = true;
    if (audio) audio.pause();
    if (synth) { S.src = 'tts'; S.ci = 0; go(); render(); }
    else fail();
  }
  function mediaMeta() {
    var ms = navigator.mediaSession;
    if (!ms || S.src !== 'rec' || typeof window.MediaMetadata !== 'function') return;
    var u = S.list[S.ui] || {};
    try {
      ms.metadata = new window.MediaMetadata({
        title: u.title || 'The Hour Brief',
        artist: 'The Hour Brief · ' + (u.lane || 'Daily brief'),
        album: 'Edition ' + (S.manifest.edition || ''),
        artwork: [{ src: '/og-image.png', sizes: '1200x630', type: 'image/png' }],
      });
    } catch (e) { /* ignore */ }
  }
  function mediaActions() {
    var ms = navigator.mediaSession;
    if (!ms) return;
    var set = function (name, fn) { try { ms.setActionHandler(name, fn); } catch (e) { /* not supported here */ } };
    set('play', function () { if (S.state === 'paused') toggle(); });
    set('pause', function () { if (S.state === 'playing') toggle(); });
    set('previoustrack', function () { skip(-1); });
    set('nexttrack', function () { skip(1); });
    set('seekbackward', function () { if (audio) audio.currentTime = Math.max(0, audio.currentTime - 10); });
    set('seekforward', function () { if (audio) audio.currentTime = audio.currentTime + 10; });
    set('stop', function () { stop(); });
  }
  // Stop whatever is making sound (both sources, so a switch can never leave the other one running).
  function haltAll() {
    if (audio) audio.pause();
    if (synth) { try { synth.cancel(); } catch (e) { /* ignore */ } }
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
    if (!synth) { fail(); return; }
    if (synth.watch) S.dog = setTimeout(function () { if (gen === S.gen && !S.started) fail(); }, 8000);
    try { synth.speak(text, S.rate, hooks); } catch (e) { fail(); }
  }
  // Start (or restart) the current chunk; used after any jump, pause/resume and speed change.
  function go() {
    clearTimers();
    S.gen++;
    if (S.src === 'rec') { recGo(); return; }
    if (synth) { try { synth.cancel(); } catch (e) { /* ignore */ } }
    S.timer = setTimeout(speakChunk, 90);
  }
  function enter(i) {
    S.ui = Math.max(0, Math.min(S.list.length - 1, i));
    S.ci = 0;
    var u = S.list[S.ui];
    light(u.el);
    if (S.src === 'rec') S.seekTo = S.cues[S.mode][S.ui].start;     // a jump: the recording must seek there
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
    if (S.src === 'rec' && audio) audio.pause();
    S.state = 'done';
    light(null);
    render();
  }
  function fail() {
    clearTimers();
    S.gen++;
    haltAll();
    S.state = 'error';
    render();
  }

  function begin(mode) {
    var carry = S.state === 'playing' || S.state === 'paused';
    var el = carry && S.list[S.ui] && S.list[S.ui].el;
    haltAll();
    S.mode = mode;
    S.rate = S.rates[mode];                       // each length keeps its own speed (Full starts at 1.25x)
    S.list = S.units[mode];
    S.src = hasRec(mode) ? 'rec' : 'tts';
    save();
    ensurePlayer();
    var at = 0;
    if (el) {                          // switching length mid-listen: carry on from the same story
      for (var i = 0; i < S.list.length; i++) if (S.list[i].el === el) { at = i; break; }
    }
    if (S.src === 'tts' && !synth) { S.state = 'error'; render(); return; }
    S.state = 'playing';
    enter(at);
    go();
  }
  function toggle() {
    if (S.state === 'playing') { S.state = 'paused'; clearTimers(); S.gen++; haltAll(); render(); }
    else if (S.state === 'paused') { S.state = 'playing'; render(); go(); }
    else if (S.state === 'done' || S.state === 'error') {
      var retry = S.state === 'error';
      S.src = hasRec(S.mode) ? 'rec' : 'tts';
      S.state = 'playing';
      enter(retry ? S.ui : 0);
      go();
    }
  }
  function skip(dir) {
    if (S.state === 'done') return;
    var to = S.ui + dir;
    var inside = S.src === 'rec' ? (!!audio && audio.currentTime - S.cues[S.mode][S.ui].start > 3) : S.ci > 0;
    if (dir < 0 && inside) to = S.ui;            // first tap on "previous" restarts this story
    if (to < 0 || to > S.list.length - 1) return;
    S.state = 'playing';
    enter(to);
    go();
  }
  function stop() {
    clearTimers();
    S.gen++;
    haltAll();
    if (audio) { audio.removeAttribute('src'); try { audio.load(); } catch (e) { /* ignore */ } }
    try { if (navigator.mediaSession) navigator.mediaSession.playbackState = 'none'; } catch (e) { /* ignore */ }
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
      var top = mk('div', 'hb-pl-top');
      laneEl = mk('span', 'hb-pl-lane');
      badgeEl = mk('span', 'hb-pl-voice');
      nowEl = mk('span', 'hb-pl-title');
      top.appendChild(laneEl);
      top.appendChild(badgeEl);
      now.appendChild(top);
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
        S.rates[S.mode] = S.rate;
        save();
        if (S.src === 'rec') { if (audio) audio.playbackRate = S.rate; }
        else if (S.state === 'playing') go();
        render();
      });
      close.addEventListener('click', function () { stop(); var b = cta && cta.querySelector('button'); if (b) b.focus({ preventScroll: true }); });
      [prevBtn, playBtn, nextBtn, rateBtn, close].forEach(function (b) { ctl.appendChild(b); });
      player.appendChild(now);
      player.appendChild(ctl);
      document.body.appendChild(player);
      mediaActions();
    }
    player.hidden = false;
    document.body.classList.add('hb-listening');
  }

  function render() {
    if (cta) {
      var on = S.state !== 'idle';
      cta.querySelectorAll('button[data-mode]').forEach(function (b) {
        var m = b.getAttribute('data-mode');
        b.hidden = !avail(m);
        b.setAttribute('aria-pressed', String(on && S.mode === m));
        b.querySelector('.hb-cta-min').textContent = minutes(m) + ' min';
      });
      var rec = [], dev = [];
      MODES.forEach(function (m) { if (avail(m)) (hasRec(m) ? rec : dev).push(m === 'quick' ? 'Quick' : 'Full'); });
      noteEl.hidden = !rec.length;
      if (MODES.length === 1) noteEl.textContent = rec.length ? 'Read by ' + voiceName() + ', an AI voice.' : '';
      else noteEl.textContent = rec.length ? rec.join(' and ') + (rec.length > 1 ? ' are' : ' is') + ' read by ' + voiceName() + ', an AI voice.' +
        (dev.length ? ' ' + dev.join(' and ') + ' uses your device’s voice.' : '') : '';
    }
    if (!player || player.hidden) return;
    var u = S.list[S.ui] || {};
    if (S.state === 'error') {
      laneEl.textContent = 'Listen';
      nowEl.textContent = 'Audio isn’t available right now. Check your connection or your device’s text-to-speech settings.';
    } else if (S.state === 'done') {
      laneEl.textContent = 'Listen';
      nowEl.textContent = 'That’s the brief. Thanks for listening.';
    } else {
      laneEl.textContent = (u.lane || '') + (u.pos ? ' · ' + u.pos : '') + (S.state === 'paused' ? ' · Paused' : '');
      nowEl.textContent = u.title || '';
    }
    badgeEl.textContent = S.state === 'error' || S.state === 'done' ? '' : S.src === 'rec' ? 'AI voice · ' + voiceName() : 'Device voice';
    var playing = S.state === 'playing';
    var again = S.state === 'done' || S.state === 'error';
    try { if (S.src === 'rec' && navigator.mediaSession) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch (e) { /* ignore */ }
    playBtn.innerHTML = playing ? I_PAUSE : again ? I_REPLAY : I_PLAY;
    playBtn.setAttribute('aria-label', playing ? 'Pause' : again ? 'Play again' : 'Play');
    prevBtn.disabled = S.state === 'done' || (S.ui === 0 && (S.src === 'rec' ? !audio || audio.currentTime - S.cues[S.mode][0].start <= 3 : S.ci === 0));
    nextBtn.disabled = S.state === 'done' || S.ui >= S.list.length - 1;
    rateBtn.textContent = String(S.rate).replace(/^0\./, '.') + '×';
    rateBtn.setAttribute('aria-label', 'Speed ' + S.rate + ' times. Tap to change.');
  }

  function ensureCta() {
    var host = document.querySelector('.reader-tools');
    if (!host || !S.units.quick.some(function (u) { return u.kind === 'story'; }) || !(synth || hasRec('quick') || hasRec('full'))) return;
    if (!cta) {
      cta = mk('div', 'listen-cta');
      cta.setAttribute('role', 'group');
      cta.setAttribute('aria-label', 'Listen to today’s brief');
      var t = mk('div', 'listen-cta-t');
      t.innerHTML = I_HEAD;
      t.appendChild(mk('span', '', 'Listen to today’s brief'));
      var row = mk('div', 'listen-cta-b' + (MODES.length === 1 ? ' single' : ''));
      [['quick', 'Quick', 'headlines and takeaways'], ['full', 'Full', 'every story in full']].filter(function (m) { return MODES.indexOf(m[0]) >= 0; }).forEach(function (m) {
        var b = mk('button', 'listen-cta-btn');
        b.type = 'button';
        b.setAttribute('data-mode', m[0]);
        b.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-label', MODES.length === 1 ? 'Listen to today’s brief: ' + m[2] : 'Listen: ' + m[1].toLowerCase() + ' version, ' + m[2]);
        b.innerHTML = '<span class="hb-cta-name"></span><span class="hb-cta-min"></span>';
        b.querySelector('.hb-cta-name').textContent = MODES.length === 1 ? 'Play the brief' : m[1];
        b.addEventListener('click', function () {
          if (S.state === 'playing' && S.mode === m[0]) toggle();       // tapping the active length pauses
          else if (S.state === 'paused' && S.mode === m[0]) toggle();
          else begin(m[0]);
        });
        row.appendChild(b);
      });
      noteEl = mk('p', 'listen-cta-note');
      noteEl.hidden = true;
      cta.appendChild(t);
      cta.appendChild(row);
      cta.appendChild(noteEl);
    }
    if (cta.parentNode !== host.parentNode || cta.previousElementSibling !== host) host.insertAdjacentElement('afterend', cta);
    cta.hidden = !reader();
    render();
  }

  // Coming back to the app after the OS suspended speech: carry on from this sentence.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && S.state === 'playing' && S.src === 'tts' && synth && !synth.busy()) go();
  });
  window.addEventListener('pagehide', function () { haltAll(); });
  mq.addEventListener('change', function () { if (cta) cta.hidden = !reader(); if (!reader()) stop(); });

  function init() {
    load();
    S.units = {};
    MODES.forEach(function (m) { S.units[m] = build(m); });
    S.list = S.units[S.mode];
    ensureCta();                                   // shown at once where the device can speak
    loadManifest(function () { ensureCta(); render(); });   // then upgraded once we know there is a recording
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.HBListen = { start: begin, stop: stop, state: function () { return S.state; }, source: function () { return S.src; } };
})();
