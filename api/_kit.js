// Daily post kit: one "sharpest insight" per edition, written each morning by the "Daily post writer" routine into
// social/<date>.json (see social/README.md), then delivered from Vercel Cron via post-digest.js:
//   deliverKit()       -> the owner: a Notion row, a Telegram message (status image + caption + LinkedIn text), and a
//                         push to the owner's own phone opening /share-kit.html (one-tap LinkedIn / WhatsApp status)
//   sendInsightPush()  -> every app user: a second daily push carrying the insight, later in the day
// Each channel is dedupe-keyed on its own, so one failing (or not being set up yet) never blocks the others, and the
// several cron slots that call these can't double-send.
// Env (each optional; a channel without its env is reported as "not set up" and skipped):
//   NOTION_TOKEN (+ NOTION_DB_ID, defaults to the database created for this), TELEGRAM_BOT_TOKEN (+ the owner's chat id
//   in Redis kit:telegram-chat or TELEGRAM_OWNER_CHAT_ID), FIREBASE_* (push, shared with _push.js).
const { CANON } = require('./_edition');
const { kv, allTokens, sendToTokens } = require('./_push');

// "The Hour Brief · Daily posts" in the owner's Notion (created 2026-11-17). Its integration must be connected to it.
const NOTION_DB_ID = process.env.NOTION_DB_ID || '41b5454835148128912dd31e3d93f149';
const DEDUPE_TTL = String(3 * 86400);

function istToday() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

async function loadSocial(date) {
  try {
    const r = await fetch(`${CANON}/social/${date}.json`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const s = await r.json();
    return s && s.date === date && s.insight && s.linkedin ? s : null;
  } catch (e) {
    return null;
  }
}

function links(s) {
  const lane = ['ai', 'biz', 'mkt'].includes(s.lane) ? s.lane : '';
  return {
    edition: `${CANON}/e/${s.date}`,
    story: s.storyId ? `${CANON}/s/${s.date}/${encodeURIComponent(s.storyId)}` : `${CANON}/e/${s.date}`,
    kit: `${CANON}/share-kit.html`,
    image: `${CANON}/api/og?${new URLSearchParams({ type: 'status', i: s.insight, d: s.date, n: String(s.edition || ''), lane }).toString()}`,
  };
}

// Claim a once-per-day slot; returns false if this channel already went out for that date.
async function claim(key, force) {
  if (force) return true;
  const r = await kv(['SET', key, '1', 'EX', DEDUPE_TTL, 'NX']);
  return r && r.result !== null;
}
const release = (key) => kv(['DEL', key]).catch(() => {});

// ---- Notion ----
function richText(text) {
  const s = String(text || '');
  const parts = [];
  for (let i = 0; i < s.length; i += 1900) parts.push({ type: 'text', text: { content: s.slice(i, i + 1900) } });
  return parts.length ? parts : [{ type: 'text', text: { content: '' } }];
}
const para = (text) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: richText(text) } });
const heading = (text) => ({ object: 'block', type: 'heading_3', heading_3: { rich_text: richText(text) } });

async function toNotion(s, l) {
  const token = process.env.NOTION_TOKEN;
  if (!token || !NOTION_DB_ID) return { ok: false, skipped: 'notion not set up' };
  const laneName = { ai: 'AI & Tech', biz: 'Business', mkt: 'Markets' }[s.lane];
  const body = {
    parent: { database_id: NOTION_DB_ID },
    properties: {
      Name: { title: richText(`${s.date} · ${s.insight}`.slice(0, 1900)) },
      Date: { date: { start: s.date } },
      Edition: { number: Number(s.edition) || null },
      ...(laneName ? { Lane: { select: { name: laneName } } } : {}),
      Insight: { rich_text: richText(s.insight) },
      'Status caption': { rich_text: richText(s.status) },
      'Push': { rich_text: richText(s.push ? `${s.push.title} — ${s.push.body}` : '') },
      Kit: { url: l.kit },
      'Status image': { files: [{ name: `status-${s.date}.png`, type: 'external', external: { url: l.image } }] },
    },
    children: [
      { object: 'block', type: 'image', image: { type: 'external', external: { url: l.image } } },
      heading('WhatsApp status caption'),
      para(s.status),
      heading('LinkedIn post'),
      ...String(s.linkedin).split(/\n{2,}/).filter((p) => p.trim()).map(para),
      heading('Links'),
      para(`Post kit (share buttons): ${l.kit}`),
      para(`Story: ${l.story}`),
    ],
  };
  const r = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    const detail = (await r.text().catch(() => '')).slice(0, 200);
    return { ok: false, error: `notion HTTP ${r.status}`, detail };
  }
  const page = await r.json();
  return { ok: true, url: page.url };
}

// ---- Telegram (to the owner, not a channel) ----
async function telegramChat() {
  if (process.env.TELEGRAM_OWNER_CHAT_ID) return process.env.TELEGRAM_OWNER_CHAT_ID;
  const r = await kv(['GET', 'kit:telegram-chat']);
  return r && r.result;
}
async function tg(method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  const data = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
  if (!data.ok) throw new Error(`telegram ${method}: ${data.description || 'failed'}`);
  return data.result;
}
async function toTelegram(s, l) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return { ok: false, skipped: 'telegram bot not set up' };
  const chat = await telegramChat();
  if (!chat) return { ok: false, skipped: 'telegram not paired yet (message the bot, then pair)' };
  // Photo first (save it to WhatsApp status), caption ready to paste; then the LinkedIn post as its own message.
  await tg('sendPhoto', { chat_id: chat, photo: l.image, caption: `${s.status}\n\nPost kit: ${l.kit}`.slice(0, 1024) });
  await tg('sendMessage', { chat_id: chat, text: `LinkedIn post for ${s.date}:\n\n${s.linkedin}`.slice(0, 4096), link_preview_options: { is_disabled: true } });
  return { ok: true };
}

