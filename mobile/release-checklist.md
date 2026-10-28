# Release checklist (last verified 2026-10-28)

## Android bundle
`mobile/dist/the-hour-brief-1.1.3-vc8.aab` (versionCode 8, versionName 1.1.3). vc7 was built and then found to be missing
the push-notifications native module (`npx cap sync android` was run before `npm i @capacitor/push-notifications`, so the
module was never registered in `capacitor.settings.gradle` despite the JS/config side looking complete) — vc7 was deleted
from `mobile/dist/`, never uploaded. vc8 is a clean rebuild after re-running `cap sync android` with the plugin actually
installed; `capacitor-push-notifications` now appears in `capacitor.settings.gradle` and `app/capacitor.build.gradle`.
Includes: the deep-links AndroidManifest intent-filter (commit `b63526a`), Firebase Analytics + Messaging, FCM default
notification icon/color.
SHA-256 (the file to upload): `b89fcbb7dfb7b3b0f3c87a3c26e845a2600b840866bb342252e91a254923ab5c` (`shasum -a 256` to confirm).
Verified on the built artifact: `app.thehourbrief` versionCode 8 / versionName 1.1.3 (`aapt2 dump badging`), signed with the
upload key — `apksigner verify --print-certs` gives SHA-256 `CE:1E:B6:18:75:18:51:6E:D3:03:5B:5D:7C:69:D1:FC:31:3F:4A:64:4F:80:82:8A:1F:00:02:54:2D:F1:E5:35`, matching the fingerprint
already in `.well-known/assetlinks.json` — target/compile SDK 36, min SDK 24, not debuggable.
**Not yet confirmed: whether this upload-key fingerprint also matches Play's own App Signing key certificate** (Play Console →
Setup → App integrity) — Play re-signs with its own key, which can differ from the upload key, and App Links verification
checks against *that* certificate. If it differs, add the second fingerprint to `.well-known/assetlinks.json`'s array (both can
coexist) before relying on deep links working from Play-distributed installs. Not smoke-tested on an emulator/device yet —
do that before uploading, including the push-notification permission prompt and a real registration.
**Left for you:** upload `the-hour-brief-1.1.3-vc8.aab` to the Production release draft in Play Console.

## Web UI the app loads
The redesigned screens are part of the website and now also its desktop version (see DEPLOY.md, "Premium skin"). Verified on the emulator's Android WebView (Chrome 113): app bar, tabs, chips, Listen card, Audio hub with the device voice, quiz with the streak strip, the Sections sheet. Deploy them after Play's review of the current build, so reviewers keep seeing what they already saw.

## Google Play: what got the app removed and how it was fixed
Policy: News and Magazines (enforced 24 Sep): no easy-to-find contact page in the app and on the website.
- Site (live, loaded by the app): `/contact.html` (labelled "Contact us", email, topics), a "Contact us · About · Privacy" row leading the
  footer on phones/apps, a "Contact" pill in each edition's nav, a labelled Contact block with the email in each edition's footer,
  and links from About/Privacy/archive. CI fails if the latest edition loses the link.
- Bundle: offline/error page with the email. (Reviewers who cannot load the site still see contact details.)
- **Console, you do these:**
  1. Grow users -> Store presence -> Store settings -> Store listing contact details: website `https://the-hour-brief.vercel.app`, email
     `milindroy101292@gmail.com`.
  2. App content -> News and Magazines declaration: contact URL `https://the-hour-brief.vercel.app/contact.html`; check every other answer.
  3. Data safety: add the leagues purposes (only if leagues are used; see `play-store/listing.md`). Audio is a plain file
     download from Cloudflare: nothing new is collected.
  4. Upload the vc6 AAB to the track, add the release notes from `play-store/listing.md`, then use "Send for review" / appeal on the
     policy-status page and say what changed (contact page, in-app contact line, updated declaration).
- Other requirements met: content is under 3 months old (daily), every story links its original publisher, no ads, comments hidden in
  the app (no UGC), leagues use generated names (no UGC), notification permission asked only when the bell is tapped,
  rating prompt uses Play's in-app review API, privacy policy + About disclose the AI authorship and the AI voice.
- Stale: the Play screenshots predate the quiz / Listen / contact line. Not a rejection reason, but worth refreshing.

