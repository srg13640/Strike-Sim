# M3 — Credibility, Compliance & Offline Posture
- Dimension: Marketability
- Focus: Credibility, SME-realism, notional-data and classification handling, offline posture as a selling point.
- Files inspected: README.md; StrikeSim2040.html; map.js; inline-datasets.js; _codex_review/README.md; _stark/audits/00-MASTER-FIXLIST.md

## Summary
StrikeSim 2040 has a strong marketable core: browser-native, no-build, vendored-library operation with credible multi-domain surfaces. The biggest marketability risk is that the strongest sales claim, offline / air-gap / IL-friendly operation, is currently overstated because the map defaults to online tile services. The second major risk is compliance framing: realistic target examples and auto-loaded bundled scenarios are presented without an obvious notional-data, classification, or export-control banner. Tightening the offline default, labeling data provenance, and separating prototype realism from validated SME fidelity would make the product much easier to show to defense-adjacent audiences.

## Strengths
- The README states a clear differentiated product position: offline-capable browser-based multi-domain strike planning with 3D graph, MIL-STD-2525 map symbology, Monte Carlo COA simulation, and War Game support (README.md:5, README.md:7, README.md:8).
- The deployment story is unusually strong for constrained environments: no build step, no package manager, no backend, and only a static file server required (README.md:17, README.md:29, README.md:30).
- The architecture already supports an offline story through vendored libraries and local modules, including Three.js, 3d-force-graph, D3, Leaflet, and local app modules (README.md:57, README.md:68).
- The map code includes user-facing basemap status signals and offline fallbacks rather than silently failing when local assets are absent (map.js:141, map.js:156, map.js:158).
- The review workspace explicitly frames this as a read-only multi-agent product assessment across logic, functionality, usability, look and feel, and marketability ( _codex_review/README.md:3, _codex_review/README.md:16).

## Findings
### M3-01 — Offline claim is contradicted by default online basemaps
- Severity: P1   Impact: 5   Effort: M
- Location: README.md:11; README.md:85; map.js:170; map.js:175; map.js:179; map.js:194; map.js:196
- Observation: The README says the prototype runs fully offline, is air-gap / IL5-IL6 friendly, and makes no external network calls at runtime (README.md:11, README.md:85). The map module, however, defines online Carto and Esri tile layers (map.js:175, map.js:179), adds the online dark layer by default (map.js:194), and sets the status to `Basemap: dark (online)` (map.js:196). This is a direct credibility break for the offline posture.
- Recommendation: Make offline imagery or the blank/local grid the default. Gate online basemaps behind an explicit opt-in query flag or UI toggle with a warning, and update the README to say exactly which modes are zero-network by default.
- Tradeoffs/risks: Defaulting offline may reduce visual polish on first launch, but it protects the core air-gap sales claim.

### M3-02 — IL5-IL6 language overreaches the evidence in the repo
- Severity: P1   Impact: 4   Effort: S
- Location: README.md:10; README.md:11; README.md:87; map.js:293; map.js:297; map.js:311
- Observation: The README labels the tool a working prototype and says it is `IL5-IL6 friendly` (README.md:10, README.md:11). The only concrete compliance evidence is technical-local behavior such as `OFFLINE_MODE = true` blocking remote fetches (README.md:87) and local tile probing through relative paths (map.js:293, map.js:297, map.js:311). That is useful engineering posture, but it is not the same as an ATO boundary, RMF package, STIG hardening, or authority to process classified / CUI data.
- Recommendation: Replace `IL5-IL6 friendly` with safer language such as `local-first / air-gap-aligned prototype; no authority to process classified or CUI data unless deployed inside an approved environment.` Add a short compliance section listing what exists today and what is not claimed.
- Tradeoffs/risks: Softer wording may feel less compelling, but it prevents a procurement or security reviewer from dismissing the product as naive.

