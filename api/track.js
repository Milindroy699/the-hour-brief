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
const crypto = require('crypto');
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// app_link_*: visits to the smart app link (/app), by platform it sent them to.
// push_*: the app's notification permission state and token errors, reported once per launch (diagnostics).
const ALLOWED_EVENTS = new Set(['listen_play', 'app_link_ios', 'app_link_android', 'app_link_desktop', 'push_perm_granted', 'push_perm_denied', 'push_perm_other', 'push_reg_error', 'push_open', 'quiz_done', 'nav_fail_loaded', 'nav_fail_loading',
  // the website (mobile.js): one visit a day per browser by kind, and the phone "Get the app" bar
  'web_open_ios', 'web_open_android', 'web_open_desktop', 'install_nudge_shown', 'install_nudge_tap',
  // growth: a tap on a podcast-app link (place = which app), and the app prompts' views (place = where)
  'podcast_out', 'app_prompt_shown', 'channel_out']);

// Growth report (GET ?action=report&key=STATS_KEY, read by growth.html). Each event above may carry src (where the visitor came
// from: google, linkedin, podcast, direct...) and place (where on the site, or which channel); they are tallied per day in
//   g:<YYYY-MM-DD>  HASH  v|<kind>|<src> visits (one a day per browser)   n|<kind>|<src> of which first-time visitors
//                         c|<store>|<src>|<place> store clicks via /app   p|<place>|<src> podcast-app taps   s|<place> prompts shown
//                         j|<channel>|<src> taps on the WhatsApp / Telegram channel links
//                         i|<platform> installs (a device's first launch of the app)
// Features counted by mobile.js use() (and listen.js / quiz.js through window.HBUse). Keep in step with growth.html FEATURES.
const FEATURES = new Set(['open', 'today', 'cards_view', 'story_save', 'story_share', 'story_vote', 'source_out', 'edition_share', 'saved_list',
  'past_editions', 'past_edition_read', 'weekly', 'audio_open', 'audio_play', 'audio_done', 'voices', 'voices_article',
  'challenge_open', 'quiz_start', 'quiz_done', 'quiz_retake_start', 'quiz_retake', 'quiz_share', 'league_create', 'league_join', 'league_invite',
  'badges_view', 'weekly_card', 'weekly_menu', 'menu', 'sections', 'text_size', 'reminder', 'channel_out', 'podcast_out']);

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

