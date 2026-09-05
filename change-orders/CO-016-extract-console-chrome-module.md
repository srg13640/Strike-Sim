# CO-016 — Slim the shell: extract the Stark-HUD console-chrome into a module

*Plan of record. 2026-09-05. Branch `cursor/setup-cloud-env-4b41`.*

## 1. Why

`StrikeSim2040.html` is the project's largest file and a standing "cleaner code" target.
CO-015 found the reason it can't be slimmed casually: several proof contracts assert
against the **literal text** of the shell. This CO makes the first real, verified cut —
moving a cohesive, self-contained presentation layer out of the shell **and** updating the
one proof that depended on its text, so the gates stay honest.

## 2. Change

**Extracted `console-chrome.js` (new module).** The three trailing "Stark-HUD" `<script>`
IIFEs — lifted **verbatim** out of the shell:
- **I.** boot fade ritual + live telemetry clock (`C2 LINK` / `SECTOR` / UTC) + readout
  value-flash observer;
- **II.** synthesized audio engine (`window.StrikeSimAudio`) + DEFCON threat model and
  screen-FX bus (`window.StrikeSimFX`);
- **III.** tactical radar scope + live C2 intel ticker, driven by `AppShell` view state
  (`window.__ssAmbientLifecycle` telemetry hook preserved).

The shell now loads them with a single `<script src="console-chrome.js?v=co016">` at the
same position (end of `<body>`), so execution order/timing is unchanged and the
`window.AppShell` / `window.AppState` globals still exist when it runs. Every block keeps
its defensive `try/catch` and no-ops if those globals are absent.

**Result:** shell shrinks by ~333 lines (≈6528 → 6195), and the moved code is now covered
by the syntax gate (`node --check` over `*.js`) instead of living untested inside HTML.

**Proof repoint (`tools/performance-layer-proof.js`).** The P4 "ambient HUD work" and "HUD
ticker reduced-motion" contracts used to grep the shell for `function radarLight()`,
`radarLight()?1000:33`, `!s.hidden&&!s.overlayOpen`, `function stopTicker()`,
`s.view==='3d'&&!s.hidden&&!s.overlayOpen`, `k==='perfMode'`, and
`html.cin-rm #hud-ticker .ht-track{animation:none}`. Those now read `console-chrome.js`
(new `const consoleChrome = read('console-chrome.js')`). No other proof referenced moved
content: `runtime-performance-proof.js`, `online-layer-proof.js`, and `director-ux-proof.js`
only assert on shell text that stayed (e.g. `renderScreenIfDirty`, script include order,
import normalization), and `html.cin-rm *` at shell line 1091 is untouched.

Nothing else changed: no behavior, no CSS, no load order. Pure relocation + one proof
repoint.

## 3. Verification

- `tools/run-all-gates.sh` → **ALL GATES GREEN (18 passed)**, incl. the repointed
  performance-layer proof and a syntax check now covering `console-chrome.js`.
- `tools/build-dist.sh --skip-gates` → dist copies `console-chrome.js` (referenced module),
  ~8.5 MB, "all relative references resolve".
- Manual (localhost, Chrome, hard reload): **no console errors**; top-bar telemetry with a
  **ticking UTC clock** and **DEFCON 5** chip and sound toggle; **TACTICAL SCAN** radar on
  Map/3D; **LIVE INTEL** ticker scrolls on 3D; Keyboard Shortcuts overlay still opens with
  `?`. Screenshots + screen recording attached to the delivering message.

## 4. Gates

`tools/run-all-gates.sh` → ALL GATES GREEN (18 passed).

## 5. Follow-on (not done here)

- Next shell cuts (heavier coupling, do one at a time with proof updates): the COA builder
  and Monte-Carlo UI, and `bindEventListeners`. Each needs the same "move + repoint the
  proofs that read the shell text" discipline proven here.
- Browser/e2e automation to cover the extracted UI (see `docs/4-unit-tests/COVERAGE-DEBT.md`).
