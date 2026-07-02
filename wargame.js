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

  // Strike FX: tracks active overlay/flash elements and timers so they are always cleaned up.
  var _fxTimers = [];

  function humanSides(cfg) { return ['blue', 'red'].filter(function (s) { return cfg.control[s] === 'human'; }); }
  function otherSide(s) { return s === 'blue' ? 'red' : 'blue'; }
  function hpBand(h, max) { var f = max ? h / max : 0; return f > 0.66 ? 'Intact' : (f > 0.33 ? 'Damaged' : 'Critical'); }
  function fogActive(cfg) { return !!(cfg && cfg.fog); }
  // Mirror of the engine's tempo-role test (game.js nodeTempoRole) so the UI can flag
  // command/logistics targets whose loss throttles the enemy's action points.
  function tempoRole(n) {
    if (!n) return null;
    var s = (String(n.type || '') + ' ' + String(n.subsystem || '')).toLowerCase();
    if (/command/.test(s)) return 'Command';
    if (/logist|support|sustain/.test(s)) return 'Logistics';
    if (/relay|comm/.test(s)) return 'Relay';
    return null;
  }

  // ---- health / AP color helpers -------------------------------------------------
  // Returns a CSS color literal for a HP fraction: green→amber→alert.
  function hpColor(frac) {
    if (frac > 0.66) return '#51cf66';   // --aff-neutral / healthy
    if (frac > 0.33) return '#ffb000';   // --amber / damaged
    return '#ff3b3b';                     // --alert / critical
  }
  // Returns accent color for a given side.
  function sideColor(side) {
    return side === 'blue' ? '#38bdf8' : '#ff4d5e';
  }
  // AP bar color: cyan when plentiful, amber when low, alert when almost out.
  function apColor(left, total) {
    var f = total ? left / total : 0;
    if (f > 0.5) return '#00d8ff';
    if (f > 0.2) return '#ffb000';
    return '#ff3b3b';
  }

  // ---- Strike FX -----------------------------------------------------------------
  // Brief cinematic edge-flash when a turn resolves with strike events.
  // Fully guarded: no-ops if DOM isn't ready or reduced-motion is preferred.
  function playStrikeFX(events) {
    try {
      if (!events || !events.length) return;
      var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReduced) return;

      var kills  = events.filter(function (e) { return e.kind === 'kill' || e.kind === 'cascade'; }).length;
      var hits   = events.filter(function (e) { return e.kind === 'hit'; }).length;
      if (!kills && !hits) return;

      // Create a screen-edge flash overlay.
      var overlay = document.createElement('div');
      overlay.id = 'wg-strike-fx';
      overlay.setAttribute('aria-hidden', 'true');
      var color = kills ? 'rgba(255,59,59,0.18)' : 'rgba(0,216,255,0.12)';
      overlay.style.cssText = [
        'position:fixed;inset:0;z-index:9990;pointer-events:none;',
        'background:radial-gradient(ellipse at center,transparent 30%,' + color + ' 100%);',
        'animation:wg-fx-flash 0.55s ease-out forwards;'
      ].join('');
      document.body.appendChild(overlay);

      // Scanline pulse bar at top of viewport.
      var tracer = document.createElement('div');
      tracer.id = 'wg-strike-tracer';
      tracer.setAttribute('aria-hidden', 'true');
      var tracerColor = kills ? '#ff3b3b' : '#00d8ff';
      tracer.style.cssText = [
        'position:fixed;top:0;left:0;right:0;height:3px;z-index:9991;pointer-events:none;',
        'background:linear-gradient(90deg,transparent,' + tracerColor + ',transparent);',
        'animation:wg-fx-tracer 0.7s ease-out forwards;'
      ].join('');
      document.body.appendChild(tracer);

      // HUD corner pulse badge (shows kill count or hit count).
      var badge = document.createElement('div');
      badge.id = 'wg-strike-badge';
      badge.setAttribute('aria-hidden', 'true');
      var badgeText = kills ? (kills + (kills === 1 ? ' NODE NEUTRALIZED' : ' NODES NEUTRALIZED'))
                            : (hits + (hits === 1 ? ' HIT' : ' HITS'));
      badge.textContent = badgeText;
      badge.style.cssText = [
        'position:fixed;top:14px;right:356px;z-index:9992;pointer-events:none;',
        'font:700 11px/1 "Share Tech Mono",ui-monospace,monospace;letter-spacing:.12em;',
        'color:' + tracerColor + ';',
        kills ? 'text-shadow:0 0 10px rgba(255,59,59,0.8);' : 'text-shadow:0 0 10px rgba(0,216,255,0.8);',
        'padding:5px 10px;border-radius:4px;',
        'background:rgba(9,16,24,0.88);border:1px solid ' + tracerColor + ';',
        'animation:wg-fx-badge 1.4s ease-out forwards;'
      ].join('');
      document.body.appendChild(badge);

      // Remove elements after animation completes.
      function cleanup(el) {
        var t = setTimeout(function () {
          try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch (e) {}
        }, 1500);
        _fxTimers.push(t);
      }
      cleanup(overlay); cleanup(tracer); cleanup(badge);
    } catch (e) {}
  }

  // ---- styles --------------------------------------------------------------------
  var CSS = [
    // ---- Launch button — premium HUD action ----
    '#wg-launch{',
      'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:1400;',
      'background:rgba(9,16,24,0.88);',
      'color:#00d8ff;',
      'border:1px solid rgba(0,216,255,0.45);',
      'padding:8px 20px;border-radius:6px;',
      "font:700 12px/1 'Orbitron','Oswald',system-ui,sans-serif;letter-spacing:.12em;",
      'cursor:pointer;',
      'box-shadow:0 0 14px rgba(0,216,255,0.35),inset 0 1px 0 rgba(0,216,255,0.08);',
      'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);',
      'transition:box-shadow .15s,border-color .15s,color .15s;',
    '}',
    '#wg-launch:hover{',
      'border-color:rgba(0,216,255,0.85);color:#fff;',
      'box-shadow:0 0 22px rgba(0,216,255,0.6),inset 0 1px 0 rgba(0,216,255,0.15);',
    '}',

    // ---- HUD panel ----
    '#wg-hud{',
      'position:fixed;top:0;right:0;width:340px;',
      'max-height:100vh;',          /* never taller than the viewport */
      'height:100%;',
      'z-index:1390;display:flex;flex-direction:column;',
      'background:rgba(9,16,24,0.92);',
      'border-left:1px solid rgba(0,216,255,0.22);',
      'box-shadow:-8px 0 30px rgba(0,0,0,.6),0 0 0 1px rgba(0,216,255,0.05) inset;',
      'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);',
      "color:#cfe0ee;font:13px/1.5 'Inter',system-ui,sans-serif;",
      'transform:translateX(100%);transition:transform .25s ease;',
    '}',
    '#wg-hud.wg-open{transform:translateX(0);}',
    '.wg-hidden{display:none!important;}',

    // ---- Header with corner-bracket accent ----
    '#wg-hud header{',
      'display:flex;align-items:center;justify-content:space-between;',
      'padding:12px 14px;',
      'border-bottom:1px solid rgba(0,216,255,0.18);',
      'background:rgba(9,16,24,0.74);',
      'flex-shrink:0;',        /* never compress the header */
      'position:relative;',
    '}',
    // Top-left corner bracket
    '#wg-hud header::before{',
      'content:"";position:absolute;top:6px;left:6px;width:10px;height:10px;',
      'border-top:1.5px solid rgba(0,216,255,0.6);border-left:1.5px solid rgba(0,216,255,0.6);',
    '}',
    // Top-right corner bracket
    '#wg-hud header::after{',
      'content:"";position:absolute;top:6px;right:6px;width:10px;height:10px;',
      'border-top:1.5px solid rgba(0,216,255,0.6);border-right:1.5px solid rgba(0,216,255,0.6);',
    '}',
    '#wg-hud header .wg-title{',
      "font:700 13px/1 'Orbitron','Oswald',system-ui,sans-serif;",
      'letter-spacing:.14em;color:#00d8ff;',
      'text-shadow:0 0 8px rgba(0,216,255,0.5);',
    '}',
    '#wg-hud header .wg-sub{',
      "font:500 10px/1 'Share Tech Mono',ui-monospace,monospace;",
      'letter-spacing:.06em;color:#7fa3c0;margin-top:3px;',
    '}',
    '#wg-x{',
      'background:none;border:none;color:rgba(0,216,255,0.55);',
      'cursor:pointer;font-size:18px;line-height:1;padding:2px 6px;',
      'transition:color .12s;',
    '}',
    '#wg-x:hover{color:#00d8ff;}',

    // ---- Body: scrollable ----
    '.wg-body{',
      'flex:1;overflow-y:auto;padding:12px 14px;',
      'min-height:0;',           /* allow flex shrink + internal scroll */
    '}',
    // Subtle scanline overlay on body
    '.wg-body::before{',
      'content:"";position:fixed;inset:0;pointer-events:none;z-index:-1;',
      'background:repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,216,255,0.015) 3px,rgba(0,216,255,0.015) 4px);',
    '}',

    // ---- Footer ----
    '.wg-foot{',
      'border-top:1px solid rgba(0,216,255,0.14);',
      'padding:10px 14px;',
      'background:rgba(9,16,24,0.82);',
      'flex-shrink:0;',
    '}',

    // ---- Section / headings ----
    '.wg-sec{margin-bottom:14px;}',
    '.wg-sec h4{',
      'margin:0 0 7px;',
      "font:700 10px/1 'Share Tech Mono',ui-monospace,monospace;",
      'letter-spacing:.14em;color:rgba(0,216,255,0.7);text-transform:uppercase;',
    '}',

    // ---- Score cards ----
    '.wg-row{display:flex;gap:8px;align-items:center;}',
    '.wg-row+.wg-row{margin-top:6px;}',
    '.wg-score{display:flex;gap:8px;}',
    '.wg-score .wg-card{',
      'flex:1;border-radius:6px;padding:9px 10px;',
      'background:rgba(9,16,24,0.74);',
      'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);',
      'border:1px solid rgba(0,216,255,0.12);',
      'position:relative;overflow:hidden;',
    '}',
    // Corner bracket on cards
    '.wg-card::before{',
      'content:"";position:absolute;top:4px;left:4px;width:7px;height:7px;',
      'border-top:1px solid;border-left:1px solid;opacity:0.5;',
    '}',
    '.wg-card::after{',
      'content:"";position:absolute;bottom:4px;right:4px;width:7px;height:7px;',
      'border-bottom:1px solid;border-right:1px solid;opacity:0.35;',
    '}',
    '.wg-card.blue{border-color:rgba(56,189,248,0.3);}',
    '.wg-card.blue::before,.wg-card.blue::after{border-color:#38bdf8;}',
    '.wg-card.red{border-color:rgba(255,77,94,0.3);}',
    '.wg-card.red::before,.wg-card.red::after{border-color:#ff4d5e;}',
    '.wg-card .wg-team{',
      "font:700 11px/1 'Orbitron','Oswald',system-ui,sans-serif;",
      'letter-spacing:.1em;',
    '}',
    '.wg-card.blue .wg-team{color:#38bdf8;text-shadow:0 0 8px rgba(56,189,248,0.45);}',
    '.wg-card.red  .wg-team{color:#ff4d5e;text-shadow:0 0 8px rgba(255,77,94,0.45);}',
    '.wg-card .wg-pts{',
      "font:700 22px/1 'Share Tech Mono',ui-monospace,monospace;",
      'color:#eaf4ff;margin-top:3px;',
    '}',
    '.wg-card .wg-meta{',
      "font:400 10px/1.3 'Share Tech Mono',ui-monospace,monospace;",
      'color:#7e9cb5;margin-top:3px;',
    '}',
    '.wg-bar{height:4px;border-radius:2px;background:rgba(0,216,255,0.08);margin-top:7px;overflow:hidden;}',
    '.wg-bar>i{display:block;height:100%;border-radius:2px;}',
    '.wg-card.blue .wg-bar>i{background:linear-gradient(90deg,rgba(56,189,248,0.5),#38bdf8);}',
    '.wg-card.red  .wg-bar>i{background:linear-gradient(90deg,rgba(255,77,94,0.5),#ff4d5e);}',

    // Tempo row
    '.wg-meta.wg-tempo{margin-top:5px;color:#c4a84a;}',
    '.wg-meta.wg-tempo b{color:#ffb000;}',
    '.wg-bar.wg-tempo-bar{background:rgba(255,176,0,0.08);}',
    '.wg-bar.wg-tempo-bar>i{background:linear-gradient(90deg,rgba(255,176,0,0.4),#ffb000);}',

    // Objectives row
    '.wg-meta.wg-obj{margin-top:5px;color:#bcd6ec;}',
    '.wg-meta.wg-obj b{color:#eaf4ff;}',
    '.wg-meta.wg-obj-crit{color:#ff8a8a;}',
    '.wg-meta.wg-obj-crit b{color:#ff4d5e;}',
    '.wg-bar.wg-obj-bar{background:rgba(81,207,102,0.08);}',
    '.wg-bar.wg-obj-bar>i{background:linear-gradient(90deg,rgba(56,189,248,0.4),#51cf66);}',

    // Tempo tag pill
    '.wg-tempo-tag{',
      'display:inline-block;',
      "font:700 9px/1 'Share Tech Mono',ui-monospace,monospace;",
      'letter-spacing:.1em;',
      'color:#0a1018;background:#ffb000;border-radius:10px;padding:2px 7px;margin-top:4px;',
    '}',

    // Strategy callout
    '.wg-strat{',
      "font:400 11px/1.45 'Inter',system-ui,sans-serif;",
      'color:#c4a84a;border:1px solid rgba(255,176,0,0.25);',
      'background:rgba(255,176,0,0.06);border-radius:6px;padding:7px 9px;margin-top:8px;',
    '}',

    // ---- Buttons ----
    '.wg-btn{',
      'background:rgba(9,16,24,0.74);color:#c8e0f4;',
      'border:1px solid rgba(0,216,255,0.22);border-radius:5px;',
      'padding:7px 10px;',
      "font:600 12px/1 'Inter',system-ui,sans-serif;",
      'cursor:pointer;transition:border-color .12s,box-shadow .12s,color .12s;',
    '}',
    '.wg-btn:hover{border-color:#00d8ff;color:#fff;box-shadow:0 0 8px rgba(0,216,255,0.3);}',
    '.wg-btn:disabled{opacity:.35;cursor:not-allowed;}',
    '.wg-btn.primary{',
      'background:rgba(0,216,255,0.08);',
      'border-color:rgba(0,216,255,0.55);color:#00d8ff;',
      'width:100%;padding:10px;',
      "font:700 12px/1 'Orbitron','Oswald',system-ui,sans-serif;letter-spacing:.1em;",
      'box-shadow:0 0 10px rgba(0,216,255,0.18);',
    '}',
    '.wg-btn.primary:hover{border-color:#00d8ff;color:#fff;box-shadow:0 0 18px rgba(0,216,255,0.45);}',
    '.wg-btn.danger{border-color:rgba(255,59,59,0.45);color:#ff8a8a;}',
    '.wg-btn.danger:hover{border-color:#ff3b3b;box-shadow:0 0 8px rgba(255,59,59,0.3);}',
    '.wg-btn.full{width:100%;}',
    '.wg-btn.sm{padding:5px 8px;font-size:11px;}',

    // Strike method grid
    '.wg-method{display:grid;grid-template-columns:1fr 1fr;gap:6px;}',
    '.wg-method .wg-btn{',
      'position:relative;text-align:left;',
      'border-color:rgba(0,216,255,0.18);',
    '}',
    '.wg-method .wg-btn:hover{border-color:rgba(255,176,0,0.7);color:#ffb000;box-shadow:0 0 8px rgba(255,176,0,0.25);}',
    '.wg-method .wg-btn .vh{',
      "font:500 10px/1 'Share Tech Mono',ui-monospace,monospace;",
      'color:#ffb000;display:block;margin-top:3px;',
    '}',

    // Toggle bar
    '.wg-toggle{display:flex;border:1px solid rgba(0,216,255,0.18);border-radius:6px;overflow:hidden;}',
    '.wg-toggle button{',
      'flex:1;background:transparent;border:none;',
      'color:rgba(0,216,255,0.45);padding:6px;',
      "font:600 11px/1 'Share Tech Mono',ui-monospace,monospace;letter-spacing:.06em;",
      'cursor:pointer;transition:background .12s,color .12s;',
    '}',
    '.wg-toggle button.on{background:rgba(0,216,255,0.12);color:#00d8ff;}',
    '.wg-toggle.blue button.on{background:rgba(56,189,248,0.15);color:#38bdf8;}',
    '.wg-toggle.red  button.on{background:rgba(255,77,94,0.15);color:#ff4d5e;}',

    // Orders list
    '.wg-orders{list-style:none;margin:0;padding:0;}',
    '.wg-orders li{',
      'display:flex;align-items:center;justify-content:space-between;gap:6px;',
      'padding:5px 8px;border:1px solid rgba(0,216,255,0.12);',
      'border-radius:5px;margin-bottom:5px;',
      'background:rgba(9,16,24,0.6);',
      "font:400 12px/1.3 'Share Tech Mono',ui-monospace,monospace;",
      'color:#a0c4df;',
    '}',
    '.wg-orders li .x{color:rgba(255,77,94,0.7);cursor:pointer;font-weight:700;padding:0 4px;transition:color .12s;}',
    '.wg-orders li .x:hover{color:#ff4d5e;}',

    // Selection panel
    '.wg-sel{',
      'border:1px solid rgba(0,216,255,0.18);border-radius:6px;',
      'padding:9px 10px;background:rgba(9,16,24,0.74);',
    '}',
    '.wg-sel .nm{',
      "font:700 13px/1.2 'Inter',system-ui,sans-serif;",
      'color:#eaf4ff;',
    '}',
    '.wg-sel .meta{',
      "font:400 11px/1.3 'Share Tech Mono',ui-monospace,monospace;",
      'color:#88a8c2;margin-top:4px;',
    '}',
    '.wg-sel .tag{display:inline-block;font-size:10px;padding:1px 6px;border-radius:10px;margin-right:4px;letter-spacing:.06em;}',
    '.wg-sel .tag.blue{background:rgba(56,189,248,0.18);color:#38bdf8;border:1px solid rgba(56,189,248,0.35);}',
    '.wg-sel .tag.red {background:rgba(255,77,94,0.18); color:#ff4d5e;border:1px solid rgba(255,77,94,0.35);}',

    // Hint text
    '.wg-hint{',
      "font:400 11px/1.45 'Inter',system-ui,sans-serif;",
      'color:rgba(0,216,255,0.45);font-style:italic;',
    '}',

    // Combat log
    '.wg-log{list-style:none;margin:0;padding:0;max-height:170px;overflow-y:auto;}',
    '.wg-log li{',
      'padding:3px 0;border-bottom:1px solid rgba(0,216,255,0.07);',
      "font:400 11.5px/1.4 'Share Tech Mono',ui-monospace,monospace;",
      'color:#a9c3d8;',
    '}',
    '.wg-log li.kill{color:#ff4d5e;font-weight:700;}',
    '.wg-log li.hit {color:#38bdf8;}',
    '.wg-log li.repair{color:#51cf66;}',
    '.wg-log li.miss{color:rgba(111,130,149,0.7);}',

    // AAR
    '.wg-aar-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;}',
    '.wg-aar-metric{',
      'border:1px solid rgba(0,216,255,0.14);border-radius:6px;',
      'background:rgba(9,16,24,0.74);padding:8px 9px;',
    '}',
    '.wg-aar-metric b{',
      "display:block;font:700 18px/1.1 'Share Tech Mono',ui-monospace,monospace;",
      'color:#eaf4ff;margin-bottom:3px;',
    '}',
    '.wg-aar-metric span{',
      "display:block;font:500 10px/1 'Share Tech Mono',ui-monospace,monospace;",
      'color:rgba(0,216,255,0.55);letter-spacing:.08em;text-transform:uppercase;',
    '}',
    '.wg-aar-callout{',
      'border:1px solid rgba(0,216,255,0.22);border-left:3px solid #00d8ff;',
      'border-radius:6px;background:rgba(9,16,24,0.74);padding:9px 10px;',
      'color:#c8e0f4;',
      "font:400 12px/1.4 'Inter',system-ui,sans-serif;",
    '}',
    '.wg-aar-callout.red {border-left-color:#ff4d5e;}',
    '.wg-aar-callout.blue{border-left-color:#38bdf8;}',
    '.wg-aar-table{width:100%;border-collapse:collapse;',
      "font:400 11px/1.4 'Share Tech Mono',ui-monospace,monospace;}",
    '.wg-aar-table th{',
      'color:rgba(0,216,255,0.6);text-align:left;font-weight:700;',
      'border-bottom:1px solid rgba(0,216,255,0.14);padding:4px 3px;',
      'letter-spacing:.08em;',
    '}',
    '.wg-aar-table td{border-bottom:1px solid rgba(0,216,255,0.07);padding:4px 3px;color:#bfd4e7;vertical-align:top;}',
    '.wg-aar-table td.num{text-align:right;color:#eaf4ff;font-variant-numeric:tabular-nums;}',
    '.wg-aar-list{list-style:none;margin:0;padding:0;}',
    '.wg-aar-list li{',
      'padding:5px 0;border-bottom:1px solid rgba(0,216,255,0.07);',
      'color:#a9c3d8;',
      "font:400 11.5px/1.4 'Share Tech Mono',ui-monospace,monospace;",
    '}',
    '.wg-aar-list b{color:#eaf4ff;}',
    '.wg-turn-chart{display:grid;gap:4px;}',
    '.wg-turn-row{',
      'display:grid;grid-template-columns:32px 1fr 50px;align-items:center;gap:6px;',
      "font:400 11px/1 'Share Tech Mono',ui-monospace,monospace;color:rgba(0,216,255,0.55);",
    '}',
    '.wg-turn-bars{display:grid;gap:2px;}',
    '.wg-turn-bars i{display:block;height:4px;border-radius:2px;}',
    '.wg-turn-bars .blue{background:linear-gradient(90deg,rgba(56,189,248,0.4),#38bdf8);}',
    '.wg-turn-bars .red {background:linear-gradient(90deg,rgba(255,77,94,0.4),#ff4d5e);}',
    '.wg-aar-pill{',
      'display:inline-block;border:1px solid rgba(0,216,255,0.18);border-radius:999px;',
      'padding:1px 7px;margin:2px 3px 0 0;color:#bcd6ec;background:rgba(9,16,24,0.6);',
      "font:400 10px/1.4 'Share Tech Mono',ui-monospace,monospace;",
    '}',

    // Result banner
    '.wg-banner{',
      'text-align:center;padding:12px;border-radius:6px;',
      "font:700 14px/1 'Orbitron','Oswald',system-ui,sans-serif;",
      'letter-spacing:.12em;margin-bottom:10px;',
    '}',
    '.wg-banner.blue{background:rgba(56,189,248,0.12);color:#38bdf8;border:1px solid rgba(56,189,248,0.4);box-shadow:0 0 16px rgba(56,189,248,0.2);}',
    '.wg-banner.red {background:rgba(255,77,94,0.12); color:#ff4d5e;border:1px solid rgba(255,77,94,0.4);box-shadow:0 0 16px rgba(255,77,94,0.2);}',

    // Quick target chips
    '.wg-sel-list{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px;}',
    '.wg-chip{',
      "font:500 11px/1 'Share Tech Mono',ui-monospace,monospace;",
      'padding:5px 8px;border:1px solid rgba(0,216,255,0.2);border-radius:5px;',
      'background:rgba(9,16,24,0.74);color:#a0c4df;cursor:pointer;transition:border-color .12s,color .12s;',
    '}',
    '.wg-chip:hover{border-color:#00d8ff;color:#00d8ff;}',

    // Fog badges
    '.wg-card.fog .wg-pts{color:rgba(0,216,255,0.35);}',
    '.wg-card.fog{opacity:.8;}',
    '.wg-fogtag{',
      'display:inline-block;',
      "font:600 9px/1 'Share Tech Mono',ui-monospace,monospace;letter-spacing:.08em;",
      'color:#ffd43b;border:1px solid rgba(255,212,59,0.4);',
      'background:rgba(255,212,59,0.1);border-radius:10px;padding:2px 7px;margin-left:5px;vertical-align:middle;',
    '}',

    // Blind handoff curtain
    '.wg-curtain{',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;',
      'text-align:center;min-height:60vh;gap:12px;',
    '}',
    '.wg-curtain .lock{font-size:46px;}',
    '.wg-curtain .ttl{',
      "font:700 15px/1 'Orbitron','Oswald',system-ui,sans-serif;",
      'letter-spacing:.14em;color:#eaf4ff;',
    '}',
    '.wg-curtain p{',
      "font:400 13px/1.5 'Inter',system-ui,sans-serif;",
      'color:#7fbdd6;margin:2px 0 8px;',
    '}',
    '.wg-curtain b.blue{color:#38bdf8;}.wg-curtain b.red{color:#ff4d5e;}',
    '.wg-curtain .wg-btn{min-width:220px;}',

    // ---- Strike FX keyframes ----
    '@keyframes wg-fx-flash{',
      '0%{opacity:0}10%{opacity:1}80%{opacity:0.6}100%{opacity:0}',
    '}',
    '@keyframes wg-fx-tracer{',
      '0%{opacity:0;transform:scaleX(0)}15%{opacity:1;transform:scaleX(1)}85%{opacity:0.7;transform:scaleX(1)}100%{opacity:0}',
    '}',
    '@keyframes wg-fx-badge{',
      '0%{opacity:0;transform:translateY(-4px)}12%{opacity:1;transform:translateY(0)}80%{opacity:1}100%{opacity:0}',
    '}',

    // ---- AP readout inline color (applied via style attribute helpers) ----
    // Health spans (wg-hp-*) and AP spans (wg-ap-*) are colored inline.

    // ---- Reduced-motion overrides ----
    '@media (prefers-reduced-motion:reduce){',
      '#wg-hud{transition:none;}',
      '.wg-btn,.wg-toggle button,.wg-chip{transition:none;}',
      '#wg-strike-fx,#wg-strike-tracer,#wg-strike-badge{display:none!important;}',
    '}',

    // ---- Fonts ----
    '#wg-hud,#wg-launch{font-family:"Inter",system-ui,"Segoe UI",sans-serif;}',
  ].join('');

  function injectCss() {
    if (document.getElementById('wg-style')) return;
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
    launchBtn = el('<button id="wg-launch" title="Open the turn-based War Game">&#9876; WAR GAME</button>');
    launchBtn.addEventListener('click', open);
    document.body.appendChild(launchBtn);

    hud = el('<div id="wg-hud"><header><div><div class="wg-title">&#9876; WAR GAME</div><div class="wg-sub" id="wg-sub">Set up a match</div></div><button id="wg-x" title="Close">&#215;</button></header><div class="wg-body" id="wg-body"></div><div class="wg-foot" id="wg-foot"></div></div>');
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
    // Clean up any lingering FX timers.
    _fxTimers.forEach(function (t) { try { clearTimeout(t); } catch (e) {} });
    _fxTimers.length = 0;
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
      '<p class="wg-hint">Both sides commit orders blind each turn, then everything resolves at once. A side is defeated if its surviving force value falls below 35% of its start, otherwise the higher score at the final turn wins.</p>' +
      '<p class="wg-strat">&#9889; <b>Command tempo:</b> your action points each turn come from your surviving <b>Command</b> &amp; <b>Logistics</b> nodes. Strike the enemy\'s C2/sustainment to throttle how many orders they can issue &mdash; or protect your own to keep your tempo up.</p>' +
      '<p class="wg-strat">&#127919; <b>Key objectives:</b> each side has 8 high-value nodes. Lose most of yours and you\'re defeated outright &mdash; so it\'s hold-your-key-terrain and deny-theirs, not just attrition.</p>';
    document.getElementById('wg-foot').innerHTML = '<button class="wg-btn primary" data-act="start">START MATCH</button>';
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
        '<button class="wg-btn primary" data-act="ready">' + pendingSide.toUpperCase() + ' IS READY &rarr;</button></div>';
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
      if (state.phase === 'over') html += aarSection(state);
      html += logSection(state);
    }
    body.innerHTML = html;
    if (state.phase === 'plan' && cfg.control[activeSide] === 'human') renderTargetSection(state);

    // footer
    if (state.phase === 'plan') {
      if (fogHandoff) {
        var idx = humans.indexOf(activeSide);
        if (idx === humans.length - 1) foot.innerHTML = '<button class="wg-btn primary" data-act="commit">COMMIT TURN &rarr; RESOLVE</button>';
        else foot.innerHTML = '<button class="wg-btn primary" data-act="pass">LOCK ORDERS &rarr; PASS TO ' + humans[idx + 1].toUpperCase() + '</button>';
      } else {
        var label = anyHuman(cfg) ? 'COMMIT TURN → RESOLVE' : 'RESOLVE TURN';
        foot.innerHTML = '<button class="wg-btn primary" data-act="commit">' + label + '</button>';
      }
    } else if (state.phase === 'resolved') {
      foot.innerHTML = '<button class="wg-btn primary" data-act="next">NEXT TURN &rarr;</button>';
    } else { // over
      foot.innerHTML = '<button class="wg-btn primary" data-act="newmatch">NEW MATCH</button>';
    }
  }
  function anyHuman(cfg) { return cfg.control.blue === 'human' || cfg.control.red === 'human'; }

  function scoreboard(state, maskEnemy) {
    var fracB = state.startObj.blue ? Math.max(0, state.objNow.blue / state.startObj.blue) : 0;
    var fracR = state.startObj.red ? Math.max(0, state.objNow.red / state.startObj.red) : 0;
    var banner = '';
    if (state.phase === 'over' && state.winner) {
      var winLabel = state.winner === 'draw' ? 'DRAW' : (state.winner === 'blue' ? 'BLUE WINS' : 'RED WINS');
      banner = '<div class="wg-banner ' + state.winner + '">' + winLabel + '</div>';
    }
    var tempo = state.tempo || {};
    var obj = state.objectives || {};
    var blueCard = maskEnemy === 'blue'
      ? maskedCard('blue', 'BLUE', state.alive.blue, state.rosters.blue)
      : card('blue', 'BLUE', state.score.blue, state.alive.blue, state.rosters.blue, fracB, tempo.blue, obj.blue);
    var redCard = maskEnemy === 'red'
      ? maskedCard('red', 'RED', state.alive.red, state.rosters.red)
      : card('red', 'RED', state.score.red, state.alive.red, state.rosters.red, fracR, tempo.red, obj.red);
    return banner + '<div class="wg-sec"><div class="wg-score">' + blueCard + redCard + '</div></div>';
  }
  function maskedCard(side, label, alive, total) {
    return '<div class="wg-card fog ' + side + '"><div class="wg-team">' + label + ' <span class="wg-fogtag">fog</span></div>' +
      '<div class="wg-pts">&mdash; &middot; &mdash;</div><div class="wg-meta">' + alive + '/' + total + ' active &middot; strength unknown</div>' +
      '<div class="wg-bar"></div></div>';
  }
  function card(side, label, score, alive, total, frac, tempo, obj) {
    var forcePct = Math.round(frac * 100);
    var forceColor = hpColor(frac);
    var tempoRow = '';
    if (tempo) {
      var tfrac = Math.max(0, Math.min(1, tempo.frac == null ? 1 : tempo.frac));
      var apCol = apColor(tempo.ap, tempo.ap / (tfrac || 1));
      tempoRow = '<div class="wg-meta wg-tempo">&#9889; <b style="color:' + apCol + '">' + tempo.ap + ' AP</b>' +
        ' &middot; C2 ' + tempo.c2 + ' &middot; Logi ' + tempo.logi + '</div>' +
        '<div class="wg-bar wg-tempo-bar"><i style="width:' + Math.round(tfrac * 100) + '%"></i></div>';
    }
    var objRow = '';
    if (obj && obj.total) {
      var ofrac = obj.held / obj.total;
      var crit = ofrac <= 0.4 ? ' wg-obj-crit' : '';
      objRow = '<div class="wg-meta wg-obj' + crit + '">&#127919; Key obj <b>' + obj.held + '/' + obj.total + '</b> held</div>' +
        '<div class="wg-bar wg-obj-bar"><i style="width:' + Math.round(ofrac * 100) + '%"></i></div>';
    }
    return '<div class="wg-card ' + side + '"><div class="wg-team">' + label + '</div>' +
      '<div class="wg-pts" style="color:' + sideColor(side) + ';text-shadow:0 0 10px ' + sideColor(side) + '55;">' + Math.round(score) + '</div>' +
      '<div class="wg-meta">' + alive + '/' + total + ' active &middot; force <span style="color:' + forceColor + '">' + forcePct + '%</span></div>' +
      '<div class="wg-bar"><i style="width:' + forcePct + '%;background:' + forceColor + ';opacity:0.85;"></i></div>' +
      tempoRow + objRow + '</div>';
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
    var apTotal = state.ap[activeSide];
    var apCol = apColor(apLeft, apTotal);
    return '<div class="wg-sec"><h4>Orders &mdash; ' + activeSide.toUpperCase() +
      ' (<span style="color:' + apCol + '">' + apLeft + '</span> of ' + apTotal + ' AP left)</h4>' +
      '<ul class="wg-orders">' + (lis || '<li style="opacity:.5;border-style:dashed;border-color:rgba(0,216,255,0.15);">No orders yet &mdash; select a node below</li>') + '</ul>' +
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
    var hpFrac = bn.healthMax ? bn.health / bn.healthMax : 0;
    var hpCol = hpColor(hpFrac);
    var hpText = fogEnemy
      ? (hpBand(bn.health, bn.healthMax) + ' <span class="wg-fogtag">est.</span>')
      : ('<span style="color:' + hpCol + '">' + Math.round(bn.health) + '</span>/' + bn.healthMax + ' hp');
    var teamCol = sideColor(bn.team);
    var head = '<h4>Selected target</h4><div class="wg-sel"><div class="nm">' + esc(bn.name) + '</div>' +
      '<div class="meta"><span class="tag ' + bn.team + '">' + bn.team.toUpperCase() + '</span>' +
      esc(bn.difficulty) + ' &middot; ' + hpText +
      (bn.vulns && bn.vulns.length ? ' &middot; vuln: <span style="color:#ffb000">' + esc(bn.vulns.join(', ')) + '</span>' : '') + '</div></div>';
    var actions;
    if (apLeft <= 0) {
      actions = '<p class="wg-hint" style="margin-top:8px;">No action points left this turn.</p>';
    } else if (!bn.alive) {
      actions = '<p class="wg-hint" style="margin-top:8px;color:#ff4d5e;">This node is already neutralized.</p>';
    } else if (isMine) {
      actions = '<div class="wg-method" style="margin-top:8px;">' +
        '<button class="wg-btn" data-order="harden" data-tid="' + esc(bn.id) + '">Harden<span class="vh">cut incoming hit chance</span></button>' +
        '<button class="wg-btn" data-order="repair" data-tid="' + esc(bn.id) + '">Repair<span class="vh">restore health</span></button></div>';
    } else {
      actions = '<div class="wg-method" style="margin-top:8px;">' + W.methodKeys().map(function (k) {
        var m = W.methods()[k];
        var vuln = (bn.vulns || []).indexOf(m.vuln) >= 0;
        return '<button class="wg-btn" data-order="strike" data-method="' + k + '" data-tid="' + esc(bn.id) + '">' +
          m.label + (vuln ? '<span class="vh">&#9650; vulnerable</span>' : '') + '</button>';
      }).join('') + '</div>';
    }
    var role = tempoRole(bn);
    var tnote = (!isMine && role && bn.alive)
      ? '<div class="wg-strat">&#9889; <b>' + role + ' node.</b> Neutralizing it cuts the enemy\'s action points next turn &mdash; decapitation, not just attrition.</div>'
      : (isMine && role && bn.alive)
        ? '<div class="wg-strat">&#9889; <b>' + role + ' node.</b> Holds up your tempo &mdash; keep it alive (Harden/Repair) to preserve your action points.</div>'
        : '';
    holder.innerHTML = head + tnote + actions;
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
    var dl = '<span style="color:#38bdf8">Blue +' + Math.round(rep.scoreDelta.blue) + '</span>' +
             ' &middot; <span style="color:#ff4d5e">Red +' + Math.round(rep.scoreDelta.red) + '</span>';
    return '<div class="wg-sec"><h4>Turn ' + rep.turn + ' resolution &mdash; ' + dl + '</h4><ul class="wg-log">' + (items || '<li>No effects.</li>') + '</ul></div>';
  }

  function aarSection(state) {
    var aar = state.aar;
    if (!aar) return '';
    var winner = aar.winner || 'none';
    var margin = aar.scoreMargin || 0;
    var winLabel = winner === 'blue' ? 'Blue' : (winner === 'red' ? 'Red' : 'No side');
    var blue = aar.sides.blue;
    var red = aar.sides.red;
    return '<div class="wg-sec">' +
      '<h4>After action summary</h4>' +
      '<div class="wg-aar-callout ' + winner + '"><b>' + esc(winLabel) + ' won by ' + Math.abs(Math.round(margin)) + ' points</b><br>' +
        esc(aar.reason) + ' after ' + aar.turns + ' resolved turns.</div>' +
      '<div class="wg-aar-grid" style="margin-top:8px;">' +
        aarMetric('Blue damage', blue.damage) +
        aarMetric('Red damage', red.damage) +
        aarMetric('Blue hit rate', pct(blue.hits, blue.strikes)) +
        aarMetric('Red hit rate', pct(red.hits, red.strikes)) +
        aarMetric('Blue kills', blue.kills + blue.cascades) +
        aarMetric('Red kills', red.kills + red.cascades) +
      '</div></div>' +
      aarScoreSection(aar) +
      aarMethodSection('Blue method effectiveness', blue) +
      aarMethodSection('Red method effectiveness', red) +
      aarTargetSection('Key targets damaged', aar.topDamaged, true) +
      aarTargetSection('High-value neutralized', aar.topNeutralized, false) +
      aarSourcesSection('Primary Blue firing sources', blue.topSources) +
      aarSourcesSection('Primary Red firing sources', red.topSources);
  }

  function aarMetric(label, value) {
    return '<div class="wg-aar-metric"><b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>';
  }

  function pct(n, d) {
    return d ? Math.round((n / d) * 100) + '%' : '0%';
  }

  function fmt(n) {
    return Math.round(Number(n || 0));
  }

  function aarScoreSection(aar) {
    if (!aar.scoreByTurn || !aar.scoreByTurn.length) return '';
    var maxScore = aar.scoreByTurn.reduce(function (m, r) { return Math.max(m, r.blueScore, r.redScore); }, 1);
    var rows = aar.scoreByTurn.map(function (r) {
      var bw = Math.max(2, Math.round((r.blueScore / maxScore) * 100));
      var rw = Math.max(2, Math.round((r.redScore / maxScore) * 100));
      return '<div class="wg-turn-row"><span>T' + r.turn + '</span><span class="wg-turn-bars">' +
        '<i class="blue" style="width:' + bw + '%"></i><i class="red" style="width:' + rw + '%"></i></span>' +
        '<span style="color:#eaf4ff">' + fmt(r.blueScore) + '-' + fmt(r.redScore) + '</span></div>';
    }).join('');
    return '<div class="wg-sec"><h4>Score progression</h4><div class="wg-turn-chart">' + rows + '</div></div>';
  }

  function aarMethodSection(title, sideStats) {
    var rows = W.methodKeys().map(function (k) {
      var m = sideStats.methods[k] || { attempts: 0, hits: 0, kills: 0, damage: 0 };
      if (!m.attempts && !m.damage && !m.kills) return '';
      return '<tr><td>' + esc(W.methods()[k].label) + '</td><td class="num">' + m.attempts + '</td><td class="num">' +
        pct(m.hits, m.attempts) + '</td><td class="num">' + m.kills + '</td><td class="num">' + fmt(m.damage) + '</td></tr>';
    }).join('');
    if (!rows) return '';
    return '<div class="wg-sec"><h4>' + esc(title) + '</h4><table class="wg-aar-table"><thead><tr>' +
      '<th>Method</th><th>Atk</th><th>Hit</th><th>K</th><th>Dmg</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function aarTargetSection(title, list, showDamage) {
    if (!list || !list.length) return '';
    var items = list.slice(0, 5).map(function (t) {
      var teamCol = t.team === 'blue' ? '#38bdf8' : '#ff4d5e';
      var detail = '<span class="wg-aar-pill" style="border-color:' + teamCol + '33;color:' + teamCol + '">' + String(t.team || '').toUpperCase() + '</span>';
      if (showDamage) detail += '<span class="wg-aar-pill">' + fmt(t.damage) + ' dmg</span>';
      if (t.cascaded) detail += '<span class="wg-aar-pill" style="color:#ffd43b">cascade</span>';
      if (t.killed) detail += '<span class="wg-aar-pill" style="color:#ff4d5e">neutralized</span>';
      return '<li><b>' + esc(t.name) + '</b><br>' + detail + '</li>';
    }).join('');
    return '<div class="wg-sec"><h4>' + esc(title) + '</h4><ul class="wg-aar-list">' + items + '</ul></div>';
  }

  function aarSourcesSection(title, list) {
    if (!list || !list.length) return '';
    var items = list.slice(0, 4).map(function (s) {
      return '<li><b>' + esc(s.name) + '</b><br><span class="wg-aar-pill">' + esc(s.subsystem || 'Unassigned') +
        '</span><span class="wg-aar-pill">' + s.strikes + ' strikes</span></li>';
    }).join('');
    return '<div class="wg-sec"><h4>' + esc(title) + '</h4><ul class="wg-aar-list">' + items + '</ul></div>';
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
    // Strike FX: cinematic edge-flash on HUD when turns resolve with hits/kills.
    try { playStrikeFX(report && report.events); } catch (e) {}
    // Cinematic: play the turn's strikes as animated tracer arcs on the map (if visible).
    try { if (window.MapModule && report && report.events) window.MapModule.playStrikes(report.events); } catch (e) {}
    // Cinematic: 3D strike beams (no-ops unless the 3D view is active).
    try { if (window.EngineModule && window.EngineModule.playStrikes && report && report.events) window.EngineModule.playStrikes(report.events); } catch (e) {}
    // FX bus: synthesized audio + DEFCON threat escalation + screen shake, synced to the 130ms volley.
    try {
      if (window.StrikeSimFX && report && report.events) {
        report.events
          .filter(function (e) { return e && (e.kind === 'hit' || e.kind === 'kill' || e.kind === 'cascade'); })
          .forEach(function (e, i) { setTimeout(function () { try { window.StrikeSimFX.onStrike(e.kind); } catch (x) {} }, i * 130); });
      }
    } catch (e) {}
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
