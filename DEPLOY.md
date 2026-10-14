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
The "Swipe to start"/"See today's stories" buttons carry no arrow glyph of their own — the edge arrows (below) are the one consistent "this moves between cards"
signal, so the wording only ever has to say where a tap goes, not repeat the direction.
It is a fixed layer over the scrolling feed (same idea as the Audio hub), a horizontal `scroll-snap` track, so swipe, momentum and snapping are the browser's.
Buttons (previous/next), the arrow keys, Home/End and Esc are the non-swipe alternatives. A tall story scrolls inside its card (a fade at the bottom says there
is more); vote, save and share are pinned below it. The feed stays the source of truth: card buttons press the feed's own buttons and mirror their state.
Text is copied with `textContent`, never as HTML.

- **The cover card** is the top of the page, so nothing the list opens with is lost: the edition line, "The Hour Brief" and its tagline, the day's quote with its
  author and source link, a **Listen to today's brief** tile (minutes, voice, a play/pause button), a **Today's quiz** tile (the quiz chip's title and status, tap to go to the first
  question), then the about paragraph and the free-to-read line. "See today's stories" is pinned below — worded to name the destination (the reader is leaving
  the cover for the first section, a card-level jump) rather than "Start reading", which read as "there's more of this same card" and led a reader to expect
  scrolling further within the quote, not a swipe to a new card. The two tiles follow Listen and the quiz chip, which are built a moment after the page, and are hidden when there is no audio / the quiz is off.
- **Default:** **Cards** is the view unless the reader chose List (`localStorage` key `hb-view-v1`: `cards` | `list`; unset means cards). One `List | Cards`
  switch (`viewSwitch()` in `mobile.js`) does the switching — fixed, centred, just above the tab bar, the same control in the same place whichever view is
  showing (2026-09-29: moved off the old in-flow pill under the section chips, which replaced the deck's own separate "List" header button — one place to
  switch, not two depending on where you already are; fallback user feedback: the two different spots made it hard to find). It sits above the deck
  (z-index 9982, between the deck's 9981 and the Audio hub's 9983) so it stays usable over the cards but disappears under the hub or any sheet without
  needing its own per-overlay checks. `html.hb-switch-on` (toggled whenever it is actually showing) reserves its own `--hb-switch-h` band above the tab
  bar — in `.page`'s bottom padding, the mini player, the scroll-top button and toast, and the deck's own `bottom` offset — so none of those collide with
  it. Tapping List closes the deck if it is open (`HBCards.close()`); tapping Cards opens it (`openCards()`); the pressed state follows `hb:deck`, the
  same event cards.js already fires on every open and close, so it never drifts out of sync. The menu item ("Swipe cards") still opens Cards too.
  The choice is per device. To make the list the default again, change `getView()` in `mobile.js`.
- **Links that point into the list open the list**, not the deck (`deckTarget()` in `mobile.js`): `#quiz` and other section anchors, a league invite `?join=`,
  a friend's score `?beat=`. A shared story link (`#ai-2`, a saved story) opens the deck on that story's card. `?classic=1` (website only) is untouched.
