// LinkedIn Page auto-posting (posts as the organization, via LinkedIn's Community Management API):
//   postMorning()  -> every morning: a highlight of the day's edition (social/<date>.json "page" text, or built from
//                     the edition's three lane headlines), with a link card to the edition
//   postLeaders()  -> Monday to Friday: one Thought Leaders highlight a day — the week's roundups and essays in pillar
//                     order, never the same article twice; if the week has fewer than five, the most recent earlier
//                     article not yet posted fills the gap
// One-time connection: authLink() (called with the cron secret) returns a LinkedIn consent URL; the Page admin opens
// it, LinkedIn redirects to /linkedin/callback (rewritten to post-digest.js?job=linkedin-callback), and callback()
// stores the tokens in Redis (li:auth). Access tokens last 60 days and are refreshed automatically when LinkedIn
// issues a refresh token (Community Management API apps get one, valid for a year); otherwise reconnect.
// Env: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_ORG_ID (the number in linkedin.com/company/<n>/admin/),
//      optional LINKEDIN_VERSION (the REST API version header, YYYYMM).
const crypto = require('crypto');
const { CANON } = require('./_edition');
const { kv } = require('./_push');
const { buildDigest } = require('./_digest');
const { istToday, loadSocial } = require('./_kit');

const REDIRECT_URI = `${CANON}/linkedin/callback`;
const SCOPES = 'w_organization_social r_organization_social';
const VERSION = process.env.LINKEDIN_VERSION || '202610';
const PILLAR_ORDER = ['tech-ai', 'business', 'product', 'finance', 'principles'];
const PILLAR_LABEL = { 'tech-ai': 'Tech & AI', business: 'Business', product: 'Product', finance: 'Finance', principles: 'Principles' };
const PILLAR_TAGS = { 'tech-ai': '#AI #Technology', business: '#Business #Strategy', product: '#ProductManagement', finance: '#Investing #PersonalFinance', principles: '#MentalModels #CriticalThinking' };

const configured = () => !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET && process.env.LINKEDIN_ORG_ID);
const orgUrn = () => `urn:li:organization:${String(process.env.LINKEDIN_ORG_ID).replace(/\D/g, '')}`;
const result = (r) => (r && 'result' in r ? r.result : r);

// ---- OAuth ----
async function authLink() {
  if (!configured()) return { ok: false, error: 'LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET / LINKEDIN_ORG_ID not set' };
  const state = crypto.randomBytes(18).toString('hex');
  await kv(['SET', `li:state:${state}`, '1', 'EX', '900']);
  const url = 'https://www.linkedin.com/oauth/v2/authorization?' + new URLSearchParams({
    response_type: 'code', client_id: process.env.LINKEDIN_CLIENT_ID, redirect_uri: REDIRECT_URI, state, scope: SCOPES,
  }).toString();
  return { ok: true, url, expiresInMinutes: 15 };
}

async function tokenRequest(params) {
  const r = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, client_id: process.env.LINKEDIN_CLIENT_ID, client_secret: process.env.LINKEDIN_CLIENT_SECRET }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) throw new Error(`linkedin token: ${data.error_description || data.error || `HTTP ${r.status}`}`);
  const now = Date.now();
  return {
    access: data.access_token,
    accessExp: now + (data.expires_in || 0) * 1000,
    refresh: data.refresh_token || null,
    refreshExp: data.refresh_token ? now + (data.refresh_token_expires_in || 0) * 1000 : null,
    connectedAt: new Date(now).toISOString(),
  };
}

async function callback({ code, state, error, error_description: desc }) {
  if (error) return { ok: false, error: `LinkedIn said: ${desc || error}` };
  if (!code || !state) return { ok: false, error: 'missing code or state' };
  const known = result(await kv(['GET', `li:state:${state}`]));
  if (!known) return { ok: false, error: 'this connect link expired or was already used; ask for a new one' };
  await kv(['DEL', `li:state:${state}`]);
  const auth = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });
  await kv(['SET', 'li:auth', JSON.stringify(auth)]);
  return { ok: true, refreshable: !!auth.refresh, accessExpires: new Date(auth.accessExp).toISOString() };
}

