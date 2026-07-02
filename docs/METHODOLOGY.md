# StrikeSim 2040: Denial-MOE Model — Methodology White Paper

**Version:** 1.1 (synchronized to the implemented model in `moe.js`)  
**Date:** July 2026  
**Classification:** UNCLASSIFIED // NOTIONAL RESEARCH TOOL

---

> **Disclaimer.** StrikeSim 2040 is a **notional, unclassified, open-source research and training tool** developed for analytical exploration and professional military education. It does not reflect classified government modeling, actual operational plans, or the positions of any government agency. Outputs are **analytic orderings with confidence ranges, not operational predictions.** Nothing in this document should be taken as an authoritative assessment of real-world military capability, intent, or outcomes.

---

## 1. Purpose and Scope

StrikeSim 2040 is a browser-based wargame and campaign-analysis environment designed to help analysts and students reason through joint targeting and campaign assessment in the context of a notional cross-strait scenario. The tool's denial-MOE model — documented here — replaced an earlier measure-of-performance (MOP) scoring regime in a deliberate methodological upgrade. This white paper records the rationale, the theoretical grounding, the implemented equations, the assumptions, and the limitations of that model.

The intended audience is defense analysts familiar with joint doctrine and campaign assessment methodology — the kind of reader who would encounter CJCSI 3162.02 [1], the Joint Staff J-7 Assessment Handbook [2], or the JFCOM Assessment Focus Paper [3] in ordinary professional reading. The paper is written to be scrutinized, not trusted uncritically; candor about model boundaries is a design requirement.

---

## 2. From MOP to MOE: Doctrinal Rationale

### 2.1 The Distinction

Joint doctrine distinguishes sharply between measures of performance (MOP) and measures of effectiveness (MOE). A **MOP** answers "Did we do what we said we would do?" — it measures task accomplishment (rounds expended, sorties flown, nodes struck). A **MOE** answers "Is the plan working?" — it measures change in adversary system behavior or capability against the commander's stated objective [1][2][4].

StrikeSim's legacy scorer operated as a MOP: it awarded credit when a node's health dropped below a neutralization threshold, and declared success when enough nodes were neutralized. This is operationally coherent for a targeting sub-problem but analytically insufficient for campaign assessment. A force can neutralize a large fraction of an adversary's order of battle yet still fail to prevent mission accomplishment — a historically recurrent failure mode that the MOP framing structurally cannot detect.

### 2.2 The Doctrinal Standard

CJCSI 3162.02 [1] and the J-7 Assessment Handbook [2] establish that valid MOEs must be **observable, quantifiable, precise, and correlated** with the commander's objectives. The assessment chain runs: **Effects → MOE → Indicators → Thresholds**. An effect without a measurable indicator tied to a threshold is not an assessable MOE; it is an assertion.

The Air University CADRE paper *Thinking Effects* [5] further emphasizes that effects-based assessment requires tracing the logic from desired end-state through intermediate effects down to observable indicators — and being honest when that logic chain is uncertain or contested.

### 2.3 The EBO Caveat

The model is designed against a specific intellectual hazard: the false precision of effects-based operations (EBO) analysis. General James Mattis's 2008 critique [referenced in 6] and Henriksen's subsequent analysis in *Air and Space Power Journal* [6] document how EBO-style tools invited analysts to over-specify causal chains and under-acknowledge uncertainty, producing confident-sounding outputs that masked deep modeling assumptions. The critique was not that effects matter — they do — but that precise numerical predictions of complex adversary system behavior are epistemically overreaching.

The denial-MOE model responds to this critique in two ways. First, it reports outputs as a **robust ordering of COA effectiveness** rather than a point prediction of operational outcome. Second, it uses Monte Carlo sampling at the simulation layer to generate **confidence ranges** around denialIndex scores rather than single-number verdicts. Analysts are directed to treat a denialIndex of 0.72 ± 0.09 as "this COA dominates," not as "72% probability of halting the invasion."

