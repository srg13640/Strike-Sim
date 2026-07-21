# Audit: Monte Carlo

Scope: the COA Monte Carlo engine — `runMonteCarlo` / `simulateTrial` / `runMonteCarloInWorker` in `StrikeSim2040.html`, plus `sim.js` (`createRng`, profiles) and `sim-worker.js`. Verified by reading code and running RNG probes in node. Issues are ordered worst-first.

---

## [P0] Adjacent-seed RNG correlation breaks trial independence and biases the success rate
**Where:** `StrikeSim2040.html` `runMonteCarlo` line 4601 (`createRng(baseSeed + t)`) and `sim-worker.js` line 403 (`createRng(payload.baseSeed + t)`); RNG in `sim.js:47` / `sim-worker.js:13`.
**Problem:** Each of the N trials is seeded with consecutive integers `baseSeed+1, baseSeed+2, …`. The LCG is `s = s*48271 % 2147483647`, so the *first* draw of trial `t` is `((baseSeed+t)*48271 % M)/M` — a near-linear function of `t`. Probed in node: the first `.next()` of 20 adjacent seeds returns 0.4780, 0.4780, 0.4780 … (effectively constant), and the mean first draw over 5000 adjacent seeds is 0.534, not 0.5. The very first `.next()` per trial feeds `intelQ` (line 3527/142), so intel quality is nearly identical in every trial; the second draw drives step-1 success. Trials are therefore **not independent**, and the headline success-rate / expected-impact are biased — exactly the numbers an analyst would brief on.
**Fix:** Derive each trial's seed by hashing, not by adding 1. Run `baseSeed` through a mixing step per trial (e.g. SplitMix64 / `Math.imul`-based avalanche of `baseSeed ^ (t * 0x9E3779B1)`), or keep one RNG instance and advance it across trials. Better: replace the LCG with SplitMix32/PCG so even nearby seeds decorrelate. Add a node test asserting first-draw mean ≈ 0.5 and step-1 success variance across trials.
**Effort:** M

## [P0] Two divergent simulateTrial implementations — main-thread vs worker drift
**Where:** inline `simulateTrial` `StrikeSim2040.html:3494`; copy in `sim-worker.js:106`; plus the orphaned legacy loop `runMonteCarloLegacy:3741`.
**Problem:** The trial model is duplicated by hand in two files. They already differ: the inline version supports `logSteps`/`log` and reads module-level `redProfiles`/`teamResources`/`settings`/`strikeMethods` globals; the worker version takes them via `opts` and omits logging. Any tuning change (cascade, detection, fatigue, red counter list) must be edited in two places or the worker silently simulates a *different game* than the main-thread fallback — so success rate depends on whether a Worker happened to be available. This is the classic "two MC code paths cause drift" hazard, and it is live here, not hypothetical.
**Fix:** Extract one canonical `simulateTrial(plan, opts)` into `sim.js` (pure, all config passed in, no globals) and import it from both the main thread and the worker (`importScripts('sim.js')` in the worker). Delete the inline copy and the dead `runMonteCarloLegacy`. Add a parity test: same seed + same context → identical result main-thread vs worker.
**Effort:** M

