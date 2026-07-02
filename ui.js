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
 *
 * Security note (C-030): all user/import-controlled strings are rendered via DOM
 * textContent or setAttribute, never via innerHTML interpolation.  A shared escape
 * helper (UiModule.escapeHtml) is also exposed for HTML callers that must build their
 * own markup.
 */
window.UiModule = (function () {
  'use strict';

  // Event log buffer (owned here).
  let simEvents = [];

  // ─── C-030: shared HTML escape helper ────────────────────────────────────────
  // Converts the five characters that are meaningful in HTML/attribute contexts.
  // Exposed as UiModule.escapeHtml(str) for any HTML-building caller.
  // Safe to call with non-string values; always returns a string.
  function escapeHtml(str) {
    try {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    } catch (_) {
      return '';
    }
  }

  function showToast(message, type, timeout) {
    if (type === undefined) type = 'info';
    if (timeout === undefined) timeout = 4200;
    const container = document.getElementById('toast-container');
    if (!container || !message) return;
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(function () { try { el.remove(); } catch (_) {} }, timeout);
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

  // ─── C-030: build one event row via DOM APIs, never via innerHTML ─────────────
  // Known-safe structural markup (class names, data-idx) is set via DOM properties;
  // all user/import-controlled values go through textContent or setAttribute so they
  // cannot inject markup.
  function buildEventRow(e, idx) {
    const row = document.createElement('div');
    row.className = 'item';
    row.dataset.idx = idx;   // numeric — safe as a dataset value

    // Type badge — intentional, controlled formatting via className; text via textContent
    const typeBadge = document.createElement('span');
    typeBadge.className = 'type ' + eventTypeClass(e.type);
    typeBadge.textContent = String(e.type || '');
    row.appendChild(typeBadge);

    // Event text span — C-030: untrusted text, must use textContent
    const textSpan = document.createElement('span');
    const isFailure = e.type === 'Failed' && e.strikeName;
    if (isFailure) {
      textSpan.className = 'failed-event';
      // data-* attributes set via setAttribute so values are safely encoded
      textSpan.setAttribute('data-strike-name', String(e.strikeName || ''));
      textSpan.setAttribute('data-target-name', String(e.targetName || ''));
    }
    textSpan.textContent = String(e.text || '');
    row.appendChild(textSpan);

    // Timestamp — from our own Date object, not from imported data
    const meta = document.createElement('span');
    meta.className = 'meta';
    try { meta.textContent = e.time.toLocaleTimeString(); } catch (_) { meta.textContent = ''; }
    row.appendChild(meta);

    return row;
  }

  // ─── C-048: empty state + C-030: DOM-only render (no innerHTML on user data) ──
  function renderEventLog() {
    const list = document.getElementById('event-list');
    if (!list) return;

    // Clear existing children
    while (list.firstChild) { list.removeChild(list.firstChild); }

    const visible = simEvents.slice(0, 50);

    if (visible.length === 0) {
      // C-048: explicit empty state so the panel is never a blank void
      const empty = document.createElement('div');
      empty.className = 'item event-empty-state';
      const emptyText = document.createElement('span');
      emptyText.className = 'meta';
      emptyText.textContent = 'No events yet. Run a strike, import a scenario, or open Help to get started.';
      empty.appendChild(emptyText);
      list.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    for (let i = 0; i < visible.length; i++) {
      frag.appendChild(buildEventRow(visible[i], i));
    }
    list.appendChild(frag);
  }

  function toggleEventLog() {
    const el = document.getElementById('event-log');
    if (el) el.classList.toggle('collapsed');
  }

  // ─── C-048: preserve prior-session context on clear ──────────────────────────
  // Instead of silently wiping the buffer, inject a one-line summary event so the
  // operator can see that a reset occurred and how many events preceded it.
  function clearEventLog() {
    const priorCount = simEvents.length;
    simEvents = [];

    // Inject a reset marker so the log is never ambiguously empty after a clear.
    // This is our own synthetic event, so no user-controlled text is involved.
    var summary = priorCount > 0
      ? 'Simulation reset — previous session had ' + priorCount + ' event' + (priorCount === 1 ? '' : 's') + '.'
      : 'Simulation reset.';

    simEvents.push({
      type: 'Reset',
      text: summary,
      time: new Date()
    });

    renderEventLog();
  }

  // Resolve a clicked event-list row (data-idx) back to its event object.
  function getEvent(idx) { return simEvents[idx]; }

  const api = {
    showToast, addEvent, eventTypeClass, renderEventLog,
    toggleEventLog, clearEventLog, getEvent,
    escapeHtml   // C-030: exposed for HTML-building callers
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
