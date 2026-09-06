# CO-017 — Slim the shell: extract the pure COA planning core (with first-ever tests)

*Plan of record. 2026-09-06. Branch `cursor/setup-cloud-env-4b41`.*

## 1. Why

Continues the staged shell-slimming from CO-016. The next named target was the
COA/Monte-Carlo UI. Investigation showed that block (~1,300 lines) is **not** a safe
one-shot extraction: the Monte Carlo orchestration, the goal-planner, and the wizard's
DOM glue are welded to the shell's live `simulateTrial` shim, strike helpers
(`strikeProbFor`, `bestMethodForTarget`, `getTopPayoffRedIds`, `strikeMethods`), mutable
state (`goalPlanStats`), workers, and the DOM. Extracting all of it needs a wide injection
seam + browser/e2e coverage.

But a genuinely clean seam exists inside it: the **pure planning core**. This CO extracts
exactly that, and — because it is pure — gives it its first automated test coverage.

## 2. Change

**New module `coa-planner.js` (`window.CoaPlanner`).** Three pure functions moved verbatim
out of the shell (logic unchanged):
- `scoreNode(n, conf)` — target desirability under the wizard's emphasis/constraints
  (importance/cascade/resource base; payoff/risk emphasis; difficulty × aggressiveness;
  avoid-hard, focus-command/relay, prefer-geo modifiers; non-red/neutralized ⇒ -Infinity).
- `selectTargets(nodes, conf)` — top-N by score, with optional per-domain dispersal cap
  (was `selectTargetsForWizard`, now takes the node list as a parameter instead of reading
  the shell's `data.nodes`).
- `buildMethodSequence(mixPct, steps)` — largest-remainder rounding of a % method mix into
  an interleaved sequence of exactly `steps` methods.

The module is dual-mode: a browser global (`window.CoaPlanner`) and a Node `require`
export (for the proof). No DOM, no globals, no RNG — deterministic.

**Shell (`StrikeSim2040.html`).** The three function bodies are removed; the four call
sites in `generatePlanFromWizard` delegate to `CoaPlanner` (passing `data.nodes`). A
`<script src="coa-planner.js?v=co017">` loads after `moe.js`. Nothing else changed — the
goal-planner, Monte Carlo orchestration, wizard DOM, and rendering stay in the shell.

**New gate `tools/coa-planner-proof.js`.** 13 contracts exercise the extracted core
headlessly (the logic had zero coverage while it lived in the shell): scoring
disqualification, monotonicity, determinism, emphasis ordering, each modifier; selection
ordering + eligibility + domain-dispersal cap; and sequence length / 100%-mix / 0%-mix /
largest-remainder / empty-mix behavior. `run-all-gates.sh` auto-discovers it.

## 3. Verification

- `tools/run-all-gates.sh` → **ALL GATES GREEN (19 passed)** — was 18; the new
  `coa-planner-proof` is the 19th, and the syntax gate now also covers `coa-planner.js`.
- `tools/build-dist.sh --skip-gates` → dist copies `coa-planner.js`; all references resolve.
- Manual (localhost, Chrome): opened the COA Wizard, stepped to Preview, and generated an
  **8-step plan** naming methods (Kinetic/SOF/Cyber) and the three red command targets —
  i.e. `selectTargets` + `buildMethodSequence` running end-to-end with no app errors.
  Screenshot attached to the delivering message.

## 4. Gates

`tools/run-all-gates.sh` → ALL GATES GREEN (19 passed).

## 5. Follow-on (not done here — needs an injection seam + e2e coverage first)

- Migrate the goal-planner (`buildGoalPlan` / `evaluateGoalPlan` / `findBestGoalPlan` /
  `chooseMethodWithMix` / `expectedDamageFor`) into `coa-planner.js` by injecting the
  shell's `{ getNodes, strikeMethods, strikeProbFor, bestMethodForTarget, getTopPayoffRedIds,
  simulateTrial }` bundle, then extend the proof.
- Then the wizard DOM glue and Monte Carlo worker orchestration, one at a time.
- Browser/e2e automation for the wizard flow (see `docs/4-unit-tests/COVERAGE-DEBT.md`).