- **No flash of the list:** while `cards.js` loads at startup the page is hidden (`pendingOn/pendingOff`, 4 s safety); if it cannot load, the list shows and nothing is thrown at the reader.
- **No header bar in the deck** (removed 2026-10-14, see "Reading for maximum screen space" below) — the app bar's Saved and Menu (Sections, Text size, reminder, share, e-mail sign-up, Contact · About · Privacy) are reached by switching to List, not duplicated above the cards. "Get it by email" from List jumps to the sign-up box there.
- **Tabs:** Today returns to the cards (to the cover); Challenge and the quiz card's / tile's "Play the quiz" leave the deck **instantly**, onto the first question / the quiz section, with the feed never scrolling past, and do not change the saved choice. The instant jumps use `window.scrollTo({top, behavior: 'instant'})`, not `scrollIntoView({behavior: 'instant'})`, which Chrome 113 (the Android WebView) ignores: it eases instead and can stop short.
- **Audio is a round floating button** (`.dk-fab`, right side, above the card's pinned buttons; text can scroll clear of it). Tap it and it opens into a small player (what is playing, previous / play-pause / next, speed, stop, "Show what's playing"); the arrow collapses it. While playing the button pulses with sound bars. It only forwards clicks to Listen's own player and start button (`.hb-pl-*`, `.listen-go`), which stay in the page, so Listen, the Audio screen and the button cannot disagree. The page's mini player is hidden while the deck shows; the button steps aside while the full Audio screen is open, and is absent when the device has no audio.
- **The deck follows Listen** (like the list's auto-scroll): `listen.js` fires `hb:listen` on every state change and exposes `HBListen.current()`; `onListen()` in `cards.js` turns the deck to the card that holds the part being read: the cover for the introduction, a section card for a section, a story card for a story, the quiz card for the closing lines. The card being read has a purple edge. It never fights the reader: no following for 4 seconds after they touch the deck, and none while paused. Opening the deck while something plays starts on that card.
- **Teaching the gesture, not a fixed nav bar:** swipe is the point, so prev/next are two small arrows (`.dk-edgenav`, 34px) overlaid on the card's own edges, not a separate button row — the footer (`.dk-foot`) is just the slim progress bar now, full width. The arrows start at a quiet `opacity: .55` (already secondary, not shouting); the moment the reader demonstrably swipes they fade further to `.2` (`.dk-edgenav.dk-quiet`, full on hover/focus). A button or arrow-key press (`onManualNav()`) always brings them back to `.55`, since that reader is relying on them; if nothing moves for a while (`HB_CARD_IDLE_MS`, default 6s) they return on their own too, in case whoever is reading is stuck. "Swiped" is detected two independent ways, so one path's quirks on a given browser cannot silently disable the other: (1) `idx` changing from the track's own scroll rather than from `goTo()`, inside `onScroll`; (2) comparing which card was showing when a touch began on the track against which one is showing ~500ms after it ends, regardless of how `onScroll` behaved. `.dk-edgenav`'s box matches `.dk-card > .dk-face`'s own model exactly (16px card padding, then a 640px column centred inside that) so the arrows land precisely on the face's edges at any width, including the centred column on tablets/desktop. Separately, a one-time "Swipe to continue" toast (`.dk-swipehint`, `hb-swipe-hint-v1` in `localStorage`, this device only) appears once ever, centred on screen, the first time the reader reaches a **story** card without having swiped yet — not the cover or a section card, which already carry their own "swipe to start" prompt. It is `pointer-events: none` (sitting dead-centre, right where a swipe naturally starts, it must never be able to catch that touch itself) and clears on its own after 4s or the moment a real swipe happens.
- **Hint:** the one-time "Make it yours" (sections) hint, on the second day the app is opened, sits above the first section when the list is showing (unchanged, part of the normal document flow, costs no space it isn't given). When Cards is showing, it instead **floats** over the top of the current card (`.hb-tip-float`, `position: absolute`, anchored just under the deck's top bar) rather than sitting in the flex flow and squeezing the card down — reading space stays full height at all times. It fades itself out on its own after `HB_TIP_FADE_MS` (default 6s), or the moment the reader's first real touch lands on the track, whichever comes first — neither counts as a "no", so it gets another chance on the next visit; only an explicit "Not now" (or choosing sections) marks it done for good. State in `hb-tip-v1`.
- **Web only:** no store release is needed; a Vercel deploy reaches every installed app on its next open.
- **Test on a real Android WebView, not just headless Chrome** (see Emulator notes in the mobile docs).
Tests: `node tools/browser-tests/cards.mjs` (163 checks, includes real touch swipes via `cdp.mjs` `swipe()`, and real Listen with a fake voice for the follow tests). The other suites (`premium`, `prefs`, `listen`, `bridge`) test the list, so they open with the List view stored — and now also exercise the switch, since `html.hb-switch-on` is active there too.
A known flake, present before this session and not caused by it: 3 of the checks around tapping/swiping straight to a section's first story (near
the top of the suite) occasionally land one card further in than expected — reproduces on unmodified code too, so it looks like a timing quirk of
the synthesized CDP touch gesture rather than the app; worth a closer look, but not from this pass.
Two more known flakes, found the same way (confirmed on unmodified code via `git stash`), in the other suites: `premium.mjs`'s "even if the browser
stops the scroll partway, 'Next question' still ends up above the tab bar" (off by ~5px past the tab bar on some runs), and `listen.mjs`'s "click
starts the recording... and it advances" (the recording's `currentTime` sometimes has not reached the 0.8s the check wants yet). Neither is caused
by the switch redesign below; both reproduce identically on pristine code.

### Reading for maximum screen space (2026-10-14)

Three changes, all aimed the same way: give the card itself as much of the screen as possible.

- **No header bar in the deck any more.** It only ever showed a section name/position and Saved/Menu buttons — all three
  were already duplicated (every card kind has its own `.dk-kick`: the cover's edition line, each section intro's
  "Section N of M", a quiz's "Challenge", the closing card's "That's the brief" — story cards gained one too,
  `SectionName · Story N of M`, right above the headline) or reachable in one tap via the switch (Saved/Menu live in
  List only now). Removing it frees the whole top of the card for content, not just a sliver. The safe-area-inset-top
  clearance it used to provide moved to `.dk-track`'s own top padding. The "Make it yours" floating hint (which used
  to measure the header's height to position itself) now just uses a fixed `top` offset — there is nothing left to
  measure.
- **The cover's quote (`.dk-quote-text`) is clamped to 4 lines** (`-webkit-line-clamp`). Some days' quotes are one
  line, others a full paragraph (today's, edition 58, is the long kind) — unclamped, a long one pushes the Listen
  tile, the quiz tile and "See today's stories" well down the card. The full text stays in the DOM (`textContent` is
  unaffected, only the visual rendering clamps), just not all shown.
- **One floating bar instead of two.** The List | Cards switch now sits flush against the tab bar (zero gap, rounded
  only on top, same background/blur) rather than floating above it with a gap — one continuous surface, not two
  stacked pills. While Cards is the active, top-most view (`html.hb-deck-open`, scoped `:not(.hb-hub-open)` since
  opening the Audio hub from inside the deck does not close the deck underneath it, and the hub should keep its
  normal full-size bar), the whole combined bar shrinks into a floating rounded capsule pulled in 16px from the
  screen edges — tab labels fade out (icons only), padding and icon size tighten, and `--hb-tab-h` itself drops from
  66px to 50px so the deck's own bottom edge moves down to match: the card gets that space back, not just a gap
  above a shorter bar. Everything animates (`transition`, ~0.22s) rather than snapping. Inspired by a reference the
  user shared from another app ("Mind Echo"), whose bottom bar does the same icon-only collapse.
  Verified against the project's own local files via the Android emulator's real Chrome pointed at a local static
  server (not the live site, so nothing untested reached production) before this shipped — see "Emulator Chrome for
  page-level debugging" below for the attach pattern; this redesign used it directly (`ws://127.0.0.1:9222/devtools/page/<id>`
  rather than `android-chrome.mjs`'s `attach()`, since multiple stale tabs from earlier sessions made its
  first-page-found default pick the wrong target — look up the right target id from `http://127.0.0.1:9222/json` first).

**Real-device bug found and fixed the same day:** on a real phone, the switch sat with a visible gap above the tab
bar — list content showed through the gap, since neither the deck's background nor the switch's own background
covered that strip. Cause: `.hb-deck`'s reserved bottom space was gated on `html.hb-switch-on` (set by `viewSwitch()`
in `mobile.js`) while the bar-stack shrink was gated on a *different* class, `html.hb-deck-open` (set by `cards.js`'s
own `open()`/`close()`) — two independently-toggled classes supposedly agreeing on one number. Fixed by gating the
deck's reserved space on `html.hb-deck-open:not(.hb-hub-open)` directly, the same class the shrink itself uses, so
there is only ever one class in the loop, not two that can disagree. Also hardened against the next version of the
same problem: `--hb-switch-h` was a hand-estimated constant (the switch's padding + button height on this Mac's
rendering), which a real device's own font/DPI rendering is never guaranteed to match exactly — `viewSwitch()` now
measures `.vs-in`'s actual rendered height after every time it becomes visible and corrects `--hb-switch-h` to that
real number (`document.documentElement.style.setProperty(...)`), so the reserved space can no longer fall short of
reality, on this device or any other.

