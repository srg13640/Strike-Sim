# L3 — Campaign Model
- Dimension: Logic
- Focus: Campaign model, metrics, War-Game handoff, save/resume integrity
- Files inspected: campaign.js; wargame.js; game.js; StrikeSim2040.html; _stark/audits/00-MASTER-FIXLIST.md

## Summary
The campaign layer is a useful offline-first strategic wrapper around the existing War Game, with a compact data model and deterministic handoff entry point. The main logic risk is that campaign state is more portable than the scenario it depends on: save/resume preserves campaign metrics but not the underlying graph identity that the War Game will actually use. The War Game handoff also has two model-integrity gaps: it freezes AP in a way that disables the War Game command-tempo economy, and it compresses most strategic outcomes into a small AP/turn/seed config. Persistence is present but shallowly validated and can fail silently, which matters for an air-gapped planning tool.

## Strengths
- Campaign state is plain JSON with a schema version, explicit selected campaign/lens, copied metrics, phase log, results, and graph signal fields, which is compatible with offline/export workflows.
- Phase resolution records before/after metrics, effects, notes, action names, and score, giving the operator an audit trail that can be exported into a brief.
- The campaign model uses bounded metrics and deterministic scoring, avoiding hidden network services or build-time dependencies.
- The handoff uses `GameModule.newMatch(cfg)` with a deterministic seed, so the War Game can be launched without a framework or server dependency.

## Findings
### L3-01 — Resumed campaigns can launch against the wrong scenario graph
- Severity: P1   Impact: 4   Effort: M
- Location: campaign.js:396; campaign.js:431; campaign.js:439; campaign.js:1014; campaign.js:1030; game.js:496
- Observation: The save payload stores only a `graphSignal` summary snapshot, not a scenario identifier, graph hash, or node roster. Loading assigns `state = payload.state` and renders it, while `launchWarGameFromPosture()` later calls `window.GameModule.newMatch(cfg)`. The engine then builds the War Game board from the current `window.AppState.activeGraph()`, so a loaded campaign can be handed off to a different active scenario than the one used to create its metrics.
- Recommendation: Store a scenario fingerprint when the campaign starts, such as node IDs, team counts, objective-relevant fields, and a stable hash. On load and before War Game launch, compare the saved fingerprint to the active graph and block or warn on mismatch, with an explicit “launch anyway” option for deliberate what-if reuse.
- Tradeoffs/risks: A strict hash may reject legitimate edited scenarios, so separate “exact match” from “compatible enough” checks.

### L3-02 — Campaign handoff freezes AP and disables War Game tempo logic
- Severity: P1   Impact: 4   Effort: M
- Location: campaign.js:1025; campaign.js:1026; campaign.js:1027; game.js:483; game.js:487; game.js:517; game.js:525
- Observation: The campaign handoff always passes explicit `apBlue` and `apRed` values derived from campaign metrics. The War Game engine treats explicit AP overrides as fixed values, and sets `dynamicAp` false for those sides; `apFor()` then returns the fixed AP instead of recalculating tempo from surviving command/logistics nodes. This means a campaign-launched War Game loses the command-tempo degradation model that the War Game otherwise uses as a core C2/sustainment mechanic.
- Recommendation: Change the handoff contract to pass campaign posture as base AP or multipliers while keeping dynamic AP enabled, for example `baseApBlue`, `baseApRed`, or `postureModifiers`, instead of fixed `apBlue`/`apRed`. Reserve fixed AP overrides for tests or explicit sandbox mode.
- Tradeoffs/risks: Re-enabling dynamic AP will make campaign starts less predictable, so surface the initial AP and explain that AP may fall as C2/logistics nodes are degraded.

### L3-03 — Imported and saved payloads are only shallowly validated
- Severity: P1   Impact: 4   Effort: S
- Location: campaign.js:402; campaign.js:408; campaign.js:411; campaign.js:414; campaign.js:439; campaign.js:892; campaign.js:917; campaign.js:951
- Observation: `isValidPayload()` checks high-level types but not campaign IDs, lens IDs, phase bounds, metric numeric ranges, selected action IDs, or the shapes of log/result rows. After validation, `loadCampaign()` assigns the payload directly into module state. Render paths then dereference campaign phase data and service lenses, and `renderLog()` assumes `r.actions.join()` and `r.notes.length` exist. A malformed but schema-versioned import can therefore crash the campaign UI or create a state that cannot be reliably re-saved.
- Recommendation: Add a normalization layer after parse: validate IDs against `CAMPAIGNS`, `SERVICE_LENSES`, and `ACTIONS`; clamp metrics; coerce or drop invalid log/result rows; constrain `phaseIndex` to the selected campaign; and recompute `complete` from phase bounds.
- Tradeoffs/risks: Strict validation may reject older exported files, so keep schema migrations explicit and show a clear import error when data is dropped.

### L3-04 — Campaign score can mask critical line-of-effort collapse
- Severity: P2   Impact: 3   Effort: S
- Location: campaign.js:18; campaign.js:20; campaign.js:837; campaign.js:838; campaign.js:839; campaign.js:845
- Observation: `campaignScore()` averages seven positive metrics and two inverted risk metrics into one weighted score. The “Campaign advantage” assessment gates only on total score, escalation, and exposure, not on minimum thresholds for denial, homeland, allies, DIB, readiness, or sustainment. A campaign can therefore look recoverable or advantaged while a single NDS-critical line of effort is dangerously low, especially because the display emphasizes the aggregate score before the individual metric grid.
- Recommendation: Add floor gates for critical metrics, such as minimum denial, homeland, allies, DIB, readiness, and sustainment thresholds by campaign type. Show any failed gate in the assessment text and carry it into the exported brief.
- Tradeoffs/risks: Gates reduce the simplicity of one score, but they better match the product’s NDS-aligned campaign framing.

### L3-05 — Persistence failures can silently lose campaign progress
- Severity: P2   Impact: 3   Effort: S
- Location: campaign.js:420; campaign.js:423; campaign.js:424; campaign.js:426; campaign.js:497; campaign.js:502; campaign.js:503
- Observation: Manual save writes to `localStorage` and shows a success toast only on the happy path, but the catch path only returns `false` with no operator-visible warning. Autosave also swallows storage errors entirely. In an offline/air-gapped tool, storage quota, browser privacy settings, or file-origin restrictions can therefore make save/resume look available while campaign progress is not actually durable.
- Recommendation: Surface save/autosave failures through `toast()` and the event log, mark the persistence controls with a degraded state, and prompt the operator to use Export JSON when browser storage is unavailable.
- Tradeoffs/risks: Autosave warnings should be rate-limited to avoid noisy repeated toasts when storage is persistently unavailable.

## Quick wins (top 3 high-impact/low-effort)
1. Add strict import/load normalization for IDs, phase bounds, metric ranges, selected actions, and log/result row shapes.
2. Show a warning when manual save or autosave cannot write to `localStorage`, with Export JSON as the fallback.
3. Add campaign assessment floor gates so low DIB, sustainment, homeland, allies, or denial cannot be hidden by a healthy aggregate score.

## Open questions for the human review
- Should campaign exports be reusable as what-if posture files across scenarios, or should they be bound to the originating scenario by default?
- Should campaign posture alter War Game board resources/objectives directly, or only tune match-level parameters?
- Which NDS line-of-effort metrics are allowed to fail without forcing the campaign assessment into “failure risk”?
