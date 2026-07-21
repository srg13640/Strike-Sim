# Audit: War Game UI

Surface: `wargame.js` (self-contained HUD over the map/3D/table views). State source: `game.js` `getState()`.
Audited for first-time-player clarity, the select-node-then-act loop, fog/hotseat handoff, tempo & objectives legibility, strike FX across view modes, AAR readability, objective marking on the map, accessibility/contrast, small-screen behavior, and dead/confusing controls.

---

## [P0] Strike FX is silently dropped unless the Leaflet map is the visible view
**Where:** `wargame.js` `onResolved()` -> `window.MapModule.playStrikes`; `map.js` `playStrikes()`/`flashStrike()` both early-return on `!mapVisible()` (map.js:617, :596).
**Problem:** The whole "cinematic" payoff of committing a turn is animated tracer arcs. But if the player committed the turn while looking at the 3D graph, the table view, or the geo view, `mapVisible()` is false and every strike is dropped with no fallback and no way to replay. A first-time player in 3D (a primary view of this tool) commits a turn and sees *nothing* happen on screen — the turn appears to do nothing. The resolution log in the HUD updates, but the headline feedback is gone, and there is no "replay" affordance.
**Fix:** Either (a) before calling `playStrikes`, switch/ensure the map view is shown for the resolution beat, or (b) provide a view-agnostic fallback FX (flash the affected nodes in whatever view is active, or a brief HUD-side volley animation), and (c) add a small "▶ Replay strikes" button in the resolution log section that re-invokes `playStrikes(rep.events)` (forcing the map visible first). At minimum, gate the cinematic on a known-visible map.
**Effort:** M

## [P0] Objective nodes are never marked on the map despite `objectiveIds` being exposed
**Where:** `game.js` getState() returns `objectiveIds: {blue, red}` (game.js:551); no consumer anywhere — `refreshMapMarkers()` (map.js:338) and `applyHighlight` ignore it. Grep confirms `objectiveIds` is read by zero call sites outside game.js.
**Problem:** The scoreboard tells the player "Key objectives 6/8 held" and the setup screen says "hold your key terrain and deny theirs," but the player has no way to *see which 8 nodes those are* on the map/3D/table. The core hold/deny victory condition is invisible. You cannot defend or attack terrain you can't identify, so the objective layer collapses back into undifferentiated attrition — defeating its own design intent.
**Fix:** Render objective nodes distinctly: a ring/halo or badge on objective markers in `refreshMapMarkers` (and ideally the 3D/table views), color-coded by owning side, with a "lost/held" state. Add a HUD chip-list of objective nodes (clickable to select, like quickTargets) so they're reachable from any view. Expose `objectiveIds` through the existing visual refresh path.
**Effort:** M

## [P1] HUD has no responsive behavior; 340px fixed panel swallows small screens
**Where:** `#wg-hud{...width:340px;height:100%...}` (wargame.js:50); CSS contains zero `@media` rules (confirmed).
**Problem:** On a laptop at ~1280px the HUD eats a quarter of the width; on a tablet/narrow window (~800px or a split screen) the fixed 340px panel covers a large fraction of the map, and on phones it nearly fills the screen — yet you still need the map visible to (a) select nodes and (b) see strike FX. The two halves of the core loop fight each other for space with no adaptation.
**Fix:** Add a media query: below ~700px make the HUD full-width as a bottom sheet or a collapsible drawer; cap width to `min(340px, 92vw)`; let the body scroll independently (it already does) but ensure the foot button stays reachable. Consider a "collapse to peek" state during the select-a-node step so the map is usable.
**Effort:** M