**Same day, one more redesign, from a second reference image the user shared:** the shrink-to-icons approach above was
superseded by a true collapse/expand toggle, matching a reference from another app ("Mind Echo" again) showing a
single compact row — an expand chevron, the edition label, the List | Cards switch — with the full tab bar tucked
away until that chevron is tapped. `viewSwitch()` in `mobile.js` now builds `.vs-expand` (the chevron) and `.vs-ed`
(the edition label) into the same `.vs-in` row as the List/Cards buttons; a click toggles `html.hb-bar-expanded`.
In app.css, `html.hb-deck-open:not(.hb-hub-open)` now collapses `.tab-bar` to `max-height:0` (padding zeroed too —
`max-height` alone left ~13px of residual padding) and sets `--hb-tab-h: env(safe-area-inset-bottom, 0px)`, so the
deck reclaims essentially the whole tab-bar's height by default; `.hb-bar-expanded` on top of that restores both to
their normal, full-size, labelled state. **A real bug this surfaced:** `syncViewSwitch()` queried `.vs-in button`
expecting exactly two buttons (List, Cards) to set `aria-pressed` on — adding `.vs-expand` as a third button in the
same row silently shifted the indices, so the wrong elements got the pressed state. Fixed with a selector that
excludes it explicitly (`.vs-in > button:not(.vs-expand)`); the same selector needed to replace `.vs-in button`
throughout `cards.mjs` too (14 places), all still assuming exactly List/Cards at index 0/1.
The section-intro card also dropped its numbered list of every story's headline (`.dk-list`/`.dk-go`, plus the now-
dead delegated `[data-goto]` click handler on the track) — just the section's own takeaway now; the stories are the
next cards, one at a time, so repeating all their titles first was the same "too much detail" complaint the cover
had already gotten. `cards.mjs` is 163 checks.

