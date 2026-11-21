// Default pictures for the daily list: six per section, drawn as small SVGs in the brand's colours.
//
//   node tools/brand/story-art.mjs            -> brand/stories/{tech,biz,mkt}-{1..6}.svg (+ a contact sheet PNG in --sheet <file>)
//
// The stories themselves carry no pictures, so the list rotates through these (mobile.js storyArt): the first story
// of a section gets a wide banner, the others a small square. They are abstract on purpose (circuits, blocks, charts),
// so a picture never claims to show the actual news. Replace any file with real art of the same name (SVG or keep
// the name and change the extension in mobile.js ART_EXT) and the list picks it up.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'brand', 'stories');
const W = 800, H = 450;

// Seeded random, so the files only change when this script does
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const f = (n) => Math.round(n * 10) / 10;

const PAL = {
  tech: { bg: [['#14122B', '#2E1F86'], ['#0F1230', '#3B2A9E'], ['#191536', '#5E43F3'], ['#0E0D22', '#29227A'], ['#16133A', '#46309F'], ['#110F2A', '#3A2D8C']],
          ink: '#C7BFFF', hot: '#E8B04B', soft: 'rgba(199,191,255,0.18)', glow: '#8C7BFF' },
  biz:  { bg: [['#1B1430', '#5A3A12'], ['#14122B', '#6B4A14'], ['#221A33', '#8F5900'], ['#17122A', '#4D3A6E'], ['#1D1528', '#70501C'], ['#141127', '#5E43F3']],
          ink: '#FFDEAB', hot: '#E8B04B', soft: 'rgba(255,222,171,0.16)', glow: '#F6BD56' },
  mkt:  { bg: [['#0C1B1A', '#0F4A3D'], ['#0E1626', '#14594A'], ['#0B1820', '#1C3F5E'], ['#101A1C', '#22604F'], ['#0D1424', '#24406E'], ['#0A1A17', '#1B5E4C']],
          ink: '#B2CCC4', hot: '#5EE0B5', soft: 'rgba(178,204,196,0.16)', glow: '#5EE0B5', red: '#FF8A7A' },
};

