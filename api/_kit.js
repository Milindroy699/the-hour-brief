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

const DEDUPE_TTL = String(8 * 86400);   // 8 days: growth.html's Daily run board reads these as the week's record

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

// ---- The X growth plan (owner, 2026-11-21: "I will post manually, let me know through Telegram") ----
// The routine writes social.xpack (see social/README.md); these send it to the owner's Telegram through the day, each part
// once (kit:x:<slot>:<date>), with one-tap "Post on X" buttons. Posting stays by hand: X forbids automated replies.
//   thread     10:00 IST  the day's thread, one message per post (post 1 with a button, the rest to reply under it)
//   replies    11:00 IST  reply round 1: facts to use + "find threads" searches (X Latest)
//   afternoon  15:00 IST  standalone post 1
//   evening    18:00 IST  standalone post 2 + the quiz poll + reply round 2
//   score      19:00 IST  the day's scorecard: X visits / app taps / installs, and the plan checklist (growth.html)
const PLAN_START = '2026-11-22';
// reply target per day by week of the plan (week 1, 2, 3, then on)
function planWeek(date) { return Math.max(1, Math.floor((Date.parse(date) - Date.parse(PLAN_START)) / (7 * 864e5)) + 1); }
const replyTarget = (date) => [25, 25, 40, 50][Math.min(planWeek(date), 4) - 1] || 60;
// Tag the site links in a post with where it was posted (no deep-link rewriting: each post already links its own story).
const tagLinks = (text, src) => String(text || '').replace(/https:\/\/the-hour-brief\.vercel\.app\/[^\s]*/g, (u) => (/[?&]src=/.test(u) ? u : `${u}${u.includes('?') ? '&' : '?'}src=${encodeURIComponent(src)}`));
const xSearch = (q) => `https://x.com/search?q=${encodeURIComponent(q)}&f=live`;
const hasXPack = (s) => !!(s && s.xpack && Array.isArray(s.xpack.thread) && s.xpack.thread.length);

async function xScore(date) {
  const [g, plan] = await Promise.all([kv(['HGETALL', `g:${date}`]), kv(['HGETALL', `plan:${date}`])]);
  const t = {}, p = {};
  const ga = (g && g.result) || [], pa = (plan && plan.result) || [];
  for (let i = 0; i + 1 < ga.length; i += 2) t[ga[i]] = Number(ga[i + 1]) || 0;
  for (let i = 0; i + 1 < pa.length; i += 2) p[pa[i]] = pa[i + 1];
  let visits = 0, fresh = 0, taps = 0, installs = 0;
  for (const [f, n] of Object.entries(t)) {
    const q = f.split('|');
    if (q[0] === 'i') installs += n;
    else if (/^x(-|$)/.test(q[2] || '')) { if (q[0] === 'v') visits += n; else if (q[0] === 'n') fresh += n; else if (q[0] === 'c') taps += n; }
  }
  return { visits, fresh, taps, installs, plan: p };
}

