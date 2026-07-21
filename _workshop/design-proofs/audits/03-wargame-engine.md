# Audit: War Game engine

Surface: `game.js` (`window.GameModule`) — turn-based simultaneous-order War Game engine.
Method: read of full module + headless experiments via the `vm` sandbox used by the gates. Both gates pass (`node tools/wargame-loop-gate.js`, `node tools/tempo-test.js`). All findings below are reproduced by running the code, not inferred. Public API surface is treated as FIXED (loop gate enforces it); no fix proposes changing it.

Key measured facts (ai/ai, hard/hard, default cfg):
- Blue win rate **0.38 over 200 seeds** (1000–1199); 0.34 over a separate 50-seed band. The 0.42 figure in `tempo-test.js` is a 60-seed sample and is on the high side of the true distribution.
- With AP equalized (both sides fixed at 5) Blue win rate **collapses to 0.04**; at 6/6 it is 0.16. Blue is only competitive because the AP economy hands it MORE action points than Red (6 vs 5 at start).
- Across 80 seeds the match ends "Blue lost its key objectives" **~70%** of the time; "Red lost its key objectives" **1/80**. The objective victory condition is effectively one-sided.
- 49 of 224 scenario nodes (22%) carry a difficulty label absent from the `DIFF` table.

---

## [P0] 22% of nodes have difficulty labels the combat table doesn't know — silently treated as Medium
Where: `game.js` `DIFF` (line 39); consumed in `resolveTurn` line 275 (`DIFF[tgt.difficulty] || 1.0`) and `planOrders` lines 396, 406, 442.
Problem: `DIFF` only defines Soft/Medium/Mobile/Hardened/Fortified/Buried. The live scenarios (`grok150red.json` + `grokblue90.json`) contain `Dispersed`(23), `Orbital`(5), `Submerged`(4), `Fixed`(6), `Distributed`(3), `Camouflaged`(7), `Exposed`(1) — 49 nodes / 22% of the board. Every one falls through `|| 1.0` and is silently combat-resolved as Medium. Intended survivability (Buried-like Submerged/Orbital should be ~0.5; Exposed should be >1.0) is discarded with no warning, and the AI's targeting EV math is wrong for those nodes too. This is the single largest credibility gap vs an SME: a "buried/submerged" target dies as easily as a soft one.
Fix: extend `DIFF` to cover every label present in the shipped scenarios (e.g. Orbital 0.55, Submerged 0.5, Camouflaged 0.85, Dispersed 0.9, Distributed 0.85, Fixed 1.0, Exposed 1.25). Add a one-time `console.warn` when a difficulty key is missing so future data drift is caught. Numbers are data, not API — safe.
Effort: S

