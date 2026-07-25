# StrikeSim 2040 — Architecture Audit, Diagnostics & Roadmap

**Date:** 2026-07-25 · **Branch:** `feat/view-transition-performance` · **Version:** 0.1.1
**Method:** static audit + live runtime session (localhost:8000, full BRIEF→PLAN→COMMIT walkthrough) + every proof gate executed.

---

## 1. Executive Summary

StrikeSim 2040 is in **materially better health than a project of its age and size has any right to be.** The deterministic simulation core — `game.js`, `moe.js`, `red-mind.js`, `strategic-state.js`, `logistics.js`, `forecasting.js`, `counterfactual.js` — is genuinely well engineered: zero `Math.random()` and zero `Date.now()` anywhere in the resolver path, byte-identical replay contracts, tamper detection at three severities, and a 200-seed balance gate that currently passes at Blue 0.52. Every proof gate in `tools/` is green, including the full 15-minute balance gate. The syntax gate passes 57/57. The app boots clean with **zero console errors** and makes **zero external network requests at startup**. `director.js`'s resource lifecycle — worker termination, WATCH-playback timer cancellation, idempotent DOM construction with event delegation — is exemplary; an initial leak hypothesis was investigated and disproved.

The problems are **not in the engine. They are in the layer that surrounds it.** Three findings are load-bearing. First, the project's own documented "run all proofs" command **returns exit 0 even when a proof fails** — `... || break` yields a zero status, so the one command the entire quality regime rests on reports a false green (verified empirically). With no CI, no git hooks, and no root `package.json`, nothing else enforces the gates. Second, the README's headline promise — *"no external network calls at runtime"*, the claim that makes this tool acceptable to an air-gapped audience — **is false**: `map.js` registers two user-selectable external basemaps (Esri/Maxar, CARTO), `OFFLINE_MODE` has no reach into Leaflet, and no proof gate checks for external URLs. Third, the **COFM net assessment is mathematically degenerate**: it reports "CONTESTED PARITY 1.00" even when Red is reduced to a single node against Blue's 125, because force size is normalized away before the ratio is taken.

The strategic opportunity is **consolidation, not expansion**. Roughly 2,850 lines (`campaign.js` 1,435 + `wargame.js` 1,409) are unreachable dead code that still boots and injects DOM on every page load. Another ~1,050 lines of simulation and planning logic remain in the 323 KB HTML shell. The documented dependency-injection architecture is honored by 2 of 21 modules. Meanwhile the presentation and orchestration layers — `director.js` (173 KB, the actual product) and the shell — have **zero behavioral test coverage**; eight tools read `director.js` but only ever string-match it. The engine is proven; the game is grepped. Closing that gap, retiring the dead weight, and making the documentation honest would take this from an impressive prototype to something that survives outside review.

---

## 2. Architecture Breakdown

### Entry point and load order

`StrikeSim2040.html` (6,488 lines / 323 KB) is the shell: 19% inline `<style>`, 69% inline `<script>` across 6 blocks, 11% markup. It loads **26 `<script src>` tags** — 24 in `<head>` (lines 28–82), plus D3 and Leaflet mid-body (lines 2176–2177). Every module attaches a `window.<Name>Module` global; there is no build step.

Load order (head): `ui` → `state` → `milsymbol` → `symbols` → `map` → `engine` → `stage` → `sim` → `moe` → `cofm` → `red-mind` → `forecasting` → `strategic-state` → `logistics` → `game` → `online-flags` → `share` → `wargame` → `campaign` → `director` → `audio` → `cinematics` → `views` → `inline-datasets`.

**No unguarded load-time cross-module reads exist.** Every module body only declares; cross-module access happens inside functions, nearly all defensively late-bound. Boot is deferred to `DOMContentLoaded`.

`counterfactual.js` is never loaded in the browser — it reaches the runtime only via `importScripts` in `counterfactual-worker.js:8`.

### Data flow (the product loop)

