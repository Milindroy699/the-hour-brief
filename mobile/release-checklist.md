# Release checklist (last verified 2026-09-25)

## Android bundle
`mobile/dist/the-hour-brief-1.1.2-vc6.aab` (versionCode 6; Play already had a version code 5 from an earlier upload attempt, and version codes can never be reused, so vc5 is superseded, as is vc4).
Rebuilt 2026-09-25 from `main` with the final config (white status-bar default); SHA-256 `2de0d800de4cd408dc8934c5a43ac8407f1e19fb61fc3bb3f27facf8f814fc8d` (`shasum -a 256` to confirm you are uploading this file). Loaded on the emulator against the live site: new design, AI voice card, version 5. Verified on the built artifact: signed with the upload key
(SHA-256 `CE:1E:B6:18:75:18:51:6E:D3:03:5B:5D:7C:69:D1:FC:31:3F:4A:64:4F:80:82:8A:1F:00:02:54:2D:F1:E5:35`), target/compile SDK 36,
min SDK 24, not debuggable, HTTPS only, no native libraries (the 16 KB page-size rule does not apply), zip-aligned, permissions
`INTERNET, VIBRATE, POST_NOTIFICATIONS, RECEIVE_BOOT_COMPLETED, WAKE_LOCK` only (no exact-alarm, no storage), server URL = production.
Smoke-tested on the emulator (new icon on the launcher, hourglass splash on navy, offline page in the new colours): loads the live edition, Listen card on the first screen and the Contact row in the footer; with the network off it
shows the bundled offline page (`www/offline.html`) that carries the contact details.

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

## App Store (cannot be uploaded from this machine: no Apple signing identity yet)
- Compiles (Release, simulator). Bundle id `app.thehourbrief`, deployment target 15.0, `ITSAppUsesNonExemptEncryption = false`,
  `UIRequiredDeviceCapabilities = arm64`, 1024px icon without alpha, `PrivacyInfo.xcprivacy` (tracking off; User ID linked, app functionality).
- Needed from you: Apple Developer enrolment / Team ID, signing in Xcode (Archive -> Distribute), build number bump for each upload,
  App Privacy answers (see `app-store/listing.md`), and the App Review notes text in that file.
- Biggest risk stays Guideline 4.2 (web wrapper). Native features to point out to the reviewer: daily local-notification reminder, share
  sheet, haptics, native rating prompt, on-device speech fallback, bundled offline page, quiz with streaks/badges, friends leagues.
- Not tested on a real iPhone: the offline page (`errorPath`), Listen, the share-image flow.

## Known open risks
- The digest is AI-written and not human-reviewed each day (About says so plainly). Play's misinformation and News policies could
  still be applied more strictly; every item cites a real source link, which is the main mitigation.
- Daily audio recording is off until `AUDIO_ENABLED` is set (about ₹18/day); until then Listen uses the device voice.

Swipe cards (`cards.js`, opt-in List | Cards switch, later nudge) are web-only like the rest of the reading UI: no new store build is needed. Before relying on a change to them, run it on the emulator's real WebView (`hourbrief_pixel`, release APK loads the live site) as well as `tools/browser-tests/cards.mjs`.
