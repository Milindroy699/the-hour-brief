// SEO and answer-engine (AEO) pass, run on every Vercel deploy as `npm run vercel-build` (package.json).
//
// The daily routine copies index.html to write each edition, so every page in git shares one generic <title> and
// description and has no canonical link or structured data. This script fixes that in the DEPLOYED copy only, never in
// git, from each page's own content, so the routine's template and workflow stay exactly as they are:
//   - every edition page: its own title, description, canonical, Open Graph card (the per-edition share image), and
//     NewsArticle + BreadcrumbList JSON-LD (sources as citations, takeaways marked speakable)
//   - the homepage: a stable brand title and description, WebSite + NewsMediaOrganization JSON-LD
//   - the other public pages: canonical + og:url; the internal post kit: noindex
//   - writes sitemap.xml (with Google News tags for the last two days), robots.txt and llms.txt
// sitemap.xml, robots.txt and llms.txt must also exist in git: Vercel lists a project's static files before this runs (it runs
// once per serverless function) and only serves files on that list, so a file created here alone would 404. Their contents
// are replaced here on every deploy.
// It never fails a deploy: anything it cannot do is logged and skipped, and the page is served as it is in git.
//
//   node tools/seo/build.mjs              on Vercel (VERCEL=1): edits the deploy copy in place
//   node tools/seo/build.mjs --out DIR    anywhere else: copies the site's pages into DIR first and edits the copy
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CANON, text, clip, laneSection } = require('../../api/_edition.js');

export const SITE = {
  name: 'The Hour Brief',
  homeTitle: 'The Hour Brief: daily AI, business and Indian stock market news brief',
  homeDescription: 'A free daily news brief: what moved in AI and technology, product and business in India and worldwide, and the Indian stock market (Sensex, Nifty). Every story links to its original source. New edition every morning.',
  logo: '/brand/logo-256.png',
  ogImage: '/og-image.png',
  sameAs: ['https://apps.apple.com/app/id6817195056', 'https://play.google.com/store/apps/details?id=app.thehourbrief',
    'https://open.spotify.com/show/1FjOE5ABaOEzUTxwJeaoYr', 'https://music.amazon.com/podcasts/191ea61e-41ab-4d99-aa47-012a56027de9/the-hour-brief', 'https://whatsapp.com/channel/0029Vb9RU0kCXC3F1pRY6q2L', 'https://t.me/thehourbrief'],
  // Search engine ownership checks, on the homepage only. Removing one un-verifies the site in that tool.
  verification: [['google-site-verification', 'xUFqUiPuQjWuYKQam9SfDEwj2WOcp-dV7PgYg48kr8A']],
};
const LANES = [['ai', 'AI & Tech'], ['biz', 'Product & Business'], ['mkt', 'Stock Market']];
// Other public pages worth a canonical link and a sitemap entry (path from the site root).
const PAGES = ['about.html', 'corrections.html', 'podcasts.html', 'leaders.html', 'contact.html', 'privacy.html', 'app.html', 'archive/index.html'];
const NOINDEX = ['share-kit.html', 'growth.html'];
// A correction note inside a story (see DEPLOY.md, "Corrections"): <p class="correction" data-corrected="YYYY-MM-DD">…</p>
const CORRECTION = /<p class="correction" data-corrected="(\d{4}-\d{2}-\d{2})">([\s\S]*?)<\/p>/g;
export const REVIEW_START = '2026-11-21';            // the owner reads each edition's Stock Market section after it publishes, from this date
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const attr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xml = (s) => attr(s).replace(/'/g, '&apos;');
const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c');            // safe inside <script>
const shortDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const urlFor = (rel) => CANON + '/' + rel.replace(/(^|\/)index\.html$/, '$1');

// ---- reading an edition page ----
export function readEdition(html) {
  const date = (/data-edition-date="(\d{4}-\d{2}-\d{2})"/.exec(html) || [])[1] || '';
  const number = Number((/class="edition">\s*Edition\s+0*(\d+)/.exec(html) || [])[1] || 0);
  const lanes = LANES.map(([id, label]) => {
    const sec = laneSection(html, id);
    const headline = text((/<h2>([\s\S]*?)<\/h2>/.exec(sec) || [])[1]);
    const takeaway = text((/class="lane-takeaway"><span class="takeaway-label">[^<]*<\/span>([\s\S]*?)<\/p>/.exec(sec) || [])[1]);
    const stories = sec.split('data-story-id="').slice(1).map((chunk) => ({
      id: chunk.slice(0, chunk.indexOf('"')),
      headline: text((/<h3>([\s\S]*?)<\/h3>/.exec(chunk) || [])[1]),
      source: (/class="src"><a href="(https?:\/\/[^"]+)"/.exec(chunk) || [])[1] || '',
      sourceName: text((/class="src"><a [^>]*>([\s\S]*?)<\/a>/.exec(chunk) || [])[1]).replace(/\s*→\s*$/, ''),
      corrections: [...chunk.matchAll(CORRECTION)].map((m) => ({ date: m[1], note: text(m[2]).replace(/^Corrected[^:]*:\s*/i, '') })),
    })).filter((s) => s.headline);
    return { id, label, headline, takeaway, stories };
  }).filter((l) => l.stories.length);
  return { date, number, lanes };
}

