# StrikeSim 2040: Red Mind Model

**Status:** UNCLASSIFIED // NOTIONAL RESEARCH TOOL  
**Version:** 1.0  
**Date:** July 2026

---

> **Disclaimer.** This module is a game-theoretic training mechanism built from public scholarship and explicit notional assumptions. It is not an intelligence estimate, a model of actual PLA decision-makers, a prediction of PRC intent, or evidence that any named behavior would govern a real operation. The doctrine prior, policy weights, reasoning settings, and likelihood model are authored game configuration.

## 1. Purpose and model boundary

The Red Mind model gives StrikeSim a reproducible opponent whose behavior is strategically varied without hiding a second combat engine behind the interface. It separates three questions:

1. **What kind of policy is Red following?** One hidden doctrine type is drawn from a disclosed prior at the start of an operation.
2. **How deeply does Red compare plans?** The difficulty setting controls bounded reasoning depth and response precision, not a generic accuracy bonus.
3. **What should Blue believe about Red?** Blue carries a public probability distribution over doctrine types and updates it from observed Red orders.

`red-mind.js` contains policy and inference primitives only. All plan evaluations return to `game.js::resolveTurn()`, StrikeSim's sole combat kernel. The model therefore changes how orders are selected, not how combat is adjudicated.

The implementation uses ideas from Bayesian games, cognitive-hierarchy/level-k reasoning, quantal response, Bayesian opponent modeling, and regret learning. Those theories motivate the structure. The exact three doctrines, all numeric weights, the 50/30/20 prior, the finite candidate set, and every difficulty coefficient are **NOTIONAL StrikeSim settings**, not values estimated from empirical PLA behavior.

## 2. Hidden doctrine as a Harsanyi type

At operation creation, the engine normalizes the configured prior and makes one seeded draw:

```text
P(attrition)    = 0.50
P(decapitation) = 0.30
P(denial)       = 0.20

trueDoctrine = drawDoctrine(prior, makeRng(hashSeed(matchSeed, "doctrine")))
```

This implements a small Harsanyi-style incomplete-information game: Nature selects a behavioral type from a common prior; Red acts with that type; Blue knows the prior but not the draw. The implementation does **not** claim to compute a Bayes-Nash equilibrium.

The hidden type remains private until the AAR:

- live public state contains the prior, current belief, trajectory, and difficulty settings;
- `revealedDoctrine` is null until the match phase is `over`;
- save files omit the hidden doctrine; loading re-derives it from `(matchSeed, "doctrine")`; and
- the AAR may reveal the type after the operation has resolved.

The 50/30/20 prior is disclosed game framing. It is not an assessed distribution of real-world Chinese intent.

## 3. Implemented doctrine types

Each doctrine is a relative weight vector over the same legal orders and the same resolver. Higher weights mean “prefer this more strongly within this restricted planner”; they are not probabilities, readiness estimates, or effect sizes.

### 3.1 Allocation and protection

| Doctrine | Strike share | Opening focus-fire count | Repair bias | Protect tempo | Protect lodgment |
|---|---:|---:|---:|---:|---:|
| Attrition | 0.65 | 2 | 0.45 | 0.48 | 0.05 |
| Decapitation | 0.65 | 2 | 0.64 | 0.82 | 2.50 |
| Denial / Fait Accompli | 0.50 | 1 | 0.82 | 0.72 | 4.00 |

`strikeShare` determines the approximate fraction of available action points assigned to strikes. `focusFire` controls how many opening strikes may concentrate on the top-ranked target. Remaining action points harden or repair friendly nodes using the protection and repair weights.

### 3.2 Target preferences

| Doctrine | Tempo | Command | Logistics | Counter-lodgment | Fires | Already damaged |
|---|---:|---:|---:|---:|---:|---:|
| Attrition | 0.18 | 0.12 | 0.14 | 0.18 | 0.32 | 0.28 |
| Decapitation | 0.72 | 0.90 | 0.28 | 0.08 | 0.08 | 0.12 |
| Denial / Fait Accompli | 0.42 | 0.28 | 0.48 | 0.12 | 0.58 | 0.08 |

The planner combines these preferences with node value, target difficulty, current health, tempo contribution, and lodgment relevance. Stable node-ID tie-breaking replaces the former random target-ranking jitter.

### 3.3 Method preferences

