# Strike Sim – Consolidated Engineering Backlog

Inputs: `reviews/output/review-1-hank.md`, `reviews/output/review-2-alex.md`

## Conflict resolution (Hank vs Alex)
Hank wants fewer, clearer controls and plain language on first use.
Alex wants more depth, tunability, and fast controls.
Decision: use **progressive disclosure**.
- Default screen: minimal action set with plain-language labels.
- Advanced controls stay available but are grouped behind explicit sections, accordions, or keyboard shortcuts.
- Expert diagnostics (RNG strategy, planning params) remain in the Advanced section, never on the default path.

## Consolidated triage

### Must-fix for defense-contractor handoff

| ID | Item (tagged source) | Root cause (file + function/area) | Task | Type | Effort | Acceptance criteria |
|---|---|---|---|---|---|---|
| M-01 | Geo/map assets are not available out of the box, causing noisy failures and hiding geography features (`Alex`) | `map.js:61-70` uses only local tiles; `map.js:109-120` only updates a status badge. `engine.js:35` hard-codes `assets/earth-dark.jpg` and `engine.js:47-58` loads it without a fallback. `README.md:79` documents local tiles as optional but code does not gracefully handle absence. | Add deterministic fallback strategy: local tiles if present, then optional CDN/local-proxy fallback if configured, and a generated fallback globe (no texture) when both fail. Remove repeated network failures by catching image-load errors and replacing with fallback visuals. | Bug | M | Open fresh checkout with no `tiles/` and no `assets/earth-dark.jpg`. Confirm map view renders without repeated red console errors and Geo mode still renders a readable globe/placement indicator. |
| M-02 | View mode behavior is ambiguous and appears to do nothing because state is communicated only by button text (`both`) | `enableGeoMode()`/`disableGeoMode()` in `DST2040.HTML:1738-1753` only changes button label; mode state lives in multiple booleans (`geoModeEnabled`, `mapModeEnabled`, `tableModeEnabled`, `orgModeEnabled`) and controls only by text switches (`DST2040.HTML:2641`, `2678-2681`). | Add a persistent view-state status line (e.g., `Current view: 3D / Map / Table / Geo`) and an explicit Geo status line (`Geo mode: ON/OFF; pinned nodes: X`). Keep button labels stable and clear (`Geo: ON/OFF`, `Map`). | UX | S | In browser, each toggle immediately updates the status line, and the operator can tell mode from the status even before first interaction with map/graph. |
| M-03 | Geo mode can be visually “overwritten” by filter/data refresh and remains hard to verify after interaction (`Alex`, `Hank`) | `enableGeoLayout` pins nodes in `engine.js:66-89`; refresh paths rebuild `graphData` from filtered nodes (`DST2040.HTML:1913`, `2428-2430`, `2641`) without guaranteeing Geo re-assertion and explicit geocentric framing. | When `geoModeEnabled` is true, re-apply geolocation pinning and force lockdown after any graph/data refresh, and add a stable `resetView` branch that fits to geospatial bounds in 1s. | Bug | M | Turn on Geo mode, apply a filter, and verify nodes remain lat/lon-pinned and camera framing still looks geospatial without requiring manual reload. |
| M-04 | Simulation logic is split between `sim.js` and `DST2040.HTML`, creating silent drift risk (`Alex`) | `sim.js` intentionally notes heavier engine is still in HTML (`sim.js:9-12`, `104-105`) while both `runMonteCarlo` and planning are implemented inline in `DST2040.HTML` (`3854-4018`, `4370-4565`). | Move simulation engine functions (`simulateTrial`, `runMonteCarlo`, `evaluateGoalPlan`, `findBestGoalPlan`, `buildGoalPlan`, etc.) into a dedicated engine module; keep only orchestration calls in `DST2040.HTML`. Add a single export contract used by both goal planner and MC UI paths. | Code-health / Bug | L | Remove duplicated implementations and prove both Goal Planner and “Run MC” flows consume the same engine module (one code path only) with matching result object shape. |
| M-05 | Two Monte Carlo execution paths can produce different behavior and use different RNG plumbing (`Alex`) | Legacy path in `DST2040.HTML:3334-3735` still uses inline `Math.random` (`3319`, `3520`, `3596`), while modern path uses `createRng` (`3920-4223`). | De-duplicate MC into one engine path; enforce one RNG API for all simulation calls. Keep legacy path only as an explicit compatibility mode behind a flag. | Bug / Code-health | M | A known seed + fixed input set must produce one reproducible result stream irrespective of calling path. |
| M-06 | MC can still jank the UI during large trials (`Alex`) | `runMonteCarlo` still performs `for (t = 1..trials)` in main thread (`DST2040.HTML:3919-3959`) despite periodic micro-yields. | Move MC compute into `Worker` with cancel/resume support, or at least chunk across animation frames with message passing. Keep progress and cancellation in the main UI thread. | Performance | M | Trigger default 10k trials while interacting with UI controls; frame time should remain interactive and browser input should remain responsive. |
| M-07 | Global alias pattern is brittle and order-dependent (`Alex`) | `ui.js`, `sim.js`, `views.js`, `map.js` and `engine.js` self-assign to `window` globals (`ui.js:82-87`, `sim.js:104-110`, `views.js`, `map.js:18-20`, plus `DST2040.HTML:2957-2981` init assumptions). | Replace window-aliased singletons with explicit module interfaces and dependency injection. Keep a minimal compatibility shim only where necessary. | Code-health | L | Load modules in any supported order and run app without `ReferenceError` for missing functions, while keeping behavior unchanged. |
| M-08 | “Beam search” naming over-promises algorithm quality (`Alex`) | `findBestGoalPlan` currently builds `beam` random candidates and ranks simulations (`DST2040.HTML:4402-4429`), i.e., heuristic sampler, not true frontier beam search. | Either implement true beam search with explicit frontier state propagation or rename all UX/docs references to “stochastic sampler” and adjust confidence claims. | Code-health | M | If label remains “beam search,” unit-like checklist in PR notes demonstrates frontier expansion + pruning. If relabeled, all user-facing copy and docs match implementation. |

