/*
 * mobile.js — phone-only reading enhancements for The Hour Brief.
 *
 * Loaded on every edition page as <script defer src="/mobile.js">. Pure
 * progressive enhancement: with no JS the page still shows every story in full.
 * Everything here is independent of the page's own inline <script> (votes, comments, scrollspy). The reading skin
 * ("reader mode") runs on phones, in the apps at any width and on the desktop website; ?classic=1 opts out on desktop.
 *
 *  - Stories keep their natural order (headline, summary, takeaway) and show in full — no "Read more" clamp.
 *  - Each section leads with a numbered highlights list (jump links) and its
 *    takeaway; the long digest sentence sits behind a toggle.
 *  - Every story has a Share button (headline + link to that story), and long
 *    pages get a reading-progress bar and a back-to-top button.
 *  - The evergreen About paragraph gets a matching "More" toggle, and a "Contact us · About · Privacy" row leads the footer.
 *  - Save-for-later bookmarks and a text-size control (both stored on this device only).
 *  - "Your sections": readers pick which sections show (menu > Sections; the apps
 *    offer it once, as a small card, on the second day they are opened). Stored on this device only.
 *  - "Listen to today's brief" (listen.js, loaded on demand where the device can speak).
 *  - Swipe cards (cards.js, loaded on demand): the same stories one per screen. Cards is the default view on phones and
 *    in the apps; the List | Cards switch, the menu and the deck's List button change it. The scrolling feed stays the
 *    source of truth (and links that point into it, such as #quiz, ?join= and ?beat=, open the list).
 *
 * "Reader mode" = everywhere except the desktop site with ?classic=1: phones get /mobile.css from the page's own link,
 * wider screens get it injected (ensureReaderCss), and the wide-screen block in /app.css centres the column.
 */
