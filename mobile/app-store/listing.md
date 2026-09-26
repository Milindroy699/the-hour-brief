# App Store — release package (iOS v1.1.2)

Screenshots (in git, upload from here), all light + dark, numbered in the order to upload:
`mobile/app-store/screenshots/` iPhone 6.9-inch, 6 × 1320×2868 (feed, highlights, swipe cards, Audio, quiz, Your sections)
`mobile/app-store/screenshots-ipad/` iPad 13-inch, 6 × 2064×2752 (same six; needed because the app runs on iPad)
Remake them any time from the live UI: `node tools/brand/screenshots.mjs --only app-store`.
App icon: 1024×1024, RGB, no alpha (checked), already in `ios/App/App/Assets.xcassets`.

## Your steps, in order (values to type in)

Checked from this Mac (2026-09-26): an unsigned Release archive for "Any iOS Device (arm64)" builds cleanly (`xcodebuild ... archive CODE_SIGNING_ALLOWED=NO`), the archive holds version 1.1.2 (1), iOS 15+, iPhone + iPad, the new icon and launch image, and privacy manifests for the app and for Capacitor and Cordova. Only signing and the uploads below need your Apple account.

1. **Xcode** (`cd mobile && npm run open:ios`, or open `mobile/ios/App/App.xcodeproj`): target *App* → Signing & Capabilities → tick *Automatically manage signing* → pick your **Team**. Nothing else to change: bundle id `app.thehourbrief`, version 1.1.2, build 1, the icon and the privacy manifest are already set. Xcode registers the App ID for you (no need to visit developer.apple.com).
   - No usage-description strings are needed: the app uses no camera, photos, location, contacts or microphone. The daily reminder uses the system notification prompt, which has no Info.plist string.
