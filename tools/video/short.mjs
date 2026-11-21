// Daily vertical short (YouTube Shorts / Instagram Reels / WhatsApp status video): "3 things that mattered today".
//
// Built only from what already exists each morning, so it costs nothing extra: the morning recording (R2 audio/<date>/
// manifest.json + the Quick mp3, made by .github/workflows/audio.yml) and the edition page. It cuts the intro and the three
// section takeaways out of the narration (the manifest has each one's start and end), draws one 1080x1920 frame per caption
// line with satori + resvg (the share-image renderer, same fonts), ends on an app card, and joins it all with ffmpeg.
// Captions are the exact narrated text; the recording has timings per section, not per word, so within a section each line
// is shown for a time proportional to its length.
//
//   node short.mjs --date YYYY-MM-DD|latest [--out DIR] [--audio-base URL]
//     writes DIR/<date>.mp4, DIR/<date>.jpg (cover) and DIR/<date>.json (titles and captions ready to post)
// Needs ffmpeg. Run from anywhere; reads the edition from the repo (archive/<date>.html, or index.html for the latest).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { createHash } from 'node:crypto';
import { buildUnits, editionMeta } from '../audio/script.mjs';
import { synthesize } from '../audio/sarvam.mjs';

const REPO = path.resolve(import.meta.dirname, '../..');
const SITE = 'https://the-hour-brief.vercel.app';
const AUDIO_BASE_DEFAULT = 'https://pub-1dafea4a948540db8413a044895e083c.r2.dev';
const WHATSAPP = 'https://whatsapp.com/channel/0029Vb9RU0kCXC3F1pRY6q2L';
const TELEGRAM = 'https://t.me/thehourbrief';
const SPOTIFY = 'https://open.spotify.com/show/1FjOE5ABaOEzUTxwJeaoYr';
const APPLE = 'https://podcasts.apple.com/us/podcast/the-hour-brief/id6837406304';
const AMAZON = 'https://music.amazon.com/podcasts/191ea61e-41ab-4d99-aa47-012a56027de9/the-hour-brief';
const W = 1080, H = 1920;
const LANES = [['ai', 'AI & Tech'], ['biz', 'Business'], ['mkt', 'Markets']];
const C = { bg: '#0c0d15', ink: '#ffffff', soft: '#c9c5ea', faint: '#8e8ab0', violet: '#8b6cf6', violetDeep: '#5e43f3', line: 'rgba(255,255,255,0.14)' };
const END_SECONDS = 3.5;                    // the silent end card, only if the spoken outro is not available
// The spoken outro, in the day's voice: one clip per end card, so each card lasts exactly as long as its sentence. The words
// never change, so each clip is recorded once (Sarvam, about ₹1 in all) and kept on R2 as shorts/outro-<hash>.mp3; a new voice,
// pace or wording gets a new hash and is recorded again. Places listed in `also` must match what is really live.
export const OUTRO = [
  { kind: 'app', say: 'That’s today’s brief in a minute. For every story and the full audio, get the free Hour Brief app, on iPhone and Android.' },
  { kind: 'also', say: 'You can also listen on Spotify, Apple Podcasts and Amazon Music, and get the brief every morning on WhatsApp and Telegram.', also: ['Spotify', 'Apple Podcasts', 'Amazon Music', 'WhatsApp', 'Telegram'] },
  { kind: 'bye', say: 'Search The Hour Brief, or tap the link. See you tomorrow.' },
];
const OUTRO_GAP = 0.35;                      // a breath between the last takeaway and the outro

// ---- reading the edition ----
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–', hellip: '…', rarr: '→' };
export function text(html) {
  return String(html || '').replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m))
    .replace(/\s+/g, ' ').trim();
}
const clip = (s, n) => { s = String(s || '').trim(); return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…'; };
export function leadHeadlines(html) {
  const out = {};
  for (const [id] of LANES) {
    const sec = (new RegExp(`<section class="lane ${id}" id="${id}">([\\s\\S]*?)</section>`).exec(html) || [])[1] || '';
    out[id] = text((/<h3>([\s\S]*?)<\/h3>/.exec(sec) || [])[1]);
  }
  return out;
}

// Caption lines: at most `max` characters, broken at word boundaries, preferring to end a line at punctuation.
export function captionLines(t, max = 44) {
  const words = String(t).replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (next.length > max && cur) { lines.push(cur); cur = w; }
    else { cur = next; if (/[.,;:!?—]$/.test(w) && cur.length > max * 0.55) { lines.push(cur); cur = ''; } }
  }
  if (cur) lines.push(cur);
  return lines;
}
// Spread a segment's duration over its lines by length (with a floor so short lines still register).
export function timeLines(lines, seconds) {
  const weight = lines.map((l) => l.length + 10);
  const total = weight.reduce((a, b) => a + b, 0);
  return lines.map((l, i) => ({ text: l, dur: (seconds * weight[i]) / total }));
}

