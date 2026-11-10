// Merges the comments and vote endpoints into one file — this project is on
// Vercel's Hobby plan, capped at 12 Serverless Functions per deployment, and
// api/leaders.js needs the slot this frees up. Old paths (/api/comments,
// /api/vote) still work via rewrites in vercel.json, so no caller changes.
const crypto = require('crypto');

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kv(command) {
  const path = command.map((c) => encodeURIComponent(c)).join('/');
  const res = await fetch(`${KV_URL}/${path}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  return res.json();
}

async function kvPipeline(commands) {
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  return res.json();
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? fwd.split(',')[0].trim() : req.socket && req.socket.remoteAddress) || 'unknown';
}

function num(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function comments(req, res) {
  if (req.method === 'GET') {
    const date = req.query && req.query.date;
    if (!date || !DATE_RE.test(date)) { res.status(400).json({ error: 'invalid date' }); return; }
    const listRes = await kv(['LRANGE', `comments:${date}`, '0', '199']);
    const items = (listRes.result || [])
      .map((s) => { try { return JSON.parse(s); } catch (e) { return null; } })
      .filter(Boolean);
    res.status(200).json({ comments: items });
    return;
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const date = body && body.date;
    if (!date || !DATE_RE.test(date)) { res.status(400).json({ error: 'invalid date' }); return; }

    let alias = ((body && body.alias) || '').toString().trim().slice(0, 40) || 'Anonymous';
    let text = ((body && body.text) || '').toString().trim().slice(0, 500);
    if (!text) { res.status(400).json({ error: 'empty comment' }); return; }

    const ip = clientIp(req);
    const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
    const rlKey = `commentrl:${ipHash}`;
    const rl = await kv(['INCR', rlKey]);
    const rlCount = parseInt(rl.result, 10) || 0;
    if (rlCount === 1) { await kv(['EXPIRE', rlKey, '3600']); }
    if (rlCount > 8) { res.status(429).json({ error: 'rate limited' }); return; }

    const entry = { alias: escapeHtml(alias), text: escapeHtml(text), ts: new Date().toISOString() };
    await kv(['RPUSH', `comments:${date}`, JSON.stringify(entry)]);
    await kv(['LTRIM', `comments:${date}`, '-500', '-1']);
    res.status(200).json({ ok: true, comment: entry });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
}

async function vote(req, res) {
  if (req.method === 'GET') {
    const raw = (req.query && req.query.ids) || '';
    const ids = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 60);
    if (!ids.length) { res.status(200).json({}); return; }
    const commands = [];
    ids.forEach((id) => {
      commands.push(['GET', `votes:like:${id}`]);
      commands.push(['GET', `votes:dislike:${id}`]);
    });
    const results = await kvPipeline(commands);
    const out = {};
    ids.forEach((id, i) => {
      out[id] = {
        like: num(results[i * 2] && results[i * 2].result),
        dislike: num(results[i * 2 + 1] && results[i * 2 + 1].result),
      };
    });
    res.status(200).json(out);
    return;
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const { id, type } = body || {};
    if (!id || typeof id !== 'string' || (type !== 'like' && type !== 'dislike')) {
      res.status(400).json({ error: 'invalid request' });
      return;
    }
    const safeId = id.slice(0, 120);
    const ip = clientIp(req);
    const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
    const dedupeKey = `voted:${safeId}:${ipHash}`;

    const setResult = await kv(['SET', dedupeKey, '1', 'EX', '86400', 'NX']);
    if (setResult.result === null) {
      const counts = await kvPipeline([
        ['GET', `votes:like:${safeId}`],
        ['GET', `votes:dislike:${safeId}`],
      ]);
      res.status(200).json({
        ok: false,
        reason: 'already_voted',
        like: num(counts[0] && counts[0].result),
        dislike: num(counts[1] && counts[1].result),
      });
      return;
    }

    const incrResult = await kv(['INCR', `votes:${type}:${safeId}`]);
    const otherType = type === 'like' ? 'dislike' : 'like';
    const otherResult = await kv(['GET', `votes:${otherType}:${safeId}`]);
    const newCount = num(incrResult.result);
    const otherCount = num(otherResult.result);
    res.status(200).json({
      ok: true,
      like: type === 'like' ? newCount : otherCount,
      dislike: type === 'dislike' ? newCount : otherCount,
    });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
}

// ---- Thought Leaders: likes, views, comments per article id ----
// Same patterns as the daily edition's votes/comments above, just keyed by article
// id instead of date — articles don't need a dislike button or a date namespace.
async function leaderStats(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'method not allowed' }); return; }
  const raw = (req.query && req.query.ids) || '';
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 60);
  if (!ids.length) { res.status(200).json({}); return; }
  const commands = [];
  ids.forEach((id) => {
    commands.push(['GET', `leader:likes:${id}`]);
    commands.push(['GET', `leader:views:${id}`]);
    commands.push(['LLEN', `leader:comments:${id}`]);
  });
  const results = await kvPipeline(commands);
  const out = {};
  ids.forEach((id, i) => {
    out[id] = {
      likes: num(results[i * 3] && results[i * 3].result),
      views: num(results[i * 3 + 1] && results[i * 3 + 1].result),
      comments: num(results[i * 3 + 2] && results[i * 3 + 2].result),
    };
  });
  res.status(200).json(out);
}

async function leaderLike(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const id = body && typeof body.id === 'string' && body.id.slice(0, 120);
  if (!id) { res.status(400).json({ error: 'invalid request' }); return; }

  const ip = clientIp(req);
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
  const dedupeKey = `likedleader:${id}:${ipHash}`;
  const setResult = await kv(['SET', dedupeKey, '1', 'EX', '86400', 'NX']);
  if (setResult.result === null) {
    const likes = await kv(['GET', `leader:likes:${id}`]);
    res.status(200).json({ ok: false, reason: 'already_liked', likes: num(likes.result) });
    return;
  }
  const incr = await kv(['INCR', `leader:likes:${id}`]);
  res.status(200).json({ ok: true, likes: num(incr.result) });
}

async function leaderView(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const id = body && typeof body.id === 'string' && body.id.slice(0, 120);
  if (!id) { res.status(400).json({ error: 'invalid request' }); return; }
  await kv(['INCR', `leader:views:${id}`]);
  res.status(200).json({ ok: true });
}

async function leaderComments(req, res) {
  if (req.method === 'GET') {
    const id = ((req.query && req.query.id) || '').slice(0, 120);
    if (!id) { res.status(400).json({ error: 'invalid request' }); return; }
    const listRes = await kv(['LRANGE', `leader:comments:${id}`, '0', '199']);
    const items = (listRes.result || [])
      .map((s) => { try { return JSON.parse(s); } catch (e) { return null; } })
      .filter(Boolean);
    res.status(200).json({ comments: items });
    return;
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const id = body && typeof body.id === 'string' && body.id.slice(0, 120);
    if (!id) { res.status(400).json({ error: 'invalid request' }); return; }

    let alias = ((body && body.alias) || '').toString().trim().slice(0, 40) || 'Anonymous';
    let text = ((body && body.text) || '').toString().trim().slice(0, 500);
    if (!text) { res.status(400).json({ error: 'empty comment' }); return; }

    const ip = clientIp(req);
    const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
    const rlKey = `commentrl:${ipHash}`; // shared site-wide comment rate limit, same bucket as daily-edition comments
    const rl = await kv(['INCR', rlKey]);
    const rlCount = parseInt(rl.result, 10) || 0;
    if (rlCount === 1) { await kv(['EXPIRE', rlKey, '3600']); }
    if (rlCount > 8) { res.status(429).json({ error: 'rate limited' }); return; }

    const entry = { alias: escapeHtml(alias), text: escapeHtml(text), ts: new Date().toISOString() };
    await kv(['RPUSH', `leader:comments:${id}`, JSON.stringify(entry)]);
    await kv(['LTRIM', `leader:comments:${id}`, '-500', '-1']);
    res.status(200).json({ ok: true, comment: entry });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (!KV_URL || !KV_TOKEN) {
    res.status(500).json({ error: 'storage not configured' });
    return;
  }

  const action = (req.query || {}).action;
  if (action === 'comments') return comments(req, res);
  if (action === 'vote') return vote(req, res);
  if (action === 'leader-stats') return leaderStats(req, res);
  if (action === 'leader-like') return leaderLike(req, res);
  if (action === 'leader-view') return leaderView(req, res);
  if (action === 'leader-comments') return leaderComments(req, res);
  res.status(400).json({ error: 'unknown action' });
};
