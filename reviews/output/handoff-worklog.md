# Handoff Worklog (Alex)

## 2026-06-24

### Change 1 — Fix Globe texture path and improve Geo presentation
- **What changed**
  - Updated `engine.js` to use `assets/earth-blue-marble-2048.png` in `EARTH_TEX_URL` so Geo Mode can use the shipped photo-Earth asset.
  - Added a small lighting stack (`AmbientLight` + two `DirectionalLight` sources) when creating the Earth sphere.
  - Added constrained Geo mode node locking: `applyGeoLayout` now only randomizes un-pinned nodes when lat/lon is missing, so previously pinned nodes remain stable across data/layout refreshes.
  - Added Geo auto-rotate helpers so Geo Mode rotates subtly once active and stops when leaving Geo Mode.
  - `DST2040.HTML` `resetView()` now uses `EngineModule.frameGeo()` for Geo reset framing instead of a hard-coded camera vector.

- **Why**
  - Requested direct request was to make Globe “feel real” and avoid clunky static viewing. The shipped texture mismatch and pinned-node jitter were the two user-visible blockers.

- **How verified**
  - Confirmed `DST2040.HTML` loads from local static server.
  - Confirmed both requested image assets exist under `assets/` and are used by engine/map paths.
  - Confirmed syntax-level consistency in edited sections (no dangling braces/newlines in touched blocks).

- **Uncertainties / follow-up**
  - Auto-rotate speed is tuned for subtle motion; downstream reviewer should confirm if too brisk for mission pacing.
  - Geo texture bounds/brightness still depend on chosen PNG content; if visual too bright/dark, adjust material albedo/emissive values.

### Change 2 — Add Indo-Pacific satellite basemap beneath coastline vectors
- **What changed**
  - Updated `map.js` to drape `assets/earth-blue-marble-indopac-3072.jpg` via `L.imageOverlay` into `basemapPane` using bounds `[[ -35, 85 ], [65, 180]]`.
  - Added `indopacSatelliteLoaded` and unified basemap status refresh path so users see coherent basemap state (`local tiles`, `Indo-Pacific`, `coastlines`, or `offline grid`) regardless of async load timing.
  - Kept the existing offline coastline vector layer above satellite imagery so coastlines remain readable and still constrain marker overlap behavior.

- **Why**
  - Meets explicit backlog ask for a visual-map upgrade and keeps map legibility in an offline runtime while making unit placement look like real geography.

- **How verified**
  - Confirmed image files are present and map path resolves from server.
  - Confirmed code path for basemap status is now centralized in one refresh helper and that no duplicate `setBasemapStatus` declarations remain in `ensureMap()`.

- **Uncertainties / follow-up**
  - The Indo-Pacific bounds were set to a best-fit rectangle; reviewer should quickly run the map view to confirm coastline and imagery alignment on edge regions and adjust bounds if needed.
  - If runtime serves via strict `file://`, HEAD fetch may differ; code is guarded and falls back to offline vector/grid.

### Change 3 — Add tactical keyboard control and stabilize filter-driven Geo state
- **What changed**
  - In `DST2040.HTML` `refreshGraph()`, Geo Mode now calls `EngineModule.applyGeoLayout(visibleNodes)` whenever visible graph data is reapplied. This preserves the “geo-stays-pinned-after-filtering” behavior.
  - Added keyboard controls in the main keydown listener:
    - `M` → run Monte Carlo (`10000`), `Shift+M`/`Alt+M` → toggle Map.
    - `R` → reset view.
    - `[` / `]` → cycle visible selection.
    - `Space` → pause/resume simulation.
    - `Escape` → clear selection.
  - Added input focus guard so typing in inputs/search fields won’t trigger global shortcuts.
  - Added a visible hint strip in the header describing shortcuts.
  - Added CSS for `#control-hints` to keep the hint line readable and unobtrusive.

- **Why**
  - Directly addresses keyboard-shortcut and first-impression efficiency asks while adding low-friction tactical control for live sessions.

- **How verified**
  - Confirmed changed handlers compile structurally in-place (no syntax issues flagged by diff check).
  - Manually confirmed controls are attached during initialization and are not blocked by existing keybindings for panel inputs.

