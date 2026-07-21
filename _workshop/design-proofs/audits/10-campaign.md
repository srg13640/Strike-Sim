# Audit: Campaign Planner

Surface: `campaign.js` (`window.CampaignModule`), `docs/NDS_CAMPAIGN_GAME_PLAN.md`, and the
"Campaign Planner" button/panel wired into `StrikeSim2040.html` (`<script src="campaign.js?v=p3">`).
Bottom line: the campaign layer is, today, a **self-contained text/number exercise** bolted next to
the rest of the tool. It reads a few aggregate signals from the scenario graph at start, but it does
not change the scenario, and the War Game handoff passes only four scalar knobs (AP, turn limit, seed)
that a defense planner would not recognize as a "campaign posture." The NDS framing is plausible at the
label level but the numbers underneath are invented and unexplained. Worst-first below.

---

## [P0] Campaign decisions never change the scenario or the War Game board

**Where:** `campaign.js:807-828` `launchWarGameFromPosture()`; consumed by `game.js:478-527` `newMatch()`.

**Problem:** The handoff translates the entire campaign (frame, lens, 5 phases of initiative choices,
9 strategic metrics) into exactly four knobs: `apBlue`, `apRed`, `turnLimit`, `seed` (plus fixed
`control`/`difficulty`/`fog`). `newMatch()` then *resets every blue/red node to full health*
(`game.js:488-494`) and builds the board straight from the graph. So none of the campaign work touches
the ORBAT, node health, target values, objectives, or which side holds what. A "Campaign advantage"
score of 85 and a "Campaign failure risk" score of 35 launch a War Game that differs only by a couple of
action points and a different RNG seed. A defense planner will immediately see that the strategic layer
has no operational consequence — it is a separate game that happens to set a difficulty dial.

**Fix:** Make at least one campaign output materially shape the board. Cheapest credible options:
(a) translate low `sustainment`/`dib` into reduced blue starting health or capped AP on logistics nodes;
(b) translate high `allies` into extra surviving/added blue nodes or partner access points;
(c) translate `denial`/`exposure` into red's starting posture or objective set. Pass a `posture` object
into `newMatch` and apply it in `buildBoard`, rather than only nudging AP. Until then, the README/doc
should stop implying the campaign "shapes the match" beyond tempo.

**Effort:** L (requires a `newMatch` posture hook in `game.js`; coordinate, do not edit blindly).

---

## [P0] War Game handoff bypasses the wargame UI's own match init

**Where:** `campaign.js:823-827` (calls `window.GameModule.newMatch(cfg)` then `document.getElementById('wg-launch').click()`); compare `wargame.js:629-636` `doStart()` and `wargame.js:187-202` `open()`.

**Problem:** The proper match-start path is `wargame.js doStart()`, which sets the UI module's own state
(`activeSide = firstHuman(cfg)`, `planTurnInit = -1`, `curtain = false`, `pendingSide = null`) *before*
calling `W.newMatch(cfg)`. The campaign handoff instead calls `GameModule.newMatch` directly and then
clicks the launch button. `open()` only calls `render(W.getState())`; it never re-arms `planTurnInit`,
`curtain`, or `pendingSide`. After any prior hotseat/fog match, those module-level vars are stale, so the
campaign-launched match can show a stale fog curtain, wrong "issuing orders as" side, or a mis-armed
plan-phase. It happens to not hard-crash because `render()` reconciles `activeSide` from `cfg.control`
and campaign always sets Blue=human, but this is fragile and side-channel.

**Fix:** Have `wargame.js` expose a public `startFromConfig(cfg)` that runs the same init as `doStart()`
(reset `activeSide`/`planTurnInit`/`curtain`/`pendingSide`, call `W.newMatch`, `refreshVisuals`, open the
HUD), and have `campaign.js` call that instead of poking `newMatch` + clicking the DOM button.

**Effort:** M.

---

## [P1] No save/resume of playable campaign state

