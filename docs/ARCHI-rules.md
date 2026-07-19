# Architecture Documentation Rules

[ARCHI.md](ARCHI.md) documents the StrikeSim 2040 architecture. After each task (new feature, refactor, bug fix), determine if ARCHI.md needs updating.

## When to Update

Update after ANY change that alters:

- Project structure (new modules, new directories, moved files) — §4
- Technology stack (new vendored library, worker, storage mechanism) — §3
- The Operation Loop or turn model — §8 Game Loop Architecture
- The resolver, Red mind, forecasting, MOE, or logistics models — §9 Simulation & Adversary Architecture
- Rendering, input, assets, or audio — §10–§13
- Share payloads, replay verification, or determinism guarantees — §14 Determinism, Share & Replay
- Feature flags or offline/online posture — §7 Configuration, §15
- Workers/concurrency — §16
- Data flow between modules — §17 (update the mermaid diagrams)
- Error handling, testing/verification, performance, security posture, deployment — §18–§22

## How to Update by Change Type

### Major Feature / Refactor

Review: §4 Project Structure, §5 Core Architecture Principles, the type-specific section it lands in (§8–§16), §17 Data Flow diagrams, §19 Testing Strategy (new proof contracts).

### Minor Feature / Enhancement

Update: the single owning section (§8–§16) plus §4 if a file was added.

### Bug Fix

Usually no update needed, unless it reveals/fixes an architectural flaw (e.g. a determinism leak or a resolver-discipline violation — then also record it in §5 or §14).

### Dependency Changes

Update: §3 Technology Stack (vendored libs only — there is no package manager), and any affected sections (§10 rendering pins like Three r128 constraints).

## Guidelines

- Be precise and factual — reflect the actual codebase, actual file paths, actual tool names.
- Be concise — enough to understand, not implementation detail; ARCHI.md must stay well under ~20,000 tokens (check with `bash .claude/skills/trip-compact/count-tokens.sh docs/ARCHI.md`; run `TRIP-compact` if it grows past that).
- Update the mermaid diagrams (§8, §17) when loop phases or module data flow change.
- Never weaken the binding constraints by omission: one resolver, seeded determinism, offline-complete with `online-flags.js` as the only swappable file, GAME_DESIGN §9 anti-goals, UNCLASSIFIED // NOTIONAL stamping.
