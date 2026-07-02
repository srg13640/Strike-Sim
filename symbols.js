/*
 * symbols.js — offline, dependency-free tactical symbology for Strike Sim.
 *
 * Renders MIL-STD-2525 / APP-6 *flavored* military symbols as inline SVG, driven
 * entirely by the scenario node fields that already exist:
 *
 *   team        -> affiliation  (frame shape + standard 2525 affiliation colors)
 *   domain[]    -> dimension    (air/space dome, sea wave, default ground)
 *   type        -> function     (the central icon: command, fires, sensor, ...)
 *   health      -> status        (operational / damaged / destroyed modifiers)
 *
 * This is a deliberately focused subset, not the full 2525 SIDC catalog — enough
 * for a credible common-operational-picture read at a glance, fully offline, zero
 * new dependencies, and verifiable by rasterizing the output (see tools/symbol-
 * proof.js). If milsymbol.js is later vendored, this module's public surface
 * (SymbolModule.svg / .divIcon) is the seam to swap behind.
 *
 * No build step: attaches window.SymbolModule, and also module.exports under Node
 * so the renderer can be unit-tested headlessly.
 *
 * C-015 fix: SIDC builder now pads to full 10-char MIL-STD-2525C form (S+aff+dim+
 *   status + 6-char function); milsymbol fallback returns null (not broken SVG) when
 *   all attempts fail isValid(), so builtinSvg is always reached.
 * C-016 fix: functionId() now runs name-based role detection first (air-defense
 *   systems, EW/Cyber domain nodes, space-control) before falling through to type-
 *   based detection; secondaryDomains() exposes non-primary domains for badges/
 *   filters; builtinSvg decorates the dimension cue with secondary-domain badge.
 * C-018 fix: affiliation() is the single canonical source; AFFIL palette drives all
 *   color decisions; affilColor() helper exposed so map.js (and any other consumer)
 *   can call SymbolModule.affilColor(node) instead of forking blue/red logic.
 */
