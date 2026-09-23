// Friends leagues: private, invite-by-link groups that compare daily quiz scores.
// No accounts and no user-typed text: the server assigns every player a generated name
// ("Curious Otter 27") derived from a random device id, and every league a generated name.
// Stored per league: name, member id -> generated name, and one score per member per day.
// Everything expires ~120 days after last activity.
const crypto = require('crypto');

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const TTL = 120 * 86400;
const MAX_MEMBERS = 30;
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
  return { code, name: meta.name, members: ids.length, date, isMember: !!members[mid], me: members[mid] || null, today, yet, week, hist };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (!KV_URL || !KV_TOKEN) { res.status(500).json({ error: 'storage not configured' }); return; }
  res.setHeader('Cache-Control', 'no-store');
  const bad = (msg, code = 400) => res.status(code).json({ error: msg });

  if (req.method === 'GET') {
    const q = req.query || {};
    const code = String(q.code || '').toUpperCase();
    if (!CODE_RE.test(code)) return bad('invalid code');
    if (q.meta === '1') {
      const [m, n] = await pipe([['HGET', `lg:${code}`, 'name'], ['HLEN', `lg:${code}:m`]]);
      if (!m.result) return bad('league not found', 404);
      return res.status(200).json({ code, name: m.result, members: parseInt(n.result, 10) || 0 });
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
  const mid = String(body.mid || '');
  if (!MID_RE.test(mid)) return bad('invalid request');

  if (body.action === 'create') {
    if (await limited(req, 'create', 5)) return bad('too many leagues created today', 429);
    let code = null;
    for (let i = 0; i < 6 && !code; i++) {
      const c = newCode();
      if ((await kv(['HSETNX', `lg:${c}`, 'created', String(Date.now())])).result === 1) code = c;
    }
    if (!code) return bad('try again', 503);
    const name = leagueName();
    const handle = handleFor(mid, new Set());
    await pipe([
      ['HSET', `lg:${code}`, 'name', name],
      ['HSET', `lg:${code}:m`, mid, handle],
      ['EXPIRE', `lg:${code}`, String(TTL)],
      ['EXPIRE', `lg:${code}:m`, String(TTL)],
    ]);
    return res.status(200).json({ ok: true, code, name, handle });
  }

  const code = String(body.code || '').toUpperCase();
  if (!CODE_RE.test(code)) return bad('invalid code');

  if (body.action === 'join') {
    if (await limited(req, 'join', 30)) return bad('too many requests', 429);
    const [meta, mem] = await pipe([['HGET', `lg:${code}`, 'name'], ['HGETALL', `lg:${code}:m`]]);
    if (!meta.result) return bad('league not found', 404);
    const members = flat(mem);
    if (members[mid]) return res.status(200).json({ ok: true, code, name: meta.result, handle: members[mid], already: true });
    if (Object.keys(members).length >= MAX_MEMBERS) return bad('this league is full', 409);
    const handle = handleFor(mid, new Set(Object.values(members)));
    await pipe([['HSET', `lg:${code}:m`, mid, handle], ['EXPIRE', `lg:${code}:m`, String(TTL)], ['EXPIRE', `lg:${code}`, String(TTL)]]);
    return res.status(200).json({ ok: true, code, name: meta.result, handle });
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
    if (await limited(req, 'score', 60)) return bad('too many requests', 429);
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
