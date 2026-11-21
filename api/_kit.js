// Daily post kit: one "sharpest insight" per edition (plus, on weekdays, one Thought Leaders pick), written each morning
// by the "Daily post writer" routine into social/<date>.json (see social/README.md), then delivered from Vercel Cron via
// post-digest.js:
//   deliverKit()       -> the owner: Telegram (the status image + caption, then the day's LinkedIn post) and a push to the
//                         owner's own phone opening /share-kit.html (one-tap LinkedIn / WhatsApp status). The day's
//                         Notion row is written by the "Daily post writer" routine itself, through the owner's Claude
//                         Notion connector, so there is no Notion token here.
//   sendInsightPush()  -> every app user: a second daily push carrying the insight, later in the day
// Each channel is dedupe-keyed on its own, so one failing (or not being set up yet) never blocks the others, and the
// several cron slots that call these can't double-send.
// Env (each optional; a channel without its env is reported as "not set up" and skipped):
//   TELEGRAM_BOT_TOKEN (+ the owner's chat id in Redis kit:telegram-chat or TELEGRAM_OWNER_CHAT_ID),
//   FIREBASE_* (push, shared with _push.js).
const { CANON } = require('./_edition');
const { kv, allTokens, sendToTokens } = require('./_push');

const DEDUPE_TTL = String(3 * 86400);

