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

  function affiliation(node) {
    var t = (node && (node.affiliation || node.team) || '').toString().toLowerCase();
    if (t === 'red' || t === 'hostile' || t === 'enemy' || t === 'opfor') return 'hostile';
    if (t === 'blue' || t === 'friend' || t === 'friendly' || t === 'blufor') return 'friend';
    if (t === 'green' || t === 'neutral') return 'neutral';
    return 'unknown';
  }

  function domainOf(node) {
    var d = node && node.domain;
    if (Array.isArray(d) && d.length) return d[0].toString().toLowerCase();
    if (typeof d === 'string') return d.toLowerCase();
    return 'land';
  }

  // Normalize the scenario's free-text type into a function key.
  function functionId(node) {
    var ty = (node && node.type || '').toString().toLowerCase();
    if (ty.indexOf('command') > -1) return 'command';
    if (ty.indexOf('sensor') > -1 || ty.indexOf('isr') > -1 || ty.indexOf('recon') > -1) return 'sensor';
    if (ty.indexOf('comm') > -1 || ty.indexOf('relay') > -1 || ty.indexOf('signal') > -1) return 'comms';
    if (ty.indexOf('fire') > -1 || ty.indexOf('artil') > -1 || ty.indexOf('missile') > -1) return 'fires';
    if (ty.indexOf('assault') > -1 || ty.indexOf('maneuver') > -1 || ty.indexOf('infantry') > -1) return 'assault';
    if (ty.indexOf('blockade') > -1 || ty.indexOf('barrier') > -1) return 'blockade';
    if (ty.indexOf('ew') > -1 || ty.indexOf('cyber') > -1 || ty.indexOf('elect') > -1) return 'ew';
    if (ty.indexOf('log') > -1 || ty.indexOf('supply') > -1 || ty.indexOf('sustain') > -1) return 'logistics';
    if (ty.indexOf('protect') > -1 || ty.indexOf('defen') > -1 || ty.indexOf('ada') > -1) return 'protection';
    if (ty.indexOf('support') > -1) return 'support';
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

  /**
   * Built-in (dependency-free) SVG symbol. Used as the fallback whenever milsymbol.js
   * is not loaded. opts.size (px) sets width/height; opts.idTag adds a small id label.
   */
  function builtinSvg(node, opts) {
    opts = opts || {};
    var size = opts.size || 40;
    var affil = affiliation(node);
    var c = AFFIL[affil];
    var dom = domainOf(node);
    var fn = functionId(node);
    var st = statusMarkup(node, c);

    var frame = '<g stroke="' + c.stroke + '" stroke-width="3" fill="' + c.fill + '" ' + st.dash + '>' +
                framePath(affil) + '</g>';
    var glyph = glyphMarkup(fn, c.glyph);
    var dim = dimensionMarkup(dom, c.stroke);
    var idTag = opts.idTag && node && node.id
      ? '<text x="32" y="62" text-anchor="middle" font-family="monospace" font-size="8" fill="' + c.stroke + '">' +
        String(node.id).slice(-7) + '</text>'
      : '';

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 ' + (idTag ? 66 : 64) + '" ' +
      'width="' + size + '" height="' + (idTag ? size * 66 / 64 : size) + '" ' +
      'class="mil-symbol mil-' + affil + ' mil-' + fn + '" opacity="' + st.opacity + '">' +
      frame + dim + glyph + st.overlay + idTag + '</svg>';
  }

  // ---- milsymbol.js adapter (real MIL-STD-2525C) ----------------------------------
  // When vendor/milsymbol.js is loaded it exposes a global `ms`. We build a 2525C SIDC
  // from the same node fields and let milsymbol render an authoritative symbol; if it is
  // absent (or anything fails) we transparently fall back to the built-in renderer above.
  var AFF_CH = { friend: 'F', hostile: 'H', neutral: 'N', unknown: 'U' };
  var DIM_CH = { land: 'G', cyber: 'G', ew: 'G', sea: 'S', air: 'A', space: 'P' };
  // 2525C ground function IDs (positions 5–10) per normalized function key.
  var FN_2525 = {
    command: 'UC----', sensor: 'UCR---', comms: 'UCS---', fires: 'UCF---',
    assault: 'UCI---', blockade: 'UCN---', ew: 'UUSW--', logistics: 'USS---',
    protection: 'UCD---', support: 'US----'
  };

  function getMs() {
    try {
      if (typeof window !== 'undefined' && window.ms && window.ms.Symbol) return window.ms;
      if (typeof ms !== 'undefined' && ms && ms.Symbol) return ms; // eslint-disable-line
    } catch (e) {}
    return null;
  }

  function sidcFor(node) {
    var aff = AFF_CH[affiliation(node)] || 'U';
    var dim = DIM_CH[domainOf(node)] || 'G';
    var fn = FN_2525[functionId(node)] || 'U-----';
    return 'S' + aff + dim + 'P' + fn;
  }

  // Returns { svg, width, height, anchor } from milsymbol, or null if unavailable.
  function milSymbol(node, opts) {
    var lib = getMs();
    if (!lib) return null;
    opts = opts || {};
    var size = opts.size || 34;
    var aff = AFF_CH[affiliation(node)] || 'U';
    var fn = FN_2525[functionId(node)] || 'U-----';
    var r = healthRatio(node);
    var status = (node && node.status || '').toString().toLowerCase();
    var cond = (r <= 0.001 || status === 'destroyed' || status === 'killed') ? 'destroyed'
      : (r < 0.5 ? 'damaged' : null);
    // Try the domain's dimension first, then ground, then a generic function — always
    // landing on a valid, well-framed symbol (cross-dimension function IDs can be invalid).
    var attempts = [
      [DIM_CH[domainOf(node)] || 'G', fn],
      ['G', fn],
      ['G', 'U-----']
    ];
    var sym = null;
    for (var i = 0; i < attempts.length; i++) {
      var sidc = 'S' + aff + attempts[i][0] + 'P' + attempts[i][1];
      var o = { size: size, colorMode: 'Light', fill: true, frame: true };
      if (cond) o.operationalCondition = cond;
      try {
        var s = new lib.Symbol(sidc, o);
        if (s.isValid && s.isValid()) { sym = s; break; }
        if (!sym) sym = s;
      } catch (e) {}
    }
    if (!sym) return null;
    try {
      var sz = sym.getSize ? sym.getSize() : { width: size, height: size };
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
    svg: svg,
    divIcon: divIcon,
    affiliation: affiliation,
    domainOf: domainOf,
    functionId: functionId,
    healthRatio: healthRatio,
    sidcFor: sidcFor,
    usingMil: usingMil,
    AFFIL: AFFIL,
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
      '.mil-symbol-icon.mil-selected{filter:drop-shadow(0 0 5px #fff) drop-shadow(0 0 2px #fff);z-index:1000}';
    (document.head || document.documentElement).appendChild(style);
  }

  root.SymbolModule = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
