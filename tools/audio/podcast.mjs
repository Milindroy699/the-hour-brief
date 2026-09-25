// Podcast feed for The Hour Brief (Spotify, Apple Podcasts and any other podcast app): an RSS 2.0 file with one episode per
// recorded edition. It reads only what the daily audio job already publishes (each day's manifest.json: file, bytes,
// duration) and the edition page (title, takeaways), so building it costs nothing and never touches Sarvam.
//
//   node podcast.mjs --audio DIR --audio-base URL --feed-url URL [--site URL] [--repo ROOT] [--out podcast.xml] [--episodes-out episodes.json]
//       DIR        folder holding <date>/manifest.json for every recorded day (the workflow syncs it from R2)
//       audio-base where the audio lives; episode audio is <audio-base>/audio/<date>/<file>
//       feed-url   the address the feed itself will be published at (goes into atom:link rel="self")
//   node podcast.mjs --verify FEED_URL     fetch a published feed and check it, and that the newest audio is really served
//
// Episodes are keyed by a stable guid (hourbrief-<date>), so re-recording a day (new audio file) updates that episode instead
// of adding a duplicate. pubDate is derived from the date, so the same inputs always give the same feed.
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { editionMeta } from './script.mjs';

export const SHOW = {
  title: 'The Hour Brief',
  site: 'https://the-hour-brief.vercel.app',
  description: 'A daily news brief, read aloud in about seven minutes: what moved in AI and technology, product and business in India and around the world, and what the Indian stock market did and why. Every story links back to its original source at the-hour-brief.vercel.app. Narrated by an AI-generated voice.',
  subtitle: 'Your daily brief on AI, business and the markets, read aloud.',
  language: 'en-IN',
  author: 'The Hour Brief',
  ownerName: 'The Hour Brief',
  ownerEmail: 'milindroy101292@gmail.com',
  categories: [['News', 'Daily News'], ['Technology']],
  cover: '/brand/podcast-cover.jpg',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// XML text: escape the five special characters and drop characters XML 1.0 forbids.
export function esc(s) {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…'; };
const pad = (n, w = 2) => String(n).padStart(w, '0');
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

export function longDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function hms(secs) {
  const s = Math.max(0, Math.round(secs));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

// Section name + takeaway from an edition page; older editions have no takeaways, so they fall back to the section headline.
export function sections(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('section.lane').each((_, lane) => {
    if (!$(lane).find('.item[data-story-id]').length) return;          // the quiz section
    const name = $(lane).find('.lane-tag').first().clone().find('.lane-time').remove().end().text().replace(/\s+/g, ' ').trim();
    const tk = $(lane).find('.lane-takeaway').first().clone();
    tk.find('.takeaway-label').remove();
    let text = tk.text().replace(/\s+/g, ' ').trim();
    if (!text) text = $(lane).find('.lane-head h2').first().text().replace(/\s+/g, ' ').trim();
    if (name && text) out.push({ name, text: clip(text, 420) });
  });
  return out;
}

// One episode from a manifest (+ its edition page, when the repo has it).
export function episodeFrom(manifest, html, { audioBase, site }) {
  const q = manifest && manifest.modes && manifest.modes.quick;
  if (!q || !/^[a-z]+\.[0-9a-f]{8}\.mp3$/.test(q.file || '') || !(q.duration > 0) || !(q.bytes > 0)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.date || '')) return null;
  const date = manifest.date;
  const number = manifest.edition || (html ? editionMeta(html).number : 0);
  const mins = Math.max(1, Math.round(q.duration / 60));
  const voice = cap(manifest.voice) || 'an';
  const secs = html ? sections(html) : [];
  const page = `${site}/archive/${date}.html`;
  const body = [
    `Your brief for ${longDate(date)}, read aloud in about ${mins} minute${mins === 1 ? '' : 's'}.`,
    ...secs.map((s) => `${s.name}: ${s.text}`),
    `Read along, with every story's original source: ${page}`,
    `Narrated by ${voice === 'an' ? 'an AI-generated voice' : voice + ', an AI-generated voice'}.`,
  ].join('\n\n');
  return {
    date, number, guid: `hourbrief-${date}`,
    title: `${number ? `Edition ${pad(number, 3)} · ` : ''}${longDate(date)}`,
    description: body,
    pubDate: new Date(`${date}T03:30:00Z`).toUTCString(),           // 09:00 in India, the time the edition is out
    url: `${audioBase}/audio/${date}/${q.file}`, bytes: q.bytes, duration: q.duration, page, voice: manifest.voice || '',
  };
}

// The list the Audio screen shows ("all episodes"): newest first, just what a row needs. The audio itself is opened from the
// edition's own page, which has the chapters and highlights.
export function buildEpisodeList(episodes) {
  return {
    v: 1,
    episodes: [...episodes].sort((a, b) => (a.date < b.date ? 1 : -1)).map((e) => ({
      date: e.date, edition: e.number || 0, minutes: Math.max(1, Math.round(e.duration / 60)), duration: Math.round(e.duration), bytes: e.bytes, voice: e.voice || '',
    })),
  };
}

export function buildFeed(episodes, { feedUrl, show = SHOW } = {}) {
  const eps = [...episodes].sort((a, b) => (a.date < b.date ? 1 : -1));       // newest first
  const cover = show.site + show.cover;
  const last = eps.length ? eps[0].pubDate : new Date(0).toUTCString();
  const cats = show.categories.map(([main, sub]) => sub
    ? `    <itunes:category text="${esc(main)}"><itunes:category text="${esc(sub)}"/></itunes:category>`
    : `    <itunes:category text="${esc(main)}"/>`).join('\n');
  const items = eps.map((e) => `    <item>
      <title>${esc(e.title)}</title>
      <description>${esc(e.description)}</description>
      <itunes:summary>${esc(e.description)}</itunes:summary>
      <link>${esc(e.page)}</link>
      <guid isPermaLink="false">${esc(e.guid)}</guid>
      <pubDate>${e.pubDate}</pubDate>
      <enclosure url="${esc(e.url)}" length="${e.bytes}" type="audio/mpeg"/>
      <itunes:duration>${hms(e.duration)}</itunes:duration>
      <itunes:episodeType>full</itunes:episodeType>${e.number ? `\n      <itunes:episode>${e.number}</itunes:episode>` : ''}
      <itunes:explicit>false</itunes:explicit>
    </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(show.title)}</title>
    <link>${esc(show.site)}/</link>
    <atom:link href="${esc(feedUrl)}" rel="self" type="application/rss+xml"/>
    <description>${esc(show.description)}</description>
    <language>${esc(show.language)}</language>
    <copyright>${esc(`© ${new Date().getUTCFullYear()} ${show.title}`)}</copyright>
    <lastBuildDate>${last}</lastBuildDate>
    <generator>The Hour Brief podcast feed (tools/audio/podcast.mjs)</generator>
    <itunes:author>${esc(show.author)}</itunes:author>
    <itunes:subtitle>${esc(show.subtitle)}</itunes:subtitle>
    <itunes:summary>${esc(show.description)}</itunes:summary>
    <itunes:type>episodic</itunes:type>
    <itunes:explicit>false</itunes:explicit>
    <itunes:image href="${esc(cover)}"/>
    <image><url>${esc(cover)}</url><title>${esc(show.title)}</title><link>${esc(show.site)}/</link></image>
${cats}
    <itunes:owner>
      <itunes:name>${esc(show.ownerName)}</itunes:name>
      <itunes:email>${esc(show.ownerEmail)}</itunes:email>
    </itunes:owner>
${items}
  </channel>
</rss>
`;
}

// Reads <dir>/<date>/manifest.json for every day, and the matching edition page from the repo.
export function collect(dir, { repo, audioBase, site = SHOW.site } = {}) {
  const eps = [];
  for (const d of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    const mf = path.join(dir, d, 'manifest.json');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !fs.existsSync(mf)) continue;
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { console.warn(`skipping ${d}: unreadable manifest`); continue; }
    let html = '';
    for (const f of [path.join(repo, 'archive', `${d}.html`), path.join(repo, 'index.html')]) {
      if (!fs.existsSync(f)) continue;
      const t = fs.readFileSync(f, 'utf8');
      if (editionMeta(t).date === d) { html = t; break; }
    }
    const ep = episodeFrom(manifest, html, { audioBase, site });
    if (ep) eps.push(ep); else console.warn(`skipping ${d}: no usable Quick recording in its manifest`);
  }
  return eps;
}

// ---- checks (used by --verify and by the tests) ----
export function checkFeedXml(xml) {
  const problems = [];
  const S = process.env.HB_ALLOW_HTTP === '1' ? 'https?' : 'https';        // plain http only for the tests' local host
  const $ = cheerio.load(xml, { xmlMode: true });
  const ch = $('rss > channel');
  const need = (cond, msg) => { if (!cond) problems.push(msg); };
  need($('rss').attr('version') === '2.0', 'rss version must be 2.0');
  for (const t of ['title', 'link', 'description', 'language']) need(ch.children(t).first().text().trim(), `channel is missing <${t}>`);
  const img = ch.children('itunes\\:image').attr('href') || '';
  need(new RegExp(`^${S}:\\/\\/.+\\.(jpe?g|png)$`, 'i').test(img), 'itunes:image must be an https link to a .jpg or .png');
  need(ch.children('itunes\\:category').length >= 1, 'needs an itunes:category');
  need(['true', 'false', 'yes', 'no'].includes(ch.children('itunes\\:explicit').first().text().trim()), 'needs itunes:explicit');
  need(/@/.test(ch.find('itunes\\:owner > itunes\\:email').text()), 'needs itunes:owner with an email (Spotify verifies ownership by emailing it)');
  need(new RegExp(`^${S}:\\/\\/`).test(ch.children('atom\\:link[rel="self"]').attr('href') || ''), 'needs atom:link rel="self" over https');
  const items = ch.children('item');
  need(items.length >= 1, 'the feed has no episodes');
  const guids = new Set();
  items.each((_, it) => {
    const i = $(it), name = i.children('title').text().trim() || '(untitled)';
    const g = i.children('guid').text().trim();
    need(g, `${name}: missing guid`);
    need(!guids.has(g), `${name}: duplicate guid ${g}`);
    guids.add(g);
    need(i.children('title').text().trim(), `${name}: missing title`);
    need(i.children('description').text().trim().length >= 20, `${name}: description is empty`);
    need(i.children('description').text().length <= 4000, `${name}: description over 4000 characters`);
    const pd = i.children('pubDate').text().trim();
    need(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(pd) && !Number.isNaN(Date.parse(pd)), `${name}: pubDate is not RFC 822 (${pd})`);
    const en = i.children('enclosure');
    need(new RegExp(`^${S}:\\/\\/.+\\.mp3$`).test(en.attr('url') || ''), `${name}: enclosure must be an https .mp3 link`);
    need(/^[1-9]\d*$/.test(en.attr('length') || ''), `${name}: enclosure length must be the file size in bytes`);
    need(en.attr('type') === 'audio/mpeg', `${name}: enclosure type must be audio/mpeg`);
    need(/^\d{2}:\d{2}:\d{2}$/.test(i.children('itunes\\:duration').text().trim()), `${name}: itunes:duration must be HH:MM:SS`);
  });
  const dates = items.map((_, it) => Date.parse($(it).children('pubDate').text())).get();
  need(dates.every((t, k) => k === 0 || dates[k - 1] >= t), 'episodes must be listed newest first');
  return problems;
}

async function verify(feedUrl) {
  const res = await fetch(feedUrl);
  const xml = await res.text();
  const problems = [];
  if (!res.ok) problems.push(`the feed answered ${res.status}`);
  if (!/xml/.test(res.headers.get('content-type') || '')) problems.push(`feed content-type is "${res.headers.get('content-type')}", expected an xml type`);
  problems.push(...checkFeedXml(xml));
  const $ = cheerio.load(xml, { xmlMode: true });
  const cover = $('channel > itunes\\:image').attr('href');
  if (cover) {
    const r = await fetch(cover, { method: 'HEAD' });
    if (!r.ok || !/^image\/(jpeg|png)/.test(r.headers.get('content-type') || '')) problems.push(`cover art ${cover} answered ${r.status} ${r.headers.get('content-type')}`);
  }
  for (const it of $('channel > item').slice(0, 3).toArray()) {
    const en = $(it).children('enclosure'), url = en.attr('url');
    const h = await fetch(url, { method: 'HEAD' });
    const len = h.headers.get('content-length');
    if (!h.ok) problems.push(`${url} answered ${h.status}`);
    else {
      if (len && len !== en.attr('length')) problems.push(`${url}: feed says ${en.attr('length')} bytes, server says ${len}`);
      if (!/audio\/mpeg/.test(h.headers.get('content-type') || '')) problems.push(`${url}: content-type ${h.headers.get('content-type')}`);
      const r = await fetch(url, { headers: { Range: 'bytes=0-99' } });
      if (r.status !== 206) problems.push(`${url}: does not support range requests (got ${r.status}); podcast apps need them`);
    }
  }
  return { problems, episodes: $('channel > item').length };
}

// ---- command line ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
  if (process.argv.includes('--verify')) {
    const { problems, episodes } = await verify(arg('--verify'));
    if (problems.length) { console.error('Feed problems:\n - ' + problems.join('\n - ')); process.exit(1); }
    console.log(`Feed OK: ${episodes} episode(s); cover art and the newest audio are served correctly.`);
  } else {
    const audioBase = (arg('--audio-base', process.env.R2_PUBLIC_URL || '') || '').replace(/\/$/, '');
    const feedUrl = arg('--feed-url', audioBase ? `${audioBase}/podcast.xml` : '');
    const site = (arg('--site', SHOW.site)).replace(/\/$/, '');
    const repo = path.resolve(arg('--repo', path.resolve(import.meta.dirname, '../..')));
    if (!audioBase || !arg('--audio')) { console.error('Usage: node podcast.mjs --audio DIR --audio-base URL [--feed-url URL] [--out podcast.xml]'); process.exit(2); }
    const eps = collect(path.resolve(arg('--audio')), { repo, audioBase, site });
    if (!eps.length) { console.error('No recorded episodes found: refusing to write an empty feed.'); process.exit(1); }
    const xml = buildFeed(eps, { feedUrl, show: { ...SHOW, site } });
    const problems = checkFeedXml(xml);
    if (problems.length) { console.error('Feed problems:\n - ' + problems.join('\n - ')); process.exit(1); }
    fs.writeFileSync(path.resolve(arg('--out', 'podcast.xml')), xml);
    if (arg('--episodes-out')) fs.writeFileSync(path.resolve(arg('--episodes-out')), JSON.stringify(buildEpisodeList(eps)));
    console.log(`Wrote ${eps.length} episode(s) to ${arg('--out', 'podcast.xml')}`);
  }
}
