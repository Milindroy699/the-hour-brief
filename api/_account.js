// Accounts (owner, 2026-11-26): sign in with a phone number and a 4-digit PIN (Google and Apple come with the next app
// builds, through Firebase), or stay anonymous. An account keeps what the app otherwise keeps only on one phone: quiz
// results, streaks and badges, saved stories, leagues (the league member id), and section / text size / theme choices.
//
// Served by api/league.js (POST { op: 'account', action, ... }; /api/account is rewritten to it): the Hobby plan allows 12
// functions and all 12 are taken.
//
// Privacy: the phone number is never stored. It is normalised (+91 by default) and kept only as an HMAC (keyed with
// ACCOUNT_PEPPER, else CRON_SECRET), plus its last two digits so the app can show "•• 42". The PIN is kept as scrypt(salt).
// Wrong PINs: 5 per number per hour, then a pause; requests are also rate limited per IP.
//
// KV:
//   acct:<uid>            hash  created, ph (phone HMAC), last2, mid (league member id), data (JSON), dataAt, g / a (Google / Apple ids)
//   acct:pin:<uid>        salt:hash
//   acct:ph:<hmac>        uid
//   acct:fb:<firebaseUid> uid
//   sess:<sha256(token)>  uid   (400 days, renewed on use)
//   acct:sess:<uid>       set of that account's session hashes (so deleting it ends every sign-in)
//   acct:fail:<hmac>      wrong PIN count (1 hour)
const crypto = require('crypto');

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const PEPPER = () => process.env.ACCOUNT_PEPPER || process.env.CRON_SECRET || KV_TOKEN || '';
const SESSION_TTL = 400 * 86400;
const FIREBASE_PROJECT = 'the-hour-brief';

