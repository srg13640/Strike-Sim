/*
 * forecasting.js — measured-judgment primitives for StrikeSim 2040.
 *
 * UNCLASSIFIED // NOTIONAL RESEARCH TOOL
 *
 * Pure functions only: allowlisted engine-state predicates, deterministic question
 * selection, proper scoring rules, calibration decomposition, and uncertainty gates.
 * The module owns no combat or random-number generator. Callers supply model worlds
 * created by game.js::resolveTurn() and tagged RNG objects from GameModule.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  root.ForecastingModule = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis), function () {
  'use strict';

  var ALPHA = 0.20;
  var MIN_BUCKET_N = 10;
  var MIN_VERDICT_N = 50;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function probability(v) { return clamp(Number(v) || 0, 0, 1); }
  function round(v, places) {
    var scale = Math.pow(10, places == null ? 4 : places);
    return Math.round(Number(v || 0) * scale) / scale;
  }
  function fnv1a(value) {
    var h = 2166136261 >>> 0, s = String(value);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  // No arbitrary property walking: only these canonical end-of-turn fields may become
  // forecast questions. Node IDs are data, but the terminal field remains allowlisted.
  function allowedPath(path) {
    return /^(red\.(throughput|lodgment|projectedLodgmentT5|nodesDownThisTurn|sensorNodesDownThisTurn|commandNodesDownThisTurn)|blue\.(keyNodesLostThisTurn|nodesLostThisTurn|alive|tempoFrac)|result\.(halt|lodgmentComplete)|nodes\.[A-Za-z0-9_.:-]+\.(alive|healthFrac))$/.test(String(path || ''));
  }

  function pathValue(snapshot, path) {
    if (!allowedPath(path)) return { resolved: false, reason: 'path-not-allowed' };
    var parts = String(path).split('.'), value = snapshot;
    for (var i = 0; i < parts.length; i++) {
      if (value == null || !Object.prototype.hasOwnProperty.call(value, parts[i])) {
        return { resolved: false, reason: 'path-missing' };
      }
      value = value[parts[i]];
    }
    return { resolved: true, value: value };
  }

  function resolvePredicate(snapshot, predicate) {
    predicate = predicate || {};
    var found = pathValue(snapshot, predicate.path);
    if (!found.resolved) return found;
    var x = found.value, y = predicate.value, outcome;
    if (predicate.op === 'lt') outcome = Number(x) < Number(y);
    else if (predicate.op === 'lte') outcome = Number(x) <= Number(y);
    else if (predicate.op === 'gt') outcome = Number(x) > Number(y);
    else if (predicate.op === 'gte') outcome = Number(x) >= Number(y);
    else if (predicate.op === 'eq') outcome = x === y;
    else if (predicate.op === 'neq') outcome = x !== y;
    else return { resolved: false, reason: 'operator-not-allowed' };
    return { resolved: true, value: x, outcome: outcome ? 1 : 0 };
  }

  function frequency(worlds, predicate) {
    var hits = 0, resolved = 0;
    (worlds || []).forEach(function (world) {
      var answer = resolvePredicate(world, predicate);
      if (!answer.resolved) return;
      resolved++;
      hits += answer.outcome;
    });
    return { hits: hits, K: resolved, q: resolved ? hits / resolved : null };
  }

  function wilson(hits, n, z) {
    z = z == null ? 1.645 : Number(z); // 90% model-frequency interval
    if (!(n > 0)) return { lo: null, hi: null };
    var p = hits / n, z2 = z * z, denom = 1 + z2 / n;
    var center = (p + z2 / (2 * n)) / denom;
    var half = z * Math.sqrt((p * (1 - p) / n) + z2 / (4 * n * n)) / denom;
    return { lo: probability(center - half), hi: probability(center + half) };
  }

  function targetCategory(node) {
    var descriptor = String(node && (node.subsystem || '')).toLowerCase() + ' ' + String(node && (node.type || '')).toLowerCase();
    if (/sensor|isr|recon|surveillance/.test(descriptor)) return 'detection';
    if (/command|c2|headquarters/.test(descriptor)) return 'c2';
    if (/logistics|sustain|lift|port/.test(descriptor)) return 'logistics';
    return 'attrition';
  }

  function makeQuestion(worlds, spec) {
    var stats = frequency(worlds, spec.predicate);
    if (!stats.K) throw new Error('Generated question did not resolve: ' + spec.id);
    var interval = wilson(stats.hits, stats.K);
    return Object.assign({}, spec, {
      version: 1,
      house: { hits: stats.hits, K: stats.K, q: stats.q, interval: interval },
      tail: stats.q < 0.1 || stats.q > 0.9
    });
  }

  function chooseThreshold(worlds, path, thresholds) {
    var candidates = thresholds.map(function (value) {
      var predicate = { path: path, op: 'lt', value: value };
      var stats = frequency(worlds, predicate);
      return { value: value, predicate: predicate, stats: stats, goldilocks: stats.q != null && stats.q >= 0.2 && stats.q <= 0.8 };
    }).filter(function (x) { return x.stats.K > 0; });
    var pool = candidates.filter(function (x) { return x.goldilocks; });
    if (!pool.length) pool = candidates;
    pool.sort(function (a, b) {
      return Math.abs(a.stats.q - 0.5) - Math.abs(b.stats.q - 0.5) || a.value - b.value;
    });
    return pool[0];
  }

  function generateQuestionSet(worlds, context) {
    context = context || {};
    if (!Array.isArray(worlds) || !worlds.length) throw new Error('Question generation requires model worlds');
    var turn = Number(context.turn || 1);
    var primaryId = String(context.primaryTargetId || '');
    var primaryName = String(context.primaryTargetName || primaryId || 'primary Red target');
    var primaryNode = context.primaryTarget || {};
    if (!primaryId || !worlds[0].nodes || !worlds[0].nodes[primaryId]) {
      primaryId = Object.keys(worlds[0].nodes || {}).filter(function (id) { return worlds[0].nodes[id].team === 'red'; })[0];
      primaryName = primaryId || primaryName;
    }
    var throughput = chooseThreshold(worlds, 'red.throughput', [0.20, 0.30, 0.35, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90]);
    if (!throughput) throw new Error('No resolvable throughput threshold');

    var questions = [
      makeQuestion(worlds, {
        id: 't' + turn + '-primary-destroyed-' + fnv1a(primaryId),
        category: targetCategory(primaryNode),
        prompt: 'Primary target destroyed this turn — ' + primaryName + '?',
        predicate: { path: 'nodes.' + primaryId + '.alive', op: 'eq', value: false },
        deadline: { kind: 'end-of-turn', turn: turn }
      }),
      makeQuestion(worlds, {
        id: 't' + turn + '-throughput-' + String(throughput.value).replace('.', '_'),
        category: 'logistics',
        prompt: 'Red throughput ends below ' + Math.round(throughput.value * 100) + '% this turn?',
        predicate: throughput.predicate,
        deadline: { kind: 'end-of-turn', turn: turn }
      }),
      makeQuestion(worlds, {
        id: 't' + turn + '-blue-key-loss',
        category: 'c2',
        prompt: 'Any Blue key node lost this turn?',
        predicate: { path: 'blue.keyNodesLostThisTurn', op: 'gte', value: 1 },
        deadline: { kind: 'end-of-turn', turn: turn }
      })
    ];

    // The standing item resolves against actual T+5 state. Its house line is a model-world
    // projection under each world's observed end-turn throughput, explicitly not a combat
    // re-run or success verdict.
    var standingModelPredicate = { path: 'red.projectedLodgmentT5', op: 'lt', value: 0.50 };
    var standingStats = frequency(worlds, standingModelPredicate);
    if (!standingStats.K) throw new Error('Standing question projection did not resolve');
    var standing = {
      id: 'operation-lodgment-below-50-t5',
      version: 1,
      category: 'logistics',
      prompt: 'Will Red lodgment remain below 50% at T+5?',
      modelPredicate: standingModelPredicate,
      predicate: { path: 'red.lodgment', op: 'lt', value: 0.50 },
      deadline: { kind: 'end-of-turn', turn: 5 },
      house: { hits: standingStats.hits, K: standingStats.K, q: standingStats.q, interval: wilson(standingStats.hits, standingStats.K) },
      projectionNote: 'Constant-throughput projection from each model world to T+5; not a continuation combat replay.'
    };

    var throughputValues = worlds.map(function (w) { return Number(w.red.throughput); }).filter(Number.isFinite).sort(function (a, b) { return a - b; });
    var loIndex = Math.max(0, Math.floor(0.10 * (throughputValues.length - 1)));
    var hiIndex = Math.min(throughputValues.length - 1, Math.ceil(0.90 * (throughputValues.length - 1)));
    var interval = {
      prompt: 'Your 80%-sure range for end-of-turn Red throughput',
      alpha: ALPHA,
      house: { lo: throughputValues[loIndex], hi: throughputValues[hiIndex], K: throughputValues.length }
    };
    var contract = { turn: turn, questions: questions, standing: standing, interval: interval };
    contract.questionSetHash = fnv1a(JSON.stringify(contract));
    return contract;
  }

  function brier(forecast, outcome) {
    var f = probability(forecast), o = Number(outcome) ? 1 : 0;
    return (f - o) * (f - o);
  }

  function brierSkill(entries) {
    var player = 0, house = 0, n = 0;
    (entries || []).forEach(function (entry) {
      if (entry == null || entry.outcome == null || entry.player == null || entry.house == null) return;
      player += brier(entry.player, entry.outcome);
      house += brier(entry.house, entry.outcome);
      n++;
    });
    return { n: n, player: player, house: house, value: house > 1e-12 ? 1 - player / house : null, pairedDifference: n ? (house - player) / n : null };
  }

  function winkler(lower, upper, actual, alpha) {
    alpha = Number(alpha == null ? ALPHA : alpha);
    var l = probability(Math.min(lower, upper));
    var u = probability(Math.max(lower, upper));
    var x = probability(actual);
    var score = u - l;
    if (x < l) score += (2 / alpha) * (l - x);
    else if (x > u) score += (2 / alpha) * (x - u);
    return score;
  }

  function multicategoryBrier(forecast, outcomeIndex) {
    return (forecast || []).reduce(function (sum, p, i) {
      var o = i === outcomeIndex ? 1 : 0;
      return sum + Math.pow(probability(p) - o, 2);
    }, 0);
  }

  var FAILURE_CAUSES = Object.freeze([
    { id: 'sam-attrition', label: 'Strike package attrition / air-defense pressure' },
    { id: 'lift-intact', label: 'Amphibious lift and sustainment remained intact' },
    { id: 'tempo-collapse', label: 'Blue C2 / tempo collapsed' },
    { id: 'objective-timeout', label: 'Objective clock outran denial effects' }
  ]);

  function classifyFailure(snapshot) {
    snapshot = snapshot || { red: {}, blue: {} };
    if (Number(snapshot.blue && snapshot.blue.nodesLostThisTurn || 0) >= 2) return { failed: true, cause: 'sam-attrition' };
    if (Number(snapshot.red && snapshot.red.throughput || 0) >= 0.65) return { failed: true, cause: 'lift-intact' };
    if (Number(snapshot.blue && snapshot.blue.keyNodesLostThisTurn || 0) > 0 || Number(snapshot.blue && snapshot.blue.tempoFrac == null ? 1 : snapshot.blue.tempoFrac) < 0.80) return { failed: true, cause: 'tempo-collapse' };
    if (Number(snapshot.red && snapshot.red.projectedLodgmentT5 || 0) >= 0.50) return { failed: true, cause: 'objective-timeout' };
    return { failed: false, cause: null };
  }

  function failureCauseSet(worlds) {
    var counts = Object.fromEntries(FAILURE_CAUSES.map(function (c) { return [c.id, 0]; }));
    var failed = 0;
    (worlds || []).forEach(function (world) {
      var result = classifyFailure(world);
      if (!result.failed) return;
      failed++;
      counts[result.cause]++;
    });
    var categories = FAILURE_CAUSES.map(function (cause) {
      return { id: cause.id, label: cause.label, count: counts[cause.id], q: failed ? counts[cause.id] / failed : 0.25 };
    }).sort(function (a, b) { return b.count - a.count || a.id.localeCompare(b.id); });
    return { categories: categories, failedWorlds: failed, K: (worlds || []).length };
  }

  function murphy(entries) {
    var valid = (entries || []).filter(function (e) { return e && e.player != null && e.outcome != null; });
    var N = valid.length;
    if (!N) return { n: 0, bs: null, rel: null, res: null, unc: null, identityError: null };
    var bins = {}, outcomeMean = valid.reduce(function (s, e) { return s + (e.outcome ? 1 : 0); }, 0) / N;
    valid.forEach(function (e) {
      var key = Math.round(probability(e.player) * 100); // exact authored 1% value
      if (!bins[key]) bins[key] = { n: 0, forecast: 0, outcome: 0 };
      bins[key].n++;
      bins[key].forecast += probability(e.player);
      bins[key].outcome += e.outcome ? 1 : 0;
    });
    var rel = 0, res = 0;
    Object.keys(bins).forEach(function (key) {
      var bin = bins[key], f = bin.forecast / bin.n, o = bin.outcome / bin.n;
      rel += (bin.n / N) * Math.pow(f - o, 2);
      res += (bin.n / N) * Math.pow(o - outcomeMean, 2);
    });
    var unc = outcomeMean * (1 - outcomeMean);
    var bs = valid.reduce(function (s, e) { return s + brier(e.player, e.outcome); }, 0) / N;
    return { n: N, bs: bs, rel: rel, res: res, unc: unc, identityError: bs - (rel - res + unc), bins: bins };
  }

  function foldedBuckets(entries) {
    var labels = ['50–59', '60–69', '70–79', '80–89', '90–99', '100'];
    var buckets = Object.fromEntries(labels.map(function (label) { return [label, { label: label, n: 0, confidence: 0, correct: 0 }]; }));
    (entries || []).forEach(function (entry) {
      if (!entry || entry.player == null || entry.outcome == null) return;
      var p = probability(entry.player), confidence = Math.max(p, 1 - p), pct = Math.round(confidence * 100);
      var label = pct >= 100 ? '100' : pct >= 90 ? '90–99' : pct >= 80 ? '80–89' : pct >= 70 ? '70–79' : pct >= 60 ? '60–69' : '50–59';
      var correct = p >= 0.5 ? (entry.outcome ? 1 : 0) : (entry.outcome ? 0 : 1);
      buckets[label].n++;
      buckets[label].confidence += confidence;
      buckets[label].correct += correct;
    });
    return labels.map(function (label) {
      var b = buckets[label];
      return { label: label, n: b.n, forecast: b.n ? b.confidence / b.n : null, observed: b.n ? b.correct / b.n : null, display: b.n >= MIN_BUCKET_N };
    });
  }

  function bootstrapBss(entries, rng, reps) {
    reps = Math.max(100, Number(reps || 500));
    var valid = (entries || []).filter(function (e) { return e && e.player != null && e.house != null && e.outcome != null; });
    var point = brierSkill(valid);
    if (!valid.length || !rng) return { n: valid.length, point: point.value, lo: null, hi: null };
    var groups = {};
    valid.forEach(function (e, i) {
      var key = String(e.questionId || e.id || i);
      (groups[key] = groups[key] || []).push(e);
    });
    var keys = Object.keys(groups), draws = [];
    for (var r = 0; r < reps; r++) {
      var sample = [];
      for (var j = 0; j < keys.length; j++) {
        var key = keys[Math.floor(rng.next() * keys.length)];
        sample = sample.concat(groups[key]);
      }
      var score = brierSkill(sample).value;
      if (score != null && Number.isFinite(score)) draws.push(score);
    }
    draws.sort(function (a, b) { return a - b; });
    function quantile(p) { return draws.length ? draws[Math.min(draws.length - 1, Math.max(0, Math.floor(p * (draws.length - 1))))] : null; }
    return { n: valid.length, groups: keys.length, point: point.value, lo: quantile(0.05), hi: quantile(0.95) };
  }

  function analystRank(entries, band) {
    var n = (entries || []).length;
    if (n < MIN_VERDICT_N || !band || band.lo == null) {
      return { label: 'Watch Officer', verdict: false, note: n + '/' + MIN_VERDICT_N + ' resolved calls; rank evidence gate not yet met.' };
    }
    if (band.lo >= 0.15) return { label: 'Superforecaster', verdict: true, note: 'Sustained positive skill with the 90% lower bound above +0.15.' };
    if (band.lo > 0) return { label: 'Fusion Analyst', verdict: true, note: 'Sustained positive skill with the 90% lower bound above the house.' };
    return { label: 'Watch Officer', verdict: true, note: 'The uncertainty band does not yet clear the house baseline.' };
  }

  return Object.freeze({
    CLASSIFICATION: 'UNCLASSIFIED // NOTIONAL RESEARCH TOOL',
    ALPHA: ALPHA,
    MIN_BUCKET_N: MIN_BUCKET_N,
    MIN_VERDICT_N: MIN_VERDICT_N,
    allowedPath: allowedPath,
    pathValue: pathValue,
    resolvePredicate: resolvePredicate,
    frequency: frequency,
    wilson: wilson,
    generateQuestionSet: generateQuestionSet,
    brier: brier,
    brierSkill: brierSkill,
    winkler: winkler,
    multicategoryBrier: multicategoryBrier,
    FAILURE_CAUSES: FAILURE_CAUSES,
    classifyFailure: classifyFailure,
    failureCauseSet: failureCauseSet,
    murphy: murphy,
    foldedBuckets: foldedBuckets,
    bootstrapBss: bootstrapBss,
    analystRank: analystRank,
    hash: fnv1a,
    probability: probability,
    round: round
  });
});