## [P1] The "click a node on the map" requirement is under-signposted for a first-time player
**Where:** `renderTargetSection` empty state: "Click a node in the 3D / Map / Geo view to target it." (wargame.js:414); quickTargets only appears in that same empty state.
**Problem:** The single most important interaction — that orders come from selecting a node in the *map*, not from a list in the HUD — is communicated by one line of hint text that scrolls inside the panel, and only when nothing is selected. There's no arrow, no pulsing map cue, no first-run callout. New players routinely look for an "attack" menu inside the HUD and stall. The quickTargets chips are the real escape hatch but they're buried below the hint and easy to miss.
**Fix:** Add a first-turn coach mark / banner ("Step 1: click a node on the map to target it — or pick one below"). Promote quickTargets above the fold and make them visually primary on turn 1. Optionally flash/pulse the map markers when the HUD is awaiting a selection.
**Effort:** S

## [P1] quickTargets only suggests enemy nodes — no way to reach your own nodes (harden/repair) without map hunting
**Where:** `quickTargets()` filters `bn.team === foe` only (wargame.js:460-464).
**Problem:** Harden/Repair are first-class actions (and tempo strategy explicitly tells you to protect your own C2/Logistics), but the only one-click shortcut list is enemy-only. To harden your own command node you must find it in the 3D scene by eye — exactly the friction quickTargets exists to remove, and it's worst for the defensive/tempo play the game is trying to teach.
**Fix:** Add a second chip row "Your key nodes" (top friendly nodes by importance/tempo role, especially damaged or tempo-critical ones), clickable to select for Harden/Repair. Flag tempo-role nodes in both lists.
**Effort:** S

## [P1] Tempo & objectives are explained well at setup but the explanation is gone once play starts
**Where:** Setup strategy blurbs (wargame.js:226-227); in-game scoreboard shows raw "⚡ 7 AP · C2 3 · Logi 2" and "🎯 6/8 held" rows (wargame.js:376-386) with no legend.
**Problem:** The only place tempo and objectives are explained is the setup screen, which the player never sees again after Start Match. Mid-game, a first-timer sees "C2 3 · Logi 2" and a yellow bar with no idea that these *generate* their action points, or that the bar is "tempo fraction." Same for the objectives row. The connection between striking enemy C2 and reducing their AP — the central strategic hook — has no in-game reminder. The per-target `wg-strat` note (wargame.js:447) helps but only appears when you've already selected a tempo node.
**Fix:** Add a small persistent legend or an "(i)" tooltip on the AP and objectives rows that restates "Action points come from surviving Command + Logistics" and "Hold 8 key nodes — lose most and you're defeated." Consider showing AP delta projections when a tempo target is queued.
**Effort:** S

## [P1] No keyboard accessibility or focus management; HUD is mouse-only
**Where:** Entire HUD — zero `tabindex`, `aria-*`, `role`, or keydown handling (confirmed by grep). Close is an `×` glyph button; the handoff curtain and all toggles are click-only.
**Problem:** None of the setup toggles, order buttons, commit/next, or the close control are reachable or operable by keyboard in a predictable order, and there's no Escape-to-close. The blind-handoff curtain — a modal-like takeover — traps no focus and announces nothing to assistive tech. The decorative emoji glyphs (⚔, 🔒, ⚡, 🎯) have no text alternatives, so a screen reader reads stray symbols.
**Fix:** Add `aria-label`s to icon-only buttons (`#wg-x`, glyph buttons), make the toggle groups `role="radiogroup"`/radios, support Escape to close, give the curtain `role="dialog"`/`aria-modal` with focus trapping, and mark decorative emoji `aria-hidden`.
**Effort:** M

## [P2] Several low-contrast text colors risk failing WCAG AA on the dark panel
**Where:** e.g. `.wg-hint{color:#6f8fa8}` (wargame.js:113), `.wg-sel .meta{color:#88a8c2}` muted metas, `.wg-meta{color:#7e9cb5}` (wargame.js:74), masked-card `#5e7790` (wargame.js:142), `#wg-x{color:#88a}`.
**Problem:** Multiple secondary/hint texts sit around #6f8fa8–#88a on a ~#0a1622 background, which lands near or below the 4.5:1 AA threshold for body text — and these carry load-bearing info (the "click a node" instruction, HP/vuln metadata, fog "strength unknown"). Italic hint text compounds legibility loss.
**Fix:** Lighten secondary text to >=#9fb6ca (or test each against the actual panel bg for >=4.5:1), and bump the critical instructional hint to body-weight non-italic.
**Effort:** S

