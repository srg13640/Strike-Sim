# COFM_MODEL.md — Correlation of Forces and Means (CO-009)

Engine: `cofm.js` (`window.CofmModule`). Gate: `tools/cofm-proof.js`. This document is the
normative spec: the constants here are asserted by the proof suite; if you change one,
change both.

## 1. What COFM is (and is not)

A **Correlation of Forces and Means** assessment (Russian: *sootnosheniye sil i sredstv*)
is a composite net assessment of two sides' combat potential. Unlike a Western-style
"Balance of Forces" (raw counts of ships/tanks/missiles), COFM pairs **material,
quantitative capability** with **qualitative multipliers** — command-and-control
integrity and sustainment posture — because campaign outcomes hinge on the synthesis,
not the inventory. StrikeSim's COFM readout is an **ordering aid for decisions**
(is the correlation improving or collapsing, and where), not an outcome prediction;
the denial MOE in `moe.js` remains the victory arbiter.

## 2. Formulation

```
COFM_net = P_blue / P_red                     (P_red floored at 0.05; net capped at 9.99)

P_side   = ( Σ_d  w_d · I_d )  ×  M_C2Integrity  ×  M_LogiPosture
           └──── material ────┘   └────────── qualitative ──────────┘
```

**Domain weights `w_d`** (sum = 1.0):

| Domain | Weight |
|---|---|
| Fires / Strike | 0.35 |
| Air & Sea Control | 0.25 |
| C2 & Information | 0.20 |
| Sustainment | 0.20 |

**Domain index `I_d`** = importance-and-cascade-weighted mean health fraction of the
side's nodes in that domain (0..1). Per-node weight `w = importance × (1 + 0.5·cascScore)`
(missing importance → 5, missing cascScore → 1) — identical to the `moe.js` cascade-aware
form (PLA systems-destruction warfare, RAND RR-1708), so the two engines agree on which
nodes matter. Node health fraction `h = clamp01(health / healthMax)`; `alive === false`
or `status === 'Neutralized'` → 0.

**Renormalization:** a side contributes nothing in a domain where it has no nodes;
weights are renormalized over the domains actually present (the `moe.js` OSVI
convention). Both sides' material terms are therefore commensurable 0..1 composites
before the ratio is taken.

**Qualitative multipliers:**

- `M_C2Integrity = 0.40 + 0.60 · (I_c2info)^1.5` — non-linear: losing half your C2
  costs more than half its value (`0.40 + 0.60·0.354 ≈ 0.61`, not `0.70`); floor 0.40
  models a degraded-but-not-headless force. A side with no C2&Info nodes at all takes
  no penalty (multiplier 1.0). Note: C2 appears in both the material sum and the
  multiplier — deliberate double emphasis, consistent with C2-first targeting doctrine.
- `M_LogiPosture` from the side's live logistics decision (`logistics.js` posture ids):
  `surge` → **1.06**, `balanced` → **1.00**, `constrained` → **0.94**, anything else →
  1.00.

## 3. Input mapping (normative)

Nodes come from the live scenario graph (`AppState.activeGraph().nodes` with health
overlaid from `GM.boardNode(id)`). Classification order: `jointFunction` (Blue dataset)
→ `type` (Red dataset taxonomy, matching `moe.js`) → `subsystem` → default `fires`.

| COFM domain | Blue `jointFunction` | `type` | Fallback `subsystem` |
|---|---|---|---|
| Fires / Strike | Fires | Fires | Firepower Strike |
| Air & Sea Control | Protection | Blockade, Protection, Assault¹ | Blockade, Assault |
| C2 & Information | Command and control, Information, Intelligence and targeting | Command, Comms, Relay, Sensor, EW/Cyber, Information Capability | Information Attack |
| Sustainment | Sustainment | Logistics | — |

¹ Red amphibious lift (`Assault`) is counted as sea-control *means* here; in `moe.js`
it is deliberately excluded from OSVI and used as the throughput multiplicand instead.
Different questions, different treatments — documented so nobody "fixes" the mismatch.

## 4. Classification tiers

Evaluated on `COFM_net` rounded to 2 decimals (standard half-up); every range inclusive:

| Net | Tier | Color |
|---|---|---|
| < 0.70 | HEAVY RED SUPERIORITY | `#ff4d5e` |
| 0.70 – 0.89 | RED ADVANTAGE | `#ff8c42` |
| 0.90 – 1.10 | CONTESTED PARITY | `#ffd166` |
| 1.11 – 1.30 | BLUE ADVANTAGE | `#63dcff` |
| > 1.30 | HEAVY BLUE DOMINANCE | `#38ef7d` |

## 5. Surface points

`director.js` renders `formatCard(report)` in the operation BRIEF and the AAR summary,
and `formatChip(report)` in the PLAN/COMMIT dock. The engine is pure and read-only;
all dynamic strings in the HTML helpers are escaped at the source because `director.js`
injects via `innerHTML`.

## 6. Limitations (honest caveats)

- Weights, the C2 curve, and posture multipliers are modeling assumptions in the EBO-
  critique sense — treat outputs as a robust ordering with the trend mattering more
  than the digits.
- Red's logistics posture uses the same three ids as Blue when the state exposes one;
  absent → 1.00.
- COFM is symmetric-material by design; it does not model initiative, geography, or
  time windows — those live in the scenario, the denial MOE, and the Red mind.

## 7. Citations

- Michael Klare, *"Understanding 'The Correlation of Forces'"*, TomDispatch, 2022-04-03.
- Soviet Ministry of Defense, *Military Encyclopedic Dictionary* — *sootnosheniye sil i sredstv*.
- Jeffrey Engstrom, *Systems Confrontation and System Destruction Warfare*, RAND RR-1708.
- `docs/METHODOLOGY.md` (denial MOE lineage shared with `moe.js`).
