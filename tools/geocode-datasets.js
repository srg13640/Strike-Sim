#!/usr/bin/env node
/*
 * geocode-datasets.js — fill in missing lat/lon on scenario nodes so Geo Mode places
 * everything geographically instead of dumping coordinate-less nodes in a ring below
 * the globe.
 *
 * Strategy (highest fidelity first), applied ONLY to nodes that lack lat/lon:
 *   1. Name / affiliation match  — a curated place table keyed on substrings found in
 *      node names (cities, bases, theater commands, unit designators). Real coords.
 *   2. Link inheritance          — otherwise, borrow a linked neighbor's coords + a
 *      small deterministic offset, so subordinate units cluster near their HQ.
 *   3. Theater fallback          — otherwise, scatter within the side's operating area.
 *
 * Coordinates are PLAUSIBLE / NOTIONAL for visualization, not authoritative.
 * Deterministic: the jitter is hashed from the node id, so re-runs are stable.
 *
 * Usage:  node tools/geocode-datasets.js            # writes the files in place
 *         node tools/geocode-datasets.js --dry      # report only, no writes
 */
const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');
const ROOT = path.join(__dirname, '..');
const FILES = [
  { file: 'grok150red.json', side: 'red' },
  { file: 'grokblue90.json', side: 'blue' }
];

// --- Curated place / affiliation table: lowercase substring -> [lat, lon] ---
// Order matters only for readability; matching prefers the LONGEST matching key.
const PLACES = {
  // ---- Red: PRC mainland, theaters, coastal bases ----
  'beijing': [39.90, 116.40], 'fuzhou': [26.08, 119.30], 'guangzhou': [23.13, 113.26],
  'nanjing': [32.06, 118.80], 'ningbo': [29.87, 121.55], 'xiamen': [24.48, 118.09],
  'huzhou': [30.87, 120.10], 'huainan': [32.63, 117.00], 'zhanjiang': [21.27, 110.36],
  'chaozhou': [23.66, 116.62], 'wuhan': [30.58, 114.27], 'wuxi': [31.57, 120.30],
  'ningde': [26.65, 119.52], 'quanzhou': [24.90, 118.60], 'pingtan': [25.50, 119.78],
  'lingshui': [18.50, 110.03], 'sansha': [16.83, 112.34], 'shanghai': [31.23, 121.47],
  'nanchang': [28.68, 115.86], 'ganzhou': [25.85, 114.93], 'shantou': [23.35, 116.68],
  'wenzhou': [27.99, 120.70], 'putian': [25.43, 119.01], 'shanwei': [22.79, 115.38],
  'hainan': [19.00, 109.50], 'fujian': [26.00, 118.50], 'zhejiang': [29.50, 121.00],
  'guangdong': [22.50, 113.50], 'taiwan strait': [24.50, 119.50], 'taiwan': [23.70, 120.96],
  'jinmen': [24.43, 118.32], 'kinmen': [24.43, 118.32], 'matsu': [26.16, 119.95],
  // Red theater / unit affiliations
  'eastern tc': [26.08, 119.30], 'eastern theater': [26.08, 119.30],
  'southern tc': [23.13, 113.26], 'southern theater': [23.13, 113.26],
  '73rd ga': [24.48, 118.09], '73rd group army': [24.48, 118.09],
  '72nd ga': [30.87, 120.10], '72nd group army': [30.87, 120.10],
  '71st ga': [32.63, 117.00], '71st group army': [32.63, 117.00],
  'plarf': [26.50, 118.50], 'south sea fleet': [21.27, 110.36], 'east sea fleet': [29.87, 121.55],

  // ---- Blue: First/Second Island Chain bases ----
  'kadena': [26.36, 127.77], 'camp hansen': [26.47, 127.92], 'camp zama': [35.51, 139.39],
  'white beach': [26.32, 127.92], 'torii': [26.50, 127.90], 'naha': [26.22, 127.68],
  'yokota': [35.75, 139.35], 'yokosuka': [35.29, 139.67], 'sasebo': [33.16, 129.72],
  'iwakuni': [34.14, 132.24], 'misawa': [40.70, 141.37], 'camp fuji': [35.36, 138.73],
  'andersen': [13.58, 144.93], 'guam': [13.44, 144.79], 'saipan': [15.18, 145.74],
  'tinian': [15.00, 145.63], 'okinawa': [26.34, 127.80], 'ie shima': [26.72, 127.78],
  'iejima': [26.72, 127.78], 'camp aguinaldo': [14.62, 121.05], 'manila': [14.60, 120.98],
  'subic': [14.79, 120.27], 'clark': [15.19, 120.54], 'basa': [15.13, 120.49],
  'palawan': [9.75, 118.75], 'batanes': [20.45, 121.97], 'tindal': [-14.52, 132.38],
  'darwin': [-12.46, 130.84], 'luzon': [16.50, 121.00], 'northern luzon': [18.48, 120.68],
  'japan': [35.00, 138.00], 'philippines': [14.60, 121.00], 'australia': [-14.50, 132.38]
};
const PLACE_KEYS = Object.keys(PLACES).sort((a, b) => b.length - a.length); // longest-first

