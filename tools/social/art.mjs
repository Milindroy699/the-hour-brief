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

// Backgrounds for the app and the posts (owner, 2026-11-25: "cool image backgrounds for day mode and story cards as well as
// post images and specific backgrounds, like the day's quiz"). Quiet, textural, no subject in the middle, so text sits on top.
//   node tools/social/art.mjs --backgrounds [outDir]     three takes of each, portrait 9:16
const BG_GUARD = 'Abstract background only, no objects in focus, no people, no text, no letters, no numbers, no logos. Soft, calm, low contrast in the centre so text can sit on top.';
const BACKGROUNDS = {
  dawn: 'Early morning sky seen through soft watercolour washes, warm cream and peach at the bottom fading to pale lilac at the top, a faint golden sunrise glow, delicate paper grain, airy and fresh, editorial magazine feel.',
  midnight: 'Deep indigo night sky with very subtle violet nebula haze, a sparse scattering of tiny gold stars, faint gold constellation lines, fine film grain, quiet and premium, dark edges.',
  quiz: 'Vivid electric violet to deep indigo gradient with soft glowing geometric shapes, floating translucent circles and rounded squares like game pieces, subtle light rays, energetic but uncluttered, glossy, playful.',
  card: 'Dark midnight blue textured paper with very faint gold leaf flecks and a soft violet glow in one corner, minimal, elegant, like the inside cover of a luxury notebook.',
  post: 'Rich risograph print texture, deep violet and warm gold halftone gradient, soft grain, abstract waves of colour, bold but quiet, generous empty space, poster background.',
};
if (process.argv.includes('--backgrounds')) {
  const out = process.argv[process.argv.indexOf('--backgrounds') + 1] || 'backgrounds';
  fs.mkdirSync(out, { recursive: true });
  const report = [];
  for (const [name, look] of Object.entries(BACKGROUNDS)) {
    for (let k = 1; k <= 3; k++) {
      const file = path.join(out, `${name}-${k}.jpg`);
      try {
        const img = await generate(`${look} ${BG_GUARD}`, 'klein', { width: 864, height: 1536 });
        fs.writeFileSync(file, img);
        report.push({ file: path.basename(file), ok: true, bytes: img.length });
      } catch (e) { report.push({ file: path.basename(file), ok: false, error: String(e.message || e) }); }
      console.log(JSON.stringify(report[report.length - 1]));
    }
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  if (!report.some((r) => r.ok)) process.exit(1);
}

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