// ---- The daily run (growth.html's "Daily run" board): did each automated job happen each day, and is each connection healthy ----
// Every job already leaves a once-a-day key (kept 8 days) or a file; this only reads them. Manual tasks come from plan:<date>.
const SITE = 'https://the-hour-brief.vercel.app';
const R2 = (process.env.R2_PUBLIC_URL || 'https://pub-1dafea4a948540db8413a044895e083c.r2.dev').replace(/\/$/, '');
const OPS_KEYS = [                     // [id, key prefix] — the key is `<prefix>:<date>`
  ['telegramChannel', 'digest:tg'], ['pushMorning', 'push:edition-sent'], ['pushInsight', 'push:insight-sent'], ['pushWeekly', 'push:reeng-sent'],
  ['review', 'kit:review'], ['ownerKit', 'kit:telegram'], ['ownerLinkedin', 'kit:telegramPost'], ['ownerShort', 'kit:telegramShort'],
  ['linkedinProfile', 'li:posted:member'], ['linkedinPage', 'li:posted:morning'], ['linkedinVoices', 'li:posted:leaders'],
  ['youtube', 'short:youtube'], ['instagram', 'short:instagram'],
  ['pushOpens', 'event:push_open'], ['pushStreak', 'push:streak-sent'],
  ['xThread', 'kit:x:thread'], ['xReplies', 'kit:x:replies'], ['xAfternoon', 'kit:x:afternoon'], ['xEvening', 'kit:x:evening'], ['xScore', 'kit:x:score'], ['xMorning', 'kit:telegramX'],
];
const head = (url) => fetch(url, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(6000) }).then((r) => r.ok).catch(() => null);
const getText = (url) => fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.text() : '')).catch(() => null);
async function ops(days) {
  const now = Date.now() + 5.5 * 3600 * 1000, dates = [];
  for (let i = 0; i < days; i++) dates.push(new Date(now - i * 864e5).toISOString().slice(0, 10));   // today first
  const cmds = [];
  for (const d of dates) { for (const [, k] of OPS_KEYS) cmds.push(['GET', `${k}:${d}`]); cmds.push(['HGETALL', `plan:${d}`]); }
  cmds.push(['GET', 'kit:telegram-chat'], ['SCARD', 'push:owner'], ['GET', 'ig:auth'], ['SCARD', 'push:tokens:ios'], ['SCARD', 'push:tokens:android'], ['GET', 'li:member-auth'], ['GET', 'li:auth']);
  const [out, editions, feed, socials, audio, shorts] = await Promise.all([
    pipeline(cmds),
    getText(`${SITE}/editions.json`),
    getText(`${SITE}/podcast.xml`),
    Promise.all(dates.map((d) => getText(`${SITE}/social/${d}.json`))),
    Promise.all(dates.map((d) => head(`${R2}/audio/${d}/manifest.json`))),
    Promise.all(dates.map((d) => head(`${R2}/shorts/${d}.json`))),
  ]);
  const per = OPS_KEYS.length + 1;
  const rows = dates.map((d, i) => {
    const got = {};
    OPS_KEYS.forEach(([id], k) => { const v = out[i * per + k]; got[id] = v == null ? null : id === 'pushOpens' ? Number(v) || 0 : (/^https?:/.test(v) ? v : true); });
    const plan = {}; const pr = out[i * per + OPS_KEYS.length] || []; for (let j = 0; j + 1 < pr.length; j += 2) plan[pr[j]] = pr[j + 1];
    let social = null; try { social = socials[i] ? JSON.parse(socials[i]) : null; } catch (e) { social = null; }
    return {
      date: d, sunday: new Date(d + 'T00:00:00Z').getUTCDay() === 0,
      edition: editions == null ? null : editions.includes(d), audio: audio[i], podcast: feed == null ? null : feed.includes(`hourbrief-${d}`),
      kit: !!social, xpack: !!(social && social.xpack), weekly: !!(social && social.weekly), voices: !!(social && social.leaders),
      short: shorts[i], ...got, plan,
    };
  });
  const tail = out.slice(dates.length * per);
  const json = (v) => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
  const member = json(tail[5]), page = json(tail[6]), ig = json(tail[2]);
  const lastOf = (id) => { const r = rows.find((x) => x[id]); return r ? r.date : null; };
  return {
    generated: new Date().toISOString(), days: rows,
    connections: {
      telegram: { ok: !!tail[0] },
      ownerPhone: { ok: (Number(tail[1]) || 0) > 0 },
      pushDevices: { ios: Number(tail[3]) || 0, android: Number(tail[4]) || 0 },
      linkedinProfile: member ? { ok: (member.accessExp || member.expiresAt || 0) > Date.now(), expires: new Date(member.accessExp || member.expiresAt || 0).toISOString().slice(0, 10) } : { ok: false },
      linkedinPage: { ok: !!page, note: page ? '' : 'waiting for LinkedIn to approve the Community Management API' },
      instagram: { ok: !!ig, account: ig && ig.username, lastPost: lastOf('instagram') },
      youtube: { lastPost: lastOf('youtube') },
    },
  };
}