### M3-03 — Notional-data handling is not front-and-center despite realistic targets
- Severity: P1   Impact: 4   Effort: S
- Location: README.md:26; README.md:95; README.md:99; README.md:100; README.md:110; inline-datasets.js:4; inline-datasets.js:6; StrikeSim2040.html:3825; StrikeSim2040.html:3827
- Observation: The app auto-loads bundled Red and Blue scenarios on boot (README.md:26; inline-datasets.js:4, inline-datasets.js:6). The documented example includes a real-world-style target name, `CMC Joint Operations Command Center Beijing`, with latitude and longitude (README.md:99, README.md:100, README.md:110). The first-run orientation copy explains the Blue-vs-Red wargame and simulation flow (StrikeSim2040.html:3825, StrikeSim2040.html:3827), but the inspected product surfaces do not show an equally prominent `notional // unclassified training data` banner.
- Recommendation: Add a persistent classification/notional banner in the header or first-run card, plus a README section stating data is synthetic/notional unless explicitly imported by an authorized user. Use the same language in exported briefs and JSON.
- Tradeoffs/risks: A banner adds visual weight, but it is standard for defense demos and reduces first-meeting friction.

### M3-04 — Scenario and export format lacks provenance/classification metadata
- Severity: P2   Impact: 4   Effort: M
- Location: README.md:46; README.md:95; README.md:114; README.md:143
- Observation: The README says users can import additional scenarios or export the current graph as JSON (README.md:46), and defines scenarios primarily as `nodes` and `links` arrays (README.md:95, README.md:114). It also notes campaign brief export (README.md:143). There is no documented required metadata for classification level, caveats, source/provenance, scenario owner, releasability, or synthetic/notional status.
- Recommendation: Add a top-level scenario metadata block and stamp it into every import/export path. Minimum fields should include `classification`, `data_caveat`, `scenario_type`, `source`, `owner`, `created_at`, `last_reviewed_at`, and `release_authority`.
- Tradeoffs/risks: Existing scenario JSON will need a backward-compatible default, likely `UNCLASSIFIED//NOTIONAL` or `UNKNOWN - DO NOT DISTRIBUTE` until reviewed.

### M3-05 — SME-realism claims need visible validation artifacts
- Severity: P2   Impact: 4   Effort: M
- Location: README.md:7; README.md:41; README.md:43; StrikeSim2040.html:5894; StrikeSim2040.html:5896; _stark/audits/00-MASTER-FIXLIST.md:82; _stark/audits/00-MASTER-FIXLIST.md:84
- Observation: Product copy claims MIL-STD-2525 symbology, Monte Carlo COA simulation, and an NDS Campaign Planner (README.md:7, README.md:41, README.md:43). The boot sequence reinforces this with `initializing C2 core` and `calibrating MIL-STD-2525 symbology` (StrikeSim2040.html:5894, StrikeSim2040.html:5896). The internal master fixlist still ranks `Map credibility` first and calls sim/engine correctness the `SME-credibility core` ( _stark/audits/00-MASTER-FIXLIST.md:82, _stark/audits/00-MASTER-FIXLIST.md:84), which means the product is making high-fidelity claims before the validation trail is visible.
- Recommendation: Add a `Credibility Notes` or `Model Assumptions` panel covering symbology standard, Monte Carlo assumptions, adjudication limits, and campaign-planner heuristics. Pair that with a short SME-review checklist in the repo so demos can distinguish `prototype-realistic` from `validated doctrine model`.
- Tradeoffs/risks: Calling out assumptions may expose limitations, but it builds trust with military users who will otherwise infer hidden overclaiming.

## Quick wins (top 3 high-impact/low-effort)
1. Change the default map to offline imagery/grid and make online basemaps explicit opt-in.
2. Add a persistent `UNCLASSIFIED // NOTIONAL TRAINING DATA` banner to the first-run card, header, exports, and README.
3. Reword `IL5-IL6 friendly` into safer local-first compliance language and list what is not claimed.

## Open questions for the human review
- What classification banner language is acceptable for this project: `UNCLASSIFIED//NOTIONAL`, `CUI-not-approved`, or another house style?
- Should the bundled Red/Blue scenarios be treated as synthetic demo data, real-world-inspired training data, or placeholder data requiring replacement before external demos?
- Is the target market a public dual-use demo, internal Army training prototype, defense-contractor handoff, or ATO-bound operational pilot?
- Who is the intended SME validator for MIL-STD symbology, Monte Carlo assumptions, and NDS campaign logic?
