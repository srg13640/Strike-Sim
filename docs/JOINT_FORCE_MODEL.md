# Blue Joint Force Model

## Purpose

StrikeSim's Blue graph represents a **Taiwan-led joint defense network**, not a U.S. Army corps with other services attached. The graph is an analytical model of mission packages, service relationships, and campaign dependencies. It is not a literal order of battle, deployment plan, readiness estimate, target list, or prediction that any partner would enter a conflict.

The redesign keeps the existing mission-capacity economy (`Kinetic 97 / Cyber 19 / EW 15 / SOF 0`) so representation can improve without quietly giving Blue more combat power.

## Force-design logic

- **Taiwan is the center of gravity for local defense:** joint command, coastal and littoral denial, air and missile defense, maritime awareness, reserve/territorial defense, resilient communications, cyber defense, and distributed repair.
- **U.S. Navy and Marine Corps form the forward maritime layer:** undersea denial, surface sea control and IAMD, maritime patrol, naval airpower, Marine littoral reconnaissance/counter-reconnaissance, sea denial, air defense, and expeditionary sustainment.
- **U.S. Air Force supplies distributed airpower:** air superiority, long-range strike, battle management and ISR, Agile Combat Employment, tanking, airlift, and rapid airfield recovery.
- **U.S. Army remains essential but supporting:** Multi-Domain Task Force integration, mobile land-based fires, theater IAMD, port opening, distribution, and sustainment no longer organize the entire Blue graph.
- **Space, cyber, and spectrum capabilities form the connective spine:** theater space integration, missile warning/tracking, resilient SATCOM/PNT, defensive cyber, partner-enabled cyber activity, and joint electromagnetic-spectrum operations.
- **Joint headquarters integrate rather than own every effect:** the JTF, maritime, air, logistics, cyber, space, and mission-partner layers expose cross-component dependencies in the graph.
- **Partner participation is conditional:** Japan, Australia, and Philippine access are modeled as separate political/operational dependencies, not automatic combat participation.

## Authored node contract

Every Blue node carries:

- `nation`, `serviceOwner`, and `component` — who owns the modeled aggregate;
- `jointFunction` and `operationalRole` — what it contributes to the campaign;
- `tempoRole` — explicit `command`, `logistics`, `relay`, or `none` contribution to the turn economy;
- `accessDependencies` — permissions, contracts, or partner decisions required for employment;
- `locationPrecision` — normally `theater-aggregate` or `representative-operating-area`;
- `capabilityProfile` — evidence class, confidence, availability, functions, assumption, and public `sourceRefs`.

Relative capacity points are not platform, sortie, munition, unit, billet, or access counts. Conditional and commercial packages contribute zero active capacity until a scenario decision activates them; optional capacity stays in `potentialResourceGenByType`.

## Evidence and the 2040 layer

The model separates three claims:

1. `observed` — a public authoritative source supports the capability class or organization;
2. `assessed` — the campaign role is an analytic inference from public material;
3. `notional-2040` — the exact package, automation, location, readiness, scale, or employment is a transparent game assumption.

2040 additions include scaled collaborative aircraft, distributed unmanned maritime sensing, proliferated multi-orbit transport/tracking, autonomous last-mile logistics, AI-assisted mission assurance, and expeditionary repair. Their labels do not claim those exact formations will exist.

SOCPAC is represented organizationally, but Blue SOF capacity remains zero. The current engine treats any nonzero SOF source as an unlimited high-damage method for every order in a turn. SOF currency should not be activated until typed magazines/availability are modeled symmetrically for both sides.

## Acceptance gates

`node tools/joint-force-proof.js` enforces the redesign through the actual game engine:

- 120–130 Blue nodes, with bounded Taiwan, Army, Navy, Marine Corps, Air Force, Space Force, and Joint representation;
- no owner over 40 percent of nodes or kinetic capacity;
- meaningful kinetic contributions from Taiwan and all four major U.S. warfighting services;
- complete component, role, tempo, location, evidence, and source coverage;
- conditional/commercial active capacity of zero;
- eight objectives spanning at least five owners and the air, maritime, land, and information/space layers;
- five initial Blue action points, degradation at 25 percent tempo loss, and a two-point floor after total tempo collapse;
- multiple target-relevant owners used by automatic Kinetic, Cyber, and EW source assignment;
- no isolated nodes and meaningful cross-component links.

## Public anchors

- Taiwan Ministry of National Defense, [2025 Quadrennial Defense Review](https://www.mnd.gov.tw/InformationServices/QDRFile/6/2/2025QDR%E8%8B%B1%E6%96%87%E7%89%88.pdf) and [2025 National Defense Report](https://www.mnd.gov.tw/newupload/ndr/114/114ndreng.pdf)
- U.S. Seventh Fleet, [Facts Sheet](https://www.c7f.navy.mil/About-Us/Facts-Sheet/); U.S. Pacific Fleet, [Organization](https://www.cpf.navy.mil/About-Us/Organization/); Commander, Submarine Force Pacific, [Mission](https://www.csp.navy.mil/About-SUBPAC/)
- U.S. Marine Corps, [3d Marine Littoral Regiment](https://www.3rdmlr.marines.mil/) and [Force Design](https://www.marines.mil/Force-Design/)
- Pacific Air Forces, [Mission, Vision, and Priorities](https://www.pacaf.af.mil/Info/Mission-Vision-Priorities/PACAFSelectorButton/) and Air Force Doctrine, [Agile Combat Employment](https://www.doctrine.af.mil/Portals/61/documents/AFDN_1-21/AFDN%201-21%20ACE.pdf)
- U.S. Space Force, [U.S. Space Forces Indo-Pacific](https://www.spaceforce.mil/About-Us/-Space-Force-Components/US-Space-Forces-Indo-Pacific/)
- U.S. Cyber Command, [2025 Posture Statement](https://www.cybercom.mil/Media/News/Article/4150133/posture-statement-of-lieutenant-general-william-j-hartman/)
- Military Sealift Command Far East, [Mission](https://www.msc.usff.navy.mil/Organization/MSC-Area-Commands/MSC-Far-East/Mission-Vision-History/)
- U.S. Special Operations Command, [2025 Fact Book](https://www.socom.mil/FactBook/2025%20Fact%20Book.pdf)
- U.S. Army, [Multi-Domain Task Force Fact Sheet](https://api.army.mil/e2/c/downloads/2023/10/16/93d3689c/multi-domain-task-force-fact-sheet.pdf)