## [P0] Objective victory condition is structurally one-sided — Blue loses on key-objective collapse ~70% of matches
Where: `pickObjectives` (179), `OBJ_LOSS_FRAC` (178), `evaluateVictory` (642–656).
Problem: Top-8-by-value objectives are picked symmetrically, but Red's high-value nodes are intrinsically far more survivable than Blue's: Red's top-8 are Buried/Fortified (DIFF 0.5–0.65), Blue's are Hardened/Fortified/Mobile (0.65–0.9). Measured outcome: Blue loses ≥6/8 objectives in ~70% of seeds; Red almost never does (1/80). Combined with P0 (mis-scored difficulties inflating Blue fragility) the "deny the enemy's key terrain" win condition is almost exclusively a Blue-loss trigger, not a two-way contest. The headline 0.38–0.42 win rate is propped up entirely by the AP economy (see P1 below); remove that crutch and Blue wins 4%.
Fix: balance the objective condition rather than the AP economy. Options (data/constant-level, API-safe): normalise objective fragility (e.g. weight `OBJ_LOSS_FRAC` or objective scoring by each side's mean DIFF), or pick objectives by a value×survivability product so each side designates a comparably-defensible set, or make the loss threshold relative to start-of-match objective HP rather than count. Re-run the 200-seed harness targeting 0.45–0.55.
Effort: M

## [P0] Empty/one-sided rosters resolve to a bogus winner instead of a draw/guard
Where: `evaluateVictory` (642–656), `newMatch`/`commitTurn`.
Problem: With an empty graph, both sides have `startObj = 0`; the collapse test `objBlue <= startObj.blue * collapseFrac` becomes `0 <= 0` → TRUE for both → mutual-collapse tie-breaker `objBlue >= objRed` → **winner 'blue'** on the first commit, from nothing. A red-only graph immediately declares "Blue force collapsed / winner red" at turn 1 because Blue's startObj is 0. Objective counts are 0 so the key-loss branch is skipped, masking the issue. No crash, but the engine asserts a victor for degenerate inputs.
Fix: in `evaluateVictory`, guard `startObj <= 0` (treat a side with no starting objective value as non-collapsible / the match as `winner = null` or a draw). In `newMatch`, if either roster is empty, set a no-contest state rather than entering a playable turn loop.
Effort: S

## [P1] Dynamic AP economy is a balance crutch, not a balance lever — and it favors Blue
Where: `resourceAp` (378–382), `apFor` (467–476), `newMatch` baseAp (501–504).
Problem: `resourceAp` gives Blue base 6 vs Red base 5 because Blue has more C2/logistics nodes (c2 26/logi 39 vs c2 17/logi 10). This AP edge is the ONLY thing keeping Blue near 0.38; equal AP → 0.04. So the "command-tempo economy" isn't modelling tempo, it's silently compensating for an unbalanced combat layer. Worse, the bands are coarse (`strikeBand` at ≥220 capacity, `postureBand` at ≥30 support nodes) and clamp to a 3-band range, so the economy barely moves during a match (tempo-test shows AP 6→5 only). Decapitation rarely changes AP in practice.
Fix: fix the underlying combat/objective balance (P0s) FIRST, then re-tune `resourceAp` so base AP is symmetric-ish and the economy's job is dynamic degradation, not static handicapping. Widen/soften the degradation curve in `apFor` so losing C2 visibly costs AP mid-match. Keep explicit overrides honored (gate contract) — that path is correct and tested.
Effort: M

## [P1] Cascade damage is mis-reported in AAR — victim's full HP logged as cascade "damage"
Where: `resolveTurn` cascade event `damage: before` (322); consumed in `buildAar` (782–789, `rec.damage += damage`, side `damage` totals, `topDamaged`).
Problem: The cascade event sets `damage: before` = the victim's entire pre-cascade health, but the damage actually applied is `cd` (typically 1–22 HP). AAR then adds that full HP to the side's `damage` total and to per-target `topDamaged`. So a cascade that chipped 12 HP off a node sitting at 90 HP is recorded as 90 "damage". This inflates every side's damage stat and skews `topDamaged` toward cascade victims. Combat damage from strikes is recorded correctly (`actual`/`d`); only cascade accounting is wrong.
Fix: emit the true cascade damage on the event — `damage: Math.min(before, cd)` (the amount actually removed) — and keep AAR summation as-is. Trivial, AAR-internal.
Effort: S

## [P1] Serialize/deserialize drops match history → AAR is wrong after save/load
Where: `serialize` (851–862, no `history`), `deserialize` (869–878, `history: []`).
Problem: `serialize()` omits `match.history`, and `deserialize` hard-resets `history: []`. A match saved mid-game and reloaded loses every prior turn's score deltas, kills, method stats, and cumulative score chart. Measured: a match driven 2 turns, serialized, reloaded, then played out produces an AAR whose `turns`/`scoreByTurn` reflect only post-load turns — pre-load combat vanishes from the after-action report. Cumulative `score` is preserved (it's serialized), so the AAR's per-turn rows won't even reconcile with the final score. Determinism through the round-trip is otherwise intact (verified: identical winner/score).
Fix: include `history` in `serialize()` and restore it in `deserialize()`. History rows are already plain serializable objects (turn + orders + report). This is additive to the blob, not an API change.
Effort: S

## [P1] AI "harden" is issued blind and almost never pays off
Where: `planOrders` (434–450), harden effect in `resolveTurn` (276, `HARDEN_MULT`).
Problem: Leftover AP hardens the side's most-valuable HEALTHY node. Harden only reduces incoming probability (×0.55) IF the enemy strikes that exact node the same turn — but the AI has no model of what the enemy will hit, so it's a blind guess on ~1 of dozens of nodes. In practice harden is wasted AP most turns. Repairs are issued (21 events in a sample match) but only trigger once a node drops below 80% HP, and `REPAIR_AMOUNT=30` barely offsets one kinetic hit (50–70). So the defensive half of the AI's AP is low-value.
Fix: bias harden toward nodes the enemy is most likely to value-target (reuse the same `nodeValue × DIFF × tempo` ranking the offense uses, but on OWN nodes) and toward already-damaged high-value nodes; consider hardening only when an own objective is exposed. Repair should prioritise nodes near death. Heuristic-only; no API change.
Effort: M

