# L4 — Data & Symbology Logic
- Dimension: Logic
- Focus: Data-model integrity, MIL-STD-2525 SIDC correctness, domain/affiliation mapping, and geo/MGRS implications.
- Files inspected: symbols.js, map.js, inline-datasets.js, grokblue90.json, grok150red.json, _stark/audits/00-MASTER-FIXLIST.md

## Summary
StrikeSim has a solid offline-first symbology seam: `symbols.js` exposes a small public API, `map.js` consumes it without hard Leaflet coupling, and the bundled scenarios keep stable IDs and valid lat/lon values. The weakest logic is the translation layer from game taxonomy to operational symbology: SIDCs are not complete MIL-STD-2525C identifiers, multi-domain records collapse to one dimension, and coarse `type` fields erase platform-specific roles such as air defense. Geo display is also not strictly faithful because marker decluttering changes plotted coordinates while rings and other overlays stay at true coordinates. No MGRS/grid fields were present in the bundled scenario records inspected, so grid-reference workflows appear absent rather than partially implemented.

## Strengths
- `symbols.js` cleanly separates affiliation, domain, function, health, and rendering, which gives the app a practical seam for swapping in vendored `milsymbol.js` without a framework or build change.
- `inline-datasets.js` uses relative bundled scenario paths and the app import pipeline, preserving offline/air-gap behavior and avoiding a second parser path.
- Bundled red/blue scenario IDs are unique, teams are consistently populated as `red` or `blue`, and sampled latitude/longitude values are numeric and in valid ranges.
- `map.js` applies Pacific-centered longitude normalization consistently across markers, links, range rings, objective markers, and strike effects.

## Findings
### L4-01 — MIL-STD-2525C SIDCs are incomplete and invalid symbols can still render
- Severity: P1   Impact: 4   Effort: S
- Location: symbols.js:193, symbols.js:231, symbols.js:234, symbols.js:259, symbols.js:263
- Observation: The adapter advertises a "real MIL-STD-2525C" path, but `sidcFor()` returns only `S` + affiliation + dimension + status + the six-character function ID, e.g. a 10-character code, with no explicit positions for symbol modifiers, country code, or order of battle. The render path builds the same shortened SIDC at symbols.js:259; then if `milsymbol` creates an object but `isValid()` is false, symbols.js:263-265 still keeps that object and can return `sym.asSVG()` instead of falling back to the built-in renderer.
- Recommendation: Add one canonical SIDC builder that emits a complete normalized 2525C SIDC with all required trailing positions populated, use it from both `sidcFor()` and `milSymbol()`, and return `null` when all `milsymbol` attempts are invalid so the built-in fallback is actually used.
- Tradeoffs/risks: Tightening validity may initially expose records that were previously masked by permissive `milsymbol` behavior, but that is preferable to silently showing generic or invalid tactical symbols.

### L4-02 — Affiliation normalization differs between symbol frames and map halos
- Severity: P2   Impact: 3   Effort: S
- Location: symbols.js:32, symbols.js:34, symbols.js:35, map.js:438, map.js:440, map.js:441
- Observation: `SymbolModule.affiliation()` accepts aliases such as `enemy`, `opfor`, `friendly`, and `blufor`, and it prioritizes `affiliation` over `team`. The map halo helper uses a separate parser that prioritizes `team` over `affiliation` and only recognizes `blue|friend`, `red|hostile`, and `green|neutral`. An imported node with `affiliation: "friendly"` would receive a friendly symbol frame from `symbols.js` but an unknown yellow blip/fallback color from `map.js`.
- Recommendation: Remove the duplicate affiliation parser in `map.js` and call `window.SymbolModule.affiliation(n)` or a shared canonical helper for all symbol, halo, fallback marker, ring, and FX color decisions.
- Tradeoffs/risks: Existing CSS color expectations may shift slightly once all surfaces share the same canonical affiliation mapping.

