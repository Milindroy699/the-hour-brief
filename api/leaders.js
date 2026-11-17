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
// Env: KV_REST_API_URL/TOKEN (seen-tracking only), YTT_IO_API_TOKEN (+ optional YTT_IO_API_TOKEN_2, _3, …),
// GH_COMMIT_TOKEN, CRON_SECRET.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const GH_COMMIT_TOKEN = process.env.GH_COMMIT_TOKEN;
const GH_REPO = 'Milindroy699/the-hour-brief';
const TIME_BUDGET_MS = 50000;
const CONFIG_PATH = path.join(__dirname, '..', 'leaders.config.json');
// youtube-transcript.io's free plan is 25 transcripts a month, and the API doesn't report usage, so we count our own
// (one credit per video id requested). Raise YTT_MONTHLY_LIMIT in Vercel if the plan changes.
const YTT_MONTHLY_LIMIT = parseInt(process.env.YTT_MONTHLY_LIMIT, 10) || 25;
// One or more youtube-transcript.io accounts: YTT_IO_API_TOKEN, then YTT_IO_API_TOKEN_2, _3, … Each has its own
// YTT_MONTHLY_LIMIT and its own counter, and a run fills the first account with room before touching the next. The
// first account keeps the original counter key (leader:ytt:YYYY-MM) so its usage history carries over.
const YTT_ACCOUNTS = ['YTT_IO_API_TOKEN', ...Array.from({ length: 9 }, (_, i) => `YTT_IO_API_TOKEN_${i + 2}`)]
  .map((name, i) => ({ n: i + 1, token: String(process.env[name] || '').trim() }))
  .filter((a) => a.token);
function counterKey(account, month) { return account.n === 1 ? `leader:ytt:${month}` : `leader:ytt:${month}:k${account.n}`; }
const FETCH_TIMEOUT_MS = 15000;
const RUN_LOG_KEY = 'leader:runs';   // last 20 real runs, newest first — read them with ?dry=1
const LOCK_KEY = 'leader:lock';

async function kv(command) {
  const p = command.map((c) => encodeURIComponent(c)).join('/');
  const res = await fetch(`${KV_URL}/${p}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` }, signal: AbortSignal.timeout(10000) });
  return (await res.json()).result;
}