// Theater fallback centers (with spread, in degrees) per side.
const THEATER = {
  red:  { lat: 25.5, lon: 118.5, dLat: 4.0, dLon: 5.0 },  // SE China coast / strait approaches
  blue: { lat: 21.0, lon: 130.0, dLat: 9.0, dLon: 9.0 }   // Okinawa–Luzon–Guam arc
};

// Deterministic per-id pseudo-random in [-1, 1].
function rand(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

function geocodeName(name) {
  const lc = String(name || '').toLowerCase();
  for (const key of PLACE_KEYS) if (lc.includes(key)) return PLACES[key];
  return null;
}

for (const { file, side } of FILES) {
  const p = path.join(ROOT, file);
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  const byId = new Map(data.nodes.map(n => [n.id, n]));
  const adj = new Map(data.nodes.map(n => [n.id, []]));
  data.links.forEach(l => {
    const s = l.source && l.source.id ? l.source.id : l.source;
    const t = l.target && l.target.id ? l.target.id : l.target;
    if (adj.has(s)) adj.get(s).push(t);
    if (adj.has(t)) adj.get(t).push(s);
  });

  const stats = { named: 0, inherited: 0, theater: 0, already: 0 };

  data.nodes.forEach(n => {
    if (n.lat != null && n.lon != null) { stats.already++; return; }

    // 1) name / affiliation match
    const hit = geocodeName(n.name);
    if (hit) {
      n.lat = +(hit[0] + rand(n.id) * 0.12).toFixed(4);
      n.lon = +(hit[1] + rand(n.id + 'x') * 0.12).toFixed(4);
      stats.named++;
      return;
    }

    // 2) inherit from a linked neighbor that has coords
    const anchor = (adj.get(n.id) || []).map(id => byId.get(id))
      .find(nb => nb && nb.lat != null && nb.lon != null);
    if (anchor) {
      n.lat = +(anchor.lat + rand(n.id) * 0.30).toFixed(4);
      n.lon = +(anchor.lon + rand(n.id + 'x') * 0.30).toFixed(4);
      stats.inherited++;
      return;
    }

    // 3) theater fallback scatter
    const t = THEATER[side];
    n.lat = +(t.lat + rand(n.id) * t.dLat).toFixed(4);
    n.lon = +(t.lon + rand(n.id + 'x') * t.dLon).toFixed(4);
    stats.theater++;
  });

  const missing = data.nodes.filter(n => n.lat == null || n.lon == null).length;
  console.log(`${file}: already=${stats.already} named=${stats.named} inherited=${stats.inherited} theater=${stats.theater} | still-missing=${missing}`);

  if (!DRY) {
    fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
  }
}
console.log(DRY ? '(dry run — no files written)' : 'datasets updated.');
