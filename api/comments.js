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

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? fwd.split(',')[0].trim() : req.socket && req.socket.remoteAddress) || 'unknown';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
};
