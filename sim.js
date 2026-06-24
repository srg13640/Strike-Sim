/*
 * sim.js — simulation foundation for the MDSC 3D Network Visualizer.
 *
 * Fifth modularization step. Holds the decoupled computational primitives of the
 * Monte Carlo / COA engine: the action/counter profiles, the seeded RNG, statistics
 * helpers, and the graph-snapshot builder. These have no DOM coupling and read the
 * battlespace only through the state layer (AppState.activeGraph()).
 *
 * SCOPE NOTE (deliberate): the heavier engine — simulateTrial, findBestGoalPlan and
 * ~20 interleaved helpers — was left in the main script for now. It is coupled to
 * config objects (teamResources/settings/strikeMethods) and interleaved with the COA
 * wizard/modal UI, so a clean extraction is a larger, careful effort best done
 * deliberately (it is also exactly the code Project Janus will modify — see the Janus
 * plan). This module is the foundation that engine work can grow into.
 *
 * Loads after state.js (needs AppState) and self-aliases its members onto their
 * original global names, so the engine code still in the main script keeps calling
 * createRng()/buildSimContext()/blueProfiles/etc. unchanged.
 */
window.SimModule = (function () {
  'use strict';

  // Profiles for Blue actions (probabilities and impact).
  const blueProfiles = {
    'Kinetic Strike':        { baseP: 0.55, impact: [25, 50], tag: 'kinetic' },
    'Cyber Attack':          { baseP: 0.50, impact: [15, 35], tag: 'cyber' },
    'EW Jamming':            { baseP: 0.65, impact: [5, 15],  tag: 'ew',    buffNext: { pMult: 1.15 } },
    'SOF Mission':           { baseP: 0.40, impact: [30, 60], tag: 'sof' },
    'Defensive Maneuver':    { baseP: 0.90, impact: [0, 5],   defenseBuff: { reduceRed: 0.85 } },
    'Intelligence Gathering':{ baseP: 0.85, impact: [0, 8],   buffNext: { pMult: 1.20 } },
    'Resource Allocation':   { baseP: 1.00, impact: [0, 0],   globalBuff: { pMult: 1.05 } }
  };

  // Profiles for Red counters (modify P or impact depending on Blue action/tag).
  const redProfiles = {
    'Counter-Strike':     { pMult: 0.90 },
    'Cyber Defense':      { tag: 'cyber', pMult: 0.80 },
    'EW Countermeasure':  { tag: 'ew',    pMult: 0.80 },
    'SOF Interception':   { tag: 'sof',   pMult: 0.75 },
    'Reinforcement':      { impactMult: 0.85, duration: 2 },
    'Deception':          { infoNerf: 0.85 },
    'Sabotage':           { globalPmult: 0.95 }
  };

  function randIn([a, b]) { return a + Math.random() * (b - a); }

  function createRng(seed = Date.now() % 2147483647) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return {
      next() {
        s = (s * 48271) % 2147483647;
        return s / 2147483647;
      },
      nextRange(min, max) {
        return min + (max - min) * this.next();
      },
      nextInt(min, max) {
        return Math.floor(this.nextRange(min, max + 1));
      }
    };
  }

  function percentile(arr, p) {
    if (!arr || arr.length === 0) return 0;
    const a = [...arr].sort((x, y) => x - y);
    const idx = Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))));
    return a[idx];
  }

  // Snapshot the active scenario graph into a read-only simulation context
  // (per-node info + adjacency) so trials never mutate live data.
  function buildSimContext() {
    const g = (window.AppState && window.AppState.activeGraph()) || { nodes: [], links: [] };
    const nodeInfo = new Map();
    g.nodes.forEach(n => {
      nodeInfo.set(n.id, {
        id: n.id,
        name: n.name,
        team: n.team,
        difficulty: n.difficulty,
        vulnerabilities: n.vulnerabilities || [],
        cascScore: n.cascScore || 1,
        importance: n.importance || 5,
        healthMax: n.healthMax || 100,
        health: n.health ?? (n.healthMax || 100),
        status: n.status || 'Active',
        domain: Array.isArray(n.domain) ? n.domain : (n.domain ? [n.domain] : []),
        type: n.type || ''
      });
    });
    const adj = new Map();
    g.links.forEach(l => {
      const s = l.source?.id ?? l.source;
      const t = l.target?.id ?? l.target;
      if (!nodeInfo.has(s) || !nodeInfo.has(t)) return;
      if (!adj.has(s)) adj.set(s, new Set());
      if (!adj.has(t)) adj.set(t, new Set());
      adj.get(s).add(t); adj.get(t).add(s);
    });
    return { nodeInfo, adj };
  }

  // Publish onto the original global names so the engine code still in the main
  // script (simulateTrial, runMonteCarlo, findBestGoalPlan, …) keeps working unedited.
  window.blueProfiles = blueProfiles;
  window.redProfiles = redProfiles;
  window.randIn = randIn;
  window.createRng = createRng;
  window.percentile = percentile;
  window.buildSimContext = buildSimContext;

  return { blueProfiles, redProfiles, randIn, createRng, percentile, buildSimContext };
})();