// ---- Push to the owner's own phone ----
async function ownerTokens() {
  const devices = ((await kv(['SMEMBERS', 'push:owner'])) || {}).result || [];
  if (!devices.length) return [];
  const toks = ((await kv(['HMGET', 'push:device-token', ...devices])) || {}).result || [];
  return toks.filter(Boolean);
}
async function toOwnerPush(s, l) {
  if (!process.env.FIREBASE_PROJECT_ID) return { ok: false, skipped: 'firebase not configured' };
  const tokens = await ownerTokens();
  if (!tokens.length) return { ok: false, skipped: 'owner phone not paired yet' };
  const out = await sendToTokens(tokens, { title: 'Your post kit is ready', body: s.insight.slice(0, 150), url: l.kit });
  return { ok: out.successCount > 0, ...out };
}

async function deliverKit({ date = istToday(), force = false, dry = false } = {}) {
  const s = await loadSocial(date);
  if (!s) return { ok: false, date, skipped: 'no social post for this date yet' };
  const l = links(s);
  if (dry) return { ok: true, dry: true, date, social: s, links: l };
  const result = { ok: true, date };
  for (const [name, fn] of [['notion', toNotion], ['telegram', toTelegram], ['ownerPush', toOwnerPush]]) {
    const key = `kit:${name}:${date}`;
    if (!(await claim(key, force))) { result[name] = { ok: true, skipped: 'already sent' }; continue; }
    try {
      result[name] = await fn(s, l);
    } catch (e) {
      result[name] = { ok: false, error: e.message };
    }
    // Not sent (not set up yet, or failed): free the slot so a later cron run can still send it today.
    if (!result[name].ok && !force) await release(key);
  }
  return result;
}

// ---- The second daily push, to every app user ----
async function sendInsightPush({ date = istToday(), force = false, dry = false } = {}) {
  const s = await loadSocial(date);
  if (!s || !s.push || !s.push.title || !s.push.body) return { ok: false, date, skipped: 'no social post for this date yet' };
  const payload = { title: s.push.title.slice(0, 65), body: s.push.body.slice(0, 180), url: links(s).story };
  if (dry) return { ok: true, dry: true, date, payload };
  if (!process.env.FIREBASE_PROJECT_ID) return { ok: false, skipped: 'firebase not configured' };
  const tokens = await allTokens();
  if (!tokens.length) return { ok: true, skipped: 'no registered devices' };
  const key = `push:insight-sent:${date}`;
  if (!(await claim(key, force))) return { ok: true, skipped: 'already pushed', date };
  try {
    return { ok: true, date, ...(await sendToTokens(tokens, payload)) };
  } catch (e) {
    if (!force) await release(key);
    return { ok: false, error: 'push send failed', detail: e.message };
  }
}

// ---- One-time pairing of the owner's phone ----
// The owner relaunches the app; the one device that checked in within the last few minutes (and has a push token)
// becomes the owner device and gets a confirmation push. Refuses if more than one device is that fresh.
async function pairOwnerPhone({ withinMs = 3 * 60 * 1000, dry = false } = {}) {
  const fresh = ((await kv(['ZRANGEBYSCORE', 'device:lastseen', String(Date.now() - withinMs), '+inf'])) || {}).result || [];
  if (!fresh.length) return { ok: false, error: 'no device opened the app in the last few minutes' };
  const toks = ((await kv(['HMGET', 'push:device-token', ...fresh])) || {}).result || [];
  const withToken = fresh.map((d, i) => ({ device: d, token: toks[i] })).filter((x) => x.token);
  if (withToken.length !== 1) return { ok: false, error: `expected exactly one fresh device with a push token, found ${withToken.length} (of ${fresh.length} fresh)` };
  const [{ device, token }] = withToken;
  if (dry) return { ok: true, dry: true, device };
  await kv(['SADD', 'push:owner', device]);
  const out = await sendToTokens([token], { title: 'Post kit: this phone is paired', body: 'You’ll get a push here each morning when the day’s post kit is ready.', url: `${CANON}/share-kit.html` });
  return { ok: true, device, ...out };
}

// Store the owner's Telegram chat id from the bot's recent updates (the owner sends the bot any message first).
async function pairTelegram({ dry = false } = {}) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return { ok: false, error: 'TELEGRAM_BOT_TOKEN not set' };
  const updates = await tg('getUpdates', { limit: 50 });
  const chats = {};
  updates.forEach((u) => { const m = u.message || u.edited_message; if (m && m.chat && m.chat.type === 'private') chats[m.chat.id] = m.chat; });
  const list = Object.values(chats).map((c) => ({ id: String(c.id), name: [c.first_name, c.last_name].filter(Boolean).join(' '), username: c.username || '' }));
  if (list.length !== 1) return { ok: false, error: `expected exactly one private chat with the bot, found ${list.length}`, chats: list };
  if (!dry) await kv(['SET', 'kit:telegram-chat', list[0].id]);
  return { ok: true, dry, chat: list[0] };
}

module.exports = { istToday, loadSocial, links, deliverKit, sendInsightPush, pairOwnerPhone, pairTelegram };
