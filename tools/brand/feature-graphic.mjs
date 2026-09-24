// Google Play feature graphic (1024x500 PNG, no transparency):  node tools/brand/feature-graphic.mjs
// -> mobile/play-store/feature-graphic-1024x500.png   (uses the screenshot from tools/brand/screenshots.mjs)
import path from 'node:path';
import { launch } from '../browser-tests/cdp.mjs';
const root = path.resolve(import.meta.dirname, '../..');
const c = await launch(9386);
await c.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 500, deviceScaleFactor: 1, mobile: false });
await c.goto('file://' + path.join(import.meta.dirname, 'feature-graphic.html'), 1800);
await c.ev(`document.fonts.ready.then(() => 'ok')`);
await c.shot(path.join(root, 'mobile/play-store/feature-graphic-1024x500.png'));
c.close();
console.log('feature graphic written');
