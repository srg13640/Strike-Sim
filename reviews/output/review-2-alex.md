# Review 2 — Strike Sim (Alex)

## Actual bugs / problems

1. **Geo assets are effectively broken by default, so Geo Mode starts from a 404 baseline.**
- `map.js:37-62` hardcodes local tiles at `./tiles/{z}/{x}/{y}.png`; no remote fallback exists.
- `map.js:120` only probes `./tiles/0/0/0.png` once and keeps running even when the path is missing.
- `engine.js:35` points texture to `assets/earth-dark.jpg` and `engine.js:51` loads it unconditionally.
- `README.md:79` documents local tiles as expected, but there is no bundled `assets/` or `tiles/` in-repo in this checkout, so users get missing-tile and texture fetch noise in console before they even interact.
- Net effect matches your `~237` console errors report: repeated failed image requests plus map engine noise, not just one clean warning.

2. **Geo Mode can appear inert even when toggled.**
- `DST2040.HTML:1738-1744` enables geo mode by calling `EngineModule.applyGeoLayout(data.nodes)` and setting `geoModeEnabled`.
- `engine.js:66-87` pins nodes to `fx/fy/fz` and **disables** forces (`link`, `charge`, `center`).
- `DST2040.HTML:1913` rebuilds `graphData` from filtered visible nodes each refresh, so the geo pinning can be partially replaced/invalidated as filters change.
- `DST2040.HTML:2477` only uses a fixed camera reset for geo mode; no explicit fit logic after layout changes.
- If texture/tiles are missing, the mode’s visible confirmation is weak (almost no readable cue), which is exactly why it feels “does nothing.”

3. **The “simulation foundation” is split in a way that invites math drift.**
- `sim.js:20`, `sim.js:104` define profiles/RNG/context and intentionally re-export globals.
- `DST2040.HTML:3084-3279` and `DST2040.HTML:3334-3700` contain simulation logic inline.
- That means one behavior change in `sim.js` can silently desync from the engine block in HTML unless manually synchronized.
- The split is explicitly intentional, but it is exactly where analyst-grade regressions are born.

4. **`findBestGoalPlan` is not a robust beam search; it’s a bounded randomized sampler dressed as search.**
- `DST2040.HTML:4407-4470` builds a candidate list and evaluates samples, but there is no maintained true frontier with consistent score propagation across steps.
- `DST2040.HTML:4414` initializes beam with `beam` slots and `DST2040.HTML:4416` iterates shallowly, then `simulatePlanOnce` is used in a trial loop (`DST2040.HTML:4372-4398`) with random method picks.
- This works as a heuristic sampler, but it is not a proper dynamic-programming/branch-and-bound beam where state quality is tracked by a real frontier.
- For planning claims, be explicit: “best-effort stochastic planner,” not “beam search” in a formal sense.

5. **Monte Carlo math has good bones but some analyst-facing warts.**
- RNG is Park-Miller-style LCG in `sim.js:47-56`; it is deterministic and acceptable for reproducible game simulation, but weak for statistical rigor (serial structure, short-period correlations are detectable with hard probing).
- There is clamping of hit probability in multiple places (`DST2040.HTML:3235`, `DST2040.HTML:3514`, `DST2040.HTML:4068`) and asymmetric multipliers (`DST2040.HTML:3215-3219`, `DST2040.HTML:3506`, `DST2040.HTML:3559`), which keeps outputs bounded but not obviously justified in docs.
- Two Monte Carlo paths are active: modern (`DST2040.HTML:3863-3988`) and legacy (`DST2040.HTML:3334-3700`), and the legacy path includes direct `Math.random()` in damage generation (`DST2040.HTML:3596`).
- Forensic review risk: if anyone compares outputs between workflows, they are not guaranteed to represent the same model.

6. **Cascade behavior is deterministic but maybe too blunt for analyst trust.**
- `DST2040.HTML:2081-2082` and `DST2040.HTML:3544` apply a fixed cascade damage pattern to every neighbor of a hit.
- There is no attenuation by relationship criticality or defense context there, only a score-weighted scalar and a hard multiplier.
- In practice, this can make cascading dominance look coherent in UI but weakly justified mathematically without parameter/validations notes in the UI.

7. **UI/control loop is usable, but not “fighter-grade” yet.**
- Keyboard handling is sparse: `DST2040.HTML:2763-2785` only handles two panel handles + enter/space, `DST2040.HTML:2821` only `Escape` clears selection, and search is enter-to-run (`DST2040.HTML:2806`).
- Nothing for quick tactical actions (run MC / toggle filters / camera / replay / target cycling) and no movement-hotkeys.
- If this is a game-ish tool, this is friction every single session.

