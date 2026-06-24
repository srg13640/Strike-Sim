/*
 * stage.js — StrikeSim 2040 Stage Manager.
 *
 * THE reliability foundation. Before this module, resize logic was scattered and
 * partial: the only window-resize handler re-sized the Leaflet map (and only in Map
 * mode), nothing re-sized the Three.js renderer or fixed its camera aspect, there was
 * no Fullscreen support, and there was NO WebGL context-loss recovery — so a fullscreen
 * transition or a fast resize could drop the GPU context and leave the 3D view dead
 * ("3D view unavailable: WebGL context failed") with no way back.
 *
 * This module is the single authority for "render the active surface at the current
 * size, and survive the GPU dropping out." Every size-changing event — window resize,
 * panel collapse, view switch, entering/leaving fullscreen — is funnelled through one
 * rAF-debounced apply() that re-sizes whichever surface is currently visible and guards
 * against the 0x0 size that corrupts canvases mid-transition.
 *
 * Self-contained and defensive: it reads EngineModule/MapModule/showToast at call time
 * (so load order does not matter) and every external touch is wrapped, so a missing
 * dependency degrades quietly instead of throwing.
 */
window.StageModule = (function () {
  'use strict';

  var resizeTimer = null;
  var webglAttached = false;
  var ro = null;

  function graphEl() { return document.getElementById('graph'); }
  function mapEl() { return document.getElementById('map'); }
  function appEl() { return document.getElementById('app') || document.documentElement; }
  function gi() {
    try { if (window.EngineModule && EngineModule.getGraph) return EngineModule.getGraph(); } catch (e) {}
    return window.graphInstance || null;
  }
  // An element is "live" if it is actually laid out with a non-zero box. display:none
  // surfaces report offsetParent null / 0x0 and must be skipped — sizing a hidden canvas
  // to 0x0 is exactly what corrupts it.
  function live(el) { return !!(el && el.offsetParent !== null && el.clientWidth > 0 && el.clientHeight > 0); }

  // Debounce with setTimeout rather than requestAnimationFrame: rAF is fully PAUSED when
  // the tab is backgrounded, which would silently drop a resize that happened while hidden
  // (and then never re-apply on return). setTimeout still fires, so the active surface is
  // always eventually reconciled to its container.
  function schedule() {
    if (resizeTimer) return;
    resizeTimer = setTimeout(function () { resizeTimer = null; apply(); }, 60);
  }

  function apply() {
    var inst = gi();

    // 3D surface: drive the renderer + camera explicitly from the container box. Setting
    // width/height on the ForceGraph3D instance resizes its WebGLRenderer and updates the
    // camera aspect/projection — the step that was missing and caused node misalignment.
    var g = graphEl();
    if (inst && live(g)) {
      var w = g.clientWidth, h = g.clientHeight;
      if (w > 0 && h > 0) { try { inst.width(w); inst.height(h); } catch (e) {} }
    }

    // First time we have a real renderer, wire up context-loss survival.
    if (inst && !webglAttached) attachWebGL(inst);

    // 2D map surface: Leaflet caches its pixel size and must be told when the container
    // changed, or tiles/overlays/markers position for the old size (the "satellite stuck
    // in a corner, units floating" symptom).
    var m = mapEl();
    if (m && m.style.display !== 'none' && window.MapModule && MapModule.getMap && MapModule.getMap()) {
      try { MapModule.invalidateSize(); } catch (e) {}
    }
  }

  // WebGL context-loss recovery. The single most important line here is preventDefault()
  // on 'webglcontextlost': it tells the browser we intend to recover, which is what allows
  // 'webglcontextrestored' to fire. three.js (r128) re-initialises its GL resources on
  // restore automatically; we just nudge a resize + data refresh and tell the operator.
  function attachWebGL(inst) {
    var canvas = null;
    try { canvas = inst.renderer && inst.renderer().domElement; } catch (e) {}
    if (!canvas) return;
    webglAttached = true;
    canvas.addEventListener('webglcontextlost', function (ev) {
      ev.preventDefault();
      try { if (window.showToast) showToast('GPU context interrupted — recovering the 3D view…', 'warn', 4500); } catch (e) {}
      try { if (window.addEvent) addEvent({ type: 'View', text: 'GPU context lost; recovering 3D view.' }); } catch (e) {}
    }, false);
    canvas.addEventListener('webglcontextrestored', function () {
      try { if (window.showToast) showToast('3D view restored.', 'success', 2500); } catch (e) {}
      schedule();
      try { if (inst.refresh) inst.refresh(); } catch (e) {}
    }, false);
  }

  // ---- Fullscreen ----------------------------------------------------------------
  function isFs() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function toggleFullscreen() {
    var el = appEl();
    if (!isFs()) {
      var req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) { try { req.call(el); } catch (e) {} }
    } else {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) { try { exit.call(document); } catch (e) {} }
    }
  }
  function syncFsButton() {
    var b = document.getElementById('stage-fs-btn');
    if (b) b.textContent = isFs() ? '⤢ Exit Full' : '⛶ Fullscreen';
  }

  // ---- Setup ---------------------------------------------------------------------
  function injectButton() {
    var css = document.createElement('style');
    css.textContent = [
      '#stage-fs-btn{position:fixed;top:14px;right:calc(var(--side-width, 360px) + 14px);z-index:1400;',
        'background:linear-gradient(180deg,#15324a,#0d2032);color:#dff1ff;border:1px solid #2c6f9b;',
        'padding:7px 13px;border-radius:8px;font:600 12px/1 system-ui,sans-serif;letter-spacing:.03em;',
        'cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.4);}',
      '#stage-fs-btn:hover{border-color:#4bb8ff;color:#fff;}',
      ':fullscreen #stage-fs-btn{right:14px;}'
    ].join('');
    document.head.appendChild(css);
    var btn = document.createElement('button');
    btn.id = 'stage-fs-btn';
    btn.type = 'button';
    btn.textContent = '⛶ Fullscreen';
    btn.title = 'Toggle full screen (F)';
    btn.addEventListener('click', toggleFullscreen);
    document.body.appendChild(btn);
  }

  function init() {
    injectButton();

    if (window.ResizeObserver) {
      ro = new ResizeObserver(schedule);
      // Observing #graph AND #map means we also catch the display:none -> block flip when
      // the operator switches views, so the surface that just appeared gets sized at once.
      var g = graphEl(), m = mapEl(), a = document.getElementById('app');
      if (g) ro.observe(g);
      if (m) ro.observe(m);
      if (a) ro.observe(a);
    }
    window.addEventListener('resize', schedule, { passive: true });
    document.addEventListener('fullscreenchange', function () { syncFsButton(); schedule(); });
    document.addEventListener('webkitfullscreenchange', function () { syncFsButton(); schedule(); });

    // Keyboard: F toggles fullscreen (ignored while typing in a field).
    document.addEventListener('keydown', function (e) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target || {};
      var tag = (t.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return;
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); }
    });

    // The graph/map are created asynchronously by the main script after load; a couple of
    // delayed kicks ensure we size and attach context-loss handlers once they exist.
    setTimeout(schedule, 300);
    setTimeout(schedule, 1200);
    setTimeout(schedule, 3000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { resize: schedule, toggleFullscreen: toggleFullscreen };
})();
