// Browser test for Listen mode's recorded-audio player. No Sarvam credit is used: the recording is a
// dry-run (tones) generated for the real latest edition, so its story timings match the real page.
//   node listen.mjs [screenshotDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch } from './cdp.mjs';
import { start } from './static.mjs';

const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'hb-listen-shots-'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-rec-'));
execFileSync('node', ['generate.mjs', '--dry', '--date', 'latest', '--out', tmp], { cwd: path.resolve(import.meta.dirname, '../audio'), stdio: 'ignore' });
const date = fs.readdirSync(path.join(tmp, 'audio'))[0];
const manifest = JSON.parse(fs.readFileSync(path.join(tmp, 'audio', date, 'manifest.json'), 'utf8'));
const cues = manifest.modes.quick.cues, DUR = manifest.modes.quick.duration;
const { server, ctl } = await start({ port: 8788, audioDir: tmp });
const B = 'http://127.0.0.1:8788';

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  -> ' + x)); };
const c = await launch(9370);
const J = async (e) => JSON.parse(await c.ev(`JSON.stringify(${e})`));
const waitFor = async (expr, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await c.ev(expr)) return true; await c.sleep(60); } return false; };

const hook = (full) => `(() => { const A = window.Audio; window.Audio = function (...a) { const el = new A(...a); window.__audio = el; return el; }; window.Audio.prototype = A.prototype; })(); window.HB_AUDIO_BASE = ${JSON.stringify(B + '/__audio')}; window.HB_LOOK_MS = 300; window.__mf = 0; (() => { const f = window.fetch; window.fetch = function (u, ...a) { if (/manifest\\.json/.test(String(u))) window.__mf++; return f.call(this, u, ...a); }; })(); window.HB_OFFER_FULL = ${!!full};`;
const FAKE_TTS = `(() => { const log = window.__spoken = []; window.__rates = []; let cur = null, t = null, sp = false;
  window.__ttsMs = 30;
  const synth = { get speaking() { return sp; }, pending: false,
    speak(u) { cur = u; sp = true; log.push(u.text); window.__rates.push(u.rate); setTimeout(() => { if (cur === u && u.onstart) u.onstart({}); }, 5); t = setTimeout(() => { if (cur === u) { sp = false; cur = null; u.onend && u.onend({}); } }, window.__ttsMs); },
    cancel() { if (cur) { const u = cur; cur = null; clearTimeout(t); sp = false; setTimeout(() => u.onerror && u.onerror({ error: 'interrupted' }), 0); } }, pause() {}, resume() {}, getVoices() { return []; } };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (x) { this.text = x; this.rate = 1; }; })();`;
const NO_TTS = `delete window.speechSynthesis; delete window.SpeechSynthesisUtterance;`;

let ids = [];
async function open({ tts, manifest: mf = 'ok', audio = 'ok', dark = false, width = 412, full = false }) {
  for (const id of ids) await c.unpreload(id);
  ids = [await c.preload(hook(full)), await c.preload(tts ? FAKE_TTS : NO_TTS)];
  await fetch(`${B}/__ctl?manifest=${mf}&audio=${audio}`);
  await c.viewport(width, 915, width < 700, dark);
  await c.goto(B + '/', 900);
  await waitFor(`!!document.querySelector('.listen-cta') || document.readyState === 'complete'`, 1500);
  await c.sleep(900);                                           // manifest fetch
}
const btn = `document.querySelector('.listen-cta button[data-mode=quick]')`;
const fullBtn = `document.querySelector('.listen-cta button[data-mode=full]')`;
const pl = (s) => `document.querySelector('.hb-player ${s}')`;
const hlId = `(document.querySelector('.item.hb-listening') || {dataset:{}}).dataset.storyId || (document.querySelector('.lane-head.hb-listening') ? 'lane' : '')`;

