// Podcast cover art:  node tools/brand/podcast-cover.mjs   ->  brand/podcast-cover.jpg (2048x2048 JPEG, RGB, under 512 KB)
// The feed (tools/audio/podcast.mjs) points at https://the-hour-brief.vercel.app/brand/podcast-cover.jpg
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launch } from '../browser-tests/cdp.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const sharp = createRequire(path.join(root, 'mobile/package.json'))('sharp');
const png = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hb-cover-')), 'cover.png');
const c = await launch(9385);
await c.send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 2048, deviceScaleFactor: 1, mobile: false });
await c.goto('file://' + path.join(import.meta.dirname, 'podcast-cover.html'), 1800);
await c.ev(`document.fonts.ready.then(() => 'ok')`);
await c.shot(png);
c.close();
let q = 88, out;
do {                                                        // stay under 512 KB whatever the artwork
  out = await sharp(png).flatten({ background: '#0c0d15' }).jpeg({ quality: q, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
  q -= 6;
} while (out.length > 500 * 1024 && q > 50);
fs.writeFileSync(path.join(root, 'brand/podcast-cover.jpg'), out);
console.log(`brand/podcast-cover.jpg: 2048x2048, ${(out.length / 1024).toFixed(0)} KB`);
