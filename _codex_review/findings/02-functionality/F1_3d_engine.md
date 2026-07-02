# F1 — 3D Engine Reliability
- Dimension: Functionality
- Focus: 3D engine reliability, WebGL context-loss recovery, geo mode, and 224-node performance
- Files inspected: engine.js, stage.js, _stark/audits/00-MASTER-FIXLIST.md

## Summary
The 3D stack has a solid reliability direction: conservative renderer settings, centralized resize handling, and explicit WebGL context-loss hooks are all present. The main remaining risks are lifecycle gaps after Retry-3D/rebuild, geo-mode mutations that replace ForceGraph defaults with hard-coded forces, and unbounded transient FX work during busy turns. Geo mode is visually ambitious but still needs stricter input validation and more offline-safe asset loading. At 224 nodes, the base graph should be workable, but strike animations need a concurrency budget so large turns do not overload the renderer.

## Strengths
- `engine.js` starts WebGL with compatibility-oriented renderer settings instead of forcing a high-performance adapter.
- `stage.js` centralizes renderer sizing, map invalidation, fullscreen changes, and ResizeObserver handling.
- `stage.js` correctly calls `preventDefault()` on `webglcontextlost`, which is required for browser restoration events.
- Geo mode includes explicit camera framing and a procedural globe fallback, so it is not entirely dependent on remote assets.
- 3D strike FX are best-effort guarded so visual failures should not crash the main game loop.

## Findings
### F1-01 — Context-loss recovery is not reattached after a 3D rebuild
- Severity: P1   Impact: 4   Effort: S
- Location: stage.js:24, stage.js:65, stage.js:81, engine.js:705
- Observation: `stage.js` tracks context-loss attachment with a single module-wide `webglAttached` boolean initialized at `stage.js:25`. `apply()` only calls `attachWebGL(inst)` when `inst && !webglAttached` at `stage.js:66`, while `attachWebGL()` sets the flag true for the current renderer canvas at `stage.js:85`. `EngineModule.dispose()` can tear down and recreate the graph at `engine.js:705`, but it does not reset StageModule's flag, so a new renderer canvas after Retry-3D can run without `webglcontextlost` / `webglcontextrestored` listeners.
- Recommendation: Track the attached canvas or graph instance instead of a bare boolean, and reattach whenever `inst.renderer().domElement` changes. Also expose a small `StageModule.resetWebGLAttachment()` or have `attachWebGL()` compare the current canvas and replace listeners idempotently.
- Tradeoffs/risks: Reattaching carelessly can duplicate toasts and handlers; store handler references or use a WeakSet/current-canvas guard.

### F1-02 — Leaving geo mode replaces ForceGraph's force setup with hard-coded defaults
- Severity: P1   Impact: 4   Effort: M
- Location: engine.js:311, engine.js:321
- Observation: `applyGeoLayout()` disables the `link`, `charge`, and `center` forces at `engine.js:311`-`engine.js:315`. `clearGeoLayout()` then creates new generic forces at `engine.js:325`-`engine.js:328` instead of restoring the previous ForceGraph3D-managed force objects and settings. That loses any internal link id accessor, layout tuning, or additional force configuration the graph had before geo mode, which can make post-geo 3D layout behave differently from initial 3D layout.
- Recommendation: Capture the existing `link`, `charge`, and `center` force objects before nulling them, then restore those exact objects on exit. If defaults are needed, initialize them once during engine creation with the same id accessor and parameters ForceGraph expects.
- Tradeoffs/risks: Restoring existing force objects preserves behavior but may also preserve warmed simulation state; explicitly reheat after restore as the current code already does.