// ---------- 1. recording available, device can also speak ----------
await open({ tts: true });
let t = await J(`({ n: document.querySelectorAll('.listen-cta button[data-mode]:not([hidden])').length, quick: ${btn}.textContent, full: ${fullBtn} ? ${fullBtn}.textContent : null, note: document.querySelector('.listen-cta-note').textContent, noteHidden: document.querySelector('.listen-cta-note').hidden, hidden: document.querySelector('.listen-cta').hidden })`);
const mins = Math.round(DUR / 60);
check('Full is switched off: one "Quick brief" tile showing the recording length and the voice', t.n === 1 && /^Quick brief/.test(t.quick) && t.quick.includes('Neha (AI)') && t.quick.includes(mins + ' min') && t.full === null, JSON.stringify(t) + ' expected ' + mins + ' min');
check('the card says it is read by an AI voice', !t.noteHidden && t.note === 'Read by Neha, an AI voice.', t.note);
await c.ev(`(document.querySelector('.listen-cta').scrollIntoView({block:'center'}), 'ok')`); await c.sleep(300); await c.shot(`${OUT}/rec_cta.png`);
await c.ev(`${btn}.click()`); await waitFor(`window.__audio && __audio.currentTime > 0.8`, 6000);
t = await J(`({ st: HBListen.state(), src: HBListen.source(), url: __audio.getAttribute('src'), paused: __audio.paused, time: __audio.currentTime, badge: document.querySelector('.hb-pl-voice').textContent, spoken: window.__spoken.length })`);
check('click starts the recording (not the device voice) and it advances', t.st === 'playing' && t.src === 'rec' && !t.paused && t.time > 0.8 && t.url.endsWith(manifest.modes.quick.file) && t.spoken === 0, JSON.stringify(t));
check('the player is labelled "AI voice · Neha"', t.badge === 'AI voice · Neha', t.badge);
await c.ev(`${pl('.hb-pl-next')}.click()`); await c.sleep(500); await c.ev(`${pl('.hb-pl-next')}.click()`); await c.sleep(900);
t = await J(`({ hl: ${hlId}, time: __audio.currentTime, title: document.querySelector('.hb-pl-title').textContent, lane: document.querySelector('.hb-pl-lane').textContent })`);
check('Next twice lands on the first story: seeks the recording to its start and highlights it', t.hl === 'ai-1' && t.time >= cues[2].start - 0.2 && t.time < cues[2].start + 2.5, JSON.stringify(t) + ' start ' + cues[2].start);
check('lane and position are shown ("AI and Tech · 1 of N")', /^AI and Tech · 1 of \d+$/.test(t.lane), t.lane);
await c.ev(`(__audio.currentTime = ${cues[3].start + 0.4}, 'ok')`); await c.sleep(1200);
check('the highlight follows the recording as it moves on by itself', (await c.ev(hlId)) === 'ai-2', await c.ev(hlId));
const ms = await J(`({ title: navigator.mediaSession.metadata && navigator.mediaSession.metadata.title, artist: navigator.mediaSession.metadata && navigator.mediaSession.metadata.artist, state: navigator.mediaSession.playbackState })`);
check('lock-screen metadata follows the story and reports playing', ms.title === (await c.ev(`document.querySelector('.hb-pl-title').textContent`)) && /The Hour Brief/.test(ms.artist) && ms.state === 'playing', JSON.stringify(ms));
await c.ev(`${pl('.hb-pl-play')}.click()`); await c.sleep(300);
t = await J(`({ st: HBListen.state(), paused: __audio.paused, label: ${pl('.hb-pl-play')}.getAttribute('aria-label') })`);
check('Pause pauses the recording', t.st === 'paused' && t.paused && t.label === 'Play', JSON.stringify(t));
const at = await c.ev(`__audio.currentTime`);
await c.ev(`${pl('.hb-pl-play')}.click()`); await c.sleep(800);
t = await J(`({ st: HBListen.state(), paused: __audio.paused, time: __audio.currentTime })`);
check('Resume carries on from the same place (not from the story start)', t.st === 'playing' && !t.paused && t.time >= at - 0.1 && t.time < at + 3, JSON.stringify(t) + ' was ' + at);
await c.ev(`__audio.pause()`); await c.sleep(400);
check('a pause from the lock screen / headset is reflected in the player', (await c.ev(`HBListen.state()`)) === 'paused' && (await c.ev(`${pl('.hb-pl-play')}.getAttribute('aria-label')`)) === 'Play');
await c.ev(`__audio.play()`); await c.sleep(400);
check('and so is a resume from the lock screen', (await c.ev(`HBListen.state()`)) === 'playing');
const before = await c.ev(`__audio.currentTime`);
await c.ev(`${pl('.hb-pl-rate-plus')}.click()`); await c.sleep(400);
t = await J(`({ label: ${pl('.hb-pl-rate-val')}.textContent, rate: __audio.playbackRate, time: __audio.currentTime, pitch: __audio.preservesPitch })`);
check('Speed change applies to the recording without restarting it, keeping the pitch', t.label === '1.25×' && t.rate === 1.25 && t.time >= before && t.pitch !== false, JSON.stringify(t) + ' before ' + before);
t = await J(`({ minusDisabled: ${pl('.hb-pl-rate-minus')}.disabled, plusDisabled: ${pl('.hb-pl-rate-plus')}.disabled, minusLabel: ${pl('.hb-pl-rate-minus')}.getAttribute('aria-label'), plusLabel: ${pl('.hb-pl-rate-plus')}.getAttribute('aria-label') })`);
check('at 1.25×, neither end button is disabled, and each names the current speed', !t.minusDisabled && !t.plusDisabled && t.minusLabel === 'Slower. Currently 1.25×.' && t.plusLabel === 'Faster. Currently 1.25×.', JSON.stringify(t));
await c.ev(`${pl('.hb-pl-rate-minus')}.click()`); await c.sleep(300);
check('the slower button steps back down (1.25× → 1×)', (await c.ev(`${pl('.hb-pl-rate-val')}.textContent`)) === '1×' && (await c.ev(`__audio.playbackRate`)) === 1);
await c.ev(`${pl('.hb-pl-rate-minus')}.click()`); await c.sleep(300);
check('and again to the slowest speed, where the slower button now disables itself (it does not wrap around)', (await c.ev(`${pl('.hb-pl-rate-val')}.textContent`)) === '.85×' && (await c.ev(`${pl('.hb-pl-rate-minus')}.disabled`)) === true && (await c.ev(`__audio.playbackRate`)) === 0.85);
await c.ev(`${pl('.hb-pl-rate-minus')}.click()`); await c.sleep(200);
check('tapping the disabled slower button again does nothing', (await c.ev(`${pl('.hb-pl-rate-val')}.textContent`)) === '.85×');
for (let i = 0; i < 4; i++) { await c.ev(`${pl('.hb-pl-rate-plus')}.click()`); await c.sleep(250); }
check('the faster button steps all the way up to the fastest speed and then disables itself', (await c.ev(`${pl('.hb-pl-rate-val')}.textContent`)) === '1.75×' && (await c.ev(`${pl('.hb-pl-rate-plus')}.disabled`)) === true && (await c.ev(`__audio.playbackRate`)) === 1.75);
await c.ev(`${pl('.hb-pl-rate-minus')}.click()`); await c.sleep(300);
check('back to 1.5×: stepping down from the top re-enables the faster button', (await c.ev(`${pl('.hb-pl-rate-val')}.textContent`)) === '1.5×' && (await c.ev(`${pl('.hb-pl-rate-plus')}.disabled`)) === false);
await c.ev(`${pl('.hb-pl-rate-minus')}.click()`); await c.sleep(300);   // back to 1.25x: the rest of this run (and test 1b below) assumes Quick's remembered speed is 1.25x
check('quick is back at 1.25× for the rest of this run', (await c.ev(`${pl('.hb-pl-rate-val')}.textContent`)) === '1.25×');
await c.ev(`(__audio.currentTime = ${cues[2].start + 6}, 'ok')`); await c.sleep(700);
await c.ev(`${pl('.hb-pl-prev')}.click()`); await c.sleep(700);
t = await J(`({ hl: ${hlId}, time: __audio.currentTime })`);
check('Previous, well into a story, restarts that story', t.hl === 'ai-1' && t.time >= cues[2].start - 0.2 && t.time < cues[2].start + 2, JSON.stringify(t));
await c.ev(`${pl('.hb-pl-prev')}.click()`); await c.sleep(700);
check('Previous again goes back a step (to the section opener)', (await c.ev(hlId)) === 'lane');
await c.shot(`${OUT}/rec_playing.png`);
await c.ev(`(__audio.currentTime = ${DUR - 1.5}, 'ok')`);
const ended = await waitFor(`HBListen.state() === 'done'`, 6000);
t = await J(`({ st: HBListen.state(), time: __audio.currentTime, dur: __audio.duration, ended: __audio.ended, paused: __audio.paused, lit: document.querySelectorAll('.item.hb-listening, .lane-head.hb-listening').length, label: ${pl('.hb-pl-play')}.getAttribute('aria-label') })`);
check('reaching the end finishes cleanly', ended && t.lit === 0 && t.label === 'Play again', JSON.stringify(t) + ' manifest duration ' + DUR);
await c.ev(`${pl('.hb-pl-play')}.click()`); await c.sleep(900);
t = await J(`({ st: HBListen.state(), src: HBListen.source(), time: __audio.currentTime })`);
check('"Play again" replays the recording from the top', t.st === 'playing' && t.src === 'rec' && t.time < 3, JSON.stringify(t));
await c.ev(`${pl('.hb-pl-close')}.click()`); await c.sleep(300);
t = await J(`({ hidden: document.querySelector('.hb-player').hidden, src: __audio.getAttribute('src'), st: HBListen.state(), ms: navigator.mediaSession.playbackState, body: document.body.classList.contains('hb-listening') })`);
check('Close stops the audio, releases it and hides the player', t.hidden && !t.src && t.st === 'idle' && t.ms === 'none' && !t.body, JSON.stringify(t));

