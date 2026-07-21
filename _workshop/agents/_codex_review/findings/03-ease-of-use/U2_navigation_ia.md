# U2 — Navigation & Information Architecture
- Dimension: Ease of Use
- Focus: Navigation, information architecture, view switching, and panel layout in the main StrikeSim 2040 shell.
- Files inspected: `StrikeSim2040.html`, `_stark/audits/00-MASTER-FIXLIST.md`

## Summary
StrikeSim 2040 has made real progress toward an operator console: the command bar provides a global view switcher, the side panels are collapsible, and the first-run card gives new users a starting point. The main usability risk is that navigation is now split across several competing surfaces: top tabs, left quick actions, mutable button labels, dynamic action relocation, and modal workflows. That makes the app look powerful, but it also increases the chance that an operator loses orientation or misses the next intended step. The highest-value fixes are IA consolidation, clearer panel layout rules, and view-aware handoffs from planning/simulation flows into the map/table/org views.

## Strengths
- The global command bar gives the app a recognizable top-level IA with explicit `3D`, `MAP`, `TABLE`, and `TASK ORG` destinations in one place.
- The right and left side panels have collapse handles, which is appropriate for a dense C2 visualization where screen real estate matters.
- The first-run orientation card and persistent help button show awareness that users need onboarding, not just more controls.
- The active-view status text and active button styling are useful affordances for keeping users oriented across multiple render surfaces.
- The no-build shell keeps critical navigation close to the offline HTML surface, which fits the air-gap/offline product requirement.

## Findings
### U2-01 — Duplicate view navigation splits the operator's mental model
- Severity: P1   Impact: 4   Effort: M
- Location: `StrikeSim2040.html:1268`, `StrikeSim2040.html:1473`, `StrikeSim2040.html:2229`
- Observation: The command bar exposes a top-level tablist for `3D`, `MAP`, `TABLE`, and `TASK ORG` at `StrikeSim2040.html:1268`-`StrikeSim2040.html:1272`, while the left controls panel starts another set of `left-actions` groups at `StrikeSim2040.html:1473`-`StrikeSim2040.html:1502`. The state updater then separately computes an active left-panel button and command-bar view at `StrikeSim2040.html:2229`-`StrikeSim2040.html:2243`, so the app maintains two navigation systems for the same destinations.
- Recommendation: Make the command bar the single canonical view switcher. Keep the left panel for task actions only, or convert its duplicate view buttons into shortcuts that visually and semantically mirror the top tabs with identical labels, active states, and ARIA roles.
- Tradeoffs/risks: Removing duplicate shortcuts may feel like a loss for power users unless keyboard shortcuts or compact secondary links are kept.

### U2-02 — Mutable view button labels make backtracking ambiguous
- Severity: P1   Impact: 4   Effort: S
- Location: `StrikeSim2040.html:3206`, `StrikeSim2040.html:3220`
- Observation: `toggleMapMode()` flips `mapModeEnabled` at `StrikeSim2040.html:3206`, shows/hides the map and graph at `StrikeSim2040.html:3220`-`StrikeSim2040.html:3221`, then rewrites the map button text to either `3D` or `Map` at `StrikeSim2040.html:3222`. This means a button that normally means "go to Map" becomes "go to 3D" after activation, which competes with the fixed top tab labels.
- Recommendation: Keep destination labels stable everywhere: `Map` should always mean Map, `3D` should always mean 3D. Show current state with `.active`, `aria-selected`, and `#view-status` instead of changing button text.
- Tradeoffs/risks: Existing users may have learned the toggle behavior, so this should land with a short first-run/help note update.