## [P2] AAR is a long single-scroll dump with no hierarchy; hard to read post-match
**Where:** `aarSection()` stacks callout + 6 metrics + score chart + 2 method tables + 2 target lists + 2 source lists (wargame.js:489-507), all inside the same 340px scrolling body.
**Problem:** That's ~8 stacked sections in a narrow column with no tabs, collapse, or "headline first" summary beyond the one callout. A first-time player gets a wall of tables (Atk/Hit/K/Dmg with no column-header tooltips — "K" and "Dmg" are unexplained) and is unlikely to parse what actually decided the match. The score-progression bars are good but lost in the middle.
**Fix:** Lead with a 2-3 line plain-language verdict ("You lost: Red neutralized your key objectives by turn 7. Your hit rate was 41%; your strikes leaned on X."). Make the deep tables collapsible/secondary. Add header tooltips/legends for Atk/Hit/K/Dmg. Consider a "Rematch / New Match" pair of buttons at the end (currently only "New Match").
**Effort:** M

## [P2] Fog handoff: live map/3D still shows the enemy even while the HUD masks it
**Where:** HUD masks via `maskedCard`/`hpBand` and the curtain (wargame.js:289-296, 367-371, 423-424), but `refreshVisuals()` redraws the real map markers from the live graph; the curtain only covers the HUD panel.
**Problem:** Under fog with two humans, the HUD hides enemy strength and raises a "no peeking" curtain — but the actual map/3D behind the HUD still shows every enemy node, its symbol, and (via popups/health-driven coloring) its status. The blind-handoff promise is only half-enforced; the planning player can read the board the HUD is trying to hide. This undermines the entire fog/hotseat feature's correctness.
**Fix:** When the curtain is up (and ideally during fogged planning), blank or blur the whole map/3D surface, not just the HUD — e.g. a full-screen overlay behind the HUD, or hide enemy markers/health coloring while masked. Decide and document exactly what fog hides on the map.
**Effort:** M

## [P2] Single global AI-difficulty toggle is silently applied to BOTH sides; confusing in human-vs-AI and unusable in AI-vs-AI asymmetry
**Where:** `renderSetup` one `#wg-diff` group (wargame.js:220-221); `readSetup` maps the single toggle onto `difficulty.blue` and `difficulty.red` identically (wargame.js:256).
**Problem:** The label "AI difficulty" implies it tunes the computer opponent, but it's written to both sides' difficulty regardless of who is AI. In a human-vs-AI match it reads fine but the toggle is shown even when both sides are human (where it does nothing — a dead control). And you can't set asymmetric difficulty for an AI-vs-AI watch. The control's scope is ambiguous.
**Fix:** Hide the difficulty toggle when no side is AI; relabel to clarify it applies to all AI sides, or offer per-AI-side difficulty when both are AI. Remove it from the DOM when irrelevant rather than leaving a no-op control.
**Effort:** S

## [P2] No confirmation/undo on destructive or dead-end controls (Clear orders, Close = forfeit/discard match)
**Where:** `close()` calls `W.endMatch()` and wipes the match with no prompt (wargame.js:197); "Clear orders" removes all queued orders instantly (wargame.js:405, 596).
**Problem:** The `×` close button silently ends the entire match (the comment notes it restores the scenario — i.e. the game is gone), and "Clear orders" nukes a turn's planning with no confirm or undo. A misclick on `×` mid-match is unrecoverable and there's no save/resume despite `serialize()` existing. For a tool people will demo, an accidental forfeit is a sharp edge.
**Fix:** Confirm before `close()` ends an in-progress match ("End match? Progress is lost."), or minimize the HUD instead of ending. Add a confirm or quick-undo to "Clear orders." Consider wiring the existing `serialize()` into a save/resume so closing isn't terminal.
**Effort:** S