// ---------- 1b. Full (switched on for this test only) = free device voice at 1.25x; each length keeps its own speed ----------
await open({ tts: true, full: true });
t = await J(`({ n: document.querySelectorAll('.listen-cta button[data-mode]:not([hidden])').length, quick: ${btn}.textContent, full: ${fullBtn}.textContent, note: document.querySelector('.listen-cta-note').textContent })`);
const mins125 = Math.round(DUR / 60 / 1.25);      // Quick's speed was set to 1.25x earlier in this run and is remembered
check('with Full switched on: two lengths, Quick from the recording and Full on the device voice', t.n === 2 && t.quick.startsWith('Quick') && t.quick.includes(mins125 + ' min') && t.full.startsWith('Full') && /\d+ min/.test(t.full) && t.note === 'Quick is read by Neha, an AI voice. Full uses your device’s voice.', JSON.stringify(t));
await c.ev(`window.__spoken.length = 0; window.__rates.length = 0; ${btn}.click()`); await c.sleep(900);
await c.ev(`${fullBtn}.click()`); await c.sleep(900);
t = await J(`({ src: HBListen.source(), st: HBListen.state(), badge: document.querySelector('.hb-pl-voice').textContent, rate: document.querySelector('.hb-pl-rate-val').textContent, rates: window.__rates.slice(-3), first: window.__spoken[0], recPaused: __audio.paused, recSrc: __audio.getAttribute('src') })`);
check('Full plays in the device voice, starting at 1.25x, and the recording is stopped (never two sounds)', t.src === 'tts' && t.st === 'playing' && t.badge === 'Device voice' && t.rate === '1.25×' && t.rates.length > 0 && t.rates.every((r) => r === 1.25) && t.recPaused, JSON.stringify(t));
await c.ev(`${pl('.hb-pl-rate-plus')}.click()`); await c.sleep(300);
const saved = await J(`JSON.parse(localStorage.getItem('hb-listen-v1'))`);
check('changing the Full speed is remembered for Full only (Quick keeps the 1.25x chosen earlier)', saved.rates.full === 1.5 && saved.rates.quick === 1.25, JSON.stringify(saved));
await c.ev(`${btn}.click()`); await c.sleep(900);
t = await J(`({ src: HBListen.source(), rate: document.querySelector('.hb-pl-rate-val').textContent, badge: document.querySelector('.hb-pl-voice').textContent, paused: __audio.paused, tts: (window.speechSynthesis.speaking) })`);
check('switching back to Quick returns to the recording at Quick\'s own speed, and the device voice stops', t.src === 'rec' && t.rate === '1.25×' && t.badge === 'AI voice · Neha' && !t.paused && !t.tts, JSON.stringify(t));
await c.ev(`${pl('.hb-pl-close')}.click()`); await c.sleep(300);

