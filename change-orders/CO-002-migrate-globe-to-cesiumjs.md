# CHANGE_ORDER `CO-002` — migrate-globe-to-cesiumjs

> Produced by program-architect 2026-06-26 from PROGRAM_BRIEF `2026-06-26-credible-warfighting-tool.md`.
> The single highest-visible-impact change in the program. Done well, the next demo
> reads as a Maven cousin, not a prototype.

---

## 1. Gap this closes

The 3D earth is currently a Three.js sphere with a custom shader atmosphere and a 2K
Blue Marble texture (`engine.js`, `EARTH_RADIUS = 398`). It's a careful, pretty
prototype — but credible C2 / ISR tools use **CesiumJS**: true WGS84 3D globe, real
terrain, real 3D Tiles, real lat/lon math. The Three.js sphere caps how serious the
tool can ever look.

## 2. Industry reference

- **Name:** CesiumJS
- **License:** Apache 2.0
- **Air-gap-friendly:** **yes**. Three viable paths:
  1. **Lightest:** Vendor `Cesium.js` + `Cesium/` static assets into `vendor/`. Use a built-in low-res world imagery layer (offline) + the bundled Cesium World Terrain *or* a flat ellipsoid. Zero servers needed.
  2. **Tiles:** Add an offline tile pipeline using `pmtiles` (a single-file tile bundle) served via static HTTP. Pre-generate one `pmtiles` for the Indo-Pacific theater.
  3. **Heavy:** Deploy Cesium ion Self-Hosted (Helm chart). Reserve for an actual IL5/IL6 enterprise.
