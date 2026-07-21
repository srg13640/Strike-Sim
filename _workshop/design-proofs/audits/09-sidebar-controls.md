# Audit: Sidebar/controls

Surface reviewed: left "Controls" panel (Quick Actions, Data I/O, Legend, Event Log) and right "#side" sidebar (Team Summary, Team Resources, Search, Filters Domain/Team, COA). Handlers read: `applyFilters`/`applyTeamFilters` (1981, 2615), `onFind`/`selectNode` (2168, 2134), `exportJSON`/`processImport`/`normalizeImportedPayload` (2410, 2492, 2424), the highlight + contrast toggles (2309-2348), view toggles (2816-2929), and the listener block (2937-3027). File is `StrikeSim2040.html` throughout.

---

## [P0] High-contrast mode sets the background variable to transparent
- **Where:** StrikeSim2040.html:901 (`body.high-contrast { --bg: #0000; ... }`); base def at :61
- **Problem:** The high-contrast override sets `--bg: #0000`, which is a 4-digit hex = black at **alpha 00 (fully transparent)**, not the intended opaque dark. It looks like a typo of `#000` / `#0008`. Right now `--bg` happens to be referenced nowhere (dead variable), so the bug is latent — but the moment anyone wires `background: var(--bg)` onto `body`/canvas (the obvious use), high-contrast mode will render a see-through background. The same block uses other risky 4-digit shorthands (`--text: #ffff`, `--bg`) that read as accidental. This is the kind of "looks fine until it's used" landmine an auditor should flag now.
- **Fix:** Change to an opaque value, e.g. `--bg: #04080c;` (darker than base for contrast), and audit the other shorthand hexes in that block for intended alpha. While here, either remove `--bg` entirely (it is unused) or actually apply it so contrast mode controls the backdrop.
- **Effort:** S

## [P0] Search frames the camera even when the found node is hidden by a filter
- **Where:** StrikeSim2040.html:2168 `onFind` → :2188 `selectNode(matches[0])` → :2134 `selectNode` (`graphInstance.cameraPosition(...)`)
- **Problem:** `onFind` searches `data.nodes` (the full set), not the currently visible set. If a domain/team filter is hiding the match, `selectNode` still runs `cameraPosition` toward that node's coordinates. The node isn't in the rendered graph, so the user is flown to an empty region of space with a details panel open for an invisible node — looks like the tool broke. With an empty filter selection (now valid post-fix: hides everything) this is guaranteed. Worse, framing math uses `camPos.x * 1.5` and only fires when `node.x !== undefined`; a never-rendered/just-imported node may have undefined coords, so framing silently no-ops with no feedback either.
- **Fix:** In `onFind`, restrict matches to `currentVisible().visibleNodes`, OR detect that the top match is filtered out and either (a) auto-clear the relevant filter with a toast ("Showing X — was hidden by Domain filter") or (b) show "N matches hidden by active filters" in `#search-results`. Guard `selectNode` so framing a node with undefined coords gives a fallback (reset view) instead of a silent no-op.
- **Effort:** M

## [P0] Import accepts any object as "nodes" with no schema validation — silent garbage import
- **Where:** StrikeSim2040.html:2424 `normalizeImportedPayload`, :2450 `addImportedNodes`, :2492 `processImport`
- **Problem:** Validation only checks `importedData` is truthy and (for add) `nodes?.length`. There is no check that nodes are objects, that ids are usable, or that the payload isn't a stray array of strings/numbers. `normalizeImportedPayload` will happily treat *any* object's first array property as nodes (`Object.values(...).filter(Array.isArray)`), so importing an unrelated JSON file (e.g. a config with a `tags: [...]` array) produces nonsense nodes with no warning — the only feedback is a green "Added N nodes" toast. In **replace** mode (:2517) this wipes the working scenario (`resetApplicationState()` + `replaceActiveGraph`) before any sanity check, so a malformed-but-parseable file destroys the user's session with a success message.
- **Fix:** After normalization, validate: nodes is a non-empty array of objects each having a usable `id` (string/number) and reject otherwise with a specific error. For `replace`, validate the payload **before** calling `resetApplicationState()`; never destroy current state until the new graph is confirmed importable. Show count of dropped/invalid records.
- **Effort:** M