// Publication times from feed.xml (the routine writes the real one there); otherwise 09:00 in India on the day.
export function feedTimes(feedXml) {
  const out = {};
  for (const m of String(feedXml || '').matchAll(/<entry>[\s\S]*?\/archive\/(\d{4}-\d{2}-\d{2})\.html"[\s\S]*?<updated>([^<]+)<\/updated>/g)) out[m[1]] = m[2];
  return out;
}
const published = (date, times) => times[date] || `${date}T03:30:00Z`;

// ---- the generated <head> block ----
const BEGIN = '<!-- seo:start: written on deploy by tools/seo/build.mjs; edit that script, not this block -->';
const END = '<!-- seo:end -->';

function metaTags({ title, description, canonical, type, image, imageAlt, extra = [] }) {
  return [
    `<title>${attr(title)}</title>`,
    `<meta name="description" content="${attr(description)}">`,
    `<link rel="canonical" href="${attr(canonical)}">`,
    `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">`,
    `<meta property="og:site_name" content="${attr(SITE.name)}">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:title" content="${attr(title)}">`,
    `<meta property="og:description" content="${attr(description)}">`,
    `<meta property="og:url" content="${attr(canonical)}">`,
    `<meta property="og:image" content="${attr(image)}">`,
    ...(imageAlt ? [`<meta property="og:image:alt" content="${attr(imageAlt)}">`] : []),
    `<meta property="og:locale" content="en_IN">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${attr(title)}">`,
    `<meta name="twitter:description" content="${attr(description)}">`,
    `<meta name="twitter:image" content="${attr(image)}">`,
    ...extra,
  ];
}

const ORG_ID = CANON + '/#organization';
const SITE_ID = CANON + '/#website';
export function organization() {
  return {
    '@type': 'NewsMediaOrganization', '@id': ORG_ID, name: SITE.name, url: CANON + '/',
    logo: { '@type': 'ImageObject', url: CANON + SITE.logo, width: 256, height: 256 },
    sameAs: SITE.sameAs,
    publishingPrinciples: CANON + '/about.html', actionableFeedbackPolicy: CANON + '/contact.html',
    correctionsPolicy: CANON + '/corrections.html',
  };
}
const website = () => ({ '@type': 'WebSite', '@id': SITE_ID, name: SITE.name, url: CANON + '/', inLanguage: 'en-IN', publisher: { '@id': ORG_ID } });

export function editionHead(ed, { times = {} } = {}) {
  const url = `${CANON}/archive/${ed.date}.html`;
  const lead = ed.lanes[0].stories[0].headline;
  const when = shortDate(ed.date);
  const title = `${clip(lead, 72)} · ${SITE.name}, ${when}`;
  const summary = `${ed.number ? `Edition ${ed.number}, ` : ''}${when}. ` + ed.lanes.map((l) => `${l.label}: ${l.stories[0].headline}.`).join(' ');
  const description = clip(summary, 200);                                    // what a results page shows; the JSON-LD keeps more
  const params = { type: 'edition', n: String(ed.number || ''), d: ed.date };
  for (const l of ed.lanes) params[l.id] = clip(l.takeaway || l.headline, 140);
  const image = `${CANON}/api/og?${new URLSearchParams(params)}`;
  const at = published(ed.date, times);
  const stories = ed.lanes.flatMap((l) => l.stories);
  const fixed = stories.flatMap((s) => s.corrections.map((c) => c.date)).sort().pop();
  const modified = fixed && fixed > ed.date ? fixed : at;                         // a corrected edition shows Google its update date
  const article = {
    '@type': 'NewsArticle', '@id': url + '#article', url, mainEntityOfPage: url,
    headline: clip(`${SITE.name}, ${when}: ${lead}`, 110),
    alternativeHeadline: ed.number ? `Edition ${ed.number}` : undefined,
    description: clip(summary, 500), datePublished: at, dateModified: modified, inLanguage: 'en-IN', isAccessibleForFree: true,
    image: [image], articleSection: ed.lanes.map((l) => l.label),
    keywords: ['AI news', 'technology news', 'India business news', 'Indian stock market', 'Sensex', 'Nifty', 'daily news brief'],
    author: { '@id': ORG_ID }, publisher: { '@id': ORG_ID }, isPartOf: { '@id': SITE_ID },
    abstract: ed.lanes.map((l) => `${l.label}: ${l.takeaway || l.headline}`).join(' '),
    hasPart: stories.map((s) => ({ '@type': 'NewsArticle', headline: clip(s.headline, 110), url: `${url}#${s.id}`, isBasedOn: s.source || undefined })),
    citation: stories.filter((s) => s.source).map((s) => ({ '@type': 'CreativeWork', url: s.source, name: s.headline, publisher: s.sourceName ? { '@type': 'Organization', name: s.sourceName } : undefined })),
    speakable: { '@type': 'SpeakableSpecification', cssSelector: ['.lane-head h2', '.lane-takeaway'] },
  };
  const crumbs = { '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: SITE.name, item: CANON + '/' },
    { '@type': 'ListItem', position: 2, name: 'Past editions', item: CANON + '/archive/' },
    { '@type': 'ListItem', position: 3, name: `${ed.number ? `Edition ${ed.number}, ` : ''}${when}`, item: url },
  ] };
  return [
    ...metaTags({ title, description, canonical: url, type: 'article', image, imageAlt: `${SITE.name}, ${when}`, extra: [
      `<meta property="article:published_time" content="${at}">`,
      `<meta property="article:modified_time" content="${modified}">`,
      ...ed.lanes.map((l) => `<meta property="article:section" content="${attr(l.label)}">`),
    ] }),
    `<script type="application/ld+json">${json({ '@context': 'https://schema.org', '@graph': [article, crumbs, organization(), website()] })}</script>`,
  ];
}

export function homeHead() {
  const canonical = CANON + '/';
  return [
    ...metaTags({ title: SITE.homeTitle, description: SITE.homeDescription, canonical, type: 'website', image: CANON + SITE.ogImage }),
    ...SITE.verification.map(([name, content]) => `<meta name="${attr(name)}" content="${attr(content)}">`),
    `<link rel="alternate" type="application/rss+xml" title="${attr(SITE.name)} podcast" href="${CANON}/podcast.xml">`,
    `<script type="application/ld+json">${json({ '@context': 'https://schema.org', '@graph': [website(), organization()] })}</script>`,
  ];
}

// Other pages keep their own title and description; they gain a canonical link and complete social tags.
export function pageHead(html, rel) {
  const title = text((/<title>([\s\S]*?)<\/title>/.exec(html) || [])[1]) || SITE.name;
  const description = (/<meta name="description" content="([^"]*)"/.exec(html) || [])[1];
  const image = (/<meta property="og:image" content="([^"]+)"/.exec(html) || [])[1] || CANON + SITE.ogImage;
  return metaTags({ title, description: description ? text(description) : SITE.homeDescription, canonical: urlFor(rel), type: 'website', image });
}

