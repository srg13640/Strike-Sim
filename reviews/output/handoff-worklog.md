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

### Change 9 — Promote the Geo globe from "lit sphere" to a command-center orbital view
- **What changed (all in `engine.js`, Geo mode only — 3D network and Map untouched)**
  - Added a procedural **starfield**: ~1400 deterministically-seeded `THREE.Points` on a far shell inside the `EarthSphere` group, so it shows only in Geo mode and never hits the network. Stars use `sizeAttenuation:false` (fixed screen-space size) — attenuated points at that radius collapse to sub-pixel and disappear.
  - Replaced the flat translucent atmosphere shell with a real **Fresnel rim-glow `ShaderMaterial`** on the back faces of a slightly larger sphere (additive, depth-write off). The limb now picks up the soft blue halo that real orbital imagery has. Falls back to the old additive `MeshBasicMaterial` if shader compilation ever fails (guarded for cross-instance THREE edge cases).
  - Upgraded the **lighting stack**: lower ambient + brighter near-white key gives the planet a genuine terminator and self-shadowed limb (depth); a cool fill + faint blue rim keep the night side legible so pinned nodes there are never lost in black.
  - Upgraded the **textured Earth material**: max **anisotropy** (crisp coastlines at grazing angles), a tight dim **specular** highlight so oceans read as wet under the key light, and balanced emissive so land/sea stay rich without washing out.
  - Pulled the default Geo framing back from `EARTH_RADIUS * 1.9` to `* 2.5` so the curvature and the glowing atmosphere are actually in frame on entry, while the West Pacific theater still fills the view. (Previously the camera sat so close the limb/atmosphere were always off-screen.)

- **Why**
  - This was the brief's #1 immediate target: make the globe "feel like a high-end command center." The texture was already wired, but the presentation was a lit ball in a black box. Atmosphere + stars + orbital framing + specular oceans are what sell "view from orbit."

- **How verified**
  - Ran the local static server, entered Geo mode, and confirmed via scene traversal that `StarField` and a `ShaderMaterial` `Atmosphere` are present and the globe is visible.
  - Screenshotted the default Geo entry: full Earth curvature, blue atmospheric limb, theater filling the frame, nodes pinned with link lines, faint stars around the limb.
  - Console clean except the pre-existing benign "Multiple instances of Three.js" warning — no shader-compile errors.
  - Regression check: exited Geo (globe hidden), entered Map (224 markers + 2048px satellite render), returned to 3D (224 nodes). No cross-view breakage.

- **Uncertainties / follow-up**
  - All new globe objects are created with `window.THREE` (three.min.js r128) and added to 3d-force-graph's bundled-THREE scene. This cross-instance pattern already worked for the existing globe; the Fresnel `ShaderMaterial` and `Points` extend it and rendered correctly, but it remains the one place to look first if a future THREE bump changes behavior.
  - Stars are intentionally subtle (ops tool, not a planetarium). If a reviewer wants them more prominent, raise `PointsMaterial.size` or the bright-star ratio in `makeStarField()`.
  - Note on testing this locally: `python3 -m http.server` sends no `Cache-Control`, so browsers heuristically cache `engine.js` after an edit. A plain reload can run stale JS — hard-reload or append a `?cb=` query to force fresh module fetch when verifying.

### Change 10 — Fix "Reset View" framing the 3D network as a tiny stranded blob
- **What changed**
  - `resetView()` in `DST2040.HTML` now reuses `EngineModule.frameBlueToRed(700)` for the 3D branch instead of `graphInstance.zoomToFit(400)`.

- **Why**
  - The `#graph` canvas spans the full window, but the left and right operator panels opaquely cover roughly half of it. `zoomToFit` frames the network to the *full* canvas, so after a reset the whole network sat behind the panels and only a small cluster showed in the visible middle strip (camera standoff ~2056 units). The Blue-perspective opening shot already stands off at a fixed multiple of an outlier-robust (90th-percentile) radius, which fills the visible gap. Reusing it makes Reset View a recognizable "home" and also fixes the worse variant of this where resetting right after exiting Geo mode (nodes still spread across the globe) shrank the network to a speck.

