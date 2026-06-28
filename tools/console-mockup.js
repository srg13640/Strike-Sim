/*
 * console-mockup.js — design mock of the rebuilt "operations console" chrome:
 * a top command bar (brand + view switcher + global actions), docked left/right rails,
 * a center map with real milsymbol symbols + a range ring, and a DOCKED node-detail panel
 * (no more floating overlap). SVG -> _stark/console-mockup.svg. Design reference only.
 */
const path = require('path'); const fs = require('fs');
global.ms = require(path.join(__dirname, '..', 'vendor', 'milsymbol.js')); global.window = global;
const Sym = require(path.join(__dirname, '..', 'symbols.js'));
const W = 1600, H = 900, BAR = 54, RAILL = 300, RAILR = 364;
const C = { bg: '#0a1119', bar0: '#102234', bar1: '#0a1826', panel: '#0e1822', line: '#1b3247', accent: '#4bb8ff', blue: '#5fb0e6', red: '#e0584a', txt: '#dfeaf5', mut: '#8fa8c0', go: '#46d57e', amber: '#e8b54a' };
let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter,system-ui,Arial">`;
s += `<rect width="${W}" height="${H}" fill="${C.bg}"/>`;

// ---- center map area (under rails) ----
s += `<rect x="${RAILL}" y="${BAR}" width="${W - RAILL - RAILR}" height="${H - BAR}" fill="#08121d"/>`;
for (let i = 0; i < 14; i++) s += `<line x1="${RAILL + i * 70}" y1="${BAR}" x2="${RAILL + i * 70}" y2="${H}" stroke="#0e1d2b"/>`;
for (let i = 0; i < 12; i++) s += `<line x1="${RAILL}" y1="${BAR + i * 70}" x2="${W - RAILR}" y2="${BAR + i * 70}" stroke="#0e1d2b"/>`;
// a range ring + a few real symbols
const cx = 760, cy = 430;
s += `<circle cx="${cx}" cy="${cy}" r="150" fill="none" stroke="rgba(224,88,74,.55)" stroke-width="1.5"/>`;
s += `<circle cx="${cx + 120}" cy="${cy + 60}" r="90" fill="none" stroke="rgba(95,176,230,.55)" stroke-width="1.4" stroke-dasharray="6 5"/>`;
const place = (node, x, y, sz) => { const svg = Sym.svg(node, { size: sz }).replace(/^<svg /, `<svg x="${x}" y="${y}" `); return svg; };
s += place({ team: 'red', type: 'Command', domain: ['Land'], health: 100, healthMax: 100 }, cx - 18, cy - 18, 36);
s += place({ team: 'red', type: 'Fires', domain: ['Land'], health: 70, healthMax: 100 }, cx - 70, cy + 40, 30);
s += place({ team: 'red', type: 'Sensor', domain: ['Air'], health: 100, healthMax: 100 }, cx + 60, cy - 60, 30);
s += place({ team: 'blue', type: 'Fires', domain: ['Sea'], health: 100, healthMax: 100 }, cx + 130, cy + 50, 30);
s += place({ team: 'blue', type: 'Command', domain: ['Air'], health: 100, healthMax: 100 }, cx + 200, cy - 30, 32);

