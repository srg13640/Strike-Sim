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

    // ---- Basemaps: crisp online tiles with an automatic offline fallback ------------
    // A dark "command picture" basemap by default so colored symbols and overlays pop —
    // the convention real C2/COP tools use — with a photographic satellite option and the
    // bundled Blue Marble image as a no-network safety net. Slippy tiles wrap across the
    // antimeridian, so the Pacific-centered view stays seamless out to the Americas.
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
    // Offline bundled imagery (two copies so the dateline stays covered) — used when the
    // network is unavailable, or selectable directly.
    const offlineLayer = L.layerGroup([
      L.imageOverlay(GLOBAL_SATELLITE_BASEMAP, GLOBAL_SATELLITE_BOUNDS, { pane: 'basemapPane', interactive: false, className: 'global-satellite-overlay' }),
      L.imageOverlay(GLOBAL_SATELLITE_BASEMAP, GLOBAL_SATELLITE_BOUNDS_WRAP, { pane: 'basemapPane', interactive: false, className: 'global-satellite-overlay' })
    ]);

    darkLayer.addTo(leafletMap);
    globalSatelliteLoaded = true; // a real basemap is up; suppress the bare-grid status
    setBasemapStatus('Basemap: dark (online)', 'ok');
    L.control.layers(
      { 'Dark (command picture)': darkLayer, 'Satellite': satLayer, 'Offline imagery': offlineLayer },
      null, { position: 'topright', collapsed: true }
    ).addTo(leafletMap);
    leafletMap.on('baselayerchange', (e) => setBasemapStatus('Basemap: ' + e.name, 'ok'));

    // Auto-fallback: if online tiles can't load (offline / blocked), switch to the bundled
    // imagery so the map is never blank. A handful of tile errors is the trigger.
    let onlineTileErrors = 0, fellBack = false;
    const fallBackToOffline = () => {
      if (fellBack || !leafletMap) return;
      fellBack = true;
      if (leafletMap.hasLayer(darkLayer)) leafletMap.removeLayer(darkLayer);
      offlineLayer.addTo(leafletMap);
      setBasemapStatus('Basemap: offline imagery', 'offline');
    };
    darkLayer.on('tileerror', () => { if (++onlineTileErrors >= 4) fallBackToOffline(); });

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
            `<div class="mil-leg-note">Air = dome · Sea = wave · dashed/✕ = degraded/destroyed</div></div>`;
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
    // Now that the badge exists, reflect the active online basemap (or the fallback).
    setBasemapStatus(fellBack ? 'Basemap: offline imagery' : 'Basemap: dark (online)', fellBack ? 'offline' : 'ok');

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
    setTimeout(() => { leafletMap.invalidateSize(); clampMinZoom(); fitMapToMarkers(); }, 50);
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

  function refreshMapMarkers() {
    if (!leafletMap || !markersLayer) return;
    markersLayer.clearLayers();
    mapMarkers.clear();

    const { visibleNodes } = currentVisible();
    const useSym = symbolsEnabled();

    visibleNodes.forEach(n => {
      if (n.lat == null || n.lon == null) return;

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
          marker = L.marker([n.lat, pacLon(n.lon)], { icon, riseOnHover: true, keyboard: false })
            .addTo(markersLayer)
            .on('click', () => selectNodeById(n.id));
        }
      }
      if (!marker) {
        // Fallback: original colored circle marker.
        const col = mapColorFromTeam(n);
        marker = L.circleMarker([n.lat, pacLon(n.lon)], {
          radius: 6, color: col, fillColor: col, fillOpacity: 0.9, weight: 1.5
        }).addTo(markersLayer).on('click', () => selectNodeById(n.id));
      }

      marker.__node = n;
      marker.bindPopup(`<strong>${n.name}</strong><br>${n.id}`);
      mapMarkers.set(n.id, marker);
    });

    highlightSelectedOnMap();
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
      m.bindPopup(`<strong>${selectedNode.name}</strong><br/><span style="color:var(--muted)">${selectedNode.id}</span>`, { autoPan: true }).openPopup();
      if (selectedNode.lat != null && selectedNode.lon != null) {
        leafletMap.setView([selectedNode.lat, pacLon(selectedNode.lon)], Math.max(leafletMap.getZoom(), 3), { animate: true });
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
    neighbors.forEach(n => {
      L.polyline([[selectedNode.lat, pacLon(selectedNode.lon)], [n.lat, pacLon(n.lon)]], {
        color: resolveCssVar('var(--accent)'),
        weight: 3,
        opacity: 0.85
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
    getMap,
    getMarkers
  };
})();
