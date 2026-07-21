# V2 — Motion & FX Performance
- Dimension: Look & Feel
- Focus: Motion/animation taste and restraint, FX performance/jank, and reduced-motion coverage.
- Files inspected: StrikeSim2040.html; map.js; engine.js; wargame.js; _stark/audits/00-MASTER-FIXLIST.md

## Summary
The current HUD/FX pass has strong visual intent: strike resolution now feels alive, map/3D effects clean themselves up, and some modules already respect `prefers-reduced-motion`. The main issue is that motion policy is fragmented across four independent effect channels, so a single turn can trigger HUD flashes, map tracers, 3D projectiles, audio, screen shake, DEFCON pulsing, radar, and ticker motion without a shared budget. That fragmentation creates the highest jank risk during large volleys and leaves reduced-motion users with several active animations. The right next step is restraint: centralize motion preferences and effect scheduling, cap per-turn spectacle, and stop ambient loops when the chrome is hidden.

## Strengths
- The War Game HUD has an explicit reduced-motion gate before its overlay/tracer/badge FX and clears outstanding FX timers when the HUD closes (`wargame.js:71`, `wargame.js:72`, `wargame.js:565`, `wargame.js:567`).
- The map strike path already has a cleanup registry for temporary timers, layers, and tracer RAFs, which is the right pattern for browser-safe FX (`map.js:1039`, `map.js:1041`, `map.js:1042`).
- The 3D strike path disposes geometries/materials after projectile and impact animations, avoiding the most obvious Three.js memory leaks (`engine.js:530`, `engine.js:581`, `engine.js:595`, `engine.js:660`).
- The prior master fixlist correctly flags visual-system consistency and War Game polish as important review lanes, not reasons to restart the overhaul (`_stark/audits/00-MASTER-FIXLIST.md:50`, `_stark/audits/00-MASTER-FIXLIST.md:87`).

## Findings
### V2-01 — Reduced-motion is inconsistent across FX channels
- Severity: P1   Impact: 4   Effort: M
- Location: `engine.js:682`; `engine.js:689`; `engine.js:690`; `map.js:1024`; `map.js:1027`; `wargame.js:71`; `wargame.js:72`
- Observation: The War Game HUD checks `window.matchMedia('(prefers-reduced-motion: reduce)')` and exits before playing its FX, and the map path computes the same preference before strike playback. The 3D `EngineModule.playStrikes` path only filters hit/kill/cascade events and schedules `flashStrike3D` timers; it has no equivalent reduced-motion gate. A user who opts out of motion can still get 3D beams, projectiles, and impact flashes whenever the 3D view is active.
- Recommendation: Add one shared helper, for example `window.StrikeSimMotion.prefersReduced()`, and make `EngineModule.playStrikes` no-op or render a single static impact marker when reduced motion is true. Use the same helper in `wargame.js`, `map.js`, and the global FX bus so the policy is not copied by hand.
- Tradeoffs/risks: This reduces cinematic payoff for users who explicitly choose reduced motion, but that is the expected accessibility contract.

### V2-02 — The tactical radar RAF runs forever even when the radar is hidden
- Severity: P1   Impact: 4   Effort: M
- Location: `StrikeSim2040.html:6068`; `StrikeSim2040.html:6069`; `StrikeSim2040.html:6070`; `StrikeSim2040.html:6103`; `StrikeSim2040.html:6131`; `StrikeSim2040.html:6132`
- Observation: `drawRadar` schedules the next `requestAnimationFrame` before checking whether `#hud-radar` is hidden, then returns early if hidden. `applyViewChrome` hides the radar outside map/3D views, but the RAF loop continues waking every frame anyway. The function also pulls active graph nodes and canvas context on its draw cadence, so the loop is cheap per frame but permanent.
- Recommendation: Store the radar RAF id and start/cancel it inside `applyViewChrome`, `visibilitychange`, and reduced-motion changes. When visible, cap redraws to 10-15 FPS or redraw only on view/data changes plus a lightweight sweep tick.
- Tradeoffs/risks: Stopping the loop requires a small lifecycle state machine, but it is localized to the HUD III script.

