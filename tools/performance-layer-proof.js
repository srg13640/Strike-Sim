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
  assert.ok(pump.includes('if (reduceMotion)') && pump.includes('tx.textContent = next.text'), 'reduced motion lands the caption instantly');
});

check('P2: typewriter restores real markup and stands down when a re-render replaces the DOM', () => {
  assert.ok(cinSrc.includes('node.isConnected'), 'typing aborts on disconnected nodes');
  assert.ok(cinSrc.includes('restoreHtml'), 'inline markup (bolded initiating event) is restored');
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