2. **App Store Connect** → Apps → **+** → New App: Platform iOS · Name `The Hour Brief` · Primary language English (U.S.) · Bundle ID `app.thehourbrief` (appears after step 1) · SKU `thehourbrief-ios` · Full access.
3. **Archive and upload:** run destination *Any iOS Device (arm64)* → Product → Archive → Distribute App → App Store Connect → Upload. Processing takes 5–30 minutes; you get an email. **Every later upload needs a higher build number** (Build field in Xcode, currently 1).
4. **TestFlight first** (recommended, and it is your real-device test, which I cannot do from here): add yourself as an internal tester (no review). Try: the launch screen and icon, the feed, List | Cards, Listen (recorded voice, with the phone's silent switch ON and OFF), the daily reminder prompt, share sheet, the quiz, airplane mode (the offline page). External testers need a short Beta App Review.
5. **Fill in the listing** (values below): screenshots, description, keywords, promo text, What's New, support/marketing/privacy URLs, App Privacy answers, age rating, category, price, App Review notes (add your phone number), then select the build and *Submit for Review*.
- Paid apps agreements, banking and tax forms are not needed (free app, no in-app purchases).

## Build

| | |
|---|---|
| Bundle ID | `app.thehourbrief` |
| Version / build | **1.1.2** / **1** (this is the first upload; bump the build number for every one after this) |
| Minimum iOS | 15.0 · iPhone + iPad |
| Encryption | `ITSAppUsesNonExemptEncryption = false` (standard HTTPS only) |
| Privacy manifest | `ios/App/App/PrivacyInfo.xcprivacy` — no tracking; collected data matches the App Privacy table below; declares the file-timestamp API (reason C617.1) used by the Filesystem plugin |
| Orientation | iPhone: portrait only (the swipe cards need the height); iPad: all |
| Signing | Automatic; set your Team in Xcode → Signing & Capabilities |

## App Store Connect fields

- **Name (14/30):** The Hour Brief
- **Subtitle (28/30):** Daily AI, business & markets
- **Primary category:** News · **Secondary:** Business
- **Price:** Free · **Availability:** all countries
- **SKU:** `thehourbrief-ios`
- **Copyright:** © 2026 Milind Roy
- **Support URL:** https://the-hour-brief.vercel.app/contact.html (the contact page: email and topics)
- **Marketing URL:** https://the-hour-brief.vercel.app
- **Privacy Policy URL:** https://the-hour-brief.vercel.app/privacy.html
- **Promotional text (129/170):** A fresh edition every morning: AI & tech, product & business, and the Indian and global markets. Free, no ads, no account needed.
- **Keywords (94/100):** `news,digest,AI,tech,business,markets,stocks,sensex,nifty,startups,India,daily,briefing,finance`
- **What's New (1.1.2):** A new look, and more ways to read. Swipe through the brief one story at a time, or keep scrolling. Choose which sections you see and in what order. A recorded AI voice reads each morning's edition. Plus a daily quiz, private friends leagues, and a daily reminder.
- **What's New (v1.0, for reference):** Welcome to The Hour Brief. A fresh edition every morning, built for one sitting: AI & tech, product & business, and the markets.

**Description**

```
The Hour Brief is a daily read built for one sitting — about an hour, once a morning.

Every edition covers three lanes:
• AI & Tech — what moved in AI and technology
• Product & Business — what's shaping products and companies, in India and globally
• Stock Market — how Indian and US markets closed, the day's movers, and one investing principle worth remembering

Made to be read, your way:
• Scroll the whole brief, or swipe through it one story at a time in card view
• Choose which sections you see, and in what order
• Every story has a short summary you can expand and a one-line takeaway
• A five-question daily quiz on the edition, with streaks, badges and a shareable score (no account needed)
• Friends leagues: start a private league, invite friends with a link and compare quiz scores every day (no sign-up, no typed names)
• Listen to today's brief: a 7-minute read-aloud of the day's headlines and takeaways in an AI-generated Indian-English voice
• Every summary links to its original source
• Clean layout with no ads, in light or dark mode
• Share any edition with one tap, pull down to refresh, and see a banner when a newer edition is out
• Browse the archive of past editions

How it's made: editions are researched with AI from public reporting, newsletters and market data, and every item links to its source. It is not independently fact-checked, so check the source before relying on anything. Nothing here is investment advice.

Free, and no account needed. Prefer your inbox? Subscribe by email from the app.
```

## Questionnaires

**Age rating:** answer None/No to every content question (violence, sexual content, profanity, drugs, gambling, horror, medical). User-generated content: No (comments are hidden in the app). Unrestricted web access: No (users cannot enter URLs; only curated source links open, in an in-app browser). Expected rating: 4+.

**Content rights:** answer Yes, the app shows third-party content. Basis: short original summaries with attribution and a link to each source, not reproduced articles. Be ready to explain this if asked.

**Export compliance:** the app uses only standard HTTPS. Answer that it uses no non-exempt encryption.

**App Privacy** (nothing is used for tracking; Vercel, MailerLite and Upstash are service providers):

| Data type | Linked to user | Purpose |
|---|---|---|
| Contact Info → Email Address (only if they subscribe) | Yes | App Functionality |
| Usage Data → Product Interaction (page views, 👍/👎 votes) | No | Analytics, App Functionality |
| Location → Coarse Location (country, aggregate, via Vercel Analytics) | No | Analytics |
| Identifiers → Device ID (one-way IP hash, ~24 h, stops repeat voting) | No | App Functionality |
| Identifiers → User ID (random device ID, only if they join a friends league; ~120 days) | Yes | App Functionality |
| Usage Data → Product Interaction (daily quiz score inside a league) | Yes | App Functionality |

Judgement calls, same as Play: the last two are conservative. Apple has no IP-address category, so the hash is declared as an identifier. Over-declaring is safe; under-declaring is what gets flagged. Consider adding "country, device type and browser" to the analytics sentence in `privacy.html`.

## App Review notes (paste into "Notes")

```
The Hour Brief is a free daily news digest. No login or demo account is needed; every feature is available on launch.

Content: each edition is researched with AI from public reporting and market data. Every item is a short original summary with a one-line takeaway and a link to the original source (opens in an in-app browser). This is disclosed in the app's About text and on https://the-hour-brief.vercel.app/about.html. Market figures are informational only; there is no trading or financial service.

The app is more than a website wrapper. Native features: a daily reminder (a local notification the reader schedules at a time they choose), a daily quiz with on-device streaks and badges, private friends leagues (invite by link; players get generated names, so there is no user-generated text), a swipe-card reading mode and personalised sections (readers choose which sections show and in what order), a native rating prompt after a streak, a "Listen to today's brief" read-aloud with a mini player (on-device text-to-speech), system share sheet for any edition or single story, haptic feedback, pull-to-refresh, in-app browser for sources, offline notice, a banner when a newer edition is published, and a native launch experience. Editions load from our server so readers get each new edition without waiting for an app update.

User comments and account features from the website are intentionally hidden in the app; there is no user-generated content.

Contact for review questions: milindroy101292@gmail.com, [add your phone number here]
```

## Before you submit

1. **Deploy the site first** (comments hidden in the app, new reading layout). The app loads these files from the live site, and reviewers will see whatever is live.
2. **Guideline 4.2 (minimum functionality) is the main rejection risk** for a web-content app. The review notes above make the case, but adding one substantial native feature lowers the risk a lot (see the options in the launch steps).
3. iPad: the same reading layout is used (one centred column, floating tab bar). iPad screenshots are in `screenshots-ipad/`.
4. Screenshots use the current layout and today's edition; the headlines in them will date. That's normal.

## Screenshots
See the top of this file. They are rendered from the live UI in the app look (headless Chrome), not captured on a device, so the status bar and home indicator are not shown; that is allowed. Replace them with Simulator or device captures if you prefer.
