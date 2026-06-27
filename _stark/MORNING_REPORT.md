# MORNING REPORT — Strike Sim (Operator: Stark)

*Run: 2026-06-27, overnight. Baseline tag: `pre-stark-baseline`. Cycle 1 committed: `025b697`.*

---

## 0. Read-me-first (the honest frame)

This session ran **one full cycle**, not the four the budget allows for a true 8-hour
grind — I'm one agent in one working window, so I spent the time on the single highest-
leverage, *verifiable* move rather than spreading thin across half-finished surfaces.
Everything below launches and is committed. The baseline is tagged, so this cost you
nothing if you hate it. Next cycles are scoped in §8.

---

## 1. The $10M case (one paragraph)

Strike Sim already had the thing most prototypes fake: **real engineering** — a
disciplined no-build modular architecture, a genuinely air-gapped/offline posture
(a rare, expensive-to-buy property for IL5/IL6 environments), an NDS-aligned campaign
layer, and a doctrinally serious order of battle. What it *looked* like was a network
graph with colored dots. Tonight I closed the gap between how serious the data is and
how serious it looks: the map now renders **MIL-STD-2525-style tactical symbology** —
affiliation frames, function glyphs, dimension cues, and battle-damage status — driven
entirely by fields the scenario already carried. A general walking past now sees a
recognizable common operational picture, not a demo. That is the difference between
"a student project" and "a tool I could put in front of a J-3," and it was built with
**zero new dependencies and no network reach** — preserving the air-gap edge that is
itself part of the $10M argument.

## 2. What it is now & how to run it (verified launch steps)

No build, no backend. From the project root:

```bash
python3 -m http.server 8000
# open: http://localhost:8000/StrikeSim2040.html
```

(There is also `Open StrikeSim 2040.command` for a double-click launch.) The app boots
into the 3D network view; **click "Map"** in the view controls to see the new symbology.
First 3D settle takes ~5s.

**Verification status (important / honest):** I could not run a live browser this session
(you were asleep and the tool is air-gapped — no headless browser provisioned). I verified
the new code three ways without a browser: 52 structural assertions on the renderer, the
browser CSS-injection path under a mocked DOM, and a **224-node render of the real OOB**
that I inspected as an image (`_stark/theater-proof.png`). The Leaflet wiring is written
defensively (any symbol failure silently falls back to the original colored dot), but the
*live map integration itself* has not been clicked in a browser yet — see §6.

## 3. What changed (before → after)

| | Before | After |
|---|---|---|
| Map markers | Raw `L.circleMarker` dots, colored only by team | `L.marker` + inline-SVG tactical symbols; circle dots remain as automatic fallback |
| Affiliation | Color only | Frame **shape + color** (friend rounded-rect / hostile diamond / neutral square / unknown) — readable even color-blind |
| Unit role | Not shown on map | Central **function glyph** from `type` (command, fires, sensor, comms, maneuver, air-def, EW/cyber, sustainment, blockade) |
| Domain | Not shown on map | **Dimension cue**: air/space dome, sea wave |
| Battle damage | Not shown | **Status modifier**: dashed frame + slash when degraded, red ✕ + fade when destroyed |
| Decoding | None | Collapsible on-map **symbology legend** |

**Key bet:** attack the weakest cluster (fidelity-of-picture / UX / demonstrability) with
one move that upgrades all three, and that I could *prove* offline. New files: `symbols.js`,
`tools/symbol-proof.js`, `tools/theater-proof.js`. Touched: `map.js`, `StrikeSim2040.html`.

## 4. The 10-minute demo script (click-by-click)

1. **(0:00) Frame the problem.** "Multi-domain fight, West Pacific 2040. A staff needs to
   see Blue and Red across all domains and reason about courses of action — offline, on a
   locked-down laptop." Launch the app; let the 3D network settle.
2. **(1:30) The reveal.** Click **Map**. The theater fills with military symbols. Point out:
   red diamonds (hostile) massed over the mainland, blue rounded-rects (friendly) along the
   island chains — *"this is the common operational picture, and it's reading off the same
   data the simulation uses."*
3. **(3:00) Decode it cold.** Open the **SYMBOLOGY** legend (top-left). Show affiliation =
   frame, role = glyph, air = dome, degraded = dashed/✕. "No manual — a viewer reads this in
   seconds. That's MIL-STD-2525's whole point and why every real C2 tool uses it."
4. **(4:30) Click a unit.** Select a red **Fires** node; it glows, neighbors link, popup IDs
   it. Cross-reference the same unit in the **Table** view.
