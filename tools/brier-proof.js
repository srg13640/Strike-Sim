#!/usr/bin/env node
'use strict';

/* CO-005 Phase 2 scoring proof — UNCLASSIFIED // NOTIONAL RESEARCH TOOL */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'forecasting.js'), 'utf8');
const context = { window: {}, Math };
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'forecasting.js' });
const F = context.window.ForecastingModule;

const results = [];
function check(name, pass, detail) { results.push({ name, pass: !!pass, detail: detail || '' }); }
function close(a, b, eps = 1e-10) { return Math.abs(a - b) <= eps; }
function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return { next() { s = (s * 48271) % 2147483647; return s / 2147483647; } };
}

const worlds = Array.from({ length: 200 }, (_, i) => {
  const targetAlive = i >= 74;
  const throughput = (i % 100) / 100;
  const keyLoss = i % 5 === 0 ? 1 : 0;
  return {
    nodes: {
      'PLA-PRIMARY-1': { team: 'red', alive: targetAlive, healthFrac: targetAlive ? 0.7 : 0 },
      'TWN-KEY-1': { team: 'blue', alive: keyLoss === 0, healthFrac: keyLoss ? 0 : 1 }
    },
    red: {
      throughput,
      lodgment: Math.min(1, 0.1 + throughput / 4),
      projectedLodgmentT5: Math.min(1, 0.1 + throughput * 1.25),
      nodesDownThisTurn: targetAlive ? 0 : 1,
      sensorNodesDownThisTurn: i % 4 === 0 ? 1 : 0,
      commandNodesDownThisTurn: i % 7 === 0 ? 1 : 0
    },
    blue: { keyNodesLostThisTurn: keyLoss, alive: 100 - keyLoss, tempoFrac: 1 - keyLoss * 0.1 },
    result: { halt: throughput < 0.3, lodgmentComplete: false }
  };
});

const questionContext = {
  turn: 2,
  primaryTargetId: 'PLA-PRIMARY-1',
  primaryTargetName: 'Primary Amphibious Lift Group',
  primaryTarget: { type: 'Assault', subsystem: 'Assault' }
};
const setA = F.generateQuestionSet(worlds, questionContext);
const setB = F.generateQuestionSet(worlds, questionContext);
check('Question set is byte-identical for identical model worlds', JSON.stringify(setA) === JSON.stringify(setB));
check('Question-set hash is stable and populated', setA.questionSetHash === setB.questionSetHash && /^[0-9a-f]{8}$/.test(setA.questionSetHash));
check('Commit Card produces exactly three end-turn event questions', setA.questions.length === 3);
check('All generated event predicates resolve in every model world', setA.questions.every(q => worlds.every(w => F.resolvePredicate(w, q.predicate).resolved)));
check('Standing question resolution predicate is allowlisted and resolvable', worlds.every(w => F.resolvePredicate(w, setA.standing.predicate).resolved));
check('Throughput threshold lands in Goldilocks range', (() => {
  const q = setA.questions.find(x => x.category === 'logistics' && x.deadline.turn === 2);
  return q && q.house.q >= 0.2 && q.house.q <= 0.8;
})());
check('Every house line carries counts and a 90% interval', setA.questions.concat([setA.standing]).every(q =>
  q.house.K === 200 && Number.isInteger(q.house.hits) && q.house.interval.lo != null && q.house.interval.hi != null));
check('Standing question is actually time-bound to T+5', setA.standing.deadline.turn === 5 && setA.standing.predicate.path === 'red.lodgment');
check('Arbitrary predicate paths are rejected', !F.resolvePredicate(worlds[0], { path: '__proto__.polluted', op: 'eq', value: true }).resolved);

// Known scoring cases.
check('Binary Brier known case', close(F.brier(0.8, 1), 0.04));
check('Winkler interval inside case', close(F.winkler(0.2, 0.6, 0.4, 0.2), 0.4));
check('Winkler interval below case', close(F.winkler(0.2, 0.6, 0.1, 0.2), 1.4));
check('Winkler interval above case', close(F.winkler(0.2, 0.6, 0.8, 0.2), 2.4));
check('Multicategory Brier known case', close(F.multicategoryBrier([0.2, 0.5, 0.3], 1), 0.38));

const synthetic = Array.from({ length: 100 }, (_, i) => {
  const house = ((i % 9) + 1) / 10;
  const outcome = (i * 37) % 100 < house * 100 ? 1 : 0;
  return { questionId: 'q' + i, player: house, house, outcome };
});
const copied = F.brierSkill(synthetic);
check('House-copying player has BSS exactly zero', close(copied.value, 0), `BSS=${copied.value}`);
check('BSS zero-denominator case is guarded', F.brierSkill([{ player: 1, house: 1, outcome: 1 }]).value === null);

const decomposition = F.murphy(synthetic);
check('Murphy identity BS = REL - RES + UNC', Math.abs(decomposition.identityError) < 1e-12,
  `error=${decomposition.identityError}`);

