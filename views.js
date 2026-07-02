/*
 * views.js — alternate render views (data table + task-org chart) for the
 * MDSC 3D Network Visualizer.
 *
 * Sixth modularization step. Owns the two self-contained presentational renderers
 * that draw the visible node set into their own DOM containers, like the map module:
 *   - Table (refreshTable + displayStatusForRow) -> #nodes-table
 *   - Task-org / wire diagram (buildOrgTree, renderOrgChart, fitOrgChartToView,
 *     drawMilBox, drawSymbol) -> #org-chart  (D3 hierarchy + military-symbol boxes)
 *
 * The app-level mode flags (tableModeEnabled/orgModeEnabled) and the mode toggles stay
 * in the main script (orchestration). Shared functions these renderers call
 * (currentVisible, resolveCssVar, colorFromTeam, teamLabel, selectNodeById,
 * toggleOrgTeam, d3) are already global. The few script-scoped state values they read
 * are injected via ViewsModule.init(ctx). orgExpandedTeams (the per-team expand state,
 * mutated by the main toggles) is shared via window.orgExpandedTeams. Public renderers
 * self-alias to their original global names so existing call sites keep working.
 *
 * C-026: Table headers keyboard-operable (Enter/Space), rows keyboard-selectable
 *        (roving tabindex), org-chart nodes keyboard-focusable/activatable.
 * C-034: "Analysis columns" toggle that reveals cascScore, resourceGen, subsystem,
 *        vulnerabilities, and precise coordinates. Default view stays lean.
 * C-051: Teams derived from visible nodes (not hard-coded), per-branch collapse/focus,
 *        and a compact legend strip.
 */
