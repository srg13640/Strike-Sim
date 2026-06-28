/*
 * sim-worker.js
 *
 * Offline Monte Carlo worker for Strike Sim. This file is intentionally standalone:
 * no imports, no build step, no package manager, and no runtime network. The main UI
 * sends a frozen simulation snapshot plus config; the worker runs trials in chunks and
 * posts progress so the browser stays responsive during 10k-100k trial checks.
 */
'use strict';

let activeRun = null;

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

function methodKeyFromStep(step) {
  if (step.methodKey) return step.methodKey;
  if (step.blueKey) return step.blueKey;
  if (step.blue === 'Kinetic Strike') return 'kinetic';
  if (step.blue === 'Cyber Attack') return 'cyber';
  if (step.blue === 'EW Jamming') return 'ew';
  if (step.blue === 'SOF Mission') return 'sof';
  return 'kinetic';
}

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
  return { nodeInfo, adj };
}

function domainAffinity(srcInfo, dstInfo, methodKey) {
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

function computeVulnMultiplier(info, method, intelQ) {
  const hasV = (info.vulnerabilities || []).includes(method.vulnerability);
  if (hasV) return Math.min(1.35, Math.max(1.0, 1.2 + (intelQ - 1) * 0.5));
  return Math.min(1.0, Math.max(0.6, 0.85 - (intelQ - 1) * 0.35));
}

function chooseRedCounter(methodKey, redBudget, redTypeBudget, detectionLevel, redProfiles) {
  const optionsByMethod = {
    kinetic: ['Counter-Strike', 'Reinforcement', 'Sabotage'],
    cyber: ['Cyber Defense', 'Deception', 'Reinforcement'],
    ew: ['EW Countermeasure', 'Deception', 'Reinforcement'],
    sof: ['SOF Interception', 'Reinforcement']
  };
  const redCounterCosts = { 'Cyber Defense': 1, 'EW Countermeasure': 1, 'SOF Interception': 1, 'Reinforcement': 1, 'Deception': 1, 'Sabotage': 2, 'Counter-Strike': 1 };
  const redCounterType = { 'Cyber Defense': 'ew', 'EW Countermeasure': 'jam', 'SOF Interception': 'sof', 'Counter-Strike': 'ke', 'Reinforcement': 'ke', 'Deception': 'ew', 'Sabotage': 'ke' };
  const opts = optionsByMethod[methodKey] || optionsByMethod.kinetic;
  let best = null;
  opts.forEach(name => {
    const cost = redCounterCosts[name] || 0;
    const cat = redCounterType[name] || 'ke';
    const canAfford = redTypeBudget?.[cat] !== undefined ? redTypeBudget[cat] >= cost : redBudget >= cost;
    if (!canAfford) return;
    const prof = redProfiles[name] || {};
    const pMult = prof.pMult ?? prof.globalPmult ?? 0.95;
    const strength = (1 - pMult) + detectionLevel * 0.2;
    if (!best || strength > best.strength) best = { name, cost, cat, strength };
  });
  return best;
}

function simulateTrial(actionPlan, opts) {
  const {
    context,
    rng,
    successMode,
    successN,
    victoryThreshold,
    prioritySet,
    maxBlueLoss,
    regenFrac,
    detectionGrowthTarget,
    detectionGrowthDomain,
    detectionPenalty,
    intelNoise,
    fatigueRate,
    dynamicRed,
    teamResources,
    settings,
    strikeMethods,
    redProfiles
  } = opts;

  const { nodeInfo, adj } = context;
  const blueBudgetBase = teamResources?.blue ?? 0;
  const redBudgetBase = teamResources?.red ?? 0;
  const blueTypeBase = JSON.parse(JSON.stringify(teamResources?.blueTypes || { ke: 0, ew: 0, jam: 0, sof: 0 }));
  const redTypeBase = JSON.parse(JSON.stringify(teamResources?.redTypes || { ke: 0, ew: 0, jam: 0, sof: 0 }));
  const redCounterCosts = { 'Cyber Defense': 1, 'EW Countermeasure': 1, 'SOF Interception': 1, 'Reinforcement': 1, 'Deception': 1, 'Sabotage': 2, 'Counter-Strike': 1 };
  const redCounterType = { 'Cyber Defense': 'ew', 'EW Countermeasure': 'jam', 'SOF Interception': 'sof', 'Counter-Strike': 'ke', 'Reinforcement': 'ke', 'Deception': 'ew', 'Sabotage': 'ke' };
  const blueMethodType = { kinetic: 'ke', cyber: 'ew', ew: 'jam', sof: 'sof' };

  const state = new Map();
  nodeInfo.forEach((info, id) => state.set(id, { alive: info.status !== 'Neutralized', health: info.health }));
  const detectionTarget = new Map();
  const detectionDomain = new Map();
  const fatigue = { kinetic: 0, cyber: 0, ew: 0, sof: 0 };
  const intelQ = 1 + (rng.next() * 2 - 1) * intelNoise;

  let impact = 0;
  let stepsToGoal = null;
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
      const mult = domainAffinity(srcInfo, ninfo, methodKey);
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
      let count = 0;
      redNeutralized.forEach(id => { if (prioritySet.has(id)) count++; });
      return count >= successN;
    }
    if (successMode === 'goal') {
      let count = 0;
      redNeutralized.forEach(id => { if (prioritySet.has(id)) count++; });
      return count >= successN && blueNeutralized.size <= maxBlueLoss;
    }
    return false;
  }

  for (let i = 0; i < actionPlan.length; i++) {
    const step = actionPlan[i];
    const methodKey = methodKeyFromStep(step);
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
    const vuln = computeVulnMultiplier(info, method, intelQ);
    let p = method.baseProb * diff * vuln;

    const targetDet = detectionTarget.get(info.id) || 0;
    const domainKey = (info.domain || [])[0] || methodKey;
    const domainDet = detectionDomain.get(domainKey) || 0;
    p *= 1 - Math.min(0.6, (targetDet + domainDet) * detectionPenalty);
    p *= Math.max(0.7, 1 - fatigueRate * (fatigue[methodKey] || 0));

    let redChoice = null;
    if (dynamicRed) {
      redChoice = chooseRedCounter(methodKey, redBudget, redTypeBudget, targetDet + domainDet, redProfiles);
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
    }
    if (blueNeutralized.size > maxBlueLoss) break;
    if (successSatisfied() && stepsToGoal === null) stepsToGoal = i + 1;
  }

  return {
    success: successSatisfied(),
    stepsToGoal: stepsToGoal ?? actionPlan.length,
    impact,
    redNeutralized,
    blueNeutralized,
    blueSpend: blueSpent,
    redSpend: redSpent,
    damageThisRun
  };
}

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
    damageHitCounts: new Map()
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
  result.redNeutralized.forEach(id => {
    agg.neutralizedCounts.set(id, (agg.neutralizedCounts.get(id) || 0) + 1);
  });
  result.damageThisRun.forEach((val, id) => {
    agg.damageTotals.set(id, (agg.damageTotals.get(id) || 0) + val);
    agg.damageHitCounts.set(id, (agg.damageHitCounts.get(id) || 0) + 1);
  });
}

