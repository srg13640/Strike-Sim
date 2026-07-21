# M2 — Competitive Differentiation
- Dimension: Marketability
- Focus: Competitive landscape and differentiation / moat
- Files inspected: README.md; StrikeSim2040.html; _codex_review/README.md; _stark/audits/00-MASTER-FIXLIST.md

## Summary
StrikeSim 2040 has a credible differentiation nucleus: an offline, no-backend browser tool that combines 3D force-network visualization, a 2D MIL-STD map, COA Monte Carlo, a turn-based War Game, and an NDS Campaign Planner in one local package. That bundle is unusual enough to market, especially for air-gapped training, concept exploration, and rapid rehearsal contexts where heavyweight enterprise systems are overkill. The current positioning, however, reads more like a feature inventory than a competitive wedge, and the strongest moat claim, offline/air-gap friendliness, needs tighter proof and packaging. The biggest marketability risk is that SME-visible correctness and symbology gaps can erase the perceived moat before buyers notice the architecture advantages.

## Strengths
- Offline/no-backend deployment is a real wedge: the README says there is no build step, package manager, or backend, only a static server requirement (README.md:17), and states the app runs fully offline with no runtime external network calls (README.md:11).
- The feature bundle is marketable: the product description ties together 3D force graphs, 2D geospatial MIL-STD-2525 mapping, Monte Carlo COA simulation, and War Game mode (README.md:5, README.md:6, README.md:7, README.md:8).
- The strategic-to-tactical story is differentiated: the NDS Campaign Planner can shape posture and hand it into the turn-based War Game (README.md:43, README.md:44, README.md:45).
- The app already exposes demo-friendly product surfaces: boot and header copy label it as a multi-domain command-and-control / strike wargame with NOTIONAL // UNCLASS framing (StrikeSim2040.html:1250, StrikeSim2040.html:1265).
- Local data extensibility is present: the README advertises import/export (README.md:46), and the UI exposes Export JSON / Import JSON actions (StrikeSim2040.html:1501, StrikeSim2040.html:1503, StrikeSim2040.html:1504).

## Findings
### M2-01 — The competitive wedge is buried under a feature list
- Severity: P1   Impact: 4   Effort: S
- Location: README.md:5; README.md:34; StrikeSim2040.html:1542
- Observation: The README leads with a broad tool description and then lists many capabilities under "What you can do" (README.md:5, README.md:34), while the in-app mission brief says to explore the network, build an attack plan, and run Monte Carlo before committing (StrikeSim2040.html:1542). That is useful, but it does not say what StrikeSim uniquely beats: a slide deck, a GIS viewer, a traditional wargame, a bespoke simulation, or an enterprise C2 stack.
- Recommendation: Add a short positioning block to the README and first-run UI: "StrikeSim is the offline rehearsal sandbox between static briefings and heavyweight C2/simulation suites." Then name the primary beachhead: training and planning teams that need a local, inspectable, notional, no-backend tool for COA exploration and tabletop rehearsal.
- Tradeoffs/risks: Narrower positioning may feel less ambitious, but it makes the product easier to remember, demo, and compare.

### M2-02 — The offline/air-gap moat needs an assurance package
- Severity: P1   Impact: 4   Effort: S
- Location: README.md:11; README.md:85; README.md:87; StrikeSim2040.html:16
- Observation: Offline operation is the clearest market moat: the README claims air-gap / IL5-IL6 friendliness (README.md:11), states `OFFLINE_MODE = true` blocks remote fetches (README.md:87), and describes local tile fallback behavior (README.md:88, README.md:89). But the HTML still documents Google Fonts as loaded from external URLs with an offline fallback (StrikeSim2040.html:16), which undercuts a strict "no external network calls" story during demos or security review.
- Recommendation: Self-host fonts, remove external preconnects, and add a one-page "offline assurance" note: vendored libraries, local assets, network-call policy, optional tile behavior, and expected browser permissions. Treat this as a market asset, not just an engineering cleanup.
- Tradeoffs/risks: A stricter offline package may slightly increase repo size, but it converts a claim into something a buyer or security reviewer can inspect quickly.

