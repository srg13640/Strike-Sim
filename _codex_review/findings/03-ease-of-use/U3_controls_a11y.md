# U3 — Controls & Accessibility
- Dimension: Ease of Use
- Focus: Controls, keyboard shortcuts, ARIA/focus behavior, contrast, and reduced-motion handling
- Files inspected: `StrikeSim2040.html`, `views.js`, `_stark/audits/00-MASTER-FIXLIST.md`

## Summary
StrikeSim 2040 has useful accessibility groundwork: most sidebar controls are native buttons, key view/status regions use ARIA, the intro dialog is offline-safe, and the UI exposes a visible shortcut hint. The current checkout also appears to have addressed part of the older active-view problem by adding active states and `aria-pressed`/`aria-selected` updates for view controls. The biggest remaining usability risk is that several high-value surfaces are still mouse-first: table rows, org-chart nodes, modal workflows, and global shortcuts do not behave predictably for keyboard-only users. Contrast and reduced-motion support exist, but they are partial and bypassed by newer HUD/FX code.

## Strengths
- The app exposes a persistent shortcut hint for core actions instead of hiding keyboard behavior entirely (`StrikeSim2040.html:1541`, `StrikeSim2040.html:1543`).
- The primary sidebar controls are native `<button>` elements, which is the right baseline for keyboard and screen-reader operation (`StrikeSim2040.html:1477`, `StrikeSim2040.html:1496`).
- View state is announced through a live status region, and left-rail view toggles now update `aria-pressed` (`StrikeSim2040.html:1541`, `StrikeSim2040.html:2229`).
- Dialog markup uses `role="dialog"` and `aria-modal="true"` on the main modal shells (`StrikeSim2040.html:1286`, `StrikeSim2040.html:1334`).
- High-contrast mode exists as a first-class control and CSS mode rather than being an afterthought (`StrikeSim2040.html:1488`, `StrikeSim2040.html:956`).

## Findings
### U3-01 — Table and task-org interactions are pointer-only
- Severity: P1   Impact: 4   Effort: M
- Location: `views.js:51`, `views.js:54`, `views.js:219`, `views.js:221`, `views.js:378`, `views.js:390`, `StrikeSim2040.html:1457`
- Observation: Sortable table headers are wired with `cursor: pointer` and `click` listeners only, table rows select nodes only through row `click`, and task-org SVG nodes are clickable `<g>` groups with no keyboard equivalent. The org-chart hint explicitly teaches “Click”, “Drag”, “scroll”, and “click nodes” as the available interaction model.
- Recommendation: Make every selectable/sortable item reachable from the tab order. For the table, put a real `<button>` in each sortable `<th>` and add a visible row action such as “Select”. For the org chart, add `tabindex="0"`, `role="button"`, useful `aria-label`s, and shared Enter/Space handlers for expand/collapse/select; also expose pan/zoom/reset controls outside pointer gestures.
- Tradeoffs/risks: Adding many tab stops to 224 nodes can become noisy, so use roving tabindex or a “selected org node” navigation model rather than making every SVG node permanently tabbable.

### U3-02 — Global shortcuts can hijack native keyboard activation
- Severity: P1   Impact: 4   Effort: S
- Location: `StrikeSim2040.html:3420`, `StrikeSim2040.html:3423`, `StrikeSim2040.html:3432`, `StrikeSim2040.html:3466`
- Observation: `isTypingTarget` only exempts `input`, `textarea`, `select`, and `contentEditable` targets, then the global `keydown` handler prevents default on Space and toggles pause. Focused buttons, links, modal controls, panel handles, and ARIA-button elements are not exempt, so pressing Space on a focused control can toggle simulation pause instead of activating that control.
- Recommendation: Before handling app shortcuts, return early for interactive elements such as `button`, `a[href]`, `[role="button"]`, `[role="tab"]`, summary/details controls, and any element inside an open modal unless it explicitly opts into shortcuts. Consider moving high-impact commands like Monte Carlo run behind modifier shortcuts or a command-palette style handler.
- Tradeoffs/risks: Some operators may like single-key shortcuts in the main canvas; keep them there, but scope them to the canvas/body when no focused control is active.

