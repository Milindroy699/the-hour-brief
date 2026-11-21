# App Store — release package (iOS v1.1.2)

Screenshots (in git, upload from here), all light + dark, numbered in the order to upload:
`mobile/app-store/screenshots/` iPhone 6.9-inch, 7 × 1320×2868 (cover, swipe cards, feed, highlights, Audio, quiz, Your sections)
`mobile/app-store/screenshots-6.5in/` iPhone 6.5-inch, 7 × 1242×2688 (same seven) — this is the size App Store Connect's "Prepare for Submission" page actually asked for on this app's first version; use these if the 6.9-inch ones don't fit that tab.
`mobile/app-store/screenshots-ipad/` iPad 13-inch, 7 × 2064×2752 (same seven; needed because the app runs on iPad)
**2026-11-21: new framed set, 6 shots each (caption on the brand background + the current app UI): 01 cards, 02 story, 03 listen, 04 quiz, 05 Voices, 06 dark list.** Remake any time: `node tools/brand/store-shots.mjs` (writes all four sets). Upload in order 01–06; delete the old seven in App Store Connect first.
App icon: 1024×1024, RGB, no alpha (checked), already in `ios/App/App/Assets.xcassets`.

## Your steps, in order (values to type in)

Checked from this Mac (2026-09-29, developer account now active): a real, fully **signed** archive and App Store Connect export both succeed from the command line (`xcodebuild archive`, then `-exportArchive -exportOptionsPlist` with `method: app-store-connect`) — Xcode auto-registered the `app.thehourbrief` App ID and signs with a Cloud Managed Apple Distribution certificate (no local .p12 to manage). The archive holds version 1.1.2 (1), iOS 15+, iPhone + iPad, the new icon and launch image, and privacy manifests for the app and for Capacitor and Cordova. Only the App Store Connect app record (step 2, a website-only step) and the listing below need you directly; step 3 (archive/upload) can be done either from Xcode or from here — ask if you'd rather I ran it.

1. **Xcode signing — already done:** target *App* → Signing & Capabilities has *Automatically manage signing* on with your **Team** (`PUXF34ZNNT`). Bundle id `app.thehourbrief`, version 1.1.2, build 1, the icon and the privacy manifest are already set. Nothing to do here unless you're checking it.
   - No usage-description strings are needed: the app uses no camera, photos, location, contacts or microphone. The daily reminder uses the system notification prompt, which has no Info.plist string.