| Doctrine | Kinetic | Cyber | EW | SOF |
|---|---:|---:|---:|---:|
| Attrition | 1.30 | 2.40 | 3.00 | 1.20 |
| Decapitation | 1.20 | 3.00 | 3.50 | 1.50 |
| Denial / Fait Accompli | 1.00 | 3.00 | 4.20 | 1.20 |

These multipliers rank methods that the side can actually source. They do not create capacity, bypass resource validation, or change the resolver's hit and damage rules.

### 3.4 Rollout utility

| Doctrine | Enemy loss | Own-loss penalty | Throughput | Tempo |
|---|---:|---:|---:|---:|
| Attrition | 1.20 | 0.88 | 0.30 | 0.20 |
| Decapitation | 1.00 | 0.92 | 3.00 | 0.72 |
| Denial / Fait Accompli | 0.68 | 1.35 | 8.00 | 0.42 |

One-turn candidate rollouts combine objective-value loss, friendly loss, Red amphibious throughput, and command-tempo change. These are planner utilities only. The denial/lodgment arbiter remains the operational win condition.

The doctrine objects also declare `escalationAppetite` values of 0.64, 0.82, and 0.48 and `deceptionRate` values of 0.16, 0.24, and 0.38 respectively. Those fields are forward contracts for the escalation/indicator workstream; the current strike/harden/repair planner does not yet consume them.

## 4. Balanced policy and legacy compatibility

Difficulty and doctrine are independent dimensions. A legacy difficulty string does **not** silently become a doctrine. When `planOrders()` receives `easy`, `hard`, `elite`, or an unrecognized non-doctrine string as its policy argument, it uses the notional `balanced` policy. Difficulty separately controls the reasoning wrapper.

The balanced policy is also Blue's default AI policy and the base for sampled opponent plans. Its principal settings are:

```text
strikeShare 0.84; focusFire 1; repairBias 0.55
target: tempo .30, command .18, logistics .55, lodgment 9.00, fires .12, damaged .10
protect: tempo .70, lodgment .65
methods: kinetic 1.05, cyber 2.60, EW 4.00, SOF 1.30
utility: enemyLoss .82, ownLoss .72, throughput 5.00, tempo .28
```

Legacy labels map as follows:

| Accepted label | Effective setting | k | lambda | Candidates | Opponent samples | Fatigue decay | Base k-drop |
|---|---|---:|---:|---:|---:|---:|---:|
| `training`, `easy` | Easy | 0 | 0.80 | 5 | 0 | 0.045 | 0.160 |
| `contested`, `normal`, `hard` | Hard | 1 | 4.25 | 5 | 8 | 0.025 | 0.045 |
| `expert`, `elite` | Elite | 2 | 5.75 | 5 | 8 | 0.018 | 0.025 |
| unknown or omitted | Hard | 1 | 4.25 | 5 | 8 | 0.025 | 0.045 |

Custom objects may override these fields, but the implementation clamps `k` to 0–2, candidates to 1–5, opponent samples to 0–8, and lambda to 0.05–12.

## 5. Restricted plans, bounded level-k reasoning, and quantal choice

### 5.1 Candidate set

For a base doctrine, the engine generates at most five legible policy variants:

1. the base policy;
2. more strikes, more opening concentration, and a kinetic tilt;
3. fewer strikes, more repair, and stronger lodgment protection;
4. stronger tempo/command targeting with a cyber/EW tilt; and
5. dispersed fires/logistics targeting with a small SOF tilt.

Each variant produces one deterministic legal order set from the current board. Variation comes from policy, not cosmetic target-score noise.

### 5.2 Reasoning depth

- **k=0:** rank the restricted candidate plans by the policy heuristic. No opponent rollout matrix is built.
- **k=1:** evaluate each candidate against up to eight sampled opponent plans and compute its mean utility against a uniform opponent distribution.
- **k=2:** reuse the same payoff matrix, apply a quantal distribution to the opponent plans using their mean utility, and score each own plan against that weighted distribution. k=2 does not recurse.

At most `5 × 8 = 40` calls to `resolveTurn()` support one strategic choice. Candidate construction, opponent construction, reasoning-depth draw, plan selection, and each rollout have separate hash-seeded streams.

### 5.3 Quantal-response rule

The choice helper standardizes candidate utilities, multiplies them by lambda, clips logits to ±30, and applies softmax:

```text
z_i = lambda * (utility_i - meanUtility) / sdUtility
P(i) = exp(z_i - max(z)) / sum_j exp(z_j - max(z))
```

