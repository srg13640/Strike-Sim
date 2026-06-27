/*
 * game.js — turn-based War Game engine for the MDSC visualizer.
 *
 * This is the "game" layer that sits on top of the existing simulation math. The
 * Monte Carlo sim in StrikeSim2040.html answers "if Blue executes this plan, how does it
 * tend to go?"; the War Game answers "two commanders each issue orders, resolve them,
 * repeat until someone wins." Red is promoted from a purely reactive counter-profile
 * into a first-class playable side.
 *
 * Design pillars
 *  - SIMULTANEOUS orders: both sides queue orders blind, then both resolve against the
 *    same start-of-turn board (Diplomacy-style). A node that is destroyed this turn
 *    still gets to act this turn, because both sides committed before resolution.
 *  - DETERMINISTIC + PURE resolver: resolveTurn(board, orders, cfg, rng) is a pure
 *    function of its inputs. The per-turn RNG is seeded from (matchSeed, turn), so a
 *    turn always resolves the same way. That is what makes matches replayable, makes
 *    the AI reproducible, and (Phase 3) lets two networked peers resolve identically
 *    from the same orders without trusting each other's client.
 *  - SELF-CONTAINED combat constants: the numbers below are copied from the live sim
 *    (strikeMethods / settings.difficultyModifiers / cascadeAlpha / domainAffinity /
 *    vuln model) so the game *feels* consistent with the analytic sim, but the engine
 *    has NO hidden cross-script dependency — essential for deterministic network play.
 *
 * The module reads the active scenario graph via window.AppState.activeGraph() to build
 * a board, and (via the controller) writes resolved health/status back onto the live
 * node objects so the existing 3D / Map / color paths visualize the game for free.
 */
