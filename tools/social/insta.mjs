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
import { entityFor, freePhoto } from './photo.mjs';
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
async function askModel(model, story, used) {
  const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_tokens: 90, temperature: 0.8, messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Section: ${story.lane}\nHeadline: ${story.head}\nWhy it matters: ${story.take || ''}` +
        (used && used.length ? `\nAlready used today, so pick different main objects and setting: ${used.join(' | ')}` : '') },
    ] }),
  });
  const j = await r.json();
  return String((j.result && j.result.response) || '').replace(/^["'\s]+|["'\s]+$/g, '').split('\n')[0];
}
async function subjectFor(story, used) {
  for (const model of ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct']) {
    try {
      const s = await askModel(model, story, used);
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
  // the -ext files carry ₹ and the other currency signs (Indian-market headlines and quiz options need them)
  { name: 'InterExt', data: font('inter-latin-ext-400-normal.woff'), weight: 400, style: 'normal' },
  { name: 'InterExt', data: font('inter-latin-ext-700-normal.woff'), weight: 700, style: 'normal' },
  { name: 'NewsreaderExt', data: font('newsreader-latin-ext-500-normal.woff'), weight: 500, style: 'normal' },
  { name: 'SpaceExt', data: font('space-grotesk-latin-ext-700-normal.woff'), weight: 700, style: 'normal' },
];
const LOGO = `data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'brand/logo-256.png')).toString('base64')}`;
const el = (style, children, type = 'div', extra = {}) => ({ type, props: { style: { display: 'flex', ...style }, children, ...extra } });
const img = (src, style) => ({ type: 'img', props: { src, style } });
const NIGHT = '#14122b', GOLD = '#e8b04b', LILAC = '#c9c4e4';
const kicker = (t, color = GOLD) => el({ fontFamily: 'Space Grotesk, SpaceExt', fontSize: 26, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', color }, t);
// the arrow is drawn (the font files have no U+2192)
const ARROW = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#c9c4e4" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>').toString('base64');
const brandRow = (right) => el({ alignItems: 'center', justifyContent: 'space-between', width: '100%' }, [
  el({ alignItems: 'center', gap: 14 }, [img(LOGO, { width: 48, height: 48, borderRadius: 12 }), el({ fontFamily: 'Inter, InterExt', fontWeight: 700, fontSize: 26, color: '#fff' }, 'The Hour Brief')]),
  right ? el({ alignItems: 'center', gap: 10, fontFamily: 'Inter, InterExt', fontSize: 24, color: LILAC }, [el({}, right), img(ARROW, { width: 26, height: 26 })]) : el({}, ''),
]);
const headSize = (t) => (t.length > 150 ? 40 : t.length > 110 ? 46 : t.length > 70 ? 52 : 58);
function clip(t, n) { return t.length <= n ? t : t.slice(0, t.lastIndexOf(' ', n - 1)) + '…'; }

// The picture fades into the colour behind the text (owner, 2026-11-25: "make the background blend into the text"): the
// image itself is masked to transparent towards its bottom, so it melts into whatever is behind it (a flat colour or a
// gradient) with no seam, and a soft glow of the night colour behind the text keeps the words readable over the fade.
const FADE = (from, to) => `linear-gradient(180deg, rgba(0,0,0,1) ${from}%, rgba(0,0,0,0) ${to}%)`;
const fadedArt = (art, h, from, to, pos) => img(art, { position: 'absolute', left: 0, top: 0, width: W, height: h, objectFit: 'cover', objectPosition: pos || 'center', maskImage: FADE(from, to) });
// a real photo's credit, required by its licence (photo.mjs): small, top right, over the picture
const credit = (t) => el({ position: 'absolute', right: 24, top: 22, maxWidth: 760, padding: '6px 12px', borderRadius: 10, background: 'rgba(10,9,24,0.55)', fontFamily: 'Inter, InterExt', fontSize: 17, color: 'rgba(255,255,255,0.85)' }, clip(t, 90));
const shade = (top, rgb) => el({ position: 'absolute', left: 0, top, width: W, height: H - top, backgroundImage: `linear-gradient(180deg, rgba(${rgb},0) 0%, rgba(${rgb},0.18) 14%, rgba(${rgb},0.45) 28%, rgba(${rgb},0.72) 42%, rgba(${rgb},0.88) 56%)` }, []);

function storySlide(s, art, i) {
  return el({ width: W, height: H, position: 'relative', background: NIGHT }, [
    fadedArt(art, 1080, 55, 100, s.photo ? 'center 22%' : 'center'),            // a face sits high in its photo
    shade(470, '20,18,43'),
    s.photo ? credit(s.photo.credit) : null,
    el({ position: 'absolute', left: 0, bottom: 0, width: W, flexDirection: 'column', padding: '0 64px 40px', gap: 18 }, [
      kicker(`${s.lane} · ${i} of 5`),
      el({ fontFamily: 'Newsreader, NewsreaderExt', fontWeight: 500, fontSize: headSize(s.head), lineHeight: 1.16, color: '#fff' }, clip(s.head, 190)),
      s.take ? el({ fontFamily: 'Inter, InterExt', fontSize: 27, lineHeight: 1.4, color: LILAC }, clip(s.take, 130)) : null,
      el({ marginTop: 34, width: '100%' }, [brandRow(i < 5 ? 'Swipe' : 'One more')]),
    ].filter(Boolean)),
  ].filter(Boolean));
}
function coverSlide(ed, art, when) {
  return el({ width: W, height: H, position: 'relative', background: NIGHT }, [
    img(art, { position: 'absolute', left: 0, top: 0, width: W, height: H, objectFit: 'cover' }),
    el({ position: 'absolute', left: 0, top: 0, width: W, height: H, backgroundImage: 'linear-gradient(180deg, rgba(20,18,43,0) 30%, rgba(20,18,43,0.88) 68%, rgba(20,18,43,0.98) 100%)' }, []),
    el({ position: 'absolute', left: 64, right: 64, bottom: 56, flexDirection: 'column', gap: 22 }, [
      kicker(`The day in 5 · ${when}`),
      el({ fontFamily: 'Newsreader, NewsreaderExt', fontWeight: 500, fontSize: 84, lineHeight: 1.05, color: '#fff' }, 'Five stories that actually mattered today'),
      el({ fontFamily: 'Inter, InterExt', fontSize: 30, color: LILAC }, `AI, business and Indian markets${ed.number ? ' · Edition ' + ed.number : ''}`),
      el({ marginTop: 18, width: '100%' }, [brandRow('Swipe')]),
    ]),
  ]);
}
function quizSlide(q) {
  return el({ width: W, height: H, flexDirection: 'column', padding: '84px 64px 56px', gap: 30, backgroundImage: 'linear-gradient(160deg, #5e43f3 0%, #3f27c4 55%, #2a1f78 100%)' }, [
    kicker('Can you answer?', '#ffd88a'),
    el({ fontFamily: 'Newsreader, NewsreaderExt', fontWeight: 500, fontSize: headSize(q.q) + 2, lineHeight: 1.18, color: '#fff' }, clip(q.q, 200)),
    el({ flexDirection: 'column', gap: 18, marginTop: 10 }, q.options.slice(0, 4).map((o, k) => el({ alignItems: 'center', gap: 22, padding: '22px 26px', borderRadius: 24, background: 'rgba(255,255,255,0.12)', border: '2px solid rgba(255,255,255,0.22)' }, [
      el({ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.2)', fontFamily: 'Space Grotesk, SpaceExt', fontWeight: 700, fontSize: 26, color: '#fff' }, String.fromCharCode(65 + k)),
      el({ fontFamily: 'Inter, InterExt', fontSize: 30, color: '#fff', flexShrink: 1 }, clip(o, 70)),
    ]))),
    el({ marginTop: 'auto', flexDirection: 'column', gap: 26, width: '100%' }, [
      el({ fontFamily: 'Inter, InterExt', fontSize: 28, color: '#e4deff' }, 'Comment your answer. The full quiz is in the app: link in bio.'),
      brandRow(''),
    ]),
  ]);
}
function ctaSlide() {
  return el({ width: W, height: H, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 34, padding: 80, backgroundImage: 'radial-gradient(circle at 80% 10%, rgba(232,176,75,0.25), rgba(20,18,43,0) 45%), linear-gradient(165deg, #2a1f78 0%, #14122b 65%)' }, [
    img(LOGO, { width: 170, height: 170, borderRadius: 40 }),
    el({ fontFamily: 'Newsreader, NewsreaderExt', fontWeight: 500, fontSize: 76, lineHeight: 1.08, color: '#fff', textAlign: 'center', justifyContent: 'center' }, 'The news that actually mattered, in 7 minutes'),
    el({ fontFamily: 'Inter, InterExt', fontSize: 32, color: LILAC, textAlign: 'center', justifyContent: 'center' }, 'Every morning: AI, business and Indian markets, with audio and a daily quiz.'),
    el({ marginTop: 20, padding: '22px 44px', borderRadius: 999, background: '#fff', fontFamily: 'Space Grotesk, SpaceExt', fontWeight: 700, fontSize: 30, letterSpacing: 2, textTransform: 'uppercase', color: '#2a1f78' }, 'Free app · link in bio'),
    el({ fontFamily: 'Inter, InterExt', fontSize: 26, color: LILAC }, 'iPhone and Android'),
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
    five.some((s) => s.photo) ? 'Illustrations are AI-generated. Photos via Wikimedia Commons: ' + five.filter((s) => s.photo).map((s) => s.photo.credit.replace(/^Photo: /, '').replace(' / Wikimedia Commons', '')).join('; ') + '.' : 'Illustrations are AI-generated.', '', '#news #technews #AI #business #stockmarket #india #startups #markets #dailybrief'].join('\n').slice(0, 2150);
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
  let coverArt = null;
  const local = arg('--art-dir');                // testing: ready-made pictures art-1..5.jpg instead of the model
  for (const [k, s] of five.entries()) {
    // a real photo of the person the story is about, when Wikimedia Commons has a freely licensed one (photo.mjs)
    const forced = (arg('--photo-test') || '').split(':');            // testing: --photo-test 2:"Sundar Pichai"
    if ((!local || forced[0] === String(k + 1)) && !arg('--no-photos')) {
      try {
        const who = forced[0] === String(k + 1) ? forced.slice(1).join(':') : local ? null : await entityFor(s);
        const p = who ? await freePhoto(who) : null;
        if (p) {
          const raw = path.join(dir, `photo-${k + 1}-raw`), f = path.join(dir, `photo-${k + 1}.jpg`);
          fs.writeFileSync(raw, p.buf);
          execFileSync(process.env.FFMPEG || 'ffmpeg', ['-loglevel', 'error', '-y', '-i', raw, '-vf', 'scale=1080:-2', '-q:v', '3', f]);   // a plain sRGB JPEG
          fs.unlinkSync(raw);
          s.photo = { who, credit: p.credit, license: p.license, page: p.page };
          console.log(`photo ${k + 1}: ${who} (${p.credit})`);
          arts.push(`data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}`);
          if (k > 0) continue;                    // the cover keeps the day's illustration (the style test), so story 1 gets art too
        }
      } catch (e) { console.warn(`photo ${k + 1}: ${e.message}`); }
    }
    s.subject = local ? '(local test art)' : await subjectFor(s, five.slice(0, k).map((x) => x.subject));
    let buf = local ? fs.readFileSync(path.join(local, `art-${k + 1}.jpg`)) : null;
    for (let tries = 0; !buf && tries < 3; tries++) { try { buf = await generate(`${s.subject}. ${STYLES[style]} ${GUARD}`, 'klein'); } catch (e) { console.warn(`art ${k + 1}: ${e.message}`); } }
    if (!buf) throw new Error(`no art for story ${k + 1}`);
    const f = path.join(dir, `art-${k + 1}.jpg`);
    fs.writeFileSync(f, buf);
    const uri = `data:image/jpeg;base64,${buf.toString('base64')}`;
    if (k === 0) coverArt = uri;
    if (!s.photo) arts.push(uri);
    console.log(`art ${k + 1}: ${s.subject}`);
  }
  const slides = [];
  const add = async (node) => { const f = path.join(dir, `${slides.length + 1}.jpg`); await render(node, f); slides.push(path.basename(f)); };
  await add(coverSlide(ed, coverArt || arts[0], when));
  for (const [k, s] of five.entries()) await add(storySlide(s, arts[k], k + 1));
  if (ed.quiz) await add(quizSlide(ed.quiz));
  await add(ctaSlide());
  const meta = { v: 1, date: ed.date, edition: ed.number, style, styleName: STYLE_NAMES[style], plan: plan ? plan.mode : 'rotate', slides, caption: caption(ed, five, when),
    quizQ: ed.quiz ? ed.quiz.q : null, stories: five.map((s) => ({ id: s.id, lane: s.lane, head: s.head, subject: s.subject, photo: s.photo || null })), madeAt: new Date().toISOString() };
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

// ---- the evening post (owner, 2026-11-25: "one image, one video, then one image each day") ----
// 18:30 IST, a single illustrated "Can you answer?" card: another of the day's quiz questions (not the morning slide's), with
// the art of its story (the morning's picture if that story was in the five, else a new one in the day's style).
function eveningCard(q, art, when) {
  return el({ width: W, height: H, position: 'relative', backgroundImage: 'linear-gradient(180deg, #3b2bb0 0%, #2a1f78 50%, #14122b 100%)' }, [
    fadedArt(art, 860, 45, 95),
    shade(380, '36,27,104'),
    el({ position: 'absolute', left: 0, bottom: 0, width: W, flexDirection: 'column', padding: '0 64px 44px', gap: 20 }, [
      kicker(`Tonight’s question · ${when}`, '#ffd88a'),
      el({ fontFamily: 'Newsreader, NewsreaderExt', fontWeight: 500, fontSize: Math.min(50, headSize(q.q)), lineHeight: 1.16, color: '#fff' }, clip(q.q, 170)),
      el({ flexDirection: 'column', gap: 12 }, q.options.slice(0, 4).map((o, k) => el({ alignItems: 'center', gap: 18, padding: '14px 22px', borderRadius: 20, background: 'rgba(255,255,255,0.12)', border: '2px solid rgba(255,255,255,0.2)' }, [
        el({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.22)', fontFamily: 'Space Grotesk, SpaceExt', fontWeight: 700, fontSize: 22, color: '#fff' }, String.fromCharCode(65 + k)),
        el({ fontFamily: 'Inter, InterExt', fontSize: 27, color: '#fff', flexShrink: 1 }, clip(o, 64)),
      ]))),
      el({ marginTop: 24, width: '100%' }, [brandRow('Comment A, B, C or D')]),
    ]),
  ]);
}
// The evening post as a Reel (owner, 2026-11-25: the Veo "evening quiz" loop): the question and its four answers over the
// moving violet background, 12 s, silent. Reels reach more people than single images, and it needs no picture from the art
// model. tools/video/motion/quiz.mp4 (a seamless loop); without it, the illustrated image as before.
const QUIZ_LOOP = path.join(ROOT, 'tools/video/motion/quiz.mp4');
const RW = 1080, RH = 1920, REEL_SECONDS = 12;
function eveningReelCard(q, when) {
  // Instagram covers the bottom ~380px and a strip on the right with its own buttons: nothing important there. The words sit
  // on a dark glass panel in the middle, so the floating shapes of the loop pass around and behind it, never through the text.
  return el({ width: RW, height: RH, flexDirection: 'column', padding: '150px 100px 400px 70px' }, [
    el({ alignItems: 'center', gap: 16 }, [img(LOGO, { width: 64, height: 64, borderRadius: 16 }), el({ fontFamily: 'Space Grotesk, SpaceExt', fontWeight: 700, fontSize: 34, letterSpacing: 1, color: '#fff' }, 'THE HOUR BRIEF')]),
    el({ flexGrow: 1 }),
    el({ flexDirection: 'column', gap: 26, padding: '48px 44px 44px', borderRadius: 44, background: 'rgba(14, 9, 44, 0.78)', border: '2px solid rgba(255,255,255,0.18)', boxShadow: '0 30px 80px rgba(8, 4, 30, 0.55)' }, [
      kicker(`Tonight’s question · ${when}`, '#ffd88a'),
      el({ fontFamily: 'Newsreader, NewsreaderExt', fontWeight: 500, fontSize: q.q.length > 110 ? 56 : 64, lineHeight: 1.14, color: '#fff' }, clip(q.q, 170)),
      el({ flexDirection: 'column', gap: 16, marginTop: 8 }, q.options.slice(0, 4).map((o, k) => el({ alignItems: 'center', gap: 20, padding: '20px 24px', borderRadius: 24, background: 'rgba(255,255,255,0.08)', border: '2px solid rgba(255,255,255,0.2)' }, [
        el({ width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.2)', fontFamily: 'Space Grotesk, SpaceExt', fontWeight: 700, fontSize: 26, color: '#fff' }, String.fromCharCode(65 + k)),
        el({ fontFamily: 'Inter, InterExt', fontSize: 34, color: '#fff', flexShrink: 1 }, clip(o, 60)),
      ]))),
      el({ marginTop: 8, fontFamily: 'Inter, InterExt', fontWeight: 700, fontSize: 36, color: '#ffd88a' }, 'Comment A, B, C or D'),
    ]),
    el({ flexGrow: 1 }),
  ]);
}
async function makeEveningReel(q, when, dir) {
  const png = path.join(dir, 'evening-card.png');
  const svg = await satori(eveningReelCard(q, when), { width: RW, height: RH, fonts: FONTS });
  fs.writeFileSync(png, new Resvg(svg, { fitTo: { mode: 'width', value: RW } }).render().asPng());
  const ff = process.env.FFMPEG || 'ffmpeg', mp4 = path.join(dir, 'evening.mp4');
  // the loop (darkened a touch so the words read), the card fading in after half a second
  execFileSync(ff, ['-loglevel', 'error', '-y', '-stream_loop', '-1', '-i', QUIZ_LOOP, '-loop', '1', '-i', png, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-filter_complex',
    `[0:v]scale=${RW}:${RH}:flags=lanczos,setsar=1,fps=30,eq=brightness=-0.06,trim=0:${REEL_SECONDS},setpts=PTS-STARTPTS[bg];[1:v]format=rgba,fade=t=in:st=0.5:d=0.6:alpha=1,trim=0:${REEL_SECONDS},setpts=PTS-STARTPTS[fg];[bg][fg]overlay=0:0,format=yuv420p[v]`,
    '-map', '[v]', '-map', '2:a', '-t', String(REEL_SECONDS),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', mp4]);
  execFileSync(ff, ['-loglevel', 'error', '-y', '-ss', '3', '-i', mp4, '-frames:v', '1', '-q:v', '2', path.join(dir, 'evening.jpg')]);   // the cover
  fs.unlinkSync(png);
}

async function makeEvening(date, outDir) {
  const html = fs.readFileSync(date === 'latest' ? path.join(ROOT, 'index.html') : (fs.existsSync(path.join(ROOT, `archive/${date}.html`)) ? path.join(ROOT, `archive/${date}.html`) : path.join(ROOT, 'index.html')), 'utf8');
  const ed = readEdition(html);
  if (date !== 'latest' && ed.date !== date) throw new Error(`no edition for ${date} (index.html is ${ed.date})`);
  const morning = await fetch(`${PUBLIC}/social/ig/${ed.date}/meta.json`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  let plan = null;
  try { plan = JSON.parse((await kv(['GET', 'ig:style:plan'])) || 'null'); } catch (e) { plan = null; }
  const style = arg('--style') || (morning && morning.style) || styleFor(ed.date, plan);
  const qs = (Array.isArray(ed.quiz) ? ed.quiz : []).filter((q) => q && q.q && Array.isArray(q.options) && q.options.length >= 2 && (!morning || q.q !== morning.quizQ));
  if (!qs.length) throw new Error('no quiz question left for the evening post');
  const inFive = (q) => (morning ? morning.stories.findIndex((x) => x.id === q.story) : -1);
  // not answered by the morning's headlines (people saw those), ideally about one of the five (its picture is ready)
  const shown = (morning ? morning.stories.map((x) => x.head).join(' ') : topFive(ed).map((x) => `${x.head} ${x.take}`).join(' ')).toLowerCase();
  const fresh = (x) => !shown.includes(String(x.options[x.answer] || '').toLowerCase());
  const q = qs.find((x) => fresh(x) && inFive(x) >= 0) || qs.find(fresh) || qs[0];
  const when0 = new Date(ed.date + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (fs.existsSync(QUIZ_LOOP) && !arg('--style')) {
    const dir0 = path.join(outDir, ed.date);
    fs.mkdirSync(dir0, { recursive: true });
    await makeEveningReel(q, when0, dir0);
    const cap0 = ['Can you answer? 🤔', '', q.q, '', ...q.options.slice(0, 4).map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`), '',
      'Comment your answer 👇 The answer, the story behind it and today’s full quiz: link in bio.', '',
      '#quiz #newsquiz #news #AI #business #india #stockmarket #dailybrief'].join('\n').slice(0, 2150);
    const meta0 = { v: 2, kind: 'evening', date: ed.date, style: 'reel', styleName: 'Reel (quiz loop)', video: 'evening.mp4', image: 'evening.jpg', question: q.q, caption: cap0, madeAt: new Date().toISOString() };
    fs.writeFileSync(path.join(dir0, 'evening.json'), JSON.stringify(meta0, null, 1));
    console.log(`made the evening Reel for ${ed.date}: ${q.q}`);
    return meta0;
  }
  const k = inFive(q);
  let buf = arg('--art-dir') ? fs.readFileSync(path.join(arg('--art-dir'), 'art-1.jpg')) : null;   // testing
  if (!buf && k >= 0) buf = await fetch(`${PUBLIC}/social/ig/${ed.date}/art-${k + 1}.jpg`).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? Buffer.from(b) : null)).catch(() => null);
  if (!buf) {
    let story = null;
    for (const l of ed.lanes) for (const x of l.stories) if (x.id === q.story) story = { ...x, lane: l.tag, key: l.key };
    story = story || { head: q.q, take: '', lane: '', key: 'ai' };
    const subject = await subjectFor(story, []);
    for (let tries = 0; !buf && tries < 3; tries++) { try { buf = await generate(`${subject}. ${STYLES[style]} ${GUARD}`, 'klein'); } catch (e) { console.warn(`evening art: ${e.message}`); } }
    if (!buf) throw new Error('no art for the evening post');
    console.log(`evening art: ${subject}`);
  }
  const when = new Date(ed.date + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dir = path.join(outDir, ed.date);
  fs.mkdirSync(dir, { recursive: true });
  await render(eveningCard(q, `data:image/jpeg;base64,${buf.toString('base64')}`, when), path.join(dir, 'evening.jpg'));
  const cap = ['Can you answer? 🤔', '', q.q, '', ...q.options.slice(0, 4).map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`), '',
    'Comment your answer 👇 The answer, the story behind it and today’s full quiz: link in bio.', '', 'Illustration is AI-generated.', '',
    '#quiz #newsquiz #news #AI #business #india #stockmarket #dailybrief'].join('\n').slice(0, 2150);
  const meta = { v: 1, kind: 'evening', date: ed.date, style, styleName: STYLE_NAMES[style], image: 'evening.jpg', question: q.q, caption: cap, madeAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, 'evening.json'), JSON.stringify(meta, null, 1));
  console.log(`made the evening post for ${ed.date} (${STYLE_NAMES[style]}): ${q.q}`);
  return meta;
}
async function postEvening(date, { dry, force }) {
  const meta = await (await fetch(`${PUBLIC}/social/ig/${date}/evening.json`, { cache: 'no-store' })).json();
  const key = `ig:evening:${date}`;
  if (!force && !dry) { const done = await kv(['GET', key]); if (done) { console.log(`instagram evening post: already posted for ${date} (${done})`); return; } }
  const a = await igAuth();
  if (!a) { console.log('instagram: not connected'); return; }
  const url = `${PUBLIC}/social/ig/${date}/${meta.video || meta.image}`;
  if (dry) { console.log(JSON.stringify({ dry: true, account: a.username, style: meta.style, url, caption: meta.caption.slice(0, 200) + '…' }, null, 1)); return; }
  const media = meta.video
    ? { media_type: 'REELS', video_url: url, cover_url: `${PUBLIC}/social/ig/${date}/${meta.image}`, share_to_feed: 'true', caption: meta.caption, access_token: a.token }
    : { image_url: url, caption: meta.caption, access_token: a.token };
  const c = await igCall('POST', `/${a.userId}/media`, media, a.host);
  for (let i = 0; i < (meta.video ? 45 : 20); i++) {                     // a video takes Instagram a few minutes to process
    if (meta.video) await new Promise((r) => setTimeout(r, 8000));
    const st = await igCall('GET', `/${c.id}`, { fields: 'status_code', access_token: a.token }, a.host).catch(() => ({}));
    if (st.status_code === 'FINISHED' || (!st.status_code && !meta.video)) break;
    if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error(`instagram processing: ${st.status_code}`);
    if (!meta.video) await new Promise((r) => setTimeout(r, 4000));
  }
  const p = await igCall('POST', `/${a.userId}/media_publish`, { creation_id: c.id, access_token: a.token }, a.host);
  const link = await igCall('GET', `/${p.id}`, { fields: 'permalink', access_token: a.token }, a.host).catch(() => ({}));
  const rec = { id: p.id, url: link.permalink || '', style: meta.style, kind: 'evening', at: new Date().toISOString() };
  await kv(['SET', key, JSON.stringify(rec), 'EX', String(120 * 86400)]);
  await kv(['SADD', 'ig:evenings', date]);
  console.log(`instagram evening post: ${JSON.stringify(rec)}`);
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
  // a carousel and a single image engage differently: each post is scored against the average of its own kind first
  const kindAvg = {};
  for (const r of rows) { const k = r.kind || 'carousel'; (kindAvg[k] = kindAvg[k] || []).push(r.score); }
  for (const k in kindAvg) kindAvg[k] = kindAvg[k].reduce((a, b) => a + b, 0) / kindAvg[k].length || 1;
  const rel = (r) => r.score / (kindAvg[r.kind || 'carousel'] || 1);
  const mean = (a) => a.reduce((x, r) => x + rel(r), 0) / Math.max(1, a.length);
  const avg = Object.fromEntries(STYLE_IDS.map((id) => [id, by[id].length ? mean(by[id]) : 0]));
  const order = STYLE_IDS.slice().sort((a, b) => avg[b] - avg[a]);
  const plan = { mode: 'rotate', avg, posts: Object.fromEntries(STYLE_IDS.map((id) => [id, by[id].length])), at: now };
  if (n >= 10) {                                 // about two weeks (two image posts a day): the leader gets most days, the others keep some
    const lead = order[0], gap = avg[order[1]] ? avg[lead] / avg[order[1]] : 2;
    if (n >= 20 && gap >= 1.25) { plan.mode = 'winner'; plan.winner = lead; }
    else { plan.mode = 'weighted'; plan.weights = Object.fromEntries(STYLE_IDS.map((id) => [id, id === lead ? 0.7 : 0.15])); plan.leader = lead; }
  }
  return plan;
}
async function stats() {
  const a = await igAuth();
  if (!a) { console.log('instagram: not connected'); return; }
  const rows = [];
  for (const [kind, set, recKey, statKey] of [['carousel', 'ig:carousels', 'ig:carousel:', 'ig:cstats:'], ['evening', 'ig:evenings', 'ig:evening:', 'ig:estats:']]) {
  const dates = ((await kv(['SMEMBERS', set])) || []).sort();
  for (const d of dates) {
    const rec = JSON.parse((await kv(['GET', recKey + d])) || 'null');
    if (!rec) continue;
    try {
      const j = await igCall('GET', `/${rec.id}/insights`, { metric: rec.style === 'reel' ? 'reach,likes,comments,saved,shares' : METRICS, access_token: a.token }, a.host);
      const m = {};
      for (const x of j.data || []) m[x.name] = (x.values && x.values[0] && x.values[0].value) || x.total_value?.value || 0;
      await kv(['SET', statKey + d, JSON.stringify({ ...m, style: rec.style, at: Date.now() }), 'EX', String(400 * 86400)]);
      const age = (Date.now() - Date.parse(rec.at)) / 864e5;
      if (age >= 2) rows.push({ date: d, kind, style: rec.style, score: score(m), reach: m.reach || 0 });
      console.log(`${d} ${kind} ${rec.style}: ${JSON.stringify(m)} score ${score(m).toFixed(4)}`);
    } catch (e) { console.log(`${d} ${kind}: insights not available (${e.message})`); }
  }
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
    if (process.argv.includes('--make-evening')) return makeEvening(arg('--date', 'latest'), arg('--out', 'out/ig'));
    if (process.argv.includes('--post-evening')) return postEvening(arg('--date', istToday()), { dry: process.argv.includes('--dry'), force: process.argv.includes('--force') });
    if (process.argv.includes('--make')) return make(arg('--date', 'latest'), arg('--out', 'out/ig'));
    if (process.argv.includes('--post')) return post(arg('--date', istToday()), { dry: process.argv.includes('--dry'), force: process.argv.includes('--force') });
    console.log('use --make, --post, --stats or --check');
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
