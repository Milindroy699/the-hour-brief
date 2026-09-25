// Daily audio: edition page -> spoken script -> Sarvam TTS per unit -> one MP3 per mode + a manifest of cues.
//   node generate.mjs [--date latest|YYYY-MM-DD] [--modes quick[,full]] [--voice neha] [--pace 1.4]
//                     [--out out] [--dry] [--force] [--skip-existing]
// Output: <out>/audio/<date>/<mode>.<hash>.mp3 and <out>/audio/<date>/manifest.json (the manifest is uploaded last,
// so its presence means the audio is complete). The player reads the manifest for story start/end times.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildUnits, editionMeta, splitForApi } from './script.mjs';
import { synthesize } from './sarvam.mjs';
import { silenceWav, toneWav } from './wav.mjs';

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const flag = (name) => process.argv.includes(name);
const ROOT = path.resolve(import.meta.dirname, '../..');
const DATE_ARG = arg('--date', 'latest');
const MODES = arg('--modes', 'quick').split(',').map((m) => m.trim()).filter(Boolean);
const VOICE = arg('--voice', process.env.AUDIO_VOICE || 'neha');
const PACE = Number(arg('--pace', process.env.AUDIO_PACE || '1.4'));
const OUT = path.resolve(arg('--out', 'out'));
const DRY = flag('--dry');
const MAX_CHARS = { quick: Number(process.env.AUDIO_MAX_CHARS_QUICK || 14000), full: Number(process.env.AUDIO_MAX_CHARS_FULL || 32000) };      // hard stop on runaway spend (a normal day is ~6,000 and ~17,700)
const RUPEES_PER_1K = 3;
const CONCURRENCY = 3;
const KEY = process.env.SARVAM_API_KEY;

const ff = (args) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
const duration = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]).toString().trim());
const round = (n) => Math.round(n * 100) / 100;

const htmlFile = DATE_ARG === 'latest' ? path.join(ROOT, 'index.html') : path.join(ROOT, 'archive', `${DATE_ARG}.html`);
if (!fs.existsSync(htmlFile)) { console.error(`No edition page at ${htmlFile}`); process.exit(1); }
const html = fs.readFileSync(htmlFile, 'utf8');
const meta = editionMeta(html);
if (!meta.date) { console.error('Could not read the edition date from the page'); process.exit(1); }
console.log(`Edition ${meta.number} (${meta.date}) · voice ${VOICE} · pace ${PACE} · modes ${MODES.join(',')}${DRY ? ' · DRY RUN' : ''}`);

if (flag('--skip-existing') && !flag('--force') && process.env.R2_PUBLIC_URL) {
  const res = await fetch(`${process.env.R2_PUBLIC_URL}/audio/${meta.date}/manifest.json`, { method: 'HEAD' });
  if (res.ok) { console.log('Audio for this edition already exists; nothing to do.'); process.exit(0); }
}
if (!DRY && !KEY) { console.error('SARVAM_API_KEY is not set'); process.exit(1); }

// Runs `fn` over items with a small worker pool, keeping results in order.
async function pool(items, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }));
  return results;
}

async function speak(text) {
  const parts = splitForApi(text);
  const wavs = [];
  for (const part of parts) {
    if (DRY) { wavs.push(toneWav(Math.max(1, part.length / 15))); continue; }
    const audios = await synthesize(KEY, { text: part, speaker: VOICE, pace: PACE });
    wavs.push(audios[0]);
  }
  return wavs;
}

// If the run dies, leave a note the workflow can act on (e.g. open an alert when Sarvam says there is no credit left).
function died(e) {
  console.error(String((e && e.stack) || e));
  try { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'error.json'), JSON.stringify({ code: e && e.noCredit ? 'no_credit' : 'error', message: String((e && e.message) || e).slice(0, 300), date: meta.date })); } catch (x) { /* nothing more to do */ }
  process.exit(e && e.noCredit ? 3 : 1);
}
process.on('unhandledRejection', died);
process.on('uncaughtException', died);

