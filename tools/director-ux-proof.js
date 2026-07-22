#!/usr/bin/env node
'use strict';

/*
 * director-ux-proof.js — regression gate for the guided-operation journey.
 *
 * This intentionally checks the authored UI contract rather than rendering pixels:
 * scenario readiness/identity, first-run/tutorial routing, Focus vs Advanced Analysis,
 * explicit pass semantics, Commit wording, and the denial/lodgment AAR handoff. It also executes
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

  check('first-run makes the two-turn tutorial the primary CTA', has(shell, 'Play 2-turn tutorial →'));
  check('first-run tutorial chooser stays above the cinematic console layers',
    /#first-run-card\s*\{[^}]*z-index:\s*6000/.test(shell));
  check('first-run preserves full-operation and console choices',
    has(shell, 'Start full operation') && has(shell, 'Explore console'));
  check('tutorial CTA waits for readiness and starts the tutorial entrypoint',
    has(shell, "window.addEventListener('strikesim:scenario-ready', syncReady)") &&
    has(shell, 'if (window.DirectorModule?.startTutorial) window.DirectorModule.startTutorial()'));
  check('tutorial and full-operation choices dismiss the cinematic title layer',
    (shell.match(/CinematicsModule\?\.hideTitle/g) || []).length === 2);
  check('normal operation retains its separate entrypoint',
    has(shell, 'if (window.DirectorModule?.start) window.DirectorModule.start()'));

  check('Director exposes a distinct tutorial mode',
    has(director, 'function startTutorial()') && has(director, 'startTutorial: startTutorial'));
  check('tutorial is a fixed two-turn training scenario',
    has(director, "briefOpts.turnLimit = op.tutorial ? 2 : 8") &&
    has(director, "briefOpts.redDiff = op.tutorial ? 'easy' : 'hard'") &&
    has(director, "op.tutorial ? 204002 : undefined") &&
    has(director, 'TUTORIAL PARAMETERS · LOCKED'));
  check('computer coach spans all five tutorial phases',
    has(director, 'function tutorialCoach') &&
    ['I’ll guide the next two turns.', 'Queue one strike.', 'Make an honest forecast before seeing the model.',
      'Watch one seeded world resolve.', 'Tutorial complete—you ran the full decision loop.']
      .every(text => has(director, text)));
  check('tutorial constrains planning and requires a second-turn logistics choice',
    has(director, "op.tutorial ? ['strike']") &&
    has(director, "st.turn === 2 && logi && logi.decision && logi.decision.id === 'balanced'") &&
    has(director, 'CHOOSE A LOGISTICS POSTURE') && has(director, 'tutorialHasOrder'));
  check('tutorial offers a one-click coach forecast without bypassing blind lock',
    has(director, 'data-act="tutorial-estimate"') && has(director, "act === 'tutorial-estimate'") &&
    has(director, 'tutorialCard.touched.premortem = true') && has(director, 'data-act="submit-blind"'));
  check('tutorial results do not contaminate career stores',
    has(director, 'if (!op.tutorial) appendForecastEntries(newEntries)') &&
    /if \(!op\.tutorial\) \{\s*try \{\s*if \(st && st\.playerModel\) writePlayerModel/.test(director));
  check('tutorial AAR leads directly into a full operation',
    has(director, 'data-act="full-op"') && has(director, "act === 'full-op'"));
  check('WATCH result becomes a centered readable surface with a sticky next action',
    has(director, '#dir-feed.result-ready') && has(director, 'max-height:calc(100vh - 112px)') &&
    has(director, '#dir-feed .outcome>.dir-actions{position:sticky') &&
    has(director, "feed.classList.add('result-ready')") && has(director, "feed.classList.remove('result-ready')"));

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
  check('chip groups wrap and long labels stay inside their cards',
    /\.dir-card\{[^}]*min-width:0/.test(director) &&
    /\.dir-chips\{[^}]*flex-wrap:wrap[^}]*min-width:0[^}]*max-width:100%/.test(director) &&
    /\.dir-chip\{[^}]*max-width:100%[^}]*white-space:normal[^}]*overflow-wrap:anywhere/.test(director));
  check('Commit uses blind then house then one-final-revision flow',
    has(director, 'COMMIT CARD · BLIND') && has(director, 'HOUSE REVEALED') &&
    has(director, 'data-act="submit-blind"') && has(director, 'data-act="submit-final"'));
  check('engine-enforced order lock wraps the Commit Card',
    has(director, "GM._internal.lockOrders('blue')") && has(director, "GM._internal.lockedOrderHash('blue')") &&
    has(game, 'function lockOrders(side)') && has(game, 'orders-locked'));
  check('three event calls are must-touch before blind submit',
    has(director, 'card.set.questions.every') && has(director, 'card.touched[beliefId] = true'));
  // CO-011: the required pre-mortem is named, flagged, and given a direct keyboard route so
  // the manual path never depends on the tutorial coach.
  check('the required pre-mortem is named and given a direct, keyboard-reachable route',
    has(director, 'id="dir-premortem-card"') && has(director, 'id="dir-pm-flag"') &&
    has(director, 'data-act="focus-premortem"') && has(director, "act === 'focus-premortem'") &&
    has(director, "pmCard.querySelector('[data-premortem]')"));
  check('one readiness predicate gates render, live update, and the submit-blind click',
    (director.match(/cardIsReady\(/g) || []).length >= 4 &&
    has(director, "data-act=\"submit-blind\"' + (cardIsReady(card) ? '' : ' disabled')") &&
    has(director, 'if (!cardIsReady(op.commitCard)) return;'));
  check('the live gate status enumerates every required call, pre-mortem included',
    has(director, 'event calls') && has(director, 'pre-mortem (drag one cause)') && has(director, 'LOWER below UPPER'));
  // CO-011: a modal Director overlay (BRIEF/COMMIT/AAR) stands the fixed comms floor down, so
  // it can neither cover the COFM note / AAR actions nor sit visible while the overlay
  // isolation marks it aria-hidden.
  check('a modal Director overlay stands the comms floor down (no overlap, no inert-but-visible)',
    has(director, "classList.toggle('dir-overlay-active', overlayActive)") &&
    has(director, 'isolateForOverlay(overlayActive)'));
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

// CO-011: behavioral proof of the blind-forecast readiness contract. The predicate and its
// plain-language status are pure functions of the commit card, so we extract them straight
// from director.js and exercise the real transitions — manual, coach, and invalid states —
// instead of trusting source strings. This is the regression that would have caught the
// "manual forecast never unlocks without the coach" report.
function verifyReadinessBehavior() {
  const slice = (a, b) => {
    const s = director.indexOf('function ' + a), e = director.indexOf('function ' + b);
    assert.ok(s >= 0 && e > s, 'slice ' + a + '..' + b);
    return director.slice(s, e);
  };
  const predicateSrc = slice('cardIsReady', 'beliefControl');
  const src = predicateSrc + '\n' + slice('forecastGateProgress', 'renderHybridCommit') +
    '\n({ cardIsReady: cardIsReady, forecastGateProgress: forecastGateProgress })';
  const api = vm.runInNewContext(src, {});
  const mk = (o) => {
    o = o || {};
    return {
      step: o.step || 'blind',
      set: { questions: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
      touched: Object.assign({}, o.touched),
      values: { lower: o.lower != null ? o.lower : 0.25, upper: o.upper != null ? o.upper : 0.75 },
      final: { lower: o.flower != null ? o.flower : 0.25, upper: o.fupper != null ? o.fupper : 0.75 }
    };
  };
  const ev3 = { a: true, b: true, c: true };
  const full = Object.assign({ premortem: true }, ev3);

  check('readiness: a fresh card is not ready (LOCK disabled, click guard rejects)',
    api.cardIsReady(mk({})) === false);
  check('readiness: partial manual input (2/3 events, no pre-mortem) stays gated',
    api.cardIsReady(mk({ touched: { a: true, b: true } })) === false);
  check('readiness: all three event calls but no pre-mortem stays gated (the reported bug)',
    api.cardIsReady(mk({ touched: ev3 })) === false);
  check('readiness: full manual input (events + pre-mortem + valid range) unlocks WITHOUT the coach',
    api.cardIsReady(mk({ touched: full })) === true);
  check('readiness: coach-equivalent input reaches the same ready state as manual',
    api.cardIsReady(mk({ touched: full })) === true);
  check('readiness: invalid interval (LOWER >= UPPER) blocks even when every call is touched',
    api.cardIsReady(mk({ touched: full, lower: 0.8, upper: 0.5 })) === false);
  check('readiness: submit-blind guard shares the predicate and rejects an incomplete card',
    api.cardIsReady(mk({ touched: ev3 })) === false && has(director, 'if (!cardIsReady(op.commitCard)) return;'));
  check('readiness: the predicate is state-only — it never consults the tutorial flag',
    !/tutorial/.test(predicateSrc));

  const gPartial = api.forecastGateProgress(mk({ touched: ev3 }));
  check('gate text names the pre-mortem when it is the one remaining blocker',
    /pre-mortem/.test(gPartial) && /event calls 3\/3/.test(gPartial));
  const gInterval = api.forecastGateProgress(mk({ touched: full, lower: 0.8, upper: 0.5 }));
  check('gate text flags the interval when LOWER is not below UPPER', /LOWER below UPPER/.test(gInterval));
  const gReady = api.forecastGateProgress(mk({ touched: full }));
  check('gate text reports Ready exactly when the predicate is satisfied',
    /Ready/.test(gReady) && api.cardIsReady(mk({ touched: full })) === true);
}

async function main() {
  verifyStaticContract();
  verifyReadinessBehavior();
  verifyStateNameAtRuntime();
  await verifyInlineReadinessAtRuntime();
  console.log(`Director UX proof: PASS (${passed.length} checks)`);
  passed.forEach(name => console.log('  ✓ ' + name));
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
