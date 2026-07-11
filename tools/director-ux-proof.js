#!/usr/bin/env node
'use strict';

/*
 * director-ux-proof.js — regression gate for the guided-operation journey.
 *
 * This intentionally checks the authored UI contract rather than rendering pixels:
 * scenario readiness/identity, first-run routing, Focus vs Advanced Analysis, explicit
 * pass semantics, Commit wording, and the denial/lodgment AAR handoff. It also executes
 * the inline loader against a tiny mock graph to prove the readiness event and combined
 * scenario context are wired, not merely mentioned in comments.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const director = read('director.js');
const game = read('game.js');
const inline = read('inline-datasets.js');
const state = read('state.js');
const shell = read('StrikeSim2040.html');
const combined = [director, inline, state, shell].join('\n');
const passed = [];

function check(name, condition) {
  assert.ok(condition, name);
  passed.push(name);
}

function has(source, text) {
  return source.includes(text);
}

function parseScript(name, source) {
  assert.doesNotThrow(() => new vm.Script(source, { filename: name }), `${name} must parse`);
  passed.push(`${name} parses`);
}

function verifyStaticContract() {
  parseScript('director.js', director);
  parseScript('inline-datasets.js', inline);

  check('legacy Scenario 1 label is absent', !/\bScenario 1\b/.test(combined));
  check('meaningful seeded scenario name exists', has(state, "Taiwan Strait 2040 — Opening Denial Window"));

  check('combined scenario context is defined', has(inline, 'BUNDLED_SCENARIO_CONTEXT'));
  ['title', 'background', 'initiatingEvent', 'blueRole', 'redObjective', 'decisionQuestion',
    'victory', 'boundary', 'evidenceLegend', 'sources'].forEach(field => {
    check(`scenario context includes ${field}`, new RegExp('\\b' + field + '\\s*:').test(inline));
  });
  check('combined context attaches to scenario and graph',
    has(inline, 'active.context = BUNDLED_SCENARIO_CONTEXT') &&
    has(inline, 'active.graph.scenarioContext = BUNDLED_SCENARIO_CONTEXT'));
  check('readiness starts false and requires both force packages',
    has(inline, 'window.StrikeSimBundledScenarioReady = false') &&
    has(inline, 'window.StrikeSimBundledScenarioReady = bothForcesLoaded') &&
    has(inline, 'loadedTeams.red && loadedTeams.blue'));
  check('readiness event is dispatched', has(inline, "new CustomEvent('strikesim:scenario-ready'"));
  check('Director reads combined scenario context', has(director, 'function scenarioContext()'));
  check('Blue Joint Force ownership survives import normalization',
    has(shell, 'serviceOwner: r.serviceOwner') && has(shell, 'jointFunction: r.jointFunction') &&
    has(shell, 'tempoRole: r.tempoRole') && has(shell, 'scenarioEnabled: r.scenarioEnabled'));
  check('Joint component mix is visible in the console and operation brief',
    has(shell, 'Blue Joint Force Mix') && has(director, 'function blueJointMixText()'));
  check('first-run names the Joint Force planner role', has(shell, 'Blue Joint Force operational planner'));

  check('first-run offers direct guided-operation CTA', has(shell, 'Start guided operation →'));
  check('first-run offers explicit console choice', has(shell, 'Explore console'));
  check('guided CTA waits for readiness and starts Director',
    has(shell, "window.addEventListener('strikesim:scenario-ready', syncReady)") &&
    has(shell, 'if (window.DirectorModule?.start) window.DirectorModule.start()'));

  check('shell exposes panel state contract',
    has(shell, 'StrikeSimShell.getPanelState') && has(shell, 'StrikeSimShell.setPanels'));
  check('Director implements Focus/Advanced Analysis toggle',
    has(director, 'function enterFocusMode()') && has(director, 'function toggleFocusMode()') &&
    has(director, 'ADVANCED ANALYSIS') && has(director, 'FOCUS MAP'));
  check('Plan enters Focus mode and operation exit restores panels',
    has(director, 'if (!op.panelState) enterFocusMode()') && has(director, 'restorePanels();'));

  check('empty plan cannot use the normal review action',
    has(director, "st.orders.blue.length ? '<button class=\"dir-btn primary\" data-act=\"forecast\">REVIEW FORECAST →</button>'") &&
    has(director, 'QUEUE AN ORDER TO CONTINUE'));
  check('empty plan has an explicit pass action',
    has(director, 'data-act="pass">PASS TURN') && has(director, "act === 'pass'"));
  check('Commit explicitly identifies a deliberate pass',
    has(director, 'Deliberate pass: Blue will take no action this turn. Red will still act.'));

  check('Plan uses Review wording', has(director, 'REVIEW FORECAST →'));
  check('Commit uses blind then house then one-final-revision flow',
    has(director, 'COMMIT CARD · BLIND') && has(director, 'HOUSE REVEALED') &&
    has(director, 'data-act="submit-blind"') && has(director, 'data-act="submit-final"'));
  check('engine-enforced order lock wraps the Commit Card',
    has(director, "GM._internal.lockOrders('blue')") && has(director, "GM._internal.lockedOrderHash('blue')") &&
    has(game, 'function lockOrders(side)') && has(game, 'orders-locked'));
  check('three event calls are must-touch before blind submit',
    has(director, 'card.set.questions.every') && has(director, 'card.touched[beliefId] = true'));
  check('final action commits forecasts and executes', has(director, 'COMMIT FORECASTS &amp; EXECUTE ▶'));
  check('Red timing is described honestly', has(director, 'Orders lock blind; Red commits when you execute.'));
  check('obsolete commit wording is absent',
    !has(director, 'FORECAST &amp; COMMIT') && !has(director, 'Red has already committed'));

  check('AAR surfaces denial/lodgment operational measures',
    has(director, 'DENIAL / LODGMENT VERDICT') && has(director, 'RED THROUGHPUT · HALT &lt;30%') &&
    has(director, 'RED SYSTEM COHERENCE') && has(director, 'LODGMENT ACCUMULATED'));
  check('AAR gives draw a neutral label',
    has(director, "winner === 'draw'") && has(director, 'CONTESTED / UNRESOLVED'));
  check('AAR provides copy and Markdown download controls',
    has(director, 'data-act="copy-aar"') && has(director, 'data-act="download-aar"') &&
    has(director, 'function aarMarkdown()') && has(director, 'function copyAar()') &&
    has(director, 'function downloadAar()'));
  check('AAR export contains scenario, seed, verdict, throughput, and lodgment',
    ['**Scenario:**', '**Seed:**', '**Verdict:**', 'Red throughput:', 'Lodgment accumulated:']
      .every(text => has(director, text)));
}

function verifyStateNameAtRuntime() {
  const context = { window: {}, Date };
  vm.createContext(context);
  vm.runInContext(state, context, { filename: 'state.js' });
  check('runtime AppState starts with the meaningful scenario name',
    context.window.AppState.active().name === 'Taiwan Strait 2040 — Opening Denial Window');
}

async function verifyInlineReadinessAtRuntime() {
  const graph = { nodes: [], links: [] };
  const scenario = { name: 'Initial', graph };
  const listeners = {};
  const dispatched = [];
  let seq = 0;
  const windowMock = {
    AppState: {
      active: () => scenario,
      activeGraph: () => graph
    },
    normalizeImportedPayload: raw => raw,
    addImportedNodes(payload, team) {
      const nodes = payload.nodes.map(node => Object.assign({}, node, { team }));
      graph.nodes.push(...nodes);
      graph.links.push(...(payload.links || []));
      return { nodesAdded: nodes.length, linksAdded: (payload.links || []).length };
    },
    refreshGraph() {},
    refreshMapMarkers() {},
    initUI() {},
    showToast() {},
    addEvent() {},
    fetchJsonWithFallback: async () => ({ nodes: [{ id: 'N' + (++seq) }], links: [] }),
    addEventListener(type, fn) { listeners[type] = fn; },
    dispatchEvent(event) { dispatched.push(event); return true; }
  };
  const context = {
    window: windowMock,
    document: { readyState: 'loading' },
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => { throw new Error('unexpected fetch fallback'); },
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(inline, context, { filename: 'inline-datasets.js' });

  check('runtime readiness begins false', windowMock.StrikeSimBundledScenarioReady === false);
  check('runtime combined context is published before load',
    windowMock.StrikeSimScenario && windowMock.StrikeSimScenario.title === 'Taiwan Strait 2040 — Opening Denial Window');
  check('runtime loader registered its load listener', typeof listeners.load === 'function');

  listeners.load();
  await new Promise(resolve => setTimeout(resolve, 10));

  check('runtime loader populated both force packages', graph.nodes.length === 2);
  check('runtime loader attached combined context',
    scenario.context === windowMock.StrikeSimScenario && graph.scenarioContext === windowMock.StrikeSimScenario);
  check('runtime readiness finishes true', windowMock.StrikeSimBundledScenarioReady === true);
  const readyEvent = dispatched.find(event => event.type === 'strikesim:scenario-ready');
  check('runtime readiness event reports node count and context',
    !!readyEvent && readyEvent.detail.nodeCount === 2 && readyEvent.detail.context === windowMock.StrikeSimScenario);
}

async function main() {
  verifyStaticContract();
  verifyStateNameAtRuntime();
  await verifyInlineReadinessAtRuntime();
  console.log(`Director UX proof: PASS (${passed.length} checks)`);
  passed.forEach(name => console.log('  ✓ ' + name));
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
