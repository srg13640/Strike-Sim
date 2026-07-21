# V3 — Data Visualization Legibility
- Dimension: Look & Feel
- Focus: Monte Carlo results, gauges, charts, tables, and task-org legibility
- Files inspected: StrikeSim2040.html, views.js, _stark/audits/00-MASTER-FIXLIST.md

## Summary
StrikeSim 2040 has made real progress toward operator-grade data presentation: Monte Carlo now records confidence intervals, percentiles, seed metadata, and worker status, while the table and task-org views have basic sorting, health bars, status badges, and clearer team coloring. The remaining legibility gap is not a lack of data; it is that the richest outputs are still rendered as metric cards, text strings, and key-value rows instead of compact decision graphics. Monte Carlo outcomes need better uncertainty and target-odds visualization, and the table/task-org views need to expose decision-critical fields without forcing the operator back into raw node inspection. These are mostly incremental UI upgrades that preserve the offline, plain-script architecture.

## Strengths
- Monte Carlo already computes confidence interval text, p50/p90 impact, p50/p90 steps, average losses, spend, node odds, seed, and RNG metadata, so the data needed for stronger visualizations is already in memory (StrikeSim2040.html:5095, StrikeSim2040.html:5100, StrikeSim2040.html:5151).
- The main data table is sortable and uses compact health bars, status badges, and team color chips rather than plain text only (views.js:48, views.js:183, views.js:192, views.js:196).
- The task-org view is no longer a flat force dump: it builds a hierarchy, limits breadth through domain buckets, stacks Blue and Red vertically, and uses pan/zoom for large trees (views.js:240, views.js:286, views.js:339, views.js:322).
- The prior master fixlist correctly recognizes that the task-org rebuild landed, while still preserving follow-on polish items like per-branch collapse and legends (_stark/audits/00-MASTER-FIXLIST.md:9, _stark/audits/00-MASTER-FIXLIST.md:74).

## Findings
### V3-01 — Monte Carlo gauge is mislabeled as system health
- Severity: P1   Impact: 4   Effort: S
- Location: StrikeSim2040.html:1681
- Observation: The panel labels the gauge as "System Health (Monte Carlo)" with `strength-bar` and `strength-text`, but the run code drives that bar directly from `successRate * 100`, not from friendly force health or system readiness (StrikeSim2040.html:1681, StrikeSim2040.html:5109, StrikeSim2040.html:5112). An operator can read a 70% bar as force health when it is actually COA success likelihood.
- Recommendation: Rename the gauge to "COA Success Likelihood" or "Plan Confidence" and show the 95% CI alongside the bar. If force health is needed, give it a separate gauge derived from Blue losses or remaining health.
- Tradeoffs/risks: Renaming is low risk, but splitting plan confidence from force health may require deciding which loss metric is doctrinally meaningful.

### V3-02 — Monte Carlo uncertainty is trapped in cards instead of a visual range
- Severity: P1   Impact: 4   Effort: M
- Location: StrikeSim2040.html:1687
- Observation: The Monte Carlo output is three stacked `results-grid` blocks of stat cards, while the CSS treats every result as the same centered value/label tile (StrikeSim2040.html:178, StrikeSim2040.html:1687, StrikeSim2040.html:1701, StrikeSim2040.html:1719). The engine already collects arrays and percentiles for success impact, steps, losses, and spend, but the UI only exposes selected point values and p50/p90 text (StrikeSim2040.html:4976, StrikeSim2040.html:5095, StrikeSim2040.html:5114).
- Recommendation: Add one compact uncertainty visualization under the headline success metric: a small distribution strip or fan chart showing success rate with CI, impact p50/p90, and steps p50/p90 on a shared visual scale. Keep the current cards as drill-down values.
- Tradeoffs/risks: A chart adds some UI code, but it can be implemented with plain SVG/CSS using the existing arrays and percentiles without adding a dependency.

### V3-03 — Neutralization odds are rendered as text lists, not readable target graphics
- Severity: P1   Impact: 4   Effort: S
- Location: StrikeSim2040.html:5127
- Observation: The main panel writes likely neutralized targets as one comma-separated sentence, and the detailed report renders only the top 10 node odds as simple `kv-row` entries (StrikeSim2040.html:5123, StrikeSim2040.html:5127, StrikeSim2040.html:5787, StrikeSim2040.html:5788). For a strike-planning tool, target confidence is a primary decision product, but this presentation makes ranking, threshold comparison, and outliers hard to scan.
- Recommendation: Replace both outputs with a ranked horizontal bar list: target name/ID, domain/team chip, percentage bar, and a visible threshold marker matching `mc-highlight-threshold`. Keep the top 10 default, with a "show all above threshold" expansion.
- Tradeoffs/risks: Long target names will need truncation and tooltips, but that is still more legible than a long comma-separated sentence.

### V3-04 — Table view hides decision-critical analysis fields
- Severity: P1   Impact: 4   Effort: M
- Location: views.js:42
- Observation: The table's current schema is ID, Name, Team, Domain, Type, Health, Status, Importance, Difficulty, and Coords, and the row renderer outputs only those fields (views.js:42, views.js:204, views.js:213, views.js:215). The simulation and task-org logic rely on values such as `cascScore`, resource generation, subsystem, and vulnerabilities, but those are not available as table columns or compact badges in the primary tabular view (views.js:230, views.js:253, StrikeSim2040.html:3175, StrikeSim2040.html:3185).
- Recommendation: Add an "Analysis columns" toggle or preset that exposes cascade score, resource generation/type, subsystem, vulnerability count/top vulnerability, and MGRS/precise coordinates where available. Keep the default table lean, but make the decision-support fields sortable when the operator needs target prioritization.
- Tradeoffs/risks: Adding too many columns can make the table harder to read; a preset/toggle avoids overwhelming the default view.

### V3-05 — Task-org coverage and focus controls are still too narrow
- Severity: P2   Impact: 3   Effort: M
- Location: views.js:332
- Observation: The task-org renderer hard-codes `const teams = ['blue', 'red']`, even though the shared team color helper handles green, yellow, and third-party affiliations (views.js:117, views.js:123, views.js:332). It also only supports clicking a team root to expand/collapse, clicking a domain bucket to expand/collapse, or clicking a node to select; individual command branches cannot be collapsed or focused (views.js:383, views.js:385, views.js:389). The visible HTML hint documents pan/zoom and Blue/Red expansion, but not a legend or subtree focus model (StrikeSim2040.html:1453, StrikeSim2040.html:1457).
- Recommendation: Derive displayed teams from `visibleNodes` with Blue/Red first and any other affiliations after, then add per-branch collapse/focus controls for nodes with children. Add a small legend for card color, link color, health bar, and bucket meaning.
- Tradeoffs/risks: More controls can clutter the chart; keep them visible only on hover or in a compact toolbar.

## Quick wins (top 3 high-impact/low-effort)
1. Rename "System Health (Monte Carlo)" to "COA Success Likelihood" and place the existing `±CI` text next to the gauge.
2. Replace `mc-likely` and report `oddsTable` text with a horizontal bar list using the existing `nodeOdds` array.
3. Add an "Analysis columns" table toggle for cascade score, resource generation, subsystem, vulnerabilities, and MGRS/precise coordinates.

## Open questions for the human review
- What probability bands should be used for operator language: go, marginal, revise, or reject?
- Should target odds be organized primarily by target, domain, echelon, or COA step?
- Should the task-org view intentionally stay Blue/Red only, or should it display any visible green, yellow, and third-party entities when present?
- Is "impact" a mission-effect score, a damage proxy, or a briefing metric that needs a visible definition and axis label?