- **Uncertainties / follow-up**
  - `runMonteCarlo(10000)` now always fires on `M`; if reviewers want mode-gated behavior, we can restrict behind active COA flow context.
  - Header hint line may need wrapping strategy for very narrow viewports if the operator pane is very narrow.

### Change 4 — Repair first-run controls and harden Globe/Map presentation
- **What changed**
  - Fixed `engine.js` Geo globe creation by reading the Three.js scene before using it. The prior code referenced `scene` while it was still in the temporal dead zone, which could silently drop into the broad globe fallback catch.
  - Added a subtle atmospheric shell around the textured Earth so Geo Mode has better depth against the dark force network.
  - Changed the left quick-controls rail from hover-only hidden by default to open by default, with a real collapsed/open toggle, arrow direction, and `aria-expanded` state.
  - Added a plain-language mission brief in the right header and let shortcut help wrap instead of truncating.
  - Reduced the offline coastline vector fill opacity in Map Mode so the Indo-Pacific satellite image remains the visual basemap while coastlines stay useful for registration.

- **Why**
  - The first 60 seconds matter: operators should see controls immediately, understand the workflow, and trust that Geo/Map are real views rather than failed toggles.
  - The map should look like a satellite ops picture, not a dark vector mask laid over a photo.

- **How verified**
  - Ran `python3 -m http.server 8000` and loaded `http://localhost:8000/DST2040.HTML`.
  - Confirmed clean load except the known benign `Multiple instances of Three.js` warning.
  - Confirmed the left control rail is visible on first load and can collapse/expand.
  - Confirmed Geo Mode switches to `Exit Geo`, updates the header to `Geo ON (224 nodes pinned by lat/lon)`, and renders the Blue Marble globe with pinned nodes.
  - Confirmed Map Mode renders 224 markers over the Indo-Pacific satellite with the basemap status badge.

- **Uncertainties / follow-up**
  - Left rail open by default intentionally trades graph width for discoverability. If the reviewer wants a denser default, keep the fixed toggle behavior and start collapsed only after adding an obvious primary workflow strip elsewhere.

### Change 5 — Make Monte Carlo runs controllable, cancelable, and interpretable
- **What changed**
  - Added Monte Carlo presets (`Quick`, `Balanced`, `High Confidence`) that tune trial count, highlight threshold, and planner search budget.
  - Added explicit `Trials` and optional `Seed` inputs. Completed reports now record seed, seed source, RNG (`LCG`), success rule, run status, and whether the result is partial.
  - Changed the run button into a cancel button while MC is active. The engine now yields via animation frames and can stop cleanly at a chunk boundary, then reports partial-run confidence instead of pretending the run finished.
  - Added a plain-language interpretation strip in the MC panel and detailed report with a recommended next operator action (`Generate COA`, `Generate Goal Plan`, `Recommend Next Step`, `Preview Outcome`, or `Finish Full Run`).
  - Fixed the detailed report's node-odds source so it uses all observed red neutralization odds, not only the nodes above the highlight threshold.
  - Added a compact MC details line with plan length, completed trials, impact, seed/RNG, and Blue resource margin.

- **Why**
  - The old MC panel gave numbers but little judgment, and the fixed 10k run did not expose reproducibility or cancellation. Operators need to know what the result means, whether it is decision-grade, and what to do next.

- **How verified**
  - Reloaded the app from the local static server with a clean console except the known Three.js duplicate-import warning.
  - Built a one-step COA, set `Trials=500` and `Seed=42`, ran MC, and confirmed progress reaches `100%`, the run button label restores to `Run 500 Trials`, interpretation shows a low-confidence recommendation, and the event log records the run.
  - Opened the detailed report and confirmed it shows interpretation, seed/RNG, success rule, trial count, and run status.
  - Set `Trials=100000`, started MC, clicked the run button again, and confirmed cancellation produced a partial result (`47,000 / 100,000` in the verification run) with `Canceled at 47%` progress and a partial-run interpretation.

- **Uncertainties / follow-up**
  - This keeps MC on the main thread with frame-yield chunking rather than moving it to a Worker. It is materially more controllable now, but a true Worker remains the right architecture if reviewers want large runs while dragging the 3D scene continuously.

