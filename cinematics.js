/*
 * cinematics.js — CO-006 W2: the Console Frame (boot → title front door).
 *
 * UNCLASSIFIED // NOTIONAL RESEARCH TOOL
 *
 * The fiction: you are an operator at JOC Console 04. This module owns the boot
 * ritual, the title screen, the operation archive and audio settings panels — the
 * chrome AROUND the Operation Loop. It is presentation only: it reads public state
 * (scenario-ready event, career localStorage stores) and drives the Director's own
 * launcher button. It never touches match state, engine internals, or seeded RNG;
 * cosmetic randomness uses Math.random() per CO-006 invariant 4. Zero network.
 *
 * The title screen is the front door TO the loop (CO-006 invariant 2): NEW
 * OPERATION clicks #dir-launch — the same button the command bar exposes.
 */
window.CinematicsModule = (function () {
  'use strict';

  var CLASSIFICATION = 'UNCLASSIFIED // NOTIONAL RESEARCH TOOL';
  var BOOT_SEEN_KEY = 'strikesim.co006.boot';
  var FORECAST_ARCHIVE_KEY = 'strikesim.co005.v1.forecasts';   // read-only mirror of director.js
  var OPS_ARCHIVE_KEY = 'strikesim.co005.v1.operations';       // read-only mirror of director.js
  var GHOST_WORLDS = 200;   // mirror of director.js GHOSTS (display copy only, like OBJ_LOSS_FRAC)

  var S = { screen: null, scenarioReady: false, forces: { blue: '—', red: '—' }, bootDone: false };
  var reduceMotion = false;
  try { reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function sfx() { return window.AudioFXModule || null; }
  function play(name, opts) { var a = sfx(); if (a) a.play(name, opts); }

  // ---------- CSS (injected, token-driven; shell :root supplies the palette) ----------
  function injectCss() {
    if ($('cin-css')) return;
    var st = document.createElement('style');
    st.id = 'cin-css';
    st.textContent = [
      '#cin-boot,#cin-title{position:fixed;inset:0;z-index:4000;background:var(--bg,#04080c);color:var(--muted,#8fa6bd);',
      '  font-family:var(--mono);display:flex;flex-direction:column;align-items:center;justify-content:center;transition:opacity .8s ease;}',
      '#cin-boot.gone,#cin-title.gone{opacity:0;pointer-events:none;}',
      '.cin-strap{position:absolute;left:0;right:0;text-align:center;font-size:10px;letter-spacing:.35em;text-transform:uppercase;',
      '  color:var(--muted,#8fa6bd);padding:4px 0;background:rgba(4,8,12,.6);}',
      '.cin-strap.top{top:0;border-bottom:1px solid rgba(143,166,189,.15);}',
      '.cin-strap.bot{bottom:0;border-top:1px solid rgba(143,166,189,.15);}',
      '#cin-bootlog{width:min(640px,86vw);font-size:12px;line-height:1.9;min-height:210px;}',
      '#cin-bootlog .ok{color:var(--success,#51cf66);} #cin-bootlog .warn{color:var(--amber,#ffb000);}',
      '#cin-bootprompt{margin-top:34px;font-family:var(--display);font-size:13px;letter-spacing:.4em;color:var(--amber,#ffb000);',
      '  opacity:0;text-transform:uppercase;animation:cinPulse 1.6s ease-in-out infinite;cursor:pointer;}',
      '#cin-bootprompt.show{opacity:1;}',
      '@keyframes cinPulse{0%,100%{opacity:.25}50%{opacity:1}}',
      '.cin-kicker{font-size:11px;letter-spacing:.55em;text-transform:uppercase;margin-bottom:18px;}',
      '.cin-wordmark{font-family:var(--display);font-weight:900;font-size:clamp(44px,7.5vw,104px);letter-spacing:.12em;',
      '  color:#eaf6ff;line-height:1;text-shadow:0 0 24px rgba(0,216,255,.45),.5px 0 0 rgba(255,77,94,.55),-.5px 0 0 rgba(0,216,255,.55);}',
      '.cin-wordmark .yr{color:var(--cyan,#00d8ff);}',
      '.cin-tagline{margin-top:14px;font-size:12px;letter-spacing:.3em;text-transform:uppercase;}',
      '#cin-menu{margin-top:6vh;display:flex;flex-direction:column;gap:6px;min-width:340px;}',
      '.cin-mitem{position:relative;padding:13px 22px;font-family:var(--display);font-weight:500;font-size:15px;letter-spacing:.28em;',
      '  color:var(--muted,#8fa6bd);text-transform:uppercase;cursor:pointer;text-align:center;border:1px solid transparent;',
      '  background:rgba(5,13,20,.35);transition:all .18s ease;}',
      '.cin-mitem:hover{color:#fff;border-color:rgba(255,176,0,.35);background:rgba(255,176,0,.06);',
      '  box-shadow:0 0 18px rgba(255,176,0,.12),inset 0 0 18px rgba(255,176,0,.05);}',
      '.cin-mitem:hover::before{content:"▸";position:absolute;left:14px;color:var(--amber,#ffb000);}',
      '.cin-mitem.dis{opacity:.35;cursor:default;}',
      '.cin-mitem.dis:hover{color:var(--muted,#8fa6bd);border-color:transparent;background:rgba(5,13,20,.35);box-shadow:none;}',
      '.cin-mitem.dis:hover::before{content:"";}',
      '.cin-msub{display:block;font-family:var(--mono);font-size:9px;letter-spacing:.25em;margin-top:4px;}',
      '#cin-buildtag{position:absolute;right:18px;bottom:26px;font-size:10px;letter-spacing:.2em;color:rgba(143,166,189,.6);text-align:right;line-height:1.8;}',
      '#cin-close{position:absolute;top:30px;right:22px;cursor:pointer;font-size:11px;letter-spacing:.2em;color:var(--muted,#8fa6bd);',
      '  border:1px solid rgba(143,166,189,.25);padding:6px 12px;background:rgba(4,8,12,.6);text-transform:uppercase;}',
      '#cin-close:hover{color:var(--amber,#ffb000);border-color:rgba(255,176,0,.35);}',
      '.cin-panel{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(2,4,7,.88);}',
      '.cin-panelbox{max-width:640px;width:min(640px,90vw);max-height:76vh;overflow:auto;padding:36px 44px;border:1px solid rgba(0,216,255,.38);background:rgba(5,13,20,.95);}',
      '.cin-panelbox h2{font-family:var(--display);font-size:17px;font-weight:700;letter-spacing:.3em;color:var(--cyan,#00d8ff);margin:0 0 16px;text-transform:uppercase;}',
      '.cin-panelbox p,.cin-panelbox li{font-size:12.5px;line-height:1.9;color:var(--muted,#8fa6bd);}',
      '.cin-panelbox .k{color:var(--amber,#ffb000);}',
      '.cin-row{display:flex;align-items:center;gap:12px;margin:10px 0;font-size:11px;letter-spacing:.18em;text-transform:uppercase;}',
      '.cin-row label{width:90px;color:var(--muted,#8fa6bd);}',
      '.cin-row input[type=range]{flex:1;accent-color:var(--amber,#ffb000);}',
      '.cin-back{margin-top:22px;display:inline-block;font-size:11px;letter-spacing:.3em;color:var(--amber,#ffb000);',
      '  border:1px solid rgba(255,176,0,.35);padding:10px 22px;cursor:pointer;text-transform:uppercase;}',
      '.cin-back:hover{background:rgba(255,176,0,.1);}',
      '.cin-stat{display:flex;justify-content:space-between;border-bottom:1px solid rgba(143,166,189,.12);padding:6px 2px;font-size:12px;}',
      '.cin-stat b{color:#d7e6f4;font-weight:400;}',
      '#cin-console-btn{background:linear-gradient(180deg,#123048,#0c2032);border:1px solid #2b6ea0;color:#bfe8ff;cursor:pointer;}',
      '#cin-console-btn:hover{border-color:var(--amber,#ffb000);color:#fff;}',
      // ── CO-006 Phase 2: letterbox, stamp, comms floor (shell tokens are the single dial) ──
      '#cin-lbox{position:fixed;inset:0;pointer-events:none;z-index:5200;}',
      '#cin-lbox .cin-lb{position:absolute;left:0;right:0;height:9vh;background:#000;transform:translateY(var(--d));',
      '  transition:transform var(--lbox-dur,1.1s) var(--lbox-ease,cubic-bezier(.77,0,.18,1));}',
      '#cin-lbox .cin-lb.top{top:0;--d:-101%;}',
      '#cin-lbox .cin-lb.bot{bottom:0;--d:101%;}',
      '#cin-lbox.on .cin-lb{transform:translateY(0);}',
      '#cin-stamp{position:fixed;left:50%;top:38%;transform:translate(-50%,-50%);z-index:5300;text-align:center;pointer-events:none;',
      '  font-family:var(--display);color:#eaf6ff;opacity:0;animation:cinStamp var(--stamp-dur,.38s) cubic-bezier(.2,1.6,.35,1) forwards;}',
      '#cin-stamp .cs-main{font-weight:900;font-size:clamp(30px,4.6vw,58px);letter-spacing:.18em;text-shadow:0 0 26px rgba(0,216,255,.5);}',
      '#cin-stamp .cs-sub{margin-top:8px;font-family:var(--mono);font-size:11px;letter-spacing:.5em;color:var(--amber,#ffb000);text-transform:uppercase;}',
      '#cin-stamp.gone{transition:opacity .4s ease;opacity:0 !important;}',
      '#cin-stamp.static{animation:none;opacity:1;transform:translate(-50%,-50%) scale(1);}',
      '@keyframes cinStamp{0%{opacity:0;transform:translate(-50%,-50%) scale(1.6);}60%{opacity:1;transform:translate(-50%,-50%) scale(.96);}100%{opacity:1;transform:translate(-50%,-50%) scale(1);}}',
      '#cin-comms{position:fixed;left:16px;bottom:14px;z-index:5150;width:min(430px,calc(100vw - 32px));pointer-events:none;',
      '  font-family:var(--mono);font-size:12px;line-height:1.5;color:#bfe0f2;display:flex;flex-direction:column;gap:3px;}',
      '#cin-comms.hidden{display:none;}',
      'body:not(.operation-active) #cin-comms{display:none;}',
      '.cc-line{background:rgba(4,10,16,.72);border-left:2px solid rgba(0,216,255,.4);padding:3px 9px;opacity:.94;}',
      '.cc-line .cc-cs{color:var(--cyan,#00d8ff);letter-spacing:.12em;}',
      '.cc-line.j2{border-left-color:rgba(255,176,0,.45);} .cc-line.j2 .cc-cs{color:var(--amber,#ffb000);}',
      '.cc-line.bda{border-left-color:rgba(81,207,102,.45);} .cc-line.bda .cc-cs{color:var(--success,#51cf66);}',
      '.cc-line.warn{border-left-color:rgba(255,59,59,.5);} .cc-line.warn .cc-cs{color:var(--alert,#ff3b3b);}',
      '.cin-typing::after{content:"▍";color:var(--amber,#ffb000);animation:cinPulse 1s ease-in-out infinite;}',
      '@media (max-width:760px){#cin-comms{display:none;}}',
      '@media (prefers-reduced-motion: reduce){',
      '  #cin-boot,#cin-title,.cin-mitem{transition:none !important;}',
      '  #cin-bootprompt{animation:none !important;opacity:1;}',
      '  #cin-lbox .cin-lb{transition:none !important;}',
      '  #cin-stamp{animation:none;opacity:1;}',
      '}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ---------- boot ----------
  function bootLines() {
    return [
      ['JOC CONSOLE 04 — POWER-ON SELF TEST', 'ok'],
      ['CRYPTO LOADED · KEYMAT CURRENT (NOTIONAL)', 'ok'],
      ['THEATER DATA LINK ......... ' + (S.scenarioReady ? 'SYNCED' : 'ACQUIRING'), S.scenarioReady ? 'ok' : 'warn'],
      ['FORCE NETWORKS: BLUE ' + S.forces.blue + ' NODES / RED ' + S.forces.red + ' NODES', 'ok'],
      ['DETERMINISTIC KERNEL ...... SEEDED', 'ok'],
      ['FORECAST ENSEMBLE ......... ' + GHOST_WORLDS + ' WORLDS READY', 'ok'],
      ['AUDIO SUBSYSTEM ........... AWAITING OPERATOR', 'warn']
    ];
  }

  function showBoot() {
    injectCss();
    var wrap = document.createElement('div');
    wrap.id = 'cin-boot';
    wrap.innerHTML =
      '<div class="cin-strap top">' + esc(CLASSIFICATION) + '</div>' +
      '<div id="cin-bootlog" aria-live="polite"></div>' +
      '<div id="cin-bootprompt">Click to initialize console</div>' +
      '<div class="cin-strap bot">Unclassified // Notional — no real-world operational data</div>';
    document.body.appendChild(wrap);
    S.screen = 'boot';

    var lines = bootLines(), idx = 0, done = false;
    function finishTyping() {
      if (done) return;
      done = true;
      var log = $('cin-bootlog');
      if (log) {
        log.innerHTML = '';
        bootLines().forEach(function (l) {
          var d = document.createElement('div');
          d.className = l[1]; d.textContent = '> ' + l[0];
          log.appendChild(d);
        });
      }
      var p = $('cin-bootprompt');
      if (p) p.classList.add('show');
    }
    function typeNext() {
      if (done) return;
      if (idx >= lines.length) { finishTyping(); return; }
      var l = lines[idx++];
      var d = document.createElement('div');
      d.className = l[1]; d.textContent = '> ' + l[0];
      var log = $('cin-bootlog');
      if (log) log.appendChild(d);
      setTimeout(typeNext, reduceMotion ? 0 : 240 + Math.random() * 260);
    }
    var fastPath = false;
    try { fastPath = localStorage.getItem(BOOT_SEEN_KEY) === 'seen'; } catch (e) {}
    if (fastPath || reduceMotion) finishTyping(); else setTimeout(typeNext, 400);

    function enter() {
      if (!done) { finishTyping(); return; }   // first press skips the typing
      var a = sfx();
      if (a) { a.unlock(); a.play('beep', { freq: 660, vol: 0.07, dur: 0.3 }); }
      try { localStorage.setItem(BOOT_SEEN_KEY, 'seen'); } catch (e) {}
      wrap.classList.add('gone');
      S.bootDone = true;
      window.removeEventListener('keydown', enter);
      setTimeout(function () { try { wrap.remove(); } catch (e) {} showTitle(); }, reduceMotion ? 0 : 700);
    }
    wrap.addEventListener('click', enter);
    window.addEventListener('keydown', enter);
  }

  // ---------- title ----------
  function showTitle() {
    injectCss();
    var existing = $('cin-title');
    if (existing) { existing.classList.remove('gone'); S.screen = 'title'; startTitleBed(); return; }
    var wrap = document.createElement('div');
    wrap.id = 'cin-title';
    wrap.innerHTML =
      '<div class="cin-strap top">' + esc(CLASSIFICATION) + '</div>' +
      '<div id="cin-close" title="Return to the analyst console">✕ Console</div>' +
      '<div class="cin-kicker">Joint Operations Center · Decision Wargame</div>' +
      '<div class="cin-wordmark">STRIKESIM <span class="yr">2040</span></div>' +
      '<div class="cin-tagline">You don\'t play the battle. You play the plan.</div>' +
      '<nav id="cin-menu">' +
      '<div class="cin-mitem" data-cin="new">New Operation</div>' +
      '<div class="cin-mitem dis" data-cin="continue">Continue Operation<span class="cin-msub">No saved operations on this console</span></div>' +
      '<div class="cin-mitem" data-cin="archive">Operation Archive</div>' +
      '<div class="cin-mitem" data-cin="settings">Settings</div>' +
      '</nav>' +
      '<div id="cin-buildtag">CO-006 CONSOLE FRAME · SEED VISIBLE IN-GAME<br>OFFLINE-COMPLETE · ZERO NETWORK</div>' +
      '<div class="cin-strap bot">Unclassified // Notional — no real-world operational data</div>';
    document.body.appendChild(wrap);
    S.screen = 'title';
    startTitleBed();

    wrap.addEventListener('mouseover', function (ev) {
      var mi = ev.target.closest('.cin-mitem');
      if (mi && !mi.classList.contains('dis')) play('tick', { vol: 0.04 });
    });
    wrap.addEventListener('click', function (ev) {
      if (ev.target.id === 'cin-close') { hideTitle(); return; }
      var mi = ev.target.closest('.cin-mitem');
      if (!mi || mi.classList.contains('dis')) return;
      var act = mi.getAttribute('data-cin');
      play('beep', { freq: 760, vol: 0.08, dur: 0.2 });
      if (act === 'new') {
        hideTitle();
        var launch = $('dir-launch');
        if (launch) launch.click();
        else if (typeof window.showToast === 'function') window.showToast('The Operation launcher is still loading — try again in a moment.', 'warn', 4000);
      } else if (act === 'archive') {
        showPanel(archivePanelHtml());
      } else if (act === 'settings') {
        showPanel(settingsPanelHtml());
        bindSettings();
      }
    });
  }
  function startTitleBed() { var a = sfx(); if (a && a.unlocked()) a.startBed('title'); }
  function hideTitle() {
    var t = $('cin-title');
    if (t) t.classList.add('gone');
    S.screen = null;
    var a = sfx(); if (a) a.stopBed(1.0);
  }
  function openConsole() { showTitle(); }

  // ---------- panels ----------
  function showPanel(innerHtml) {
    closePanel();
    var t = $('cin-title');
    if (!t) return;
    var p = document.createElement('div');
    p.className = 'cin-panel'; p.id = 'cin-panel';
    p.innerHTML = '<div class="cin-panelbox">' + innerHtml + '<br><span class="cin-back" id="cin-panel-back">Return</span></div>';
    t.appendChild(p);
    p.addEventListener('click', function (ev) {
      if (ev.target.id === 'cin-panel-back' || ev.target === p) { play('tick', { vol: 0.05 }); closePanel(); }
    });
  }
  function closePanel() { var p = $('cin-panel'); if (p) try { p.remove(); } catch (e) {} }

  function readJsonKey(key, fallback) {
    try {
      var parsed = JSON.parse(localStorage.getItem(key) || 'null');
      return parsed == null ? fallback : parsed;
    } catch (e) { return fallback; }
  }

  function archivePanelHtml() {
    var F = window.ForecastingModule;
    var entries = readJsonKey(FORECAST_ARCHIVE_KEY, []);
    var ops = readJsonKey(OPS_ARCHIVE_KEY, []);
    var html = '<h2>Operation Archive</h2>';
    if (!ops.length && !entries.length) {
      return html + '<p>No finished operations on this console yet. The archive is the <span class="k">perpetual beta</span> screen: every operation, seed, calibration record and Brier trend lands here — judgment is a skill this game measures over time, never off a single draw.</p>';
    }
    var scored = entries.filter(function (e) { return e && Number.isFinite(Number(e.playerBrier)) && Number.isFinite(Number(e.houseBrier)); });
    if (F && scored.length) {
      var skill = F.bootstrapBss(scored);
      var rank = F.analystRank(scored);
      html += '<div class="cin-stat"><span>RESOLVED CALLS</span><b>' + scored.length + '</b></div>' +
        '<div class="cin-stat"><span>BRIER SKILL vs HOUSE</span><b>' + (skill && skill.value != null ? (skill.value >= 0 ? '+' : '') + skill.value.toFixed(3) : '—') + '</b></div>' +
        '<div class="cin-stat"><span>ANALYST TRACK</span><b>' + esc(rank ? rank.label : '—') + '</b></div>';
    }
    if (ops.length) {
      html += '<p style="margin-top:14px;letter-spacing:.18em;text-transform:uppercase;font-size:10px">Recent operations</p>';
      ops.slice(-8).reverse().forEach(function (r) {
        html += '<div class="cin-stat"><span>' + esc(r.variantId === 'default' ? 'CROSS-STRAIT' : String(r.variantId || '').toUpperCase()) +
          ' · SEED ' + esc(String(r.seed || '—')) + '</span><b>' + esc(String(r.winner || '—').toUpperCase()) +
          (r.halted ? ' · HALT' : '') + ' · T' + esc(String(r.turns || '—')) + '</b></div>';
      });
    }
    return html;
  }

  function settingsPanelHtml() {
    var a = sfx();
    var p = a ? a.getPrefs() : { master: 0.55, music: 0.8, sfx: 0.9, comms: 0.85, muted: false };
    function row(bus, label) {
      return '<div class="cin-row"><label>' + label + '</label><input type="range" min="0" max="100" value="' + Math.round(p[bus] * 100) + '" data-bus="' + bus + '"></div>';
    }
    return '<h2>Settings</h2>' +
      row('master', 'Master') + row('music', 'Music') + row('sfx', 'SFX') + row('comms', 'Comms') +
      '<div class="cin-row"><label>Audio</label><span class="cin-back" id="cin-mute" style="margin-top:0">' + (p.muted ? 'Unmute' : 'Mute') + '</span></div>' +
      '<p>Reduced motion follows your system preference' + (reduceMotion ? ' (active now — transitions and typewriter effects are disabled)' : '') +
      '. Performance mode and operator callsign arrive with CO-006 Phase 4.</p>';
  }
  function bindSettings() {
    var panel = $('cin-panel');
    if (!panel) return;
    panel.addEventListener('input', function (ev) {
      var r = ev.target;
      if (r && r.getAttribute && r.getAttribute('data-bus')) {
        var a = sfx();
        if (a) { a.unlock(); a.setVolume(r.getAttribute('data-bus'), Number(r.value) / 100); a.play('tick', { vol: 0.04 }); }
      }
    });
    var mute = $('cin-mute');
    if (mute) mute.addEventListener('click', function () {
      var a = sfx();
      if (a) { a.unlock(); var m = a.toggleMute(); mute.textContent = m ? 'Unmute' : 'Mute'; }
    });
  }

  // ═══════════ CO-006 Phase 2: the cinematic grammar (letterbox · stamp · type · comms) ═══════════
  // Presentation only. Every function here renders strings and state HANDED TO IT by the
  // Director's render layer; this module never reads engine internals and never invents
  // an event. The Director is the sole author of comms traffic (credibility invariant W4).

  function typeTickMs() {
    var v = 12;
    try { v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--type-tick-ms')) || 12; } catch (e) {}
    return Math.max(4, v);
  }

  // ---------- letterbox (9vh bars, shell --lbox-* tokens) ----------
  function letterbox(on) {
    injectCss();
    var lb = $('cin-lbox');
    if (!lb) {
      lb = document.createElement('div');
      lb.id = 'cin-lbox';
      lb.setAttribute('aria-hidden', 'true');
      lb.innerHTML = '<div class="cin-lb top"></div><div class="cin-lb bot"></div>';
      document.body.appendChild(lb);
    }
    if (reduceMotion) { lb.classList.remove('on'); return; }   // dignified static path: no bars at all
    var want = !!on;
    requestAnimationFrame(function () { lb.classList.toggle('on', want); });
    play(want ? 'whooshIn' : 'whooshOut');
  }

  // ---------- operation stamp (scale 1.6→1.0 overshoot, --stamp-dur) ----------
  var stampTimer = null;
  function stamp(text, sub) {
    injectCss();
    var s = $('cin-stamp');
    if (s) { try { s.remove(); } catch (e) {} }
    s = document.createElement('div');
    s.id = 'cin-stamp';
    s.setAttribute('role', 'status');
    s.innerHTML = '<div class="cs-main">' + esc(text) + '</div>' + (sub ? '<div class="cs-sub">' + esc(sub) + '</div>' : '');
    if (reduceMotion) s.classList.add('static');
    document.body.appendChild(s);
    play('stamp');
    if (stampTimer) clearTimeout(stampTimer);
    stampTimer = setTimeout(function () {
      try { s.classList.add('gone'); } catch (e) {}
      setTimeout(function () { try { s.remove(); } catch (e) {} }, 450);
    }, reduceMotion ? 1100 : 1600);
  }

  // ---------- typewriter (2 chars/tick at --type-tick-ms, tick every 6th char) ----------
  function typeText(node, opts) {
    if (!node) return;
    var restoreHtml = node.innerHTML;
    var full = node.textContent || '';
    if (reduceMotion || full.length < 8) return;   // text is already set — the dignified path
    var i = 0, tick = typeTickMs(), quiet = !!(opts && opts.quiet);
    node.classList.add('cin-typing');
    node.textContent = '';
    (function step() {
      if (!node.isConnected) return;               // a re-render replaced the DOM — stand down
      i = Math.min(full.length, i + 2);
      node.textContent = full.slice(0, i);
      if (!quiet && i % 6 === 0) play('tick', { vol: 0.018 });
      if (i < full.length) setTimeout(step, tick);
      else {
        node.classList.remove('cin-typing');
        node.innerHTML = restoreHtml;              // restore inline markup (e.g. the bolded initiating event)
      }
    })();
  }

  // ---------- the comms floor (W4): typed, callsign-colored, caption-first ----------
  var COMMS_MAX = 6;
  var commsQ = [], commsBusy = false;
  function ensureCommsFloor() {
    injectCss();
    var f = $('cin-comms');
    if (!f) {
      f = document.createElement('div');
      f.id = 'cin-comms';
      f.setAttribute('role', 'log');
      f.setAttribute('aria-live', 'polite');
      f.setAttribute('aria-label', 'Watch floor comms');
      document.body.appendChild(f);
    }
    return f;
  }
  function comms(callsign, text, cls) {
    commsQ.push({ cs: String(callsign || 'JOC'), text: String(text || ''), cls: String(cls || '') });
    if (commsQ.length > 24) commsQ.splice(0, commsQ.length - 24);   // backlog cap — never a memory leak
    pumpComms();
  }
  function pumpComms() {
    if (commsBusy) return;
    var next = commsQ.shift();
    if (!next) return;
    commsBusy = true;
    var f = ensureCommsFloor();
    while (f.children.length >= COMMS_MAX) f.removeChild(f.firstChild);
    var line = document.createElement('div');
    line.className = 'cc-line' + (next.cls ? ' ' + next.cls : '');
    line.innerHTML = '<span class="cc-cs">' + esc(next.cs) + ':</span> <span class="cc-tx"></span>';
    f.appendChild(line);
    var tx = line.querySelector('.cc-tx');
    play('radio', { vol: 0.035 });
    if (reduceMotion) {
      tx.textContent = next.text;                  // captions land instantly — no typewriter
      commsBusy = false;
      setTimeout(pumpComms, 60);
      return;
    }
    var i = 0, txt = next.text, tick = typeTickMs();
    (function step() {
      if (!tx.isConnected) { commsBusy = false; pumpComms(); return; }
      i = Math.min(txt.length, i + 2);
      tx.textContent = txt.slice(0, i);
      if (i % 6 === 0) play('tick', { vol: 0.014 });
      if (i < txt.length) setTimeout(step, tick);
      else { commsBusy = false; setTimeout(pumpComms, 140); }
    })();
  }
  function commsVisible(v) { ensureCommsFloor().classList.toggle('hidden', !v); }

  // ---------- phase sequences (called by the Director's render layer, guarded) ----------
  function briefCinematic(opts) {
    var a = sfx();
    if (a) { a.unlock(); a.startBed('brief'); }
    commsVisible(true);
    if (reduceMotion) return;
    letterbox(true);
    stamp((opts && opts.title) || 'OPERATION BRIEF', 'operation brief · eyes only');
    setTimeout(function () { letterbox(false); }, 2300);
    setTimeout(function () {
      typeText(document.querySelector('#dir-wrap .dir-situation'));
    }, 600);
  }
  function planCinematic() {
    var a = sfx();
    if (a && a.unlocked()) a.startBed('plan');
    commsVisible(true);
  }
  function commitCinematic() {
    var a = sfx();
    if (a && a.unlocked()) a.startBed('brief');    // the ceremony register — same family, calmer filter
  }
  function executeCinematic() {
    var a = sfx();
    if (a) { a.stopBed(0.6); a.play('thump', { vol: 0.26 }); }   // war is quieter than the menu
    commsVisible(false);                            // WATCH: the resolution feed owns the corner
    if (reduceMotion) return;
    letterbox(true);
    stamp('ORDERS COMMITTED', 'red commits now · one world resolves');
    setTimeout(function () { letterbox(false); }, 2600);
  }

  // ---------- command-bar return button ----------
  function ensureConsoleButton() {
    if ($('cin-console-btn')) return;
    var launch = $('dir-launch');
    if (!launch || !launch.parentNode) { setTimeout(ensureConsoleButton, 400); return; }
    var b = document.createElement('button');
    b.id = 'cin-console-btn';
    b.title = 'Return to the console title screen';
    b.textContent = '⌂ CONSOLE';
    launch.parentNode.insertBefore(b, launch);
    b.addEventListener('click', function () { play('tick', { vol: 0.05 }); openConsole(); });
  }

  // ---------- wiring ----------
  window.addEventListener('strikesim:scenario-ready', function (ev) {
    S.scenarioReady = !!(ev && ev.detail && ev.detail.ready);
    try {
      var g = window.AppState && window.AppState.activeGraph ? window.AppState.activeGraph() : null;
      if (g && g.nodes) {
        S.forces.blue = g.nodes.filter(function (n) { return n.team === 'blue'; }).length;
        S.forces.red = g.nodes.filter(function (n) { return n.team === 'red'; }).length;
      }
    } catch (e) {}
    // Refresh the data-link line if the boot log is still on screen.
    var log = $('cin-bootlog');
    if (log && S.screen === 'boot') {
      var rows = log.querySelectorAll('div');
      if (rows[2]) { rows[2].textContent = '> THEATER DATA LINK ......... SYNCED'; rows[2].className = 'ok'; }
      if (rows[3]) rows[3].textContent = '> FORCE NETWORKS: BLUE ' + S.forces.blue + ' NODES / RED ' + S.forces.red + ' NODES';
    }
  });

  function boot() {
    injectCss();
    showBoot();
    ensureConsoleButton();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  return Object.freeze({
    CLASSIFICATION: CLASSIFICATION,
    openConsole: openConsole,
    hideTitle: hideTitle,
    // CO-006 Phase 2 grammar — consumed by the Director's render layer only
    letterbox: letterbox,
    stamp: stamp,
    typeText: typeText,
    comms: comms,
    commsVisible: commsVisible,
    briefCinematic: briefCinematic,
    planCinematic: planCinematic,
    commitCinematic: commitCinematic,
    executeCinematic: executeCinematic
  });
})();