### F1-03 — One malformed lat/lon can poison geo camera framing with NaN coordinates
- Severity: P1   Impact: 4   Effort: S
- Location: engine.js:136, engine.js:297, engine.js:270
- Observation: `applyGeoLayout()` treats any non-null `node.lat` and `node.lon` as valid at `engine.js:297`-`engine.js:301`. `latLonToXYZ()` then performs arithmetic directly on those values at `engine.js:136`-`engine.js:143`, so an imported string like `"unknown"`, `NaN`, or an out-of-range coordinate can assign `NaN` to `node.fx/fy/fz`. `frameGeo()` averages all pinned coordinates and passes the result to `cameraPosition()` at `engine.js:270`-`engine.js:288`, so a single bad coordinate can move the camera to an invalid position and make geo mode appear blank or broken.
- Recommendation: Normalize coordinates with `Number()`, require `Number.isFinite(lat/lon)`, clamp or reject ranges outside `[-90, 90]` and `[-180, 180]`, and send invalid records to the no-coordinate pool. Consider logging one summarized warning per geo activation rather than one event per bad node.
- Tradeoffs/risks: Clamping hides bad source data; rejecting to the no-coordinate pool is safer for reviewability.

### F1-04 — 3D strike FX have no concurrency budget for large turns
- Severity: P1   Impact: 4   Effort: M
- Location: engine.js:545, engine.js:575, engine.js:606, engine.js:682
- Observation: `playStrikes()` filters all hit/kill/cascade events and schedules every shot with `setTimeout()` at `engine.js:682`-`engine.js:696`. Each shot can allocate a beam, projectile, ring, core, multiple geometries/materials, at least two animation loops, and safety timers at `engine.js:545`-`engine.js:598` and `engine.js:606`-`engine.js:666`. On a dense 224-node turn, that can create hundreds of transient WebGL objects and RAF callbacks even if the operator switches away after the initial `engineVisible()` check.
- Recommendation: Add an FX queue with a maximum number of active shots, coalesce low-priority hits, and drive all active projectiles/flashes from one shared RAF loop. Recheck visibility at fire time and cancel outstanding FX on view switch, context loss, or `EngineModule.dispose()`.
- Tradeoffs/risks: Capping FX reduces spectacle on very busy turns, but preserving frame rate and interaction matters more for C2 use.

### F1-05 — Globe texture loading uses an offline-fragile HEAD probe before loading the bundled asset
- Severity: P2   Impact: 3   Effort: S
- Location: engine.js:213, engine.js:218, engine.js:221
- Observation: The geo globe first probes `assets/earth-blue-marble-2048.png` with `fetch(..., { method: 'HEAD' })` at `engine.js:218`, then loads the same URL through `THREE.TextureLoader().load()` at `engine.js:221`. In offline/file-based deployments or simple static servers, `HEAD` can be unsupported or blocked even when the image itself is usable, causing the app to silently skip the better globe texture. It also doubles the asset access path for a first-class offline feature.
- Recommendation: Remove the HEAD preflight and call `TextureLoader.load(url, onLoad, undefined, onError)` directly, keeping the procedural globe as the on-error fallback. If avoiding 404 noise is important, use a local asset manifest or build-time presence convention rather than a runtime HEAD request.
- Tradeoffs/risks: Direct loading may show a missing-image request in dev tools when the optional texture is absent; that is preferable to disabling a valid bundled texture in offline environments.

## Quick wins (top 3 high-impact/low-effort)
1. Replace `webglAttached` with current-canvas tracking so Retry-3D canvases always get context-loss listeners.
2. Validate and range-check `lat` / `lon` before assigning `fx/fy/fz` in geo mode.
3. Replace the globe HEAD probe with direct `TextureLoader.load()` plus an error fallback.

## Open questions for the human review
- Does the Retry-3D path call any StageModule hook after `EngineModule.dispose()` and recreation, or is resize/context attachment only incidental?
- Should geo mode preserve exact pre-geo force objects, or is a known canonical post-geo force profile desired?
- What is the expected upper bound for strike events in a single 224-node turn, and should cosmetic FX be sampled when that bound is exceeded?
