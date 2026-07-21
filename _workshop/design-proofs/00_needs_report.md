# NEEDS REPORT — Strike Sim overnight rebuild (Operator: Stark)

*Phase 0 recon. Written 2026-06-27 ~03:15 UTC. Read this first; I proceed automatically after.*

---

## 1. What Strike Sim currently is

An offline-capable, no-build browser tool ("MDSC 3D Network Visualizer" / "StrikeSim 2040")
that renders a Blue-vs-Red multi-domain force network for the West Pacific 2040 fight. It
has a Three.js 3D force-graph, a Leaflet 2D map, Geo/globe mode, table + task-org views, a
Monte-Carlo COA simulator, an NDS-aligned campaign planner (`campaign.js`), and a playable
turn-based war game (`game.js` + `wargame.js`). Architecture is genuinely disciplined: a
single HTML shell + ~11 plain-`<script>` modules with `Module.init({...})` dependency
injection, fully vendored libraries, `OFFLINE_MODE = true`, no runtime network calls. It is
**not** broken — all 12 JS modules pass `node --check`, and the recent commits already fixed
the worst prototype tells (console-error flood, WebGL context failure, map mis-registration).
What still reads as "prototype" rather than "tool" is the *visual language*: the map shows
raw colored circles, not military symbols; there is no COP-layer model, no range rings, no
replay scrubber.

## 2. Redesign thesis (5 sentences)

The architecture is already $10M-grade discipline; the **visual and analytic credibility** is
what's missing, and that is exactly where a skeptical general decides "tool" vs. "demo" in the
first 90 seconds. So the bet is to make the data *look* as serious as it already is: replace
the colored dots with real MIL-STD-2525-style tactical symbology driven by the existing
`team` / `domain[]` / `subsystem` / `type` fields, so the picture reads as a recognizable
common operational picture. That is the single highest visible-impact, fully-offline,
zero-new-dependency move available, and — critically — I can build and *verify it without a
browser* by rasterizing the generated symbols and inspecting them directly. Layered on top of
the existing campaign→wargame→sim spine, a credible COP turns this from "a nice network graph"
into "a decision-support picture an Army staff recognizes." Everything else (range rings,
replay, Cesium globe) becomes an incremental layer once the symbology and a clean COP-layer
seam exist.

## 3. Tools / connectors / credentials I need FROM THE OPERATOR

I am running air-gapped by design and `EXTERNAL_EGRESS = false`, so I am **provisioning
nothing from the network**. The items below would each unlock a meaningfully bigger jump; none
of them stop tonight's run.

| # | What I'd want | Why it matters | Impact if missing |
|---|---------------|----------------|-------------------|
| N-1 | **`milsymbol.js`** (MIT, single-file) dropped into `vendor/` | The reference MIL-STD-2525D/E renderer the program brief calls for; full SIDC support | I build a focused, doctrinally-honest 2525-*flavored* renderer myself (affiliation frame + dimension + function glyph + status). Covers the demo; not the full 2525 SIDC catalog. |
| N-2 | **CesiumJS** vendored into `vendor/` + an offline basemap (pmtiles/quantized-mesh) | CO-002: a true 3D earth is the "Maven cousin" visual | The existing Three.js globe stays. I improve its credibility (graticule, MGRS readout) instead of replacing it. |
| N-3 | **A real (or realistic) scenario** vetted by a subject-matter expert | Fidelity dimension (§1.2) survives an SME poke only if the order of battle is credible | I use the bundled `grok*.json` (already doctrinally serious per the program brief) and label it clearly as notional. |
| N-4 | **A target audience decision**: training aid vs. analytic COA tool vs. C2 display | Sharpens "real problem" (§1.1) — the three imply different default screens | I optimize for the **analytic COA / wargaming** use, which the current code is closest to, and note the assumption. |
| N-5 | **A licensed display font** (e.g. a clean condensed grotesque) for the COP chrome | Typography is part of the "looks a decade ahead" bar | I use system/`monospace` stacks already in the app; no visual regression, just less distinctive. |

## 4. What I'll do without them (degraded paths, so the run never stalls)

- **No milsymbol →** hand-rolled `symbols.js`: SVG affiliation frames (friend rounded-rect /
  hostile diamond / neutral square / unknown quatrefoil), dimension color/fill by `domain[]`,
  a function glyph by `type`/`subsystem`, and a status modifier by `health`. Pure, deterministic,
  unit-tested, with a rasterized proof sheet I actually inspect.
- **No Cesium →** keep and harden the Three.js globe; do not regress the working 3D view.
- **No vetted scenario →** ship the bundled notional Red/Blue OOB, clearly labeled "NOTIONAL —
  not based on real intelligence," which is also the right security posture.
- **No audience call →** default to the analytic COA / wargaming workflow.
- **No font →** system font stack.

---

## 5. Rubric scores at recon (1–10, honest)

| Dim | Score | Note |
|---|---|---|
| 1. Real problem | 6 | Credible (multi-domain COA wargaming, NDS-aligned) but audience not pinned (N-4). |
| 2. Credible fidelity | 5 | Data fields are serious; the *picture* doesn't yet show it; sim is sound-but-simple. |
| 3. Decision-support value | 5 | COA sim + campaign exist; outputs are numeric, not yet "what this means / do next." |
| 4. UX & clarity | 5 | Functional, dense, jargon-forward; colored dots ≠ operational picture. |
| 5. Portability & deployability | 9 | Genuinely strong: no build, vendored, offline, file://-capable. Real edge. |
| 6. Security posture | 8 | `OFFLINE_MODE`, no telemetry, no secrets seen. Needs a "NOTIONAL data" banner. |
| 7. Demonstrability & differentiation | 5 | No tight demo script; visual language undersells the engineering underneath. |

**Weakest cluster: 2 / 4 / 7 — credibility of the *picture*.** Tonight's first bet attacks
all three at once with tactical symbology + a clean COP marker layer. See `MORNING_REPORT.md`.
