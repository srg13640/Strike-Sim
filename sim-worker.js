/*
 * sim-worker.js
 *
 * Offline Monte Carlo worker for Strike Sim. This file is intentionally standalone:
 * no imports, no build step, no package manager, and no runtime network. The main UI
 * sends a frozen simulation snapshot plus config; the worker runs trials in chunks and
 * posts progress so the browser stays responsive during 10k-100k trial checks.
 */
'use strict';

// B0 (Increment B): the shared core adjudicates successMode 'denial' through an
// injected MOE handle (context.moe); the worker sources that handle from moe.js.
// moe.js publishes onto window.MoeModule and workers have no window, so alias
// window -> self first (moe.js is dependency-free and DOM-free, so this is safe).
// importScripts is same-directory and offline-safe: the app runs from a localhost
// server ("Open StrikeSim 2040.command"), never over the network. Guarded: a load
// failure posts an error for the shell's log and leaves self.MoeModule undefined,
// which the core reports as 'denial unavailable' — non-denial runs are unaffected.
if (typeof window === 'undefined') self.window = self;
try {
  importScripts('moe.js');
} catch (err) {
  try {
    self.postMessage({
      type: 'error',
      message: 'moe.js failed to load in sim-worker; denial-mode runs unavailable: '
        + (err && err.message ? err.message : String(err))
    });
  } catch (e2) { /* nothing to report to */ }
}

let activeRun = null;

