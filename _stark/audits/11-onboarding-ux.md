# Audit: Onboarding/UX

Surface: first-run / onboarding / view-switching clarity / intent-first language in `StrikeSim2040.html` (the shell). Test question: can a skeptical general grasp what this is and do something useful in 90 seconds, cold, no manual? Cross-referenced against `reviews/output/backlog.md` items P-01 (plain-language onboarding), P-02 (discoverability), P-03 (COA flow), P-05 (hotkeys/help strip).

Scoring: P0 = blocks "what is this / what do I do first" comprehension; P1 = real confusion or friction in the first 90 seconds; P2 = polish / consistency. Worst-first.

---

## [P0] No first-run explainer card — purpose and "do this first" are buried in the sidebar header

**Where:** Right sidebar `<header>` at `StrikeSim2040.html:1216-1224`. The only orientation copy is `#mission-brief` (line 1223: "Explore the force network, build an attack plan, then run Monte Carlo risk checks before committing.") and the `#control-hints` strip (line 1224). Both live inside `#side`, which the backlog (P-02, `DST2040.HTML:509-527`) notes can be collapsed, and there is no modal/banner that forces a first read.

**Problem:** There is no dismissible, center-stage "what is this / what do I do first" card. A cold user lands on a dark 3D graph (or Map) with a dense sidebar of filters, COA Builder, Monte Carlo, Goal Planner, etc. The single mission-brief sentence is good copy but is one 12px line competing with `#counts`, `#view-status`, and the shortcut strip in the same header — easy to miss entirely. Nothing says "you are Blue, your job is to plan and pressure-test a strike on Red." A skeptical general sees jargon-dense chrome and no narrative entry point.

**Fix:** Add a one-time, dismissible first-run card (overlay or top banner) gated on `localStorage` (there is currently no `firstRun`/`seen-intro` flag anywhere in the file — confirmed by search). Three short lines: (1) "StrikeSim 2040 is a Blue-vs-Red strike planner. You explore the force network, build an attack plan (a 'COA'), then run thousands of simulations to see if it's worth committing." (2) A 3-step "Try this": *Pick a Red target → Generate COA → Run 10,000 Trials*, each linking to the relevant control. (3) "Got it" to dismiss + a small persistent "?" to reopen. Keep it offline (no images required).

**Effort:** M

---

## [P0] Active view is signalled only by a label-swapping button — three buttons can all read "3D" at once

**Where:** View toggles at `StrikeSim2040.html:1169-1173` (`map-btn`, `table-btn`, `org-btn`, `geo-mode-btn`). Toggle logic swaps `textContent` only: `toggleMapMode` (line 2833 sets "3D"/"Map"), `toggleTableMode` (line 2875 sets "3D"/"Table"), org toggle (lines 2918/2922), Geo (lines 1908/1918). No `.active`/`aria-pressed` styling is applied to these buttons (searched: only tabs and MC presets use `.active`).

**Problem:** This is backlog M-02 ("appears to do nothing because state is communicated only by button text"). When Map is active, `map-btn` reads "3D" — which a new user reads as "this is the 3D button," the exact opposite of its state. Worse, when off, `map-btn`, `table-btn`, and `org-btn` can all read their own labels, but once you enter Map, the Map button says "3D" while Table/Org still say "Table"/"Task Org" — there is no single highlighted "you are here" control. The `#view-status` badge (line 1222, good) partially mitigates this, but it sits in the collapsible sidebar header, so the only on-canvas signal is an ambiguous button label.

**Fix:** Make the active view button visually pressed (`.active` outline/fill + `aria-pressed="true"`) and keep labels STABLE — `Map` always says "Map," highlighted when active; do not relabel it "3D." Use a single mutually-exclusive view switcher (segmented control: 3D / Map / Table / Task Org) so exactly one is lit at a time. Keep the `#view-status` badge as the redundant text cue.

**Effort:** M

---

## [P0] Branding is inconsistent across the product — title, README, and folder disagree on the name

**Where:** `<title>StrikeSim 2040 — Indo-Pacific Multi-Domain Wargaming` (line 13) and `<h1 id="app-title">StrikeSim 2040</h1>` (line 1217), vs `README.md` opening "# MDSC 3D Network Visualizer", vs project folder / task "Strike Sim", vs legacy "DST2040.HTML" references throughout `reviews/output/backlog.md`.

**Problem:** Four names for one tool: "StrikeSim 2040," "MDSC 3D Network Visualizer," "Strike Sim," and "DST2040." A skeptical evaluator opening the README expects "MDSC" and meets "StrikeSim 2040" in the app — it reads as an unfinished rename or two merged projects, which corrodes credibility before any feature is judged. "MDSC" itself is an unexpanded acronym (P-01 flags MDSC as jargon).