## [P2] `easy` difficulty is weaker but the gap is narrow and partly noise
Where: `planOrders` (392, 410–414, 418, 443).
Problem: `easy` differs by (a) dropping the tempo target bonus, (b) 40% chance of a random method, (c) slightly higher strike-AP fraction, (d) 40%-gated repairs. Measured head-to-head: blue=easy vs red=hard wins 0.17 vs blue=hard 0.50 — a real gap, but most of `easy`'s weakness is method randomisation rather than worse target/objective selection, so an `easy` opponent still concentrates fire on the right targets. For a training-wheels tier this may be too strong.
Fix: make `easy` also degrade targeting (skip the focus-fire double-tap, occasionally pick a non-top target) and stop protecting objectives, so the difference is strategic, not just dice. Optional; current behaviour is acceptable.
Effort: S

## [P2] RNG is a 31-bit Park–Miller LCG — fine for gameplay, thin for analyst-grade trial counts
Where: `makeRng` (76–85).
Problem: Statistically clean at gameplay scale — measured χ²(9df)=6.82 (well under 16.9), lag-1 serial correlation −0.005, uniform `int(1,6)`. But it's a single-stream 31-bit LCG (period ~2.1e9, ~31 bits of state). For deterministic per-turn rolls it's adequate. If the War Game's resolver is ever reused to drive large Monte-Carlo sweeps (thousands of trials × hundreds of nodes), a 31-bit LCG with this short period and known low-order-bit weakness is not analyst-defensible for tight confidence intervals.
Fix: keep the LCG for live play (cheap, deterministic, networkable). If/when used for MC trial counts, swap the internal generator for a 53-bit state PRNG (e.g. sfc32/xoshiro) behind the same `next/range/int/pick` interface — internal, no API change. Document the trial-count ceiling.
Effort: S

## [P2] `makeRng(0)` and any seed reducing to s=P-1 returns next()≈0.99998 first — harmless now, latent footgun
Where: `makeRng` (76–80).
Problem: `makeRng(0)`: seed `0` → `s = 0 % P = 0` → `s += 2147483646` (P−1) → first `next()` = `((P−1)·48271) mod P / P` ≈ 0.999998. Any seed ≡ 0 (mod P) hits this. It's not exactly 1.0 (max observed over 500k draws = 0.9999983, so `rng.next() < p` is safe and `pick` never indexes out of bounds), but the first draw being deterministically ~1.0 for the zero-seed is a surprising artifact. Current code is shielded because `hashSeed` returns `|| 1` (never 0), so production seeds never hit it.
Fix: low priority. Optionally re-roll once (`if (s === P-1) s = 1`) or advance the state once before first use, to remove the pathological first draw for direct `makeRng(0)` callers.
Effort: S

## [P2] Objectives are snapshot once and never re-evaluated — dead nodes stay "objectives" (correct as designed, but undocumented edge)
Where: `pickObjectives` called only in `newMatch` (509) and `deserialize` fallback (874).
Problem: Objectives are fixed key terrain (intended). But `pickObjectives` filters `alive` at pick time, so if a match is constructed from an already-damaged board (e.g. `freshStart:false` campaign handoff with pre-neutralised nodes), the top-8 are drawn only from survivors — a side that has already lost its true crown-jewel node never gets it designated, slightly understating how decapitated it is. On `deserialize`, objectives are correctly preserved from the blob when present (verified) and only re-picked as a fallback.
Fix: document that objectives are fixed at match start; for `freshStart:false` handoffs, consider designating objectives from the pristine roster (pre-damage) so denial credit is accurate. Minor.
Effort: S

## [P2] Mutual-collapse and turn-limit tie-breakers can disagree with cumulative score
Where: `evaluateVictory` (654, 657–661), `buildAar` reason (817–822).
Problem: On mutual collapse the winner is decided by remaining objective value (`objBlue >= objRed`), but on a turn-limit expiry the winner is decided by SCORE first, then objective value. Two different tie-break philosophies in the same function. A side can lead on cumulative score (enemy value removed) yet lose a mutual-collapse turn because it has less surviving value — defensible, but the inconsistency isn't surfaced to the player, and ties default to Blue (`>=`).
Fix: pick one tie-break order and apply it uniformly, or at minimum surface in the AAR which rule decided the match. Make the `>=` default-to-Blue explicit/justified.
Effort: S
