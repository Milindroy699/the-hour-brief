// Posts the day's short (made by short.mjs, already on R2 as shorts/<date>.mp4 + .json) to YouTube Shorts and Instagram Reels.
// Run by .github/workflows/short.yml after the video is published. Each platform:
//   - is skipped, with the reason, until its credentials exist (so this can ship before the accounts are connected);
//   - posts at most once per date: the post's id is kept in KV (short:<platform>:<date>), so re-runs and re-renders never
//     post twice (use --force to post again anyway);
//   - never fails the other one.
//
//   node publish.mjs --date YYYY-MM-DD [--only youtube|instagram] [--dry] [--force]
//
// YouTube (Data API v3, videos.insert, resumable): env YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN (from youtube-auth.mjs).
//   YT_PRIVACY (default public). Until Google approves the API project (YouTube API Services audit), YouTube itself locks uploads
//   from it to private: they then need one tap in YouTube Studio to go public.
// Instagram (Instagram API with Instagram Login, Reels): a Professional account's long-lived token, stored in KV (ig:auth) by
//   `node publish.mjs --ig-token <token>`; refreshed here when it is more than a week old (it lasts 60 days, refreshing renews it).
//   Env IG_GRAPH_VERSION (optional, e.g. v24.0; unversioned by default).
// KV: KV_REST_API_URL, KV_REST_API_TOKEN. Video: R2_PUBLIC_URL (public base of the bucket).
import fs from 'node:fs';
import path from 'node:path';

const PUBLIC = (process.env.R2_PUBLIC_URL || 'https://pub-1dafea4a948540db8413a044895e083c.r2.dev').replace(/\/$/, '');
const env = (k) => (process.env[k] || '').trim();

// ---- KV (Upstash REST) ----
async function kv(cmd) {
  if (!env('KV_REST_API_URL') || !env('KV_REST_API_TOKEN')) throw new Error('KV_REST_API_URL / KV_REST_API_TOKEN not set');
  const r = await fetch(`${env('KV_REST_API_URL')}/${cmd.map(encodeURIComponent).join('/')}`, { headers: { Authorization: `Bearer ${env('KV_REST_API_TOKEN')}` } });
  const j = await r.json();
  if (j.error) throw new Error(`kv: ${j.error}`);
  return j.result;
}

// ---- YouTube ----
export function youtubeBody(meta, privacy = 'public') {
  const tags = [...new Set((meta.youtube.description.match(/#\w+/g) || []).map((t) => t.slice(1)))].slice(0, 15);
  return {
    snippet: { title: meta.youtube.title.slice(0, 100), description: meta.youtube.description.slice(0, 4900), tags, categoryId: '25', defaultLanguage: 'en', defaultAudioLanguage: 'en' },
    // The narration is an AI-generated voice: say so (YouTube's "altered or synthetic content" flag).
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false, containsSyntheticMedia: true, embeddable: true },
  };
}
async function youtubeToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env('YT_CLIENT_ID'), client_secret: env('YT_CLIENT_SECRET'), refresh_token: env('YT_REFRESH_TOKEN'), grant_type: 'refresh_token' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`youtube token: ${j.error_description || j.error || r.status}`);
  return j.access_token;
}
async function toYouTube(meta, video, { dry }) {
  if (!env('YT_CLIENT_ID') || !env('YT_CLIENT_SECRET') || !env('YT_REFRESH_TOKEN')) return { skipped: 'YouTube not connected (YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN)' };
  const body = youtubeBody(meta, env('YT_PRIVACY') || 'public');
  if (dry) return { dry: true, body };
  const token = await youtubeToken();
  const start = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(video.length) },
    body: JSON.stringify(body),
  });
  const where = start.headers.get('location');
  if (!start.ok || !where) throw new Error(`youtube upload start: ${start.status} ${(await start.text()).slice(0, 300)}`);
  const put = await fetch(where, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(video.length) }, body: video });
  const j = await put.json().catch(() => ({}));
  if (!put.ok || !j.id) throw new Error(`youtube upload: ${put.status} ${JSON.stringify(j).slice(0, 300)}`);
  return { id: j.id, url: `https://youtube.com/shorts/${j.id}`, privacy: j.status && j.status.privacyStatus };
}

