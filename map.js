/*
 * map.js — Leaflet 2D map rendering module for the MDSC 3D Network Visualizer.
 *
 * Second modularization step (after state.js). Owns everything Leaflet-specific:
 * the map instance, marker/link layers, the marker index, tile setup + offline
 * basemap detection, and popup control. The app-level map *mode* toggle and the
 * mode flags stay in the main script (orchestration); this module is pure rendering.
 *
 * Dependency injection (no build step, plain global script):
 *   - Shared functions it calls (selectNode, selectNodeById, addEvent, currentVisible,
 *     mapColorFromTeam, resolveCssVar) are top-level declarations in the main script,
 *     so they are already global and referenced directly.
 *   - The battlespace graph comes from window.AppState.activeGraph().
 *   - The few script-scoped values it reads (selected node, highlight state, map-mode
 *     flag) and the two tile constants are supplied via MapModule.init(context) with
 *     live getters, so the module always sees current state without owning it.
 *
 * The main script aliases the public methods onto their original global names
 * (window.refreshMapMarkers = MapModule.refreshMapMarkers, …) so existing call sites
 * keep working unchanged.
 */
window.MapModule = (function () {
  'use strict';

  // --- Module-owned map state ---
  let leafletMap = null;
  let markersLayer = null;
  let mapLinksLayer = null;
  let coastlineLayer = null;
  let rangeRingsLayer = null;   // notional weapon-engagement zones (toggleable overlay)
  const mapMarkers = new Map(); // id -> marker
  // Leaflet renders EPSG:3857. Keep a generated full-world Web Mercator Blue Marble
  // underneath the operational theater so panning never falls back to a dead grid, then
  // drape the PO-provided Indo-Pacific satellite image over a tight regional envelope.
  const WEB_MERCATOR_MAX_LAT = 85.05112878;
  const GLOBAL_SATELLITE_BOUNDS = [[-WEB_MERCATOR_MAX_LAT, -180], [WEB_MERCATOR_MAX_LAT, 180]];
  // A second copy of the world image, shifted +360° east, so imagery is continuous
  // across the antimeridian (180°…540°) — i.e. through the Pacific into the Americas.
  const GLOBAL_SATELLITE_BOUNDS_WRAP = [[-WEB_MERCATOR_MAX_LAT, 180], [WEB_MERCATOR_MAX_LAT, 540]];
  const GLOBAL_SATELLITE_BASEMAP = 'assets/earth-blue-marble-webmercator-2048.jpg';
  // Pacific-centered theater frame. This is an INDOPACOM tool, so the map is centered on
  // the dateline: Western-hemisphere longitudes (the Americas, Hawaii) are shifted +360°
  // so Asia → the Central Pacific → the US West Coast form ONE contiguous picture instead
  // of being torn to opposite edges of a Greenwich-centered world. pacLon() applies the
  // shift to every marker/line/view; PACIFIC_BOUNDS is the pannable envelope (East Africa
  // ~95°E across the Pacific to the US East Coast ~295° == -65°).
  const PAC_CUT = -25;
  function pacLon(lon) { return (lon != null && lon < PAC_CUT) ? lon + 360 : lon; }
  // West edge 60°E (Indian Ocean / Diego Garcia) → east edge 295° (== -65°, US East Coast).
  const PACIFIC_BOUNDS = [[-WEB_MERCATOR_MAX_LAT, 60], [WEB_MERCATOR_MAX_LAT, 295]];
  // The square source image covers mainland China through Japan, the Philippines,
  // Indonesia, and Papua New Guinea. These bounds intentionally hug visible coastlines
  // so force-network nodes sit on recognizable terrain instead of an abstract grid.
  const THEATER_SATELLITE_BOUNDS = [[-13.5, 57.5], [62.5, 173.5]];
  const THEATER_SATELLITE_BASEMAP = 'assets/earth-blue-marble-indopac-3072.jpg';
  let globalSatelliteLoaded = false;
  let theaterSatelliteLoaded = false;

  // --- Injected context (overridden by init); safe defaults so nothing throws ---
  let ctx = {
    getSelectedNode: () => null,
    getHighlightMode: () => null,
    getHighlightSet: () => new Set(),
    isMapMode: () => false,
    enableLocalTiles: false,
    tileBasePath: './tiles',
    blankTileDataUrl: ''
  };

  function init(context) {
    ctx = Object.assign({}, ctx, context || {});
  }

  // Active scenario's graph, via the state layer.
  function graph() {
    return (window.AppState && window.AppState.activeGraph()) || { nodes: [], links: [] };
  }

  function ensureMap() {
    if (leafletMap) return;
    let coastlinesLoaded = false;   // offline vector fallback (assets/land.geojson)
    let realTilesLoaded = false;    // raster tiles found under ./tiles/
    leafletMap = L.map('map', {
      zoomControl: true,
      worldCopyJump: false,            // no repeated worlds; we lock to a single globe
      attributionControl: true,
      maxBounds: PACIFIC_BOUNDS,       // Pacific-centered envelope (see PACIFIC_BOUNDS)
      maxBoundsViscosity: 1.0,         // hard wall — you cannot drag past the world imagery
      minZoom: 2,                      // refined to a real fit-to-viewport value once sized
      bounceAtZoomLimits: false
    });
    // Deep-ocean backdrop so any sub-pixel sliver reads as sea, never as a black void.
    try { leafletMap.getContainer().style.background = '#05101d'; } catch (e) {}
    leafletMap.on('click', () => selectNode(null));

    // Base layer: a blank grid drawn locally on a canvas — makes ZERO network requests,
    // so missing tiles can never flood the console with 404s. Real tiles, if present,
    // are overlaid on top after a quiet existence check (see the probe below).
    const BlankGrid = L.GridLayer.extend({
      createTile(coords) {
        const tile = document.createElement('canvas');
        const size = this.getTileSize();
        tile.width = size.x; tile.height = size.y;
        const c = tile.getContext('2d');
        c.fillStyle = '#020814';
        c.fillRect(0, 0, size.x, size.y);
        c.strokeStyle = '#10202b';
        c.lineWidth = 1;
        c.strokeRect(0.5, 0.5, size.x - 1, size.y - 1);
        return tile;
      }
    });
    new BlankGrid({ minZoom: 0, maxZoom: 8, tileSize: 256, noWrap: true }).addTo(leafletMap);

    // Dedicated pane for the vector basemap, BELOW the markers/overlay pane (z 400) and
    // above the tiles (z 200). Without this the land — loaded async — lands in the same
    // SVG as the circle markers and, being added later, paints over them.
    leafletMap.createPane('basemapPane');
    leafletMap.getPane('basemapPane').style.zIndex = 250;
    leafletMap.getPane('basemapPane').style.pointerEvents = 'none';

    // Pane for weapon-engagement zones — above the basemap, below the unit symbols.
    leafletMap.createPane('ringsPane');
    leafletMap.getPane('ringsPane').style.zIndex = 350;
    leafletMap.getPane('ringsPane').style.pointerEvents = 'none';
    rangeRingsLayer = L.layerGroup().addTo(leafletMap);

    // Pane for radar-sweep FX element — above basemap, below engagement rings.
    leafletMap.createPane('radarPane');
    leafletMap.getPane('radarPane').style.zIndex = 310;
    leafletMap.getPane('radarPane').style.pointerEvents = 'none';

    // FX pane for strike tracers / impacts — drawn over everything for the brief flash.
    leafletMap.createPane('fxPane');
    leafletMap.getPane('fxPane').style.zIndex = 640;
    leafletMap.getPane('fxPane').style.pointerEvents = 'none';
    injectHudCss(); // unified design-system CSS (includes former injectFxCss content)
    injectFxCss();  // no-op shim; kept for call-site compatibility
    // ensureRadarSweep(); // disabled per user feedback — full-map radar sweep removed (top-left tactical scope kept). Re-enable by uncommenting.

    // Basemap status helper: keep one status signal even as layers come online asynchronously.
    const setBasemapStatus = (text, state) => {
      const el = document.querySelector('.basemap-status');
      if (!el) return;
      el.textContent = text;
      if (state) el.setAttribute('data-state', state); else el.removeAttribute('data-state');
    };
    const refreshBasemapStatus = () => {
      if (realTilesLoaded) {
        setBasemapStatus(theaterSatelliteLoaded ? 'Basemap: local tiles + theater satellite' : 'Basemap: local tiles', 'ok');
      } else if (theaterSatelliteLoaded) {
        setBasemapStatus('Basemap: theater satellite', 'ok');
      } else if (globalSatelliteLoaded) {
        setBasemapStatus('Basemap: global satellite', 'ok');
      } else if (coastlinesLoaded) {
        setBasemapStatus('Basemap: coastlines (offline)', 'ok');
      } else {
        setBasemapStatus('Basemap: offline grid', 'offline');
      }
    };
    const shouldShowCoastlineFallback = () => coastlinesLoaded && !realTilesLoaded && !globalSatelliteLoaded && !theaterSatelliteLoaded;
    const refreshCoastlineFallback = () => {
      if (!coastlineLayer || !leafletMap) return;
      const visible = shouldShowCoastlineFallback();
      const hasLayer = leafletMap.hasLayer(coastlineLayer);
      if (visible && !hasLayer) coastlineLayer.addTo(leafletMap);
      if (!visible && hasLayer) leafletMap.removeLayer(coastlineLayer);
    };

    // ---- Basemaps ----------------------------------------------------------------
    // C-002 (P1): OFFLINE-FIRST. The map boots into the blank canvas grid (already
    // added above) — ZERO network requests at startup. Online basemaps (CARTO dark,
    // Esri satellite) are available as explicit opt-in layer toggles only; they are
    // NOT added to the map at init time. The offline bundled imagery (Blue Marble) is
    // the default "rich" fallback when the user wants a real photo basemap without going
    // online. The basemap-status badge clearly shows "offline grid" until the user
    // deliberately enables an online layer.
    //
    // C-019 (P1): Every online tile layer (darkLayer, satImagery, satLabels) gets the
    // same tile-error fallback handler so a failed online selection always recovers to
    // the offline layer, never leaves a blank map.

    // Online-capable layers (constructed but NOT added to map at startup)
    const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd', maxZoom: 19, crossOrigin: true, keepBuffer: 4,
      attribution: '© OpenStreetMap contributors, © CARTO'
    });
    const satImagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, crossOrigin: true, keepBuffer: 4,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics'
    });
    const satLabels = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd', maxZoom: 19, crossOrigin: true, opacity: 0.85
    });
    const satLayer = L.layerGroup([satImagery, satLabels]);
    // Offline bundled imagery (two copies so the dateline stays covered).
    const offlineLayer = L.layerGroup([
      L.imageOverlay(GLOBAL_SATELLITE_BASEMAP, GLOBAL_SATELLITE_BOUNDS, { pane: 'basemapPane', interactive: false, className: 'global-satellite-overlay' }),
      L.imageOverlay(GLOBAL_SATELLITE_BASEMAP, GLOBAL_SATELLITE_BOUNDS_WRAP, { pane: 'basemapPane', interactive: false, className: 'global-satellite-overlay' })
    ]);

    // C-019: shared tile-error fallback for ALL online layers.
    // Counts errors across dark+sat layers; trips after 4 cumulative failures,
    // removes whichever online layers are active, and activates the offline layer.
    let onlineTileErrors = 0, fellBack = false;
    const fallBackToOffline = () => {
      if (fellBack || !leafletMap) return;
      fellBack = true;
      if (leafletMap.hasLayer(darkLayer)) leafletMap.removeLayer(darkLayer);
      if (leafletMap.hasLayer(satImagery)) leafletMap.removeLayer(satImagery);
      if (leafletMap.hasLayer(satLabels)) leafletMap.removeLayer(satLabels);
      if (leafletMap.hasLayer(satLayer)) leafletMap.removeLayer(satLayer);
      offlineLayer.addTo(leafletMap);
      globalSatelliteLoaded = true;
      refreshCoastlineFallback();
      setBasemapStatus('Basemap: offline imagery (online failed)', 'offline');
    };
    const onTileError = () => { if (++onlineTileErrors >= 4) fallBackToOffline(); };
    // Attach to every online tile layer (C-019)
    darkLayer.on('tileerror', onTileError);
    satImagery.on('tileerror', onTileError);
    satLabels.on('tileerror', onTileError);

    // C-002: The layers control lists online basemaps as opt-in choices.
    // The map starts on the blank offline grid (no entry selected in base layers).
    // We add offlineLayer as the default "rich offline" base so users have a
    // photographic option without any network request.
    offlineLayer.addTo(leafletMap);
    globalSatelliteLoaded = true;
    setBasemapStatus('Basemap: offline imagery', 'ok');

    L.control.layers(
      {
        'Offline imagery (default)': offlineLayer,
        'Dark — online opt-in': darkLayer,
        'Satellite — online opt-in': satLayer
      },
      { 'Engagement zones (notional)': rangeRingsLayer },
      { position: 'topright', collapsed: true }
    ).addTo(leafletMap);

    // Update the badge when the user explicitly switches basemaps.
    // Flag online layers clearly so the operator knows a network request will fire.
    leafletMap.on('baselayerchange', (e) => {
      const isOnline = e.name.indexOf('online') !== -1;
      if (isOnline) {
        // Reset fallback counter when the user intentionally opts into an online layer
        onlineTileErrors = 0;
        fellBack = false;
      }
      setBasemapStatus(
        'Basemap: ' + e.name.replace(' — online opt-in', ' (ONLINE)').replace(' (default)', ''),
        isOnline ? 'ok' : 'ok'
      );
    });

    // Map overlays: scale + compass
    L.control.scale({ position: 'bottomright', metric: true, imperial: false }).addTo(leafletMap);
    const CompassControl = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div', 'leaflet-control compass-control');
        div.innerHTML = `<div class="compass-arrow">↑</div><div class="compass-label">N</div>`;
        L.DomEvent.disableClickPropagation(div);
        return div;
      }
    });
    new CompassControl({ position: 'topright' }).addTo(leafletMap);

    // Symbology legend — lets a viewer decode the COP cold. Only shown when the
    // tactical-symbol renderer is present; collapsible to stay out of the way.
    if (symbolsEnabled()) {
      const Sym = window.SymbolModule;
      const sample = (team, type, dom) => Sym.svg(
        { team, type, domain: [dom || 'Land'], health: 100, healthMax: 100 }, { size: 26 });
      const affRow = [['blue', 'Friend'], ['red', 'Hostile'], ['green', 'Neutral'], ['unk', 'Unknown']]
        .map(([t, label]) => `<div class="mil-leg-item">${sample(t, 'Support')}<span>${label}</span></div>`).join('');
      const fnRow = [['Command', 'Cmd'], ['Fires', 'Fires'], ['Sensor', 'ISR'], ['Comms', 'Comms'],
        ['Assault', 'Maneuver'], ['Protection', 'Air Def'], ['EW/Cyber', 'EW/Cyber'], ['Logistics', 'Sustain']]
        .map(([ty, label]) => `<div class="mil-leg-item">${sample('blue', ty)}<span>${label}</span></div>`).join('');
      const LegendControl = L.Control.extend({
        onAdd() {
          const div = L.DomUtil.create('div', 'leaflet-control mil-legend');
          div.innerHTML =
            `<div class="mil-leg-head"><strong>SYMBOLOGY</strong><button type="button" class="mil-leg-toggle" aria-expanded="true" title="Show/hide legend">–</button></div>` +
            `<div class="mil-leg-body"><div class="mil-leg-sub">Affiliation (frame)</div><div class="mil-leg-grid">${affRow}</div>` +
            `<div class="mil-leg-sub">Function (glyph)</div><div class="mil-leg-grid">${fnRow}</div>` +
            `<div class="mil-leg-note">Air = dome · Sea = wave · dashed/✕ = degraded/destroyed</div>` +
            `<div class="mil-leg-note">Rings (notional): solid = fires reach · dashed = air defense · dotted = sensor</div></div>`;
          L.DomEvent.disableClickPropagation(div);
          const btn = div.querySelector('.mil-leg-toggle');
          const body = div.querySelector('.mil-leg-body');
          btn.addEventListener('click', () => {
            const open = body.style.display !== 'none';
            body.style.display = open ? 'none' : 'block';
            btn.textContent = open ? '+' : '–';
            btn.setAttribute('aria-expanded', String(!open));
          });
          return div;
        }
      });
      new LegendControl({ position: 'topleft' }).addTo(leafletMap);
      if (typeof document !== 'undefined' && !document.getElementById('mil-legend-css')) {
        const st = document.createElement('style');
        st.id = 'mil-legend-css';
        st.textContent =
          '.mil-legend{background:rgba(8,18,28,.92);border:1px solid #1d3343;border-radius:6px;padding:6px 8px;' +
          'color:#cfe6f5;font:11px/1.3 system-ui,Segoe UI,Arial;max-width:170px;box-shadow:0 2px 10px rgba(0,0,0,.5)}' +
          '.mil-leg-head{display:flex;align-items:center;justify-content:space-between;gap:6px;letter-spacing:.06em;color:#9ec6dd}' +
          '.mil-leg-toggle{background:none;border:none;color:#9ec6dd;font-size:15px;line-height:1;cursor:pointer;padding:0 2px}' +
          '.mil-leg-sub{margin:6px 0 3px;color:#7fa6bf;font-size:9.5px;text-transform:uppercase;letter-spacing:.05em}' +
          '.mil-leg-grid{display:grid;grid-template-columns:1fr 1fr;gap:2px 6px}' +
          '.mil-leg-item{display:flex;align-items:center;gap:4px}.mil-leg-item svg{flex:0 0 auto}' +
          '.mil-leg-item span{font-size:10px;color:#cfe6f5}' +
          '.mil-leg-note{margin-top:6px;color:#6f93a8;font-size:9px}';
        (document.head || document.documentElement).appendChild(st);
      }
    }

    // Persistent basemap status badge + offline-aware tile auto-detection.
    const BasemapStatusControl = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div', 'leaflet-control basemap-status');
        div.setAttribute('role', 'status');
        div.setAttribute('aria-live', 'polite');
        div.textContent = 'Basemap: checking…';
        L.DomEvent.disableClickPropagation(div);
        return div;
      }
    });
    new BasemapStatusControl({ position: 'bottomleft' }).addTo(leafletMap);
    // C-002: badge reflects the offline-first default (not any online layer).
    setBasemapStatus('Basemap: offline imagery', 'ok');

    // Quietly check whether real local tiles exist (root z/x/y). A `fetch` HEAD to a
    // missing file returns ok:false WITHOUT logging a console error (unlike an <img>
    // probe), so a tile-less checkout stays console-clean. If tiles are present, overlay
    // them on the blank grid; otherwise keep the grid and say so plainly. Relative path,
    // so it stays within OFFLINE_MODE; any failure (e.g. file://) degrades to offline.
    const enableRealTiles = () => {
      realTilesLoaded = true;
      refreshCoastlineFallback();
      L.tileLayer(`${ctx.tileBasePath}/{z}/{x}/{y}.png`, {
        minZoom: 0, maxZoom: 5, tileSize: 256, attribution: 'Local tiles', noWrap: true
      }).addTo(leafletMap);
      refreshBasemapStatus();
    };
    // If no raster tiles, the offline coastline basemap is still shown, so only fall back
    // to the bare-grid message when even that hasn't loaded.
    const noTiles = () => { if (!globalSatelliteLoaded) refreshBasemapStatus(); };
    if (ctx.enableLocalTiles && ctx.tileBasePath) {
      try {
        fetch(`${ctx.tileBasePath}/0/0/0.png`, { method: 'HEAD', cache: 'no-cache' })
          .then(r => { if (r && r.ok) enableRealTiles(); else noTiles(); })
          .catch(noTiles);
      } catch (err) {
        noTiles();
      }
    } else {
      noTiles();
    }

    markersLayer = L.layerGroup().addTo(leafletMap);
    mapLinksLayer = L.layerGroup().addTo(leafletMap);
    setTimeout(() => {
      leafletMap.invalidateSize();
      clampMinZoom();
      fitMapToMarkers();
      _wireMapVisibilityObserver(); // C-020: auto-replay queued strikes on map show
    }, 50);
  }

  // Set the minimum zoom to exactly the level at which the world imagery fills the
  // viewport — so you can never zoom out into empty space. Recomputed on every resize
  // because the right zoom depends on the container's pixel size.
  function clampMinZoom() {
    if (!leafletMap) return;
    try {
      // inside=true -> the smallest zoom at which the view fits *inside* the world bounds.
      const fit = leafletMap.getBoundsZoom(PACIFIC_BOUNDS, true);
      const minZ = Math.ceil(fit * 100) / 100; // tiny epsilon so edges never peek through
      leafletMap.setMinZoom(minZ);
      if (leafletMap.getZoom() < minZ) leafletMap.setZoom(minZ);
    } catch (e) { /* keep the static minZoom fallback */ }
  }

  // Are MIL-STD-2525-style symbols available + enabled? Falls back to dots otherwise.
  function symbolsEnabled() {
    return ctx.useMilSymbols !== false && typeof window !== 'undefined' && window.SymbolModule;
  }

  // Build a per-node lat/lon offset that spreads markers sharing (near-)identical coordinates
  // into a small golden-angle spiral so none are fully hidden. Returns Map<id,[dLat,dLon]>.
  function computeDeclutter(nodes) {
    const groups = {};
    nodes.forEach(n => {
      if (n.lat == null || n.lon == null) return;
      const key = (Math.round(n.lat * 8) / 8) + ',' + (Math.round(pacLon(n.lon) * 8) / 8); // ~0.125° cells
      (groups[key] = groups[key] || []).push(n);
    });
    const out = new Map();
    Object.keys(groups).forEach(k => {
      const arr = groups[k];
      if (arr.length <= 1) return;
      arr.sort((a, b) => (Number(b.importance) || 0) - (Number(a.importance) || 0));
      arr.forEach((n, i) => {
        if (i === 0) { out.set(n.id, [0, 0]); return; }  // most-important keeps the true spot
        const ang = i * 2.39996323, rad = 0.085 * Math.sqrt(i + 0.5); // ~0.1–0.35° spiral
        out.set(n.id, [Math.sin(ang) * rad, Math.cos(ang) * rad]);
      });
    });
    return out;
  }

  // Map is the Operation loop's default PLAN surface, so its popup must carry enough
  // context to support a decision without forcing the operator back to the 3D view.
  // Keep the first layer compact; provenance and assumptions sit behind <details>.
  function escapePopupHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function safeHttpUrl(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!/^https?:\/\//i.test(raw)) return '';
    try {
      const parsed = new URL(raw);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
    } catch (e) {
      return '';
    }
  }

  function capacityValue(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.round(n * 10) / 10);
  }

  function capacityFor(node) {
    const r = node && node.resourceGenByType && typeof node.resourceGenByType === 'object'
      ? node.resourceGenByType : {};
    return {
      kinetic: capacityValue(r.kinetic),
      cyber: capacityValue(r.cyber),
      ew: capacityValue(r.ew != null ? r.ew : (r.jam != null ? r.jam : r.jamming)),
      sof: capacityValue(r.sof)
    };
  }

  function capacityLine(resources) {
    return 'Kinetic ' + capacityValue(resources && resources.kinetic) +
      ' · Cyber ' + capacityValue(resources && resources.cyber) +
      ' · EW ' + capacityValue(resources && resources.ew) +
      ' · SOF ' + capacityValue(resources && resources.sof);
  }

  function capabilityPopupHtml(node, graphOverride) {
    const n = node || {};
    const g = graphOverride || graph();
    const profile = n.capabilityProfile && typeof n.capabilityProfile === 'object'
      ? n.capabilityProfile : null;
    const active = capacityFor(n);
    const potential = profile && profile.potentialResourceGenByType &&
      typeof profile.potentialResourceGenByType === 'object'
      ? profile.potentialResourceGenByType : null;
    const team = String(n.team || n.affiliation || 'unknown').replace(/_/g, ' ');
    const type = n.type || 'Unspecified type';
    const subsystem = n.subsystem || 'Unspecified subsystem';

    const refs = profile && Array.isArray(profile.sourceRefs)
      ? profile.sourceRefs : (Array.isArray(n.sourceRefs) ? n.sourceRefs : []);
    const sourceById = new Map((Array.isArray(g.sources) ? g.sources : [])
      .filter(source => source && source.id != null)
      .map(source => [String(source.id), source]));
    const sourceItems = refs.map(ref => {
      const id = String(ref);
      const source = sourceById.get(id);
      if (!source) return '<span>' + escapePopupHtml(id) + '</span>';
      const url = safeHttpUrl(source.url);
      const title = source.title || source.publisher || id;
      const suffix = [source.publisher, source.year].filter(Boolean).join(' · ');
      const label = escapePopupHtml(title) + (suffix ? '<small>' + escapePopupHtml(suffix) + '</small>' : '');
      return url
        ? '<a href="' + escapePopupHtml(url) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>'
        : '<span>' + label + '</span>';
    }).join('');

    let details = '';
    if (profile || sourceItems) {
      const evidence = profile
        ? [profile.evidenceClass || 'not stated', profile.confidence ? profile.confidence + ' confidence' : 'confidence not stated'].join(' · ')
        : 'not stated';
      const functions = profile && Array.isArray(profile.functions) ? profile.functions.join(', ') : '';
      details = '<details class="map-cap-details"><summary>Capability profile</summary>' +
        '<div class="map-cap-detail-body">' +
        (potential ? '<div class="map-cap-row"><span>Conditional capacity</span><b>' + escapePopupHtml(capacityLine(potential)) + '</b></div>' : '') +
        '<div class="map-cap-row"><span>Evidence</span><b>' + escapePopupHtml(evidence) + '</b></div>' +
        '<div class="map-cap-row"><span>Availability</span><b>' + escapePopupHtml(profile && profile.availability || 'not stated') + '</b></div>' +
        (profile && profile.category ? '<div class="map-cap-row"><span>Role</span><b>' + escapePopupHtml(profile.category) + '</b></div>' : '') +
        (functions ? '<div class="map-cap-row"><span>Functions</span><b>' + escapePopupHtml(functions) + '</b></div>' : '') +
        (profile && profile.assumption ? '<div class="map-cap-assumption"><span>Assumption</span>' + escapePopupHtml(profile.assumption) + '</div>' : '') +
        (sourceItems ? '<div class="map-cap-sources"><span>Public sources</span>' + sourceItems + '</div>' : '') +
        '</div></details>';
    }

    return '<div class="map-cap-popup">' +
      '<strong class="map-cap-name">' + escapePopupHtml(n.name || 'Unnamed node') + '</strong>' +
      '<span class="map-cap-id">' + escapePopupHtml(n.id || 'No ID') + '</span>' +
      '<div class="map-cap-meta">' + escapePopupHtml(team) + ' · ' + escapePopupHtml(type) + ' · ' + escapePopupHtml(subsystem) + '</div>' +
      '<div class="map-cap-active"><span>Active capacity</span>' + escapePopupHtml(capacityLine(active)) + '</div>' +
      details + '</div>';
  }

  function refreshMapMarkers() {
    if (!leafletMap || !markersLayer) return;
    markersLayer.clearLayers();
    mapMarkers.clear();

    const { visibleNodes } = currentVisible();
    const useSym = symbolsEnabled();

    // Declutter: nodes sharing near-identical coordinates (the data has stacks at Okinawa,
    // Tokyo, the Taiwan Strait, etc.) are spread in a small golden-angle spiral so each unit
    // stays individually visible/clickable. The highest-importance unit keeps the true spot.
    const offsetById = computeDeclutter(visibleNodes);

    visibleNodes.forEach(n => {
      if (n.lat == null || n.lon == null) return;
      const off = offsetById.get(n.id) || [0, 0];
      const mlat = n.lat + off[0], mlon = pacLon(n.lon) + off[1];
      const hasOffset = off[0] !== 0 || off[1] !== 0;

      let marker;
      if (useSym) {
        // Tactical symbol marker (symbols.js). Importance gently scales size so the
        // high-payoff nodes read first, without breaking the affiliation/function coding.
        const imp = Math.max(0, Math.min(12, Number(n.importance) || 4));
        // milsymbol renders ~1.4x the size value, so keep the base modest to avoid a
        // pile-up of oversized symbols in dense clusters; importance gives a gentle range.
        const size = Math.round(17 + imp * 0.9);
        let icon;
        try {
          icon = L.divIcon(window.SymbolModule.divIcon(n, { size }));
        } catch (e) { icon = null; }
        if (icon) {
          marker = L.marker([mlat, mlon], { icon, riseOnHover: true, keyboard: false })
            .addTo(markersLayer)
            .on('click', () => selectNodeById(n.id));
          // High-importance units sit above the clutter so they're never hidden.
          try { marker.setZIndexOffset(Math.round(imp * 40)); } catch (e) {}
          // Blip halo: team-coloured sonar ring. CSS var drives border color.
          if (marker._icon) {
            const blipColor = _affiliationColor(n);
            const blipDelay = ((Math.abs(n.id.charCodeAt(0) || 0) % 16) / 16 * 2.4).toFixed(2);
            marker._icon.classList.add('mil-blip');
            if (imp >= 8) marker._icon.classList.add('mil-hi');
            marker._icon.style.setProperty('--blip-color', blipColor);
            marker._icon.style.setProperty('--blip-delay', blipDelay + 's');
          }
        }
      }
      if (!marker) {
        // Fallback: original colored circle marker.
        const col = mapColorFromTeam(n);
        marker = L.circleMarker([mlat, mlon], {
          radius: 6, color: col, fillColor: col, fillOpacity: 0.9, weight: 1.5
        }).addTo(markersLayer).on('click', () => selectNodeById(n.id));
      }

      // C-017 (P1/P2): When a marker has been offset from its true position by the
      // declutter spiral, draw a thin leader line back to the true coordinate so the
      // operator can see where the unit actually is. The line is non-interactive and
      // very faint to avoid cluttering the COP. Only drawn for genuinely offset markers.
      if (hasOffset) {
        try {
          L.polyline([[n.lat, pacLon(n.lon)], [mlat, mlon]], {
            color: _affiliationColor(n),
            weight: 0.8,
            opacity: 0.35,
            interactive: false,
            dashArray: '3 4'
          }).addTo(markersLayer);
          // Small true-position dot so the anchor point is unambiguous.
          L.circleMarker([n.lat, pacLon(n.lon)], {
            radius: 2,
            color: _affiliationColor(n),
            fillColor: _affiliationColor(n),
            fillOpacity: 0.55,
            weight: 0,
            interactive: false
          }).addTo(markersLayer);
        } catch (e) { /* non-fatal */ }
      }

      marker.__node = n;
      marker.bindPopup(capabilityPopupHtml(n), { maxWidth: 380 });
      mapMarkers.set(n.id, marker);
    });

    refreshRangeRings(offsetById);
    refreshObjectiveMarkers(offsetById);
    highlightSelectedOnMap();
  }

  // Return the canonical affiliation color for a node (CSS hex string).
  function _affiliationColor(n) {
    const t = String(n.team || n.affiliation || '').toLowerCase();
    if (t === 'blue' || t === 'friend') return '#38bdf8';
    if (t === 'red'  || t === 'hostile') return '#ff4d5e';
    if (t === 'green'|| t === 'neutral') return '#51cf66';
    return '#ffd43b'; // unknown
  }

  // --- Objective markers (C-044) ---------------------------------------------------
  // C-044 (P2): Objective markers now respect active visibility filters — only nodes
  // that are in currentVisible().visibleNodes receive a badge. They also use the same
  // display coordinate (true lat/lon + declutter offset) as their unit marker, so the
  // badge sits on top of the symbol rather than floating at a diverging position.
  // The offsetById map is passed in from refreshMapMarkers so the two calls share one
  // computed declutter table; when called stand-alone (e.g. on game state change) it
  // recomputes the table from the current visible set.
  let objectiveMarkersLayer = null;
  function refreshObjectiveMarkers(offsetById) {
    if (!leafletMap) return;
    // Lazy-create the layer (above rings, below unit markers)
    if (!objectiveMarkersLayer) {
      objectiveMarkersLayer = L.layerGroup().addTo(leafletMap);
    }
    objectiveMarkersLayer.clearLayers();

    // Resolve objective IDs from the active game state (defensive — may not exist).
    let objIds = null;
    try {
      const gs = window.GameModule && typeof window.GameModule.getState === 'function'
        ? window.GameModule.getState() : null;
      if (gs && gs.objectiveIds) {
        // Merge both sides into a map: id -> side
        const blueIds = Array.isArray(gs.objectiveIds.blue) ? gs.objectiveIds.blue : [];
        const redIds  = Array.isArray(gs.objectiveIds.red)  ? gs.objectiveIds.red  : [];
        objIds = new Map();
        blueIds.forEach(id => objIds.set(id, 'blue'));
        redIds.forEach(id  => objIds.set(id, 'red'));
      }
    } catch (e) { objIds = null; }

    if (!objIds || objIds.size === 0) return; // no active game / no objectives

    // C-044: use currentVisible() to respect active filters; build ID set for O(1) lookup.
    const { visibleNodes } = currentVisible();
    const visibleIdSet = new Set(visibleNodes.map(n => n.id));

    // If no offsetById was passed in (standalone call), recompute from visible nodes.
    if (!offsetById) offsetById = computeDeclutter(visibleNodes);

    visibleNodes.forEach(n => {
      if (!objIds.has(n.id)) return;
      if (!visibleIdSet.has(n.id)) return; // already guaranteed by visibleNodes, but be explicit
      if (n.lat == null || n.lon == null) return;
      const side = objIds.get(n.id); // 'blue' or 'red'
      const isHostile = side === 'red';

      // C-044: place badge at the same display coordinate as the unit marker.
      const off = offsetById.get(n.id) || [0, 0];
      const mlat = n.lat + off[0], mlon = pacLon(n.lon) + off[1];

      const icon = L.divIcon({
        className: '',
        html: `<div class="map-obj-marker${isHostile ? ' obj-hostile' : ''}" title="KEY OBJ: ${n.name}">★</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });
      L.marker([mlat, mlon], { icon, interactive: false, keyboard: false, zIndexOffset: -10 })
        .addTo(objectiveMarkersLayer);
    });
  }

  // --- Weapon-engagement zones (notional) ------------------------------------------
  // Range rings around key fires / air-defense / sensor nodes — the overlay that makes a
  // map read as an operational planning picture. Radii are NOTIONAL, derived from node
  // type + importance (clearly labeled in the legend/layer name), not real weapon data.
  function engagementZone(n) {
    const ty = String(n.type || '').toLowerCase();
    const sub = String(n.subsystem || '').toLowerCase();
    const imp = Math.max(1, Math.min(12, Number(n.importance) || 4));
    if (ty.includes('fire') || /firepower|strike|missile|artil/.test(sub)) {
      return { km: 260 + imp * 145, kind: 'fires' };          // offensive strike reach
    }
    if (ty.includes('protect') || ty.includes('defen') || /air ?defen|sam|ada/.test(sub)) {
      return { km: 120 + imp * 26, kind: 'airdef' };          // missile-engagement zone
    }
    if (ty.includes('sensor') || ty.includes('isr') || ty.includes('radar')) {
      return { km: 220 + imp * 38, kind: 'sensor' };          // detection coverage
    }
    return null;
  }

  // Per-kind / per-affiliation styling using canonical design-system palette.
  // Hostile fires → alert-red; Blue fires → amber; air-def → cyan; sensors → accent cyan.
  function ringStyle(kind, team) {
    const red = team === 'red';
    // Fires: hostile=alert, friend=amber; air-def: cyan tinted by side; sensor: pure accent.
    if (kind === 'fires') {
      const c = red ? '#ff3b3b' : '#ffb000'; // --alert vs --amber
      return { color: c, weight: 1.6, fillColor: c, fillOpacity: 0, dashArray: null,
               opacity: 0.75 };
    }
    if (kind === 'airdef') {
      // Hostile SAM rings slightly warmer cyan; blue AD rings cool cyan.
      const c = red ? 'rgba(255,77,94,0.72)' : 'rgba(0,216,255,0.65)';
      const fill = red ? 'rgba(255,77,94,1)' : 'rgba(0,216,255,1)';
      return { color: c, weight: 1.4, fillColor: fill, fillOpacity: 0.04, dashArray: '6 5',
               opacity: 0.8 };
    }
    // Sensor: faint accent cyan outline + near-invisible fill
    const c = red ? 'rgba(255,77,94,0.45)' : 'rgba(0,216,255,0.45)';
    return { color: c, weight: 1.1, fillColor: c, fillOpacity: 0.02, dashArray: '2 6',
             opacity: 0.7 };
  }

  const MAX_RINGS = 22;   // show the biggest threat/defense envelopes only — readable, not noisy
  // C-017 (P1/P2): rings are drawn at the TRUE coordinate (n.lat/n.lon), not the
  // decluttered display position. This keeps geometry truthful — a ring centered at the
  // true coordinate is correct even when its symbol is offset. A thin leader line is
  // drawn separately in refreshMapMarkers for offset symbols so the user can see the
  // connection between the displayed icon and its true ground position.
  function refreshRangeRings(offsetById) {
    if (!rangeRingsLayer) return;
    rangeRingsLayer.clearLayers();
    const { visibleNodes } = currentVisible();
    const candidates = [];
    visibleNodes.forEach(n => {
      if (n.lat == null || n.lon == null) return;
      const imp = Number(n.importance) || 0;
      if (imp < 6) return;
      const z = engagementZone(n);
      if (z) candidates.push({ n, z, imp });
    });
    // Keep the highest-importance systems so the overlay reads as the key engagement
    // envelopes rather than a wall of overlapping circles.
    candidates.sort((a, b) => b.imp - a.imp);
    candidates.slice(0, MAX_RINGS).forEach(({ n, z }) => {
      const st = ringStyle(z.kind, n.team);
      // Rings always anchor to true coordinate so geometry is tactically truthful.
      L.circle([n.lat, pacLon(n.lon)], {
        pane: 'ringsPane', interactive: false, radius: z.km * 1000,
        color: st.color, weight: st.weight, opacity: st.opacity !== undefined ? st.opacity : 0.9,
        fillColor: st.fillColor, fillOpacity: st.fillOpacity,
        dashArray: st.dashArray
      }).addTo(rangeRingsLayer);
    });
  }

  // Apply current highlight/selection state to a single marker, handling both the
  // symbol (L.marker/divIcon) and fallback (L.circleMarker) representations.
  function styleMarker(marker, n) {
    if (!marker || !n) return;
    const selectedNode = ctx.getSelectedNode();
    const highlightMode = ctx.getHighlightMode();
    const highlightSet = ctx.getHighlightSet();
    const isSel = !!(selectedNode && selectedNode.id === n.id);
    const dimmed = !!(highlightMode && highlightSet.size > 0 && !highlightSet.has(n.id));

    if (typeof marker.setStyle === 'function') {
      // Circle fallback: preserve the original recolor behavior.
      const hc = document.body.classList.contains('high-contrast');
      let col = mapColorFromTeam(n);
      if (highlightMode && highlightSet.size > 0) {
        col = highlightSet.has(n.id)
          ? (highlightMode === 'payoff' ? resolveCssVar(hc ? 'var(--accent)' : '#00e5ff')
            : resolveCssVar(hc ? 'var(--danger)' : '#ff8a65'))
          : (hc ? '#3a4a5a' : '#2b3642');
      }
      if (isSel) marker.setStyle({ radius: 9, weight: 2.5, color: '#000', fillColor: mapColorFromTeam(n), fillOpacity: 0.95 });
      else marker.setStyle({ radius: 6, weight: 1.5, color: col, fillColor: col, fillOpacity: 0.9 });
      if (isSel) marker.bringToFront();
    } else if (marker._icon) {
      // Symbol marker: dim non-highlighted, glow the selected one.
      marker._icon.classList.toggle('mil-dimmed', dimmed);
      marker._icon.classList.toggle('mil-selected', isSel);
      try { marker.setZIndexOffset(isSel ? 1000 : 0); } catch (e) {}
    }
  }

  function highlightSelectedOnMap() {
    if (!leafletMap) return;
    const selectedNode = ctx.getSelectedNode();
    const nodes = graph().nodes;
    // Re-apply highlight/selection styling to every marker (symbol or circle).
    mapMarkers.forEach((m, id) => {
      const n = nodes.find(nd => nd.id === id);
      if (n) styleMarker(m, n);
    });

    if (selectedNode && mapMarkers.has(selectedNode.id)) {
      const m = mapMarkers.get(selectedNode.id);
      m.bindPopup(capabilityPopupHtml(selectedNode), { autoPan: true, maxWidth: 380 }).openPopup();
      if (selectedNode.lat != null && selectedNode.lon != null) {
        // C-017: pan to the marker's display coordinate (which may be offset by declutter)
        // so the map recenters on where the symbol is actually drawn, not a hidden true pos.
        let viewPos;
        try { viewPos = m.getLatLng(); } catch (e) { viewPos = null; }
        if (!viewPos) viewPos = { lat: selectedNode.lat, lng: pacLon(selectedNode.lon) };
        leafletMap.setView([viewPos.lat, viewPos.lng], Math.max(leafletMap.getZoom(), 3), { animate: true });
      }
    }
    refreshMapLinks();
  }

  function refreshMapLinks() {
    if (!mapLinksLayer) return;
    mapLinksLayer.clearLayers();
    const selectedNode = ctx.getSelectedNode();
    if (!ctx.isMapMode() || !selectedNode) return;
    if (selectedNode.lat == null || selectedNode.lon == null) return;

    const g = graph();
    const neighbors = [];
    g.links.forEach(l => {
      const s = l.source?.id ?? l.source;
      const t = l.target?.id ?? l.target;
      if (s === selectedNode.id || t === selectedNode.id) {
        const neighborId = s === selectedNode.id ? t : s;
        const n = g.nodes.find(nd => nd.id === neighborId);
        if (n && n.lat != null && n.lon != null) neighbors.push(n);
      }
    });

    // C-017: use display coordinates (marker.getLatLng()) for link endpoints so lines
    // connect to where the symbols are actually drawn, not a diverging true position.
    const selMarker = mapMarkers.get(selectedNode.id);
    let selDispPos;
    try { selDispPos = selMarker ? selMarker.getLatLng() : null; } catch (e) { selDispPos = null; }
    const from = selDispPos
      ? [selDispPos.lat, selDispPos.lng]
      : [selectedNode.lat, pacLon(selectedNode.lon)];

    neighbors.forEach(n => {
      // Inner glow line (thicker, very faint) + crisp accent line on top.
      const nMarker = mapMarkers.get(n.id);
      let nDispPos;
      try { nDispPos = nMarker ? nMarker.getLatLng() : null; } catch (e) { nDispPos = null; }
      const to = nDispPos ? [nDispPos.lat, nDispPos.lng] : [n.lat, pacLon(n.lon)];

      // Glow layer: wide, low opacity
      L.polyline([from, to], {
        color: '#00d8ff',
        weight: 9,
        opacity: 0.14,
        interactive: false
      }).addTo(mapLinksLayer);
      // Primary link line
      L.polyline([from, to], {
        color: resolveCssVar ? resolveCssVar('var(--accent)') : '#00d8ff',
        weight: 2.5,
        opacity: 0.92,
        interactive: false
      }).addTo(mapLinksLayer);
    });
  }

  // Indo-Pacific operational frame — used whenever there are no markers to fit to yet,
  // so the map NEVER falls back to a whole-world view (the "zoomed out, centered on Africa"
  // state). This is a theater tool; an empty map should still show the theater.
  const THEATER_VIEW_BOUNDS = [[-12, 95], [50, 150]];

  function fitMapToMarkers() {
    if (!leafletMap) return;
    if (mapMarkers.size === 0) {
      try { leafletMap.fitBounds(THEATER_VIEW_BOUNDS); } catch (e) { leafletMap.setView([18, 125], 3); }
      return;
    }
    const group = L.featureGroup(Array.from(mapMarkers.values()));
    try {
      leafletMap.fitBounds(group.getBounds().pad(0.15), { animate: true });
    } catch {}
  }

  function closeMapPopup() {
    if (!mapMarkers) return;
    mapMarkers.forEach(m => { try { m.closePopup(); } catch {} });
  }

  function openMapPopup(node) {
    if (!node || !mapMarkers) return;
    const m = mapMarkers.get(node.id);
    if (m) {
      m.openPopup();
      if (leafletMap && node.lat != null && node.lon != null) leafletMap.setView([node.lat, pacLon(node.lon)], Math.max(leafletMap.getZoom(), 3), { animate: true });
    }
  }

  // Called by the main script's mode toggle and window-resize handler.
  function invalidateSize() {
    if (leafletMap) { leafletMap.invalidateSize(); clampMinZoom(); }
  }

  // ---- Design-system CSS injection ------------------------------------------------
  // All map CSS lives here; nothing is injected anywhere else in this file.
  // CSS variables match those defined on :root in StrikeSim2040.html.
  let hudCssInjected = false;
  function injectHudCss() {
    if (hudCssInjected || typeof document === 'undefined') return;
    hudCssInjected = true;
    const st = document.createElement('style');
    st.id = 'map-hud-css';
    st.textContent = [
      // ---- Affiliation palette tokens (canonical — do not change) -----------------
      ':root{',
      '  --map-friend:#38bdf8;--map-hostile:#ff4d5e;--map-neutral:#51cf66;--map-unknown:#ffd43b;',
      '  --map-accent:#00d8ff;--map-amber:#ffb000;--map-alert:#ff3b3b;',
      '  --map-glass:rgba(9,16,24,0.82);--map-border:rgba(0,216,255,0.22);',
      '  --map-glow:0 0 14px rgba(0,216,255,0.45);',
      '  --map-font-mono:"Share Tech Mono",monospace;--map-font-ui:Inter,system-ui,sans-serif;',
      '}',

      // ---- Leaflet container & controls ------------------------------------------
      // Remove Leaflet's default white/rounded control style; replace with glass HUD.
      '.leaflet-control-zoom,.leaflet-control-attribution,.leaflet-control-layers,',
      '.basemap-status,.compass-control,.mil-legend{',
      '  background:var(--map-glass)!important;',
      '  border:1px solid var(--map-border)!important;',
      '  border-radius:4px!important;',
      '  color:#c8e6f0!important;',
      '  font-family:var(--map-font-ui)!important;',
      '  font-size:11px!important;',
      '  backdrop-filter:blur(10px)!important;',
      '  -webkit-backdrop-filter:blur(10px)!important;',
      '}',
      '.leaflet-control-zoom a{',
      '  background:transparent!important;',
      '  color:var(--map-accent)!important;',
      '  border-color:var(--map-border)!important;',
      '  font-family:var(--map-font-mono)!important;',
      '  font-size:16px!important;',
      '  line-height:26px!important;',
      '}',
      '.leaflet-control-zoom a:hover{background:rgba(0,216,255,0.12)!important;}',
      '.leaflet-control-attribution{font-size:9px!important;opacity:.55}',
      // Layers panel
      '.leaflet-control-layers-expanded{padding:8px!important;min-width:170px}',
      '.leaflet-control-layers label{color:#c8e6f0!important;font-family:var(--map-font-ui)!important;font-size:11px}',
      '.leaflet-control-layers-separator{border-color:var(--map-border)!important}',

      // ---- Scale control ---------------------------------------------------------
      '.leaflet-control-scale-line{',
      '  background:var(--map-glass)!important;',
      '  border-color:var(--map-accent)!important;',
      '  color:var(--map-accent)!important;',
      '  font-family:var(--map-font-mono)!important;',
      '  font-size:10px!important;',
      '  padding:1px 5px!important;',
      '}',

      // ---- Compass control -------------------------------------------------------
      '.compass-control{',
      '  padding:5px 8px!important;',
      '  text-align:center;',
      '}',
      '.compass-arrow{font-size:18px;color:var(--map-accent);line-height:1;',
      '  text-shadow:var(--map-glow);}',
      '.compass-label{font-family:var(--map-font-mono);font-size:10px;',
      '  color:var(--map-accent);letter-spacing:.08em}',

      // ---- Basemap-status badge --------------------------------------------------
      '.basemap-status{',
      '  font-family:var(--map-font-mono)!important;',
      '  font-size:10px!important;',
      '  color:var(--map-accent)!important;',
      '  padding:3px 8px!important;',
      '  letter-spacing:.04em;',
      '}',
      '.basemap-status[data-state="offline"]{color:var(--map-amber)!important;}',

      // ---- Legend re-skin --------------------------------------------------------
      '.mil-legend{padding:7px 9px!important}',
      '.mil-leg-head{letter-spacing:.07em;color:var(--map-accent)!important;',
      '  font-family:var(--map-font-mono)!important;font-size:11px}',
      '.mil-leg-toggle{color:var(--map-accent)!important}',
      '.mil-leg-sub{color:rgba(0,216,255,0.55)!important;font-family:var(--map-font-ui)!important}',
      '.mil-leg-item span{font-family:var(--map-font-ui)!important;color:#c8e6f0!important}',
      '.mil-leg-note{color:rgba(200,230,240,0.45)!important;font-family:var(--map-font-ui)!important}',

      // ---- Popups ----------------------------------------------------------------
      '.leaflet-popup-content-wrapper{',
      '  background:var(--map-glass)!important;',
      '  border:1px solid var(--map-border)!important;',
      '  border-radius:6px!important;',
      '  box-shadow:var(--map-glow),0 4px 24px rgba(0,0,0,.6)!important;',
      '  backdrop-filter:blur(10px)!important;',
      '  -webkit-backdrop-filter:blur(10px)!important;',
      '  color:#e2f4fb!important;',
      '  font-family:var(--map-font-ui)!important;',
      '  padding:0!important;',
      '}',
      '.leaflet-popup-content{',
      '  margin:10px 14px!important;',
      '  font-size:12px!important;',
      '  line-height:1.5!important;',
      '}',
      '.leaflet-popup-content strong{',
      '  display:block;font-family:var(--map-font-mono);font-size:13px;',
      '  color:var(--map-accent);letter-spacing:.04em;margin-bottom:2px;',
      '}',
      '.map-cap-popup{min-width:250px;max-width:340px}',
      '.map-cap-id{display:block;font-family:var(--map-font-mono);font-size:10px;',
      '  color:rgba(0,216,255,.55);margin-top:1px;word-break:break-word}',
      '.map-cap-meta{margin-top:6px;color:#a8c8d8;font-size:11px;text-transform:capitalize}',
      '.map-cap-active{margin-top:7px;padding:6px 8px;border:1px solid rgba(0,216,255,.16);',
      '  border-radius:4px;background:rgba(0,216,255,.05);font-family:var(--map-font-mono);font-size:10.5px}',
      '.map-cap-active>span,.map-cap-assumption>span,.map-cap-sources>span{display:block;color:var(--map-accent);',
      '  font:10px var(--map-font-ui);letter-spacing:.08em;text-transform:uppercase;margin-bottom:2px}',
      '.map-cap-details{margin-top:7px;border-top:1px solid rgba(0,216,255,.14);padding-top:5px}',
      '.map-cap-details summary{cursor:pointer;color:#bfeaff;font:600 11px var(--map-font-ui);',
      '  list-style-position:outside;outline-offset:2px}',
      '.map-cap-detail-body{margin-top:6px;display:grid;gap:5px}',
      '.map-cap-row{display:grid;grid-template-columns:minmax(72px,.7fr) minmax(120px,1.5fr);gap:8px;',
      '  align-items:start;font-size:10.5px}',
      '.map-cap-row>span{color:#7798aa}.map-cap-row>b{font-weight:500;color:#d5e9f2;overflow-wrap:anywhere}',
      '.map-cap-assumption{padding:6px 7px;background:rgba(255,176,0,.05);border-left:2px solid rgba(255,176,0,.45);',
      '  color:#c9dce5;font-size:10.5px;overflow-wrap:anywhere}',
      '.map-cap-sources{display:grid;gap:3px;margin-top:1px}',
      '.map-cap-sources a,.map-cap-sources>span:not(:first-child){display:block;color:#76dcff;font-size:10.5px;',
      '  overflow-wrap:anywhere;text-decoration:none}',
      '.map-cap-sources a:hover{text-decoration:underline;color:#fff}',
      '.map-cap-sources small{display:block;color:#7798aa;font-size:9.5px}',
      '.leaflet-popup-tip-container .leaflet-popup-tip{',
      '  background:rgba(9,16,24,0.9)!important;',
      '}',
      '.leaflet-popup-close-button{color:var(--map-accent)!important;font-size:16px!important;top:3px!important;right:5px!important;}',
      '.leaflet-popup-close-button:hover{color:#fff!important;}',
      // Popup node-id line
      '.leaflet-popup-content [style*="--muted"]{',
      '  font-family:var(--map-font-mono);font-size:10px;color:rgba(0,216,255,0.55);',
      '}',

      // ---- Marker states: dim / selected / fallback circles ----------------------
      // MIL-symbol icon wrapper
      '.mil-dimmed{opacity:.28;filter:grayscale(.6) brightness(.7);transition:opacity .2s}',
      '.mil-selected{',
      '  filter:drop-shadow(0 0 7px var(--map-accent)) drop-shadow(0 0 14px rgba(0,216,255,0.5));',
      '}',

      // ---- Blip / sonar-halo pulse on div-icon markers --------------------------
      // The halo is a pseudo-element so it never shifts the icon's click target.
      // Reduced-motion: no animation, keep the static ring.
      '@keyframes mapBlip{',
      '  0%{transform:scale(.55);opacity:.75}',
      '  55%{opacity:.35}',
      '  100%{transform:scale(2.2);opacity:0}',
      '}',
      '@keyframes mapBlipStrong{',
      '  0%{transform:scale(.55);opacity:.9}',
      '  55%{opacity:.55}',
      '  100%{transform:scale(2.8);opacity:0}',
      '}',
      // .mil-blip is added to divIcon wrapper by refreshMapMarkers
      '.mil-blip::after{',
      '  content:"";display:block;position:absolute;',
      '  top:50%;left:50%;width:28px;height:28px;',
      '  transform:translate(-50%,-50%) scale(.55);',
      '  border-radius:50%;border:1.5px solid var(--blip-color,var(--map-friend));',
      '  pointer-events:none;',
      '  animation:mapBlip 2.6s ease-out infinite;',
      '  animation-delay:var(--blip-delay,0s);',
      '}',
      '.mil-blip.mil-selected::after{',
      '  width:34px;height:34px;',
      '  border-width:2.5px;',
      '  border-color:var(--map-accent);',
      '  animation:mapBlipStrong 1.8s ease-out infinite;',
      '  box-shadow:0 0 8px rgba(0,216,255,0.4);',
      '}',
      // High-importance nodes get a slightly stronger base ring
      '.mil-blip.mil-hi::after{',
      '  width:32px;height:32px;',
      '  border-width:2px;',
      '  animation-duration:2.2s;',
      '}',
      '@media(prefers-reduced-motion:reduce){',
      '  .mil-blip::after,.mil-blip.mil-selected::after,.mil-blip.mil-hi::after{animation:none;opacity:.35}',
      '}',

      // ---- Objective marker ------------------------------------------------------
      '@keyframes mapObjPulse{',
      '  0%,100%{box-shadow:0 0 6px 2px var(--obj-glow,var(--map-amber)),inset 0 0 4px rgba(255,176,0,.3)}',
      '  50%{box-shadow:0 0 16px 6px var(--obj-glow,var(--map-amber)),inset 0 0 8px rgba(255,176,0,.5)}',
      '}',
      '@keyframes mapObjSpin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}',
      '.map-obj-marker{',
      '  display:flex;align-items:center;justify-content:center;',
      '  width:22px;height:22px;',
      '  border-radius:50%;',
      '  border:2px solid var(--map-amber);',
      '  background:rgba(255,176,0,0.12);',
      '  color:var(--map-amber);',
      '  font-size:10px;font-family:var(--map-font-mono);font-weight:700;',
      '  animation:mapObjPulse 2.4s ease-in-out infinite;',
      '}',
      '.map-obj-marker.obj-hostile{',
      '  border-color:var(--map-alert);color:var(--map-alert);',
      '  background:rgba(255,59,59,0.12);',
      '  --obj-glow:var(--map-alert);',
      '}',
      '@media(prefers-reduced-motion:reduce){.map-obj-marker{animation:none}}',

      // ---- Radar-sweep FX --------------------------------------------------------
      // A single rotating conic-gradient div in its own pane. Cheap: one element,
      // CSS-only rotation. Kept very faint so it reads as ambiance, not distraction.
      '@keyframes mapRadarSweep{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}',
      '#map-radar-sweep{',
      '  position:absolute;top:50%;left:50%;',
      '  width:200vmax;height:200vmax;',
      '  transform:translate(-50%,-50%) rotate(0deg);',
      '  background:conic-gradient(',
      '    rgba(0,216,255,0) 0deg,',
      '    rgba(0,216,255,0) 338deg,',
      '    rgba(0,216,255,0.07) 348deg,',
      '    rgba(0,216,255,0.18) 355deg,',
      '    rgba(0,216,255,0.04) 360deg',
      '  );',
      '  pointer-events:none;',
      '  animation:mapRadarSweep 8s linear infinite;',
      '  border-radius:50%;',
      '  mix-blend-mode:screen;',
      '}',
      '@media(prefers-reduced-motion:reduce){#map-radar-sweep{animation:none;display:none}}',

      // ---- Strike FX (existing arc + new cinematic tracer/shockwave) ------------
      '@keyframes wgTracer{from{stroke-dashoffset:160}to{stroke-dashoffset:0}}',
      '@keyframes wgFade{0%{opacity:0}14%{opacity:1}72%{opacity:1}100%{opacity:0}}',
      '.wg-strike-fx{stroke-linecap:round;animation:wgTracer .55s linear,wgFade 1.25s ease forwards}',
      '.wg-impact-fx span{display:block;width:12px;height:12px;border-radius:50%;border:2.5px solid #fff;',
      '  box-sizing:border-box;animation:wgImpact .85s ease-out forwards}',
      '@keyframes wgImpact{0%{transform:scale(.35);opacity:.95}100%{transform:scale(5);opacity:0}}',

      // Traveling tracer pulse dot
      '@keyframes wgPulseGlow{',
      '  0%,100%{box-shadow:0 0 4px 2px var(--tracer-color,#6fe0ff),0 0 10px 4px var(--tracer-color,#6fe0ff)}',
      '  50%{box-shadow:0 0 8px 4px var(--tracer-color,#6fe0ff),0 0 18px 8px var(--tracer-color,#6fe0ff)}',
      '}',
      '.wg-tracer-dot{',
      '  width:8px;height:8px;border-radius:50%;',
      '  background:var(--tracer-core,#fff);',
      '  box-shadow:0 0 6px 3px var(--tracer-color,#6fe0ff),0 0 14px 6px var(--tracer-color,#6fe0ff);',
      '  mix-blend-mode:screen;',
      '  animation:wgPulseGlow .35s ease-in-out infinite;',
      '  pointer-events:none;',
      '}',
      // Trail segments
      '.wg-tracer-trail{',
      '  width:5px;height:5px;border-radius:50%;',
      '  background:var(--tracer-color,#6fe0ff);',
      '  mix-blend-mode:screen;',
      '  pointer-events:none;',
      '}',
      // Shockwave ring
      '@keyframes wgShockwave{',
      '  0%{transform:translate(-50%,-50%) scale(.15);opacity:1}',
      '  60%{opacity:.7}',
      '  100%{transform:translate(-50%,-50%) scale(1);opacity:0}',
      '}',
      '@keyframes wgShockwaveBig{',
      '  0%{transform:translate(-50%,-50%) scale(.1);opacity:1}',
      '  60%{opacity:.9}',
      '  100%{transform:translate(-50%,-50%) scale(1);opacity:0}',
      '}',
      '.wg-shockwave{',
      '  position:absolute;top:50%;left:50%;',
      '  border-radius:50%;',
      '  border:2px solid var(--shock-color,#6fe0ff);',
      '  pointer-events:none;',
      '  mix-blend-mode:screen;',
      '  animation:wgShockwave .65s ease-out forwards;',
      '}',
      '.wg-shockwave.wg-shock-kill{',
      '  border-color:var(--shock-kill-color,#fff);',
      '  border-width:3px;',
      '  animation:wgShockwaveBig .9s ease-out forwards;',
      '}',
      '.wg-shockwave.wg-shock-inner{',
      '  animation-delay:.08s;',
      '  opacity:.65;',
      '}',
      // Reduced-motion overrides: skip tracer travel, use static ring only
      '@media(prefers-reduced-motion:reduce){',
      '  .wg-tracer-dot,.wg-tracer-trail{display:none}',
      '  .wg-shockwave{animation:wgImpact .85s ease-out forwards}',
      '  .wg-shockwave.wg-shock-kill{animation-duration:.95s}',
      '}',
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  // ---- Radar sweep element -------------------------------------------------------
  // One rotating div placed in the radar pane (z-index below markers, above basemap).
  // Created once; re-used across refreshMapMarkers calls.
  let radarSweepEl = null;
  function ensureRadarSweep() {
    if (radarSweepEl || !leafletMap) return;
    try {
      const pane = leafletMap.getPane('radarPane');
      if (!pane) return;
      radarSweepEl = document.createElement('div');
      radarSweepEl.id = 'map-radar-sweep';
      pane.appendChild(radarSweepEl);
    } catch (e) { /* silent */ }
  }

  // ---- Strike FX: animated tracer arcs + impact flashes ---------------------------
  // (CSS is now inside injectHudCss; this function is kept as a no-op shim so the
  //  ensureMap() call site `injectFxCss()` continues to compile and run without error.)
  let fxCssInjected = false;
  function injectFxCss() {
    // Unified CSS is injected by injectHudCss(); nothing to do here.
    void fxCssInjected;
  }

  function nodeById(id) { return graph().nodes.find(n => n.id === id) || null; }
  function mapVisible() {
    try { return leafletMap && leafletMap.getContainer().offsetParent !== null; } catch (e) { return false; }
  }

  // C-020 (P1): Hidden-strike queue.
  // When flashStrike / playStrikes are called while the map panel is not visible,
  // events are queued rather than silently dropped. When the map becomes visible again
  // (detected via replayHiddenStrikes(), which the main script calls on map-mode
  // activation, or which fires automatically if an IntersectionObserver is available),
  // a condensed replay is shown: at most MAX_QUEUED_STRIKES events staggered over ~2 s,
  // oldest-first. The queue is capped so a long hidden session never floods the COP.
  const MAX_QUEUED_STRIKES = 30;
  const _hiddenStrikeQueue = [];

  function _enqueueStrike(srcId, dstId, opts) {
    if (_hiddenStrikeQueue.length >= MAX_QUEUED_STRIKES) {
      _hiddenStrikeQueue.shift(); // drop oldest to make room (keep recency)
    }
    _hiddenStrikeQueue.push({ srcId, dstId, opts: Object.assign({}, opts) });
  }

  // Called by the main script when the map panel becomes visible (mode toggle).
  // Also wired to an IntersectionObserver below when the DOM is available.
  function replayHiddenStrikes() {
    if (_hiddenStrikeQueue.length === 0) return;
    if (!mapVisible()) return; // still hidden; keep the queue for next activation
    const batch = _hiddenStrikeQueue.splice(0); // drain queue atomically
    // Condensed replay: stagger over ~2 s (max 30 events → ~67 ms apart).
    const interval = Math.max(60, Math.min(200, 2000 / batch.length));
    batch.forEach((ev, i) => {
      setTimeout(() => {
        if (mapVisible()) flashStrike(ev.srcId, ev.dstId, ev.opts);
      }, i * interval);
    });
  }

  // Wire IntersectionObserver so replayHiddenStrikes fires automatically when the
  // map container scrolls into view (works even without a main-script hook).
  function _wireMapVisibilityObserver() {
    if (typeof IntersectionObserver === 'undefined' || !leafletMap) return;
    try {
      const container = leafletMap.getContainer();
      if (!container) return;
      const obs = new IntersectionObserver((entries) => {
        entries.forEach(entry => { if (entry.isIntersecting) replayHiddenStrikes(); });
      }, { threshold: 0.1 });
      obs.observe(container);
    } catch (e) { /* non-fatal — main-script can call replayHiddenStrikes() directly */ }
  }

  // Quadratic-bezier arc (list of [lat,lon]) bowed off the straight line for a ballistic feel.
  function arcPoints(from, to, bend, n) {
    const lat1 = from[0], lon1 = from[1], lat2 = to[0], lon2 = to[1];
    const mx = (lat1 + lat2) / 2, my = (lon1 + lon2) / 2;
    const dLat = lat2 - lat1, dLon = lon2 - lon1;
    const cLat = mx - dLon * bend, cLon = my + dLat * bend; // perpendicular control point
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
      pts.push([a * lat1 + b * cLat + c * lat2, a * lon1 + b * cLon + c * lon2]);
    }
    return pts;
  }

  // Animate a strike from one node to another. opts: { team:'red'|'blue', kill:bool }.
  // C-020 (P1): If the map is not currently visible, queue the event for replay rather
  // than silently discarding it.
  function flashStrike(srcId, dstId, opts) {
    opts = opts || {};
    if (!leafletMap || !mapVisible()) {
      _enqueueStrike(srcId, dstId, opts);
      return;
    }
    const s = nodeById(srcId), d = nodeById(dstId);
    if (!d || d.lat == null || d.lon == null) return;
    const team = opts.team === 'blue' ? 'blue' : 'red';
    const color = team === 'blue' ? '#6fe0ff' : '#ff8a4a';
    const isKill = !!opts.kill;

    // Detect reduced-motion preference once per call.
    const reducedMotion = (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );

    // Cleanup registry: everything added during this strike, removed on completion.
    const tempLayers = [];
    const tempTimers = [];
    let tracerRaf = null;

    function safeDrop(layer) {
      try { if (leafletMap) leafletMap.removeLayer(layer); } catch (e) {}
    }
    function cleanup() {
      tempTimers.forEach(t => clearTimeout(t));
      tempTimers.length = 0;
      if (tracerRaf !== null) { cancelAnimationFrame(tracerRaf); tracerRaf = null; }
      tempLayers.forEach(l => safeDrop(l));
      tempLayers.length = 0;
    }

    // ---- 1. Arc polyline (existing behavior, preserved) -------------------------
    let pts = null;
    if (s && s.lat != null && s.lon != null) {
      const from = [s.lat, pacLon(s.lon)], to = [d.lat, pacLon(d.lon)];
      pts = arcPoints(from, to, 0.18, 30);
      const line = L.polyline(pts, {
        pane: 'fxPane', interactive: false, color, weight: isKill ? 3.2 : 2.2,
        opacity: 0.95, dashArray: '4 9', className: 'wg-strike-fx'
      }).addTo(leafletMap);
      tempLayers.push(line);
    }

    // ---- Helper: spawn impact shockwave at target --------------------------------
    function spawnShockwave() {
      const dLat = d.lat, dLon = pacLon(d.lon);
      const shockColor = isKill ? '#fff' : color;
      const outerSize = isKill ? 72 : 48;
      const innerSize = isKill ? 46 : 30;

      // Outer ring
      const outerHtml = '<div class="wg-shockwave' + (isKill ? ' wg-shock-kill' : '') + '" ' +
        'style="width:' + outerSize + 'px;height:' + outerSize + 'px;' +
        '--shock-color:' + shockColor + ';--shock-kill-color:#fff;"></div>';
      const outerIcon = L.divIcon({
        className: '', html: outerHtml,
        iconSize: [outerSize, outerSize], iconAnchor: [outerSize / 2, outerSize / 2]
      });
      const outerM = L.marker([dLat, dLon], { icon: outerIcon, pane: 'fxPane', interactive: false, keyboard: false }).addTo(leafletMap);
      tempLayers.push(outerM);

      // Inner ring (slight delay, same center)
      const innerHtml = '<div class="wg-shockwave wg-shock-inner' + (isKill ? ' wg-shock-kill' : '') + '" ' +
        'style="width:' + innerSize + 'px;height:' + innerSize + 'px;' +
        '--shock-color:' + shockColor + ';--shock-kill-color:#fff;"></div>';
      const innerIcon = L.divIcon({
        className: '', html: innerHtml,
        iconSize: [innerSize, innerSize], iconAnchor: [innerSize / 2, innerSize / 2]
      });
      const innerM = L.marker([dLat, dLon], { icon: innerIcon, pane: 'fxPane', interactive: false, keyboard: false }).addTo(leafletMap);
      tempLayers.push(innerM);

      // Keep the existing impact flash too (white hot on kill)
      const impactIcon = L.divIcon({
        className: 'wg-impact-fx',
        html: '<span style="border-color:' + (isKill ? '#fff' : color) + '"></span>',
        iconSize: [12, 12], iconAnchor: [6, 6]
      });
      const impactM = L.marker([dLat, dLon], { icon: impactIcon, pane: 'fxPane', interactive: false, keyboard: false }).addTo(leafletMap);
      tempLayers.push(impactM);

      // Remove everything after the longest animation completes
      const totalDur = isKill ? 1300 : 950;
      const t = setTimeout(cleanup, totalDur);
      tempTimers.push(t);
    }

    // ---- 2. Reduced-motion path: skip tracer, just flash + static ring ----------
    if (reducedMotion || !pts) {
      spawnShockwave();
      return;
    }

    // ---- 3. Cinematic tracer pulse: dot travels the arc over ~600ms -------------
    const TRAVEL_MS = 600;
    const TRAIL_LEN = 4;    // number of trailing ghost dots
    const trailMarkers = []; // ring buffer of the last N positions

    const dotCoreColor = isKill ? '#fff' : '#fff';
    const dotHtml = '<div class="wg-tracer-dot" style="--tracer-color:' + color + ';--tracer-core:' + dotCoreColor + '"></div>';
    const dotIcon = L.divIcon({ className: '', html: dotHtml, iconSize: [8, 8], iconAnchor: [4, 4] });
    const dotM = L.marker(pts[0], { icon: dotIcon, pane: 'fxPane', interactive: false, keyboard: false }).addTo(leafletMap);
    tempLayers.push(dotM);

    // Pre-create trail markers (reused each frame)
    for (let ti = 0; ti < TRAIL_LEN; ti++) {
      const opacity = 1 - (ti + 1) / (TRAIL_LEN + 1);
      const sz = Math.max(2, 5 - ti);
      const trailHtml = '<div class="wg-tracer-trail" style="width:' + sz + 'px;height:' + sz + 'px;' +
        '--tracer-color:' + color + ';opacity:' + opacity.toFixed(2) + '"></div>';
      const trailIcon = L.divIcon({ className: '', html: trailHtml, iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2] });
      const trailM = L.marker(pts[0], { icon: trailIcon, pane: 'fxPane', interactive: false, keyboard: false }).addTo(leafletMap);
      tempLayers.push(trailM);
      trailMarkers.push(trailM);
    }

    // Position history for trail (stores the lat/lon at each frame for trailing dots)
    const posHistory = [];
    const startTime = performance.now();

    function animateTracer(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / TRAVEL_MS);

      // Interpolate along the arc points array
      const maxIdx = pts.length - 1;
      const rawIdx = progress * maxIdx;
      const lo = Math.floor(rawIdx), hi = Math.min(maxIdx, lo + 1);
      const frac = rawIdx - lo;
      const lat = pts[lo][0] + (pts[hi][0] - pts[lo][0]) * frac;
      const lon = pts[lo][1] + (pts[hi][1] - pts[lo][1]) * frac;

      // Move the leading dot
      try { dotM.setLatLng([lat, lon]); } catch (e) {}

      // Update trail: push current pos, keep last TRAIL_LEN
      posHistory.push([lat, lon]);
      const histLen = posHistory.length;
      for (let ti = 0; ti < TRAIL_LEN; ti++) {
        const histIdx = histLen - 2 - ti * 2; // step back 2 frames per trail segment
        if (histIdx >= 0) {
          try { trailMarkers[ti].setLatLng(posHistory[histIdx]); } catch (e) {}
        }
      }

      if (progress < 1) {
        tracerRaf = requestAnimationFrame(animateTracer);
      } else {
        // Tracer arrived — cancel RAF, remove the traveling elements, spawn shockwave
        tracerRaf = null;
        try { safeDrop(dotM); } catch (e) {}
        trailMarkers.forEach(tm => { try { safeDrop(tm); } catch (e) {} });
        // Remove them from tempLayers so cleanup() doesn't double-remove
        const toRemove = new Set([dotM, ...trailMarkers]);
        for (let i = tempLayers.length - 1; i >= 0; i--) {
          if (toRemove.has(tempLayers[i])) tempLayers.splice(i, 1);
        }
        spawnShockwave();
      }
    }

    tracerRaf = requestAnimationFrame(animateTracer);

    // Safety net: if anything goes wrong, force cleanup after max expected duration
    const safetyTimer = setTimeout(() => { cleanup(); }, TRAVEL_MS + 2000);
    tempTimers.push(safetyTimer);
  }

  // Play a turn's resolution events as a staggered volley.
  // C-020 (P1): If the map is hidden, enqueue each strike rather than dropping the whole
  // batch. They will be replayed (condensed) when the map becomes visible again.
  function playStrikes(events) {
    if (!Array.isArray(events)) return;
    const shots = events.filter(e => e && (e.kind === 'hit' || e.kind === 'kill') && e.targetId);
    if (!mapVisible()) {
      // Queue all shots for later replay (each respects the MAX_QUEUED_STRIKES cap).
      shots.forEach(e => _enqueueStrike(e.sourceId, e.targetId, {
        team: e.side === 'blue' ? 'blue' : 'red', kill: e.kind === 'kill'
      }));
      return;
    }
    shots.forEach((e, i) => {
      setTimeout(() => flashStrike(e.sourceId, e.targetId, {
        team: e.side === 'blue' ? 'blue' : 'red', kill: e.kind === 'kill'
      }), i * 130);
    });
  }

  function getMap() { return leafletMap; }
  function getMarkers() { return mapMarkers; }

  return {
    init,
    ensureMap,
    refreshMapMarkers,
    highlightSelectedOnMap,
    refreshMapLinks,
    fitMapToMarkers,
    openMapPopup,
    closeMapPopup,
    invalidateSize,
    flashStrike,
    playStrikes,
    replayHiddenStrikes,  // C-020: call from main script on map-mode activation
    getMap,
    getMarkers,
    _internal: { capabilityPopupHtml, escapePopupHtml, safeHttpUrl, capacityFor }
  };
})();
