// Live production smoke test for Listen: confirms today's actual recording on R2 still matches
// today's actual live page, using the exact same comparison listen.js (client-side) and
// generate.mjs's --skip-existing (server-side) both already do. A mismatch here means every
// reader is silently falling back to the on-device voice instead of the real recording — the
// same class of bug fixed 2026-10-19 (see mobile-app-capacitor memory / commit b7d8602).
//   node check-live.mjs
// Env: SITE_URL (default https://the-hour-brief.vercel.app), R2_PUBLIC_URL
import { buildUnits, editionMeta } from './script.mjs';

const SITE = process.env.SITE_URL || 'https://the-hour-brief.vercel.app';
const R2 = process.env.R2_PUBLIC_URL;
if (!R2) { console.error('R2_PUBLIC_URL is not set'); process.exit(1); }

function istToday() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

const pageRes = await fetch(SITE + '/');
if (!pageRes.ok) { console.error(`FAIL: could not load ${SITE}/ (${pageRes.status})`); process.exit(1); }
const html = await pageRes.text();
const meta = editionMeta(html);
if (!meta.date) { console.error('FAIL: could not read the edition date from the live page'); process.exit(1); }

const today = istToday();
if (meta.date !== today) {
  console.log(`SKIP: live edition is ${meta.date}, not today (${today}) yet — nothing to check`);
  process.exit(0);
}

const manifestUrl = `${R2}/audio/${meta.date}/manifest.json`;
const manifestRes = await fetch(manifestUrl);
if (!manifestRes.ok) { console.error(`FAIL: no manifest at ${manifestUrl} (${manifestRes.status})`); process.exit(1); }
const manifest = await manifestRes.json();

let allOk = true;
for (const mode of Object.keys(manifest.modes || {})) {
  const currentIds = buildUnits(html, mode).map((u) => u.id);
  const recordedIds = (manifest.modes[mode].cues || []).map((c) => c.id);
  const matches = currentIds.length === recordedIds.length && currentIds.every((id, i) => id === recordedIds[i]);
  if (matches) {
    console.log(`PASS: ${mode} recording matches the live page (${currentIds.length} cues)`);
  } else {
    allOk = false;
    console.error(`FAIL: ${mode} recording does NOT match the live page — recorded ${recordedIds.length} cues, page has ${currentIds.length}`);
    console.error('  recorded:', recordedIds.join(', '));
    console.error('  page:    ', currentIds.join(', '));
  }
}

if (!Object.keys(manifest.modes || {}).length) { console.error('FAIL: manifest has no modes at all'); process.exit(1); }
process.exit(allOk ? 0 : 1);