// Replaces the page's own title/description/social/canonical tags (or an earlier generated block) with `lines`.
export function stampHead(html, lines) {
  const headEnd = html.indexOf('</head>');
  if (headEnd < 0) return html;
  // Only the <head> is touched. The block goes where an earlier block was (a page copied from a stamped one), else where
  // <title> was, else after the viewport tag; the page's own title/description/social/canonical tags are then removed.
  const MARK = '\u0000seo\u0000';
  let head = html.slice(0, headEnd);
  const b = head.indexOf(BEGIN), e = b >= 0 ? head.indexOf(END, b) : -1;
  if (b >= 0 && e > b) head = head.slice(0, b) + MARK + head.slice(e + END.length).replace(/^\n/, '');
  else if (/<title>/.test(head)) head = head.replace(/<title>[\s\S]*?<\/title>[ \t]*\n?/, MARK);
  else if (/<meta name="viewport"[^>]*>/.test(head)) head = head.replace(/<meta name="viewport"[^>]*>[ \t]*\n?/, (m) => m.replace(/\n?$/, '\n') + MARK);
  else head += MARK;
  head = head
    .replace(/[ \t]*<title>[\s\S]*?<\/title>[ \t]*\n?/g, '')
    .replace(/[ \t]*<meta (?:name|property)="(?:description|og:[^"]+|twitter:[^"]+|article:[^"]+)"[^>]*>[ \t]*\n?/g, '')
    .replace(/[ \t]*<link rel="canonical"[^>]*>[ \t]*\n?/g, '');
  return head.replace(MARK, [BEGIN, ...lines, END].join('\n') + '\n') + html.slice(headEnd);
}