- **How verified**
  - Fresh load, dragged the camera far out to z=6000, clicked Reset View: camera returned to ~1233 units with the network filling the visible middle strip (screenshot), versus the prior ~2056-unit blob.
  - Confirmed Geo reset (`frameGeo`) and Map reset (`fitMapToMarkers`) branches are unchanged.

- **Uncertainties / follow-up**
  - This intentionally overrides the previous "reset = neutral fit" choice; the neutral fit was visibly broken given the panel coverage. If a reviewer wants a non-angled overhead reset, the right fix is a dedicated panel-aware fit helper (offset the fit center for the covered canvas width), not a bare `zoomToFit`.

### Change 11 — New `game.js`: a turn-based War Game engine (Phase 1 of "make it a wargame")
- **Context**
  - Product owner asked whether this could become a real, deliberate-turn wargame: Red vs Blue, human-vs-human or human-vs-AI. Decisions taken: **simultaneous orders** (both sides commit blind, resolve together), **any side can be human or AI** (so hotseat / solo-vs-AI / AI-vs-AI all work), and **networked play eventually** (which in an air-gapped tool must be *serverless* WebRTC — last phase, rides on the serializable state below).
  - This change is **Phase 1: the engine only.** No UI yet (next change). The existing app is completely unaffected until the UI mode is wired — `game.js` only defines `window.GameModule` and is otherwise dormant.

- **What changed**
  - Added [`game.js`](../../game.js) and loaded it after `sim.js` in `DST2040.HTML`.
  - The engine is **self-contained and deterministic**: combat constants (the 4 strike methods, difficulty modifiers, cascade alpha 0.25, domain-affinity and vulnerability models) are copied from the live sim so the game *feels* consistent, but the resolver has no hidden cross-script dependency. `resolveTurn(board, orders, cfg, rng)` is a pure function; the per-turn RNG is seeded from `(matchSeed, turn)`, so a turn always resolves identically — the basis for replay, reproducible AI, and (later) trustless network sync.
  - **Simultaneity** is real: defensive orders (harden/repair) are read against the start-of-turn board, strikes accumulate damage against that same snapshot, damage applies, this-turn kills cascade once to neighbors, then repairs land. A node destroyed this turn still gets to act this turn.
  - **Red is now a first-class side** with the same four offensive methods as Blue (not just reactive counters). Asymmetry is preserved by action-point budgets (Blue 4 precise / Red 5 mass).
  - **AI commander** (`planOrders`) is deterministic from `(board, side, turn)`: value-ranks enemy targets, picks each target's best-vulnerability method, spends ~70% of AP striking and the rest hardening/repairing exposed own nodes. `easy`/`hard` knobs.
  - **Scoring/victory**: a side scores the enemy objective-value (importance×cascade) it removes each turn — which automatically credits cascade kills. A side is defeated if its alive objective value drops below 35% of its start; otherwise the turn limit decides by score.
  - **Non-destructive + serializable**: `newMatch` snapshots and resets the scenario to full strength for a clean board; `endMatch` restores the scenario exactly. `serialize()/deserialize()` round-trip the whole match (for save/load and the future network layer).

- **How verified (headless, via console against the live page)**
  - Ran a full deterministic AI-vs-AI match: board built (Blue 104 / Red 120 nodes, objective values 2776 / 3087), 10 turns each producing hits/misses/kills/cascades and accumulating score, victory decided by score at the turn limit.
  - Confirmed **determinism**: same seed → identical score trace across 3 independent matches; different seed → different result.
  - Confirmed the **human order path**: strikes queue, striking your own node is rejected, harden/repair queue, AP is bounded (4 orders max for Blue), commit gathers the AI side's 5 orders and resolves.
  - Confirmed **scenario restore**: after `endMatch`, 0 nodes neutralized and all combatant nodes back to full health.

