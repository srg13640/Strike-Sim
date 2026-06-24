/*
 * state.js — scenario-centric application state for the MDSC 3D Network Visualizer.
 *
 * This is the first step of modularization. It establishes a single owner for the
 * battlespace graph: a *scenario*. Today the app uses exactly one active scenario, so
 * behavior is unchanged — but making the scenario a first-class, isolated object now
 * means the future "multiple named scenarios" capability (switch/compare) becomes an
 * additive change rather than a rewrite.
 *
 * Contract relied on by DST2040.HTML:
 *   - AppState.activeGraph()            -> the active scenario's { nodes, links } object
 *   - AppState.replaceActiveGraph(g)    -> swaps the active scenario's graph, returns it
 * The main script binds its `data` variable to activeGraph(), so all existing in-place
 * mutations (push/splice/filter) flow through to the owning scenario automatically.
 *
 * No build step, no modules — loaded as a plain global <script> so it works offline
 * and over file:// just like the rest of the app.
 */
(function (global) {
  'use strict';

  let _seq = 0;
  const newId = () => `scn_${++_seq}`;
  const stamp = () => {
    // Browser context: Date is available. Guard anyway so the module never throws.
    try { return Date.now(); } catch (e) { return 0; }
  };

  function makeScenario(name, graph) {
    return {
      id: newId(),
      name: name || 'Untitled Scenario',
      graph: graph || { nodes: [], links: [] },
      createdAt: stamp()
    };
  }

  const AppState = {
    scenarios: [],
    activeId: null,

    /** The active scenario object, or null. */
    active() {
      return this.scenarios.find(s => s.id === this.activeId) || null;
    },

    /** The active scenario's graph ({ nodes, links }), or null. */
    activeGraph() {
      const s = this.active();
      return s ? s.graph : null;
    },

    /** Create a scenario; activates it by default (and always if none is active). */
    createScenario(name, graph, options) {
      const opts = options || {};
      const s = makeScenario(name, graph);
      this.scenarios.push(s);
      if (opts.activate !== false || this.activeId === null) this.activeId = s.id;
      return s;
    },

    /** Make an existing scenario active by id; returns the now-active scenario. */
    setActive(id) {
      if (this.scenarios.some(s => s.id === id)) this.activeId = id;
      return this.active();
    },

    /**
     * Replace the active scenario's graph in place and return the new graph object.
     * Used by the "replace import" path. If no scenario exists yet, one is created.
     */
    replaceActiveGraph(graph) {
      const next = graph || { nodes: [], links: [] };
      const s = this.active();
      if (s) { s.graph = next; return s.graph; }
      return this.createScenario('Scenario 1', next).graph;
    },

    /** List scenarios as lightweight summaries (for a future switcher UI). */
    list() {
      return this.scenarios.map(s => ({
        id: s.id,
        name: s.name,
        active: s.id === this.activeId,
        nodeCount: (s.graph && s.graph.nodes ? s.graph.nodes.length : 0),
        linkCount: (s.graph && s.graph.links ? s.graph.links.length : 0)
      }));
    },

    /** Wipe all state (used by hard resets/tests). */
    reset() {
      this.scenarios = [];
      this.activeId = null;
      _seq = 0;
    }
  };

  // Seed one default active scenario so the app always has somewhere to load into.
  AppState.createScenario('Scenario 1', { nodes: [], links: [] });

  global.AppState = AppState;
})(window);
