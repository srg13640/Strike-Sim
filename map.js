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
  const mapMarkers = new Map(); // id -> marker

  // --- Injected context (overridden by init); safe defaults so nothing throws ---
  let ctx = {
    getSelectedNode: () => null,
    getHighlightMode: () => null,
    getHighlightSet: () => new Set(),
    isMapMode: () => false,
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
    leafletMap = L.map('map', {
      zoomControl: true,
      worldCopyJump: true,
      attributionControl: true
    });
    leafletMap.on('click', () => selectNode(null));

    // Minimal no-labels tiles
    let tileErrorNotified = false;
    const localTiles = L.tileLayer(
      `${ctx.tileBasePath}/{z}/{x}/{y}.png`,
      {
        minZoom: 0,
        maxZoom: 5,
        tileSize: 256,
        errorTileUrl: ctx.blankTileDataUrl,
        attribution: 'Local tiles'
      }
    ).addTo(leafletMap);
    localTiles.on('tileerror', () => {
      if (!tileErrorNotified) {
        addEvent({ type: 'View', text: 'Offline tiles missing for some areas; showing blank tiles.' });
        tileErrorNotified = true;
      }
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
    const setBasemapStatus = (text, state) => {
      const el = document.querySelector('.basemap-status');
      if (!el) return;
      el.textContent = text;
      if (state) el.setAttribute('data-state', state); else el.removeAttribute('data-state');
    };

    // Probe for a real local tile (root z/x/y). Relative path, so it stays within
    // OFFLINE_MODE. If found, the local tiles are used silently; if absent, keep the
    // blank offline grid and say so plainly rather than failing quietly. Any error in
    // probing degrades to the offline state without throwing.
    try {
      const probe = new Image();
      probe.onload = () => setBasemapStatus('Basemap: local tiles', 'ok');
      probe.onerror = () => {
        setBasemapStatus('Basemap: offline — no tiles', 'offline');
        addEvent({ type: 'View', text: 'No local basemap tiles found; showing offline grid.' });
      };
      probe.src = `${ctx.tileBasePath}/0/0/0.png`;
    } catch (err) {
      setBasemapStatus('Basemap: offline — no tiles', 'offline');
    }

    markersLayer = L.layerGroup().addTo(leafletMap);
    mapLinksLayer = L.layerGroup().addTo(leafletMap);
    setTimeout(() => { leafletMap.invalidateSize(); fitMapToMarkers(); }, 50);
  }

  function refreshMapMarkers() {
    if (!leafletMap || !markersLayer) return;
    markersLayer.clearLayers();
    mapMarkers.clear();

    const { visibleNodes } = currentVisible();
    const hc = document.body.classList.contains('high-contrast');
    const highlightMode = ctx.getHighlightMode();
    const highlightSet = ctx.getHighlightSet();

    visibleNodes.forEach(n => {
      if (n.lat == null || n.lon == null) return;

      // Determine marker colors under highlight modes
      let col = mapColorFromTeam(n);
      if (highlightMode && highlightSet.size > 0) {
        if (!highlightSet.has(n.id)) {
          col = hc ? '#3a4a5a' : '#2b3642';
        } else {
          col = highlightMode === 'payoff' ? resolveCssVar(hc ? 'var(--accent)' : '#00e5ff')
            : resolveCssVar(hc ? 'var(--danger)' : '#ff8a65');
        }
      }

      const marker = L.circleMarker([n.lat, n.lon], {
        radius: 6,
        color: col,
        fillColor: col,
        fillOpacity: 0.9,
        weight: 1.5
      })
        .addTo(markersLayer)
        .on('click', () => selectNodeById(n.id));

      marker.bindPopup(`<strong>${n.name}</strong><br>${n.id}`);
      mapMarkers.set(n.id, marker);
    });

    highlightSelectedOnMap();
  }

  function highlightSelectedOnMap() {
    if (!leafletMap) return;
    const selectedNode = ctx.getSelectedNode();
    const highlightMode = ctx.getHighlightMode();
    const highlightSet = ctx.getHighlightSet();
    const nodes = graph().nodes;
    // Reset all marker styles
    mapMarkers.forEach((m, id) => {
      const n = nodes.find(nd => nd.id === id);
      if (!n) return;
      let col = mapColorFromTeam(n);
      const hc = document.body.classList.contains('high-contrast');
      if (highlightMode && highlightSet.size > 0) {
        col = highlightSet.has(n.id)
          ? (highlightMode === 'payoff' ? resolveCssVar(hc ? 'var(--accent)' : '#00e5ff')
            : resolveCssVar(hc ? 'var(--danger)' : '#ff8a65'))
          : (hc ? '#3a4a5a' : '#2b3642');
      }
      m.setStyle({ radius: 6, weight: 1.5, color: col, fillColor: col, fillOpacity: 0.9 });
    });

    if (selectedNode && mapMarkers.has(selectedNode.id)) {
      const m = mapMarkers.get(selectedNode.id);
      m.setStyle({ radius: 9, weight: 2.5, color: '#000', fillColor: mapColorFromTeam(selectedNode), fillOpacity: 0.95 });
      m.bringToFront();
      m.bindPopup(`<strong>${selectedNode.name}</strong><br/><span style="color:var(--muted)">${selectedNode.id}</span>`, { autoPan: true }).openPopup();
      if (selectedNode.lat != null && selectedNode.lon != null) {
        leafletMap.setView([selectedNode.lat, selectedNode.lon], Math.max(leafletMap.getZoom(), 3), { animate: true });
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
      L.polyline([[selectedNode.lat, selectedNode.lon], [n.lat, n.lon]], {
        color: resolveCssVar('var(--accent)'),
        weight: 3,
        opacity: 0.85
      }).addTo(mapLinksLayer);
    });
  }

  function fitMapToMarkers() {
    if (!leafletMap || mapMarkers.size === 0) {
      if (leafletMap) leafletMap.setView([20, 0], 2);
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
      if (leafletMap && node.lat != null && node.lon != null) leafletMap.setView([node.lat, node.lon], Math.max(leafletMap.getZoom(), 3), { animate: true });
    }
  }

  // Called by the main script's mode toggle and window-resize handler.
  function invalidateSize() {
    if (leafletMap) leafletMap.invalidateSize();
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
