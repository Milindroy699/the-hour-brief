// node --test tools/seo/test/  (no dependencies)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readEdition, stampHead, editionHead, homeHead, feedTimes, sitemap, build } from '../build.mjs';

const REPO = path.resolve(import.meta.dirname, '../../..');
const SCRIPT = path.join(REPO, 'tools/seo/build.mjs');
const latestFile = fs.readdirSync(path.join(REPO, 'archive')).filter((f) => /^\d{4}-\d{2}-\d{2}\.html$/.test(f)).sort().pop();
const latestHtml = fs.readFileSync(path.join(REPO, 'archive', latestFile), 'utf8');
const count = (s, needle) => s.split(needle).length - 1;
const headOf = (h) => h.slice(0, h.indexOf('</head>'));

test('reads date, number, the three sections and each story with its source', () => {
  const ed = readEdition(latestHtml);
  assert.equal(ed.date, latestFile.slice(0, 10));
  assert.ok(ed.number > 0);
  assert.deepEqual(ed.lanes.map((l) => l.id), ['ai', 'biz', 'mkt']);
  for (const l of ed.lanes) for (const s of l.stories) {
    assert.ok(s.headline && !/[<>]/.test(s.headline), `headline for ${s.id}`);
    assert.match(s.source, /^https?:\/\//, `source for ${s.id}`);
  }
});

test('an edition gets exactly one title, description, canonical and social card, and valid NewsArticle JSON-LD', () => {
  const out = headOf(stampHead(latestHtml, editionHead(readEdition(latestHtml))));
  for (const tag of ['<title>', 'name="description"', 'rel="canonical"', 'property="og:title"', 'property="og:image"', 'name="twitter:card"']) assert.equal(count(out, tag), 1, tag);
  assert.match(out, new RegExp(`rel="canonical" href="https://the-hour-brief.vercel.app/archive/${latestFile}"`));
  const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(out)[1]);
  const art = ld['@graph'].find((n) => n['@type'] === 'NewsArticle');
  assert.ok(art.headline.length <= 110 && art.datePublished && art.citation.length > 0);
  assert.ok(!/<\/script/i.test(JSON.stringify(ld)));
});

test('stamping twice gives the same page (an edition copied from a stamped template is re-stamped cleanly)', () => {
  const lines = editionHead(readEdition(latestHtml));
  const once = stampHead(latestHtml, lines);
  assert.equal(stampHead(once, lines), once);
  const home = stampHead(once, homeHead());                     // the routine copies a stamped page and it gets the other role
  assert.equal(count(headOf(home), '<title>'), 1);
  assert.equal(count(headOf(home), 'rel="canonical"'), 1);
  assert.match(home, /rel="canonical" href="https:\/\/the-hour-brief.vercel.app\/"/);
});

test('publication times come from feed.xml, falling back to 09:00 in India', () => {
  const t = feedTimes('<entry><link href="https://x/archive/2026-01-02.html"/><id>i</id><updated>2026-01-02T02:55:00Z</updated></entry>');
  assert.equal(t['2026-01-02'], '2026-01-02T02:55:00Z');
  const sm = sitemap([{ date: '2026-01-02', lead: 'A' }, { date: '2026-01-03', lead: 'B & C' }], { times: t, now: new Date('2026-01-03T12:00:00Z') });
  assert.match(sm, /archive\/2026-01-02\.html<\/loc><lastmod>2026-01-02T02:55:00Z/);
  assert.match(sm, /archive\/2026-01-03\.html<\/loc><lastmod>2026-01-03T03:30:00Z/);
  assert.match(sm, /B &amp; C/);
});

test('the whole site: every edition stamped with a unique title; sitemap, robots and llms.txt written', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-'));
  try {
    execFileSync('node', [SCRIPT, '--out', dir]);
    const eds = fs.readdirSync(path.join(dir, 'archive')).filter((f) => /^\d{4}-\d{2}-\d{2}\.html$/.test(f));
    const titles = new Set(eds.map((f) => /<title>(.*?)<\/title>/.exec(fs.readFileSync(path.join(dir, 'archive', f), 'utf8'))[1]));
    assert.equal(titles.size, eds.length, 'every edition has its own title');
    assert.equal(count(fs.readFileSync(path.join(dir, 'sitemap.xml'), 'utf8'), '<url>'), eds.length + 2 + 6);
    assert.match(fs.readFileSync(path.join(dir, 'robots.txt'), 'utf8'), /Sitemap: https:\/\/the-hour-brief.vercel.app\/sitemap.xml/);
    assert.match(fs.readFileSync(path.join(dir, 'llms.txt'), 'utf8'), /^# The Hour Brief\n/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('never edits the repository in place outside Vercel', () => {
  assert.throws(() => execFileSync('node', [SCRIPT], { env: { ...process.env, VERCEL: '' }, stdio: 'pipe' }), /status 2|Refusing/);
});

test('a page it cannot read is skipped, not fatal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-'));
  try {
    fs.mkdirSync(path.join(dir, 'archive'));
    fs.writeFileSync(path.join(dir, 'archive', '2026-01-01.html'), '<html><head><title>x</title></head><body>no edition here</body></html>');
    const r = build(dir, { log: () => {} });
    assert.equal(r.skipped, 1);
    assert.ok(fs.existsSync(path.join(dir, 'sitemap.xml')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
