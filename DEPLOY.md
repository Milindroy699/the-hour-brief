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