---

## 3. Strategy of Denial: The Correct Win Condition

### 3.1 Colby's Framework

The model's MOE is grounded in Elbridge Colby's strategy of denial, which holds that the correct objective in a Taiwan contingency is **preventing the PLA from seizing and holding Taiwan within the fait-accompli window** — not destroying the PLA, not regime change, and not punishing China into submission [7][8]. The win condition is the status quo ante: Taiwan not under PRC political control.

This distinction has direct implications for campaign scoring. Deterrence-by-punishment — the approach implicit in a body-count MOP — seeks to impose costs so severe that the adversary judges the enterprise not worth continuing. Deterrence-by-denial — the approach implemented here — seeks to deny the adversary the **capability** to accomplish the objective in the first place. Both mechanisms are present in the model (Section 5), but deny-capability is primary; impose-cost is a supplementary mechanism whose weight is operator-controlled [7][9].

### 3.2 "Winning by Not Losing"

The CSIS First Battle study [10] and RAND analyses [11][13][14] converge on a critical insight: **heavy attrition while Taiwan still falls constitutes strategic failure**, regardless of losses imposed. A campaign that kills a large fraction of PLA amphibious lift but allows a lodgment to be established and consolidated has not achieved the denial objective. The legacy MOP scorer — which awarded points for neutralizations — was structurally incapable of distinguishing these outcomes. The denial-MOE is designed specifically to distinguish them: success requires that amphibious throughput fall below the operationally viable threshold before the objective is achieved, not merely that significant attrition occurs.

### 3.3 Posture Implications

The denial framework also implies a posture logic: forward basing, resilient distributed forces, Japan basing access, and magazine depth in standoff munitions are decisive enablers [7][16]. The model captures this indirectly through the balance parameter and the structure of the Blue targeting problem — COAs that deny Red capability early (before lodgment) score better than COAs that impose equivalent attrition after the crossing is underway.

---

## 4. Empirical Grounding

The model's structural choices are anchored to the available open-source analysis of a cross-strait invasion scenario.

**CSIS "The First Battle of the Next War" (2023)** [10] is the most rigorous publicly available wargame analysis of this scenario, running 24 game iterations. Its key finding: invasions fail primarily through **amphibious lift attrition and lodgment strangulation** — not through air defense suppression or naval surface action alone. The factors most decisive in Blue-favorable outcomes were: SSN operations (magazine depth), bomber employment with LRASM, Japan basing access, and the condition of Taiwan's ports and beaches. The CSIS study also documented the pyrrhic cost structure: Blue-favorable outcomes still involve severe losses on all sides, reinforcing that the MOE must be framed around halt/not-halt rather than cost ratio.

**RAND analyses** [11][13][14] identify similar decisive factors and further emphasize the role of C2/ISR kill chains and sustainment vulnerability. RAND RRA1794-2 [13] on disrupting Chinese military operations and RRA2312-2 [14] on denial without disaster both support the model's emphasis on operational system coherence as the critical variable — not platform count.

**USNI Proceedings [15] and War on the Rocks analyses [12][16]** reinforce the culmination-point logic: the PLA operation fails not when it loses enough units but when its **throughput** — the rate at which it can land, sustain, and reinforce ground forces — falls below what is required to hold objectives against a defending force. This is the direct empirical basis for the throughput equation in Section 5.

**NDU Keystone [18] and RAND RR-1708 (Engstrom) [17]** document the PLA "systems confrontation / system-destruction warfare" (体系对抗 / 体系破击) doctrine, which holds that modern military capability is a system-of-systems property: degrade sufficient nodes in the operating system and the whole becomes non-viable. This doctrinal observation grounds both the node classification taxonomy and the OSVI formulation.

---

## 5. The Model and Equations

### 5.1 Node Classification

Each Red node is mapped to a functional subsystem via its `node.type` field, following the PLA systems-confrontation taxonomy [17][18]:

