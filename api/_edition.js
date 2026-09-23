// Shared helpers for reading published editions (used by the share landing pages and the daily post).
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

function editionInfo(html, max = 140) {
  const num = /Edition (\d+)<br>/.exec(html);
  const date = /data-edition-date="(\d{4}-\d{2}-\d{2})"/.exec(html);
  const lanes = {};
  ['ai', 'biz', 'mkt'].forEach((k) => {
    const sec = laneSection(html, k);
    const tk = /class="lane-takeaway"><span class="takeaway-label">[^<]*<\/span>\s*([\s\S]*?)<\/p>/.exec(sec);
    const h2 = /<h2>([\s\S]*?)<\/h2>/.exec(sec);
    lanes[k] = clip(text(tk ? tk[1] : h2 ? h2[1] : ''), max);
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

module.exports = { CANON, DATE_RE, ID_RE, CODE_RE, LANE_LABEL, text, esc, clip, loadEdition, laneSection, editionInfo, storyInfo };