// ---- left rail ----
s += `<rect x="0" y="${BAR}" width="${RAILL}" height="${H - BAR}" fill="${C.panel}"/><line x1="${RAILL}" y1="${BAR}" x2="${RAILL}" y2="${H}" stroke="${C.line}"/>`;
const hdr = (x, y, w, t) => `<text x="${x}" y="${y}" fill="${C.mut}" font-size="10.5" font-weight="700" letter-spacing="2" font-family="Oswald,Inter">${t}</text>`;
const btn = (x, y, w, t, on) => `<rect x="${x}" y="${y}" width="${w}" height="30" rx="6" fill="${on ? '#18466a' : '#11202e'}" stroke="${on ? C.accent : '#1d3447'}"/><text x="${x + w / 2}" y="${y + 19}" text-anchor="middle" fill="${on ? '#eaf6ff' : '#bcd2e4'}" font-size="11.5" font-weight="600">${t}</text>`;
let ly = BAR + 22;
s += hdr(16, ly, 0, 'VIEW'); ly += 10;
s += btn(16, ly, 130, 'Recenter') + btn(154, ly, 130, 'Reset Scenario'); ly += 40;
s += hdr(16, ly, 0, 'HIGHLIGHT'); ly += 10;
s += btn(16, ly, 130, 'High Payoff', true) + btn(154, ly, 130, 'High Risk'); ly += 38;
s += btn(16, ly, 130, 'Contrast') + btn(154, ly, 130, 'Legend'); ly += 44;
s += hdr(16, ly, 0, 'SESSION'); ly += 10;
s += btn(16, ly, 130, 'Strike Selected') + btn(154, ly, 130, 'Summary'); ly += 46;
s += hdr(16, ly, 0, 'DATA'); ly += 10;
s += btn(16, ly, 130, 'Export JSON') + btn(154, ly, 130, 'Import JSON'); ly += 50;
// legend
s += hdr(16, ly, 0, 'LEGEND'); ly += 16;
[['Friend', C.blue], ['Hostile', C.red], ['High payoff', C.accent], ['High risk', '#ff8a65']].forEach((g, i) => { s += `<rect x="16" y="${ly + i * 22 - 9}" width="11" height="11" rx="2" fill="${g[1]}"/><text x="34" y="${ly + i * 22}" fill="${C.txt}" font-size="11">${g[0]}</text>`; });

// ---- right rail ----
const RX = W - RAILR;
s += `<rect x="${RX}" y="${BAR}" width="${RAILR}" height="${H - BAR}" fill="${C.panel}"/><line x1="${RX}" y1="${BAR}" x2="${RX}" y2="${H}" stroke="${C.line}"/>`;
let ry = BAR + 22;
s += hdr(RX + 16, ry, 0, 'FORCE STATUS'); ry += 14;
[['BLUE', C.blue, 0.86, '104/104', 156], ['RED', C.red, 1.0, '120/120', 350]].forEach(t => {
  s += `<text x="${RX + 16}" y="${ry + 14}" fill="${t[1]}" font-size="12" font-weight="700">${t[0]}</text><text x="${RX + RAILR - 16}" y="${ry + 14}" text-anchor="end" fill="${C.mut}" font-size="10.5">${t[3]} · ${t[4]} pts</text>`;
  s += `<rect x="${RX + 16}" y="${ry + 22}" width="${RAILR - 32}" height="6" rx="3" fill="#15283a"/><rect x="${RX + 16}" y="${ry + 22}" width="${(RAILR - 32) * t[2]}" height="6" rx="3" fill="${t[1]}"/>`; ry += 44;
});
ry += 6; s += hdr(RX + 16, ry, 0, 'SEARCH'); ry += 10;
s += `<rect x="${RX + 16}" y="${ry}" width="${RAILR - 90}" height="30" rx="6" fill="#0b1620" stroke="#1d3447"/><text x="${RX + 26}" y="${ry + 19}" fill="#5e7d92" font-size="11">Find by ID or name</text>` + btn(RX + RAILR - 66, ry, 50, 'Find'); ry += 46;
s += hdr(RX + 16, ry, 0, 'COURSE OF ACTION'); ry += 12;
s += btn(RX + 16, ry, RAILR - 32, 'Generate COA', false); ry += 40;
s += `<text x="${RX + 16}" y="${ry + 4}" fill="${C.mut}" font-size="10.5">Target (Red)</text>`; ry += 12;
s += `<rect x="${RX + 16}" y="${ry}" width="${RAILR - 32}" height="30" rx="6" fill="#0b1620" stroke="#1d3447"/><text x="${RX + 26}" y="${ry + 19}" fill="#bcd2e4" font-size="11">CMC Joint Ops — val 84, hp 100</text>`; ry += 46;
s += hdr(RX + 16, ry, 0, 'MONTE CARLO'); ry += 12;
s += btn(RX + 16, ry, 96, 'Quick') + btn(RX + 120, ry, 96, 'Balanced', true) + btn(RX + 224, ry, 96, 'High Conf'); ry += 40;
s += btn(RX + 16, ry, RAILR - 32, 'Run 10,000 Trials', false).replace('#11202e', '#15532f').replace('#1d3447', '#2e9e5b');

