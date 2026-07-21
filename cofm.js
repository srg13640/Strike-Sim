/*
 * cofm.js — Correlation of Forces and Means engine  (window.CofmModule)   [CO-009]
 *
 * Implements a multi-domain COFM net assessment grounded in Soviet/Russian military
 * science (sootnosheniye sil i sredstv) as popularized for Western readers by Michael
 * Klare ("Understanding 'The Correlation of Forces'", TomDispatch, 2022-04-03), and in
 * the systems-confrontation framing of RAND RR-1708. Full formulation, input mapping,
 * and citations: docs/COFM_MODEL.md.
 *
 *   COFM_net = P_blue / P_red
 *   P_side   = ( Σ_d w_d · I_d ) × M_C2Integrity × M_LogiPosture
 *
 * Pure, read-only, deterministic, dependency-free, zero DOM. The format helpers return
 * HTML *strings* with every dynamic value escaped (director.js injects via innerHTML).
 * Consumes the same node schema as moe.js (team/type/subsystem/importance/cascScore/
 * health/healthMax/status/alive) plus the Blue dataset's jointFunction field.
 */
window.CofmModule = (function () {
  'use strict';

  // Domain weights (sum = 1.0) per CO-009 §2.
  var DOMAIN_WEIGHTS = { fires: 0.35, airsea: 0.25, c2info: 0.20, sustain: 0.20 };
  var DOMAIN_LABELS = {
    fires: 'Fires / Strike',
    airsea: 'Air & Sea Control',
    c2info: 'C2 & Information',
    sustain: 'Sustainment'
  };
  var DOMAIN_ORDER = ['fires', 'airsea', 'c2info', 'sustain'];

  // Qualitative multipliers per CO-009 §2 (exact forms pinned in review).
  var MULTIPLIERS = {
    c2Floor: 0.40, c2Span: 0.60, c2Exponent: 1.5,
    logistics: { surge: 1.06, balanced: 1.00, constrained: 0.94 }
  };
  var RED_POTENTIAL_FLOOR = 0.05;
  var NET_CAP = 9.99;

  // Classification tiers per CO-009 §2, evaluated on net rounded to 2 decimals;
  // ranges inclusive of their endpoints.
  var TIERS = [
    { key: 'heavy_red', label: 'HEAVY RED SUPERIORITY', color: '#ff4d5e', min: -Infinity, max: 0.69 },
    { key: 'red_advantage', label: 'RED ADVANTAGE', color: '#ff8c42', min: 0.70, max: 0.89 },
    { key: 'parity', label: 'CONTESTED PARITY', color: '#ffd166', min: 0.90, max: 1.10 },
    { key: 'blue_advantage', label: 'BLUE ADVANTAGE', color: '#63dcff', min: 1.11, max: 1.30 },
    { key: 'heavy_blue', label: 'HEAVY BLUE DOMINANCE', color: '#38ef7d', min: 1.31, max: Infinity }
  ];

  // Input mapping per CO-009 §2.5: jointFunction first (Blue dataset), then type
  // (Red dataset taxonomy, matching moe.js), then the subsystem field.
  var JOINT_FUNCTION_TO_DOMAIN = {
    'fires': 'fires',
    'protection': 'airsea',
    'command and control': 'c2info',
    'information': 'c2info',
    'intelligence and targeting': 'c2info',
    'sustainment': 'sustain'
  };
  var TYPE_TO_DOMAIN = {
    'Fires': 'fires',
    'Blockade': 'airsea', 'Protection': 'airsea', 'Assault': 'airsea',
    'Command': 'c2info', 'Comms': 'c2info', 'Relay': 'c2info', 'Sensor': 'c2info',
    'EW/Cyber': 'c2info', 'Information Capability': 'c2info',
    'Logistics': 'sustain'
  };
  var SUBSYS_TO_DOMAIN = {
    'Firepower Strike': 'fires',
    'Blockade': 'airsea', 'Assault': 'airsea',
    'Information Attack': 'c2info'
  };

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function round2(x) { return Math.round(x * 100) / 100; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function classifyDomain(node) {
    if (!node) return 'fires';
    var jf = node.jointFunction == null ? '' : String(node.jointFunction).trim().toLowerCase();
    if (jf && jf !== 'none' && JOINT_FUNCTION_TO_DOMAIN[jf]) return JOINT_FUNCTION_TO_DOMAIN[jf];
    if (node.type != null && TYPE_TO_DOMAIN[node.type]) return TYPE_TO_DOMAIN[node.type];
    if (node.subsystem != null && SUBSYS_TO_DOMAIN[node.subsystem]) return SUBSYS_TO_DOMAIN[node.subsystem];
    return 'fires';
  }

  function healthFraction(node) {
    if (!node) return 0;
    if (node.alive === false || node.status === 'Neutralized') return 0;
    var base = Number(node.healthMax || node.health || 100);
    if (!(base > 0)) return 0;
    var h = node.health == null ? base : Number(node.health);
    return clamp01(h / base);
  }

  function classifyTier(net) {
    var r = round2(net);
    for (var i = 0; i < TIERS.length; i++) {
      if (r >= TIERS[i].min && r <= TIERS[i].max) {
        return { key: TIERS[i].key, label: TIERS[i].label, color: TIERS[i].color };
      }
    }
    return { key: 'parity', label: 'CONTESTED PARITY', color: '#ffd166' };
  }

  function logisticsMultiplier(decision) {
    var key = decision == null ? '' : String(decision).trim().toLowerCase();
    return MULTIPLIERS.logistics[key] || 1.00;
  }

  function assessSide(nodes, team, logisticsDecision) {
    var base = {}, cur = {}, counts = {};
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n || n.team !== team) continue;
      var d = classifyDomain(n);
      var imp = n.importance == null ? 5 : Number(n.importance);
      var casc = n.cascScore == null ? 1 : Number(n.cascScore);
      // Cascade-aware node weight, identical to moe.js (RR-1708 systems-destruction).
      var w = imp * (1 + 0.5 * casc);
      var f = healthFraction(n);
      base[d] = (base[d] || 0) + w;
      cur[d] = (cur[d] || 0) + w * f;
      counts[d] = (counts[d] || 0) + 1;
    }

    // Domain indices over present domains; weights renormalized to those present
    // (same convention as moe.js OSVI) so both sides stay 0..1-commensurable.
    var domains = {}, presentWeight = 0, weighted = 0;
    DOMAIN_ORDER.forEach(function (d) {
      var present = (base[d] || 0) > 0;
      var index = present ? clamp01(cur[d] / base[d]) : null;
      domains[d] = {
        label: DOMAIN_LABELS[d],
        weight: DOMAIN_WEIGHTS[d],
        present: present,
        index: index,
        nodeCount: counts[d] || 0
      };
      if (present) { presentWeight += DOMAIN_WEIGHTS[d]; weighted += DOMAIN_WEIGHTS[d] * index; }
    });
    var material = presentWeight > 0 ? weighted / presentWeight : 0;
    DOMAIN_ORDER.forEach(function (d) {
      domains[d].weightNormalized = domains[d].present && presentWeight > 0
        ? DOMAIN_WEIGHTS[d] / presentWeight : 0;
    });

    var c2Index = domains.c2info.present ? domains.c2info.index : 1;
    var mC2 = MULTIPLIERS.c2Floor + MULTIPLIERS.c2Span * Math.pow(clamp01(c2Index), MULTIPLIERS.c2Exponent);
    var mLogi = logisticsMultiplier(logisticsDecision);

    return {
      material: material,
      mC2: mC2,
      mLogi: mLogi,
      logisticsDecision: logisticsDecision || null,
      potential: material * mC2 * mLogi,
      domains: domains,
      nodeCount: Object.keys(counts).reduce(function (sum, d) { return sum + counts[d]; }, 0)
    };
  }

  /**
   * assess(nodes, options)
   *   nodes:   array of scenario/board nodes (both teams, live health overlaid).
   *   options: { logistics: { blue: 'surge'|'balanced'|'constrained'|null, red: ... } }
   * Returns a deterministic report; no timestamps, no randomness.
   */
  function assess(nodes, options) {
    var list = Array.isArray(nodes) ? nodes : [];
    var logistics = (options && options.logistics) || {};
    var blue = assessSide(list, 'blue', logistics.blue);
    var red = assessSide(list, 'red', logistics.red);
    var redPotential = Math.max(red.potential, RED_POTENTIAL_FLOOR);
    var net = round2(Math.min(NET_CAP, blue.potential / redPotential));
    return {
      schemaVersion: 1,
      net: net,
      tier: classifyTier(net),
      sides: { blue: blue, red: red },
      inputs: { blueNodes: blue.nodeCount, redNodes: red.nodeCount },
      capped: blue.potential / redPotential > NET_CAP,
      floored: red.potential < RED_POTENTIAL_FLOOR
    };
  }

  function formatChip(report) {
    if (!report || !report.tier) return '';
    return '<span class="dir-cofm-chip" style="border-color:' + esc(report.tier.color) + ';color:' + esc(report.tier.color) + '">' +
      'COFM ' + esc(report.net.toFixed(2)) + ' · ' + esc(report.tier.label) + '</span>';
  }

  function sideRows(side) {
    return DOMAIN_ORDER.map(function (d) {
      var dom = side.domains[d];
      var value = dom.present ? Math.round(dom.index * 100) + '%' : '—';
      return '<div class="dir-cofm-row"><span>' + esc(dom.label) + '</span><b>' + esc(value) + '</b></div>';
    }).join('');
  }

  function formatCard(report) {
    if (!report || !report.tier) return '';
    var blue = report.sides.blue, red = report.sides.red;
    var quals = 'Qual multipliers — Blue C2 ' + esc(blue.mC2.toFixed(2)) + ' · logistics ' + esc(blue.mLogi.toFixed(2)) +
      ' | Red C2 ' + esc(red.mC2.toFixed(2)) + ' · logistics ' + esc(red.mLogi.toFixed(2));
    return '<div class="dir-cofm-card">' +
      '<div class="dir-cofm-head"><span>CORRELATION OF FORCES &amp; MEANS</span>' + formatChip(report) + '</div>' +
      '<div class="dir-cofm-grid">' +
        '<div class="dir-cofm-side"><h4>BLUE (' + esc(String(blue.nodeCount)) + ' nodes)</h4>' + sideRows(blue) + '</div>' +
        '<div class="dir-cofm-side"><h4>RED (' + esc(String(red.nodeCount)) + ' nodes)</h4>' + sideRows(red) + '</div>' +
      '</div>' +
      '<p class="dir-cofm-quals">' + quals + '</p>' +
      '<p class="dir-cofm-note">Composite of material capability and qualitative multipliers (sootnosheniye sil i sredstv). ' +
      'An ordering aid for decisions, not a prediction — see docs/COFM_MODEL.md.</p>' +
      '</div>';
  }

  return {
    assess: assess,
    classifyDomain: classifyDomain,
    classifyTier: classifyTier,
    healthFraction: healthFraction,
    formatChip: formatChip,
    formatCard: formatCard,
    DOMAIN_WEIGHTS: DOMAIN_WEIGHTS,
    DOMAIN_LABELS: DOMAIN_LABELS,
    MULTIPLIERS: MULTIPLIERS,
    TIERS: TIERS
  };
})();
