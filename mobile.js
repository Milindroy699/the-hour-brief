/*
 * mobile.js — phone-only reading enhancements for The Hour Brief.
 *
 * Loaded on every edition page as <script defer src="/mobile.js">. Pure
 * progressive enhancement: with no JS the page still shows every story in full.
 * Everything here is gated on matchMedia('(max-width: 640px)') and is
 * independent of the page's own inline <script> (votes, comments, scrollspy).
 *
 *  - Collapsible story bodies: headline + Takeaway stay visible, the summary
 *    sits behind a "Read more" toggle so a full edition scans in ~3 screens.
 *  - The evergreen About paragraph gets a "More" toggle to match its CSS clamp.
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

        // Wrap the summary paragraphs so they can be hidden as a unit. Do NOT
        // reorder anything in the DOM — mobile.css uses flex `order` to float
        // the Takeaway and toggle above the (collapsed) body on phones, so the
        // desktop layout, which never loads mobile.css, is left exactly as-is.
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
        inner.insertBefore(btn, wrap);
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

  function apply() {
    collapsibleStories();
    aboutToggle();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
  mq.addEventListener('change', apply);
})();