8. **Long-run simulation can freeze UI and kills “game feel.”**
- `DST2040.HTML:3929` and `DST2040.HTML:3933` run trials in a full synchronous loop per `runMonteCarlo` call (10k default from `DST2040.HTML:2856`).
- Even with progress updates every `chunk` (`DST2040.HTML:3916-3954`), all work is still in main thread; on bigger inputs this is one-frame-to-many-frame stalls.
- For a simulator this size that can be acceptable, but for “game feel” it reads janky when users click “MC now.”

9. **Global alias pattern is a deliberate shortcut but brittle for a codebase with this many cross-links.**
- `ui.js:27-30`, `sim.js:20-104`, `views.js:31` each publish functions to globals.
- `DST2040.HTML:2957-2981` injects shared context through `*.init({...})` and expects script order to save you.
- This is clever for a no-build demo, but this architecture will punish any refactor because everything is runtime-linked by name.

## This would be sick if you...

1. **Made Geo Mode feel authoritative immediately.**
- Add explicit fallback visuals (`engine.js`): if `assets/earth-dark.jpg` fails, render a lit solid sphere with grid lines and hemisphere markers.
- On entering geo mode, call a stable reframe and a force-state lock to prevent immediate snap-back (`DST2040.HTML:2477` + `engine.js` force restore path).
- Add visible state text/indicator that mode is active and list how many nodes are lat/long pinned.

2. **Collapsed duplicate sim code into one engine surface.**
- Move all COA/trial/prioritization logic out of HTML into a real simulation module, then only orchestrate from `DST2040.HTML`.
- Keep `sim.js` as the authoritative source and remove legacy code path except when a compatibility flag is explicitly selected.

3. **Turned RNG into a strategy not a religion.**
- Keep LCG for replay determinism (`sim.js:47-56`) but add one stronger alternative (xoroshiro/splitmix) for confidence runs and include the selected RNG + seed in exported audit metadata.
- Document why low-bucket clamping exists (`DST2040.HTML:3235`, `DST2040.HTML:3514`) and provide sensitivity toggles.

4. **Gave users tactile speed controls.**
- Add keyboard bindings for run/stop MC, next/prev target, quick map toggle, and camera reset.
- Add a compact hotkey strip in help/status (`DST2040.HTML:2763-2821` area currently has only minimal handlers).

5. **Shipped production-safe assets.**
- Either include `assets/earth-dark.jpg` + a local tile set, or switch to a real tile CDN with local cache policy and explicit attribution.
- This one change likely drops console errors from the “I can’t trust this” bucket to zero and improves first impression instantly.

6. **Stopped blocking on main-thread simulation by batching/workerizing MC.**
- Keep current math untouched but run trial batches in a Worker; emit progress messages back to main thread.
- This preserves correctness while turning MC runs into real-time-feel operations.

## Why this review score: no fluff, just math on UX

### Sim correctness: **6.8/10**
- Strong deterministic RNG plumbing and coherent attack/cascade mechanics (`sim.js:47-56`, `DST2040.HTML:3235`, `DST2040.HTML:2081-2082`), but split-brain simulation paths and dual legacy/modern engines (`DST2040.HTML:3334-3700` vs `DST2040.HTML:3863-3988`) hurt reproducibility.

### Performance & game-feel: **6/10**
- 224 nodes is not inherently lethal (`DST2040.HTML:1913`, `DST2040.HTML:2428-2430`), but synchronous 10k-trial loops (`DST2040.HTML:3929-3933`), sparse control bindings (`DST2040.HTML:2763-2822`), and missing visual feedback make it feel clunky under stress.

### Code quality: **5.8/10**
- Pattern is intentionally practical for an offline, no-build shell (`sim.js:104`, `views.js:31`, `ui.js:76-82`), but global aliasing plus duplicated simulation logic creates hidden coupling and high regression risk. It works; it’s not a clean simulation architecture for long-term analyst trust.

## Short list of confidence risks (what would fail a formal review)
- `engine.js:35` and `map.js:61-62` unresolved assets with missing fallback path.
- Inconsistent simulation semantics across active simulation paths (`DST2040.HTML:3334-3700` vs `DST2040.HTML:3863-3988`).
- “Beam search” wording vs real algorithmic behavior (`DST2040.HTML:4407-4470`).
- Runtime coupling through globals without explicit contracts (`ui.js:76-82`, `sim.js:104`, `views.js:31`).