## [P0] Dead legacy MC path with raw Math.random still in the file
**Where:** `runMonteCarloLegacy` `StrikeSim2040.html:3741-` (never called; confirmed by grep — only `runMonteCarlo` is wired at 3056/3113/3197/4475). Uses `Math.random()` at 3926, plus `redResponseForMethod` (3724) and `toActionPlanFromBuilt` (3733) which call `Math.random()`.
**Problem:** ~250 lines of an older, *non-seeded* Monte Carlo loop remain in the shell. It uses `Math.random()` directly, so it is unseeded and unreproducible, and it re-implements the trial model a third time with different math (e.g. `blueProfiles` impact ranges and `ctx.pMult` buffs that the current `simulateTrial` doesn't model). It is a live footgun: a future wire-up or copy-paste reintroduces an unreproducible path, and it inflates the "two paths" confusion. Worse, `toActionPlanFromBuilt` (still used by the *active* path) calls `redResponseForMethod` → `Math.random()`, so the **red counter assignment is unseeded** even in the current engine — see P1 below.
**Fix:** Delete `runMonteCarloLegacy`. Audit every `Math.random()` reachable from the live MC path and route it through the seeded `rng`.
**Effort:** S

## [P1] Red-counter selection in the active plan is unseeded (Math.random), so runs aren't reproducible
**Where:** `redResponseForMethod` `StrikeSim2040.html:3724` (uses `Math.random()`), called by `toActionPlanFromBuilt:3733`, which builds the `actionPlan` consumed by the live `runMonteCarlo` (4494) and `simulatePlanOnce` (5367).
**Problem:** The action plan's `red` counter for each step is chosen with `Math.random()` *once, before* trials start — but `toActionPlanFromBuilt()` is called fresh on every run, so two runs with the *same manual seed* get different red counters and therefore different results. The "Seed: … RNG: LCG" line (4688) then lies: the run is not reproducible. (Note `dynamicRed` defaults true, which overrides `step.red`, so this mostly bites when dynamicRed is off — but the non-determinism is real and the plan object differs run to run regardless.)
**Fix:** Either compute red counters deterministically from the seeded RNG inside `simulateTrial`, or pass the `rng`/seed into `toActionPlanFromBuilt` so plan construction is reproducible. Remove `Math.random()` from `redResponseForMethod`.
**Effort:** S

## [P1] No confidence interval on the success rate — 10k trials presented as a point estimate
**Where:** result computation `StrikeSim2040.html:4644-4691`; presets `applyMcPreset:4385`.
**Problem:** Success rate is reported as a single integer percent (`Math.round(successRate*100)`) with no margin of error. For a Bernoulli proportion at N=2,500 (Quick) the 95% CI half-width is ~±2%, at N=10k ~±1%, at N=25k ~±0.6%. Analysts comparing two COAs at, say, 62% vs 65% cannot tell whether the difference is real. The whole point of "High Confidence = more trials" is undercut by never showing the resulting confidence. Impact/steps use p50/p90 (good) but the headline metric has none.
**Fix:** Compute and display a Wald/Wilson 95% CI for `successRate` (`1.96*sqrt(p*(1-p)/n)`), e.g. "64% ± 1.0% (95% CI)". Surface it in the interpretation strip so the recommendation text accounts for overlap.
**Effort:** S

## [P1] Worker result carries no seed/RNG/assumptions metadata; reproducibility log is reassembled on the main thread
**Where:** `serializeAgg` `sim-worker.js:367` (returns counts/arrays only); metadata stitched back in `runMonteCarlo:4698-4718` and the details panel 4684-4690.
**Problem:** The worker returns no echo of `baseSeed`, RNG name, success mode, thresholds, or tuning params it actually used. The main thread *re-derives* the metadata from its own variables and writes "Seed: X (auto), RNG: LCG". If worker and main-thread config ever drift (see P0 #2) the displayed assumptions won't match what the worker computed. Also, the displayed metadata omits the cascade alpha, detection/fatigue/intelNoise params, and the success criterion's exact values — an analyst can't fully reconstruct the run.
**Fix:** Have the worker echo back `{seed, rng:'LCG'|'PCG', successMode, successN, victoryThreshold, params:{cascadeAlpha, detection*, fatigueRate, intelNoise, dynamicRed}}` inside the result, and render those verbatim. Treat the result's metadata as the source of truth for the details panel and any export.
**Effort:** S

## [P1] LCG (Lehmer/MINSTD) is weak for 10k–100k trials; analysts expect SplitMix/PCG
**Where:** `createRng` `sim.js:47` and the duplicate `sim-worker.js:13`.
**Problem:** This is Park-Miller MINSTD (`48271`, modulus 2^31−1). Period ~2.1e9 is fine for trial *length*, but the generator has well-known low-dimensional structure (serial-correlation lattice planes) and a `s/M` mapping with non-uniform spacing; combined with the per-trial reseeding in P0 it is the wrong tool. For a tool that bills itself on "10,000 / 25,000 trials" and reproducibility, MINSTD is below the bar reviewers will hold a wargaming MC to.
**Fix:** Swap to SplitMix32 or a PCG-XSH-RR variant (both are ~10 lines, no deps, offline-friendly) with a documented 32/64-bit seed. Keep a single shared implementation. Record the RNG name in metadata (P1 #6) so older saved runs remain interpretable.
**Effort:** S

## [P1] Main-thread fallback runs the full loop on the UI thread and can jank / freeze
**Where:** fallback loop `StrikeSim2040.html:4596-4641`; `canUseMonteCarloWorker:4309` returns false under `file://`.
**Problem:** The worker is the happy path, but `canUseMonteCarloWorker()` is false when the page is opened directly from disk (`file://`) — which is the *primary* delivery mode for an "offline browser COP tool" double-clicked by an analyst. In that case all 100k trials run in the main-thread `for` loop. It does `await yieldToFrame()` only once per chunk (~every `trials/100` trials), so each chunk is a synchronous burst; at 100k trials with a long plan and large graph the chunks can each be tens of ms, and the cancel button (`mcCancelRequested`) is only checked between trials — the UI is sluggish and the progress bar lurches. Most users will hit this exact path.
**Fix:** Detect `file://` and warn that the worker is unavailable, or bundle the worker as a Blob URL (`new Worker(URL.createObjectURL(blob))`) which works under `file://` and keeps MC off the UI thread. Failing that, shrink chunk size and time-box each chunk (yield when `performance.now()` budget exceeded) so the main-thread path stays responsive and cancel is snappy.
**Effort:** M

## [P2] expected-impact and avg-steps are conditioned on success only, which can mislead
**Where:** `StrikeSim2040.html:4646-4647` (`expImpact = totalImpactOnSuccess/trialsSuccess`, `avgSteps` likewise).
**Problem:** Expected impact and average steps are computed over winning trials only. A plan that wins 20% of the time with huge impact will show a large "expected impact" that an analyst may read as the typical outcome. The label "Wins average … impact" (4687) is technically honest but the top-line metric cards (`mc-exp-dmg`, `mc-time`) drop the "on wins" qualifier. There is no *unconditional* expected impact or loss across all trials.
**Fix:** Either relabel the cards as "Impact (winning runs)" or add an unconditional row (mean impact over all trials, mean blue losses over all trials). Make sure the interpretation text distinguishes "when it works" from "on average."
**Effort:** S

## [P2] Cascade / detection / fatigue / intel-noise tunables are hard-coded, not exposed
**Where:** `simulateTrial` defaults at 3504-3509 (`detectionGrowthTarget 0.08`, `detectionPenalty 0.18`, `intelNoise 0.15`, `fatigueRate 0.03`), cascade in `applyCascade:3562` (`5 * cascScore * settings.cascadeAlpha`), `domainAffinity` multipliers 3447 (1.3/1.15/clamp 0.8–1.8).
**Problem:** The model has ~8 magic constants that materially change every result, but only `cascadeAlpha` is wired through `settings`; the rest are buried literals duplicated between the inline and worker copies. An analyst cannot do sensitivity analysis ("how robust is this COA if intel is worse?") or document the assumptions, and a tuning change requires editing two files (compounds P0 #2).
**Fix:** Promote these into the `settings`/`teamResources` config object, expose the key ones (intel noise, detection penalty, fatigue, cascade alpha) as MC controls or at least a collapsible "assumptions" block, and include them in the reproducibility metadata (P1 #6).
**Effort:** M

## [P2] Preview Outcome is a single unseeded sample with no context — marginally useful
**Where:** `simulatePlanOnce` `StrikeSim2040.html:5365` (`rng: createRng()` → time-seeded), modal 5380-5400.
**Problem:** "Preview Outcome" runs exactly one trial with a fresh time-based seed, so it is unreproducible and, by definition, a sample of variance. Its step-by-step log is nice for intuition, but it is presented next to the rigorous MC numbers and can anchor a user on a lucky/unlucky path. There's no indication of where this single sample falls in the MC distribution (e.g. "this run's impact = 140, which is the 30th percentile"). The disclaimer at 5397 helps but the value is low relative to its prominence.
**Fix:** Seed the preview from the current MC `baseSeed` (so it's reproducible and tied to the run), and annotate the sampled impact/steps against the last MC distribution (percentile). Optionally let the user step through 3–5 samples. At minimum, gate/label it as "illustrative single run."
**Effort:** S

## [P2] Success rate uses completedTrials as denominator on cancel — fine, but partial runs still drive the strength bar and highlights
**Where:** `effectiveTrials = Math.max(1, completedTrials)` 4644; strength bar 4656-4660; node-odds denominator 4670; highlight set 4694.
**Problem:** On cancel, the denominator correctly switches to completed trials (good), and the interpretation flags "directional, not decision-grade" (good). But the strength bar, the map highlight set (`highlightSet`), and `mcLastResults` are still written from the partial run with no visual "partial/stale" marker on the map or the strength gauge. A user who cancels then glances at the map sees neutralization highlights that look authoritative.
**Fix:** Tag partial results visually (e.g. hatched strength bar, "partial" badge on highlighted nodes) and stamp `mcLastResults.partial = true`, so downstream consumers (exports, briefings) can refuse or annotate partial data.
**Effort:** S
