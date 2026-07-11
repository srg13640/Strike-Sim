# CHANGE_ORDER `CO-006` — performance-layer

> Produced by Claude (Fable) 2026-07-11. Binding visual/audio reference:
> `_design_explorations/variant-E-gamefeel.html` (open it, sound on, click boot → title →
> NEW OPERATION before reading further). Execute **after** CO-005 phases land — both COs
> touch `director.js`, and this one gives CO-005's new surfaces (Commit Card, Intel
> Assessment, calibration card) their ceremony. Where this document and the mockup
> conflict, the mockup's feel wins. Kickoff: tell CODEX to read this file and execute
> Phase 1. Before writing code, append a PLAN OF RECORD section to this file.

---

You are transforming StrikeSim 2040 from a browser tool that *contains* a game into something that *performs* like one — the presentation standard of a AAA strategy title (think the briefing screens of Call of Duty: Modern Warfare, the mission briefs of Ace Combat, the cold restraint of DEFCON). The diagnosis: the skin was never the problem. The Stark-HUD visual language (dark naval, `--cyan #00d8ff`, `--amber #ffb000`, Orbitron/Share Tech Mono, glass panels, glows) is good and `docs/GAME_DESIGN.md` §6 already mandates "full-screen moments for Brief, Commit, and AAR (cinematic, letter-boxed, calm typography)." What's missing is **performance**: no title screen, no sound, no transitions, no pacing, no ceremony. A game earns "real" through motion, audio, and ritual — not through a different shade of cyan.

**The fusion, named:** the watch floor is *Modern Warfare* (tactical FUI, radio chatter, terminal typography), the briefing is *Ace Combat* (letterboxed, typed, scored, paced), the war itself is *DEFCON* (when the world resolves, strip the chrome — cold, quiet, consequential). Three registers, one identity.

## 0. READ FIRST

1. `_design_explorations/variant-E-gamefeel.html` — click through it twice: once as a player, once reading the source (the Web Audio graph and canvas camera are reference implementations).
2. `docs/GAME_DESIGN.md` §6 (UI/UX doctrine — this CO executes and extends it) and §9 (anti-goals — still binding).
3. `director.js` — every feature here lands inside its BRIEF→PLAN→COMMIT→WATCH→AAR machine, including the CO-005 surfaces already added to it.
4. `stage.js` (resize/fullscreen/WebGL recovery — your reliability substrate), `ui.js` (toasts/event log — the comms floor replaces/absorbs this), `StrikeSim2040.html` (CSS custom properties block).

## 1. INVARIANTS

1. **Presentation only.** Zero changes to `game.js`, `moe.js`, `sim.js`, or any resolution/AI/scoring logic — including CO-005's `red-mind.js`, `forecasting.js`, `escalation.js`. You touch the render/audio/CSS layer of `director.js`, the shell CSS, and new modules (`audio.js`, `cinematics.js`). Rebase on landed CO-005 UI rather than duplicating it.
2. **No new top-level modes.** The title screen is the front door *to* the Operation Loop, not a mode beside it.
3. **Offline-complete, online-enhanced.** The core game runs fully from `file://` with zero network — instant boot, no spinners, demo-proof in a room with no WiFi. This is the premium single-player posture (offline-capable is how real single-player games behave; always-online is a multiplayer/live-service property), and it preserves the repo's deliberate air-gap build. Vendor the display fonts (Orbitron, Share Tech Mono woff2) into `vendor/fonts/` per the existing vendor pattern — the mockup's Google Fonts link is mockup-only. All audio is procedural Web Audio (the mockup proves the entire palette needs zero asset files); if samples are added later, they get vendored and stay under ~2 MB total. Online features (daily-seed leaderboards, career sync, playtest feedback) are **CO-007's** progressive-enhancement layer on the `site/` wrapper: feature-flagged, fail-silent without network, never a dependency of the solo loop. This CO introduces **zero** network requests; do not architect in a way that blocks CO-007 from attaching later.
4. **Determinism untouched.** Presentation may *read* seeded state; it never draws from the match RNG. Cosmetic randomness uses its own non-match RNG.
5. **Respect the player's machine and body.** 60 fps target on the existing hardware budget; `prefers-reduced-motion` gets a dignified static path (no letterbox slide, no glitch, instant text); every audio cue has a visual counterpart (captions for chatter); master/music/SFX/comms volume sliders + mute.
6. `UNCLASSIFIED // NOTIONAL RESEARCH TOOL` banner persists on every screen including title and boot.

