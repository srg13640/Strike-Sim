/*
 * tempo-test.js — verify the command-tempo economy in game.js.
 * Checks: (1) determinism, (2) AP starts at base and degrades as C2/logistics die,
 * (3) explicit AP override disables the economy, (4) ai/ai balance stays reasonable,
 * (5) killing a side's command network measurably cuts its action points.
 * Pure Node (vm sandbox like the loop harness). Run: node tools/tempo-test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

function readJson(f) { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function combinedGraph() {
  const red = readJson('grok150red.json'), blue = readJson('grokblue90.json');
  return { nodes: clone(red.nodes || []).concat(clone(blue.nodes || [])), links: clone(red.links || []).concat(clone(blue.links || [])) };
}
function loadGame(graph) {
  const ctx = { console, window: {}, Math, Date, setTimeout, clearTimeout };
  ctx.window.window = ctx.window;
  ctx.window.AppState = { activeGraph: () => graph };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'moe.js'), 'utf8'), ctx, { filename: 'moe.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'red-mind.js'), 'utf8'), ctx, { filename: 'red-mind.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8'), ctx, { filename: 'game.js' });
  return ctx.window.GameModule;
}
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('FAIL:', m); } else console.log('  ok:', m); };

// playOut: run a full ai/ai match, return winner + AP trace per side.
function playOut(seed, cfg) {
  const game = loadGame(combinedGraph());
  game.init({});
  let st = game.newMatch(Object.assign({ control: { blue: 'ai', red: 'ai' }, difficulty: { blue: 'hard', red: 'hard' }, fog: false, turnLimit: 10, seed }, cfg || {}));
  const apTrace = { blue: [], red: [] };
  let guard = 0;
  while (st && st.phase !== 'over' && guard++ < 30) {
    apTrace.blue.push(st.ap.blue); apTrace.red.push(st.ap.red);
    st = game.commitTurn();
    st = game.getState();
    if (st.phase === 'resolved') st = game.nextTurn();
  }
  st = game.getState();
  return { winner: st.winner, apTrace, finalTempo: st.tempo };
}

console.log('\n[1] Determinism: same seed -> identical winner + AP trace');
const a = playOut(42), b = playOut(42);
ok(a.winner === b.winner && JSON.stringify(a.apTrace) === JSON.stringify(b.apTrace), 'seed 42 reproduces exactly');

console.log('\n[2] AP starts at base, can degrade over the match');
const startAp = a.apTrace.blue[0], minAp = Math.min(...a.apTrace.blue);
ok(startAp >= 3 && startAp <= 6, 'blue starts at base AP (' + startAp + ')');
ok(minAp >= 2, 'AP never drops below floor of 2 (min ' + minAp + ')');

console.log('\n[3] Explicit AP sets the dynamic base; sandbox explicitly fixes it');
const game = loadGame(combinedGraph());
game.init({});
let s = game.newMatch({ control: { blue: 'human', red: 'ai' }, apBlue: 5, apRed: 5, fog: true, turnLimit: 9, seed: 1234 });
ok(s.ap.blue === 5 && s.tempo.blue.dynamic === true, 'apBlue=5 sets the base and preserves the tempo economy');
s = game.newMatch({ control: { blue: 'human', red: 'ai' }, apBlue: 5, apRed: 5, sandbox: true, fog: true, turnLimit: 9, seed: 1234 });
ok(s.ap.blue === 5 && s.tempo.blue.dynamic === false, 'sandbox apBlue=5 is fixed and disables the economy');

console.log('\n[4] Decapitation cuts tempo: destroy a side\'s command+logistics -> AP floor');
// Build a board, kill all blue command/logistics, confirm blue AP collapses vs intact.
function apAfterKilling(killRoles) {
  const g = loadGame(combinedGraph());
  g.init({});
  g.newMatch({ control: { blue: 'ai', red: 'ai' }, turnLimit: 10, seed: 7 });
  // reach into internals: simulate loss by zeroing health on blue tempo nodes via board
  const board = g._internal.buildBoard(combinedGraph());
  // Use a fresh match then mutate through serialize/deserialize is complex; instead compare
  // commandTempo via internal on a board we mutate directly:
  return board;
}
// Direct internal check of the tempo function's monotonicity.
{
  const g = loadGame(combinedGraph());
  const board = g._internal.buildBoard(combinedGraph());
  const objBlueRosters = board.rosters.blue;
  const tempoFull = g._internal.objectiveValue ? null : null; // commandTempo not exported; test via getState path instead
}
// Functional decapitation test through the public API: a match where we compare blue AP
// at full strength vs after we manually neutralize blue command nodes in the graph.
function bluapWithBlueC2(fraction) {
  const graph = combinedGraph();
  // Neutralize (1-fraction) of blue command+logistics nodes up front.
  const tempoNodes = graph.nodes.filter(n => n.team === 'blue' && /command|logist|support|sustain|relay|comm/i.test((n.type || '') + (n.subsystem || '')));
  const killCount = Math.round(tempoNodes.length * (1 - fraction));
  tempoNodes.slice(0, killCount).forEach(n => { n.status = 'Neutralized'; n.health = 0; });
  const g = loadGame(graph);
  g.init({});
  // freshStart:false so our pre-neutralized state is respected
  const st = g.newMatch({ control: { blue: 'ai', red: 'ai' }, turnLimit: 10, seed: 7, freshStart: false });
  return st.ap.blue;
}
const apIntact = bluapWithBlueC2(1.0);
const apDecapitated = bluapWithBlueC2(0.0);
console.log('  blue AP intact:', apIntact, '| blue AP with C2/logi destroyed:', apDecapitated);
ok(apDecapitated < apIntact, 'destroying blue C2/logistics reduces blue AP (' + apIntact + ' -> ' + apDecapitated + ')');
ok(apDecapitated >= 2, 'decapitated AP respects floor');

console.log('\n[5] Balance: ai/ai win rate across 60 seeds stays competitive (not a blowout)');
let blueWins = 0, N = 60;
for (let i = 0; i < N; i++) { if (playOut(100 + i).winner === 'blue') blueWins++; }
const rate = blueWins / N;
console.log('  blue win rate:', rate.toFixed(2), '(' + blueWins + '/' + N + ')');
ok(rate >= 0.3 && rate <= 0.7, 'win rate within 0.30–0.70 (competitive)');

console.log('\n[6] Objectives: exposed in state, and losing key objectives ends the match');
{
  const g = loadGame(combinedGraph());
  g.init({});
  const st0 = g.newMatch({ control: { blue: 'ai', red: 'ai' }, turnLimit: 10, seed: 5 });
  ok(st0.objectives && st0.objectives.blue.total === 8 && st0.objectives.red.total === 8, 'each side has 8 key objectives');
  ok(Array.isArray(st0.objectiveIds.blue) && st0.objectiveIds.blue.length === 8, 'objective ids exposed for UI highlighting');
  // Kill 7 of Blue's 8 objectives via the save/load path, then resolve -> Blue defeated.
  const objIds = st0.objectiveIds.blue.slice();
  const blob = g.serialize();
  objIds.slice(0, 7).forEach(id => { blob.health[id] = { h: 0, a: false }; });
  g.deserialize(blob);
  g.commitTurn();
  const after = g.getState();
  ok(after.winner === 'red', 'Blue losing 7/8 key objectives => Red wins (got ' + after.winner + ')');
}

console.log(fails === 0 ? '\nALL TEMPO TESTS PASSED' : '\n' + fails + ' TEMPO TEST(S) FAILED');
process.exit(fails === 0 ? 0 : 1);
