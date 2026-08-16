# Deployment

**Canonical URL:** https://the-hour-brief.vercel.app/

This repo auto-deploys to Vercel on every push to `main` (connected via the Vercel GitHub integration). GitHub Pages remains enabled as a secondary mirror at https://milindroy699.github.io/the-hour-brief/ but the Vercel URL is the one to share, link to, and use in `feed.xml` / Open Graph tags.

No build step — this is a plain static site (`index.html`, `archive/`, `feed.xml`, `editions.json`) served as-is.
