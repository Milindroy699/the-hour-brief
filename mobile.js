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
 *  - The lane headline (a long digest sentence) and the evergreen About
 *    paragraph get matching "More" toggles.
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

  function apply() {
    collapsibleStories();
    laneToggles();
    aboutToggle();
    measureClamps();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
  window.addEventListener('load', queueMeasure);
  window.addEventListener('resize', queueMeasure);
  mq.addEventListener('change', apply);
})();
