// Tests for the Sarvam credit tracker and its alerts (credit.mjs, credit.sh) and for the "no credit" failure marker.
// Nothing here touches Sarvam, R2 or GitHub: `aws` and `gh` are stand-ins that record what they were asked to do.   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { charge, load, perDay, set, status } from '../credit.mjs';
import { toneWav } from '../wav.mjs';

const run = promisify(execFile);
const DIR = path.resolve(import.meta.dirname, '..');
const tmpdir = (n) => fs.mkdtempSync(path.join(os.tmpdir(), n));

test('setting a balance starts a clean estimate; nothing is tracked until one is set', () => {
  assert.equal(charge(null, { chars: 6000 }), null);
  assert.deepEqual(status(null), { tracked: false, low: false });
  const l = set(null, 300);
  assert.equal(l.balance, 300);
  assert.deepEqual(l.history, []);
  assert.throws(() => set(null, -5), /balance/);
  assert.throws(() => set(null, NaN), /balance/);
});

test('each recording subtracts its cost at ₹3 per 1,000 characters', () => {
  let l = set(null, 300);
  l = charge(l, { chars: 6000, date: '2026-09-26', id: 'run1' });
  assert.equal(l.balance, 282);
  l = charge(l, { chars: 5754, date: '2026-09-27', id: 'run2' });
  assert.equal(l.balance, 264.74);
  assert.equal(l.history.length, 2);
});

test('the same workflow run reported twice is charged once', () => {
  let l = set(null, 300);
  l = charge(l, { chars: 6000, date: '2026-09-26', id: 'run1' });
  l = charge(l, { chars: 6000, date: '2026-09-26', id: 'run1' });
  assert.equal(l.balance, 282);
});

test('days left uses the recent daily spend; a day recorded twice counts as one day', () => {
  let l = set(null, 100);
  assert.equal(perDay(l), 18);                                       // no history yet: a normal day
  l = charge(l, { chars: 6000, date: '2026-09-26', id: 'a' });
  l = charge(l, { chars: 6000, date: '2026-09-26', id: 'b' });       // re-recorded the same day
  l = charge(l, { chars: 3000, date: '2026-09-27', id: 'c' });
  assert.equal(perDay(l), 22.5);                                     // (36 + 9) / 2 days
  assert.equal(status(l).daysLeft, Math.floor(l.balance / 22.5));
});

test('low means under the rupee level or under the days level, and not before', () => {
  assert.equal(status(set(null, 500)).low, false);
  assert.equal(status(set(null, 99)).low, true);                      // under ₹100
  assert.equal(status(set(null, 120), { low: 100, minDays: 5 }).low, false);      // 120 / 18 = 6 days
  assert.equal(status(set(null, 120), { low: 100, minDays: 7 }).low, true);       // under 7 days
  assert.equal(status(set(null, 0)).low, true);
});

test('a new balance keeps the recent history (so days-left stays realistic after a top-up)', () => {
  let l = set(null, 50);
  l = charge(l, { chars: 6000, date: '2026-09-26', id: 'a' });
  const topped = set(l, 400);
  assert.equal(topped.balance, 400);
  assert.equal(topped.history.length, 1);
});

test('the command line writes the ledger file and signals a low balance with exit code 10', async () => {
  const f = path.join(tmpdir('hb-cr-'), 'l.json');
  await run('node', ['credit.mjs', 'set', '--file', f, '--balance', '300'], { cwd: DIR });
  assert.equal(load(f).balance, 300);
  const ok = await run('node', ['credit.mjs', 'status', '--file', f], { cwd: DIR });
  assert.equal(JSON.parse(ok.stdout).low, false);
  await run('node', ['credit.mjs', 'set', '--file', f, '--balance', '40'], { cwd: DIR });
  await assert.rejects(run('node', ['credit.mjs', 'status', '--file', f], { cwd: DIR }), (e) => e.code === 10 && JSON.parse(e.stdout).low === true);
  await assert.rejects(run('node', ['credit.mjs', 'set', '--file', f, '--balance', 'abc'], { cwd: DIR }), (e) => e.code === 1);
});

