# CODEX REVIEW DIRECTIVE — StrikeSim 2040 ("Operation Clear-Eyes")

> Paste this whole file into Codex as the opening prompt. It is self-contained: it
> tells you (the orchestrator) what the project is, how to divide the work across
> ~20 specialist review subagents, exactly where to write outputs, and the format to
> use. **This is a read-only assessment — do NOT modify any project code.**

---

## 0. Your role

You are the **Review Orchestrator**. You will:

1. Spin up **20 specialist review subagents** (4 per review dimension — see the roster in §5).
2. Each subagent performs a focused, **read-only** expert review of its assigned slice and writes a single Markdown report to its assigned path.
3. When all 20 have finished, **you** read all 20 reports and synthesize one prioritized, de-duplicated **`MASTER_CATALOG.md`** for the human team to act on.

Run the subagents in parallel where your harness allows (batch by dimension if you must). Do not block on any single agent for more than a reasonable timeout; note non-responders in the catalog.

---

## 1. The product (context so subagents don't re-discover it)

**StrikeSim 2040** is an offline-capable, browser-based **multi-domain strike-planning wargame / C2 visualization tool**. It renders a Blue-vs-Red force network as a 3D force-graph, overlays it on a 2D geographic map with **MIL-STD-2525** symbology, runs **Monte Carlo** course-of-action (COA) simulations, and includes a turn-based **War Game** and an **NDS Campaign Planner**.

**Status:** working prototype, recently given a cinematic "command-and-control HUD" visual overhaul. Data is **notional // UNCLASS**.

### Architecture (respect these constraints in every recommendation)
- **No build step.** Plain `<script>` tags. Each module publishes `window.<Name>Module` and aliases its public methods onto bare global names so legacy call sites keep working. **Do not propose a framework migration or bundler as a primary recommendation** (you may note it as a long-term option).
- **Single-file shell:** `StrikeSim2040.html` (~5,800 lines incl. ~1,300 lines of inline CSS) holds markup, the design system, orchestration glue, the COA UI, and part of the sim engine. It loads the modules below.
- **Offline / air-gap first (IL5–IL6 intent).** Libraries are vendored under `vendor/`. Runtime must work over `file://` or a static server with **no external network calls** (recent exception: optional Google-Fonts CDN). Treat "works fully offline" as a **first-class requirement and selling point.**
- Runs in any modern browser with WebGL.

### File map
| File | Responsibility |
|---|---|
| `StrikeSim2040.html` | App shell: markup, CSS design system, view switching, filters, modals, COA UI, inline sim engine (`simulateTrial`, `runMonteCarlo`, `evaluateGoalPlan`), HUD FX layer (boot, DEFCON, audio, radar, ticker). |
| `ui.js` | Toasts + event log primitives. |
| `state.js` | `AppState` — scenario-centric state; `activeGraph()`. |
| `sim.js` | Sim foundation: seeded RNG, profiles, stats, sim-context, `mcMixSeed`. |
| `sim-worker.js` | Web-Worker Monte Carlo path (mirror of inline trial loop). |
| `game.js` | Turn-based War Game engine: resolution, AI, objectives, tempo, serialization. |
| `wargame.js` | War Game UI/HUD over `GameModule` (+ strike FX hooks). |
| `campaign.js` | NDS Campaign Planner; metrics; War Game handoff; save/resume (localStorage `strikesim_campaign_v1`). |
| `map.js` | Leaflet 2D COP: markers, links, threat/engagement rings, offline tiles, strike arcs, tactical FX. |
| `engine.js` | 3D engine (3d-force-graph / THREE r128): lifecycle, geo mode, node sizing/colour, 3D strike beams. |
| `stage.js` | Resize / fullscreen / WebGL context-loss reliability layer. |
| `views.js` | Data table (sortable) + D3 task-org chart. |
| `symbols.js` | MIL-STD-2525 SIDC builder + milsymbol adapter (+ built-in fallback). |
| `inline-datasets.js` | Startup auto-loader for the two bundled scenarios. |
| `grok150red.json`, `grokblue90.json` | Bundled scenarios (read-only — do not edit). |
| `vendor/` | Vendored libs: THREE r128, OrbitControls, 3d-force-graph, D3 v7, Leaflet 1.9.4, milsymbol. |
| `_stark/` | Prior audit notes (useful prior art — read `_stark/audits/00-MASTER-FIXLIST.md`). |

