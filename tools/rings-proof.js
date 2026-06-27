/*
 * rings-proof.js — approximate render of the engagement-zone overlay (top-N rings) plus
 * milsymbol symbols, to sanity-check density/look before a browser refresh.
 * Rings drawn as lat/lon ellipses (km->deg); the live map uses geodesic L.circle.
 * Run: node tools/rings-proof.js  -> _stark/rings-proof.svg
 */
const path = require('path'); const fs = require('fs');
global.ms = require(path.join(__dirname, '..', 'vendor', 'milsymbol.js'));
global.window = global;
const Sym = require(path.join(__dirname, '..', 'symbols.js'));

const red = require('../grok150red.json').nodes, blue = require('../grokblue90.json').nodes;
const nodes = red.concat(blue).filter(n => n.lat != null && n.lon != null);

function zone(n) {
  const ty = String(n.type || '').toLowerCase(), sub = String(n.subsystem || '').toLowerCase();
  const imp = Math.max(1, Math.min(12, Number(n.importance) || 4));
  if (ty.includes('fire') || /firepower|strike|missile|artil/.test(sub)) return { km: 260 + imp * 145, kind: 'fires' };
  if (ty.includes('protect') || ty.includes('defen') || /air ?defen|sam|ada/.test(sub)) return { km: 120 + imp * 26, kind: 'airdef' };
  if (ty.includes('sensor') || ty.includes('isr') || ty.includes('radar')) return { km: 220 + imp * 38, kind: 'sensor' };
  return null;
}
function style(kind, team) {
  const b = team === 'red' ? [228, 76, 60] : [80, 168, 224];
  const rgba = a => `rgba(${b[0]},${b[1]},${b[2]},${a})`;
  if (kind === 'fires') return { s: rgba(.6), f: rgba(.07), d: '' };
  if (kind === 'airdef') return { s: rgba(.65), f: rgba(.05), d: '6 5' };
  return { s: rgba(.45), f: rgba(.03), d: '2 5' };
}

const LAT0 = 55, LAT1 = -12, LON0 = 95, LON1 = 150, W = 1000, H = 760, padT = 54;
const px = lon => ((lon - LON0) / (LON1 - LON0)) * (W - 40) + 20;
const py = lat => padT + ((LAT0 - lat) / (LAT0 - LAT1)) * (H - padT - 20);
const degPerPxLon = (LON1 - LON0) / (W - 40), degPerPxLat = (LAT0 - LAT1) / (H - padT - 20);

let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui,Arial">`;
out += `<rect width="${W}" height="${H}" fill="#0a141f"/>`;
for (let lon = 100; lon <= 150; lon += 10) out += `<line x1="${px(lon)}" y1="${padT}" x2="${px(lon)}" y2="${H - 20}" stroke="#152838"/>`;
for (let lat = 50; lat >= -10; lat -= 10) out += `<line x1="20" y1="${py(lat)}" x2="${W - 20}" y2="${py(lat)}" stroke="#152838"/>`;
out += `<text x="20" y="32" fill="#cfe6f5" font-size="19" font-weight="700">Strike Sim — engagement zones (top 22) + tactical symbols</text>`;

// rings: top-22 by importance
const cand = nodes.map(n => ({ n, z: zone(n), imp: Number(n.importance) || 0 })).filter(c => c.z && c.imp >= 6).sort((a, b) => b.imp - a.imp).slice(0, 22);
cand.forEach(({ n, z }) => {
  const st = style(z.kind, n.team);
  const rx = (z.km / 111) / degPerPxLon, ry = (z.km / 111) / degPerPxLat;
  out += `<ellipse cx="${px(n.lon).toFixed(0)}" cy="${py(n.lat).toFixed(0)}" rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}" fill="${st.f}" stroke="${st.s}" stroke-width="1.3"${st.d ? ` stroke-dasharray="${st.d}"` : ''}/>`;
});
// symbols on top
nodes.forEach(n => {
  const x = px(n.lon), y = py(n.lat); if (x < 0 || x > W || y < padT) return;
  const imp = Math.max(0, Math.min(12, Number(n.importance) || 4));
  const size = Math.round(17 + imp * 0.9);
  const di = Sym.divIcon(n, { size }); const w = di.iconSize[0], h = di.iconSize[1];
  out += di.html.replace(/^<svg /, `<svg x="${(x - w / 2).toFixed(1)}" y="${(y - h / 2).toFixed(1)}" `);
});
out += '</svg>';
fs.mkdirSync(path.join(__dirname, '..', '_stark'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', '_stark', 'rings-proof.svg'), out);
console.log('rings:', cand.length, '-> _stark/rings-proof.svg');