// ---- drawing a frame (satori elements) ----
const el = (type, style, children) => ({ type, props: { style: { display: 'flex', ...style }, children } });
const img = (src, size, style = {}) => ({ type: 'img', props: { src, width: size, height: size, style: { borderRadius: size * 0.22, ...style } } });
let LOGO = null;
const logo = () => (LOGO ||= 'data:image/png;base64,' + fs.readFileSync(path.join(REPO, 'brand', 'logo-256.png')).toString('base64'));
function fonts() {
  const read = (f) => fs.readFileSync(path.join(REPO, 'fonts', f));
  return [
    { name: 'Inter', data: read('inter-latin-700-normal.woff'), weight: 700, style: 'normal' },
    { name: 'InterExt', data: read('inter-latin-ext-700-normal.woff'), weight: 700, style: 'normal' },
    { name: 'Inter', data: read('inter-latin-400-normal.woff'), weight: 400, style: 'normal' },
    { name: 'InterExt', data: read('inter-latin-ext-400-normal.woff'), weight: 400, style: 'normal' },
    { name: 'Newsreader', data: read('newsreader-latin-500-normal.woff'), weight: 500, style: 'normal' },
    { name: 'NewsreaderExt', data: read('newsreader-latin-ext-500-normal.woff'), weight: 500, style: 'normal' },
    { name: 'SpaceGrotesk', data: read('space-grotesk-latin-700-normal.woff'), weight: 700, style: 'normal' },
    { name: 'SpaceGroteskExt', data: read('space-grotesk-latin-ext-700-normal.woff'), weight: 700, style: 'normal' },
  ];
}
const SANS = 'Inter, InterExt', SERIF = 'Newsreader, NewsreaderExt', LABEL = 'SpaceGrotesk, SpaceGroteskExt';

function frameShell(children, { glow = '50% 0%' } = {}) {
  // Instagram and YouTube cover the bottom ~380px (caption, buttons) and a strip on the right: nothing important goes there.
  return el('div', {
    width: W, height: H, flexDirection: 'column', padding: '120px 96px 400px 80px', backgroundColor: C.bg,
    backgroundImage: `radial-gradient(circle at ${glow}, rgba(94,67,243,0.55), rgba(12,13,21,0) 62%)`, color: C.ink, fontFamily: SANS,
  }, children);
}
function masthead(when) {
  return el('div', { alignItems: 'center', gap: 26 }, [
    img(logo(), 92),
    el('div', { flexDirection: 'column' }, [
      el('div', { fontFamily: LABEL, fontSize: 40, letterSpacing: 1, fontWeight: 700 }, [el('span', {}, 'THE HOUR\u00a0'), el('span', { color: C.violet }, 'BRIEF')]),
      el('div', { fontSize: 30, color: C.soft }, when),
    ]),
  ]);
}
function progress(active) {
  return el('div', { gap: 14, marginTop: 56 }, [0, 1, 2].map((i) => el('div', { flexGrow: 1, height: 10, borderRadius: 5, backgroundColor: i <= active ? C.violet : C.line })));
}
function caption(line) {
  return el('div', { backgroundColor: 'rgba(255,255,255,0.09)', borderRadius: 30, padding: '34px 40px', border: `2px solid ${C.line}` },
    [el('div', { fontSize: 62, fontWeight: 700, lineHeight: 1.22 }, line)]);
}