### Recent overhaul (already done — review its quality, don't re-propose it)
Design-system CSS (Orbitron/Inter/Share Tech Mono, neon palette, glassmorphism), cinematic boot sequence, live telemetry + **DEFCON** threat meter, synthesized **Web-Audio** sound engine (offline, no asset files), strike FX (animated map tracers + 3D beams), a top-left **tactical radar scope**, a **C2 intel ticker**, plus correctness fixes (one canonical affiliation palette, air/sea/space SIDC fix, decorrelated Monte-Carlo seeding, table sorting, campaign save/resume).

---

## 2. Hard rules for every agent (orchestrator + subagents)

1. **READ-ONLY.** Do not modify, create, or delete any file **outside** `_codex_review/`. Do not run git, builds, installers, or formatters against project files.
2. **Be specific and evidence-based.** Cite `file:line` (or function name) for every finding. No vague "could be better."
3. **Respect the architecture** (no-build, single-shell, offline-first, notional data). Flag anything that breaks offline operation as high severity.
4. **Stay in your lane.** Each subagent owns exactly one slice (§5). Don't duplicate another agent's scope; if you notice a cross-cutting issue, note it briefly and tag the owning dimension so the orchestrator can merge.
5. **Severity rubric:**
   - **P0** — broken, incorrect, unsafe, or actively embarrassing in a demo.
   - **P1** — clearly should fix; meaningfully hurts correctness/UX/marketability.
   - **P2** — polish / nice-to-have.
6. **Impact** = 1–5 (user/mission value of fixing). **Effort** = S / M / L. Prefer high-impact / low-effort ("quick wins").
7. Where dimensions conflict (e.g., more FX vs. performance; max realism vs. broad marketability), **state the tradeoff** rather than asserting one side.

---

## 3. The five review dimensions (rubrics & guiding questions)

### 1) LOGIC — is it correct?
Statistical validity of the Monte Carlo engine (independent trials, seeding, confidence intervals, percentile reporting); correctness/parity of inline vs. worker `simulateTrial`; War Game rules, AI behavior, victory/objective math, tempo mechanic, deterministic serialization; campaign metric math; data-model integrity; MIL-STD-2525 SIDC correctness; geo/coordinate math. *Are results trustworthy enough for an analyst? Where could numbers silently be wrong?*

### 2) FUNCTIONALITY — does it work, robustly?
Feature completeness and failure modes across 3D, map, table, task-org, COA tools, War Game, Campaign, import/export, save/resume. Edge cases (empty filters, bad imports, missing tiles, WebGL loss, large N). Performance with the full 224-node dataset. *What breaks, hangs, or silently no-ops? What's half-wired?*

### 3) EASE OF USE — can a new operator succeed?
Onboarding/first-run, discoverability, information architecture, view switching, control clarity, keyboard support, **accessibility** (ARIA, focus, contrast, reduced-motion, screen-reader), feedback/error messaging, empty/again states, help, guardrails/undo. *Where would a first-time analyst get lost or make an irreversible mistake?*

### 4) LOOK & FEEL — is it credible and premium?
Design-system consistency (palette/type/spacing), the new HUD chrome, motion taste & restraint (is any FX gratuitous or distracting?), performance/jank of animations, data-viz legibility (Monte-Carlo results, charts, gauges, tables), layout density, responsiveness across resolutions, high-contrast mode. *Does it read as a real C2 system or as "vibe-coded"? What's tasteful vs. too much?*

