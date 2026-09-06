#!/usr/bin/env node
'use strict';

/*
 * coa-planner-proof.js — contracts for the pure COA planning core (CO-017).
 *
 * scoreNode / selectTargets / buildMethodSequence are pure functions of a node list and a
 * wizard config. This proof pins their behavior directly (they had no coverage while they
 * lived inside the shell): scoring emphasis/penalties, selection ordering + domain
 * dispersal, and largest-remainder method-mix sequencing.
 *
 * UNCLASSIFIED // NOTIONAL RESEARCH TOOL
 */

const assert = require('assert');
const path = require('path');
const CoaPlanner = require(path.resolve(__dirname, '..', 'coa-planner.js'));

const passed = [];
const failures = [];
function check(name, fn) {
  try { fn(); passed.push(name); }
  catch (e) { failures.push({ name, message: e.message }); }
}

const red = (over) => Object.assign({
  id: 'r', team: 'red', status: 'Active', importance: 5, cascScore: 1, resourceGen: 0,
  difficulty: 'Medium', type: 'Depot', domain: ['land']
}, over || {});

const baseConf = () => ({
  numTargets: 3, objective: 'balanced', aggressiveness: 0.5,
  avoidHard: false, focusCTR: false, preferGeo: false, disperseDomains: false
});

// ── scoreNode ────────────────────────────────────────────────────────────────────────
check('scoreNode disqualifies non-red nodes and neutralized nodes', () => {
  assert.strictEqual(CoaPlanner.scoreNode({ team: 'blue' }, baseConf()), -Infinity);
  assert.strictEqual(CoaPlanner.scoreNode(red({ status: 'Neutralized' }), baseConf()), -Infinity);
  assert.strictEqual(CoaPlanner.scoreNode(null, baseConf()), -Infinity);
});

check('scoreNode rises with importance, cascade score, and resource generation', () => {
  const lo = CoaPlanner.scoreNode(red({ importance: 3, cascScore: 1, resourceGen: 0 }), baseConf());
  const hi = CoaPlanner.scoreNode(red({ importance: 9, cascScore: 6, resourceGen: 4 }), baseConf());
  assert.ok(hi > lo, `high-value node (${hi}) must outscore low-value node (${lo})`);
});

check('scoreNode is deterministic (pure) — identical inputs, identical output', () => {
  const n = red({ importance: 7 });
  assert.strictEqual(CoaPlanner.scoreNode(n, baseConf()), CoaPlanner.scoreNode(n, baseConf()));
});

check('objective emphasis orders payoff > balanced > risk for the same node', () => {
  const n = red({ importance: 7 });
  const payoff = CoaPlanner.scoreNode(n, Object.assign(baseConf(), { objective: 'payoff' }));
  const balanced = CoaPlanner.scoreNode(n, baseConf());
  const risk = CoaPlanner.scoreNode(n, Object.assign(baseConf(), { objective: 'risk' }));
  assert.ok(payoff > balanced && balanced > risk, `expected ${payoff} > ${balanced} > ${risk}`);
});

check('avoidHard penalizes hardened/buried targets', () => {
  const hard = red({ difficulty: 'Hardened' });
  const on = CoaPlanner.scoreNode(hard, Object.assign(baseConf(), { avoidHard: true }));
  const off = CoaPlanner.scoreNode(hard, Object.assign(baseConf(), { avoidHard: false }));
  assert.ok(on < off, `avoidHard should lower the score (${on} < ${off})`);
});

check('focusCTR boosts Command/Relay targets only', () => {
  const cmd = red({ type: 'Command Post' });
  const depot = red({ type: 'Depot' });
  const conf = Object.assign(baseConf(), { focusCTR: true });
  assert.ok(CoaPlanner.scoreNode(cmd, conf) > CoaPlanner.scoreNode(cmd, baseConf()), 'command node boosted');
  assert.strictEqual(CoaPlanner.scoreNode(depot, conf), CoaPlanner.scoreNode(depot, baseConf()));
});

check('preferGeo boosts nodes that carry coordinates', () => {
  const geo = red({ lat: 24.1, lon: 121.5 });
  const conf = Object.assign(baseConf(), { preferGeo: true });
  assert.ok(CoaPlanner.scoreNode(geo, conf) > CoaPlanner.scoreNode(geo, baseConf()), 'geolocated node boosted');
});

