# CHANGE_ORDER `CO-009` — correlation-of-forces-and-means

> Produced 2026-07-20 to introduce a multi-domain Correlation of Forces and Means (COFM) assessment engine.
> Grounded in Soviet/Russian military science (*sootnosheniye sil i sredstv*) and Michael Klare's *Understanding 'The Correlation of Forces'* (TomDispatch 2022).

---

## 1. Gap this closes

StrikeSim 2040 currently measures combat power using basic health-weighted node values (`objectiveValue` in `game.js`) and amphibious throughput / denial (`moe.js`). However, it lacks a formal **Correlation of Forces and Means (COFM)** framework.

As strategic analyst Michael Klare emphasizes in *Understanding 'The Correlation of Forces'*, traditional Western military analysis often focuses too narrowly on a **"Balance of Forces"** (simple material counts of ships, tanks, or missiles). In contrast, Soviet/Russian operational science (*sootnosheniye sil i sredstv*) shows that campaign outcomes depend on a composite synthesis of **material/quantitative capabilities** (fires, air/sea control, logistics) paired with **intangible/qualitative multipliers** (Command & Control integrity, electronic warfare friction, operational tempo, and morale).

This Change Order introduces a dedicated **COFM Engine (`cofm.js`)** and UI integration (`director.js`), exposing live net assessment ratings and domain breakdowns across the Operation Loop.

---

## 2. Industry reference & Mathematical Model

- **Citations:**
  - Michael Klare, *"Understanding 'The Correlation of Forces'"*, TomDispatch (April 3, 2022).
  - Soviet Ministry of Defense, *Military Encyclopedic Dictionary* (sootnosheniye sil i sredstv).
  - RAND Corporation, *Systems Confrontation and System Destruction Warfare* (RR-1708).
- **Mathematical Formulation:**
  $$\text{COFM}_{\text{Net}} = \frac{P_{\text{Blue}}}{P_{\text{Red}}}$$
  Where combat potential $P_{\text{team}}$ for a side is:
  $$P_{\text{team}} = \left( w_{\text{fires}} \cdot I_{\text{Fires}} + w_{\text{air/sea}} \cdot I_{\text{Air/Sea}} + w_{\text{c2}} \cdot I_{\text{C2}} + w_{\text{sustain}} \cdot I_{\text{Sustain}} \right) \times M_{\text{Qual,team}}$$
- **Domain Weightings:**
  - Fires / Strike ($w_{\text{fires}} = 0.35$)
  - Air & Sea Control ($w_{\text{air/sea}} = 0.25$)
  - C2 & Information ($w_{\text{c2}} = 0.20$)
  - Sustainment & Logistics ($w_{\text{sustain}} = 0.20$)
- **Qualitative Multipliers ($M_{\text{Qual}}$)** *(exact forms pinned in review — no implementer discretion)*:
  - $M_{\text{C2Integrity}} = 0.40 + 0.60 \cdot (I_{\text{C2}})^{1.5}$ — non-linear decay with a 0.40 floor: losing half your C2 costs far more than half its value, but a side is never modeled as fully combat-ineffective on C2 loss alone.
  - $M_{\text{LogiPosture}}$: from the side's live logistics decision — `surge` → **1.06**, `balanced` → **1.00**, `constrained` → **0.94**; unknown/absent → 1.00.
  - $M_{\text{Qual,team}} = M_{\text{C2Integrity}} \times M_{\text{LogiPosture}}$. (Note: C2 deliberately appears in both the weighted sum and the multiplier — that double emphasis IS the C2-first doctrine, consistent with `moe.js` OSVI weighting per RR-1708.)
- **Ratio guard:** $P_{\text{Red}}$ is floored at 0.05; $\text{COFM}_{\text{Net}}$ is capped at 9.99.
- **Operational Classification Tiers** *(evaluated on the net ratio rounded to 2 decimals; every range inclusive of its endpoints)*:
  - $< 0.70$: **Heavy Red Superiority** (`#ff4d5e`)
  - $0.70 - 0.89$: **Red Advantage** (`#ff8c42`)
  - $0.90 - 1.10$: **Contested Parity** (`#ffd166`)
  - $1.11 - 1.30$: **Blue Advantage** (`#63dcff`)
  - $> 1.30$: **Heavy Blue Dominance** (`#38ef7d`)

### 2.5 Input mapping (added in review — the load-bearing section)

Domain indices come from the live scenario graph (`AppState.activeGraph().nodes`, health overlaid from `GM.boardNode(id)`), classified **per node** by `jointFunction` first (Blue dataset), then by `type` (Red dataset taxonomy, matching `moe.js`), then by `subsystem` field:

