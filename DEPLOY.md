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

## Podcast (Spotify, Apple Podcasts)

The daily Quick recording is also a podcast. `tools/audio/podcast.mjs` builds an RSS feed from the manifests already in R2 (file, size, duration) and
the edition page (title, section takeaways): one episode per day, guid `hourbrief-<date>`, newest first, AI-voice disclosure in every description.
`tools/audio/publish-feed.sh` (run by `audio.yml` after each recording, or by hand with the "Podcast feed" workflow) syncs the manifests, builds
`podcast.xml`, uploads it to R2 with the right content type, then `--verify`s it: feed structure, cover art, and that the newest audio is served with
the right size, `audio/mpeg` and range support. It costs nothing (no Sarvam) and refuses to publish an empty feed.
- **Live since 2026-09-26** with the 24 and 25 Sep episodes (published and verified by the "Podcast feed" workflow; `audio.yml` refreshes it after each recording). Not yet submitted to Spotify/Apple: that is the owner's step below.
- Feed address: `<R2_PUBLIC_URL>/podcast.xml` (today `https://pub-1dafea4a948540db8413a044895e083c.r2.dev/podcast.xml`). Cover: `brand/podcast-cover.jpg`
  (2048px, `node tools/brand/podcast-cover.mjs`), served by Vercel, so deploy it BEFORE submitting the feed. Show details (name, description, category,
  owner email) are `SHOW` in `podcast.mjs`.
- Episodes must not disappear from R2 (removing an item can remove it from Spotify), so `audio.yml` now keeps everything unless the repository variable
  `AUDIO_KEEP_DAYS` is set. About 3 MB a day.
- `r2.dev` links are meant for light traffic and can be rate-limited by Cloudflare; if the show grows, put a custom domain on the bucket and set `R2_PUBLIC_URL` to it
  (the feed address changes, so tell Spotify/Apple through their "change feed" option, or do this before submitting).
- New episodes only appear once `AUDIO_ENABLED=true` (about ₹18 a day). Tests: `node --test test/*.test.mjs` in `tools/audio` (25 checks, including the publish script run end to end
  against a fake `aws` and a local host).
- Submit once: creators.spotify.com -> add an existing podcast -> paste the feed address -> enter the code Spotify emails to the owner address in the feed
  (`milindroy101292@gmail.com`) -> choose category, language and country. Apple Podcasts Connect takes the same feed.

## Audio screen: all episodes, and Sarvam credit alerts

- **All episodes:** the Audio screen (`listen.js`, hub) lists every recording since the first one (24 Sep), newest first. The list is `episodes.json` in the audio bucket,
  written by `podcast.mjs --episodes-out` and uploaded by `publish-feed.sh` (so `audio.yml` refreshes it after each recording, and the "Podcast feed" workflow can rebuild it by hand).
  Each row opens `/archive/<date>.html?audio=1`: that edition's page with the Audio screen open (chapters, highlighting); the row of the page you are on is marked "This page".
  No list published, or a broken one: the section stays hidden.
- **Late recordings:** a page opened before its recording existed looks again quietly (every minute while visible, on returning to the tab, when back online), never at the moment of tapping play.
- **Credit alerts:** Sarvam has no way to read the balance from code, so `tools/audio/credit.mjs` keeps an ESTIMATE in R2 (`_ledger/sarvam.json`): you enter the balance once
  (Actions -> "Sarvam credit" -> Run workflow -> balance), each recording subtracts its cost (₹3 per 1,000 characters), and when the estimate is under ₹100 or under 5 days
  (repository variables `SARVAM_LOW_RUPEES` and `SARVAM_MIN_DAYS` change that) a GitHub issue labelled `sarvam-credit` is opened that @mentions the owner, which GitHub emails.
  Separately, if Sarvam answers "no credits" (402) the run leaves `out/error.json`, exits 3 and opens a "ran out" alert straight away, no estimate needed.
  Entering a new balance above the alert level closes open alerts. "Sarvam credit" with `test_alert` opens and closes a test issue to check the email arrives.
  Tests: `node --test test/*.test.mjs` in `tools/audio` (43 checks).

## Your sections (show / hide / reorder)

`mobile.js` (reader mode only: phones and the apps) lets readers switch the sections (`section.lane`: AI, Business, Markets, Quiz) on or off
and move them up or down, from the menu (top right) > Sections. Nothing is asked at first launch. On the second day the app is opened it shows one small "Make it yours"
card above the first section (Choose / Not now; never on the website, never when opened from a shared link, never to anyone who
already has saved sections; shown through the day it first appears and not again on a later day if ignored). Visits are counted in `localStorage` key
`hb-tip-v1` (`{n: days opened, last, done, secOn, cardsOn, cardsDone}`). The choice lives in `localStorage` key `hb-prefs-v1` (`{order:[ids], off:[ids]}`); nothing is sent anywhere.
Sections are moved and hidden in place (`data-pref-off` marks hidden ones), so ids, links and scripts keep working; unknown ids are ignored, so new
sections just appear at the end. `listen.js` follows the choice: hidden sections are skipped and the recording jumps between the manifest's
timings to play the reader's order (the recorded outro is dropped when the quiz is hidden). A shared story link into a hidden section still shows it for that visit.
Tests: `node tools/browser-tests/prefs.mjs`.

## Swipe cards (the default way to read on phones and in the apps)

