# F3 — COA Tools Functionality
- Dimension: Functionality
- Focus: COA builder/generator/wizard/goal-planner correctness and wiring
- Files inspected: StrikeSim2040.html, sim.js, _stark/audits/00-MASTER-FIXLIST.md

## Summary
The COA toolchain has a useful offline-first foundation: the UI exposes manual planning, wizard planning, goal-based search, Monte Carlo validation, and single-run preview without depending on a build system or remote service. The current implementation is materially better than the older audit note for the standalone goal planner because applying a goal plan now sets Monte Carlo to node-based criteria. The remaining risks are mostly state/wiring problems: buttons can execute stale plans, wizard preview state can diverge from final inputs, and the friendly-loss constraint used during goal search is dropped during validation. These are high-leverage fixes because they affect whether the operator can trust build -> simulate -> brief as a single decision-support flow.

## Strengths
- `sim.js` keeps the reusable simulation primitives isolated and publishes the legacy globals needed by the inline shell, which preserves the no-build/offline architecture while giving the engine a cleaner base (`sim.js:4`, `sim.js:16`, `sim.js:116`).
- The live Monte Carlo path prefers `builtCOA` before falling back to `lastCOA`, so normal manual builder use no longer always simulates the last generated sequence (`StrikeSim2040.html:4936`, `StrikeSim2040.html:4937`, `StrikeSim2040.html:4941`).
- The standalone Goal Planner runs candidate plans through the same `simulateTrial()` engine with `successMode: 'goal'`, a priority set, and the operator's max-friendly-loss value during search (`StrikeSim2040.html:5525`, `StrikeSim2040.html:5540`, `StrikeSim2040.html:5543`, `StrikeSim2040.html:5546`).
- Applying a standalone goal plan now pushes the result into the COA Builder and sets Monte Carlo to node-based success criteria rather than leaving the default impact threshold in place (`StrikeSim2040.html:3553`, `StrikeSim2040.html:3557`, `StrikeSim2040.html:3558`).

## Findings
### F3-01 — Simulate Plan can still run a stale generated plan after the builder is cleared
- Severity: P1   Impact: 5   Effort: S
- Location: `StrikeSim2040.html:3587`, `StrikeSim2040.html:4687`, `StrikeSim2040.html:4936`
- Observation: The COA Builder's `Simulate Plan` button calls the global Monte Carlo runner (`StrikeSim2040.html:3587`). Clearing the builder only sets `builtCOA = []` and refreshes the list (`StrikeSim2040.html:4687`, `StrikeSim2040.html:4688`, `StrikeSim2040.html:4689`). The Monte Carlo runner then falls back from empty `builtCOA` to any non-empty `lastCOA` and labels it as the last generated plan (`StrikeSim2040.html:4936`, `StrikeSim2040.html:4937`, `StrikeSim2040.html:4941`, `StrikeSim2040.html:4944`). That means a user can clear the visible plan and still get results for an older hidden COA, which matches the prior master fixlist concern about stale/empty plan simulation (`_stark/audits/00-MASTER-FIXLIST.md:29`, `_stark/audits/00-MASTER-FIXLIST.md:30`).
- Recommendation: Split the builder button into a strict `simulateBuiltPlan()` path that refuses to run unless `builtCOA.length > 0`, or clear/null `lastCOA` when the visible builder is cleared. Keep fallback-to-`lastCOA` only for the separate Monte Carlo panel button, and surface the source plan explicitly in the results header.
- Tradeoffs/risks: If users rely on `lastCOA` after clearing the builder, the UI needs a separate `Restore last generated COA` affordance instead of silent fallback.

### F3-02 — Wizard finalization can apply a stale preview after step-4 inputs change
- Severity: P1   Impact: 4   Effort: S
- Location: `StrikeSim2040.html:1409`, `StrikeSim2040.html:5348`, `StrikeSim2040.html:5760`
- Observation: Step 4 includes live planning inputs for `Use goal-based planner` and `Planner trials` (`StrikeSim2040.html:1409`, `StrikeSim2040.html:1410`, `StrikeSim2040.html:1412`, `StrikeSim2040.html:1413`). The preview/cache is generated only when moving from step 3 to step 4 (`StrikeSim2040.html:5348`, `StrikeSim2040.html:5349`, `StrikeSim2040.html:5351`). Finalization collects current inputs, including the step-4 toggle/trials (`StrikeSim2040.html:5387`, `StrikeSim2040.html:5388`), but if `coaWizardPlanCache` already exists it does not regenerate the plan and applies the old cached steps (`StrikeSim2040.html:5760`, `StrikeSim2040.html:5761`, `StrikeSim2040.html:5763`, `StrikeSim2040.html:5766`). A user can therefore toggle goal-planner mode or change trials in the preview step and generate a plan whose criteria reflect the new inputs but whose steps were produced under the old inputs.
- Recommendation: Always regenerate from current `collectWizardInputs()` inside `finalizeCOAFromWizard()` before applying, or invalidate `coaWizardPlanCache` on every wizard input change. The simplest safe fix is to make `finalizeCOAFromWizard()` call `generatePlanFromWizard(conf)` directly and then render/apply that result.
- Tradeoffs/risks: Regenerating on final click can add latency for high trial counts, so disable the button and show a short `Generating...` state while it runs.

