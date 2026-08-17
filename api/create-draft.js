// Creates a draft email in Buttondown. The Buttondown API key lives only
// here, as a server-side Vercel env var — it is never present in the daily
// automation's prompt/config, only this endpoint's shared secret is.
const BUTTONDOWN_API_KEY = process.env.BUTTONDOWN_API_KEY;
const ROUTINE_SECRET = process.env.ROUTINE_SECRET;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  if (!BUTTONDOWN_API_KEY || !ROUTINE_SECRET) {
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

  const bdRes = await fetch('https://api.buttondown.email/v1/emails', {
    method: 'POST',
    headers: {
      Authorization: `Token ${BUTTONDOWN_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ subject, body: html, status: 'draft' }),
  });

  const data = await bdRes.json().catch(() => ({}));
  if (!bdRes.ok) {
    res.status(bdRes.status).json({ error: 'buttondown request failed', detail: data });
    return;
  }

  res.status(200).json({ ok: true, id: data.id || null });
};