## [P1] Toggle buttons (Geo, High Payoff, High Risk, Contrast) have no pressed/active visual state
- **Where:** StrikeSim2040.html:1173-1177 buttons; CSS `.left-actions button` at :663 (no `.active` rule); toggles at 2309/2329/2343/1904. Compare the working pattern at :138 `.workflow-presets button.active`.
- **Problem:** These are stateful toggles but the button gives no indication it's ON. Geo Mode at least swaps its label ("Geo Mode"↔"Exit Geo"), but High Payoff, High Risk, and Contrast never change appearance — the only ON cue is the tiny "Mode: …" line in the legend (and for Contrast, nothing in the sidebar at all). A user can't tell from the control whether contrast or a highlight is active. The codebase already has an `.active` convention for the MC presets; it just isn't applied here.
- **Fix:** Add `.left-actions button.active` styling (accent border/fill) and toggle the class in `toggleHighPayoff`/`toggleHighRisk`/`toggleHighContrast` (and set on Geo). Use `aria-pressed` on these toggle buttons for screen-reader state.
- **Effort:** S

## [P1] View-mode buttons don't show which view is active (state ambiguity)
- **Where:** StrikeSim2040.html:1169-1171 Map/Table/Task Org buttons; label-swap logic in `toggleMapMode`/`toggleTableMode`/`toggleOrgMode` (2816-2929); `updateViewStatus` (1885)
- **Problem:** The active view is communicated only by mutating the button's own label to "3D" (the *exit* action). So in Map view, the Map button reads "3D", Table reads "Table", Org reads "Task Org" — there is no positive "you are here." The user must infer state from which single button flipped to "3D". The `#view-status` line ("View: Map") is the real source of truth but sits in the far sidebar header, decoupled from the buttons. This label-as-toggle pattern is also brittle: it's manually reset in 6+ places (e.g. 2821, 2828, 2857, 2863, 2905, 2911) and easy to desync.
- **Fix:** Keep button labels stable ("3D", "Map", "Table", "Task Org") and instead apply an `.active` class to the button matching the current view (single source: `updateViewStatus`). This removes the scattered `textContent` resets and makes active view obvious.
- **Effort:** M

## [P1] All/None/Apply filter buttons are now redundant and contradictory after the live-filter fix
- **Where:** StrikeSim2040.html:1260-1262 / 1270-1272; live `change` listeners at :3018-3019; All/None/Apply handlers at :3014-3022
- **Problem:** With the new behavior, every checkbox `change` calls `applyFilters`/`applyTeamFilters` immediately, and the All/None buttons also call apply after setting checkboxes. So **Apply now does nothing the user can perceive** (state is already applied) — it's a no-op button that implies filters are pending until you click it, which is misleading. "None" combined with the corrected semantics (empty = hide all) means clicking None blanks the graph instantly, which is surprising and easy to hit by accident with no undo. The three-button row reads like a classic "edit then commit" UI that no longer matches the live model.
- **Fix:** Remove the **Apply** button (or relabel the row to a single "Reset filters" = select-all). Keep All/None but rename None to "Clear (hide all)" so the destructive blank-graph result is expected, and consider a one-click "Show all" restore. Update the section hint to say filtering is live.
- **Effort:** S

## [P1] Quick Actions is a flat wall of 12 unlabeled buttons mixing views, sim, and display toggles
- **Where:** StrikeSim2040.html:1166-1179 `.left-actions` (2-col grid, :658)
- **Problem:** Twelve buttons of different *kinds* sit in one undifferentiated grid: navigation/views (Reset View, Map, Table, Task Org, Geo), display toggles (Hide Legend, High Payoff, High Risk, Contrast), sim actions (Strike Selected, Reset Sim), and an info action (Summary). No grouping, no headers, so discoverability is poor and the destructive "Reset Sim" sits one row away from harmless "Reset View" (confusable names). For a non-expert this is the densest part of the UI with the least guidance.
- **Fix:** Group under sub-labels: "View" (Reset View, Map, Table, Task Org, Geo), "Highlight" (Payoff, Risk, Contrast, Legend), "Session" (Strike Selected, Reset Sim, Summary). Consider collapsing Highlight into a small segmented control. Visually separate or confirm-guard Reset Sim. Rename "Reset View" / "Reset Sim" to disambiguate (e.g. "Recenter" vs "Reset Scenario").
- **Effort:** M

