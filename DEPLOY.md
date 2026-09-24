# Deployment

**Canonical URL:** https://the-hour-brief.vercel.app/

This repo auto-deploys to Vercel on every push to `main` (connected via the Vercel GitHub integration). GitHub Pages remains enabled as a secondary mirror at https://milindroy699.github.io/the-hour-brief/ but the Vercel URL is the one to share, link to, and use in `feed.xml` / Open Graph tags.

No build step — this is a plain static site (`index.html`, `archive/`, `feed.xml`, `editions.json`) served as-is.

## Shared front-end files

`index.html` and the `archive/*.html` editions each carry a full inline `<style>` and `<script>`, plus three shared files loaded by absolute path from `<head>`:

- `capacitor-bridge.js` — native-app glue (no-op in a browser)
- `mobile.css` — phone-only (`<link media="(max-width: 640px)">`) layout refinements
- `mobile.js` — phone-only reading enhancements (collapsible stories, About toggle)

Every edition page must keep these lines, plus `/quiz.css` and `/quiz.js` (the anonymous daily quiz; it renders from the `#quiz-data` JSON in the edition and hides itself if that is empty). The daily template is `index.html`, so a new edition copied from it inherits them automatically.

Because the paths are absolute (`/mobile.css` …), the GitHub Pages mirror (served under `/the-hour-brief/`) does **not** pick up `mobile.css` / `mobile.js`. Vercel is canonical; the mirror is best-effort.

## Premium skin (phones, the apps and the desktop website)

Design: Stitch "The Editorial Brief" (project "App Logo and Splash Screen"). It is `app.css`, imported by `mobile.css`, which the pages link for phone
widths and `mobile.js` injects at wider widths (apps and desktop). Wide screens get the same app in one centred 680px column (the tab bar becomes a
floating pill, the Audio screen and dialogs centre, the signup box sits below the feed and is reachable from the menu's "Get it by email").
`?classic=1` on any URL shows the old wide layout (a safety valve; also the fastest rollback test). To switch the desktop redesign off for everyone,
make `reader()` in `mobile.js` and `listen.js` return `mq.matches || NATIVE`. Pieces: app bar (the masthead, reworked: logo,
wordmark, screen name, text size, saved, menu), bottom tabs (Today / Audio / Challenge / Archive), an "All" chip plus the section chips (the one in
view is filled), the "Before the news" card, the quiz chip and Listen card, green section badges, numbered highlights, takeaway callouts, the Audio hub
(`listen.js`: progress from the recording's real timings, chapters, narrator; opens from the Audio tab, the mini player, or `/?audio=1`), and the quiz
(`quiz.js`: streak card with a real Monday-Sunday strip, topic badge, segmented progress, insight callout, past quizzes from the reader's own results).
Left out on purpose because we do not have them: XP, "Top 8% recall", spatial audio, offline download, voice switching, topic-mastery percentages.
- Fonts are self-hosted in `webfonts/` (Inter, Newsreader, Space Grotesk, Latin subsets, OFL licences alongside); nothing is fetched from a third party.
- Colours come from the page's own tokens re-pointed in `app.css`, with light and dark sets. Do not use `color-mix(..., transparent)`: the Android
  WebView on Chrome 113 renders it as an opaque colour; use the `rgba(var(--hb-*-rgb), a)` tokens.
- Brand files: `brand/` (logo 128/256, favicon, touch icon; all made by `node tools/brand/render.mjs`), `og-image.png` (`node tools/brand/og.mjs`, drawn by the
  same code as the dynamic share cards in `api/og.mjs`, which bundles `fonts/` and `brand/` via `vercel.json`), the quiz score picture (`quiz.js` drawCard, on the
  device). The favicon links live in every page's `<head>`; the daily routine copies `index.html` as its template, so new editions inherit them.
  `node tools/brand/screenshots.mjs` remakes the store screenshots.
- Tests: `node tools/browser-tests/premium.mjs` (with `prefs.mjs` and `listen.mjs`). To see the app itself, build a debug APK whose `server.url` is a
  local static server (`http://10.0.2.2:PORT`, `cleartext: true`), run it on the emulator, then put `mobile/capacitor.config.json` back (never commit that).

## Your sections (show / hide / reorder)

`mobile.js` (reader mode only: phones and the apps) lets readers switch the sections (`section.lane`: AI, Business, Markets, Quiz) on or off
and move them up or down, from the sliders button under the section pills. The apps also offer the sheet once on first launch (never on the
website, never when opened from a shared link). The choice lives in `localStorage` key `hb-prefs-v1` (`{order:[ids], off:[ids]}`); nothing is sent anywhere.
Sections are moved and hidden in place (`data-pref-off` marks hidden ones), so ids, links and scripts keep working; unknown ids are ignored, so new
sections just appear at the end. `listen.js` follows the choice: hidden sections are skipped and the recording jumps between the manifest's
timings to play the reader's order (the recorded outro is dropped when the quiz is hidden). A shared story link into a hidden section still shows it for that visit.
Tests: `node tools/browser-tests/prefs.mjs`.

## Daily quiz

- `reader.css` holds the reusable reader components (section highlights, story share/save, tools row, sheets). `mobile.css` imports it on phones and `mobile.js` injects it in the native apps at any width; the desktop website never loads it.
- `quiz.js` / `quiz.css` render the quiz from `<script type="application/json" id="quiz-data">` in each edition. Results and streaks live in the reader's `localStorage`; nothing personal is stored.
- `api/quiz-stats.js` keeps an anonymous score tally per edition in Vercel KV (`quiz:dist:<date>:<total>`, 30-day expiry). It needs the same `KV_REST_API_URL` / `KV_REST_API_TOKEN` as the vote API.
- `api/league.js` powers friends leagues (actions `create|join|leave|score`, GET standings). Same KV env vars. Everything is keyed `lg:<CODE>*` with a 120-day TTL. Players are a random device ID plus a server-generated name; no user-typed text is stored, which keeps the leagues clear of app-store UGC rules. Rate limits are per hashed IP (5 creates, 30 joins, 60 scores a day).
- `listen.js` ("Listen to today's brief") is fetched on demand by `mobile.js` in reader mode, so no page template needs to reference it. If a recording of the day exists on R2 (made by the `Daily audio` workflow, `tools/audio/`), it plays that in an AI voice; otherwise it speaks with the browser's Web Speech API, or in the Android app (whose WebView has no speech API) with the `@capacitor-community/text-to-speech` plugin. Only the Quick reading (about 7 minutes) is recorded. The longer Full reading (device voice, free, starting at 1.25x, about 13 minutes) is switched off by `OFFER_FULL` in `listen.js`; flip that default to bring it back (recording it would cost about three times as much as Quick). Its styles live in `reader.css`.
- Link previews use `og-image.png` (1200×630).

## Link previews and the daily channel post

- Shares use landing pages (`/e/<date>`, `/s/<date>/<id>`, `/q/<date>/<score>`, `/l/<code>`, served by `api/share.js`) that carry Open Graph tags and redirect people on. Preview cards are drawn by `api/og.mjs` (satori + resvg; fonts in `fonts/`, bundled via `vercel.json`). It is a plain Node function; the edge runtime cannot bundle it.
- `api/post-digest.js` posts the day's takeaways and quiz link to a Telegram channel (Vercel Cron at 04:30 and 05:30 UTC, deduplicated in KV). Env vars: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `CRON_SECRET`. Test with `?dry=1`.
- WhatsApp channels have no posting API: `/share-kit.html` (not linked anywhere) shows today's post with copy buttons.
