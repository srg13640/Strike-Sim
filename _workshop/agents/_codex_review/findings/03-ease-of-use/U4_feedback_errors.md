# U4 — Feedback, Errors & Guardrails
- Dimension: Ease of Use
- Focus: Feedback, error handling, empty states, help, guardrails/undo.
- Files inspected: `ui.js`, `StrikeSim2040.html`, `_stark/audits/00-MASTER-FIXLIST.md`

## Summary
StrikeSim 2040 already has several useful feedback primitives: toasts, an event log, first-run help, import validation, WebGL fallback messaging, and Monte Carlo progress/status text. The main usability risk is that these primitives are not consistently tied to destructive actions or recovery paths. Several state-changing flows can overwrite or clear work without confirmation, undo, or a persistent audit trail. Error messages also sometimes collapse to console-only guidance, which is weak for an offline/air-gapped operator tool.

## Strengths
- Import validation happens before the replace path mutates the active graph, and invalid files produce event-log/toast feedback instead of silently wiping the scenario (`StrikeSim2040.html:2796-2807`, `StrikeSim2040.html:2883-2899`, `StrikeSim2040.html:2920-2922`).
- WebGL failure handling is unusually operator-friendly: it falls back to Map view and explains that Map/Table remain fully usable (`StrikeSim2040.html:3708-3712`, `StrikeSim2040.html:3802-3803`).
- Monte Carlo runs expose progress, cancel behavior, confidence interval text, and completion toasts instead of freezing silently (`StrikeSim2040.html:4922-4958`, `StrikeSim2040.html:5100-5107`, `StrikeSim2040.html:5174-5177`).
- First-run help gives a concrete starting sequence and explains the Map/War Game/3D split, with localStorage gating so it can stay out of the way after onboarding (`StrikeSim2040.html:3816-3835`, `StrikeSim2040.html:3849`).

## Findings
### U4-01 — Destructive state changes have no confirmation or undo
- Severity: P1   Impact: 4   Effort: M
- Location: `StrikeSim2040.html:2906-2912`, `StrikeSim2040.html:3009-3020`, `StrikeSim2040.html:4687-4690`, `StrikeSim2040.html:5267-5272`, `StrikeSim2040.html:5760-5771`
- Observation: The replace-import path calls `resetApplicationState()` and swaps the active graph after validation, but there is no confirmation or snapshot/undo path before the working scenario is replaced (`StrikeSim2040.html:2906-2912`). `resetApplicationState()` clears the play timer, event log, strike log, stats, selection, and highlights with no rollback handle (`StrikeSim2040.html:3009-3020`). The COA surface has the same pattern: `clearCOAPlan()` immediately empties `builtCOA`, the recommendation modal assigns `builtCOA = rec.steps.slice()` before the operator accepts anything, and wizard finalization overwrites `builtCOA` from the cached plan (`StrikeSim2040.html:4687-4690`, `StrikeSim2040.html:5267-5272`, `StrikeSim2040.html:5760-5771`).
- Recommendation: Add a centralized destructive-action guardrail: confirm for replace/reset/clear/overwrite, take a small in-memory snapshot of the previous graph or COA, and show an "Undo last change" toast/log action after completion. For replace imports, keep the prior graph until the new graph renders successfully.
- Tradeoffs/risks: A confirmation on every action can slow expert operators; make it targeted to destructive actions and allow "do not ask this session" for low-risk resets.

### U4-02 — COA wizard can advance after generating no valid plan
- Severity: P2   Impact: 3   Effort: S
- Location: `StrikeSim2040.html:5348-5354`, `StrikeSim2040.html:5732-5758`, `StrikeSim2040.html:5760-5762`
- Observation: `wizardNext()` calls `previewCOAFromWizard()` at step 3, then always advances to the next wizard step (`StrikeSim2040.html:5348-5354`). If the preview has no valid steps, the only feedback is inline text, `No valid steps. Adjust selections.`, and the wizard still reaches the final step (`StrikeSim2040.html:5732-5758`). If the operator then finalizes, the handler just previews again and returns with no toast, no event-log entry, and no field-level explanation (`StrikeSim2040.html:5760-5762`).
- Recommendation: Treat an empty `coaWizardPlanCache` as a blocking validation error: keep the operator on the configuration step, highlight the inputs that caused zero steps, and disable/hide the final generate button until a valid preview exists.
- Tradeoffs/risks: Blocking progression may frustrate exploratory use; offset that by offering a "Relax constraints" quick action that changes the minimum viable inputs automatically.

