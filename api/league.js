// Leagues: private, invite-by-link groups that compare daily quiz scores.
// No accounts: the server assigns every player a generated name ("Curious Otter 27") derived from a random device id.
// Two kinds (2026-11-21):
//   friends  up to 30 players, a generated league name ("Swift Otters")
//   group    a college class, an office team or a community: up to 300 players and a name its creator types
//            ("IIM-A PGP 2027"), checked here (length, characters, a blocklist); the boards show the top 25 plus you.
// Stored per league: name, member id -> generated name, and one score per member per day.
// Everything expires ~120 days after last activity.
const crypto = require('crypto');

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const TTL = 120 * 86400;
const MAX_MEMBERS = 30;
const GROUP_MAX = 300;
const BOARD_TOP = 25;                    // a group's boards list this many, plus the viewer if they are further down
const KINDS = { college: 'College', office: 'Office', community: 'Community' };
// A typed league name: 3-40 characters of letters, digits, spaces and . , & - ' ( ) /, no links, nothing on the blocklist.
const BLOCK = /\b(fuck|shit|bitch|cunt|dick|porn|sex|nazi|rape|slut|whore|chutiya|madarchod|bhenchod|behenchod|bsdk|gaand|lund|randi|harami|kamina)\w*/i;
function cleanName(raw) {
  const n = String(raw || '').replace(/\s+/g, ' ').trim();
  if (n.length < 3 || n.length > 40) return { error: 'Names are 3 to 40 characters.' };
  if (!/^[\p{L}\p{N} .,&'()\/-]+$/u.test(n)) return { error: 'Use letters, numbers, spaces and . , & - \' ( ) / only.' };
  if (/https?:|www\.|[a-z0-9-]{2,}\.(com|in|net|org|io|co|app)\b/i.test(n)) return { error: 'No links in league names.' };   // "B.Com" is a degree, "spam.com" a link
  if (BLOCK.test(n.replace(/[^\p{L}\s]/gu, ''))) return { error: 'Please choose another name.' };
  return { name: n };
}
const DAY_MS = 86400000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const ADJ = ['Bold', 'Brave', 'Bright', 'Calm', 'Clever', 'Cosmic', 'Curious', 'Daring', 'Eager', 'Fancy', 'Gentle', 'Happy', 'Jolly', 'Keen', 'Lively', 'Lucky',
  'Mellow', 'Nimble', 'Plucky', 'Quick', 'Quiet', 'Rapid', 'Sharp', 'Sly', 'Snappy', 'Sunny', 'Swift', 'Tidy', 'Vivid', 'Witty', 'Zesty', 'Steady'];
const ANI = ['Falcon', 'Otter', 'Panda', 'Fox', 'Heron', 'Lynx', 'Koala', 'Tiger', 'Whale', 'Yak', 'Zebra', 'Owl', 'Gecko', 'Bison', 'Crane', 'Dingo',
  'Ibis', 'Lemur', 'Marten', 'Newt', 'Orca', 'Puffin', 'Quokka', 'Raven', 'Seal', 'Tapir', 'Viper', 'Wombat', 'Badger', 'Cobra', 'Eagle', 'Finch'];

const MID_RE = /^[a-f0-9]{16,64}$/;
const CODE_RE = /^[A-Z2-9]{6}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function kv(command) {
  const path = command.map((c) => encodeURIComponent(c)).join('/');
  const r = await fetch(`${KV_URL}/${path}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  return r.json();
}
async function pipe(commands) {
  const r = await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  return r.json();
}

const clientIp = (req) => {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0].trim() : req.socket && req.socket.remoteAddress) || 'unknown';
};
const ipHash = (req) => crypto.createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 16);

function flat(res) {
  const out = {};
  const a = (res && res.result) || [];
  for (let i = 0; i + 1 < a.length; i += 2) out[a[i]] = a[i + 1];
  return out;
}

function handleFor(mid, taken) {
  const h = crypto.createHash('sha256').update(mid).digest();
  let num = 1 + (h[2] % 99);
  const base = `${ADJ[h[0] % ADJ.length]} ${ANI[h[1] % ANI.length]}`;
  let handle = `${base} ${num}`;
  while (taken.has(handle)) { num = (num % 99) + 1; handle = `${base} ${num}`; }
  return handle;
}

function leagueName() {
  const b = crypto.randomBytes(2);
  return `${ADJ[b[0] % ADJ.length]} ${ANI[b[1] % ANI.length]}s`;
}
function newCode() {
  const b = crypto.randomBytes(6);
  return Array.from(b, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
}

function shiftDay(date, delta) {
  return new Date(Date.parse(date + 'T00:00:00Z') + delta * DAY_MS).toISOString().slice(0, 10);
}
function withinWindow(date) {
  const t = Date.parse(date + 'T00:00:00Z');
  return Number.isFinite(t) && Math.abs(Date.now() - t) <= 3 * DAY_MS;
}

// Reporting a typed league name (App Store guideline 1.2: user-generated content needs a report mechanism and action on it):
// a report sends the owner a Telegram note with a signed one-tap link that swaps the name for a generated one.
const SIGN_KEY = () => process.env.CRON_SECRET || KV_TOKEN || '';
const signRm = (code) => crypto.createHmac('sha256', SIGN_KEY()).update(`rmname:${code}`).digest('hex').slice(0, 32);
const sameSig = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Rate limit: returns true if this IP is over `max` actions for `bucket` today.
async function limited(req, bucket, max) {
  const key = `lgl:${bucket}:${ipHash(req)}`;
  const n = parseInt((await kv(['INCR', key])).result, 10) || 0;
  if (n === 1) await kv(['EXPIRE', key, '86400']);
  return n > max;
}

async function standings(code, mid, date) {
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(shiftDay(date, -i));
  const res = await pipe([
    ['HGETALL', `lg:${code}`],
    ['HGETALL', `lg:${code}:m`],
    ...days.map((d) => ['HGETALL', `lg:${code}:s:${d}`]),
  ]);
  const meta = flat(res[0]);
  const members = flat(res[1]);
  if (!meta.created) return null;
  const scores = {};
  days.forEach((d, i) => { scores[d] = flat(res[2 + i]); });
  const ids = Object.keys(members);
  const rank = (arr, key) => {
    arr.sort((a, b) => b[key] - a[key] || a.h.localeCompare(b.h));
    let last = null, r = 0;
    arr.forEach((e, i) => { if (e[key] !== last) { r = i + 1; last = e[key]; } e.rank = r; });
    return arr;
  };
  const today = rank(ids.filter((id) => scores[date][id] !== undefined)
    .map((id) => ({ h: members[id], s: parseInt(scores[date][id], 10), me: id === mid })), 's');
  const yet = ids.filter((id) => scores[date][id] === undefined).map((id) => ({ h: members[id], me: id === mid }));
  const week = rank(ids.map((id) => {
    let pts = 0, played = 0;
    days.forEach((d) => { if (scores[d][id] !== undefined) { pts += parseInt(scores[d][id], 10) || 0; played++; } });
    return { h: members[id], pts, played, me: id === mid };
  }).filter((e) => e.played > 0), 'pts');
  const hist = days.filter((d) => d < date).map((d) => {
    const entries = ids.filter((id) => scores[d][id] !== undefined).map((id) => ({ id, s: parseInt(scores[d][id], 10) }));
    const top = entries.reduce((m, e) => Math.max(m, e.s), -1);
    const winners = entries.filter((e) => e.s === top);
    return { date: d, players: entries.length, top, winners: winners.map((e) => members[e.id]), meWon: entries.length >= 2 && winners.some((e) => e.id === mid) };
  });
  const max = parseInt(meta.max, 10) || MAX_MEMBERS;
  // a big league shows its top players plus the viewer; who has yet to play becomes a count
  const trim = (arr) => (arr.length <= BOARD_TOP ? arr : arr.slice(0, BOARD_TOP).concat(arr.slice(BOARD_TOP).filter((e) => e.me)));
  const big = ids.length > BOARD_TOP + 5;
  return { code, name: meta.name, kind: meta.kind || 'friends', label: KINDS[meta.kind] || '', max, members: ids.length, date, isMember: !!members[mid], me: members[mid] || null,
    today: big ? trim(today) : today, todayCount: today.length, yet: big ? yet.filter((e) => e.me) : yet, yetCount: yet.length,
    week: big ? trim(week) : week, weekCount: week.length, hist };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  // A failure a phone saw (quiz.js lgReport): written to the function log so it can be traced. Nothing is stored.
  if (req.query && req.query.diag) { console.warn('league client error:', String(req.query.diag).replace(/[\r\n]+/g, ' ').slice(0, 400)); res.status(204).end(); return; }
  if (!KV_URL || !KV_TOKEN) { res.status(500).json({ error: 'storage not configured' }); return; }
  res.setHeader('Cache-Control', 'no-store');
  const bad = (msg, code = 400) => res.status(code).json({ error: msg });

  if (req.method === 'GET') {
    const q = req.query || {};
    // The owner's one-tap "remove this name" link from a report (signed; see signRm).
    if (q.rmname) {
      const c = String(q.rmname).toUpperCase();
      const page = (msg) => res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:17px/1.5 -apple-system,system-ui,sans-serif;padding:32px;max-width:520px;margin:auto">${msg}</body>`);
      if (!CODE_RE.test(c) || !sameSig(String(q.sig || ''), signRm(c))) return page('That link is not valid.');
      const old = (await kv(['HGET', `lg:${c}`, 'name'])).result;
      if (!old) return page('That league no longer exists.');
      const name = leagueName();
      await kv(['HSET', `lg:${c}`, 'name', name, 'renamed', String(Date.now())]);
      console.warn(`league ${c} renamed after a report`);
      return page(`Done. League <b>${c}</b> is now called <b>${name}</b>. Its players see the new name the next time their leaderboard loads.`);
    }
    const code = String(q.code || '').toUpperCase();
    if (!CODE_RE.test(code)) return bad('invalid code');
    if (q.meta === '1') {
      const [m, n] = await pipe([['HMGET', `lg:${code}`, 'name', 'kind', 'max'], ['HLEN', `lg:${code}:m`]]);
      const [name, kind, max] = m.result || [];
      if (!name) return bad('league not found', 404);
      return res.status(200).json({ code, name, kind: kind || 'friends', label: KINDS[kind] || '', max: parseInt(max, 10) || MAX_MEMBERS, members: parseInt(n.result, 10) || 0 });
    }
    const mid = String(q.mid || '');
    const date = String(q.date || '');
    if (!MID_RE.test(mid) || !DATE_RE.test(date) || !withinWindow(date)) return bad('invalid request');
    const s = await standings(code, mid, date);
    if (!s) return bad('league not found', 404);
    return res.status(200).json(s);
  }

  if (req.method !== 'POST') return bad('method not allowed', 405);
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  if (body.op === 'account') return require('./_account').handle(req, res, body, limited);   // accounts (api/_account.js)
  const mid = String(body.mid || '');
  if (!MID_RE.test(mid)) return bad('invalid request');

  if (body.action === 'create') {
    const group = body.kind && KINDS[body.kind];
    let typed = null;
    if (group) { typed = cleanName(body.name); if (typed.error) return bad(typed.error); }
    // Per network per day. A college or office Wi-Fi is one address for hundreds of people, so these are generous.
    if (await limited(req, group ? 'create-group' : 'create', group ? 10 : 20)) return bad('too many leagues created today', 429);
    let code = null;
    for (let i = 0; i < 6 && !code; i++) {
      const c = newCode();
      if ((await kv(['HSETNX', `lg:${c}`, 'created', String(Date.now())])).result === 1) code = c;
    }
    if (!code) return bad('try again', 503);
    const name = group ? typed.name : leagueName();
    const handle = handleFor(mid, new Set());
    await pipe([
      ['HSET', `lg:${code}`, 'name', name, 'kind', group ? body.kind : 'friends', 'max', String(group ? GROUP_MAX : MAX_MEMBERS)],
      ['HSET', `lg:${code}:m`, mid, handle],
      ['EXPIRE', `lg:${code}`, String(TTL)],
      ['EXPIRE', `lg:${code}:m`, String(TTL)],
    ]);
    return res.status(200).json({ ok: true, code, name, handle, kind: group ? body.kind : 'friends', max: group ? GROUP_MAX : MAX_MEMBERS });
  }

  const code = String(body.code || '').toUpperCase();
  if (!CODE_RE.test(code)) return bad('invalid code');

  if (body.action === 'join') {
    if (await limited(req, 'join', 400)) return bad('too many requests', 429);
    const [meta, mem] = await pipe([['HMGET', `lg:${code}`, 'name', 'max'], ['HGETALL', `lg:${code}:m`]]);
    const [lname, lmax] = meta.result || [];
    if (!lname) return bad('league not found', 404);
    meta.result = lname;
    const members = flat(mem);
    if (members[mid]) return res.status(200).json({ ok: true, code, name: meta.result, handle: members[mid], already: true });
    if (Object.keys(members).length >= (parseInt(lmax, 10) || MAX_MEMBERS)) return bad('this league is full', 409);
    const handle = handleFor(mid, new Set(Object.values(members)));
    await pipe([['HSET', `lg:${code}:m`, mid, handle], ['EXPIRE', `lg:${code}:m`, String(TTL)], ['EXPIRE', `lg:${code}`, String(TTL)]]);
    return res.status(200).json({ ok: true, code, name: meta.result, handle });
  }

  if (body.action === 'report') {
    if (await limited(req, 'report', 20)) return bad('too many requests', 429);
    const m = (await kv(['HMGET', `lg:${code}`, 'name', 'kind'])).result || [];
    if (!m[0]) return bad('league not found', 404);
    if (!KINDS[m[1]]) return res.status(200).json({ ok: true, generated: true });   // a friends league's name is generated
    const n = parseInt((await kv(['HLEN', `lg:${code}:m`])).result, 10) || 0;
    const { CANON } = require('./_edition');
    const { notifyOwner, istToday } = require('./_kit');
    const link = `${CANON}/api/league?rmname=${code}&sig=${signRm(code)}`;
    const r = await notifyOwner(`🚩 A league name was reported\n\n“${m[0]}” (${KINDS[m[1]]} league, code ${code}, ${n} players)\n\nIf it's offensive, tap to replace it with a generated name:\n${link}`, `lgreport:${code}:${istToday()}`);
    console.warn(`league ${code} reported`, JSON.stringify(r));
    return res.status(200).json({ ok: true });
  }

  if (body.action === 'leave') {
    await kv(['HDEL', `lg:${code}:m`, mid]);
    return res.status(200).json({ ok: true });
  }

  if (body.action === 'score') {
    const date = String(body.date || '');
    const score = parseInt(body.score, 10);
    const total = parseInt(body.total, 10);
    if (!DATE_RE.test(date) || !(total >= 1 && total <= 10) || !(score >= 0 && score <= total)) return bad('invalid request');
    if (!withinWindow(date)) return res.status(200).json({ ok: false, reason: 'closed' });
    if (await limited(req, 'score', 1000)) return bad('too many requests', 429);
    const isMember = (await kv(['HGET', `lg:${code}:m`, mid])).result;
    if (!isMember) return bad('not a member', 403);
    const key = `lg:${code}:s:${date}`;
    const set = (await kv(['HSETNX', key, mid, String(score)])).result;
    await kv(['EXPIRE', key, String(TTL)]);
    const s = await standings(code, mid, date);
    return res.status(200).json({ ok: true, recorded: set === 1, standings: s });
  }

  return bad('unknown action');
};

module.exports.cleanName = cleanName;
