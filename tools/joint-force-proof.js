#!/usr/bin/env node
'use strict';

/*
 * Acceptance proof for the Taiwan-led Blue Joint Force redesign.
 *
 * This tests the authored data through the real game engine where behavior matters:
 * objective selection, starting AP, tempo degradation, and default firing-source
 * assignment. Counts are analytical aggregates, not literal platforms or units.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BLUE_PATH = path.join(ROOT, 'grokblue90.json');
const RED_PATH = path.join(ROOT, 'grok150red.json');
const RESOURCE_KEYS = ['kinetic', 'cyber', 'ew', 'sof'];
const PROFILE_KEYS = ['category', 'functions', 'evidenceClass', 'confidence', 'availability', 'sourceRefs', 'assumption'];
const TEMPO_ROLES = new Set(['command', 'logistics', 'relay', 'none']);
const failures = [];

function fail(message) { failures.push(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function endpointId(value) { return value && typeof value === 'object' ? value.id : value; }
function totalCapacity(node) {
  return RESOURCE_KEYS.reduce((sum, key) => sum + Number(node.resourceGenByType && node.resourceGenByType[key] || 0), 0);
}
function capacitySum(nodes) {
  const result = { kinetic: 0, cyber: 0, ew: 0, sof: 0 };
  nodes.forEach(node => RESOURCE_KEYS.forEach(key => { result[key] += Number(node.resourceGenByType && node.resourceGenByType[key] || 0); }));
  return result;
}

function ownerBucket(node) {
  const nation = String(node.nation || '').toLowerCase();
  const owner = String(node.serviceOwner || node.component || '').toLowerCase();
  if (nation.includes('taiwan') || owner.includes('taiwan') || owner.includes('roc ')) return 'Taiwan';
  if (owner.includes('marine corps') || owner.includes('marines')) return 'U.S. Marine Corps';
  if (owner.includes('space force')) return 'U.S. Space Force';
  if (owner.includes('air force')) return 'U.S. Air Force';
  if (owner.includes('navy') || owner.includes('fleet')) return 'U.S. Navy';
  if (owner.includes('army')) return 'U.S. Army';
  if (owner.includes('joint') || owner.includes('cyber command') || owner.includes('special operations')) return 'U.S. Joint';
  if (nation.includes('japan') || nation.includes('australia') || nation.includes('philippines') || owner.includes('partner')) return 'Conditional Partners';
  if (owner.includes('commercial') || nation.includes('commercial')) return 'Commercial';
  return node.serviceOwner || node.component || 'Unassigned';
}

function loadGame(graph) {
  const context = {
    console: { log() {}, warn() {}, error() {} },
    window: { AppState: { activeGraph: () => graph } },
    Math, Date, setTimeout, clearTimeout
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'moe.js'), 'utf8'), context, { filename: 'moe.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'red-mind.js'), 'utf8'), context, { filename: 'red-mind.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'strategic-state.js'), 'utf8'), context, { filename: 'strategic-state.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8'), context, { filename: 'game.js' });
  return context.window.GameModule;
}

function runFullMatch(game, seed) {
  if (game.isActive()) game.endMatch();
  let state = game.newMatch({
    control: { blue: 'ai', red: 'ai' },
    difficulty: { blue: 'hard', red: 'hard' },
    fog: false,
    turnLimit: 8,
    seed
  });
  let guard = 0;
  while (state && state.phase !== 'over' && guard++ < 24) {
    if (state.phase === 'plan') state = game.commitTurn();
    else if (state.phase === 'resolved') state = game.nextTurn();
    else break;
  }
  return state;
}

function validateCoverage(blue) {
  const sourceIds = new Set((blue.sources || []).map(source => source.id));
  for (const node of blue.nodes) {
    const scope = node.id || '<missing-id>';
    for (const field of ['nation', 'serviceOwner', 'component', 'jointFunction', 'operationalRole', 'locationPrecision']) {
      if (!String(node[field] || '').trim()) fail(`${scope}: missing ${field}`);
    }
    if (!Array.isArray(node.accessDependencies)) fail(`${scope}: accessDependencies must be an array`);
    if (!TEMPO_ROLES.has(node.tempoRole)) fail(`${scope}: invalid or missing tempoRole`);
    const profile = node.capabilityProfile;
    if (!profile || typeof profile !== 'object') {
      fail(`${scope}: missing capabilityProfile`);
      continue;
    }
    PROFILE_KEYS.forEach(field => {
      const value = profile[field];
      if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) fail(`${scope}: capabilityProfile.${field} is empty`);
    });
    for (const ref of Array.isArray(profile.sourceRefs) ? profile.sourceRefs : []) {
      if (!sourceIds.has(ref)) fail(`${scope}: unresolved sourceRef ${ref}`);
    }
    if (totalCapacity(node) > 0 && (!Array.isArray(profile.sourceRefs) || profile.sourceRefs.length === 0)) {
      fail(`${scope}: capacity-generating node has no public source reference`);
    }
    if (['conditional-partner', 'commercial-contract'].includes(profile.availability) && totalCapacity(node) !== 0) {
      fail(`${scope}: ${profile.availability} node contributes active capacity`);
    }
  }
}

function validateComposition(blue) {
  if (blue.nodes.length < 120 || blue.nodes.length > 130) fail(`node count ${blue.nodes.length} is outside 120–130`);
  const byOwner = new Map();
  blue.nodes.forEach(node => {
    const key = ownerBucket(node);
    if (!byOwner.has(key)) byOwner.set(key, { nodes: [], capacity: { kinetic: 0, cyber: 0, ew: 0, sof: 0 } });
    const row = byOwner.get(key);
    row.nodes.push(node);
    RESOURCE_KEYS.forEach(resource => { row.capacity[resource] += Number(node.resourceGenByType && node.resourceGenByType[resource] || 0); });
  });

  const bounds = {
    'U.S. Army': [20, 40],
    'U.S. Navy': [12, 20],
    'U.S. Marine Corps': [8, 15],
    'U.S. Air Force': [12, 20],
    'U.S. Space Force': [6, 12],
    'Taiwan': [18, 28],
    'U.S. Joint': [8, 18]
  };
  for (const [owner, [min, max]] of Object.entries(bounds)) {
    const count = byOwner.get(owner) ? byOwner.get(owner).nodes.length : 0;
    if (count < min || count > max) fail(`${owner}: ${count} nodes is outside ${min}–${max}`);
  }
  for (const [owner, row] of byOwner) {
    if (row.nodes.length / blue.nodes.length > 0.4) fail(`${owner}: owns more than 40% of Blue nodes`);
  }

  const total = capacitySum(blue.nodes);
  const expected = { kinetic: 97, cyber: 19, ew: 15, sof: 0 };
  RESOURCE_KEYS.forEach(key => {
    if (total[key] !== expected[key]) fail(`active ${key} capacity ${total[key]} does not preserve baseline ${expected[key]}`);
  });
  for (const owner of ['U.S. Army', 'U.S. Navy', 'U.S. Marine Corps', 'U.S. Air Force', 'Taiwan']) {
    const kinetic = byOwner.get(owner) ? byOwner.get(owner).capacity.kinetic : 0;
    if (kinetic < 9) fail(`${owner}: kinetic capacity ${kinetic} is below meaningful-share floor 9`);
    if (kinetic > 39) fail(`${owner}: kinetic capacity ${kinetic} exceeds 40% cap`);
  }

  const activeNonkineticOwners = Array.from(byOwner.values()).filter(row => row.capacity.cyber + row.capacity.ew > 0);
  if (activeNonkineticOwners.length < 5) fail(`only ${activeNonkineticOwners.length} owners contribute active Cyber/EW capacity`);

  console.log('Blue Joint Force composition');
  console.log('Owner'.padEnd(24) + 'Nodes'.padStart(7) + '  K/C/EW/SOF');
  Array.from(byOwner.entries()).sort((a, b) => b[1].nodes.length - a[1].nodes.length).forEach(([owner, row]) => {
    const c = row.capacity;
    console.log(owner.padEnd(24) + String(row.nodes.length).padStart(7) + `  ${c.kinetic}/${c.cyber}/${c.ew}/${c.sof}`);
  });
  console.log(`TOTAL`.padEnd(24) + String(blue.nodes.length).padStart(7) + `  ${total.kinetic}/${total.cyber}/${total.ew}/${total.sof}`);
  return byOwner;
}

function validateTopology(blue) {
  const byId = new Map(blue.nodes.map(node => [node.id, node]));
  const degree = new Map(blue.nodes.map(node => [node.id, 0]));
  let crossOwner = 0;
  for (const link of blue.links) {
    const source = endpointId(link.source);
    const target = endpointId(link.target);
    if (!byId.has(source) || !byId.has(target)) continue;
    degree.set(source, degree.get(source) + 1);
    degree.set(target, degree.get(target) + 1);
    if (ownerBucket(byId.get(source)) !== ownerBucket(byId.get(target))) crossOwner += 1;
  }
  const isolates = Array.from(degree).filter(([, count]) => count === 0).map(([id]) => id);
  if (isolates.length) fail(`isolated Blue nodes: ${isolates.join(', ')}`);
  if (crossOwner < 25) fail(`only ${crossOwner} cross-component links (minimum 25)`);
  const maxDegree = Math.max(...degree.values());
  if (maxDegree > 28) fail(`maximum Blue hub degree ${maxDegree} exceeds 28`);
  console.log(`Topology: ${blue.links.length} links · ${crossOwner} cross-component · ${isolates.length} isolates · max degree ${maxDegree}`);
}

function validateEngineBehavior(blue, red) {
  const graph = { nodes: [...blue.nodes, ...red.nodes], links: [...blue.links, ...red.links], sources: [...(blue.sources || []), ...(red.sources || [])] };
  const game = loadGame(graph);
  game.newMatch({ freshStart: false });
  const initial = game.getState();
  if (initial.ap.blue !== 5) fail(`initial Blue AP is ${initial.ap.blue}, expected 5`);

  const objectives = initial.objectiveIds.blue.map(id => game.boardNode(id)).filter(Boolean);
  const ownerCounts = new Map();
  objectives.forEach(node => ownerCounts.set(ownerBucket(node), (ownerCounts.get(ownerBucket(node)) || 0) + 1));
  if (objectives.length !== 8) fail(`objective count ${objectives.length}, expected 8`);
  if (ownerCounts.size < 5) fail(`objectives represent only ${ownerCounts.size} owners`);
  for (const [owner, count] of ownerCounts) if (count > 2) fail(`${owner} owns ${count} of 8 objectives`);
  if (!objectives.some(node => ownerBucket(node) === 'Taiwan')) fail('objectives have no Taiwan-owned node');
  if (!objectives.some(node => ownerBucket(node) === 'U.S. Joint')) fail('objectives have no U.S. Joint node');
  if (objectives.some(node => ['conditional-partner', 'commercial-contract'].includes(node.availability))) fail('conditional/commercial node selected as objective');

  const objectiveDomains = new Set(objectives.flatMap(node => node.domain || []).map(value => String(value).toLowerCase()));
  if (!objectiveDomains.has('land') && !objectiveDomains.has('littoral')) fail('objectives lack Land/Littoral representation');
  if (!objectiveDomains.has('sea') && !objectiveDomains.has('subsurface')) fail('objectives lack Sea/Subsurface representation');
  if (!objectiveDomains.has('air')) fail('objectives lack Air representation');
  if (!['space', 'cyber', 'ew'].some(domain => objectiveDomains.has(domain))) fail('objectives lack Space/Cyber/EW representation');

  const objectiveDescriptor = objectives.map(node => [node.type, node.subsystem, node.jointFunction, node.operationalRole].join(' ').toLowerCase());
  const has = regex => objectiveDescriptor.some(value => regex.test(value));
  if (!has(/command|c2/)) fail('objectives lack Command/C2');
  if (!has(/sensor|isr|awareness|tracking/)) fail('objectives lack sensing/ISR');
  if (!has(/logistic|sustain|relay|transport/)) fail('objectives lack sustainment/relay');
  if (!has(/fire|strike|denial|protection|defen/)) fail('objectives lack fires/denial/protection');
  const commandCount = objectiveDescriptor.filter(value => /command|c2/.test(value)).length;
  if (commandCount > 4) fail(`${commandCount} objectives are command/C2-heavy (maximum 4)`);

  const tempoNodes = blue.nodes
    .filter(node => node.tempoRole && node.tempoRole !== 'none')
    .map(node => ({ node: game.boardNode(node.id), weight: node.tempoRole === 'command' ? 1 : node.tempoRole === 'logistics' ? 0.7 : 0.45 }))
    .filter(item => item.node && item.node.alive)
    .sort((a, b) => b.weight - a.weight || String(a.node.id).localeCompare(String(b.node.id)));
  const totalTempo = tempoNodes.reduce((sum, item) => sum + item.weight, 0);
  let removed = 0;
  for (const item of tempoNodes) {
    if (removed >= totalTempo * 0.25) break;
    item.node.alive = false;
    item.node.health = 0;
    removed += item.weight;
  }
  const quarterLossAp = game.getState().ap.blue;
  if (quarterLossAp > 4) fail(`removing 25% of authored Blue tempo leaves AP at ${quarterLossAp}`);
  tempoNodes.forEach(item => { item.node.alive = false; item.node.health = 0; });
  const floorAp = game.getState().ap.blue;
  if (floorAp !== 2) fail(`removing all authored Blue tempo produces AP ${floorAp}, expected floor 2`);

  // Rebuild a clean board for default source-assignment diversity.
  const board = game._internal.buildBoard(graph);
  for (const method of ['kinetic', 'cyber', 'ew']) {
    const owners = new Set();
    for (const targetId of board.rosters.red) {
      const result = game._internal.canStrikeBoard(board, 'blue', targetId, method);
      if (result.ok) owners.add(ownerBucket(board.nodes[result.sourceId]));
    }
    const minimum = method === 'kinetic' ? 3 : 2;
    if (owners.size < minimum) fail(`default ${method} assignment uses only ${owners.size} owner(s): ${Array.from(owners).join(', ')}`);
    console.log(`Default ${method} sources: ${Array.from(owners).sort().join(', ') || 'none'}`);
  }

  console.log('Objectives: ' + objectives.map(node => `${node.id} [${ownerBucket(node)}]`).join(' · '));
  console.log(`Tempo: AP ${initial.ap.blue} → ${quarterLossAp} at 25% loss → ${floorAp} at total loss`);
  console.log(`Fingerprint: ${initial.fingerprint.hash} (${initial.fingerprint.nodes} nodes / ${initial.fingerprint.links} links)`);

  const first = runFullMatch(game, 2040);
  const firstSummary = first && {
    phase: first.phase, turn: first.turn, winner: first.winner, result: first.result,
    denialHistory: first.aar && first.aar.denialHistory,
    lodgment: first.aar && first.aar.lodgment
  };
  const second = runFullMatch(game, 2040);
  const secondSummary = second && {
    phase: second.phase, turn: second.turn, winner: second.winner, result: second.result,
    denialHistory: second.aar && second.aar.denialHistory,
    lodgment: second.aar && second.aar.lodgment
  };
  if (!first || first.phase !== 'over' || !first.aar || !first.result) fail('actual-MOE smoke match did not reach a source-linked AAR');
  if (JSON.stringify(firstSummary) !== JSON.stringify(secondSummary)) fail('actual-MOE smoke match is not deterministic for seed 2040');
  if (first && first.aar && (!Array.isArray(first.aar.denialHistory) || !first.aar.denialHistory.length)) fail('actual-MOE AAR has no denial history');
  console.log(`Actual-MOE smoke: ${first && first.phase} on turn ${first && first.turn} · winner ${first && first.winner} · deterministic seed 2040`);
}

function main() {
  const blue = readJson(BLUE_PATH);
  const red = readJson(RED_PATH);
  validateCoverage(blue);
  validateComposition(blue);
  validateTopology(blue);
  validateEngineBehavior(blue, red);

  if (failures.length) {
    console.error(`\nJOINT FORCE PROOF FAILED (${failures.length})`);
    failures.forEach(message => console.error(`- ${message}`));
    process.exit(1);
  }
  console.log('\nJoint Force proof: PASS');
}

main();
