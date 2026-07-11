# StrikeSim 2040: Cyber, EW, and Information-Capability Model

**Status:** UNCLASSIFIED // NOTIONAL RESEARCH TOOL

**Model scope:** Cross-strait scenario, open-source baseline with explicit 2040 assumptions

**Resource schema:** `kinetic`, `cyber`, `ew`, `sof`

StrikeSim's capability data is designed to make information-domain actions playable without implying classified knowledge or false precision. The graph represents capability and service relationships at an analytical level. It is not an order of battle, target list, readiness report, or prediction of which countries would participate in a contingency.

## Why Cyber Previously Displayed as Zero

The original datasets and runtime grew before the resource definitions were stable. Nodes stored four fields — `kinetic`, `ew`, `jam`, and `sof` — while the Team Resources display asked for `cyber`. Some code paths also treated `ew` and `jam` as interchangeable, and some cyber, EW, or space nodes generated SOF points. The result was more than a display bug:

- Cyber had no canonical stored field, so the display reported zero.
- EW could be omitted or counted twice depending on which code path ran.
- Cyber and EW actions could draw from different resource buckets in planning and adjudication.
- SOF capacity was sometimes inferred from an information-domain label rather than an actual special-operations capability.

The canonical contract is now:

```json
"resourceGenByType": {
  "kinetic": 0,
  "cyber": 0,
  "ew": 0,
  "sof": 0
}
```

All four keys are required. Values are integers from 0 through 10. The legacy `jam` key is not valid serialized scenario data; old imports may be translated at the boundary, but exports and bundled scenarios use `ew`.

## What a Resource Point Means

A resource value is a **relative mission-capacity contribution per turn**. It supports game decisions such as how much cyber or EW activity a side can attempt before its capacity regenerates. It is deliberately ordinal and scenario-specific.

A point is **not** any of the following:

- one military unit, cyber team, crew, billet, platform, payload, or sortie;
- a count of exploits, access vectors, jammers, satellites, or weapons;
- an intelligence estimate of readiness, availability, or effectiveness; or
- a claim that two points in different scenarios represent identical real-world capacity.

Zero means “no active capacity contributed by this node under the current scenario assumptions.” It does not mean the represented state or organization has no real-world capability. Conditional partners and commercial services can carry a `potentialResourceGenByType` profile while contributing zero to the active budget.

Values should be compared within a scenario and treated as coarse game-balance inputs. Their sums are useful for adjudicating opportunity cost; they are not useful as force ratios.

## Resource Boundaries

| Resource | Represents in StrikeSim | Does not imply |
|---|---|---|
| `kinetic` | Capacity for actions that create physical damage through weapons or other destructive means | Exact weapon inventories, sortie generation, or magazine depth |
| `cyber` | Network access, code or data effects, defensive cyber operations, mission assurance, and service recovery | Guaranteed persistent access, zero-day holdings, or physical destruction |
| `ew` | Effects and support in the electromagnetic spectrum: electronic attack, electronic support, electronic protection, spectrum awareness, and PNT/SATCOM interference | Cyber access simply because a system is digitally controlled |
| `sof` | Capacity requiring an actual special-operations, partner-force, or physically placed unconventional capability | A generic covert quality attached to cyber, EW, space, or intelligence work |

Cyber and EW may reinforce one another operationally, but they remain different resource ledgers. A cyber-producing node cannot pay for an EW action merely because both are part of information warfare. Space services can enable cyber or EW, but “space” is a domain and dependency layer rather than a fifth generic attack currency.

Information and cognitive activities can be represented as capabilities, dependencies, or scenario effects without generating a resource point. The present four-resource economy intentionally avoids inventing a fifth “information” currency until its gameplay and adjudication rules are defined.

## Provenance and Availability Labels

Resource-generating and information-domain nodes can carry a `capabilityProfile`. Its labels keep public evidence separate from analytical judgment.

### Evidence class

- `observed` — an authoritative or otherwise credible public source confirms the organization, system, mission area, or capability class. This label does **not** confirm the modeled location, readiness, capacity value, or wartime tasking.
- `assessed` — the node is an analytical synthesis or inference supported by public doctrine, organization, exercises, and capability reporting, but the exact modeled aggregation is not publicly confirmed.
- `notional-2040` — the node is an explicit future-scenario construct. It may extrapolate a documented trend, but it is not presented as a current or programmed force.

### Confidence

`high`, `medium`, and `low` describe confidence in the narrow public-source proposition represented by the node. They do not measure the probability of success in game play.

### Availability

