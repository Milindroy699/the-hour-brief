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
 *  - The evergreen About paragraph gets a matching "More" toggle.
 */
(function () {
  var mq = window.matchMedia('(max-width: 640px)');

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
          t.textContent = 'Read the day’s digest';
          t.setAttribute('aria-expanded', 'false');
          t.addEventListener('click', function () {
            var open = head.classList.toggle('digest-open');
            t.setAttribute('aria-expanded', String(open));
            t.textContent = open ? 'Hide the digest' : 'Read the day’s digest';
          });
          box.appendChild(t);
        }
        (head.querySelector('.lane-more') || h2).insertAdjacentElement('afterend', box);   // the lane takeaway (if any) follows the highlights
        var tag = head.querySelector('.lane-tag');
        if (tag) lane.setAttribute('aria-label', tag.textContent.trim());
      }
      if (box) box.hidden = !mq.matches;
      if (!mq.matches) head.classList.remove('digest-open');
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
        t.textContent = ' \u00B7 ' + Math.max(1, Math.round(words / 200)) + ' min';
        tag.appendChild(t);
      }
      t.hidden = !mq.matches;
    });
  }

  // ---- Share a single story, with attribution and a link to that story ----
  function editionDate() {
    var pageEl = document.querySelector('[data-edition-date]');
    return pageEl && pageEl.getAttribute('data-edition-date');
  }
  function storyUrl(it) {
    var d = editionDate();
    return location.origin + (d ? '/archive/' + d + '.html' : location.pathname) + '?utm_source=share&utm_medium=story#' + it.id;
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
  function storyShareButtons() {
    document.querySelectorAll('.item[data-story-id]').forEach(function (it) {
      if (!it.id) it.id = it.dataset.storyId;
      var row = it.querySelector('.vote-row');
      if (!row) return;
      var b = row.querySelector('.story-share');
      if (!b) {
        b = document.createElement('button');
        b.type = 'button';
        b.className = 'story-share mob-only';
        b.setAttribute('aria-label', 'Share this story');
        b.innerHTML = SHARE_SVG;
        b.addEventListener('click', function () { shareStory(it); });
        row.appendChild(b);
      }
      b.hidden = !mq.matches;
    });
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
    bar.hidden = top.hidden = !mq.matches;
  }

  // ---- Open a shared story link: expand it, scroll to it, flash it ----
  function openFromHash() {
    var id = decodeURIComponent((location.hash || '').slice(1));
    if (!id || !mq.matches) return;
    var it = document.getElementById(id);
    if (!it || !it.classList.contains('item')) return;
    if (it.classList.contains('is-collapsed')) {
      var b = it.querySelector(':scope > div > .story-more');
      if (b && !b.hidden) b.click();
    }
    it.scrollIntoView({ block: 'start' });
    it.classList.add('deeplinked');
  }

  function apply() {
    collapsibleStories();
    laneToggles();
    laneDigests();
    readTimes();
    aboutToggle();
    storyShareButtons();
    progressUi();
    measureClamps();
  }

  function start() { apply(); openFromHash(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
  window.addEventListener('load', queueMeasure);
  window.addEventListener('resize', queueMeasure);
  mq.addEventListener('change', apply);
})();
