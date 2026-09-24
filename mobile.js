/*
 * mobile.js — phone-only reading enhancements for The Hour Brief.
 *
 * Loaded on every edition page as <script defer src="/mobile.js">. Pure
 * progressive enhancement: with no JS the page still shows every story in full.
 * Everything here is gated on matchMedia('(max-width: 640px)') and is
 * independent of the page's own inline <script> (votes, comments, scrollspy).
 *
 *  - Stories keep their natural order (headline, summary, takeaway). On phones
 *    the summary is clamped to a few lines with a "Read more" toggle right under
 *    it — shown only when text is actually clipped.
 *  - Each section leads with a numbered highlights list (jump links) and its
 *    takeaway; the long digest sentence sits behind a toggle.
 *  - Every story has a Share button (headline + link to that story), and long
 *    pages get a reading-progress bar and a back-to-top button.
 *  - The evergreen About paragraph gets a matching "More" toggle, and a "Contact us · About · Privacy" row leads the footer.
 *  - Save-for-later bookmarks and a text-size control (both stored on this device only).
 *  - "Your sections": readers pick which sections show and in what order (sliders button; the apps
 *    offer it once on first launch). Stored on this device only.
 *  - "Listen to today's brief" (listen.js, loaded on demand where the device can speak).
 *
 * "Reader mode" = phone widths, or the native apps at any width (tablets). The desktop
 * website is left untouched.
 */
