/*
 * symbol-proof.js — headless verification + visual proof sheet for symbols.js.
 * Run: node tools/symbol-proof.js   (writes _stark/symbol-proof.svg)
 * Pure Node, no deps. Asserts structural invariants, then emits a proof grid.
 */
const Sym = require('../symbols.js');
const fs = require('fs');
const path = require('path');

const TYPES = ['Command', 'Sensor', 'Comms', 'Fires', 'Assault', 'Blockade', 'EW/Cyber', 'Logistics', 'Protection', 'Support'];
const TEAMS = ['blue', 'red', 'green', 'unk'];
const DOMAINS = ['Land', 'Air', 'Sea', 'Space', 'Cyber', 'EW'];

let failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.error('FAIL:', msg); } }

// --- Structural unit tests ---
TYPES.forEach(ty => {
  TEAMS.forEach(team => {
    const node = { id: 'X-' + ty + '-' + team, team, type: ty, domain: ['Land'], health: 100, healthMax: 100 };
    const s = Sym.svg(node);
    check(/^<svg[\s\S]*<\/svg>$/.test(s.trim()), 'valid svg for ' + ty + '/' + team);
    check(s.indexOf('NaN') === -1, 'no NaN in ' + ty + '/' + team);
    check(s.indexOf('undefined') === -1, 'no undefined in ' + ty + '/' + team);
  });
});

// Affiliation mapping
check(Sym.affiliation({ team: 'red' }) === 'hostile', 'red->hostile');
check(Sym.affiliation({ team: 'blue' }) === 'friend', 'blue->friend');
check(Sym.affiliation({ team: 'weird' }) === 'unknown', 'weird->unknown');

// Function normalization
check(Sym.functionId({ type: 'EW/Cyber' }) === 'ew', 'EW/Cyber->ew');
check(Sym.functionId({ type: 'Command' }) === 'command', 'Command->command');
check(Sym.functionId({ type: 'Relay' }) === 'comms', 'Relay->comms');

// Health ratio + status
check(Sym.healthRatio({ health: 50, healthMax: 100 }) === 0.5, 'health ratio 0.5');
check(Sym.svg({ team: 'red', type: 'Fires', health: 0, healthMax: 100 }).indexOf('#ff2d2d') > -1, 'destroyed shows red X');
check(Sym.svg({ team: 'blue', type: 'Fires', health: 20, healthMax: 100 }).indexOf('stroke-dasharray') > -1, 'damaged shows dashed frame');

// divIcon shape
const di = Sym.divIcon({ team: 'blue', type: 'Command' });
check(Array.isArray(di.iconSize) && di.html.indexOf('<svg') === 0, 'divIcon returns html+iconSize');

// Robustness: empty node must not throw
try { Sym.svg({}); check(true, 'empty node ok'); } catch (e) { check(false, 'empty node threw: ' + e.message); }

// --- Visual proof sheet: rows = type, cols = affiliation (+ a damaged & destroyed col) ---
const cell = 78, padL = 130, padT = 70;
const cols = TEAMS.length + 2; // + damaged + destroyed
const W = padL + cols * cell + 20;
const H = padT + TYPES.length * cell + 40;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui,Segoe UI,Arial">`;
svg += `<rect width="${W}" height="${H}" fill="#0a1420"/>`;
svg += `<text x="20" y="32" fill="#cfe6f5" font-size="20" font-weight="700">Strike Sim — Tactical Symbology Proof Sheet (symbols.js)</text>`;
svg += `<text x="20" y="52" fill="#7fa6bf" font-size="12">Affiliation = frame shape/color · Type = central glyph · Domain = dimension cue · Health = status modifier</text>`;

const colLabels = ['FRIEND (blue)', 'HOSTILE (red)', 'NEUTRAL', 'UNKNOWN', 'DAMAGED', 'DESTROYED'];
colLabels.forEach((lab, i) => {
  const cx = padL + i * cell + cell / 2;
  svg += `<text x="${cx}" y="${padT - 12}" fill="#9ec6dd" font-size="11" text-anchor="middle">${lab}</text>`;
});

TYPES.forEach((ty, r) => {
  const cy = padT + r * cell;
  svg += `<text x="${padL - 12}" y="${cy + cell / 2 + 4}" fill="#cfe6f5" font-size="13" text-anchor="end">${ty}</text>`;
  // domain rotates per row so the sheet also exercises dimension cues
  const dom = DOMAINS[r % DOMAINS.length];
  const variants = [
    { team: 'blue', health: 100 }, { team: 'red', health: 100 }, { team: 'green', health: 100 },
    { team: 'unk', health: 100 }, { team: 'red', health: 25 }, { team: 'blue', health: 0 }
  ];
  variants.forEach((v, c) => {
    const node = { id: ty, team: v.team, type: ty, domain: [dom], health: v.health, healthMax: 100, status: v.health === 0 ? 'Destroyed' : 'Active' };
    const inner = Sym.svg(node, { size: 56 }).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    const x = padL + c * cell + (cell - 56) / 2, y = cy + (cell - 56) / 2;
    svg += `<g transform="translate(${x},${y}) scale(${56 / 64})">${inner}</g>`;
  });
  svg += `<text x="${padL + cols * cell + 4}" y="${cy + cell / 2 + 4}" fill="#5e7d92" font-size="9">dom:${dom}</text>`;
});
svg += '</svg>';

const outDir = path.join(__dirname, '..', '_stark');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'symbol-proof.svg'), svg);

console.log(failures === 0 ? `\nALL CHECKS PASSED (${TYPES.length * TEAMS.length + 12} assertions). Proof sheet -> _stark/symbol-proof.svg` : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