`cards.js` (fetched on demand by `mobile.js`, only in the apps and at phone width; never on the desktop website) builds a deck of cards from the
edition already on the page: a **cover card**, then for each section a section card (name, reading time, takeaway, numbered stories, a pinned "Swipe to start"
button) and one card per story (headline, the whole summary, takeaway, source), then the quiz card, in the reader's own section order with hidden sections left out.
It is a fixed layer over the scrolling feed (same idea as the Audio hub), a horizontal `scroll-snap` track, so swipe, momentum and snapping are the browser's.
Buttons (previous/next), the arrow keys, Home/End and Esc are the non-swipe alternatives. A tall story scrolls inside its card (a fade at the bottom says there
is more); vote, save and share are pinned below it. The feed stays the source of truth: card buttons press the feed's own buttons and mirror their state.
Text is copied with `textContent`, never as HTML.

- **The cover card** is the top of the page, so nothing the list opens with is lost: the edition line, "The Hour Brief" and its tagline, the day's quote with its
  author and source link, a **Listen to today's brief** tile (minutes, voice, a play/pause button), a **Today's quiz** tile (the quiz chip's title and status, tap to go to the first
  question), then the about paragraph and the free-to-read line. "Start reading →" is pinned below. The two tiles follow Listen and the quiz chip, which are built a moment after the page, and are hidden when there is no audio / the quiz is off.
- **Default:** **Cards** is the view unless the reader chose List (`localStorage` key `hb-view-v1`: `cards` | `list`; unset means cards). Tapping List in the deck
  or the List side of the `List | Cards` switch (under the section chips) stores `list`; the Cards side or the menu item stores `cards`. The choice is
  per device. To make the list the default again, change `getView()` in `mobile.js`.
- **Links that point into the list open the list**, not the deck (`deckTarget()` in `mobile.js`): `#quiz` and other section anchors, a league invite `?join=`,
  a friend's score `?beat=`. A shared story link (`#ai-2`, a saved story) opens the deck on that story's card. `?classic=1` (website only) is untouched.
- **No flash of the list:** while `cards.js` loads at startup the page is hidden (`pendingOn/pendingOff`, 4 s safety); if it cannot load, the list shows and nothing is thrown at the reader.
- **The app bar is under the deck**, so the deck's header carries **Saved stories** and the **Menu** (Sections, Text size, reminder, share, e-mail sign-up, and the Contact · About · Privacy links) plus **List**. "Get it by email" from the deck jumps to the sign-up box in the list.
- **Tabs:** Today returns to the cards (to the cover); Challenge and the quiz card's / tile's "Play the quiz" leave the deck **instantly**, onto the first question / the quiz section, with the feed never scrolling past, and do not change the saved choice. The instant jumps use `window.scrollTo({top, behavior: 'instant'})`, not `scrollIntoView({behavior: 'instant'})`, which Chrome 113 (the Android WebView) ignores: it eases instead and can stop short.
- **Audio is a round floating button** (`.dk-fab`, right side, above the card's pinned buttons; text can scroll clear of it). Tap it and it opens into a small player (what is playing, previous / play-pause / next, speed, stop, "Show what's playing"); the arrow collapses it. While playing the button pulses with sound bars. It only forwards clicks to Listen's own player and start button (`.hb-pl-*`, `.listen-go`), which stay in the page, so Listen, the Audio screen and the button cannot disagree. The page's mini player is hidden while the deck shows; the button steps aside while the full Audio screen is open, and is absent when the device has no audio.
- **The deck follows Listen** (like the list's auto-scroll): `listen.js` fires `hb:listen` on every state change and exposes `HBListen.current()`; `onListen()` in `cards.js` turns the deck to the card that holds the part being read: the cover for the introduction, a section card for a section, a story card for a story, the quiz card for the closing lines. The card being read has a purple edge. It never fights the reader: no following for 4 seconds after they touch the deck, and none while paused. Opening the deck while something plays starts on that card.
- **Hint:** the one-time "Make it yours" (sections) hint, on the second day the app is opened, sits under the deck's top bar when Cards is showing (above the first section when the list is). State in `hb-tip-v1`.
- **Web only:** no store release is needed; a Vercel deploy reaches every installed app on its next open.
- **Test on a real Android WebView, not just headless Chrome** (see Emulator notes in the mobile docs).
Tests: `node tools/browser-tests/cards.mjs` (128 checks, includes real touch swipes via `cdp.mjs` `swipe()`, and real Listen with a fake voice for the follow tests). The other suites (`premium`, `prefs`, `listen`) test the list, so they open with the List view stored.

## Reload, and the next edition, without friction (`capacitor-bridge.js`, native apps only)

Every page sets `history.scrollRestoration = 'manual'` in an inline `<head>` script (the very first thing in `<head>`, before
anything else, since it has to run before the browser's own scroll-restoration kicks in). Without it, a browser restores
whatever the reader had last scrolled to on that page; with it, a reload (pull-to-refresh, or the auto-open below) lands at
the top, as it should for a page whose content changes every day. This is on every page (`index.html`, `about.html`,
`contact.html`, `privacy.html`, `archive/index.html`), not just the app.

The "new edition" watcher (checks `/editions.json` on resume and every 10 minutes) opens the new edition automatically once
it is safe to do so, instead of making the reader tap a banner: at rest near the top of the page, the swipe-card deck (if
open) still on its cover, no audio playing or paused, and the quiz (if any questions are answered) not left half-finished.
The common case (the reader just opened the app, nothing going on yet) switches straight away, with no banner at all. If it
isn't safe, a small banner ("New edition ready — opens automatically") appears; tapping it switches right away regardless,
and the × dismisses it for that edition (remembered per date, same as before). Otherwise it keeps checking quietly (every
`HB_RETRY_MS`, default 20s) and switches the moment the reader is free. None of this runs outside the native apps.
Tests: `node tools/browser-tests/bridge.mjs` (24 checks).

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
