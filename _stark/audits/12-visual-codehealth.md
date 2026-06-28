# Audit: Visual design + code health

Surface: global theme/typography/color system across `StrikeSim2040.html` (`:root` vars, `body.high-contrast`, two Google Fonts) and the per-module injected CSS in `wargame.js`, `symbols.js`, `map.js`. Bar: a cohesive, premium ~$10M COP/warfighting tool (Palantir/Anduril cousin) that reads a decade ahead. Audited for: cross-surface visual cohesion (HUD vs map legend vs sidebar vs task-org vs tables), typography rigor (Inter/Oswald adoption + offline/FOUT risk), affiliation/team color consistency across map symbols / 3D / table swatches / War Game HUD vs milsymbol's own 2525 palette, dark-theme contrast/WCAG, spacing/radius/density, iconography. Plus 3-5 high-value code-health notes.

The single biggest theme: **there is no shared design system.** Each surface invents its own blues, reds, borders, radii, and font handling. The result is four mutually-inconsistent color systems and a type stack that is only ~10% applied. None of it is broken — it just doesn't read as one tool, which is exactly the gap between "capable demo" and "premium product."

---

## [P0] Four competing blue/red color systems — affiliation color is incoherent across surfaces
**Where:** App vars `--team-blue #4dabf7` / `--team-red #ff6b6b` (`StrikeSim2040.html:74-75`); War Game HUD hardcodes `#6cc0ff` / `#ff8585` and accent `#4bb8ff` / borders `#234a68` / `#1c3a55` (`wargame.js:101-150`, banners :137-138, turn bars :134); map strike FX uses a *third* pair `#6fe0ff` / `#ff8a4a` (`map.js:600`); symbols.js fallback frame uses a *fourth*, `#3d9be0` friend / `#e0584a` hostile (`symbols.js:26-27`); and milsymbol itself renders standard 2525 `colorMode:'Light'` (cyan-ish friend / 2525 red hostile) at `symbols.js:243`. So "blue" is simultaneously `#4dabf7`, `#6cc0ff`, `#6fe0ff`, `#3d9be0`, and milsymbol's cyan depending on which surface you look at; "red" has four variants too. A commander cannot build a stable mental color key, and side-by-side (map symbol + HUD card + table swatch) the mismatch is visible.
**Problem:** Affiliation color is the load-bearing semantic in a COP — it must be pixel-identical everywhere or the picture lies. Right now it isn't.
**Fix:** Define one canonical affiliation palette as CSS vars (e.g. `--aff-friend`, `--aff-hostile`, `--aff-neutral`, `--aff-unknown`, plus `--team-blue/-red` aliased to them). Decide *one* rule: either adopt milsymbol's 2525 affiliation colors as canon (most defensible for a mil tool) and recolor the app's team-blue/red, glyphs, banners, FX, and swatches to match it, OR override milsymbol's `colorMode` to your brand palette. Then replace every hardcoded blue/red in `wargame.js`, `map.js:600`, and `symbols.js:26-29` with the shared vars. Single source of truth, top priority.
**Effort:** M

## [P0] War Game HUD CSS ignores the entire app design system (vars, radius, type)
**Where:** `wargame.js:75-153` — ~70 injected rules using only literal hex (`#234a68`, `#1c3a55`, `#173249`, `#112536`, text `#bcd6ec`/`#9fbdd6`/`#88a8c2`/`#6f8fa8`), gradients `#1d6f3f→#15532f`, and radii `6/7/8/10/999px`; references zero `var(--…)`.
**Problem:** The HUD is the showcase feature, and it's a stylistic island. Its borders are a different blue-grey than `--border #1e2a38`, its panel fills differ from `--panel`, its muted text differs from `--muted #9db2c9`, and it can't follow `body.high-contrast` (which only re-maps the vars it ignores) — so accessibility mode silently doesn't apply to the most interactive surface. Toggling themes or tweaking a brand color leaves the HUD stranded.
**Fix:** Port the HUD palette to the shared vars: `--border`, `--panel`, `--text`, `--muted`, `--accent`, affiliation colors, and a small radius scale. Where the HUD genuinely needs new tokens (success-green button, fog-amber), add them to `:root` and `body.high-contrast` so they theme correctly. This both unifies the look and makes high-contrast actually cover the War Game.
**Effort:** M

