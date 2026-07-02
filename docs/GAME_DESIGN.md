# StrikeSim 2040 — Game Design Document

**Version:** 1.0 — post-red-team revision (feasibility, credibility, fun critiques resolved; see Appendix A for rejected critiques)
**Classification of all content data:** NOTIONAL//UNCLASSIFIED — open-source derived, cited
**Status:** Final for product-owner review. Synthesizes five research reports (professional wargaming method; Taiwan-scenario evidence; craft/competitor study; codebase gap audit; adjudication-model survey) plus three red-team reviews into one buildable design. All file references are to the existing codebase; all substantive mechanics carry inline citations to §11. Internal research reports ([GAP-AUDIT], [MODEL-RPT], [TAIWAN-RPT]) are to be committed under `docs/_research/` before this document circulates externally, so the internal citation trail is auditable.

---

## 1. Concept & Fantasy

**Working title fantasy:** *You are the Joint Task Force commander's operational planner — the person who owns the denial campaign for the first three weeks of a Taiwan war.*

The player is a single analyst/facilitator (locked decision) playing a dual in-fiction role modeled on how CSIS ran its 24-iteration Taiwan game [CSIS-FB]: during play they are the **JTF J3/J5 — the commander's operations and plans officer**, issuing intent and apportionment for a joint force; between runs they step back into their real-world identity as the **analyst running an iterated study**, because in this genre the run is a data point, not a verdict [UK-HB ¶1.17–1.19].

**The one-sitting experience (45–75 minutes):** You open on a *played* Brief. Red's doctrinal opening — the joint fires strike against Blue C2, ISR, and bases that PLA systems-destruction doctrine prescribes [ENGSTROM; WUTHNOW] — has already happened; it is pre-adjudicated, exactly as CSIS pre-adjudicated China's war-opening strike in every iteration to start play where decisions matter [CSIS-FB App. C] — and you *watch it land* as a 60–90 second playback that teaches the game's watch grammar before you own a single order. The board is a Taiwan-strait theater: Red's invasion system (the 120 Red nodes moe.js assesses) and Blue's own kill chain (the 104 Blue nodes — bases, tankers, C2, ISR — already on the board), because the great majority of allied aircraft losses in the CSIS games happened on the ground [NAVALNEWS, summarizing CSIS-FB].

You fight six turns at 3.5 days each — the decisive first three weeks, CSIS's proven scoping [CSIS-FB Ch.3]. Each turn you make command decisions, not clicks: how to apportion strike packages and magazines, what posture to accept, what risk and ROE to request, what Red subsystem to break first. Turn 1 is the triage turn, and it hurts on purpose: the amphibious fleet is at its most massed and most targetable on D+1 — spend the LRASM bin now for the best shots you will ever get and be empty within the week (consistent with CSIS-reported LRASM exhaustion in the first days of every iteration [CSIS-FB; EMPTY-BINS]), or husband it and let the first echelon cross. You commit, then you watch your standing orders and contingencies execute against a Red that plays its doctrine — with a small command reserve in hand for the moment the convoy sorties early. The session ends in an AAR that opens on the verdict and one counterfactual worth rerunning, hands you a one-page exportable brief, and pre-loads the next excursion.

**What the game is, formally:** an analytical (decision-information) wargame in the McHugh/Naval War College taxonomy [MCHUGH via UK-HB ¶1.12] — its product is insight about denial campaigns, delivered as story, because "games are story-living experiences" and story is how insight persists [PERLA-MCGRADY; MCGRADY]. It is a real wargame under the NATO criteria — a human makes the consequential decisions, against friction, with consequences [NATO-HB Ch.2] — and its Monte Carlo engine is the adjudication instrument, never the game itself [PERLA; UK-HB ¶1.4–1.9]. Autoplay/batch MC without a human deciding is analysis, not wargaming, and the UI labels the two modes as such [NATO-HB Ch.2].

**Win condition (unchanged, universal for invasion scenarios):** Colby strategy-of-denial — the continued autonomy of Taiwan as a political entity, judged by the denial MOE (moe.js denialIndex / halt conditions), with Blue costs reported alongside but excluded from the win judgment, mirroring CSIS's Taiwanese-autonomy scoring [CSIS-FB Ch.5; METHODOLOGY §3]. Blockade scenarios use their own MOE track (§6), because a lodgment-throughput arbiter cannot see the blockade dilemma [CSIS-BLOCKADE].

---

## 2. Design Pillars

**P1 — Decisions, not dials.** Every feature must create or sharpen a player decision; the simulation is the engine, not the wargame [PERLA; UK-HB ¶1.9]. Allocation verbs are **discrete and lumpy** — indivisible package chips, not continuous sliders — so every allocation is a felt sacrifice. *Forbids:* parameter panels as gameplay, per-node micromanagement as the primary verb, any screen whose only interaction is reading numbers, "click-here" decisions with an obvious answer (Meier's test; Firaxis's Civ VII postmortem in reverse) [MEIER; FIRAXIS], and previews precise enough to be slider-jiggled into an optimum.

**P2 — Every outcome inspectable to its inputs; every estimate honest about its basis.** Rigid computer adjudication is doctrinally correct for a kinetic problem [UK-HB ¶3.15], but it earns trust only through transparency: any resolved event opens to its rule, inputs, seeded rolls, and confidence band [UK-HB ¶2.16; NATO-HB Ch.2]. The adjudicator-as-hidden-player problem is solved by making the code's "beliefs" (assumptions, coefficients) versioned and visible [DOWNES-MARTIN]. Pre-decision estimates are **staff estimates computed on the player's fogged picture, never oracle output computed on ground truth** — the odds must not leak hidden state. *Forbids:* hidden modifiers, silent ruleset changes between compared runs, outcomes the UI cannot explain, probability math the player computed for you but you never showed them (the current game.js:440 sin), and previews that reveal the true board through their precision.

**P3 — Scarcity binds the campaign.** Early choices must constrain late turns: typed, counted, non-regenerating munitions magazines (including torpedoes); a weather/fait-accompli clock that never flexes; persistent detection; escalation state [CSIS-FB; EMPTY-BINS; FILIPOFF]. *Forbids:* regenerating strike resources, free strikes, one-turn-scope buffs as the only persistence, any turn that plays like the first turn, and deadlines that extend when the player needs them to.

**P4 — One felt draw, one honest band.** The played run is a single concrete seeded draw whose luck is visible; the MC ensemble supplies context, never replaces experience. Do not moderate toward the mean — averaging "sidelines important conclusions about the vulnerability of plans to chance" [UK-HB ¶3.12c]. The ensemble is *defined* everywhere it is shown: fixed = player orders, contingencies, branch decisions, Red playbook and temperament draw; resampled = engagement, weather, and detection draws. Outcome-percentile placement describes **luck conditional on this plan under this model's assumptions — never plan quality**; plan-quality statements come only from cross-COA paired comparisons. *Forbids:* showing only mean MOE values during play, single-number verdict screens, smoothing away bad luck, unseeded/unreproducible previews, and AAR copy that converts a percentile into a verdict about the plan.

**P5 — The AAR is the product; iteration is the method.** One run is a plausibility illustration, not a finding [UK-HB ¶1.19; CSIS-FB Ch.2 fleet-destroyed outlier]. The exportable AAR and the cross-run scorecard are what a CSIS/RAND user actually keeps — and the scorecard's statistics-shaped elements (arrows, magnitudes) are generated only from MC-backed sweeps, never from n=1 played runs. *Forbids:* session state that dies with the modal, AARs reconstructed after the fact instead of captured during play [UK-HB ¶2.17], significance typography on anecdotes, analysis features cut to fund chrome.

