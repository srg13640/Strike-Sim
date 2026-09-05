# CO-015 — Discoverable keyboard shortcuts, leaner shared builds, and a shell-slimming finding

*Plan of record. 2026-09-05. Branch `cursor/setup-cloud-env-4b41`.*

## 1. Why

Continuation of the owner's broad "improve the UI" mandate (wow + real players, ambitious).
This batch targets **ease of use**, **speed/size**, and makes concrete progress on
**cleaner code** — while keeping every automated gate green and the app unbroken.

## 2. Change

**A. Ease of use — Keyboard Shortcuts overlay (`shortcuts.js`, new module).** The app had
useful global shortcuts (M, Shift+M, R, Space, `[`/`]`, Esc) that were effectively
undiscoverable. New self-contained `ShortcutsModule`:
- a round "⌨" launcher button (bottom-left, beside the "?" help button);
- opens with the `?` key or the button; closes with Esc, the "×", or backdrop click;
- lists all shortcuts grouped (Views / Simulation & selection / Help) with styled key chips;
- guards: never fires `?` while typing in a field, and never opens over another
  modal/workflow layer; the shell adds `#shortcuts-overlay` to its own shortcut guard so
  its shortcuts stay suppressed while the overlay is open;
- offline, injects its own CSS, entrance animation respects `prefers-reduced-motion`.

Also: descriptive `title` tooltips on the command-bar view tabs.

**B. Speed / size — leaner shared build (`tools/build-dist.sh`).** `assets/image.png`
(~1.4 MB) is a historical design-reference screenshot cited only by
`change-orders/CO-008`; it is never fetched at runtime, yet the shared build copied it.
The build now drops it from `dist/` (the completeness check still guarantees every asset
the app *does* reference is present). Result: `dist/` builds clean at ~8.5 MB with all
relative references resolving.

**C. Cleaner code — discipline + a finding.** The new feature ships as a module rather
than adding ~250 lines to the already-oversized `StrikeSim2040.html`, and moving it into a
`.js` file also brings it under the syntax gate.

Finding while scoping a shell extraction (the bottom "Stark-HUD" boot/telemetry/radar/
ticker IIFEs): several proof contracts assert against the **literal text** of
`StrikeSim2040.html` — e.g. `performance-layer-proof.js` requires
`shell.includes('html.cin-rm #hud-ticker .ht-track{animation:none}')`, and
`runtime-performance-proof.js`, `online-layer-proof.js`, and `director-ux-proof.js` all
read the shell directly. So decomposing the shell must be paired with updating those
harnesses to read the new module files. That is a dedicated CO (with proof-harness
changes), not a drive-by extraction — deliberately deferred here to keep gates honest.

## 3. Proof contract / verification

- `tools/run-all-gates.sh` → **ALL GATES GREEN (18 passed)**; the syntax gate now also
  covers `shortcuts.js`. The overlay is shell/DOM behavior the headless proofs do not
  parse, so it was verified in-browser.
- Manual (localhost, Chrome): no console errors; both launcher buttons present; overlay
  opens by button and by `?`, closes by Esc/×; `?` correctly does nothing while typing
  "what?" into the search field; labels render correctly (3D/Map/Table/Task Org, ← →,
  Enter, M, Shift M, R, Space, `[` `]`, Esc, ?).
- `tools/build-dist.sh --skip-gates` → dist ~8.5 MB, 58 files, "all relative references
  resolve", `image.png` absent.

## 4. Gates

`tools/run-all-gates.sh` → ALL GATES GREEN (18 passed).

## 5. Follow-on (not done here)

- Shell decomposition proper: extract the Stark-HUD console-chrome IIFEs (and later the
  COA/Monte-Carlo UI) into modules **together with** updating the proofs that read the
  shell text. Tracked as the next cleaner-code CO.
- Browser/e2e automation to cover the extracted UI (see `COVERAGE-DEBT.md`).