```
title screen → director.start()
  BRIEF   ← CofmModule.formatCard() + scenario brief + seed disclosure
  PLAN    ← GameModule.queueOrder / LogisticsModule postures / map+3D as recon
  COMMIT  ← blind forecast elicitation (CO-011) → ghost-world forecast (K=200)
  WATCH   ← paced playback, op.watchTimers, cinematics
  AAR     ← MoeModule verdict + ForecastingModule Brier ledger
            + Counterfactual Machine (counterfactual-worker.js)
```

`GameModule.resolveTurn` is the single oracle. `director.js` drives it through a headless `_internal` surface.

### Coupling

| Module | Lines | Distinct external globals | Modules reached |
|---|---|---|---|
| `director.js` | 2,571 | 22 | 16 |
| `map.js` | 1,549 | 11 | 3 |
| `wargame.js` | 1,409 | 8 | 6 |
| `game.js` | 2,554 | 6 | 5 |

**Pure (zero external reach):** `ui.js`, `state.js`, `symbols.js`, `cofm.js`, `strategic-state.js`, `logistics.js`, `online-flags.js`, `audio.js`. The purity layering claimed in ARCHI holds, with one leak: `red-mind.js` and `moe.js` both reach for `window.mean` (owned by `sim.js`).

**`StrikeSim2040.html` is the hub of all 5 dependency cycles** (fan-out 12, fan-in 6). The only true module↔module cycle is `director.js` ↔ `cinematics.js`.

The documented DI contract ("the shell injects live getters via `Module.init({...})`") is honored by **2 of 21 modules** — `MapModule.init` and `ViewsModule.init`. Everything else self-boots and reads shell globals directly.

---

## 3. Diagnostic Findings

### Tier-A — credibility and correctness

#### A0 — `localeCompare` makes the resolver locale-dependent (CRITICAL, reproduced)

`game.js:578-584`, inside `resolveTurn` — the oracle:

```js
// Stable, machine-independent order so the RNG sequence is reproducible.
const sorted = orders.slice().sort((a, b) =>
  (rank[a.kind] - rank[b.kind]) ||
  String(a.side).localeCompare(String(b.side)) ||
  String(a.targetId).localeCompare(String(b.targetId)) || ...
```

**The comment's claim is false.** `localeCompare` with no locale argument uses the host's ICU
collation, which follows the browser/OS language. `sorted` then drives `L.prepareTurn(...)`, the
signal loop, and the indexed resolution passes — so it determines **the order in which orders
consume `rng.next()`**.

Reproduced end-to-end against the shipped datasets. Identical seed (20260725), identical board,
identical orders — two RED kinetic strikes on `TWN-CMD-001` and `TWN-CYB-001` (both ship in
`grokblue90.json` *and* `scenarios/small-island-fait-accompli.json`), whose sort tie-break falls
through to `targetId`:

| | en-US | lt-LT |
|---|---|---|
| resolver order | `TWN-CMD-001` → `TWN-CYB-001` | `TWN-CYB-001` → `TWN-CMD-001` |
| `TWN-CMD-001` | **hit**, dmg 51.35, health → 48.65 | **MISS**, dmg 0, health → **100** |
| `TWN-CYB-001` | hit, dmg 67.81, health → 32.19 | hit, dmg 51.35, health → 48.65 |

The Taiwan Joint Operations Center — a key objective — survives **untouched** under Lithuanian
collation and takes 51% damage under US collation, from byte-identical inputs.

**Blast radius:** the replay/anti-cheat premise (GAME_DESIGN §2), challenge/share links, and
`tools/replay-verify.js` itself. **Why no gate caught it:** every harness runs under the
developer's en-US locale, and no gate pins `LC_ALL`. Two tools (`joint-force-proof.js:223`,
`build-small-island-scenario.js:34`) use `localeCompare` themselves.

**Scope:** 16 sites in the determinism-critical layer — `game.js` ×12, `strategic-state.js` ×3,
`forecasting.js` ×1. Several `game.js` sites are AI target/method tie-breaks, so they decide
*which orders exist*.