function frame(pal, i, body, seed) {
  const [a, b] = pal.bg[i];
  const r = rng(seed * 7 + 3);
  const angle = [20, 135, 60, 160, 100, 40][i];
  // A few four-point sparks, the brand's motif
  let sparks = '';
  for (let k = 0; k < 4; k++) {
    const x = f(40 + r() * 720), y = f(30 + r() * 390), s = f(4 + r() * 7);
    sparks += `<path d="M${x} ${f(y - s)} Q${x} ${y} ${f(x + s)} ${y} Q${x} ${y} ${x} ${f(y + s)} Q${x} ${y} ${f(x - s)} ${y} Q${x} ${y} ${x} ${f(y - s)}Z" fill="${pal.ink}" opacity="${f(0.35 + r() * 0.4)}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="g" gradientTransform="rotate(${angle} .5 .5)"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
<radialGradient id="l" cx="${f(0.25 + r() * 0.5)}" cy="${f(0.3 + r() * 0.4)}" r=".6"><stop offset="0" stop-color="${pal.glow}" stop-opacity=".35"/><stop offset="1" stop-color="${pal.glow}" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#g)"/><rect width="${W}" height="${H}" fill="url(#l)"/>
${body}
${sparks}
</svg>
`;
}

// ---------- tech ----------
function circuit(p, r) {            // traces with right-angle turns ending in nodes, around a chip
  let s = '';
  const cx = 400, cy = 225;
  s += `<rect x="330" y="160" width="140" height="130" rx="18" fill="${p.soft}" stroke="${p.ink}" stroke-width="3"/>`;
  s += `<rect x="362" y="190" width="76" height="70" rx="10" fill="none" stroke="${p.hot}" stroke-width="3"/>`;
  for (let k = 0; k < 14; k++) {
    const side = k % 4, off = f(-50 + r() * 100);
    let x0, y0, x1, y1, x2, y2;
    if (side === 0) { x0 = 330; y0 = cy + off * 0.5; x1 = f(120 + r() * 150); y1 = y0; x2 = x1; y2 = f(y0 + (r() - 0.5) * 220); }
    else if (side === 1) { x0 = 470; y0 = cy + off * 0.5; x1 = f(520 + r() * 170); y1 = y0; x2 = x1; y2 = f(y0 + (r() - 0.5) * 220); }
    else if (side === 2) { x0 = cx + off * 0.6; y0 = 160; x1 = x0; y1 = f(40 + r() * 80); x2 = f(x0 + (r() - 0.5) * 300); y2 = y1; }
    else { x0 = cx + off * 0.6; y0 = 290; x1 = x0; y1 = f(330 + r() * 80); x2 = f(x0 + (r() - 0.5) * 300); y2 = y1; }
    s += `<path d="M${x0} ${y0}L${x1} ${y1}L${x2} ${y2}" fill="none" stroke="${p.ink}" stroke-width="2.5" opacity=".55" stroke-linecap="round" stroke-linejoin="round"/>`;
    s += `<circle cx="${x2}" cy="${y2}" r="6" fill="${k % 5 === 0 ? p.hot : p.ink}"/>`;
  }
  return s;
}
function network(p, r) {             // a small neural net: three layers of nodes
  const layers = [[3, 170], [5, 400], [3, 630]];
  const pts = layers.map(([n, x]) => Array.from({ length: n }, (_, k) => [x, f(225 + (k - (n - 1) / 2) * 78)]));
  let s = '';
  for (let L = 0; L < 2; L++) for (const a of pts[L]) for (const b of pts[L + 1]) s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${p.ink}" stroke-width="2" opacity="${f(0.2 + r() * 0.45)}"/>`;
  pts.flat().forEach(([x, y], k) => { s += `<circle cx="${x}" cy="${y}" r="${k === 5 ? 20 : 15}" fill="${k === 5 ? p.hot : '#14122B'}" stroke="${p.ink}" stroke-width="3"/>`; });
  return s;
}
function orbit(p, r) {               // the brand's tilted orbits around a glowing core
  let s = '';
  [[260, 70, -18], [200, 54, 24], [320, 90, 8]].forEach(([rx, ry, rot], k) => {
    s += `<ellipse cx="400" cy="225" rx="${rx}" ry="${ry}" fill="none" stroke="${p.ink}" stroke-width="2.5" opacity="${0.35 + k * 0.15}" transform="rotate(${rot} 400 225)"/>`;
    const t = r() * Math.PI * 2, x = 400 + rx * Math.cos(t), y = 225 + ry * Math.sin(t), a = rot * Math.PI / 180;
    const X = f(400 + (x - 400) * Math.cos(a) - (y - 225) * Math.sin(a)), Y = f(225 + (x - 400) * Math.sin(a) + (y - 225) * Math.cos(a));
    s += `<circle cx="${X}" cy="${Y}" r="9" fill="${k === 1 ? p.hot : p.ink}"/>`;
  });
  s += `<circle cx="400" cy="225" r="46" fill="${p.glow}" opacity=".35"/><circle cx="400" cy="225" r="28" fill="${p.ink}"/>`;
  return s;
}
function waveform(p, r) {            // an audio / signal waveform
  let s = '';
  for (let k = 0; k < 46; k++) {
    const x = 60 + k * 15.5, h = f(20 + Math.abs(Math.sin(k * 0.45 + r())) * 150 * (0.5 + r() * 0.5));
    s += `<rect x="${f(x)}" y="${f(225 - h / 2)}" width="8" height="${h}" rx="4" fill="${k % 9 === 4 ? p.hot : p.ink}" opacity="${f(0.45 + r() * 0.5)}"/>`;
  }
  return s;
}
function pixels(p, r) {              // a pixel grid lighting up, like a screen or a chip die
  let s = '';
  for (let y = 0; y < 7; y++) for (let x = 0; x < 14; x++) {
    const v = r();
    if (v < 0.35) continue;
    s += `<rect x="${92 + x * 46}" y="${66 + y * 46}" width="36" height="36" rx="8" fill="${v > 0.93 ? p.hot : p.ink}" opacity="${f(v > 0.93 ? 0.95 : 0.12 + v * 0.45)}"/>`;
  }
  return s;
}
function cloud(p, r) {               // racks of servers (a data centre), with status lights
  let s = '';
  for (let k = 0; k < 5; k++) {
    const x = 120 + k * 120;
    s += `<rect x="${x}" y="80" width="90" height="290" rx="12" fill="${p.soft}" stroke="${p.ink}" stroke-width="2.5" opacity=".9"/>`;
    for (let u = 0; u < 8; u++) {
      s += `<rect x="${x + 12}" y="${96 + u * 34}" width="66" height="22" rx="5" fill="none" stroke="${p.ink}" stroke-width="1.6" opacity=".5"/>`;
      s += `<circle cx="${x + 66}" cy="${107 + u * 34}" r="4" fill="${r() > 0.75 ? p.hot : p.ink}" opacity="${f(0.5 + r() * 0.5)}"/>`;
    }
  }
  return s;
}

// ---------- product & business ----------
function blocks(p, r) {              // stacked blocks rising, growth
  let s = '';
  for (let k = 0; k < 6; k++) {
    const h = 50 + k * 48 + r() * 20, x = 120 + k * 96;
    s += `<rect x="${x}" y="${f(380 - h)}" width="72" height="${f(h)}" rx="12" fill="${k === 5 ? p.hot : p.ink}" opacity="${k === 5 ? 0.95 : f(0.18 + k * 0.1)}"/>`;
  }
  s += `<path d="M110 300 C 300 260, 440 190, 640 92" fill="none" stroke="${p.hot}" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 14"/>`;
  s += `<path d="M612 84 L648 88 L636 122" fill="none" stroke="${p.hot}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
  return s;
}
function skyline(p, r) {             // an office skyline with lit windows
  let s = '', x = 60;
  while (x < 740) {
    const w = 60 + r() * 60, h = 120 + r() * 220;
    s += `<rect x="${f(x)}" y="${f(400 - h)}" width="${f(w)}" height="${f(h + 60)}" rx="6" fill="${p.soft}" stroke="${p.ink}" stroke-width="2" opacity=".95"/>`;
    for (let yy = 400 - h + 18; yy < 380; yy += 26) for (let xx = x + 12; xx < x + w - 14; xx += 20) if (r() > 0.45) s += `<rect x="${f(xx)}" y="${f(yy)}" width="9" height="12" rx="2" fill="${r() > 0.8 ? p.hot : p.ink}" opacity="${f(0.35 + r() * 0.5)}"/>`;
    x += w + 10;
  }
  return s;
}
function cards(p, r) {               // overlapping product cards / app screens
  let s = '';
  [[150, 120, -8, 0.35], [290, 90, 4, 0.55], [430, 110, -3, 0.95]].forEach(([x, y, rot, o], k) => {
    s += `<g transform="rotate(${rot} ${x + 110} ${y + 130})" opacity="${o}"><rect x="${x}" y="${y}" width="220" height="260" rx="22" fill="#1B1430" stroke="${p.ink}" stroke-width="2.5"/>`;
    s += `<rect x="${x + 20}" y="${y + 22}" width="180" height="90" rx="12" fill="${k === 2 ? p.hot : p.soft}" opacity="${k === 2 ? 0.85 : 1}"/>`;
    for (let l = 0; l < 4; l++) s += `<rect x="${x + 20}" y="${y + 132 + l * 26}" width="${f(80 + r() * 100)}" height="10" rx="5" fill="${p.ink}" opacity=".5"/>`;
    s += `</g>`;
  });
  return s;
}
function pie(p, r) {                 // a pie of shares (deals, ownership)
  const parts = [0.42, 0.24, 0.18, 0.16];
  let a0 = -Math.PI / 2, s = '';
  parts.forEach((v, k) => {
    const a1 = a0 + v * Math.PI * 2, R = k === 0 ? 150 : 138, cx = 400 + (k === 0 ? 14 * Math.cos((a0 + a1) / 2) : 0), cy = 225 + (k === 0 ? 14 * Math.sin((a0 + a1) / 2) : 0);
    const big = a1 - a0 > Math.PI ? 1 : 0;
    s += `<path d="M${f(cx)} ${f(cy)} L${f(cx + R * Math.cos(a0))} ${f(cy + R * Math.sin(a0))} A${R} ${R} 0 ${big} 1 ${f(cx + R * Math.cos(a1))} ${f(cy + R * Math.sin(a1))}Z" fill="${k === 0 ? p.hot : p.ink}" opacity="${k === 0 ? 0.95 : f(0.2 + k * 0.15)}" stroke="#1B1430" stroke-width="5"/>`;
    a0 = a1;
  });
  s += `<circle cx="400" cy="225" r="58" fill="#1B1430"/>`;
  return s;
}
function globe(p, r) {               // a globe with trade routes
  let s = `<circle cx="400" cy="225" r="150" fill="${p.soft}" stroke="${p.ink}" stroke-width="2.5"/>`;
  [40, 90, 130].forEach((rx) => { s += `<ellipse cx="400" cy="225" rx="${rx}" ry="150" fill="none" stroke="${p.ink}" stroke-width="1.6" opacity=".45"/>`; });
  [-90, -45, 0, 45, 90].forEach((dy) => { const w = Math.sqrt(150 * 150 - dy * dy); s += `<line x1="${f(400 - w)}" y1="${225 + dy}" x2="${f(400 + w)}" y2="${225 + dy}" stroke="${p.ink}" stroke-width="1.6" opacity=".45"/>`; });
  for (let k = 0; k < 3; k++) {
    const x1 = f(300 + r() * 60), y1 = f(150 + r() * 120), x2 = f(470 + r() * 60), y2 = f(130 + r() * 150);
    s += `<path d="M${x1} ${y1} Q ${f((+x1 + +x2) / 2)} ${f(Math.min(y1, y2) - 90)} ${x2} ${y2}" fill="none" stroke="${p.hot}" stroke-width="3.5" stroke-linecap="round"/>`;
    s += `<circle cx="${x1}" cy="${y1}" r="7" fill="${p.hot}"/><circle cx="${x2}" cy="${y2}" r="7" fill="${p.hot}"/>`;
  }
  return s;
}
function boxes(p, r) {               // isometric parcels: products, supply, retail
  let s = '';
  const iso = (x, y, w, h, c, o) => {
    const t = `M${x} ${y} l${w} ${-w / 2} l${w} ${w / 2} l${-w} ${w / 2}Z`;
    const l = `M${x} ${y} l${w} ${w / 2} l0 ${h} l${-w} ${-w / 2}Z`;
    const rr = `M${x + w} ${y + w / 2} l${w} ${-w / 2} l0 ${h} l${-w} ${w / 2}Z`;
    return `<g opacity="${o}"><path d="${t}" fill="${c}" opacity=".95"/><path d="${l}" fill="${c}" opacity=".6"/><path d="${rr}" fill="${c}" opacity=".35"/></g>`;
  };
  [[230, 250, 80, 80, p.ink, 0.55], [390, 200, 90, 90, p.hot, 0.95], [400, 330, 60, 60, p.ink, 0.45], [540, 270, 70, 70, p.ink, 0.7]].forEach((b) => { s += iso(...b); });
  return s;
}

// ---------- stock market ----------
function candles(p, r, n = 13) {     // candlesticks drifting up
  let s = '', price = 330;
  for (let k = 0; k < n; k++) {
    const o = price, c = price - 14 + (r() - 0.42) * 90, hi = Math.min(o, c) - 10 - r() * 30, lo = Math.max(o, c) + 10 + r() * 30, x = 80 + k * (640 / n), up = c < o;
    s += `<line x1="${f(x + 15)}" y1="${f(hi)}" x2="${f(x + 15)}" y2="${f(lo)}" stroke="${up ? p.hot : p.red}" stroke-width="3"/>`;
    s += `<rect x="${f(x)}" y="${f(Math.min(o, c))}" width="30" height="${f(Math.max(10, Math.abs(c - o)))}" rx="5" fill="${up ? p.hot : p.red}" opacity=".9"/>`;
    price = Math.max(120, Math.min(350, c));
  }
  return s;
}
function areaLine(p, r) {            // a price line with a soft area under it
  let pts = [], y = 320;
  for (let k = 0; k <= 30; k++) { y = Math.max(90, Math.min(360, y + (r() - 0.56) * 40)); pts.push([f(60 + k * 22.7), f(y)]); }
  const d = pts.map((q, k) => (k ? 'L' : 'M') + q[0] + ' ' + q[1]).join('');
  const last = pts[pts.length - 1];
  return `<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.hot}" stop-opacity=".45"/><stop offset="1" stop-color="${p.hot}" stop-opacity="0"/></linearGradient></defs>`
    + [140, 220, 300].map((g) => `<line x1="60" y1="${g}" x2="740" y2="${g}" stroke="${p.ink}" stroke-width="1" opacity=".25" stroke-dasharray="4 8"/>`).join('')
    + `<path d="${d}L740 420L60 420Z" fill="url(#a)"/><path d="${d}" fill="none" stroke="${p.hot}" stroke-width="4" stroke-linejoin="round"/>`
    + `<circle cx="${last[0]}" cy="${last[1]}" r="9" fill="${p.hot}"/><circle cx="${last[0]}" cy="${last[1]}" r="20" fill="${p.hot}" opacity=".25"/>`;
}
function barsMa(p, r) {              // volume bars with a moving average
  let s = '', ys = [];
  for (let k = 0; k < 26; k++) {
    const h = 40 + r() * 190, x = 70 + k * 26;
    s += `<rect x="${x}" y="${f(380 - h)}" width="16" height="${f(h)}" rx="4" fill="${r() > 0.35 ? p.ink : p.red}" opacity=".55"/>`;
    ys.push([x + 8, 380 - h]);
  }
  const ma = ys.map((q, k) => { const w = ys.slice(Math.max(0, k - 3), k + 1); return [q[0], w.reduce((a, b) => a + b[1], 0) / w.length]; });
  s += `<path d="${ma.map((q, k) => (k ? 'L' : 'M') + f(q[0]) + ' ' + f(q[1])).join('')}" fill="none" stroke="${p.hot}" stroke-width="4" stroke-linejoin="round"/>`;
  return s;
}
function donut(p, r) {               // an allocation donut with legend bars
  const parts = [0.38, 0.27, 0.2, 0.15], cols = [p.hot, p.ink, p.red, '#C7BFFF'];
  let a0 = -Math.PI / 2, s = '';
  parts.forEach((v, k) => {
    const a1 = a0 + v * Math.PI * 2 - 0.04, R = 130, cx = 280, cy = 225;
    s += `<path d="M${f(cx + R * Math.cos(a0))} ${f(cy + R * Math.sin(a0))} A${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${f(cx + R * Math.cos(a1))} ${f(cy + R * Math.sin(a1))}" fill="none" stroke="${cols[k]}" stroke-width="44" opacity=".9"/>`;
    s += `<rect x="480" y="${130 + k * 52}" width="26" height="26" rx="7" fill="${cols[k]}"/><rect x="522" y="${138 + k * 52}" width="${f(90 + r() * 110)}" height="10" rx="5" fill="${p.ink}" opacity=".5"/>`;
    a0 = a1 + 0.04;
  });
  return s;
}
function ticker(p, r) {              // rows of a ticker board, up and down arrows
  let s = '';
  for (let row = 0; row < 6; row++) {
    const y = 80 + row * 52, up = r() > 0.4;
    s += `<rect x="90" y="${y}" width="620" height="38" rx="10" fill="${p.soft}"/>`;
    s += `<rect x="110" y="${y + 14}" width="${f(70 + r() * 60)}" height="10" rx="5" fill="${p.ink}" opacity=".75"/>`;
    s += `<rect x="330" y="${y + 14}" width="${f(60 + r() * 50)}" height="10" rx="5" fill="${p.ink}" opacity=".4"/>`;
    s += up ? `<path d="M600 ${y + 26} l12 -14 l12 14Z" fill="${p.hot}"/>` : `<path d="M600 ${y + 12} l12 14 l12 -14Z" fill="${p.red}"/>`;
    s += `<rect x="636" y="${y + 14}" width="54" height="10" rx="5" fill="${up ? p.hot : p.red}" opacity=".9"/>`;
  }
  return s;
}
function bullBear(p, r) {            // two crossing trend lines, up and down
  let up = 'M60 360', dn = 'M60 110', yu = 360, yd = 110;
  for (let k = 1; k <= 20; k++) { yu = Math.max(80, yu - 12 + (r() - 0.5) * 34); yd = Math.min(370, yd + 11 + (r() - 0.5) * 34); up += ` L${60 + k * 34} ${f(yu)}`; dn += ` L${60 + k * 34} ${f(yd)}`; }
  return `<path d="${dn}" fill="none" stroke="${p.red}" stroke-width="4" opacity=".75" stroke-linejoin="round"/><path d="${up}" fill="none" stroke="${p.hot}" stroke-width="5" stroke-linejoin="round"/>`
    + `<circle cx="740" cy="${f(yu)}" r="10" fill="${p.hot}"/>`;
}

