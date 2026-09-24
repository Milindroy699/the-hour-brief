// Renders the app launch image and icon from the Stitch logo:  node tools/brand/render.mjs
//   mobile/resources/splash.png + splash-dark.png (2732x2732), icon.png (1024, opaque), play-store/icon-512.png.
// Then regenerate the native assets:  cd mobile && npm run assets
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launch } from '../browser-tests/cdp.mjs';

const here = import.meta.dirname, root = path.resolve(here, '../..');
const sharp = createRequire(path.join(root, 'mobile/package.json'))('sharp');

// Icon: a full-bleed opaque square (the stores add their own corner mask). The Stitch logo is a rounded tile, so crop just
// inside its corner radius (about 22% of the width) instead of filling the corners: 6.6% off each side leaves no transparency.
const SRC = 2048, CUT = Math.round(SRC * 0.066);
const icon = sharp(path.join(here, 'logo-source.png')).extract({ left: CUT, top: CUT, width: SRC - 2 * CUT, height: SRC - 2 * CUT }).flatten({ background: '#0c0d15' });
await icon.clone().resize(1024, 1024).png().toFile(path.join(root, 'mobile/resources/icon.png'));
await icon.clone().resize(512, 512).png().toFile(path.join(root, 'mobile/play-store/icon-512.png'));
for (const [file, size] of [['logo-128.png', 128], ['logo-256.png', 256], ['favicon-32.png', 32], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]) {
  await icon.clone().resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(root, 'brand', file));   // app bar, share cards, favicon, touch icons
}

// Launch image: the HTML page, screenshotted at 1:1.
const c = await launch(9391);
await c.send('Emulation.setDeviceMetricsOverride', { width: 2732, height: 2732, deviceScaleFactor: 1, mobile: false });
await c.goto('file://' + path.join(here, 'splash.html'), 1500);
await c.shot(path.join(root, 'mobile/resources/splash.png'));
c.close();
fs.copyFileSync(path.join(root, 'mobile/resources/splash.png'), path.join(root, 'mobile/resources/splash-dark.png'));   // already dark
console.log('done');