**Fix (verified locale-invariant across en-US, lt-LT, sv-SE, tr-TR):** replace every
determinism-path `localeCompare` with plain code-unit comparison —
`(a < b ? -1 : a > b ? 1 : 0)`. Add `LC_ALL=lt_LT.UTF-8` as a second pass in the gate runner so a
regression fails loudly.

**SEVERITY CORRECTED after adversarial verification — medium, not critical.** The mechanism and
the reproduction above both stand, but the *scope* is much narrower than it first appears:

- Of 56 locales tested, only **`lt` and `lv`** collate the shipped ID vocabulary differently.
- Only **one node pair** in the shipped data is affected (`TWN-CMD-001` / `TWN-CYB-001`).
- Divergence additionally requires either same-side strikes on both in one turn, or both nodes
  carrying same-kind orders while funding stock covers exactly one.
- The other cited sites (`game.js:254,314,769,825,838,867-868,1571,1605`;
  `strategic-state.js:214,633`) are exact-float-tie breakers and stay **latent** on the shipped graph.
- A 4-match AI-vs-AI eval was byte-identical across locales.

Reachability is nonetheless **real in ordinary play** (not just an AI coincidence): `sorted` also
drives first-come-first-served logistics funding (`logistics.js:285-303`), which is RNG-free — so
two ordinary Blue harden/repair orders on that pair fund different nodes under `lt`/`lv`.

Accurate characterization: *a genuine cross-machine determinism defect that silently voids the
"determinism is the anti-cheat" invariant behind the default-on share/replay feature — bounded
today to one node pair and two locales, but latent across 16 sites and free to fix.* Keep it at the
top of the queue for cost/benefit, not for blast radius.

| # | Category | File / Line | Issue | Recommended fix |
|---|---|---|---|---|
| A1 | Test integrity | `docs/4-unit-tests/TESTING.md:13,19` | The documented "run all proofs" and syntax-gate loops use `\|\| break`. `break` returns 0, so **the loop exits 0 even when a proof fails** (verified: a proof exiting 3 yields loop status 0). The entire quality regime rests on a command that reports false green. | Replace `\|\| break` with `\|\| exit 1`, or accumulate `rc=1`. Add a `tools/run-all-gates.sh` that is the single source of truth. |
| A2 | Security / claim | `README.md:11,94`, `map.js:184,188,192`, `map.js:232-240` | "Runs fully offline — no external network calls at runtime" is **false**. Two user-selectable external basemaps (CARTO, Esri/Maxar) are registered in the Leaflet layer control. One click egresses tile requests — including the viewport bbox, i.e. the theater under study — to third parties. `OFFLINE_MODE` (`StrikeSim2040.html:2183`) guards only `fetchJsonWithFallback` at `:3552` and has **zero reach into Leaflet**. `OnlineFlags` is consumed only by `share.js`. | Gate the online layers behind `OnlineFlags` per the ARCHI §15 binding rule; add a proof contract that greps every runtime file for external URLs; restate the README claim as "no network at startup; two labeled opt-in basemaps exist and are stripped for air-gapped builds." |
| A3 | Model correctness | `cofm.js:134,144,177` | **COFM is degenerate.** `I_d = cur[d]/base[d]` is a self-normalized health fraction, so on any pristine board every domain is 1.00 for both sides and `net` is exactly 1.00 regardless of force composition. Verified against the real datasets: Blue 125 nodes vs Red **1** node still returns **`net = 1.00 · CONTESTED PARITY`**. Absolute force mass (`base[d]`) is computed, then discarded by the ratio. | Either (a) make the material term a genuine capability mass (ratio of weighted `base`, health-scaled), or (b) rename the readout to what it measures — a readiness/attrition index — and drop the "correlation of forces" framing. `COFM_MODEL.md:9-17` promises "two sides' combat potential"; the math delivers relative degradation. |
| A4 | Determinism | `director.js:1888,2026` + `counterfactual-worker.js:8`, `sim-worker.js:21` | **Cache-key split between main thread and workers.** Main thread loads `game.js?v=logistics-p1`; workers `importScripts('game.js')` with **no version token**, and `new Worker('counterfactual-worker.js')` has no token either — a separate cache entry with an independent lifetime. After an update the forecast (worker) and the world (main thread) can resolve from **different engine versions**, silently. Note: main-thread token discipline is otherwise rigorous — every changed module was bumped in the same commit. | Pass a version through to workers (`new Worker('counterfactual-worker.js?v=X')` and token the `importScripts` paths), or derive one token from a single constant. This is the one place manual bumping cannot fix, because there are no tokens to bump. |
| A5 | State integrity | Live runtime (verified in-session) | During an **active operation**, `Strike Selected` is correctly `disabled`, but **`Reset simulation state` and `Import JSON` remain enabled and reachable** (~2 clicks via the controls panel). Either would desynchronize the director's board from `AppState` and break the replay guarantee. The guard is clearly intended — it was applied asymmetrically. | Extend the `operation-active` disable to the reset and import controls. |