// Folding below-50 forecasts changes presentation, not the underlying score.
const foldedInvariant = synthetic.every(entry => {
  const p = entry.player;
  const confidence = Math.max(p, 1 - p);
  const correct = p >= 0.5 ? entry.outcome : 1 - entry.outcome;
  return close(F.brier(p, entry.outcome), F.brier(confidence, correct));
});
check('Folded-confidence display preserves each Brier score', foldedInvariant);

const bandA = F.bootstrapBss(synthetic.map((e, i) => Object.assign({}, e, { player: Math.min(0.99, e.house + (i % 2 ? 0.05 : -0.05)) })), rng(77), 400);
const bandB = F.bootstrapBss(synthetic.map((e, i) => Object.assign({}, e, { player: Math.min(0.99, e.house + (i % 2 ? 0.05 : -0.05)) })), rng(77), 400);
check('Bootstrap band is deterministic under a tagged RNG', JSON.stringify(bandA) === JSON.stringify(bandB));
check('Verdict/rank is gated below 50 resolutions', F.analystRank(synthetic.slice(0, 49), { lo: 1 }).verdict === false);
check('Folded bucket dots are gated below n=10', F.foldedBuckets(synthetic.slice(0, 9)).every(b => !b.display));
check('Forecasting module uses no ambient randomness or clock', !source.includes('Math.random') && !source.includes('Date.now'));

// Engine lock and compiled-arbiter parity on the shipped scenario.
{
  const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
  const red = JSON.parse(read('grok150red.json'));
  const blue = JSON.parse(read('grokblue90.json'));
  const graph = { nodes: JSON.parse(JSON.stringify(red.nodes)).concat(JSON.parse(JSON.stringify(blue.nodes))), links: JSON.parse(JSON.stringify(red.links)).concat(JSON.parse(JSON.stringify(blue.links))) };
  const c = { console: { log() {}, warn() {}, error() {} }, window: {}, Math, Date, setTimeout, clearTimeout, WeakMap };
  c.window.window = c.window;
  c.window.AppState = { activeGraph: () => graph };
  vm.createContext(c);
  for (const file of ['moe.js', 'red-mind.js', 'game.js']) vm.runInContext(read(file), c, { filename: file });
  const game = c.window.GameModule;
  game.init({});
  let state = game.newMatch({ seed: 8080, control: { blue: 'human', red: 'ai' } });
  const ownId = state.objectiveIds.blue[0];
  check('Human order can be queued before lock', game.queueOrder('blue', { kind: 'harden', targetId: ownId }) === true);
  const lock = game._internal.lockOrders('blue');
  const before = JSON.stringify(game.getState().orders.blue);
  game.removeOrder('blue', 0);
  const rejected = game.validOrder('blue', { kind: 'harden', targetId: ownId });
  check('Engine lock blocks every order mutation path', lock.ok && JSON.stringify(game.getState().orders.blue) === before && rejected.reason === 'orders-locked');
  check('Locked order hash is stable through the blind/hybrid interval', game._internal.lockedOrderHash('blue') === lock.orderHash);
  check('Pre-reveal unlock restores planning authority', game._internal.unlockOrders('blue') === true && game.getState().ordersLocked.blue === false);

  const board = game._internal.buildBoard(graph);
  board.rosters.red.slice(0, 25).forEach((id, i) => {
    board.nodes[id].health = (i * 37) % 101;
    board.nodes[id].alive = board.nodes[id].health > 0;
  });
  const graphShape = game._internal.moeRedNodes(board);
  const regular = c.window.MoeModule.assessGraph(graphShape);
  const compiled = c.window.MoeModule.compileGraph(graphShape);
  const fast = c.window.MoeModule.assessCompiled(compiled, board.nodes);
  check('Compiled ensemble MOE is byte-identical to the live arbiter', JSON.stringify(regular) === JSON.stringify(fast));

  const director = read('director.js');
  const blindStart = director.indexOf('function renderBlindCommit');
  const blindEnd = director.indexOf('function renderHybridCommit', blindStart);
  const blindSource = director.slice(blindStart, blindEnd);
  check('Blind card contains no house forecast or frequency reveal', !blindSource.includes('forecastStrip') && !blindSource.includes('House model worlds'));
  check('House reveal permits exactly one final submission and no replanning path',
    director.includes("op.commitCard.step = 'hybrid'") && director.includes("op.commitCard.step = 'ready'") &&
    director.includes("op.commitCard && op.commitCard.step === 'blind'") && !director.includes('data-act="back"'));
}

const failures = results.filter(x => !x.pass);
console.log('CO-005 forecasting / proper-scoring proof');
for (const result of results) console.log(`${result.pass ? '  PASS' : '  FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
if (failures.length) {
  console.error(`\nBRIER PROOF FAILED (${failures.length}/${results.length})`);
  process.exit(1);
}
console.log(`\nBRIER PROOF PASSED (${results.length}/${results.length})`);