| node.type | Subsystem | Key |
|---|---|---|
| Command, Comms | Command & Control | `c2` |
| Sensor | ISR / Reconnaissance | `isr` |
| EW/Cyber | Information / EW | `info` |
| Fires | Firepower Strike | `fires` |
| Assault | Amphibious Lift | `lift` |
| Logistics | Sustainment | `sustain` |
| Blockade | Sea Control | `seacontrol` |
| Protection | Air Defense | `protect` |

The `node.type` mapping is the primary classifier; the implementation degrades gracefully on incomplete order-of-battle data. When `node.type` is missing or unrecognized, the classifier falls back to the node's `subsystem` field (Information Attack → `info`, Firepower Strike → `fires`, Assault → `lift`, Blockade → `seacontrol`). If neither field resolves, the node is assigned to `fires`; a null node reference resolves to `protect`. Nodes lacking an `importance` value receive the mid-scale default of 5. These defaults keep the assessment total — every Red node is scored — at the cost of classification noise on poorly attributed data.

### 5.2 Subsystem Score

For subsystem S with node set N(S), each node carries a **cascade-aware weight**:

$$w_i = \text{importance}_i \cdot (1 + 0.5 \cdot \text{cascScore}_i)$$

$$\text{subsystemScore}(S) = \frac{\sum_{i \in N(S)} w_i \cdot \text{healthFrac}_i}{\sum_{i \in N(S)} w_i} \in [0, 1]$$

where `healthFrac` is current health divided by baseline health, clamped to [0, 1]. Neutralized nodes contribute healthFrac = 0.

The cascade term operationalizes the systems-destruction premise [17][18]: a node whose failure propagates through the network (high `cascScore`) contributes more enabling value to its subsystem than an equally important node whose failure is contained, so its loss depresses the subsystem score disproportionately. A node with no cascade data defaults to cascScore = 1 (weight 1.5 × importance); where no node in a subsystem carries differentiated cascade data, the uniform factor cancels in the ratio and the score reduces to the plain importance-weighted mean.

### 5.3 Operational System Viability Index (OSVI\_Red)

OSVI\_Red is a weighted sum over **enabler** subsystems — those that allow the PLA operating system to function. Amphibious lift is excluded from OSVI; it enters the model as the multiplicand in the throughput equation (Section 5.4), not as an enabler of the system's own coherence.

$$\text{OSVI\_Red} = \frac{\sum_{s \in E} w_s \cdot \text{subsystemScore}(s)}{\sum_{s \in E, \text{present}} w_s}$$

where E is the set of enabler subsystems present in the scenario, and weights are renormalized over those present. Default weights (summing to 1.0 over all enablers):

| Subsystem | Weight | Rationale |
|---|---|---|
| C2 | 0.27 | PLA targeting priority; system-destruction warfare begins with C2 [17][18] |
| ISR | 0.20 | Kill-chain dependency; C2 without targeting is blind [22] |
| Fires | 0.16 | Suppression and shaping of the lodgment zone |
| Sustainment | 0.15 | Cross-strait crossing is logistics-intensive; culmination is a sustainment problem [10] |
| Info / EW | 0.12 | Electronic warfare and cyber enable all other subsystems |
| Sea Control | 0.06 | Blockade/surface control; significant but partially redundant with lift |
| Air Defense | 0.04 | Protect own forces; lower weight because degradation is less decisive than C2/ISR |

These weights are **analytic assumptions**, not empirically calibrated parameters. They encode a judgment — grounded in PLA doctrine [17][18] and CSIS/RAND findings [10][13] — about relative criticality. Analysts should treat sensitivity to weight perturbation as a first-order uncertainty.

### 5.4 Amphibious Throughput

$$T = \text{liftCapacity} \times \text{OSVI\_Red}^k, \quad k = 2$$

where liftCapacity is the subsystem score for the `lift` subsystem (assault shipping health), T is a fraction of maximum theoretical throughput in [0, 1], and k is a **coordination/cascade penalty exponent**.