### Tier-B — maintainability

| # | Category | File / Line | Issue | Recommended fix |
|---|---|---|---|---|
| B1 | Dead code | `campaign.js` (1,435 ln), `wargame.js` (1,409 ln) | `CampaignModule` has **zero references** anywhere. Both launchers are killed by one CSS rule at `director.js:263` (`#wg-launch,#cp-launch{display:none !important;}`). `wargame.js` publishes **nothing** to `window`. Both still self-boot and inject CSS/DOM on every page load. ~15% of module code runs for nothing. | GAME_DESIGN §8.5 already sanctions retirement. Delete or move to `_workshop/`, behind a change order. |
| B2 | Coverage | `director.js` (173 KB), `StrikeSim2040.html` (323 KB) | **Zero behavioral coverage of the product loop.** 8 tools read `director.js`; all only parse-check and string-match it. The sole execution is `director-ux-proof.js:251-259` string-slicing two pure functions. `cinematics.js`, `audio.js`, `engine.js`, `stage.js`, `ui.js`, `views.js` are grepped, never executed. | Add a headless-DOM harness (jsdom or Playwright) that drives BRIEF→PLAN→COMMIT→WATCH→AAR and asserts phase invariants. |
| B3 | Harness fragility | `director-ux-proof.js:251-259`; `performance-layer-proof.js:28-34` (13 uses); `runtime-performance-proof.js:39-43` (8 fixed windows) | Proofs slice source by `indexOf('function name')` and **fixed character windows**. Renaming *or reordering* functions in a 173 KB file breaks them; a function outgrowing its hardcoded window causes assertions to read truncated source and pass or fail for the wrong reason. | Replace source-slicing with behavioral assertions against executed code (depends on B2). |
| B4 | Duplication | `sim.js:337-869` ↔ `sim-worker.js:65-597` | **531 lines maintained byte-identical by hand.** Verified: `diff` shows only the 2 marker comments differing — the discipline is holding. Guarded solely by a runtime `parityHash`. `counterfactual-worker.js` already demonstrates the correct `importScripts` fix. | Follow the counterfactual pattern. Until then, add a CI diff of the marked regions. |
| B5 | Bootstrap duplication | 13 copies across `tools/` | Every harness hand-rolls the same vm sandbox. Only 4 are textually identical; the rest drifted stylistically. The "harness law" (load `strategic-state.js` before `game.js`) is codified in prose in 3 docs and enforced by **zero code** — it has bitten seven tools (traceable through commits `88a02fc`, `72ab48e`, `c157f97`). `game.js:157` throws only inside a function, so an omitting harness loads clean and explodes mid-match. | Extract `tools/_harness.js`. Move the `StrategicStateModule` check to module eval so it fails loudly at load. |
| B6 | Shell monolith | `StrikeSim2040.html:5067-6083` | ~1,050 lines of simulation/planning logic in the shell: `runMonteCarlo` (5067-5404), COA/wizard/goal-plan helpers (5406-6083). Largest inline function is `bindEventListeners` at **458 lines** (3889-4346). Note: the README's claim that `simulateTrial` is still in the shell is **stale** — `:4737` is now a thin shim. | Extract a `planning.js` module. |
| B7 | Silent failure | 145 empty catch blocks (109 root `.js` + 36 HTML; `director.js` alone has 40) | Combined with the `typeof` guards around the map alias layer, the codebase's default failure mode is **silent no-op**. For a tool whose credibility rests on honest output, a swallowed exception in a scoring or forecast path yields a wrong number with no signal. | Triage: allow empty catches only around genuinely optional operations (`URL.revokeObjectURL`, `focus()`); everywhere else log via `UiModule`. |
| B8 | Nondeterminism | `sim.js:60`, `sim.js:274`, `sim.js:46` | `createRng(seed = Date.now() % 2147483647)` and `plannerSeed()` fall back to the **wall clock** when no seed is supplied — silent nondeterminism in a project whose premise is auditable replay. `randIn` (line 46) uses `Math.random()` and is **never called** — a loaded gun. Note: `game.js` and every pure module are clean. | Make missing seeds throw. Delete `randIn`. |
| B9 | Report-only "proofs" | `milsymbol-proof.js`, `rings-proof.js`, `taskorg-proof.js`, `taskorg-layout-proof.js`, `theater-proof.js`, `console-mockup.js` | Six scripts matching the `tools/*-proof.js` gate glob have **no failure path and always exit 0**. `taskorg-layout-proof.js` prints `98 px (should be >0)` and never checks it; `milsymbol-proof.js` would print `100/253` just as cheerfully. They pad the "all proofs green" count with zero coverage. | Rename to `*-report.js` and exclude from the gate glob, or give them assertions. |
| B10 | Destructive scripts | `rebalance-blue-joint-force.js:344,348`; `upgrade-cyber-capabilities.js:427-431` | Both **write the canonical force datasets unconditionally** — no `--write` guard, no `process.argv` read (the other three generators guard correctly). `upgrade-cyber-capabilities.js` also mirrors into `site/`. A naive `for p in tools/*.js; do node "$p"; done` silently rewrites both force networks. | Add `--write` guards to match the other generators. |
| B11 | Conflicting gates | `tempo-test.js:112` vs `wargame-loop-gate.js:154` | Two overlapping balance assertions with **incompatible bands**: 0.30–0.70 on 60 ai/ai seeds (measured 0.58) vs 0.45–0.55 on 200 seeds (measured 0.52). `tempo-test.js` is a real 87-second gate wired into **no** documented command. | Reconcile the bands; wire `tempo-test.js` into the gate list or retire it. |