async function kv(command) {
  const path = command.map((c) => encodeURIComponent(c)).join('/');
  const r = await fetch(`${KV_URL}/${path}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  return (await r.json()).result;
}
async function kvPost(command) {           // long values (the data blob) go in the body, not the URL
  const r = await fetch(KV_URL, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  return (await r.json()).result;
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (s) => crypto.createHmac('sha256', PEPPER()).update(s).digest('hex').slice(0, 40);

// +91 by default; 10-15 digits in all
function normPhone(raw) {
  let d = String(raw || '').replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (!d.startsWith('+')) { d = d.replace(/^0+/, ''); d = (d.length === 10 ? '+91' : '+') + d; }
  const digits = d.slice(1);
  return /^\d{10,15}$/.test(digits) ? '+' + digits : null;
}
const goodPin = (p) => /^\d{4}$/.test(String(p || '')) && !/^(\d)\1{3}$/.test(p) && !['1234', '4321', '0123', '9876'].includes(p);
function pinHash(pin, salt) { return crypto.scryptSync(String(pin), salt, 32).toString('hex'); }
function pinOk(pin, stored) {
  const [salt, h] = String(stored || '').split(':');
  if (!salt || !h) return false;
  const a = Buffer.from(pinHash(pin, salt), 'hex'), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- the data an account keeps, merged so nothing played or saved on either side is lost ----
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
function mergeQuiz(a, b) {
  a = obj(a); b = obj(b);
  const out = { ...b, ...a };
  out.r = { ...obj(b.r), ...obj(a.r) };                                  // a result per date: the first one played stands
  const badges = { ...obj(a.b) };
  for (const [k, v] of Object.entries(obj(b.b))) if (!badges[k] || String(v) < String(badges[k])) badges[k] = v;   // the earliest date a badge was earned
  out.b = badges;
  out.bs = Math.max(Number(a.bs) || 0, Number(b.bs) || 0);
  return out;
}
function mergeSaved(a, b) {
  const seen = new Set(), out = [];
  for (const x of [...(Array.isArray(b) ? b : []), ...(Array.isArray(a) ? a : [])]) {
    if (!x || typeof x.k !== 'string' || seen.has(x.k)) continue;
    seen.add(x.k); out.push(x);
  }
  return out.slice(0, 200);
}
function mergeLeagues(a, b, mid) {
  const seen = new Set(), leagues = [];
  for (const l of [...(obj(a).leagues || []), ...(obj(b).leagues || [])]) {
    if (!l || !l.code || seen.has(l.code)) continue;
    seen.add(l.code); leagues.push(l);
  }
  const id = mid || obj(a).mid || obj(b).mid;
  if (!id && !leagues.length) return undefined;                          // never played in a league: nothing to keep
  return { ...obj(b), ...obj(a), mid: id, leagues };
}
// server = what the account has; phone = what this phone sends. Choices (sections, text size, theme) follow the phone.
function merge(server, phone, mid) {
  server = obj(server); phone = obj(phone);
  return {
    quiz: mergeQuiz(server.quiz, phone.quiz),
    saved: mergeSaved(server.saved, phone.saved),
    league: mergeLeagues(server.league, phone.league, mid),
    prefs: phone.prefs !== undefined ? phone.prefs : server.prefs,
    lanes: phone.lanes !== undefined ? phone.lanes : server.lanes,
    textsize: phone.textsize !== undefined ? phone.textsize : server.textsize,
    skin: phone.skin !== undefined ? phone.skin : server.skin,
  };
}
const MAX_DATA = 200000;                    // characters of JSON; a year of quizzes and 200 saved stories is well under this

// Every sign-in (phone) has its own session; the account lists them, so deleting it signs out every phone
async function newSession(uid) {
  const token = crypto.randomBytes(32).toString('hex'), h = sha(token);
  await kv(['SET', `sess:${h}`, uid, 'EX', String(SESSION_TTL)]);
  await kv(['SADD', `acct:sess:${uid}`, h]);
  return token;
}
async function sessionUid(token) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return null;
  const key = `sess:${sha(token)}`, uid = await kv(['GET', key]);
  if (uid) await kv(['EXPIRE', key, String(SESSION_TTL)]);
  return uid || null;
}
async function summary(uid) {
  const a = await kv(['HMGET', `acct:${uid}`, 'last2', 'g', 'a', 'created', 'mid']);
  const [last2, g, ap, created, mid] = a || [];
  return { uid, phone: last2 ? '•• ' + last2 : null, google: !!g, apple: !!ap, created: Number(created) || 0, mid: mid || null };
}
async function readData(uid) { try { return JSON.parse((await kv(['HGET', `acct:${uid}`, 'data'])) || 'null'); } catch (e) { return null; } }
async function writeData(uid, data) {
  const s = JSON.stringify(data);
  if (s.length > MAX_DATA) return false;
  await kvPost(['HSET', `acct:${uid}`, 'data', s, 'dataAt', String(Date.now())]);
  return true;
}
async function createAccount(fields, data) {
  const uid = crypto.randomBytes(12).toString('hex');
  const mid = (obj(data).league || {}).mid;
  await kv(['HSET', `acct:${uid}`, 'created', String(Date.now()), ...(mid && /^[a-f0-9]{16,64}$/.test(mid) ? ['mid', mid] : []), ...Object.entries(fields).flat()]);
  await writeData(uid, merge(null, data, mid));
  return uid;
}
// signed in: the account's data merged with this phone's, saved, and handed back for the phone to keep
async function signedIn(uid, phoneData) {
  const acct = await summary(uid);
  const merged = merge(await readData(uid), phoneData, acct.mid);
  await writeData(uid, merged);
  return { token: await newSession(uid), account: acct, data: merged };
}

// ---- Google / Apple through Firebase Authentication (the app's native sign-in hands over a Firebase ID token) ----
let certs = null, certsAt = 0;
async function firebaseCerts() {
  if (certs && Date.now() - certsAt < 3600000) return certs;
  const r = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  certs = await r.json(); certsAt = Date.now();
  return certs;
}
async function verifyFirebase(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) return null;
  const dec = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
  let head, body;
  try { head = dec(parts[0]); body = dec(parts[1]); } catch (e) { return null; }
  const cert = head.alg === 'RS256' && (await firebaseCerts())[head.kid];
  if (!cert) return null;
  const ok = crypto.createVerify('RSA-SHA256').update(parts[0] + '.' + parts[1]).verify(cert, Buffer.from(parts[2], 'base64url'));
  const now = Date.now() / 1000;
  if (!ok || body.aud !== FIREBASE_PROJECT || body.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT}` || !(body.exp > now) || !(body.iat < now + 300) || !body.sub) return null;
  const provider = (body.firebase && body.firebase.sign_in_provider) || '';
  return { sub: body.sub, provider: provider === 'google.com' ? 'g' : provider === 'apple.com' ? 'a' : null };
}

