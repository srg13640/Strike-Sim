#!/usr/bin/env node
'use strict';

/*
 * Acceptance proof for strategic-state.js.
 *
 * UNCLASSIFIED // NOTIONAL RESEARCH TOOL
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'strategic-state.js');
const S = require(SOURCE);
const failures = [];

function fail(message) { failures.push(message); }
function assert(condition, message) { if (!condition) fail(message); }
function close(actual, expected, message, tolerance = 1e-9) {
  if (Math.abs(actual - expected) > tolerance) fail(`${message}: expected ${expected}, received ${actual}`);
}

function sequence(values) {
  let index = 0;
  return {
    calls: [],
    next(tag) {
      this.calls.push(tag);
      if (index >= values.length) throw new Error(`proof RNG exhausted at ${tag}`);
      return values[index++];
    }
  };
}

function proveEscalation() {
  const config = {
    min: 0,
    max: 10,
    horizontalWeights: { afloat: 0.2, 'prc-mainland': 1.0, 'japan-soil': 2.0 },
    verticalWeights: { ew: 0.1, cyber: 0.4, kinetic: 0.8, sof: 1.2 },
    outcomeMultipliers: { attempt: 1, miss: 0.75, hit: 1, kill: 1.2, void: 0 },
    diminishingReturns: { factor: 0.5, floor: 0.25 }
  };
  const afloatEw = S.updateEscalation(0, [{
    id: 'afloat-ew', methodKey: 'ew', outcome: 'hit',
    target: { escalationTags: ['afloat'] }
  }], config);
  const japanKinetic = S.updateEscalation(0, [{
    id: 'japan-ke', methodKey: 'kinetic', outcome: 'hit',
    target: { escalationTags: ['japan-soil'] }
  }], config);
  assert(japanKinetic.after > afloatEw.after, 'Japan-soil kinetic action must outrank afloat EW action');
  close(afloatEw.breakdown.horizontal.adjusted, 0.2, 'horizontal breakdown');
  close(afloatEw.breakdown.vertical.adjusted, 0.1, 'vertical breakdown');

  const repeated = S.updateEscalation(0, [
    { id: 'a', methodKey: 'kinetic', outcome: 'hit', target: { escalationTags: ['prc-mainland'] } },
    { id: 'b', methodKey: 'kinetic', outcome: 'hit', target: { escalationTags: ['prc-mainland'] } }
  ], config);
  close(repeated.breakdown.horizontal.raw, 2, 'raw horizontal impulses remain inspectable');
  close(repeated.breakdown.horizontal.adjusted, 1.5, 'second horizontal impulse is diminished');
  close(repeated.breakdown.vertical.adjusted, 1.2, 'second vertical impulse is diminished');

  const reversed = S.updateEscalation(0, [
    { id: 'b', methodKey: 'kinetic', outcome: 'hit', target: { escalationTags: ['prc-mainland'] } },
    { id: 'a', methodKey: 'kinetic', outcome: 'hit', target: { escalationTags: ['prc-mainland'] } }
  ], config);
  close(reversed.after, repeated.after, 'same-turn escalation is input-order independent');

  const upper = S.updateEscalation(9.9, [{
    id: 'upper', horizontalImpulse: 50, verticalImpulse: 50
  }], config);
  assert(upper.after === 10 && upper.clamped, 'upper escalation clamp failed');
  const lower = S.updateEscalation(0.1, [], Object.assign({}, config, { baseTurnDelta: -5 }));
  assert(lower.after === 0 && lower.clamped, 'lower escalation clamp failed');
}

function proveRoe() {
  const roe = {
    id: 'measured-response',
    defaultDecision: 'allow',
    rules: [{
      id: 'no-mainland-before-e6',
      appliesTo: { actionKinds: ['strike'], targetTagsAny: ['prc-mainland'] },
      require: { minEscalation: 6 },
      message: 'No mainland strikes before E6.'
    }]
  };
  const mainland = { escalationTags: ['prc-mainland'], geographyClass: 'homeland-littoral' };
  const afloat = { escalationTags: ['afloat'], geographyClass: 'afloat' };
  const order = { side: 'blue', kind: 'strike', methodKey: 'kinetic', targetId: 'R1' };
  const denied = S.authorizeOrder(order, { escalation: 5.9, target: mainland }, roe);
  assert(!denied.ok && denied.reason === 'roe-min-escalation' && denied.ruleId === 'no-mainland-before-e6',
    'ROE did not block pre-threshold mainland strike');
  assert(S.authorizeOrder(order, { escalation: 6, target: mainland }, roe).ok,
    'ROE did not permit mainland strike at threshold');
  assert(S.authorizeOrder(order, { escalation: 2, target: afloat }, roe).ok,
    'ROE incorrectly blocked an afloat target');
  assert(S.authorizeOrder({ side: 'blue', kind: 'harden' }, { escalation: 0, target: mainland }, roe).ok,
    'ROE incorrectly blocked an unrelated order kind');
}

function proveAllyHysteresis() {
  const config = {
    id: 'japan',
    entryThreshold: 6,
    exitThreshold: 4,
    entryResetThreshold: 4.5,
    exitResetThreshold: 6,
    entryProbability: 0.5,
    exitProbability: 0.5,
    activateGroups: ['japan-access', 'japan-cyber']
  };
  let track = S.createAllyTrack(config, { active: false, lastEscalation: 3 });
  const rng = sequence([0.2, 0.2]);
  let result = S.advanceAllyTrack(track, 6, config, rng, { turn: 2 });
  assert(result.transition && result.transition.type === 'entry' && result.track.active,
    'entry threshold crossing did not activate ally');
  assert(result.drawConsumed && rng.calls.length === 1, 'entry crossing did not consume exactly one draw');
  track = result.track;

  result = S.advanceAllyTrack(track, 7, config, rng, { turn: 3 });
  assert(!result.attempted && rng.calls.length === 1, 'remaining above entry threshold repeated the draw');
  track = result.track;
  result = S.advanceAllyTrack(track, 5, config, rng, { turn: 4 });
  assert(!result.attempted && track.active, 'hysteresis band caused premature exit');
  track = result.track;
  result = S.advanceAllyTrack(track, 4, config, rng, { turn: 5 });
  assert(result.transition && result.transition.type === 'exit' && !result.track.active,
    'exit threshold crossing did not deactivate ally');
  assert(rng.calls.length === 2, 'exit crossing did not consume exactly one additional draw');
  track = result.track;
  result = S.advanceAllyTrack(track, 3, config, rng, { turn: 6 });
  assert(!result.attempted && rng.calls.length === 2, 'remaining below exit threshold repeated the draw');

  // A failed entry must not retry until the configured reset threshold is crossed.
  const retryRng = sequence([0.9, 0.1]);
  track = S.createAllyTrack(config, { active: false, lastEscalation: 3 });
  result = S.advanceAllyTrack(track, 6, config, retryRng, { turn: 1 });
  assert(result.attempted && !result.track.active, 'failed entry control did not fail');
  assert(result.track.lastDecision && result.track.lastDecision.type === 'entry' && !result.track.lastDecision.passed,
    'failed entry was not recorded as an entry attempt');
  track = result.track;
  result = S.advanceAllyTrack(track, 8, config, retryRng, { turn: 2 });
  assert(!result.attempted && retryRng.calls.length === 1, 'failed entry retried without reset');
  track = result.track;
  result = S.advanceAllyTrack(track, 4.5, config, retryRng, { turn: 3 });
  track = result.track;
  result = S.advanceAllyTrack(track, 6, config, retryRng, { turn: 4 });
  assert(result.track.active && retryRng.calls.length === 2, 'entry did not re-arm after reset crossing');

  const activated = S.applyActivationTransition({ groups: { baseline: true, 'japan-access': false } },
    { actor: 'japan', type: 'entry', turn: 2, activateGroups: ['japan-access', 'japan-cyber'] });
  assert(activated.state.groups.baseline === true && activated.state.groups['japan-access'] === true &&
    activated.state.groups['japan-cyber'] === true, 'activation transition lost or failed groups');
  const deactivated = S.applyActivationTransition(activated.state,
    { actor: 'japan', type: 'exit', turn: 5, deactivateGroups: ['japan-access', 'japan-cyber'] });
  assert(deactivated.state.groups.baseline === true && deactivated.state.groups['japan-access'] === false,
    'deactivation transition changed unrelated state or failed group');
}

function proveIndicatorsAndSignals() {
  const feint = S.createFeintOrder({
    id: 'R-FEINT-1', side: 'red', turn: 1, axis: 'south', targetClass: 'amphibious lift'
  });
  const decoy = S.createDecoySignal({
    id: 'R-DECOY-1', side: 'red', turn: 1, axis: 'north', targetClass: 'air defense'
  });
  assert(feint.cost === 1 && feint.apCost === 1 && S.signalCost(feint) === 1,
    'feint cost is not explicitly one AP');
  assert(decoy.cost === 0 && decoy.apCost === 0 && S.signalCost(decoy) === 0,
    'decoy cost is not explicitly zero AP');
  assert(!S.hasBoardEffect(feint) && !S.hasBoardEffect(decoy) &&
    feint.boardEffect === 'none' && decoy.boardEffect === 'none',
    'feint or decoy incorrectly has a board effect');

  const leakRng = sequence([0.2, 0.8]);
  const caught = S.resolveSignalLeak(decoy, { leakProbabilityByKind: { decoy: 0.5 } }, leakRng);
  const clean = S.resolveSignalLeak(Object.assign({}, decoy, { id: 'R-DECOY-2' }),
    { leakProbabilityByKind: { decoy: 0.5 } }, leakRng);
  assert(caught.assessedDeceptive && caught.deceptionObservation && caught.leak.drawConsumed,
    'caught decoy did not emit deception observation');
  assert(!clean.assessedDeceptive && clean.deceptionObservation === null,
    'uncaught decoy was incorrectly flagged deceptive');

  const orders = [
    {
      id: 'R-STRIKE-1', side: 'red', kind: 'strike', methodKey: 'kinetic', targetId: 'B1'
    },
    feint,
    caught
  ];
  const nodesById = {
    B1: { indicatorTags: { axis: 'central', targetClass: 'joint command' }, type: 'Command' }
  };
  const a = S.generateIndicators(orders, { count: 4, nodesById, rng: sequence([0.31, 0.72, 0.11, 0.9, 0.2, 0.8, 0.4, 0.6]) });
  const b = S.generateIndicators(orders, { count: 4, nodesById, rng: sequence([0.31, 0.72, 0.11, 0.9, 0.2, 0.8, 0.4, 0.6]) });
  assert(a.length === 4 && a.length >= 2 && a.length <= 4, 'indicator count is outside 2–4');
  assert(JSON.stringify(a) === JSON.stringify(b), 'same committed orders and seeded rolls changed indicators');
  assert(a.every(line => typeof line.text === 'string' && line.facet && 'assessedDeceptive' in line),
    'indicator output is not structured');

  const noOrders = S.generateIndicators([], { count: 2, rng: sequence([0, 0, 0, 0]) });
  assert(noOrders.length === 2 && noOrders.every(line => line.facet === 'absence'),
    'empty committed package did not yield bounded absence indicators');
}

function provePurityBoundary() {
  const source = fs.readFileSync(SOURCE, 'utf8');
  assert(!source.includes('Math' + '.random'), 'module references ambient random state');
  assert(!source.includes('Date' + '.now'), 'module references ambient clock state');
  assert(S.CLASSIFICATION === 'UNCLASSIFIED // NOTIONAL RESEARCH TOOL', 'classification stamp missing');
  const initial = S.createStrategicState({ escalation: { initial: 3 } });
  assert(initial.version === 1 && initial.escalation.value === 3 && initial.classification === S.CLASSIFICATION,
    'initial strategic-state contract is malformed');
}

function main() {
  proveEscalation();
  proveRoe();
  proveAllyHysteresis();
  proveIndicatorsAndSignals();
  provePurityBoundary();

  if (failures.length) {
    console.error(`\nESCALATION PROOF FAILED (${failures.length})`);
    failures.forEach(message => console.error(`- ${message}`));
    process.exit(1);
  }
  console.log('Strategic-state escalation proof passed');
  console.log('Clamp/orderings · ROE · hysteresis/threshold-only tremble · activation · indicators · feint/decoy semantics: PASS');
  console.log(S.CLASSIFICATION);
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
