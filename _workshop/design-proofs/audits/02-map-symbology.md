# Audit: Map + symbology

Scope: 2D Leaflet map (map.js) + tactical symbology (symbols.js). Verified by running
tools/milsymbol-proof.js and tools/rings-proof.js and rasterizing the output. Headline
data facts that drive several findings below: the 224 nodes occupy only **lon 109–145.7,
lat -14.6–40.7** (a tight West-Pacific box, NO node west of -25 and NONE near the dateline);
**importance ranges 5–10, not 0–12**; and milsymbol reports **only 127/224 SIDCs valid —
all 97 air/sea/space nodes fail.**

## [P0] Every air / sea / space unit renders as a GROUND frame — domain is lost
- Where: symbols.js:200-204 `FN_2525`, :222-250 `milSymbol()` attempt chain; proof: tools/milsymbol-proof.js prints "SIDC valid (domain dimension): 127/224"
- Problem: `FN_2525` holds only **ground** function IDs (`UC----`, `UCR---`, `UCF---`, …). Those positions are invalid in the Air (`A`), Sea (`S`), and Space (`P`) dimensions, so the first attempt `[domainDim, fn]` fails `isValid()` for all 36 air + 39 sea + 22 space nodes (97 total, 43%). The retry chain then falls to attempt 2 `['G', fn]` → a **ground frame**. Result (confirmed in _stark/milsymbol-proof.svg): the whole COP is red diamonds + blue rectangles; there is not a single air "dome" or sea frame on the map. A COP whose entire value is reading air vs sea vs ground at a glance shows none of it. `sidcFor()` (the exported/tested function, symbols.js:214-219) has no fallback at all, so it returns the invalid SIDC verbatim.
- Fix: add per-dimension function tables (or use milsymbol battle-dimension-neutral function IDs). Air track function IDs live in the `A` dimension space (e.g. fixed/rotary-wing `MFx---`), sea-surface in `S` (`CLxx--`), space in `P`. Minimum viable: pick one valid generic function per dimension (air = `MF----`, sea surface = `CL----`, subsurface as needed, space = `S_`-appropriate) and key the table by `[dimension][functionKey]`, only falling to ground when the domain truly is land/cyber/ew. Re-run milsymbol-proof and require 224/224 valid before shipping.
- Effort: M

## [P0] Marker overlap / clutter — co-located units stack with no declustering
- Where: map.js:346-378 `refreshMapMarkers` (one divIcon per node, no spiderfy/cluster); data: 7 clusters of ≥4 units within 0.1°, worst 5 stacked at Okinawa (26.3,127.8) and Tokyo (35.5,139.4)
- Problem: 224 ~21–26px symbols are placed at raw lat/lon with no collision handling. _stark/milsymbol-proof.svg shows the central red mass as an unreadable pile — symbols fully occlude each other, you cannot count or click the units underneath. This is the single most visible defect. `riseOnHover` only lifts one on hover; it does nothing for the static picture or for the hidden markers' clickability.
- Fix: add Leaflet.markercluster (vendor it for offline) OR, lighter-weight and offline-native, a deterministic spiderfy/jitter: detect nodes sharing a cell at the current zoom and fan them on a small circle (radius ∝ count) around the centroid, drawing a faint leader line back to the true position. At minimum, sort markers so higher-importance render last (on top) and add `zIndexOffset = importance*10` so the high-payoff node is always the clickable one on top.
- Effort: M

## [P1] Engagement rings blanket the theater — fires radii too large, too many, lopsided
- Where: map.js:388-402 `engagementZone` (`fires: 260 + imp*145`), :417-442 `refreshRangeRings` (`MAX_RINGS=22`, `imp>=6`); proof _stark/rings-proof.svg
- Problem: fires radius reaches `260 + 10*145 = 1710 km`. With 47 Fires nodes at importance 5–10, the top-22 selection is dominated by red fires rings that overlap into one solid haze over the hostile side (visible in rings-proof.svg), while the blue side has only a few — the overlay reads as lopsided noise, the opposite of the "key envelopes" intent. The `imp>=6` gate + global top-22 sort means which rings appear is driven by importance, not by tactical relevance or affiliation balance.
- Fix: (a) cap/compress fires radius to a realistic band (e.g. 150–900 km) and use a sub-linear scale; (b) balance the selection — top-N per affiliation and/or per kind rather than one global top-22, so blue and red are both represented; (c) consider showing rings only for the **selected** node + its neighbors by default, with the full overlay as the opt-in toggle (the toggle already exists). Re-run rings-proof to confirm the haze is gone.
- Effort: M

