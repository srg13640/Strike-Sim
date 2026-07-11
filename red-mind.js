/*
 * red-mind.js — bounded-rational Red policy primitives for StrikeSim 2040.
 *
 * UNCLASSIFIED // NOTIONAL RESEARCH TOOL
 *
 * This module contains NO combat model. It describes Harsanyi types, legacy
 * difficulty mappings, quantal choice, and bounded level-k plan comparison.
 * Callers supply candidate plans and an evaluator backed by game.js::resolveTurn().
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  root.RedMindModule = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis), function () {
  'use strict';

  var PRIOR = Object.freeze({ attrition: 0.50, decapitation: 0.30, denial: 0.20 });

  // All weights are relative behavioral preferences, not claims about PLA plans.
  // The escalation appetite is consumed by the later ladder workstream; declaring it
  // here keeps doctrine a single stable contract across targeting and escalation.
  var DOCTRINES = Object.freeze({
    attrition: Object.freeze({
      id: 'attrition', label: 'Attrition',
      strikeShare: 0.60, focusFire: 3, repairBias: 0.40,
      target: Object.freeze({ tempo: 0.18, command: 0.12, logistics: 0.14, lodgment: 0.18, fires: 0.32, damaged: 0.28 }),
      protect: Object.freeze({ tempo: 0.48, lodgment: 0.05 }),
      methods: Object.freeze({ kinetic: 1.30, cyber: 2.40, ew: 3.00, sof: 1.20 }),
      utility: Object.freeze({ enemyLoss: 1.08, ownLoss: 0.92, throughput: 0.20, tempo: 0.18 }),
      escalationAppetite: 0.64,
      deceptionRate: 0.16
    }),
    decapitation: Object.freeze({
      id: 'decapitation', label: 'Decapitation',
      strikeShare: 0.65, focusFire: 2, repairBias: 0.64,
      target: Object.freeze({ tempo: 0.72, command: 0.90, logistics: 0.28, lodgment: 0.08, fires: 0.08, damaged: 0.12 }),
      protect: Object.freeze({ tempo: 0.82, lodgment: 2.50 }),
      methods: Object.freeze({ kinetic: 1.20, cyber: 3.00, ew: 3.50, sof: 1.50 }),
      utility: Object.freeze({ enemyLoss: 1.00, ownLoss: 0.92, throughput: 3.00, tempo: 0.72 }),
      escalationAppetite: 0.82,
      deceptionRate: 0.24
    }),
    denial: Object.freeze({
      id: 'denial', label: 'Denial / Fait Accompli',
      strikeShare: 0.40, focusFire: 1, repairBias: 0.82,
      target: Object.freeze({ tempo: 0.42, command: 0.28, logistics: 0.48, lodgment: 0.12, fires: 0.58, damaged: 0.08 }),
      protect: Object.freeze({ tempo: 0.72, lodgment: 4.00 }),
      methods: Object.freeze({ kinetic: 1.00, cyber: 3.00, ew: 4.20, sof: 1.20 }),
      utility: Object.freeze({ enemyLoss: 0.68, ownLoss: 1.35, throughput: 8.00, tempo: 0.42 }),
      escalationAppetite: 0.48,
      deceptionRate: 0.38
    })
  });

  var BALANCED = Object.freeze({
    id: 'balanced', label: 'Balanced Joint Force',
    strikeShare: 0.84, focusFire: 1, repairBias: 0.55,
    target: Object.freeze({ tempo: 0.30, command: 0.18, logistics: 0.55, lodgment: 9.00, fires: 0.12, damaged: 0.10 }),
    protect: Object.freeze({ tempo: 0.70, lodgment: 0.65 }),
    methods: Object.freeze({ kinetic: 1.05, cyber: 2.60, ew: 4.00, sof: 1.30 }),
    utility: Object.freeze({ enemyLoss: 0.82, ownLoss: 0.72, throughput: 5.00, tempo: 0.28 }),
    escalationAppetite: 0.50,
    deceptionRate: 0.20
  });

  // Lambda is applied to standardized utilities, so these values are stable when the
  // scenario's raw objective-value scale changes. Candidate×opponent rollouts are capped
  // at 5×8=40 by boundedChoice().
  var DIFFICULTIES = Object.freeze({
    easy: Object.freeze({ id: 'easy', k: 0, lambda: 0.80, candidates: 5, opponentSamples: 0, fatigueDecay: 0.045, kDrop: 0.16 }),
    hard: Object.freeze({ id: 'hard', k: 1, lambda: 4.25, candidates: 5, opponentSamples: 8, fatigueDecay: 0.025, kDrop: 0.045 }),
    elite: Object.freeze({ id: 'elite', k: 2, lambda: 5.75, candidates: 5, opponentSamples: 8, fatigueDecay: 0.018, kDrop: 0.025 })
  });

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function normalizeBelief(input) {
    var out = {}, total = 0;
    Object.keys(PRIOR).forEach(function (id) {
      var value = Number(input && input[id]);
      out[id] = Number.isFinite(value) && value > 0 ? value : 0;
      total += out[id];
    });
    if (!(total > 0)) return Object.assign({}, PRIOR);
    Object.keys(out).forEach(function (id) { out[id] /= total; });
    return out;
  }

  function drawDoctrine(belief, rng) {
    var p = normalizeBelief(belief);
    var draw = rng.next(), cumulative = 0;
    var ids = Object.keys(PRIOR);
    for (var i = 0; i < ids.length; i++) {
      cumulative += p[ids[i]];
      if (draw <= cumulative || i === ids.length - 1) return ids[i];
    }
    return ids[ids.length - 1];
  }

  function doctrine(id) { return DOCTRINES[id] || BALANCED; }

  function difficulty(value) {
    if (value && typeof value === 'object') {
      var base = DIFFICULTIES[value.id] || DIFFICULTIES.hard;
      return {
        id: String(value.id || base.id),
        k: clamp(Math.round(value.k == null ? base.k : Number(value.k)), 0, 2),
        lambda: clamp(Number(value.lambda == null ? base.lambda : value.lambda), 0.05, 12),
        candidates: clamp(Math.round(value.candidates == null ? base.candidates : Number(value.candidates)), 1, 5),
        opponentSamples: clamp(Math.round(value.opponentSamples == null ? base.opponentSamples : Number(value.opponentSamples)), 0, 8),
        fatigueDecay: clamp(Number(value.fatigueDecay == null ? base.fatigueDecay : value.fatigueDecay), 0, 0.12),
        kDrop: clamp(Number(value.kDrop == null ? base.kDrop : value.kDrop), 0, 0.5)
      };
    }
    var key = String(value || 'hard').toLowerCase();
    if (key === 'training') key = 'easy';
    if (key === 'contested' || key === 'normal') key = 'hard';
    if (key === 'expert') key = 'elite';
    return Object.assign({}, DIFFICULTIES[key] || DIFFICULTIES.hard);
  }

  function copyPolicy(base) {
    base = base || BALANCED;
    return {
      id: base.id, label: base.label,
      strikeShare: base.strikeShare, focusFire: base.focusFire, repairBias: base.repairBias,
      target: Object.assign({}, base.target), protect: Object.assign({}, base.protect),
      methods: Object.assign({}, base.methods), utility: Object.assign({}, base.utility), escalationAppetite: base.escalationAppetite,
      deceptionRate: base.deceptionRate
    };
  }

  // Five small, legible deviations form the restricted action set. They vary allocation,
  // focus, and method preference; they do not add random target-score noise.
  function candidatePolicies(base, count) {
    var variants = [], n = clamp(Number(count) || 5, 1, 5);
    for (var i = 0; i < n; i++) {
      var p = copyPolicy(base);
      p.variant = i;
      if (i === 1) {
        p.strikeShare = clamp(p.strikeShare + 0.12, 0.15, 0.92);
        p.focusFire = clamp(p.focusFire + 1, 1, 3);
        p.methods.kinetic *= 1.10;
      } else if (i === 2) {
        p.strikeShare = clamp(p.strikeShare - 0.16, 0.15, 0.92);
        p.repairBias = clamp(p.repairBias + 0.15, 0.1, 0.9);
        p.protect.lodgment *= 1.25;
      } else if (i === 3) {
        p.target.tempo *= 1.35;
        p.target.command *= 1.35;
        p.methods.cyber *= 1.12;
        p.methods.ew *= 1.08;
      } else if (i === 4) {
        p.focusFire = 1;
        p.target.fires *= 1.30;
        p.target.logistics *= 1.20;
        p.methods.sof *= 1.08;
      }
      variants.push(p);
    }
    return variants;
  }

  function quantalDistribution(scores, lambda) {
    if (!scores.length) return [];
    var mean = scores.reduce(function (a, b) { return a + b; }, 0) / scores.length;
    var variance = scores.reduce(function (a, b) { var d = b - mean; return a + d * d; }, 0) / scores.length;
    var scale = Math.sqrt(variance);
    if (!(scale > 1e-9)) return scores.map(function () { return 1 / scores.length; });
    var logits = scores.map(function (s) { return clamp(lambda * ((s - mean) / scale), -30, 30); });
    var max = Math.max.apply(null, logits);
    var weights = logits.map(function (x) { return Math.exp(x - max); });
    var total = weights.reduce(function (a, b) { return a + b; }, 0) || 1;
    return weights.map(function (w) { return w / total; });
  }

  function sampleIndex(probabilities, rng) {
    if (!probabilities.length) return -1;
    var draw = rng.next(), cumulative = 0;
    for (var i = 0; i < probabilities.length; i++) {
      cumulative += probabilities[i];
      if (draw <= cumulative || i === probabilities.length - 1) return i;
    }
    return probabilities.length - 1;
  }

  function reasoningState(diff, turn, rng) {
    var d = difficulty(diff);
    var fatigueTurns = Math.max(0, Number(turn || 1) - 1);
    var effectiveLambda = Math.max(0.15, d.lambda * (1 - d.fatigueDecay * fatigueTurns));
    var dropChance = clamp(d.kDrop + fatigueTurns * d.fatigueDecay * 0.15, 0, 0.45);
    var effectiveK = d.k > 0 && rng.next() < dropChance ? 0 : d.k;
    return { configuredK: d.k, k: effectiveK, lambda: effectiveLambda, drop: effectiveK < d.k, difficulty: d };
  }

  // evaluator(candidatePlan, opponentPlan, i, j) -> { utility, opponentUtility? }
  // Level 1 scores mean utility against the sampled level-0 opponent distribution.
  // Level 2 first quantally weights the opponent plans by their own utility, then
  // best-responds to that distribution. The same ≤40 resolver results feed both levels.
  function boundedChoice(options) {
    options = options || {};
    var candidates = (options.candidates || []).slice(0, 5);
    var opponents = (options.opponents || []).slice(0, 8);
    var rng = options.rng;
    if (!candidates.length || !rng) return { index: -1, plan: [], probabilities: [], scores: [], rollouts: 0, k: 0, lambda: 0, dropped: false };
    var state = reasoningState(options.difficulty, options.turn, options.reasoningRng || rng);
    var heuristic = candidates.map(function (c) { return Number(c.heuristic || 0); });
    var scores = heuristic.slice(), rollouts = 0;

    if (state.k > 0 && opponents.length && typeof options.evaluator === 'function') {
      var matrix = candidates.map(function () { return []; });
      var oppUtility = opponents.map(function () { return 0; });
      for (var i = 0; i < candidates.length; i++) {
        for (var j = 0; j < opponents.length; j++) {
          var result = options.evaluator(candidates[i].plan, opponents[j].plan, i, j) || {};
          matrix[i][j] = Number(result.utility || 0);
          oppUtility[j] += Number(result.opponentUtility == null ? -matrix[i][j] : result.opponentUtility);
          rollouts++;
        }
      }
      var oppWeights = opponents.map(function () { return 1 / opponents.length; });
      if (state.k >= 2) {
        oppUtility = oppUtility.map(function (v) { return v / candidates.length; });
        oppWeights = quantalDistribution(oppUtility, state.lambda);
      }
      scores = matrix.map(function (row) {
        return row.reduce(function (sum, value, j) { return sum + value * oppWeights[j]; }, 0);
      });
    }

    var probabilities = quantalDistribution(scores, state.lambda);
    var index = sampleIndex(probabilities, rng);
    return {
      index: index,
      plan: index >= 0 ? candidates[index].plan : [],
      probabilities: probabilities,
      scores: scores,
      rollouts: rollouts,
      k: state.k,
      configuredK: state.configuredK,
      lambda: state.lambda,
      dropped: state.drop
    };
  }

  function priorText(belief) {
    var p = normalizeBelief(belief);
    return Object.keys(PRIOR).map(function (id) {
      return id + ' ' + Math.round(p[id] * 100);
    }).join(' / ');
  }

  return Object.freeze({
    CLASSIFICATION: 'UNCLASSIFIED // NOTIONAL RESEARCH TOOL',
    PRIOR: PRIOR,
    DOCTRINES: DOCTRINES,
    BALANCED: BALANCED,
    DIFFICULTIES: DIFFICULTIES,
    normalizeBelief: normalizeBelief,
    drawDoctrine: drawDoctrine,
    doctrine: doctrine,
    difficulty: difficulty,
    candidatePolicies: candidatePolicies,
    quantalDistribution: quantalDistribution,
    sampleIndex: sampleIndex,
    reasoningState: reasoningState,
    boundedChoice: boundedChoice,
    priorText: priorText
  });
});