async function handle(req, res, body, limited) {
  const bad = (msg, code = 400) => res.status(code).json({ error: msg });
  const action = String(body.action || '');
  const data = obj(body.data);
  if (JSON.stringify(data).length > MAX_DATA) return bad('too much data');

  if (action === 'check' || action === 'register' || action === 'login') {
    if (await limited(req, 'acct', 60)) return bad('Too many tries today. Please try again tomorrow.', 429);
    const phone = normPhone(body.phone);
    if (!phone) return bad('Please enter a valid mobile number.');
    const ph = hmac(phone), uid = await kv(['GET', `acct:ph:${ph}`]);
    if (action === 'check') return res.status(200).json({ exists: !!uid });
    if (action === 'register') {
      if (uid) return bad('This number already has an account. Enter its PIN instead.', 409);
      if (!goodPin(body.pin)) return bad('Choose a 4-digit PIN that is not too easy to guess (not 1234 or 1111).');
      if (await limited(req, 'acct-new', 10)) return bad('Too many new accounts from here today.', 429);
      const salt = crypto.randomBytes(16).toString('hex');
      const id = await createAccount({ ph, last2: phone.slice(-2) }, data);
      const claimed = await kv(['SET', `acct:ph:${ph}`, id, 'NX']);
      if (claimed !== 'OK') { await kv(['DEL', `acct:${id}`]); return bad('This number already has an account. Enter its PIN instead.', 409); }
      await kv(['SET', `acct:pin:${id}`, `${salt}:${pinHash(body.pin, salt)}`]);
      return res.status(200).json(await signedIn(id, null));
    }
    // login
    if (!uid) return bad('No account with this number yet.', 404);
    const failKey = `acct:fail:${ph}`, fails = Number(await kv(['GET', failKey])) || 0;
    if (fails >= 5) return bad('Too many wrong PINs. Please wait an hour and try again.', 429);
    if (!/^\d{4}$/.test(String(body.pin || '')) || !pinOk(body.pin, await kv(['GET', `acct:pin:${uid}`]))) {
      const n = await kv(['INCR', failKey]);
      if (Number(n) === 1) await kv(['EXPIRE', failKey, '3600']);
      const left = 5 - Number(n);
      return bad(left > 0 ? `That PIN is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong PINs. Please wait an hour and try again.', 401);
    }
    await kv(['DEL', failKey]);
    return res.status(200).json(await signedIn(uid, data));
  }

  if (action === 'oauth') {
    if (await limited(req, 'acct', 60)) return bad('Too many tries today. Please try again tomorrow.', 429);
    const who = await verifyFirebase(body.idToken);
    if (!who || !who.provider) return bad('That sign-in could not be checked. Please try again.', 401);
    let uid = await kv(['GET', `acct:fb:${who.sub}`]);
    if (!uid) {
      uid = await createAccount({ [who.provider]: who.sub }, data);
      await kv(['SET', `acct:fb:${who.sub}`, uid]);
      return res.status(200).json(await signedIn(uid, null));
    }
    return res.status(200).json(await signedIn(uid, data));
  }

  // everything else needs a session
  const uid = await sessionUid(body.token);
  if (!uid) return bad('Signed out. Please sign in again.', 401);
  if (action === 'sync') {
    const acct = await summary(uid);
    const merged = merge(await readData(uid), data, acct.mid);
    if (!(await writeData(uid, merged))) return bad('too much data');
    return res.status(200).json({ account: acct, data: merged });
  }
  if (action === 'me') return res.status(200).json({ account: await summary(uid) });
  if (action === 'logout') { const h = sha(String(body.token)); await kv(['DEL', `sess:${h}`]); await kv(['SREM', `acct:sess:${uid}`, h]); return res.status(200).json({ ok: true }); }
  if (action === 'delete') {
    // everything the account holds, and the number's link to it (the phone's own copy stays on the phone)
    const [ph, g, a] = (await kv(['HMGET', `acct:${uid}`, 'ph', 'g', 'a'])) || [];
    const sessions = (await kv(['SMEMBERS', `acct:sess:${uid}`])) || [];
    const dels = [`acct:${uid}`, `acct:pin:${uid}`, `acct:sess:${uid}`, `sess:${sha(String(body.token))}`, ...sessions.map((h) => `sess:${h}`)];
    if (ph) dels.push(`acct:ph:${ph}`, `acct:fail:${ph}`);
    if (g) dels.push(`acct:fb:${g}`);
    if (a) dels.push(`acct:fb:${a}`);
    await kv(['DEL', ...dels]);
    return res.status(200).json({ ok: true, deleted: true });
  }
  return bad('unknown action');
}

module.exports = { handle, merge, normPhone, goodPin, verifyFirebase };
