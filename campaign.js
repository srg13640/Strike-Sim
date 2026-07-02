/*
 * campaign.js -- NDS-aligned campaign planner game mode for StrikeSim 2040.
 *
 * This layer turns the existing force-network and turn-based match into a higher
 * level campaign design game. It stays deliberately abstract and unclassified:
 * planners choose lines of effort, manage readiness/sustainment/alliance/DIB risk,
 * then can launch the existing War Game with a posture shaped by the campaign.
 */
(function () {
  'use strict';

  var hud = null;
  var launchBtn = null;
  var state = null;
  var selectedCampaignId = 'indopacom-denial';
  var selectedLensId = 'army';

  var POSITIVE = ['denial', 'homeland', 'allies', 'dib', 'readiness', 'sustainment', 'initiative'];
  var RISK = ['escalation', 'exposure'];
  var METRICS = {
    denial: { label: 'Denial', loe: 'Indo-Pacific' },
    homeland: { label: 'Homeland', loe: 'Homeland' },
    allies: { label: 'Allies', loe: 'Burden sharing' },
    dib: { label: 'DIB', loe: 'Industrial base' },
    readiness: { label: 'Readiness', loe: 'Joint force' },
    sustainment: { label: 'Sustainment', loe: 'Logistics' },
    initiative: { label: 'Initiative', loe: 'Campaigning' },
    escalation: { label: 'Escalation', loe: 'Risk' },
    exposure: { label: 'Exposure', loe: 'Risk' }
  };

  var NDS_LOES = [
    { id: 'homeland', label: 'Defend the U.S. homeland', metric: 'homeland' },
    { id: 'denial', label: 'Deter China in the Indo-Pacific', metric: 'denial' },
    { id: 'allies', label: 'Increase ally and partner burden sharing', metric: 'allies' },
    { id: 'dib', label: 'Supercharge the defense industrial base', metric: 'dib' }
  ];

  var SERVICE_LENSES = {
    joint: {
      name: 'Joint staff',
      focus: 'Balance campaign outcomes across all domains and keep escalation controlled.',
      tags: ['joint', 'c2', 'alliance']
    },
    army: {
      name: 'Army theater planner',
      focus: 'Prioritize sustainment, protection, theater posture, land-enabled access, and coalition endurance.',
      tags: ['land', 'sustainment', 'protection']
    },
    navy: {
      name: 'Navy planner',
      focus: 'Prioritize sea control, distributed logistics, maritime access, and fleet survivability.',
      tags: ['maritime', 'sustainment', 'access']
    },
    airforce: {
      name: 'Air Force planner',
      focus: 'Prioritize airbase resilience, long-range fires readiness, C2 continuity, and rapid reconstitution.',
      tags: ['air', 'protection', 'c2']
    },
    marine: {
      name: 'Marine littoral planner',
      focus: 'Prioritize stand-in force survivability, expeditionary basing, sensing, and coalition access.',
      tags: ['littoral', 'access', 'sensing']
    },
    spacecyber: {
      name: 'Space/Cyber planner',
      focus: 'Prioritize mission assurance, cyber defense, sensing continuity, and decision advantage.',
      tags: ['space', 'cyber', 'sensing']
    }
  };

  var CAMPAIGNS = [
    {
      id: 'indopacom-denial',
      name: 'Indo-Pacific denial campaign',
      theater: 'Western Pacific',
      objective: 'Deny a fast adversary fait accompli while preserving coalition freedom of action and homeland resilience.',
      budget: 5,
      metrics: {
        denial: 49, homeland: 54, allies: 46, dib: 41, readiness: 50,
        sustainment: 42, initiative: 45, escalation: 31, exposure: 38
      },
      phases: [
        {
          name: 'Competition shaping',
          brief: 'Set access, posture, and logistics before crisis indicators are unambiguous.',
          pressure: { initiative: -5, allies: -3, escalation: 2, exposure: 2 }
        },
        {
          name: 'Crisis warning',
          brief: 'Adversary coercion rises. The campaign must preserve decision space without creating brittle exposure.',
          pressure: { denial: -5, sustainment: -4, homeland: -3, escalation: 6, exposure: 4 }
        },
        {
          name: 'Initial access contest',
          brief: 'Long-range fires, cyber pressure, and logistics interdiction stress the force posture.',
          pressure: { denial: -7, sustainment: -8, readiness: -4, escalation: 8, exposure: 6 }
        },
        {
          name: 'Sustainment race',
          brief: 'Operational endurance and the defense industrial base become the decisive constraint.',
          pressure: { dib: -8, sustainment: -7, readiness: -3, initiative: -2 }
        },
        {
          name: 'Coalition endurance',
          brief: 'Alliance cohesion, civil resilience, and escalation control determine whether the campaign holds.',
          pressure: { allies: -7, homeland: -4, initiative: -3, escalation: 5 }
        }
      ]
    },
    {
      id: 'homeland-resilience',
      name: 'Homeland and force-flow resilience',
      theater: 'Homeland to theater bridge',
      objective: 'Keep homeland defense, mobilization, force projection, and civil resilience intact under coordinated pressure.',
      budget: 5,
      metrics: {
        denial: 42, homeland: 50, allies: 44, dib: 43, readiness: 48,
        sustainment: 46, initiative: 40, escalation: 28, exposure: 34
      },
      phases: [
        {
          name: 'Infrastructure hardening',
          brief: 'Protect command nodes, ports, depots, cyber systems, and population confidence before the force moves.',
          pressure: { homeland: -6, dib: -3, initiative: -3, exposure: 3 }
        },
        {
          name: 'Mobilization decision',
          brief: 'Generate combat power without exhausting training, medical depth, or strategic lift.',
          pressure: { readiness: -5, sustainment: -5, escalation: 3 }
        },
        {
          name: 'Force-flow contest',
          brief: 'Adversary disruption targets the bridge between homeland readiness and theater posture.',
          pressure: { homeland: -5, sustainment: -8, denial: -4, exposure: 4 }
        },
        {
          name: 'Industrial endurance',
          brief: 'Munitions, repair parts, and ship/aircraft availability become the operational limiter.',
          pressure: { dib: -9, sustainment: -5, readiness: -4 }
        },
        {
          name: 'Civil and allied resilience',
          brief: 'The campaign must stay politically durable while avoiding uncontrolled escalation.',
          pressure: { homeland: -4, allies: -5, escalation: 5, initiative: -2 }
        }
      ]
    },
    {
      id: 'multi-theater-deterrence',
      name: 'Multi-theater opportunism check',
      theater: 'Global risk overlay',
      objective: 'Hold the Indo-Pacific priority while preventing secondary opportunistic aggression from breaking readiness.',
      budget: 6,
      metrics: {
        denial: 45, homeland: 51, allies: 48, dib: 39, readiness: 45,
        sustainment: 40, initiative: 43, escalation: 36, exposure: 36
      },
      phases: [
        {
          name: 'Priority setting',
          brief: 'Make tradeoffs explicit so the pacing theater is not silently hollowed out.',
          pressure: { denial: -4, readiness: -3, allies: -2, initiative: -2 }
        },
        {
          name: 'Secondary flare-up',
          brief: 'A secondary theater creates pressure to divert scarce readiness and munitions.',
          pressure: { dib: -5, readiness: -6, sustainment: -3, escalation: 4 }
        },
        {
          name: 'Alliance coordination',
          brief: 'Burden-sharing determines whether the main theater can remain the priority.',
          pressure: { allies: -7, denial: -3, initiative: -3 }
        },
        {
          name: 'Inventory shock',
          brief: 'The campaign exposes whether the defense industrial base can support extended operations.',
          pressure: { dib: -10, sustainment: -5, readiness: -2 }
        },
        {
          name: 'Deterrence reset',
          brief: 'The final posture must show denial power without uncontrolled escalation.',
          pressure: { denial: -5, homeland: -3, escalation: 6, exposure: 3 }
        }
      ]
    }
  ];

  var ACTIONS = [
    {
      id: 'theater-posture',
      name: 'Joint theater posture',
      type: 'Posture',
      cost: 2,
      text: 'Move from presence to resilient posture: command relationships, basing access, force-flow priorities, and sustainment nodes.',
      loes: ['denial', 'allies'],
      services: ['joint', 'land', 'access'],
      effects: { denial: 7, allies: 5, sustainment: 4, exposure: 3, escalation: 1 }
    },
    {
      id: 'distributed-basing',
      name: 'Distributed basing and repair',
      type: 'Protection',
      cost: 2,
      text: 'Reduce single-point failure risk with dispersal, repair capacity, and preplanned recovery options.',
      loes: ['denial', 'homeland'],
      services: ['air', 'littoral', 'protection'],
      effects: { denial: 6, sustainment: 7, readiness: -1, exposure: -6 }
    },
    {
      id: 'partner-access',
      name: 'Partner access and burden-sharing',
      type: 'Alliance',
      cost: 2,
      text: 'Turn partner will into usable access, shared responsibilities, and coalition sustainment capacity.',
      loes: ['allies', 'denial'],
      services: ['joint', 'alliance', 'access'],
      effects: { allies: 12, sustainment: 4, initiative: 4, escalation: -2 }
    },
    {
      id: 'industrial-surge',
      name: 'DIB munitions and repair surge',
      type: 'Industrial base',
      cost: 3,
      text: 'Shift from exquisite plans to executable production, repair, inventory, and replacement assumptions.',
      loes: ['dib'],
      services: ['joint', 'sustainment'],
      effects: { dib: 14, sustainment: 6, readiness: -3, escalation: 1 }
    },
    {
      id: 'mission-assurance',
      name: 'Cyber and space mission assurance',
      type: 'Resilience',
      cost: 2,
      text: 'Protect command, sensing, timing, navigation, and data pathways under contested conditions.',
      loes: ['homeland', 'denial'],
      services: ['space', 'cyber', 'sensing', 'c2'],
      effects: { homeland: 6, readiness: 6, denial: 4, initiative: 4, exposure: -3 }
    },
    {
      id: 'logistics-rehearsal',
      name: 'Contested logistics rehearsal',
      type: 'Sustainment',
      cost: 2,
      text: 'Stress-test ports, intratheater lift, fuel, medical, repair, and distribution under attack assumptions.',
      loes: ['denial', 'dib'],
      services: ['land', 'sustainment', 'protection'],
      effects: { sustainment: 13, readiness: 5, dib: -2, exposure: -4 }
    },
    {
      id: 'reserve-mobilization',
      name: 'Mobilization and medical depth',
      type: 'Homeland',
      cost: 2,
      text: 'Generate replacement capacity, casualty care, civil support, and continuity of operations.',
      loes: ['homeland'],
      services: ['land', 'protection'],
      effects: { homeland: 9, readiness: 5, sustainment: 4, escalation: 2 }
    },
    {
      id: 'strategic-comms',
      name: 'Strategic communications and civil resilience',
      type: 'Political',
      cost: 1,
      text: 'Keep publics, allies, and decision makers aligned around objectives, thresholds, and campaign endurance.',
      loes: ['homeland', 'allies'],
      services: ['joint', 'alliance'],
      effects: { homeland: 6, allies: 6, initiative: 3, escalation: -4 }
    },
    {
      id: 'iamd-priority',
      name: 'Air and missile defense prioritization',
      type: 'Protection',
      cost: 2,
      text: 'Choose what must be protected first: people, C2, logistics, sortie generation, or allied access.',
      loes: ['homeland', 'denial'],
      services: ['air', 'land', 'protection'],
      effects: { denial: 8, homeland: 4, sustainment: -3, exposure: -2, escalation: 2 }
    },
    {
      id: 'decision-advantage',
      name: 'Decision advantage rehearsal',
      type: 'C2',
      cost: 2,
      text: 'Exercise commander decision cycles, authorities, data quality, deception tolerance, and loss-of-comms branches.',
      loes: ['denial'],
      services: ['joint', 'c2', 'sensing'],
      effects: { initiative: 9, readiness: 6, denial: 4 }
    },
    {
      id: 'signature-discipline',
      name: 'Signature and deception discipline',
      type: 'Survivability',
      cost: 1,
      text: 'Reduce force exposure by making survivability a campaign habit, not a last-minute checklist.',
      loes: ['denial'],
      services: ['littoral', 'land', 'air', 'sensing'],
      effects: { exposure: -10, denial: 4, initiative: 2 }
    },
    {
      id: 'munitions-discipline',
      name: 'Munitions allocation discipline',
      type: 'Industrial base',
      cost: 1,
      text: 'Bind objectives to inventory, production rates, and acceptable depletion before the fight starts.',
      loes: ['dib', 'denial'],
      services: ['joint', 'sustainment'],
      effects: { dib: 7, sustainment: 7, denial: -2, initiative: 1 }
    },
    {
      id: 'coalition-c2',
      name: 'Coalition command integration',
      type: 'Alliance',
      cost: 2,
      text: 'Practice command relationships, data sharing, handoffs, liaison flow, and rules alignment.',
      loes: ['allies', 'denial'],
      services: ['joint', 'alliance', 'c2'],
      effects: { allies: 10, readiness: 3, initiative: 5, exposure: -1 }
    },
    {
      id: 'maritime-denial',
      name: 'Maritime denial and access screen',
      type: 'Access',
      cost: 2,
      text: 'Protect sea lines, create operational dilemmas, and keep the theater sustainment bridge viable.',
      loes: ['denial', 'allies'],
      services: ['maritime', 'access', 'sensing'],
      effects: { denial: 8, sustainment: 4, allies: 3, exposure: 2 }
    }
  ];

  var SYNERGIES = [
    {
      needs: ['partner-access', 'logistics-rehearsal'],
      effects: { sustainment: 4, allies: 2 },
      note: 'Coalition access made the logistics rehearsal executable.'
    },
    {
      needs: ['mission-assurance', 'decision-advantage'],
      effects: { initiative: 4, exposure: -2 },
      note: 'Protected sensing and rehearsed authorities improved decision advantage.'
    },
    {
      needs: ['industrial-surge', 'munitions-discipline'],
      effects: { dib: 4, sustainment: 3 },
      note: 'Production and allocation choices reinforced each other.'
    },
    {
      needs: ['iamd-priority', 'distributed-basing'],
      effects: { homeland: 3, exposure: -3 },
      note: 'Protection priorities were credible because the basing plan was distributed.'
    }
  ];

  /* ── Persistence ─────────────────────────────────────────── */

  var STORAGE_KEY = 'strikesim_campaign_v1';
  var SCHEMA_VERSION = 1;
  var _saveTimer = null;
  var _lastAutosaveWarnAt = 0;   // C-043: rate-limit autosave failure toasts
  var LOG_ROW_CAP = 20;          // C-013: maximum retained log/result rows

  /* ── C-011: Scenario fingerprint ──────────────────────────────────────────────────
   * Compute a lightweight stable hash from the active graph's sorted node-id list and
   * team counts.  We avoid touching game.js (which has its own hashSeed internally).
   * Result is a short hex string or 'none' when no graph is loaded.                */
  function scenarioFingerprint() {
    try {
      var graph = (window.AppState && window.AppState.activeGraph && window.AppState.activeGraph()) || { nodes: [] };
      var nodes = graph.nodes || [];
      if (!nodes.length) return 'none';
      var blue = 0, red = 0;
      var ids = nodes.map(function (n) {
        var team = n.team || n.originalTeam || '';
        if (team === 'blue') blue++;
        else if (team === 'red') red++;
        return String(n.id || '');
      });
      ids.sort();
      // FNV-1a over the sorted-ID string + team counts
      var str = ids.join(',') + '|b' + blue + 'r' + red;
      var h = 2166136261 >>> 0;
      for (var i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (Math.imul ? Math.imul(h, 16777619) : ((h * 16777619) >>> 0)) >>> 0;
      }
      return (h || 1).toString(16) + '_b' + blue + 'r' + red + 'n' + nodes.length;
    } catch (e) { return 'none'; }
  }

  /* ── C-013: Deep normalization of a payload before it touches live state ──────────
   * Returns a clean {selectedCampaignId, selectedLensId, state} object, or null when
   * the data is unrecoverable.  All coercions are silent; only a top-level rejection
   * (e.g. unknown campaignId) raises a descriptive string via the returned error key. */
  function normalizePayload(p) {
    try {
      if (!p || typeof p !== 'object') return { error: 'not an object' };
      if (p.__version !== SCHEMA_VERSION) return { error: 'schema version mismatch (got ' + p.__version + ', expected ' + SCHEMA_VERSION + ')' };

      // --- top-level selection IDs ---
      var selCampaignId = typeof p.selectedCampaignId === 'string' ? p.selectedCampaignId : 'indopacom-denial';
      var selLensId     = typeof p.selectedLensId     === 'string' ? p.selectedLensId     : 'army';

      // Reject unknown campaign IDs outright — render will break without a real campaign
      if (!CAMPAIGNS.some(function (c) { return c.id === selCampaignId; })) {
        return { error: 'unknown selectedCampaignId "' + selCampaignId + '"' };
      }
      // Unknown lens → fall back to joint rather than reject
      if (!SERVICE_LENSES[selLensId]) selLensId = 'joint';

      // --- state sub-object (may be null — pre-start save) ---
      var normState = null;
      if (p.state !== null && p.state !== undefined && typeof p.state === 'object') {
        var s = p.state;

        var campaignId = typeof s.campaignId === 'string' ? s.campaignId : selCampaignId;
        if (!CAMPAIGNS.some(function (c) { return c.id === campaignId; })) campaignId = selCampaignId;
        var c = campaignById(campaignId);

        var lensId = typeof s.lensId === 'string' ? s.lensId : selLensId;
        if (!SERVICE_LENSES[lensId]) lensId = selLensId;

        // phaseIndex must be a non-negative integer within the campaign's phase array
        var phaseIndex = 0;
        if (typeof s.phaseIndex === 'number' && isFinite(s.phaseIndex)) {
          phaseIndex = Math.max(0, Math.floor(s.phaseIndex));
        }
        // complete is derived from phaseIndex vs phase count — never trust the stored value
        var maxPhaseIndex = c.phases.length;
        if (phaseIndex > maxPhaseIndex) phaseIndex = maxPhaseIndex;
        var complete = phaseIndex >= maxPhaseIndex;

        // metrics: numeric, clamped 0-100, unknown keys dropped
        var rawMetrics = (s.metrics && typeof s.metrics === 'object') ? s.metrics : {};
        var metrics = {};
        Object.keys(METRICS).forEach(function (k) {
          var v = Number(rawMetrics[k]);
          metrics[k] = isFinite(v) ? clamp(Math.round(v), 0, 100) : (c.metrics[k] || 50);
        });

        // selected: filter to known action IDs only
        var knownActionIds = ACTIONS.reduce(function (m, a) { m[a.id] = true; return m; }, {});
        var selected = Array.isArray(s.selected)
          ? s.selected.filter(function (id) { return typeof id === 'string' && knownActionIds[id]; })
          : [];

        // Validate and normalise a single log/result row
        function normalizeRow(r) {
          if (!r || typeof r !== 'object') return null;
          var phase = typeof r.phase === 'string' ? r.phase : '';
          var actions = Array.isArray(r.actions) ? r.actions.filter(function (v) { return typeof v === 'string'; }) : [];
          var notes   = Array.isArray(r.notes)   ? r.notes.filter(function (v) { return typeof v === 'string'; }) : [];
          var score   = typeof r.score === 'number' && isFinite(r.score) ? r.score : 0;

          function normalizeMetricObj(obj) {
            if (!obj || typeof obj !== 'object') return {};
            var out = {};
            Object.keys(obj).forEach(function (k) {
              var v = Number(obj[k]);
              if (isFinite(v)) out[k] = v;
            });
            return out;
          }
          return {
            phase: phase,
            actions: actions.slice(0, 50),     // cap to avoid absurd arrays
            before: normalizeMetricObj(r.before),
            after:  normalizeMetricObj(r.after),
            effects: normalizeMetricObj(r.effects),
            notes: notes.slice(0, 20),
            score: score
          };
        }

        var log = Array.isArray(s.log)
          ? s.log.map(normalizeRow).filter(Boolean).slice(0, LOG_ROW_CAP)
          : [];
        var results = Array.isArray(s.results)
          ? s.results.map(normalizeRow).filter(Boolean).slice(0, LOG_ROW_CAP)
          : [];

        // graphSignal: keep as opaque object, but sanitize to plain string/number values
        var graphSignal = null;
        if (s.graphSignal && typeof s.graphSignal === 'object') {
          graphSignal = {};
          Object.keys(s.graphSignal).forEach(function (k) {
            var v = s.graphSignal[k];
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
              graphSignal[k] = v;
            }
          });
        }

        // C-011: preserve saved scenario fingerprint if present
        var savedFingerprint = (typeof s.scenarioFingerprint === 'string') ? s.scenarioFingerprint : null;

        normState = {
          campaignId: campaignId,
          lensId: lensId,
          phaseIndex: phaseIndex,
          metrics: metrics,
          selected: selected,
          log: log,
          results: results,
          graphSignal: graphSignal,
          complete: complete,
          scenarioFingerprint: savedFingerprint
        };
      }

      return {
        selectedCampaignId: selCampaignId,
        selectedLensId: selLensId,
        state: normState
      };
    } catch (e) {
      return { error: 'normalization threw: ' + e.message };
    }
  }

  /** Validate a parsed payload enough to trust loading it. */
  function isValidPayload(p) {
    if (!p || typeof p !== 'object') return false;
    if (p.__version !== SCHEMA_VERSION) return false;
    if (typeof p.selectedCampaignId !== 'string') return false;
    if (typeof p.selectedLensId !== 'string') return false;
    if (p.state !== null && typeof p.state === 'object') {
      var s = p.state;
      if (typeof s.campaignId !== 'string') return false;
      if (typeof s.phaseIndex !== 'number') return false;
      if (!s.metrics || typeof s.metrics !== 'object') return false;
      if (!Array.isArray(s.selected)) return false;
      if (!Array.isArray(s.log)) return false;
      if (!Array.isArray(s.results)) return false;
    }
    return true;
  }

  /** Return a plain-data snapshot of module-level state safe for JSON. */
  function buildSavePayload() {
    return {
      __version: SCHEMA_VERSION,
      savedAt: Date.now(),
      selectedCampaignId: selectedCampaignId,
      selectedLensId: selectedLensId,
      state: state ? {
        campaignId: state.campaignId,
        lensId: state.lensId,
        phaseIndex: state.phaseIndex,
        metrics: Object.assign({}, state.metrics),
        selected: state.selected.slice(),
        log: state.log.map(function (r) {
          return {
            phase: r.phase,
            actions: r.actions.slice(),
            before: Object.assign({}, r.before),
            after: Object.assign({}, r.after),
            effects: Object.assign({}, r.effects),
            notes: r.notes.slice(),
            score: r.score
          };
        }),
        results: state.results.map(function (r) {
          return {
            phase: r.phase,
            actions: r.actions.slice(),
            before: Object.assign({}, r.before),
            after: Object.assign({}, r.after),
            effects: Object.assign({}, r.effects),
            notes: r.notes.slice(),
            score: r.score
          };
        }),
        graphSignal: state.graphSignal ? Object.assign({}, state.graphSignal) : null,
        complete: state.complete,
        /* C-011: fingerprint of the scenario graph at campaign-start time */
        scenarioFingerprint: state.scenarioFingerprint || null
      } : null
    };
  }

  /* C-043: Attempt a localStorage write; surface quota/unavailable failures visibly. */
  function tryWriteStorage(key, value, isAutosave) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      var now = Date.now();
      if (!isAutosave) {
        // Manual save — always warn
        toast('Save failed (storage error: ' + e.message + '). Use Export JSON to preserve your campaign.', 'warn');
        note('Campaign Planner: localStorage write failed — ' + e.message);
      } else {
        // Autosave — rate-limit to one warning per 60 s to avoid noise
        if (now - _lastAutosaveWarnAt > 60000) {
          _lastAutosaveWarnAt = now;
          toast('Autosave failed — browser storage may be unavailable. Use Export JSON to keep your progress.', 'warn');
          note('Campaign Planner: autosave failed — ' + e.message);
        }
      }
      return false;
    }
  }

  function saveCampaign() {
    var payload = buildSavePayload();
    var ok = tryWriteStorage(STORAGE_KEY, JSON.stringify(payload), false);
    if (ok) toast('Campaign saved.', 'ok');
    return ok;
  }

  /* C-011 + C-013: Apply a normalised payload to module state; warn on fingerprint mismatch. */
  function applyNormalizedPayload(norm, source) {
    selectedCampaignId = norm.selectedCampaignId;
    selectedLensId     = norm.selectedLensId;
    state              = norm.state;
    // C-011: check fingerprint if the saved state has one
    if (state && state.scenarioFingerprint && state.scenarioFingerprint !== 'none') {
      var currentFp = scenarioFingerprint();
      if (currentFp !== 'none' && currentFp !== state.scenarioFingerprint) {
        var msg = source + ' campaign was saved against a different scenario graph ' +
          '(saved: ' + state.scenarioFingerprint + ', current: ' + currentFp + '). ' +
          'Metrics may not match the loaded board — verify before launching War Game.';
        toast(msg, 'warn');
        note('Campaign Planner: ' + msg);
      }
    }
  }

  function loadCampaign() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { toast('No saved campaign found.', 'warn'); return false; }
      var payload = JSON.parse(raw);
      // C-013: deep-normalize before applying
      var norm = normalizePayload(payload);
      if (norm.error) { toast('Saved data invalid — ignored (' + norm.error + ').', 'warn'); return false; }
      applyNormalizedPayload(norm, 'Saved');
      render();
      toast('Campaign loaded.', 'ok');
      return true;
    } catch (e) {
      toast('Could not load campaign: ' + e.message, 'warn');
      return false;
    }
  }

  function resetCampaign() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    selectedCampaignId = 'indopacom-denial';
    selectedLensId = 'army';
    state = null;
    render();
    toast('Campaign reset to defaults.', 'ok');
  }

  function exportCampaign() {
    try {
      var payload = buildSavePayload();
      var text = JSON.stringify(payload, null, 2);
      var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'strikesim-campaign.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 0);
      toast('Campaign JSON exported.', 'ok');
    } catch (e) {
      toast('Export failed: ' + e.message, 'warn');
    }
  }

  function importCampaign(file) {
    if (!(file instanceof File)) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var payload = JSON.parse(ev.target.result);
        // C-013: deep-normalize; reject with toast on error, never corrupt live state
        var norm = normalizePayload(payload);
        if (norm.error) { toast('Import failed: ' + norm.error + '.', 'warn'); return; }
        applyNormalizedPayload(norm, 'Imported');
        // Persist the normalised (clean) version — C-043: surface write failures
        tryWriteStorage(STORAGE_KEY, JSON.stringify(payload), false);
        render();
        toast('Campaign imported.', 'ok');
      } catch (e) {
        toast('Import failed: ' + e.message, 'warn');
      }
    };
    reader.readAsText(file);
  }

  /** Debounced autosave — called after any state mutation. */
  function scheduleAutosave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () {
      // C-043: surface autosave failures (rate-limited inside tryWriteStorage)
      var payload = buildSavePayload();
      tryWriteStorage(STORAGE_KEY, JSON.stringify(payload), true);
    }, 400);
  }

  /** Restore on init from localStorage (silent, never throws). */
  function restoreOnInit() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var payload = JSON.parse(raw);
      // C-013: deep-normalize on startup too; drop silently on error
      var norm = normalizePayload(payload);
      if (norm.error) return;
      // Fingerprint check at init is deferred — graph may not yet be loaded
      selectedCampaignId = norm.selectedCampaignId;
      selectedLensId     = norm.selectedLensId;
      state              = norm.state;
    } catch (e) {}
  }

  /** Emit feedback via the app's toast or event log (both guarded). */
  function toast(text, tone) {
    try {
      if (typeof window.showToast === 'function') { window.showToast(text, tone); return; }
    } catch (e) {}
    note(text);
  }

  /* ── End Persistence ─────────────────────────────────────── */

  var CSS = [
    '#cp-launch{position:fixed;top:14px;left:14px;z-index:1399;',
      'background:linear-gradient(180deg,#20351f,#102214);color:#e9ffe7;border:1px solid #4f8a48;',
      'padding:8px 14px;border-radius:8px;font:700 12px/1 system-ui,sans-serif;letter-spacing:.04em;',
      'cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.06);}',
    '#cp-launch:hover{border-color:#7ddc72;color:#fff;box-shadow:0 4px 22px rgba(100,200,90,.25);}',
    '@media (max-width:620px){#cp-launch{top:52px;left:12px;}}',
    '#cp-hud{position:fixed;top:0;left:0;width:min(430px,calc(100vw - 26px));height:100%;z-index:1392;',
      'display:flex;flex-direction:column;background:linear-gradient(180deg,rgba(9,17,21,.98),rgba(6,11,15,.99));',
      'border-right:1px solid #25462f;box-shadow:8px 0 30px rgba(0,0,0,.52);color:#dce8dc;',
      'font:13px/1.42 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
      'transform:translateX(-100%);transition:transform .25s ease;}',
    '#cp-hud.cp-open{transform:translateX(0);}',
    '.cp-hidden{display:none!important;}',
    '#cp-hud header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:12px 14px;',
      'border-bottom:1px solid #203d2b;background:linear-gradient(180deg,#11251a,#091610);}',
    '#cp-hud .cp-title{font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#ecffee;}',
    '#cp-hud .cp-sub{font-size:11px;color:#9fbaa5;margin-top:2px;}',
    '#cp-x{background:none;border:none;color:#95aa97;cursor:pointer;font-size:20px;line-height:1;padding:1px 6px;}',
    '#cp-x:hover{color:#fff;}',
    '.cp-body{flex:1;min-height:0;overflow-y:auto;padding:12px 14px;}',
    '.cp-foot{border-top:1px solid #203d2b;padding:10px 14px;background:rgba(7,13,10,.78);}',
    '.cp-sec{margin-bottom:14px;}',
    '.cp-sec h4{margin:0 0 7px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8caf91;font-weight:800;}',
    '.cp-note{font-size:11px;color:#8da394;}',
    '.cp-brief{border:1px solid #244932;border-radius:8px;background:rgba(18,36,24,.55);padding:9px 10px;color:#dcefe0;}',
    '.cp-brief strong{color:#f1fff2;}',
    '.cp-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}',
    '.cp-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}',
    '.cp-campaign{width:100%;text-align:left;border:1px solid #244932;border-radius:8px;background:rgba(18,36,24,.45);',
      'color:#dcefe0;padding:9px 10px;cursor:pointer;margin-bottom:7px;}',
    '.cp-campaign.on{border-color:#79ce72;background:rgba(52,94,44,.38);}',
    '.cp-campaign .nm{font-weight:800;color:#f1fff2;font-size:12px;}',
    '.cp-campaign .tx{font-size:11px;color:#a9c1ad;margin-top:3px;white-space:normal;}',
    '.cp-select{width:100%;background:#0b1510;border:1px solid #244932;color:#e5f5e7;border-radius:6px;padding:8px 9px;font-size:12px;}',
    '.cp-metric{border:1px solid #244932;border-radius:8px;background:rgba(11,22,15,.72);padding:8px;}',
    '.cp-metric .top{display:flex;align-items:center;justify-content:space-between;gap:6px;}',
    '.cp-metric .lab{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#96af9b;font-weight:800;}',
    '.cp-metric .val{font-size:18px;font-weight:800;color:#f1fff2;}',
    '.cp-bar{height:5px;border-radius:3px;background:#172a1d;overflow:hidden;margin-top:6px;}',
    '.cp-bar i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,#4f8a48,#9be58f);}',
    '.cp-bar.warn i{background:linear-gradient(90deg,#a47b28,#ffd166);}',
    '.cp-bar.bad i{background:linear-gradient(90deg,#8d2e35,#ff6b6b);}',
    '.cp-loes{display:grid;grid-template-columns:1fr 1fr;gap:6px;}',
    '.cp-loe{border:1px solid #244932;border-radius:8px;padding:7px 8px;background:rgba(11,22,15,.5);font-size:11px;}',
    '.cp-loe b{display:block;color:#eaffed;font-size:11px;margin-bottom:2px;}',
    '.cp-actions{display:grid;grid-template-columns:1fr;gap:7px;}',
    '.cp-action{border:1px solid #244932;border-radius:8px;background:rgba(11,22,15,.62);color:#dcefe0;',
      'padding:8px 9px;text-align:left;cursor:pointer;}',
    '.cp-action:hover{border-color:#79ce72;background:rgba(31,60,37,.72);}',
    '.cp-action.on{border-color:#9be58f;background:rgba(56,92,43,.75);}',
    '.cp-action[disabled]{opacity:.45;cursor:not-allowed;}',
    '.cp-action .head{display:flex;align-items:center;justify-content:space-between;gap:8px;}',
    '.cp-action .nm{font-size:12px;font-weight:800;color:#f5fff5;}',
    '.cp-chip{display:inline-block;border:1px solid #36583d;border-radius:999px;padding:1px 6px;margin:5px 4px 0 0;',
      'font-size:10px;color:#b9d7bd;background:rgba(23,42,28,.75);}',
    '.cp-cost{font-size:10px;color:#b6dbb1;border:1px solid #4f8a48;border-radius:999px;padding:1px 6px;white-space:nowrap;}',
    '.cp-action .tx{font-size:11px;color:#a8bead;margin-top:4px;white-space:normal;}',
    '.cp-log{list-style:none;margin:0;padding:0;}',
    '.cp-log li{border-bottom:1px solid #18311f;padding:6px 0;font-size:11px;color:#abc1ae;}',
    '.cp-log li b{color:#f1fff2;}',
    '.cp-btn{background:#16301d;color:#e9ffe7;border:1px solid #3e7440;border-radius:6px;padding:7px 10px;',
      'font:700 12px system-ui,sans-serif;cursor:pointer;}',
    '.cp-btn:hover{border-color:#7ddc72;background:#1f4327;}',
    '.cp-btn.primary{width:100%;background:linear-gradient(180deg,#2a7735,#1d5427);border-color:#62bd67;color:#f5fff5;padding:10px;}',
    '.cp-btn.secondary{background:#171f1a;border-color:#314838;color:#d7ead9;}',
    '.cp-btn:disabled{opacity:.45;cursor:not-allowed;}',
    '.cp-assess{border-radius:8px;border:1px solid #244932;background:rgba(18,36,24,.62);padding:10px;}',
    '.cp-assess.good{border-color:#79ce72;}.cp-assess.warn{border-color:#ffd166;}.cp-assess.bad{border-color:#ff6b6b;}',
    '.cp-score{font-size:30px;font-weight:900;color:#f1fff2;line-height:1;margin:3px 0 5px;}',
    /* persistence controls */
    '.cp-persist{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;align-items:center;}',
    '.cp-persist-btn{font:700 11px/1 var(--mono,\'Courier New\',monospace);letter-spacing:.04em;cursor:pointer;',
      'border-radius:6px;padding:5px 9px;border:1px solid;transition:border-color .15s,background .15s;}',
    '.cp-persist-btn.cyan{color:#7fffd4;border-color:#20544a;background:rgba(15,40,35,.72);}',
    '.cp-persist-btn.cyan:hover{border-color:var(--accent,#7fffd4);background:rgba(30,70,55,.82);}',
    '.cp-persist-btn.amber{color:#ffd166;border-color:#4a3d10;background:rgba(35,28,5,.72);}',
    '.cp-persist-btn.amber:hover{border-color:var(--amber,#ffd166);background:rgba(60,45,8,.82);}',
    '.cp-persist-btn.danger{color:#ff9a9a;border-color:#4a1a1a;background:rgba(35,10,10,.72);}',
    '.cp-persist-btn.danger:hover{border-color:#ff6b6b;background:rgba(55,15,15,.82);}',
    '.cp-import-label{font:700 11px/1 var(--mono,\'Courier New\',monospace);letter-spacing:.04em;cursor:pointer;',
      'border-radius:6px;padding:5px 9px;border:1px solid;color:#b0d4ff;border-color:#1e3560;',
      'background:rgba(12,25,50,.72);transition:border-color .15s,background .15s;}',
    '.cp-import-label:hover{border-color:#4d8aff;background:rgba(20,40,80,.82);}',
    '.cp-import-input{display:none;}'
  ].join('');

  function injectCss() {
    if (document.getElementById('cp-style')) return;
    var s = document.createElement('style');
    s.id = 'cp-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function el(html) {
    var d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstChild;
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function campaignById(id) {
    return CAMPAIGNS.filter(function (c) { return c.id === id; })[0] || CAMPAIGNS[0];
  }

  function actionById(id) {
    return ACTIONS.filter(function (a) { return a.id === id; })[0];
  }

  function build() {
    launchBtn = el('<button id="cp-launch" title="Open NDS Campaign Planner">Campaign Planner</button>');
    launchBtn.addEventListener('click', open);
    document.body.appendChild(launchBtn);

    hud = el('<div id="cp-hud"><header><div><div class="cp-title">Campaign Planner</div><div class="cp-sub" id="cp-sub">NDS-aligned campaign game</div></div><button id="cp-x" title="Close">x</button></header><div class="cp-body" id="cp-body"></div><div class="cp-foot" id="cp-foot"></div></div>');
    document.body.appendChild(hud);
    hud.querySelector('#cp-x').addEventListener('click', close);
    hud.addEventListener('click', onClick);
    hud.addEventListener('change', onChange);
  }

  function open() {
    hud.classList.add('cp-open');
    launchBtn.classList.add('cp-hidden');
    render();
  }

  function close() {
    hud.classList.remove('cp-open');
    launchBtn.classList.remove('cp-hidden');
  }

  function graphSignal() {
    var graph = (window.AppState && window.AppState.activeGraph && window.AppState.activeGraph()) || { nodes: [], links: [] };
    var nodes = graph.nodes || [];
    var out = {
      blueCount: 0, redCount: 0, blueValue: 0, redValue: 0,
      geoCount: 0, domains: {}, highValueBlue: 0, highValueRed: 0
    };
    nodes.forEach(function (n) {
      var team = n.team || n.originalTeam;
      var value = Number(n.importance || 5) * Math.max(1, Number(n.cascScore || 1));
      var fields = { blue: ['blueCount', 'blueValue', 'highValueBlue'], red: ['redCount', 'redValue', 'highValueRed'] }[team];
      if (fields) {
        out[fields[0]] += 1;
        out[fields[1]] += value;
        out[fields[2]] += (n.importance || 0) >= 8 ? 1 : 0;
      }
      out.geoCount += (n.lat != null && n.lon != null) ? 1 : 0;
      var d = Array.isArray(n.domain) ? n.domain : (n.domain ? [n.domain] : []);
      d.forEach(function (name) { out.domains[name] = (out.domains[name] || 0) + 1; });
    });
    var totalValue = out.blueValue + out.redValue;
    out.threatPressure = totalValue ? out.redValue / totalValue : 0.5;
    out.hasScenario = nodes.length > 0;
    out.summary = out.hasScenario
      ? (out.blueCount + ' blue / ' + out.redCount + ' red nodes, ' + out.geoCount + ' geo-tagged')
      : 'No active scenario graph detected';
    return out;
  }

  function startCampaign() {
    var c = campaignById(selectedCampaignId);
    var signal = graphSignal();
    var metrics = Object.assign({}, c.metrics);
    if (signal.hasScenario) {
      var pressure = clamp((signal.threatPressure - 0.5) * 18, -6, 8);
      metrics.denial = clamp(metrics.denial - pressure, 0, 100);
      metrics.exposure = clamp(metrics.exposure + Math.max(0, pressure), 0, 100);
      if (signal.geoCount >= Math.max(8, Math.floor((signal.blueCount + signal.redCount) * 0.4))) {
        metrics.initiative = clamp(metrics.initiative + 3, 0, 100);
      }
      if (signal.highValueBlue > 12) metrics.homeland = clamp(metrics.homeland - 2, 0, 100);
    }
    state = {
      campaignId: c.id,
      lensId: selectedLensId,
      phaseIndex: 0,
      metrics: metrics,
      selected: [],
      log: [],
      results: [],
      graphSignal: signal,
      complete: false,
      /* C-011: fingerprint of the scenario at campaign-start time */
      scenarioFingerprint: scenarioFingerprint()
    };
    note('Campaign Planner started: ' + c.name + ' using ' + SERVICE_LENSES[selectedLensId].name + '.');
    scheduleAutosave();
    render();
  }

  function selectedCost() {
    if (!state) return 0;
    return state.selected.reduce(function (sum, id) {
      var a = actionById(id);
      return sum + (a ? a.cost : 0);
    }, 0);
  }

  function toggleAction(id) {
    if (!state || state.complete) return;
    var c = campaignById(state.campaignId);
    var a = actionById(id);
    if (!a) return;
    var idx = state.selected.indexOf(id);
    if (idx >= 0) {
      state.selected.splice(idx, 1);
    } else if (selectedCost() + a.cost <= c.budget) {
      state.selected.push(id);
    } else {
      note('Campaign Planner: action rejected, phase budget exceeded.');
    }
    scheduleAutosave();
    render();
  }

  function mergeEffects(dst, src, mult) {
    Object.keys(src || {}).forEach(function (k) {
      dst[k] = (dst[k] || 0) + src[k] * (mult || 1);
    });
  }

  function resolvePhase() {
    if (!state || state.complete || !state.selected.length) return;
    var c = campaignById(state.campaignId);
    var phase = c.phases[state.phaseIndex];
    var lens = SERVICE_LENSES[state.lensId] || SERVICE_LENSES.joint;
    var before = Object.assign({}, state.metrics);
    var effects = {};
    var notes = [];
    var selected = state.selected.map(actionById).filter(Boolean);

    selected.forEach(function (a) {
      mergeEffects(effects, a.effects, 1);
      var matchesLens = a.services.some(function (s) { return lens.tags.indexOf(s) >= 0; });
      if (matchesLens) {
        mergeEffects(effects, { readiness: 1, initiative: 1 }, 1);
      }
    });

    SYNERGIES
      .filter(function (s) { return s.needs.every(hasSelected); })
      .forEach(function (s) {
        mergeEffects(effects, s.effects, 1);
        notes.push(s.note);
      });

    var addressed = {};
    selected.forEach(function (a) {
      a.loes.forEach(function (loe) { addressed[loe] = true; });
    });
    NDS_LOES
      .filter(function (loe) { return !addressed[loe.id]; })
      .forEach(function (loe) {
        var penalty = {};
        penalty[loe.metric] = -2;
        mergeEffects(effects, penalty, 1);
      });

    var threatMult = 1 + clamp(((state.graphSignal && state.graphSignal.threatPressure) || 0.5) - 0.5, -0.08, 0.14);
    mergeEffects(effects, phase.pressure, threatMult);

    if (selectedCost() >= c.budget) {
      mergeEffects(effects, { readiness: -2 }, 1);
      notes.push('Full budget execution created near-term force-management fatigue.');
    }

    Object.keys(effects).forEach(function (k) {
      state.metrics[k] = clamp(Math.round((state.metrics[k] || 0) + effects[k]), 0, 100);
    });

    if (state.metrics.initiative < 40) {
      state.metrics.denial = clamp(state.metrics.denial - 3, 0, 100);
      state.metrics.exposure = clamp(state.metrics.exposure + 3, 0, 100);
      notes.push('Low initiative let the adversary impose extra exposure.');
    }

    var result = {
      phase: phase.name,
      actions: selected.map(function (a) { return a.name; }),
      before: before,
      after: Object.assign({}, state.metrics),
      effects: effects,
      notes: notes,
      score: campaignScore(state.metrics)
    };
    state.results.push(result);
    state.log.unshift(result);
    state.selected = [];
    state.phaseIndex += 1;
    state.complete = state.phaseIndex >= c.phases.length;
    note('Campaign Planner resolved phase: ' + phase.name + ' (score ' + result.score + ').');
    scheduleAutosave();
    render();
  }

  function hasSelected(id) {
    return state && state.selected.indexOf(id) >= 0;
  }

  /* C-042: Floor thresholds for NDS-critical lines of effort.
   * A campaign can look healthy on aggregate while a single LOE collapses.
   * These gates detect that and force the assessment into failure/penalty territory. */
  var LOE_FLOOR_GATES = [
    { metric: 'denial',      label: 'Denial',      floor: 30 },
    { metric: 'homeland',    label: 'Homeland',     floor: 30 },
    { metric: 'allies',      label: 'Allies',       floor: 25 },
    { metric: 'dib',         label: 'DIB',          floor: 25 },
    { metric: 'readiness',   label: 'Readiness',    floor: 28 },
    { metric: 'sustainment', label: 'Sustainment',  floor: 28 }
  ];

  /** Returns the list of gate objects whose metric is below floor (given a metrics map). */
  function failedLoeGates(metrics) {
    return LOE_FLOOR_GATES.filter(function (g) {
      return (metrics[g.metric] || 0) < g.floor;
    });
  }

  function campaignScore(metrics) {
    var positive = POSITIVE.reduce(function (sum, k) { return sum + (metrics[k] || 0); }, 0) / POSITIVE.length;
    var risk = RISK.reduce(function (sum, k) { return sum + (100 - (metrics[k] || 0)); }, 0) / RISK.length;
    var base = Math.round(positive * 0.76 + risk * 0.24);
    /* C-042: Apply a score penalty for each failed floor gate so the aggregate
     * number reflects LOE collapse even when other metrics are healthy. */
    var failed = failedLoeGates(metrics);
    var penalty = failed.reduce(function (sum, g) {
      return sum + Math.round((g.floor - (metrics[g.metric] || 0)) * 0.5);
    }, 0);
    return Math.max(0, base - penalty);
  }

  function assessment(score) {
    /* C-042: check floor gates — any failure overrides a high aggregate score */
    var metrics = (state && state.metrics) ? state.metrics : {};
    var failed = failedLoeGates(metrics);
    if (failed.length) {
      var failedNames = failed.map(function (g) { return g.label + ' (' + (metrics[g.metric] || 0) + ')'; }).join(', ');
      return {
        tone: 'bad',
        label: 'Critical LOE collapse',
        text: 'One or more NDS lines of effort are below minimum threshold: ' + failedNames +
          '. The campaign cannot succeed without stabilizing these before conflict.',
        failedGates: failed
      };
    }
    return [
      { when: score >= 72 && metrics.escalation <= 58 && metrics.exposure <= 58, tone: 'good', label: 'Campaign advantage', text: 'The plan credibly denies adversary objectives while preserving coalition endurance.', failedGates: [] },
      { when: score >= 58, tone: 'warn', label: 'Contested but recoverable', text: 'The campaign can still work, but one or more strategic constraints remains fragile.', failedGates: [] },
      { when: true, tone: 'bad', label: 'Campaign failure risk', text: 'The force posture is likely too brittle for an extended contest.', failedGates: [] }
    ].find(function (a) { return a.when; });
  }

  function render() {
    if (!hud) return;
    (state ? renderCampaign : renderSetup)();
  }

  function persistControlsHtml() {
    var importId = 'cp-import-' + Math.random().toString(36).slice(2, 7);
    return '<div class="cp-persist">' +
      '<button class="cp-persist-btn cyan" data-persist-save title="Save campaign to browser storage">Save</button>' +
      '<button class="cp-persist-btn cyan" data-persist-load title="Load last saved campaign">Load</button>' +
      '<button class="cp-persist-btn danger" data-persist-reset title="Clear saved data and restore defaults">Reset</button>' +
      '<button class="cp-persist-btn amber" data-persist-exportjson title="Download campaign state as JSON">Export JSON</button>' +
      '<label class="cp-import-label" for="' + importId + '" title="Import a previously exported JSON file">Import JSON' +
        '<input id="' + importId + '" class="cp-import-input" type="file" accept=".json,application/json" data-persist-import></label>' +
      '</div>';
  }

  function renderSetup() {
    document.getElementById('cp-sub').textContent = 'NDS-aligned campaign game';
    var body = document.getElementById('cp-body');
    var foot = document.getElementById('cp-foot');
    body.innerHTML =
      persistControlsHtml() +
      '<div class="cp-sec"><div class="cp-brief"><strong>Design spine:</strong> defend the homeland, deny Indo-Pacific aggression, make allies operationally consequential, and test defense-industrial-base endurance. This mode uses unclassified abstractions over the loaded force network.</div></div>' +
      '<div class="cp-sec"><h4>Campaign frame</h4>' + CAMPAIGNS.map(function (c) {
        return '<button class="cp-campaign ' + (c.id === selectedCampaignId ? 'on' : '') + '" data-campaign="' + esc(c.id) + '">' +
          '<div class="nm">' + esc(c.name) + '</div><div class="tx">' + esc(c.objective) + '</div></button>';
      }).join('') + '</div>' +
      '<div class="cp-sec"><h4>Planner lens</h4><select class="cp-select" data-lens>' + Object.keys(SERVICE_LENSES).map(function (id) {
        var lens = SERVICE_LENSES[id];
        return '<option value="' + esc(id) + '"' + (id === selectedLensId ? ' selected' : '') + '>' + esc(lens.name) + '</option>';
      }).join('') + '</select><div class="cp-note" style="margin-top:6px;">' + esc(SERVICE_LENSES[selectedLensId].focus) + '</div></div>' +
      '<div class="cp-sec"><h4>NDS lines of effort</h4><div class="cp-loes">' + NDS_LOES.map(function (loe) {
        return '<div class="cp-loe"><b>' + esc(loe.label) + '</b><span>' + esc(METRICS[loe.metric].label) + ' is the visible score driver.</span></div>';
      }).join('') + '</div></div>' +
      '<div class="cp-sec"><h4>Scenario signal</h4><div class="cp-brief">' + esc(graphSignal().summary) + '</div></div>';
    foot.innerHTML = '<button class="cp-btn primary" data-start>Start Campaign</button>';
  }

  function renderCampaign() {
    var c = campaignById(state.campaignId);
    var phase = c.phases[state.phaseIndex];
    var score = campaignScore(state.metrics);
    var cost = selectedCost();
    document.getElementById('cp-sub').textContent = state.complete
      ? 'Campaign complete'
      : ('Phase ' + (state.phaseIndex + 1) + ' of ' + c.phases.length + ' - ' + c.theater);
    var body = document.getElementById('cp-body');
    var foot = document.getElementById('cp-foot');
    var phaseHtml = state.complete ? '' :
      '<div class="cp-sec"><h4>Current phase</h4><div class="cp-brief"><strong>' + esc(phase.name) + '</strong><br>' + esc(phase.brief) +
      '<div class="cp-note" style="margin-top:6px;">Budget: ' + cost + ' of ' + c.budget + ' planning points committed.</div></div></div>' +
      '<div class="cp-sec"><h4>Campaign initiatives</h4><div class="cp-actions">' + ACTIONS.map(function (a) {
        var on = state.selected.indexOf(a.id) >= 0;
        var disabled = !on && cost + a.cost > c.budget;
        return actionButton(a, on, disabled);
      }).join('') + '</div></div>';
    var footerHtml = state.complete
      ? '<div class="cp-row"><button class="cp-btn secondary" data-export>Export Brief</button>' +
        '<button class="cp-btn secondary" data-reset>New Campaign</button></div>' +
        '<button class="cp-btn primary" style="margin-top:8px;" data-wargame>Start War Game from Posture</button>'
      : '<div class="cp-row"><button class="cp-btn secondary" data-export>Export Brief</button><button class="cp-btn secondary" data-reset>New Campaign</button></div>' +
        '<button class="cp-btn primary" style="margin-top:8px;" data-resolve' + (state.selected.length ? '' : ' disabled') + '>Resolve Phase</button>';
    var html =
      persistControlsHtml() +
      '<div class="cp-sec"><div class="cp-brief"><strong>' + esc(c.name) + '</strong><br>' + esc(c.objective) +
      '<div class="cp-note" style="margin-top:6px;">Lens: ' + esc(SERVICE_LENSES[state.lensId].name) + ' - ' + esc(SERVICE_LENSES[state.lensId].focus) + '</div></div></div>' +
      '<div class="cp-sec"><h4>Campaign score</h4>' + renderAssessment(score) + '</div>' +
      '<div class="cp-sec"><h4>Strategic metrics</h4><div class="cp-grid">' + Object.keys(METRICS).map(function (k) {
        return metricCard(k, state.metrics[k]);
      }).join('') + '</div></div>' +
      phaseHtml +
      '<div class="cp-sec"><h4>Phase log</h4>' + renderLog() + '</div>';
    body.innerHTML = html;
    foot.innerHTML = footerHtml;
  }

  function renderAssessment(score) {
    var a = assessment(score);
    /* C-042: show failed gate chips below the assessment text when present */
    var gateHtml = '';
    if (a.failedGates && a.failedGates.length) {
      var metrics = (state && state.metrics) ? state.metrics : {};
      gateHtml = '<div style="margin-top:6px;">' + a.failedGates.map(function (g) {
        return '<span class="cp-chip" style="border-color:#ff6b6b;color:#ff9a9a;">' +
          esc(g.label) + ' ' + (metrics[g.metric] || 0) + ' &lt; ' + g.floor + '</span>';
      }).join('') + '</div>';
    }
    return '<div class="cp-assess ' + a.tone + '"><div class="cp-note">' + esc(a.label) + '</div><div class="cp-score">' +
      score + '</div><div>' + esc(a.text) + '</div>' + gateHtml + '</div>';
  }

  function metricCard(key, value) {
    var risk = RISK.indexOf(key) >= 0;
    var shown = risk ? (100 - value) : value;
    var tone = shown >= 70 ? '' : (shown >= 50 ? ' warn' : ' bad');
    return '<div class="cp-metric"><div class="top"><span class="lab">' + esc(METRICS[key].label) + '</span><span class="val">' +
      Math.round(value) + '</span></div><div class="cp-bar' + tone + '"><i style="width:' + clamp(Math.round(shown), 0, 100) + '%"></i></div>' +
      '<div class="cp-note">' + esc(METRICS[key].loe) + (risk ? ' risk lower is better' : '') + '</div></div>';
  }

  function actionButton(a, on, disabled) {
    return '<button class="cp-action ' + (on ? 'on' : '') + '" data-action="' + esc(a.id) + '"' + (disabled ? ' disabled' : '') + '>' +
      '<div class="head"><span class="nm">' + esc(a.name) + '</span><span class="cp-cost">' + a.cost + ' pt</span></div>' +
      '<div class="tx">' + esc(a.text) + '</div>' +
      '<div>' + a.loes.map(function (loe) { return '<span class="cp-chip">' + esc(loe) + '</span>'; }).join('') +
      '<span class="cp-chip">' + esc(a.type) + '</span></div></button>';
  }

  function renderLog() {
    if (!state.log.length) return '<div class="cp-note">No phases resolved yet.</div>';
    return '<ul class="cp-log">' + state.log.map(function (r) {
      return '<li><b>' + esc(r.phase) + '</b><br>' + esc(r.actions.join(', ')) +
        '<br>Score after phase: ' + r.score +
        (r.notes.length ? '<br>' + esc(r.notes.join(' ')) : '') + '</li>';
    }).join('') + '</ul>';
  }

  function exportBrief() {
    if (!state) return;
    var c = campaignById(state.campaignId);
    var score = campaignScore(state.metrics);
    var a = assessment(score);
    var lines = [
      '# StrikeSim 2040 Campaign Brief',
      '',
      'Campaign: ' + c.name,
      'Theater: ' + c.theater,
      'Planner lens: ' + SERVICE_LENSES[state.lensId].name,
      'Objective: ' + c.objective,
      'Scenario signal: ' + (state.graphSignal ? state.graphSignal.summary : 'not captured'),
      'Scenario fingerprint: ' + (state.scenarioFingerprint || 'not captured'),
      '',
      'Assessment: ' + a.label + ' (' + score + ')',
      a.text,
      ''
    ];
    /* C-042: include LOE floor-gate failures in the brief */
    var failed = failedLoeGates(state.metrics);
    if (failed.length) {
      lines.push('## CRITICAL — LOE Floor Gate Failures', '');
      lines.push('The following NDS lines of effort are below minimum acceptable thresholds:');
      failed.forEach(function (g) {
        lines.push('- ' + g.label + ': ' + (state.metrics[g.metric] || 0) + ' (floor ' + g.floor + ')');
      });
      lines.push('');
      lines.push('These failures must be addressed before the campaign can achieve its objectives.');
      lines.push('');
    }
    lines.push('## Metrics', '');
    Object.keys(METRICS).forEach(function (k) {
      var gateFlag = LOE_FLOOR_GATES.some(function (g) { return g.metric === k && (state.metrics[k] || 0) < g.floor; });
      lines.push('- ' + METRICS[k].label + ': ' + state.metrics[k] + (gateFlag ? ' [BELOW FLOOR]' : ''));
    });
    var phaseLines = state.results.length
      ? state.results.reduce(function (rows, r, i) {
        return rows.concat([
          (i + 1) + '. ' + r.phase + ' - score ' + r.score,
          '   Actions: ' + r.actions.join(', ')
        ], r.notes.length ? ['   Notes: ' + r.notes.join(' ')] : []);
      }, [])
      : ['- No phases resolved yet.'];
    lines.push('', '## Phase Results', '');
    lines.push.apply(lines, phaseLines);
    lines.push('', '## NDS Alignment', '');
    NDS_LOES.forEach(function (loe) {
      var gateFlag = LOE_FLOOR_GATES.some(function (g) { return g.metric === loe.metric && (state.metrics[loe.metric] || 0) < g.floor; });
      lines.push('- ' + loe.label + ': ' + METRICS[loe.metric].label + ' ' + state.metrics[loe.metric] + (gateFlag ? ' [BELOW FLOOR]' : ''));
    });
    downloadText('strikesim-campaign-brief.md', lines.join('\n'));
  }

  function downloadText(name, text) {
    var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
  }

  function launchWarGameFromPosture() {
    if (!state || !window.GameModule) {
      note('Campaign Planner: War Game module is not available.');
      return;
    }

    /* C-011: warn if the active graph differs from the one used to build this campaign */
    if (state.scenarioFingerprint && state.scenarioFingerprint !== 'none') {
      var currentFp = scenarioFingerprint();
      if (currentFp !== 'none' && currentFp !== state.scenarioFingerprint) {
        toast('Warning: active scenario graph differs from the one this campaign was built against. ' +
          'Launching anyway — War Game board may not reflect campaign metrics.', 'warn');
        note('Campaign Planner: fingerprint mismatch at War Game launch (saved ' +
          state.scenarioFingerprint + ', current ' + currentFp + ').');
      }
    }

    var m = state.metrics;

    /* C-012: Derive campaign-posture offsets but do NOT pass them as fixed apBlue/apRed.
     * Passing explicit apBlue/apRed to GameModule.newMatch() disables dynamic AP entirely
     * for that side (apFixed flag → dynamicAp = false), killing the command-tempo economy.
     * Instead, embed the campaign-derived base values as advisory fields (campaignPostureAp*)
     * that game.js ignores for AP accounting but that we log for the operator.
     * Dynamic AP is only bypassed when sandboxAp:true is explicitly requested. */
    var sandboxAp = !!(state.sandboxAp);
    var postureApBlue = clamp(Math.round(3 + (m.readiness + m.sustainment + m.initiative) / 90), 3, 6);
    var postureApRed  = clamp(Math.round(5 + (m.exposure - m.denial) / 45), 3, 6);

    var cfg = {
      control: { blue: 'human', red: 'ai' },
      difficulty: { blue: 'hard', red: 'hard' },
      fog: true,
      turnLimit: clamp(Math.round(6 + m.sustainment / 25), 6, 10),
      seed: Math.max(1, campaignScore(m) * 1009 + state.results.length * 37),
      /* Advisory fields — carried into match config but not consumed by AP accounting */
      campaignPostureApBlue: postureApBlue,
      campaignPostureApRed:  postureApRed
    };

    if (sandboxAp) {
      /* Explicit sandbox mode: fix AP exactly as the campaign specifies, disabling tempo */
      cfg.apBlue = postureApBlue;
      cfg.apRed  = postureApRed;
      note('Campaign Planner: sandbox AP mode — dynamic tempo disabled. Blue AP ' +
        postureApBlue + ', Red AP ' + postureApRed + '.');
    } else {
      note('Campaign Planner: dynamic AP mode — campaign posture advisory Blue ~' +
        postureApBlue + ', Red ~' + postureApRed + '; actual AP derived from live board tempo.');
    }

    window.GameModule.newMatch(cfg);
    note('War Game started from campaign posture, turn limit ' + cfg.turnLimit + '.');
    close();
    var wgLaunch = document.getElementById('wg-launch');
    if (wgLaunch && !wgLaunch.classList.contains('wg-hidden')) wgLaunch.click();
  }

  function onClick(ev) {
    /* persistence buttons */
    var p = ev.target.closest('[data-persist-save],[data-persist-load],[data-persist-reset],[data-persist-exportjson]');
    if (p) {
      if (p.hasAttribute('data-persist-save'))       { saveCampaign(); return; }
      if (p.hasAttribute('data-persist-load'))       { loadCampaign(); return; }
      if (p.hasAttribute('data-persist-reset'))      { resetCampaign(); return; }
      if (p.hasAttribute('data-persist-exportjson')) { exportCampaign(); return; }
    }
    var t = ev.target.closest('[data-campaign],[data-start],[data-action],[data-resolve],[data-reset],[data-export],[data-wargame]');
    if (!t) return;
    var action = ['campaign', 'start', 'action', 'resolve', 'reset', 'export', 'wargame']
      .find(function (name) { return t.hasAttribute('data-' + name); });
    if (!action) return;
    ({
      campaign: function () { selectedCampaignId = t.getAttribute('data-campaign'); scheduleAutosave(); render(); },
      start: startCampaign,
      action: function () { toggleAction(t.getAttribute('data-action')); },
      resolve: resolvePhase,
      reset: function () { state = null; scheduleAutosave(); render(); },
      export: exportBrief,
      wargame: launchWarGameFromPosture
    })[action]();
  }

  function onChange(ev) {
    if (!ev.target) return;
    if (ev.target.hasAttribute('data-lens')) {
      selectedLensId = ev.target.value;
      scheduleAutosave();
      render();
      return;
    }
    if (ev.target.hasAttribute('data-persist-import')) {
      var file = ev.target.files && ev.target.files[0];
      if (file) importCampaign(file);
      ev.target.value = '';
    }
  }

  function note(text) {
    try {
      if (typeof addEvent === 'function') addEvent({ type: 'Campaign', text: text });
    } catch (e) {}
  }

  function boot() {
    restoreOnInit();
    injectCss();
    build();
  }

  window.CampaignModule = {
    start: startCampaign,
    getState: function () { return state; },
    score: function () { return state ? campaignScore(state.metrics) : null; },
    /* persistence public API */
    saveCampaign: saveCampaign,
    loadCampaign: loadCampaign,
    resetCampaign: resetCampaign,
    exportCampaign: exportCampaign,
    importCampaign: importCampaign,
    _internal: {
      graphSignal: graphSignal,
      campaignScore: campaignScore,
      assessment: assessment
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
