// The app's file list (owner, 2026-11-25: "bundle the app code inside the app", with live updates): every file the app needs
// to open with no network, each with a fingerprint of its contents. sw.js keeps these on the phone, serves them from there,
// and on each check downloads only the files whose fingerprint changed (a new edition: index.html and a few data files).
//
// Run on every Vercel deploy after the SEO pass (package.json vercel-build), on the files exactly as deployed, so the
// fingerprints match what the server sends. app-manifest.json must also exist in git (Vercel only serves files it listed
// before the build ran; see tools/seo/build.mjs); its contents are replaced here.
//
//   node tools/app/manifest.mjs [siteDir]      writes <siteDir>/app-manifest.json (default: the repo root)
//   import { buildManifest } from it           the same, as an object (the test server uses it)
// Kill switch: APP_CACHE=off in Vercel's environment writes { off: true }, and every phone drops its copy and goes back to
// loading from the network.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '../..');
// What the app opens without the network. Pictures that only some screens show (medals, Voices art) are kept the first time
// they are seen instead (sw.js), so the first download stays small.
const PAGES = ['index.html', 'leaders.html', 'week.html', 'archive/index.html', 'about.html', 'privacy.html', 'contact.html', 'corrections.html', 'podcasts.html'];
const CODE = ['mobile.js', 'cards.js', 'listen.js', 'quiz.js', 'home.js', 'account.js', 'capacitor-bridge.js', 'mobile.css', 'reader.css', 'app.css', 'quiz.css'];
const DIRS = [['webfonts', /\.woff2$/], ['brand/backgrounds', /\.(jpg|png|svg|webp)$/], ['brand/stories', /\.svg$/], ['brand/leaders', /\.(jpg|webp)$/]];
const BRAND = ['brand/logo-128.png', 'brand/logo-256.png', 'brand/icon-192.png', 'brand/favicon-32.png', 'brand/apple-touch-icon.png'];
const DATA = ['editions.json', 'leaders-data.json'];

const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

export function buildManifest(dir = ROOT) {
  if (process.env.APP_CACHE === 'off') return { v: 'off', off: true };
  const files = {};
  const add = (rel) => { const p = path.join(dir, rel); if (fs.existsSync(p) && fs.statSync(p).isFile()) files['/' + rel] = hash(fs.readFileSync(p)); };
  [...PAGES, ...CODE, ...BRAND, ...DATA].forEach(add);
  for (const [d, re] of DIRS) {
    const full = path.join(dir, d);
    if (fs.existsSync(full)) fs.readdirSync(full).filter((f) => re.test(f)).sort().forEach((f) => add(d + '/' + f));
  }
  // The last week of past editions, so Past editions opens on a train too; older ones are kept once read.
  const arch = path.join(dir, 'archive');
  if (fs.existsSync(arch)) fs.readdirSync(arch).filter((f) => /^\d{4}-\d{2}-\d{2}\.html$/.test(f)).sort().slice(-7).forEach((f) => add('archive/' + f));
  const html = fs.existsSync(path.join(dir, 'index.html')) ? fs.readFileSync(path.join(dir, 'index.html'), 'utf8') : '';
  const edition = (/data-edition-date="(\d{4}-\d{2}-\d{2})"/.exec(html) || [])[1] || '';
  const v = hash(JSON.stringify(files));
  return { v, edition, files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const dir = path.resolve(process.argv[2] || ROOT);
  try {
    const m = buildManifest(dir);
    fs.writeFileSync(path.join(dir, 'app-manifest.json'), JSON.stringify(m));
    console.log(`app-manifest.json: ${m.off ? 'off' : Object.keys(m.files).length + ' files, version ' + m.v + ', edition ' + m.edition}`);
  } catch (e) {
    console.log('app-manifest.json not written: ' + e.message);   // never fails a deploy; phones keep the copy they have
  }
}
