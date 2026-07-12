#!/usr/bin/env node
'use strict';

/*
 * tag-red-geography.js — one-shot authored data pass (CO-005 Phase 4/C1 completion).
 *
 * Assigns a geographyClass to every Red node in grok150red.json so the escalation
 * ladder's horizontal weights (strategic-state.js) have complete coverage. Rules are
 * explicit and deterministic; no RNG. Re-runnable: nodes that already carry a
 * geographyClass are left untouched. Prints a full audit table for review.
 *
 * Usage:  node tools/tag-red-geography.js [--write]
 *         (without --write it is a dry run)
 *
 * UNCLASSIFIED // NOTIONAL RESEARCH TOOL
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'grok150red.json');
const StrategicState = require(path.join(ROOT, 'strategic-state.js'));

const ALLOWED = Object.keys(StrategicState.DEFAULT_CONFIG.escalation.horizontalWeights)
  .filter(k => !k.startsWith('nation:'));

// Coarse PRC coastline polyline (lon, lat) — the same notional trace used by the
// map layer; distance to it separates littoral from interior/mainland-generic.
const COAST = [
  [108.6, 21.5], [110.4, 20.9], [111.8, 21.5], [113.2, 22.0], [114.3, 22.5],
  [116.4, 22.9], [117.3, 23.55], [118.05, 24.4], [118.6, 24.55], [119.0, 25.0],
  [119.55, 25.65], [120.2, 26.4], [120.65, 27.3], [120.9, 28.1], [121.5, 29.9],
  [121.8, 31.0], [120.3, 32.6], [119.6, 34.5], [120.3, 36.1], [121.4, 36.9],
  [122.1, 37.5], [121.2, 38.9], [121.6, 39.0], [122.2, 40.5]
];

function distToCoast(lon, lat) {
  let best = Infinity;
  for (let i = 0; i < COAST.length - 1; i++) {
    const [x1, y1] = COAST[i], [x2, y2] = COAST[i + 1];
    const dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((lon - x1) * dx + (lat - y1) * dy) / (dx * dx + dy * dy)));
    const px = x1 + t * dx, py = y1 + t * dy;
    best = Math.min(best, Math.hypot(lon - px, lat - py));
  }
  return best; // degrees; ~1 deg ≈ 100 km at these latitudes
}

function textOf(n) {
  return [n.name, n.type, n.subsystem, (n.domain || []).join(' ')].join(' ').toLowerCase();
}

function classify(n) {
  const t = textOf(n);
  const domains = (n.domain || []).map(d => String(d).toLowerCase());
  const lon = Number(n.lon), lat = Number(n.lat);
  const hasGeo = Number.isFinite(lon) && Number.isFinite(lat);

  // 1. Orbital: space-domain assets.
  if (domains.includes('space') || /satellite|orbital|beidou|constellation/.test(t)) return 'orbital';

  // 2. Cyberspace: network-warfare formations without a meaningful physical target footprint.
  if (/cyber|network warfare|information operations/.test(t) && !/jam|radar|base|site|battalion/.test(t)) return 'cyberspace';

  // 3. Airborne: aviation formations and air-breathing platforms (checked before afloat
  //    so maritime-patrol aircraft classify by their flying presence, not their sea domain).
  if (/air regiment|air brigade|aviation|bomber|fighter|awacs|aew|aircraft|uav|drone swarm/.test(t)) return 'airborne';

  // 4. Afloat: ships, flotillas, sea-domain combatants and lift underway — but never
  //    shore headquarters, which classify by their ground location.
  const shore = /hq|headquarters|command center|command post/.test(t);
  if (!shore && /flotilla|frigate|destroyer|corvette|carrier|submarine|landing ship|ro-ro|ferry|militia vessel|coast guard cutter|patrol|underwater sensor|acoustic array/.test(t)) return 'afloat';
  if (!shore && domains.includes('sea') && /blockade|escort|amphibious lift|transport group/.test(t)) return 'afloat';

  // 5. Offshore island: Red assets already emplaced on offshore islands (rare at start).
  if (hasGeo && lon > 119.9 && lon < 122.6 && lat > 21.6 && lat < 26.5) return 'offshore-island';

  // 6. Mainland split by distance to coast: littoral (< 0.9 deg), else interior for
  //    hardened strategic depth, else generic prc-mainland.
  if (hasGeo) {
    const d = distToCoast(lon, lat);
    if (d < 0.9) return 'homeland-littoral';
    if (/command|c2|headquarters|leadership|national|strategic support|rocket force base|depot/.test(t) || d > 3.0) return 'homeland-interior';
    return 'prc-mainland';
  }

  // 7. No coordinates at all: strategic rear by default.
  return 'prc-mainland';
}

function main() {
  const write = process.argv.includes('--write');
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const rows = [];
  let tagged = 0, kept = 0;

  for (const n of data.nodes) {
    if ((n.team || 'red') !== 'red') continue;
    if (n.geographyClass) { kept++; continue; }
    const cls = classify(n);
    if (!ALLOWED.includes(cls)) throw new Error('Unsanctioned class ' + cls + ' for ' + n.id);
    n.geographyClass = cls;
    tagged++;
    rows.push([n.id, cls, (n.name || '').slice(0, 52)]);
  }

  const counts = {};
  rows.forEach(r => { counts[r[1]] = (counts[r[1]] || 0) + 1; });
  console.log('UNCLASSIFIED // NOTIONAL RESEARCH TOOL');
  console.log('Red geography tagging — ' + (write ? 'WRITE' : 'DRY RUN'));
  console.log('tagged: ' + tagged + '  already-tagged kept: ' + kept);
  console.log('class distribution:', JSON.stringify(counts));
  rows.forEach(r => console.log('  ' + r[0].padEnd(14) + r[1].padEnd(20) + r[2]));

  if (write) {
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
    console.log('WROTE ' + FILE);
  }
}

main();
