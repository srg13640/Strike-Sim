# V4 — Layout & Responsiveness
- Dimension: Look & Feel
- Focus: Layout density, responsiveness across resolutions, overflow, rails/HUD chrome
- Files inspected: StrikeSim2040.html, wargame.js, _stark/audits/00-MASTER-FIXLIST.md

## Summary
The current command-picture chrome has a strong tactical identity, but it is laid out as several fixed viewport layers rather than as one negotiated responsive shell. The main app reserves a fixed 380px right rail, the War Game adds a second fixed 340px right HUD, and the newer radar/ticker chrome uses hard-coded offsets. Those choices work best on wide desktop displays and become fragile on laptop split-screen, tablet-sized, or fullscreen-transition states. The most important next pass is not another visual redesign; it is a responsive layout contract for rails, overlays, and command-bar overflow.

## Strengths
- The visual system has a coherent C2/HUD direction with shared tokens for colors, z-index tiers, and command chrome in `StrikeSim2040.html:60` and `StrikeSim2040.html:91`.
- The right rail is internally scrollable instead of letting the whole page scroll, which is the correct starting point for a console-style app (`StrikeSim2040.html:488`).
- The sidebar header already supports wrapping for local header controls, reducing one source of immediate clipping (`StrikeSim2040.html:450`).
- The War Game HUD keeps its own body scrollable and uses `min-height:0`, which prevents the panel body from blowing past the viewport (`wargame.js:202`).
- Motion reduction is considered for global animation and War Game FX (`StrikeSim2040.html:1022`, `wargame.js:508`).

## Findings
### V4-01 — Fixed right rail leaves the primary battlespace unusable on narrower viewports
- Severity: P1   Impact: 5   Effort: M
- Location: StrikeSim2040.html:71, StrikeSim2040.html:311, StrikeSim2040.html:314, StrikeSim2040.html:345, StrikeSim2040.html:355, StrikeSim2040.html:418, StrikeSim2040.html:431
- Observation: The shell sets `--side-width: 380px`, hides body and app overflow, and pins the 3D/map surfaces from `left:0` to `right:var(--side-width)` while the sidebar itself is a fixed `width: 380px`. Collapse exists only as `body.right-collapsed { --side-width: 22px; }`, and the only viewport-width media rule found in the shell is for modals, not the app rail (`StrikeSim2040.html:1239`). On a 768px-wide viewport, the main operational surface is effectively about 388px before any HUD overlays.
- Recommendation: Add a real responsive rail contract: automatically collapse or convert `#side` to an overlay drawer below a desktop breakpoint, set `--side-width` from `clamp()` or breakpoints, and ensure graph/map/table surfaces can claim the full width when the rail is collapsed.
- Tradeoffs/risks: Auto-collapsing the rail can hide filters/details that operators rely on, so pair it with a persistent handle/status badge and keyboard shortcut.

### V4-02 — Command bar has no overflow strategy for dense mission controls
- Severity: P2   Impact: 4   Effort: S
- Location: StrikeSim2040.html:323, StrikeSim2040.html:331, StrikeSim2040.html:335, StrikeSim2040.html:340, StrikeSim2040.html:342
- Observation: The command bar is a fixed 56px single flex row with brand, mode switch, spacer, and `#cmd-actions` all competing horizontally. Relocated module buttons are normalized into 32px-tall bar buttons, but there is no wrap, horizontal scroll, label compaction, or breakpoint that updates `--bar-h`. Because the page and app both hide overflow, clipped actions can become unreachable rather than simply scrolling into view.
- Recommendation: Give the bar a compact state: collapse verbose labels, allow `#cmd-actions` to scroll horizontally or wrap into a second row, and update `--bar-h` when wrapping so `#app` remains correctly offset.
- Tradeoffs/risks: Wrapping the bar increases vertical chrome, so the compact mode should prefer icon/short-label actions before adding a second row.

