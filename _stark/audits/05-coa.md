# Audit: COA tools

Scope: the Course-of-Action surface in `StrikeSim2040.html` — the "COA Generator" button, the COA Builder (Target/Method selectors, Recommend Next Step, Add to Plan, Planned Steps, Clear Plan, Simulate Plan), and the goal-planning helpers (`generateCOA`, `buildGoalPlan`, `findBestGoalPlan`, `evaluateGoalPlan`, `recommendNextStep`, `simulatePlanOnce`). Audited for operator flow, state/badge clarity, label honesty, target/method correctness, and highlight sync.

---

## [P0] "beam search" naming over-promises — it is a stochastic restart sampler, not a beam search
**Where:** `findBestGoalPlan()` ~5111-5139; param `beam` plumbed from `goal-beam` input (HTML label "Candidate plans", line 1450-1451) and from `goal-plan-btn` handler ~3146.
**Problem:** `findBestGoalPlan` builds `beam` candidate plans by **randomly shuffling the target order** (`targetIds.slice().sort(() => rng.next()-0.5)`) and feeding each to `buildGoalPlan`, then keeps the single best by evaluated success rate. There is no frontier, no per-step expansion of top-k partial plans, no pruning — it is independent random restarts (a stochastic sampler). Calling the variable `beam` and the backlog/code referring to "beam search" mis-states the algorithm to anyone reading code or briefing the tool's rigor. (The user-facing HTML label already says "Candidate plans," which is correct — the internal naming is the liar.) The shuffle via `sort(()=>rng.next()-0.5)` is also a biased shuffle (not Fisher–Yates), so candidate diversity is skewed.
**Fix:** Rename the variable and any "beam" references to `candidates`/`numCandidates` (matching the UI). Either (a) implement a real beam search (expand top-k partial plans step-by-step, score by expected progress, keep k best) and keep the name, or (b) keep the sampler and drop the "beam" word entirely — do not claim search rigor the code does not deliver. Replace `sort(()=>rng.next()-0.5)` with a proper Fisher–Yates shuffle on `rng`.
**Effort:** S (rename + shuffle fix) / M (real beam search).

## [P0] No Draft/Building/Running state or badge anywhere in the COA flow
**Where:** COA Builder panel HTML 1281-1311; `simulatePlanOnce` ~5365; goal planner handler ~3140-3158.
**Problem:** There is no visible plan state. The operator cannot tell whether the plan is Draft (unsimulated), Running (sim in flight), or has a Stale result (plan edited after last sim). `simulatePlanOnce` and `findBestGoalPlan` both run **synchronously on the main thread** (no worker for the single-run/goal path), so for large trial counts the UI silently freezes with no spinner, disabled button, or "Running…" badge — the operator may click again or assume it hung. After a sim, editing the plan (Add/Remove/Clear) does not invalidate the displayed `mc-report` result, so a stale outcome can be briefed as current.
**Fix:** Add a status badge to the COA Builder header with states Draft / Running / Result (fresh) / Result (stale). Set Running and disable Simulate while a run is in flight; on any plan mutation (`addCOAStep`/`removeCOAStep`/`clearCOAPlan`) mark the last result stale and either dim or clear the report. Consider deferring `findBestGoalPlan`/`simulatePlanOnce` heavy loops to `requestAnimationFrame`/worker so the badge can paint.
**Effort:** M

## [P0] "Simulate Plan" button does NOT simulate the built plan — it runs an unrelated Monte Carlo of `lastCOA`
**Where:** binding at ~3197: `coa-simulate-plan-btn` → `runMonteCarlo(getMcTrialCount())`. Single-run preview lives separately at `run-single-btn` → `simulatePlanOnce` (~3115).
**Problem:** The button labeled "Simulate Plan" inside the COA Builder calls `runMonteCarlo`, which simulates whatever is in `lastCOA` / the global plan, not necessarily the `builtCOA` the operator just assembled. `builtCOA` is only pushed into `lastCOA` in specific paths (goal-apply ~3166, `showCOAModal` ~4819), so a plan built step-by-step in the Builder and then "Simulate Plan"-d may run a different/empty/old plan with no warning. Meanwhile the function that actually simulates `builtCOA` (`simulatePlanOnce`) is bound to a different button. This is the single most confusing transition in the surface: the obvious "build → Simulate Plan → read result" path is mis-wired.
**Fix:** Make `coa-simulate-plan-btn` first sync `builtCOA` into the canonical plan (build the action plan from `builtCOA`, as `simulatePlanOnce` does via `toActionPlanFromBuilt`) and guard for an empty `builtCOA` with a clear message. Decide one source of truth (`builtCOA`) and have both single-run and Monte Carlo read from it. Audit every writer of `lastCOA` to confirm they stay in sync with `builtCOA`.
**Effort:** M

