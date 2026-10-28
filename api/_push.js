// Shared Firebase Cloud Messaging + Redis token-set helpers for push-edition.js and
// push-reengagement.js. Tokens are FCM registration tokens for both platforms — on iOS this
// is the token AppDelegate.swift hands over after exchanging the raw APNs token with Firebase
// (see mobile/ios/App/App/AppDelegate.swift), not the raw APNs token itself.
// firebase-admin v14 dropped the admin.credential.cert() / admin.messaging() namespace object
// style in favor of modular subpath imports — require('firebase-admin') alone no longer exposes
// either.
const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kv(command) {
  const path = command.map((c) => encodeURIComponent(c)).join('/');
  const r = await fetch(`${KV_URL}/${path}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  return r.json();
}

let app;
function firebaseApp() {
  if (app) return app;
  app = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
  return app;
}

async function allTokens() {
  const [ios, android] = await Promise.all([
    kv(['SMEMBERS', 'push:tokens:ios']),
    kv(['SMEMBERS', 'push:tokens:android']),
  ]);
  return Array.from(new Set([...(ios.result || []), ...(android.result || [])]));
}

// Tokens not seen (re-registered, which happens on every app launch) since the cutoff. A token
// that has never been recorded in push:lastseen at all (e.g. registered before this tracking
// existed) counts as lapsed too, which is the right default until it next re-registers.
async function lapsedTokens(days) {
  const cutoff = Date.now() - days * 86400 * 1000;
  const [all, recent] = await Promise.all([
    allTokens(),
    kv(['ZRANGEBYSCORE', 'push:lastseen', cutoff, '+inf']),
  ]);
  const recentSet = new Set(recent.result || []);
  return all.filter((t) => !recentSet.has(t));
}

async function sendToTokens(tokens, { title, body, url }) {
  firebaseApp();
  const message = {
    notification: { title, body },
    // apns-priority 10 + interruption-level time-sensitive: without these, iOS can silently defer
    // delivery into Scheduled Summary (bundled, non-immediate) instead of showing the push right away.
    apns: {
      headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
      payload: { aps: { sound: 'default', 'interruption-level': 'time-sensitive' } },
    },
    android: { priority: 'high', notification: { sound: 'default' } },
  };
  if (url) message.data = { url };

  let successCount = 0;
  let failureCount = 0;
  const invalid = [];

  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    const resp = await getMessaging().sendEachForMulticast({ tokens: chunk, ...message });
    successCount += resp.successCount;
    failureCount += resp.failureCount;
    resp.responses.forEach((r, j) => {
      if (r.success) return;
      const code = r.error && r.error.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
        invalid.push(chunk[j]);
      }
    });
  }

  if (invalid.length) {
    await Promise.all(invalid.flatMap((t) => [
      kv(['SREM', 'push:tokens:ios', t]),
      kv(['SREM', 'push:tokens:android', t]),
      kv(['ZREM', 'push:lastseen', t]),
    ]));
  }

  return { total: tokens.length, successCount, failureCount, removed: invalid.length };
}

// Sends the "today's edition is ready" push, independently dedupe-keyed from post-digest.js's
// own Telegram dedupe so a Telegram failure never blocks the push, or vice versa. `d` is a
// buildDigest() result the caller already has (post-digest.js and push-edition.js both do).
async function sendEditionPush(d, { force } = {}) {
  const payload = {
    title: `Edition ${d.edition} is ready`,
    body: 'AI & Tech, Product & Business, and the Markets — today’s brief is in.',
    url: d.editionUrl,
  };
  const tokens = await allTokens();
  if (!tokens.length) return { ok: true, skipped: 'no registered devices' };
  if (!process.env.FIREBASE_PROJECT_ID) return { ok: false, skipped: 'firebase not configured' };

  const key = `push:edition-sent:${d.date}`;
  if (!force) {
    const claimed = await kv(['SET', key, '1', 'EX', '259200', 'NX']);
    if (claimed.result === null) return { ok: true, skipped: 'already pushed', date: d.date };
  }
  try {
    const result = await sendToTokens(tokens, payload);
    return { ok: true, date: d.date, ...result };
  } catch (e) {
    if (!force) await kv(['DEL', key]);   // let the retry window send it instead
    return { ok: false, error: 'push send failed', detail: e.message };
  }
}

module.exports = { kv, allTokens, lapsedTokens, sendToTokens, sendEditionPush };