**Same day, later again — three more:** (1) switching List → Cards → List → Cards used to always restart at the cover,
losing the reader's place. `open()` in `cards.js` now falls back to `listStoryId()` — the story nearest the top of
the list's current scroll position — when there's no explicit target and Listen isn't actively playing something
specific; `close()` already did the matching half (scrolling the list to the card being read), so now both
directions agree. (2) The progress bar (`.dk-bar`) is now a scrubber: tap or drag anywhere along it to jump straight
there — real `pointerdown`/`pointermove` with `setPointerCapture`, `aria-hidden` on the bar itself since the track
already has full keyboard support and this is a pointer-only shortcut, not a second way to do the same thing with
different semantics. Taller (9px) and `touch-action: none` so the first tap lands reliably; after that, capture
tracks the drag anywhere on screen regardless of the (still visually thin) bar. (3) The cover dropped the wordmark,
tagline and "what The Hour Brief is" paragraph — a returning reader doesn't need the publication introduced to them
every morning. It's just the edition line and "before the news" now. `cards.mjs` is 163 checks.

**Same day, later still:** the List | Cards switch now also hides while on the Audio or Challenge tab, not just Today —
`syncTabs()` in `mobile.js` already computes which tab is current (`cur`) from scroll position, so it just toggles a
new `html.hb-on-quiz` class alongside that, read by the same CSS rule that already hides the switch for the Audio hub.
The quiz streak display (`.qz-st-top`, `.qz-week`, `.qz-drill`) is noticeably more compact — about a quarter less
height across the pill row, the day-of-week strip and the drill tile — so it takes less of the screen from the
actual questions, while staying legible. A fuller "dedicated Challenge page" (its own full-screen overlay, like the
Audio hub, so the quiz gets even more room) is scoped but not built yet — flagged to the user as a larger, separate
piece of work rather than rushed in after an already-long, tooling-unstable session.

