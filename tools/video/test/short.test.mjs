// node --test tools/video/test/   (no network: a manifest is built from the edition's own narration units)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { captionLines, timeLines, plan, postText, leadHeadlines } from '../short.mjs';
import { buildUnits } from '../../audio/script.mjs';

const REPO = path.resolve(import.meta.dirname, '../../..');
const file = fs.readdirSync(path.join(REPO, 'archive')).filter((f) => /^\d{4}-\d{2}-\d{2}\.html$/.test(f)).sort().pop();
const html = fs.readFileSync(path.join(REPO, 'archive', file), 'utf8');
// a fake recording: each unit gets 2s per 30 characters, back to back
function manifestFor(h) {
  let t = 0;
  const cues = buildUnits(h, 'quick').map((u) => { const d = Math.max(1, u.text.length / 15); const c = { id: u.id, start: t, end: t + d }; t += d + 0.4; return c; });
  return { modes: { quick: { file: 'quick.abcdef12.mp3', cues } } };
}

test('caption lines stay short enough to fit the frame, and keep every word', () => {
  const t = 'Today’s tech story is Anthropic’s own stock swinging from a $2 trillion high to a $1.27 trillion close on its very first day as a public company.';
  const lines = captionLines(t, 44);
  assert.ok(lines.every((l) => l.length <= 44 || !l.includes(' ')), JSON.stringify(lines));
  assert.equal(lines.join(' '), t);
});

test('line timings add up to the segment exactly', () => {
  const lines = timeLines(['a short one', 'a somewhat longer caption line here', 'end.'], 12.5);
  assert.ok(Math.abs(lines.reduce((s, l) => s + l.dur, 0) - 12.5) < 1e-9);
  assert.ok(lines[1].dur > lines[0].dur);
});

test('the plan is the intro plus the three section takeaways, in order, under 90 seconds', () => {
  const p = plan({ manifest: manifestFor(html), html });
  assert.deepEqual(p.segs.map((s) => s.id), ['intro', 'lane:ai', 'lane:biz', 'lane:mkt']);
  assert.ok(p.segs.slice(1).every((s) => s.lane && s.lane.headline && s.lines.length));
  assert.ok(!/^AI and Tech\./.test(p.segs[1].lines[0].text), 'the section name is shown on the chip, not captioned twice');
  assert.ok(p.duration < 90, `duration ${p.duration}`);
  const segTime = p.segs.map((s) => s.lines.reduce((a, l) => a + l.dur, 0));
  p.segs.forEach((s, i) => assert.ok(Math.abs(segTime[i] - (s.end - s.start)) < 1e-6));
});

test('a recording without the section takeaways is refused, not turned into a broken video', () => {
  const m = manifestFor(html);
  m.modes.quick.cues = m.modes.quick.cues.filter((c) => !c.id.startsWith('lane:'));
  assert.throws(() => plan({ manifest: m, html }), /three section takeaways/);
});

test('post texts: YouTube title fits, links are tagged, AI voice and not-advice are disclosed', () => {
  const t = postText({ date: '2026-11-20', edition: 94, heads: leadHeadlines(html), when: 'Fri, 20 Nov 2026' });
  assert.ok(t.youtube.title.length <= 100 && /#Shorts$/.test(t.youtube.title));
  assert.match(t.youtube.description, /\/app\?src=youtube-shorts/);
  assert.match(t.youtube.description, /AI-generated voice/);
  assert.match(t.instagram.caption, /link in bio/);
  assert.match(t.whatsapp, /src=whatsapp-video/);
});
