// Thought Leaders digest: weekly roundup articles from tracked creators (blogs/
// newsletters via RSS, YouTube via youtube-transcript.io), optionally written in a
// reference author's voice (styles/<slug>.md). Runs on Vercel Cron (full outbound
// network access) — NOT a Claude Code cloud routine, which was proven unable to
// reach youtube.com or Redis from its sandbox (see podcast highlights' history).
//   GET                              -> serve generated roundups to the frontend
//   GET/POST with Authorization: Bearer $CRON_SECRET -> run ingestion (Vercel Cron)
// Env: KV_REST_API_URL/TOKEN, YTT_IO_API_TOKEN, ANTHROPIC_API_KEY, CRON_SECRET.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const YTT_IO_API_TOKEN = process.env.YTT_IO_API_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TIME_BUDGET_MS = 50000;
const CATEGORIES = ['business', 'tech', 'ai', 'product', 'finance'];
const CONFIG_PATH = path.join(__dirname, '..', 'leaders.config.json');
const STYLES_DIR = path.join(__dirname, '..', 'styles');

async function kv(command) {
  const p = command.map((c) => encodeURIComponent(c)).join('/');
  const res = await fetch(`${KV_URL}/${p}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  return (await res.json()).result;
}

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(String(req.headers.authorization || ''));
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

// ---- RSS/Atom parsing (handles both item-style and entry-style feeds) ----
function parseFeed(xml) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/g) || [];
  return blocks.map((b) => {
    const title = (b.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '';
    const linkHref = (b.match(/<link[^>]*\bhref="([^"]+)"/) || [])[1];
    const linkText = (b.match(/<link[^>]*>([^<]+)<\/link>/) || [])[1];
    const link = (linkHref || linkText || '').trim();
    const date = (b.match(/<pubDate>([^<]+)<\/pubDate>/) || b.match(/<published>([^<]+)<\/published>/) || [])[1] || '';
    const guid = (b.match(/<guid[^>]*>([^<]+)<\/guid>/) || b.match(/<id>([^<]+)<\/id>/) || [])[1] || link;
    const videoId = (b.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    return {
      title: decodeEntities(title.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim()),
      link,
      date,
      guid: videoId || guid,
      videoId,
    };
  }).filter((e) => e.title && (e.link || e.videoId));
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// ---- Best-effort article text extraction from a blog post's HTML ----
function extractArticleText(html) {
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');
  const main = body.match(/<article\b[\s\S]*?<\/article>/i) || body.match(/<main\b[\s\S]*?<\/main>/i);
  if (main) body = main[0];
  const text = body
    .replace(/<\/(p|div|h[1-6]|li|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return decodeEntities(text);
}

// ---- youtube-transcript.io: batched transcript fetch ----
async function fetchTranscripts(videoIds) {
  const out = {};
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    try {
      const r = await fetch('https://www.youtube-transcript.io/api/transcripts', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${YTT_IO_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: batch }),
      });
      const data = await r.json();
      // Confirmed shape (live-tested): a plain array, each item {id, text, tracks: [{transcript:[{text,...}]}], ...}.
      // `text` is already the pre-joined plain transcript; `tracks[0].transcript` segments are a fallback only.
      const items = Array.isArray(data) ? data : [];
      items.forEach((item) => {
        const id = item.id;
        let text = item.text;
        if (!text && Array.isArray(item.tracks) && item.tracks[0] && Array.isArray(item.tracks[0].transcript)) {
          text = item.tracks[0].transcript.map((s) => s.text || '').join(' ');
        }
        if (id && text) out[id] = String(text).trim();
      });
    } catch (e) {
      // leave this batch's videos absent from `out`; caller treats as unavailable
    }
    if (i + 50 < videoIds.length) await new Promise((r) => setTimeout(r, 2200)); // stay under 5 req/10s
  }
  return out;
}

function loadStyleGuide(slug) {
  if (!slug) return null;
  try {
    return fs.readFileSync(path.join(STYLES_DIR, `${slug}.md`), 'utf8');
  } catch (e) {
    return null;
  }
}

async function writeRoundup(category, styleSlug, items) {
  const styleGuide = loadStyleGuide(styleSlug);
  const sourceBlock = items.map((it, i) => (
    `[Source ${i + 1}] ${it.creator} — "${it.title}"\n${(it.content || '').slice(0, 8000)}`
  )).join('\n\n---\n\n');

  const styleInstruction = styleGuide
    ? `Write this in the voice described by the following style guide. Match its tone, sentence rhythm and recurring devices — don't just mention the author, actually write like them:\n\n${styleGuide}\n\n`
    : 'Write in a clear, direct editorial voice — no particular author\'s style.';

  const prompt = (
    `You're writing a weekly roundup article for "${category}" thought leaders, synthesizing the ` +
    `items below (posts/videos from tracked creators this week) into one coherent piece — not a ` +
    `list of summaries, an actual article with a point of view that pulls the week's most ` +
    `substantive ideas together. 600-900 words. ${styleInstruction}\n\n` +
    `Respond with ONLY valid JSON, no markdown fences: {"title": "...", "body": "..."} ` +
    `(body as plain text with \\n\\n paragraph breaks).\n\nSources:\n\n${sourceBlock}`
  );

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-5-5',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  let text = ((data.content && data.content[0] && data.content[0].text) || '').trim();
  text = text.replace(/^```(json)?|```$/gm, '').trim();
  try {
    const parsed = JSON.parse(text);
    if (parsed.title && parsed.body) return parsed;
  } catch (e) { /* fall through */ }
  return null;
}

async function runIngestion() {
  const start = Date.now();
  const { creators } = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const report = { creatorsChecked: 0, newItems: 0, articlesWritten: 0, errors: [] };
  const byCategory = {};

  for (const creator of creators) {
    if (Date.now() - start > TIME_BUDGET_MS) { report.errors.push('time budget hit before finishing all creators'); break; }
    report.creatorsChecked += 1;
    try {
      let entries = [];
      if (creator.sourceType === 'youtube') {
        const xml = await (await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${creator.source}`)).text();
        entries = parseFeed(xml).slice(0, 5);
      } else if (creator.sourceType === 'rss') {
        const xml = await (await fetch(creator.source)).text();
        entries = parseFeed(xml).slice(0, 5);
      }

      const fresh = [];
      for (const e of entries) {
        const already = await kv(['SISMEMBER', `leader:seen:${creator.source}`, e.guid]);
        if (already !== 1) fresh.push(e);
      }
      if (!fresh.length) continue;

      if (creator.sourceType === 'youtube') {
        const transcripts = await fetchTranscripts(fresh.map((e) => e.videoId));
        for (const e of fresh) {
          const content = transcripts[e.videoId];
          await kv(['SADD', `leader:seen:${creator.source}`, e.guid]); // attempted once either way
          if (!content) continue;
          report.newItems += 1;
          (byCategory[creator.category] = byCategory[creator.category] || []).push({
            creator: creator.name, title: e.title, content, styleAuthor: creator.styleAuthor,
          });
        }
      } else {
        for (const e of fresh) {
          let content = '';
          try {
            const html = await (await fetch(e.link)).text();
            content = extractArticleText(html);
          } catch (err) { /* leave empty, skip below */ }
          await kv(['SADD', `leader:seen:${creator.source}`, e.guid]);
          if (!content || content.length < 300) continue;
          report.newItems += 1;
          (byCategory[creator.category] = byCategory[creator.category] || []).push({
            creator: creator.name, title: e.title, content, styleAuthor: creator.styleAuthor,
          });
        }
      }
    } catch (e) {
      report.errors.push(`${creator.name}: ${e.message}`);
    }
  }

  for (const category of CATEGORIES) {
    const items = byCategory[category];
    if (!items || !items.length) continue;
    if (Date.now() - start > TIME_BUDGET_MS) { report.errors.push(`skipped writing ${category} roundup — time budget`); continue; }
    const styleSlug = (items.find((it) => it.styleAuthor) || {}).styleAuthor;
    const article = await writeRoundup(category, styleSlug, items);
    if (!article) { report.errors.push(`${category}: roundup generation failed`); continue; }

    const id = `${category}-${new Date().toISOString().slice(0, 10)}`;
    await kv(['HSET', `leader:brief:${id}`,
      'category', category, 'styleAuthor', styleSlug || '', 'title', article.title,
      'body', article.body, 'generatedAt', new Date().toISOString(),
      'sources', JSON.stringify(items.map((it) => ({ creator: it.creator, title: it.title })))]);
    await kv(['ZADD', 'leader:briefs', String(Date.now()), id]);
    report.articlesWritten += 1;
  }

  await kv(['ZREMRANGEBYRANK', 'leader:briefs', '0', '-101']);
  report.durationMs = Date.now() - start;
  return report;
}

async function readBriefs(limit) {
  const ids = (await kv(['ZREVRANGE', 'leader:briefs', '0', String(limit - 1)])) || [];
  const briefs = [];
  for (const id of ids) {
    const flat = (await kv(['HGETALL', `leader:brief:${id}`])) || [];
    const h = {};
    for (let i = 0; i + 1 < flat.length; i += 2) h[flat[i]] = flat[i + 1];
    if (!h.title) continue;
    let sources = [];
    try { sources = JSON.parse(h.sources || '[]'); } catch (e) { sources = []; }
    briefs.push({
      id, category: h.category || '', styleAuthor: h.styleAuthor || '', title: h.title,
      body: h.body || '', generatedAt: h.generatedAt || '', sources,
    });
  }
  return briefs;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (!KV_URL || !KV_TOKEN) { res.status(500).json({ error: 'storage not configured' }); return; }

  if (authorized(req)) {
    if (!ANTHROPIC_API_KEY || !YTT_IO_API_TOKEN) {
      res.status(500).json({ error: 'ANTHROPIC_API_KEY or YTT_IO_API_TOKEN not configured' });
      return;
    }
    try {
      const report = await runIngestion();
      res.status(200).json({ ok: true, ...report });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
    return;
  }

  const limit = Math.min(parseInt((req.query || {}).limit, 10) || 20, 50);
  const briefs = await readBriefs(limit);
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.status(200).json({ briefs });
};
