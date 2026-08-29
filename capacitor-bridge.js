/*
 * Native-app glue for The Hour Brief.
 *
 * The iOS / Android apps (see /mobile) are thin Capacitor shells that load this
 * same site inside a native WebView. This script adds the native touches:
 * in-app navigation, system-browser links, share sheet, haptics, pull-to-
 * refresh, a "new edition" prompt, an offline notice, and (gated) push.
 *
 * It is a no-op in a normal browser: everything is gated on window.Capacitor.
 */
(function () {
  var Cap = window.Capacitor;
  if (!Cap || typeof Cap.isNativePlatform !== 'function' || !Cap.isNativePlatform()) return;

  var P = Cap.Plugins || {};
  var SITE_HOST = location.host;

  // Dismiss the native splash as soon as the page has painted. The plugin also
  // auto-hides after launchShowDuration (2s) as a safety net if this never runs.
  if (P.SplashScreen) {
    try { P.SplashScreen.hide(); } catch (e) {}
  }

  // ---- Shared injected stylesheet for the bits this script builds ----
  (function injectStyle() {
    var css =
      '.masthead-band{padding-top:calc(12px + env(safe-area-inset-top,0px)) !important;}' +
      'body{padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px);}' +
      '#cap-ptr{position:fixed;left:0;right:0;top:0;z-index:9998;display:flex;justify-content:center;' +
        'pointer-events:none;opacity:0;transform:translateY(-44px);transition:opacity .15s ease;' +
        'padding-top:calc(env(safe-area-inset-top,0px) + 8px);}' +
      '#cap-ptr .cap-ptr-spin{width:22px;height:22px;border-radius:50%;' +
        'border:2px solid rgba(128,128,128,.35);border-top-color:var(--brand,#5b3e96);}' +
      '#cap-ptr.spinning .cap-ptr-spin{animation:cap-ptr-rot .7s linear infinite;}' +
      '@keyframes cap-ptr-rot{to{transform:rotate(360deg)}}' +
      '@media (prefers-reduced-motion:reduce){#cap-ptr.spinning .cap-ptr-spin{animation:none}}' +
      '#cap-newedition{position:fixed;left:0;right:0;top:0;z-index:9997;display:flex;align-items:stretch;' +
        'background:var(--brand,#5b3e96);color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.25);' +
        'padding-top:env(safe-area-inset-top,0px);}' +
      '#cap-newedition .cap-ne-go{flex:1;background:none;border:0;color:#fff;font:inherit;' +
        'font-size:.9rem;font-weight:600;text-align:left;padding:12px 14px;cursor:pointer;}' +
      '#cap-newedition .cap-ne-x{flex:0 0 auto;background:none;border:0;color:#fff;font-size:1.3rem;' +
        'line-height:1;min-width:44px;min-height:44px;cursor:pointer;}' +
      '#cap-offline{position:fixed;left:0;right:0;bottom:0;z-index:9996;display:flex;align-items:center;' +
        'justify-content:center;gap:6px;background:#17191c;color:#f2f3ee;' +
        'font:14px -apple-system,system-ui,sans-serif;' +
        'padding:10px 10px calc(10px + env(safe-area-inset-bottom,0px));}' +
      '#cap-offline .cap-off-x{background:none;border:0;color:inherit;font-size:1.1rem;' +
        'min-width:40px;min-height:40px;cursor:pointer;}';
    var s = document.createElement('style');
    s.id = 'cap-style';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  })();

  // ---- Status bar: track the (theme-aware) masthead ----
  (function statusBar() {
    if (!P.StatusBar) return;
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    try {
      P.StatusBar.setStyle({ style: prefersDark ? 'LIGHT' : 'DARK' });
      if (P.StatusBar.setBackgroundColor) {
        P.StatusBar.setBackgroundColor({ color: prefersDark ? '#edeeec' : '#17191c' });
      }
    } catch (e) {}
  })();

  // ---- Link handling ----
  // Same-host pages navigate in place (Android hardware back then works);
  // feeds and every off-site source link open in the system browser.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var raw = a.getAttribute('href');
    if (!raw || raw.charAt(0) === '#') return;
    var url;
    try { url = new URL(raw, location.href); } catch (_) { return; }
    if (url.protocol === 'mailto:' || url.protocol === 'tel:') return;

    if (url.host === SITE_HOST) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      if (/\.xml($|\?)/.test(url.pathname)) {          // feed.xml renders as raw markup in a WebView
        e.preventDefault();
        openExternal(url.href);
        return;
      }
      e.preventDefault();
      location.assign(url.href);
      return;
    }

    e.preventDefault();
    openExternal(url.href);
  }, true);

  function openExternal(href) {
    if (P.Browser) { P.Browser.open({ url: href, presentationStyle: 'popover' }).catch(function () {}); }
    else { window.open(href, '_system'); }
  }

  // ---- Haptics on the interactive controls ----
  document.addEventListener('click', function (e) {
    if (!P.Haptics) return;
    var hit = e.target.closest &&
      e.target.closest('.vote-btn, .comment-form button, .nav a, .story-more, .about-toggle, #cap-share');
    if (hit) { try { P.Haptics.impact({ style: 'LIGHT' }); } catch (e) {} }
  }, true);

  // ---- Share button in the masthead ----
  (function addShareButton() {
    var host = document.querySelector('.masthead-inner');
    if (!host || document.getElementById('cap-share')) return;
    var btn = document.createElement('button');
    btn.id = 'cap-share';
    btn.type = 'button';
    btn.textContent = 'Share';
    btn.setAttribute('aria-label', 'Share this edition');
    btn.style.cssText = 'align-self:center;margin:0;font:inherit;font-size:.8rem;line-height:1;' +
      'padding:7px 12px;border-radius:8px;cursor:pointer;color:currentColor;' +
      'background:color-mix(in srgb, currentColor 14%, transparent);' +
      'border:1px solid color-mix(in srgb, currentColor 32%, transparent);';
    btn.addEventListener('click', function () {
      var payload = { title: document.title, text: document.title, url: location.href,
        dialogTitle: 'Share The Hour Brief' };
      if (P.Share) { P.Share.share(payload).catch(function () {}); }
      else if (navigator.share) { navigator.share(payload).catch(function () {}); }
    });
    host.appendChild(btn);
  })();

  // ---- Pull to refresh ----
  (function pullToRefresh() {
    var el = document.createElement('div');
    el.id = 'cap-ptr';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<span class="cap-ptr-spin"></span>';
    (document.body ? Promise.resolve() : new Promise(function (r) {
      document.addEventListener('DOMContentLoaded', r);
    })).then(function () { document.body.appendChild(el); });

    var startY = 0, tracking = false, armed = false;
    var THRESH = 64, DAMP = 0.5, MAX = 96;

    window.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1 || window.scrollY > 0) { tracking = false; return; }
      startY = e.touches[0].clientY;
      tracking = true;
      armed = false;
    }, { passive: true });

    window.addEventListener('touchmove', function (e) {
      if (!tracking) return;
      var dy = e.touches[0].clientY - startY;
      if (dy <= 0 || window.scrollY > 0) { reset(); return; }
      var pull = Math.min(dy * DAMP, MAX);
      el.style.opacity = String(Math.min(pull / THRESH, 1));
      el.style.transform = 'translateY(' + (pull - 44) + 'px)';
      armed = pull >= THRESH;
      el.classList.toggle('armed', armed);
    }, { passive: true });

    window.addEventListener('touchend', function () {
      if (!tracking) return;
      tracking = false;
      if (armed && navigator.onLine) {
        el.classList.add('spinning');
        el.style.opacity = '1';
        el.style.transform = 'translateY(8px)';
        location.reload();
      } else {
        reset();
      }
    }, { passive: true });

    function reset() {
      tracking = false; armed = false;
      el.classList.remove('armed');
      el.style.opacity = '0';
      el.style.transform = 'translateY(-44px)';
    }
  })();

  // ---- "New edition available" ----
  (function newEditionWatch() {
    var path = location.pathname.replace(/index\.html$/, '');
    if (path !== '/') return;
    if (document.querySelector('.archive-banner')) return;
    var pageEl = document.querySelector('[data-edition-date]');
    var current = pageEl && (pageEl.getAttribute('data-edition-date') || '');
    if (!current) return;

    var dismissKey = function (d) { return 'hb-newedition-dismissed-' + d; };
    var banner = null;

    function check() {
      fetch('/editions.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          var eds = data && data.editions;
          if (!eds || !eds.length) return;
          var latest = eds[eds.length - 1];
          if (!latest || !latest.date || latest.date <= current) return;
          try { if (localStorage.getItem(dismissKey(latest.date))) return; } catch (e) {}
          show(latest);
        })
        .catch(function () {});
    }

    function show(latest) {
      if (banner) return;
      banner = document.createElement('div');
      banner.id = 'cap-newedition';
      banner.setAttribute('role', 'status');
      var go = document.createElement('button');
      go.type = 'button';
      go.className = 'cap-ne-go';
      go.textContent = 'New edition available — tap to refresh';
      go.addEventListener('click', function () { location.href = '/'; });
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'cap-ne-x';
      x.setAttribute('aria-label', 'Dismiss');
      x.innerHTML = '&times;';
      x.addEventListener('click', function () {
        try { localStorage.setItem(dismissKey(latest.date), '1'); } catch (e) {}
        if (banner) { banner.remove(); banner = null; }
      });
      banner.appendChild(go);
      banner.appendChild(x);
      document.body.appendChild(banner);
    }

    check();
    if (P.App) {
      P.App.addListener('appStateChange', function (s) { if (s && s.isActive) check(); });
    }
    setInterval(check, 10 * 60 * 1000);
  })();

  // ---- Offline notice ----
  (function offline() {
    var banner = null;
    var dismissed = false;
    function reflect(online) {
      if (online) {
        dismissed = false;
        if (banner) { banner.remove(); banner = null; }
        return;
      }
      if (banner || dismissed) return;
      banner = document.createElement('div');
      banner.id = 'cap-offline';
      banner.setAttribute('role', 'status');
      var msg = document.createElement('span');
      msg.textContent = 'Offline — showing the last loaded edition';
      var x = document.createElement('button');
      x.className = 'cap-off-x';
      x.setAttribute('aria-label', 'Dismiss');
      x.innerHTML = '&times;';
      x.addEventListener('click', function () {
        dismissed = true;
        if (banner) { banner.remove(); banner = null; }
      });
      banner.appendChild(msg);
      banner.appendChild(x);
      document.body.appendChild(banner);
    }
    window.addEventListener('online', function () { reflect(true); });
    window.addEventListener('offline', function () { reflect(false); });
    if (!navigator.onLine) reflect(false);
  })();

  // ---- Push notifications — OFF until the backend can send them ----
  //
  // On Android, PushNotifications.register() throws a *native* crash
  // ("Default FirebaseApp is not initialized") when google-services.json is
  // absent — it cannot be caught from JS. So this stays dormant until push is
  // fully set up: add google-services.json (Android) + the APNs key and
  // entitlement (iOS) + the sender job, then add
  //   <meta name="thb-push" content="on">
  // to the site's <head>. See /mobile/README.md "Push notifications".
  var pushMeta = document.querySelector('meta[name="thb-push"]');
  var pushEnabled = pushMeta && pushMeta.getAttribute('content') === 'on';

  if (P.PushNotifications && pushEnabled) {
    P.PushNotifications.addListener('registration', function (token) {
      fetch('/api/register-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.value, platform: Cap.getPlatform() })
      }).catch(function () {});
    });
    P.PushNotifications.addListener('pushNotificationActionPerformed', function (action) {
      var data = action && action.notification && action.notification.data;
      if (data && data.url) { location.href = data.url; }
    });
    P.PushNotifications.checkPermissions()
      .then(function (res) {
        if (res.receive === 'prompt' || res.receive === 'prompt-with-rationale') {
          return P.PushNotifications.requestPermissions();
        }
        return res;
      })
      .then(function (res) {
        if (res && res.receive === 'granted') {
          try { P.PushNotifications.register().catch(function () {}); } catch (e) {}
        }
      })
      .catch(function () {});
  }

  // ---- Android hardware back button ----
  if (P.App) {
    P.App.addListener('backButton', function (info) {
      if (info && info.canGoBack) { window.history.back(); }
      else if (P.App.exitApp) { P.App.exitApp(); }
    });
  }
})();
