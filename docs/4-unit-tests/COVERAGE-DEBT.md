# Coverage Debt Ledger

UNCLASSIFIED // NOTIONAL RESEARCH TOOL

This is the honest, standing list of behavior that the automated gates
(`tools/run-all-gates.sh`) do **not** cover. It exists so that "all gates green"
is never mistaken for "everything is tested." It is referenced by
`docs/4-unit-tests/TESTING.md` and `docs/ARCHI.md` §19.

Format: `area / path | why it is hard to cover automatically | escape plan (how we gain confidence today)`.

## Standing gaps

| Area / path | Why hard to cover | Escape plan (current confidence) |
|-------------|-------------------|----------------------------------|
| Browser rendering (`StrikeSim2040.html` markup + CSS) | No headless DOM/layout engine in the no-build harness; layout/paint is visual. | Manual play-through before release; the proof harnesses run the *logic* modules headlessly. |
| 3D force-graph (`engine.js`, 3d-force-graph/Three.js) | Requires a live WebGL context and GPU; not available in Node. | `runtime-performance-proof.js` guards the lifecycle contract (pause/sleep) statically; manual 3D check before release. |
| Leaflet map rendering (`map.js`) | Requires a browser DOM + tile layer. | `map-capability-proof.js` covers popup HTML escaping; markers/tiles verified manually. |
| Modal focus traps, keyboard shortcuts, view switching (shell) | DOM + focus + event dispatch not modeled headlessly. | Manual keyboard pass; `role`/`aria` attributes reviewed in code. |
| Visual regression (design proofs) | Proof sheets emit SVG/console output, not pixel diffs. | Human review of the report-only proofs (milsymbol, rings, taskorg, taskorg-layout, theater). |
| Cross-browser behavior | One machine's Node ≠ every player's browser. | Target modern WebGL browsers; document prerequisites in `README.md`. |
| `tempo-test.js` | Kept as a focused AP/tempo probe, not wired into the standard gate. | Run manually when touching the tempo economy. |
| Balance band (`wargame-loop-gate.js`) | ~15 min; too slow for every push. | Run via `run-all-gates.sh --full` for engine-touching work and weekly in CI. |

## Escape-plan policy

New engine-touching behavior lands **with** a proof contract rather than a unit test
(the no-build design has no test framework by choice — see `TESTING.md`). When a gap is
genuinely hard to automate, record it here with a concrete way we currently gain
confidence, instead of leaving it silent.