2. **App Store Connect** → Apps → **+** → New App: Platform iOS · Name `The Hour Brief` · Primary language English (U.S.) · Bundle ID `app.thehourbrief` · SKU `thehourbrief-ios` · Full access. (Website only — I have no path to do this one for you.)
3. **Archive and upload:** either run *Any iOS Device (arm64)* → Product → Archive → Distribute App → App Store Connect → Upload in Xcode, or ask me to run the equivalent from the terminal (`xcodebuild archive` + `-exportArchive` with `destination: upload`) once step 2 is done. Processing takes 5–30 minutes; you get an email. **Every later upload needs a higher build number** (Build field in Xcode, currently 1).
4. **TestFlight first** (recommended, and it is your real-device test, which I cannot do from here): add yourself as an internal tester (no review). Try: the launch screen and icon, the swipe cards (they open first; the List button goes to the scrolling feed), the menu (top right of the cards), Listen (recorded voice, with the phone's silent switch ON and OFF), the daily reminder prompt, share sheet, the quiz, airplane mode (the offline page). External testers need a short Beta App Review.
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

**Listen, in one sentence (keep every text below saying this):** Listen plays a *recording* of the day's edition (about 6 minutes) in an AI-generated Indian-English voice, labelled "AI voice" in the player; if that day's recording is not ready yet, the phone's own text-to-speech reads it instead. The website's About and Privacy pages say the same.

- **Name (26/30):** The Hour Brief: Daily News   _(was "The Hour Brief"; updated 2026-11-21 for search)_
- **Subtitle (27/30):** AI, Stock Market & Business
- **Primary category:** News · **Secondary:** Business
- **Price:** Free · **Availability:** all countries
- **SKU:** `thehourbrief-ios`
- **Copyright:** © 2026 Milind Roy
- **Support URL:** https://the-hour-brief.vercel.app/contact.html (the contact page: email and topics)
- **Marketing URL:** https://the-hour-brief.vercel.app
- **Privacy Policy URL:** https://the-hour-brief.vercel.app/privacy.html
- **Promotional text (161/170, can be changed any time without a new version):** Today’s AI, business and stock market news in one short brief every morning, plus weekly long reads from the best minds. Listen in 7 minutes, then take the quiz.
- **Keywords (99/100):** `sensex,nifty,share,finance,tech,startup,india,briefing,summary,podcast,quiz,current,affairs,economy`
  _(2026-11-21: no word repeats the name or subtitle, since Apple already indexes those and combines words across all three: "share" + "Market" = share market, "current" + "affairs", "news" + "summary"/"podcast". Name, subtitle and keywords only change with a new app version.)_
- **What's New (1.1.4)** _(2026-11-21; paste this one)_:
  ```
  • Morning notifications that tell you the day's sharpest story, plus an evening quiz teaser
  • Leagues: play the daily quiz against friends, your class or your office, and invite them with a 6-character code
  • Voices: weekly long reads on what the best minds in tech, business, product and finance are saying
  • The daily brief is now a podcast on Spotify, Apple Podcasts and Amazon Music
  • Steadier loading and a cleaner swipe-card reader
  ```
- **What's New (1.1.2):** A new look, and a new way to read: the brief now opens as swipe cards, one story at a time (switch to the full scrolling list any time). Choose which sections you see and in what order. A recorded AI voice (labelled as AI) reads each morning's edition, with a floating audio button and the cards turning to each story as it is read. Plus a daily quiz, private friends leagues, and a daily reminder.
- **What's New (v1.0, for reference):** Welcome to The Hour Brief. A fresh edition every morning, built for one sitting: AI & tech, product & business, and the markets.

**Description**  _(updated 2026-11-21: 2166/4000; adds Voices, college/office leagues; no email sign-up, no reordering, stories show in full, podcast + channels + reviewed market section)_

```
The Hour Brief is your daily news summary for India: what moved in AI and technology, what's shaping business and startups in India and worldwide, and what the stock market did and why. One short brief every morning, built for one sitting.

Every edition has three sections:
• AI & Tech: the AI and tech news that actually mattered today
• Product & Business: business and startup news from India and around the world
• Stock Market: how Sensex, Nifty and the US markets closed, the day's movers, and why

Voices, for deeper reading:
• Every week, one long read each on Tech & AI, Business, Product and Finance: the best thinking from the people worth listening to, from the week's podcasts, newsletters and talks
• Weekend essays on principles for work and life
• Every piece names who said it and links to the original

Read it, listen to it, or both:
• Listen in about 7 minutes: each morning's brief is read aloud in an AI-generated Indian-English voice, with chapters, offline playback and the screen off. The same episode is also a podcast on Spotify, Apple Podcasts and Amazon Music.
• Swipe through one story at a time, or switch to the full list
• Every story has a short summary, a one-line takeaway, and a link to its original source
• Hide the sections you don't want
• A morning reminder, so the brief is waiting when you are

Daily current affairs quiz:
• Five quick questions on the day's news, about a minute
• Streaks and badges, and a score you can share
• Leagues: play against your friends, or start one for your college class or office team (up to 300 players), and compare scores every day. No sign-up.

Also:
• Past editions archive, light and dark mode, no ads, no account needed
• The brief every morning on WhatsApp and Telegram too

How it's made: each edition is researched and written with AI from public reporting and market data, and every item links to its source. Voices pieces are written with AI from the podcasts, newsletters and talks they cite. The Stock Market section is reviewed by a person each morning after it publishes, and corrections are noted on the story. Nothing here is investment advice.

Free. No ads. No sign-up.
```

## Questionnaires

**Age rating:** answer None/No to every content question (violence, sexual content, profanity, drugs, gambling, horror, medical). User-generated content: **Yes** (since 2026-11-21: a college / office / community league's name is typed by whoever starts it and shown to that league's players; comments stay hidden in the app). What guideline 1.2 asks for is in place: names are filtered (length, characters, no links, a profanity blocklist in English and Hindi), any player can tap "Report this league's name" (the owner gets it on Telegram and can replace the name with one tap; reviewed within a day), any player can leave a league at any time (players only ever have generated names, so there is no one else to block), and the contact page is public. Unrestricted web access: No (users cannot enter URLs; only curated source links open, in an in-app browser). Expected rating: 4+.

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

The app is more than a website wrapper. Native features: a daily reminder (a local notification the reader schedules at a time they choose), a daily quiz with on-device streaks and badges, leagues (friends leagues, and college / office leagues of up to 300 players; invite by link or code; players get generated names), a swipe-card reading mode and personalised sections (readers choose which sections show), a native rating prompt after a streak, a "Listen to today's brief" read-aloud with a mini player (a recording of the day's edition in an AI-generated voice, labelled "AI voice" in the player and disclosed in the About text; the device's own text-to-speech is only a fallback if the recording is not ready yet), system share sheet for any edition or single story, haptic feedback, pull-to-refresh, in-app browser for sources, offline notice, a banner when a newer edition is published, and a native launch experience. Editions load from our server so readers get each new edition without waiting for an app update.

User-generated content is limited to one thing: the name of a college, office or community league, typed by the person who starts it and shown only to that league's players. Names are filtered (no links, a profanity blocklist), every league card has "Report this league's name" (reviewed by us within a day, and the name can be replaced at once), and any player can leave a league at any time. Players themselves only ever get generated names ("Calm Wombat 80"). User comments and account features from the website are hidden in the app.

Contact for review questions: milindroy101292@gmail.com, [add your phone number here]
```

## Before you submit

1. **Deploy the site first** (comments hidden in the app, new reading layout). The app loads these files from the live site, and reviewers will see whatever is live.
2. **Guideline 4.2 (minimum functionality) is the main rejection risk** for a web-content app. The review notes above make the case, but adding one substantial native feature lowers the risk a lot (see the options in the launch steps).
3. iPad: the same reading layout is used (one centred column, floating tab bar). iPad screenshots are in `screenshots-ipad/`.
4. Screenshots use the current layout and today's edition; the headlines in them will date. That's normal.

## Screenshots
See the top of this file. They are rendered from the live UI in the app look (headless Chrome), not captured on a device, so the status bar and home indicator are not shown; that is allowed. Replace them with Simulator or device captures if you prefer.