liftCapacity follows a fallback chain for partial orders of battle: if the scenario contains no Amphibious-Lift nodes, the sea-control subsystem score is substituted as the nearest maritime-transport proxy; if that subsystem is also absent, a neutral constant of 0.6 is used. The fallbacks keep the throughput equation defined on any Red node set, but a scenario without lift nodes is exercising a proxy — throughput results there should be read as indicative, not assessed.

The exponent k = 2 encodes the judgment that amphibious lift capacity without a functioning operating system cannot be realized: vessels without functioning C2 cannot coordinate loading, routing, or fire support; without ISR they cannot navigate contested waters; without sustainment they cannot be resupplied. The quadratic relationship reflects a multiplicative (not additive) dependency structure consistent with the cascade literature on network interdiction [19] and with Engstrom's account of system-destruction warfare [17].

k = 2 is an **analytic assumption**. The true functional form of this dependency is not empirically known for the Taiwan scenario. Sensitivity analysis varying k in [1.5, 3.0] is recommended for robustness checks.

### 5.5 Capability Denial

$$\text{capabilityDenial} = \text{clamp}_{[0,1]}\!\left(\frac{1 - T}{1 - T_{\min}}\right)$$

$$\text{halt} = \begin{cases} \text{True} & T < T_{\min} \\ \text{False} & \text{otherwise} \end{cases}$$

The implemented formulation is a **partial-credit rescaling**:† capabilityDenial rises linearly from 0 at full Red throughput (T = 1) to 1.0 when throughput reaches the halt threshold (T = T\_min), and saturates at 1.0 below it, so any reduction in Red throughput earns proportional capability-denial credit. This choice has two motivations. Operationally, partial throughput denial is meaningful short of a halt — it slows lodgment build-up and reinforcement even while the crossing continues. Computationally, it gives the greedy COA generator (Section 7) a smooth gradient to climb: because the generator and the evaluator share one MOE function, a formulation that awards no credit until throughput crosses T\_min would leave early strikes with zero capability-denial gain and bias the generator toward cost-imposition targets. The binary halt determination is unaffected: `halt` remains the hard threshold test T < T\_min.

Default T\_min = 0.30. This threshold represents the **minimum amphibious throughput** below which the crossing force cannot establish and sustain a lodgment against a competent defending force — operationally analogous to the culmination-point concept in JP 3-0 [20] and Clausewitzian theory. At T < T\_min, the operation's internal logic fails: the force cannot reinforce, cannot be resupplied, and cannot achieve the operational objectives that justify the cost.

T\_min = 0.30 is an **analytic assumption** derived from the CSIS finding [10] that scenarios in which Blue forces halted Red generally involved reducing effective amphibious capacity to a fraction that could not sustain a lodgment. It is not a classified estimate of actual PLA operational requirements.

† A stricter variant, capabilityDenial = clamp₍₀,₁₎(1 − T/T\_min), which awards capability-denial credit only as throughput falls below the halt threshold, is a defensible alternative for pure halt/no-halt scoring. It is not implemented because it is flat (zero gradient) over most of the throughput range, which would starve the goal-driven generator of a usable optimization signal.

### 5.6 Cost Denial

$$\text{redCost} = \text{clamp}_{[0,1]}\!\left(1 - \frac{\sum_i w_i \cdot \text{healthFrac}_i}{\sum_i w_i}\right)$$

$$\text{costDenial} = \text{clamp}_{[0,1]}\!\left(\frac{\text{redCost}}{\text{costTolerance}}\right)$$

Default costTolerance = 0.55. redCost is the weighted fractional loss across **all** Red nodes — every subsystem, including lift — using the same cascade-aware weights w\_i defined in Section 5.2, so the loss of a cascade-capable node registers as a proportionally larger cost imposed, mirroring its larger contribution to the operating system. costDenial reaches 1.0 when losses exceed costTolerance — the point at which the operation is assessed to have become politically unsustainable. costTolerance is an analytic assumption about PRC risk tolerance; it is not derived from classified intelligence.

