# CHANGE_ORDER `CO-003` — mil-std-2525-symbology

> Produced by program-architect 2026-06-26 from PROGRAM_BRIEF `2026-06-26-credible-warfighting-tool.md`.
> Single biggest "looks pro" upgrade after the globe migration. Cost: one vendored JS file.

---

## 1. Gap this closes

The 2D map and (after CO-002) the 3D globe show colored dots for nodes. The scenarios
*carry* the doctrinal fields needed to render real MIL-STD-2525D symbology — `team`
maps to affiliation (friend/hostile/neutral/unknown), `subsystem` maps to function ID
(C2, Firepower Strike, Logistics, ISR, EW, etc.), `domain[]` covers battle dimension
(Land/Air/Sea/Space/Cyber). The renderer just doesn't use them.

Colored dots are a tell. 2525 symbology is what credible C2 / planner tools ship.

## 2. Industry reference

- **Name:** milsymbol.js (also published as `milsymbol-esm` for ESM consumers)
- **License:** MIT
- **Air-gap-friendly:** **yes**. Pure JS, no deps, single file. Drop into `vendor/`.
- **Standards supported:** MIL-STD-2525C / 2525D / 2525E, STANAG APP-6 B / D / E, FM 1-02.2.
- **Performance:** ≥1000 symbols / 20 ms (SVG output).
- **Citation:** [milsymbol on GitHub](https://github.com/spatialillusions/milsymbol) · [milsymbol on npm](https://www.npmjs.com/package/milsymbol) · [milsymbol-esm](https://github.com/rinzeb/milsymbol-esm)
- **Why this over alternatives:** the only modern, single-file, no-deps, MIT pure-JS implementation. Alternative libs are heavier or NATO-only or stale.

## 3. Acceptance criteria

- [ ] **Symbology vendored.** `vendor/milsymbol/milsymbol.js` (+ `LICENSE`).
- [ ] **2D Map (Leaflet):** every node renders as a 2525D symbol (SVG, scaled to ~32 px) instead of a colored dot. Click semantics unchanged.
- [ ] **3D Globe (Cesium, post-CO-002):** every node renders as a 2525D billboard. Click semantics unchanged.
- [ ] **Task-Org chart (existing):** if it already uses any symbology, harmonize so the same symbol style appears in all three views for the same node.
- [ ] **Field mapping:**
  - `node.team === 'blue'` → affiliation **Friend** (cyan)
  - `node.team === 'red'`  → affiliation **Hostile** (red)
  - `node.team === 'neutral'` or absent → affiliation **Unknown** (yellow)
  - `node.domain[0]` ∈ {Land, Air, Sea, Space, Cyber} → battle dimension
  - `node.subsystem` → function modifier (Command & Control / Firepower Strike / Logistics / ISR / EW / etc. — short mapping table in code)
- [ ] **Legend.** A small legend panel (toggleable) explains the symbology in plain English for non-doctrine readers ("blue square = friendly unit; red diamond = enemy unit; symbol inside = role").
- [ ] **Performance.** With 224 nodes (Blue 90 + Red 150 - 16 overlap) loaded, switching to Map Mode renders all symbols in < 250 ms.
- [ ] No console errors. Gate passes.

## 4. Scope

- **MAY touch:** `map.js` (replace `L.marker` icon HTML with a milsymbol SVG), `engine.js` Cesium path (set `billboard.image` to a milsymbol-generated data URL), `views.js` (task-org alignment), `vendor/milsymbol/*` (new), `StrikeSim2040.html` (include the new vendor script + the new legend panel), one new file `symbology.js` (the field-to-SIDC mapping, small module).
- **MUST NOT touch:** the force-graph 3D view (it's an abstract network graph — symbology there would be visual noise; keep it as colored nodes), scenario JSONs, `campaign.js`, `game.js`, `wargame.js`, public module APIs.
- **Schema changes:** none. Symbology is derived from existing fields.

## 5. Work plan

1. **Vendor milsymbol.** Download the latest release JS to `vendor/milsymbol/milsymbol.js`; add `vendor/milsymbol/LICENSE`. Include in `StrikeSim2040.html`.
2. **Create `symbology.js`** as a new module: `window.SymbologyModule`. One exported function: `sidcFor(node) → string` (returns the 2525D SIDC code) plus `symbolFor(node, opts) → SVG element / data URL`. Keep the subsystem→function-ID mapping table small and explicit.
3. **2D Map.** In `map.js`, change marker creation: for each node, call `SymbologyModule.symbolFor(node, {size: 32})`, get an SVG, wrap in an `L.divIcon`. Drop the `circleMarker` color path.
4. **3D Globe (Cesium).** In `engine.js`'s geo-mode entity loop (added in CO-002), set `billboard.image = SymbologyModule.symbolFor(node, {asDataURL: true, size: 64})`. Cesium re-renders billboards efficiently.
5. **Legend.** Add a small toggleable panel (`#wg-legend` or similar, follow the pattern in `wargame.js`). Show 6-8 example symbols with plain-English captions.
6. **Update README** "Architecture" table: add `symbology.js`; mention vendored milsymbol under "vendored libraries."
7. **Smoke test.** Document the click sequence (below). Add a screenshot to `tools/screenshots/` for the baseline.

## 6. Smoke test

```bash
cd "Strike Sim"
python3 -m http.server 8000 &
SERVER=$!
sleep 1
open http://localhost:8000/StrikeSim2040.html
# Switch to Map Mode. Confirm: every blue node is a 2525 friendly symbol; red nodes hostile diamonds.
# Switch to Geo Mode. Confirm: same symbols on the globe at lat/lon.
# Toggle Legend. Confirm: panel opens, shows 6-8 example symbols.
# Click a node on the map. Confirm: same node highlights in the panel/HUD.
kill $SERVER
```

Expected: every node on map and globe shows a 2525-conformant symbol matching its `team` (affiliation) and `subsystem` (function). No console errors.

## 7. Dependencies

- **Blocked by:** CO-001 (clean console), CO-002 (Cesium globe — symbology needs both views to land in the same change).
- **Blocks:** CO-004 only loosely — the COP layer architecture can reuse `SymbologyModule`, but CO-004 doesn't *require* CO-003 first.

## 8. One-line invocation

```text
Claude Code:   "Execute change-orders/CO-003-mil-std-2525-symbology.md end-to-end. Vendor milsymbol — no CDN. Build SymbologyModule first; verify it returns a recognizable SVG for one Blue node before touching map.js / engine.js. Show me the legend panel screenshot before claiming done."
Codex CLI:     "codex exec --file change-orders/CO-003-mil-std-2525-symbology.md"
Generic:       "Implement the change order in change-orders/CO-003-mil-std-2525-symbology.md."
```

## 9. Rollback

`git revert` the merge commit. CO is additive (`vendor/milsymbol/`, new `symbology.js`, panel) plus two surgical edits to `map.js` and `engine.js`.
