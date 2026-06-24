/*
 * ui.js — UI notification primitives for the MDSC 3D Network Visualizer.
 *
 * Fourth modularization step. Owns the two cross-cutting, self-contained presentational
 * subsystems that the whole app fires into:
 *   - Toasts (showToast): transient corner notifications.
 *   - Event log (addEvent + render/toggle/clear): the running activity feed; owns the
 *     simEvents buffer.
 *
 * These are pure presentation with no app-state coupling, so they extract cleanly. They
 * are called from everywhere — the main script (35× addEvent, 14× showToast) AND the
 * other modules (map.js tile errors, engine.js globe fallback, inline-datasets.js
 * auto-load). To keep every one of those call sites working unchanged, this module
 * aliases its functions onto their original global names at load time. It loads first
 * in <head>, so the globals exist before any other script runs.
 *
 * Two accessors exist for the rare places that touched the simEvents buffer directly:
 *   - clearEventLog()  — used by resetApplicationState
 *   - getEvent(idx)    — used by the event-list click handler to resolve a clicked row
 */
window.UiModule = (function () {
  'use strict';

  // Event log buffer (owned here).
  let simEvents = [];

  function showToast(message, type, timeout) {
    if (type === undefined) type = 'info';
    if (timeout === undefined) timeout = 4200;
    const container = document.getElementById('toast-container');
    if (!container || !message) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), timeout);
  }

  function addEvent(evt) {
    evt.time = new Date();
    simEvents.unshift(evt);
    if (simEvents.length > 100) simEvents.pop();
    renderEventLog();
  }

  function eventTypeClass(type) {
    const t = String(type || '').toLowerCase();
    if (t.includes('success')) return 'success';
    if (t.includes('fail')) return 'fail';
    return 'warning';
  }

  function renderEventLog() {
    const list = document.getElementById('event-list');
    if (!list) return;
    list.innerHTML = simEvents.slice(0, 50).map((e, idx) => {
      const isFailure = e.type === 'Failed' && e.strikeName;
      const failureClass = isFailure ? 'failed-event' : '';
      const failureAttrs = isFailure ? `data-strike-name="${e.strikeName}" data-target-name="${e.targetName}"` : '';
      return `
    <div class="item" data-idx="${idx}">
    <span class="type ${eventTypeClass(e.type)}">${e.type}</span>
    <span class="${failureClass}" ${failureAttrs}>${e.text || ''}</span>
    <span class="meta">${e.time.toLocaleTimeString()}</span>
    </div>`;
    }).join('');
  }

  function toggleEventLog() { document.getElementById('event-log').classList.toggle('collapsed'); }
  function clearEventLog() { simEvents = []; renderEventLog(); }

  // Resolve a clicked event-list row (data-idx) back to its event object.
  function getEvent(idx) { return simEvents[idx]; }

  const api = {
    showToast, addEvent, eventTypeClass, renderEventLog,
    toggleEventLog, clearEventLog, getEvent
  };

  // Publish onto the original global names so existing call sites (in the main script
  // and the other modules) keep working without edits. Done at load time, not in init().
  window.showToast = showToast;
  window.addEvent = addEvent;
  window.eventTypeClass = eventTypeClass;
  window.renderEventLog = renderEventLog;
  window.toggleEventLog = toggleEventLog;
  window.clearEventLog = clearEventLog;

  return api;
})();