### 5.7 Denial Index and Success Criterion

$$\text{denialIndex} = \text{clamp}_{[0,1]}\!\bigl[(1 - \alpha)\cdot\text{capabilityDenial} + \alpha\cdot\text{costDenial}\bigr]$$

where α (`balance`) ∈ [0, 1] is the **operator-set intent parameter**:  
- α = 0: pure deny-capability (halt the crossing by operational paralysis)  
- α = 1: pure impose-cost (break the will to continue)  
- Default α = 0.35, reflecting the Colby framework's primacy of capability denial with a supplementary cost-imposition role [7]

**Monte Carlo success (per trial):** denialIndex ≥ 0.50  
**Capitulation:** halt is True AND C2 subsystem score < 0.30

Capitulation is a distinct outcome from halt: it requires not merely that throughput fall below threshold, but that C2 has collapsed to the point where the adversary's command structure cannot coherently manage the operation. This is consistent with PLA doctrine's own account of how system-destruction warfare defeats an adversary [17][18].

---

## 6. The Two Mechanisms and Their Indicators

The model implements two operationally distinct pathways to denial, each with a different observable indicator chain.

**Mechanism 1 — Operational Paralysis (capability denial):** Blue targeting degrades the Red operating system (C2, ISR, sustainment, fires) to the point where amphibious throughput falls below T\_min. Indicators: OSVI\_Red trending below 0.55; throughput T trending below 0.30; lift operations unable to maintain crossing rate. Threshold: halt = True.

**Mechanism 2 — Cost Imposition (cost denial):** Blue targeting imposes losses severe enough to cross the adversary's political tolerance threshold. Indicators: redCost trending above 0.40; the cascade-weighted surviving fraction (Section 5.6) declining; operational tempo unsustainable given losses. Threshold: costDenial ≥ 1.0.

These mechanisms correspond to deterrence-by-denial and deterrence-by-punishment respectively [7][9]. The model treats them as complementary: a COA that achieves only Mechanism 2 without Mechanism 1 may impose heavy losses on both sides while the operation continues to succeed — the failure mode that the CSIS study documented as "Blue wins the attrition exchange, loses the war" [10].

---

## 7. Goal-Driven COA Generation

The COA generator uses a **greedy hill-climb** that iteratively selects the strike (target node × method) maximizing marginal denialIndex gain per unit cost. The scoring function at each step is:

$$\text{score}(u, m) = \frac{\Delta\text{denialIndex}(u,m)}{\text{cost}(m)} \times (0.6 + 0.4 \cdot p_{u,m})$$

where p\_{u,m} is the estimated strike probability for node u and method m. The 0.4·p factor tilts selection toward reliable (high-probability) strikes. Risk calibration is enforced by a hard probability floor governed by the operator's `riskTolerance` parameter: a candidate strike is considered only if

$$p_{u,m} \geq 0.15 + (1 - \text{riskTolerance}) \times 0.45$$

so an operator at riskTolerance = 1 admits any strike with at least a 15% hit probability, while an operator at riskTolerance = 0 plans only strikes with at least a 60% hit probability.

When projecting the effect of a candidate strike, the generator assumes an expected hit removes approximately **60% of the target's remaining health** (healthFrac ← healthFrac × (1 − 0.6·p)). This is a **planning heuristic internal to the generator** — it approximates average strike damage so that resilient, high-value nodes realistically require multiple planned strikes and the projection tracks the Monte Carlo rather than over-killing. It is not part of the Monte Carlo evaluation, which samples actual damage outcomes per trial.

The decisive methodological feature is that **the generator and the evaluator share one MOE function**. This eliminates the common pathology in which a COA generator optimizes a different metric (e.g., expected kills) than the campaign evaluator uses to score success. Here, a COA generated by the tool is internally consistent with the MOE it will subsequently be scored against.

