# The Hour Brief — mobile apps

Native **iOS** and **Android** shells for The Hour Brief, built with
[Capacitor](https://capacitorjs.com). The apps load the live site
(`https://the-hour-brief.vercel.app`) inside a native WebView and add the
platform touches on top: system-browser links, a native share sheet, haptics,
an offline banner, and (once set up) push notifications for new editions.

Because the app points at the live site, **every published edition shows up in
the app automatically** — no app-store update needed. You only ship a new build
when you change native behaviour (this folder) or the `capacitor-bridge.js` glue.

```
mobile/
  capacitor.config.json   app id, name, server URL, plugin config
  www/                     offline / cold-start fallback screen
  resources/               source icon.png + splash.png (edit these, then `npm run assets`)
  ios/                     generated Xcode project  (open in Xcode)
  android/                 generated Android project (open in Android Studio, or build with Gradle)
```

The web-side glue lives in the site repo root, not here:
- [`../capacitor-bridge.js`](../capacitor-bridge.js) — native enhancements, a no-op in a normal browser (in-app nav, share sheet, haptics, pull-to-refresh, "new edition" banner, offline notice, status bar, gated push)
- [`../mobile.css`](../mobile.css) — phone-only (`<link media="(max-width: 640px)">`) layout: compact masthead, single-row lane nav, collapsible-story styling, 44px touch targets, 16px inputs
- [`../mobile.js`](../mobile.js) — phone-only reading enhancements: collapsible story bodies (headline + Takeaway, tap to expand), the About "More" toggle
- [`../api/register-push.js`](../api/register-push.js) — stores device push tokens in Redis

Every edition page (`index.html` + `archive/*.html`) must keep the three
`<head>` lines that load `capacitor-bridge.js`, `mobile.css`, and `mobile.js`.
The daily template is `index.html`, so new editions inherit them.

> **The native glue only runs once the site is deployed.** The app loads the
> live Vercel site, so the Share button / system-browser links / haptics appear
> only after `../capacitor-bridge.js` and the `<script>` tags in the site's
> HTML are pushed to `main` (Vercel auto-deploys). The status-bar spacing,
> splash, and icon are native and work immediately.

---

## Toolchains

### iOS
macOS + Xcode 15+, an **Apple Developer account** ($99/yr).
Capacitor 8 uses Swift Package Manager — no CocoaPods install required.

### Android
An **Android SDK + JDK 21** (Capacitor 8 requires Java 21 — Java 17 fails with
`invalid source release: 21`), plus a **Google Play Console account**
($25 one-time). This machine is set up with a command-line-only toolchain via
Homebrew (no Android Studio):

```bash
brew install openjdk@21
brew install --cask android-commandlinetools
sdkmanager --licenses
sdkmanager "platform-tools" "emulator" \
  "platforms;android-36" "build-tools;36.0.0" \
  "system-images;android-34;google_apis;arm64-v8a"
```

`~/.zshrc` exports (already added):

```bash
export JAVA_HOME="/opt/homebrew/opt/openjdk@21"
export ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

`android/local.properties` points Gradle at the SDK (git-ignored).

The Android build target is **compileSdk / targetSdk 36**, minSdk 24
(`android/variables.gradle`).

---

## Run it

### Emulator

An AVD named `hourbrief_pixel` already exists (Pixel 7, API 34, arm64). Its
`userdata` partition was shrunk to 4 GB in `~/.android/avd/hourbrief_pixel.avd/config.ini`
— the default 10 GB would not fit; the emulator needs the partition + system
image free on disk to boot at all, so keep **~6 GB free**.

```bash
emulator -avd hourbrief_pixel -no-snapshot -no-boot-anim &
adb wait-for-device
```

### Build + install

```bash
npm run sync                       # copy config/plugins into android/ + ios/
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell monkey -p app.thehourbrief -c android.intent.category.LAUNCHER 1
```

Or the Capacitor shortcuts: `npm run run:android` / `npm run open:android`.

### Testing native glue against local site changes

The app loads the *deployed* site, so uncommitted `capacitor-bridge.js` changes
won't show. To test them without deploying: serve the repo and point the app at
the host loopback.

```bash
python3 -m http.server 8787 --directory ..      # from mobile/, serves the site
```

Then temporarily set `server` in `capacitor.config.json` to
`{ "url": "http://10.0.2.2:8787", "cleartext": true, "androidScheme": "http" }`,
`npm run sync`, rebuild. **Revert to the `https://the-hour-brief.vercel.app`
config before committing or shipping.**

---

## App identity

Change in `capacitor.config.json` + `npm run sync`:

- **App ID:** `app.thehourbrief`
- **Display name:** The Hour Brief
- **Brand colour / splash:** `#5b3e96`

Version numbers live in the native projects:
- iOS: `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in Xcode target settings
- Android: `versionName` / `versionCode` in `android/app/build.gradle` — bump
  `versionCode` (integer) for every Play upload.

Icons/splash regenerate from `resources/icon.png` + `resources/splash.png` via
`npm run assets` (the current art is a placeholder stopwatch — swap the PNGs).

---

## Android signing & release build

The upload key lives in `android/thb-upload-key.jks` with credentials in
`android/keystore.properties` — **both are git-ignored. Back them up** (password
manager + an offline copy). Losing them means you can't ship updates unless
Play App Signing is enabled and you request an upload-key reset.

`keystore.properties` format:

```properties
storeFile=thb-upload-key.jks
storePassword=…
keyAlias=thb-upload
keyPassword=…
```

`app/build.gradle` reads it and signs `release` builds automatically (falls back
to the debug key if the file is absent, so CI / fresh clones still build).

```bash
cd android
./gradlew bundleRelease     # -> app/build/outputs/bundle/release/app-release.aab   (Play Console)
./gradlew assembleRelease   # -> app/build/outputs/apk/release/app-release.apk      (sideload test)
```

To recreate the key from scratch:

```bash
keytool -genkeypair -v -keystore android/thb-upload-key.jks -alias thb-upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

---

## Push notifications ("new edition is live") — NOT in the app

`@capacitor/push-notifications` is **not installed** in the v1 release — it pulls
in the whole Firebase Messaging stack and a `POST_NOTIFICATIONS` permission for a
feature with no backend sender. The `capacitor-bridge.js` push block no-ops when
the plugin is absent.

**To add push later:**

```bash
npm i @capacitor/push-notifications && npx cap sync
```

then re-add `"PushNotifications"` to `capacitor.config.json` plugins, and on iOS
re-add the `remote-notification` background mode. Then, after the setup below,
add to every page's `<head>`:

```html
<meta name="thb-push" content="on">
```

**Setup:**

1. **Apple (APNs).** Create an APNs Auth Key (.p8) in the Apple Developer
   portal. In Xcode → Signing & Capabilities add **Push Notifications** and
   **Background Modes → Remote notifications** (Info.plist already declares the
   background mode).
2. **Google (FCM).** Create a Firebase project, add an Android app with id
   `app.thehourbrief`, download `google-services.json` into `android/app/`
   (git-ignored).
3. **Sender job.** Add a Vercel function (e.g. `api/send-push.js`) that reads
   the token sets (`push:tokens:ios` / `push:tokens:android` in Vercel KV,
   populated by `api/register-push.js`) and calls APNs + FCM. Trigger it from
   the publish step or a Vercel Cron. Include `data.url` = the edition URL so
   the bridge can deep-link on tap.

---

## App Store review notes

These apps are a WebView over a content site. Apple Guideline 4.2 ("minimum
functionality") is the risk. Mitigations in place: native share, haptics,
offline handling. **Turn on push before submitting iOS** — it's the strongest
"this is a real app" signal. If review pushes back, the fallback is to bundle
more of the reading experience locally (render `editions.json` in `www/` and
cache editions) rather than loading the remote URL.

Android (Play Store) has no equivalent restriction.

---

## Play Store submission checklist

- [ ] Bump `versionCode` in `android/app/build.gradle`
- [ ] `npm run sync` (only if config/plugins changed)
- [ ] `cd android && ./gradlew bundleRelease` → `app-release.aab`
- [ ] Play Console → create app "The Hour Brief", package `app.thehourbrief`
- [ ] Enable **Play App Signing** (recommended — Google holds the app-signing
      key, you only manage the upload key above)
- [ ] Upload the `.aab` to the **Internal testing** track first
- [ ] **Data safety**: no data collected/shared. App has no analytics beyond the
      site's Vercel Web Analytics (anonymous, no device IDs) and no push token.
- [ ] **Content rating** questionnaire (news/information content)
- [ ] **Privacy policy URL** — required. Point at a page on the site
      (e.g. add `/privacy.html`).
- [ ] **App content**: target audience (not for children), no ads, news category
- [ ] Store listing: short + full description, feature graphic (1024×500),
      phone screenshots (min 2), 512×512 icon
- [ ] Promote Internal testing → Production when ready

## App Store (later)

WebView-over-a-site apps risk Apple Guideline 4.2. Mitigations in place: native
share, haptics, offline handling, pull-to-refresh, in-app navigation. Adding
push before submitting helps. Fallback if rejected: render `editions.json` in
`www/` and cache editions locally instead of loading the remote URL.
