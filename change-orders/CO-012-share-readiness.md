# CO-012 — Share Readiness: locale determinism, worker cache integrity, honest offline posture

*Plan of record. 2026-07-25. Branch `fix/CO-012-share-readiness`.*
*Source: `_workshop/briefs/2026-07-25-architecture-audit.md`.*

## 1. Why

The prototype is going to a non-technical playtester as a hosted URL. That changes which
defects matter: anything that (a) silently breaks the replay/challenge-link guarantee, (b)
breaks when the build is *updated* under a returning browser, or (c) makes a documented claim
false, is now blocking. Refactors, dead code, and coverage debt are not.

Six items. Everything else in the audit is deferred.

## 2. Changes

### C1 — `localeCompare` removed from every determinism path  *(the headline)*

`String.localeCompare` with no locale argument follows the **host's ICU collation**. In
`resolveTurn` (`game.js:578-584`) the sort it feeds decides the order in which orders consume
`rng.next()` — so the "machine-independent order" the comment claimed was never machine
independent.

Reproduced before the fix (same seed 20260725, same board, same two Red kinetic strikes):

| | en-US | lt-LT |
|---|---|---|
| resolver order | `TWN-CMD-001` → `TWN-CYB-001` | `TWN-CYB-001` → `TWN-CMD-001` |
| `TWN-CMD-001` | hit, health → 48.65 | **MISS**, health → **100** |
| `TWN-CYB-001` | hit, health → 32.19 | hit, health → 48.65 |

Both IDs ship in `grokblue90.json` and `scenarios/small-island-fait-accompli.json`.

**Scope (verified):** bounded today to that one node pair and to `lt`/`lv` of 56 locales tested;
the other sites are exact-float tie-breakers, latent on the shipped graph. Reachable in ordinary
play — `sorted` also drives RNG-free first-come-first-served logistics funding
(`logistics.js:285-303`), so two ordinary Blue harden/repair orders on that pair fund different
nodes under `lt`/`lv`.

**Fix:** a `cmpStr(a, b)` helper in each of the three determinism modules, comparing UTF-16 code
units. **16 call sites replaced** — `game.js` ×12, `strategic-state.js` ×3, `forecasting.js` ×1.
Verified stable across en-US, lt-LT, sv-SE, tr-TR. Post-fix the repro is byte-identical.

Presentation-layer `localeCompare` (`views.js`, `director.js`, `map.js`, …) is untouched and
correct — display order *should* follow the reader's locale.

### C2 — Workers inherit their own cache-busting token

Main thread loaded `game.js?v=…`; both workers did `importScripts('game.js')` with **no token**,
and `new Worker('counterfactual-worker.js')` had none either. Separate cache entries with
independent lifetimes — so after an update a returning browser could run a fresh main thread
against a **stale worker engine**, silently, with no error. This is the defect that only bites
once the build is hosted and iterated, which is exactly what is about to happen.

**Fix:** each worker derives `self.location.search` and appends it to every `importScripts`
path; `director.js` gains `WORKER_BUILD` and versions both `new Worker(...)` sites. One token now
governs the worker *and* the engine copy it loads. Verified in the server access log:
`GET /moe.js?v=p2` (main thread) alongside `GET /moe.js?v=co012` (worker) — previously the latter
was untokenized.

### C3 — Online basemaps key off `online-flags.js`

`map.js` registered CARTO and Esri/Maxar tile layers directly in the Leaflet layer control.
`OFFLINE_MODE` (`StrikeSim2040.html:2183`) guards only `fetchJsonWithFallback` and has no reach
into Leaflet, so README.md:11's *"no external network calls at runtime"* and README.md:94's
*"`OFFLINE_MODE = true` blocks all remote fetches"* were both false, and ARCHI §15's binding rule
("anything network-touching keys off `online-flags.js`") was violated.

**Fix:** new flag `onlineBasemaps`, **false** in the offline build. The control now offers only
`Offline imagery (default)`, so no tile request can fire. A hosted build may set it true. Absent
`OnlineFlags` is treated as false, per the CO-007 kill-switch contract.

### C4 — Legacy graph controls locked during an operation

`Strike Selected` was already guarded mid-operation; `Reset Sim` and `Import JSON` were not, and
either desynchronizes the Director's board from `AppState`, voiding the replay guarantee.

**Fix:** `lockLegacyGraphControls()` called from `setPhase`; disables both for the duration and
restores their prior `disabled`/`title` on exit. Verified across the full lifecycle.

### C5 — AAR exploit probe no longer orphaned

`endOperation()` cleaned up the counterfactual worker but not the exploit-probe worker, and never
reset `op.exploitProbe`. Exiting mid-probe orphaned the worker, left status `'running'` so
`runExploitProbe` early-returned for the rest of the session, and allowed a late `done` to render
the previous operation's halt rates in the next operation's AAR.

**Fix:** `endOperation()` calls `stopExploitWorker()` and resets `op.exploitProbe = null`.

### C6 — The gate command no longer reports false green

`docs/4-unit-tests/TESTING.md:13,19` documented `... || break`. **`break` returns 0**, so those
loops exited successfully even when a proof failed — verified empirically (a proof exiting 3
yielded loop status 0). Every "all proofs green" claim made through that command was unfounded.

**Fix:** `tools/run-all-gates.sh` — accumulates failures explicitly, exits non-zero, excludes the
five report-only scripts that always exit 0 (`milsymbol`, `rings`, `taskorg`, `taskorg-layout`,
`theater`) so they cannot pad the count, never runs the dataset-rewriting generators, and adds a
**locale-invariance gate** (`LC_ALL=lt_LT.UTF-8` vs `en_US.UTF-8`, byte-identical required) so C1
cannot regress. TESTING.md rewritten around it with a standing warning against `|| break`.

## 3. Proof contract changes

`tools/counterfactual-proof.js` asserted the worker's `importScripts` line as a single source
literal, which C2 necessarily changed. Rewritten to assert **semantics** rather than text: the
module set, its order (harness law — `strategic-state.js` before `game.js`), token inheritance,
and both versioned `new Worker` sites. Net: same intent, no longer brittle to formatting.

## 4. Gates

`tools/run-all-gates.sh` → **ALL GATES GREEN (18 passed)**, including the new locale-invariance
gate. Balance gate (`--full`) run separately because C1 touches engine comparators.

Runtime verification (localhost, Browser pane): clean boot, **zero console errors**, all `co012`
tokens served, every request localhost, basemap control offers offline only, legacy controls lock
and restore across the operation lifecycle, worker token propagation confirmed in the access log.

## 5. Explicitly out of scope

Dead code (`campaign.js`, `wargame.js` — ~2,850 lines), the ~1,050-line shell extraction, COFM
semantics (`net` is a readiness index, not a force ratio), director/shell behavioral test
coverage, the remaining documentation drift, and the `site/` resync. All are real; none block a
playtest. See the audit brief for the full Tier-2/Tier-3 roadmap.
