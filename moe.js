/*
 * moe.js — Denial Measures-of-Effectiveness engine  (window.MoeModule)
 *
 * Implements an OPEN-SOURCE-grounded "Strategy of Denial" assessment for the Taiwan
 * fait-accompli problem. The win condition is NOT destruction (a Measure of Performance);
 * it is whether the Red (PLA) cross-strait operation is HALTED / culminates / capitulates
 * (a Measure of Effectiveness) — i.e. Red fails to generate and sustain enough amphibious
 * throughput to seize and hold the objective. See docs/METHODOLOGY.md for citations.
 *
 * Model (per-node attributes: team, type, subsystem, importance, cascScore, health):
 *   1. Classify each Red node into a functional subsystem (PLA "systems confrontation"
 *      taxonomy, RAND RR-1708 / NDU Keystone 2025), keyed off node.type.
 *   2. subsystemScore(S) = importance-weighted mean health of S's nodes (0..1).
 *   3. OSVI_Red (Operational System Viability Index) = weighted sum of the ENABLER
 *      subsystem scores (C2-first weighting per PLA targeting priority).
 *   4. Amphibious throughput  T = liftCapacity * OSVI_Red^k   (coordination penalty k).
 *   5. capabilityDenial = clamp01((1 - T) / (1 - T_min))  (deny-capability, partial credit)
 *      costDenial       = min(1, redCost / costTolerance) (impose-cost / break-will)
 *   6. denialIndex = (1-balance)*capabilityDenial + balance*costDenial   (intent-weighted)
 *      success (denial achieved) = denialIndex >= threshold
 *      halt = T < T_min ;  capitulation = halt && C2 collapsed
 *
 * Deterministic, dependency-free, no DOM, offline. Caveat (EBO critique, Mattis 2008):
 * cascade/throughput coefficients are modeling assumptions — treat outputs as a robust
 * ORDERING of COA effectiveness with confidence ranges, not a precise prediction.
 */