## [P1] Typography is ~10% applied — Inter/Oswald load but the app body uses the system stack
**Where:** Fonts loaded `StrikeSim2040.html:19`; but `body{font-family:-apple-system,…,Roboto,Inter,Helvetica…}` (`:282`) buries Inter 5th behind system fonts, so on macOS the whole app renders in San Francisco, not Inter. Oswald is applied to exactly two places: org-chart titles (`:342`) and the War Game HUD titles (`wargame.js:153`). Sidebar, details panel, tables, COA cards, toasts, modals, map legend all fall through to system-ui.
**Problem:** A loaded-but-unused type pair gives you the cost (two network fonts, FOUT) with almost none of the benefit. The app's "voice" is inconsistent — Oswald condensed caps in two spots read as premium; the rest reads as a generic system UI. A $10M tool has one deliberate type system end to end.
**Fix:** Make Inter the primary body font app-wide: `body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}`. Promote Oswald to a `--font-display` var and apply it consistently to *all* surface titles/section headers (sidebar `h2`/`#details h2`, panel headers, table `th`, COA titles, modal headers), not just two. Define a small type scale (e.g. 11/12/13/16/20px already in use — formalize as `--fs-xs…--fs-xl`) and a header letter-spacing token so condensed caps are uniform.
**Effort:** M

## [P1] Online-only webfonts in an offline-first tool — FOUT + no-network degradation
**Where:** `StrikeSim2040.html:17-19` — `<link>` to `fonts.googleapis.com` / `fonts.gstatic.com` with `display=swap`. Leaflet and milsymbol are vendored locally (`vendor/`), but the fonts are not.
**Problem:** The product is explicitly an offline browser COP tool (no build step, vendored deps). On an air-gapped/field machine the Google Fonts request fails, so Inter/Oswald never arrive and the app silently falls back to system-ui — meaning the *intended* typography is exactly the one that disappears in the deployment environment it's built for. Even online, `display=swap` produces a visible flash as Oswald titles reflow. This contradicts the offline posture and undercuts polish at first paint.
**Fix:** Self-host the two families in `vendor/fonts/` (woff2 subsets) with local `@font-face` and `font-display:optional` (or `swap` with size-matched fallback metrics to kill layout shift). Remove the external `<link>`. This makes typography deterministic offline and eliminates FOUT — consistent with how Leaflet/milsymbol are already bundled.
**Effort:** S

## [P1] No spacing/radius scale — border-radius ranges 3→4→6→7→8→10→12→999px with no logic
**Where:** Across `StrikeSim2040.html` (radii 3/4/6/8/10/12/999 at :87,:117,:128,:158,:188,:262,:472,:535,:762…), `wargame.js` (6/7/8/10/999), `map.js` legend (6), and ad-hoc paddings (`4px 8px`, `5px 7px`, `6px 6px`, `8px 10px`, `9px 10px`, `12px 20px`). Cards use 12px radius, HUD uses 8px, chips use 6–12px, pills use 999px — inconsistently between modules.
**Problem:** Mixed corner radii and arbitrary padding read as assembled-by-accretion, not designed. Premium tools feel cohesive because radius/spacing come from a 4- or 6-step scale. Right now a COA card (r12), a HUD card (r8), and a table badge (r999) sitting near each other clash.
**Fix:** Define `--radius-sm/md/lg` (e.g. 4/8/12) + `--radius-pill 999` and an 4px-based spacing scale (`--sp-1…--sp-6`), then sweep both the HTML and the injected module CSS to the tokens. Pick one card radius and apply it to COA cards, HUD cards, AAR metrics, and result tiles uniformly.
**Effort:** M

## [P1] Muted/secondary text fails WCAG AA on the dark panels in several spots
**Where:** Low-contrast greys: `wargame.js` `.wg-hint #6f8fa8` and `.wg-aar-table th #7fa3c0` / `.wg-aar-metric span #87a6bf` on `~rgba(18,36,54)` panels; `map.js` legend `.mil-leg-note #6f93a8` / `.mil-leg-sub #7fa6bf` on `rgba(8,18,28,.92)` (`:258-266`); `.org-node .sub #8fa8c0` on `#0d1825` (`:345`). Several of these land around 3:1 or below against their backgrounds (AA wants 4.5:1 for body text, 3:1 only for large/≥18.66px bold).
**Problem:** Hints, table headers, legend notes, and org sub-labels are exactly the explanatory text a first-time operator leans on, and they're the hardest to read. On a glare-prone field display this gets worse. A defense tool will be held to accessibility standards in procurement.
**Fix:** Raise the muted floor: standardize secondary text on `--muted #9db2c9` (already ≈4.5:1 on `--panel`) and reserve dimmer greys only for ≥14px-bold large text. Spot-fix the sub-3:1 cases above. The `body.high-contrast` path is a good safety net but the default theme should pass AA on its own.
**Effort:** S

