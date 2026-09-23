# App Store — release package (iOS v1.0)

Screenshots (git-ignored, upload from here): `mobile/dist/app-store/`
`iphone-6.9in/` (5 × 1320×2868) · `ipad-13in/` (5 × 2064×2752)
App icon: 1024×1024, no alpha, already in `ios/App/App/Assets.xcassets`.

## Build

| | |
|---|---|
| Bundle ID | `app.thehourbrief` |
| Version / build | **1.0** / **1** (bump the build number for every upload; the daily reminder plugin is already in the project) |
| Minimum iOS | 15.0 · iPhone + iPad |
| Encryption | `ITSAppUsesNonExemptEncryption = false` (standard HTTPS only) |
| Privacy manifest | `ios/App/App/PrivacyInfo.xcprivacy` — no tracking, no collected data, no required-reason APIs |
| Signing | Automatic; set your Team in Xcode → Signing & Capabilities |

## App Store Connect fields

- **Name (14/30):** The Hour Brief
- **Subtitle (28/30):** Daily AI, business & markets
- **Primary category:** News · **Secondary:** Business
- **Price:** Free · **Availability:** all countries
- **SKU:** `thehourbrief-ios`
- **Copyright:** © 2026 Milind Roy
- **Support URL:** https://the-hour-brief.vercel.app/privacy.html (has the contact email; swap for a dedicated support page if you add one)
- **Marketing URL:** https://the-hour-brief.vercel.app
- **Privacy Policy URL:** https://the-hour-brief.vercel.app/privacy.html
- **Promotional text (129/170):** A fresh edition every morning: AI & tech, product & business, and the Indian and global markets. Free, no ads, no account needed.
- **Keywords (94/100):** `news,digest,AI,tech,business,markets,stocks,sensex,nifty,startups,India,daily,briefing,finance`
- **What's New (v1.0):** Welcome to The Hour Brief. A fresh edition every morning, built for one sitting: AI & tech, product & business, and the markets.

**Description**

```
The Hour Brief is a daily read built for one sitting — about an hour, once a morning.

Every edition covers three lanes:
• AI & Tech — what moved in AI and technology
• Product & Business — what's shaping products and companies, in India and globally
• Stock Market — how Indian and US markets closed, the day's movers, and one investing principle worth remembering

Made to be read, not scrolled:
• Every story has a short summary you can expand and a one-line takeaway
• A five-question daily quiz on the edition, with streaks and a shareable score (no account needed)
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

Judgement calls, same as Play: the last two are conservative. Apple has no IP-address category, so the hash is declared as an identifier. Over-declaring is safe; under-declaring is what gets flagged. Consider adding "country, device type and browser" to the analytics sentence in `privacy.html`.

## App Review notes (paste into "Notes")

```
The Hour Brief is a free daily news digest. No login or demo account is needed; every feature is available on launch.

Content: each edition is researched with AI from public reporting and market data. Every item is a short original summary with a one-line takeaway and a link to the original source (opens in an in-app browser). This is disclosed in the app's About text and on https://the-hour-brief.vercel.app/about.html. Market figures are informational only; there is no trading or financial service.

The app is more than a website wrapper. Native features: a daily reminder (a local notification the reader schedules at a time they choose), a daily quiz with on-device streaks, system share sheet for any edition or single story, haptic feedback, pull-to-refresh, in-app browser for sources, offline notice, a banner when a newer edition is published, and a native launch experience. Editions load from our server so readers get each new edition without waiting for an app update.

User comments and account features from the website are intentionally hidden in the app; there is no user-generated content.

Contact for review questions: milindroy101292@gmail.com, [add your phone number here]
```

## Before you submit

1. **Deploy the site first** (comments hidden in the app, new reading layout). The app loads these files from the live site, and reviewers will see whatever is live.
2. **Guideline 4.2 (minimum functionality) is the main rejection risk** for a web-content app. The review notes above make the case, but adding one substantial native feature lowers the risk a lot (see the options in the launch steps).
3. Tablet and desktop widths still show the very long lane headline (the clamp only applies at phone widths). Not a rejection risk, but worth fixing for iPad.
4. Screenshots use the current layout and today's edition; the headlines in them will date. That's normal.