- **Citation:** [CesiumJS — Cesium](https://cesium.com/platform/cesiumjs/) · [Offline Guide](https://github.com/CesiumGS/cesium/blob/main/Documentation/OfflineGuide/README.md) · [Self-hosted basemap tutorial — KeiMaps](https://medium.com/@keimapsapp/creating-a-cesiumjs-application-using-a-self-hosted-basemap-f6fd482fde37) · [Cesium ion Self-Hosted](https://cesium.com/platform/cesium-ion/cesium-ion-self-hosted/)
- **Why this over alternatives:** deck.gl is a layer-overlay library — it doesn't *replace* the globe, it sits on top of a Mapbox-style basemap. Mapbox GL is proprietary and skips IL5/IL6. CesiumJS is the only Apache-2.0 true-3D-earth library credible C2 tools use.

**Start with path 1.** Path 2 is a follow-on CO.

## 3. Acceptance criteria

- [ ] Clicking **Geo Mode** shows a **CesiumJS Viewer** with a 3D earth (real WGS84, real lat/lon).
- [ ] The 2D Leaflet **Map Mode** still works as before, untouched.
- [ ] The force-directed graph view (default) still works as before — the Three.js / 3d-force-graph instance is preserved for that view.
- [ ] All Blue + Red nodes from the loaded scenarios render as billboards / entities on the Cesium globe at their lat/lon, colored by team.
- [ ] Camera frames the operational theater (Indo-Pacific bounds, same envelope `map.js` uses) on first Geo Mode entry, within 2s.
- [ ] Clicking a node on the globe selects it the same way clicking it on the graph does (selection state persists across views — `selectedNode` is the shared truth).
- [ ] Switching Geo Mode → Map Mode → Graph Mode → Geo Mode causes **no console errors** and no memory growth visible in DevTools over 60s.
- [ ] Build runs **fully offline** — disconnect from the network, hard-reload, Geo Mode still renders.
- [ ] `node tools/wargame-loop-gate.js` returns exit 0.
- [ ] Smoke test (below) passes.

## 4. Scope

- **MAY touch:** `engine.js` (replace the geo-mode globe lifecycle; keep the force-graph 3D engine intact for the network view), `StrikeSim2040.html` (include the new vendored CesiumJS), `vendor/cesium/*` (new), `assets/` (small basemap imagery if Cesium's bundled offline asset isn't enough), `map.js` (no changes — preserved), README (update the "what you can do" + "Architecture" tables with CesiumJS).
- **MUST NOT touch:** `campaign.js`, `game.js`, `wargame.js`, scenario JSONs, the force-graph view code path, `MapModule`'s public API, any module's public method names.
- **Schema changes:** none. CesiumJS reads `lat`/`lon` directly from existing node objects.

## 5. Work plan

1. **Download CesiumJS release** (latest stable, ~1.135+ in mid-2026). Vendor into `vendor/cesium/`. Add `vendor/cesium/LICENSE.md` (Apache 2.0).
2. **Add the Cesium include** to `StrikeSim2040.html` *guarded* so it only loads when Geo Mode is first entered (lazy import — avoid the ~5 MB load up front).
3. **Refactor `engine.js`'s geo-mode path** to construct a `Cesium.Viewer` (or `CesiumWidget` for a leaner build) inside the Geo Mode container div. Remove the `earthMesh` / shader-atmosphere code path *for geo mode only* — the network-view force-graph 3D scene stays intact.
4. **Build the entity layer.** Iterate the active scenario's `AppState.activeGraph().nodes`. For each node with `lat`/`lon`, add a `Cesium.Entity` (billboard or point + label) with `id = node.id`, color = team color. Click handler → `selectNode(node.id)`, same as graph view.
5. **Camera framing.** On first geo-mode entry, fly to the Indo-Pacific envelope `THEATER_SATELLITE_BOUNDS` from `map.js`. Use Cesium's `viewer.camera.flyTo`.
6. **Verify offline.** Stop the network. Hard reload. Confirm globe renders. If Cesium tries to fetch `ion.cesium.com` for default imagery, swap to its bundled `createWorldImageryAsync` with `style: IonWorldImageryStyle.AERIAL` and `useDefaultProviders: false`, or to a local single-imagery layer (e.g. the existing `earth-blue-marble-webmercator-2048.jpg` as a `SingleTileImageryProvider`).
7. **Update README.** "Architecture" table: replace the bullet for `engine.js`'s globe with "Geo Mode now uses CesiumJS (Apache 2.0, vendored offline)."
8. **Add a smoke test** to `tools/`: headless-browser load, switch to Geo Mode, screenshot, save to `tools/screenshots/geo-mode-baseline.png`. The CO is done when this screenshot shows a recognizable globe with nodes on it.

## 6. Smoke test

```bash
cd "Strike Sim"
python3 -m http.server 8000 &
SERVER=$!
sleep 1
# Open in browser
open http://localhost:8000/StrikeSim2040.html
# Click Geo Mode. Wait for globe.
# Confirm: 3D earth, blue ocean, brown continents, nodes pinned to lat/lon.
# Disconnect Wi-Fi.
# Cmd-Shift-R hard reload.
# Click Geo Mode again. Confirm: same globe, no errors.
kill $SERVER
```

Expected: full WGS84 globe; all blue + red scenario nodes at correct lat/lon; works offline.

## 7. Dependencies

- **Blocked by:** CO-001 (clean console). Don't refactor the globe on top of a broken baseline.
- **Blocks:** CO-003 (the symbology layer renders against Cesium entities), CO-007 (range rings need Cesium primitives).

## 8. One-line invocation

```text
Claude Code:   "Execute change-orders/CO-002-migrate-globe-to-cesiumjs.md end-to-end. Use the work plan. Stop and show me a screenshot of Geo Mode after step 6 and the offline reload after step 6 before claiming done. Vendor CesiumJS — do NOT add a CDN dependency."
Codex CLI:     "codex exec --file change-orders/CO-002-migrate-globe-to-cesiumjs.md"
Generic:       "Implement the change order in change-orders/CO-002-migrate-globe-to-cesiumjs.md. Stay air-gap-friendly; vendor every asset."
```

## 9. Rollback

`git revert` the merge commit. CesiumJS is additive (new files in `vendor/cesium/`), and the geo-mode refactor is one diff in `engine.js` — revert restores the Three.js sphere lifecycle cleanly.