- `scenario-active` — contributes its canonical resource values in the current scenario.
- `conditional-partner` — represents support that depends on a political, legal, access, or force-employment decision. Active resource generation should normally remain zero until the condition is selected.
- `commercial-contract` — depends on contracted service, provider willingness, capacity, and continued access.
- `future-notional` — exists only as an explicit future assumption.

`sourceRefs` point to the scenario's top-level source catalog. `assumption` records the key modeling judgment, especially aggregation, illustrative map placement, partner participation, or 2040 extrapolation. A source reference supports only the proposition described; it does not validate every field on the node.

## Red Capability Architecture

The Red information architecture reflects the publicly reported 2024 PLA reorganization rather than retaining the dissolved Strategic Support Force as if it were still the controlling organization. It distinguishes three organizational roles:

- the **Information Support Force** as a network-information and joint information-support layer;
- the **Cyberspace Force** as the military cyberspace-operations layer; and
- the **Aerospace Force** as the military space layer.

Within that frame, StrikeSim uses theater-level capability aggregates rather than invented company-level units at exact bases. The modeled architecture can include:

- theater cyber mission packages for C4ISR, logistics, force-flow, and service disruption;
- access portfolios whose existence is assessed independently of whether they can produce an effect on demand;
- cyber mission assurance and recovery;
- spectrum reconnaissance, emitter mapping, electronic attack, and electronic protection;
- airborne EW aggregates grounded in publicly documented aircraft classes;
- PNT and SATCOM interference and reversible counterspace effects; and
- cognitive or proxy-amplification services that may shape the scenario without generating generic cyber or EW points.

The 2040 layer adds bounded extrapolations such as AI-assisted defensive recovery, distributed cognitive EW, and proliferated or reconstitutable data-relay services. These are labeled `notional-2040` or `future-notional`; their exact organization, capacity, and employment are scenario design choices.

## Blue Capability Architecture

Blue begins with a sovereign Taiwan defense and resilience core, rather than treating U.S. and allied forces as the entire Blue information architecture. The modeled service layers can include:

- Information, Communications and Electronic Force Command (ICEFCOM) joint C2 and military network defense;
- distributed defense data, terrestrial fiber and microwave, mobile/PPDR communications, and emergency non-geostationary satellite access;
- clean backup, service recovery, critical-infrastructure coordination, spectrum awareness, electronic protection, and distributed EW;
- EO/SAR mission services, satellite ground operations, public warning, trusted distribution, and cognitive defense; and
- mission-partner gateways connecting sovereign networks to authorized supporting forces.

U.S. capability is represented through abstract mission packages and services: Joint Force Headquarters–Cyber or defensive cyber support, joint cyber mission forces, Multi-Domain Task Force effects integration, mission-partner/CJADC2 services, U.S. Space Forces Indo-Pacific integration, space cyber defense, hybrid SATCOM/PNT, and space electromagnetic warfare.

Japan, Australia, and commercial providers are not assumed to participate automatically. Their nodes should be labeled `conditional-partner` or `commercial-contract`, contribute zero active capacity by default, and use `potentialResourceGenByType` only to describe the capacity that a scenario decision could activate. This separates a plausible option from a political prediction.

The 2040 Blue layer emphasizes hybrid commercial/military communications, proliferated services, automated orchestration, resilient mission data, and embedded cyber defense. It does not assert an exact future force structure.

## How ODIN Is Used

