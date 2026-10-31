// Merges the two MailerLite endpoints (subscribe + create-draft) into one file —
// this project is on Vercel's Hobby plan, capped at 12 Serverless Functions per
// deployment. Old paths (/api/subscribe, /api/create-draft) still work via rewrites
// in vercel.json, so no caller (70+ static pages, the daily-content routine) changes.
const MAILERLITE_API_KEY = process.env.MAILERLITE_API_KEY;
const MAILERLITE_FROM_EMAIL = process.env.MAILERLITE_FROM_EMAIL;
const ROUTINE_SECRET = process.env.ROUTINE_SECRET;

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function subscribe(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  if (!MAILERLITE_API_KEY) {
    res.status(500).json({ error: 'not configured' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const email = (body && body.email || '').toString().trim();

  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'invalid email' });
    return;
  }

  const mlRes = await fetch('https://connect.mailerlite.com/api/subscribers', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MAILERLITE_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ email }),
  });

  const data = await mlRes.json().catch(() => ({}));
  if (!mlRes.ok) {
    res.status(mlRes.status).json({ error: 'subscribe failed', detail: data });
    return;
  }

  res.status(200).json({ ok: true });
}

async function createDraft(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  if (!MAILERLITE_API_KEY || !MAILERLITE_FROM_EMAIL || !ROUTINE_SECRET) {
    res.status(500).json({ error: 'not configured' });
    return;
  }

  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${ROUTINE_SECRET}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { subject, html } = body || {};
  if (!subject || !html) {
    res.status(400).json({ error: 'subject and html are required' });
    return;
  }

  const mlRes = await fetch('https://connect.mailerlite.com/api/campaigns', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MAILERLITE_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      name: subject,
      type: 'regular',
      emails: [
        {
          subject,
          from_name: 'The Hour Brief',
          from: MAILERLITE_FROM_EMAIL,
          content: html,
        },
      ],
    }),
  });

  const data = await mlRes.json().catch(() => ({}));
  if (!mlRes.ok) {
    res.status(mlRes.status).json({ error: 'mailerlite request failed', detail: data });
    return;
  }

  res.status(200).json({ ok: true, id: (data.data && data.data.id) || null });
}

module.exports = async (req, res) => {
  const action = (req.query || {}).action;
  if (action === 'create-draft') return createDraft(req, res);
  if (action === 'subscribe') return subscribe(req, res);
  res.status(400).json({ error: 'unknown action' });
};
