#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_API = [
  'init',
  'newMatch',
  'getState',
  'queueOrder',
  'removeOrder',
  'clearOrders',
  'commitTurn',
  'nextTurn',
  'endMatch',
  'isActive',
  'isHuman',
  'boardNode',
  'methods',
  'methodKeys',
  'canStrike',
  'validOrder',
  'serialize',
  'deserialize',
  'fingerprint',
  'fingerprintMatches',
  'scenarioStatus',
  '_internal'
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function combinedGraph() {
  const red = readJson('grok150red.json');
  const blue = readJson('grokblue90.json');
  return {
    nodes: clone(red.nodes || []).concat(clone(blue.nodes || [])),
    links: clone(red.links || []).concat(clone(blue.links || []))
  };
}

function loadGame(graph) {
  const errors = [];
  const context = {
    console: {
      log() {},
      warn() {},
      error(...args) { errors.push(args.join(' ')); }
    },
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
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8'), context, { filename: 'game.js' });
  if (errors.length) throw new Error(errors.join('\n'));
  return context.window.GameModule;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const red = readJson('grok150red.json');
  const blue = readJson('grokblue90.json');
  assert(Array.isArray(red.nodes) && red.nodes.length > 0, 'red scenario has no nodes');
  assert(Array.isArray(blue.nodes) && blue.nodes.length > 0, 'blue scenario has no nodes');

  const graph = combinedGraph();
  const game = loadGame(graph);
  const api = Object.keys(game).sort();
  assert(JSON.stringify(api) === JSON.stringify(EXPECTED_API.slice().sort()), 'GameModule public API changed: ' + api.join(','));

  game.init({});
  let state = game.newMatch({
    control: { blue: 'ai', red: 'ai' },
    difficulty: { blue: 'hard', red: 'hard' },
    fog: false,
    turnLimit: 10,
    seed: 42
  });
  assert(state && state.rosters.blue > 0 && state.rosters.red > 0, 'wargame did not build both rosters');
  state = game.commitTurn();
  assert(state && (state.phase === 'resolved' || state.phase === 'over'), 'commitTurn did not resolve');
  assert(game.serialize() && game.serialize().orders, 'serialize did not include orders');

  game.endMatch();
  assert(game.isActive() === false, 'endMatch left match active');

  const campaignCfg = {
    control: { blue: 'human', red: 'ai' },
    difficulty: { blue: 'hard', red: 'hard' },
    fog: true,
    turnLimit: 9,
    apBlue: 5,
    apRed: 5,
    seed: 1234
  };
  state = game.newMatch(campaignCfg);
  assert(state && state.cfg.fog === true && state.ap.blue === 5, 'campaign handoff config did not apply');

  const wargameUi = fs.readFileSync(path.join(ROOT, 'wargame.js'), 'utf8');
  assert(wargameUi.includes('id="wg-launch"') || wargameUi.includes("id='wg-launch'") || wargameUi.includes('#wg-launch'), 'wargame launch button missing from UI module');

  // Balance is part of the gate, not an adjacent advisory. The default 200-seed run
  // uses the player-facing eight-turn horizon and the real MoeModule denial arbiter.
  // Developers may set STRIKESIM_GATE_SKIP_BALANCE=1 for a fast API-only smoke test;
  // release evidence must run this script without that override.
  if (process.env.STRIKESIM_GATE_SKIP_BALANCE !== '1') {
    const matches = Number(process.env.STRIKESIM_GATE_MATCHES || 200);
    const output = execFileSync(process.execPath, [
      path.join(ROOT, 'tools', 'wargame-loop-eval.js'),
      '--matches', String(matches), '--turns', '8'
    ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const lines = output.trim().split(/\r?\n/);
    const evaluation = JSON.parse(lines[lines.length - 1]);
    assert(evaluation.balance_pass === true,
      `hard/hard balance outside 0.45–0.55: ${evaluation.blue_win_rate}`);
    assert(evaluation.max_reasoning_rollouts <= 50,
      `bounded reasoning exceeded 50 rollouts: ${evaluation.max_reasoning_rollouts}`);
    assert(Object.values(evaluation.perturbations || {}).every(Boolean),
      `one or more behavior perturbations failed: ${JSON.stringify(evaluation.perturbations)}`);
    assert(evaluation.turn_limit === 8, 'balance gate did not use the live eight-turn horizon');
    console.log(`balance gate passed (${evaluation.matches} seeds; Blue ${Math.round(evaluation.blue_win_rate * 100)}%; max ${evaluation.max_reasoning_rollouts} rollouts)`);
  }

  console.log('wargame-loop gate passed');
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
}
