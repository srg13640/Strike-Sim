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

const MATCHES = Number(arg('--matches', 100));
const SEED_BASE = Number(arg('--seed-base', 42));
const TURNS = 10;

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
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8'), context, { filename: 'game.js' });
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
  return {
    winner: state && state.winner,
    turns: turnsResolved,
    bySide
  };
}

function runSeries(matches, mutator) {
  const total = {
    blueWins: 0,
    turns: 0,
    bySide: { blue: methodCounter(), red: methodCounter() }
  };
  for (let i = 0; i < matches; i++) {
    const result = runOne(SEED_BASE + i, mutator);
    if (result.winner === 'blue') total.blueWins += 1;
    total.turns += result.turns;
    for (const side of ['blue', 'red']) {
      for (const key of Object.keys(total.bySide[side])) {
        total.bySide[side][key] += result.bySide[side][key];
      }
    }
  }
  const denom = Math.max(1, matches);
  return {
    blue_win_rate: total.blueWins / denom,
    avg_turns: total.turns / denom,
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

const baseline = runSeries(MATCHES);

const p1 = runSeries(MATCHES, graph => {
  graph.nodes.filter(n => n.team === 'blue').forEach(n => {
    n.resourceGenByType = Object.assign({}, n.resourceGenByType, {
      kinetic: resource(n, 'kinetic') * 2
    });
  });
});

const p2 = runSeries(MATCHES, graph => {
  graph.nodes.filter(n => n.team === 'red').forEach(n => {
    n.resourceGenByType = Object.assign({}, n.resourceGenByType, { kinetic: 0 });
  });
});

const p3 = runSeries(MATCHES, graph => {
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
  '1': baseline.avg_per_turn.blue.kinetic > 0 && p1.avg_per_turn.blue.kinetic >= baseline.avg_per_turn.blue.kinetic * 1.8,
  '2': p2.avg_per_turn.red.kinetic <= baseline.avg_per_turn.red.kinetic * 0.2,
  '3': p3.avg_per_turn.red.firepower <= baseline.avg_per_turn.red.firepower * 0.2,
  '4': baseCascade > 0 && boostedCascade >= baseCascade * 1.3
};

const failedPerturbations = Object.values(perturbations).filter(v => !v).length;
const penalty =
  failedPerturbations * 25 +
  Math.max(0, Math.abs(baseline.blue_win_rate - 0.45) - 0.10) * 100 +
  Math.max(0, 6 - baseline.avg_turns) * 5;

console.log(JSON.stringify({
  penalty: Math.round(penalty * 1000) / 1000,
  blue_win_rate: Math.round(baseline.blue_win_rate * 1000) / 1000,
  avg_turns: Math.round(baseline.avg_turns * 1000) / 1000,
  perturbations,
  diagnostics: {
    baseline: baseline.avg_per_turn,
    blue_kinetic_ratio: ratio(p1.avg_per_turn.blue.kinetic, baseline.avg_per_turn.blue.kinetic),
    red_kinetic_ratio: ratio(p2.avg_per_turn.red.kinetic, baseline.avg_per_turn.red.kinetic),
    red_firepower_ratio: ratio(p3.avg_per_turn.red.firepower, baseline.avg_per_turn.red.firepower),
    cascade_ratio: ratio(boostedCascade, baseCascade)
  }
}));

function ratio(a, b) {
  if (!b) return a ? Infinity : 1;
  return Math.round((a / b) * 1000) / 1000;
}