## 2. THE WORK

**W1. Design tokens, tightened.** Consolidate the shell's scattered custom properties into one authoritative `:root` block matching the mockup's discipline: base `#04080c`, cyan/amber/red/green semantic roles, one display face (Orbitron, weights 500/700/900), one mono (Share Tech Mono), letterspaced-caps label grammar (`.22em`–`.55em` by hierarchy), the scanline/vignette/grain FX layers as reusable classes with a single opacity dial. Kill any rogue inline colors the grep finds.

**W2. The Console Frame (diegesis).** The fiction: you are an operator at JOC Console 04. Boot sequence on first load (POST lines, crypto check, "FORECAST ENSEMBLE ... 200 WORLDS READY" — read real values from the loaded scenario), and the boot click doubles as the browser's audio-unlock gesture exactly as the mockup does. Then the title screen: wordmark, tagline, NEW OPERATION / CONTINUE (wired to save/replay when it lands; honest "no saved operations" until then) / OPERATION ARCHIVE (career + calibration history — CO-005's ledger gets its ceremony here) / SETTINGS. Persistent HUD strip: theater, DTG clock, posture. Skippable boot after first visit (localStorage flag), instant skip on any key.

**W3. Audio architecture (`audio.js`).** Lift the mockup's engine into a proper module with four gain buses (master/music/sfx/comms) and these voices: phase drone beds (title/brief/plan get distinct low beds — same 55 Hz family, different filter movement; WATCH gets *near silence* — the DEFCON move: the war is quieter than the menu), UI ticks (hover/type), confirm beeps, arm/commit thunk, letterbox whoosh, stamp, radio static bursts, and event stingers for WATCH (strike away, impact, kill confirm, cascade, tempo-loss motif — a descending two-note figure). Ducking: comms bursts duck music by ~6 dB. Every cue routed through one `AudioFX.play(name, opts)` API so the sound palette is data, not scattered calls.

**W4. The Comms Floor.** Replace the toast/event-log presentation with the mockup's bottom chatter feed — but driven by *real* engine events, not canned lines: forecast completion ("J35: FORECAST COMPLETE — 200 WORLDS, BAND HOLDS"), detection events, strike resolutions ("BDA: TGT-02 STRUCTURAL DAMAGE, REASSESSING"), tempo changes, doctrine-posterior shifts from CO-005 ("J2: POSTERIOR SHIFTING DENIAL, 61%"). Typed character-by-character with radio ticks, callsign-colored, captioned regardless of audio state. This is presentation *reading* truth — never inventing it.

**W5. Phase cinematics (`cinematics.js`), per the mockup's grammar:**
- **BRIEF:** letterbox in, glitch cut, operation-name stamp, typed sections from the real scenario brief, doctrine-prior bars (CO-005's disclosed prior — animate exactly like the mockup), target designators drawing onto the *actual* map/globe with TGT tags, camera slow-pan (Ken Burns on the real Leaflet/3D view — `map.js` flyTo choreography, not a fake canvas).
- **PLAN:** ambient bed, designate/undo sounds on dock interactions, bracket animation when a target is selected, AP pips that *sound* spent.
- **COMMIT:** the arming ceremony — orders readout in manifest style, forecast strip, CO-005's Commit Card elicitation styled as part of the ritual, ARM button that goes hot only after the forecast renders (mockup's armed pulse), irreversible thunk + letterbox on EXECUTE.
- **WATCH:** the war film. Letterboxed, chrome stripped to the phase rail, camera cuts to each resolving strike (paced by the existing playback sequencer), impact flash + expanding ring on the map, stingers per event class, kill confirmations arriving as comms lines, near-silence bed. Nothing here changes resolution — it *stages* the already-resolved seeded events.
- **AAR:** the debrief ceremony. Paced reveal (halt/lodgment verdict stamp first, silence, then the ledgers), the honesty ledger and CO-005 calibration card dealt as cards with sound, rank/medal progression tied to CO-005's sustained-BSS ranks, seed displayed like a serial number. Exit letterbox back to title.

