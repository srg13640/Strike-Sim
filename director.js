/* director.js — the Operation Loop (DirectorModule)
 *
 * The front door of StrikeSim 2040. Owns the phase state machine
 *   BRIEF → PLAN → COMMIT → WATCH → (next turn…) → AAR
 * and the three ideas the whole game hangs on (docs/GAME_DESIGN.md):
 *   1. The Forecast — before orders lock, the REAL engine runs this turn across K
 *      ghost worlds (doctrine-driven Red variations, different seeds) and shows the
 *      honest distribution. Ranges, never point predictions.
 *   2. The World — reality resolves as one seeded draw from that same engine.
 *   3. The Counterfactual Machine — the AAR re-runs the same seeded world with one
 *      changed policy and reports what actually mattered.
 *
 * Self-contained like campaign.js/wargame.js: injects its own CSS + DOM, talks to
 * window.GameModule (engine, API frozen by the loop gate), window.AppState,
 * window.MapModule (strike FX), and shell globals guarded at call time
 * (setView, selectedNode, addEvent, refreshMapMarkers, refreshTable).
 * The legacy ⚔ War Game / Campaign launchers are hidden — the loop is the only door.
 */
window.DirectorModule = (function () {
  'use strict';

  var GM = null;          // window.GameModule, resolved at boot
  var GHOSTS = 200;       // ghost worlds per forecast
  var OBJ_LOSS_FRAC = 0.25; // mirror of game.js key-terrain threshold (engine const, not exported)

  // Operation state (UI-side only; the engine owns the match)
  var op = {
    phase: 'idle',        // idle | brief | plan | commit | watch | aar
    kind: 'strike',       // order builder: strike | harden | repair
    methodKey: 'kinetic',
    targetId: null,
    forecasts: {},        // turn -> forecast summary (honesty ledger)
    actuals: {},          // turn -> actual outcome summary
    judgments: {},        // turn -> locked blind/final Commit Card record
    standingForecasts: [],
    scoredEntries: [],
    intervalScores: [],
    commitCard: null,
    standingCarry: null,
    lastForecast: null,
    record: null,         // GM.serialize() snapshot at match end (for counterfactuals)
    startModel: null,     // CO-007 I-4: the player model PASSED to newMatch (pre-match) — replay payloads need it
    challenge: null,      // CO-007 S3: validated #op= payload for the op being briefed/played, else null
    counterfactual: null,
    counterfactualWorker: null,
    aar: null,
    aarExported: false,
    watchTimers: [],
    selPoll: null,
    lastSelId: null,
    panelState: null,      // shell rails before the guided operation takes focus
    focusMode: true,
    modalIsolation: null,
    returnFocus: null,
    tutorial: false
  };

  // ---- tiny utils -----------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function evt(text) { try { if (typeof addEvent === 'function') addEvent({ type: 'War', text: text }); } catch (e) {} }
  // ── CO-006 P2: presentation bridges. The Director is the sole author of comms lines and
  //    every line is composed from live engine state — the cinematics module only stages them.
  //    All three guards no-op cleanly when the performance layer is absent (engine unaffected).
  function cinApi() { return window.CinematicsModule || null; }
  function cine(fn, arg) { var c = cinApi(); if (c && typeof c[fn] === 'function') { try { c[fn](arg); } catch (e) {} } }
  function comms(callsign, text, cls) { var c = cinApi(); if (c && c.comms) { try { c.comms(callsign, text, cls); } catch (e) {} } }
  // CO-006 P4 (W6): the operator's callsign in comms addressing — read over the guarded
  // bridge (cinematics owns and sanitizes it), applied only to lines addressed TO the
  // operator. Empty callsign = the pre-P4 lines, verbatim.
  function opAddr() {
    var c = cinApi(), cs = '';
    if (c && typeof c.getCallsign === 'function') { try { cs = String(c.getCallsign() || ''); } catch (e) {} }
    return cs ? cs + ', ' : '';
  }
  function sfxA(name, opts) { try { if (window.AudioFXModule) window.AudioFXModule.play(name, opts); } catch (e) {} }
  function pct(sorted, p) {
    if (!sorted.length) return 0;
    var i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
    return sorted[i];
  }
  function band(arr) {
    var s = arr.slice().sort(function (a, b) { return a - b; });
    return { lo: pct(s, 0.1), mid: pct(s, 0.5), hi: pct(s, 0.9) };
  }
  function bandStr(b, unit) { return b.lo === b.hi ? (b.lo + (unit || '')) : (b.lo + '–' + b.hi + (unit || '')); }
  function nodeVal(b) { return (b.importance || 1) * (b.casc || b.cascScore || 1); }
  var FORECAST_ARCHIVE_KEY = 'strikesim.co005.v1.forecasts';
  function readForecastArchive() {
    try {
      var parsed = JSON.parse(localStorage.getItem(FORECAST_ARCHIVE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }
  function writeForecastArchive(entries) {
    try { localStorage.setItem(FORECAST_ARCHIVE_KEY, JSON.stringify((entries || []).slice(-2000))); } catch (e) {}
  }
  function appendForecastEntries(entries) {
    if (!entries || !entries.length) return;
    var archive = readForecastArchive(), byId = {};
    archive.forEach(function (entry) { byId[entry.entryId] = entry; });
    entries.forEach(function (entry) { byId[entry.entryId] = entry; });
    writeForecastArchive(Object.keys(byId).map(function (id) { return byId[id]; }));
  }
  // CO-005 A6/B7 career stores: the player-habit model Red adapts to across
  // operations, and the finished-operation records behind the outside-view strip.
  var PLAYER_MODEL_KEY = 'strikesim.co005.v1.playerModel';
  var OPS_ARCHIVE_KEY = 'strikesim.co005.v1.operations';
  function readPlayerModel() {
    try { return window.RedMindModule.normalizePlayerModel(JSON.parse(localStorage.getItem(PLAYER_MODEL_KEY) || 'null')); }
    catch (e) { return window.RedMindModule.normalizePlayerModel(null); }
  }
  function writePlayerModel(model) {
    try { localStorage.setItem(PLAYER_MODEL_KEY, JSON.stringify(window.RedMindModule.normalizePlayerModel(model))); } catch (e) {}
  }
  function readOpsArchive() {
    try {
      var parsed = JSON.parse(localStorage.getItem(OPS_ARCHIVE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }
  function appendOpsArchive(record) {
    if (!record) return;
    try { localStorage.setItem(OPS_ARCHIVE_KEY, JSON.stringify(readOpsArchive().concat([record]).slice(-400))); } catch (e) {}
  }
  function blueOrderClassifier() {
    return function (order) {
      var node = GM.boardNode ? GM.boardNode(order.targetId) : null;
      return window.RedMindModule.targetClass(node);
    };
  }
  function operationArchetype(record) {
    var all = [];
    ((record && record.history) || []).forEach(function (row) {
      all = all.concat((row.orders && row.orders.blue) || []);
    });
    return window.ForecastingModule.planArchetype(all, blueOrderClassifier());
  }
  function refreshVisuals() {
    try { if (typeof refreshMapMarkers === 'function') refreshMapMarkers(); } catch (e) {}
    try { if (typeof refreshTable === 'function') refreshTable(); } catch (e) {}
    try { if (typeof updateTeamSummary === 'function') updateTeamSummary(); } catch (e) {}
  }
  function forceMapView() { try { if (typeof window.setView === 'function') window.setView('map'); } catch (e) {} }
  function curSel() { try { return (typeof selectedNode !== 'undefined') ? selectedNode : null; } catch (e) { return null; } }
  // CO-006 P4: effective reduced motion = system media query OR the operator's W6
  // toggle (cinematics owns the toggle and mirrors it as html.cin-rm — one truth).
  function prefersReducedMotion() {
    try {
      if (document.documentElement && document.documentElement.classList.contains('cin-rm')) return true;
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }
  function scenarioContext() {
    if (op && op.variantContext) return op.variantContext;   // CO-005 C5: active operation variant
    var scen = (window.AppState && AppState.active && AppState.active()) || null;
    var attached = scen && (scen.context || (scen.graph && scen.graph.scenarioContext));
    if (attached) return attached;
    return scen && scen.isBundled ? (window.StrikeSimScenario || {}) : {};
  }
  function safeHttpUrl(url) { return /^https?:\/\//i.test(String(url || '')) ? String(url) : ''; }
  function shellApi() { return window.StrikeSimShell || null; }
  function panelState() {
    var api = shellApi();
    try { return api && typeof api.getPanelState === 'function' ? api.getPanelState() : null; } catch (e) { return null; }
  }
  function setPanels(next) {
    var api = shellApi();
    try { if (api && typeof api.setPanels === 'function') api.setPanels(next); } catch (e) {}
  }
  function enterFocusMode() {
    if (!op.panelState) op.panelState = panelState();
    op.focusMode = true;
    setPanels({ leftCollapsed: true, rightCollapsed: true });
  }
  function toggleFocusMode() {
    var now = panelState();
    var bothCollapsed = !!(now && now.leftCollapsed && now.rightCollapsed);
    op.focusMode = !bothCollapsed;
    setPanels({ leftCollapsed: op.focusMode, rightCollapsed: op.focusMode });
    renderRail();
  }
  function restorePanels() {
    if (op.panelState) setPanels(op.panelState);
    op.panelState = null;
    op.focusMode = true;
  }
  function startReady() {
    var graph = window.AppState && AppState.activeGraph ? AppState.activeGraph() : null;
    var scen = window.AppState && AppState.active ? AppState.active() : null;
    var dataReady = graph && graph.nodes && graph.nodes.length;
    return !!(dataReady && (!scen || !scen.isBundled || window.StrikeSimBundledScenarioReady === true));
  }
  function explainInvalid(reason) {
    return ({
      'no-source': 'No surviving capability can deliver this method.',
      'source-cannot-fire': 'The selected source cannot deliver this method.',
      'friendly-target': 'Strike orders require a Red target.',
      'not-friendly': 'Harden and repair orders require a Blue node.',
      'target-dead': 'That node is already out of action.',
      'target-inactive': 'That capability is outside the active posture.',
      'no-target': 'Choose a target first.',
      'no-ap': 'No orders remain this turn.',
      'bad-method': 'Choose a valid delivery method.',
      'roe-min-escalation': 'Your declared ROE has not unlocked this target yet.',
      'roe-denied': 'Your declared ROE prohibits this target.',
      'roe-default-deny': 'Your declared ROE does not authorize this target.',
      'fuel-shortage': 'Fuel stocks cannot support this order.',
      'ammunition-shortage': 'Ammunition stocks cannot support this order.',
      'maintenance-shortage': 'Maintenance capacity cannot support this order.',
      'personnel-shortage': 'Personnel capacity cannot support this order.',
      'signal-needs-enemy-axis': 'Choose a Red system to define the deception axis.',
      'decoy-quota': 'Only one zero-cost decoy is allowed per turn.'
    })[reason] || 'This order is not available in the current state.';
  }
  function isolateForOverlay(active) {
    if (active && !op.modalIsolation) {
      op.modalIsolation = [];
      Array.prototype.forEach.call(document.body.children, function (node) {
        if (node === $('dir-overlay') || !node.matches || node.matches('script,style,link')) return;
        op.modalIsolation.push({ node: node, inert: !!node.inert, ariaHidden: node.getAttribute('aria-hidden') });
        node.inert = true;
        node.setAttribute('aria-hidden', 'true');
      });
    } else if (!active && op.modalIsolation) {
      op.modalIsolation.forEach(function (saved) {
        saved.node.inert = saved.inert;
        if (saved.ariaHidden == null) saved.node.removeAttribute('aria-hidden');
        else saved.node.setAttribute('aria-hidden', saved.ariaHidden);
      });
      op.modalIsolation = null;
    }
  }
  function focusPlanControl() {
    setTimeout(function () { var target = $('dir-target'); if (target) target.focus(); }, 0);
  }
  function onOverlayKeydown(ev) {
    if ($('dir-overlay').getAttribute('aria-hidden') === 'true') return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (op.phase === 'commit') { setPhase('plan'); renderDock(); focusPlanControl(); }
      else if (op.phase === 'brief') abortOperation(true);
      else if (op.phase === 'aar') endOperation();
      return;
    }
    if (ev.key !== 'Tab') return;
    var controls = Array.prototype.slice.call($('dir-overlay').querySelectorAll('button:not(:disabled),a[href],summary,input:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])'))
      .filter(function (node) { return node.getClientRects().length > 0; });
    if (!controls.length) { ev.preventDefault(); $('dir-wrap').focus(); return; }
    var first = controls[0], last = controls[controls.length - 1];
    if (ev.shiftKey && (document.activeElement === first || document.activeElement === $('dir-wrap'))) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }

  // ---- CSS --------------------------------------------------------------------------
  function injectCss() {
    if ($('dir-style')) return;
    var s = document.createElement('style');
    s.id = 'dir-style';
    s.textContent = [
      // teardown: the loop is the only front door
      '#wg-launch,#cp-launch{display:none !important;}',
      // launch
      '#dir-launch{background:linear-gradient(180deg,#123048,#0c2032);border:1px solid #2b6ea0;color:#bfe8ff;',
      'font:700 13px Oswald,system-ui;letter-spacing:.14em;padding:7px 16px;border-radius:8px;cursor:pointer;}',
      '#dir-launch:hover{border-color:#00d8ff;color:#fff;box-shadow:0 0 18px rgba(0,216,255,.35);}',
      // phase rail
      '#dir-rail{position:fixed;top:calc(var(--bar-h,56px) + 34px);left:50%;transform:translateX(-50%);z-index:1700;display:none;align-items:center;gap:4px;',
      'background:rgba(8,14,20,.92);border:1px solid #1d3a52;border-radius:10px;padding:5px 10px;backdrop-filter:blur(6px);',
      'font:600 11px Inter,system-ui;color:#7f9db5;}',
      '#dir-rail .ph{padding:3px 9px;border-radius:6px;letter-spacing:.12em;}',
      '#dir-rail .ph.on{background:#0e3a55;color:#8fe8ff;box-shadow:inset 0 0 0 1px #2b6ea0;}',
      '#dir-rail .ph.done{color:#3f5a70;}',
      '#dir-rail .sep{color:#27455e;}',
      '#dir-rail .meta{margin-left:10px;color:#9fc2dc;font-weight:700;}',
      '#dir-rail button{background:none;border:none;color:#5c7d96;cursor:pointer;font-size:13px;margin-left:6px;}',
      '#dir-rail .mode{border-left:1px solid #27455e;padding-left:10px;color:#8fcbe8;font:700 10px Oswald,system-ui;letter-spacing:.11em;}',
      '#dir-rail button:hover{color:#ff8a8a;}',
      // full-screen overlay moments (Brief / Commit / AAR)
      '#dir-overlay{position:fixed;inset:0;z-index:5000;display:none;overflow:auto;',
      'background:radial-gradient(1200px 700px at 50% 20%,rgba(10,26,40,.97),rgba(4,8,12,.985));backdrop-filter:blur(8px);}',
      '#dir-overlay .wrap{max-width:880px;margin:5vh auto 6vh;padding:0 22px;color:#cfe3f2;font:14px/1.55 Inter,system-ui;}',
      '.dir-kicker{font:700 12px Oswald,system-ui;letter-spacing:.34em;color:#00d8ff;margin-bottom:6px;}',
      '.dir-h1{font:700 34px/1.1 Oswald,system-ui;letter-spacing:.06em;color:#f2f8fc;margin:0 0 4px;}',
      '.dir-sub{color:#8fb2ca;margin-bottom:26px;}',
      '.dir-badges{display:flex;gap:7px;flex-wrap:wrap;margin:14px 0 12px;}',
      '.dir-badge{border:1px solid #28536f;background:#0a2131;color:#9fdaf2;border-radius:999px;padding:3px 8px;font:700 10px Oswald,system-ui;letter-spacing:.12em;}',
      '.dir-badge.notional{border-color:#765f2d;color:#ffd791;background:#2a210d;}',
      '.dir-situation{font-size:14px;line-height:1.65;color:#d4e5f0;margin:0 0 12px;}',
      '.dir-context{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;margin-top:12px;}',
      '.dir-context div{border-top:1px solid #193247;padding-top:8px;}',
      '.dir-context span{display:block;color:#6fb7d8;font:700 10px Oswald,system-ui;letter-spacing:.15em;margin-bottom:3px;}',
      '.dir-question{margin-top:14px;border-left:3px solid #00bfe7;background:rgba(8,39,55,.72);padding:11px 13px;color:#e7f7ff;font-weight:600;}',
      '.dir-sources{margin-top:12px;border-top:1px solid #193247;padding-top:9px;color:#8fb2ca;font-size:12px;}',
      '.dir-sources summary{cursor:pointer;color:#9fdaf2;font-weight:700;}',
      '.dir-sources ul{margin:8px 0 4px;padding-left:20px;}.dir-sources li{margin:4px 0;}',
      '.dir-sources a{color:#70cfff;}.dir-sources a:hover{color:#c7f1ff;}',
      '.dir-card{background:linear-gradient(180deg,rgba(16,28,40,.85),rgba(10,18,26,.85));border:1px solid #1d3a52;',
      'border-radius:12px;padding:16px 18px;margin-bottom:14px;min-width:0;}',
      '.dir-card h3{font:700 12px Oswald,system-ui;letter-spacing:.22em;color:#6fb7d8;margin:0 0 10px;}',
      '.dir-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}',
      '.dir-obj{display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px dotted #16283a;font-size:13px;}',
      '.dir-obj .v{color:#7f9db5;white-space:nowrap;}',
      '.dir-stat{display:flex;justify-content:space-between;padding:3px 0;font-size:13px;}',
      '.dir-stat b{color:#e8f4fb;}',
      '.dir-actions{display:flex;gap:12px;margin-top:22px;justify-content:flex-end;align-items:center;flex-wrap:wrap;}',
      '#dir-overlay>.wrap>.dir-actions{position:sticky;bottom:0;margin-left:-10px;margin-right:-10px;padding:13px 10px 8px;background:linear-gradient(180deg,rgba(5,10,15,.25),rgba(5,10,15,.98) 28%);z-index:2;}',
      '.dir-btn{background:#0d2233;border:1px solid #24506f;color:#a8cde4;font:700 13px Oswald,system-ui;letter-spacing:.14em;',
      'padding:10px 22px;border-radius:9px;cursor:pointer;}',
      '.dir-btn:hover{border-color:#3f7ea8;color:#e8f6ff;}',
      '.dir-btn.primary{background:linear-gradient(180deg,#0e4d70,#0a3552);border-color:#2f88b8;color:#dff5ff;}',
      '.dir-btn.primary:hover{box-shadow:0 0 22px rgba(0,216,255,.35);}',
      '.dir-btn:focus-visible,.dir-chip:focus-visible{outline:2px solid #6be1ff;outline-offset:2px;}',
      '.dir-btn:disabled{opacity:.46;cursor:not-allowed;box-shadow:none;}',
      '.dir-skip{float:right;min-height:32px;padding:5px 9px;font-size:10px;}',
      '.dir-btn.danger{border-color:#7a2f2f;color:#ffb0a8;}',
      '.dir-note{font-size:12px;color:#6d8ca4;font-style:italic;}',
      '.dir-coach{border:1px solid #2f88b8;background:linear-gradient(135deg,rgba(8,57,79,.96),rgba(9,28,42,.96));border-radius:12px;padding:13px 15px;margin:0 0 14px;box-shadow:inset 3px 0 0 #63dcff,0 8px 24px rgba(0,0,0,.2);}',
      '.dir-coach .step{font:700 10px Oswald,system-ui;letter-spacing:.2em;color:#74dfff;margin-bottom:4px;}',
      '.dir-coach b{display:block;color:#effbff;font:700 15px Oswald,system-ui;letter-spacing:.05em;margin-bottom:3px;}',
      '.dir-coach p{margin:0;color:#c7e6f4;font-size:12.5px;line-height:1.45;}',
      '.dir-coach .dir-btn{margin-top:10px;}',
      '#dir-dock .dir-coach{margin:3px 0 8px;padding:9px 12px;display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 12px;align-items:center;}',
      '#dir-dock .dir-coach .step{grid-row:1;padding-right:12px;border-right:1px solid rgba(99,220,255,.32);white-space:nowrap;}',
      '#dir-dock .dir-coach b{font-size:13px;margin:0;}#dir-dock .dir-coach p{font-size:11.5px;}',
      '#dir-feed .dir-coach{margin:4px 0 9px;padding:9px 11px;}#dir-feed .dir-coach b{font-size:13px;}',
      '.dir-chips{display:flex;gap:6px;flex-wrap:wrap;min-width:0;max-width:100%;}',
      '.dir-chip{appearance:none;min-width:0;max-width:100%;white-space:normal;overflow-wrap:anywhere;text-align:center;line-height:1.25;background:#0b1a26;border:1px solid #1d3a52;color:#8fb2ca;border-radius:7px;padding:5px 11px;cursor:pointer;font:600 12px Inter;}',
      '.dir-chip.on{background:#0e3a55;color:#c9f2ff;border-color:#2f88b8;}',
      '.dir-chip:disabled{opacity:.38;cursor:not-allowed;text-decoration:line-through;}',
      // CO-006 P2: disclosed-prior bars (1.4s ease-out fills, staggered 350ms — mockup grammar)
      '.dir-prior{margin-top:8px;}',
      '.dir-prior .pr{display:flex;align-items:center;gap:8px;margin:4px 0;font-size:11px;letter-spacing:.08em;color:#8fb2ca;}',
      '.dir-prior .pr span.lbl{width:104px;text-transform:uppercase;}',
      '.dir-prior .pr b{width:34px;text-align:right;color:#dff2ff;font-weight:600;}',
      '.dir-prior .track{display:block;flex:1;height:7px;background:#10283a;border-radius:999px;overflow:hidden;}',
      '.dir-prior .fill{display:block;height:100%;width:0;border-radius:999px;animation:dirPriorFill 1.4s ease-out forwards;}',
      '.dir-prior .pr:nth-child(2) .fill{animation-delay:.35s;} .dir-prior .pr:nth-child(3) .fill{animation-delay:.7s;}',
      '.dir-prior .fill.a{background:linear-gradient(90deg,#d06a55,#ff8f75);}',
      '.dir-prior .fill.d{background:linear-gradient(90deg,#b88a3c,#ffd27b);}',
      '.dir-prior .fill.n{background:linear-gradient(90deg,#2f88b8,#70d9ff);}',
      '@keyframes dirPriorFill{from{width:0;}to{width:var(--w,50%);}}',
      // CO-006 P2: armed EXECUTE pulse — hot only after the house line has rendered
      '.cin-armed{animation:dirArmPulse 2.2s ease-in-out infinite;}',
      '@keyframes dirArmPulse{0%,100%{box-shadow:0 0 6px rgba(255,176,0,.22);border-color:#8a6a1f;}50%{box-shadow:0 0 26px rgba(255,176,0,.6);border-color:var(--amber,#ffb000);}}',
      '@media (prefers-reduced-motion: reduce){.dir-prior .fill{animation:none;width:var(--w,50%);}.cin-armed{animation:none;box-shadow:0 0 14px rgba(255,176,0,.4);border-color:var(--amber,#ffb000);}}',
      // CO-006 P4: html.cin-rm mirrors the media query for the operator's forced toggle
      'html.cin-rm .dir-prior .fill{animation:none;width:var(--w,50%);}',
      'html.cin-rm .cin-armed{animation:none;box-shadow:0 0 14px rgba(255,176,0,.4);border-color:var(--amber,#ffb000);}',
      // forecast strip
      '.dir-fc{border:1px solid #234a66;background:rgba(9,22,33,.9);border-radius:10px;padding:12px 14px;margin:12px 0;}',
      '.dir-fc .t{font:700 11px Oswald;letter-spacing:.22em;color:#00d8ff;margin-bottom:8px;}',
      '.dir-fc .rows{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;text-align:center;}',
      '.dir-fc .cell b{display:block;font:700 20px Oswald;color:#eaf6fd;}',
      '.dir-fc .cell span{font-size:11px;color:#7f9db5;letter-spacing:.06em;}',
      '.dir-fc .honesty{margin-top:9px;font-size:11.5px;color:#6d8ca4;font-style:italic;text-align:center;}',
      '.dir-belief{padding:11px 0 13px;border-bottom:1px solid #173047;}',
      '.dir-belief:last-child{border-bottom:0;}',
      '.dir-belief .head{display:flex;justify-content:space-between;gap:12px;align-items:baseline;}',
      '.dir-belief .head b{color:#e8f5fc;font-size:13px;}.dir-belief .head output{font:700 18px Oswald;color:#70d9ff;}',
      '.dir-belief input[type=range]{width:100%;accent-color:#29b9ed;cursor:pointer;margin:8px 0 0;}',
      '.dir-house{margin-top:7px;padding:7px 9px;border-left:2px solid #5aa9cc;background:#0a1c29;color:#a9cee2;font-size:12px;}',
      '.dir-lock{display:inline-block;border:1px solid #43677d;border-radius:999px;padding:2px 8px;color:#9fc9dd;font:700 10px Oswald;letter-spacing:.12em;}',
      '.dir-scoreline{margin-top:7px;color:#c9e5f3;font-size:12px;}',
      '.dir-intel{display:flex;align-items:center;gap:8px;width:100%;font-size:11px;color:#8fb2ca;}',
      '.dir-intel .track{display:flex;height:8px;flex:1;border-radius:999px;overflow:hidden;background:#10283a;}',
      '.dir-intel .a{background:#d06a55}.dir-intel .d{background:#b88a3c}.dir-intel .n{background:#4ba3c7}',
      // command dock (PLAN)
      '#dir-dock{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:1500;display:none;width:min(960px,94vw);',
      'background:linear-gradient(180deg,rgba(12,22,32,.96),rgba(8,14,20,.97));border:1px solid #1f4058;border-radius:14px;',
      'box-shadow:0 12px 40px rgba(0,0,0,.55);padding:10px 14px;font:13px Inter,system-ui;color:#cfe3f2;backdrop-filter:blur(8px);}',
      '#dir-dock .row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:4px 0;}',
      '#dir-dock .stat{font:700 11px Oswald;letter-spacing:.14em;color:#7f9db5;}',
      '#dir-dock .stat b{color:#dff2ff;font-size:13px;}',
      '#dir-dock .ap i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:3px;background:#123a55;border:1px solid #2b6ea0;}',
      '#dir-dock .ap i.full{background:#37c4ff;box-shadow:0 0 7px rgba(55,196,255,.7);}',
      '#dir-dock select{background:#0b1a26;color:#cfe6f5;border:1px solid #1d3a52;border-radius:7px;padding:7px 8px;max-width:390px;min-width:220px;flex:1;font:12px Inter;}',
      '#dir-dock .q{display:flex;gap:6px;flex-wrap:wrap;}',
      '#dir-dock .oq{background:#0e2536;border:1px solid #235273;border-radius:7px;padding:3px 8px;font-size:12px;color:#bfe0f2;display:flex;gap:7px;align-items:center;}',
      '#dir-dock .oq.h{border-color:#2f6e46;} #dir-dock .oq.r{border-color:#6e5a2f;}',
      '#dir-dock .oq .remove{cursor:pointer;background:none;border:0;padding:0;color:#7f9db5;font:inherit;} #dir-dock .oq .remove:hover{color:#ff9d94;}',
      '#dir-dock .spacer{flex:1;}',
      // objective overlay (map rings on both sides' key terrain)
      '.dir-objring{display:block;width:34px;height:34px;border-radius:50%;box-sizing:border-box;',
      'border:2px solid;animation:dirObjPulse 2.4s ease-in-out infinite;}',
      '.dir-objring.b{border-color:rgba(77,171,247,.9);box-shadow:0 0 12px rgba(77,171,247,.45),inset 0 0 10px rgba(77,171,247,.25);}',
      '.dir-objring.r{border-color:rgba(255,107,107,.9);box-shadow:0 0 12px rgba(255,107,107,.45),inset 0 0 10px rgba(255,107,107,.25);border-style:dashed;}',
      '.dir-objring.down{border-color:rgba(120,130,140,.55);box-shadow:none;animation:none;opacity:.55;}',
      '@keyframes dirObjPulse{0%,100%{transform:scale(1);opacity:.9;}50%{transform:scale(1.16);opacity:.55;}}',
      // recon readout
      '.dir-recon{font-size:11.5px;color:#8fd0e8;background:rgba(10,26,38,.65);border:1px solid #14344a;border-radius:7px;',
      'padding:5px 9px;letter-spacing:.02em;}',
      '.dir-recon b{color:#dff2ff;}',
      // watch feed
      '#dir-feed{position:fixed;left:16px;bottom:16px;z-index:1500;display:none;width:min(430px,calc(100vw - 32px));max-height:58vh;overflow:auto;',
      'background:rgba(8,14,20,.94);border:1px solid #1f4058;border-radius:12px;padding:10px 12px;font:12.5px Inter;color:#cfe3f2;backdrop-filter:blur(6px);}',
      '#dir-feed .fl{padding:3px 2px;border-bottom:1px dotted #142534;opacity:0;animation:dirIn .28s ease forwards;}',
      '@keyframes dirIn{from{opacity:0;transform:translateY(5px);}to{opacity:1;transform:none;}}',
      '#dir-feed .fl.blue{color:#9fd4ff;} #dir-feed .fl.red{color:#ffb09f;}',
      '#dir-feed .fl.kill{font-weight:700;color:#fff;} #dir-feed .fl.cas{color:#ffc46b;} #dir-feed .fl.miss{opacity:.62;}',
      '#dir-feed .fl.sys{color:#6fb7d8;font-weight:700;letter-spacing:.08em;}',
      '#dir-feed .outcome{margin-top:8px;padding:9px;border:1px solid #234a66;border-radius:9px;background:rgba(10,24,36,.9);}',
      // AAR bits
      '.dir-ledger{width:100%;border-collapse:collapse;font-size:12.5px;}',
      '.dir-ledger th{font:700 10.5px Oswald;letter-spacing:.16em;color:#6fb7d8;text-align:left;padding:4px 6px;border-bottom:1px solid #1d3a52;}',
      '.dir-ledger td{padding:4px 6px;border-bottom:1px dotted #16283a;color:#c4dcec;}',
      '.dir-ledger td.ok{color:#7be3a1;} .dir-ledger td.out{color:#ffb09f;}',
      '.dir-bars{display:flex;gap:5px;align-items:flex-end;height:74px;margin-top:6px;}',
      '.dir-bars .tcol{flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:2px;text-align:center;}',
      '.dir-bars .b{background:#2f88b8;border-radius:2px 2px 0 0;min-height:2px;}',
      '.dir-bars .r{background:#b8564f;}',
      '.dir-bars .tl{font-size:10px;color:#5c7d96;}',
      '.dir-colosseum{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;}',
      '.dir-colosseum label{display:flex;flex-direction:column;gap:4px;color:#789bb2;font:700 10px Oswald;letter-spacing:.09em;}',
      '.dir-colosseum select{background:#091923;color:#d9edf8;border:1px solid #294a60;border-radius:7px;padding:8px;min-width:0;}',
      '.dir-cf-result{margin-top:10px;padding:10px;border:1px solid #31536a;border-radius:8px;background:#091923;color:#cce7f4;font-size:12.5px;line-height:1.5;}',
      '.dir-verdict{font:700 26px Oswald;letter-spacing:.08em;margin:2px 0 2px;}',
      '.dir-verdict.win{color:#7be3a1;} .dir-verdict.loss{color:#ff9d94;} .dir-verdict.draw{color:#ffd27b;}',
      // CO-006 P3: debrief header furniture — the rank chip and the serial-plate seed
      '.dir-rankchip{font:11px "Share Tech Mono",monospace;letter-spacing:.3em;color:#ffb000;margin:2px 0 6px;text-transform:uppercase;}',
      '.dir-serial{font-family:"Share Tech Mono",monospace;letter-spacing:.3em;color:#ffd27b;border:1px solid rgba(255,210,123,.35);padding:1px 7px;margin-left:2px;}',
      '.dir-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px;}',
      '.dir-metric{background:#091923;border:1px solid #19364a;border-radius:8px;padding:9px;text-align:center;}',
      '.dir-metric b{display:block;color:#e8f7ff;font:700 20px Oswald,system-ui;}.dir-metric span{color:#789bb2;font-size:10px;letter-spacing:.08em;}',
      '@media(max-width:760px){.dir-grid,.dir-context,.dir-colosseum{grid-template-columns:1fr}.dir-metrics{grid-template-columns:1fr 1fr}.dir-fc .rows{grid-template-columns:1fr;gap:5px}.dir-fc .cell{display:flex;align-items:baseline;justify-content:space-between;text-align:left;border-bottom:1px dotted #193247;padding:4px 0}.dir-fc .cell b{font-size:17px}.dir-h1{font-size:27px}#dir-overlay .wrap{margin-top:4vh;padding:0 14px}.dir-actions{justify-content:stretch}.dir-actions .dir-note{flex:1 1 100%}.dir-actions .dir-btn{flex:1}#dir-dock{bottom:8px;width:calc(100vw - 16px);padding:8px}#dir-dock .dir-coach{grid-template-columns:1fr}#dir-dock .dir-coach .step{border-right:0;padding-right:0}#dir-rail .ph:not(.on),#dir-rail .sep{display:none}#dir-rail{max-width:calc(100vw - 16px);white-space:nowrap}}',
      '@media(max-width:520px){#dir-rail .mode{font-size:0}#dir-rail .mode:after{content:"TOOLS";font-size:10px}.dir-btn,.dir-chip{min-height:44px;padding:9px 13px}#dir-dock select{min-width:100%;max-width:100%}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  // ---- DOM shell ----------------------------------------------------------------------
  function buildDom() {
    if ($('dir-launch')) return;
    var b = el('<button id="dir-launch" title="Start an Operation — Brief · Plan · Commit · Watch · AAR">▶ OPERATION</button>');
    b.addEventListener('click', start);
    document.body.appendChild(b);
    document.body.appendChild(el('<div id="dir-rail" role="navigation" aria-label="Operation phases"></div>'));
    document.body.appendChild(el('<div id="dir-overlay" role="dialog" aria-modal="true" aria-hidden="true"><div class="wrap" id="dir-wrap" tabindex="-1"></div></div>'));
    document.body.appendChild(el('<div id="dir-dock" role="region" aria-label="Operation planning controls"></div>'));
    document.body.appendChild(el('<div id="dir-feed" role="log" aria-live="polite" aria-label="Turn resolution" tabindex="-1"></div>'));
    $('dir-overlay').addEventListener('click', onOverlayClick);
    $('dir-overlay').addEventListener('input', onOverlayInput);
    $('dir-overlay').addEventListener('keydown', onOverlayKeydown);
    $('dir-dock').addEventListener('click', onDockClick);
    $('dir-dock').addEventListener('change', onDockChange);
    $('dir-feed').addEventListener('click', onFeedClick);
    $('dir-rail').addEventListener('click', function (ev) {
      var act = ev.target.getAttribute && ev.target.getAttribute('data-act');
      if (act === 'abort') abortOperation();
      else if (act === 'panels') toggleFocusMode();
    });
  }

  // ---- phase rail -----------------------------------------------------------------
  var PHASES = ['brief', 'plan', 'commit', 'watch', 'aar'];
  function renderRail() {
    var r = $('dir-rail');
    if (op.phase === 'idle') { r.style.display = 'none'; return; }
    var st = GM.getState();
    var idx = PHASES.indexOf(op.phase === 'aar' ? 'aar' : op.phase);
    var chips = PHASES.map(function (p, i) {
      var cls = i === idx ? 'ph on' : (i < idx ? 'ph done' : 'ph');
      return '<span class="' + cls + '">' + p.toUpperCase() + '</span>' + (i < PHASES.length - 1 ? '<span class="sep">›</span>' : '');
    }).join('');
    var meta = st ? '<span class="meta">' + (op.tutorial ? 'TUTORIAL · ' : '') + 'TURN ' + st.turn + '/' + st.cfg.turnLimit + '</span>' : '';
    var tools = (op.phase === 'plan' || op.phase === 'watch') ?
      '<button class="mode" data-act="panels" title="' + (op.focusMode ? 'Open the expert analysis rails' : 'Collapse the analysis rails and focus the map') + '">' +
      (op.focusMode ? 'ADVANCED ANALYSIS' : 'FOCUS MAP') + '</button>' : '';
    r.innerHTML = chips + meta + tools + '<button data-act="abort" aria-label="Abort operation" title="Abort operation">✕</button>';
    r.style.display = 'flex';
  }

  function setPhase(p) {
    op.phase = p;
    if (p !== 'plan') stopSelPoll();
    // CO-006 P3: the AAR deal class never leaks into other phases' renders.
    if (p !== 'aar') { try { $('dir-wrap').classList.remove('cin-deal'); } catch (e) {} }
    var overlayActive = p === 'brief' || p === 'commit' || p === 'aar';
    try { if (window.AppShell && AppShell.setOverlay) AppShell.setOverlay('director', overlayActive); } catch (e) {}
    renderRail();
    $('dir-overlay').style.display = overlayActive ? 'block' : 'none';
    $('dir-overlay').setAttribute('aria-hidden', overlayActive ? 'false' : 'true');
    $('dir-overlay').setAttribute('aria-label', p === 'brief' ? 'Operation brief' : p === 'commit' ? 'Review and commit orders' : p === 'aar' ? 'After-action review' : 'Operation');
    isolateForOverlay(overlayActive);
    $('dir-dock').style.display = p === 'plan' ? 'block' : 'none';
    $('dir-feed').style.display = (p === 'watch') ? 'block' : 'none';
    $('dir-launch').style.display = p === 'idle' ? '' : 'none';
    document.body.classList.toggle('operation-active', p !== 'idle');
    if (p === 'brief' || p === 'commit' || p === 'aar') {
      setTimeout(function () { try { $('dir-wrap').focus(); } catch (e) {} }, 0);
    }
  }

  function tutorialCoach(step, title, body, actionHtml) {
    if (!op.tutorial) return '';
    return '<div class="dir-coach" role="status"><span class="step">COMPUTER COACH · STEP ' + esc(step) + ' OF 5</span>' +
      '<div><b>' + esc(title) + '</b><p>' + esc(body) + '</p>' + (actionHtml || '') + '</div></div>';
  }

  // ---- BRIEF ------------------------------------------------------------------------
  var briefOpts = { turnLimit: 8, redDiff: 'hard', roeId: 'denial', variantId: null };

  // ---- CO-005 C5: operation variants (in-place graph swap, the import pipeline's idiom;
  //      the shell binds `data` to the active graph by reference, so we mutate contents) --
  function variantRegistry() { return (window.StrikeSimVariants && typeof window.StrikeSimVariants === 'object') ? window.StrikeSimVariants : {}; }

  function swapGraphInPlace(nodes, links) {
    var g = window.AppState && AppState.activeGraph ? AppState.activeGraph() : null;
    if (!g) return false;
    g.nodes.length = 0; Array.prototype.push.apply(g.nodes, nodes);
    g.links.length = 0; Array.prototype.push.apply(g.links, links);
    try { if (typeof window.refreshGraph === 'function') window.refreshGraph(); } catch (e) {}
    try { if (typeof window.refreshMapMarkers === 'function') window.refreshMapMarkers(); } catch (e) {}
    return true;
  }

  function selectVariant(id) {
    var deep = function (v) { return JSON.parse(JSON.stringify(v)); };
    if (!id || id === 'default') {                       // restore the boot scenario
      if (op.baseGraphBackup) {
        swapGraphInPlace(op.baseGraphBackup.nodes, op.baseGraphBackup.links);
        op.baseGraphBackup = null;
      }
      op.variantContext = null; op.variantConfig = null; briefOpts.variantId = null;
      briefOpts.turnLimit = 8;
      return true;
    }
    var v = variantRegistry()[id];
    if (!v || !v.nodes || !v.nodes.length) return false;
    if (!op.baseGraphBackup) {                           // save the boot graph once
      var g = window.AppState && AppState.activeGraph ? AppState.activeGraph() : null;
      if (!g) return false;
      op.baseGraphBackup = { nodes: deep(g.nodes), links: deep(g.links) };
    }
    swapGraphInPlace(deep(v.nodes), deep(v.links || []));
    op.variantContext = v.context || null;
    op.variantConfig = v.matchConfig || null;
    briefOpts.variantId = id;
    if (v.matchConfig && v.matchConfig.turnLimit) briefOpts.turnLimit = v.matchConfig.turnLimit;
    return true;
  }

  function restoreBaseScenario() { try { selectVariant('default'); } catch (e) {} }

  function start() { openOperation(false); }

  function startTutorial() { openOperation(true); }

  function openOperation(tutorial) {
    if (!GM) return;
    if (!startReady()) {
      try { if (typeof window.showToast === 'function') window.showToast('The bundled scenario is still loading. Try Operation again in a moment.', 'warn', 5000); } catch (e) {}
      return;
    }
    if (GM.isActive()) GM.endMatch();
    restoreBaseScenario();
    op.tutorial = !!tutorial;
    briefOpts.turnLimit = op.tutorial ? 2 : 8;
    briefOpts.redDiff = op.tutorial ? 'easy' : 'hard';
    briefOpts.roeId = 'denial';
    briefOpts.variantId = null;
    op.returnFocus = $('dir-launch');
    GM.init({ onResolved: function () {}, onState: function () {} });   // Director drives; legacy HUD stays dormant
    // CO-007 S3: challenge intake. A valid #op= payload (decoded fail-silent by share.js,
    // consumed exactly once) briefs the ISSUER'S world: their variant, their chips, their
    // seed. Anything unavailable degrades to a normal brief with one comms line — never
    // an error surface (I-5).
    op.challenge = op.tutorial ? null : ((window.ShareModule && typeof ShareModule.consumePending === 'function' && ShareModule.consumePending()) || null);
    if (op.challenge) {
      var ch = op.challenge;
      if (!selectVariant(ch.variantId === 'default' ? 'default' : ch.variantId)) {
        op.challenge = null;
        comms('JOC', 'CHALLENGE LINK REFERENCES AN UNAVAILABLE OPERATION VARIANT — STANDARD BRIEF LOADED', 'warn');
      } else {
        briefOpts.turnLimit = ch.cfg.turnLimit;
        briefOpts.redDiff = ch.cfg.redDiff;
        briefOpts.roeId = ch.cfg.roeId;
        try {
          var liveFp = GM._internal.computeFingerprint(AppState.activeGraph());
          if (ch.fp && !GM._internal.fingerprintsMatch(ch.fp, liveFp)) {
            comms('JOC', 'SCENARIO CONTENT HAS CHANGED SINCE THIS LINK WAS MINTED — SAME SEED, EXACT REPLAY NOT GUARANTEED', 'warn');
          }
        } catch (e) { /* diagnostics only */ }
      }
    }
    newBriefMatch();
    setPhase('brief');
    renderBrief();
    // CO-006 P2: the brief arrives as a cinematic — letterbox, operation stamp, typed
    // situation paragraph, brief drone bed. All copy is the real scenario's.
    var opTitle = scenarioContext().title || 'OPERATION BRIEF';
    cine('briefCinematic', { title: String(opTitle).split('—')[0].trim().toUpperCase() });
    comms('JOC', opAddr() + (op.tutorial ? 'TUTORIAL OPEN — COMPUTER COACH ONLINE' : 'OPERATION OPEN — ' + String(opTitle).toUpperCase()) + ' · SEED ' + GMseed());
    if (op.challenge) {
      comms('JOC', 'CHALLENGE ACCEPTED — ' + (op.challenge.callsign ? String(op.challenge.callsign).toUpperCase() + '’S' : 'A RIVAL') + ' WORLD · SEED ' + op.challenge.seed + ' · NEUTRAL HABIT MODEL IN EFFECT');
    }
    evt(op.tutorial ? 'Two-turn tutorial started — computer coach online.' : 'Operation started — briefing.');
  }

  function variantLabel(id) {
    if (!id || id === 'default') return 'CROSS-STRAIT INVASION';
    var v = variantRegistry()[id];
    return (v && v.metadata && v.metadata.title ? String(v.metadata.title).split('—')[0].trim() : String(id)).toUpperCase();
  }

  function newBriefMatch() {
    // CO-005 C5: the active variant's authored matchConfig shapes the match — turn
    // budget, lodgment clock, doctrine prior, and strategic overrides. The player's
    // BRIEF chips still win for turn budget and difficulty.
    var mc = op.variantConfig || {};
    // CO-007 S3: challenge intake plays the issuer's exact world — forced seed, NEUTRAL
    // player model (I-4: fair ground; Red exploits nobody's career habits). A normal op
    // stashes the PRE-match model so a replay payload can reproduce Red exactly.
    op.startModel = (op.challenge || op.tutorial) ? null : readPlayerModel();
    GM.newMatch({
      turnLimit: briefOpts.turnLimit,
      lodgmentRequiredTurns: mc.lodgmentRequiredTurns,
      doctrinePrior: mc.doctrinePrior,
      strategic: mc.strategic,
      logistics: mc.logistics,
      seed: op.challenge ? op.challenge.seed : (op.tutorial ? 204002 : undefined),
      // CO-005 A6: Red carries the player's career habit model into the new match
      // (or the neutral model on a challenge — normalizePlayerModel(null) is empty).
      playerModel: op.startModel,
      control: { blue: 'human', red: 'ai' },
      difficulty: { blue: 'hard', red: briefOpts.redDiff },
      roeId: briefOpts.roeId
    });
    op.forecasts = {}; op.actuals = {}; op.judgments = {}; op.standingForecasts = [];
    op.scoredEntries = []; op.intervalScores = []; op.commitCard = null; op.standingCarry = null;
    op.record = null; op.aar = null; op.aarExported = false; op.targetId = null;
    op.panelState = null; op.focusMode = true;
    op.lastPostureShown = null;   // CO-006 P2: comms-floor posterior tracking (display only)
    op.lastTempoShown = null;     // CO-006 P3: tempo-loss motif tracking (display only)
  }

  function objList(st, side) {
    return (st.objectiveIds[side] || []).map(function (id) {
      var n = GM.boardNode(id);
      return n ? '<div class="dir-obj"><span>' + esc(n.name) + '</span><span class="v">' + esc(n.difficulty || '') + ' · val ' + nodeVal(n) + '</span></div>' : '';
    }).join('');
  }

  function blueJointMixText() {
    var graph = window.AppState && AppState.activeGraph ? AppState.activeGraph() : { nodes: [] };
    var counts = {};
    (graph.nodes || []).filter(function (node) { return node.team === 'blue' && node.status !== 'Neutralized'; })
      .forEach(function (node) {
        var owner = node.serviceOwner || node.component || 'Unassigned';
        counts[owner] = (counts[owner] || 0) + 1;
      });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); })
      .map(function (owner) { return esc(owner) + ' ' + counts[owner]; }).join(' · ');
  }

  function renderBrief() {
    var st = GM.getState();
    if (!st) return;
    var posture = st.redMind && st.redMind.belief || { attrition: 0.5, decapitation: 0.3, denial: 0.2 };
    var postureText = 'attrition ' + Math.round((posture.attrition || 0) * 100) +
      ' / decapitation ' + Math.round((posture.decapitation || 0) * 100) +
      ' / denial ' + Math.round((posture.denial || 0) * 100);
    var strategic = st.strategic || { escalation: { value: 0 }, allies: {}, allyRules: {}, roe: {} };
    var blueLogistics = st.logistics && st.logistics.sides && st.logistics.sides.blue || null;
    var strategicOptions = GM.strategicOptions();
    var roeOptions = strategicOptions.roe || {};
    var allyThresholds = Object.keys(strategic.allyRules || {}).map(function (id) {
      var rule = strategic.allyRules[id], track = strategic.allies[id] || {};
      return '<div class="dir-stat"><span>' + esc(rule.id || id) + ' posture</span><b>' + (track.active ? 'ACTIVE' : 'WITHHELD') +
        ' · entry E' + Number(rule.entryThreshold).toFixed(1) + ' (' + Math.round(Number(rule.entryProbability || 0) * 100) + '% crossing draw)</b></div>';
    }).join('');
    var scen = (window.AppState && AppState.active && AppState.active()) || null;
    var ctx = scenarioContext();
    var title = ctx.title || (scen && scen.name) || 'INDO-PACIFIC SCENARIO';
    var hasNarrative = !!ctx.title;
    var turnDays = Number(ctx.turnDurationDays) || 3.5;
    var horizon = Math.round(st.cfg.turnLimit * turnDays * 10) / 10;
    var sourceLinks = (ctx.sources || []).map(function (s) {
      var url = safeHttpUrl(s.url);
      return url ? '<li><a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.label || url) + '</a></li>' : '';
    }).join('');
    var legend = (ctx.evidenceLegend || []).map(function (x) {
      return '<li><b>' + esc(x.key) + '</b> — ' + esc(x.meaning) + '</li>';
    }).join('');
    $('dir-wrap').innerHTML =
      '<div class="dir-kicker">OPERATION BRIEF · ' + esc(title) + '</div>' +
      '<h1 class="dir-h1">Deny the lodgment before the window closes.</h1>' +
      '<div class="dir-sub">You are the Blue Joint Force operational planner. ' + st.cfg.turnLimit + ' turns / ' + horizon + ' notional days of simultaneous commitment against a doctrine-driven Red.</div>' +
      tutorialCoach('1', 'I’ll guide the next two turns.', 'Turn 1 teaches a strike, forecast, and resolution. Turn 2 adds a logistics allocation decision. Follow the cyan coach card; the expert tools remain available after the tutorial.') +

      '<div class="dir-card">' +
      '<div class="dir-badges"><span class="dir-badge">' + esc(ctx.classification || 'SCENARIO DATA') + '</span>' +
      '<span class="dir-badge notional">' + (hasNarrative ? 'OPEN-SOURCE BASELINE + 2040 NOTIONAL' : 'IMPORTED SCENARIO · VERIFY ASSUMPTIONS') + '</span><span class="dir-badge">' + esc(ctx.date || 'DATE NOT PROVIDED') + '</span></div>' +
      '<p class="dir-situation">' + esc(ctx.background || 'This imported scenario does not include an operation narrative. Review its force data and assumptions before using the adjudication.') + ' <b>' + esc(ctx.initiatingEvent || '') + '</b></p>' +
      '<div class="dir-context"><div><span>BLUE ROLE</span>' + esc(ctx.blueRole || 'Not supplied by the imported scenario.') + '</div><div><span>RED OBJECTIVE</span>' + esc(ctx.redObjective || 'Not supplied by the imported scenario.') + '</div>' +
      '<div><span>HARD HORIZON</span>' + horizon + ' notional days at ' + turnDays + ' days per turn.</div><div><span>VICTORY LOGIC</span>' + esc(ctx.victory || 'Not supplied; the default game arbiter will apply.') + '</div></div>' +
      '<div class="dir-question"><span style="display:block;color:#70c9e9;font:700 10px Oswald;letter-spacing:.16em;margin-bottom:4px">YOUR DECISION</span>' + esc(ctx.decisionQuestion || 'What decision is this imported force network meant to inform?') + '</div>' +
      '<details class="dir-sources"><summary>Scenario assumptions, evidence legend &amp; public anchors</summary>' +
      '<p>' + esc(ctx.boundary || '') + '</p><ul>' + legend + sourceLinks + '</ul></details></div>' +

      '<div class="dir-grid">' +
      '<div class="dir-card"><h3>COMMANDER’S INTENT</h3>' +
      '<div class="dir-stat"><span>Halt the crossing</span><b>drive Red throughput below 30%</b></div>' +
      '<div class="dir-stat"><span>Prevent consolidation</span><b>keep lodgment below 100%</b></div>' +
      '<div class="dir-stat"><span>Hold your key objectives</span><b>lose ≤' + Math.floor((st.objectives.blue.total || 8) * OBJ_LOSS_FRAC) + ' of ' + (st.objectives.blue.total || 8) + '</b></div>' +
      '<div class="dir-stat"><span>Guard your tempo</span><b>C2 &amp; logistics feed your AP</b></div>' +
      (blueLogistics ? '<div class="dir-stat"><span>Sustain the operation</span><b>fuel ' + Math.round(blueLogistics.stocks.fuel) +
        ' · ammunition ' + Math.round(blueLogistics.stocks.ammunition) + ' · maintenance ' + Math.round(blueLogistics.stocks.maintenance) +
        ' · personnel ' + Math.round(blueLogistics.stocks.personnel) + '</b></div>' : '') +
      '<div class="dir-stat"><span>Decision budget</span><b>' + st.ap.blue + ' orders / turn (tempo-driven)</b></div>' +
      '<div class="dir-stat"><span>Escalation ladder</span><b>E ' + Number(strategic.escalation.value || 0).toFixed(1) + ' / 10 · horizontal + vertical impulses explicit</b></div>' +
      '</div>' +
      '<div class="dir-card"><h3>FORCE BALANCE</h3>' +
      '<div class="dir-stat"><span>Blue Joint Force</span><b>' + st.alive.blue + ' enabled nodes · AP ' + st.ap.blue + '</b></div>' +
      '<div class="dir-note" style="margin:7px 0 9px">' + blueJointMixText() + '</div>' +
      '<div class="dir-stat"><span>Red force</span><b>' + st.alive.red + ' nodes · AP ' + st.ap.red + '</b></div>' +
      '<div class="dir-stat"><span>Blue tempo assets</span><b>' + st.tempo.blue.c2 + ' C2 · ' + st.tempo.blue.logi + ' LOG</b></div>' +
      '<div class="dir-stat"><span>Red tempo assets</span><b>' + st.tempo.red.c2 + ' C2 · ' + st.tempo.red.logi + ' LOG</b></div>' +
      (blueLogistics ? '<div class="dir-stat"><span>Blue distribution network</span><b>' + blueLogistics.routes.length +
        ' routes · ' + blueLogistics.hubs.length + ' port/airfield hubs · DDIL ' + Math.round(blueLogistics.ddil * 100) + '%</b></div>' : '') +
      '<div class="dir-note" style="margin-top:8px"><b>INTEL ASSESSMENT — PLA POSTURE:</b> ' + esc(postureText) + '. This is the disclosed prior, not Red’s hidden draw.</div>' +
      // CO-006 P2: the same disclosed prior, staged as animated doctrine bars (mockup grammar).
      '<div class="dir-prior" aria-hidden="true">' + [['attrition', 'a'], ['decapitation', 'd'], ['denial', 'n']].map(function (k) {
        var v = Math.round((posture[k[0]] || 0) * 100);
        return '<div class="pr"><span class="lbl">' + k[0] + '</span><span class="track"><i class="fill ' + k[1] + '" style="--w:' + v + '%"></i></span><b>' + v + '</b></div>';
      }).join('') + '</div>' +
      allyThresholds +
      '<div class="dir-note" style="margin-top:8px">Strikes, hardens, repairs, and feints each cost one order; one decoy emission is free. Every order also consumes typed logistics. Allocate fuel, ammunition, maintenance, personnel, routes, prepositioning, and DDIL resilience before commitment. A node killed this turn still acts — both sides committed first.</div>' +
      '</div>' +
      '</div>' +

      '<div class="dir-grid">' +
      '<div class="dir-card"><h3>YOUR KEY OBJECTIVES (DEFEND)</h3>' + objList(st, 'blue') + '</div>' +
      '<div class="dir-card"><h3>RED KEY SYSTEMS (DISRUPT)</h3>' + objList(st, 'red') + '</div>' +
      '</div>' +

      // CO-007 S3: the challenge banner — the issuer's terms, pinned. Changing any chip
      // below voids the challenge (announced on the comms floor, never an error).
      (op.challenge ?
        '<div class="dir-card"><h3>CHALLENGE ACCEPTED — SAME WORLD, FAIR GROUND</h3>' +
        '<div class="dir-stat"><span>Issued by</span><b>' + esc(op.challenge.callsign ? String(op.challenge.callsign).toUpperCase() : 'AN UNNAMED OPERATOR') + '</b></div>' +
        '<div class="dir-stat"><span>World seed</span><b>' + esc(String(op.challenge.seed)) + ' (forced)</b></div>' +
        (op.challenge.claim && op.challenge.claim.winner ?
          '<div class="dir-stat"><span>Their result</span><b>' + esc(String(op.challenge.claim.winner).toUpperCase()) +
          (op.challenge.claim.turns ? ' IN ' + op.challenge.claim.turns + ' TURNS' : '') +
          (op.challenge.claim.bss != null ? ' · BSS ' + (op.challenge.claim.bss >= 0 ? '+' : '') + op.challenge.claim.bss.toFixed(3) : '') + '</b></div>' : '') +
        '<div class="dir-note" style="margin-top:8px">Red faces you with a NEUTRAL habit model — neither your career tells nor theirs. Their claim is unverified until it survives the replay verifier. Changing any parameter below voids the challenge.</div></div>' : '') +

      (op.tutorial ?
        '<div class="dir-card"><h3>TUTORIAL PARAMETERS · LOCKED</h3><div class="dir-badges"><span class="dir-badge">2 TURNS</span><span class="dir-badge">TRAINING RED</span><span class="dir-badge">DENIAL ROE</span><span class="dir-badge">FIXED SEED 204002</span></div>' +
        '<div class="dir-note">The computer has fixed the scenario so every new player receives the same short, replayable lesson.</div></div>' :
      '<div class="dir-card"><h3>OPERATION PARAMETERS</h3>' +
      (Object.keys(variantRegistry()).length ?
        '<div class="row" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px"><span class="dir-note">Operation</span><span class="dir-chips">' +
        '<button type="button" class="dir-chip' + (!briefOpts.variantId ? ' on' : '') + '" aria-pressed="' + (!briefOpts.variantId) + '" data-variant="default">CROSS-STRAIT INVASION</button>' +
        Object.keys(variantRegistry()).map(function (id) {
          var v = variantRegistry()[id];
          var label = (v.metadata && v.metadata.title ? String(v.metadata.title).split('—')[0].trim() : id).toUpperCase();
          return '<button type="button" class="dir-chip' + (briefOpts.variantId === id ? ' on' : '') + '" aria-pressed="' + (briefOpts.variantId === id) + '" data-variant="' + esc(id) + '">' + esc(label) + '</button>';
        }).join('') +
        '</span><div class="dir-note">Variants swap the force networks and the clock. The lowest rung of the ladder is a different war.</div></div>' : '') +
      '<div class="row" style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">' +
      '<span class="dir-note">Turn budget</span><span class="dir-chips">' +
      [6, 8, 10].map(function (n) { return '<button type="button" class="dir-chip' + (briefOpts.turnLimit === n ? ' on' : '') + '" aria-pressed="' + (briefOpts.turnLimit === n) + '" data-turns="' + n + '">' + n + ' TURNS</button>'; }).join('') +
      '</span><span class="dir-note">Red doctrine strength</span><span class="dir-chips">' +
      ['easy', 'hard', 'elite'].map(function (d) { return '<button type="button" class="dir-chip' + (briefOpts.redDiff === d ? ' on' : '') + '" aria-pressed="' + (briefOpts.redDiff === d) + '" data-diff="' + d + '">' + (d === 'hard' ? 'CONTESTED' : d === 'elite' ? 'ELITE' : 'TRAINING') + '</button>'; }).join('') +
      '</span></div><div class="row" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px"><span class="dir-note">Declared ROE commitment</span><span class="dir-chips">' +
      Object.keys(roeOptions).map(function (id) { var roe = roeOptions[id]; return '<button type="button" class="dir-chip' + (briefOpts.roeId === id ? ' on' : '') + '" aria-pressed="' + (briefOpts.roeId === id) + '" data-roe="' + esc(id) + '" title="' + esc(roe.description) + '">' + esc(roe.label) + '</button>'; }).join('') +
      '</span><div class="dir-note">Enforced in the UI, Red planner, every ghost world, and the resolver. Red knows the commitment.</div></div></div>') +

      '<div class="dir-actions"><span class="dir-note">Seed ' + esc(String(GMseed())) + ' — this operation is exactly replayable.</span>' +
      '<button class="dir-btn" data-act="exit">EXIT</button>' +
      '<button class="dir-btn primary" data-act="begin">' + (op.tutorial ? 'START TUTORIAL — TURN 1 →' : 'BEGIN PLANNING →') + '</button></div>';
  }

  function GMseed() { var s = GM.serialize(); return s ? s.seed : '—'; }

  // ---- objective overlay (key terrain rings on the map) -------------------------------
  var objLayer = null;
  function dirPacLon(lon) { return (lon != null && lon < -25) ? lon + 360 : lon; }   // mirror of map.js pacLon/PAC_CUT

  function hideObjectiveOverlay() {
    if (objLayer) { try { objLayer.remove(); } catch (e) {} objLayer = null; }
  }

  // Rings on both sides' key objectives: solid blue = defend, dashed red = attack,
  // dimmed = already down. Re-drawn after every resolution so state stays honest.
  function showObjectiveOverlay(retry) {
    hideObjectiveOverlay();
    if (op.phase === 'idle' || !window.L || !window.MapModule || !GM.isActive()) return;
    var m = MapModule.getMap();
    if (!m) {   // map may still be initializing right after the view switch
      if (!retry) setTimeout(function () { showObjectiveOverlay(true); }, 600);
      return;
    }
    var st = GM.getState();
    if (!st) return;
    var byId = {};
    (AppState.activeGraph().nodes || []).forEach(function (n) { byId[n.id] = n; });
    objLayer = L.layerGroup();
    ['blue', 'red'].forEach(function (side) {
      (st.objectiveIds[side] || []).forEach(function (id) {
        var n = byId[id];
        if (!n || n.lat == null || n.lon == null) return;
        var b = GM.boardNode(id);
        var cls = 'dir-objring ' + (side === 'blue' ? 'b' : 'r') + (b && !b.alive ? ' down' : '');
        var icon = L.divIcon({ className: '', html: '<span class="' + cls + '"></span>', iconSize: [34, 34], iconAnchor: [17, 17] });
        objLayer.addLayer(L.marker([n.lat, dirPacLon(n.lon)], { icon: icon, pane: 'ringsPane', interactive: false, keyboard: false }));
      });
    });
    objLayer.addTo(m);
  }

  // ---- PLAN (command dock) -----------------------------------------------------------
  function beginPlanning() {
    if (!op.panelState) enterFocusMode();
    GM.preparePlan();
    setPhase('plan');
    forceMapView();
    renderDock();
    focusPlanControl();
    startSelPoll();
    showObjectiveOverlay();
    var st = GM.getState();
    cine('planCinematic');   // CO-006 P2: plan bed; the comms floor returns from the war film
    comms('J3', opAddr() + 'PLANNING WINDOW OPEN — TURN ' + st.turn + '/' + st.cfg.turnLimit + ' · AP ' + st.ap.blue);
    evt('Planning phase — turn ' + st.turn + '.');
  }

  function startSelPoll() {
    stopSelPoll();
    op.selPoll = setInterval(function () {
      if (op.phase !== 'plan') return;
      var n = curSel();
      var id = n && n.id;
      if (!id || id === op.lastSelId) return;
      op.lastSelId = id;
      var b = GM.boardNode(id);
      if (!b || !b.alive || b.active === false) return;
      if (b.team === 'red') { op.kind = 'strike'; op.targetId = id; }
      else if (b.team === 'blue') { op.kind = (b.health < (b.healthMax || 100)) ? 'repair' : 'harden'; op.targetId = id; }
      renderDock();
    }, 450);
  }
  function stopSelPoll() { if (op.selPoll) { clearInterval(op.selPoll); op.selPoll = null; } }

  function targetOptions() {
    var st = GM.getState();
    var s = GM.serialize();
    var ids = [];
    for (var id in s.health) if (s.health[id].a) ids.push(id);
    var pool = ids.map(function (id) { return GM.boardNode(id); }).filter(function (b) { return b && b.active !== false; });
    if (op.kind === 'strike' || op.kind === 'feint' || op.kind === 'decoy') pool = pool.filter(function (b) { return b.team === 'red'; }).sort(function (a, b) { return nodeVal(b) - nodeVal(a); });
    else {
      pool = pool.filter(function (b) { return b.team === 'blue'; });
      if (op.kind === 'repair') pool = pool.filter(function (b) { return b.health < (b.healthMax || 100); }).sort(function (a, b) { return a.health - b.health; });
      else pool.sort(function (a, b) { return nodeVal(b) - nodeVal(a); });
    }
    if (op.tutorial && op.kind === 'strike') {
      pool = pool.filter(function (b) {
        return GM.methodKeys().some(function (key) { return GM.canStrike('blue', b.id, key).ok; });
      });
    }
    var objSet = {};
    (st.objectiveIds.blue || []).concat(st.objectiveIds.red || []).forEach(function (i) { objSet[i] = true; });
    // default the working target to the top of the pool so the select and the recon
    // readout agree from the very first render
    if ((!op.targetId || !pool.some(function (b) { return b.id === op.targetId; })) && pool.length) op.targetId = pool[0].id;
    return pool.map(function (b) {
      var tag = objSet[b.id] ? '★ ' : '';
      var extra = op.kind === 'repair' ? (' · ' + Math.round(b.health) + 'hp') : (' · ' + esc(b.difficulty || ''));
      return '<option value="' + esc(b.id) + '"' + (b.id === op.targetId ? ' selected' : '') + '>' + tag + esc(b.name) + ' (val ' + nodeVal(b) + extra + ')</option>';
    }).join('');
  }

  // "What dies if this dies" — engine-honest recon for the selected strike target.
  // Cascade math mirrors game.js: dmg = cascScore × importance × 0.25 × affinity(0.8–1.8),
  // applied to each linked neighbor on a kill — so it is shown as a range, per node.
  function reconHtml(tgt) {
    if (!tgt || op.kind !== 'strike') return '';
    var st = GM.getState();
    var nbrs = {};
    (AppState.activeGraph().links || []).forEach(function (l) {
      var s = (l.source && l.source.id) || l.source, t = (l.target && l.target.id) || l.target;
      if (s === tgt.id) nbrs[t] = 1; else if (t === tgt.id) nbrs[s] = 1;
    });
    var aliveN = Object.keys(nbrs).map(function (id) { return GM.boardNode(id); })
      .filter(function (b) { return b && b.alive; }).length;
    var base = (tgt.casc || tgt.cascScore || 1) * (tgt.importance || 1) * 0.25;
    var lo = Math.round(base * 0.8), hi = Math.round(base * 1.8);
    var isTempo = /command|c2|logistic|relay|comm/i.test((tgt.type || '') + ' ' + (tgt.subsystem || ''));
    var isObj = (st.objectiveIds.red || []).concat(st.objectiveIds.blue || []).indexOf(tgt.id) >= 0;
    var bits = ['DIF <b>' + esc(tgt.difficulty || '—') + '</b>',
      'VULN <b>' + esc((tgt.vulns || []).join('/') || 'none') + '</b>'];
    if (isObj) bits.push('<b>★ KEY OBJECTIVE</b>');
    if (isTempo) bits.push('<b>TEMPO ASSET</b> — killing it drains ' + (tgt.team === 'red' ? 'Red' : 'Blue') + ' orders');
    bits.push('ON KILL: cascade hits <b>' + aliveN + '</b> linked node' + (aliveN === 1 ? '' : 's') +
      (aliveN ? ' for <b>~' + lo + '–' + hi + '</b> dmg each' : ''));
    return '<div class="row dir-recon">RECON · ' + esc(tgt.name.slice(0, 40)) + ' — ' + bits.join(' · ') + '</div>';
  }

  function intelAssessmentHtml(st) {
    var b = st.redMind && st.redMind.belief || { attrition: 0.5, decapitation: 0.3, denial: 0.2 };
    var a = Math.round((b.attrition || 0) * 100), d = Math.round((b.decapitation || 0) * 100), n = 100 - a - d;
    return '<div class="row"><div class="dir-intel"><b>INTEL ASSESSMENT</b>' +
      '<div class="track" aria-label="Red doctrine posterior"><span class="a" style="width:' + a + '%"></span><span class="d" style="width:' + d + '%"></span><span class="n" style="width:' + n + '%"></span></div>' +
      '<span>ATTR ' + a + ' · DECAP ' + d + ' · DENIAL ' + n + '</span><span class="dir-note">posterior, never truth</span></div></div>';
  }

  function indicatorChannelHtml(st) {
    var lines = st.strategic && st.strategic.indicators && st.strategic.indicators.current || [];
    if (!lines.length) return '<div class="row"><span class="dir-note"><b>INDICATORS:</b> reporting unresolved.</span></div>';
    return '<div class="row" style="align-items:flex-start"><span class="stat">INDICATORS</span><span class="dir-note">' + lines.map(function (line) {
      return (line.assessedDeceptive ? '⚠ ASSESSED DECEPTIVE · ' : '• ') + esc(line.text);
    }).join('<br>') + '</span></div>';
  }

  function tutorialPlanCoach(st, logi) {
    if (!op.tutorial) return '';
    var queued = st.orders.blue.length > 0;
    var allocationChanged = !!(logi && logi.decision && logi.decision.id !== 'balanced');
    if (st.turn === 1) {
      return tutorialCoach('2', queued ? 'Order queued. Now review the forecast.' : 'Queue one strike.',
        queued ? 'The target and delivery method are locked into your draft plan. Press REVIEW FORECAST to see the commit card.' :
          'I selected a high-value authorized Red system and a valid delivery method. Keep BAL logistics for this turn, then press + QUEUE ORDER.');
    }
    if (!allocationChanged) {
      return tutorialCoach('2', 'Make the sustainment decision first.',
        'The first turn consumed stocks and may have disrupted routes. Choose a new logistics posture—SURGE, REPAIR, REROUTE, PREPO, or DDIL—to decide what the network prioritizes.');
    }
    return tutorialCoach('2', queued ? 'Second-turn plan ready.' : 'Allocation set. Queue one more strike.',
      queued ? 'You changed the logistics allocation and queued an order. Press REVIEW FORECAST to commit the final tutorial turn.' :
        'Notice how the allocation changes readiness priorities. The computer kept a valid target and method selected; press + QUEUE ORDER.');
  }

  function renderDock() {
    var st = GM.getState();
    if (!st) return;
    var apMax = st.ap.blue, apLeft = st.apLeft.blue;
    var logi = st.logistics && st.logistics.sides && st.logistics.sides.blue || null;
    var logiOptions = GM.logisticsOptions ? GM.logisticsOptions() : { presets: [] };
    var lastDenial = (st.denialHistory || []).slice(-1)[0] || null;
    var escalation = st.strategic && st.strategic.escalation ? Number(st.strategic.escalation.value || 0) : 0;
    var operationalStatus = 'E <b>' + escalation.toFixed(1) + '</b> · ' + (lastDenial ? 'RED THR <b>' + Math.round(lastDenial.throughput * 100) + '%</b> · ' : '') +
      'LODG <b>' + Math.round(((st.lodgment && st.lodgment.value) || 0) * 100) + '%</b>';
    var pips = '';
    for (var i = 0; i < apMax; i++) pips += '<i class="' + (i < apLeft ? 'full' : '') + '"></i>';
    var methods = GM.methods();
    var optsHtml = targetOptions();   // resolves op.targetId to the pool default first
    var tgt = op.targetId ? GM.boardNode(op.targetId) : null;
    if (op.tutorial && tgt && !GM.canStrike('blue', tgt.id, op.methodKey).ok) {
      var tutorialMethod = GM.methodKeys().filter(function (key) { return GM.canStrike('blue', tgt.id, key).ok; })[0];
      if (tutorialMethod) op.methodKey = tutorialMethod;
    }
    var methodChips = GM.methodKeys().map(function (k) {
      var m = methods[k];
      var vulnHit = tgt && (tgt.vulns || []).indexOf(m.vuln) >= 0;
      var hint = Math.round(m.baseProb * 100) + '%' + (vulnHit ? ' ▲vuln' : '');
      var avail = tgt ? GM.canStrike('blue', tgt.id, k) : { ok: false, reason: 'no-target' };
      var why = avail.ok ? ('Base hit ' + hint) : explainInvalid(avail.reason);
      return '<button type="button" class="dir-chip' + (op.methodKey === k ? ' on' : '') + '" aria-pressed="' + (op.methodKey === k) + '" data-method="' + k + '" title="' + esc(why) + '"' + (avail.ok ? '' : ' disabled') + '>' + m.short + ' ' + hint + '</button>';
    }).join('');
    var proposed = tgt ? { kind: op.kind, targetId: tgt.id } : null;
    if (proposed && op.kind === 'strike') proposed.methodKey = op.methodKey;
    var validity = proposed ? GM.validOrder('blue', proposed) : { ok: false, reason: 'no-target' };
    var tutorialNeedsAllocation = !!(op.tutorial && st.turn === 2 && logi && logi.decision && logi.decision.id === 'balanced');
    var tutorialHasOrder = !!(op.tutorial && st.orders.blue.length);
    var queueDisabled = !validity.ok || tutorialNeedsAllocation || tutorialHasOrder;
    var validationNote = validity.ok ? '' : '<span class="dir-note" style="color:#e8ad77">' + esc(explainInvalid(validity.reason)) + '</span>';
    var queue = st.orders.blue.map(function (o, i) {
      var n = GM.boardNode(o.targetId);
      var src = o.sourceId ? GM.boardNode(o.sourceId) : null;
      var cls = o.kind === 'harden' ? 'h' : (o.kind === 'repair' ? 'r' : '');
      var lbl = o.kind === 'strike' ? (methods[o.methodKey] ? methods[o.methodKey].short : 'KE') + (src ? ' via ' + esc(src.name.slice(0, 28)) : '') + ' → ' : (o.kind.toUpperCase() + ' ');
      return '<span class="oq ' + cls + '">' + lbl + esc(n ? n.name.slice(0, 34) : o.targetId) + '<button type="button" class="remove" data-rm="' + i + '" aria-label="Remove order" title="Remove">✕</button></span>';
    }).join('') || '<span class="dir-note">No orders queued — click a node on the map or pick a target below.</span>';

    $('dir-dock').innerHTML =
      tutorialPlanCoach(st, logi) +
      '<div class="row">' +
      '<span class="stat">TURN <b>' + st.turn + '/' + st.cfg.turnLimit + '</b></span>' +
      '<span class="stat ap">ORDERS ' + pips + '</span>' +
      '<span class="stat">TEMPO <b>' + Math.round(st.tempo.blue.frac * 100) + '%</b></span>' +
      (logi ? '<span class="stat">SUPPLY <b>' + Math.round(logi.readiness * 100) + '%</b> · FLOW <b>' +
        Math.round(logi.flow * 100) + '%</b> · DDIL <b>' + Math.round(logi.ddil * 100) + '%</b></span>' : '') +
      '<span class="stat">OBJ <b>' + st.objectives.blue.held + '/' + st.objectives.blue.total + ' held</b></span>' +
      '<span class="stat">RED OBJ <b>' + st.objectives.red.held + '/' + st.objectives.red.total + ' standing</b></span>' +
      '<span class="spacer"></span>' +
      '<span class="stat">' + operationalStatus + '</span>' +
      '</div>' +
      intelAssessmentHtml(st) +
      indicatorChannelHtml(st) +
      (logi ? '<div class="row"><span class="stat">LOGISTICS</span><span class="dir-chips">' +
        (logiOptions.presets || []).filter(function (p) { return !op.tutorial || st.turn !== 1 || p.id === 'balanced'; }).map(function (p) {
          return '<button type="button" class="dir-chip' + (logi.decision && logi.decision.id === p.id ? ' on' : '') +
            '" aria-pressed="' + !!(logi.decision && logi.decision.id === p.id) + '" data-logistics="' + esc(p.id) +
            '" title="' + esc(p.note) + '"' + (op.tutorial && st.turn === 1 ? ' disabled' : '') + '>' + esc(p.short) + '</button>';
        }).join('') + '</span><span class="dir-note">FUEL ' + Math.round(logi.stocks.fuel) + ' · AMMO ' +
        Math.round(logi.stocks.ammunition) + ' · MAINT ' + Math.round(logi.stocks.maintenance) + ' · PERS ' +
        Math.round(logi.stocks.personnel) + ' · PREPO ' + Math.round(logi.prepositioning) + '</span></div>' : '') +
      '<div class="row">' +
      '<span class="dir-chips">' +
      (op.tutorial ? ['strike'] : ['strike', 'harden', 'repair', 'feint', 'decoy']).map(function (k) { return '<button type="button" class="dir-chip' + (op.kind === k ? ' on' : '') + '" aria-pressed="' + (op.kind === k) + '" data-kind="' + k + '">' + k.toUpperCase() + (k === 'decoy' ? ' · 0 AP' : '') + '</button>'; }).join('') +
      '</span>' +
      '<label class="stat" for="dir-target">TARGET</label><select id="dir-target" aria-label="Order target">' + (optsHtml || '<option value="">— no valid targets —</option>') + '</select>' +
      (op.kind === 'strike' ? '<span class="dir-chips">' + methodChips + '</span>' : '') +
      '<button class="dir-btn" data-act="queue"' + (queueDisabled ? ' disabled' : '') + '>+ QUEUE ORDER</button>' + validationNote +
      '</div>' +
      reconHtml(tgt) +
      '<div class="row q">' + queue + '</div>' +
      '<div class="row"><span class="dir-note">Red committed before these indicators rendered. Feints cost combat power; uncaught decoys remain ambiguous.</span><span class="spacer"></span>' +
      (st.orders.blue.length ? '<button class="dir-btn primary" data-act="forecast">REVIEW FORECAST →</button>' :
        (op.tutorial ? '<button class="dir-btn primary" disabled>' + (tutorialNeedsAllocation ? 'CHOOSE A LOGISTICS POSTURE' : 'QUEUE ONE ORDER TO CONTINUE') + '</button>' :
          '<button class="dir-btn" data-act="pass">PASS TURN</button><button class="dir-btn primary" disabled>QUEUE AN ORDER TO CONTINUE</button>')) + '</div>';
    var sel = $('dir-target');
    if (sel && sel.value) op.targetId = sel.value;
    renderRail();
  }

  function onDockChange(ev) {
    if (ev.target.id === 'dir-target') { op.targetId = ev.target.value; renderDock(); }
  }

  function onDockClick(ev) {
    var t = ev.target.closest('[data-kind],[data-method],[data-act],[data-rm],[data-logistics]');
    if (!t) return;
    if (t.hasAttribute('data-kind')) { op.kind = t.getAttribute('data-kind'); op.targetId = null; renderDock(); sfxA('tick', { vol: 0.03 }); return; }
    if (t.hasAttribute('data-method')) { op.methodKey = t.getAttribute('data-method'); renderDock(); sfxA('tick', { vol: 0.03 }); return; }
    if (t.hasAttribute('data-logistics')) {
      if (GM.setLogisticsDecision('blue', t.getAttribute('data-logistics'))) {
        renderDock(); sfxA('beep', { freq: 520, vol: 0.06, dur: 0.14 });
      }
      return;
    }
    if (t.hasAttribute('data-rm')) { GM.removeOrder('blue', Number(t.getAttribute('data-rm'))); renderDock(); sfxA('tick', { vol: 0.04 }); return; }
    var act = t.getAttribute('data-act');
    if (act === 'queue') {
      var sel = $('dir-target');
      var id = (sel && sel.value) || op.targetId;
      if (!id) return;
      var order = { kind: op.kind, targetId: id };
      if (op.kind === 'strike') order.methodKey = op.methodKey;
      var check = GM.validOrder('blue', order);
      if (!check.ok) {
        var msg = explainInvalid(check.reason);
        evt('Order rejected — ' + msg);
        try { if (typeof window.showToast === 'function') window.showToast(msg, 'warn', 4500); } catch (e) {}
        renderDock();
        return;
      }
      var ok = GM.queueOrder('blue', order);
      if (!ok) evt('Order rejected — the game state changed before it could be queued.');
      else sfxA('beep', { freq: 640, vol: 0.07, dur: 0.16 });   // CO-006 P2: a designation you can hear
      renderDock();
    } else if (act === 'forecast') {
      openCommit();
    } else if (act === 'pass') {
      openCommit();
    }
  }

  // ---- FORECAST (ghost worlds on the real engine) -------------------------------------
  function ghostBoard(I, snapshot) {
    var board = I.buildBoard(AppState.activeGraph());
    if (snapshot.strategic) {
      board.strategic = JSON.parse(JSON.stringify(snapshot.strategic));
      I.syncActivationRosters(board, board.strategic.activation);
    }
    if (snapshot.logistics && window.LogisticsModule) {
      board.logistics = window.LogisticsModule.restore(snapshot.logistics, board, snapshot.cfg && snapshot.cfg.logistics || {});
    }
    for (var id in snapshot.health) {
      var b = board.nodes[id];
      if (b) { b.health = snapshot.health[id].h; b.alive = snapshot.health[id].a; }
    }
    return board;
  }

  // Performance-safe Harsanyi forecast cache: six Red rows (two per doctrine) by
  // eight sampled Blue level-0 columns = 48 resolver calls total, not 200×40.
  // The cache's only strategic input is the disclosed policy family. It has no hidden
  // doctrine parameter; each ghost samples a type later from the public belief.
  function ghostPlanCache(I, snapshot, st) {
    var base = ghostBoard(I, snapshot);
    var cache = I.buildBeliefPlanCache(base, st.ap, snapshot.cfg.difficulty.red,
      snapshot.seed, snapshot.turn, snapshot.cfg);
    cache.template = base;
    cache.moeCompiled = cache.moeCompiled || ((window.MoeModule && window.MoeModule.compileGraph)
      ? window.MoeModule.compileGraph(I.moeRedNodes(base)) : null);
    return cache;
  }

  function canonicalWorldSnapshot(board, report, state, turn, I, focusId, compiledMoe) {
    var nodes = {}, redDown = 0, blueDown = 0, sensorDown = 0, commandDown = 0, blueKeyLost = 0;
    var focus = board.nodes[focusId] || board.nodes[(board.rosters.red || [])[0]];
    if (focus) nodes[focus.id] = { team: focus.team, alive: !!focus.alive, healthFrac: Math.max(0, Math.min(1, Number(focus.health || 0) / Number(focus.healthMax || 100))) };
    var keyIds = {};
    (state.objectiveIds.blue || []).forEach(function (id) { keyIds[id] = true; });
    (report.events || []).forEach(function (e) {
      if (e.kind !== 'kill' && e.kind !== 'cascade') return;
      var n = board.nodes[e.targetId];
      if (!n) return;
      var descriptor = String(n.subsystem || '') + ' ' + String(n.type || '');
      if (n.team === 'red') {
        redDown++;
        if (/sensor|isr|recon|surveillance/i.test(descriptor)) sensorDown++;
        if (/command|c2|headquarters/i.test(descriptor)) commandDown++;
      } else { blueDown++; if (keyIds[e.targetId]) blueKeyLost++; }
    });
    var rawAssessment = window.MoeModule && compiledMoe && window.MoeModule.assessCompiled
      ? window.MoeModule.assessCompiled(compiledMoe, board.nodes)
      : window.MoeModule && window.MoeModule.assessGraph ? window.MoeModule.assessGraph(I.moeRedNodes(board)) : null;
    var assessment = I.adaptDenialLogistics ? I.adaptDenialLogistics(board, rawAssessment) : rawAssessment;
    var throughput = assessment ? Number(assessment.throughput || 0) : 0;
    var startingLodgment = Number(state.lodgment && state.lodgment.value || 0);
    var endLodgment = Math.min(1, startingLodgment + throughput / 4);
    var remainingToT5 = Math.max(0, 5 - Number(turn || state.turn || 1));
    return {
      nodes: nodes,
      red: {
        throughput: throughput,
        lodgment: endLodgment,
        projectedLodgmentT5: Math.min(1, endLodgment + throughput * remainingToT5 / 4),
        nodesDownThisTurn: redDown,
        sensorNodesDownThisTurn: sensorDown,
        commandNodesDownThisTurn: commandDown
      },
      blue: {
        keyNodesLostThisTurn: blueKeyLost,
        nodesLostThisTurn: blueDown,
        alive: (board.rosters.blue || []).filter(function (id) { return board.nodes[id] && board.nodes[id].alive; }).length,
        tempoFrac: Number(state.tempo && state.tempo.blue && state.tempo.blue.frac || 1)
      },
      result: { halt: !!(assessment && assessment.halt), lodgmentComplete: endLodgment >= 1 }
    };
  }

  function ghostForecast(K) {
    var I = GM._internal;
    var s = GM.serialize();
    var st = GM.getState();
    var belief = window.RedMindModule.normalizeBelief(st.redMind && st.redMind.belief);
    var planCache = ghostPlanCache(I, s, st);
    var blueOrders = st.orders.blue;
    var primaryOrder = blueOrders.filter(function (o) { return o.kind === 'strike'; })[0] || null;
    var primaryId = primaryOrder ? primaryOrder.targetId : ((planCache.template.rosters.red || [])[0] || '');
    var objBlue = st.objectiveIds.blue || [];
    var redKills = [], blueKills = [], swing = [], objHitWorlds = 0, worlds = [];
    var board = I.cloneBoardForAi(planCache.template);
    for (var k = 0; k < K; k++) {
      I.resetBoardForAi(board, planCache.template);
      var sampled = I.sampleBeliefPlan(planCache, belief, s.seed, s.turn, k);
      var redOrders = sampled.orders;
      var rep = I.resolveTurn(board, blueOrders.concat(redOrders), s.cfg,
        I.makeRng(I.hashSeed(s.seed, 'ghost-res', s.turn, k)));
      var rk = 0, bk = 0;
      (rep.events || []).forEach(function (e) {
        if (e.kind !== 'kill' && e.kind !== 'cascade') return;
        var n = board.nodes[e.targetId];
        if (!n) return;
        if (n.team === 'red') rk++; else if (n.team === 'blue') bk++;
      });
      var objDown = 0;
      objBlue.forEach(function (oid) { var ob = board.nodes[oid]; if (ob && !ob.alive) objDown++; });
      if (objDown > 0) objHitWorlds++;
      redKills.push(rk); blueKills.push(bk);
      swing.push(Math.round((rep.scoreDelta.blue - rep.scoreDelta.red) * 10) / 10);
      worlds.push(canonicalWorldSnapshot(board, rep, st, s.turn, I, primaryId, planCache.moeCompiled));
    }
    return {
      K: K, turn: s.turn,
      belief: belief,
      planningRollouts: planCache.rollouts,
      worlds: worlds,
      redKills: band(redKills), blueKills: band(blueKills),
      objRisk: Math.round(100 * objHitWorlds / K),
      objRiskInterval: window.ForecastingModule.wilson(objHitWorlds, K),
      swing: band(swing)
    };
  }

  function forecastStrip(f) {
    return '<div class="dir-fc"><div class="t">FORECAST — THIS TURN ACROSS ' + f.K + ' WORLDS</div>' +
      '<div class="rows">' +
      '<div class="cell"><b>' + bandStr(f.redKills) + '</b><span>RED NODES DOWN (10th–90th pct)</span></div>' +
      '<div class="cell"><b>' + bandStr(f.blueKills) + '</b><span>BLUE NODES LOST</span></div>' +
      '<div class="cell"><b>' + f.objRisk + '%</b><span>KEY-OBJECTIVE LOSS · 90% FREQ ' + Math.round(f.objRiskInterval.lo * 100) + '–' + Math.round(f.objRiskInterval.hi * 100) + '%</span></div>' +
      '</div>' +
      '<div class="honesty">Ghost Red types are sampled from your current intel assessment (' +
      Math.round((f.belief.attrition || 0) * 100) + '/' + Math.round((f.belief.decapitation || 0) * 100) + '/' + Math.round((f.belief.denial || 0) * 100) +
      '). This is a range, not a promise; one seeded world resolves.</div></div>';
  }

  // ---- COMMIT (the ritual) -------------------------------------------------------------
  function commitOrderRows(st) {
    var methods = GM.methods();
    var logi = st.logistics && st.logistics.sides && st.logistics.sides.blue;
    var allocation = logi ? '<div class="dir-obj"><span>Logistics allocation → ' + esc(logi.decision && logi.decision.label || 'Balanced sustainment') +
      '</span><span class="v">FUEL ' + Math.round(logi.stocks.fuel) + ' · AMMO ' + Math.round(logi.stocks.ammunition) +
      ' · MAINT ' + Math.round(logi.stocks.maintenance) + ' · PERS ' + Math.round(logi.stocks.personnel) +
      ' · FLOW ' + Math.round(logi.flow * 100) + '%</span></div>' : '';
    return allocation + (st.orders.blue.length ? st.orders.blue.map(function (o) {
      var n = GM.boardNode(o.targetId);
      var src = o.sourceId ? GM.boardNode(o.sourceId) : null;
      var what = o.kind === 'strike' ? (methods[o.methodKey] ? methods[o.methodKey].name : 'Strike') : o.kind.charAt(0).toUpperCase() + o.kind.slice(1);
      return '<div class="dir-obj"><span>' + esc(what) + ' → ' + esc(n ? n.name : o.targetId) + '</span><span class="v">' + (src ? 'via ' + esc(src.name) : (n ? esc(n.difficulty || '') : '')) + '</span></div>';
    }).join('') : '<div class="dir-note" style="color:#ffd18a">Deliberate pass: Blue will take no action this turn. Red will still act.</div>');
  }

  function copyBeliefValues(values) {
    return { questions: Object.assign({}, values.questions), standing: values.standing, lower: values.lower, upper: values.upper, premortem: Object.assign({}, values.premortem || {}) };
  }

  function primaryQuestionContext(st) {
    var order = st.orders.blue.filter(function (o) { return o.kind === 'strike'; })[0] || null;
    var target = order ? GM.boardNode(order.targetId) : null;
    return {
      turn: st.turn,
      primaryTargetId: target ? target.id : (st.objectiveIds.red || [])[0],
      primaryTargetName: target ? target.name : 'lead Red objective',
      primaryTarget: target || {}
    };
  }

  function cardIsReady(card) {
    if (!card) return false;
    var allTouched = card.set.questions.every(function (q) { return !!card.touched[q.id]; });
    var values = card.step === 'blind' ? card.values : card.final;
    return allTouched && !!card.touched.premortem && values && values.lower < values.upper;
  }

  function beliefControl(q, value, reveal) {
    var house = reveal ? '<div class="dir-house">House model worlds: <b>' + q.house.hits + '/' + q.house.K + ' · ' + Math.round(q.house.q * 100) + '%</b> (90% frequency interval ' + Math.round(q.house.interval.lo * 100) + '–' + Math.round(q.house.interval.hi * 100) + '%).</div>' : '';
    return '<div class="dir-belief"><div class="head"><b>' + esc(q.prompt) + '</b><output id="dir-value-' + esc(q.id) + '">' + Math.round(value * 100) + '%</output></div>' +
      '<input type="range" min="1" max="99" step="1" value="' + Math.round(value * 100) + '" data-belief-id="' + esc(q.id) + '" aria-label="' + esc(q.prompt) + '">' + house + '</div>';
  }

  function intervalControls(card, values, reveal) {
    var h = card.set.interval.house;
    var house = reveal ? '<div class="dir-house">House 10th–90th percentile band: <b>' + Math.round(h.lo * 100) + '–' + Math.round(h.hi * 100) + '%</b> across ' + h.K + ' model worlds.</div>' : '';
    return '<div class="dir-belief"><div class="head"><b>' + esc(card.set.interval.prompt) + '</b><output id="dir-value-interval">' + Math.round(values.lower * 100) + '–' + Math.round(values.upper * 100) + '%</output></div>' +
      '<label class="dir-note">LOWER <input type="range" min="0" max="99" step="1" value="' + Math.round(values.lower * 100) + '" data-interval="lower" aria-label="Lower bound for Red throughput"></label>' +
      '<label class="dir-note">UPPER <input type="range" min="1" max="100" step="1" value="' + Math.round(values.upper * 100) + '" data-interval="upper" aria-label="Upper bound for Red throughput"></label>' + house + '</div>';
  }

  function standingControl(card, values, reveal) {
    var q = card.set.standing;
    var house = reveal ? '<div class="dir-house">House projection: <b>' + q.house.hits + '/' + q.house.K + ' · ' + Math.round(q.house.q * 100) + '%</b> (90% frequency interval ' + Math.round(q.house.interval.lo * 100) + '–' + Math.round(q.house.interval.hi * 100) + '%). ' + esc(q.projectionNote) + '</div>' : '';
    return '<div class="dir-belief"><div class="head"><b>' + esc(q.prompt) + '</b><output id="dir-value-standing">' + Math.round(values.standing * 100) + '%</output></div>' +
      '<input type="range" min="1" max="99" step="1" value="' + Math.round(values.standing * 100) + '" data-standing="1" aria-label="' + esc(q.prompt) + '">' + house + '</div>';
  }

  function premortemControls(card, values, reveal) {
    var set = card.set.premortem;
    var controls = set.categories.map(function (cause) {
      var value = Number(values.premortem[cause.id] || 0);
      var house = reveal ? '<div class="dir-house">Failed model worlds attributed here: <b>' + cause.count + '/' + set.failedWorlds + ' · ' + Math.round(cause.q * 100) + '%</b>.</div>' : '';
      return '<div class="dir-belief"><div class="head"><b>' + esc(cause.label) + '</b><output id="dir-value-pm-' + esc(cause.id) + '">' + Math.round(value * 100) + '%</output></div>' +
        '<input type="range" min="0" max="100" step="1" value="' + Math.round(value * 100) + '" data-premortem="' + esc(cause.id) + '" aria-label="Premortem probability: ' + esc(cause.label) + '">' + house + '</div>';
    }).join('');
    return '<div class="dir-card"><h3>PRE-MORTEM PICK · IT FAILED—WHY?</h3><div class="dir-note">Move one cause. The other three rebalance automatically so your distribution stays at 100%.</div>' + controls + '</div>';
  }

  function renderBlindCommit() {
    var card = op.commitCard, st = GM.getState();
    if (!card || !st) return;
    $('dir-wrap').innerHTML =
      '<div class="dir-kicker">COMMIT CARD · BLIND · TURN ' + st.turn + '/' + st.cfg.turnLimit + '</div>' +
      '<h1 class="dir-h1">What do you believe?</h1>' +
      '<div class="dir-sub"><span class="dir-lock">ORDERS LOCKED · ' + esc(String(card.lock.orderHash)) + '</span> Orders lock blind; Red commits when you execute. Forecast before seeing the house. Move each of the three event sliders.</div>' +
      tutorialCoach('3', 'Make an honest forecast before seeing the model.', 'Probabilities describe uncertainty, not confidence in yourself. Use the coach estimate for a sensible starting point, or move the controls yourself; then lock the blind forecast.',
        '<button class="dir-btn" data-act="tutorial-estimate"' + (cardIsReady(card) ? ' disabled' : '') + '>' + (cardIsReady(card) ? 'COACH ESTIMATE LOADED' : 'USE COACH ESTIMATE') + '</button>') +
      '<div class="dir-card"><h3>LOCKED ORDERS (' + st.orders.blue.length + '/' + st.ap.blue + ')</h3>' + commitOrderRows(st) + '</div>' +
      outsideViewHtml(st) +
      '<div class="dir-card"><h3>THREE RESOLVABLE CALLS</h3>' + card.set.questions.map(function (q) { return beliefControl(q, card.values.questions[q.id], false); }).join('') + '</div>' +
      '<div class="dir-card"><h3>RANGE + STANDING CALL</h3>' + intervalControls(card, card.values, false) + standingControl(card, card.values, false) + '</div>' +
      premortemControls(card, card.values, false) +
      '<div class="dir-note">Your point probabilities are the instrument. The game is not issuing an operation-success probability.</div>' +
      '<div class="dir-actions"><button class="dir-btn" data-act="unlock-commit">← UNLOCK &amp; REPLAN</button>' +
      '<button class="dir-btn primary" data-act="submit-blind"' + (cardIsReady(card) ? '' : ' disabled') + '>LOCK BLIND FORECASTS →</button></div>';
  }

  function renderHybridCommit() {
    var card = op.commitCard, st = GM.getState();
    if (!card || !st) return;
    $('dir-wrap').innerHTML =
      '<div class="dir-kicker">COMMIT CARD · HOUSE REVEALED · TURN ' + st.turn + '/' + st.cfg.turnLimit + '</div>' +
      '<h1 class="dir-h1">Revise once—then live with it.</h1>' +
      '<div class="dir-sub"><span class="dir-lock">ORDERS REMAIN LOCKED</span> The house line is a model-world frequency with an interval, not a promise.</div>' +
      tutorialCoach('3', 'Compare your call with the house line.', 'You may revise once, but copying the model does not prove skill. For this lesson, leave the estimate as-is and press COMMIT FORECASTS & EXECUTE.') +
      forecastStrip(op.lastForecast) +
      '<div class="dir-card"><h3>HOUSE vs YOU</h3>' + card.set.questions.map(function (q) { return beliefControl(q, card.final.questions[q.id], true); }).join('') +
      '<div class="dir-note">Copying every house value produces Brier Skill Score 0 by construction. Positive skill requires diverging and being right over many resolved calls.</div></div>' +
      '<div class="dir-card"><h3>RANGE + STANDING CALL</h3>' + intervalControls(card, card.final, true) + standingControl(card, card.final, true) + '</div>' +
      premortemControls(card, card.final, true) +
      '<div class="dir-actions"><span class="dir-note">One seeded world will resolve. One outcome cannot validate a probability.</span>' +
      // CO-006 P2: the ARM pulse — hot only now, after the house/forecast reveal (never before).
      '<button class="dir-btn primary cin-armed" data-act="submit-final"' + (card.final.lower < card.final.upper ? '' : ' disabled') + '>COMMIT FORECASTS &amp; EXECUTE ▶</button></div>';
  }

  function openCommit() {
    var st = GM.getState();
    if (!st || st.phase !== 'plan') return;   // never forecast/commit a finished match
    var lock = GM._internal.lockOrders('blue');
    if (!lock.ok) return;
    st = GM.getState();
    var forecast = ghostForecast(GHOSTS);
    var questionSet = window.ForecastingModule.generateQuestionSet(forecast.worlds, primaryQuestionContext(st));
    questionSet.premortem = window.ForecastingModule.failureCauseSet(forecast.worlds);
    delete forecast.worlds;
    forecast.questionSet = questionSet;
    op.lastForecast = forecast;
    op.forecasts[st.turn] = forecast;
    var questions = {};
    questionSet.questions.forEach(function (q) { questions[q.id] = 0.50; });
    var premortem = {};
    questionSet.premortem.categories.forEach(function (cause) { premortem[cause.id] = 0.25; });
    op.commitCard = {
      turn: st.turn, lock: lock, step: 'blind', set: questionSet,
      touched: {},
      values: { questions: questions, standing: op.standingCarry == null ? 0.50 : op.standingCarry, lower: 0.25, upper: 0.75, premortem: premortem },
      blind: null, final: null
    };
    setPhase('commit');
    renderBlindCommit();
    // CO-006 P2: the forecast just finished across the real ghost ensemble — announce it
    // with the real numbers, and shift the bed into the ceremony register.
    cine('commitCinematic');
    comms('J35', 'FORECAST COMPLETE — ' + forecast.K + ' WORLDS · RED DOWN ' + bandStr(forecast.redKills) + ' · OBJ RISK ' + forecast.objRisk + '%');
  }

  // ---- WATCH (paced playback of the one true draw) --------------------------------------
  function execute() {
    var stBefore = GM.getState();
    if (!stBefore || stBefore.phase !== 'plan') return;
    var turn = stBefore.turn;
    var card = op.commitCard;
    if (!card || card.turn !== turn || card.step !== 'ready') return;
    if (GM._internal.lockedOrderHash('blue') !== card.lock.orderHash) {
      evt('Commit stopped — locked order hash changed.');
      return;
    }
    op.judgments[turn] = {
      turn: turn,
      lock: Object.assign({}, card.lock),
      questionSet: card.set,
      blind: copyBeliefValues(card.blind),
      final: copyBeliefValues(card.final),
      scored: false
    };
    op.standingForecasts.push({
      turn: turn,
      question: card.set.standing,
      blind: card.blind.standing,
      final: card.final.standing
    });
    op.commitCard = null;
    // CO-006 P2: the irreversible moment — thunk, letterbox, ORDERS COMMITTED stamp; the
    // bed stops because the war is quieter than the menu. Presentation only: the engine
    // resolves identically with or without the ceremony.
    comms('J3', 'EXECUTE — TURN ' + turn + ' · ' + stBefore.orders.blue.length + ' ORDERS COMMITTED · HASH ' + card.lock.orderHash);
    cine('executeCinematic');
    var st = GM.commitTurn();
    setPhase('watch');
    forceMapView();
    // Keep the pre-turn visual picture in place during paced narration. The engine has
    // resolved deterministically, but the map/table refresh only when the outcome lands,
    // so the final state does not spoil its own playback.
    var report = st.lastReport || { events: [] };
    op.actuals[turn] = actualSummary(report);
    scoreTurnJudgment(st, report);
    playWatch(report, st);
    setTimeout(function () { try { $('dir-feed').focus(); } catch (e) {} }, 0);
    evt('Turn ' + turn + ' executed — watching resolution.');
  }

  function actualSummary(report) {
    var rk = 0, bk = 0;
    (report.events || []).forEach(function (e) {
      if (e.kind !== 'kill' && e.kind !== 'cascade') return;
      var n = GM.boardNode(e.targetId);
      if (!n) return;
      if (n.team === 'red') rk++; else if (n.team === 'blue') bk++;
    });
    return { redKills: rk, blueKills: bk };
  }

  function actualJudgmentSnapshot(st, report, judgment) {
    var focusQuestion = judgment.questionSet.questions[0];
    var match = focusQuestion && String(focusQuestion.predicate.path || '').match(/^nodes\.(.+)\.alive$/);
    var focusId = match ? match[1] : null;
    var focus = focusId ? GM.boardNode(focusId) : null;
    var nodes = {};
    if (focus) nodes[focus.id] = { team: focus.team, alive: !!focus.alive, healthFrac: Math.max(0, Math.min(1, Number(focus.health || 0) / Number(focus.healthMax || 100))) };
    var keyIds = {}, redDown = 0, blueDown = 0, sensorDown = 0, commandDown = 0, blueKeyLost = 0;
    (st.objectiveIds.blue || []).forEach(function (id) { keyIds[id] = true; });
    (report.events || []).forEach(function (e) {
      if (e.kind !== 'kill' && e.kind !== 'cascade') return;
      var n = GM.boardNode(e.targetId);
      if (!n) return;
      var descriptor = String(n.subsystem || '') + ' ' + String(n.type || '');
      if (n.team === 'red') {
        redDown++;
        if (/sensor|isr|recon|surveillance/i.test(descriptor)) sensorDown++;
        if (/command|c2|headquarters/i.test(descriptor)) commandDown++;
      } else { blueDown++; if (keyIds[e.targetId]) blueKeyLost++; }
    });
    var denial = (st.denialHistory || []).filter(function (x) { return x.turn === report.turn; })[0] || {};
    return {
      nodes: nodes,
      red: {
        throughput: Number(denial.throughput || 0),
        lodgment: Number(st.lodgment && st.lodgment.value || 0),
        projectedLodgmentT5: Number(st.lodgment && st.lodgment.value || 0),
        nodesDownThisTurn: redDown,
        sensorNodesDownThisTurn: sensorDown,
        commandNodesDownThisTurn: commandDown
      },
      blue: { keyNodesLostThisTurn: blueKeyLost, nodesLostThisTurn: blueDown, alive: st.alive.blue, tempoFrac: st.tempo.blue.frac },
      result: { halt: !!(st.result && st.result.reason === 'halt'), lodgmentComplete: !!(st.result && st.result.reason === 'lodgment') }
    };
  }

  function scoreTurnJudgment(st, report) {
    var judgment = op.judgments[report.turn];
    if (!judgment || judgment.scored) return;
    var F = window.ForecastingModule;
    var snapshot = actualJudgmentSnapshot(st, report, judgment);
    var seed = GMseed(), newEntries = [];
    judgment.entries = judgment.questionSet.questions.map(function (q) {
      var actual = F.resolvePredicate(snapshot, q.predicate);
      if (!actual.resolved) throw new Error('Commit Card question failed to resolve: ' + q.id);
      var entry = {
        entryId: String(seed) + ':t' + report.turn + ':' + q.id,
        questionId: q.id,
        operationSeed: seed,
        turn: report.turn,
        category: q.category,
        player: judgment.final.questions[q.id],
        blind: judgment.blind.questions[q.id],
        house: q.house.q,
        outcome: actual.outcome,
        playerBrier: F.brier(judgment.final.questions[q.id], actual.outcome),
        blindBrier: F.brier(judgment.blind.questions[q.id], actual.outcome),
        houseBrier: F.brier(q.house.q, actual.outcome)
      };
      newEntries.push(entry);
      return entry;
    });
    var throughput = snapshot.red.throughput;
    judgment.interval = {
      lower: judgment.final.lower,
      upper: judgment.final.upper,
      actual: throughput,
      score: F.winkler(judgment.final.lower, judgment.final.upper, throughput, 0.2)
    };
    op.intervalScores.push(judgment.interval);
    var failure = F.classifyFailure(snapshot);
    var causes = judgment.questionSet.premortem && judgment.questionSet.premortem.categories || [];
    judgment.premortem = { resolved: true, applicable: !!failure.failed, actualCause: failure.cause, score: null };
    if (failure.failed) {
      var outcomeIndex = causes.findIndex(function (cause) { return cause.id === failure.cause; });
      var spread = causes.map(function (cause) { return Number(judgment.final.premortem[cause.id] || 0); });
      judgment.premortem.score = F.multicategoryBrier(spread, outcomeIndex);
    }

    // Resolve every carried T+5 forecast together so updating earns or loses score.
    if (report.turn >= 5 || st.phase === 'over') {
      op.standingForecasts.forEach(function (standing) {
        if (standing.resolved) return;
        var actual = F.resolvePredicate(snapshot, standing.question.predicate);
        if (!actual.resolved) return;
        var entry = {
          entryId: String(seed) + ':standing:t' + standing.turn,
          questionId: standing.question.id,
          operationSeed: seed,
          turn: standing.turn,
          resolvedTurn: report.turn,
          category: standing.question.category,
          player: standing.final,
          blind: standing.blind,
          house: standing.question.house.q,
          outcome: actual.outcome,
          playerBrier: F.brier(standing.final, actual.outcome),
          blindBrier: F.brier(standing.blind, actual.outcome),
          houseBrier: F.brier(standing.question.house.q, actual.outcome)
        };
        standing.resolved = true; standing.entry = entry;
        newEntries.push(entry);
      });
    }
    judgment.scored = true;
    op.scoredEntries = op.scoredEntries.concat(newEntries);
    if (!op.tutorial) appendForecastEntries(newEntries);
    var turnSkill = F.brierSkill(judgment.entries);
    judgment.summary = {
      playerMean: turnSkill.n ? turnSkill.player / turnSkill.n : null,
      houseMean: turnSkill.n ? turnSkill.house / turnSkill.n : null,
      hybridLift: judgment.entries.length ? judgment.entries.reduce(function (sum, e) { return sum + e.blindBrier - e.playerBrier; }, 0) / judgment.entries.length : null
    };
  }

  function clearWatchTimers() { op.watchTimers.forEach(clearTimeout); op.watchTimers = []; }

  function feedLine(e) {
    var n = GM.boardNode(e.targetId);
    var src = e.sourceId ? GM.boardNode(e.sourceId) : null;
    var name = n ? n.name : e.targetId;
    var side = e.side === 'blue' ? 'BLUE' : 'RED';
    var via = src ? ' via ' + src.name : '';
    var cls = e.side === 'blue' ? 'blue' : 'red', txt;
    if (e.kind === 'hit') { txt = side + ' ' + (e.method || '').toUpperCase() + via + ' → ' + name + ' — HIT (−' + Math.round(e.damage || 0) + ')'; }
    else if (e.kind === 'miss') { cls += ' miss'; txt = side + ' ' + (e.method || '').toUpperCase() + via + ' → ' + name + ' — MISS'; }
    else if (e.kind === 'kill') { cls += ' kill'; txt = '✖ ' + name + ' NEUTRALIZED'; }
    else if (e.kind === 'cascade') { cls += ' cas'; txt = '⚡ ' + (e.text || ('Cascade hit ' + name)); }
    else if (e.kind === 'repair') { txt = side + ' repaired ' + name + ' (+' + Math.round(e.amount || 0) + ')'; }
    else { txt = e.text || (side + ' ' + e.kind + ' → ' + name); }
    return '<div class="fl ' + cls + '">' + esc(txt) + '</div>';
  }

  function playWatch(report, st) {
    clearWatchTimers();
    var feed = $('dir-feed');
    var events = (report.events || []).filter(function (e) { return e.kind !== 'void'; });
    var instant = prefersReducedMotion();
    // CO-006 P3: the war film — bars in, the comms floor returns for sparse kill
    // confirms. No bed starts: the war's score is stingers and radio only.
    cine('watchCinematic');
    feed.innerHTML = tutorialCoach('4', 'Watch one seeded world resolve.', 'The forecast was a range across many model worlds. This playback is one deterministic draw; a hit or miss does not validate the probability by itself.') +
      '<div class="fl sys">TURN ' + report.turn + ' — EXECUTION · ' + events.length + ' EVENTS' +
      (instant ? ' · REDUCED MOTION' : ' <button class="dir-btn dir-skip" data-act="skip-watch">SHOW RESULT NOW</button>') + '</div>';
    if (instant) {
      events.forEach(function (e) { feed.insertAdjacentHTML('beforeend', feedLine(e)); });
      showOutcome(st, report);
      feed.scrollTop = feed.scrollHeight;
      return;
    }
    var step = events.length > 40 ? Math.max(110, Math.floor(13000 / events.length)) : 330;
    // CO-006 P3 war-film discipline: cuts breathe (never strobe), confirms stay sparse.
    var CUT_SPACING_MS = 1400, MAX_CUTS = 8;
    var lastCut = -CUT_SPACING_MS, cuts = 0, kills = 0;
    events.forEach(function (e, i) {
      op.watchTimers.push(setTimeout(function () {
        feed.insertAdjacentHTML('beforeend', feedLine(e));
        feed.scrollTop = feed.scrollHeight;
        if (i === 0) sfxA('stingStrike');   // the film opens: strike away
        if ((e.kind === 'hit' || e.kind === 'kill') && window.MapModule) {
          try { MapModule.flashStrike(e.sourceId, e.targetId, { team: e.side, kill: e.kind === 'kill' }); } catch (er) {}
        }
        // Stingers per event class — presentation reading the resolved report.
        if (e.kind === 'hit') sfxA('stingImpact', { vol: 0.1 });
        else if (e.kind === 'kill') sfxA('stingKill');
        else if (e.kind === 'cascade') sfxA('stingCascade');
        else if (e.kind === 'miss') sfxA('tick', { vol: 0.02 });
        if (e.kind === 'kill' || e.kind === 'cascade') {
          // Camera cuts ride kills and cascades only, throttled on the deterministic
          // pacing clock (i * step) and capped per turn.
          var now = i * step;
          if (cuts < MAX_CUTS && now - lastCut >= CUT_SPACING_MS && window.MapModule && MapModule.flyToNode) {
            try { if (MapModule.flyToNode(e.targetId, { zoom: 4, duration: 0.85 })) { lastCut = now; cuts++; } } catch (er) {}
          }
          if (e.kind === 'kill' && kills < 3) {
            kills++;
            var n = GM.boardNode(e.targetId);
            comms('BDA', (e.side === 'blue' ? 'KILL CONFIRMED — ' : 'FRIENDLY UNIT DOWN — ') + (n ? n.name : e.targetId), e.side === 'blue' ? 'bda' : 'warn');
          }
        }
      }, i * step));
    });
    op.watchTimers.push(setTimeout(function () { showOutcome(st, report); }, events.length * step + 500));
  }

  function showOutcome(stAfterCommit, report) {
    if ($('dir-feed').querySelector('.outcome')) return;
    var skip = $('dir-feed').querySelector('[data-act="skip-watch"]');
    if (skip) skip.remove();
    var st = GM.getState();
    refreshVisuals();
    showObjectiveOverlay();
    cine('watchDone');   // CO-006 P3: the film ends with the outcome — bars out (also via SHOW RESULT NOW)
    var f = op.forecasts[report.turn], a = op.actuals[report.turn];
    var honesty = (f && a) ?
      '<div class="dir-note">Forecast said ' + bandStr(f.redKills) + ' Red down — the world drew ' + a.redKills + '.' +
      (a.redKills >= f.redKills.lo && a.redKills <= f.redKills.hi ? ' Inside the band.' : ' Outside the band — note it.') + '</div>' : '';
    var judgment = op.judgments[report.turn];
    var judgmentLine = judgment && judgment.summary ? '<div class="dir-scoreline"><b>HOUSE vs YOU · ONE WORLD’S VERDICT:</b> your mean Brier ' + judgment.summary.playerMean.toFixed(3) + ' · house ' + judgment.summary.houseMean.toFixed(3) +
      ' · blind→hybrid lift ' + (judgment.summary.hybridLift >= 0 ? '+' : '') + judgment.summary.hybridLift.toFixed(3) + '. Lower Brier is better; one turn is noisy.' +
      (judgment.interval ? ' Your 80% range ' + (judgment.interval.actual >= judgment.interval.lower && judgment.interval.actual <= judgment.interval.upper ? 'covered' : 'missed') + ' this world (interval score ' + judgment.interval.score.toFixed(2) + ').' : '') +
      (judgment.premortem && judgment.premortem.applicable ? ' Premortem cause <b>' + esc(judgment.premortem.actualCause) + '</b> (multicategory Brier ' + judgment.premortem.score.toFixed(2) + '; one case).' : ' Premortem not scored because this turn did not meet a failure condition.') + '</div>' : '';
    var over = st.phase === 'over';
    var lastTurn = !over && st.turn >= st.cfg.turnLimit;   // turn limit ends the match on advance
    var denial = (st.denialHistory || []).slice(-1)[0] || null;
    var denialLine = denial ? '<br>Red throughput <b>' + Math.round(denial.throughput * 100) + '%</b> (halt &lt;30%) · system coherence <b>' + Math.round(denial.osvi * 100) + '%</b> · lodgment <b>' + Math.round(((st.lodgment && st.lodgment.value) || 0) * 100) + '%</b>' : '';
    // CO-006 P2 comms: BDA, posterior drift, escalation — every figure below is read from
    // the resolved report/state (no fictional traffic; credibility is the product).
    if (a) comms('BDA', 'TURN ' + report.turn + ' — RED −' + a.redKills + ' · BLUE −' + a.blueKills + (denial ? ' · THROUGHPUT ' + Math.round(denial.throughput * 100) + '%' : ''), 'bda');
    var pb = st.redMind && st.redMind.belief;
    if (pb) {
      var prevPb = op.lastPostureShown || null;
      var topDoc = ['attrition', 'decapitation', 'denial'].sort(function (x, y) { return (pb[y] || 0) - (pb[x] || 0); })[0];
      var docDelta = prevPb ? Math.round(((pb[topDoc] || 0) - (prevPb[topDoc] || 0)) * 100) : 0;
      if (!prevPb || Math.abs(docDelta) >= 3) {
        comms('J2', 'POSTERIOR ' + (prevPb ? 'SHIFTING' : 'BASELINE') + ' — ' + topDoc.toUpperCase() + ' ' + Math.round((pb[topDoc] || 0) * 100) + '%' + (prevPb ? ' (' + (docDelta >= 0 ? '+' : '') + docDelta + ')' : ''), 'j2');
      }
      op.lastPostureShown = { attrition: pb.attrition, decapitation: pb.decapitation, denial: pb.denial };
    }
    if (report.escalation && Number(report.escalation.delta)) {
      comms('J5', 'ESCALATION E ' + Number(report.escalation.before).toFixed(1) + ' → ' + Number(report.escalation.after).toFixed(1), Number(report.escalation.delta) > 0 ? 'warn' : '');
    }
    // CO-006 P3: the tempo-loss motif — fires only on a REAL drop vs the previously
    // shown tempo (presentation reading state; never inventing a downturn).
    var tempoNow = Number(st.tempo && st.tempo.blue && st.tempo.blue.frac);
    if (Number.isFinite(tempoNow)) {
      if (op.lastTempoShown != null && tempoNow < op.lastTempoShown - 0.01) {
        sfxA('tempoLoss');
        comms('J3', 'TEMPO SLIPPING — ' + Math.round(op.lastTempoShown * 100) + ' TO ' + Math.round(tempoNow * 100), 'warn');
      }
      op.lastTempoShown = tempoNow;
    }
    var escalationLine = report.escalation ? '<br>Escalation <b>E ' + Number(report.escalation.before).toFixed(1) + ' → ' + Number(report.escalation.after).toFixed(1) +
      '</b> (Δ ' + (Number(report.escalation.delta) >= 0 ? '+' : '') + Number(report.escalation.delta).toFixed(1) + ')' +
      ((report.escalation.allyEvents || []).length ? ' · posture transition pending next turn: <b>' + report.escalation.allyEvents.map(function (event) { return esc(event.actor); }).join(', ') + '</b>' : '') : '';
    var tutorialOutcome = op.tutorial ? tutorialCoach('4', report.turn === 1 ? 'Turn 1 complete. Now add the logistics decision.' : 'Both tutorial turns are complete.',
      report.turn === 1 ? 'Continue to Turn 2. The coach will require a new sustainment posture before the next strike.' : 'Open the AAR to connect your choices, forecasts, and outcomes.') : '';
    var html = '<div class="outcome"><b>TURN ' + report.turn + ' COMPLETE</b><br>' +
      'Red lost <b>' + (a ? a.redKills : 0) + '</b> · Blue lost <b>' + (a ? a.blueKills : 0) + '</b> · ' +
      'Your objectives <b>' + st.objectives.blue.held + '/' + st.objectives.blue.total + '</b> · ' +
      'Tempo <b>' + Math.round(st.tempo.blue.frac * 100) + '%</b>' + denialLine + escalationLine + '<br>' + honesty + judgmentLine +
      tutorialOutcome + '<div class="dir-actions" style="margin-top:10px">' +
      (over ? '<button class="dir-btn primary" data-act="aar">AFTER-ACTION REVIEW →</button>'
        : lastTurn ? '<button class="dir-btn primary" data-act="next">END OF OPERATION — AAR →</button>'
          : '<button class="dir-btn primary" data-act="next">PLAN TURN ' + (st.turn + 1) + ' →</button>') +
      '</div></div>';
    $('dir-feed').insertAdjacentHTML('beforeend', html);
    $('dir-feed').scrollTop = $('dir-feed').scrollHeight;
  }

  function onFeedClick(ev) {
    var t = ev.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');
    if (act === 'next') {
      var st = GM.nextTurn();
      op.lastSelId = null;
      if (st && st.phase === 'over') openAar();   // turn limit reached — the match just ended
      else beginPlanning();
    }
    else if (act === 'aar') openAar();
    else if (act === 'skip-watch') {
      clearWatchTimers();
      var st = GM.getState();
      showOutcome(st, st && st.lastReport || { turn: st ? st.turn : 0, events: [] });
    }
  }

  // ---- AAR + the Counterfactual Machine --------------------------------------------------
  function counterfactualGraphSnapshot() {
    var graph = AppState.activeGraph() || { nodes: [], links: [] };
    var nodes = (graph.nodes || []).map(function (node) {
      return {
        id: node.id, name: node.name, team: node.team, originalTeam: node.originalTeam,
        difficulty: node.difficulty, vulnerabilities: (node.vulnerabilities || []).slice(),
        cascScore: node.cascScore, importance: node.importance, subsystem: node.subsystem,
        tempoRole: node.tempoRole, nation: node.nation, serviceOwner: node.serviceOwner,
        component: node.component, jointFunction: node.jointFunction, operationalRole: node.operationalRole,
        availability: node.availability, capabilityProfile: node.capabilityProfile ? JSON.parse(JSON.stringify(node.capabilityProfile)) : null,
        logisticsProfile: node.logisticsProfile ? JSON.parse(JSON.stringify(node.logisticsProfile)) : null,
        scenarioEnabled: node.scenarioEnabled, resourceGenByType: Object.assign({}, node.resourceGenByType || {}),
        domain: Array.isArray(node.domain) ? node.domain.slice() : node.domain,
        type: node.type, healthMax: node.healthMax || 100, health: node.healthMax || 100, status: 'Active'
      };
    });
    var links = (graph.links || []).map(function (link) {
      return {
        source: link.source && link.source.id != null ? link.source.id : link.source,
        target: link.target && link.target.id != null ? link.target.id : link.target
      };
    });
    return { nodes: nodes, links: links };
  }

  function nodeName(id) {
    var node = GM.boardNode(id);
    return node ? node.name : id || 'no target';
  }

  function orderLabel(order, index) {
    order = order || {};
    return (index + 1) + '. ' + String(order.kind || 'order').toUpperCase() +
      (order.methodKey ? ' / ' + String(order.methodKey).toUpperCase() : '') + ' → ' + nodeName(order.targetId);
  }

  function eligibleCounterfactualTurns() {
    return (op.record && op.record.history || []).filter(function (row) {
      return row.orders && row.orders.blue && row.orders.blue.length;
    });
  }

  function initCounterfactual() {
    var rows = eligibleCounterfactualTurns();
    if (!rows.length) { op.counterfactual = { unavailable: true }; return; }
    op.counterfactual = {
      turn: Number(rows[0].turn), orderIndex: 0, action: 'remove', methodKey: 'kinetic',
      targetId: null, authoredForecast: 0.50, status: 'idle', progress: 0,
      result: null, error: null, runId: null
    };
  }

  function counterfactualTargets(action) {
    var team = action === 'strike' ? 'red' : 'blue';
    return Object.keys((GM._internal.buildBoard(AppState.activeGraph()) || { nodes: {} }).nodes).map(function (id) {
      return GM.boardNode(id);
    }).filter(function (node) { return node && node.team === team; }).sort(function (a, b) {
      return nodeVal(b) - nodeVal(a) || String(a.id).localeCompare(String(b.id));
    });
  }

  function counterfactualResultHtml(result) {
    if (!result) return '';
    function outcome(branch) {
      return branch.halt ? 'HALT' : branch.lodgmentComplete ? 'LODGMENT' : 'OPEN AT HORIZON';
    }
    function percent(value) { return Math.round(Number(value || 0) * 100); }
    var e = result.ensemble, cf = e.counterfactual, original = e.original, dv = e.decisionValue;
    return '<div class="dir-cf-result"><b>SAME-SEED MATCHED PAIR · ONE WORLD:</b> recorded order path <b>' + outcome(result.matched.original) +
      '</b>; edited path <b>' + outcome(result.matched.counterfactual) + '</b>. One seeded world is dramatic evidence, not probability validation.<br>' +
      '<b>STATISTICAL REVEAL:</b> the edited path halted Red in <b>' + cf.hits + '/' + e.K + ' model worlds</b> — frequency ' + percent(cf.q) +
      '%, 90% Monte Carlo interval ' + percent(cf.interval.lo) + '–' + percent(cf.interval.hi) + '%. The recorded path was ' + original.hits + '/' + e.K +
      ' — ' + percent(original.q) + '%, interval ' + percent(original.interval.lo) + '–' + percent(original.interval.hi) + '%.<br>' +
      '<b>DECISION VALUE:</b> ' + (dv.mean >= 0 ? '+' : '') + percent(dv.mean) + ' points, paired 90% interval ' + (dv.interval.lo >= 0 ? '+' : '') +
      percent(dv.interval.lo) + ' to ' + (dv.interval.hi >= 0 ? '+' : '') + percent(dv.interval.hi) + '; improved ' + dv.improvedWorlds + ', harmed ' +
      dv.harmedWorlds + ', unchanged ' + dv.unchangedWorlds + '.<br>' +
      '<b>YOUR BLIND CALL:</b> ' + percent(result.authoredForecast) + '%. Brier against the model-world frequency <b>' + result.score.toFixed(3) +
      '</b>, MC-induced band ' + result.scoreInterval.lo.toFixed(3) + '–' + result.scoreInterval.hi.toFixed(3) + '. Lower is better; this scores a model comparison, not a real-world prediction.</div>';
  }

  function renderCounterfactualCard() {
    var box = $('dir-colosseum');
    if (!box) return;
    if (!op.counterfactual) initCounterfactual();
    var cf = op.counterfactual;
    if (cf.unavailable) { box.innerHTML = '<div class="dir-note">No authored Blue order is available to edit.</div>'; return; }
    var rows = eligibleCounterfactualTurns();
    var row = rows.filter(function (item) { return Number(item.turn) === Number(cf.turn); })[0] || rows[0];
    cf.turn = Number(row.turn);
    var orders = row.orders.blue || [];
    cf.orderIndex = Math.max(0, Math.min(orders.length - 1, Number(cf.orderIndex) || 0));
    var targets = cf.action === 'remove' ? [] : counterfactualTargets(cf.action);
    if (targets.length && !targets.some(function (node) { return node.id === cf.targetId; })) cf.targetId = targets[0].id;
    var disabled = cf.status === 'running' ? ' disabled' : '';
    var targetControl = cf.action === 'remove' ? '' : '<label>NEW TARGET<select data-cf="target"' + disabled + '>' + targets.map(function (node) {
      return '<option value="' + esc(node.id) + '"' + (node.id === cf.targetId ? ' selected' : '') + '>' + esc(node.name) + '</option>';
    }).join('') + '</select></label>';
    var methodControl = cf.action === 'strike' ? '<label>METHOD<select data-cf="method"' + disabled + '>' + ['kinetic', 'cyber', 'ew', 'sof'].map(function (method) {
      return '<option value="' + method + '"' + (method === cf.methodKey ? ' selected' : '') + '>' + method.toUpperCase() + '</option>';
    }).join('') + '</select></label>' : '';
    var status = cf.status === 'running' ? '<div class="dir-cf-result" id="dir-cf-status">Worker ensemble: ' + cf.progress + '/200 worlds complete…</div>'
      : cf.error ? '<div class="dir-cf-result">Unable to resolve: ' + esc(cf.error) + '</div>' : counterfactualResultHtml(cf.result);
    box.innerHTML = '<div class="dir-note">Author exactly one order change, state your belief blind, then reveal one same-seed replay and a 200-world matched ensemble. Combat uses <code>resolveTurn</code>; the verdict uses the denial/lodgment arbiter.</div>' +
      '<div class="dir-colosseum"><label>TURN<select data-cf="turn"' + disabled + '>' + rows.map(function (item) {
        return '<option value="' + item.turn + '"' + (Number(item.turn) === cf.turn ? ' selected' : '') + '>TURN ' + item.turn + '</option>';
      }).join('') + '</select></label><label>DECISION TO CHANGE<select data-cf="order"' + disabled + '>' + orders.map(function (order, index) {
        return '<option value="' + index + '"' + (index === cf.orderIndex ? ' selected' : '') + '>' + esc(orderLabel(order, index)) + '</option>';
      }).join('') + '</select></label><label>ONE EDIT<select data-cf="action"' + disabled + '>' +
      [['remove', 'Remove this order'], ['strike', 'Replace with strike'], ['harden', 'Replace with harden'], ['repair', 'Replace with repair']].map(function (choice) {
        return '<option value="' + choice[0] + '"' + (choice[0] === cf.action ? ' selected' : '') + '>' + choice[1] + '</option>';
      }).join('') + '</select></label>' + targetControl + methodControl +
      '<label>BLIND HALT FREQUENCY · <output id="dir-cf-probability">' + Math.round(cf.authoredForecast * 100) + '%</output><input type="range" min="1" max="99" step="1" value="' +
      Math.round(cf.authoredForecast * 100) + '" data-cf="probability"' + disabled + '></label></div>' +
      '<div class="dir-actions"><span class="dir-note">Red types are sampled from the belief available at each PLAN. Future unrecorded actions use bounded, belief-respecting policies.</span>' +
      '<button class="dir-btn primary" data-act="run-counterfactual"' + disabled + '>RUN 200-WORLD REVEAL ▶</button></div>' + status;
  }

  function counterfactualEdit() {
    var cf = op.counterfactual, replacement = null;
    if (cf.action !== 'remove') {
      replacement = { side: 'blue', kind: cf.action, targetId: cf.targetId };
      if (cf.action === 'strike') replacement.methodKey = cf.methodKey;
    }
    return { turn: cf.turn, orderIndex: cf.orderIndex, replacement: replacement };
  }

  function stopCounterfactualWorker() {
    if (op.counterfactualWorker) { try { op.counterfactualWorker.terminate(); } catch (e) {} }
    op.counterfactualWorker = null;
  }

  function runCounterfactual() {
    if (!op.counterfactual || op.counterfactual.status === 'running' || !window.Worker) {
      if (op.counterfactual && !window.Worker) { op.counterfactual.error = 'Web Workers are unavailable in this browser.'; renderCounterfactualCard(); }
      return;
    }
    stopCounterfactualWorker();
    var cf = op.counterfactual;
    cf.status = 'running'; cf.progress = 0; cf.error = null; cf.result = null;
    cf.runId = String(GM._internal.hashSeed(op.record.seed, 'counterfactual-ui', cf.turn, cf.orderIndex, cf.action, cf.targetId, cf.methodKey, cf.authoredForecast));
    renderCounterfactualCard();
    var worker = new Worker('counterfactual-worker.js');
    op.counterfactualWorker = worker;
    worker.onmessage = function (event) {
      var message = event.data || {};
      if (!op.counterfactual || message.runId !== op.counterfactual.runId) return;
      if (message.type === 'progress') {
        cf.progress = Number(message.completed || 0);
        var status = $('dir-cf-status');
        if (status) status.textContent = 'Worker ensemble: ' + cf.progress + '/200 worlds complete…';
      } else if (message.type === 'done') {
        cf.status = 'done'; cf.result = message.result; stopCounterfactualWorker(); renderCounterfactualCard();
      } else if (message.type === 'error') {
        cf.status = 'error'; cf.error = message.message || 'Unknown worker error'; stopCounterfactualWorker(); renderCounterfactualCard();
      }
    };
    worker.onerror = function (event) {
      cf.status = 'error'; cf.error = event.message || 'Worker failed to load'; stopCounterfactualWorker(); renderCounterfactualCard();
    };
    worker.postMessage({ type: 'run', runId: cf.runId, payload: {
      record: op.record, graph: counterfactualGraphSnapshot(), edit: counterfactualEdit(),
      authoredForecast: cf.authoredForecast, K: 200, chunk: 5
    } });
  }

  function ledgerRows() {
    var rows = '';
    Object.keys(op.forecasts).sort(function (a, b) { return a - b; }).forEach(function (t) {
      var f = op.forecasts[t], a = op.actuals[t];
      if (!f || !a) return;
      var inBand = a.redKills >= f.redKills.lo && a.redKills <= f.redKills.hi &&
        a.blueKills >= f.blueKills.lo && a.blueKills <= f.blueKills.hi;
      rows += '<tr><td>T' + t + '</td><td>' + bandStr(f.redKills) + '</td><td>' + a.redKills + '</td>' +
        '<td>' + bandStr(f.blueKills) + '</td><td>' + a.blueKills + '</td>' +
        '<td class="' + (inBand ? 'ok">within band' : 'out">outside band') + '</td></tr>';
    });
    return rows;
  }

  function scoreBars(aar) {
    if (!aar || !aar.scoreByTurn || !aar.scoreByTurn.length) return '';
    var max = 1;
    aar.scoreByTurn.forEach(function (r) { max = Math.max(max, r.blueScore, r.redScore); });
    return '<div class="dir-bars">' + aar.scoreByTurn.map(function (r) {
      return '<div class="tcol">' +
        '<div class="b" style="height:' + Math.round(58 * r.blueScore / max) + 'px" title="Blue ' + r.blueScore + '"></div>' +
        '<div class="b r" style="height:' + Math.round(58 * r.redScore / max) + 'px" title="Red ' + r.redScore + '"></div>' +
        '<div class="tl">T' + r.turn + '</div></div>';
    }).join('') + '</div>';
  }

  function operationalVerdict(aar) {
    aar = aar || {};
    var winner = aar.winner, result = aar.result || null;
    if (result && result.detail === 'legacy-score') return { label: (winner || 'NO').toUpperCase() + ' ADVANTAGE · LEGACY SCORE', cls: winner === 'blue' ? 'win' : winner === 'red' ? 'loss' : 'draw' };
    if (winner === 'draw') return { label: result && result.reason === 'horizon' ? 'CONTESTED PROJECTION' : 'CONTESTED / UNRESOLVED', cls: 'draw' };
    if (result && result.reason === 'halt' && winner === 'blue') return { label: 'DENIAL ACHIEVED', cls: 'win' };
    if (result && result.reason === 'lodgment' && winner === 'red') return { label: 'LODGMENT ESTABLISHED', cls: 'loss' };
    if (result && result.reason === 'horizon') return { label: winner === 'blue' ? 'BLUE-FAVORED CONTINUATION' : winner === 'red' ? 'RED-FAVORED CONTINUATION' : 'CONTESTED PROJECTION', cls: winner === 'blue' ? 'win' : winner === 'red' ? 'loss' : 'draw' };
    if (!winner) return { label: 'UNRESOLVED MODEL STATE', cls: 'draw' };
    return { label: winner.toUpperCase() + ' OPERATIONAL OUTCOME', cls: winner === 'blue' ? 'win' : 'loss' };
  }

  function calibrationCardHtml() {
    var F = window.ForecastingModule;
    var entries = readForecastArchive().filter(function (e) { return e && e.player != null && e.house != null && e.outcome != null; });
    var skill = F.brierSkill(entries);
    var seed = op.record && op.record.seed || 1;
    var band = F.bootstrapBss(entries, GM._internal.makeRng(GM._internal.hashSeed(seed, 'calibration-bootstrap', entries.length)), 500);
    var rank = F.analystRank(entries, band);
    var decomposition = F.murphy(entries);
    var buckets = F.foldedBuckets(entries).filter(function (b) { return b.display; });
    var bucketText = buckets.length ? buckets.map(function (b) {
      var gap = Math.round((b.forecast - b.observed) * 100);
      return '<li>On ' + b.n + ' calls where your confidence averaged ' + Math.round(b.forecast * 100) + '%, the selected outcome occurred ' + Math.round(b.observed * 100) + '% of the time' + (gap ? ' — gap ' + (gap > 0 ? '+' : '') + gap + ' points.' : '.') + '</li>';
    }).join('') : '<li>Confidence-bucket sentences appear only after 10 calls land in a bucket.</li>';
    var bssText = skill.value == null ? 'undefined (house error is zero)' : (skill.value >= 0 ? '+' : '') + skill.value.toFixed(3);
    var bandText = band.lo == null ? 'band unavailable' : '90% bootstrap ' + (band.lo >= 0 ? '+' : '') + band.lo.toFixed(3) + ' to ' + (band.hi >= 0 ? '+' : '') + band.hi.toFixed(3);
    var verdict = rank.verdict ? '<b>' + esc(rank.label) + '</b> — ' + esc(rank.note) : '<b>No calibration verdict yet.</b> ' + esc(rank.note);
    return '<div class="dir-card"><h3>CALIBRATION CARD — HOUSE vs YOU</h3>' +
      '<div class="dir-metrics"><div class="dir-metric"><b>' + esc(bssText) + '</b><span>BRIER SKILL vs HOUSE · N=' + entries.length + '</span></div>' +
      '<div class="dir-metric"><b>' + (decomposition.rel == null ? '—' : decomposition.rel.toFixed(3)) + '</b><span>HONESTY WITH YOURSELF · REL</span></div>' +
      '<div class="dir-metric"><b>' + (decomposition.res == null ? '—' : decomposition.res.toFixed(3)) + '</b><span>WILLINGNESS TO CALL IT · RES</span></div>' +
      '<div class="dir-metric"><b>' + esc(rank.label) + '</b><span>ANALYST TRACK · N≥50 GATE</span></div></div>' +
      '<div class="dir-scoreline">' + verdict + ' ' + esc(bandText) + '</div>' +
      '<ul class="dir-note" style="font-style:normal">' + bucketText + '</ul>' +
      precisionStyleHtml(entries) +
      '<div class="dir-note">BSS = 1 − your cumulative Brier / house cumulative Brier. Copying the house scores exactly 0 by construction. Per-turn scores are proper but noisy; rank and judgment labels require at least 50 resolved calls and a sustained uncertainty bound.</div></div>';
  }

  // ---- CO-005 A7: predictability meter + exploit probe --------------------------------
  function predictabilityInner(st) {
    var mind = window.RedMindModule;
    var model = st && st.playerModel;
    var habit = mind.topHabit(model);
    var habitLine = habit
      ? '<div class="dir-scoreline"><b>' + esc(habit.text) + '</b> Habits this strong are exactly what an adaptive Red exploits.</div>'
      : '<div class="dir-note">No habit claim yet — habit statements require at least 5 observed turns and a 35% order share. That gate is deliberate: unsupported claims are worse than none.</div>';
    var pr = op.exploitProbe, result = '';
    if (pr && pr.status === 'running') {
      result = '<div class="dir-note" id="dir-exploit-status">Worker ensemble running…</div>';
    } else if (pr && pr.status === 'error') {
      result = '<div class="dir-note">Probe failed: ' + esc(pr.error || 'unknown') + '</div>';
    } else if (pr && pr.status === 'done' && pr.result && pr.result.ensemble) {
      var e = pr.result.ensemble;
      var base = Math.round(e.original.q * 100), adapt = Math.round(e.counterfactual.q * 100);
      var delta = adapt - base, band = e.counterfactual.interval;
      result = '<div class="dir-metrics">' +
        '<div class="dir-metric"><b>' + base + '%</b><span>HALT RATE · RED AS PLAYED</span></div>' +
        '<div class="dir-metric"><b>' + adapt + '%</b><span>HALT RATE · RED EXPLOITS YOUR HABITS · 90% ' + Math.round(band.lo * 100) + '–' + Math.round(band.hi * 100) + '%</span></div>' +
        '<div class="dir-metric"><b>' + (delta > 0 ? '+' : '') + delta + ' pts</b><span>PREDICTABILITY SWING</span></div></div>' +
        '<div class="dir-note">Same recorded Blue orders, same combat seeds — only Red\'s knowledge of your habits changed. A large negative swing means your patterns are exploitable; deliberate self-randomization is a skill this game scores.</div>';
    } else {
      var ready = mind.modelConfidence(model) > 0;
      result = '<div class="dir-actions"><button class="dir-btn" data-act="run-exploit-probe"' + (ready ? '' : ' disabled') + '>RUN EXPLOIT PROBE — SAME WORLD, ADAPTIVE RED</button>' +
        (ready ? '<span class="dir-note">200-world ensemble in a worker; the AAR stays responsive.</span>' : '<span class="dir-note">Needs at least 3 observed turns of your orders.</span>') + '</div>';
    }
    return '<h3>PREDICTABILITY — WHAT AN ADAPTIVE RED SEES</h3>' + habitLine + result;
  }
  function predictabilityCardHtml(st) {
    return '<div class="dir-card" id="dir-predict-card">' + predictabilityInner(st) + '</div>';
  }
  function refreshPredictCard() {
    var el = $('dir-predict-card');
    if (el) el.innerHTML = predictabilityInner(GM.getState());
  }
  function stopExploitWorker() {
    try { if (op.exploitWorker) op.exploitWorker.terminate(); } catch (e) {}
    op.exploitWorker = null;
  }
  function runExploitProbe() {
    if (!op.record || !window.Worker) return;
    if (op.exploitProbe && op.exploitProbe.status === 'running') return;
    var st = GM.getState();
    op.exploitProbe = {
      status: 'running', result: null, error: null,
      runId: String(GM._internal.hashSeed(op.record.seed, 'exploit-probe-ui'))
    };
    refreshPredictCard();
    var worker = new Worker('counterfactual-worker.js');
    op.exploitWorker = worker;
    worker.onmessage = function (event) {
      var m = event.data || {};
      if (!op.exploitProbe || m.runId !== op.exploitProbe.runId) return;
      if (m.type === 'progress') {
        var el = $('dir-exploit-status');
        if (el) el.textContent = 'Worker ensemble: ' + m.completed + '/200 worlds…';
      } else if (m.type === 'done') {
        op.exploitProbe.status = 'done'; op.exploitProbe.result = m.result;
        stopExploitWorker(); refreshPredictCard();
      } else if (m.type === 'error') {
        op.exploitProbe.status = 'error'; op.exploitProbe.error = m.message;
        stopExploitWorker(); refreshPredictCard();
      }
    };
    worker.onerror = function (event) {
      op.exploitProbe.status = 'error'; op.exploitProbe.error = event.message || 'Worker failed to load';
      stopExploitWorker(); refreshPredictCard();
    };
    worker.postMessage({ type: 'run', runId: op.exploitProbe.runId, payload: {
      record: op.record, graph: counterfactualGraphSnapshot(),
      probe: 'exploit-player-model', playerModel: st && st.playerModel, K: 200, chunk: 5
    } });
  }

  // ---- CO-005 B7: precision audit + updating style (career archive, gated) ------------
  function precisionStyleHtml(entries) {
    var F = window.ForecastingModule;
    var audit = F.precisionAudit(entries.map(function (e) { return { f: e.player, o: e.outcome }; }));
    var style = F.classifyUpdateStyle(entries.map(function (e) { return { fBlind: e.blind, fFinal: e.player, o: e.outcome }; }));
    var lines = [];
    if (audit.n >= 20 && audit.delta != null) {
      lines.push(audit.delta > 0.002
        ? 'Precision audit: your fine-grained probabilities earned <b>' + audit.delta.toFixed(4) + '</b> Brier vs 10% rounding — the granularity carries real information (N=' + audit.n + ').'
        : 'Precision audit: rounding every forecast to the nearest 10% would have cost you nothing (Δ ' + audit.delta.toFixed(4) + ', N=' + audit.n + ') — your last digit is noise so far.');
    }
    if (style) {
      lines.push('Updating style: <b>' + esc(style.label) + '</b> — ' + esc(style.note) +
        ' (' + style.n + ' revisions; mean step ' + Math.round(style.meanAbsDelta * 100) + ' pts; ' + Math.round(style.towardRate * 100) + '% moved toward the outcome.)');
    }
    if (!lines.length) return '';
    return '<ul class="dir-note" style="font-style:normal">' + lines.map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ul>';
  }

  // ---- CO-005 B7: outside view — reference class BEFORE the house line -----------------
  function outsideViewHtml(st) {
    var F = window.ForecastingModule;
    var stats = F.outsideViewStats(readOpsArchive(), F.planArchetype(st.orders.blue, blueOrderClassifier()));
    if (!stats) return '';
    return '<div class="dir-card"><h3>OUTSIDE VIEW — PLANS LIKE THIS ONE</h3>' +
      '<div class="dir-note" style="font-style:normal">Across your last <b>' + stats.ops + '</b> operations of archetype <b>' + esc(stats.archetype) + '</b>: halt achieved <b>' + Math.round(stats.haltRate * 100) + '%</b> of the time' +
      (stats.medianEndThroughput != null ? '; median end throughput <b>' + Math.round(stats.medianEndThroughput * 100) + '%</b>' : '') +
      '. Anchor on the reference class first, then adjust for what makes this plan different. The house line arrives only after your blind call.</div></div>';
  }

  function doctrineTrajectoryHtml(redMindRecord) {
    redMindRecord = redMindRecord || {};
    var trajectory = redMindRecord.trajectory || [];
    if (!trajectory.length) return '';
    var truth = redMindRecord.doctrine || 'unrevealed';
    var rows = trajectory.map(function (row) {
      var b = row.belief || {}, a = Math.round((b.attrition || 0) * 100), d = Math.round((b.decapitation || 0) * 100), n = 100 - a - d;
      return '<div class="dir-obj"><span>' + (row.turn ? 'After T' + row.turn : 'Brief prior') + '</span><span class="v">ATTR ' + a + ' · DECAP ' + d + ' · DENIAL ' + n + '</span></div>';
    }).join('');
    var diagnostic = trajectory[Math.min(3, trajectory.length - 1)] || trajectory[trajectory.length - 1];
    var belief = diagnostic.belief || {};
    var assessed = Math.round(Number(belief[truth] || 0) * 100);
    return '<div class="dir-card"><h3>RED MIND — POSTERIOR vs TRUTH</h3>' + rows +
      '<div class="dir-scoreline">At ' + (diagnostic.turn ? 'T' + diagnostic.turn : 'the brief') + ', you assigned the true ' + esc(truth) + ' type <b>' + assessed + '%</b>. The hidden draw is revealed only now; the PLAN bar showed this posterior throughout.</div></div>';
  }

  function strategicAarHtml(strategic) {
    if (!strategic) return '';
    var history = strategic.escalation && strategic.escalation.history || [];
    var rows = history.map(function (row) {
      var horizontal = row.breakdown && row.breakdown.horizontal ? Number(row.breakdown.horizontal.adjusted || 0) : 0;
      var vertical = row.breakdown && row.breakdown.vertical ? Number(row.breakdown.vertical.adjusted || 0) : 0;
      return '<div class="dir-obj"><span>T' + row.turn + ' · horizontal +' + horizontal.toFixed(1) + ' / vertical +' + vertical.toFixed(1) + '</span><span class="v">E ' + Number(row.before).toFixed(1) + ' → ' + Number(row.after).toFixed(1) + '</span></div>';
    }).join('') || '<div class="dir-note">No escalation transitions recorded.</div>';
    var allies = Object.keys(strategic.allies || {}).map(function (id) {
      var track = strategic.allies[id];
      return '<span class="dir-badge">' + esc(id) + ': ' + (track.active ? 'ACTIVE' : 'WITHHELD') + '</span>';
    }).join('');
    var signals = (strategic.signalHistory || []).reduce(function (sum, row) { return sum + (row.red || []).length + (row.blue || []).length; }, 0);
    return '<div class="dir-card"><h3>ESCALATION LADDER — EXPLICIT COMMITMENTS</h3>' + rows +
      '<div class="dir-badges" style="margin-top:8px"><span class="dir-badge notional">FINAL E ' + Number(strategic.escalation && strategic.escalation.value || 0).toFixed(1) + ' / 10</span>' + allies + '</div>' +
      '<div class="dir-scoreline">Declared ROE: <b>' + esc(strategic.roe && strategic.roe.label || 'not recorded') + '</b> · ' + signals + ' costly/free deception emissions recorded. Escalation weights and thresholds are notional sensitivity settings.</div></div>';
  }

  function logisticsAarHtml(logistics) {
    if (!logistics || !logistics.sides) return '';
    var names = { fuel: 'FUEL', ammunition: 'AMMO', maintenance: 'MAINT', personnel: 'PERS' };
    function sideCard(side) {
      var row = logistics.sides[side] || {}, finalStocks = row.finalStocks || {}, initialStocks = row.initialStocks || {};
      var stocks = Object.keys(names).map(function (key) {
        return '<div class="dir-obj"><span>' + names[key] + '</span><span class="v">' +
          Math.round(Number(initialStocks[key] || 0)) + ' → ' + Math.round(Number(finalStocks[key] || 0)) + '</span></div>';
      }).join('');
      var decisions = Object.keys(row.decisions || {}).map(function (id) {
        return '<span class="dir-badge">' + esc(id).toUpperCase() + ' ×' + Number(row.decisions[id] || 0) + '</span>';
      }).join('') || '<span class="dir-badge">NO ALLOCATION RECORD</span>';
      var disrupted = (row.routes || []).filter(function (r) { return r.status !== 'open'; }).length;
      var hubs = (row.hubs || []).filter(function (h) { return h.status !== 'open'; }).length;
      var totals = row.totals || {};
      return '<div class="dir-card"><h3>' + side.toUpperCase() + ' LOGISTICS ENDURANCE</h3>' + stocks +
        '<div class="dir-metrics" style="margin-top:8px"><div class="dir-metric"><b>' + Math.round(Number(row.finalReadiness || 0) * 100) + '%</b><span>READINESS</span></div>' +
        '<div class="dir-metric"><b>' + Math.round(Number(row.finalFlow || 0) * 100) + '%</b><span>ROUTE FLOW</span></div>' +
        '<div class="dir-metric"><b>' + Math.round(Number(row.finalDdil || 0) * 100) + '%</b><span>DDIL FRICTION</span></div>' +
        '<div class="dir-metric"><b>' + Math.round(Number(row.finalPrepositioning || 0)) + '</b><span>PREPOSITIONED BUFFER</span></div></div>' +
        '<div class="dir-badges" style="margin-top:8px">' + decisions + '</div>' +
        '<div class="dir-scoreline">' + disrupted + ' disrupted routes · ' + hubs + ' disrupted port/airfield hubs · ' +
        Number(totals.reroutes || 0) + ' reroutes · ' + Number(totals.routeRepairs || 0) + ' route repairs · ' +
        Number(totals.shortages || 0) + ' shortage events.</div></div>';
    }
    return '<div class="dir-grid">' + sideCard('blue') + sideCard('red') + '</div>' +
      '<div class="dir-note">Logistics values are abstract, deterministic readiness points for this notional research tool—not real inventory, lift, sortie, or casualty estimates.</div>';
  }

  function openAar() {
    var st = GM.getState();
    op.record = GM.serialize();
    // CO-005 A6/B7: persist the habit model Red will face next operation, and the
    // finished-operation record behind the outside-view reference class.
    if (!op.tutorial) {
      try {
        if (st && st.playerModel) writePlayerModel(st.playerModel);
        var aarResult = (st && st.aar && st.aar.result) || {};
        var lastDenialRow = ((st && st.aar && st.aar.denialHistory) || []).slice(-1)[0] || {};
        appendOpsArchive({
          ts: Date.now(),
          seed: op.record ? op.record.seed : null,
          variantId: briefOpts.variantId || 'default',
          archetype: operationArchetype(op.record),
          winner: (st && st.aar && st.aar.winner) || st.winner || null,
          halted: aarResult.reason === 'halt',
          throughputEnd: lastDenialRow.throughput != null ? lastDenialRow.throughput : null,
          turns: (st && st.aar && st.aar.turns) || st.turn
        });
      } catch (e) { /* career stores are best-effort; the AAR itself never depends on them */ }
    }
    stopCounterfactualWorker();
    initCounterfactual();
    setPhase('aar');
    var aar = st.aar || {};
    op.aar = aar;
    var verdict = operationalVerdict(aar);
    var lastDenial = (aar.denialHistory || []).slice(-1)[0] || {};
    var lodgment = aar.lodgment ? Number(aar.lodgment.value || 0) : 0;
    var result = aar.result || {};
    var projection = result.projection || null;
    var projectionLine = projection ? '<div class="dir-note" style="margin-top:8px">Hard-horizon projection: lodgment sustained in <b>' + projection.lodgmentSustainedPct + '%</b> of seeded continuations; halt in <b>' + projection.haltPct + '%</b>. This is a model distribution, not a real-world probability.</div>' : '';
    var top = (aar.topNeutralized || []).slice(0, 5).map(function (t) {
      return '<div class="dir-obj"><span>' + esc(t.name) + '</span><span class="v">' + (t.team || '') + ' · val ' + Math.round(t.value) + (t.cascaded ? ' · cascade' : '') + '</span></div>';
    }).join('') || '<div class="dir-note">No nodes neutralized.</div>';

    // CO-006 P3: career rank rides the debrief header (display-only read of the same
    // archive the calibration card scores; the evidence-gated rank text is Forecasting's).
    var rankChip = '';
    try {
      var Fr = window.ForecastingModule;
      var careerEntries = readForecastArchive().filter(function (e) { return e && e.player != null && e.house != null && e.outcome != null; });
      var careerBand = Fr.bootstrapBss(careerEntries, GM._internal.makeRng(GM._internal.hashSeed(op.record ? op.record.seed : 1, 'aar-rank-chip', careerEntries.length)), 500);
      var crank = Fr.analystRank(careerEntries, careerBand);
      if (crank) rankChip = '<div class="dir-rankchip">ANALYST TRACK · ' + esc(crank.label).toUpperCase() + ' · ' + careerEntries.length + ' RESOLVED CALLS</div>';
    } catch (e) {}

    $('dir-wrap').innerHTML =
      '<div class="dir-kicker">AFTER-ACTION REVIEW · ' + (aar.turns || st.turn) + ' TURNS · SERIAL <span class="dir-serial">' + esc(String(op.record ? op.record.seed : '')) + '</span></div>' +
      '<div class="dir-verdict ' + verdict.cls + '">' + verdict.label + '</div>' +
      rankChip +
      '<div class="dir-sub">' + esc(aar.reason || '') + '</div>' +
      tutorialCoach('5', 'Tutorial complete—you ran the full decision loop.', 'You framed the mission, queued a strike, made a logistics allocation, forecast uncertainty, committed, watched two seeded turns, and opened the AAR. Your tutorial results were not added to the career model.') +

      '<div class="dir-card"><h3>DENIAL / LODGMENT VERDICT</h3>' +
      '<div class="dir-metrics"><div class="dir-metric"><b>' + (lastDenial.throughput == null ? '—' : Math.round(lastDenial.throughput * 100) + '%') + '</b><span>RED THROUGHPUT · HALT &lt;30%</span></div>' +
      '<div class="dir-metric"><b>' + (lastDenial.osvi == null ? '—' : Math.round(lastDenial.osvi * 100) + '%') + '</b><span>RED SYSTEM COHERENCE</span></div>' +
      '<div class="dir-metric"><b>' + Math.round(lodgment * 100) + '%</b><span>LODGMENT ACCUMULATED</span></div>' +
      '<div class="dir-metric"><b>' + esc(result.at && result.at.dday != null ? 'D+' + result.at.dday : '—') + '</b><span>DECISION POINT</span></div></div>' + projectionLine + '</div>' +

      (op.tutorial ? '' : predictabilityCardHtml(st) + doctrineTrajectoryHtml(aar.redMind) + strategicAarHtml(aar.strategic)) +
      logisticsAarHtml(aar.logistics) +

      '<div class="dir-grid">' +
      '<div class="dir-card"><h3>SECONDARY ATTRITION LEDGER</h3>' + scoreBars(aar) + '<div class="dir-note">Score is descriptive; the denial/lodgment arbiter above decides the operation.</div></div>' +
      '<div class="dir-card"><h3>WHAT FELL</h3>' + top + '</div>' +
      '</div>' +

      '<div class="dir-card"><h3>HONESTY LEDGER — FORECAST vs THE WORLD</h3>' +
      '<table class="dir-ledger"><tr><th>Turn</th><th>Fcst Red down</th><th>Actual</th><th>Fcst Blue lost</th><th>Actual</th><th>Verdict</th></tr>' +
      ledgerRows() + '</table>' +
      '<div class="dir-note" style="margin-top:6px">A good forecast is honest, not lucky: actuals should land inside the band ~80% of the time.</div></div>' +

      (op.tutorial ? '' : calibrationCardHtml()) +

      (op.tutorial ? '' : '<div class="dir-card"><h3>COUNTERFACTUAL COLOSSEUM — ONE DECISION, TWO WORLDS</h3><div id="dir-colosseum"></div></div>') +

      '<div class="dir-actions">' +
      '<button class="dir-btn" data-act="copy-aar">COPY AAR</button>' +
      '<button class="dir-btn" data-act="download-aar">DOWNLOAD .MD</button>' +
      // CO-007 S3: serverless "beat my world" link — flag-gated; absent = nonexistent (I-3).
      (!op.tutorial && window.ShareModule && ShareModule.active() ?
        '<button class="dir-btn" data-act="challenge-link">COPY CHALLENGE LINK</button>' : '') +
      '<button class="dir-btn" data-act="exit-op">EXIT TO CONSOLE</button>' +
      (op.tutorial ? '<button class="dir-btn primary" data-act="full-op">START FULL OPERATION ▶</button>' :
        '<button class="dir-btn primary" data-act="new-op">NEW OPERATION ▶</button>') + '</div>';
    if (!op.tutorial) renderCounterfactualCard();
    // CO-006 P3: the debrief ceremony — verdict stamps first over silence, then the
    // ledgers deal in as cards (soft tick each). setPhase removes the deal class on exit.
    try {
      var wrap = $('dir-wrap');
      wrap.classList.add('cin-deal');
      wrap.querySelectorAll('.dir-card').forEach(function (c, i) { c.style.setProperty('--deal-i', i); });
    } catch (e) {}
    try { if (window.AudioFXModule) window.AudioFXModule.stopBed(1.2); } catch (e) {}
    cine('aarCinematic', { verdict: verdict.label, seed: op.record ? op.record.seed : '—' });
    comms('JOC', opAddr() + 'OPERATION CLOSED — AFTER-ACTION REVIEW READY');
    evt('After-action review opened.');
  }

  function aarMarkdown() {
    var ctx = scenarioContext(), aar = op.aar || {}, rec = op.record || {};
    var last = (aar.denialHistory || []).slice(-1)[0] || {};
    var lines = [
      '# StrikeSim After-Action Review', '',
      '**Scenario:** ' + (ctx.title || 'Taiwan Strait 2040'),
      '**Boundary:** ' + (ctx.classification || 'UNCLASSIFIED // NOTIONAL') + ' · Public-source baseline with explicit 2040 assumptions',
      '**Seed:** ' + (rec.seed || '—'),
      '**Turns:** ' + (aar.turns || rec.turn || '—'),
      '**Verdict:** ' + operationalVerdict(aar).label,
      '**Reason:** ' + (aar.reason || '—'), '',
      '## Decision frame', '',
      ctx.decisionQuestion || '', '',
      '## Final operational measures', '',
      '- Red throughput: ' + (last.throughput == null ? '—' : Math.round(last.throughput * 100) + '%') + ' (model halt threshold: below 30%)',
      '- Red system coherence: ' + (last.osvi == null ? '—' : Math.round(last.osvi * 100) + '%'),
      '- Lodgment accumulated: ' + Math.round(((aar.lodgment && aar.lodgment.value) || 0) * 100) + '%', '',
      '## Logistics endurance', ''
    ];
    ['blue', 'red'].forEach(function (side) {
      var row = aar.logistics && aar.logistics.sides && aar.logistics.sides[side];
      if (!row) return;
      var stocks = row.finalStocks || {}, totals = row.totals || {};
      lines.push('- ' + side.toUpperCase() + ': readiness ' + Math.round(Number(row.finalReadiness || 0) * 100) +
        '%, flow ' + Math.round(Number(row.finalFlow || 0) * 100) + '%, DDIL friction ' + Math.round(Number(row.finalDdil || 0) * 100) +
        '%, prepositioned buffer ' + Math.round(Number(row.finalPrepositioning || 0)) + '.');
      lines.push('- ' + side.toUpperCase() + ' final stocks: fuel ' + Math.round(Number(stocks.fuel || 0)) +
        ', ammunition ' + Math.round(Number(stocks.ammunition || 0)) + ', maintenance ' + Math.round(Number(stocks.maintenance || 0)) +
        ', personnel ' + Math.round(Number(stocks.personnel || 0)) + '; reroutes ' + Number(totals.reroutes || 0) +
        ', route repairs ' + Number(totals.routeRepairs || 0) + ', shortages ' + Number(totals.shortages || 0) + '.');
    });
    lines.push('',
      '## Turn record', ''
    );
    (rec.history || []).forEach(function (h) {
      lines.push('### Turn ' + h.turn, '');
      var orders = (h.orders && h.orders.blue) || [];
      if (!orders.length) lines.push('- Blue passed.');
      orders.forEach(function (o) {
        var tgt = GM.boardNode(o.targetId), src = o.sourceId ? GM.boardNode(o.sourceId) : null;
        lines.push('- ' + (o.kind || 'order').toUpperCase() + (o.methodKey ? ' / ' + o.methodKey.toUpperCase() : '') +
          (src ? ' via ' + src.name : '') + ' → ' + (tgt ? tgt.name : o.targetId));
      });
      var f = op.forecasts[h.turn], a = op.actuals[h.turn];
      if (f && a) lines.push('- Forecast Red down: ' + bandStr(f.redKills) + '; actual: ' + a.redKills + '. Forecast Blue lost: ' + bandStr(f.blueKills) + '; actual: ' + a.blueKills + '.');
      var d = (aar.denialHistory || []).filter(function (x) { return x.turn === h.turn; })[0];
      var l = (aar.lodgment && aar.lodgment.history || []).filter(function (x) { return x.turn === h.turn; })[0];
      if (d) lines.push('- Throughput ' + Math.round(d.throughput * 100) + '%; system coherence ' + Math.round(d.osvi * 100) + '%; lodgment ' + Math.round(((l && l.value) || 0) * 100) + '%.');
      var logi = h.report && h.report.logistics && h.report.logistics.sides && h.report.logistics.sides.blue;
      if (logi) {
        var after = logi.stocksAfter || {}, shortages = logi.shortages || [];
        lines.push('- Logistics allocation ' + String(logi.decision && logi.decision.id || 'balanced').toUpperCase() +
          '; readiness ' + Math.round(Number(logi.readiness || 0) * 100) + '%, flow ' + Math.round(Number(logi.flow || 0) * 100) +
          '%, DDIL ' + Math.round(Number(logi.ddil || 0) * 100) + '%, stocks F ' + Math.round(Number(after.fuel || 0)) +
          ' / A ' + Math.round(Number(after.ammunition || 0)) + ' / M ' + Math.round(Number(after.maintenance || 0)) +
          ' / P ' + Math.round(Number(after.personnel || 0)) + (shortages.length ? '; SHORTAGES: ' + shortages.join(', ') : '') + '.');
      }
      lines.push('');
    });
    var F = window.ForecastingModule;
    var calibrationEntries = readForecastArchive().filter(function (e) { return e && e.player != null && e.house != null && e.outcome != null; });
    var skill = F.brierSkill(calibrationEntries);
    var band = F.bootstrapBss(calibrationEntries, GM._internal.makeRng(GM._internal.hashSeed(rec.seed || 1, 'calibration-export', calibrationEntries.length)), 500);
    var rank = F.analystRank(calibrationEntries, band);
    lines.push('## House vs You calibration', '',
      '- Resolved calls: ' + calibrationEntries.length,
      '- Brier Skill Score vs house: ' + (skill.value == null ? 'undefined (house error was zero)' : (skill.value >= 0 ? '+' : '') + skill.value.toFixed(3)),
      '- 90% clustered bootstrap: ' + (band.lo == null ? 'not available' : (band.lo >= 0 ? '+' : '') + band.lo.toFixed(3) + ' to ' + (band.hi >= 0 ? '+' : '') + band.hi.toFixed(3)),
      '- Analyst track: ' + rank.label + ' — ' + rank.note,
      '- Copying the house scores BSS 0 by construction; one-world scores are noisy.', '');
    if (op.counterfactual && op.counterfactual.result) {
      var cf = op.counterfactual.result, ensemble = cf.ensemble, alternate = ensemble.counterfactual, value = ensemble.decisionValue;
      lines.push('## Counterfactual Colosseum', '',
        '- Authored blind halt frequency: ' + Math.round(cf.authoredForecast * 100) + '%.',
        '- Edited-order model worlds meeting the halt predicate: ' + alternate.hits + '/' + ensemble.K + ' (' + Math.round(alternate.q * 100) + '%; 90% Monte Carlo interval ' + Math.round(alternate.interval.lo * 100) + '–' + Math.round(alternate.interval.hi * 100) + '%).',
        '- Paired decision value: ' + (value.mean >= 0 ? '+' : '') + Math.round(value.mean * 100) + ' points (90% interval ' + Math.round(value.interval.lo * 100) + ' to ' + Math.round(value.interval.hi * 100) + ').',
        '- Brier against the counterfactual ensemble frequency: ' + cf.score.toFixed(3) + ' (MC-induced band ' + cf.scoreInterval.lo.toFixed(3) + '–' + cf.scoreInterval.hi.toFixed(3) + ').',
        '- One same-seed replay is a dramatic matched world; the 200-world distribution is the statistical comparison.', '');
    }
    lines.push('## Assumptions and public anchors', '', ctx.boundary || '', '');
    (ctx.sources || []).forEach(function (s) { if (safeHttpUrl(s.url)) lines.push('- [' + s.label + '](' + s.url + ')'); });
    lines.push('', '> Reasoning aid only. Outputs are model-conditioned comparisons, not predictions. Do not enter classified, CUI, client-sensitive, or personal information into the public deployment.', '');
    return lines.join('\n');
  }

  function copyAar() {
    var md = aarMarkdown();
    function ok() { op.aarExported = true; try { if (typeof window.showToast === 'function') window.showToast('AAR copied to the clipboard.', 'success'); } catch (e) {} }
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = md; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); ok(); } catch (e) {} ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(md).then(ok).catch(fallback); return; }
    fallback();
  }

  function downloadAar() {
    var blob = new Blob([aarMarkdown()], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'strikesim-aar-' + String(op.record && op.record.seed || 'operation').replace(/[^a-z0-9_-]+/gi, '-') + '.md';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 0);
    op.aarExported = true;
  }

  // CO-007 S3: mint the replay link — seed + committed order log + stated forecasts +
  // the PRE-match habit model (I-4), so the recipient's machine and the verifier can
  // re-resolve this exact operation. Serverless: the URL is the whole transport.
  function copyChallengeLink() {
    if (!(window.ShareModule && ShareModule.active() && op.record)) return;
    var cs = '';
    var c = cinApi();
    if (c && typeof c.getCallsign === 'function') { try { cs = String(c.getCallsign() || ''); } catch (e) {} }
    ShareModule.copyChallengeLink(op.record, {
      variantId: briefOpts.variantId || 'default',
      callsign: cs || null,
      forecastEntries: op.scoredEntries,
      startModel: op.startModel || null
    }, function (url) {
      if (url) {
        comms('JOC', 'CHALLENGE LINK COPIED — SEED ' + op.record.seed + ' · REPLAYABLE ORDER LOG EMBEDDED');
        try { if (typeof window.showToast === 'function') window.showToast('Challenge link copied. Anyone who opens it plays your exact world.', 'success'); } catch (e) {}
      } else {
        try { if (typeof window.showToast === 'function') window.showToast('Could not build the challenge link for this operation.', 'warn', 4000); } catch (e) {}
      }
    });
  }

  function onOverlayInput(ev) {
    var cfField = ev.target.getAttribute && ev.target.getAttribute('data-cf');
    if (cfField && op.phase === 'aar' && op.counterfactual && op.counterfactual.status !== 'running') {
      var cf = op.counterfactual;
      if (cfField === 'turn') { cf.turn = Number(ev.target.value); cf.orderIndex = 0; }
      else if (cfField === 'order') cf.orderIndex = Number(ev.target.value);
      else if (cfField === 'action') cf.action = ev.target.value;
      else if (cfField === 'target') cf.targetId = ev.target.value;
      else if (cfField === 'method') cf.methodKey = ev.target.value;
      else if (cfField === 'probability') {
        cf.authoredForecast = Number(ev.target.value) / 100;
        var probability = $('dir-cf-probability');
        if (probability) probability.textContent = Math.round(cf.authoredForecast * 100) + '%';
      }
      cf.result = null; cf.error = null; cf.status = 'idle';
      if (cfField !== 'probability' && cfField !== 'target' && cfField !== 'method') renderCounterfactualCard();
      return;
    }
    var card = op.commitCard;
    if (!card || op.phase !== 'commit') return;
    var values = card.step === 'blind' ? card.values : card.final;
    if (!values) return;
    var beliefId = ev.target.getAttribute && ev.target.getAttribute('data-belief-id');
    if (beliefId) {
      values.questions[beliefId] = Number(ev.target.value) / 100;
      if (card.step === 'blind') card.touched[beliefId] = true;
      var output = $('dir-value-' + beliefId);
      if (output) output.textContent = Math.round(values.questions[beliefId] * 100) + '%';
    }
    if (ev.target.hasAttribute && ev.target.hasAttribute('data-standing')) {
      values.standing = Number(ev.target.value) / 100;
      var standing = $('dir-value-standing');
      if (standing) standing.textContent = Math.round(values.standing * 100) + '%';
    }
    var causeId = ev.target.getAttribute && ev.target.getAttribute('data-premortem');
    if (causeId) {
      var next = Number(ev.target.value) / 100;
      var ids = Object.keys(values.premortem || {}), others = ids.filter(function (id) { return id !== causeId; });
      var oldOtherTotal = others.reduce(function (sum, id) { return sum + Number(values.premortem[id] || 0); }, 0);
      values.premortem[causeId] = next;
      others.forEach(function (id) {
        values.premortem[id] = oldOtherTotal > 0 ? Number(values.premortem[id] || 0) / oldOtherTotal * (1 - next) : (1 - next) / Math.max(1, others.length);
      });
      card.touched.premortem = true;
      ids.forEach(function (id) {
        var slider = $('dir-wrap').querySelector('[data-premortem="' + id + '"]');
        var outputPm = $('dir-value-pm-' + id);
        if (slider && id !== causeId) slider.value = Math.round(values.premortem[id] * 100);
        if (outputPm) outputPm.textContent = Math.round(values.premortem[id] * 100) + '%';
      });
    }
    var bound = ev.target.getAttribute && ev.target.getAttribute('data-interval');
    if (bound === 'lower' || bound === 'upper') {
      values[bound] = Number(ev.target.value) / 100;
      var interval = $('dir-value-interval');
      if (interval) interval.textContent = Math.round(values.lower * 100) + '–' + Math.round(values.upper * 100) + '%';
    }
    var submit = $('dir-wrap').querySelector('[data-act="' + (card.step === 'blind' ? 'submit-blind' : 'submit-final') + '"]');
    if (submit) submit.disabled = card.step === 'blind' ? !cardIsReady(card) : !(card.final.lower < card.final.upper);
  }

  // CO-007 S3: a challenge is the issuer's EXACT terms. Re-choosing any BRIEF chip is a
  // deliberate act that voids it — same map, your own career model, a freshly derived
  // seed — announced once on the comms floor, never an error.
  function voidChallenge() {
    if (!op.challenge) return;
    op.challenge = null;
    comms('JOC', 'CHALLENGE VOIDED — PARAMETERS CHANGED. STANDARD OPERATION TERMS APPLY.', 'warn');
  }

  // ---- overlay actions / lifecycle -----------------------------------------------------
  function onOverlayClick(ev) {
    var t = ev.target.closest('[data-act],[data-turns],[data-diff],[data-roe],[data-variant]');
    if (!t) return;
    if (t.hasAttribute('data-variant')) {
      var vid = t.getAttribute('data-variant');
      voidChallenge();
      if (selectVariant(vid)) {
        newBriefMatch(); renderBrief();
        sfxA('beep', { freq: 700, vol: 0.06, dur: 0.18 });
        comms('J35', 'FORCE NETWORKS SWAPPED — ' + variantLabel(vid) + ' · SEED ' + GMseed());
      }
      return;
    }
    if (t.hasAttribute('data-turns')) { voidChallenge(); briefOpts.turnLimit = Number(t.getAttribute('data-turns')); newBriefMatch(); renderBrief(); sfxA('tick', { vol: 0.03 }); return; }
    if (t.hasAttribute('data-diff')) { voidChallenge(); briefOpts.redDiff = t.getAttribute('data-diff'); newBriefMatch(); renderBrief(); sfxA('tick', { vol: 0.03 }); return; }
    if (t.hasAttribute('data-roe')) { voidChallenge(); briefOpts.roeId = t.getAttribute('data-roe'); newBriefMatch(); renderBrief(); sfxA('tick', { vol: 0.03 }); return; }
    var act = t.getAttribute('data-act');
    if (act === 'begin') beginPlanning();
    else if (act === 'tutorial-estimate') {
      var tutorialCard = op.commitCard;
      if (!op.tutorial || !tutorialCard || tutorialCard.step !== 'blind') return;
      var coachValues = [0.55, 0.35, 0.25];
      tutorialCard.set.questions.forEach(function (q, i) {
        tutorialCard.values.questions[q.id] = coachValues[i % coachValues.length];
        tutorialCard.touched[q.id] = true;
      });
      var causes = tutorialCard.set.premortem.categories || [];
      causes.forEach(function (cause, i) { tutorialCard.values.premortem[cause.id] = i === 0 ? 0.4 : 0.6 / Math.max(1, causes.length - 1); });
      tutorialCard.touched.premortem = true;
      renderBlindCommit();
      var blindButton = $('dir-wrap').querySelector('[data-act="submit-blind"]');
      if (blindButton) blindButton.focus();
    }
    else if (act === 'unlock-commit') {
      if (op.commitCard && op.commitCard.step === 'blind') {
        var unlockTurn = op.commitCard.turn;
        GM._internal.unlockOrders('blue');
        delete op.forecasts[unlockTurn];
        op.commitCard = null; op.lastForecast = null;
        setPhase('plan'); renderDock(); focusPlanControl();
        cine('planCinematic');   // CO-006 P2: back out of the ceremony register
        comms('J3', 'ORDERS UNLOCKED — REPLANNING TURN ' + unlockTurn);
      }
    }
    else if (act === 'submit-blind') {
      if (!cardIsReady(op.commitCard)) return;
      op.commitCard.blind = copyBeliefValues(op.commitCard.values);
      op.commitCard.final = copyBeliefValues(op.commitCard.values);
      op.commitCard.step = 'hybrid';
      renderHybridCommit();
      sfxA('arm');   // CO-006 P2: the board goes hot with the house reveal
      comms('J35', 'HOUSE LINE REVEALED — TURN ' + op.commitCard.turn + ' · ONE REVISION AUTHORIZED');
    }
    else if (act === 'submit-final') {
      if (!op.commitCard || op.commitCard.step !== 'hybrid' || !(op.commitCard.final.lower < op.commitCard.final.upper)) return;
      op.commitCard.step = 'ready';
      op.standingCarry = op.commitCard.final.standing;
      execute();
    }
    else if (act === 'copy-aar') copyAar();
    else if (act === 'download-aar') downloadAar();
    else if (act === 'challenge-link') copyChallengeLink();
    else if (act === 'run-counterfactual') runCounterfactual();
    else if (act === 'run-exploit-probe') runExploitProbe();
    else if (act === 'exit') abortOperation(true);
    else if (act === 'exit-op') { endOperation(); cine('exitCinematic'); }   // CO-006 P3: letterbox back to the title front door
    else if (act === 'full-op') { endOperation(); start(); }
    else if (act === 'new-op') { endOperation(); start(); }
  }

  function abortOperation(silent) {
    if (!silent && !window.confirm('Abort the operation? The match will be discarded.')) return;
    endOperation();
  }

  function endOperation() {
    clearWatchTimers();
    stopCounterfactualWorker();
    stopSelPoll();
    hideObjectiveOverlay();
    if (GM.isActive()) GM.endMatch();
    op.forecasts = {}; op.actuals = {}; op.judgments = {}; op.standingForecasts = [];
    op.scoredEntries = []; op.intervalScores = []; op.commitCard = null; op.standingCarry = null;
    op.record = null; op.counterfactual = null; op.aar = null; op.aarExported = false; op.lastForecast = null;
    op.tutorial = false;
    restoreBaseScenario();                     // CO-005 C5: put the boot force networks back
    restorePanels();
    try { if (window.AudioFXModule) window.AudioFXModule.stopBed(0.8); } catch (e) {}   // CO-006 P2
    cine('commsVisible', true);                // reset the floor for the next operation
    setPhase('idle');
    refreshVisuals();
    try { (op.returnFocus || $('dir-launch')).focus(); } catch (e) {}
    op.returnFocus = null;
    evt('Operation closed — scenario restored.');
  }

  // ---- boot ---------------------------------------------------------------------------
  function boot() {
    GM = window.GameModule || null;
    if (!GM) { try { console.warn('[director] GameModule missing — Operation loop disabled.'); } catch (e) {} return; }
    injectCss();
    buildDom();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  return { start: start, startTutorial: startTutorial, end: endOperation, _op: op };
})();