### 5) MARKETABILITY — who buys/uses this and why?
Target users (training aid vs. analyst planning tool vs. command-post display), value proposition, competitive landscape & differentiation, credibility/SME-realism, notional-data & classification handling, the offline/air-gap posture as a selling point, demo/pitch readiness, packaging/deployment/distribution, plausible pricing/licensing, key objections & risks. *What's the sharpest positioning, and what's missing to sell it?*

---

## 4. Per-subagent output format (each agent writes ONE file)

Write to the assigned path (see §5). Use exactly this structure:

```markdown
# [AGENT-ID] — [Title]
- Dimension: <Logic|Functionality|Ease of Use|Look & Feel|Marketability>
- Focus: <one line>
- Files inspected: <list with versions/areas>

## Summary
<3–5 sentences: overall health of this slice.>

## Strengths
- <what's genuinely good — be fair>

## Findings
### [AGENT-ID]-01 — <short title>
- Severity: P0|P1|P2   Impact: 1–5   Effort: S|M|L
- Location: <file:line or function>
- Observation: <what you found, with evidence>
- Recommendation: <specific, actionable>
- Tradeoffs/risks: <optional>
### [AGENT-ID]-02 — ...
<repeat>

## Quick wins (top 3 high-impact/low-effort)
1. ...

## Open questions for the human review
- ...
```

Keep each report tight and skimmable. Quality over volume — 5 sharp findings beat 25 padded ones.

---

## 5. Subagent roster (the fan-out — 20 reviewers)

Spawn one subagent per row. Give each the §1 context, the §2 rules, its dimension rubric from §3, and the §4 format. Each writes to the listed path.

### LOGIC → `_codex_review/findings/01-logic/`
| ID | Focus | Primary files | Output file |
|---|---|---|---|
| L1 | Monte-Carlo & sim statistics (trial independence, seeding, CIs, percentiles, inline vs worker parity) | `sim.js`, `sim-worker.js`, `StrikeSim2040.html` (`simulateTrial`/`runMonteCarlo`/`evaluateGoalPlan`) | `L1_sim_montecarlo.md` |
| L2 | War Game rules, AI, victory/objective logic, tempo, serialization determinism | `game.js`, `wargame.js` | `L2_wargame_rules.md` |
| L3 | Campaign model, metrics, War-Game handoff, save/resume integrity | `campaign.js` | `L3_campaign_model.md` |
| L4 | Data-model integrity, MIL-STD-2525 SIDC correctness, domain/affiliation mapping, geo/MGRS | `symbols.js`, `map.js` (symbol use), `inline-datasets.js`, `grok*.json` (read-only) | `L4_data_symbology.md` |

### FUNCTIONALITY → `_codex_review/findings/02-functionality/`
| ID | Focus | Primary files | Output file |
|---|---|---|---|
| F1 | 3D engine reliability, WebGL context-loss, geo mode, perf at 224 nodes | `engine.js`, `stage.js` | `F1_3d_engine.md` |
| F2 | Map/COP features, layers, offline-tile fallback, rings, declutter, strike FX | `map.js` | `F2_map_cop.md` |
| F3 | COA builder/generator/wizard/goal-planner correctness & wiring | `StrikeSim2040.html` (COA UI), `sim.js` | `F3_coa_tools.md` |
| F4 | Import/export, AppState, scenario switching, save/resume plumbing | `state.js`, `campaign.js`, `StrikeSim2040.html` (import/export), `inline-datasets.js` | `F4_state_io.md` |

### EASE OF USE → `_codex_review/findings/03-ease-of-use/`
| ID | Focus | Primary files | Output file |
|---|---|---|---|
| U1 | Onboarding, first-run, discoverability, learnability, mission framing | `StrikeSim2040.html`, `ui.js` | `U1_onboarding.md` |
| U2 | Navigation, information architecture, view switching, panel layout | `StrikeSim2040.html` | `U2_navigation_ia.md` |
| U3 | Controls, keyboard shortcuts, **accessibility** (ARIA/focus/contrast/reduced-motion) | `StrikeSim2040.html`, `views.js` | `U3_controls_a11y.md` |
| U4 | Feedback, error handling, empty states, help, guardrails/undo | `ui.js`, `StrikeSim2040.html` | `U4_feedback_errors.md` |

