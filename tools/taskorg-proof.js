/*
 * taskorg-proof.js — render a representative slice of the rebuilt Task Org cards
 * (team header + unit cards with real milsymbol icons, health bars, importance) so the
 * new card design can be eyeballed without a browser. Approximates the D3 layout.
 * Run: node tools/taskorg-proof.js -> _stark/taskorg-proof.svg
 */
const path = require('path'); const fs = require('fs');
global.ms = require(path.join(__dirname, '..', 'vendor', 'milsymbol.js'));
global.window = global;
const Sym = require(path.join(__dirname, '..', 'symbols.js'));

const red = require('../grok150red.json').nodes, blue = require('../grokblue90.json').nodes;
function pickTeam(nodes, team) {
  const cmd = nodes.find(n => /command/i.test(n.type || '')) || nodes[0];
  const subs = nodes.filter(n => n !== cmd).slice(0, 4);
  return { cmd, subs, team };
}
const cols = [pickTeam(blue, 'blue'), pickTeam(red, 'red')];

const W = 1040, H = 520, cardW = 216, cardH = 58;
const colColor = { blue: '#5fb0e6', red: '#e2685c' };
let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter,system-ui,Arial">`;
out += `<rect width="${W}" height="${H}" fill="#0a1320"/>`;
out += `<text x="20" y="30" fill="#cfe6f5" font-size="18" font-weight="700">Strike Sim — rebuilt Task Org cards (real milsymbol icons)</text>`;

function card(x, y, node, color, opts) {
  opts = opts || {};
  let g = '';
  if (opts.header) {
    g += `<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="9" fill="${color === colColor.red ? '#241218' : '#10243a'}" stroke="${color}" stroke-width="1.6"/>`;
    g += `<text x="${x + 16}" y="${y + 25}" fill="#eef4fb" font-size="14" font-weight="700" letter-spacing="1">${opts.title}</text>`;
    g += `<text x="${x + 16}" y="${y + 43}" fill="#8fa8c0" font-size="10.5">${opts.sub}</text>`;
    g += `<text x="${x + cardW - 14}" y="${y + 32}" text-anchor="end" fill="${color}" font-size="16">▾</text>`;
    return g;
  }
  g += `<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="7" fill="#0d1825" stroke="${color}" stroke-width="1.4"/>`;
  g += `<rect x="${x}" y="${y}" width="4" height="${cardH}" rx="2" fill="${color}"/>`;
  const sym = Sym.svg(node, { size: 38 });
  g += sym.replace(/^<svg /, `<svg x="${x + 8}" y="${y + (cardH - 38) / 2}" `);
  const tx = x + 56;
  const nm = (node.name || '').length > 25 ? node.name.slice(0, 24) + '…' : node.name;
  g += `<text x="${tx}" y="${y + 21}" fill="#eef4fb" font-size="12.5" font-weight="700">${nm.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`;
  const sub = [node.type, (node.domain || []).join('/')].filter(Boolean).join(' · ');
  g += `<text x="${tx}" y="${y + 36}" fill="#8fa8c0" font-size="10.5">${sub}</text>`;
  const hf = Math.max(0, Math.min(1, (node.health == null ? 100 : node.health) / (node.healthMax || 100)));
  const barW = cardW - 56 - 14;
  const hc = hf > 0.66 ? '#46d57e' : (hf > 0.33 ? '#e8b54a' : '#e8584a');
  g += `<rect x="${tx}" y="${y + 43}" width="${barW}" height="5" rx="2.5" fill="#1b2a38"/>`;
  g += `<rect x="${tx}" y="${y + 43}" width="${Math.max(2, barW * hf).toFixed(0)}" height="5" rx="2.5" fill="${hc}"/>`;
  if (node.importance != null) g += `<text x="${x + cardW - 12}" y="${y + 21}" text-anchor="end" fill="#ffd86b" font-size="10.5" font-weight="700">★ ${node.importance}</text>`;
  return g;
}

cols.forEach((c, ci) => {
  const cx = 40 + ci * 520;
  const color = colColor[c.team];
  out += card(cx + 140, 60, null, color, { header: true, title: (c.team === 'blue' ? 'BLUE (US / ALLIED)' : 'RED (PLA)'), sub: '5 units · click to collapse' });
  // simulate damage variety
  const dmg = [100, 64, 100, 28, 88];
  out += card(cx + 140, 150, c.cmd, color);
  c.subs.forEach((s, i) => {
    const node = Object.assign({}, s, { health: dmg[i + 1] });
    const y = 240 + i * 70;
    out += `<path d="M${cx + 140 + 30} 208 V${y + cardH / 2 - 20} H${cx + 60 + 60} V${y + cardH / 2}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.45"/>`;
    out += card(cx + 60, y, node, color);
  });
});
out += '</svg>';
fs.mkdirSync(path.join(__dirname, '..', '_stark'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', '_stark', 'taskorg-proof.svg'), out);
console.log('-> _stark/taskorg-proof.svg');