### U4-03 — Monte Carlo fatal errors send operators to the console
- Severity: P2   Impact: 3   Effort: S
- Location: `StrikeSim2040.html:5016-5019`, `StrikeSim2040.html:5178-5182`
- Observation: When the worker path fails, the app silently falls back to main-thread chunks and only records the degradation in the event log, with no toast or visible warning near the Monte Carlo controls (`StrikeSim2040.html:5016-5019`). When the whole run fails, the catch block logs the real exception to `console.error`, then both the event log and toast say only `Monte Carlo failed (see console).` (`StrikeSim2040.html:5178-5182`). That is a dead end for a browser-only field tool where the operator may not have devtools open or available.
- Recommendation: Replace "see console" with an operator-readable failure panel: include the exception message, whether the worker or main-thread path failed, recommended recovery actions such as lower trial count/retry/reset COA, and a copyable diagnostic block for support.
- Tradeoffs/risks: Exposing raw exception text can be noisy; map known failure classes to friendly messages and tuck raw details behind a "Details" disclosure.

### U4-04 — Event log has no empty state and reset erases the diagnostic trail
- Severity: P2   Impact: 3   Effort: S
- Location: `ui.js:53-70`, `StrikeSim2040.html:3009-3018`
- Observation: `renderEventLog()` renders `simEvents.slice(0, 50).map(...).join('')`, so an empty buffer becomes a blank panel instead of an explanatory empty state (`ui.js:53-66`). `clearEventLog()` drops the whole buffer, and `resetApplicationState()` calls it while also clearing the strike log and rerendering the empty event list (`ui.js:69-70`, `StrikeSim2040.html:3009-3018`). After reset, the operator loses the sequence of warnings/errors that may explain why they reset in the first place.
- Recommendation: Render an explicit empty row such as "No events yet. Run a strike, import a scenario, or open Help to get started." For resets, either add a fresh `Simulation reset` event after clearing or preserve the previous log in a collapsible "Previous run" section until the next import/export.
- Tradeoffs/risks: Preserving logs can clutter the event stream; cap the archived run and provide a clear-all action.

### U4-05 — Event-log rendering trusts imported/user-controlled text
- Severity: P1   Impact: 4   Effort: M
- Location: `ui.js:56-64`, `StrikeSim2040.html:2841-2868`, `StrikeSim2040.html:2655`, `StrikeSim2040.html:2662`
- Observation: Imported nodes are shallow-cloned with all source fields preserved and then pushed into `data.nodes` (`StrikeSim2040.html:2841-2868`). Strike/cascade event text can include node names, and failed-strike events also store `strikeName`/`targetName` metadata (`StrikeSim2040.html:2655`, `StrikeSim2040.html:2662`). The event log then renders `e.type`, `e.text`, `e.strikeName`, and `e.targetName` directly into `innerHTML` and `data-*` attributes (`ui.js:56-64`). A malformed or hostile JSON import can therefore inject markup into the live event stream or break the failed-event popup attributes.
- Recommendation: Build event rows with DOM APIs and `textContent`, or introduce one shared HTML/attribute escaping helper before any event data reaches `innerHTML`. Apply the same rule to other report/list renderers that interpolate node names.
- Tradeoffs/risks: Replacing template strings with DOM nodes is a little more verbose, but it localizes safety and prevents one bad scenario file from corrupting the UI.

## Quick wins (top 3 high-impact/low-effort)
1. Replace `Monte Carlo failed (see console).` with a visible diagnostic panel and retry/lower-trials actions.
2. Add a real empty-state row to `renderEventLog()` and emit a post-reset `Simulation reset` event.
3. Block the COA wizard from advancing/finalizing when the preview has zero valid steps.

## Open questions for the human review
- Should replace-import and reset require a hard confirmation every time, or only when the current graph/COA has unsaved changes?
- Does the event log need to be preserved/exported as part of an AAR, or is it only an in-session aid?
- Are scenario JSON imports assumed to be trusted, or should the app treat all imported scenario text as untrusted operator-provided input?
