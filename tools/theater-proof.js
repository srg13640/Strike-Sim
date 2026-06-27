/*
 * theater-proof.js — render the REAL bundled OOB (grok*.json) through symbols.js
 * onto a simple equirectangular theater frame, to verify the data->symbol pipeline
 * on actual scenario nodes (not synthetic). Writes _stark/theater-proof.svg.
 */
const Sym = require('../symbols.js');
const fs = require('fs');
const path = require('path');

const red = require('../grok150red.json').nodes;
const blue = require('../grokblue90.json').nodes;
const nodes = red.concat(blue).filter(n => n.lat != null && n.lon != null);

// Indo-Pacific window
const LAT0 = 55, LAT1 = -12, LON0 = 95, LON1 = 150;
const W = 1000, H = 760, padT = 54;
function px(lon) { return ((lon - LON0) / (LON1 - LON0)) * (W - 40) + 20; }
function py(lat) { return padT + ((LAT0 - lat) / (LAT0 - LAT1)) * (H - padT - 20); }

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui,Arial">`;
svg += `<rect width="${W}" height="${H}" fill="#071019"/>`;
// graticule
for (let lon = 100; lon <= 150; lon += 10) svg += `<line x1="${px(lon)}" y1="${padT}" x2="${px(lon)}" y2="${H - 20}" stroke="#13283a" stroke-width="1"/><text x="${px(lon) + 2}" y="${H - 6}" fill="#3c5a6e" font-size="10">${lon}E</text>`;
for (let lat = 50; lat >= -10; lat -= 10) svg += `<line x1="20" y1="${py(lat)}" x2="${W - 20}" y2="${py(lat)}" stroke="#13283a" stroke-width="1"/><text x="22" y="${py(lat) - 2}" fill="#3c5a6e" font-size="10">${lat}N</text>`;
svg += `<text x="20" y="32" fill="#cfe6f5" font-size="20" font-weight="700">Strike Sim — Real OOB rendered as tactical symbols (${nodes.length} units)</text>`;

let counts = {};
nodes.forEach(n => {
  const x = px(n.lon), y = py(n.lat);
  if (x < 0 || x > W || y < padT || y > H) return;
  const imp = Math.max(0, Math.min(12, Number(n.importance) || 4));
  const size = Math.round(20 + imp * 1.1);
  const inner = Sym.svg(n, { size: 64 }).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const sc = size / 64;
  svg += `<g transform="translate(${x - size / 2},${y - size / 2}) scale(${sc})">${inner}</g>`;
  const fn = Sym.functionId(n); counts[fn] = (counts[fn] || 0) + 1;
});
svg += '</svg>';

fs.mkdirSync(path.join(__dirname, '..', '_stark'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', '_stark', 'theater-proof.svg'), svg);
console.log('Rendered', nodes.length, 'real nodes. Function mix:', JSON.stringify(counts));
console.log('-> _stark/theater-proof.svg');