- **Uncertainties / follow-up**
  - **Balance**: with the symmetric greedy AI, Red's higher AP + larger roster wins AI-vs-AI consistently. That is a knob, not a bug — Blue's edge is precision a human can exploit. Tuning levers: Blue AP, per-method damage, or making Blue strikes ignore some hardening. Revisit once humans play it.
  - Cascades are single-level by design (matches the sim and keeps resolution deterministic and bounded). Multi-level chains would be a deliberate future option.
  - The next change wires the UI (War Game mode, order queue, commit/resolve, turn/score HUD) on top of this engine.

### Change 12 — New `wargame.js`: the playable War Game UI (Phase 2)
- **What changed**
  - Added [`wargame.js`](../../wargame.js), loaded after `game.js`. It is **fully self-contained**: injects its own stylesheet, builds its own `⚔ War Game` launch button and a right-side HUD entirely via the DOM, and talks only to `window.GameModule` plus a few existing globals at call time (`selectedNode`, `selectNode`/`selectNodeById`, `applyHighlight`, `refreshMapMarkers`, `addEvent`). It edits none of the existing control HTML — the analyst tool is untouched until the operator clicks the button.
  - **Setup screen**: per-side Human/Computer toggles (so hotseat, solo-vs-AI, and AI-vs-AI all start from here), match length (6/10/16 turns), and AI difficulty.
  - **Play loop**: a live scoreboard (score + surviving-force bars per side), a "Selected target" panel that reads the currently-selected node and offers context actions — the four strike methods against an enemy node (flagging which ones it is **▲ vulnerable** to) or Harden/Repair on a friendly one — an order queue bounded by action points, and a one-click "Top enemy targets" shortlist so the player can act without hunting the 3D scene.
  - **Commit → resolve**: one button gathers any AI side's orders, resolves the turn, recolors the graph/map (neutralized nodes go grey via the existing color path), and shows a color-coded resolution log with the per-side score delta, then a "Next Turn" button. Game over shows a winner banner and "New Match".
  - **Targeting integrates with the real views**: you select a node the normal way (click it in 3D / Map / Geo, or via the shortlist) and the HUD acts on it — so the wargame inherits the geography for free.
  - **Clean exit**: the × restores the scenario to its exact pre-match health/status (the engine snapshots it at `newMatch`), so leaving the War Game never strands battle damage in the analysis tool.

- **How verified (in-browser, via the live HUD)**
  - Opened the HUD, ran setup, started a Human-Blue vs AI-Red match.
  - Picked the top Red command node from the shortlist; the strike panel correctly flagged Cyber and SOF as the vulnerabilities of that Buried target; queued strikes and watched action points decrement.
  - Committed: both Blue (human) and Red (AI, 5 orders) resolved simultaneously, the scoreboard and force bars updated, and the resolution log listed every hit/miss/kill with the score delta (RED +40 after it neutralized a Blue node).
  - Stepped Next Turn (orders cleared, AP reset), then fast-forwarded to the turn limit and confirmed the "RED WINS" banner + New Match.
  - Confirmed clean exit: 3 nodes neutralized mid-match → after ×, 0 neutralized and all nodes at full health, match ended, launch button restored. Console clean (only the benign Three.js dup warning).

- **Uncertainties / follow-up**
  - **No fog of war yet** — in a two-human hotseat both players currently see each other's queued orders (you switch sides with the in-HUD toggle). Fog (hide the other side's orders/queue, and optionally their force details) is the obvious Phase-2.5 add and is cheap given the existing filter system.
  - Balance still favors the side with more action points under AI play; unchanged from the engine note. Now that it is playable, this is the first thing to tune with real games.
  - Phase 3 (serverless-WebRTC networked play) rides on `GameModule.serialize()/deserialize()`, which already round-trip the full match.

