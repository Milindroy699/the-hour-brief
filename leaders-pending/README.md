Hand-off directory between `api/leaders.js` (Vercel Cron) and the "Thought Leaders
writer" Claude Code routine.

`api/leaders.js` fetches raw source material (RSS entries, full YouTube
transcripts via youtube-transcript.io, full blog article text) and commits one
file here per run: `leaders-pending/<timestamp>.json`, shaped
`{ generatedAt, categories: { "<category>": [{ creator, title, url,
publishedAt, content, styleAuthor }, ...] } }`.

The routine, on its own schedule, reads every file here from its git checkout,
writes one roundup article per category (in the relevant `styles/<slug>.md`
voice when `styleAuthor` is set), appends each to the `briefs` array in
`leaders-data.json` at the repo root — matching its existing shape: `{ id,
category, styleAuthor, title, body, generatedAt, sources: [{creator, title}] }`
— then deletes the pending file(s) it consumed and commits/pushes, same as a
daily edition publishes. `leaders.html` reads `leaders-data.json` directly; no
API call, no Anthropic key anywhere in this flow.

Briefs with `"kind": "essay"` were added by hand (one source plus our own
analysis, outside this pipeline). Leave them in place when appending
roundups. In any `body`, paragraphs are separated by a blank line, and a
paragraph starting with `## ` renders as a subheading.
