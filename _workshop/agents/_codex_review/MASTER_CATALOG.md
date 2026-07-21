# StrikeSim 2040 Review - Master Catalog

## What To Read First
- Start with `C-001`, `C-002`, and `C-004`: these are the demo-killers.
- Read `C-008` through `C-014` before changing simulation, campaign, or War Game behavior.
- Read `C-015` through `C-018` before any SME-facing map or symbology demo.
- Read `C-029` through `C-034` before packaging the next public or external walkthrough.
- Use the source reports in the appendix for file-line evidence and implementation detail.

## Executive Summary
StrikeSim 2040 is well beyond a toy prototype: it has an offline browser architecture, a recognizable C2 visual identity, multiple operational views, COA simulation, Monte Carlo outputs, a War Game, and an NDS Campaign Planner. The review consensus is that the product is marketable if the team narrows the next release around a verified offline training and COA rehearsal workflow rather than widening the feature surface.

The biggest risk is trust. Several current claims, especially offline / air-gap operation, MIL-STD symbology, Monte Carlo confidence, and demo-ready COA simulation, can be undermined by specific code paths: online map and font requests, incomplete SIDCs, stale plan simulation, duplicated sim engines, weak session/campaign binding, and visual chrome that can overload narrow displays.

The highest-leverage path is a "demo-safe" release profile: make the app zero-network by default, fix or hide the credibility-breaking paths, add one golden workflow from mission brief to COA to Monte Carlo to War Game/export, and add notional-data/compliance language that does not overclaim operational readiness.

No agents failed to report. All 20 source reports were produced under `_codex_review/findings/`.

## Top 10 Highest-Leverage Recommendations
| Rank | Recommendation | Dimension(s) | Impact | Effort | Why |
|---:|---|---|---:|---|---|
| 1 | Ship a demo-safe release profile before external pitching | Marketability, Logic, Functionality | 5 | M | Prevents an SME from hitting wrong symbols, stale COAs, offline contradictions, or known P0 demo defects. |
| 2 | Make offline behavior the default and prove it | Functionality, Marketability, Look & Feel | 5 | M | Offline / air-gap posture is the clearest moat and currently the easiest credibility break. |
| 3 | Fix the COA -> Monte Carlo trust chain | Functionality, Logic, Look & Feel | 5 | M | The tool sells decision support; stale plans, dropped constraints, and misleading metrics directly undermine that. |
| 4 | Bind scenario, session, campaign, and War Game state with versioned metadata | Logic, Functionality, Marketability | 4 | M | Saved work must resume against the right graph with known provenance and classification. |
| 5 | Repair symbology and data taxonomy before SME demos | Logic, Functionality, Marketability | 4 | M | MIL-STD and multi-domain claims are visible first-order credibility signals. |
| 6 | Harden War Game rules around source validity, tempo, and saves | Logic | 5 | M | The War Game should feel like a rule-governed model, not a strike-button sandbox. |
| 7 | Add a scenario-specific mission card and golden workflow | Ease of Use, Marketability | 5 | M | A new operator needs one clear path through the product, not a feature inventory. |
| 8 | Add guardrails for destructive actions, unsafe text rendering, shortcuts, and modal focus | Ease of Use, Functionality | 4 | M | These are high-trust UX issues that can break demos and operator confidence. |
| 9 | Create a responsive shell and motion budget | Look & Feel, Functionality, Ease of Use | 4 | M | The HUD looks strong, but fixed rails and unbounded FX can make the product feel fragile. |
| 10 | Package the product as an evaluation kit with terms and compliance language | Marketability | 4 | S/M | Buyers need a clear name, audience, license, deployment path, and notional-data boundary. |