### Change 13 — Fog of war for the War Game (hotseat secrecy + intel masking)
- **What changed (all in `wargame.js`; the engine is untouched)**
  - Added a **Fog of war On/Off** toggle to match setup (default On). Fog is a presentation/flow concern — the engine still resolves with full information — so it lives entirely in the UI layer.
  - **Blind handoff for two humans**: when fog is on and both sides are human, planning is sequential instead of a free side-toggle. Blue plans, "Lock orders → Pass to RED" raises a full-panel **ORDERS LOCKED** curtain ("pass the device… no peeking"), the next player presses "RED is ready →", then Red plans and commits. Neither side ever sees the other's queued orders; both resolve simultaneously and the result log is shown to both. The handoff re-arms every turn.
  - **Intel masking**: while a human is planning under fog, the enemy scoreboard card hides score and force% (shows only the observable active-node count + "strength unknown"), and a selected enemy node shows a coarse health band — **Intact / Damaged / Critical "est."** — instead of exact HP. Vulnerabilities stay visible so targeting is still a real decision. After resolution the scoreboard un-masks (results are public).
  - Selecting/clearing is reset across a handoff so a player doesn't inherit the previous player's selection.

- **How verified (in-browser)**
  - **Human-vs-AI + fog**: Red scoreboard card masked ("strength unknown"); own Blue card full; a selected Red node showed "Buried · Intact est. · vuln: Cyber, SOF" (band, not exact HP).
  - **Human-vs-Human + fog**: "BLUE planning" → queued a Blue order → "Lock orders → Pass to RED" raised the curtain with Blue's orders hidden → "RED is ready" → "RED planning" with Blue now masked and Blue's order still queued underneath → committed and confirmed **both** sides' orders appeared in the resolution, scoreboard un-masked afterward, and Next Turn re-armed the handoff (turn 2, BLUE planning, orders cleared).
  - **Regression — fog OFF, two humans**: the open side-toggle is preserved, nothing is masked, single commit (no handoff). Console clean.

- **Uncertainties / follow-up**
  - The board itself (3D/Map) still shows all nodes and prior battle damage to whoever is at the screen — that damage is public knowledge (past resolutions are announced), so this is intentional; true sensor-range visibility (hiding undetected enemy nodes entirely) would need a recon model and is a larger future option.
  - Vulnerabilities are treated as known out-of-band intel; if a stricter fog is wanted, those could also be masked until first contact.

### Change 14 — Rebrand to StrikeSim 2040 + the Stage Manager (reliability foundation)
- **Context**
  - Product owner reported the real, recurring failure: going full screen or resizing the window during a live session breaks the layout, distorts the map, misaligns nodes, and can leave the 3D view permanently dead ("3D view unavailable: WebGL context failed"). Their stated need is **reliability over features**. Decisions taken: name = **StrikeSim 2040**; **reliability first** (this change only — no new sim features); rename the main file.
  - Diagnosis (grounded in the code, not assumed): the only resize handler (`window.resize`) re-sized **only the Leaflet map, only in Map mode** — nothing re-sized the Three.js renderer or fixed its camera aspect (→ node misalignment), there was **no Fullscreen support**, and there were **zero** `webglcontextlost`/`restored` handlers (→ any context drop was permanent). The map-stuck-in-a-corner symptom in the PO screenshot was the same resize gap hitting Leaflet after the 3D fell back to Map at load.

