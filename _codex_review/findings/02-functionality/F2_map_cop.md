# F2 — Map/COP Functionality
- Dimension: Functionality
- Focus: Map/COP layers, offline fallback, rings, declutter, objective markers, and strike FX
- Files inspected: map.js; _stark/audits/00-MASTER-FIXLIST.md

## Summary
`map.js` has the right tactical-COP building blocks: Pacific-centered Leaflet setup, local/offline basemap concepts, MIL-style marker support, notional rings, objective markers, and animated strike effects. The current implementation still undermines offline-first behavior by booting into online tiles and only partially wiring fallback handling. Declutter, rings, links, and objective markers are not using a single display-coordinate model, so the COP can visually disagree with itself in dense areas. Strike effects are also discarded when the map is not visible, causing users to miss important resolution context.

## Strengths
- The map is explicitly Pacific-centered with antimeridian handling via `pacLon`, which is appropriate for an INDOPACOM-focused tool.
- The module separates panes for basemap, rings, radar, and FX, reducing many common Leaflet z-order problems.
- Marker declutter, notional engagement zones, objective icons, and a symbology legend show good intent toward a usable operational picture.
- Strike FX include cleanup and reduced-motion handling, which is a solid base for browser stability and accessibility.
- The prior master fix list already identifies map credibility as a top implementation priority, especially symbol correctness and marker pile-up (`_stark/audits/00-MASTER-FIXLIST.md:16`, `_stark/audits/00-MASTER-FIXLIST.md:19`).

## Findings
### F2-01 — Online basemaps are the startup default in an offline-first COP
- Severity: P1   Impact: 5   Effort: M
- Location: `map.js:175`, `map.js:179`, `map.js:194`, `map.js:195`, `map.js:204`
- Observation: The map constructs CARTO and Esri online tile layers, immediately adds the CARTO dark layer, sets `globalSatelliteLoaded = true`, and reports `Basemap: dark (online)` before proving any local or bundled imagery is available. In an air-gapped environment this still initiates outbound tile requests and can briefly or persistently tell the user the basemap is OK even though the offline-first path should be authoritative.
- Recommendation: Make bundled offline imagery or validated local tiles the startup default unless an explicit online mode is enabled. Only set loaded/status flags from actual tile or image load events, and keep online layers available as optional overlays rather than the default air-gap path.
- Tradeoffs/risks: Online maps are visually richer, but defaulting to them makes the offline behavior depend on failure timing instead of deterministic configuration.

### F2-02 — Satellite base layer has no offline fallback trigger
- Severity: P1   Impact: 4   Effort: S
- Location: `map.js:179`, `map.js:183`, `map.js:186`, `map.js:202`, `map.js:214`
- Observation: The fallback error counter is attached only to `darkLayer`, while the Satellite option is a layer group of `satImagery` and `satLabels`. If the user switches to Satellite while offline or blocked, the `baselayerchange` handler blindly reports the selected layer as OK, but tile failures from the satellite layers do not invoke `fallBackToOffline()`.
- Recommendation: Attach the same `tileerror` fallback handler to every online tile layer, including `satImagery` and `satLabels`, or place bundled offline imagery under every online base layer so a failed satellite selection never produces an empty COP.
- Tradeoffs/risks: A shared fallback can surprise users who intentionally selected Satellite, so the status badge should say that Satellite failed and the map is showing offline imagery.

### F2-03 — Declutter moves unit symbols without moving related COP geometry
- Severity: P1   Impact: 4   Effort: M
- Location: `map.js:347`, `map.js:361`, `map.js:384`, `map.js:555`, `map.js:640`, `map.js:614`
- Observation: Dense markers are displaced by a fixed lat/lon spiral, but engagement rings, selected-node links, and selection recentering still use raw node coordinates. That means a unit symbol can appear offset from its own ring center, selected-link endpoint, or map recenter target, which is especially misleading because the offsets can represent many kilometers at theater scale.
- Recommendation: Introduce a single display-coordinate lookup for each node and use it consistently for symbols, objective badges, selected-link endpoints, and optional visual leader lines. Alternatively, switch to cluster/spiderfy behavior where expanded positions are clearly temporary and connected back to true coordinates.
- Tradeoffs/risks: Consistent display coordinates improve readability, but popups and exports should still expose the true lat/lon so the tactical data is not corrupted.

### F2-04 — Objective markers ignore active visibility filters
- Severity: P2   Impact: 3   Effort: S
- Location: `map.js:447`, `map.js:449`, `map.js:477`, `map.js:489`
- Observation: The objective-marker comment says objectives are rendered only when currently visible, but `refreshObjectiveMarkers()` iterates over `graph().nodes` rather than `currentVisible().visibleNodes`. Objective stars can therefore remain on the map for units hidden by filters, and they are placed at raw coordinates instead of any decluttered display position.
- Recommendation: Build a visible-node ID set from `currentVisible().visibleNodes`, skip filtered-out objectives, and place objective badges using the same display coordinate as the unit marker. Refresh objective markers when game objective state changes, not only during marker refresh.
- Tradeoffs/risks: Hiding filtered objectives is consistent with layer filters, but consider a separate “always show key objectives” overlay if planners need that behavior explicitly.

### F2-05 — Strike FX are discarded when the map is not visible
- Severity: P1   Impact: 4   Effort: M
- Location: `map.js:1014`, `map.js:1016`, `map.js:1183`, `map.js:1185`
- Observation: `flashStrike()` returns immediately when the Leaflet map is hidden, and `playStrikes()` returns before even queuing events if `mapVisible()` is false. If a turn resolves while the user is in another view, the kinetic context is lost permanently instead of replaying when the user returns to the COP.
- Recommendation: Queue recent strike events when the map is hidden, then replay a condensed volley or show persistent impact indicators when map mode is activated. At minimum, log a visible “strikes occurred off-map” cue so users know why the COP changed.
- Tradeoffs/risks: Replaying every hidden event can be noisy after long simulations, so cap the queue and aggregate older impacts.

## Quick wins (top 3 high-impact/low-effort)
1. Add the existing `fallBackToOffline()` tile-error handler to `satImagery` and `satLabels` so every online basemap degrades safely.
2. Change `refreshObjectiveMarkers()` to use `currentVisible().visibleNodes` and skip filtered-out objectives.
3. Keep a small hidden-strike queue in `playStrikes()` and replay or summarize it on map activation.

## Open questions for the human review
- Should air-gapped deployments ever attempt public CARTO/Esri requests, or should online basemaps require an explicit operator toggle?
- Should declutter represent actual offset positions, or should it be a temporary spiderfy interaction with leader lines back to true locations?
- Are objective markers meant to obey normal filters, or should there be a separate always-on key-objective overlay?