### V4-03 — War Game HUD opens as a second fixed right rail and fights the main rail/bar geometry
- Severity: P1   Impact: 4   Effort: M
- Location: wargame.js:152, wargame.js:153, wargame.js:156, wargame.js:162, wargame.js:539, wargame.js:543, StrikeSim2040.html:323, StrikeSim2040.html:431
- Observation: `wargame.js` appends both launch button and HUD directly to `document.body`, then positions the HUD as `fixed; top:0; right:0; width:340px; height:100%`. The base app already owns a fixed right sidebar at 380px, while the command bar sits fixed at the top of the viewport. There is no shared state that collapses the main rail, offsets the War Game HUD below `--bar-h`, or reserves space in the main graph/map surface when the War Game panel opens.
- Recommendation: Treat War Game as a mode-specific right rail instead of a free-floating overlay: either replace/collapse `#side` while it is open, or set `#wg-hud { top: var(--bar-h); height: calc(100vh - var(--bar-h)); width: min(340px, 100vw); }` and adjust `--side-width`/surface bounds through one shell-owned state class.
- Tradeoffs/risks: Re-homing the HUD into the shell reduces module isolation, but it prevents two independent right rails from covering each other during actual play.

### V4-04 — Radar and live ticker chrome use hard-coded offsets that are not viewport-aware
- Severity: P2   Impact: 3   Effort: S
- Location: StrikeSim2040.html:6046, StrikeSim2040.html:6048, StrikeSim2040.html:6051, StrikeSim2040.html:6058, StrikeSim2040.html:6063, StrikeSim2040.html:6130
- Observation: The Stark-HUD layer injects CSS at runtime with `#hud-radar` fixed at `left:352px` and `#hud-ticker` fixed from `left:352px` to `right:var(--side-width)`. It appends both elements to `document.body` and toggles them by view, but the only media rule in that injected CSS handles reduced motion. Below roughly 732px wide, the ticker has no meaningful horizontal space before accounting for any other chrome, and at wider split-screen sizes it can still sit over the main canvas/map content.
- Recommendation: Move radar/ticker placement into shell CSS variables and hide, dock, or scale them at narrow breakpoints. At minimum use `left: clamp(...)`, `width: min(...)`, and a breakpoint that disables the ticker when `right - left` would be too small.
- Tradeoffs/risks: Hiding ambience on smaller displays reduces cinematic feel, but it protects core targeting and map readability.

### V4-05 — Sidebar density creates nested scroll traps instead of progressive disclosure
- Severity: P2   Impact: 3   Effort: S
- Location: StrikeSim2040.html:488, StrikeSim2040.html:499, StrikeSim2040.html:568, StrikeSim2040.html:584, StrikeSim2040.html:607
- Observation: The sidebar has a main `#side-content` scroller, then several child regions add their own fixed-height scrolling: filters at 170px, team summary at 180px, and neighbors at 160px. This preserves every panel on screen, but on trackpads/touch screens it creates multiple small scroll targets inside a narrow 380px rail. Combined with hidden page overflow, operators can spend more effort fighting the chrome than reading the tactical state.
- Recommendation: Reduce nested scroll regions by making lower-priority sections collapsed by default, adding search/summary rows for filters, and letting the single rail scroller own most vertical movement. Keep only combat-log or table regions as intentionally scrollable widgets.
- Tradeoffs/risks: More progressive disclosure means one extra click for deep details, but it improves scanability and reduces accidental scroll capture.

## Quick wins (top 3 high-impact/low-effort)
1. Add a desktop breakpoint that auto-collapses `#side` and sets `--side-width: 22px` below the agreed minimum tactical width.
2. Make `#cmd-actions` compact/scrollable before it clips, and update `--bar-h` if the command bar ever wraps.
3. Offset and size `#wg-hud` with `--bar-h` and `min(340px, 100vw)`, then collapse the main rail while War Game is open.

## Open questions for the human review
- What is the required minimum supported viewport: 1366x768 laptop, 1024px split-screen, tablet, or only desktop fullscreen?
- Should War Game replace the inspector rail while active, or should both rails be visible on ultrawide displays only?
- Are radar/ticker ambience elements mandatory tactical information, or can they hide first when space is constrained?
- Should the command bar prioritize operator actions by mode so Campaign/War Game/Fullscreen/Retry do not all compete equally?
