# Code Review Checklist

This file is the **single source of truth** for code-review criteria. Both human-driven reviews via `.claude/skills/TRIP-review` and Codex-driven reviews via `.claude/skills/codex-code-review` apply the criteria below — referenced, not copied — so the two review surfaces cannot drift.

## Systematic Review Checklist

### 1. Functional Requirements

- [ ] Implementation logic matches requirements correctly
- [ ] Interface/API matches documented specifications
- [ ] Error scenarios handled with proper feedback
- [ ] Edge cases and boundary conditions validated

### 2. Code Quality

- [ ] Proper typing (no unjustified dynamic types)
- [ ] DRY principle - no code duplication
- [ ] KISS principle - not unnecessarily complex
- [ ] Consistent, descriptive naming conventions
- [ ] Complex logic has explanatory comments
- [ ] Files/modules not excessively large
- [ ] Imports/includes organized, unused ones removed

### 3. Architectural Compliance

- [ ] Code follows established patterns from ARCHI.md
- [ ] Proper separation of concerns
- [ ] Appropriate abstractions used
- [ ] Consistent with existing codebase style

### 4. Determinism & Engine Discipline

- [ ] No RNG outside seeded engine paths (no stray `Math.random`/`Date.now` in engine-affecting code)
- [ ] No combat/victory math outside `game.js` — forecast/counterfactual/replay reuse the one resolver
- [ ] Replay compatibility preserved (payload spec, pre-match `pm` snapshot, order log semantics)
- [ ] Seed-stable: repeat runs byte-identical where proof contracts require it
- [ ] GAME_DESIGN §9 anti-goals respected (no new top-level modes, no engine forks, no prediction theater)
- [ ] Proof contracts added/extended for new engine behavior; harness load order kept (`strategic-state.js` before `game.js`)

### 5. Offline & Presentation Discipline

- [ ] No runtime network calls; anything network-touching gated by `online-flags.js` only
- [ ] Presentation layer (cinematics/audio) reads state, never mutates the engine
- [ ] Reduced-motion (`html.cin-rm`) and perf-mode (`html.cin-perf`) twins provided for new visuals
- [ ] No WATCH audio bed (proof-pinned doctrine); gesture-gated audio respected
- [ ] Global-module conventions followed (`window.<Name>Module`, `Module.init({...})` injection, `AppState.activeGraph()`)
- [ ] UNCLASSIFIED // NOTIONAL stamping kept on new files

### 6. Error Handling

- [ ] Errors are properly caught and handled
- [ ] Error messages are clear and actionable
- [ ] Failure modes are graceful
- [ ] Logging is appropriate (not too verbose, not silent)

### 7. Security (if applicable)

- [ ] Input validation implemented
- [ ] No sensitive data exposed
- [ ] Authentication/authorization respected
- [ ] No obvious vulnerabilities

### 8. Performance

- [ ] No obvious performance issues
- [ ] Resource cleanup implemented (no leaks)
- [ ] Appropriate data structures used
- [ ] No unnecessary operations in hot paths

---

## Issue Severity Classification

**Critical (Block Deployment)**:

- Security vulnerabilities
- Data corruption risks
- Breaking API/interface changes
- Authentication bypasses

**Major (Require Immediate Fix)**:

- Incorrect business logic
- Significant performance degradation
- Missing error handling
- Compilation/build errors

**Minor (Should Fix)**:

- Code style inconsistencies
- Missing documentation
- Code duplication
- Missing edge case handling

**Suggestions (Nice to Have)**:

- Performance optimizations
- Readability improvements
- Additional test coverage

---

## Review Completion Criteria (Approval Gate)

Minimum for approval:

- [ ] All functional requirements implemented
- [ ] No critical or major issues remaining
- [ ] Syntax gate clean (`node --check` over touched files)
- [ ] Affected proof harnesses pass (`node tools/<area>-proof.js`; `validate-scenarios.js` if data touched) per the TRIP-2 testing gate
- [ ] Engine-touching changes: balance gate holds 0.45–0.55 (`node tools/wargame-loop-gate.js` or chunked eval)
- [ ] New logic has proof-contract coverage (or a coverage-debt ledger entry per the hard-to-cover policy)
- [ ] Documentation updated per project standards (ARCHI.md per ARCHI-rules.md)