// Avalanche-mix (base, trialIndex) so adjacent trials get independent seeds (consecutive
// integers leave the LCG's first draw near-linear in t). Mirror of mcMixSeed in the shell.
function mcMixSeed(base, t) {
  let x = ((base >>> 0) ^ Math.imul(t, 0x9E3779B1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

function createRng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return {
    next() {
      s = (s * 48271) % 2147483647;
      return s / 2147483647;
    }
  };
}

// ===========================================================================
// C-009 PARITY BLOCK — canonical per-trial simulation core.
//
// Everything between the BEGIN/END SHARED CORE markers below is kept BYTE-IDENTICAL
// with the copy in sim.js (SimModule). The worker cannot importScripts sim.js in
// every offline context, so the single source of truth is duplicated here on purpose.
// DO NOT edit one copy without editing the other: extract the marked regions from
// both files and diff them (must be empty), then compare parityHash(seed, n) via the
// {type:'parity'} handler after any change.
// ===========================================================================

// === BEGIN SHARED CORE (keep byte-identical with sim.js) ===

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

// === END SHARED CORE (keep byte-identical with sim.js) ===

function normalizeContext(context) {
  const nodeInfo = new Map();
  const adj = new Map();
  (context.nodes || []).forEach(info => {
    nodeInfo.set(info.id, {
      id: info.id,
      name: info.name,
      team: info.team,
      difficulty: info.difficulty,
      vulnerabilities: Array.isArray(info.vulnerabilities) ? info.vulnerabilities : [],
      cascScore: info.cascScore || 1,
      importance: info.importance || 5,
      healthMax: info.healthMax || 100,
      health: info.health ?? (info.healthMax || 100),
      status: info.status || 'Active',
      domain: Array.isArray(info.domain) ? info.domain : (info.domain ? [info.domain] : []),
      type: info.type || ''
    });
  });
  (context.adjacency || []).forEach(([id, neighbors]) => {
    adj.set(id, new Set(neighbors || []));
  });
  // B0: wire the worker's MOE handle (from importScripts('moe.js') above) into the
  // context — the shared core only ever reads context.moe, never self.MoeModule.
  // undefined (load failed) makes the core throw a clear error on denial runs.
  return { nodeInfo, adj, moe: (typeof self !== 'undefined' && self.MoeModule) || undefined };
}

// NOTE: the per-trial math (simulateTrialCore + simCore* helpers) lives in the PARITY
// BLOCK above as a verbatim copy of sim.js. The old worker-local simulateTrial and its
// duplicate helpers were removed so there is exactly one trial implementation here. Run
// processing calls simulateTrialCore directly with the same opts shape it always used.

function makeAggregator() {
  return {
    trialsSuccess: 0,
    totalImpactOnSuccess: 0,
    totalStepsToSuccess: 0,
    completedTrials: 0,
    successImpacts: [],
    stepsToSuccessArr: [],
    redNeutralizedArr: [],
    blueNeutralizedArr: [],
    blueSpendArr: [],
    redSpendArr: [],
    neutralizedCounts: new Map(),
    damageTotals: new Map(),
    damageHitCounts: new Map(),
    // B0: denial MOE accumulators — same shape/semantics as the inline runMonteCarlo
    // accumulators in the shell (denialDiArr/denialTputArr/denialOsviArr/halt/cap).
    // Populated only when trials carry a denial outcome (successMode 'denial').
    denialDiArr: [],
    denialTputArr: [],
    denialOsviArr: [],
    denialHalt: 0,
    denialCap: 0
  };
}

function addTrial(agg, result) {
  if (result.success) {
    agg.trialsSuccess++;
    agg.totalImpactOnSuccess += result.impact;
    agg.totalStepsToSuccess += result.stepsToGoal;
    agg.successImpacts.push(result.impact);
    agg.stepsToSuccessArr.push(result.stepsToGoal);
  }
  agg.redNeutralizedArr.push(result.redNeutralized.size);
  agg.blueNeutralizedArr.push(result.blueNeutralized.size);
  agg.blueSpendArr.push(result.blueSpend);
  agg.redSpendArr.push(result.redSpend);
  if (result.denial) {
    agg.denialDiArr.push(result.denial.denialIndex);
    agg.denialTputArr.push(result.denial.throughput);
    agg.denialOsviArr.push(result.denial.osviRed);
    if (result.denial.halt) agg.denialHalt++;
    if (result.denial.capitulation) agg.denialCap++;
  }
  result.redNeutralized.forEach(id => {
    agg.neutralizedCounts.set(id, (agg.neutralizedCounts.get(id) || 0) + 1);
  });
  result.damageThisRun.forEach((val, id) => {
    agg.damageTotals.set(id, (agg.damageTotals.get(id) || 0) + val);
    agg.damageHitCounts.set(id, (agg.damageHitCounts.get(id) || 0) + 1);
  });
}

function serializeAgg(agg, requestedTrials, cancelled, successMode) {
  const out = {
    trialsSuccess: agg.trialsSuccess,
    totalImpactOnSuccess: agg.totalImpactOnSuccess,
    totalStepsToSuccess: agg.totalStepsToSuccess,
    completedTrials: agg.completedTrials,
    requestedTrials,
    cancelled,
    successImpacts: agg.successImpacts,
    stepsToSuccessArr: agg.stepsToSuccessArr,
    redNeutralizedArr: agg.redNeutralizedArr,
    blueNeutralizedArr: agg.blueNeutralizedArr,
    blueSpendArr: agg.blueSpendArr,
    redSpendArr: agg.redSpendArr,
    neutralizedCounts: Array.from(agg.neutralizedCounts.entries()),
    damageTotals: Array.from(agg.damageTotals.entries()),
    damageHitCounts: Array.from(agg.damageHitCounts.entries())
  };
  // B0: denial statistics ride the done-payload under a 'denial' key ONLY in denial
  // mode, so every non-denial result payload is byte-identical to before. Raw arrays
  // (for histograms / further analysis) plus the shared-core summary — the same
  // summarizeDenialStats the shell's inline fallback uses via SimModule.
  if (successMode === 'denial') {
    out.denial = {
      denialDiArr: agg.denialDiArr,
      denialTputArr: agg.denialTputArr,
      denialOsviArr: agg.denialOsviArr,
      denialHalt: agg.denialHalt,
      denialCap: agg.denialCap,
      summary: summarizeDenialStats(agg)
    };
  }
  return out;
}

function startRun(runId, payload) {
  const agg = makeAggregator();
  const context = normalizeContext(payload.context || {});
  const prioritySet = new Set(payload.prioritySet || []);
  const trials = Math.max(1, Number(payload.trials || 1));
  const chunkSize = Math.max(50, Number(payload.chunk || Math.floor(trials / 100) || 100));
  const successMode = payload.successMode || 'impact';
  activeRun = { runId, cancelled: false };

  const processChunk = () => {
    if (!activeRun || activeRun.runId !== runId) return;
    const end = Math.min(trials, agg.completedTrials + chunkSize);
    // B0: chunks run async (setTimeout), outside the onmessage try/catch — so a
    // mid-run throw (e.g. a denial run when moe.js failed to import) must be caught
    // here and posted as the existing {type:'error'} shape, or it would surface only
    // as an opaque worker.onerror in the shell.
    try {
      for (let t = agg.completedTrials + 1; t <= end; t++) {
        if (activeRun.cancelled) break;
        const result = simulateTrialCore(payload.actionPlan || [], {
          context,
          rng: createRng(mcMixSeed(payload.baseSeed, t)),
          successMode,
          successN: Math.max(1, Number(payload.successN || 3)),
          victoryThreshold: Math.max(1, Number(payload.victoryThreshold || 100)),
          prioritySet,
          maxBlueLoss: Number.isFinite(payload.maxBlueLoss) ? payload.maxBlueLoss : Infinity,
          regenFrac: Math.min(1, Math.max(0, Number(payload.regenFrac || 0))),
          // B0: denial MOE knobs — same defaults as the inline mirror (balance 0.35).
          denialBalance: payload.denialBalance != null ? payload.denialBalance : 0.35,
          denialParams: payload.denialParams != null ? payload.denialParams : null,
          detectionGrowthTarget: payload.detectionGrowthTarget ?? 0.08,
          detectionGrowthDomain: payload.detectionGrowthDomain ?? 0.04,
          detectionPenalty: payload.detectionPenalty ?? 0.18,
          intelNoise: payload.intelNoise ?? 0.15,
          fatigueRate: payload.fatigueRate ?? 0.03,
          dynamicRed: payload.dynamicRed !== false,
          teamResources: payload.teamResources || {},
          settings: payload.settings || { cascadeAlpha: 0.25, difficultyModifiers: {} },
          strikeMethods: payload.strikeMethods || {},
          redProfiles: payload.redProfiles || {}
        });
        agg.completedTrials = t;
        addTrial(agg, result);
      }
    } catch (err) {
      activeRun = null;
      self.postMessage({
        type: 'error',
        runId,
        message: err && err.message ? err.message : String(err)
      });
      return;
    }

    self.postMessage({
      type: 'progress',
      runId,
      completed: agg.completedTrials,
      requestedTrials: trials
    });

    if (activeRun.cancelled || agg.completedTrials >= trials) {
      const cancelled = !!activeRun.cancelled;
      const result = serializeAgg(agg, trials, cancelled, successMode);
      activeRun = null;
      self.postMessage({ type: 'done', runId, result });
      return;
    }
    setTimeout(processChunk, 0);
  };

  setTimeout(processChunk, 0);
}

self.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type === 'cancel') {
    if (activeRun && activeRun.runId === msg.runId) activeRun.cancelled = true;
    return;
  }
  // C-009: additive parity probe. The shell posts {type:'parity', seed, n} and compares
  // the returned hash against SimModule.parityHash(seed, n) to confirm inline === worker.
  // Synchronous and side-effect free; does not touch activeRun or the run/cancel flow.
  if (msg.type === 'parity') {
    try {
      const seed = Number(msg.seed) || 0;
      const n = Math.max(1, Number(msg.n) || 1);
      self.postMessage({ type: 'parity', runId: msg.runId, seed, n, hash: parityHash(seed, n) });
    } catch (err) {
      self.postMessage({
        type: 'error',
        runId: msg.runId,
        message: err && err.message ? err.message : String(err)
      });
    }
    return;
  }
  if (msg.type !== 'run') return;
  try {
    startRun(msg.runId, msg.payload || {});
  } catch (err) {
    self.postMessage({
      type: 'error',
      runId: msg.runId,
      message: err && err.message ? err.message : String(err)
    });
  }
};
