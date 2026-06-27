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
 */
window.ViewsModule = (function () {
  'use strict';

  // org-chart zoom behavior (module-internal, lazily created)
  let orgZoomBehavior = null;

  // Injected accessors for script-scoped state; safe defaults until init().
  let ctx = {
    getSelectedNode: () => null,
    getHighlightMode: () => null,
    getHighlightSet: () => new Set()
  };
  function init(context) { ctx = Object.assign({}, ctx, context || {}); }

  // --- Table view ---
    function displayStatusForRow(n) {
      if (ctx.getHighlightMode() === 'coa' && ctx.getHighlightSet() && ctx.getHighlightSet().has(n.id)) return 'Likely Neutralized';
      if (ctx.getHighlightMode() === 'payoff' && ctx.getHighlightSet() && ctx.getHighlightSet().has(n.id)) return 'High Payoff';
      if (ctx.getHighlightMode() === 'risk' && ctx.getHighlightSet() && ctx.getHighlightSet().has(n.id)) return 'High Risk';
      return n.status || 'Active';
    }

    function refreshTable() {
      const tbody = document.querySelector('#nodes-table tbody');
      if (!tbody) return;
      const { visibleNodes } = currentVisible();
      const hc = document.body.classList.contains('high-contrast');
      const rows = visibleNodes.map(n => {
        const healthMax = n.healthMax || 100;
        const healthPct = Math.max(0, Math.min(100, Math.round((n.health / healthMax) * 100)));
        const statusText = displayStatusForRow(n);
        const teamColor = resolveCssVar(colorFromTeam(n));
        const dom = (n.domain || []).join(', ');
        const coords = (n.lat != null && n.lon != null) ? `${Number(n.lat).toFixed(2)}, ${Number(n.lon).toFixed(2)}` : '';
        const trClass = (ctx.getHighlightMode() && ctx.getHighlightSet() && ctx.getHighlightSet().size) ? (ctx.getHighlightSet().has(n.id) ? 'row-highlight' : 'row-dim') : '';
        return `
          <tr class="${trClass}" data-id="${n.id}">
            <td>${n.id}</td>
            <td>${n.name || ''}</td>
            <td><span class="swatch" style="background:${teamColor}"></span> ${(n.team||'3rd_party').replace('_',' ')}</td>
            <td>${dom}</td>
            <td>${n.type || ''}</td>
            <td>${healthPct}%</td>
            <td><span class="status-badge">${statusText}</span></td>
            <td>${n.importance ?? ''}</td>
            <td>${n.difficulty || ''}</td>
            <td>${coords}</td>
          </tr>`;
      }).join('');
      tbody.innerHTML = rows;
      // Row click -> select node
      tbody.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => selectNodeById(tr.getAttribute('data-id'))));
    }

  // --- Task-org / wire diagram ---
    function buildOrgTree(team, visibleNodes, visibleLinks, expanded) {
      const teamNodes = visibleNodes.filter(n => (n.team || '3rd_party') === team);
      const idToNode = new Map(teamNodes.map(n => [n.id, n]));
      const adj = new Map();
      teamNodes.forEach(n => adj.set(n.id, []));
      visibleLinks.forEach(l => {
        const s = l.source?.id ?? l.source;
        const t = l.target?.id ?? l.target;
        if (adj.has(s) && adj.has(t)) {
          adj.get(s).push(t);
          adj.get(t).push(s);
        }
      });
      const commandNodes = teamNodes.filter(n => String(n.type || '').toLowerCase().includes('command'));
      const anchors = commandNodes.length ? commandNodes : teamNodes.slice(0, Math.min(2, teamNodes.length));
      const root = { name: `${teamLabel(team)} Task Org`, id: `${team}-root`, team, expanded, children: [] };
      if (!expanded) return root;
      const used = new Set();
      const mk = (n) => ({ name: n.name || n.id, id: n.id, data: n, children: [] });

      anchors.forEach(cmd => {
        used.add(cmd.id);
        const childIds = (adj.get(cmd.id) || []).filter(id => idToNode.has(id));
        const children = childIds.map(id => {
          const node = idToNode.get(id);
          used.add(id);
          const grandIds = (adj.get(id) || []).filter(gid => gid !== cmd.id && idToNode.has(gid) && !used.has(gid));
          const child = mk(node);
          child.children = grandIds.map(gid => { used.add(gid); return mk(idToNode.get(gid)); });
          return child;
        });
        root.children.push({ ...mk(cmd), children });
      });

      const extras = teamNodes.filter(n => !used.has(n.id)).map(mk);
      if (extras.length) root.children.push({ name: 'Attachments', id: `${team}-attachments`, children: extras });
      if (!root.children.length) root.children.push({ name: 'No nodes available', id: `${team}-none`, children: [] });
      return root;
    }

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
      const teams = ['blue', 'red'];
      const colW = width / teams.length;
      const nodeSize = { w: 216, h: 58 };
      const nodeSpacingX = 252;
      const levelSpacingY = 132;
      const marginTop = 44;

      teams.forEach((team, idx) => {
        const rootData = buildOrgTree(team, visibleNodes, visibleLinks, orgExpandedTeams.has(team));
        const root = d3.hierarchy(rootData);
        const tree = d3.tree()
          .nodeSize([nodeSpacingX, levelSpacingY])
          .separation((a, b) => (a.parent === b.parent ? 1.0 : 1.8));
        tree(root);
        const nodes = root.descendants();
        const minX = d3.min(nodes, d => d.x);
        const maxX = d3.max(nodes, d => d.x);
        const treeWidth = (maxX - minX) || nodeSpacingX;
        const centerX = idx * colW + colW / 2;
        const shiftX = centerX - (minX + treeWidth / 2);
        const shiftY = marginTop;
        const teamColor = team === 'blue' ? resolveCssVar('var(--team-blue)') : resolveCssVar('var(--team-red)');

        zoomLayer.append('g')
          .selectAll('path')
          .data(root.links())
          .join('path')
          .attr('class', 'org-link')
          .attr('stroke', teamColor)
          .attr('d', d => {
            const sx = shiftX + d.source.x;
            const sy = shiftY + d.source.y + nodeSize.h;
            const tx = shiftX + d.target.x;
            const ty = shiftY + d.target.y;
            const midY = (sy + ty) / 2;
            return `M${sx},${sy} V${midY} H${tx} V${ty}`;
          });

        const nodeG = zoomLayer.append('g')
          .selectAll('g')
          .data(nodes)
          .join('g')
          .attr('class', 'org-node')
          .attr('transform', d => `translate(${shiftX + d.x - nodeSize.w/2},${shiftY + d.y - nodeSize.h/2})`)
          .style('cursor', d => d.depth === 0 ? 'pointer' : (d.data?.data ? 'pointer' : 'default'))
          .on('click', (event, d) => {
            if (d.depth === 0 && d.data?.team) {
              toggleOrgTeam(d.data.team);
            } else if (d.data && d.data.data) {
              selectNodeById(d.data.data.id);
            }
          });

        nodeG.each(function(d) {
          drawMilBox(d3.select(this), d, teamColor);
        });
      });

      fitOrgChartToView(svg, zoomLayer, width, height);
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
      const w = 216, h = 58;
      const team = node?.team || d.data.team || '';
      const accent = resolveCssVar('var(--accent)');
      const isSelected = node && ctx.getSelectedNode() && node.id === ctx.getSelectedNode().id;
      const box = group.append('g').attr('class', 'mil-box' + (isSelected ? ' selected' : ''));

      // --- Team header card (the tree root) ---
      if (isRoot) {
        box.append('rect')
          .attr('class', 'org-header')
          .attr('width', w).attr('height', h).attr('rx', 9)
          .attr('fill', team === 'red' ? '#241218' : '#10243a')
          .attr('stroke', strokeColor);
        const count = (d.descendants ? d.descendants().length - 1 : 0);
        box.append('text').attr('x', 16).attr('y', 25).attr('class', 'org-title')
          .attr('fill', '#eef4fb').text(teamLabel(team).toUpperCase());
        box.append('text').attr('x', 16).attr('y', 43).attr('class', 'sub')
          .text(count ? count + ' units · click to ' + (d.data.expanded ? 'collapse' : 'expand') : 'Task organization');
        box.append('text').attr('x', w - 14).attr('y', 32).attr('text-anchor', 'end')
          .attr('class', 'org-chevron').attr('fill', strokeColor).text(d.data.expanded ? '▾' : '▸');
        return;
      }

      // --- Unit card ---
      box.append('rect').attr('class', 'org-card').attr('width', w).attr('height', h).attr('rx', 7)
        .attr('stroke', isSelected ? accent : strokeColor);
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
      const name = rawName.length > 24 ? rawName.slice(0, 23) + '…' : rawName;
      box.append('text').attr('x', tx).attr('y', 21).attr('class', 'org-name')
        .attr('fill', '#eef4fb').text(name);
      const sub = [node && node.type, (node && node.domain || []).join('/')].filter(Boolean).join(' · ');
      box.append('text').attr('x', tx).attr('y', 36).attr('class', 'sub').text(sub);

      if (node) {
        const hm = node.healthMax || 100;
        const hf = Math.max(0, Math.min(1, (node.health == null ? hm : node.health) / hm));
        const barW = w - tx - 14;
        box.append('rect').attr('x', tx).attr('y', 43).attr('width', barW).attr('height', 5).attr('rx', 2.5).attr('fill', '#1b2a38');
        const hc = hf > 0.66 ? '#46d57e' : (hf > 0.33 ? '#e8b54a' : '#e8584a');
        box.append('rect').attr('x', tx).attr('y', 43).attr('width', Math.max(2, barW * hf)).attr('height', 5).attr('rx', 2.5).attr('fill', hc);
        if (node.importance != null) {
          box.append('text').attr('x', w - 12).attr('y', 21).attr('text-anchor', 'end').attr('class', 'org-imp').text('★ ' + node.importance);
        }
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

      const baseRect = group.append('rect')
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

  return { init, refreshTable, displayStatusForRow, renderOrgChart, buildOrgTree };
})();