*(Standing invariants beneath all pillars: no build step, vanilla JS script tags, fully offline at runtime, NOTIONAL//UNCLASSIFIED open-source data with citations, deterministic seeded core with worker parity asserted at boot — the existing boot probe at StrikeSim2040.html:6281 is the standing regression gate.)*

---

## 3. The Core Loop in Detail

The loop follows the canonical professional turn anatomy — declaration of intent → execution → outcome calculation → consequence phase → recording-and-planning period [UK-HB Annex A Case Study 2 (Dstl); CALL-2006] — compressed into a solo digital sitting.

### Session structure

One sitting = **1 played Brief + 6 turns + 1 AAR**, targeting 45–75 minutes (75 minutes is the P90 playtest gate, measured with a novice, not the developer). Game time: turns are **3.5 days** (D+1, D+4.5, D+8, D+11.5, D+15, D+18.5), covering the decisive first three weeks per CSIS's proven scoping [CSIS-FB Ch.3]. The session is framed as three acts with **distinct decision mixes, not just titles** (§4 act gating) — *Ride out the salvo* (T1–2), *Break the crossing* (T3–4), *Decide it* (T5–6) — following Firaxis's finding that explicit chapters with distinct decision mixes fix pacing [FIRAXIS].

**The clock is hard.** There is no auto-extend. If the outcome is still ambiguous at D+18.5+3.5, the engine **MC-projects the continuation from the final state** and scores the distribution: "you ran out the window without deciding it — lodgment sustained in 78% of projected continuations." That is faster than playing extra turns, it uses the ensemble machinery as the ending, it keeps every scored run at a fixed horizon so cross-run statistics stay comparable (extending only ambiguous runs is optional stopping, and it biases every aggregate), and the sting is itself the insight and the rerun motivator. CSIS's extra turns were a human facilitation judgment in individually analyzed iterations, not a scoring rule to inherit [CSIS-FB Ch.5].

| Phase | Time budget | Repeats? |
|---|---|---|
| Brief (played) | 3–5 min (first run) / ~2 min (repeat) | Once per session |
| Plan | 2–4 min per turn (T1 first-run may run longer; staff plan is the valve) | Per turn |
| Commit | 30 sec per turn | Per turn |
| Execute-watch | 2–3 min per turn | Per turn |
| Turn card (assess + next dilemma, one screen) | ~1 min per turn | Per turn |
| AAR | 6–12 min (verdict screen ≤2 min; depth is opt-in expandable) | Once per session |

Six turns at ~6–8.5 min each plus bookends lands at 45–70 minutes practiced. Two time valves keep novices inside the box: (a) **every turn opens pre-loaded with a legal staff-recommended plan**, so "commit with one edit" is always viable; (b) soft per-phase timers surface a White-cell nudge with a one-tap "accept staff recommendation." The tutorial rung (§8) runs one act only, ~15 minutes.

### 3.1 Brief (once, 3–5 min — played, not read)

The Brief is delivered progressively, each OPORD paragraph attached to a decision, with the first real decision inside three minutes [FM6-0; W1-1]:

1. **Situation (watched, 60–90 sec):** the pre-adjudicated opening salvo plays back on the Execute-watch surface — Red's joint fires strike landing on Blue C2, ISR, and bases in PLA targeting-priority order [CSIS-FB App. C; ENGSTROM]. This teaches the watch grammar (event log, pause, explain-panel) before the player owns any orders, for free. It ends on the damage picture and the initial fog-honest INTSUM.
2. **Mission & Intent (read, 30 sec):** Commander's Intent = the denial end state in plain language (moe.js halt conditions translated: "Red must be unable to sustain a lodgment against Taiwan's defense within the fait-accompli window") — intent is the OPORD element that guides decisions when the plan breaks [FM6-0; USMC-INTENT]. The session's analytic question (chosen or default) is stated here; the automated White cell keeps the session pointed at it [UK-HB ¶2.9].
3. **Sustainment (decided):** the magazine ledger is presented — typed, counted, no wartime resupply — and the player picks their opening husbanding stance (the T1 LRASM dilemma is framed here). Taiwan starts the war with everything it will ever have [CSIS-FB "Ukraine model" finding].
4. **Command & Signal / ROE (decided):** ROE in force (mainland strikes withheld, escalation guidance) as binding constraints; on non-tutorial scenarios, the **intervention-timing stance** where the scenario offers it (commit early on ambiguous warning at political cost vs. late on confirmation at military cost — decisive in CSIS iterations [CSIS-FB]).
5. **Locked pre-war posture** (shown): the one-way doors set by the Campaign layer — Japan basing access, dispersal, Taiwan stockpiles and pre-war mining, magazine buys.

**Delegation as difficulty ramp:** each Plan-menu item ships with a "staff handles it" default the player takes over item-by-item across sessions — diegetic, and it staggers concept load.

### 3.2 Plan (per turn, 2–4 min)

**Plan opens on a question, not a dashboard.** The turn card's forward half (§3.5) has already surfaced one board-state-derived staff dilemma ("tankers can support the strike surge OR sustain northern CAP — not both"); the Plan screen opens there, with the staff-recommended plan pre-loaded.

**Player sees:** the theater map/network as a SITREP surface, Flashpoint-style: own-force status, an *estimated* enemy INTSUM with fog-appropriate uncertainty bands (never ground truth), staff alerts [FPC-SITREP]. The proposed plan carries a **STAFF ESTIMATE**: a seeded, reproducible MC preview (`hashSeed(matchSeed,'preview',turn)`) computed **strictly on the player's observed board** — stale node health, estimated Red state — displayed as coarse bands ("likely / contested / poor"), one estimate per proposed plan, not per-tick re-optimization. Payoffs that depend on Red's reaction are marked **unassessable**, in writing. When intel is stale the estimate is honestly wrong, and that becomes an AAR teaching beat. This closes both exploits: previews cannot leak hidden state, and they cannot be slider-jiggled into a solved answer [MEIER; P2].

**Player decides (the command menu, §4):** package-chip apportionment across mission lines; posture; risk/ROE requests; targeting priorities expressed as intent; **contingent orders** ("if the convoy sorties early, release the ready package") — and which 0–2 chips to hold as the **command reserve** for the watch phase. Orders are standing missions that execute across the 3.5-day timestep — CSIS's players gave general instructions for half a week and could not adjust day 2 based on day 1 [CSIS-FB Ch.3]. Facilitation means the player never has to learn the ruleset to decide: in-context advisor text, progressive disclosure [UK-HB ¶2.9].

### 3.3 Commit (per turn, 30 sec)

The loop's one deliberate act, given weight and ceremony in the UI [SWINK]. On commit, the game elicits and logs immutably:

1. **A calibration bet, not a form:** the elicited quantity varies by board state (throughput direction / magazine state at turn end / Red's next branch) with a confidence wager. It is presented neutrally in-session and Brier-scored only **across runs** on the analyst-calibration track (§7) — scoring within a run invites sandbagging; scoring calibration across many runs means gaming it *is* being calibrated [DOWNES-MARTIN; UK-HB ¶2.17].
2. **The order log entry** (orders + contingencies + reserve declaration + seed) — which, together with the in-watch decision log (§3.4), *is* the full replay under the segmented-resolution contract below.

### 3.4 Execute-watch (per turn, 2–3 min) — the centerpiece, built in two honest layers

**Layer 1 (presentational — Increment D):** the resolver remains **simultaneous against start-of-turn state in fixed sort order** (game.js:383–498) — that discipline is what makes the RNG stream machine-independent and the replay free. The watch phase *sequences the already-resolved event list* into a chronological narrative across the 3.5 days, interleaving Blue and Red events on the D-day clock, at step / 1× / 2× / 5× with user-selectable pause-on-event classes (new detection, node destroyed, cascade triggered, magazine threshold, Red branch flip), transplanted from C:MO's message-log pause mechanism [CMO-PULSE]. Every FX is synchronized to an event-log entry, and every entry carries its probability and modifier chain (the data game.js already stamps on events at :440–446 and the UI currently discards). The turn's headline (throughput delta, MOE move) is **held for the consequence beat** — a structured reveal at the end of every watch — while a persistent "at stake this turn" strip shows the player's committed bet and the MOE band, so every event visibly moves a needle the player already bet on.

**Layer 2 (interactive — the determinism-safe branch contract):** watching is never a cutscene, because the player holds live options:

- **Contingent orders trip or hold** — set at Plan, resolved deterministically; watching your contingencies is tense with zero input.
- **The command reserve** (0–2 chips held at Plan) is spendable at any pause: a ready strike package, an ISR retask, an emergency interceptor salvo. Every pause-class event is thus a *potential* decision with opportunity cost, not a scripted prompt.
- **Branch decisions are reallocations, never Y/N:** every offer states its cost against the player's own committed plan ("Retasking pulls 2 packages off counter-C2 — staff estimates Red's command cycle recovers"). Tension comes from unwinding your own commitment.

**Determinism contract:** the turn resolves in **pre-seeded segments** — `makeRng(hashSeed(seed,'resolve',turn,segIdx))`, mirroring the existing pattern at game.js:845 — so the post-decision draw sequence is independent of pre-decision draw count. Each in-watch decision (reserve spend, branch choice) is a **first-class logged entry** (event index + choice) in the immutable commit log, closing the current segment and opening the next. Replay = orders + branch/decision log + seed — exactly reproducible, scrubbable, counterfactual-forkable. In-watch interventions are capped at **2 per turn**, preserving the CSIS long-timestep discipline [CSIS-FB Ch.3]. Every turn is guaranteed at least one staff-flagged decision point by design; its severity varies, its existence does not.

**Command friction, honestly displayed:** striking Red C2/ISR degrades Red's order tempo and targeting quality — but the readout is a **range tied to a named assumption**, never mechanism-certainty: "Red order tempo: DEGRADED — est. 8–12h cycle [assumption A-14]," with the explain-panel linking the range to its citation. A deterministic "6h → 9h" would assert knowledge of PLA C2 resilience no open source supports, precisely the over-specified causal chain METHODOLOGY §2.3 disavows [HENRIKSEN; FPC-WEGO for the design pattern]. Symmetrically, Red strikes on Blue bases and C2 shrink Blue's next-turn chip count — the differential decision tempo is how the player feels the OODA fight.

*(Deferred, explicitly: a two-impulse action–reaction resolver in which Red reacts mid-turn to Blue's results. That is a model change, not a UI layer — new draw order, new outcomes, broken cross-increment comparability — and if ever built it ships as its own increment with a ruleset-version bump and a new parity fixture. The CALL action–reaction–counteraction sequence [CALL-2006] is honored presentationally in Layer 1 and structurally by the segment/branch contract.)*

### 3.5 Turn card (one screen, ~1 min)

**One card, two halves — replacing the previous three redundant surfaces** (assessment card, Brief update, SITREP re-read):

- **Top half looks back:** what changed and *why*, explicitly attributing changes to last turn's orders (Meier's "consequences visible" [MEIER]); denial-MOE trend with band; magazine and escalation ledgers; the player's bet result. The turn's **insight is auto-drafted from its biggest surprise** (largest prediction miss or MOE swing) and offered as confirm/edit-one-line — accept/edit is 10× cheaper than compose, and player-initiated watch pauses are auto-bookmarked as revealed interest [UK-HB ¶2.17].
- **Bottom half looks forward:** the staff-flagged dilemma for next turn plus the recommended plan diff, flowing directly into Plan.

### 3.6 AAR → iterate (6–12 min, §7)

Opens on the verdict and one counterfactual worth rerunning; closes on a pre-configured next-run card (seed, variation, question, 2-minute repeat Brief) so "one more run" is literally one click — because iteration is the analytic method, not a replay feature [UK-HB ¶1.19; CSIS-FB Ch.2; BAE]. Run history persists; the cross-run Scorecard (§7) accumulates. The design optimizes for the player's 5th and 20th session, per the "cheap, frequent, small" doctrine [UK-HB ¶2.14; PERLA-IRON].

---

## 4. Decision Altitude

**Principle:** the player commands at the JTF echelon — "suppress the ISR complex, accept medium risk, hold SOF in reserve" — never "shoot node PLA-C2-014 with cyber." The gap audit is blunt: current verbs are targeteering (game.js:778–795); the fix is subsystem-level tasking compiled through the existing canStrikeBoard + moe.js classify() machinery, with node-level orders demoted to an expert override [GAP-AUDIT].

### The currency: package chips

Per-turn strike capacity is expressed as **6–8 indivisible package chips** (strike-package / squadron-day equivalents), derived deterministically from the surviving basing/tanker/C2/logistics board through the sortie-rate relationship (availability ÷ (turnaround + distance-driven mission time)) [RAND-MR1028; RAND-RR392], extending the existing apFor() tempo economy — the one current mechanic that already creates inter-turn consequence [GAP-AUDIT]. Chips are lumpy on purpose: at 4–6 AP a continuous "weighted split" has 20–25% granularity and most slider positions produce identical orders — a dial wearing a decision costume. A chip committed to counter-lift *cannot also* fly DCA; every allocation is a felt sacrifice. AP remains the internal denomination and HUD display; the chip↔AP mapping is fixed in Increment B because the magazine-ledger UI depends on it.

### The per-turn decision menu (act-gated)

Acts gate verbs so each chapter has a distinct decision mix [FIRAXIS], staggering concept load:

- **Act 1 — Ride out the salvo (T1–2):** survival and husbanding verbs dominate — disperse vs. absorb, which suppressed base to reopen first, the T1 LRASM triage (spend the bin against the massed first echelon vs. husband it), opening apportionment.
- **Act 2 — Break the crossing (T3–4):** full-width apportionment, salvo-sizing doctrine, undersea cycling, ROE requests.
- **Act 3 — Decide it (T5–6):** the one-way doors open only now — commit the reserve force, expend the last-ditch salvo [FILIPOFF Pt.4], the final mainland-strike window, accept a Taiwan port-cripple decision.

The menu itself:

1. **Apportionment.** Commit chips across **six mission lines**: *counter-lift* (kill amphibs/RO-ROs), *counter-C2/ISR* (systems degradation), *counter-force* (SAMs, airfields), *undersea* (submarine stations in and near the strait), *defense* (DCA/hardening own kill chain), *reserve* (held for the watch phase). The engine expands chips into node-level strikes via classify() and sourcing rules — the CSIS standing-orders pattern [CSIS-FB Ch.3].
2. **Undersea line (its own rhythm).** Submarines were the single most effective killer of the amphibious fleet in the evidence base [CSIS-FB], constrained by torpedo loadout and the multi-day transit-and-reload cycle. Mechanics: a typed **torpedo magazine**, a station→expend→reload cycle costing **1–2 turns out of action** (one Guam round trip ≈ one to two 3.5-day turns — the timestep fits the mechanic naturally), and PLA ASW as a playbook-weighted counter that prices the strait's shallow approaches.
3. **Posture.** Concentrate for tempo vs. disperse for survivability — the CSBA-documented tradeoff with no dominant answer [CSBA]; forward-base vs. stand-off for strike aircraft. Posture feeds next turn's chip count via the sortie model [RAND-MR1028].
4. **Risk & ROE.** Accept penetration risk (fly inside PLA SAM engagement zones to use shorter-range weapons when standoff runs dry — the CSIS loss driver [CSIS-FB]) vs. stay at standoff. Request **mainland-strike authorization** — a consequential political gate [CSIS-FB; CSIS-BLOCKADE]. **ROE requests always resolve into a plannable state change**: approval, a counter-offer ("mainland strikes denied; strikes on ships in territorial waters authorized"), or a standing condition ("authorized *if* Red strikes Japan") — never a silent veto that eats the decision. Conditional authorizations turn Red's escalation into something the player is grimly watching for — drama for free. Requests draw on a small counted political-capital budget; the ladder and ledger get magazine-level HUD prominence.
5. **Targeting priority (intent).** Rank Red subsystems to break — C2 / ISR / lift / seacontrol / protect / sustainment — plus salvo-sizing doctrine: mass fires to overwhelm defenses vs. distribute to conserve [FILIPOFF; HUGHES]. The intent object {balance, riskTolerance} from the existing interview becomes the session-long contract: stated in the Brief, constraining order legality, graded in the AAR [GAP-AUDIT].

### The resource economy

- **Typed munitions magazines** — the #1 gap [TAIWAN-RPT; GAP-AUDIT]. Named NOTIONAL weapon classes with counted, **non-regenerating** wartime inventories: LRASM-class (exhausted in the first week of every CSIS iteration), JASSM-ER-class (~weeks), Tomahawk-class (largely out of range against the fight that matters inside this horizon — see tempo arc below), SM-class defensive interceptors, **torpedo stocks** [CSIS-FB; HERITAGE; EMPTY-BINS]. Zero wartime resupply is the defensible rule — production timelines run years [EMPTY-BINS]. Every strike order is an expenditure decision; the magazine ledger sits next to the denial MOE in the HUD.
- **Chips/tempo** as above — board-derived, deterministic, HUD-explained.
- **Political capital / escalation state.** A ladder position that gates ROE options both ways and moves with events (mainland strikes, Red strikes on Japan, blockade-running incidents). PRC cost-tolerance becomes a **swept, exposed assumption**, not a solved problem: the static 0.55 becomes a drift model whose coefficients are headline items in the AAR's load-bearing-assumptions list, with the drift-off (static) case in the default sensitivity sweep. This is framed as "we expose the assumption and sweep it" — modeling adversary will from open sources is not a problem this design claims to have fixed [HENRIKSEN; METHODOLOGY §8]. **The ladder has a ceiling:** a top rung labeled *beyond scope* — crossing it ends the run "unresolved — escalation exceeds model scope," recorded as such in AAR and scorecard. Honest truncation beats implicit optimism about conventional containment; CSIS scoped nuclear risk explicitly and so do we [CSIS-FB].
- **Taiwan is a combatant, not a number.** The defender is a **degradable stock**: hit by Red fires apportionment, degraded by C2/cohesion pressure, with mobilization effectiveness as an MC-sampled range per METHODOLOGY §8's human-factors caveat. Taiwan's coastal-defense cruise missiles and mobile SAMs contribute to counter-lift as an MC-sampled, cited coefficient — CSIS and the porcupine literature both make Taiwanese ground and coastal forces decisive [CSIS-FB; RAND-RR392]. Without this, the game teaches "only US weapons matter," which is a false lesson.
- **Red's magazines are finite too** (tracked NOTIONAL counts informed by CMPR order-of-battle reporting; exact figures are NOTIONAL and cited as such) [CMPR; STIMSON]. **The tempo arc completes inside the horizon:** ride out the opening salvos, husband forces, then feel Red's depletion pay off *by T4–5* as Red salvo sizes visibly shrink and previously untenable postures open up. No promised week-4 payoff beyond the clock — the game must never grade the player for husbanding toward a phase that never arrives.
- **Mines (minimum viable).** A Taiwan pre-war mining one-way door in the Campaign layer (modifies Red lift throughput and port-capture time) and a Red mining action in the blockade playbook — the cheapest entry for a prominent dynamic in the open literature [CSIS-FB; ASPI].
- **Space ISR (abstracted, attackable).** Wide-area maritime `find` in 2040 is satellite-dependent and PLA counterspace is headline capability [CMPR; RAND-RR392]. Each side carries an abstracted space-ISR state — healthy / degraded / denied — multiplying p_find, attackable via a counter-space escalation rung with ladder consequences. Documented as a deliberate abstraction in METHODOLOGY.
- **Wartime ally agency.** Japan basing locks pre-war, but the pivotal ally questions are wartime [CSIS-FB]: 1–2 discrete **ally-consent events** tied to ladder state (e.g., Red strikes Japan → MC-sampled Japanese response: full combat access / US-defense-only / restrictions), logged as events with cited base-rate assumptions.

**Automated away (Meier audit):** rote repair, default hardening upkeep, per-node ISR assignments — anything with an obvious answer [MEIER; FIRAXIS].

---

## 5. Red as Adversary

**Doctrine-follower, not optimizer.** Red's job is to be plausible and instructive, not to win; CSIS grounded Chinese play in PLA doctrine and demonstrated capabilities, and variation across runs substitutes for the strategic "mutation" human opponents provide [CSIS-FB Ch.2]. The current AI is a stateless greedy value-maximizer with no doctrine and no memory — the same code plays both sides with perfect information [GAP-AUDIT]. The replacement is cheap and citable.

### Red playbooks (named, citable, disclosed) — with sampled temperament

Each playbook is a named weight-vector-plus-state-machine over the existing planOrders scoring, selected at setup or drawn per run. **Playbook identity is disclosed up front; its drawn temperament only in the AAR.** Each run MC-samples the playbook's *temperament* within cited ranges — aggression, branch thresholds as bands not points, weight jitter — so the logic is study-able but the behavior is not farmable. Disclosed deterministic thresholds ("flips at 40% lift loss") would be solved in ~5 sessions — exactly when the design says the 5th and 20th session matter most; sampled temperament is how "variation substitutes for mutation" is mechanized rather than merely cited [CSIS-FB Ch.2; GAP-AUDIT].

- **JOINT FIRES / SYSTEMS DESTRUCTION** (default opening, all invasion playbooks): strike Blue C2 → ISR → bases/firepower in PLA targeting-priority order — the doctrine moe.js already encodes for Red-as-target, now executed by Red-as-actor against the Blue roster already on the board [ENGSTROM; WUTHNOW].
- **FAIT ACCOMPLI — PORT SEIZURE FIRST:** prioritize taking a functional port intact to unlock the civilian RO-RO reinforcement pool (organic lift ~21k first wave; ferries raise it substantially) [SHUGART; CMSI]; protect lift above all; harden/repair sustainment.
- **FAIT ACCOMPLI — BEACH-CENTRIC:** organic lift + barge/pier systems, accepts slower buildup, less port-dependent [TWZ-BARGES; ASPI].
- **BLOCKADE / QUARANTINE** (own scenario family, own MOE — §6): severe pain on Taiwan's energy imports at lower initial cost, but escalatory pressure that is hard to contain [CSIS-BLOCKADE]. Includes Red harbor mining.
- **PUNISH / ESCALATE HORIZONTALLY:** triggered, not chosen — strikes on Japan basing and Guam in retaliation for mainland strikes or blockade-running [CSIS-FB; CSIS-BLOCKADE]. May trigger ally-consent events (§4).

### The systems-confrontation branch structure

Red runs a small doctrinal state machine per turn, evaluated on board state — **consolidate / escalate / convert** as the three branch families:

- **Consolidate** when throughput is on track: shift weight to protecting lift and sustainment, expend fewer missiles.
- **Escalate** when Blue crosses ROE thresholds or the invasion is failing with the weather window closing: horizontal escalation, surge missile expenditure — spending down the finite Red magazine [CMPR].
- **Convert** when lift is broken but sea control holds: in invasion scenarios this **ends the run** — "invasion denied; conflict transitions to blockade," scored as denial of the invasion under the invasion MOE, with the blockade continuation flagged *beyond this scenario's scope* and the Lights Out variant offered as the suggested excursion. The invasion MOE cannot adjudicate a blockade and is never asked to (§6).

### How Red reacts to Blue

Reaction operates through **mechanism, not scripts**: Red's order tempo, targeting quality, and detection all degrade as its C2/ISR subsystem scores fall (command friction, displayed as assumption-tagged ranges per §3.4; kill-chain gating §6). Under fog, Red plans from a *degraded observed board* — last-observed health, stale after N turns — not ground truth, fixing the current perfect-information AI. This is real new infrastructure (a per-side observed-state store; current fog is UI-only display masking at wargame.js:684–816, and planOrders reads ground truth), and it is budgeted as its own build stage (C4). Playbook branch flips are logged as events the player can inspect ("Red shifted to LODGMENT PROTECTION"), because a study-able adversary is the difference between a puzzle and a wargame [GAP-AUDIT]. Difficulty is expressed as playbook discipline and intel quality, never as cheating bonuses — and difficulty/playbook-pool settings are logged excursion variables that partition scorecard rows (§7).

**Content rule:** both sides restricted to demonstrated or concretely planned capabilities — CSIS's rule, and what keeps NOTIONAL//UNCLASSIFIED defensible [CSIS-FB App. C].

---

## 6. Adjudication

**Division of labor — which model adjudicates what:**

| Question | Adjudicator | Basis |
|---|---|---|
| Does a kinetic salvo hurt a defended node? | **Stochastic salvo exchange per Armstrong's binomialization of Hughes**: binomial draws on launch reliability, intercepts, and hits — not deterministic leaker arithmetic with expected damage bolted on | [HUGHES; ARMSTRONG]. Both papers model ship-vs-ship combat; applying the salvo form to airbases and C2 nodes is a **domain transfer stated explicitly in METHODOLOGY** (engagement-model section) |
| Can a strike be attempted, and at what quality? | **F2T2EA kill-chain gating**: p_hit = p_find·p_track·p_engage, where find/track require a live Sensor→C2→shooter path on the graph (extending canStrikeBoard's existing sourcing rule), and p_find is multiplied by the side's space-ISR state (§4) | [JP3-60; CARES] |
| Is Red's invasion succeeding? | **Denial MOE (moe.js)** as the victory arbiter for invasion scenarios: per-turn throughput = liftCapacity × OSVI^k accumulates into a lodgment track vs. the fait-accompli window; Blue wins by halt-before-clock, Red by sustained buildup — fixes the flagship coherence failure where game.js still scores attrition [GAP-AUDIT] | [METHODOLOGY; ENGSTROM] |
| Is Red's **blockade** succeeding? | **Blockade MOE track** (separate, documented): Taiwan stockpile-depletion clock (energy/food vs. cited stockpile estimates) + capitulation-pressure index vs. Blue's convoy/escort throughput and escalation exposure. Longer timestep variant. A lodgment arbiter scores a blockade as an automatic D+1 Blue win, which inverts CSIS's finding that blockade is the *harder* problem — so blockade scenarios never ship without this track | [CSIS-BLOCKADE] |
| What happens to the lodgment ashore? | Buildup-vs-defense race: accumulated throughput vs. the **degradable Taiwan defender stock** (§4) — attrition from Red fires, cohesion/mobilization variance sampled, CDCM contribution to counter-lift | [CSIS-FB ground-forces finding] |
| How much can each side do per turn? | **Chip/tempo economy** from surviving basing/C2/logistics via the sortie-rate model | [RAND-MR1028; CSBA] |
| Escalation/political consequence | Ladder state machine with a *beyond-scope* ceiling; cost-tolerance drift as a swept, exposed assumption | [CSIS-BLOCKADE; HENRIKSEN] |
| Weather | Stochastic per-turn modifiers on crossing rate, small craft, sorties; window closure as Red's shot clock | [EASTON; ASPI] |

**One kernel, two consumers — unified early, upgraded once.** There are today **three** copies of the MC core (sim.js:319, sim-worker.js:40–41's byte-identical-copy discipline, and an inline shell mirror at StrikeSim2040.html:~4373–4900), and the third has already diverged: the inline copy supports `successMode:'denial'` while the worker core does not — exactly the adjudication-credibility failure this design exists to fix. Therefore kernel unification happens **first, in Increment B**, before any mechanic is added: the shell calls SimModule, the worker gains `importScripts()` of the shared file and of dependency-free moe.js (the app runs from a localhost server via "Open StrikeSim 2040.command," so importScripts is offline-safe and build-free), and the existing boot parity probe is the regression gate. Increment D then upgrades the engagement math *inside that single module* with a ruleset-version bump. Magazines and every later mechanic are written once.

**RNG architecture (load-bearing for everything in §7):** resolution draws move to **counter-based per-event streams keyed on (seed, turn, entityId, eventType)** — hash-derived, so identical sub-events draw identical numbers regardless of order-list composition. This is what makes paired-seed counterfactuals *actually* paired: with sequential draw consumption, a T3 divergence desynchronizes every subsequent draw and yields two independent ensembles wearing a variance-reduction costume. This is a resolver rewrite, costed honestly in Increment D — not "nearly free." Segment seeding for in-watch decisions per §3.4; worker parity asserted at boot throughout [MODEL-RPT].

**What we deliberately do NOT model — in writing.** No Lanchester ODE layer: Lucas & Turkes found no Lanchester law fits the best available battle data [LUCAS-TURKES], and Hughes's core argument is that missile combat is pulsed [HUGHES]. METHODOLOGY.md gets attrition-model-selection, engagement-model (ship→node transfer), and space-abstraction subsections, because an SME reviewer will ask and the written rationale is what buys credibility [MODEL-RPT; UK-HB].

**Node engagement data:** Hughes/Armstrong + F2T2EA need per-node parameters (salvo size, intercept capacity, staying power, sensor/C2 path roles) the 224 nodes don't carry. Defaults are **derived in code from existing fields** (difficulty→staying power; Protection/Relay/Sensor types→intercept capacity and path roles) with one cited default table in METHODOLOGY.md; scenario JSON overrides only named key nodes — bounding the content task inside the citation rule.

**Transparency rules (the credibility mechanism):**

1. **Every outcome inspectable:** every event in the log opens an "explain this" panel — rule used, input factor chain (baseP × difficulty × vulnerability × harden × kill-chain gates), seeded rolls, salvo arithmetic, CI where applicable [UK-HB ¶2.16; NATO-HB]. Most of this data already exists on event objects and is merely unrendered [GAP-AUDIT].
2. **Pre-decision transparency, fog-honest:** staff estimates per §3.2 — seeded, reproducible, computed on the observed board, banded, labeled as estimates [MEIER; P2].
3. **The adjudicator's beliefs are versioned artifacts:** every coefficient (magazine counts, Pk values, doctrine weights, temperament ranges, drift coefficients, weather probabilities) is a labeled analytic assumption with its citation, reachable in-app from METHODOLOGY.md; the AAR states which assumptions were load-bearing [DOWNES-MARTIN].
4. **Never patch the model silently:** ruleset version stamped on every run; cross-run comparisons flag version mismatches [CSIS-FB App. C].
5. **Semi-rigid escape valve:** a facilitator override (edit state / reroll) exists but requires a logged justification that appears in the AAR audit trail — the professional semi-rigid pattern with the Tannenberg cautionary tale in mind [UK-HB ¶3.10–3.15; CALL-2006].
6. **The ensemble is defined wherever it is shown** (P4): fixed vs. resampled stated on the histogram itself. Resampling Red's playbook draw or White-cell rulings would mix adversary variation into "luck"; anything beyond engagement/weather/detection resampling is a labeled excursion.

**Uncertainty framing:** the played run is one seeded draw with felt luck; ensemble context arrives as bands and histograms, never as replacement. BDA is honest: when the Assess step fails for lack of surviving ISR, the player sees stale node health, not ground truth [JP3-60; MODEL-RPT]. All outputs are dominance orderings with confidence ranges — "COA A ≥ COA B in N% of paired trials" — never predictions [PERLA-MCGRADY].

---

## 7. AAR Design

The AAR is a first-class surface, co-equal with Plan — the mode-switch into structured reflection is likely *the* reason wargames teach [SJMS; RAND-PME]. It is generated from data captured during play (commit logs, bets, auto-drafted insights, pause bookmarks, per-turn tempo/denial/magazine history), never reconstructed after [UK-HB ¶2.17]. **It is inverted for the human at minute 60:** one verdict screen, then opt-in depth.

**Screen one (≤2 minutes, the retention surface):**

- **Verdict against intent**, in Commander's-Intent language (halt achieved D+15 / lodgment sustained / unresolved—beyond scope), with **Blue cost as a separate ledger** — ships, aircraft, base damage, magazines emptied, escalation reached — excluded from the win judgment but impossible to miss ("denial achieved, but you emptied the LRASM bin on D+4 and lost two carriers") [CSIS-FB Ch.5; TAIWAN-RPT].
- **The histogram, honestly captioned:** the run placed in the ensemble of **resampled executions of these same orders** — "you drew the 30th percentile of this plan's outcomes" — with the fixed/resampled definition printed on the chart. Percentile placement is luck conditional on the plan and the model; it is **never** rendered as a statement about plan quality. Plan-quality language appears only from **cross-COA paired comparisons**: "these orders ≥ the staff-recommended baseline in 72% of paired trials, robust across the sensitivity sweep." That paired statement — *the plan beat the baseline; the dice did the rest* — is the honest version of the one-more-run hook, and it leads.
- **One counterfactual teaser card** with a **[Rerun that world]** button on the card: "In 3,000 paired replays where the tankers held back at T3, denial held in 64% vs. your line's 41% — *under model assumptions*." Every counterfactual carries that framing, because a counterfactual is the most prediction-shaped artifact in the design.

**Expandable depth (opt-in):**

1. **Timeline reconstruction.** The deterministic segmented replay (orders + decision log + seed) drives a scrubable turn timeline with **auto-placed chapter markers** at salient events — first detection, first Blue loss, MOE threshold crossings, Red branch flips, magazine exhaustion, player pause-bookmarks — because chaptered replays, not free scrubbing, are what make replays analyzable [CS2-REPLAY]. Controls reuse the Execute-watch playback.
2. **Causal highlights.** Three to five machine-selected story beats linking decision → mechanism → consequence, each with its explain-panel one tap away, each mechanism claim carrying its assumption tag. Delivered as narrative because story is how insight persists [MCGRADY; PERLA-MCGRADY].
3. **Belief vs. result.** The per-turn bet strip, presented neutrally as a calibration mirror in-session; the **analyst-calibration track** (Brier-scored across runs) lives on the Scorecard — analysts will care about their calibration score, and across many runs, gaming it is being calibrated [DOWNES-MARTIN; UK-HB ¶4.18].
4. **Counterfactual & sensitivity engine.** Chapter-marker counterfactual hooks (paired via the event-keyed RNG, §6); one-click sensitivity sweeps over documented assumptions (k, OSVI weights, T_min, cost-tolerance drift on/off) [METHODOLOGY §8]. Implementation is a **headless turn-engine runner** — a pure driver assembled from the exported `GameModule._internal` pieces (buildBoard, resolveTurn, planOrders, makeRng, hashSeed — game.js:1233–1234) with no graph sync or UI callbacks, forking from turn N via the stored order log, with the declared policy **"in-watch branches auto-decline in counterfactuals."** Cheap CPU (≈3,000 × ≤6 resolveTurn calls is seconds) but the largest engineering item in Increment E, and scheduled as such.
5. **NATO hot-wash triad + exit:** insights against the session question (pre-populated from the auto-drafted, confirmed insights); open questions; lessons; "what will you try differently" [NATO-HB Chs.5–6; PERRY].
6. **Exportable one-page insight brief.** Markdown download (cloning campaign.js's downloadText): verdict, cost ledger, three causal highlights, calibration strip, assumptions in force with citations, seed + ruleset version for full reproducibility. *This document is the product* for the target user [GAP-AUDIT; MATRIX-PRO].

**Closing card:** the pre-configured next excursion — seed, variation, analytic question, 2-minute repeat Brief — one click from rerun.

**Cross-run Scorecard — statistics only where there are statistics.** Persistent run history accumulates a CSIS-style scorecard [CSIS-FB Fig.8], with a hard epistemic rule: **direction/magnitude arrows are generated only from MC-backed excursion sweeps** (the labeled Analyst Mode); **human played runs appear as annotated data points** ("1 played run: denial held"), never as arrows — a played run is n=1, "a plausibility illustration, not a finding" [UK-HB ¶1.19], and significance typography on anecdotes is manufactured authority. Difficulty and playbook-pool settings are logged excursion variables that partition rows. Runs that crossed the beyond-scope ceiling are recorded "unresolved." This operationalizes the model-game-model cycle in one artifact: the played run generates hypotheses; the MC sweeps test them; the scorecard records both, typed distinctly [DAVIS; PERLA-IRON].

**Storage:** runs persist as compact records — {seed, rulesetVersion, scenario fingerprint, order + decision log, confirmed insights, bets, verdict summary} — and everything else regenerates by deterministic replay. Full board+event serialization of dozens of 224-node runs would breach the ~5MB localStorage quota campaign.js already defends against (campaign.js:582–592); the design claims replay is free, and storage holds it to that.

---

## 8. Scenario System

### Brief format (per scenario)

Every scenario carries a **brief block** rendered as the progressive, played OPORD of §3.1 [FM6-0]:

- **SITREP** — road to war, D-day calendar, weather-window state, the pre-adjudicated opening (as playback data) and its results, estimated enemy INTSUM (fog-honest) [FPC-SITREP].
- **INTENT** — Commander's Intent as the denial end state; the session's default analytic question.
- **ROE** — binding constraint set (mainland-strike gate state, escalation guidance, political-capital budget, ladder ceiling).
- **OOB** — both orders of battle in MIL-STD-2525 terms; Blue kill-chain semantics; typed magazine inventories including torpedoes; Red playbook pool and temperament ranges for this scenario.
- **Victory terms in fiction language** (invasion MOE or blockade MOE track), plus turn count/timestep and locked pre-war posture (including Taiwan pre-war mining).

### The scenario ladder

Three rungs, Nintendo-taught — the level teaches, no manual [W1-1; NYFA] — putting the wargame in the player's hands without a facilitator [BAE]:

1. **Rung 1 — "First Island" (tutorial vignette, ~15 min, ~12 nodes).** One act, one mechanic per turn: T1 chips + a strike; T2 fog and detection; T3 magazines and salvo sizing; T4 kill-chain gating and cascade. Contextual, self-retiring coach marks replace the first-run card. *Ships in Increment F with the scenario loader* — today's loader carries {nodes, links} only (state.js replaceActiveGraph); brief blocks, magazines, injects, and coach marks all arrive with the F schema, so the tutorial is sequenced after the loader inside F.
2. **Rung 2 — "Reference: Taiwan 2027" (the flagship, 45–75 min).** Full loop, 6 turns × 3.5 days, fait-accompli invasion opening, full invasion playbook pool with sampled temperament, CSIS-calibrated NOTIONAL magazines [CSIS-FB]. The fixed reference every excursion compares against — never patched silently [CSIS-FB App. C].
3. **Rung 3 — Variants/excursions.** Named toggles off the reference: *No Japanese Basing* (the CSIS precondition removed [CSIS-FB]); *Taiwan Stands Alone* (delayed intervention); *2030 Magazines* (post-surge inventories [EMPTY-BINS]); *Winter Window* (out-of-season posturing [EASTON]); and *Lights Out* (blockade opening [CSIS-BLOCKADE]) — which **ships only together with the blockade MOE track** (§6), never before. Campaign-planner playthroughs generate custom rung-3 starts via one-way-door posture locks.

### Authoring schema (scenario JSON, no build step)

```
{ meta: {id, title, version, rulesetVersion, moeTrack: "invasion"|"blockade",
         classification: "NOTIONAL//UNCLASSIFIED"},
  brief: {sitrep, openingPlayback, intent, roe, analyticQuestion, victoryText},
  calendar: {startDay, turnLengthDays, turnLimit, weatherWindow},
  graph: {nodes, links},                   // existing format + kill-chain semantics/overrides
  magazines: {blue: {...}, red: {...}},     // typed, counted, cited; incl. torpedoes
  posture: {locked one-way doors, incl. mining},
  redPlaybooks: [{id, weight, temperamentRanges}],
  events: [ {trigger, condition, action, message} ],  // declarative injects; ally-consent events
  sources: [citations for every number] }
```

The **events/injects block** is declarative trigger/condition/action — C:MO's Lua event editor is what turns scenarios into authored, branching experiences, but a declarative interpreter preserves the vanilla-JS/no-build invariant [CMO-LUA]. Injects are the facilitator's variation tool and one of NATO's friction sources [NATO-HB]. Every number in a scenario file carries a source; a content regression harness (checksum + headless MC smoke run per scenario) applies the playtest/TESTEX discipline to content [UK-HB ¶4.9–4.10].

---

## 9. UX Architecture — Five Surfaces Collapse Into One Loop

Today: four apps sharing a JSON file, connected by dead advisory fields [GAP-AUDIT]. Target: one game whose phases *are* the surfaces. The Matrix Pro Sims lesson — elevate the game with editability, analysis outputs, offline deployment; don't rebuild it [MATRIX-PRO].

| Existing surface | Becomes | What dies |
|---|---|---|
| **NDS Campaign Planner** (campaign.js) | **The pre-war layer / Brief input.** Its posture outcomes lock as one-way doors into the wargame via the postureModifiers hook game.js already consumes at :660–683 — campaign.js:1299–1318 currently passes only dead advisory fields, so the coupling is nearly a one-line change; match outcomes post back (model-game-model [DAVIS]) | Its parallel "denial" metric that shares only a name with moe.js; pure-addition phase scoring as a standalone toy; the dead campaignPostureAp advisory fields |
| **COA builder + intent interview** (HTML shell) | **The Plan phase.** The intent interview becomes the session contract; the greedy generator becomes the staff's *recommended* plan (the time valve); fog-honest staff estimates power pre-commit bands | The separate COA-builder-as-destination; window.__denialIntent as an orphan; the unseeded Date.now() preview (HTML:~6046) — P4 forbids it |
| **Monte Carlo lab** (sim.js/sim-worker.js) | **The invisible engine + the AAR's counterfactual/sensitivity engine + a labeled Analyst Mode** for batch sweeps (explicitly framed as analysis, not wargaming [NATO-HB]) — after B's kernel unification and worker denial support | MC results dying with the modal; the three-way core divergence; the mislabeled denial-mode success rule |
| **War Game** (game.js/wargame.js) | **The loop's spine** — turn engine, Commit, segmented resolver — re-victoried on the denial MOE, re-altituded to chips and intent | Attrition victory scoring (evaluateVictory's collapse/score logic) [GAP-AUDIT]; per-node strike buttons as the primary verb; the setup screen as fiction-free config panel |
| **Cinematic C2 HUD + 2525 map + 3D network** | **The Execute-watch stage and the Plan-phase SITREP surface.** The network graph earns its keep as the kill-chain/command-friction display — you strike nodes to break decision cycles [FPC-WEGO; CARES] | HUD as decoration: any FX not synchronized to an inspectable log event |

**Navigation model:** one linear phase rail (Brief → Plan → Commit → Watch → Turn card → … → AAR) replaces the mode switcher; the map/network is the persistent stage under every phase. Polish budget goes to game feel at the interaction layer — sub-100ms response, hover targeting lines, animated magazine/chip depletion, a Commit button with weight [SWINK] — which is "substance over chrome" honored, not violated.

---

## 10. Staged Build Plan

Six increments, each shippable and verifiable in-browser (open StrikeSim2040.html, play, check), each additive to the deterministic core, all preserving: no build step, vanilla JS, offline, worker parity asserted at boot (existing probe = standing regression gate), NOTIONAL data cited in METHODOLOGY.md, orderings-not-predictions. Sequencing: coherence → one-kernel + scarcity → altitude + Red (in shippable sub-stages) → the watch + the engagement model → the AAR product → content [GAP-AUDIT].

### Increment A — One truth: denial victory + the clock (game.js, wargame.js, moe.js, docs/METHODOLOGY.md)
- MoeModule becomes the victory arbiter for invasion play: per-turn assessGraph() over the Red roster (the 120 Red nodes; Blue's 104 remain tempo inputs); Blue wins by halt-before-window, Red by accumulated lodgment before the **hard** turn limit; ambiguous endings resolved by MC projection from final state, never by extension.
- **Red gets a one-line lodgment bias now:** a lift/sustain multiplier on planOrders' own-node harden/repair scoring (same pattern as tempoTargetBonus, game.js:547), so the Red win condition is contested from day one rather than a passive clock stapled to an attrition game. The remaining degenerate window (Blue counter-lift spam until C) is documented as known-degenerate in the increment note.
- Turns get calendar meaning (3.5 days, D-day labels); scenario brief content + Brief screen v1 (hardcoded content is fine pre-F); denial trend + lodgment track in the HUD.
- **Verify:** play a match; win/lose by denial, not attrition; Red measurably protects lift under counter-lift pressure; D-day clock advances; an ambiguous run ends with a projection screen; seeds reproduce.

### Increment B — One kernel, then scarcity (sim.js, sim-worker.js, StrikeSim2040.html, game.js, wargame.js, METHODOLOGY.md)
- **B0 (first, before any new mechanic):** kernel unification — shell calls SimModule (retiring the inline mirror at HTML:~4373–4900), worker `importScripts()` the shared core and moe.js, giving the worker denial-mode support (removing the main-thread-only bypass at HTML:5455–5457); boot parity probe green. Magazines are then written **once**, not three times.
- Typed non-regenerating magazines per side, including torpedo stocks (CSIS/Heritage-informed NOTIONAL counts, cited) decremented in the shared kernel; inventory gates beside the AP gate; magazine ledger in HUD [CSIS-FB; EMPTY-BINS; HERITAGE].
- Port the MC's detection/fatigue into the resolver as persistent state; Red missile inventory tracked with visible salvo-size shrinkage as it depletes (the in-horizon tempo-arc payoff) [CMPR].
- **Blue kill-chain semantics** on the existing 104-node Blue roster (suppressed/closed base states, sortie linkage, magazine ties) — no duplicate content; the nodes are already on the board [STIMSON; RAND-RR392].
- Show-the-math: p% factor chains in the log (UI-only; the data at game.js:429–446 is already stamped and merely dropped by wargame.js:867–870); **chip↔AP denomination fixed here** because the ledger UI depends on it.
- Seeded staff-estimate preview v1 (worker-backed, observed-board, banded) replacing the unseeded Date.now() preview.
- **Verify:** LRASM-class bin empties within ~2 turns of heavy use and never refills; torpedo cycle takes boats off-station; log entries show probability breakdowns; preview reproduces from seed; parity hash passes with the inline mirror deleted.

### Increment C — Command altitude + doctrine Red, in four shippable sub-stages (game.js, moe.js, wargame.js, campaign.js)
- **C1 — Chips + compiler:** 6–8 package chips across six mission lines (incl. undersea) expanded via classify() + canStrikeBoard; node orders demoted to expert override; staff-recommended plan pre-loaded; act gating v1. Campaign coupling attaches here (postureModifiers actually passed — near one-line). *Verify: a full turn plays in under 5 minutes using only command verbs — gated with a novice player, not the developer.*
- **C2 — Red playbooks + temperament:** named weight-vectors + branch state machine (systems-destruction / port-seizure / beach / punish; blockade-convert ends invasion runs per §5) over planOrders scoring; per-run temperament sampling; branch flips logged. *Verify: Red's opening strike hits Blue C2/ISR first; two seeds with the same playbook behave recognizably but not identically; AAR names playbook + temperament.*
- **C3 — ROE / ladder / posture / allies:** mainland-strike gate with counter-offer resolution, escalation ladder with beyond-scope ceiling, political-capital budget, posture decisions, ally-consent events, cost-tolerance drift as swept assumption. *Verify: a denied request returns a plannable counter-offer; crossing the ceiling ends the run "unresolved."*
- **C4 — Observed-board Red:** per-side observed-state store (new infrastructure — current fog is display-only); Red plans from stale last-observed health. *Verify: destroying Red ISR measurably degrades Red targeting quality in the log.*

### Increment D — The watch + the engagement model (wargame.js, ui.js, game.js, shared kernel)
- **D1 — Presentational playback:** chronological interleaved sequencing of the already-resolved event list; step/1×/2×/5×; pause-on-event classes; explain-panels; "at stake" strip; headline held for the consequence beat; command-friction ranges with assumption tags [CMO-PULSE; FPC-WEGO]. Zero model risk.
- **D2 — Interactive layer under the determinism contract:** segmented resolution (`hashSeed(seed,'resolve',turn,segIdx)`); contingent orders; command reserve spendable at pauses; branch offers as costed reallocations; decisions as first-class logged entries; ≤2 interventions/turn.
- **D3 — Engagement-model upgrade in the one kernel:** Armstrong binomial salvo + F2T2EA gating + space-ISR multiplier + counter-based per-event RNG keyed (seed, turn, entityId, eventType) — a ruleset-version bump with a new parity fixture, costed as the resolver rewrite it is [HUGHES; ARMSTRONG; JP3-60; MODEL-RPT]. Node engagement defaults derived from existing fields, cited default table in METHODOLOGY; engagement-model, no-Lanchester, and space-abstraction sections land [LUCAS-TURKES].
- Interaction polish pass: sub-100ms feedback, Commit ceremony [SWINK].
- **Verify (quantitative):** watch a turn at 2× with pause-on-detection and spend the reserve; replay (orders + decision log + seed) reproduces the turn byte-identically; across 20 fixed seeds and 3 reference COAs, MC-vs-turn-engine denialIndex *ordering agreement ≥ 90%*; parity fixture green on the new ruleset version.

### Increment E — The AAR is the product (game.js, wargame.js, new aar surface, HTML shell)
- Calibration bets + auto-drafted insight confirm/edit + pause bookmarks; per-turn history rows stored (already computed, just unstored) [UK-HB ¶2.17].
- **Headless turn-engine runner** (the increment's largest item): pure driver from GameModule._internal, fork-from-turn-N via order log, branches auto-decline policy — powering chapter counterfactuals (event-keyed CRN pairing from D3) and sensitivity sweeps.
- Inverted AAR per §7: verdict screen (histogram with printed ensemble definition + paired-vs-baseline plan statement + one [Rerun that world] card), expandable depth, closing next-run card; "plan quality" copy generated *only* from paired comparisons.
- Autosave as compact records (seed + logs, replay-regenerated); Export AAR as Markdown; run history + Scorecard v1 (MC-sweep arrows only; played runs as annotated points; settings partition rows) [CSIS-FB Fig.8].
- **Verify:** close the browser mid-match and resume from a compact record; export a one-page brief; rerun a chapter counterfactual and get a paired-trial percentage labeled "under model assumptions"; a played run appears on the scorecard as a data point, not an arrow.

### Increment F — Scenario system + the ladder (new scenario JSONs, loader, events interpreter, campaign.js)
- Scenario schema + loader per §8 (loader first — today's loader carries only {nodes, links}), declarative events/injects interpreter [CMO-LUA]; content regression smoke-runs.
- Reference "Taiwan 2027" locked as the fixed baseline; then Rung 1 tutorial (level-design-taught, self-retiring coach marks [W1-1; BAE]); then first variants: No Japanese Basing, Taiwan Stands Alone, 2030 Magazines [CSIS-FB; EMPTY-BINS].
- **Lights Out ships if and only if the blockade MOE track (stockpile clock + capitulation-pressure index) ships with it**, documented in METHODOLOGY [CSIS-BLOCKADE]; Taiwan pre-war mining one-way door lands in the Campaign layer.
- Facilitator semi-rigid override with logged justification [UK-HB ¶3.10–3.15].
- **Verify:** a new player completes the tutorial with no manual in ~15 minutes; a facilitator authors a working inject by editing JSON; scorecard accumulates across three runs of two variants; a blockade run is scored by the blockade track, not the lodgment clock.

**Cross-cutting rule for every increment:** every new coefficient ships with its citation in METHODOLOGY.md and is operator-visible as a labeled analytic assumption; ruleset version stamps on every run; no increment may break seed determinism or worker parity; every "under N minutes" gate is verified with a novice.

---

## 11. Citations

**Method & doctrine of wargaming**
- [UK-HB] UK MoD Wargaming Handbook, DCDC, 2017 — https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/641040/doctrine_uk_wargaming_handbook.pdf
- [NATO-HB] NATO Wargaming Handbook, HQ SACT, Sept 2023 — https://paxsims.wordpress.com/wp-content/uploads/2023/09/nato-wargaming-handbook-202309.pdf
- [PERLA] Peter Perla, *The Art of Wargaming*, Naval Institute Press, 1990
- [PERLA-MCGRADY] Perla & McGrady, "Why Wargaming Works," Naval War College Review 64(3), 2011 — https://digital-commons.usnwc.edu/nwc-review/vol64/iss3/8/
- [MCGRADY] Ed McGrady, "Getting the Story Right about Wargaming," War on the Rocks, Nov 2019 — https://warontherocks.com/2019/11/getting-the-story-right-about-wargaming/
- [PERLA-IRON] Perla et al. on analytical wargaming and the cycle of research, War on the Rocks, Oct 2019 — https://warontherocks.com/2019/10/rolling-the-iron-dice-from-analytical-wargaming-to-the-cycle-of-research/ *(title/URL to be re-verified before external circulation)*
- [DOWNES-MARTIN] Downes-Martin, "Adjudication: The Diabolus in Machina of War Gaming," Naval War College Review 66(3), 2013 — https://www.jstor.org/stable/26397397
- [MCHUGH] F. McHugh, *Fundamentals of War Gaming*, US Naval War College, 1966 (taxonomy as cited via UK-HB ¶1.12; terminology to be re-verified against the primary text)
- [CALL-2006] CALL Handbook 20-06, *How To Master Wargaming*, US Army, 2020 — https://api.army.mil/e2/c/downloads/2023/01/31/bf65892d/20-06-how-to-master-wargaming-public.pdf
- [DAVIS] Paul K. Davis, "An Analysis-Centric View of Wargaming, Modeling, Simulation, and Analysis," RAND EP68814 — https://www.rand.org/pubs/external_publications/EP68814.html
- [SJMS] "To Learn or not to Learn: Mode Switching in Educational Wargames," Scandinavian Journal of Military Studies, 2022 — https://sjms.nu/articles/10.31374/sjms.123
- [RAND-PME] "How to Integrate Wargaming into Professional Military Education," RAND, 2025 — https://www.rand.org/pubs/commentary/2025/01/how-to-integrate-wargaming-into-professional-military.html
- [PERRY] C. Perry, "After Action Review, or Hot Wash" — https://c-g-perry.medium.com/the-hot-wash-or-an-after-action-review-e2c0ee2063bf
- [BAE] Sebastian Bae, "Put Educational Wargaming in the Hands of the Warfighter," War on the Rocks, Jul 2023 — cited in §3.6/§8 for facilitator-free, player-owned iteration and the tutorial ladder

**Taiwan scenario & campaign evidence**
- [CSIS-FB] Cancian, Cancian & Heginbotham, *The First Battle of the Next War*, CSIS, Jan 2023 — https://csis-website-prod.s3.amazonaws.com/s3fs-public/publication/230109_Cancian_FirstBattle_NextWar.pdf
- [CSIS-BLOCKADE] Cancian, Cancian & Heginbotham, *Lights Out? Wargaming a Chinese Blockade of Taiwan*, CSIS, Jul 2025 — https://csis-website-prod.s3.amazonaws.com/s3fs-public/2025-07/250730_Cancian_Taiwan_Blockade.pdf
- [EMPTY-BINS] Seth G. Jones, *Empty Bins in a Wartime Environment*, CSIS, Jan 2023 — https://csis-website-prod.s3.amazonaws.com/s3fs-public/2023-01/230119_Jones_Empty_Bins.pdf
- [HERITAGE] Heritage Foundation, "Assessing the U.S. Indo-Pacific Munitions System" — https://www.heritage.org/tidalwave/chapters/chapter-6-assessing-the-us-indo-pacific-munitions-system *(URL to be re-verified before external circulation)*
- [ENGSTROM] Jeffrey Engstrom, *Systems Confrontation and System Destruction Warfare*, RAND RR-1708, 2018 — https://www.rand.org/pubs/research_reports/RR1708.html
- [WUTHNOW] Joel Wuthnow, *PLA Systems Attack*, NDU Keystone 25-1, Jan 2025 — https://keystone.ndu.edu/Portals/86/PLA%20Systems%20Attack%20-%20Keystone%2025-1%20Jan%2025.pdf
- [CMPR] DoD, *Military and Security Developments Involving the PRC 2024*, Dec 2024 — https://media.defense.gov/2024/Dec/18/2003615520/-1/-1/0/MILITARY-AND-SECURITY-DEVELOPMENTS-INVOLVING-THE-PEOPLES-REPUBLIC-OF-CHINA-2024.PDF — used for order-of-battle *categories*; all in-game inventory counts are NOTIONAL and labeled as such, checked against the report's actual tables before publication
- [STIMSON] Stimson Center, "Cratering Effects: Chinese Missile Threats to US Air Bases in the Indo-Pacific," 2024 — https://www.stimson.org/2024/cratering-effects-chinese-missile-threats-to-us-air-bases-in-the-indo-pacific/
- [RAND-RR392] Heginbotham et al., *The U.S.-China Military Scorecard*, RAND RR-392, 2015 — https://www.rand.org/content/dam/rand/pubs/research_reports/RR300/RR392/RAND_RR392.pdf
- [SHUGART] Shugart RO-RO analysis, Defense News, Aug 2021 — https://www.defensenews.com/naval/2021/08/04/china-reportedly-converted-civilian-ferries-for-amphibious-assault-operations/
- [CMSI] CMSI Note 18 (Erickson), "Flooding the Zone: Civilian LCTs in PLA Amphibious Operations," Jan 2026 — https://www.andrewerickson.com/2026/01/cmsi-note-18-flooding-the-zone-the-use-of-civilian-landing-craft-lcts-in-pla-amphibious-operations/
- [TWZ-BARGES] TWZ, "Our Best Look Yet at China's New Invasion Barges" — https://www.twz.com/sea/our-best-look-yet-at-chinas-new-invasion-barges
- [EASTON] Ian Easton invasion-window analysis, Taiwan News, Oct 2020 — https://www.taiwannews.com.tw/news/4034710
- [WOTR-STRAIT] "A Strait Too Far," War on the Rocks, Jun 2023 — https://warontherocks.com/2023/06/a-strait-too-far-how-a-deliberate-campaigning-approach-in-the-pacific-can-make-beijing-think-twice/ *(URL to be re-verified before external circulation)*
- [ASPI] ASPI Strategist, "Floating Piers and Sinking Hopes," 2024 — https://www.aspistrategist.org.au/floating-piers-and-sinking-hopes-chinas-logistics-challenge-in-invading-taiwan/
- [NAVALNEWS] Naval News, "CSIS Wargame: China's Invasion of Taiwan in 2026," Jan 2023 — https://www.navalnews.com/naval-news/2023/01/csis-wargame-chinas-invasion-of-taiwan-in-2026/ — source for the ground-loss share summary figure cited in §1
- [HENRIKSEN] Henriksen, "Mattis's Criticism of Effects-Based Operations," Air and Space Power Journal 26(5) — https://www.airuniversity.af.edu/Portals/10/ASPJ/journals/Volume-26_Issue-5/V-Henriksen.pdf

**Adjudication models**
- [HUGHES] Wayne P. Hughes Jr., "A Salvo Model of Warships in Missile Combat," Naval Research Logistics 42(2), 1995 — https://onlinelibrary.wiley.com/doi/abs/10.1002/1520-6750(199503)42:2%3C267::AID-NAV3220420209%3E3.0.CO;2-Y
- [ARMSTRONG] Michael J. Armstrong, "A Stochastic Salvo Model for Naval Surface Combat," Operations Research 53(5), 2005 — https://www.researchgate.net/publication/220243715_A_Stochastic_Salvo_Model_for_Naval_Surface_Combat
- [JP3-60] Joint Publication 3-60, *Joint Targeting* (public edition) — the F2T2EA (find, fix, track, target, engage, assess) construct; supplemented by Hebert, "Compressing the Kill Chain," Air & Space Forces Magazine, Mar 2003
- [CARES] Jeffrey Cares, *Distributed Networked Operations: The Foundations of Network Centric Warfare*, 2005
- [RAND-MR1028] RAND MR-1028, Appendix B "Sortie-Rate Model" — https://www.rand.org/content/dam/rand/pubs/monograph_reports/MR1028/MR1028.appb.pdf *(appendix attribution to be re-verified before external circulation)*
- [CSBA] Travis Sharp, "No Dominant Strategy for Air Dominance," CSBA — https://csbaonline.org/research/publications/no-dominant-strategy-for-air-dominance-collaborative-combat-aircraft-employment-basing-and-sortie-generation-in-a-taiwan-scenario
- [LUCAS-TURKES] Lucas & Turkes, "Fitting Lanchester Equations to the Battles of Kursk and Ardennes," Naval Research Logistics 51(1), 2004 — https://onlinelibrary.wiley.com/doi/10.1002/nav.10101
- [FILIPOFF] Dmitry Filipoff, "Fighting DMO" Pts. 3–5, CIMSEC, 2023 — https://cimsec.org/fighting-dmo-pt-4-weapons-depletion-and-the-last-ditch-salvo-dynamic/

**Craft & competitor study**
- [CMO-PULSE] Command: Modern Operations pulse timing / message-log pause — https://www.matrixgames.com/forums/viewtopic.php?t=242236
- [CMO-LUA] Command Lua event editor docs — https://commandlua.github.io/
- [MATRIX-PRO] Matrix Pro Sims — https://www.matrixprosims.com/about
- [FPC-WEGO] Flashpoint Campaigns command-delay/WEGO design — https://forums.matrixgames.com/viewtopic.php?t=403742
- [FPC-SITREP] Flashpoint Campaigns: Southern Storm Dev Log #2 (staff products) — https://forums.matrixgames.com/viewtopic.php?t=388926
- [MEIER] "GDC 2012: Sid Meier on interesting decisions," Game Developer — https://www.gamedeveloper.com/design/gdc-2012-sid-meier-on-how-to-see-games-as-sets-of-interesting-decisions
- [FIRAXIS] "Firaxis' big swing with Civilization VII," Game Developer, 2024 — https://www.gamedeveloper.com/design/firaxis-big-swing-with-civilization-vii-convincing-players-to-actually-finish-their-games
- [W1-1] "World 1-1," Wikipedia — https://en.wikipedia.org/wiki/World_1-1; [NYFA] https://www.nyfa.edu/student-resources/nintendo-can-teach-us-game-design/
- [SWINK] Steve Swink, *Game Feel*, Morgan Kaufmann, 2009
- [CS2-REPLAY] CS2 replay controls — https://tradeit.gg/blog/cs2-replay-controls/
- [FM6-0] US Army FM 6-0, *Commander and Staff Organization and Operations* — the five-paragraph OPORD format (Ch. on plans and orders); [USMC-INTENT] Commander's Intent discussion — https://www.files.ethz.ch/isn/30757/Intent_USMilitary_v4.pdf

**Internal** *(to be committed under docs/_research/ so the citation trail is auditable)*
- [METHODOLOGY] docs/METHODOLOGY.md (denial-MOE white paper, Colby framework, EBO caveat)
- [GAP-AUDIT] Codebase gap audit (game.js, wargame.js, campaign.js, moe.js, sim.js/sim-worker.js, StrikeSim2040.html — line-cited findings)
- [MODEL-RPT] Adjudication-model research report (salvo/kill-chain/sortie integration notes, RNG-parity constraints)
- [TAIWAN-RPT] Taiwan-scenario research report (magazine calibration, basing, weather, blockade branch)

*Citation-hygiene resolutions this revision:* legalclarity.org replaced by FM 6-0 for the OPORD; JP 3-60 cited directly with the Wikipedia crutch removed; the Datadog marketing cite dropped (CS2 suffices for chaptered replays); [BAE] now actually referenced (§3.6, §8); all flagged-unverified URLs/figures carry explicit re-verify notes and the NOTIONAL framing on checkable inventory numbers.

---

## Resolved product-owner questions

- **(a) Turn length:** 3.5 days stands — the CSIS-citable choice, fits the sitting, and makes the submarine reload cycle a natural 1–2-turn mechanic.
- **(b) Red playbook visibility:** identity disclosed up front; sampled temperament disclosed only in the AAR (§5).
- **(c) ROE gating:** ladder-state gating plus a small counted political-capital budget, with denials always resolving to counter-offers or standing conditions (§4) — never a silent veto.

---

## Appendix A — Rejected critiques

1. **[Fun #6] Lead the AAR with "you're at the 30th percentile — your plan was sound."** Rejected as worded: percentile placement in an ensemble of your own orders measures luck conditional on the plan, not plan quality (credibility #1 is correct and controlling). The retention hook is retained honestly: the verdict screen leads with the *paired* comparison — "your orders beat the staff baseline in N% of paired trials; the dice did the rest" — which is the same emotional payload with a defensible basis.

2. **[Credibility #14, option (a)] Extend the reference scenario to 8 turns (D+29) so the week-4 surge arc completes.** Rejected: two more turns bust the locked 45–75-minute sitting for exactly the runs that go long. Option (b) adopted instead — the week-4 promise is cut and Red-magazine depletion pays off visibly inside the horizon (shrinking salvo sizes by T4–5).

3. **[Feasibility #11] Keep auto-extend but make extension turns assessment-only and flag them.** Rejected in favor of the stronger fix: auto-extend is removed entirely. A flexing deadline stops binding the moment the player learns it flexes (fun #7), and endogenous stopping biases every cross-run statistic (credibility #7). MC projection from the final state replaces it for ambiguous endings.

4. **[Feasibility #8, option (b)] Expand order-expansion capacity to finer sortie points (AP×4) to fix apportionment granularity.** Rejected: finer granularity makes the dial problem worse, not better (fun #5). The discrete-chip economy adopted instead solves granularity and the Meier test simultaneously; AP survives as the internal denomination and display.

5. **[Fun #9, fallback] Elicit predictions only at act boundaries (3× per session).** Rejected as the default: per-turn belief-vs-result is the AAR's teaching instrument and act-boundary-only sampling starves it. The rote-ness is fixed instead by varying the elicited quantity, wagered confidence, and cross-run Brier scoring; act-boundary elicitation is kept in reserve as a playtest fallback if per-turn friction persists.

*(All other critique items across the three reviews were accepted and are integrated above: determinism-safe branch contract and segmented resolution; presentational-vs-model watch split with the impulse resolver deferred; kernel unification pulled into B; worker denial support and seeded fog-honest previews; C split into four shippable sub-stages; Blue-roster corrections (224 = 120 Red + 104 Blue; moe.js assesses Red only); headless counterfactual runner costed in E; event-keyed CRN rewrite costed in D; Red lodgment bias in A; derived node engagement defaults; compact storage; tutorial resequenced into F; submarines/torpedoes; blockade MOE track; command-friction ranges; scorecard epistemics; degradable Taiwan; space ISR; escalation ceiling; mines; salvo binomialization; ensemble definition; EBO reframing; wartime ally events; citation hygiene; novice-gated time budgets; calibration-bet design.)*
