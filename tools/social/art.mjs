// Story illustrations from an open image model on Cloudflare Workers AI (owner, 2026-11-25: "automatic", open source).
// The art goes inside our own post templates (headline band, logo), so the prompts ask for no text at all: open models
// spell badly, and the headline is set in our fonts instead.
//
//   node tools/social/art.mjs --samples [outDir]   one picture per (story, style, model): to choose the house style
//
// Needs CLOUDFLARE_API_TOKEN (Workers AI) and CLOUDFLARE_ACCOUNT_ID (falls back to R2_ACCOUNT_ID, the same account).
// Free allowance: 10,000 neurons a day; FLUX.1 schnell costs a few dozen per picture.
import fs from 'node:fs';
import path from 'node:path';

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;

export const MODELS = {
  schnell: '@cf/black-forest-labs/flux-1-schnell',
  klein: '@cf/black-forest-labs/flux-2-klein-4b',
};

// Candidate house styles. Each ends with the same guard: no words, no logos, no real faces.
const GUARD = 'No text, no letters, no numbers, no logos, no watermarks, no recognisable real people.';
export const STYLES = {
  riso: 'Editorial risograph illustration, limited palette of deep violet, warm gold and cream, visible grain and slight misregistration, bold simple shapes, generous negative space, centred composition.',
  watercolor: 'Luminous watercolour and gold-leaf editorial illustration on a warm cream background, soft pastel washes with fine gold line accents, airy and premium like a magazine cover, centred subject.',
  clay: 'Soft 3D clay render, isometric miniature scene, matte materials, violet and gold palette with cream background, gentle studio lighting, playful and minimal, centred subject.',
};

export async function generate(prompt, model = 'schnell', opts = {}) {
  if (!TOKEN || !ACCOUNT) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (or R2_ACCOUNT_ID) are needed');
  const id = MODELS[model] || model;
  const body = model === 'schnell' ? { prompt, steps: opts.steps || 6 } : { prompt, width: opts.width || 1024, height: opts.height || 1024 };
  let res, form = null;
  if (model !== 'schnell') {                     // FLUX.2 models on Workers AI take multipart form data
    form = new FormData();
    for (const [k, v] of Object.entries(body)) form.append(k, String(v));
  }
  res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${id}`, {
    method: 'POST',
    headers: form ? { Authorization: `Bearer ${TOKEN}` } : { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: form || JSON.stringify(body),
  });
  const type = res.headers.get('content-type') || '';
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  if (type.startsWith('image/')) return Buffer.from(await res.arrayBuffer());
  const j = await res.json();
  const b64 = j?.result?.image || j?.image;
  if (!b64) throw new Error(`${id}: no image in the reply: ${JSON.stringify(j).slice(0, 300)}`);
  return Buffer.from(b64, 'base64');
}

// The subject of a story, as a picture (no names, no words): written by hand for the samples; the daily job will write them.
const SAMPLE_STORIES = [
  ['nvidia-ceo', 'a lone chess king piece made of glowing circuit boards returning to the centre of a boardroom table, empty chairs around it'],
  ['startup-funding', 'small green seedlings growing out of stacks of coins on a desk, a paper rocket launching gently above them, India map faintly in the background'],
  ['markets-fall', 'a stock ticker line drawn as a ribbon tumbling down a staircase, a small umbrella sheltering a coin at the bottom'],
];

if (process.argv.includes('--samples')) {
  const out = process.argv[process.argv.indexOf('--samples') + 1] || 'art-samples';
  fs.mkdirSync(out, { recursive: true });
  const report = [];
  for (const [sid, subject] of SAMPLE_STORIES) {
    for (const [st, style] of Object.entries(STYLES)) {
      for (const model of Object.keys(MODELS)) {
        const prompt = `${subject}. ${style} ${GUARD}`;
        const file = path.join(out, `${sid}--${st}--${model}.jpg`);
        const t0 = Date.now();
        try {
          const img = await generate(prompt, model);
          fs.writeFileSync(file, img);
          report.push({ file: path.basename(file), ok: true, ms: Date.now() - t0, bytes: img.length });
        } catch (e) {
          report.push({ file: path.basename(file), ok: false, error: String(e.message || e) });
        }
        console.log(JSON.stringify(report[report.length - 1]));
      }
    }
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  if (!report.some((r) => r.ok)) process.exit(1);
}