// ---- Podcast downloads (the feed's enclosures are /ep/<date>/<file>.mp3, rewritten here by vercel.json) ----
// Counts one download per listener (IP + app) per episode per day, the way podcast hosts do, then sends the app on to
// the audio on R2. Range probes after the first byte, HEAD requests and known bots are not counted.
function podApp(ua) {
  const u = String(ua || '');
  if (/bot|crawl|spider|curl|wget|python|node|undici|axios|go-http|java\/|podcastindex|feed|validator|check/i.test(u) && !/Podcasts\/|AppleCoreMedia/i.test(u)) return 'bot';
  if (/Spotify/i.test(u)) return 'spotify';
  if (/AppleCoreMedia|Podcasts\/|iTMS|Apple ?Podcasts|AirPods|watchOS/i.test(u)) return 'apple';
  if (/Amazon|Alexa|Echo|Kindle/i.test(u)) return 'amazon';
  if (/YouTube|Google-?Podcast|GoogleChirp|GSA\//i.test(u)) return 'google';
  if (/Overcast/i.test(u)) return 'overcast';
  if (/Pocket ?Casts/i.test(u)) return 'pocketcasts';
  if (/Castbox/i.test(u)) return 'castbox';
  if (/Saavn/i.test(u)) return 'jiosaavn';
  if (/Podcast ?Addict/i.test(u)) return 'podcastaddict';
  if (/Castro|Podverse|Fountain|AntennaPod|Podbean|Deezer|Audible|Goodpods/i.test(u)) return (u.match(/Castro|Podverse|Fountain|AntennaPod|Podbean|Deezer|Audible|Goodpods/i)[0]).toLowerCase();
  if (/Mozilla|Chrome|Safari|Firefox/i.test(u)) return 'browser';
  return 'other';
}
async function podcastDownload(req, res) {
  const ep = String(req.query.ep || ''), f = String(req.query.f || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ep) || !/^[a-z]+\.[0-9a-f]{8}\.mp3$/.test(f)) { res.status(404).end(); return; }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Location', `${R2}/audio/${ep}/${f}`);
  const range = String(req.headers.range || '');
  if (req.method === 'GET' && KV_URL && KV_TOKEN && (!range || /^bytes=0-/.test(range))) {
    const ua = String(req.headers['user-agent'] || ''), app = podApp(ua);
    if (app !== 'bot') {
      const fwd = req.headers['x-forwarded-for'], ip = (fwd ? String(fwd).split(',')[0].trim() : '') || 'unknown';
      const day = istToday(), who = crypto.createHash('sha256').update(`${ip}|${ua}|${ep}`).digest('hex').slice(0, 16);
      try {
        const add = await kv(['SADD', `pod:u:${day}`, who]);
        const keep = String(400 * 86400);
        if (add && add.result === 1) await pipeline([['HINCRBY', `pod:dl:${day}`, ep, '1'], ['HINCRBY', `pod:app:${day}`, app, '1'], ['EXPIRE', `pod:u:${day}`, '172800'], ['EXPIRE', `pod:dl:${day}`, keep], ['EXPIRE', `pod:app:${day}`, keep]]);
      } catch (e) { /* counting never blocks the audio */ }
    }
  }
  res.status(302).end();
}

