/*
 * counterfactual.js — matched-pair and ensemble machinery for the AAR Colosseum.
 *
 * UNCLASSIFIED // NOTIONAL RESEARCH TOOL
 *
 * This module owns no combat or victory math. Every turn is adjudicated by
 * GameModule._internal.resolveTurn(), and every operational outcome advances through
 * GameModule._internal.advanceDenialState(). The worker supplies scheduling only.
 */
window.CounterfactualModule = (function () {
  'use strict';

  var CLASSIFICATION = 'UNCLASSIFIED // NOTIONAL RESEARCH TOOL';

  function engine() {
    if (!window.GameModule || !window.GameModule._internal) throw new Error('GameModule internals unavailable');
    return window.GameModule._internal;
  }

  function copy(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function clamp(value, lo, hi) { return Math.min(hi, Math.max(lo, Number(value) || 0)); }

  function logistics() { return window.LogisticsModule || null; }

  function freshBoard(graph, record) {
    var board = engine().buildBoard(graph || { nodes: [], links: [] });
    Object.keys(board.nodes).forEach(function (id) {
      board.nodes[id].health = board.nodes[id].healthMax || 100;
      board.nodes[id].alive = true;
    });
    var L = logistics();
    if (L) board.logistics = L.restore(record && record.logisticsInitial, board,
      record && record.cfg && record.cfg.logistics || {});
    return board;
  }

  function prepareLogistics(branch, row) {
    var L = logistics(), model = branch && branch.board && branch.board.logistics;
    if (!L || !model) return;
    ['blue', 'red'].forEach(function (side) {
      var recorded = row && row.logistics && row.logistics.decisions && row.logistics.decisions[side];
      var fallback = row && row.report && row.report.logistics && row.report.logistics.sides &&
        row.report.logistics.sides[side] && row.report.logistics.sides[side].decision;
      L.setDecision(model, side, recorded || fallback || L.chooseDecision(model, side));
    });
  }

  function cloneOrders(orders) {
    return (orders || []).map(function (order) { return Object.assign({}, order); });
  }

  function historyByTurn(record) {
    var out = {};
    (record && record.history || []).forEach(function (row) { out[Number(row.turn)] = row; });
    return out;
  }

  function beliefForTurn(record, turn) {
    var mind = window.RedMindModule;
    var prior = record && record.redMind && record.redMind.prior || mind.PRIOR;
    var chosen = prior, bestTurn = -1;
    (record && record.redMind && record.redMind.trajectory || []).forEach(function (row) {
      var rowTurn = Number(row.turn || 0);
      // A WATCH posterior becomes available for the following PLAN, never retroactively.
      if (rowTurn < Number(turn) && rowTurn >= bestTurn && row.belief) {
        chosen = row.belief;
        bestTurn = rowTurn;
      }
    });
    return mind.normalizeBelief(chosen);
  }

  function validateEdit(record, graph, edit) {
    if (!record || !Array.isArray(record.history)) return { ok: false, reason: 'missing-record' };
    edit = edit || {};
    var turn = Math.round(Number(edit.turn));
    var row = record.history.filter(function (item) { return Number(item.turn) === turn; })[0];
    if (!row) return { ok: false, reason: 'turn-not-recorded' };
    var original = row.orders && row.orders.blue || [];
    var index = Math.round(Number(edit.orderIndex));
    if (index < 0 || index >= original.length) return { ok: false, reason: 'order-not-found' };
    if (edit.replacement == null) return { ok: true, turn: turn, orderIndex: index, replacement: null };

    var replacement = Object.assign({}, edit.replacement, { side: 'blue' });
    if (['strike', 'harden', 'repair'].indexOf(replacement.kind) < 0) return { ok: false, reason: 'bad-kind' };
    var board = freshBoard(graph, record);
    var target = board.nodes[replacement.targetId];
    if (!target) return { ok: false, reason: 'no-target' };
    if (replacement.kind === 'strike') {
      if (target.team !== 'red') return { ok: false, reason: 'strike-needs-red-target' };
      if (['kinetic', 'cyber', 'ew', 'sof'].indexOf(replacement.methodKey) < 0) return { ok: false, reason: 'bad-method' };
      var available = engine().canStrikeBoard(board, 'blue', target.id, replacement.methodKey, replacement.sourceId);
      if (!available.ok) return { ok: false, reason: available.reason };
      replacement.sourceId = replacement.sourceId || available.sourceId;
    } else {
      if (target.team !== 'blue') return { ok: false, reason: 'defense-needs-blue-target' };
      delete replacement.methodKey;
      delete replacement.sourceId;
    }
    return { ok: true, turn: turn, orderIndex: index, replacement: replacement };
  }

  function applyEdit(orders, edit, turn) {
    var out = cloneOrders(orders);
    if (!edit || Number(edit.turn) !== Number(turn)) return out;
    if (edit.replacement == null) out.splice(edit.orderIndex, 1);
    else out.splice(edit.orderIndex, 1, Object.assign({}, edit.replacement, { side: 'blue' }));
    return out;
  }

  function apFor(board, side, cfg, record) {
    var I = engine();
    if (typeof I.apForBoard === 'function') return I.apForBoard(board, side, record || { cfg: cfg });
    return Math.max(1, Number(side === 'blue' ? cfg.apBlue : cfg.apRed) || (side === 'blue' ? 4 : 5));
  }

  function summarizeBranch(branch, turn) {
    var assessment = branch.lastAssessment || {};
    return {
      outcome: branch.outcome || 'open',
      halt: branch.outcome === 'blue',
      lodgmentComplete: branch.outcome === 'red',
      decidedTurn: branch.decidedTurn || null,
      horizonTurn: turn,
      lodgment: Math.round(branch.lodgment * 10000) / 10000,
      throughput: assessment.throughput == null ? null : Math.round(Number(assessment.throughput) * 10000) / 10000,
      osvi: assessment.osviRed == null ? null : Math.round(Number(assessment.osviRed) * 10000) / 10000
    };
  }

  function advanceBranch(branch, orders, cfg, rng, turn) {
    if (branch.outcome) return;
    engine().resolveTurn(branch.board, orders, cfg, rng);
    var advanced = engine().advanceDenialState(branch.board, branch.lodgment, {
      requiredTurns: cfg.lodgmentRequiredTurns || 4
    });
    branch.lodgment = advanced.lodgment;
    branch.lastAssessment = advanced.assessment;
    if (advanced.outcome) {
      branch.outcome = advanced.outcome;
      branch.decidedTurn = turn;
    }
  }

  function plannedOrders(record, board, side, turn, trial, branchTag) {
    var I = engine(), mind = window.RedMindModule, cfg = record.cfg || {};
    var policy;
    if (side === 'red') {
      var belief = beliefForTurn(record, turn);
      var doctrineId = mind.drawDoctrine(belief,
        I.makeRng(I.hashSeed(record.seed, 'counterfactual-doctrine', trial, turn)));
      policy = mind.doctrine(doctrineId);
    } else policy = mind.BALANCED;
    return I.planOrders(board, side, apFor(board, side, cfg, record), policy,
      I.makeRng(I.hashSeed(record.seed, 'counterfactual-plan', trial, turn, side, branchTag)));
  }

  /*
   * CO-005 A7 — the exploit probe: "same worlds, Red plays a best response to your
   * habits." Both branches replay the player's RECORDED Blue orders against shared
   * combat seeds; the original branch replays recorded Red, the exploit branch
   * replans Red each turn with the player-model-tilted policy. The halt-rate delta,
   * with its Wilson band, is the predictability meter — an uncertainty-banded answer
   * to "how much did your habits cost you?".
   */
  function runExploitPair(payload, trial) {
    var I = engine(), mind = window.RedMindModule, record = payload.record, cfg = record.cfg || {};
    var model = mind.normalizePlayerModel(payload.playerModel);
    var original = { board: freshBoard(payload.graph, record), lodgment: 0, outcome: null, decidedTurn: null, lastAssessment: null };
    var exploit = { board: freshBoard(payload.graph, record), lodgment: 0, outcome: null, decidedTurn: null, lastAssessment: null };
    var rows = historyByTurn(record), maxTurn = Math.max(1, Number(cfg.turnLimit || record.history.length || 1));

    for (var turn = 1; turn <= maxTurn; turn++) {
      var row = rows[turn];
      prepareLogistics(original, row);
      prepareLogistics(exploit, row);
      var blueOrders = row
        ? cloneOrders(row.orders && row.orders.blue)
        : plannedOrders(record, original.board, 'blue', turn, trial, 'exploit-blue');
      var originalRed = row
        ? cloneOrders(row.orders && row.orders.red)
        : plannedOrders(record, original.board, 'red', turn, trial, 'exploit-baseline');
      var belief = beliefForTurn(record, turn);
      var doctrineId = mind.drawDoctrine(belief,
        I.makeRng(I.hashSeed(record.seed, 'exploit-doctrine', trial, turn)));
      var exploitPolicy = mind.exploitPolicy(mind.doctrine(doctrineId), model);
      var exploitRed = I.planOrders(exploit.board, 'red', apFor(exploit.board, 'red', cfg, record), exploitPolicy,
        I.makeRng(I.hashSeed(record.seed, 'exploit-plan', trial, turn)));
      var seed = I.hashSeed(record.seed, 'exploit-resolve', trial, turn);
      advanceBranch(original, blueOrders.concat(originalRed), cfg, I.makeRng(seed), turn);
      advanceBranch(exploit, cloneOrders(blueOrders).concat(exploitRed), cfg, I.makeRng(seed), turn);
      if (original.outcome && exploit.outcome) break;
    }
    return {
      original: summarizeBranch(original, maxTurn),
      counterfactual: summarizeBranch(exploit, maxTurn)
    };
  }

  /*
   * mode='matched' replays every recorded order and the live resolver seed. The original
   * branch therefore reproduces the operation byte-for-byte through the selected turn.
   * mode='ensemble' samples Red types from the belief available at that PLAN and varies
   * combat draws across trials. Original and edited branches share each trial/turn seed.
   */
  function runPair(payload, trial, mode) {
    payload = payload || {};
    var I = engine(), record = payload.record, cfg = record.cfg || {};
    var checked = validateEdit(record, payload.graph, payload.edit);
    if (!checked.ok) throw new Error('Invalid counterfactual edit: ' + checked.reason);
    var original = { board: freshBoard(payload.graph, record), lodgment: 0, outcome: null, decidedTurn: null, lastAssessment: null };
    var alternate = { board: freshBoard(payload.graph, record), lodgment: 0, outcome: null, decidedTurn: null, lastAssessment: null };
    var rows = historyByTurn(record), maxTurn = Math.max(1, Number(cfg.turnLimit || record.history.length || 1));

    for (var turn = 1; turn <= maxTurn; turn++) {
      var row = rows[turn];
      prepareLogistics(original, row);
      prepareLogistics(alternate, row);
      var originalBlue, alternateBlue, originalRed, alternateRed;
      if (row) {
        originalBlue = cloneOrders(row.orders && row.orders.blue);
        alternateBlue = applyEdit(originalBlue, checked, turn);
      } else {
        originalBlue = plannedOrders(record, original.board, 'blue', turn, trial, 'original');
        alternateBlue = plannedOrders(record, alternate.board, 'blue', turn, trial, 'alternate');
      }
      if (mode === 'matched' && row) {
        originalRed = cloneOrders(row.orders && row.orders.red);
        alternateRed = cloneOrders(row.orders && row.orders.red);
      } else {
        originalRed = plannedOrders(record, original.board, 'red', turn, trial, 'original');
        alternateRed = plannedOrders(record, alternate.board, 'red', turn, trial, 'alternate');
      }
      var seed = mode === 'matched'
        ? I.hashSeed(record.seed, 'resolve', turn)
        : I.hashSeed(record.seed, 'counterfactual-resolve', trial, turn);
      advanceBranch(original, originalBlue.concat(originalRed), cfg, I.makeRng(seed), turn);
      advanceBranch(alternate, alternateBlue.concat(alternateRed), cfg, I.makeRng(seed), turn);
      if (original.outcome && alternate.outcome) break;
    }
    return {
      original: summarizeBranch(original, maxTurn),
      counterfactual: summarizeBranch(alternate, maxTurn)
    };
  }

  function wilson(hits, n) {
    if (!n) return { lo: 0, hi: 1 };
    var z = 1.6448536269514722, p = hits / n, den = 1 + z * z / n;
    var center = (p + z * z / (2 * n)) / den;
    var spread = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / den;
    return { lo: clamp(center - spread, 0, 1), hi: clamp(center + spread, 0, 1) };
  }

  function newAggregate(requested) {
    return { requested: requested, completed: 0, originalHalt: 0, counterfactualHalt: 0, improved: 0, harmed: 0, unchanged: 0 };
  }

  function addPair(aggregate, pair) {
    var original = pair.original.halt ? 1 : 0;
    var counterfactual = pair.counterfactual.halt ? 1 : 0;
    aggregate.completed++;
    aggregate.originalHalt += original;
    aggregate.counterfactualHalt += counterfactual;
    if (counterfactual > original) aggregate.improved++;
    else if (counterfactual < original) aggregate.harmed++;
    else aggregate.unchanged++;
    return aggregate;
  }

  function summarize(aggregate, matched, authoredForecast) {
    var n = aggregate.completed || 1;
    var qOriginal = aggregate.originalHalt / n;
    var qCounterfactual = aggregate.counterfactualHalt / n;
    var interval = wilson(aggregate.counterfactualHalt, n);
    var decisionMean = (aggregate.improved - aggregate.harmed) / n;
    var decisionVariance = Math.max(0, (aggregate.improved + aggregate.harmed) / n - decisionMean * decisionMean);
    var decisionHalfWidth = 1.6448536269514722 * Math.sqrt(decisionVariance / n);
    var authored = clamp(authoredForecast, 0, 1);
    var score = Math.pow(authored - qCounterfactual, 2);
    var scoreLo = authored >= interval.lo && authored <= interval.hi
      ? 0 : Math.min(Math.pow(authored - interval.lo, 2), Math.pow(authored - interval.hi, 2));
    var scoreHi = Math.max(Math.pow(authored - interval.lo, 2), Math.pow(authored - interval.hi, 2));
    return {
      classification: CLASSIFICATION,
      matched: matched,
      ensemble: {
        K: aggregate.completed,
        predicate: 'Blue achieves a throughput halt before decisive lodgment and the hard operation horizon',
        original: { hits: aggregate.originalHalt, q: qOriginal, interval: wilson(aggregate.originalHalt, n) },
        counterfactual: { hits: aggregate.counterfactualHalt, q: qCounterfactual, interval: interval },
        decisionValue: {
          mean: decisionMean,
          interval: { lo: clamp(decisionMean - decisionHalfWidth, -1, 1), hi: clamp(decisionMean + decisionHalfWidth, -1, 1) },
          improvedWorlds: aggregate.improved,
          harmedWorlds: aggregate.harmed,
          unchangedWorlds: aggregate.unchanged
        }
      },
      authoredForecast: authored,
      score: score,
      scoreInterval: { lo: scoreLo, hi: scoreHi }
    };
  }

  return Object.freeze({
    CLASSIFICATION: CLASSIFICATION,
    freshBoard: freshBoard,
    beliefForTurn: beliefForTurn,
    validateEdit: validateEdit,
    applyEdit: applyEdit,
    runPair: runPair,
    runExploitPair: runExploitPair,
    newAggregate: newAggregate,
    addPair: addPair,
    summarize: summarize,
    wilson: wilson
  });
})();