export function introFrame({ when, edition, line }) {
  return frameShell([
    masthead(when),
    el('div', { flexGrow: 0.6 }),
    el('div', { fontFamily: LABEL, fontSize: 34, color: C.violet, letterSpacing: 2 }, edition ? `EDITION ${String(edition).padStart(3, '0')}` : 'TODAY'),
    el('div', { fontFamily: SERIF, fontSize: 112, lineHeight: 1.04, marginTop: 18, fontWeight: 500 }, '3 things that mattered today'),
    el('div', { fontSize: 36, color: C.soft, marginTop: 26 }, 'AI & Tech · Business · Markets'),
    el('div', { height: 70 }),
    caption(line),
    el('div', { flexGrow: 0.4 }),
  ], { glow: '50% 40%' });
}
export function laneFrame({ when, index, label, headline, line }) {
  return frameShell([
    masthead(when),
    progress(index),
    el('div', { flexGrow: 0.55 }),
    el('div', {}, [el('div', { fontFamily: LABEL, fontSize: 34, letterSpacing: 2, color: '#fff', backgroundColor: C.violetDeep, padding: '12px 24px', borderRadius: 999 }, `${index + 1} / 3 · ${label.toUpperCase()}`)]),
    el('div', { fontFamily: SERIF, fontSize: 70, lineHeight: 1.13, marginTop: 30, fontWeight: 500 }, clip(headline, 120)),
    el('div', { height: 64 }),
    caption(line),
    el('div', { flexGrow: 0.45 }),
  ]);
}
const APPLE_PATH = 'M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.9-.8-3.1-.8C6.8 7.4 5.3 8.3 4.5 9.8c-1.7 2.9-.4 7.2 1.2 9.6.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8s1.9.8 3.1.8c1.3 0 2.1-1.2 2.9-2.4.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.7-1-2.7-4.1zM14.2 5.6c.6-.8 1.1-1.9 1-3-1 0-2.1.6-2.8 1.4-.6.7-1.1 1.8-1 2.9 1.1.1 2.1-.5 2.8-1.3z';
const PLAY_PATH = 'M3.6 2.3c-.3.3-.4.7-.4 1.2v17c0 .5.1.9.4 1.2l9.6-9.7-9.6-9.7zm10.6 10.7l2.9 2.9-11.2 6.4c-.4.2-.8.3-1.1.2l9.4-9.5zm4-4l3 1.7c.9.5.9 1.3 0 1.8l-3 1.7-3.2-3.2 3.2-2zM5.1 1.9c.4-.1.7 0 1.1.2l11.2 6.4-2.9 2.9-9.4-9.5z';
const icon = (d, size = 46) => ({ type: 'svg', props: { width: size, height: size, viewBox: '0 0 24 24', fill: '#fff', children: { type: 'path', props: { d } } } });
const storeBadge = (d, small, big) => el('div', { alignItems: 'center', gap: 18, backgroundColor: '#000', border: '2px solid rgba(255,255,255,0.35)', borderRadius: 22, padding: '18px 30px' },
  [icon(d), el('div', { flexDirection: 'column' }, [el('div', { fontSize: 24, color: C.soft }, small), el('div', { fontSize: 40, fontWeight: 700 }, big)])]);
const DOT = { Spotify: '#1ed760', WhatsApp: '#25d366', Telegram: '#2aabee', 'Apple Podcasts': '#b150e2', 'YouTube Music': '#ff0033', 'Amazon Music': '#25d1da', JioSaavn: '#2bc5b4' };
const chip = (name) => el('div', { alignItems: 'center', gap: 18, backgroundColor: 'rgba(255,255,255,0.08)', border: `2px solid ${C.line}`, borderRadius: 999, padding: '20px 34px' },
  [el('div', { width: 22, height: 22, borderRadius: 11, backgroundColor: DOT[name] || C.violet }), el('div', { fontSize: 44, fontWeight: 700 }, name)]);

