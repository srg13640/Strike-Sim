#!/usr/bin/env node
'use strict';

/*
 * build-small-island-scenario.js — authored generator for CO-005 Phase 5 / C5.
 *
 * Produces scenarios/small-island-fait-accompli.json: a compact Kinmen-seizure
 * variant derived from the two canonical force networks. Deterministic — explicit
 * quotas, name rules, and fixed coordinates; no RNG. The output is committed and
 * reviewed like any authored data; this script exists so the derivation itself is
 * reviewable and re-runnable (never executed at game load time).
 *
 * Usage:  node tools/build-small-island-scenario.js [--write]
 *
 * Strategic frame (Army University Press, "China's Force Projection Capabilities |
 * Large and Small Island Operations"; Altman's fait-accompli findings; CSIS on ally
 * entry): a small-island seizure is the LOW rung of Red's menu — tiny lift
 * requirement, fast lodgment clock, and the real contest is escalation: does Blue
 * fight for a rung this low, and at what rung do allies commit?
 *
 * UNCLASSIFIED // NOTIONAL RESEARCH TOOL
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'scenarios', 'small-island-fait-accompli.json');

const red = JSON.parse(fs.readFileSync(path.join(ROOT, 'grok150red.json'), 'utf8'));
const blue = JSON.parse(fs.readFileSync(path.join(ROOT, 'grokblue90.json'), 'utf8'));

const text = n => [n.name, n.type, n.subsystem].join(' ').toLowerCase();
const byImportance = (a, b) => (b.importance || 0) - (a.importance || 0) || String(a.id).localeCompare(String(b.id));

/** Select up to `cap` team nodes matching `re`, highest importance first, minus already-picked. */
function pick(nodes, picked, re, cap, extraFilter) {
  const out = [];
  for (const n of nodes.slice().sort(byImportance)) {
    if (out.length >= cap) break;
    if (picked.has(n.id)) continue;
    if (!re.test(text(n))) continue;
    if (extraFilter && !extraFilter(n)) continue;
    picked.add(n.id);
    out.push(n);
  }
  return out;
}

// ---------- RED: the seizure force (~30 nodes) ----------
const rPicked = new Set();
const rn = red.nodes;
const redSel = [].concat(
  pick(rn, rPicked, /eastern theater command joc|73rd group army/, 2),
  // type Assault == the MOE's amphibious-lift subsystem (the throughput driver):
  // brigades, mobilized Ro-Ro, and Y-20 airlift all count against the lodgment.
  pick(rn, rPicked, /amphibious|ro-ro|marine brigade|air assault|airborne|combined arms brigade|y-20|transport regiment/, 6,
    n => /assault/i.test(n.type || '')),
  pick(rn, rPicked, /plz|pcl|rocket artillery|long-range artillery|df-1[15]|srbm/, 4),
  pick(rn, rPicked, /radar site|oth|kj-500|aew|uav/, 4),
  pick(rn, rPicked, /jamming|electronic warfare|ew brigade|network warfare|cyber/, 3),
  pick(rn, rPicked, /logistics|depot|sustainment|supply/, 3),
  pick(rn, rPicked, /hq-9|hq-16|sam|air defense/, 3),
  pick(rn, rPicked, /coast guard|militia|patrol|blockade|frigate|corvette/, 3)
);

// ---------- BLUE: Kinmen garrison + Taiwan reach + minimal US enablers (~24) ----------
const bPicked = new Set();
const bn = blue.nodes;
const taiwan = bn.filter(n => n.nation === 'Taiwan');
const us = bn.filter(n => n.nation === 'United States');

