# CO-013 — Overlay stacking order: decoration never paints over controls

*Plan of record. 2026-07-25. Branch `fix/CO-012-share-readiness`.*

## 1. Why

Reported from a MacBook during PLAN: the JOC comms floor rendered on top of the command
dock's primary call-to-action, leaving **"QUEUE AN ORDER TO CONTINUE"** half-illegible.

This is the third time an overlay collision has been patched (CO-008 coach-card visibility,
CO-011 comms containment during modal overlays). It kept recurring because each fix addressed
one instance rather than the cause.

**Cause:** there is no stacking scale. 28 distinct `z-index` values are scattered across six
files with no ordering discipline, and `#cin-comms` — which is `pointer-events:none`
*decoration* — sat at **3000**, above every interactive surface in the app:

| Surface | z-index | Interactive? |
|---|---|---|
| `#cin-comms` (comms floor) | **3000** | no — decoration |
| `#dir-rail` (phase rail) | 1700 | yes |
| `#dir-dock` / `#dir-feed` | 1500 | yes |
| `#fr-help-btn` ("?") | 1450 | yes |

The dock is centred (`left:50%`, `width:min(960px,94vw)`) and the comms floor is bottom-left
(`left:16px`, `width:min(430px,…)`). Below roughly 1400px of viewport they **necessarily**
overlap — so on any normal laptop the decoration covered the control. The help button was
buried by the same rule.

CO-011's `body.dir-overlay-active` fix hid comms during the *modal* phases (BRIEF/COMMIT/AAR)
and `commsVisible(false)` yields the corner during WATCH — but PLAN is neither, so nothing
applied there.

## 2. Change

One value: `#cin-comms` **z-index 3000 → 1300** (`cinematics.js:175`).

That places it above the map and the `#fx-vignette` (1250) and below every control. No
behaviour, geometry, or visibility rule changes — where the two overlap the dock now simply
paints over it, and the dock's background is 96–97% opaque with `backdrop-filter:blur(8px)`,
so the result is clean rather than a blend.

Deliberately *not* done: hiding comms during PLAN. It carries live JOC/J3 status and the
seed, and the atmosphere is part of the design. Correct stacking keeps both.

## 3. Proof contract

New in `tools/performance-layer-proof.js`:
**"P2: decoration never paints over controls — the comms floor stacks below every interactive
surface."** Parses the declared `z-index` of `#cin-comms`, `#dir-dock`, `#dir-feed`,
`#dir-rail` and `#fr-help-btn`, asserts the comms floor is `pointer-events:none`, and requires
it to stack below all four.

Verified to actually catch the regression: restoring `z-index:3000` fails with
`comms (3000) must stack below the command dock (1500)`. This generalises — any future surface
that tries to out-stack a control trips the same contract.

## 4. Gates

`tools/run-all-gates.sh` → **ALL GATES GREEN (18 passed)**, performance-layer-proof now 45
checks.

Runtime (localhost, 1280×720, PLAN phase): the CTA paints on top at every sampled point across
its full width (`dir-btn primary` wins 6/6 samples where the comms rect still overlaps);
"QUEUE AN ORDER TO CONTINUE" is fully legible; the "?" help button is visible again.

## 5. Follow-on (not done here)

A documented stacking scale — named tiers (`--z-map`, `--z-decor`, `--z-hud`, `--z-control`,
`--z-modal`) replacing the 28 ad-hoc literals — would prevent the next instance by
construction. Tier-2 work; the proof contract holds the line until then.
