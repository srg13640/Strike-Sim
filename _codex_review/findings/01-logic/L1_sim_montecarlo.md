# L1 — Monte-Carlo & Sim Statistics
- Dimension: Logic
- Focus: Trial independence, seeding, CIs, percentiles, and inline/worker parity in the COA Monte Carlo engine
- Files inspected: sim.js; sim-worker.js; StrikeSim2040.html; _stark/audits/00-MASTER-FIXLIST.md

## Summary
The current Monte Carlo path has made meaningful progress on trial independence: per-trial seeds are avalanche-mixed before entering the LCG, and the same seed mixer is mirrored in the worker path. The browser UI also records the base seed for traceability and supports a worker-backed execution path when available. The highest remaining logic risks are statistical interpretation issues: the success CI uses a fragile Wald interval, impact/step percentiles are conditional on wins but displayed as general run statistics, and goal-planner step statistics fold failed trials into the distribution. Inline-vs-worker parity remains a structural risk because the simulation engine is duplicated, with a third legacy unseeded Monte Carlo implementation still present in the shell.

## Strengths
- Per-trial seed decorrelation is explicit: `mcMixSeed` avalanches `(base, trialIndex)` before `createRng` consumes it in both shared helpers and worker execution (`sim.js:52`, `sim-worker.js:15`, `sim-worker.js:411`, `StrikeSim2040.html:5048`).
- Trials snapshot graph state instead of mutating live scenario data: `buildSimContext` constructs node and adjacency maps, and each trial builds its own `state` map (`sim.js:85`, `sim.js:113`, `StrikeSim2040.html:3953`).
- Manual MC seeds are normalized and reported, which helps reproduce a run family (`StrikeSim2040.html:4718`, `StrikeSim2040.html:4723`, `StrikeSim2040.html:5141`).
- The worker path serializes aggregate maps back to plain arrays and the main path reconstructs them, preserving node-level odds/damage summaries across thread boundaries (`sim-worker.js:376`, `sim-worker.js:390`, `StrikeSim2040.html:5034`).

## Findings
### L1-01 — Success confidence interval is a Wald interval that collapses at extremes
- Severity: P1   Impact: 4   Effort: S
- Location: `StrikeSim2040.html:5100`
- Observation: The MC UI computes `ciHalf = 1.96 * sqrt(p * (1 - p) / n)` and displays that as the 95% CI (`StrikeSim2040.html:5100`, `StrikeSim2040.html:5102`, `StrikeSim2040.html:5106`). This interval reports zero uncertainty when `successRate` is exactly 0% or 100%, which is plausible at the minimum 100 trials or after a small partial/cancelled run (`StrikeSim2040.html:4927`, `StrikeSim2040.html:5091`). That can make an all-pass/all-fail sample look decision-grade when the real binomial uncertainty is still material.
- Recommendation: Replace the Wald interval with Wilson score or Jeffreys interval for the success proportion. If `completedTrials` is below a decision threshold, label the result as exploratory and suppress precision-heavy wording.
- Tradeoffs/risks: Wilson/Jeffreys intervals will look wider, especially near 0% and 100%, but that is the correct conservative signal for planners.

### L1-02 — Impact and percentile metrics are win-conditioned but presented as run-level statistics
- Severity: P1   Impact: 4   Effort: S
- Location: `StrikeSim2040.html:5061`
- Observation: `successImpacts` and `stepsToSuccessArr` are only populated inside `if (result.success)` (`StrikeSim2040.html:5061`, `StrikeSim2040.html:5065`, `StrikeSim2040.html:5066`). `expImpact` is then computed as `totalImpactOnSuccess / trialsSuccess`, not expected impact across all trials (`StrikeSim2040.html:5093`), and the p50/p90 impact/step widgets are populated from those success-only arrays (`StrikeSim2040.html:5095`, `StrikeSim2040.html:5098`, `StrikeSim2040.html:5107`, `StrikeSim2040.html:5114`). When there are no wins, `percentile` returns `0`, so no-success plans render numeric p50/p90 values rather than `N/A` (`sim.js:76`, `sim.js:77`).
- Recommendation: Track both all-trial impact and win-conditioned impact. Label outputs explicitly, for example `Expected impact, all trials` and `Impact on winning trials`; render win-conditioned percentiles as `N/A` with `n=0 wins` when no successes occur.
- Tradeoffs/risks: This adds a little UI complexity, but prevents low-probability/high-impact COAs from looking stronger than their expected value warrants.