### Tier-C — documentation drift

| # | Doc | Claim | Reality | Sev |
|---|---|---|---|---|
| C1 | `METHODOLOGY.md:240` | "six turns … D+1 … D+18.5. The horizon is **hard**" | `director.js:613` ships `turnLimit = 8` → **D+25.5**; `game.js:78` default is 10 → D+32.5. A methodology claim justified by CSIS First Battle scoping that the tool does not implement. | **High** |
| C2 | `README.md:62-75, 177-189` | Module table + layout tree | Omits ~16 shipped modules, including **`game.js` — the resolver**. Tree omits `director.js`, the documented front door. | High |
| C3 | `README.md:45-47` vs `:70` | "NDS Campaign Planner" listed under "What you can do" | Unreachable (B1). The same file contradicts itself 25 lines later ("Launcher hidden"). `NDS_CAMPAIGN_GAME_PLAN.md` has **no** dormancy disclaimer at all. | High |
| C4 | `change-orders/` | House rule (`START_HERE.md:36`): every change lands via a change order | **CO-011 has no document.** Commit `4fe5c85` shipped 5 files including 2 proof harnesses with no plan of record. Repeats finding F2 of the 2026-07-19 health baseline. | High |
| C5 | `ARCHI.md:30` | "Persistence: `localStorage` only — `strikesim.co006.settings`" | **11+ distinct keys** across `cinematics.js`, `audio.js`, `director.js`, `campaign.js`, `wargame.js`, and the shell. | Med |
| C6 | `README.md:26-28` | "frames the 3D view from the Blue perspective" | Default view is **map** (`StrikeSim2040.html:2723`). ARCHI correctly says the opposite. | Med |
| C7 | `game.js:69,1122,1953,2101` | Cites "GAME_DESIGN §3.5" | **No §3.5 exists** — GAME_DESIGN has flat sections 1–9. The contract lives at `METHODOLOGY.md:250-252` (§9.5). 4 dangling citations. | Med |
| C8 | `RED_MIND.md:90` | `deceptionRate` "not yet consumed" | **It is** — `game.js:1567`, `red-mind.js:249`. Only `escalationAppetite` is inert. Doc *under*-claims. | Med |
| C9 | `ARCHI.md:216`, `TESTING.md:50` | Coverage debt ledgered in `COVERAGE-DEBT.md` | File does not exist. | Med |
| C10 | `ARCHI.md:31,38,159,230,234` | No versioning; `Open StrikeSim 2040.command`; ~224 nodes; `_stark/`/`_codex_review/` live | `VERSION`=0.1.1 + tag `v0.1.1`; launcher is `▶ Play StrikeSim 2040.command`; **253** nodes; those dirs moved to `_workshop/` by CO-010 — contradicted by ARCHI's own line 69. | Med |
| C11 | `START_HERE.md:28-30` | `site-preview` "current through CO-009", resynced 07-20 | Actually current through **CO-010**, resynced 07-21; only 3 files / 68 lines behind. **`site/` is the genuinely stale one** (~730 lines behind, missing `cofm.js` entirely) — the doc points the reader at the wrong one. | Low |
| C12 | `README.md:195-198` | Roadmap: "`simulateTrial` still lives in the shell" | Already migrated; `:4737` is a shim. The *planning helpers* did not move (B6). | Low |

