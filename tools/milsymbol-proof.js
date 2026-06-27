/*
 * milsymbol-proof.js — verify the milsymbol adapter in symbols.js against the REAL OOB.
 * Loads vendor/milsymbol.js into a global `ms` (as the browser would), then renders the
 * bundled scenario through SymbolModule and reports SIDC validity + writes a proof image.
 * Run: node tools/milsymbol-proof.js
 */
const path = require('path');
const fs = require('fs');

// Emulate the browser: expose milsymbol as the global `ms` before loading symbols.js.
global.ms = require(path.join(__dirname, '..', 'vendor', 'milsymbol.js'));
global.window = global; // symbols.js getMs() checks window.ms
const Sym = require(path.join(__dirname, '..', 'symbols.js'));

console.log('SymbolModule.usingMil():', Sym.usingMil());

const red = require('../grok150red.json').nodes;
const blue = require('../grokblue90.json').nodes;
const nodes = red.concat(blue).filter(n => n.lat != null && n.lon != null);

let validCount = 0, total = 0;
const bySidc = {};
nodes.forEach(n => {
  total++;
  const sidc = Sym.sidcFor(n);
  bySidc[sidc] = (bySidc[sidc] || 0) + 1;
  const s = new global.ms.Symbol(sidc, { size: 30 });
  if (s.isValid && s.isValid()) validCount++;
});
console.log(`SIDC valid (domain dimension): ${validCount}/${total}`);
console.log('Distinct SIDCs:', Object.keys(bySidc).length);

// Proof sheet: real nodes on an equirectangular theater frame, rendered via milsymbol.
const LAT0 = 55, LAT1 = -12, LON0 = 95, LON1 = 150;
const W = 1000, H = 760, padT = 54;
const px = lon => ((lon - LON0) / (LON1 - LON0)) * (W - 40) + 20;
const py = lat => padT + ((LAT0 - lat) / (LAT0 - LAT1)) * (H - padT - 20);
let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui,Arial">`;
out += `<rect width="${W}" height="${H}" fill="#071019"/>`;
for (let lon = 100; lon <= 150; lon += 10) out += `<line x1="${px(lon)}" y1="${padT}" x2="${px(lon)}" y2="${H - 20}" stroke="#13283a"/>`;
for (let lat = 50; lat >= -10; lat -= 10) out += `<line x1="20" y1="${py(lat)}" x2="${W - 20}" y2="${py(lat)}" stroke="#13283a"/>`;
out += `<text x="20" y="32" fill="#cfe6f5" font-size="20" font-weight="700">Strike Sim — Real OOB via milsymbol (MIL-STD-2525C), ${nodes.length} units</text>`;
nodes.forEach(n => {
  const x = px(n.lon), y = py(n.lat);
  if (x < 0 || x > W || y < padT || y > H) return;
  const imp = Math.max(0, Math.min(12, Number(n.importance) || 4));
  const size = Math.round(22 + imp * 1.3);
  const di = Sym.divIcon(n, { size });
  const w = di.iconSize[0], h = di.iconSize[1];
  // milsymbol returns a standalone <svg width h viewBox>. Position it by injecting x/y
  // into its own opening tag and keeping its intrinsic width/height/viewBox.
  out += di.html.replace(/^<svg /, `<svg x="${(x - w / 2).toFixed(1)}" y="${(y - h / 2).toFixed(1)}" `);
});
out += '</svg>';
fs.mkdirSync(path.join(__dirname, '..', '_stark'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', '_stark', 'milsymbol-proof.svg'), out);
console.log('-> _stark/milsymbol-proof.svg');
