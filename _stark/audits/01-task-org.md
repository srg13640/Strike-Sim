# Audit: Task Org view
Scope: the Task Org / wire-diagram surface (views.js buildOrgTree/renderOrgChart/drawMilBox/fitOrgChartToView + #org-chart CSS/markup in StrikeSim2040.html). Worst-first; the layout math is the priority.

## [P0] Tree is near-flat: every "command" node becomes a top-level sibling
- Where: views.js:87-106 buildOrgTree (`commandNodes = teamNodes.filter(... includes('command'))`; `anchors = commandNodes`)
- Problem: The data has 13 Blue and 17 Red nodes whose type contains "command" (Corps Main CP, every Division TOC, every Group Army HQ, Theater Command JOCs, etc.). ALL of them are pushed directly under the team root as siblings (`anchors.forEach(... root.children.push)`). The result is root → 13-17 wide siblings → a shallow 2-3 level fan. That is exactly the "one very wide near-flat row, cramped strip across the top, huge void below" the screenshot shows. The echelon hierarchy (Corps > Division > Brigade > Battalion) is collapsed flat because there is no parent/child resolution between command nodes.
- Fix: Build a real echelon hierarchy. Pick ONE root command per team (the highest echelon — e.g. the node whose name/type matches Corps/Theater/JOC, or the command node with the most connections / highest importance) and attach the other command nodes as descendants by walking the link graph (BFS from the single root, each command becomes the parent of the subordinate commands/units it links to) instead of treating all 13-17 as siblings. If link data is too sparse to nest, fall back to an echelon-rank heuristic (Corps=0, Division/Group Army=1, Brigade=2, Battalion/unit=3 parsed from name/type) and parent each node to the nearest higher echelon. Target depth 4-5, breadth <= ~6 per parent.
- Effort: L

## [P0] Card x-spacing is between node CENTERS, so wide subtrees overlap horizontally
- Where: views.js:136-147 (`nodeSize {w:216}`, `nodeSpacingX 252`, `tree().nodeSize([nodeSpacingX, levelSpacingY])`, `separation((a,b)=> a.parent===b.parent ? 1.0 : 1.8)`)
- Problem: d3.tree nodeSize x is the gap between adjacent node CENTERS. With nodeSpacingX=252 and cardW=216 the centers are only 252 apart, leaving 36px between sibling cards — but the cards are drawn centered on d.x (`translate(shiftX + d.x - w/2, ...)`), so any two adjacent cards under different parents (separation 1.0 between siblings means 252 center-to-center = only 36px gap; this is tight but the real collision is) when a parent has several children the subtree widths sum and adjacent SUBTREES are only separated by 1.8*252=453 between their boundary nodes — far less than the combined half-widths of wide cards — so adjacent unit names collide/truncate into each other (the observed horizontal overlap).
- Fix: Make horizontal spacing exceed card width with a real gutter. Set nodeSpacingX = cardW + gutter = 216 + 60 = 276 minimum; raise sibling separation so the gap scales with card width: `separation((a,b)=> (a.parent===b.parent ? 1.15 : 2.2))` (1.15*276 ≈ 317 center-to-center = ~100px gap). Better: switch to a vertical/indented layout (see next item) where horizontal collisions disappear entirely. Verify after change that `d3.max(x)-d3.min(x)` (treeWidth) leaves >= 24px clear between every pair of same-depth cards.
- Effort: M

## [P0] Two teams forced side-by-side into half-width columns guarantees crowding
- Where: views.js:134-153 (`teams=['blue','red']`, `colW = width/teams.length`, `centerX = idx*colW + colW/2`, `shiftX = centerX - (minX+treeWidth/2)`)
- Problem: Each team's whole tree is squeezed into half the viewport width and centered in it. A 13-17-wide flat tree cannot fit in ~half of a ~900px canvas, so cards overlap and the two roots sit far apart (blue center-left, red center-right) with a void below. Side-by-side is the wrong topology for two deep org trees.
- Fix: Stack the two teams VERTICALLY (Blue tree on top, Red below) each using the FULL canvas width, separated by a labeled divider. Compute each team's tree height and offset Red's shiftY by Blue's bottom + a band gap (~80px). Let the canvas grow tall and rely on the existing `#org-chart { overflow:auto }` + zoom/pan to scroll. This removes the half-width squeeze and the awkward left/right root placement.
- Effort: M

## [P0] fitOrgChartToView zooms the whole (huge) diagram to fit, making cards unreadable
- Where: views.js:195-213 fitOrgChartToView; called at views.js:192
- Problem: It computes a single scale to fit the entire bounding box into the viewport (`scale = min(... (width-60)/box.width, (height-60)/box.height)`, floor 0.3). With a 13-17-wide tree box.width is thousands of px, so scale clamps near 0.3 — cards render at ~65px tall and text is illegible, producing the "cramped strip" look. Auto-fit-to-everything is wrong for a large org chart.
- Fix: Do NOT fit-to-whole-diagram. Initialize at a readable scale (1.0) and position the FIRST root (and its top echelon) at the top-left/top-center of the viewport, letting the rest scroll. Optionally add a "Fit" button for an explicit zoom-to-extent. If keeping auto-fit, raise the floor to ~0.7 and only fit horizontally for the active/expanded team.
- Effort: S

## [P1] Selection from the org chart does not repaint the selected card (sync broken)
- Where: views.js:179-185 (click -> `selectNodeById`); StrikeSim2040.html:2134-2154 selectNode (no `renderOrgChart()` call); drawMilBox reads `ctx.getSelectedNode()` at views.js:221
- Problem: Clicking a unit card calls selectNodeById -> selectNode, which updates 3D camera + map highlight + details panel but never re-renders the org chart. So `.mil-box.selected` (the accent outline/glow at views.html CSS:348) never appears when you select inside the Task Org view, and selecting elsewhere doesn't reflect here either. Selection feedback is effectively missing in this surface.
- Fix: In selectNode, after updating selectedNode, call `if (orgModeEnabled) renderOrgChart();` (or a lighter-weight pass that just toggles the `.selected` class on the matching card without a full rebuild). Re-render is cheap relative to the rebuild cost; the targeted class-toggle is the clean version.
- Effort: S

## [P1] milsymbol icon overlaps the unit name; symbol box and text gutter collide
- Where: views.js:253-268 (image at `x:8 width:40`, name text at `tx=58`) and drawMilBox header; confirmed in taskorg-proof render where the diamond sits on top of the name
- Problem: The 40px-wide symbol image starts at x=8 and the milsymbol glyph's intrinsic SVG often draws wider than its nominal box, so the symbol visually overruns past x=48 into the name that starts at x=58 — names like "I Corps (Pacific Shield)..." render with the icon on top of the first letters. Only ~8px clearance.
- Fix: Widen the icon gutter: place the symbol in a fixed 44px column (x:8, w:36, centered) and move name/sub/health text to tx=60-64; or shrink the symbol to size:26 and clip/contain it to a 34px box. Ensure the name's left edge is >= symbol right edge + 10px.
- Effort: S

## [P1] Names truncate at 24 chars, so most command cards are indistinguishable
- Where: views.js:265-266 (`rawName.length > 24 ? slice(0,23)+'…'`); CSS .org-name font-size 12.5px
- Problem: Card is 216px wide with text starting at x=58 -> ~150px for the name. Real names are long and share prefixes ("Eastern Theater Command JOC Fuzhou", "Eastern TC Army HQ Nanjing", "Eastern TC Navy HQ Ningbo"); truncating at 23 chars collapses them to near-identical strings ("Eastern Theater Com…", "Eastern TC Army HQ N…"). The user cannot tell units apart.
- Fix: (a) Widen unit cards to ~240-260px once horizontal spacing is fixed, raising the truncation budget. (b) Truncate the COMMON-but-redundant tail intelligently — show the distinguishing token (city / unit number) rather than a blind head-slice. (c) Add a `<title>`/tooltip with the full name on hover. (d) Drop boilerplate ("Command", location prefixes) from the displayed label and surface the echelon + designator.
- Effort: M

## [P1] "Attachments" dumps every unmatched node into one giant flat fan
- Where: views.js:108-109 (`extras = teamNodes.filter(!used).map(mk)`; `root.children.push({name:'Attachments', children:extras})`)
- Problem: Any node not reached via the 2-hop anchor walk (and with ~104/120 nodes and only 3 levels of walk, that's a LOT) is piled under a single "Attachments" parent as flat siblings. That single parent then has dozens of children -> another massive horizontal blowout and a meaningless bucket. This is a second source of the wide-flat-row symptom.
- Fix: Once the real echelon hierarchy (P0 #1) attaches nodes by link/echelon, "Attachments" should be near-empty. For genuine orphans, group them by domain or parent-command into small sub-buckets (<= 8 each) rather than one flat list, and lay them out in a wrapped grid, not a tree row.
- Effort: M

## [P1] Vertical level spacing too tight for 58px cards + health bar + labels
- Where: views.js:138 (`levelSpacingY = 132`), drawMilBox card height 58
- Problem: levelSpacingY=132 is the gap between level centers; with 58px cards that leaves 74px between a card's bottom and the next card's top, but the elbow link (`M..V midY H.. V..`) plus the chevron/health overhang make levels feel cramped, and once the tree is properly deep (P0 #1) the vertical run needs to breathe. Currently vertical space is wasted because the tree is flat, not because spacing is generous.
- Fix: After deepening the tree, set levelSpacingY = cardH + 90 = ~148 for clear elbow routing; keep marginTop ~44. Validate links don't cross card bodies.
- Effort: S

## [P2] Elbow links anchor to card bottom-center but cards are center-translated — minor misalignment at wide spacing
- Where: views.js:163-169 (`sx = shiftX + d.source.x; sy = ... + nodeSize.h`)
- Problem: Source y uses `d.source.y + nodeSize.h` while node group is translated by `d.y - h/2`, so the link starts at `d.y + h/2` (card bottom) — correct — but target y is `d.target.y` (card center, since target group is at `d.y - h/2`), so links terminate at the child card's vertical center, not its top edge. Lines visibly pierce into the child card.
- Fix: Set target y to the child's TOP edge: `ty = shiftY + d.target.y - nodeSize.h/2`. Then the elbow lands on the top border cleanly.
- Effort: S

## [P2] Expand/collapse only on the root header; not discoverable, all-or-nothing
- Where: views.js:142,178-184 (root click -> toggleOrgTeam); only the team root toggles; orgExpandedTeams default both expanded
- Problem: The only interactive collapse is the whole-team toggle on the header box. Individual command/echelon branches cannot be collapsed, so a deep tree can't be pruned to focus. The chevron is the sole affordance and sits only on the root. With both teams expanded by default you immediately get the worst-case clutter.
- Fix: Add per-branch collapse: give every node with children a chevron and a click handler that toggles a `collapsed` set keyed by node id; in buildOrgTree, stop descending into collapsed ids. Default to collapsing below the first echelon (show roots + their direct subordinates) so the initial view is clean.
- Effort: M

## [P2] No team labels / divider / echelon legend; affiliation only via stroke color
- Where: views.js header card (drawMilBox isRoot branch) and overall canvas; CSS .org-* 
- Problem: Team identity is carried only by card stroke color and the root header text. There's no persistent band/label separating Blue vs Red once you scroll, and no legend for the milsymbol affiliations/echelons. Color-only encoding fails for color-blind users and is lost when zoomed.
- Fix: When stacking teams vertically (P0 #3), add a sticky/anchored team band label ("BLUE — US/ALLIED", "RED — PLA") at the top of each tree and a thin divider rule between them. Add a small echelon legend (Corps/Div/Bde/Bn) keyed to indentation or symbol modifier.
- Effort: S

## [P2] Importance star overlaps long names in the top-right of the card
- Where: views.js:279-281 (`★ importance` at `x: w-12, y:21`, text-anchor end) vs name at y:21 from x:58
- Problem: Both the name (left-anchored, y=21) and the importance star (right-anchored, y=21) sit on the same baseline. For long names the truncated text ellipsis runs right up to / under the star (visible in the proof render where "…" collides with "★ 10"). 
- Fix: Reserve the right ~36px for the star: cap name width to `w - tx - 40` before truncation, or move the star to the sub-line / a corner badge so it never shares the name's horizontal track.
- Effort: S