// ---- docked node-detail (bottom-left of center, NOT over the rail) ----
const NDx = RAILL + 20, NDy = H - 220, NDw = 320, NDh = 196;
s += `<rect x="${NDx}" y="${NDy}" width="${NDw}" height="${NDh}" rx="10" fill="rgba(12,22,33,.96)" stroke="#244d6e"/>`;
s += `<text x="${NDx + 16}" y="${NDy + 26}" fill="#eaf4ff" font-size="13" font-weight="700" font-family="Oswald,Inter">PLA-FIR-014 · YJ-18 Battery</text>`;
s += `<text x="${NDx + 16}" y="${NDy + 46}" fill="${C.mut}" font-size="11">Team: <tspan fill="${C.red}">RED</tspan> · Fires · Sea · Mobile</text>`;
[['Health', '70 / 100', C.amber], ['Vuln', 'ASCM', C.txt], ['Coords', '30.05, 121.50', C.txt]].forEach((r, i) => { s += `<text x="${NDx + 16}" y="${NDy + 70 + i * 20}" fill="${C.mut}" font-size="11">${r[0]}</text><text x="${NDx + 110}" y="${NDy + 70 + i * 20}" fill="${r[2]}" font-size="11" font-family="monospace">${r[1]}</text>`; });
s += btn(NDx + 16, NDy + 150, 90, 'Strike').replace('#11202e', '#5e1a1a').replace('#1d3447', '#9e3b3b') + btn(NDx + 114, NDy + 150, 90, 'Add to COA') + btn(NDx + 212, NDy + 150, 92, 'Close');

// ---- TOP COMMAND BAR (drawn last = on top) ----
s += `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.bar0}"/><stop offset="1" stop-color="${C.bar1}"/></linearGradient></defs>`;
s += `<rect x="0" y="0" width="${W}" height="${BAR}" fill="url(#bg)"/><line x1="0" y1="${BAR}" x2="${W}" y2="${BAR}" stroke="${C.accent}" stroke-opacity="0.5"/>`;
// brand
s += `<path d="M18 16 l16 0 -4 22 -16 0 z" fill="${C.accent}" opacity="0.85"/>`;
s += `<text x="46" y="26" fill="#eaf6ff" font-size="17" font-weight="700" letter-spacing="3" font-family="Oswald,Inter">STRIKESIM 2040</text>`;
s += `<text x="46" y="42" fill="${C.mut}" font-size="9.5" letter-spacing="1.5">MULTI-DOMAIN STRIKE WARGAME · NOTIONAL // UNCLASS</text>`;
// center segmented view switcher
const seg = ['3D', 'MAP', 'TABLE', 'TASK ORG']; const segW = 96; const segX = W / 2 - (seg.length * segW) / 2;
s += `<rect x="${segX - 2}" y="11" width="${seg.length * segW + 4}" height="32" rx="8" fill="#0b1825" stroke="#1d3447"/>`;
seg.forEach((v, i) => { const on = v === 'MAP'; s += `<rect x="${segX + i * segW}" y="13" width="${segW}" height="28" rx="6" fill="${on ? '#18466a' : 'transparent'}"/><text x="${segX + i * segW + segW / 2}" y="31" text-anchor="middle" fill="${on ? '#eaf6ff' : C.mut}" font-size="12" font-weight="${on ? 700 : 500}" letter-spacing="1">${v}</text>`; });
// right global actions
const acts = [['▣ Campaign', '#15324a', '#2c6f9b'], ['⚔ War Game', '#1d4e30', '#2e9e5b'], ['⛶ Fullscreen', '#15324a', '#2c6f9b']];
let ax = W - 16;
acts.slice().reverse().forEach(a => { const w = a[0].length * 8 + 26; ax -= w; s += `<rect x="${ax}" y="12" width="${w}" height="30" rx="7" fill="${a[1]}" stroke="${a[2]}"/><text x="${ax + w / 2}" y="31" text-anchor="middle" fill="#dff1ff" font-size="12" font-weight="600">${a[0]}</text>`; ax -= 8; });
s += '</svg>';
fs.writeFileSync(path.join(__dirname, '..', '_stark', 'console-mockup.svg'), s);
console.log('-> _stark/console-mockup.svg');