// ---- Channels (growth.html's Channels tab): live Telegram / Instagram numbers, the daily snapshots (chan:<date>, written at
// 19:00 by post-digest via _kit.snapshotChannels, and YouTube's by .github/workflows/stats.yml), podcast downloads, and
// the numbers no API gives that the owner logs by hand (plan:<date> wafollowers, spotify). ----
async function channels(days) {
  const { channelStats } = require('./_kit');
  const now = Date.now() + 5.5 * 3600 * 1000, dates = [];
  for (let i = days - 1; i >= 0; i--) dates.push(new Date(now - i * 864e5).toISOString().slice(0, 10));
  const cmds = [];
  for (const d of dates) cmds.push(['HGETALL', `chan:${d}`], ['HGETALL', `pod:dl:${d}`], ['HGETALL', `pod:app:${d}`], ['HGETALL', `plan:${d}`]);
  cmds.push(['GET', 'yt:stats']);
  const [out, live] = await Promise.all([pipeline(cmds), channelStats().catch((e) => ({ error: e.message }))]);
  const obj = (r) => { const o = {}; for (let i = 0; r && i + 1 < r.length; i += 2) o[r[i]] = r[i + 1]; return o; };
  const rows = dates.map((d, i) => ({ date: d, chan: obj(out[i * 4]), dl: obj(out[i * 4 + 1]), apps: obj(out[i * 4 + 2]), plan: obj(out[i * 4 + 3]) }));
  let yt = null; try { yt = JSON.parse(out[dates.length * 4] || 'null'); } catch (e) { yt = null; }
  return { generated: new Date().toISOString(), live, youtube: yt, days: rows };
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
  if ((req.method === 'GET' || req.method === 'HEAD') && req.query && req.query.ep) { await podcastDownload(req, res); return; }
  if (req.method === 'GET' && req.query && req.query.action === 'features') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    if (!STATS_KEY || String(req.query.key || '') !== STATS_KEY) { res.status(401).json({ error: 'wrong or missing key' }); return; }
    if (!KV_URL || !KV_TOKEN) { res.status(500).json({ error: 'storage not configured' }); return; }
    try {
      const n = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 180), dates = [], now = Date.now() + 5.5 * 3600 * 1000;
      for (let i = n - 1; i >= 0; i--) dates.push(new Date(now - i * 864e5).toISOString().slice(0, 10));
      const rows = await pipeline(dates.flatMap((d) => [['HGETALL', `f:${d}`], ['SCARD', `active:${d}`]]));
      res.status(200).json({ days: dates.map((d, i) => ({ date: d, f: pairs(rows[2 * i]), appActive: Number(rows[2 * i + 1]) || 0 })) });
    } catch (e) { res.status(500).json({ error: 'features failed' }); }
    return;
  }
  if (req.method === 'GET' && req.query && req.query.action === 'channels') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    if (!STATS_KEY || String(req.query.key || '') !== STATS_KEY) { res.status(401).json({ error: 'wrong or missing key' }); return; }
    if (!KV_URL || !KV_TOKEN) { res.status(500).json({ error: 'storage not configured' }); return; }
    try { res.status(200).json(await channels(Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90))); }
    catch (e) { res.status(500).json({ error: 'channels failed', detail: e.message }); }
    return;
  }
  if (req.method === 'GET' && req.query && req.query.action === 'ops') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    if (!STATS_KEY || String(req.query.key || '') !== STATS_KEY) { res.status(401).json({ error: 'wrong or missing key' }); return; }
    if (!KV_URL || !KV_TOKEN) { res.status(500).json({ error: 'storage not configured' }); return; }
    try { res.status(200).json(await ops(Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 8))); }
    catch (e) { res.status(500).json({ error: 'ops failed', detail: e.message }); }
    return;
  }
  // The growth plan's daily log (growth.html's Plan section): what the owner did each day and the X numbers they read off X.
  //   GET  ?action=plan&key=&days=N        -> { days: [{ date, plan: {field: value} }] }
  //   POST ?action=plan&key=  { date, field, value }   (fields below; checkboxes are '1' / '', numbers are digits)
  if (req.query && req.query.action === 'plan') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    if (!STATS_KEY || String(req.query.key || '') !== STATS_KEY) { res.status(401).json({ error: 'wrong or missing key' }); return; }
    if (!KV_URL || !KV_TOKEN) { res.status(500).json({ error: 'storage not configured' }); return; }
    if (req.method === 'GET') {
      const n = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 120);
      const now = Date.now() + 5.5 * 3600 * 1000, dates = [];
      for (let i = n - 1; i >= 0; i--) dates.push(new Date(now - i * 864e5).toISOString().slice(0, 10));
      const out = await pipeline(dates.map((d) => ['HGETALL', `plan:${d}`]));
      res.status(200).json({ days: dates.map((d, i) => ({ date: d, plan: (() => { const o = {}; const r = out[i] || []; for (let j = 0; j + 1 < r.length; j += 2) o[r[j]] = r[j + 1]; return o; })() })) });
      return;
    }
    if (req.method === 'POST') {
      let b = req.body;
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
      b = b || {};
      const CHECKS = ['x', 'thread', 'p1', 'p2', 'poll', 'status', 'reddit', 'quote', 'review', 'wachannel'], NUMS = ['replies', 'followers', 'impressions', 'visits', 'wafollowers', 'spotify', 'apple'];
      const date = String(b.date || ''), field = String(b.field || ''), value = String(b.value == null ? '' : b.value).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: 'bad date' }); return; }
      let v;
      if (CHECKS.includes(field)) v = value === '1' ? '1' : '';
      else if (NUMS.includes(field)) { if (value !== '' && !/^\d{1,9}$/.test(value)) { res.status(400).json({ error: 'numbers only' }); return; } v = value; }
      else if (field === 'note') v = value.slice(0, 280);
      else { res.status(400).json({ error: 'unknown field' }); return; }
      await pipeline(v === '' ? [['HDEL', `plan:${date}`, field]] : [['HSET', `plan:${date}`, field, v], ['EXPIRE', `plan:${date}`, String(400 * 86400)]]);
      res.status(200).json({ ok: true, date, field, value: v });
      return;
    }
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }
  if (!KV_URL || !KV_TOKEN) { res.status(500).json({ error: 'storage not configured' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  // Feature use counts (mobile.js use()): { uses: [[feature, first], ...], pf: 'ios' | 'android' | 'web' }. No ID: "first" is
  // the device's own flag for its first use of that feature that day, so u|<feature>|<pf> counts people, <feature>|<pf> uses.
  //   f:<YYYY-MM-DD>  HASH  <feature>|<pf> uses   u|<feature>|<pf> people     (kept 400 days; growth.html › Features)
  if (Array.isArray(body.uses)) {
    const pf = ['ios', 'android', 'web'].includes(body.pf) ? body.pf : 'web';
    const f = `f:${istToday()}`, cmds = [];
    for (const u of body.uses.slice(0, 40)) {
      if (!Array.isArray(u) || !FEATURES.has(u[0])) continue;
      cmds.push(['HINCRBY', f, `${u[0]}|${pf}`, '1']);
      if (u[1] === 1) cmds.push(['HINCRBY', f, `u|${u[0]}|${pf}`, '1']);
    }
    if (cmds.length && KV_URL && KV_TOKEN) { cmds.push(['EXPIRE', f, String(400 * 86400)]); await pipeline(cmds); }
    res.status(200).json({ ok: true });
    return;
  }

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
    // The quiz in the app: this phone's last played edition and its streak (for the 21:00 "keep your streak" push).
    if (event === 'quiz_done' && deviceId) {
      const d = String(body.date || ''), n = parseInt(body.streak, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Math.abs(Date.parse(d + 'T00:00:00Z') - Date.now()) < 4 * 864e5 && n >= 0 && n < 5000) {
        jobs.push(kv(['HSET', 'quiz:last', deviceId, `${d}|${n}`]), kv(['SADD', `quiz:done:${d}`, deviceId]), kv(['EXPIRE', `quiz:done:${d}`, String(4 * 86400)]));
      }
    }
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
    else if (event === 'channel_out') field = `j|${place}|${src}`;
    else if (event === 'app_prompt_shown') field = `s|${place}`;
    else if (event === 'install_nudge_shown') field = `s|${place === 'getapp-card' ? 'getapp-card' : 'getapp-bar'}`;
    if (field) jobs.push(kv(['HINCRBY', g, field, '1']));
    if (field2) jobs.push(kv(['HINCRBY', g, field2, '1']));
    if (field) jobs.push(kv(['EXPIRE', g, String(400 * 86400)]));
  }

  await Promise.all(jobs);
  res.status(200).json({ ok: true });
};
