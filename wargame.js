/*
 * wargame.js — UI layer for the turn-based War Game (Phase 2 of the wargame work).
 *
 * Self-contained on purpose: it injects its own stylesheet, builds its own launch
 * button and HUD via the DOM, and talks only to window.GameModule (the engine) plus a
 * few existing globals at call time (selectedNode, selectNode, applyHighlight,
 * refreshMapMarkers, addEvent). It touches none of the existing control HTML, so the
 * analyst tool is unchanged until the operator opens the War Game.
 *
 * Interaction model: the human selects a node the normal way (click it in 3D / Map /
 * Geo), then the HUD offers context actions — strike methods against an enemy node,
 * or harden/repair on a friendly one. Orders queue against an action-point budget;
 * "Commit Turn" gathers any AI side's orders and resolves everything simultaneously.
 */
(function () {
  'use strict';

  var W = null;                 // window.GameModule (resolved on init)
  var activeSide = 'blue';      // which human side is currently issuing orders (hotseat)
  var lastSelId = null;         // selection-poll cache
  var pollTimer = null;
  var hud, launchBtn;
  // Fog-of-war / blind-handoff state (only used when fog is on and both sides are human).
  var curtain = false;          // device-handoff curtain is up (hide everything)
  var pendingSide = null;       // side that plans next, after the curtain
  var planTurnInit = -1;        // turn whose plan phase we've already initialised

  function humanSides(cfg) { return ['blue', 'red'].filter(function (s) { return cfg.control[s] === 'human'; }); }
  function otherSide(s) { return s === 'blue' ? 'red' : 'blue'; }
  function hpBand(h, max) { var f = max ? h / max : 0; return f > 0.66 ? 'Intact' : (f > 0.33 ? 'Damaged' : 'Critical'); }
  function fogActive(cfg) { return !!(cfg && cfg.fog); }

  // ---- styles --------------------------------------------------------------------
  var CSS = [
    '#wg-launch{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:1400;',
      'background:linear-gradient(180deg,#15324a,#0d2032);color:#dff1ff;border:1px solid #2c6f9b;',
      'padding:8px 16px;border-radius:8px;font:600 13px/1 system-ui,sans-serif;letter-spacing:.04em;',
      'cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.06);}',
    '#wg-launch:hover{border-color:#4bb8ff;color:#fff;box-shadow:0 4px 22px rgba(40,160,255,.35);}',
    '#wg-hud{position:fixed;top:0;right:0;width:340px;height:100%;z-index:1390;display:flex;flex-direction:column;',
      'background:linear-gradient(180deg,rgba(8,16,26,.97),rgba(6,12,20,.99));border-left:1px solid #1c3a55;',
      'box-shadow:-8px 0 30px rgba(0,0,0,.5);color:#cfe0ee;font:13px/1.45 system-ui,sans-serif;',
      'transform:translateX(100%);transition:transform .25s ease;}',
    '#wg-hud.wg-open{transform:translateX(0);}',
    '.wg-hidden{display:none!important;}',
    '#wg-hud header{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;',
      'border-bottom:1px solid #163049;background:linear-gradient(180deg,#0e2236,#0a1826);}',
    '#wg-hud header .wg-title{font-weight:700;letter-spacing:.08em;color:#eaf4ff;font-size:13px;}',
    '#wg-hud header .wg-sub{font-size:11px;color:#7fa3c0;margin-top:2px;}',
    '#wg-x{background:none;border:none;color:#88a;cursor:pointer;font-size:18px;line-height:1;padding:2px 6px;}',
    '#wg-x:hover{color:#fff;}',
    '.wg-body{flex:1;overflow-y:auto;padding:12px 14px;}',
    '.wg-foot{border-top:1px solid #163049;padding:10px 14px;background:rgba(6,12,20,.6);}',
    '.wg-sec{margin-bottom:14px;}',
    '.wg-sec h4{margin:0 0 6px;font-size:11px;letter-spacing:.08em;color:#6f93b0;text-transform:uppercase;font-weight:700;}',
    '.wg-row{display:flex;gap:8px;align-items:center;}',
    '.wg-row+.wg-row{margin-top:6px;}',
    '.wg-score{display:flex;gap:8px;}',
    '.wg-score .wg-card{flex:1;border-radius:8px;padding:8px 10px;border:1px solid #1c3a55;background:rgba(20,40,60,.4);}',
    '.wg-card.blue{border-color:#2b6aa0;}.wg-card.red{border-color:#a04848;}',
    '.wg-card .wg-team{font-size:11px;font-weight:700;letter-spacing:.05em;}',
    '.wg-card.blue .wg-team{color:#6cc0ff;}.wg-card.red .wg-team{color:#ff8585;}',
    '.wg-card .wg-pts{font-size:20px;font-weight:700;color:#eaf4ff;margin-top:2px;}',
    '.wg-card .wg-meta{font-size:10px;color:#7e9cb5;margin-top:2px;}',
    '.wg-bar{height:5px;border-radius:3px;background:#16283a;margin-top:6px;overflow:hidden;}',
    '.wg-bar>i{display:block;height:100%;border-radius:3px;}',
    '.wg-card.blue .wg-bar>i{background:linear-gradient(90deg,#2b6aa0,#6cc0ff);}',
    '.wg-card.red .wg-bar>i{background:linear-gradient(90deg,#a04848,#ff8585);}',
    '.wg-btn{background:#13314a;color:#dff1ff;border:1px solid #2c5f86;border-radius:6px;padding:7px 10px;',
      'font:600 12px system-ui,sans-serif;cursor:pointer;transition:.12s;}',
    '.wg-btn:hover{border-color:#4bb8ff;background:#184466;}',
    '.wg-btn:disabled{opacity:.4;cursor:not-allowed;}',
    '.wg-btn.primary{background:linear-gradient(180deg,#1d6f3f,#15532f);border-color:#2e9e5b;color:#eafff0;width:100%;padding:10px;font-size:13px;}',
    '.wg-btn.primary:hover{border-color:#46d585;}',
    '.wg-btn.danger{border-color:#9e3b3b;color:#ffd9d9;}',
    '.wg-btn.full{width:100%;}',
    '.wg-btn.sm{padding:5px 8px;font-size:11px;}',
    '.wg-method{display:grid;grid-template-columns:1fr 1fr;gap:6px;}',
    '.wg-method .wg-btn{position:relative;text-align:left;}',
    '.wg-method .wg-btn .vh{color:#ffd86b;font-size:10px;display:block;margin-top:1px;}',
    '.wg-toggle{display:flex;border:1px solid #1c3a55;border-radius:7px;overflow:hidden;}',
    '.wg-toggle button{flex:1;background:transparent;border:none;color:#9fbdd6;padding:6px;font:600 12px system-ui;cursor:pointer;}',
    '.wg-toggle button.on{background:#184466;color:#fff;}',
    '.wg-toggle.blue button.on{background:#1d4e74;color:#bfe4ff;}',
    '.wg-toggle.red button.on{background:#6e2b2b;color:#ffd0d0;}',
    '.wg-orders{list-style:none;margin:0;padding:0;}',
    '.wg-orders li{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:5px 7px;border:1px solid #173249;',
      'border-radius:6px;margin-bottom:5px;background:rgba(18,36,54,.5);font-size:12px;}',
    '.wg-orders li .x{color:#c77;cursor:pointer;font-weight:700;padding:0 4px;}',
    '.wg-orders li .x:hover{color:#f99;}',
    '.wg-sel{border:1px solid #1c3a55;border-radius:8px;padding:9px 10px;background:rgba(20,40,60,.35);}',
    '.wg-sel .nm{font-weight:700;color:#eaf4ff;}',
    '.wg-sel .meta{font-size:11px;color:#88a8c2;margin-top:2px;}',
    '.wg-sel .tag{display:inline-block;font-size:10px;padding:1px 6px;border-radius:10px;margin-right:4px;}',
    '.wg-sel .tag.blue{background:#1d4e74;color:#bfe4ff;}.wg-sel .tag.red{background:#6e2b2b;color:#ffd0d0;}',
    '.wg-hint{font-size:11px;color:#6f8fa8;font-style:italic;}',
    '.wg-log{list-style:none;margin:0;padding:0;max-height:170px;overflow-y:auto;}',
    '.wg-log li{padding:3px 0;border-bottom:1px solid #112536;font-size:11.5px;color:#a9c3d8;}',
    '.wg-log li.kill{color:#ff9a9a;font-weight:600;}.wg-log li.hit{color:#cfe6ff;}.wg-log li.repair{color:#9fe7b8;}.wg-log li.miss{color:#6f8295;}',
    '.wg-banner{text-align:center;padding:12px;border-radius:8px;font-weight:700;letter-spacing:.05em;margin-bottom:10px;}',
    '.wg-banner.blue{background:linear-gradient(180deg,#16466e,#0e2c47);color:#bfe4ff;border:1px solid #2b6aa0;}',
    '.wg-banner.red{background:linear-gradient(180deg,#6e2424,#3f1414);color:#ffd0d0;border:1px solid #a04848;}',
    '.wg-sel-list{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px;}',
    '.wg-chip{font-size:11px;padding:4px 7px;border:1px solid #234a68;border-radius:6px;background:rgba(20,40,60,.4);color:#bcd6ec;cursor:pointer;}',
    '.wg-chip:hover{border-color:#4bb8ff;color:#fff;}',
    '.wg-card.fog .wg-pts{color:#5e7790;}',
    '.wg-card.fog{opacity:.85;}',
    '.wg-fogtag{display:inline-block;font-size:10px;color:#ffcf6b;border:1px solid #6b5a2a;background:rgba(80,64,24,.3);border-radius:10px;padding:1px 7px;margin-left:6px;vertical-align:middle;}',
    '.wg-curtain{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:60vh;gap:10px;}',
    '.wg-curtain .lock{font-size:46px;}',
    '.wg-curtain .ttl{font-weight:800;letter-spacing:.12em;color:#eaf4ff;font-size:15px;}',
    '.wg-curtain p{color:#9fbdd6;font-size:13px;margin:2px 0 8px;}',
    '.wg-curtain b.blue{color:#6cc0ff;}.wg-curtain b.red{color:#ff8585;}',
    '.wg-curtain .wg-btn{min-width:220px;}'
  ].join('');

  function injectCss() {
    var s = document.createElement('style');
    s.id = 'wg-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; }); }

  // ---- selection bridge ----------------------------------------------------------
  function curSel() { try { return (typeof selectedNode !== 'undefined') ? selectedNode : null; } catch (e) { return null; } }
  function refreshVisuals() {
    try { if (typeof applyHighlight === 'function') applyHighlight(); } catch (e) {}
    try { if (typeof refreshMapMarkers === 'function') refreshMapMarkers(); } catch (e) {}
  }

  // ---- build shell ---------------------------------------------------------------
  function build() {
    launchBtn = el('<button id="wg-launch" title="Open the turn-based War Game">⚔ War Game</button>');
    launchBtn.addEventListener('click', open);
    document.body.appendChild(launchBtn);

    hud = el('<div id="wg-hud"><header><div><div class="wg-title">⚔ WAR GAME</div><div class="wg-sub" id="wg-sub">Set up a match</div></div><button id="wg-x" title="Close">×</button></header><div class="wg-body" id="wg-body"></div><div class="wg-foot" id="wg-foot"></div></div>');
    document.body.appendChild(hud);
    hud.querySelector('#wg-x').addEventListener('click', close);

    // Event delegation for everything inside the HUD.
    hud.addEventListener('click', onHudClick);
  }

  function open() {
    hud.classList.add('wg-open');
    launchBtn.classList.add('wg-hidden');
    if (!W.isActive()) renderSetup(); else render(W.getState());
    if (!pollTimer) pollTimer = setInterval(pollSelection, 280);
  }
  function close() {
    // The War Game mutates the live scenario (node health / status). Exiting restores
    // the scenario to exactly its pre-match state so the analysis tools are never left
    // showing battle damage. (Phase 2 can offer save/resume — serialize() already exists.)
    if (W.isActive()) { W.endMatch(); refreshVisuals(); }
    hud.classList.remove('wg-open');
    launchBtn.classList.remove('wg-hidden');
    lastSelId = null;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function pollSelection() {
    if (!hud.classList.contains('wg-open') || !W.isActive()) return;
    var s = curSel();
    var id = s ? s.id : null;
    if (id !== lastSelId) { lastSelId = id; renderTargetSection(W.getState()); }
  }

  // ---- setup view ----------------------------------------------------------------
  function renderSetup() {
    document.getElementById('wg-sub').textContent = 'Set up a match';
    var body = document.getElementById('wg-body');
    body.innerHTML =
      sideSetup('blue', 'Blue (US / Allied)') +
      sideSetup('red', 'Red (PLA)') +
      '<div class="wg-sec"><h4>Match length</h4><div class="wg-toggle" id="wg-turns">' +
        turnsBtn(6) + turnsBtn(10) + turnsBtn(16) + '</div></div>' +
      '<div class="wg-sec"><h4>AI difficulty</h4><div class="wg-toggle" id="wg-diff">' +
        '<button data-diff="easy">Easy</button><button data-diff="hard" class="on">Hard</button></div></div>' +
      '<div class="wg-sec"><h4>Fog of war</h4><div class="wg-toggle" id="wg-fog">' +
        '<button data-fog="on">On</button><button data-fog="off">Off</button></div>' +
        '<p class="wg-hint" style="margin-top:6px;">On: enemy strength is masked while you plan, and a two-human match hands off blind so neither side sees the other\'s orders.</p></div>' +
      '<p class="wg-hint">Both sides commit orders blind each turn, then everything resolves at once. A side is defeated if its surviving force value falls below 35% of its start, otherwise the higher score at the final turn wins.</p>';
    document.getElementById('wg-foot').innerHTML = '<button class="wg-btn primary" data-act="start">Start Match</button>';
    // defaults
    setToggle('wg-ctl-blue', 'human'); setToggle('wg-ctl-red', 'ai');
    setToggle('wg-turns', '10');
    setToggle('wg-fog', 'on');
  }
  function sideSetup(side, label) {
    return '<div class="wg-sec"><h4>' + esc(label) + '</h4><div class="wg-toggle ' + side + '" id="wg-ctl-' + side + '">' +
      '<button data-side="' + side + '" data-ctl="human">Human</button>' +
      '<button data-side="' + side + '" data-ctl="ai">Computer</button></div></div>';
  }
  function turnsBtn(n) { return '<button data-turns="' + n + '">' + n + ' turns</button>'; }
  function setToggle(groupId, value) {
    var g = document.getElementById(groupId); if (!g) return;
    [].forEach.call(g.querySelectorAll('button'), function (b) {
      var v = b.getAttribute('data-ctl') || b.getAttribute('data-turns') || b.getAttribute('data-diff') || b.getAttribute('data-fog');
      b.classList.toggle('on', v === value);
    });
  }

  function readSetup() {
    var ctl = function (side) { var on = document.querySelector('#wg-ctl-' + side + ' button.on'); return on ? on.getAttribute('data-ctl') : (side === 'red' ? 'ai' : 'human'); };
    var turnsOn = document.querySelector('#wg-turns button.on');
    var diffOn = document.querySelector('#wg-diff button.on');
    var fogOn = document.querySelector('#wg-fog button.on');
    return {
      control: { blue: ctl('blue'), red: ctl('red') },
      turnLimit: turnsOn ? Number(turnsOn.getAttribute('data-turns')) : 10,
      difficulty: { blue: diffOn ? diffOn.getAttribute('data-diff') : 'hard', red: diffOn ? diffOn.getAttribute('data-diff') : 'hard' },
      fog: fogOn ? fogOn.getAttribute('data-fog') === 'on' : true
    };
  }

  // ---- game view -----------------------------------------------------------------
  function firstHuman(cfg) {
    if (cfg.control.blue === 'human') return 'blue';
    if (cfg.control.red === 'human') return 'red';
    return 'blue';
  }

  function render(state) {
    if (!state) { renderSetup(); return; }
    if (state.control && !state.cfg) state.cfg = { control: state.control };
    var cfg = state.cfg;
    var humans = humanSides(cfg);
    var fog = fogActive(cfg);
    var fogHandoff = fog && humans.length > 1;   // sequential blind planning between two humans

    // Initialise each plan phase once: pick who plans first and drop any stale curtain.
    if (state.phase === 'plan' && planTurnInit !== state.turn) {
      planTurnInit = state.turn;
      curtain = false; pendingSide = null;
      if (fogHandoff) activeSide = humans[0];
      else if (cfg.control[activeSide] !== 'human') activeSide = firstHuman(cfg);
    }
    if (cfg.control[activeSide] !== 'human' && humans.length) activeSide = firstHuman(cfg);

    var body = document.getElementById('wg-body');
    var foot = document.getElementById('wg-foot');

    // Blind-handoff curtain takes over the whole panel between two human turns.
    if (curtain && pendingSide) {
      document.getElementById('wg-sub').textContent = 'Turn ' + state.turn + ' · handoff';
      body.innerHTML = '<div class="wg-curtain"><div class="lock">🔒</div><div class="ttl">ORDERS LOCKED</div>' +
        '<p>Pass the device to <b class="' + pendingSide + '">' + pendingSide.toUpperCase() + '</b>.<br>The previous orders are hidden — no peeking.</p>' +
        '<button class="wg-btn primary" data-act="ready">' + pendingSide.toUpperCase() + ' is ready →</button></div>';
      foot.innerHTML = '';
      return;
    }

    document.getElementById('wg-sub').textContent =
      state.phase === 'over' ? 'Match complete'
        : ('Turn ' + state.turn + ' of ' + cfg.turnLimit + ' · ' + (state.phase === 'plan' ? (fogHandoff ? activeSide.toUpperCase() + ' planning' : 'planning') : 'resolved'));

    // During planning under fog, mask the side that is NOT currently planning.
    var maskEnemy = (fog && state.phase === 'plan' && cfg.control[activeSide] === 'human') ? otherSide(activeSide) : null;
    var html = scoreboard(state, maskEnemy);

    if (state.phase === 'over') {
      // banner only; orders hidden
    } else {
      if (humans.length > 1 && !fog) {
        html += '<div class="wg-sec"><h4>Issuing orders as</h4><div class="wg-toggle ' + activeSide + '" id="wg-active">' +
          '<button data-active="blue" class="' + (activeSide === 'blue' ? 'on' : '') + '">Blue</button>' +
          '<button data-active="red" class="' + (activeSide === 'red' ? 'on' : '') + '">Red</button></div></div>';
      } else if (fogHandoff) {
        html += '<div class="wg-sec"><h4>Issuing orders as <span class="wg-fogtag">fog of war</span></h4>' +
          '<div class="wg-toggle ' + activeSide + '"><button class="on">' + activeSide.toUpperCase() + '</button></div></div>';
      }
      if (cfg.control[activeSide] === 'human' && state.phase === 'plan') {
        html += '<div class="wg-sec" id="wg-target"></div>';
        html += ordersSection(state);
      } else if (state.phase === 'plan') {
        html += '<p class="wg-hint">Both sides are computer-controlled. Press Resolve to play out the turn.</p>';
      }
    }

    if (state.phase === 'resolved' || state.phase === 'over') {
      html += logSection(state);
    }
    body.innerHTML = html;
    if (state.phase === 'plan' && cfg.control[activeSide] === 'human') renderTargetSection(state);

    // footer
    if (state.phase === 'plan') {
      if (fogHandoff) {
        var idx = humans.indexOf(activeSide);
        if (idx === humans.length - 1) foot.innerHTML = '<button class="wg-btn primary" data-act="commit">Commit Turn → Resolve</button>';
        else foot.innerHTML = '<button class="wg-btn primary" data-act="pass">Lock orders → Pass to ' + humans[idx + 1].toUpperCase() + '</button>';
      } else {
        var label = anyHuman(cfg) ? 'Commit Turn → Resolve' : 'Resolve Turn';
        foot.innerHTML = '<button class="wg-btn primary" data-act="commit">' + label + '</button>';
      }
    } else if (state.phase === 'resolved') {
      foot.innerHTML = '<button class="wg-btn primary" data-act="next">Next Turn →</button>';
    } else { // over
      foot.innerHTML = '<button class="wg-btn primary" data-act="newmatch">New Match</button>';
    }
  }
  function anyHuman(cfg) { return cfg.control.blue === 'human' || cfg.control.red === 'human'; }

  function scoreboard(state, maskEnemy) {
    var fracB = state.startObj.blue ? Math.max(0, state.objNow.blue / state.startObj.blue) : 0;
    var fracR = state.startObj.red ? Math.max(0, state.objNow.red / state.startObj.red) : 0;
    var banner = '';
    if (state.phase === 'over' && state.winner) {
      banner = '<div class="wg-banner ' + state.winner + '">' + (state.winner === 'blue' ? 'BLUE' : 'RED') + ' WINS</div>';
    }
    var blueCard = maskEnemy === 'blue'
      ? maskedCard('blue', 'BLUE', state.alive.blue, state.rosters.blue)
      : card('blue', 'BLUE', state.score.blue, state.alive.blue, state.rosters.blue, fracB);
    var redCard = maskEnemy === 'red'
      ? maskedCard('red', 'RED', state.alive.red, state.rosters.red)
      : card('red', 'RED', state.score.red, state.alive.red, state.rosters.red, fracR);
    return banner + '<div class="wg-sec"><div class="wg-score">' + blueCard + redCard + '</div></div>';
  }
  function maskedCard(side, label, alive, total) {
    return '<div class="wg-card fog ' + side + '"><div class="wg-team">' + label + ' <span class="wg-fogtag">fog</span></div>' +
      '<div class="wg-pts">— · —</div><div class="wg-meta">' + alive + '/' + total + ' active · strength unknown</div>' +
      '<div class="wg-bar"></div></div>';
  }
  function card(side, label, score, alive, total, frac) {
    return '<div class="wg-card ' + side + '"><div class="wg-team">' + label + '</div>' +
      '<div class="wg-pts">' + Math.round(score) + '</div>' +
      '<div class="wg-meta">' + alive + '/' + total + ' active · force ' + Math.round(frac * 100) + '%</div>' +
      '<div class="wg-bar"><i style="width:' + Math.round(frac * 100) + '%"></i></div></div>';
  }

  function ordersSection(state) {
    var orders = state.orders[activeSide] || [];
    var lis = orders.map(function (o, i) {
      var n = W.boardNode(o.targetId);
      var nm = n ? n.name : o.targetId;
      var verb = o.kind === 'strike' ? (W.methods()[o.methodKey].label + ' →') : (o.kind === 'harden' ? 'Harden' : 'Repair');
      return '<li><span>' + esc(verb) + ' ' + esc(nm) + '</span><span class="x" data-rm="' + i + '">×</span></li>';
    }).join('');
    var apLeft = state.apLeft[activeSide];
    return '<div class="wg-sec"><h4>Orders — ' + activeSide.toUpperCase() + ' (' + apLeft + ' of ' + state.ap[activeSide] + ' action points left)</h4>' +
      '<ul class="wg-orders">' + (lis || '<li style="opacity:.6;border-style:dashed;">No orders yet — select a node below</li>') + '</ul>' +
      (orders.length ? '<button class="wg-btn sm danger" data-act="clear">Clear orders</button>' : '') + '</div>';
  }

  function renderTargetSection(state) {
    var holder = document.getElementById('wg-target');
    if (!holder) return;
    var apLeft = state.apLeft[activeSide];
    var sel = curSel();
    if (!sel) {
      holder.innerHTML = '<h4>Selected target</h4><p class="wg-hint">Click a node in the 3D / Map / Geo view to target it.</p>' + quickTargets(state);
      return;
    }
    var bn = W.boardNode(sel.id);
    if (!bn) { holder.innerHTML = '<h4>Selected target</h4><p class="wg-hint">That node is not a combatant in this match.</p>'; return; }
    var isMine = bn.team === activeSide;
    // Under fog, you don't get perfect battle-damage assessment on the enemy: show a
    // coarse health band instead of exact HP (vulnerabilities stay known intel so
    // targeting is still a real decision).
    var fogEnemy = fogActive(state.cfg) && !isMine;
    var hpText = fogEnemy ? (hpBand(bn.health, bn.healthMax) + ' <span class="wg-fogtag">est.</span>') : (Math.round(bn.health) + '/' + bn.healthMax + ' hp');
    var head = '<h4>Selected target</h4><div class="wg-sel"><div class="nm">' + esc(bn.name) + '</div>' +
      '<div class="meta"><span class="tag ' + bn.team + '">' + bn.team.toUpperCase() + '</span>' +
      esc(bn.difficulty) + ' · ' + hpText +
      (bn.vulns && bn.vulns.length ? ' · vuln: ' + esc(bn.vulns.join(', ')) : '') + '</div></div>';
    var actions;
    if (apLeft <= 0) {
      actions = '<p class="wg-hint" style="margin-top:8px;">No action points left this turn.</p>';
    } else if (!bn.alive) {
      actions = '<p class="wg-hint" style="margin-top:8px;">This node is already neutralized.</p>';
    } else if (isMine) {
      actions = '<div class="wg-method" style="margin-top:8px;">' +
        '<button class="wg-btn" data-order="harden" data-tid="' + esc(bn.id) + '">Harden<span class="vh">cut incoming hit chance</span></button>' +
        '<button class="wg-btn" data-order="repair" data-tid="' + esc(bn.id) + '">Repair<span class="vh">restore health</span></button></div>';
    } else {
      actions = '<div class="wg-method" style="margin-top:8px;">' + W.methodKeys().map(function (k) {
        var m = W.methods()[k];
        var vuln = (bn.vulns || []).indexOf(m.vuln) >= 0;
        return '<button class="wg-btn" data-order="strike" data-method="' + k + '" data-tid="' + esc(bn.id) + '">' +
          m.label + (vuln ? '<span class="vh">▲ vulnerable</span>' : '') + '</button>';
      }).join('') + '</div>';
    }
    holder.innerHTML = head + actions;
  }

  // A few one-click suggested targets (highest-value living enemy nodes) so the player
  // can act without hunting the 3D scene.
  function quickTargets(state) {
    var foe = activeSide === 'blue' ? 'red' : 'blue';
    var graph = (window.AppState && window.AppState.activeGraph()) || { nodes: [] };
    var list = (graph.nodes || []).filter(function (n) {
      var bn = W.boardNode(n.id); return bn && bn.alive && bn.team === foe;
    }).sort(function (a, b) {
      return ((b.importance || 5) * (b.cascScore || 1)) - ((a.importance || 5) * (a.cascScore || 1));
    }).slice(0, 6);
    if (!list.length) return '';
    return '<div class="wg-hint" style="margin-top:8px;">Top enemy targets:</div><div class="wg-sel-list">' +
      list.map(function (n) { return '<span class="wg-chip" data-pick="' + esc(n.id) + '">' + esc(n.name) + '</span>'; }).join('') + '</div>';
  }

  function logSection(state) {
    var rep = state.lastReport;
    if (!rep) return '';
    var items = rep.events.map(function (e) {
      var cls = e.kind === 'kill' || e.kind === 'cascade' ? 'kill' : (e.kind === 'hit' ? 'hit' : (e.kind === 'repair' ? 'repair' : (e.kind === 'miss' ? 'miss' : '')));
      return '<li class="' + cls + '">' + esc(e.text) + '</li>';
    }).join('');
    var dl = 'Blue +' + Math.round(rep.scoreDelta.blue) + ' · Red +' + Math.round(rep.scoreDelta.red);
    return '<div class="wg-sec"><h4>Turn ' + rep.turn + ' resolution — ' + dl + '</h4><ul class="wg-log">' + (items || '<li>No effects.</li>') + '</ul></div>';
  }

  // ---- actions -------------------------------------------------------------------
  function onHudClick(ev) {
    var t = ev.target.closest('[data-act],[data-order],[data-rm],[data-active],[data-side],[data-turns],[data-diff],[data-fog],[data-pick]');
    if (!t) return;

    // setup toggles
    if (t.hasAttribute('data-side')) { setGroupOn(t); return; }
    if (t.hasAttribute('data-turns')) { setGroupOn(t); return; }
    if (t.hasAttribute('data-diff')) { setGroupOn(t); return; }
    if (t.hasAttribute('data-fog')) { setGroupOn(t); return; }

    if (t.hasAttribute('data-active')) { activeSide = t.getAttribute('data-active'); render(W.getState()); return; }
    if (t.hasAttribute('data-pick')) { if (typeof selectNodeById === 'function') selectNodeById(t.getAttribute('data-pick')); else if (typeof selectNode === 'function') { var n = findNode(t.getAttribute('data-pick')); if (n) selectNode(n); } lastSelId = null; pollSelection(); return; }
    if (t.hasAttribute('data-rm')) { W.removeOrder(activeSide, Number(t.getAttribute('data-rm'))); return; }

    if (t.hasAttribute('data-order')) {
      var order = { kind: t.getAttribute('data-order'), targetId: t.getAttribute('data-tid') };
      if (order.kind === 'strike') order.methodKey = t.getAttribute('data-method');
      var ok = W.queueOrder(activeSide, order);
      if (!ok && typeof addEvent === 'function') addEvent({ type: 'War', text: 'Order rejected (no action points or invalid target).' });
      return;
    }

    var act = t.getAttribute('data-act');
    if (act === 'start') doStart();
    else if (act === 'commit') doCommit();
    else if (act === 'next') { W.nextTurn(); }
    else if (act === 'clear') W.clearOrders(activeSide);
    else if (act === 'newmatch') { W.endMatch(); refreshVisuals(); renderSetup(); }
    else if (act === 'pass') doPass();
    else if (act === 'ready') doReady();
  }

  // Lock the current side's orders and raise the handoff curtain for the next human side.
  function doPass() {
    var cfg = W.getState().cfg;
    var humans = humanSides(cfg);
    var next = humans[humans.indexOf(activeSide) + 1];
    if (!next) { doCommit(); return; }
    pendingSide = next;
    curtain = true;
    if (typeof selectNode === 'function') selectNode(null);   // clear selection so the next player starts clean
    lastSelId = null;
    render(W.getState());
  }
  function doReady() {
    if (!pendingSide) return;
    activeSide = pendingSide;
    pendingSide = null;
    curtain = false;
    lastSelId = null;
    render(W.getState());
  }

  function setGroupOn(btn) {
    var group = btn.parentElement;
    [].forEach.call(group.querySelectorAll('button'), function (b) { b.classList.remove('on'); });
    btn.classList.add('on');
  }
  function findNode(id) { var g = (window.AppState && window.AppState.activeGraph()) || { nodes: [] }; return (g.nodes || []).filter(function (n) { return n.id === id; })[0]; }

  function doStart() {
    var cfg = readSetup();
    activeSide = firstHuman(cfg);
    planTurnInit = -1; curtain = false; pendingSide = null;   // re-arm plan-phase init for the new match
    W.newMatch(cfg);
    refreshVisuals();
    if (typeof addEvent === 'function') addEvent({ type: 'War', text: 'War Game started — ' + cfg.control.blue + ' Blue vs ' + cfg.control.red + ' Red, ' + cfg.turnLimit + ' turns.' });
  }

  function doCommit() {
    var st = W.commitTurn();
    refreshVisuals();
    // selection may now point at a dead node; force target re-render
    lastSelId = '__force__';
  }

  // ---- engine callbacks ----------------------------------------------------------
  function onState(state) {
    if (!hud || !hud.classList.contains('wg-open')) return;
    if (!state) { renderSetup(); return; }
    render(state);
  }
  function onResolved(report, state) {
    refreshVisuals();
    if (typeof addEvent === 'function' && report) {
      var kills = report.events.filter(function (e) { return e.kind === 'kill' || e.kind === 'cascade'; }).length;
      addEvent({ type: 'War', text: 'Turn ' + report.turn + ' resolved — ' + kills + ' node(s) neutralized.' });
    }
  }

  // ---- boot ----------------------------------------------------------------------
  function boot() {
    if (!window.GameModule) { console.warn('[wargame] GameModule missing'); return; }
    W = window.GameModule;
    W.init({ onState: onState, onResolved: onResolved });
    injectCss();
    build();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
