/*
 * shortcuts.js — Keyboard Shortcuts overlay (ShortcutsModule)  [CO-015]
 *
 * A small, self-contained, offline presentation module that makes the app's existing
 * (previously undiscoverable) keyboard shortcuts visible to players:
 *   - a round "⌨" launcher button (bottom-left, beside the "?" help button), and
 *   - a dismissible overlay opened with the "?" key.
 *
 * Design notes (matches house style):
 *   - No build step; attaches window.ShortcutsModule and self-initializes on load.
 *   - Injects its own CSS; no external assets; no network.
 *   - Never hijacks "?" while the user is typing in a field, and never opens on top of
 *     another modal/workflow layer (mirrors the shell's shortcut-scoping guards). The
 *     shell adds #shortcuts-overlay to its own guard so its shortcuts stay suppressed
 *     while this overlay is open.
 *   - Entrance animation is CSS-driven, so the global prefers-reduced-motion rule
 *     neutralizes it automatically.
 */
(function () {
  'use strict';

  var OVERLAY_ID = 'shortcuts-overlay';
  var BTN_ID = 'shortcuts-launch';

  // Source of truth for what is displayed. Grouped for scanability. Keep in sync with
  // the shell's keydown handler and the command-bar tablist.
  var GROUPS = [
    {
      title: 'Views',
      items: [
        { keys: ['3D', 'Map', 'Table', 'Task Org'], label: 'Switch view (top command bar)' },
        { keys: ['←', '→'], label: 'Move focus across the view tabs' },
        { keys: ['Enter'], label: 'Activate the focused view tab' }
      ]
    },
    {
      title: 'Simulation & selection',
      items: [
        { keys: ['M'], label: 'Run Monte Carlo trials' },
        { keys: ['Shift', 'M'], label: 'Toggle the map view' },
        { keys: ['R'], label: 'Reset the view' },
        { keys: ['Space'], label: 'Pause / resume the simulation clock' },
        { keys: ['[', ']'], label: 'Cycle the selected target' },
        { keys: ['Esc'], label: 'Deselect / close' }
      ]
    },
    {
      title: 'Help',
      items: [
        { keys: ['?'], label: 'Show or hide this shortcuts panel' }
      ]
    }
  ];

  var lastFocus = null;

  function injectStyles() {
    if (document.getElementById('shortcuts-style')) return;
    var st = document.createElement('style');
    st.id = 'shortcuts-style';
    st.textContent = [
      '#' + BTN_ID + '{position:fixed;bottom:16px;left:54px;z-index:1450;width:30px;height:30px;',
      'border-radius:50%;background:#13314a;color:#bfe4ff;border:1px solid #2c5f86;',
      "font:700 14px system-ui;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.45);}",
      '#' + BTN_ID + ':hover{border-color:#4bb8ff;color:#fff;}',
      '#' + BTN_ID + ':focus-visible{outline:2px solid #63d7ff;outline-offset:2px;}',
      '#' + OVERLAY_ID + '{position:fixed;inset:0;z-index:6100;display:none;align-items:center;justify-content:center;}',
      '#' + OVERLAY_ID + ' .sc-backdrop{position:absolute;inset:0;background:radial-gradient(130% 120% at 50% 0%,rgba(12,30,48,.70),rgba(3,8,14,.86));backdrop-filter:blur(3px);animation:scBackdropIn .35s ease both;}',
      '#' + OVERLAY_ID + ' .sc-panel{position:relative;width:min(520px,92vw);max-height:90vh;overflow:auto;',
      'background:linear-gradient(180deg,#0f2740,#0a1622);border:1px solid #2a5878;border-radius:16px;',
      'padding:22px 24px 18px;box-shadow:0 28px 80px rgba(0,0,0,.62),inset 0 0 0 1px rgba(99,215,255,.06);',
      "color:#cfe0ee;font-family:'Inter',system-ui,sans-serif;animation:scPanelIn .40s cubic-bezier(.2,.7,.25,1) both;}",
      '#' + OVERLAY_ID + ' .sc-panel::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;border-radius:16px 16px 0 0;',
      'background:linear-gradient(90deg,transparent,#37b6e6 20%,#63d7ff 50%,#37b6e6 80%,transparent);opacity:.9;}',
      '#' + OVERLAY_ID + ' .sc-head{display:flex;align-items:center;justify-content:space-between;gap:12px;',
      'padding-bottom:12px;border-bottom:1px solid rgba(99,215,255,.12);}',
      "#" + OVERLAY_ID + " .sc-title{font-family:'Oswald','Inter',system-ui,sans-serif;font-weight:700;letter-spacing:.14em;font-size:18px;color:#eaf4ff;text-shadow:0 0 18px rgba(99,215,255,.28);}",
      '#' + OVERLAY_ID + ' .sc-close{background:#10283b;border:1px solid #285476;color:#b8d8ec;border-radius:8px;min-height:32px;min-width:32px;cursor:pointer;font:600 15px system-ui;}',
      '#' + OVERLAY_ID + ' .sc-close:hover{border-color:#4b9bd0;color:#eef9ff;}',
      '#' + OVERLAY_ID + ' .sc-close:focus-visible{outline:2px solid #63d7ff;outline-offset:2px;}',
      '#' + OVERLAY_ID + ' .sc-group{margin-top:14px;}',
      '#' + OVERLAY_ID + ' .sc-group h3{margin:0 0 8px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#7fa6c4;}',
      '#' + OVERLAY_ID + ' .sc-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:6px 0;border-bottom:1px dashed rgba(99,215,255,.08);}',
      '#' + OVERLAY_ID + ' .sc-row:last-child{border-bottom:none;}',
      '#' + OVERLAY_ID + ' .sc-label{font-size:13px;color:#d3e3f0;}',
      '#' + OVERLAY_ID + ' .sc-keys{display:flex;gap:6px;flex-wrap:wrap;flex:0 0 auto;}',
      '#' + OVERLAY_ID + ' kbd{font-family:var(--mono,ui-monospace,monospace);font-size:11px;line-height:1;color:#eafbff;',
      'background:linear-gradient(180deg,rgba(23,50,74,.8),rgba(16,38,58,.8));border:1px solid #2e5f83;',
      'border-bottom-width:2px;border-radius:6px;padding:5px 8px;min-width:14px;text-align:center;}',
      '#' + OVERLAY_ID + ' .sc-hint{margin:14px 0 2px;font-size:11.5px;color:#8fb4d4;}',
      '@keyframes scBackdropIn{from{opacity:0}to{opacity:1}}',
      '@keyframes scPanelIn{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}'
    ].join('');
    document.head.appendChild(st);
  }

  function esc(s) {
    if (window.UiModule && UiModule.escapeHtml) return UiModule.escapeHtml(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function groupsHtml() {
    return GROUPS.map(function (g) {
      var rows = g.items.map(function (it) {
        var keys = it.keys.map(function (k) { return '<kbd>' + esc(k) + '</kbd>'; }).join('');
        return '<div class="sc-row"><span class="sc-label">' + esc(it.label) + '</span>' +
               '<span class="sc-keys">' + keys + '</span></div>';
      }).join('');
      return '<div class="sc-group"><h3>' + esc(g.title) + '</h3>' + rows + '</div>';
    }).join('');
  }

  function build() {
    if (document.getElementById(OVERLAY_ID)) return;
    injectStyles();

    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = '\u2328'; // keyboard glyph
    btn.setAttribute('aria-label', 'Keyboard shortcuts');
    btn.setAttribute('title', 'Keyboard shortcuts (press ?)');
    btn.addEventListener('click', toggle);
    document.body.appendChild(btn);

    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<div class="sc-backdrop"></div>' +
      '<div class="sc-panel" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabindex="-1">' +
        '<div class="sc-head"><div class="sc-title">KEYBOARD SHORTCUTS</div>' +
        '<button class="sc-close" type="button" aria-label="Close">\u00d7</button></div>' +
        groupsHtml() +
        '<p class="sc-hint">Tip: shortcuts pause while you are typing in a field or another panel is open.</p>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.querySelector('.sc-backdrop').addEventListener('click', close);
    overlay.querySelector('.sc-close').addEventListener('click', close);
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
  }

  function isOpen() {
    var o = document.getElementById(OVERLAY_ID);
    return !!o && o.style.display === 'flex';
  }

  function open() {
    build();
    var o = document.getElementById(OVERLAY_ID);
    if (!o) return;
    lastFocus = document.activeElement;
    o.style.display = 'flex';
    o.setAttribute('aria-hidden', 'false');
    var panel = o.querySelector('.sc-panel');
    if (panel) { try { panel.focus(); } catch (e) {} }
  }

  function close() {
    var o = document.getElementById(OVERLAY_ID);
    if (!o) return;
    o.style.display = 'none';
    o.setAttribute('aria-hidden', 'true');
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} lastFocus = null; }
  }

  function toggle() { if (isOpen()) close(); else open(); }

  // Do not steal "?" while the user is typing, or while another modal/workflow layer is up.
  function typingTarget(t) {
    if (!t) return false;
    var tag = (t.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (t.isContentEditable) return true;
    var role = t.getAttribute && t.getAttribute('role');
    return role === 'textbox' || role === 'searchbox' || role === 'combobox';
  }

  function otherLayerOpen() {
    var sel = '.modal-backdrop, #first-run-card, #dir-overlay';
    return Array.prototype.some.call(document.querySelectorAll(sel), function (el) {
      var s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden';
    });
  }

  function onKeydown(e) {
    if (e.key !== '?') return;
    if (isOpen()) return; // its own Escape/close handles dismissal
    if (typingTarget(e.target) || otherLayerOpen()) return;
    e.preventDefault();
    open();
  }

  function init() {
    build();
    // Capture phase so we can decide before the shell's own global shortcut handler.
    document.addEventListener('keydown', onKeydown, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.ShortcutsModule = { open: open, close: close, toggle: toggle, isOpen: isOpen };
})();
