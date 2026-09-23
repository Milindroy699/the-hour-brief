// Link-preview images (1200x630 PNG). Stateless: everything drawn comes from the query string,
// so results are deterministic and cache forever at the edge. Falls back to the static card on error.
// Rendered with satori (layout to SVG) + resvg (SVG to PNG); fonts are read from /fonts.
import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const W = 1200;
const H = 630;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LANES = {
  ai: { label: 'AI & TECH', fg: '#206b5a', bg: '#e0ede9' },
  biz: { label: 'BUSINESS', fg: '#a3721f', bg: '#f3e9d5' },
  mkt: { label: 'MARKETS', fg: '#2c5490', bg: '#e2e9f2' },
};

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

const wordmark = () => h({ alignItems: 'center', gap: 14, fontSize: 44, fontWeight: 700, letterSpacing: -0.5 }, [
  h({ color: '#f2f3ee' }, 'THE HOUR'),
  h({ color: '#a487d9' }, 'BRIEF'),
]);

const chip = (lane) => {
  const l = LANES[lane] || LANES.ai;
  return h({ padding: '6px 16px', borderRadius: 8, background: l.bg, color: l.fg, fontSize: 22, fontWeight: 700, letterSpacing: 1 }, l.label);
};

function frame(date, body) {
  return h({ width: '100%', height: '100%', flexDirection: 'column', background: '#17191c', padding: '50px 64px 0 64px', fontFamily: 'Inter, InterExt', color: '#f2f3ee' }, [
    h({ justifyContent: 'space-between', alignItems: 'center', width: '100%' }, [
      wordmark(),
      h({ fontSize: 28, fontWeight: 400, color: '#9ba3a6' }, pretty(date)),
    ]),
    h({ flexDirection: 'column', flex: 1, justifyContent: 'center', width: '100%' }, body),
    h({ justifyContent: 'space-between', alignItems: 'center', width: '100%', paddingBottom: 38, fontSize: 26, color: '#9ba3a6', fontWeight: 400 }, [
      h({}, 'the-hour-brief.vercel.app'),
      h({ color: '#a487d9', fontWeight: 700 }, 'Free · no sign-up'),
    ]),
    h({ position: 'absolute', left: 0, bottom: 0, width: '100%', height: 14, background: '#5b3e96' }, undefined),
  ]);
}

function editionCard(q) {
  const rows = ['ai', 'biz', 'mkt'].map((k) => {
    const t = clip(q.get(k), 118);
    return t ? h({ alignItems: 'flex-start', gap: 22, marginTop: 22 }, [
      h({ width: 168, flexShrink: 0 }, chip(k)),
      h({ flex: 1, fontSize: 28, lineHeight: 1.3, fontWeight: 400, color: '#e6e8e3' }, t),
    ]) : null;
  }).filter(Boolean);
  const n = q.get('n');
  return frame(q.get('d'), [
    h({ fontSize: 30, fontWeight: 700, color: '#a487d9', letterSpacing: 2 }, n ? `EDITION ${String(n).padStart(3, '0')}` : 'DAILY DIGEST'),
    h({ fontSize: 50, fontWeight: 700, lineHeight: 1.1, marginTop: 8 }, 'Everything that mattered today'),
    ...(rows.length ? rows : [h({ fontSize: 30, marginTop: 24, color: '#c8ccc8', fontWeight: 400 }, 'AI & tech, product & business, and the markets — in one sitting.')]),
  ]);
}

function storyCard(q) {
  const headline = clip(q.get('h'), 150) || 'The Hour Brief';
  const size = headline.length <= 60 ? 64 : headline.length <= 90 ? 56 : headline.length <= 130 ? 48 : 42;
  const take = clip(q.get('t'), 160);
  return frame(q.get('d'), [
    h({}, chip(q.get('lane'))),
    h({ fontSize: size, fontWeight: 700, lineHeight: 1.15, marginTop: 24, letterSpacing: -0.5 }, headline),
    take ? h({ marginTop: 24, borderLeft: '6px solid #5b3e96', paddingLeft: 22, fontSize: 30, lineHeight: 1.35, color: '#c8ccc8', fontWeight: 400 }, take) : h({}, undefined),
  ]);
}

function quizCard(q) {
  const total = Math.min(10, Math.max(1, parseInt(q.get('total'), 10) || 5));
  const score = Math.min(total, Math.max(0, parseInt(q.get('score'), 10) || 0));
  const sq = (q.get('sq') || '').replace(/[^01]/g, '').slice(0, total);
  const squares = sq.length === total
    ? h({ gap: 16, marginTop: 6 }, sq.split('').map((c) => h({ width: 76, height: 76, borderRadius: 14, background: c === '1' ? '#4fb579' : '#d9645f' }, undefined)))
    : h({}, undefined);
  return frame(q.get('d'), [
    h({ fontSize: 30, fontWeight: 700, color: '#a487d9', letterSpacing: 2 }, 'DAILY QUIZ'),
    h({ alignItems: 'center', gap: 36, marginTop: 6 }, [
      h({ fontSize: 60, fontWeight: 700, lineHeight: 1.1, width: 470 }, 'Can you beat my score?'),
      h({ fontSize: 210, fontWeight: 700, letterSpacing: -6, lineHeight: 1 }, `${score}/${total}`),
    ]),
    squares,
  ]);
}

function leagueCard(q) {
  return frame('', [
    h({ fontSize: 30, fontWeight: 700, color: '#a487d9', letterSpacing: 2 }, 'FRIENDS LEAGUE'),
    h({ fontSize: 84, fontWeight: 700, lineHeight: 1.05, marginTop: 10 }, 'Join my league'),
    h({ fontSize: 54, fontWeight: 700, color: '#a487d9', marginTop: 14 }, clip(q.get('name'), 40) || 'Play with friends'),
    h({ fontSize: 32, fontWeight: 400, color: '#c8ccc8', marginTop: 24, lineHeight: 1.35 }, 'A 5-question daily news quiz. Beat your friends, keep your streak.'),
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
    ];
  }
  return fontCache;
}

export default async function handler(req, res) {
  try {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const type = q.get('type');
    const card = type === 'story' ? storyCard(q) : type === 'quiz' ? quizCard(q) : type === 'league' ? leagueCard(q) : editionCard(q);
    const svg = await satori(card, { width: W, height: H, fonts: loadFonts() });
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
    res.status(200).send(Buffer.from(png));
  } catch (e) {
    res.setHeader('Location', '/og-image.png');
    res.status(302).end();
  }
}