## [P1] `recommendNextStep` is not greedy-correct — it picks the highest-probability method, ignoring damage, cost, and remaining health
**Where:** `recommendNextStep()` ~4233-4240 → `bestMethodFor()` ~4223-4231.
**Problem:** `bestMethodFor` chooses the method with the **highest single-shot probability** (`strikeProbFor`) only. It ignores per-method damage (`baseDamage`), cost, and the target's current health — so it can recommend a high-p but low-damage method (e.g. EW jamming) over a kinetic strike that would actually neutralize the node, and it never accounts for "expected progress per cost." Contrast `bestMethodForTarget` (~4768) used by the goal planner, which correctly scores `dpt/cost`. The Builder's "Recommend Next Step" therefore gives operators a weaker recommendation than the goal planner's internal logic, and "greedy-correct" it is not.
**Fix:** Have `recommendNextStep` reuse `bestMethodForTarget`/`expectedDamageFor` (expected damage per cost, capped at remaining health) rather than raw probability. Align Builder recommendations with the goal-planner's method-selection logic so the tool is internally consistent.
**Effort:** S

## [P1] Target dropdown is unsorted and "active" is health-blind — neutralized-but-not-flagged nodes can appear
**Where:** `populateCOATargets()` ~4201-4206; `getActiveRedNodes()` ~4197-4199.
**Problem:** The Target (Red) dropdown lists active red nodes in raw `data.nodes` order — **not sorted by value/importance** — so the operator must hunt for the high-payoff target instead of seeing it first. "Active" is defined purely as `status !== 'Neutralized'`; the sim engine elsewhere treats `health <= 0` as dead (lines 3573, 3957). A node driven to 0 health but whose `status` string was not updated will still appear as a selectable, "alive" target. The dropdown also shows no value cue (importance/cascade/health), so the operator picks blind.
**Fix:** Sort options by `scoreTarget(n)` descending and annotate each with a value/health hint (e.g. `Name (ID) — val 84, hp 30`). Make `getActiveRedNodes` also exclude `health <= 0`, or normalize status whenever health hits 0 so the two notions of "dead" cannot diverge.
**Effort:** S