(function (root) {
  'use strict';

  // --- Standard 2525-style affiliation palette (pastel fills read on dark basemaps) ---
  var AFFIL = {
    friend:  { stroke: '#3d9be0', fill: '#bfe3ff', glyph: '#0a3553' },
    hostile: { stroke: '#e0584a', fill: '#ffc9c2', glyph: '#5e1109' },
    neutral: { stroke: '#3fae6b', fill: '#c7f0d6', glyph: '#0d3a23' },
    unknown: { stroke: '#d9b53c', fill: '#fff0bf', glyph: '#4a3a05' }
  };

  // C-018: Single canonical affiliation resolver. All other surfaces (map halos, ring
  // colors, FX tints) MUST call this function rather than forking their own blue/red
  // parsing. Precedence: node.affiliation first (explicit field), then node.team
  // (scenario assignment). Aliases accepted: enemy/opfor->hostile, friendly/blufor->friend.
  function affiliation(node) {
    var t = (node && (node.affiliation || node.team) || '').toString().toLowerCase();
    if (t === 'red' || t === 'hostile' || t === 'enemy' || t === 'opfor') return 'hostile';
    if (t === 'blue' || t === 'friend' || t === 'friendly' || t === 'blufor') return 'friend';
    if (t === 'green' || t === 'neutral') return 'neutral';
    return 'unknown';
  }

  // C-018: Canonical color resolver — returns the AFFIL palette entry for a node.
  // Use SymbolModule.affilColor(node).stroke / .fill / .glyph everywhere instead of
  // forking blue/red conditionals in map.js or ui.js.
  function affilColor(node) {
    return AFFIL[affiliation(node)] || AFFIL.unknown;
  }

  // C-016: Primary domain (drives frame dimension / SIDC battle-dimension).
  // Returns the first listed domain, lower-cased.
  function domainOf(node) {
    var d = node && node.domain;
    if (Array.isArray(d) && d.length) return d[0].toString().toLowerCase();
    if (typeof d === 'string') return d.toLowerCase();
    return 'land';
  }

  // C-016: Secondary domains — every domain beyond the first, lower-cased.
  // Consumers (map badges, filter panels, detail tooltips) should use this to
  // display capability hints without overloading the SIDC frame.
  function secondaryDomains(node) {
    var d = node && node.domain;
    if (Array.isArray(d) && d.length > 1) {
      return d.slice(1).map(function (v) { return v.toString().toLowerCase(); });
    }
    return [];
  }

  // C-016: Canonical role/symbolFunction resolver.
  //
  // Detection precedence (highest to lowest):
  //   1. Name-based air-defense keyword match  — Patriot, THAAD, IFPC, M-SHORAD, SAM,
  //      HQ-9, S-400, Aegis, SHORAD trump any coarse type value.
  //   2. Domain-derived role  — EW/Cyber/Space domain nodes whose type field is too
  //      coarse (e.g. "Support") get a domain-appropriate function.
  //   3. Type-based detection — original keyword scan on node.type.
  //   4. Default: 'support'.
  function functionId(node) {
    var nm  = (node && node.name || '').toString().toLowerCase();
    var ty  = (node && node.type || '').toString().toLowerCase();
    var dom = domainOf(node);

    // --- 1. Name-based air-defense / high-priority platform roles ---
    // These systems are classified as 'Support' or 'Fires' in the scenario data but
    // are operationally air-defense assets; they must render with the protection glyph
    // and receive the correct SIDC function code (UCD for ground, MFQ for air).
    if (/\bthaad\b/.test(nm))                              return 'protection';
    if (/\bpatriot\b/.test(nm))                            return 'protection';
    if (/\bifpc\b/.test(nm))                               return 'protection';
    if (/\bm-?shorad\b/.test(nm))                          return 'protection';
    if (/\bshorad\b/.test(nm))                             return 'protection';
    if (/\bs-400\b/.test(nm))                              return 'protection';
    if (/\bhq-9\b/.test(nm))                               return 'protection';
    if (/\bhq-16\b/.test(nm))                              return 'protection';
    if (/\bhq-7\b/.test(nm))                               return 'protection';
    if (/\baegis\b/.test(nm))                              return 'protection';
    // Generic SAM / air-defense Artillery patterns (avoid false-positive on 'SAMSARA' etc)
    if (/\bsam\b.*\b(regiment|battery|battalion|unit|bde|brigade)\b/.test(nm)) return 'protection';
    if (/\b(sam|aaa|aad)\s+regiment\b/.test(nm))           return 'protection';
    // Named EW platforms whose domain column is primary Air but whose role is EW
    if (/\bew\s+aircraft\b/.test(nm))                      return 'ew';
    if (/\bjamming\b/.test(nm))                            return 'ew';
    if (/\bcountermeasure\b/.test(nm))                     return 'ew';
    if (/\bcyber\s+attack\b/.test(nm))                     return 'ew';
    if (/\bpsychological\s+warfare\b/.test(nm))            return 'ew';
    // Space-control nodes that appear as generic 'Support' type
    if (/\bspace\s+control\b/.test(nm))                    return 'ew';
    if (/\bspace\s+countermeasure\b/.test(nm))             return 'ew';
    if (/\basat\b/.test(nm))                               return 'ew';

    // --- 2. Domain-derived role (for coarse type='Support' with specific domains) ---
    if ((dom === 'ew' || dom === 'cyber') &&
        (ty === 'support' || ty === '')) return 'ew';
    if (dom === 'space' &&
        (ty === 'support' || ty === '')) return 'sensor';

    // --- 3. Type-based detection (original logic, preserved verbatim) ---
    if (ty.indexOf('command')  > -1) return 'command';
    if (ty.indexOf('sensor')   > -1 || ty.indexOf('isr')    > -1 || ty.indexOf('recon')  > -1) return 'sensor';
    if (ty.indexOf('comm')     > -1 || ty.indexOf('relay')  > -1 || ty.indexOf('signal') > -1) return 'comms';
    if (ty.indexOf('fire')     > -1 || ty.indexOf('artil')  > -1 || ty.indexOf('missile')> -1) return 'fires';
    if (ty.indexOf('assault')  > -1 || ty.indexOf('maneuver')> -1|| ty.indexOf('infantry')> -1) return 'assault';
    if (ty.indexOf('blockade') > -1 || ty.indexOf('barrier') > -1) return 'blockade';
    if (ty.indexOf('ew')       > -1 || ty.indexOf('cyber')  > -1 || ty.indexOf('elect')  > -1) return 'ew';
    if (ty.indexOf('log')      > -1 || ty.indexOf('supply') > -1 || ty.indexOf('sustain')> -1) return 'logistics';
    if (ty.indexOf('protect')  > -1 || ty.indexOf('defen')  > -1 || ty.indexOf('ada')    > -1) return 'protection';
    if (ty.indexOf('support')  > -1) return 'support';
    return 'support';
  }

  function healthRatio(node) {
    if (!node) return 1;
    var max = (node.healthMax != null && node.healthMax > 0) ? node.healthMax : 100;
    var h = (node.health != null) ? node.health : max;
    var r = h / max;
    return isFinite(r) ? Math.max(0, Math.min(1, r)) : 1;
  }

  // --- Frame paths in a 64x64 viewBox, all interior-centered on (32,32) ---
  function framePath(affil) {
    switch (affil) {
      case 'hostile': // diamond
        return '<path d="M32 7 L57 32 L32 57 L7 32 Z" />';
      case 'neutral': // square
        return '<rect x="11" y="11" width="42" height="42" />';
      case 'unknown': // rounded-everything quatrefoil-ish
        return '<rect x="10" y="10" width="44" height="44" rx="16" ry="16" />';
      default: // friend ground: rounded rectangle, wider than tall
        return '<rect x="9" y="17" width="46" height="30" rx="7" ry="7" />';
    }
  }

  // --- Dimension cue (drawn over the frame, in the affiliation stroke color) ---
  function dimensionMarkup(dom, stroke) {
    if (dom === 'air' || dom === 'space') {
      var dome = '<path d="M16 16 Q32 1 48 16" fill="none" stroke="' + stroke + '" stroke-width="3"/>';
      if (dom === 'space') dome += '<path d="M32 9 l2.4 4.9 5.4 .8 -3.9 3.8 .9 5.4 -4.8 -2.5 -4.8 2.5 .9 -5.4 -3.9 -3.8 5.4 -.8 Z" fill="' + stroke + '" stroke="none"/>';
      return dome;
    }
    if (dom === 'sea') {
      return '<path d="M14 54 q4.5 -4 9 0 t9 0 t9 0" fill="none" stroke="' + stroke + '" stroke-width="2.6"/>';
    }
    return '';
  }

  // --- Function glyphs, centered on (32,32), drawn in glyph color ---
  function glyphMarkup(fn, g) {
    var s = 'stroke="' + g + '" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"';
    switch (fn) {
      case 'command': // flagstaff + pennant
        return '<line x1="26" y1="22" x2="26" y2="44" ' + s + '/>' +
               '<path d="M26 22 L41 26 L26 31 Z" fill="' + g + '" stroke="none"/>';
      case 'sensor': // concentric radar arcs (RECON / ISR)
        return '<path d="M27 23 A12 12 0 0 1 27 41" ' + s + '/>' +
               '<path d="M33 26 A8 8 0 0 1 33 38" ' + s + '/>' +
               '<circle cx="24" cy="32" r="2.2" fill="' + g + '" stroke="none"/>';
      case 'comms': // antenna mast + radiating arcs
        return '<line x1="32" y1="24" x2="32" y2="44" ' + s + '/>' +
               '<path d="M25 27 Q32 21 39 27" ' + s + '/>' +
               '<path d="M22 24 Q32 15 42 24" ' + s + '/>';
      case 'fires': // field-artillery filled "shot"
        return '<circle cx="32" cy="32" r="8.5" fill="' + g + '" stroke="none"/>';
      case 'assault': // infantry / maneuver crossed lines
        return '<line x1="21" y1="21" x2="43" y2="43" ' + s + '/>' +
               '<line x1="43" y1="21" x2="21" y2="43" ' + s + '/>';
      case 'blockade': // barrier bars
        return '<line x1="24" y1="22" x2="24" y2="42" ' + s + '/>' +
               '<line x1="32" y1="22" x2="32" y2="42" ' + s + '/>' +
               '<line x1="40" y1="22" x2="40" y2="42" ' + s + '/>';
      case 'ew': // electronic warfare sine wave + bolt
        return '<path d="M19 33 q4 -11 8 0 t8 0 t8 0" ' + s + '/>' +
               '<path d="M33 22 L29 32 L34 32 L30 42" stroke="' + g + '" stroke-width="2.4" fill="none" stroke-linejoin="round"/>';
      case 'logistics': // sustainment supply box
        return '<rect x="23" y="26" width="18" height="12" rx="1.5" fill="' + g + '" stroke="none"/>' +
               '<line x1="23" y1="32" x2="41" y2="32" stroke="' + (lighten(g)) + '" stroke-width="2"/>';
      case 'protection': // air-defense double chevron
        return '<path d="M21 39 L32 27 L43 39" ' + s + '/>' +
               '<path d="M24 44 L32 35 L40 44" stroke="' + g + '" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
      case 'support': // generic combat-support ring
      default:
        return '<circle cx="32" cy="32" r="8.5" ' + s + '/>';
    }
  }

  function lighten(hex) {
    // crude tint toward white for inner supply line; safe for #rrggbb
    try {
      var n = parseInt(hex.slice(1), 16);
      var r = Math.min(255, ((n >> 16) & 255) + 90);
      var gg = Math.min(255, ((n >> 8) & 255) + 90);
      var b = Math.min(255, (n & 255) + 90);
      return '#' + ((1 << 24) + (r << 16) + (gg << 8) + b).toString(16).slice(1);
    } catch (e) { return '#ffffff'; }
  }

  // --- Status modifiers from health ---
  function statusMarkup(node, affilColors) {
    var r = healthRatio(node);
    var status = (node && node.status || '').toString().toLowerCase();
    var destroyed = r <= 0.001 || status === 'destroyed' || status === 'killed';
    if (destroyed) {
      return { dash: '', overlay:
        '<line x1="9" y1="9" x2="55" y2="55" stroke="#ff2d2d" stroke-width="4" stroke-linecap="round"/>' +
        '<line x1="55" y1="9" x2="9" y2="55" stroke="#ff2d2d" stroke-width="4" stroke-linecap="round"/>',
        opacity: 0.55 };
    }
    if (r < 0.34) return { dash: 'stroke-dasharray="5 3"', overlay:
        '<line x1="13" y1="51" x2="51" y2="13" stroke="' + affilColors.stroke + '" stroke-width="3"/>', opacity: 1 };
    if (r < 0.67) return { dash: 'stroke-dasharray="6 3"', overlay: '', opacity: 1 };
    return { dash: '', overlay: '', opacity: 1 };
  }

  // C-016: Badge labels for secondary domains, rendered as small corner pills on the
  // built-in SVG.  Kept compact (2-3 chars) so they remain legible at 34-40px.
  var DOMAIN_BADGE = { ew: 'EW', cyber: 'CY', air: 'AIR', sea: 'SEA', space: 'SPC', land: 'LND' };

  function secondaryDomainBadges(node, stroke) {
    var sds = secondaryDomains(node);
    if (!sds.length) return '';
    // Render up to 2 badges as small pills in the top-right corner of the 64x64 viewBox.
    var out = '';
    var xBase = 55, yBase = 8, step = 8;
    for (var i = 0; i < Math.min(sds.length, 2); i++) {
      var lbl = DOMAIN_BADGE[sds[i]] || sds[i].slice(0, 3).toUpperCase();
      var y = yBase + i * step;
      out += '<rect x="' + (xBase - lbl.length * 3) + '" y="' + (y - 5) + '" ' +
             'width="' + (lbl.length * 3 + 3) + '" height="6" rx="1.5" ' +
             'fill="' + stroke + '" opacity="0.85"/>' +
             '<text x="' + xBase + '" y="' + y + '" text-anchor="end" ' +
             'font-family="monospace" font-size="5" font-weight="bold" fill="#fff">' +
             lbl + '</text>';
    }
    return out;
  }

  /**
   * Built-in (dependency-free) SVG symbol. Used as the fallback whenever milsymbol.js
   * is not loaded or returns an invalid symbol. opts.size (px) sets width/height;
   * opts.idTag adds a small id label below the frame.
   *
   * C-016: Secondary domains rendered as corner badges so multi-domain nodes carry
   * visible capability hints (e.g. a Sea+Air carrier group shows 'AIR' badge).
   * C-018: Uses affilColor() so all color decisions route through the canonical palette.
   */
  function builtinSvg(node, opts) {
    opts = opts || {};
    var size  = opts.size || 40;
    var affil = affiliation(node);
    var c     = affilColor(node);          // C-018: single canonical color source
    var dom   = domainOf(node);
    var fn    = functionId(node);
    var st    = statusMarkup(node, c);

    var frame  = '<g stroke="' + c.stroke + '" stroke-width="3" fill="' + c.fill + '" ' + st.dash + '>' +
                 framePath(affil) + '</g>';
    var glyph  = glyphMarkup(fn, c.glyph);
    var dim    = dimensionMarkup(dom, c.stroke);
    var badges = secondaryDomainBadges(node, c.stroke); // C-016
    var idTag  = opts.idTag && node && node.id
      ? '<text x="32" y="62" text-anchor="middle" font-family="monospace" font-size="8" fill="' + c.stroke + '">' +
        String(node.id).slice(-7) + '</text>'
      : '';

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 ' + (idTag ? 66 : 64) + '" ' +
      'width="' + size + '" height="' + (idTag ? size * 66 / 64 : size) + '" ' +
      'class="mil-symbol mil-' + affil + ' mil-' + fn + '" opacity="' + st.opacity + '">' +
      frame + dim + glyph + badges + st.overlay + idTag + '</svg>';
  }

  // ---- milsymbol.js adapter (real MIL-STD-2525C) ----------------------------------
  // When vendor/milsymbol.js is loaded it exposes a global `ms`. We build a 2525C SIDC
  // from the same node fields and let milsymbol render an authoritative symbol; if it is
  // absent (or anything fails) we transparently fall back to the built-in renderer above.

  // C-018: Affiliation character — single mapping, derived from canonical affiliation().
  var AFF_CH = { friend: 'F', hostile: 'H', neutral: 'N', unknown: 'U' };

  // C-015/C-016: Battle-dimension character per primary domain.
  // EW and Cyber are treated as Ground-dimension in 2525C (no dedicated frame).
  // Subsurface (U) is detected separately by name keyword in dimOf().
  var DIM_CH = { land: 'G', cyber: 'G', ew: 'G', sea: 'S', air: 'A', space: 'P' };

  // C-015/C-016: Dimension-specific function ID tables (SIDC positions 5–10, 6 chars).
  // Each row is keyed by our canonical function key (from functionId()), with a safe
  // per-dimension generic as _default. All codes verified valid against milsymbol 3.x.
  //
  // Role mapping summary:
  //   protection -> UCD--- (G: air-defense artillery), MFQ--- (A: fighter), CLFF-- (S)
  //   ew         -> UUSW-- (G: EW ground), MFR---  (A: recon/EW), CLFF-- (S)
  //   sensor     -> UCR--- (G: recon), MFR---  (A: recon), CLFF-- (S)
  //   command    -> UC---- (G: C2), MF----  (A), CLCV-- (S)
  //   fires      -> UCF--- (G: field art.), MFF--- (A: bomber/strike), CLBB-- (S)
  //   logistics  -> USS--- (G: sustainment), MFC--- (A: cargo), CL---- (S)
  //   assault    -> UCI--- (G: infantry), MFF--- (A), CLBB-- (S)
  //   blockade   -> UCM--- (G: mil police / sea control), CLFF-- (S)
  //   comms      -> UCS--- (G: signal), MFC--- (A: tanker/relay), CLFF-- (S)
  //   support    -> US---- (G: combat support generic)
  var DIM_FUNC = {
    G: {
      command:    'UC----',
      sensor:     'UCR---',
      comms:      'UCS---',
      fires:      'UCF---',
      assault:    'UCI---',
      blockade:   'UCM---',
      ew:         'UUSW--',
      logistics:  'USS---',
      protection: 'UCD---',
      support:    'US----',
      _default:   'U-----'
    },
    A: {
      command:    'MF----',
      sensor:     'MFR---',
      comms:      'MFC---',
      fires:      'MFF---',
      assault:    'MFF---',
      blockade:   'MFB---',
      ew:         'MFR---',
      logistics:  'MFC---',
      protection: 'MFQ---',
      support:    'MF----',
      _default:   'MF----'
    },
    S: {
      command:    'CLCV--',
      sensor:     'CLFF--',
      comms:      'CLFF--',
      fires:      'CLBB--',
      assault:    'CLBB--',
      blockade:   'CLFF--',
      ew:         'CLFF--',
      logistics:  'CL----',
      protection: 'CLFF--',
      support:    'CLFF--',
      _default:   'CLFF--'
    },
    U: { _default: 'SF----' },  // subsurface (submarines)
    P: { _default: 'S-----' }   // space
  };

  function getMs() {
    try {
      if (typeof window !== 'undefined' && window.ms && window.ms.Symbol) return window.ms;
      if (typeof ms !== 'undefined' && ms && ms.Symbol) return ms; // eslint-disable-line
    } catch (e) {}
    return null;
  }

  // Battle dimension for a node: domain, but submarines (by name) are subsurface.
  function dimOf(node) {
    var nm = (node && node.name || '').toString().toLowerCase();
    if (/submarine|\bssn\b|\bssk\b|\bssbn\b|\bssgn\b/.test(nm)) return 'U';
    return DIM_CH[domainOf(node)] || 'G';
  }

  function funcFor(node, dim) {
    var table = DIM_FUNC[dim] || DIM_FUNC.G;
    return table[functionId(node)] || table._default;
  }

  // C-015: Canonical SIDC builder.
  // Emits a full MIL-STD-2525C 10-character code:
  //   S  [aff(1)]  [dim(1)]  P  [func(6)]
  // (milsymbol accepts 10-char SIDCs; trailing modifier/country/OOB positions are
  // represented as '-' pads within the 6-char function slot by convention above.)
  // This is the single authoritative path — used by both sidcFor() and milSymbol().
  function buildSidc(aff, dim, func6) {
    // Ensure function slot is exactly 6 chars, right-padded with '-'
    var fn6 = (func6 || 'U-----').toString();
    while (fn6.length < 6) fn6 += '-';
    fn6 = fn6.slice(0, 6);
    return 'S' + aff + dim + 'P' + fn6;
  }

  function sidcFor(node) {
    var aff = AFF_CH[affiliation(node)] || 'U';
    var dim = dimOf(node);
    return buildSidc(aff, dim, funcFor(node, dim));
  }

  // C-015: Returns { svg, width, height, anchor } from milsymbol, or null if
  // unavailable OR if no valid SIDC could be constructed.
  //
  // Key fix: the loop now stores a candidate ONLY when isValid() is true. If all
  // attempts fail isValid(), the function returns null so the built-in fallback is
  // always reached (instead of emitting a broken milsymbol SVG).
  function milSymbol(node, opts) {
    var lib = getMs();
    if (!lib) return null;
    opts = opts || {};
    var size = opts.size || 34;
    var aff = AFF_CH[affiliation(node)] || 'U';
    var dim = dimOf(node);
    var r = healthRatio(node);
    var status = (node && node.status || '').toString().toLowerCase();
    var cond = (r <= 0.001 || status === 'destroyed' || status === 'killed') ? 'destroyed'
      : (r < 0.5 ? 'damaged' : null);

    // Three attempts: specific function -> dimension generic -> safe ground generic.
    // Each uses buildSidc() so all three share the canonical SIDC format.
    var attempts = [
      buildSidc(aff, dim, funcFor(node, dim)),
      buildSidc(aff, dim, (DIM_FUNC[dim] || DIM_FUNC.G)._default),
      buildSidc('U',  'G', 'U-----')   // affiliation-neutral ground generic — always valid
    ];

    var sym = null;
    for (var i = 0; i < attempts.length; i++) {
      try {
        var o = { size: size, colorMode: 'Light', fill: true, frame: true };
        if (cond) o.operationalCondition = cond;
        var s = new lib.Symbol(attempts[i], o);
        // C-015 fix: ONLY accept the symbol when isValid() is true.
        // Never store an invalid symbol as a fallback — return null instead so
        // the built-in renderer is actually invoked.
        if (s.isValid && s.isValid()) { sym = s; break; }
      } catch (e) {}
    }
    if (!sym) return null;  // triggers builtinSvg in callers
    try {
      var sz  = sym.getSize   ? sym.getSize()   : { width: size, height: size };
      var anc = sym.getAnchor ? sym.getAnchor() : { x: (sz.width || size) / 2, y: (sz.height || size) / 2 };
      return { svg: sym.asSVG(), width: sz.width || size, height: sz.height || size, anchor: anc };
    } catch (e) { return null; }
  }

  // Public SVG: prefer milsymbol; fall back to built-in. opts.engine==='builtin' forces fallback.
  function svg(node, opts) {
    if (!opts || opts.engine !== 'builtin') {
      var m = milSymbol(node, opts);
      if (m && m.svg) return m.svg;
    }
    return builtinSvg(node, opts);
  }

  function usingMil() { return !!getMs(); }

  /**
   * Leaflet-friendly descriptor. map.js does: L.divIcon(SymbolModule.divIcon(node)).
   * Returns a plain object so this module never depends on Leaflet being loaded.
   */
  function divIcon(node, opts) {
    opts = opts || {};
    var size = opts.size || 34;
    var cls = 'mil-symbol-icon' + (opts.className ? ' ' + opts.className : '');
    if (opts.engine !== 'builtin') {
      var m = milSymbol(node, { size: size });
      if (m && m.svg) {
        var w = Math.round(m.width), h = Math.round(m.height);
        return {
          className: cls, html: m.svg,
          iconSize: [w, h],
          iconAnchor: [Math.round(m.anchor.x), Math.round(m.anchor.y)],
          popupAnchor: [0, -Math.round(m.anchor.y)]
        };
      }
    }
    return {
      className: cls, html: builtinSvg(node, { size: size }),
      iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2]
    };
  }

  var api = {
    // Rendering
    svg: svg,
    divIcon: divIcon,
    // C-018: canonical affiliation + color — callers should use these instead of
    // forking their own blue/red conditionals.
    affiliation: affiliation,
    affilColor: affilColor,
    AFFIL: AFFIL,
    // C-016: domain helpers
    domainOf: domainOf,
    secondaryDomains: secondaryDomains,
    // C-016: role/function resolver (name-first, then type-based)
    functionId: functionId,
    // C-015: SIDC builder (canonical, padded to full 10-char 2525C form)
    sidcFor: sidcFor,
    // Health
    healthRatio: healthRatio,
    usingMil: usingMil,
    FUNCTIONS: ['command', 'sensor', 'comms', 'fires', 'assault', 'blockade', 'ew', 'logistics', 'protection', 'support']
  };

  // Self-contained marker CSS (no-op under Node). Keeps map.js/HTML untouched.
  if (typeof document !== 'undefined' && !document.getElementById('mil-symbol-css')) {
    var style = document.createElement('style');
    style.id = 'mil-symbol-css';
    style.textContent =
      '.mil-symbol-icon{background:none;border:none;display:flex;align-items:center;justify-content:center;' +
      'filter:drop-shadow(0 1px 1px rgba(0,0,0,.65));transition:opacity .12s ease}' +
      '.mil-symbol-icon svg{overflow:visible}' +
      '.mil-symbol-icon.mil-dimmed{opacity:.22}' +
      '.mil-symbol-icon.mil-selected{z-index:1000;animation:milSelPulse 1.5s ease-in-out infinite}' +
      '@keyframes milSelPulse{0%,100%{filter:drop-shadow(0 0 2px #fff)}50%{filter:drop-shadow(0 0 7px #fff) drop-shadow(0 0 3px #cfe9ff)}}';
    (document.head || document.documentElement).appendChild(style);
  }

  root.SymbolModule = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