window.MoeModule = (function () {
  'use strict';

  // Red node.type -> functional subsystem. (Dataset types: Command, Comms, Sensor,
  // EW/Cyber, Fires, Assault, Logistics, Blockade, Protection.)
  var TYPE_TO_SUBSYS = {
    'Command': 'c2', 'Comms': 'c2',
    'Sensor': 'isr',
    'EW/Cyber': 'info',
    'Fires': 'fires',
    'Assault': 'lift',          // amphibious lift = the throughput driver
    'Logistics': 'sustain',
    'Blockade': 'seacontrol',
    'Protection': 'protect'
  };
  // Fallback by node.subsystem when type is missing/unknown.
  var SUBSYS_BY_FIELD = {
    'Information Attack': 'info', 'Firepower Strike': 'fires',
    'Assault': 'lift', 'Blockade': 'seacontrol'
  };
  // Enabler weights (sum=1.0). C2-first per PLA targeting doctrine (Engstrom RR-1708);
  // sustainment weighted for a cross-strait crossing. 'lift' is excluded — it is the
  // multiplicand in the throughput equation, not part of OSVI.
  var ENABLER_WEIGHTS = {
    c2: 0.27, isr: 0.20, fires: 0.16, sustain: 0.15, info: 0.12, seacontrol: 0.06, protect: 0.04
  };
  var DEFAULTS = { balance: 0.35, tMin: 0.30, k: 2.0, costTolerance: 0.55, threshold: 0.5 };
  var SUBSYS_LABELS = {
    c2: 'Command & Control', isr: 'ISR / Reconnaissance', fires: 'Firepower Strike',
    info: 'Information / EW', sustain: 'Sustainment / Logistics', seacontrol: 'Sea Control / Blockade',
    protect: 'Protection / Air Defense', lift: 'Amphibious Lift'
  };

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  function classify(node) {
    if (!node) return 'protect';
    return TYPE_TO_SUBSYS[node.type] || SUBSYS_BY_FIELD[node.subsystem] || 'fires';
  }

  /**
   * Core assessment over an array of Red units: [{ subsys, importance, healthFrac }].
   * opts: { balance, tMin, k, costTolerance, threshold }
   */
  function summarize(redUnits, healthAccessor) {
    var cur = {}, base = {};               // per-subsystem importance-weighted sums
    var totBaseImp = 0, totCurImp = 0;     // for redCost (all subsystems)
    for (var i = 0; i < redUnits.length; i++) {
      var u = redUnits[i];
      var imp = (u.importance == null ? 5 : u.importance);
      var casc = (u.cascScore == null ? 1 : u.cascScore);
      var w = imp * (1 + 0.5 * casc);   // cascade-aware: high-cascade key nodes dominate their
                                        // subsystem (PLA systems-destruction warfare, RR-1708)
      var rawHealth = healthAccessor ? healthAccessor(u) : u.healthFrac;
      var hf = clamp01(rawHealth == null ? 1 : rawHealth);
      var s = u.subsys || 'fires';
      base[s] = (base[s] || 0) + w;
      cur[s] = (cur[s] || 0) + w * hf;
      totBaseImp += w; totCurImp += w * hf;
    }
    return { cur: cur, base: base, totBaseImp: totBaseImp, totCurImp: totCurImp };
  }

  function assessSummary(summary, opts) {
    var o = Object.assign({}, DEFAULTS, opts || {});
    var cur = summary.cur, base = summary.base;
    var totBaseImp = summary.totBaseImp, totCurImp = summary.totCurImp;
    var subsystemScores = {};
    Object.keys(base).forEach(function (s) { subsystemScores[s] = base[s] > 0 ? cur[s] / base[s] : 1; });

    // OSVI over present enablers, weights renormalized to those present.
    var wSum = 0, osvi = 0;
    Object.keys(ENABLER_WEIGHTS).forEach(function (s) {
      if (base[s] > 0) { wSum += ENABLER_WEIGHTS[s]; osvi += ENABLER_WEIGHTS[s] * subsystemScores[s]; }
    });
    osvi = wSum > 0 ? osvi / wSum : 1;

    // Lift capacity: amphibious lift health; fall back to sea-control, then a neutral 0.6.
    var liftCapacity = (base.lift > 0) ? subsystemScores.lift
                     : (base.seacontrol > 0) ? subsystemScores.seacontrol : 0.6;

    var throughput = liftCapacity * Math.pow(osvi, o.k);     // 0..1 fraction of max
    // Partial credit: scales 0 (full throughput) -> 1 (throughput at/below the halt
    // threshold), so reducing Red throughput is rewarded proportionally. 'halt' remains
    // the hard threshold for a culminated/■halted operation.
    var capabilityDenial = clamp01((1 - throughput) / (1 - o.tMin));
    var halt = throughput < o.tMin;

    var redCost = totBaseImp > 0 ? clamp01(1 - totCurImp / totBaseImp) : 0;
    var costDenial = clamp01(redCost / o.costTolerance);

    var denialIndex = clamp01((1 - o.balance) * capabilityDenial + o.balance * costDenial);
    var success = denialIndex >= o.threshold;
    var capitulation = halt && (subsystemScores.c2 != null ? subsystemScores.c2 < 0.30 : false);

    return {
      denialIndex: denialIndex, success: success, halt: halt, capitulation: capitulation,
      throughput: throughput, osviRed: osvi, liftCapacity: liftCapacity, redCost: redCost,
      capabilityDenial: capabilityDenial, costDenial: costDenial,
      subsystemScores: subsystemScores, balance: o.balance
    };
  }

  function assess(redUnits, opts) {
    return assessSummary(summarize(redUnits || []), opts);
  }

  // Compile immutable board identity once for large same-board ensembles. The compiled
  // path calls the exact same summarize -> assessSummary arbiter as assess()/assessGraph;
  // it only avoids rebuilding/classifying 128 unit records in every ghost world.
  function compileGraph(nodes) {
    var units = [];
    (nodes || []).forEach(function (n) {
      if (!n || n.team !== 'red') return;
      var base = n.healthMax || n.health || 100;
      var hf = clamp01((n.health == null ? base : n.health) / base);
      if (n.status === 'Neutralized' || n.alive === false) hf = 0;
      units.push({
        id: n.id,
        subsys: classify(n),
        importance: n.importance,
        cascScore: n.cascScore,
        healthMax: base,
        healthFrac: hf
      });
    });
    return { v: 1, units: units };
  }

  function assessCompiled(compiled, stateById, opts) {
    var units = compiled && compiled.units || [];
    return assessSummary(summarize(units, function (u) {
      var n = stateById && stateById[u.id];
      if (!n) return u.healthFrac;
      if (n.alive === false || n.status === 'Neutralized') return 0;
      return clamp01(Number(n.health == null ? u.healthMax : n.health) / Number(n.healthMax || u.healthMax || 100));
    }), opts);
  }

  // Build Red units from a trial's per-node state Map + sim nodeInfo, then assess.
  // stateMap: Map(id -> {alive, health}); nodeInfo: Map(id -> {team,type,subsystem,importance,health,status})
  function denialOutcome(stateMap, nodeInfo, opts) {
    var units = [];
    nodeInfo.forEach(function (info, id) {
      if (!info || info.team !== 'red') return;
      var st = stateMap && stateMap.get ? stateMap.get(id) : null;
      var base = info.health || info.healthMax || 100;
      var hf = st ? (st.alive ? clamp01(st.health / base) : 0) : (info.status === 'Neutralized' ? 0 : 1);
      units.push({ subsys: classify(info), importance: info.importance, cascScore: info.cascScore, healthFrac: hf });
    });
    return assess(units, opts);
  }

  // Assess a live graph (array of node objects with health/healthMax).
  function assessGraph(nodes, opts) {
    var units = [];
    (nodes || []).forEach(function (n) {
      if (!n || n.team !== 'red') return;
      var base = n.healthMax || n.health || 100;
      var hf = clamp01((n.health == null ? base : n.health) / base);
      if (n.status === 'Neutralized') hf = 0;
      units.push({ subsys: classify(n), importance: n.importance, cascScore: n.cascScore, healthFrac: hf });
    });
    return assess(units, opts);
  }

  /**
   * Goal-driven COA generator. Greedy hill-climb that ADDS the strike (target+method)
   * which most increases the denial index per unit cost — so the generator optimizes the
   * exact MOE the Monte Carlo scores. Deterministic.
   *
   * nodes:  live graph nodes.
   * intent: { balance, maxSteps, riskTolerance(0..1), maxBlueLoss }
   * helpers:{ methods:[{key,name,cost}], strikeProb(node,methodKey)->0..1,
   *           methodFitsRisk?(node,methodKey)->bool }
   * Returns { steps:[{targetId,methodKey}], projectedDenial, baselineDenial, resourceMix,
   *           targetedSubsystems, rationale }
   */
  function generateCoa(nodes, intent, helpers) {
    intent = intent || {}; helpers = helpers || {};
    var balance = intent.balance == null ? DEFAULTS.balance : intent.balance;
    var maxSteps = intent.maxSteps || 8;
    var risk = intent.riskTolerance == null ? 0.5 : intent.riskTolerance;
    // Lower risk tolerance => only attempt higher-probability strikes.
    var probFloor = 0.15 + (1 - risk) * 0.45;
    var methods = helpers.methods || [{ key: 'kinetic', name: 'Kinetic', cost: 1 }];
    var strikeProb = typeof helpers.strikeProb === 'function'
      ? helpers.strikeProb
      : function () { return 0.5; };

    // Working units keyed by id (expected residual health as we plan).
    var units = [], byId = {};
    (nodes || []).forEach(function (n) {
      if (!n || n.team !== 'red') return;
      if (n.status === 'Neutralized') return;
      var u = { id: n.id, node: n, subsys: classify(n), importance: n.importance, cascScore: n.cascScore, healthFrac: 1 };
      units.push(u); byId[n.id] = u;
    });
    var baseAssess = assess(units, { balance: balance });
    var curDI = baseAssess.denialIndex;
    var baselineDenial = curDI;

    var steps = [], usedSubsys = {};
    var safety = 0;
    while (steps.length < maxSteps && safety++ < 2000) {
      var best = null;
      for (var i = 0; i < units.length; i++) {
        var u = units[i];
        if (u.healthFrac <= 0.05) continue;                 // already expected-dead
        for (var m = 0; m < methods.length; m++) {
          var mk = methods[m].key, cost = methods[m].cost || 1;
          var p = clamp01(strikeProb(u.node, mk));
          if (p < probFloor) continue;
          // expected residual health if we add this strike
          var prev = u.healthFrac;
          // Expected residual after one strike: a hit (prob p) removes ~60% of remaining
          // health (avg strike damage), not the whole node — so key nodes realistically take
          // multiple strikes and the projection tracks the Monte Carlo instead of over-killing.
          var trial = prev * (1 - p * 0.6);
          u.healthFrac = trial;
          var di = assess(units, { balance: balance }).denialIndex;
          u.healthFrac = prev;                              // restore
          var gain = di - curDI;
          if (gain <= 0.00001) continue;
          var score = gain / cost * (0.6 + 0.4 * p);        // favor reliable, cheap gains
          if (!best || score > best.score) best = { u: u, mk: mk, p: p, gain: gain, di: di, score: score };
        }
      }
      if (!best) break;
      best.u.healthFrac = best.u.healthFrac * (1 - best.p * 0.6);
      curDI = best.di;
      steps.push({ targetId: best.u.id, methodKey: best.mk });
      usedSubsys[best.u.subsys] = (usedSubsys[best.u.subsys] || 0) + 1;
      if (curDI >= 0.97) break;                              // near-total denial achieved
    }
    var stoppedEarly = steps.length < maxSteps;

    // Resource mix from chosen methods.
    var mixCount = {}, total = steps.length || 1;
    steps.forEach(function (s) { mixCount[s.methodKey] = (mixCount[s.methodKey] || 0) + 1; });
    var resourceMix = {};
    Object.keys(mixCount).forEach(function (k) { resourceMix[k] = Math.round(mixCount[k] / total * 100); });

    var targetedSubsystems = Object.keys(usedSubsys)
      .sort(function (a, b) { return usedSubsys[b] - usedSubsys[a]; })
      .map(function (k) { return { key: k, label: SUBSYS_LABELS[k] || k, count: usedSubsys[k] }; });

    var emphasis = balance < 0.34 ? 'deny capability (paralyze the invasion system)'
                 : balance > 0.66 ? 'impose cost (break the will to continue)'
                 : 'a blend of denying capability and imposing cost';
    var rationale = 'Plan optimized for ' + emphasis + '. It concentrates on '
      + (targetedSubsystems.slice(0, 3).map(function (t) { return t.label; }).join(', ') || 'the highest-leverage nodes')
      + ' to drive Red amphibious throughput below the viable threshold. Projected denial index '
      + Math.round(curDI * 100) + '% (baseline ' + Math.round(baselineDenial * 100) + '%).'
      + (stoppedEarly ? ' Generated ' + steps.length + ' of ' + maxSteps + ' requested steps — further strikes add negligible denial (diminishing returns).' : '');

    return {
      steps: steps, projectedDenial: curDI, baselineDenial: baselineDenial,
      resourceMix: resourceMix, targetedSubsystems: targetedSubsystems, rationale: rationale
    };
  }

  return {
    classify: classify,
    assess: assess,
    denialOutcome: denialOutcome,
    assessGraph: assessGraph,
    compileGraph: compileGraph,
    assessCompiled: assessCompiled,
    generateCoa: generateCoa,
    SUBSYS_LABELS: SUBSYS_LABELS,
    ENABLER_WEIGHTS: ENABLER_WEIGHTS,
    DEFAULTS: DEFAULTS
  };
})();