export const noindex = (html) => /<meta name="robots"/.test(html) ? html : html.replace(/<head>\s*\n?/, (m) => `${m}<meta name="robots" content="noindex, nofollow">\n`);

// ---- site files ----
export function sitemap(editions, { times = {}, now = new Date() } = {}) {
  const twoDays = now.getTime() - 2 * 864e5;
  const newest = editions.length ? published(editions[editions.length - 1].date, times) : now.toISOString();
  const url = (loc, lastmod, extra = '') => `  <url><loc>${xml(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}${extra}</url>`;
  const rows = [url(CANON + '/', newest), url(CANON + '/archive/', newest)];
  for (const ed of [...editions].reverse()) {
    const at = published(ed.date, times);
    const news = Date.parse(at) >= twoDays ? `<news:news><news:publication><news:name>${xml(SITE.name)}</news:name><news:language>en</news:language></news:publication><news:publication_date>${at}</news:publication_date><news:title>${xml(clip(`${SITE.name}, ${shortDate(ed.date)}: ${ed.lead}`, 110))}</news:title></news:news>` : '';
    rows.push(url(`${CANON}/archive/${ed.date}.html`, at, news));
  }
  for (const p of PAGES.filter((p) => p !== 'archive/index.html')) rows.push(url(urlFor(p)));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- rewritten on every deploy by tools/seo/build.mjs (the copy in git is only a starting point) -->\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n${rows.join('\n')}\n</urlset>\n`;
}

export function robots() {
  return `# Rewritten on every deploy by tools/seo/build.mjs; the copy in git is only a starting point.
# The Hour Brief. Search engines and AI assistants (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended and
# others) are all welcome to read and cite the editions. Only internal working files are kept out.
User-agent: *
Allow: /
Allow: /api/og
Disallow: /api/
Disallow: /tools/
Disallow: /mobile/
Disallow: /social/
Disallow: /leaders-pending/
Disallow: /.github/
Disallow: /share-kit.html
Disallow: /growth.html
Disallow: /DEPLOY.md
Disallow: /e/
Disallow: /s/
Disallow: /q/
Disallow: /l/

Sitemap: ${CANON}/sitemap.xml
`;
}

// llms.txt (llmstxt.org): a plain summary for AI assistants of what the site is, how it is made, and where everything is.
export function llms(editions, latest) {
  const recent = [...editions].reverse().slice(0, 30);
  const lines = [
    `# ${SITE.name}`, '',
    `> A free daily news brief, published every morning in India: what moved in AI and technology, product and business in India and around the world, and what the Indian stock market (Sensex, Nifty) did and why. Every story links to its original source.`, '',
    `How it is made: an automated AI agent researches and writes each edition on a daily schedule, directed by one person (Milind); nobody approves an edition before it publishes. Since ${shortDate(REVIEW_START)}, Milind reads each edition's Stock Market section after it publishes and fixes errors; fixes are noted on the story ("Corrected") and listed at ${CANON}/corrections.html. The AI & Tech and Product & Business sections are not reviewed daily. Each story is a short summary of public reporting plus a one-line "Takeaway" (the implication), with a link to the original source. Nothing here is investment advice. When citing a fact, prefer the original source linked from the story.`, '',
    `Each edition lives at ${CANON}/archive/YYYY-MM-DD.html and is grouped into three sections: AI & Tech, Product & Business, Stock Market. Story anchors are #ai-1, #biz-2, #mkt-3 and so on.`, '',
  ];
  if (latest) {
    lines.push(`## Latest edition: ${latest.number ? `Edition ${latest.number}, ` : ''}${shortDate(latest.date)}`, '');
    for (const l of latest.lanes) {
      lines.push(`### ${l.label}`, '');
      if (l.takeaway) lines.push(`Takeaway: ${l.takeaway}`, '');
      for (const s of l.stories) lines.push(`- [${s.headline}](${CANON}/archive/${latest.date}.html#${s.id})${s.source ? `: source ${s.sourceName ? `${s.sourceName}, ` : ''}${s.source}` : ''}`);
      lines.push('');
    }
  }
  lines.push('## Recent editions', '');
  for (const e of recent) lines.push(`- [${e.number ? `Edition ${e.number}, ` : ''}${shortDate(e.date)}](${CANON}/archive/${e.date}.html): ${[e.ai, e.biz, e.mkt].filter(Boolean).join(' / ')}`);
  lines.push('', '## About and feeds', '',
    `- [How this is made](${CANON}/about.html): sources, process and limits`,
    `- [All past editions](${CANON}/archive/)`,
    `- [RSS feed of editions](${CANON}/feed.xml)`,
    `- [Podcast feed](${CANON}/podcast.xml): each edition read aloud in about seven minutes, AI-generated voice; also on [Spotify](https://open.spotify.com/show/1FjOE5ABaOEzUTxwJeaoYr) and [Amazon Music](https://music.amazon.com/podcasts/191ea61e-41ab-4d99-aa47-012a56027de9/the-hour-brief)`,
    `- Daily channels with each morning's brief: [WhatsApp](https://whatsapp.com/channel/0029Vb9RU0kCXC3F1pRY6q2L) and [Telegram](https://t.me/thehourbrief)`,
    `- [Edition index as JSON](${CANON}/editions.json)`,
    `- [Contact](${CANON}/contact.html)`, '');
  return lines.join('\n');
}