### U2-03 — Panel layout is asymmetric and can obscure the operational picture
- Severity: P1   Impact: 4   Effort: M
- Location: `StrikeSim2040.html:71`, `StrikeSim2040.html:349`, `StrikeSim2040.html:642`
- Observation: The right panel is reserved in layout via `--side-width: 380px` at `StrikeSim2040.html:71`, and every main surface is inset with `right: var(--side-width)` at `StrikeSim2040.html:349`, `StrikeSim2040.html:359`, `StrikeSim2040.html:378`, and `StrikeSim2040.html:411`. The left panel, however, is an absolute 340px overlay at `StrikeSim2040.html:642`-`StrikeSim2040.html:647` that collapses by transform at `StrikeSim2040.html:658`, so opening controls covers the active 3D/map/table/org surface instead of resizing or reserving space consistently.
- Recommendation: Introduce a matching left layout variable, for example `--left-width`, and have active surfaces/ticker/node popups respect both rails. If preserving overlay behavior is intentional, default the left rail collapsed and add a clear "pin controls" state so users understand when content is being covered.
- Tradeoffs/risks: Reserving both rails reduces map/canvas width on smaller screens; a responsive collapse breakpoint will be needed.

### U2-04 — Global actions are dynamically relocated into an undifferentiated action strip
- Severity: P2   Impact: 3   Effort: M
- Location: `StrikeSim2040.html:340`, `StrikeSim2040.html:1259`, `StrikeSim2040.html:2256`
- Observation: The command bar has an empty `#cmd-actions` container at `StrikeSim2040.html:1275`, and the comment at `StrikeSim2040.html:1259`-`StrikeSim2040.html:1261` says module buttons such as Campaign, War Game, Fullscreen, and Retry 3D are relocated into it on load. CSS then normalizes all relocated buttons the same way at `StrikeSim2040.html:340`-`StrikeSim2040.html:342`, and the relocation function begins at `StrikeSim2040.html:2256`. Primary planning, simulation, display, and recovery actions therefore become a flat row of equal-weight buttons rather than a structured IA.
- Recommendation: Group `#cmd-actions` into labeled clusters: `Plan` for Campaign/COA, `Fight` for War Game, `Display` for Fullscreen/view recovery, and `Recover` for Retry 3D. Prefer static placeholders in the shell with modules filling known slots, so the IA remains visible even if a module fails or loads late.
- Tradeoffs/risks: This adds a small amount of shell markup and requires module button registration discipline, but it reduces cognitive load and failure ambiguity.

### U2-05 — Modal workflows do not hand users into the right view context
- Severity: P2   Impact: 3   Effort: M
- Location: `StrikeSim2040.html:5310`, `StrikeSim2040.html:5760`, `StrikeSim2040.html:5828`
- Observation: The COA wizard opens as a modal at `StrikeSim2040.html:5310`-`StrikeSim2040.html:5319`, then finalization writes plan state and closes the wizard at `StrikeSim2040.html:5760`-`StrikeSim2040.html:5771`. When a plan preview runs, it updates `highlightMode` and `highlightSet` at `StrikeSim2040.html:5828`-`StrikeSim2040.html:5830`, but only refreshes markers if `mapModeEnabled` is already true at `StrikeSim2040.html:5831`. If the user stays in 3D, table, or task-org view, the workflow produces a result without moving them to the view where the target highlights are most actionable.
- Recommendation: Add explicit post-modal next steps: `View targets on Map`, `Inspect in Table`, and `Open War Game`. For simulation previews, either auto-switch to Map after user confirmation or show a compact target-summary panel with a one-click map transition.
- Tradeoffs/risks: Auto-switching views can surprise users, so make it a confirmable action or a persistent preference.

## Quick wins (top 3 high-impact/low-effort)
1. Stop changing the map button text; use stable labels plus active state and `#view-status`.
2. Add labels or separators inside `#cmd-actions` so planning, war-game, display, and recovery controls are not a flat mixed row.
3. After COA wizard or preview completion, show `View on Map` and `Run War Game` buttons in the modal footer.

## Open questions for the human review
- Should the left control rail be a true overlay for expert operators, or should it reserve layout space like the right sidebar when pinned open?
- Which surface is the canonical default for a strike-planning workflow: 3D network, map, table, or campaign/COA planner?
- Are War Game and Campaign intended as peer top-level modes, or should they live under a single `Plan/Fight` workflow?
- Should view switching be available through keyboard shortcuts visible in the UI, especially for air-gapped/demo use without documentation?