If all utilities are effectively equal, the distribution is uniform. Larger lambda concentrates choice on higher-scoring plans; smaller lambda produces a flatter distribution.

This is a **logit quantal-response choice rule over a finite restricted plan set**. It is inspired by quantal-response equilibrium, but StrikeSim does not solve the fixed-point conditions of a formal QRE and should not label its output “the QRE.”

### 5.4 Fatigue and bounded-rationality drop

For turn `t`, the implementation applies:

```text
effectiveLambda = max(0.15, lambda * (1 - fatigueDecay * (t - 1)))
dropChance = clamp(kDrop + (t - 1) * fatigueDecay * 0.15, 0, 0.45)
```

A tagged draw may reduce an otherwise positive k to zero for that turn. This produces a plausible bounded-reasoning lapse—a return to the level-0 policy—not a random illegal action or arbitrary lottery pick. The coefficients are notional gameplay tuning.

## 6. Regret matching and the safe mix

For Red at k>0, the final candidate-plan distribution is taken from a 100-iteration regret routine over the restricted payoff matrix. Rows maximize the modeled Red utility; columns minimize it. Each iteration:

1. converts positive cumulative regrets into row and column mixed strategies;
2. evaluates the current mixed-strategy value;
3. adds regret for each unchosen pure row/column; and
4. accumulates the strategies into a time-average distribution.

The resulting row average replaces the softmax distribution for Red's final plan draw. Quantal response still contributes to k=2's model of opponent-plan weights and remains the fallback when no payoff matrix/safe mix exists.

This is a **Hart–Mas-Colell-inspired external-regret routine on a small zero-sum matrix**. It is not the paper's exact conditional-regret procedure, and 100 iterations do not establish convergence to an exact Nash or correlated equilibrium. In StrikeSim it is a bounded randomization device intended to reduce deterministic metagaming while remaining inspectable and inexpensive.

The same restricted regret mix is also used to weight doctrine-specific plans in forecast caching and in the posterior likelihood model.

## 7. Belief-respecting ghost worlds

Forecast worlds must represent what Blue knows, not what the engine secretly drew.

Before K ghost worlds are sampled, `buildBeliefPlanCache()` builds:

- two Red policy variants per doctrine—six Red rows total;
- eight sampled Blue plans; and
- a `6 × 8 = 48` resolver-backed payoff table.

It computes a doctrine-specific two-plan mix with 100 iterations of regret matching. Ghost world `k` then draws:

```text
ghostDoctrine ~ BlueCurrentBelief
  using hashSeed(matchSeed, "ghost-doctrine", turn, k)

ghostPlan ~ cached mix for ghostDoctrine
  using hashSeed(matchSeed, "ghost-plan", turn, k)
```

The pure ghost helper accepts a cache, a belief vector, a seed, a turn, and a world index. It has no match object or true-doctrine parameter. Changing the hidden doctrine while holding the public belief and all forecast inputs fixed therefore cannot change the ghost distribution.

The cache is deliberately smaller than the real Red planner's five-candidate choice. It is a bounded posterior-predictive approximation, not an exhaustive distribution over all possible Red plans.

## 8. Bayesian doctrine tracker

After Red orders are committed, the engine updates Blue's belief from those observed choices on the pre-resolution board. The interface surfaces the new assessment after WATCH; combat outcomes themselves are not used as doctrine evidence in this update.

### 8.1 Observable features

Each order maps to one count in:

```text
order kind | target class | method
```

Target classes are `lift`, `command`, `logistics`, `sensor`, `fires`, or `other`. Strike methods retain their method key; harden and repair use their order kind.

### 8.2 Doctrine likelihood model

For each doctrine, the engine:

1. generates five doctrine-policy variants;
2. evaluates them against four balanced Blue variants through `resolveTurn()`;
3. weights those plans with the 100-iteration regret mix; and
4. aggregates the weighted feature counts into an approximate multinomial model.

Given observed feature counts `c_b`, prior `P(d)`, modeled weighted counts `n_db`, total modeled order mass `N_d`, vocabulary size `V`, and smoothing `alpha = 2.0` in the live game path:

```text
theta_db = (n_db + alpha) / (N_d + alpha * V)

log weight_d = log P(d) + sum_b c_b * log(theta_db)

P(d | observed orders) = normalize(exp(log weight_d))
```

Log normalization prevents numerical underflow. Additive smoothing ensures one unseen feature cannot permanently assign a doctrine probability of zero. All likelihood-plan and rollout draws use separate tagged seeds.