// The public corrections log, built from the notes on the pages so it can never disagree with them. It borrows the About
// page's head (styles, icons, analytics) and masthead.
export function correctionsPage(aboutHtml, editions) {
  const head = aboutHtml.slice(0, aboutHtml.indexOf('</head>'));
  const mast = (/<div class="masthead-band">[\s\S]*?\n<\/div>\n/.exec(aboutHtml) || [''])[0];
  if (!head || !mast) throw new Error('about.html has changed shape; corrections.html left as it is');
  const rows = editions.flatMap((ed) => ed.lanes.flatMap((l) => l.stories.flatMap((s) => s.corrections.map((c) => ({ ...c, ed, lane: l, story: s })))))
    .sort((a, b) => (a.date === b.date ? (a.ed.date < b.ed.date ? 1 : -1) : a.date < b.date ? 1 : -1));
  const e = (x) => attr(x);
  const list = rows.length ? `<ul class="corrections">\n${rows.map((r) => `    <li><p class="when">Corrected ${shortDate(r.date)} · ${r.ed.number ? `Edition ${r.ed.number}, ` : ''}${shortDate(r.ed.date)} · ${e(r.lane.label)}</p>
      <p class="story"><a href="/archive/${r.ed.date}.html#${e(r.story.id)}">${e(r.story.headline)}</a></p>
      <p>${e(r.note)}</p></li>`).join('\n')}\n  </ul>`
    : `<p class="empty">No corrections yet.</p>`;
  return head
    .replace(/<title>[\s\S]*?<\/title>/, '<title>Corrections — The Hour Brief</title>')
    .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="Every correction made to The Hour Brief after publishing: what was wrong, what changed and when.">')
    + `<style>
  .corrections { list-style: none; padding: 0; margin: 0; }
  .corrections li { border-top: 1px solid var(--line, #ddd); padding: 16px 0; }
  .corrections p { margin: 4px 0; line-height: 1.55; }
  .corrections .when { font-size: 0.8rem; color: var(--ink-faint, #777); letter-spacing: 0.02em; }
  .corrections .story a { font-weight: 600; color: var(--ink, inherit); }
  .empty { color: var(--ink-soft, #555); }
</style>
</head>
<body>
<!-- Written on every deploy by tools/seo/build.mjs from the "Corrected" notes on edition pages; edit those, not this file. -->

${mast}
<div class="page">
  <h1>Corrections</h1>
  <p class="lede">Each edition is written and published automatically every morning. Since ${shortDate(REVIEW_START)}, Milind reads the Stock Market section of every edition after it publishes and fixes anything wrong. Every fix stays visible on the story as a dated &ldquo;Corrected&rdquo; note and is listed here, newest first. Spotted something wrong? Tell us from the <a href="/contact.html">contact page</a>.</p>
  ${list}
  <footer class="colophon">
    <a href="/about.html">How this is made</a> · <a href="/">Today's edition</a> · <a href="/archive/">Past editions</a> · <a href="/contact.html">Contact us</a>
  </footer>
</div>
</body>
</html>
`;
}

