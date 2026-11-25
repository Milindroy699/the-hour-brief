/* The app's copy of itself (owner, 2026-11-25: "bundle the app code inside the app", with live updates). Registered by
 * capacitor-bridge.js in the iPhone and Android apps only; the website never installs it.
 *
 * What it does:
 *   - keeps every file in /app-manifest.json (tools/app/manifest.mjs: pages, code, fonts, the app's pictures, the last
 *     week's editions) on the phone, and serves them from there: screens open with no network, also offline;
 *   - checks for a new version on each open of the app (at most every 30 s) and downloads only the files whose fingerprint
 *     changed; it switches to them only once ALL have arrived and the same version is still live, so a page never mixes old
 *     and new code;
 *   - on opening the edition (index.html) after 5 minutes or more, waits up to 2.5 s for that check first, so the morning's
 *     edition is there on the first open, not one open later;
 *   - keeps pictures and past editions once they have been seen; data (/editions.json, /leaders-data.json) is fetched fresh
 *     and kept only as a fallback; nothing else (/api, shares, analytics) is ever touched.
 * Kill switch: a manifest with { off: true } (APP_CACHE=off on Vercel) makes every phone drop its copy and reload. */
'use strict';
var CORE = 'hb-core-v1', SEEN = 'hb-seen-v1', META = 'hb-meta-v1';
var checking = null, lastCheck = 0, lastOk = 0;

function pathOf(u) { var p = new URL(u).pathname; return p === '/' ? '/index.html' : p === '/voices' ? '/leaders.html' : p.replace(/\/$/, '/index.html'); }
function meta() { return caches.open(META).then(function (c) { return c.match('/__manifest'); }).then(function (r) { return r ? r.json() : null; }).catch(function () { return null; }); }
function tell(msg) { return self.clients.matchAll({ includeUncontrolled: true }).then(function (cs) { cs.forEach(function (c) { c.postMessage(msg); }); }); }

// One check at a time. Resolves true when a new version was put in place.
function check(force) {
  if (checking) return checking;
  if (!force && Date.now() - lastCheck < 30000) return Promise.resolve(false);
  lastCheck = Date.now();
  checking = Promise.all([fetch('/app-manifest.json', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('manifest ' + r.status); return r.json(); }), meta()])
    .then(function (a) {
      var m = a[0], old = a[1];
      lastOk = Date.now();
      if (m.off) return Promise.all([caches.delete(CORE), caches.delete(SEEN), caches.delete(META)]).then(function () { return self.registration.unregister(); }).then(function () { tell({ type: 'hb-off' }); return false; });
      if (old && old.v === m.v) return false;
      var want = Object.keys(m.files).filter(function (p) { return !old || !old.files || old.files[p] !== m.files[p]; });
      // download every changed file first and check its fingerprint; only then swap them all in
      return Promise.all(want.map(function (p) {
        return fetch(p, { cache: 'no-store' }).then(function (r) {
          if (!r.ok) throw new Error(p + ' ' + r.status);
          var type = r.headers.get('Content-Type') || '';
          return r.arrayBuffer().then(function (b) { return [p, new Response(b, { status: 200, headers: { 'Content-Type': type } })]; });   // a plain copy (never a redirect)
        });
      })).then(function (got) {
        // the same version still live once everything has arrived: nothing was deployed mid-way, so the files belong together
        return fetch('/app-manifest.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (again) {
          if (again.v !== m.v) throw new Error('a new version landed while downloading');
          return got;
        });
      }).then(function (got) {
        return caches.open(CORE).then(function (c) {
          return Promise.all(got.map(function (g) { return c.put(g[0], g[1]); })).then(function () {
            var gone = old && old.files ? Object.keys(old.files).filter(function (p) { return !(p in m.files); }) : [];
            return Promise.all(gone.map(function (p) { return c.delete(p); }));
          });
        }).then(function () {
          return caches.open(META).then(function (c) { return c.put('/__manifest', new Response(JSON.stringify(m), { headers: { 'Content-Type': 'application/json' } })); });
        }).then(function () {
          tell({ type: 'hb-updated', v: m.v, edition: m.edition, files: want.length, first: !old });
          return true;
        });
      });
    })
    .catch(function () { return false; })          // offline, or a deploy landed mid-way: the copy we have stays, next check retries
    .then(function (x) { checking = null; return x; });
  return checking;
}

self.addEventListener('install', function (e) { e.waitUntil(check(true).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return [CORE, SEEN, META].indexOf(k) < 0 && /^hb-/.test(k); }).map(function (k) { return caches.delete(k); })); })
    .then(function () { return self.clients.claim(); }));
});
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'hb-check') e.waitUntil(check(true).then(function (changed) { if (!changed) return tell({ type: 'hb-checked' }); }));
});

function fromCore(p) { return caches.open(CORE).then(function (c) { return c.match(p); }); }
function keep(cacheName, req, res) { if (res && res.ok && res.type === 'basic') { var cp = res.clone(); caches.open(cacheName).then(function (c) { c.put(req, cp); }); } return res; }
function timeout(ms) { return new Promise(function (r) { setTimeout(function () { r(false); }, ms); }); }

var DATA = /^\/(editions\.json|leaders-data\.json)$/;
var SKIP = /^\/(api|_vercel|ep|e|s|q|l)\/|^\/(app-manifest\.json|sw\.js|growth\.html|app-analytics\.html|share-kit\.html|substack\.html)$/;
var SEEN_OK = /^\/(brand\/.+\.(png|jpg|jpeg|webp|svg)|archive\/\d{4}-\d{2}-\d{2}\.html|og-image\.png|fonts\/.+)$/;

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var p = pathOf(req.url);
  if (SKIP.test(url.pathname)) return;
  if (DATA.test(p)) {                                // fresh when online, the last copy when not
    e.respondWith(fetch(req).then(function (r) { return keep(SEEN, p, r); }).catch(function () { return caches.match(p); }));
    return;
  }
  e.respondWith(
    (p === '/index.html' && req.mode === 'navigate' && Date.now() - lastOk > 300000 ? Promise.race([check(false), timeout(2500)]) : Promise.resolve())
      .then(function () { if (req.mode === 'navigate' || p === '/index.html') check(false); return fromCore(p); })
      .then(function (hit) {
        if (hit) return hit;
        return caches.open(SEEN).then(function (c) { return c.match(p); }).then(function (seen) {
          if (seen) return seen;
          return fetch(req).then(function (r) { return SEEN_OK.test(p) ? keep(SEEN, p, r) : r; });
        });
      })
      .catch(function () { return fetch(req); })
  );
});