## Consolidated Findings Table
| Ref | Dimension | Title | Sev | Impact | Effort | Files | One-line recommendation | Source agent(s) |
|---|---|---|---|---:|---|---|---|---|
| C-001 | Marketability, Logic, Functionality | Demo claims are exposed to known credibility defects | P0 | 5 | M | README.md; _stark/audits/00-MASTER-FIXLIST.md; StrikeSim2040.html | Create a demo-safe release profile; fix or hide unsupported paths before any external pitch. | M4, M2, L1, L4, F3 |
| C-002 | Functionality, Marketability | Offline claim is contradicted by online basemaps | P1 | 5 | M | map.js; README.md | Default to offline imagery/grid; make online tiles explicit opt-in with visible status. | F2, M3 |
| C-003 | Logic | Human War Game strikes do not require valid firing sources | P1 | 5 | M | game.js; wargame.js | Use one source/method availability rule across UI, AI, queueing, and resolution. | L2 |
| C-004 | Functionality, Logic | COA simulation can run stale or mismatched plans | P1 | 5 | S/M | StrikeSim2040.html | Make builder simulation strict, invalidate wizard caches, and preserve goal-plan constraints in validation. | F3, L1, U4, M2, M4 |
| C-005 | Ease of Use, Marketability | Mission and user wedge are not explicit | P1 | 5 | M | README.md; StrikeSim2040.html | Add a scenario-specific mission card and choose one primary beachhead audience. | U1, M1, M2, M4 |
| C-006 | Look & Feel | Fixed right rail makes the battlespace unusable on narrower viewports | P1 | 5 | M | StrikeSim2040.html | Add responsive rail breakpoints and let map/3D/table reclaim width when collapsed. | V4 |
| C-007 | Look & Feel, Functionality | Turn resolution can trigger unbounded FX/timer volleys | P1 | 5 | M | wargame.js; map.js; engine.js | Add a shared FX scheduler with a per-turn budget, prioritization, aggregation, and cancellation. | V2, F1 |
| C-008 | Logic, Look & Feel | Monte Carlo metrics and labels can mislead decision-makers | P1 | 4 | S/M | StrikeSim2040.html; sim.js | Use Wilson/Jeffreys CI, distinguish all-trial vs win-conditioned metrics, and rename plan-confidence gauges. | L1, V3 |
| C-009 | Logic, Functionality | Inline, worker, and legacy simulation engines can drift | P1 | 4 | M | StrikeSim2040.html; sim-worker.js; sim.js | Extract a shared no-build sim core and add deterministic inline/worker parity checks. | L1, M4 |
| C-010 | Logic | War Game tempo, scoring, and tie rules are not rule-clear | P1/P2 | 4 | S/M | game.js | Align AP floor with copy, decide kill vs combat-power scoring, and remove Blue-default ties. | L2, L3 |
| C-011 | Logic, Functionality | Campaign and War Game resumes are not bound to the original graph | P1 | 4 | M | campaign.js; game.js | Store scenario fingerprints/hashes and block or warn before launching against mismatched graphs. | L3, F4, L2 |
| C-012 | Logic | Campaign handoff disables War Game dynamic tempo | P1 | 4 | M | campaign.js; game.js | Pass posture/base modifiers instead of fixed AP overrides unless sandbox mode is explicit. | L3 |
| C-013 | Logic, Functionality | Campaign and imported payload validation is shallow | P1 | 4 | S | campaign.js | Normalize IDs, phases, metrics, actions, and log rows before assigning imported or localStorage state. | L3, F4 |
| C-014 | Functionality, Marketability | Exported "session" JSON is not a true session format | P1 | 4 | M | StrikeSim2040.html; README.md | Split graph export from versioned session export/import that restores safe runtime state. | F4, M2, M3 |
| C-015 | Logic, Marketability | MIL-STD SIDCs are incomplete and invalid symbols can render | P1 | 4 | S/M | symbols.js; README.md | Centralize complete SIDC construction and fall back when milsymbol reports invalid output. | L4, M2, M3 |
| C-016 | Logic | Multi-domain and platform roles collapse into coarse symbols | P1 | 4 | M | symbols.js; map.js; grokblue90.json; grok150red.json | Add canonical role/symbolFunction and preserve secondary domains as capabilities or badges. | L4 |
| C-017 | Logic, Functionality | Decluttered symbols diverge from true COP geometry | P1/P2 | 4 | M | map.js | Use one display-coordinate model with leader lines or spiderfy behavior tied to true coordinates. | L4, F2 |
| C-018 | Logic, Look & Feel | Affiliation and color normalization are forked | P2 | 3 | S | symbols.js; map.js; StrikeSim2040.html | Reuse `SymbolModule.affiliation()` and override canonical `--aff-*` variables in contrast mode. | L4, V1 |
| C-019 | Functionality | Satellite basemap lacks offline fallback handling | P1 | 4 | S | map.js | Attach fallback handlers to all online tile layers, including satellite imagery and labels. | F2 |
| C-020 | Functionality | Strike FX are lost when the map is hidden | P1 | 4 | M | map.js | Queue or summarize hidden strike events and replay/persist them when Map is activated. | F2 |
| C-021 | Functionality | Replace import can overwrite all force teams | P1 | 4 | S | StrikeSim2040.html | Preserve imported `team` values by default; make force-team override explicit. | F4 |
| C-022 | Functionality | AppState scenario switching is unfinished | P2 | 3 | M | state.js; inline-datasets.js; StrikeSim2040.html | Either finish a scenario picker/export-all workflow or simplify to one active graph. | F4 |
| C-023 | Ease of Use | Core workflow is split across disconnected controls | P2/P1 | 4 | M | StrikeSim2040.html | Add a top-level Plan Workflow strip from goal plan to COA to trials to War Game/export. | U1, U2, M2 |
| C-024 | Ease of Use | Duplicate navigation and mutable view labels confuse orientation | P1 | 4 | S/M | StrikeSim2040.html | Make the command bar canonical; keep labels stable and use active state/status for current view. | U2, U1, U3 |
| C-025 | Ease of Use, Look & Feel | Left rail, right rail, War Game HUD, radar, and ticker lack one layout contract | P1/P2 | 4 | M | StrikeSim2040.html; wargame.js | Route rails/HUD through shared shell state and viewport-aware CSS variables. | U2, V4 |
| C-026 | Ease of Use | Table and task-org interactions are pointer-only | P1 | 4 | M | views.js; StrikeSim2040.html | Add keyboard-reachable sort/select/org controls with roving tabindex where needed. | U3 |
| C-027 | Ease of Use | Global shortcuts hijack native focused-control activation | P1 | 4 | S | StrikeSim2040.html | Ignore app shortcuts from buttons, links, ARIA controls, and open modals unless explicitly opted in. | U3 |
| C-028 | Ease of Use | Dialogs have ARIA shells but no focus lifecycle | P1 | 4 | M | StrikeSim2040.html | Add shared modal open/close helpers with focus trap, Escape handling, inert background, and focus restore. | U3 |
| C-029 | Ease of Use | Destructive state changes have no confirmation or undo | P1 | 4 | M | StrikeSim2040.html | Add targeted confirmations, snapshots, and an "Undo last change" toast/log action. | U4 |
| C-030 | Ease of Use, Security | Event log renders imported/user-controlled text into HTML | P1 | 4 | M | ui.js; StrikeSim2040.html | Render event rows with DOM APIs/textContent or shared escaping helpers. | U4 |
| C-031 | Look & Feel, Accessibility | High-contrast and reduced-motion coverage is incomplete | P1/P2 | 4 | M | StrikeSim2040.html; engine.js; map.js; wargame.js | Centralize visual preferences and route HUD colors, 3D FX, shake, ticker, radar, and boot through them. | U3, V1, V2 |
| C-032 | Look & Feel | Tactical radar RAF runs even while hidden | P1 | 4 | M | StrikeSim2040.html | Start/cancel radar animation from view chrome lifecycle and cap redraw frequency. | V2 |
| C-033 | Look & Feel | Monte Carlo and target-odds visualizations are not decision-grade | P1 | 4 | S/M | StrikeSim2040.html | Add visual uncertainty ranges and ranked target-odds bars using existing result arrays. | V3, L1 |
| C-034 | Look & Feel | Table hides decision-critical analysis fields | P1 | 4 | M | views.js; StrikeSim2040.html | Add an analysis-column preset for cascade score, resources, subsystem, vulnerabilities, and precise coordinates. | V3 |
| C-035 | Marketability, Look & Feel | Google Fonts dependency undercuts offline positioning | P1 | 4 | S/M | StrikeSim2040.html; README.md | Self-host fonts under `vendor/fonts/` or remove remote font calls and document the offline dependency set. | M1, M2, M4, V1, U1 |
| C-036 | Marketability | IL5/IL6 and operational C2 language overclaims evidence | P1 | 4 | S | README.md; StrikeSim2040.html; map.js | Reword to local-first/air-gap-aligned prototype and replace live-feed language with notional/simulation-safe copy. | M1, M3 |
| C-037 | Marketability | Notional-data and classification handling are not prominent enough | P1 | 4 | S/M | README.md; StrikeSim2040.html; inline-datasets.js | Add persistent UNCLASS/notional banners and stamp classification/provenance into imports, exports, and briefs. | M3, M4 |
| C-038 | Marketability | Brand, category, and offer are not locked | P1/P2 | 4 | S | README.md; StrikeSim2040.html; _stark/audits/00-MASTER-FIXLIST.md | Declare canonical name, short name, category line, beachhead audience, and non-goals. | M1, M2, M4 |
| C-039 | Marketability | Scenario extensibility lacks schema/provenance integration story | P1/P2 | 4 | M | README.md; StrikeSim2040.html | Publish `scenario.schema.json`, add metadata/provenance fields, and ship curated scenario packs. | M2, M3, F4 |
| C-040 | Marketability | Distribution, licensing, and pricing are not buyer-ready | P1 | 4 | S/M | README.md; Open StrikeSim 2040.command | Create a cross-platform evaluation ZIP plus license, third-party notices, deployment, and pricing/terms notes. | M4 |
| C-041 | Logic | Goal-plan candidate comparisons are time-seeded and not reproducible | P2 | 3 | S | StrikeSim2040.html | Use one recorded planner seed and common random numbers across candidate evaluation. | L1 |
| C-042 | Logic | Campaign score can mask a critical line-of-effort collapse | P2 | 3 | S | campaign.js | Add floor gates for critical NDS metrics and carry failures into assessments/briefs. | L3 |
| C-043 | Logic, Functionality | Persistence failures can silently lose campaign progress | P2 | 3 | S | campaign.js | Toast/log save failures and prompt export fallback when localStorage is unavailable. | L3 |
| C-044 | Functionality | Objective markers ignore active visibility filters | P2 | 3 | S | map.js | Render objective badges from visible nodes and use shared display coordinates. | F2 |
| C-045 | Functionality | Legacy COA generator/modal path is still half-present | P2 | 2 | S | StrikeSim2040.html | Remove it or expose it intentionally as a separate quick-generate path. | F3 |
| C-046 | Ease of Use | COA wizard can advance/finalize after generating no valid plan | P2 | 3 | S | StrikeSim2040.html | Block progression, show field-level causes, and offer a relax-constraints action. | U4 |
| C-047 | Ease of Use | Monte Carlo fatal errors point operators to the console | P2 | 3 | S | StrikeSim2040.html | Replace "see console" with a visible failure panel, recovery actions, and copyable diagnostics. | U4 |
| C-048 | Ease of Use | Event log has no empty state and reset erases diagnostic context | P2 | 3 | S | ui.js; StrikeSim2040.html | Add an empty row and preserve or summarize the previous run after reset. | U4 |
| C-049 | Look & Feel | CSS layers, spacing, radius, and type scale remain ad hoc | P2 | 3 | M | StrikeSim2040.html | Consolidate duplicate CSS layers and add compact spacing/radius/font/control tokens. | V1 |
| C-050 | Look & Feel | Boot and ambient timers are always-on | P2 | 3 | S | StrikeSim2040.html | Make boot first-run/skippable, pause ambient loops on hidden tabs, and honor reduced motion. | V2 |
| C-051 | Look & Feel | Task-org coverage and focus controls are narrow | P2 | 3 | M | views.js; StrikeSim2040.html | Derive teams from visible nodes and add branch collapse/focus plus a compact legend. | V3 |
| C-052 | Look & Feel | Command bar overflow and nested rail scroll traps remain | P2 | 3/4 | S | StrikeSim2040.html | Add compact/scroll/wrap behavior for actions and reduce nested scroll zones in the side rail. | V4 |
| C-053 | Marketability | SME-realism claims need visible model assumptions | P2 | 4 | M | README.md; StrikeSim2040.html; _stark/audits/00-MASTER-FIXLIST.md | Add model assumptions, symbology notes, adjudication limits, and an SME-review checklist. | M3 |