- **What changed**
  - **Rebrand**: `<title>`, the in-app `#app-title` header, the launcher (`Open StrikeSim 2040.command`), and filename/path references in README, HANDOFF, and module comments. The main file is renamed `DST2040.HTML` → `StrikeSim2040.html` (launcher + docs updated to match). "MDSC" is kept where it is genuine multi-domain terminology rather than the product name — a blind global replace there would corrupt real domain language.
  - **New [`stage.js`](../../stage.js) — the Stage Manager**, the single authority for "render the active surface at the current size and survive a GPU drop":
    - One debounced `apply()` driven by a `ResizeObserver` on `#graph`/`#map`/`#app`, plus `window.resize` and `fullscreenchange`. It sizes the **3D renderer + camera** (via the ForceGraph3D `width()/height()` setters) and calls Leaflet `invalidateSize`, and **guards against the 0×0 size** that corrupts a hidden canvas. Observing `#graph`/`#map` also catches the display:none→block flip on view switches, so a surface sized while hidden is corrected the moment it appears.
    - **WebGL context-loss recovery**: `webglcontextlost` → `preventDefault()` (the line that *permits* recovery) + a calm operator toast; `webglcontextrestored` → re-size + data refresh. three.js (r128) rebuilds its GL resources on restore; without the preventDefault the context was gone for good.
    - **Fullscreen**: a `⛶ Fullscreen` button (and `F` shortcut) using the Fullscreen API on the app shell; `fullscreenchange` re-syncs through the same `apply()`.
    - Debounce uses `setTimeout`, **not** `requestAnimationFrame`: rAF is fully paused in a backgrounded tab, which would drop a resize that happened while hidden; `setTimeout` always eventually reconciles.
  - **Renderer hardening** (`engine.js`): pass `rendererConfig` to `ForceGraph3D` with `failIfMajorPerformanceCaveat:false` (lets weak / software-fallback GPUs still acquire a context instead of throwing the "WebGL context failed" error) plus `powerPreference:'high-performance'`.

- **How verified (in-browser)**
  - Rebrand visible: tab title and right-panel header read **StrikeSim 2040**; the `⛶ Fullscreen` button renders next to War Game.
  - **Renderer matches its container**: on load the canvas auto-sized to the stage box (483×803, matched); after changing the stage size the renderer reconciled to the new box (820×700, then 1000-wide), proving `apply()` sizes correctly at any dimension.
  - **WebGL recovery**: forced a real context loss via `WEBGL_lose_context` — `webglcontextlost` fired, then `restoreContext()` fired `webglcontextrestored`, and the app survived intact (context alive, 224 nodes preserved). Pre-change this was the permanent-death path.
  - **Map view fixed**: Map mode now renders the Blue Marble satellite with units on correct West-Pacific geography — the corner-stuck/floating-units symptom from the PO screenshot is gone. Console clean (only the benign Three.js dup warning).

- **Uncertainties / follow-up**
  - The automatic `ResizeObserver`/`window.resize` *firing* could not be exercised in the headless preview because the preview tab is backgrounded, where Chrome pauses `ResizeObserver` and `requestAnimationFrame` (a probe observer fired 0 times). The `apply()` logic itself is proven correct at every size via direct invocation, and the observer/`window.resize`/`fullscreenchange` wiring is the standard set that fires in a real foreground browser — so the PO should confirm live: full screen on each monitor, drag-resize, and switching Map/3D/Geo while resized.
  - This is Phase 1 (reliability) only. Phases 2–5 (edges schema + Three.js line/tube rendering, temporal sim, instanced rendering, exports/scenario tools) are sequenced to land on this now-stable base, one verified phase at a time.

### Change 15 — Fix the broken Map view (misregistered crop, world-zoom, leaked loader) + cache-busting
- **Context**
  - PO screenshot showed the Map badly broken: a misaligned regional satellite rectangle floating over China, the map zoomed out to the whole world (centered near Africa), and "Initializing 3D Graph…" hanging over it. Root-caused to three independent defects that combine when the 3D context fails to initialise.