// ── selectTargets ────────────────────────────────────────────────────────────────────
check('selectTargets returns the top-N red targets by score, skipping ineligible nodes', () => {
  const nodes = [
    red({ id: 'r1', importance: 9 }),
    red({ id: 'r2', importance: 7 }),
    red({ id: 'r3', importance: 5 }),
    red({ id: 'r4', importance: 1 }),
    red({ id: 'rN', importance: 10, status: 'Neutralized' }),
    { id: 'b1', team: 'blue', importance: 10 }
  ];
  const picked = CoaPlanner.selectTargets(nodes, Object.assign(baseConf(), { numTargets: 3 }));
  assert.strictEqual(picked.length, 3);
  assert.deepStrictEqual(picked.map(n => n.id), ['r1', 'r2', 'r3']);
  assert.ok(!picked.some(n => n.team !== 'red' || n.status === 'Neutralized'), 'no ineligible node selected');
});

check('disperseDomains caps per-domain picks at ceil(numTargets/3)', () => {
  // numTargets=3 → maxPerDomain=1: expect one target per domain despite land being richest.
  const nodes = [
    red({ id: 'l1', importance: 9, domain: ['land'] }),
    red({ id: 'l2', importance: 8, domain: ['land'] }),
    red({ id: 's1', importance: 7, domain: ['sea'] }),
    red({ id: 'a1', importance: 6, domain: ['air'] })
  ];
  const picked = CoaPlanner.selectTargets(nodes, Object.assign(baseConf(), { numTargets: 3, disperseDomains: true }));
  assert.strictEqual(picked.length, 3);
  const domains = picked.map(n => (n.domain || []).join('|'));
  assert.strictEqual(new Set(domains).size, 3, 'three distinct domains represented');
  assert.deepStrictEqual(picked.map(n => n.id).sort(), ['a1', 'l1', 's1']);
});

// ── buildMethodSequence ──────────────────────────────────────────────────────────────
function counts(seq) {
  return seq.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
}

check('buildMethodSequence yields exactly `steps` methods', () => {
  assert.strictEqual(CoaPlanner.buildMethodSequence({ kinetic: 40, cyber: 20, ew: 20, sof: 20 }, 8).length, 8);
  assert.strictEqual(CoaPlanner.buildMethodSequence({ kinetic: 100, cyber: 0, ew: 0, sof: 0 }, 0).length, 0);
});

check('a 100% mix produces only that method; a 0% method never appears', () => {
  assert.deepStrictEqual(CoaPlanner.buildMethodSequence({ kinetic: 100, cyber: 0, ew: 0, sof: 0 }, 5),
    ['kinetic', 'kinetic', 'kinetic', 'kinetic', 'kinetic']);
  const c = counts(CoaPlanner.buildMethodSequence({ kinetic: 50, cyber: 50, ew: 0, sof: 0 }, 4));
  assert.strictEqual(c.ew || 0, 0);
  assert.strictEqual(c.sof || 0, 0);
});

check('largest-remainder rounding keeps counts proportional and summing to steps', () => {
  const c = counts(CoaPlanner.buildMethodSequence({ kinetic: 50, cyber: 50, ew: 0, sof: 0 }, 4));
  assert.strictEqual(c.kinetic, 2);
  assert.strictEqual(c.cyber, 2);
  const seq = CoaPlanner.buildMethodSequence({ kinetic: 40, cyber: 20, ew: 20, sof: 20 }, 8);
  assert.strictEqual(seq.length, 8);
  assert.strictEqual(counts(seq).kinetic, 3, 'kinetic is the plurality at 40% of 8');
});

check('buildMethodSequence tolerates an empty/undefined mix without throwing', () => {
  assert.strictEqual(CoaPlanner.buildMethodSequence(undefined, 3).length, 3);
  assert.strictEqual(CoaPlanner.buildMethodSequence({}, 3).length, 3);
});

console.log('UNCLASSIFIED // NOTIONAL RESEARCH TOOL');
if (failures.length) {
  console.log('COA-planner proof: IMPLEMENTATION MISMATCH (' + failures.length + '/' + (passed.length + failures.length) + ' checks failed)');
  failures.forEach(f => console.log('  FAIL  ' + f.name + '\n        ' + f.message));
  passed.forEach(p => console.log('  PASS  ' + p));
  process.exit(1);
}
console.log('COA-planner proof: ALL CONTRACTS HOLD (' + passed.length + ' checks)');
passed.forEach(p => console.log('  PASS  ' + p));
