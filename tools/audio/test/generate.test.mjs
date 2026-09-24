// Runs generate.mjs against a fake Sarvam server: no credit is used.  node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { toneWav } from '../wav.mjs';

const DIR = path.resolve(import.meta.dirname, '..');
function fakeSarvam({ quirks = true } = {}) {
  const seen = { requests: [], hits: 0 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => body += d);
    req.on('end', () => {
      if (req.method === 'HEAD') { res.writeHead(200); res.end(); return; }
      seen.hits++;
      const j = JSON.parse(body || '{}');
      seen.requests.push({ ...j, key: req.headers['api-subscription-key'] });
      if (quirks && seen.hits === 1) { res.writeHead(429); res.end('{"error":"slow down"}'); return; }                       // first call is rate limited
      if (quirks && !j.target_language_code && j.language_code) { res.writeHead(422); res.end('{"error":"target_language_code is required"}'); return; }   // this API wants the older field name
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ request_id: 'x', audios: [toneWav(Math.max(1, j.text.length / 15)).toString('base64')] }));
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}
// Must be async: the fake server lives in this process, so a blocking spawn would deadlock it.
const run = (args, env) => new Promise((resolve) => execFile('node', ['generate.mjs', ...args], { cwd: DIR, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 120000 },
  (err, stdout, stderr) => resolve({ status: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })));

test('generates one MP3 and a consistent manifest, using the configured voice and pace', async () => {
  const { server, seen, url } = await fakeSarvam();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-gen-'));
  const r = await run(['--date', '2026-09-23', '--out', out], { SARVAM_URL: url + '/text-to-speech', SARVAM_API_KEY: 'test-key' });
  server.close();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const dir = path.join(out, 'audio', '2026-09-23');
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(m.voice, 'neha'); assert.equal(m.pace, 1.4); assert.equal(m.date, '2026-09-23');
  const q = m.modes.quick;
  assert.match(q.file, /^quick\.[0-9a-f]{8}\.mp3$/);
  assert.ok(fs.existsSync(path.join(dir, q.file)) && q.bytes > 100000);
  assert.ok(q.cues.length >= 20 && q.cues[0].id === 'intro' && q.cues.at(-1).id === 'outro');
  q.cues.forEach((c, i) => { assert.ok(c.end > c.start); if (i) assert.ok(c.start >= q.cues[i - 1].end, 'cues must not overlap'); });
  assert.ok(Math.abs(q.cues.at(-1).end - q.duration) < 0.5, `last cue ends at ${q.cues.at(-1).end}, file is ${q.duration}s`);
  assert.ok(seen.requests.every((x) => x.speaker === 'neha' && x.pace === 1.4 && x.model === 'bulbul:v3' && x.key === 'test-key' && x.text.length <= 2500));
  assert.ok(seen.requests.some((x) => x.target_language_code === 'en-IN'), 'fell back to target_language_code after the 422');
  assert.ok(seen.hits > q.cues.length, 'the 429 and 422 were retried');
});

test('a different voice and pace can be requested', async () => {
  const { server, seen, url } = await fakeSarvam({ quirks: false });
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-gen-'));
  const r = await run(['--date', '2026-09-23', '--out', out, '--voice', 'rohan', '--pace', '1.1'], { SARVAM_URL: url, SARVAM_API_KEY: 'k' });
  server.close();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(seen.requests.every((x) => x.speaker === 'rohan' && x.pace === 1.1));
});

test('refuses to spend when the script is far longer than a normal day', async () => {
  const { server, seen, url } = await fakeSarvam({ quirks: false });
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-gen-'));
  const r = await run(['--date', '2026-09-23', '--out', out], { SARVAM_URL: url, SARVAM_API_KEY: 'k', AUDIO_MAX_CHARS_QUICK: '1000' });
  server.close();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Refusing to run/);
  assert.equal(seen.hits, 0, 'no paid request may be made');
});

test('--skip-existing does nothing when the manifest is already published', async () => {
  const { server, seen, url } = await fakeSarvam({ quirks: false });
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-gen-'));
  const r = await run(['--date', '2026-09-23', '--out', out, '--skip-existing'], { SARVAM_URL: url, SARVAM_API_KEY: 'k', R2_PUBLIC_URL: url });
  server.close();
  assert.equal(r.status, 0);
  assert.match(r.stdout, /already exists/);
  assert.equal(seen.hits, 0);
  assert.equal(fs.existsSync(path.join(out, 'audio')), false);
});

test('fails clearly when the key is missing', async () => {
  const r = await run(['--date', '2026-09-23', '--out', fs.mkdtempSync(path.join(os.tmpdir(), 'hb-gen-'))], { SARVAM_API_KEY: '' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SARVAM_API_KEY/);
});