**Also that day:** the "N / total" readout in the footer (`.dk-count`) is hidden — felt like clutter once the progress
bar alone already says enough; it stays in the DOM (cards.js keeps it current) since several tests read the current
position from it. The switch pill gained a border and a stronger shadow (`.vs-in`) for better contrast against the
page behind it, which had been blending into a near-white background. And the cover/closing split moved further:
the Listen and quiz tiles are off the cover entirely now (it is just the quote, the intro paragraph and "See today's
stories") and live on the closing card instead, which is now *always* the deck's last card regardless of where the
reader has the quiz section — previously it was only added when the quiz wasn't already last. `cards.mjs` is 162
checks.

**2026-10-14, a larger round from real-device feedback (ten items at once):** the switch/chevron redesign above
turned out not to be it once the reader actually used it, plus several other asks arrived in the same message.

- **The switch is a plain pill again, in both views.** The expand chevron and the edition label are no longer folded
  into `.vs-in` — the reader explicitly preferred the earlier, minimal two-button pill (a reference screenshot of
  this exact control in List) over the stretched, stacked version Cards had grown. `.vs-in` is now untouched between
  List and Cards: same markup, same compact centred pill. The edition label (`.vs-ed`) is gone outright — it was
  never asked for. The expand button (`.vs-expand`) still exists (it has to: without it there would be no way back
  to Audio/Challenge/Archive from inside Cards) but is now a separate round button beside the pill, not inside it —
  `viewSwitch()` in `mobile.js` appends it as a sibling of `.vs-in`, both children of `.view-switch`. One
  consequence: `.vs-in` alone is no longer exactly centred on screen while Cards is open (the chevron takes its own
  space beside it) — the *pair* is what `.view-switch`'s `justify-content: center` centres now, not the pill alone.
- **The background-bleed bug (list text visible below the collapsed menu) is fixed.** With the tab bar tucked away
  (`max-height: 0`), nothing was left providing an opaque floor in that strip except the pill itself, which doesn't
  span the full width — the gaps on either side (and below, now that `--hb-tab-h` collapses close to zero) showed
  the frozen list behind the fixed deck. Fixed by making `.view-switch` itself become the floor whenever
  `html.hb-deck-open:not(.hb-hub-open)`: full-width, `bottom: 0`, its own opaque/blurred background and top border,
  padded for the safe area — the expand button and pill float on top of it, same as the tab bar used to sit under
  the pill. `measureSwitchH()` now measures `.view-switch`'s own rendered height (the whole floor), not just
  `.vs-in`'s, and re-measures after the expand/collapse transition too (its own height is different in each state),
  not only on first reveal — getting this wrong a second time, after already shipping the `--hb-switch-h` fix above
  for exactly this class of bug, would have been a much worse miss.
- **The cover (`buildCover` in `cards.js`) has its title and tagline back.** They were removed earlier this session,
  then the reader asked for them back specifically — "no explainer" was about a longer about-paragraph, never about
  dropping the title. Cloned verbatim from the page's own `.wordmark`/`.tagline` (new `.dk-wordmark`/`.dk-tagline`
  classes), same as the rest of the cover is built from the live page rather than hardcoded text. "Before the news"
  no longer clamps at 4 lines — the lavender box now `flex: 1`s to fill whatever height is left below the title, so
  a short quote still reads as a deliberate, uncluttered card instead of leaving a lot of plain white space, and a
  long one simply makes the card taller (scrolls like any other card) instead of being cut off.
- **Section-intro cards show the takeaway as plain text, not boxed.** Re-adding the old numbered story list was one
  option raised but rejected: the whole point of this view is one story per screen, and the next several cards
  *are* that section's stories — repeating all their headlines up front on the section card would undercut that.
  Instead the takeaway dropped its boxed "Takeaway" callout treatment (border, background, label chip) — a story
  card's own styling, which read oddly stamped onto a section — and is now just a flowing paragraph (`.dk-body-lg`),
  reading as the section's own summary.
- **The scrubber bar got a visible thumb and a bigger hit area.** The reported issue was specifically about dragging
  precisely on Android. `.dk-bar` stayed visually thin (9px) but gained an invisible `::before` extending the real
  touch target ±15px above and below it, plus a `.dk-bar-thumb` (16px circle) that tracks the fill percentage —
  together a much easier target to grab and follow than a bare thin line. A light haptic tick (`Capacitor.Plugins
  .Haptics.impact`, falling back to `navigator.vibrate` on the mobile web, silently no-op otherwise) fires once per
  card index crossed while scrubbing, not once per pixel moved.
- **The list view's section order is swapped: takeaway, then the highlights, then the stories.** `laneDigests()` in
  `mobile.js` builds the "Today's highlights" numbered list client-side and inserts it next to the existing
  `.lane-takeaway` paragraph — it was inserting right after the `<h2>`, ahead of the takeaway; now it inserts after
  the takeaway instead, so the takeaway reads first as the section's summary and the highlights follow as pointers
  into it. Confirmed via `git log -S` that this ordering predates this session (from the original highlights
  feature, long before the swipe-card work) — not something broken by the cards.js changes, just a preference the
  reader only raised now.
- **Save/Share on a story card are icon-only.** The `.dk-lb` text-label spans next to the icon are gone from
  `actionButtons()` in `cards.js`; `aria-label` (mirrored from the real button) is unchanged, so this is visual
  only. `.dk-act` is a fixed 46px circle now rather than a stretched, equal-width pill with room for a label; the
  vote buttons (emoji + count, never had a label either) keep an auto-width pill via a `:has(.dk-n)` exception.
- **The dedicated "Play the quiz" card is gone.** `collect()` in `cards.js` no longer turns `section.lane#quiz` into
  a card at all (`buildQuiz()` deleted outright) — it was sitting directly next to the closing card's own quiz tile
  (`.dk-quizt`), making the same offer twice in a row, which is what was actually making that stretch of the deck
  feel broken/redundant rather than finished. The quiz tile already does exactly what the old card's CTA did
  (`close({keep:true, to: '#quiz .quiz-card'})`), so nothing about *reaching* the quiz changed, only the extra stop
  on the way. One knock-on: reordering `quiz` in the reader's section prefs used to move this card around the deck;
  since it's never a card now, that preference simply has no deck-visible effect any more (still respected
  everywhere else the quiz shows, e.g. the Challenge tab, the quiz chip in the list).