The tracker is an **approximate Bayesian opponent model conditional on StrikeSim's own planner**. It assumes the selected order features are adequate and treats their counts with a multinomial-style likelihood. Its posterior is therefore “probability under this notional model,” not an intelligence confidence statement. A model misspecification can produce a confident but wrong posterior.

The trajectory stored for AAR contains turn, posterior belief, and observed feature counts. The hidden type is revealed only after the operation so the AAR can compare the belief trajectory with the seeded game type without leaking it into play.

## 9. Determinism, auditability, and persistence

All new stochastic choices are addressable with `makeRng(hashSeed(matchSeed, tag, ...))`. Important tags include:

- `doctrine`;
- `plan/candidate`, `plan/opponent`, `plan/rollout-resolve`, `plan/k-drop`, and `plan/plan-select`;
- `ghost-doctrine` and `ghost-plan`; and
- `belief-likelihood-opponent`, `belief-likelihood-plan`, and `belief-likelihood-resolve`.

Stable sorting resolves equal target, source, and method scores. The real turn still resolves with the existing `hashSeed(matchSeed, "resolve", turn)` stream. Same scenario, configuration, seed, and orders therefore reproduce the same doctrine draw, reasoning record, belief trajectory, and combat result.

Save schema v4 introduced public Red-mind state; schema v5 added order locks. Saves include the prior, current belief, reasoning history, and belief trajectory. They never include the hidden doctrine. Older saves default missing fields to the disclosed prior and re-derive the hidden type from the operation seed.

## 10. What the model does not claim

- The doctrine names are analytical game abstractions, not a taxonomy attributed to the PLA.
- The prior and weights are not calibrated from exercises, intelligence, historical frequencies, or real operational data.
- Difficulty settings do not estimate human cognitive depth or command proficiency.
- The softmax rule is not a solved QRE.
- The regret routine is not a proof of equilibrium and the restricted candidate set can omit the best plan.
- The posterior is only as valid as its notional doctrine library, feature bins, and likelihood samples.
- Zero-sum rollout utility omits political, escalation, alliance, deception, and other real strategic considerations not yet implemented.
- A believable simulated opponent is not evidence that the simulated behavior is likely in the real world.

## 11. Theory lineage and provenance boundary

The following primary scholarship motivates the architecture; none of it supplies StrikeSim's numerical configuration:

1. John C. Harsanyi, [“Games with Incomplete Information Played by ‘Bayesian’ Players, Part I: The Basic Model”](https://pubsonline.informs.org/doi/10.1287/mnsc.14.3.159), *Management Science* 14(3), 1967. Source for the common-prior/type framing.
2. Colin F. Camerer, Teck-Hua Ho, and Juin-Kuan Chong, [“A Cognitive Hierarchy Model of Games”](https://doi.org/10.1162/0033553041502225), *Quarterly Journal of Economics* 119(3), 2004. Source for bounded strategic-reasoning levels; not a calibration of StrikeSim's k settings.
3. Richard D. McKelvey and Thomas R. Palfrey, [“Quantal Response Equilibria for Normal Form Games”](https://doi.org/10.1006/game.1995.1023), *Games and Economic Behavior* 10(1), 1995. Source for utility-sensitive probabilistic response; StrikeSim uses a finite-plan logit choice rule, not the paper's equilibrium fixed point.
4. Finnegan Southey et al., [“Bayes? Bluff: Opponent Modelling in Poker”](https://mlanthology.org/uai/2005/southey2005uai-bayes/), UAI 2005. Source for maintaining a posterior over opponent strategies and responding to the distribution; StrikeSim's feature likelihood is its own simplified implementation.
5. Sergiu Hart and Andreu Mas-Colell, [“A Simple Adaptive Procedure Leading to Correlated Equilibrium”](https://www.ma.huji.ac.il/~hart/abs/adapt.html), *Econometrica* 68(5), 2000 ([author-hosted paper](https://www.ma.huji.ac.il/hart/papers/adapt.pdf)). Source for regret-matching ideas; StrikeSim uses a bounded external-regret variant on a restricted zero-sum matrix.

The implementation should be reviewed against `red-mind.js`, `game.js`, `tools/doctrine-proof.js`, and `tools/mind-games-proof.js`. If code and this paper diverge, tested runtime behavior governs until the documentation is corrected.

---

**UNCLASSIFIED // NOTIONAL RESEARCH TOOL**