**W6. Settings & accessibility.** Volume sliders per bus, reduced-motion toggle (mirrors the media query), performance mode (disables grain/glow/shadows), operator callsign (appears in comms addressing — cheap, deeply diegetic), boot-skip toggle.

## 3. SEQUENCING

Phase 1: W1 + W3 core (buses, ticks, one drone) + W2 boot/title. The game *sounds alive* and has a front door.
Phase 2: W5 BRIEF + COMMIT + W4 comms floor. The loop's bookends become cinematic.
Phase 3: W5 WATCH + AAR. The war film and the ceremony.
Phase 4: W6 + polish pass (timing, mix levels, reduced-motion audit).

Append the PLAN OF RECORD to this file before writing code. Small commits, one feature each.

## 4. ACCEPTANCE CRITERIA

1. `git diff` shows zero changes to `game.js`, `moe.js`, `sim.js`, `sim-worker.js`, `red-mind.js`, `forecasting.js`, `escalation.js`.
2. Cold load from `file://` with network disabled: boot → title → full operation loop, fonts and audio intact, **zero network requests in DevTools** across a full operation.
3. Audio initializes only after the boot gesture; no console autoplay warnings; mute/volume state persists (localStorage).
4. Same seed → identical match outcomes before/after this CO (run `tools/wargame-loop-eval.js` as the proof — presentation must not touch results).
5. `prefers-reduced-motion` path: no letterbox animation, no glitch, no typewriter (text appears set), game fully playable.
6. 60 fps during WATCH with FX on (measure via `tools/runtime-performance-proof.js` pattern; add `tools/performance-layer-proof.js`).
7. Every comms line traces to a real engine event (no fictional BDA — credibility is the product).
8. A stranger watching 30 seconds over your shoulder asks "what game is that?" — not "what dashboard is that?" That is the definition of done.

## 5. REFERENCE GRAMMAR (from the mockup — keep these exact feelings)

Letterbox: 9vh bars, 1.1s `cubic-bezier(.77,0,.18,1)`. Stamp: scale 1.6→1.0 with overshoot, 380ms, paired with a low thump. Typed text: ~2 chars/tick at 12ms with a tick every 6th char. Doctrine bars: 1.4s ease-out fills, staggered 350ms. Armed button: 2.2s glow pulse, never before the forecast lands. Drone: detuned saw pair at 55/55.7 Hz + sine octave, lowpass ~160 Hz with 0.07 Hz LFO. Radio burst: bandpassed noise at 2.2 kHz, ~100ms. The tempo-loss motif and kill-confirm stingers are yours to compose within this palette — keep everything in the same dark register; nothing bright, nothing cheerful, nothing that would feel wrong at 2 a.m. on a watch floor.

---

**One sentence to hold onto:** the engine already tells the truth — your job is to make the truth *land* like a war movie instead of scrolling past like a log file.

## PLAN OF RECORD (Claude, 2026-07-11)

Precondition notes: CO-005 complete at `1f7d485`. Fonts are ALREADY vendored (`vendor/fonts.css` carries Inter, Orbitron, Share Tech Mono woff2) — invariant #3's vendoring is pre-satisfied; the shell has one `:root` block (line ~68) to extend, an existing `#classification-banner`, and 5 `prefers-reduced-motion` blocks to build on. The Director's launcher is `#dir-launch` — the title screen's NEW OPERATION drives that exact button (front door TO the loop, not a mode beside it).

