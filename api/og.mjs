// Link-preview images (1200x630 PNG; type=status is a 1080x1920 status card). Stateless: everything drawn comes from the query string,
// so results are deterministic and cache forever at the edge. Falls back to the static card on error.
// Rendered with satori (layout to SVG) + resvg (SVG to PNG); fonts are read from /fonts, the logo from /brand.
// Look: the app's navy + violet + green (see app.css), Newsreader headlines, Space Grotesk labels, Inter body.
import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const W = 1200;
const H = 630;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const C = { bg: '#0c0d15', ink: '#ffffff', soft: '#a6a8c4', body: '#dcdcf0', violet: '#8b6cf6', bar: '#5e43f3', green: '#7fdcbf', greenBg: 'rgba(127,220,191,0.14)', lav: '#b9acff', lavBg: 'rgba(139,108,246,0.18)' };
const LANES = {
  ai: { label: 'AI & TECH' },
  biz: { label: 'BUSINESS' },
  mkt: { label: 'MARKETS' },
};
const SERIF = 'Newsreader, NewsreaderExt, Inter, InterExt';
const LABEL = 'SpaceGrotesk, SpaceGroteskExt, Inter, InterExt';

const h = (style, children) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children } });

function clip(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  return s.slice(0, n).replace(/\s+\S*$/, '') + '…';
}