// Every outbound read gets a timeout and a status check. Without them a feed that errors parses as zero entries —
// indistinguishable from "nothing new this week" — and a hung request can eat the whole function duration. Either
// way the run used to end without a trace (the Nov 16, 2026 run left nothing behind to diagnose).
async function getText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
  return res.text();
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
    const categories = (b.match(/<category[^>]*>[\s\S]*?<\/category>/g) || [])
      .map((c) => decodeEntities(c.replace(/<\/?category[^>]*>/g, '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim()));
    return {
      title: decodeEntities(title.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim()),
      link,
      date,
      time: Date.parse(date) || 0,
      guid: videoId || guid,
      videoId,
      categories,
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
async function fetchTranscripts(videoIds, token) {
  const out = {};
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    try {
      const r = await fetch('https://www.youtube-transcript.io/api/transcripts', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: batch }),
        signal: AbortSignal.timeout(40000),
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
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`GitHub commit failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return pathInRepo;
}

// A creator's `source` is a YouTube channel id (UC…), a YouTube playlist id (PL…, for one show on a busy channel,
// e.g. The Circuit on Bloomberg), or — for sourceType "rss" — a feed URL.
// Channels are read through YouTube's auto-generated long-form-uploads playlist ("UULF" + the id after "UC"): newest
// first and no Shorts. The plain channel feed is the last 15 uploads of any kind, which for several of these channels
// is entirely Shorts — Nikhil Kamath's had no full episode in it at all.
function feedUrl(creator) {
  if (creator.sourceType !== 'youtube') return creator.source;
  const playlist = /^UC/.test(creator.source) ? `UULF${creator.source.slice(2)}` : creator.source;
  return `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlist)}`;
}

const MIN_TRANSCRIPT_CHARS = 1500; // below this it's a clip/short, not something worth a roundup slot
const MAX_CONTENT_CHARS = 80000; // ~2h of speech; keeps pending files and the writer's reading bounded

// Newest-first candidates for one creator this run. Feeds aren't reliably newest-first (playlist feeds follow
// playlist order — Intermission's is oldest-first), so sort by date. Only items newer than the newest one already
// ingested count: otherwise a quiet week would quietly backfill the channel's older videos into this week's roundup.
// A creator's first run has nothing seen yet, so it takes the latest `limit` (default 2) regardless of age.
async function candidates(creator) {
  const xml = await getText(feedUrl(creator));
  if (!/<(rss|feed)\b/.test(xml)) throw new Error('feed returned something that is not RSS/Atom');
  let entries = parseFeed(xml);
  if (creator.titleFilter) entries = entries.filter((e) => e.title.toLowerCase().includes(creator.titleFilter.toLowerCase()));
  if (creator.categoryFilter) entries = entries.filter((e) => e.categories.includes(creator.categoryFilter));
  // Shorts dominate several channels' feeds (all 15 of Nikhil Kamath's latest, at one point) and are never worth a slot.
  entries = entries.filter((e) => !/\/shorts\//.test(e.link) && !/#shorts?\b/i.test(e.title)).sort((a, b) => b.time - a.time);

  if (!entries.length) return [];
  const seen = (await kv(['SMISMEMBER', `leader:seen:${creator.source}`, ...entries.map((e) => e.guid)])) || [];
  let cutoff = 0;
  const unseen = [];
  entries.forEach((e, i) => {
    if (seen[i] === 1) cutoff = Math.max(cutoff, e.time);
    else unseen.push(e);
  });
  return unseen.filter((e) => !cutoff || e.time > cutoff).slice(0, creator.limit || 2);
}

// ---- Monthly transcript budget ----
// Spread what's left evenly over the Mondays remaining this month (UTC), so a month is never spent in its first week.
function mondaysLeft(now) {
  let n = 0;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (const m = d.getUTCMonth(); d.getUTCMonth() === m; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() === 1) n += 1;
  return Math.max(1, n);
}
// Monday has several cron slots (retries), so the share is fixed per day: a later slot only gets what an earlier one
// that same day left of the day's share, not a fresh share of its own. The budget is the sum over all accounts.
async function transcriptBudget() {
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const dayKey = `leader:ytt:${now.toISOString().slice(0, 10)}`;
  const accounts = [];
  for (const a of YTT_ACCOUNTS) {
    const used = parseInt(await kv(['GET', counterKey(a, month)]), 10) || 0;
    accounts.push({ account: a, counter: counterKey(a, month), used, remaining: Math.max(0, YTT_MONTHLY_LIMIT - used) });
  }
  const today = parseInt(await kv(['GET', dayKey]), 10) || 0;
  const used = accounts.reduce((n, a) => n + a.used, 0);
  const remaining = accounts.reduce((n, a) => n + a.remaining, 0);
  const share = Math.ceil((remaining + today) / mondaysLeft(now));
  return { accounts, dayKey, limit: YTT_MONTHLY_LIMIT * accounts.length, used, remaining, usedToday: today,
    thisRun: Math.max(0, Math.min(remaining, share - today)) };
}
// What a report may show: counts only, never the tokens.
function publicBudget(b) {
  return { limit: b.limit, used: b.used, remaining: b.remaining, usedToday: b.usedToday, thisRun: b.thisRun,
    accounts: b.accounts.map((a) => ({ account: a.account.n, used: a.used, limit: YTT_MONTHLY_LIMIT })) };
}
// When the budget is short, take one video per pillar before a second from any (newest first within a pillar), so
// every category keeps getting covered.
function pickByPillar(videos, n) {
  const groups = {};
  videos.forEach((v) => { (groups[v.creator.category] = groups[v.creator.category] || []).push(v); });
  Object.values(groups).forEach((g) => g.sort((a, b) => b.e.time - a.e.time));
  const picked = [];
  for (let round = 0; picked.length < n; round++) {
    const layer = Object.values(groups).map((g) => g[round]).filter(Boolean);
    if (!layer.length) break;
    picked.push(...layer.slice(0, n - picked.length));
  }
  return picked;
}

async function runFetch({ dry = false } = {}) {
  const start = Date.now();
  const { creators } = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const report = { creatorsChecked: 0, newItems: 0, skipped: [], errors: [] };
  if (dry) {
    report.wouldFetch = [];
    for (const creator of creators) {
      try {
        const fresh = await candidates(creator);
        report.wouldFetch.push({ creator: creator.name, category: creator.category,
          items: fresh.map((e) => ({ title: e.title, published: e.time ? new Date(e.time).toISOString() : e.date, url: e.link })) });
      } catch (e) { report.errors.push(`${creator.name}: ${e.message}`); }
    }
    report.transcriptBudget = publicBudget(await transcriptBudget());
    report.recentRuns = ((await kv(['LRANGE', RUN_LOG_KEY, '0', '9'])) || []).map((r) => { try { return JSON.parse(r); } catch (e) { return r; } });
    report.durationMs = Date.now() - start;
    return report;
  }
  const byCategory = {};
  const add = (creator, e, content) => {
    report.newItems += 1;
    (byCategory[creator.category] = byCategory[creator.category] || []).push({
      creator: creator.name, title: e.title, url: e.link || `https://www.youtube.com/watch?v=${e.videoId}`,
      publishedAt: e.time ? new Date(e.time).toISOString() : e.date,
      content: content.slice(0, MAX_CONTENT_CHARS), styleAuthor: creator.styleAuthor || null,
    });
  };
  // Items are only marked seen once this run's pending file is safely committed (or was attempted and judged not
  // worth a slot). If the commit fails, nothing is marked, so the next slot or run picks the same items up again.
  const attempted = [];
  const markAttempted = (creator, e) => attempted.push([creator.source, e.guid]);

  // Pass 1: find what's new per creator. YouTube transcripts are fetched afterwards in one batch, so several
  // channels don't each make their own request and trip youtube-transcript.io's 5-requests-per-10s limit.
  const videos = [];
  for (const creator of creators) {
    if (Date.now() - start > TIME_BUDGET_MS) { report.errors.push('time budget hit before finishing all creators'); break; }
    report.creatorsChecked += 1;
    try {
      const fresh = await candidates(creator);
      for (const e of fresh) {
        if (creator.sourceType === 'youtube') { videos.push({ creator, e }); continue; }
        let content = '';
        try { content = extractArticleText(await getText(e.link)); } catch (err) { report.errors.push(`${creator.name}: article fetch failed (${err.message})`); continue; }
        markAttempted(creator, e);
        if (content.length < 300) { report.skipped.push(`${creator.name}: "${e.title}" (no readable text)`); continue; }
        add(creator, e, content);
      }
    } catch (e) {
      report.errors.push(`${creator.name}: ${e.message}`);
    }
  }

  // Pass 2: transcripts in one batch, within this run's share of the monthly budget. Videos over budget are left
  // unseen, not marked done.
  if (videos.length) {
    const budget = await transcriptBudget();
    report.transcriptBudget = publicBudget(budget);
    const batch = pickByPillar(videos, budget.thisRun);
    videos.filter((v) => !batch.includes(v)).forEach(({ creator, e }) => {
      report.skipped.push(`${creator.name}: "${e.title}" (deferred: monthly transcript budget, ${budget.used}/${budget.limit} used)`);
    });
    // Fill the first account that has room, then the next. thisRun never exceeds the total remaining, so it all fits.
    const plan = [];
    let next = 0;
    for (const a of budget.accounts) {
      const take = batch.slice(next, next + a.remaining);
      if (take.length) plan.push({ a, take });
      next += take.length;
    }
    for (const { a, take } of plan) {
      await kv(['INCRBY', a.counter, String(take.length)]);
      await kv(['EXPIRE', a.counter, String(40 * 86400)]);
      report.transcriptBudget.accounts.find((x) => x.account === a.account.n).used += take.length;
    }
    if (batch.length) {
      await kv(['INCRBY', budget.dayKey, String(batch.length)]);
      await kv(['EXPIRE', budget.dayKey, String(2 * 86400)]);
      report.transcriptBudget.used += batch.length;
    }
    const transcripts = {};
    for (const { a, take } of plan) Object.assign(transcripts, await fetchTranscripts(take.map((v) => v.e.videoId), a.account.token));
    for (const { creator, e } of batch) {
      markAttempted(creator, e); // attempted once either way
      const content = transcripts[e.videoId] || '';
      if (content.length < MIN_TRANSCRIPT_CHARS) { report.skipped.push(`${creator.name}: "${e.title}" (${content ? 'too short' : 'no transcript'})`); continue; }
      add(creator, e, content);
    }
  }

  report.committed = null;
  let commitOk = true;
  if (Object.keys(byCategory).length) {
    try {
      report.committed = await commitPending(byCategory);
    } catch (e) {
      commitOk = false;
      report.errors.push(e.message);
    }
  }
  if (commitOk) for (const [source, guid] of attempted) await kv(['SADD', `leader:seen:${source}`, guid]);

  report.durationMs = Date.now() - start;
  return report;
}

