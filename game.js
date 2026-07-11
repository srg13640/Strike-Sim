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
  // Strike-probability multiplier by target difficulty (higher = easier to hit). Covers every
  // difficulty label present in the shipped scenarios; unknown labels warn once and use 1.0 so
  // future data drift is caught rather than silently treated as Medium.
  const DIFF = {
    Soft: 1.2, Exposed: 1.25, Medium: 1.0, Fixed: 1.0, Mobile: 0.9, Dispersed: 0.9,
    Distributed: 0.85, Camouflaged: 0.85, Hardened: 0.7, Fortified: 0.65, Buried: 0.5,
    Orbital: 0.55, Submerged: 0.5
  };
  const _warnedDiff = {};
  function diffMult(label) {
    if (label != null && DIFF[label] != null) return DIFF[label];
    if (label && !_warnedDiff[label]) { _warnedDiff[label] = true; try { console.warn('[game] unknown difficulty "' + label + '" -> 1.0; add it to DIFF'); } catch (e) {} }
    return 1.0;
  }
  const CASCADE_ALPHA = 0.25;
  const HARDEN_MULT = 0.55;     // incoming strike success multiplier on a hardened node (this turn)
  const REPAIR_AMOUNT = 30;     // health restored by a Repair order at end of turn
  const TEMPO_FLOOR_AP = 2;     // dynamic AP a side bottoms out at when its C2/logistics tempo fully collapses

  // ---- Denial-victory / calendar constants (GAME_DESIGN.md §3, §6 — Increment A) ----
  const TURN_LENGTH_DAYS = 3.5; // command timestep: half-week standing orders [CSIS-FB Ch.3]
  const DDAY_START = 1;         // turn 1 opens on D+1 — the opening salvo is pre-adjudicated [CSIS-FB App. C]
  // Lodgment accumulation (§6): each turn Red's throughput (liftCapacity × OSVI^k, from
  // MoeModule.assessGraph) integrates into a 0..1 lodgment track. LODGMENT_REQ_TURNS is
  // the NOTIONAL number of FULL-throughput 3.5-day turns Red needs to land and sustain a
  // decisive force — an unopposed crossing completes in ~2 weeks, inside the 6-turn
  // fait-accompli window, so the Red win condition is live from day one [METHODOLOGY;
  // ENGSTROM; CSIS-FB Ch.3]. Blue denies by keeping the accumulated track below 1.0 for
  // the whole window (a halt — throughput under MoeModule's tMin — ends it outright).
  const LODGMENT_REQ_TURNS = 4;
  // Horizon projection (§3.5): seeded MC continuation trials run when the hard clock
  // expires undecided. Sized to stay interactive (~trials × horizon resolveTurn calls).
  const PROJECTION_TRIALS = 200;
  const PROJECTION_HORIZON_TURNS = 6;
  function ddayForTurn(turn) { return DDAY_START + (turn - 1) * TURN_LENGTH_DAYS; }

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
  // C1–C3 configuration. Values are explicit NOTIONAL game assumptions; strategic-state.js
  // owns transition math. Scenarios may override this object without changing the resolver.
  const ROE_OPTIONS = Object.freeze({
    denial: Object.freeze({
      id: 'denial', label: 'Denial / no mainland strikes before E6',
      description: 'Contest the crossing first. PRC-mainland strikes unlock at escalation 6; orbital strikes at 7.',
      defaultDecision: 'allow',
      rules: [
        { id: 'no-mainland-before-e6', appliesTo: { sides: ['blue'], actionKinds: ['strike'], targetTagsAny: ['prc-mainland'] }, require: { minEscalation: 6 }, message: 'Declared ROE withholds PRC-mainland strikes until E ≥ 6.' },
        { id: 'no-space-before-e7', appliesTo: { sides: ['blue'], actionKinds: ['strike'], targetTagsAny: ['space-asset'] }, require: { minEscalation: 7 }, message: 'Declared ROE withholds attacks on orbital systems until E ≥ 7.' }
      ]
    }),
    measured: Object.freeze({
      id: 'measured', label: 'Measured response / mainland at E4',
      description: 'Broader punishment authority: PRC-mainland strikes unlock at 4; orbital strikes at 6.',
      defaultDecision: 'allow',
      rules: [
        { id: 'mainland-at-e4', appliesTo: { sides: ['blue'], actionKinds: ['strike'], targetTagsAny: ['prc-mainland'] }, require: { minEscalation: 4 }, message: 'Declared ROE withholds PRC-mainland strikes until E ≥ 4.' },
        { id: 'space-at-e6', appliesTo: { sides: ['blue'], actionKinds: ['strike'], targetTagsAny: ['space-asset'] }, require: { minEscalation: 6 }, message: 'Declared ROE withholds attacks on orbital systems until E ≥ 6.' }
      ]
    }),
    unrestricted: Object.freeze({
      id: 'unrestricted', label: 'Unrestricted conventional response',
      description: 'All modeled conventional targets are authorized; escalation costs still apply.',
      defaultDecision: 'allow', rules: []
    })
  });
  const STRATEGIC_DEFAULTS = Object.freeze({
    escalation: { initial: 1.5, min: 0, max: 10 },
    activationGroups: { base: true, 'japan-entry': false, 'us-enablers': false },
    allies: {
      japan: { id: 'Japan', entryThreshold: 4.5, exitThreshold: 2.5, entryResetThreshold: 3.0, exitResetThreshold: 5.0, entryProbability: 0.68, exitProbability: 0.30, activateGroups: ['japan-entry'] },
      usEnablers: { id: 'US enablers', entryThreshold: 3.0, exitThreshold: 1.5, entryResetThreshold: 2.0, exitResetThreshold: 3.5, entryProbability: 0.82, exitProbability: 0.20, activateGroups: ['us-enablers'] }
    }
  });
  const METHOD_RESOURCE_KEYS = {
    kinetic: ['kinetic'],
    cyber: ['cyber'],
    ew: ['ew'],
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

  function strategicModule() {
    if (!window.StrategicStateModule) throw new Error('StrategicStateModule is required for escalation, ROE, and indicators.');
    return window.StrategicStateModule;
  }

  function strategicConfig(overrides) {
    overrides = overrides || {};
    const escalation = Object.assign({}, STRATEGIC_DEFAULTS.escalation, overrides.escalation || {});
    const activationGroups = Object.assign({}, STRATEGIC_DEFAULTS.activationGroups, overrides.activationGroups || {});
    const allies = {};
    Object.keys(STRATEGIC_DEFAULTS.allies).forEach(id => {
      allies[id] = Object.assign({}, STRATEGIC_DEFAULTS.allies[id], overrides.allies && overrides.allies[id] || {});
    });
    Object.keys(overrides.allies || {}).forEach(id => {
      if (!allies[id]) allies[id] = Object.assign({}, overrides.allies[id]);
    });
    return { escalation, activationGroups, allies, indicators: Object.assign({}, overrides.indicators || {}), signals: Object.assign({}, overrides.signals || {}) };
  }

  function selectedRoe(value) {
    if (value && typeof value === 'object') return JSON.parse(JSON.stringify(value));
    return JSON.parse(JSON.stringify(ROE_OPTIONS[String(value || 'denial')] || ROE_OPTIONS.denial));
  }

  function orderCost(order) {
    if (!order) return 0;
    if (order.kind === 'decoy') return 0;
    return 1;
  }

  function resourceGenByType(node) {
    const r = node.resourceGenByType || {};
    // Board nodes already carry the canonical four-key object. Fast-path it because AI
    // candidate generation asks this question thousands of times per operation.
    if (Object.prototype.hasOwnProperty.call(r, 'kinetic') &&
        Object.prototype.hasOwnProperty.call(r, 'cyber') &&
        Object.prototype.hasOwnProperty.call(r, 'ew') &&
        Object.prototype.hasOwnProperty.call(r, 'sof')) {
      return { kinetic: Number(r.kinetic || 0), cyber: Number(r.cyber || 0), ew: Number(r.ew || 0), sof: Number(r.sof || 0) };
    }
    const domains = (Array.isArray(node.domain) ? node.domain : [node.domain])
      .map(d => String(d || '').toLowerCase());
    const descriptor = [node.type, node.name].map(v => String(v || '').toLowerCase()).join(' ');
    const cyberRole = domains.includes('cyber') || descriptor.includes('cyber') || descriptor.includes('network operations');
    const ewRole = domains.includes('ew') || descriptor.includes('electronic') || descriptor.includes('spectrum');
    const hasCanonicalCyber = Object.prototype.hasOwnProperty.call(r, 'cyber');
    const legacyJam = Number(r.jam ?? r.jamming ?? 0);
    return {
      kinetic: Number(r.kinetic || 0),
      cyber: Number(hasCanonicalCyber ? r.cyber : (cyberRole ? legacyJam : 0)),
      ew: Number(hasCanonicalCyber
        ? (r.ew ?? r.jam ?? r.jamming ?? 0)
        : (ewRole ? Math.max(Number(r.ew || 0), legacyJam) : Number(r.ew || 0))),
      sof: Number(r.sof || 0)
    };
  }

  function resourceForMethod(node, methodKey) {
    const keys = METHOD_RESOURCE_KEYS[methodKey] || [];
    const r = resourceGenByType(node);
    return keys.reduce((sum, key) => sum + Number(r[key] || 0), 0);
  }

  function canSourceStrike(node) {
    if (!node || !node.alive) return false;
    const subsystem = String(node.subsystem || '').toLowerCase();
    if (subsystem.includes('logistics') || subsystem.includes('sustainment')) return false;
    return METHOD_KEYS.some(k => resourceForMethod(node, k) > 0);
  }

  // Can this specific node serve as a firing source for the given method? A valid source
  // must be a living, non-logistics node that actually generates the resource the method
  // consumes (kinetic -> kinetic, cyber -> cyber, EW -> EW, SOF -> SOF). This is the
  // per-node half of the authoritative "can side S strike with method M?" rule (C-003).
  // `aliveFn(node)` overrides the liveness test so the resolver can read START-of-turn
  // liveness (a source killed this same turn still fires — preserves simultaneity).
  function canSourceStrikeWith(node, methodKey, aliveFn) {
    if (!node) return false;
    const live = aliveFn ? aliveFn(node) : node.alive;
    if (!live || node.active === false) return false;
    const subsystem = String(node.subsystem || '').toLowerCase();
    if (subsystem.includes('logistics') || subsystem.includes('sustainment')) return false;
    return resourceForMethod(node, methodKey) > 0;
  }

  // Every friendly node that could fire the given method, best first. Returned in a
  // deterministic order (resource desc, then id) so source selection / availability checks
  // are reproducible across machines even before per-target affinity weighting is applied.
  function sourcesForMethod(board, side, methodKey, aliveFn) {
    return (board.rosters[side] || [])
      .map(id => board.nodes[id])
      .filter(n => canSourceStrikeWith(n, methodKey, aliveFn))
      .sort((a, b) => (resourceForMethod(b, methodKey) - resourceForMethod(a, methodKey)) ||
        String(a.id).localeCompare(String(b.id)));
  }

  // AUTHORITATIVE availability rule (C-003): may `side` strike `targetId` with `methodKey`
  // on `board`? Used identically by order queueing/validation, the AI commander, and the
  // resolver so the UI, AI, and combat math can never disagree about what is a legal order.
  //  - method must be a real strike method
  //  - target must exist, be alive, and belong to the enemy
  //  - the side must field at least one surviving valid firing source for that method
  //  - if a specific sourceId is named, that source must itself be valid (alive, right
  //    resource) and on the firing side — voiding stale/destroyed/spoofed sources.
  // `opts.aliveFn` overrides the liveness test (resolver passes start-of-turn liveness).
  // Returns a structured {ok, reason, sourceId} so callers can surface *why* an order is
  // illegal and learn which source was assigned to a source-less (human) order.
  function authorizeOrderBoard(board, order) {
    if (!board || !board.strategic || !window.StrategicStateModule) return { ok: true, reason: 'ok' };
    const target = board.nodes[order && order.targetId];
    return strategicModule().authorizeOrder(order, {
      side: order && order.side,
      target,
      escalation: board.strategic.escalation && board.strategic.escalation.value,
      activation: board.strategic.activation
    }, board.strategic.roe);
  }

  function canStrikeBoard(board, side, targetId, methodKey, sourceId, opts) {
    const aliveFn = opts && opts.aliveFn;
    const tgtLive = (n) => aliveFn ? aliveFn(n) : n.alive;
    if (!board) return { ok: false, reason: 'no-board' };
    if (side !== 'blue' && side !== 'red') return { ok: false, reason: 'bad-side' };
    if (!METHODS[methodKey]) return { ok: false, reason: 'bad-method' };
    const tgt = board.nodes[targetId];
    if (!tgt) return { ok: false, reason: 'no-target' };
    if (tgt.active === false) return { ok: false, reason: 'target-inactive' };
    if (!tgtLive(tgt)) return { ok: false, reason: 'target-dead' };
    if (tgt.team === side) return { ok: false, reason: 'friendly-target' };
    const roe = authorizeOrderBoard(board, { side, kind: 'strike', methodKey, targetId, sourceId: sourceId || null });
    if (!roe.ok) return { ok: false, reason: roe.reason, ruleId: roe.ruleId, message: roe.message };
    if (sourceId != null) {
      const src = board.nodes[sourceId];
      if (!src || src.team !== side) return { ok: false, reason: 'source-not-friendly' };
      if (!canSourceStrikeWith(src, methodKey, aliveFn)) return { ok: false, reason: 'source-cannot-fire' };
      return { ok: true, reason: 'ok', sourceId: src.id };
    }
    // Human orders usually omit sourceId. Assign the strongest target-relevant source,
    // not merely the alphabetically first high-capacity node, so a Joint Force actually
    // employs maritime, air, land, cyber, and spectrum contributors where they fit.
    // Equal-scoring sources use a target-bound stable hash: the same target always gets
    // the same source, while equivalent service packages can share the theater workload.
    const src = sourcesForMethod(board, side, methodKey, aliveFn)
      .map(n => ({
        n,
        score: resourceForMethod(n, methodKey) * affinity(n, tgt, methodKey),
        tie: hashSeed('source', side, methodKey, tgt.id, n.id)
      }))
      .sort((a, b) => b.score - a.score || b.tie - a.tie || String(a.n.id).localeCompare(String(b.n.id)))[0]?.n;
    if (!src) return { ok: false, reason: 'no-source' };
    return { ok: true, reason: 'ok', sourceId: src.id };
  }

  // Human-readable reason for a voided strike, for the resolved-turn event log.
  const VOID_TEXT = {
    'bad-method': 'unknown strike method', 'no-target': 'target not found',
    'target-dead': 'target already down', 'target-inactive': 'target is outside the active posture', 'friendly-target': 'cannot strike own forces',
    'source-not-friendly': 'firing source is not a surviving friendly unit',
    'source-cannot-fire': 'firing source cannot deliver this method',
    'no-source': 'no surviving unit can deliver this strike',
    'roe-min-escalation': 'declared ROE threshold has not been crossed',
    'roe-max-escalation': 'declared ROE ceiling would be exceeded',
    'roe-denied': 'declared ROE prohibits this strike',
    'roe-default-deny': 'declared ROE does not authorize this strike'
  };
  function voidText(reason) { return VOID_TEXT[reason] || 'invalid order'; }

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

  // ---- Command-tempo economy ------------------------------------------------------
  // The force network drives operational tempo: surviving command, logistics, and relay
  // nodes generate the action points a side can spend each turn. Degrade an enemy's C2 /
  // sustainment and you throttle how many orders they can issue — making decapitation a
  // real strategy alongside raw attrition. Pure + deterministic (read-only over board).
  function nodeTempoRole(n) {
    // Authored scenarios can state the tempo relationship directly. This prevents a
    // generic label such as "Support" (or a mixed joint-function subsystem name) from
    // silently turning every protection or cyber node into a logistics asset.
    if (n && ['command', 'logistics', 'relay', 'none'].includes(n.tempoRole)) {
      return n.tempoRole === 'none' ? null : n.tempoRole;
    }
    const ty = String(n.type || '').toLowerCase();
    const sub = String(n.subsystem || '').toLowerCase();
    if (ty.includes('command') || sub.includes('command')) return 'command';
    if (ty.includes('logist') || ty.includes('support') || sub.includes('logist') || sub.includes('sustain')) return 'logistics';
    if (ty.includes('relay') || ty.includes('comm')) return 'relay';
    return null;
  }
  const TEMPO_W = { command: 1.0, logistics: 0.7, relay: 0.45 };
  function commandTempo(board, side) {
    let v = 0;
    (board.rosters[side] || []).forEach(id => {
      const n = board.nodes[id];
      if (!n || !n.alive) return;
      const role = nodeTempoRole(n);
      if (!role) return;
      v += TEMPO_W[role] * (n.health / (n.healthMax || 100));
    });
    return v;
  }
  function tempoCounts(board, side) {
    let c2 = 0, logi = 0, relay = 0;
    (board.rosters[side] || []).forEach(id => {
      const n = board.nodes[id];
      if (!n || !n.alive) return;
      const role = nodeTempoRole(n);
      if (role === 'command') c2++;
      else if (role === 'logistics') logi++;
      else if (role === 'relay') relay++;
    });
    return { c2, logi, relay };
  }
  // How much the AI should prize hitting / protecting a tempo node.
  function tempoWeightOf(n) { const r = nodeTempoRole(n); return r ? TEMPO_W[r] : 0; }

  // Lodgment-critical weight of an own node for Red's protective scoring (GAME_DESIGN
  // §10 Increment A): amphibious lift (Assault) is the throughput multiplicand and
  // sustainment keeps the lodgment supplied. Mirrors moe.js classify()'s mapping
  // (Assault -> lift, Logistics -> sustain) without a cross-module dependency, so the
  // AI stays deterministic and self-contained even when MoeModule is absent.
  function lodgmentWeightOf(n) {
    const ty = String(n.type || '').toLowerCase();
    const sub = String(n.subsystem || '').toLowerCase();
    if (ty.includes('assault') || sub.includes('assault')) return 1.0;
    if (ty.includes('logist') || sub.includes('logist') || sub.includes('sustain')) return 0.7;
    return 0;
  }

  // ---- Key objectives (hold / deny) -----------------------------------------------
  // Each side has a set of designated key nodes — its highest-value systems. Holding
  // yours and denying (destroying) the enemy's is a win condition in its own right, so
  // the game rewards taking key terrain / decapitating the network, not just attrition.
  const OBJ_COUNT = 8;
  const OBJ_LOSS_FRAC = 0.25;   // a side is defeated if it holds <= 25% of its objectives
  // Designate objectives by value × survivability (value / strike-difficulty) so each side
  // picks its most DEFENSIBLE crown jewels — not just its highest-value but most-exposed
  // nodes. This keeps the "deny the enemy's key terrain" win condition a two-way contest
  // instead of a near-automatic loss for whichever side fields softer high-value units.
  function objectiveScore(n) { return nodeValue(n) / diffMult(n.difficulty); }
  function pickObjectives(board, side) {
    return (board.rosters[side] || [])
      .map(id => board.nodes[id])
      .filter(n => n && n.alive && n.scenarioEnabled !== false &&
        n.availability !== 'conditional-partner' && n.availability !== 'commercial-contract')
      .sort((a, b) => objectiveScore(b) - objectiveScore(a))
      .slice(0, OBJ_COUNT).map(n => n.id);
  }

  // ---- Scenario fingerprint (save/resume integrity) -------------------------------
  // A stable, order-independent hash of the scenario's COMBAT IDENTITY — node roster and
  // the per-node fields that determine how a match plays, plus link topology. It deliberately
  // EXCLUDES transient state (health/status) so the same scenario fingerprints identically
  // before and after a match. Saves embed this so a resume/launch can detect that the active
  // graph is not the graph the match was built on (C-011) instead of silently replaying
  // against different node/link/combat data. Pure + deterministic.
  function fingerprintParts(graph) {
    graph = graph || { nodes: [], links: [] };
    const nodeSigs = (graph.nodes || [])
      .filter(n => { const t = n.team || n.originalTeam; return t === 'blue' || t === 'red'; })
      .map(n => {
        const team = n.team || n.originalTeam;
        const dom = Array.isArray(n.domain) ? n.domain.slice().sort() : (n.domain ? [n.domain] : []);
        const vuln = Array.isArray(n.vulnerabilities) ? n.vulnerabilities.slice().sort() : [];
        const rg = resourceGenByType(n);
        const escalationTags = Array.isArray(n.escalationTags) ? n.escalationTags.slice().sort() : [];
        return [
          n.id, team, (n.type || ''), (n.subsystem || ''), (n.difficulty || 'Medium'),
          Number(n.importance || 5), Math.max(1, Number(n.cascScore || 1)), Number(n.healthMax || 100),
          n.scenarioEnabled === false ? 0 : 1, dom.join('|'), vuln.join('|'),
          rg.kinetic, rg.cyber, rg.ew, rg.sof, n.nation || '', n.geographyClass || '',
          escalationTags.join('|'), n.activationGroup || 'base'
        ].join(',');
      })
      .sort();   // order-independent across node array ordering
    const linkSigs = (graph.links || [])
      .map(l => {
        const s = (l.source && l.source.id != null) ? l.source.id : l.source;
        const t = (l.target && l.target.id != null) ? l.target.id : l.target;
        return [String(s), String(t)].sort().join('->');   // undirected, endpoint-order-independent
      })
      .sort();
    return { nodeSigs, linkSigs };
  }
  function computeFingerprint(graph) {
    const parts = fingerprintParts(graph);
    const hash = hashSeed('fp1', parts.nodeSigs.join(';'), '||', parts.linkSigs.join(';'));
    // Return both a compact hash (for fast equality) and counts (for human-readable mismatch
    // diagnostics in the UI). Versioned so the scheme can evolve without false matches.
    return { v: 1, hash, nodes: parts.nodeSigs.length, links: parts.linkSigs.length };
  }
  function fingerprintsMatch(a, b) {
    if (!a || !b) return false;
    return a.v === b.v && a.hash === b.hash && a.nodes === b.nodes && a.links === b.links;
  }

  // ---- Board construction ---------------------------------------------------------
  // A board is a pure, serializable snapshot: per-node combat fields + health/alive,
  // adjacency, and the team rosters. It is the single source of truth a match mutates.
  function buildBoard(graph) {
    graph = graph || { nodes: [], links: [] };
    const nodes = {};
    const rosters = { blue: [], red: [] };
    const reserves = { blue: [], red: [] };
    (graph.nodes || []).forEach(n => {
      const team = n.team || (n.originalTeam || null);
      if (team !== 'blue' && team !== 'red') return;   // only the two combatant sides play
      const healthMax = n.healthMax || 100;
      const active = n.scenarioEnabled !== false;
      nodes[n.id] = {
        id: n.id,
        name: n.name || n.id,
        team,
        difficulty: n.difficulty || 'Medium',
        vulns: Array.isArray(n.vulnerabilities) ? n.vulnerabilities.slice() : [],
        casc: Math.max(1, Number(n.cascScore || 1)),
        importance: Number(n.importance || 5),
        subsystem: n.subsystem || '',
        tempoRole: n.tempoRole || null,
        nation: n.nation || '',
        serviceOwner: n.serviceOwner || n.component || '',
        component: n.component || n.serviceOwner || '',
        jointFunction: n.jointFunction || '',
        operationalRole: n.operationalRole || '',
        availability: n.capabilityProfile && n.capabilityProfile.availability || n.availability || 'scenario-active',
        scenarioEnabled: active,
        active,
        activationGroup: n.activationGroup || (active ? 'base' : 'reserve'),
        geographyClass: n.geographyClass || '',
        escalationTags: Array.isArray(n.escalationTags) ? n.escalationTags.slice() : [],
        indicatorTags: Object.assign({}, n.indicatorTags || {}),
        resourceGenByType: resourceGenByType(n),
        baseResourceGenByType: resourceGenByType(n),
        potentialResourceGenByType: resourceGenByType(n.capabilityProfile && n.capabilityProfile.potentialResourceGenByType
          ? { resourceGenByType: n.capabilityProfile.potentialResourceGenByType, domain: n.domain, type: n.type, name: n.name }
          : n),
        domain: Array.isArray(n.domain) ? n.domain.slice() : (n.domain ? [n.domain] : []),
        type: n.type || '',
        healthMax,
        health: n.status === 'Neutralized' ? 0 : (n.health == null ? healthMax : n.health),
        alive: n.status !== 'Neutralized'
      };
      (active ? rosters : reserves)[team].push(n.id);
    });
    const adj = {};
    (graph.links || []).forEach(l => {
      const s = (l.source && l.source.id != null) ? l.source.id : l.source;
      const t = (l.target && l.target.id != null) ? l.target.id : l.target;
      if (nodes[s] == null || nodes[t] == null) return;
      (adj[s] = adj[s] || []).push(t);
      (adj[t] = adj[t] || []).push(s);
    });
    return { nodes, adj, rosters, reserves };
  }

  // Effective combat power of a side = sum of each living node's force value WEIGHTED BY its
  // current health fraction (C-010). This is the single scoring/collapse currency used
  // everywhere — score deltas, collapse checks, the HUD's objNow, and the AAR — so the game
  // is internally consistent: suppressing a high-value node to 1 HP credits the attacker and
  // pushes the enemy toward collapse, exactly as the tempo model (which is health-weighted)
  // already behaves. A neutralized node contributes 0. (Key-objective hold/deny remains
  // kill-based — terrain is held until the node is dead — and is computed separately.)
  function objectiveValue(board, team) {
    let v = 0;
    board.rosters[team].forEach(id => {
      const n = board.nodes[id];
      if (!n || !n.alive) return;
      const frac = clamp((n.health || 0) / (n.healthMax || 100), 0, 1);
      v += nodeValue(n) * frac;
    });
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
    const rank = { feint: -2, decoy: -1, harden: 0, repair: 1, strike: 2 };
    const sorted = orders.slice().sort((a, b) =>
      (rank[a.kind] - rank[b.kind]) ||
      String(a.side).localeCompare(String(b.side)) ||
      String(a.targetId).localeCompare(String(b.targetId)) ||
      String(a.methodKey || '').localeCompare(String(b.methodKey || '')));

    // Signal orders are costly declarations but have no board effect. They remain in the
    // stable resolver sequence and AAR rather than being processed by a shadow engine.
    for (const o of sorted) {
      if (o.kind !== 'feint' && o.kind !== 'decoy') continue;
      events.push({ side: o.side, kind: 'signal', signalKind: o.kind, targetId: o.targetId || null,
        assessedDeceptive: !!o.assessedDeceptive, axis: o.axis || null, targetClass: o.targetClass || null,
        text: `${o.side.toUpperCase()} emitted a ${o.kind} toward ${o.axis || 'an unresolved axis'} (${o.targetClass || 'key systems'}).` });
    }

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
    const hitMeta = {};
    for (const o of sorted) {
      if (o.kind !== 'strike') continue;
      const tgt = board.nodes[o.targetId];
      // AUTHORITATIVE availability gate (C-003): the resolver re-validates every strike
      // against the start-of-turn board with the SAME rule the UI/AI used. It also resolves
      // a concrete firing source — honoring an explicitly-named one, else picking the best
      // surviving valid source — and VOIDS the order (no damage) if none exists. The aliveFn
      // reads START-of-turn liveness so a source killed this same turn still fires (true
      // simultaneity), matching how target liveness is read below.
      const avail = canStrikeBoard(board, o.side, o.targetId, o.methodKey, o.sourceId,
        { aliveFn: (n) => !!startAlive[n.id] });
      if (!avail.ok) {
        events.push({ side: o.side, kind: 'void', targetId: o.targetId, sourceId: o.sourceId || null,
          reason: avail.reason, text: 'Order voided (' + voidText(avail.reason) + ').' });
        continue;
      }
      const resolvedSource = avail.sourceId || null;
      const m = METHODS[o.methodKey] || METHODS.kinetic;
      let p = m.baseProb * diffMult(tgt.difficulty) * vulnMult(tgt, m);
      if (hardened.has(o.targetId)) p *= HARDEN_MULT;
      p = clamp(p, 0.05, 0.98);
      const hit = rng.next() < p;
      if (hit) {
        const d = m.dmg[0] + rng.next() * (m.dmg[1] - m.dmg[0]);
        dmg[o.targetId] = (dmg[o.targetId] || 0) + d;
        if (!hitMeta[o.targetId] || d > hitMeta[o.targetId].damage) {
          hitMeta[o.targetId] = { method: o.methodKey, sourceId: resolvedSource, damage: d };
        }
        const actual = Math.min(startHealth[o.targetId] || tgt.healthMax || 100, d);
        events.push({ side: o.side, kind: 'hit', method: o.methodKey, targetId: o.targetId,
          sourceId: resolvedSource, damage: actual, probability: p,
          text: `${o.side.toUpperCase()} ${m.label} hit ${tgt.name} (-${Math.round(d)})${hardened.has(o.targetId) ? ' [hardened]' : ''}.` });
      } else {
        events.push({ side: o.side, kind: 'miss', method: o.methodKey, targetId: o.targetId,
          sourceId: resolvedSource, probability: p,
          text: `${o.side.toUpperCase()} ${m.label} missed ${tgt.name}.` });
      }
    }

    // Apply accumulated damage; detect this-turn kills.
    const kills = [];
    for (const id in dmg) {
      const n = board.nodes[id];
      if (!startAlive[id]) continue;
      n.health = Math.max(0, n.health - dmg[id]);
      if (n.health <= 0 && n.alive) {
        const meta = hitMeta[id] || {};
        n.alive = false;
        kills.push(id);
        events.push({ side: enemyOf(n.team), kind: 'kill', targetId: id, sourceId: meta.sourceId || null, method: meta.method || null, text: `${n.name} NEUTRALIZED.` });
      }
    }

    // Single-level cascades radiating from this-turn kills.
    for (const id of kills) {
      const src = board.nodes[id];
      const neigh = board.adj[id] || [];
      for (const nid of neigh) {
        const nn = board.nodes[nid];
        if (!nn || !nn.alive) continue;
        const cd = 5 * (src.casc || 1) * Math.max(0.5, src.importance || 5) / 5 * CASCADE_ALPHA * affinity(src, nn);
        const before = nn.health;
        nn.health = Math.max(0, nn.health - cd);
        if (nn.health <= 0 && nn.alive) {
          nn.alive = false;
          events.push({ side: enemyOf(nn.team), kind: 'cascade', targetId: nid, sourceId: id, damage: Math.min(before, cd), text: `Cascade from ${src.name} took down ${nn.name}.` });
        }
      }
    }

    // End-of-turn repairs (offset damage taken this turn on surviving own nodes).
    for (const o of repairs) {
      const n = board.nodes[o.targetId];
      if (n && n.alive) {
        const before = n.health;
        n.health = Math.min(n.healthMax, n.health + (cfg.repairAmount || REPAIR_AMOUNT));
        if (n.health > before) events.push({ side: o.side, kind: 'repair', targetId: o.targetId, amount: n.health - before, text: `${n.name} repaired (+${Math.round(n.health - before)}).` });
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
  // UNCLASSIFIED // NOTIONAL RESEARCH TOOL
  //
  // planOrders is the level-0 policy generator. Its fourth argument is now a named
  // policy object; legacy difficulty strings still map to the balanced policy. The
  // bounded level-k wrapper below generates a small restricted plan set and evaluates
  // it only by cloning the board and calling resolveTurn — never by forking combat.
  function redMind() {
    if (!window.RedMindModule) throw new Error('red-mind.js must load before game.js');
    return window.RedMindModule;
  }

  function normalizePlanPolicy(input) {
    const mind = redMind();
    if (input && typeof input === 'object' && input.target && input.methods) return input;
    const key = String(input || '').toLowerCase();
    if (mind.DOCTRINES[key]) return mind.doctrine(key);
    // Back-compat: easy/hard/elite described reasoning depth, not a doctrine.
    return mind.BALANCED;
  }

  const plannerSourcePoolCache = new WeakMap();
  function plannerSourcePools(board, side) {
    let cache = plannerSourcePoolCache.get(board);
    if (!cache) { cache = {}; plannerSourcePoolCache.set(board, cache); }
    if (!cache[side]) {
      cache[side] = {};
      METHOD_KEYS.forEach(k => { cache[side][k] = sourcesForMethod(board, side, k); });
    }
    return cache[side];
  }

  function sourceForMethod(board, side, methodKey, target, rng, pools) {
    // Pick from the SAME validated source pool the availability rule (canStrikeBoard) and
    // resolver use, then weight by affinity to the target so the AI fires from its best
    // platform. Stable ID tie-breaking replaces cosmetic RNG jitter: candidate diversity
    // should come from policy, not from which equivalent launcher gets named.
    return ((pools && pools[methodKey]) || sourcesForMethod(board, side, methodKey))
      .filter(n => n && n.alive)
      .map(n => ({
        n,
        score: resourceForMethod(n, methodKey) * affinity(n, target, methodKey)
      }))
      .sort((a, b) => (b.score - a.score) || String(a.n.id).localeCompare(String(b.n.id)))[0]?.n || null;
  }

  function sideStrikeCapacity(board, side) {
    return board.rosters[side]
      .map(id => board.nodes[id])
      .filter(canSourceStrike)
      .reduce((sum, n) => sum + METHOD_KEYS.reduce((s, k) => s + resourceForMethod(n, k), 0), 0);
  }

  function postureSupportCount(board, side) {
    return board.rosters[side]
      .map(id => board.nodes[id])
      .filter(n => n && n.alive)
      .filter(n => (n.tempoRole && n.tempoRole !== 'none') ||
        /command|sustainment|logistics|enabler|coalition/i.test(n.subsystem || ''))
      .length;
  }

  function resourceAp(board, side, fallback) {
    const strikeBand = sideStrikeCapacity(board, side) >= 220 ? 1 : 0;
    const postureBand = postureSupportCount(board, side) >= 30 ? 1 : 0;
    return clamp(4 + strikeBand + postureBand, Math.max(3, fallback - 1), 6);
  }

  function planOrders(board, side, ap, policy, rng) {
    const orders = [];
    const foe = enemyOf(side);
    const p = normalizePlanPolicy(policy);
    const targetW = p.target || {};
    const methodW = p.methods || {};
    const sourcePools = plannerSourcePools(board, side);

    function subsystemFlag(n, pattern) { return pattern.test(String(n.subsystem || '') + ' ' + String(n.type || '')); }
    function targetScore(n) {
      const healthFrac = clamp((n.health || 0) / (n.healthMax || 100), 0, 1);
      const command = subsystemFlag(n, /command|c2|headquarters/i) ? 1 : 0;
      const logistics = subsystemFlag(n, /logistics|sustain|lift|sealift|port/i) ? 1 : 0;
      const fires = subsystemFlag(n, /firepower|fires|strike|missile|air defense|sam/i) ? 1 : 0;
      const multiplier = 1 +
        Number(targetW.tempo || 0) * tempoWeightOf(n) +
        Number(targetW.command || 0) * command +
        Number(targetW.logistics || 0) * logistics +
        Number(targetW.fires || 0) * fires +
        Number(targetW.damaged || 0) * (1 - healthFrac);
      // Counter-lift is time-critical rather than merely another value multiplier.
      // An additive policy bonus lets a low-value exposed landing element outrank a
      // hardened headquarters when the denial clock—not attrition—is decisive.
      const lodgmentUrgency = Number(targetW.lodgment || 0) * lodgmentWeightOf(n) * 12;
      return (nodeValue(n) * multiplier + lodgmentUrgency) * diffMult(n.difficulty);
    }

    const enemies = board.rosters[foe]
      .map(id => board.nodes[id])
      .filter(n => n && n.alive)
      .map(n => ({ n, score: targetScore(n) }))
      .sort((a, b) => (b.score - a.score) || String(a.n.id).localeCompare(String(b.n.id)));

    const bestMethodFor = (n) => {
      // Prefer a doctrine-weighted method the target is vulnerable to; stable method-key
      // and source-ID tie-breaks make identical inputs byte-for-byte reproducible.
      let best = null, bestEV = -1, bestSource = null;
      for (const k of METHOD_KEYS) {
        const source = sourceForMethod(board, side, k, n, rng, sourcePools);
        if (!source) continue;
        const m = METHODS[k];
        const ev = m.baseProb * diffMult(n.difficulty) * vulnMult(n, m) * ((m.dmg[0] + m.dmg[1]) / 2) *
          Math.sqrt(resourceForMethod(source, k)) * Number(methodW[k] == null ? 1 : methodW[k]);
        if (ev > bestEV || (ev === bestEV && String(k).localeCompare(String(best || '')) < 0)) {
          bestEV = ev; best = k; bestSource = source;
        }
      }
      return { k: best, source: bestSource };
    };

    const strikeAP = clamp(Math.round(ap * Number(p.strikeShare == null ? 0.7 : p.strikeShare)), 1, ap);
    let used = 0;
    for (const e of enemies) {
      if (used >= strikeAP) break;
      const focus = used === 0 ? clamp(Math.round(Number(p.focusFire || 1)), 1, 3) : 1;
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
      const protectW = p.protect || {};
      const protVal = (n) => nodeValue(n) * (1 + Number(protectW.tempo || 0) * tempoWeightOf(n)) +
        (side === 'red' ? Number(protectW.lodgment || 0) * lodgmentWeightOf(n) * 30 * diffMult(n.difficulty) : 0);
      const damaged = own.filter(n => n.health < n.healthMax * 0.8)
        .sort((a, b) => (protVal(b) * (1 - b.health / b.healthMax)) - (protVal(a) * (1 - a.health / a.healthMax)) || String(a.id).localeCompare(String(b.id)));
      const healthy = own.slice().sort((a, b) => (protVal(b) - protVal(a)) || String(a.id).localeCompare(String(b.id)));
      while (remaining > 0) {
        const repairValue = damaged.length ? protVal(damaged[0]) * Number(p.repairBias == null ? 0.6 : p.repairBias) : -1;
        const hardenValue = healthy.length ? protVal(healthy[0]) * (1 - Number(p.repairBias == null ? 0.6 : p.repairBias)) : -1;
        if (damaged.length && repairValue >= hardenValue) {
          orders.push({ side, kind: 'repair', targetId: damaged.shift().id });
        } else if (healthy.length) {
          orders.push({ side, kind: 'harden', targetId: healthy.shift().id });
        } else break;
        remaining--;
      }
    }
    return orders;
  }

  function cloneBoardForAi(board) {
    const nodes = {};
    for (const id in board.nodes) nodes[id] = Object.assign({}, board.nodes[id]);
    return {
      nodes, adj: board.adj,
      rosters: { blue: (board.rosters.blue || []).slice(), red: (board.rosters.red || []).slice() },
      reserves: { blue: (board.reserves && board.reserves.blue || []).slice(), red: (board.reserves && board.reserves.red || []).slice() },
      strategic: board.strategic || null
    };
  }

  function resetBoardForAi(target, source) {
    for (const id in source.nodes) {
      const dst = target.nodes[id], src = source.nodes[id];
      if (!dst || !src) continue;
      dst.health = src.health;
      dst.alive = src.alive;
    }
    return target;
  }

  function planHeuristic(board, side, orders, policy) {
    const p = normalizePlanPolicy(policy);
    return orders.reduce((sum, o) => {
      const n = board.nodes[o.targetId];
      if (!n) return sum;
      if (o.kind === 'strike') {
        const m = METHODS[o.methodKey] || METHODS.kinetic;
        return sum + nodeValue(n) * m.baseProb * diffMult(n.difficulty) *
          Number((p.methods && p.methods[o.methodKey]) || 1);
      }
      return sum + nodeValue(n) * (o.kind === 'repair' ? Number(p.repairBias || 0.6) : 1 - Number(p.repairBias || 0.6));
    }, 0);
  }

  function scoreAiRollout(board, side, ownPlan, opponentPlan, cfg, policy, rng, operational) {
    const local = cloneBoardForAi(board);
    const beforeTempo = { blue: commandTempo(local, 'blue'), red: commandTempo(local, 'red') };
    const report = resolveTurn(local, ownPlan.concat(opponentPlan), cfg, rng);
    const p = normalizePlanPolicy(policy);
    const u = p.utility || {};
    const enemyLoss = report.scoreDelta[side] || 0;
    const ownLoss = report.scoreDelta[enemyOf(side)] || 0;
    const assessment = operational === false ? null
      : operational && operational.units && window.MoeModule && window.MoeModule.assessCompiled
        ? window.MoeModule.assessCompiled(operational, local.nodes)
        : assessDenialOn(local);
    const throughput = assessment ? Number(assessment.throughput || 0) : 0.5;
    const tempoDelta = (commandTempo(local, enemyOf(side)) - beforeTempo[enemyOf(side)]) -
      (commandTempo(local, side) - beforeTempo[side]);
    const throughputUtility = assessment ? (side === 'red' ? throughput : (1 - throughput)) : 0;
    const utility =
      Number(u.enemyLoss == null ? 1 : u.enemyLoss) * enemyLoss -
      Number(u.ownLoss == null ? 1 : u.ownLoss) * ownLoss +
      Number(u.throughput == null ? 0.65 : u.throughput) * throughputUtility * 25 -
      Number(u.tempo == null ? 0.35 : u.tempo) * tempoDelta;
    return { utility, opponentUtility: -utility };
  }

  // Bounded level-k / quantal response. Five candidates by eight sampled opponent
  // plans produce at most 40 one-turn resolver calls. k=2 reweights the SAME payoff
  // matrix; it never recurses. Separate tags keep thinking draws from combat draws.
  function planStrategicOrders(board, side, ap, policy, difficulty, opts) {
    opts = opts || {};
    const mind = redMind();
    const seed = opts.seed || 1;
    const turn = opts.turn || 1;
    const tag = opts.tag || 'strategic';
    const diff = mind.difficulty(difficulty);
    const basePolicy = normalizePlanPolicy(policy);
    const policies = mind.candidatePolicies(basePolicy, diff.candidates);
    const candidates = policies.map((candidatePolicy, i) => {
      const plan = planOrders(board, side, ap, candidatePolicy,
        makeRng(hashSeed(seed, tag, 'candidate', turn, side, i)));
      return { plan, policy: candidatePolicy, heuristic: planHeuristic(board, side, plan, candidatePolicy) };
    });

    const foe = enemyOf(side);
    const opponentAp = Number(opts.opponentAp == null ? ap : opts.opponentAp);
    const opponentPolicies = mind.candidatePolicies(mind.BALANCED, 5)
      .concat(['attrition', 'decapitation', 'denial'].map(id => mind.doctrine(id)));
    const opponents = diff.opponentSamples ? opponentPolicies.slice(0, diff.opponentSamples).map((oppPolicy, j) => {
      const plan = planOrders(board, foe, opponentAp, oppPolicy,
        makeRng(hashSeed(seed, tag, 'opponent', turn, side, j)));
      return { plan, policy: oppPolicy, heuristic: planHeuristic(board, foe, plan, oppPolicy) };
    }) : [];

    const choice = mind.boundedChoice({
      candidates,
      opponents,
      difficulty: diff,
      turn,
      rng: makeRng(hashSeed(seed, tag, 'plan-select', turn, side)),
      reasoningRng: makeRng(hashSeed(seed, tag, 'k-drop', turn, side)),
      regretMix: side === 'red',
      regretIterations: 100,
      evaluator: (candidatePlan, opponentPlan, i, j) => scoreAiRollout(
        board, side, candidatePlan, opponentPlan, opts.cfg || DEFAULT_CFG, policies[i],
        makeRng(hashSeed(seed, tag, 'rollout-resolve', turn, side, i, j)))
    });
    return { orders: choice.plan, reasoning: choice, doctrine: basePolicy.id };
  }

  // Forecast planning cache for a player who knows only a belief over Red types.
  // IMPORTANT A2 BOUNDARY: this function accepts no match and no true-doctrine value.
  // Six Red rows × eight sampled Blue rows = 48 resolver calls, shared by all K worlds.
  function buildBeliefPlanCache(board, ap, difficulty, seed, turn, cfg) {
    const mind = redMind();
    const doctrineIds = ['attrition', 'decapitation', 'denial'];
    const preferredVariant = { attrition: 1, decapitation: 3, denial: 2 };
    const rows = [];
    const compiledMoe = moeAvailable() && window.MoeModule.compileGraph
      ? window.MoeModule.compileGraph(moeRedNodes(board)) : null;
    doctrineIds.forEach(doctrineId => {
      const variants = mind.candidatePolicies(mind.doctrine(doctrineId), 5);
      [0, preferredVariant[doctrineId]].forEach(variantIndex => {
        const policy = variants[variantIndex];
        rows.push({
          doctrine: doctrineId,
          policy,
          plan: planOrders(board, 'red', ap.red, policy,
            makeRng(hashSeed(seed, 'belief-cache-red', turn, doctrineId, variantIndex)))
        });
      });
    });
    const bluePolicies = mind.candidatePolicies(mind.BALANCED, 5)
      .concat(doctrineIds.map(id => mind.doctrine(id)));
    const cols = bluePolicies.slice(0, 8).map((policy, j) => ({
      policy,
      plan: planOrders(board, 'blue', ap.blue, policy,
        makeRng(hashSeed(seed, 'belief-cache-blue', turn, j)))
    }));
    const byDoctrine = {};
    doctrineIds.forEach(id => { byDoctrine[id] = { plans: [], scores: [], probabilities: [], payoffs: [] }; });
    rows.forEach((row, i) => {
      let score = 0;
      const payoffs = [];
      cols.forEach((col, j) => {
        const utility = scoreAiRollout(board, 'red', row.plan, col.plan, cfg || DEFAULT_CFG, row.policy,
          makeRng(hashSeed(seed, 'belief-cache-resolve', turn, i, j)), compiledMoe || undefined).utility;
        payoffs.push(utility);
        score += utility;
      });
      byDoctrine[row.doctrine].plans.push(row.plan);
      byDoctrine[row.doctrine].scores.push(score / Math.max(1, cols.length));
      byDoctrine[row.doctrine].payoffs.push(payoffs);
    });
    const diff = mind.difficulty(difficulty);
    const lambda = Math.max(0.15, diff.lambda * (1 - diff.fatigueDecay * Math.max(0, turn - 1)));
    doctrineIds.forEach(id => {
      const safe = mind.regretMatching(byDoctrine[id].payoffs, 100);
      byDoctrine[id].probabilities = safe.row.length ? safe.row : mind.quantalDistribution(byDoctrine[id].scores, lambda);
      byDoctrine[id].mixing = safe.row.length ? 'regret-matching' : 'quantal-response';
    });
    return { byDoctrine, rollouts: rows.length * cols.length, moeCompiled: compiledMoe };
  }

  // A ghost world draws its type only from the caller-provided belief. Both the type
  // and plan draws have dedicated addressable streams. There is deliberately no route
  // from this pure helper to match.redMind.doctrine.
  function sampleBeliefPlan(cache, belief, seed, turn, k) {
    const mind = redMind();
    const sampledDoctrine = mind.drawDoctrine(belief,
      makeRng(hashSeed(seed, 'ghost-doctrine', turn, k)));
    const entry = cache.byDoctrine[sampledDoctrine];
    const index = mind.sampleIndex(entry.probabilities,
      makeRng(hashSeed(seed, 'ghost-plan', turn, k)));
    return { doctrine: sampledDoctrine, orders: entry.plans[Math.max(0, index)] || [] };
  }

  function updateDoctrineBelief(board, observedOrders, ap, difficulty, seed, turn, cfg, prior) {
    const mind = redMind();
    const opponentPolicies = mind.candidatePolicies(mind.BALANCED, 4);
    const opponents = opponentPolicies.map((policy, j) => planOrders(
      board, 'blue', ap.blue, policy,
      makeRng(hashSeed(seed, 'belief-likelihood-opponent', turn, j))
    ));
    const compiledMoe = moeAvailable() && window.MoeModule.compileGraph
      ? window.MoeModule.compileGraph(moeRedNodes(board)) : null;
    const models = {};
    Object.keys(mind.PRIOR).forEach(id => {
      const policies = mind.candidatePolicies(mind.doctrine(id), 5);
      const plans = policies.map((policy, i) => planOrders(
        board, 'red', ap.red, policy,
        makeRng(hashSeed(seed, 'belief-likelihood-plan', turn, id, i))
      ));
      const matrix = plans.map((plan, i) => opponents.map((opponent, j) => scoreAiRollout(
        board, 'red', plan, opponent, cfg || DEFAULT_CFG, policies[i],
        makeRng(hashSeed(seed, 'belief-likelihood-resolve', turn, id, i, j)), compiledMoe || undefined
      ).utility));
      const probabilities = mind.regretMatching(matrix, 100).row;
      const counts = {};
      let total = 0;
      plans.forEach((plan, i) => {
        const weight = Number(probabilities[i] || 0);
        const features = mind.featureCounts(plan, targetId => board.nodes[targetId]);
        Object.keys(features).forEach(key => { counts[key] = (counts[key] || 0) + weight * features[key]; });
        total += weight * plan.length;
      });
      models[id] = { counts, total };
    });
    const observed = mind.featureCounts(observedOrders, targetId => board.nodes[targetId]);
    return {
      belief: mind.updatePosterior(prior, observed, models, 2.0),
      observed,
      models,
      planningRollouts: Object.keys(mind.PRIOR).length * plansPerDoctrineForBelief() * opponents.length
    };
  }

  function plansPerDoctrineForBelief() { return 5; }

  // ===================================================================================
  // Match controller — holds the live match, drives the turn loop, writes board state
  // back to the scenario graph for visualization, and serializes for save / network.
  // ===================================================================================
  let match = null;
  let ctx = { onResolved: () => {}, onState: () => {} };

  function init(context) { ctx = Object.assign({}, ctx, context || {}); }

  // Action points for a side this turn. When the economy is dynamic for that side, AP
  // scales LINEARLY from the side's base down to a hard floor of TEMPO_FLOOR_AP as its
  // command-tempo collapses: full tempo -> base AP; total C2/logistics loss -> floor AP.
  // This matches the advertised "decapitate the network and throttle their tempo" rule
  // (C-010) — at zero surviving C2/logistics a side really is cut to the floor, not ~60%.
  // A fixed AP override (explicit sandbox mode / tests) disables the economy for that side.
  function apFor(side) {
    if (!match) return 0;
    return apForBoard(match.board, side);
  }
  // Same tempo-economy rule over an arbitrary board snapshot, so the horizon projection
  // (§3.5) can run the AP economy on cloned continuation boards without touching the
  // live match board.
  function apForBoard(board, side, state) {
    // `state` makes the AP economy reusable in a counterfactual worker where there is
    // deliberately no live module-global match. Live callers omit it and retain the exact
    // historical behavior; worker callers pass the serialized cfg/economy fields.
    state = state || match;
    const cfg = state && state.cfg || DEFAULT_CFG;
    const fixed = side === 'blue' ? cfg.apBlue : cfg.apRed;
    if (!state || !state.dynamicAp || !state.dynamicAp[side]) return fixed;
    const base = (state.baseAp && state.baseAp[side]) || fixed;
    const floor = Math.min(TEMPO_FLOOR_AP, base);   // never let the floor exceed a tiny base
    const start = (state.startTempo && state.startTempo[side]) || 0;
    if (start <= 0) return base;
    const frac = clamp(commandTempo(board, side) / start, 0, 1);
    return clamp(Math.round(floor + (base - floor) * frac), floor, base);
  }

  function syncActivationRosters(board, activation) {
    activation = activation || { groups: {} };
    const groups = activation.groups || activation;
    ['blue', 'red'].forEach(side => {
      board.rosters[side] = [];
      board.reserves[side] = [];
    });
    Object.keys(board.nodes).sort().forEach(id => {
      const node = board.nodes[id];
      const group = node.activationGroup || (node.scenarioEnabled ? 'base' : 'reserve');
      const configured = Object.prototype.hasOwnProperty.call(groups, group);
      const active = configured ? groups[group] === true : node.scenarioEnabled !== false;
      node.active = active;
      node.resourceGenByType = Object.assign({}, active && node.scenarioEnabled === false
        ? node.potentialResourceGenByType : node.baseResourceGenByType);
      (active ? board.rosters : board.reserves)[node.team].push(id);
    });
    return board;
  }

  function makeStrategicState(cfgOverrides, board) {
    const config = strategicConfig(cfgOverrides && cfgOverrides.strategic);
    const roe = selectedRoe(cfgOverrides && (cfgOverrides.roe || cfgOverrides.roeId));
    const state = strategicModule().createStrategicState({
      escalation: config.escalation,
      activationGroups: config.activationGroups,
      roe
    });
    state.config = config;
    state.roe = roe;
    state.allies = {};
    Object.keys(config.allies).forEach(id => {
      const ally = config.allies[id];
      const active = (ally.activateGroups || []).some(group => state.activation.groups[group] === true);
      state.allies[id] = strategicModule().createAllyTrack(ally, {
        active,
        lastEscalation: state.escalation.value
      });
    });
    state.pendingActivations = [];
    state.blueIndicatorsNext = [];
    state.signalHistory = [];
    board.strategic = state;
    syncActivationRosters(board, state.activation);
    return state;
  }

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
    const strategic = makeStrategicState(cfgOverrides || {}, board);
    cfg.strategic = strategic.config;
    cfg.roeId = strategic.roe.id;
    // Command-tempo economy setup (C-012). By default a side's BASE action points come from
    // its surviving C2/logistics and AP floats per-turn (see apFor) so decapitation degrades
    // tempo. Campaign handoff / callers shape the START posture WITHOUT killing that economy:
    //   - baseApBlue / baseApRed .......... set base AP, dynamic economy stays ON
    //   - apBlue / apRed .................. (legacy/campaign) also taken as base AP with the
    //                                       economy ON, UNLESS cfg.sandbox is set (below)
    //   - postureModifiers { blue:{mult,offset}, red:{...} } . multiply/offset the base AP,
    //                                       economy stays ON (tempo degradation still applies)
    //   - cfg.sandbox === true ........... reserve the OLD behavior: an explicit apBlue/apRed
    //                                       becomes a FIXED AP and disables the economy for
    //                                       that side (tests / deliberate sandbox runs only).
    const sandbox = !!cfg.sandbox;
    const pm = (cfgOverrides && cfgOverrides.postureModifiers) || {};
    function setupAp(side, cfgKey, baseKey) {
      const ov = cfgOverrides || {};
      const explicitFixed = sandbox && ov[cfgKey] != null;   // only sandbox makes apX fixed
      if (explicitFixed) {
        return { base: clamp(Math.round(Number(ov[cfgKey])), 1, 12), dynamic: false };
      }
      // Base AP: explicit base override, else legacy apX-as-base, else resource-derived.
      let base;
      if (ov[baseKey] != null) base = Number(ov[baseKey]);
      else if (ov[cfgKey] != null) base = Number(ov[cfgKey]);
      else base = resourceAp(board, side, DEFAULT_CFG[cfgKey]);
      // Posture multiplier / offset (kept bounded so a bad campaign value can't run away).
      const mod = pm[side] || {};
      const mult = mod.mult != null ? clamp(Number(mod.mult), 0.25, 3) : 1;
      const offset = mod.offset != null ? clamp(Number(mod.offset), -4, 4) : 0;
      base = clamp(Math.round(base * mult + offset), TEMPO_FLOOR_AP, 8);
      return { base, dynamic: true };
    }
    const apB = setupAp('blue', 'apBlue', 'baseApBlue');
    const apR = setupAp('red', 'apRed', 'baseApRed');
    const baseAp = { blue: apB.base, red: apR.base };
    cfg.apBlue = baseAp.blue;
    cfg.apRed = baseAp.red;
    const dynamicAp = { blue: apB.dynamic, red: apR.dynamic };
    const startTempo = { blue: commandTempo(board, 'blue'), red: commandTempo(board, 'red') };
    const objectives = { blue: pickObjectives(board, 'blue'), red: pickObjectives(board, 'red') };
    const seed = (cfgOverrides && cfgOverrides.seed) || hashSeed('match', graph.nodes ? graph.nodes.length : 0, Object.keys(board.nodes).join('').length);
    const doctrinePrior = redMind().normalizeBelief((cfgOverrides && cfgOverrides.doctrinePrior) || redMind().PRIOR);
    const redDoctrine = redMind().drawDoctrine(doctrinePrior, makeRng(hashSeed(seed, 'doctrine')));
    const fingerprint = computeFingerprint(graph);   // bind this match to the scenario it was built on (C-011)
    match = {
      cfg, board, seed, fingerprint,
      baseAp, dynamicAp, startTempo, objectives,
      turn: 1,
      phase: 'plan',            // 'plan' | 'resolved' | 'over'
      orders: { blue: [], red: [] },
      orderLocks: { blue: false, red: false },
      score: { blue: 0, red: 0 },
      startObj: { blue: objectiveValue(board, 'blue'), red: objectiveValue(board, 'red') },
      history: [],
      // Denial-victory state (GAME_DESIGN §6, Increment A — consumed read-only by wargame.js):
      calendar: { turnLengthDays: TURN_LENGTH_DAYS, dday: ddayForTurn(1) },   // D+1 at turn 1, +3.5/turn
      denialHistory: [],                    // per-resolved-turn { turn, index, throughput, osvi }
      lodgment: { value: 0, history: [] },  // accumulated Red lodgment 0..1, history [{turn, value}]
      result: null,                         // { winner, reason:'halt'|'lodgment'|'horizon', projection } on match end
      // The Harsanyi type is private match state. serialize() deliberately omits it and
      // deserialize() re-derives it from (seed,'doctrine'), so Director forecast code
      // cannot learn the truth by inspecting a save. Only prior/belief are public.
      redMind: {
        prior: Object.assign({}, doctrinePrior),
        belief: Object.assign({}, doctrinePrior),
        doctrine: redDoctrine,
        reasoningHistory: [],
        trajectory: [{ turn: 0, belief: Object.assign({}, doctrinePrior), evidence: {} }]
      },
      // CO-005 A6: Red's frequency model of the HUMAN player's habits (Blue's own
      // data — public and serializable, unlike the hidden doctrine). Injected from
      // the career archive by the Director; cold start is a fresh empty model.
      playerModel: redMind().normalizePlayerModel(cfgOverrides && cfgOverrides.playerModel),
      strategic,
      aiCommitted: { blue: false, red: false },
      winner: null,
      lastReport: null,
      savedGraphState
    };
    syncBoardToGraph();
    ctx.onState(getState());
    return getState();
  }

  // Public, serializable view of the match for the UI.
  function spentAp(side) {
    return (match && match.orders[side] || []).reduce((sum, order) => sum + orderCost(order), 0);
  }

  function getState() {
    if (!match) return null;
    return {
      turn: match.turn,
      phase: match.phase,
      cfg: match.cfg,
      score: { blue: match.score.blue, red: match.score.red },
      objNow: { blue: objectiveValue(match.board, 'blue'), red: objectiveValue(match.board, 'red') },
      startObj: match.startObj,
      orders: {
        blue: match.orders.blue.slice(),
        // AI Red is committed before Blue plans so indicators can exist, but the order
        // bundle remains hidden until WATCH. The public state exposes belief, not truth.
        red: (match.phase === 'plan' && !isHuman('red')) ? [] : match.orders.red.slice()
      },
      ordersLocked: { blue: !!(match.orderLocks && match.orderLocks.blue), red: !!(match.orderLocks && match.orderLocks.red) },
      ap: { blue: apFor('blue'), red: apFor('red') },
      apLeft: { blue: apFor('blue') - spentAp('blue'), red: apFor('red') - spentAp('red') },
      winner: match.winner,
      lastReport: match.lastReport,
      // Denial-victory surface (GAME_DESIGN §6, Increment A; wargame.js consumes read-only):
      calendar: match.calendar
        ? { turnLengthDays: match.calendar.turnLengthDays, dday: match.calendar.dday }
        : { turnLengthDays: TURN_LENGTH_DAYS, dday: ddayForTurn(match.turn) },
      denialHistory: (match.denialHistory || []).slice(),
      lodgment: match.lodgment
        ? { value: match.lodgment.value, history: (match.lodgment.history || []).slice() }
        : { value: 0, history: [] },
      result: match.result || null,
      rosters: { blue: match.board.rosters.blue.length, red: match.board.rosters.red.length },
      reserves: { blue: match.board.reserves.blue.length, red: match.board.reserves.red.length },
      alive: {
        blue: match.board.rosters.blue.filter(id => match.board.nodes[id].alive).length,
        red: match.board.rosters.red.filter(id => match.board.nodes[id].alive).length
      },
      tempo: { blue: tempoInfo('blue'), red: tempoInfo('red') },
      objectives: { blue: objectiveStatus('blue'), red: objectiveStatus('red') },
      objectiveIds: { blue: (match.objectives && match.objectives.blue || []).slice(), red: (match.objectives && match.objectives.red || []).slice() },
      playerModel: JSON.parse(JSON.stringify(match.playerModel || redMind().emptyPlayerModel())),
      redMind: {
        prior: Object.assign({}, match.redMind && match.redMind.prior || redMind().PRIOR),
        belief: Object.assign({}, match.redMind && match.redMind.belief || redMind().PRIOR),
        difficulty: redMind().difficulty(match.cfg.difficulty.red),
        trajectory: (match.redMind && match.redMind.trajectory || []).map(row => ({
          turn: row.turn, belief: Object.assign({}, row.belief), evidence: Object.assign({}, row.evidence || {})
        })),
        revealedDoctrine: match.phase === 'over' ? (match.redMind && match.redMind.doctrine || null) : null
      },
      strategic: match.strategic ? {
        classification: match.strategic.classification,
        escalation: {
          value: match.strategic.escalation.value,
          history: (match.strategic.escalation.history || []).slice()
        },
        roe: JSON.parse(JSON.stringify(match.strategic.roe)),
        allies: JSON.parse(JSON.stringify(match.strategic.allies || {})),
        allyRules: JSON.parse(JSON.stringify(match.strategic.config && match.strategic.config.allies || {})),
        activation: JSON.parse(JSON.stringify(match.strategic.activation || { groups: {}, history: [] })),
        indicators: JSON.parse(JSON.stringify(match.strategic.indicators || { current: [], history: [] })),
        pendingActivations: (match.strategic.pendingActivations || []).slice()
      } : null,
      // Save/resume integrity flags (C-011): the UI can warn when a loaded match is running
      // against a different / unverifiable scenario graph than the one it was created on.
      scenarioMismatch: !!match.scenarioMismatch,
      scenarioUnknown: !!match.scenarioUnknown,
      fingerprint: match.fingerprint || null,
      aar: match.phase === 'over' ? buildAar() : null
    };
  }

  // Key-objective status for a side: how many of its designated key nodes are still alive.
  function objectiveStatus(side) {
    const ids = (match.objectives && match.objectives[side]) || [];
    let held = 0;
    ids.forEach(id => { const n = match.board.nodes[id]; if (n && n.alive) held++; });
    return { total: ids.length, held, lost: ids.length - held };
  }

  // Per-side tempo snapshot for the UI: current AP, base AP, the tempo fraction relative
  // to the start of the match, and surviving command/logistics counts.
  function tempoInfo(side) {
    const start = (match.startTempo && match.startTempo[side]) || 0;
    const now = commandTempo(match.board, side);
    const counts = tempoCounts(match.board, side);
    return {
      ap: apFor(side),
      base: (match.baseAp && match.baseAp[side]) || apFor(side),
      dynamic: !!(match.dynamicAp && match.dynamicAp[side]),
      frac: start > 0 ? Math.round((now / start) * 100) / 100 : 1,
      c2: counts.c2,
      logi: counts.logi
    };
  }

  function isHuman(side) { return match.cfg.control[side] === 'human'; }
  function boardNode(id) { return match && match.board.nodes[id]; }
  function methods() { return METHODS; }
  function methodKeys() { return METHOD_KEYS.slice(); }
  function strategicOptions() {
    return {
      classification: 'UNCLASSIFIED // NOTIONAL RESEARCH TOOL',
      roe: JSON.parse(JSON.stringify(ROE_OPTIONS)),
      allies: JSON.parse(JSON.stringify(STRATEGIC_DEFAULTS.allies))
    };
  }

  // Add / remove a human order during the plan phase (AP-bounded). Strikes are gated by the
  // authoritative availability rule (C-003): an order is only accepted if the side fields a
  // surviving valid firing source for the chosen method against a living enemy target. The
  // resolved source is stamped onto the order so the resolver/AAR attribute it consistently.
  function queueOrder(side, order) {
    if (!match || match.phase !== 'plan' || !isHuman(side)) return false;
    if (match.orderLocks && match.orderLocks[side]) return false;
    if (!order || !['strike', 'harden', 'repair', 'feint', 'decoy'].includes(order.kind)) return false;
    if (spentAp(side) + orderCost(order) > apFor(side)) return false;
    const n = match.board.nodes[order.targetId];
    if (!n || !n.alive) return false;
    if (order.kind === 'strike') {
      const avail = canStrikeBoard(match.board, side, order.targetId, order.methodKey, order.sourceId);
      if (!avail.ok) return false;   // invalid strike (friendly target / no valid source / bad method) — reject, never silently resolve
      match.orders[side].push(Object.assign({ side }, order, { sourceId: order.sourceId || avail.sourceId }));
      ctx.onState(getState());
      return true;
    }
    if (order.kind === 'feint' || order.kind === 'decoy') {
      if (n.team === side || n.active === false) return false;
      if (order.kind === 'decoy' && match.orders[side].some(o => o.kind === 'decoy')) return false;
      const tags = n.indicatorTags || {};
      const spec = {
        id: [side, order.kind, match.turn, match.orders[side].length].join(':'),
        side, turn: match.turn,
        axis: order.axis || tags.axis || n.geographyClass || 'theater-wide',
        targetClass: order.targetClass || tags.targetClass || n.type || n.subsystem || 'key systems',
        methodKey: order.methodKey || null
      };
      const signal = order.kind === 'feint'
        ? strategicModule().createFeintOrder(spec, match.strategic.config)
        : strategicModule().createDecoySignal(spec, match.strategic.config);
      signal.targetId = n.id;
      match.orders[side].push(signal);
      ctx.onState(getState());
      return true;
    }
    if ((order.kind === 'harden' || order.kind === 'repair') && n.team !== side) return false;
    match.orders[side].push(Object.assign({ side }, order));
    ctx.onState(getState());
    return true;
  }

  // Public availability helper (C-003) so the UI can gate strike buttons with the SAME rule
  // the engine enforces. Accepts either a method string or an {targetId, methodKey, sourceId}
  // order-like object. Returns {ok, reason, sourceId}. Read-only over the live match board.
  function canStrike(side, targetId, method, sourceId) {
    if (!match) return { ok: false, reason: 'no-match' };
    if (targetId && typeof targetId === 'object') {
      const o = targetId;
      return canStrikeBoard(match.board, side, o.targetId, o.methodKey || o.method, o.sourceId);
    }
    return canStrikeBoard(match.board, side, targetId, method, sourceId);
  }

  // Public order validator (C-003) covering all order kinds, so the UI can gate every button
  // (strike/harden/repair) and pre-check AP. Returns {ok, reason, sourceId?}.
  function validOrder(side, order) {
    if (!match || match.phase !== 'plan') return { ok: false, reason: 'not-planning' };
    if (!order) return { ok: false, reason: 'no-order' };
    if (!isHuman(side)) return { ok: false, reason: 'not-human-side' };
    if (match.orderLocks && match.orderLocks[side]) return { ok: false, reason: 'orders-locked' };
    if (spentAp(side) + orderCost(order) > apFor(side)) return { ok: false, reason: 'no-ap' };
    const n = match.board.nodes[order.targetId];
    if (!n || !n.alive) return { ok: false, reason: n ? 'target-dead' : 'no-target' };
    if (order.kind === 'strike') return canStrikeBoard(match.board, side, order.targetId, order.methodKey, order.sourceId);
    if (order.kind === 'feint' || order.kind === 'decoy') {
      if (n.team === side || n.active === false) return { ok: false, reason: 'signal-needs-enemy-axis' };
      if (order.kind === 'decoy' && match.orders[side].some(o => o.kind === 'decoy')) return { ok: false, reason: 'decoy-quota' };
      return { ok: true, reason: 'ok' };
    }
    if (order.kind === 'harden' || order.kind === 'repair') {
      if (n.team !== side) return { ok: false, reason: 'not-friendly' };
      return { ok: true, reason: 'ok' };
    }
    return { ok: false, reason: 'bad-kind' };
  }
  function removeOrder(side, index) {
    if (!match || match.phase !== 'plan') return;
    if (match.orderLocks && match.orderLocks[side]) return;
    match.orders[side].splice(index, 1);
    ctx.onState(getState());
  }
  function clearOrders(side) {
    if (match && match.phase === 'plan' && !(match.orderLocks && match.orderLocks[side])) {
      match.orders[side] = []; ctx.onState(getState());
    }
  }

  function canonicalOrderBytes(side) {
    return JSON.stringify((match && match.orders[side] || []).map(o => ({
      side: o.side, kind: o.kind, methodKey: o.methodKey || null,
      targetId: o.targetId || null, sourceId: o.sourceId || null,
      axis: o.axis || null, targetClass: o.targetClass || null
    })));
  }
  function lockOrders(side) {
    if (!match || match.phase !== 'plan' || !isHuman(side)) return { ok: false, reason: 'not-lockable' };
    match.orderLocks = match.orderLocks || { blue: false, red: false };
    match.orderLocks[side] = true;
    const orderHash = hashSeed(match.seed, 'order-lock', match.turn, side, canonicalOrderBytes(side));
    ctx.onState(getState());
    return { ok: true, side, turn: match.turn, orderHash };
  }
  function unlockOrders(side) {
    if (!match || match.phase !== 'plan' || !isHuman(side)) return false;
    match.orderLocks = match.orderLocks || { blue: false, red: false };
    match.orderLocks[side] = false;
    ctx.onState(getState());
    return true;
  }
  function lockedOrderHash(side) {
    if (!match || !(match.orderLocks && match.orderLocks[side])) return null;
    return hashSeed(match.seed, 'order-lock', match.turn, side, canonicalOrderBytes(side));
  }

  function resolveSignalOrders(side, orders) {
    return (orders || []).map((order, index) => {
      if ((order.kind !== 'feint' && order.kind !== 'decoy') || order.leak) return order;
      return strategicModule().resolveSignalLeak(order, match.strategic.config,
        makeRng(hashSeed(match.seed, 'signal-leak', match.turn, side, index, order.kind)));
    });
  }

  function addAiSignals(side, orders, policy) {
    const p = normalizePlanPolicy(policy);
    const rate = clamp(Number(p.deceptionRate || 0), 0, 0.8);
    const enemy = enemyOf(side);
    const targets = (match.board.rosters[enemy] || []).map(id => match.board.nodes[id])
      .filter(n => n && n.alive && n.active !== false)
      .sort((a, b) => nodeValue(b) - nodeValue(a) || String(a.id).localeCompare(String(b.id)));
    if (!targets.length || rate <= 0) return orders;
    const out = orders.slice();
    const target = targets[Math.floor(makeRng(hashSeed(match.seed, 'deception-target', match.turn, side)).next() * targets.length)];
    const tags = target.indicatorTags || {};
    const spec = {
      side, turn: match.turn,
      axis: tags.axis || target.geographyClass || 'theater-wide',
      targetClass: tags.targetClass || target.type || 'key systems'
    };
    if (out.length && makeRng(hashSeed(match.seed, 'deception-feint', match.turn, side)).next() < rate) {
      const feint = strategicModule().createFeintOrder(Object.assign({ id: [side, 'feint', match.turn].join(':') }, spec), match.strategic.config);
      feint.targetId = target.id;
      // Replace one paid combat order: deception has a real opportunity cost.
      out[out.length - 1] = feint;
    }
    if (makeRng(hashSeed(match.seed, 'deception-decoy', match.turn, side)).next() < rate * 0.55) {
      const decoy = strategicModule().createDecoySignal(Object.assign({ id: [side, 'decoy', match.turn].join(':') }, spec), match.strategic.config);
      decoy.targetId = target.id;
      out.push(decoy);
    }
    return resolveSignalOrders(side, out);
  }

  function reactToBlueIndicators(orders, difficulty) {
    const diff = redMind().difficulty(difficulty);
    const lines = match.strategic.blueIndicatorsNext || [];
    if (diff.k < 1 || !lines.length) return orders;
    const assessed = lines.filter(line => !line.assessedDeceptive && line.targetClass);
    if (!assessed.length) return orders;
    const targetClass = assessed[0].targetClass;
    const candidates = (match.board.rosters.red || []).map(id => match.board.nodes[id]).filter(node => {
      const tags = node && node.indicatorTags || {};
      return node && node.alive && tags.targetClass === targetClass;
    }).sort((a, b) => nodeValue(b) - nodeValue(a) || String(a.id).localeCompare(String(b.id)));
    if (!candidates.length || !orders.length) return orders;
    const out = orders.slice();
    out[out.length - 1] = { side: 'red', kind: 'harden', targetId: candidates[0].id, indicatorResponse: targetClass };
    return out;
  }

  function generateIndicatorChannel(side, orders, tag) {
    return strategicModule().generateIndicators(orders, {
      nodesById: match.board.nodes,
      config: match.strategic.config,
      rng: makeRng(hashSeed(match.seed, tag || 'indicators', match.turn, side))
    });
  }

  // Fill an AI side's orders for the current turn (deterministic from turn+side).
  function ensureAiOrders(side) {
    if (isHuman(side)) return;
    match.aiCommitted = match.aiCommitted || { blue: false, red: false };
    if (match.aiCommitted[side]) return;
    const policy = side === 'red'
      ? redMind().doctrine(match.redMind && match.redMind.doctrine)
      : redMind().BALANCED;
    const planned = planStrategicOrders(match.board, side, apFor(side), policy, match.cfg.difficulty[side], {
      seed: match.seed,
      turn: match.turn,
      tag: 'plan',
      opponentAp: apFor(enemyOf(side)),
      cfg: match.cfg
    });
    // CO-005 A6: restricted-Nash exploitation. With confidence-capped, seeded
    // probability p ≤ 0.5, Red swaps the safe mixed choice for a bounded plan tilted
    // against the observed player model (Johanson et al.). Cold start (< 3 observed
    // turns) keeps p = 0, so behavior is byte-identical until real evidence exists.
    let chosen = planned;
    let adaptive = false;
    if (side === 'red' && isHuman('blue')) {
      const rnrP = redMind().modelConfidence(match.playerModel);
      if (rnrP > 0 && makeRng(hashSeed(match.seed, 'rnr-gate', match.turn)).next() < rnrP) {
        chosen = planStrategicOrders(match.board, 'red', apFor('red'),
          redMind().exploitPolicy(policy, match.playerModel), match.cfg.difficulty.red, {
            seed: match.seed,
            turn: match.turn,
            tag: 'rnr-exploit',
            opponentAp: apFor('blue'),
            cfg: match.cfg
          });
        adaptive = true;
      }
    }
    let aiOrders = chosen.orders;
    if (side === 'red') aiOrders = reactToBlueIndicators(aiOrders, match.cfg.difficulty.red);
    aiOrders = addAiSignals(side, aiOrders, policy);
    match.orders[side] = aiOrders;
    match.aiCommitted[side] = true;
    if (match.redMind) {
      match.redMind.reasoningHistory.push({
        turn: match.turn,
        side,
        k: chosen.reasoning.k,
        configuredK: chosen.reasoning.configuredK,
        lambda: Math.round(chosen.reasoning.lambda * 1000) / 1000,
        rollouts: chosen.reasoning.rollouts,
        dropped: !!chosen.reasoning.dropped,
        adaptive
      });
    }
  }

  function preparePlan() {
    if (!match || match.phase !== 'plan') return getState();
    ensureAiOrders('red');
    if (!match.strategic.indicators || match.strategic.indicators.turn !== match.turn) {
      const lines = generateIndicatorChannel('red', match.orders.red, 'red-indicators');
      match.strategic.indicators = match.strategic.indicators || { current: [], history: [] };
      match.strategic.indicators.turn = match.turn;
      match.strategic.indicators.current = lines;
      match.strategic.indicators.history = (match.strategic.indicators.history || []).concat([{ turn: match.turn, side: 'red', lines }]);
    }
    ctx.onState(getState());
    return getState();
  }

  function escalationEventsForOrders(board, orders, report) {
    const events = report && report.events || [];
    const used = new Set();
    const killed = new Set(events.filter(e => e.kind === 'kill').map(e => [e.side, e.targetId].join('|')));
    return (orders || []).filter(order => order.kind === 'strike').map((order, index) => {
      let outcome = 'attempt';
      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        if (used.has(i) || !['hit', 'miss', 'void'].includes(event.kind)) continue;
        if (event.side !== order.side || event.targetId !== order.targetId) continue;
        if (event.method && event.method !== order.methodKey) continue;
        used.add(i);
        outcome = event.kind;
        break;
      }
      if (outcome === 'hit' && killed.has([order.side, order.targetId].join('|'))) outcome = 'kill';
      return {
        orderId: [match.turn, order.side, index].join(':'),
        methodKey: order.methodKey,
        outcome,
        target: board.nodes[order.targetId] || { id: order.targetId }
      };
    });
  }

  function advanceStrategicState(preResolutionBoard, allOrders, report) {
    if (!match.strategic) return null;
    const S = strategicModule();
    const strategicEvents = escalationEventsForOrders(preResolutionBoard, allOrders, report);
    const transition = S.updateEscalation(match.strategic.escalation.value, strategicEvents, match.strategic.config);
    match.strategic.escalation.value = transition.after;
    match.strategic.escalation.history.push({
      turn: match.turn, before: transition.before, after: transition.after,
      delta: transition.delta, breakdown: transition.breakdown, impulses: transition.impulses
    });
    const allyEvents = [];
    Object.keys(match.strategic.config.allies || {}).sort().forEach(id => {
      const config = match.strategic.config.allies[id];
      const advanced = S.advanceAllyTrack(match.strategic.allies[id], transition.after, config,
        makeRng(hashSeed(match.seed, 'ally-entry', id, match.turn)), { turn: match.turn, actor: config.id || id });
      match.strategic.allies[id] = advanced.track;
      if (advanced.transition) {
        const pending = Object.assign({ applyTurn: match.turn + 1 }, advanced.transition);
        match.strategic.pendingActivations.push(pending);
        allyEvents.push(pending);
      }
    });
    return { transition, allyEvents };
  }

  function applyPendingActivations() {
    if (!match || !match.strategic) return [];
    const remaining = [], applied = [];
    (match.strategic.pendingActivations || []).forEach(transition => {
      if (Number(transition.applyTurn) > match.turn) { remaining.push(transition); return; }
      const result = strategicModule().applyActivationTransition(match.strategic.activation, transition);
      match.strategic.activation = result.state;
      applied.push.apply(applied, result.changed.map(change => Object.assign({ actor: transition.actor }, change)));
    });
    match.strategic.pendingActivations = remaining;
    if (applied.length) syncActivationRosters(match.board, match.strategic.activation);
    match.board.strategic = match.strategic;
    return applied;
  }

  // Commit the turn: gather AI orders, resolve, write back, score, check victory.
  function commitTurn() {
    if (!match || match.phase !== 'plan') return getState();
    ensureAiOrders('blue');
    ensureAiOrders('red');
    match.orders.blue = resolveSignalOrders('blue', match.orders.blue);
    const preResolutionBoard = cloneBoardForAi(match.board);
    const beliefUpdate = updateDoctrineBelief(
      preResolutionBoard,
      match.orders.red,
      { blue: apFor('blue'), red: apFor('red') },
      match.cfg.difficulty.red,
      match.seed,
      match.turn,
      match.cfg,
      match.redMind && match.redMind.belief
    );
    const allOrders = match.orders.blue.concat(match.orders.red);
    const rng = makeRng(hashSeed(match.seed, 'resolve', match.turn));
    const report = resolveTurn(match.board, allOrders, match.cfg, rng);
    const strategicReport = advanceStrategicState(preResolutionBoard, allOrders, report);
    match.score.blue += report.scoreDelta.blue;
    match.score.red += report.scoreDelta.red;
    match.history.push({ turn: match.turn, orders: { blue: match.orders.blue.slice(), red: match.orders.red.slice() }, report });
    // CO-005 A6: observe the HUMAN player's committed orders into Red's frequency model
    // (one merged sample per resolved turn; the Director persists it across operations).
    if (isHuman('blue') && match.playerModel) {
      match.playerModel = redMind().mergePlayerModel(
        match.playerModel,
        redMind().featureCounts(match.orders.blue, id => match.board.nodes[id]),
        match.orders.blue.length
      );
    }
    match.lastReport = { turn: match.turn, events: report.events, scoreDelta: report.scoreDelta };
    if (match.redMind) {
      const caughtSignals = match.orders.red.filter(order => (order.kind === 'feint' || order.kind === 'decoy') && order.assessedDeceptive).length;
      const updatedBelief = caughtSignals
        ? redMind().updateDeceptionPosterior(beliefUpdate.belief, caughtSignals, caughtSignals)
        : beliefUpdate.belief;
      match.redMind.belief = Object.assign({}, updatedBelief);
      match.redMind.trajectory.push({
        turn: match.turn,
        belief: Object.assign({}, updatedBelief),
        evidence: Object.assign({ caughtDeception: caughtSignals }, beliefUpdate.observed)
      });
      match.lastReport.intelAssessment = {
        belief: Object.assign({}, updatedBelief),
        planningRollouts: beliefUpdate.planningRollouts
      };
    }
    const blueIndicators = generateIndicatorChannel('blue', match.orders.blue, 'blue-indicators');
    match.strategic.blueIndicatorsNext = blueIndicators;
    match.strategic.signalHistory.push({
      turn: match.turn,
      red: match.orders.red.filter(order => order.kind === 'feint' || order.kind === 'decoy').map(order => Object.assign({}, order)),
      blue: match.orders.blue.filter(order => order.kind === 'feint' || order.kind === 'decoy').map(order => Object.assign({}, order))
    });
    if (strategicReport) {
      match.lastReport.escalation = {
        before: strategicReport.transition.before, after: strategicReport.transition.after,
        delta: strategicReport.transition.delta, allyEvents: strategicReport.allyEvents
      };
    }
    syncBoardToGraph();
    // Denial assessment over the LIVE Red roster after every turn resolution (§6):
    // append the denial-trend row and integrate Red's lodgment before judging victory.
    const advancedDenial = advanceDenialState(match.board, match.lodgment && match.lodgment.value, {
      requiredTurns: match.cfg.lodgmentRequiredTurns || LODGMENT_REQ_TURNS
    });
    const assessment = advancedDenial.assessment;
    if (assessment) {
      match.denialHistory.push({
        turn: match.turn,
        index: assessment.denialIndex,
        throughput: assessment.throughput,
        osvi: assessment.osviRed
      });
      match.lodgment.value = advancedDenial.lodgment;
      match.lodgment.history.push({ turn: match.turn, value: match.lodgment.value });
    }
    evaluateVictory(false, assessment);
    match.phase = match.winner ? 'over' : 'resolved';
    ctx.onResolved(match.lastReport, getState());
    ctx.onState(getState());
    return getState();
  }

  // Advance from a resolved turn into the next plan phase.
  function nextTurn() {
    if (!match || match.phase !== 'resolved') return getState();
    match.turn += 1;
    // D-day clock: +3.5 days per turn, clamped to the advertised window so a
    // horizon ending reads D+18.5, not D+22 (result.at.dday is clamped the same way).
    if (match.calendar) match.calendar.dday = ddayForTurn(Math.min(match.turn, match.cfg.turnLimit));
    match.orders = { blue: [], red: [] };
    match.aiCommitted = { blue: false, red: false };
    match.orderLocks = { blue: false, red: false };
    match.phase = 'plan';
    const activated = applyPendingActivations();
    if (activated.length) match.lastReport.activationsApplied = activated;
    if (match.strategic && match.strategic.indicators) {
      match.strategic.indicators.turn = null;
      match.strategic.indicators.current = [];
    }
    // HARD clock (GAME_DESIGN §3/P3): no auto-extend, ever. Past the final turn the match
    // ends NOW — an ambiguous ending is resolved inside evaluateVictory by a seeded MC
    // projection of the continuation, never by playing extra turns.
    if (match.turn > match.cfg.turnLimit) { evaluateVictory(true); match.phase = 'over'; }
    ctx.onState(getState());
    return getState();
  }

  // Side-NEUTRAL tie-breaker (C-010): no implicit Blue advantage. Compare a cascade of
  // symmetric measures and only return 'draw' when every measure is exactly equal. Order:
  //   1. effective combat power remaining (objectiveValue, health-weighted)
  //   2. key objectives still held
  //   3. surviving command-tempo
  // Each is strictly compared (>), so equality falls through to the next measure and, if all
  // tie, to an explicit draw. 'draw' is a first-class outcome the UI/AAR render as contested.
  function neutralTieBreak() {
    const oV = { blue: objectiveValue(match.board, 'blue'), red: objectiveValue(match.board, 'red') };
    if (oV.blue !== oV.red) return oV.blue > oV.red ? 'blue' : 'red';
    const oH = { blue: objectiveStatus('blue').held, red: objectiveStatus('red').held };
    if (oH.blue !== oH.red) return oH.blue > oH.red ? 'blue' : 'red';
    const t = { blue: commandTempo(match.board, 'blue'), red: commandTempo(match.board, 'red') };
    if (t.blue !== t.red) return t.blue > t.red ? 'blue' : 'red';
    return 'draw';
  }

  // ---- Denial arbiter plumbing (GAME_DESIGN §6 — Increment A) -----------------------
  // MoeModule (moe.js) is the victory arbiter for invasion play. game.js only ADAPTS
  // board state into assessGraph's node shape and CONSUMES its outputs; assessment math
  // stays in moe.js (pure engine), accumulation/victory math lives here (consumer side).
  let warnedNoMoe = false;
  function moeAvailable() {
    if (window.MoeModule && typeof window.MoeModule.assessGraph === 'function') return true;
    if (!warnedNoMoe) {
      warnedNoMoe = true;
      try { console.warn('[game] MoeModule unavailable — denial victory arbiter disabled; falling back to legacy attrition scoring.'); } catch (e) {}
    }
    return false;
  }
  // Adapt a board's LIVE Red roster (including this-match damage/kills) into the node
  // shape assessGraph expects (cascScore / status naming). Dead nodes stay in the list
  // at zero health so subsystem base weights are preserved — losses count against Red.
  function moeRedNodes(board) {
    return (board.rosters.red || []).map(id => {
      const n = board.nodes[id];
      return {
        id: n.id, team: 'red', type: n.type, subsystem: n.subsystem,
        importance: n.importance, cascScore: n.casc,
        healthMax: n.healthMax, health: n.alive ? n.health : 0,
        alive: !!n.alive, status: n.alive ? 'Active' : 'Neutralized'
      };
    });
  }
  function assessDenialOn(board) {
    if (!moeAvailable()) return null;
    return window.MoeModule.assessGraph(moeRedNodes(board));
  }

  function advanceDenialState(board, currentLodgment, opts) {
    opts = opts || {};
    const assessment = assessDenialOn(board);
    if (!assessment) return { assessment: null, lodgment: clamp(Number(currentLodgment || 0), 0, 1), outcome: null };
    const requiredTurns = Math.max(0.5, Number(opts.requiredTurns || LODGMENT_REQ_TURNS));
    const lodgment = clamp(Number(currentLodgment || 0) + assessment.throughput / requiredTurns, 0, 1);
    // Same ordering as evaluateVictory: a completed lodgment cannot be un-landed by a
    // simultaneous halt; otherwise throughput below tMin is a Blue halt.
    const outcome = lodgment >= 1 ? 'red' : assessment.halt ? 'blue' : null;
    return { assessment, lodgment, outcome, requiredTurns };
  }

  // ---- Horizon projection (GAME_DESIGN §3.5 / §6) -----------------------------------
  // The clock is HARD (P3): if the fait-accompli window expires with neither a halt nor
  // a completed lodgment, we never extend play. Instead the engine MC-projects the
  // continuation from the FINAL state — both sides handed to their AI commanders — and
  // scores the distribution ("lodgment sustained in N% of projected continuations").
  // Fully seeded and deterministic: trial t draws only from
  // makeRng(hashSeed(matchSeed, 'projection', t)) — the same seeding machinery as turn
  // resolution. No Math.random() / Date.now() anywhere in this path.
  function cloneBoardForProjection(board) {
    // resolveTurn mutates only health/alive; adj + rosters are read-only and per-node
    // arrays (vulns/domain) are never written — a per-node shallow copy is a complete
    // snapshot for continuation trials.
    const nodes = {};
    for (const id in board.nodes) nodes[id] = Object.assign({}, board.nodes[id]);
    return {
      nodes, adj: board.adj,
      rosters: { blue: (board.rosters.blue || []).slice(), red: (board.rosters.red || []).slice() },
      reserves: { blue: (board.reserves && board.reserves.blue || []).slice(), red: (board.reserves && board.reserves.red || []).slice() },
      strategic: board.strategic || null
    };
  }
  function projectContinuation() {
    if (!moeAvailable()) return null;
    const round2 = (v) => Math.round(v * 100) / 100;
    let lodgmentSustained = 0, halted = 0, undecided = 0, thruSum = 0;
    const finalLodg = [];
    for (let t = 0; t < PROJECTION_TRIALS; t++) {
      const board = cloneBoardForProjection(match.board);
      let lodg = match.lodgment ? match.lodgment.value : 0;
      let a = null, outcome = null;
      for (let step = 1; step <= PROJECTION_HORIZON_TURNS; step++) {
        // Planning complexity must never consume the combat RNG stream. Projection uses
        // independent, addressable plan and resolution tags for every trial/step/side.
        const blueOrders = planOrders(board, 'blue', apForBoard(board, 'blue'), redMind().BALANCED,
          makeRng(hashSeed(match.seed, 'projection-plan-blue', t, step)));
        const redOrders = planOrders(board, 'red', apForBoard(board, 'red'), redMind().doctrine(match.redMind && match.redMind.doctrine),
          makeRng(hashSeed(match.seed, 'projection-plan-red', t, step)));
        resolveTurn(board, blueOrders.concat(redOrders), match.cfg,
          makeRng(hashSeed(match.seed, 'projection-resolve', t, step)));
        const advanced = advanceDenialState(board, lodg, { requiredTurns: match.cfg.lodgmentRequiredTurns || LODGMENT_REQ_TURNS });
        a = advanced.assessment;
        lodg = advanced.lodgment;
        if (advanced.outcome) { outcome = advanced.outcome; break; }
      }
      // Trials still open at the projection horizon score by the halt criterion: not
      // halted means the crossing remains viable — lodgment sustained [CSIS-FB Ch.5].
      if (!outcome) { undecided++; outcome = 'red'; }
      if (outcome === 'red') lodgmentSustained++; else halted++;
      finalLodg.push(lodg);
      thruSum += a ? a.throughput : 0;
    }
    finalLodg.sort((x, y) => x - y);
    const winner = lodgmentSustained > halted ? 'red' : halted > lodgmentSustained ? 'blue' : 'draw';
    return {
      method: 'mc-continuation',
      trials: PROJECTION_TRIALS,
      horizonTurns: PROJECTION_HORIZON_TURNS,
      from: {
        turn: Math.min(match.turn, match.cfg.turnLimit),
        dday: ddayForTurn(Math.min(match.turn, match.cfg.turnLimit)),
        lodgment: round2(match.lodgment ? match.lodgment.value : 0)
      },
      // Complementary by construction (sustained + halted === trials) so the two
      // headline percentages always sum to 100 in the UI; raw counts ride along for
      // the explain-panel (P2: every estimate inspectable to its inputs).
      lodgmentSustainedPct: Math.round(lodgmentSustained / PROJECTION_TRIALS * 100),
      haltPct: 100 - Math.round(lodgmentSustained / PROJECTION_TRIALS * 100),
      counts: { lodgmentSustained, halted, undecidedAtHorizon: undecided },
      undecidedAtHorizonPct: Math.round(undecided / PROJECTION_TRIALS * 100),
      medianFinalLodgment: round2(finalLodg[Math.floor(PROJECTION_TRIALS / 2)]),
      meanFinalThroughput: round2(thruSum / PROJECTION_TRIALS),
      winner
    };
  }

  // ---- Victory arbiter (GAME_DESIGN §6 / §10 Increment A) ---------------------------
  // INVASION play is decided by the denial model, not attrition: MoeModule.assessGraph
  // over the live Red roster is the arbiter. Blue wins by HALT before the window closes
  // (Red throughput under tMin — the crossing culminates); Red wins by ACCUMULATED
  // LODGMENT before the HARD turn limit; a window that expires undecided is resolved by
  // a seeded MC projection of the continuation — never by extending the clock. The
  // legacy collapse / key-objective checks are retained only as a rare early-collapse
  // out (a side annihilated outright), and the legacy score decision survives solely as
  // the fallback when MoeModule is absent.
  //
  // KNOWN-DEGENERATE WINDOW (until Increment C — documented per §10 Increment A): with
  // node-level strike verbs, no typed magazines (Increment B) and no chip apportionment
  // (Increment C), Blue can spam counter-lift strikes on the Amphibious Lift subsystem
  // every turn at no opportunity cost, which reliably suppresses Red throughput. The Red
  // lodgment-protection bias in planOrders (harden/repair weighting via lodgmentWeightOf)
  // is the Increment A counterweight; magazine scarcity and command-altitude chips close
  // the exploit properly.
  function evaluateVictory(force, assessment) {
    const objBlue = objectiveValue(match.board, 'blue');
    const objRed = objectiveValue(match.board, 'red');
    // Guard degenerate boards: a side with no starting objective value can't "collapse" from
    // nothing (0 <= 0). Without this, an empty or one-sided roster declares a bogus winner.
    if (!(match.startObj.blue > 0) || !(match.startObj.red > 0)) { match.winner = null; return; }
    const blueCollapsed = objBlue <= match.startObj.blue * match.cfg.collapseFrac;
    const redCollapsed = objRed <= match.startObj.red * match.cfg.collapseFrac;
    // Key-terrain / decapitation loss: a side that loses most of its key objectives is
    // defeated even if its overall force is otherwise intact.
    const oB = objectiveStatus('blue'), oR = objectiveStatus('red');
    const blueKeyLost = oB.total > 0 && (oB.held / oB.total) <= OBJ_LOSS_FRAC;
    const redKeyLost = oR.total > 0 && (oR.held / oR.total) <= OBJ_LOSS_FRAC;
    const blueDown = blueCollapsed || blueKeyLost;
    const redDown = redCollapsed || redKeyLost;
    // Decide + record: winner and the s.result contract shape ({winner, reason, projection},
    // plus additive detail/at fields) are always set together so they can never disagree.
    const finish = (winner, reason, projection, detail) => {
      match.winner = winner;
      match.result = {
        winner, reason,
        projection: projection || null,
        detail: detail || null,
        at: { turn: Math.min(match.turn, match.cfg.turnLimit), dday: ddayForTurn(Math.min(match.turn, match.cfg.turnLimit)) }
      };
    };

    // 1) Rare early-collapse out (legacy): a side annihilated outright ends the match
    //    immediately, mapped onto the denial vocabulary — Red's invasion system gone is
    //    a halt; Blue's kill chain gone leaves the crossing unopposed (lodgment). Mutual
    //    collapse settles by the side-neutral tie-break (-> can draw), never a Blue default.
    if (blueDown && redDown) {
      const w = neutralTieBreak();
      finish(w, w === 'blue' ? 'halt' : w === 'red' ? 'lodgment' : 'horizon', null, 'mutual-collapse');
      return;
    }
    if (redDown) { finish('blue', 'halt', null, 'early-collapse'); return; }
    if (blueDown) { finish('red', 'lodgment', null, 'early-collapse'); return; }

    // 2) Denial arbiter for invasion play. Blockade scenarios get their own MOE track
    //    (Increment F, §6) and bypass the lodgment arbiter via cfg.moeTrack.
    const invasion = (match.cfg.moeTrack || 'invasion') === 'invasion';
    const moe = invasion ? (assessment !== undefined ? assessment : assessDenialOn(match.board)) : null;
    if (moe) {
      // Red wins by accumulated lodgment before the hard limit: the landed force is
      // ashore — a later halt cannot un-land it, so this is checked first.
      if (match.lodgment && match.lodgment.value >= 1) { finish('red', 'lodgment', null, 'lodgment-complete'); return; }
      // Blue wins by halt-before-window: throughput below tMin — the crossing has
      // culminated (capitulation when Red C2 has also collapsed, per moe.js).
      if (moe.halt) { finish('blue', 'halt', null, moe.capitulation ? 'capitulation' : 'throughput-below-tmin'); return; }
      // 3) Hard clock (§3.5): window expired undecided -> seeded MC projection from the
      //    final state. Never extend the clock; never fall back to the attrition score.
      if (force || match.turn > match.cfg.turnLimit) {
        const projection = projectContinuation();
        finish(projection.winner, 'horizon', projection, 'window-expired');
      }
      return;
    }

    // 4) Fallback (MoeModule absent — warned once in moeAvailable — or a non-invasion
    //    track pre-Increment-F): legacy score decision, with s.result still populated so
    //    consumers always see the contract shape.
    if (force || match.turn > match.cfg.turnLimit) {
      let w;
      if (match.score.blue !== match.score.red) w = match.score.blue > match.score.red ? 'blue' : 'red';
      else w = neutralTieBreak();
      finish(w, 'horizon', null, 'legacy-score');
    }
  }

  function emptyMethodStats() {
    const out = {};
    METHOD_KEYS.forEach(k => { out[k] = { attempts: 0, hits: 0, misses: 0, kills: 0, damage: 0 }; });
    return out;
  }

  function emptySideAar(side) {
    return {
      side,
      orders: 0,
      strikes: 0,
      harden: 0,
      repair: 0,
      hits: 0,
      misses: 0,
      kills: 0,
      cascades: 0,
      damage: 0,
      repaired: 0,
      methods: emptyMethodStats(),
      sources: {}
    };
  }

  function round1(v) { return Math.round((Number(v) || 0) * 10) / 10; }

  function recordSource(sideStats, node, order) {
    const name = node ? node.name : (order.sourceId || 'Unassigned source');
    const key = node ? node.id : name;
    if (!sideStats.sources[key]) {
      sideStats.sources[key] = {
        id: key,
        name,
        subsystem: node ? node.subsystem : '',
        strikes: 0
      };
    }
    sideStats.sources[key].strikes += 1;
  }

  function targetRecord(targets, node, id) {
    const key = id || (node && node.id) || 'unknown';
    if (!targets[key]) {
      targets[key] = {
        id: key,
        name: node ? node.name : key,
        team: node ? node.team : '',
        damage: 0,
        hits: 0,
        killed: false,
        cascaded: false,
        value: node ? nodeValue(node) : 0
      };
    }
    return targets[key];
  }

  function buildAar() {
    if (!match) return null;
    const sides = { blue: emptySideAar('blue'), red: emptySideAar('red') };
    const targets = {};
    const scoreByTurn = [];
    const cumulative = { blue: 0, red: 0 };

    match.history.forEach(h => {
      const row = {
        turn: h.turn,
        blueDelta: round1(h.report.scoreDelta.blue),
        redDelta: round1(h.report.scoreDelta.red),
        blueScore: 0,
        redScore: 0,
        kills: { blue: 0, red: 0 }
      };

      ['blue', 'red'].forEach(side => {
        (h.orders[side] || []).forEach(o => {
          const sideStats = sides[side];
          sideStats.orders += 1;
          if (o.kind === 'strike') {
            const m = sideStats.methods[o.methodKey] || sideStats.methods.kinetic;
            sideStats.strikes += 1;
            m.attempts += 1;
            recordSource(sideStats, match.board.nodes[o.sourceId], o);
          } else if (o.kind === 'harden') {
            sideStats.harden += 1;
          } else if (o.kind === 'repair') {
            sideStats.repair += 1;
          }
        });
      });

      (h.report.events || []).forEach(e => {
        const side = e.side;
        const sideStats = sides[side];
        const target = match.board.nodes[e.targetId];
        if (!sideStats) return;
        if (e.kind === 'hit' || e.kind === 'miss') {
          const m = sideStats.methods[e.method] || sideStats.methods.kinetic;
          if (e.kind === 'hit') {
            const damage = Number(e.damage || 0);
            sideStats.hits += 1;
            sideStats.damage += damage;
            m.hits += 1;
            m.damage += damage;
            const rec = targetRecord(targets, target, e.targetId);
            rec.damage += damage;
            rec.hits += 1;
          } else {
            sideStats.misses += 1;
            m.misses += 1;
          }
        } else if (e.kind === 'kill') {
          sideStats.kills += 1;
          if (e.method && sideStats.methods[e.method]) sideStats.methods[e.method].kills += 1;
          row.kills[side] += 1;
          const rec = targetRecord(targets, target, e.targetId);
          rec.killed = true;
        } else if (e.kind === 'cascade') {
          const damage = Number(e.damage || 0);
          sideStats.cascades += 1;
          sideStats.damage += damage;
          row.kills[side] += 1;
          const rec = targetRecord(targets, target, e.targetId);
          rec.damage += damage;
          rec.killed = true;
          rec.cascaded = true;
        } else if (e.kind === 'repair') {
          sideStats.repaired += Number(e.amount || 0);
        }
      });

      cumulative.blue += h.report.scoreDelta.blue;
      cumulative.red += h.report.scoreDelta.red;
      row.blueScore = round1(cumulative.blue);
      row.redScore = round1(cumulative.red);
      scoreByTurn.push(row);
    });

    ['blue', 'red'].forEach(side => {
      const s = sides[side];
      s.damage = round1(s.damage);
      s.repaired = round1(s.repaired);
      Object.keys(s.methods).forEach(k => { s.methods[k].damage = round1(s.methods[k].damage); });
      s.topSources = Object.values(s.sources).sort((a, b) => b.strikes - a.strikes).slice(0, 4);
      delete s.sources;
    });

    const objNow = { blue: objectiveValue(match.board, 'blue'), red: objectiveValue(match.board, 'red') };
    const blueCollapsed = objNow.blue <= match.startObj.blue * match.cfg.collapseFrac;
    const redCollapsed = objNow.red <= match.startObj.red * match.cfg.collapseFrac;
    const oB = objectiveStatus('blue'), oR = objectiveStatus('red');
    const blueKeyLost = oB.total > 0 && (oB.held / oB.total) <= OBJ_LOSS_FRAC;
    const redKeyLost = oR.total > 0 && (oR.held / oR.total) <= OBJ_LOSS_FRAC;
    const mutual = (blueCollapsed || blueKeyLost) && (redCollapsed || redKeyLost);
    const isDraw = match.winner === 'draw';
    // Denial-arbiter verdict text (Increment A). Early-collapse / mutual-collapse /
    // legacy-score endings fall through to the legacy attrition wording below.
    const r = match.result;
    const denialReason = !r ? null
      : r.detail === 'capitulation' ? 'Denial achieved — Red throughput halted and Red C2 collapsed (capitulation)'
        : r.detail === 'throughput-below-tmin' ? 'Denial achieved — Red amphibious throughput halted before the window closed'
          : r.detail === 'lodgment-complete' ? 'Red accumulated a decisive lodgment before the window closed'
            : (r.reason === 'horizon' && r.projection)
              ? ('Window expired undecided — projected continuations: lodgment sustained in '
                + r.projection.lodgmentSustainedPct + '%, halted in ' + r.projection.haltPct + '%')
              : null;
    const reason = denialReason || (isDraw ? (mutual ? 'Mutual collapse — contested draw (forces dead even)' : 'Turn limit — contested draw (forces dead even)')
      : mutual ? 'Mutual collapse — settled by combat power'
        : redKeyLost ? `Red lost its key objectives (${oR.lost}/${oR.total})`
          : blueKeyLost ? `Blue lost its key objectives (${oB.lost}/${oB.total})`
            : redCollapsed ? 'Red force collapsed'
              : blueCollapsed ? 'Blue force collapsed'
                : 'Turn-limit score decision');

    const targetList = Object.values(targets);
    return {
      winner: match.winner,
      reason,
      // Denial-victory record (Increment A) so the AAR surface can render the verdict,
      // trend, and lodgment track without re-reading live match internals.
      result: match.result || null,
      denialHistory: (match.denialHistory || []).slice(),
      lodgment: match.lodgment ? { value: match.lodgment.value, history: (match.lodgment.history || []).slice() } : null,
      calendar: match.calendar ? { turnLengthDays: match.calendar.turnLengthDays, dday: match.calendar.dday } : null,
      redMind: {
        doctrine: match.redMind && match.redMind.doctrine || null,
        prior: Object.assign({}, match.redMind && match.redMind.prior || redMind().PRIOR),
        belief: Object.assign({}, match.redMind && match.redMind.belief || redMind().PRIOR),
        reasoningHistory: (match.redMind && match.redMind.reasoningHistory || []).slice(),
        trajectory: (match.redMind && match.redMind.trajectory || []).map(row => ({ turn: row.turn, belief: Object.assign({}, row.belief), evidence: Object.assign({}, row.evidence || {}) }))
      },
      strategic: match.strategic ? JSON.parse(JSON.stringify({
        escalation: match.strategic.escalation,
        roe: match.strategic.roe,
        allies: match.strategic.allies,
        activation: match.strategic.activation,
        indicators: match.strategic.indicators,
        signalHistory: match.strategic.signalHistory
      })) : null,
      turns: match.history.length,
      scoreMargin: round1(match.score.blue - match.score.red),
      scoreByTurn,
      sides,
      topDamaged: targetList.slice().sort((a, b) => b.damage - a.damage).slice(0, 6),
      topNeutralized: targetList.filter(t => t.killed).sort((a, b) => b.value - a.value).slice(0, 6)
    };
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
  // v2 saves embed a scenario FINGERPRINT (C-011) so a resume can verify it is replaying
  // against the same graph, plus savedGraphState and lastReport so a loaded match is self-
  // contained (can restore the scenario on exit and keep its resolved-turn log). v1 saves
  // (no fingerprint) still load, but cannot be integrity-checked — deserialize flags that.
  // v3 saves additionally carry the denial-victory state (calendar / denialHistory /
  // lodgment / result — Increment A). v4 adds the PUBLIC Red-mind prior/belief and
  // reasoning instrumentation; v5 adds engine-enforced per-side order locks; v6 adds
  // escalation, ROE, indicators, ally posture, activation groups, and AI precommit state. The hidden
  // doctrine is never serialized; it is derived from the seed on load. Older saves
  // default all additive fields safely.
  function serialize() {
    if (!match) return null;
    const health = {};
    for (const id in match.board.nodes) { const n = match.board.nodes[id]; health[id] = { h: n.health, a: n.alive }; }
    return {
      v: 6, seed: match.seed, turn: match.turn, phase: match.phase,
      fingerprint: match.fingerprint || null,
      cfg: match.cfg, score: match.score, startObj: match.startObj,
      baseAp: match.baseAp, dynamicAp: match.dynamicAp, startTempo: match.startTempo,
      objectives: match.objectives,
      // v3 additions (Increment A): denial-victory state — additive and versioned, like
      // the fingerprint scheme; v1/v2 loaders below default them safely.
      calendar: match.calendar || null,
      denialHistory: match.denialHistory || [],
      lodgment: match.lodgment || { value: 0, history: [] },
      result: match.result || null,
      redMind: {
        modelVersion: 1,
        prior: Object.assign({}, match.redMind && match.redMind.prior || redMind().PRIOR),
        belief: Object.assign({}, match.redMind && match.redMind.belief || redMind().PRIOR),
        reasoningHistory: (match.redMind && match.redMind.reasoningHistory || []).slice(),
        trajectory: (match.redMind && match.redMind.trajectory || []).map(row => ({ turn: row.turn, belief: Object.assign({}, row.belief), evidence: Object.assign({}, row.evidence || {}) }))
      },
      strategic: JSON.parse(JSON.stringify(match.strategic || null)),
      aiCommitted: Object.assign({}, match.aiCommitted || { blue: false, red: false }),
      // CO-005 A6 (additive): the public player-habit model. Contains only the
      // human player's own order statistics — never the hidden doctrine.
      playerModel: JSON.parse(JSON.stringify(match.playerModel || redMind().emptyPlayerModel())),
      history: match.history,
      orders: match.orders, orderLocks: match.orderLocks || { blue: false, red: false }, winner: match.winner, health,
      lastReport: match.lastReport || null,
      savedGraphState: match.savedGraphState || null
    };
  }
  // Load a serialized match. INTEGRITY GATE (C-011): before touching the live graph, compare
  // the save's scenario fingerprint to the active graph's. On mismatch we REFUSE by default —
  // returning { ok:false, reason:'fingerprint-mismatch', ... } and leaving any in-progress
  // match and the live graph untouched — so a resume never silently replays against the wrong
  // board. Pass opts.force === true to load anyway (deliberate what-if reuse); the returned
  // state then carries a `scenarioMismatch` flag so the UI can warn. v1 saves (no fingerprint)
  // load with `scenarioUnknown` set rather than being blocked, preserving old-save resumes.
  // Returns the live match state on success (back-compat), or a {ok:false,...} report on refusal.
  function deserialize(s, opts) {
    if (!s) return null;
    opts = opts || {};
    const graph = (window.AppState && window.AppState.activeGraph()) || { nodes: [], links: [] };
    const activeFp = computeFingerprint(graph);
    const savedFp = s.fingerprint || null;
    let mismatch = false, unknown = false;
    if (savedFp) {
      if (!fingerprintsMatch(savedFp, activeFp)) {
        mismatch = true;
        if (!opts.force) {
          // Refuse: do NOT mutate the live graph or replace any active match.
          return {
            ok: false,
            reason: 'fingerprint-mismatch',
            message: 'Saved match was built on a different scenario graph (saved ' +
              savedFp.nodes + ' nodes / ' + savedFp.links + ' links vs active ' +
              activeFp.nodes + ' / ' + activeFp.links + '). Load the original scenario, or resume with force to replay anyway.',
            savedFingerprint: savedFp,
            activeFingerprint: activeFp
          };
        }
      }
    } else {
      unknown = true;   // legacy save with no fingerprint — can't verify
    }

    const board = buildBoard(graph);
    if (s.health) for (const id in s.health) { if (board.nodes[id]) { board.nodes[id].health = s.health[id].h; board.nodes[id].alive = s.health[id].a; } }
    const dcfg = Object.assign({}, DEFAULT_CFG, s.cfg);
    const fallbackStrategic = makeStrategicState({ strategic: dcfg.strategic, roeId: dcfg.roeId }, board);
    const strategic = s.strategic ? JSON.parse(JSON.stringify(s.strategic)) : fallbackStrategic;
    strategic.config = strategic.config || strategicConfig(dcfg.strategic);
    strategic.roe = strategic.roe || selectedRoe(dcfg.roeId);
    strategic.pendingActivations = Array.isArray(strategic.pendingActivations) ? strategic.pendingActivations : [];
    strategic.blueIndicatorsNext = Array.isArray(strategic.blueIndicatorsNext) ? strategic.blueIndicatorsNext : [];
    strategic.signalHistory = Array.isArray(strategic.signalHistory) ? strategic.signalHistory : [];
    strategic.indicators = strategic.indicators || { current: [], history: [] };
    board.strategic = strategic;
    syncActivationRosters(board, strategic.activation);
    // Rehydrate lastReport (saved in v2; else derive from the last history entry) so resuming
    // a resolved phase keeps its turn log / AAR context.
    let lastReport = s.lastReport || null;
    if (!lastReport && Array.isArray(s.history) && s.history.length) {
      const last = s.history[s.history.length - 1];
      if (last && last.report) lastReport = { turn: last.turn, events: last.report.events, scoreDelta: last.report.scoreDelta };
    }
    match = {
      cfg: dcfg, board, seed: s.seed,
      fingerprint: savedFp || activeFp,
      baseAp: s.baseAp || { blue: dcfg.apBlue, red: dcfg.apRed },
      dynamicAp: s.dynamicAp || { blue: false, red: false },
      startTempo: s.startTempo || { blue: commandTempo(board, 'blue'), red: commandTempo(board, 'red') },
      objectives: s.objectives || { blue: pickObjectives(board, 'blue'), red: pickObjectives(board, 'red') },
      turn: s.turn, phase: s.phase, orders: s.orders || { blue: [], red: [] },
      orderLocks: s.orderLocks || { blue: false, red: false },
      score: s.score || { blue: 0, red: 0 }, startObj: s.startObj || { blue: objectiveValue(board, 'blue'), red: objectiveValue(board, 'red') },
      history: Array.isArray(s.history) ? s.history.slice() : [], winner: s.winner || null,
      lastReport,
      // v3 denial-victory state (Increment A). v1/v2 saves resume with a calendar derived
      // from the turn counter and empty denial/lodgment tracks (per-turn assessments are
      // not replayed here); new turns extend the tracks normally from the loaded board.
      calendar: (s.calendar && typeof s.calendar.dday === 'number')
        ? { turnLengthDays: Number(s.calendar.turnLengthDays) || TURN_LENGTH_DAYS, dday: s.calendar.dday }
        : { turnLengthDays: TURN_LENGTH_DAYS, dday: ddayForTurn(s.turn || 1) },
      denialHistory: Array.isArray(s.denialHistory) ? s.denialHistory.slice() : [],
      lodgment: (s.lodgment && typeof s.lodgment.value === 'number')
        ? { value: clamp(s.lodgment.value, 0, 1), history: Array.isArray(s.lodgment.history) ? s.lodgment.history.slice() : [] }
        : { value: 0, history: [] },
      result: s.result || null,
      strategic,
      aiCommitted: Object.assign({ blue: false, red: false }, s.aiCommitted || {}),
      // CO-005 A6: version-guarded restore — unknown/older shapes fall back to a fresh model.
      playerModel: redMind().normalizePlayerModel(s.playerModel),
      redMind: {
        prior: redMind().normalizeBelief(s.redMind && s.redMind.prior || redMind().PRIOR),
        belief: redMind().normalizeBelief(s.redMind && s.redMind.belief || s.redMind && s.redMind.prior || redMind().PRIOR),
        doctrine: redMind().drawDoctrine(
          redMind().normalizeBelief(s.redMind && s.redMind.prior || redMind().PRIOR),
          makeRng(hashSeed(s.seed, 'doctrine'))
        ),
        reasoningHistory: Array.isArray(s.redMind && s.redMind.reasoningHistory)
          ? s.redMind.reasoningHistory.slice() : [],
        trajectory: Array.isArray(s.redMind && s.redMind.trajectory)
          ? s.redMind.trajectory.map(row => ({ turn: row.turn, belief: redMind().normalizeBelief(row.belief), evidence: Object.assign({}, row.evidence || {}) }))
          : [{ turn: 0, belief: redMind().normalizeBelief(s.redMind && s.redMind.prior || redMind().PRIOR), evidence: {} }]
      },
      // Capture the CURRENT graph state before overwriting it with loaded battle damage, so
      // exiting a loaded match still restores the scenario (even though older saves omitted it).
      savedGraphState: s.savedGraphState || (graph.nodes || []).map(n => ({ id: n.id, health: n.health, status: n.status }))
    };
    match.scenarioMismatch = mismatch;
    match.scenarioUnknown = unknown;
    syncBoardToGraph();
    const state = getState();
    ctx.onState(state);
    return state;
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

  // Public scenario-fingerprint helpers (C-011) so the UI / campaign can compute and compare
  // a graph's fingerprint before resuming or launching a match.
  function fingerprint(graph) {
    return computeFingerprint(graph || (window.AppState && window.AppState.activeGraph()) || { nodes: [], links: [] });
  }
  // Does the active (or given) graph match a previously-saved fingerprint? Convenience for
  // gating a "Resume" button in the UI without forcing a load attempt.
  function fingerprintMatches(savedFp, graph) {
    return fingerprintsMatch(savedFp, fingerprint(graph));
  }
  // Read-only availability of the current match's scenario binding, for UI banners.
  function scenarioStatus() {
    if (!match) return null;
    return { mismatch: !!match.scenarioMismatch, unknown: !!match.scenarioUnknown, fingerprint: match.fingerprint || null };
  }

  return {
    init, newMatch, getState, queueOrder, removeOrder, clearOrders, preparePlan,
    commitTurn, nextTurn, endMatch, isActive, isHuman,
    boardNode, methods, methodKeys, strategicOptions, serialize, deserialize,
    // C-003: authoritative strike-availability helpers so the UI can gate buttons with the
    // exact rule the engine enforces.
    canStrike, validOrder,
    // C-011: scenario fingerprint helpers for save/resume integrity.
    fingerprint, fingerprintMatches, scenarioStatus,
    // exposed for headless testing / future reuse
    _internal: { buildBoard, resolveTurn, planOrders, planStrategicOrders, buildBeliefPlanCache,
      sampleBeliefPlan, updateDoctrineBelief, planHeuristic, lockOrders, unlockOrders, lockedOrderHash,
      cloneBoardForAi, resetBoardForAi, scoreAiRollout, makeRng, hashSeed, objectiveValue,
      canStrikeBoard, authorizeOrderBoard, sourcesForMethod, computeFingerprint, fingerprintsMatch,
      orderCost, spentAp, syncActivationRosters, escalationEventsForOrders, advanceStrategicState,
      // Increment A additions (denial arbiter plumbing):
      ddayForTurn, moeRedNodes, lodgmentWeightOf, advanceDenialState, apForBoard }
  };
})();