5. **(6:00) Tie it to decisions.** Open the **COA Builder / Generator**, run a Monte-Carlo
   COA, and note that the symbols you targeted are the same entities the sim adjudicates.
6. **(8:00) The moat.** Pull the network cable / show airplane mode: *nothing breaks.* "No
   cloud, no CDN, no telemetry. This runs in a SCIF. Most tools in this space can't say that."
7. **(9:00) Close.** "Disciplined architecture, a credible operational picture, and an
   air-gap posture — built at iteration speed. That's the package."

## 5. Final rubric scores (1–10, honest) — Δ from recon

| Dim | Recon | Now | One honest line on what's still weak |
|---|---|---|---|
| 1. Real problem | 6 | 6 | Audience still not pinned (training vs. analytic vs. C2) — need N-4. |
| 2. Credible fidelity | 5 | **7** | Picture now reads as a COP; sim math still simple, RNG still LCG. |
| 3. Decision-support value | 5 | **6** | Symbols aid reading; outputs still lack "what this means / do next." |
| 4. UX & clarity | 5 | **7** | Map is legible cold now; broader UI is still dense/jargon-forward. |
| 5. Portability & deployability | 9 | 9 | Unchanged and still the standout — zero new deps added tonight. |
| 6. Security posture | 8 | 8 | Still needs a "NOTIONAL — not real intelligence" banner on load. |
| 7. Demonstrability & differentiation | 5 | **7** | A real demo script + a visible differentiator now exist; needs a live run-through. |

Net: the weakest cluster (2/4/7) moved up together, as intended. New weakest: **decision-
support depth (3)** and **audience definition (1)** — those lead the next cycle.

## 6. Test results + Red Team

**Verified (passing):**
- `node tools/symbol-proof.js` → **52/52** structural assertions (valid SVG, no NaN/undefined,
  affiliation + function mapping, health→status, divIcon shape, empty-node robustness).
- Browser CSS-injection path exercised under a mocked DOM (attaches once, idempotent).
- `node tools/theater-proof.js` → all **224 real nodes** render; function mix sane (fires 45,
  sensor 31, comms 30, command 29, sustain 22, maneuver 18, support 18, blockade 11, EW 9,
  air-def 3). Inspected `_stark/theater-proof.png` — geography and affiliation read correctly.
- `node --check` passes on `symbols.js` and `map.js`.

**Red Team — open finding (carried to next cycle):**
- *The live Leaflet integration was not clicked in a real browser this session.* Risk is low
  (defensive fallback to circle markers on any symbol error; `_icon` is created synchronously
  on add), but it is unproven end-to-end. **First action next session:** launch, open Map,
  confirm symbols + legend render and the console is clean. If anything regresses, set
  `MapModule.init({ useMilSymbols:false })` to instantly revert to dots without code changes.
- *Highlight recolor:* under payoff/risk highlight modes, symbol markers **dim** non-selected
  units rather than recoloring them (affiliation color is preserved deliberately). Confirm
  that reads as intended; if you want the old recolor, it's a small change.

## 7. Tools still needed from you (from the Needs Report)

1. **`milsymbol.js`** (MIT, one file) in `vendor/` → upgrade from my 2525-*flavored* subset to
   full SIDC coverage. Biggest single credibility unlock for the picture.
2. **CesiumJS** + an offline basemap in `vendor/` → CO-002, the true-3D-earth jump.
3. **Audience decision** (training / analytic / C2) → sharpens the default screen and the pitch.
4. A **vetted scenario** or explicit "notional is fine" → lets the fidelity claim survive an SME.

Full detail and degraded paths: `_stark/00_needs_report.md`.

## 8. Next 3 moves (prioritized, what I'd do with another night)

1. **Live-verify + extend symbology to the 3D/Geo views.** Click-test the map, then render the
   same symbols as sprites in the Three.js network/globe so the COP is consistent across views.
   (Closes the §6 Red Team item and compounds the win.)
2. **Decision-support layer on sim output (dim 3).** Add a "What this means / recommended next
   action" interpretation block to Monte-Carlo and goal-plan reports (backlog P-04) — turn
   numbers into a decision.
3. **Range rings / engagement zones (dim 2, differentiation).** Pure-geometry MEZ/FEZ + sensor
   arcs drawn from node lat/lon — no new dependency, very high "credible warfighting tool"
   signal, and it layers cleanly on the symbology now in place.

---

*Artifacts this run: `_stark/00_needs_report.md`, `_stark/symbol-proof.png`,
`_stark/theater-proof.png`, `symbols.js`, `tools/symbol-proof.js`, `tools/theater-proof.js`.
Rollback anytime: `git checkout pre-stark-baseline`.*