The generator terminates when the projected denialIndex reaches 0.97 (near-total denial; further strikes add negligible gain), when no remaining strike yields a positive marginal gain (diminishing returns), or when the maximum step count is reached. It does not branch or backtrack; it is greedy. This means it may miss globally optimal sequences — a known limitation of greedy algorithms on interdependent networks [19]. For research purposes, exhaustive or branch-and-bound approaches would provide tighter bounds.

---

## 8. Assumptions, Limitations, and the EBO Caveat

**Coefficient assumptions.** OSVI weights, T\_min, k, and costTolerance are analytic judgments, not empirically calibrated parameters. No historical amphibious operation is directly analogous to a contested cross-strait crossing at the scale and technology level of this scenario. Analysts should run sensitivity analysis over plausible ranges before drawing conclusions.

**Cascade uncertainty.** The exponent k captures a coordination-penalty intuition but does not model specific failure modes (e.g., which C2 nodes produce which propagating failures, or how quickly adversaries reconstitute). The cascade literature [19] establishes that network interdiction effects are highly sensitive to network topology — effects that are decisive in one network architecture may be minor in another. The model uses a coarse aggregate substitute.

**Human will is exogenous.** costTolerance encodes a political judgment about PRC risk tolerance that is both deeply consequential and essentially unmodelable from open sources. The model treats it as a fixed parameter; in reality it is dynamic, dependent on domestic politics, leadership signaling, and events that a wargame cannot capture. The EBO critique [6] applies with particular force here.

**Single-period snapshot.** The model assesses a campaign state at a point in time. It does not model reconstitution, escalation, or how Red adapts to Blue targeting. These are first-order real-world dynamics that single-period interdiction models systematically underweight.

**No Blue cost.** The model assesses Red denial; it does not score Blue losses. The CSIS study [10] found that even favorable outcomes are costly for Blue. A complete campaign assessment requires a complementary Blue attrition model.

**Greedy COA generator.** The hill-climb is computationally tractable but not globally optimal. It will miss sequencing effects and synergies across strikes that branch-and-bound or Monte Carlo tree search approaches might find.

**Outputs are orderings, not predictions.** Consistent with the Mattis/Henriksen EBO critique [6], denialIndex values should be interpreted as **relative ranks** across COAs — "COA A dominates COA B" — not as probability estimates of real-world outcomes. The Monte Carlo layer generates confidence ranges that further caution against point-estimate interpretation. This tool is a reasoning aid, not an oracle.

---

## 9. References

[1] Joint Chiefs of Staff. *CJCSI 3162.02: Methodology for Combat Assessment.* Available: https://www.jcs.mil/Portals/36/Documents/Doctrine/training/jts/cjcsi_3162_02.pdf

[2] Joint Staff J-7. *Commander's Handbook for Assessment Planning and Execution.* Available: https://www.jcs.mil/Portals/36/Documents/Doctrine/pams_hands/assessment_hbk.pdf

[3] JFCOM. *Insights and Best Practices Focus Paper No. 11: Assessment.* Available: https://nllp.jallc.nato.int/IKS/Sharing%20Public/Assessments.pdf

[4] Paul, C. & Matthews, M. *RAND RR-2655: Assessment Lexicon.* RAND Corporation. Available: https://www.rand.org/content/dam/rand/pubs/research_reports/RR2600/RR2655/RAND_RR2655.pdf

[5] Mann, E., Endersby, G., & Searle, T. *Thinking Effects: Effects-Based Methodology for Joint Operations.* Air University CADRE Paper 15. Available: https://media.defense.gov/2017/Nov/21/2001847048/-1/-1/0/CP_0015_MANN_ENDERSBY_SEARLE_THINKING_EFFECTS.PDF

