/* Accounts and the first-run welcome (owner, 2026-11-26).
 *
 * Onboarding, in the apps, once, for someone new (nothing played or saved yet): a welcome with the hourglass (the owner's
 * Veo clip, brand/motion/hourglass.mp4), what's inside (the brief and its sections, Listen, the daily quiz, Voices), how
 * it works (cards, Listen, the tabs, and a morning reminder), then sign-in. Skip jumps to sign-in, which has its own
 * "Stay anonymous for now".
 *
 * Sign-in: a phone number and a 4-digit PIN (api/_account.js; the number is never stored, only a keyed hash and its last
 * two digits); Google and Apple appear when the app build has native sign-in (Capacitor FirebaseAuthentication plugin).
 * Signed in, what the phone keeps (quiz results and badges, saved stories, leagues, sections, text size, theme) is merged
 * with the account and kept in step: after a quiz, a saved story, and whenever the app goes to the background.
 *
 * Staying anonymous is fine; a few quiet reminders later (HBAccount.nudge): on the score once a streak is worth keeping,
 * a small card on Home now and then (at most three times, a week apart), and the sign-in in You.
 * Account deletion is in You (App Store guideline 5.1.1(v)). */
(function () {
  'use strict';
  if (window.HBAccount) return;
  var ACCT = 'hb-acct-v1', ONB = 'hb-onb-v1', NUDGE = 'hb-nudge-v1';
  var Cap = window.Capacitor, NATIVE = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  var P = (Cap && Cap.Plugins) || {};
  var IOS = NATIVE && Cap.getPlatform && Cap.getPlatform() === 'ios';
  var HC = function () { return window.HBChrome || {}; };
  var use = function (f) { if (window.HBUse) window.HBUse(f); };

  function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(cls, text) { var b = mk('button', cls, text); b.type = 'button'; return b; }
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* this visit only */ } }
  function json(k, d) { try { var v = JSON.parse(get(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  // ---- the account on this phone ----
  function acct() { return json(ACCT, null); }
  function signedIn() { var a = acct(); return !!(a && a.token); }
  function api(action, extra) {
    var body = { op: 'account', action: action };
    for (var k in extra || {}) body[k] = extra[k];
    return fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, d: j }; }); });
  }
  // What the account keeps, as this phone has it
  var KEYS = { quiz: 'hb-quiz-v1', saved: 'hb-saved-v1', league: 'hb-league-v1', prefs: 'hb-prefs-v1' };
  function gather() {
    var d = {};
    for (var k in KEYS) { var v = json(KEYS[k], undefined); if (v !== undefined) d[k] = v; }
    var ts = get('hb-textsize'), sk = get('hb-skin-v1');
    if (ts != null) d.textsize = ts;
    if (sk != null) d.skin = sk;
    return d;
  }
  // The merged copy back onto the phone; says what changed
  function apply(d) {
    var changed = {};
    if (!d) return changed;
    for (var k in KEYS) {
      if (d[k] === undefined) continue;
      var s = JSON.stringify(d[k]);
      if (get(KEYS[k]) !== s) { set(KEYS[k], s); changed[k] = true; }
    }
    if (d.textsize != null && get('hb-textsize') !== String(d.textsize)) { set('hb-textsize', String(d.textsize)); changed.textsize = true; }
    if (d.skin != null && get('hb-skin-v1') !== String(d.skin)) { set('hb-skin-v1', String(d.skin)); changed.skin = true; }
    return changed;
  }
  function keep(r) { set(ACCT, JSON.stringify({ token: r.token, account: r.account, at: Date.now() })); }

  var syncing = null, syncT = 0;
  function sync() {
    if (!signedIn() || syncing) return syncing || Promise.resolve(null);
    var a = acct();
    syncing = api('sync', { token: a.token, data: gather() }).then(function (r) {
      syncing = null;
      if (r.status === 401) { set(ACCT, null); notify(); return null; }
      if (!r.ok) return null;
      a.account = r.d.account; a.at = Date.now();
      set(ACCT, JSON.stringify(a));
      var ch = apply(r.d.data);
      if (ch.skin && window.HBSkin) window.HBSkin.apply();
      return ch;
    }, function () { syncing = null; return null; });
    return syncing;
  }
  function syncSoon() { clearTimeout(syncT); if (signedIn()) syncT = setTimeout(sync, 2500); }
  document.addEventListener('hb:quiz', syncSoon);
  document.addEventListener('hb:saved', syncSoon);
  document.addEventListener('hb:skin', syncSoon);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && signedIn()) sync(); });

  // After signing in on a phone that already had leagues: the account's league id may differ from this phone's, so join
  // those leagues again under the account's (a new name on their boards; the old one keeps its past days)
  function rejoin(before, after) {
    if (!before || !after || !before.mid || before.mid === after.mid) return;
    (before.leagues || []).forEach(function (l) {
      fetch('/api/league', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'join', code: l.code, mid: after.mid }) }).catch(function () { /* next visit */ });
    });
  }
  function finishSignIn(r, how) {
    var before = json(KEYS.league, null);
    keep(r.d);
    var ch = apply(r.d.data);
    rejoin(before, r.d.data && r.d.data.league);
    use(how);
    notify();
    return ch;
  }
  var listeners = [];
  function notify() { listeners.forEach(function (f) { try { f(); } catch (e) { /* ignore */ } }); document.dispatchEvent(new CustomEvent('hb:account')); }

  // ---- the sign-in flow (also the last step of onboarding) ----
  // Google on Android needs the app's signing fingerprints in Firebase (google-services.json with Android OAuth clients);
  // until they are in, Android shows phone sign-in only. Flip to true once they are (no app build needed).
  var ANDROID_GOOGLE = true;
  function nativeAuth() { return P.FirebaseAuthentication && (IOS || ANDROID_GOOGLE) ? P.FirebaseAuthentication : null; }
  function oauth(provider, status, done) {
    var F = nativeAuth();
    if (!F) return;
    status('Opening ' + (provider === 'apple' ? 'Apple' : 'Google') + '…', false);
    var call = provider === 'apple' ? F.signInWithApple() : F.signInWithGoogle();
    call.then(function () { return F.getIdToken({ forceRefresh: true }); }).then(function (t) {
      return api('oauth', { idToken: t && t.token, data: gather() });
    }).then(function (r) {
      if (!r.ok) { status((r.d && r.d.error) || 'Could not sign in. Please try again.', true); return; }
      done(finishSignIn(r, provider === 'apple' ? 'signin_apple' : 'signin_google'), r.d.account);
    }).catch(function () { status('Sign-in was cancelled.', true); });
  }
  // Builds the sign-in panel into `host`; onDone(changed, account) after success, onSkip() for "stay anonymous"
  function signInPanel(host, opts) {
    opts = opts || {};
    host.textContent = '';
    var wrap = mk('div', 'acc-panel');
    host.appendChild(wrap);
    var msg = mk('p', 'acc-msg');
    msg.setAttribute('role', 'status');
    function status(t, err) { msg.textContent = t || ''; msg.classList.toggle('err', !!err); }
    function done(ch, account) {
      wrap.textContent = '';
      var ok = mk('div', 'acc-done');
      ok.appendChild(mk('span', 'acc-done-ic', '✓'));
      ok.appendChild(mk('h2', 'acc-h', 'You’re signed in'));
      ok.appendChild(mk('p', 'acc-p', (account && account.phone ? 'With your number ' + account.phone + '. ' : '') + 'Your streak, badges and saved stories are kept with your account now.'));
      wrap.appendChild(ok);
      setTimeout(function () { if (opts.onDone) opts.onDone(ch, account); }, 1300);
    }
    function start() {
      wrap.textContent = '';
      wrap.appendChild(mk('h2', 'acc-h', opts.title || 'Keep your streak safe'));
      wrap.appendChild(mk('p', 'acc-p', opts.text || 'Sign in to keep your quiz streak, badges, saved stories and leagues, on this phone and any other.'));
      var phone = btn('acc-btn acc-primary', 'Continue with phone number');
      phone.addEventListener('click', askPhone);
      wrap.appendChild(phone);
      if (nativeAuth()) {
        var g = btn('acc-btn acc-google', 'Continue with Google');
        g.addEventListener('click', function () { oauth('google', status, done); });
        wrap.appendChild(g);
        if (IOS) {
          var ap = btn('acc-btn acc-apple', 'Continue with Apple');
          ap.addEventListener('click', function () { oauth('apple', status, done); });
          wrap.appendChild(ap);
        }
      }
      wrap.appendChild(msg);
      if (opts.onSkip) {
        var skip = btn('acc-link', opts.skipText || 'Stay anonymous for now');
        skip.addEventListener('click', function () { use('signin_skip'); opts.onSkip(); });
        wrap.appendChild(skip);
      }
      var fine = mk('p', 'acc-fine');
      fine.appendChild(document.createTextNode('Your number is never shown to anyone or used for anything else. You can delete your account in You at any time. '));
      var pv = mk('a', '', 'Privacy');
      pv.href = '/privacy.html#account';
      fine.appendChild(pv);
      wrap.appendChild(fine);
    }
    var phoneVal = '';
    // Country codes (owner, 2026-11-26): India first and the default; then where readers are likely to be. The phone's own
    // region picks the default when it is on the list; the last choice is remembered.
    var CC = [['IN', 'India', '91'], ['US', 'United States', '1'], ['GB', 'United Kingdom', '44'], ['AE', 'UAE', '971'], ['SG', 'Singapore', '65'],
      ['CA', 'Canada', '1'], ['AU', 'Australia', '61'], ['SA', 'Saudi Arabia', '966'], ['QA', 'Qatar', '974'], ['KW', 'Kuwait', '965'], ['OM', 'Oman', '968'],
      ['BH', 'Bahrain', '973'], ['DE', 'Germany', '49'], ['FR', 'France', '33'], ['NL', 'Netherlands', '31'], ['IE', 'Ireland', '353'], ['NZ', 'New Zealand', '64'],
      ['MY', 'Malaysia', '60'], ['HK', 'Hong Kong', '852'], ['JP', 'Japan', '81'], ['NP', 'Nepal', '977'], ['BD', 'Bangladesh', '880'], ['LK', 'Sri Lanka', '94'],
      ['KE', 'Kenya', '254'], ['NG', 'Nigeria', '234'], ['ZA', 'South Africa', '27']];
    function flag(iso) { return String.fromCodePoint.apply(null, iso.split('').map(function (c) { return 0x1f1e6 + c.charCodeAt(0) - 65; })); }
    function defaultCountry() {
      var saved = get('hb-cc');
      if (saved && CC.some(function (c) { return c[0] === saved; })) return saved;
      // the time zone, not the language: phones in India are often set to English (UK or US)
      var tz = '';
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* India */ }
      var TZ = { 'Europe/London': 'GB', 'Asia/Dubai': 'AE', 'Asia/Singapore': 'SG', 'Asia/Riyadh': 'SA', 'Asia/Qatar': 'QA', 'Asia/Kuwait': 'KW', 'Asia/Muscat': 'OM',
        'Asia/Bahrain': 'BH', 'Europe/Berlin': 'DE', 'Europe/Paris': 'FR', 'Europe/Amsterdam': 'NL', 'Europe/Dublin': 'IE', 'Pacific/Auckland': 'NZ', 'Asia/Kuala_Lumpur': 'MY',
        'Asia/Hong_Kong': 'HK', 'Asia/Tokyo': 'JP', 'Asia/Kathmandu': 'NP', 'Asia/Dhaka': 'BD', 'Asia/Colombo': 'LK', 'Africa/Nairobi': 'KE', 'Africa/Lagos': 'NG', 'Africa/Johannesburg': 'ZA' };
      if (TZ[tz]) return TZ[tz];
      if (/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax)/.test(tz)) return 'CA';
      if (/^America\//.test(tz)) return 'US';
      if (/^Australia\//.test(tz)) return 'AU';
      return 'IN';
    }
    var country = defaultCountry();
    function field(label, attrs) {
      var l = mk('label', 'acc-field');
      l.appendChild(mk('span', '', label));
      var i = mk('input');
      for (var k in attrs) i.setAttribute(k, attrs[k]);
      l.appendChild(i);
      return { el: l, input: i };
    }
    function back(to) { var b = btn('acc-link', 'Back'); b.addEventListener('click', to); return b; }
    function askPhone() {
      wrap.textContent = '';
      wrap.appendChild(mk('h2', 'acc-h', 'Your mobile number'));
      wrap.appendChild(mk('p', 'acc-p', 'Choose your country, then type your number.'));
      var f = field('Mobile number', { type: 'tel', inputmode: 'tel', autocomplete: 'tel-national', placeholder: '98765 43210', maxlength: '18' });
      var sel = mk('select', 'acc-cc');
      sel.setAttribute('aria-label', 'Country code');
      CC.forEach(function (c) { var o = mk('option', '', flag(c[0]) + ' +' + c[2] + '  ' + c[1]); o.value = c[0]; sel.appendChild(o); });
      sel.value = country;
      var shown = mk('span', 'acc-cc-shown');                       // the closed picker shows just the flag and the code
      function syncCc() { var c = CC.filter(function (x) { return x[0] === sel.value; })[0]; shown.textContent = flag(c[0]) + ' +' + c[2]; f.input.placeholder = c[0] === 'IN' ? '98765 43210' : 'Your number'; }
      sel.addEventListener('change', function () { country = sel.value; set('hb-cc', country); syncCc(); f.input.focus(); });
      var row = mk('div', 'acc-phone');
      var pick = mk('label', 'acc-cc-wrap');
      pick.appendChild(shown); pick.appendChild(sel);
      row.appendChild(pick); row.appendChild(f.input);
      f.el.appendChild(row);
      syncCc();
      // back from the PIN step: the number without the picked country's code
      var c0 = CC.filter(function (x) { return x[0] === sel.value; })[0];
      f.input.value = phoneVal.indexOf('+' + c0[2]) === 0 ? phoneVal.slice(c0[2].length + 1) : phoneVal;
      wrap.appendChild(f.el);
      var go = btn('acc-btn acc-primary', 'Continue');
      wrap.appendChild(go);
      wrap.appendChild(msg);
      wrap.appendChild(back(start));
      status('');
      function full() {                                             // a number typed with its own +code wins over the picker
        var raw = f.input.value.trim();
        if (/^\s*(\+|00)/.test(raw)) return '+' + raw.replace(/^\s*(\+|00)/, '').replace(/\D/g, '');
        var c = CC.filter(function (x) { return x[0] === sel.value; })[0];
        return '+' + c[2] + raw.replace(/\D/g, '').replace(/^0+/, '');
      }
      function next() {
        phoneVal = f.input.value.trim();
        var digits = phoneVal.replace(/\D/g, '').replace(/^0+/, '');
        if (sel.value === 'IN' && !/^\s*(\+|00)/.test(phoneVal) ? digits.length !== 10 : digits.length < 6) { status(sel.value === 'IN' ? 'Please enter your 10-digit mobile number.' : 'Please enter your full mobile number.', true); return; }
        phoneVal = full();
        go.disabled = true; status('Checking…');
        api('check', { phone: phoneVal }).then(function (r) {
          go.disabled = false;
          if (!r.ok) { status((r.d && r.d.error) || 'Something went wrong. Please try again.', true); return; }
          status('');
          if (r.d.exists) askPin(false); else askPin(true);
        }, function () { go.disabled = false; status('No connection. Please try again.', true); });
      }
      go.addEventListener('click', next);
      f.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') next(); });
      setTimeout(function () { try { f.input.focus(); } catch (e) { /* ignore */ } }, 250);
    }
    function askPin(isNew) {
      wrap.textContent = '';
      wrap.appendChild(mk('h2', 'acc-h', isNew ? 'Create a 4-digit PIN' : 'Enter your PIN'));
      wrap.appendChild(mk('p', 'acc-p', isNew ? 'You’ll use it with your number to sign in on another phone. Not 1234 or 1111.' : 'The 4-digit PIN you chose for ' + phoneVal + '.'));
      var a = field(isNew ? 'New PIN' : 'PIN', { type: 'password', inputmode: 'numeric', autocomplete: isNew ? 'new-password' : 'current-password', maxlength: '4', pattern: '[0-9]*', class: 'acc-pin' });
      wrap.appendChild(a.el);
      var b = isNew ? field('Type it again', { type: 'password', inputmode: 'numeric', autocomplete: 'new-password', maxlength: '4', pattern: '[0-9]*', class: 'acc-pin' }) : null;
      if (b) wrap.appendChild(b.el);
      var go = btn('acc-btn acc-primary', isNew ? 'Create my account' : 'Sign in');
      wrap.appendChild(go);
      wrap.appendChild(msg);
      if (!isNew) wrap.appendChild(mk('p', 'acc-fine', 'Forgot your PIN? Write to us from Contact us in You and we’ll help.'));
      wrap.appendChild(back(askPhone));
      status('');
      function submit() {
        var pin = a.input.value.trim();
        if (!/^\d{4}$/.test(pin)) { status('The PIN is 4 digits.', true); return; }
        if (b && b.input.value.trim() !== pin) { status('The two PINs don’t match.', true); return; }
        go.disabled = true; status(isNew ? 'Creating your account…' : 'Signing in…');
        api(isNew ? 'register' : 'login', { phone: phoneVal, pin: pin, data: gather() }).then(function (r) {
          go.disabled = false;
          if (!r.ok) { status((r.d && r.d.error) || 'Something went wrong. Please try again.', true); if (r.status === 409) askPin(false); return; }
          done(finishSignIn(r, isNew ? 'signup_phone' : 'signin_phone'), r.d.account);
        }, function () { go.disabled = false; status('No connection. Please try again.', true); });
      }
      go.addEventListener('click', submit);
      [a, b].forEach(function (x) { if (x) x.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); }); });
      a.input.addEventListener('input', function () { if (a.input.value.length === 4 && b) b.input.focus(); else if (a.input.value.length === 4) submit(); });
      setTimeout(function () { try { a.input.focus(); } catch (e) { /* ignore */ } }, 250);
    }
    start();
  }

  // ---- the full-screen layer (onboarding, and sign-in on its own) ----
  var layer = null;
  function closeLayer() {
    if (!layer) return;
    var l = layer; layer = null;
    l.classList.add('out');
    document.documentElement.classList.remove('hb-onb-open');
    if (window.HBScreenColor) window.HBScreenColor('onb', null);
    setTimeout(function () { l.remove(); }, 320);
  }
  function openLayer(cls) {
    closeLayer();
    var l = mk('section', 'hb-onb ' + (cls || ''));
    l.setAttribute('role', 'dialog');
    l.setAttribute('aria-modal', 'true');
    document.body.appendChild(l);
    document.documentElement.classList.add('hb-onb-open');
    if (window.HBScreenColor) window.HBScreenColor('onb', { top: '#15162f', back: '#15162f', dark: true });
    layer = l;
    return l;
  }
  // after signing in, if the merged copy brought back things this page has drawn already, start the page again with them
  function afterSignIn(ch) { closeLayer(); if (ch && (ch.quiz || ch.saved || ch.prefs)) setTimeout(function () { location.reload(); }, 340); }

  function openSignIn(reason) {
    use('signin_open');
    var l = openLayer('acc-only');
    var top = mk('div', 'onb-top');
    var x = btn('onb-x', '');
    x.setAttribute('aria-label', 'Close');
    x.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.addEventListener('click', closeLayer);
    top.appendChild(x);
    l.appendChild(top);
    var stage = mk('div', 'onb-stage');
    l.appendChild(stage);
    var hero = mk('div', 'onb-mini');
    hero.appendChild(heroMedia(120));
    stage.appendChild(hero);
    var host = mk('div');
    stage.appendChild(host);
    var copy = reason === 'streak' ? { title: 'Keep your streak safe', text: 'Your streak lives on this phone only. Sign in and it’s kept, even if you change phones.' } : {};
    signInPanel(host, { title: copy.title, text: copy.text, onDone: function (ch) { afterSignIn(ch); }, onSkip: closeLayer, skipText: 'Not now' });
  }

  function heroMedia(size) {
    var box = mk('div', 'onb-hero');
    box.style.width = box.style.height = size + 'px';
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { var im = mk('img'); im.src = '/brand/logo-256.png?v=hourglass'; im.alt = ''; box.appendChild(im); return box; }
    var v = mk('video');
    v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('aria-hidden', 'true');
    v.poster = '/brand/logo-256.png?v=hourglass';
    v.src = '/brand/motion/hourglass.mp4';
    box.appendChild(v);
    var p = v.play(); if (p && p.catch) p.catch(function () { /* the poster stays */ });
    return box;
  }

  // ---- onboarding ----
  function laneNames() {
    var names = [];
    document.querySelectorAll('section.lane[id]').forEach(function (l) {
      if (l.id === 'quiz' || !l.querySelector('.item[data-story-id]')) return;
      var n = HC().laneName ? HC().laneName(l) : '';
      if (n) names.push(n);
    });
    return names.length ? names : ['AI & Tech', 'Product & Business', 'Stock Market'];
  }
  var ICON = {
    brief: '<path d="M4 5.5h12.5v13H6.5a2.5 2.5 0 0 1-2.5-2.5V5.5z"/><path d="M16.5 9H20v7a2.5 2.5 0 0 1-2.5 2.5"/><path d="M7.5 9h6M7.5 12h6M7.5 15h3.5"/>',
    listen: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><path d="M4 15h3v5H5a1 1 0 0 1-1-1v-4z"/><path d="M20 15h-3v5h2a1 1 0 0 0 1-1v-4z"/>',
    quiz: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>',
    voices: '<path d="M4.5 4.5h10a2 2 0 0 1 2 2v5.5a2 2 0 0 1-2 2H9l-3.5 3v-3h-1a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2z"/><path d="M16.5 8.5h3a2 2 0 0 1 2 2V16a2 2 0 0 1-2 2h-1v2.5L15 18h-3.5a2 2 0 0 1-1.9-1.4"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'
  };
  function svg(d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; }
  function isNew() {
    var q = json('hb-quiz-v1', {}), s = json('hb-saved-v1', []);
    return !(q && q.r && Object.keys(q.r).length) && !(Array.isArray(s) && s.length);
  }
  function onboard() {
    use('onb_start');
    var l = openLayer('');
    var step = 0, wantReminder = false, slides = [];
    var top = mk('div', 'onb-top');
    var skip = btn('onb-skip', 'Skip');
    top.appendChild(skip);
    l.appendChild(top);
    var stage = mk('div', 'onb-stage');
    l.appendChild(stage);
    var foot = mk('div', 'onb-foot');
    var dots = mk('div', 'onb-dots');
    var next = btn('acc-btn acc-primary onb-next', 'Get started');
    foot.appendChild(dots);
    foot.appendChild(next);
    l.appendChild(foot);

    // 1. welcome
    var s1 = mk('div', 'onb-slide onb-welcome');
    s1.appendChild(heroMedia(220));
    s1.appendChild(mk('p', 'onb-kick', 'The Hour Brief'));
    s1.appendChild(mk('h1', 'onb-title', 'The news that actually mattered, in one sitting.'));
    s1.appendChild(mk('p', 'onb-lead', 'Every morning: AI and technology, business, and the Indian markets, in under ten minutes. Every story links to its source.'));
    slides.push(s1);
    // 2. what's inside
    var s2 = mk('div', 'onb-slide');
    s2.appendChild(mk('h2', 'onb-h', 'What’s inside'));
    var rows = [
      ['brief', 'Today’s brief', laneNames().join(' · ') + '. Swipe it as cards or read it as a list.'],
      ['listen', 'Listen', 'The whole brief read aloud in about seven minutes, even with your screen off.'],
      ['quiz', 'The daily quiz', 'Five questions on the day’s news. Keep a streak, earn badges, and take on friends in a league.'],
      ['voices', 'Voices', 'Every Monday, the best long-form thinking from leading podcasts and newsletters, distilled into one read.']
    ];
    var list = mk('div', 'onb-list');
    rows.forEach(function (r) {
      var row = mk('div', 'onb-row onb-' + r[0]);
      var ic = mk('span', 'onb-ic'); ic.innerHTML = svg(ICON[r[0]]);
      var tx = mk('div', 'onb-row-t');
      tx.appendChild(mk('b', '', r[1]));
      tx.appendChild(mk('span', '', r[2]));
      row.appendChild(ic); row.appendChild(tx);
      list.appendChild(row);
    });
    s2.appendChild(list);
    slides.push(s2);
    // 3. how it works (+ the morning reminder)
    var s3 = mk('div', 'onb-slide');
    s3.appendChild(mk('h2', 'onb-h', 'How it works'));
    var tips = mk('div', 'onb-tips');
    function tip(cls, art, title, text) {
      var t = mk('div', 'onb-tip ' + cls);
      var a = mk('div', 'onb-art'); a.innerHTML = art;
      var tx = mk('div', 'onb-row-t'); tx.appendChild(mk('b', '', title)); tx.appendChild(mk('span', '', text));
      t.appendChild(a); t.appendChild(tx);
      tips.appendChild(t);
    }
    tip('onb-t-swipe', '<i></i><i></i><i></i><em>→</em>', 'Swipe through the stories', 'One card per story, in Brief. Tap a headline on Home to jump in.');
    tip('onb-t-listen', '<span class="onb-pill"><i>▶</i>Listen</span>', 'Press Listen', 'On Home, any time. The player tucks away while you read.');
    tip('onb-t-tabs', '<span class="onb-tabs"><i class="on"></i><i></i><i></i><i></i></span>', 'Four tabs', 'Home, Brief, Voices and Challenge. Your streak, badges and settings are under your picture.');
    s3.appendChild(tips);
    var bell = document.getElementById('cap-remind');
    if (bell) {
      var rem = btn('onb-remind', '');
      rem.innerHTML = '<span class="onb-ic">' + svg(ICON.bell) + '</span><span class="onb-row-t"><b>Morning reminder</b><span>A nudge when the brief is ready, every day</span></span><span class="onb-tog" aria-hidden="true"></span>';
      rem.setAttribute('aria-pressed', 'false');
      rem.addEventListener('click', function () { wantReminder = !wantReminder; rem.setAttribute('aria-pressed', String(wantReminder)); rem.classList.toggle('on', wantReminder); });
      s3.appendChild(rem);
    }
    slides.push(s3);
    // 4. sign-in
    var s4 = mk('div', 'onb-slide onb-acc');
    var mini = mk('div', 'onb-mini'); mini.appendChild(heroMedia(110));
    s4.appendChild(mini);
    var host = mk('div');
    s4.appendChild(host);
    slides.push(s4);

    slides.forEach(function (s, i) { s.hidden = i !== 0; stage.appendChild(s); dots.appendChild(mk('i')); });
    function finish(how) {
      set(ONB, 'done:' + today());
      use(how);
      closeLayer();
      if (wantReminder && bell) setTimeout(function () { bell.click(); }, 450);
    }
    function show(i) {
      step = i;
      slides.forEach(function (s, k) { s.hidden = k !== i; if (k === i) { s.classList.remove('in'); void s.offsetWidth; s.classList.add('in'); } });
      dots.querySelectorAll('i').forEach(function (d, k) { d.classList.toggle('on', k === i); });
      next.textContent = i === 0 ? 'Get started' : 'Next';
      foot.hidden = i === 3;
      skip.hidden = i === 3;
      if (i === 3) signInPanel(host, {
        onDone: function (ch) { finish('onb_done'); afterSignIn(ch); },
        onSkip: function () { finish('onb_done'); }
      });
    }
    next.addEventListener('click', function () { show(Math.min(3, step + 1)); });
    skip.addEventListener('click', function () { use('onb_skip'); show(3); });
    // swipe between the first three
    var x0 = null;
    stage.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (x0 === null || step === 3) return;
      var dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (dx < -60) show(step + 1); else if (dx > 60 && step > 0) show(step - 1);
    }, { passive: true });
    show(0);
  }

  // ---- quiet reminders for anonymous readers ----
  function nudgeState() { return json(NUDGE, { n: 0, at: 0 }); }
  function playedDays() { var q = json('hb-quiz-v1', {}); return q && q.r ? Object.keys(q.r).length : 0; }
  // Home: a small card, at most three times, a week apart, once there is something worth keeping (two quizzes or a saved story)
  function homeNudge(container) {
    if (signedIn() || !NATIVE || !get(ONB)) return null;
    var st = nudgeState(), saved = json('hb-saved-v1', []);
    if (st.n >= 3 || Date.now() - st.at < 7 * 864e5) return null;
    if (playedDays() < 2 && !(Array.isArray(saved) && saved.length)) return null;
    var card = mk('div', 'acc-nudge');
    var t = mk('button', 'acc-nudge-go');
    t.type = 'button';
    t.appendChild(mk('b', '', 'Your progress lives on this phone only'));
    t.appendChild(mk('span', '', 'Sign in to keep your streak and saved stories, whatever happens to this phone.'));
    t.addEventListener('click', function () { use('nudge_home_tap'); openSignIn('home'); });
    var x = btn('acc-nudge-x', '');
    x.setAttribute('aria-label', 'Not now');
    x.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.addEventListener('click', function () { card.remove(); });
    card.appendChild(t); card.appendChild(x);
    set(NUDGE, JSON.stringify({ n: st.n + 1, at: Date.now() }));
    use('nudge_home');
    if (container) container.appendChild(card);
    return card;
  }
  // The score: one line under it once a streak of 2+ days is at stake
  function scoreNudge(container, streak) {
    if (signedIn() || !NATIVE || !(streak >= 2) || !container) return null;
    var b = mk('button', 'acc-score-nudge');
    b.type = 'button';
    b.appendChild(mk('span', '', 'Keep your ' + streak + '-day streak safe'));
    b.appendChild(mk('b', '', 'Sign in'));
    b.addEventListener('click', function () { use('nudge_score_tap'); openSignIn('streak'); });
    container.appendChild(b);
    return b;
  }

  // ---- You: who you are, sign out, delete ----
  function youHero(hero) {
    var a = acct(), row = mk('div', 'acc-you');
    if (a && a.token) {
      row.appendChild(mk('span', 'acc-you-t', 'Signed in' + (a.account && a.account.phone ? ' · ' + a.account.phone : a.account && a.account.google ? ' with Google' : a.account && a.account.apple ? ' with Apple' : '')));
    } else {
      var b = btn('acc-btn acc-primary acc-you-in', 'Sign in to keep your progress');
      b.addEventListener('click', function () { use('signin_you'); openSignIn('you'); });
      row.appendChild(b);
    }
    hero.appendChild(row);
  }
  function confirmBox(title, text, okText, danger, go) {
    var l = openLayer('acc-only acc-confirm');
    var st = mk('div', 'onb-stage');
    l.appendChild(st);
    var p = mk('div', 'acc-panel');
    p.appendChild(mk('h2', 'acc-h', title));
    p.appendChild(mk('p', 'acc-p', text));
    var ok = btn('acc-btn ' + (danger ? 'acc-danger' : 'acc-primary'), okText);
    var msg = mk('p', 'acc-msg');
    ok.addEventListener('click', function () { ok.disabled = true; go(function (err) { if (err) { ok.disabled = false; msg.textContent = err; msg.classList.add('err'); } else closeLayer(); }); });
    var no = btn('acc-link', 'Cancel');
    no.addEventListener('click', closeLayer);
    p.appendChild(ok); p.appendChild(msg); p.appendChild(no);
    st.appendChild(p);
  }
  function signOut() {
    confirmBox('Sign out?', 'Everything stays on this phone. Sign in again any time with your number and PIN.', 'Sign out', false, function (cb) {
      var a = acct();
      sync().then(function () { return a && a.token ? api('logout', { token: a.token }) : null; }).catch(function () { /* signed out here anyway */ }).then(function () {
        set(ACCT, null); use('signout'); notify(); cb();
      });
    });
  }
  function deleteAccount() {
    confirmBox('Delete your account?', 'This removes your account and everything it keeps from our servers, at once and for good. What’s on this phone stays until you remove the app.', 'Delete my account', true, function (cb) {
      var a = acct();
      if (!a || !a.token) { set(ACCT, null); notify(); cb(); return; }
      api('delete', { token: a.token }).then(function (r) {
        if (!r.ok && r.status !== 401) { cb((r.d && r.d.error) || 'Could not delete it just now. Please try again.'); return; }
        set(ACCT, null); use('account_delete'); notify(); cb();
        if (window.HBToast) window.HBToast('Your account was deleted');
      }, function () { cb('No connection. Please try again.'); });
    });
  }
  // the account rows for You's list (mobile.js drawYou)
  function youItems() {
    if (!signedIn()) return [];
    return [['signout', 'Sign out', 'Everything stays on this phone', signOut], ['delete', 'Delete account', 'Removes it from our servers', deleteAccount]];
  }

  window.HBAccount = {
    signedIn: signedIn, account: function () { var a = acct(); return a && a.account; }, sync: sync,
    openSignIn: openSignIn, onboard: onboard, homeNudge: homeNudge, scoreNudge: scoreNudge, youHero: youHero, youItems: youItems,
    signOut: signOut, deleteAccount: deleteAccount, onChange: function (f) { listeners.push(f); }
  };

  // ---- start: the first run in the app, or a quiet sync ----
  function begin() {
    // ?welcome=1 shows the welcome again, on demand (to review it; owner, 2026-11-26), in the app or a phone browser
    if (/[?&]welcome=1(&|$)/.test(location.search)) {
      try { history.replaceState(history.state, '', location.pathname + location.search.replace(/([?&])welcome=1(&|$)/, '$1').replace(/[?&]$/, '') + location.hash); } catch (e) { /* ignore */ }
      onboard();
      return;
    }
    if (signedIn()) { setTimeout(sync, 1500); return; }
    if (!NATIVE || get(ONB) || (window.HB_COUNT_TEST && !window.HB_ONB_TEST)) return;
    if (!isNew()) { set(ONB, 'existing:' + today()); return; }    // people who used the app before this: no welcome, a sign-in later
    if (!/^\/(index\.html)?$/.test(location.pathname)) return;     // the welcome only on the edition's own page
    onboard();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin); else begin();
})();
