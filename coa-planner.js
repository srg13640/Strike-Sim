/*
 * coa-planner.js — pure COA (Course of Action) planning core (CO-017).
 *
 * The COA Wizard's target scoring, target selection, and method-mix sequencing are pure
 * functions of their inputs (a node list + a wizard config). They were previously buried
 * in the StrikeSim2040.html shell closure with everything else and had no test coverage.
 * Lifting them here shrinks the shell, and — because they are pure — lets a headless proof
 * (tools/coa-planner-proof.js) exercise the scoring/selection/sequencing logic directly.
 *
 * This is deliberately ONLY the pure core. The DOM glue (wizard inputs/rendering, modals),
 * the Monte Carlo worker orchestration, and the goal-planner (which is welded to the
 * shell's live simulateTrial shim + strike helpers) stay in the shell for now; migrating
 * them safely needs an injection seam and browser/e2e coverage first. See CO-017.
 *
 * No DOM, no globals, no RNG — same inputs always yield the same output.
 *
 * UNCLASSIFIED // NOTIONAL RESEARCH TOOL
 */
(function () {
  'use strict';

  // Score a single node as a strike target under the wizard's emphasis/constraints.
  // Non-red or already-neutralized nodes are disqualified with -Infinity.
  function scoreNode(n, conf) {
    if (!n || n.team !== 'red' || n.status === 'Neutralized') return -Infinity;
    const diffW = { Soft: 1.10, Medium: 1.0, Hardened: 0.80, Buried: 0.65 };
    const base = (n.importance || 5) * 2 + (n.cascScore || 1) * 4 + (n.resourceGen || 0) * 3;
    // Emphasis: payoff vs risk
    let score = base;
    if (conf.objective === 'payoff') score *= 1.10;
    if (conf.objective === 'risk') score *= 0.95;
    // Difficulty influence modulated by aggressiveness (low aggr => more penalty)
    const dw = diffW[n.difficulty] || 1.0;
    const aggr = conf.aggressiveness ?? 0.5; // 0-1
    const safeFactor = 1 + (dw - 1) * (1 - aggr);
    score *= safeFactor;
    // Avoid heavily hardened/buried when asked
    if (conf.avoidHard && (n.difficulty === 'Hardened' || n.difficulty === 'Buried')) score *= 0.75;
    // Focus on Command/Relay
    const t = String(n.type || '').toLowerCase();
    if (conf.focusCTR && (t.includes('command') || t.includes('relay'))) score *= 1.20;
    // Prefer geolocated
    if (conf.preferGeo && (n.lat != null && n.lon != null)) score *= 1.10;
    return score;
  }

  // Pick up to conf.numTargets red targets by descending score. With disperseDomains,
  // cap how many share the same domain signature so the plan spreads across domains.
  function selectTargets(nodes, conf) {
    const reds = (nodes || []).filter(n => n.team === 'red' && n.status !== 'Neutralized');
    const scored = reds.map(n => ({ n, s: scoreNode(n, conf) })).sort((a, b) => b.s - a.s);
    if (!conf.disperseDomains) return scored.slice(0, conf.numTargets).map(x => x.n);
    // Disperse across domains: cap per-domain count
    const maxPerDomain = Math.max(1, Math.ceil(conf.numTargets / 3));
    const domainCount = new Map();
    const picked = [];
    for (const { n } of scored) {
      const dkey = (n.domain || []).slice(0).sort().join('|') || 'none';
      const cnt = domainCount.get(dkey) || 0;
      if (cnt >= maxPerDomain) continue;
      picked.push(n);
      domainCount.set(dkey, cnt + 1);
      if (picked.length >= conf.numTargets) break;
    }
    return picked;
  }

  // Turn a percentage method mix into an interleaved sequence of exactly `steps` methods,
  // with largest-remainder rounding so the counts sum to `steps` and stay proportional.
  function buildMethodSequence(mixPct, steps) {
    // Convert mix to counts with rounding consistency
    const keys = ['kinetic', 'cyber', 'ew', 'sof'];
    const raw = keys.map(k => ({ k, v: steps * (Math.max(0, Math.min(100, (mixPct && mixPct[k]) || 0)) / 100) }));
    const floors = raw.map(x => ({ k: x.k, c: Math.floor(x.v), frac: x.v - Math.floor(x.v) }));
    let sum = floors.reduce((a, b) => a + b.c, 0);
    let rem = steps - sum;
    floors.sort((a, b) => b.frac - a.frac);
    for (let i = 0; i < rem; i++) floors[i % floors.length].c++;
    const arr = [];
    floors.sort((a, b) => b.c - a.c);
    // Interleave for diversity
    while (arr.length < steps) {
      for (const f of floors) { if (f.c > 0 && arr.length < steps) { arr.push(f.k); f.c--; } }
    }
    return arr;
  }

  const api = { scoreNode, selectTargets, buildMethodSequence };
  if (typeof window !== 'undefined') window.CoaPlanner = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
