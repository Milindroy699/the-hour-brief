// Manual/testing entry point for the "today's edition is ready" push. The actual daily send
// happens automatically from post-digest.js (piggybacking its existing Vercel Cron slots rather
// than spending two more of the project's limited cron jobs on the same publish-time check).
// This endpoint exists so the push can be dry-run or force-sent by hand, without waiting for cron.
//   ?dry=1   build and return what would be sent, without sending
//   ?force=1 send even if today's edition was already pushed
// Auth: "Authorization: Bearer $ROUTINE_SECRET" (same secret create-draft.js uses).
const crypto = require('crypto');
const { buildDigest } = require('./_digest');
const { allTokens, sendEditionPush } = require('./_push');

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
  const d = await buildDigest();
  if (!d) { res.status(502).json({ error: 'could not read the latest edition' }); return; }

  if (d.date !== istToday()) {
    res.status(200).json({ ok: false, skipped: 'latest edition is not today’s yet', latest: d.date, today: istToday() });
    return;
  }

  if (q.dry === '1') {
    const tokens = await allTokens();
    res.status(200).json({ ok: true, dry: true, tokens: tokens.length, date: d.date, title: `Edition ${d.edition} is ready`, url: d.editionUrl });
    return;
  }

  const result = await sendEditionPush(d, { force: q.force === '1' });
  res.status(result.ok ? 200 : 502).json(result);
};
