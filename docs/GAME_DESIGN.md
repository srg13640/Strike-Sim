# StrikeSim 2040 — Game Design Spine

*Design authority document. Every increment must serve this loop. 2026-07-02.*

---

## 1. The Vision

**You don't play the battle. You play the plan.**

StrikeSim 2040 is a single-analyst decision wargame about **commitment under honest
uncertainty**. The player is a Blue operational planner facing a doctrine-driven Red.
One sitting (45–75 minutes) is one **Operation**: a briefed, bounded Blue-vs-Red
campaign of 6–10 simultaneous-commit turns, closed out by an after-action review that
tells the player something true about their own judgment.

The fantasy is not "fire the missiles." The fantasy is **the weight of the commit** —
the moment a commander signs the order knowing the forecast is a range, not a promise,
and then has to watch one reality unfold out of the thousand they imagined.

This is the CSIS/RAND standard: the game must produce **insight**, not score. Fun and
analytic seriousness meet at the same mechanic: honest consequences for real decisions.

## 2. The Signature Mechanic — *The Forecast and the World*

Everything hangs on one property the codebase already has and almost no wargame UI
exploits: **the resolver is pure, seeded, and deterministic** (`game.js resolveTurn`).
That enables three moves that together are the "system-seller":

1. **The Forecast (at Commit).** Before the player's orders lock, the engine runs the
   *actual turn* across K ghost worlds (same board, doctrine-driven Red variations,
   different seeds) and presents the honest distribution: *"Across 200 worlds: 2–4 Red
   nodes down (10th–90th pct), 22% chance your key objectives take fire."* Never a
   point prediction. This is the **honesty invariant** and it is non-negotiable.
2. **The World (at Watch).** Reality resolves as **one seeded draw** from that same
   engine. The gap between the range you studied and the world you got *is the game*.
3. **The Counterfactual Machine (at AAR).** Because every turn re-derives from
   `(seed, turn)`, the AAR can *re-run the same world with one changed decision* and
   show what actually mattered: "Same world. You go decapitation-first instead —
   Red collapses turn 6." No hand-waving; the machine answers.

No stochastic hand-tuning, no fudged drama. The engine is the oracle and the oracle
is auditable. That is the pitch to a publisher **and** to a RAND reviewer.

## 3. Design Pillars

1. **Honest uncertainty.** Ranges, percentiles, and seeds shown; predictions never.
   If a number can't be defended, it isn't shown.
2. **Commitment has weight.** Simultaneous blind commit; no takebacks; a killed node
   still acts on the turn it dies because both sides had already committed. The UI
   treats EXECUTE as a ritual, not a button.
3. **Insight is the victory condition.** The AAR is a deliverable, not a scoreboard.
   Forecast-vs-actual per turn, decisive moments, counterfactual probes.
4. **Substance over chrome.** Chrome is only justified when it serves a loop phase.

## 4. The Core Loop

```
BRIEF ─→ PLAN ─→ COMMIT ─→ WATCH ─┐        one turn (~4–7 min)
          ↑                        │
          └────────────────────────┘   × 6–10 turns
                                   └─→ AAR ─→ (new operation / variant replay)
```

- **BRIEF** — Mission card generated from the live scenario: commander's intent, your
  8 key objectives (named), the enemy's center of gravity, force/tempo balance, turn
  budget. Ends with "Begin Planning." One screen, 60 seconds, zero jargon walls.
- **PLAN** — The existing console *is* the planning workspace (map/3D/table/org are
  reconnaissance tools now, not disconnected demos). A command dock holds the order
  queue: strike / harden / repair against the AP (command-tempo) budget.
- **COMMIT** — The ritual. Order summary + the Forecast strip + "The world will draw
  one outcome from this range." EXECUTE is irreversible.
- **WATCH** — The turn resolves as paced playback: strike arcs on the map, an event
  feed, kills and cascades landing one by one. Ten to twenty seconds of consequence.
- **AAR** — At operation end: verdict + reason, score trajectory, forecast-vs-actual
  honesty ledger, decisive-node analysis, and the Counterfactual Machine.

