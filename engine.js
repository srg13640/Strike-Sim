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

  // --- Geo mode (globe backdrop + lat/lon layout) ---
  let earthMesh = null;                          // globe backdrop, lazily created
  const EARTH_RADIUS = 398;                      // slightly less than node radius for depth sorting
  // Optional real-Earth texture (equirectangular). If this file is bundled it upgrades
  // the procedural globe to a photo globe; if absent, the procedural globe is used and
  // NO request is made (a fetch-HEAD probe guards the load), so there's no 404.
  const EARTH_TEX_URL = 'assets/earth-blue-marble-2048.png';
  const EARTH_AUTO_ROTATE = 0.15;
  let earthLightingDone = false;

  function latLonToXYZ(lat, lon, radius) {
    if (radius === undefined) radius = 400;
    const phi = (90 - lat) * Math.PI / 180;
    const theta = (lon + 180) * Math.PI / 180;
    const x = -(radius * Math.sin(phi) * Math.cos(theta));
    const z =  radius * Math.sin(phi) * Math.sin(theta);
    const y =  radius * Math.cos(phi);
    return { x, y, z };
  }

  // Build a self-contained, clearly-visible globe — no external texture, so there is no
  // network request (and no 404), and it reads as a globe against the dark background:
  // a deep-blue lit sphere plus a cyan lat/lon graticule overlay.
  function ensureEarthSphere() {
    try {
      if (!graphInstance || !window.THREE) return;
      if (earthMesh) return;
      const group = new THREE.Group();
      group.name = 'EarthSphere';

      // Dark, semi-transparent body so the lat/lon-pinned nodes on its surface (and dimly
      // through it on the far side) stand out, while it still clearly reads as a globe.
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(EARTH_RADIUS, 48, 48),
        new THREE.MeshPhongMaterial({
          color: 0x09253b, emissive: 0x050f1a, shininess: 6,
          transparent: true, opacity: 0.62, depthWrite: true
        })
      );
      group.add(body);

      // Graticule: a slightly larger low-detail wireframe sphere reads as the lat/lon grid.
      const grid = new THREE.Mesh(
        new THREE.SphereGeometry(EARTH_RADIUS + 1.5, 24, 16),
        new THREE.MeshBasicMaterial({
          color: 0x3aa0d6, wireframe: true, transparent: true, opacity: 0.32
        })
      );
      group.add(grid);

      if (!earthLightingDone && scene) {
        const ambient = new THREE.AmbientLight(0x36597d, 0.55);
        const key = new THREE.DirectionalLight(0xe8f5ff, 0.8);
        const fill = new THREE.DirectionalLight(0x1e4d73, 0.45);
        key.position.set(1.35, 0.75, 1.15);
        fill.position.set(-1, -0.55, -1.05);
        scene.add(ambient);
        scene.add(key);
        scene.add(fill);
        earthLightingDone = true;
      }

      earthMesh = group;
      earthMesh.visible = false;
      const scene = graphInstance.scene && graphInstance.scene();
      if (scene) scene.add(earthMesh);

      // Upgrade to a real-Earth photo globe if assets/earth.jpg is bundled. Probe with a
      // fetch HEAD first so a missing file makes no request (no 404). When textured, the
      // globe becomes opaque (far-side nodes are correctly occluded by the planet) and the
      // graticule is hidden since the photo already shows coastlines.
      try {
        fetch(EARTH_TEX_URL, { method: 'HEAD', cache: 'force-cache' })
          .then(r => {
            if (!(r && r.ok) || !window.THREE) return;
            const tex = new THREE.TextureLoader().load(EARTH_TEX_URL);
            body.material = new THREE.MeshPhongMaterial({ map: tex, color: 0xffffff, emissive: 0x0a1622, shininess: 6 });
            body.material.needsUpdate = true;
            grid.visible = false;
          })
          .catch(() => {});
      } catch (e) { /* keep procedural globe */ }
    } catch (e) {
      addEvent({ type: 'View', text: 'Globe backdrop unavailable.' });
    }
  }

  function setGeoAutoRotate(enabled) {
    if (!graphInstance || !graphInstance.controls) return;
    const controls = graphInstance.controls();
    if (!controls || typeof controls.autoRotate === 'undefined') return;
    controls.autoRotate = !!enabled;
    if (enabled) {
      controls.autoRotateSpeed = EARTH_AUTO_ROTATE;
      if (typeof controls.update === 'function') controls.update();
    }
  }

  // Frame the camera for geo mode. Aims at the centroid of the placed nodes — i.e. the
  // active theater — and sits out above it, so the operator sees the populated region up
  // close (like looking down at Earth from orbit) instead of a tiny patch on a big empty
  // globe. Falls back to framing the whole globe if no nodes are pinned yet. Without this
  // the camera stays zoomed on the previous force-cluster and geo "looks like nothing".
  function frameGeo(ms) {
    if (ms === undefined) ms = 800;
    if (!graphInstance) return;
    const gd = graphInstance.graphData();
    const nodes = (gd && gd.nodes) || [];
    let cx = 0, cy = 0, cz = 0, k = 0;
    nodes.forEach(n => {
      // only nodes pinned on/near the globe surface (skip the y=-500 no-coord pool)
      if (n.fx != null && n.fy != null && n.fz != null && n.fy > -400) { cx += n.fx; cy += n.fy; cz += n.fz; k++; }
    });
    if (k === 0) {
      graphInstance.cameraPosition({ x: 0, y: EARTH_RADIUS * 0.55, z: EARTH_RADIUS * 3.1 }, { x: 0, y: 0, z: 0 }, ms);
      return;
    }
    cx /= k; cy /= k; cz /= k;
    const len = Math.hypot(cx, cy, cz) || 1;
    const dist = EARTH_RADIUS * 1.9;   // out along the theater direction, with context
    graphInstance.cameraPosition(
      { x: (cx / len) * dist, y: (cy / len) * dist, z: (cz / len) * dist },
      { x: cx, y: cy, z: cz },
      ms
    );
  }

  // Pin nodes onto the globe by lat/lon and switch off the force layout. Nodes with no
  // coordinates are pooled in a ring below the globe. Mutates the passed node objects.
  function applyGeoLayout(nodes) {
    if (!graphInstance) return;
    ensureEarthSphere();
    if (earthMesh) earthMesh.visible = true;
    (nodes || []).forEach(node => {
      if (node.lat != null && node.lon != null) {
        const pos = latLonToXYZ(node.lat, node.lon, 400 + (node.alt || 0));
        node.fx = pos.x; node.fy = pos.y; node.fz = pos.z;
        node.x  = pos.x; node.y  = pos.y; node.z  = pos.z;
      } else if (node.fx == null || node.fy == null || node.fz == null) {
        const angle = Math.random() * 2 * Math.PI;
        const r = 50 + Math.random() * 20;
        const px = r * Math.cos(angle);
        const pz = r * Math.sin(angle);
        node.fx = px; node.fy = -500; node.fz = pz;
        node.x  = px; node.y  = -500; node.z  = pz;
      }
    });
    graphInstance
      .d3Force('link', null)
      .d3Force('charge', null)
      .d3Force('center', null)
      .d3ReheatSimulation();
    setGeoAutoRotate(true);
    frameGeo();   // pull back so the globe + pinned nodes are actually visible
  }

  // Release the pinned positions, restore the default forces, and hide the globe.
  function clearGeoLayout(nodes) {
    if (!graphInstance) return;
    if (earthMesh) earthMesh.visible = false;
    (nodes || []).forEach(node => { delete node.fx; delete node.fy; delete node.fz; });
    graphInstance
      .d3Force('link', d3.forceLink().distance(60))
      .d3Force('charge', d3.forceManyBody().strength(-150))
      .d3Force('center', d3.forceCenter());
    setGeoAutoRotate(false);
    graphInstance.d3ReheatSimulation();
  }

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

  return { create, frameBlueToRed, frameGeo, getGraph, isInitialViewDone, applyGeoLayout, clearGeoLayout };
})();