### V2-03 — One turn can fan out into an unbounded timer/RAF volley
- Severity: P1   Impact: 5   Effort: M
- Location: `wargame.js:1031`; `wargame.js:1036`; `wargame.js:1038`; `wargame.js:1041`; `wargame.js:1044`; `map.js:1184`; `map.js:1188`; `engine.js:689`; `engine.js:690`; `engine.js:593`; `engine.js:658`
- Observation: `onResolved` triggers HUD FX, map strike arcs, 3D strike beams, and the global audio/DEFCON/screen-shake bus for the same report. The map and 3D modules each schedule one timer per shot; the 3D path then starts RAF-driven projectile and flash animations. There is no visible cap, coalescing rule, or per-turn effect budget, so a large resolution report can create many overlapping timers and animation loops at 130 ms spacing.
- Recommendation: Introduce a single turn-resolution FX scheduler with a hard budget, such as play the first 8-12 shots, aggregate the rest into one summary pulse, and prioritize kills/cascades over ordinary hits. Pool reusable DOM/SVG/Three objects where possible and cancel outstanding scheduled FX on new turn, view switch, or HUD close.
- Tradeoffs/risks: Full event-by-event playback is more literal, but a capped volley will read cleaner and protect frame time on lower-end/offline machines.

### V2-04 — Global shake and DEFCON alert pulse ignore reduced motion and force layout
- Severity: P2   Impact: 3   Effort: S
- Location: `StrikeSim2040.html:5947`; `StrikeSim2040.html:5948`; `StrikeSim2040.html:5950`; `StrikeSim2040.html:5951`; `StrikeSim2040.html:6010`; `StrikeSim2040.html:6012`; `StrikeSim2040.html:6014`
- Observation: The HUD II layer injects a screen-shake keyframe, an infinite `fxAlertPulse`, and then toggles those classes from `StrikeSimFX.onStrike`. `screenShake()` removes the class, forces reflow with `void document.body.offsetWidth`, re-adds the class, and removes it later. There is no `prefers-reduced-motion` branch for either the shake or the persistent DEFCON alert pulse.
- Recommendation: Wrap shake and alert pulse CSS in `@media (prefers-reduced-motion: no-preference)` and make `screenShake()` return immediately when reduced motion is enabled. Replace the forced reflow restart with an `animationend`-driven class reset or a small Web Animations call on `#app`.
- Tradeoffs/risks: The reflow hack is simple and usually works, but it is exactly the kind of hidden cost that shows up as jank during strike volleys.

### V2-05 — Cinematic boot and ambient timers are always-on rather than context-aware
- Severity: P2   Impact: 3   Effort: S
- Location: `StrikeSim2040.html:5901`; `StrikeSim2040.html:5905`; `StrikeSim2040.html:5909`; `StrikeSim2040.html:5911`; `StrikeSim2040.html:5922`; `StrikeSim2040.html:6019`; `StrikeSim2040.html:6123`
- Observation: The boot sequence appends log lines every 300 ms and keeps the boot overlay alive for a minimum of roughly 2300 ms, with a 6000 ms hard cap. Separately, the telemetry clock, DEFCON decay, and ticker refresh run on recursive timeout/interval loops without visibility or reduced-motion checks. That makes the HUD feel cinematic, but it also spends motion budget on reloads and background tabs instead of reserving it for meaningful operational events.
- Recommendation: Show the cinematic boot only on first run or after an explicit reset, add an immediate skip path, and collapse it to a static load state under reduced motion. Pause the clock/ticker/DEFCON intervals on `document.hidden` and resume on visibility.
- Tradeoffs/risks: A shorter boot loses some atmosphere, but repeated reloads are common in this no-build workflow and should feel fast.

## Quick wins (top 3 high-impact/low-effort)
1. Add a shared `prefersReducedMotion()` helper and use it in `EngineModule.playStrikes`, `StrikeSimFX.screenShake`, DEFCON alert pulse, and boot.
2. Start/stop the radar RAF from `applyViewChrome` instead of letting it reschedule while hidden.
3. Cap strike playback to a small prioritized volley per turn and aggregate the remainder into one HUD/ticker summary.

## Open questions for the human review
- Should reduced-motion disable synthesized audio cues too, or only visual motion/shake?
- What is the largest expected turn-resolution event count in a realistic scenario, and should FX be budgeted against that worst case?
- Should the cinematic boot be a first-run experience only, or is it part of the intended operator theater every launch?
