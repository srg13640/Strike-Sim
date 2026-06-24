# External Review Prompt — MDSC 3D Network Visualizer Refactor

> **How to use this:** paste everything below the line into a separate LLM (or a fresh
> Claude session) that has read access to this repository. Its job is to critically
> review the refactoring work and return concrete, actionable feedback. The feedback is
> intended to be handed back to the engineer (Claude) who did the work, so be specific:
> cite files and line numbers, and say *what* to change and *why*.

---

You are a senior software architect performing an independent code review. You did not
write this code. Be rigorous, skeptical, and concrete. Praise is not useful; precise
findings are.

## Context

This is a single-page, offline-capable browser app (no build step, no backend): a 3D
multi-domain force-network visualizer with Monte Carlo course-of-action simulation. It
began as one ~5,700-line `DST2040.HTML` file and was incrementally refactored into a
shell plus seven plain-`<script>` modules. Read `README.md` first for the architecture
and conventions, then inspect the code.

**Key conventions to evaluate (not just accept):**
- Modules attach a `window.<Name>Module` object and **alias their public methods onto
  the original global names** so legacy call sites keep working.
- Shared script-scoped state is passed into modules via `Module.init({ getX, getY })`
  live-getter injection.
- The active graph is read via `AppState.activeGraph()`.
- It must remain fully offline (`OFFLINE_MODE`), runnable over `file://` or a static
  server, with no build tooling.

**Files:** `DST2040.HTML` (shell), `state.js`, `ui.js`, `sim.js`, `map.js`, `engine.js`,
`views.js`, `inline-datasets.js`. The git history (`git log`) shows each extraction as a
separate, verified commit.

## What to review

Work through these and report findings for each:

1. **Correctness of the extraction.** Did anything break or change behavior? Look for:
   bare identifiers in a module that won't resolve (would throw under `'use strict'`);
   load-order assumptions; aliases set too late; stale `window.*` copies of values that
   the shell later reassigns; getters that should be live but capture a stale value.

2. **The global-alias pattern.** Is it sound, or does it create hidden coupling / name
   collisions / debugging hazards? Is there a cleaner approach that stays no-build and
   offline? If you'd change it, show the smallest viable change — don't propose a
   framework rewrite.

3. **Dependency-injection boundaries.** Are the `init({...})` context objects the right
   seams? Any module that still reaches into shell state it shouldn't, or that should be
   injected but reads a global instead?

4. **The state layer (`AppState`).** It's scenario-centric to enable future multi-scenario
   support. Is the abstraction honest, or leaky? Does `data` (the shell's binding to the
   active graph) stay consistent with `AppState` across the import/replace path?

5. **What was NOT modularized.** The deeper sim engine (`simulateTrial` + ~20 helpers)
   and the orchestration glue (panel updates, filters, modals, the COA wizard) remain in
   the shell. Evaluate that judgment call: is leaving them correct, or is there a clean
   seam the engineer missed? Specifically assess whether a `sim-engine.js` extraction is
   worth it given coupling to `teamResources` / `settings` / `strikeMethods`.

6. **Offline / robustness.** Any remaining remote-fetch paths? Does the map's
   missing-tile handling truly fail gracefully? Any unguarded DOM/WebGL assumptions?

7. **Risk hotspots & test gaps.** Where is this most likely to regress? There are no
   automated tests — what are the 3–5 highest-value tests to add first, and what would
   they assert?

8. **Enterprise-handoff readiness.** This is meant to be handed to a defense contractor.
   What's missing for that bar (docs, licensing of vendored libs, security/privacy of
   scenario data, accessibility, error handling)?

## Output format

Return a prioritized list. For each finding:
- **Severity:** Blocker / High / Medium / Low / Nit
- **Location:** file + line(s)
- **Finding:** what's wrong or risky (one or two sentences)
- **Recommendation:** the specific change to make

End with a short **"If you only do three things"** section. Do not rewrite the code;
describe the changes precisely enough that the engineer can act on them directly.