- **What changed**
  - **Removed the misregistered theater satellite crop** (`map.js`). A parallel change had re-draped `earth-blue-marble-indopac-3072.jpg` over a lat/lon rectangle on top of the world basemap. In EPSG:3857 a square image over a lat/lon rectangle stretches by latitude, so it floats out of register with the basemap and the markers — the exact failure the worklog had previously retired. Now there is **one** geospatially-honest basemap (the full-world Web Mercator Blue Marble) at full opacity; imagery, coastlines, and markers share one CRS.
  - **`fitMapToMarkers` no longer falls back to a whole-world view** (`map.js`). The empty-markers fallback was `setView([20,0], 2)` — a world view centered near Africa, exactly the PO's zoomed-out state, which appears when the fit races ahead of marker creation. It now fits a fixed Indo-Pacific theater envelope, so an empty map still shows the theater.
  - **The WebGL-fail fallback now clears the loader and frames the theater** (`StrikeSim2040.html`). When 3D init throws, its `onEngineStop` (which normally hides "Initializing 3D Graph…") never fires, so the label hung over the Map fallback; the fallback now hides it explicitly and runs `invalidateSize` + `fitMapToMarkers` after markers exist.
  - **Cache-busting on local modules** (`?v=p1` on `ui/state/map/engine/stage/sim/game/wargame/views/inline-datasets`). The local `http.server` sends no `Cache-Control`, so browsers heuristically cached modules and could silently run an OLD version after an update (this bit verification repeatedly this session, and would bite an operator pulling a new build). Versioned query strings guarantee a fresh fetch. **Bump this token on every release** (or future change) so clients pick up new module code.

- **How verified (in-browser)**
  - Map mode: **exactly one** image overlay (the Web Mercator basemap), no floating crop; framed on the theater (zoom 3, centered ~127°E/16°N); 224 markers on correct West-Pacific geography (screenshot).
  - Forced the empty-markers race (cleared markers, set a world view, called the fit): it re-framed the theater (127°E) instead of the world.
  - Console clean. (The cache-bust was also what finally let the corrected `map.js` load at all — confirming the staleness problem was real.)

- **Uncertainties / follow-up**
  - The retired high-res theater inset could return **if** it is first reprojected into Web Mercator (like the global basemap was) and given matching bounds — draping the raw equirectangular-style crop over a lat/lon rectangle will always misregister and should not be reintroduced.
  - The `?v=` token is manual; a future build step could stamp it automatically.

### Change 16 — Fix "WebGL context failed": compatibility-first context + retry + honest diagnosis
- **Context**
  - Operator still hit "3D view unavailable (WebGL context failed)" at load. Root cause found: **Change 14's own renderer hardening set `powerPreference: 'high-performance'`**, which (confirmed honored on the live context) can make `getContext()` fail outright on machines with hardware acceleration off or a laptop whose discrete GPU is parked — the browser would rather fail than fall back. The earlier "hardening" optimised for the wrong thing (a strong GPU) instead of for *getting any context at all*.

- **What changed**
  - **`engine.js`**: default `powerPreference` is now **`'default'`** (let the browser pick any working adapter — integrated or software) instead of `'high-performance'`. `create()` now accepts `opts.rendererConfig` so callers can retry with an even more conservative profile, and a new **`dispose()`** tears down a (possibly half-built) instance — runs the lib destructor, forces context loss to free the GPU slot, and resets module + globe state — so a retry rebuilds cleanly with no duplicate canvas.
  - **`StrikeSim2040.html`** — robust startup replacing the single try/catch:
    - **Progressive fallback**: try the default profile, then a minimal one (`antialias:false`, `powerPreference:'low-power'`) before giving up.
    - **Honest diagnosis**: a `webglAvailable()` probe distinguishes "the browser truly won't give a WebGL context" (→ actionable *enable hardware acceleration* guidance) from "WebGL works but the engine threw for another reason" (→ surfaces the **real** error text instead of mislabeling everything "WebGL context failed").
    - **Exception-proof Map fallback**: the recovery affordance is shown FIRST, every fallback step is guarded, a reflow is forced before Leaflet builds tiles (prevents the 0×0 "infinite tiles" throw), and markers are drawn after `invalidateSize` — so a Map hiccup can never strand the operator on a blank screen.
    - **No-reload "↻ Retry 3D" button**: re-attempts the engine after the operator enables hardware acceleration or frees GPU contexts; on success it switches from Map back to 3D.
  - Cache-bust bumped `?v=p1` → `?v=p2` so the new modules load.

