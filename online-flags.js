/* =====================================================================================
 * UNCLASSIFIED // NOTIONAL — StrikeSim 2040 online feature flags (CO-007 S1)
 * =====================================================================================
 * THE ONE FILE THAT MAY DIFFER BETWEEN BUILDS. The offline (file://) build ships THIS
 * file — every network-touching feature OFF — and the hosted build swaps in
 * site/online-flags.hosted.js at deploy time. Nothing else in the tree may vary
 * between builds (CO-007 invariant I-3), and no runtime file may read these flags
 * except through OnlineFlags.enabled(), so a missing or false flag is indistinguishable
 * from the feature not existing.
 *
 * KILL SWITCH: replacing the hosted file with this one returns the hosted build to
 * pure offline behavior. Deleting the file entirely must ALSO be safe: every consumer
 * guards `window.OnlineFlags` before use.
 *
 * `share` is ON in the offline build by design — challenge links are serverless
 * (pure URL payload, CO-007 candidate #2) and work on file:// without violating the
 * offline-complete posture. Everything that would open a socket is OFF here.
 * ===================================================================================== */
(function () {
  'use strict';

  var FLAGS = {
    share: true,        // serverless challenge/replay links (no network involved)
    dailySeed: false,   // PARKED — daily-seed leaderboard client
    careerSync: false,  // PARKED — cross-device career sync
    feedback: false     // PARKED — hosted-build playtest feedback endpoint
  };

  window.OnlineFlags = Object.freeze({
    version: 'co007-p1',
    build: 'offline',
    flags: Object.freeze(FLAGS),
    /** The only sanctioned read path. Unknown names are false, always. */
    enabled: function (name) { return FLAGS[name] === true; }
  });
})();