const outDir = path.join(OUT, 'audio', meta.date);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const manifest = { v: 1, date: meta.date, edition: meta.number, voice: VOICE, model: 'bulbul:v3', pace: PACE, generated: new Date().toISOString(), modes: {} };
let totalChars = 0;

for (const mode of MODES) {
  const units = buildUnits(html, mode);
  const chars = units.reduce((n, u) => n + u.text.length, 0);
  if (chars > MAX_CHARS[mode]) { console.error(`Refusing to run: ${mode} script is ${chars} characters (limit ${MAX_CHARS[mode]}).`); process.exit(1); }
  totalChars += chars;
  console.log(`${mode}: ${units.length} units, ${chars} characters (about ₹${(chars * RUPEES_PER_1K / 1000).toFixed(0)})`);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), `hb-audio-${mode}-`));
  const norm = await pool(units, async (u, i) => {
    const raw = path.join(work, `raw-${i}.wav`), file = path.join(work, `u${i}.wav`);
    const wavs = await speak(u.text);
    if (wavs.length === 1) fs.writeFileSync(raw, wavs[0]);
    else {                                             // long unit answered in parts: join them
      const list = wavs.map((w, k) => { const f = path.join(work, `raw-${i}-${k}.wav`); fs.writeFileSync(f, w); return `file '${f}'`; }).join('\n');
      fs.writeFileSync(path.join(work, `l-${i}.txt`), list);
      ff(['-f', 'concat', '-safe', '0', '-i', path.join(work, `l-${i}.txt`), '-c', 'copy', raw]);
    }
    ff(['-i', raw, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', file]);   // one consistent format for joining
    return { file, secs: duration(file) };
  });

  // Join units with short pauses; a longer one before each new section and the sign-off.
  const gaps = {};
  const gapFile = (s) => gaps[s] || (gaps[s] = (() => { const f = path.join(work, `gap-${s}.wav`); fs.writeFileSync(f, silenceWav(s)); return f; })());
  const lines = [], cues = [];
  let at = 0;
  units.forEach((u, i) => {
    cues.push({ id: u.id, kind: u.kind, lane: u.lane, title: u.title, start: round(at), end: round(at + norm[i].secs) });
    lines.push(`file '${norm[i].file}'`);
    at += norm[i].secs;
    const next = units[i + 1];
    if (next) { const g = next.kind === 'lane' || next.kind === 'outro' ? 0.8 : 0.45; lines.push(`file '${gapFile(g)}'`); at += g; }
  });
  fs.writeFileSync(path.join(work, 'list.txt'), lines.join('\n'));
  const mp3 = path.join(outDir, `${mode}.mp3`);
  ff(['-f', 'concat', '-safe', '0', '-i', path.join(work, 'list.txt'),
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '44100', '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '64k',
    '-metadata', `title=The Hour Brief · ${meta.date}`, '-metadata', 'artist=The Hour Brief', mp3]);
  const secs = duration(mp3);
  // A content hash in the name lets the file be cached "forever": regenerated audio gets a new URL.
  const hash = crypto.createHash('sha1').update(fs.readFileSync(mp3)).digest('hex').slice(0, 8);
  const named = `${mode}.${hash}.mp3`;
  fs.renameSync(mp3, path.join(outDir, named));
  manifest.modes[mode] = { file: named, duration: round(secs), bytes: fs.statSync(path.join(outDir, named)).size, chars, cues };
  console.log(`${named}: ${(secs / 60).toFixed(1)} min, ${(manifest.modes[mode].bytes / 1048576).toFixed(1)} MB`);
  fs.rmSync(work, { recursive: true, force: true });
}

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest));
console.log(`Done. ${totalChars} characters, about ₹${(totalChars * RUPEES_PER_1K / 1000).toFixed(0)}. Files in ${outDir}`);
