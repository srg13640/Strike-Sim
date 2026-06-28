# Strike Sim — Master Fix List (synthesized from 12 surface audits)

*12 subagents audited every surface and wrote detailed lists in this folder (01–12). This is
the cross-cutting roll-up, ordered by priority. ✅ = already done this session.*

---

## ✅ Already fixed
- **Task Org view rebuilt** — real echelon hierarchy, vertical team stacking, no card overlap
  (98px clearance verified), collapsible domain buckets, readable cards. (audit 01)

---

## P0 — broken or embarrassing (do first)

1. **Air/Sea/Space units render as ground symbols** (map) — only 127/224 SIDCs valid; the
   97 air+sea+space nodes fall back to a ground frame, so the COP shows zero air domes / sea
   markers. *symbols.js: per-dimension function tables.* (audit 02)
2. **Marker pile-up on the map** — 224 same-size icons at raw lat/lon; 5+ stacked at
   Okinawa/Tokyo. *map.js: cluster/spiderfy + importance z-order.* (audit 02)
3. **49/224 nodes have difficulty labels missing from the combat table** (Dispersed, Orbital,
   Submerged, Fixed…) — all silently treated as "Medium," corrupting the sim + AI math.
   *game.js: complete the DIFF table.* (audit 03)
4. **Objective victory is one-sided** — Blue loses ≥6/8 key objectives ~70% of games, Red
   almost never (Red's nodes are intrinsically more survivable). *game.js: balance objective
   fragility, not the AP economy.* (audit 03)
5. **Empty/one-sided roster declares a bogus winner** (0≤0 collapse → "blue"). *game.js: guard
   startObj≤0.* (audit 03)
6. **"Simulate Plan" is mis-wired** — it simulates `lastCOA`, not the plan you just built, so
   build→simulate→read can run a stale/empty plan. *HTML.* (audit 05)
7. **"beam search" is mislabeled** — it's a random-restart sampler, not a beam search.
   *HTML: rename (or implement a real beam).* (audit 05)
8. **Monte Carlo trials aren't independent** — each trial seeded base+t; first draws correlate
   across trials, biasing the success rate. *sim: decorrelate seeding.* (audit 06)
9. **Two divergent simulateTrial copies** (inline vs worker) already drift; result depends on
   whether a Worker was available. *Consolidate to one engine.* (audit 06)
10. **Search flies the camera to filtered-out (hidden) nodes** → empty space (guaranteed now
    that empty filter hides all). *HTML: search only visible, or re-show.* (audit 09)
11. **Import wipes the live scenario before validating** — any parseable junk JSON destroys the
    session with a success toast. *HTML: validate schema before replace.* (audit 09)
12. **High-contrast mode sets `--bg:#0000` (transparent)** — latent typo. *CSS.* (audit 09)
13. **WebGL probe doesn't match the renderer's real needs** — can mis-report availability.
    *HTML: probe with the same context attrs three.js requests.* (audit 08)
14. **Context-loss handler attaches only once** — after a Retry-3D rebuild, a later GPU drop
    kills 3D permanently. *stage.js: reset webglAttached.* (audit 08)
15. **No first-run explainer + ambiguous active-view state** — purpose is one buried line; view
    buttons only swap label (three can read "3D" at once). *HTML/CSS: welcome card + .active
    state + aria-pressed.* (audit 11)
16. **Four competing blue/red color systems** — affiliation color differs across map symbols,
    milsymbol, HUD, FX, and `--team-blue`. *CSS: one canonical affiliation palette as vars.*
    (audit 12)
17. **Strike FX silently dropped unless the map is the active view**; **objective nodes are
    never marked on the map** (objectiveIds has no consumer). *wargame.js/map.js.* (audit 04)
18. **Table has no column sorting** + one-way selection sync. *views.js.* (audit 07)

## P1 — clearly should fix
- Engagement-ring radii skew red/haze; default to selected-node rings (audit 02).
- Importance range is really 5–10 but size code assumes 0–12 (symbols sized too uniformly) (02).
- Win rate is propped up entirely by Blue's 6-vs-5 AP; equalize and Blue wins 4% (03).
- Cascade damage mis-logged in the AAR; serialize drops `history` so post-load AARs lose turns (03).
- HUD is fixed 340px, no responsive/keyboard support; tempo/objectives explained only at setup (04).
- `recommendNextStep` ignores damage/cost/health; Target dropdown unsorted + health-blind (05).
- No confidence interval on the MC success rate; worker returns no seed/RNG metadata (06).
- Status/health not color-coded in the table; subsystem/vulns/cascScore/MGRS not exposed (07).
- 3D looks generic (no labels, importance unused, symbology not carried into 3D as sprites) (08).
- All/None/**Apply** filter buttons now redundant after the live-filter fix (09).
- Campaign decisions don't change the board (only AP/turn/seed pass through); handoff bypasses
  the wargame UI's own init (10).
- Typography ~10% applied; **online-only Google Fonts in an offline-first tool** (should be
  self-hosted like Leaflet/milsymbol) (12).
- Branding inconsistency: StrikeSim 2040 / MDSC / DST2040 / "Strike Sim" (11).

## P2 — polish
- Per-branch collapse in Task Org; team divider/legend; elbow alignment (01).
- Pacific dateline machinery is inert for this dataset (no western nodes) but mis-clamps
  min-zoom on resize (02). RNG is a 31-bit LCG — fine for play, thin for big MC counts (03/06).
- Geo-mode magic numbers, double-framing, emissive wash-out (08). Import/export ergonomics (09).
- HUD ignores the design system (hard-coded hex, ignores high-contrast) (12).

---

## Recommended implementation order
1. **Map credibility** (P0 #1, #2) — air/sea symbols + declutter (most visible).
2. **Sim/engine correctness** (P0 #3, #4, #5; P1 cascade/serialize) — the SME-credibility core.
3. **COA + Monte Carlo** (P0 #6–9) — the decision-support spine.
4. **Safety + UX** (P0 #10–12, #15; sidebar import/search/contrast, onboarding).
5. **Visual system** (P0 #16; fonts self-host, color vars, HUD adopts design system).
6. **3D reliability + War Game polish** (P0 #13, #14, #17; #18 table).