**Verified accurate (no drift):** `COFM_MODEL.md` constants, `FORECASTING_MODEL.md` (K=200 → `director.js:23`, Wilson z=1.645, all thresholds), `RED_MIND.md` numeric tables, `METHODOLOGY.md` §§1–8, `JOINT_FORCE_MODEL.md` capacity economy, `LOGISTICS_MODEL.md`, `CYBER_CAPABILITY_MODEL.md` (verified programmatically: 0 missing `resourceGenByType`, 0 legacy `jam` keys), `GAME_DESIGN.md`. **The model documentation is a genuine strength.**

---

## 4. Actionable Roadmap

### Tier 1 — Quick Wins & Critical Fixes

- [ ] **T1.0 Kill the locale dependency in the resolver.** Replace all 16 determinism-path
  `localeCompare` calls (`game.js` ×12, `strategic-state.js` ×3, `forecasting.js` ×1) with plain
  code-unit comparison. Add an `LC_ALL=lt_LT.UTF-8` pass to the gate runner. *(A0 — this is the
  single highest-priority fix in the codebase; it silently breaks the property everything else
  is built on.)*
- [ ] **T1.1 Fix the false-green gate.** `docs/4-unit-tests/TESTING.md:13,19` — `|| break` → `|| exit 1`. Add `tools/run-all-gates.sh` as the single entry point. *(A1 — do this first; every other gate claim depends on it.)*
- [ ] **T1.2 Make the offline claim true or honest.** Gate `map.js:184-195` behind `OnlineFlags`; add an external-URL contract to `tools/online-layer-proof.js`; correct `README.md:11,94` and `ARCHI.md:16,174`. *(A2)*
- [ ] **T1.3 Close the operation-active guard gap.** Disable `Reset simulation state` and `Import JSON` while `body.operation-active`. *(A5)*
- [ ] **T1.4 Version the workers.** Token `new Worker(...)` in `director.js:1888,2026` and the `importScripts` paths in both workers. *(A4)*
- [ ] **T1.5 Guard the destructive generators.** Add `--write` to `tools/rebalance-blue-joint-force.js` and `tools/upgrade-cyber-capabilities.js`. *(B10)*
- [ ] **T1.6 Demote the six report-only scripts** out of the `*-proof.js` gate glob. *(B9)*
- [ ] **T1.7 Write CO-011 retroactively**; fix `README.md` self-contradiction (C3), the `METHODOLOGY.md:240` turn window (C1), the 4 dangling `§3.5` citations (C7), `RED_MIND.md:90` (C8), and the `ARCHI.md` stale set (C5, C10). *(C1–C10)*
- [ ] **T1.8 Housekeeping:** delete `randIn` (`sim.js:46`); make missing seeds throw (`sim.js:60,274`); remove the 7 MB `_workshop/_to_delete/ss-snapshot.tgz`; clear the 2 iCloud duplicate artifacts in `site-preview/dist/`; push the 5 unpushed `main` commits.

