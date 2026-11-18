// Reads a voiceover script aloud with Sarvam, in the same voice as the app's Listen recordings: one WAV per segment,
// so a video can time each scene to its line. Used by .github/workflows/voiceover.yml (the key lives in GitHub secrets).
//   node tools/audio/voiceover.mjs tools/audio/voiceover/walkthrough.json out/
import fs from 'node:fs';
import path from 'node:path';
import { synthesize } from './sarvam.mjs';

const [file, out] = process.argv.slice(2);
if (!file || !out) { console.error('usage: voiceover.mjs <script.json> <outDir>'); process.exit(1); }
const KEY = process.env.SARVAM_API_KEY;
if (!KEY) { console.error('SARVAM_API_KEY is not set'); process.exit(1); }
const { voice = 'neha', pace = 1.1, segments = [] } = JSON.parse(fs.readFileSync(file, 'utf8'));
fs.mkdirSync(out, { recursive: true });
for (const s of segments) {
  const audios = await synthesize(KEY, { text: s.text, speaker: voice, pace });
  fs.writeFileSync(path.join(out, `${s.id}.wav`), audios[0]);
  console.log(`${s.id}: ${audios[0].length} bytes`);
}