### Polish

| ID | Item (tagged source) | Root cause (file + function/area) | Task | Type | Effort | Acceptance criteria |
|---|---|---|---|---|---|---|
| P-01 | New users are overloaded by jargon and cannot identify purpose quickly (`Hank`) | UI labels and section names (`MDSC`, `COA`, `Geo Mode`, `Monte Carlo`) appear immediately in control text (`DST2040.HTML:1055-1203`, app title and copy in `README.md:1-40`). | Add a first-screen plain-language explainer line and rename action labels to intent-first language (e.g., `Network view`, `Attack plan`, `Risk check`) with a lightweight glossary tooltip on technical terms. | UX | M | New user can complete: view setup -> run a simple COA preview without opening docs and can explain what each main section does in <30 seconds. |
| P-02 | Control density and discoverability hurt first-pass usability (`Hank`) | Left panel is mostly hidden by default (`DST2040.HTML:509-527`) and action sections are broad (`DST2040.HTML:1055-1203`). | Set left control panel open by default; show only 3-4 primary actions first, then fold COA/Simulation/Table/Advanced sections behind accordions. | UX | M | On load, users can click a primary action within 2–3 seconds without guessing panel position. |
| P-03 | “Generate COA” does not communicate flow (`Hank`) | `generate-coa-btn` exists separately from `COA Builder` and simulation buttons (`DST2040.HTML:1164-1198`), with no explicit state transition in UI. | Convert to a single guided entry point: button opens/updates the builder + state badge (`Draft / Wizard / Running`). Remove ambiguity by disabling irrelevant controls while building. | UX | M | Click once and receive visible “planing mode active” feedback plus next step within 1 second. |
| P-04 | Simulation and planning reports are numeric-only and not action-guiding (`Hank`) | MC/Goal report templates are data-heavy (`DST2040.HTML:4432-4448`, `4618-4640`, `4664-4671`) with little interpretation. | Add an interpretation block on each report with plain-language “What this means” + one recommended next operator action (e.g., “run with 2x trials”, “reduce high-uncertainty step”, “try alternate target set”). | UX | M | For any completed run, report includes an explicit interpretation sentence and action button. |
| P-05 | Keyboard controls are too sparse for efficient operation (`Alex`) | Keyboard handling is limited to panel handles and `Escape` (`DST2040.HTML:2760-2823`). | Add tactical hotkeys: run MC (`M`), map toggle (`M`+`Shift` or `Alt+M`), quick reset (`R`), next/prev target (`[` `]`), pause/step simulation (`Space`/`[`), plus a discoverable help strip in status area. | Feature / UX | M | One operator can complete one full scenario without mouse, including map toggle and MC run, and actions match visible hotkey legend. |

