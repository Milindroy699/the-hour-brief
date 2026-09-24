// Minimal Sarvam Bulbul text-to-speech client (REST). Returns WAV bytes.
const URL_TTS = 'https://api.sarvam.ai/text-to-speech';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(key, body) {
  const res = await fetch(URL_TTS, {
    method: 'POST',
    headers: { 'api-subscription-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}

export async function synthesize(key, { text, speaker, pace = 1, temperature, model = 'bulbul:v3', sampleRate = 24000 }) {
  const base = { text, speaker, model, pace, speech_sample_rate: sampleRate };
  if (temperature != null) base.temperature = temperature;
  let langField = 'language_code';                     // the docs disagree between two names; fall back once
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await call(key, { ...base, [langField]: 'en-IN' });
    if (r.status === 200) {
      const json = JSON.parse(r.text);
      if (!json.audios || !json.audios.length) throw new Error('Sarvam returned no audio');
      return json.audios.map((b64) => Buffer.from(b64, 'base64'));
    }
    if (r.status === 422 && langField === 'language_code' && /language_code|target_language_code/i.test(r.text)) { langField = 'target_language_code'; continue; }
    if (r.status === 429 || r.status >= 500) { await sleep(1500 * attempt); continue; }
    throw new Error(`Sarvam ${r.status}: ${r.text.slice(0, 300)}`);
  }
  throw new Error('Sarvam kept failing after retries');
}
