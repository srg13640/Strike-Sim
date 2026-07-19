# Testing Guidelines

UNCLASSIFIED // NOTIONAL RESEARCH TOOL

## Test Framework

None — deliberately. StrikeSim 2040 uses **proof-contract harnesses**: plain Node.js scripts in `tools/` that load the browser modules headlessly, assert named behavioral contracts, and exit non-zero on any violation. No npm, no dependencies, no framework. See `docs/ARCHI.md` §19.

## Running Tests

```bash
# Syntax gate (closest thing to lint/typecheck)
for f in *.js tools/*.js; do node --check "$f" || { echo "SYNTAX FAIL: $f"; break; }; done

# One area's proof
node tools/<area>-proof.js            # e.g. node tools/mind-games-proof.js

# All proofs (release-time full pass)
for p in tools/*-proof.js; do echo "== $p"; node "$p" || break; done

# Scenario data ↔ schema
node tools/validate-scenarios.js

# Balance gate (heavy; engine-touching work only) — target 0.45–0.55 Blue win, hard/hard
node tools/wargame-loop-gate.js
node tools/wargame-loop-eval.js --matches 20 --seed-base 42   # chunked slice for constrained sandboxes

# Replay determinism (share/order-log/red-model work)
node tools/replay-verify.js --payload <SS1z.… or file>        # exit 0 / 1 MISMATCH / 2 MALFORMED
```

## Test Organization

- `tools/<area>-proof.js` — one proof per architectural area (joint-force, logistics, doctrine, escalation, mind-games, brier, counterfactual, performance-layer, online-layer, symbols, rings, theater, taskorg, map-capability, runtime-performance, …). A proof grows with its area; extend the existing proof rather than adding a parallel one.
- `tools/wargame-loop-gate.js` — pinned `GameModule` API surface + balance band enforcement.
- `tools/replay-verify.js` — end-to-end determinism against committed human-blue fixtures (default graph + small-island variant).
- `tools/validate-scenarios.js` — every scenario JSON against `schemas/strikesim-scenario.schema.json`.

## Writing Tests

- **Harness law**: any harness loading `game.js` must load `strategic-state.js` first (this ordering bug has bitten seven tools).
- Pin the pure layers cheaply: `strategic-state.js`, `red-mind.js`, `forecasting.js`, `counterfactual.js` hold no browser/clock/storage/random state.
- Test observable behavior through public module APIs (orders in → resolved state/verdict out), never internal wiring.
- Name and count contracts; print them; exit non-zero on the first violation.
- Determinism is itself a contract: run the slice twice, require byte-identical output.
- Presentation contracts guard doctrine, not pixels: offline-complete, zero engine reach from cinematics/audio, no WATCH bed, reduced-motion/perf class twins.

## Coverage Requirements

Not defined — no coverage tooling exists. The floor is contract coverage: new engine-touching behavior must land with a proof contract, and accepted gaps go in `docs/4-unit-tests/COVERAGE-DEBT.md` (`path | why hard | escape plan`), per the TRIP-2 hard-to-cover policy.
