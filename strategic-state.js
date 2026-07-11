/*
 * strategic-state.js — pure strategic-state mechanics for StrikeSim 2040.
 *
 * UNCLASSIFIED // NOTIONAL RESEARCH TOOL
 *
 * This module owns no browser, clock, storage, or random state. Every transition is a
 * pure function of explicit inputs. Callers that want stochastic behavior must supply
 * a seeded roll value, function, or RNG object with next().
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StrategicStateModule = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var CLASSIFICATION = 'UNCLASSIFIED // NOTIONAL RESEARCH TOOL';
  var VERSION = 1;

  var DEFAULT_CONFIG = {
    classification: CLASSIFICATION,
    escalation: {
      min: 0,
      max: 10,
      initial: 0,
      baseTurnDelta: 0,
      // Horizontal escalation widens the geography or political constituency exposed.
      // The largest matching tag is used so synonymous tags do not double-count one act.
      horizontalWeights: {
        'afloat': 0.15,
        'airborne': 0.20,
        'offshore-island': 0.25,
        'cyberspace': 0.35,
        'homeland-littoral': 0.70,
        'prc-mainland': 0.80,
        'homeland-interior': 1.00,
        'orbital': 1.10,
        'japan-soil': 1.60,
        'nation:Japan': 1.60
      },
      // Vertical escalation changes the means employed. Values are game assumptions.
      verticalWeights: {
        'ew': 0.15,
        'cyber': 0.35,
        'kinetic': 0.60,
        'sof': 0.80,
        'feint': 0,
        'decoy': 0
      },
      outcomeMultipliers: {
        'attempt': 1.00,
        'miss': 0.75,
        'hit': 1.00,
        'kill': 1.15,
        'void': 0
      },
      // First impulse in each dimension is full strength; later same-turn impulses fade.
      diminishingReturns: { factor: 0.55, floor: 0.20 }
    },
    indicators: {
      minLines: 2,
      maxLines: 4,
      signalWeights: { genuine: 1, feint: 3, decoy: 2 },
      templates: {
        axis: [
          'Activity is concentrating along the {axis} axis.',
          'Command traffic suggests emphasis along the {axis} axis.'
        ],
        method: [
          'Preparation signatures are consistent with {method} employment.',
          'Readiness traffic points to possible {method} activity.'
        ],
        target: [
          'Collection and targeting activity is focused on {targetClass}.',
          'Operational interest appears concentrated on {targetClass}.'
        ],
        defense: [
          'Protective activity is increasing around {targetClass}.',
          'Defensive preparations are visible near {targetClass}.'
        ],
        summary: [
          'The committed package remains concentrated rather than broadly distributed.',
          'Reporting suggests a bounded package with unresolved secondary activity.'
        ],
        absence: [
          'No high-confidence operational indicator has resolved from the committed package.',
          'Reporting remains fragmentary; no additional axis can be assessed.'
        ]
      }
    },
    signals: {
      costs: { feint: 1, decoy: 0 },
      boardEffect: 'none',
      leakProbabilityByKind: { feint: 0.10, decoy: 0.25 }
    }
  };

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function finite(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, lo, hi) {
    return Math.min(hi, Math.max(lo, value));
  }

  function uniqueSorted(values) {
    var seen = {};
    return (values || []).filter(function (value) {
      var key = String(value == null ? '' : value);
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    }).map(String).sort();
  }

  function merge(base, override) {
    var out = {};
    Object.keys(base || {}).forEach(function (key) {
      var value = base[key];
      out[key] = isObject(value) ? merge(value, {}) : Array.isArray(value) ? value.slice() : value;
    });
    Object.keys(override || {}).forEach(function (key) {
      var value = override[key];
      out[key] = isObject(value) && isObject(out[key]) ? merge(out[key], value)
        : Array.isArray(value) ? value.slice() : value;
    });
    return out;
  }

  function escalationConfig(config) {
    var raw = config && config.escalation ? config.escalation : (config || {});
    return merge(DEFAULT_CONFIG.escalation, raw);
  }

  function indicatorConfig(config) {
    var raw = config && config.indicators ? config.indicators : (config || {});
    return merge(DEFAULT_CONFIG.indicators, raw);
  }

  function signalConfig(config) {
    var raw = config && config.signals ? config.signals : (config || {});
    return merge(DEFAULT_CONFIG.signals, raw);
  }

  function targetTokens(target) {
    target = target || {};
    var tags = [];
    if (Array.isArray(target.escalationTags)) tags = tags.concat(target.escalationTags);
    if (Array.isArray(target.tags)) tags = tags.concat(target.tags);
    if (target.geographyClass) {
      tags.push(target.geographyClass);
      tags.push('geography:' + target.geographyClass);
    }
    if (target.nation) {
      tags.push(target.nation);
      tags.push('nation:' + target.nation);
    }
    return uniqueSorted(tags);
  }

  function maxTokenWeight(tokens, weights) {
    var best = 0;
    var matched = null;
    (tokens || []).forEach(function (token) {
      var weight = finite(weights && weights[token], 0);
      if (weight > best || (weight === best && weight > 0 && String(token) < String(matched))) {
        best = weight;
        matched = token;
      }
    });
    return { weight: Math.max(0, best), matchedTag: matched };
  }

  function eventKey(event, index) {
    return String(event.orderId || event.id || event.sourceOrderId || ('event-' + index));
  }

  function escalationImpulse(event, index, config) {
    event = event || {};
    var target = event.target || event.targetNode || event;
    var method = String(event.escalationMethod || event.methodKey || event.method || event.kind || '').toLowerCase();
    var outcome = String(event.outcome || event.result || 'attempt').toLowerCase();
    var outcomeMultiplier = Math.max(0, finite(config.outcomeMultipliers[outcome], 1));
    var horizontal = maxTokenWeight(targetTokens(target), config.horizontalWeights);
    var horizontalRaw = event.horizontalImpulse == null
      ? horizontal.weight * outcomeMultiplier
      : Math.max(0, finite(event.horizontalImpulse, 0));
    var verticalRaw = event.verticalImpulse == null
      ? Math.max(0, finite(config.verticalWeights[method], 0)) * outcomeMultiplier
      : Math.max(0, finite(event.verticalImpulse, 0));
    if (event.escalationEligible === false) { horizontalRaw = 0; verticalRaw = 0; }
    return {
      key: eventKey(event, index),
      orderId: event.orderId || event.sourceOrderId || null,
      method: method,
      outcome: outcome,
      matchedHorizontalTag: horizontal.matchedTag,
      horizontalRaw: horizontalRaw,
      verticalRaw: verticalRaw
    };
  }

  function diminishDimension(impulses, field, config) {
    var factor = clamp(finite(config.factor, 0.55), 0, 1);
    var floor = clamp(finite(config.floor, 0.20), 0, 1);
    var rows = impulses.filter(function (impulse) { return impulse[field] > 0; })
      .map(function (impulse) { return { key: impulse.key, raw: impulse[field] }; })
      .sort(function (a, b) { return b.raw - a.raw || a.key.localeCompare(b.key); });
    var raw = 0;
    var adjusted = 0;
    rows.forEach(function (row, rank) {
      var multiplier = rank === 0 ? 1 : Math.max(floor, Math.pow(factor, rank));
      row.rank = rank;
      row.multiplier = multiplier;
      row.adjusted = row.raw * multiplier;
      raw += row.raw;
      adjusted += row.adjusted;
    });
    return { raw: raw, adjusted: adjusted, impulses: rows };
  }

  /**
   * Pure per-turn escalation transition. `events` should contain one normalized outcome
   * per committed action; callers may use `orderId` to preserve traceability.
   */
  function updateEscalation(currentValue, events, config) {
    var cfg = escalationConfig(config);
    var lo = finite(cfg.min, 0);
    var hi = finite(cfg.max, 10);
    if (hi < lo) throw new Error('Escalation max must be greater than or equal to min.');
    var before = clamp(finite(currentValue, finite(cfg.initial, lo)), lo, hi);
    var impulses = (events || []).map(function (event, index) {
      return escalationImpulse(event, index, cfg);
    });
    var horizontal = diminishDimension(impulses, 'horizontalRaw', cfg.diminishingReturns || {});
    var vertical = diminishDimension(impulses, 'verticalRaw', cfg.diminishingReturns || {});
    var baseTurnDelta = finite(cfg.baseTurnDelta, 0);
    var rawDelta = baseTurnDelta + horizontal.raw + vertical.raw;
    var requestedDelta = baseTurnDelta + horizontal.adjusted + vertical.adjusted;
    var after = clamp(before + requestedDelta, lo, hi);
    return {
      before: before,
      after: after,
      delta: after - before,
      requestedDelta: requestedDelta,
      rawDelta: rawDelta,
      clamped: after !== before + requestedDelta,
      breakdown: {
        baseTurnDelta: baseTurnDelta,
        horizontal: horizontal,
        vertical: vertical
      },
      impulses: impulses
    };
  }

  function arrayAllows(filter, value) {
    return !Array.isArray(filter) || filter.length === 0 || filter.indexOf(value) >= 0;
  }

  function intersects(left, right) {
    if (!Array.isArray(right) || right.length === 0) return true;
    return right.some(function (value) { return left.indexOf(value) >= 0; });
  }

  function containsAll(left, right) {
    if (!Array.isArray(right) || right.length === 0) return true;
    return right.every(function (value) { return left.indexOf(value) >= 0; });
  }

  function ruleApplies(rule, order, context) {
    var applies = rule.appliesTo || rule.when || {};
    var target = context.target || order.target || {};
    var tags = targetTokens(target);
    var kind = String(order.kind || '');
    var method = String(order.methodKey || order.method || '');
    var side = String(order.side || context.side || '');
    return arrayAllows(applies.actionKinds || applies.kinds, kind) &&
      arrayAllows(applies.methodKeys || applies.methods, method) &&
      arrayAllows(applies.sides, side) &&
      arrayAllows(applies.targetNations, target.nation) &&
      arrayAllows(applies.geographyClasses, target.geographyClass) &&
      intersects(tags, applies.targetTagsAny) &&
      containsAll(tags, applies.targetTagsAll);
  }

  function activationGroups(context) {
    var activation = context.activation || {};
    var groups = activation.groups || activation;
    return Object.keys(groups || {}).filter(function (key) { return groups[key] === true; }).sort();
  }

  function requirementFailure(requirement, context) {
    requirement = requirement || {};
    var e = finite(context.escalation, 0);
    if (requirement.minEscalation != null && e < Number(requirement.minEscalation)) {
      return { reason: 'roe-min-escalation', required: Number(requirement.minEscalation), actual: e };
    }
    if (requirement.maxEscalation != null && e > Number(requirement.maxEscalation)) {
      return { reason: 'roe-max-escalation', required: Number(requirement.maxEscalation), actual: e };
    }
    var active = activationGroups(context);
    if (!containsAll(active, requirement.activeGroupsAll)) {
      return { reason: 'roe-required-activation', required: (requirement.activeGroupsAll || []).slice(), actual: active };
    }
    if (Array.isArray(requirement.activeGroupsAny) && requirement.activeGroupsAny.length &&
        !intersects(active, requirement.activeGroupsAny)) {
      return { reason: 'roe-required-activation', required: requirement.activeGroupsAny.slice(), actual: active };
    }
    return null;
  }

  /**
   * Structured ROE authorization. This does not replace base combat validation; it adds
   * public commitment constraints that the UI, AI, forecasts, and resolver can share.
   */
  function authorizeOrder(order, context, roe) {
    context = context || {};
    if (!order) return { ok: false, reason: 'no-order', ruleId: null };
    if (!roe) return { ok: true, reason: 'ok', ruleId: null, matchedRuleIds: [] };
    var rules = Array.isArray(roe.rules) ? roe.rules : (Array.isArray(roe.constraints) ? roe.constraints : []);
    var matched = [];
    var permitted = false;
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i] || {};
      if (!ruleApplies(rule, order, context)) continue;
      var ruleId = rule.id || ('rule-' + i);
      matched.push(ruleId);
      if (rule.effect === 'deny') {
        return { ok: false, reason: rule.reason || 'roe-denied', ruleId: ruleId,
          message: rule.message || 'The declared ROE prohibits this order.', matchedRuleIds: matched };
      }
      var failure = requirementFailure(rule.require || rule.requires, context);
      if (failure) {
        failure.ok = false;
        failure.ruleId = ruleId;
        failure.message = rule.message || 'The declared ROE condition has not been met.';
        failure.matchedRuleIds = matched;
        return failure;
      }
      if (rule.effect === 'permit') permitted = true;
    }
    if ((roe.defaultDecision || 'allow') === 'deny' && !permitted) {
      return { ok: false, reason: 'roe-default-deny', ruleId: null,
        message: roe.defaultMessage || 'The declared ROE does not authorize this order.', matchedRuleIds: matched };
    }
    return { ok: true, reason: 'ok', ruleId: null, matchedRuleIds: matched };
  }

  function normalizeProbability(value, fallback) {
    return clamp(finite(value, fallback), 0, 1);
  }

  function readRoll(source, tag) {
    var value;
    if (typeof source === 'number') value = source;
    else if (typeof source === 'function') value = source(tag);
    else if (source && typeof source.next === 'function') value = source.next(tag);
    else if (source && Object.prototype.hasOwnProperty.call(source, tag)) {
      value = typeof source[tag] === 'function' ? source[tag](tag) : source[tag];
    } else {
      throw new Error('A seeded roll source is required for probabilistic transition "' + tag + '".');
    }
    value = Number(value);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error('Seeded roll for "' + tag + '" must be a number in [0,1].');
    }
    return value;
  }

  function probabilisticDecision(probability, source, tag) {
    var p = normalizeProbability(probability, 0);
    if (p <= 0) return { passed: false, probability: p, roll: null, drawConsumed: false };
    if (p >= 1) return { passed: true, probability: p, roll: null, drawConsumed: false };
    var roll = readRoll(source, tag);
    return { passed: roll < p, probability: p, roll: roll, drawConsumed: true };
  }

  function createAllyTrack(config, initial) {
    config = config || {};
    initial = initial || {};
    var active = initial.active === true;
    return {
      active: active,
      entryArmed: initial.entryArmed != null ? !!initial.entryArmed : !active,
      exitArmed: initial.exitArmed != null ? !!initial.exitArmed : active,
      entryAttempts: Math.max(0, Math.floor(finite(initial.entryAttempts, 0))),
      exitAttempts: Math.max(0, Math.floor(finite(initial.exitAttempts, 0))),
      lastEscalation: finite(initial.lastEscalation, finite(config.initialEscalation, 0)),
      lastDecision: initial.lastDecision || null
    };
  }

  /**
   * Advance one ally posture track. A probabilistic draw is requested only when an armed
   * entry/exit threshold is crossed. Failed draws do not repeat while the track remains
   * beyond that threshold; it must cross the configured reset threshold to re-arm.
   */
  function advanceAllyTrack(track, escalationValue, config, rollSource, meta) {
    config = config || {};
    meta = meta || {};
    var entryThreshold = finite(config.entryThreshold, 6);
    var exitThreshold = finite(config.exitThreshold, 4);
    if (entryThreshold <= exitThreshold) throw new Error('Ally entryThreshold must exceed exitThreshold for hysteresis.');
    var entryResetThreshold = finite(config.entryResetThreshold, exitThreshold);
    var exitResetThreshold = finite(config.exitResetThreshold, entryThreshold);
    var next = createAllyTrack(config, track || {});
    var e = finite(escalationValue, next.lastEscalation);
    var transition = null;
    var decision = null;
    var attemptedType = null;

    if (!next.active) {
      if (e <= entryResetThreshold) next.entryArmed = true;
      if (next.entryArmed && e >= entryThreshold) {
        attemptedType = 'entry';
        next.entryArmed = false;
        next.entryAttempts += 1;
        decision = probabilisticDecision(config.entryProbability == null ? 1 : config.entryProbability,
          rollSource, 'entry');
        if (decision.passed) {
          next.active = true;
          next.exitArmed = true;
          transition = {
            actor: config.id || meta.actor || 'ally',
            type: 'entry',
            turn: meta.turn == null ? null : meta.turn,
            activateGroups: uniqueSorted(config.activateGroups),
            deactivateGroups: uniqueSorted(config.deactivateOnEntry)
          };
        }
      }
    } else {
      if (e >= exitResetThreshold) next.exitArmed = true;
      if (next.exitArmed && e <= exitThreshold) {
        attemptedType = 'exit';
        next.exitArmed = false;
        next.exitAttempts += 1;
        decision = probabilisticDecision(config.exitProbability == null ? 1 : config.exitProbability,
          rollSource, 'exit');
        if (decision.passed) {
          next.active = false;
          next.entryArmed = true;
          transition = {
            actor: config.id || meta.actor || 'ally',
            type: 'exit',
            turn: meta.turn == null ? null : meta.turn,
            activateGroups: uniqueSorted(config.activateOnExit),
            deactivateGroups: uniqueSorted(config.deactivateGroups || config.activateGroups)
          };
        }
      }
    }

    next.lastEscalation = e;
    if (decision) next.lastDecision = {
      type: attemptedType,
      passed: decision.passed,
      probability: decision.probability,
      roll: decision.roll,
      turn: meta.turn == null ? null : meta.turn
    };
    return {
      track: next,
      transition: transition,
      attempted: !!decision,
      drawConsumed: !!(decision && decision.drawConsumed),
      decision: decision
    };
  }

  function applyActivationTransition(current, transition) {
    current = current || {};
    var groups = merge({}, current.groups || current);
    var history = Array.isArray(current.history) ? current.history.slice() : [];
    var changed = [];
    if (transition) {
      uniqueSorted(transition.deactivateGroups).forEach(function (group) {
        if (groups[group] !== false) changed.push({ group: group, active: false });
        groups[group] = false;
      });
      uniqueSorted(transition.activateGroups).forEach(function (group) {
        if (groups[group] !== true) changed.push({ group: group, active: true });
        groups[group] = true;
      });
      if (changed.length) {
        history.push({
          actor: transition.actor || null,
          type: transition.type || 'activation',
          turn: transition.turn == null ? null : transition.turn,
          changed: changed.map(function (row) { return { group: row.group, active: row.active }; })
        });
      }
    }
    return { state: { groups: groups, history: history }, changed: changed };
  }

  function requireSignalSpec(spec, kind) {
    spec = spec || {};
    if (!spec.side) throw new Error(kind + ' requires side.');
    if (!spec.axis) throw new Error(kind + ' requires axis.');
    if (!spec.targetClass) throw new Error(kind + ' requires targetClass.');
    return spec;
  }

  function signalId(kind, spec) {
    return String(spec.id || [kind, spec.side, spec.turn == null ? 'turn' : spec.turn, spec.axis, spec.targetClass].join(':'));
  }

  function createFeintOrder(spec, config) {
    spec = requireSignalSpec(spec, 'feint');
    var cfg = signalConfig(config);
    return {
      id: signalId('feint', spec),
      side: String(spec.side),
      kind: 'feint',
      cost: finite(cfg.costs.feint, 1),
      apCost: finite(cfg.costs.feint, 1),
      boardEffect: cfg.boardEffect,
      axis: String(spec.axis),
      targetClass: String(spec.targetClass),
      methodKey: spec.methodKey || null,
      turn: spec.turn == null ? null : spec.turn,
      signalKind: 'feint'
    };
  }

  function createDecoySignal(spec, config) {
    spec = requireSignalSpec(spec, 'decoy');
    var cfg = signalConfig(config);
    return {
      id: signalId('decoy', spec),
      side: String(spec.side),
      kind: 'decoy',
      cost: finite(cfg.costs.decoy, 0),
      apCost: finite(cfg.costs.decoy, 0),
      boardEffect: cfg.boardEffect,
      axis: String(spec.axis),
      targetClass: String(spec.targetClass),
      methodKey: spec.methodKey || null,
      turn: spec.turn == null ? null : spec.turn,
      signalKind: 'decoy',
      quotaKey: 'decoy-per-turn'
    };
  }

  function signalCost(signal, config) {
    if (!signal) return null;
    var cfg = signalConfig(config);
    if (signal.kind === 'feint') return finite(cfg.costs.feint, 1);
    if (signal.kind === 'decoy') return finite(cfg.costs.decoy, 0);
    return null;
  }

  function hasBoardEffect(signal) {
    return !!(signal && signal.kind !== 'feint' && signal.kind !== 'decoy' && signal.boardEffect !== 'none');
  }

  function resolveSignalLeak(signal, config, rollSource) {
    if (!signal) throw new Error('Signal is required.');
    var cfg = signalConfig(config);
    var kind = signal.signalKind || signal.kind;
    var configured = cfg.leakProbabilityByKind && cfg.leakProbabilityByKind[kind];
    var probability = signal.leakProbability == null ? finite(configured, 0) : signal.leakProbability;
    var decision = probabilisticDecision(probability, rollSource, 'leak:' + kind);
    var resolved = merge({}, signal);
    resolved.leak = {
      probability: decision.probability,
      roll: decision.roll,
      caught: decision.passed,
      drawConsumed: decision.drawConsumed
    };
    resolved.assessedDeceptive = decision.passed;
    resolved.deceptionObservation = decision.passed ? {
      assessment: 'assessed-deceptive',
      signalKind: kind,
      axis: signal.axis || null,
      targetClass: signal.targetClass || null,
      sourceSignalId: signal.id || null
    } : null;
    return resolved;
  }

  function orderTarget(order, nodesById) {
    if (order.target) return order.target;
    return nodesById && order.targetId != null ? (nodesById[order.targetId] || {}) : {};
  }

  function signalKind(order) {
    return order.signalKind || (order.kind === 'feint' ? 'feint' : order.kind === 'decoy' ? 'decoy' : 'genuine');
  }

  function indicatorCandidates(orders, nodesById, config) {
    var candidates = [];
    (orders || []).slice().sort(function (a, b) {
      return String(a.id || a.orderId || a.targetId || '').localeCompare(String(b.id || b.orderId || b.targetId || ''));
    }).forEach(function (order, index) {
      order = order || {};
      var target = orderTarget(order, nodesById);
      var tags = target.indicatorTags || {};
      var axis = order.axis || tags.axis || target.axis || target.geographyClass || null;
      var targetClass = order.targetClass || tags.targetClass || target.targetClass || target.type || target.subsystem || null;
      var method = order.methodKey || order.method || null;
      var kind = signalKind(order);
      var sourceId = String(order.id || order.orderId || ('order-' + index));
      var caught = !!(order.assessedDeceptive || (order.leak && order.leak.caught));
      var weight = Math.max(0, finite(config.signalWeights[kind], 1));
      function add(facet) {
        candidates.push({
          key: [sourceId, facet, axis || '', targetClass || '', method || ''].join('|'),
          sourceOrderId: sourceId,
          orderKind: order.kind || null,
          signalKind: kind,
          assessedDeceptive: caught,
          axis: axis,
          targetClass: targetClass,
          methodKey: method,
          facet: facet,
          weight: weight
        });
      }
      if (axis) add('axis');
      if (method) add('method');
      if (targetClass) add(order.kind === 'harden' || order.kind === 'repair' ? 'defense' : 'target');
      if (!axis && !method && !targetClass) add('summary');
    });
    return candidates.sort(function (a, b) { return a.key.localeCompare(b.key); });
  }

  function replaceTokens(template, candidate) {
    return String(template)
      .replace(/\{axis\}/g, String(candidate.axis || 'unresolved'))
      .replace(/\{method\}/g, String(candidate.methodKey || candidate.orderKind || 'multi-domain'))
      .replace(/\{targetClass\}/g, String(candidate.targetClass || 'key systems'));
  }

  function indicatorRollReader(source) {
    if (source == null) return function () { return 0; };
    return function (tag) { return readRoll(source, tag); };
  }

  function weightedTake(available, roll) {
    var total = available.reduce(function (sum, row) { return sum + Math.max(0, row.weight); }, 0);
    if (total <= 0) return 0;
    var cursor = roll * total;
    for (var i = 0; i < available.length; i++) {
      cursor -= Math.max(0, available[i].weight);
      if (cursor < 0) return i;
    }
    return available.length - 1;
  }

  /**
   * Generate 2–4 structured indicator lines from committed orders. Feints and decoys
   * receive configurable sampling weight but are indistinguishable from genuine activity
   * unless `resolveSignalLeak` marked them assessed deceptive.
   */
  function generateIndicators(committedOrders, options) {
    options = options || {};
    var cfg = indicatorConfig(options.config || options);
    var nextRoll = indicatorRollReader(options.rng || options.rollSource);
    var minLines = clamp(Math.round(finite(cfg.minLines, 2)), 2, 4);
    var maxLines = clamp(Math.round(finite(cfg.maxLines, 4)), minLines, 4);
    var count = options.count == null
      ? minLines + Math.floor(nextRoll('indicator-count') * (maxLines - minLines + 1))
      : clamp(Math.round(finite(options.count, minLines)), minLines, maxLines);
    var available = indicatorCandidates(committedOrders, options.nodesById || {}, cfg);
    if (!available.length) {
      available = [0, 1].map(function (index) {
        return { key: 'absence|' + index, sourceOrderId: null, orderKind: null, signalKind: 'genuine',
          assessedDeceptive: false, axis: null, targetClass: null, methodKey: null,
          facet: 'absence', weight: 1 };
      });
    }
    if (available.length < count) {
      var summaryNeeded = count - available.length;
      for (var s = 0; s < summaryNeeded; s++) {
        available.push({ key: 'summary|' + s, sourceOrderId: null, orderKind: null, signalKind: 'genuine',
          assessedDeceptive: false, axis: null, targetClass: null, methodKey: null,
          facet: 'summary', weight: 0.5 });
      }
    }

    var selected = [];
    while (selected.length < count && available.length) {
      var pickIndex = weightedTake(available, nextRoll('indicator-pick-' + selected.length));
      selected.push(available.splice(pickIndex, 1)[0]);
    }
    return selected.map(function (candidate, index) {
      var templates = cfg.templates[candidate.facet];
      if (!Array.isArray(templates) || !templates.length) templates = DEFAULT_CONFIG.indicators.templates[candidate.facet];
      if (!Array.isArray(templates) || !templates.length) templates = DEFAULT_CONFIG.indicators.templates.summary;
      var templateIndex = Math.min(templates.length - 1,
        Math.floor(nextRoll('indicator-template-' + index) * templates.length));
      var text = replaceTokens(templates[templateIndex], candidate);
      if (candidate.assessedDeceptive) text += ' Assessed deceptive.';
      return {
        id: ['indicator', index + 1, candidate.sourceOrderId || 'none', candidate.facet].join(':'),
        text: text,
        sourceOrderId: candidate.sourceOrderId,
        orderKind: candidate.orderKind,
        signalKind: candidate.signalKind,
        assessedDeceptive: candidate.assessedDeceptive,
        axis: candidate.axis,
        targetClass: candidate.targetClass,
        methodKey: candidate.methodKey,
        facet: candidate.facet
      };
    });
  }

  function createStrategicState(config) {
    config = config || {};
    var cfg = escalationConfig(config);
    return {
      version: VERSION,
      classification: CLASSIFICATION,
      escalation: { value: clamp(finite(cfg.initial, 0), finite(cfg.min, 0), finite(cfg.max, 10)), history: [] },
      allies: merge({}, config.allies || {}),
      activation: { groups: merge({}, config.activationGroups || {}), history: [] },
      roe: config.roe || null,
      indicators: { current: [], history: [] }
    };
  }

  return {
    CLASSIFICATION: CLASSIFICATION,
    VERSION: VERSION,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    clamp: clamp,
    createStrategicState: createStrategicState,
    updateEscalation: updateEscalation,
    authorizeOrder: authorizeOrder,
    createAllyTrack: createAllyTrack,
    advanceAllyTrack: advanceAllyTrack,
    applyActivationTransition: applyActivationTransition,
    createFeintOrder: createFeintOrder,
    createDecoySignal: createDecoySignal,
    signalCost: signalCost,
    hasBoardEffect: hasBoardEffect,
    resolveSignalLeak: resolveSignalLeak,
    generateIndicators: generateIndicators,
    _internal: {
      targetTokens: targetTokens,
      escalationImpulse: escalationImpulse,
      diminishDimension: diminishDimension,
      ruleApplies: ruleApplies,
      readRoll: readRoll,
      indicatorCandidates: indicatorCandidates
    }
  };
});
