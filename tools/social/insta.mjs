// The daily Instagram carousel (owner, 2026-11-25): "The day in 5". A cover, the day's top five stories as illustrated slides
// (art + section + headline + why it matters), a quiz question and the app slide, 1080x1350. Posted automatically, once a day.
//
// The style test: the art alternates between three house styles (risograph, watercolour, clay; tools/social/art.mjs) by a
// rotation that shifts each week, so every style gets every weekday. Only the art changes: same template, same time. A daily
// --stats run reads each post's reach and engagement and, once there is enough, gives the leader most days (and then all).
//
//   node tools/social/insta.mjs --make [--date YYYY-MM-DD] [--out dir]   art + slides + caption -> out/<date>/ (meta.json)
//   node tools/social/insta.mjs --post --date D [--dry] [--force]         post out/<date> (already on R2) as a carousel
//   node tools/social/insta.mjs --stats                                     read the posts' numbers, update the style plan
//   node tools/social/insta.mjs --check                                     can we read post insights? (read-only)
//
// Env: CLOUDFLARE_API_TOKEN + R2_ACCOUNT_ID (art, and the small text model that turns a headline into a picture idea),
//      KV_REST_API_URL / KV_REST_API_TOKEN (the Instagram token, the style plan, what was posted), R2_PUBLIC_URL, IG_GRAPH_VERSION.
// KV: ig:carousel:<date> = {id, url, style, at}; ig:carousels = set of dates; ig:cstats:<date> = numbers; ig:style:plan.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { generate, STYLES } from './art.mjs';
import { kv, igCall, igAuth } from '../video/publish.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const req = createRequire(path.join(ROOT, 'tools/video/package.json'));
const satoriMod = await import(req.resolve('satori'));
const satori = typeof satoriMod.default === 'function' ? satoriMod.default : (satoriMod.default && satoriMod.default.default) || satoriMod.satori;
const { Resvg } = req('@resvg/resvg-js');
const cheerio = createRequire(path.join(ROOT, 'tools/audio/package.json'))('cheerio');
const PUBLIC = (process.env.R2_PUBLIC_URL || 'https://pub-1dafea4a948540db8413a044895e083c.r2.dev').replace(/\/$/, '');
const W = 1080, H = 1350;
const STYLE_IDS = ['riso', 'watercolor', 'clay'];
const STYLE_NAMES = { riso: 'Risograph', watercolor: 'Watercolour and gold', clay: 'Clay 3D' };
const GUARD = 'Absolutely no text, letters, numbers or symbols anywhere; plain unmarked surfaces; no screens, signs, paper or charts; no logos, no watermarks, no flags, no people.';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

// ---- the edition ----
export function readEdition(html) {
  const $ = cheerio.load(html);
  const date = $('[data-edition-date]').first().attr('data-edition-date') || '';
  const n = /Edition\s+0*(\d+)/i.exec($('.edition').first().text());
  const text = (el) => $(el).text().replace(/\s+/g, ' ').trim();
  const lanes = [];
  $('section.lane').each((_, lane) => {
    const items = $(lane).find('.item[data-story-id]');
    if (!items.length) return;
    const tagEl = $(lane).find('.lane-tag').first().clone();
    tagEl.find('.lane-time').remove();
    const key = ['ai', 'biz', 'mkt'].find((k) => $(lane).hasClass(k)) || 'ai';
    const stories = [];
    items.each((__, it) => {
      const head = text($(it).find('h3').first());
      const take = text($(it).find('p.takeaway').first()).replace(/^(Takeaway|Why it matters)[:.]?\s*/i, '');
      if (head) stories.push({ id: $(it).attr('data-story-id'), head, take });
    });
    lanes.push({ key, tag: text(tagEl), stories });
  });
  let quiz = null;
  try { quiz = JSON.parse($('#quiz-data').first().html() || 'null'); } catch (e) { quiz = null; }
  return { date, number: n ? Number(n[1]) : 0, lanes, quiz: quiz && quiz.questions, quizAll: quiz && quiz.questions };
}
// the day's five: each section's lead, then each section's second, in section order
export function topFive(ed) {
  const out = [];
  for (let round = 0; out.length < 5 && round < 6; round++) for (const l of ed.lanes) if (l.stories[round] && out.length < 5) out.push({ ...l.stories[round], lane: l.tag, key: l.key });
  return out;
}

