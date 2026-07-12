# CHANGE_ORDER `CO-007` — online-layer (OFFLINE-SAFE SLICE ACTIVE)

> Stub by Claude (Fable) 2026-07-11. CO-005 and CO-006 have landed; Seth authorized the
> **offline-safe slice only** (2026-07-11): share/challenge links, feature flags, replay
> verification. Everything requiring a live endpoint stays PARKED until the hosting
> decision is final (current lean: Cloudflare Pages + Cloudflare Access on the existing
> `site/` wrapper — free for ≤50 testers). Cloudflare code is written under `site/` but
> **never deployed**.

---

## Posture: offline-complete, online-enhanced

The `file://` game remains complete forever — no feature below may become a dependency of the solo loop. Every online feature is progressive enhancement: feature-flagged, fail-silent when no network, invisible in the air-gapped build. Nothing always-online, no ambient telemetry; any data leaving the machine is explicit and user-triggered.

## Candidate features (priority order)

1. **THE DAILY SEED.** Everyone plays the same seeded world each day; the leaderboard ranks **calibration skill** (CO-005's BSS/Brier), not just victory. Streaks, percentile placement. This is the Wordle loop for wargaming, and the game's two rarest assets make it cheap and honest: seeds are already the replay currency, and CO-005's scoring layer is already the ranking system.
2. **Share/challenge links.** Encode seed + committed order log in a URL for exact replay ("beat my world"). Note: implementable **serverless** (pure URL payload) — a candidate to ship early since it doesn't even violate the offline posture.
3. **Career sync.** Calibration record, ranks, operation archive across devices. Cloudflare Workers KV/D1; anonymous device ID first, no accounts in v1.
4. **Playtest feedback.** Lightweight feedback endpoint + build tag, present only in the hosted build behind Cloudflare Access. Pairs with the restricted itch.io channel for playtester comments.
5. **Someday:** human-Red white cell — two-player blind simultaneous commit. Large; not before doctrines and the online substrate are proven.

## Design notes

- **Determinism is the anti-cheat.** A submitted daily-seed score is not a trusted number — it is a seed + order log + stated forecasts, replayable server-side through the same resolver for verification. Cheap, absolute, and only possible because of invariant #2 in CO-005.
- Leaderboard identity: callsign (CO-006's operator setting) + anonymous ID; no PII.
- The hosted build and the offline build stay byte-identical except for one feature-flag file; behavior with network absent must be indistinguishable from the offline build (zero console errors, zero retries/spinners).

## Acceptance sketch (expand when activated)

1. Solo loop with network disabled: zero behavioral difference from the pre-CO-007 build.
2. A daily-seed submission replays server-side to the identical result before it ranks.
3. Kill switch: disabling the flag file returns the hosted build to pure offline behavior.

---

## PLAN OF RECORD — offline-safe slice (Claude, 2026-07-11)

Scope authorized by Seth: **S1 feature flags, S2 share/challenge links, S3 Director wiring,
S4 replay verifier, S5 proof, S6 `site/` Cloudflare sketch (never deploy).** Daily-seed
service, career sync, and feedback endpoint remain PARKED — no runtime file may open a
network connection in this slice.

### Invariants (binding, on top of GAME_DESIGN §9)

- **I-1 Offline-complete.** `file://` behavior with no payload present is byte-identical
  in effect to pre-CO-007: no new network calls anywhere in runtime files, no spinners,
  no console errors. Share links are serverless (pure URL payload) and work on `file://`.
- **I-2 One resolver.** The verifier replays through the shipped `moe.js → red-mind.js →
  strategic-state.js → game.js` in that exact load order (the CO-005 harness rule). No
  re-implementation of any resolution math anywhere, including under `site/`.
- **I-3 One flag file.** Hosted and offline builds differ only by `online-flags.js`.
  Runtime reads flags exclusively through safe getters; a missing/false flag must be
  indistinguishable from the feature not existing.
- **I-4 Exact replay requires the starting player model.** `match.playerModel` mutates
  during play (commitTurn merge) and shapes Red's exploit policy, so a replay payload
  carries the PRE-match model snapshot (`pm`), or `null` meaning the neutral/empty model.
  Challenge intake always starts NEUTRAL — same world, fair ground, leaderboard-honest.
- **I-5 Fail-silent.** Malformed/oversized/foreign payloads are ignored without a toast,
  a console error, or any state change. Seeded randomness only; no `Math.random`.

### Payload spec v1 (`share.js` owns; verifier + site/ consume)

`#op=SS1<z|j>.<base64url>` — `z` = deflate-raw (browser `CompressionStream`, Node `zlib`),
`j` = plain JSON (fallback when `CompressionStream` is unavailable). Decoders accept both.

```
{ v:1, kind:'challenge'|'replay',
  seed, variantId,                       // 'default' or a StrikeSimVariants id
  fp,                                    // scenario fingerprint at build time (C-011)
  cfg:{turnLimit, redDiff, roeId},
  pm,                                    // null = neutral model; else pre-match snapshot
  callsign, ts,                          // display-only; no PII beyond the chosen callsign
  claim:{winner, turns, reason, lodgment, bss},
  turns:[{t, orders:[{k,tid,m,src,axis,tc}], f:[{q,p,o}]}]   // replay kind only
}
```

Orders map 1:1 onto `queueOrder` inputs (k=kind, tid=targetId, m=methodKey, src=sourceId,
tc=targetClass); feint/decoy signal ids regenerate deterministically from queue sequence.
`f` rows are the stated forecasts (q=question id, p=stated probability, o=resolved outcome):
the verifier recomputes the Brier arithmetic from p/o; re-deriving o itself server-side
awaits the daily-seed activation (documented cut — question replay needs the ghost harness).

### Work items

- **S1 `online-flags.js`** — frozen `window.OnlineFlags{version, build:'offline', flags}`,
  network flags all `false`, `share:true` (serverless), `enabled(name)` getter. The hosted
  variant lives under `site/` as `online-flags.hosted.js`; swapping it is the kill switch.
- **S2 `share.js`** — `window.ShareModule`: payload build (challenge from any finished op;
  replay adds per-turn blue orders + forecasts), encode/decode (`SS1z`/`SS1j`), URL
  build/parse (`#op=`), clipboard copy with degrade, all behind `OnlineFlags`.
- **S3 Director wiring** — stash `op.startModel` before `newMatch`; AAR gains a
  CHALLENGE LINK button (flag-gated) that copies the replay URL + comms confirm; boot/BRIEF
  intake: valid payload ⇒ variant select + forced seed + NEUTRAL player model + a
  CHALLENGE banner naming the issuer's callsign and claim; invalid ⇒ silence (I-5).
- **S4 `tools/replay-verify.js`** — CLI: `--payload <str|file> | --url <url>`; loads the
  payload's scenario (default graphs or authored variant JSON), fingerprint gate, replays
  blue orders through `queueOrder`/`commitTurn`/`nextTurn` (every injection must return
  true), compares final {winner, turns, reason, lodgment} to `claim`, recomputes Brier/BSS
  arithmetic from `f` rows. Exit 0 VERIFIED / 1 MISMATCH / 2 MALFORMED.
- **S5 `tools/online-layer-proof.js`** — contracts: flag file frozen + default-off;
  HTML includes present once, correct order, NOTIONAL headers; codec round-trip (j and z);
  replay payload < 8 KB; end-to-end self-test (AI-vs-AI run → payload → verifier exit 0;
  tampered order → exit 1; garbage → exit 2); static no-network scan of new files;
  kill-switch (all-false flags ⇒ ShareModule inert).
- **S6 `site/` sketch (nested repo, never deploy)** — Pages Function stubs for
  `GET /api/daily-seed` (HMAC(date) seed derivation) and `POST /api/submit` (payload →
  verification queue), a verification runner that shells the SAME `tools/replay-verify.js`
  against the shipped game files (I-2), `online-flags.hosted.js`, and a README-CO007
  marked NEVER DEPLOY.

### Commit plan

Small slices, `CO-007:` prefix: (1) plan of record; (2) S1+S2+S3 flags + share links;
(3) S4+S5 verifier + proof, all proofs green; (4) ledger close. `site/` work rides the
nested repo, not these commits.

## PROGRESS NOTES (ledger)

- 2026-07-11 — Offline-safe slice ACTIVATED (Seth: "continue with 007"). Plan of record
  written; survey established the human-input surface (BRIEF cfg + queueOrder kinds +
  stated forecasts) and the I-4 player-model finding. Next: S1+S2+S3.
- 2026-07-11 — **S1+S2+S3 SHIPPED** (`a99e286`): online-flags.js (frozen, network OFF,
  share ON), share.js (spec-v1 codec SS1z/SS1j, strict fail-silent validation, boot
  intake, clipboard), Director wiring (challenge briefs force seed/chips + NEUTRAL model,
  chip changes void the challenge, CHALLENGE banner card, AAR COPY CHALLENGE LINK).
- 2026-07-11 — **S4+S5 SHIPPED** (`e696c30`): tools/replay-verify.js (validates through
  share.js's own validator; fingerprint drift gate; engine-rejected injection = MISMATCH;
  exit 0/1/2) + tools/online-layer-proof.js — **48 contracts green** (static 37, e2e 11:
  exact reproduction of a scripted human-blue fixture on the default graph AND the
  small-island variant; tampered claim/order caught; drift caught; kill switch inert).
  En route, repaired the counterfactual proof (`c157f97`) — seventh tool missing the
  strategic-state-before-game load order; the live worker was already correct.
- 2026-07-11 — **S6 SHIPPED** (site/ nested repo `9ab29fe`): co007/ server sketch —
  hosted flag file, HMAC daily-seed endpoint, UNVERIFIED-parking submit endpoint,
  verify-runner shelling the repo verifier (smoke: VERIFIED real fixture, rejected junk).
  Not wired into the site build. NEVER DEPLOY until activation.
- **OFFLINE-SAFE SLICE COMPLETE.** All regression proofs green from a pristine HEAD
  export. Acceptance #1 (no-network parity) holds by construction: zero sockets in new
  files (proof-scanned), flags frozen OFF, share is serverless. Acceptance #3 (kill
  switch) proof-tested. Acceptance #2 (server-side replay before ranking) is designed
  and smoke-tested but PARKED with the hosting decision. Remaining for activation:
  daily-seed client UI, Brier outcome re-derivation harness (the documented cut),
  KV/D1 wiring, Cloudflare Access gate, build-tag version binding.
