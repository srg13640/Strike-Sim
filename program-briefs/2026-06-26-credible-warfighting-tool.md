# PROGRAM_BRIEF — Strike Sim → credible warfighting tool

> Produced by **program-architect** on 2026-06-26. The companion CHANGE_ORDERs and
> LOOP_SPECs are numbered and live in `change-orders/` and `loop-specs/`. Execute in
> dependency order. This brief is the source of truth; if a CO and the brief
> disagree, the brief wins until amended.

---

## 1. Vision (North Star)

> *"I want something that looks and feels more like a professional warfighting tool —
> not just industry pretty, but with the logic and utility industry's missing. I'm
> the customer-operator. I don't have a team like Lockheed; with tools like Claude I
> can compete on **iteration speed, UX clarity, and right-sized abstraction**, even
> if I can't compete on scale."*

Closest industry reference points (research, this session):

- **Anduril Lattice** — entity model (assets / tracks / geo-entities as "bags of components"). Source: [Lattice docs](https://developer.anduril.com/guides/entities/overview).
- **Palantir Gaia / Maven Smart System** — layered COP (7-layer stack). Source: [Palantir Learn — APPDEV-06](https://learn.palantir.com/appdev-06).
- **CesiumJS** — the 3D-earth standard for credible C2 / ISR tools, Apache 2.0, air-gap-deployable. Source: [CesiumJS — Cesium](https://cesium.com/platform/cesiumjs/).
- **milsymbol.js** — MIT-licensed pure-JS MIL-STD-2525D/E + APP-6 renderer. Source: [milsymbol on GitHub](https://github.com/spatialillusions/milsymbol).

The bar is not "match Maven's scale." It is **"a person walking past your shoulder
thinks they're looking at a Maven cousin, not a prototype."**

---

## 2. State of the code (honest audit)

### What's already strong

- **Architecture discipline.** No-build modular pattern (`StrikeSim2040.html` shell + 11 modules) with `Module.init({...})` dependency injection. Defensible choice for air-gap distribution. README documents the pattern.
- **Air-gap-first design.** `OFFLINE_MODE = true`, vendored libs, local tile fallback, no remote calls at runtime. This is a real competitive advantage over industry tools that assume the cloud.
- **NDS-aligned strategic frame.** `campaign.js` + `docs/NDS_CAMPAIGN_GAME_PLAN.md` translate the 2026 NDS into four playable lines of effort (Homeland, Denial, Allies, DIB). This is unusually thoughtful and *credible-coded* for a solo prototype.
- **Existing review pattern.** `reviews/persona-{1,2,3}-{curmudgeon,gamer,developer}.md` already operationalizes "audit by perspective." This brief extends, not duplicates, that pattern.
- **Existing loop infrastructure.** `loop.run.yaml` + `tools/wargame-loop-{eval,gate}.js` mean optimize-loop is already wired against `game.js`. You can run loops *today*.
- **Scenario richness.** `grokblue90.json` / `grok150red.json` carry credible per-node fields: `subsystem`, `domain[]`, `vulnerabilities[]`, `resourceGenByType{kinetic,ew,jam,sof}`, `importance`, `cascScore`. The data is doctrinally serious.

### What reads as prototype

| Tell                                                                                                              | Where                                                | Severity   |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------- |
| **Console floods with ~237 errors on load** (per `reviews/persona-2-gamer.md` prompt)                              | likely 404s for missing tiles / earth texture        | **P0**     |
| **Geo Mode does nothing** (the owner said so; persona-2 prompt asks the gamer to confirm)                          | `engine.js` — globe lifecycle / camera not reframing | **P0**     |
| **3D earth is a custom Three.js sphere with shader atmosphere**                                                    | `engine.js` lines 35-95                              | **P1**     |
| **2D map is Leaflet with raw colored markers — no MIL-STD-2525 symbology**                                         | `map.js`                                             | **P1**     |
| **`resourceGenByType` has 0 references in `game.js`; `subsystem` has 0 references** (the "tool doesn't tie to itself" gap) | `game.js`                                            | **P2** (loop spec'd) |
| **Single map + single graph view; no COP-layer model**                                                             | architecture-wide                                    | **P1**     |
| **No range rings / MEZ / FEZ / sensor cones**                                                                      | absent                                               | **P3**     |
| **No replay scrubber + event timeline for sim runs**                                                               | absent (`UiModule` has event log; not replay)        | **P3**     |
| **RNG is a hand-rolled LCG** (per persona-2 prompt — sound for ≤10⁴ trials, not for analyst defense)               | `sim.js`                                             | **P2**     |
| **Node model is a flat schema, not Lattice-style "bag of components"**                                             | `state.js`, scenario JSON                            | **P2**     |
| **Lat/lon present in nodes, but Geo Mode doesn't *use* them credibly** (no MGRS readout, no coord-grid)             | `engine.js`, no UI                                   | **P1**     |

---

## 3. Industry-standard reference (for this project)

| Domain                          | Adopt                                            | Why                                                                                                                                                                                  | Air-gap? |
| ------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| 3D globe                        | **CesiumJS** (Apache 2.0)                        | True 3D earth, terrain, 3D Tiles; what credible C2 tools use. Vendor locally + serve pmtiles offline.                                                                                | ✅       |
| Symbology                       | **milsymbol.js** (MIT, single-file, no deps)      | Pure-JS renderer for MIL-STD-2525C/D/E + APP-6. Drop into `vendor/`, 1 KB load.                                                                                                       | ✅       |
| COP architecture                | **Palantir 7-layer model**                       | Compose the rendering as base + static + dynamic + logistics + EW + threat + friendly. Each layer toggleable, each owned by one module.                                              | ✅ (pattern) |
| Entity model                    | **Lattice "bag of components"**                  | Refactor `Node` from flat schema to assets / tracks / geo-entities + optional components. Partial state legal; new component types don't break old code.                              | ✅ (pattern) |
| Engagement zones                | **Doctrine-correct shapes** (no library — roll on turf.js) | Short-range = hemispherical; long-range = lobe with dead zones. Wrong shape = giveaway.                                                                                              | ✅       |
| RNG                             | **Mulberry32 or PCG-XSH-RR**                     | Replace LCG. Two functions. Seeds remain deterministic and ledger-replay holds.                                                                                                      | ✅       |

---

## 4. Credibility gaps → CHANGE_ORDERs / LOOP_SPECs

Each gap below maps to a numbered deliverable. The deliverable files contain the full
execution plan; this table is the index.

| #     | Gap                                                                | Type         | Effort | Visible impact | Spec file                                                       |
| ----- | ------------------------------------------------------------------ | ------------ | ------ | -------------- | --------------------------------------------------------------- |
| CO-001 | Console errors on load + Geo Mode silently broken                  | CHANGE_ORDER | S      | **High**       | `change-orders/CO-001-clean-console-fix-geo-mode.md`            |
| CO-002 | 3D globe is a Three.js sphere; should be CesiumJS                   | CHANGE_ORDER | M-L    | **Very High**  | `change-orders/CO-002-migrate-globe-to-cesiumjs.md`             |
| CO-003 | No MIL-STD-2525 symbology on map / globe                            | CHANGE_ORDER | M      | **Very High**  | `change-orders/CO-003-mil-std-2525-symbology.md`                |
| CO-004 | No COP layer architecture; rendering is monolithic per view         | CHANGE_ORDER | M      | **High**       | `change-orders/CO-004-cop-layer-architecture.md`                |
| LOOP-W | Wargame doesn't tie to itself (resourceGenByType / subsystem unused) | LOOP_SPEC    | M      | High           | `loop-specs/wargame-resource-ties.md` (already written)          |
| CO-005 | LCG RNG too weak for analyst-defensible trial counts                | CHANGE_ORDER | S      | Low-visible / High-substantive | (future)                                          |
| CO-006 | Flat node schema; should be Lattice-style components                | CHANGE_ORDER | L      | Medium-visible / Very-High-substantive | (future, depends on CO-004)               |
| CO-007 | No range rings / MEZ / FEZ / sensor cones                           | CHANGE_ORDER | M      | High           | (future, depends on CO-002)                                     |
| CO-008 | No replay scrubber + event timeline                                 | CHANGE_ORDER | M      | High           | (future)                                                        |

---

## 5. The first 30 days (concrete, dependency-ordered)

Execute these in this order. Where multiple agents are mentioned, use the strongest
one for the task — Claude Code for refactors and tests, Codex CLI for cheap iteration,
Antigravity for long-running tasks you'll come back to.

### Week 1 — Earn credibility back (P0)

1. **CO-001 — Clean console + fix Geo Mode.** This is the cheapest, highest-impact
   move. A console with 237 red lines is the single fastest "not credible" signal a
   reviewer hits. Geo Mode silently doing nothing is the second. Both fixed = the app
   reads like a tool, not a demo. **Agent:** Claude Code. **Time:** 2-4 hours.

### Week 2 — Visual upgrade (P1, foundation for everything visual)

2. **CO-002 — Migrate 3D globe to CesiumJS.** Vendor CesiumJS into `vendor/`, set up
   offline tile / terrain pipeline (start with a static-asset basemap; you can layer
   pmtiles later), replace the Three.js sphere lifecycle in `engine.js`. Keep the 2D
   Leaflet map untouched for now — they're complementary modes. **Agent:** Claude
   Code (you'll want subagent parallelism for the refactor + smoke tests).
   **Time:** 1-2 days.

3. **CO-003 — MIL-STD-2525 symbology.** Drop `milsymbol.js` into `vendor/`. Render
   unit symbols at lat/lon on *both* the 2D map and the new Cesium globe. Wire the
   `subsystem`, `domain[]`, `team` fields through to symbol affiliation / function ID
   so the data ties to the symbol. **Agent:** Claude Code. **Time:** 1 day.

### Week 3 — Logical integrity (P2)

4. **LOOP-W (wargame-resource-ties).** Run the loop that plumbs `resourceGenByType`
   and `subsystem` into the wargame combat math. Your `loop.run.yaml` already wires
   this up. **Agent:** Codex CLI or Claude Code (loop is already configured).
   **Time:** 1-2 hours of loop runtime + review.

### Week 4 — Architecture upgrade (P1 enabler for the rest)

5. **CO-004 — COP layer architecture.** Refactor the renderer into the 7-layer
   Palantir-style stack. Each layer is a module with its own `init({...})`
   contract. After this, *every* future feature (range rings, replay, sensor cones)
   is just "add a layer," not "refactor the world." **Agent:** Claude Code with
   careful review. **Time:** 2-3 days.

---

## 6. What to defer (and why)

- **CO-005 (RNG upgrade).** Real but invisible. Do it before any external math review.
  Don't let it block the visual / logical work that demos.
- **CO-006 (Lattice entity refactor).** High substantive payoff but high effort. Don't
  start until CO-004's layer architecture is in — the layer model gives you the right
  seams to refactor `Node`.
- **CO-007 (range rings / MEZ / FEZ).** Will look extremely credible. Do it after
  CO-002 so the 3D earth can host the geometry properly. Cesium has built-in
  primitives for this.
- **CO-008 (replay scrubber + event timeline).** Big "tool, not demo" upgrade. Belongs
  after CO-004 so it can hook the layer model.

---

## 7. Honest delta with industry

Where Strike Sim **can** match or beat Lockheed / Anduril / Palantir's tools, even solo:

- **UX clarity** — fewer buttons, plainer terms, faster to teach. Industry tools are
  notoriously overgrown.
- **Right-sized abstraction** — your NDS-aligned campaign layer is a level of
  *strategic* abstraction industry tools don't bother with (they sit at tactical).
- **Iteration speed** — you have AI tools, no procurement cycle, no compliance
  committee. Used well, that's a real edge.
- **Air-gap-first** — a fully offline, no-dependency tool is competitively rare and
  hugely valuable for IL5/IL6 use.

Where you cannot match them — and shouldn't try:

- **Scale of integration** (sensors, comms, ATAK, AFATDS feeds).
- **Compliance pedigree** (RMF, ATO, FedRAMP).
- **24/7 ops support** that field deployments require.

This brief is calibrated to put Strike Sim's strengths on the table credibly enough
that the people who *do* have the scale would notice — and want to talk.

---

## 8. Sources

- [Anduril Lattice — Entities overview](https://developer.anduril.com/guides/entities/overview)
- [Palantir Workshop — Building a COP](https://learn.palantir.com/appdev-06)
- [Common Operational Picture — Corvus Intelligence](https://corvusintell.com/blog/c2-systems/cop-common-operational-picture/)
- [CesiumJS — Cesium](https://cesium.com/platform/cesiumjs/)
- [Cesium ion Self-Hosted](https://cesium.com/platform/cesium-ion/cesium-ion-self-hosted/)
- [CesiumJS Offline Guide](https://github.com/CesiumGS/cesium/blob/main/Documentation/OfflineGuide/README.md)
- [Self-hosted basemap tutorial — KeiMaps](https://medium.com/@keimapsapp/creating-a-cesiumjs-application-using-a-self-hosted-basemap-f6fd482fde37)
- [milsymbol — GitHub](https://github.com/spatialillusions/milsymbol)
- [milsymbol on npm](https://www.npmjs.com/package/milsymbol)
- [Cesium vs deck.gl comparison — MATOM.AI](https://matom.ai/insights/cesium-vs-deck-gl/)
- [DoD Enterprise C2 program — DefenseScoop, Jan 2026](https://defensescoop.com/2026/01/06/dod-enterprise-command-and-control-program-office/)
- [DoD FY27 CJADC2 budget — DefenseScoop, May 2026](https://defensescoop.com/2026/05/28/dod-fy27-budget-cjadc2-maven-smart-system-palantir/)
- [Joint Employment Zones — JAPCC](https://www.japcc.org/articles/joint-employment-zones-jez/)
