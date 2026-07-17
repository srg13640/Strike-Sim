# StrikeSim 2040 — Contested Logistics Model

*UNCLASSIFIED // NOTIONAL RESEARCH TOOL*

`logistics.js` is a deterministic adapter over the live force graph. It makes
sustainment an allocation problem inside the existing Brief → Plan → Commit → Watch →
AAR loop without creating a second combat engine.

## State and decisions

Each side carries four 0–100 readiness-point stocks:

- **Fuel** supports kinetic, SOF, EW, movement, and rerouting demand.
- **Ammunition** supports kinetic strikes and selected deception activity.
- **Maintenance** bounds hardening, repair, reconstitution, and route recovery.
- **Personnel** represents available staff and specialist effort for operations,
  repair, and DDIL execution. It is not a headcount or casualty ledger.

Before commitment, the operator selects one allocation preset: balanced, surge,
repair, reroute, preposition, or DDIL. The AI uses the same public decision set. The
chosen decision is locked and serialized with the turn's orders.

## Network adapter

The adapter classifies the graph's logistics, command, relay, port, airfield,
distribution, depot, lift, and repair nodes. It builds four route modes—sea, air,
land, and digital—and tracks each route and hub as open, degraded, or closed.
Authors may override inference with a node `logisticsProfile`; the machine-readable
contract is in `schemas/strikesim-scenario.schema.json`.

Resolved battle damage drives disruption. Repair allocation plus available
maintenance/personnel recovers routes and nodes. Reroute allocation trades current
resources for alternate effective capacity. Prepositioned stocks buffer disrupted
flow. Command and digital-route damage creates DDIL friction; DDIL allocation models
redundant paths, local authority, and disconnected execution.

## Engine contract

- `game.js` remains the sole combat resolver and victory consumer.
- The logistics adapter consumes no random numbers. Identical graph state, orders,
  allocations, and seed produce identical results.
- Insufficient stock can reject an order during PLAN or void it at simultaneous
  resolution when aggregate demand exceeds available supply.
- Readiness can reduce action points and effectiveness. Red route flow also scales
  the denial arbiter's invasion throughput.
- Initial state, current state, turn decisions, reports, replay payloads,
  counterfactual branches, and AAR summaries all serialize explicitly.

## Analytic boundary

Every value is a model-conditioned comparison expressed in abstract readiness points.
The adapter does not estimate real inventories, fuel volumes, ammunition counts,
tonnage, lift capacity, sortie generation, personnel strength, casualties, repair
times, or probabilities of real-world outcomes. Scenario authors should document any
non-default starting values as assumptions and retain public-source provenance at the
node/scenario level.

Run `node tools/logistics-proof.js` for deterministic integration evidence and
`node tools/wargame-loop-gate.js` for the full operation-loop contract.