[6] Henriksen, A. "Mattis's Criticism of Effects-Based Operations: A Rejoinder." *Air and Space Power Journal* 26(5). Available: https://www.airuniversity.af.edu/Portals/10/ASPJ/journals/Volume-26_Issue-5/V-Henriksen.pdf

[7] Colby, E. & Slocombe, W. "The State of (Deterrence by) Denial." *War on the Rocks*, March 2021. Available: https://warontherocks.com/2021/03/the-state-of-deterrence-by-denial/

[8] "The Strategy of Denial." *CIMSEC Review.* Available: https://cimsec.org/the-strategy-of-denial-american-defense-in-an-age-of-great-power-conflict/

[9] Sisson, M. *Taiwan and the Dangerous Illogic of Deterrence by Denial.* Brookings Institution, 2022. Available: https://www.brookings.edu/wp-content/uploads/2022/05/FP_20220505_taiwan_strategy_sisson.pdf

[10] Cancian, M., Cancian, M., & Heginbotham, E. *The First Battle of the Next War: Wargaming a Chinese Invasion of Taiwan.* CSIS, 2023. Available: https://csis-website-prod.s3.amazonaws.com/s3fs-public/publication/230109_Cancian_FirstBattle_NextWar.pdf

[11] RAND Corporation. *U.S.-China Military Scorecard.* Available: https://www.rand.org/paf/projects/us-china-scorecard.html

[12] Jensen, B. "Not So Fast: Insights from a 1944 War Plan Help Explain Why Invading Taiwan Is a Costly Gamble." *War on the Rocks.* Available: https://warontherocks.com/not-so-fast-insights-from-a-1944-war-help-explain-why-invading-taiwan-is-a-costly-gamble/

[13] RAND Corporation. *RRA1794-2: Disrupting the Chinese Military.* Available: https://www.rand.org/pubs/research_reports/RRA1794-2.html

[14] RAND Corporation. *RRA2312-2: Denial Without Disaster, Volume 2.* Available: https://www.rand.org/pubs/research_reports/RRA2312-2.html

[15] Lantes, J. "Strategic Disruption Can Thwart an Invasion of Taiwan." *USNI Proceedings*, December 2024. Available: https://www.usni.org/magazines/proceedings/2024/december/strategic-disruption-can-thwart-invasion-taiwan

[16] McKinney, J. & Harris, P. "Understanding the Deterrence Gap in the Taiwan Strait." *War on the Rocks*, February 2024. Available: https://warontherocks.com/2024/02/understanding-the-deterrence-gap-in-the-taiwan-strait/

[17] Engstrom, J. *RAND RR-1708: Systems Confrontation and System Destruction Warfare.* RAND Corporation. Available: https://www.rand.org/pubs/research_reports/RR1708.html

[18] Wuthnow, J. "PLA Systems Attack." *NDU Keystone* 25-1, January 2025. Available: https://keystone.ndu.edu/Portals/86/PLA%20Systems%20Attack%20-%20Keystone%2025-1%20Jan%2025.pdf

[19] Morton, D., Pan, F., & Saeger, K. "Stochastic Network Interdiction." *Operations Research* 46(2), 1998. Available: https://pubsonline.informs.org/doi/10.1287/opre.46.2.184

[20] Joint Chiefs of Staff. *JP 3-0: Joint Operations.* Available: https://www.jcs.mil/Doctrine/DOCNET/JP-3-0-Joint-Operations/

[21] CNAS. *Hellscape for Taiwan.* Center for a New American Security, 2026. Available: https://s3.us-east-1.amazonaws.com/files.cnas.org/documents/Hellscape_DEFENSE_2026-Final.pdf

[22] Brose, C. *The Kill Chain* (NDU Press review). Available: https://ndupress.ndu.edu/Media/News/News-Article-View/Article/2884464/the-kill-chain/

---

*End of document. StrikeSim 2040 is a notional, unclassified research and training tool. No classified sources were used. All modeling choices are analytic assumptions made by the tool's developers and should be treated as such.*
