# L2 — War Game Rules
- Dimension: Logic
- Focus: War Game rules, AI, victory/objective logic, tempo, and serialization determinism.
- Files inspected: game.js, wargame.js, _stark/audits/00-MASTER-FIXLIST.md

## Summary
The War Game engine has a strong deterministic shape: seeded planning/resolution, simultaneous order resolution, explicit AP tempo, objective tracking, AAR generation, and a save/load surface are all present. The highest-risk gaps are in the rules contract between UI, AI, and resolver: human strikes do not require a valid firing source, while AI plans around sources that the resolver mostly ignores. Tempo and objective scoring also do not fully match the product copy, which makes decapitation and suppression less decisive than the player is told. Serialization is close, but a loaded match is not self-contained enough to restore the live scenario or guarantee replay against the same board data.

## Strengths
- Resolver is intentionally pure for a given board/orders/config/RNG and uses seeded RNG per planning/resolution turn, which is the right foundation for replay and offline determinism.
- Simultaneous order resolution is explicit: strikes read start-of-turn target liveness and accumulated damage is applied after all strike rolls.
- Dynamic AP, key objectives, collapse checks, and AAR summaries give the War Game more operational texture than a simple attrition simulator.
- Prior-audit fixes are visible: difficulty labels are expanded, key objectives are survivability-weighted, empty-start objective collapse is guarded, and history is now serialized.

## Findings
### L2-01 — Human strikes do not require a valid firing source
- Severity: P1   Impact: 5   Effort: M
- Location: game.js:604, game.js:607, game.js:609, game.js:611, game.js:292, game.js:296, wargame.js:817
- Observation: Human order validation only checks that the target exists, is alive, and is not friendly before pushing the strike order. The UI offers every strike method for every enemy target, while the resolver uses the selected method directly and never checks `sourceId`, source side, source liveness, method resource availability, or per-source capacity. AI planning does choose sources, but those sources are metadata for events rather than a rules gate in the resolver.
- Recommendation: Put source/method availability behind one shared rules function used by the UI, `queueOrder`, AI planning, and `resolveTurn`. Require a living friendly source with `resourceForMethod(source, methodKey) > 0`, reject or void source-less strikes, and consider per-source/per-turn capacity plus source affinity/resource effects in hit probability or damage.
- Tradeoffs/risks: Enforcing source validity will reduce player strike volume and may require AP/collapse recalibration.

### L2-02 — Tempo loss bottoms out near 60% of base AP, not the advertised floor
- Severity: P1   Impact: 4   Effort: S
- Location: game.js:481, game.js:492, game.js:493
- Observation: The comment says dynamic AP scales from base down to a floor of 2 as command-tempo collapses, but the formula is `base * (0.6 + 0.4 * frac)`. At total C2/logistics loss (`frac = 0`), a 6 AP side still gets 4 AP and a 5 AP side still gets 3 AP, so decapitation can only remove about 40% of tempo.
- Recommendation: Change the curve to match the rule, for example `Math.round(2 + (base - 2) * frac)`, then tune the floor and UI copy together. If a 60% minimum is intentional, rename the rule as degraded tempo rather than throttling/decapitation.
- Tradeoffs/risks: A true floor-of-2 tempo economy will make C2/logistics strikes much more decisive.

### L2-03 — Objective scoring ignores partial damage until a node is dead
- Severity: P2   Impact: 3   Effort: M
- Location: game.js:246, game.js:355, game.js:358, game.js:359, game.js:666
- Observation: `objectiveValue` adds full node value for every alive node and zero for dead nodes; `scoreDelta` is then based only on alive-value removed. A high-value node at 1 HP still contributes full force value, produces no score for the attacker until neutralized, and delays collapse even though tempo separately degrades by health.
- Recommendation: Decide whether War Game victory is kill-based or combat-power-based. If combat power is intended, make score/collapse use health-weighted effective value or a mission-kill threshold, and surface that same rule in the HUD/AAR.
- Tradeoffs/risks: Health-weighted scoring will change balance and may require new score thresholds or victory text.

### L2-04 — Ties and mutual collapse default to Blue wins
- Severity: P2   Impact: 3   Effort: S
- Location: game.js:675, game.js:680, game.js:681
- Observation: When both sides collapse or lose key objectives in the same turn, the tie-breaker is `objBlue >= objRed ? 'blue' : 'red'`. The time-limit score tie uses the same `>=` remaining-objective comparison, so exact equality is always a Blue win rather than a draw or neutral tie-break.
- Recommendation: Add an explicit draw/contested outcome, or define a side-neutral tie-breaker such as loss ratio, key objectives held, final tempo, or initiative. Avoid `>=` defaults in winner assignment unless Blue advantage is a documented scenario rule.
- Tradeoffs/risks: UI/AAR code will need to render a non-blue/non-red result if draws are allowed.

### L2-05 — Deserialized matches are not self-contained or safely restorable
- Severity: P1   Impact: 4   Effort: M
- Location: game.js:872, game.js:881, game.js:882, game.js:885, game.js:899, game.js:901, game.js:909
- Observation: `serialize` saves health, orders, history, objectives, and tempo metadata, but it does not save the pre-match `savedGraphState` or `lastReport`. `deserialize` rebuilds the board from whatever graph is currently active, applies saved health, sets `lastReport` to null, and immediately writes the loaded battle state into the live graph; `endMatch` can only restore if `match.savedGraphState` exists. A loaded match can therefore leave battle damage in the scenario on close, lose the resolved-turn log, and replay against changed node/link/combat data without detection.
- Recommendation: Serialize a versioned scenario hash plus the canonical board fields needed for deterministic replay, and either serialize `savedGraphState` or capture the current graph state before applying loaded health. Restore `lastReport` from the saved state or derive it from the last history entry when loading a resolved phase.
- Tradeoffs/risks: Self-contained saves will be larger and need migration rules across scenario/schema changes.

## Quick wins (top 3 high-impact/low-effort)
1. Fix the AP tempo formula or copy so total C2/logistics loss has the advertised effect.
2. Replace Blue-default tie-breaks with an explicit draw/contested result or a side-neutral tie-break.
3. Rehydrate `lastReport` from `history[history.length - 1]` during `deserialize` so resolved-turn loads keep their log/AAR context.

## Open questions for the human review
- Should each strike consume a specific firing source/capability, or is AP intended to abstract all launch capacity?
- Should suppression/partial damage count toward score and collapse, or is victory intentionally based only on neutralized nodes?
- Should War Game saves be portable replay artifacts, or only short-lived resumes against the exact same active scenario?
