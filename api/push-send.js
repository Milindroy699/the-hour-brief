// Manual/testing entry point for all push kinds — merged into one file to stay within the Hobby
// plan's 12-serverless-functions-per-deployment cap. Neither the daily edition push nor the
// weekly re-engagement push need this in normal operation: both piggyback cron jobs that already
// exist elsewhere (sendEditionPush from post-digest.js's slots, sendReengagementPush from the same
// place gated to Sundays — see both in _push.js) rather than spending any of the project's limited
// Vercel cron/function slots on their own schedules. This endpoint exists for dry-running or
// force-sending either one by hand, plus a pure connectivity test.
//   ?kind=edition        (default) today's "edition is ready" push
//   ?kind=reengagement    win-back push to devices lapsed N days (?days=, default 7)
//   ?kind=test             a plain connectivity-check push to every registered token right now,
//                           no date/dedupe gating — for manually confirming delivery after setup
//   ?dry=1                build and return what would be sent, without sending
//   ?force=1              send even if already sent
// Auth: "Authorization: Bearer $ROUTINE_SECRET" (same secret create-draft.js uses) or
// "Bearer $PUSH_TEST_SECRET" (a separate, test-only credential, so manual verification never
// needs the production automation's own secret).
const crypto = require('crypto');
const { buildDigest } = require('./_digest');
const { allTokens, lapsedTokens, sendToTokens, sendEditionPush, sendReengagementPush } = require('./_push');

function istToday() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

function matches(given, secret) {
  if (!secret) return false;
  const g = Buffer.from(given);
  const w = Buffer.from(`Bearer ${secret}`);
  return g.length === w.length && crypto.timingSafeEqual(g, w);
}

function authorized(req) {
  const given = String(req.headers.authorization || '');
  return matches(given, process.env.ROUTINE_SECRET) || matches(given, process.env.PUSH_TEST_SECRET);
}

async function testPush() {
  const tokens = await allTokens();
  if (!tokens.length) return { status: 200, body: { ok: true, skipped: 'no registered devices', tokens: 0 } };
  const result = await sendToTokens(tokens, {
    title: 'Test push',
    body: 'If you can see this, push notifications are working.',
    url: 'https://the-hour-brief.vercel.app/',
  });
  return { status: 200, body: { ok: true, ...result } };
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
  if (q.dry === '1') {
    const tokens = await lapsedTokens(days);
    return { status: 200, body: { ok: true, dry: true, tokens: tokens.length, days } };
  }
  const result = await sendReengagementPush({ force: q.force === '1', days });
  return { status: result.ok ? 200 : 502, body: result };
}

module.exports = async (req, res) => {
  if (!process.env.ROUTINE_SECRET && !process.env.PUSH_TEST_SECRET) { res.status(500).json({ error: 'not configured' }); return; }
  if (!authorized(req)) { res.status(401).json({ error: 'unauthorized' }); return; }

  const q = req.query || {};
  const out = q.kind === 'reengagement' ? await reengagementPush(q) : q.kind === 'test' ? await testPush() : await editionPush(q);
  res.status(out.status).json(out.body);
};