## Cross-Cutting Themes
1. Trust beats breadth. The product already has enough capability surface; the next release should make the existing core demonstrably reliable.
2. Offline is both engineering requirement and sales wedge. Online basemaps, Google Fonts, and fragile asset probes weaken the strongest differentiator.
3. State needs identity. Scenario, session, campaign, War Game, import/export, classification, and provenance need one versioned metadata story.
4. Simulation output needs plain truth. Confidence intervals, success-conditioned metrics, goal constraints, stale plans, and duplicated engines must not let numbers overstate confidence.
5. SME credibility starts on the map. SIDCs, roles, multi-domain records, affiliation colors, declutter, and classification banners are visible before any deeper logic is inspected.
6. The app needs a canonical workflow. Current controls expose power, but new operators need one obvious mission route and explicit handoffs between surfaces.
7. The HUD needs lifecycle discipline. Fixed rails, hidden animation loops, unbounded FX, and incomplete reduced-motion/high-contrast support can make a premium visual system feel brittle.

## Tradeoffs & Conflicts
| Tension | Recommended call |
|---|---|
| Offline visual richness vs air-gap truth | Default offline even if less cinematic. Make online basemaps and remote assets explicit opt-in modes. |
| Spectacle vs performance/accessibility | Preserve cinematic FX by default, but add a shared budget and honor reduced motion everywhere. |
| Realistic military language vs compliance safety | Keep the C2 aesthetic, but label feeds and data as notional/simulation unless validated and connected in an approved environment. |
| Rich analytics vs operator scanability | Add better charts and labels, but use progressive disclosure so the headline answer stays simple. |
| Exact location truth vs declutter readability | Keep true coordinates authoritative and show offset icons with leader lines or temporary spiderfy expansion. |
| Training/analysis/C2-display breadth vs sellable wedge | Lead with offline training and COA rehearsal using notional UNCLASS data; keep analytic/C2 display claims as future expansion. |