**Fix:** Pick one product name (recommend "StrikeSim 2040" since it is the user-facing title and is intent-bearing) and make README, START_HERE, and docs match. Add a one-line expansion/subtitle once: "StrikeSim 2040 — a multi-domain strike-planning wargame." Retire "MDSC" and "DST2040" from user-facing copy or define MDSC in a glossary on first use.

**Effort:** S

---

## [P1] Heavy jargon in headings/labels with no glossary or tooltips on the terms themselves

**Where:** Sidebar headings/labels: "COA Generator" (1277), "COA Builder" (1282), "Monte Carlo Simulation" (1314), method options "EW Jamming" / "SOF Mission" (1293-1294), "High Payoff" / "High Risk" buttons (1175-1176), and result labels "Impact P50/P90," "Typical Impact (wins)" (1382-1399). Buttons have `title=` tooltips (lines 1168-1177, good), but the technical *terms* (COA, Monte Carlo, MDSC, EW, SOF, payoff, p50/p90) have no inline definition.

**Problem:** P-01. "COA" appears in three section names before it is ever expanded ("Course of Action"). "Monte Carlo," "EW," "SOF," "payoff," "p50" are domain shorthand a general knows but a first-time *operator* of the tool may not map to the buttons. There is no glossary and no hover affordance on the words.

**Fix:** (1) Expand on first use in headings: "COA Generator (Course of Action)," "Monte Carlo Simulation — pressure-test the plan." (2) Add a lightweight glossary: dotted-underline the first occurrence of each term with a `title=`/`<abbr>` tooltip ("EW = Electronic Warfare," "p90 = 9-in-10 outcome"). (3) Rename intent-first where possible per P-01: "COA Generator" → "Build Attack Plan," "Run 10,000 Trials" already reads well; "High Payoff"/"High Risk" → "Show high-value targets"/"Show risky targets."

**Effort:** M

---

## [P1] No single guided "try this" path — the first action is left to the user to discover

**Where:** Mission brief sentence (line 1223) describes the flow but is not actionable; primary entry points are scattered: "Generate COA" (1278) in one section, "COA Builder" target/method selects (1281-1311) in another, "Run 10,000 Trials" (1321) in a third. The MC interpretation strip (1421-1424) does helpfully say "Build or generate an attack plan, then run trials" with a "Generate COA" button — the one good guided nudge in the UI.

**Problem:** P-03 / P-02. The recommended flow (explore → plan → simulate) spans three separate panels with no numbered, linked path. A cold user does not know that "Generate COA" must precede "Run Trials," or that the COA Wizard (`coa-wizard-modal`, 1024) is the easy on-ramp vs. the manual COA Builder. The mission brief tells them the order in prose but gives no clickable next step.

**Fix:** Promote the existing MC-interpretation pattern into a top-of-sidebar "Get started" stepper: **1. Pick a target → 2. Generate COA (opens Wizard) → 3. Run trials**, each step a button that lights up the relevant control and checks off as completed. Reuse `openCOAWizard()` (line 4857) for step 2. This directly satisfies P-03's "single guided entry point with state badge."

**Effort:** M

---

## [P1] Orientation copy and view badge live inside a collapsible sidebar — can vanish on first interaction

**Where:** `#view-status` (1222), `#mission-brief` (1223), `#control-hints` (1224) are all children of `#side`'s `<header>`. `#side` has a collapse handle (`right-panel-handle`, 1213) and a "Collapse" button (1219). `#view-status` CSS at lines 711-722.

**Problem:** The three pieces of onboarding scaffolding — what-is-this, the only persistent view indicator, and the shortcut legend — disappear together the moment the operator collapses the sidebar (a natural move to see the map). After that, active-view state reverts to the ambiguous button labels (see P0 above) and there is no on-canvas reminder of purpose or shortcuts.

**Fix:** Move the `#view-status` badge (and ideally a compact shortcut affordance) to a persistent on-canvas location (top-left of the graph/map surface, alongside the existing "Retry 3D" button slot at lines 3358-3372) so it survives sidebar collapse. Keep the mission brief in the header but ensure at least the view badge is always visible.

**Effort:** S

---

## [P1] Shortcut strip is static text with ambiguous entries and low discoverability

**Where:** `#control-hints` (1224): "Shortcuts: M=Run MC · Shift/Alt+M=Map · R=Reset · [ ]=Target · Space=Pause". CSS lines 728-737.

**Problem:** P-05 asks for a "discoverable help strip" — this exists (good), but: (1) "M=Run MC" uses the unexpanded "MC"; (2) "[ ]=Target" is cryptic (prev/next target? cycle? select?); (3) "Space=Pause" implies a running sim the user may not have started yet; (4) it is plain text, not discoverable via a "?" or "Shortcuts" affordance, and collapses with the sidebar (see above). A general scanning for "how do I drive this" gets a terse legend with no map to what each does.

