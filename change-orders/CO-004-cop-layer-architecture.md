# CHANGE_ORDER `CO-004` — cop-layer-architecture

> Produced by program-architect 2026-06-26 from PROGRAM_BRIEF `2026-06-26-credible-warfighting-tool.md`.
> The architectural backbone that makes every future feature cheap. Hardest of the
> first four COs. Do it after CO-001, CO-002, CO-003 are stable.

---

## 1. Gap this closes

Today's rendering is monolithic per view: one Leaflet map, one force-graph 3D, one
(soon to be) Cesium globe. Every future capability — range rings, sensor cones,
threat envelopes, replay overlays, EW emitter ellipses, fire-support coordination
measures — would otherwise mean *editing the renderer*. Industry-standard C2 tools
solve this with a **layered COP** — Common Operational Picture decomposed into
named, independently-toggleable, independently-owned layers. Each new capability
becomes "add a layer," not "refactor the world."

## 2. Industry reference

- **Pattern:** Palantir Gaia / Maven 7-layer COP stack.
  - Layer 1: **Base map / terrain / imagery** (CesiumJS imagery + 2D Leaflet basemap)
  - Layer 2: **Static operational overlays** (phase lines, named areas of interest, objectives)
  - Layer 3: **Dynamic overlays** (FSCMs, no-fly areas, ROZ, ACAs — time-bounded)
  - Layer 4: **Logistics** (lines of communication, FOBs, resupply points)
  - Layer 5: **EW / SIGINT** (emitter locations + uncertainty ellipses)
  - Layer 6: **Threat** (hostile + unknown tracks)
  - Layer 7: **Friendly force** (blue force tracks)
- **Citation:** [Building a COP in Workshop — Palantir Learn](https://learn.palantir.com/appdev-06) · [Common Operational Picture — Corvus Intelligence](https://corvusintell.com/blog/c2-systems/cop-common-operational-picture/)
- **Variant adopted:** the Lattice "bag of components" principle — layers don't strictly type their entities; they read whichever components they need.

## 3. Acceptance criteria

- [ ] **`layers/` module directory** exists (one file per layer). Each layer module exports `{ init(ctx), render(graph, viewport), setVisible(bool), destroy() }`. Pattern matches the existing `Module.init({...})` discipline.
- [ ] **Layer registry** — `window.CopModule` registers layers in z-order, exposes `setLayerVisible(name, bool)`, `getLayers() → [...]`.
- [ ] **Layer panel UI.** A right-side panel lists the seven layers with toggle checkboxes + drag-to-reorder. Same panel works in Map Mode and Geo Mode (each view honors the visibility set independently).
- [ ] **Migration without regression.** The existing rendering paths in `map.js` and `engine.js` are refactored to *delegate* to the friendly-force layer (Layer 7) — they don't directly draw nodes anymore. Visible behavior identical to pre-CO-004.
- [ ] **At least three layers active** at end of CO: Layer 1 (base), Layer 7 (friendly), Layer 6 (threat — same node code, just affiliation = hostile). Other layers can be empty stubs ready for future COs.
- [ ] **Layer visibility persists** across mode switches and across page reloads (localStorage, with a `cop.layers.<name>.visible` key namespace).
- [ ] **Performance unchanged or better.** 224 nodes across 3 layers must render in ≤ previous time.
- [ ] **No console errors.** Gate passes.

## 4. Scope

- **MAY touch:** new `layers/` directory (Layer 1 / 6 / 7 stubs, 2-stub stubs for 2-5 with TODO), new `cop.js` (the registry), `map.js` and `engine.js` (refactor to delegate node rendering to the friendly + threat layers), `StrikeSim2040.html` (include + panel HTML), `views.js` (if it touches map/globe), README ("Architecture" table — add Layers section).
- **MUST NOT touch:** `campaign.js`, `game.js`, `wargame.js` (the wargame opens *on top of* the COP — it doesn't get layered into it; future CO), scenario JSONs, the public API of any existing module.
- **Schema changes:** none in data files. New runtime types only (`Layer`, `CopRegistry`).

## 5. Work plan

1. **Spec the layer contract.** Write `layers/_README.md` defining the `Layer` interface and the order. Reference Palantir's 7-layer stack explicitly.
2. **Build `cop.js`** as `window.CopModule`. Methods: `register(layer)`, `setVisible(name, bool)`, `forEachVisible(cb)`, `destroy(viewName)`. Has a Map<viewName, Set<layerName-visible>>.
3. **Build `layers/01-base.js`, `layers/06-threat.js`, `layers/07-friendly.js`** — three real layers. The friendly + threat layers absorb the node-drawing code currently inlined in `map.js` and `engine.js`. They filter by `team`.
4. **Build stubs** for Layers 2–5: each exports the interface, `render()` is a no-op, the file has a comment block describing what *will* go here.
5. **Refactor `map.js`** to remove direct node rendering. Instead, on each refresh, iterate `CopModule.forEachVisible('map', layer => layer.renderOn(map))`.
6. **Refactor `engine.js`** geo-mode path the same way for the Cesium viewer.
7. **Add the layer panel UI** in `StrikeSim2040.html`. Wire it to `CopModule.setVisible()`. Persist toggles in `localStorage`.
8. **Smoke test.** Document the click sequence (below). Update README's Architecture section.

## 6. Smoke test

```bash
cd "Strike Sim"
python3 -m http.server 8000 &
SERVER=$!
sleep 1
open http://localhost:8000/StrikeSim2040.html
# Open the new Layers panel.
# Toggle Layer 6 (Threat) off. Confirm: red nodes disappear from map and globe; blue nodes stay.
# Toggle Layer 7 (Friendly) off. Confirm: blue nodes disappear too.
# Reload the page. Confirm: layer toggle state restored.
# Switch to Map Mode and Geo Mode. Confirm: independent toggle state per view if intended, OR shared — pick one and document it.
kill $SERVER
```

Expected: layer toggles work, persist, do not regress existing visible behavior.

## 7. Dependencies

- **Blocked by:** CO-001 (clean console), CO-002 (Cesium globe — Layer 1 base is mostly CesiumJS), CO-003 (symbology lives in the friendly/threat layers).
- **Blocks:** CO-007 (range rings = a layer), CO-008 (replay = a layer), CO-006 (Lattice entity model + 7 layers compose), every future visual capability.

## 8. One-line invocation

```text
Claude Code:   "Execute change-orders/CO-004-cop-layer-architecture.md end-to-end. Read it twice — the contract matters. Write the Layer interface and the layers/_README.md first, get me to sign off, then refactor map.js and engine.js. Use subagents for the parallel layer-module work. Show me the layer panel screenshot + the localStorage persistence test before claiming done."
Codex CLI:     "codex exec --file change-orders/CO-004-cop-layer-architecture.md"
Generic:       "Implement the change order in change-orders/CO-004-cop-layer-architecture.md. The layer contract is the most important thing; if anything is unclear, stop and ask."
```

## 9. Rollback

`git revert` the merge commit. CO is additive (`layers/`, `cop.js`, panel) + two refactor diffs (`map.js`, `engine.js`). Revert restores pre-layer rendering.
