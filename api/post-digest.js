// Posts today's digest to a Telegram channel, and (piggybacking this same cron slot rather than
// spending more of the project's limited Vercel Cron jobs) sends the "edition is ready" push
// notification via sendEditionPush, plus the weekly re-engagement push on Sundays via
// sendReengagementPush — all three independently dedupe-keyed, so one failing never blocks the
// others. Called by Vercel Cron (which sends "Authorization: Bearer $CRON_SECRET") or by hand with
// the same header.
//   ?dry=1   build and return the post without sending
//   ?force=1 post/push even if today's edition/re-engagement was already posted/pushed
// Env: CRON_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (e.g. @yourchannel), KV_REST_API_URL/TOKEN (dedupe).
//
// The same function also runs the daily post kit and LinkedIn Page jobs (kept here, not in new files, to stay within
// the Hobby plan's 12-function cap). A cron slot picks its job by schedule (Vercel sends it in x-vercel-cron-schedule);
// by hand, pass ?job=:
//   digest (default)   Telegram channel post + edition push (+ re-engagement on Sundays), then retries kit/morning
//   kit                daily post kit to the owner (Notion, Telegram, owner push) + LinkedIn Page morning post
//   insight            the second daily push to every app user (today's insight)
//   review             the owner's 9:00 IST push to review today's Stock Market section (retried by the digest slots)
//   linkedin-morning   LinkedIn Page: today's edition highlight
//   linkedin-leaders   LinkedIn Page: the day's Thought Leaders highlight (weekdays: roundups; weekends: Principles)
//   linkedin-auth      returns a one-time LinkedIn consent link for the Page admin
//   linkedin-status    whether the Page is connected and when its tokens expire
//   push-check         read-only: FCM dry-run of every registered token + which daily pushes were sent
//   pair-phone         marks the one device that opened the app in the last 3 minutes as the owner's phone
//   pair-telegram      stores the owner's Telegram chat (after they message the bot)
//   linkedin-member    the owner's personal LinkedIn: today's post (kit runs it first, every morning)
//   linkedin-member-auth  returns a connect link for the owner's personal LinkedIn (valid a day)
//   linkedin-callback  LinkedIn's OAuth redirect (no cron secret; protected by the one-time state instead)
const crypto = require('crypto');
const { buildDigest } = require('./_digest');
const { sendEditionPush, sendReengagementPush, checkPushHealth } = require('./_push');
const { deliverKit, deliverXSlot, snapshotChannels, sendInsightPush, sendReviewReminder, pairOwnerPhone, pairTelegram, notifyOwner, istToday: kitDate } = require('./_kit');
const li = require('./_linkedin');

// Which job each Vercel Cron slot runs (see "crons" in vercel.json).
const JOB_BY_SCHEDULE = {
  '30 4 * * *': 'digest',
  '30 5 * * *': 'digest',
  '0 4 * * *': 'kit',
  '30 3 * * *': 'review',
  '30 12 * * *': 'insight',
  '30 13 * * *': 'insight',
  '30 9 * * *': 'linkedin-leaders',
  '30 10 * * *': 'linkedin-leaders',
};
// The X growth plan's Telegram parts ride on these same slots (see deliverXSlot in _kit.js); each sends at most once a day.
const X_SLOT_BY_SCHEDULE = { '30 4 * * *': 'thread', '30 5 * * *': 'replies', '30 9 * * *': 'afternoon', '30 12 * * *': 'evening', '30 13 * * *': 'score' };

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

// The morning personal-profile post, then (if its 60-day connection is nearly up) a reconnect link on Telegram.
async function morningMember({ dry = false, force = false } = {}) {
  let member;
  try { member = await li.postMember({ dry, force }); } catch (e) { member = { ok: false, error: e.message }; }
  if (!dry) {
    try {
      const r = await li.memberReminder();
      if (r) {
        const when = r.daysLeft < 0 ? 'has expired' : r.daysLeft === 0 ? 'expires today' : `expires in ${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'}`;
        member.reminder = await notifyOwner(`Your LinkedIn connection for morning posts ${when}. LinkedIn makes it last 60 days; tap to reconnect (valid 24 hours):\n\n${r.url}`, `li:member-reminder:${kitDate()}`);
      }
    } catch (e) { member.reminder = { ok: false, error: e.message }; }
  }
  return member;
}
const posted = (m) => !!(m && (m.ok && !m.dry) || (m && m.skipped === 'already posted'));

