# Google Play — release package (v1.0.0)

Assets (git-ignored, upload from here): `mobile/dist/play-store/`
`icon-512.png` · `feature-graphic-1024x500.png` · `screenshots/01…05` (1080×2100)

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

- **`the-hour-brief-1.0.0-vc2.aab`** is what is in the closed-test review now.
- **`the-hour-brief-1.1.0-vc3.aab`** adds the daily reminder (local notification), image sharing (Filesystem plugin, cache folder only), a native rating prompt (in-app review) and Listen mode (text-to-speech plugin, on-device). Extra permissions vs 1.0.0: `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`. No exact-alarm permission and no storage permissions. Upload it to the same closed-test track as a new release once the current review clears (or replace the pending release, accepting a fresh review). Data safety only changes for friends leagues (see the table below): the reminder and Listen run on the device and send nothing.
- Notes for 1.1.0: `<en-US>` Take the new 5-question daily quiz and share your score as an image. Listen to today's brief with on-device text-to-speech. Challenge friends in private quiz leagues and earn streak badges. Save stories for later and pick a text size that suits you. Set a daily reminder: tap the bell and pick a time. Read each section's highlights at a glance, and share a single story with a link back to it. </en-US>

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
• Listen to today's brief: a 7-minute Quick read-aloud in an Indian-English voice, or a longer read-aloud in your device's own voice
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
| Device or other IDs | Yes | Fraud prevention — one-way IP hash kept ~24 h to stop repeat voting | No |
| User IDs (Personal info) | Yes | App functionality — the random device ID used only if the reader joins a friends league; linked to a generated name and daily quiz score, kept ~120 days | Yes — only if they use leagues |
| Other in-app content (App activity) → quiz scores | Yes | App functionality — daily score shown to league members | Yes — only if they use leagues |

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