- **The closing card itself is no longer a wall of empty space under two tiles.** `.dk-end .dk-scroll` is now a
  centred flex column (`justify-content: center`) instead of top-aligned content with whatever's left below it —
  there's rarely enough content on this card to fill a full screen, so centring it reads as designed rather than
  unfinished. Tapping "Listen to today's brief" there now also calls `setFab(true)` after starting playback, opening
  the floating player's own controls instead of starting the audio silently with no visible way to pause/skip/stop
  without hunting for the round button.
- **Android plays the device voice where iOS plays the recorded (Sarvam) voice — investigated, not fixed.** Checked
  everything visible from here: the R2 manifest and mp3 both serve correct CORS headers and content types, and
  `capacitor.config.json` is byte-identical between the iOS and Android builds (same `server.url`, so the same
  origin, same CORS allow-list match). Nothing server-side or in config explains a platform difference. Added two
  `console.warn` lines (`listen.js`: the manifest-fetch `.catch()`, and `recFail()`) so the next time it falls back
  on a real Android device, checking the console (`chrome://inspect` with the phone on USB) will show the actual
  reason instead of it failing silently — this needs a real device log to go further, not more static reading.

`cards.mjs` is 166 checks.

**2026-10-14, same day again — the switch/chevron redesign didn't survive real use either, plus a brand-new feature:**

- **The expand/collapse chevron is gone. The tab bar is never collapsed for Cards any more.** This is the third round
  of feedback on this one control in a single day. The tab bar is now the exact same full-width, always-visible bar
  in both List and Cards, with the switch pill floating above it — unchanged, same position, same look, in both
  views, permanently. `.vs-expand`, `html.hb-bar-expanded`, and every CSS rule that shrank `--hb-tab-h` or collapsed
  `.tab-bar`'s `max-height` for Cards are deleted outright, not just hidden. The code comments now say this plainly:
  "the plain, boring version on purpose, not a stepping stone to another redesign." The pill itself (`.vs-in`) got a
  proper glassmorphic treatment instead — heavier blur+saturation, a violet-tinted border, an inset top highlight —
  since the reader specifically asked for "a bit of border or color highlight" once the collapsing stopped being the
  answer.
- **The lane's long run-on `<h2>` is hidden unconditionally, no toggle.** It used to be tucked behind a "Read the
  day's digest →" button (`is-digest`/`digest-open` in `laneDigests()`, `mobile.js`) that turned out to not actually
  do anything in practice. Deleted that whole mechanism; reader.css now just hides any lane `<h2>` whenever a
  `.lane-tag` badge is present (`section.lane:not(.quiz) .lane-head:has(.lane-tag) h2 { display: none; }`) — the tag
  already names the section, so the long sentence was pure duplication. The quiz section is explicitly excluded
  (`:not(.quiz)`): its own `<h2>` is short and already deliberately styled, unlike the other lanes' SEO-length ones.
- **The closing card's overlaid edge-nav arrows are hidden on that card specifically.** A real bug report: the
  previous round centred the closing card's content vertically, which put it right where `.dk-nav`'s fixed
  `top: 32%` sits — the left arrow was visibly overlapping the word "quiz" mid-sentence. `paint()` in `cards.js` now
  sets `ui.edgenav.hidden = c.kind === 'end'` — simpler than repositioning them, and there is nothing to go "next"
  to on the last card anyway.
- **New: a dedicated quiz page.** Tapping Challenge in the bottom tab bar used to just scroll to `#quiz` within the
  normal page. Now `tabGo('quiz')` in `mobile.js` adds `html.hb-quiz-page` to `<html>`, and a single CSS rule
  (`html.hb-quiz-page .page > *:not(#quiz) { display: none; }`) hides every other direct child of `.page` — the lane
  sections, the "before the news" card, the chips, the subscribe box — so the quiz gets the whole screen. Deliberately
  NOT a new fixed-position overlay layer like the Audio hub: `quiz.js` already scrolls and measures against the real
  page (including a couple of `window.scrollBy` calls in its own `bringIntoView` helper that only make sense against
  the real window scroll), so keeping it the real page with siblings hidden means quiz.js needed no changes beyond
  one line — `jumpToStory()` now clears `html.hb-quiz-page` before scrolling to a story, since "From '…' →" would
  otherwise silently fail to show anything hidden under the dedicated page. A new `quizBack()` in `mobile.js` builds
  a "Back to The Hour Brief" button, prepended inside `#quiz`, visible only in this mode. Scoped to just the
  bottom-tab Challenge button, per the literal ask ("the quiz button in the menu") — the inline quiz chip elsewhere
  in the list stays a plain scroll, unchanged.