(function () {
  var mq = window.matchMedia('(max-width: 640px)');
  var Cap0 = window.Capacitor;
  var NATIVE = !!(Cap0 && typeof Cap0.isNativePlatform === 'function' && Cap0.isNativePlatform());
  function reader() { return mq.matches || NATIVE; }
  function ensureReaderCss() {
    if (document.querySelector('link[data-reader-css]')) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = '/reader.css';
    l.setAttribute('data-reader-css', '');
    document.head.appendChild(l);
    var a = document.createElement('link');      // the premium skin, after the shared components
    a.rel = 'stylesheet';
    a.href = '/app.css';
    a.setAttribute('data-reader-css', '');
    document.head.appendChild(a);
  }

  function collapsibleStories() {
    document.querySelectorAll('.item').forEach(function (item) {
      var inner = item.querySelector(':scope > div');
      if (!inner) return;

      if (!item.dataset.collapseReady) {
        var bodyParas = Array.prototype.filter.call(inner.children, function (el) {
          return el.tagName === 'P' && !el.classList.contains('takeaway');
        });
        if (!bodyParas.length) { item.dataset.collapseReady = 'none'; return; }

        // Wrap the summary paragraphs so the clamp and toggle target one unit.
        // Nothing is reordered, so desktop (which never loads mobile.css) is
        // untouched.
        var wrap = document.createElement('div');
        wrap.className = 'story-body';
        wrap.id = 'sb-' + (item.dataset.storyId || Math.random().toString(36).slice(2));
        inner.insertBefore(wrap, bodyParas[0]);
        bodyParas.forEach(function (p) { wrap.appendChild(p); });

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'story-more';
        btn.setAttribute('aria-controls', wrap.id);
        btn.textContent = 'Read more';
        btn.addEventListener('click', function () {
          var collapsed = item.classList.toggle('is-collapsed');
          btn.setAttribute('aria-expanded', String(!collapsed));
          btn.textContent = collapsed ? 'Read more' : 'Show less';
        });
        inner.insertBefore(btn, wrap.nextSibling);
        item.dataset.collapseReady = 'yes';
      }
      if (item.dataset.collapseReady !== 'yes') return;

      var toggle = item.querySelector(':scope > div > .story-more');
      if (mq.matches) {
        item.classList.add('is-collapsed');
        if (toggle) {
          toggle.hidden = false;
          toggle.setAttribute('aria-expanded', 'false');
          toggle.textContent = 'Read more';
        }
      } else {
        item.classList.remove('is-collapsed');
        if (toggle) toggle.hidden = true;
      }
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
      btn.hidden = !mq.matches;
      if (!mq.matches) head.classList.remove('is-expanded');
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
    btn.hidden = !mq.matches;
    if (!mq.matches) about.classList.remove('is-expanded');
  }

  // Show a toggle only where the clamp really hides something.
  function measureClamps() {
    if (!mq.matches) return;
    document.querySelectorAll('.item.is-collapsed').forEach(function (item) {
      var toggle = item.querySelector(':scope > div > .story-more');
      var paras = item.querySelectorAll('.story-body > p');
      if (!toggle || !paras.length) return;
      toggle.hidden = !(paras.length > 1 || paras[0].scrollHeight > paras[0].clientHeight + 1);
    });
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
        // Long run-on digest sentence (older/legacy lane titles): keep it, but behind a toggle.
        if (h2.textContent.length > 110) {
          head.classList.add('is-digest');
          var t = document.createElement('button');
          t.type = 'button';
          t.className = 'digest-toggle';
          t.textContent = 'Read the day’s digest \u2192';
          t.setAttribute('aria-expanded', 'false');
          t.addEventListener('click', function () {
            var open = head.classList.toggle('digest-open');
            t.setAttribute('aria-expanded', String(open));
            t.textContent = open ? 'Hide the digest' : 'Read the day’s digest \u2192';
          });
          box.appendChild(t);
        }
        (head.querySelector('.lane-more') || h2).insertAdjacentElement('afterend', box);   // the lane takeaway (if any) follows the highlights
        var tag = head.querySelector('.lane-tag');
        if (tag) lane.setAttribute('aria-label', tag.textContent.trim());
      }
      if (box) box.hidden = !reader();
      if (!reader()) head.classList.remove('digest-open');
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
    var btn = document.querySelector('.reader-saved');
    if (btn) {
      var count = btn.querySelector('.rd-count');
      if (count) count.textContent = list.length ? String(list.length) : '';
      btn.setAttribute('aria-label', 'Saved stories' + (list.length ? ', ' + list.length : ''));
    }
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
  var prefs = null, laneBase = null, prefSig = null, lastNavKey = '';

  function idList(a) { return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string'; }) : []; }
  function loadPrefs() {
    try {
      var o = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
      if (o && typeof o === 'object') return { order: idList(o.order), off: idList(o.off) };
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
    // The pill row snaps to the pill it was on: after a reorder, start again from the first one.
    var navKey = shown.join(',') + '|' + ids.join(',');
    if (nav && navKey !== lastNavKey) { nav.scrollLeft = 0; lastNavKey = navKey; }

    var sig = on ? shown.join(',') : '';
    if (prefSig !== null && sig !== prefSig) document.dispatchEvent(new CustomEvent('hb:prefs'));
    prefSig = sig;
  }
  function commitPrefs() { storePrefs(); applyPrefs(); syncSoon(); }

  function openPrefs(returnTo, first) {
    if (!laneBase) return;
    var msg = null;
    openSheet(first ? 'Make the brief yours' : 'Your sections', function (body) {
      body.appendChild(mk('p', '', first
        ? 'Choose what goes in your daily brief and in what order. You can change this any time from the menu at the top right.'
        : 'Switch sections on or off and move them up or down. Changes apply straight away.'));
      var ul = mk('ul', 'rd-prefs');
      msg = mk('p', 'rd-prefs-msg');
      msg.setAttribute('role', 'status');
      var reset = mk('button', 'rd-btn rd-reset', 'Reset to default');
      reset.type = 'button';
      body.appendChild(ul);
      body.appendChild(msg);
      body.appendChild(reset);

      function draw(focus) {
        var ids = choosable(), onCount = ids.filter(function (id) { return prefs.off.indexOf(id) < 0; }).length;
        ul.textContent = '';
        ids.forEach(function (id, i) {
          var name = laneName(document.getElementById(id));
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
          lab.appendChild(mk('span', 'rd-sw-name', name));
          li.appendChild(lab);
          [['up', '↑', -1], ['down', '↓', 1]].forEach(function (d) {
            var b = mk('button', 'rd-btn rd-mv rd-' + d[0], d[1]);
            b.type = 'button';
            b.setAttribute('aria-label', 'Move ' + name + ' ' + d[0]);
            b.disabled = i + d[2] < 0 || i + d[2] >= ids.length;
            b.addEventListener('click', function () {
              var order = ids.slice(), t = order[i];
              order[i] = order[i + d[2]];
              order[i + d[2]] = t;
              prefs.order = order;
              msg.textContent = '';
              commitPrefs();
              draw('[data-id="' + id + '"] .rd-' + d[0]);
            });
            li.appendChild(b);
          });
          ul.appendChild(li);
        });
        var f = focus && ul.querySelector(focus);
        if (f && f.disabled) f = ul.querySelector(focus.replace(/\.rd-(up|down)$/, function (m, w) { return '.rd-' + (w === 'up' ? 'down' : 'up'); }));
        if (f && !f.disabled) f.focus({ preventScroll: true });
      }
      reset.addEventListener('click', function () {
        prefs = { order: [], off: [] };
        msg.textContent = 'Back to the default order, everything on.';
        commitPrefs();
        draw();
      });
      draw();
    }, returnTo, first ? 'Start reading' : 'Done');
  }

  // First time in the app: offer the choice once (the website is never interrupted this way).
  function maybeOnboard() {
    if (!NATIVE || !laneBase || loadPrefs() || location.hash || /[?&]utm_/.test(location.search)) return;
    if (choosable().length < 2) return;
    prefs = { order: [], off: [] };
    if (!storePrefs()) return;                     // cannot remember the answer: do not ask every time
    setTimeout(function () { if (!sheetEl) openPrefs(null, true); }, 700);
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
    bell: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    today: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5h12.5v13H6.5a2.5 2.5 0 0 1-2.5-2.5V5.5z"/><path d="M16.5 9H20v7a2.5 2.5 0 0 1-2.5 2.5"/><path d="M7.5 9h6M7.5 12h6M7.5 15h3.5"/></svg>',
    audio: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 10v4M8 6.5v11M12 3.5v17M16 7.5v9M20 10v4"/></svg>',
    quiz: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/></svg>',
    archive: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5.8c2.4-1 5.6-.8 9 .9 3.4-1.7 6.6-1.9 9-.9V19c-2.4-1-5.6-.8-9 .9-3.4-1.7-6.6-1.9-9-.9V5.8z"/><path d="M12 6.7v13.2"/></svg>',
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
        h1.insertAdjacentElement('afterend', mk('p', 'ab-screen', screenName()));
      }
      var logo = mk('img', 'ab-logo');
      logo.src = LOGO_SRC;
      logo.alt = '';
      logo.width = logo.height = 34;
      inner.insertBefore(logo, inner.firstChild);

      bar = mk('div', 'ab-actions');
      var aa = mk('button', 'ab-btn reader-size');
      aa.type = 'button';
      aa.setAttribute('aria-label', 'Text size');
      aa.innerHTML = ICON.aa;
      aa.addEventListener('click', function () { openTextSize(aa); });
      var sv = mk('button', 'ab-btn reader-saved');
      sv.type = 'button';
      sv.innerHTML = STAR_SVG + '<span class="rd-count"></span>';
      sv.addEventListener('click', function () { openSaved(sv); });
      var mn = mk('button', 'ab-btn ab-menu');
      mn.type = 'button';
      mn.setAttribute('aria-label', 'Menu: sections, text size, reminder, share');
      mn.innerHTML = SLIDERS_SVG;
      mn.addEventListener('click', function () { openMenu(mn); });
      bar.appendChild(aa);
      bar.appendChild(sv);
      bar.appendChild(mn);
      inner.appendChild(bar);
      refreshSaved();
    }
    var on = reader();
    [inner.querySelector('.ab-logo'), inner.querySelector('.ab-screen'), bar].forEach(function (el) { if (el) el.hidden = !on; });
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
      if (laneBase) item('sections', SLIDERS_SVG, 'Sections', 'Show, hide and reorder', function () { openPrefs(returnTo); });
      item('textsize', ICON.aa, 'Text size', SIZE_NAMES[getSize()], function () { openTextSize(returnTo); });
      if (document.getElementById('cap-remind')) item('reminder', ICON.bell, 'Daily reminder', 'A morning nudge on this device', function () { closeSheet(); document.getElementById('cap-remind').click(); });
      item('share', SHARE_SVG, 'Share this edition', 'Send today’s brief to a friend', function () { closeSheet(); shareEdition(); });
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

  // Bottom tabs: Today (the feed), Audio (the Listen hub), Challenge (the quiz), Archive (past editions)
  var TABS = [['today', 'Today'], ['audio', 'Audio'], ['quiz', 'Challenge'], ['archive', 'Archive']];
  function isFeed() { return !!document.querySelector('section.lane'); }          // an edition page (today's or an archived one)
  var INFO_TITLES = { '/about.html': 'About', '/privacy.html': 'Privacy', '/contact.html': 'Contact us' };
  function screenName() {
    var p = location.pathname;
    if (INFO_TITLES[p]) return INFO_TITLES[p];
    if (/^\/archive\/(index\.html)?$/.test(p)) return 'Archive';
    return 'Feed';
  }
  // On pages that are not editions the tabs are plain links back to the right place.
  var TAB_HREF = { today: '/', audio: '/?audio=1', quiz: '/#quiz', archive: '/archive/' };
  function tabGo(name) {
    var L = window.HBListen;
    if (name === 'audio') { if (L && L.openHub) L.openHub(); else toast('Audio is loading…'); return; }
    if (L && L.closeHub) L.closeHub();
    if (name === 'today') window.scrollTo({ top: 0, behavior: 'smooth' });
    else if (name === 'quiz') { var q = document.getElementById('quiz'); if (q) q.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    setTimeout(syncTabs, 60);
  }
  function tabBar() {
    var bar = document.querySelector('.tab-bar');
    if (!bar) {
      bar = mk('nav', 'tab-bar');
      bar.setAttribute('aria-label', 'App sections');
      var feed = isFeed();
      TABS.forEach(function (t) {
        var link = t[0] === 'archive' || !feed;
        var el = link ? mk('a', 'tab') : mk('button', 'tab');
        el.setAttribute('data-tab', t[0]);
        el.innerHTML = '<span class="tab-ic">' + ICON[t[0]] + '</span><span class="tab-lb">' + t[1] + '</span>';
        if (link) el.href = TAB_HREF[t[0]];
        else { el.type = 'button'; el.addEventListener('click', function () { tabGo(t[0]); }); }
        bar.appendChild(el);
      });
      document.body.appendChild(bar);
      window.addEventListener('scroll', syncSoon, { passive: true });
      document.addEventListener('hb:hub', syncTabs);
    }
    bar.hidden = !reader();
    syncTabs();
  }
  function syncTabs() {
    var bar = document.querySelector('.tab-bar');
    if (!bar || bar.hidden) return;
    if (!isFeed()) {                                           // About, Privacy, Contact, the archive list
      var here = screenName();
      bar.querySelectorAll('.tab').forEach(function (t) {
        if (t.getAttribute('data-tab') === 'archive' && here === 'Archive') t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
        if (t.getAttribute('data-tab') === 'quiz') t.hidden = false;
      });
      var l2 = document.querySelector('.ab-screen');
      if (l2) l2.textContent = here;
      return;
    }
    var q = document.getElementById('quiz'), qOk = !!(q && !q.hidden && !q.hasAttribute('data-pref-off'));
    var L = window.HBListen, hub = !!(L && L.hubOpen && L.hubOpen());
    var r = qOk ? q.getBoundingClientRect() : null;
    var cur = hub ? 'audio' : (r && r.top < window.innerHeight * 0.5 && r.bottom > 90) ? 'quiz' : 'today';
    bar.querySelectorAll('.tab').forEach(function (t) {
      var n = t.getAttribute('data-tab');
      if (n === cur) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
      if (n === 'quiz') t.hidden = !qOk;
    });
    var lb = document.querySelector('.ab-screen');
    if (lb) lb.textContent = cur === 'audio' ? 'Audio' : cur === 'quiz' ? 'Quiz' : 'Feed';
  }

  // Section chips: an "All" chip, and the one for the section in view is filled (replaces the page's own three-section spy)
  function syncChips() {
    var nav = document.querySelector('.nav');
    if (!nav || !reader()) return;
    var cur = 'all';
    document.querySelectorAll('section.lane[id]').forEach(function (l) {
      if (l.style.display !== 'none' && !l.hidden && l.getBoundingClientRect().top <= 110) cur = l.id;
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
    if (it.classList.contains('is-collapsed')) {
      var b = it.querySelector(':scope > div > .story-more');
      if (b && !b.hidden) b.click();
    }
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
    if (!reader() || !/[?&]audio=1(&|$)/.test(location.search)) return;
    var tries = 0;
    (function wait() {
      if (window.HBListen && window.HBListen.openHub) { window.HBListen.openHub(); return; }
      if (++tries < 40) setTimeout(wait, 100);
    })();
  }
  function start() { apply(); openFromHash(); loadListen(); maybeOnboard(); openAudioFromUrl(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
  window.addEventListener('load', queueMeasure);
  window.addEventListener('resize', queueMeasure);
  mq.addEventListener('change', function () { apply(); loadListen(); });
})();
