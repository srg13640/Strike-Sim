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
    { url: './grokblue90.json', team: 'blue', label: 'Blue (Taiwan / U.S. / conditional partners) — 2040 notional' }
  ];

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
      try { if (typeof window.initUI === 'function') window.initUI(); } catch (e) { /* non-fatal */ }
      try { window.refreshGraph(); } catch (e) { /* non-fatal */ }
      try { if (typeof window.refreshMapMarkers === 'function') window.refreshMapMarkers(); } catch (e) { /* non-fatal */ }
      if (typeof window.showToast === 'function') {
        window.showToast('Loaded ' + totalNodes + ' nodes from bundled scenarios.', 'success');
      }
    }
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
