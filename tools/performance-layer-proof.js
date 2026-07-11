#!/usr/bin/env node
'use strict';

/*
 * performance-layer-proof.js — CO-006 contracts.
 *
 * The performance layer must stay presentation-only: gesture-gated audio, zero
 * network, zero engine reach, offline-complete fonts, reduced-motion dignity,
 * and the title screen as a front door TO the Operation Loop rather than a mode
 * beside it. Grows with each CO-006 phase.
 *
 * UNCLASSIFIED // NOTIONAL RESEARCH TOOL
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const audioSrc = read('audio.js');
const cinSrc = read('cinematics.js');
const directorSrc = read('director.js');
const shell = read('StrikeSim2040.html');

function fnBody(src, name, nextName) {
  const start = src.indexOf('function ' + name);
  const end = src.indexOf('function ' + nextName);
  assert.ok(start >= 0 && end > start, name + ' and ' + nextName + ' must both exist in order');
  return src.slice(start, end);
}

const passed = [];
const failures = [];
function check(name, fn) {
  try { fn(); passed.push(name); }
  catch (e) { failures.push({ name, message: e.message }); }
}

check('modules parse and carry the classification boundary', () => {
  assert.doesNotThrow(() => new vm.Script(audioSrc, { filename: 'audio.js' }));
  assert.doesNotThrow(() => new vm.Script(cinSrc, { filename: 'cinematics.js' }));
  assert.ok(/UNCLASSIFIED \/\/ NOTIONAL RESEARCH TOOL/.test(audioSrc), 'audio classification');
  assert.ok(/UNCLASSIFIED \/\/ NOTIONAL RESEARCH TOOL/.test(cinSrc), 'cinematics classification');
});

check('audio is gesture-gated: exactly one AudioContext creation, inside unlock()', () => {
  const creations = audioSrc.match(/new AC\(\)|new \(window\.AudioContext/g) || [];
  assert.strictEqual(creations.length, 1, 'one context creation site');
  const unlockBody = audioSrc.slice(audioSrc.indexOf('function unlock()'), audioSrc.indexOf('function unlocked()'));
  assert.ok(/new AC\(\)/.test(unlockBody), 'creation lives inside unlock()');
  assert.ok(!/unlock\(\)\s*;?\s*$/m.test(audioSrc.split('return Object.freeze')[1] || ''), 'module does not self-unlock');
  assert.ok(cinSrc.includes("wrap.addEventListener('click', enter)"), 'boot click is the unlock gesture');
});

check('four buses exist and preferences persist', () => {
  ['master', 'music', 'sfx', 'comms'].forEach(b => assert.ok(audioSrc.includes(b + ':'), 'bus ' + b));
  assert.ok(audioSrc.includes("'strikesim.co006.audio'"), 'prefs key');
  assert.ok(audioSrc.includes('localStorage.setItem(PREFS_KEY'), 'prefs saved');
});

check('presentation layer never reaches the engine or the match RNG', () => {
  ['GameModule._internal', 'makeRng', 'hashSeed', 'resolveTurn', 'planOrders'].forEach(sym => {
    assert.ok(!audioSrc.includes(sym), 'audio.js must not reference ' + sym);
    assert.ok(!cinSrc.includes(sym), 'cinematics.js must not reference ' + sym);
  });
});

check('zero network: no fetch/XHR/WebSocket/import in the performance layer', () => {
  ['fetch(', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'navigator.sendBeacon'].forEach(sym => {
    assert.ok(!audioSrc.includes(sym), 'audio.js must not use ' + sym);
    assert.ok(!cinSrc.includes(sym), 'cinematics.js must not use ' + sym);
  });
});

check('the title screen is a front door TO the loop, not a mode beside it', () => {
  assert.ok(cinSrc.includes("$('dir-launch')"), 'NEW OPERATION drives the Director launcher');
  assert.ok(cinSrc.includes('launch.click()'), 'it clicks the same button the command bar exposes');
  assert.ok(!cinSrc.includes('newMatch('), 'cinematics never starts matches itself');
});

check('boot is skippable and honest: real force counts, fast path, any-key skip', () => {
  assert.ok(cinSrc.includes("'strikesim.co006.boot'") || cinSrc.includes('BOOT_SEEN_KEY'), 'boot-seen flag');
  assert.ok(cinSrc.includes('strikesim:scenario-ready'), 'boot reads the real scenario-ready event');
  assert.ok(cinSrc.includes("window.addEventListener('keydown', enter)"), 'any key advances');
  assert.ok(cinSrc.includes('No saved operations on this console'), 'CONTINUE is honestly disabled until save/replay ships');
});

check('reduced motion gets a dignified path', () => {
  assert.ok(cinSrc.includes('prefers-reduced-motion'), 'CSS media block');
  assert.ok(cinSrc.includes('reduceMotion'), 'JS honors the preference (instant boot text)');
});

check('shell loads the layer after director and keeps the CO-006 tokens', () => {
  const dirIdx = shell.indexOf('director.js?');
  const audioIdx = shell.indexOf('audio.js?');
  const cinIdx = shell.indexOf('cinematics.js?');
  assert.ok(dirIdx > 0 && audioIdx > dirIdx && cinIdx > audioIdx, 'script order: director → audio → cinematics');
  ['--lbox-dur', '--lbox-ease', '--fx-scanline-opacity', '--stamp-dur'].forEach(tok =>
    assert.ok(shell.includes(tok), 'token ' + tok));
  assert.ok(shell.includes('classification-banner'), 'in-game classification banner retained');
});

check('offline-complete: all three display families are vendored, no font CDN', () => {
  const fontsCss = read('vendor/fonts.css');
  ['Orbitron', 'Share Tech Mono', 'Inter'].forEach(fam => assert.ok(fontsCss.includes("'" + fam + "'"), fam + ' vendored'));
  assert.ok(!shell.includes('fonts.googleapis.com'), 'shell has no font CDN link');
  assert.ok(!cinSrc.includes('googleapis'), 'cinematics has no font CDN link');
});

check('career panels read the CO-005 stores read-only', () => {
  assert.ok(cinSrc.includes("'strikesim.co005.v1.forecasts'"), 'forecast archive key mirrored');
  assert.ok(cinSrc.includes("'strikesim.co005.v1.operations'"), 'operations archive key mirrored');
  assert.ok(!/localStorage\.setItem\('strikesim\.co005/.test(cinSrc), 'cinematics never WRITES CO-005 stores');
});

// ═══════════════ Phase 2 contracts: BRIEF/COMMIT cinematics + the comms floor ═══════════════

check('P2: letterbox, stamp, and typewriter draw from the shell tokens', () => {
  assert.ok(cinSrc.includes('var(--lbox-dur'), 'letterbox duration token');
  assert.ok(cinSrc.includes('var(--lbox-ease'), 'letterbox easing token');
  assert.ok(cinSrc.includes('var(--stamp-dur'), 'stamp duration token');
  assert.ok(cinSrc.includes("'--type-tick-ms'"), 'typewriter cadence reads the shell custom prop');
});

check('P2: the Director is the sole author of comms traffic — cinematics stages, never invents', () => {
  // The cinematics module must not contain callsigns or resolution language of its own.
  ["'J2'", "'J3'", "'J35'", "'J5'", "'BDA'"].forEach(cs =>
    assert.ok(!cinSrc.includes(cs), 'cinematics must not hardcode callsign ' + cs));
  ['FORECAST COMPLETE', 'POSTERIOR', 'ORDERS COMMITTED · HASH', 'PLANNING WINDOW'].forEach(s =>
    assert.ok(!cinSrc.includes(s), 'cinematics must not author the line "' + s + '"'));
  // Director comms lines interpolate live engine state, not canned figures.
  assert.ok(directorSrc.includes("comms('J35', 'FORECAST COMPLETE — ' + forecast.K"), 'forecast line reads the real ensemble');
  assert.ok(!/comms\('[^']+',\s*'[^']*\d+%[^']*'\s*[,)]/.test(directorSrc), 'no literal percentages in comms lines — figures come from state');
});

check('P2: armed EXECUTE pulse appears only after the house reveal', () => {
  const blind = fnBody(directorSrc, 'renderBlindCommit', 'renderHybridCommit');
  const hybrid = fnBody(directorSrc, 'renderHybridCommit', 'openCommit');
  assert.ok(!blind.includes('cin-armed'), 'blind card must not pulse');
  assert.ok(hybrid.includes('cin-armed'), 'hybrid card arms after the forecast/house line renders');
  assert.ok(directorSrc.includes("sfxA('arm')"), 'the board audibly goes hot on the reveal');
});

check('P2: EXECUTE is the irreversible ceremony and WATCH goes quiet (the DEFCON move)', () => {
  const exec = fnBody(directorSrc, 'execute()', 'actualSummary');
  assert.ok(exec.includes("cine('executeCinematic')"), 'execute() runs the ceremony');
  const cinExec = cinSrc.slice(cinSrc.indexOf('function executeCinematic'));
  assert.ok(cinExec.includes('stopBed'), 'the bed stops at execution');
  assert.ok(cinExec.includes('commsVisible(false)'), 'the comms floor yields to the resolution feed');
  assert.ok(!/watch:\s*\{/.test(audioSrc), 'no WATCH bed exists — the war is quieter than the menu');
  assert.ok(!directorSrc.includes("startBed('watch')") && !cinSrc.includes("startBed('watch')"), 'nothing starts a watch bed');
});

check('P2: beds follow the loop registers (brief → plan → ceremony → silence)', () => {
  assert.ok(directorSrc.includes("cine('briefCinematic'"), 'brief entry is cinematic');
  assert.ok(directorSrc.includes("cine('planCinematic')"), 'plan entry sets its register');
  assert.ok(directorSrc.includes("cine('commitCinematic')"), 'commit enters the ceremony register');
  assert.ok(cinSrc.includes("a.startBed('brief')"), 'brief bed');
  assert.ok(cinSrc.includes("a.startBed('plan')"), 'plan bed');
});

check('P2: presentation bridges are guarded — the loop survives without the performance layer', () => {
  assert.ok(directorSrc.includes('window.CinematicsModule || null'), 'cinematics access is null-guarded');
  const commsDef = fnBody(directorSrc, 'comms(callsign', 'sfxA(');
  assert.ok(commsDef.includes('try {') && commsDef.includes('catch'), 'comms bridge is try/caught');
  assert.ok(directorSrc.includes('if (window.AudioFXModule)'), 'audio access is guarded');
});

check('P2: determinism intact — no Math.random anywhere in the Director', () => {
  assert.ok(!/Math\.random/.test(directorSrc), 'director.js must stay free of unseeded randomness');
});

check('P2: disclosed-prior bars animate the real posture with a reduced-motion fallback', () => {
  assert.ok(directorSrc.includes('dir-prior'), 'prior bars markup exists');
  assert.ok(directorSrc.includes("(posture[k[0]] || 0) * 100"), 'bar widths derive from the disclosed prior');
  assert.ok(directorSrc.includes('.dir-prior .fill{animation:none;width:var(--w'), 'reduced motion sets widths instantly');
});

check('P2: comms floor caps its backlog, types with ticks, and captions instantly under reduced motion', () => {
  assert.ok(cinSrc.includes('COMMS_MAX'), 'visible-line cap');
  assert.ok(cinSrc.includes('commsQ.splice'), 'backlog cap');
  const pump = cinSrc.slice(cinSrc.indexOf('function pumpComms'), cinSrc.indexOf('function commsVisible'));
  assert.ok(pump.includes('if (reduceMotion())') && pump.includes('tx.textContent = next.text'), 'reduced motion lands the caption instantly');
});

check('P2: typewriter restores real markup and stands down when a re-render replaces the DOM', () => {
  assert.ok(cinSrc.includes('node.isConnected'), 'typing aborts on disconnected nodes');
  assert.ok(cinSrc.includes('restoreHtml'), 'inline markup (bolded initiating event) is restored');
});

// ═══════════════ Phase 3 contracts: the WATCH war film + the AAR ceremony ═══════════════

const mapSrc = read('map.js');

check('P3: the war film opens at playback and the bars come down with the outcome', () => {
  const pw = fnBody(directorSrc, 'playWatch', 'showOutcome');
  assert.ok(pw.includes("cine('watchCinematic')"), 'playWatch opens the film');
  const so = fnBody(directorSrc, 'showOutcome', 'onFeedClick');
  assert.ok(so.includes("cine('watchDone')"), 'the outcome closes the letterbox — including via SHOW RESULT NOW');
  const cw = cinSrc.slice(cinSrc.indexOf('function watchCinematic'), cinSrc.indexOf('function watchDone'));
  assert.ok(!/startBed/.test(cw), 'WATCH starts no bed — silence is the score (the DEFCON move)');
});

check('P3: stingers are palette voices in the dark register, routed through the guarded bridge', () => {
  ['stingStrike', 'stingImpact', 'stingKill', 'stingCascade', 'tempoLoss'].forEach(v =>
    assert.ok(new RegExp(v + ':\\s*function').test(audioSrc), 'voice ' + v));
  ["sfxA('stingImpact'", "sfxA('stingKill')", "sfxA('stingCascade')", "sfxA('tempoLoss')"].forEach(c =>
    assert.ok(directorSrc.includes(c), 'director routes ' + c));
  assert.ok(!cinSrc.includes('stingKill'), 'cinematics never decides when a kill sounds — the Director does');
});

check('P3: camera cuts are disciplined — kills/cascades only, throttled, capped, deterministic clock', () => {
  const pw = fnBody(directorSrc, 'playWatch', 'showOutcome');
  assert.ok(pw.includes('CUT_SPACING_MS') && pw.includes('MAX_CUTS'), 'discipline constants exist');
  assert.ok(pw.includes("e.kind === 'kill' || e.kind === 'cascade'"), 'cuts ride kills and cascades only');
  assert.ok(pw.includes('i * step'), 'throttle runs on the deterministic pacing clock, not wall time');
  assert.ok(pw.includes('MapModule.flyToNode'), 'cuts use the map camera');
});

check('P3: flyToNode is a presentation camera — hidden-map no-op, reduced-motion no-op, no engine reach', () => {
  const start = mapSrc.indexOf('function flyToNode');
  assert.ok(start > 0, 'flyToNode exists');
  const body = mapSrc.slice(start, mapSrc.indexOf('function ', start + 20));
  assert.ok(body.includes('mapVisible()'), 'no-ops while the map pane is hidden');
  assert.ok(body.includes('prefers-reduced-motion'), 'reduced motion: no camera movement at all');
  ['GameModule', 'GM.', 'commitTurn', 'makeRng', 'hashSeed'].forEach(sym =>
    assert.ok(!body.includes(sym), 'flyToNode must not reference ' + sym));
  assert.ok(mapSrc.includes('flyToNode,'), 'exported to the render layer');
});

check('P3: kill confirmations ride the floor — Director-authored from resolved events, and sparse', () => {
  const pw = fnBody(directorSrc, 'playWatch', 'showOutcome');
  assert.ok(pw.includes("comms('BDA', (e.side === 'blue' ? 'KILL CONFIRMED — ' : 'FRIENDLY UNIT DOWN — ')"), 'the confirm line reads the resolved event');
  assert.ok(pw.includes('kills < 3'), 'confirms stay sparse — the feed remains the record');
  assert.ok(!cinSrc.includes('KILL CONFIRMED'), 'cinematics never authors BDA traffic');
});

check('P3: the tempo-loss motif fires only on a real drop against the previously shown tempo', () => {
  const so = fnBody(directorSrc, 'showOutcome', 'onFeedClick');
  assert.ok(so.includes("sfxA('tempoLoss')"), 'the motif is wired');
  assert.ok(so.includes('op.lastTempoShown != null && tempoNow < op.lastTempoShown'), 'a drop is measured, never invented');
  assert.ok(directorSrc.includes('op.lastTempoShown = null'), 'tracking resets with each operation');
});

check('P3: AAR is a ceremony — verdict stamps first, ledgers deal as cards, rank rides the header, serial seed', () => {
  const aar = fnBody(directorSrc, 'openAar', 'aarMarkdown');
  assert.ok(aar.includes("cine('aarCinematic'"), 'the ceremony runs');
  assert.ok(aar.includes("classList.add('cin-deal')") && aar.includes("'--deal-i'"), 'cards deal with a stagger');
  assert.ok(aar.includes('dir-rankchip') && aar.includes('analystRank'), 'the career rank rides the header');
  assert.ok(aar.includes('SERIAL') && aar.includes('dir-serial'), 'the seed reads like a serial plate');
  const ac = cinSrc.slice(cinSrc.indexOf('function aarCinematic'), cinSrc.indexOf('function exitCinematic'));
  assert.ok(ac.includes('letterbox(true)') && ac.includes('stamp('), 'the verdict stamps under letterbox');
  assert.ok(ac.includes('stopBed'), 'silence precedes the verdict');
  assert.ok(ac.includes('if (reduceMotion()) return'), 'reduced motion: cards land set, no ceremony');
});

check('P3: the deal is presentation-safe — reduced-motion override, honest rank source, clean class removal', () => {
  assert.ok(cinSrc.includes('#dir-wrap.cin-deal .dir-card{animation:none;opacity:1;transform:none;}'), 'reduced-motion CSS lands cards fully visible');
  assert.ok(directorSrc.includes("classList.remove('cin-deal')"), 'leaving AAR strips the deal class');
  const aar = fnBody(directorSrc, 'openAar', 'aarMarkdown');
  assert.ok(aar.includes('bootstrapBss') && aar.includes("'aar-rank-chip'"), 'the header rank uses the same evidence-gated band as the calibration card, seeded');
});

check('P3: exit letterboxes back to the title front door', () => {
  assert.ok(directorSrc.includes("cine('exitCinematic')"), 'EXIT TO CONSOLE runs the exit');
  const ex = cinSrc.slice(cinSrc.indexOf('function exitCinematic'));
  assert.ok(ex.includes('openConsole()'), 'the exit lands on the title screen');
  assert.ok(ex.includes('if (reduceMotion()) { openConsole(); return; }'), 'reduced motion goes straight home');
});

check('P3: frame budget holds — pacing floor, bounded per-tick work, FX teardown', () => {
  assert.ok(directorSrc.includes('Math.max(110,'), 'event pacing never dips below ~110ms per event (≈7 frames of headroom)');
  assert.ok(mapSrc.includes('function cleanup()'), 'strike FX layers and timers are torn down after each strike');
  assert.ok(directorSrc.includes('op.watchTimers.forEach(clearTimeout)'), 'skip/replan clears every scheduled camera cut and stinger');
  // Per event tick the render layer does O(1) work: one DOM insert, ≤1 flash, ≤1 cut,
  // ≤1 stinger, ≤1 comms line — no layout reads in the hot path.
  const pw = fnBody(directorSrc, 'playWatch', 'showOutcome');
  assert.ok(!/getBoundingClientRect|offsetWidth|offsetHeight/.test(pw), 'no forced layout reads inside the playback loop');
});

// ═══════════════ Phase 4 contracts: W6 settings, forced reduced motion, performance mode ═══════════════

check('P4: W6 settings persist as cosmetic state under their own key — never match state', () => {
  assert.ok(cinSrc.includes("'strikesim.co006.settings'"), 'settings key');
  ['reducedMotion', 'perfMode', 'callsign', 'bootFast'].forEach(k =>
    assert.ok(cinSrc.includes(k + ':'), 'setting field ' + k));
  assert.ok(cinSrc.includes('localStorage.setItem(SETTINGS_KEY'), 'settings saved');
  assert.ok(!/localStorage\.setItem\('strikesim\.co005/.test(cinSrc), 'still never writes CO-005 stores');
});

check('P4: effective reduced motion = system media query OR the operator toggle — one root class, every layer reads it', () => {
  assert.ok(cinSrc.includes('function reduceMotion()'), 'live helper replaces the load-time snapshot');
  assert.ok(cinSrc.includes('settings.reducedMotion || (mqRM && mqRM.matches)'), 'toggle can only ADD restraint — the media query always wins on its own');
  assert.ok(cinSrc.includes("classList.toggle('cin-rm'"), 'cinematics owns the root class');
  assert.ok(directorSrc.includes("classList.contains('cin-rm')"), 'Director honors the toggle');
  assert.ok(mapSrc.includes("classList.contains('cin-rm')"), 'map camera + strike FX honor the toggle');
  assert.ok(shell.includes('html.cin-rm *'), 'shell mirrors its global media-query rule for the class');
});

check('P4: forced reduced motion silences every CSS family the media query silences', () => {
  assert.ok(cinSrc.includes('html.cin-rm #cin-lbox .cin-lb{transition:none'), 'letterbox');
  assert.ok(cinSrc.includes('html.cin-rm #cin-stamp{animation:none'), 'stamp');
  assert.ok(cinSrc.includes('html.cin-rm #dir-wrap.cin-deal .dir-card{animation:none'), 'AAR deal');
  assert.ok(directorSrc.includes('html.cin-rm .dir-prior .fill{animation:none'), 'prior bars');
  assert.ok(directorSrc.includes('html.cin-rm .cin-armed{animation:none'), 'armed pulse');
  assert.ok(mapSrc.includes('html.cin-rm #map-radar-sweep{animation:none'), 'radar sweep');
  assert.ok(mapSrc.includes('html.cin-rm .wg-tracer-dot'), 'strike tracers');
  assert.ok(shell.includes('html.cin-rm #hud-ticker .ht-track{animation:none}'), 'HUD ticker');
});

check('P4: performance mode is one dial to zero — scanlines consumed then killed, glow tokens out, vignette out', () => {
  assert.ok(cinSrc.includes('var(--fx-scanline-opacity'), 'the W1 scanline dial is actually consumed by the console frame');
  assert.ok(cinSrc.includes("classList.toggle('cin-perf'"), 'cinematics owns the perf class');
  assert.ok(cinSrc.includes('html.cin-perf{--fx-scanline-opacity:0;--fx-grain-opacity:0;'), 'perf zeroes the FX dials');
  assert.ok(cinSrc.includes('--glow-cyan:none'), 'perf disables the glow tokens');
  assert.ok(cinSrc.includes('html.cin-perf *{text-shadow:none !important;}'), 'perf strips text-shadow glows');
  assert.ok(cinSrc.includes('html.cin-perf #fx-vignette{display:none'), 'perf drops the alert vignette');
});

check('P4: callsign is sanitized at the boundary and the Director reads it over the guarded bridge', () => {
  const san = cinSrc.slice(cinSrc.indexOf('function sanitizeCallsign'), cinSrc.indexOf('function readSettings'));
  assert.ok(san.includes('.toUpperCase()') && san.includes('[^A-Z0-9 \\-]') && san.includes('.slice(0, 14)'), 'uppercase, whitelist, length cap');
  assert.ok(cinSrc.includes('getCallsign: getCallsign'), 'exposed read-only to the render layer');
  const addr = directorSrc.slice(directorSrc.indexOf('function opAddr()'), directorSrc.indexOf('function pct('));
  assert.ok(addr.includes('cinApi()') && addr.includes('try {') && addr.includes('catch'), 'guarded bridge — loop survives without the performance layer');
  assert.ok(directorSrc.includes("opAddr() + 'OPERATION OPEN"), 'operation open addresses the operator');
  assert.ok(directorSrc.includes("opAddr() + 'PLANNING WINDOW OPEN"), 'planning window addresses the operator');
  assert.ok(!cinSrc.includes('opAddr'), 'cinematics still authors no comms traffic — addressing is the Director\'s');
});

check('P4: boot honors the operator — fast path requires the toggle, full POST when refused, reduced motion always instant', () => {
  assert.ok(cinSrc.includes('settings.bootFast && localStorage.getItem(BOOT_SEEN_KEY)'), 'fast path is seen-flag AND toggle');
  assert.ok(cinSrc.includes('if (fastPath || reduceMotion()) finishTyping()'), 'reduced motion renders the log at once regardless');
});

check('P4: settings apply live — root classes reapplied on change, media-query listener wired, AppShell mirrored', () => {
  assert.ok(cinSrc.includes('function applySettings()'), 'one apply point');
  assert.ok(cinSrc.includes("mqRM.addEventListener('change'"), 'media-query changes reapply');
  assert.ok(cinSrc.includes('AppShell.set({ reducedMotion: eff })'), 'shell ambient loops see the effective value');
  assert.ok(cinSrc.includes('saveSettings(); applySettings();'), 'toggles persist and apply in the same gesture');
});

check('P4: the settings panel is complete and honest — sliders, mute, motion, effects, boot, callsign', () => {
  ['cin-set-rm', 'cin-set-perf', 'cin-set-boot', 'cin-set-cs'].forEach(id =>
    assert.ok(cinSrc.includes("'" + id + "'"), 'control ' + id));
  assert.ok(!cinSrc.includes('arrive with CO-006 Phase 4'), 'the IOU copy is gone — the features shipped');
});

console.log('UNCLASSIFIED // NOTIONAL RESEARCH TOOL');
if (failures.length) {
  console.log('Performance-layer proof: IMPLEMENTATION MISMATCH (' + failures.length + '/' + (passed.length + failures.length) + ' checks failed)');
  failures.forEach(f => console.log('  FAIL  ' + f.name + '\n        ' + f.message));
  passed.forEach(p => console.log('  PASS  ' + p));
  process.exit(1);
}
console.log('Performance-layer proof: ALL CONTRACTS HOLD (' + passed.length + ' checks)');
passed.forEach(p => console.log('  PASS  ' + p));
