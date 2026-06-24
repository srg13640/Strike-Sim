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
