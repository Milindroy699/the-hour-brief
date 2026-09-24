# Google Play — release package (v1.0.0)

Assets (git-ignored, upload from here): `mobile/dist/play-store/`
`icon-512.png` (App icon) · `feature-graphic-1024x500.png` (Feature graphic, made by `node tools/brand/feature-graphic.mjs`) · `screenshots/` (8 phone screenshots, 1080×1919; `node tools/brand/screenshots.mjs` remakes them). All of these are in this folder now; the old copies in `mobile/dist/play-store/` show the retired stopwatch icon, do not upload those.

## Release

| | |
|---|---|
| Package | `app.thehourbrief` |
| Version name | **1.0.0** |
| Version code | **2** (Play rejected code 1 as already used; bump by 1 for every later upload) |
| Bundle | `mobile/dist/the-hour-brief-1.0.0-vc2.aab` — signed with the upload key (SHA-256 `CE:1E:B6:18:…:F1:E5:35`) |
| Release name (Console) | `2 (1.0.0)` |
| Track order | Internal testing → Closed testing (12+ testers, 14 days) → Production |

### Which bundle to upload

- **Upload `the-hour-brief-1.1.2-vc5.aab`** (versionCode 5). It supersedes everything before it, including `1.1.1-vc4` (same app, old icon and splash; do not upload it).
- New in vc5: the app icon and launch screen (from the Stitch design). The redesigned screens (app bar, tabs, Audio, quiz) ship with the website, which the app loads, so they appear as soon as the site is deployed. Fresh Play screenshots (1080x1919, light and dark) are in `mobile/play-store/screenshots/` (`node tools/brand/screenshots.mjs` remakes them); replace the old ones in the Console. Upload `play-store/icon-512.png` as the **App icon** in Main store listing so the store and the installed app match.
- `1.0.0-vc2` was rejected under the News and Magazines policy (no easy-to-find contact page). That is fixed in the site the app loads (`/contact.html`, a Contact link in every edition's nav and footer) and in the Console fields listed below. `1.1.0-vc3` was never uploaded; do not use it.
- What it contains vs 1.0.0: daily reminder (local notification), image sharing (Filesystem plugin, cache folder only), a native rating prompt (in-app review), and Listen (text-to-speech plugin for the on-device fallback; the main recording is a web audio file). Permissions: `INTERNET`, `VIBRATE`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`. No exact-alarm and no storage permissions. Target and compile SDK 36, min SDK 24.
- Notes for 1.1.2 (370 chars): `<en-US>` Listen to today's brief in an AI-generated Indian-English voice, with an Audio screen and chapters. Take the daily quiz with a weekly streak calendar and challenge friends in private leagues. Choose which sections you see and in what order. Save stories, set a daily reminder and pick a text size. New app icon, launch screen and a refreshed design, plus a Contact page. </en-US>

### Release notes ("What's new", max 500 chars — paste with the tags)

```
<en-US>
Welcome to The Hour Brief for Android.

• A fresh edition every morning: AI & tech, product & business, and the Indian and global markets
• Built for one sitting: every story has a short summary you can expand and a one-line takeaway
• Share any edition, pull down to refresh, and see a banner when a newer edition is out
• Follows your phone's light or dark theme
</en-US>
```

Internal / closed testing note: `Testing build 1.0.0 — please check that it installs, opens today's edition, links open in your browser, and Share works.`

## Store listing

- **App name:** The Hour Brief
- **Short description (74/80):** A daily brief on AI, business and markets — built for one hour of reading.
- **Category:** News & Magazines · **Free** · **No ads**
- **Contact:** milindroy101292@gmail.com · https://the-hour-brief.vercel.app · contact page https://the-hour-brief.vercel.app/contact.html
- **Privacy policy:** https://the-hour-brief.vercel.app/privacy.html

**Full description**

```
The Hour Brief is a daily read built for one sitting — about an hour, once a morning.

Every edition covers three lanes:
• AI & Tech — what moved in AI and technology
• Product & Business — what's shaping products and companies, in India and globally
• Stock Market — how Indian and US markets closed, the day's movers, and one investing principle worth remembering

Made to be read, not scrolled:
• Every story has a short summary you can expand and a one-line takeaway
• A five-question daily quiz on the edition, with streaks, badges and a shareable score (no account needed)
• Friends leagues: start a private league, invite friends with a link and compare quiz scores every day (no sign-up, no typed names)
• Listen to today's brief: a 7-minute read-aloud of the day's headlines and takeaways in an AI-generated Indian-English voice
• Every summary links back to its original source
• Clean layout, no ads, and it follows your phone's light or dark theme
• Share any edition with one tap, pull down to refresh, and see a banner when a newer edition is out
• Browse the archive of past editions

How it's made: editions are researched with AI from public reporting, newsletters and market data, and every item links to its source. It is not independently fact-checked, so check the source before relying on anything. Nothing here is investment advice.

Free, and no account needed. Prefer your inbox? Subscribe by email from the app.
```

## App content answers

- **App access:** all functionality available without login.
- **Ads:** No. **Advertising ID:** No.
- **Target audience:** 18 and over (avoids the Families policy).
- **News app declaration:** yes, it's a news/information app. It is AI-researched and says so on the About page.
- **Financial features:** none (market figures are informational, no trading or accounts).
- **Content rating (IARC):** category *Reference, News or Educational*. Answer honestly for tech, business and market news: no violence, sexual content, profanity, drugs or gambling; no user-to-user interaction (comments are hidden in the app); no location sharing; no purchases.

## Data safety

Nothing is sold. League members can see each other's generated name and score (that is the feature); declare it as not "shared" with third parties. Vercel, MailerLite and Upstash process data on your behalf (service providers, not "sharing"). Data is encrypted in transit (HTTPS). Users can request deletion by email (see privacy policy).

| Data type | Collected | Why | Optional |
|---|---|---|---|
| Email address (Personal info) | Yes | App functionality (newsletter delivery via MailerLite) | Yes — only if they subscribe |
| App interactions (App activity) | Yes | Analytics; app functionality (👍/👎 vote totals) | No |
| Device or other IDs | Yes | Fraud prevention (one-way IP hash kept ~24 h to stop repeat voting) and App functionality (the random app-generated ID used only if the reader joins a friends league, linked to a generated name and daily score, kept ~120 days) | No (leagues part: only if they use leagues) |
| Other actions (App activity) | Yes | App functionality — the daily quiz score shown to league members | Yes — only if they use leagues |

Judgement calls to confirm before submitting:
- Vercel Web Analytics also reports country, device and browser in aggregate. To be conservative, also declare **Approximate location** and **App info and performance**, and consider adding "country, device type and browser" to the analytics sentence in `privacy.html` (it currently says only page views and referrers). Declaring slightly more than you collect is safe; declaring less is what gets apps rejected.
- **Comments are hidden inside the app** (`capacitor-bridge.js`), so no user-generated content is collected or shown via the app. Play's UGC policy would otherwise require in-app reporting and blocking.

## News and Magazines policy: contact requirements

Play flagged the app for lacking an easy-to-find contact page. Fixes shipped in the site (the app loads it): `/contact.html` (labelled "Contact us", email address, reply time), a "Contact" pill in every edition's section nav, a labelled "Contact us:" block with the email in every edition's footer, and a link from About, Privacy and the archive. A CI check fails if the latest edition ever loses the link. Console values:

- **Grow users → Store presence → Store settings → Store listing contact details:** Email `milindroy101292@gmail.com`; Website `https://the-hour-brief.vercel.app`.
- **App content → News and Magazines declaration:** category News app, contact information URL `https://the-hour-brief.vercel.app/contact.html`; re-check every answer is still accurate.
- Social media links do not count as contact information. The app must show content under three months old (a new edition every day) and name the original source of each article (each story links its publisher).

## Before you submit

1. **Deploy the site first.** The comments-hiding and reading-layout changes live in `capacitor-bridge.js`, `mobile.css` and `mobile.js`, which the app loads from the live site. Play's reviewers will see the comments section until those are deployed.
2. Upload `the-hour-brief-1.0.0-vc2.aab`. Play rejects reused version codes, so bump `versionCode` in `android/app/build.gradle` before every future build (`./gradlew bundleRelease`).
3. Keep `mobile/android/thb-upload-key.jks` + `keystore.properties` backed up (copies are in `~`).