// ---- the shell script, end to end, with stand-ins for aws and gh ----
function stage() {
  const bucket = tmpdir('hb-crb-'), bin = tmpdir('hb-crbin-'), log = path.join(tmpdir('hb-crlog-'), 'gh.log');
  fs.writeFileSync(path.join(bin, 'aws'), `#!/usr/bin/env bash
# "aws s3 cp SRC DST ...": s3://bucket/key <-> local file, the bucket being a folder
[ "$1" = s3 ] && [ "$2" = cp ] || exit 2
src="$3"; dst="$4"
if [[ "$src" == s3://* ]]; then f="$FAKE_BUCKET/\${src#s3://*/}"; [ -f "$f" ] || exit 1; cp "$f" "$dst"; else mkdir -p "$(dirname "$FAKE_BUCKET/\${dst#s3://*/}")"; cp "$src" "$FAKE_BUCKET/\${dst#s3://*/}"; fi
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env bash
# records every call; "issue list" answers from $FAKE_ISSUES (a JSON array of {number,title}) through the same -q filter the script passes
echo "gh $*" >> "$GH_LOG"
case "$1 $2" in
  "issue list") q=""; while [ $# -gt 0 ]; do [ "$1" = -q ] && q="$2"; shift; done; echo "\${FAKE_ISSUES:-[]}" | jq -r "$q" ;;
  "issue create") echo "https://github.com/x/y/issues/7" ;;
  *) : ;;
esac
`, { mode: 0o755 });
  return { bucket, bin, log };
}
const sh = (st, args, env = {}, cwdFiles = null) => run('bash', ['credit.sh', ...args], { cwd: DIR, env: { ...process.env, PATH: `${st.bin}:${process.env.PATH}`, FAKE_BUCKET: st.bucket, GH_LOG: st.log, R2_BUCKET: 'b', R2_ENDPOINT: 'http://unused', GH_TOKEN: 'x', GITHUB_RUN_ID: '4242', ...env } })
  .then((r) => ({ code: 0, out: r.stdout + r.stderr }), (e) => ({ code: e.code, out: (e.stdout || '') + (e.stderr || '') }));
const ghCalls = (st) => (fs.existsSync(st.log) ? fs.readFileSync(st.log, 'utf8') : '');
const ledger = (st) => JSON.parse(fs.readFileSync(path.join(st.bucket, '_ledger/sarvam.json'), 'utf8'));
// A finished recording as the generator leaves it: out/audio/<date>/manifest.json with the character count
function recorded(chars, date = '2026-09-26') {
  const d = path.join(DIR, 'out/audio', date);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ date, modes: { quick: { chars } } }));
}
const clean = () => fs.rmSync(path.join(DIR, 'out'), { recursive: true, force: true });

test('credit.sh set stores the balance in the bucket and reports it', async () => {
  const st = stage();
  const r = await sh(st, ['set', '300']);
  assert.equal(r.code, 0, r.out);
  assert.equal(ledger(st).balance, 300);
  assert.match(r.out, /"balance":300/);
});

test('credit.sh charge subtracts the run just recorded and stays quiet while the balance is healthy', async () => {
  const st = stage();
  await sh(st, ['set', '300']);
  recorded(5754);
  try {
    const r = await sh(st, ['charge']);
    assert.equal(r.code, 0, r.out);
    assert.equal(ledger(st).balance, 300 - 17.26);
    assert.equal(ledger(st).history[0].id, '4242');
    assert.ok(!/issue create/.test(ghCalls(st)), 'no alert expected');
  } finally { clean(); }
});

test('credit.sh charge opens ONE alert that mentions the owner when the estimate is low', async () => {
  const st = stage();
  await sh(st, ['set', '105']);
  recorded(6000);
  try {
    const r = await sh(st, ['charge'], { ALERT_MENTION: '@someone' });
    assert.equal(r.code, 0, r.out);
    const calls = ghCalls(st);
    assert.match(calls, /label create sarvam-credit/);
    assert.match(calls, /issue create --label sarvam-credit --title Sarvam voice credit is running low \(about ₹87 left, ~4 days\)/);
    assert.match(calls, /@someone the daily AI-voice recording/);
    // an alert is already open: a later run does not open another one
    fs.writeFileSync(st.log, '');
    const again = await sh(st, ['charge'], { FAKE_ISSUES: '[{"number":7,"title":"Sarvam voice credit is running low (about ₹87 left, ~4 days)"}]', GITHUB_RUN_ID: '4243' });
    assert.equal(again.code, 0, again.out);
    assert.match(again.out, /already open/);
    assert.ok(!/issue create/.test(ghCalls(st)));
  } finally { clean(); }
});

