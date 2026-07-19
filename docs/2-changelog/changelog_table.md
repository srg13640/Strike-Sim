# Changelog Table

| Version | Week | Commit Message                  |
| ------- | ---- | ------------------------------- |
| `0.1.0` | 1    | chore: initialize TRIP workflow |

# Changelog Summary

- **v0.1.0 (TRIP Initialization - Week 1, 19-07-2026)**:
  - **Setup**: Initialized TRIP workflow with docs structure (`docs/1-plans` … `docs/6-memo`, incl. `5-tuto`); created `VERSION` at 0.1.0 (no prior version mechanism existed; only git tag was `pre-stark-baseline`)
  - **Documentation**: Generated `docs/ARCHI.md` with Game-type architecture (browser wargame; secondary: no-build vanilla-JS frontend + deterministic sim/verification toolkit) plus custom sections for determinism/share/replay, offline/online flags posture, workers, audio doctrine, and proof-contract testing
  - **Skills adapted**: TRIP-1-plan (StrikeSim technical considerations, mandatory Design-Spine Compliance section, per-area guidance), TRIP-2-implement (node --check syntax gate, proof harnesses, balance-gate/replay integration rules), TRIP-3-release (VERSION file, week anchor 2026-07-13, tutorial step: Beginner/all-focus/Balanced, main branch), TRIP-review (Determinism & Engine Discipline + Offline & Presentation Discipline checklist sections, renumbered 1–8, template synced), TRIP-test (proof-harness commands, structure, priorities)
  - **Files Added**: docs/ARCHI.md, docs/ARCHI-rules.md, docs/2-changelog/changelog_table.md, docs/4-unit-tests/TESTING.md, VERSION