// ---------- 2. the recording fails to load: fall back to the device voice ----------
await open({ tts: true, audio: '404' });
await c.ev(`window.__ttsMs = 700; ${btn}.click()`); await c.sleep(2200);
t = await J(`({ st: HBListen.state(), src: HBListen.source(), spoken: window.__spoken.length, first: window.__spoken[0], badge: document.querySelector('.hb-pl-voice').textContent, note: document.querySelector('.listen-cta-note').textContent })`);
check('audio file missing: carries on in the device voice from the same place', t.st === 'playing' && t.src === 'tts' && t.spoken > 0 && /^The Hour Brief, edition/.test(t.first) && t.badge === 'Device voice' && /^Read aloud by your device/.test(t.note), JSON.stringify(t));
await c.ev(`${pl('.hb-pl-close')}.click()`);

// ---------- 3. recording does not match the page ----------
await open({ tts: true, manifest: 'mismatch' });
t = await J(`({ note: document.querySelector('.listen-cta-note').textContent })`);
await c.ev(`${btn}.click()`); await c.sleep(900);
check('timings that do not match the page are ignored (device voice, and the card says so instead of claiming an AI voice)', /^Read aloud by your device/.test(t.note) && (await c.ev(`HBListen.source()`)) === 'tts' && (await c.ev(`window.__spoken.length`)) > 0);
await c.ev(`${pl('.hb-pl-close')}.click()`);