### M2-03 — Demo breadth dilutes the moat without a golden workflow
- Severity: P2   Impact: 3   Effort: S
- Location: README.md:36; README.md:41; README.md:43; README.md:46; _stark/audits/00-MASTER-FIXLIST.md:46
- Observation: The product spans 3D network view, Geo/Map mode, table/task-org views, COA simulation, Campaign Planner, War Game, and import/export (README.md:36, README.md:38, README.md:39, README.md:40, README.md:41, README.md:43, README.md:46). The master fix list also notes the app lacks a first-run explainer and has ambiguous active-view state ( _stark/audits/00-MASTER-FIXLIST.md:46, _stark/audits/00-MASTER-FIXLIST.md:47, _stark/audits/00-MASTER-FIXLIST.md:48). Without a guided path, a reviewer may perceive a sprawling demo instead of a focused planning workflow.
- Recommendation: Add a visible "2-minute demo path" in README and UI: Load bundled scenario -> identify HPTs -> build COA -> run Monte Carlo -> launch War Game -> export brief/AAR. Use that workflow as the competitive narrative in screenshots, README copy, and human demos.
- Tradeoffs/risks: This may de-emphasize some surfaces, but it makes the product feel coherent and easier to sell.

### M2-04 — SME-visible credibility gaps threaten differentiation
- Severity: P1   Impact: 5   Effort: M
- Location: _stark/audits/00-MASTER-FIXLIST.md:16; _stark/audits/00-MASTER-FIXLIST.md:21; _stark/audits/00-MASTER-FIXLIST.md:29; _stark/audits/00-MASTER-FIXLIST.md:83
- Observation: The existing fix list says 97 air/sea/space nodes fall back to a ground frame ( _stark/audits/00-MASTER-FIXLIST.md:16, _stark/audits/00-MASTER-FIXLIST.md:17), 49 nodes have difficulty labels silently treated as Medium ( _stark/audits/00-MASTER-FIXLIST.md:21, _stark/audits/00-MASTER-FIXLIST.md:22), and Simulate Plan can run a stale or empty plan ( _stark/audits/00-MASTER-FIXLIST.md:29, _stark/audits/00-MASTER-FIXLIST.md:30). The same file recommends fixing map credibility first and then sim/engine correctness ( _stark/audits/00-MASTER-FIXLIST.md:83, _stark/audits/00-MASTER-FIXLIST.md:84, _stark/audits/00-MASTER-FIXLIST.md:85).
- Recommendation: Before any serious competitive demo, fix the map symbology, difficulty table, and COA simulation wiring. Marketability depends less on adding another feature and more on making the existing visual and analytic claims survive SME inspection.
- Tradeoffs/risks: This slows new feature development, but it protects the core trust signal that differentiates the tool from generic visualization demos.

### M2-05 — Data extensibility is present but not yet a defensible integration story
- Severity: P1   Impact: 4   Effort: M
- Location: README.md:46; README.md:95; README.md:114; StrikeSim2040.html:1286; _stark/audits/00-MASTER-FIXLIST.md:39
- Observation: The README documents simple JSON scenarios with `nodes` and `links` (README.md:95) and names two bundled scenarios (README.md:114, README.md:115), while the UI provides an Import Data File modal and JSON import/export buttons (StrikeSim2040.html:1286, StrikeSim2040.html:1291, StrikeSim2040.html:1503, StrikeSim2040.html:1504). But the master fix list says import can wipe the live scenario before schema validation ( _stark/audits/00-MASTER-FIXLIST.md:39, _stark/audits/00-MASTER-FIXLIST.md:40). For competitive differentiation, "bring your own scenario" needs schema versioning, validation, provenance, and safe failure behavior.
- Recommendation: Publish `scenario.schema.json`, add schema/version/provenance fields, validate before replacement, and ship 2-3 curated scenario packs. Position this as the bridge between an offline sandbox and unit-specific planning/training data.
- Tradeoffs/risks: Stronger schema discipline can slow ad-hoc data loading, but it creates a more credible integration moat and prevents demo-killing data loss.

## Quick wins (top 3 high-impact/low-effort)
1. Add a README positioning box: "offline rehearsal sandbox between slides and heavyweight C2/simulation suites," with one named beachhead audience.
2. Remove remote Google Fonts and add a short offline-assurance note listing vendored dependencies and network-call expectations.
3. Add a first-run / README "golden workflow" that walks from scenario load to COA, Monte Carlo, War Game, and exported brief/AAR.

## Open questions for the human review
- Is the intended buyer/user primarily an Army training cell, an operational planning staff, a defense innovation demo audience, or a public dual-use game audience?
- Should StrikeSim avoid naming enterprise C2/simulation competitors directly, or explicitly position as a lightweight complement to them?
- Is the strongest go-to-market artifact a live browser demo, an offline ZIP bundle, a scenario-design kit, or a polished public-facing game mode?
- What level of accuracy should be claimed publicly: training aid, concept exploration, COA sandbox, or decision-support prototype?