function serializeAgg(agg, requestedTrials, cancelled) {
  return {
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
}

function startRun(runId, payload) {
  const agg = makeAggregator();
  const context = normalizeContext(payload.context || {});
  const prioritySet = new Set(payload.prioritySet || []);
  const trials = Math.max(1, Number(payload.trials || 1));
  const chunkSize = Math.max(50, Number(payload.chunk || Math.floor(trials / 100) || 100));
  activeRun = { runId, cancelled: false };

  const processChunk = () => {
    if (!activeRun || activeRun.runId !== runId) return;
    const end = Math.min(trials, agg.completedTrials + chunkSize);
    for (let t = agg.completedTrials + 1; t <= end; t++) {
      if (activeRun.cancelled) break;
      const result = simulateTrial(payload.actionPlan || [], {
        context,
        rng: createRng(payload.baseSeed + t),
        successMode: payload.successMode || 'impact',
        successN: Math.max(1, Number(payload.successN || 3)),
        victoryThreshold: Math.max(1, Number(payload.victoryThreshold || 100)),
        prioritySet,
        maxBlueLoss: Number.isFinite(payload.maxBlueLoss) ? payload.maxBlueLoss : Infinity,
        regenFrac: Math.min(1, Math.max(0, Number(payload.regenFrac || 0))),
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

    self.postMessage({
      type: 'progress',
      runId,
      completed: agg.completedTrials,
      requestedTrials: trials
    });

    if (activeRun.cancelled || agg.completedTrials >= trials) {
      const cancelled = !!activeRun.cancelled;
      const result = serializeAgg(agg, trials, cancelled);
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
