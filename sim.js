/*
 * sim.js — simulation foundation for the MDSC 3D Network Visualizer.
 *
 * Fifth modularization step. Holds the decoupled computational primitives of the
 * Monte Carlo / COA engine: the action/counter profiles, the seeded RNG, statistics
 * helpers, and the graph-snapshot builder. These have no DOM coupling and read the
 * battlespace only through the state layer (AppState.activeGraph()).
 *
 * SCOPE NOTE: the COA wizard/modal UI glue (findBestGoalPlan, render*, ~20 interleaved
 * helpers) remains in the main script — it is tightly coupled to the DOM. The per-trial
 * MATH, however, now has a canonical home here: simulateTrialCore() is the single source
 * of truth for the trial step, taking every config object through opts (no globals). The
 * worker (sim-worker.js) carries a verbatim copy because it cannot always importScripts
 * this module offline; the inline copy in StrikeSim2040.html mirrors the same math.
 * SimModule.parityHash(seed, n) lets the app/tests assert all three copies agree.
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

  // Avalanche-mix (base, trialIndex) -> a well-spread 32-bit seed, so adjacent trials are
  // independent rather than near-linear in t (consecutive integers leave a simple LCG's first
  // draw near-linear in t, biasing the success rate). Same routine is used in sim-worker.js.
  // The >>> 0 / Math.imul coercions make a NaN base or t collapse to 0; a 0 result is then
  // remapped to a safe positive seed by createRng, so callers never get a NaN/zero RNG seed.
  function mcMixSeed(base, t) {
    let x = ((base >>> 0) ^ Math.imul(t, 0x9E3779B1)) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  }

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

  function mean(arr) {
    if (!arr || arr.length === 0) return 0;
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }

  // --- C-008: proper binomial confidence intervals for the success proportion ---
  //
  // The legacy UI used a Wald interval (p ± 1.96·sqrt(p(1-p)/n)), which collapses to
  // zero width at p=0 or p=1 and undercovers for small n — making an all-pass/all-fail
  // sample look decision-grade when the real uncertainty is still material. These score
  // intervals stay sensibly wide at the extremes and are the conservative signal planners
  // need. All return { lo, hi, p } as proportions in [0,1].

  // Wilson score interval. Defensive against n<=0 (returns the full [0,1] band).
  function wilsonInterval(successes, n, z = 1.96) {
    const N = Math.max(0, Math.floor(Number(n) || 0));
    if (N <= 0) return { lo: 0, hi: 1, p: 0 };
    let k = Math.floor(Number(successes) || 0);
    if (k < 0) k = 0;
    if (k > N) k = N;
    const zz = Number(z) || 1.96;
    const p = k / N;
    const z2 = zz * zz;
    const denom = 1 + z2 / N;
    const center = (p + z2 / (2 * N)) / denom;
    const half = (zz * Math.sqrt((p * (1 - p) + z2 / (4 * N)) / N)) / denom;
    return {
      lo: Math.max(0, center - half),
      hi: Math.min(1, center + half),
      p
    };
  }

  // Jeffreys interval (Beta(k+1/2, n-k+1/2) equal-tailed). Offered as an alternative to
  // Wilson; uses a small incomplete-beta inverse so it stays no-build/no-dep. Falls back
  // to Wilson if the numeric inversion misbehaves. Returns { lo, hi, p }.
  function jeffreysInterval(successes, n, conf = 0.95) {
    const N = Math.max(0, Math.floor(Number(n) || 0));
    if (N <= 0) return { lo: 0, hi: 1, p: 0 };
    let k = Math.floor(Number(successes) || 0);
    if (k < 0) k = 0;
    if (k > N) k = N;
    const c = Math.min(0.999999, Math.max(0.5, Number(conf) || 0.95));
    const alphaTail = (1 - c) / 2;
    const a = k + 0.5;
    const b = N - k + 0.5;
    const p = k / N;
    let lo = k === 0 ? 0 : betaInv(alphaTail, a, b);
    let hi = k === N ? 1 : betaInv(1 - alphaTail, a, b);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) {
      // Numeric fallback so a degenerate inversion never yields garbage bounds.
      const z = 1.959963984540054; // ~95% two-sided
      return wilsonInterval(k, N, z);
    }
    return { lo: Math.max(0, lo), hi: Math.min(1, hi), p };
  }

  // Regularized incomplete beta I_x(a,b) via Lentz's continued fraction. Pure JS, no deps.
  function betacf(x, a, b) {
    const FPMIN = 1e-30;
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1;
    let d = 1 - (qab * x) / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 200; m++) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-12) break;
    }
    return h;
  }

  function gammaln(z) {
    const g = [
      76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5
    ];
    let x = z, y = z, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) { y += 1; ser += g[j] / y; }
    return -tmp + Math.log((2.5066282746310005 * ser) / x);
  }

  function betaInc(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(
      gammaln(a + b) - gammaln(a) - gammaln(b) +
      a * Math.log(x) + b * Math.log(1 - x)
    );
    if (x < (a + 1) / (a + b + 2)) return (bt * betacf(x, a, b)) / a;
    return 1 - (bt * betacf(1 - x, b, a)) / b;
  }

  // Inverse of the regularized incomplete beta (quantile of Beta(a,b)) via bisection.
  function betaInv(prob, a, b) {
    const target = Math.min(1, Math.max(0, Number(prob) || 0));
    if (target <= 0) return 0;
    if (target >= 1) return 1;
    let lo = 0, hi = 1;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      const v = betaInc(mid, a, b);
      if (v < target) lo = mid; else hi = mid;
      if (hi - lo < 1e-12) break;
    }
    return (lo + hi) / 2;
  }

  // --- C-008: separate ALL-TRIAL stats from WIN-CONDITIONED stats ---
  //
  // The legacy UI conflated the two: "expected impact" was totalImpactOnSuccess/wins
  // (a win-conditioned mean) yet sat next to all-trial counts, and p50/p90 came from
  // success-only arrays but rendered numeric values (0) even with zero wins. This helper
  // returns both families under clearly distinct, labeled keys so callers cannot confuse
  // them. Win-conditioned percentiles are null (render as "N/A") when there are no wins.
  //
  // agg may be either a live aggregator (Maps) or a serialized one; only the array/scalar
  // fields are read here, so both shapes work.
  function summarizeTrialStats(agg, z = 1.96) {
    const completed = Math.max(0, Math.floor(Number(agg && agg.completedTrials) || 0));
    const wins = Math.max(0, Math.floor(Number(agg && agg.trialsSuccess) || 0));
    const n = Math.max(1, completed);
    const successRate = wins / n;
    const ci = wilsonInterval(wins, completed, z);

    const successImpacts = (agg && agg.successImpacts) || [];
    const stepsArr = (agg && agg.stepsToSuccessArr) || [];
    const redArr = (agg && agg.redNeutralizedArr) || [];
    const blueArr = (agg && agg.blueNeutralizedArr) || [];
    const blueSpendArr = (agg && agg.blueSpendArr) || [];
    const redSpendArr = (agg && agg.redSpendArr) || [];

    const hasWins = wins > 0;
    return {
      // Counts / proportion (ALL TRIALS).
      completedTrials: completed,
      winningTrials: wins,
      successRate,
      successCi: ci,                 // { lo, hi, p } proportions, Wilson score
      successCiHalf: (ci.hi - ci.lo) / 2,

      // WIN-CONDITIONED metrics (over winning trials only). null when no wins.
      impactOnWins: {
        n: wins,
        mean: hasWins ? mean(successImpacts) : null,
        p50: hasWins ? percentile(successImpacts, 0.5) : null,
        p90: hasWins ? percentile(successImpacts, 0.9) : null
      },
      stepsOnWins: {
        n: wins,
        mean: hasWins ? mean(stepsArr) : null,
        p50: hasWins ? percentile(stepsArr, 0.5) : null,
        p90: hasWins ? percentile(stepsArr, 0.9) : null
      },

      // ALL-TRIAL outcome metrics (computed over every completed trial).
      redNeutralizedAllTrials: { mean: mean(redArr), p50: percentile(redArr, 0.5), p90: percentile(redArr, 0.9) },
      blueLostAllTrials:      { mean: mean(blueArr), p50: percentile(blueArr, 0.5), p90: percentile(blueArr, 0.9) },
      blueSpendAllTrials:     { mean: mean(blueSpendArr), p50: percentile(blueSpendArr, 0.5), p90: percentile(blueSpendArr, 0.9) },
      redSpendAllTrials:      { mean: mean(redSpendArr), p50: percentile(redSpendArr, 0.5), p90: percentile(redSpendArr, 0.9) }
    };
  }

  // --- C-041: reproducible planner seeding (Common Random Numbers) ---
  //
  // Candidate plans must be judged on the SAME random draws, otherwise millisecond
  // timing decides the winner. plannerSeed() returns a stable base seed; combine it with
  // mcMixSeed(base, trialIndex) (the standard per-trial seeding used everywhere) so every
  // candidate sees an identical stream. Pass an explicit `recorded` value to replay a run.
  // Returns a positive 31-bit integer suitable for createRng after mixing.
  function plannerSeed(recorded) {
    if (recorded != null && Number.isFinite(Number(recorded))) {
      const r = Math.floor(Number(recorded)) % 2147483647;
      return r > 0 ? r : r + 2147483646;
    }
    const t = (Date.now() % 2147483647);
    return t > 0 ? t : 1;
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
    // B0: contexts built on the window path carry the MOE handle for successMode
    // 'denial'. The shared core only ever reads context.moe (never a global), so this
    // wrapper-layer default is what wires moe.js into inline trials. undefined (moe.js
    // not loaded) makes the core throw a clear 'denial unavailable' error when used.
    return { nodeInfo, adj, moe: (typeof window !== 'undefined' && window.MoeModule) || undefined };
  }

  // ===========================================================================
  // C-009: CANONICAL per-trial simulation core (single source of truth).
  //
  // Everything between the BEGIN/END SHARED CORE markers below is kept BYTE-IDENTICAL
  // with the copy in sim-worker.js (which cannot importScripts this module in every
  // offline context). The block sits at column 0 — inside this IIFE but deliberately
  // un-indented — so extracting the marked regions from both files and diffing them
  // proves the copies have not drifted (the diff must be empty). The inline copy in
  // StrikeSim2040.html mirrors the same math; parityHash() lets the app/tests assert
  // all copies agree.
  //
  // The core is fully self-contained: every config object (context, rng, teamResources,
  // settings, strikeMethods, redProfiles) arrives through `opts`, and context/rng are
  // REQUIRED — the public fallbacks live in simulateTrialCoreWithDefaults, after the
  // END marker. It does NOT read any global, so it produces identical numeric output
  // wherever it runs. The trial math/semantics are unchanged — only the copies converge.
  //
  // RNG DRAW ORDER (load-bearing for determinism): one intelQ draw up front; then per
  // executed step: one success draw, one damage draw on a hit, one red-counter damage
  // draw when Counter-Strike/SOF Interception fires. Do not reorder.
  // ===========================================================================

// === BEGIN SHARED CORE (keep byte-identical with sim-worker.js) ===

function simCoreMethodKeyFromStep(step) {
  if (step.methodKey) return step.methodKey;
  if (step.blueKey) return step.blueKey;
  if (step.blue === 'Kinetic Strike') return 'kinetic';
  if (step.blue === 'Cyber Attack') return 'cyber';
  if (step.blue === 'EW Jamming') return 'ew';
  if (step.blue === 'SOF Mission') return 'sof';
  return 'kinetic';
}

function simCoreDomainAffinity(srcInfo, dstInfo, methodKey) {
  if (!srcInfo || !dstInfo) return 1.0;
  const sd = new Set(srcInfo.domain || []);
  const dd = new Set(dstInfo.domain || []);
  const shared = Array.from(sd).some(d => dd.has(d));
  let mult = shared ? 1.3 : 1.0;
  const srcType = String(srcInfo.type || '').toLowerCase();
  const dstType = String(dstInfo.type || '').toLowerCase();
  if (srcType.includes('command') || dstType.includes('command') || srcType.includes('relay') || dstType.includes('relay')) {
    mult *= 1.15;
  }
  if ((methodKey === 'cyber' || methodKey === 'ew') && (dd.has('Cyber') || dd.has('EW') || dstType.includes('relay'))) {
    mult *= 1.15;
  }
  return Math.min(1.8, Math.max(0.8, mult));
}

function simCoreVulnMultiplier(info, method, intelQ) {
  const hasV = (info.vulnerabilities || []).includes(method.vulnerability);
  if (hasV) return Math.min(1.35, Math.max(1.0, 1.2 + (intelQ - 1) * 0.5));
  return Math.min(1.0, Math.max(0.6, 0.85 - (intelQ - 1) * 0.35));
}

function simCoreChooseRedCounter(methodKey, redBudget, redTypeBudget, detectionLevel, redProfiles) {
  const optionsByMethod = {
    kinetic: ['Counter-Strike', 'Reinforcement', 'Sabotage'],
    cyber: ['Cyber Defense', 'Deception', 'Reinforcement'],
    ew: ['EW Countermeasure', 'Deception', 'Reinforcement'],
    sof: ['SOF Interception', 'Reinforcement']
  };
  const redCounterCosts = { 'Cyber Defense': 1, 'EW Countermeasure': 1, 'SOF Interception': 1, 'Reinforcement': 1, 'Deception': 1, 'Sabotage': 2, 'Counter-Strike': 1 };
  const redCounterType = { 'Cyber Defense': 'cyber', 'EW Countermeasure': 'ew', 'SOF Interception': 'sof', 'Counter-Strike': 'ke', 'Reinforcement': 'ke', 'Deception': 'cyber', 'Sabotage': 'ke' };
  const opts = optionsByMethod[methodKey] || optionsByMethod.kinetic;
  let best = null;
  opts.forEach(name => {
    const cost = redCounterCosts[name] || 0;
    const cat = redCounterType[name] || 'ke';
    const canAfford = redTypeBudget?.[cat] !== undefined ? redTypeBudget[cat] >= cost : redBudget >= cost;
    if (!canAfford) return;
    const prof = (redProfiles || {})[name] || {};
    const pMult = prof.pMult ?? prof.globalPmult ?? 0.95;
    const strength = (1 - pMult) + detectionLevel * 0.2;
    if (!best || strength > best.strength) best = { name, cost, cat, strength };
  });
  return best;
}

function simulateTrialCore(actionPlan, opts) {
  const o = opts || {};
  // context and rng are REQUIRED — no defaults here, so the core stays byte-identical
  // across its copies. sim.js layers its public fallbacks (buildSimContext/createRng)
  // in a wrapper OUTSIDE the shared region; the worker always passes both explicitly.
  const context = o.context;
  const rng = o.rng;
  const successMode = o.successMode || 'impact';
  const successN = o.successN != null ? o.successN : 3;
  const victoryThreshold = o.victoryThreshold != null ? o.victoryThreshold : 100;
  const prioritySet = o.prioritySet || null;
  const maxBlueLoss = o.maxBlueLoss != null ? o.maxBlueLoss : Infinity;
  const regenFrac = o.regenFrac != null ? o.regenFrac : 0;
  const denialBalance = o.denialBalance != null ? o.denialBalance : 0.35;
  const denialParams = o.denialParams != null ? o.denialParams : null;
  const detectionGrowthTarget = o.detectionGrowthTarget != null ? o.detectionGrowthTarget : 0.08;
  const detectionGrowthDomain = o.detectionGrowthDomain != null ? o.detectionGrowthDomain : 0.04;
  const detectionPenalty = o.detectionPenalty != null ? o.detectionPenalty : 0.18;
  const intelNoise = o.intelNoise != null ? o.intelNoise : 0.15;
  const fatigueRate = o.fatigueRate != null ? o.fatigueRate : 0.03;
  const dynamicRed = o.dynamicRed !== false;
  const teamResources = o.teamResources || {};
  const settings = o.settings || { cascadeAlpha: 0.25, difficultyModifiers: {} };
  const strikeMethods = o.strikeMethods || {};
  const redProfiles = o.redProfiles || {};

  const { nodeInfo, adj } = context;
  // B0: injected MOE handle for successMode 'denial'. The core NEVER reads
  // window.MoeModule / self.MoeModule itself — each consumer's wrapper layer places
  // the handle on context.moe (sim.js defaults it from window, sim-worker.js from
  // the importScripts('moe.js') result, parity fixtures inject a pure-JS stub).
  // undefined here means denial mode is unavailable and is a hard error when used.
  const moe = context.moe;
  const blueBudgetBase = teamResources?.blue ?? 0;
  const redBudgetBase = teamResources?.red ?? 0;
  const normalizeTypeBudget = raw => {
    if (!raw || typeof raw !== 'object') return {};
    const value = raw;
    const canonical = Object.prototype.hasOwnProperty.call(value, 'cyber');
    return {
      ke: Number(value.ke || 0),
      cyber: Number(canonical ? value.cyber : (value.ew || 0)),
      ew: Number(canonical ? value.ew : (value.jam || 0)),
      sof: Number(value.sof || 0)
    };
  };
  const blueTypeBase = normalizeTypeBudget(teamResources?.blueTypes);
  const redTypeBase = normalizeTypeBudget(teamResources?.redTypes);
  const redCounterCosts = { 'Cyber Defense': 1, 'EW Countermeasure': 1, 'SOF Interception': 1, 'Reinforcement': 1, 'Deception': 1, 'Sabotage': 2, 'Counter-Strike': 1 };
  const redCounterType = { 'Cyber Defense': 'cyber', 'EW Countermeasure': 'ew', 'SOF Interception': 'sof', 'Counter-Strike': 'ke', 'Reinforcement': 'ke', 'Deception': 'cyber', 'Sabotage': 'ke' };
  const blueMethodType = { kinetic: 'ke', cyber: 'cyber', ew: 'ew', sof: 'sof' };

  const state = new Map();
  nodeInfo.forEach((info, id) => state.set(id, { alive: info.status !== 'Neutralized', health: info.health }));
  const detectionTarget = new Map();
  const detectionDomain = new Map();
  const fatigue = { kinetic: 0, cyber: 0, ew: 0, sof: 0 };
  const intelQ = 1 + (rng.next() * 2 - 1) * intelNoise;

  let impact = 0;
  let stepsToGoal = null;
  let lastDenial = null;
  let blueBudget = blueBudgetBase;
  let redBudget = redBudgetBase;
  let blueSpent = 0;
  let redSpent = 0;
  let blueTypeBudget = JSON.parse(JSON.stringify(blueTypeBase));
  let redTypeBudget = JSON.parse(JSON.stringify(redTypeBase));
  const redNeutralized = new Set();
  const blueNeutralized = new Set();
  const damageThisRun = new Map();

  function recordDamage(id, delta, info) {
    if (!info || info.team !== 'red' || !delta || delta <= 0) return;
    damageThisRun.set(id, (damageThisRun.get(id) || 0) + delta);
  }

  function pickRedTargetFromState() {
    let bestId = null;
    let bestScore = -Infinity;
    nodeInfo.forEach((info, id) => {
      const st = state.get(id);
      if (!st || !st.alive || info.team !== 'red') return;
      const diffW = { Soft: 1.1, Medium: 1.0, Hardened: 0.8, Buried: 0.6 };
      const base = (info.importance || 5) * 2 + (info.cascScore || 1) * 4;
      const score = base * (diffW[info.difficulty] || 1.0);
      if (score > bestScore) {
        bestScore = score;
        bestId = id;
      }
    });
    return bestId;
  }

  function applyCascade(srcId, srcInfo, methodKey) {
    const base = 5 * (srcInfo.cascScore || 1) * settings.cascadeAlpha;
    const neigh = adj.get(srcId) || new Set();
    neigh.forEach(nid => {
      const ninfo = nodeInfo.get(nid);
      const stn = state.get(nid);
      if (!ninfo || !stn?.alive) return;
      const mult = simCoreDomainAffinity(srcInfo, ninfo, methodKey);
      const cascadeDamage = base * mult;
      stn.health = Math.max(0, stn.health - cascadeDamage);
      recordDamage(nid, cascadeDamage, ninfo);
      if (stn.health <= 0 && stn.alive) {
        stn.alive = false;
        if (ninfo.team === 'red') redNeutralized.add(nid);
        else if (ninfo.team === 'blue') blueNeutralized.add(nid);
      }
    });
  }

  function successSatisfied() {
    if (successMode === 'impact') return impact >= victoryThreshold;
    if (successMode === 'nodes_any') return redNeutralized.size >= successN;
    if (successMode === 'nodes') {
      const pri = prioritySet || new Set();
      let count = 0;
      redNeutralized.forEach(id => { if (pri.has(id)) count++; });
      return count >= successN;
    }
    if (successMode === 'goal') {
      const pri = prioritySet || new Set();
      let count = 0;
      redNeutralized.forEach(id => { if (pri.has(id)) count++; });
      return count >= successN && blueNeutralized.size <= maxBlueLoss;
    }
    if (successMode === 'denial') {
      // MOE: denial achieved when Red's operation is halted / culminates / capitulates.
      // Scored through the injected handle so the core stays environment-free. Same call
      // semantics as the retired inline mirror: denialOutcome(state, nodeInfo, opts) with
      // the intent balance plus any explicit denial params. A missing handle throws (not
      // a silent false) — an unscored trial must never masquerade as a scored failure.
      if (!moe || typeof moe.denialOutcome !== 'function') {
        throw new Error("successMode 'denial' unavailable: context.moe is undefined — inject the MOE handle (MoeModule) as context.moe before running denial trials");
      }
      lastDenial = moe.denialOutcome(state, nodeInfo, Object.assign({ balance: denialBalance }, denialParams || {}));
      return lastDenial.success;
    }
    return false;
  }

  for (let i = 0; i < actionPlan.length; i++) {
    const step = actionPlan[i];
    const methodKey = simCoreMethodKeyFromStep(step);
    const method = strikeMethods[methodKey] || strikeMethods.kinetic;
    const targetId = step.targetId || pickRedTargetFromState();
    if (!targetId) break;
    let info = nodeInfo.get(targetId);
    let st = state.get(targetId);
    if (!info || !st?.alive) {
      const alt = pickRedTargetFromState();
      if (!alt) break;
      info = nodeInfo.get(alt);
      st = state.get(alt);
    }

    const diff = settings.difficultyModifiers[info.difficulty] || 1.0;
    const vuln = simCoreVulnMultiplier(info, method, intelQ);
    let p = method.baseProb * diff * vuln;

    const targetDet = detectionTarget.get(info.id) || 0;
    const domainKey = (info.domain || [])[0] || methodKey;
    const domainDet = detectionDomain.get(domainKey) || 0;
    p *= 1 - Math.min(0.6, (targetDet + domainDet) * detectionPenalty);
    p *= Math.max(0.7, 1 - fatigueRate * (fatigue[methodKey] || 0));

    let redChoice = null;
    if (dynamicRed) {
      redChoice = simCoreChooseRedCounter(methodKey, redBudget, redTypeBudget, targetDet + domainDet, redProfiles);
    } else if (step.red) {
      redChoice = { name: step.red, cost: redCounterCosts[step.red] || 0, cat: redCounterType[step.red] || 'ke' };
    }
    const redProfile = redChoice ? redProfiles[redChoice.name] || null : null;
    const redActive = redChoice && (redTypeBudget?.[redChoice.cat] !== undefined ? redTypeBudget[redChoice.cat] >= redChoice.cost : redBudget >= redChoice.cost);
    if (redActive && redProfile) {
      if (redProfile.globalPmult) p *= redProfile.globalPmult;
      if (redProfile.pMult) p *= redProfile.pMult;
    }

    p = Math.min(Math.max(p, 0.05), 0.98);
    const blueCost = method.cost || 0;
    const blueCat = blueMethodType[methodKey] || 'ke';
    const canAct = blueTypeBudget[blueCat] !== undefined ? blueTypeBudget[blueCat] >= blueCost : blueBudget >= blueCost;
    if (!canAct) continue;
    if (blueTypeBudget[blueCat] !== undefined) blueTypeBudget[blueCat] -= blueCost;
    else blueBudget -= blueCost;
    blueSpent += blueCost;

    if (redActive) {
      if (redTypeBudget?.[redChoice.cat] !== undefined) redTypeBudget[redChoice.cat] -= redChoice.cost;
      else redBudget -= redChoice.cost;
      redSpent += redChoice.cost;
    }

    const success = rng.next() < p;
    if (success) {
      const dmg = method.baseDamage[0] + rng.next() * (method.baseDamage[1] - method.baseDamage[0]);
      st.health = Math.max(0, st.health - dmg);
      recordDamage(info.id, dmg, info);
      if (st.health <= 0 && st.alive) {
        st.alive = false;
        if (info.team === 'red') redNeutralized.add(info.id);
        else if (info.team === 'blue') blueNeutralized.add(info.id);
      }
      impact += (info.importance || 5) * (info.cascScore || 1);
      applyCascade(info.id, info, methodKey);
    }

    detectionTarget.set(info.id, Math.min(1.0, (detectionTarget.get(info.id) || 0) + detectionGrowthTarget));
    detectionDomain.set(domainKey, Math.min(1.0, (detectionDomain.get(domainKey) || 0) + detectionGrowthDomain));
    fatigue[methodKey] = (fatigue[methodKey] || 0) + 1;

    if (redActive && (redChoice.name === 'Counter-Strike' || redChoice.name === 'SOF Interception')) {
      let cand = null;
      let best = -1;
      nodeInfo.forEach((bi, bid) => {
        const st2 = state.get(bid);
        if (bi.team === 'blue' && st2?.alive) {
          const score = (bi.importance || 5) + (bi.cascScore || 1) * 2;
          if (score > best) {
            best = score;
            cand = bid;
          }
        }
      });
      if (cand) {
        const st2 = state.get(cand);
        const rd = 15 + rng.next() * 35;
        st2.health = Math.max(0, st2.health - rd);
        if (st2.health <= 0 && st2.alive) {
          st2.alive = false;
          blueNeutralized.add(cand);
        }
      }
    }

    if (regenFrac > 0) {
      blueBudget += blueBudgetBase * regenFrac;
      redBudget += redBudgetBase * regenFrac;
      Object.keys(blueTypeBase).forEach(key => { blueTypeBudget[key] += blueTypeBase[key] * regenFrac; });
      Object.keys(redTypeBase).forEach(key => { redTypeBudget[key] += redTypeBase[key] * regenFrac; });
    }
    if (blueNeutralized.size > maxBlueLoss) break;
    if (successSatisfied() && stepsToGoal === null) stepsToGoal = i + 1;
  }

  return {
    // Property order is load-bearing for `denial`: success re-runs successSatisfied()
    // on the final state, which (in denial mode) refreshes lastDenial before it is
    // read on the next line — so `denial` is always the FINAL-state MOE outcome,
    // exactly like the inline mirror this replaces. null in every non-denial mode.
    success: successSatisfied(),
    denial: lastDenial,
    stepsToGoal: stepsToGoal ?? actionPlan.length,
    impact,
    redNeutralized,
    blueNeutralized,
    blueSpend: blueSpent,
    redSpend: redSpent,
    damageThisRun
  };
}

// C-009: deterministic parity helper. Runs n trials of the canonical core on a tiny
// fixed context with mcMixSeed(seed, t) per-trial seeding, and folds the per-trial
// results into a stable 32-bit hash. Pure function of (seed, n): same inputs → same
// hash, every time — so the copies of this core (SimModule in sim.js, the worker's
// {type:'parity'} handler, the inline mirror in the shell) can be asserted equal.
function parityFixture() {
  // Small, deterministic battlespace. No DOM, no globals.
  const nodeInfo = new Map();
  const mk = (id, team, extra) => Object.assign({
    id, name: id, team,
    difficulty: 'Medium', vulnerabilities: [], cascScore: 1, importance: 5,
    healthMax: 100, health: 100, status: 'Active', domain: [], type: ''
  }, extra || {});
  nodeInfo.set('R1', mk('R1', 'red', { importance: 8, cascScore: 2, domain: ['Cyber'], type: 'Command' }));
  nodeInfo.set('R2', mk('R2', 'red', { importance: 6, cascScore: 1, domain: ['EW'], difficulty: 'Hardened' }));
  nodeInfo.set('R3', mk('R3', 'red', { importance: 5, cascScore: 1, domain: ['Land'], type: 'Relay' }));
  nodeInfo.set('B1', mk('B1', 'blue', { importance: 7, cascScore: 2 }));
  const adj = new Map([
    ['R1', new Set(['R2', 'R3'])],
    ['R2', new Set(['R1'])],
    ['R3', new Set(['R1', 'B1'])],
    ['B1', new Set(['R3'])]
  ]);
  const context = { nodeInfo, adj };
  const opts = {
    context,
    successMode: 'nodes_any',
    successN: 2,
    victoryThreshold: 50,
    prioritySet: new Set(['R1', 'R2']),
    maxBlueLoss: 2,
    regenFrac: 0,
    dynamicRed: true,
    teamResources: { blue: 12, red: 8, blueTypes: { ke: 4, cyber: 4, ew: 2, sof: 2 }, redTypes: { ke: 3, cyber: 3, ew: 1, sof: 1 } },
    settings: { cascadeAlpha: 0.25, difficultyModifiers: { Soft: 1.2, Medium: 1.0, Hardened: 0.8, Buried: 0.6 } },
    strikeMethods: {
      kinetic: { name: 'Kinetic', baseProb: 0.55, cost: 2, baseDamage: [25, 50], vulnerability: 'armor' },
      cyber: { name: 'Cyber', baseProb: 0.50, cost: 1, baseDamage: [15, 35], vulnerability: 'network' },
      ew: { name: 'EW', baseProb: 0.65, cost: 1, baseDamage: [5, 15], vulnerability: 'rf' },
      sof: { name: 'SOF', baseProb: 0.40, cost: 2, baseDamage: [30, 60], vulnerability: 'access' }
    },
    // Inlined (not a reference to a module-level const) so every copy of this fixture
    // is self-contained and the copies stay byte-identical for parity.
    redProfiles: {
      'Counter-Strike':     { pMult: 0.90 },
      'Cyber Defense':      { tag: 'cyber', pMult: 0.80 },
      'EW Countermeasure':  { tag: 'ew',    pMult: 0.80 },
      'SOF Interception':   { tag: 'sof',   pMult: 0.75 },
      'Reinforcement':      { impactMult: 0.85, duration: 2 },
      'Deception':          { infoNerf: 0.85 },
      'Sabotage':           { globalPmult: 0.95 }
    }
  };
  const plan = [
    { methodKey: 'kinetic', targetId: 'R1' },
    { methodKey: 'cyber', targetId: 'R2' },
    { methodKey: 'ew' },
    { methodKey: 'sof', targetId: 'R3' },
    { methodKey: 'kinetic' }
  ];
  return { opts, plan };
}

// FNV-1a-style fold of a number into a running 32-bit hash (order-sensitive).
function parityFold(h, num) {
  // Quantize to avoid float drift; impact/steps/sizes are small integers or coarse.
  const q = Math.round((Number(num) || 0) * 1000) | 0;
  let x = (h ^ (q & 0xffff)) >>> 0;
  x = Math.imul(x, 16777619) >>> 0;
  x = (x ^ ((q >>> 16) & 0xffff)) >>> 0;
  x = Math.imul(x, 16777619) >>> 0;
  return x >>> 0;
}

function parityHash(seed, n) {
  const base = Number.isFinite(Number(seed)) ? (Number(seed) >>> 0) : 0;
  const count = Math.max(1, Math.floor(Number(n) || 1));
  const { opts, plan } = parityFixture();
  let h = 2166136261 >>> 0;
  for (let t = 1; t <= count; t++) {
    const trialOpts = Object.assign({}, opts, { rng: createRng(mcMixSeed(base, t)) });
    const r = simulateTrialCore(plan, trialOpts);
    h = parityFold(h, r.success ? 1 : 0);
    h = parityFold(h, r.stepsToGoal);
    h = parityFold(h, r.impact);
    h = parityFold(h, r.redNeutralized.size);
    h = parityFold(h, r.blueNeutralized.size);
    h = parityFold(h, r.blueSpend);
    h = parityFold(h, r.redSpend);
  }
  return h >>> 0;
}

// B0: denial-mode Monte Carlo summary (environment-free, so it lives in the shared
// core — ONE implementation feeds both the worker's {type:'done'} payload and the
// shell's inline chunked fallback via SimModule). Mirrors the inline runMonteCarlo
// denial accumulators exactly: per-trial arrays of denialIndex / throughput / osviRed
// plus halt & capitulation counts. "Chance of success" for denial mode is
// P(denialIndex >= 0.5), matching the shell's documented MC-note semantics.
// agg: { denialDiArr, denialTputArr, denialOsviArr, denialHalt, denialCap }.
function summarizeDenialStats(agg) {
  const a = agg || {};
  const diArr = a.denialDiArr || [];
  const tputArr = a.denialTputArr || [];
  const osviArr = a.denialOsviArr || [];
  const n = diArr.length;
  const avg = arr => {
    if (!arr || arr.length === 0) return 0;
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  };
  let denialSuccess = 0;
  for (let i = 0; i < n; i++) { if (diArr[i] >= 0.5) denialSuccess++; }
  const halt = Math.max(0, Math.floor(Number(a.denialHalt) || 0));
  const cap = Math.max(0, Math.floor(Number(a.denialCap) || 0));
  const meanThroughput = avg(tputArr);
  const meanOsvi = avg(osviArr);
  return {
    trials: n,
    meanDenialIndex: avg(diArr),
    meanThroughput,                          // mean residual Red throughput (0..1 of capacity)
    meanOsvi,                                // mean residual Red operational viability (0..1)
    throughputReduction: 1 - meanThroughput, // how far Red lift was driven down
    osviReduction: 1 - meanOsvi,
    haltRate: n > 0 ? halt / n : 0,
    capitulationRate: n > 0 ? cap / n : 0,
    successRate: n > 0 ? denialSuccess / n : 0 // P(denialIndex >= 0.5)
  };
}

// B0: denial-mode parity fixture. Reuses the parityFixture battlespace/plan but flips
// successMode to 'denial' with a minimal DETERMINISTIC pure-JS MOE stub injected as
// context.moe — deliberately NOT moe.js, so denial parity needs no external file in
// any environment (worker, window, Node harness). The stub is not the real model;
// it exists only to exercise the denial plumbing (injected handle, per-step scoring,
// result fields) with reproducible numbers.
function denialParityFixture() {
  const { opts, plan } = parityFixture();
  const stubMoe = {
    denialOutcome(stateMap, nodeInfo, o) {
      const bal = o && o.balance != null ? o.balance : 0.35;
      let base = 0;
      let cur = 0;
      nodeInfo.forEach((info, id) => {
        if (!info || info.team !== 'red') return;
        const cap = info.healthMax || info.health || 100;
        const st = stateMap && stateMap.get ? stateMap.get(id) : null;
        let hf = st ? (st.alive ? Math.min(1, Math.max(0, st.health / cap)) : 0)
                    : (info.status === 'Neutralized' ? 0 : 1);
        const w = info.importance == null ? 5 : info.importance;
        base += w;
        cur += w * hf;
      });
      const osvi = base > 0 ? cur / base : 1;
      const throughput = osvi * osvi; // exact float ops only (no Math.pow) for parity
      const capabilityDenial = Math.min(1, Math.max(0, (1 - throughput) / 0.7));
      const costDenial = Math.min(1, Math.max(0, (1 - osvi) / 0.55));
      const denialIndex = Math.min(1, Math.max(0, (1 - bal) * capabilityDenial + bal * costDenial));
      const halt = throughput < 0.30;
      return {
        denialIndex,
        success: denialIndex >= 0.5,
        halt,
        capitulation: halt && osvi < 0.30,
        throughput,
        osviRed: osvi
      };
    }
  };
  const denialOpts = Object.assign({}, opts, {
    context: { nodeInfo: opts.context.nodeInfo, adj: opts.context.adj, moe: stubMoe },
    successMode: 'denial',
    denialBalance: 0.35,
    denialParams: null
  });
  return { opts: denialOpts, plan };
}

// B0: parityHash's denial-mode sibling. Pure function of (seed, n); folds the standard
// trial fields PLUS the denial outcome fields, so a drift in either the trial math or
// the denial plumbing changes the hash. Must return identical values from sim.js,
// sim-worker.js, and any future consumer — the shell will assert this at boot later.
function denialParityHash(seed, n) {
  const base = Number.isFinite(Number(seed)) ? (Number(seed) >>> 0) : 0;
  const count = Math.max(1, Math.floor(Number(n) || 1));
  const { opts, plan } = denialParityFixture();
  let h = 2166136261 >>> 0;
  for (let t = 1; t <= count; t++) {
    const trialOpts = Object.assign({}, opts, { rng: createRng(mcMixSeed(base, t)) });
    const r = simulateTrialCore(plan, trialOpts);
    const d = r.denial || {};
    h = parityFold(h, r.success ? 1 : 0);
    h = parityFold(h, r.stepsToGoal);
    h = parityFold(h, r.impact);
    h = parityFold(h, r.redNeutralized.size);
    h = parityFold(h, r.blueNeutralized.size);
    h = parityFold(h, r.blueSpend);
    h = parityFold(h, r.redSpend);
    h = parityFold(h, d.denialIndex);
    h = parityFold(h, d.throughput);
    h = parityFold(h, d.osviRed);
    h = parityFold(h, d.halt ? 1 : 0);
    h = parityFold(h, d.capitulation ? 1 : 0);
  }
  return h >>> 0;
}

// === END SHARED CORE (keep byte-identical with sim-worker.js) ===

  // Public wrapper preserving the historical window/SimModule API: callers may omit
  // context and/or rng and get a live graph snapshot + time-seeded RNG. The shared
  // core above requires both explicitly, so the defaults are layered here, OUTSIDE
  // the byte-identical region. Exported below under the original simulateTrialCore
  // name, so window-level behavior is unchanged.
  function simulateTrialCoreWithDefaults(actionPlan, opts) {
    const o = opts || {};
    let context = o.context || buildSimContext();
    // B0: default the injected MOE handle on caller-supplied contexts too (shallow
    // copy — never mutate the caller's context, which is typically reused across
    // trials). buildSimContext() already carries moe, so this only fires for hand
    // -built contexts that omitted it.
    if (context.moe === undefined) {
      context = Object.assign({}, context, {
        moe: (typeof window !== 'undefined' && window.MoeModule) || undefined
      });
    }
    if (context === o.context && o.rng) return simulateTrialCore(actionPlan, o);
    return simulateTrialCore(actionPlan, Object.assign({}, o, {
      context,
      rng: o.rng || createRng()
    }));
  }

  // Publish onto the original global names so the engine code still in the main
  // script (simulateTrial, runMonteCarlo, findBestGoalPlan, …) keeps working unedited.
  window.blueProfiles = blueProfiles;
  window.redProfiles = redProfiles;
  window.randIn = randIn;
  window.createRng = createRng;
  window.mcMixSeed = mcMixSeed;
  window.percentile = percentile;
  window.buildSimContext = buildSimContext;
  // New helpers also aliased as bare names so the inline engine/planner in the HTML
  // shell can consume them without a SimModule prefix (consistent with the above).
  window.mean = window.mean || mean;
  window.wilsonInterval = wilsonInterval;
  window.jeffreysInterval = jeffreysInterval;
  window.summarizeTrialStats = summarizeTrialStats;
  window.plannerSeed = plannerSeed;
  window.simulateTrialCore = simulateTrialCoreWithDefaults;
  window.parityHash = parityHash;
  window.summarizeDenialStats = summarizeDenialStats;
  window.denialParityHash = denialParityHash;

  return {
    blueProfiles, redProfiles, randIn, createRng, mcMixSeed, percentile, buildSimContext,
    // C-008
    mean, wilsonInterval, jeffreysInterval, summarizeTrialStats,
    // C-041
    plannerSeed,
    // C-009
    simulateTrialCore: simulateTrialCoreWithDefaults, parityHash,
    // B0 (Increment B): denial-mode support — MC summary shared with the worker's
    // aggregation, and the denial-plumbing parity probe (stub-MOE fixture, no moe.js
    // dependency).
    summarizeDenialStats, denialParityHash
  };
})();
