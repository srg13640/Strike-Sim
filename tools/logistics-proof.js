#!/usr/bin/env node
'use strict';

/* Deterministic integration proof for the contested-logistics adapter.
 * UNCLASSIFIED // NOTIONAL RESEARCH TOOL */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
function assert(ok, message) { if (!ok) throw new Error(message); }

function graph() {
  const red = read('grok150red.json');
  const blue = read('grokblue90.json');
  return { nodes: clone(red.nodes).concat(clone(blue.nodes)), links: clone(red.links).concat(clone(blue.links)) };
}

function runtime(activeGraph) {
  const context = { console, window: {}, Math, Date, setTimeout, clearTimeout };
  context.window.window = context.window;
  context.window.AppState = { activeGraph: () => activeGraph };
  vm.createContext(context);
  for (const file of ['moe.js', 'red-mind.js', 'strategic-state.js', 'logistics.js', 'game.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  }
  return { game: context.window.GameModule, logistics: context.window.LogisticsModule };
}

function firstStrike(game, side, method) {
  const enemy = side === 'blue' ? 'red' : 'blue';
  const board = game._internal.buildBoard(graph());
  for (const id of board.rosters[enemy]) {
    const available = game._internal.canStrikeBoard(board, side, id, method);
    if (available.ok) return { side, kind: 'strike', targetId: id, methodKey: method, sourceId: available.sourceId };
  }
  throw new Error('no ' + method + ' strike available for ' + side);
}

function deterministicOperation(seed) {
  const active = graph();
  const { game } = runtime(active);
  game.init({});
  game.newMatch({ seed, turnLimit: 3, control: { blue: 'human', red: 'human' },
    difficulty: { blue: 'hard', red: 'hard' }, fog: false });
  assert(game.setLogisticsDecision('blue', 'surge'), 'surge decision rejected');
  const template = firstStrike(game, 'blue', 'kinetic');
  let queued = 0;
  while (queued < 4 && game.queueOrder('blue', template)) queued++;
  assert(queued >= 3, 'could not queue enough kinetic demand to exercise ammunition stock');
  game.commitTurn();
  return game.serialize();
}

function modelEffects(game, L, active) {
  const board = game._internal.buildBoard(active);
  const resources = L.resources();
  const base = L.create(board, {});
  for (const side of ['blue', 'red']) {
    assert(resources.every(key => typeof base.sides[side].stocks[key] === 'number'), side + ' typed stocks missing');
    const modes = base.sides[side].routes.map(route => route.mode);
    assert(['sea', 'air', 'land', 'digital'].every(mode => modes.includes(mode)), side + ' route modes incomplete: ' + modes.join(','));
    assert(base.sides[side].hubs.some(h => h.kind === 'port'), side + ' port hub missing');
    assert(base.sides[side].hubs.some(h => h.kind === 'airfield'), side + ' airfield hub missing');
  }

  const repairTarget = board.rosters.blue.map(id => board.nodes[id]).find(node => node && node.alive);
  const order = { side: 'blue', kind: 'repair', targetId: repairTarget.id };
  const high = L.create(board, { stocks: { blue: { fuel: 100, ammunition: 100, maintenance: 100, personnel: 100 } } });
  const low = L.create(board, { stocks: { blue: { fuel: 100, ammunition: 100, maintenance: 12, personnel: 12 } } });
  L.setDecision(high, 'blue', 'repair'); L.setDecision(low, 'blue', 'repair');
  const highEffect = L.prepareTurn(high, board, [order]).effects[0];
  const lowEffect = L.prepareTurn(low, board, [order]).effects[0];
  assert(highEffect.repairMult > lowEffect.repairMult, 'maintenance/personnel do not bound repair effectiveness');

  const damagedBoard = game._internal.cloneBoardForAi ? game._internal.cloneBoardForAi(board) : game._internal.buildBoard(active);
  base.sides.blue.hubs.forEach(hub => {
    damagedBoard.nodes[hub.id].health = 0; damagedBoard.nodes[hub.id].alive = false;
  });
  const balanced = L.create(damagedBoard, {}), rerouted = L.create(damagedBoard, {});
  L.setDecision(balanced, 'blue', 'balanced'); L.setDecision(rerouted, 'blue', 'reroute');
  L.resolveTurn(balanced, damagedBoard, [], [], L.prepareTurn(balanced, damagedBoard, []));
  L.resolveTurn(rerouted, damagedBoard, [], [], L.prepareTurn(rerouted, damagedBoard, []));
  const bCapacity = balanced.sides.blue.routes.reduce((sum, route) => sum + route.effectiveCapacity, 0);
  const rCapacity = rerouted.sides.blue.routes.reduce((sum, route) => sum + route.effectiveCapacity, 0);
  assert(rCapacity > bCapacity && rerouted.sides.blue.totals.reroutes > 0,
    'rerouting did not recover capacity around a disrupted port/airfield');

  const ddilBoard = game._internal.buildBoard(active);
  const command = ddilBoard.rosters.blue.map(id => ddilBoard.nodes[id]).find(node =>
    node && (node.tempoRole === 'command' || node.tempoRole === 'relay'));
  assert(command, 'no Blue command/relay node available for DDIL proof');
  command.health = 0; command.alive = false;
  const event = [{ side: 'red', kind: 'kill', targetId: command.id, method: 'cyber', damage: 100 }];
  const exposed = L.create(ddilBoard, {}), resilient = L.create(ddilBoard, {});
  L.setDecision(exposed, 'blue', 'balanced'); L.setDecision(resilient, 'blue', 'ddil');
  L.resolveTurn(exposed, ddilBoard, [], event, L.prepareTurn(exposed, ddilBoard, []));
  L.resolveTurn(resilient, ddilBoard, [], event, L.prepareTurn(resilient, ddilBoard, []));
  assert(exposed.sides.blue.ddil > 0 && resilient.sides.blue.ddil < exposed.sides.blue.ddil,
    'DDIL allocation did not mitigate command/network disruption');

  const isolatedBoard = game._internal.buildBoard(active);
  base.sides.blue.logisticsIds.forEach(id => { isolatedBoard.nodes[id].health = 0; isolatedBoard.nodes[id].alive = false; });
  const buffered = L.create(isolatedBoard, { prepositioning: { blue: 80 } });
  const before = buffered.sides.blue.prepositioning;
  L.resolveTurn(buffered, isolatedBoard, [], [], L.prepareTurn(buffered, isolatedBoard, []));
  assert(buffered.sides.blue.prepositioning < before, 'prepositioned buffer was not consumed under route disruption');
}

function fullMatchAar() {
  const active = graph();
  const { game } = runtime(active);
  game.init({});
  let state = game.newMatch({ seed: 99173, turnLimit: 8, control: { blue: 'ai', red: 'ai' },
    difficulty: { blue: 'hard', red: 'hard' }, fog: false });
  while (state.phase !== 'over') {
    state = game.commitTurn();
    if (state.phase === 'resolved') state = game.nextTurn();
  }
  assert(state.aar && state.aar.logistics && state.aar.logistics.sides.blue, 'AAR logistics summary missing');
  assert(Object.keys(state.aar.logistics.sides.blue.decisions).length > 0, 'AAR allocation history missing');
  assert(state.aar.logistics.sides.blue.routes.length >= 4, 'AAR route state missing');
}

function main() {
  const active = graph();
  const { game, logistics: L } = runtime(active);
  game.init({});
  modelEffects(game, L, active);

  const a = deterministicOperation(73109), b = deterministicOperation(73109);
  assert(JSON.stringify(a.history) === JSON.stringify(b.history), 'same-seed logistics operation is not deterministic');
  assert(a.history[0].logistics.decisions.blue.id === 'surge', 'turn allocation was not serialized');
  const turn = a.history[0].report.logistics.sides.blue;
  assert(turn.stocksAfter.ammunition < turn.stocksBefore.ammunition, 'kinetic demand did not reduce ammunition stock');
  assert(a.logistics && a.logisticsInitial && a.v === 7, 'save lacks logistics state or initial replay anchor');

  const restoreGraph = graph();
  const restoredRuntime = runtime(restoreGraph);
  restoredRuntime.game.init({});
  const restored = restoredRuntime.game.deserialize(a, { force: true });
  assert(restored && restored.ok !== false, 'v7 logistics save failed to deserialize');
  assert(JSON.stringify(restoredRuntime.game.serialize().logistics) === JSON.stringify(a.logistics),
    'logistics state changed across save/deserialize');

  fullMatchAar();
  console.log('logistics proof passed: typed stocks, hubs/routes, DDIL, prepositioning, reroute, repair, allocation, replay, and AAR');
}

try { main(); } catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
