# Changelog Table

| Version | Week | Commit Message                  |
| ------- | ---- | ------------------------------- |
| `0.1.1` | 1    | fix: online-layer proof learns the tutorial branch — 51 contracts, gate 0.457 PASS, baseline recorded |
| `0.1.0` | 1    | chore: initialize TRIP workflow |

# Changelog Summary

- **v0.1.1 (Health Baseline - Week 1, 19-07-2026)**:
  - **Fix**: `online-layer-proof.js` taught the guided-tutorial branch in `director.js` — 2 stale static contracts updated, 3 new tutorial-semantics contracts (no challenge intake, fixed seed 204002 honestly displayed, challenge-link tutorial-gated); 48 → 51, all green
  - **Verification**: full suite swept green (syntax 55/55, 18 proofs, scenario validation); balance gate PASS at Blue 0.457 over 210 matches / 30 disjoint seed bases — first gate since the contested-logistics merge
  - **Baseline**: `docs/6-memo/2026-07-19-health-baseline.md` records the trusted state + findings (F1 fixed drift, F2 process gap now closed by TRIP, F3 lower-band balance watch item)
  - **Workflow**: TRIP-2 amended — Claude implements directly by default, Codex optional; first complete TRIP cycle
  - **Files**: tools/online-layer-proof.js, docs/6-memo/2026-07-19-health-baseline.md, docs/1-plans/F_0.1.1_health-baseline.plan.md, docs/3-code-review/CR_w1_v0.1.1.md, docs/5-tuto/tuto_0.1.1.md, VERSION, README.md

- **v0.1.0 (TRIP Initialization - Week 1, 19-07-2026)**:
  - **Setup**: Initialized TRIP workflow with docs structure (`docs/1-plans` … `docs/6-memo`, incl. `5-tuto`); created `VERSION` at 0.1.0 (no prior version mechanism existed; only git tag was `pre-stark-baseline`)
  - **Documentation**: Generated `docs/ARCHI.md` with Game-type architecture (browser wargame; secondary: no-build vanilla-JS frontend + deterministic sim/verification toolkit) plus custom sections for determinism/share/replay, offline/online flags posture, workers, audio doctrine, and proof-contract testing
  - **Skills adapted**: TRIP-1-plan (StrikeSim technical considerations, mandatory Design-Spine Compliance section, per-area guidance), TRIP-2-implement (node --check syntax gate, proof harnesses, balance-gate/replay integration rules), TRIP-3-release (VERSION file, week anchor 2026-07-13, tutorial step: Beginner/all-focus/Balanced, main branch), TRIP-review (Determinism & Engine Discipline + Offline & Presentation Discipline checklist sections, renumbered 1–8, template synced), TRIP-test (proof-harness commands, structure, priorities)
  - **Files Added**: docs/ARCHI.md, docs/ARCHI-rules.md, docs/2-changelog/changelog_table.md, docs/4-unit-tests/TESTING.md, VERSION
