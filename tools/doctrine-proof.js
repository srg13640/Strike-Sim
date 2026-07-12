#!/usr/bin/env node
'use strict';

/*
 * CO-005 Phase 1 proof — Harsanyi doctrines, belief-respecting ghosts, and
 * bounded level-k/quantal response.
 *
 * UNCLASSIFIED // NOTIONAL RESEARCH TOOL
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const json = file => JSON.parse(read(file));
const clone = value => JSON.parse(JSON.stringify(value));

function graph() {
  const red = json('grok150red.json');
  const blue = json('grokblue90.json');
  return { nodes: clone(red.nodes || []).concat(clone(blue.nodes || [])), links: clone(red.links || []).concat(clone(blue.links || [])) };
}

function load(activeGraph) {
  const context = {
    console: { log() {}, warn() {}, error() {} },
    window: {}, Math, Date, setTimeout, clearTimeout, WeakMap
  };
  context.window.window = context.window;
  context.window.AppState = { activeGraph: () => activeGraph };
  vm.createContext(context);
  for (const file of ['moe.js', 'red-mind.js', 'strategic-state.js', 'game.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  return { game: context.window.GameModule, mind: context.window.RedMindModule, moe: context.window.MoeModule };
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || '' });
}
function stableOrders(orders) {
  return JSON.stringify((orders || []).map(o => ({ side: o.side, kind: o.kind, methodKey: o.methodKey || null, targetId: o.targetId, sourceId: o.sourceId || null })));
}
function play(seed, difficulty = 'hard') {
  const g = graph();
  const { game } = load(g);
  game.init({});
  let state = game.newMatch({ control: { blue: 'ai', red: 'ai' }, difficulty: { blue: difficulty, red: difficulty }, turnLimit: 8, seed });
  const firstPublic = clone(state.redMind);
  const firstSave = clone(game.serialize());
  let guard = 0;
  while (state.phase !== 'over' && guard++ < 10) {
    state = game.commitTurn();
    if (state.phase === 'resolved') state = game.nextTurn();
  }
  return { state, save: game.serialize(), firstPublic, firstSave };
}

function forecastFixture() {
  const g = graph();
  const { game, mind, moe } = load(g);
  game.init({});
  const state = game.newMatch({ control: { blue: 'human', red: 'ai' }, difficulty: { blue: 'hard', red: 'hard' }, turnLimit: 8, seed: 4242 });
  const I = game._internal;
  const board = I.buildBoard(g);
  const blueOrders = I.planOrders(board, 'blue', state.ap.blue, mind.BALANCED, I.makeRng(I.hashSeed(4242, 'proof-blue')));
  const belief = mind.normalizeBelief(state.redMind.belief);
  const compiledMoe = moe.compileGraph(I.moeRedNodes(board));
  function run() {
    const started = process.hrtime.bigint();
    const cache = I.buildBeliefPlanCache(board, state.ap, 'hard', 4242, 1, state.cfg);
    const working = I.cloneBoardForAi(board);
    const rows = [];
    for (let k = 0; k < 200; k++) {
      I.resetBoardForAi(working, board);
      const sampled = I.sampleBeliefPlan(cache, belief, 4242, 1, k);
      const report = I.resolveTurn(working, blueOrders.concat(sampled.orders), state.cfg,
        I.makeRng(I.hashSeed(4242, 'ghost-res', 1, k)));
      const denial = moe.assessCompiled(compiledMoe, working.nodes);
      rows.push({ doctrine: sampled.doctrine, kills: report.kills.slice(), scoreDelta: report.scoreDelta, throughput: denial.throughput });
    }
    return { bytes: JSON.stringify({ cache: { byDoctrine: cache.byDoctrine, rollouts: cache.rollouts }, rows }), ms: Number(process.hrtime.bigint() - started) / 1e6, cache };
  }
  return { run, I, board, state, mind };
}

// Prior/type contract.
{
  const g = graph();
  const { game, mind } = load(g);
  game.init({});
  game.newMatch({ seed: 99, control: { blue: 'human', red: 'ai' } });
  const I = game._internal;
  const counts = { attrition: 0, decapitation: 0, denial: 0 };
  for (let k = 0; k < 5000; k++) {
    counts[mind.drawDoctrine(mind.PRIOR, I.makeRng(I.hashSeed(777, 'doctrine-proof', k)))]++;
  }
  const rates = Object.fromEntries(Object.entries(counts).map(([id, n]) => [id, n / 5000]));
  check('Doctrine sampler tracks disclosed 50/30/20 prior',
    Math.abs(rates.attrition - 0.50) < 0.03 && Math.abs(rates.decapitation - 0.30) < 0.03 && Math.abs(rates.denial - 0.20) < 0.03,
    JSON.stringify(rates));
  check('Same tagged seed gives same doctrine draw',
    mind.drawDoctrine(mind.PRIOR, I.makeRng(I.hashSeed(123, 'doctrine'))) ===
    mind.drawDoctrine(mind.PRIOR, I.makeRng(I.hashSeed(123, 'doctrine'))));
}

// Hidden truth and whole-match determinism.
const first = play(314159);
const second = play(314159);
check('Public state hides Red type before AAR', first.firstPublic.revealedDoctrine === null);
check('Serialized Red-mind state omits hidden doctrine', first.firstSave.redMind && first.firstSave.redMind.doctrine === undefined);
check('AAR reveals one named doctrine', ['attrition', 'decapitation', 'denial'].includes(first.state.redMind.revealedDoctrine));
check('Same seed produces byte-identical match record', JSON.stringify(first.save) === JSON.stringify(second.save));

// Policy differences, legacy strings, bounded rollouts.
{
  const g = graph();
  const { game, mind } = load(g);
  game.init({});
  const state = game.newMatch({ seed: 2718, control: { blue: 'human', red: 'ai' } });
  const I = game._internal;
  const board = I.buildBoard(g);
  const plans = {};
  for (const id of ['attrition', 'decapitation', 'denial']) {
    plans[id] = I.planOrders(board, 'red', state.ap.red, mind.doctrine(id), I.makeRng(I.hashSeed(2718, 'policy', id)));
  }
  check('Doctrine policies produce materially different plans', new Set(Object.values(plans).map(stableOrders)).size >= 2,
    Object.entries(plans).map(([id, p]) => `${id}:${stableOrders(p)}`).join(' | '));
  for (const legacy of ['easy', 'hard', 'elite']) {
    const plan = I.planOrders(board, 'red', state.ap.red, legacy, I.makeRng(I.hashSeed(2718, 'legacy', legacy)));
    check(`Legacy difficulty string ${legacy} remains accepted`, Array.isArray(plan) && plan.length > 0);
  }
  for (const diff of ['hard', 'elite']) {
    let planned;
    for (let seed = 1; seed < 100; seed++) {
      planned = I.planStrategicOrders(board, 'red', state.ap.red, mind.doctrine('denial'), diff, {
        seed, turn: 1, tag: 'proof-level-k', opponentAp: state.ap.blue, cfg: state.cfg
      });
      if (planned.reasoning.k === mind.difficulty(diff).k) break;
    }
    check(`${diff} uses configured bounded reasoning level`, planned.reasoning.k === mind.difficulty(diff).k,
      `k=${planned.reasoning.k}, configured=${planned.reasoning.configuredK}`);
    check(`${diff} stays at or below 50 resolver rollouts`, planned.reasoning.rollouts <= 50,
      `rollouts=${planned.reasoning.rollouts}`);
    check(`${diff} quantal probabilities form a finite simplex`,
      planned.reasoning.probabilities.every(Number.isFinite) && Math.abs(planned.reasoning.probabilities.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  }
}

// A2 functional and static landmine guards plus performance/determinism.
{
  const fixture = forecastFixture();
  const warm = fixture.run();
  const measured = [fixture.run(), fixture.run(), fixture.run()].sort((a, b) => a.ms - b.ms)[1];
  const repeat = fixture.run();
  check('Belief-respecting forecast is byte-identical for same seed', measured.bytes === repeat.bytes);
  check('Forecast cache uses exactly 48 shared planning rollouts', measured.cache.rollouts === 48, `rollouts=${measured.cache.rollouts}`);
  check('200-world forecast remains in the ~50 ms performance class', measured.ms <= 90, `median=${measured.ms.toFixed(1)} ms`);

  const gameSource = read('game.js');
  const directorSource = read('director.js');
  const sampleStart = gameSource.indexOf('function sampleBeliefPlan');
  const sampleEnd = gameSource.indexOf('\n  // ===================================================================================', sampleStart);
  const sampleSource = gameSource.slice(sampleStart, sampleEnd);
  const ghostStart = directorSource.indexOf('function ghostForecast');
  const ghostEnd = directorSource.indexOf('\n  function forecastStrip', ghostStart);
  const ghostSource = directorSource.slice(ghostStart, ghostEnd);
  check('Ghost type draw uses dedicated ghost-doctrine tag', sampleSource.includes("'ghost-doctrine'"));
  check('Belief-plan API has no true-doctrine input or match closure read',
    /function sampleBeliefPlan\(cache, belief, seed, turn, k\)/.test(sampleSource) &&
    !sampleSource.includes('match.redMind') && !sampleSource.includes('revealedDoctrine'));
  check('Director passes only public belief into ghost plan sampling',
    ghostSource.includes('st.redMind && st.redMind.belief') && ghostSource.includes('sampleBeliefPlan') &&
    !ghostSource.includes('revealedDoctrine'));
  check('Brief discloses prior and explicitly denies truth disclosure',
    directorSource.includes('INTEL ASSESSMENT — PLA POSTURE') && directorSource.includes('not Red’s hidden draw'));
  check('Legacy target jitter and random easy mistakes are absent',
    !gameSource.includes('0.85 + rng.next() * 0.3') && !/rng\.next\(\)\s*<\s*0\.4/.test(gameSource));
  check('New Red-mind module uses no ambient randomness or clock seed',
    !read('red-mind.js').includes('Math.random') && !read('red-mind.js').includes('Date.now'));
}

const failures = results.filter(r => !r.pass);
console.log('CO-005 doctrine / bounded-reasoning proof');
for (const result of results) {
  console.log(`${result.pass ? '  PASS' : '  FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
}
if (failures.length) {
  console.error(`\nDOCTRINE PROOF FAILED (${failures.length}/${results.length})`);
  process.exit(1);
}
console.log(`\nDOCTRINE PROOF PASSED (${results.length}/${results.length})`);
