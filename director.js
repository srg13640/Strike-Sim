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
    watchTimers: [],
    selPoll: null,
    lastSelId: null
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
      '#dir-rail{position:fixed;top:62px;left:50%;transform:translateX(-50%);z-index:1700;display:none;align-items:center;gap:4px;',
      'background:rgba(8,14,20,.92);border:1px solid #1d3a52;border-radius:10px;padding:5px 10px;backdrop-filter:blur(6px);',
      'font:600 11px Inter,system-ui;color:#7f9db5;}',
      '#dir-rail .ph{padding:3px 9px;border-radius:6px;letter-spacing:.12em;}',
      '#dir-rail .ph.on{background:#0e3a55;color:#8fe8ff;box-shadow:inset 0 0 0 1px #2b6ea0;}',
      '#dir-rail .ph.done{color:#3f5a70;}',
      '#dir-rail .sep{color:#27455e;}',
      '#dir-rail .meta{margin-left:10px;color:#9fc2dc;font-weight:700;}',
      '#dir-rail button{background:none;border:none;color:#5c7d96;cursor:pointer;font-size:13px;margin-left:6px;}',
      '#dir-rail button:hover{color:#ff8a8a;}',
      // full-screen overlay moments (Brief / Commit / AAR)
      '#dir-overlay{position:fixed;inset:0;z-index:5000;display:none;overflow:auto;',
      'background:radial-gradient(1200px 700px at 50% 20%,rgba(10,26,40,.97),rgba(4,8,12,.985));backdrop-filter:blur(8px);}',
      '#dir-overlay .wrap{max-width:880px;margin:5vh auto 6vh;padding:0 22px;color:#cfe3f2;font:14px/1.55 Inter,system-ui;}',
      '.dir-kicker{font:700 12px Oswald,system-ui;letter-spacing:.34em;color:#00d8ff;margin-bottom:6px;}',
      '.dir-h1{font:700 34px/1.1 Oswald,system-ui;letter-spacing:.06em;color:#f2f8fc;margin:0 0 4px;}',
      '.dir-sub{color:#8fb2ca;margin-bottom:26px;}',
      '.dir-card{background:linear-gradient(180deg,rgba(16,28,40,.85),rgba(10,18,26,.85));border:1px solid #1d3a52;',
      'border-radius:12px;padding:16px 18px;margin-bottom:14px;}',
      '.dir-card h3{font:700 12px Oswald,system-ui;letter-spacing:.22em;color:#6fb7d8;margin:0 0 10px;}',
      '.dir-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}',
      '.dir-obj{display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px dotted #16283a;font-size:13px;}',
      '.dir-obj .v{color:#7f9db5;white-space:nowrap;}',
      '.dir-stat{display:flex;justify-content:space-between;padding:3px 0;font-size:13px;}',
      '.dir-stat b{color:#e8f4fb;}',
      '.dir-actions{display:flex;gap:12px;margin-top:22px;justify-content:flex-end;align-items:center;}',
      '.dir-btn{background:#0d2233;border:1px solid #24506f;color:#a8cde4;font:700 13px Oswald,system-ui;letter-spacing:.14em;',
      'padding:10px 22px;border-radius:9px;cursor:pointer;}',
      '.dir-btn:hover{border-color:#3f7ea8;color:#e8f6ff;}',
      '.dir-btn.primary{background:linear-gradient(180deg,#0e4d70,#0a3document);}',
      '.dir-btn.primary{background:linear-gradient(180deg,#0e4d70,#0a3552);border-color:#2f88b8;color:#dff5ff;}',
      '.dir-btn.primary:hover{box-shadow:0 0 22px rgba(0,216,255,.35);}',
      '.dir-btn.danger{border-color:#7a2f2f;color:#ffb0a8;}',
      '.dir-note{font-size:12px;color:#6d8ca4;font-style:italic;}',
      '.dir-chips{display:flex;gap:6px;}',
      '.dir-chip{background:#0b1a26;border:1px solid #1d3a52;color:#8fb2ca;border-radius:7px;padding:5px 11px;cursor:pointer;font:600 12px Inter;}',
      '.dir-chip.on{background:#0e3a55;color:#c9f2ff;border-color:#2f88b8;}',
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
      '#dir-dock select{background:#0b1a26;color:#cfe6f5;border:1px solid #1d3a52;border-radius:7px;padding:5px 8px;max-width:330px;font:12px Inter;}',
      '#dir-dock .q{display:flex;gap:6px;flex-wrap:wrap;}',
      '#dir-dock .oq{background:#0e2536;border:1px solid #235273;border-radius:7px;padding:3px 8px;font-size:12px;color:#bfe0f2;display:flex;gap:7px;align-items:center;}',
      '#dir-dock .oq.h{border-color:#2f6e46;} #dir-dock .oq.r{border-color:#6e5a2f;}',
      '#dir-dock .oq u{cursor:pointer;text-decoration:none;color:#7f9db5;} #dir-dock .oq u:hover{color:#ff9d94;}',
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
      '#dir-feed{position:fixed;left:16px;bottom:16px;z-index:1500;display:none;width:min(430px,44vw);max-height:52vh;overflow:auto;',
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
      '.dir-verdict.win{color:#7be3a1;} .dir-verdict.loss{color:#ff9d94;}'
    ].join('\n');
    document.head.appendChild(s);
  }

  // ---- DOM shell ----------------------------------------------------------------------
  function buildDom() {
    if ($('dir-launch')) return;
    var b = el('<button id="dir-launch" title="Start an Operation — Brief · Plan · Commit · Watch · AAR">▶ OPERATION</button>');
    b.addEventListener('click', start);
    document.body.appendChild(b);
    document.body.appendChild(el('<div id="dir-rail"></div>'));
    document.body.appendChild(el('<div id="dir-overlay"><div class="wrap" id="dir-wrap"></div></div>'));
    document.body.appendChild(el('<div id="dir-dock"></div>'));
    document.body.appendChild(el('<div id="dir-feed"></div>'));
    $('dir-overlay').addEventListener('click', onOverlayClick);
    $('dir-dock').addEventListener('click', onDockClick);
    $('dir-dock').addEventListener('change', onDockChange);
    $('dir-feed').addEventListener('click', onFeedClick);
    $('dir-rail').addEventListener('click', function (ev) {
      if (ev.target.getAttribute && ev.target.getAttribute('data-act') === 'abort') abortOperation();
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
    r.innerHTML = chips + meta + '<button data-act="abort" title="Abort operation">✕</button>';
    r.style.display = 'flex';
  }

  function setPhase(p) {
    op.phase = p;
    renderRail();
    $('dir-overlay').style.display = (p === 'brief' || p === 'commit' || p === 'aar') ? 'block' : 'none';
    $('dir-dock').style.display = p === 'plan' ? 'block' : 'none';
    $('dir-feed').style.display = (p === 'watch') ? 'block' : 'none';
    $('dir-launch').style.display = p === 'idle' ? '' : 'none';
  }

  // ---- BRIEF ------------------------------------------------------------------------
  var briefOpts = { turnLimit: 8, redDiff: 'hard' };

  function start() {
    if (!GM) return;
    if (GM.isActive()) GM.endMatch();
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
    op.forecasts = {}; op.actuals = {}; op.record = null; op.targetId = null;
  }

  function objList(st, side) {
    return (st.objectiveIds[side] || []).map(function (id) {
      var n = GM.boardNode(id);
      return n ? '<div class="dir-obj"><span>' + esc(n.name) + '</span><span class="v">' + esc(n.difficulty || '') + ' · val ' + nodeVal(n) + '</span></div>' : '';
    }).join('');
  }

  function renderBrief() {
    var st = GM.getState();
    if (!st) return;
    var scen = (window.AppState && AppState.active && AppState.active()) || null;
    $('dir-wrap').innerHTML =
      '<div class="dir-kicker">OPERATION BRIEF · ' + esc(scen && scen.name || 'INDO-PACIFIC SCENARIO') + '</div>' +
      '<h1 class="dir-h1">You are the Blue planner.</h1>' +
      '<div class="dir-sub">' + st.cfg.turnLimit + ' turns of simultaneous commitment against a doctrine-driven Red. ' +
      'Both sides lock orders blind; the world resolves once. Forecasts are ranges — never promises.</div>' +

      '<div class="dir-grid">' +
      '<div class="dir-card"><h3>COMMANDER’S INTENT</h3>' +
      '<div class="dir-stat"><span>Hold your key objectives</span><b>lose ≤' + Math.floor((st.objectives.blue.total || 8) * OBJ_LOSS_FRAC) + ' of ' + (st.objectives.blue.total || 8) + '</b></div>' +
      '<div class="dir-stat"><span>Break Red’s force</span><b>drive Red objective value below ' + Math.round(st.cfg.collapseFrac * 100) + '%</b></div>' +
      '<div class="dir-stat"><span>Guard your tempo</span><b>C2 &amp; logistics feed your AP</b></div>' +
      '<div class="dir-stat"><span>Decision budget</span><b>' + st.ap.blue + ' orders / turn (tempo-driven)</b></div>' +
      '</div>' +
      '<div class="dir-card"><h3>FORCE BALANCE</h3>' +
      '<div class="dir-stat"><span>Blue force</span><b>' + st.alive.blue + ' nodes · AP ' + st.ap.blue + '</b></div>' +
      '<div class="dir-stat"><span>Red force</span><b>' + st.alive.red + ' nodes · AP ' + st.ap.red + '</b></div>' +
      '<div class="dir-stat"><span>Blue tempo assets</span><b>' + st.tempo.blue.c2 + ' C2 · ' + st.tempo.blue.logi + ' LOG</b></div>' +
      '<div class="dir-stat"><span>Red tempo assets</span><b>' + st.tempo.red.c2 + ' C2 · ' + st.tempo.red.logi + ' LOG</b></div>' +
      '<div class="dir-note" style="margin-top:8px">Strikes, hardens and repairs each cost one order. A node killed this turn still acts — both sides committed first.</div>' +
      '</div>' +
      '</div>' +

      '<div class="dir-grid">' +
      '<div class="dir-card"><h3>YOUR KEY OBJECTIVES (DEFEND)</h3>' + objList(st, 'blue') + '</div>' +
      '<div class="dir-card"><h3>RED CENTER OF GRAVITY (ATTACK)</h3>' + objList(st, 'red') + '</div>' +
      '</div>' +

      '<div class="dir-card"><h3>OPERATION PARAMETERS</h3>' +
      '<div class="row" style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">' +
      '<span class="dir-note">Turn budget</span><span class="dir-chips">' +
      [6, 8, 10].map(function (n) { return '<span class="dir-chip' + (briefOpts.turnLimit === n ? ' on' : '') + '" data-turns="' + n + '">' + n + '</span>'; }).join('') +
      '</span><span class="dir-note">Red doctrine strength</span><span class="dir-chips">' +
      ['easy', 'hard'].map(function (d) { return '<span class="dir-chip' + (briefOpts.redDiff === d ? ' on' : '') + '" data-diff="' + d + '">' + d.toUpperCase() + '</span>'; }).join('') +
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
    setPhase('plan');
    forceMapView();
    renderDock();
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
    return pool.slice(0, 40).map(function (b) {
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
    var pips = '';
    for (var i = 0; i < apMax; i++) pips += '<i class="' + (i < apLeft ? 'full' : '') + '"></i>';
    var methods = GM.methods();
    var optsHtml = targetOptions();   // resolves op.targetId to the pool default first
    var tgt = op.targetId ? GM.boardNode(op.targetId) : null;
    var methodChips = GM.methodKeys().map(function (k) {
      var m = methods[k];
      var vulnHit = tgt && (tgt.vulns || []).indexOf(m.vuln) >= 0;
      var hint = Math.round(m.baseProb * 100) + '%' + (vulnHit ? ' ▲vuln' : '');
      return '<span class="dir-chip' + (op.methodKey === k ? ' on' : '') + '" data-method="' + k + '" title="Base hit ' + hint + '">' + m.short + ' ' + hint + '</span>';
    }).join('');
    var queue = st.orders.blue.map(function (o, i) {
      var n = GM.boardNode(o.targetId);
      var cls = o.kind === 'harden' ? 'h' : (o.kind === 'repair' ? 'r' : '');
      var lbl = o.kind === 'strike' ? (methods[o.methodKey] ? methods[o.methodKey].short : 'KE') + ' → ' : (o.kind.toUpperCase() + ' ');
      return '<span class="oq ' + cls + '">' + lbl + esc(n ? n.name.slice(0, 34) : o.targetId) + '<u data-rm="' + i + '" title="Remove">✕</u></span>';
    }).join('') || '<span class="dir-note">No orders queued — click a node on the map or pick a target below.</span>';

    $('dir-dock').innerHTML =
      '<div class="row">' +
      '<span class="stat">TURN <b>' + st.turn + '/' + st.cfg.turnLimit + '</b></span>' +
      '<span class="stat ap">ORDERS ' + pips + '</span>' +
      '<span class="stat">TEMPO <b>' + Math.round(st.tempo.blue.frac * 100) + '%</b></span>' +
      '<span class="stat">OBJ <b>' + st.objectives.blue.held + '/' + st.objectives.blue.total + ' held</b></span>' +
      '<span class="stat">RED OBJ <b>' + st.objectives.red.held + '/' + st.objectives.red.total + ' standing</b></span>' +
      '<span class="spacer"></span>' +
      '<span class="dir-note">score ' + Math.round(st.score.blue) + ' : ' + Math.round(st.score.red) + '</span>' +
      '</div>' +
      '<div class="row">' +
      '<span class="dir-chips">' +
      ['strike', 'harden', 'repair'].map(function (k) { return '<span class="dir-chip' + (op.kind === k ? ' on' : '') + '" data-kind="' + k + '">' + k.toUpperCase() + '</span>'; }).join('') +
      '</span>' +
      '<select id="dir-target">' + (optsHtml || '<option value="">— no valid targets —</option>') + '</select>' +
      (op.kind === 'strike' ? '<span class="dir-chips">' + methodChips + '</span>' : '') +
      '<button class="dir-btn" data-act="queue" ' + (apLeft <= 0 ? 'disabled style="opacity:.45"' : '') + '>+ QUEUE</button>' +
      '</div>' +
      reconHtml(tgt) +
      '<div class="row q">' + queue + '</div>' +
      '<div class="row"><span class="dir-note">Orders lock blind — Red is planning the same turn right now.</span><span class="spacer"></span>' +
      '<button class="dir-btn primary" data-act="forecast">⚡ FORECAST &amp; COMMIT</button></div>';
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
      var ok = GM.queueOrder('blue', order);
      if (!ok) evt('Order rejected (no orders left or invalid target).');
      renderDock();
    } else if (act === 'forecast') {
      openCommit();
    }
  }

  // ---- FORECAST (ghost worlds on the real engine) -------------------------------------
  function ghostForecast(K) {
    var I = GM._internal;
    var s = GM.serialize();
    var st = GM.getState();
    var blueOrders = st.orders.blue;
    var objBlue = st.objectiveIds.blue || [];
    var redKills = [], blueKills = [], swing = [], objHitWorlds = 0;
    for (var k = 0; k < K; k++) {
      var board = I.buildBoard(AppState.activeGraph());
      for (var id in s.health) { var b = board.nodes[id]; if (b) { b.health = s.health[id].h; b.alive = s.health[id].a; } }
      var redOrders = I.planOrders(board, 'red', st.ap.red, s.cfg.difficulty.red,
        I.makeRng(I.hashSeed(s.seed, 'ghost-red', s.turn, k)));
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
      '<div class="honesty">This is a range, not a promise. The world will draw one outcome.</div></div>';
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
      var what = o.kind === 'strike' ? (methods[o.methodKey] ? methods[o.methodKey].name : 'Strike') : o.kind.charAt(0).toUpperCase() + o.kind.slice(1);
      return '<div class="dir-obj"><span>' + esc(what) + ' → ' + esc(n ? n.name : o.targetId) + '</span><span class="v">' + (n ? esc(n.difficulty || '') : '') + '</span></div>';
    }).join('') : '<div class="dir-note">No orders — you are passing this turn. Red is not.</div>';

    $('dir-wrap').innerHTML =
      '<div class="dir-kicker">COMMIT · TURN ' + st.turn + '/' + st.cfg.turnLimit + '</div>' +
      '<h1 class="dir-h1">Sign the order.</h1>' +
      '<div class="dir-sub">Red has already committed. Execution is simultaneous and irreversible.</div>' +
      '<div class="dir-card"><h3>YOUR ORDERS (' + st.orders.blue.length + '/' + st.ap.blue + ')</h3>' + rows + '</div>' +
      forecastStrip(op.lastForecast) +
      '<div class="dir-actions">' +
      '<span class="dir-note">Seed ' + esc(String(GMseed())) + ' · turn draw is deterministic.</span>' +
      '<button class="dir-btn" data-act="back">← REVISE</button>' +
      '<button class="dir-btn primary" data-act="execute">EXECUTE ▶</button></div>';
  }

  // ---- WATCH (paced playback of the one true draw) --------------------------------------
  function execute() {
    var stBefore = GM.getState();
    if (!stBefore || stBefore.phase !== 'plan') return;
    var turn = stBefore.turn;
    var st = GM.commitTurn();
    setPhase('watch');
    forceMapView();
    refreshVisuals();
    showObjectiveOverlay();   // re-draw so downed key terrain dims during playback
    var report = st.lastReport || { events: [] };
    op.actuals[turn] = actualSummary(report);
    playWatch(report, st);
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
    var name = n ? n.name : e.targetId;
    var side = e.side === 'blue' ? 'BLUE' : 'RED';
    var cls = e.side === 'blue' ? 'blue' : 'red', txt;
    if (e.kind === 'hit') { txt = side + ' ' + (e.method || '').toUpperCase() + ' → ' + name + ' — HIT (−' + Math.round(e.damage || 0) + ')'; }
    else if (e.kind === 'miss') { cls += ' miss'; txt = side + ' ' + (e.method || '').toUpperCase() + ' → ' + name + ' — MISS'; }
    else if (e.kind === 'kill') { cls += ' kill'; txt = '✖ ' + name + ' NEUTRALIZED'; }
    else if (e.kind === 'cascade') { cls += ' cas'; txt = '⚡ ' + (e.text || ('Cascade hit ' + name)); }
    else if (e.kind === 'repair') { txt = side + ' repaired ' + name + ' (+' + Math.round(e.amount || 0) + ')'; }
    else { txt = e.text || (side + ' ' + e.kind + ' → ' + name); }
    return '<div class="fl ' + cls + '">' + esc(txt) + '</div>';
  }

  function playWatch(report, st) {
    clearWatchTimers();
    var feed = $('dir-feed');
    feed.innerHTML = '<div class="fl sys">TURN ' + report.turn + ' — EXECUTION</div>';
    var events = (report.events || []).filter(function (e) { return e.kind !== 'void'; });
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
    var st = GM.getState();
    refreshVisuals();
    var f = op.forecasts[report.turn], a = op.actuals[report.turn];
    var honesty = (f && a) ?
      '<div class="dir-note">Forecast said ' + bandStr(f.redKills) + ' Red down — the world drew ' + a.redKills + '.' +
      (a.redKills >= f.redKills.lo && a.redKills <= f.redKills.hi ? ' Inside the band.' : ' Outside the band — note it.') + '</div>' : '';
    var over = st.phase === 'over';
    var lastTurn = !over && st.turn >= st.cfg.turnLimit;   // turn limit ends the match on advance
    var html = '<div class="outcome"><b>TURN ' + report.turn + ' COMPLETE</b><br>' +
      'Red lost <b>' + (a ? a.redKills : 0) + '</b> · Blue lost <b>' + (a ? a.blueKills : 0) + '</b> · ' +
      'Your objectives <b>' + st.objectives.blue.held + '/' + st.objectives.blue.total + '</b> · ' +
      'Tempo <b>' + Math.round(st.tempo.blue.frac * 100) + '%</b><br>' + honesty +
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

  function openAar() {
    var st = GM.getState();
    op.record = GM.serialize();
    setPhase('aar');
    var aar = st.aar || {};
    var win = aar.winner === 'blue';
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
      '<div class="dir-verdict ' + (win ? 'win' : 'loss') + '">' + (win ? 'OPERATION SUCCESSFUL' : 'OPERATION FAILED') + '</div>' +
      '<div class="dir-sub">' + esc(aar.reason || '') + ' · score margin ' + (aar.scoreMargin > 0 ? '+' : '') + (aar.scoreMargin || 0) + '</div>' +

      '<div class="dir-grid">' +
      '<div class="dir-card"><h3>SCORE TRAJECTORY</h3>' + scoreBars(aar) + '</div>' +
      '<div class="dir-card"><h3>WHAT FELL</h3>' + top + '</div>' +
      '</div>' +

      '<div class="dir-card"><h3>HONESTY LEDGER — FORECAST vs THE WORLD</h3>' +
      '<table class="dir-ledger"><tr><th>Turn</th><th>Fcst Red down</th><th>Actual</th><th>Fcst Blue lost</th><th>Actual</th><th>Verdict</th></tr>' +
      ledgerRows() + '</table>' +
      '<div class="dir-note" style="margin-top:6px">A good forecast is honest, not lucky: actuals should land inside the band ~80% of the time.</div></div>' +

      '<div class="dir-card"><h3>THE COUNTERFACTUAL MACHINE — SAME WORLD, ONE CHANGED POLICY</h3>' +
      '<div class="dir-note" style="margin-bottom:6px">Re-runs this exact seeded operation with one Blue policy changed. Red replays its recorded orders.</div>' +
      probes + '</div>' +

      '<div class="dir-actions">' +
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
    box.innerHTML = 'Same world: <b>' + (youWin ? 'BLUE WINS' : 'BLUE LOSES') + '</b> ' +
      (r.byScore ? 'on score' : 'by collapse') + ' at T' + r.endedTurn +
      ' · objectives held ' + r.heldBlue.h + '/' + r.heldBlue.t +
      ' · Red objectives standing ' + r.heldRed.h + '/' + r.heldRed.t;
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
    else if (act === 'back') { setPhase('plan'); renderDock(); }
    else if (act === 'execute') execute();
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
    op.forecasts = {}; op.actuals = {}; op.record = null; op.lastForecast = null;
    setPhase('idle');
    refreshVisuals();
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
