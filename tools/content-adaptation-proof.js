#!/usr/bin/env node
'use strict';

/*
 * content-adaptation-proof.js — CO-005 Phase 5 proof.
 *
 * C5 scope (this file will grow as A6/A7/B7 land): the SMALL ISLAND FAIT ACCOMPLI
 * variant is authored, valid, selectable, and actually shapes the match — fast
 * lodgment clock, short turn budget, denial-weighted doctrine prior — without any
 * new top-level mode.
 *
 * UNCLASSIFIED // NOTIONAL RESEARCH TOOL
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const RedMind = require(path.join(ROOT, 'red-mind.js'));
const StrategicState = require(path.join(ROOT, 'strategic-state.js'));
const Forecasting = require(path.join(ROOT, 'forecasting.js'));

const VARIANT_FILE = 'scenarios/small-island-fait-accompli.json';
const scenario = JSON.parse(read(VARIANT_FILE));

const passed = [];
const failures = [];
function check(name, fn) {
  try { fn(); passed.push(name); }
  catch (e) { failures.push({ name, message: e.message }); }
}

// ---------- 1. Authored data contract ----------
check('variant carries classification, context, and matchConfig', () => {
  assert.ok(/UNCLASSIFIED \/\/ NOTIONAL/.test(scenario.metadata.classification), 'classification stamp');
  assert.ok(scenario.metadata.boundary, 'assumption boundary statement');
  for (const k of ['background', 'initiatingEvent', 'blueRole', 'redObjective']) {
    assert.ok(scenario.context && typeof scenario.context[k] === 'string' && scenario.context[k].length > 20, 'context.' + k);
  }
  assert.strictEqual(scenario.matchConfig.turnLimit, 6, 'turnLimit 6');
  assert.strictEqual(scenario.matchConfig.lodgmentRequiredTurns, 2, 'fast lodgment clock');
});

check('doctrine prior is a valid distribution over the disclosed types', () => {
  const prior = scenario.matchConfig.doctrinePrior;
  assert.deepStrictEqual(Object.keys(prior).sort(), Object.keys(RedMind.PRIOR).sort(), 'exact doctrine type keys');
  const sum = Object.values(prior).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, 'prior sums to 1 (got ' + sum + ')');
  assert.ok(prior.denial > prior.attrition && prior.denial > prior.decapitation,
    'fait accompli variant leans denial (lodgment-rush) doctrine');
});

// ---------- 2. Graph integrity ----------
check('graph is coherent: unique ids, resolvable links, both teams manned', () => {
  const ids = new Set();
  for (const n of scenario.nodes) {
    assert.ok(n.id && !ids.has(n.id), 'unique id ' + n.id);
    ids.add(n.id);
    assert.ok(n.team === 'red' || n.team === 'blue', n.id + ' has a team');
    assert.ok(Number.isFinite(Number(n.importance)), n.id + ' has importance');
  }
  const endId = e => (e && typeof e === 'object') ? e.id : e;
  for (const l of scenario.links) {
    assert.ok(ids.has(endId(l.source)) && ids.has(endId(l.target)),
      'link endpoints resolve: ' + endId(l.source) + '→' + endId(l.target));
  }
  const reds = scenario.nodes.filter(n => n.team === 'red').length;
  const blues = scenario.nodes.filter(n => n.team === 'blue').length;
  assert.ok(reds >= 18 && reds <= 40, 'compact red force (' + reds + ')');
  assert.ok(blues >= 18 && blues <= 40, 'compact blue force (' + blues + ')');
});

check('every red node carries a sanctioned geographyClass; lift subsystem is present', () => {
  const allowed = new Set(Object.keys(StrategicState.DEFAULT_CONFIG.escalation.horizontalWeights));
  for (const n of scenario.nodes.filter(n => n.team === 'red')) {
    assert.ok(allowed.has(n.geographyClass), n.id + ' geographyClass "' + n.geographyClass + '" sanctioned');
  }
  const lift = scenario.nodes.filter(n => n.team === 'red' && n.type === 'Assault');
  assert.ok(lift.length >= 4, 'amphibious lift/assault present (' + lift.length + ') — the throughput driver');
});

check('Kinmen garrison is emplaced on the objective with provenance notes', () => {
  const garrison = scenario.nodes.filter(n => /^SIA-BLU-K/.test(n.id));
  assert.ok(garrison.length >= 3, 'garrison nodes present');
  for (const g of garrison) {
    assert.ok(Math.abs(g.lat - 24.44) < 0.1 && Math.abs(g.lon - 118.32) < 0.1, g.id + ' located at Kinmen');
    assert.strictEqual(g.geographyClass, 'offshore-island', g.id + ' offshore-island class');
    assert.ok(/notional/i.test(g.notes || ''), g.id + ' carries an explicit assumption note');
  }
});

// ---------- 3. The variant actually shapes a headless match ----------
function loadGame(graph) {
  const context = {
    console: { log() {}, warn() {}, error() {} },
    window: {}, Math, Date, setTimeout, clearTimeout, WeakMap
  };
  context.window.window = context.window;
  context.window.AppState = { activeGraph: () => graph };
  vm.createContext(context);
  for (const f of ['moe.js', 'red-mind.js', 'strategic-state.js', 'game.js']) {
    vm.runInContext(read(f), context, { filename: f });
  }
  return context.window.GameModule;
}

check('headless match honors the authored matchConfig', () => {
  const graph = { nodes: JSON.parse(JSON.stringify(scenario.nodes)), links: JSON.parse(JSON.stringify(scenario.links)) };
  const game = loadGame(graph);
  game.init({});
  const mc = scenario.matchConfig;
  const state = game.newMatch({
    turnLimit: mc.turnLimit,
    lodgmentRequiredTurns: mc.lodgmentRequiredTurns,
    doctrinePrior: mc.doctrinePrior,
    strategic: mc.strategic,
    control: { blue: 'human', red: 'ai' },
    difficulty: { blue: 'hard', red: 'hard' },
    seed: 20400711
  });
  assert.strictEqual(state.cfg.turnLimit, 6, 'turn budget 6');
  assert.strictEqual(state.cfg.lodgmentRequiredTurns, 2, 'lodgment clock 2 full-throughput turns');
  assert.ok(state.objectiveIds.blue.length > 0 && state.objectiveIds.red.length > 0, 'objectives picked for both sides');
  const prior = state.redMind.prior;
  assert.ok(Math.abs(prior.denial - 0.6) < 1e-9, 'public prior reflects the authored denial lean');
  assert.ok(!Object.prototype.hasOwnProperty.call(state.redMind, 'doctrine'), 'true doctrine stays hidden in the variant too');
});

// ---------- 4. Director + loader wiring (static contract) ----------
check('director exposes the variant as BRIEF chips, not a new mode', () => {
  const director = read('director.js');
  assert.ok(director.includes('data-variant'), 'variant chips exist');
  assert.ok(director.includes('function selectVariant'), 'selectVariant implemented');
  assert.ok(director.includes('restoreBaseScenario();'), 'operation close restores the boot scenario');
  assert.ok(director.includes('op.variantConfig'), 'variant matchConfig flows into newBriefMatch');
  assert.ok(!/dir-launch-variant|new top-level/i.test(director), 'no new top-level launcher');
});

check('loader registers variants non-fatally', () => {
  const loader = read('inline-datasets.js');
  assert.ok(loader.includes('StrikeSimVariants'), 'variant registry');
  assert.ok(loader.includes('small-island-fait-accompli.json'), 'bundled variant fetch');
  assert.ok(/must never depend on a variant loading/.test(loader), 'non-fatal contract documented');
});

// ---------- 5. A6 — restricted-Nash player model (pure contracts) ----------
check('A6 cold start is inert and the blend is hard-capped at 0.5', () => {
  const empty = RedMind.emptyPlayerModel();
  assert.strictEqual(RedMind.modelConfidence(empty), 0, 'no model, no exploitation');
  assert.strictEqual(RedMind.modelConfidence(RedMind.mergePlayerModel(empty, { 'harden|command|harden': 2 }, 3)), 0,
    'below 3 observed turns stays inert');
  let m = empty;
  for (let i = 0; i < 500; i++) m = RedMind.mergePlayerModel(m, { 'harden|command|harden': 2 }, 2);
  assert.ok(RedMind.modelConfidence(m) <= 0.5 + 1e-12, 'cap holds at any sample size');
});

check('A6 merge is pure and migration resets unknown versions', () => {
  const base = RedMind.mergePlayerModel(RedMind.emptyPlayerModel(), { 'strike|lift|kinetic': 1 }, 1);
  const before = JSON.stringify(base);
  RedMind.mergePlayerModel(base, { 'strike|lift|kinetic': 5 }, 5);
  assert.strictEqual(JSON.stringify(base), before, 'merge never mutates its input');
  assert.strictEqual(RedMind.normalizePlayerModel({ version: 999, samples: 40, counts: {} }).samples, 0,
    'unknown version → fresh model');
  assert.strictEqual(RedMind.normalizePlayerModel(null).samples, 0, 'null → fresh model');
});

check('A6 exploit policy answers the observed habits', () => {
  let m = RedMind.emptyPlayerModel();
  for (let i = 0; i < 12; i++) m = RedMind.mergePlayerModel(m, { 'harden|command|harden': 2, 'strike|lift|kinetic': 1 }, 3);
  const base = RedMind.doctrine('denial');
  const tilted = RedMind.exploitPolicy(base, m);
  assert.ok(tilted.target.command < base.target.command, 'habitually defended class is de-prioritized');
  assert.ok(tilted.protect.lodgment > base.protect.lodgment, 'habitually hunted lift is shielded');
  assert.ok(/exploit/.test(tilted.id), 'exploit policy is labeled');
  const again = RedMind.exploitPolicy(base, m);
  assert.strictEqual(JSON.stringify(tilted), JSON.stringify(again), 'deterministic tilt');
});

check('A6 is wired into the engine behind the seeded gate and the human check', () => {
  const game = read('game.js');
  assert.ok(game.includes("hashSeed(match.seed, 'rnr-gate', match.turn)"), 'seeded RNR gate');
  assert.ok(game.includes("isHuman('blue')"), 'model observes/exploits only a human player');
  assert.ok(game.includes('normalizePlayerModel(cfgOverrides && cfgOverrides.playerModel)'), 'career model injected at newMatch');
  assert.ok(game.includes("tag: 'rnr-exploit'"), 'exploit replan has its own addressable stream');
});

// ---------- 6. A7 — exploitability meter (evidence gates) ----------
check('A7 habit claims are evidence-gated', () => {
  let thin = RedMind.mergePlayerModel(RedMind.emptyPlayerModel(), { 'harden|command|harden': 3 }, 3);
  thin = RedMind.mergePlayerModel(thin, { 'harden|command|harden': 3 }, 3);
  assert.strictEqual(RedMind.topHabit(thin), null, 'no claim below 5 observed turns');
  let strong = RedMind.emptyPlayerModel();
  for (let i = 0; i < 9; i++) strong = RedMind.mergePlayerModel(strong, { 'harden|command|harden': 2 }, 3);
  const habit = RedMind.topHabit(strong);
  assert.ok(habit && habit.cls === 'command' && /observed turns/.test(habit.text), 'supported claim renders with its evidence');
});

check('A7 exploit probe exists end-to-end (module, worker, director)', () => {
  assert.ok(read('counterfactual.js').includes('function runExploitPair'), 'counterfactual exploit pair');
  assert.ok(read('counterfactual-worker.js').includes("probe === 'exploit-player-model'"), 'worker probe branch');
  const director = read('director.js');
  assert.ok(director.includes('PREDICTABILITY — WHAT AN ADAPTIVE RED SEES'), 'AAR predictability card');
  assert.ok(director.includes("act === 'run-exploit-probe'"), 'probe action wired');
  assert.ok(director.includes('modelConfidence(model) > 0'), 'probe disabled below the evidence gate');
});

// ---------- 7. B7 — precision audit, updating style, outside view ----------
check('B7 precision audit math matches the rounding experiment', () => {
  const audit = Forecasting.precisionAudit([{ f: 0.63, o: 1 }, { f: 0.63, o: 1 }], 0.10);
  // 0.63 → Brier 0.1369; rounded to 0.60 → 0.16; delta must be +0.0231 per entry.
  assert.ok(Math.abs(audit.delta - 0.0231) < 1e-9, 'delta ' + audit.delta);
  assert.strictEqual(audit.n, 2, 'counts only resolved binary entries');
});

check('B7 updating style and outside view are gated below evidence thresholds', () => {
  assert.strictEqual(Forecasting.classifyUpdateStyle([{ fBlind: 0.5, fFinal: 0.6, o: 1 }]), null, 'style gated');
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push({ fBlind: 0.5, fFinal: 0.58, o: 1 });
  assert.strictEqual(Forecasting.classifyUpdateStyle(rows).label, 'Increments', 'superforecaster signature detected');
  assert.strictEqual(Forecasting.outsideViewStats([{ archetype: 'strike:lift:kinetic', halted: true }], 'strike:lift:kinetic'), null,
    'outside view needs 3+ operations');
  const ops = [1, 2, 3].map(() => ({ archetype: 'strike:lift:kinetic', halted: true, throughputEnd: 0.2 }));
  assert.strictEqual(Forecasting.outsideViewStats(ops, 'strike:lift:kinetic').haltRate, 1, 'base rate computed');
});

check('B7 outside view renders BEFORE the house line and the calibration card gains the audit', () => {
  const director = read('director.js');
  const blindIdx = director.indexOf('COMMIT CARD · BLIND');
  const outsideIdx = director.indexOf('outsideViewHtml(st) +');
  const callsIdx = director.indexOf('THREE RESOLVABLE CALLS');
  assert.ok(blindIdx > 0 && outsideIdx > blindIdx && callsIdx > outsideIdx,
    'outside view sits inside the BLIND card, before elicitation and any house reveal');
  assert.ok(director.includes('precisionStyleHtml(entries)'), 'calibration card carries the precision/style audit');
  assert.ok(director.includes('The house line arrives only after your blind call'), 'ordering contract stated to the player');
});

// ---------- report ----------
console.log('UNCLASSIFIED // NOTIONAL RESEARCH TOOL');
if (failures.length) {
  console.log('Content adaptation proof: IMPLEMENTATION MISMATCH (' + failures.length + '/' + (passed.length + failures.length) + ' checks failed)');
  failures.forEach(f => console.log('  FAIL  ' + f.name + '\n        ' + f.message));
  passed.forEach(p => console.log('  PASS  ' + p));
  process.exit(1);
}
console.log('Content adaptation proof: ALL CONTRACTS HOLD (' + passed.length + ' checks)');
passed.forEach(p => console.log('  PASS  ' + p));
