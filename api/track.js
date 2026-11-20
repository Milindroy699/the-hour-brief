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
//   push:device-token      HASH  deviceId -> token (when the app sends both; used for the owner-only kit push)
//
// Feature event — {event, deviceId?}, fired from any page (web or app) when a reader uses a
// feature with no adoption signal today. deviceId is optional so web callers (no persistent id)
// can still contribute to the aggregate count, just not the unique-device one. Allowlisted names
// only, so this can't become an arbitrary write primitive:
//   event:<name>:<date>         counter  total uses that day
//   event:<name>:devices:<date> SET      deviceIds that used it that day (unique-adoption count)
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// app_link_*: visits to the smart app link (/app), by platform it sent them to.
// push_*: the app's notification permission state and token errors, reported once per launch (diagnostics).
const ALLOWED_EVENTS = new Set(['listen_play', 'app_link_ios', 'app_link_android', 'app_link_desktop', 'push_perm_granted', 'push_perm_denied', 'push_perm_other', 'push_reg_error', 'nav_fail_loaded', 'nav_fail_loading',
  // the website (mobile.js): one visit a day per browser by kind, and the phone "Get the app" bar
  'web_open_ios', 'web_open_android', 'web_open_desktop', 'install_nudge_shown', 'install_nudge_tap',
  // growth: a tap on a podcast-app link (place = which app), and the app prompts' views (place = where)
  'podcast_out', 'app_prompt_shown']);

// Growth report (GET ?action=report&key=STATS_KEY, read by growth.html). Each event above may carry src (where the visitor came
// from: google, linkedin, podcast, direct...) and place (where on the site, or which channel); they are tallied per day in
//   g:<YYYY-MM-DD>  HASH  v|<kind>|<src> visits (one a day per browser)   n|<kind>|<src> of which first-time visitors
//                         c|<store>|<src>|<place> store clicks via /app   p|<place>|<src> podcast-app taps   s|<place> prompts shown
//                         i|<platform> installs (a device's first launch of the app)
const SLUG = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const slug = (v, d) => { const x = String(v || '').toLowerCase().slice(0, 40); return SLUG.test(x) ? x : d; };
const STATS_KEY = process.env.STATS_KEY;

async function kv(command) {
  const path = command.map((c) => encodeURIComponent(c)).join('/');
  const res = await fetch(`${KV_URL}/${path}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  return res.json();
}

function istToday() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

async function pipeline(commands) {
  const r = await fetch(`${KV_URL}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(commands) });
  return (await r.json()).map((x) => x.result);
}

function pairs(arr) { const o = {}; for (let i = 0; arr && i < arr.length; i += 2) o[arr[i]] = Number(arr[i + 1]) || 0; return o; }

