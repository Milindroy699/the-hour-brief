// Renders the static link-preview card /og-image.png from api/og.mjs (same code as the dynamic cards), so they always match.
//   node tools/brand/og.mjs            -> og-image.png
//   node tools/brand/og.mjs --samples DIR   also writes one sample of every dynamic card type to DIR
import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const root = path.resolve(import.meta.dirname, '../..');
process.chdir(root);                                   // api/og.mjs reads fonts/ and brand/ relative to the working directory
const { default: handler, brandCard, loadFonts } = await import(path.join(root, 'api/og.mjs'));

const svg = await satori(brandCard(), { width: 1200, height: 630, fonts: loadFonts() });
fs.writeFileSync(path.join(root, 'og-image.png'), new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng());
console.log('og-image.png written');

const at = process.argv.indexOf('--samples');
if (at > 0) {
  const dir = process.argv[at + 1];
  fs.mkdirSync(dir, { recursive: true });
  const samples = {
    edition: '/api/og?type=edition&d=2026-09-24&n=39&ai=' + encodeURIComponent('Trump and Xi meet with AI chip controls off the table') + '&biz=' + encodeURIComponent('Hughes Precision raises ₹250 crore; Brahma AI raises $150 million') + '&mkt=' + encodeURIComponent('NSE lists on the BSE after a record ₹22,569 crore IPO'),
    story: '/api/og?type=story&lane=mkt&d=2026-09-24&h=' + encodeURIComponent('Wall Street sells off as the 10-year Treasury yield hits its highest level since 2007') + '&t=' + encodeURIComponent('Rising bond yields, not earnings, were the story on Wall Street.'),
    quiz: '/api/og?type=quiz&d=2026-09-24&score=4&total=5&sq=11011',
    league: '/api/og?type=league&name=' + encodeURIComponent('Brave Otters'),
  };
  for (const [name, url] of Object.entries(samples)) {
    await handler({ url }, { setHeader() {}, status() { return { send(buf) { fs.writeFileSync(path.join(dir, `og_${name}.png`), buf); } }; } });
  }
  console.log('samples in', dir);
}
