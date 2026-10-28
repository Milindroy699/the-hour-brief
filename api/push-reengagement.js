// Win-back push to devices that haven't reopened the app recently (see push:lastseen, updated by
// register-push.js on every app launch). Not on an automatic schedule yet — there's no spare
// Vercel Cron slot for it on this project's plan (see push-edition.js's comment for why the daily
// push piggybacks post-digest.js's cron instead of getting its own). Call this by hand, or weekly
// from wherever the daily content routine already runs, with "Authorization: Bearer
// $ROUTINE_SECRET" (same secret create-draft.js uses).
//   ?dry=1     build and return what would be sent, without sending
//   ?force=1   send even if already sent today
//   ?days=N    lapsed threshold in days (default 7)
const crypto = require('crypto');
const { lapsedTokens, sendToTokens, kv } = require('./_push');

function istToday() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

function authorized(req) {
  const secret = process.env.ROUTINE_SECRET;
  const given = Buffer.from(String(req.headers.authorization || ''));
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

module.exports = async (req, res) => {
  if (!process.env.ROUTINE_SECRET) { res.status(500).json({ error: 'not configured' }); return; }
  if (!authorized(req)) { res.status(401).json({ error: 'unauthorized' }); return; }

  const q = req.query || {};
  const dry = q.dry === '1';
  const force = q.force === '1';
  const days = Math.max(1, parseInt(q.days, 10) || 7);

  const payload = {
    title: 'Your daily brief is waiting',
    body: 'Catch up on AI, business and markets — a fresh edition every morning.',
    url: 'https://the-hour-brief.vercel.app/',
  };

  const tokens = await lapsedTokens(days);
  const today = istToday();
  if (dry) { res.status(200).json({ ok: true, dry: true, tokens: tokens.length, days, ...payload }); return; }
  if (!tokens.length) { res.status(200).json({ ok: true, skipped: 'no lapsed devices' }); return; }
  if (!process.env.FIREBASE_PROJECT_ID) { res.status(200).json({ ok: false, skipped: 'firebase not configured' }); return; }

  const key = `push:reeng-sent:${today}`;
  if (!force) {
    const claimed = await kv(['SET', key, '1', 'EX', '259200', 'NX']);
    if (claimed.result === null) { res.status(200).json({ ok: true, skipped: 'already sent today', date: today }); return; }
  }

  let result;
  try {
    result = await sendToTokens(tokens, payload);
  } catch (e) {
    if (!force) await kv(['DEL', key]);
    res.status(502).json({ error: 'push send failed', detail: e.message });
    return;
  }

  res.status(200).json({ ok: true, date: today, days, ...result });
};