## 5. What We Build On (audit verdicts, 2026-07-02)

| Asset | Verdict | Role in the design |
|---|---|---|
| `game.js` resolver (simultaneous commit, seeded, tempo economy, key terrain, cascades) | **A– / crown jewel** | The oracle. API frozen (gates). Director builds on `_internal` headless surface. |
| `sim-worker.js` Monte Carlo (decorrelated seeds, percentiles) | B+ | Deep-forecast backend for COA analysis; later merges with ghost-world forecasting. |
| Command-tempo economy | The hidden depth | Decapitation vs. attrition is the central strategic dilemma; surface it in UI (tempo bars, AP pips). |
| Campaign layer (`campaign.js`) | C+ / flavor | Demoted from the front door. Later rebuilt as *operation framing* that materially shapes the board, or cut. |
| Five disconnected surfaces (3D/map/table/org/MC) | The problem | Become reconnaissance instruments inside PLAN. Never top-level destinations again. |

## 6. UI/UX Doctrine (the teardown)

- **One front door: OPERATION.** The old ⚔ War Game and Campaign launchers disappear
  from the command bar. The toolbox era is over.
- **Phase rail always visible** during an operation: BRIEF · PLAN · COMMIT · WATCH ·
  AAR with turn counter. The player always knows where they are in the loop.
- **Full-screen moments** for Brief, Commit, and AAR (cinematic, letter-boxed, calm
  typography). PLAN and WATCH live on the map/3D canvas.
- **The dock, not the sidebar.** Orders are queued in a bottom command dock (AP pips,
  order chips, forecast strip). The right sidebar remains the analyst's deep-tools
  drawer, closed by default during an operation.
- Existing visual language (dark naval, cyan accent, Oswald/Inter) is retained and
  tightened — the palette was never the problem; the missing loop was.

## 7. Balance & Honesty Ground Rules

- Blue win rate target 0.45–0.55 at hard/hard before AP asymmetry (see audit: today
  Blue is propped up by a 6-vs-5 AP crutch; fix objective fragility, not the economy).
- Every difficulty label in shipped data must exist in the `DIFF` table (silent
  Medium-fallback is a credibility bug, not a balance choice).
- Forecast K defaults to 200 ghost worlds (<50ms on a 224-node board); the AAR
  honesty ledger compares each turn's forecast band to the actual draw.
- Seeds are always visible and exportable: any operation can be replayed exactly.

## 8. Increment Roadmap

1. **The Operation Loop** *(this increment)* — `director.js`: phase state machine,
   Brief/Commit/AAR screens, command dock, ghost-world Forecast, paced Watch,
   Counterfactual Machine v1 (3 probes + honesty ledger). Legacy launchers hidden.
2. **Plan-phase reconnaissance** — objective markers on map/3D, tempo-target overlay
   ("what dies if this dies"), threat rings tied to actual reach.
3. **Balance pass** — DIFF completion + objective fragility normalization against the
   0.45–0.55 target, 200-seed harness in `tools/`.
4. **Red doctrine personalities** — ✅ SHIPPED (CO-005): Harsanyi doctrine types with a
   disclosed prior, level-k/quantal-response difficulty, per-turn regret-matching mix,
   belief-respecting ghost forecast, Bayesian intel posterior, and a restricted-Nash
   player model (capped at 0.5) that adapts to the player's habits across operations.
   See `docs/RED_MIND.md`, `docs/FORECASTING_MODEL.md`, `change-orders/CO-005-*.md`.
5. **Operation framing** — rebuild campaign layer so posture materially shapes the
   board (`newMatch` posture hook), or retire it.
6. **Scenario switcher + operation save/replay** — PARTIAL (CO-005 C5): BRIEF-selectable
   operation variants shipped (SMALL ISLAND FAIT ACCOMPLI, in-place graph swap with
   restore); full save/replay UI remains open.

## 9. Anti-Goals

- No prediction theater (single-number "78% success" claims).
- No chrome that doesn't serve a loop phase.
- No new top-level modes. Everything enters through the loop.
- No engine forks: one resolver (`game.js`), one forecast path built on it.