function page(title, message) {
  const e = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${e(title)}</title>` +
    `<body style="margin:0;background:#0c0d15;color:#fff;font:17px/1.5 -apple-system,system-ui,sans-serif"><main style="max-width:520px;margin:0 auto;padding:64px 20px">` +
    `<h1 style="font-size:1.4rem">${e(title)}</h1><p style="color:#c9cae0">${e(message)}</p></main></body>`;
}

module.exports = async (req, res) => {
  const q = req.query || {};

  if (q.job === 'linkedin-callback') {
    let out;
    try { out = await li.callback(q); } catch (e) { out = { ok: false, error: e.message }; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(out.ok ? 200 : 400).send(!out.ok ? page('LinkedIn not connected', out.error)
      : out.mode === 'member'
        ? page('LinkedIn connected', `Morning posts will now go out from your profile${out.name ? ` (${out.name})` : ''}. LinkedIn keeps this connection for 60 days, until ${out.accessExpires.slice(0, 10)}; a week before, you'll get a reconnect link on Telegram.`)
        : page('LinkedIn connected', `The Hour Brief can now post to your LinkedIn Page.${out.refreshable ? ' It will stay connected on its own.' : ' LinkedIn did not grant automatic renewal, so you will need to reconnect before ' + out.accessExpires.slice(0, 10) + '.'}`));
    return;
  }

  if (!process.env.CRON_SECRET) { res.status(500).json({ error: 'not configured' }); return; }
  if (!authorized(req)) { res.status(401).json({ error: 'unauthorized' }); return; }

  const dry = q.dry === '1';
  const force = q.force === '1';
  const job = q.job || JOB_BY_SCHEDULE[req.headers['x-vercel-cron-schedule']] || 'digest';
  // A cron slot that also carries part of the X plan sends it first (independently: a failure there never blocks the job).
  let xslot;
  const xs = X_SLOT_BY_SCHEDULE[req.headers['x-vercel-cron-schedule']];
  if (xs && !q.job) { try { xslot = await deliverXSlot({ slot: xs }); } catch (e) { xslot = { ok: false, error: e.message }; } }
  // 19:00: keep the day's channel numbers (Telegram subscribers, Instagram) for the Channels tab
  if (xs === 'score' && !q.job) { try { xslot = { ...(xslot || {}), channels: await snapshotChannels() }; } catch (e) { xslot = { ...(xslot || {}), channels: { ok: false, error: e.message } }; } }
  const send = (body, status = 200) => res.status(status).json({ job, ...(xslot ? { x: xslot } : {}), ...body });
  try {
    switch (job) {
      case 'x': return send(await deliverXSlot({ slot: String(q.slot || ''), dry, force }));
      case 'channels': return send(await snapshotChannels());
      case 'digest': break;
      case 'kit': {
        if (q.only) return send({ ok: true, kit: await deliverKit({ dry, force, only: String(q.only) }) });
        const member = await morningMember({ dry, force });
        return send({ ok: true, member, kit: await deliverKit({ dry, force, memberPosted: posted(member) }), linkedin: await li.postMorning({ dry, force }) });
      }
      case 'linkedin-member': return send(await morningMember({ dry, force }));
      case 'push-check': return send(await checkPushHealth());
      case 'linkedin-member-auth': return send(await li.authLink('member'));
      case 'insight': return send({ ok: true, push: await sendInsightPush({ dry, force }) });
      case 'review': return send({ ok: true, review: await sendReviewReminder({ dry, force }) });
      case 'linkedin-morning': return send(await li.postMorning({ dry, force }));
      case 'linkedin-leaders': return send(await li.postLeaders({ dry, force }));
      case 'linkedin-auth': return send(await li.authLink());
      case 'linkedin-status': return send({ ok: true, ...(await li.status()) });
      case 'pair-phone': return send(await pairOwnerPhone({ dry }));
      case 'pair-telegram': return send(await pairTelegram({ dry }));
      default: return send({ ok: false, error: `unknown job "${job}"` }, 400);
    }
  } catch (e) {
    return send({ ok: false, error: e.message }, 500);
  }

  const d = await buildDigest();
  if (!d) { res.status(502).json({ error: 'could not read the latest edition' }); return; }

  if (d.date !== istToday()) {
    res.status(200).json({ ok: false, skipped: 'latest edition is not today’s yet', latest: d.date, today: istToday() });
    return;
  }
  if (dry) { res.status(200).json({ ok: true, dry: true, ...d }); return; }

  // Independent of Telegram below: its own dedupe key, its own failure handling. One failing
  // (e.g. Telegram not configured, which is the current state) never blocks the other.
  const push = await sendEditionPush(d, { force });

  // Sundays only — dedupe-keyed by date, so if both daily cron windows land on the same Sunday
  // (the usual retry pattern), only the first actually sends.
  const isSunday = new Date(d.date + 'T00:00:00Z').getUTCDay() === 0;
  const reengagement = isSunday ? await sendReengagementPush({ force }) : { ok: true, skipped: 'not Sunday' };

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  let telegram;
  if (!token || !chat) {
    telegram = { ok: false, skipped: 'telegram not configured' };
  } else {
    const key = `digest:tg:${d.date}`;
    const useKv = !!(KV_URL && KV_TOKEN);
    let claimed = true;
    if (useKv && !force) {
      const claim = await kv(['SET', key, '1', 'EX', '691200', 'NX']);
      claimed = claim.result !== null;
    }
    if (!claimed) {
      telegram = { ok: true, skipped: 'already posted', date: d.date };
    } else {
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
        telegram = { ok: false, error: 'telegram rejected the post', detail: data.description || 'unknown' };
      } else {
        telegram = { ok: true, date: d.date, edition: d.edition, messageId: data.result && data.result.message_id };
      }
    }
  }

  // Retries for the morning jobs whose own slot ('0 4 * * *') may have run before today's post kit existed, or not at
  // all (Vercel Cron delivery is best effort). Both are dedupe-keyed, so these are no-ops once sent.
  let kit, linkedin, member, review;
  try { review = await sendReviewReminder({}); } catch (e) { review = { ok: false, error: e.message }; }
  try { member = await morningMember({}); } catch (e) { member = { ok: false, error: e.message }; }
  try { kit = await deliverKit({ memberPosted: posted(member) }); } catch (e) { kit = { ok: false, error: e.message }; }
  try { linkedin = await li.postMorning({}); } catch (e) { linkedin = { ok: false, error: e.message }; }

  res.status(200).json({ ok: true, date: d.date, edition: d.edition, telegram, push, reengagement, review, member, kit, linkedin, ...(xslot ? { x: xslot } : {}) });
};
