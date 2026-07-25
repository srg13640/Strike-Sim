/*
 * counterfactual-worker.js — off-main-thread AAR Counterfactual Colosseum.
 * UNCLASSIFIED // NOTIONAL RESEARCH TOOL
 */
'use strict';

if (typeof window === 'undefined') self.window = self;

// CO-012: inherit this worker's own cache-busting token and propagate it to every
// importScripts path. Without it the worker loads `game.js` under a SEPARATE, untokenized
// cache entry from the main thread's `game.js?v=…`, so after an update the forecast (worker)
// and the world (main thread) can silently resolve from different engine versions —
// which would void the determinism invariant the whole design rests on.
// Load order is load-bearing: strategic-state.js must precede game.js (harness law).
var CF_BUILD = (function () {
  try { return (self.location && self.location.search) || ''; } catch (e) { return ''; }
})();
importScripts.apply(self, ['moe.js', 'red-mind.js', 'strategic-state.js', 'logistics.js', 'game.js', 'counterfactual.js']
  .map(function (f) { return f + CF_BUILD; }));

var activeRun = null;

function startRun(runId, payload) {
  var CF = self.CounterfactualModule;
  var trials = Math.max(1, Math.round(Number(payload.K || 200)));
  var chunk = Math.max(1, Math.min(20, Math.round(Number(payload.chunk || 5))));
  // CO-005 A7: the exploit probe replays recorded Blue orders against a player-model
  // best-response Red — no order edit exists, so the edit gate does not apply.
  var exploitProbe = payload.probe === 'exploit-player-model';
  var matched = null;
  if (!exploitProbe) {
    var checked = CF.validateEdit(payload.record, payload.graph, payload.edit);
    if (!checked.ok) throw new Error('Invalid counterfactual edit: ' + checked.reason);
    payload.edit = checked;
    matched = CF.runPair(payload, 0, 'matched');
  }
  var aggregate = CF.newAggregate(trials);
  activeRun = { runId: runId, cancelled: false };

  function processChunk() {
    if (!activeRun || activeRun.runId !== runId) return;
    try {
      var end = Math.min(trials, aggregate.completed + chunk);
      while (aggregate.completed < end && !activeRun.cancelled) {
        var trial = aggregate.completed + 1;
        CF.addPair(aggregate, exploitProbe ? CF.runExploitPair(payload, trial) : CF.runPair(payload, trial, 'ensemble'));
      }
      self.postMessage({ type: 'progress', runId: runId, completed: aggregate.completed, requested: trials });
      if (activeRun.cancelled) {
        activeRun = null;
        self.postMessage({ type: 'cancelled', runId: runId, completed: aggregate.completed });
        return;
      }
      if (aggregate.completed >= trials) {
        var result = CF.summarize(aggregate, matched, payload.authoredForecast);
        activeRun = null;
        self.postMessage({ type: 'done', runId: runId, result: result });
        return;
      }
      setTimeout(processChunk, 0);
    } catch (err) {
      activeRun = null;
      self.postMessage({ type: 'error', runId: runId, message: err && err.message ? err.message : String(err) });
    }
  }
  setTimeout(processChunk, 0);
}

self.onmessage = function (event) {
  var message = event.data || {};
  if (message.type === 'cancel') {
    if (activeRun && activeRun.runId === message.runId) activeRun.cancelled = true;
    return;
  }
  if (message.type !== 'run') return;
  try { startRun(message.runId, message.payload || {}); }
  catch (err) {
    self.postMessage({ type: 'error', runId: message.runId, message: err && err.message ? err.message : String(err) });
  }
};