test('credit.sh charge does nothing (and does not fail) when no balance was ever set, or nothing was recorded', async () => {
  const st = stage();
  recorded(6000);
  try {
    const r = await sh(st, ['charge']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /No balance has been set/);
    assert.ok(!fs.existsSync(path.join(st.bucket, '_ledger/sarvam.json')));
    await sh(st, ['set', '300']);
  } finally { clean(); }
  const none = await sh(st, ['charge']);
  assert.equal(none.code, 0, none.out);
  assert.match(none.out, /nothing to charge/);
  assert.equal(ledger(st).balance, 300);
});

test('credit.sh alert ran-out opens an alert that names the missed edition, once', async () => {
  const st = stage();
  const r = await sh(st, ['alert', 'ran-out', '2026-09-27']);
  assert.equal(r.code, 0, r.out);
  assert.match(ghCalls(st), /issue create --label sarvam-credit --title Sarvam voice credit has run out: the recording for 2026-09-27 failed/);
  assert.match(ghCalls(st), /no credit left/);
  fs.writeFileSync(st.log, '');
  const again = await sh(st, ['alert', 'ran-out', '2026-09-28'], { FAKE_ISSUES: '[{"number":7,"title":"Sarvam voice credit has run out: the recording for 2026-09-27 failed"}]' });
  assert.match(again.out, /already open/);
  assert.ok(!/issue create/.test(ghCalls(st)));
});

test('credit.sh set closes an open alert once the new balance is healthy, and leaves it open if it is still low', async () => {
  const st = stage();
  const open = { FAKE_ISSUES: '[{"number":7,"title":"x"}]' };
  const still = await sh(st, ['set', '50'], open);
  assert.equal(still.code, 0, still.out);
  assert.ok(!/issue close/.test(ghCalls(st)));
  const fine = await sh(st, ['set', '400'], open);
  assert.equal(fine.code, 0, fine.out);
  assert.match(ghCalls(st), /issue close 7 --comment Balance updated to about ₹400/);
});

test('credit.sh alert test opens and immediately closes a test issue', async () => {
  const st = stage();
  const r = await sh(st, ['alert', 'test']);
  assert.equal(r.code, 0, r.out);
  assert.match(ghCalls(st), /issue create --label sarvam-credit --title TEST: Sarvam credit alert/);
  assert.match(ghCalls(st), /issue close https:\/\/github.com\/x\/y\/issues\/7/);
});

// ---- the generator leaves a marker when Sarvam says there is no credit ----
async function fakeSarvam(status, body) {
  const server = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(body); }); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
const generate = (url, out) => run('node', ['generate.mjs', '--date', '2026-09-24', '--out', out], { cwd: DIR, env: { ...process.env, SARVAM_URL: url, SARVAM_API_KEY: 'k' } })
  .then(() => ({ code: 0 }), (e) => ({ code: e.code, err: e.stderr }));

test('when Sarvam says "No credits available" the run exits 3 and leaves error.json saying so', async () => {
  const s = await fakeSarvam(402, '{"error":{"message":"No credits available. Please top up."}}');
  const out = tmpdir('hb-gen-');
  try {
    const r = await generate(s.url, out);
    assert.equal(r.code, 3, r.err);
    const e = JSON.parse(fs.readFileSync(path.join(out, 'error.json'), 'utf8'));
    assert.equal(e.code, 'no_credit');
    assert.equal(e.date, '2026-09-24');
  } finally { s.server.close(); }
});

test('any other failure exits 1 and is recorded as a plain error (no false "out of credit" alarm)', async () => {
  const s = await fakeSarvam(400, '{"error":"bad speaker"}');
  const out = tmpdir('hb-gen-');
  try {
    const r = await generate(s.url, out);
    assert.equal(r.code, 1, r.err);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'error.json'), 'utf8')).code, 'error');
  } finally { s.server.close(); }
});