// App install link appended to everything that goes out: the smart link /app (app.html) sends phones to their own store
// and shows desktops a QR code. `src` says where the link was shared; it reaches Google Play as the install referrer.
const APP_LINKS = { ios: 'https://apps.apple.com/app/id6817195056', android: 'https://play.google.com/store/apps/details?id=app.thehourbrief' };
const appLink = (src) => `${CANON}/app${src ? `?src=${encodeURIComponent(src)}` : ''}`;
const appBlock = (src) => `📱 Get the free app (iPhone & Android): ${appLink(src)}`;
// Insert a block just above a post's closing hashtags (whether on their own line or ending the last sentence), or at
// the end if it has none.
function beforeTags(text, block) {
  const t = String(text || '').replace(/\s+$/, '');
  const m = /^([\s\S]*?)\s*((?:#[A-Za-z]\w*\s*)+)$/.exec(t);
  if (m && m[1].trim()) return `${m[1].replace(/\s+$/, '')}\n\n${block}\n\n${m[2].trim()}`;
  return `${t}\n\n${block}`;
}
const withApp = (text, src) => beforeTags(text, appBlock(src));
// The WhatsApp channel, offered on everything posted to WhatsApp (status and chat messages), above the app links.
const WA_CHANNEL = 'https://whatsapp.com/channel/0029Vb9RU0kCXC3F1pRY6q2L';
const channelLine = '🟢 Follow on WhatsApp for the brief every morning: ' + WA_CHANNEL;
const withWhatsApp = (text, src) => beforeTags(text, `${channelLine}\n${appBlock(src)}`);
// Deep links: the day's post is about one story (s.storyId), so its link should open that story, not the top of the edition.
// The routine writes the texts with an edition link (/e/<date>); this turns it into the story's link (/s/<date>/<id>, which
// the app opens directly when installed, and the website scrolls to) and tags it with the channel (?src=) for the growth report.
// Story links already in the text just get the tag. Mirrored in share-kit.html (deepLinks); keep the two in step.
function deepLinks(text, s, src) {
  const id = s && /^[a-z]{1,8}-\d{1,3}$/.test(s.storyId || '') ? s.storyId : '';
  const tag = (u) => (src && !/[?&]src=/.test(u) ? `${u}${u.includes('?') ? '&' : '?'}src=${encodeURIComponent(src)}` : u);
  return String(text || '')
    .replace(/https:\/\/the-hour-brief\.vercel\.app\/e\/(\d{4}-\d{2}-\d{2})(\?[^\s#]*)?/g, (m, date) =>
      tag(id && s.date === date ? `${CANON}/s/${date}/${id}` : `${CANON}/e/${date}`))
    .replace(/https:\/\/the-hour-brief\.vercel\.app\/s\/\d{4}-\d{2}-\d{2}\/[a-z]{1,8}-\d{1,3}(\?[^\s#]*)?/g, (m) => tag(m));
}

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

// The weekly recap ("What actually mattered this week", Sundays): its page, and its links tagged by channel.
const weekLink = (s, src) => `${CANON}/week.html?d=${s.date}${src ? `&src=${encodeURIComponent(src)}` : ''}`;
const weekLinks = (text, s, src) => String(text || '').replace(/https:\/\/the-hour-brief\.vercel\.app\/week\.html\?d=\d{4}-\d{2}-\d{2}(&src=[\w.-]+)?/g, () => weekLink(s, src));
const hasWeekly = (s) => !!(s && s.weekly && s.weekly.linkedin && Array.isArray(s.weekly.items) && s.weekly.items.length);
// Post-to-X and post-to-Reddit links that open the app (or site) with the text filled in. Posting stays a human tap.
const xIntent = (text) => `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
const redditSubmit = (sub, title, body) => `https://www.reddit.com/r/${encodeURIComponent(sub)}/submit?type=TEXT&title=${encodeURIComponent(title)}&text=${encodeURIComponent(body)}`;

// The day's LinkedIn post: on Sundays the weekly recap, on weekdays the punchy Thought Leaders pick, otherwise the edition
// insight's post.
function primaryPost(s) {
  if (hasWeekly(s)) {
    return { kind: 'weekly', label: 'Weekly recap: What actually mattered', text: weekLinks(s.weekly.linkedin, s, 'linkedin'), link: weekLink(s, 'linkedin') };
  }
  if (s.leaders && s.leaders.id && s.leaders.post) {
    return { kind: 'leaders', label: `Voices pick: ${s.leaders.title || s.leaders.id}`, text: s.leaders.post, link: `${CANON}/leaders.html#a=${encodeURIComponent(s.leaders.id)}` };
  }
  return { kind: 'insight', label: 'Today’s insight', text: deepLinks(s.linkedin, s, 'linkedin'), link: links(s).story };
}

// WhatsApp version of the weekday Thought Leaders pick, built from its LinkedIn post: a status image with the hook, and
// a chat message (bold hook, the points, the link, the app links) to forward to chats and groups.
const LANE_OF = { 'tech-ai': 'ai', business: 'biz', product: 'biz', finance: 'mkt' };
function leadersWhatsApp(s) {
  const L = s.leaders;
  if (!L || !L.id || !L.post) return null;
  const link = `${CANON}/leaders.html#a=${encodeURIComponent(L.id)}`;
  const lines = String(L.post).split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const hook = lines[0];
  const points = lines.slice(1).filter((x) => !/^#/.test(x) && !/^Read the full breakdown/i.test(x));
  return {
    hook,
    image: `${CANON}/api/og?${new URLSearchParams({ type: 'status', k: 'Voices', i: hook, d: s.date, lane: LANE_OF[L.category] || '' }).toString()}`,
    status: `${hook}\n\nRead the full breakdown 👉 ${link}\n\n${channelLine}\n${appBlock('whatsapp-status')}`,
    message: [`*${hook}*`, ...points, `Read the full breakdown 👉 ${link}`, `${channelLine}\n${appBlock('whatsapp')}`].join('\n\n'),
  };
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
  // The status image to save to WhatsApp status, with its caption ready to paste.
  await tg('sendPhoto', { chat_id: chat, photo: l.image, caption: `${withWhatsApp(deepLinks(s.status, s, 'whatsapp-status'), 'whatsapp-status')}\n\nPost kit: ${l.kit}`.slice(0, 1024) });
  return { ok: true };
}
// The day's LinkedIn post as its own message (its own dedupe key, so it can follow later the same day). When it already
// went out on the owner's profile automatically, the message says so instead of asking them to post it.
async function toTelegramPost(s, l, ctx = {}) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return { ok: false, skipped: 'telegram bot not set up' };
  const chat = await telegramChat();
  if (!chat) return { ok: false, skipped: 'telegram not paired yet (message the bot, then pair)' };
  const p = primaryPost(s);
  const head = ctx.memberPosted ? `✅ Posted to your LinkedIn profile · ${p.label}` : `LinkedIn post · ${p.label}`;
  await tg('sendMessage', { chat_id: chat, text: `${head}\n\n${withApp(p.text, 'linkedin')}`.slice(0, 4096), link_preview_options: { is_disabled: true } });
  return { ok: true, kind: p.kind };
}

// A one-off note to the owner on Telegram (e.g. the LinkedIn reconnect reminder), once per `key`.
async function notifyOwner(text, key) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return { ok: false, skipped: 'telegram bot not set up' };
  const chat = await telegramChat();
  if (!chat) return { ok: false, skipped: 'telegram not paired yet' };
  if (key && !(await claim(key, false))) return { ok: true, skipped: 'already sent' };
  try {
    await tg('sendMessage', { chat_id: chat, text: String(text).slice(0, 4096), link_preview_options: { is_disabled: true } });
    return { ok: true };
  } catch (e) {
    if (key) await release(key);
    return { ok: false, error: e.message };
  }
}

// ---- Push to the owner's own phone ----
async function ownerTokens() {
  const devices = ((await kv(['SMEMBERS', 'push:owner'])) || {}).result || [];
  if (!devices.length) return [];
  const toks = ((await kv(['HMGET', 'push:device-token', ...devices])) || {}).result || [];
  return toks.filter(Boolean);
}
// Weekdays: the Thought Leaders pick for WhatsApp: the status image with the concise status caption, then the full
// message for chats and groups.
async function toTelegramLeaders(s) {
  const w = leadersWhatsApp(s);
  if (!w) return { ok: true, skipped: 'no Voices pick today' };
  if (!process.env.TELEGRAM_BOT_TOKEN) return { ok: false, skipped: 'telegram bot not set up' };
  const chat = await telegramChat();
  if (!chat) return { ok: false, skipped: 'telegram not paired yet (message the bot, then pair)' };
  await tg('sendPhoto', { chat_id: chat, photo: w.image, caption: `WhatsApp status · Voices pick\n\n${w.status}`.slice(0, 1024) });
  await tg('sendMessage', { chat_id: chat, text: `WhatsApp message for chats & groups:\n\n${w.message}`.slice(0, 4096), link_preview_options: { is_disabled: true } });
  return { ok: true };
}

async function toOwnerPush(s, l) {
  if (!process.env.FIREBASE_PROJECT_ID) return { ok: false, skipped: 'firebase not configured' };
  const tokens = await ownerTokens();
  if (!tokens.length) return { ok: false, skipped: 'owner phone not paired yet' };
  const out = await sendToTokens(tokens, { title: 'Your post kit is ready', body: s.insight.slice(0, 150), url: l.kit });
  return { ok: out.successCount > 0, ...out };
}

// A message with one-tap buttons under it (Telegram inline keyboard: each button opens its URL). If Telegram refuses a
// button (say a URL it thinks too long), the message goes out anyway, with the links written into the text.
async function tgWithButtons(chat, text, buttons) {
  try {
    return await tg('sendMessage', { chat_id: chat, text: text.slice(0, 4096), link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: buttons.map((b) => [{ text: b.text, url: b.url }]) } });
  } catch (e) {
    const links = buttons.map((b) => `${b.text}: ${b.url}`).join('\n\n');
    return tg('sendMessage', { chat_id: chat, text: `${text}\n\n${links}`.slice(0, 4096), link_preview_options: { is_disabled: true } });
  }
}

// X: the day's X post, with a link that opens X with it filled in (X's API is paid per post; the owner posts by hand).
async function toTelegramX(s) {
  if (!s.x) return { ok: true, skipped: 'no X post in today’s kit' };
  if (!process.env.TELEGRAM_BOT_TOKEN) return { ok: false, skipped: 'telegram bot not set up' };
  const chat = await telegramChat();
  if (!chat) return { ok: false, skipped: 'telegram not paired yet' };
  const text = deepLinks(s.x, s, 'x');
  await tgWithButtons(chat, `X post · tap the button, check it, then Post\n\n${text}`, [{ text: '𝕏  Post on X', url: xIntent(text) }]);
  return { ok: true };
}
// Sundays: the weekly recap's X post and its Reddit post (title, body, and a submit link per suggested community). The
// LinkedIn version is the day's LinkedIn post (primaryPost), so it goes out with the others.
async function toTelegramWeekly(s) {
  if (!hasWeekly(s)) return { ok: true, skipped: 'no weekly recap today' };
  if (!process.env.TELEGRAM_BOT_TOKEN) return { ok: false, skipped: 'telegram bot not set up' };
  const chat = await telegramChat();
  if (!chat) return { ok: false, skipped: 'telegram not paired yet' };
  const w = s.weekly;
  if (w.x) {
    const xt = weekLinks(w.x, s, 'x');
    await tgWithButtons(chat, `🗓 Weekly recap · X post\n\n${xt}`, [{ text: '𝕏  Post on X', url: xIntent(xt) }]);
  }
  const r = w.reddit;
  if (r && r.title && r.body) {
    const body = weekLinks(r.body, s, 'reddit');
    const subs = (Array.isArray(r.subs) ? r.subs : []).map((x) => String(x).replace(/^\/?r\//, '')).filter((x) => /^\w{2,21}$/.test(x)).slice(0, 3);
    await tgWithButtons(chat, `🗓 Weekly recap · Reddit (read each community’s rules first; post as yourself, one community a week)\n\nTitle:\n${r.title}\n\nBody:\n${body}`,
      subs.map((sub) => ({ text: `Post to r/${sub}`, url: redditSubmit(sub, r.title, body) })));
  }
  return { ok: true };
}

// `only` limits a run to one channel (e.g. resending just the WhatsApp pick by hand with force).
// The day's vertical video (made by .github/workflows/short.yml from the morning recording), sent to the owner to post as a
// YouTube Short, an Instagram Reel or a WhatsApp status. Not there yet (the recording or the video is still being made): not
// sent, so a later run of the kit today tries again.
const SHORTS_BASE = 'https://pub-1dafea4a948540db8413a044895e083c.r2.dev/shorts';
async function toTelegramShort(s, l) {
  const chat = await telegramChat();
  if (!chat || !process.env.TELEGRAM_BOT_TOKEN) return { ok: false, skipped: 'telegram not paired' };
  const r = await fetch(`${SHORTS_BASE}/${s.date}.json`, { cache: 'no-store', signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r || !r.ok) return { ok: false, skipped: 'no short for today yet' };
  const v = await r.json();
  const caption = [`🎬 Today’s Short / Reel (${Math.round(v.duration)}s): post it to YouTube Shorts, Instagram Reels or your WhatsApp status.`,
    '', `YouTube title: ${v.youtube.title}`, '', `Captions to copy (YouTube, Instagram, WhatsApp): ${l.kit}#short`].join('\n');
  await tg('sendVideo', { chat_id: chat, video: `${SHORTS_BASE}/${s.date}.mp4`, caption: caption.slice(0, 1024), supports_streaming: true, width: 1080, height: 1920 });
  return { ok: true, duration: v.duration };
}

async function deliverKit({ date = istToday(), force = false, dry = false, only = null, memberPosted = false } = {}) {
  const s = await loadSocial(date);
  if (!s) return { ok: false, date, skipped: 'no social post for this date yet' };
  const l = links(s);
  if (dry) return { ok: true, dry: true, date, social: s, links: l };
  const result = { ok: true, date };
  for (const [name, fn] of [['telegram', toTelegram], ['telegramPost', toTelegramPost], ['telegramLeaders', toTelegramLeaders], ['telegramShort', toTelegramShort], ['telegramX', toTelegramX], ['telegramWeekly', toTelegramWeekly], ['ownerPush', toOwnerPush]]) {
    if (only && name !== only) continue;
    const key = `kit:${name}:${date}`;
    if (!(await claim(key, force))) { result[name] = { ok: true, skipped: 'already sent' }; continue; }
    try {
      result[name] = await fn(s, l, { memberPosted });
    } catch (e) {
      result[name] = { ok: false, error: e.message };
    }
    // Not sent (not set up yet, or failed): free the slot so a later cron run can still send it today. A forced
    // (by-hand) send that worked still counts as today's, so the scheduled run doesn't send it again.
    if (!result[name].ok && !force) await release(key);
    if (force && result[name].ok && !result[name].skipped) await kv(['SET', key, '1', 'EX', DEDUPE_TTL]).catch(() => {});
  }
  return result;
}

// ---- The owner's daily market review (the site says Milind reads the Stock Market section after it publishes) ----
// A push to the owner's phone, opening today's Stock Market section, once today's edition is live. Sent at most once a day;
// if the edition isn't out yet when it runs, nothing is claimed, so a later run (the digest slots) sends it.
async function sendReviewReminder({ force = false, dry = false } = {}) {
  const date = istToday();
  const { loadEdition, editionInfo } = require('./_edition');
  const info = editionInfo(await loadEdition('latest'), 160);
  if (info.d !== date) return { ok: false, skipped: `today's edition (${date}) is not live yet` };
  const payload = { title: `Market review: Edition ${info.n}`, body: info.lanes.mkt ? `Check today's Stock Market section. ${info.lanes.mkt}`.slice(0, 180) : 'Check today’s Stock Market section.', url: `${CANON}/archive/${date}.html#mkt` };
  if (dry) return { ok: true, dry: true, date, payload };
  if (!process.env.FIREBASE_PROJECT_ID) return { ok: false, skipped: 'firebase not configured' };
  const tokens = await ownerTokens();
  if (!tokens.length) return { ok: false, skipped: 'owner phone not paired' };
  const key = `kit:review:${date}`;
  if (!(await claim(key, force))) return { ok: true, skipped: 'already sent today' };
  try {
    const out = await sendToTokens(tokens, payload);
    if (!out.successCount && !force) await release(key);
    return { ok: out.successCount > 0, date, ...out };
  } catch (e) { if (!force) await release(key); return { ok: false, error: e.message }; }
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
    const out = { ok: true, date, ...(await sendToTokens(tokens, payload)) };
    if (force) await kv(['SET', key, '1', 'EX', DEDUPE_TTL]).catch(() => {});
    return out;
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

module.exports = { tgWithButtons, weekLink, hasWeekly, xIntent, redditSubmit, sendReviewReminder, APP_LINKS, WA_CHANNEL, appLink, withApp, withWhatsApp, deepLinks, beforeTags, primaryPost, leadersWhatsApp, notifyOwner, istToday, loadSocial, links, deliverKit, sendInsightPush, pairOwnerPhone, pairTelegram };
