// Voice bake-off: reads the same real excerpt of today's edition in several Sarvam voices and
// writes MP3s plus a page with labelled players. `--dry` swaps the API for tones (no cost).
//   node voice-test.mjs [--dry] [--out out] [--edition ../../index.html]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildUnits, editionMeta, splitForApi } from './script.mjs';
import { synthesize } from './sarvam.mjs';

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const DRY = process.argv.includes('--dry');
const OUT = path.resolve(arg('--out', 'out'));
const EDITION = path.resolve(arg('--edition', '../../index.html'));
const KEY = process.env.SARVAM_API_KEY;
if (!DRY && !KEY) { console.error('SARVAM_API_KEY is not set'); process.exit(1); }

const VOICES = [
  { speaker: 'priya', label: 'Female · priya' }, { speaker: 'ritu', label: 'Female · ritu' }, { speaker: 'kavya', label: 'Female · kavya' },
  { speaker: 'shubh', label: 'Male · shubh (Sarvam default)' }, { speaker: 'aditya', label: 'Male · aditya' }, { speaker: 'rahul', label: 'Male · rahul' },
];
const PACE = Number(arg('--pace', '1'));

// A representative ~1,000 character excerpt: intro, the markets lane opener and two market stories, one AI story.
function excerpt(html) {
  const units = buildUnits(html, 'quick');
  const pick = [units[0]];
  const mkt = units.findIndex((u) => u.id === 'lane:mkt');
  if (mkt >= 0) pick.push(units[mkt], ...units.slice(mkt + 1).filter((u) => u.kind === 'story').slice(0, 2));
  const ai = units.find((u) => u.id === 'story:ai-1');
  if (ai) pick.push(ai);
  let text = '', used = [];
  for (const u of pick) { if (text && (text + ' ' + u.text).length > 1250) break; text = text ? text + ' ' + u.text : u.text; used.push(u.id); }
  return { text, used };
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const html = fs.readFileSync(EDITION, 'utf8');
const meta = editionMeta(html);
const { text, used } = excerpt(html);
console.log(`Excerpt from edition ${meta.number} (${meta.date}): ${text.length} characters, units: ${used.join(', ')}`);
console.log(text + '\n');
if (text.length > 2400) throw new Error('excerpt too long for one request');

const rows = [];
for (const v of VOICES) {
  const wav = path.join(OUT, v.speaker + '.wav');
  const mp3 = path.join(OUT, v.speaker + '.mp3');
  if (DRY) {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${300 + rows.length * 60}:duration=4`, wav]);
  } else {
    const parts = await synthesize(KEY, { text, speaker: v.speaker, pace: PACE });
    fs.writeFileSync(wav, Buffer.concat(parts.length === 1 ? parts : parts));   // one request => one WAV
  }
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', wav, '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '64k', mp3]);
  fs.rmSync(wav);
  const secs = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', mp3]).toString().trim());
  rows.push({ ...v, file: v.speaker + '.mp3', secs });
  console.log(`${v.label}: ${secs.toFixed(1)}s, ${(fs.statSync(mp3).size / 1024).toFixed(0)} KB`);
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Voice test</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:0 auto;padding:20px;background:#f2f3ee;color:#17191c}
h1{font-size:1.3rem}.card{background:#fff;border:1px solid #d7dad2;border-radius:12px;padding:12px 14px;margin:12px 0}.card b{display:block;margin-bottom:6px}audio{width:100%}
blockquote{margin:12px 0;padding:10px 14px;border-left:3px solid #5b3e96;background:#fff;color:#52585a;font-size:.92rem}small{color:#838a8a}</style></head><body>
<h1>Voice test · same excerpt, ${rows.length} Sarvam voices</h1>
<p>Edition ${meta.number} (${meta.date}) · pace ${PACE} · ${DRY ? 'DRY RUN (tones, not speech)' : 'bulbul:v3, en-IN'}. Listen for: ₹ / crore / lakh, NSE, Nifty, names, GPT, and how it feels over a whole morning.</p>
<blockquote>${esc(text)}</blockquote>
${rows.map((r) => `<div class="card"><b>${esc(r.label)} <small>· ${r.secs.toFixed(0)}s</small></b><audio controls preload="none" src="${r.file}"></audio></div>`).join('\n')}
</body></html>`);
console.log(`\nCharacters sent per voice: ${text.length}; about ₹${(text.length * VOICES.length * 3 / 1000).toFixed(0)} in total at ₹3 per 1,000 characters`);
