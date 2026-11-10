// Thought Leaders digest, fetch half. Runs on Vercel Cron (full outbound network
// access) — NOT a Claude Code cloud routine, which was proven unable to reach
// youtube.com, arbitrary blog hosts, or Redis from its sandbox (both raw `curl`
// and the `WebFetch` tool got `ENOTFOUND` there; only `WebSearch` and git work).
//
// So the writing half lives in a separate Claude Code routine instead of an
// Anthropic API key: this endpoint only fetches raw material (RSS + full YouTube
// transcripts via youtube-transcript.io, full blog text) and commits it to the
// repo as a "pending" file via the GitHub Contents API. The routine, on its own
// schedule, reads pending files from its git checkout (that works), writes each
// category's roundup in the relevant styles/<slug>.md voice, and commits the
// result straight to leaders-data.json — the same way daily editions already
// publish. leaders.html reads that static file directly; there is no read path
// here and no Anthropic key anywhere in this flow.
//   (no GET read path — see leaders-data.json)
//   GET/POST with Authorization: Bearer $CRON_SECRET -> fetch + commit pending (Vercel Cron)
// Env: KV_REST_API_URL/TOKEN (seen-tracking only), YTT_IO_API_TOKEN, GH_COMMIT_TOKEN, CRON_SECRET.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const YTT_IO_API_TOKEN = process.env.YTT_IO_API_TOKEN;
const GH_COMMIT_TOKEN = process.env.GH_COMMIT_TOKEN;
const GH_REPO = 'Milindroy699/the-hour-brief';
const TIME_BUDGET_MS = 50000;
const CONFIG_PATH = path.join(__dirname, '..', 'leaders.config.json');

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

// ---- GitHub Contents API: commit the collected pending file ----
async function commitPending(categories) {
  const body = {
    generatedAt: new Date().toISOString(),
    categories,
  };
  const pathInRepo = `leaders-pending/${Date.now()}.json`;
  const res = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${pathInRepo}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GH_COMMIT_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `Thought Leaders: collected raw material for ${Object.keys(categories).join(', ')}`,
      content: Buffer.from(JSON.stringify(body, null, 2)).toString('base64'),
      branch: 'main',
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`GitHub commit failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return pathInRepo;
}

async function runFetch() {
  const start = Date.now();
  const { creators } = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const report = { creatorsChecked: 0, newItems: 0, errors: [] };
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
            creator: creator.name, title: e.title, url: e.link || `https://www.youtube.com/watch?v=${e.videoId}`,
            publishedAt: e.date, content, styleAuthor: creator.styleAuthor || null,
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
            creator: creator.name, title: e.title, url: e.link,
            publishedAt: e.date, content, styleAuthor: creator.styleAuthor || null,
          });
        }
      }
    } catch (e) {
      report.errors.push(`${creator.name}: ${e.message}`);
    }
  }

  if (Object.keys(byCategory).length) {
    const committedPath = await commitPending(byCategory);
    report.committed = committedPath;
  } else {
    report.committed = null;
  }

  report.durationMs = Date.now() - start;
  return report;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (!authorized(req)) { res.status(401).json({ error: 'unauthorized' }); return; }
  if (!KV_URL || !KV_TOKEN) { res.status(500).json({ error: 'storage not configured' }); return; }
  if (!YTT_IO_API_TOKEN || !GH_COMMIT_TOKEN) {
    res.status(500).json({ error: 'YTT_IO_API_TOKEN or GH_COMMIT_TOKEN not configured' });
    return;
  }
  try {
    const report = await runFetch();
    res.status(200).json({ ok: true, ...report });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
