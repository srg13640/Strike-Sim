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
const shell = read('StrikeSim2040.html');

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

console.log('UNCLASSIFIED // NOTIONAL RESEARCH TOOL');
if (failures.length) {
  console.log('Performance-layer proof: IMPLEMENTATION MISMATCH (' + failures.length + '/' + (passed.length + failures.length) + ' checks failed)');
  failures.forEach(f => console.log('  FAIL  ' + f.name + '\n        ' + f.message));
  passed.forEach(p => console.log('  PASS  ' + p));
  process.exit(1);
}
console.log('Performance-layer proof: ALL CONTRACTS HOLD (' + passed.length + ' checks)');
passed.forEach(p => console.log('  PASS  ' + p));
