#!/usr/bin/env node
'use strict';

/*
 * CO-005 Phase 3 proof — Counterfactual Colosseum uses the one resolver and the
 * denial/lodgment arbiter, preserves same-seed determinism, and stays in a worker.
 * UNCLASSIFIED // NOTIONAL RESEARCH TOOL
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function graphFixture() {
  function node(id, team, type, subsystem, importance) {
    return {
      id, name: id, team, type, subsystem, difficulty: 'Medium', importance: importance || 5,
      cascScore: 1, health: 300, healthMax: 300, status: 'Active', scenarioEnabled: true,
      tempoRole: type === 'Command' ? 'command' : type === 'Logistics' ? 'logistics' : null,
      resourceGenByType: { kinetic: 2, cyber: 1, ew: 1, sof: 0 },
      domain: ['Joint'], vulnerabilities: ['Kinetic', 'Cyber', 'EW']
    };
  }
  const nodes = [
    node('BLUE-C2', 'blue', 'Command', 'Command', 8),
    node('BLUE-FIRES', 'blue', 'Fires', 'Firepower Strike', 6),
    node('BLUE-LOG', 'blue', 'Logistics', 'Logistics', 5),
    node('RED-C2', 'red', 'Command', 'Command', 8),
    node('RED-LIFT', 'red', 'Assault', 'Assault', 8),
    node('RED-LOG', 'red', 'Logistics', 'Logistics', 6),
    node('RED-FIRES', 'red', 'Fires', 'Firepower Strike', 5)
  ];
  return {
    nodes,
    links: [
      { source: 'BLUE-C2', target: 'BLUE-FIRES' }, { source: 'BLUE-C2', target: 'BLUE-LOG' },
      { source: 'RED-C2', target: 'RED-LIFT' }, { source: 'RED-C2', target: 'RED-LOG' },
      { source: 'RED-C2', target: 'RED-FIRES' }
    ]
  };
}

function load(graph) {
  const context = { console: { log() {}, warn() {}, error() {} }, window: {}, Math, Date, setTimeout, clearTimeout, WeakMap };
  context.window.window = context.window;
  context.window.AppState = { activeGraph: () => graph };
  vm.createContext(context);
  // The canonical load order (CO-005 harness rule): strategic-state.js BEFORE game.js.
  // This proof was the seventh tool bitten by the missing line; fixed under CO-007.
  for (const file of ['moe.js', 'red-mind.js', 'strategic-state.js', 'game.js', 'counterfactual.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  return context.window;
}

function makeRecord(window, graph) {
  const game = window.GameModule;
  game.init({});
  let state = game.newMatch({
    seed: 8128, apBlue: 2, apRed: 2, turnLimit: 3,
    control: { blue: 'ai', red: 'ai' }, difficulty: { blue: 'easy', red: 'easy' }
  });
  for (let turn = 0; turn < 2 && state.phase !== 'over'; turn++) {
    state = game.commitTurn();
    if (state.phase === 'resolved') state = game.nextTurn();
  }
  const record = game.serialize();
  assert.ok(record.history.length >= 1, 'fixture did not resolve a turn');
  assert.ok(record.history[0].orders.blue.length >= 1, 'fixture produced no Blue decision to edit');
  return record;
}

const checks = [];
function check(name, fn) {
  try { fn(); checks.push({ name, pass: true }); }
  catch (error) { checks.push({ name, pass: false, detail: error.message || String(error) }); }
}

const graph = graphFixture();
const liveWindow = load(graph);
const record = makeRecord(liveWindow, graph);
// Counterfactual execution happens in a worker with no module-global live match. Loading a
// fresh context after the record is made proves the pure serialized-state boundary.
const windowOne = load(graph);
const CF = windowOne.CounterfactualModule;
const originalOrder = JSON.parse(JSON.stringify(record.history[0].orders.blue[0]));
const removePayload = {
  record, graph, edit: { turn: 1, orderIndex: 0, replacement: null }, authoredForecast: 0.61
};
const noOpPayload = {
  record, graph, edit: { turn: 1, orderIndex: 0, replacement: originalOrder }, authoredForecast: 0.50
};

check('single-order editor rejects ambiguous or illegal edits', () => {
  assert.strictEqual(CF.validateEdit(record, graph, { turn: 99, orderIndex: 0, replacement: null }).ok, false);
  assert.strictEqual(CF.validateEdit(record, graph, { turn: 1, orderIndex: 99, replacement: null }).ok, false);
  assert.strictEqual(CF.validateEdit(record, graph, { turn: 1, orderIndex: 0, replacement: { kind: 'strike', targetId: 'BLUE-C2', methodKey: 'kinetic' } }).ok, false);
  assert.strictEqual(CF.validateEdit(record, graph, removePayload.edit).ok, true);
});

check('no-op edit exactly reproduces the same-seed operational branch', () => {
  const pair = CF.runPair(noOpPayload, 0, 'matched');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(pair.original)), JSON.parse(JSON.stringify(pair.counterfactual)));
});

check('same request produces byte-identical matched pair and ensemble', () => {
  function run() {
    const matched = CF.runPair(removePayload, 0, 'matched');
    const aggregate = CF.newAggregate(30);
    for (let trial = 1; trial <= 30; trial++) CF.addPair(aggregate, CF.runPair(removePayload, trial, 'ensemble'));
    return JSON.stringify(CF.summarize(aggregate, matched, removePayload.authoredForecast));
  }
  assert.strictEqual(run(), run());
});

check('counterfactual path calls the exported resolver and shared denial accumulator', () => {
  const I = windowOne.GameModule._internal;
  const originalResolve = I.resolveTurn, originalAdvance = I.advanceDenialState;
  let resolverCalls = 0, denialCalls = 0;
  I.resolveTurn = function () { resolverCalls++; return originalResolve.apply(null, arguments); };
  I.advanceDenialState = function () { denialCalls++; return originalAdvance.apply(null, arguments); };
  try { CF.runPair(removePayload, 3, 'ensemble'); }
  finally { I.resolveTurn = originalResolve; I.advanceDenialState = originalAdvance; }
  assert.ok(resolverCalls > 0, 'resolveTurn was not invoked');
  assert.strictEqual(denialCalls, resolverCalls, 'every resolved turn must advance the shared denial/lodgment state');
});

check('ensemble returns counts, uncertainty bands, paired decision value, and proper score', () => {
  const matched = CF.runPair(removePayload, 0, 'matched');
  const aggregate = CF.newAggregate(40);
  for (let trial = 1; trial <= 40; trial++) CF.addPair(aggregate, CF.runPair(removePayload, trial, 'ensemble'));
  const result = CF.summarize(aggregate, matched, removePayload.authoredForecast);
  assert.strictEqual(result.ensemble.K, 40);
  assert.strictEqual(result.ensemble.counterfactual.hits + (40 - result.ensemble.counterfactual.hits), 40);
  assert.ok(result.ensemble.counterfactual.interval.lo <= result.ensemble.counterfactual.q);
  assert.ok(result.ensemble.counterfactual.interval.hi >= result.ensemble.counterfactual.q);
  assert.ok(result.ensemble.decisionValue.interval.lo <= result.ensemble.decisionValue.mean);
  assert.ok(result.ensemble.decisionValue.interval.hi >= result.ensemble.decisionValue.mean);
  assert.ok(Number.isFinite(result.score) && result.scoreInterval.lo <= result.score && result.scoreInterval.hi >= result.score);
});

check('worker imports the one kernel and never imports the legacy simulation core', () => {
  const worker = read('counterfactual-worker.js');
  const director = read('director.js');
  assert.ok(worker.includes("importScripts('moe.js', 'red-mind.js', 'strategic-state.js', 'game.js', 'counterfactual.js')"));
  assert.ok(!worker.includes('sim.js') && !worker.includes('sim-worker.js') && !worker.includes('simulateTrialCore'));
  assert.ok(!worker.includes('Math.random') && !worker.includes('Date.now'));
  assert.ok(director.includes("new Worker('counterfactual-worker.js')"));
  assert.ok(!director.includes('EXPERIMENTAL ATTRITION SENSITIVITY'));
});

const failures = checks.filter(result => !result.pass);
console.log('CO-005 Counterfactual Colosseum proof');
checks.forEach(result => console.log(`  ${result.pass ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`));
if (failures.length) {
  console.error(`\nCOUNTERFACTUAL PROOF FAILED (${failures.length}/${checks.length})`);
  process.exit(1);
}
console.log(`\nCOUNTERFACTUAL PROOF PASSED (${checks.length}/${checks.length})`);
