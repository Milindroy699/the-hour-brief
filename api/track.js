// Three things in one endpoint, to stay within the Hobby plan's 12-serverless-functions cap
// rather than add a new one: app-level engagement (device pings), push token registration
// (unchanged from the old register-push.js), and feature-adoption event counts (web + app).
//
// Device ping — {deviceId, platform}, sent by capacitor-bridge.js on every native launch,
// independent of push permission (most readers never grant it, so push:tokens alone massively
// undercounts real usage). Updates:
//   device:lastseen        ZSET  deviceId -> last-seen ms            (DAU/WAU/MAU, lapsed check)
//   device:firstseen       HASH  deviceId -> first-seen date         (retention cohorts)
//   device:platform        HASH  deviceId -> 'ios' | 'android'       (platform split)
//   active:<YYYY-MM-DD>    SET   deviceIds active that date          (DAU/WAU/retention curves)
//
// Push token — {token, platform, deviceId?}, unchanged behavior from register-push.js:
//   push:tokens:<platform> SET   tokens                              (who push-edition.js/
//   push:lastseen          ZSET  token -> last-seen ms                push-reengagement.js send to)
//
// Feature event — {event, deviceId?}, fired from any page (web or app) when a reader uses a
// feature with no adoption signal today. deviceId is optional so web callers (no persistent id)
// can still contribute to the aggregate count, just not the unique-device one. Allowlisted names
// only, so this can't become an arbitrary write primitive:
//   event:<name>:<date>         counter  total uses that day
//   event:<name>:devices:<date> SET      deviceIds that used it that day (unique-adoption count)
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const ALLOWED_EVENTS = new Set(['listen_play']);

async function kv(command) {
  const path = command.map((c) => encodeURIComponent(c)).join('/');
  const res = await fetch(`${KV_URL}/${path}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  return res.json();
}

function istToday() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }
  if (!KV_URL || !KV_TOKEN) { res.status(500).json({ error: 'storage not configured' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const deviceId = (body.deviceId || '').toString().trim().slice(0, 100) || null;
  const platform = (body.platform || '').toString().trim();
  const token = (body.token || '').toString().trim();
  const event = (body.event || '').toString().trim();
  const validPlatform = platform === 'ios' || platform === 'android';

  if (!deviceId && !token && !event) { res.status(400).json({ error: 'invalid request' }); return; }

  const jobs = [];
  const today = istToday();

  if (deviceId && validPlatform) {
    jobs.push(
      kv(['ZADD', 'device:lastseen', String(Date.now()), deviceId]),
      kv(['HSETNX', 'device:firstseen', deviceId, today]),
      kv(['HSET', 'device:platform', deviceId, platform]),
      kv(['SADD', `active:${today}`, deviceId]),
    );
  }

  if (token && validPlatform) {
    if (token.length > 400) { res.status(400).json({ error: 'invalid token' }); return; }
    jobs.push(
      kv(['SADD', `push:tokens:${platform}`, token]),
      kv(['ZADD', 'push:lastseen', String(Date.now()), token]),
    );
  }

  if (event) {
    if (!ALLOWED_EVENTS.has(event)) { res.status(400).json({ error: 'unknown event' }); return; }
    jobs.push(kv(['INCR', `event:${event}:${today}`]));
    if (deviceId) jobs.push(kv(['SADD', `event:${event}:devices:${today}`, deviceId]));
  }

  await Promise.all(jobs);
  res.status(200).json({ ok: true });
};
