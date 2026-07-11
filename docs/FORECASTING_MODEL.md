# StrikeSim 2040 Forecasting Model

**Status:** UNCLASSIFIED // NOTIONAL RESEARCH TOOL  
**Version:** CO-005 / measured-mind v1  
**Scope:** Human probability elicitation, model-world frequencies, proper scoring, calibration, and uncertainty gates. This document does not claim real-world predictive validity.

## 1. What is being measured

StrikeSim measures the player's judgment about narrow, named, automatically resolvable events. It does **not** announce a probability that an operation will succeed.

Every event question has this contract:

```text
id + category + plain-language prompt
predicate = { allowlisted engine-state path, comparison operator, value }
deadline = one named turn
house = { hits, model-world count K, frequency q, frequency interval }
response = { blind probability, final probability }
actual = resolver-produced end-turn state
```

Allowed paths cover named node health/alive state, Red throughput/lodgment, this-turn losses, Blue key-node loss/tempo, and halt/lodgment outcomes. No question contains executable code, arbitrary property access, or a manually adjudicated answer.

The Commit Card is deliberately ordered:

1. Blue orders lock in the engine and receive a deterministic order hash.
2. The player answers three 1%-granularity event questions blind and gives an 80% Red-throughput interval.
3. The player updates the standing T+5 lodgment question, whose last value carries forward.
4. The house reveals model-world counts, frequencies, and intervals.
5. The player may revise once; orders remain locked.
6. One seeded world resolves; every due predicate scores automatically.

This blind-then-hybrid sequence separates unaided judgment from model-assisted judgment while retaining both. IARPA's [ACE](https://www.iarpa.gov/research-programs/ace) program centered probabilistic elicitation and empirical resolution, while [HFC](https://www.iarpa.gov/research-programs/hfc) studied integrated human-machine forecasting. StrikeSim adapts those design principles to a deterministic notional game, not to intelligence production.

## 2. House frequencies and question selection

The house line is a frequency across `K = 200` model worlds under the disclosed doctrine belief and current game assumptions:

```text
q = hits / K
```

The UI reports the count and a Wilson 90% frequency interval. It says, for example, "124/200 model worlds met this predicate," not "the operation has a 62% chance of success."

For tunable numeric predicates, the generator sweeps thresholds and prefers `q ∈ [0.2, 0.8]`. This avoids a diet of trivial questions while retaining explicitly labeled tail events when the required named event is rare. Questions carry attrition, logistics, C2, or detection categories; the primary target's authored subsystem determines its category.

The standing question—"Will Red lodgment remain below 50% at T+5?"—resolves against actual T+5 lodgment. Its current house line is explicitly a constant-throughput projection from each end-turn model world, not a hidden continuation combat replay. The UI and stored record preserve that assumption.

## 3. Proper scores

### Binary Brier score

For probability `f ∈ [0,1]` and binary outcome `o ∈ {0,1}`:

```text
BS(f,o) = (f - o)^2
```

Lower is better. StrikeSim stores blind, final, and house scores separately. The original probability-score reference is Brier, ["Verification of Forecasts Expressed in Terms of Probability"](https://journals.ametsoc.org/doi/10.1175/1520-0493%281950%29078%3C0001%3AVOFEIT%3E2.0.CO%3B2) (1950).

### Brier Skill Score versus the house

Across resolved entries:

```text
BSS = 1 - sum(BS_player) / sum(BS_house)
```

- `BSS > 0`: lower cumulative error than the house.
- `BSS = 0`: equal cumulative error. Copying every house value produces exactly zero.
- `BSS < 0`: higher cumulative error than the house.
- If house error is zero, BSS is undefined; the UI reports paired Brier difference instead of infinity.

Repeated updates to one standing question share one eventual outcome. Bootstrap resampling clusters them by question ID so repeated updates do not manufacture independent sample size.

### 80% interval score

For lower bound `l`, upper bound `u`, realized value `x`, and `α = 0.2`:

```text
IS = (u-l)
   + (2/α)(l-x) if x < l
   + (2/α)(x-u) if x > u
```

Narrow intervals are rewarded only when they cover; misses receive a distance penalty. Interval scores remain separate from binary Brier scores. The implementation follows the proper interval-score treatment summarized by Gneiting and Raftery, ["Strictly Proper Scoring Rules, Prediction, and Estimation"](https://doi.org/10.1198/016214506000001437) (2007).

### Multicategory Brier score

For a mutually exclusive failure-cause distribution and one-hot realized cause:

```text
BS_multi = sum_k (f_k - o_k)^2
```

Its range differs from the binary score, so the UI does not blend the two without an explicit normalization. This score supports the Phase 3 premortem.

## 4. Calibration and resolution

For exact authored 1% forecast bins `k`:

```text
REL = (1/N) sum_k n_k (f_bar_k - o_bar_k)^2
RES = (1/N) sum_k n_k (o_bar_k - o_bar)^2
UNC = o_bar (1 - o_bar)
BS  = REL - RES + UNC
```

The AAR translates:

- `REL` as **honesty with yourself**: whether stated probabilities match observed frequencies.
- `RES` as **willingness to call it**: whether forecasts discriminate between events that resolve differently.

Below-50 forecasts are folded only for display: `confidence = max(f,1-f)` and the selected outcome is inverted. This preserves each original Brier score. Display buckets are 50–59 through 100; no bucket sentence appears below `n=10`.

## 5. Uncertainty and progression gates

One call receives a proper score, but one call cannot establish calibration. The UI therefore says "one world's verdict" and never turns a hot draw into a trait label.

- Per-turn score: shown with an explicit one-world/noise warning.
- Confidence-bucket sentence: `n ≥ 10` in that bucket.
- Calibration or over/underconfidence verdict: `N ≥ 50` resolved calls.
- Analyst progression: requires `N ≥ 50` and a positive lower bound from a deterministic 90% clustered bootstrap.
- **Watch Officer** is the evidence-gathering baseline; **Fusion Analyst** and **Superforecaster** require sustained positive skill, not a point estimate.

The minimum-sample restraint is consistent with Aldous, ["A Prediction Tournament Paradox"](https://www.stat.berkeley.edu/~aldous/Papers/prediction_paradox.pdf), which shows that tournament winners can be dominated by sampling variation even when pairwise scoring is proper. Mellers et al., ["Psychological Strategies for Winning a Geopolitical Forecasting Tournament"](https://doi.org/10.1177/0956797614524255), motivates tracking calibration and resolution as trainable forecasting behavior.

## 6. Determinism, storage, and proof

- Questions are a pure function of model-world snapshots and context; identical inputs yield an identical question-set hash.
- Bootstrap draws use `makeRng(hashSeed(seed, tag, ...))` supplied by `game.js`.
- The local archive key is versioned: `strikesim.co005.v1.forecasts`.
- Entries store the notional operation seed, question ID/category, blind/final/house probability, outcome, and component scores. They do not store personal information.
- `tools/brier-proof.js` asserts question determinism and automatic resolution, known Brier/Winkler/multicategory cases, house-copy BSS=0, the Murphy identity, folded-score invariance, bootstrap determinism, sample gates, order-lock enforcement, and compiled/live MOE parity.

## 7. Interpretation boundary

The machinery can establish whether a player is calibrated **inside this authored game distribution** after enough observations. It cannot establish real-world operational foresight, validate classified assessments, estimate actual PLA intent, or convert notional scenario frequencies into empirical probabilities. Every public export retains the `UNCLASSIFIED // NOTIONAL RESEARCH TOOL` boundary.