// The outro's three cards (kind: app, also, bye), shown while each sentence is spoken.
export function outroFrame({ when, kind, also = [] }) {
  if (kind === 'app') {
    return frameShell([
      masthead(when),
      el('div', { flexGrow: 0.6 }),
      el('div', { justifyContent: 'center' }, [img(logo(), 200, { boxShadow: '0 0 80px rgba(139,108,246,0.6)' })]),
      el('div', { fontFamily: SERIF, fontSize: 88, lineHeight: 1.06, marginTop: 50, fontWeight: 500, justifyContent: 'center', textAlign: 'center' }, 'Every story + the full audio'),
      el('div', { fontSize: 40, color: C.soft, marginTop: 22, justifyContent: 'center', textAlign: 'center' }, 'Free app · iPhone & Android'),
      el('div', { justifyContent: 'center', gap: 22, marginTop: 50 }, [storeBadge(APPLE_PATH, 'Download on the', 'App Store'), storeBadge(PLAY_PATH, 'Get it on', 'Google Play')]),
      el('div', { flexGrow: 0.4 }),
    ], { glow: '50% 42%' });
  }
  if (kind === 'also') {
    return frameShell([
      masthead(when),
      el('div', { flexGrow: 0.6 }),
      el('div', { fontFamily: LABEL, fontSize: 36, color: C.violet, letterSpacing: 3, justifyContent: 'center' }, 'ALSO ON'),
      el('div', { fontFamily: SERIF, fontSize: 84, lineHeight: 1.08, marginTop: 20, fontWeight: 500, justifyContent: 'center', textAlign: 'center' }, 'Listen, or get it every morning'),
      el('div', { flexDirection: 'column', alignItems: 'center', gap: 24, marginTop: 56 }, also.map(chip)),
      el('div', { flexGrow: 0.4 }),
    ], { glow: '50% 45%' });
  }
  return frameShell([
    masthead(when),
    el('div', { flexGrow: 0.6 }),
    el('div', { justifyContent: 'center' }, [img(logo(), 170)]),
    el('div', { fontFamily: SERIF, fontSize: 92, lineHeight: 1.06, marginTop: 46, fontWeight: 500, flexDirection: 'column', alignItems: 'center' }, [el('div', {}, 'Search'), el('div', {}, '“The Hour Brief”')]),
    el('div', { fontSize: 40, color: C.soft, marginTop: 24, justifyContent: 'center' }, 'the-hour-brief.vercel.app'),
    el('div', { justifyContent: 'center', marginTop: 46 }, [el('div', { fontFamily: LABEL, fontSize: 40, letterSpacing: 2, backgroundColor: C.violetDeep, padding: '18px 40px', borderRadius: 999 }, 'LINK IN BIO')]),
    el('div', { fontSize: 36, color: C.faint, marginTop: 40, justifyContent: 'center' }, 'See you tomorrow'),
    el('div', { flexGrow: 0.4 }),
  ], { glow: '50% 45%' });
}

// Each outro clip: from R2 if already recorded, else recorded now (needs SARVAM_API_KEY) and also written to `outDir` so the
// workflow can keep it. Returns null (and the short ends on the silent card) if a clip can't be had.
export const outroKey = (o, voice, pace) => createHash('sha1').update(JSON.stringify({ say: o.say, voice, pace, model: 'bulbul:v3' })).digest('hex').slice(0, 12);
async function outroAudio({ work, outDir, base, voice, pace }) {
  const clips = [];
  for (const o of OUTRO) {
    const name = `outro-${outroKey(o, voice, pace)}.mp3`, file = path.join(work, name);
    const r = await fetch(`${base}/shorts/${name}`).catch(() => null);
    if (r && r.ok) fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    else if (process.env.SARVAM_API_KEY) {
      const parts = await synthesize(process.env.SARVAM_API_KEY, { text: o.say, speaker: voice, pace });
      const wavs = parts.map((b, i) => { const f = path.join(work, `${name}.${i}.wav`); fs.writeFileSync(f, b); return f; });
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...wavs.flatMap((w) => ['-i', w]), '-filter_complex', `${wavs.map((_, i) => `[${i}:a]`).join('')}concat=n=${wavs.length}:v=0:a=1[a]`, '-map', '[a]', '-c:a', 'libmp3lame', '-b:a', '64k', file]);
      fs.mkdirSync(outDir, { recursive: true });
      fs.copyFileSync(file, path.join(outDir, name));
      console.log(`recorded outro clip ${name} (${o.kind})`);
    } else { console.warn(`no outro clip ${name} and no SARVAM_API_KEY: ending on the silent card`); return null; }
    const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
    clips.push({ ...o, file, dur });
  }
  return clips;
}

export function endFrame({ when }) {
  return frameShell([
    masthead(when),
    el('div', { flexGrow: 1 }),
    el('div', { justifyContent: 'center' }, [img(logo(), 220, { boxShadow: '0 0 80px rgba(139,108,246,0.6)' })]),
    el('div', { fontFamily: SERIF, fontSize: 92, lineHeight: 1.06, marginTop: 56, fontWeight: 500, justifyContent: 'center', textAlign: 'center' }, 'Get the full brief, free'),
    el('div', { fontSize: 40, color: C.soft, marginTop: 24, justifyContent: 'center', textAlign: 'center' }, 'The Hour Brief app · iPhone & Android'),
    el('div', { justifyContent: 'center', marginTop: 44 }, [el('div', { fontFamily: LABEL, fontSize: 40, letterSpacing: 2, backgroundColor: C.violetDeep, padding: '18px 40px', borderRadius: 999 }, 'LINK IN BIO')]),
    el('div', { fontSize: 32, color: C.faint, marginTop: 40, justifyContent: 'center', textAlign: 'center' }, 'Every morning on WhatsApp and Telegram'),
  ], { glow: '50% 45%' });
}