| COFM domain (weight) | Blue `jointFunction` | Red/any `type` | Fallback `subsystem` |
|---|---|---|---|
| Fires / Strike (0.35) | `Fires` | `Fires` | `Firepower Strike` |
| Air & Sea Control (0.25) | `Protection` | `Blockade`, `Protection`, `Assault` (amphibious lift = sea-control means) | `Blockade`, `Assault` |
| C2 & Information (0.20) | `Command and control`, `Information`, `Intelligence and targeting` | `Command`, `Comms`, `Relay`, `Sensor`, `EW/Cyber`, `Information Capability` | `Information Attack` |
| Sustainment (0.20) | `Sustainment` | `Logistics` | — |

- **Per-node weight** (cascade-aware, identical to `moe.js`): $w = \text{importance} \times (1 + 0.5 \cdot \text{cascScore})$; missing importance defaults to 5, missing cascScore to 1.
- **Node health fraction** $h = \text{clamp01}(\text{health}/\text{healthMax})$; `alive === false` or `status === 'Neutralized'` → 0.
- **Domain index** $I_d$ = weighted mean of $h$ over the side's nodes in that domain (0..1).
- **Normalization:** a side with no nodes in a domain contributes nothing there; weights are renormalized over the domains the side actually has (same convention as `moe.js` OSVI). Both sides' potentials are therefore commensurable 0..1-scale composites before the ratio.

---

## 3. Acceptance criteria

- [ ] `docs/COFM_MODEL.md` created detailing the mathematical formulation, domain weights, qualitative multipliers, and citations.
- [ ] `cofm.js` (`window.CofmModule`) implemented as a pure read-only UMD module (zero DOM, zero external dependencies). All dynamic strings in `formatChip`/`formatCard` HTML output are escaped (review requirement — `director.js` injects via `innerHTML`).
- [ ] `node tools/validate-scenarios.js` passes (promoted from smoke test to acceptance in review).
- [ ] `tools/cofm-proof.js` automated test suite created and passing 100% in Node.js.
- [ ] `StrikeSim2040.html` imports `cofm.js` in correct script load order after `moe.js`.
- [ ] `director.js` surfaces COFM net assessment cards and chips across BRIEF, PLAN/COMMIT (dock), and AAR summary screens.
- [ ] `node tools/director-ux-proof.js` and `node tools/wargame-loop-gate.js` pass with zero regressions.
- [ ] Architecture documentation `docs/ARCHI.md` updated per `docs/ARCHI-rules.md`.

---

## 4. Scope

- **MAY touch:**
  - `cofm.js` (NEW)
  - `docs/COFM_MODEL.md` (NEW)
  - `tools/cofm-proof.js` (NEW)
  - `StrikeSim2040.html` (script tag registration)
  - `director.js` (CSS styles and UI callouts)
  - `docs/ARCHI.md` (project structure update)
- **MUST NOT touch:**
  - `game.js` (single resolver invariant remains untouched)
  - `wargame.js`, `moe.js`, `red-mind.js`, `forecasting.js`
  - Scenario JSON definitions or schema files

---

## 5. Work plan

1. **Create Model Documentation:** Create `docs/COFM_MODEL.md` detailing domain weights, qualitative multipliers, and citations.
2. **Implement COFM Engine:** Write `cofm.js` (`window.CofmModule`), implementing `assess(board, options)`, `formatChip(report)`, and `formatCard(report)`.
3. **Build Headless Proof Harness:** Create `tools/cofm-proof.js` and verify tests pass.
4. **Register Script Tag:** Include `<script src="cofm.js"></script>` in `StrikeSim2040.html`.
5. **Integrate UI into Operation Loop:** Add `.dir-cofm-*` CSS styles and integrate COFM callouts into `renderBrief()`, `renderDock()`, and `openAar()` inside `director.js`.
6. **Update Architecture Docs:** Register `cofm.js` in `docs/ARCHI.md` §4.
7. **Run Verification:** Execute `node tools/cofm-proof.js`, `node tools/director-ux-proof.js`, and `node tools/wargame-loop-gate.js`.

---

## 6. Smoke test

```bash
# 1. Run COFM Proof Suite
node tools/cofm-proof.js

# 2. Run Director UX Proof Suite
node tools/director-ux-proof.js

# 3. Run Scenario Validation
node tools/validate-scenarios.js

# 4. Launch local server and test UI:
python3 -m http.server 8000
# Open http://localhost:8000/StrikeSim2040.html
# Verify COFM chip in status bar, briefing card, and AAR summary.
```

Expected output: All test suites exit 0; COFM cards and status chips render cleanly across Operation Loop phases.

---

## 7. Dependencies

- **Blocked by:** CO-008 (soft sequencing block — both edit `director.js`; land CO-008 first).
- **Blocks:** None.

---

## 8. One-line invocation

```text
Claude Code:   "Execute change-orders/CO-009-correlation-of-forces-and-means.md end-to-end. Follow the work plan exactly."
Codex CLI:     "codex exec --file change-orders/CO-009-correlation-of-forces-and-means.md"
Generic:       "Implement the change order in change-orders/CO-009-correlation-of-forces-and-means.md, in order, with tests passing."
```

---

## 9. Rollback

`git revert` the commit. `cofm.js` is a pure read-only module; removing it leaves core match resolution completely untouched.
