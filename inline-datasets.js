/*
 * inline-datasets.js — startup auto-loader for the MDSC 3D Network Visualizer.
 *
 * The app boots with an empty graph (init() seeds { nodes: [], links: [] }) and
 * expects scenarios to be brought in through the in-app import pipeline. This
 * loader replays that exact pipeline automatically for the two bundled scenarios
 * so the app comes up populated instead of blank.
 *
 * It reuses the app's own globals — fetchJsonWithFallback (with its file:// XHR
 * fallback), normalizeImportedPayload, addImportedNodes, initUI, refreshGraph —
 * rather than re-implementing parsing/injection, so behavior stays identical to a
 * manual import. Relative paths are used so OFFLINE_MODE (which only blocks
 * http(s):// URLs) does not reject them.
 *
 * To change which scenarios auto-load, edit BUNDLED_SCENARIOS below.
 */
(function () {
  'use strict';

  var BUNDLED_SCENARIOS = [
    { url: './grok150red.json', team: 'red',  label: 'Red (PLA) — 2040 notional' },
    { url: './grokblue90.json', team: 'blue', label: 'Blue (Taiwan-led Joint Force / conditional partners) — 2040 notional' }
  ];

  // This is the combined playable story. The two JSON files remain force-package
  // sources; neither package's metadata is allowed to become the scenario title.
  // Observed public facts and game assumptions are deliberately labeled separately.
  var BUNDLED_SCENARIO_CONTEXT = {
    title: 'Taiwan Strait 2040 — Opening Denial Window',
    classification: 'UNCLASSIFIED // NOTIONAL',
    date: 'Notional D-Day · 2040',
    turnDurationDays: 3.5,
    background: 'After a coercive exercise and isolation campaign fails to compel political concessions, Red opens a joint campaign to create and sustain a cross-strait lodgment. Blue commands a Taiwan-led defense with active U.S. support and explicitly conditional partner and commercial access.',
    initiatingEvent: 'Long-range fires, cyber activity, electromagnetic attack, and cross-strait lift operations begin inside the same decision window.',
    blueRole: 'Synchronize Taiwan’s sovereign defense with joint maritime, air, land, space, cyber, spectrum, and contested-logistics capabilities to deny the operating system that keeps Red lift, command, sensing, fires, and sustainment coherent.',
    redObjective: 'Keep amphibious throughput above the model’s halt threshold long enough to build and consolidate a viable lodgment.',
    decisionQuestion: 'Which Joint Force mix of maritime and air denial, land fires, cyber effects, electromagnetic warfare, hardening, sustainment, and repair best breaks Red throughput before the lodgment clock closes—without surrendering Blue tempo?',
    victory: 'Blue wins by forcing Red throughput below the halt threshold before a lodgment is established. Red wins by accumulating a sustainable lodgment first. A hard-horizon projection resolves an otherwise contested ending.',
    boundary: 'Public-source capability classes anchor the baseline. Exact packages, locations, readiness, access, partner participation, effects, thresholds, and all 2040 enhancements are explicit scenario assumptions—not intelligence estimates or predictions.',
    evidenceLegend: [
      { key: 'OBSERVED', meaning: 'Directly supported by a cited public source.' },
      { key: 'ASSESSED', meaning: 'Analytic inference from public sources.' },
      { key: '2040 NOTIONAL', meaning: 'A transparent game assumption for exploration.' }
    ],
    sources: [
      { label: 'CSIS · The First Battle of the Next War (2023)', url: 'https://csis-website-prod.s3.amazonaws.com/s3fs-public/publication/230109_Cancian_FirstBattle_NextWar.pdf' },
      { label: 'Taiwan MND · 2025 Quadrennial Defense Review', url: 'https://www.mnd.gov.tw/InformationServices/QDRFile/6/2/2025QDR%E8%8B%B1%E6%96%87%E7%89%88.pdf' },
      { label: 'U.S. DoD · China Military Power Report (2024)', url: 'https://media.defense.gov/2024/Dec/18/2003615520/-1/-1/0/MILITARY-AND-SECURITY-DEVELOPMENTS%20-INVOLVING-THE-PEOPLES-REPUBLIC-OF-CHINA-2024.PDF' },
      { label: 'U.S. Seventh Fleet · Facts Sheet', url: 'https://www.c7f.navy.mil/About-Us/Facts-Sheet/' },
      { label: '3d Marine Littoral Regiment · Stand-in Force mission', url: 'https://www.3rdmlr.marines.mil/' },
      { label: 'Pacific Air Forces · Mission and priorities', url: 'https://www.pacaf.af.mil/Info/Mission-Vision-Priorities/PACAFSelectorButton/' },
      { label: 'U.S. Space Forces Indo-Pacific · Theater integration', url: 'https://www.spaceforce.mil/About-Us/-Space-Force-Components/US-Space-Forces-Indo-Pacific/' },
      { label: 'U.S. Cyber Command · 2025 Posture Statement', url: 'https://www.cybercom.mil/Media/News/Article/4150133/posture-statement-of-lieutenant-general-william-j-hartman/' }
    ]
  };

  window.StrikeSimScenario = BUNDLED_SCENARIO_CONTEXT;
  window.StrikeSimBundledScenarioReady = false;
  window.StrikeSimBundledScenarioError = '';
  try {
    var bootScenario = window.AppState && window.AppState.active ? window.AppState.active() : null;
    if (bootScenario) bootScenario.isBundled = true;
  } catch (e) { /* non-fatal */ }

  var loaded = false;

  function appReady() {
    return typeof window.normalizeImportedPayload === 'function' &&
           typeof window.addImportedNodes === 'function' &&
           typeof window.refreshGraph === 'function';
  }

  async function fetchScenario(url) {
    if (typeof window.fetchJsonWithFallback === 'function') {
      return window.fetchJsonWithFallback(url);
    }
    // Minimal fallback if the app helper is unavailable.
    var resp = await fetch(url, { cache: 'no-cache' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.json();
  }

  async function autoLoad() {
    if (loaded) return;
    loaded = true;

    var totalNodes = 0;
    var loadedTeams = { red: false, blue: false };
    for (var i = 0; i < BUNDLED_SCENARIOS.length; i++) {
      var scenario = BUNDLED_SCENARIOS[i];
      try {
        var raw = await fetchScenario(scenario.url);
        var payload = window.normalizeImportedPayload(raw);
        if (!payload || !payload.nodes || !payload.nodes.length) {
          throw new Error('Unrecognized or empty scenario file');
        }
        // keepOriginalIds preserves the scenario's internal link references.
        var stats = window.addImportedNodes(payload, scenario.team, { keepOriginalIds: true });
        totalNodes += stats.nodesAdded;
        loadedTeams[scenario.team] = stats.nodesAdded > 0;
        if (typeof window.addEvent === 'function') {
          window.addEvent({
            type: 'Import',
            text: 'Auto-loaded ' + stats.nodesAdded + ' nodes from ' + scenario.label + '.'
          });
        }
      } catch (err) {
        console.error('[inline-datasets] Failed to auto-load ' + scenario.url, err);
        if (typeof window.addEvent === 'function') {
          window.addEvent({ type: 'Import Fail', text: 'Auto-load failed for ' + scenario.label + ': ' + err.message });
        }
      }
    }

    if (totalNodes > 0) {
      try {
        var active = window.AppState && window.AppState.active ? window.AppState.active() : null;
        if (active) {
          active.name = BUNDLED_SCENARIO_CONTEXT.title;
          active.context = BUNDLED_SCENARIO_CONTEXT;
          active.isBundled = true;
          if (active.graph) active.graph.scenarioContext = BUNDLED_SCENARIO_CONTEXT;
        }
      } catch (e) { /* non-fatal */ }
      try { if (typeof window.initUI === 'function') window.initUI(); } catch (e) { /* non-fatal */ }
      try { window.refreshGraph(); } catch (e) { /* non-fatal */ }
      try { if (typeof window.refreshMapMarkers === 'function') window.refreshMapMarkers(); } catch (e) { /* non-fatal */ }
      if (typeof window.showToast === 'function') {
        window.showToast('Loaded ' + totalNodes + ' nodes from bundled scenarios.', 'success');
      }
    }
    var bothForcesLoaded = loadedTeams.red && loadedTeams.blue;
    window.StrikeSimBundledScenarioReady = bothForcesLoaded;
    window.StrikeSimBundledScenarioError = bothForcesLoaded ? '' : 'The complete Red and Blue force packages did not load. Reload the page before starting an operation.';
    if (!bothForcesLoaded && typeof window.showToast === 'function') {
      window.showToast(window.StrikeSimBundledScenarioError, 'error', 9000);
    }
    try {
      window.dispatchEvent(new CustomEvent('strikesim:scenario-ready', {
        detail: { ready: bothForcesLoaded, nodeCount: totalNodes, teams: loadedTeams, context: BUNDLED_SCENARIO_CONTEXT }
      }));
    } catch (e) { /* non-fatal */ }
  }

  // The app builds its graph synchronously inside init() (called at the end of the
  // main script), so by window 'load' the globals exist. Poll briefly as a safety
  // net in case graph construction is delayed.
  function waitAndLoad() {
    var attempts = 0;
    (function tick() {
      if (appReady()) { autoLoad(); return; }
      if (++attempts > 100) {            // ~10s ceiling, then give up quietly
        console.warn('[inline-datasets] App globals never became available; skipping auto-load.');
        return;
      }
      setTimeout(tick, 100);
    })();
  }

  if (document.readyState === 'complete') {
    waitAndLoad();
  } else {
    window.addEventListener('load', waitAndLoad);
  }
})();
