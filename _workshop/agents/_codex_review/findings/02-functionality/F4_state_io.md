# F4 — State & Import/Export Functionality
- Dimension: Functionality
- Focus: Import/export, AppState, scenario switching, save/resume plumbing
- Files inspected: state.js; campaign.js; StrikeSim2040.html; inline-datasets.js; _stark/audits/00-MASTER-FIXLIST.md

## Summary
StrikeSim 2040 has useful foundations for offline state handling: a dedicated AppState owner, guarded import validation, local campaign autosave, and file://-friendly bundled scenario loading. The main weakness is that "session" export/import is not a true resume path: the exported JSON contains more than the importer restores, and replace import can overwrite force affiliation. Campaign persistence is stronger than the main graph path, but it validates too little and is not bound to the scenario graph it was derived from. Scenario switching is still mostly a state-model promise rather than an operator-facing capability.

## Strengths
- AppState gives the shell one owner for the active graph and keeps replace-import synchronized through `replaceActiveGraph` rather than assigning a stray global graph object.
- The main import path validates normalized graph data before destructive replace, which directly addresses the prior audit issue that parseable junk could wipe a live session.
- Campaign mode has a versioned localStorage payload, manual save/load/export/import controls, and debounced autosave after campaign mutations.
- `inline-datasets.js` reuses the same import helpers as manual import and preserves bundled scenario link IDs with `keepOriginalIds`.

## Findings
### F4-01 — Main "session" export does not round-trip as a session
- Severity: P1   Impact: 4   Effort: M
- Location: StrikeSim2040.html:2782; StrikeSim2040.html:2809; StrikeSim2040.html:2907
- Observation: `exportJSON()` writes `{ data, simStats, settings }` to `mdsc_session_YYYY-MM-DD.json`, but the import normalizer only returns `data.nodes` and `data.links` from that object, and replace import calls `resetApplicationState()` before swapping the active graph. That means an exported "session" cannot restore sim time, simStats, settings, filters, selected/highlight state, COA/Monte Carlo state, event history, or current view.
- Recommendation: Split the formats explicitly: `Export Graph` for nodes/links and `Export Session` with a versioned schema plus an `importSession()` path that restores graph, runtime settings, planner/COA state, and UI state where safe. Rename the current button/file if it remains graph-only.
- Tradeoffs/risks: Restoring every UI flag can reintroduce stale DOM assumptions; start with graph + simStats + settings + COA/MC inputs, then add view/filter state after validation.

### F4-02 — Replace import can turn a mixed-force session into one team
- Severity: P1   Impact: 4   Effort: S
- Location: StrikeSim2040.html:1295; StrikeSim2040.html:2906
- Observation: The import modal always has an "Assign to Team" selector, defaulting to Blue, and the replace path runs `importedData.nodes.forEach(node => node.team = assignedTeam)`. Importing a previously exported Red/Blue session through Replace Graph will overwrite every node's existing team with the selected value, destroying force balance and downstream Blue-vs-Red logic.
- Recommendation: Preserve existing `node.team` values on replace by default. Make team override explicit with a separate checkbox such as "force all imported nodes to selected team," and apply the current team selector only to raw data that lacks team fields or to Add mode.
- Tradeoffs/risks: Some legacy PLA-only imports may rely on forced team assignment; keep that behavior available, but not as the silent default for full-graph/session imports.

### F4-03 — Campaign JSON validation accepts IDs and phase indexes that render code cannot handle
- Severity: P1   Impact: 3   Effort: S
- Location: campaign.js:402; campaign.js:431; campaign.js:890
- Observation: `isValidPayload()` only checks that `campaignId` and `selectedLensId` are strings, `phaseIndex` is a number, and a few arrays/objects exist. `loadCampaign()` then assigns the payload directly to module state and renders, while `renderCampaign()` immediately dereferences `campaignById(state.campaignId)` and `c.phases[state.phaseIndex]`. A syntactically valid but semantically invalid campaign file can therefore break the campaign UI instead of being rejected.
- Recommendation: Validate `selectedCampaignId`, `selectedLensId`, `state.campaignId`, `state.lensId`, and `phaseIndex` against `CAMPAIGNS` and `SERVICE_LENSES`; clamp or reject out-of-range phases; validate log/result row shapes before assignment.
- Tradeoffs/risks: Older saved files with renamed campaign IDs need a migration map if campaign names change.

### F4-04 — Campaign resume is detached from the scenario graph it assessed
- Severity: P2   Impact: 3   Effort: M
- Location: campaign.js:396; campaign.js:431; campaign.js:1014
- Observation: Campaign saves include `graphSignal` as a copied summary, not the graph identity or graph snapshot. Loading a campaign restores campaign state from localStorage/JSON, but launching the War Game later only derives AP/turn/seed from campaign metrics and calls `window.GameModule.newMatch(cfg)` against whatever graph is currently active. A saved campaign can therefore be resumed against a different or freshly auto-loaded board without warning.
- Recommendation: Store a lightweight scenario fingerprint with campaign state, such as node/link counts plus a sorted node-id hash and source label. On load and before War Game handoff, warn or block if the active graph fingerprint differs; for full session export, include both campaign state and graph state.
- Tradeoffs/risks: Hashing the whole graph on every mutation is unnecessary; compute the fingerprint at campaign start, save/load, and handoff only.

### F4-05 — AppState models multiple scenarios, but switching/resume is not wired to the operator workflow
- Severity: P2   Impact: 3   Effort: M
- Location: state.js:38; state.js:53; state.js:79; inline-datasets.js:20; inline-datasets.js:57; StrikeSim2040.html:2909
- Observation: `AppState` has a `scenarios` array, `createScenario()`, `setActive()`, and `list()`, but the comments still describe the switcher UI as future work. The bundled Red and Blue files are auto-loaded by repeatedly calling `addImportedNodes()` into the active graph, and replace import swaps only the active graph with `AppState.replaceActiveGraph()`. Operators therefore cannot keep named scenarios, switch between them, or export/import the AppState scenario collection.
- Recommendation: Either finish the scenario feature with a small scenario picker plus create/duplicate/delete/export-active/export-all actions, or reduce the state contract to a single active graph until scenario switching is ready. Keep it no-build/offline: plain DOM controls and JSON schemas are enough.
- Tradeoffs/risks: A real scenario collection raises UX questions around shared COAs, campaign saves, and War Game state; define whether those attach to a scenario or remain global.

## Quick wins (top 3 high-impact/low-effort)
1. Preserve existing node teams on Replace Graph unless the user explicitly chooses a force-team override.
2. Add campaign semantic validation for known campaign/lens IDs and legal phase bounds before assigning imported/localStorage payloads.
3. Rename the current main export to `Export Graph JSON` or implement a versioned session importer that restores the non-graph fields it already exports.

## Open questions for the human review
- Should "session" mean only the force graph, or should it restore COA, Monte Carlo, campaign, War Game, filters, view mode, and event log?
- Should campaign state be scenario-scoped, or can one campaign intentionally hand off to any active graph?
- Does the product need multiple named scenarios in one browser session now, or is a reliable single-scenario save/resume path the higher priority?