### L4-03 — Multi-domain records are collapsed to the first listed domain
- Severity: P1   Impact: 4   Effort: M
- Location: symbols.js:40, symbols.js:42, symbols.js:224, grok150red.json:2590, grok150red.json:3014
- Observation: `domainOf()` returns only `domain[0]` when a record carries an array, and `dimOf()` then maps only that single value into the SIDC battle dimension. Current data includes true multi-domain records such as `CV-16 Liaoning Carrier Group` with `domain: ["Sea", "Air"]` and `J-16D EW Aircraft Squadron` with `domain: ["Air", "EW"]`; the second domain is ignored for both built-in symbols and `milsymbol` SIDCs.
- Recommendation: Split the data model into `primaryDomain` plus `domains` or `capabilities`, then make symbology choose a documented primary platform dimension while preserving secondary domains for filters, badges, tooltips, and COA logic. Add a small normalization table for `Land|Sea`, `Sea|Air`, `Air|EW`, and `Cyber|EW` cases.
- Tradeoffs/risks: A single MIL-STD frame cannot express every multi-domain role; preserving secondary domains as badges or amplifiers avoids overloading the frame itself.

### L4-04 — Coarse type-only function mapping misclassifies important platform roles
- Severity: P1   Impact: 4   Effort: M
- Location: symbols.js:48, symbols.js:53, symbols.js:58, symbols.js:59, map.js:498, map.js:502, map.js:505, grokblue90.json:2784, grokblue90.json:2787, grokblue90.json:2791
- Observation: `functionId()` classifies symbols from `node.type` only, while range rings look only at `type` and `subsystem`. Current data has `Patriot Battery C – Philippines` as `type: "Support"` under `subsystem: "Contested Sustainment"`; it will render as generic support and will not receive an air-defense engagement ring, despite being a Patriot battery. The same pattern affects any asset whose role is expressed in `name`, `vulnerabilities`, tags, or capabilities rather than the coarse `type` value.
- Recommendation: Introduce a canonical `role` or `symbolFunction` field during import normalization, derived from name/subsystem/type/tags with explicit precedence, then use that field for `functionId()` and `engagementZone()`. At minimum, detect `Patriot`, `THAAD`, `SAM`, `IFPC`, `Aegis`, `HQ-9`, and `S-400` before generic `Support` or `Fires` handling.
- Tradeoffs/risks: Keyword inference can create false positives; the durable fix is an explicit curated role field in the scenario data.

### L4-05 — Decluttered marker coordinates diverge from true operational coordinates
- Severity: P2   Impact: 3   Effort: M
- Location: map.js:345, map.js:351, map.js:361, map.js:384, map.js:555
- Observation: `computeDeclutter()` groups near-identical nodes and offsets lower-priority markers by a spiral radius of `0.085 * sqrt(i + 0.5)` degrees, then `refreshMapMarkers()` plots the marker at the offset coordinate. Range rings are still drawn at the raw `n.lat`/`n.lon`, so a dense-location node can have its tactical symbol displaced by multiple kilometers while its engagement ring, objective marker, and true location remain elsewhere.
- Recommendation: Keep the authoritative marker anchor at the true coordinate and use a visual spiderfy/leader-line representation for overlapping icons, or draw a leader line and popup coordinate note whenever an icon is offset from `n.lat`/`n.lon`.
- Tradeoffs/risks: True-position rendering will reintroduce overlap unless paired with a deliberate declutter UI, but it avoids misleading users about exact force locations.

## Quick wins (top 3 high-impact/low-effort)
1. Replace `map.js` affiliation parsing with `SymbolModule.affiliation()` and reuse one color palette.
2. Centralize SIDC construction and require complete SIDC length before calling `new ms.Symbol()`.
3. Add high-priority role keywords for common air-defense systems before generic support/fires classification.

## Open questions for the human review
- Should scenario records carry an explicit `symbolFunction` or should import normalization infer it from existing fields?
- Should multi-domain records display secondary-domain badges on the map, or should secondary domains only affect filters and detail panels?
- Is MGRS intended to be a first-class coordinate field, or is lat/lon-only acceptable for StrikeSim 2040's planning use case?