// ---------- 4. no recording today ----------
await open({ tts: true, manifest: '404' });
await c.ev(`${btn}.click()`); await c.sleep(900);
t = await J(`({ src: HBListen.source(), note: document.querySelector('.listen-cta-note').textContent, badge: document.querySelector('.hb-pl-voice').textContent })`);
check('no recording yet: today\'s behaviour is unchanged (device voice)', t.src === 'tts' && /^Read aloud by your device/.test(t.note) && t.badge === 'Device voice', JSON.stringify(t));
await c.ev(`${pl('.hb-pl-close')}.click()`);

// ---------- 5. recording available on a device that cannot speak ----------
await open({ tts: false, full: true });
t = await J(`({ has: !!document.querySelector('.listen-cta'), hidden: document.querySelector('.listen-cta') && document.querySelector('.listen-cta').hidden, quickShown: !${btn}.hidden, fullHidden: ${fullBtn}.hidden })`);
check('a device with no speech engine still gets Listen (Quick only, since Full needs a voice) when a recording exists', t.has && !t.hidden && t.quickShown && t.fullHidden, JSON.stringify(t));
await c.ev(`${btn}.click()`); await c.sleep(1500);
check('and it plays the recording', (await c.ev(`HBListen.state()`)) === 'playing' && (await c.ev(`HBListen.source()`)) === 'rec' && (await c.ev(`__audio.currentTime`)) > 0.5);
await c.ev(`${pl('.hb-pl-close')}.click()`);
await open({ tts: false, audio: '404' });
await c.ev(`${btn}.click()`); await c.sleep(1800);
t = await J(`({ st: HBListen.state(), msg: document.querySelector('.hb-pl-title').textContent, label: ${pl('.hb-pl-play')}.getAttribute('aria-label') })`);
check('no engine and a broken recording: a plain message, no crash', t.st === 'error' && /Audio isn.t available/.test(t.msg) && t.label === 'Play again', JSON.stringify(t));
await c.ev(`${pl('.hb-pl-close')}.click()`);

// ---------- 6. nothing can play ----------
await open({ tts: false, manifest: '404' });
check('no engine and no recording: no Listen card at all', (await c.ev(`!document.querySelector('.listen-cta')`)) === true);

// ---------- 7. desktop ----------
await open({ tts: true, width: 1280 });
check('desktop: the website has Listen too (the same card, and the recording plays)', (await c.ev(`!!document.querySelector('.listen-cta') && !document.querySelector('.listen-cta').hidden && typeof window.HBListen === 'object'`)) === true);
await c.ev(`document.querySelector('.listen-cta button[data-mode=quick]').click()`); await waitFor(`window.__audio && __audio.currentTime > 0.5`, 6000);
check('desktop: playing works and shows the mini player', (await c.ev(`HBListen.state() === 'playing' && HBListen.source() === 'rec' && !document.querySelector('.hb-player').hidden`)) === true);
await c.ev(`HBListen.stop()`);
for (const id of ids) await c.unpreload(id);
ids = [await c.preload(hook(false)), await c.preload(FAKE_TTS)];
await c.viewport(1280, 915, false, false);
await c.goto(B + '/?classic=1', 1200);
check('desktop with ?classic=1: nothing is loaded or shown (the old page)', (await c.ev(`!document.querySelector('.listen-cta') && typeof window.HBListen === 'undefined'`)) === true);

