# StrikeSim 2040

*A multi-domain strike-planning wargame.* (Formerly "MDSC 3D Network Visualizer.")

An offline-capable, browser-based tool for visualizing and war-gaming multi-domain
force networks. It renders a Blue-vs-Red battlespace as an interactive 3D force-graph,
overlays it on a 2D geographic map with MIL-STD-2525 symbology, runs Monte Carlo
course-of-action (COA) simulations, and includes a turn-based War Game.

> **Status:** working prototype, refactored into a clean modular architecture.
> Runs fully offline (air-gap / IL5–IL6 friendly) — no external network calls at runtime.

---

## Quick start

No build step, no package manager, no backend. You need a static file server (to avoid
`file://` CORS limits) — Python or Node both work.

```bash
# from the project root
python3 -m http.server 8000
# then open:  http://localhost:8000/StrikeSim2040.html
```

The app boots, auto-loads the bundled Red and Blue force networks, and frames the 3D
view from the Blue perspective looking toward Red. Loader labels describe the force,
not a frozen node count, so the libraries can evolve without becoming misleading.
First settle takes ~5 seconds.

**Prerequisites:** any modern browser with WebGL. Python 3 *or* Node.js for the static
server. That's it.

---

## What you can do

- **3D network view** — force-directed graph of all nodes; click to inspect, search,
  filter by domain/team, highlight high-payoff / high-risk targets.
- **Geo mode** — pin nodes to a globe by lat/lon.
- **Map mode** — 2D Leaflet map with geographic markers and selected-node links.
- **Table & Task-Org views** — sortable data table and a military-symbol task-org chart.
- **COA simulation** — build a course of action and run Monte Carlo trials (success
  rates, expected steps, Blue/Red losses); a wizard can auto-generate goal-seeking plans.
- **NDS Campaign Planner** — design a higher-level campaign around homeland defense,
  Indo-Pacific deterrence-by-denial, allies/partners, and defense-industrial-base
  endurance; then hand the resulting posture into the turn-based War Game.
- **Import / export** — load additional scenarios or export the current graph as JSON.

---

## Architecture

The app began as a single 5,700-line HTML file. It has been incrementally refactored
into focused, single-responsibility modules — **without a build step**: each is a plain
`<script>` that attaches a namespaced object to `window` and runs over `file://` or any
static server.

| File | Responsibility |
|------|----------------|
| `StrikeSim2040.html` | App shell: markup, styles, orchestration glue, filters, modals, the COA UI, and the core simulation engine. Loads the modules below. |
| `ui.js` (`UiModule`) | UI notification primitives: toasts + the event log. |
| `state.js` (`AppState`) | Scenario-centric application state. A *scenario* owns the graph; foundation for future multi-scenario support. |
| `sim.js` (`SimModule`) | Simulation foundation: seeded RNG, action/counter profiles, statistics, and the graph→context snapshot builder. |
| `director.js` (`DirectorModule`) | **The Operation Loop — the game's front door.** Brief → Plan → Commit → Watch → AAR phase machine over the War Game engine: ghost-world forecasts at commit (honest ranges, never predictions), paced turn playback, and a counterfactual AAR that re-runs the same seeded world under a changed policy. Design spine: `docs/GAME_DESIGN.md`. |
| `campaign.js` (`CampaignModule`) | NDS-aligned campaign game layer: phase planning, strategic metrics, campaign brief export, and War Game posture handoff. *(Launcher hidden — pending rebuild as operation framing per the design spine.)* |
| `map.js` (`MapModule`) | Leaflet 2D map rendering: markers, links, popups, offline tile detection. |
| `engine.js` (`EngineModule`) | 3D engine lifecycle (3d-force-graph / Three.js), the Blue→Red opening camera shot, and geo-mode layout. |
| `views.js` (`ViewsModule`) | Alternate render views: the data table and the D3 task-org chart. |
| `inline-datasets.js` | Startup auto-loader for the bundled Red and Blue force networks. |
| `vendor/` | Vendored libraries (offline): Three.js r128, OrbitControls, 3d-force-graph, D3 v7, Leaflet 1.9.4. |

### Design conventions

- **No build, global modules.** Modules publish a `window.<Name>Module` object. Because
  the original code calls many functions by bare name, modules **alias their public
  methods onto the original global names** (e.g. `window.refreshMapMarkers =
  MapModule.refreshMapMarkers`), so existing call sites keep working unchanged.
