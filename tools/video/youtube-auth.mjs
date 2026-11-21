// One-time YouTube connection for publish.mjs. Run on your own computer (it opens your browser):
//
//   node tools/video/youtube-auth.mjs <client-id> <client-secret>
//
// The client is a Google Cloud OAuth client of type "Desktop app" in a project with the YouTube Data API v3 enabled and its
// OAuth consent screen PUBLISHED ("In production"; in "Testing" Google expires the sign-in after 7 days). Sign in with the
// Google account that owns The Hour Brief's YouTube channel (pick the channel if asked). The script receives the answer on a
// local address, then stores YT_CLIENT_ID, YT_CLIENT_SECRET and YT_REFRESH_TOKEN as GitHub Actions secrets with `gh`
// (nothing is printed), and checks which channel it can upload to.
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';

const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) { console.error('Usage: node youtube-auth.mjs <client-id> <client-secret>'); process.exit(2); }
const PORT = 8765, REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const state = Math.random().toString(36).slice(2);
const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId, redirect_uri: REDIRECT, response_type: 'code', access_type: 'offline', prompt: 'consent', state,
  scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly',   // analytics: watch time etc. on the growth dashboard
});

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECT);
  if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
  const done = (msg) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<p style="font:18px system-ui;padding:40px">${msg}</p>`); server.close(); };
  if (u.searchParams.get('state') !== state || !u.searchParams.get('code')) { done('Sign-in was cancelled or did not match. Run the script again.'); process.exitCode = 1; return; }
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: u.searchParams.get('code'), client_id: clientId, client_secret: clientSecret, redirect_uri: REDIRECT, grant_type: 'authorization_code' }),
    });
    const t = await r.json();
    if (!t.refresh_token) throw new Error(t.error_description || t.error || 'no refresh token returned');
    const ch = await (await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${t.access_token}` } })).json();
    const name = ch.items && ch.items[0] ? ch.items[0].snippet.title : '(no channel found on this account)';
    for (const [k, v] of [['YT_CLIENT_ID', clientId], ['YT_CLIENT_SECRET', clientSecret], ['YT_REFRESH_TOKEN', t.refresh_token]]) execFileSync('gh', ['secret', 'set', k], { input: v });
    console.log(`YouTube connected: uploads will go to "${name}". Secrets YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN set on GitHub.`);
    done(`Connected to <b>${name.replace(/</g, '&lt;')}</b>. You can close this tab.`);
  } catch (e) { console.error('Failed:', e.message); process.exitCode = 1; done('Something went wrong: ' + String(e.message).replace(/</g, '&lt;')); }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log('Opening Google sign-in. If no browser opens, visit:\n' + url);
  try { spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true }).unref(); } catch (e) { /* the link is printed */ }
});
