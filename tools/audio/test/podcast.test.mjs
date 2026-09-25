// Tests for the podcast feed (podcast.mjs). No Sarvam credit is used: the audio is a dry run (tones) made by generate.mjs --dry.
//   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import * as cheerio from 'cheerio';
import { buildFeed, checkFeedXml, collect, episodeFrom, esc, hms, sections, SHOW } from '../podcast.mjs';

const run = promisify(execFile);
const DIR = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(DIR, '../..');
const BASE = 'https://audio.example.test';
const FEED = 'https://audio.example.test/podcast.xml';

// Three days of dry-run audio: a recent edition (has section takeaways), and an old one (has none).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-pod-'));
for (const d of ['2026-09-24', '2026-09-23', '2026-09-10']) {
  execFileSync('node', ['generate.mjs', '--dry', '--date', d, '--out', tmp], { cwd: DIR, stdio: 'ignore' });
}
const AUDIO = path.join(tmp, 'audio');
const eps = () => collect(AUDIO, { repo: REPO, audioBase: BASE });

test('one episode per recorded day, newest first, keyed by a stable guid', () => {
  const list = eps();
  assert.equal(list.length, 3);
  const xml = buildFeed(list, { feedUrl: FEED });
  const $ = cheerio.load(xml, { xmlMode: true });
  const guids = $('item guid').map((_, g) => $(g).text()).get();
  assert.deepEqual(guids, ['hourbrief-2026-09-24', 'hourbrief-2026-09-23', 'hourbrief-2026-09-10']);
  assert.equal($('item').first().children('title').text(), 'Edition 039 · Thursday, 24 September 2026');
  assert.equal($('item').first().children('itunes\\:episode').text(), '39');
});

test('the feed passes every check Spotify and Apple care about, and is well-formed XML', () => {
  const xml = buildFeed(eps(), { feedUrl: FEED });
  assert.deepEqual(checkFeedXml(xml), []);
  const f = path.join(tmp, 'p.xml');
  fs.writeFileSync(f, xml);
  try { execFileSync('xmllint', ['--noout', f], { stdio: 'pipe' }); } catch (e) { if (e.code !== 'ENOENT') assert.fail(String(e.stderr)); }
});

test('the enclosure length is the real size of the file, and the duration is real', async () => {
  const list = eps();
  for (const e of list) {
    const file = path.join(AUDIO, e.date, e.url.split('/').pop());
    assert.equal(e.bytes, fs.statSync(file).size, `${e.date}: bytes`);
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
    assert.ok(Math.abs(Number(stdout) - e.duration) < 1, `${e.date}: duration`);
  }
  assert.match(hms(417), /^00:06:57$/);
  assert.equal(hms(3725), '01:02:05');
});

test('the description carries the day\'s takeaways, the source link and the AI-voice disclosure', () => {
  const e = eps().find((x) => x.date === '2026-09-24');
  assert.match(e.description, /^Your brief for Thursday, 24 September 2026, read aloud in about \d+ minutes?\./);
  assert.match(e.description, /AI & Tech: .{40,}/);
  assert.match(e.description, /Stock Market: .{40,}/);
  assert.match(e.description, /https:\/\/the-hour-brief\.vercel\.app\/archive\/2026-09-24\.html/);
  assert.match(e.description, /Narrated by Neha, an AI-generated voice\.$/);
});

test('an old edition with no takeaways falls back to each section\'s headline', () => {
  const e = eps().find((x) => x.date === '2026-09-10');
  assert.ok(sections(fs.readFileSync(path.join(REPO, 'archive/2026-09-10.html'), 'utf8')).length >= 3);
  assert.match(e.description, /AI & Tech: .{40,}/);
});

test('special characters are escaped and forbidden control characters are dropped', () => {
  assert.equal(esc(`a & b < c > "d" 'e' \u0001\u0008x`), 'a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos; x');
  const html = `<html><body><div class="edition">Edition 007</div><div data-edition-date="2026-09-01"></div>
    <section class="lane ai"><div class="lane-head"><span class="lane-tag">AI &amp; Tech</span><p class="lane-takeaway"><span class="takeaway-label">Takeaway</span> Cats & dogs <b>&lt;3</b> "quoted" \u0002 done.</p></div><div class="item" data-story-id="ai-1"><h3>x</h3></div></section></body></html>`;
  const manifest = { date: '2026-09-01', edition: 7, voice: 'neha', modes: { quick: { file: 'quick.abcdef12.mp3', bytes: 1000, duration: 61 } } };
  const ep = episodeFrom(manifest, html, { audioBase: BASE, site: SHOW.site });
  const xml = buildFeed([ep], { feedUrl: FEED });
  assert.deepEqual(checkFeedXml(xml), []);
  const $ = cheerio.load(xml, { xmlMode: true });
  assert.match($('item description').text(), /AI & Tech: Cats & dogs <3 "quoted"  done\./);
});