- **How verified (in-browser)**
  - Live context now reports `powerPreference: 'default'` and 3D renders 224 nodes normally.
  - Forced `EngineModule.create` to throw: it made **2** attempts (progressive fallback), no exception escaped, the **Retry 3D button appeared**, it fell to Map with the loader hidden, and the event log showed the honest "3D engine failed to start: <error>" message (WebGL-available branch). No "infinite tiles" crash.
  - Clicked **Retry 3D** (with the engine restored): 3D rebuilt with 224 nodes, the button auto-hid, the view switched back to 3D, and the container held **exactly one** canvas (clean `dispose()`).

- **Uncertainties / follow-up**
  - If the operator's browser blocks WebGL entirely (hardware acceleration off *and* software GL disabled), no client code can conjure a context — but they now get accurate guidance and a one-click Retry once they flip the setting, with Map/Table fully usable meanwhile. If it still fails after this, the surfaced error text will say whether it's truly "no WebGL" or a different fault.

### Change 17 — Fullscreen no longer hides the overlay buttons
- **What changed**
  - `stage.js`: Fullscreen now targets `document.documentElement` (the whole page) instead of `#app`. The War Game, Fullscreen, and Retry-3D buttons are fixed-position children of `<body>` (siblings of `#app`), so requesting fullscreen on `#app` dropped them out of the fullscreen view — the operator's "the War Game button disappears in full screen" report. `#app` already fills 100vw/100vh, so the picture is identical; the root simply includes the body-level overlays. Also removed a now-pointless `:fullscreen` CSS rule that would have shoved the Fullscreen button over the right panel.
  - Cache-bust bumped to `?v=p4`.
- **How verified**
  - Headless Chrome won't grant programmatic fullscreen, so verified deterministically: both `#wg-launch` and `#stage-fs-btn` are inside `document.documentElement` (the new fullscreen target), and the served `stage.js` targets the document root, not `#app`. Clean load shows both buttons present/visible with 3D at 224 nodes.
  - Operator should confirm live: click Fullscreen and check the War Game button (and the Fullscreen toggle itself) remain on screen.

### Change 18 — Fullscreen buttons, take two: re-home overlays into #app + beat the cache
- **Context**
  - Operator reported the War Game (and Fullscreen) buttons STILL vanished in full screen after Change 17. Two causes: (1) the cache — the document.documentElement fix from Change 17 wasn't reaching the browser because the cached HTML shell kept loading old modules; (2) even with the fix, robustness depended on which element was fullscreened.

- **What changed**
  - **`stage.js` — `reparentOverlays()`**: moves the Fullscreen, War Game, and Retry-3D buttons from `<body>` INTO `#app`. They are `position:fixed` and `#app` has no transform, so their on-screen position is identical — but now they sit inside `#app`, so they survive fullscreen whether the target is `#app` OR the document root. Called at init, on the delayed kicks (the War Game button is created late by `wargame.js`), and immediately before requesting fullscreen. This makes the fix independent of the fullscreen target.
  - **Cache, attacked at the source** (the recurring blocker this whole effort): the launcher `Open StrikeSim 2040.command` now opens `…/StrikeSim2040.html?t=$(date +%s)` — a unique URL each launch — so a double-click always loads a fresh shell, which then loads fresh `?v=` modules. Added `Cache-Control`/`Pragma`/`Expires` no-cache `<meta>` hints to the shell too, and bumped modules to `?v=p5`.

- **How verified (in-browser)**
  - After reload, both `#wg-launch` and `#stage-fs-btn` report `parentElement === #app` and `#app.contains(...) === true`; the War Game button is at top-center (centerX == viewport center) and the Fullscreen button at the stage's top-right — positions unchanged by the re-parenting. Screenshot confirms both buttons present with 3D at 224 nodes.
  - Real fullscreen still can't be exercised headlessly, but the buttons being inside `#app` is the deterministic guarantee that they're in the fullscreen subtree.

- **Operator note**: because the browser had been caching the shell, do ONE hard reload (Cmd/Ctrl+Shift+R) to pick up this build; after that, the launcher's `?t=` cache-bust keeps every future launch fresh on its own.