window.ViewsModule = (function () {
  'use strict';

  // org-chart zoom behavior (module-internal, lazily created)
  let orgZoomBehavior = null;
  // Domain-bucket ids the user has expanded (buckets are collapsed by default so the
  // initial view is a clean command skeleton, not a wall of unit cards).
  let orgExpandedGroups = new Set();

  // Injected accessors for script-scoped state; safe defaults until init().
  let ctx = {
    getSelectedNode: () => null,
    getHighlightMode: () => null,
    getHighlightSet: () => new Set()
  };
  function init(context) { ctx = Object.assign({}, ctx, context || {}); }

  // --- Table sort state ---
  // Column index (0-based) and direction for the active sort.
  let sortCol = -1;   // -1 = no active sort
  let sortAsc = true;

  // --- Analysis-columns toggle state (C-034) ---
  // When true, extra columns (cascScore, resourceGen, subsystem, vulnerabilities,
  // precise coords) are appended after the base columns.
  let analysisMode = false;

  // Base columns: ID, Name, Team, Domain, Type, Health, Status, Importance, Difficulty, Coords
  // Columns that sort numerically (by index matching the th order).
  // 0=ID 1=Name 2=Team 3=Domain 4=Type 5=Health 6=Status 7=Importance 8=Difficulty 9=Coords
  // Analysis cols (only when analysisMode): 10=Casc 11=Resources 12=Subsystem 13=Vulns 14=Precise Coords
  const NUMERIC_COLS = new Set([5, 7, 10, 11]);  // Health, Importance, CascScore, ResourceGen

  // Wire up click handlers on thead <th> elements once the DOM is ready.
  // Called lazily on first refreshTable so we don't need a DOMContentLoaded hook.
  let sortHeadersWired = false;

  // --- C-034: inject analysis-toggle toolbar above the table ---
  // Injected once; removed and re-injected if the #nodes-table container changes.
  let analysisToolbarEl = null;
  function ensureAnalysisToolbar() {
    const table = document.getElementById('nodes-table');
    if (!table) return;
    const wrap = table.closest('.table-wrap') || table.parentElement;
    if (!wrap) return;
    // Only inject once; check by id
    if (wrap.querySelector('#analysis-toggle-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'analysis-toggle-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Table column presets');
    bar.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:8px',
      'padding:6px 2px 8px',
      'font-size:11px',
      'color:var(--muted)',
      'font-family:var(--mono)',
      'flex-wrap:wrap'
    ].join(';');

    const label = document.createElement('span');
    label.textContent = 'COLUMNS:';
    label.setAttribute('aria-hidden', 'true');
    bar.appendChild(label);

    // "Default" preset pill
    const btnDefault = document.createElement('button');
    btnDefault.type = 'button';
    btnDefault.id = 'analysis-btn-default';
    btnDefault.setAttribute('aria-pressed', 'true');
    btnDefault.textContent = 'Default';
    _stylePresetBtn(btnDefault, true);
    btnDefault.addEventListener('click', () => {
      analysisMode = false;
      _updatePresetBtns();
      sortHeadersWired = false;
      refreshTable();
    });
    btnDefault.addEventListener('keydown', _presetBtnKeydown);
    bar.appendChild(btnDefault);

    // "Analysis" preset pill
    const btnAnalysis = document.createElement('button');
    btnAnalysis.type = 'button';
    btnAnalysis.id = 'analysis-btn-analysis';
    btnAnalysis.setAttribute('aria-pressed', 'false');
    btnAnalysis.textContent = '+ Analysis';
    _stylePresetBtn(btnAnalysis, false);
    btnAnalysis.addEventListener('click', () => {
      analysisMode = true;
      _updatePresetBtns();
      sortHeadersWired = false;
      refreshTable();
    });
    btnAnalysis.addEventListener('keydown', _presetBtnKeydown);
    bar.appendChild(btnAnalysis);

    const hint = document.createElement('span');
    hint.style.cssText = 'margin-left:4px;color:var(--muted);opacity:.65';
    hint.textContent = analysisMode
      ? '(Cascade · Resources · Subsystem · Vulns · Precise Coords shown)'
      : '(click "+ Analysis" to reveal cascade, resources, subsystem, vulns)';
    hint.id = 'analysis-toggle-hint';
    bar.appendChild(hint);

    analysisToolbarEl = bar;
    wrap.insertBefore(bar, table);
  }

  function _stylePresetBtn(btn, active) {
    btn.style.cssText = [
      'cursor:pointer',
      'padding:2px 8px',
      'border-radius:12px',
      'font-size:11px',
      'font-family:var(--mono)',
      'font-weight:600',
      'letter-spacing:.04em',
      'transition:background .15s,color .15s',
      active
        ? 'background:var(--accent);color:#000;border:1px solid var(--accent)'
        : 'background:transparent;color:var(--muted);border:1px solid var(--border)'
    ].join(';');
  }

  function _updatePresetBtns() {
    const btnD = document.getElementById('analysis-btn-default');
    const btnA = document.getElementById('analysis-btn-analysis');
    const hint = document.getElementById('analysis-toggle-hint');
    if (btnD) {
      btnD.setAttribute('aria-pressed', analysisMode ? 'false' : 'true');
      _stylePresetBtn(btnD, !analysisMode);
    }
    if (btnA) {
      btnA.setAttribute('aria-pressed', analysisMode ? 'true' : 'false');
      _stylePresetBtn(btnA, analysisMode);
    }
    if (hint) {
      hint.textContent = analysisMode
        ? '(Cascade · Resources · Subsystem · Vulns · Precise Coords shown)'
        : '(click "+ Analysis" to reveal cascade, resources, subsystem, vulns)';
    }
  }

  // Allow arrow-key navigation between the two preset buttons (roving within toolbar).
  function _presetBtnKeydown(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const bar = document.getElementById('analysis-toggle-bar');
      if (!bar) return;
      const btns = Array.from(bar.querySelectorAll('button'));
      const idx = btns.indexOf(e.currentTarget);
      if (idx < 0) return;
      const next = btns[(idx + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length];
      if (next) { e.preventDefault(); next.focus(); }
    }
  }

  // --- C-026: wire sort headers with keyboard support ---
  function wireSortHeaders() {
    const table = document.getElementById('nodes-table');
    if (!table) return;
    const ths = table.querySelectorAll('thead th');
    ths.forEach((th, idx) => {
      // Remove old listeners by cloning the node (safe: no child state to preserve)
      const fresh = th.cloneNode(true);
      th.parentNode.replaceChild(fresh, th);
    });

    // Re-query after clone replacements
    const freshThs = table.querySelectorAll('thead th');
    freshThs.forEach((th, idx) => {
      th.style.cursor = 'pointer';
      // Make th keyboard-reachable (C-026)
      th.setAttribute('tabindex', '0');
      th.setAttribute('role', 'columnheader');
      th.setAttribute('aria-sort', 'none');
      th.setAttribute('title', 'Click, Enter, or Space to sort');

      function doSort() {
        if (sortCol === idx) {
          sortAsc = !sortAsc;
        } else {
          sortCol = idx;
          sortAsc = true;
        }
        _updateSortIndicators(freshThs);
        refreshTable();
      }

      th.addEventListener('click', doSort);
      // C-026: Enter/Space activates sort on focused header
      th.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          doSort();
        }
        // Allow left/right arrow to move focus between headers
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          const next = freshThs[idx + 1];
          if (next) next.focus();
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          const prev = freshThs[idx - 1];
          if (prev) prev.focus();
        }
      });
    });

    // Apply current sort indicators (if any active sort)
    _updateSortIndicators(freshThs);
    sortHeadersWired = true;
  }

  function _updateSortIndicators(ths) {
    ths.forEach((h, i) => {
      h.removeAttribute('aria-sort');
      h.setAttribute('aria-sort', 'none');
      const old = h.querySelector('.sort-caret');
      if (old) old.remove();
      if (i === sortCol) {
        h.setAttribute('aria-sort', sortAsc ? 'ascending' : 'descending');
        const caret = document.createElement('span');
        caret.className = 'sort-caret';
        caret.textContent = sortAsc ? ' ▲' : ' ▼';
        caret.setAttribute('aria-hidden', 'true');
        h.appendChild(caret);
      }
    });
  }

  // --- Table view ---
  function displayStatusForRow(n) {
    if (ctx.getHighlightMode() === 'coa' && ctx.getHighlightSet() && ctx.getHighlightSet().has(n.id)) return 'Likely Neutralized';
    if (ctx.getHighlightMode() === 'payoff' && ctx.getHighlightSet() && ctx.getHighlightSet().has(n.id)) return 'High Payoff';
    if (ctx.getHighlightMode() === 'risk' && ctx.getHighlightSet() && ctx.getHighlightSet().has(n.id)) return 'High Risk';
    return n.status || 'Active';
  }

  // Resolve a CSS variable value (from :root) as a raw string.
  // Falls back to tryResolveCssVar or the raw token if the global helper is unavailable.
  function getCssVar(name) {
    try {
      if (typeof resolveCssVar === 'function') return resolveCssVar('var(' + name + ')');
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || name;
    } catch (e) {
      return name;
    }
  }

  // Health percentage → color using canonical design-system tokens.
  // high (>66%) → --aff-neutral (green), mid (>33%) → --amber, low → --alert (red).
  function healthColor(pct) {
    if (pct > 66) return 'var(--aff-neutral)';
    if (pct > 33) return 'var(--amber)';
    return 'var(--alert)';
  }

  // Status text → badge color.
  function statusColor(statusText) {
    const s = (statusText || '').toLowerCase();
    if (s === 'active') return 'var(--aff-neutral)';
    if (s.includes('high payoff')) return 'var(--amber)';
    if (s.includes('high risk')) return 'var(--alert)';
    if (s.includes('neutralized') || s.includes('destroyed')) return 'var(--alert)';
    return 'var(--muted)';
  }

  // Team name → canonical affiliation CSS variable.
  function teamAffColor(team) {
    const t = (team || '3rd_party').toLowerCase();
    if (t === 'blue') return 'var(--aff-friend)';
    if (t === 'red') return 'var(--aff-hostile)';
    if (t === 'green') return 'var(--aff-neutral)';
    if (t === 'yellow') return 'var(--aff-unknown)';
    return 'var(--team-3rd_party, #bfc9d4)';
  }

  // Extract a sortable value from a row data-node by column index.
  function sortKey(n, colIdx) {
    switch (colIdx) {
      case 0: return String(n.id || '');
      case 1: return (n.name || '').toLowerCase();
      case 2: return (n.team || '3rd_party').toLowerCase();
      case 3: return ((n.domain || []).join(', ')).toLowerCase();
      case 4: return (n.type || '').toLowerCase();
      case 5: { // Health (numeric %)
        const hm = n.healthMax || 100;
        return Math.max(0, Math.min(100, Math.round((n.health / hm) * 100)));
      }
      case 6: return (n.status || 'active').toLowerCase();
      case 7: return Number(n.importance) || 0;
      case 8: return (n.difficulty || '').toLowerCase();
      case 9: return (n.lat != null) ? Number(n.lat) : -Infinity;
      // Analysis columns (C-034)
      case 10: return Number(n.cascScore) || 0;          // Cascade score (numeric)
      case 11: return Number(n.resourceGen) || 0;        // Resources (numeric)
      case 12: return (n.subsystem || '').toLowerCase(); // Subsystem
      case 13: return ((n.vulnerabilities || []).length); // Vuln count (numeric proxy)
      case 14: return (n.lat != null) ? Number(n.lat) : -Infinity; // Precise coords
      default: return '';
    }
  }

  // --- C-026: roving-tabindex state for table rows ---
  // Tracks which row (data-id) currently holds tabindex="0" so the user can
  // re-enter the row list without Tab-through-every-row overhead.
  let _focusedRowId = null;

  function _wireRowKeyboard(tbody) {
    const rows = Array.from(tbody.querySelectorAll('tr[data-id]'));
    if (!rows.length) return;

    // Roving tabindex: exactly one row at a time has tabindex="0"; rest get "-1".
    // Restore focus to the previously-focused row if it still exists, else first row.
    const focusTarget = _focusedRowId
      ? (rows.find(r => r.getAttribute('data-id') === _focusedRowId) || rows[0])
      : rows[0];

    rows.forEach(r => {
      r.setAttribute('tabindex', r === focusTarget ? '0' : '-1');
      r.setAttribute('role', 'row');
      // aria-selected reflects whether this is the currently-selected node
      const id = r.getAttribute('data-id');
      const sel = ctx.getSelectedNode && ctx.getSelectedNode();
      r.setAttribute('aria-selected', (sel && String(sel.id) === String(id)) ? 'true' : 'false');
    });

    rows.forEach((row, idx) => {
      // Remove stale listeners (rows are rebuilt via innerHTML; listeners are fresh)
      row.addEventListener('click', () => {
        _setFocusedRow(rows, row);
        selectNodeById(row.getAttribute('data-id'));
      });

      // C-026: Enter/Space selects the focused row; arrow keys move between rows
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          _setFocusedRow(rows, row);
          selectNodeById(row.getAttribute('data-id'));
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          const next = rows[idx + 1];
          if (next) { _setFocusedRow(rows, next); next.focus(); }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prev = rows[idx - 1];
          if (prev) { _setFocusedRow(rows, prev); prev.focus(); }
        } else if (e.key === 'Home') {
          e.preventDefault();
          _setFocusedRow(rows, rows[0]);
          rows[0].focus();
        } else if (e.key === 'End') {
          e.preventDefault();
          const last = rows[rows.length - 1];
          _setFocusedRow(rows, last);
          last.focus();
        }
      });

      row.addEventListener('focus', () => {
        _focusedRowId = row.getAttribute('data-id');
      });
    });
  }

  function _setFocusedRow(rows, target) {
    rows.forEach(r => r.setAttribute('tabindex', '-1'));
    target.setAttribute('tabindex', '0');
    _focusedRowId = target.getAttribute('data-id');
  }

  // --- C-034: build the analysis-columns <th> header cells ---
  function _analysisHeaders() {
    return [
      '<th tabindex="0" role="columnheader" aria-sort="none" title="Cascading failure score — click to sort" style="color:var(--amber)">Casc▸</th>',
      '<th tabindex="0" role="columnheader" aria-sort="none" title="Resource generation — click to sort" style="color:var(--accent)">Res▸</th>',
      '<th tabindex="0" role="columnheader" aria-sort="none" title="Subsystem">Subsystem</th>',
      '<th tabindex="0" role="columnheader" aria-sort="none" title="Vulnerabilities">Vulns</th>',
      '<th tabindex="0" role="columnheader" aria-sort="none" title="Precise coordinates (lat, lon)">Precise Coords</th>'
    ].join('');
  }

  // --- C-034: render analysis cells for a node ---
  function _analysisCells(n) {
    const casc = Number(n.cascScore) || 0;
    const cascColor = casc >= 3 ? 'var(--alert)' : casc >= 1.5 ? 'var(--amber)' : 'var(--muted)';
    const cascCell = `<td style="font-family:var(--mono);color:${cascColor}">${casc.toFixed(1)}</td>`;

    const resGen = Number(n.resourceGen) || 0;
    const resCell = `<td style="font-family:var(--mono);color:var(--accent)">${resGen}</td>`;

    const sub = n.subsystem || '—';
    const subCell = `<td style="color:var(--muted)">${sub}</td>`;

    const vulns = Array.isArray(n.vulnerabilities) ? n.vulnerabilities : [];
    const vulnColor = vulns.length >= 2 ? 'var(--alert)' : vulns.length === 1 ? 'var(--amber)' : 'var(--muted)';
    const vulnTitle = vulns.length ? vulns.join(', ') : 'None';
    const vulnCell = `<td><span title="${vulnTitle}" style="cursor:default;color:${vulnColor};font-family:var(--mono)">${vulns.length ? vulns.slice(0,2).join(', ') + (vulns.length > 2 ? ' +' + (vulns.length - 2) : '') : '—'}</span></td>`;

    const precCoords = (n.lat != null && n.lon != null)
      ? `${Number(n.lat).toFixed(5)}, ${Number(n.lon).toFixed(5)}`
      : '—';
    const precCell = `<td style="font-family:var(--mono);color:var(--muted);font-size:10px">${precCoords}</td>`;

    return cascCell + resCell + subCell + vulnCell + precCell;
  }

  function refreshTable() {
    // Ensure analysis toolbar exists (idempotent)
    ensureAnalysisToolbar();

    // Wire sort headers on first call (or after column preset change reset it)
    if (!sortHeadersWired) wireSortHeaders();

    const table = document.getElementById('nodes-table');
    const tbody = table ? table.querySelector('tbody') : null;
    if (!tbody) return;

    // --- C-034: sync thead to current column preset ---
    const thead = table.querySelector('thead tr');
    if (thead) {
      // Base headers always come from HTML; add/remove analysis headers dynamically
      // Count existing ths; analysis cols start at index 10
      const existingThs = thead.querySelectorAll('th');
      // Remove analysis cols if too many (> 10) and not in analysis mode
      if (existingThs.length > 10 && !analysisMode) {
        Array.from(existingThs).slice(10).forEach(th => th.remove());
        sortHeadersWired = false; // re-wire after structural change
        wireSortHeaders();
      } else if (existingThs.length <= 10 && analysisMode) {
        thead.insertAdjacentHTML('beforeend', _analysisHeaders());
        sortHeadersWired = false;
        wireSortHeaders();
      }
    }

    const { visibleNodes } = currentVisible();

    // Sort if a column is active.
    let sorted = visibleNodes.slice();
    if (sortCol >= 0) {
      sorted.sort((a, b) => {
        const ka = sortKey(a, sortCol);
        const kb = sortKey(b, sortCol);
        let cmp;
        if (NUMERIC_COLS.has(sortCol) || typeof ka === 'number') {
          cmp = ka - kb;
        } else {
          cmp = String(ka) < String(kb) ? -1 : String(ka) > String(kb) ? 1 : 0;
        }
        return sortAsc ? cmp : -cmp;
      });
    }

    const rows = sorted.map(n => {
      const healthMax = n.healthMax || 100;
      const healthPct = Math.max(0, Math.min(100, Math.round((n.health / healthMax) * 100)));
      const statusText = displayStatusForRow(n);
      const dom = (n.domain || []).join(', ');
      const coords = (n.lat != null && n.lon != null)
        ? `${Number(n.lat).toFixed(2)}, ${Number(n.lon).toFixed(2)}`
        : '';
      const trClass = (ctx.getHighlightMode() && ctx.getHighlightSet() && ctx.getHighlightSet().size)
        ? (ctx.getHighlightSet().has(n.id) ? 'row-highlight' : 'row-dim')
        : '';

      const sel = ctx.getSelectedNode && ctx.getSelectedNode();
      const isSelected = sel && String(sel.id) === String(n.id);

      // --- Health cell: small inline bar + colored mono text ---
      const hColor = healthColor(healthPct);
      const healthCell = `<span style="display:inline-flex;align-items:center;gap:6px;font-family:var(--mono)">` +
        `<span style="display:inline-block;width:40px;height:5px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden">` +
        `<span style="display:block;width:${healthPct}%;height:100%;background:${hColor};border-radius:3px;transition:width .2s"></span>` +
        `</span>` +
        `<span style="color:${hColor}">${healthPct}%</span>` +
        `</span>`;

      // --- Status badge with affiliation-derived color ---
      const sColor = statusColor(statusText);
      const statusCell = `<span class="status-badge" style="border-color:${sColor};color:${sColor}">${statusText}</span>`;

      // --- Team cell with canonical affiliation color ---
      const affColor = teamAffColor(n.team);
      const teamLabel2 = (n.team || '3rd_party').replace('_', ' ');
      const teamCell = `<span style="display:inline-flex;align-items:center;gap:5px">` +
        `<span class="swatch" style="background:${affColor};display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0"></span>` +
        `<span style="color:${affColor};font-family:var(--mono)">${teamLabel2}</span>` +
        `</span>`;

      // C-034: analysis cells only when mode is on
      const analysisCols = analysisMode ? _analysisCells(n) : '';

      // C-026: row is keyboard-reachable via roving tabindex (applied in _wireRowKeyboard)
      return `
        <tr class="${trClass}" data-id="${n.id}" role="row" aria-selected="${isSelected ? 'true' : 'false'}">
          <td style="font-family:var(--mono);color:var(--muted)">${n.id}</td>
          <td>${n.name || ''}</td>
          <td>${teamCell}</td>
          <td>${dom}</td>
          <td>${n.type || ''}</td>
          <td>${healthCell}</td>
          <td>${statusCell}</td>
          <td style="font-family:var(--mono)">${n.importance ?? ''}</td>
          <td>${n.difficulty || ''}</td>
          <td style="font-family:var(--mono);color:var(--muted)">${coords}</td>
          ${analysisCols}
        </tr>`;
    }).join('');

    tbody.innerHTML = rows;

    // C-026: wire keyboard navigation on rows (roving tabindex + Enter/Space/Arrow)
    _wireRowKeyboard(tbody);
  }

  // --- Task-org / wire diagram ---
  // Echelon rank parsed from name/type: 0 = theater/joint command, 1 = army/corps/fleet,
  // 2 = division/brigade/flotilla/regiment, 3 = battalion/squadron/site/unit. Lower = higher
  // echelon. Used to build a real command hierarchy instead of a flat fan of every HQ.
  function echelonRank(n) {
    const s = (String(n.name || '') + ' ' + String(n.type || '') + ' ' + String(n.subsystem || '')).toLowerCase();
    if (/theater command|joint operations|\bjoc\b|\bcmc\b|combatant|indo-?pacific command|national|strategic command/.test(s)) return 0;
    if (/group army|\bcorps\b|\bfleet\b|army hq|navy hq|air force hq|\bmaf\b|expeditionary force|theater\b|district/.test(s)) return 1;
    if (/division|brigade|flotilla|regiment|wing\b|\bgroup\b|base command/.test(s)) return 2;
    if (/battalion|company|squadron|battery|platoon|\bteam\b|\bcell\b|\bsite\b|station|detachment|element|post/.test(s)) return 3;
    return /command|hq|headquarters/.test(s) ? 1 : 3;   // unknown commands sit mid, units leaf
  }

  const ORG_MAX_BREADTH = 7;   // cap children per parent; overflow rolls into a "+N more" node

  function buildOrgTree(team, visibleNodes, visibleLinks, expanded) {
    const teamNodes = visibleNodes.filter(n => (n.team || '3rd_party') === team);
    const root = { name: `${teamLabel(team)} Task Org`, id: `${team}-root`, team, expanded, children: [] };
    if (!expanded || !teamNodes.length) {
      if (!teamNodes.length) root.children.push({ name: 'No nodes', id: `${team}-none`, children: [] });
      return root;
    }
    const idToNode = new Map(teamNodes.map(n => [n.id, n]));
    const adj = new Map(teamNodes.map(n => [n.id, []]));
    visibleLinks.forEach(l => {
      const s = l.source?.id ?? l.source, t = l.target?.id ?? l.target;
      if (adj.has(s) && adj.has(t)) { adj.get(s).push(t); adj.get(t).push(s); }
    });
    const val = (n) => (n.importance || 5) * (n.cascScore || 1);
    const rank = (n) => echelonRank(n);

    // Single team anchor: highest echelon, then most-connected, then highest value.
    const anchor = teamNodes.slice().sort((a, b) =>
      rank(a) - rank(b) || (adj.get(b.id).length - adj.get(a.id).length) || val(b) - val(a))[0];

    // Assign each non-anchor node a parent: a LINKED node of strictly higher echelon if one
    // exists (closest echelon wins), else the nearest higher-echelon node by value. Process
    // by ascending rank so a parent is always placed before its children.
    const parentOf = new Map([[anchor.id, null]]);
    teamNodes.filter(n => n.id !== anchor.id)
      .sort((a, b) => rank(a) - rank(b) || val(b) - val(a))
      .forEach(n => {
        const r = rank(n);
        const linked = adj.get(n.id).map(id => idToNode.get(id)).filter(p => p && rank(p) < r);
        let parent = linked.sort((a, b) => rank(b) - rank(a) || val(b) - val(a))[0];
        if (!parent) {
          parent = teamNodes.filter(p => p.id !== n.id && rank(p) < r)
            .sort((a, b) => (Math.abs((r - 1) - rank(a)) - Math.abs((r - 1) - rank(b))) || val(b) - val(a))[0] || anchor;
        }
        parentOf.set(n.id, parent.id);
      });

    const childIds = new Map(teamNodes.map(n => [n.id, []]));
    parentOf.forEach((pid, id) => { if (pid && childIds.has(pid)) childIds.get(pid).push(id); });

    const mk = (n) => ({ name: n.name || n.id, id: n.id, data: n, children: [] });
    const hasKids = (id) => (childIds.get(id) || []).length > 0;
    const buildNode = (id) => {
      const node = mk(idToNode.get(id));
      const kids = (childIds.get(id) || []).map(k => idToNode.get(k))
        .sort((a, b) => rank(a) - rank(b) || val(b) - val(a));
      if (kids.length <= ORG_MAX_BREADTH) {
        node.children = kids.map(k => buildNode(k.id));
        return node;
      }
      // Too many children: keep sub-commands (nodes that themselves have children) as real
      // branches, and group the remaining leaf units into labeled DOMAIN buckets so nothing
      // is hidden and breadth stays bounded and meaningful.
      const subCommands = kids.filter(k => hasKids(k.id));
      const leaves = kids.filter(k => !hasKids(k.id));
      node.children = subCommands.map(k => buildNode(k.id));
      const byDom = {};
      leaves.forEach(k => { const dom = (k.domain && k.domain[0]) || 'Other'; (byDom[dom] = byDom[dom] || []).push(k); });
      Object.keys(byDom).sort().forEach(dom => {
        const arr = byDom[dom].sort((a, b) => val(b) - val(a));
        if (arr.length <= 3) { arr.forEach(k => node.children.push(mk(k))); return; }
        const gid = `${id}-grp-${dom}`;
        const g = { name: `${dom} units`, id: gid, team, group: true, count: arr.length, children: [] };
        if (orgExpandedGroups.has(gid)) g.children = arr.map(mk); else g.collapsed = true;
        node.children.push(g);
      });
      return node;
    };
    root.children.push(buildNode(anchor.id));
    return root;
  }

  // --- C-051: derive teams from visibleNodes (not hard-coded) ---
  // Blue/Red are pinned first; any additional affiliations follow alphabetically.
  function _deriveTeams(visibleNodes) {
    const seen = new Set();
    visibleNodes.forEach(n => seen.add(n.team || '3rd_party'));
    const pinned = ['blue', 'red'].filter(t => seen.has(t));
    const rest = Array.from(seen).filter(t => t !== 'blue' && t !== 'red').sort();
    return [...pinned, ...rest];
  }

  // --- C-051: render a compact legend strip into the org-chart wrapper ---
  function _renderOrgLegend(wrap, teams) {
    // Remove stale legend
    const old = wrap.querySelector('#org-legend');
    if (old) old.remove();

    const legend = document.createElement('div');
    legend.id = 'org-legend';
    legend.setAttribute('role', 'note');
    legend.setAttribute('aria-label', 'Task-org chart legend');
    legend.style.cssText = [
      'display:flex',
      'flex-wrap:wrap',
      'gap:12px',
      'align-items:center',
      'padding:5px 10px 4px',
      'font-size:10px',
      'font-family:var(--mono)',
      'color:var(--muted)',
      'border-bottom:1px solid var(--border)',
      'background:rgba(0,0,0,.25)'
    ].join(';');

    const items = [
      { label: 'Card', style: 'display:inline-block;width:14px;height:9px;border-radius:2px;border:1px solid var(--muted);background:rgba(255,255,255,.05)', desc: 'Unit node' },
      { label: 'Health bar', style: 'display:inline-block;width:18px;height:4px;border-radius:2px;background:linear-gradient(90deg,var(--alert) 33%,var(--amber) 66%,var(--aff-neutral) 100%)', desc: 'Low→High' },
      { label: 'Dashed border', style: 'display:inline-block;width:14px;height:9px;border-radius:2px;border:1px dashed var(--muted)', desc: 'Domain bucket (click to expand)' },
    ];

    // Affiliation swatches
    teams.forEach(team => {
      const color = team === 'blue' ? 'var(--aff-friend)'
        : team === 'red' ? 'var(--aff-hostile)'
        : team === 'green' ? 'var(--aff-neutral)'
        : team === 'yellow' ? 'var(--aff-unknown)'
        : 'var(--team-3rd_party, #bfc9d4)';
      items.push({ label: team.replace('_', ' '), style: `display:inline-block;width:8px;height:8px;border-radius:50%;background:${color}`, desc: `${team} affiliation` });
    });

    items.forEach(({ label, style, desc }) => {
      const span = document.createElement('span');
      span.style.cssText = 'display:inline-flex;align-items:center;gap:5px';
      span.title = desc;
      span.innerHTML = `<span style="${style}" aria-hidden="true"></span><span>${label}</span>`;
      legend.appendChild(span);
    });

    // Insert the legend at the top of the org-chart container. The <svg> lives inside
    // .org-chart-wrap (a grandchild of `wrap`), so inserting relative to it throws a
    // NotFoundError and aborts the whole render — insert before the first child instead.
    if (wrap.firstChild) wrap.insertBefore(legend, wrap.firstChild);
    else wrap.appendChild(legend);
  }

  // --- C-026/C-051: focused org-node tracking for keyboard nav ---
  // We use a roving-tabindex model: only one SVG <g.org-node> at a time gets
  // tabindex="0"; all others get "-1". The user Tab-ins to the focused node and
  // then uses Arrow/Enter/Space/Escape to navigate/activate.
  let _orgFocusedNodeId = null;  // data-id of the currently keyboard-focused org node

  function renderOrgChart() {
    const wrap = document.getElementById('org-chart');
    const svg = d3.select('#org-chart-svg');
    if (!wrap || svg.empty()) return;
    const { visibleNodes, visibleLinks } = currentVisible();
    const width = wrap.clientWidth || 900;
    const height = wrap.clientHeight || 700;
    svg.attr('width', width).attr('height', height);
    svg.selectAll('*').remove();

    if (!orgZoomBehavior) {
      orgZoomBehavior = d3.zoom()
        .scaleExtent([0.4, 2.5])
        .on('zoom', (event) => {
          svg.select('#org-zoom').attr('transform', event.transform);
        });
    }
    svg.call(orgZoomBehavior);

    const zoomLayer = svg.append('g').attr('id', 'org-zoom');

    // C-051: derive teams dynamically from visible nodes
    const teams = _deriveTeams(visibleNodes);

    // C-051: render compact legend
    _renderOrgLegend(wrap, teams);

    const nodeSize = { w: 236, h: 58 };
    const nodeSpacingX = 304;   // > card width (236) + gutter, so sibling cards never collide
    const levelSpacingY = 150;  // card (58) + clear elbow routing
    const marginTop = 36;
    const BAND_GAP = 90;        // vertical gap between team trees

    // Teams are stacked VERTICALLY (Blue on top, Red below), each using the full canvas
    // width — never squeezed into half-width columns. The canvas grows tall; pan/zoom to navigate.
    let yCursor = marginTop;
    let widestTree = nodeSpacingX;

    // Collect all renderable org-node elements for keyboard nav (built below)
    const allOrgNodes = [];  // { el: SVGGElement, nodeId: string, depth: number, data: object }

    teams.forEach((team) => {
      const rootData = buildOrgTree(team, visibleNodes, visibleLinks, orgExpandedTeams.has(team));
      const root = d3.hierarchy(rootData);
      d3.tree().nodeSize([nodeSpacingX, levelSpacingY])
        .separation((a, b) => (a.parent === b.parent ? 1.1 : 2.0))(root);
      const nodes = root.descendants();
      const minX = d3.min(nodes, d => d.x), maxX = d3.max(nodes, d => d.x);
      const maxY = d3.max(nodes, d => d.y) || 0;
      const treeWidth = (maxX - minX) || nodeSpacingX;
      widestTree = Math.max(widestTree, treeWidth + nodeSize.w);
      const centerX = width / 2;
      const shiftX = centerX - (minX + treeWidth / 2);
      const shiftY = yCursor;

      // Use canonical affiliation colors for team bands.
      const teamColor = team === 'blue' ? getCssVar('--aff-friend')
        : team === 'red' ? getCssVar('--aff-hostile')
        : team === 'green' ? getCssVar('--aff-neutral')
        : team === 'yellow' ? getCssVar('--aff-unknown')
        : getCssVar('--team-3rd_party') || '#bfc9d4';

      // Team band label above each tree — uses --display font via CSS class.
      const bandLabel = team === 'blue' ? 'BLUE — US / ALLIED'
        : team === 'red' ? 'RED — PLA'
        : (team.replace('_', ' ')).toUpperCase();
      zoomLayer.append('text')
        .attr('x', shiftX + minX - nodeSize.w / 2).attr('y', shiftY - 12)
        .attr('class', 'org-band').attr('fill', teamColor)
        .text(bandLabel);

      zoomLayer.append('g')
        .selectAll('path').data(root.links()).join('path')
        .attr('class', 'org-link').attr('stroke', teamColor)
        .attr('d', d => {
          const sx = shiftX + d.source.x, sy = shiftY + d.source.y + nodeSize.h / 2;
          const tx = shiftX + d.target.x, ty = shiftY + d.target.y - nodeSize.h / 2; // child TOP edge
          const midY = (sy + ty) / 2;
          return `M${sx},${sy} V${midY} H${tx} V${ty}`;
        });

      const nodeG = zoomLayer.append('g')
        .selectAll('g').data(nodes).join('g')
        .attr('class', 'org-node')
        .attr('transform', d => `translate(${shiftX + d.x - nodeSize.w / 2},${shiftY + d.y - nodeSize.h / 2})`)
        .style('cursor', d => (d.depth === 0 || d.data?.group || d.data?.data) ? 'pointer' : 'default');

      // C-026: make org-chart nodes focusable and keyboard-activatable
      nodeG.each(function(d) {
        const el = this;
        const nid = d.data?.data?.id || d.data?.id || null;
        const isInteractive = d.depth === 0 || d.data?.group || d.data?.data;
        if (!isInteractive) return;

        // Set ARIA role and label
        let ariaLabel = '';
        if (d.depth === 0) {
          ariaLabel = `${d.data.name} — click to ${d.data.expanded ? 'collapse' : 'expand'}`;
          el.setAttribute('role', 'button');
          el.setAttribute('aria-expanded', d.data.expanded ? 'true' : 'false');
        } else if (d.data?.group) {
          ariaLabel = `${d.data.name}, ${d.data.count} units — click to ${d.data.collapsed ? 'expand' : 'collapse'}`;
          el.setAttribute('role', 'button');
          el.setAttribute('aria-expanded', d.data.collapsed ? 'false' : 'true');
        } else if (d.data?.data) {
          const nd = d.data.data;
          ariaLabel = `${nd.name || nd.id} — ${nd.type || ''} — ${(nd.domain || []).join('/')} — health ${Math.round((nd.health / (nd.healthMax || 100)) * 100)}% — press Enter to select`;
          el.setAttribute('role', 'button');
          el.setAttribute('aria-label', ariaLabel);
        }
        if (ariaLabel) el.setAttribute('aria-label', ariaLabel);

        // Roving tabindex — default all to -1; apply 0 to the focused node or first node of first team
        el.setAttribute('tabindex', (nid && nid === _orgFocusedNodeId) ? '0' : '-1');
        el.setAttribute('data-org-nid', nid || '');

        allOrgNodes.push({ el, nodeId: nid, depth: d.depth, data: d.data, d });
      });

      nodeG.on('click', (event, d) => {
        if (d.depth === 0 && d.data?.team) toggleOrgTeam(d.data.team);
        else if (d.data?.group) {                       // toggle a domain bucket
          if (orgExpandedGroups.has(d.data.id)) orgExpandedGroups.delete(d.data.id);
          else orgExpandedGroups.add(d.data.id);
          renderOrgChart();
        } else if (d.data?.data) selectNodeById(d.data.data.id);
      });

      nodeG.each(function (d) { drawMilBox(d3.select(this), d, teamColor); });

      yCursor += maxY + nodeSize.h + BAND_GAP;
    });

    // C-026: ensure at least one org-node has tabindex="0" (the focused one or first interactive)
    _setupOrgKeyboard(allOrgNodes);

    // One-time framing: scale so the widest tree fits the width (readable, floor 0.62),
    // anchored at the top. Preserve the user's pan/zoom on subsequent re-renders.
    if (!orgFramed) {
      orgFramed = true;
      const scale = Math.max(0.62, Math.min(1, (width - 40) / widestTree));
      const t = d3.zoomIdentity.translate(0, 8).scale(scale);
      svg.call(orgZoomBehavior.transform, t);
    }
  }
  let orgFramed = false;
  function resetOrgFraming() { orgFramed = false; }

  // C-026: set up roving-tabindex keyboard navigation for org-chart nodes
  function _setupOrgKeyboard(allOrgNodes) {
    if (!allOrgNodes.length) return;

    // Find the currently-focused node or fall back to the first interactive node
    let focusedIdx = allOrgNodes.findIndex(n => n.nodeId && n.nodeId === _orgFocusedNodeId);
    if (focusedIdx < 0) focusedIdx = 0;

    // Apply roving tabindex
    allOrgNodes.forEach((n, i) => {
      n.el.setAttribute('tabindex', i === focusedIdx ? '0' : '-1');
    });

    allOrgNodes.forEach((item, idx) => {
      // Keyboard handler
      item.el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          // Activate node (same logic as click)
          const d = item.d;
          if (d.depth === 0 && item.data?.team) toggleOrgTeam(item.data.team);
          else if (item.data?.group) {
            if (orgExpandedGroups.has(item.data.id)) orgExpandedGroups.delete(item.data.id);
            else orgExpandedGroups.add(item.data.id);
            renderOrgChart();
          } else if (item.data?.data) selectNodeById(item.data.data.id);
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          _orgMoveFocus(allOrgNodes, idx, 1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          _orgMoveFocus(allOrgNodes, idx, -1);
        } else if (e.key === 'Home') {
          e.preventDefault();
          _orgMoveFocus(allOrgNodes, -1, 1); // jump to index 0
        } else if (e.key === 'End') {
          e.preventDefault();
          _orgMoveFocus(allOrgNodes, allOrgNodes.length, -1); // jump to last
        }
      });

      item.el.addEventListener('focus', () => {
        _orgFocusedNodeId = item.nodeId;
        allOrgNodes.forEach((n, i) => n.el.setAttribute('tabindex', i === idx ? '0' : '-1'));
      });
    });
  }

  function _orgMoveFocus(allOrgNodes, currentIdx, delta) {
    const next = allOrgNodes[currentIdx + delta];
    if (next) {
      allOrgNodes.forEach((n, i) => n.el.setAttribute('tabindex', (currentIdx + delta === i) ? '0' : '-1'));
      _orgFocusedNodeId = next.nodeId;
      try { next.el.focus(); } catch (e) { /* SVG focus may fail in some browsers; ignore */ }
    }
  }

  function fitOrgChartToView(svg, zoomLayer, width, height) {
    try {
      const box = zoomLayer.node().getBBox();
      const padding = 30;
      const scale = Math.min(
        1.4,
        Math.max(0.3,
          Math.min(
            (width - padding * 2) / box.width,
            (height - padding * 2) / box.height
          )
        )
      );
      const tx = (width - box.width * scale) / 2 - box.x * scale;
      const ty = (height - box.height * scale) / 2 - box.y * scale;
      const t = d3.zoomIdentity.translate(tx, ty).scale(scale);
      svg.transition().duration(200).call(orgZoomBehavior.transform, t);
    } catch (e) { /* ignore fit errors */ }
  }

  function drawMilBox(group, d, strokeColor) {
    const node = d.data.data;
    const isRoot = d.depth === 0;
    const w = 236, h = 58;
    const team = node?.team || d.data.team || '';
    const accentVal = getCssVar('--accent');
    const isSelected = node && ctx.getSelectedNode() && node.id === ctx.getSelectedNode().id;
    const box = group.append('g').attr('class', 'mil-box' + (isSelected ? ' selected' : ''));

    // Canonical affiliation colors for card fills and strokes.
    const friendColor = getCssVar('--aff-friend');
    const hostileColor = getCssVar('--aff-hostile');
    const isRed = team === 'red';

    // --- Team header card (the tree root) ---
    if (isRoot) {
      const headerFill = isRed ? '#241218' : '#10243a';
      box.append('rect')
        .attr('class', 'org-header')
        .attr('width', w).attr('height', h).attr('rx', 9)
        .attr('fill', headerFill)
        .attr('stroke', strokeColor);
      const count = (d.descendants ? d.descendants().length - 1 : 0);
      // Title uses --display font (set via CSS .org-title, reinforced inline).
      box.append('text').attr('x', 16).attr('y', 25).attr('class', 'org-title')
        .attr('fill', '#eef4fb')
        .attr('font-family', 'var(--display)')
        .text(teamLabel(team).toUpperCase());
      box.append('text').attr('x', 16).attr('y', 43).attr('class', 'sub')
        .text(count ? count + ' units · click or Enter to ' + (d.data.expanded ? 'collapse' : 'expand') : 'Task organization');
      box.append('text').attr('x', w - 14).attr('y', 32).attr('text-anchor', 'end')
        .attr('class', 'org-chevron').attr('fill', strokeColor).text(d.data.expanded ? '▾' : '▸');
      return;
    }

    // --- Domain bucket (collapsible group of leaf units) ---
    if (d.data.group) {
      const bucketFill = isRed ? '#1d1413' : '#0f1d2b';
      box.append('rect').attr('class', 'org-group').attr('width', w).attr('height', h).attr('rx', 7)
        .attr('fill', bucketFill).attr('stroke', strokeColor).attr('stroke-dasharray', '5 3');
      box.append('rect').attr('x', 0).attr('y', 0).attr('width', 4).attr('height', h).attr('rx', 2).attr('fill', strokeColor);
      box.append('text').attr('x', 16).attr('y', 26).attr('class', 'org-name').attr('fill', '#dfeaf5').text(d.data.name);
      box.append('text').attr('x', 16).attr('y', 42).attr('class', 'sub')
        .text(d.data.count + ' units · click or Enter to ' + (d.data.collapsed ? 'expand' : 'collapse'));
      box.append('text').attr('x', w - 14).attr('y', 33).attr('text-anchor', 'end')
        .attr('class', 'org-chevron').attr('fill', strokeColor).text(d.data.collapsed ? '▸' : '▾');
      return;
    }

    // --- Unit card ---
    // Selected node: cyan glow via filter. Non-selected: normal team stroke.
    const cardFilter = isSelected ? 'drop-shadow(0 0 7px rgba(0,216,255,0.60))' : 'none';
    const cardStroke = isSelected ? accentVal : strokeColor;

    box.append('rect').attr('class', 'org-card').attr('width', w).attr('height', h).attr('rx', 7)
      .attr('stroke', cardStroke)
      .attr('style', 'filter:' + cardFilter);
    box.append('rect').attr('x', 0).attr('y', 0).attr('width', 4).attr('height', h)
      .attr('rx', 2).attr('fill', strokeColor);   // affiliation accent stripe

    // Real MIL-STD-2525 symbol (milsymbol via SymbolModule), embedded as an image.
    let placedSymbol = false;
    try {
      if (window.SymbolModule && node) {
        const svgStr = window.SymbolModule.svg(node, { size: 30 });
        const uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
        box.append('image').attr('href', uri).attr('xlink:href', uri)
          .attr('x', 8).attr('y', (h - 40) / 2).attr('width', 40).attr('height', 40)
          .attr('preserveAspectRatio', 'xMidYMid meet');
        placedSymbol = true;
      }
    } catch (e) { /* fall through to the built-in glyph */ }
    if (!placedSymbol) {
      const sym = box.append('g').attr('class', 'symbol').attr('transform', 'translate(9,11)');
      drawSymbol(sym, node, strokeColor);
    }

    const tx = 58;
    const rawName = d.data.name || '';
    const name = rawName.length > 26 ? rawName.slice(0, 25) + '…' : rawName;
    box.append('title').text(rawName);   // full name on hover
    box.append('text').attr('x', tx).attr('y', 21).attr('class', 'org-name')
      .attr('fill', '#eef4fb').text(name);
    // Sub line: type · domain on the left, importance star on the right (off the name row).
    const sub = [node && node.type, (node && node.domain || []).join('/')].filter(Boolean).join(' · ');
    box.append('text').attr('x', tx).attr('y', 36).attr('class', 'sub').text(sub);
    if (node && node.importance != null) {
      box.append('text').attr('x', w - 12).attr('y', 36).attr('text-anchor', 'end').attr('class', 'org-imp').text('★ ' + node.importance);
    }

    if (node) {
      const hm = node.healthMax || 100;
      const hf = Math.max(0, Math.min(1, (node.health == null ? hm : node.health) / hm));
      const barW = w - tx - 14;
      box.append('rect').attr('x', tx).attr('y', 44).attr('width', barW).attr('height', 5).attr('rx', 2.5).attr('fill', '#1b2a38');
      // Health bar uses canonical palette values (resolved inline for SVG compat).
      const hBarColor = hf > 0.66
        ? getCssVar('--aff-neutral')
        : (hf > 0.33 ? getCssVar('--amber') : getCssVar('--alert'));
      box.append('rect').attr('x', tx).attr('y', 44).attr('width', Math.max(2, barW * hf)).attr('height', 5).attr('rx', 2.5).attr('fill', hBarColor);
    }
  }

  function drawSymbol(group, node, stroke) {
    const w = 116;
    const h = 36;
    const centerX = w / 2;
    const centerY = h / 2;
    const type = String(node?.type || '').toLowerCase();
    const domain = (node?.domain || []).map(s => String(s).toLowerCase());

    if (!node) {
      // root placeholder
      group.append('rect')
        .attr('x', 0).attr('y', 0).attr('width', w).attr('height', h)
        .attr('rx', 4).attr('ry', 4)
        .attr('stroke', stroke).attr('fill', 'none');
      group.append('line').attr('x1', 10).attr('y1', centerY).attr('x2', w-10).attr('y2', centerY).attr('stroke', stroke);
      return;
    }

    group.append('rect')
      .attr('width', w)
      .attr('height', h)
      .attr('fill', 'none')
      .attr('stroke', 'none');

    if (type.includes('command')) {
      group.append('line').attr('x1', 0).attr('y1', 0).attr('x2', w).attr('y2', h).attr('stroke', stroke);
      group.append('line').attr('x1', 0).attr('y1', h).attr('x2', w).attr('y2', 0).attr('stroke', stroke);
    } else if (domain.includes('air') || type.includes('fires')) {
      group.append('ellipse')
        .attr('cx', centerX)
        .attr('cy', centerY)
        .attr('rx', 28)
        .attr('ry', 12)
        .attr('stroke', stroke)
        .attr('fill', 'none');
    } else if (domain.includes('ew') || type.includes('relay') || type.includes('sensor')) {
      group.append('polygon')
        .attr('points', `${centerX},6 ${w-8},${centerY} ${centerX},${h-6} ${8},${centerY}`)
        .attr('stroke', stroke)
        .attr('fill', 'none');
    } else if (type.includes('support') || type.includes('log')) {
      group.append('rect')
        .attr('x', centerX - 12)
        .attr('y', centerY - 8)
        .attr('width', 24)
        .attr('height', 16)
        .attr('class', 'symbol-fill');
    } else {
      group.append('line').attr('x1', 6).attr('y1', centerY).attr('x2', w - 6).attr('y2', centerY).attr('stroke', stroke);
      group.append('circle').attr('cx', centerX).attr('cy', centerY).attr('r', 6).attr('stroke', stroke).attr('fill', 'none');
    }
  }

  // Publish renderers onto their original global names so the main script's
  // orchestration (refreshGraph, toggleTableMode, toggleOrgMode/Team, resize) keeps
  // calling them unedited.
  window.refreshTable = refreshTable;
  window.displayStatusForRow = displayStatusForRow;
  window.renderOrgChart = renderOrgChart;
  window.buildOrgTree = buildOrgTree;
  window.resetOrgFraming = resetOrgFraming;

  return { init, refreshTable, displayStatusForRow, renderOrgChart, buildOrgTree, resetOrgFraming };
})();
