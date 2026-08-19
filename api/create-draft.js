// Creates a draft campaign in MailerLite. The MailerLite API key lives only
// here, as a server-side Vercel env var — it is never present in the daily
// automation's prompt/config, only this endpoint's shared secret is.
const MAILERLITE_API_KEY = process.env.MAILERLITE_API_KEY;
const MAILERLITE_FROM_EMAIL = process.env.MAILERLITE_FROM_EMAIL;
const ROUTINE_SECRET = process.env.ROUTINE_SECRET;

module.exports = async (req, res) => {
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
};