async function deliverXSlot({ slot, date = istToday(), force = false, dry = false } = {}) {
  const s = await loadSocial(date);
  if (slot !== 'score' && !hasXPack(s)) return { ok: true, skipped: 'no X pack today yet' };
  if (!process.env.TELEGRAM_BOT_TOKEN) return { ok: false, skipped: 'telegram bot not set up' };
  const chat = await telegramChat();
  if (!chat) return { ok: false, skipped: 'telegram not paired yet' };
  const key = `kit:x:${slot}:${date}`;
  if (!dry && !(await claim(key, force))) return { ok: true, skipped: 'already sent' };
  const x = (s && s.xpack) || {};
  const send = (text, buttons) => (dry ? Promise.resolve({ text, buttons }) : buttons && buttons.length ? tgWithButtons(chat, text, buttons) : tg('sendMessage', { chat_id: chat, text: text.slice(0, 4096), link_preview_options: { is_disabled: true } }));
  const out = [];
  try {
    if (slot === 'thread') {
      const posts = x.thread.map((t) => tagLinks(t, 'x-thread'));
      out.push(await send(`🧵 Today’s X thread (${posts.length} posts)\nPost 1 with the button, then reply to your own post with 2, 3… in order.\n\n1/${posts.length}\n${posts[0]}`, [{ text: '𝕏  Post 1 on X', url: xIntent(posts[0]) }]));
      for (let i = 1; i < posts.length; i++) out.push(await send(`${i + 1}/${posts.length}\n${posts[i]}`));
    } else if (slot === 'replies' || slot === 'evening') {
      if (slot === 'evening') {
        const p2 = x.posts && x.posts[1];
        if (p2) { const t = tagLinks(p2.text || p2, 'x'); out.push(await send(`⏰ 18:00 post\n\n${t}`, [{ text: '𝕏  Post on X', url: xIntent(t) }])); }
        if (x.poll && x.poll.question && Array.isArray(x.poll.options)) {
          out.push(await send(`📊 Today’s quiz as an X poll (in X: new post → the poll icon; 1 day)\n\n${x.poll.question}\n\n${x.poll.options.map((o, i) => `Option ${i + 1}: ${o}`).join('\n')}\n\nAt 19:00 or later, reply to your poll with the answer:\n${tagLinks(x.poll.answer || '', 'x-poll')}`));
        }
      }
      const r = x.replies || {};
      const target = replyTarget(date);
      const facts = (r.facts || []).slice(0, 10).map((f, i) => `${i + 1}. ${typeof f === 'string' ? f : f.fact}`).join('\n');
      const searches = (r.searches || []).slice(0, 5);
      out.push(await send(`💬 Reply round ${slot === 'replies' ? '1' : '2'} · today’s target: ${target} replies in total\nOpen a search, pick fresh posts from bigger accounts, and add one fact or angle. No links, no “great post”.${facts ? `\n\nFacts to use:\n${facts}` : ''}`,
        searches.map((q) => ({ text: `🔎 ${q}`, url: xSearch(q) }))));
    } else if (slot === 'afternoon') {
      const p1 = x.posts && x.posts[0];
      if (!p1) return { ok: true, skipped: 'no afternoon post' };
      const t = tagLinks(p1.text || p1, 'x');
      out.push(await send(`⏰ 15:00 post\n\n${t}`, [{ text: '𝕏  Post on X', url: xIntent(t) }]));
    } else if (slot === 'score') {
      const sc = await xScore(date);
      const p = sc.plan, done = (k) => (p[k] === '1' ? '✅' : '⬜');
      const replies = parseInt(p.replies, 10) || 0;
      out.push(await send([`📈 Today on X (${date}, week ${planWeek(date)} of the plan)`,
        `From X to the site: ${sc.visits} visits (${sc.fresh} new) · ${sc.taps} “Get the app” taps`,
        `All app installs today: ${sc.installs}`, '',
        `${done('x')} morning post  ${done('thread')} thread  ${done('p1')} 15:00  ${done('p2')} 18:00  ${done('poll')} poll`,
        `💬 replies logged: ${replies} / ${replyTarget(date)}`, '',
        'Tick what you did and log followers and impressions (X › Premium/Analytics, or your profile) on the dashboard:'].join('\n'),
      [{ text: '📊 Open the dashboard', url: `${CANON}/growth.html#plan` }]));
    }
    return { ok: true, sent: out.length, ...(dry ? { preview: out } : {}) };
  } catch (e) {
    if (!dry && !force) await release(key);
    return { ok: false, error: e.message };
  }
}