## Per-Dimension Rollup
| Dimension | P0 | P1 | P2 | Health |
|---|---:|---:|---:|---|
| Logic | 0 | 13 | 7 | Strong deterministic foundations, but simulation interpretation, War Game rules, campaign binding, and symbology mapping need trust hardening. |
| Functionality | 0 | 14 | 6 | Most major surfaces exist and work, but offline defaults, stale state, import/export semantics, and hidden-event handling are not robust enough for a demo-safe release. |
| Ease of Use | 0 | 9 | 11 | The tool has onboarding primitives and feedback, but operators still face scattered workflows, keyboard/accessibility gaps, and weak guardrails for destructive actions. |
| Look & Feel | 0 | 11 | 9 | The C2 HUD direction is credible and distinctive, but CSS tokens, responsive layout, motion policy, and data-viz legibility need consolidation. |
| Marketability | 1 | 14 | 5 | The product has a real wedge, but it needs safer claims, a tighter audience, proof of offline posture, and a buyer-ready evaluation package. |

## Recommended Sequencing
### Phase 1 - Quick Wins / Demo-Safety Gate
1. Remove or self-host Google Fonts and make the app zero-network by default.
2. Default the map to offline imagery/grid and gate online basemaps behind explicit opt-in.
3. Fix COA stale-plan execution, wizard cache invalidation, and no-valid-plan wizard progression.
4. Rename Monte Carlo "System Health" to plan-confidence language and replace the Wald interval.
5. Add persistent notional/classification language in README, first-run, app header/about, and exports.
6. Add a 7-10 minute `DEMO.md` path that exercises only verified flows.