async function render(node, file, f) {
  const svg = await satori(node, { width: W, height: H, fonts: f });
  fs.writeFileSync(file, new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng());
}

// ---- the short ----
export function plan({ manifest, html }) {
  const q = manifest && manifest.modes && manifest.modes.quick;
  if (!q || !Array.isArray(q.cues)) throw new Error('no Quick recording in the manifest');
  const units = Object.fromEntries(buildUnits(html, 'quick').map((u) => [u.id, u]));
  const cues = Object.fromEntries(q.cues.map((c) => [c.id, c]));
  const heads = leadHeadlines(html);
  const want = ['intro', ...LANES.map(([id]) => `lane:${id}`)];
  const segs = [];
  want.forEach((id, k) => {
    const c = cues[id], u = units[id];
    if (!c || !u) return;
    const next = q.cues[q.cues.indexOf(c) + 1];
    const start = Math.max(0, c.start - 0.05), end = Math.min(c.end + 0.3, next ? next.start : c.end + 0.3);
    const lane = k ? LANES[k - 1] : null;
    // The narration starts each section with its name ("AI and Tech."): the chip already shows it, so it is not captioned twice.
    const spoken = lane ? u.text.replace(/^[^.]*\.\s*/, '') : u.text;
    const lines = timeLines(captionLines(spoken), end - start);
    if (lane && lines.length) lines[0] = { ...lines[0], text: lines[0].text };
    segs.push({ id, start, end, lane: lane ? { id: lane[0], label: lane[1], index: k - 1, headline: heads[lane[0]] } : null, lines });
  });
  if (segs.filter((s) => s.lane).length < 3) throw new Error('the recording does not have all three section takeaways');
  return { file: q.file, segs, duration: segs.reduce((a, s) => a + (s.end - s.start), 0) + END_SECONDS, heads };
}

export function postText({ date, edition, heads, when }) {
  const items = LANES.map(([id, label], i) => `${i + 1}. ${label}: ${heads[id]}`);
  const tags = '#Shorts #India #News #StockMarket #Sensex #Nifty #AI #Business';
  const lead = clip(heads.ai || heads.biz || heads.mkt, 62);
  return {
    youtube: {
      title: clip(`3 things that mattered today: ${lead}`, 92) + ' #Shorts',
      description: [`The Hour Brief${edition ? `, Edition ${edition}` : ''} · ${when}`, '', ...items, '',
        `Read the full brief and get the free app: ${SITE}/app?src=youtube-shorts`,
        `Listen on Spotify: ${SPOTIFY}`, `Apple Podcasts: ${APPLE}`, `Amazon Music: ${AMAZON}`, `Every morning on WhatsApp: ${WHATSAPP}`, `and Telegram: ${TELEGRAM}`, '', 'Narrated by an AI-generated voice. Not investment advice.', '', tags].join('\n'),
    },
    instagram: {
      caption: [`3 things that mattered today (${when}) 👇`, '', ...items, '',
        '📱 The full brief, read aloud, with a daily quiz: free app, link in bio.', '🎧 Also on Spotify · every morning on WhatsApp and Telegram.', 'Narrated by an AI-generated voice. Not investment advice.', '',
        tags.replace('#Shorts ', '#Reels ')].join('\n'),
    },
    whatsapp: `🎬 3 things that mattered today (${when})\n\nFull brief 👉 ${SITE}/e/${date}?src=whatsapp-video\n📱 Free app: ${SITE}/app?src=whatsapp-video`,
  };
}