**Where:** `campaign.js` whole module — `state` is a closure var (`campaign.js:14`), only `getState()`
is exposed read-only (`campaign.js:867`); README acknowledges this (`README.md:141-142`).

**Problem:** A planner cannot stop, resume, or compare COAs. "New Campaign" (`campaign.js:841`) silently
discards everything. The only output is a one-shot Markdown brief. The doc lists JSON persistence as
"Next Increment #1" but it is the single biggest gap for the stated "compare COAs" use case, and there is
no localStorage autosave even within a session, so an accidental panel reset or reload loses the run.

**Fix:** Add `serialize()/load()` on `CampaignModule` (the state object is already plain/JSON-safe),
autosave to `localStorage` on each `resolvePhase`, and add "Save COA / Load COA" buttons. Optionally
include the serialized campaign JSON inside the exported brief so a brief round-trips.

**Effort:** M.

---

## [P1] Strategic metrics are invented baselines with unexplained, arbitrary math

**Where:** `campaign.js:79-82,117-120,155-158` (per-campaign starting metrics ~28-54); effect magnitudes
`campaign.js:189-330`; score weights `campaign.js:644-648` (`positive*0.76 + risk*0.24`); thresholds
`campaign.js:650-656`.

**Problem:** Every number — starting metric of 49 for Denial, an action giving `+14` DIB, the 0.76/0.24
blend, the 72/58 assessment cutoffs — is a bare magic constant with no derivation, no units, and no
sourcing. A defense planner reading the panel has no way to know what "Denial 49" means or why partner
access is worth `allies:+12` while coalition C2 is worth `allies:+10`. This is the core credibility risk:
the labels are NDS-serious but the model underneath reads as hand-tuned to feel balanced, not as a
defensible abstraction. There is also no sensitivity/uncertainty shown, so it presents false precision.

**Fix:** (1) Document the metric scale and the meaning of each effect in the doc and/or as panel tooltips.
(2) Replace scattered magic numbers with a small named constants block and a one-line rationale per
metric. (3) Either show ranges/uncertainty or relabel scores as qualitative bands so the tool does not
overclaim precision. No need for real classified data — just make the abstraction self-explaining.

**Effort:** M.

---

## [P1] Difficulty and fog are hardcoded; campaign risk does not reach the AI

**Where:** `campaign.js:814-822` builds `cfg` with `difficulty:{blue:'hard',red:'hard'}` and `fog:true`
always; `game.js:384-407` `planOrders` uses `cfg.difficulty[side]`.

**Problem:** The campaign tracks `escalation` and `exposure` as headline risk metrics, and Red's behavior
is the obvious place they should land — but Red AI difficulty is pinned to `hard` regardless of campaign
outcome. Only `apRed` floats (`5 + (exposure-denial)/45`, clamped 3-6). So a campaign that produces a
dangerous escalatory posture yields the same Red skill as a controlled one. Fog is also forced on with no
campaign rationale. The result undercuts the "posture shapes the fight" claim a second time.

**Fix:** Map campaign risk to Red difficulty (e.g. high `escalation`/`exposure` or low `denial` ->
`difficulty.red='hard'`, otherwise `'medium'/'easy'`), and let the campaign frame decide `fog`. Surface
the chosen difficulty/AP/turns to the user before launch so the handoff is legible.

**Effort:** S.

---

## [P1] Scenario->campaign coupling is cosmetic and silently degrades with no scenario

**Where:** `campaign.js:480-507` `graphSignal()` + `startCampaign()` (`campaign.js:509-535`); per-phase
`threatMult` `campaign.js:604`.

**Problem:** The only graph influence is at campaign *start*: `threatPressure` nudges `denial`/`exposure`
by at most ~6-8 pts, a geo-density check adds `+3` initiative, and `highValueBlue>12` subtracts `2`
homeland. During play, the graph affects outcomes only through `threatMult` in the range ~0.92-1.14 on
phase pressure — negligible. With no scenario loaded, `graphSignal` returns `hasScenario:false` and the
whole campaign runs on pure defaults with a quiet "No active scenario graph detected" line, so the planner
gets no signal that the campaign is decoupled from the map they may think they're planning against.