// ---- the style of the day ----
const DAY0 = Date.parse('2026-11-26T00:00:00Z');
export function rotationStyle(date) {
  const d = Math.round((Date.parse(date + 'T00:00:00Z') - DAY0) / 864e5);
  return STYLE_IDS[(((d + Math.floor(d / 7)) % 3) + 3) % 3];             // shifts by one each week: every style gets every weekday
}
function hash01(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; }
export function styleFor(date, plan) {
  if (plan && plan.mode === 'winner' && STYLE_IDS.includes(plan.winner)) return plan.winner;
  if (plan && plan.mode === 'weighted' && plan.weights) {
    let x = hash01('ig-style-' + date), acc = 0;
    for (const id of STYLE_IDS) { acc += plan.weights[id] || 0; if (x < acc) return id; }
  }
  return rotationStyle(date);
}

// ---- a picture idea for a headline (Workers AI text model; a plain fallback if it fails) ----
const FALLBACK = {
  ai: 'a glowing microchip on a desk, light rays and circuit lines growing like vines around it',
  biz: 'a chessboard on a boardroom table with a few pieces mid-move, a city skyline through the window',
  mkt: 'a winding mountain path climbing towards a coin-shaped sun, a small brass compass resting on a rock in the foreground',
};
// Open image models write garbage on anything that carries writing, so the idea must have none: no screens, signs, banners,
// paper, charts or tickers. A larger model first (it reads the story's tone better), the small one as a fallback; an idea that
// still names a writing-carrier is rejected and asked for again.
const CARRIERS = /\b(text|words?|letters?|numbers?|digits?|figures|sign(s|age)?|banners?|screens?|monitors?|displays?|tickers?|tape|newspapers?|headlines?|posters?|labels?|charts?|graphs?|scoreboards?|billboards?|papers?|documents?|books?|logos?|flags?|price tags?|calendar)\b/i;
const SYSTEM = 'You write the scene for one editorial illustration about a news story. Choose ONE simple symbolic scene built from ' +
  'physical objects and nature (for example: chess pieces, seedlings, bridges, scales, keys, ropes, boats, mountains, weather, ' +
  'light, coins, gears, doors). Match the mood of the story: rising and hopeful for good news, falling or stormy for bad news, ' +
  'tense for a standoff. Never include anything that carries writing or markings: no screens, signs, banners, paper, books, ' +
  'charts, tickers, scoreboards, labels or flags. No people at all. One sentence, at most 30 words, objects and setting only. ' +
  'Do not start with the word "A lone". Output only the sentence.';
