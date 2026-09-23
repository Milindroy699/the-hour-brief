// Anonymous quiz tally: stores only "how many readers scored N/T" per edition.
// No names, accounts or per-reader records. A one-way IP hash (24h expiry) caps repeat submissions.
const crypto = require('crypto');

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const DAY_MS = 86400000;
const MAX_PER_IP = 30;

async function kv(command) {
  const path = command.map((c) => encodeURIComponent(c)).join('/');
  const res = await fetch(`${KV_URL}/${path}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  return res.json();
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? fwd.split(',')[0].trim() : req.socket && req.socket.remoteAddress) || 'unknown';
}

function parseDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(v + 'T00:00:00Z');
  return Number.isFinite(t) ? t : null;
}

function toDist(hash, total) {
  // Upstash HGETALL returns a flat [field, value, ...] array.
  const dist = new Array(total + 1).fill(0);
  const flat = (hash && hash.result) || [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const s = parseInt(flat[i], 10);
    const n = parseInt(flat[i + 1], 10);
    if (s >= 0 && s <= total && Number.isFinite(n)) dist[s] = n;
  }
  return dist;
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

  if (req.method === 'GET') {
    const q = req.query || {};
    const date = q.date;
    const total = parseInt(q.total, 10);
    if (parseDate(date) === null || !(total >= 1 && total <= 10)) {
      res.status(400).json({ error: 'invalid request' });
      return;
    }
    const dist = toDist(await kv(['HGETALL', `quiz:dist:${date}:${total}`]), total);
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    res.status(200).json({ date, total, n: dist.reduce((a, b) => a + b, 0), dist });
    return;
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const { date } = body || {};
    const score = parseInt(body && body.score, 10);
    const total = parseInt(body && body.total, 10);
    const t = parseDate(date);
    if (t === null || !(total >= 1 && total <= 10) || !(score >= 0 && score <= total)) {
      res.status(400).json({ error: 'invalid request' });
      return;
    }
    // Only recent editions accept scores, so arbitrary dates cannot create keys.
    if (Math.abs(Date.now() - t) > 3 * DAY_MS) {
      res.status(200).json({ ok: false, reason: 'closed' });
      return;
    }

    const ipHash = crypto.createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 16);
    const limitKey = `quizsub:${date}:${total}:${ipHash}`;
    const count = parseInt((await kv(['INCR', limitKey])).result, 10) || 0;
    if (count === 1) await kv(['EXPIRE', limitKey, '86400']);
    if (count > MAX_PER_IP) {
      res.status(200).json({ ok: false, reason: 'rate_limited' });
      return;
    }

    const key = `quiz:dist:${date}:${total}`;
    await kv(['HINCRBY', key, String(score), '1']);
    await kv(['EXPIRE', key, String(30 * 86400)]);
    const dist = toDist(await kv(['HGETALL', key]), total);
    res.status(200).json({ ok: true, date, total, n: dist.reduce((a, b) => a + b, 0), dist });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
};