async function accessToken() {
  const raw = result(await kv(['GET', 'li:auth']));
  if (!raw) throw new Error('LinkedIn not connected yet');
  let auth = JSON.parse(raw);
  if (auth.accessExp - Date.now() > 24 * 3600 * 1000) return auth.access;
  if (auth.refresh && (!auth.refreshExp || auth.refreshExp > Date.now())) {
    const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refresh });
    auth = { ...fresh, refresh: fresh.refresh || auth.refresh, refreshExp: fresh.refresh ? fresh.refreshExp : auth.refreshExp };
    await kv(['SET', 'li:auth', JSON.stringify(auth)]);
    return auth.access;
  }
  if (auth.accessExp > Date.now()) return auth.access;
  throw new Error('LinkedIn access expired and cannot be refreshed; reconnect the Page');
}

async function status() {
  const raw = result(await kv(['GET', 'li:auth']));
  if (!raw) return { connected: false, configured: configured() };
  const a = JSON.parse(raw);
  return { connected: true, configured: configured(), connectedAt: a.connectedAt, accessExpires: new Date(a.accessExp).toISOString(),
    refreshable: !!a.refresh, refreshExpires: a.refreshExp ? new Date(a.refreshExp).toISOString() : null };
}

// ---- REST helpers ----
async function rest(token, path, { method = 'GET', body, headers = {} } = {}) {
  const r = await fetch(`https://api.linkedin.com/rest/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'LinkedIn-Version': VERSION, 'X-Restli-Protocol-Version': '2.0.0', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`linkedin ${method} ${path.split('?')[0]}: HTTP ${r.status} ${(await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)}`);
  return r;
}

// Upload an image (fetched from our own site) so the post's link card has a thumbnail; returns the image URN.
async function uploadImage(token, imageUrl) {
  const img = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) });
  if (!img.ok) throw new Error(`thumbnail fetch HTTP ${img.status}`);
  const bytes = Buffer.from(await img.arrayBuffer());
  const init = await (await rest(token, 'images?action=initializeUpload', { method: 'POST', body: { initializeUploadRequest: { owner: orgUrn() } } })).json();
  const { uploadUrl, image } = init.value || {};
  if (!uploadUrl || !image) throw new Error('linkedin image upload: no upload URL');
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: bytes, signal: AbortSignal.timeout(30000) });
  if (!put.ok) throw new Error(`linkedin image upload: HTTP ${put.status}`);
  return image;
}

// LinkedIn's commentary is "little text": these characters are markup and must be escaped to appear literally, and
// a clickable hashtag is written {hashtag|\#|Tag}.
function littleText(s) {
  const esc = (t) => t.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
  return String(s || '').split(/(#[A-Za-z][A-Za-z0-9]*)/).map((part) => (/^#[A-Za-z][A-Za-z0-9]*$/.test(part) ? `{hashtag|\\#|${part.slice(1)}}` : esc(part))).join('');
}

async function publish({ text, link, title, description, imageUrl }) {
  const token = await accessToken();
  let thumbnail = null;
  try { thumbnail = imageUrl ? await uploadImage(token, imageUrl) : null; } catch (e) { thumbnail = null; } // post without one rather than not at all
  const r = await rest(token, 'posts', {
    method: 'POST',
    body: {
      author: orgUrn(),
      commentary: littleText(text),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { article: { source: link, title: String(title || '').slice(0, 200), description: String(description || '').slice(0, 250), ...(thumbnail ? { thumbnail } : {}) } },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    },
  });
  return { ok: true, postUrn: r.headers.get('x-restli-id') || r.headers.get('x-linkedin-id') || null, thumbnail: !!thumbnail };
}

async function once(key, fn, { force }) {
  if (!force) {
    const claimed = result(await kv(['SET', key, '1', 'EX', String(8 * 86400), 'NX']));
    if (claimed === null) return { ok: true, skipped: 'already posted' };
  }
  try {
    return await fn();
  } catch (e) {
    if (!force) await kv(['DEL', key]).catch(() => {});
    return { ok: false, error: e.message };
  }
}

// ---- Morning: today's edition ----
async function morningPost(date) {
  const d = await buildDigest();
  if (!d || d.date !== date) return null;
  const s = await loadSocial(date);
  const lanes = [['AI & Tech', d.lanes && d.lanes.ai], ['Business', d.lanes && d.lanes.biz], ['Markets', d.lanes && d.lanes.mkt]];
  const fallback = [
    `Edition ${d.edition} of The Hour Brief is out: everything that mattered today, in one sitting.`,
    '',
    ...lanes.filter((l) => l[1]).map(([name, t]) => `${name}: ${t}`),
    '',
    `Read it free: ${d.editionUrl}`,
    '',
    '#AI #Business #StockMarket',
  ].join('\n');
  return {
    text: (s && s.page) ? `${s.page}\n\nRead it free: ${d.editionUrl}` : fallback,
    link: d.editionUrl,
    title: `The Hour Brief · Edition ${d.edition}`,
    description: 'AI & tech, product & business, and the markets: today’s brief.',
    imageUrl: d.image,
  };
}

async function postMorning({ date = istToday(), force = false, dry = false } = {}) {
  if (!configured()) return { ok: false, skipped: 'linkedin not set up' };
  const post = await morningPost(date);
  if (!post) return { ok: false, skipped: 'today’s edition is not published yet', date };
  if (dry) return { ok: true, dry: true, date, post };
  return { date, ...(await once(`li:posted:morning:${date}`, () => publish(post), { force })) };
}

// ---- Weekdays: one Thought Leaders article ----
function weekStart(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
  return d.toISOString();
}

function highlightOf(b) {
  if (b.highlight) return b.highlight;
  const paras = String(b.body || '').split(/\n{2,}/).filter((p) => p.trim() && !/^##\s/.test(p));
  let out = '';
  for (const p of paras) { if ((out + p).length > 650) break; out += (out ? '\n\n' : '') + p; }
  return out || (paras[0] || '').slice(0, 650);
}

async function pickLeader() {
  const r = await fetch(`${CANON}/leaders-data.json`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`leaders-data.json HTTP ${r.status}`);
  const briefs = ((await r.json()).briefs || []).filter((b) => b.id && b.title && b.body);
  const posted = new Set(result(await kv(['SMEMBERS', 'li:leaders-posted'])) || []);
  const fresh = briefs.filter((b) => !posted.has(b.id));
  const order = (b) => { const i = PILLAR_ORDER.indexOf(b.category); return i < 0 ? 99 : i; };
  const ws = weekStart();
  const thisWeek = fresh.filter((b) => (b.generatedAt || '') >= ws).sort((a, b) => order(a) - order(b));
  if (thisWeek.length) return thisWeek[0];
  return fresh.sort((a, b) => ((b.generatedAt || '') > (a.generatedAt || '') ? 1 : -1))[0] || null;
}

function leaderPost(b) {
  const label = PILLAR_LABEL[b.category] || 'Thought Leaders';
  const link = `${CANON}/leaders.html#a=${encodeURIComponent(b.id)}`;
  const from = (b.sources || []).map((s) => s.creator).filter(Boolean);
  return {
    text: [
      `${label} · Thought Leaders`,
      '',
      b.title,
      '',
      highlightOf(b),
      '',
      from.length ? `Drawn from ${from.slice(0, 3).join(', ')}${from.length > 3 ? ' and others' : ''}.` : '',
      `Read the full piece: ${link}`,
      '',
      PILLAR_TAGS[b.category] || '#ThoughtLeadership',
    ].filter((line, i, arr) => !(line === '' && arr[i - 1] === '')).join('\n'),
    link,
    title: b.title,
    description: `${label} · Thought Leaders on The Hour Brief`,
    imageUrl: `${CANON}/brand/leaders/${PILLAR_LABEL[b.category] ? b.category : 'principles'}.jpg`,
  };
}

async function postLeaders({ date = istToday(), force = false, dry = false } = {}) {
  if (!configured()) return { ok: false, skipped: 'linkedin not set up' };
  const b = await pickLeader();
  if (!b) return { ok: false, skipped: 'no Thought Leaders article left to post' };
  const post = leaderPost(b);
  if (dry) return { ok: true, dry: true, date, article: b.id, post };
  const out = await once(`li:posted:leaders:${date}`, () => publish(post), { force });
  if (out.ok && !out.skipped) await kv(['SADD', 'li:leaders-posted', b.id]);
  return { date, article: b.id, ...out };
}

module.exports = { authLink, callback, status, postMorning, postLeaders, littleText, weekStart, pickLeader, leaderPost };
