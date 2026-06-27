# Audit: Table view

Surface: the **Table view** (`#table` / `#nodes-table`), rendered by `refreshTable()` + `displayStatusForRow()` in `views.js`, markup/CSS in `StrikeSim2040.html`. Lists the visible node set; clicking a row selects the node. Scope of this audit: that table only.

Context confirmed during audit:
- Node data carries `subsystem`, `vulnerabilities[]`, `cascScore` (see `grok150red.json`) but the table exposes none of them. There is no `mgrs` field anywhere — only `lat`/`lon`.
- `currentVisible()` (`StrikeSim2040.html:2063`) is the single source of truth for visibility; the table consumes it correctly, so the recent "empty group = hide" fix is reflected in the table for free.
- `refreshTable()` is re-invoked on every relevant state change (`StrikeSim2040.html:2116`, `2739`, `2876`), so filtering/strike updates propagate.

---

## [P0] No column sorting — a 224-row analyst table you cannot order
**Where:** `views.js:41` (`refreshTable`), `StrikeSim2040.html:1126-1138` (`<thead>` headers)
**Problem:** The headers (ID, Name, Team, Domain, Type, Health, Status, Importance, Difficulty, Coords) are static `<th>` text with no click handlers, no sort state, no indicators. An analyst cannot rank by Importance, Health, or Difficulty — the single most common reason to open a tabular view of 224 nodes. This is the biggest gap on the surface.
**Fix:** Add a module-level sort state `{ key, dir }`. Make each `<th>` clickable (`data-sort-key="importance"` etc.); on click toggle dir and re-sort. In `refreshTable`, sort `visibleNodes` with a typed comparator before mapping rows (numeric for health%/importance/difficulty/cascScore, locale string for name/team/type, natural for ID). Render a ▲/▼ glyph in the active header and set `aria-sort` on it. Keep sort key in a closure var so it survives `refreshTable` re-renders triggered by strikes/filters.
**Effort:** M

## [P0] Map/3D selection does not highlight the table row (one-way sync)
**Where:** `views.js:70` (row click → `selectNodeById`), `StrikeSim2040.html:2134` (`selectNode`), CSS `StrikeSim2040.html:354-376` (no `.row-selected` rule)
**Problem:** Row click selects the node (table → app works), but selecting a node anywhere else (3D click, map marker, search badge, `cycleVisibleSelection` arrow keys) does **not** mark the corresponding row. There is no `.row-selected` class in the code at all, and `selectNode` never touches `#nodes-table`. With 224 rows the selected node is invisible in the table, breaking the COP "see what's selected everywhere" expectation.
**Fix:** Add a `.row-selected` CSS rule (left accent border + tinted background, distinct from `.row-highlight`). In `refreshTable`, after building rows, add the class to `tr[data-id="<selectedNode.id>"]` and `scrollIntoView({block:'nearest'})` it. Make `selectNode` (or a small `syncTableSelection()` helper it calls) re-apply the class without a full re-render when the table is already drawn. Inject `getSelectedNode` is already in `ctx` — use it.
**Effort:** M

## [P1] Status and Health are not color-coded — no at-a-glance triage
**Where:** `views.js:61-62` (health `%` text, single `status-badge` span), CSS `StrikeSim2040.html:374` (one flat `.status-badge` rule)
**Problem:** Health is rendered as plain `${healthPct}%` text and the status badge has one uniform border/background regardless of value. A "Neutralized" node looks identical to an "Active" one; a 4%-health node looks identical to 100%. The app already has semantic colors (`--danger`, `--accent`) and even color-codes status elsewhere (`StrikeSim2040.html:1926`). The table is the one place a scan-for-trouble workflow lives, and it is monochrome.
**Fix:** Color the status badge by `statusText` (Neutralized = danger/grey, High Risk = danger, High Payoff/Likely Neutralized = accent, Active = neutral) via a class map. Color health: red <34, amber 34-66, green >66, applied to the cell text or a thin inline bar. Reuse existing CSS vars; add high-contrast-safe variants gated on `body.high-contrast` (already read at `views.js:45` but currently unused — `hc` is computed and discarded, a latent bug worth noting).
**Effort:** S

## [P1] No export of the visible set (no CSV, no JSON)
**Where:** `views.js:41` (table render), `StrikeSim2040.html:2412` (only existing export = full session-state JSON, not the table)
**Problem:** The only download in the app is a full `mdsc_session_*.json` state dump (`StrikeSim2040.html:2412`), not the filtered/sorted table the analyst is actually looking at. There is no CSV or JSON export of `visibleNodes`. Analysts expect to pull the current view into a spreadsheet/report.
**Fix:** Add an "Export CSV" (and optionally "Export JSON") button in the `.table-wrap` header. On click, take the current `visibleNodes` (post-filter, post-sort), emit a CSV with the displayed columns plus the hidden-but-useful ones (subsystem, vulnerabilities, cascScore), quote/escape fields, and download via a `Blob` (pattern already used at `StrikeSim2040.html:2412-2415`). Honor the active sort so the export matches the screen.
**Effort:** S

