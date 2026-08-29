# Deployment

**Canonical URL:** https://the-hour-brief.vercel.app/

This repo auto-deploys to Vercel on every push to `main` (connected via the Vercel GitHub integration). GitHub Pages remains enabled as a secondary mirror at https://milindroy699.github.io/the-hour-brief/ but the Vercel URL is the one to share, link to, and use in `feed.xml` / Open Graph tags.

No build step — this is a plain static site (`index.html`, `archive/`, `feed.xml`, `editions.json`) served as-is.

## Shared front-end files

`index.html` and the `archive/*.html` editions each carry a full inline `<style>` and `<script>`, plus three shared files loaded by absolute path from `<head>`:

- `capacitor-bridge.js` — native-app glue (no-op in a browser)
- `mobile.css` — phone-only (`<link media="(max-width: 640px)">`) layout refinements
- `mobile.js` — phone-only reading enhancements (collapsible stories, About toggle)

Every edition page must keep these three lines. The daily template is `index.html`, so a new edition copied from it inherits them automatically.

Because the paths are absolute (`/mobile.css` …), the GitHub Pages mirror (served under `/the-hour-brief/`) does **not** pick up `mobile.css` / `mobile.js`. Vercel is canonical; the mirror is best-effort.
