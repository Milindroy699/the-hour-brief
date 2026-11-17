Daily post kit: one file per edition, `social/<YYYY-MM-DD>.json` (IST date), written each
morning (~09:00 IST) by the "Daily post writer" Claude Code routine from that day's
`archive/<date>.html`. Nothing here is fetched from the web.

```json
{
  "date": "2026-11-18",
  "edition": 92,
  "lane": "ai | biz | mkt",
  "storyId": "ai-2",
  "storyTitle": "the headline of the story the insight comes from",
  "insight": "the idea in one sentence, <=150 chars (goes on the status image)",
  "linkedin": "a personal-profile LinkedIn post, 120-220 words, ends with the edition link + hashtags",
  "status": "WhatsApp status caption, <=200 chars including the edition link",
  "push": { "title": "<=45 chars", "body": "<=110 chars" },
  "page": "LinkedIn Page morning post (brand voice, 70-130 words, no link; one is added)",
  "generatedAt": "ISO timestamp"
}
```

Used by:
- `share-kit.html` (private, noindex): the "Today's post" section with Share image (WhatsApp →
  My Status), Copy & open LinkedIn, and the caption.
- `/api/og?type=status&i=<insight>&d=<date>&n=<edition>&lane=<lane>`: the 1080x1920 status image.
- The "Daily post writer" routine itself: right after committing the file, it adds the day's row to
  the owner's Notion database "The Hour Brief · Daily posts" through the Claude Notion connector
  (no Notion token anywhere).
- `api/_kit.js`, from Vercel Cron via `api/post-digest.js`: the owner's Telegram message and phone
  push (~09:30-10:30 IST), and the second daily push to every app user (~18:00-19:00 IST, linking
  to the story).
- `api/_linkedin.js`: the `page` text is the LinkedIn Page's morning post (falls back to the
  edition's three lane headlines when missing).