The U.S. Army's public [Operational Environment Data Integration Network (ODIN)](https://odin.t2com.army.mil/) is useful for equipment descriptions and World Equipment Guide taxonomy. In particular, its separation of cyber from electronic attack, electronic support, and electronic protection reinforces StrikeSim's decision to keep `cyber` and `ew` distinct. Public ODIN records for systems such as the [J-16D electronic-warfare aircraft](https://odin.t2com.army.mil/content.19cbc56d-c92e-4bbd-a013-a705f4910b4b), [Y-9LG electronic-warfare aircraft](https://odin.t2com.army.mil/content.e98a9282-33ed-49bc-9cf9-be31fd36ef76), [Y-9JB electronic-intelligence aircraft](https://odin.t2com.army.mil/content.8adf51ed-1958-4247-bbf4-d86194d486a6), and [Type 815G intelligence-collection ship](https://odin.t2com.army.mil/content.570e9578-dbac-4811-ba9a-7221c0865138) can anchor a capability class.

ODIN is **not** used as proof of a specific wartime deployment, exact location, quantity available, readiness rate, mission assignment, effect magnitude, or 2040 availability. A map marker for an aggregate capability is illustrative unless an open source and the node's assumption state otherwise.

## 2040 Assumption Boundary

“2040 dust” means a transparent extrapolation from a documented trend, not a license to present speculative systems as fact. A future node should:

1. state the operational trend it extrapolates;
2. use `evidenceClass: "notional-2040"` and `availability: "future-notional"`;
3. identify the public source that frames the trend;
4. record the key assumption in plain language; and
5. avoid precise unit designations, basing, inventory, access, or performance claims without public evidence.

The U.S. Space Force's *Future Operating Environment 2040* is appropriate for framing a more contested, hybrid, automated, and proliferated space-service environment. It is not proof that any specific StrikeSim node will exist. The same rule applies to projected autonomous cyber recovery or cognitive EW: those are scenario mechanisms to explore, not forecasts.

## Principal Open Sources

These sources establish organizations, mission areas, equipment classes, resilience priorities, or future operating trends. They do not calibrate StrikeSim's 0–10 resource values.

- U.S. Department of Defense, [*Military and Security Developments Involving the People's Republic of China 2024*](https://media.defense.gov/2024/Dec/18/2003615520/-1/-1/0/MILITARY-AND-SECURITY-DEVELOPMENTS%20-INVOLVING-THE-PEOPLES-REPUBLIC-OF-CHINA-2024.PDF) — PLA reorganization and information-force context.
- U.S. Department of Defense, [*Military and Security Developments Involving the People's Republic of China 2025*](https://media.defense.gov/2025/Dec/23/2003849070/-1/-1/1/ANNUAL-REPORT-TO-CONGRESS-MILITARY-AND-SECURITY-DEVELOPMENTS-INVOLVING-THE-PEOPLES-REPUBLIC-OF-CHINA-2025.PDF) — current public assessment of PLA cyber, information-support, space, and Taiwan-contingency roles.
- CISA and partner agencies, [*PRC State-Sponsored Actors Compromise and Maintain Persistent Access to U.S. Critical Infrastructure*](https://www.cisa.gov/sites/default/files/2024-02/aa24-038a-jcsa-prc-state-sponsored-actors-compromise-us-critical-infrastructure_1.pdf) — public basis for modeling access portfolios and critical-infrastructure risk, not on-demand effects.
- Taiwan Ministry of National Defense, [ICEFCOM information-services publication](https://www.mnd.gov.tw/en/informationservices/publication/83514) and [*2025 Quadrennial Defense Review*](https://www.mnd.gov.tw/InformationServices/QDRFile/6/2/2025QDR%E8%8B%B1%E6%96%87%E7%89%88.pdf) — sovereign cyber defense, information-force, and resilience context.
- Taiwan Ministry of Digital Affairs, [Communications and Cyber Resilience](https://moda.gov.tw/en/digital-affairs/communications-cyber-resilience/operations/310) — communications continuity and resilience priorities.
- U.S. Cyber Command, [2025 Posture Statement](https://www.cybercom.mil/Media/News/Article/4150133/posture-statement-of-lieutenant-general-william-j-hartman/) — joint cyber mission, defensive support, hunt-forward, and AI-adoption context.
- U.S. Army, [Multi-Domain Task Force fact sheet](https://api.army.mil/e2/c/downloads/2023/10/16/93d3689c/multi-domain-task-force-fact-sheet.pdf) — public structure and multi-domain effects framing.
- U.S. Space Force, [U.S. Space Forces Indo-Pacific](https://www.spaceforce.mil/About-Us/-Space-Force-Components/US-Space-Forces-Indo-Pacific/) and [*Future Operating Environment 2040*](https://www.spaceforce.mil/Portals/2/Documents/SAF_2026/Future_Operating_Environment_2040_Final.pdf) — regional integration and explicit future-environment framing.
- U.S. Army, [ODIN](https://odin.t2com.army.mil/) — equipment descriptions and cyber/EW taxonomy, subject to the boundary above.

## Validation Contract

The machine-readable contract is [`schemas/strikesim-scenario.schema.json`](../schemas/strikesim-scenario.schema.json). At minimum, scenario validation should confirm:

- every node has exactly the four canonical resource keys and integer values from 0 through 10;
- no serialized `jam` key remains;
- node and link identifiers resolve and duplicate undirected links are rejected;
- each `sourceRefs` entry resolves to the top-level source catalog;
- a cyber, EW, information, or space label does not silently create SOF capacity; and
- conditional or commercial potential is not added to active team resources until a scenario decision activates it.

This contract makes the model internally consistent. It does not make the underlying scenario “true”; analytical value still depends on transparent assumptions, sensitivity testing, and informed facilitation.
