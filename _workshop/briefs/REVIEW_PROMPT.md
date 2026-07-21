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

## Reported issues to investigate FIRST (from the product owner)

These were observed in a real Chrome session and take priority. Reproduce each, find the
root cause (cite file + line), and give a concrete fix. Distinguish genuine app bugs from
expected-offline noise and from third-party/browser-extension noise.

1. **~237 console errors on load/use.** The DevTools console shows a red "237" error
   count (plus one warning). Enumerate what they actually are and categorize them.
   Strong suspects to confirm or rule out: (a) HTTP 404 floods from missing local map
   tiles — the Leaflet layer requests `./tiles/{z}/{x}/{y}.png` and there is no `tiles/`
   directory, so every tile 404s (see `map.js` `ensureMap`); (b) a 404 for the missing
   earth texture `assets/earth-dark.jpg` used by geo mode (see `engine.js`
   `ensureEarthSphere` / `EARTH_TEX_URL`); (c) noise from a browser extension (the one
   visible warning points at `hook.js:1`, which is React DevTools, not app code). For a
   defense-contractor handoff the runtime console should be clean — recommend how to
   eliminate or gracefully suppress the real ones (e.g. detect missing tiles once and
   stop requesting, ship a tiny placeholder/encoded earth texture or skip the textured
   globe when absent) without breaking offline behavior.

2. **Geo Mode appears to do nothing.** Clicking **Geo Mode** produces no visible change —
   the user still sees the flat view, no globe. Investigate the full path: `engine.js`
   `applyGeoLayout` (pins nodes to lat/lon, sets `d3Force(...) = null`, reheats) and
   `ensureEarthSphere` (builds the sphere with the possibly-404'ing texture and adds it
   to `graphInstance.scene()`), plus the main shell's `enableGeoMode` wrapper. Specifically
   determine: (a) does the earth sphere actually render if its texture 404s (does the
   `MeshPhongMaterial` show as invisible/black, making the globe seem absent)? (b) do the
   nodes actually reposition? (c) **does the camera ever move to frame the globe** — i.e.
   after `enableGeoMode`, is there a camera reframe, or does the camera stay zoomed on the
   old layout so the repositioned nodes/globe end up off-screen, making it look like
   "nothing happened"? Propose the fix (likely: render an untextured-but-visible globe
   when the image is missing, AND reframe the camera on geo-mode entry).

When done with these, continue with the general review below.

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