### F3-03 — Goal Planner drops the friendly-loss constraint during post-apply validation
- Severity: P1   Impact: 4   Effort: M
- Location: `StrikeSim2040.html:1757`, `StrikeSim2040.html:5540`, `StrikeSim2040.html:3557`, `StrikeSim2040.html:5003`
- Observation: The Goal Planner asks the operator for `Max blue losses` (`StrikeSim2040.html:1757`, `StrikeSim2040.html:1758`) and passes that value into `findBestGoalPlan()` (`StrikeSim2040.html:3532`, `StrikeSim2040.html:3533`, `StrikeSim2040.html:3543`). During search, `evaluateGoalPlan()` calls `simulateTrial()` with `successMode: 'goal'`, the priority target set, and `maxBlueLoss` (`StrikeSim2040.html:5540`, `StrikeSim2040.html:5543`, `StrikeSim2040.html:5545`, `StrikeSim2040.html:5546`), and the simulator only enforces friendly losses in `goal` mode (`StrikeSim2040.html:4021`, `StrikeSim2040.html:4025`). After applying the plan, however, the UI switches Monte Carlo to `nodes` mode (`StrikeSim2040.html:3557`) and the main Monte Carlo worker payload hard-codes `maxBlueLoss: Infinity` (`StrikeSim2040.html:5002`, `StrikeSim2040.html:5003`); the main-thread fallback also calls `simulateTrial()` without a max-loss constraint (`StrikeSim2040.html:5049`, `StrikeSim2040.html:5052`, `StrikeSim2040.html:5055`, `StrikeSim2040.html:5057`). The validation run can therefore report a successful applied COA that violates the exact friendly-loss cap used to pick it.
- Recommendation: Preserve goal-planner metadata when applying a plan: target set, target count, and max friendly loss. Add a real Monte Carlo `goal` validation mode or pass `maxBlueLoss` through `nodes` validation and reporting so the post-apply result answers the same question the planner optimized.
- Tradeoffs/risks: Existing Monte Carlo reports may show lower success rates once friendly-loss constraints are enforced; that is a correctness improvement but should be called out in the UI copy.

### F3-04 — Standalone Goal Planner is silently controlled by hidden wizard resource-mix fields
- Severity: P2   Impact: 3   Effort: S
- Location: `StrikeSim2040.html:1749`, `StrikeSim2040.html:1388`, `StrikeSim2040.html:3537`
- Observation: The visible Goal Planner panel only exposes target count, max blue losses, max steps, trial count, and candidate-plan count (`StrikeSim2040.html:1749`, `StrikeSim2040.html:1753`, `StrikeSim2040.html:1757`, `StrikeSim2040.html:1761`, `StrikeSim2040.html:1765`, `StrikeSim2040.html:1769`). Its click handler nevertheless builds `mixPct` from `coa-w-mix-*` inputs (`StrikeSim2040.html:3537`, `StrikeSim2040.html:3538`, `StrikeSim2040.html:3539`, `StrikeSim2040.html:3540`, `StrikeSim2040.html:3541`), which are wizard step-3 fields inside the separate COA Wizard modal (`StrikeSim2040.html:1388`, `StrikeSim2040.html:1391`, `StrikeSim2040.html:1392`, `StrikeSim2040.html:1393`, `StrikeSim2040.html:1394`). As a result, standalone goal-plan generation can be changed by stale hidden wizard values that are not visible in the Goal Planner panel.
- Recommendation: Give the Goal Planner its own visible method-mix controls, or make it use an explicit default/team-resource-derived mix independent of wizard DOM state. If the intended behavior is shared mix state, label and synchronize it deliberately in both panels.
- Tradeoffs/risks: Duplicating mix controls adds UI surface area; a shared state object is cleaner than reading hidden modal inputs directly.

### F3-05 — Legacy generated-COA modal/generator code is disconnected from the current Generate COA entry point
- Severity: P2   Impact: 2   Effort: S
- Location: `StrikeSim2040.html:1321`, `StrikeSim2040.html:1595`, `StrikeSim2040.html:3497`, `StrikeSim2040.html:5267`
- Observation: The HTML still defines a `Generated Course of Action` modal with a `Simulate COA` button (`StrikeSim2040.html:1321`, `StrikeSim2040.html:1323`, `StrikeSim2040.html:1327`) and still binds that modal's close/simulate buttons (`StrikeSim2040.html:3498`, `StrikeSim2040.html:3499`). The visible `Generate COA` button is now wired to `openCOAWizard` (`StrikeSim2040.html:1595`, `StrikeSim2040.html:1597`, `StrikeSim2040.html:3497`), while the older high-payoff generator/modal function remains defined separately (`StrikeSim2040.html:5267`, `StrikeSim2040.html:5268`, `StrikeSim2040.html:5272`). In the inspected file, the current entry point no longer routes to that generated-COA modal path, so the product carries two generator concepts but only one reachable path.
- Recommendation: Either remove/retire the legacy generated-COA modal path, or expose it intentionally as `Quick Generate` next to the wizard. If retained, make both entry points apply the same success-criteria alignment and plan-source labeling.
- Tradeoffs/risks: Removing the legacy path is safest for correctness, but a fast one-click generator could still be useful if explicitly separated from the guided wizard.

## Quick wins (top 3 high-impact/low-effort)
1. Make `coa-simulate-plan-btn` simulate only `builtCOA`; clear `lastCOA` or expose it as a separate restoreable generated plan.
2. Regenerate the wizard plan from current inputs inside `finalizeCOAFromWizard()` before assigning `builtCOA`.
3. Carry `maxBlueLoss` and the planned target set into Monte Carlo validation after applying a goal plan.

## Open questions for the human review
- Should `Generate COA` mean the guided wizard only, or should there be a separate one-click `Quick Generate` path?
- Is the Goal Planner supposed to optimize against the wizard resource mix, the current Blue resource inventory, or a standalone planner mix?
- Should friendly-loss caps be treated as hard pass/fail criteria in all node-based Monte Carlo modes, or only in explicit goal-plan validation?