const SETS = {
  tech: [circuit, network, orbit, waveform, pixels, cloud],
  biz: [blocks, skyline, cards, pie, globe, boxes],
  mkt: [(p, r) => candles(p, r), areaLine, barsMa, donut, ticker, bullBear],
};

mkdirSync(OUT, { recursive: true });
const made = [];
for (const [lane, fns] of Object.entries(SETS)) {
  fns.forEach((fn, i) => {
    const seed = lane.charCodeAt(0) * 100 + i * 17 + 5;
    const svg = frame(PAL[lane], i, fn(PAL[lane], rng(seed)), seed);
    const file = join(OUT, `${lane}-${i + 1}.svg`);
    writeFileSync(file, svg);
    made.push(file);
  });
}
console.log(`${made.length} pictures -> brand/stories/`);

const sheetAt = process.argv.indexOf('--sheet');
if (sheetAt > 0) {
  const { Resvg } = await import('@resvg/resvg-js');
  const { readFileSync } = await import('node:fs');
  const cell = (file, x, y) => `<image href="data:image/svg+xml;base64,${readFileSync(file).toString('base64')}" x="${x}" y="${y}" width="400" height="225"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${6 * 410 + 10}" height="${3 * 235 + 10}"><rect width="100%" height="100%" fill="#fff"/>${made.map((m, k) => cell(m, 10 + (k % 6) * 410, 10 + Math.floor(k / 6) * 235)).join('')}</svg>`;
  writeFileSync(process.argv[sheetAt + 1], new Resvg(svg).render().asPng());
  console.log('sheet ->', process.argv[sheetAt + 1]);
}