async function main() {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
  let date = arg('--date', 'latest');
  const out = path.resolve(arg('--out', path.join(import.meta.dirname, 'out')));
  const base = (arg('--audio-base', process.env.R2_PUBLIC_URL || AUDIO_BASE_DEFAULT)).replace(/\/$/, '');
  if (date === 'latest') date = editionMeta(fs.readFileSync(path.join(REPO, 'index.html'), 'utf8')).date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('no edition date');
  const pagePath = [path.join(REPO, 'archive', `${date}.html`), path.join(REPO, 'index.html')].find((p) => fs.existsSync(p) && editionMeta(fs.readFileSync(p, 'utf8')).date === date);
  if (!pagePath) throw new Error(`no edition page for ${date}`);
  const html = fs.readFileSync(pagePath, 'utf8');
  const { number: edition } = editionMeta(html);
  const mres = await fetch(`${base}/audio/${date}/manifest.json`, { cache: 'no-store' });
  if (!mres.ok) throw new Error(`no recording for ${date} (manifest ${mres.status})`);
  const manifest = await mres.json();
  const p = plan({ manifest, html });
  const when = new Date(date + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'short-'));
  const mp3 = path.join(work, 'quick.mp3');
  const ares = await fetch(`${base}/audio/${date}/${p.file}`);
  if (!ares.ok) throw new Error(`audio ${p.file}: ${ares.status}`);
  fs.writeFileSync(mp3, Buffer.from(await ares.arrayBuffer()));

  // frames: one per caption line, then the end card
  const f = fonts();
  const list = [];
  let n = 0;
  for (const s of p.segs) {
    for (const ln of s.lines) {
      const file = path.join(work, `f${String(++n).padStart(3, '0')}.png`);
      await render(s.lane ? laneFrame({ when, index: s.lane.index, label: s.lane.label, headline: s.lane.headline, line: ln.text }) : introFrame({ when, edition, line: ln.text }), file, f);
      list.push({ file, dur: ln.dur });
    }
  }
  // the ending: the spoken outro over its three cards, or (no outro clips) the silent end card
  const outro = await outroAudio({ work, outDir: out, base, voice: manifest.voice || 'neha', pace: manifest.pace || 1.4 });
  let total = p.duration - END_SECONDS;
  if (outro) {
    for (const [k, o] of outro.entries()) {
      const file = path.join(work, `outro-${o.kind}.png`);
      await render(outroFrame({ when, kind: o.kind, also: o.also }), file, f);
      const dur = o.dur + (k === 0 ? OUTRO_GAP : 0) + (k === outro.length - 1 ? 0.8 : 0);   // a breath before, a beat after
      list.push({ file, dur });
      total += dur;
    }
  } else {
    const endFile = path.join(work, 'end.png');
    await render(endFrame({ when }), endFile, f);
    list.push({ file: endFile, dur: END_SECONDS });
    total += END_SECONDS;
  }
  const last = list[list.length - 1].file;
  fs.writeFileSync(path.join(work, 'frames.txt'), list.map((x) => `file '${x.file}'\nduration ${x.dur.toFixed(3)}`).join('\n') + `\nfile '${last}'\n`);

  // audio: the chosen sections, then the outro clips (inputs 2..), all at one format, padded to the video's length
  const norm = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono';
  const trims = p.segs.map((s, i) => `[1:a]atrim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},asetpts=PTS-STARTPTS,${norm}[a${i}]`);
  const labels = p.segs.map((_, i) => `[a${i}]`);
  if (outro) {
    trims.push(`aevalsrc=0:d=${OUTRO_GAP}:s=44100,${norm}[gap]`);
    labels.push('[gap]');
    outro.forEach((o, k) => { trims.push(`[${k + 2}:a]${norm},volume=4dB,alimiter=limit=0.97[o${k}]`); labels.push(`[o${k}]`); });   // the outro clips come out ~4 dB quieter than the day's narration
  }
  const join = labels.join('') + `concat=n=${labels.length}:v=0:a=1,apad=whole_dur=${total.toFixed(3)}[aout]`;
  fs.mkdirSync(out, { recursive: true });
  const mp4 = path.join(out, `${date}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(work, 'frames.txt'), '-i', mp3,
    ...(outro ? outro.flatMap((o) => ['-i', o.file]) : []),
    '-filter_complex', `${trims.join(';')};${join}`, '-map', '0:v', '-map', '[aout]',
    '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-tune', 'stillimage',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-t', total.toFixed(3), '-movflags', '+faststart', mp4]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', list[Math.min(1, list.length - 1)].file, '-q:v', '3', path.join(out, `${date}.jpg`)]);
  const probe = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).toString().trim());
  const meta = { v: 1, date, edition, audio: p.file, duration: Math.round(probe * 10) / 10, bytes: fs.statSync(mp4).size,
    video: `shorts/${date}.mp4`, cover: `shorts/${date}.jpg`, generated: new Date().toISOString(), ...postText({ date, edition, heads: p.heads, when }) };
  fs.writeFileSync(path.join(out, `${date}.json`), JSON.stringify(meta, null, 2));
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`short for ${date}: ${meta.duration}s, ${(meta.bytes / 1e6).toFixed(1)} MB, ${list.length} frames, ${outro ? 'spoken outro' : 'silent end card'} -> ${mp4}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error('short failed:', e.message); process.exit(1); });
}
