// Posts today's digest to a Telegram channel. Called by Vercel Cron (which sends
// "Authorization: Bearer $CRON_SECRET") or by hand with the same header.
//   ?dry=1   build and return the post without sending
//   ?force=1 post even if today's edition was already posted
// Env: CRON_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (e.g. @yourchannel), KV_REST_API_URL/TOKEN (dedupe).
const crypto = require('crypto');
const { buildDigest } = require('./_digest');

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kv(command) {
  const path = command.map((c) => encodeURIComponent(c)).join('/');
  const r = await fetch(`${KV_URL}/${path}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  return r.json();
}

function istToday() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  const given = Buffer.from(String(req.headers.authorization || ''));
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

module.exports = async (req, res) => {
  if (!process.env.CRON_SECRET) { res.status(500).json({ error: 'not configured' }); return; }
  if (!authorized(req)) { res.status(401).json({ error: 'unauthorized' }); return; }

  const q = req.query || {};
  const dry = q.dry === '1';
  const force = q.force === '1';
  const d = await buildDigest();
  if (!d) { res.status(502).json({ error: 'could not read the latest edition' }); return; }

  if (d.date !== istToday()) {
    res.status(200).json({ ok: false, skipped: 'latest edition is not today’s yet', latest: d.date, today: istToday() });
    return;
  }
  if (dry) { res.status(200).json({ ok: true, dry: true, ...d }); return; }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) { res.status(200).json({ ok: false, skipped: 'telegram not configured' }); return; }

  const key = `digest:tg:${d.date}`;
  const useKv = !!(KV_URL && KV_TOKEN);
  if (useKv && !force) {
    const claimed = await kv(['SET', key, '1', 'EX', '259200', 'NX']);
    if (claimed.result === null) { res.status(200).json({ ok: true, skipped: 'already posted', date: d.date }); return; }
  }

  let data;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chat,
        text: d.telegram,
        parse_mode: 'HTML',
        link_preview_options: { url: d.editionUrl, prefer_large_media: true, show_above_text: false },
      }),
    });
    data = await r.json();
  } catch (e) {
    data = { ok: false, description: 'network error' };
  }
  if (!data.ok) {
    if (useKv && !force) await kv(['DEL', key]);   // let the retry run post it
    res.status(502).json({ error: 'telegram rejected the post', detail: data.description || 'unknown' });
    return;
  }
  res.status(200).json({ ok: true, date: d.date, edition: d.edition, messageId: data.result && data.result.message_id });
};