### Phase 2 - Correctness / Robustness
1. Extract or share one no-build simulation core across inline and worker paths.
2. Add scenario/session/campaign fingerprints, schemas, provenance, and safe import validation.
3. Repair SIDC construction, platform role mapping, multi-domain handling, and shared affiliation parsing.
4. Harden War Game rules for firing source availability, tempo degradation, draw/tie outcomes, and self-contained saves.
5. Add event-log safe rendering, modal focus lifecycle, scoped shortcuts, destructive-action snapshots, and save-failure warnings.

### Phase 3 - Marketability / Polish
1. Lock canonical name, audience wedge, category line, and non-goals.
2. Package a cross-platform evaluation ZIP with launchers, checksums, offline dependency manifest, deployment notes, license/evaluation terms, and third-party notices.
3. Add scenario metadata/provenance and curated scenario packs.
4. Add mission card/golden workflow, target odds visualizations, analysis table columns, and model assumptions.
5. Implement responsive rails, War Game HUD shell integration, motion budget, high-contrast coverage, and reduced-motion policy.

## Appendix - Source Reports
All 20 assigned reports were produced. No non-responders.

### Logic
- `_codex_review/findings/01-logic/L1_sim_montecarlo.md`
- `_codex_review/findings/01-logic/L2_wargame_rules.md`
- `_codex_review/findings/01-logic/L3_campaign_model.md`
- `_codex_review/findings/01-logic/L4_data_symbology.md`

### Functionality
- `_codex_review/findings/02-functionality/F1_3d_engine.md`
- `_codex_review/findings/02-functionality/F2_map_cop.md`
- `_codex_review/findings/02-functionality/F3_coa_tools.md`
- `_codex_review/findings/02-functionality/F4_state_io.md`

### Ease of Use
- `_codex_review/findings/03-ease-of-use/U1_onboarding.md`
- `_codex_review/findings/03-ease-of-use/U2_navigation_ia.md`
- `_codex_review/findings/03-ease-of-use/U3_controls_a11y.md`
- `_codex_review/findings/03-ease-of-use/U4_feedback_errors.md`

### Look & Feel
- `_codex_review/findings/04-look-and-feel/V1_design_system.md`
- `_codex_review/findings/04-look-and-feel/V2_motion_perf.md`
- `_codex_review/findings/04-look-and-feel/V3_dataviz.md`
- `_codex_review/findings/04-look-and-feel/V4_layout_responsive.md`

### Marketability
- `_codex_review/findings/05-marketability/M1_positioning_value.md`
- `_codex_review/findings/05-marketability/M2_competitive_diff.md`
- `_codex_review/findings/05-marketability/M3_credibility_compliance.md`
- `_codex_review/findings/05-marketability/M4_gtm_packaging.md`