| Phase | Scope | Files | Proof |
|---|---|---|---|
| 1 | W1 canonical tokens + FX classes; W3 audio core — `AudioFXModule`, four buses (master/music/sfx/comms), gesture unlock, persisted prefs, palette (tick/beep/thump/stamp/whoosh/radio + title/brief/plan drone beds, comms ducking); W2 console frame — boot POST (real force counts from `strikesim:scenario-ready`, 200-world ensemble line, click-to-init = audio unlock, any-key skip, localStorage fast path), title screen (NEW OPERATION → `#dir-launch`, honest CONTINUE-disabled, OPERATION ARCHIVE from the CO-005 career stores, SETTINGS with working audio sliders), ⌂ CONSOLE return button | `audio.js` (new), `cinematics.js` (new), `StrikeSim2040.html` (tokens + 2 script tags), `tools/performance-layer-proof.js` (new) | performance-layer-proof static contracts; every CO-005 proof stays green |
| 2 | W5 BRIEF + COMMIT cinematics (letterbox, stamp, typed brief from real scenario context, doctrine-prior bars, arming ceremony); W4 comms floor driven by real engine events | `cinematics.js`, `director.js` (render layer only) | extended proof + director-ux-proof green |
| 3 | W5 WATCH war film (camera cuts, impact rings, stingers, near-silence bed) + AAR debrief ceremony (paced verdict, card dealing, rank) | `cinematics.js`, `director.js`, `map.js` flyTo choreography | 60 fps measurement per §4.6 |
| 4 | W6 settings complete (reduced-motion toggle, performance mode, operator callsign), mix/timing polish, reduced-motion audit | all presentation files | full §4 acceptance sweep |

Commit discipline: `CO-006:` prefix, one phase per commit, tree clean each run, zero diffs to `game.js`/`moe.js`/`sim.js`/`sim-worker.js`/`red-mind.js`/`forecasting.js`/`strategic-state.js`/`counterfactual*.js`.

### Progress
- Phase 1: ✅ COMPLETE — `1e23e6a` (audio.js, cinematics.js, shell tokens + script tags, performance-layer-proof.js with 11 contracts; engine diff zero; all CO-005 proofs green). The game now boots like a console and sounds alive.
- Phase 2: ✅ COMPLETE (2026-07-11, this commit) — the loop's bookends are cinematic and the floor talks.
  - **Cinematic grammar in `cinematics.js`:** `letterbox()` (9vh bars on the shell's `--lbox-dur/--lbox-ease` tokens), `stamp()` (1.6→1.0 overshoot on `--stamp-dur`, thump+tick voice), `typeText()` (2 chars/tick at `--type-tick-ms`, tick every 6th char, restores inline markup, stands down if a re-render disconnects the node), and phase sequences `briefCinematic` / `planCinematic` / `commitCinematic` / `executeCinematic`.
  - **BRIEF:** letterbox in → operation-name stamp (real scenario title) → typed situation paragraph → brief drone bed; the disclosed doctrine prior renders as staggered animated bars (1.4s ease-out, 350ms stagger) beside the existing text line. Chip changes tick; variant swaps beep and announce over comms with the real seed.
  - **COMMIT:** forecast completion announced by J35 with the real ensemble figures (`K` worlds, Red-down band, objective risk); house reveal plays `arm` and the EXECUTE button pulses (`cin-armed`, 2.2s) — hot only after the house line renders, never on the blind card. EXECUTE fires the irreversible ceremony: thump, letterbox, ORDERS COMMITTED stamp, bed stops (the war is quieter than the menu), comms floor yields to the resolution feed.
  - **W4 comms floor (`#cin-comms`):** bottom-left typed chatter, callsign-colored (JOC/J3/J35 cyan · J2 amber · BDA green · J5 warn), radio burst + music duck per line, 6-line visible cap + 24-line backlog cap, captions land instantly under reduced motion. **The Director is the sole author of every line** — composed in its render layer from live state (forecast bands, BDA counts, throughput, posterior drift ≥3 pts, escalation deltas); the proof asserts cinematics contains no callsigns and no literal percentages hide in comms strings.
  - **Proof:** `performance-layer-proof.js` grew 11→21 contracts (tokens, sole-author, armed-only-after-reveal, WATCH-silence, guarded bridges, no `Math.random` in director, prior-bar honesty, backlog caps, typewriter markup restore). All CO-005 proofs green; `wargame-loop-eval` 8-match slice from seed-base 42 byte-identical across repeated runs (engine untouched: git diff names only presentation files; the eval harness loads only moe/red-mind/strategic-state/game).
- Phase 3: NEXT — W5 WATCH war film (camera cuts to each resolving strike via `map.js` flyTo choreography paced by the existing playback sequencer, impact flash + expanding ring, event-class stingers routed as comms lines into the same floor, near-silence bed) + AAR debrief ceremony (paced verdict stamp → silence → ledgers dealt as cards, rank/medal from CO-005 sustained-BSS, seed as serial number, exit letterbox to title). Measure 60 fps per §4.6.