// One line per real run (cron or manual), newest first, so a quiet Monday can be told apart from a run that never
// happened: Vercel Cron delivery is best effort, and a dropped delivery leaves no runtime log at all.
async function logRun(entry) {
  try {
    await kv(['LPUSH', RUN_LOG_KEY, JSON.stringify(entry)]);
    await kv(['LTRIM', RUN_LOG_KEY, '0', '19']);
  } catch (e) { /* logging must never fail the run */ }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (!authorized(req)) { res.status(401).json({ error: 'unauthorized' }); return; }
  if (!KV_URL || !KV_TOKEN) { res.status(500).json({ error: 'storage not configured' }); return; }
  if (!YTT_ACCOUNTS.length || !GH_COMMIT_TOKEN) {
    res.status(500).json({ error: 'YTT_IO_API_TOKEN or GH_COMMIT_TOKEN not configured' });
    return;
  }
  const dry = (req.query || {}).dry === '1';
  if (dry) {
    try { res.status(200).json({ ok: true, ...(await runFetch({ dry: true })) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    return;
  }

  // Monday has several cron slots, and Vercel can deliver one slot twice; the lock keeps two runs from committing the
  // same items. Each run is otherwise safe to repeat: it only takes what is still unseen.
  const schedule = req.headers['x-vercel-cron-schedule'];
  const trigger = schedule ? `cron ${schedule}` : 'manual';
  const at = new Date().toISOString();
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const locked = await kv(['SET', LOCK_KEY, runId, 'NX', 'EX', '300']);
  if (locked !== 'OK') {
    await logRun({ at, trigger, ok: true, skipped: 'another run was in progress' });
    res.status(200).json({ ok: true, skipped: 'another run is in progress' });
    return;
  }
  // Log and unlock before responding: work after the response is sent may never run on Vercel. (If unlocking fails,
  // the lock expires on its own after 5 minutes, well before the next slot.)
  let status = 200, body;
  try {
    const report = await runFetch();
    await logRun({ at, trigger, ok: !report.errors.length, newItems: report.newItems, committed: report.committed,
      transcripts: report.transcriptBudget ? `${report.transcriptBudget.used}/${report.transcriptBudget.limit}` : undefined,
      skipped: report.skipped.length, errors: report.errors.slice(0, 10), durationMs: report.durationMs });
    body = { ok: true, ...report };
  } catch (e) {
    await logRun({ at, trigger, ok: false, errors: [e.message] });
    status = 500;
    body = { ok: false, error: e.message };
  }
  try { if ((await kv(['GET', LOCK_KEY])) === runId) await kv(['DEL', LOCK_KEY]); } catch (e) { /* expires on its own */ }
  res.status(status).json(body);
};