- **Brand background art, generated in Stitch from prompts written to match the app's real tokens** (navy `#0c0d15`,
  violet `#5e43f3`/`#7c5cf0`, the hourglass mark), reviewed and picked per surface rather than applied uniformly —
  files in `brand/backgrounds/`:
  - `list-light.svg` / `list-dark.svg`: the List view's own background (`body`, overriding the page's inline
    `background: var(--bg)` by load order, same as the rest of app.css). Pure SVG gradient + grain, not a photo —
    `body` can be many screens tall for a full edition, and because it's a vector, `background-size: cover`
    stretching it that far stays perfectly smooth (no blur, no banding, the way a raster image would suffer).
    Deliberately almost flat: this sits behind dense body text all day, so it has to all but disappear once reading
    starts.
  - `cards-light.jpg` / `cards-dark.jpg`: a soft curtain-light motif in the margins around the floating card in
    Cards (`.hb-deck`). The card itself (`.dk-face`) is fully opaque, so this only ever shows at the edges, never
    under any text.
  - `audio-dark.jpg`: a moody "now playing" glow for the Audio hub (`.hb-hub`), dark mode only — it's a dark-toned
    image that fades to near-black right where the player controls sit, which only reads correctly against dark
    mode's already-light text/icons; light mode keeps the plain `var(--bg)` it always had.
  - `cover-accent.jpg` exists in the folder but is not wired in anywhere yet — a more dramatic, colourful piece that
    didn't fit as a universal background but could work as a one-off accent (the cover card specifically, a splash
    screen, a store listing hero) if the reader wants it used somewhere later.
  PNGs were exported from Stitch at 1–1.7MB each (too heavy to ship as-is for a daily-read app) and compressed to
  JPEG (quality ~70, `sips` — no `cwebp`/imagemagick on this machine) down to 90–140KB each before committing.
  Verified visually on a local static server across List/Cards (light+dark) and Audio (dark): no legibility issues,
  nothing fighting the text on top of it.

Two Stitch background designs that came out in the same batch were reviewed and set aside, not wired in: a bright,
colourful hourglass-blob piece and a second, similarly busy abstract — both too high-contrast for behind dense body
text and not clearly better than what shipped for Cards/Audio either; left in the source export folder
(`~/Downloads/stitch_hour_brief 2/`) in case they're wanted for something more decorative later (a splash screen, a
store listing) rather than as an in-app background.

**2026-10-14, later the same day: the dedicated quiz page rebuilt as a real overlay, plus four smaller fixes from
real-device feedback.**

- **The dedicated quiz page is now a true fixed overlay, not a filtered view of the list.** The version shipped
  earlier the same day hid every other `.page`-level section with CSS, keeping `#quiz` in its normal place in the
  document — cheap to build, but it never stopped feeling like "the list page, scrolled" (the reader's own words),
  since the footer and masthead were still technically right there if you scrolled or looked. Rebuilt to match the
  Audio hub's own pattern exactly: a new `.hb-hub.hb-quizpage` element (literally reusing `.hb-hub`'s class, so all
  of its fixed positioning, background and dark-mode styling come for free), with the same `.hub-top`/`.hub-scroll`
  markup as the Audio hub — same header, same close button, the same "this is its own screen" framing the reader
  already knows. `#quiz` is a real DOM reparent into it (`quizScroll.appendChild(document.getElementById('quiz'))`)
  and moves back to its original spot (marked by a comment node, `quizAnchor`) on close — quiz.js's own state, event
  listeners, everything just comes along for the move, untouched.
  **One real fix this required in quiz.js:** its `bringIntoView` helper's second-pass "nudge" (after
  `scrollIntoView`'s own imprecise positioning) used `window.scrollBy()` unconditionally, which only makes sense
  against the real page scroll — inside the new fixed, internally-scrolling overlay, the actual motion happens in
  that container, not the window. A new `scrollRoot()` helper finds the nearest scrollable ancestor and nudges that
  instead, falling back to `window.scrollBy` (unchanged) when there isn't one, so the normal in-page case is
  completely unaffected.
  The Audio hub and the quiz page are both full-screen overlays now, so opening one explicitly closes the other
  (`tabGo('audio')` calls `closeQuizPage()`, `tabGo('quiz')`/every non-audio tab already called `closeHub()`) —
  deliberately NOT stacking, unlike the deck+hub relationship elsewhere, since two overlays at once would just be
  confusing. Answering a question and following "From '…' →" now closes the quiz page first (`quiz.js`'s
  `jumpToStory`, via a small exposed `window.HBQuizPage.close()`), since the story it jumps to lives in the list
  behind the now-closed overlay.
