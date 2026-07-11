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
    lastForecast: null,
    record: null,         // GM.serialize() snapshot at match end (for counterfactuals)
    aar: null,
    aarExported: false,
    watchTimers: [],
    selPoll: null,
    lastSelId: null,
    panelState: null,      // shell rails before the guided operation takes focus
    focusMode: true,
    modalIsolation: null,
    returnFocus: null
  };

  // ---- tiny utils -----------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function evt(text) { try { if (typeof addEvent === 'function') addEvent({ type: 'War', text: text }); } catch (e) {} }
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
  function refreshVisuals() {
    try { if (typeof refreshMapMarkers === 'function') refreshMapMarkers(); } catch (e) {}
    try { if (typeof refreshTable === 'function') refreshTable(); } catch (e) {}
    try { if (typeof updateTeamSummary === 'function') updateTeamSummary(); } catch (e) {}
  }
  function forceMapView() { try { if (typeof window.setView === 'function') window.setView('map'); } catch (e) {} }
  function curSel() { try { return (typeof selectedNode !== 'undefined') ? selectedNode : null; } catch (e) { return null; } }
  function prefersReducedMotion() { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function scenarioContext() {
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
      'no-target': 'Choose a target first.',
      'no-ap': 'No orders remain this turn.',
      'bad-method': 'Choose a valid delivery method.'
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
      'border-radius:12px;padding:16px 18px;margin-bottom:14px;}',
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
      '.dir-chips{display:flex;gap:6px;}',
      '.dir-chip{appearance:none;background:#0b1a26;border:1px solid #1d3a52;color:#8fb2ca;border-radius:7px;padding:5px 11px;cursor:pointer;font:600 12px Inter;}',
      '.dir-chip.on{background:#0e3a55;color:#c9f2ff;border-color:#2f88b8;}',
      '.dir-chip:disabled{opacity:.38;cursor:not-allowed;text-decoration:line-through;}',
      // forecast strip
      '.dir-fc{border:1px solid #234a66;background:rgba(9,22,33,.9);border-radius:10px;padding:12px 14px;margin:12px 0;}',
      '.dir-fc .t{font:700 11px Oswald;letter-spacing:.22em;color:#00d8ff;margin-bottom:8px;}',
      '.dir-fc .rows{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;text-align:center;}',
      '.dir-fc .cell b{display:block;font:700 20px Oswald;color:#eaf6fd;}',
      '.dir-fc .cell span{font-size:11px;color:#7f9db5;letter-spacing:.06em;}',
      '.dir-fc .honesty{margin-top:9px;font-size:11.5px;color:#6d8ca4;font-style:italic;text-align:center;}',
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
      '.dir-probe{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px dotted #16283a;}',
      '.dir-probe .res{font-size:12.5px;color:#ffd9a8;}',
      '.dir-verdict{font:700 26px Oswald;letter-spacing:.08em;margin:2px 0 2px;}',
      '.dir-verdict.win{color:#7be3a1;} .dir-verdict.loss{color:#ff9d94;} .dir-verdict.draw{color:#ffd27b;}',
      '.dir-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px;}',
      '.dir-metric{background:#091923;border:1px solid #19364a;border-radius:8px;padding:9px;text-align:center;}',
      '.dir-metric b{display:block;color:#e8f7ff;font:700 20px Oswald,system-ui;}.dir-metric span{color:#789bb2;font-size:10px;letter-spacing:.08em;}',
      '@media(max-width:760px){.dir-grid,.dir-context{grid-template-columns:1fr}.dir-metrics{grid-template-columns:1fr 1fr}.dir-fc .rows{grid-template-columns:1fr;gap:5px}.dir-fc .cell{display:flex;align-items:baseline;justify-content:space-between;text-align:left;border-bottom:1px dotted #193247;padding:4px 0}.dir-fc .cell b{font-size:17px}.dir-h1{font-size:27px}#dir-overlay .wrap{margin-top:4vh;padding:0 14px}.dir-actions{justify-content:stretch}.dir-actions .dir-note{flex:1 1 100%}.dir-actions .dir-btn{flex:1}#dir-dock{bottom:8px;width:calc(100vw - 16px);padding:8px}#dir-rail .ph:not(.on),#dir-rail .sep{display:none}#dir-rail{max-width:calc(100vw - 16px);white-space:nowrap}}',
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
    var meta = st ? '<span class="meta">TURN ' + st.turn + '/' + st.cfg.turnLimit + '</span>' : '';
    var tools = (op.phase === 'plan' || op.phase === 'watch') ?
      '<button class="mode" data-act="panels" title="' + (op.focusMode ? 'Open the expert analysis rails' : 'Collapse the analysis rails and focus the map') + '">' +
      (op.focusMode ? 'ADVANCED ANALYSIS' : 'FOCUS MAP') + '</button>' : '';
    r.innerHTML = chips + meta + tools + '<button data-act="abort" aria-label="Abort operation" title="Abort operation">✕</button>';
    r.style.display = 'flex';
  }

  function setPhase(p) {
    op.phase = p;
    if (p !== 'plan') stopSelPoll();
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

  // ---- BRIEF ------------------------------------------------------------------------
  var briefOpts = { turnLimit: 8, redDiff: 'hard' };

  function start() {
    if (!GM) return;
    if (!startReady()) {
      try { if (typeof window.showToast === 'function') window.showToast('The bundled scenario is still loading. Try Operation again in a moment.', 'warn', 5000); } catch (e) {}
      return;
    }
    if (GM.isActive()) GM.endMatch();
    op.returnFocus = $('dir-launch');
    GM.init({ onResolved: function () {}, onState: function () {} });   // Director drives; legacy HUD stays dormant
    newBriefMatch();
    setPhase('brief');
    renderBrief();
    evt('Operation started — briefing.');
  }

  function newBriefMatch() {
    GM.newMatch({
      turnLimit: briefOpts.turnLimit,
      control: { blue: 'human', red: 'ai' },
      difficulty: { blue: 'hard', red: briefOpts.redDiff }
    });
    op.forecasts = {}; op.actuals = {}; op.record = null; op.aar = null; op.aarExported = false; op.targetId = null;
    op.panelState = null; op.focusMode = true;
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
      '<div class="dir-stat"><span>Decision budget</span><b>' + st.ap.blue + ' orders / turn (tempo-driven)</b></div>' +
      '</div>' +
      '<div class="dir-card"><h3>FORCE BALANCE</h3>' +
      '<div class="dir-stat"><span>Blue Joint Force</span><b>' + st.alive.blue + ' enabled nodes · AP ' + st.ap.blue + '</b></div>' +
      '<div class="dir-note" style="margin:7px 0 9px">' + blueJointMixText() + '</div>' +
      '<div class="dir-stat"><span>Red force</span><b>' + st.alive.red + ' nodes · AP ' + st.ap.red + '</b></div>' +
      '<div class="dir-stat"><span>Blue tempo assets</span><b>' + st.tempo.blue.c2 + ' C2 · ' + st.tempo.blue.logi + ' LOG</b></div>' +
      '<div class="dir-stat"><span>Red tempo assets</span><b>' + st.tempo.red.c2 + ' C2 · ' + st.tempo.red.logi + ' LOG</b></div>' +
      '<div class="dir-note" style="margin-top:8px"><b>INTEL ASSESSMENT — PLA POSTURE:</b> ' + esc(postureText) + '. This is the disclosed prior, not Red’s hidden draw.</div>' +
      '<div class="dir-note" style="margin-top:8px">Strikes, hardens and repairs each cost one order. A node killed this turn still acts — both sides committed first.</div>' +
      '</div>' +
      '</div>' +

      '<div class="dir-grid">' +
      '<div class="dir-card"><h3>YOUR KEY OBJECTIVES (DEFEND)</h3>' + objList(st, 'blue') + '</div>' +
      '<div class="dir-card"><h3>RED KEY SYSTEMS (DISRUPT)</h3>' + objList(st, 'red') + '</div>' +
      '</div>' +

      '<div class="dir-card"><h3>OPERATION PARAMETERS</h3>' +
      '<div class="row" style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">' +
      '<span class="dir-note">Turn budget</span><span class="dir-chips">' +
      [6, 8, 10].map(function (n) { return '<button type="button" class="dir-chip' + (briefOpts.turnLimit === n ? ' on' : '') + '" aria-pressed="' + (briefOpts.turnLimit === n) + '" data-turns="' + n + '">' + n + ' TURNS</button>'; }).join('') +
      '</span><span class="dir-note">Red doctrine strength</span><span class="dir-chips">' +
      ['easy', 'hard', 'elite'].map(function (d) { return '<button type="button" class="dir-chip' + (briefOpts.redDiff === d ? ' on' : '') + '" aria-pressed="' + (briefOpts.redDiff === d) + '" data-diff="' + d + '">' + (d === 'hard' ? 'CONTESTED' : d === 'elite' ? 'ELITE' : 'TRAINING') + '</button>'; }).join('') +
      '</span></div></div>' +

      '<div class="dir-actions"><span class="dir-note">Seed ' + esc(String(GMseed())) + ' — this operation is exactly replayable.</span>' +
      '<button class="dir-btn" data-act="exit">EXIT</button>' +
      '<button class="dir-btn primary" data-act="begin">BEGIN PLANNING →</button></div>';
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
    setPhase('plan');
    forceMapView();
    renderDock();
    focusPlanControl();
    startSelPoll();
    showObjectiveOverlay();
    evt('Planning phase — turn ' + GM.getState().turn + '.');
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
      if (!b || !b.alive) return;
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
    var pool = ids.map(function (id) { return GM.boardNode(id); }).filter(Boolean);
    if (op.kind === 'strike') pool = pool.filter(function (b) { return b.team === 'red'; }).sort(function (a, b) { return nodeVal(b) - nodeVal(a); });
    else {
      pool = pool.filter(function (b) { return b.team === 'blue'; });
      if (op.kind === 'repair') pool = pool.filter(function (b) { return b.health < (b.healthMax || 100); }).sort(function (a, b) { return a.health - b.health; });
      else pool.sort(function (a, b) { return nodeVal(b) - nodeVal(a); });
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

  function renderDock() {
    var st = GM.getState();
    if (!st) return;
    var apMax = st.ap.blue, apLeft = st.apLeft.blue;
    var lastDenial = (st.denialHistory || []).slice(-1)[0] || null;
    var operationalStatus = (lastDenial ? 'RED THR <b>' + Math.round(lastDenial.throughput * 100) + '%</b> · ' : '') +
      'LODG <b>' + Math.round(((st.lodgment && st.lodgment.value) || 0) * 100) + '%</b>';
    var pips = '';
    for (var i = 0; i < apMax; i++) pips += '<i class="' + (i < apLeft ? 'full' : '') + '"></i>';
    var methods = GM.methods();
    var optsHtml = targetOptions();   // resolves op.targetId to the pool default first
    var tgt = op.targetId ? GM.boardNode(op.targetId) : null;
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
    var validationNote = validity.ok ? '' : '<span class="dir-note" style="color:#e8ad77">' + esc(explainInvalid(validity.reason)) + '</span>';
    var queue = st.orders.blue.map(function (o, i) {
      var n = GM.boardNode(o.targetId);
      var src = o.sourceId ? GM.boardNode(o.sourceId) : null;
      var cls = o.kind === 'harden' ? 'h' : (o.kind === 'repair' ? 'r' : '');
      var lbl = o.kind === 'strike' ? (methods[o.methodKey] ? methods[o.methodKey].short : 'KE') + (src ? ' via ' + esc(src.name.slice(0, 28)) : '') + ' → ' : (o.kind.toUpperCase() + ' ');
      return '<span class="oq ' + cls + '">' + lbl + esc(n ? n.name.slice(0, 34) : o.targetId) + '<button type="button" class="remove" data-rm="' + i + '" aria-label="Remove order" title="Remove">✕</button></span>';
    }).join('') || '<span class="dir-note">No orders queued — click a node on the map or pick a target below.</span>';

    $('dir-dock').innerHTML =
      '<div class="row">' +
      '<span class="stat">TURN <b>' + st.turn + '/' + st.cfg.turnLimit + '</b></span>' +
      '<span class="stat ap">ORDERS ' + pips + '</span>' +
      '<span class="stat">TEMPO <b>' + Math.round(st.tempo.blue.frac * 100) + '%</b></span>' +
      '<span class="stat">OBJ <b>' + st.objectives.blue.held + '/' + st.objectives.blue.total + ' held</b></span>' +
      '<span class="stat">RED OBJ <b>' + st.objectives.red.held + '/' + st.objectives.red.total + ' standing</b></span>' +
      '<span class="spacer"></span>' +
      '<span class="stat">' + operationalStatus + '</span>' +
      '</div>' +
      '<div class="row">' +
      '<span class="dir-chips">' +
      ['strike', 'harden', 'repair'].map(function (k) { return '<button type="button" class="dir-chip' + (op.kind === k ? ' on' : '') + '" aria-pressed="' + (op.kind === k) + '" data-kind="' + k + '">' + k.toUpperCase() + '</button>'; }).join('') +
      '</span>' +
      '<label class="stat" for="dir-target">TARGET</label><select id="dir-target" aria-label="Order target">' + (optsHtml || '<option value="">— no valid targets —</option>') + '</select>' +
      (op.kind === 'strike' ? '<span class="dir-chips">' + methodChips + '</span>' : '') +
      '<button class="dir-btn" data-act="queue"' + (validity.ok ? '' : ' disabled') + '>+ QUEUE ORDER</button>' + validationNote +
      '</div>' +
      reconHtml(tgt) +
      '<div class="row q">' + queue + '</div>' +
      '<div class="row"><span class="dir-note">Orders lock blind; Red commits when you execute.</span><span class="spacer"></span>' +
      (st.orders.blue.length ? '<button class="dir-btn primary" data-act="forecast">REVIEW FORECAST →</button>' :
        '<button class="dir-btn" data-act="pass">PASS TURN</button><button class="dir-btn primary" disabled>QUEUE AN ORDER TO CONTINUE</button>') + '</div>';
    var sel = $('dir-target');
    if (sel && sel.value) op.targetId = sel.value;
    renderRail();
  }

  function onDockChange(ev) {
    if (ev.target.id === 'dir-target') { op.targetId = ev.target.value; renderDock(); }
  }

  function onDockClick(ev) {
    var t = ev.target.closest('[data-kind],[data-method],[data-act],[data-rm]');
    if (!t) return;
    if (t.hasAttribute('data-kind')) { op.kind = t.getAttribute('data-kind'); op.targetId = null; renderDock(); return; }
    if (t.hasAttribute('data-method')) { op.methodKey = t.getAttribute('data-method'); renderDock(); return; }
    if (t.hasAttribute('data-rm')) { GM.removeOrder('blue', Number(t.getAttribute('data-rm'))); renderDock(); return; }
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
    return cache;
  }

  function ghostForecast(K) {
    var I = GM._internal;
    var s = GM.serialize();
    var st = GM.getState();
    var belief = window.RedMindModule.normalizeBelief(st.redMind && st.redMind.belief);
    var planCache = ghostPlanCache(I, s, st);
    var blueOrders = st.orders.blue;
    var objBlue = st.objectiveIds.blue || [];
    var redKills = [], blueKills = [], swing = [], objHitWorlds = 0;
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
    }
    return {
      K: K, turn: s.turn,
      belief: belief,
      planningRollouts: planCache.rollouts,
      redKills: band(redKills), blueKills: band(blueKills),
      objRisk: Math.round(100 * objHitWorlds / K), swing: band(swing)
    };
  }

  function forecastStrip(f) {
    return '<div class="dir-fc"><div class="t">FORECAST — THIS TURN ACROSS ' + f.K + ' WORLDS</div>' +
      '<div class="rows">' +
      '<div class="cell"><b>' + bandStr(f.redKills) + '</b><span>RED NODES DOWN (10th–90th pct)</span></div>' +
      '<div class="cell"><b>' + bandStr(f.blueKills) + '</b><span>BLUE NODES LOST</span></div>' +
      '<div class="cell"><b>' + f.objRisk + '%</b><span>WORLDS WHERE A KEY OBJECTIVE FALLS</span></div>' +
      '</div>' +
      '<div class="honesty">Ghost Red types are sampled from your current intel assessment (' +
      Math.round((f.belief.attrition || 0) * 100) + '/' + Math.round((f.belief.decapitation || 0) * 100) + '/' + Math.round((f.belief.denial || 0) * 100) +
      '). This is a range, not a promise; one seeded world resolves.</div></div>';
  }

  // ---- COMMIT (the ritual) -------------------------------------------------------------
  function openCommit() {
    var st = GM.getState();
    if (!st || st.phase !== 'plan') return;   // never forecast/commit a finished match
    op.lastForecast = ghostForecast(GHOSTS);
    op.forecasts[st.turn] = op.lastForecast;
    setPhase('commit');
    var methods = GM.methods();
    var rows = st.orders.blue.length ? st.orders.blue.map(function (o) {
      var n = GM.boardNode(o.targetId);
      var src = o.sourceId ? GM.boardNode(o.sourceId) : null;
      var what = o.kind === 'strike' ? (methods[o.methodKey] ? methods[o.methodKey].name : 'Strike') : o.kind.charAt(0).toUpperCase() + o.kind.slice(1);
      return '<div class="dir-obj"><span>' + esc(what) + ' → ' + esc(n ? n.name : o.targetId) + '</span><span class="v">' + (src ? 'via ' + esc(src.name) : (n ? esc(n.difficulty || '') : '')) + '</span></div>';
    }).join('') : '<div class="dir-note" style="color:#ffd18a">Deliberate pass: Blue will take no action this turn. Red will still act.</div>';

    $('dir-wrap').innerHTML =
      '<div class="dir-kicker">COMMIT · TURN ' + st.turn + '/' + st.cfg.turnLimit + '</div>' +
      '<h1 class="dir-h1">Review and commit.</h1>' +
      '<div class="dir-sub">Red will commit simultaneously when you execute. Resolution is seeded and irreversible.</div>' +
      '<div class="dir-card"><h3>YOUR ORDERS (' + st.orders.blue.length + '/' + st.ap.blue + ')</h3>' + rows + '</div>' +
      forecastStrip(op.lastForecast) +
      '<div class="dir-actions">' +
      '<span class="dir-note">Seed ' + esc(String(GMseed())) + ' · turn draw is deterministic.</span>' +
      '<button class="dir-btn" data-act="back">← REVISE</button>' +
      '<button class="dir-btn primary" data-act="execute">COMMIT &amp; EXECUTE ▶</button></div>';
  }

  // ---- WATCH (paced playback of the one true draw) --------------------------------------
  function execute() {
    var stBefore = GM.getState();
    if (!stBefore || stBefore.phase !== 'plan') return;
    var turn = stBefore.turn;
    var st = GM.commitTurn();
    setPhase('watch');
    forceMapView();
    // Keep the pre-turn visual picture in place during paced narration. The engine has
    // resolved deterministically, but the map/table refresh only when the outcome lands,
    // so the final state does not spoil its own playback.
    var report = st.lastReport || { events: [] };
    op.actuals[turn] = actualSummary(report);
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
    feed.innerHTML = '<div class="fl sys">TURN ' + report.turn + ' — EXECUTION · ' + events.length + ' EVENTS' +
      (instant ? ' · REDUCED MOTION' : ' <button class="dir-btn dir-skip" data-act="skip-watch">SHOW RESULT NOW</button>') + '</div>';
    if (instant) {
      events.forEach(function (e) { feed.insertAdjacentHTML('beforeend', feedLine(e)); });
      showOutcome(st, report);
      feed.scrollTop = feed.scrollHeight;
      return;
    }
    var step = events.length > 40 ? Math.max(110, Math.floor(13000 / events.length)) : 330;
    events.forEach(function (e, i) {
      op.watchTimers.push(setTimeout(function () {
        feed.insertAdjacentHTML('beforeend', feedLine(e));
        feed.scrollTop = feed.scrollHeight;
        if ((e.kind === 'hit' || e.kind === 'kill') && window.MapModule) {
          try { MapModule.flashStrike(e.sourceId, e.targetId, { team: e.side, kill: e.kind === 'kill' }); } catch (er) {}
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
    var f = op.forecasts[report.turn], a = op.actuals[report.turn];
    var honesty = (f && a) ?
      '<div class="dir-note">Forecast said ' + bandStr(f.redKills) + ' Red down — the world drew ' + a.redKills + '.' +
      (a.redKills >= f.redKills.lo && a.redKills <= f.redKills.hi ? ' Inside the band.' : ' Outside the band — note it.') + '</div>' : '';
    var over = st.phase === 'over';
    var lastTurn = !over && st.turn >= st.cfg.turnLimit;   // turn limit ends the match on advance
    var denial = (st.denialHistory || []).slice(-1)[0] || null;
    var denialLine = denial ? '<br>Red throughput <b>' + Math.round(denial.throughput * 100) + '%</b> (halt &lt;30%) · system coherence <b>' + Math.round(denial.osvi * 100) + '%</b> · lodgment <b>' + Math.round(((st.lodgment && st.lodgment.value) || 0) * 100) + '%</b>' : '';
    var html = '<div class="outcome"><b>TURN ' + report.turn + ' COMPLETE</b><br>' +
      'Red lost <b>' + (a ? a.redKills : 0) + '</b> · Blue lost <b>' + (a ? a.blueKills : 0) + '</b> · ' +
      'Your objectives <b>' + st.objectives.blue.held + '/' + st.objectives.blue.total + '</b> · ' +
      'Tempo <b>' + Math.round(st.tempo.blue.frac * 100) + '%</b>' + denialLine + '<br>' + honesty +
      '<div class="dir-actions" style="margin-top:10px">' +
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
  function freshBoard() {
    var I = GM._internal;
    var board = I.buildBoard(AppState.activeGraph());
    for (var id in board.nodes) { var b = board.nodes[id]; b.health = b.healthMax || 100; b.alive = true; }
    return board;
  }

  function outcomeCheck(board, rec, score) {
    var I = GM._internal;
    var objB = I.objectiveValue(board, 'blue'), objR = I.objectiveValue(board, 'red');
    function held(side) {
      var ids = rec.objectives[side] || [];
      var h = 0; ids.forEach(function (id) { var n = board.nodes[id]; if (n && n.alive) h++; });
      return { h: h, t: ids.length };
    }
    var hb = held('blue'), hr = held('red');
    var bDown = (objB <= rec.startObj.blue * rec.cfg.collapseFrac) || (hb.t > 0 && hb.h / hb.t <= OBJ_LOSS_FRAC);
    var rDown = (objR <= rec.startObj.red * rec.cfg.collapseFrac) || (hr.t > 0 && hr.h / hr.t <= OBJ_LOSS_FRAC);
    var winner = null;
    if (bDown && rDown) winner = objB >= objR ? 'blue' : 'red';
    else if (rDown) winner = 'blue';
    else if (bDown) winner = 'red';
    return { winner: winner, heldBlue: hb, heldRed: hr, objB: objB, objR: objR, score: score };
  }

  // Replay the recorded operation in the SAME seeded world, with blue's orders passed
  // through `policy(turnRec, board, blueOrders) -> blueOrders'`. Red replays its recorded
  // orders (invalid ones void naturally). Returns the alternate outcome.
  function replayWith(policy, label) {
    var I = GM._internal;
    var rec = op.record;
    if (!rec) return null;
    var board = freshBoard();
    var score = { blue: 0, red: 0 };
    var result = null;
    for (var i = 0; i < rec.history.length; i++) {
      var h = rec.history[i];
      var blue = (h.orders.blue || []).map(function (o) { return Object.assign({}, o); });
      if (policy) blue = policy(h, board, blue) || blue;
      var orders = blue.concat(h.orders.red || []);
      var rep = I.resolveTurn(board, orders, rec.cfg, I.makeRng(I.hashSeed(rec.seed, 'resolve', h.turn)));
      score.blue += rep.scoreDelta.blue; score.red += rep.scoreDelta.red;
      result = outcomeCheck(board, rec, score);
      if (result.winner) { result.endedTurn = h.turn; break; }
    }
    if (result && !result.winner) {
      result.winner = score.blue !== score.red ? (score.blue > score.red ? 'blue' : 'red')
        : (result.objB >= result.objR ? 'blue' : 'red');
      result.endedTurn = rec.history.length;
      result.byScore = true;
    }
    if (result) result.label = label;
    return result;
  }

  function bestRedTempoTarget(board) {
    var best = null, bv = -1;
    for (var id in board.nodes) {
      var b = board.nodes[id];
      if (!b.alive || b.team !== 'red') continue;
      var isTempo = /command|c2|logistic|relay|comm/i.test((b.type || '') + ' ' + (b.subsystem || ''));
      if (!isTempo) continue;
      var v = nodeVal(b);
      if (v > bv) { bv = v; best = b; }
    }
    return best;
  }
  function bestRedTarget(board) {
    var best = null, bv = -1;
    for (var id in board.nodes) {
      var b = board.nodes[id];
      if (b.alive && b.team === 'red' && nodeVal(b) > bv) { bv = nodeVal(b); best = b; }
    }
    return best;
  }
  function ownObjectiveAlive(board, rec) {
    var ids = rec.objectives.blue || [];
    for (var i = 0; i < ids.length; i++) { var b = board.nodes[ids[i]]; if (b && b.alive) return b; }
    return null;
  }

  var PROBES = {
    decap: {
      title: 'Decapitation-first',
      desc: 'Every Blue strike retargets the highest-value living Red C2 / logistics node instead.',
      policy: function (h, board, blue) {
        return blue.map(function (o) {
          if (o.kind !== 'strike') return o;
          var t = bestRedTempoTarget(board) || bestRedTarget(board);
          if (t) o.targetId = t.id;
          return o;
        });
      }
    },
    offense: {
      title: 'All-in offense',
      desc: 'Every Blue harden / repair becomes another kinetic strike on Red’s best target.',
      policy: function (h, board, blue) {
        return blue.map(function (o) {
          if (o.kind === 'strike') return o;
          var t = bestRedTarget(board);
          return t ? { side: 'blue', kind: 'strike', methodKey: 'kinetic', targetId: t.id } : o;
        });
      }
    },
    turtle: {
      title: 'Pure defense',
      desc: 'Every Blue strike becomes a harden on your own key objectives instead.',
      policy: function (h, board, blue) {
        return blue.map(function (o) {
          if (o.kind !== 'strike') return o;
          var t = ownObjectiveAlive(board, op.record);
          return t ? { side: 'blue', kind: 'harden', targetId: t.id } : o;
        });
      }
    }
  };

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

  function openAar() {
    var st = GM.getState();
    op.record = GM.serialize();
    setPhase('aar');
    var aar = st.aar || {};
    op.aar = aar;
    var verdict = operationalVerdict(aar);
    var lastDenial = (aar.denialHistory || []).slice(-1)[0] || {};
    var lodgment = aar.lodgment ? Number(aar.lodgment.value || 0) : 0;
    var result = aar.result || {};
    var projection = result.projection || null;
    var projectionLine = projection ? '<div class="dir-note" style="margin-top:8px">Hard-horizon projection: lodgment sustained in <b>' + projection.lodgmentSustainedPct + '%</b> of seeded continuations; halt in <b>' + projection.haltPct + '%</b>. This is a model distribution, not a real-world probability.</div>' : '';
    var probes = Object.keys(PROBES).map(function (k) {
      var p = PROBES[k];
      return '<div class="dir-probe"><div><b>' + esc(p.title) + '</b><div class="dir-note">' + esc(p.desc) + '</div>' +
        '<div class="res" id="dir-probe-' + k + '"></div></div>' +
        '<button class="dir-btn" data-probe="' + k + '">RUN</button></div>';
    }).join('');
    var top = (aar.topNeutralized || []).slice(0, 5).map(function (t) {
      return '<div class="dir-obj"><span>' + esc(t.name) + '</span><span class="v">' + (t.team || '') + ' · val ' + Math.round(t.value) + (t.cascaded ? ' · cascade' : '') + '</span></div>';
    }).join('') || '<div class="dir-note">No nodes neutralized.</div>';

    $('dir-wrap').innerHTML =
      '<div class="dir-kicker">AFTER-ACTION REVIEW · ' + (aar.turns || st.turn) + ' TURNS · SEED ' + esc(String(op.record ? op.record.seed : '')) + '</div>' +
      '<div class="dir-verdict ' + verdict.cls + '">' + verdict.label + '</div>' +
      '<div class="dir-sub">' + esc(aar.reason || '') + '</div>' +

      '<div class="dir-card"><h3>DENIAL / LODGMENT VERDICT</h3>' +
      '<div class="dir-metrics"><div class="dir-metric"><b>' + (lastDenial.throughput == null ? '—' : Math.round(lastDenial.throughput * 100) + '%') + '</b><span>RED THROUGHPUT · HALT &lt;30%</span></div>' +
      '<div class="dir-metric"><b>' + (lastDenial.osvi == null ? '—' : Math.round(lastDenial.osvi * 100) + '%') + '</b><span>RED SYSTEM COHERENCE</span></div>' +
      '<div class="dir-metric"><b>' + Math.round(lodgment * 100) + '%</b><span>LODGMENT ACCUMULATED</span></div>' +
      '<div class="dir-metric"><b>' + esc(result.at && result.at.dday != null ? 'D+' + result.at.dday : '—') + '</b><span>DECISION POINT</span></div></div>' + projectionLine + '</div>' +

      '<div class="dir-grid">' +
      '<div class="dir-card"><h3>SECONDARY ATTRITION LEDGER</h3>' + scoreBars(aar) + '<div class="dir-note">Score is descriptive; the denial/lodgment arbiter above decides the operation.</div></div>' +
      '<div class="dir-card"><h3>WHAT FELL</h3>' + top + '</div>' +
      '</div>' +

      '<div class="dir-card"><h3>HONESTY LEDGER — FORECAST vs THE WORLD</h3>' +
      '<table class="dir-ledger"><tr><th>Turn</th><th>Fcst Red down</th><th>Actual</th><th>Fcst Blue lost</th><th>Actual</th><th>Verdict</th></tr>' +
      ledgerRows() + '</table>' +
      '<div class="dir-note" style="margin-top:6px">A good forecast is honest, not lucky: actuals should land inside the band ~80% of the time.</div></div>' +

      '<div class="dir-card"><h3>EXPERIMENTAL ATTRITION SENSITIVITY — SAME DRAW, ONE CHANGED POLICY</h3>' +
      '<div class="dir-note" style="margin-bottom:6px">Directional comparison only: these legacy probes replay objective collapse and attrition score; they do not reproduce the invasion denial/lodgment arbiter above.</div>' +
      probes + '</div>' +

      '<div class="dir-actions">' +
      '<button class="dir-btn" data-act="copy-aar">COPY AAR</button>' +
      '<button class="dir-btn" data-act="download-aar">DOWNLOAD .MD</button>' +
      '<button class="dir-btn" data-act="exit-op">EXIT TO CONSOLE</button>' +
      '<button class="dir-btn primary" data-act="new-op">NEW OPERATION ▶</button></div>';
    evt('After-action review opened.');
  }

  function runProbe(key) {
    var p = PROBES[key];
    if (!p) return;
    var r = replayWith(p.policy, p.title);
    var box = $('dir-probe-' + key);
    if (!r || !box) return;
    var youWin = r.winner === 'blue';
    box.innerHTML = 'Attrition lens: <b>' + (youWin ? 'BLUE AHEAD' : 'RED AHEAD') + '</b> ' +
      (r.byScore ? 'on score' : 'by collapse') + ' at T' + r.endedTurn +
      ' · objectives held ' + r.heldBlue.h + '/' + r.heldBlue.t +
      ' · Red objectives standing ' + r.heldRed.h + '/' + r.heldRed.t;
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
      '## Turn record', ''
    ];
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
      lines.push('');
    });
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

  // ---- overlay actions / lifecycle -----------------------------------------------------
  function onOverlayClick(ev) {
    var t = ev.target.closest('[data-act],[data-turns],[data-diff],[data-probe]');
    if (!t) return;
    if (t.hasAttribute('data-turns')) { briefOpts.turnLimit = Number(t.getAttribute('data-turns')); newBriefMatch(); renderBrief(); return; }
    if (t.hasAttribute('data-diff')) { briefOpts.redDiff = t.getAttribute('data-diff'); newBriefMatch(); renderBrief(); return; }
    if (t.hasAttribute('data-probe')) { runProbe(t.getAttribute('data-probe')); return; }
    var act = t.getAttribute('data-act');
    if (act === 'begin') beginPlanning();
    else if (act === 'back') { setPhase('plan'); renderDock(); focusPlanControl(); }
    else if (act === 'execute') execute();
    else if (act === 'copy-aar') copyAar();
    else if (act === 'download-aar') downloadAar();
    else if (act === 'exit') abortOperation(true);
    else if (act === 'exit-op') endOperation();
    else if (act === 'new-op') { endOperation(); start(); }
  }

  function abortOperation(silent) {
    if (!silent && !window.confirm('Abort the operation? The match will be discarded.')) return;
    endOperation();
  }

  function endOperation() {
    clearWatchTimers();
    stopSelPoll();
    hideObjectiveOverlay();
    if (GM.isActive()) GM.endMatch();
    op.forecasts = {}; op.actuals = {}; op.record = null; op.aar = null; op.aarExported = false; op.lastForecast = null;
    restorePanels();
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

  return { start: start, end: endOperation, _op: op };
})();