// ---- run ----
export function build(root, { log = console.log, now = new Date() } = {}) {
  const read = (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return ''; } };
  const write = (rel, s) => fs.writeFileSync(path.join(root, rel), s);
  const times = feedTimes(read('feed.xml'));
  let index = [];
  try { index = JSON.parse(read('editions.json')).editions || []; } catch { log('seo: editions.json unreadable; using archive/ only'); }
  const heads = Object.fromEntries(index.map((e) => [e.date, e]));
  const editions = [], full = [];
  let latest = null, done = 0, skipped = 0;

  const files = fs.readdirSync(path.join(root, 'archive')).filter((f) => /^\d{4}-\d{2}-\d{2}\.html$/.test(f)).sort();
  for (const f of files) {
    const rel = `archive/${f}`;
    try {
      const html = read(rel), ed = readEdition(html);
      if (ed.date !== f.slice(0, 10) || !ed.lanes.length) { skipped++; log(`seo: skipped ${rel} (no edition date or stories found)`); continue; }
      write(rel, stampHead(html, editionHead(ed, { times })));
      const h = heads[ed.date] || {};
      editions.push({ date: ed.date, number: ed.number, lead: ed.lanes[0].stories[0].headline, ai: h.headline_ai, biz: h.headline_biz, mkt: h.headline_mkt });
      full.push(ed); latest = ed; done++;
    } catch (e) { skipped++; log(`seo: skipped ${rel}: ${e.message}`); }
  }
  try {
    const html = read('index.html'), ed = readEdition(html);
    write('index.html', stampHead(html, homeHead()));
    if (ed.date && ed.lanes.length && (!latest || ed.date >= latest.date)) latest = ed;
    done++;
  } catch (e) { log(`seo: skipped index.html: ${e.message}`); }
  try { write('corrections.html', correctionsPage(read('about.html'), full)); } catch (e) { log(`seo: corrections log not rebuilt: ${e.message}`); }
  for (const rel of PAGES) {
    try { const html = read(rel); if (html) { write(rel, stampHead(html, pageHead(html, rel))); done++; } } catch (e) { log(`seo: skipped ${rel}: ${e.message}`); }
  }
  for (const rel of NOINDEX) { const html = read(rel); if (html) write(rel, noindex(html)); }
  write('sitemap.xml', sitemap(editions, { times, now }));
  write('robots.txt', robots());
  write('llms.txt', llms(editions, latest));
  log(`seo: stamped ${done} pages (${editions.length} editions${skipped ? `, ${skipped} skipped` : ''}); wrote sitemap.xml, robots.txt, llms.txt`);
  return { done, skipped, editions: editions.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const repo = path.resolve(import.meta.dirname, '../..');
    const i = process.argv.indexOf('--out');
    let root = repo;
    if (i > 0) {
      root = path.resolve(process.argv[i + 1]);
      fs.mkdirSync(path.join(root, 'archive'), { recursive: true });
      for (const f of ['index.html', 'feed.xml', 'editions.json', ...PAGES, ...NOINDEX]) if (fs.existsSync(path.join(repo, f))) fs.copyFileSync(path.join(repo, f), path.join(root, f));
      for (const f of fs.readdirSync(path.join(repo, 'archive'))) fs.copyFileSync(path.join(repo, 'archive', f), path.join(root, 'archive', f));
    } else if (!process.env.VERCEL) {
      console.error('Refusing to edit the repository in place: pass --out DIR (on Vercel, VERCEL=1 edits the deploy copy).');
      process.exit(2);
    }
    build(root);
  } catch (e) {
    console.error('seo: build step failed, deploying the pages unchanged:', e);   // never block a deploy over SEO
  }
}