- **A real layout bug fixed**: `.dk-cta` ("Back to the list" on the closing card) had no top margin of its own, so
  directly following a `.dk-tile` (which only has a top margin, no bottom one) it sat flush against it — looked like
  an overlap in a screenshot. Fixed with `.dk-tile + .dk-cta { margin-top: 16px; }`.
- **The Audio tab's icon changed** from a 5-bar equalizer/soundwave glyph to the same headphone icon used everywhere
  else in the app for audio (the Listen tile, the floating player button) — the mismatch is what a screenshot's
  "crossbar icon" complaint turned out to mean.
- **The sections-onboarding nudge ("Make it yours") no longer interrupts reading in Cards, at all.** It used to
  float over the top of the deck's current card (added earlier this project); told directly "I don't think that's
  needed... the card reading experience [should be] seamless... without losing any space or interruptions" — the
  whole floating-in-the-deck mechanism (`hb-tip-float`, the auto-fade timer, the swipe-to-dismiss listener) is
  deleted outright, not just hidden. `tipCard()` now simply returns `false` whenever `deckOpen()`, and — since Cards
  is the default view — a new `hb:deck` listener re-tries `maybeSuggest()` the moment the reader actually closes the
  deck into List, in the same visit, rather than only on some later day that happens to start in List. Critically,
  `tipCard()` only marks the day-tracking flag (`secOn`) on a render that actually happened, so it's never "used up"
  silently while hidden behind the deck — a reader who stays in Cards all day just never gets asked that day, and
  the chance carries over.
- **The app bar's Today subtitle is the tagline again** ("Sixty minutes. Three lanes. Everything that actually
  mattered today."), not the word "Feed" — removed in the original mobile redesign for space, brought back on
  request ("it was the essence of the platform"). `.ab-screen` on the Today screen now shows `.tagline`'s own text
  (read once and cached, `tagline()` in mobile.js) instead of a literal `'Feed'`; the Audio and Challenge screens
  still get their own functional label, where knowing where you are actually matters. It runs to 2–3 lines at phone
  width, so `.masthead-inner` switched from `align-items: center` to `flex-start` (centring the logo and the action
  buttons against a now-much-taller text block looked off) with a 1px nudge on the logo/actions to line up with the
  wordmark's own cap-height.

`cards.mjs` is 163 checks (net down from 166 — the deck-floating-hint tests it replaced were more numerous than
what replaced them); `premium.mjs` is 82. `prefs.mjs`/`listen.mjs` unaffected: 55/55 and 48/48.

**Same day, once more: a real-device-only report of list content ("ALL · AI & Tech · ...") showing through below the
deck, next to the switch — the same symptom as the original gap bug from earlier today, reopened.** A screenshot of
the actual gap this time, not a stale capture. Tried to reproduce it locally first (fresh load straight into Cards,
the cover card, measuring `.hb-deck`'s bottom against `.view-switch`'s top): a clean 0px gap, every time — could not
confirm the exact cause from this machine. Hardened `measureSwitchH()` anyway, since the real fragility was visible
by inspection regardless of reproducing it: it only ever ran once, via a single `requestAnimationFrame` right after
first building the switch, with no re-check if web fonts finished loading afterward or if the deck opened before
layout had fully settled on a real device — either could plausibly leave `--hb-switch-h` a few pixels short.
`viewSwitch()` now also re-measures on `hb:deck` (every open/close), `resize`, and `document.fonts.ready`; the
measurement itself now adds a 2px safety buffer on top of `Math.ceil()`, erring toward reserving slightly too much
space (invisible) rather than slightly too little (a real, visible bug) — reasonable given this exact failure mode
has now recurred more than once. Not a confirmed fix; asked the user to re-check on their device.

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