## [P1] Symbol sizing range collapsed — importance 5–10 mapped as if 0–12
- Where: map.js:354-356 `imp = clamp(0..12); size = 17 + imp*0.9`; same in tools (size = 17 + imp*0.9)
- Problem: real importance is 5–10, so size only spans **21.5–26px** — a 4.5px (≈20%) spread that is visually indistinguishable. The "high-payoff nodes read first" intent fails; everything looks the same size, which compounds the overlap problem (P0) because nothing stands out to render on top. The `0..12` clamp is calibrated to data that doesn't exist.
- Fix: normalize to the actual range. e.g. `t = (imp-5)/5` (0..1), `size = 18 + t*16` → 18–34px, a real, legible spread. Tie this to the z-ordering fix in the overlap item so the biggest symbols are also on top.
- Effort: S

## [P1] minZoom clamp fights fit-to-markers; on resize the view zooms out to whole Pacific
- Where: map.js:322-331 `clampMinZoom` (fits the full 60°–295° `PACIFIC_BOUNDS`), :527-537 `fitMapToMarkers`, :316 init order, :554-556 `invalidateSize`
- Problem: `clampMinZoom` sets minZoom to whatever makes the **235°-wide** Pacific envelope fit the viewport — but all markers live in a ~37°-wide sliver (109–145.7). On a normal-aspect window that min-zoom is very far out. On initial load fit() runs last so it wins, but `invalidateSize()` (called on every window resize and on map-mode toggle, map.js:555) calls `clampMinZoom()` **without** re-fitting, so any resize can snap the user back out toward the whole-Pacific view, scattering the units into a tiny clump. The envelope is sized for dateline-crossing data that this scenario does not contain.
- Fix: clamp minZoom to a frame that actually bounds the data (the markers' bounds, padded) rather than the entire `PACIFIC_BOUNDS`; or after `clampMinZoom` in `invalidateSize`, re-assert the marker fit if the user hasn't manually zoomed. Given the data never crosses the dateline, shrinking `PACIFIC_BOUNDS`/`maxBounds` to the real theater also fixes this.
- Effort: M

## [P2] Dead dateline machinery — pacLon cut, +360 basemap wrap, wide bounds all unexercised
- Where: map.js:47-50 `PAC_CUT/pacLon/PACIFIC_BOUNDS`, :39 `GLOBAL_SATELLITE_BOUNDS_WRAP`, :183-185 second offline overlay
- Problem: 0 nodes have lon < -25, none approach 180°, post-shift lon max is 145.7. So `pacLon()` is a no-op on every node, the +360 wrapped basemap copy (loads a second full-world JPG) is never seen, and the 235°-wide `PACIFIC_BOUNDS`/`maxBounds` only serve to mis-clamp zoom (see prior item). This is real complexity and a wasted image fetch with no payoff for the actual scenario, and it's load-bearing in subtle ways (every marker/line/ring runs through pacLon).
- Fix: if dateline-crossing data is genuinely planned, keep but cover it with a fixture node east of 180° and a test. If not, drop the wrap overlay and tighten bounds to the theater — simpler, faster, and removes the zoom-clamp conflict. Either way, document that pacLon is currently inert for this dataset.
- Effort: S

## [P2] Online tiles wrap/repeat while the app assumes a single locked globe
- Where: map.js:84-91 (`worldCopyJump:false`, blank grid + local tiles use `noWrap:true`) vs :168-178 CARTO/Esri tile layers (no `noWrap`)
- Problem: the offline grid and local tiles are `noWrap`, but the online dark/satellite tile layers are not, so they repeat horizontally. Combined with `maxBounds` viscosity 1.0 the user can't pan into the repeats, but at the seams (and during inertia) you can get a flash of a duplicated continent, inconsistent with the "single globe" model the comments describe. Minor but visible polish issue on a COP.
- Fix: add `noWrap: true` (and a matching `bounds`) to the CARTO and Esri tile layers so all basemaps share the single-world model.
- Effort: S

## [P2] Selection setView always min-zoom 3 — can zoom you OUT when a node is selected
- Where: map.js:489 `setView(..., Math.max(getZoom(), 3))`, :549 same in `openMapPopup`
- Problem: `Math.max(zoom,3)` only raises zoom; but after the minZoom clamp the resting zoom can already be ≥3, so this usually does nothing — except it recenters with `animate:true` on every selection, yanking the map even when the node is already comfortably in view. On a dense cluster, recentering on the selected node doesn't separate it from its neighbors (overlap still hides it). The "3" is also arbitrary relative to the (broken) min-zoom.
- Fix: only pan if the selected marker is outside the current viewport (`map.getBounds().contains(latlng)` check before `setView`); when it is in view, just open the popup and apply the glow. Drop the hard-coded 3 in favor of a sensible per-cluster zoom, ideally combined with the spiderfy fix so selection actually reveals the unit.
- Effort: S

## [P2] Popups waste the rich node data — only name + id shown
- Where: map.js:376 `bindPopup(name + id)`, :487 selected popup (name + id)
- Problem: every node carries `team, domain, type, subsystem, importance, health/healthMax, status, vulnerabilities, cascScore` (confirmed in the JSON) but the popup shows only name and id. On a planning COP the operator wants affiliation, function, domain, health %, and importance at a glance without leaving the map. The two popup bind sites also duplicate markup and drift (one uses `<br>`, the other `<br/>` + muted span).
- Fix: build one `popupHtml(node)` helper rendering affiliation/domain/type, a health bar (health/healthMax), importance, and subsystem; reuse it at both bind sites. Keep it compact and dark-themed to match the basemap.
- Effort: S

## [P2] milsymbol `colorMode:'Light'` pastel fills wash out on the dark basemap
- Where: symbols.js:243 `{ colorMode:'Light', fill:true }`; AFFIL pastels symbols.js:25-30
- Problem: `colorMode:'Light'` plus the pale fills (`#bfe3ff` friend, `#ffc9c2` hostile) are tuned for a light/paper background. On the `#020814`/dark CARTO basemap the **frame outline** (the affiliation-bearing edge) is a thin pale stroke against pastel fill — adequate, but the contrast between friend-blue and neutral-green frames is muted, and on the satellite basemap the pastels glare. There's a drop-shadow filter helping, but no outline-on-dark treatment. The built-in fallback uses the same pastels.
- Fix: A/B `colorMode:'Dark'` (milsymbol's dark scheme is built for exactly this background) or add a thin dark halo/contrasting outer stroke around each symbol. Verify against both the dark and satellite basemaps with a rasterized proof.
- Effort: S

## [P2] Function glyphs are weak / missing on real symbols — COP hard to decode by role
- Where: symbols.js:200-204 `FN_2525` (ground function codes), proof _stark/milsymbol-proof.svg
- Problem: in the milsymbol render most symbols show either an empty frame or generic text modifiers ("CBT","CSS") rather than a distinctive central icon, so you can't tell Fires from Sensor from Comms at a glance — the legend (map.js:229-231) promises eight functions but the picture doesn't deliver them. (The built-in renderer in symbols.js:99-135 actually has clearer hand-drawn glyphs.) Partly a consequence of the ground-only / wrong-dimension SIDC issue (P0).
- Fix: once dimensions are correct (P0), choose 2525 function IDs whose central icons are visually distinct per role, and re-render the proof to confirm Command/Fires/Sensor/Comms/AirDef/EW/Log/Maneuver each look different. Where milsymbol lacks a crisp glyph, consider keeping the built-in renderer for that function.
- Effort: M

## [P2] Legend doesn't match what's on the map (claims air dome / sea wave / dashed-degraded)
- Where: map.js:239-240 legend notes ("Air = dome · Sea = wave", "dashed/✕ = degraded/destroyed")
- Problem: the legend teaches cues the live milsymbol render doesn't produce — no air domes/sea waves appear (P0), and milsymbol's degraded/destroyed rendering differs from the built-in dashed/✕ described. The legend samples are drawn with the built-in renderer (`Sym.svg(..., {size:26})` with Land domain), so the legend glyphs won't even match the milsymbol glyphs on the map. A viewer "decoding the COP cold" is taught a key that doesn't apply.
- Fix: after fixing dimensions/glyphs, regenerate legend samples from the **same** engine the map uses (milsymbol), and include actual air/sea sample frames. Make the degraded/destroyed note match milsymbol's `operationalCondition` rendering.
- Effort: S