### L1-03 — Goal-plan step statistics count failed trials as if they reached the goal at plan length
- Severity: P1   Impact: 4   Effort: S
- Location: `StrikeSim2040.html:5525`
- Observation: `simulateTrial` returns `stepsToGoal: stepsToGoal ?? actionPlan.length` even when the trial did not satisfy the success condition (`StrikeSim2040.html:4142`, `StrikeSim2040.html:4144`). `evaluateGoalPlan` then pushes `result.stepsToGoal` into `stepsArr` for every trial, regardless of `result.success` (`StrikeSim2040.html:5538`, `StrikeSim2040.html:5550`, `StrikeSim2040.html:5551`), and reports average/p50/p90 from that mixed array (`StrikeSim2040.html:5556`, `StrikeSim2040.html:5558`). A plan that often fails can therefore show attractive step percentiles because failures are treated as completing at the final planned action.
- Recommendation: In `evaluateGoalPlan`, only add `stepsToGoal` to success-time distributions when `result.success` is true. Report separate fields for `successRate`, `avg/p50/p90 steps on successful trials`, and optionally `planned length` for all trials.
- Tradeoffs/risks: Existing goal-planner summaries may look worse, but they will distinguish speed from reliability instead of blending the two.

### L1-04 — Goal-plan candidate evaluation is time-seeded per candidate and not reproducible
- Severity: P2   Impact: 3   Effort: S
- Location: `StrikeSim2040.html:5534`
- Observation: `evaluateGoalPlan` creates a fresh `baseSeed = Date.now() % 2147483647` on every call (`StrikeSim2040.html:5533`, `StrikeSim2040.html:5534`). `findBestGoalPlan` calls `evaluateGoalPlan` while comparing candidate plans (`StrikeSim2040.html:5585`, `StrikeSim2040.html:5586`), so candidates may be judged on different random streams depending on millisecond timing. The selected plan and its displayed stats are therefore not reproducible from the MC seed override path, which is only read in `runMonteCarlo` (`StrikeSim2040.html:4968`, `StrikeSim2040.html:4969`).
- Recommendation: Generate one planner seed at the start of goal-plan search, pass it into every `evaluateGoalPlan` call, and store it with `goalPlanStats`. Use common random numbers for candidate comparison, then optionally run a final independent confirmation sample for the winner.
- Tradeoffs/risks: Common random numbers correlate candidate estimates, but they reduce ranking noise and make human review reproducible.

### L1-05 — Inline, worker, and legacy Monte Carlo engines can drift silently
- Severity: P1   Impact: 4   Effort: M
- Location: `StrikeSim2040.html:3925`; `sim-worker.js:115`
- Observation: The main shell and worker each maintain their own `simulateTrial` implementation (`StrikeSim2040.html:3925`, `sim-worker.js:115`), while `sim.js` explicitly notes that the heavier engine remains in the main script rather than the shared module (`sim.js:9`, `sim.js:14`). A third legacy Monte Carlo implementation still exists in the shell (`StrikeSim2040.html:4176`) and uses `Math.random()` for success and counter-damage rolls (`StrikeSim2040.html:4361`, `StrikeSim2040.html:4438`). Even if the current button path uses the seeded engine, this creates three places where probability, damage, resource, and success semantics can diverge without a parity check.
- Recommendation: Extract a no-build shared simulation core, loaded by the page with a script tag and by the worker with `importScripts`, containing `simulateTrial`, seed mixing, and aggregation helpers. Remove or hard-disable `runMonteCarloLegacy`, and add a deterministic parity smoke check that runs the same seed/plan through inline and worker paths and compares aggregate outputs.
- Tradeoffs/risks: Worker sharing must preserve offline constraints, but `importScripts` plus a vendored local core file fits the current no-bundler architecture.

## Quick wins (top 3 high-impact/low-effort)
1. Swap the success-rate CI from Wald to Wilson/Jeffreys and keep the same UI slot.
2. Render win-conditioned p50/p90 metrics as `N/A` when `trialsSuccess === 0`, and include the number of winning trials next to those percentiles.
3. Change `evaluateGoalPlan` so `stepsArr` only receives values for successful trials, with a separate `plannedSteps` or `trialLength` field if needed.

## Open questions for the human review
- Should the headline impact number represent unconditional expected impact, impact on successful trials, or both?
- Should goal-plan search use the same manual seed field as the MC panel, or maintain its own recorded planner seed?
- Is `runMonteCarloLegacy` intentionally kept for any UI path, or can it be removed/guarded to prevent accidental use?
