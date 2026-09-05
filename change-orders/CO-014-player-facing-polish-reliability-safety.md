# CO-014 — Player-facing polish, reliability, safety hardening, and owner docs

*Plan of record. 2026-09-05. Branch `cursor/setup-cloud-env-4b41`.*

## 1. Why

Owner request (non-developer): "improve the UI" with a broad mandate — wow factor + real
players, ambitious scope, all focus areas. A full codebase review (architecture, quality,
tests, performance, accessibility, offline/security, docs) surfaced concrete, low-risk wins
that advance that goal without disturbing the deterministic engine or the proof-contract
discipline. This CO batches them; deeper items (shell slimming, WebGL/browser test
automation, map/3D keyboard selection) are staged as follow-on.

## 2. Change

**A. Reliability — continuous integration.** New `.github/workflows/gates.yml` runs the exact
local entry point (`tools/run-all-gates.sh`) on every push and pull request (Node 22, no
deps), plus a weekly `--full` balance run. Previously the gates only ran if a human
remembered to. No app code touched.

**B. Owner-facing docs.**
- `docs/OWNERS_GUIDE.md` — one page for a non-technical owner: what it is, how to run it,
  what "green gates" do and do **not** promise, and a "safe to share?" checklist.
- `docs/4-unit-tests/COVERAGE-DEBT.md` — the honest ledger of what stays manual (browser
  render, WebGL, Leaflet, focus traps, visual regression). It was referenced by `TESTING.md`
  and `ARCHI.md` §19 but had never been shipped.
- `README.md` module table completed: it listed ~10 modules; the runtime has 20+
  (`game.js`, `wargame.js`, `strategic-state.js`, `red-mind.js`, `forecasting.js`,
  `counterfactual*.js`, `sim-worker.js`, `cofm.js`, `moe.js`, `symbols.js`, `cinematics.js`,
  `audio.js`, `stage.js`, `share.js`, `online-flags.js`).

**C. Safety — escape imported scenario text (`StrikeSim2040.html`).** Scenario JSON is
author-controlled and can be imported at runtime. Several `innerHTML` sinks interpolated
node fields raw, an HTML-injection vector for an untrusted scenario:
- Node popup header/type/difficulty/vulnerabilities (used the popup's existing `htmlText`).
- Search-result badges (`node.name`/`node.id`, incl. the `data-node-id` attribute).
- COA target `<option>` list (`node.name`/`node.id`, incl. the `value` attribute).
- Monte Carlo "likely neutralized" node names.
All now route through an escaper (`htmlText` / `UiModule.escapeHtml`, which covers
`& < > " '`, so it is attribute-safe). Normal scenarios render identically.

**D. Accessibility + cleaner code — command-bar view switcher.** The 3D/Map/Table/Task-Org
tabs used inline `onclick="setView(...)"`. Now:
- markup carries `role="tab"` inside the existing `role="tablist"`;
- wiring moved to `wireViewSwitcher()` (delegated click handler, no inline JS);
- full keyboard support per the WAI-ARIA tabs pattern — roving `tabindex`, Arrow/Home/End
  move focus, Enter/Space/click activate. **Manual** activation (arrow moves focus only)
  so arrowing past "3D" does not force the heavy WebGL load;
- a visible `:focus-visible` outline on the tabs.

**E. Look & feel.** First-run onboarding card refresh (top-edge command accent, entrance
animation that respects `prefers-reduced-motion`, refined step badges/callout, button
hover/press states) and a small node-popup readability bump (line-height). All within the
established console theme; scoped to `#first-run-card` / `#node-popup` / `#cmd-bar`.

## 3. Proof contract / verification

- `tools/run-all-gates.sh` → **ALL GATES GREEN (18 passed)** after each step. The escaping
  and view-switcher changes are logic-in-shell, which the headless proofs do not parse, so
  they were verified in-browser (below). `map-capability-proof.js` continues to guard the
  map popup's escaping.
- Manual (localhost, Chrome): no console errors after reload; view switching works by
  mouse and by keyboard (Arrow moves focus without switching; Enter activates); the node
  popup renders names/details correctly; the onboarding card renders with accent, badges,
  and hover glow. Before/after captured for the owner.

## 4. Gates

`tools/run-all-gates.sh` → ALL GATES GREEN (18 passed).

## 5. Follow-on (not done here)

- Slim the ~6,500-line shell: extract the COA/Monte-Carlo UI and `bindEventListeners`.
- Browser/e2e automation (Playwright) to convert COVERAGE-DEBT rows into real gates.
- Keyboard-selectable nodes in the map and 3D views.
- A named `z-index` scale (carried over from CO-013 §5).
- Performance: incremental table re-render instead of full `tbody` rebuild.
