#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);

function arg(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : fallback;
}

const MATCHES = Number(arg('--matches', 200));
const DIAGNOSTIC_MATCHES = Number(arg('--diagnostic-matches', Math.min(12, MATCHES)));
const SEED_BASE = Number(arg('--seed-base', 42));
const TURNS = Number(arg('--turns', 8));

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function combinedGraph(mutator) {
  const red = readJson('grok150red.json');
  const blue = readJson('grokblue90.json');
  const graph = {
    nodes: clone(red.nodes || []).concat(clone(blue.nodes || [])),
    links: clone(red.links || []).concat(clone(blue.links || []))
  };
  if (mutator) mutator(graph);
  return graph;
}

function loadGame(graph) {
  const context = {
    console,
    window: {},
    Math,
    Date,
    setTimeout,
    clearTimeout
  };
  context.window.window = context.window;
  context.window.AppState = { activeGraph: () => graph };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'moe.js'), 'utf8'), context, { filename: 'moe.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'red-mind.js'), 'utf8'), context, { filename: 'red-mind.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'strategic-state.js'), 'utf8'), context, { filename: 'strategic-state.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'logistics.js'), 'utf8'), context, { filename: 'logistics.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8'), context, { filename: 'game.js' });
  if (!context.window.MoeModule || typeof context.window.MoeModule.assessGraph !== 'function') {
    throw new Error('balance harness requires MoeModule; legacy attrition fallback is not a valid gate');
  }
  return context.window.GameModule;
}

function methodCounter() {
  return { kinetic: 0, cyber: 0, ew: 0, sof: 0, firepower: 0, strike: 0 };
}

function sourceSubsystem(game, order) {
  const src = order && order.sourceId ? game.boardNode(order.sourceId) : null;
  return src ? String(src.subsystem || '') : '';
}

function runOne(seed, mutator) {
  const graph = combinedGraph(mutator);
  const game = loadGame(graph);
  game.init({});
  let state = game.newMatch({
    control: { blue: 'ai', red: 'ai' },
    difficulty: { blue: 'hard', red: 'hard' },
    fog: false,
    turnLimit: TURNS,
    seed
  });

  const bySide = { blue: methodCounter(), red: methodCounter() };
  let turnsResolved = 0;
  while (state && state.phase !== 'over' && turnsResolved < TURNS) {
    state = game.commitTurn();
    const snapshot = game.serialize();
    for (const side of ['blue', 'red']) {
      for (const order of (snapshot.orders && snapshot.orders[side]) || []) {
        if (order.kind !== 'strike') continue;
        bySide[side].strike += 1;
        if (bySide[side][order.methodKey] != null) bySide[side][order.methodKey] += 1;
        const sub = sourceSubsystem(game, order);
        if (!order.sourceId || sub === 'Firepower Strike') bySide[side].firepower += 1;
      }
    }
    turnsResolved += 1;
    state = game.getState();
    if (state.phase === 'resolved') state = game.nextTurn();
  }
  state = game.getState();
  const saved = game.serialize();
  const reasoning = (saved && saved.redMind && saved.redMind.reasoningHistory) || [];
  return {
    winner: state && state.winner,
    reason: state && state.result && state.result.reason,
    doctrine: state && state.redMind && state.redMind.revealedDoctrine,
    turns: turnsResolved,
    bySide,
    rollouts: reasoning.reduce((sum, row) => sum + Number(row.rollouts || 0), 0),
    maxRollouts: reasoning.reduce((max, row) => Math.max(max, Number(row.rollouts || 0)), 0)
  };
}

function runSeries(matches, mutator) {
  const total = {
    blueWins: 0, redWins: 0, draws: 0,
    turns: 0,
    rollouts: 0,
    maxRollouts: 0,
    reasons: {},
    doctrines: {
      attrition: { matches: 0, blueWins: 0 },
      decapitation: { matches: 0, blueWins: 0 },
      denial: { matches: 0, blueWins: 0 }
    },
    bySide: { blue: methodCounter(), red: methodCounter() }
  };
  for (let i = 0; i < matches; i++) {
    const result = runOne(SEED_BASE + i, mutator);
    if (result.winner === 'blue') total.blueWins += 1;
    else if (result.winner === 'red') total.redWins += 1;
    else total.draws += 1;
    total.reasons[result.reason || 'unknown'] = (total.reasons[result.reason || 'unknown'] || 0) + 1;
    if (total.doctrines[result.doctrine]) {
      total.doctrines[result.doctrine].matches += 1;
      if (result.winner === 'blue') total.doctrines[result.doctrine].blueWins += 1;
    }
    total.turns += result.turns;
    total.rollouts += result.rollouts;
    total.maxRollouts = Math.max(total.maxRollouts, result.maxRollouts);
    for (const side of ['blue', 'red']) {
      for (const key of Object.keys(total.bySide[side])) {
        total.bySide[side][key] += result.bySide[side][key];
      }
    }
  }
  const denom = Math.max(1, matches);
  return {
    blue_win_rate: total.blueWins / denom,
    outcomes: { blue: total.blueWins, red: total.redWins, draw: total.draws },
    reasons: total.reasons,
    doctrine: Object.fromEntries(Object.entries(total.doctrines).map(([id, row]) => [id, {
      matches: row.matches,
      blue_win_rate: row.matches ? row.blueWins / row.matches : null
    }])),
    avg_turns: total.turns / denom,
    avg_reasoning_rollouts: total.rollouts / denom,
    max_reasoning_rollouts: total.maxRollouts,
    avg_per_turn: {
      blue: normalizeCounts(total.bySide.blue, total.turns),
      red: normalizeCounts(total.bySide.red, total.turns)
    }
  };
}

