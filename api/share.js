// Share landing pages: /e/<date> (edition), /s/<date>/<id> (story), /q/<date>/<score> (quiz challenge),
// /l/<code> (league invite). Crawlers read the Open Graph tags; people are redirected straight on.
const CANON = 'https://the-hour-brief.vercel.app';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z]{1,8}-\d{1,3}$/;
const CODE_RE = /^[A-Z0-9]{4,10}$/;
const LANE_LABEL = { ai: 'AI & Tech', biz: 'Product & Business', mkt: 'Stock Market' };

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“',
  rdquo: '”', mdash: '—', ndash: '–', hellip: '…', middot: '·', rarr: '→', euro: '€',
};
function text(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[e.toLowerCase()] !== undefined ? ENTITIES[e.toLowerCase()] : m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function clip(s, n) {
  s = String(s || '').trim();
  return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…';
}

async function loadEdition(date) {
  const path = date === 'latest' ? '/' : `/archive/${date}.html`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetch(CANON + path, { signal: ctl.signal });
    return r.ok ? await r.text() : '';
  } catch (e) {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

function laneSection(html, lane) {
  const m = new RegExp(`<section class="lane ${lane}" id="${lane}">([\\s\\S]*?)</section>`).exec(html);
  return m ? m[1] : '';
}

function editionInfo(html) {
  const num = /Edition (\d+)<br>/.exec(html);
  const date = /data-edition-date="(\d{4}-\d{2}-\d{2})"/.exec(html);
  const lanes = {};
  ['ai', 'biz', 'mkt'].forEach((k) => {
    const sec = laneSection(html, k);
    const tk = /class="lane-takeaway"><span class="takeaway-label">[^<]*<\/span>\s*([\s\S]*?)<\/p>/.exec(sec);
    const h2 = /<h2>([\s\S]*?)<\/h2>/.exec(sec);
    lanes[k] = clip(text(tk ? tk[1] : h2 ? h2[1] : ''), 140);
  });
  return { n: num ? num[1] : '', d: date ? date[1] : '', lanes };
}

function storyInfo(html, id) {
  const start = html.indexOf(`data-story-id="${id}"`);
  if (start < 0) return null;
  const chunk = html.slice(start, start + 6000);
  const h3 = /<h3>([\s\S]*?)<\/h3>/.exec(chunk);
  const tk = /class="takeaway"><span class="takeaway-label">[^<]*<\/span>\s*([\s\S]*?)<\/p>/.exec(chunk);
  return { headline: text(h3 && h3[1]), takeaway: text(tk && tk[1]) };
}

function page({ title, description, image, alt, landing, dest }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(CANON + dest.split('#')[0].split('?')[0])}">
<meta property="og:site_name" content="The Hour Brief">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(landing)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(alt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0;url=${esc(dest)}">
<script>location.replace(${JSON.stringify(dest)});</script>
</head><body style="font:16px/1.5 system-ui,sans-serif;padding:24px"><p>Opening <a href="${esc(dest)}">The Hour Brief</a>…</p></body></html>`;
}

const img = (params) => `${CANON}/api/og?${new URLSearchParams(params).toString()}`;

module.exports = async (req, res) => {
  const q = req.query || {};
  const t = String(q.t || '');
  const date = String(q.date || '');
  let meta = null;

  if (t === 'e' && (DATE_RE.test(date) || date === 'latest')) {
    const info = editionInfo(await loadEdition(date));
    const d = info.d || (date === 'latest' ? '' : date);
    const params = { type: 'edition', n: info.n, d, ai: info.lanes.ai, biz: info.lanes.biz, mkt: info.lanes.mkt };
    const desc = ['ai', 'biz', 'mkt'].map((k) => info.lanes[k] && `${LANE_LABEL[k]}: ${info.lanes[k]}`).filter(Boolean).join(' ');
    meta = {
      title: `The Hour Brief${info.n ? ` · Edition ${info.n}` : ''}`,
      description: clip(desc || 'A free daily digest of AI & tech, product & business, and the Indian stock market.', 200),
      image: img(params),
      alt: 'The Hour Brief daily edition',
      landing: `${CANON}/e/${date}`,
      dest: date === 'latest' ? '/' : `/archive/${date}.html`,
    };
  } else if (t === 's' && DATE_RE.test(date) && ID_RE.test(String(q.id || ''))) {
    const id = String(q.id);
    const s = storyInfo(await loadEdition(date), id) || { headline: '', takeaway: '' };
    const lane = id.split('-')[0];
    meta = {
      title: s.headline || 'A story from The Hour Brief',
      description: clip(s.takeaway ? `Takeaway: ${s.takeaway}` : 'Read the full story in The Hour Brief.', 200),
      image: img({ type: 'story', lane, d: date, h: s.headline, t: s.takeaway }),
      alt: s.headline || 'The Hour Brief story',
      landing: `${CANON}/s/${date}/${id}`,
      dest: `/archive/${date}.html?utm_source=share&utm_medium=story#${id}`,
    };
  } else if (t === 'q' && DATE_RE.test(date) && /^\d{1,2}$/.test(String(q.score || ''))) {
    const score = String(q.score);
    const total = /^\d{1,2}$/.test(String(q.total || '')) ? String(q.total) : '5';
    const sq = /^[01]{1,10}$/.test(String(q.sq || '')) ? String(q.sq) : '';
    meta = {
      title: `Can you beat ${score}/${total} on today’s Hour Brief quiz?`,
      description: 'Five quick questions on the day’s news. Free, no sign-up.',
      image: img({ type: 'quiz', d: date, score, total, sq }),
      alt: `Quiz score ${score} out of ${total}`,
      landing: `${CANON}/q/${date}/${score}`,
      dest: `/archive/${date}.html?utm_source=share&utm_medium=quiz&beat=${score}#quiz`,
    };
  } else if (t === 'l' && CODE_RE.test(String(q.code || '').toUpperCase())) {
    const code = String(q.code).toUpperCase();
    const name = String(q.n || '').slice(0, 60);
    meta = {
      title: name ? `Join “${name}” on The Hour Brief` : 'Join my Hour Brief league',
      description: 'Play the daily 5-question news quiz and compete with friends. Free, no sign-up.',
      image: img({ type: 'league', name }),
      alt: 'Join a friends league on The Hour Brief',
      landing: `${CANON}/l/${code}`,
      dest: `/?join=${code}#quiz`,
    };
  }

  if (!meta) {
    res.status(404).setHeader('Content-Type', 'text/plain; charset=utf-8').send('Not found');
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).send(page(meta));
};
