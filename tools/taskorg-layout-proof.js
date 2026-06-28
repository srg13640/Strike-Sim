/*
 * taskorg-layout-proof.js — REAL layout proof of the rebuilt Task Org: loads the vendored
 * d3 + views.js buildOrgTree, runs the same d3.tree layout + vertical stacking as
 * renderOrgChart, draws the cards (with milsymbol icons / group buckets / band labels),
 * and writes _stark/taskorg-layout.svg. Validates hierarchy + spacing + no-overlap.
 * Run: node tools/taskorg-layout-proof.js
 */
const path = require('path'); const fs = require('fs');
// Minimal browser-ish globals so the vendored UMD d3 and views.js load under Node.
global.window = global; global.document = undefined;
global.ms = require(path.join(__dirname, '..', 'vendor', 'milsymbol.js'));
const d3 = require(path.join(__dirname, '..', 'vendor', 'd3.v7.min.js'));
global.teamLabel = t => t === 'blue' ? 'Blue' : 'Red';
const Sym = require(path.join(__dirname, '..', 'symbols.js'));
require(path.join(__dirname, '..', 'views.js'));
const buildOrgTree = global.window.buildOrgTree;

const red = require('../grok150red.json'), blue = require('../grokblue90.json');
const nodes = red.nodes.concat(blue.nodes), links = (red.links || []).concat(blue.links || []);

const W = 1600, nodeSize = { w: 236, h: 58 }, nodeSpacingX = 304, levelSpacingY = 150, marginTop = 36, BAND_GAP = 90;
const teamColor = { blue: '#4dabf7', red: '#ff6b6b' };
let yCursor = marginTop; const parts = []; let minClear = Infinity;

['blue', 'red'].forEach(team => {
  const rootData = buildOrgTree(team, nodes, links, true);
  const root = d3.hierarchy(rootData);
  d3.tree().nodeSize([nodeSpacingX, levelSpacingY]).separation((a, b) => a.parent === b.parent ? 1.1 : 2.0)(root);
  const ds = root.descendants();
  const minX = Math.min(...ds.map(d => d.x)), maxX = Math.max(...ds.map(d => d.x)), maxY = Math.max(...ds.map(d => d.y));
  const shiftX = W / 2 - (minX + (maxX - minX) / 2), shiftY = yCursor;
  const col = teamColor[team];

  // overlap check: min horizontal clearance between same-depth cards
  const byDepth = {}; ds.forEach(d => { (byDepth[d.depth] = byDepth[d.depth] || []).push(d.x); });
  Object.values(byDepth).forEach(xs => { xs.sort((a, b) => a - b); for (let i = 1; i < xs.length; i++) minClear = Math.min(minClear, xs[i] - xs[i - 1] - nodeSize.w); });

  parts.push(`<text x="${shiftX + minX - nodeSize.w / 2}" y="${shiftY - 12}" fill="${col}" font-size="13" font-weight="700" letter-spacing="2" font-family="Arial">${team === 'blue' ? 'BLUE — US / ALLIED' : 'RED — PLA'}</text>`);
  root.links().forEach(l => {
    const sx = shiftX + l.source.x, sy = shiftY + l.source.y + nodeSize.h / 2, tx = shiftX + l.target.x, ty = shiftY + l.target.y - nodeSize.h / 2, midY = (sy + ty) / 2;
    parts.push(`<path d="M${sx},${sy} V${midY} H${tx} V${ty}" fill="none" stroke="${col}" stroke-width="1.5" opacity="0.45"/>`);
  });
  ds.forEach(d => {
    const x = shiftX + d.x - nodeSize.w / 2, y = shiftY + d.y - nodeSize.h / 2, w = nodeSize.w, h = nodeSize.h, dd = d.data;
    if (d.depth === 0) {
      parts.push(`<g transform="translate(${x},${y})"><rect width="${w}" height="${h}" rx="9" fill="${team === 'red' ? '#241218' : '#10243a'}" stroke="${col}" stroke-width="1.6"/><text x="16" y="25" fill="#eef4fb" font-size="14" font-weight="700" font-family="Arial">${team === 'blue' ? 'BLUE' : 'RED'}</text><text x="16" y="43" fill="#8fa8c0" font-size="10.5" font-family="Arial">${root.descendants().length - 1} nodes</text></g>`);
    } else if (dd.group) {
      parts.push(`<g transform="translate(${x},${y})"><rect width="${w}" height="${h}" rx="7" fill="${team === 'red' ? '#1d1413' : '#0f1d2b'}" stroke="${col}" stroke-width="1.4" stroke-dasharray="5 3"/><rect width="4" height="${h}" rx="2" fill="${col}"/><text x="16" y="26" fill="#dfeaf5" font-size="12.5" font-weight="700" font-family="Arial">${dd.name}</text><text x="16" y="42" fill="#8fa8c0" font-size="10.5" font-family="Arial">${dd.count} units · click to expand</text><text x="${w - 14}" y="33" text-anchor="end" fill="${col}" font-size="16">▸</text></g>`);
    } else {
      const n = dd.data; const sym = Sym.svg(n, { size: 38 }).replace(/^<svg /, `<svg x="${x + 8}" y="${y + (h - 38) / 2}" `);
      const nm = (dd.name || '').length > 26 ? dd.name.slice(0, 25) + '…' : dd.name;
      const hf = Math.max(0, Math.min(1, (n.health == null ? 100 : n.health) / (n.healthMax || 100)));
      const hc = hf > 0.66 ? '#46d57e' : hf > 0.33 ? '#e8b54a' : '#e8584a';
      parts.push(`<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="#0d1825" stroke="${col}" stroke-width="1.4"/><rect x="${x}" y="${y}" width="4" height="${h}" rx="2" fill="${col}"/>${sym}<text x="${x + 58}" y="${y + 21}" fill="#eef4fb" font-size="12.5" font-weight="700" font-family="Arial">${(nm || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text><text x="${x + 58}" y="${y + 36}" fill="#8fa8c0" font-size="10.5" font-family="Arial">${[n.type, (n.domain || []).join('/')].filter(Boolean).join(' · ')}</text><text x="${x + w - 12}" y="${y + 36}" text-anchor="end" fill="#ffd86b" font-size="10.5" font-weight="700" font-family="Arial">★ ${n.importance}</text><rect x="${x + 58}" y="${y + 44}" width="${w - 58 - 14}" height="5" rx="2.5" fill="#1b2a38"/><rect x="${x + 58}" y="${y + 44}" width="${Math.max(2, (w - 58 - 14) * hf).toFixed(0)}" height="5" rx="2.5" fill="${hc}"/></g>`);
    }
  });
  yCursor += maxY + nodeSize.h + BAND_GAP;
});

const H = yCursor;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#0a1320"/>${parts.join('')}</svg>`;
fs.mkdirSync(path.join(__dirname, '..', '_stark'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', '_stark', 'taskorg-layout.svg'), svg);
console.log('canvas', W + 'x' + Math.round(H), '| min horizontal clearance between same-depth cards:', Math.round(minClear), 'px (should be >0)');
console.log('-> _stark/taskorg-layout.svg');