**Fix:** Either (a) deepen the coupling so node categories/domains map to which LoEs are stressed (doc's
"Next Increment #3"), or (b) if it stays abstract, make the decoupling explicit in the UI ("Campaign runs
on doctrinal defaults; scenario graph provides only a threat-pressure modifier"). At minimum, gate or warn
more prominently when no scenario is loaded.

**Effort:** M (deep coupling) / S (honest labeling).

---

## [P2] Two fixed launch buttons can't be reopened mid-match and crowd the top bar

**Where:** `campaign.js:356-361` `#cp-launch{top:14px;left:14px}` and `close()` (`campaign.js:475-478`);
`wargame.js:45` `#wg-launch{top:14px;left:50%}`.

**Problem:** Launching the War Game from the campaign calls `close()` (`campaign.js:825`), which restores
`#cp-launch`. But the campaign panel cannot be reopened to review the brief while a match is running
without state confusion, and there's no in-match link back to the campaign that produced the posture.
Both modules also independently park fixed buttons across the top-left/top-center with z-index 1399/1400,
which competes with other top-bar UI on small screens (the media query only nudges cp-launch).

**Fix:** Add a persistent "from campaign" affordance inside the War Game (show the source campaign name +
score), and consider a single unified mode-launcher rather than two free-floating fixed buttons.

**Effort:** S.

---

## [P2] Nine-metric grid mixes "higher is better" and inverted-risk cards confusingly

**Where:** `campaign.js:712-714,727-734` `metricCard()`; risk inversion `campaign.js:728-730`.

**Problem:** The Strategic Metrics grid shows all 9 metrics including `escalation` and `exposure`, whose
bars are silently inverted (`shown = 100 - value`) with only a trailing "risk lower is better" note, while
the big number still shows the raw value. So Escalation can read "31" with a near-full green bar — the
number and the bar point in opposite directions. Seven positive metrics plus two inverted risk metrics in
one undifferentiated 2-col grid is a lot to parse and easy to misread under time pressure.

**Fix:** Visually separate risk metrics (own sub-section, red framing, explicit "RISK" label), or show
both raw value and a clear "ok/elevated/high" band so the number and bar agree.

**Effort:** S.

---

## [P2] Exported brief lacks deltas, assumptions, timestamp, and the NDS source citation

**Where:** `campaign.js:753-805` `exportBrief()`.

**Problem:** The brief is a reasonable snapshot but omits what a real campaign brief/AAR needs: per-phase
metric *deltas* (it lists only end-state metrics and a score), the assumptions/risk-acceptance register
(doc's "Next Increment #2"), a date/time and tool version, the planner-lens rationale, and the NDS source
citation that the doc itself prints (`docs/NDS_CAMPAIGN_GAME_PLAN.md:16-18`). The filename is fixed
(`strikesim-campaign-brief.md`), so exporting two COAs overwrites in the downloads folder.

**Fix:** Add a header with date + campaign frame + lens + score band, list per-phase before/after deltas
and notes, include the NDS source line and the unclassified-abstraction disclaimer, and make the filename
unique (campaign id + score + timestamp).

**Effort:** S.

---

## [P2] Doc/README overclaim how connected the layer is

**Where:** `docs/NDS_CAMPAIGN_GAME_PLAN.md:39-41`; `README.md:41-42,79`.

**Problem:** The doc says the player "Resolves phase pressure against strategic metrics" and "launches the
existing War Game with Blue/Red action points and turn length shaped by campaign posture," which is
literally true but oversells it — a reader infers the *battle* is shaped, when only tempo knobs change
(see P0). The README's "Campaign before battle … keeps strategic assumptions separate" is accurate, but
nothing tells the user the separation is total at the board level.

**Fix:** Add one honest sentence to both: today the campaign shapes only AP/turn-limit/seed; deeper board
coupling is a planned increment. Keeps the framing credible instead of inviting the "it's just a text
exercise" critique.

**Effort:** S.
