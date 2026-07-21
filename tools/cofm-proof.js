#!/usr/bin/env node
'use strict';

/*
 * cofm-proof.js — headless regression gate for the COFM engine (CO-009).
 * Loads cofm.js exactly as the browser would (vm sandbox with a bare window),
 * then proves the CO-009 §2/§2.5 contract: weights, input mapping, multiplier
 * forms, tier boundaries, renormalization, guards, determinism, and escaping.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'cofm.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
new vm.Script(source, { filename: 'cofm.js' }).runInContext(sandbox);
const Cofm = sandbox.window.CofmModule;
assert.ok(Cofm, 'cofm.js must attach window.CofmModule');

const passed = [];
function check(name, fn) {
  fn();
  passed.push(name);
  console.log('  ✓ ' + name);
}

function node(team, overrides) {
  return Object.assign({
    id: 'n' + Math.random().toString(36).slice(2, 8),
    team: team, type: 'Fires', importance: 5, cascScore: 1, health: 100, healthMax: 100
  }, overrides || {});
}

// A symmetric board: each side gets the same weights/health in every domain.
function symmetricBoard() {
  const nodes = [];
  [['blue', { jointFunction: 'Fires' }, { jointFunction: 'Protection' }, { jointFunction: 'Command and control' }, { jointFunction: 'Sustainment' }],
   ['red', { type: 'Fires' }, { type: 'Blockade' }, { type: 'Command' }, { type: 'Logistics' }]]
    .forEach(([team, ...specs]) => specs.forEach(spec => nodes.push(node(team, spec))));
  return nodes;
}

check('domain weights sum to exactly 1.0', () => {
  const sum = Object.values(Cofm.DOMAIN_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, String(sum));
});

check('input mapping: Blue jointFunction, Red type taxonomy, subsystem fallback (CO-009 §2.5)', () => {
  assert.equal(Cofm.classifyDomain({ jointFunction: 'Fires' }), 'fires');
  assert.equal(Cofm.classifyDomain({ jointFunction: 'Protection' }), 'airsea');
  assert.equal(Cofm.classifyDomain({ jointFunction: 'Command and control' }), 'c2info');
  assert.equal(Cofm.classifyDomain({ jointFunction: 'Intelligence and targeting' }), 'c2info');
  assert.equal(Cofm.classifyDomain({ jointFunction: 'Information' }), 'c2info');
  assert.equal(Cofm.classifyDomain({ jointFunction: 'Sustainment' }), 'sustain');
  // Red dataset carries jointFunction: 'None' — must fall through to type.
  assert.equal(Cofm.classifyDomain({ jointFunction: 'None', type: 'Assault' }), 'airsea');
  assert.equal(Cofm.classifyDomain({ type: 'Blockade' }), 'airsea');
  assert.equal(Cofm.classifyDomain({ type: 'Relay' }), 'c2info');
  assert.equal(Cofm.classifyDomain({ type: 'EW/Cyber' }), 'c2info');
  assert.equal(Cofm.classifyDomain({ type: 'Sensor' }), 'c2info');
  assert.equal(Cofm.classifyDomain({ type: 'Logistics' }), 'sustain');
  assert.equal(Cofm.classifyDomain({ subsystem: 'Information Attack' }), 'c2info');
  assert.equal(Cofm.classifyDomain({ subsystem: 'Firepower Strike' }), 'fires');
  assert.equal(Cofm.classifyDomain({}), 'fires');
});

check('a symmetric board reports exact contested parity at 1.00', () => {
  const report = Cofm.assess(symmetricBoard());
  assert.equal(report.net, 1.00);
  assert.equal(report.tier.key, 'parity');
  assert.equal(report.inputs.blueNodes, 4);
  assert.equal(report.inputs.redNodes, 4);
});

check('killing Red C2 raises the net ratio and drops Red’s C2 multiplier non-linearly', () => {
  const board = symmetricBoard();
  const baseline = Cofm.assess(board);
  board.filter(n => n.team === 'red' && Cofm.classifyDomain(n) === 'c2info')
    .forEach(n => { n.health = 0; });
  const after = Cofm.assess(board);
  assert.ok(after.net > baseline.net, `${after.net} > ${baseline.net}`);
  assert.equal(after.sides.red.mC2, Cofm.MULTIPLIERS.c2Floor, 'dead C2 hits the 0.40 floor exactly');
  // Non-linearity: half C2 must cost more than proportionally.
  const half = symmetricBoard();
  half.filter(n => n.team === 'red' && Cofm.classifyDomain(n) === 'c2info')
    .forEach(n => { n.health = 50; });
  const mHalf = Cofm.assess(half).sides.red.mC2;
  const linear = Cofm.MULTIPLIERS.c2Floor + Cofm.MULTIPLIERS.c2Span * 0.5;
  assert.ok(mHalf < linear, `pow(0.5,1.5) curve: ${mHalf} < linear ${linear}`);
});

check('logistics posture multipliers apply exactly per side (surge 1.06 / constrained 0.94)', () => {
  const surged = Cofm.assess(symmetricBoard(), { logistics: { blue: 'surge', red: 'constrained' } });
  assert.equal(surged.sides.blue.mLogi, 1.06);
  assert.equal(surged.sides.red.mLogi, 0.94);
  assert.equal(surged.net, Math.round((1.06 / 0.94) * 100) / 100);
  const unknown = Cofm.assess(symmetricBoard(), { logistics: { blue: 'party', red: null } });
  assert.equal(unknown.sides.blue.mLogi, 1.00);
  assert.equal(unknown.sides.red.mLogi, 1.00);
});

check('tier boundaries are inclusive exactly as specified (0.89/0.90, 1.10/1.11, 1.30/1.31)', () => {
  assert.equal(Cofm.classifyTier(0.69).key, 'heavy_red');
  assert.equal(Cofm.classifyTier(0.70).key, 'red_advantage');
  assert.equal(Cofm.classifyTier(0.89).key, 'red_advantage');
  assert.equal(Cofm.classifyTier(0.90).key, 'parity');
  assert.equal(Cofm.classifyTier(1.10).key, 'parity');
  assert.equal(Cofm.classifyTier(1.1049).key, 'parity', 'rounds down to 1.10 first');
  assert.equal(Cofm.classifyTier(1.105).key, 'blue_advantage', 'standard half-up rounding to 1.11');
  assert.equal(Cofm.classifyTier(1.11).key, 'blue_advantage');
  assert.equal(Cofm.classifyTier(1.30).key, 'blue_advantage');
  assert.equal(Cofm.classifyTier(1.31).key, 'heavy_blue');
});

check('weights renormalize over present domains; a side with no C2 nodes is not punished', () => {
  const nodes = [
    node('blue', { jointFunction: 'Fires' }),
    node('blue', { jointFunction: 'Sustainment' }),
    node('red', { type: 'Fires' }),
    node('red', { type: 'Logistics' })
  ];
  const report = Cofm.assess(nodes);
  assert.equal(report.net, 1.00, 'symmetric two-domain board stays parity');
  assert.equal(report.sides.blue.domains.airsea.present, false);
  assert.equal(report.sides.blue.mC2, 1.00, 'absent C2 domain means no C2 penalty');
  const wf = report.sides.blue.domains.fires.weightNormalized;
  assert.ok(Math.abs(wf - 0.35 / 0.55) < 1e-9, String(wf));
});

check('ratio guards: dead Red floors at 0.05 and the net caps at 9.99', () => {
  const board = symmetricBoard();
  board.filter(n => n.team === 'red').forEach(n => { n.alive = false; });
  const report = Cofm.assess(board);
  assert.equal(report.net, 9.99);
  assert.ok(report.floored && report.capped);
  assert.equal(report.tier.key, 'heavy_blue');
});

check('neutralized status and alive:false zero a node exactly like moe.js', () => {
  assert.equal(Cofm.healthFraction({ health: 80, healthMax: 100, status: 'Neutralized' }), 0);
  assert.equal(Cofm.healthFraction({ health: 80, healthMax: 100, alive: false }), 0);
  assert.equal(Cofm.healthFraction({ health: 50, healthMax: 100 }), 0.5);
  assert.equal(Cofm.healthFraction({ health: 120, healthMax: 100 }), 1);
});

check('cascade-aware node weighting matches the moe.js form (importance × (1 + 0.5·casc))', () => {
  // One high-cascade key node vs many low nodes: killing it moves the index more.
  const nodes = [
    node('red', { type: 'Command', importance: 9, cascScore: 3 }),
    node('red', { type: 'Command', importance: 2, cascScore: 0 }),
    node('blue', { jointFunction: 'Command and control' })
  ];
  const before = Cofm.assess(nodes).sides.red.domains.c2info.index;
  nodes[0].health = 0;
  const after = Cofm.assess(nodes).sides.red.domains.c2info.index;
  const keyWeight = 9 * (1 + 0.5 * 3), smallWeight = 2 * 1;
  const expected = smallWeight / (keyWeight + smallWeight);
  assert.equal(before, 1);
  assert.ok(Math.abs(after - expected) < 1e-9, `${after} vs ${expected}`);
});

check('assess is deterministic and side-effect free', () => {
  const board = symmetricBoard();
  const a = JSON.stringify(Cofm.assess(board, { logistics: { blue: 'surge' } }));
  const b = JSON.stringify(Cofm.assess(board, { logistics: { blue: 'surge' } }));
  assert.equal(a, b);
});

check('format helpers escape hostile strings and carry the tier color', () => {
  const report = Cofm.assess(symmetricBoard());
  report.tier = { key: 'x', label: '<img src=x onerror=alert(1)>', color: '#ffd166"><script>' };
  const chip = Cofm.formatChip(report);
  assert.ok(!chip.includes('<img'), 'label must be escaped');
  assert.ok(!chip.includes('<script>'), 'color must be escaped');
  const clean = Cofm.assess(symmetricBoard());
  const card = Cofm.formatCard(clean);
  assert.ok(card.includes('dir-cofm-card') && card.includes('CORRELATION OF FORCES'));
  assert.ok(card.includes(clean.tier.color));
  assert.ok(card.includes('docs/COFM_MODEL.md'), 'card cites the model doc');
});

check('the real shipped datasets classify with zero unmapped surprises', () => {
  for (const file of ['grokblue90.json', 'grok150red.json']) {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    const list = Array.isArray(data) ? data : data.nodes || [];
    assert.ok(list.length > 0, file + ' has nodes');
    for (const n of list) {
      const d = Cofm.classifyDomain(n);
      assert.ok(['fires', 'airsea', 'c2info', 'sustain'].includes(d), file + ': ' + n.type + '/' + n.jointFunction);
    }
    const teams = new Set(list.map(n => n.team));
    assert.equal(teams.size, 1, file + ' is single-team');
  }
});

console.log('\ncofm-proof passed ' + passed.length + ' checks');
