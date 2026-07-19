# Health Baseline — 2026-07-19

UNCLASSIFIED // NOTIONAL RESEARCH TOOL

**Context**: First TRIP cycle (plan `docs/1-plans/F_0.1.1_health-baseline.plan.md`, v0.1.1), branch `fix/health-baseline` off `main@8961b80`. Working tree also carried the two post-CO-007 feature commits (`3c320b0` contested logistics, `6d82079` guided tutorial) that had never been swept by the full verification suite.

**Statement**: as of this date, `main` + this branch is a **verified baseline**. Future sessions should trust the results below rather than re-auditing, and only re-verify the areas their changes touch.

## Results

| Check | Result | Detail |
|---|---|---|
| Syntax gate (`node --check`) | ✅ | 55/55 root + tools JS files |
| `brier-proof` | ✅ | 29/29 |
| `content-adaptation-proof` | ✅ | all B7 gates |
| `counterfactual-proof` | ✅ | 6/6 |
| `director-ux-proof` | ✅ | incl. runtime readiness |
| `doctrine-proof` | ✅ | 25/25 |
| `escalation-proof` | ✅ | |
| `joint-force-proof` | ✅ | |
| `logistics-proof` | ✅ | stocks/hubs/DDIL/reroute/repair/replay/AAR |
| `map-capability-proof` | ✅ | |
| `milsymbol-proof` | ✅ | SVG sheet → `_stark/` |
| `mind-games-proof` | ✅ | |
| `online-layer-proof` | ✅ **51/51** | was 46/48 — see finding F1 |
| `performance-layer-proof` | ✅ | P1–P4 incl. settings honesty |
| `rings-proof` / `symbol-proof` / `taskorg-proof` / `taskorg-layout-proof` / `theater-proof` | ✅ | render sheets → `_stark/` |
| `runtime-performance-proof` | ✅ | 15/15 |
| `validate-scenarios` | ✅ | all scenarios ↔ schema |
| **Balance gate** | ✅ **PASS** | **Blue win rate 0.457** (band 0.45–0.55) |

## Balance gate detail

- 210 matches, hard/hard defaults (8-turn limit), via `tools/wargame-loop-eval.js`
- 30 disjoint seed bases × 7 matches: bases 42, 142, 242, … 2942 (step 100)
- Outcomes: 96 blue / 114 red / 0 draws → 0.457
- Chunked because sandbox slices cap ≈40 s (~5 s/match since the logistics merge; 3 parallel evals per slice)
- Comparable to the CO-005 close-out gate (0.460). **Near the lower edge** — worth watching after any future engine/logistics change, but no action warranted.

## Findings

- **F1 (fixed this cycle)**: the guided-tutorial commit (`6d82079`) extended `director.js` (seed selection :624, `startModel` :617) without updating `online-layer-proof.js`'s static contracts → 2 stale FAILs. Fixed: contracts updated to the tutorial-aware source, and 3 new contracts pin tutorial semantics (never consumes a challenge; fixed seed 204002 single-sourced + honestly displayed in BRIEF; AAR challenge link tutorial-gated). Proof now 51 contracts.
- **F2 (observation)**: post-CO commits landed without a full-suite sweep — the TRIP-2 testing gate now makes this structural.
- **F3 (observation)**: balance sits at 0.457, lower half of band, red-favored drift would exit the band first.

## Environment notes (sandbox runs)

- Copy the repo to `/tmp` before compute-heavy Node runs (iCloud FUSE mount is slow).
- Proof harnesses: load `strategic-state.js` before `game.js` (harness law).
- Eval slices: ≈7 matches per 40 s window; disjoint seed bases, aggregate manually.
- iCloud pins fresh `.git` lock files temporarily — clear stale locks at run start, expect denials to be transient.
