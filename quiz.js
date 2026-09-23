/*
 * quiz.js — the anonymous daily quiz for The Hour Brief.
 *
 * Reads the edition's questions from <script type="application/json" id="quiz-data">,
 * renders them into #quiz-root, and keeps results in this device's localStorage
 * (no accounts, no names). The only thing sent to the server is an anonymous score
 * count (/api/quiz-stats) so readers can see how they compare. Pages without quiz
 * data are left untouched (the section and its nav link are hidden).
 */
(function () {
  'use strict';

  var dataEl = document.getElementById('quiz-data');
  var section = document.getElementById('quiz');
  var root = document.getElementById('quiz-root');
  if (!dataEl || !section || !root) return;

  var data = null;
  try { data = JSON.parse(dataEl.textContent); } catch (e) { /* handled below */ }

  var questions = ((data && data.questions) || []).filter(function (q) {
    return q && typeof q.q === 'string' && Array.isArray(q.options) && q.options.length >= 2 &&
      q.options.length <= 6 && q.options.every(function (o) { return typeof o === 'string'; }) &&
      Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length;
  }).slice(0, 10);

  var pageEl = document.querySelector('[data-edition-date]');
  var DATE = (data && data.date) || (pageEl && pageEl.getAttribute('data-edition-date')) || '';
  var navLink = document.querySelector('.nav a[href="#quiz"]');

  if (!questions.length || !DATE) {
    section.hidden = true;
    if (navLink) navLink.hidden = true;
    return;
  }

  var N = questions.length;
  var KEY = 'hb-quiz-v1';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- storage (best effort; the quiz works without it) ----------
  function load() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || '{}');
      return o && o.r ? o : { r: {} };
    } catch (e) { return { r: {} }; }
  }
  function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* ignore */ } }

  // ---------- helpers ----------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function prevDay(d) { return new Date(Date.parse(d + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function prettyDate(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] : d;
  }
  function toast(msg) {
    var t = document.querySelector('.quiz-toast');
    if (!t) { t = el('div', 'quiz-toast'); t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2200);
  }
  function haptic(ok) {
    try {
      var P = window.Capacitor && window.Capacitor.Plugins;
      if (P && P.Haptics && P.Haptics.notification) P.Haptics.notification({ type: ok ? 'SUCCESS' : 'ERROR' });
    } catch (e) { /* ignore */ }
  }
  function storyHeadline(id) {
    var it = id && document.querySelector('.item[data-story-id="' + id + '"]');
    var h = it && it.querySelector('h3');
    return h ? h.textContent.trim() : '';
  }
  function jumpToStory(id) {
    var it = document.querySelector('.item[data-story-id="' + id + '"]');
    if (!it) return;
    if (it.classList.contains('is-collapsed')) {
      var more = it.querySelector(':scope > div > .story-more');
      if (more && !more.hidden) more.click();
    }
    it.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    it.classList.remove('deeplinked');
    void it.offsetWidth;
    it.classList.add('deeplinked');
  }

  // ---------- streaks (consecutive published editions with a result) ----------
  var editionsPromise = null;
  function getEditions() {
    if (!editionsPromise) {
      editionsPromise = fetch('/editions.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          return ((d && d.editions) || []).map(function (e) { return e.date; }).filter(Boolean).sort();
        })
        .catch(function () { return []; });
    }
    return editionsPromise;
  }
  function streakEndingAt(dates, results, end) {
    var i = dates.indexOf(end), count = 0;
    if (i === -1) {
      for (var d = end; results[d]; d = prevDay(d)) count++;
      return count;
    }
    for (; i >= 0 && results[dates[i]]; i--) count++;
    return count;
  }

  // ---------- share ----------
  function squares(res) {
    if (!res.a) return '';
    return questions.map(function (q, i) { return res.a[i] === q.answer ? '🟩' : '🟥'; }).join('');
  }
  // Landing page with a "can you beat N/T?" preview card; it redirects to this edition's quiz.
  function shareUrl(res) {
    var bits = res.a ? questions.map(function (q, i) { return res.a[i] === q.answer ? '1' : '0'; }).join('') : '';
    return location.origin + '/q/' + DATE + '/' + res.s + '?sq=' + bits + (res.t !== 5 ? '&total=' + res.t : '') + '&utm_source=share&utm_medium=quiz';
  }
  function shareText(res, streak) {
    var lines = ['The Hour Brief quiz · ' + prettyDate(DATE), squares(res) + '  ' + res.s + '/' + res.t];
    if (streak >= 2) lines.push('🔥 ' + streak + '-day streak');
    lines.push('Can you beat me?');
    return lines.join('\n');
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { toast('Copied to clipboard'); });
    }
    var ta = el('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('Copied to clipboard'); } catch (e) { /* ignore */ }
    ta.remove();
    return Promise.resolve();
  }
  function share(text, url) {
    var Cap = window.Capacitor, P = (Cap && Cap.Plugins) || {};
    var native = Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform();
    var payload = { title: 'The Hour Brief quiz', text: text, url: url, dialogTitle: 'Share your score' };
    var p;
    if (native && P.Share) p = P.Share.share(payload);
    else if (navigator.share) p = navigator.share(payload);
    else p = copyText(text + '\n' + url);
    if (p && p.catch) p.catch(function () { /* user cancelled */ });
  }

  // ---------- shareable score image (drawn on the device, never uploaded) ----------
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function cardMessage(res) {
    var r = res.s / res.t;
    return r === 1 ? 'Perfect. Read closely.' : r >= 0.8 ? 'Sharp reading.' : r >= 0.6 ? 'Solid.' : r >= 0.4 ? 'Not bad.' : 'Tough one.';
  }
  function drawCard(res, streak) {
    var W = 1080, H = 1080;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var g = c.getContext('2d');
    var SANS = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    var SERIF = 'Georgia, "Times New Roman", serif';
    g.fillStyle = '#17191c'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#5b3e96'; g.fillRect(0, H - 18, W, 18);
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.font = '800 64px ' + SANS;
    g.fillStyle = '#f2f3ee'; g.fillText('THE HOUR', 72, 132);
    var w = g.measureText('THE HOUR ').width;
    g.fillStyle = '#a487d9'; g.fillText('BRIEF', 72 + w, 132);
    g.textAlign = 'right';
    g.font = '600 34px ' + SANS; g.fillStyle = '#9ba3a6';
    g.fillText(prettyDate(DATE).toUpperCase(), W - 72, 130);
    g.textAlign = 'center';
    g.font = '700 38px ' + SANS; g.fillStyle = '#a487d9';
    g.fillText('DAILY QUIZ', W / 2, 300);
    g.font = '700 300px ' + SERIF; g.fillStyle = '#f2f3ee';
    g.fillText(res.s + '/' + res.t, W / 2, 545);
    if (res.a) {
      var n = res.t, size = Math.min(110, Math.floor((W - 144 - (n - 1) * 20) / n)), gap = 20;
      var x0 = (W - (n * size + (n - 1) * gap)) / 2;
      questions.forEach(function (q, i) {
        g.fillStyle = res.a[i] === q.answer ? '#4fb579' : '#d9645f';
        roundRect(g, x0 + i * (size + gap), 660, size, size, 20);
        g.fill();
      });
    }
    g.font = '700 56px ' + SANS; g.fillStyle = '#f2f3ee';
    g.fillText(cardMessage(res), W / 2, 880);
    if (streak >= 2) {
      g.font = '600 44px ' + SANS; g.fillStyle = '#d9a94e';
      g.fillText('\uD83D\uDD25 ' + streak + '-day streak', W / 2, 942);
    }
    g.font = '700 46px ' + SANS; g.fillStyle = '#f2f3ee';
    g.fillText('Think you can beat me?', W / 2, 1002);
    g.font = '600 36px ' + SANS; g.fillStyle = '#a487d9';
    g.fillText('the-hour-brief.vercel.app', W / 2, 1046);
    return c;
  }
  function shareScore(res, streak) {
    var text = shareText(res, streak), url = shareUrl(res);
    var Cap = window.Capacitor, P = (Cap && Cap.Plugins) || {};
    var native = Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform();
    var canvas = null;
    try { canvas = drawCard(res, streak); } catch (e) { /* fall back to text */ }
    if (!canvas) return share(text, url);
    var full = text + '\n' + url;
    if (native && P.Filesystem && P.Share) {
      var b64 = canvas.toDataURL('image/png').split(',')[1];
      P.Filesystem.writeFile({ path: 'hour-brief-quiz-' + DATE + '.png', data: b64, directory: 'CACHE' })
        .then(function (r) {
          var p = P.Share.share({ title: 'The Hour Brief quiz', text: full, files: [r.uri], dialogTitle: 'Share your score' });
          if (p && p.catch) p.catch(function () { /* cancelled */ });
        }, function () { share(text, url); });
      return;
    }
    if (navigator.canShare && navigator.share && canvas.toBlob) {
      canvas.toBlob(function (blob) {
        var file = null;
        try { file = blob && new File([blob], 'hour-brief-quiz.png', { type: 'image/png' }); } catch (e) { /* ignore */ }
        if (file && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: 'The Hour Brief quiz', text: full }).catch(function () { /* cancelled */ });
        } else {
          share(text, url);
        }
      }, 'image/png');
      return;
    }
    share(text, url);
  }

  // ---------- friend challenge (?beat=N on a shared link) ----------
  var friendBeat = null;
  try {
    var b = new URLSearchParams(location.search).get('beat');
    if (b !== null && /^\d+$/.test(b) && +b <= N) friendBeat = +b;
  } catch (e) { /* ignore */ }

  // ---------- state + rendering ----------
  var saved = load().r[DATE] || null;
  var picks = [];
  var practice = false;

  function progress(i, done) {
    var bar = el('div', 'quiz-progress');
    bar.appendChild(el('span', '', done ? 'Quiz complete' : 'Question ' + (i + 1) + ' of ' + N));
    var dots = el('div', 'quiz-dots');
    dots.setAttribute('aria-hidden', 'true');
    for (var k = 0; k < N; k++) {
      var cls = 'quiz-dot';
      if (k < picks.length) cls += picks[k] === questions[k].answer ? ' ok' : ' no';
      else if (k === i && !done) cls += ' now';
      dots.appendChild(el('span', cls));
    }
    bar.appendChild(dots);
    return bar;
  }

  function showQuestion(i, focus) {
    var q = questions[i];
    root.textContent = '';
    var card = el('div', 'quiz-card');
    if (friendBeat !== null && i === 0 && !practice) {
      card.appendChild(el('p', 'quiz-friend', 'A friend scored ' + friendBeat + '/' + N + ' on this quiz. Can you beat it?'));
    }
    card.appendChild(progress(i, false));
    var qEl = el('p', 'quiz-q', q.q);
    qEl.id = 'quiz-q';
    qEl.tabIndex = -1;
    card.appendChild(qEl);

    var opts = el('div', 'quiz-opts');
    opts.setAttribute('role', 'group');
    opts.setAttribute('aria-labelledby', 'quiz-q');
    var btns = [];
    q.options.forEach(function (text, idx) {
      var b = el('button', 'quiz-opt');
      b.type = 'button';
      b.appendChild(el('span', 'quiz-key', String.fromCharCode(65 + idx)));
      b.appendChild(el('span', '', text));
      b.addEventListener('click', function () { answer(i, idx, btns, card); });
      btns.push(b);
      opts.appendChild(b);
    });
    card.appendChild(opts);

    var live = el('div', 'quiz-feedback');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    card.appendChild(live);
    root.appendChild(card);
    if (focus) qEl.focus({ preventScroll: true });
  }

  function mark(btn, text) {
    var m = el('span', 'quiz-mark', text);
    btn.appendChild(m);
  }

  function answer(i, idx, btns, card) {
    if (picks.length > i) return;
    var q = questions[i];
    var ok = idx === q.answer;
    picks.push(idx);
    haptic(ok);
    btns.forEach(function (b, k) {
      b.setAttribute('aria-disabled', 'true');
      if (k === q.answer) { b.classList.add('is-correct'); mark(b, ok ? '✓ Correct' : '✓ Answer'); }
      else if (k === idx) { b.classList.add('is-wrong'); mark(b, '✗ Your pick'); }
    });
    var dots = card.querySelectorAll('.quiz-dot');
    if (dots[i]) dots[i].className = 'quiz-dot ' + (ok ? 'ok' : 'no');

    var live = card.querySelector('.quiz-feedback');
    var why = el('div', 'quiz-why');
    why.appendChild(el('span', '', (ok ? 'Correct. ' : 'Not quite. ') + (q.why || '')));
    var head = storyHeadline(q.story);
    if (head) {
      why.appendChild(document.createElement('br'));
      var from = el('button', 'quiz-from', 'From “' + head + '” →');
      from.type = 'button';
      from.addEventListener('click', function () { jumpToStory(q.story); });
      why.appendChild(from);
    }
    live.appendChild(why);

    var actions = el('div', 'quiz-actions');
    var last = i + 1 >= N;
    var next = el('button', 'quiz-btn primary', last ? 'See my score' : 'Next question');
    next.type = 'button';
    next.addEventListener('click', function () { if (last) finish(); else showQuestion(i + 1, true); });
    actions.appendChild(next);
    live.appendChild(actions);
    next.focus({ preventScroll: true });
  }

  function finish() {
    var score = picks.reduce(function (s, p, k) { return s + (p === questions[k].answer ? 1 : 0); }, 0);
    var res = { s: score, t: N, a: picks.slice() };
    if (!practice) {
      var all = load();
      all.r[DATE] = res;
      save(all);
      saved = res;
    }
    showResult(practice ? res : saved, !practice, !practice);
  }

  // ---------- badges + review prompt (kept on this device) ----------
  var BADGES = [
    { id: 'first', icon: '\uD83C\uDFAF', name: 'First quiz', desc: 'Finish your first daily quiz', goal: 1, val: function (s) { return s.played; } },
    { id: 'perfect', icon: '\uD83D\uDCAF', name: 'Perfect score', desc: 'Get every question right', goal: 1, val: function (s) { return s.perfects; } },
    { id: 'streak3', icon: '\uD83D\uDD25', name: 'On a roll', desc: 'Play 3 days in a row', goal: 3, val: function (s) { return s.best; } },
    { id: 'streak7', icon: '\u26A1', name: 'Week warrior', desc: 'Play 7 days in a row', goal: 7, val: function (s) { return s.best; } },
    { id: 'streak30', icon: '\uD83C\uDFC6', name: 'Month master', desc: 'Play 30 days in a row', goal: 30, val: function (s) { return s.best; } },
    { id: 'played10', icon: '\uD83D\uDCDA', name: 'Regular', desc: 'Finish 10 quizzes', goal: 10, val: function (s) { return s.played; } },
    { id: 'perfect5', icon: '\uD83E\uDDE0', name: 'Sharp mind', desc: 'Get 5 perfect scores', goal: 5, val: function (s) { return s.perfects; } },
    { id: 'champ', icon: '\uD83D\uDC51', name: 'League champion', desc: 'Top a friends league for a day', goal: 1, val: function (s) { return s.champ; } }
  ];

  function computeStats(dates) {
    var o = load(), results = o.r, keys = Object.keys(results).sort();
    var perfects = keys.filter(function (k) { return results[k].s === results[k].t; }).length;
    var best = 0, run = 0;
    if (dates.length) {
      dates.forEach(function (d) { if (results[d]) { run++; if (run > best) best = run; } else run = 0; });
    } else {
      keys.forEach(function (k, i) { run = i > 0 && prevDay(k) === keys[i - 1] ? run + 1 : 1; if (run > best) best = run; });
    }
    return { played: keys.length, perfects: perfects, best: Math.max(best, o.bs || 0), champ: o.champ || 0 };
  }

  function awardBadges(dates) {
    var o = load(), st = computeStats(dates), fresh = [];
    o.b = o.b || {};
    o.bs = Math.max(o.bs || 0, st.best);
    BADGES.forEach(function (b) {
      if (!o.b[b.id] && b.val(st) >= b.goal) { o.b[b.id] = DATE; fresh.push(b); }
    });
    save(o);
    return { fresh: fresh, stats: st };
  }

  function earnedCount() { var b = load().b || {}; return Object.keys(b).length; }

  function maybeAskReview(stats, score, streak) {
    var Cap = window.Capacitor, P = (Cap && Cap.Plugins) || {};
    var native = Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform();
    if (!native || !P.InAppReview || score < Math.ceil(N * 0.8)) return;
    if (!(streak >= 3 || stats.perfects >= 3)) return;
    var st = { t: 0, n: 0 };
    try { st = JSON.parse(localStorage.getItem('hb-review-v1') || '') || st; } catch (e) { /* first time */ }
    if (st.n >= 3 || Date.now() - st.t < 90 * 86400000) return;
    try { localStorage.setItem('hb-review-v1', JSON.stringify({ t: Date.now(), n: st.n + 1 })); } catch (e) { /* ignore */ }
    setTimeout(function () {
      try { var p = P.InAppReview.requestReview(); if (p && p.catch) p.catch(function () { /* the store decides whether to show it */ }); } catch (e) { /* ignore */ }
    }, 2000);
  }

  var sheetEl = null, sheetPrev = null;
  function sheetKey(e) { if (e.key === 'Escape') closeSheet(); }
  function closeSheet() {
    if (!sheetEl) return;
    sheetEl.remove();
    sheetEl = null;
    document.removeEventListener('keydown', sheetKey);
    if (sheetPrev && sheetPrev.focus) sheetPrev.focus();
  }
  function openSheet(title, build, returnTo) {
    closeSheet();
    sheetPrev = returnTo || document.activeElement;
    var bg = el('div', 'qz-sheet-bg');
    var box = el('div', 'qz-sheet');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', title);
    box.appendChild(el('h2', '', title));
    build(box);
    var close = el('button', 'quiz-btn qz-close', 'Close');
    close.type = 'button';
    close.addEventListener('click', closeSheet);
    box.appendChild(close);
    bg.appendChild(box);
    bg.addEventListener('click', function (e) { if (e.target === bg) closeSheet(); });
    document.addEventListener('keydown', sheetKey);
    document.body.appendChild(bg);
    sheetEl = bg;
    close.focus({ preventScroll: true });
  }

  function openBadges(returnTo) {
    getEditions().then(function (dates) {
      var st = computeStats(dates), got = load().b || {};
      openSheet('Your badges', function (box) {
        box.appendChild(el('p', 'qz-stats', st.played + ' played \u00B7 best streak ' + st.best + ' \u00B7 ' + st.perfects + ' perfect'));
        var ul = el('ul', 'qz-badges');
        BADGES.forEach(function (b) {
          var earned = !!got[b.id];
          var li = el('li', earned ? 'qz-earned' : 'qz-locked');
          var icon = el('span', 'qz-badge-icon', b.icon);
          icon.setAttribute('aria-hidden', 'true');
          var text = el('div');
          text.appendChild(el('b', '', b.name));
          text.appendChild(el('span', 'qz-badge-desc', b.desc));
          text.appendChild(el('span', 'qz-badge-state', earned ? 'Earned ' + prettyDate(got[b.id]) : Math.min(b.val(st), b.goal) + ' / ' + b.goal));
          li.appendChild(icon);
          li.appendChild(text);
          ul.appendChild(li);
        });
        box.appendChild(ul);
      }, returnTo);
    });
  }

  function message(res) {
    var r = res.s / res.t;
    if (r === 1) return 'Perfect. You read closely.';
    if (r >= 0.8) return 'Sharp reading.';
    if (r >= 0.6) return 'Solid. A couple slipped by.';
    if (r >= 0.4) return 'Not bad. The answers are all in today’s stories.';
    return 'Tough one. Check the review below.';
  }

  function showResult(res, official, fresh) {
    root.textContent = '';
    var card = el('div', 'quiz-card quiz-result');
    picks = res.a ? res.a.slice() : [];
    card.appendChild(progress(N, true));

    var score = el('p', 'quiz-score');
    score.appendChild(el('b', '', String(res.s)));
    score.appendChild(el('span', '', '/ ' + res.t));
    card.appendChild(score);
    var sq = squares(res);
    if (sq) {
      var sqEl = el('p', 'quiz-squares', sq);
      sqEl.setAttribute('aria-label', res.s + ' of ' + res.t + ' correct');
      card.appendChild(sqEl);
    }
    card.appendChild(el('p', 'quiz-msg', message(res)));

    var mine = load().r[DATE] || res;
    if (friendBeat !== null && official) {
      var vs = mine.s > friendBeat ? 'You beat your friend’s ' + friendBeat + '/' + N + '.'
        : mine.s === friendBeat ? 'You tied your friend’s ' + friendBeat + '/' + N + '.'
        : 'Your friend scored ' + friendBeat + '/' + N + '. Retake for practice?';
      card.appendChild(el('p', 'quiz-versus', vs));
    }
    var streakEl = el('p', 'quiz-streak');
    streakEl.hidden = true;
    card.appendChild(streakEl);
    var freshBox = el('div', 'quiz-fresh');
    freshBox.hidden = true;
    freshBox.setAttribute('role', 'status');
    card.appendChild(freshBox);
    var compare = el('div', 'quiz-compare');
    card.appendChild(compare);

    var actions = el('div', 'quiz-actions');
    var shareBtn = el('button', 'quiz-btn primary', 'Share my score');
    shareBtn.type = 'button';
    var streakN = 0;
    shareBtn.addEventListener('click', function () { shareScore(mine, streakN); });
    actions.appendChild(shareBtn);
    var reviewBtn = el('button', 'quiz-btn', 'Review answers');
    reviewBtn.type = 'button';
    reviewBtn.setAttribute('aria-expanded', 'false');
    actions.appendChild(reviewBtn);
    var badgesBtn = el('button', 'quiz-btn', 'Badges');
    badgesBtn.type = 'button';
    badgesBtn.addEventListener('click', function () { openBadges(badgesBtn); });
    actions.appendChild(badgesBtn);
    var again = el('button', 'quiz-btn', 'Retake for practice');
    again.type = 'button';
    again.addEventListener('click', function () { practice = true; picks = []; showQuestion(0, true); });
    actions.appendChild(again);
    card.appendChild(actions);

    var review = el('ol', 'quiz-review');
    review.hidden = true;
    questions.forEach(function (q, i) {
      var li = el('li');
      var right = res.a && res.a[i] === q.answer;
      li.appendChild(el('span', right ? 'yes' : 'no', right ? '✓ ' : '✗ '));
      li.appendChild(el('b', '', q.q));
      li.appendChild(document.createElement('br'));
      li.appendChild(document.createTextNode('Answer: ' + q.options[q.answer] + '. ' + (q.why || '')));
      review.appendChild(li);
    });
    card.appendChild(review);
    reviewBtn.addEventListener('click', function () {
      review.hidden = !review.hidden;
      reviewBtn.setAttribute('aria-expanded', String(!review.hidden));
      reviewBtn.textContent = review.hidden ? 'Review answers' : 'Hide answers';
    });
    root.appendChild(card);

    getEditions().then(function (dates) {
      var results = load().r;
      streakN = streakEndingAt(dates, results, DATE);
      if (streakN >= 2) { streakEl.textContent = ''; streakEl.appendChild(document.createTextNode('🔥 ')); streakEl.appendChild(el('b', '', streakN + '-day streak')); streakEl.hidden = false; }
      else if (streakN === 1 && dates[dates.length - 1] === DATE) { streakEl.textContent = 'Come back tomorrow to start a streak.'; streakEl.hidden = false; }
      var awarded = official ? awardBadges(dates) : { fresh: [], stats: computeStats(dates) };
      if (awarded.fresh.length) {
        freshBox.textContent = '';
        freshBox.appendChild(el('p', 'quiz-fresh-title', awarded.fresh.length > 1 ? 'New badges unlocked' : 'New badge unlocked'));
        awarded.fresh.forEach(function (b) {
          var row = el('p', 'quiz-fresh-row');
          row.appendChild(el('span', '', b.icon + ' '));
          row.appendChild(el('b', '', b.name));
          row.appendChild(document.createTextNode(' \u2014 ' + b.desc));
          freshBox.appendChild(row);
        });
        freshBox.hidden = false;
      }
      badgesBtn.textContent = 'Badges (' + earnedCount() + ')';
      if (fresh) maybeAskReview(awarded.stats, mine.s, streakN);
      updateChip(dates);
    });
    tally(mine, official, compare);
  }

  // ---------- anonymous "how you compare" ----------
  function tally(res, official, box) {
    var sentKey = 'hb-quiz-sent-' + DATE;
    var alreadySent = false;
    try { alreadySent = !!localStorage.getItem(sentKey); } catch (e) { /* ignore */ }
    var req;
    if (official && !alreadySent) {
      req = fetch('/api/quiz-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: DATE, score: res.s, total: res.t })
      });
    } else {
      req = fetch('/api/quiz-stats?date=' + encodeURIComponent(DATE) + '&total=' + res.t);
    }
    req.then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) return;
      if (d.ok !== false || d.reason === 'rate_limited' || d.reason === 'closed') {
        try { if (official) localStorage.setItem(sentKey, '1'); } catch (e) { /* ignore */ }
      }
      if (!d.dist) {
        // rejected submission: fall back to a plain read
        return fetch('/api/quiz-stats?date=' + encodeURIComponent(DATE) + '&total=' + res.t)
          .then(function (r) { return r.ok ? r.json() : null; }).then(function (g) { if (g && g.dist) renderCompare(box, g, res); });
      }
      renderCompare(box, d, res);
    }).catch(function () { /* the comparison is optional */ });
  }

  function renderCompare(box, d, res) {
    var dist = d.dist, n = d.n || dist.reduce(function (a, b) { return a + b; }, 0);
    if (!n) return;
    box.textContent = '';
    var line;
    if (n < 10) {
      line = n + ' reader' + (n === 1 ? '' : 's') + ' played so far — you’re helping set the bar.';
    } else {
      var better = 0;
      for (var k = 0; k < res.s; k++) better += dist[k];
      var pct = Math.round(100 * (better + dist[res.s] / 2) / n);
      line = pct >= 20
        ? 'You did better than ' + pct + '% of readers (' + n + ' played).'
        : 'Tough one — ' + (100 - pct) + '% of readers scored higher (' + n + ' played).';
    }
    box.appendChild(el('p', 'quiz-compare', line));
    if (n >= 10) {
      var max = Math.max.apply(null, dist) || 1;
      var chart = el('div', 'quiz-dist');
      chart.setAttribute('role', 'img');
      chart.setAttribute('aria-label', 'How readers scored: ' + dist.map(function (c, s) { return s + ' correct: ' + c; }).join(', '));
      dist.forEach(function (c, s) {
        var col = el('div', s === res.s ? 'mine' : '');
        var bar = el('i');
        bar.style.height = Math.max(4, Math.round(100 * c / max) * 0.5) + 'px';
        col.appendChild(bar);
        col.appendChild(el('span', '', String(s)));
        chart.appendChild(col);
      });
      box.appendChild(chart);
    }
  }

  // ---------- promo chip under the nav ----------
  var chip = null;
  function updateChip(dates) {
    var nav = document.querySelector('.nav');
    if (!nav) return;
    if (!chip) {
      chip = el('a', 'quiz-chip');
      chip.href = '#quiz';
      var tools = document.querySelector('.reader-tools');
      if (tools && !tools.hidden) tools.insertBefore(chip, tools.firstChild);
      else nav.insertAdjacentElement('afterend', chip);
    }
    var results = load().r, mine = results[DATE];
    var latest = dates.length ? dates[dates.length - 1] : DATE;
    var isLatest = latest === DATE;
    var streak = 0;
    if (isLatest) {
      streak = mine ? streakEndingAt(dates, results, DATE)
        : streakEndingAt(dates, results, dates.length > 1 ? dates[dates.length - 2] : prevDay(DATE));
    }
    var label;
    if (mine) {
      label = 'Quiz done: ' + mine.s + '/' + mine.t + (streak >= 2 ? ' · 🔥 ' + streak + '-day streak' : '');
    } else {
      label = (isLatest ? 'Today’s quiz' : 'Quiz for this edition') + ' · ' + N + ' questions' +
        (streak >= 1 ? ' · 🔥 keep your ' + streak + '-day streak' : ' · ~1 min');
    }
    chip.textContent = '';
    var icon = el('span', '', mine ? '✅' : '🧠');
    icon.setAttribute('aria-hidden', 'true');
    chip.appendChild(icon);
    chip.appendChild(el('span', '', label));
    chip.appendChild(el('span', '', mine ? 'Review →' : 'Play →'));
  }

  // ---------- start ----------
  if (saved && Array.isArray(saved.a)) showResult(saved, true);
  else showQuestion(0, false);
  updateChip([]);
  getEditions().then(updateChip);
})();
