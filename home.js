/* Home (owner, 2026-11-25): where the app opens on phones and in the apps, the first of four tabs (Home · Brief · Voices ·
 * Challenge). It shows the edition at a glance and leads into each part of the app:
 *   a greeting; the streak strip (only when it matters: a streak to keep, a badge close or just earned); Today's mix (the
 *   lead story, the newest Voices piece, the quiz; the week's recap first on Sundays); nudges (what's left to do today);
 *   Explore (the edition's sections, Voices, This week, Past editions); Top stories; Most read in Voices (by real views);
 *   the quiz card; and a Listen bar above the tab bar (the Audio tab's old job).
 * A full-screen layer over the edition page, like Audio and Challenge (.hb-hub). mobile.js loads it (withHome), opens it on a
 * plain open of today's edition and from the Home tab, and owns the header's You button, the themes and the tabs.
 * Everything here is read from the page and from this phone; nothing is invented or stored except Voices' cached copy. */
(function () {
  'use strict';
  if (window.HBHome) return;
  var HC = window.HBChrome || {};
  var shown = false, el = null, scroller = null, listenBtn = null;

  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function svg(path, w) {
    return '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="' + (w || 2) + '" stroke-linecap="round" stroke-linejoin="round" fill="none" aria-hidden="true">' + path + '</svg>';
  }
  var IC = {
    cards: svg('<rect x="6" y="3" width="12" height="16" rx="2"/><path d="M3 7v12a2 2 0 0 0 2 2h10"/>'),
    listen: svg('<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><path d="M4 15h3v5H5a1 1 0 0 1-1-1v-4z"/><path d="M20 15h-3v5h2a1 1 0 0 0 1-1v-4z"/>'),
    week: svg('<rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>'),
    quiz: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.9.7c0 1.7-2.4 2.1-2.4 3.6M12 17h.01"/>'),
    league: svg('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'),
    ai: svg('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>'),
    biz: svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>'),
    mkt: svg('<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>'),
    voices: svg('<path d="M4.5 4.5h10a2 2 0 0 1 2 2v5.5a2 2 0 0 1-2 2H9l-3.5 3v-3h-1a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2z"/><path d="M16.5 8.5h3a2 2 0 0 1 2 2V16a2 2 0 0 1-2 2h-1v2.5L15 18h-3.5a2 2 0 0 1-1.9-1.4"/>', 1.8),
    archive: svg('<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>'),
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
    quote: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 7h4v4H8c0 2 1 3 3 3v2c-3 0-5-2-5-5V7zm8 0h4v4h-3c0 2 1 3 3 3v2c-3 0-5-2-5-5V7z"/></svg>',
    flame: (HC.icons && HC.icons.flame) || '',
    you: (HC.icons && HC.icons.you) || ''
  };
  var VOICE_CATS = { 'tech-ai': 'Tech & AI', tech: 'Tech & AI', ai: 'Tech & AI', product: 'Product', business: 'Business', finance: 'Finance', principles: 'Principles' };

  function tap(name) { if (HC.use) HC.use('home_tap'); return name; }
  function q() { return (window.HBQuizInfoAny ? window.HBQuizInfoAny() : null) || { streak: 0, best: 0, played: null, badges: {} }; }
  function quizHere() { var s = document.getElementById('quiz'); return !!(s && !s.hidden && !s.hasAttribute('data-pref-off') && document.getElementById('quiz-data')); }

  // ---- the edition, read from the page ----
  function lanes() {
    return Array.prototype.filter.call(document.querySelectorAll('section.lane'), function (l) {
      return !l.hidden && !l.hasAttribute('data-pref-off') && l.style.display !== 'none' && l.querySelector('.item[data-story-id]');
    });
  }
  function laneKey(l) { return ['ai', 'biz', 'mkt'].filter(function (k) { return l.classList.contains(k); })[0] || 'ai'; }
  function laneName(l) { return HC.laneName ? HC.laneName(l) : l.id; }
  function storiesOf(l) { return Array.prototype.slice.call(l.querySelectorAll('.item[data-story-id]')); }
  function headline(it) { var h = it.querySelector('h3'); return h ? h.textContent.trim() : ''; }
  function editionLine() {
    var e = document.querySelector('.masthead .edition, .edition');      // "Edition 098<br>Tue, 24 Nov 2026"
    if (!e) return '';
    var parts = [];
    Array.prototype.forEach.call(e.childNodes, function (n) { var t = (n.textContent || '').replace(/\s+/g, ' ').trim(); if (t) parts.push(t); });
    return parts.join(' · ');
  }
  function minutes(all) {
    var words = 0;
    all.forEach(function (it) { words += (it.textContent || '').split(/\s+/).length; });
    return Math.max(1, Math.round(words / 200));
  }

  // ---- going places ----
  function openStory(id) {
    tap();
    close();
    if (window.HBOpenStory && window.HBOpenStory(id)) return;
    // List: closing Home is enough to be on Brief (mobile.js relights the tab on hb:hub); its tab action would scroll to the top
    var it = document.querySelector('.item[data-story-id="' + id + '"]');
    if (it) setTimeout(function () { it.scrollIntoView({ block: 'start' }); it.classList.add('deeplinked'); }, 60);
  }
  function openLane(l) {
    var first = storiesOf(l)[0];
    if (HC.cardsOk && HC.cardsOk() && HC.view && HC.view() === 'cards' && first) { openStory(first.dataset.storyId); return; }
    tap();
    close();
    setTimeout(function () { l.scrollIntoView({ block: 'start' }); }, 60);
  }
  function go(url) { tap(); if (HC.leave) HC.leave(url); else location.href = url; }
  // Play: the full-screen quiz opens over Home (quiz.js HBQuizPlay); Challenge if it can't (or today's is done)
  function playQuiz() { tap(); if (window.HBQuizPlay && window.HBQuizPlay()) return; if (HC.tab) HC.tab('quiz'); }
  function tab(name) { tap(); if (HC.tab) HC.tab(name); }
  // Listen: today's episode starts and the player expands from the bottom (listen.js); it minimises to the bar above the tabs
  function listen(opts) {
    tap();
    var L = window.HBListen;
    if (!L || !L.openHub) { if (HC.tab) HC.tab('audio'); return; }
    if (!(opts && opts.episodes) && L.state && L.state() === 'idle' && L.start) L.start('quick');
    L.openHub(opts);
  }

  // ---- pieces ----
  function section(title, more, moreGo) {
    var s = mk('section', 'hm-sec');
    var h = mk('div', 'hm-sec-h');
    h.appendChild(mk('h2', 'hm-label', title));
    if (more) {
      var b = mk('button', 'hm-more', more);
      b.type = 'button';
      b.addEventListener('click', moreGo);
      h.appendChild(b);
    }
    s.appendChild(h);
    return s;
  }
  function rail(cls) { var r = mk('div', 'hm-rail' + (cls ? ' ' + cls : '')); return r; }
  function tag(text, cls) { return mk('span', 'hm-tag' + (cls ? ' ' + cls : ''), text); }
  function art(it, cls) {
    var src = window.HBStoryArtSrc ? window.HBStoryArtSrc(it) : '';
    if (!src) return null;
    var im = mk('img', cls || 'hm-art');
    im.src = src;
    im.alt = '';
    im.decoding = 'async';
    return im;
  }
  function storyCard(it, l, big) {
    var b = mk('button', big ? 'hm-card hm-lead' : 'hm-card hm-story');
    b.type = 'button';
    var im = art(it);
    if (im) b.appendChild(im);
    var body = mk('span', 'hm-card-b');
    body.appendChild(tag(laneName(l), 'hm-tag-' + laneKey(l)));
    body.appendChild(mk('span', 'hm-card-t', headline(it)));
    if (big) body.appendChild(mk('span', 'hm-go', 'Read it in the Brief'));
    b.appendChild(body);
    b.addEventListener('click', function () { openStory(it.dataset.storyId); });
    return b;
  }

  // the streak strip: shown only when there is something to say
  function streakStrip(info, hour) {
    if (!quizHere()) return null;
    var earnedToday = Object.keys(info.badges || {}).filter(function (k) { return info.badges[k] === info.date; });
    var title = '', text = '', pct = -1, play = false, cls = '';
    if (info.played && earnedToday.length) {
      title = 'New badge';
      text = 'You earned a badge today. See it in your trophy case.';
      cls = ' hm-ach-new';
    } else if (!info.played && info.streak >= 1) {
      title = info.streak + '-day streak';
      text = hour >= 17 ? 'Play today’s quiz before midnight to keep it.' : 'Today’s quiz keeps it going.';
      if (info.next && info.next.goal > info.streak) { pct = info.streak / info.next.goal; text += ' ' + (info.next.goal - info.streak) + ' more ' + (info.next.goal - info.streak === 1 ? 'day' : 'days') + ' to ' + info.next.name + '.'; }
      play = true;
    } else if (info.played && info.streak >= 2 && info.next && info.next.goal > info.streak) {
      title = info.streak + '-day streak · ' + (info.stage || '');
      var left = info.next.goal - info.streak;
      text = left === 1 ? 'One more day to ' + info.next.name + '.' : left + ' more days to ' + info.next.name + '.';
      pct = info.streak / info.next.goal;
    } else return null;
    var box = mk('button', 'hm-ach' + cls);
    box.type = 'button';
    var ic = mk('span', 'hm-ach-ic');
    if (info.flame && info.streak) { var im = mk('img'); im.src = info.flame; im.alt = ''; ic.appendChild(im); } else ic.innerHTML = IC.flame;
    box.appendChild(ic);
    var tx = mk('span', 'hm-ach-tx');
    tx.appendChild(mk('b', '', title));
    tx.appendChild(mk('span', '', text));
    if (pct >= 0) { var bar = mk('span', 'hm-ach-bar'), f = mk('i'); f.style.width = Math.round(Math.min(1, pct) * 100) + '%'; bar.appendChild(f); tx.appendChild(bar); }
    box.appendChild(tx);
    if (play) box.appendChild(mk('span', 'hm-ach-go', 'Play'));
    box.addEventListener('click', function () {
      if (cls) { tap(); try { sessionStorage.setItem('hb-qz-tab', 'badges'); } catch (e) { /* ignore */ } if (HC.tab) HC.tab('quiz'); if (window.HBQuizTab) window.HBQuizTab('badges'); }
      else playQuiz();
    });
    return box;
  }

  function quizCard(info, small) {
    var b = mk('button', small ? 'hm-card hm-qz hm-qz-sm' : 'hm-qzbig');
    b.type = 'button';
    var done = info.played;
    b.appendChild(tag(done ? 'Today’s challenge · done' : 'Today’s challenge', 'hm-tag-on'));
    b.appendChild(mk('span', 'hm-qz-t', done ? 'You scored ' + done.s + ' of ' + done.t + '. See how your league did.' : (info.n || 5) + ' questions on today’s edition. Can you get them all?'));
    var sub = done ? (info.streak >= 2 ? 'Your streak is ' + info.streak + ' days.' : 'Come back tomorrow to start a streak.') : (info.streak >= 1 ? 'Keeps your ' + info.streak + '-day streak going.' : 'Play daily to build a streak.');
    b.appendChild(mk('span', 'hm-qz-s', sub));
    b.appendChild(mk('span', 'hm-qz-go', done ? 'See the league' : 'Play'));
    b.addEventListener('click', function () {
      if (done) { try { sessionStorage.setItem('hb-qz-tab', 'leagues'); } catch (e) { /* ignore */ } tab('quiz'); if (window.HBQuizTab) window.HBQuizTab('leagues'); }
      else playQuiz();
    });
    return b;
  }

  // ---- Voices: the cached copy leaders.html keeps (hb-voices-v1: briefs + real view/like counts), refreshed here too ----
  var VKEY = 'hb-voices-v1', voicesAsked = false;
  function voices() {
    try { var c = JSON.parse(localStorage.getItem(VKEY) || 'null'); if (c && c.briefs && c.briefs.length) return c; } catch (e) { /* none */ }
    return null;
  }
  function refreshVoices() {
    if (voicesAsked) return;
    voicesAsked = true;
    var old = voices();
    fetch('/leaders-data.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.briefs || !d.briefs.length) return null;
      var ids = d.briefs.map(function (b) { return b.id; }), chunks = [];
      for (var i = 0; i < ids.length; i += 60) chunks.push(ids.slice(i, i + 60));
      return Promise.all(chunks.map(function (c) {
        return fetch('/api/interactions?action=leader-stats&ids=' + encodeURIComponent(c.join(','))).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
      })).then(function (parts) {
        var stats = Object.assign.apply(Object, [{}, old && old.stats].concat(parts));
        return { briefs: d.briefs, stats: stats };
      });
    }).then(function (fresh) {
      if (!fresh) return;
      var sig = JSON.stringify(fresh);
      if (old && JSON.stringify(old) === sig) return;
      try { localStorage.setItem(VKEY, sig); } catch (e) { /* draw anyway */ }
      if (shown) draw(true);
    }).catch(function () { /* the cached copy stays */ });
  }
  function newest(c) { return c.briefs.slice().sort(function (a, b) { return (b.generatedAt || '').localeCompare(a.generatedAt || ''); }); }
  function byViews(c) {
    var st = c.stats || {};
    var v = function (b) { var s = st[b.id] || {}; return (s.views || 0) + 3 * (s.likes || 0); };
    return newest(c).sort(function (a, b) { return v(b) - v(a); });
  }
  function bySource(b) {
    var seen = [];
    (b.sources || []).forEach(function (s) { if (s && s.creator && seen.indexOf(s.creator) < 0) seen.push(s.creator); });
    return seen.slice(0, 2).join(' · ');
  }
  function voiceCard(b, big) {
    var a = mk('button', big ? 'hm-card hm-voice' : 'hm-card hm-vcard');
    a.type = 'button';
    a.appendChild(tag('Voices · ' + (VOICE_CATS[b.category] || b.category), big ? 'hm-tag-dark' : 'hm-tag-voices'));
    if (big) { var qd = mk('span', 'hm-quote'); qd.innerHTML = IC.quote; a.appendChild(qd); }
    a.appendChild(mk('span', 'hm-card-t', b.title));
    var who = bySource(b);
    if (who) a.appendChild(mk('span', 'hm-card-m', b.kind === 'essay' ? 'Essay · ' + who : who));
    if (big) a.appendChild(mk('span', 'hm-go', 'Read the summary'));
    a.addEventListener('click', function () { go('/leaders.html#a=' + encodeURIComponent(b.id)); });
    return a;
  }

  // ---- drawing ----
  function greeting(hour) { return hour < 5 ? 'Good evening.' : hour < 12 ? 'Good morning.' : hour < 17 ? 'Good afternoon.' : 'Good evening.'; }
  function draw(keepScroll) {
    if (!el) return;
    var top = keepScroll && scroller ? scroller.scrollTop : 0;
    var hour = new Date().getHours(), info = q(), L = lanes(), all = [];
    L.forEach(function (l) { all = all.concat(storiesOf(l)); });
    scroller.textContent = '';
    scroller.appendChild(mk('div', 'hm-deco'));

    var hello = mk('section', 'hm-hello');
    var ed = editionLine();
    if (ed) hello.appendChild(mk('p', 'hm-kick', ed));
    var h1 = mk('h1', 'hm-greet');
    h1.appendChild(document.createTextNode(greeting(hour) + ' '));
    h1.appendChild(mk('b', '', all.length + (all.length === 1 ? ' story, ' : ' stories, ') + minutes(all) + ' minutes.'));
    hello.appendChild(h1);
    scroller.appendChild(hello);

    var strip = streakStrip(info, hour);
    if (strip) scroller.appendChild(strip);

    // Today's mix: lead story, newest Voices piece, the quiz (the recap first on Sundays)
    var mixS = section('Today’s mix');
    var mix = rail('hm-mix');
    var wk = window.HBWeeklyNow && window.HBWeeklyNow();
    if (wk) {
      var w = mk('button', 'hm-card hm-weekcard');
      w.type = 'button';
      w.appendChild(tag('This week · ' + wk.range, 'hm-tag-gold'));
      w.appendChild(mk('span', 'hm-card-t', wk.title));
      w.appendChild(mk('span', 'hm-go', 'Read all ' + wk.items.length + ' stories'));
      w.addEventListener('click', function () { go(wk.url + '&src=app-home'); });
      mix.appendChild(w);
    }
    var lead = L[0] && storiesOf(L[0])[0];
    if (lead) mix.appendChild(storyCard(lead, L[0], true));
    var V = voices();
    var fresh = V ? newest(V)[0] : null;
    if (fresh) mix.appendChild(voiceCard(fresh, true));
    if (quizHere()) mix.appendChild(quizCard(info, true));
    mixS.appendChild(mix);
    scroller.appendChild(mixS);

    // nudges: only what is still worth doing today
    var nud = rail('hm-nudges');
    function nudge(icon, text, fn, hot) {
      var b = mk('button', 'hm-nudge' + (hot ? ' hot' : ''));
      b.type = 'button';
      b.innerHTML = icon;
      b.appendChild(document.createTextNode(text));
      b.addEventListener('click', fn);
      nud.appendChild(b);
    }
    if (all.length) nudge(IC.cards, 'Swipe today’s ' + all.length + ' cards', function () { openStory(all[0].dataset.storyId); });
    if (quizHere()) {
      if (!info.played) nudge(IC.quiz, 'Your quiz is waiting', playQuiz, true);
      else nudge(IC.league, 'See your league', function () { try { sessionStorage.setItem('hb-qz-tab', 'leagues'); } catch (e) { /* ignore */ } tab('quiz'); if (window.HBQuizTab) window.HBQuizTab('leagues'); });
    }
    nudge(IC.listen, 'Listen to today’s brief', function () { listen(); });
    nudge(IC.week, 'This week in one read', function () { go('/week.html?src=app-home'); });
    scroller.appendChild(nud);

    // Explore
    var exS = section('Explore');
    var grid = mk('div', 'hm-tiles');
    function tile(cls, icon, name, sub, fn) {
      var b = mk('button', 'hm-tile ' + cls);
      b.type = 'button';
      var t = mk('span', 'hm-tile-t');
      t.appendChild(mk('b', '', name));
      t.appendChild(mk('small', '', sub));
      b.appendChild(t);
      var ic = mk('span', 'hm-tile-ic');
      ic.innerHTML = icon;
      b.appendChild(ic);
      b.addEventListener('click', fn);
      grid.appendChild(b);
    }
    L.forEach(function (l) {
      var n = storiesOf(l).length, k = laneKey(l);
      tile('hm-t-' + k, IC[k] || IC.ai, laneName(l), n + (n === 1 ? ' story today' : ' stories today'), function () { openLane(l); });
    });
    tile('hm-t-voices', IC.voices, 'Voices', 'The week’s best thinking', function () { go('/leaders.html'); });
    tile('hm-t-week', IC.week, 'This week', 'The Sunday recap', function () { go('/week.html?src=app-home'); });
    tile('hm-t-past', IC.archive, 'Past editions', 'Every edition so far', function () { go('/archive/'); });
    tile('hm-t-listen hm-tile-wide', IC.listen, 'Listen', 'Today’s episode and every past one', function () { listen({ episodes: true }); });
    exS.appendChild(grid);
    scroller.appendChild(exS);

    // Top stories: the first two of each section, after the lead
    var tops = [];
    L.forEach(function (l) { storiesOf(l).slice(0, 2).forEach(function (it) { if (it !== lead) tops.push([it, l]); }); });
    if (tops.length) {
      var tsS = section('Top stories', 'All ' + all.length, function () { tab('today'); });
      var tr = rail();
      tops.forEach(function (p) { tr.appendChild(storyCard(p[0], p[1], false)); });
      tsS.appendChild(tr);
      scroller.appendChild(tsS);
    }

    // Most read in Voices (real view counts; the newest piece is already in Today's mix)
    if (V) {
      var ranked = byViews(V).filter(function (b) { return !fresh || b.id !== fresh.id; }).slice(0, 6);
      if (ranked.length) {
        var vs = section('Most read in Voices', 'All', function () { go('/leaders.html'); });
        var vr = rail();
        ranked.forEach(function (b) { vr.appendChild(voiceCard(b, false)); });
        vs.appendChild(vr);
        scroller.appendChild(vs);
      }
    }

    if (quizHere()) scroller.appendChild(quizCard(info, false));
    scroller.appendChild(mk('p', 'hm-end', 'That’s today. The next edition lands tomorrow morning.'));
    if (top) scroller.scrollTop = top;
  }

  function build() {
    if (el) return;
    el = mk('section', 'hb-hub hb-home');
    el.hidden = true;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Home');
    var top = mk('header', 'hub-top hm-top');
    var logo = mk('img', 'ab-logo');
    logo.src = '/brand/logo-128.png';
    logo.alt = '';
    logo.width = logo.height = 34;
    var brand = mk('div', 'ab-brand');
    var word = mk('div', 'wordmark');
    word.innerHTML = 'The Hour <span>Brief</span>';
    brand.appendChild(word);
    var acts = mk('div', 'ab-actions');
    var chip = mk('button', 'hm-chip');
    chip.type = 'button';
    chip.addEventListener('click', function () { tab('quiz'); });
    var you = mk('button', 'ab-btn ab-menu ab-you');
    you.type = 'button';
    you.setAttribute('aria-label', 'You: your streak, badges, theme and settings');
    you.innerHTML = IC.you;
    you.addEventListener('click', function () { if (HC.you) HC.you(you); });
    acts.appendChild(chip);
    acts.appendChild(you);
    top.appendChild(logo);
    top.appendChild(brand);
    top.appendChild(acts);
    scroller = mk('div', 'hub-scroll hm-scroll');
    el.appendChild(top);
    el.appendChild(scroller);
    listenBtn = mk('button', 'hm-listen');
    listenBtn.type = 'button';
    listenBtn.innerHTML = '<span class="hm-listen-p">' + IC.play + '</span><span class="hm-listen-t">Today’s brief<small>Listen to the whole edition</small></span><span class="hm-listen-k">Listen</span>';
    listenBtn.addEventListener('click', function () { listen(); });
    el.appendChild(listenBtn);
    document.body.appendChild(el);
    document.addEventListener('hb:quiz', function () { if (shown) { chipSync(); draw(true); } });
  }
  function chipSync() {
    var chip = el && el.querySelector('.hm-chip');
    if (!chip) return;
    var info = q(), n = info.streak || 0;
    chip.innerHTML = IC.flame + '<span>' + n + '</span>';
    chip.setAttribute('aria-label', n ? n + '-day quiz streak. Open Challenge' : 'No streak yet. Open Challenge');
    chip.classList.toggle('on', n > 0);
    chip.hidden = !quizHere() && !n;
  }

  function open() {
    build();
    var first = !shown;
    if (first) {
      draw(false);
      chipSync();
      el.hidden = false;
      shown = true;
      document.documentElement.classList.add('hb-home-open');
      if (HC.use) HC.use('home');
      document.dispatchEvent(new CustomEvent('hb:hub'));
    } else scroller.scrollTo({ top: 0, behavior: 'smooth' });
    refreshVoices();
    if (window.HBWeekly && !(window.HBWeeklyNow && window.HBWeeklyNow())) window.HBWeekly().then(function (w) { if (w && shown) draw(true); });
  }
  function close() {
    if (!shown) return;
    el.hidden = true;
    shown = false;
    document.documentElement.classList.remove('hb-home-open');
    document.dispatchEvent(new CustomEvent('hb:hub'));
  }
  window.HBHome = { open: open, close: close, isOpen: function () { return shown; }, redraw: function () { if (shown) draw(true); } };
})();
