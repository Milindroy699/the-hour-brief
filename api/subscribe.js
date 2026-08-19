// Adds an email to MailerLite. The API key lives only here, as a
// server-side Vercel env var — never in client-side code or the repo.
const MAILERLITE_API_KEY = process.env.MAILERLITE_API_KEY;

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
};