test('recording a day again (a new audio file) updates that episode instead of adding a second one', () => {
  const dup = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-pod2-'));
  fs.cpSync(AUDIO, dup, { recursive: true });
  const mf = path.join(dup, '2026-09-24', 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  m.modes.quick.file = 'quick.deadbeef.mp3';
  fs.writeFileSync(mf, JSON.stringify(m));
  const list = collect(dup, { repo: REPO, audioBase: BASE });
  const $ = cheerio.load(buildFeed(list, { feedUrl: FEED }), { xmlMode: true });
  assert.equal($('item guid:contains("hourbrief-2026-09-24")').length, 1);
  assert.match($('item').first().children('enclosure').attr('url'), /quick\.deadbeef\.mp3$/);
  assert.equal($('item').length, 3);
});

test('the same inputs always give the same feed (so republishing is harmless)', () => {
  assert.equal(buildFeed(eps(), { feedUrl: FEED }), buildFeed(eps(), { feedUrl: FEED }));
});

test('unusable manifests are skipped, and an empty feed is refused', async () => {
  const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-pod3-'));
  fs.mkdirSync(path.join(bad, '2026-09-24'));
  fs.writeFileSync(path.join(bad, '2026-09-24', 'manifest.json'), '{ nope');
  fs.mkdirSync(path.join(bad, '2026-09-23'));
  fs.writeFileSync(path.join(bad, '2026-09-23', 'manifest.json'), JSON.stringify({ date: '2026-09-23', modes: { quick: { file: '../../etc/passwd', bytes: 5, duration: 5 } } }));
  assert.equal(collect(bad, { repo: REPO, audioBase: BASE }).length, 0);
  await assert.rejects(run('node', ['podcast.mjs', '--audio', bad, '--audio-base', BASE, '--out', path.join(bad, 'p.xml')], { cwd: DIR }), (e) => e.code === 1 && /refusing to write an empty feed/.test(e.stderr));
  assert.ok(!fs.existsSync(path.join(bad, 'p.xml')));
});

test('the command line writes a valid feed file from a folder of manifests', async () => {
  const out = path.join(tmp, 'cli.xml');
  const { stdout } = await run('node', ['podcast.mjs', '--audio', AUDIO, '--audio-base', BASE, '--feed-url', FEED, '--out', out], { cwd: DIR });
  assert.match(stdout, /Wrote 3 episode/);
  assert.deepEqual(checkFeedXml(fs.readFileSync(out, 'utf8')), []);
});

test('the checker catches the mistakes that get a feed rejected', () => {
  const good = buildFeed(eps(), { feedUrl: FEED });
  const broken = (find, put) => checkFeedXml(good.replace(find, put));
  assert.match(broken(/length="\d+"/, 'length="0"').join('|'), /enclosure length/);
  assert.match(broken(/url="https:\/\/audio\.example\.test\/audio\/2026-09-24/, 'url="http://audio.example.test/audio/2026-09-24').join('|'), /https \.mp3/);
  assert.match(broken('type="audio/mpeg"', 'type="audio/x-wav"').join('|'), /audio\/mpeg/);
  assert.match(broken('hourbrief-2026-09-23', 'hourbrief-2026-09-24').join('|'), /duplicate guid/);
  assert.match(broken(/<pubDate>[^<]*<\/pubDate>/, '<pubDate>yesterday</pubDate>').join('|'), /RFC 822/);
  assert.match(broken('<itunes:email>milindroy101292@gmail.com</itunes:email>', '<itunes:email></itunes:email>').join('|'), /owner/);
  assert.match(broken(/<itunes:image href="[^"]*"\/>/, '<itunes:image href="http://x/y.gif"/>').join('|'), /itunes:image/);
  assert.match(broken('<itunes:duration>', '<itunes:duration>x').join('|'), /HH:MM:SS/);
  assert.match(checkFeedXml(good.replace(/<item>[\s\S]*<\/item>/, '')).join('|'), /no episodes/);
});

// A tiny host that behaves like the real one, with switches for the failures a podcast app would trip over.
async function host({ sizeLie = 0, ranges = true, coverOk = true } = {}) {
  const feedXml = buildFeed(eps(), { feedUrl: 'http://127.0.0.1/podcast.xml' }).replace(/https:\/\/audio\.example\.test/g, 'http://127.0.0.1:PORT').replace(SHOW.site + SHOW.cover, 'http://127.0.0.1:PORT/cover.jpg');
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/podcast.xml') { res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' }); return res.end(feedXml.replace(/PORT/g, String(server.address().port))); }
    if (u.pathname === '/cover.jpg') { res.writeHead(coverOk ? 200 : 404, { 'Content-Type': 'image/jpeg' }); return res.end('x'); }
    const m = /^\/audio\/(\d{4}-\d{2}-\d{2})\/(.+)$/.exec(u.pathname);
    const file = m && path.join(AUDIO, m[1], m[2]);
    if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    const buf = fs.readFileSync(file);
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (range && ranges) {
      const a = Number(range[1]), b = range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
      res.writeHead(206, { 'Content-Type': 'audio/mpeg', 'Content-Range': `bytes ${a}-${b}/${buf.length}`, 'Content-Length': b - a + 1 });
      return res.end(req.method === 'HEAD' ? undefined : buf.subarray(a, b + 1));
    }
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length + sizeLie });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}/podcast.xml` };
}
// The checker insists on https, as the real feed is; the local host is plain http, so tolerate only that in these runs.
const verifyLocal = async (url) => {
  const { stdout, stderr } = await run('node', ['podcast.mjs', '--verify', url], { cwd: DIR, env: { ...process.env, HB_ALLOW_HTTP: '1' } }).catch((e) => ({ stdout: e.stdout, stderr: e.stderr, failed: true }));
  return { out: stdout + stderr };
};

test('--verify: a healthy host passes (audio served with the right size, type and range support)', async () => {
  const h = await host();
  try { const r = await verifyLocal(h.url); assert.match(r.out, /Feed OK: 3 episode/); } finally { h.server.close(); }
});
test('--verify: a feed whose length disagrees with the server is caught', async () => {
  const h = await host({ sizeLie: 7 });
  try { const r = await verifyLocal(h.url); assert.match(r.out, /feed says \d+ bytes, server says \d+/); } finally { h.server.close(); }
});
test('--verify: a host without range support is caught (podcast apps need it)', async () => {
  const h = await host({ ranges: false });
  try { const r = await verifyLocal(h.url); assert.match(r.out, /range requests/); } finally { h.server.close(); }
});
test('--verify: missing cover art is caught', async () => {
  const h = await host({ coverOk: false });
  try { const r = await verifyLocal(h.url); assert.match(r.out, /cover art/); } finally { h.server.close(); }
});

test('the cover art is a 2048px RGB JPEG under 512 KB, where the feed says it is', () => {
  const f = path.join(REPO, 'brand/podcast-cover.jpg');
  const buf = fs.readFileSync(f);
  assert.equal(buf[0], 0xff); assert.equal(buf[1], 0xd8);                        // JPEG signature
  assert.ok(buf.length < 512 * 1024, `cover is ${buf.length} bytes`);
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'space', f]).toString();
  assert.match(out, /pixelWidth: 2048/); assert.match(out, /pixelHeight: 2048/); assert.match(out, /space: RGB/);
  assert.equal(SHOW.site + SHOW.cover, 'https://the-hour-brief.vercel.app/brand/podcast-cover.jpg');
});

// ---- publish-feed.sh end to end: a fake `aws` (a folder standing in for the bucket) and a local host standing in for r2.dev ----
function fakeBucket() {
  const bucket = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-bucket-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-bin-'));
  fs.writeFileSync(path.join(bin, 'aws'), `#!/usr/bin/env bash