### Future features

| ID | Item (tagged source) | Root cause (file + function/area) | Task | Type | Effort | Acceptance criteria |
|---|---|---|---|---|---|---|
| F-01 | Cascade behavior is fixed and under-documented (`Alex`) | Cascade damage in legacy path is a constant scalar and fixed spread (`DST2040.HTML:3550-3555` and sibling logic at `2081-2082`). | Make cascade model tunable (`intensity`, `distance`, `criticality weighting`) and document rationale in a collapsible “Simulation assumptions” panel. | Feature / Code-health | M | UI exposes advanced tunables; operator can run two scenarios and see sensitivity effects in reports. |
| F-02 | RNG strategy is too narrow for confidence analysis (`Alex`) | Weak LCG in `sim.js:47-60` is acceptable for reproducibility but under-documented and limited for statistical work. | Add strategy selector (`LCG`, `SplitMix`, optional cryptographic mode), log seed + strategy + model metadata in MC result payload, and expose in report footer. | Feature | M | Report modal includes `seed`, `rng`, and assumptions, enabling result traceability across exports. |
| F-03 | Launch and local-server friction remains for non-technical users (`Hank`) | Quick start requires manually picking/keeping a local server and port (`README.md:20-24`) with no port-fallback guidance. | Improve README with explicit “If port busy…” flow and add a start script that auto-picks an available port and opens the browser with banner instructions. | Feature | S | A non-technical user can start and open the app from a single command; console has no missing-server ambiguity message on first launch. |
| F-04 | Expert controls are scattered; better discoverability needed for mission workflows (`both`) | COA builder, planner, and simulation controls are separate and dense. | Add workflow presets (`Quick`, `Balanced`, `High-confidence`), each exposing a curated subset of controls and default settings; persist user profile. | Feature | M | Starting from `Quick` yields valid plan and MC run with fewer than 5 clicks; `Advanced` unlocks full controls. |

## Final ordered backlog

1. **M-01** (highest credibility risk): fix asset/texture fallbacks so Geo and Map render without hard failures.
2. **M-02**: make Geo/Map modes explicit in status to remove “silent failure” UX.
3. **M-03**: harden Geo mode against data refresh and keep pinned state visible.
4. **M-04**: consolidate simulation engine into one module.
5. **M-05**: unify MC RNG/path behavior under one deterministic interface.
6. **M-06**: offload heavy MC work from main thread.
7. **M-08**: correct planning algorithm claims (beam vs sampler).
8. **M-07**: replace global alias coupling with explicit module contracts.
9. **P-05**: add keyboard controls and in-app help strip.
10. **P-02**: default control discoverability + progressive disclosure for defaults vs advanced.
11. **P-03**: simplify COA entry flow.
12. **P-01**: first-screen plain-language onboarding.
13. **P-04**: add interpretation guidance to outputs.
14. **F-02**: expose RNG strategy and result metadata.
15. **F-01**: expose cascade tunables and assumptions.
16. **F-03**: improve launch/startup ergonomics and local server fallback.
17. **F-04**: workflow presets for expert speed.

### Why this order
- Items 1–3 remove first-impression reliability issues and prevent users from doubting core visualization features.
- Items 4–6 prevent silent correctness drift and freeze behavior that would fail a defense-contractor technical review.
- Items 7–8 reduce long-term model/maintenance risk and make future extension safe.
- Polishing comes after credibility-critical behavior is stable; feature ideas are last because they improve quality/performance for repeat users and analysts rather than preventing immediate failures.