## App Store
- **2026-09-29: the developer account is active, and the whole archive→sign→export pipeline now works from the command line on this machine** (no Xcode GUI needed for this part): `DEVELOPMENT_TEAM = PUXF34ZNNT` is set in the project (your own Xcode edit), Xcode is signed into `milindroy101292@gmail.com`, and a real `xcodebuild archive` + `-exportArchive -exportOptionsPlist (method: app-store-connect)` both succeeded end to end — Xcode auto-registered the `app.thehourbrief` App ID and used a **Cloud Managed Apple Distribution** certificate (no local .p12 to manage, valid to 29 Sep 2027) to produce a properly signed `App.ipa`. That was a throwaway validation build/export (deleted after, not uploaded).
- Also added this session: `AVAudioSession` set to `.playback` in `AppDelegate.swift`, to go with the `UIBackgroundModes: audio` key you'd already added to Info.plist — without both, Listen stops the moment the screen locks or the app backgrounds even though the entitlement is declared. Needs a real-device check (TestFlight): silent switch on and off, screen lock during playback.
- Verified 2026-09-26 (still true): version 1.1.2 (build 1), iOS 15.0+, iPhone + iPad, the new icon (1024, RGB, no alpha) and launch image, privacy manifests for the app, Capacitor and Cordova. Bundle id `app.thehourbrief`, `ITSAppUsesNonExemptEncryption = false`. Privacy manifest declares the file-timestamp API (C617.1) used by `@capacitor/filesystem`; iPhone is locked to portrait (in landscape a swipe card's text area is about 90px).
- No usage-description strings are needed (no camera, photos, location, microphone).
- Biggest risk stays Guideline 4.2 (web wrapper). Native features to point out to the reviewer: daily local-notification reminder, share
  sheet, haptics, native rating prompt, on-device speech fallback, bundled offline page, quiz with streaks/badges, friends leagues, swipe cards, personalised sections.
- Not tested on a real iPhone yet: the offline page (`errorPath`), Listen with the background-audio fix above, the share-image flow. TestFlight on your own iPhone is the way to cover these.

**2026-10-27: iOS 1.1.3, Universal Links.** Added the Associated Domains capability in Xcode (`App.entitlements` +
`CODE_SIGN_ENTITLEMENTS` now wired in `project.pbxproj`), but the entitlement's value was left on Xcode's default
placeholder (`webcredentials:example.com`) instead of the real domain — fixed directly in the plist to
`applinks:the-hour-brief.vercel.app`, matching `appIDs: ["PUXF34ZNNT.app.thehourbrief"]` in
`.well-known/apple-app-site-association`.

**2026-10-28: Firebase (push + Analytics), and 1.1.3 (build 2) uploaded.** `FirebaseAnalytics` + `FirebaseMessaging` linked
via SPM, `AppDelegate.swift` wired (APNs token → Firebase → FCM token → Capacitor's registration event), `aps-environment`
+ `remote-notification` background mode added. Archived and uploaded for real this time (not a throwaway): `MARKETING_VERSION`
bumped 1.1.2 → **1.1.3** (version 1.1.2 is already approved and closed for new submissions — Apple rejected the first
attempt, build-number-only, with "Invalid Pre-Release Train"; bumping the marketing version fixed it), `CURRENT_PROJECT_VERSION`
(build) bumped 1 → 2. `xcodebuild archive` (Release, `generic/platform=iOS`) signed correctly with the Apple Distribution
cert despite the archive step itself showing a Development identity mid-build — export re-signs for the chosen method, and
the exported `.ipa` verified with `Authority=Apple Distribution: Milind Roy (PUXF34ZNNT)`, `aps-environment: production`,
provisioning profile "iOS Team Store Provisioning Profile: app.thehourbrief". Uploaded via `xcodebuild -exportArchive`
with `destination: upload` in `mobile/ios/App/exportOptions.plist` (reuses Xcode's own authenticated session, no API key
needed) — **Upload succeeded**, now processing in App Store Connect. Benign warnings: missing dSYMs for
FirebaseAnalytics/GoogleAdsOnDeviceConversion/GoogleAppMeasurement (known Firebase static-xcframework issue, doesn't block
review, just means slightly less symbolicated crash reports from those frameworks).

**Left for you:** once it finishes processing (check App Store Connect or TestFlight), install on your iPhone via
TestFlight, open the app, accept the notification permission prompt — that's what triggers registration. Then test a
shared `/q`, `/e`, `/s`, or `/l` link on a real device — both with the app installed (should open in-app) and freshly
deleted (should land on the OS-aware install-nudge page from commit `b63526a`).

## Known open risks
- The digest is AI-written and not human-reviewed each day (About says so plainly). Play's misinformation and News policies could
  still be applied more strictly; every item cites a real source link, which is the main mitigation.
- Daily audio recording is off until `AUDIO_ENABLED` is set (about ₹18/day); until then Listen uses the device voice.

Swipe cards (`cards.js`) are the default view on phones and in the apps, with a List button and a `List | Cards` switch to change it. They are web-only like the rest of the reading UI: no new store build is needed. Before relying on a change to them, run it on the emulator's real WebView (`hourbrief_pixel`, release APK loads the live site) as well as `tools/browser-tests/cards.mjs`.
