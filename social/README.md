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
  "linkedin": "short, punchy personal LinkedIn post on the insight (40-80 words): hook, 2-3 lines, CTA link, hashtags",
  "status": "WhatsApp status caption, <=200 chars including the edition link",
  "push": { "title": "<=45 chars", "body": "<=110 chars" },
  "page": "LinkedIn Page morning post (brand voice, 70-130 words, no link; one is added)",
  "x": "X post on the insight, <=260 characters counting the edition link as 23 (posted by hand: Telegram/kit link opens X filled in)",
  "leaders": { "id": "tech-ai-2026-11-17", "category": "tech-ai", "title": "the article's title",
               "post": "weekdays only: short, punchy LinkedIn post on ONE Thought Leaders article (40-80 words),
                        hook + 2-3 lines + CTA to https://the-hour-brief.vercel.app/leaders.html#a=<id> + hashtags" },
  "weekly": { "Sundays only: What actually mattered this week",
    "title": "What actually mattered this week", "from": "<that week's Monday>", "intro": "one sentence, <=160 chars",
    "items": [ { "date": "YYYY-MM-DD", "storyId": "ai-2", "lane": "ai|biz|mkt", "headline": "as published", "why": "<=200 chars" } ],
    "linkedin": "80-150 words, the five as numbered lines, link https://the-hour-brief.vercel.app/week.html?d=<date> (auto-posted to the owner's profile)",
    "x": "<=260 characters counting the link as 23",
    "reddit": { "title": "<=120 chars", "body": "150-300 words, Reddit markdown, one disclosed link", "subs": ["IndianStockMarket", "indianstartups"] } },
  "generatedAt": "ISO timestamp"
}
```

On Sundays the day's LinkedIn post (and the owner's automatic profile post) is `weekly.linkedin`; the recap's
page is `/week.html?d=<date>` (rendered from this file). X and Reddit are posted by hand: Telegram and
share-kit.html carry links that open X / the subreddit's submit page with the text filled in.

On weekdays the day's LinkedIn post is `leaders.post` (Monday to Friday walk the week's Thought
Leaders articles in pillar order, one per day, never repeating); otherwise it's `linkedin`. The
app link (the smart link /app, which sends phones to their store and shows desktops a QR code,
tagged ?src=<channel>) is added on delivery, never written into the file.

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