# just enough of the aws CLI for publish-feed.sh: "s3 sync s3://B/audio/ DEST --include '*/manifest.json'" and "s3 cp SRC s3://B/KEY --content-type X"
set -e
[ "$1" = s3 ] || exit 2
case "$2" in
  sync) dest="$4"; mkdir -p "$dest"; for m in "$FAKE_BUCKET"/audio/*/manifest.json; do [ -e "$m" ] || continue; d="$(basename "$(dirname "$m")")"; mkdir -p "$dest/$d"; cp "$m" "$dest/$d/manifest.json"; done ;;
  cp)   key="\${4#s3://*/}"; cp "$3" "$FAKE_BUCKET/$key"; while [ $# -gt 0 ]; do [ "$1" = --content-type ] && printf '%s' "$2" > "$FAKE_BUCKET/$key.ctype"; shift; done ;;
  *) exit 2 ;;
esac
`, { mode: 0o755 });
  return { bucket, bin };
}
async function publicHost(bucket) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const cover = u.pathname === '/brand/podcast-cover.jpg';
    const file = cover ? path.join(REPO, 'brand/podcast-cover.jpg') : path.join(bucket, decodeURIComponent(u.pathname));
    if (!file.startsWith(cover ? REPO : bucket) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    const buf = fs.readFileSync(file);
    const ct = cover ? 'image/jpeg' : file.endsWith('.mp3') ? 'audio/mpeg' : fs.existsSync(file + '.ctype') ? fs.readFileSync(file + '.ctype', 'utf8') : 'application/octet-stream';
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (range) { const a = Number(range[1]), b = range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1; res.writeHead(206, { 'Content-Type': ct, 'Content-Range': `bytes ${a}-${b}/${buf.length}`, 'Content-Length': b - a + 1 }); return res.end(req.method === 'HEAD' ? undefined : buf.subarray(a, b + 1)); }
    res.writeHead(200, { 'Content-Type': ct, 'Content-Length': buf.length }); res.end(req.method === 'HEAD' ? undefined : buf);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
const publish = (env, extra = {}) => run('bash', ['publish-feed.sh'], { cwd: DIR, env: { ...process.env, ...env, ...extra } }).then((r) => ({ code: 0, out: r.stdout + r.stderr }), (e) => ({ code: e.code, out: (e.stdout || '') + (e.stderr || '') }));

test('publish-feed.sh: reads the manifests, publishes podcast.xml with the right content type, and verifies what it published', async () => {
  const { bucket, bin } = fakeBucket();
  fs.cpSync(AUDIO, path.join(bucket, 'audio'), { recursive: true });
  const host = await publicHost(bucket);
  try {
    const env = { PATH: `${bin}:${process.env.PATH}`, FAKE_BUCKET: bucket, R2_BUCKET: 'b', R2_ENDPOINT: 'http://unused', R2_PUBLIC_URL: host.url, PODCAST_SITE: host.url, HB_ALLOW_HTTP: '1' };
    const r = await publish(env);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /manifests found: 3/);
    assert.match(r.out, /Feed OK: 3 episode/);
    assert.equal(fs.readFileSync(path.join(bucket, 'podcast.xml.ctype'), 'utf8'), 'application/rss+xml; charset=utf-8');
    const xml = fs.readFileSync(path.join(bucket, 'podcast.xml'), 'utf8');
    assert.match(xml, new RegExp(`<atom:link href="${host.url}/podcast.xml"`));
    assert.match(xml, new RegExp(`<enclosure url="${host.url}/audio/2026-09-24/quick\\.[0-9a-f]{8}\\.mp3"`));
    // and once more with the same inputs: the same feed (republishing is harmless)
    const again = await publish(env);
    assert.equal(again.code, 0, again.out);
    assert.equal(fs.readFileSync(path.join(bucket, 'podcast.xml'), 'utf8'), xml);
  } finally { host.server.close(); }
});

test('publish-feed.sh: FEED_DRY=1 builds and checks but uploads nothing', async () => {
  const { bucket, bin } = fakeBucket();
  fs.cpSync(AUDIO, path.join(bucket, 'audio'), { recursive: true });
  const r = await publish({ PATH: `${bin}:${process.env.PATH}`, FAKE_BUCKET: bucket, R2_BUCKET: 'b', R2_ENDPOINT: 'http://unused', R2_PUBLIC_URL: 'https://audio.example.test' }, { FEED_DRY: '1' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /not uploading/);
  assert.ok(!fs.existsSync(path.join(bucket, 'podcast.xml')));
});

test('publish-feed.sh: an empty bucket publishes nothing and fails loudly (a blank feed would wipe the show)', async () => {
  const { bucket, bin } = fakeBucket();
  const r = await publish({ PATH: `${bin}:${process.env.PATH}`, FAKE_BUCKET: bucket, R2_BUCKET: 'b', R2_ENDPOINT: 'http://unused', R2_PUBLIC_URL: 'https://audio.example.test' });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /refusing to write an empty feed/);
  assert.ok(!fs.existsSync(path.join(bucket, 'podcast.xml')));
});

test('publish-feed.sh: a feed whose audio is not actually served is reported as a failure after upload', async () => {
  const { bucket, bin } = fakeBucket();
  fs.cpSync(AUDIO, path.join(bucket, 'audio'), { recursive: true });
  for (const d of fs.readdirSync(path.join(bucket, 'audio'))) for (const f of fs.readdirSync(path.join(bucket, 'audio', d))) if (f.endsWith('.mp3')) fs.rmSync(path.join(bucket, 'audio', d, f));   // manifests without audio
  const host = await publicHost(bucket);
  try {
    const r = await publish({ PATH: `${bin}:${process.env.PATH}`, FAKE_BUCKET: bucket, R2_BUCKET: 'b', R2_ENDPOINT: 'http://unused', R2_PUBLIC_URL: host.url, PODCAST_SITE: host.url, HB_ALLOW_HTTP: '1' });
    assert.notEqual(r.code, 0);
    assert.match(r.out, /answered 404/);
  } finally { host.server.close(); }
});