**Fix:** Add a "?" / "Shortcuts" button (e.g., near the header actions, line 1218) that opens a small cheat-sheet overlay. Expand ambiguous entries: "M = Run simulation," "[ / ] = Previous / Next target," "Space = Pause/step simulation." Optionally gray out Space/pause until a sim is running so the legend matches available state.

**Effort:** S

---

## [P1] WebGL-fallback landing is well-handled but leans on a transient toast for the explanation

**Where:** `webglAvailable()` (3279), landing branch in `init()` (3409-3415), `degradeToMap()` (3335-3356), Retry-3D button (3358-3372). Fallback toast at line 3413 (11s), retry toast at 3381.

**Problem:** The framing is genuinely good (M-01/M-02 addressed): the app opens Map when WebGL is absent, logs an event, shows a "Retry 3D" button, and explains via toast. The remaining gap is that the *explanation* of why you are on Map (and that Map is the full picture, not a degraded mode) is an 11-second toast — a user who looks away misses it, and afterward the only cue is the `#view-status` badge reading "View: Map," which does not say "this is intentional / fully featured." A skeptical evaluator on a remote/VDI display (common in this audience) may conclude "the 3D is broken" rather than "3D needs hardware accel."

**Fix:** When landing in the WebGL-fallback path, show a persistent (dismissible) inline note on the map surface — "Opened in Map view (full picture). 3D needs browser hardware acceleration — [Retry 3D]" — instead of relying only on the timed toast. Reuse the Retry-3D button styling/slot.

**Effort:** S

---

## [P2] "COA Generator" button vs "COA Builder" vs "COA Wizard" — three overlapping COA entry points

**Where:** "COA Generator" section + `generate-coa-btn` (1276-1279) which actually opens the *Wizard* (`openCOAWizard`, bound at 3107); separate "COA Builder" panel with manual target/method/add-step controls (1281-1311); "COA Wizard" modal title (1026).

**Problem:** P-03. Three differently named surfaces for one concept. "Generate COA" opens a "Wizard," while a parallel "COA Builder" lets you hand-assemble the same plan — a new user cannot tell which to use or whether they conflict. Naming does not communicate the relationship (wizard = guided, builder = manual, generator = ?).

**Fix:** Collapse to one labeled flow. Rename `generate-coa-btn` to "Build Attack Plan (guided)" and the manual panel to "Attack Plan — Manual," or fold the manual builder behind an "Advanced" accordion under the wizard (progressive disclosure, per backlog decision). Make one the obvious default path from the get-started stepper (P1 above).

**Effort:** S

---

## [P2] Geo Mode is an unexplained expert toggle on the primary action list

**Where:** `geo-mode-btn` "Geo Mode" / "Exit Geo" (1173, 1908, 1918), among the Quick Actions list alongside Strike/Reset/Map/Table.

**Problem:** "Geo Mode" sits in the first-tier Quick Actions but its purpose ("pin nodes to real lat/lon on the globe") is only in a `title=` tooltip. To a cold user it competes for attention with genuinely primary actions and reads as jargon. It is an expert/diagnostic view per the backlog's progressive-disclosure decision, not a first-90-seconds action.

**Fix:** Relabel to intent-first ("Pin to real-world map") and/or move it out of the primary Quick Actions into the Map-related controls or an "Advanced views" group, so the default action set stays to the 3-4 primary actions P-02 calls for.

**Effort:** S

---

## [P2] Result-metric labels mix plain language and statistical shorthand inconsistently

**Where:** MC results grids at `StrikeSim2040.html:1368-1417` — good plain labels ("Chance of Success," "Avg Friendly Lost") sit next to "Typical Impact (wins)," "Strong Impact (wins)," "9 out of 10 Done By," and the `mc-impact-p50`/`p90`/`steps-p50`/`p90` ids.

**Problem:** The translation effort is real and mostly good (P-04 partially addressed), but the mix is uneven: "Typical/Strong Impact (wins)" and "9 out of 10 Done By" are friendly, while neighboring "Avg Blue Spend"/"Avg Red Spend" assume the reader knows Blue=friendly, Red=enemy. A first-time reader has to hold the Blue/Red convention and the percentile gloss in their head at once.

**Fix:** Normalize all result labels to the friendly register and define Blue/Red once near the top (the first-run card is the natural place). Add a small "?" on the results header linking to "How to read these numbers" (this also satisfies P-04's interpretation goal).

**Effort:** S

---

## Summary of cross-references

- **P-01** (plain-language onboarding): addressed by P0 first-run card, P0 branding, P1 jargon/glossary.
- **P-02** (discoverability): addressed by P0 active-view, P1 get-started stepper, P2 Geo demotion.
- **P-03** (COA flow): addressed by P1 stepper, P2 three-COA-entry-points consolidation.
- **P-05** (hotkeys/help strip): the strip exists; P1 shortcut item proposes expansion + a discoverable "?" overlay.

Note: line numbers cite the current shell `StrikeSim2040.html`; backlog uses the legacy `DST2040.HTML` filename for the same file.
