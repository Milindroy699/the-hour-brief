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
    if (it && it.closest('[data-pref-off]')) return '';       // its section is switched off on this device: no link to nowhere
    var h = it && it.querySelector('h3');
    return h ? h.textContent.trim() : '';
  }
  // ret: where "Back to the quiz" returns to, when a story is opened from the quiz in player mode (owner, 2026-11-25:
  // "if I go to a card to revise from the quiz results, there should be an option to go back to the quiz").
  // { kind: 'answer', i } = that answer card, mid-quiz; { kind: 'result' } = the score.
  var backBtn = null;
  function hideBack() { if (backBtn) { backBtn.remove(); backBtn = null; } document.removeEventListener('hb:hub', backWatch); }
  function backWatch() {                               // gone once the reader is back on Challenge or Home by themselves
    var cl = document.documentElement.classList;
    if (cl.contains('hb-quiz-page') || cl.contains('hb-home-open')) hideBack();   // (the audio player is only a sheet over the story: it stays)
  }
  function showBack(ret) {
    hideBack();
    backBtn = el('button', 'qz-back');
    backBtn.type = 'button';
    backBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
    backBtn.appendChild(document.createTextNode(ret.kind === 'answer' ? 'Back to the quiz' : 'Back to your score'));
    function goBack() {
      if (!backBtn) return;
      hideBack();
      if (ret.kind === 'challenge') { if (window.HBChrome && window.HBChrome.tab) window.HBChrome.tab('quiz'); return; }   // the score on Challenge
      openPlayer(ret.kind === 'answer' ? { answer: ret.i } : 'result');
    }
    // On the finger lifting, not on "click": Android's WebView drops the click of a tap that lands while the deck below is
    // still settling, so it took two or three taps (owner, 2026-11-25). A drag that starts on the pill doesn't count.
    var t0 = null;
    backBtn.addEventListener('touchstart', function (e) { var p = e.touches[0]; t0 = { x: p.clientX, y: p.clientY }; }, { passive: true });
    backBtn.addEventListener('touchend', function (e) {
      var p = e.changedTouches[0];
      if (t0 && Math.abs(p.clientX - t0.x) < 12 && Math.abs(p.clientY - t0.y) < 12) { e.preventDefault(); goBack(); }
      t0 = null;
    });
    backBtn.addEventListener('click', goBack);
    document.body.appendChild(backBtn);
    setTimeout(function () { document.addEventListener('hb:hub', backWatch); }, 0);
  }
  function jumpToStory(id, ret) {
    var it = document.querySelector('.item[data-story-id="' + id + '"]');
    if (!it) return;
    if (ret && playerMode()) showBack(playOn ? ret : { kind: 'challenge' });   // from the score on Challenge (player closed): back to Challenge
    if (playOn) closePlayer();
    if (window.HBQuizPage && window.HBQuizPage.isOpen && window.HBQuizPage.isOpen()) window.HBQuizPage.close();   // the story lives in the normal page, which the dedicated quiz page (mobile.js) replaces while it's open
    if (window.HBOpenStory && window.HBOpenStory(id)) return;      // reading in Cards: the deck opens on this story's card

    it.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    it.classList.remove('deeplinked');
    void it.offsetWidth;
    it.classList.add('deeplinked');
  }

  // ---------- streaks (consecutive published editions with a result) ----------
  var editionsPromise = null, edNo = {};
  function getEditions() {
    if (!editionsPromise) {
      editionsPromise = fetch('/editions.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          var list = (d && d.editions) || [];
          list.forEach(function (e) { if (e && e.date && e.edition) edNo[e.date] = e.edition; });
          return list.map(function (e) { return e.date; }).filter(Boolean).sort();
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
  // Fonts and the logo the card uses; fetched ahead of time (when the result shows) so sharing is never delayed.
  var cardP = null;
  function cardAssets() {
    if (!cardP) {
      var fonts = (document.fonts && document.fonts.load)
        ? Promise.all([document.fonts.load('500 300px Newsreader'), document.fonts.load('700 40px "Space Grotesk"'), document.fonts.load('600 36px Inter')]).catch(function () { /* system fonts will do */ })
        : Promise.resolve();
      var logo = new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { resolve(null); };
        img.src = '/brand/logo-256.png';
      });
      var cap = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 1500); });
      cardP = Promise.race([Promise.all([fonts, logo]).then(function (a) { return a[1]; }), cap]);
    }
    return cardP;
  }
  // The picture that gets shared (2026-11-25): the same card as on screen, portrait 4:5 so it fills a story or a WhatsApp
  // preview: brand and date, the medal and tier, the big score, a bar per question, the line, the streak, the challenge.
  function wrapLines(g, text, maxW) {
    var words = String(text).split(' '), lines = [], cur = '';
    words.forEach(function (w) { var t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; });
    if (cur) lines.push(cur);
    return lines;
  }
  function drawCard(res, streak, logo, medal) {
    var W = 1080, H = 1350, PAD = 84;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var g = c.getContext('2d');
    var SANS = 'Inter, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    var LABEL = '"Space Grotesk", Inter, -apple-system, "Segoe UI", Roboto, sans-serif';
    var SERIF = 'Newsreader, Georgia, "Times New Roman", serif';
    var bg = g.createLinearGradient(0, 0, W * 0.6, H);
    bg.addColorStop(0, '#2a1f78'); bg.addColorStop(0.72, '#14122b'); bg.addColorStop(1, '#0e0c20');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    var glow = g.createRadialGradient(W, 0, 0, W, 0, 760);
    glow.addColorStop(0, 'rgba(232,176,75,0.30)'); glow.addColorStop(1, 'rgba(232,176,75,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    var glow2 = g.createRadialGradient(0, H, 0, 0, H, 900);
    glow2.addColorStop(0, 'rgba(108,83,245,0.55)'); glow2.addColorStop(1, 'rgba(108,83,245,0)');
    g.fillStyle = glow2; g.fillRect(0, 0, W, H);
    g.textBaseline = 'alphabetic';
    // brand row
    var x0 = PAD;
    if (logo) { g.save(); roundRect(g, PAD, 80, 72, 72, 18); g.clip(); g.drawImage(logo, PAD, 80, 72, 72); g.restore(); x0 = PAD + 96; }
    g.textAlign = 'left';
    g.font = '700 40px ' + LABEL; g.fillStyle = '#ffffff'; g.fillText('THE HOUR', x0, 132);
    var w = g.measureText('THE HOUR ').width;
    g.fillStyle = '#b9acff'; g.fillText('BRIEF', x0 + w, 132);
    g.textAlign = 'right';
    g.font = '700 30px ' + LABEL; g.fillStyle = '#ffd88a';
    g.fillText(prettyDate(DATE).toUpperCase(), W - PAD, 128);
    // medal + tier + score
    g.textAlign = 'left';
    var y = 300;
    if (medal) g.drawImage(medal, PAD - 6, y - 40, 230, 230);
    var sx = medal ? PAD + 250 : PAD;
    var tier = TIERS[tierOf(res)].toUpperCase();
    g.font = '700 30px ' + LABEL;
    var tw = g.measureText(tier).width + 44;
    g.fillStyle = 'rgba(255,216,138,0.18)'; roundRect(g, sx, y - 6, tw, 56, 28); g.fill();
    g.fillStyle = '#ffd88a'; g.fillText(tier, sx + 22, y + 32);
    g.font = '500 210px ' + SERIF; g.fillStyle = '#ffffff';
    g.fillText(String(res.s), sx - 6, y + 230);
    var sw = g.measureText(String(res.s)).width;
    g.font = '500 92px ' + SERIF; g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillText('of ' + res.t, sx + sw + 14, y + 230);
    // a bar per question
    if (res.a) {
      var n = res.t, gap = 18, bw = (W - 2 * PAD - (n - 1) * gap) / n;
      questions.forEach(function (q, i) {
        g.fillStyle = res.a[i] === q.answer ? '#3fbf95' : 'rgba(255,255,255,0.22)';
        roundRect(g, PAD + i * (bw + gap), 640, bw, 22, 11); g.fill();
      });
    }
    // the line
    g.font = '500 64px ' + SERIF; g.fillStyle = '#ffffff';
    var lines = wrapLines(g, cardMessage(res), W - 2 * PAD).slice(0, 2);
    lines.forEach(function (l, i) { g.fillText(l, PAD, 780 + i * 78); });
    var yy = 780 + lines.length * 78 + 20;
    if (streak >= 2) {
      g.font = '700 44px ' + SANS; g.fillStyle = '#ffd88a';
      g.fillText('🔥 ' + streak + '-day streak', PAD, yy + 30);
    }
    // the challenge
    g.fillStyle = 'rgba(255,255,255,0.1)'; roundRect(g, PAD, H - 250, W - 2 * PAD, 150, 36); g.fill();
    g.font = '700 50px ' + SANS; g.fillStyle = '#ffffff';
    g.fillText('Think you can beat me?', PAD + 44, H - 168);
    g.font = '600 34px ' + SANS; g.fillStyle = '#c9c4e4';
    g.fillText('Today’s 5 questions · the-hour-brief.vercel.app', PAD + 44, H - 118);
    return c;
  }
  function medalImg(tier) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = ART + 'medals/' + tier + '.webp';
      setTimeout(function () { resolve(null); }, 1500);
    });
  }
  function shareScore(res, streak) {
    if (window.HBUse) window.HBUse('quiz_share');
    var text = shareText(res, streak), url = shareUrl(res);
    Promise.all([cardAssets(), medalImg(tierOf(res))]).then(function (a) { shareCard(res, streak, text, url, a[0], a[1]); });
  }
  function shareCard(res, streak, text, url, logo, medal) {
    var Cap = window.Capacitor, P = (Cap && Cap.Plugins) || {};
    var native = Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform();
    var canvas = null;
    try { canvas = drawCard(res, streak, logo, medal); } catch (e) { /* fall back to text */ }
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

  // ---------- the full-screen quiz (phones and the apps, with Home; owner 2026-11-25) ----------
  // One question per screen, then its own answer card (right or wrong, the answer, why, the story), then the score with the
  // streak and badges: the page never scrolls under you. The same functions draw it; only where they draw (root) changes:
  // the player's stage while it is open, the Challenge pane (#quiz-root) otherwise, which then shows a start card.
  // HB_NO_HOME (tests, and the desktop website) keeps the quiz inline as before.
  var homeRoot = root, play = null, playStage = null, playOn = false, playPrev = null;
  function playerMode() {
    if (window.HB_NO_HOME) return false;
    var Cap = window.Capacitor, app = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
    return app || !!(window.matchMedia && window.matchMedia('(max-width: 640px)').matches);
  }
  function buildPlayer() {
    if (play) return;
    play = el('section', 'qz-play');
    play.hidden = true;
    play.setAttribute('role', 'dialog');
    play.setAttribute('aria-modal', 'true');
    play.setAttribute('aria-label', 'Today’s quiz');
    var top = el('div', 'qz-play-top');
    var x = el('button', 'qz-play-x');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close the quiz');
    x.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.addEventListener('click', closePlayer);
    top.appendChild(x);
    top.appendChild(el('span', 'qz-play-t', 'Today’s challenge'));
    playStage = el('div', 'qz-play-stage');
    play.appendChild(top);
    play.appendChild(playStage);
    document.body.appendChild(play);
    // Swipe up on an answer card for the next question (as in the stories apps); taps still work everywhere.
    var y0 = null;
    playStage.addEventListener('touchstart', function (e) { y0 = e.touches[0].clientY; }, { passive: true });
    playStage.addEventListener('touchend', function (e) {
      if (y0 === null) return;
      var dy = e.changedTouches[0].clientY - y0;
      y0 = null;
      var nx = playStage.querySelector('.qz-ans-next');
      if (nx && dy < -70 && playStage.scrollTop + playStage.clientHeight >= playStage.scrollHeight - 4) nx.click();
    }, { passive: true });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && playOn && !document.querySelector('.qz-cele, .qz-sheet-bg')) closePlayer(); });
  }
  function openPlayer(at) {
    hideBack();
    buildPlayer();
    if (!playOn) {
      playPrev = document.activeElement;
      play.hidden = false;
      playOn = true;
      root = playStage;
      document.documentElement.classList.add('qz-playing');
    }
    if (at === 'result') showResult(saved, true, false, true);
    else if (at && typeof at === 'object' && at.answer >= 0 && picks.length > at.answer) showAnswer(at.answer, picks[at.answer], picks[at.answer] === questions[at.answer].answer);
    else showQuestion(typeof at === 'number' ? at : 0, true);
  }
  function closePlayer() {
    if (!playOn) return;
    play.hidden = true;
    playOn = false;
    root = homeRoot;
    document.documentElement.classList.remove('qz-playing');
    if (saved) { practice = false; showResult(saved, true); } else showIntro();   // a practice retake left midway goes back to the score
    if (playPrev && playPrev.focus && document.contains(playPrev)) { try { playPrev.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }
  // The Challenge pane's start card (in player mode): what's ahead, and Start (or Continue, mid-quiz).
  function showIntro() {
    root.textContent = '';
    var card = el('div', 'quiz-card qz-intro');
    if (friendBeat !== null && !practice) card.appendChild(el('p', 'quiz-friend', 'A friend scored ' + friendBeat + '/' + N + ' on this quiz. Can you beat it?'));
    card.appendChild(el('span', 'qz-intro-k', 'Today’s challenge'));
    card.appendChild(el('p', 'qz-intro-t', N + ' questions on today’s edition'));
    var mid = picks.length > 0 && picks.length < N;
    card.appendChild(el('p', 'qz-intro-s', mid ? 'You’ve answered ' + picks.length + ' of ' + N + '. Pick up where you left off.' : 'One question at a time, then why the answer is right. About a minute.'));
    var go = el('button', 'quiz-btn primary qz-intro-go', mid ? 'Continue' : 'Start the quiz');
    go.type = 'button';
    go.addEventListener('click', function () { openPlayer(mid ? picks.length : 0); });
    card.appendChild(go);
    root.appendChild(card);
  }
  // An unfinished quiz survives a page change (reading a story, then Voices, then back): today's picks in sessionStorage,
  // restored on the next load in player mode, so Challenge offers Continue instead of starting over.
  var PICKS_KEY = 'hb-qz-picks-' + DATE;
  function keepPicks() { try { if (practice || saved) sessionStorage.removeItem(PICKS_KEY); else sessionStorage.setItem(PICKS_KEY, JSON.stringify(picks)); } catch (e) { /* this visit only */ } }
  function restorePicks() {
    try {
      var a = JSON.parse(sessionStorage.getItem(PICKS_KEY) || 'null');
      if (Array.isArray(a) && a.length < N && a.every(function (x, k) { return typeof x === 'number' && x >= 0 && x < questions[k].options.length; })) picks = a;
    } catch (e) { /* start fresh */ }
  }
  // Home's Play: straight into the player (or the score, if today's is done).
  window.HBQuizPlay = function () {
    if (saved && !practice) { if (window.HBQuizTab) window.HBQuizTab('quiz'); return false; }
    if (!playerMode()) return false;
    openPlayer(picks.length < N ? picks.length : 0);
    return true;
  };

  // The section a question's story belongs to ("AI & Tech"), for the small badge above the question
  function topicOf(q) {
    var it = q && q.story && document.querySelector('.item[data-story-id="' + q.story + '"]');
    var tag = it && it.closest('section.lane') && it.closest('section.lane').querySelector('.lane-tag');
    if (!tag) return '';
    var c = tag.cloneNode(true), t = c.querySelector('.lane-time');
    if (t) t.remove();
    return c.textContent.trim();
  }
  function progress(i, done) {
    var bar = el('div', 'quiz-progress');
    var left = el('span', 'quiz-where');
    var topic = done ? '' : topicOf(questions[i]);
    if (topic) left.appendChild(el('span', 'quiz-topic', topic));
    left.appendChild(el('span', 'quiz-count', done ? 'Quiz complete' : 'Question ' + (i + 1) + ' of ' + N));
    bar.appendChild(left);
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

  // The nudge below (the second pass, after scrollIntoView's own imprecise block positioning) used to always adjust
  // window scroll — fine while the quiz lived in the normal page, but it moved into its own fixed, internally-
  // scrolling overlay (see mobile.js's dedicated quiz page), where the real motion happens inside that container,
  // not the window. Finds the nearest scrollable ancestor and nudges that instead; returns null (meaning "use the
  // window, as before") when there isn't one, so the normal in-page case is completely unchanged.
  function scrollRoot(el) {
    for (var p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      var cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1) return p;
    }
    return null;
  }

  // Moves the page to an element, then checks it got there: some Android WebViews end a smooth scroll early, and the
  // layout can still be settling. Anything a reader does by hand (touch, wheel, keys) cancels the check.
  function bringIntoView(target, where, smooth) {
    var animate = smooth && !reduceMotion, done = false, evs = ['touchstart', 'wheel', 'keydown'];
    function stop() { done = true; evs.forEach(function (e) { window.removeEventListener(e, stop); }); }
    evs.forEach(function (e) { window.addEventListener(e, stop, { passive: true }); });
    target.scrollIntoView({ behavior: animate ? 'smooth' : 'auto', block: where === 'top' ? 'start' : 'nearest' });
    [animate ? 700 : 250, 1300].forEach(function (ms, n) {
      setTimeout(function () {
        if (done || !target.isConnected) return;
        var cs = getComputedStyle(target), r = target.getBoundingClientRect(), off;
        if (where === 'top') off = r.top - (parseFloat(cs.scrollMarginTop) || 0);
        else { var lim = window.innerHeight - (parseFloat(cs.scrollMarginBottom) || 0); off = r.bottom > lim ? r.bottom - lim : 0; }
        if (Math.abs(off) > 24) { var root = scrollRoot(target); if (root) root.scrollTop += off; else window.scrollBy({ top: off, behavior: 'auto' }); }
        if (n) stop();
      }, ms);
    });
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
    if (playOn) { card.classList.add('qz-in'); playStage.scrollTop = 0; if (focus) qEl.focus({ preventScroll: true }); return; }
    if (focus) {
      // A new question renders much shorter than the answered one it replaced, so the page doesn't scroll on its
      // own: without this the reader is left looking at whatever used to be below the old card.
      bringIntoView(card, 'top', true);
      qEl.focus({ preventScroll: true });
    }
  }

  function mark(btn, text) {
    var m = el('span', 'quiz-mark', text);
    btn.appendChild(m);
  }

  function answer(i, idx, btns, card) {
    if (i === 0 && window.HBUse) window.HBUse(practice ? 'quiz_retake_start' : 'quiz_start');
    if (picks.length > i) return;
    var q = questions[i];
    var ok = idx === q.answer;
    picks.push(idx);
    keepPicks();
    haptic(ok);
    btns.forEach(function (b, k) {
      b.setAttribute('aria-disabled', 'true');
      if (k === q.answer) { b.classList.add('is-correct'); mark(b, ok ? '✓ Correct' : '✓ Answer'); }
      else if (k === idx) { b.classList.add('is-wrong'); mark(b, '✗ Your pick'); }
    });
    var dots = card.querySelectorAll('.quiz-dot');
    if (dots[i]) dots[i].className = 'quiz-dot ' + (ok ? 'ok' : 'no');
    if (playOn) { setTimeout(function () { if (playOn && picks.length === i + 1) showAnswer(i, idx, ok); }, 650); refreshStreak(); return; }

    var live = card.querySelector('.quiz-feedback');
    var why = el('div', 'quiz-why');
    why.appendChild(el('span', 'quiz-why-label', 'Insight'));
    why.appendChild(el('span', 'quiz-why-text', (ok ? 'Correct. ' : 'Not quite. ') + (q.why || '')));
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
    // Only scrolls if the new feedback pushed the "Next question" button off the bottom (or behind the tab bar).
    bringIntoView(next, 'bottom', true);
    next.focus({ preventScroll: true });
    refreshStreak();
  }

  // The answer card (player): its own screen after each pick.
  function showAnswer(i, idx, ok) {
    var q = questions[i], last = i + 1 >= N;
    root.textContent = '';
    var card = el('div', 'quiz-card qz-ans qz-in ' + (ok ? 'ok' : 'no'));
    card.appendChild(progress(i, false));
    var v = el('div', 'qz-ans-v');
    v.tabIndex = -1;
    v.appendChild(el('span', 'qz-ans-ic', ok ? '✓' : '✗'));
    v.appendChild(el('b', '', ok ? 'Correct' : 'Not quite'));
    card.appendChild(v);
    card.appendChild(el('p', 'qz-ans-q', q.q));
    var a = el('div', 'qz-ans-a');
    a.appendChild(el('small', '', 'The answer'));
    a.appendChild(el('b', '', q.options[q.answer]));
    if (!ok) a.appendChild(el('span', 'qz-ans-mine', 'You picked: ' + q.options[idx]));
    card.appendChild(a);
    if (q.why) {
      var w = el('div', 'qz-ans-why');
      w.appendChild(el('small', '', 'Why'));
      w.appendChild(el('p', '', q.why));
      card.appendChild(w);
    }
    var head = storyHeadline(q.story);
    if (head) {
      var from = el('button', 'qz-ans-story');
      from.type = 'button';
      from.appendChild(el('small', '', 'Read the story'));
      from.appendChild(el('span', '', head));
      from.addEventListener('click', function () { jumpToStory(q.story, { kind: 'answer', i: i }); });
      card.appendChild(from);
    }
    // Next and its hint stay pinned to the bottom of the screen, however long the answer runs (owner, 2026-11-25)
    var foot = el('div', 'qz-ans-foot');
    var next = el('button', 'quiz-btn primary qz-ans-next', last ? 'See my score' : 'Next question');
    next.type = 'button';
    next.addEventListener('click', function () { if (last) finish(); else showQuestion(i + 1, true); });
    foot.appendChild(next);
    if (!last) foot.appendChild(el('span', 'qz-ans-hint', 'or swipe up'));
    card.appendChild(foot);
    root.appendChild(card);
    playStage.scrollTop = 0;
    v.focus({ preventScroll: true });
  }

  function finish() {
    if (window.HBUse) window.HBUse(practice ? 'quiz_retake' : 'quiz_done');
    var score = picks.reduce(function (s, p, k) { return s + (p === questions[k].answer ? 1 : 0); }, 0);
    var res = { s: score, t: N, a: picks.slice() };
    if (!practice) {
      res.h = new Date().getHours();               // the hour it was finished, for the Early bird badge
      var all = load();
      all.r[DATE] = res;
      save(all);
      saved = res;
      keepPicks();                                 // finished: nothing to resume
    }
    showResult(practice ? res : saved, !practice, !practice, true);
    if (!practice) syncScores();
    refreshStreak();
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
    { id: 'champ', icon: '\uD83D\uDC51', name: 'League champion', desc: 'Top a friends league for a day', goal: 1, val: function (s) { return s.champ; } },
    { id: 'earlybird', icon: '\uD83C\uDF05', name: 'Early bird', desc: 'Finish 5 quizzes before 8 AM', goal: 5, val: function (s) { return s.early; } },
    { id: 'century', icon: '\uD83D\uDCAF', name: 'Century', desc: 'Finish 100 quizzes', goal: 100, val: function (s) { return s.played; } }
  ];

  // ---------- reward art (brand/rewards/, cut by tools/brand/rewards_cutout.py) ----------
  var ART = '/brand/rewards/';
  var BADGE_ART = { first: 'first', perfect: 'perfect', streak3: 'streak3', streak7: 'streak7', streak30: 'streak30', played10: 'regular',
    perfect5: 'sharp', champ: 'champion', earlybird: 'earlybird', century: 'century' };
  function badgeImg(b, cls) {
    var im = el('img', cls || 'qz-medallion');
    im.src = ART + 'badges/' + (BADGE_ART[b.id] || 'locked') + '.webp';
    im.alt = '';
    im.decoding = 'async';
    return im;
  }
  // Result tiers: the medal on the score screen
  var TIERS = { perfect: 'Perfect', sharp: 'Sharp', solid: 'Solid', keepgoing: 'Keep going' };
  function tierOf(res) {
    var r = res.s / res.t;
    return r === 1 ? 'perfect' : r >= 0.8 ? 'sharp' : r >= 0.5 ? 'solid' : 'keepgoing';
  }
  // Streak flame stages: the flame grows at 3, 7, 30 and 100 days
  var STAGES = [['spark', 'Spark', 1], ['flame', 'Flame', 3], ['blaze', 'Blaze', 7], ['inferno', 'Inferno', 30], ['legend', 'Legend', 100]];
  function stageOf(n) { var st = STAGES[0]; STAGES.forEach(function (s) { if (n >= s[2]) st = s; }); return st; }
  function flameImg(n, cls) {
    var im = el('img', cls || 'qz-flame');
    im.src = ART + 'flames/' + stageOf(Math.max(1, n))[0] + '.webp';
    im.alt = '';
    im.decoding = 'async';
    return im;
  }

  function computeStats(dates) {
    var o = load(), results = o.r, keys = Object.keys(results).sort();
    var perfects = keys.filter(function (k) { return results[k].s === results[k].t; }).length;
    var best = 0, run = 0;
    if (dates.length) {
      dates.forEach(function (d) { if (results[d]) { run++; if (run > best) best = run; } else run = 0; });
    } else {
      keys.forEach(function (k, i) { run = i > 0 && prevDay(k) === keys[i - 1] ? run + 1 : 1; if (run > best) best = run; });
    }
    var early = keys.filter(function (k) { return typeof results[k].h === 'number' && results[k].h < 8; }).length;
    var right = 0, asked = 0;
    keys.forEach(function (k) { right += results[k].s || 0; asked += results[k].t || 0; });
    return { played: keys.length, perfects: perfects, best: Math.max(best, o.bs || 0), champ: o.champ || 0, early: early,
      acc: asked ? Math.round(right / asked * 100) : 0 };
  }

  function awardBadges(dates) {
    var o = load(), st = computeStats(dates), fresh = [];
    o.b = o.b || {};
    o.bs = Math.max(o.bs || 0, st.best);
    BADGES.forEach(function (b) {
      if (!o.b[b.id] && b.val(st) >= b.goal) { o.b[b.id] = DATE; fresh.push(b); }
    });
    save(o);
    if (fresh.length) renderTrophySoon();
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

  function message(res) {
    var miss = res.t - res.s, t = tierOf(res);
    if (t === 'perfect') return 'Every answer right. You read this morning closely.';
    if (t === 'sharp') return 'Sharp reading. ' + (miss === 1 ? 'Just one slipped by.' : miss + ' slipped by.');
    if (t === 'solid') return 'Good morning’s work. The ' + (miss === 1 ? 'one' : miss) + ' you missed ' + (miss === 1 ? 'is' : 'are') + ' in Review answers.';
    return 'Tough set today. Tomorrow is a fresh ' + (res.t === 5 ? 'five' : res.t) + '.';
  }

  // The score (owner, 2026-11-25, after a Stitch review): the score card first, drawn like the picture that gets shared, with
  // Share right under it, above the fold; then how others did; the answers folded away (open on a tap, calm colours); retake
  // and badges as quiet links. The same layout in the player and on Challenge later, where it used to feel crowded.
  var SHARE_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>';
  function showResult(res, official, fresh, focus) {
    root.textContent = '';
    var card = el('div', 'quiz-card quiz-result qz-res');
    picks = res.a ? res.a.slice() : [];

    var tier = tierOf(res);
    var hero = el('div', 'qz-hero qz-tier-' + tier);
    var top = el('div', 'qz-sc-top');
    var lg = el('img', 'qz-sc-logo');
    lg.src = '/brand/logo-128.png';
    lg.alt = '';
    top.appendChild(lg);
    top.appendChild(el('span', 'qz-sc-brand', 'The Hour Brief · Daily quiz'));
    top.appendChild(el('span', 'qz-sc-date', prettyDate(DATE)));
    hero.appendChild(top);
    var mid = el('div', 'qz-sc-mid');
    var medal = el('img', 'qz-medal');
    medal.src = ART + 'medals/' + tier + '.webp';
    medal.alt = '';
    mid.appendChild(medal);
    var sc = el('div', 'qz-sc-score');
    sc.appendChild(el('span', 'qz-tier', TIERS[tier]));
    var score = el('p', 'quiz-score');
    score.setAttribute('aria-label', res.s + ' of ' + res.t + ' correct');
    score.appendChild(el('b', '', String(res.s)));
    score.appendChild(el('span', '', 'of ' + res.t));
    sc.appendChild(score);
    mid.appendChild(sc);
    hero.appendChild(mid);
    if (res.a) {
      var sq = el('div', 'qz-sc-sq');
      sq.setAttribute('aria-hidden', 'true');
      questions.forEach(function (q, i) { sq.appendChild(el('i', res.a[i] === q.answer ? 'ok' : 'no')); });
      hero.appendChild(sq);
    }
    hero.appendChild(el('p', 'quiz-msg', message(res)));
    var streakEl = el('div', 'quiz-streak qz-res-streak');
    streakEl.hidden = true;
    hero.appendChild(streakEl);
    card.appendChild(hero);

    var mine = load().r[DATE] || res;
    if (friendBeat !== null && official) {
      var vs = mine.s > friendBeat ? 'You beat your friend’s ' + friendBeat + '/' + N + '.'
        : mine.s === friendBeat ? 'You tied your friend’s ' + friendBeat + '/' + N + '.'
        : 'Your friend scored ' + friendBeat + '/' + N + '. Retake for practice?';
      card.appendChild(el('p', 'quiz-versus', vs));
    }

    var actions = el('div', 'quiz-actions qz-res-acts');
    var shareBtn = el('button', 'quiz-btn primary qz-share');
    shareBtn.type = 'button';
    shareBtn.innerHTML = SHARE_SVG;
    shareBtn.appendChild(document.createTextNode('Share my score'));
    var streakN = 0;
    shareBtn.addEventListener('click', function () { shareScore(mine, streakN); });
    actions.appendChild(shareBtn);
    if (official) actions.appendChild(challengeButton(mine));
    card.appendChild(actions);

    var compare = el('div', 'quiz-compare');
    card.appendChild(compare);
    var freshBox = el('div', 'quiz-fresh');
    freshBox.hidden = true;
    freshBox.setAttribute('role', 'status');
    card.appendChild(freshBox);

    // Website only, on a fresh official result: the streak is the hook, and the app is what keeps it going.
    var G = window.HBGrowth;
    if (official && fresh && G && G.appPrompt) {
      var ap = G.appPrompt('quiz', 'Keep your streak going', 'The app reminds you each morning, when the new quiz is out');
      if (ap) card.appendChild(ap);
    }

    // Every answer, folded away: the missed ones first, each with its story
    if (res.a) {
      var missed = questions.map(function (q, i) { return i; }).filter(function (i) { return res.a[i] !== questions[i].answer; });
      var mbox = el('div', 'qz-missed');
      var head = el('button', 'qz-missed-head');
      head.type = 'button';
      head.setAttribute('aria-expanded', 'false');
      head.appendChild(el('span', '', 'Review answers'));
      head.appendChild(el('small', '', missed.length ? missed.length + ' missed' : 'all right'));
      mbox.appendChild(head);
      var list = el('div', 'qz-rv-list');
      list.hidden = true;
      var order = missed.concat(questions.map(function (q, i) { return i; }).filter(function (i) { return missed.indexOf(i) < 0; }));
      order.forEach(function (i) {
        var q = questions[i], right = res.a[i] === q.answer, row = el('div', 'qz-rv' + (right ? ' ok' : ' qz-miss'));
        row.appendChild(el('span', 'qz-rv-ic', right ? '✓' : '✗'));
        var tx = el('div', 'qz-rv-tx');
        tx.appendChild(el('p', 'qz-miss-q', q.q));
        tx.appendChild(el('p', 'qz-miss-a', 'Answer: ' + q.options[q.answer]));
        if (!right && q.options[res.a[i]] != null) tx.appendChild(el('p', 'qz-rv-mine', 'You picked: ' + q.options[res.a[i]]));
        if (q.why) tx.appendChild(el('p', 'qz-rv-why', q.why));
        if (q.story && document.getElementById(q.story)) {
          var go = el('button', 'qz-miss-go', 'Read the story');
          go.type = 'button';
          go.addEventListener('click', function () { jumpToStory(q.story, { kind: 'result' }); });
          tx.appendChild(go);
        }
        row.appendChild(tx);
        list.appendChild(row);
      });
      mbox.appendChild(list);
      head.addEventListener('click', function () {
        list.hidden = !list.hidden;
        head.setAttribute('aria-expanded', String(!list.hidden));
        if (!list.hidden && window.HBUse) window.HBUse('quiz_review');
      });
      card.appendChild(mbox);
    }

    var links = el('div', 'qz-res-links');
    var again = el('button', 'qz-link', 'Retake for practice');
    again.type = 'button';
    again.addEventListener('click', function () { practice = true; picks = []; if (playerMode()) openPlayer(0); else showQuestion(0, true); });
    var badgesBtn = el('button', 'qz-link', 'Badges');
    badgesBtn.type = 'button';
    badgesBtn.addEventListener('click', function () { closePlayer(); setTab('badges', true); });
    links.appendChild(again);
    links.appendChild(el('span', 'qz-dot', '·'));
    links.appendChild(badgesBtn);
    card.appendChild(links);
    if (playOn) {                                  // the player: Done, back to wherever the quiz was opened from
      var done = el('button', 'quiz-btn qz-play-done', 'Done');
      done.type = 'button';
      done.addEventListener('click', closePlayer);
      card.appendChild(done);
      card.classList.add('qz-in');
    }
    root.appendChild(card);
    if (playOn) playStage.scrollTop = 0;
    else if (focus) bringIntoView(card, 'top', true);   // same reason as showQuestion: the score card is shorter than the question it replaced

    cardAssets();                                   // warm the share card's fonts and logo
    getEditions().then(function (dates) {
      var results = load().r;
      streakN = streakEndingAt(dates, results, DATE);
      if (streakN >= 1 && official) {
        streakEl.textContent = '';
        streakEl.appendChild(flameImg(streakN));
        var stx = el('span', 'qz-res-st-tx');
        stx.appendChild(el('b', '', streakN === 1 ? 'Day 1' : String(streakN)));
        stx.appendChild(document.createTextNode(streakN === 1 ? ' · come back tomorrow for day 2' : '-day streak'));
        streakEl.appendChild(stx);
        streakEl.hidden = false;
      }
      var awarded = official ? awardBadges(dates) : { fresh: [], stats: computeStats(dates) };
      if (awarded.fresh.length) {
        freshBox.textContent = '';
        freshBox.appendChild(el('p', 'quiz-fresh-title', awarded.fresh.length > 1 ? 'New badges unlocked' : 'New badge unlocked'));
        awarded.fresh.forEach(function (b) {
          var row = el('p', 'quiz-fresh-row');
          row.appendChild(badgeImg(b, 'qz-fresh-img'));
          row.appendChild(el('b', '', b.name));
          row.appendChild(document.createTextNode(' \u2014 ' + b.desc));
          freshBox.appendChild(row);
        });
        freshBox.hidden = false;
      }
      // Fresh from finishing today's quiz: the milestone screen (3, 7, 14, 30… days), then each new badge
      if (fresh && official) celebrate(streakN, awarded.fresh);
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
      chip.addEventListener('click', function (e) {
        var q = document.getElementById('quiz');
        if (!q || q.hidden || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        bringIntoView(q, 'top', false);
      });
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
    var title, sub;
    if (mine) {
      title = 'Quiz done: ' + mine.s + '/' + mine.t;
      sub = streak >= 2 ? '🔥 ' + streak + '-day streak' : 'Nice reading';
    } else {
      title = (isLatest ? 'Today’s quiz' : 'Quiz for this edition') + ' · ' + N + ' questions';
      sub = streak >= 1 ? '🔥 keep your ' + streak + '-day streak' : '~1 min';
    }
    chip.textContent = '';
    var disc = el('span', 'qc-disc' + (mine ? ' done' : ''), mine ? '✓' : '🧠');
    disc.setAttribute('aria-hidden', 'true');
    var text = el('span', 'qc-text');
    text.appendChild(el('span', 'qc-title', title));
    text.appendChild(el('span', 'qc-sub', sub));
    chip.appendChild(disc);
    chip.appendChild(text);
    chip.appendChild(el('span', 'qc-go', mine ? 'Review →' : 'Play →'));
  }

  // ---------- streak card (a week strip from your own results), past quizzes ----------
  var section2 = document.getElementById('quiz');
  var streakBox = el('div', 'qz-streak');
  var headEl = section2 && section2.querySelector('.lane-head');
  if (headEl) headEl.insertAdjacentElement('afterend', streakBox); else root.insertAdjacentElement('beforebegin', streakBox);
  var pastBox = el('div', 'qz-past-box');
  var lastDates = [];
  var DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  function addDays(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
  // In the app: tell the server this phone's last played edition and its streak (no score, no answers), so the 21:00
  // "keep your streak" push goes only to phones that played yesterday and not yet today. Once per (date, streak).
  function reportStreak(dates, results) {
    var dev; try { dev = localStorage.getItem('hb-device-id-v1'); } catch (e) { dev = null; }
    if (!dev || !dates || !dates.length) return;
    var latest = dates[dates.length - 1], prev = dates.length > 1 ? dates[dates.length - 2] : null;
    var played = results[latest] ? latest : (prev && results[prev] ? prev : null);
    if (!played) return;
    var n = streakEndingAt(dates, results, played), flag = played + '|' + n;
    try { if (localStorage.getItem('hb-qd-last') === flag) return; } catch (e) { /* send anyway */ }
    fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'quiz_done', deviceId: dev, date: played, streak: n }) })
      .then(function (r) { if (r.ok) { try { localStorage.setItem('hb-qd-last', flag); } catch (e) { /* ignore */ } } }).catch(function () { /* next visit */ });
  }

  function refreshStreak(dates) {
    if (dates) lastDates = dates;
    var results = load().r, mine = results[DATE];
    reportStreak(lastDates, results);
    var latest = lastDates.length ? lastDates[lastDates.length - 1] : DATE;
    var streak = mine ? streakEndingAt(lastDates, results, DATE)
      : (latest === DATE ? streakEndingAt(lastDates, results, lastDates.length > 1 ? lastDates[lastDates.length - 2] : prevDay(DATE)) : 0);
    var st = computeStats(lastDates);
    streakBox.textContent = '';
    var top = el('div', 'qz-st-top');
    var pill = el('span', 'qz-st-pill' + (streak ? ' on' : ''));
    if (streak) pill.appendChild(flameImg(streak, 'qz-pill-flame'));
    pill.appendChild(document.createTextNode(streak ? streak + '-day streak · ' + stageOf(streak)[1] : 'Start a streak'));
    top.appendChild(pill);
    if (st.best >= 2) top.appendChild(el('span', 'qz-st-best', 'Best streak ' + st.best));
    streakBox.appendChild(top);
    var wd = new Date(Date.parse(DATE + 'T00:00:00Z')).getUTCDay();
    var monday = addDays(DATE, -((wd + 6) % 7));
    var week = el('div', 'qz-week');
    week.setAttribute('role', 'list');
    for (var k = 0; k < 7; k++) {
      var d = addDays(monday, k), cell = el('div', 'qz-day');
      cell.setAttribute('role', 'listitem');
      var state = results[d] ? 'done' : d === DATE ? 'today' : d > DATE ? 'later' : 'missed';
      cell.className += ' ' + state;
      cell.appendChild(el('span', 'qz-dl', DAY_LETTERS[k]));
      var dot = el('span', 'qz-dd', state === 'done' ? '✓' : (state === 'today' && !mine && streak >= 1 ? '🔥' : String(+d.slice(8))));
      dot.setAttribute('aria-hidden', 'true');
      cell.appendChild(dot);
      cell.setAttribute('aria-label', prettyDate(d) + (state === 'done' ? ', quiz played' : state === 'today' ? ', today' : ''));
      week.appendChild(cell);
    }
    streakBox.appendChild(week);
    var tile = el('div', 'qz-drill');
    var tx = el('div');
    var answered = mine ? N : Math.min(N, picks.length);
    tx.appendChild(el('b', '', mine ? 'Today’s quiz completed' : 'Today’s quiz'));
    tx.appendChild(el('span', '', mine ? mine.s + ' of ' + mine.t + ' correct' : answered + ' of ' + N + ' answered' + (answered < N ? ' · ' + (N - answered) + ' to go' : '')));
    tile.appendChild(tx);
    tile.appendChild(el('span', 'qz-drill-score', mine ? mine.s + '/' + mine.t : N + ' questions'));
    streakBox.appendChild(tile);
    renderPast();
    document.dispatchEvent(new CustomEvent('hb:quiz'));       // Home (home.js) redraws its streak strip and quiz card
  }
  function renderPast() {
    var results = load().r;
    var dates = Object.keys(results).filter(function (d) { return d !== DATE; }).sort().reverse().slice(0, 4);
    pastBox.textContent = '';
    pastBox.hidden = !dates.length;
    if (!dates.length) return;
    var head = el('div', 'qz-past-head');
    head.appendChild(el('h3', '', 'Past quizzes'));
    var all = el('a', '', 'Archive');
    all.href = '/archive/';
    head.appendChild(all);
    pastBox.appendChild(head);
    dates.forEach(function (d) {
      var r = results[d], row = el('a', 'qz-past');
      row.href = '/archive/' + d + '.html#quiz';
      row.appendChild(el('span', 'qz-past-no', edNo[d] ? ('00' + edNo[d]).slice(-3) : '·'));
      var tx = el('span', 'qz-past-tx');
      tx.appendChild(el('b', '', prettyDate(d)));
      tx.appendChild(el('small', '', r.t + ' questions'));
      row.appendChild(tx);
      row.appendChild(el('span', 'qz-past-score' + (r.s === r.t ? ' perfect' : ''), r.s + '/' + r.t));
      pastBox.appendChild(row);
    });
  }

  // ---------- friends leagues ----------
  // The server keeps only a generated league name, generated player names keyed by a random
  // device id, and one score per player per day. No accounts and no typed names.
  var LG_KEY = 'hb-league-v1';
  var MAX_LEAGUES = 3;
  var joinBox = el('div', 'qz-join');
  root.insertAdjacentElement('beforebegin', joinBox);
  var lgBox = el('div', 'qz-leagues');
  root.insertAdjacentElement('afterend', lgBox);
  var boards = {}, viewWeek = {}, lgMsg = '', lgBusy = false;

  function randomId() {
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function lgLoad() {
    try { var o = JSON.parse(localStorage.getItem(LG_KEY) || ''); if (o && o.mid) { o.leagues = o.leagues || []; return o; } } catch (e) { /* new device */ }
    return { mid: randomId(), leagues: [] };
  }
  function lgSave(o) { try { localStorage.setItem(LG_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ } }
  // One quiet retry when the request never got an answer (a phone switching networks, a cold start).
  function lgFetch(url, opts, retried) {
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, d: j }; });
    }, function (e) {
      if (retried) throw e;
      return new Promise(function (ok) { setTimeout(ok, 900); }).then(function () { return lgFetch(url, opts, true); });
    });
  }
  function lgPost(body) {
    return lgFetch('/api/league', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  function lgError(r) {
    if (r.status === 404) return 'That league no longer exists.';
    if (r.status === 409) return 'That league is full.';
    if (r.status === 400 && r.d && r.d.error && /[A-Z]/.test(r.d.error.charAt(0))) return r.d.error;   // the server's own words (a name it can't take)
    if (r.status === 429) return 'Too many leagues started from this network today. Please try again tomorrow.';
    lgReport(r);
    if (!r.status) return navigator.onLine === false ? 'You seem to be offline. Connect and try again.' : 'Could not reach leagues right now (no answer). Please try again.';
    return 'Something went wrong on our side (error ' + r.status + '). Please try again.';
  }
  // Tells the server what went wrong (its logs), so a failure seen on a phone can be traced: the status, the server's
  // words or the network error, and the browser. No device id, no league code.
  function lgReport(r) {
    try {
      var info = [lgDoing, r.status || 0, (r.d && r.d.error) || (r.err && (r.err.name + ' ' + r.err.message)) || '', navigator.onLine === false ? 'offline' : 'online',
        (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ? 'app' : 'web', navigator.userAgent].join(' | ').slice(0, 400);
      var u = '/api/league?diag=' + encodeURIComponent(info);
      if (navigator.sendBeacon) navigator.sendBeacon(u); else fetch(u, { method: 'POST', keepalive: true }).catch(function () { /* nothing to do */ });
    } catch (e) { /* never let reporting break anything */ }
  }
  var lgDoing = '';
  function setLgMsg(m) { lgMsg = m || ''; renderLeagues(); }

  function refreshBoard(code) {
    var st = lgLoad();
    return getEditions().then(function (dates) {
      var d = dates.length ? dates[dates.length - 1] : DATE;
      return lgFetch('/api/league?' + new URLSearchParams({ code: code, mid: st.mid, date: d }));
    }).then(function (r) {
      if (r.ok) {
        boards[code] = r.d; checkChampion(code, r.d);
        if (r.d.kind) { var s2 = lgLoad(), l2 = s2.leagues.filter(function (l) { return l.code === code; })[0]; if (l2 && l2.kind !== r.d.kind) { l2.kind = r.d.kind; lgSave(s2); } }
      } else if (r.status === 404) { boards[code] = { gone: true }; }
      else { lgDoing = 'board'; lgError(r); boards[code] = boards[code] || { failed: true }; }
      renderLeagues();
    }).catch(function (e) { lgDoing = 'board'; lgError({ err: e }); boards[code] = boards[code] || { failed: true }; renderLeagues(); });
  }

  function checkChampion(code, s) {
    var o = load();
    o.cd = o.cd || {};
    var added = 0;
    (s.hist || []).forEach(function (h) {
      var k = code + ':' + h.date;
      if (h.meWon && !o.cd[k]) { o.cd[k] = 1; added++; }
    });
    if (!added) return;
    o.champ = (o.champ || 0) + added;
    save(o);
    getEditions().then(function (dates) {
      var aw = awardBadges(dates);
      toast('👑 You topped ' + (s.name || 'your league') + '!');
      if (aw.fresh.length) toast('👑 New badge: ' + aw.fresh[0].name);
    });
  }

  function syncScores() {
    var st = lgLoad();
    var mine = load().r[DATE];
    if (!mine || !st.leagues.length || Math.abs(Date.now() - Date.parse(DATE + 'T00:00:00Z')) > 3 * 86400000) return;
    st.leagues.forEach(function (lg) {
      var flag = 'hb-lgs-' + lg.code + '-' + DATE, done = false;
      try { done = !!localStorage.getItem(flag); } catch (e) { /* ignore */ }
      if (done) { refreshBoard(lg.code); return; }
      lgPost({ action: 'score', code: lg.code, mid: st.mid, date: DATE, score: mine.s, total: mine.t }).then(function (r) {
        if (r.ok && r.d.standings) { try { localStorage.setItem(flag, '1'); } catch (e) { /* ignore */ } boards[lg.code] = r.d.standings; checkChampion(lg.code, r.d.standings); renderLeagues(); }
        else refreshBoard(lg.code);
      }).catch(function () { /* the next visit retries */ });
    });
  }

  function afterJoin(code) { setLgMsg(''); refreshBoard(code); syncScores(); }

  // kind: undefined for a friends league (generated name, up to 30), or 'college' | 'office' | 'community' with a typed name
  // (up to 300 players; api/league.js checks the name).
  // Resolves to the new league ({ code, name, kind }), or null (the reason is shown in the Leagues box).
  function startLeague(kind, name) {
    if (lgBusy) return Promise.resolve(null);
    var st = lgLoad();
    if (st.leagues.length >= MAX_LEAGUES) { setLgMsg('You can be in up to ' + MAX_LEAGUES + ' leagues. Leave one to start another.'); return Promise.resolve(null); }
    lgBusy = true; lgDoing = kind ? 'create-' + kind : 'create'; setLgMsg('Creating your league…');
    return lgPost(kind ? { action: 'create', mid: st.mid, kind: kind, name: name } : { action: 'create', mid: st.mid }).then(function (r) {
      lgBusy = false;
      if (!r.ok) { setLgMsg(lgError(r)); return null; }
      groupForm = false; groupDraft = { kind: groupDraft.kind, name: '' };
      var lg = { code: r.d.code, name: r.d.name, kind: r.d.kind || 'friends' };
      st = lgLoad();
      st.leagues.push(lg);
      lgSave(st);
      if (window.HBUse) window.HBUse('league_create');
      afterJoin(r.d.code);
      return lg;
    }).catch(function (e) { lgBusy = false; setLgMsg(lgError({ err: e })); return null; });
  }

  function joinLeague(code) {
    var st = lgLoad();
    if (st.leagues.some(function (l) { return l.code === code; })) return Promise.resolve(true);
    if (st.leagues.length >= MAX_LEAGUES) { setLgMsg('You can be in up to ' + MAX_LEAGUES + ' leagues. Leave one to join another.'); return Promise.resolve(false); }
    lgDoing = 'join';
    return lgPost({ action: 'join', code: code, mid: st.mid }).then(function (r) {
      if (!r.ok) { setLgMsg(lgError(r)); return false; }
      st.leagues.push({ code: code, name: r.d.name, kind: r.d.kind || (boards[code] && boards[code].kind) || 'friends' });
      lgSave(st);
      if (window.HBUse) window.HBUse('league_join');
      afterJoin(code);
      return true;
    }).catch(function (e) { setLgMsg(lgError({ err: e })); return false; });
  }

  function leaveLeague(code) {
    var st = lgLoad();
    lgPost({ action: 'leave', code: code, mid: st.mid }).catch(function () { /* local leave still applies */ });
    st.leagues = st.leagues.filter(function (l) { return l.code !== code; });
    lgSave(st);
    delete boards[code];
    renderLeagues();
  }

  // ---------- the invite nudge on the score screen (owner, 2026-11-21) ----------
  // Right after the quiz, when the score is fresh: one tap gives the reader a friends league (made for them if they have
  // none) and its 6-character code, and opens the share sheet with "I got 3/5, can you beat me? code ABC123".
  // "Challenge a friend" under Share: a league code for friends (started the first time), then the share sheet
  function challengeButton(res) {
    var b = el('button', 'quiz-btn qz-challenge', 'Challenge a friend');
    b.type = 'button';
    var native = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    b.addEventListener('click', function () {
      var have = lgLoad().leagues.filter(function (l) { return !l.kind || l.kind === 'friends'; })[0];
      if (have) { inviteScore(have, res); return; }
      if (b.disabled) return;
      b.disabled = true; b.textContent = 'Getting your league code…';
      startLeague().then(function (lg) {
        b.disabled = false;
        if (!lg) { b.textContent = 'Challenge a friend'; toast(lgMsg || 'Could not start a league just now. Please try again.'); return; }
        b.textContent = 'Share the invite';
        if (native) inviteScore(lg, res);           // a browser only opens the share sheet from a fresh tap
      });
    });
    return b;
  }
  function inviteScore(lg, res) {
    if (window.HBUse) window.HBUse('league_invite');
    share('I got ' + res.s + '/' + res.t + ' on today’s Hour Brief news quiz. Can you beat me? Join my league “' + lg.name + '”: open the link, or get the app and enter code ' + lg.code + ' under Challenge.', inviteLink(lg) + '&src=quiz-invite');
  }

  function inviteLink(lg) { return location.origin + '/l/' + lg.code + '?n=' + encodeURIComponent(lg.name); }
  // The code is in the message itself: someone who installs the app from the invite arrives without the link, and types it.
  function invite(lg) {
    if (window.HBUse) window.HBUse('league_invite');
    var group = lg.kind && lg.kind !== 'friends';
    share((group ? 'Join “' + lg.name + '” on The Hour Brief: a 1-minute daily news quiz, with a leaderboard for all of us.'
      : 'Join my Hour Brief quiz league “' + lg.name + '” and beat me at today’s news quiz.') +
      ' Open the link, or get the app and enter code ' + lg.code + ' under Challenge.', inviteLink(lg));
  }

  function boardList(s, week) {
    var list = el('ol', 'qz-board');
    if (week) {
      (s.week || []).forEach(function (e) {
        var li = el('li', e.me ? 'me' : '');
        li.appendChild(el('span', 'qz-rank', String(e.rank)));
        li.appendChild(el('span', 'qz-who', e.h + (e.me ? ' (you)' : '')));
        li.appendChild(el('span', 'qz-pts', e.pts + ' pts · ' + e.played + (e.played === 1 ? ' day' : ' days')));
        list.appendChild(li);
      });
      if (!list.children.length) list.appendChild(el('li', 'qz-empty', 'No scores this week yet.'));
      if (s.weekCount > (s.week || []).length) list.appendChild(el('li', 'qz-empty', '…and ' + (s.weekCount - s.week.length) + ' more'));
      return list;
    }
    (s.today || []).forEach(function (e) {
      var li = el('li', e.me ? 'me' : '');
      li.appendChild(el('span', 'qz-rank', String(e.rank)));
      li.appendChild(el('span', 'qz-who', e.h + (e.me ? ' (you)' : '')));
      li.appendChild(el('span', 'qz-pts', e.s + '/' + N));
      list.appendChild(li);
    });
    if (!list.children.length) list.appendChild(el('li', 'qz-empty', 'Nobody has played yet today.'));
    if (s.todayCount > (s.today || []).length) list.appendChild(el('li', 'qz-empty', '…and ' + (s.todayCount - s.today.length) + ' more'));
    if (s.yetCount > (s.yet || []).length) list.appendChild(el('li', 'qz-empty', s.yetCount + ' yet to play today'));
    else if ((s.yet || []).length) {
      var w = el('li', 'qz-empty', 'Yet to play: ' + s.yet.map(function (y) { return y.h + (y.me ? ' (you)' : ''); }).join(', '));
      list.appendChild(w);
    }
    return list;
  }

  function leagueCard(lg) {
    var card = el('div', 'qz-league');
    var head = el('div', 'qz-lg-head');
    head.appendChild(el('b', '', lg.name));
    head.appendChild(el('span', 'qz-code', 'Code ' + lg.code));
    var bs = boards[lg.code];
    if (bs && bs.label) head.appendChild(el('span', 'qz-code', bs.label));
    card.appendChild(head);
    var s = boards[lg.code];
    if (!s) { card.appendChild(el('p', 'qz-lg-note', 'Loading standings…')); }
    else if (s.gone) { card.appendChild(el('p', 'qz-lg-note', 'This league has expired.')); }
    else if (s.failed) {
      var fl = el('p', 'qz-lg-note', 'Could not load the leaderboard. ');
      var retry = el('button', 'qz-linkbtn', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', function () { delete boards[lg.code]; renderLeagues(); refreshBoard(lg.code); });
      fl.appendChild(retry);
      card.appendChild(fl);
    }
    else {
      card.appendChild(el('p', 'qz-lg-note', s.members + (s.members === 1 ? ' player' : ' players') + (s.max && s.max > 30 ? ' of ' + s.max : '') + (s.me ? ' · you are ' + s.me : '')));
      var tabs = el('div', 'qz-tabs');
      [['Today', false], ['This week', true]].forEach(function (t) {
        var b = el('button', 'qz-tab' + (!!viewWeek[lg.code] === t[1] ? ' on' : ''), t[0]);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(!!viewWeek[lg.code] === t[1]));
        b.addEventListener('click', function () { viewWeek[lg.code] = t[1]; renderLeagues(); });
        tabs.appendChild(b);
      });
      card.appendChild(tabs);
      card.appendChild(boardList(s, !!viewWeek[lg.code]));
    }
    var row = el('div', 'quiz-actions');
    var inv = el('button', 'quiz-btn primary', lg.kind && lg.kind !== 'friends' ? 'Invite your group' : 'Invite friends');
    inv.type = 'button';
    inv.addEventListener('click', function () { invite(lg); });
    var leave = el('button', 'quiz-btn', 'Leave');
    leave.type = 'button';
    leave.addEventListener('click', function () {
      if (leave.dataset.sure) leaveLeague(lg.code);
      else { leave.dataset.sure = '1'; leave.textContent = 'Tap again to leave'; setTimeout(function () { leave.dataset.sure = ''; leave.textContent = 'Leave'; }, 3000); }
    });
    row.appendChild(inv);
    row.appendChild(leave);
    card.appendChild(row);
    // A college / office league's name is typed by whoever started it: anyone in it can report it (we review within a day).
    if (lg.kind && lg.kind !== 'friends') {
      var rep = el('button', 'qz-linkbtn qz-report', 'Report this league’s name');
      rep.type = 'button';
      rep.addEventListener('click', function () {
        if (!rep.dataset.sure) { rep.dataset.sure = '1'; rep.textContent = 'Tap again to report it as offensive'; setTimeout(function () { rep.dataset.sure = ''; rep.textContent = 'Report this league’s name'; }, 4000); return; }
        rep.disabled = true;
        lgDoing = 'report';
        lgPost({ action: 'report', code: lg.code, mid: lgLoad().mid }).then(function (r) {
          setLgMsg(r.ok ? 'Thanks. We’ll review the name within a day. You can also leave the league any time.' : lgError(r));
        }).catch(function (e) { setLgMsg(lgError({ err: e })); });
      });
      card.appendChild(rep);
    }
    return card;
  }

  // Re-drawn whenever a board arrives: what the reader is typing (a league name, a code) and the field they are in
  // (with the phone keyboard up) must survive that.
  var joinDraft = '';
  function renderLeagues() {
    var st = lgLoad();
    var act = document.activeElement, keep = act && lgBox.contains(act) && act.getAttribute('data-k');
    var sel = keep && typeof act.selectionStart === 'number' ? [act.selectionStart, act.selectionEnd] : null;
    lgBox.textContent = '';
    lgBox.appendChild(el('h3', 'qz-lg-title', 'Leagues'));
    if (!st.leagues.length) {
      lgBox.appendChild(el('p', 'qz-lg-intro', 'Play the daily quiz against your friends, your class or your team. Start a league and share the link or its code. No accounts: everyone gets a fun generated name.'));
    }
    st.leagues.forEach(function (lg) { lgBox.appendChild(leagueCard(lg)); });
    if (st.leagues.length < MAX_LEAGUES) {
      var row = el('div', 'quiz-actions');
      var start = el('button', 'quiz-btn' + (st.leagues.length ? '' : ' primary'), st.leagues.length ? 'Friends league' : 'Start a friends league');
      start.type = 'button';
      start.addEventListener('click', function () { startLeague(); });
      var grp = el('button', 'quiz-btn', 'College or office league');
      grp.type = 'button';
      grp.setAttribute('aria-expanded', String(groupForm));
      grp.addEventListener('click', function () { groupForm = !groupForm; groupFocus = groupForm; renderLeagues(); });
      row.appendChild(start);
      row.appendChild(grp);
      lgBox.appendChild(row);
      if (groupForm) lgBox.appendChild(groupFormEl());
      var jr = el('form', 'qz-joinrow');
      var input = el('input', 'qz-input');
      input.type = 'text';
      input.maxLength = 6;
      input.placeholder = 'Have a code?';
      input.setAttribute('data-k', 'join');
      input.value = joinDraft;
      input.addEventListener('input', function () { joinDraft = input.value; });
      input.setAttribute('aria-label', 'League code');
      input.setAttribute('autocapitalize', 'characters');
      input.setAttribute('autocomplete', 'off');
      var go = el('button', 'quiz-btn', 'Join');
      go.type = 'submit';
      jr.appendChild(input);
      jr.appendChild(go);
      jr.addEventListener('submit', function (e) {
        e.preventDefault();
        var code = input.value.trim().toUpperCase();
        if (!/^[A-Z2-9]{6}$/.test(code)) { setLgMsg('Codes are 6 letters or numbers.'); return; }
        joinLeague(code).then(function (ok) { if (ok) joinDraft = ''; });
      });
      lgBox.appendChild(jr);
    }
    if (lgMsg) { var m = el('p', 'qz-lg-msg', lgMsg); m.setAttribute('role', 'status'); lgBox.appendChild(m); }
    var priv = el('p', 'qz-lg-priv');
    priv.appendChild(document.createTextNode('Leagues store a random device ID, a generated name and your daily score for up to 4 months. A college or office league’s name is chosen by whoever starts it and is shown to everyone with its link. '));
    var a = el('a', '', 'Privacy');
    a.href = '/privacy.html';
    priv.appendChild(a);
    lgBox.appendChild(priv);
    if (keep) {
      var back = lgBox.querySelector('[data-k="' + keep + '"]');
      if (back) { try { back.focus({ preventScroll: true }); if (sel && back.setSelectionRange) back.setSelectionRange(sel[0], sel[1]); } catch (e) { /* ignore */ } }
    }
  }

  // Starting a college / office / community league: its kind and a name (up to 300 players).
  var groupForm = false, groupDraft = { kind: 'college', name: '' }, groupFocus = false;
  function groupFormEl() {
    var f = el('form', 'qz-groupform');
    f.appendChild(el('p', 'qz-lg-intro', 'For a class, a batch, a team or a club: up to 300 players, one leaderboard. Pick a name everyone will recognise.'));
    var kind = el('select', 'qz-input');
    kind.setAttribute('aria-label', 'Kind of league');
    [['college', 'College or class'], ['office', 'Office or team'], ['community', 'Community or club']].forEach(function (k) {
      var o = el('option', '', k[1]); o.value = k[0]; kind.appendChild(o);
    });
    kind.value = groupDraft.kind;
    kind.setAttribute('data-k', 'gkind');
    kind.addEventListener('change', function () { groupDraft.kind = kind.value; });
    var name = el('input', 'qz-input');
    name.type = 'text';
    name.maxLength = 40;
    name.placeholder = 'e.g. IIT Delhi CSE 2027';
    name.setAttribute('aria-label', 'League name');
    name.setAttribute('autocomplete', 'off');
    name.setAttribute('data-k', 'gname');
    name.value = groupDraft.name;
    name.addEventListener('input', function () { groupDraft.name = name.value; });
    var go = el('button', 'quiz-btn primary', 'Create league');
    go.type = 'submit';
    var r = el('div', 'quiz-actions');
    r.appendChild(kind); r.appendChild(name); r.appendChild(go);
    f.appendChild(r);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var n = name.value.replace(/\s+/g, ' ').trim();
      if (n.length < 3) { setLgMsg('Give the league a name (3 to 40 characters).'); return; }
      startLeague(kind.value, n);
    });
    // Just opened: on a phone, bring the form into view and let the reader tap the name field (opening the keyboard
    // straight away scrolled the page before the form had laid out); with a mouse, put the cursor in the name field.
    if (groupFocus) {
      groupFocus = false;
      var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      setTimeout(function () { try { if (touch) f.scrollIntoView({ block: 'center', behavior: 'smooth' }); else name.focus(); } catch (x) { /* ignore */ } }, 60);
    }
    return f;
  }

  function handleJoinParam() {
    var code = '';
    try { code = (new URLSearchParams(location.search).get('join') || '').toUpperCase(); } catch (e) { /* ignore */ }
    if (!/^[A-Z2-9]{6}$/.test(code)) return;
    if (lgLoad().leagues.some(function (l) { return l.code === code; })) return;
    var clear = function () { try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* ignore */ } joinBox.textContent = ''; };
    lgFetch('/api/league?code=' + code + '&meta=1').then(function (r) {
      joinBox.textContent = '';
      var card = el('div', 'quiz-friend');
      if (!r.ok) { card.textContent = 'This league invite is no longer valid.'; joinBox.appendChild(card); return; }
      card.appendChild(el('p', 'qz-join-t', 'You’re invited to join ' + (r.d.label ? 'the ' + r.d.label.toLowerCase() + ' league ' : '') + '“' + r.d.name + '” (' + r.d.members + (r.d.members === 1 ? ' player' : ' players') + ').'));
      var row = el('div', 'quiz-actions');
      var yes = el('button', 'quiz-btn primary', 'Join league');
      yes.type = 'button';
      yes.addEventListener('click', function () { joinLeague(code).then(function (ok) { if (ok) clear(); }); });
      var no = el('button', 'quiz-btn', 'Not now');
      no.type = 'button';
      no.addEventListener('click', clear);
      row.appendChild(yes);
      row.appendChild(no);
      card.appendChild(row);
      joinBox.appendChild(card);
    }).catch(function () { /* invite will still work from the code box */ });
  }

  // ---------- celebrations: the streak milestone screen and the new-badge card ----------
  var MILESTONES = [3, 7, 14, 30, 50, 100, 150, 200, 365];
  var CONFETTI = { a: 49, b: 58 };                 // brand/rewards/confetti/a00-a48, b00-b57
  function confetti(host) {
    if (reduceMotion) return;
    var layer = el('div', 'qz-confetti');
    layer.setAttribute('aria-hidden', 'true');
    for (var k = 0; k < 34; k++) {
      var set = Math.random() < 0.5 ? 'a' : 'b', n = Math.floor(Math.random() * CONFETTI[set]);
      var im = el('img');
      im.src = ART + 'confetti/' + set + ('0' + n).slice(-2) + '.webp';
      im.alt = '';
      im.style.left = (Math.random() * 100).toFixed(1) + '%';
      im.style.width = im.style.height = (14 + Math.random() * 16).toFixed(0) + 'px';
      im.style.animationDelay = (Math.random() * 0.9).toFixed(2) + 's';
      im.style.animationDuration = (2.4 + Math.random() * 1.8).toFixed(2) + 's';
      im.style.setProperty('--qz-spin', (Math.random() * 720 - 360).toFixed(0) + 'deg');
      im.style.setProperty('--qz-drift', (Math.random() * 80 - 40).toFixed(0) + 'px');
      layer.appendChild(im);
    }
    host.appendChild(layer);
    setTimeout(function () { layer.remove(); }, 5200);
  }
  function overlay(cls, label) {
    var prev = document.activeElement;
    var bg = el('div', 'qz-cele ' + cls);
    bg.setAttribute('role', 'dialog');
    bg.setAttribute('aria-modal', 'true');
    bg.setAttribute('aria-label', label);
    document.body.appendChild(bg);
    document.documentElement.classList.add('qz-cele-open');
    requestAnimationFrame(function () { bg.classList.add('in'); });
    function close(then) {
      document.removeEventListener('keydown', key);
      bg.classList.remove('in');
      bg.classList.add('out');
      setTimeout(function () {
        bg.remove();
        if (!document.querySelector('.qz-cele')) document.documentElement.classList.remove('qz-cele-open');
        if (typeof then === 'function') then(); else if (prev && prev.focus) { try { prev.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      }, reduceMotion ? 0 : 220);
    }
    function key(e) { if (e.key === 'Escape') close(bg._done); }
    document.addEventListener('keydown', key);
    return { bg: bg, close: close };
  }
  function weekDots(box, gold) {
    var results = load().r, wd = new Date(Date.parse(DATE + 'T00:00:00Z')).getUTCDay();
    var monday = new Date(Date.parse(DATE + 'T00:00:00Z') - ((wd + 6) % 7) * 86400000).toISOString().slice(0, 10);
    var row = el('div', 'qz-ms-week');
    for (var k = 0; k < 7; k++) {
      var d = new Date(Date.parse(monday + 'T00:00:00Z') + k * 86400000).toISOString().slice(0, 10);
      var c = el('span', 'qz-ms-day' + (gold || results[d] ? ' on' : '') + (d === DATE ? ' today' : ''));
      c.appendChild(el('i'));
      c.appendChild(el('small', '', ['M', 'T', 'W', 'T', 'F', 'S', 'S'][k]));
      row.appendChild(c);
    }
    box.appendChild(row);
  }
  function milestoneLine(n) {
    var base = n === 3 ? 'Three mornings in a row. That’s a habit starting.'
      : n === 7 ? 'A full week of mornings.'
      : n === 14 ? 'Two weeks of mornings.'
      : n === 30 ? 'A month of mornings. That’s a ritual.'
      : n + ' mornings in a row.';
    var next = STAGES.filter(function (s) { return s[2] > n; })[0];
    return base + (next ? ' Your flame grows again at ' + next[2] + '.' : ' Your flame is a legend now.');
  }
  function showMilestone(n, badge, done) {
    var o = overlay('qz-milestone', n + '-day streak');
    o.bg._done = done;
    var box = el('div', 'qz-ms-box');
    var fl = flameImg(n, 'qz-ms-flame');
    box.appendChild(fl);
    box.appendChild(el('p', 'qz-ms-num', String(n)));
    box.appendChild(el('p', 'qz-ms-cap', 'days in a row'));
    box.appendChild(el('p', 'qz-ms-line', milestoneLine(n)));
    weekDots(box, false);
    if (badge) {
      var bc = el('div', 'qz-ms-badge');
      bc.appendChild(badgeImg(badge, 'qz-ms-badge-img'));
      var bt = el('div');
      bt.appendChild(el('span', 'qz-ms-badge-k', 'New badge'));
      bt.appendChild(el('b', '', badge.name));
      bt.appendChild(el('small', '', 'Added to your trophy case'));
      bc.appendChild(bt);
      box.appendChild(bc);
    }
    var sh = el('button', 'quiz-btn primary', 'Share my streak');
    sh.type = 'button';
    sh.addEventListener('click', function () {
      share('I’m on a ' + n + '-day streak on The Hour Brief’s daily news quiz. Five questions on the morning’s news. Can you keep up?', location.origin + '/app?src=streak');
    });
    var go = el('button', 'qz-ms-go', 'Continue');
    go.type = 'button';
    go.addEventListener('click', function () { o.close(done); });
    box.appendChild(sh);
    box.appendChild(go);
    o.bg.appendChild(box);
    confetti(o.bg);
    haptic(true);
    setTimeout(function () { try { sh.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 60);
  }
  function showBadge(b, done, nth) {
    var o = overlay('qz-badgepop', 'New badge: ' + b.name);
    o.bg._done = done;
    o.bg.addEventListener('click', function (e) { if (e.target === o.bg) o.close(done); });
    var card = el('div', 'qz-bp-card');
    var x = el('button', 'qz-bp-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', function () { o.close(done); });
    card.appendChild(x);
    card.appendChild(el('p', 'qz-bp-k', 'New badge'));
    card.appendChild(badgeImg(b, 'qz-bp-img'));
    card.appendChild(el('h2', 'qz-bp-name', b.name));
    card.appendChild(el('p', 'qz-bp-desc', b.desc));
    var got = nth || Object.keys(load().b || {}).length, all = BADGES.length;     // nth: this badge's place when several came at once
    var prog = el('div', 'qz-bp-prog');
    var pl = el('div', 'qz-bp-pl');
    pl.appendChild(el('span', '', 'Collection'));
    pl.appendChild(el('b', '', 'Badge ' + got + ' of ' + all));
    prog.appendChild(pl);
    var segs = el('div', 'qz-bp-segs');
    for (var k = 0; k < all; k++) segs.appendChild(el('i', k < got ? 'on' : ''));
    prog.appendChild(segs);
    card.appendChild(prog);
    var see = el('button', 'quiz-btn primary', 'See all badges');
    see.type = 'button';
    see.addEventListener('click', function () { o.close(function () { setTab('badges', true); if (done) done(); }); });
    var sh = el('button', 'qz-bp-share', 'Share');
    sh.type = 'button';
    sh.addEventListener('click', function () {
      share('I just earned the “' + b.name + '” badge on The Hour Brief’s daily news quiz (' + b.desc.charAt(0).toLowerCase() + b.desc.slice(1) + ').', location.origin + '/app?src=badge');
    });
    card.appendChild(see);
    card.appendChild(sh);
    o.bg.appendChild(card);
    confetti(o.bg);
    haptic(true);
    setTimeout(function () { try { see.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 60);
  }
  // The milestone (if today's streak is one), carrying the streak badge it unlocked; then the other new badges, one at a time
  function celebrate(streak, fresh) {
    var list = (fresh || []).slice();
    var shown = Object.keys(load().b || {}).length - list.length;      // earned before today's, so each card counts up in turn
    var queue = function () { var b = list.shift(); if (b) { shown++; var n = shown; setTimeout(function () { showBadge(b, queue, n); }, 250); } };
    if (MILESTONES.indexOf(streak) !== -1) {
      var sb = null;
      list = list.filter(function (b) { if (!sb && /^streak/.test(b.id)) { sb = b; return false; } return true; });
      if (sb) shown++;
      setTimeout(function () { showMilestone(streak, sb, queue); }, 500);
    } else if (list.length) setTimeout(queue, 500);
  }

  // ---------- Daily quiz | Leagues | Badges ----------
  var panes = null, segBtns = {}, curTab = 'quiz', headTag = null, headTitle = null;
  var TAB_NAMES = [['quiz', 'Daily quiz'], ['leagues', 'Leagues'], ['badges', 'Badges']];
  // The header above the tabs follows the tab (owner, 2026-11-22: "Badges" under a "Daily quiz" heading didn't read as one
  // screen): the title says what this tab is.
  var TAB_TITLES = { leagues: 'Play against your friends, class or team', badges: 'Your trophy case' };
  function buildTabs() {
    var head = section.querySelector('.lane-head');
    headTag = head && head.querySelector('.lane-tag');
    headTitle = head && head.querySelector('h2');
    if (headTag) headTag.classList.add('qz-tag-off');   // no label above the title: the tab bar already says Challenge (owner, 2026-11-22)
    if (headTitle) TAB_TITLES.quiz = headTitle.textContent;
    var seg = el('div', 'qz-seg');
    seg.setAttribute('role', 'tablist');
    seg.setAttribute('aria-label', 'Challenge');
    panes = {};
    TAB_NAMES.forEach(function (t) {
      var b = el('button', 'qz-seg-btn', t[1]);
      b.type = 'button';
      b.id = 'qz-tab-' + t[0];
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', 'qz-pane-' + t[0]);
      b.addEventListener('click', function () { setTab(t[0], false); });
      segBtns[t[0]] = b;
      seg.appendChild(b);
      var p = el('div', 'qz-pane qz-pane-' + t[0]);
      p.id = 'qz-pane-' + t[0];
      p.setAttribute('role', 'tabpanel');
      p.setAttribute('aria-labelledby', b.id);
      panes[t[0]] = p;
    });
    seg.addEventListener('keydown', function (e) {
      var focused = e.target && e.target.id ? e.target.id.replace('qz-tab-', '') : curTab;     // from the tab that has focus
      var i = TAB_NAMES.map(function (t) { return t[0]; }).indexOf(focused);
      if (i < 0) i = TAB_NAMES.map(function (t) { return t[0]; }).indexOf(curTab);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        var nx = TAB_NAMES[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3][0];
        setTab(nx, false);
        segBtns[nx].focus();
      }
    });
    if (head) head.insertAdjacentElement('afterend', seg); else section.insertBefore(seg, section.firstChild);
    seg.insertAdjacentElement('afterend', panes.quiz);
    panes.quiz.insertAdjacentElement('afterend', panes.leagues);
    panes.leagues.insertAdjacentElement('afterend', panes.badges);
    panes.quiz.appendChild(streakBox);
    panes.quiz.appendChild(root);
    panes.quiz.appendChild(pastBox);
    panes.leagues.appendChild(joinBox);
    panes.leagues.appendChild(lgBox);
    var want = 'quiz';
    try { want = sessionStorage.getItem('hb-qz-tab') || 'quiz'; } catch (e) { /* ignore */ }
    if (/[?&]join=/.test(location.search)) want = 'leagues';
    setTab(panes[want] ? want : 'quiz', false, true);
  }
  function setTab(name, scroll, quiet) {
    if (!panes || !panes[name]) return;
    curTab = name;
    TAB_NAMES.forEach(function (t) {
      var on = t[0] === name;
      segBtns[t[0]].setAttribute('aria-selected', String(on));
      segBtns[t[0]].tabIndex = on ? 0 : -1;
      segBtns[t[0]].classList.toggle('on', on);
      panes[t[0]].hidden = !on;
    });
    if (headTitle && TAB_TITLES[name]) headTitle.textContent = TAB_TITLES[name];
    if (!quiet) { try { sessionStorage.setItem('hb-qz-tab', name); } catch (e) { /* ignore */ } }
    if (name === 'badges') { renderTrophy(); if (!quiet && window.HBUse) window.HBUse('badges_view'); }
    if (scroll) bringIntoView(section.querySelector('.qz-seg'), 'top', true);
  }

  // ---------- the trophy case (Badges tab) ----------
  var trophyT = 0;
  function renderTrophySoon() { clearTimeout(trophyT); trophyT = setTimeout(function () { if (curTab === 'badges') renderTrophy(); }, 30); }
  function renderTrophy() {
    if (!panes) return;
    getEditions().then(function (dates) {
      var st = computeStats(dates), got = load().b || {}, box = panes.badges;
      var results = load().r;
      var cur = streakEndingAt(dates, results, results[DATE] ? DATE : (dates.length > 1 ? dates[dates.length - 2] : prevDay(DATE)));
      box.textContent = '';
      var earned = BADGES.filter(function (b) { return got[b.id]; }).length;
      box.appendChild(el('p', 'qz-tc-count', earned + ' of ' + BADGES.length + ' badges earned on this phone'));
      var grid = el('div', 'qz-tc-stats');
      [['Days played', st.played, ''], ['Best streak', st.best, st.best === 1 ? 'day' : 'days'], ['Perfect scores', st.perfects, ''], ['Accuracy', st.acc, '%']].forEach(function (x) {
        var c = el('div', 'qz-tc-stat');
        c.appendChild(el('span', 'qz-tc-k', x[0]));
        var v = el('b', '', String(x[1]));
        if (x[2]) v.appendChild(el('small', '', x[2] === '%' ? '%' : ' ' + x[2]));
        c.appendChild(v);
        grid.appendChild(c);
      });
      box.appendChild(grid);
      // The flame's stages, the current one lit
      var evo = el('div', 'qz-tc-evo');
      var eh = el('div', 'qz-tc-evo-h');
      eh.appendChild(el('span', 'qz-tc-k', 'Streak flame'));
      eh.appendChild(el('b', '', cur ? stageOf(cur)[1] + ' · ' + cur + (cur === 1 ? ' day' : ' days') : 'Play today to light it'));
      evo.appendChild(eh);
      var row = el('div', 'qz-tc-stages');
      var reached = Math.max(cur, 0);
      STAGES.forEach(function (s) {
        var c = el('div', 'qz-tc-stage' + (reached >= s[2] ? ' on' : '') + (cur && stageOf(cur)[0] === s[0] ? ' cur' : ''));
        var im = el('img');
        im.src = ART + 'flames/' + s[0] + '.webp';
        im.alt = '';
        c.appendChild(im);
        c.appendChild(el('b', '', s[1]));
        c.appendChild(el('small', '', s[2] + (s[2] === 1 ? ' day' : '+ days')));
        row.appendChild(c);
      });
      evo.appendChild(row);
      box.appendChild(evo);
      var ul = el('ul', 'qz-tc-badges');
      BADGES.forEach(function (b) {
        var on = !!got[b.id];
        var li = el('li', on ? 'on' : 'locked');
        li.appendChild(badgeImg(b, 'qz-tc-img'));
        li.appendChild(el('b', '', b.name));
        li.appendChild(el('small', '', on ? 'Earned ' + prettyDate(got[b.id]) : Math.min(b.val(st), b.goal) + ' / ' + b.goal));
        li.title = b.desc;
        li.setAttribute('aria-label', b.name + ': ' + b.desc + (on ? ', earned' : ', ' + Math.min(b.val(st), b.goal) + ' of ' + b.goal));
        ul.appendChild(li);
      });
      box.appendChild(ul);
      box.appendChild(el('p', 'qz-tc-note', 'Badges are kept on this phone. Sign-in, coming soon, will carry them to your other devices.'));
    });
  }

  // Preview build only: ?demo=streak7 (or streak3, streak30…) shows the milestone screen, ?demo=badge the new-badge card,
  // so they can be reviewed without waiting a week. Nothing is saved.
  function demo() {
    var m = /[?&]demo=([a-z0-9]+)/.exec(location.search);
    if (!m) return;
    var v = m[1], n = /^streak(\d+)$/.exec(v);
    if (n) { var b = BADGES.filter(function (x) { return x.id === 'streak' + n[1]; })[0] || null; setTimeout(function () { showMilestone(+n[1], b, null); }, 800); }
    else if (v === 'badge') setTimeout(function () { showBadge(BADGES[1], null); }, 800);
  }

  // ---------- for Home (home.js): the streak, today's result and the badges, read-only ----------
  // played: today's result or null; streak: the current run (still alive if today isn't played yet); badges: id -> date earned.
  window.HBQuizInfo = function () {
    var o = load(), results = o.r, mine = results[DATE] || null;
    var latest = lastDates.length ? lastDates[lastDates.length - 1] : DATE;
    var streak = mine ? streakEndingAt(lastDates, results, DATE)
      : (latest === DATE ? streakEndingAt(lastDates, results, lastDates.length > 1 ? lastDates[lastDates.length - 2] : prevDay(DATE)) : 0);
    var st = computeStats(lastDates);
    var next = null;                                          // the next streak badge, for "one more day for Week warrior"
    BADGES.forEach(function (b) { if (!next && /^streak/.test(b.id) && !(o.b && o.b[b.id]) && st.best < b.goal) next = { id: b.id, name: b.name, goal: b.goal }; });
    return { date: DATE, n: N, played: mine, streak: streak, best: st.best, stage: stageOf(Math.max(1, streak))[1], badges: o.b || {}, badgeCount: Object.keys(o.b || {}).length, badgeTotal: BADGES.length, next: next, flame: ART + 'flames/' + stageOf(Math.max(1, streak))[0] + '.webp' };
  };

  window.HBQuizTab = function (name) { setTab(name, false); };   // You's badge count opens the Badges tab

  // ---------- start ----------
  root.insertAdjacentElement('afterend', pastBox);            // between the quiz and the leagues
  buildTabs();
  if (saved && Array.isArray(saved.a)) showResult(saved, true);
  else if (playerMode()) { restorePicks(); showIntro(); }
  else showQuestion(0, false);
  refreshStreak([]);
  updateChip([]);
  getEditions().then(function (dates) { updateChip(dates); refreshStreak(dates); });
  renderLeagues();
  lgLoad().leagues.forEach(function (lg) { refreshBoard(lg.code); });
  syncScores();
  handleJoinParam();
  demo();
})();
