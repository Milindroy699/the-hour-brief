/*
 * Native-app glue for The Hour Brief.
 *
 * The iOS / Android apps (see /mobile) are thin Capacitor shells that load this
 * same site inside a native WebView. This script adds the native touches:
 * in-app navigation, system-browser links, share sheet, haptics, pull-to-
 * refresh, a "new edition" prompt, an offline notice, an optional daily
 * reminder (local notification), and (gated) push.
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
      // Store UGC policies (Play, App Store 1.2) require in-app reporting/blocking for comments; the app omits them.
      '.comments-section{display:none !important;}' +
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
      e.target.closest('.vote-btn, .comment-form button, .nav a, .story-more, .about-toggle, #cap-share, #cap-remind');
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

  // ---- Daily reminder (on-device local notification; no server, no push) ----
  // Shown only in app builds that include @capacitor/local-notifications, so
  // older installs without the plugin are unaffected.
  (function dailyReminder() {
    var LN = P.LocalNotifications;
    var host = document.querySelector('.masthead-inner');
    if (!LN || !host || document.getElementById('cap-remind')) return;

    var NOTIF_ID = 8301, CHANNEL = 'daily-edition', DEFAULT_TIME = '08:30';
    var noop = function () {};
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };

    var st = document.createElement('style');
    st.id = 'cap-remind-style';
    st.textContent =
      '.cap-actions{display:flex;gap:8px;align-items:center;align-self:center;margin-left:auto;flex-shrink:0}' +
      '#cap-remind{display:inline-flex;align-items:center;justify-content:center;' +
        'width:34px;height:31px;padding:0;margin:0;border-radius:8px;cursor:pointer;color:currentColor;' +
        'background:color-mix(in srgb, currentColor 14%, transparent);' +
        'border:1px solid color-mix(in srgb, currentColor 32%, transparent);}' +
      '#cap-share.cap-icon{display:inline-flex;align-items:center;justify-content:center;width:34px;height:31px;padding:0 !important}' +
      '#cap-remind svg,#cap-share.cap-icon svg{width:18px;height:18px;fill:none}#cap-remind.on svg{fill:currentColor}' +
      '@media (max-width:640px){.masthead-inner .wordmark{font-size:1.28rem}}' +
      '#cap-sheet-bg{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;' +
        'align-items:flex-end;justify-content:center}' +
      '#cap-sheet{width:100%;max-width:520px;box-sizing:border-box;background:var(--paper,#f2f3ee);' +
        'color:var(--ink,#17191c);border-radius:16px 16px 0 0;box-shadow:0 -6px 24px rgba(0,0,0,.25);' +
        'padding:20px 20px calc(20px + env(safe-area-inset-bottom,0px));font:15px/1.5 -apple-system,system-ui,sans-serif}' +
      '#cap-sheet h2{margin:0 0 6px;font-size:1.15rem}' +
      '#cap-sheet p{margin:0 0 14px;color:var(--ink-soft,#52585a)}' +
      '#cap-sheet label{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;font-weight:600}' +
      '#cap-sheet input[type=time]{font:inherit;font-size:16px;padding:8px 10px;border:1px solid var(--line,#d7dad2);' +
        'border-radius:8px;background:var(--paper-2,#fff);color:inherit}' +
      '#cap-sheet .cap-status{min-height:1.5em;margin:0 0 12px;font-size:.9rem}' +
      '#cap-sheet .cap-row{display:flex;gap:10px;margin-top:10px}' +
      '#cap-sheet button{flex:1;font:inherit;font-weight:600;min-height:46px;border-radius:10px;cursor:pointer;' +
        'border:1px solid var(--line,#d7dad2);background:transparent;color:inherit}' +
      '#cap-sheet button.cap-primary{background:var(--brand,#5b3e96);border-color:var(--brand,#5b3e96);color:#fff}';
    document.head.appendChild(st);

    function fmt(hhmm) {
      var p = hhmm.split(':');
      return new Date(2000, 0, 1, +p[0], +p[1]).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }

    // The scheduled notification itself is the source of truth for on/off and time.
    function getState() {
      return LN.getPending().then(function (r) {
        var n = (r.notifications || []).filter(function (x) { return x.id === NOTIF_ID; })[0];
        if (!n) return { on: false, time: DEFAULT_TIME };
        var on = n.schedule && n.schedule.on;
        var t = (n.extra && n.extra.time) || (on ? pad(on.hour) + ':' + pad(on.minute) : DEFAULT_TIME);
        return { on: true, time: t };
      }).catch(function () { return { on: false, time: DEFAULT_TIME }; });
    }

    function ensurePermission() {
      return LN.checkPermissions().then(function (p) {
        if (p.display === 'granted') return true;
        if (p.display === 'denied') return false;
        return LN.requestPermissions().then(function (r) { return r.display === 'granted'; });
      }).catch(function () { return false; });
    }

    function enable(h, m, hhmm) {
      return ensurePermission().then(function (ok) {
        if (!ok) return 'denied';
        var channel = LN.createChannel
          ? LN.createChannel({ id: CHANNEL, name: 'Daily edition', importance: 3,
              description: "A morning nudge when the day's edition is ready" }).catch(noop)
          : Promise.resolve();
        return channel
          .then(function () { return LN.cancel({ notifications: [{ id: NOTIF_ID }] }).catch(noop); })
          .then(function () {
            return LN.schedule({ notifications: [{
              id: NOTIF_ID,
              title: 'The Hour Brief',
              body: "Today's edition and quiz are ready — about an hour of reading.",
              channelId: CHANNEL,
              isExactNotification: false,   // default is exact, which sends Android 12+ users to a settings screen
              schedule: { on: { hour: h, minute: m, second: 0 }, allowWhileIdle: true },
              extra: { time: hhmm }
            }] });
          })
          .then(function () { return 'ok'; });
      });
    }

    LN.addListener('localNotificationActionPerformed', function () { location.assign('/'); });

    var btn = document.createElement('button');
    btn.id = 'cap-remind';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Daily reminder');
    btn.innerHTML = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>' +
      '<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
    // Bell + Share sit together on the right as compact icon buttons so the masthead stays one row.
    var share = document.getElementById('cap-share');
    var actions = document.createElement('div');
    actions.className = 'cap-actions';
    host.insertBefore(actions, share);
    actions.appendChild(btn);
    if (share) {
      share.classList.add('cap-icon');
      share.innerHTML = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
        'stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/>' +
        '<path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
      actions.appendChild(share);
    }
    function setBell(on) { btn.classList.toggle('on', !!on); }

    var sheet = null;
    function close() { if (sheet) { sheet.remove(); sheet = null; } }
    function open() {
      if (sheet) return;
      sheet = document.createElement('div');
      sheet.id = 'cap-sheet-bg';
      sheet.innerHTML =
        '<div id="cap-sheet" role="dialog" aria-modal="true" aria-labelledby="cap-sheet-title">' +
        '<h2 id="cap-sheet-title">Daily reminder</h2>' +
        "<p>A quiet nudge each morning when the day's edition is ready. It is set on this device; nothing is sent to our servers.</p>" +
        '<label>Remind me at <input type="time" id="cap-remind-time" value="' + DEFAULT_TIME + '"></label>' +
        '<p class="cap-status" id="cap-remind-status" role="status" aria-live="polite"></p>' +
        '<div class="cap-row"><button type="button" id="cap-remind-off" hidden>Turn off</button>' +
        '<button type="button" class="cap-primary" id="cap-remind-on">Turn on</button></div>' +
        '<div class="cap-row"><button type="button" id="cap-remind-close">Close</button></div></div>';
      document.body.appendChild(sheet);
      var timeEl = sheet.querySelector('#cap-remind-time');
      var status = sheet.querySelector('#cap-remind-status');
      var onBtn = sheet.querySelector('#cap-remind-on');
      var offBtn = sheet.querySelector('#cap-remind-off');

      function refresh(msg) {
        return getState().then(function (s) {
          if (!sheet) return;
          timeEl.value = s.time;
          offBtn.hidden = !s.on;
          onBtn.textContent = s.on ? 'Save time' : 'Turn on';
          status.textContent = msg || (s.on ? 'On: every day at ' + fmt(s.time) + '.' : '');
          setBell(s.on);
        });
      }

      sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });
      sheet.querySelector('#cap-remind-close').addEventListener('click', close);
      offBtn.addEventListener('click', function () {
        LN.cancel({ notifications: [{ id: NOTIF_ID }] }).catch(noop).then(function () { return refresh('Reminder turned off.'); });
      });
      onBtn.addEventListener('click', function () {
        var v = timeEl.value || DEFAULT_TIME;
        var p = v.split(':');
        status.textContent = 'Setting up…';
        enable(parseInt(p[0], 10), parseInt(p[1], 10), v).then(function (res) {
          if (res === 'ok') return refresh();
          status.textContent = 'Notifications are turned off for The Hour Brief. Turn them on in your device settings, then try again.';
        }).catch(function () { status.textContent = 'Could not set the reminder. Please try again.'; });
      });
      refresh();
    }

    btn.addEventListener('click', open);
    // Re-arm on every launch: Android drops alarms on force-stop, which would leave a reminder that looks on but never fires.
    getState().then(function (s) {
      setBell(s.on);
      if (!s.on) return;
      var p = s.time.split(':');
      LN.checkPermissions().then(function (r) {
        if (r.display === 'granted') return enable(parseInt(p[0], 10), parseInt(p[1], 10), s.time);
      }).catch(noop);
    });
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

  // ---- Push notifications — not in the app yet ----
  //
  // @capacitor/push-notifications is not installed in the v1 release (it drags
  // in the whole Firebase stack + a POST_NOTIFICATIONS permission for a feature
  // that has no backend sender). To add push later:
  //   1. npm i @capacitor/push-notifications && npx cap sync
  //   2. google-services.json (Android) + APNs key & entitlement (iOS)
  //   3. the sender job (see /mobile/README.md "Push notifications")
  //   4. add <meta name="thb-push" content="on"> to the site <head>
  // This block already no-ops when the plugin is absent.
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