### U3-03 — Dialogs have ARIA shells but no focus lifecycle
- Severity: P1   Impact: 4   Effort: M
- Location: `StrikeSim2040.html:1311`, `StrikeSim2040.html:1321`, `StrikeSim2040.html:1333`, `StrikeSim2040.html:5291`, `StrikeSim2040.html:5296`, `StrikeSim2040.html:5317`, `StrikeSim2040.html:5324`, `StrikeSim2040.html:5815`, `StrikeSim2040.html:3435`
- Observation: Main modals declare dialog semantics, but open/close flows only flip `style.display`. There is no evidence that opening a modal moves focus to the dialog, traps focus within it, restores focus to the launching control, marks the background inert, or lets Escape close the active dialog. Escape is currently consumed by the global shortcut handler to clear node selection.
- Recommendation: Add shared `openModal(modal, launcher)` and `closeModal(modal)` helpers. On open, save the launcher, focus the first meaningful control or heading, trap Tab within the modal, and suspend global shortcuts. On close, restore focus and support Escape/backdrop close consistently where safe.
- Tradeoffs/risks: The COA wizard has multi-step state; focus restoration should return to the launch button on cancel, but to the next logical plan action after successful generation.

### U3-04 — Command-bar view switcher uses an incomplete tab pattern
- Severity: P2   Impact: 3   Effort: S
- Location: `StrikeSim2040.html:1268`, `StrikeSim2040.html:1272`, `StrikeSim2040.html:2237`, `StrikeSim2040.html:2240`
- Observation: The command-bar view switcher is marked `role="tablist"`, but its children are plain buttons without `role="tab"`, `aria-controls`, or roving arrow-key behavior. JavaScript sets `aria-selected` on those buttons, which implies a tab interface that is not fully implemented.
- Recommendation: Pick one pattern and finish it. Either make the switcher a `role="group"` of normal toggle buttons using `aria-pressed`, or implement the full tab pattern with `role="tab"`, `aria-controls`, `aria-selected`, roving tabindex, and Left/Right/Home/End keyboard support.
- Tradeoffs/risks: A `role="group"` is probably simpler here because the views are major app modes, not conventional tab panels.

### U3-05 — Contrast and reduced-motion preferences are only partially honored
- Severity: P2   Impact: 3   Effort: M
- Location: `StrikeSim2040.html:956`, `StrikeSim2040.html:970`, `StrikeSim2040.html:1066`, `StrikeSim2040.html:1071`, `StrikeSim2040.html:1100`, `StrikeSim2040.html:1213`, `StrikeSim2040.html:1214`, `StrikeSim2040.html:1022`, `StrikeSim2040.html:5927`, `StrikeSim2040.html:5947`, `StrikeSim2040.html:5957`, `StrikeSim2040.html:6054`, `StrikeSim2040.html:6069`
- Observation: High-contrast mode overrides core variables, but newer HUD text uses hard-coded muted blues like `#6f93ad`, `#7fa6c2`, and `#5f86a0`, so those labels do not inherit the high-contrast palette. Reduced-motion support exists, but many HUD/FX paths still inject animation styles or run continuous canvas animation, including value flashes, screen shake, DEFCON blink, ticker movement, and the radar `requestAnimationFrame` loop.
- Recommendation: Centralize visual preferences. Replace hard-coded HUD muted colors with variables that `body.high-contrast` overrides, and add a single `prefersReducedMotion`/user-toggle gate that disables screen shake, pulsing/blinking, ticker animation, value flash, and nonessential radar animation. Extend the reduced-motion CSS rule to transitions as well as animations.
- Tradeoffs/risks: Some motion contributes to the tactical feel; preserve it for default mode, but make reduced-motion deterministic and visibly calmer for sensitive users.

## Quick wins (top 3 high-impact/low-effort)
1. Scope the global `keydown` handler so Space/Enter on focused buttons and controls are never intercepted.
2. Add a shared modal helper that focuses the first control, closes on Escape, restores focus, and disables app-wide shortcuts while open.
3. Convert the command-bar `role="tablist"` to a simple `role="group"` with `aria-pressed`, unless you want to implement the full tab keyboard model.

## Open questions for the human review
- Should single-key `M` remain allowed to launch a 10,000-trial Monte Carlo run, or should high-cost actions require a modifier/confirmation?
- Is keyboard access expected for full map/org-chart navigation, or is the near-term acceptance bar selection/sort/filter parity only?
- Should high-contrast and reduced-motion be saved as user preferences in local storage, like the first-run intro state?