function normalizeCounts(counts, turns) {
  const denom = Math.max(1, turns);
  const out = {};
  for (const key of Object.keys(counts)) out[key] = counts[key] / denom;
  return out;
}

function resource(node, key) {
  return Number((node.resourceGenByType && node.resourceGenByType[key]) || 0);
}

function topBlueCascadeNodes(graph) {
  return graph.nodes
    .filter(n => n.team === 'blue')
    .sort((a, b) => ((b.cascScore || 1) * (b.importance || 5)) - ((a.cascScore || 1) * (a.importance || 5)))
    .slice(0, 5)
    .map(n => n.id);
}

function cascadeDamage(mutator) {
  const graph = combinedGraph(mutator);
  const ids = topBlueCascadeNodes(graph);
  const game = loadGame(graph);
  const board = game._internal.buildBoard(graph);
  const rng = { next: () => 0, range: (a, b) => a, int: (a) => a, pick: arr => arr[0] };
  let damage = 0;
  for (const id of ids) {
    const localBoard = clone(board);
    if (!localBoard.nodes[id]) continue;
    localBoard.nodes[id].health = 1;
    const before = {};
    for (const nid of localBoard.adj[id] || []) {
      const n = localBoard.nodes[nid];
      if (n) before[nid] = n.health;
    }
    game._internal.resolveTurn(localBoard, [{ side: 'red', kind: 'strike', methodKey: 'kinetic', targetId: id }], { repairAmount: 30 }, rng);
    for (const nid of Object.keys(before)) {
      damage += Math.max(0, before[nid] - localBoard.nodes[nid].health);
    }
  }
  return damage / Math.max(1, ids.length);
}

const started = process.hrtime.bigint();
const baseline = runSeries(MATCHES);

const p1 = runSeries(DIAGNOSTIC_MATCHES, graph => {
  graph.nodes.filter(n => n.team === 'blue').forEach(n => {
    n.resourceGenByType = Object.assign({}, n.resourceGenByType, {
      kinetic: 0
    });
  });
});

const p2 = runSeries(DIAGNOSTIC_MATCHES, graph => {
  graph.nodes.filter(n => n.team === 'red').forEach(n => {
    n.resourceGenByType = Object.assign({}, n.resourceGenByType, { kinetic: 0 });
  });
});

const p3 = runSeries(DIAGNOSTIC_MATCHES, graph => {
  graph.nodes.filter(n => n.team === 'red').forEach(n => { n.subsystem = 'Logistics'; });
});

const baseCascade = cascadeDamage();
const boostedCascade = cascadeDamage(graph => {
  const top = new Set(topBlueCascadeNodes(graph));
  graph.nodes.filter(n => top.has(n.id)).forEach(n => {
    n.importance = Number(n.importance || 5) * 2;
  });
});

const perturbations = {
  '1': baseline.avg_per_turn.blue.kinetic > 0 && p1.avg_per_turn.blue.kinetic <= baseline.avg_per_turn.blue.kinetic * 0.2,
  '2': p2.avg_per_turn.red.kinetic <= baseline.avg_per_turn.red.kinetic * 0.2,
  '3': p3.avg_per_turn.red.firepower <= baseline.avg_per_turn.red.firepower * 0.2,
  '4': baseCascade > 0 && boostedCascade >= baseCascade * 1.3
};

const failedPerturbations = Object.values(perturbations).filter(v => !v).length;
const balanceDistance = baseline.blue_win_rate < 0.45 ? 0.45 - baseline.blue_win_rate
  : baseline.blue_win_rate > 0.55 ? baseline.blue_win_rate - 0.55 : 0;
const balancePass = balanceDistance === 0;
const penalty =
  failedPerturbations * 25 +
  balanceDistance * 100 +
  Math.max(0, 6 - baseline.avg_turns) * 5;
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

console.log(JSON.stringify({
  penalty: Math.round(penalty * 1000) / 1000,
  balance_pass: balancePass,
  matches: MATCHES,
  diagnostic_matches: DIAGNOSTIC_MATCHES,
  turn_limit: TURNS,
  blue_win_rate: Math.round(baseline.blue_win_rate * 1000) / 1000,
  avg_turns: Math.round(baseline.avg_turns * 1000) / 1000,
  outcomes: baseline.outcomes,
  reasons: baseline.reasons,
  doctrine: baseline.doctrine,
  avg_reasoning_rollouts: Math.round(baseline.avg_reasoning_rollouts * 10) / 10,
  max_reasoning_rollouts: baseline.max_reasoning_rollouts,
  elapsed_ms: Math.round(elapsedMs),
  perturbations,
  diagnostics: {
    baseline: baseline.avg_per_turn,
    blue_kinetic_removed_ratio: ratio(p1.avg_per_turn.blue.kinetic, baseline.avg_per_turn.blue.kinetic),
    red_kinetic_ratio: ratio(p2.avg_per_turn.red.kinetic, baseline.avg_per_turn.red.kinetic),
    red_firepower_ratio: ratio(p3.avg_per_turn.red.firepower, baseline.avg_per_turn.red.firepower),
    cascade_ratio: ratio(boostedCascade, baseCascade)
  }
}));

function ratio(a, b) {
  if (!b) return a ? Infinity : 1;
  return Math.round((a / b) * 1000) / 1000;
}