## [P1] Goal planner targets a fixed top-N set and never excludes already-neutralized nodes
**Where:** `getTopPayoffRedIds()` ~4760-4766, used by `findBestGoalPlan` ~5120.
**Problem:** `getTopPayoffRedIds` filters only `n.team === 'red'` — it does **not** exclude neutralized nodes. So the goal planner can spend steps "targeting" nodes that are already dead, wasting plan budget and inflating/deflating the success math (the priority set passed to `evaluateGoalPlan` includes corpses). It also scores by `importance * cascScore` only, omitting `resourceGen` that `scoreTarget` (the Builder's own heuristic) considers — two different "value" definitions across the same surface.
**Fix:** Filter `status !== 'Neutralized' && health > 0` in `getTopPayoffRedIds`. Unify the value heuristic with `scoreTarget` (or document why they differ) so the Generator, Builder dropdown, and goal planner all rank targets the same way.
**Effort:** S

## [P1] COA-result highlight does not sync to the data table (only 3D graph + 2D map)
**Where:** `simulatePlanOnce` ~5375-5378 sets `highlightMode='coa'`, calls `applyHighlight()` then `refreshMapMarkers()`. `applyHighlight()` ~2677-2711 recolors `graphInstance` (3D) and the legend only.
**Problem:** The prompt asks whether the COA highlight set syncs to map/table/3D. It updates the 3D graph (via `graphInstance.nodeColor`) and the 2D map (explicit `refreshMapMarkers()` call), but **the node/data table is not re-rendered or row-highlighted** to mark which red nodes the COA neutralized. An operator reading the table after a sim sees no indication of the COA outcome there, breaking cross-view consistency. Also, the COA highlight is set inside `simulatePlanOnce` (single-run preview) but the full Monte Carlo / "Simulate Plan" path does not establish the same `highlightMode='coa'` set, so highlight presence depends on which button was used.
**Fix:** In `applyHighlight` (or its callers), also apply a row/marker highlight to the table for the current `highlightSet` when `highlightMode==='coa'`. Ensure the Monte Carlo path sets a comparable highlight (e.g. nodes neutralized above the highlight-threshold) so all three views agree regardless of entry point.
**Effort:** M

## [P1] "Generate COA" label is ambiguous and the legacy `generateCOA`/`showCOAModal` path is dead code
**Where:** button `generate-coa-btn` HTML 1278; binding ~3107 → `openCOAWizard`. Legacy `generateCOA()` ~4737, `showCOAModal()`/`recommendCOAForHighPayoff()` ~4792-4840, `simulateCOA()` ~4847 ("Placeholder for simulate COA").
**Problem:** The "COA Generator" section's single button opens a multi-step **wizard**, not a one-click generate — the label sets the wrong expectation (operator expects an instant COA, gets a modal flow). Meanwhile `generateCOA` (purely random blue/red action strings), `showCOAModal`, `recommendCOAForHighPayoff`, and `simulateCOA` ("Placeholder") appear to be orphaned legacy code with no live binding, confusing future maintainers and risking accidental re-wiring to the random generator. `generateCOA` produces meaningless random `coaActions` pairs with no relation to the sim — exactly the kind of fake output that erodes trust if ever surfaced.
**Fix:** Relabel the button to "COA Wizard" (or "Generate COA…" with ellipsis to signal a flow). Delete or clearly quarantine the dead `generateCOA`/`showCOAModal`/`simulateCOA` legacy block, or wire the section to a genuine one-click generate that uses `findBestGoalPlan`. Do not leave a random-string generator one binding away from production.
**Effort:** S

## [P2] Single-sample "Preview Outcome" can mislead despite the caveat; success rule is hidden
**Where:** `simulatePlanOnce` report ~5383-5398.
**Problem:** The preview runs **one** stochastic trial and reports "meets/misses the current success rule," with a muted caveat to use Monte Carlo. The plain-language framing is good, but: (a) the "current success rule" (mode/N from `mc-success-mode`/`mc-success-n`) is never shown in the preview, so the operator does not know what bar was tested; (b) a single sample flips pass/fail run-to-run, so an operator clicking twice sees contradictory "What this means" verdicts with no seed shown. This undercuts the otherwise-good interpretation strip.
**Fix:** Print the active success rule in the preview ("Rule: neutralize ≥3 priority nodes within budget"). Show the seed used, and/or run a small fixed batch (e.g. 20 trials) for the preview so the verdict is stable. Keep the Monte Carlo caveat.
**Effort:** S

## [P2] Goal-planner result is numbers-only with no recommended next action
**Where:** `renderGoalPlan()` ~5141-5158.
**Problem:** The goal-plan summary is a stat line ("Success ~62% · Avg steps 8.3 (p50 8, p90 11) · Avg blue lost 1.4 (limit 2)") plus a step list. There is **no plain-language interpretation** ("what this means / recommended next action") the way `simulatePlanOnce` provides an interpretation strip and the MC report provides `data-mc-action` buttons. The operator gets percentages but no "this plan is viable, apply it" / "success too low, raise steps or relax blue-loss limit" guidance, so the decision-support loop is incomplete here.
**Fix:** Add an interpretation strip to `renderGoalPlan` mirroring the MC report: classify the result (viable / marginal / not viable vs a threshold) and surface a concrete next action ("Apply to Builder," "Increase Max Steps," "Relax friendly-loss limit"). Reuse the existing interpretation-strip styling for consistency.
**Effort:** S

## [P2] Per-step probabilities shown in the Builder are single-shot and ignore plan context / cumulative health
**Where:** `updateCOAListUI()` ~4257-4268 (`${p}% est` per step); `addCOAStep` hint ~3193.
**Problem:** Each planned step shows `(p% est)` from `strikeProbFor` — the **independent single-shot** probability against the node's *current* health, ignoring earlier steps in the same plan that already damaged/neutralized that target. So a plan with three kinetic strikes on one node shows the same per-step % three times, and an operator may read "85%" on a step whose target is already predicted dead by step 1. The number looks authoritative but is plan-context-blind.
**Fix:** Either compute per-step probability against predicted remaining health (as `buildGoalPlan` already tracks via `predictedHealth`) so later steps reflect prior damage, or relabel to "method base %" so the operator knows it is not the in-plan hit chance. Prefer the former for honest decision support.
**Effort:** M

## [P2] No empty/edge-state guidance and minor dead-feel transitions
**Where:** `populateCOATargets` (empty dropdown when no reds), `recommendNextStep` null path ~3178, goal-apply enabling ~3157.
**Problem:** When all red nodes are neutralized, the Target dropdown renders **empty** with no "No remaining enemy nodes" placeholder, and "Add to Plan"/"Recommend Next Step" silently no-op (Recommend shows a hint, but Add to Plan ~3186-3190 just `return`s with no feedback — a dead-feeling click). The "Apply to Builder" goal button is disabled until a plan is generated, which is fine, but nothing tells the operator *why* it is disabled. These small dead transitions make the surface feel unresponsive at exactly the moments an operator needs reassurance.
**Fix:** Render a disabled "No remaining enemy nodes" option when `getActiveRedNodes()` is empty and disable Add/Recommend accordingly. Give "Add to Plan" an explicit hint when it cannot add. Add a tooltip/hint explaining the disabled Apply button.
**Effort:** S