// ---------- 8. a recording that appears after the page opened ----------
const manifestHits = `window.__mf`;                               // how many times the page asked for a manifest (404s do not show up in resource timing)
await open({ tts: true, manifest: '404' });
t = await J(`({ btn: ${btn}.textContent, note: document.querySelector('.listen-cta-note').textContent })`);
check('page opened before the recording existed: the card says device voice', /device voice/.test(t.btn) && /device/.test(t.note), JSON.stringify(t));
await fetch(`${B}/__ctl?manifest=ok`);                              // the recording lands
const found = await waitFor(`/Neha \\(AI\\)/.test(${btn}.textContent)`, 4000);
t = await J(`({ btn: ${btn}.textContent, note: document.querySelector('.listen-cta-note').textContent, hits: ${manifestHits} })`);
check('it notices by itself (no reload): the card now offers the AI voice', found && /Read by Neha/.test(t.note), JSON.stringify(t));
const hits1 = t.hits; await c.sleep(1500);
check('and stops looking once it has found it (it asked more than once before, and not again after)', hits1 >= 2 && (await c.ev(manifestHits)) === hits1, hits1 + ' vs ' + await c.ev(manifestHits));
await c.ev(`${btn}.click()`); await waitFor(`window.__audio && __audio.currentTime > 0.5`, 6000);
check('playing now uses the recording, not the device voice', (await c.ev(`HBListen.source()`)) === 'rec' && (await c.ev(`HBListen.state()`)) === 'playing');
await c.ev(`${pl('.hb-pl-close')}.click()`);

await open({ tts: true, manifest: '404' });
await c.ev(`window.__ttsMs = 700; ${btn}.click()`); await c.sleep(700);
await fetch(`${B}/__ctl?manifest=ok`);
await c.sleep(1800);
t = await J(`({ st: HBListen.state(), src: HBListen.source(), note: document.querySelector('.listen-cta-note').textContent, badge: document.querySelector('.hb-pl-voice').textContent })`);
check('while it is reading in the device voice, a late recording does not swap the sound mid-way', t.st === 'playing' && t.src === 'tts' && /Device voice/.test(t.badge), JSON.stringify(t));
await c.ev(`${pl('.hb-pl-close')}.click()`);
check('once stopped, it picks the recording up', await waitFor(`/Neha \\(AI\\)/.test(${btn}.textContent)`, 4000));

for (const id of ids) await c.unpreload(id);
ids = [await c.preload(hook(false)), await c.preload(FAKE_TTS)];
await fetch(`${B}/__ctl?manifest=404&audio=ok`);
await c.viewport(412, 915, true, false);
await c.goto(B + '/archive/2026-09-10.html', 1200);
await fetch(`${B}/__ctl?manifest=ok`);
const h0 = await c.ev(manifestHits); await c.sleep(2500);
check('an old edition (over three days) is never re-checked', (await c.ev(manifestHits)) === h0 && h0 === 1, `${h0} vs ${await c.ev(manifestHits)}`);

// ---------- visuals ----------
await open({ tts: true, dark: true, width: 360 });
await c.ev(`(document.querySelector('.listen-cta').scrollIntoView({block:'center'}), 'ok')`); await c.sleep(300); await c.shot(`${OUT}/rec_cta_dark.png`);
await c.ev(`${btn}.click()`); await c.sleep(900); await c.ev(`${pl('.hb-pl-next')}.click()`); await c.sleep(300); await c.ev(`${pl('.hb-pl-next')}.click()`); await c.sleep(1300); await c.shot(`${OUT}/rec_playing_dark.png`);
const geo = await J(`(() => { const p = document.querySelector('.hb-player').getBoundingClientRect(); return { l: p.left, r: innerWidth - p.right, over: document.documentElement.scrollWidth > innerWidth }; })()`);
check('360px wide: the player fits with the label, no horizontal scroll', geo.l >= 0 && geo.r >= 0 && !geo.over, JSON.stringify(geo));
check('no JavaScript errors', c.errors.length === 0, c.errors.slice(0, 3).join(' | '));
console.log(`\n${pass} passed, ${fail} failed · screenshots in ${OUT}`);
c.close(); server.close(); process.exit(fail ? 1 : 0);
