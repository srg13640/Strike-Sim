#!/usr/bin/env node
'use strict';

/*
 * mind-games-proof.js
 *
 * Standalone Phase 3 contract proof for StrikeSim's small-game adversary,
 * doctrine-belief tracker, and premortem failure taxonomy.
 *
 * UNCLASSIFIED // NOTIONAL RESEARCH TOOL
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const redMindSource = read('red-mind.js');
const gameSource = read('game.js');
const forecastingSource = read('forecasting.js');
const directorSource = read('director.js');
const RedMind = require(path.join(ROOT, 'red-mind.js'));
const Forecasting = require(path.join(ROOT, 'forecasting.js'));
const StrategicState = require(path.join(ROOT, 'strategic-state.js'));

const passed = [];
const mismatches = [];

function check(name, fn) {
  try {
    fn();
    passed.push(name);
  } catch (error) {
    mismatches.push({ name, message: error && error.message ? error.message : String(error) });
  }
}

function near(actual, expected, tolerance, message) {
  assert.ok(Number.isFinite(actual), `${message}: expected a finite value, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected} ± ${tolerance}, got ${actual}`);
}

function assertSimplex(probabilities, label, tolerance = 1e-9) {
  assert.ok(Array.isArray(probabilities) && probabilities.length > 0,
    `${label}: strategy must be a non-empty array`);
  probabilities.forEach((value, index) => {
    assert.ok(Number.isFinite(value), `${label}[${index}] is not finite`);
    assert.ok(value >= -tolerance, `${label}[${index}] is negative: ${value}`);
    assert.ok(value <= 1 + tolerance, `${label}[${index}] exceeds one: ${value}`);
  });
  near(probabilities.reduce((sum, value) => sum + value, 0), 1, tolerance,
    `${label} must sum to one`);
}

function matrixValue(matrix, row, column) {
  let value = 0;
  for (let i = 0; i < row.length; i++) {
    for (let j = 0; j < column.length; j++) {
      value += row[i] * column[j] * Number(matrix[i][j]);
    }
  }
  return value;
}

function verifyRegretMatching() {
  const symmetric = [[1, -1], [-1, 1]];
  const symmetricMix = RedMind.regretMatching(symmetric, 1000);
  assertSimplex(symmetricMix.row, 'symmetric matching-pennies row');
  assertSimplex(symmetricMix.column, 'symmetric matching-pennies column');
  symmetricMix.row.concat(symmetricMix.column).forEach((p, index) => {
    assert.ok(p > 0.35 && p < 0.65,
      `symmetric matching pennies collapsed at support ${index}: ${p}`);
  });
  near(matrixValue(symmetric, symmetricMix.row, symmetricMix.column), 0, 0.02,
    'symmetric matching-pennies value');

  // This game has a unique interior equilibrium of (0.4, 0.6) for both players
  // and value 0.2. It catches an implementation that merely returns uniform play.
  const asymmetric = [[2, -1], [-1, 1]];
  const first = RedMind.regretMatching(asymmetric, 10000);
  const second = RedMind.regretMatching(asymmetric, 10000);
  assert.deepStrictEqual(first, second, 'regret matching must be deterministic');
  assertSimplex(first.row, 'asymmetric matching-pennies row');
  assertSimplex(first.column, 'asymmetric matching-pennies column');
  first.row.concat(first.column).forEach((p, index) => {
    assert.ok(p > 0.10 && p < 0.90,
      `asymmetric matching pennies lost full support at ${index}: ${p}`);
  });
  near(first.row[0], 0.4, 0.06, 'asymmetric row equilibrium probability');
  near(first.column[0], 0.4, 0.06, 'asymmetric column equilibrium probability');
  near(matrixValue(asymmetric, first.row, first.column), 0.2, 0.06,
    'asymmetric matching-pennies value');
}

function diagnosticFeatures() {
  return {
    decapitation: RedMind.orderFeature(
      { kind: 'strike', methodKey: 'cyber', targetId: 'RED-HQ' },
      { id: 'RED-HQ', subsystem: 'Command', type: 'Command' }
    ),
    attrition: RedMind.orderFeature(
      { kind: 'strike', methodKey: 'kinetic', targetId: 'BLUE-FIRES' },
      { id: 'BLUE-FIRES', subsystem: 'Firepower Strike', type: 'Fires' }
    ),
    denial: RedMind.orderFeature(
      { kind: 'harden', targetId: 'RED-LIFT' },
      { id: 'RED-LIFT', subsystem: 'Assault', type: 'Assault' }
    )
  };
}

function runDiagnosticSequence() {
  const feature = diagnosticFeatures();
  const models = {
    attrition: {
      counts: { [feature.decapitation]: 1, [feature.attrition]: 8, [feature.denial]: 1 },
      total: 10
    },
    decapitation: {
      counts: { [feature.decapitation]: 8, [feature.attrition]: 1, [feature.denial]: 1 },
      total: 10
    },
    denial: {
      counts: { [feature.decapitation]: 1, [feature.attrition]: 1, [feature.denial]: 8 },
      total: 10
    }
  };
  let belief = Object.assign({}, RedMind.PRIOR);
  const trajectory = [belief];
  for (let turn = 1; turn <= 4; turn++) {
    belief = RedMind.updatePosterior(
      belief,
      { [feature.decapitation]: 1 },
      models,
      0.5
    );
    trajectory.push(belief);
  }
  return { feature, models, trajectory };
}

function verifyBayesianPosterior() {
  const first = runDiagnosticSequence();
  const second = runDiagnosticSequence();
  assert.deepStrictEqual(first, second, 'same evidence sequence must produce the same posterior bytes');

  let previous = first.trajectory[0].decapitation;
  first.trajectory.forEach((belief, turn) => {
    const values = Object.keys(RedMind.PRIOR).map(id => belief[id]);
    assertSimplex(values, `posterior at diagnostic turn ${turn}`, 1e-12);
    values.forEach((value, index) => {
      assert.ok(value > 0, `Laplace smoothing failed at turn ${turn}, doctrine ${index}`);
    });
    if (turn > 0) {
      assert.ok(belief.decapitation > previous,
        `diagnostic evidence did not increase decapitation belief at turn ${turn}`);
      previous = belief.decapitation;
    }
  });
  assert.ok(first.trajectory[first.trajectory.length - 1].decapitation > 0.99,
    'repeated diagnostic evidence should strongly identify decapitation doctrine');

  const unseen = RedMind.updatePosterior(
    first.trajectory[first.trajectory.length - 1],
    { 'strike|other|ew': 1 },
    first.models,
    0.5
  );
  const unseenValues = Object.keys(RedMind.PRIOR).map(id => unseen[id]);
  assertSimplex(unseenValues, 'posterior after unseen feature', 1e-12);
  unseenValues.forEach((value, index) => {
    assert.ok(value > 0, `unseen feature zeroed doctrine ${index}`);
  });
}

function tinyGraph() {
  function node(id, team, type, subsystem) {
    return {
      id,
      name: id,
      team,
      type,
      subsystem,
      difficulty: 'Medium',
      importance: 5,
      cascScore: 1,
      health: 100,
      healthMax: 100,
      status: 'Active',
      scenarioEnabled: true,
      tempoRole: type === 'Command' ? 'command' : 'none',
      resourceGenByType: { kinetic: 1, cyber: 1, ew: 1, sof: 0 },
      domain: ['Joint'],
      vulnerabilities: ['Kinetic', 'Cyber', 'EW']
    };
  }
  return {
    nodes: [
      node('BLUE-HQ', 'blue', 'Command', 'Command'),
      node('BLUE-FIRES', 'blue', 'Fires', 'Firepower Strike'),
      node('RED-HQ', 'red', 'Command', 'Command'),
      node('RED-LIFT', 'red', 'Assault', 'Assault')
    ],
    links: [
      { source: 'BLUE-HQ', target: 'BLUE-FIRES' },
      { source: 'RED-HQ', target: 'RED-LIFT' }
    ]
  };
}

function loadGame(graph) {
  const context = {
    console: { log() {}, warn() {}, error() {} },
    window: {
      RedMindModule: RedMind,
      StrategicStateModule: StrategicState,
      AppState: { activeGraph: () => graph }
    },
    Math,
    Date,
    setTimeout,
    clearTimeout
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(gameSource, context, { filename: 'game.js' });
  return context.window.GameModule;
}

function forbiddenDoctrineKeys(value, pathParts, found) {
  pathParts = pathParts || [];
  found = found || [];
  if (!value || typeof value !== 'object') return found;
  Object.keys(value).forEach(key => {
    const next = pathParts.concat(key);
    if (/^(doctrine|trueDoctrine|redDoctrine|redDoctrineKey)$/i.test(key)) {
      found.push(next.join('.'));
    }
    forbiddenDoctrineKeys(value[key], next, found);
  });
  return found;
}

function verifyDoctrinePrivacy() {
  const game = loadGame(tinyGraph());
  game.init({});
  const state = game.newMatch({
    control: { blue: 'human', red: 'ai' },
    difficulty: { blue: 'hard', red: 'hard' },
    turnLimit: 8,
    seed: 73021
  });
  const save = game.serialize();

  assert.ok(state && state.phase === 'plan', 'privacy test requires a live pre-AAR match');
  assert.ok(state.redMind, 'public state must expose the doctrine belief contract');
  assert.strictEqual(state.redMind.revealedDoctrine, null,
    'true doctrine may only be revealed after the operation ends');
  assert.ok(!Object.prototype.hasOwnProperty.call(state.redMind, 'doctrine'),
    'public pre-AAR state exposes redMind.doctrine');
  assert.deepStrictEqual(Object.keys(state.redMind.prior).sort(), Object.keys(RedMind.PRIOR).sort(),
    'public prior must contain exactly the disclosed doctrine types');
  assertSimplex(Object.keys(RedMind.PRIOR).map(id => state.redMind.belief[id]),
    'public doctrine belief', 1e-12);

  assert.ok(save && save.redMind, 'save must contain the public Red-mind continuity record');
  assert.ok(!Object.prototype.hasOwnProperty.call(save.redMind, 'doctrine'),
    'serialized match exposes the hidden doctrine');
  assert.ok(!Object.prototype.hasOwnProperty.call(save.redMind, 'revealedDoctrine'),
    'serialized live match exposes a doctrine reveal field');
  assert.deepStrictEqual(forbiddenDoctrineKeys(save), [],
    'serialized live match contains a forbidden true-doctrine key');
  assert.strictEqual(state.aar, null, 'AAR must not be materialized before the operation ends');
}

function snapshot(overrides) {
  const base = {
    red: { throughput: 0.40, projectedLodgmentT5: 0.35 },
    blue: { nodesLostThisTurn: 0, keyNodesLostThisTurn: 0, tempoFrac: 1 }
  };
  return {
    red: Object.assign({}, base.red, overrides && overrides.red),
    blue: Object.assign({}, base.blue, overrides && overrides.blue)
  };
}

function verifyFailureTaxonomy() {
  const ids = Forecasting.FAILURE_CAUSES.map(cause => cause.id);
  assert.strictEqual(ids.length, 4, 'failure taxonomy must expose exactly four premortem causes');
  assert.strictEqual(new Set(ids).size, ids.length, 'failure taxonomy contains duplicate cause IDs');

  const cases = [
    { expected: 'sam-attrition', world: snapshot({ blue: { nodesLostThisTurn: 2 } }) },
    { expected: 'lift-intact', world: snapshot({ red: { throughput: 0.70 } }) },
    { expected: 'tempo-collapse', world: snapshot({ blue: { tempoFrac: 0.70 } }) },
    { expected: 'objective-timeout', world: snapshot({ red: { projectedLodgmentT5: 0.60 } }) }
  ];
  cases.forEach(testCase => {
    const result = Forecasting.classifyFailure(testCase.world);
    assert.deepStrictEqual(result, { failed: true, cause: testCase.expected },
      `${testCase.expected} diagnostic was not classified exclusively`);
    assert.ok(ids.includes(result.cause), `${result.cause} is not in the authored taxonomy`);
  });

  const success = Forecasting.classifyFailure(snapshot());
  assert.deepStrictEqual(success, { failed: false, cause: null },
    'non-failure world must not be assigned a cause');

  const overlap = Forecasting.classifyFailure(snapshot({
    red: { throughput: 0.90, projectedLodgmentT5: 0.90 },
    blue: { nodesLostThisTurn: 3, keyNodesLostThisTurn: 1, tempoFrac: 0.40 }
  }));
  assert.deepStrictEqual(overlap, { failed: true, cause: 'sam-attrition' },
    'overlapping indicators must resolve to one deterministic priority cause');

  const worlds = cases.map(testCase => testCase.world).concat(snapshot());
  const set = Forecasting.failureCauseSet(worlds);
  assert.strictEqual(set.K, 5, 'failure cause set lost model worlds');
  assert.strictEqual(set.failedWorlds, 4, 'failure cause set miscounted failed worlds');
  assert.deepStrictEqual(new Set(set.categories.map(cause => cause.id)), new Set(ids),
    'failure cause set does not cover the complete taxonomy');
  assert.strictEqual(set.categories.reduce((sum, cause) => sum + cause.count, 0), set.failedWorlds,
    'failure categories are not mutually exclusive');
  near(set.categories.reduce((sum, cause) => sum + cause.q, 0), 1, 1e-12,
    'failure-cause distribution');
  set.categories.forEach(cause => {
    assert.strictEqual(cause.count, 1, `${cause.id} diagnostic count should be one`);
    near(cause.q, 0.25, 1e-12, `${cause.id} diagnostic frequency`);
  });
}

function verifyLegacyProbesRemoval() {
  assert.ok(!/\bPROBES\b/.test(directorSource),
    'director.js still contains the legacy PROBES counterfactual table/path');
}

function verifyLegacyDisclaimerRemoval() {
  assert.ok(!directorSource.includes('EXPERIMENTAL ATTRITION SENSITIVITY'),
    'director.js still renders the legacy attrition-sensitivity disclaimer');
}

function verifyModuleContracts() {
  assert.doesNotThrow(() => new vm.Script(redMindSource, { filename: 'red-mind.js' }),
    'red-mind.js must parse');
  assert.doesNotThrow(() => new vm.Script(forecastingSource, { filename: 'forecasting.js' }),
    'forecasting.js must parse');
  assert.doesNotThrow(() => new vm.Script(gameSource, { filename: 'game.js' }),
    'game.js must parse');
  assert.doesNotThrow(() => new vm.Script(directorSource, { filename: 'director.js' }),
    'director.js must parse');
  assert.strictEqual(RedMind.CLASSIFICATION, 'UNCLASSIFIED // NOTIONAL RESEARCH TOOL');
  assert.strictEqual(Forecasting.CLASSIFICATION, 'UNCLASSIFIED // NOTIONAL RESEARCH TOOL');
}

check('Phase 3 modules parse and retain the classification boundary', verifyModuleContracts);
check('regret matching returns deterministic simplex strategies with interior matching-pennies play', verifyRegretMatching);
check('Bayesian doctrine posterior is deterministic, smoothed, normalized, and diagnostic', verifyBayesianPosterior);
check('public live state and serialized continuity record keep the true doctrine private', verifyDoctrinePrivacy);
check('premortem failure taxonomy is complete, normalized, and mutually exclusive', verifyFailureTaxonomy);
check('legacy PROBES counterfactual table/path is absent', verifyLegacyProbesRemoval);
check('legacy EXPERIMENTAL ATTRITION SENSITIVITY surface is absent', verifyLegacyDisclaimerRemoval);

if (mismatches.length) {
  console.error(`Mind-games proof: IMPLEMENTATION MISMATCH (${mismatches.length}/${passed.length + mismatches.length} checks failed)`);
  mismatches.forEach(result => console.error(`  FAIL  ${result.name}\n        ${result.message}`));
  if (passed.length) {
    console.error('  Passing contracts:');
    passed.forEach(name => console.error(`    PASS  ${name}`));
  }
  process.exit(1);
}

console.log(`Mind-games proof: PASS (${passed.length}/${passed.length} checks)`);
passed.forEach(name => console.log(`  PASS  ${name}`));