## [P2] Map legend and org-chart are visual islands (own fonts, own greys, own border colors)
**Where:** Map legend CSS `font:11px/1.3 system-ui` + borders `#1d3343`, text `#cfe6f5`, headers `#9ec6dd`/`#7fa6bf` (`map.js:258-266`) — never uses Inter or the app vars. Org-chart uses its own card fill `#0d1825`, name `#eef4fb`, sub `#8fa8c0`, importance `#ffd86b` (`:338-347`).
**Problem:** Two more surfaces with bespoke palettes and a different (system-ui) font from everything else, reinforcing the "collection of widgets" feel. The legend in particular is the user's decoder ring for the whole COP and looks unrelated to the panels around it.
**Fix:** Route both through the shared vars and Inter once the token system from the P0/P1 items exists: legend bg→`--panel`, borders→`--border`, body→`--text`/`--muted`, font→Inter; org-chart card/text likewise, with importance amber pulled from a shared `--warning`/`--accent-amber` token.
**Effort:** S

## [P2] Iconography is inconsistent emoji (⚔ 🎯 ⚡ 🔒 ▶) mixed with milsymbol SVG and CSS glyphs
**Where:** War Game uses emoji throughout — launch `⚔ War Game` (`wargame.js:175`), curtain `🔒`, setup `⚡`/`🎯` (`:226-227`); strike-X uses `×`; legend toggle uses `–`; while the map renders crisp 2525 SVG symbols and the org-chart draws SVG mil-glyphs.
**Problem:** Emoji render differently per-OS/per-font (and won't match the offline font posture), carry a consumer-app connotation that fights the milsymbol gravitas two inches away, and vary in weight/baseline. A premium defense UI uses one icon system.
**Fix:** Replace chrome emoji with a single lightweight inline-SVG icon set (stroke icons matching the milsymbol line weight) for sword/target/bolt/lock/play/close. Keep milsymbol for affiliation symbology. This is the cheapest single change that most raises the "is this real?" bar.
**Effort:** M

## [P2] [code-health] `simulateTrial` is duplicated between the HTML and the Web Worker
**Where:** `StrikeSim2040.html:3494 function simulateTrial(actionPlan, opts={})` and `sim-worker.js:106 function simulateTrial(actionPlan, opts)` — two copies of the Monte-Carlo trial logic. (`resolveTurn` correctly lives only in `game.js:239`.)
**Problem:** Two parallel implementations of the core trial math drift apart silently — a balance/probability fix in one won't reach the other, so the inline run and the worker run can disagree. Classic source of "the numbers changed and I don't know why."
**Fix:** Extract the trial function into a shared `sim-core.js` loaded by both the page and the worker (worker via `importScripts`), or have the inline path post to the worker too. One implementation, one place to tune.
**Effort:** M

## [P2] [code-health] Module wiring relies on fragile global aliasing + swallowed try/catch
**Where:** Every module is an IIFE that publishes to `window.*` and reaches for peers by name with defensive guards: `wargame.js:167 (typeof selectedNode !== 'undefined')`, `:169-170`, `:654`, `:663-664 window.GameModule`; `map.js` `resolveCssVar(... 'var(--accent)')` fallbacks; pervasive `catch(e){}`. Load order is hand-ordered in the `<head>` (`:29-58`).
**Problem:** Cross-module calls fail *silently* (empty catches), so a missing/renamed global degrades to "nothing happens" with no console signal — hard to diagnose and easy to ship broken. Identifiers like `selectedNode`/`applyHighlight`/`refreshMapMarkers` are implicit contracts enforced by nothing. As surfaces grow this gets brittle.
**Fix:** Don't rewrite the no-build architecture, but: (1) define a tiny explicit `window.Strike` namespace/registry instead of bare globals; (2) replace silent `catch(e){}` with `catch(e){console.warn('[module]', e)}` so failures surface; (3) document the required-globals contract per module at the top of each file. Low-risk, high-debuggability.
**Effort:** M

## [P2] [code-health] 5,436-line HTML shell mixes structure, ~900 lines of CSS, and heavy app logic
**Where:** `StrikeSim2040.html` — single file holding the DOM, the entire global stylesheet (`:59-940`+), and large inline functions (`simulateTrial:3494`, `simulateCOA:4847`, `simulatePlanOnce:5365`, plus much more) while sibling concerns already live in extracted `.js` modules.
**Problem:** The shell is the one file every change touches, yet it's the least modular — CSS, markup, and sim/COA logic are interleaved, making the design-token sweeps above (and any logic edit) high-risk and hard to review. It's also where the duplicate `simulateTrial` and the bulk of hardcoded colors hide.
**Fix:** Incrementally lift the inline `<style>` into a `theme.css` (forced by the token work anyway) and move the COA/plan/trial logic into modules alongside `game.js`/`sim.js`. Even just extracting the stylesheet shrinks the shell by ~900 lines and makes the visual system reviewable in isolation.
**Effort:** L
