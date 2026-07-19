# CODEX HANDOFF — RESUME IMPLEMENTATION (2026-07-11)

**Paste everything below into CODEX.**

---

You are CODEX, resuming implementation on **StrikeSim 2040**. You stopped mid-CO-005 Phase 3/4; Seth transferred the backlog to Claude, who has since completed it. The repo state is clean, proofed, and fully ledgered. **Your first job is not to write code — it is to audit the new state and propose to Seth what comes next.**

## 1. WHAT LANDED WHILE YOU WERE AWAY

All work is on local branch `codex/co-005-thinking-enemy` (never pushed; `origin/main` is far behind), commits `788d377 → e8bd76b`, tree clean, all proofs green.

**CO-005 "thinking-enemy-measured-mind" — COMPLETE (`1f7d485`).** Your in-flight Phase 3/4 state was checkpointed (`788d377`) and finished (`88a02fc`). Root cause of every takeover failure: proof/eval harnesses must load `strategic-state.js` **before** `game.js` — this one bug bit **seven** different tools (last two fixed in `72ab48e`, `c157f97`). Then: all 128 Red nodes tagged with sanctioned `geographyClass` (`e95dc17`); C5 **SMALL ISLAND FAIT ACCOMPLI** operation variant — authored `scenarios/small-island-fait-accompli.json` via `tools/build-small-island-scenario.js`, BRIEF variant chips, in-place graph swap, schema update (`0fdcdba`); A6 restricted-Nash career adaptation (cold-start-inert, blend cap p≤0.5, persisted at `strikesim.co005.v1.playerModel`), A7 AAR exploitability meter + 200-world exploit probe, B7 precision audit / update-style labels / outside-view strip (`371ee97`); docs (`e453eb9`). **Balance gate PASS: blue 0.460 over 200 seeds** (target 0.45–0.55 hard/hard).

**CO-006 "performance-layer" — COMPLETE (`1e23e6a`, `09625f3`, `00e2295`, `9d24d5d`, `d3d47dd`).** Boot ritual → title front door, `audio.js` (4 buses, gesture unlock, drone beds) + `cinematics.js`; BRIEF/COMMIT cinematics + Director-authored comms floor; WATCH war film (letterbox, throttled camera cuts on the deterministic pacing clock, event-class stingers, sparse BDA ≤3/turn) + AAR ceremony (verdict stamp, card deal, seeded rank chip); W6 settings at `strikesim.co006.settings` — reduced motion (`html.cin-rm`), performance mode (`html.cin-perf`), callsign, boot-fast. **Presentation-only invariant held: engine diff zero.** `tools/performance-layer-proof.js` = 39 contracts.

**CO-007 "online-layer" — OFFLINE-SAFE SLICE COMPLETE (`9935fc6`, `a99e286`, `e696c30`, `e8bd76b`).** `online-flags.js` (the ONE swappable build file; network flags frozen OFF, share ON serverless); `share.js` (challenge-link codec spec v1, `#op=SS1z/SS1j`, strict fail-silent validation, boot intake); Director challenge wiring (forced seed + chips + NEUTRAL player model, chip change voids, AAR COPY CHALLENGE LINK); `tools/replay-verify.js` (exit 0/1/2, determinism is the anti-cheat); `tools/online-layer-proof.js` = 48 contracts. A Cloudflare server sketch lives in the **nested repo** `site/` (`9ab29fe`): HMAC daily-seed, submit→UNVERIFIED, verify-runner. **NEVER DEPLOY.** Remaining server work (daily-seed client UI, Brier outcome re-derivation harness, KV/D1 wiring, Access gate, build-tag binding) is **PARKED pending Seth's hosting decision.**

## 2. GROUND TRUTH — READ BEFORE ANYTHING ELSE

1. `change-orders/CO-005-thinking-enemy-measured-mind.md` → **§7 PROGRESS NOTES** — the ledger convention: append an entry whenever you commit. Successor-CO tracking is at the bottom.
2. `change-orders/CO-006-performance-layer.md` → PLAN OF RECORD → Progress.
3. `change-orders/CO-007-online-layer.md` → PROGRESS NOTES (includes the activation checklist).
4. `docs/GAME_DESIGN.md` §9 anti-goals — still binding: one resolver, seeded determinism, no prediction theater, no new top-level modes.
5. **Ignore `CO-006-CODEX_PROMPT.md`** (superseded; says so in its header).

