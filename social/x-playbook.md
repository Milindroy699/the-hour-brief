# X growth plan: playbook

The owner (Milind) is growing his personal X account (no Premium) to bring readers to The Hour Brief. Started 2026-11-22.
The bet, from what drove other accounts' growth: lots of genuinely useful **replies** on bigger accounts' posts, plus a
steady stream of the day's news as posts. Every post and reply is posted **by the owner, by hand**: X's rules forbid
automated replies, and the owner asked to post manually.

## The day (IST)

| Time  | What arrives on Telegram (api/_kit.js)                        | What the owner does                         |
|-------|---------------------------------------------------------------|---------------------------------------------|
| 9:30  | the morning X post, with a "Post on X" button                 | tap, check, Post                            |
| 10:00 | the thread, one message per post                              | post 1 with the button, reply 2, 3… under it |
| 11:00 | reply round 1: facts + X search buttons                       | morning session (below)                     |
| 15:00 | afternoon post, with a button                                 | tap, check, Post                            |
| 18:00 | evening post + the quiz poll + reply round 2                  | evening session (below), make the poll      |
| 19:00 | scorecard + "Open the dashboard"                              | tick the checklist, log the numbers         |

Content comes from `social/<date>.json` → `xpack` (written by the "Daily post writer" routine). Dashboard:
`/growth.html#plan` (checklist, replies vs target, followers / impressions / profile visits, X visits and app taps).

## Reply targets (per day)

Week 1-2: 25 · week 3: 40 · week 4: 50 · after: 60. (`replyTarget` in api/_kit.js and growth.html; keep them in step.)

## The sessions (morning ~11:00, evening ~18:30, about 15-20 minutes each)

The owner may ask Claude to run a session in his Chrome (Claude in Chrome, logged in to X). Then:

1. Read today's `xpack.replies` (facts, searches) from `social/<date>.json`.
2. Open each search in X's **Latest** tab (`https://x.com/search?q=<query>&f=live`). Pick posts that are fresh (under
   ~3 hours), from accounts bigger than the owner's, about AI, Indian markets, startups or business, where a fact from
   today's brief genuinely adds something. Skip: rage-bait, politics, giveaways, anything where a reply would be a plug.
3. Draft one reply per post in the owner's voice (rules below). Show the owner the batch: the post (author + gist + link)
   and the draft under it.
4. **The owner posts them.** Never type into X's reply box or press Reply / Post / Like / Follow without the owner
   saying so for that specific reply. If he asks Claude to post one, do exactly that one, then stop.
5. At the end, say how many replies went out so he can log it on the dashboard (or log it for him if he asks).

## Voice and rules

- Plain English a 12-year-old could follow. Short sentences. First person where natural.
- A reply adds one thing: a number, a fact, a consequence, a sharp question. Never "Great post!", "This 👆", "So true".
- No links in replies, no "check out my app". The profile (bio, Website field /?src=x, pinned post /app?src=x-pinned)
  does the selling.
- Facts only from today's brief (or the post itself). If unsure, leave it out. Nothing that reads as investment advice.
- At most 1 emoji; no hashtags in replies.
- Disagree politely and with a fact. Never pile on.
- Under 280 characters (no Premium).

## Weekly review (Sunday evening, 10 minutes)

On the dashboard: replies per day vs target, followers trend, visits and app taps from X. Which searches / topics got
replies liked or answered? Do more of those next week. If X visits stay flat for two weeks while replies go up, change
the topics or the accounts replied to, not the volume.