// The last `days` days (IST), oldest first: the tallies above, daily actives in the app, and installs by platform. Installs
// come from device:firstseen, so they go back to the app's first launch, before the g:<date> tallies existed.
async function report(days) {
  const dates = [];
  const now = Date.now() + 5.5 * 3600 * 1000;
  for (let i = days - 1; i >= 0; i--) dates.push(new Date(now - i * 864e5).toISOString().slice(0, 10));
  const cmds = [];
  for (const d of dates) cmds.push(['HGETALL', `g:${d}`], ['SCARD', `active:${d}`],
    ['GET', `event:web_open_ios:${d}`], ['GET', `event:web_open_android:${d}`], ['GET', `event:web_open_desktop:${d}`],
    ['GET', `event:install_nudge_shown:${d}`], ['GET', `event:install_nudge_tap:${d}`],
    ['GET', `event:app_link_ios:${d}`], ['GET', `event:app_link_android:${d}`], ['GET', `event:app_link_desktop:${d}`]);
  cmds.push(['HGETALL', 'device:firstseen'], ['HGETALL', 'device:platform'], ['ZCARD', 'device:lastseen'],
    ['SCARD', 'push:tokens:ios'], ['SCARD', 'push:tokens:android']);
  const out = await pipeline(cmds);
  const per = 10;
  const first = pairs(out[dates.length * per]), plat = pairs(out[dates.length * per + 1]);
  const platOf = {};
  { const raw = out[dates.length * per + 1] || []; for (let i = 0; i < raw.length; i += 2) platOf[raw[i]] = raw[i + 1]; }
  const installs = {};
  { const raw = out[dates.length * per] || []; for (let i = 0; i < raw.length; i += 2) { const k = `${raw[i + 1]}|${platOf[raw[i]] || 'unknown'}`; installs[k] = (installs[k] || 0) + 1; } }
  const n = (x) => Number(x) || 0;
  const rows = dates.map((d, k) => {
    const o = out[k * per];
    const tally = {};
    for (let i = 0; o && i < o.length; i += 2) tally[o[i]] = Number(o[i + 1]) || 0;
    return {
      date: d, tally, active: n(out[k * per + 1]),
      web: { ios: n(out[k * per + 2]), android: n(out[k * per + 3]), desktop: n(out[k * per + 4]) },
      nudge: { shown: n(out[k * per + 5]), tap: n(out[k * per + 6]) },
      appLink: { ios: n(out[k * per + 7]), android: n(out[k * per + 8]), desktop: n(out[k * per + 9]) },
      installs: { ios: installs[`${d}|ios`] || 0, android: installs[`${d}|android`] || 0 },
    };
  });
  const tail = out.slice(dates.length * per + 2);
  return {
    generated: new Date().toISOString(), days: rows,
    totals: { devices: Object.keys(first).length, everSeen: n(tail[0]), pushIos: n(tail[1]), pushAndroid: n(tail[2]), platforms: Object.values(plat).length },
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method === 'GET' && req.query && req.query.action === 'report') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    if (!STATS_KEY || String(req.query.key || '') !== STATS_KEY) { res.status(401).json({ error: 'wrong or missing key' }); return; }
    if (!KV_URL || !KV_TOKEN) { res.status(500).json({ error: 'storage not configured' }); return; }
    try { res.status(200).json(await report(Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 120))); }
    catch (e) { res.status(500).json({ error: 'report failed' }); }
    return;
  }
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
      // a device's first launch is an install: tallied for the growth report
      kv(['HSETNX', 'device:firstseen', deviceId, today]).then((r) => (r && r.result === 1 ? kv(['HINCRBY', `g:${today}`, `i|${platform}`, '1']) : null)),
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
    // deviceId -> current token, so one specific device (the owner's, for the daily post kit) can be pushed to alone.
    if (deviceId) jobs.push(kv(['HSET', 'push:device-token', deviceId, token]));
  }

  if (event) {
    if (!ALLOWED_EVENTS.has(event)) { res.status(400).json({ error: 'unknown event' }); return; }
    jobs.push(kv(['INCR', `event:${event}:${today}`]));
    if (deviceId) jobs.push(kv(['SADD', `event:${event}:devices:${today}`, deviceId]));
    // growth tallies, by source (and place); unknown values fall back to a bucket rather than being dropped
    const src = slug(body.src, 'unknown'), place = slug(body.place, 'none');
    const g = `g:${today}`;
    let field = null, field2 = null;
    const web = /^web_open_(ios|android|desktop)$/.exec(event), link = /^app_link_(ios|android|desktop)$/.exec(event);
    if (web) { field = `v|${web[1]}|${src}`; if (body.new === 1 || body.new === '1') field2 = `n|${web[1]}|${src}`; }
    else if (link) field = `c|${link[1]}|${src}|${place}`;
    else if (event === 'podcast_out') field = `p|${place}|${src}`;
    else if (event === 'app_prompt_shown') field = `s|${place}`;
    else if (event === 'install_nudge_shown') field = `s|${place === 'getapp-card' ? 'getapp-card' : 'getapp-bar'}`;
    if (field) jobs.push(kv(['HINCRBY', g, field, '1']));
    if (field2) jobs.push(kv(['HINCRBY', g, field2, '1']));
    if (field) jobs.push(kv(['EXPIRE', g, String(400 * 86400)]));
  }

  await Promise.all(jobs);
  res.status(200).json({ ok: true });
};
