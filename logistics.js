/*
 * logistics.js — deterministic contested-logistics adapter for StrikeSim.
 *
 * UNCLASSIFIED // NOTIONAL RESEARCH TOOL
 *
 * The force graph remains the source of truth. This module adapts its command,
 * relay, logistics, port, airfield, distribution, and repair nodes into a small
 * operational model with four typed stocks, route/hub health, DDIL friction,
 * prepositioned reserves, allocation decisions, rerouting, and repair capacity.
 * It owns no combat RNG: identical board state + orders always produce identical
 * logistics effects, which keeps replays, ghost worlds, and counterfactuals honest.
 */
window.LogisticsModule = (function () {
  'use strict';

  var CLASSIFICATION = 'UNCLASSIFIED // NOTIONAL RESEARCH TOOL';
  var RESOURCES = ['fuel', 'ammunition', 'maintenance', 'personnel'];
  var ALLOCATION_KEYS = ['operations', 'repair', 'routing', 'prepositioning', 'resilience'];
  var MODES = ['sea', 'air', 'land', 'digital'];

  var PRESETS = Object.freeze({
    balanced: {
      id: 'balanced', label: 'Balanced sustainment', short: 'BAL',
      note: 'Keep combat demand, repair, routes, reserves, and mission command in balance.',
      allocation: { operations: 35, repair: 20, routing: 20, prepositioning: 15, resilience: 10 }
    },
    surge: {
      id: 'surge', label: 'Surge combat power', short: 'SURGE',
      note: 'Prioritize fuel and ammunition at the cost of recovery and route work.',
      allocation: { operations: 55, repair: 10, routing: 10, prepositioning: 10, resilience: 15 }
    },
    repair: {
      id: 'repair', label: 'Repair the force', short: 'REPAIR',
      note: 'Concentrate maintenance and personnel on recovery and rapid infrastructure repair.',
      allocation: { operations: 25, repair: 45, routing: 10, prepositioning: 10, resilience: 10 }
    },
    reroute: {
      id: 'reroute', label: 'Reroute distribution', short: 'REROUTE',
      note: 'Shift lift and distribution around disrupted ports, airfields, and corridors.',
      allocation: { operations: 25, repair: 15, routing: 45, prepositioning: 5, resilience: 10 }
    },
    preposition: {
      id: 'preposition', label: 'Build forward stocks', short: 'PREPO',
      note: 'Trade current throughput for distributed, prepositioned reserves.',
      allocation: { operations: 25, repair: 10, routing: 10, prepositioning: 45, resilience: 10 }
    },
    ddil: {
      id: 'ddil', label: 'Operate through DDIL', short: 'DDIL',
      note: 'Prioritize redundant data paths, local authority, and disconnected execution.',
      allocation: { operations: 25, repair: 10, routing: 10, prepositioning: 10, resilience: 45 }
    }
  });

  var COSTS = Object.freeze({
    'strike:kinetic': { fuel: 3, ammunition: 4, maintenance: 1.5, personnel: 1 },
    'strike:cyber':   { fuel: 0, ammunition: 0, maintenance: 1, personnel: 3 },
    'strike:ew':      { fuel: 1, ammunition: 1, maintenance: 2, personnel: 2 },
    'strike:sof':     { fuel: 2, ammunition: 2, maintenance: 1, personnel: 3 },
    harden:           { fuel: 0, ammunition: 0, maintenance: 4, personnel: 2 },
    repair:           { fuel: 1, ammunition: 0, maintenance: 6, personnel: 4 },
    feint:            { fuel: 2, ammunition: 2, maintenance: 1, personnel: 1 },
    decoy:            { fuel: 0, ammunition: 0, maintenance: 0, personnel: 1 }
  });

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, Number(v) || 0)); }
  function round1(v) { return Math.round((Number(v) || 0) * 10) / 10; }
  function copy(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function zeroResources() { return { fuel: 0, ammunition: 0, maintenance: 0, personnel: 0 }; }
  function fullStocks() { return { fuel: 100, ammunition: 100, maintenance: 100, personnel: 100 }; }
  function text(node) {
    return [node && node.id, node && node.name, node && node.type, node && node.subsystem,
      node && node.jointFunction, node && node.operationalRole].join(' ').toLowerCase();
  }
  function healthFrac(node) {
    if (!node || !node.alive || node.active === false) return 0;
    return clamp(Number(node.health || 0) / Number(node.healthMax || 100), 0, 1);
  }
  function authoredProfile(node) {
    return node && node.logisticsProfile && typeof node.logisticsProfile === 'object'
      ? node.logisticsProfile : {};
  }
  function isLogisticsNode(node) {
    var p = authoredProfile(node), s = text(node);
    return p.role != null || node && node.tempoRole === 'logistics' ||
      /logist|sustain|supply|distribution|depot|sealift|airlift|fuel|ammun|repair|preposition|transport/.test(s);
  }
  function hubKind(node) {
    var p = authoredProfile(node), s = text(node);
    if (p.hubKind === 'port' || p.hubKind === 'airfield') return p.hubKind;
    if (/port|sealift|naval logistics|watercraft|shore distribution|fleet replenishment/.test(s)) return 'port';
    if (/airfield|airbase|airlift|air mobility|tanker bridge/.test(s)) return 'airfield';
    return null;
  }
  function nodeModes(node) {
    var p = authoredProfile(node);
    if (Array.isArray(p.modes) && p.modes.length) {
      return p.modes.map(function (m) { return String(m).toLowerCase(); }).filter(function (m) { return MODES.indexOf(m) >= 0; });
    }
    var s = text(node), out = [];
    function add(m) { if (out.indexOf(m) < 0) out.push(m); }
    if (/port|sea|sealift|naval|watercraft|fleet|shore|littoral/.test(s)) add('sea');
    if (/air|airfield|airbase|tanker|aviation/.test(s)) add('air');
    if (/land|ground|distribution|depot|mobility|rail|road|truck|repair/.test(s)) add('land');
    if (/common operating picture|allocation|network|command|relay|satcom|cyber|cloud|data/.test(s)) add('digital');
    if (!out.length && isLogisticsNode(node)) add('land');
    return out;
  }
  function routeLabel(side, mode) {
    var labels = { sea: 'Maritime sustainment route', air: 'Air bridge', land: 'Distributed land corridor', digital: 'Logistics C2 / data path' };
    return (side === 'blue' ? 'Blue ' : 'Red ') + labels[mode];
  }
  function routeStatus(disruption) {
    return disruption >= 0.72 ? 'closed' : disruption >= 0.34 ? 'degraded' : 'open';
  }

  function normalizeAllocation(input) {
    input = input || PRESETS.balanced.allocation;
    var out = {}, total = 0;
    ALLOCATION_KEYS.forEach(function (k) { out[k] = Math.max(0, Number(input[k]) || 0); total += out[k]; });
    if (total <= 0) return copy(PRESETS.balanced.allocation);
    var used = 0;
    ALLOCATION_KEYS.forEach(function (k, i) {
      out[k] = i === ALLOCATION_KEYS.length - 1 ? 100 - used : Math.round(out[k] / total * 100);
      used += out[k];
    });
    return out;
  }
  function normalizeDecision(input) {
    var p = typeof input === 'string' ? PRESETS[input] : input;
    if (p && p.id && PRESETS[p.id]) p = PRESETS[p.id];
    if (!p) p = PRESETS.balanced;
    return { id: p.id || 'custom', label: p.label || 'Custom allocation', short: p.short || 'CUSTOM',
      note: p.note || '', allocation: normalizeAllocation(p.allocation) };
  }

  function topologyForSide(board, side, prior) {
    var ids = (board.rosters && board.rosters[side] || []).slice().sort();
    var modesById = {}, logisticsIds = [];
    ids.forEach(function (id) {
      var node = board.nodes[id], modes = nodeModes(node);
      modesById[id] = modes;
      if (isLogisticsNode(node)) logisticsIds.push(id);
    });
    var commandIds = ids.filter(function (id) {
      var n = board.nodes[id];
      return n && (n.tempoRole === 'command' || n.tempoRole === 'relay' || modesById[id].indexOf('digital') >= 0);
    });
    var digitalIds = commandIds.filter(function (id) { return modesById[id].indexOf('digital') >= 0; });
    var hubs = logisticsIds.map(function (id) {
      var n = board.nodes[id], kind = hubKind(n);
      if (!kind) return null;
      var old = prior && prior.hubs && prior.hubs.filter(function (h) { return h.id === id; })[0];
      return { id: id, name: n.name, kind: kind, disruption: old ? old.disruption : 0,
        status: old ? old.status : 'open' };
    }).filter(Boolean);
    var routes = MODES.map(function (mode) {
      var nodeIds = ids.filter(function (id) {
        return (logisticsIds.indexOf(id) >= 0 || mode === 'digital') && modesById[id].indexOf(mode) >= 0;
      });
      if (!nodeIds.length) return null;
      var rid = side + '-' + mode;
      var old = prior && prior.routes && prior.routes.filter(function (r) { return r.id === rid; })[0];
      return {
        id: rid, label: routeLabel(side, mode), mode: mode, nodeIds: nodeIds,
        hubIds: hubs.filter(function (h) { return h.kind === (mode === 'air' ? 'airfield' : mode === 'sea' ? 'port' : ''); }).map(function (h) { return h.id; }),
        baseCapacity: Math.max(1, nodeIds.length), disruption: old ? old.disruption : 0,
        effectiveCapacity: old ? old.effectiveCapacity : 1, status: old ? old.status : 'open',
        rerouted: old ? !!old.rerouted : false, repairProgress: old ? Number(old.repairProgress || 0) : 0
      };
    }).filter(Boolean);
    return { logisticsIds: logisticsIds, commandIds: commandIds, digitalIds: digitalIds, hubs: hubs, routes: routes };
  }

  function initialSide(board, side, opts) {
    opts = opts || {};
    var topo = topologyForSide(board, side, null);
    var stocks = fullStocks();
    if (opts.stocks && opts.stocks[side]) RESOURCES.forEach(function (k) { stocks[k] = clamp(opts.stocks[side][k], 0, 100); });
    var prepositioning = opts.prepositioning && opts.prepositioning[side] != null
      ? clamp(opts.prepositioning[side], 0, 100) : 60;
    var decision = normalizeDecision(opts.decisions && opts.decisions[side]);
    return {
      stocks: stocks, initialStocks: copy(stocks), prepositioning: prepositioning,
      initialPrepositioning: prepositioning, decision: decision,
      ddil: 0, flow: 1, readiness: 1, shortages: [],
      logisticsIds: topo.logisticsIds, commandIds: topo.commandIds, digitalIds: topo.digitalIds,
      hubs: topo.hubs, routes: topo.routes,
      totals: { consumed: zeroResources(), replenished: zeroResources(), shortages: 0,
        reroutes: 0, routeRepairs: 0, nodeRepairs: 0, prepositioned: 0 }
    };
  }

  function create(board, opts) {
    opts = opts || {};
    var model = {
      v: 1, classification: CLASSIFICATION, turn: 0,
      sides: { blue: initialSide(board, 'blue', opts), red: initialSide(board, 'red', opts) },
      history: []
    };
    refresh(model, board);
    model.initial = { blue: copy(model.sides.blue), red: copy(model.sides.red) };
    return model;
  }

  function refresh(model, board) {
    if (!model || !model.sides || !board) return model;
    ['blue', 'red'].forEach(function (side) {
      var st = model.sides[side], topo = topologyForSide(board, side, st);
      st.logisticsIds = topo.logisticsIds; st.commandIds = topo.commandIds; st.digitalIds = topo.digitalIds;
      st.hubs = topo.hubs; st.routes = topo.routes;
    });
    return model;
  }

  function restore(saved, board, opts) {
    if (!saved || saved.v !== 1 || !saved.sides) return create(board, opts);
    var model = copy(saved);
    model.classification = CLASSIFICATION;
    model.history = Array.isArray(model.history) ? model.history : [];
    ['blue', 'red'].forEach(function (side) {
      var fallback = initialSide(board, side, opts || {}), st = model.sides[side] || fallback;
      st.stocks = Object.assign(fullStocks(), st.stocks || {});
      RESOURCES.forEach(function (k) { st.stocks[k] = clamp(st.stocks[k], 0, 100); });
      st.initialStocks = Object.assign(fullStocks(), st.initialStocks || st.stocks);
      st.prepositioning = clamp(st.prepositioning == null ? 60 : st.prepositioning, 0, 100);
      st.initialPrepositioning = clamp(st.initialPrepositioning == null ? st.prepositioning : st.initialPrepositioning, 0, 100);
      st.decision = normalizeDecision(st.decision);
      st.shortages = Array.isArray(st.shortages) ? st.shortages : [];
      st.totals = Object.assign(fallback.totals, st.totals || {});
      st.totals.consumed = Object.assign(zeroResources(), st.totals.consumed || {});
      st.totals.replenished = Object.assign(zeroResources(), st.totals.replenished || {});
      model.sides[side] = st;
    });
    model.initial = model.initial || { blue: copy(model.sides.blue), red: copy(model.sides.red) };
    return refresh(model, board);
  }

  function setDecision(model, side, decision) {
    if (!model || !model.sides || !model.sides[side]) return null;
    model.sides[side].decision = normalizeDecision(decision);
    return copy(model.sides[side].decision);
  }
  function decisionFor(model, side) { return model && model.sides && model.sides[side] ? copy(model.sides[side].decision) : null; }
  function chooseDecision(model, side) {
    var st = model && model.sides && model.sides[side];
    if (!st) return 'balanced';
    if (st.ddil >= 0.38) return 'ddil';
    if ((st.routes || []).some(function (r) { return r.status === 'closed'; }) || st.flow < 0.58) return 'reroute';
    if (st.stocks.maintenance < 38 || st.stocks.personnel < 35) return 'repair';
    if (st.stocks.fuel < 42 || st.stocks.ammunition < 42) return st.prepositioning < 35 ? 'preposition' : 'balanced';
    return st.readiness > 0.82 ? 'surge' : 'balanced';
  }

  function costForOrder(order) {
    if (!order) return zeroResources();
    var key = order.kind === 'strike' ? 'strike:' + String(order.methodKey || 'kinetic') : order.kind;
    return Object.assign(zeroResources(), COSTS[key] || {});
  }
  function validateOrder(model, side, order) {
    var st = model && model.sides && model.sides[side];
    if (!st) return { ok: true, reason: 'ok' };
    var cost = costForOrder(order), short = [];
    RESOURCES.forEach(function (k) { if (cost[k] > 0 && st.stocks[k] < Math.min(cost[k], 1)) short.push(k); });
    return short.length ? { ok: false, reason: short[0] + '-shortage', shortages: short } : { ok: true, reason: 'ok' };
  }

  function effectFor(st, order, supported) {
    var cost = costForOrder(order), relevant = RESOURCES.filter(function (k) { return cost[k] > 0; });
    var stockFactor = relevant.length ? relevant.reduce(function (m, k) {
      return Math.min(m, clamp(st.stocks[k] / Math.max(cost[k] * 4, 24), 0, 1));
    }, 1) : 1;
    var a = st.decision.allocation;
    var operations = clamp(0.78 + a.operations / 160, 0.72, 1);
    var network = clamp(0.78 + st.flow * 0.22, 0.72, 1);
    var command = clamp(1 - st.ddil * 0.28, 0.68, 1);
    var sustain = supported ? clamp(0.58 + 0.42 * stockFactor, 0.5, 1) : 0;
    var combat = clamp(sustain * operations * network * command, 0, 1);
    var repairStock = Math.min(clamp(st.stocks.maintenance / 32, 0, 1), clamp(st.stocks.personnel / 28, 0, 1));
    var repair = supported ? clamp((0.50 + 0.50 * repairStock) * (0.75 + a.repair / 180) * network * command, 0.25, 1) : 0;
    var harden = supported ? clamp((0.58 + 0.42 * repairStock) * (0.78 + a.resilience / 170) * command, 0.3, 1) : 0;
    return { supported: !!supported, cost: cost, probabilityMult: order && order.kind === 'strike' ? combat : 1,
      damageMult: order && order.kind === 'strike' ? clamp(0.72 + combat * 0.28, 0.55, 1) : 1,
      repairMult: repair, hardenStrength: harden };
  }

  function prepareTurn(model, board, orders) {
    if (!model || !model.sides) return null;
    settlePending(model, 'blue'); settlePending(model, 'red');
    var available = { blue: copy(model.sides.blue.stocks), red: copy(model.sides.red.stocks) };
    var consumed = { blue: zeroResources(), red: zeroResources() };
    var shortages = { blue: [], red: [] };
    var effects = (orders || []).map(function (order) {
      var side = order.side, st = model.sides[side], cost = costForOrder(order), missing = [];
      RESOURCES.forEach(function (k) { if (cost[k] > available[side][k]) missing.push(k); });
      var supported = missing.length === 0;
      if (supported) RESOURCES.forEach(function (k) {
        available[side][k] -= cost[k]; consumed[side][k] += cost[k];
      });
      else shortages[side].push({ kind: order.kind, methodKey: order.methodKey || null,
        targetId: order.targetId || null, resources: missing });
      return effectFor(st, order, supported);
    });
    return { effects: effects, consumed: consumed, shortages: shortages };
  }

  function updateNetwork(st, board, side, combatEvents, advance) {
    var prevRoutes = {};
    (st.routes || []).forEach(function (r) { prevRoutes[r.id] = { status: r.status, rerouted: r.rerouted }; });
    var commIds = st.commandIds || [];
    var commHealth = commIds.length ? commIds.reduce(function (sum, id) { return sum + healthFrac(board.nodes[id]); }, 0) / commIds.length : 1;
    var cyberHits = (combatEvents || []).filter(function (e) {
      var n = board.nodes[e.targetId];
      return n && n.team === side && (e.kind === 'hit' || e.kind === 'kill' || e.kind === 'cascade') &&
        (e.method === 'cyber' || e.method === 'ew' || (st.digitalIds || []).indexOf(n.id) >= 0);
    }).length;
    var resilience = st.decision.allocation.resilience;
    st.ddil = clamp((1 - commHealth) * 0.82 + cyberHits * 0.04 - resilience * 0.0025, 0, 0.92);

    (st.hubs || []).forEach(function (hub) {
      var n = board.nodes[hub.id];
      hub.disruption = round1(clamp(1 - healthFrac(n) + st.ddil * 0.12, 0, 1));
      hub.status = routeStatus(hub.disruption);
    });
    var routing = st.decision.allocation.routing;
    (st.routes || []).forEach(function (route) {
      var avg = route.nodeIds.length ? route.nodeIds.reduce(function (sum, id) { return sum + healthFrac(board.nodes[id]); }, 0) / route.nodeIds.length : 0;
      var hubPenalty = route.hubIds.length ? route.hubIds.reduce(function (sum, id) {
        var h = st.hubs.filter(function (x) { return x.id === id; })[0]; return sum + (h ? h.disruption : 0);
      }, 0) / route.hubIds.length : 0;
      var raw = clamp((1 - avg) * 0.72 + hubPenalty * 0.35 + st.ddil * (route.mode === 'digital' ? 0.58 : 0.18), 0, 1);
      route.repairProgress = clamp(Number(route.repairProgress || 0) + (advance ? routing * 0.0025 : 0), 0, 0.25);
      var altOpen = (st.routes || []).some(function (other) { return other.id !== route.id && other.status !== 'closed'; });
      route.rerouted = raw >= 0.34 && routing >= 28 && altOpen;
      var reduced = raw - route.repairProgress - (route.rerouted ? 0.18 : 0);
      route.disruption = round1(clamp(reduced, 0, 1));
      route.status = routeStatus(route.disruption);
      route.effectiveCapacity = round1(clamp(1 - route.disruption, 0, 1));
      var prev = prevRoutes[route.id] || {};
      if (advance && route.rerouted && !prev.rerouted) st.totals.reroutes++;
      if (advance && route.repairProgress > 0 && route.disruption < raw) st.totals.routeRepairs++;
    });
    var activeRoutes = (st.routes || []).filter(function (r) { return r.mode !== 'digital'; });
    var physical = activeRoutes.length ? activeRoutes.reduce(function (sum, r) { return sum + r.effectiveCapacity; }, 0) / activeRoutes.length : commHealth;
    var digital = (st.routes || []).filter(function (r) { return r.mode === 'digital'; });
    var digitalFlow = digital.length ? digital.reduce(function (sum, r) { return sum + r.effectiveCapacity; }, 0) / digital.length : commHealth;
    st.flow = clamp(physical * 0.78 + digitalFlow * 0.22, 0, 1);
    var buffer = advance && st.flow < 0.62 ? Math.min(st.prepositioning, (0.62 - st.flow) * 16) : 0;
    if (buffer > 0) { st.prepositioning = clamp(st.prepositioning - buffer, 0, 100); st.flow = clamp(st.flow + buffer / 28, 0, 1); }
    return st;
  }

  function replenish(st, board, side, audit) {
    var health = st.logisticsIds.length ? st.logisticsIds.reduce(function (sum, id) { return sum + healthFrac(board.nodes[id]); }, 0) / st.logisticsIds.length : 0.45;
    var base = (3.5 + Math.sqrt(Math.max(1, st.logisticsIds.length)) * 1.4) * st.flow * (0.45 + health * 0.55);
    var a = st.decision.allocation, gains = {
      fuel: base * (0.72 + a.operations / 120),
      ammunition: base * (0.65 + a.operations / 125),
      maintenance: base * (0.48 + a.repair / 75),
      personnel: base * (0.42 + (a.repair + a.resilience) / 160)
    };
    var prepoGain = base * a.prepositioning / 160;
    st.prepositioning = clamp(st.prepositioning + prepoGain, 0, 100);
    if (audit) st.totals.prepositioned += prepoGain;
    RESOURCES.forEach(function (k) {
      gains[k] = Math.min(gains[k], 100 - st.stocks[k]);
      st.stocks[k] += gains[k]; if (audit) st.totals.replenished[k] += gains[k];
    });
    return gains;
  }

  function settlePending(model, side) {
    var pending = model && model.pending && model.pending[side];
    var st = model && model.sides && model.sides[side];
    if (!pending || !st) return st;
    var ownDamage = (pending.combatEvents || []).reduce(function (sum, e) {
      var n = pending.board.nodes[e.targetId]; return sum + (n && n.team === side ? Number(e.damage || 0) : 0);
    }, 0);
    var ownLosses = (pending.combatEvents || []).filter(function (e) {
      var n = pending.board.nodes[e.targetId]; return n && n.team === side && (e.kind === 'kill' || e.kind === 'cascade');
    }).length;
    st.stocks.maintenance = clamp(st.stocks.maintenance - ownDamage * 0.025, 0, 100);
    st.stocks.personnel = clamp(st.stocks.personnel - ownLosses * 1.6 - ownDamage * 0.006, 0, 100);
    updateNetwork(st, pending.board, side, pending.combatEvents || [], true);
    replenish(st, pending.board, side, false);
    var stockMean = RESOURCES.reduce(function (sum, k) { return sum + st.stocks[k]; }, 0) / (RESOURCES.length * 100);
    st.readiness = clamp(stockMean * 0.58 + st.flow * 0.27 + (1 - st.ddil) * 0.15, 0, 1);
    delete model.pending[side];
    return st;
  }

  function resolveTurn(model, board, orders, combatEvents, plan) {
    if (!model || !model.sides || !plan) return null;
    var audit = model.speculative !== true;
    model.turn = Number(model.turn || 0) + 1;
    var row = { turn: model.turn, sides: {}, events: [] };
    ['blue', 'red'].forEach(function (side) {
      var st = model.sides[side], beforeStocks = Object.assign({}, st.stocks);
      var beforeRoutes = audit ? copy(st.routes || []) : [];
      RESOURCES.forEach(function (k) {
        var spent = Number(plan.consumed[side][k] || 0);
        st.stocks[k] = clamp(st.stocks[k] - spent, 0, 100);
        if (audit) st.totals.consumed[k] += spent;
      });
      if (!audit) {
        model.pending = model.pending || {};
        model.pending[side] = { board: board, combatEvents: combatEvents || [] };
        row.sides[side] = { decision: st.decision, stocksAfter: st.stocks,
          prepositioning: st.prepositioning, ddil: st.ddil, flow: st.flow, readiness: st.readiness };
        return;
      }
      var ownDamage = (combatEvents || []).reduce(function (sum, e) {
        var n = board.nodes[e.targetId]; return sum + (n && n.team === side ? Number(e.damage || 0) : 0);
      }, 0);
      var ownLosses = (combatEvents || []).filter(function (e) {
        var n = board.nodes[e.targetId]; return n && n.team === side && (e.kind === 'kill' || e.kind === 'cascade');
      }).length;
      st.stocks.maintenance = clamp(st.stocks.maintenance - ownDamage * 0.025, 0, 100);
      st.stocks.personnel = clamp(st.stocks.personnel - ownLosses * 1.6 - ownDamage * 0.006, 0, 100);
      updateNetwork(st, board, side, combatEvents || [], true);
      var gains = replenish(st, board, side, audit);
      var shortages = plan.shortages[side] || [];
      shortages.forEach(function (s) {
        if (audit) {
          st.shortages.push({ turn: model.turn, kind: s.kind, methodKey: s.methodKey, resources: s.resources.slice() });
          st.totals.shortages++;
        }
        if (audit) row.events.push({ side: side, kind: 'logistics-shortage', targetId: s.targetId,
          resources: s.resources.slice(), text: side.toUpperCase() + ' order unsupported: ' + s.resources.join(', ') + ' unavailable.' });
      });
      var relevantOrders = (orders || []).filter(function (o) { return o.side === side; });
      var repairOrders = relevantOrders.filter(function (o) { return o.kind === 'repair'; }).length;
      if (audit) st.totals.nodeRepairs += repairOrders;
      var stockMean = RESOURCES.reduce(function (sum, k) { return sum + st.stocks[k]; }, 0) / (RESOURCES.length * 100);
      st.readiness = clamp(stockMean * 0.58 + st.flow * 0.27 + (1 - st.ddil) * 0.15, 0, 1);
      var newlyDisrupted = audit ? (st.routes || []).filter(function (r) {
        var old = beforeRoutes.filter(function (x) { return x.id === r.id; })[0];
        return r.status !== 'open' && (!old || old.status === 'open');
      }) : [];
      newlyDisrupted.forEach(function (r) {
        row.events.push({ side: side, kind: 'route-disruption', routeId: r.id,
          text: r.label + ' is ' + r.status + (r.rerouted ? '; traffic rerouted.' : '.') });
      });
      (audit ? st.routes || [] : []).filter(function (r) {
        var old = beforeRoutes.filter(function (x) { return x.id === r.id; })[0];
        return r.rerouted && (!old || !old.rerouted);
      }).forEach(function (r) {
        row.events.push({ side: side, kind: 'reroute', routeId: r.id, text: side.toUpperCase() + ' rerouted flow around ' + r.label + '.' });
      });
      var low = RESOURCES.filter(function (k) { return st.stocks[k] < 30; });
      if (audit) {
        row.events.push({ side: side, kind: 'logistics',
          text: side.toUpperCase() + ' logistics: readiness ' + Math.round(st.readiness * 100) + '%, flow ' +
            Math.round(st.flow * 100) + '%, DDIL ' + Math.round(st.ddil * 100) + '%' +
            (low.length ? '; low ' + low.join('/') + '.' : '.') });
        row.sides[side] = {
          decision: copy(st.decision), stocksBefore: beforeStocks,
          consumed: copy(plan.consumed[side]), replenished: copy(gains), stocksAfter: copy(st.stocks),
          shortages: copy(shortages), prepositioning: round1(st.prepositioning), ddil: round1(st.ddil),
          flow: round1(st.flow), readiness: round1(st.readiness), hubs: copy(st.hubs), routes: copy(st.routes)
        };
      }
    });
    if (audit) model.history.push(copy(row));
    return row;
  }

  function apPenalty(model, side) {
    var st = settlePending(model, side) || model && model.sides && model.sides[side];
    if (!st) return 0;
    var p = st.readiness < 0.34 ? 2 : st.readiness < 0.58 ? 1 : 0;
    if (st.ddil >= 0.72) p++;
    return Math.min(2, p);
  }
  function throughputMultiplier(model, side) {
    var st = settlePending(model, side) || model && model.sides && model.sides[side];
    if (!st) return 1;
    return clamp(0.52 + st.flow * 0.28 + st.readiness * 0.20, 0.35, 1);
  }

  function publicView(model) { return copy(model); }
  function summarize(model) {
    if (!model || !model.sides) return null;
    var out = { classification: CLASSIFICATION, turns: model.history.length, sides: {} };
    ['blue', 'red'].forEach(function (side) {
      var st = model.sides[side], decisions = {}, mins = fullStocks();
      (model.history || []).forEach(function (row) {
        var s = row.sides && row.sides[side]; if (!s) return;
        var id = s.decision && s.decision.id || 'balanced'; decisions[id] = (decisions[id] || 0) + 1;
        RESOURCES.forEach(function (k) { mins[k] = Math.min(mins[k], Number(s.stocksAfter[k])); });
      });
      out.sides[side] = {
        initialStocks: copy(st.initialStocks), finalStocks: copy(st.stocks), minimumStocks: mins,
        initialPrepositioning: st.initialPrepositioning, finalPrepositioning: round1(st.prepositioning),
        finalReadiness: round1(st.readiness), finalFlow: round1(st.flow), finalDdil: round1(st.ddil),
        totals: copy(st.totals), decisions: decisions,
        hubs: copy(st.hubs), routes: copy(st.routes), shortages: copy(st.shortages)
      };
    });
    return out;
  }

  function presetList() { return Object.keys(PRESETS).map(function (id) { return copy(PRESETS[id]); }); }
  function cloneSide(st, shareTopology) {
    if (shareTopology) return {
      stocks: Object.assign({}, st.stocks), initialStocks: st.initialStocks,
      prepositioning: st.prepositioning, initialPrepositioning: st.initialPrepositioning,
      decision: st.decision, ddil: st.ddil, flow: st.flow, readiness: st.readiness,
      shortages: [], logisticsIds: st.logisticsIds || [], commandIds: st.commandIds || [], digitalIds: st.digitalIds || [],
      hubs: (st.hubs || []).map(function (h) { return Object.assign({}, h); }),
      routes: (st.routes || []).map(function (r) { return Object.assign({}, r,
        { nodeIds: r.nodeIds || [], hubIds: r.hubIds || [] }); }),
      totals: { consumed: zeroResources(), replenished: zeroResources(), shortages: 0,
        reroutes: 0, routeRepairs: 0, nodeRepairs: 0, prepositioned: 0 }
    };
    return {
      stocks: Object.assign({}, st.stocks), initialStocks: Object.assign({}, st.initialStocks),
      prepositioning: st.prepositioning, initialPrepositioning: st.initialPrepositioning,
      decision: { id: st.decision.id, label: st.decision.label, short: st.decision.short,
        note: st.decision.note, allocation: Object.assign({}, st.decision.allocation) },
      ddil: st.ddil, flow: st.flow, readiness: st.readiness,
      shortages: (st.shortages || []).map(function (s) { return Object.assign({}, s, { resources: (s.resources || []).slice() }); }),
      logisticsIds: (st.logisticsIds || []).slice(),
      commandIds: (st.commandIds || []).slice(),
      digitalIds: (st.digitalIds || []).slice(),
      hubs: (st.hubs || []).map(function (h) { return Object.assign({}, h); }),
      routes: (st.routes || []).map(function (r) { return Object.assign({}, r,
        { nodeIds: (r.nodeIds || []).slice(), hubIds: (r.hubIds || []).slice() }); }),
      totals: {
        consumed: Object.assign(zeroResources(), st.totals && st.totals.consumed || {}),
        replenished: Object.assign(zeroResources(), st.totals && st.totals.replenished || {}),
        shortages: Number(st.totals && st.totals.shortages || 0), reroutes: Number(st.totals && st.totals.reroutes || 0),
        routeRepairs: Number(st.totals && st.totals.routeRepairs || 0), nodeRepairs: Number(st.totals && st.totals.nodeRepairs || 0),
        prepositioned: Number(st.totals && st.totals.prepositioned || 0)
      }
    };
  }
  function clone(model, opts) {
    if (!model || !model.sides) return copy(model);
    opts = opts || {};
    var speculative = !!opts.speculative;
    return {
      v: model.v, classification: model.classification, turn: model.turn,
      speculative: speculative,
      sides: { blue: cloneSide(model.sides.blue, speculative), red: cloneSide(model.sides.red, speculative) },
      pending: {},
      history: speculative ? [] : copy(model.history || []),
      initial: speculative ? null : copy(model.initial || null)
    };
  }
  function resetSpeculative(target, source) {
    if (!target || !target.speculative || !source || !source.sides) return clone(source, { speculative: true });
    target.turn = source.turn; target.pending = {}; target.history.length = 0;
    ['blue', 'red'].forEach(function (side) {
      var dst = target.sides[side], src = source.sides[side];
      if (!dst || !src || dst.routes.length !== src.routes.length || dst.hubs.length !== src.hubs.length) {
        target.sides[side] = cloneSide(src, true); return;
      }
      RESOURCES.forEach(function (k) { dst.stocks[k] = src.stocks[k]; });
      dst.prepositioning = src.prepositioning; dst.decision = src.decision;
      dst.ddil = src.ddil; dst.flow = src.flow; dst.readiness = src.readiness;
      dst.shortages.length = 0;
      dst.hubs.forEach(function (hub, i) {
        hub.disruption = src.hubs[i].disruption; hub.status = src.hubs[i].status;
      });
      dst.routes.forEach(function (route, i) {
        var from = src.routes[i];
        route.disruption = from.disruption; route.effectiveCapacity = from.effectiveCapacity;
        route.status = from.status; route.rerouted = from.rerouted; route.repairProgress = from.repairProgress;
      });
      dst.totals = { consumed: zeroResources(), replenished: zeroResources(), shortages: 0,
        reroutes: 0, routeRepairs: 0, nodeRepairs: 0, prepositioned: 0 };
    });
    return target;
  }

  return {
    CLASSIFICATION: CLASSIFICATION,
    resources: function () { return RESOURCES.slice(); },
    allocationKeys: function () { return ALLOCATION_KEYS.slice(); },
    presets: presetList,
    create: create,
    restore: restore,
    refresh: refresh,
    clone: clone,
    resetSpeculative: resetSpeculative,
    publicView: publicView,
    summarize: summarize,
    setDecision: setDecision,
    decisionFor: decisionFor,
    chooseDecision: chooseDecision,
    costForOrder: costForOrder,
    validateOrder: validateOrder,
    prepareTurn: prepareTurn,
    resolveTurn: resolveTurn,
    apPenalty: apPenalty,
    throughputMultiplier: throughputMultiplier,
    _internal: {
      isLogisticsNode: isLogisticsNode,
      hubKind: hubKind,
      nodeModes: nodeModes,
      normalizeAllocation: normalizeAllocation,
      normalizeDecision: normalizeDecision,
      updateNetwork: updateNetwork,
      replenish: replenish,
      effectFor: effectFor
    }
  };
})();
