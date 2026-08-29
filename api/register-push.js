// Collects device push tokens from the native apps (see /mobile).
// Tokens are stored in Redis sets, one per platform, for a sender job to read
// when a new edition publishes. Sending the pushes themselves needs APNs / FCM
// credentials — see /mobile/README.md "Push notifications".
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kv(command) {
  const path = command.map((c) => encodeURIComponent(c)).join('/');
  const res = await fetch(`${KV_URL}/${path}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  return res.json();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  if (!KV_URL || !KV_TOKEN) {
    res.status(500).json({ error: 'storage not configured' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const token = (body && body.token || '').toString().trim();
  const platform = (body && body.platform || '').toString().trim();

  if (!token || token.length > 400 || (platform !== 'ios' && platform !== 'android')) {
    res.status(400).json({ error: 'invalid request' });
    return;
  }

  await kv(['SADD', `push:tokens:${platform}`, token]);
  res.status(200).json({ ok: true });
};