const blueTaiwanCmd = pick(taiwan, bPicked, /command|joc/, 1);
const blueSel = [].concat(
  blueTaiwanCmd,
  pick(taiwan, bPicked, /fires|missile|rocket|artillery|hsiung feng|anti-ship/, 4),
  pick(taiwan, bPicked, /sensor|radar|surveillance/, 3),
  pick(taiwan, bPicked, /protection|air defense|patriot|sky bow/, 2),
  pick(taiwan, bPicked, /logistics|supply|sustain/, 2),
  pick(taiwan, bPicked, /relay|comms|link|network/, 2),
  pick(taiwan, bPicked, /information|cyber|ew|electronic/, 2),
  pick(us, bPicked, /reconnaissance|isr|surveillance|satellite/, 2),
  pick(us, bPicked, /submarine|ssn/, 1),
  pick(us, bPicked, /coordination|liaison|task force/, 1)
);

// ---------- Authored Kinmen garrison clones ----------
const KINMEN = { lat: 24.44, lon: 118.32 };
function clone(src, id, name, geo, i) {
  const c = JSON.parse(JSON.stringify(src));
  c.id = id;
  c.name = name;
  c.lat = KINMEN.lat + (i % 3) * 0.012 - 0.012;
  c.lon = KINMEN.lon + Math.floor(i / 3) * 0.015 - 0.008;
  c.geographyClass = geo;
  c.importance = Math.min(10, (src.importance || 5) + 2);   // the objective IS the garrison
  c.notes = 'Notional Kinmen garrison emplacement derived from ' + src.id + ' — explicit scenario assumption, not an intelligence estimate.';
  delete c.x; delete c.y; delete c.z;
  return c;
}
const cmdSrc = blueTaiwanCmd[0] || taiwan[0];
const firesSrc = blueSel.find(n => /fires|missile|artillery/i.test(text(n))) || taiwan[0];
const protSrc = blueSel.find(n => /protection|air defense/i.test(text(n))) || taiwan[0];
const logSrc = blueSel.find(n => /logistics|supply/i.test(text(n))) || taiwan[0];
const garrison = [
  clone(cmdSrc, 'SIA-BLU-KDC', 'Kinmen Defense Command', 'offshore-island', 0),
  clone(firesSrc, 'SIA-BLU-KGA', 'Kinmen Garrison Artillery Battalion', 'offshore-island', 1),
  clone(protSrc, 'SIA-BLU-KAD', 'Kinmen Point Air Defense Battery', 'offshore-island', 2),
  clone(logSrc, 'SIA-BLU-KSP', 'Kinmen Supply Point', 'offshore-island', 3)
];

// ---------- Red staging relocations (lift/assault stage at Xiamen anchorage) ----------
const XIAMEN = { lat: 24.5, lon: 118.05 };
let stageIdx = 0;
for (const n of redSel) {
  if (/landing|ro-ro|ferry|lift|landing craft|transport|amphibious|marine brigade|air assault/.test(text(n))) {
    n.lat = XIAMEN.lat + (stageIdx % 4) * 0.02 - 0.03;
    n.lon = XIAMEN.lon + Math.floor(stageIdx / 4) * 0.02 - 0.02;
    stageIdx++;
  }
}

// ---------- Links: keep intra-subset links, then stitch authored ones ----------
const keptIds = new Set([...redSel, ...blueSel, ...garrison].map(n => n.id));
const endId = e => (e && typeof e === 'object') ? e.id : e;
const links = [].concat(red.links || [], blue.links || [])
  .filter(l => keptIds.has(endId(l.source)) && keptIds.has(endId(l.target)))
  .map(l => JSON.parse(JSON.stringify(l)));

const authored = [
  ['SIA-BLU-KDC', cmdSrc.id], ['SIA-BLU-KGA', 'SIA-BLU-KDC'],
  ['SIA-BLU-KAD', 'SIA-BLU-KDC'], ['SIA-BLU-KSP', 'SIA-BLU-KDC']
];
for (const [s, t] of authored) {
  if (keptIds.has(s) && keptIds.has(t)) links.push({ source: s, target: t, type: 'C2', value: 2 });
}
// Connect any orphan to its side's top command node so the graph is playable.
const linkCount = {};
links.forEach(l => { linkCount[endId(l.source)] = 1 + (linkCount[endId(l.source)] || 0); linkCount[endId(l.target)] = 1 + (linkCount[endId(l.target)] || 0); });
const topCmd = { red: redSel[0], blue: garrison[0] };
for (const n of [...redSel, ...blueSel, ...garrison]) {
  if (!linkCount[n.id]) {
    const hub = topCmd[n.team === 'red' ? 'red' : 'blue'];
    if (hub && hub.id !== n.id) links.push({ source: n.id, target: hub.id, type: 'C2', value: 1 });
  }
}

