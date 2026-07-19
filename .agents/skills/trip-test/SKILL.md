---
name: TRIP-test
description: Write/run tests following project standards (deep test authoring)
disable-model-invocation: true
argument-hint: "component or feature to test"
---

# Testing Mode

You are now in **testing mode** for **StrikeSim 2040**.

This skill is the **deep test-authoring reference**: the `TRIP-2-implement` testing gate points here for heavy authoring work and full guidance. Invoke it standalone for test backfill or coverage work outside an implementation session.

## Prerequisites - Read First

Before testing, you MUST read:

1. @docs/ARCHI.md - Understand system architecture
2. @docs/4-unit-tests/TESTING.md - Testing guidelines

## Your Task

Test: $ARGUMENTS

---

## Testing Guidelines

### Scope

- Only run tests for relevant files that changed (not the whole project)
- Focus on the new feature/fix/refactor

### Commands

```bash
# Syntax gate (no lint/typecheck tooling exists)
for f in *.js tools/*.js; do node --check "$f" || { echo "SYNTAX FAIL: $f"; break; }; done

# Run all proof harnesses (full pass — release-time, not per-change)
for p in tools/*-proof.js; do echo "== $p"; node "$p" || break; done

# Run a specific area's proof
node tools/<area>-proof.js            # e.g. node tools/logistics-proof.js

# Scenario data validation
node tools/validate-scenarios.js

# Balance gate (heavy; engine-touching changes only)
node tools/wargame-loop-gate.js                                  # full gate — run natively if possible
node tools/wargame-loop-eval.js --matches 20 --seed-base 42      # chunked slice for sandboxes (disjoint seed bases, aggregate)

# Replay determinism (share/order-log/red-model changes)
node tools/replay-verify.js --payload <SS1z.… or file>           # exit 0 VERIFIED / 1 MISMATCH / 2 MALFORMED
```

There is no coverage tooling — proofs assert named behavioral contracts, not line coverage.

### Test Structure

- Tests are **proof-contract harnesses**: plain Node scripts at `tools/<area>-proof.js`, no framework, exit non-zero on any violated contract.
- Each proof loads the browser modules headlessly (vm/sandbox shims). **Harness law: load `strategic-state.js` before `game.js`** — this ordering bug has bitten seven different tools.
- Contracts are named, counted, and printed; a proof grows with its area (e.g. `online-layer-proof.js`: 40 static + 11 e2e contracts as of v0.1.1). Extend the area's existing proof rather than creating parallel ones.
- Determinism check: run twice, byte-identical output slices.
- Supporting checks: `validate-scenarios.js` (schema), `wargame-loop-gate.js` (pinned engine API + balance band), `replay-verify.js` (end-to-end fixture reproduction on default + small-island graphs).

### Testing Priorities

**Proof contracts (unit-level)**:

- Pure layers first: `strategic-state.js`, `red-mind.js`, `forecasting.js`, `counterfactual.js` (no browser/clock/random state — cheapest to pin)
- Resolver behavior via the public `GameModule` API (orders → resolution → MOE verdict)
- Logistics adapter determinism (graph → stocks/routes/decisions)
- Payload validation (accept/reject tables, fail-silent intake)

**Integration (harness-level)**:

- Balance gate: Blue win rate 0.45–0.55 hard/hard across seeded batches
- Replay: exact reproduction of human-blue fixtures; queueOrder rejection = tamper
- Presentation contracts: offline-complete, zero engine reach, no WATCH bed, reduced-motion/perf class twins

**What to Test**:

- Seed stability (same seed + orders ⇒ identical state) and cross-run byte-identity
- Contract edges: malformed payloads, empty/invalid scenario data, invalid orders
- Anti-goal tripwires: RNG outside seeded paths, adjudication outside `game.js`, network reach outside `online-flags.js`

---

## Hard-to-Test Code

Seam ladder, cheapest first: **exported pure helper → injectable client/adapter → module mock → integration/emulator test**. Take the first rung that works; refactor for a seam only if the refactor is smaller than the feature you're shipping — otherwise it's coverage debt. Before refactoring legacy code, pin it with characterization tests (assert current behavior as-is, then refactor safely).

Uncovered risky paths: one line each in `docs/4-unit-tests/COVERAGE-DEBT.md` (`path | why hard | escape plan`). Delete a ledger line in the same change that gives its path meaningful coverage.

---

## Post-Testing Summary

After completing tests, create a summary file:

**File**: `docs/4-unit-tests/wa_vx.y.z_test.md`
(a = project week, x.y.z = version)

**Content**:

```markdown
# Test Summary - Week a, V. x.y.z

## What Was Tested

[List of tested components/functions]

## Test Results

- Total tests: X
- Passed: X
- Failed: X
- Coverage: X%

## Key Findings

[Any issues discovered, edge cases found, etc.]

## Notes

[Additional context or recommendations]
```