## [P1] Domain/team filter and "Strike Selected" jargon unexplained for non-experts; payoff/risk heuristics opaque
- **Where:** Labels at 1167 (Strike Selected), 1175-1176 (High Payoff/High Risk), 1257/1267 (Filters Domain/Team), 1277 (COA Generator); heuristics at `computeHighPayoffSet` :2317 and `computeHighRiskSet` :2337
- **Problem:** A non-expert hits MDSC-flavored terms with no glossary: "COA," "Task Org," "Geo Mode," "High Payoff" / "High Risk" (computed as opaque top-20% scores — payoff = importance×cascade/difficulty, risk = difficulty×counter-capability — never surfaced to the user). The legend lists "High Payoff / High Risk" swatches but not what makes a node qualify. "Domain" as a filter category is undefined in-UI. Tooltips exist on some buttons but are terse ("Highlight high-payoff targets") and tell you *what* not *why*.
- **Fix:** Add a short legend/tooltip line explaining the payoff and risk heuristics in plain words ("Payoff = high-value, easy-to-hit targets (top 20%)"). Provide an info affordance on the Filters headers explaining Domain vs Team. Consider a one-line glossary popover for COA / Task Org / Geo. Spell out "MDSC" once somewhere visible.
- **Effort:** M

## [P2] Export uses an undeclared "mdsc" prefix and no import-side version/round-trip guarantee
- **Where:** StrikeSim2040.html:2410 `exportJSON` (`a.download = 'mdsc_session_…json'`, `state = { data, simStats, settings }`); import only reconstructs `data`
- **Problem:** Export bundles `data` + `simStats` + `settings`, but `processImport` only ever rebuilds `data.nodes/links` (via `normalizeImportedPayload`), silently discarding `simStats` and `settings` on re-import — so export/import is **not** a faithful round-trip and the user is never told. The filename prefix `mdsc_` is project jargon that won't mean anything to a downstream recipient and isn't documented. There's also no schema/version field, so future format changes can't be detected.
- **Fix:** Either restore `simStats`/`settings` on import or rename the export to make clear it is graph-only ("strikesim_graph_…"). Add a `version` field to the exported object and check it on import. Document what the export contains.
- **Effort:** M

## [P2] Team Resources readout is cryptic ("0 pts (KE:0 Cyber:0 JAM:0 SOF:0)") with no meaning or units
- **Where:** StrikeSim2040.html:1233-1245 markup; `recalcTeamResources` :2773 (writes `res-blue`, `res-blue-types`, etc.)
- **Problem:** The panel shows e.g. "Blue 12 pts (KE:4 Cyber:2 JAM:1 SOF:5)" with no explanation of what "pts" are, where they come from (summed `resourceGen` classified by domain/type heuristic at :2783), or what KE/JAM mean. KE and JAM are unexpanded acronyms (kinetic / jamming). The classification is a best-guess (`classifyCategory`) that can mislabel nodes, but the readout presents it as authoritative. A non-expert can't act on this.
- **Fix:** Add a tooltip/subheading: "Resource generation per tick, by capability" and expand acronyms (KE→Kinetic, JAM→EW/Jamming) at least on hover. Note these are estimated from node type/domain. Consider hiding the type breakdown behind a disclosure if it adds noise.
- **Effort:** S

## [P2] "Hide Legend" is a stateful toggle whose label is its only state, and it lives among one-shot actions
- **Where:** StrikeSim2040.html:1172 button; `setLegendVisible`/`toggleLegend` :2880-2888 (swaps label Hide↔Show)
- **Problem:** Same label-as-state pattern as the view buttons but mixed into Quick Actions next to one-shot commands. Table mode also auto-hides the legend and restores it (legendWasVisibleBeforeTable), so the button label can desync from reality after view switches if any path is missed. The legend itself is a display element; controlling it from the same grid as "Strike Selected" muddies the action/toggle distinction.
- **Fix:** Move legend visibility to the legend panel header (a small ✕ / collapse caret on the Legend panel) rather than a Quick Action, and drive its label purely from `legendVisible` state so it can't desync. If kept in Quick Actions, give it an `.active` state instead of label swap.
- **Effort:** S

## [P2] No keyboard/`aria` parity for sidebar toggles; shortcuts list omits half the controls
- **Where:** Shortcut hint at :1224 (M, Shift/Alt+M, R, [ ], Space); keydown handler :3042-3078; toggle buttons lack `aria-pressed`
- **Problem:** The advertised shortcuts cover MC/map/reset/cycle/pause but none of the prominent sidebar toggles (Payoff, Risk, Contrast, Legend, Table, Org, Geo), so power users get an inconsistent model — some toggles are keyboardable, most aren't. None of the toggle buttons expose `aria-pressed`, so assistive tech can't read on/off state (compounds the P1 visual-state issue). "Contrast" in particular is an accessibility feature that is itself inaccessible to state queries.
- **Fix:** Add `aria-pressed` to all toggle buttons and keep it in sync in the toggle handlers. Optionally extend the keyboard map (and the hint line) to the most-used toggles, or at minimum make the hint line accurate about what's covered.
- **Effort:** S