## [P1] Missing high-value columns: subsystem, vulnerabilities, cascScore
**Where:** `views.js:54-66` (row template), `StrikeSim2040.html:1127-1138` (header row)
**Problem:** The data model carries `subsystem`, `vulnerabilities[]`, and `cascScore` (confirmed in `grok150red.json`), and these are central to targeting decisions (vulnerabilities drive strike method; cascScore drives cascade payoff). None appear in the table, so the analyst must open each node's popup one at a time. (Note: `MGRS` does **not** exist in the data — only `lat`/`lon` — so a true MGRS column would require deriving it; treat that as optional/out of scope unless an MGRS lib is added.)
**Fix:** Add `Subsystem`, `Vulnerabilities` (join `vulnerabilities` with commas, truncate with title tooltip), and `CascScore` columns to both `<thead>` and the row template. Make CascScore numerically sortable (ties into the P0 sort work). Consider a column-visibility toggle so the wider table stays manageable; otherwise enable horizontal scroll within `.table-wrap`.
**Effort:** M

## [P1] No keyboard navigation or accessibility for rows
**Where:** `views.js:55` (`<tr data-id>` has no `tabindex`/`role`), `views.js:70` (click-only handler)
**Problem:** Rows are selectable only by mouse click. They are not focusable (`tabindex`), have no keyboard activation (Enter/Space), no `aria-selected`, and the table has no caption/`aria-rowcount`. Arrow-key cycling (`cycleVisibleSelection`, `StrikeSim2040.html:2156`) exists globally but is not wired to table focus and (per P0) does not move a visible row indicator. Keyboard and screen-reader users cannot operate the table.
**Fix:** Add `tabindex="0"` and `role="row"`/`aria-selected` to rows (or make the `<table>` a focusable grid with roving tabindex). Handle Enter/Space → select, ArrowUp/Down → move selection within the table and scroll into view. Add a `<caption class="visually-hidden">` describing the table and set `aria-sort` on headers once sorting lands. Tie the selected row to `aria-selected="true"` so it announces.
**Effort:** M

## [P2] Search results bypass the table — no in-table search/filter
**Where:** `StrikeSim2040.html:2168` (`onFind`), `views.js:41` (table render)
**Problem:** The sidebar search (`onFind`) renders its own badge list and selects the top match, but it does not filter or scroll the table, nor highlight matching rows. With sorting/selection sync absent, search-then-find-in-table is impossible. The table also has no local quick-filter box for "name contains…".
**Fix:** Either (a) add a lightweight per-column / global filter input above the table that narrows `visibleNodes` client-side in `refreshTable`, or (b) on `onFind`, when the table is active, scroll to and `.row-selected` the matched row (depends on P0 selection sync). Option (a) is the higher-value analyst feature.
**Effort:** M

## [P2] Full innerHTML re-render + per-row listeners on every state change
**Where:** `views.js:68-70` (`tbody.innerHTML = rows;` then `querySelectorAll(...).forEach(addEventListener)`)
**Problem:** Each `refreshTable` rebuilds all 224 rows as a string, blows away the DOM, and reattaches 224 individual click listeners. This runs on every filter toggle, strike, and cascade tick. At 224 rows it is tolerable but wasteful, causes scroll-position loss, and the listener-per-row pattern leaks/churns. It will not scale if the dataset grows.
**Fix:** Replace per-row listeners with a single delegated `click` listener on `<tbody>` (read `e.target.closest('tr').dataset.id`), attached once. Preserve scroll position across re-renders. If sorting/selection are added as targeted DOM updates, avoid the full innerHTML rebuild for selection changes. Optional: virtualize rows only if the node count climbs well past a few hundred.
**Effort:** M

## [P2] Density/contrast: muted header text, dim rows, low row affordance
**Where:** CSS `StrikeSim2040.html:367-376`
**Problem:** Header text uses `--muted` on a near-black `#0b131b` (low contrast, fails comfortable readability); body font is 12px with 8px padding (acceptable but no zebra striping, so a 224-row table is a wall of identical rows). `.row-dim` drops opacity to 0.55 which compounds the low contrast when a highlight mode is active. The hover affordance (`#0e1620`) is very subtle. There is no visual grouping by team/domain.
**Fix:** Raise header text toward `--text` (or a lighter muted) for WCAG-AA contrast; add zebra striping (`tbody tr:nth-child(even)`); strengthen hover; consider a subtle team-color left border per row (the `teamColor` is already computed at `views.js:50` but only used for the swatch). Re-check `.row-dim` contrast in high-contrast mode.
**Effort:** S

## [P2] Sticky header works but breaks when columns/export controls are added; no horizontal scroll plan
**Where:** CSS `StrikeSim2040.html:368-371` (`thead th { position: sticky; top: 0 }`), `#table { overflow: auto }` (`:362`)
**Problem:** The sticky header is correctly implemented today. However, `#table` is the scroll container and `.table-wrap` has padding, so once the proposed Subsystem/Vulnerabilities columns push the table past the viewport width, horizontal scroll will move the sticky header out of alignment and there is no frozen first column (ID/Name). Adding an export/filter toolbar above the table would also scroll away unless made sticky.
**Fix:** When widening the table, wrap it in a dedicated scroll container with `overflow:auto`, keep `thead` sticky, and add `position: sticky; left: 0` to the ID (and optionally Name) cells so identity stays visible during horizontal scroll. Make the new toolbar `position: sticky; top: 0` above the header.
**Effort:** S