### LOOK & FEEL → `_codex_review/findings/04-look-and-feel/`
| ID | Focus | Primary files | Output file |
|---|---|---|---|
| V1 | Design-system consistency (palette/type/spacing), high-contrast mode | `StrikeSim2040.html` (`:root`, CSS) | `V1_design_system.md` |
| V2 | Motion/animation taste & restraint, FX performance/jank, reduced-motion | `StrikeSim2040.html` (HUD FX), `map.js`, `engine.js`, `wargame.js` | `V2_motion_perf.md` |
| V3 | Data-viz legibility (Monte-Carlo results, gauges, charts, tables, task-org) | `StrikeSim2040.html`, `views.js` | `V3_dataviz.md` |
| V4 | Layout density, responsiveness across resolutions, overflow, the rails/HUD chrome | `StrikeSim2040.html`, `wargame.js` | `V4_layout_responsive.md` |

### MARKETABILITY → `_codex_review/findings/05-marketability/`
| ID | Focus | Output file |
|---|---|---|
| M1 | Positioning, target users, value prop, naming/branding | `M1_positioning_value.md` |
| M2 | Competitive landscape & differentiation / moat | `M2_competitive_diff.md` |
| M3 | Credibility, SME-realism, notional-data & classification handling, offline posture as a selling point | `M3_credibility_compliance.md` |
| M4 | Demo/pitch readiness, packaging/deployment, pricing/licensing, distribution, objections | `M4_gtm_packaging.md` |

*(Marketability agents may reason from the product description, the README, and a hands-on read of the UI; they don't need deep code diffing.)*

---

## 6. Orchestrator duties — write `_codex_review/MASTER_CATALOG.md`

After all subagents finish, read all 20 reports and produce a single consolidated catalog with:

1. **Executive summary** (≤1 page): overall verdict, biggest risks, biggest opportunities.
2. **Top 10 highest-leverage recommendations** (best impact-to-effort), each: title, dimension(s), impact, effort, one-line why.
3. **Consolidated findings table**, de-duplicated, sorted by Severity then Impact:
   `| Ref | Dimension | Title | Sev | Impact | Effort | Files | One-line recommendation | Source agent(s) |`
   Merge duplicates from different agents into one row (list all source agents).
4. **Cross-cutting themes** — issues that surfaced across multiple agents/dimensions.
5. **Tradeoffs & conflicts** — where dimensions pull against each other (e.g., FX richness vs. perf; realism vs. broad marketability) with a recommended call.
6. **Per-dimension rollup** — counts by severity + 2-sentence health statement each.
7. **Recommended sequencing** — Phase 1 (quick wins), Phase 2 (correctness/robustness), Phase 3 (marketability/polish).
8. **Appendix** — links to all 20 source reports + any agents that failed to report.

Keep the catalog decision-ready: the human team should be able to triage straight from the table.

---

## 7. Execution checklist

- [ ] Confirm write access to `_codex_review/` (folders already exist: `findings/01-logic … 05-marketability`).
- [ ] Launch all 20 subagents (parallel or batched by dimension) with full context + their row.
- [ ] Each writes its single report to its assigned path. Quality over volume.
- [ ] Collect; note any non-responders.
- [ ] Synthesize `_codex_review/MASTER_CATALOG.md` per §6.
- [ ] Finish with a 5-bullet "what to read first" note at the top of the catalog.

**Output root (absolute):**
`/Users/sethgilleland/Library/Mobile Documents/com~apple~CloudDocs/01_Active_Projects/Strike Sim/_codex_review/`
(Relative to repo root: `./_codex_review/`.)

Begin.