- **Dependency injection for shared state.** Where a module needs script-scoped state
  from the shell (e.g. the current selection, highlight mode), the shell injects live
  getters via a `Module.init({...})` call. Modules never reach into the shell directly.
- **State through `AppState`.** The active scenario's graph is read via
  `AppState.activeGraph()`, not a global `data` variable.
- **Campaign before battle.** `campaign.js` keeps strategic assumptions separate from
  tactical adjudication. Its metrics influence War Game setup, but it does not mutate
  the force graph until the operator explicitly launches the War Game.

### Offline design

- `OFFLINE_MODE = true` blocks all remote fetches; libraries are vendored locally.
- The map uses local tiles from `./tiles/{z}/{x}/{y}.png` if present, and falls back to
  a blank grid with a clear on-map status badge if they're absent (no silent failures).

---

## Data format

Scenarios are JSON with `nodes` and `links` arrays. A node:

```json
{
  "id": "PLA-CMD-001",
  "name": "CMC Joint Operations Command Center Beijing",
  "team": "red",
  "subsystem": "Firepower Strike",
  "domain": ["Land"],
  "type": "Command",
  "health": 100, "healthMax": 100,
  "status": "Active",
  "difficulty": "Buried",
  "vulnerabilities": ["Cyber", "SOF"],
  "importance": 10, "cascScore": 5,
  "lat": 39.9042, "lon": 116.4074,
  "resourceGenByType": {
    "kinetic": 0,
    "cyber": 0,
    "ew": 0,
    "sof": 0
  },
  "capabilityProfile": {
    "category": "joint-command",
    "functions": ["command-and-control"],
    "evidenceClass": "observed",
    "confidence": "high",
    "availability": "scenario-active",
    "sourceRefs": ["DOD-CMPR-2025"],
    "assumption": "The graph node is a theater-level analytical aggregate."
  }
}
```

A link is `{ "source": "<id>", "target": "<id>" }`. The bundled libraries retain
their historical filenames, `grok150red.json` and `grokblue90.json`, but their node
counts are intentionally allowed to change as the open-source scenario is improved.

`resourceGenByType` is required and has exactly four keys: `kinetic`, `cyber`, `ew`,
and `sof`. Values are integer **mission-capacity points per turn** from 0 through 10;
they are not counts of units, teams, platforms, weapons, or accesses. Cyber and EW are
separate ledgers, and the retired serialized key `jam` is not part of the canonical
format. Optional `capabilityProfile` fields distinguish observed, assessed, and
notional-2040 content and record availability, confidence, sources, and assumptions.

See [the Cyber Capability Model](docs/CYBER_CAPABILITY_MODEL.md) for the modeling and
provenance rules, and [`schemas/strikesim-scenario.schema.json`](schemas/strikesim-scenario.schema.json)
for the machine-readable data contract.

---

## Project layout

```
.
├── StrikeSim2040.html          # app shell + orchestration + sim engine
├── ui.js  state.js  sim.js  map.js  engine.js  campaign.js  views.js
├── inline-datasets.js    # startup scenario auto-loader
├── grok150red.json  grokblue90.json   # bundled scenarios
├── schemas/strikesim-scenario.schema.json  # scenario data contract
├── docs/CYBER_CAPABILITY_MODEL.md      # capability semantics + provenance
├── vendor/               # offline-vendored libraries
└── tiles/                # (optional) local map tiles — not included
```

---

## Roadmap / notes

- **Deeper simulation-engine module.** The core trial simulator (`simulateTrial`) and
  its planning helpers still live in the shell; they are coupled to config state and the
  COA UI. They are a candidate for a future `sim-engine` module — best done alongside the
  work below, which modifies them directly.
- **Project Janus** (`Janus_Implementation_Plan.md`) — a proposed bounded-rationality /
  fatigue / logistics extension to the simulation engine. *Concept by Pat Beaudry.*
- **Multiple named scenarios.** `AppState` is already scenario-centric; a scenario
  switcher UI is the intended next feature on that foundation.
- **Campaign save/resume.** The Campaign Planner can export a Markdown brief today;
  persisting playable campaign state is the natural next increment.