// ---- Channel numbers (growth.html's Channels tab) ----
// Telegram: the public channel's subscriber count (the bot posts there, so it can read it; per-post views aren't available to
// bots). Instagram: followers, posts, and each recent Reel's likes / comments, plus views / reach / shares / saves when the
// token carries the instagram_manage_insights permission (otherwise insights: 'no permission').
async function channelStats() {
  const out = { at: new Date().toISOString() };
  if (process.env.TELEGRAM_BOT_TOKEN) {
    const chat = process.env.TELEGRAM_CHAT_ID || '@thehourbrief';
    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getChatMemberCount?chat_id=${encodeURIComponent(chat)}`, { signal: AbortSignal.timeout(8000) }).then((x) => x.json()).catch(() => null);
    out.telegram = r && r.ok ? { members: r.result } : { error: (r && r.description) || 'unreachable' };
  }
  const raw = ((await kv(['GET', 'ig:auth'])) || {}).result;
  if (raw) {
    try {
      const a = JSON.parse(raw), host = `https://${a.host || 'graph.instagram.com'}`;
      const g = async (p, params) => { const r = await fetch(`${host}${p}?${new URLSearchParams({ ...params, access_token: a.token })}`, { signal: AbortSignal.timeout(10000) }); const j = await r.json(); if (j.error) throw new Error(j.error.message); return j; };
      const acct = await g(`/${a.userId}`, { fields: 'username,followers_count,media_count' });
      const media = await g(`/${a.userId}/media`, { fields: 'id,timestamp,like_count,comments_count,permalink,media_product_type', limit: '12' });
      let insights = 'ok';
      const reels = [];
      for (const m of media.data || []) {
        const row = { date: (m.timestamp || '').slice(0, 10), likes: m.like_count || 0, comments: m.comments_count || 0, url: m.permalink };
        if (insights === 'ok') {
          try {
            const ins = await g(`/${m.id}/insights`, { metric: 'views,reach,shares,saved' });
            for (const d of ins.data || []) row[d.name] = (d.values && d.values[0] && d.values[0].value) || d.total_value && d.total_value.value || 0;
          } catch (e) { insights = /permission/i.test(e.message) ? 'no permission' : e.message; }
        }
        reels.push(row);
      }
      out.instagram = { account: acct.username, followers: acct.followers_count, posts: acct.media_count, insights, reels };
    } catch (e) { out.instagram = { error: e.message }; }
  }
  return out;
}
// Once a day (the 19:00 slot): keep the day's numbers for the trend lines.
async function snapshotChannels(date = istToday()) {
  const st = await channelStats();
  const f = [];
  if (st.telegram && st.telegram.members != null) f.push('tg', String(st.telegram.members));
  const ig = st.instagram;
  if (ig && ig.followers != null) {
    f.push('ig_followers', String(ig.followers), 'ig_posts', String(ig.posts));
    const sum = (k) => (ig.reels || []).reduce((n, r) => n + (Number(r[k]) || 0), 0);
    f.push('ig_likes', String(sum('likes')), 'ig_comments', String(sum('comments')));
    if (ig.insights === 'ok') f.push('ig_views', String(sum('views')), 'ig_reach', String(sum('reach')));
  }
  if (f.length) { await kv(['HSET', `chan:${date}`, ...f]); await kv(['EXPIRE', `chan:${date}`, String(400 * 86400)]); }
  return { ok: true, saved: f.length / 2, telegram: st.telegram, instagram: ig && { followers: ig.followers, insights: ig.insights, error: ig.error } };
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
// The morning push (9:30, retried 10:00): the post kit's hook, opening its story. Without a kit yet, the AI lane's line.
async function morningPushPayload(d) {
  const s = await loadSocial(d.date);
  if (s && s.push && s.push.title && s.push.body) return { title: s.push.title.slice(0, 65), body: s.push.body.slice(0, 180), url: links(s).story };
  const line = String((d.lanes && (d.lanes.mkt || d.lanes.ai)) || '').replace(/^Today’s \w+ story is /, '');
  return { title: 'Today’s brief is out', body: (line.charAt(0).toUpperCase() + line.slice(1)).slice(0, 150).replace(/\s+\S*$/, '…'), url: d.editionUrl };
}

// The evening push (18:00): today's quiz as a teaser (its first question), opening the quiz. A second, different reason to
// come back. Falls back to the post kit's hook if the edition has no quiz.
async function sendInsightPush({ date = istToday(), force = false, dry = false } = {}) {
  const s = await loadSocial(date);
  let payload = null;
  try {
    const { loadEdition, editionInfo } = require('./_edition');
    const html = await loadEdition('latest');
    if (html && editionInfo(html).d === date) {
      const m = /<script[^>]*id="quiz-data"[^>]*>([\s\S]*?)<\/script>/.exec(html);
      const qs = m ? (JSON.parse(m[1]).questions || []) : [];
      if (qs[0] && qs[0].q) payload = { title: `Today’s quiz: ${qs.length} questions, 1 minute`, body: qs[0].q.slice(0, 170), url: `${CANON}/archive/${date}.html#quiz` };
    }
  } catch (e) { payload = null; }
  if (!payload && s && s.push && s.push.title && s.push.body) payload = { title: s.push.title.slice(0, 65), body: s.push.body.slice(0, 180), url: links(s).story };
  if (!payload) return { ok: false, date, skipped: 'no quiz or post kit for this date yet' };
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

// ---- "Keep your streak" (21:00 IST): only phones that played yesterday's quiz and not today's ----
// quiz.js reports each phone's last played edition and streak (quiz:last, quiz:done:<date>, via api/track.js); the
// phone's push token comes from push:device-token. One push per phone, worded with its own streak.
async function sendStreakReminder({ date = istToday(), force = false, dry = false } = {}) {
  const { loadEdition, editionInfo } = require('./_edition');
  if (editionInfo(await loadEdition('latest')).d !== date) return { ok: true, skipped: 'today’s edition is not out' };
  const pairs = (r) => { const a = (r && r.result) || [], o = {}; for (let i = 0; i + 1 < a.length; i += 2) o[a[i]] = a[i + 1]; return o; };
  const [last, tokens, done] = await Promise.all([kv(['HGETALL', 'quiz:last']), kv(['HGETALL', 'push:device-token']), kv(['SMEMBERS', `quiz:done:${date}`])]);
  const L = pairs(last), T = pairs(tokens), D = new Set((done && done.result) || []);
  const yesterday = new Date(Date.parse(date + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10);
  const byStreak = {};
  for (const [dev, v] of Object.entries(L)) {
    const [d, n] = String(v).split('|');
    if (d !== yesterday || D.has(dev) || !T[dev]) continue;
    (byStreak[n] = byStreak[n] || []).push(T[dev]);
  }
  const targets = Object.values(byStreak).reduce((a, b) => a + b.length, 0);
  const plan = Object.entries(byStreak).map(([n, toks]) => ({ streak: +n, phones: toks.length,
    payload: { title: +n >= 2 ? `Keep your ${n}-day streak alive 🔥` : 'Keep your streak going 🔥', body: 'Today’s quiz is waiting: 5 questions, about a minute.', url: `${CANON}/archive/${date}.html#quiz` } }));
  if (dry) return { ok: true, dry: true, date, targets, plan };
  if (!targets) return { ok: true, skipped: 'nobody to remind', date };
  if (!process.env.FIREBASE_PROJECT_ID) return { ok: false, skipped: 'firebase not configured' };
  const key = `push:streak-sent:${date}`;
  if (!(await claim(key, force))) return { ok: true, skipped: 'already sent', date };
  try {
    let sent = 0;
    for (const p of plan) { const r = await sendToTokens(byStreak[p.streak], p.payload); sent += r.successCount || 0; }
    await kv(['SET', key, String(sent), 'EX', DEDUPE_TTL]);
    return { ok: true, date, targets, sent };
  } catch (e) { if (!force) await release(key); return { ok: false, error: e.message }; }
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

module.exports = { sendStreakReminder, morningPushPayload, channelStats, snapshotChannels, deliverXSlot, xScore, replyTarget, planWeek, PLAN_START, tgWithButtons, weekLink, hasWeekly, xIntent, redditSubmit, sendReviewReminder, APP_LINKS, WA_CHANNEL, appLink, withApp, withWhatsApp, deepLinks, beforeTags, primaryPost, leadersWhatsApp, notifyOwner, istToday, loadSocial, links, deliverKit, sendInsightPush, pairOwnerPhone, pairTelegram };