### Tier 2 — Architectural Refactoring & Core Enhancements

- [ ] **T2.1 Retire the dead layers.** Delete `campaign.js` and `wargame.js` (~2,850 lines) behind a change order — GAME_DESIGN §8.5 already sanctions it. Remove the `director.js:263` CSS tombstone. *(B1)*
- [ ] **T2.2 Give the product loop real coverage.** Add a headless-DOM harness driving BRIEF→PLAN→COMMIT→WATCH→AAR, asserting phase invariants, timer cleanup, and forecast-gate semantics. **This is the single highest-value engineering investment available.** *(B2)*
- [ ] **T2.3 Retire source-slicing proofs** once T2.2 lands. *(B3)*
- [ ] **T2.4 Extract `tools/_harness.js`;** move the `StrategicStateModule` check to module eval so the harness law fails loudly. *(B5)*
- [ ] **T2.5 De-duplicate the sim core** via `importScripts`, following `counterfactual-worker.js`. *(B4)*
- [ ] **T2.6 Extract `planning.js`** (~1,050 lines) from the shell; split `bindEventListeners` (458 lines). *(B6)*
- [ ] **T2.7 Fix or rename COFM.** Decide between a real capability ratio and an honestly-named readiness index. *(A3)*
- [ ] **T2.8 Triage the 145 empty catches.** *(B7)*
- [ ] **T2.9 Reconcile the two balance bands.** *(B11)*
- [ ] **T2.10 Add minimal CI** — a pre-commit hook or GitHub Action running `run-all-gates.sh`. Nothing currently enforces any gate.

### Tier 3 — Next-Level Features & Scale

- [ ] **T3.1 Operation save/resume + replay UI.** GAME_DESIGN §8.6 is PARTIAL; seeds are already exportable and replay is verified — this is mostly UI over solved mechanics.
- [ ] **T3.2 Scenario switcher.** `AppState` is already scenario-centric.
- [ ] **T3.3 Forecast-elicitation pacing.** The CO-011 blind-forecast screen presents 11 sliders per turn; at 8 turns that risks the 4–7 min/turn budget in GAME_DESIGN §4. Consider progressive disclosure or a per-operation subset.
- [ ] **T3.4 Theater framing on the map.** Live session opened on a whole-world Mercator view with the engagement ring near the Arctic; PLAN should open framed on the Indo-Pacific.
- [ ] **T3.5 Fix the z-index collision.** The JOC comms log (`z-index:3000`, fixed, 16/637/430×69) draws over the director's primary CTA (`z-index:1500`). Verified **not** click-blocking (`pointer-events` disabled) — legibility only, but it lands on the exact CTA the player is told to press, and CO-011 already targeted this area.
- [ ] **T3.6 Resync or retire `site/`** (~730 lines stale, missing `cofm.js`); add `worker-configuration.d.ts` to `site-preview/` (`npx tsc --noEmit` currently fails on missing Cloudflare ambient types) and add a `typecheck` script.
- [ ] **T3.7 Red doctrine depth** — `escalationAppetite` is defined but inert; wiring it is the natural successor to CO-005.