// ---- Instagram ----
// Two kinds of token work: an Instagram-login token (graph.instagram.com) or a Facebook-login one, where the account is reached
// through its linked Facebook Page (graph.facebook.com, with the Page's token, which does not expire). Same publishing calls.
const IG = (host = 'graph.instagram.com') => `https://${host}${env('IG_GRAPH_VERSION') ? '/' + env('IG_GRAPH_VERSION') : ''}`;
async function igCall(method, p, params, host) {
  const url = `${IG(host)}${p}${method === 'GET' ? '?' + new URLSearchParams(params) : ''}`;
  const r = await fetch(url, method === 'GET' ? {} : { method, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const j = await r.json().catch(() => ({}));
  // Meta sometimes quotes the token back in its error ("Malformed access token EAA…"): never print it.
  if (!r.ok || j.error) throw new Error(`instagram ${p}: ${String((j.error && j.error.message) || r.status).replace(/\b(EAA|IG)[A-Za-z0-9_-]{20,}/g, '<token hidden>')}`);
  return j;
}
async function igAuth() {
  const raw = await kv(['GET', 'ig:auth']);
  if (!raw) return null;
  let a = JSON.parse(raw);
  // an Instagram-login token lasts 60 days and can be refreshed once it is a day old; refresh weekly so it never lapses
  // (a Facebook Page token does not expire)
  if ((a.host || 'graph.instagram.com') === 'graph.instagram.com' && Date.now() - (a.refreshedAt || 0) > 7 * 864e5) {
    const r = await fetch(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: a.token })}`);
    const j = await r.json().catch(() => ({}));
    if (j.access_token) { a = { ...a, token: j.access_token, refreshedAt: Date.now(), expiresAt: Date.now() + (j.expires_in || 0) * 1000 }; await kv(['SET', 'ig:auth', JSON.stringify(a)]); }
    else console.warn('instagram token refresh failed:', (j.error && j.error.message) || r.status);
  }
  return a;
}
async function toInstagram(meta, date, { dry }) {
  if (!env('KV_REST_API_URL') || !env('KV_REST_API_TOKEN')) return { skipped: 'KV not configured (it holds the Instagram token)' };
  const a = await igAuth();
  if (!a) return { skipped: 'Instagram not connected (run: node publish.mjs --ig-token <token>)' };
  if (a.expiresAt && a.expiresAt - Date.now() < 7 * 864e5) console.warn(`instagram: the token expires ${new Date(a.expiresAt).toISOString().slice(0, 10)}; generate a new one and run --ig-token again`);
  const params = { media_type: 'REELS', video_url: `${PUBLIC}/shorts/${date}.mp4`, cover_url: `${PUBLIC}/shorts/${date}.jpg`, caption: meta.instagram.caption.slice(0, 2200), share_to_feed: 'true', access_token: a.token };
  if (dry) return { dry: true, account: a.username, params: { ...params, access_token: '…' } };
  const c = await igCall('POST', `/${a.userId}/media`, params, a.host);
  for (let i = 0; i < 40; i++) {                                         // Instagram fetches and processes the video: up to ~6 min
    await new Promise((r) => setTimeout(r, 9000));
    const st = await igCall('GET', `/${c.id}`, { fields: 'status_code,status', access_token: a.token }, a.host);
    if (st.status_code === 'FINISHED') {
      const p = await igCall('POST', `/${a.userId}/media_publish`, { creation_id: c.id, access_token: a.token }, a.host);
      const link = await igCall('GET', `/${p.id}`, { fields: 'permalink', access_token: a.token }, a.host).catch(() => ({}));
      return { id: p.id, url: link.permalink || '' };
    }
    if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error(`instagram processing: ${st.status || st.status_code}`);
  }
  throw new Error('instagram: the video was still processing after 6 minutes');
}
// One-time: store a long-lived token (from the Meta app's "Generate token" for the Instagram account) and its account id.
async function saveIgToken(token, igId) {
  // A Unified-login token that can't list its accounts: the Instagram account id comes from the Meta app page (--ig-id).
  if (igId) {
    const acct = await igCall('GET', `/${igId}`, { fields: 'username', access_token: token }, 'graph.facebook.com');
    await kv(['SET', 'ig:auth', JSON.stringify({ host: 'graph.facebook.com', token, userId: igId, username: acct.username, refreshedAt: Date.now() })]);
    return { user_id: igId, username: acct.username, account_type: 'Unified login', via: 'Unified login' };
  }
  try {
    const me = await igCall('GET', '/me', { fields: 'user_id,username,account_type', access_token: token });
    await kv(['SET', 'ig:auth', JSON.stringify({ host: 'graph.instagram.com', token, userId: me.user_id, username: me.username, refreshedAt: 0 })]);
    return { ...me, via: 'Instagram login' };
  } catch (e) {
    // a Facebook-login token: find the Page with an Instagram professional account and keep that Page's token
    const pages = await igCall('GET', '/me/accounts', { fields: 'name,access_token,instagram_business_account{id,username}', access_token: token }, 'graph.facebook.com')
      .catch((e2) => { throw new Error(`that token works with neither Instagram login (${e.message}) nor Facebook login (${e2.message})`); });
    const pg = (pages.data || []).find((x) => x.instagram_business_account);
    if (!pg) {
      // "Unified login" (Facebook Login for Business with an Instagram configuration): no Page, but the grant itself names the
      // Instagram account(s) it covers (debug_token's granular_scopes target_ids). The user token then posts to that account.
      const dbg = await igCall('GET', '/debug_token', { input_token: token, access_token: token }, 'graph.facebook.com').catch(() => ({}));
      const d = dbg.data || {};
      const scope = (d.granular_scopes || []).find((g) => g.scope === 'instagram_content_publish') || (d.granular_scopes || []).find((g) => g.scope === 'instagram_basic');
      const igId = scope && scope.target_ids && scope.target_ids[0];
      if (igId) {
        const acct = await igCall('GET', `/${igId}`, { fields: 'username', access_token: token }, 'graph.facebook.com');
        const expiresAt = d.expires_at ? d.expires_at * 1000 : 0;
        await kv(['SET', 'ig:auth', JSON.stringify({ host: 'graph.facebook.com', token, userId: igId, username: acct.username, expiresAt, refreshedAt: Date.now() })]);
        const left = expiresAt ? `expires ${new Date(expiresAt).toISOString().slice(0, 10)} (${Math.round((expiresAt - Date.now()) / 864e5)} days)` : 'does not expire';
        return { user_id: igId, username: acct.username, account_type: `token ${left}`, via: 'Unified login' };
      }
      const perms = await igCall('GET', '/me/permissions', { access_token: token }, 'graph.facebook.com').catch(() => ({ data: [] }));
      throw new Error(['Could not connect. What the token can see:',
        `  token type: ${/^IG/.test(token) ? 'Instagram (IG…)' : /^EAA/.test(token) ? 'Facebook (EAA…)' : 'unknown (' + token.slice(0, 3) + '…)'}, ${token.length} characters`,
        `  Instagram route: ${e.message}`,
        `  Facebook route: ${(pages.data || []).length} Page(s) visible, none with an Instagram professional account linked`,
        `  permissions granted: ${(perms.data || []).filter((x) => x.status === 'granted').map((x) => x.permission).join(', ') || '(none listed)'}`].join('\n'));
    }
    const ig = pg.instagram_business_account;
    await kv(['SET', 'ig:auth', JSON.stringify({ host: 'graph.facebook.com', token: pg.access_token, userId: ig.id, username: ig.username, page: pg.name, refreshedAt: Date.now() })]);
    return { user_id: ig.id, username: ig.username, account_type: `via the Facebook Page "${pg.name}"`, via: 'Facebook login' };
  }
}

// ---- YouTube numbers for the dashboard (--stats-save, run nightly by .github/workflows/stats.yml) ----
// Data API: subscribers and each recent upload's views / likes / comments. YouTube Analytics API (needs the
// yt-analytics.readonly scope, granted by re-running youtube-auth.mjs): watch time, average % watched, subscribers gained,
// over the last 28 days. Saved to KV yt:stats (latest) and chan:<IST date> (yt_subs, yt_views) for the trend.
async function youtubeStats() {
  const t = await youtubeToken();
  const yt = async (p) => (await fetch(`https://www.googleapis.com/youtube/v3/${p}`, { headers: { Authorization: `Bearer ${t}` } })).json();
  const me = await yt('channels?part=statistics,contentDetails,snippet&mine=true');
  const c0 = me.items && me.items[0];
  if (!c0) throw new Error('no channel');
  const pl = await yt(`playlistItems?part=contentDetails&maxResults=30&playlistId=${c0.contentDetails.relatedPlaylists.uploads}`);
  const ids = (pl.items || []).map((x) => x.contentDetails.videoId);
  const videos = [];
  if (ids.length) {
    const v = await yt(`videos?part=statistics,snippet,status,contentDetails&id=${ids.join(',')}`);
    for (const x of v.items || []) videos.push({ id: x.id, date: x.snippet.publishedAt.slice(0, 10), title: x.snippet.title, privacy: x.status.privacyStatus,
      views: +x.statistics.viewCount || 0, likes: +x.statistics.likeCount || 0, comments: +x.statistics.commentCount || 0, url: `https://youtube.com/shorts/${x.id}` });
  }
  const out = { at: new Date().toISOString(), channel: c0.snippet.title, subs: +c0.statistics.subscriberCount || 0, totalViews: +c0.statistics.viewCount || 0, videos, analytics: null };
  const end = new Date().toISOString().slice(0, 10), start = new Date(Date.now() - 28 * 864e5).toISOString().slice(0, 10);
  const a = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${new URLSearchParams({ ids: 'channel==MINE', startDate: start, endDate: end, metrics: 'views,estimatedMinutesWatched,averageViewPercentage,subscribersGained,likes,shares' })}`, { headers: { Authorization: `Bearer ${t}` } }).then((r) => r.json()).catch(() => null);
  if (a && a.rows && a.rows[0]) { const r = a.rows[0]; out.analytics = { days: 28, views: r[0], minutesWatched: r[1], avgViewPct: r[2], subsGained: r[3], likes: r[4], shares: r[5] }; }
  else out.analytics = { error: a && a.error ? (a.error.status === 'PERMISSION_DENIED' || a.error.code === 403 ? 'no permission (re-run youtube-auth.mjs)' : a.error.message) : 'unavailable' };
  return out;
}

// ---- run ----
async function main() {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
  // --check: sign in to each connected platform and read the account name, posting nothing.
  if (process.argv.includes('--check')) {
    let bad = 0;
    if (env('YT_CLIENT_ID') && env('YT_CLIENT_SECRET') && env('YT_REFRESH_TOKEN')) {
      try {
        const t = await youtubeToken();
        const ch = await (await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${t}` } })).json();
        console.log(`youtube: OK, signed in, channel "${ch.items && ch.items[0] ? ch.items[0].snippet.title : '?'}"`);
        // read-only engagement: the channel's totals and the last uploads' views / likes / comments
        const yt = async (p) => (await fetch(`https://www.googleapis.com/youtube/v3/${p}`, { headers: { Authorization: `Bearer ${t}` } })).json();
        const me = await yt('channels?part=statistics,contentDetails&mine=true');
        const c0 = me.items && me.items[0];
        if (c0) {
          const st = c0.statistics;
          console.log(`youtube stats: ${st.subscriberCount} subscribers, ${st.viewCount} views, ${st.videoCount} videos`);
          const pl = await yt(`playlistItems?part=contentDetails&maxResults=15&playlistId=${c0.contentDetails.relatedPlaylists.uploads}`);
          const ids = (pl.items || []).map((x) => x.contentDetails.videoId).join(',');
          if (ids) {
            const v = await yt(`videos?part=statistics,snippet,status&id=${ids}`);
            for (const x of v.items || []) console.log(`  ${x.snippet.publishedAt.slice(0, 10)} ${x.status.privacyStatus} views ${x.statistics.viewCount || 0} likes ${x.statistics.likeCount || 0} comments ${x.statistics.commentCount || 0}  ${x.snippet.title.slice(0, 60)}`);
          }
        }
      } catch (e) { bad++; console.log(`youtube: NOT OK, ${e.message}`); }
    } else console.log('youtube: not connected');
    try {
      const a = env('KV_REST_API_URL') ? await igAuth() : null;
      if (!a) console.log('instagram: not connected');
      else { const me = await igCall('GET', `/${a.userId}`, { fields: 'username', access_token: a.token }, a.host); console.log(`instagram: OK, @${me.username} (via ${a.host || 'graph.instagram.com'}${a.expiresAt ? ', token expires ' + new Date(a.expiresAt).toISOString().slice(0, 10) : ''})`); }
    } catch (e) { bad++; console.log(`instagram: NOT OK, ${e.message}`); }
    process.exitCode = bad ? 1 : 0;
    return;
  }
  if (process.argv.includes('--stats-save')) {
    const st = await youtubeStats();
    const istDate = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const sumViews = st.videos.reduce((n, v) => n + v.views, 0);
    await kv(['SET', 'yt:stats', JSON.stringify(st)]);
    await kv(['HSET', `chan:${istDate}`, 'yt_subs', String(st.subs), 'yt_views', String(sumViews), 'yt_videos', String(st.videos.length)]);
    await kv(['EXPIRE', `chan:${istDate}`, String(400 * 86400)]);
    console.log(`youtube: ${st.subs} subscribers, ${st.videos.length} uploads, ${sumViews} views on them; analytics: ${JSON.stringify(st.analytics)}`);
    return;
  }
  if (arg('--ig-token')) { const me = await saveIgToken(arg('--ig-token'), arg('--ig-id')); console.log(`Instagram connected: @${me.username} (${me.account_type}, id ${me.user_id})`); return; }
  const date = arg('--date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('--date YYYY-MM-DD');
  const dry = process.argv.includes('--dry'), force = process.argv.includes('--force'), only = arg('--only');
  const local = arg('--dir');
  const meta = local ? JSON.parse(fs.readFileSync(path.join(local, `${date}.json`), 'utf8')) : await (await fetch(`${PUBLIC}/shorts/${date}.json`, { cache: 'no-store' })).json();
  let video = null;
  const getVideo = async () => (video ||= local ? fs.readFileSync(path.join(local, `${date}.mp4`)) : Buffer.from(await (await fetch(`${PUBLIC}/shorts/${date}.mp4`)).arrayBuffer()));
  let failed = 0;
  for (const [name, fn] of [['youtube', async () => toYouTube(meta, await getVideo(), { dry })], ['instagram', () => toInstagram(meta, date, { dry })]]) {
    if (only && only !== name) continue;
    const key = `short:${name}:${date}`;
    try {
      const done = !dry && !force && (await kv(['GET', key]));
      if (done) { console.log(`${name}: already posted for ${date} (${done})`); continue; }
      const r = await fn();
      if (r.id) await kv(['SET', key, r.url || r.id, 'EX', String(30 * 86400)]);
      console.log(`${name}:`, r.skipped ? `skipped, ${r.skipped}` : JSON.stringify(r));
    } catch (e) { failed++; console.error(`${name}: FAILED, ${e.message}`); }
  }
  if (failed) process.exitCode = 1;
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
