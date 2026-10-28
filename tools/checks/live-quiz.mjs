// Live production smoke test for the daily quiz: confirms today's live page actually embeds a
// well-formed quiz-data block with real questions, not a missing/empty/malformed one. No
// dependencies — plain fetch + regex, runs with a bare `node live-quiz.mjs`.
//   node live-quiz.mjs
// Env: SITE_URL (default https://the-hour-brief.vercel.app)
const SITE = process.env.SITE_URL || 'https://the-hour-brief.vercel.app';
const MIN_QUESTIONS = 3; // the brief normally ships 5; flag well below that rather than hardcoding exactly 5

function istToday() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

const res = await fetch(SITE + '/');
if (!res.ok) { console.error(`FAIL: could not load ${SITE}/ (${res.status})`); process.exit(1); }
const html = await res.text();

const m = /<script type="application\/json" id="quiz-data">([\s\S]*?)<\/script>/.exec(html);
if (!m) { console.error('FAIL: no quiz-data block found on the live page at all'); process.exit(1); }

let data;
try { data = JSON.parse(m[1]); } catch (e) { console.error('FAIL: quiz-data is not valid JSON —', e.message); process.exit(1); }

const today = istToday();
if (data.date !== today) {
  console.log(`SKIP: quiz-data is dated ${data.date}, not today (${today}) yet — nothing to check`);
  process.exit(0);
}

const qs = Array.isArray(data.questions) ? data.questions : [];
if (qs.length < MIN_QUESTIONS) { console.error(`FAIL: only ${qs.length} question(s), expected at least ${MIN_QUESTIONS}`); process.exit(1); }

let allOk = true;
qs.forEach((q, i) => {
  const opts = Array.isArray(q.options) ? q.options : [];
  const problems = [];
  if (!q.q || typeof q.q !== 'string') problems.push('missing question text');
  if (opts.length < 2) problems.push('fewer than 2 options');
  if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= opts.length) problems.push('answer index out of range');
  if (!q.why || typeof q.why !== 'string') problems.push('missing explanation');
  if (problems.length) { allOk = false; console.error(`FAIL: question ${i + 1} — ${problems.join(', ')}`); }
});

if (allOk) console.log(`PASS: ${qs.length} well-formed questions for ${today}`);
process.exit(allOk ? 0 : 1);
