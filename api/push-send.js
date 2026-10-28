// Manual/testing entry point for both push kinds — merged into one file to stay within the
// Hobby plan's 12-serverless-functions-per-deployment cap. The daily "edition is ready" push
// doesn't need this at all in normal operation: it piggybacks post-digest.js's existing Vercel
// Cron slots automatically (see sendEditionPush in _push.js). This endpoint exists for dry-running
// or force-sending either kind by hand, and for re-engagement specifically, which has no
// automatic schedule yet (no spare cron slot was safe to add without knowing this project's plan
// tier — see mobile/README.md "Push notifications").
//   ?kind=edition        (default) today's "edition is ready" push
//   ?kind=reengagement    win-back push to devices lapsed N days (?days=, default 7)
//   ?dry=1                build and return what would be sent, without sending
//   ?force=1              send even if already sent
// Auth: "Authorization: Bearer $ROUTINE_SECRET" (same secret create-draft.js uses).
const crypto = require('crypto');
const { buildDigest } = require('./_digest');
const { allTokens, lapsedTokens, sendToTokens, sendEditionPush, kv } = require('./_push');

function istToday() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

function authorized(req) {
  const secret = process.env.ROUTINE_SECRET;
  const given = Buffer.from(String(req.headers.authorization || ''));
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

async function editionPush(q) {
  const d = await buildDigest();
  if (!d) return { status: 502, body: { error: 'could not read the latest edition' } };
  if (d.date !== istToday()) {
    return { status: 200, body: { ok: false, skipped: 'latest edition is not today’s yet', latest: d.date, today: istToday() } };
  }
  if (q.dry === '1') {
    const tokens = await allTokens();
    return { status: 200, body: { ok: true, dry: true, tokens: tokens.length, date: d.date, title: `Edition ${d.edition} is ready`, url: d.editionUrl } };
  }
  const result = await sendEditionPush(d, { force: q.force === '1' });
  return { status: result.ok ? 200 : 502, body: result };
}

async function reengagementPush(q) {
  const days = Math.max(1, parseInt(q.days, 10) || 7);
  const payload = {
    title: 'Your daily brief is waiting',
    body: 'Catch up on AI, business and markets — a fresh edition every morning.',
    url: 'https://the-hour-brief.vercel.app/',
  };
  const tokens = await lapsedTokens(days);
  const today = istToday();
  if (q.dry === '1') {
    return { status: 200, body: { ok: true, dry: true, tokens: tokens.length, days, ...payload } };
  }
  if (!tokens.length) return { status: 200, body: { ok: true, skipped: 'no lapsed devices' } };
  if (!process.env.FIREBASE_PROJECT_ID) return { status: 200, body: { ok: false, skipped: 'firebase not configured' } };

  const force = q.force === '1';
  const key = `push:reeng-sent:${today}`;
  if (!force) {
    const claimed = await kv(['SET', key, '1', 'EX', '259200', 'NX']);
    if (claimed.result === null) return { status: 200, body: { ok: true, skipped: 'already sent today', date: today } };
  }
  try {
    const result = await sendToTokens(tokens, payload);
    return { status: 200, body: { ok: true, date: today, days, ...result } };
  } catch (e) {
    if (!force) await kv(['DEL', key]);
    return { status: 502, body: { error: 'push send failed', detail: e.message } };
  }
}

module.exports = async (req, res) => {
  if (!process.env.ROUTINE_SECRET) { res.status(500).json({ error: 'not configured' }); return; }
  if (!authorized(req)) { res.status(401).json({ error: 'unauthorized' }); return; }

  const q = req.query || {};
  const out = q.kind === 'reengagement' ? await reengagementPush(q) : await editionPush(q);
  res.status(out.status).json(out.body);
};