---

## 5. Sharing the prototype — release readiness

**The bundle is ready as an artifact.** A clean staging copy was built and statically verified:
**9.8 MB, 58 files, all 35 relative references resolve.** Nothing internal leaks — `_workshop/`,
`change-orders/`, `docs/`, `tools/`, `Matt Olson's project/`, `site/`, `site-preview/`, `.claude/`,
`.agents/` are all excluded.

Contents: `StrikeSim2040.html` (+ an `index.html` copy), the 21 runtime modules, both workers,
`counterfactual.js`, both force datasets, and `vendor/ assets/ scenarios/`.

**A zip will not work.** Web Workers and the dataset fetches need a real HTTP origin; `file://`
fails (README.md:17-18 says so). Friends need a hosted URL, not a folder.

**Recommended vehicle:** Cloudflare Pages + Cloudflare Access — already the parked decision in
ARCHI §23 ("free ≤50 testers"), keeps the build non-public, and email-gates each friend. Alternative:
a password-protected itch.io page. Note ARCHI §14's "never deploy `site/` prematurely" refers to the
marketing site; shipping only the game bundle is a separate act, but worth confirming explicitly.

### Blocking before you share

| | Item | Why it blocks a *shared, iterating* build |
|---|---|---|
| 1 | **A1** false-green gate | Fix first, or "all gates green" before you ship means nothing |
| 2 | **A4** unversioned workers | **The real blocker.** You will push updates; friends' browsers cache `game.js` (worker copy) under a separate, untokenized key. They get new main-thread code + stale worker, silently |
| 3 | **A0/B1** `localeCompare` | Share/challenge links are the entire point of sharing with friends, and this voids their reproducibility. One-line fix |
| 4 | **A5** Reset/Import live mid-operation | Friends will click these. Cheap guard |
| 5 | **B12** orphaned exploit worker | Exiting during an AAR probe wedges it for the session; friends reach the AAR |
| 6 | **A2** external basemaps | Decide: strip them, or accept that a friend clicking "Satellite" sends their viewport to Esri/CARTO. Privacy call, not a security one |

### Explicitly *not* blocking

Dead code (`campaign.js`, `wargame.js`), documentation drift, test-coverage gaps, the shell
refactor, COFM semantics. All real; none stop friends from playing.

### Nice-to-have before strangers see it

`site-preview/` is one CO behind (missing CO-011); `site/` is ~730 lines stale and missing
`cofm.js`. If either is the vehicle, resync first. B5 (Small Island ghost-forecast lodgment clock)
grades the player's forecast against a different game on that one variant — worth fixing if you
expect friends to pick it.

## 6. Verification Log

| Check | Result |
|---|---|
| Syntax gate (`node --check`) | **57/57 pass** (baseline was 55/55) |
| All `tools/*-proof.js` executed | **All green**, incl. full 200-seed balance gate (Blue 0.52, ~15 min) |
| `validate-scenarios.js` | PASS — all scenarios ↔ schema |
| Live boot (localhost:8000) | **0 console errors**; 39 requests, **all localhost** |
| Live loop walkthrough | BRIEF → PLAN → order queue → COMMIT forecast gate all functional |
| `sim.js` ↔ `sim-worker.js` shared core | **531 lines byte-identical** (only marker comments differ) |
| Engine determinism surface | **0** `Math.random()` / `Date.now()` in `game.js` + all pure modules |
| `director.js` resource lifecycle | **Clean** — workers terminated, `clearWatchTimers()` called on all 3 exits, `buildDom()` idempotent with event delegation |
| COFM degeneracy | **Reproduced** — Blue 125 vs Red 1 node → `net = 1.00 CONTESTED PARITY` |
| False-green proof loop | **Reproduced** — proof exiting 3 yields loop status 0 |
| CI / hooks / linter at root | **None** |

*No files were modified during this audit.*
