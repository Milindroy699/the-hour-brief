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
};