async function askModel(model, story) {
  const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_tokens: 90, temperature: 0.8, messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Section: ${story.lane}\nHeadline: ${story.head}\nWhy it matters: ${story.take || ''}` },
    ] }),
  });
  const j = await r.json();
  return String((j.result && j.result.response) || '').replace(/^["'\s]+|["'\s]+$/g, '').split('\n')[0];
}
async function subjectFor(story) {
  for (const model of ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct']) {
    try {
      const s = await askModel(model, story);
      if (s.length > 20 && s.length < 400 && !CARRIERS.test(s) && !/\b(man|woman|person|people|figure|cricketer|trader|crowd)\b/i.test(s)) return s;
      if (s) console.warn(`idea rejected (${model}): ${s}`);
    } catch (e) { console.warn(`idea failed (${model}): ${e.message}`); }
  }
  return FALLBACK[story.key] || FALLBACK.ai;
}

// ---- slides ----
const font = (f) => fs.readFileSync(path.join(ROOT, 'fonts', f));
const FONTS = [
  { name: 'Inter', data: font('inter-latin-400-normal.woff'), weight: 400, style: 'normal' },
  { name: 'Inter', data: font('inter-latin-700-normal.woff'), weight: 700, style: 'normal' },
  { name: 'Newsreader', data: font('newsreader-latin-500-normal.woff'), weight: 500, style: 'normal' },
  { name: 'Space Grotesk', data: font('space-grotesk-latin-700-normal.woff'), weight: 700, style: 'normal' },
];
const LOGO = `data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'brand/logo-256.png')).toString('base64')}`;
const el = (style, children, type = 'div', extra = {}) => ({ type, props: { style: { display: 'flex', ...style }, children, ...extra } });
const img = (src, style) => ({ type: 'img', props: { src, style } });
const NIGHT = '#14122b', GOLD = '#e8b04b', LILAC = '#c9c4e4';
const kicker = (t, color = GOLD) => el({ fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', color }, t);
// the arrow is drawn (the font files have no U+2192)
const ARROW = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#c9c4e4" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>').toString('base64');
const brandRow = (right) => el({ alignItems: 'center', justifyContent: 'space-between', width: '100%' }, [
  el({ alignItems: 'center', gap: 14 }, [img(LOGO, { width: 48, height: 48, borderRadius: 12 }), el({ fontFamily: 'Inter', fontWeight: 700, fontSize: 26, color: '#fff' }, 'The Hour Brief')]),
  right ? el({ alignItems: 'center', gap: 10, fontFamily: 'Inter', fontSize: 24, color: LILAC }, [el({}, right), img(ARROW, { width: 26, height: 26 })]) : el({}, ''),
]);
const headSize = (t) => (t.length > 150 ? 40 : t.length > 110 ? 46 : t.length > 70 ? 52 : 58);
function clip(t, n) { return t.length <= n ? t : t.slice(0, t.lastIndexOf(' ', n - 1)) + '…'; }

function storySlide(s, art, i) {
  return el({ width: W, height: H, flexDirection: 'column', background: NIGHT }, [
    img(art, { width: W, height: 790, objectFit: 'cover' }),
    el({ flexDirection: 'column', flexGrow: 1, padding: '44px 64px 40px', gap: 18 }, [
      kicker(`${s.lane} · ${i} of 5`),
      el({ fontFamily: 'Newsreader', fontWeight: 500, fontSize: headSize(s.head), lineHeight: 1.16, color: '#fff' }, clip(s.head, 190)),
      s.take ? el({ fontFamily: 'Inter', fontSize: 27, lineHeight: 1.4, color: LILAC }, clip(s.take, 130)) : null,
      el({ marginTop: 'auto', width: '100%' }, [brandRow(i < 5 ? 'Swipe' : 'One more')]),
    ].filter(Boolean)),
  ]);
}
function coverSlide(ed, art, when) {
  return el({ width: W, height: H, position: 'relative', background: NIGHT }, [
    img(art, { position: 'absolute', left: 0, top: 0, width: W, height: H, objectFit: 'cover' }),
    el({ position: 'absolute', left: 0, top: 0, width: W, height: H, backgroundImage: 'linear-gradient(180deg, rgba(20,18,43,0) 30%, rgba(20,18,43,0.88) 68%, rgba(20,18,43,0.98) 100%)' }, []),
    el({ position: 'absolute', left: 64, right: 64, bottom: 56, flexDirection: 'column', gap: 22 }, [
      kicker(`The day in 5 · ${when}`),
      el({ fontFamily: 'Newsreader', fontWeight: 500, fontSize: 84, lineHeight: 1.05, color: '#fff' }, 'Five stories that actually mattered today'),
      el({ fontFamily: 'Inter', fontSize: 30, color: LILAC }, `AI, business and Indian markets${ed.number ? ' · Edition ' + ed.number : ''}`),
      el({ marginTop: 18, width: '100%' }, [brandRow('Swipe')]),
    ]),
  ]);
}
function quizSlide(q) {
  return el({ width: W, height: H, flexDirection: 'column', padding: '84px 64px 56px', gap: 30, backgroundImage: 'linear-gradient(160deg, #5e43f3 0%, #3f27c4 55%, #2a1f78 100%)' }, [
    kicker('Can you answer?', '#ffd88a'),
    el({ fontFamily: 'Newsreader', fontWeight: 500, fontSize: headSize(q.q) + 2, lineHeight: 1.18, color: '#fff' }, clip(q.q, 200)),
    el({ flexDirection: 'column', gap: 18, marginTop: 10 }, q.options.slice(0, 4).map((o, k) => el({ alignItems: 'center', gap: 22, padding: '22px 26px', borderRadius: 24, background: 'rgba(255,255,255,0.12)', border: '2px solid rgba(255,255,255,0.22)' }, [
      el({ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.2)', fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 26, color: '#fff' }, String.fromCharCode(65 + k)),
      el({ fontFamily: 'Inter', fontSize: 30, color: '#fff', flexShrink: 1 }, clip(o, 70)),
    ]))),
    el({ marginTop: 'auto', flexDirection: 'column', gap: 26, width: '100%' }, [
      el({ fontFamily: 'Inter', fontSize: 28, color: '#e4deff' }, 'Comment your answer. The full quiz is in the app: link in bio.'),
      brandRow(''),
    ]),
  ]);
}
function ctaSlide() {
  return el({ width: W, height: H, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 34, padding: 80, backgroundImage: 'radial-gradient(circle at 80% 10%, rgba(232,176,75,0.25), rgba(20,18,43,0) 45%), linear-gradient(165deg, #2a1f78 0%, #14122b 65%)' }, [
    img(LOGO, { width: 170, height: 170, borderRadius: 40 }),
    el({ fontFamily: 'Newsreader', fontWeight: 500, fontSize: 76, lineHeight: 1.08, color: '#fff', textAlign: 'center', justifyContent: 'center' }, 'The news that actually mattered, in 7 minutes'),
    el({ fontFamily: 'Inter', fontSize: 32, color: LILAC, textAlign: 'center', justifyContent: 'center' }, 'Every morning: AI, business and Indian markets, with audio and a daily quiz.'),
    el({ marginTop: 20, padding: '22px 44px', borderRadius: 999, background: '#fff', fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 30, letterSpacing: 2, textTransform: 'uppercase', color: '#2a1f78' }, 'Free app · link in bio'),
    el({ fontFamily: 'Inter', fontSize: 26, color: LILAC }, 'iPhone and Android'),
  ]);
}
async function render(node, file) {
  const svg = await satori(node, { width: W, height: H, fonts: FONTS });
  const png = file.replace(/\.jpg$/, '.png');
  fs.writeFileSync(png, new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng());
  execFileSync(process.env.FFMPEG || 'ffmpeg', ['-loglevel', 'error', '-y', '-i', png, '-q:v', '2', file]);   // Instagram wants JPEG
  fs.unlinkSync(png);
}

export function caption(ed, five, when) {
  const lines = five.map((s, k) => `${k + 1}. ${s.head}`);
  return [`The day in 5 · ${when}`, '', ...lines, '', 'Which one surprised you? Tell us below 👇', 'The full brief, the audio and a 1-minute quiz: link in bio.', '',
    'Illustrations are AI-generated.', '', '#news #technews #AI #business #stockmarket #india #startups #markets #dailybrief'].join('\n').slice(0, 2150);
}

async function make(date, outDir) {
  const html = fs.readFileSync(date === 'latest' ? path.join(ROOT, 'index.html') : (fs.existsSync(path.join(ROOT, `archive/${date}.html`)) ? path.join(ROOT, `archive/${date}.html`) : path.join(ROOT, 'index.html')), 'utf8');
  const ed = readEdition(html);
  if (date !== 'latest' && ed.date !== date) throw new Error(`no edition for ${date} (index.html is ${ed.date})`);
  const five = topFive(ed);
  if (five.length < 5) throw new Error(`only ${five.length} stories`);
  // the quiz slide: a question whose answer isn't sitting in the headlines or takeaways just before it (else the first)
  const shown = five.map((x) => `${x.head} ${x.take}`).join(' ').toLowerCase();
  const qs = Array.isArray(ed.quiz) ? ed.quiz.filter((q) => q && q.q && Array.isArray(q.options) && q.options.length >= 2) : [];
  ed.quiz = qs.find((q) => !shown.includes(String(q.options[q.answer] || '').toLowerCase())) || qs[0] || null;
  let plan = null;
  try { plan = JSON.parse((await kv(['GET', 'ig:style:plan'])) || 'null'); } catch (e) { plan = null; }
  const style = arg('--style') || styleFor(ed.date, plan);
  const when = new Date(ed.date + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dir = path.join(outDir, ed.date);
  fs.mkdirSync(dir, { recursive: true });
  const arts = [];
  const local = arg('--art-dir');                // testing: ready-made pictures art-1..5.jpg instead of the model
  for (const [k, s] of five.entries()) {
    s.subject = local ? '(local test art)' : await subjectFor(s);
    let buf = local ? fs.readFileSync(path.join(local, `art-${k + 1}.jpg`)) : null;
    for (let tries = 0; !buf && tries < 3; tries++) { try { buf = await generate(`${s.subject}. ${STYLES[style]} ${GUARD}`, 'klein'); } catch (e) { console.warn(`art ${k + 1}: ${e.message}`); } }
    if (!buf) throw new Error(`no art for story ${k + 1}`);
    const f = path.join(dir, `art-${k + 1}.jpg`);
    fs.writeFileSync(f, buf);
    arts.push(`data:image/jpeg;base64,${buf.toString('base64')}`);
    console.log(`art ${k + 1}: ${s.subject}`);
  }
  const slides = [];
  const add = async (node) => { const f = path.join(dir, `${slides.length + 1}.jpg`); await render(node, f); slides.push(path.basename(f)); };
  await add(coverSlide(ed, arts[0], when));
  for (const [k, s] of five.entries()) await add(storySlide(s, arts[k], k + 1));
  if (ed.quiz) await add(quizSlide(ed.quiz));
  await add(ctaSlide());
  const meta = { v: 1, date: ed.date, edition: ed.number, style, styleName: STYLE_NAMES[style], plan: plan ? plan.mode : 'rotate', slides, caption: caption(ed, five, when),
    stories: five.map((s) => ({ id: s.id, lane: s.lane, head: s.head, subject: s.subject })), madeAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 1));
  console.log(`made ${slides.length} slides for ${ed.date} in the ${STYLE_NAMES[style]} style -> ${dir}`);
  return meta;
}

// ---- posting (the slides are already public on R2: social/ig/<date>/<n>.jpg) ----
async function post(date, { dry, force }) {
  const meta = await (await fetch(`${PUBLIC}/social/ig/${date}/meta.json`, { cache: 'no-store' })).json();
  const key = `ig:carousel:${date}`;
  if (!force && !dry) { const done = await kv(['GET', key]); if (done) { console.log(`instagram carousel: already posted for ${date} (${done})`); return; } }
  const a = await igAuth();
  if (!a) { console.log('instagram: not connected'); return; }
  const urls = meta.slides.map((s) => `${PUBLIC}/social/ig/${date}/${s}`);
  if (dry) { console.log(JSON.stringify({ dry: true, account: a.username, style: meta.style, urls, caption: meta.caption.slice(0, 200) + '…' }, null, 1)); return; }
  const children = [];
  for (const u of urls) children.push((await igCall('POST', `/${a.userId}/media`, { image_url: u, is_carousel_item: 'true', access_token: a.token }, a.host)).id);
  const c = await igCall('POST', `/${a.userId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption: meta.caption, access_token: a.token }, a.host);
  for (let i = 0; i < 30; i++) {
    const st = await igCall('GET', `/${c.id}`, { fields: 'status_code', access_token: a.token }, a.host).catch(() => ({}));
    if (st.status_code === 'FINISHED' || !st.status_code) break;
    if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error(`instagram carousel processing: ${st.status_code}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  const p = await igCall('POST', `/${a.userId}/media_publish`, { creation_id: c.id, access_token: a.token }, a.host);
  const link = await igCall('GET', `/${p.id}`, { fields: 'permalink', access_token: a.token }, a.host).catch(() => ({}));
  const rec = { id: p.id, url: link.permalink || '', style: meta.style, at: new Date().toISOString() };
  await kv(['SET', key, JSON.stringify(rec), 'EX', String(120 * 86400)]);
  await kv(['SADD', 'ig:carousels', date]);
  console.log(`instagram carousel posted: ${JSON.stringify(rec)}`);
}

// ---- the style test: numbers per post, then the plan ----
const METRICS = 'reach,likes,comments,saved,shares,total_interactions';
export function score(m) {                       // engagement per person reached; saves and shares count most
  const reach = Math.max(1, m.reach || 0);
  return ((m.saved || 0) * 3 + (m.shares || 0) * 3 + (m.comments || 0) * 2 + (m.likes || 0)) / reach;
}
export function decide(rows, now) {              // rows: [{date, style, score, reach}] for posts at least 2 days old
  const by = {};
  for (const id of STYLE_IDS) by[id] = rows.filter((r) => r.style === id);
  const n = Math.min(...STYLE_IDS.map((id) => by[id].length));
  const mean = (a) => a.reduce((x, r) => x + r.score, 0) / Math.max(1, a.length);
  const avg = Object.fromEntries(STYLE_IDS.map((id) => [id, by[id].length ? mean(by[id]) : 0]));
  const order = STYLE_IDS.slice().sort((a, b) => avg[b] - avg[a]);
  const plan = { mode: 'rotate', avg, posts: Object.fromEntries(STYLE_IDS.map((id) => [id, by[id].length])), at: now };
  if (n >= 7) {                                  // about three weeks: the leader gets most days, the others keep some
    const lead = order[0], gap = avg[order[1]] ? avg[lead] / avg[order[1]] : 2;
    if (n >= 14 && gap >= 1.25) { plan.mode = 'winner'; plan.winner = lead; }
    else { plan.mode = 'weighted'; plan.weights = Object.fromEntries(STYLE_IDS.map((id) => [id, id === lead ? 0.7 : 0.15])); plan.leader = lead; }
  }
  return plan;
}
async function stats() {
  const a = await igAuth();
  if (!a) { console.log('instagram: not connected'); return; }
  const dates = ((await kv(['SMEMBERS', 'ig:carousels'])) || []).sort();
  const rows = [];
  for (const d of dates) {
    const rec = JSON.parse((await kv(['GET', `ig:carousel:${d}`])) || 'null');
    if (!rec) continue;
    try {
      const j = await igCall('GET', `/${rec.id}/insights`, { metric: METRICS, access_token: a.token }, a.host);
      const m = {};
      for (const x of j.data || []) m[x.name] = (x.values && x.values[0] && x.values[0].value) || x.total_value?.value || 0;
      await kv(['SET', `ig:cstats:${d}`, JSON.stringify({ ...m, style: rec.style, at: Date.now() }), 'EX', String(400 * 86400)]);
      const age = (Date.now() - Date.parse(rec.at)) / 864e5;
      if (age >= 2) rows.push({ date: d, style: rec.style, score: score(m), reach: m.reach || 0 });
      console.log(`${d} ${rec.style}: ${JSON.stringify(m)} score ${score(m).toFixed(4)}`);
    } catch (e) { console.log(`${d}: insights not available (${e.message})`); }
  }
  const plan = decide(rows, new Date().toISOString());
  await kv(['SET', 'ig:style:plan', JSON.stringify(plan)]);
  console.log(`style plan: ${JSON.stringify(plan)}`);
}
async function check() {
  const a = await igAuth();
  if (!a) { console.log('instagram: not connected'); return; }
  const me = await igCall('GET', `/${a.userId}`, { fields: 'username', access_token: a.token }, a.host);
  console.log(`instagram: @${me.username} via ${a.host || 'graph.instagram.com'}`);
  const media = await igCall('GET', `/${a.userId}/media`, { fields: 'id,media_type,timestamp,permalink', limit: '3', access_token: a.token }, a.host);
  console.log(`recent posts: ${(media.data || []).map((m) => `${m.timestamp.slice(0, 10)} ${m.media_type}`).join(', ') || 'none'}`);
  const m0 = (media.data || [])[0];
  if (!m0) { console.log('insights: no post to test on yet'); return; }
  const metric = m0.media_type === 'VIDEO' ? 'reach,likes,comments,saved,shares' : METRICS;
  try { const j = await igCall('GET', `/${m0.id}/insights`, { metric, access_token: a.token }, a.host); console.log(`insights: OK (${(j.data || []).map((x) => x.name).join(', ')})`); }
  catch (e) { console.log(`insights: NOT AVAILABLE (${e.message})`); process.exitCode = 2; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    if (process.argv.includes('--check')) return check();
    if (process.argv.includes('--stats')) return stats();
    if (process.argv.includes('--make')) return make(arg('--date', 'latest'), arg('--out', 'out/ig'));
    if (process.argv.includes('--post')) return post(arg('--date', istToday()), { dry: process.argv.includes('--dry'), force: process.argv.includes('--force') });
    console.log('use --make, --post, --stats or --check');
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
