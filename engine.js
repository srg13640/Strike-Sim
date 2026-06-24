/*
 * engine.js — core 3D rendering engine for the MDSC 3D Network Visualizer.
 *
 * Third modularization step (after state.js + map.js). Owns the ForceGraph3D /
 * Three.js instance *lifecycle*: construction, the one-time Blue-perspective opening
 * shot, and the first-settle guard. The instance itself is published as the shared
 * handle window.graphInstance, because it is the rendering surface that orchestration
 * code (refreshGraph, applyHighlight, selectNode, resetView, geo mode) legitimately
 * drives. Centralizing the *lifecycle* here — rather than forcing ~30 call sites
 * through an accessor — keeps the extraction low-risk while still encapsulating setup.
 *
 * Dependency injection (no build step, plain global script): create() takes the
 * scene callbacks (node color/label, click handlers) and an onFirstSettle hook so the
 * view-mode decision (geo/map/table vs. Blue-perspective) stays in the main script.
 * Shared helpers it relies on (resolveCssVar, colorFromTeam, selectNode) are global.
 */
window.EngineModule = (function () {
  'use strict';

  let graphInstance = null;
  // Guards the one-time Blue-perspective opening shot: set true after the first engine
  // settle that actually has nodes, so later data changes never re-frame the camera.
  let initialViewDone = false;

  // Publish the shared handle up front (null until create() runs). This MUST exist
  // before the main script executes: orchestration code reads bare `graphInstance`,
  // which resolves to this window property, and under "use strict" reading an entirely
  // undefined identifier throws — so initUI()/refreshGraph() running before create()
  // would otherwise ReferenceError.
  if (!('graphInstance' in window)) window.graphInstance = null;

  /**
   * Build the ForceGraph3D instance in the given container. Throws if WebGL context
   * creation fails (the caller handles the Map/Table fallback). Publishes the instance
   * as window.graphInstance and returns it.
   *
   * opts:
   *   nodeLabel(n) / nodeColor(n)  — render callbacks
   *   onNodeClick(n) / onBackgroundClick()
   *   onFirstSettle()              — called exactly once, on the first settle with nodes
   */
  function create(containerId, opts) {
    opts = opts || {};
    graphInstance = ForceGraph3D()(document.getElementById(containerId))
      .graphData({ nodes: [], links: [] }) // Start empty
      .nodeLabel(opts.nodeLabel || (n => `${n.name} (${n.id})`))
      .nodeColor(opts.nodeColor || (n => n.color || '#ffffff'))
      .onNodeClick(opts.onNodeClick || (() => {}))
      .onBackgroundClick(opts.onBackgroundClick || (() => {}))
      .onEngineStop(() => {
        const loader = document.getElementById('graph-loading');
        if (loader) loader.style.display = 'none';
        // Fire the opening-shot hook exactly once, on the first settle that has nodes.
        // The graph is created empty, so that first (empty) settle is skipped. After
        // this, strikes/imports/filters reheat the engine but never move the camera.
        const gd = graphInstance.graphData();
        const hasNodes = gd && gd.nodes && gd.nodes.length > 0;
        if (!initialViewDone && hasNodes) {
          initialViewDone = true;
          if (typeof opts.onFirstSettle === 'function') opts.onFirstSettle();
        }
      });
    window.graphInstance = graphInstance; // shared handle for orchestration code
    return graphInstance;
  }

  /**
   * Initial-load camera framing: place the camera on the Blue side looking toward Red,
   * sized so the whole battlespace fits. Fired once on first data load. Not used for
   * manual "Reset View" (that stays a neutral fit) nor for subsequent data changes
   * (the operator owns the camera then).
   */
  function frameBlueToRed(ms) {
    if (ms === undefined) ms = 1200;
    if (!graphInstance) return;
    const gd = graphInstance.graphData();
    const nodes = (gd && gd.nodes) || [];
    if (!nodes.length) return;

    const centroid = (arr) => {
      let x = 0, y = 0, z = 0;
      for (const n of arr) { x += n.x || 0; y += n.y || 0; z += n.z || 0; }
      const k = arr.length || 1;
      return { x: x / k, y: y / k, z: z / k };
    };

    const blue = nodes.filter(n => n.team === 'blue');
    const red  = nodes.filter(n => n.team === 'red');
    const all  = centroid(nodes);
    const B = blue.length ? centroid(blue) : all;
    const R = red.length  ? centroid(red)  : all;

    // Fit radius around the overall centroid. Use the 90th-percentile distance, not
    // the absolute max, so a few far-flung outlier nodes don't inflate the frame and
    // shrink the main battlespace. The bulk of the network fills the view; the rare
    // straggler may sit near an edge, which is acceptable.
    const dists = nodes
      .map(n => Math.hypot((n.x || 0) - all.x, (n.y || 0) - all.y, (n.z || 0) - all.z))
      .sort((a, b) => a - b);
    const pct = dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.9))] || 0;
    const radius = Math.max(pct, 60);

    // Look direction = from Blue toward Red. Fall back to +Z if the two centroids
    // coincide (e.g. a single-team scenario) so the camera never lands on the target.
    let dx = R.x - B.x, dy = R.y - B.y, dz = R.z - B.z;
    let len = Math.hypot(dx, dy, dz);
    if (len < 1e-3) { dx = 0; dy = 0; dz = 1; len = 1; }
    dx /= len; dy /= len; dz /= len;

    // Camera sits behind Blue (opposite the look direction), slightly elevated, far
    // enough that all nodes fit a ~75° vertical FOV with padding.
    const dist = radius * 2.0;
    const camPos = {
      x: all.x - dx * dist,
      y: all.y - dy * dist + radius * 0.4,
      z: all.z - dz * dist
    };
    graphInstance.cameraPosition(camPos, all, ms);
  }

  function getGraph() { return graphInstance; }
  function isInitialViewDone() { return initialViewDone; }

  return { create, frameBlueToRed, getGraph, isInitialViewDone };
})();