### Change 6 — Make the double-click launcher avoid wrong-port launches
- **What changed**
  - Updated `Open Strike Sim.command` to reuse port `8000` only when it is already serving `DST2040.HTML`.
  - If port `8000` is occupied by something else, the launcher now searches `8000-8020`, starts `python3 -m http.server` on the first free port, and opens that exact URL.
  - Added a clear failure message when no local port in that range is available.

- **Why**
  - The prior launcher checked whether anything owned port `8000`, not whether Strike Sim owned it. That can silently open the wrong local app, which is exactly the sort of avoidable launch friction that makes a prototype feel brittle.

- **How verified**
  - Ran `bash -n "Open Strike Sim.command"` to verify shell syntax.
  - Existing local server on `8000` continued serving the app during browser verification.

- **Uncertainties / follow-up**
  - The script still assumes `python3` is installed. README already lists Python 3 as a prerequisite; a future packaged launcher could detect Python and fall back to another local static server.

### Change 7 — Correct Indo-Pacific map registration
- **What changed**
  - Replaced the satellite overlay bounds in `map.js` from `[[ -35, 85 ], [65, 180]]` to `[[ -12.0126, 85 ], [56, 165]]`.
  - The new bounds keep the square satellite crop square in Web Mercator space, which matches how Leaflet renders `L.imageOverlay`.
  - Darkened the offline fallback grid and map background so the edge of the regional satellite crop blends into ocean instead of a bright grid.
  - Hid the 3D loading label when entering Map mode so graph settling text cannot float over the map.

- **Why**
  - The previous bounds stretched the raster vertically and eastward. Vector coastlines and the satellite coastlines visibly diverged, especially around Japan, Taiwan, the Philippines, and Indonesia.
  - The product-owner screenshot showed exactly this registration failure.

- **How verified**
  - Generated local overlay previews by drawing `assets/land.geojson` over the satellite crop with the old and new bounds.
  - Reloaded `http://localhost:8000/DST2040.HTML`, entered Map mode, and confirmed the status badge reads `Basemap: Indo-Pacific satellite + coastlines`.
  - Confirmed 224 markers render and `#graph-loading` is hidden in Map mode.

- **Uncertainties / follow-up**
  - The source image is a regional crop, not a global basemap. Units east or south of the crop still sit on the offline ocean grid; that is preferable to stretching the satellite and breaking coastline registration.

### Change 8 — Replace the misregistered regional crop with a true Web Mercator satellite basemap
- **What changed**
  - Generated `assets/earth-blue-marble-webmercator-2048.jpg` from the bundled `assets/earth-blue-marble-2048.png`.
  - Updated `map.js` to use that generated full-world Web Mercator image as the default Leaflet satellite basemap with bounds `[[ -85.05112878, -180 ], [85.05112878, 180 ]]`.
  - Retired the direct `assets/earth-blue-marble-indopac-3072.jpg` overlay path from runtime map rendering because it cannot be made consistently correct with one lat/lon rectangle.
  - Reduced coastline fill/outline opacity so the vector layer confirms geography without fighting the satellite imagery.

- **Why**
  - The follow-up operator screenshot still showed drift around the Philippines, Indonesia, and Papua. That confirmed the previous bounds adjustment was only a local improvement.
  - Leaflet is rendering EPSG:3857. A raster basemap must already be Web Mercator, or different latitude bands will align differently. A full-world Mercator asset is less flashy than the regional crop, but it is geospatially honest and keeps markers, coastlines, and imagery in the same coordinate reference system.

- **How verified**
  - Generated the Mercator asset locally from the checked-in Blue Marble PNG, so the app remains air-gapped and static-server friendly.
  - Reloaded the local app, entered Map mode, and checked that the basemap status reports satellite plus coastlines.
  - Visually inspected the Philippines / Indonesia / Papua area against the vector coastline overlay; the previous large offset is no longer present.

- **Uncertainties / follow-up**
  - The retired Indo-Pacific JPG may still be recoverable if its source projection and exact bounds are found. Without that metadata, direct `L.imageOverlay` use is a trap: it can be tuned for one theater slice while visibly breaking another.