(function () {
  var mq = window.matchMedia('(max-width: 640px)');
  var Cap0 = window.Capacitor;
  var NATIVE = !!(Cap0 && typeof Cap0.isNativePlatform === 'function' && Cap0.isNativePlatform());
  // The reading skin is everywhere now: phones, the apps at any width, and the desktop website (one centred column).
  // ?classic=1 shows the old wide layout (a safety valve; phones and the apps are unaffected).
  var CLASSIC = /[?&]classic=1(&|$)/.test(location.search);
  window.HB_CLASSIC = CLASSIC;
  if (NATIVE) document.documentElement.classList.add('hb-native');

  // Google Analytics (GA4), website visitors only. The apps get their own Firebase Analytics
  // instrumentation instead — skipping it here keeps in-app WebView sessions from double-counting
  // into the website's traffic numbers.
  if (!NATIVE) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', 'G-X3GD72ENSN');
    var gaScript = document.createElement('script');
    gaScript.async = true;
    gaScript.src = 'https://www.googletagmanager.com/gtag/js?id=G-X3GD72ENSN';
    document.head.appendChild(gaScript);

    // Microsoft Clarity (heatmaps and session recordings), website only like GA: the store privacy labels for the apps do
    // not declare session recording. Clarity masks typed input (email, comments) by default. Disclosed on privacy.html.
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i + '?ref=bwt';
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', 'zgqdsavwa8');
  }

  // ---- Growth: where a visitor came from, the app store links, and the podcast links (website only) ----
  // source(): the visit's source, decided on the first page of a browser session and kept for the session, so a click on
  // "Get the app" three pages later is still credited to Google, LinkedIn, the podcast... Order: ?utm_source / ?src on the
  // landing URL, then ?ref (the share pages /e /s /q pass on the referrer they saw), then document.referrer, else "direct".
  // The first source ever seen on this browser is kept too (first touch), which also tells a new visitor from a returning one.
  // Read by app.html (store clicks), cards.js / listen.js / quiz.js (app prompts) and the growth report (growth.html).
  var REFS = [
    [/(^|\.)news\.google\./, 'google-news'], [/(^|\.)gemini\.google\./, 'gemini'], [/(^|\.)google\./, 'google'],
    [/(^|\.)bing\.com$/, 'bing'], [/(^|\.)copilot\.microsoft\.com$/, 'copilot'], [/(^|\.)duckduckgo\.com$/, 'duckduckgo'],
    [/(^|\.)yahoo\./, 'yahoo'], [/(^|\.)(chatgpt\.com|openai\.com)$/, 'chatgpt'], [/(^|\.)perplexity\.ai$/, 'perplexity'],
    [/(^|\.)claude\.ai$/, 'claude'], [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'linkedin'], [/(^|\.)(t\.co|x\.com|twitter\.com)$/, 'x'],
    [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'facebook'], [/(^|\.)instagram\.com$/, 'instagram'], [/(^|\.)threads\.net$/, 'threads'],
    [/(^|\.)reddit\.com$/, 'reddit'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'], [/(^|\.)(t\.me|telegram\.org)$/, 'telegram'],
    [/(^|\.)whatsapp\.(com|net)$/, 'whatsapp'], [/(^|\.)spotify\.com$/, 'spotify'], [/(^|\.)podcasts\.apple\.com$/, 'apple-podcasts'],
    [/(^|\.)music\.amazon\./, 'amazon-music'], [/(^|\.)jiosaavn\.com$/, 'jiosaavn'], [/(^|\.)(mail\.google\.com|outlook\.|mail\.yahoo\.)/, 'email'],
    [/(^|\.)news\.ycombinator\.com$/, 'hacker-news'], [/(^|\.)notion\.(so|site)$/, 'notion']];
  function cleanSrc(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40); }
  function refSource(host) {
    host = String(host || '').toLowerCase().replace(/^www\./, '');
    if (!host || host === location.hostname || /(^|\.)the-hour-brief\.vercel\.app$/.test(host)) return '';
    for (var i = 0; i < REFS.length; i++) if (REFS[i][0].test(host)) return REFS[i][1];
    return cleanSrc(host.split('.').slice(-2).join('.'));                         // any other site, by its domain
  }
  var GROWTH_SRC = (function () {
    if (NATIVE) return { src: 'app', first: 'app', isNew: false };
    var q = {};
    try { q = Object.fromEntries(new URLSearchParams(location.search)); } catch (e) {}
    var here = cleanSrc(q.utm_source || q.src);
    if ((!here || here === 'share') && q.ref) here = refSource(q.ref) || here;      // "share" is generic; the referrer says more
    if (!here) { try { here = refSource(document.referrer ? new URL(document.referrer).hostname : ''); } catch (e) { here = ''; } }
    var sess = '', first = null;
    try { sess = sessionStorage.getItem('hb-src-s') || ''; } catch (e) {}
    if (!sess) { sess = here || 'direct'; try { sessionStorage.setItem('hb-src-s', sess); } catch (e) {} }
    try { first = JSON.parse(localStorage.getItem('hb-src-first') || 'null'); } catch (e) {}
    var isNew = false;
    if (!first || !first.src) {
      first = { src: sess, day: localDay() }; isNew = true;
      try { localStorage.setItem('hb-src-first', JSON.stringify(first)); } catch (e) { isNew = false; }
    } else if (first.day === localDay()) isNew = true;                           // still the day they first came
    return { src: sess, first: first.src, isNew: isNew };
  })();
  var STORES = { ios: 'https://apps.apple.com/app/id6817195056', android: 'https://play.google.com/store/apps/details?id=app.thehourbrief' };
  // The show on each podcast app. Paste each link as it goes live; a platform with no link is simply not shown.
  var PODCASTS = [
    ['spotify', 'Spotify', 'https://open.spotify.com/show/1FjOE5ABaOEzUTxwJeaoYr'],
    ['apple', 'Apple Podcasts', ''],        // Podcasts Connect show 277c6497…: not in Apple's public directory yet (21 Nov)
    ['youtube', 'YouTube Music', ''],
    ['amazon', 'Amazon Music', ''],
    ['jiosaavn', 'JioSaavn', ''],           // YourCast podcast 624163: no public show page yet (21 Nov)
  ].filter(function (p) { return /^https:\/\//.test(p[2]); });
  // The daily channels (the same post every morning). Paste each invite link once the channel exists; empty ones are not shown.
  var CHANNELS = [
    ['whatsapp', 'WhatsApp', 'https://whatsapp.com/channel/0029Vb9RU0kCXC3F1pRY6q2L'],
    ['telegram', 'Telegram', 'https://t.me/thehourbrief'],
  ].filter(function (p) { return /^https:\/\//.test(p[2]); });
  // place = where on the site the link was tapped (footer, end-card, quiz, audio...); to = a specific store, else the
  // device's own (desktops see a QR page).
  function appLink(place, to) {
    return '/app?src=' + encodeURIComponent(cleanSrc(place) || 'web') + (to ? '&to=' + to : '');
  }
  window.HBGrowth = {
    native: NATIVE, source: GROWTH_SRC, stores: STORES, podcasts: PODCASTS, appLink: appLink,
    track: function (event, extra) { track(event, extra); }
  };
  countWebVisit();                                   // every page with this script, not just editions: a visit from Google can land on Voices

  // "Get the app" + "Listen on" block at the foot of every page on the website (editions, past editions, Voices, About...):
  // the store badges go through /app (counted, tagged for the stores), the podcast links are counted as they leave.
  var WA_SVG = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none" aria-hidden="true"><path d="M3.6 20.4l1.2-3.9A8.6 8.6 0 1 1 8 19.3z"/><path d="M9.2 8.1c-.3 2 2.4 5.6 5.6 6.4l1.4-1.3-1.9-1.1-.9.8c-1.1-.5-2.2-1.6-2.7-2.7l.8-.9-1.1-1.9z"/></svg>';
  var TG_SVG = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none" aria-hidden="true"><path d="M21 4.5L2.8 11.4l5.6 2 2.2 6.1 3.2-3.6 4.6 3.4z"/><path d="M8.4 13.4L21 4.5 10.6 15.9"/></svg>';
  var STORE_ICON = {
    ios: 'M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.9-.8-3.1-.8C6.8 7.4 5.3 8.3 4.5 9.8c-1.7 2.9-.4 7.2 1.2 9.6.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8s1.9.8 3.1.8c1.3 0 2.1-1.2 2.9-2.4.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.7-1-2.7-4.1zM14.2 5.6c.6-.8 1.1-1.9 1-3-1 0-2.1.6-2.8 1.4-.6.7-1.1 1.8-1 2.9 1.1.1 2.1-.5 2.8-1.3z',
    android: 'M3.6 2.3c-.3.3-.4.7-.4 1.2v17c0 .5.1.9.4 1.2l9.6-9.7-9.6-9.7zm10.6 10.7l2.9 2.9-11.2 6.4c-.4.2-.8.3-1.1.2l9.4-9.5zm4-4l3 1.7c.9.5.9 1.3 0 1.8l-3 1.7-3.2-3.2 3.2-2zM5.1 1.9c.4-.1.7 0 1.1.2l11.2 6.4-2.9 2.9-9.4-9.5z'
  };
  function growthCss() {
    if (document.getElementById('hb-growth-css')) return;
    var st = document.createElement('style');
    st.id = 'hb-growth-css';
    st.textContent =
      '.hb-get{margin:28px 0 8px;padding:18px;border:1px solid var(--line,#e3e1f0);border-radius:14px;background:var(--paper-2,rgba(94,67,243,.04));display:flex;gap:18px;align-items:center;flex-wrap:wrap}' +
      '.hb-get-tx{flex:1 1 220px;min-width:0}.hb-get-tx strong{display:block;font-size:1rem;color:var(--ink,#14151f);margin-bottom:3px}' +
      '.hb-get-tx span{font-size:.86rem;color:var(--ink-soft,#5b5d72);line-height:1.45}' +
      '.hb-badges{display:flex;gap:8px;flex-wrap:wrap}' +
      '.hb-badge{display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border-radius:10px;background:#14151f;color:#fff!important;text-decoration:none!important;font-size:.82rem;font-weight:600;line-height:1.1}' +
      '.hb-badge svg{width:18px;height:18px;fill:currentColor;flex:none}.hb-badge span,.hb-badge small{color:#fff!important}.hb-badge small{display:block;font-weight:400;font-size:.66rem;opacity:.8}' +
      '.hb-qr{width:84px;height:84px;background:#fff;padding:6px;border-radius:10px;border:1px solid var(--line,#e3e1f0);flex:none}' +
      '@media (max-width:640px){.hb-qr{display:none}}' +
      '.hb-pods{flex-basis:100%;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font-size:.84rem;color:var(--ink-soft,#5b5d72);border-top:1px solid var(--line,#e3e1f0);padding-top:12px}' +
      '.hb-pods a{color:var(--ink,#14151f);font-weight:600}' +
      '.hb-appcta{display:flex;gap:12px;align-items:center;margin-top:14px;padding:12px 14px;border-radius:12px;background:rgba(94,67,243,.08);text-decoration:none!important;color:var(--ink,#14151f)!important}' +
      '.hb-appcta img{width:36px;height:36px;border-radius:9px;flex:none}.hb-appcta b{display:block;font-size:.9rem}.hb-appcta span{font-size:.8rem;color:var(--ink-soft,#5b5d72)}' +
      '.hb-appcta i{margin-left:auto;font-style:normal;font-weight:700;color:#5e43f3;white-space:nowrap}';
    document.head.appendChild(st);
  }
  function badge(store, place) {
    var a = document.createElement('a');
    a.className = 'hb-badge';
    a.href = appLink(place, store);
    a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + STORE_ICON[store] + '"/></svg><span><small>' +
      (store === 'ios' ? 'Download on the' : 'Get it on') + '</small>' + (store === 'ios' ? 'App Store' : 'Google Play') + '</span>';
    return a;
  }
  function linkRow(label, list, event) {
    if (!list.length) return null;
    var row = document.createElement('div');
    row.className = 'hb-pods';
    row.appendChild(document.createTextNode(label));
    list.forEach(function (p) {
      var a = document.createElement('a');
      a.href = p[2]; a.target = '_blank'; a.rel = 'noopener'; a.textContent = p[1];
      a.addEventListener('click', function () { track(event, { place: p[0] }); });
      row.appendChild(a);
    });
    return row;
  }
  function podcastLinks() { return linkRow('Listen to the daily episode on', PODCASTS, 'podcast_out'); }
  function channelLinks() { return linkRow('Get the brief every morning on', CHANNELS, 'channel_out'); }
  // A one-line app prompt for the moments a reader is most likely to want the app (end of the deck, quiz done, Audio).
  function appPrompt(place, title, sub) {
    if (NATIVE) return null;
    growthCss();
    var a = document.createElement('a');
    a.className = 'hb-appcta';
    a.href = appLink(place);
    a.innerHTML = '<img src="/brand/icon-192.png" alt=""><span><b></b><span></span></span><i>Get the app</i>';
    a.querySelector('b').textContent = title;
    a.querySelector('span span').textContent = sub;
    track('app_prompt_shown', { place: place });
    return a;
  }
  window.HBGrowth.appPrompt = appPrompt;
  window.HBGrowth.podcastLinks = podcastLinks;
  (function footerGetApp() {
    if (NATIVE) return;
    var foot = document.querySelector('footer.colophon');
    if (!foot || document.querySelector('.hb-get')) return;
    growthCss();
    var box = document.createElement('div');
    box.className = 'hb-get';
    var qr = document.createElement('img');
    qr.className = 'hb-qr'; qr.src = '/brand/app-qr.svg'; qr.alt = 'QR code: get the app on your phone'; qr.width = qr.height = 84;
    var tx = document.createElement('div');
    tx.className = 'hb-get-tx';
    tx.innerHTML = '<strong>Get The Hour Brief app</strong><span>Free. The brief on your phone at 8am, read aloud, offline, with the daily quiz and your streak.</span>';
    var b = document.createElement('div');
    b.className = 'hb-badges';
    b.appendChild(badge('ios', 'footer'));
    b.appendChild(badge('android', 'footer'));
    tx.appendChild(b);
    box.appendChild(qr);
    box.appendChild(tx);
    var chans = channelLinks();
    if (chans) box.appendChild(chans);
    var pods = podcastLinks();
    if (pods) box.appendChild(pods);
    foot.insertBefore(box, foot.firstChild);
  })();

  function reader() { return !CLASSIC || mq.matches || NATIVE; }
  function ensureReaderCss() {
    if (document.querySelector('link[data-reader-css]')) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = '/mobile.css';                      // imports reader.css and app.css; the page only links it for phone widths
    l.setAttribute('data-reader-css', '');
    document.head.appendChild(l);
  }

  // Every story shows in full, no "Read more" toggle — the .story-body wrapper stays (cards.js reads it to build
  // story cards), it just never gets the clamp class applied to it any more.
  function collapsibleStories() {
    document.querySelectorAll('.item').forEach(function (item) {
      var inner = item.querySelector(':scope > div');
      if (!inner || item.dataset.collapseReady) return;

      var bodyParas = Array.prototype.filter.call(inner.children, function (el) {
        return el.tagName === 'P' && !el.classList.contains('takeaway');
      });
      if (!bodyParas.length) { item.dataset.collapseReady = 'none'; return; }

      // Nothing is reordered, so desktop (which never loads mobile.css) is untouched.
      var wrap = document.createElement('div');
      wrap.className = 'story-body';
      wrap.id = 'sb-' + (item.dataset.storyId || Math.random().toString(36).slice(2));
      inner.insertBefore(wrap, bodyParas[0]);
      bodyParas.forEach(function (p) { wrap.appendChild(p); });
      item.dataset.collapseReady = 'yes';
    });
  }

  function laneToggles() {
    document.querySelectorAll('.lane-head').forEach(function (head) {
      var h2 = head.querySelector('h2');
      if (!h2) return;
      var btn = head.querySelector('.lane-more');
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'lane-more';
        btn.textContent = 'More';
        btn.setAttribute('aria-expanded', 'false');
        btn.addEventListener('click', function () {
          var expanded = head.classList.toggle('is-expanded');
          btn.setAttribute('aria-expanded', String(expanded));
          btn.textContent = expanded ? 'Less' : 'More';
        });
        h2.insertAdjacentElement('afterend', btn);
      }
      btn.hidden = !reader();
      if (!reader()) head.classList.remove('is-expanded');
    });
  }

  function aboutToggle() {
    var about = document.querySelector('.about');
    if (!about) return;
    var para = about.querySelector('p');
    if (!para) return;

    var btn = about.querySelector('.about-toggle');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'about-toggle';
      btn.textContent = 'More';
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', function () {
        var expanded = about.classList.toggle('is-expanded');
        btn.setAttribute('aria-expanded', String(expanded));
        btn.textContent = expanded ? 'Less' : 'More';
      });
      var freeLine = about.querySelector('.free-line');
      if (freeLine) about.insertBefore(btn, freeLine);
      else para.parentNode.appendChild(btn);
    }
    btn.hidden = !reader();
    if (!reader()) about.classList.remove('is-expanded');
  }

  // Show the section digest toggle only where its own clamp really hides something.
  function measureClamps() {
    if (!reader()) return;
    document.querySelectorAll('.lane-head:not(.is-expanded)').forEach(function (head) {
      var h2 = head.querySelector('h2');
      var btn = head.querySelector('.lane-more');
      if (h2 && btn) btn.hidden = !(h2.scrollHeight > h2.clientHeight + 1);
    });
  }

  var measureQueued = false;
  function queueMeasure() {
    if (measureQueued) return;
    measureQueued = true;
    requestAnimationFrame(function () { measureQueued = false; measureClamps(); });
  }

  // ---- Section header: numbered highlights (jump links) instead of a run-on title ----
  var SHARE_SVG = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/>' +
    '<path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';

  function laneDigests() {
    document.querySelectorAll('section.lane').forEach(function (lane) {
      var head = lane.querySelector('.lane-head');
      var h2 = head && head.querySelector('h2');
      if (!head || !h2) return;
      var items = lane.querySelectorAll('.item[data-story-id]');
      items.forEach(function (it) { if (!it.id) it.id = it.dataset.storyId; });

      var box = head.querySelector('.lane-digest');
      if (!box && items.length) {
        box = document.createElement('div');
        box.className = 'lane-digest mob-only';
        var label = document.createElement('div');
        label.className = 'lane-digest-label';
        label.textContent = 'Today’s highlights';
        var ol = document.createElement('ol');
        ol.className = 'lane-digest-list';
        items.forEach(function (it) {
          var h3 = it.querySelector('h3');
          if (!h3) return;
          var li = document.createElement('li');
          var a = document.createElement('a');
          a.href = '#' + it.id;
          a.textContent = h3.textContent.trim();
          li.appendChild(a);
          ol.appendChild(li);
        });
        box.appendChild(label);
        box.appendChild(ol);
        // The takeaway (if any) comes first, reading like a summary of the section; the highlights are the pointers
        // underneath it, before each story runs one after another. The lane's own <h2> (a long run-on sentence meant
        // for RSS/search) is simply hidden by CSS whenever a .lane-tag is present — see reader.css — rather than
        // shown behind a toggle: nobody asked to read it, Takeaway + highlights already say what matters.
        (head.querySelector('.lane-takeaway') || head.querySelector('.lane-more') || h2).insertAdjacentElement('afterend', box);
        var tag = head.querySelector('.lane-tag');
        if (tag) lane.setAttribute('aria-label', tag.textContent.trim());
      }
      if (box) box.hidden = !reader();
    });
  }

  // ---- Reading time per section (~200 words a minute) ----
  function readTimes() {
    document.querySelectorAll('section.lane').forEach(function (lane) {
      var tag = lane.querySelector('.lane-tag');
      var items = lane.querySelectorAll('.item');
      if (!tag || !items.length) return;
      var t = tag.querySelector('.lane-time');
      if (!t) {
        var words = 0;
        items.forEach(function (it) {
          it.querySelectorAll('h3, p').forEach(function (n) { words += (n.textContent.match(/\S+/g) || []).length; });
        });
        t = document.createElement('span');
        t.className = 'lane-time';
        t.textContent = ' \u00B7 ' + Math.max(1, Math.round(words / 200)) + ' min read';
        tag.appendChild(t);
      }
      t.hidden = !reader();
    });
  }

  // ---- Share a single story, with attribution and a link to that story ----
  function editionDate() {
    var pageEl = document.querySelector('[data-edition-date]');
    return pageEl && pageEl.getAttribute('data-edition-date');
  }
  function storyUrl(it) {
    var d = editionDate();
    // Landing page with story-specific link-preview tags; it redirects people straight to the story.
    return d ? location.origin + '/s/' + d + '/' + it.id + '?utm_source=share&utm_medium=story'
             : location.origin + location.pathname + '#' + it.id;
  }
  function toast(msg) {
    var t = document.getElementById('mob-toast');
    if (!t) { t = document.createElement('div'); t.id = 'mob-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2200);
  }
  window.HBToast = toast;                             // capacitor-bridge.js confirms the daily reminder with it
  function shareStory(it) {
    var h3 = it.querySelector('h3');
    var headline = h3 ? h3.textContent.trim() : document.title;
    var tk = it.querySelector('.takeaway');
    var take = tk ? tk.textContent.replace(/^\s*Takeaway\s*/i, '').trim() : '';
    if (take.length > 140) take = take.slice(0, 137).replace(/\s+\S*$/, '') + '\u2026';
    var payload = {
      title: headline,
      text: '\u201C' + headline + '\u201D' + (take ? '\n' + take : '') + '\n\u2014 via The Hour Brief #TheHourBrief',
      url: storyUrl(it),
      dialogTitle: 'Share this story'
    };
    var Cap = window.Capacitor;
    var P = (Cap && Cap.Plugins) || {};
    var native = Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform();
    var p;
    if (native && P.Share) p = P.Share.share(payload);
    else if (navigator.share) p = navigator.share(payload);
    else if (navigator.clipboard) p = navigator.clipboard.writeText(payload.text + ' ' + payload.url).then(function () { toast('Link copied'); });
    if (p && p.catch) p.catch(function () {});
  }
  function storyButtons() {
    document.querySelectorAll('.item[data-story-id]').forEach(function (it) {
      if (!it.id) it.id = it.dataset.storyId;
      var row = it.querySelector('.vote-row');
      if (!row) return;
      var sv = row.querySelector('.story-save');
      if (!sv && editionDate()) {
        sv = mk('button', 'story-save mob-only');
        sv.type = 'button';
        sv.innerHTML = STAR_SVG;
        sv.addEventListener('click', function () { toggleSaved(it); });
        row.appendChild(sv);
      }
      var b = row.querySelector('.story-share');
      if (!b) {
        b = mk('button', 'story-share mob-only');
        b.type = 'button';
        b.setAttribute('aria-label', 'Share this story');
        b.innerHTML = SHARE_SVG;
        b.addEventListener('click', function () { shareStory(it); });
        row.appendChild(b);
      }
      if (sv) sv.hidden = !reader();
      b.hidden = !reader();
    });
    refreshSaved();
  }

  // ---- Reading progress + back to top ----
  function progressUi() {
    var bar = document.getElementById('mob-progress');
    var top = document.getElementById('mob-top');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'mob-progress';
      bar.className = 'mob-only';
      bar.setAttribute('aria-hidden', 'true');
      document.body.appendChild(bar);
      top = document.createElement('button');
      top.id = 'mob-top';
      top.type = 'button';
      top.className = 'mob-only';
      top.textContent = '↑ Top';
      top.setAttribute('aria-label', 'Back to top');
      top.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
      document.body.appendChild(top);
      var ticking = false, lastY = window.scrollY;
      window.addEventListener('scroll', function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
          ticking = false;
          var y = window.scrollY;
          var max = document.documentElement.scrollHeight - window.innerHeight;
          bar.style.width = max > 0 ? Math.min(100, Math.max(0, y / max * 100)) + '%' : '0';
          // Only offer "Top" when scrolling back up, so it never covers text while reading down.
          if (Math.abs(y - lastY) > 6) top.classList.toggle('show', y < lastY && y > window.innerHeight * 1.5);
          if (y < window.innerHeight * 1.5) top.classList.remove('show');
          lastY = y;
        });
      }, { passive: true });
    }
    bar.hidden = top.hidden = !reader();
  }

  // ---- Small DOM helper ----
  function mk(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function prettyDate(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
    return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1] : (d || '');
  }

  // ---- Bottom sheet (used by text size and saved stories) ----
  var usedKeyboard = false;
  document.addEventListener('keydown', function () { usedKeyboard = true; var r = document.querySelector('.no-ring'); if (r) r.classList.remove('no-ring'); }, true);
  document.addEventListener('pointerdown', function () { usedKeyboard = false; }, true);
  var sheetEl = null, sheetPrev = null;
  function sheetKey(e) { if (e.key === 'Escape') closeSheet(); }
  function closeSheet() {
    if (!sheetEl) return;
    sheetEl.remove();
    sheetEl = null;
    document.removeEventListener('keydown', sheetKey);
    if (sheetPrev && sheetPrev.focus) sheetPrev.focus();
  }
  function openSheet(title, build, returnTo, closeLabel) {
    closeSheet();
    sheetPrev = returnTo || document.activeElement;
    var bg = mk('div', 'rd-sheet-bg');
    var box = mk('div', 'rd-sheet');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', title);
    box.appendChild(mk('h2', '', title));
    var body = mk('div');
    box.appendChild(body);
    build(body);
    var close = mk('button', 'rd-btn rd-close' + (closeLabel ? ' primary' : ''), closeLabel || 'Close');
    close.type = 'button';
    close.addEventListener('click', closeSheet);
    box.appendChild(close);
    bg.appendChild(box);
    bg.addEventListener('click', function (e) { if (e.target === bg) closeSheet(); });
    document.addEventListener('keydown', sheetKey);
    document.body.appendChild(bg);
    sheetEl = bg;
    close.focus({ preventScroll: true });
    if (!usedKeyboard) close.classList.add('no-ring');       // focus moved in for screen readers, not because someone tabbed here
  }

  // ---- Text size (root font-size scale; kept on this device) ----
  var SIZES = [100, 112, 125, 140];
  var SIZE_NAMES = ['Default', 'Large', 'Larger', 'Largest'];
  function getSize() {
    try { var i = parseInt(localStorage.getItem('hb-textsize'), 10); return i >= 0 && i < SIZES.length ? i : 0; }
    catch (e) { return 0; }
  }
  function applyTextSize() {
    var i = reader() ? getSize() : 0;
    document.documentElement.style.fontSize = SIZES[i] === 100 ? '' : SIZES[i] + '%';
  }
  function setSize(i) {
    try { localStorage.setItem('hb-textsize', String(i)); } catch (e) { /* ignore */ }
    applyTextSize();
  }
  function openTextSize(returnTo) {
    openSheet('Text size', function (body) {
      var label = mk('p', 'rd-size-label');
      label.setAttribute('aria-live', 'polite');
      var row = mk('div', 'rd-row');
      var minus = mk('button', 'rd-btn', 'A−');
      minus.type = 'button';
      minus.setAttribute('aria-label', 'Smaller text');
      var plus = mk('button', 'rd-btn', 'A+');
      plus.type = 'button';
      plus.setAttribute('aria-label', 'Larger text');
      var reset = mk('button', 'rd-btn', 'Reset');
      reset.type = 'button';
      function upd() {
        var i = getSize();
        label.textContent = SIZE_NAMES[i] + ' (' + SIZES[i] + '%)';
        minus.disabled = i === 0;
        plus.disabled = i === SIZES.length - 1;
      }
      minus.addEventListener('click', function () { setSize(Math.max(0, getSize() - 1)); upd(); });
      plus.addEventListener('click', function () { setSize(Math.min(SIZES.length - 1, getSize() + 1)); upd(); });
      reset.addEventListener('click', function () { setSize(0); upd(); });
      row.appendChild(minus);
      row.appendChild(plus);
      row.appendChild(reset);
      body.appendChild(label);
      body.appendChild(row);
      body.appendChild(mk('p', 'rd-size-sample', 'Every item links back to its original source — read the take here, click through for the full story.'));
      upd();
    }, returnTo);
  }

  // ---- Save for later (bookmarks; a list on this device only) ----
  var SAVED_KEY = 'hb-saved-v1';
  var STAR_SVG = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
  function loadSaved() {
    try { var a = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function storeSaved(a) { try { localStorage.setItem(SAVED_KEY, JSON.stringify(a.slice(0, 200))); } catch (e) { /* ignore */ } }
  function storyKey(it) { return editionDate() + ':' + it.dataset.storyId; }
  function refreshSaved() {
    var list = loadSaved(), keys = {};
    list.forEach(function (x) { keys[x.k] = true; });
    document.querySelectorAll('.item[data-story-id] .story-save').forEach(function (b) {
      var on = !!keys[storyKey(b.closest('.item'))];
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? 'Remove from saved stories' : 'Save this story for later');
    });
    document.querySelectorAll('.reader-saved').forEach(function (btn) {        // Today's masthead, plus Audio/Challenge's own copy of it
      var count = btn.querySelector('.rd-count');
      if (count) count.textContent = list.length ? String(list.length) : '';
      btn.setAttribute('aria-label', 'Saved stories' + (list.length ? ', ' + list.length : ''));
    });
  }
  function toggleSaved(it) {
    var k = storyKey(it), list = loadSaved(), at = -1;
    list.forEach(function (x, n) { if (x.k === k) at = n; });
    var h3 = it.querySelector('h3');
    if (at >= 0) { list.splice(at, 1); toast('Removed from saved'); }
    else { list.unshift({ k: k, d: editionDate(), id: it.dataset.storyId, h: h3 ? h3.textContent.trim() : '', t: Date.now() }); toast('Saved for later'); }
    storeSaved(list);
    refreshSaved();
  }
  function openSaved(returnTo) {
    openSheet('Saved stories', function (body) {
      var empty = 'Nothing saved yet. Tap the bookmark on a story to keep it here.';
      var list = loadSaved();
      if (!list.length) { body.appendChild(mk('p', '', empty)); return; }
      var ul = mk('ul', 'rd-saved');
      list.forEach(function (x) {
        var li = mk('li');
        var left = mk('div');
        var a = mk('a', '', x.h || x.id);
        a.href = '/archive/' + x.d + '.html#' + x.id;
        left.appendChild(a);
        left.appendChild(mk('small', '', prettyDate(x.d)));
        var rm = mk('button', 'rd-btn rd-remove', 'Remove');
        rm.type = 'button';
        rm.setAttribute('aria-label', 'Remove ' + (x.h || 'story') + ' from saved');
        rm.addEventListener('click', function () {
          storeSaved(loadSaved().filter(function (y) { return y.k !== x.k; }));
          li.remove();
          refreshSaved();
          if (!ul.children.length) { ul.remove(); body.appendChild(mk('p', '', empty)); }
        });
        li.appendChild(left);
        li.appendChild(rm);
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }, returnTo);
  }

  // ---- Your sections: which sections show, and in what order (kept on this device only) ----
  // Stored as { order: [section ids], off: [section ids] }. Sections are moved and hidden in place,
  // so every id, link and script keeps working; hidden ones carry data-pref-off (listen.js reads it).
  var PREF_KEY = 'hb-prefs-v1';
  var SLIDERS_SVG = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><path d="M4 6h9"/><path d="M17 6h3"/><circle cx="15" cy="6" r="2"/>' +
    '<path d="M4 12h3"/><path d="M11 12h9"/><circle cx="9" cy="12" r="2"/><path d="M4 18h9"/><path d="M17 18h3"/><circle cx="15" cy="18" r="2"/></svg>';
  var DOWNLOAD_SVG = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" fill="none" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 19h16"/></svg>';
  var CARDS_SVG = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><rect x="6.5" y="4" width="11" height="16" rx="2"/><path d="M3 8v8"/><path d="M21 8v8"/></svg>';
  var prefs = null, laneBase = null, prefSig = null, lastNavKey = '';

  function idList(a) { return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string'; }) : []; }
  function loadPrefs() {
    try {
      var o = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
      // Sections can no longer be moved (owner, 2026-11-19): an order saved before then is dropped, not applied.
      if (o && typeof o === 'object') return { order: [], off: idList(o.off) };
    } catch (e) { /* none saved */ }
    return null;
  }
  function storePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); return true; } catch (e) { return false; }
  }
  function laneName(el) {
    var tag = el.querySelector('.lane-tag');
    if (!tag) return el.id;
    var c = tag.cloneNode(true), t = c.querySelector('.lane-time');
    if (t) t.remove();
    return c.textContent.trim() || el.id;
  }
  function orderedIds(canon) {
    var seen = {}, out = [];
    prefs.order.forEach(function (id) { if (canon.indexOf(id) >= 0 && !seen[id]) { seen[id] = true; out.push(id); } });
    canon.forEach(function (id) { if (!seen[id]) out.push(id); });
    return out;
  }
  // The sections a reader can choose between (a quiz with no questions today is not one of them).
  function choosable() {
    return laneBase ? orderedIds(laneBase.ids).filter(function (id) { var el = document.getElementById(id); return el && !el.hidden; }) : [];
  }

  function applyPrefs() {
    if (!prefs) prefs = loadPrefs() || { order: [], off: [] };
    var els = Array.prototype.slice.call(document.querySelectorAll('section.lane[id]'));
    if (!els.length) return;
    var parent = els[0].parentNode;
    if (els.some(function (e) { return e.parentNode !== parent; })) return;   // an unfamiliar page layout: leave it alone
    if (!laneBase) {
      laneBase = { ids: els.map(function (e) { return e.id; }), end: document.createComment('lanes-end') };
      parent.insertBefore(laneBase.end, els[els.length - 1].nextSibling);
    }
    var on = reader(), byId = {};
    els.forEach(function (e) { byId[e.id] = e; });
    var ids = on ? orderedIds(laneBase.ids) : laneBase.ids;
    ids.forEach(function (id) { parent.insertBefore(byId[id], laneBase.end); });

    var nav = document.querySelector('.nav'), pills = {};
    if (nav) {
      nav.querySelectorAll('a[href^="#"]').forEach(function (a) { pills[a.getAttribute('href').slice(1)] = a; });
      var after = nav.querySelector('a:not([href^="#"])');
      ids.forEach(function (id) { if (pills[id]) nav.insertBefore(pills[id], after); });
    }
    var shown = [];
    ids.forEach(function (id) {
      var off = on && prefs.off.indexOf(id) >= 0;
      byId[id].style.display = off ? 'none' : '';
      if (off) byId[id].setAttribute('data-pref-off', ''); else byId[id].removeAttribute('data-pref-off');
      if (pills[id]) pills[id].style.display = off ? 'none' : '';
      if (!off) shown.push(id);
    });
    document.body.classList.toggle('hb-quiz-off', on && prefs.off.indexOf('quiz') >= 0);
    // The pill row snaps to the pill it was on: when the sections shown change, start again from the first one.
    var navKey = shown.join(',') + '|' + ids.join(',');
    if (nav && navKey !== lastNavKey) { nav.scrollLeft = 0; lastNavKey = navKey; }

    var sig = on ? shown.join(',') : '';
    if (prefSig !== null && sig !== prefSig) document.dispatchEvent(new CustomEvent('hb:prefs'));
    prefSig = sig;
    if (on) laneList();                               // remembered for the Sections sheet on the other screens
  }
  function commitPrefs() { storePrefs(); applyPrefs(); syncSoon(); }

  // The sections a reader can switch, as [{ id, name }]: from this page when it is an edition, otherwise as last seen on
  // one, so the Menu offers Sections on every screen, not only on Today (owner, 2026-11-19: the menu must not change from
  // screen to screen). Changes made elsewhere apply when the reader is back on an edition.
  var LANES_KEY = 'hb-lanes-v1';
  function laneList() {
    if (laneBase) {
      var list = choosable().map(function (id) { return { id: id, name: laneName(document.getElementById(id)) }; });
      if (list.length) { try { localStorage.setItem(LANES_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ } }
      return list;
    }
    try {
      var c = JSON.parse(localStorage.getItem(LANES_KEY) || 'null');
      if (Array.isArray(c)) return c.filter(function (x) { return x && typeof x.id === 'string' && typeof x.name === 'string'; });
    } catch (e) { /* none seen yet */ }
    return [];
  }

  // Show or hide sections. Moving them up and down was taken out (owner, 2026-11-19): every reader gets the same order.
  function openPrefs(returnTo) {
    if (!laneList().length) return;
    if (!prefs) prefs = loadPrefs() || { order: [], off: [] };
    var msg = null;
    tipDone('sections');
    openSheet('Your sections', function (body) {
      body.appendChild(mk('p', '', laneBase ? 'Choose which sections you see. Changes apply straight away.'
        : 'Choose which sections you see in Today’s edition.'));
      var ul = mk('ul', 'rd-prefs');
      msg = mk('p', 'rd-prefs-msg');
      msg.setAttribute('role', 'status');
      var reset = mk('button', 'rd-btn rd-reset', 'Show all sections');
      reset.type = 'button';
      body.appendChild(ul);
      body.appendChild(msg);
      body.appendChild(reset);

      function draw(focus) {
        var lanes = laneList(), onCount = lanes.filter(function (l) { return prefs.off.indexOf(l.id) < 0; }).length;
        ul.textContent = '';
        lanes.forEach(function (l) {
          var id = l.id;
          var li = mk('li');
          li.setAttribute('data-id', id);
          var lab = mk('label', 'rd-sw');
          var cb = mk('input');
          cb.type = 'checkbox';
          cb.setAttribute('role', 'switch');
          cb.checked = prefs.off.indexOf(id) < 0;
          cb.addEventListener('change', function () {
            if (!cb.checked && onCount <= 1) { cb.checked = true; msg.textContent = 'Keep at least one section on.'; return; }
            msg.textContent = '';
            prefs.off = prefs.off.filter(function (x) { return x !== id; });
            if (!cb.checked) prefs.off.push(id);
            commitPrefs();
            draw('[data-id="' + id + '"] input');
          });
          lab.appendChild(cb);
          lab.appendChild(mk('span', 'rd-sw-name', l.name));
          li.appendChild(lab);
          ul.appendChild(li);
        });
        var f = focus && ul.querySelector(focus);
        if (f) f.focus({ preventScroll: true });
      }
      reset.addEventListener('click', function () {
        prefs = { order: [], off: [] };
        msg.textContent = 'All sections are on.';
        commitPrefs();
        draw();
      });
      draw();
    }, returnTo, 'Done');
  }

  // ---- Swipe cards: a second way to read the same stories (cards.js, loaded on demand) ----
  var VIEW_KEY = 'hb-view-v1', cardsLoad = 0, cardsQueue = [];
  function cardsOk() { return reader() && (NATIVE || mq.matches) && isFeed(); }
  function getView() { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards'; } catch (e) { return 'cards'; } }   // Cards unless the reader chose List
  function deckOpen() { return !!(window.HBCards && window.HBCards.isOpen()); }
  function withCards(fn, fail) {
    if (window.HBCards) { fn(window.HBCards); return; }
    cardsQueue.push({ ok: fn, fail: fail });
    if (cardsLoad) return;
    cardsLoad = 1;
    var sc = document.createElement('script');
    sc.src = '/cards.js';
    sc.onload = function () { var q = cardsQueue; cardsQueue = []; q.forEach(function (e) { if (window.HBCards) e.ok(window.HBCards); else if (e.fail) e.fail(); }); };
    sc.onerror = function () {
      cardsLoad = 0;
      var q = cardsQueue; cardsQueue = [];
      var asked = false;
      q.forEach(function (e) { if (e.fail) e.fail(); else asked = true; });
      if (asked) toast('Cards could not load. Check your connection.');
    };
    document.head.appendChild(sc);
  }
  function openCards(opts) { withCards(function (c) { if (!c.open(opts)) toast('Nothing to show as cards yet.'); }); }

  // What the page address asks for when Cards is the view: {} = just open, {id} = a shared story's card, null = stay on the list
  // (#quiz and other sections, a league invite ?join=, a friend's score ?beat=: all of those land on something in the list).
  function deckTarget() {
    if (/[?&](join|beat)=/.test(location.search)) return null;
    var h = '';
    try { h = decodeURIComponent((location.hash || '').slice(1)); } catch (e) { /* ignore */ }
    if (!h) return {};
    var el = document.getElementById(h);
    return el && el.classList.contains('item') ? { id: h } : null;
  }
  // While the deck is on its way (cards.js is fetched on demand) the page is hidden, so the list never flashes first.
  var pendingT = 0;
  function pendingOn() { if (document.body) { document.body.style.visibility = 'hidden'; pendingT = setTimeout(pendingOff, 4000); } }
  function pendingOff() { clearTimeout(pendingT); if (document.body) document.body.style.visibility = ''; }
  function restoreView(done) {
    var t = laneBase && cardsOk() && getView() === 'cards' ? deckTarget() : null;
    function end() { pendingOff(); if (done) done(); }
    if (!t) { end(); return; }
    withCards(function (c) { c.open(t.id ? t : undefined); end(); }, end);
  }
  // Customising is offered in passing, not at the door. The app counts the days it is opened; on the second day one small
  // card asks about sections (only for people with no saved sections). It sits above the first section, or under the top
  // bar of the deck when Cards is showing. It is shown through the day it first appears, never again on a later day.
  var TIP_KEY = 'hb-tip-v1';
  function tipState() {
    try {
      var o = JSON.parse(localStorage.getItem(TIP_KEY) || 'null');
      if (o && typeof o === 'object') return { n: +o.n || 0, last: String(o.last || ''), done: !!o.done, secOn: String(o.secOn || '') };
    } catch (e) { /* none saved */ }
    return { n: 0, last: '', done: false, secOn: '' };
  }
  function tipSave(st) { try { localStorage.setItem(TIP_KEY, JSON.stringify(st)); return true; } catch (e) { return false; } }
  function localDay() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function tipDone(which) {
    var el = document.querySelector('.hb-tip[data-tip="' + which + '"]');
    if (el) el.remove();
    var st = tipState();
    if (!st.done) { st.done = true; tipSave(st); }
  }
  // Reading in Cards should never be interrupted by this — no floating card eating into the deck, no lost space.
  // Cards is the default view, so most people would otherwise see this on literally their first card; it now simply
  // waits and offers it in List instead, the next time the reader happens to be there (never "used up" silently
  // while hidden behind the deck — see the early return in maybeSuggest() below).
  function tipCard(which, icon, title, body, goText, go, onDismiss) {
    if (deckOpen()) return false;
    var first = document.querySelector('section.lane');
    if (!first || document.querySelector('.hb-tip')) return false;
    var card = mk('aside', 'hb-tip');
    card.setAttribute('data-tip', which);
    card.setAttribute('aria-label', title);
    var ico = mk('span', 'hb-tip-ico');
    ico.innerHTML = icon;
    var text = mk('div', 'hb-tip-text');
    text.appendChild(mk('strong', '', title));
    text.appendChild(mk('span', '', body));
    var acts = mk('div', 'hb-tip-acts');
    var yes = mk('button', 'hb-tip-go', goText);
    yes.type = 'button';
    yes.addEventListener('click', go);
    var no = mk('button', 'hb-tip-no', 'Not now');
    no.type = 'button';
    no.addEventListener('click', onDismiss || function () { tipDone(which); });
    acts.appendChild(yes);
    acts.appendChild(no);
    card.appendChild(ico);
    card.appendChild(text);
    card.appendChild(acts);
    first.parentNode.insertBefore(card, first);
    return true;
  }
  function maybeSuggest() {
    if (!NATIVE || !laneBase) return;
    var st = tipState(), today = localDay();
    if (st.last !== today) { st.n += 1; st.last = today; }
    if (!tipSave(st)) return;                      // cannot remember the answer: do not ask every time
    if (st.n < 2 || location.hash || /[?&]utm_/.test(location.search) || document.querySelector('.hb-tip')) return;
    if (!st.done && !loadPrefs() && choosable().length >= 2 && (!st.secOn || st.secOn === today)) {
      if (tipCard('sections', SLIDERS_SVG, 'Make it yours', 'Choose which sections you see.', 'Choose', function () { openPrefs(null); })) { st.secOn = today; tipSave(st); }
      return;
    }
  }

  // ---- Install nudge for browser visitors (never shown inside the app itself) ----
  // Phones get "Get the free app", desktop "Get the app on your phone"; both go through the smart link /app, which sends a
  // phone to its own store and shows a desktop a QR code. Shown from the first visit (but not to someone who arrived at
  // a specific story); "Not now" snoozes it for 14 days, "Get it" for 30.
  function mobileOS() {
    var ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return null;
  }
  // Own key, deliberately separate from TIP_KEY/hb-tip-v1: sharing one "done" flag across two different
  // tips would mean dismissing one silently dismisses the other for good, which is wrong for either of them.
  var INSTALL_KEY = 'hb-install-v2';
  function installUntil() {
    try { return +JSON.parse(localStorage.getItem(INSTALL_KEY) || 'null').until || 0; } catch (e) { return 0; }
  }
  function installSnooze(days) {
    var el = document.querySelector('.hb-tip[data-tip="install"]') || document.querySelector('.hb-getapp');
    if (el) el.remove();
    try { localStorage.setItem(INSTALL_KEY, JSON.stringify({ until: Date.now() + days * 86400000 })); return true; } catch (e) { return false; }
  }
  // Phones on the website get a slim "Get the app" bar above the tab bar, on Today (cards or list) and Voices; before,
  // the nudge was a card in the list, which sat hidden under the cards (the default view), so phone visitors never saw
  // it (owner, 2026-11-19). Real Safari on iPhone shows Apple's own App Store banner instead (the apple-itunes-app meta
  // tag in the page head), so it is skipped there. Desktop keeps the card in the list ("Show QR code").
  function iosSafari() {
    var ua = navigator.userAgent || '';
    return mobileOS() === 'ios' && /Version\/[\d.]+.*Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
  }
  // A plain count (no identifier is sent): the once-a-day check below happens on the device.
  // Also carries the visit's source (see GROWTH_SRC) so each count can be split by where readers came from.
  function track(event, extra) {
    if (/^(localhost|127\.)/.test(location.hostname)) return;     // not from test servers
    var body = { event: event, src: GROWTH_SRC.src };
    if (extra) for (var k in extra) body[k] = extra[k];
    try { fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(function () {}); }
    catch (e) { /* not counted */ }
  }
  // One count a day per browser, by kind (web_open_ios / _android / _desktop), so web and app use can be compared.
  function countWebVisit() {
    if (NATIVE) return;
    try {
      var day = localDay();
      if (localStorage.getItem('hb-web-day') === day) return;
      localStorage.setItem('hb-web-day', day);
    } catch (e) { return; }
    track('web_open_' + (mobileOS() || 'desktop'), { new: GROWTH_SRC.isNew ? 1 : 0 });
  }
  function maybeSuggestInstall() {
    if (NATIVE) return;
    try { localStorage.setItem(INSTALL_KEY + '-probe', '1'); localStorage.removeItem(INSTALL_KEY + '-probe'); }
    catch (e) { return; }  // can't remember a "Not now" (e.g. Safari private mode): don't nag every visit
    if (Date.now() < installUntil() || location.hash) return;
    var os = mobileOS();
    if (os) { getAppBar(os); return; }
    if (!laneBase || document.querySelector('.hb-tip')) return;
    track('install_nudge_shown', { place: 'getapp-card' });
    tipCard('install', DOWNLOAD_SVG, 'Get the app on your phone',
      'Scan a QR code for iPhone or Android: offline reading, audio and a morning reminder.', 'Show QR code',
      function () { installSnooze(30); location.href = appLink('getapp-card'); },
      function () { installSnooze(14); });
  }
  function getAppBar(os) {
    if (document.querySelector('.hb-getapp') || iosSafari() || (!laneBase && screenName() !== 'Voices')) return;
    setTimeout(function () {
      if (document.querySelector('.hb-getapp') || document.querySelector('.rd-sheet-bg') || Date.now() < installUntil()) return;
      var bar = mk('aside', 'hb-getapp');
      bar.setAttribute('aria-label', 'Get the app');
      var ic = mk('img', 'hb-getapp-ic');
      ic.src = '/brand/icon-192.png';
      ic.alt = '';
      ic.width = ic.height = 40;
      var tx = mk('div', 'hb-getapp-tx');
      tx.appendChild(mk('strong', '', 'The Hour Brief app'));
      tx.appendChild(mk('span', '', 'Free · offline, audio, a morning nudge'));
      var go = mk('a', 'hb-getapp-go', 'Get');
      go.href = appLink('getapp-bar');
      go.addEventListener('click', function () { track('install_nudge_tap'); installSnooze(30); });
      var x = mk('button', 'hb-getapp-x');
      x.type = 'button';
      x.setAttribute('aria-label', 'Not now');
      x.innerHTML = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      x.addEventListener('click', function () { installSnooze(14); });
      bar.appendChild(ic);
      bar.appendChild(tx);
      bar.appendChild(go);
      bar.appendChild(x);
      document.body.appendChild(bar);
      track('install_nudge_shown');
    }, 2500);
  }

  // ---- Tools row under the chips: hosts the quiz chip (and, in Listen, the listen card follows it) ----
  function readerTools() {
    var nav = document.querySelector('.nav');
    if (!nav) return;
    var host = document.querySelector('.reader-tools');
    if (!host) {
      host = mk('div', 'reader-tools');
      nav.insertAdjacentElement('afterend', host);
    }
    host.hidden = !reader();
    var chip = document.querySelector('.quiz-chip');
    if (chip) {
      if (reader() && chip.parentNode !== host) host.insertBefore(chip, host.firstChild);
      else if (!reader() && chip.parentNode === host) nav.insertAdjacentElement('afterend', chip);
    }
  }

  // ---- App chrome: app bar (logo, wordmark, screen name; text size, saved, menu), tab bar, section chips ----
  var ICON = {
    aa: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8V6h9v2"/><path d="M7.5 6v12"/><path d="M5.5 18h4"/><path d="M13.5 12v-1.5H21V12"/><path d="M17.25 10.5V18"/><path d="M15.5 18h3.5"/></svg>',
    back: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    bell: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    today: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5h12.5v13H6.5a2.5 2.5 0 0 1-2.5-2.5V5.5z"/><path d="M16.5 9H20v7a2.5 2.5 0 0 1-2.5 2.5"/><path d="M7.5 9h6M7.5 12h6M7.5 15h3.5"/></svg>',
    audio: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15v-3a8 8 0 0 1 16 0v3"/><path d="M4 15h3v5H5a1 1 0 0 1-1-1v-4z"/><path d="M20 15h-3v5h2a1 1 0 0 0 1-1v-4z"/></svg>',
    quiz: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/></svg>',
    archive: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5.8c2.4-1 5.6-.8 9 .9 3.4-1.7 6.6-1.9 9-.9V19c-2.4-1-5.6-.8-9 .9-3.4-1.7-6.6-1.9-9-.9V5.8z"/><path d="M12 6.7v13.2"/></svg>',
    leaders: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 4.5h10a2 2 0 0 1 2 2v5.5a2 2 0 0 1-2 2H9l-3.5 3v-3h-1a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2z"/><path d="M16.5 8.5h3a2 2 0 0 1 2 2V16a2 2 0 0 1-2 2h-1v2.5L15 18h-3.5a2 2 0 0 1-1.9-1.4"/></svg>',
  };
  var LOGO_SRC = '/brand/logo-128.png';

  // "Edition 039 · Thu, 24 Sep" from the masthead, for the Before-the-news card
  function editionText() {
    var ed = document.querySelector('.edition');
    if (!ed) return '';
    var parts = ed.innerHTML.split(/<br\s*\/?>/i).map(function (x) { return x.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }).filter(Boolean);
    if (parts.length > 1) parts[1] = parts[1].replace(/\s+\d{4}$/, '');
    return parts.join(' · ');
  }
  function pauseCard() {
    var inner = document.querySelector('.pause-inner');
    if (!inner) return;
    var head = inner.querySelector('.pause-head');
    if (!head) {
      var label = inner.querySelector('.pause-label');
      if (!label) return;
      head = mk('div', 'pause-head');
      inner.insertBefore(head, inner.firstChild);
      head.appendChild(label);
      head.appendChild(mk('span', 'pause-edition', editionText()));
    }
    head.querySelector('.pause-edition').hidden = !reader();     // the desktop site keeps its own masthead line
  }

  function appBar() {
    var inner = document.querySelector('.masthead-inner');
    if (!inner) return;
    var bar = inner.querySelector('.ab-actions');
    if (!bar) {
      var h1 = inner.querySelector('.wordmark'), brand = null;
      if (h1) {
        brand = h1.parentElement;
        if (brand === inner) {                            // the info pages put the wordmark straight in the row
          brand = mk('div');
          inner.insertBefore(brand, h1);
          brand.appendChild(h1);
        }
        brand.classList.add('ab-brand');
      }
      // Sub-pages (Past editions, a past edition, About…) show a back arrow where the logo sits; the rest of the header
      // is the same on every screen.
      var bk = backTarget(), logo;
      if (bk) {
        logo = mk('button', 'ab-btn ab-back');
        logo.type = 'button';
        logo.setAttribute('aria-label', bk.label);
        logo.innerHTML = ICON.back;
        logo.addEventListener('click', bk.go);
      } else {
        logo = mk('img', 'ab-logo');
        logo.src = LOGO_SRC;
        logo.alt = '';
        logo.width = logo.height = 34;
      }
      inner.insertBefore(logo, inner.firstChild);

      bar = mk('div', 'ab-actions');
      var sv = mk('button', 'ab-btn reader-saved');
      sv.type = 'button';
      sv.innerHTML = STAR_SVG + '<span class="rd-count"></span>';
      sv.addEventListener('click', function () { openSaved(sv); });
      var mn = mk('button', 'ab-btn ab-menu');
      mn.type = 'button';
      mn.setAttribute('aria-label', 'Menu: past editions, sections, text size, reminder, share');
      mn.innerHTML = SLIDERS_SVG;
      mn.addEventListener('click', function () { openMenu(mn); });
      // Text size lives in the Menu only (owner's call, 2026-11-18): the top bar keeps Saved and Menu.
      bar.appendChild(sv);
      bar.appendChild(mn);
      inner.appendChild(bar);
      refreshSaved();
    }
    // The tagline, as its own legible line on an edition — under the header now, not inside it, so the header itself is
    // exactly the same on every screen (owner, 2026-11-19); Past editions doesn't repeat it.
    var band = inner.parentElement;
    if (band && isFeed() && !document.querySelector('.masthead-tagline')) {
      var tg = document.querySelector('.tagline');
      if (tg) band.insertAdjacentElement('afterend', mk('p', 'masthead-tagline', tg.textContent.trim()));
    }
    var on = reader();
    [inner.querySelector('.ab-logo'), inner.querySelector('.ab-back'), bar].forEach(function (el) { if (el) el.hidden = !on; });
    var mtg = document.querySelector('.masthead-tagline');
    if (mtg) mtg.hidden = !on;
    if (band && !band._hbWatched) { band._hbWatched = true; watchHeadH(band); }
  }
  // The header stays at the top of every screen (sticky, like Audio's and Challenge's); the section chips stick just
  // under it, and jumps to a section or story clear it, via --hb-head-h.
  var headH = 0;
  function watchHeadH(band) {
    function set() {
      var h = reader() ? band.offsetHeight : 0;
      if (h === headH) return;
      headH = h;
      document.documentElement.style.setProperty('--hb-head-h', h + 'px');
    }
    set();
    if (window.ResizeObserver) new ResizeObserver(set).observe(band);
    window.addEventListener('load', set);
  }
  // Where a sub-page's back arrow goes: back where the reader came from when that was this site, else a sensible home.
  function pastEdition() { return /^\/archive\/\d{4}-\d{2}-\d{2}(\.html)?$/.test(location.pathname); }
  function backTarget() {
    var p = location.pathname, home = pastEdition() ? '/archive/' : '/';
    if (!pastEdition() && screenName() !== 'Archive' && !INFO_TITLES[p]) return null;
    return { label: pastEdition() ? 'Back to past editions' : 'Back', go: function () {
      var ref = '';
      try { ref = new URL(document.referrer).origin; } catch (e) { /* none */ }
      if (ref === location.origin && history.length > 1) { showLeaving(null); setTimeout(function () { history.back(); }, LEAVE_MS); }
      else leaveTo(home);
    } };
  }

  function shareEdition() {
    var btn = document.getElementById('cap-share');       // the apps' own share button (app-only code) does the native share
    if (btn) { btn.click(); return; }
    var d = editionDate();
    var payload = { title: document.title, text: document.title, url: d ? location.origin + '/e/' + d : location.href };
    var p;
    if (navigator.share) p = navigator.share(payload);
    else if (navigator.clipboard) p = navigator.clipboard.writeText(payload.url).then(function () { toast('Link copied'); });
    if (p && p.catch) p.catch(function () {});
  }
  function openMenu(returnTo) {
    openSheet('Menu', function (body) {
      var ul = mk('ul', 'rd-menu');
      function item(act, icon, title, sub, fn) {
        var li = mk('li');
        var b = mk('button', 'rd-item');
        b.type = 'button';
        b.setAttribute('data-act', act);
        b.innerHTML = icon;
        var t = mk('span', '', title);
        if (sub) t.appendChild(mk('small', '', sub));
        b.appendChild(t);
        b.addEventListener('click', fn);
        li.appendChild(b);
        ul.appendChild(li);
      }
      // The same items, in the same order, on every screen (owner, 2026-11-19: on Past editions the menu used to lose
      // half its items). "Swipe cards" went (the List | Cards switch does that) and so did "Get it by email" (no
      // daily email is actually sent).
      item('archive', ICON.archive, 'Past editions', 'Every edition, newest first', function () {
        closeSheet();
        if (screenName() === 'Archive') window.scrollTo({ top: 0, behavior: 'smooth' }); else leaveTo('/archive/');
      });
      if (laneList().length) item('sections', SLIDERS_SVG, 'Sections', 'Show or hide sections', function () { openPrefs(returnTo); });
      item('textsize', ICON.aa, 'Text size', SIZE_NAMES[getSize()], function () { openTextSize(returnTo); });
      var bell = document.getElementById('cap-remind');
      if (bell) item('reminder', ICON.bell, 'Daily reminder', bell.getAttribute('data-summary') || 'A morning nudge on this device', function () { closeSheet(); bell.click(); });
      item('share', SHARE_SVG, 'Share', isFeed() ? 'Send this edition to a friend' : 'Send this page to a friend', function () { closeSheet(); shareEdition(); });
      // The daily channels, website and app alike. Opened as an ordinary outside link: a new tab on the website, the in-app
      // browser in the app (capacitor-bridge.js), whose WhatsApp / Telegram page has the Follow / Join button.
      CHANNELS.forEach(function (ch) {
        item(ch[0], ch[0] === 'telegram' ? TG_SVG : WA_SVG, 'Follow on ' + ch[1], 'The brief every morning, free', function () {
          closeSheet();
          track('channel_out', { place: ch[0] });
          var a = mk('a');
          a.href = ch[2]; a.target = '_blank'; a.rel = 'noopener';
          document.body.appendChild(a); a.click(); a.remove();
        });
      });
      body.appendChild(ul);
      var foot = mk('div', 'rd-menu-foot');
      [['Contact us', '/contact.html'], ['About', '/about.html'], ['Privacy', '/privacy.html']].forEach(function (l, i) {
        if (i) foot.appendChild(document.createTextNode(' · '));
        var a = mk('a', '', l[0]);
        a.href = l[1];
        foot.appendChild(a);
      });
      body.appendChild(foot);
    }, returnTo);
  }

  // Bottom tabs: Today (the feed), Audio (the Listen hub), Voices (leaders.html: weekly roundups + Principles essays),
  // Challenge (the quiz). The tab key stays 'leaders' (page URL and tests); only the label is Voices.
  // Archive (past editions) is the first item in the top-right Menu instead — five tabs read as cramped, and the app
  // bar itself has no room for a fourth icon next to the wordmark.
  var TABS = [['today', 'Today'], ['audio', 'Audio'], ['leaders', 'Voices'], ['quiz', 'Challenge']];
  function isFeed() { return !!document.querySelector('section.lane'); }          // an edition page (today's or an archived one)
  var INFO_TITLES = { '/about.html': 'About', '/privacy.html': 'Privacy', '/contact.html': 'Contact us' };
  function screenName() {
    var p = location.pathname;
    if (INFO_TITLES[p]) return INFO_TITLES[p];
    if (/^\/archive\/(index\.html)?$/.test(p)) return 'Archive';
    if (/^\/leaders\.html$/.test(p)) return 'Voices';
    return 'Feed';
  }
  // On pages that are not editions the tabs are plain links back to the right place.
  var TAB_HREF = { today: '/', audio: '/?audio=1', quiz: '/?quiz=1', leaders: '/leaders.html' };
  function tabGo(name) {
    var L = window.HBListen;
    // Tapping the tab you are already on reopens/stays on it — it does not toggle closed (tried that after removing
    // the X close button; tapping Challenge twice closing back to the list read as a bug, not a feature). Today
    // remains the one way back to the list, same as any other tab bar.
    if (name === 'audio') { closeQuizPage(); if (L && L.openHub) L.openHub(); else toast('Audio is loading…'); return; }
    if (L && L.closeHub) L.closeHub();
    if (name === 'today') {
      closeQuizPage();
      if (deckOpen()) window.HBCards.goTo(0, true);
      else if (cardsOk() && getView() === 'cards') openCards();                    // back to the cards after a trip to the quiz
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    else if (name === 'quiz') {
      if (deckOpen()) window.HBCards.close({ keep: true });
      openQuizPage();
    }
    setTimeout(syncTabs, 60);
  }

  // The dedicated quiz page: a real fixed overlay, built the same way the Audio hub is (same .hub-top/.hub-scroll
  // markup and classes, so it reads as the same kind of "screen" the reader already knows from Audio, not a filtered
  // view of the list with things hidden — an earlier version did exactly that (just toggling display:none on the
  // list's other sections) and it never stopped feeling like "the list page, scrolled", which was the whole
  // complaint. #quiz is moved into it (a real DOM reparent — quiz.js's own state, event listeners, everything, just
  // comes along) and moved back out to its original spot on close, marked by quizAnchor.
  var quizOv = null, quizScroll = null, quizAnchor = null, quizOvShown = false, quizPrevFocus = null;
  function buildQuizPage() {
    if (quizOv) return;
    var q = document.getElementById('quiz');
    if (!q) return;
    quizAnchor = document.createComment('quiz-anchor');
    q.parentNode.insertBefore(quizAnchor, q);
    quizOv = mk('section', 'hb-hub hb-quizpage');
    quizOv.hidden = true;
    quizOv.setAttribute('role', 'region');
    quizOv.setAttribute('aria-label', 'Challenge');
    var top = mk('header', 'hub-top');
    var logo = mk('img', 'ab-logo');
    logo.src = '/brand/logo-128.png';
    logo.alt = '';
    logo.width = logo.height = 34;
    var brand = mk('div', 'ab-brand');
    var word = mk('div', 'wordmark');
    word.innerHTML = 'The Hour <span>Brief</span>';
    brand.appendChild(word);
    // Same header everywhere — Today, Audio, Challenge, Archive — rather than each screen showing its own
    // stripped-down version (this one used to just close itself; Audio's own close went the same way).
    var acts = mk('div', 'ab-actions');
    var sv = mk('button', 'ab-btn reader-saved');
    sv.type = 'button';
    sv.innerHTML = STAR_SVG + '<span class="rd-count"></span>';
    sv.addEventListener('click', function () { openSaved(sv); });
    var mn = mk('button', 'ab-btn ab-menu');
    mn.type = 'button';
    mn.setAttribute('aria-label', 'Menu: past editions, sections, text size, reminder, share');
    mn.innerHTML = SLIDERS_SVG;
    mn.addEventListener('click', function () { openMenu(mn); });
    acts.appendChild(sv);
    acts.appendChild(mn);
    top.appendChild(logo);
    top.appendChild(brand);
    top.appendChild(acts);
    quizScroll = mk('div', 'hub-scroll');
    quizOv.appendChild(top);
    quizOv.appendChild(quizScroll);
    document.body.appendChild(quizOv);
    // Only now is the saved button actually in the document — calling this earlier, while top/acts was still a
    // detached subtree, left its just-built .rd-count permanently blank (querySelectorAll('.reader-saved') in
    // refreshSaved() searches the live document, which didn't contain it yet).
    refreshSaved();
  }
  function openQuizPage() {
    buildQuizPage();
    if (!quizOv || quizOvShown) return;
    quizPrevFocus = document.activeElement;
    quizScroll.appendChild(document.getElementById('quiz'));
    quizOv.hidden = false;
    quizOv.classList.add('hb-fade-in');
    requestAnimationFrame(function () { requestAnimationFrame(function () { quizOv.classList.remove('hb-fade-in'); }); });
    quizOvShown = true;
    document.documentElement.classList.add('hb-quiz-page');
    quizScroll.scrollTop = 0;
    document.dispatchEvent(new CustomEvent('hb:hub'));
  }
  function closeQuizPage() {
    if (!quizOv || !quizOvShown) return;
    if (quizAnchor && quizAnchor.parentNode) quizAnchor.parentNode.insertBefore(document.getElementById('quiz'), quizAnchor);
    quizOv.hidden = true;
    quizOvShown = false;
    document.documentElement.classList.remove('hb-quiz-page');
    document.dispatchEvent(new CustomEvent('hb:hub'));
    if (quizPrevFocus && quizPrevFocus.focus && document.contains(quizPrevFocus)) { try { quizPrevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    quizPrevFocus = null;
  }
  window.HBQuizPage = { close: closeQuizPage, isOpen: function () { return quizOvShown; } };
  // listen.js builds the same header row (see buildHub() there) — it is a separate file/closure, so the actions it
  // needs are handed across here rather than duplicated.
  window.HBChrome = { textSize: openTextSize, saved: openSaved, menu: openMenu, refreshSaved: refreshSaved, back: backTarget, icons: { aa: ICON.aa, star: STAR_SVG, sliders: SLIDERS_SVG, back: ICON.back } };
  // The List | Cards switch: a floating pill, appended straight to body (see below) — centred just above the tab
  // bar in List, top-right of the deck in Cards. An earlier version nested it inside .tab-bar itself instead,
  // specifically to remove a recurring real-device bug (list content bleeding through a seam between two
  // independently-positioned fixed elements that had to agree on a pixel-perfect height). Floating is safe from
  // that same bug because it anchors to --hb-tab-h, which watchTabBarH() below keeps continuously correct via a
  // ResizeObserver, not a one-off measurement — so it can't drift stale the way the old --hb-switch-h did.
  function tabBar() {
    var bar = document.querySelector('.tab-bar:not([data-early])');
    if (!bar) {
      bar = mk('nav', 'tab-bar');
      bar.setAttribute('aria-label', 'App sections');
      var feed = isFeed();
      var sw = mk('div', 'tab-switch');
      sw.hidden = true;                      // cardsOk() decides, in syncTabs() below
      sw.setAttribute('role', 'group');
      sw.setAttribute('aria-label', 'Reading view');
      var list = mk('button', '', 'List'), cardsBtn = mk('button', '', 'Cards');
      list.type = cardsBtn.type = 'button';
      list.addEventListener('click', function () { if (deckOpen()) window.HBCards.close(); });
      cardsBtn.addEventListener('click', function () { openCards(); });
      sw.appendChild(list);
      sw.appendChild(cardsBtn);
      // A floating pill, not a row inside the bar: above the tab bar in List, top-right of the deck in Cards (see
      // html.hb-deck-open .tab-switch in app.css). Appended to body, not .tab-bar, so it is never affected by the
      // desktop/iPad tab bar's own centring transform.
      document.body.appendChild(sw);
      var row = mk('div', 'tab-row');
      TABS.forEach(function (t) {
        var link = t[0] === 'leaders' || !feed || pastEdition();     // a past edition's Today/Audio/Challenge are today's
        var el = link ? mk('a', 'tab') : mk('button', 'tab');
        el.setAttribute('data-tab', t[0]);
        el.innerHTML = '<span class="tab-ic">' + ICON[t[0]] + '</span><span class="tab-lb">' + t[1] + '</span>';
        if (link) { el.href = TAB_HREF[t[0]]; el.addEventListener('click', showLeaving); }
        else { el.type = 'button'; el.addEventListener('click', function () { tabGo(t[0]); }); }
        row.appendChild(el);
      });
      bar.appendChild(row);
      document.body.appendChild(bar);
      var early = document.querySelector('.tab-bar[data-early]');   // the head's first-frame copy (index.html, leaders.html)
      if (early) early.remove();
      window.addEventListener('scroll', syncSoon, { passive: true });
      document.addEventListener('hb:hub', syncTabs);
      document.addEventListener('hb:deck', syncTabs);
      watchTabBarH(bar);
    }
    bar.hidden = !reader();
    syncTabs();
  }
  // A tab that is a real page load (Voices, or Today/Audio/Challenge from Voices): cover the screen at once with the
  // hourglass loader (html.hb-leaving in app.css), and tell the next page to carry it on (hb-loader-at), so the change
  // reads as one deliberate moment instead of a freeze, a blank and a pop (owner, 2026-11-18). The arriving page starts
  // its loader at the same point of the turn (its --hb-spin-delay counts from the tap) and keeps it up until its screen
  // is really ready (bootDone), so it never blinks: loader, then the page (owner, 2026-11-19).
  // The page only leaves once the cover is fully in (LEAVE_MS): the website waits here, the apps in capacitor-bridge go().
  var leavingT = 0, LEAVE_MS = 140;
  function showLeaving(e) {
    if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0)) return;   // opening in a new tab
    var h = document.documentElement, tab = e && e.currentTarget;
    if (tab && tab.parentNode) Array.prototype.forEach.call(tab.parentNode.querySelectorAll('.tab'), function (t) { if (t === tab) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
    if (!h.classList.contains('hb-leaving')) {
      h.style.setProperty('--hb-spin-delay', '0ms');
      h.classList.add('hb-leaving');
      try { sessionStorage.setItem('hb-loader-at', String(Date.now())); } catch (err) { /* the next page just fades in */ }
    }
    if (e && !NATIVE && tab && tab.href && !e.defaultPrevented) {
      e.preventDefault();
      setTimeout(function () { location.href = tab.href; }, LEAVE_MS);
    }
    clearTimeout(leavingT);
    leavingT = setTimeout(function () { h.classList.remove('hb-leaving'); }, 10000);   // never stuck if the trip fails
  }
  function leaveTo(href) {                            // the same, for a page change that isn't a tab (Menu, back arrow)
    showLeaving(null);
    setTimeout(function () { location.href = href; }, LEAVE_MS);
  }
  window.addEventListener('pageshow', function (e) { if (e.persisted) document.documentElement.classList.remove('hb-leaving'); });
  // The pages also cross-fade on their own (@view-transition in app.css). With the loader up on both sides that blended
  // a frozen picture of the old hourglass with the turning new one, a ghosted double logo: skip it for these trips.
  window.addEventListener('pageswap', function (e) {
    if (!e.viewTransition || !document.documentElement.classList.contains('hb-leaving')) return;
    try { e.viewTransition.skipTransition(); } catch (err) { /* already finished */ }
  });
  // --hb-tab-h, kept exactly in sync with .tab-bar's own real rendered height, continuously, for as long as the
  // page lives — not measured once and hoped to stay right. Fires immediately on observe() with the current size,
  // then again on every future change (the tab row's label wrapping, a safe-area change, a late web font).
  function watchTabBarH(bar) {
    // The distance from the bar's own top edge to the bottom of the viewport, not just the bar's own height — on
    // the desktop layout .tab-bar floats with its own bottom:16px gap below it, which also needs reserving; on
    // phones it's flush (bottom:0), so this is simply the bar's height there, same result either way.
    var set = function () { var h = window.innerHeight - bar.getBoundingClientRect().top; if (h > 0) document.documentElement.style.setProperty('--hb-tab-h', Math.ceil(h) + 'px'); };
    // border-box, not the default content-box: the bar's bottom padding is the phone's safe area, which iOS can report
    // a moment after launch. That grew the bar by ~34px without changing its content box, so nothing re-measured and
    // the cards' pager sat behind the tab bar on a cold start (owner, 2026-11-18).
    if (window.ResizeObserver) { try { new ResizeObserver(set).observe(bar, { box: 'border-box' }); } catch (e) { new ResizeObserver(set).observe(bar); } }
    set();
    window.addEventListener('resize', set);   // viewport height can change (a mobile URL bar collapsing) without the bar's own size changing
    window.addEventListener('load', set);
    window.addEventListener('pageshow', set);
    window.addEventListener('orientationchange', function () { setTimeout(set, 300); });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', set);
    [300, 1000, 2500].forEach(function (ms) { setTimeout(set, ms); });   // belt and braces for a late safe-area inset
  }
  function syncTabs() {
    var bar = document.querySelector('.tab-bar');
    if (!bar || bar.hidden) return;
    if (!isFeed()) {                                           // About, Privacy, Contact, the archive list (no tab lit)
      var here = screenName();
      bar.querySelectorAll('.tab').forEach(function (t) {
        if (t.getAttribute('data-tab') === 'leaders' && here === 'Voices') t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
        if (t.getAttribute('data-tab') === 'quiz') t.hidden = false;
      });
      return;
    }
    var q = document.getElementById('quiz'), qOk = !!(q && !q.hidden && !q.hasAttribute('data-pref-off'));
    var L = window.HBListen, hub = !!(L && L.hubOpen && L.hubOpen());
    var quizPage = !!(window.HBQuizPage && window.HBQuizPage.isOpen && window.HBQuizPage.isOpen());
    var r = qOk && !quizPage ? q.getBoundingClientRect() : null;    // scrolled to the inline quiz chip's target in the normal list, not the dedicated page
    var cur = bootScreen() || (hub ? 'audio' : quizPage ? 'quiz' : deckOpen() ? 'today' : (r && r.top < window.innerHeight * 0.5 && r.bottom > headH + 90) ? 'quiz' : 'today');
    var past = pastEdition();                                  // a past edition is a page of Past editions: no tab is lit
    bar.querySelectorAll('.tab').forEach(function (t) {
      var n = t.getAttribute('data-tab');
      if (n === cur && !past) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
      if (n === 'quiz') t.hidden = !qOk && !past;
    });
    var sw = document.querySelector('.tab-switch');   // floating now, no longer a child of .tab-bar — see tabBar()
    if (sw) {
      sw.hidden = !cardsOk() || cur !== 'today';   // not a reading-mode decision while on Audio or Challenge
      if (!sw.hidden) {
        var on = deckOpen(), btns = sw.querySelectorAll('button');
        btns[0].setAttribute('aria-pressed', String(!on));
        btns[1].setAttribute('aria-pressed', String(on));
      }
    }
  }
  // Section chips: an "All" chip, and the one for the section in view is filled (replaces the page's own three-section spy)
  function syncChips() {
    var nav = document.querySelector('.nav');
    if (!nav || !reader()) return;
    var cur = 'all';
    document.querySelectorAll('section.lane[id]').forEach(function (l) {
      if (l.style.display !== 'none' && !l.hidden && l.getBoundingClientRect().top <= headH + 110) cur = l.id;
    });
    var on = null;
    nav.querySelectorAll('a').forEach(function (a) {
      var h = a.getAttribute('href') || '';
      var is = h.charAt(0) === '#' && h.slice(1) === cur;
      a.classList.toggle('is-current', is);
      if (is) on = a;
    });
    if (on && on !== nav._cur) {                     // keep the current chip in view in the scrolling row
      nav._cur = on;
      var l = on.offsetLeft - 16, r = on.offsetLeft + on.offsetWidth - nav.clientWidth + 16;
      if (l < nav.scrollLeft) nav.scrollTo({ left: Math.max(0, l), behavior: 'smooth' });
      else if (r > nav.scrollLeft) nav.scrollTo({ left: r, behavior: 'smooth' });
    }
  }
  var syncQueued = false;
  function syncSoon() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(function () { syncQueued = false; syncChips(); syncTabs(); });
  }
  function navChips() {
    var nav = document.querySelector('.nav');
    if (!nav) return;
    var all = nav.querySelector('.nav-all');
    if (!all) {
      all = mk('a', 'nav-all', 'All');
      all.href = '#all';
      all.addEventListener('click', function (e) {
        e.preventDefault();
        var first = document.querySelector('section.lane[id]:not([data-pref-off])');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(syncSoon, 80);
      });
      nav.insertBefore(all, nav.firstChild);
    }
    all.hidden = !reader();
    window.addEventListener('scroll', syncSoon, { passive: true });
    syncChips();
  }

  // "6 stories" at the right of each section badge
  function laneCounts() {
    document.querySelectorAll('section.lane').forEach(function (lane) {
      var head = lane.querySelector('.lane-head'), n = lane.querySelectorAll('.item[data-story-id]').length;
      if (!head || !n) return;
      var c = head.querySelector('.lane-count');
      if (!c) { c = mk('span', 'lane-count', n + (n === 1 ? ' story' : ' stories')); head.appendChild(c); }
      c.hidden = !reader();
    });
  }

  // ---- Open a shared story link: expand it, scroll to it, flash it ----
  function openFromHash() {
    var id = decodeURIComponent((location.hash || '').slice(1));
    if (!id || !reader()) return;
    var it = document.getElementById(id);
    if (!it || !it.classList.contains('item')) return;
    var lane = it.closest('section.lane');      // someone sent this story: show it even if its section is switched off here
    if (lane && lane.hasAttribute('data-pref-off')) { lane.style.display = ''; lane.removeAttribute('data-pref-off'); }
    it.scrollIntoView({ block: 'start' });
    it.classList.add('deeplinked');
  }

  function apply() {
    if (reader() && !mq.matches) ensureReaderCss();
    applyTextSize();
    applyPrefs();
    collapsibleStories();
    laneToggles();
    laneDigests();
    readTimes();
    aboutToggle();
    storyButtons();
    siteLinks();
    readerTools();
    pauseCard();
    appBar();
    navChips();
    laneCounts();
    tabBar();
    progressUi();
    measureClamps();
  }

  // ---- Contact / About / Privacy: one row at the top of the footer (above the pills only if a page has no footer) ----
  function siteLinks() {
    var nav = document.querySelector('.nav');
    var footer = document.querySelector('footer.colophon');
    if (!nav && !footer) return;
    var row = document.querySelector('.site-links');
    if (!row) {
      row = mk('div', 'site-links');
      [['Contact us', '/contact.html'], ['About', '/about.html'], ['Privacy', '/privacy.html']].forEach(function (l, i) {
        if (i) row.appendChild(document.createTextNode(' · '));
        var a = mk('a', i ? '' : 'site-contact', l[0]);
        a.href = l[1];
        row.appendChild(a);
      });
      if (footer) { footer.insertBefore(row, footer.firstChild); row.classList.add('in-footer'); }
      else nav.insertAdjacentElement('beforebegin', row);
    }
    row.hidden = !reader();
  }

  // ---- Listen mode: the player lives in listen.js, fetched only where speech is available ----
  var listenLoaded = false;
  function loadListen() {
    if (listenLoaded || !reader()) return;     // listen.js decides what can play: a recording, or the device voice
    listenLoaded = true;
    var s = document.createElement('script');
    s.src = '/listen.js';
    s.defer = true;
    document.head.appendChild(s);
  }

  function openAudioFromUrl() {                       // /?audio=1 from another page's Audio tab
    if (!reader() || !/[?&]audio=1(&|$)/.test(location.search)) return false;
    var tries = 0;
    (function wait() {
      if (window.HBListen && window.HBListen.openHub) { window.HBListen.openHub(); bootDone(); return; }
      if (++tries < 40) setTimeout(wait, 100);
      else bootDone();
    })();
    return true;
  }
  // index.html's head hides the page (html.hb-boot) when it is arriving on Cards, Audio or Challenge; this shows it once
  // that screen is up, so the reader sees one change of screen instead of the list, then cards, then the screen asked for.
  // It waits for the screen to settle first (whenSettled): lifting the loader the moment the screen's markup existed
  // showed it half-drawn, then the fonts and pictures popping in, which read as a flicker (owner, 2026-11-19).
  // Voices (leaders.html) calls it too, once its roundups are drawn (window.HBReveal).
  var revealing = false;
  function bootDone() {
    var h = document.documentElement;
    if (!h.classList.contains('hb-boot') || h.classList.contains('hb-reveal') || revealing) return;
    revealing = true;
    whenSettled(function () {
      h.classList.add('hb-reveal');                     // page shows; the loader completes and fades off it (app.css)
      setTimeout(function () { h.classList.remove('hb-boot', 'hb-reveal', 'hb-from-loader'); syncTabs(); }, 280);
      syncTabs();
    });
  }
  window.HBReveal = bootDone;
  // Ready = the web fonts are in and the pictures on screen are decoded (each wait capped), and after a tab trip the
  // loader has been up long enough to turn once (LOADER_MIN from the tap), so a quick trip doesn't flash it.
  var LOADER_MIN = 650, SETTLE_MAX = 2000;
  function whenSettled(done) {
    var at = +document.documentElement.getAttribute('data-hb-loader-at') || 0, fired = false;
    function finish() {
      if (fired) return;
      fired = true;
      setTimeout(done, at ? Math.max(0, LOADER_MIN - (Date.now() - at)) : 0);
    }
    var waits = [];
    if (document.fonts && document.fonts.ready) waits.push(document.fonts.ready);
    Array.prototype.forEach.call(document.images, function (im) {
      if (im.complete || im.loading === 'lazy') return;
      var r = im.getBoundingClientRect();
      if (!r.width || r.bottom < 0 || r.top > window.innerHeight) return;
      waits.push(new Promise(function (res) { im.addEventListener('load', res); im.addEventListener('error', res); }));
    });
    Promise.all(waits).then(finish, finish);
    setTimeout(finish, SETTLE_MAX);
  }
  function bootScreen() {                             // the tab to light while hidden, so the bar doesn't flick across
    var cl = document.documentElement.classList;
    if (!cl.contains('hb-boot') || cl.contains('hb-reveal')) return '';
    return /[?&]audio=1(&|$)/.test(location.search) ? 'audio' : /[?&]quiz=1(&|$)/.test(location.search) ? 'quiz' : '';
  }
  // /?quiz=1 from another page's Challenge tab (Archive, About, Privacy, Contact — all non-feed pages, where the tab
  // is a plain link instead of tabGo()). Used to be a plain #quiz anchor, which the browser's own hash-scroll just
  // landed on the inline quiz section in the list — not the dedicated Challenge page tapping the tab everywhere else
  // opens, so arriving this way looked like a completely different, broken screen. #quiz itself still means exactly
  // that elsewhere (shared story links, the quiz chip, archive edition links) — only this one tab link changed.
  function openQuizFromUrl() {
    if (!reader() || !/[?&]quiz=1(&|$)/.test(location.search)) return false;
    openQuizPage();
    bootDone();
    return true;
  }
  // Keep the address in step with the Audio and Challenge screens (both overlays on the feed), so a refresh, or a link
  // copied from the address bar, reopens the same screen instead of dropping back to Today. replaceState, so no extra
  // history entries. Started only after an incoming ?audio=1 / ?quiz=1 has been handled (see start()).
  function syncScreenUrl() {
    if (!reader() || !window.history || !history.replaceState) return;
    var cls = document.documentElement.classList;
    var want = cls.contains('hb-hub-open') ? 'audio' : cls.contains('hb-quiz-page') ? 'quiz' : '';
    var params = new URLSearchParams(location.search);
    var had = params.get('audio') === '1' ? 'audio' : params.get('quiz') === '1' ? 'quiz' : '';
    if (want === had) return;
    params.delete('audio'); params.delete('quiz');
    if (want) params.set(want, '1');
    var qs = params.toString();
    try { history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + location.hash); } catch (e) { /* ignore */ }
  }
  function start() {
    if (cardsOk() && getView() === 'cards' && deckTarget()) pendingOn();
    setTimeout(bootDone, 3000);                       // never leave the page hidden for long, whatever goes wrong below
    apply(); openFromHash(); loadListen();
    restoreView(function () {
      maybeSuggest();
      maybeSuggestInstall();
      // Cards is the default view, so the very first call above almost always finds the deck open and defers (see
      // tipCard()) — give it another look the moment the reader actually reaches List, in the same visit, rather
      // than only on a later day that happens to start there.
      document.addEventListener('hb:deck', function () { if (!deckOpen()) { maybeSuggest(); maybeSuggestInstall(); } });
      var audio = openAudioFromUrl(), quiz = openQuizFromUrl();
      if (!audio && !quiz) bootDone();                // Today: the cards (or the list) are already up
      if (window.MutationObserver) new MutationObserver(syncScreenUrl).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
  window.addEventListener('load', queueMeasure);
  window.addEventListener('resize', queueMeasure);
  mq.addEventListener('change', function () { apply(); loadListen(); });
})();
