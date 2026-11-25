/* Post kit › Instagram (owner, 2026-11-25): the day's "Day in 5" carousel, made and posted automatically by GitHub
 * (.github/workflows/instagram.yml, tools/social/insta.mjs) at 09:45 IST. Shows the slides, the day's art style (the style
 * test), the caption, and where to see the numbers. Nothing to do here unless the automatic post failed: then the slides can
 * be saved and posted by hand. */
(function () {
  'use strict';
  var R2 = 'https://pub-1dafea4a948540db8413a044895e083c.r2.dev';
  var STYLE = { riso: 'Risograph', watercolor: 'Watercolour and gold', clay: 'Clay 3D' };
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) { if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  var CSS = '.igk-rail{display:flex;gap:10px;overflow-x:auto;padding:4px 0 10px;scroll-snap-type:x mandatory}.igk-rail a{flex:none;scroll-snap-align:start}' +
    '.igk-rail img{width:200px;height:250px;object-fit:cover;border-radius:12px;border:1px solid var(--line);display:block}' +
    '.igk-cap{width:100%;min-height:12em;font:inherit;font-size:.9rem;padding:10px;border-radius:12px;border:1px solid var(--line);background:var(--paper);color:var(--ink)}' +
    '.igk-pill{display:inline-block;padding:3px 10px;border-radius:999px;border:1px solid var(--line);font-size:.8rem;margin-right:6px}';
  function mount(root, date, copy) {
    if (!root) return;
    if (!document.getElementById('igk-css')) { var st = el('style', { id: 'igk-css' }); st.textContent = CSS; document.head.appendChild(st); }
    root.textContent = '';
    root.appendChild(el('h2', { text: 'Instagram · The day in 5' }));
    if (!date) { root.appendChild(el('p', { class: 'meta', text: 'Loading…' })); return; }
    root.appendChild(el('p', { class: 'meta', text: 'Made and posted automatically every morning at 09:45 IST. The art rotates between three styles; the growth report’s “Instagram style test” shows which one people engage with most.' }));
    var box = el('div', {}, [el('p', { class: 'meta', text: 'Loading the slides…' })]);
    root.appendChild(box);
    fetch(R2 + '/social/ig/' + date + '/meta.json', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (m) {
      box.textContent = '';
      box.appendChild(el('p', {}, [el('span', { class: 'igk-pill', text: 'Style: ' + (STYLE[m.style] || m.style) }), el('span', { class: 'igk-pill', text: m.slides.length + ' slides' }), el('span', { class: 'igk-pill', text: m.plan === 'rotate' ? 'style test: rotating' : 'style test: ' + m.plan })]));
      var rail = el('div', { class: 'igk-rail' });
      m.slides.forEach(function (s, i) {
        var src = R2 + '/social/ig/' + date + '/' + s;
        rail.appendChild(el('a', { href: src, target: '_blank', rel: 'noopener', download: 'hour-brief-' + date + '-' + (i + 1) + '.jpg' }, [el('img', { src: src, alt: 'Slide ' + (i + 1), loading: 'lazy' })]));
      });
      box.appendChild(rail);
      var cap = el('textarea', { class: 'igk-cap', readonly: '', 'aria-label': 'Caption' });
      cap.value = m.caption;
      box.appendChild(el('h3', { text: 'Caption' }));
      box.appendChild(cap);
      var b = el('button', { type: 'button', class: 'btn', text: 'Copy caption' });
      b.addEventListener('click', function () { if (copy) copy(m.caption, 'Caption copied'); else if (navigator.clipboard) navigator.clipboard.writeText(m.caption); });
      box.appendChild(b);
      box.appendChild(el('p', { class: 'hint' }, [document.createTextNode('If the automatic post ever fails: tap each slide to save it, then post them as one carousel with this caption. '), el('a', { href: 'https://www.instagram.com/thehourbrief/', target: '_blank', rel: 'noopener', text: 'Open the profile →' })]));
    }).catch(function () {
      box.textContent = '';
      box.appendChild(el('p', { class: 'meta', text: 'Not made yet for ' + date + ': it is made with the morning post (09:45 IST).' }));
    });
  }
  window.HBInsta = { mount: mount };
})();
