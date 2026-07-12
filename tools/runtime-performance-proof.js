#!/usr/bin/env node
'use strict';

/*
 * runtime-performance-proof.js
 *
 * Read-only static contract proof for the StrikeSim 3D renderer lifecycle. This
 * intentionally inspects the authored source rather than the minified vendor bundle:
 * the application must pause the vendor's perpetual animation loop when 3D is not
 * visible, cap high-DPI rendering, and keep ordinary links on the cheap line path.
 *
 * Run from anywhere:
 *
 *   node tools/runtime-performance-proof.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILES = {
  engine: path.join(ROOT, 'engine.js'),
  shell: path.join(ROOT, 'StrikeSim2040.html'),
  stage: path.join(ROOT, 'stage.js')
};

const source = Object.fromEntries(
  Object.entries(FILES).map(([key, file]) => [key, fs.readFileSync(file, 'utf8')])
);

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || '' });
}

function section(text, startToken, length = 1800) {
  const start = text.indexOf(startToken);
  return start < 0 ? '' : text.slice(start, start + length);
}

// Engine-owned lifecycle: the wrapper must expose one switch that drives both vendor
// methods. Requiring the explicit setRenderActive name keeps the shell/engine contract
// reviewable and prevents a loose mention in a comment from satisfying the proof.
const lifecycle = section(source.engine, 'function setRenderActive', 1400);
check(
  'Engine exposes setRenderActive(active)',
  lifecycle.length > 0 && /function\s+setRenderActive\s*\(\s*active\s*\)/.test(lifecycle)
);
check(
  'Inactive renderer calls pauseAnimation()',
  /\.pauseAnimation\s*\(/.test(lifecycle)
);
check(
  'Active renderer calls resumeAnimation()',
  /\.resumeAnimation\s*\(/.test(lifecycle)
);
const finalReturnAt = source.engine.lastIndexOf('return {');
const engineReturn = finalReturnAt < 0 ? '' : source.engine.slice(finalReturnAt, finalReturnAt + 900);
check(
  'Renderer lifecycle switch is exported',
  /\bsetRenderActive\b/.test(engineReturn)
);

// High-DPI contract. A named constant makes the cap independently auditable, and the
// setter check proves it is actually applied to the Three.js renderer.
const dprMatch = source.engine.match(/\bMAX_PIXEL_RATIO\s*=\s*([0-9]+(?:\.[0-9]+)?)/);
const dprCap = dprMatch ? Number(dprMatch[1]) : NaN;
check(
  'Pixel-ratio cap is declared at or below 1.25',
  Number.isFinite(dprCap) && dprCap > 0 && dprCap <= 1.25,
  Number.isFinite(dprCap) ? `MAX_PIXEL_RATIO=${dprCap}` : 'MAX_PIXEL_RATIO not found'
);
check(
  'Pixel-ratio cap is applied to the renderer',
  /\.setPixelRatio\s*\(\s*Math\.min\s*\([^)]*\bMAX_PIXEL_RATIO\b/.test(source.engine)
);

// The primary/default profile lives in engine.js. A low-power retry elsewhere must not
// accidentally make this pass while the normal path still requests MSAA.
const rendererDefaults = section(source.engine, 'const rendererConfig = opts.rendererConfig ||', 500);
check(
  'Default WebGL profile disables antialiasing',
  /\bantialias\s*:\s*false\b/.test(rendererDefaults)
);

// AppShell is the canonical owner of view + document visibility. The integration may
// live in the shell or StageModule, but it must subscribe to AppShell and compute active
// rendering as exactly: 3D view AND visible tab.
const orchestration = `${source.shell}\n${source.stage}`;
const subscriptions = [];
let cursor = 0;
while ((cursor = orchestration.indexOf('AppShell.subscribe', cursor)) !== -1) {
  subscriptions.push(orchestration.slice(cursor, cursor + 2200));
  cursor += 'AppShell.subscribe'.length;
}
const renderSubscription = subscriptions.find(block =>
  /setRenderActive\s*\(/.test(block) && /\.view/.test(block) && /\.hidden/.test(block)
) || '';
check(
  'AppShell subscription drives renderer lifecycle',
  renderSubscription.length > 0
);
check(
  'Only visible 3D state resumes rendering',
  /\.view\s*===?\s*['"]3d['"]\s*&&\s*!\s*[A-Za-z_$][\w$]*\.hidden/.test(renderSubscription),
  'Expected setRenderActive(state.view === "3d" && !state.hidden) semantics'
);

// In three-force-graph, a truthy linkWidth creates CylinderGeometry; zero/undefined uses
// BufferGeometry + THREE.Line. Inspect the app's linkWidth callback and require both the
// non-highlight branch and the no-highlight fallback to return zero.
const linkWidth = section(source.shell, '.linkWidth(', 850);
check(
  'Non-highlighted links use width 0 (THREE.Line path)',
  /return\s+[^?;\n]+\?[^:;\n]+:\s*0\s*;/.test(linkWidth) && /return\s+0\s*;/.test(linkWidth),
  'Expected highlighted ? positiveWidth : 0, followed by a return 0 fallback'
);
check(
  'Legacy width-1 cylinder fallback is absent',
  !/\?\s*2\.5\s*:\s*1\b/.test(linkWidth) && !/return\s+1\s*;/.test(linkWidth)
);

// Startup contract: the lightweight Map shell is playable without allocating WebGL or
// parsing the 3D vendor stack. Those dependencies may appear only inside the on-demand
// loader, never as parser-blocking script tags.
check(
  '3D dependencies have an on-demand loader',
  /function\s+loadGraph3DDependencies\s*\(/.test(source.shell) && /function\s+open3DOnDemand\s*\(/.test(source.shell)
);
check(
  'Three.js is absent from static startup scripts',
  !/<script\s+src=["']vendor\/three\.min\.js["']\s*>/i.test(source.shell)
);
check(
  'ForceGraph3D is absent from static startup scripts',
  !/<script\s+src=["']vendor\/3d-force-graph\.min\.js["']\s*>/i.test(source.shell)
);
const initSection = section(source.shell, 'async function init()', 1500);
check(
  'Default landing uses lightweight Map without a 3D retry prompt',
  /degradeToMap\s*\(\s*false\s*\)/.test(initSection)
);

const failures = results.filter(result => !result.pass);
console.log('StrikeSim runtime performance contract');
for (const result of results) {
  console.log(`${result.pass ? '  PASS' : '  FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
}

if (failures.length) {
  console.error(`\nRUNTIME PERFORMANCE PROOF FAILED (${failures.length}/${results.length} checks)`);
  process.exit(1);
}

console.log(`\nRUNTIME PERFORMANCE PROOF PASSED (${results.length}/${results.length} checks)`);