window.GameModule = (function () {
  'use strict';

  // ---- Combat constants (grounded in the live sim; see header) -------------------
  const METHODS = {
    kinetic: { name: 'Kinetic Strike', label: 'Kinetic', short: 'KE',  baseProb: 0.85, dmg: [50, 70], vuln: 'Kinetic' },
    cyber:   { name: 'Cyber Attack',   label: 'Cyber',   short: 'CYB', baseProb: 0.70, dmg: [30, 50], vuln: 'Cyber' },
    ew:      { name: 'EW Jamming',     label: 'EW',      short: 'EW',  baseProb: 0.60, dmg: [20, 40], vuln: 'EW' },
    sof:     { name: 'SOF Mission',    label: 'SOF',     short: 'SOF', baseProb: 0.90, dmg: [60, 90], vuln: 'SOF' }
  };
  const METHOD_KEYS = ['kinetic', 'cyber', 'ew', 'sof'];
  const DIFF = { Soft: 1.2, Medium: 1.0, Mobile: 0.9, Hardened: 0.7, Fortified: 0.65, Buried: 0.5 };
  const CASCADE_ALPHA = 0.25;
  const HARDEN_MULT = 0.55;     // incoming strike success multiplier on a hardened node (this turn)
  const REPAIR_AMOUNT = 30;     // health restored by a Repair order at end of turn

  const DEFAULT_CFG = {
    apBlue: 4,            // action points / orders per turn
    apRed: 5,            // Red fields more mass; Blue is more precise (asymmetry by design)
    turnLimit: 10,
    collapseFrac: 0.35,   // a side is defeated if its alive objective value falls below this fraction of its start value
    repairAmount: REPAIR_AMOUNT,
    control: { blue: 'human', red: 'ai' },
    difficulty: { blue: 'hard', red: 'hard' },   // AI strength when a side is 'ai'
    fog: false
  };
  const METHOD_RESOURCE_KEYS = {
    kinetic: ['kinetic'],
    cyber: ['jam', 'ew'],
    ew: ['ew', 'jam'],
    sof: ['sof']
  };
  const VULN_ALIASES = {
    Kinetic: ['Kinetic', 'Missile', 'Deep Strike', 'Precision Strike', 'Air', 'ASCM', 'Torpedo', 'Counter-battery', 'Artillery', 'Shore Fire'],
    Cyber: ['Cyber', 'ASAT', 'EMP', 'ISR'],
    EW: ['EW', 'ARMs', 'SAM', 'Air-to-Air', 'MANPADS'],
    SOF: ['SOF', 'Sabotage', 'Physical', 'MCM']
  };

  // ---- Deterministic RNG (same LCG family as sim.js createRng) --------------------
  function hashSeed() {
    let h = 2166136261 >>> 0;
    for (let a = 0; a < arguments.length; a++) {
      const s = String(arguments[a]);
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    }
    return (h >>> 0) || 1;
  }
  function makeRng(seed) {
    let s = (seed >>> 0) % 2147483647;
    if (s <= 0) s += 2147483646;
    return {
      next() { s = (s * 48271) % 2147483647; return s / 2147483647; },
      range(a, b) { return a + (b - a) * this.next(); },
      int(a, b) { return Math.floor(this.range(a, b + 1)); },
      pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
    };
  }

  // ---- Combat helpers (copies of the live sim's, kept self-contained) -------------
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function resourceGenByType(node) {
    const r = node.resourceGenByType || {};
    return {
      kinetic: Number(r.kinetic || 0),
      ew: Number(r.ew || 0),
      jam: Number(r.jam || 0),
      sof: Number(r.sof || 0)
    };
  }

  function resourceForMethod(node, methodKey) {
    const keys = METHOD_RESOURCE_KEYS[methodKey] || [];
    const r = node.resourceGenByType || {};
    return keys.reduce((sum, key) => sum + Number(r[key] || 0), 0);
  }

  function canSourceStrike(node) {
    if (!node || !node.alive) return false;
    const subsystem = String(node.subsystem || '').toLowerCase();
    if (subsystem.includes('logistics') || subsystem.includes('sustainment')) return false;
    return METHOD_KEYS.some(k => resourceForMethod(node, k) > 0);
  }

  function vulnMult(node, method) {
    const aliases = VULN_ALIASES[method.vuln] || [method.vuln];
    return (node.vulns || []).some(v => aliases.includes(v)) ? 1.25 : 0.85;
  }

  function affinity(src, dst, methodKey) {
    if (!src || !dst) return 1.0;
    const sd = new Set(src.domain || []);
    const dd = new Set(dst.domain || []);
    const shared = Array.from(sd).some(d => dd.has(d));
    let mult = shared ? 1.3 : 1.0;
    const st = String(src.type || '').toLowerCase();
    const dt = String(dst.type || '').toLowerCase();
    if (st.includes('command') || dt.includes('command') || st.includes('relay') || dt.includes('relay')) mult *= 1.15;
    if ((methodKey === 'cyber' || methodKey === 'ew') && (dd.has('Cyber') || dd.has('EW') || dt.includes('relay'))) mult *= 1.15;
    return clamp(mult, 0.8, 1.8);
  }

  function nodeValue(n) { return (n.importance || 5) * (n.casc || 1); }

  // ---- Board construction ---------------------------------------------------------
  // A board is a pure, serializable snapshot: per-node combat fields + health/alive,
  // adjacency, and the team rosters. It is the single source of truth a match mutates.
  function buildBoard(graph) {
    graph = graph || { nodes: [], links: [] };
    const nodes = {};
    const rosters = { blue: [], red: [] };
    (graph.nodes || []).forEach(n => {
      const team = n.team || (n.originalTeam || null);
      if (team !== 'blue' && team !== 'red') return;   // only the two combatant sides play
      const healthMax = n.healthMax || 100;
      nodes[n.id] = {
        id: n.id,
        name: n.name || n.id,
        team,
        difficulty: n.difficulty || 'Medium',
        vulns: Array.isArray(n.vulnerabilities) ? n.vulnerabilities.slice() : [],
        casc: Math.max(1, Number(n.cascScore || 1)),
        importance: Number(n.importance || 5),
        subsystem: n.subsystem || '',
        resourceGenByType: resourceGenByType(n),
        domain: Array.isArray(n.domain) ? n.domain.slice() : (n.domain ? [n.domain] : []),
        type: n.type || '',
        healthMax,
        health: n.status === 'Neutralized' ? 0 : (n.health == null ? healthMax : n.health),
        alive: n.status !== 'Neutralized'
      };
      rosters[team].push(n.id);
    });
    const adj = {};
    (graph.links || []).forEach(l => {
      const s = (l.source && l.source.id != null) ? l.source.id : l.source;
      const t = (l.target && l.target.id != null) ? l.target.id : l.target;
      if (nodes[s] == null || nodes[t] == null) return;
      (adj[s] = adj[s] || []).push(t);
      (adj[t] = adj[t] || []).push(s);
    });
    return { nodes, adj, rosters };
  }

  function objectiveValue(board, team) {
    let v = 0;
    board.rosters[team].forEach(id => { const n = board.nodes[id]; if (n && n.alive) v += nodeValue(n); });
    return v;
  }

  function enemyOf(side) { return side === 'blue' ? 'red' : 'blue'; }

  // ---- The deterministic resolver -------------------------------------------------
  // Mutates board health/alive in place; returns a structured report. Pure given
  // (board snapshot, orders, cfg, rng). Order of operations is fixed so the RNG stream
  // is identical across machines: harden -> strikes (vs start state) -> apply damage ->
  // cascades from this-turn kills -> repairs.
  function resolveTurn(board, orders, cfg, rng) {
    const events = [];
    const startAlive = {}, startHealth = {};
    for (const id in board.nodes) { startAlive[id] = board.nodes[id].alive; startHealth[id] = board.nodes[id].health; }

    const objBefore = { blue: objectiveValue(board, 'blue'), red: objectiveValue(board, 'red') };

    // Stable, machine-independent order so the RNG sequence is reproducible.
    const rank = { harden: 0, repair: 1, strike: 2 };
    const sorted = orders.slice().sort((a, b) =>
      (rank[a.kind] - rank[b.kind]) ||
      String(a.side).localeCompare(String(b.side)) ||
      String(a.targetId).localeCompare(String(b.targetId)) ||
      String(a.methodKey || '').localeCompare(String(b.methodKey || '')));

    // Pass 1: defensive declarations (read against start-of-turn state).
    const hardened = new Set();
    const repairs = [];
    for (const o of sorted) {
      const tgt = board.nodes[o.targetId];
      if (!tgt || tgt.team !== o.side || !startAlive[o.targetId]) continue;
      if (o.kind === 'harden') hardened.add(o.targetId);
      else if (o.kind === 'repair') repairs.push(o);
    }

    // Pass 2: offensive strikes, accumulated vs the START state (true simultaneity).
    const dmg = {};
    for (const o of sorted) {
      if (o.kind !== 'strike') continue;
      const tgt = board.nodes[o.targetId];
      if (!tgt || tgt.team === o.side || !startAlive[o.targetId]) {
        events.push({ side: o.side, kind: 'void', text: 'Order voided (invalid or already-down target).' });
        continue;
      }
      const m = METHODS[o.methodKey] || METHODS.kinetic;
      let p = m.baseProb * (DIFF[tgt.difficulty] || 1.0) * vulnMult(tgt, m);
      if (hardened.has(o.targetId)) p *= HARDEN_MULT;
      p = clamp(p, 0.05, 0.98);
      const hit = rng.next() < p;
      if (hit) {
        const d = m.dmg[0] + rng.next() * (m.dmg[1] - m.dmg[0]);
        dmg[o.targetId] = (dmg[o.targetId] || 0) + d;
        events.push({ side: o.side, kind: 'hit', method: o.methodKey, targetId: o.targetId,
          text: `${o.side.toUpperCase()} ${m.label} hit ${tgt.name} (-${Math.round(d)})${hardened.has(o.targetId) ? ' [hardened]' : ''}.` });
      } else {
        events.push({ side: o.side, kind: 'miss', method: o.methodKey, targetId: o.targetId,
          text: `${o.side.toUpperCase()} ${m.label} missed ${tgt.name}.` });
      }
    }

    // Apply accumulated damage; detect this-turn kills.
    const kills = [];
    for (const id in dmg) {
      const n = board.nodes[id];
      if (!startAlive[id]) continue;
      n.health = Math.max(0, n.health - dmg[id]);
      if (n.health <= 0 && n.alive) { n.alive = false; kills.push(id); events.push({ side: enemyOf(n.team), kind: 'kill', targetId: id, text: `${n.name} NEUTRALIZED.` }); }
    }

    // Single-level cascades radiating from this-turn kills.
    for (const id of kills) {
      const src = board.nodes[id];
      const neigh = board.adj[id] || [];
      for (const nid of neigh) {
        const nn = board.nodes[nid];
        if (!nn || !nn.alive) continue;
        const cd = 5 * (src.casc || 1) * Math.max(0.5, src.importance || 5) / 5 * CASCADE_ALPHA * affinity(src, nn);
        nn.health = Math.max(0, nn.health - cd);
        if (nn.health <= 0 && nn.alive) {
          nn.alive = false;
          events.push({ side: enemyOf(nn.team), kind: 'cascade', targetId: nid, text: `Cascade from ${src.name} took down ${nn.name}.` });
        }
      }
    }

    // End-of-turn repairs (offset damage taken this turn on surviving own nodes).
    for (const o of repairs) {
      const n = board.nodes[o.targetId];
      if (n && n.alive) {
        const before = n.health;
        n.health = Math.min(n.healthMax, n.health + (cfg.repairAmount || REPAIR_AMOUNT));
        if (n.health > before) events.push({ side: o.side, kind: 'repair', targetId: o.targetId, text: `${n.name} repaired (+${Math.round(n.health - before)}).` });
      }
    }

    const objAfter = { blue: objectiveValue(board, 'blue'), red: objectiveValue(board, 'red') };
    // A side scores the enemy objective-value it removed this turn (captures cascades too).
    const scoreDelta = {
      blue: Math.max(0, objBefore.red - objAfter.red),
      red: Math.max(0, objBefore.blue - objAfter.blue)
    };
    return { events, kills, scoreDelta, objAfter };
  }

  // ---- AI commander ---------------------------------------------------------------
  // Deterministic given (board, side, ap, difficulty, rng): identical inputs yield
  // identical orders, so an AI side stays in sync across networked peers. Strategy:
  // value-rank enemy targets, choose the method each target is most vulnerable to,
  // spend ~70% of AP striking and the rest hardening/repairing the most valuable own
  // nodes that are exposed. 'easy' wastes AP and picks noisier targets.
  function sourceForMethod(board, side, methodKey, target, rng) {
    return board.rosters[side]
      .map(id => board.nodes[id])
      .filter(n => canSourceStrike(n) && resourceForMethod(n, methodKey) > 0)
      .map(n => ({
        n,
        score: resourceForMethod(n, methodKey) * affinity(n, target, methodKey) * (0.9 + rng.next() * 0.2)
      }))
      .sort((a, b) => b.score - a.score)[0]?.n || null;
  }

  function sideStrikeCapacity(board, side) {
    return board.rosters[side]
      .map(id => board.nodes[id])
      .filter(canSourceStrike)
      .reduce((sum, n) => sum + METHOD_KEYS.reduce((s, k) => s + resourceForMethod(n, k), 0), 0);
  }

  function resourceAp(board, side, fallback) {
    const power = objectiveValue(board, side) + sideStrikeCapacity(board, side) * 4;
    return clamp(Math.round(3 + power / 1800), Math.max(3, fallback - 1), 6);
  }

  function planOrders(board, side, ap, difficulty, rng) {
    const orders = [];
    const foe = enemyOf(side);
    const easy = difficulty === 'easy';

    const enemies = board.rosters[foe]
      .map(id => board.nodes[id])
      .filter(n => n && n.alive)
      .map(n => ({ n, score: nodeValue(n) * (DIFF[n.difficulty] || 1) * (0.85 + rng.next() * 0.3) }))
      .sort((a, b) => b.score - a.score);

    const bestMethodFor = (n) => {
      // Prefer a method the target is vulnerable to; break ties by raw expected damage.
      let best = null, bestEV = -1, bestSource = null;
      for (const k of METHOD_KEYS) {
        const source = sourceForMethod(board, side, k, n, rng);
        if (!source) continue;
        const m = METHODS[k];
        const ev = m.baseProb * (DIFF[n.difficulty] || 1) * vulnMult(n, m) * ((m.dmg[0] + m.dmg[1]) / 2) *
          Math.sqrt(resourceForMethod(source, k));
        if (ev > bestEV) { bestEV = ev; best = k; bestSource = source; }
      }
      if (easy && rng.next() < 0.4) {
        const available = METHOD_KEYS.map(k => ({ k, source: sourceForMethod(board, side, k, n, rng) })).filter(x => x.source);
        const pick = available.length ? rng.pick(available) : null;
        return pick ? pick : { k: best, source: bestSource };
      }
      return { k: best, source: bestSource };
    };

    const strikeAP = Math.max(1, Math.round(ap * (easy ? 0.85 : 0.7)));
    let used = 0;
    for (const e of enemies) {
      if (used >= strikeAP) break;
      // Concentrate fire on the very top target to force a kill; spread the rest.
      const focus = used === 0 && !easy ? 2 : 1;
      for (let k = 0; k < focus && used < strikeAP; k++) {
        const method = bestMethodFor(e.n);
        if (!method || !method.k || !method.source) continue;
        orders.push({ side, kind: 'strike', methodKey: method.k, targetId: e.n.id, sourceId: method.source.id });
        used++;
      }
    }

    // Remaining AP: shore up own most-valuable damaged nodes (repair) or harden the
    // single most-valuable healthy node likely to be targeted next.
    let remaining = ap - used;
    if (remaining > 0) {
      const own = board.rosters[side].map(id => board.nodes[id]).filter(n => n && n.alive);
      const damaged = own.filter(n => n.health < n.healthMax * 0.8)
        .sort((a, b) => (nodeValue(b) * (1 - b.health / b.healthMax)) - (nodeValue(a) * (1 - a.health / a.healthMax)));
      const healthy = own.slice().sort((a, b) => nodeValue(b) - nodeValue(a));
      while (remaining > 0) {
        if (damaged.length && (!easy || rng.next() < 0.6)) {
          orders.push({ side, kind: 'repair', targetId: damaged.shift().id });
        } else if (healthy.length) {
          orders.push({ side, kind: 'harden', targetId: healthy.shift().id });
        } else break;
        remaining--;
      }
    }
    return orders;
  }

  // ===================================================================================
  // Match controller — holds the live match, drives the turn loop, writes board state
  // back to the scenario graph for visualization, and serializes for save / network.
  // ===================================================================================
  let match = null;
  let ctx = { onResolved: () => {}, onState: () => {} };

  function init(context) { ctx = Object.assign({}, ctx, context || {}); }

  function apFor(side) { return side === 'blue' ? match.cfg.apBlue : match.cfg.apRed; }

  function newMatch(cfgOverrides) {
    const graph = (window.AppState && window.AppState.activeGraph()) || { nodes: [], links: [] };
    const cfg = Object.assign({}, DEFAULT_CFG, cfgOverrides || {});
    cfg.control = Object.assign({}, DEFAULT_CFG.control, (cfgOverrides && cfgOverrides.control) || {});
    cfg.difficulty = Object.assign({}, DEFAULT_CFG.difficulty, (cfgOverrides && cfgOverrides.difficulty) || {});
    // Snapshot the scenario's current health/status so exiting the War Game restores
    // it untouched, then (unless explicitly resuming) reset both sides to full strength
    // so every match starts from a clean, deterministic board regardless of prior sim
    // damage. Without the reset, a second match would inherit the first match's losses.
    const savedGraphState = (graph.nodes || []).map(n => ({ id: n.id, health: n.health, status: n.status }));
    if (cfg.freshStart !== false) {
      (graph.nodes || []).forEach(n => {
        if (n.team !== 'blue' && n.team !== 'red') return;
        n.health = n.healthMax || 100;
        n.status = 'Active';
      });
    }
    const board = buildBoard(graph);
    if (!cfgOverrides || cfgOverrides.apBlue == null) cfg.apBlue = resourceAp(board, 'blue', DEFAULT_CFG.apBlue);
    if (!cfgOverrides || cfgOverrides.apRed == null) cfg.apRed = resourceAp(board, 'red', DEFAULT_CFG.apRed);
    const seed = (cfgOverrides && cfgOverrides.seed) || hashSeed('match', graph.nodes ? graph.nodes.length : 0, Object.keys(board.nodes).join('').length);
    match = {
      cfg, board, seed,
      turn: 1,
      phase: 'plan',            // 'plan' | 'resolved' | 'over'
      orders: { blue: [], red: [] },
      score: { blue: 0, red: 0 },
      startObj: { blue: objectiveValue(board, 'blue'), red: objectiveValue(board, 'red') },
      history: [],
      winner: null,
      lastReport: null,
      savedGraphState
    };
    syncBoardToGraph();
    ctx.onState(getState());
    return getState();
  }

  // Public, serializable view of the match for the UI.
  function getState() {
    if (!match) return null;
    return {
      turn: match.turn,
      phase: match.phase,
      cfg: match.cfg,
      score: { blue: match.score.blue, red: match.score.red },
      objNow: { blue: objectiveValue(match.board, 'blue'), red: objectiveValue(match.board, 'red') },
      startObj: match.startObj,
      orders: { blue: match.orders.blue.slice(), red: match.orders.red.slice() },
      ap: { blue: apFor('blue'), red: apFor('red') },
      apLeft: { blue: apFor('blue') - match.orders.blue.length, red: apFor('red') - match.orders.red.length },
      winner: match.winner,
      lastReport: match.lastReport,
      rosters: { blue: match.board.rosters.blue.length, red: match.board.rosters.red.length },
      alive: {
        blue: match.board.rosters.blue.filter(id => match.board.nodes[id].alive).length,
        red: match.board.rosters.red.filter(id => match.board.nodes[id].alive).length
      }
    };
  }

  function isHuman(side) { return match.cfg.control[side] === 'human'; }
  function boardNode(id) { return match && match.board.nodes[id]; }
  function methods() { return METHODS; }
  function methodKeys() { return METHOD_KEYS.slice(); }

  // Add / remove a human order during the plan phase (AP-bounded).
  function queueOrder(side, order) {
    if (!match || match.phase !== 'plan' || !isHuman(side)) return false;
    if (match.orders[side].length >= apFor(side)) return false;
    const n = match.board.nodes[order.targetId];
    if (!n || !n.alive) return false;
    if (order.kind === 'strike' && n.team === side) return false;   // can't strike your own
    if ((order.kind === 'harden' || order.kind === 'repair') && n.team !== side) return false;
    match.orders[side].push(Object.assign({ side }, order));
    ctx.onState(getState());
    return true;
  }
  function removeOrder(side, index) {
    if (!match || match.phase !== 'plan') return;
    match.orders[side].splice(index, 1);
    ctx.onState(getState());
  }
  function clearOrders(side) { if (match && match.phase === 'plan') { match.orders[side] = []; ctx.onState(getState()); } }

  // Fill an AI side's orders for the current turn (deterministic from turn+side).
  function ensureAiOrders(side) {
    if (isHuman(side)) return;
    const rng = makeRng(hashSeed(match.seed, 'plan', match.turn, side));
    match.orders[side] = planOrders(match.board, side, apFor(side), match.cfg.difficulty[side], rng);
  }

  // Commit the turn: gather AI orders, resolve, write back, score, check victory.
  function commitTurn() {
    if (!match || match.phase !== 'plan') return getState();
    ensureAiOrders('blue');
    ensureAiOrders('red');
    const allOrders = match.orders.blue.concat(match.orders.red);
    const rng = makeRng(hashSeed(match.seed, 'resolve', match.turn));
    const report = resolveTurn(match.board, allOrders, match.cfg, rng);
    match.score.blue += report.scoreDelta.blue;
    match.score.red += report.scoreDelta.red;
    match.history.push({ turn: match.turn, orders: { blue: match.orders.blue.slice(), red: match.orders.red.slice() }, report });
    match.lastReport = { turn: match.turn, events: report.events, scoreDelta: report.scoreDelta };
    syncBoardToGraph();
    evaluateVictory();
    match.phase = match.winner ? 'over' : 'resolved';
    ctx.onResolved(match.lastReport, getState());
    ctx.onState(getState());
    return getState();
  }

  // Advance from a resolved turn into the next plan phase.
  function nextTurn() {
    if (!match || match.phase !== 'resolved') return getState();
    match.turn += 1;
    match.orders = { blue: [], red: [] };
    match.phase = 'plan';
    if (match.turn > match.cfg.turnLimit) { evaluateVictory(true); match.phase = 'over'; }
    ctx.onState(getState());
    return getState();
  }

  function evaluateVictory(force) {
    const objBlue = objectiveValue(match.board, 'blue');
    const objRed = objectiveValue(match.board, 'red');
    const blueCollapsed = objBlue <= match.startObj.blue * match.cfg.collapseFrac;
    const redCollapsed = objRed <= match.startObj.red * match.cfg.collapseFrac;
    if (blueCollapsed && redCollapsed) { match.winner = objBlue >= objRed ? 'blue' : 'red'; return; }
    if (redCollapsed) { match.winner = 'blue'; return; }
    if (blueCollapsed) { match.winner = 'red'; return; }
    if (force || match.turn > match.cfg.turnLimit) {
      // Time limit: decide by score, then by remaining objective value.
      if (match.score.blue !== match.score.red) match.winner = match.score.blue > match.score.red ? 'blue' : 'red';
      else match.winner = objBlue >= objRed ? 'blue' : 'red';
    }
  }

  // Push board health/status onto the live scenario nodes so the existing 3D / Map /
  // color paths render the game. Returns the set of nodes that changed for animation.
  function syncBoardToGraph() {
    const graph = (window.AppState && window.AppState.activeGraph()) || { nodes: [] };
    (graph.nodes || []).forEach(n => {
      const b = match.board.nodes[n.id];
      if (!b) return;
      n.health = b.health;
      n.status = b.alive ? (n.status === 'Neutralized' ? 'Active' : (n.status || 'Active')) : 'Neutralized';
      if (!b.alive) n.status = 'Neutralized';
    });
  }

  // ---- Serialization (save / load / future network sync) --------------------------
  function serialize() {
    if (!match) return null;
    const health = {};
    for (const id in match.board.nodes) { const n = match.board.nodes[id]; health[id] = { h: n.health, a: n.alive }; }
    return {
      v: 1, seed: match.seed, turn: match.turn, phase: match.phase,
      cfg: match.cfg, score: match.score, startObj: match.startObj,
      orders: match.orders, winner: match.winner, health
    };
  }
  function deserialize(s) {
    if (!s) return null;
    const graph = (window.AppState && window.AppState.activeGraph()) || { nodes: [], links: [] };
    const board = buildBoard(graph);
    if (s.health) for (const id in s.health) { if (board.nodes[id]) { board.nodes[id].health = s.health[id].h; board.nodes[id].alive = s.health[id].a; } }
    match = {
      cfg: Object.assign({}, DEFAULT_CFG, s.cfg), board, seed: s.seed,
      turn: s.turn, phase: s.phase, orders: s.orders || { blue: [], red: [] },
      score: s.score || { blue: 0, red: 0 }, startObj: s.startObj || { blue: objectiveValue(board, 'blue'), red: objectiveValue(board, 'red') },
      history: [], winner: s.winner || null, lastReport: null
    };
    syncBoardToGraph();
    ctx.onState(getState());
    return getState();
  }

  // Restore the scenario graph to exactly what it was before the match began, so
  // entering and leaving the War Game never permanently alters the loaded scenario.
  function endMatch() {
    if (match && match.savedGraphState) {
      const graph = (window.AppState && window.AppState.activeGraph()) || { nodes: [] };
      const byId = {};
      match.savedGraphState.forEach(s => { byId[s.id] = s; });
      (graph.nodes || []).forEach(n => { const s = byId[n.id]; if (s) { n.health = s.health; n.status = s.status; } });
    }
    match = null;
    ctx.onState(null);
  }
  function isActive() { return !!match; }

  return {
    init, newMatch, getState, queueOrder, removeOrder, clearOrders,
    commitTurn, nextTurn, endMatch, isActive, isHuman,
    boardNode, methods, methodKeys, serialize, deserialize,
    // exposed for headless testing / future reuse
    _internal: { buildBoard, resolveTurn, planOrders, makeRng, hashSeed, objectiveValue }
  };
})();