function pretty(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  if (!m) return '';
  const wd = DAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  return `${wd} ${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
}

let logoCache = null;
function logoSrc() {
  if (!logoCache) logoCache = 'data:image/png;base64,' + fs.readFileSync(path.join(process.cwd(), 'brand', 'logo-256.png')).toString('base64');
  return logoCache;
}
const logo = (size) => ({ type: 'img', props: { src: logoSrc(), width: size, height: size, style: { borderRadius: Math.round(size * 0.24) } } });

const wordmark = (size = 40) => h({ alignItems: 'center', gap: 14, fontFamily: LABEL, fontSize: size, fontWeight: 700, letterSpacing: -1 }, [
  h({ color: C.ink }, 'THE HOUR'),
  h({ color: C.violet }, 'BRIEF'),
]);

const pill = (text, fg = C.green, bg = C.greenBg) =>
  h({ padding: '8px 18px', borderRadius: 999, background: bg, color: fg, fontFamily: LABEL, fontSize: 21, fontWeight: 700, letterSpacing: 1.5 }, text);
const chip = (lane) => pill((LANES[lane] || LANES.ai).label);

function frame(date, body) {
  return h({ width: '100%', height: '100%', flexDirection: 'column', background: C.bg, backgroundImage: 'radial-gradient(circle at 12% 0%, rgba(94,67,243,0.30), rgba(12,13,21,0) 55%)', padding: '46px 64px 0 64px', fontFamily: 'Inter, InterExt', color: C.ink }, [
    h({ justifyContent: 'space-between', alignItems: 'center', width: '100%' }, [
      h({ alignItems: 'center', gap: 18 }, [logo(64), wordmark(38)]),
      h({ fontSize: 27, fontWeight: 400, color: C.soft }, pretty(date)),
    ]),
    h({ flexDirection: 'column', flex: 1, justifyContent: 'center', width: '100%' }, body),
    h({ justifyContent: 'space-between', alignItems: 'center', width: '100%', paddingBottom: 38, fontSize: 25, color: C.soft, fontWeight: 400 }, [
      h({}, 'the-hour-brief.vercel.app'),
      h({ color: C.lav, fontWeight: 700 }, 'Free · no sign-up'),
    ]),
    h({ position: 'absolute', left: 0, bottom: 0, width: '100%', height: 14, background: C.bar }, undefined),
  ]);
}

// The generic brand card (also written to /og-image.png by tools/brand/og.mjs)
function brandCard() {
  return h({ width: '100%', height: '100%', flexDirection: 'column', justifyContent: 'center', background: C.bg, backgroundImage: 'radial-gradient(circle at 20% 15%, rgba(94,67,243,0.34), rgba(12,13,21,0) 60%)', padding: '0 84px', fontFamily: 'Inter, InterExt', color: C.ink }, [
    h({ alignItems: 'center', gap: 40 }, [
      logo(190),
      h({ flexDirection: 'column', gap: 4 }, [
        wordmark(88),
        h({ fontFamily: SERIF, fontWeight: 400, fontSize: 40, lineHeight: 1.25, color: C.body, marginTop: 14 }, 'Sixty minutes. Three lanes.'),
        h({ fontFamily: SERIF, fontWeight: 400, fontSize: 40, lineHeight: 1.25, color: C.soft }, 'Everything that actually mattered today.'),
      ]),
    ]),
    h({ gap: 14, marginTop: 52 }, [pill('AI & TECH'), pill('PRODUCT & BUSINESS'), pill('STOCK MARKET'), pill('DAILY QUIZ', C.lav, C.lavBg)]),
    h({ position: 'absolute', left: 0, bottom: 0, width: '100%', height: 14, background: C.bar }, undefined),
  ]);
}

function editionCard(q) {
  const rows = ['ai', 'biz', 'mkt'].map((k) => {
    const t = clip(q.get(k), 118);
    return t ? h({ alignItems: 'flex-start', gap: 22, marginTop: 22 }, [
      h({ width: 168, flexShrink: 0 }, chip(k)),
      h({ flex: 1, fontSize: 28, lineHeight: 1.3, fontWeight: 400, color: C.body }, t),
    ]) : null;
  }).filter(Boolean);
  const n = q.get('n');
  return frame(q.get('d'), [
    h({ fontFamily: LABEL, fontSize: 28, fontWeight: 700, color: C.lav, letterSpacing: 3 }, n ? `EDITION ${String(n).padStart(3, '0')}` : 'DAILY DIGEST'),
    h({ fontFamily: SERIF, fontSize: 58, fontWeight: 500, lineHeight: 1.1, marginTop: 8, letterSpacing: -1 }, 'Everything that mattered today'),
    ...(rows.length ? rows : [h({ fontSize: 30, marginTop: 24, color: C.body, fontWeight: 400 }, 'AI & tech, product & business, and the markets — in one sitting.')]),
  ]);
}

function storyCard(q) {
  const headline = clip(q.get('h'), 150) || 'The Hour Brief';
  const size = headline.length <= 60 ? 64 : headline.length <= 90 ? 56 : headline.length <= 130 ? 48 : 42;
  const take = clip(q.get('t'), 160);
  return frame(q.get('d'), [
    h({}, chip(q.get('lane'))),
    h({ fontFamily: SERIF, fontSize: size + 4, fontWeight: 500, lineHeight: 1.12, marginTop: 24, letterSpacing: -1 }, headline),
    take ? h({ marginTop: 24, borderLeft: `6px solid ${C.bar}`, paddingLeft: 22, fontSize: 30, lineHeight: 1.35, color: C.body, fontWeight: 400 }, take) : h({}, undefined),
  ]);
}

function quizCard(q) {
  const total = Math.min(10, Math.max(1, parseInt(q.get('total'), 10) || 5));
  const score = Math.min(total, Math.max(0, parseInt(q.get('score'), 10) || 0));
  const sq = (q.get('sq') || '').replace(/[^01]/g, '').slice(0, total);
  const squares = sq.length === total
    ? h({ gap: 16, marginTop: 6 }, sq.split('').map((c) => h({ width: 76, height: 76, borderRadius: 14, background: c === '1' ? '#3fbf95' : '#e5645f' }, undefined)))
    : h({}, undefined);
  return frame(q.get('d'), [
    h({ fontFamily: LABEL, fontSize: 28, fontWeight: 700, color: C.lav, letterSpacing: 3 }, 'DAILY QUIZ'),
    h({ alignItems: 'center', gap: 36, marginTop: 6 }, [
      h({ fontFamily: SERIF, fontSize: 64, fontWeight: 500, lineHeight: 1.1, width: 470, letterSpacing: -1 }, 'Can you beat my score?'),
      h({ fontFamily: SERIF, fontSize: 210, fontWeight: 500, letterSpacing: -6, lineHeight: 1 }, `${score}/${total}`),
    ]),
    squares,
  ]);
}

function leagueCard(q) {
  return frame('', [
    h({ fontFamily: LABEL, fontSize: 28, fontWeight: 700, color: C.lav, letterSpacing: 3 }, 'FRIENDS LEAGUE'),
    h({ fontFamily: SERIF, fontSize: 90, fontWeight: 500, lineHeight: 1.05, marginTop: 10, letterSpacing: -2 }, 'Join my league'),
    h({ fontFamily: LABEL, fontSize: 52, fontWeight: 700, color: C.violet, marginTop: 14 }, clip(q.get('name'), 40) || 'Play with friends'),
    h({ fontSize: 32, fontWeight: 400, color: C.body, marginTop: 24, lineHeight: 1.35 }, 'A 5-question daily news quiz. Beat your friends, keep your streak.'),
  ]);
}

// WhatsApp/Instagram status card, 1080x1920 (9:16) — the daily post kit's image (see social/README.md).
// WhatsApp draws its own UI over roughly the top and bottom 220px, so everything that matters sits between.
const SW = 1080;
const SH = 1920;
function statusCard(q) {
  const insight = clip(q.get('i'), 190) || 'Everything that mattered today, in one sitting.';
  const size = insight.length <= 70 ? 92 : insight.length <= 110 ? 80 : insight.length <= 150 ? 70 : 62;
  const n = q.get('n');
  const lane = LANES[q.get('lane')] ? q.get('lane') : null;
  return h({ width: '100%', height: '100%', flexDirection: 'column', background: C.bg, backgroundImage: 'radial-gradient(circle at 15% 8%, rgba(94,67,243,0.38), rgba(12,13,21,0) 55%), radial-gradient(circle at 95% 95%, rgba(127,220,191,0.12), rgba(12,13,21,0) 45%)', padding: '240px 84px 260px 84px', fontFamily: 'Inter, InterExt', color: C.ink }, [
    h({ alignItems: 'center', gap: 22 }, [logo(92), wordmark(50)]),
    h({ flexDirection: 'column', flex: 1, justifyContent: 'center' }, [
      h({ alignItems: 'center', gap: 16 }, [
        pill(clip(q.get('k'), 28).toUpperCase() || 'TODAY’S INSIGHT', C.lav, C.lavBg),
        lane ? chip(lane) : h({}, undefined),
      ]),
      h({ marginTop: 44, borderLeft: `10px solid ${C.bar}`, paddingLeft: 40, fontFamily: SERIF, fontSize: size, fontWeight: 500, lineHeight: 1.16, letterSpacing: -1.5 }, insight),
      h({ marginTop: 48, fontSize: 34, color: C.soft, fontWeight: 400 }, n ? `Edition ${String(n).padStart(3, '0')} · ${pretty(q.get('d'))}` : pretty(q.get('d'))),
    ]),
    h({ flexDirection: 'column', gap: 12 }, [
      h({ fontFamily: LABEL, fontSize: 40, fontWeight: 700, color: C.ink }, 'Read the full brief'),
      h({ fontSize: 34, color: C.green, fontWeight: 700 }, 'the-hour-brief.vercel.app'),
      h({ fontSize: 30, color: C.soft, fontWeight: 400 }, 'Free app on iPhone & Android'),
    ]),
  ]);
}

let fontCache = null;
function loadFonts() {
  if (!fontCache) {
    const read = (f) => fs.readFileSync(path.join(process.cwd(), 'fonts', f));
    fontCache = [
      { name: 'Inter', data: read('inter-latin-700-normal.woff'), weight: 700, style: 'normal' },
      { name: 'InterExt', data: read('inter-latin-ext-700-normal.woff'), weight: 700, style: 'normal' },
      { name: 'Inter', data: read('inter-latin-400-normal.woff'), weight: 400, style: 'normal' },
      { name: 'InterExt', data: read('inter-latin-ext-400-normal.woff'), weight: 400, style: 'normal' },
      { name: 'Newsreader', data: read('newsreader-latin-500-normal.woff'), weight: 500, style: 'normal' },
      { name: 'NewsreaderExt', data: read('newsreader-latin-ext-500-normal.woff'), weight: 500, style: 'normal' },
      { name: 'Newsreader', data: read('newsreader-latin-400-normal.woff'), weight: 400, style: 'normal' },
      { name: 'SpaceGrotesk', data: read('space-grotesk-latin-700-normal.woff'), weight: 700, style: 'normal' },
      { name: 'SpaceGroteskExt', data: read('space-grotesk-latin-ext-700-normal.woff'), weight: 700, style: 'normal' },
    ];
  }
  return fontCache;
}

export { brandCard, loadFonts };

export default async function handler(req, res) {
  try {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const type = q.get('type');
    const card = type === 'story' ? storyCard(q) : type === 'quiz' ? quizCard(q) : type === 'league' ? leagueCard(q) : type === 'brand' ? brandCard() : type === 'status' ? statusCard(q) : editionCard(q);
    const [w, ht] = type === 'status' ? [SW, SH] : [W, H];
    const svg = await satori(card, { width: w, height: ht, fonts: loadFonts() });
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: w } }).render().asPng();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
    res.status(200).send(Buffer.from(png));
  } catch (e) {
    res.setHeader('Location', '/og-image.png');
    res.status(302).end();
  }
}