### Change 11 — Worker-backed Monte Carlo and theater-grade satellite map
- **What changed**
  - Added `sim-worker.js`, a standalone no-import Web Worker that runs Monte Carlo trials off the UI thread in cancellable chunks. It receives a frozen simulation snapshot, method/resource/settings config, success criteria, seed, and plan; it streams progress back to the UI and returns the same aggregate arrays/maps the existing report path expects.
  - Rewired `runMonteCarlo()` in `DST2040.HTML` to prefer the worker, update the progress bar from worker messages, send cancellation to the worker, and fall back to the existing animation-frame chunk loop when workers are unavailable (notably `file://`).
  - Fixed simulation spend accounting in the shared/main fallback path: typed KE/EW/JAM/SOF budgets now report actual spend instead of returning zero when only type buckets were decremented.
  - Reintroduced `assets/earth-blue-marble-indopac-3072.jpg` as the primary Leaflet theater overlay using tight operational bounds `[[ -13.5, 57.5 ], [62.5, 173.5]]`, while keeping the generated Web Mercator full-world Blue Marble underneath at low opacity.
  - Added CSS treatment for global/theater satellite layers so the regional layer reads as a crisp command-center satellite picture without overpowering unit markers.
  - Stopped probing optional `tiles/` by default. Local tiles now opt in with `?tiles=1`, avoiding a fresh-checkout `tiles/0/0/0.png` 404 in DevTools.
  - Added a data-URI favicon and filtered only the exact known vendor warning `WARNING: Multiple instances of Three.js being imported.` so real app warnings/errors still surface.

- **Why**
  - This finally moves the expensive default MC run out of the main thread instead of merely yielding between chunks. The UI remains interactive while large risk checks run.
  - The map now satisfies the product-owner's "high-stakes operational satellite picture" ask without abandoning the prior geospatial lesson: the world Mercator layer provides honest global context, and the Indo-Pacific image is used where it is visually strongest.
  - Fresh-checkout credibility matters. Optional assets should not create red-console noise when absent.

- **How verified**
  - Reused the local static server at `http://localhost:8000/DST2040.HTML`.
  - Drove a fresh headless Chrome target through Map and Geo:
    - status `View: 3D Network · Geo ON (224 nodes pinned by lat/lon)`;
    - basemap `Basemap: theater satellite + coastlines`;
    - overlays loaded: `assets/earth-blue-marble-webmercator-2048.jpg` and `assets/earth-blue-marble-indopac-3072.jpg`;
    - `Log.takeEntries()` and console event capture both returned empty on a fresh reload.
  - Captured `/tmp/strike-sim-map-verify.png`; visual inspection shows the theater image filling China/Japan/Taiwan/Philippines/Indonesia/Papua with unit markers over recognizable coastlines.
  - Built a two-step COA in-browser, ran `1,500` worker trials, and confirmed:
    - progress reached `100%`;
    - note read `Worker run complete. UI stayed responsive during computation.`;
    - UI tick probe advanced `187` times during the run;
    - run button restored to `Run 1,500 Trials`;
    - no toast errors, `Log.takeEntries()=[]`, and no console events.
  - Syntax checks:
    - `node --check sim-worker.js`
    - `node --check map.js`
    - `node --check engine.js`
    - extracted inline `DST2040.HTML` script compiled via `vm.Script`.

- **Uncertainties / follow-up**
  - `sim-worker.js` intentionally duplicates the current simulation kernel instead of importing it because the app has no build step and `sim.js` assumes `window`. The next architecture move should extract a pure shared kernel that both main-thread preview and worker MC import.
  - The Indo-Pacific JPG still lacks source projection metadata. The new bounds are a pragmatic theater registration tuned against visible coastlines; if exact metadata appears later, replace the bounds rather than cargo-culting them.
  - Worker fallback remains important for `file://` launches. The static-server path is now the premium path.