// ---------- Assemble ----------
const scenario = {
  metadata: {
    id: 'small-island-fait-accompli',
    title: 'SMALL ISLAND FAIT ACCOMPLI — Kinmen Seizure (Notional 2040)',
    classification: 'UNCLASSIFIED // NOTIONAL RESEARCH TOOL',
    version: 1,
    generatedBy: 'tools/build-small-island-scenario.js (authored derivation; reviewable; never run at load time)',
    boundary: 'Derived from the two canonical StrikeSim force networks. Node selection, Kinmen garrison emplacements, staging locations, and all thresholds are explicit scenario assumptions — not intelligence estimates or predictions.'
  },
  sources: (function collectSources() {
    // Carry exactly the source entries the selected nodes cite, so every
    // capabilityProfile.sourceRef resolves (validate-scenarios contract).
    const refs = new Set();
    for (const n of [...redSel, ...blueSel, ...garrison]) {
      const p = n.capabilityProfile;
      (p && Array.isArray(p.sourceRefs) ? p.sourceRefs : []).forEach(r => refs.add(r));
    }
    const all = [].concat(red.sources || [], blue.sources || []);
    const seen = new Set();
    const out = all.filter(s => {
      const id = s && s.id;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return refs.has(id);
    });
    const missing = [...refs].filter(r => !out.some(s => s.id === r));
    if (missing.length) throw new Error('unresolvable sourceRefs: ' + missing.join(', '));
    return out;
  })(),
  context: {
    background: 'Red moves against Kinmen: a fait accompli at the lowest rung of the island-operations ladder. Lift requirements are tiny and the lodgment clock runs fast. The contested question is not whether Red CAN take the island — it is whether Blue fights for a rung this low, what that decision does to escalation, and whether allied commitment materializes for ten square miles of forward garrison.',
    initiatingEvent: 'Red amphibious and air-assault elements have begun loading at Xiamen anchorage, eight kilometers from Kinmen. Assessed window to a consolidated lodgment: six turns.',
    blueRole: 'Blue operational planner, Taiwan Joint Operations Center. Kinmen Defense Command reports ready. Strikes on mainland staging are within your authority — and every rung you climb is a rung Red can climb back.',
    redObjective: 'Seize Kinmen before allied commitment consolidates; keep every action below the threshold that brings allies in. Speed IS the strategy.'
  },
  matchConfig: {
    turnLimit: 6,
    lodgmentRequiredTurns: 2,
    doctrinePrior: { attrition: 0.2, decapitation: 0.2, denial: 0.6 },
    strategic: { escalation: { initial: 1 } }
  },
  nodes: [...redSel, ...blueSel, ...garrison],
  links
};

// ---------- Report / write ----------
const counts = { red: redSel.length, blue: blueSel.length + garrison.length, links: links.length };
console.log('UNCLASSIFIED // NOTIONAL RESEARCH TOOL');
console.log('small-island-fait-accompli: red=' + counts.red + ' blue=' + counts.blue + ' links=' + counts.links);
console.log('RED:  ' + redSel.map(n => n.id).join(', '));
console.log('BLUE: ' + blueSel.map(n => n.id).join(', ') + ', ' + garrison.map(n => n.id).join(', '));

if (process.argv.includes('--write')) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(scenario, null, 2) + '\n');
  console.log('WROTE ' + OUT);
} else {
  console.log('(dry run — pass --write to emit the file)');
}