## 3. TRAPS AND PINNED FACTS (learned the hard way — do not relearn)

- Any harness or tool that loads `game.js` MUST load `strategic-state.js` first. Seven tools have been bitten; yours will be the eighth.
- `match.playerModel` **mutates during play** and steers Red's exploit policy. Exact replay requires the pre-match snapshot (share payload `pm` field / `op.startModel`; null = neutral).
- The CO-006 P2 proof pins **"no WATCH bed"**: WATCH near-silence is literal silence + stingers. Do not add an ambient bed.
- Balance tuning touches doctrine/policy constants **only**. Never the `moe.js` arbiter.
- No `Math.random` in runtime paths — all randomness through named seeded streams.
- Presentation work must leave engine files (`game.js`, `moe.js`, `sim.js`, `strategic-state.js`) diff-zero.
- The repo copy of `online-flags.js` stays frozen network-OFF; hosted variants live only under `site/`.
- New player-facing surfaces carry **UNCLASSIFIED // NOTIONAL**.
- Persistent stores: `strikesim.co005.v1.playerModel` (career), `strikesim.co006.settings` (cinematics-owned). Don't invent new ones casually.

## 4. VERIFY ON ARRIVAL (before proposing anything)

Confirm `git status` is clean, then run the proof suite (expected passing counts in parentheses):

`validate-scenarios` (incl. small-island variant + Red geography requirement), `doctrine-proof` (26), `brier-proof` (30), `mind-games-proof` (7/7), `escalation-proof`, `content-adaptation-proof` (17), `director-ux-proof`, `joint-force-proof`, `counterfactual-proof`, `runtime-performance-proof`, `performance-layer-proof` (39), `online-layer-proof` (48) — all under `tools/`, run with `node`.

Balance record: `node tools/wargame-loop-gate.js` (~4 min) reproduces **blue 0.460** byte-for-byte from seed-base 42.

If anything is red: **stop and report to Seth.** Do not fix-forward without his sign-off.

## 5. YOUR TASK — DETERMINE WHAT'S NEXT

No active change order remains. After the §4 audit, write Seth a short prioritized proposal **before writing any code**. Candidates the ledgers surface, with the evidence for each:

**a. Branch integration.** Everything above rides local `codex/co-005-thinking-enemy`, unpushed. Propose a merge/push plan to `main` (or argue for staying on the branch) — this is now the biggest single-point-of-failure risk.

**b. Doctrine balance spread.** Aggregate is in band, but per-doctrine blue win rates are asymmetric: attrition 0.327 (n=101), decapitation 0.567 (n=60), denial 0.641 (n=39). The CO-005 ledger flags a weights-only tuning pass as the identified follow-up. Re-run the 200-seed gate after any change.

**c. Hosting decision prep** — the actual blocker for CO-007 activation. Lay out for Seth: Cloudflare Pages + Access (free ≤50 testers) vs itch.io restricted page, effort/cost, and the parked activation checklist (§1 above). Deployment stays forbidden until he says go.

**d. Content expansion via the C5 pipeline.** `tools/build-small-island-scenario.js` established the pattern: authored, schema-validated, BRIEF-selectable operation variants are now cheap. Propose 1–2 candidates if you go this way.

**e. A CO-008 of your own devising**, argued from `docs/GAME_DESIGN.md` roadmap gaps — subject to §9 anti-goals.

Deliverable: recommendation + rationale + rough phase plan. Only after Seth's sign-off do you open a plan-of-record section and start committing. Discipline as before: small coherent commits, relevant proofs green before every commit, ledger append per commit, tree clean when you stop.

## 6. COORDINATION — DO THIS FIRST

A Claude scheduled task (`strikesim-monitor-implement`, every 2h) has been auto-committing to this repo. **Seth: disable or delete it before CODEX resumes, or the two agents will collide.** CODEX: confirm with Seth that it is off before your first commit.
