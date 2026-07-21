# M1 — Positioning & Value Proposition
- Dimension: Marketability
- Focus: Positioning, target users, value proposition, naming/branding.
- Files inspected: README.md; StrikeSim2040.html; _codex_review/README.md; _stark/audits/00-MASTER-FIXLIST.md

## Summary
StrikeSim 2040 has a marketable core: an offline, no-build, browser-based multi-domain planning and wargaming prototype with 3D network, map, Monte Carlo, War Game, and NDS Campaign Planner surfaces. The strongest differentiator is air-gap/offline usability, but that claim is under-leveraged in the product story and partially contradicted by online font loading. The positioning currently reads as a dense feature inventory rather than a clear promise to a specific user. Naming and operational-sounding copy should be tightened before showing this to defense stakeholders, contractors, or non-technical evaluators.

## Strengths
- Offline/no-backend/no-build operation is a strong differentiator for constrained defense environments, and the README states this plainly with no external runtime calls and a local static-server workflow (README.md:10, README.md:11, README.md:17).
- The capability set is unusually complete for a browser prototype: 3D network view, Geo/Map modes, table/task-org views, COA simulation, Monte Carlo trials, NDS Campaign Planner, War Game handoff, and import/export are all visible in the README feature list (README.md:34, README.md:47).
- The app already presents a distinctive military/C2 visual identity: the boot screen and command bar use STRIKESIM 2040, multi-domain language, and NOTIONAL // UNCLASS markings (StrikeSim2040.html:1248, StrikeSim2040.html:1265).
- The repo is explicit that the review process includes marketability as a first-class dimension, not just code correctness or UX polish (_codex_review/README.md:11, _codex_review/README.md:16).

## Findings
### M1-01 — Canonical brand is not locked
- Severity: P1   Impact: 4   Effort: S
- Location: README.md:1; README.md:3; StrikeSim2040.html:13; _stark/audits/00-MASTER-FIXLIST.md:71
- Observation: The README leads with `StrikeSim 2040` but immediately says it was formerly `MDSC 3D Network Visualizer` (README.md:1, README.md:3). The browser title uses `StrikeSim 2040 — Indo-Pacific Multi-Domain Wargaming` (StrikeSim2040.html:13), while the existing audit roll-up separately flags `StrikeSim 2040 / MDSC / DST2040 / "Strike Sim"` as a branding inconsistency (_stark/audits/00-MASTER-FIXLIST.md:71).
- Recommendation: Declare one canonical external name, one short name, and one category line. Recommended: `StrikeSim 2040` as product name, `StrikeSim` as short name, and `offline multi-domain COA rehearsal and wargaming tool` as category. Move `Formerly MDSC` into a changelog or internal note, and remove legacy names from user-facing copy unless they are compatibility aliases.
- Tradeoffs/risks: Keeping legacy labels may help early collaborators orient themselves, but it makes the product look transitional to new evaluators.

### M1-02 — Target user and buying context are implied, not stated
- Severity: P1   Impact: 5   Effort: M
- Location: README.md:3; README.md:5; README.md:11; README.md:34; README.md:47
- Observation: The README explains what the tool does, but not who it is primarily for. It calls the app a `multi-domain strike-planning wargame` (README.md:3), describes an offline browser tool for force networks and COA simulation (README.md:5), and lists many capabilities (README.md:34, README.md:47). The `IL5–IL6 friendly` note strongly implies defense users (README.md:11), but the page never chooses between training cell, battle staff rehearsal, innovation demo, classroom wargame, contractor prototype, or operational planning aid.
- Recommendation: Add a short positioning block near the top of the README and in the first-run/about surface: `For exercise planners, battle staff trainers, and defense innovation teams who need an offline sandbox to visualize force networks, rehearse COAs, and brief notional outcomes without a backend or cloud dependency.` Then explicitly state non-goals, especially `not an operational targeting system` and `notional data only`.
- Tradeoffs/risks: Narrowing the first target user may feel limiting, but it will make demos, screenshots, and stakeholder conversations much easier to frame.

### M1-03 — Offline/air-gap differentiator is undercut by online font loading
- Severity: P1   Impact: 4   Effort: S
- Location: README.md:11; README.md:85; README.md:89; StrikeSim2040.html:15; StrikeSim2040.html:18
- Observation: The README states the app runs fully offline with no external network calls at runtime (README.md:11) and describes local/offline design for libraries and map tiles (README.md:85, README.md:89). The HTML still preconnects to Google Fonts and `fonts.gstatic.com` for display fonts (StrikeSim2040.html:15, StrikeSim2040.html:18). For a market pitch built around air-gap/IL environments, even a harmless fallback path creates avoidable credibility friction.
- Recommendation: Self-host the selected fonts under `vendor/` or remove the external font dependency and use local fallbacks. Then surface `Runs local/offline: no backend, no cloud, no runtime network dependency` in the app header, first-run card, and README hero section.
- Tradeoffs/risks: Self-hosting adds asset files and possible license review, but the offline claim is valuable enough to justify it.

### M1-04 — Operational-sounding UI copy risks overclaiming the product
- Severity: P1   Impact: 4   Effort: S
- Location: StrikeSim2040.html:1250; StrikeSim2040.html:1265; StrikeSim2040.html:5894; StrikeSim2040.html:5918; StrikeSim2040.html:6105; StrikeSim2040.html:6114
- Observation: The product correctly marks itself `NOTIONAL // UNCLASS` in the boot screen and command bar (StrikeSim2040.html:1250, StrikeSim2040.html:1265). But nearby immersive UI copy says `initializing C2 core`, shows `C2 LINK`, labels a ticker `LIVE INTEL`, and includes `ISR FEED LIVE` (StrikeSim2040.html:5894, StrikeSim2040.html:5918, StrikeSim2040.html:6105, StrikeSim2040.html:6114). That language is exciting for a demo but can imply real-time feeds, operational command integration, or decision authority the prototype does not have.
- Recommendation: Keep the cinematic HUD, but reword operational claims to simulation-safe language: `simulation C2 sandbox`, `scenario link`, `training intel`, `notional ISR feed`, and `local synthetic data`. Add one visible disclaimer in the first-run/about surface: `No live feeds, no external connectivity, no operational tasking authority.`
- Tradeoffs/risks: Softer wording may reduce the “movie trailer” effect, but it will make the product safer and more credible with compliance-minded reviewers.

### M1-05 — Value proposition is feature-led instead of outcome-led
- Severity: P2   Impact: 3   Effort: S
- Location: README.md:34; README.md:46; README.md:50; README.md:68; README.md:114; README.md:115
- Observation: The README is rich in implementation and feature detail: views, COA simulation, Campaign Planner, import/export (README.md:34, README.md:46), architecture/module layout (README.md:50, README.md:68), and bundled scenario counts (README.md:114, README.md:115). What is missing is the simple demo arc: what problem a user starts with, what workflow StrikeSim enables, and what artifact they can take away after ten minutes.
- Recommendation: Add a `Demo narrative` or `Why it matters` section before Architecture: `1. Load notional Red/Blue force networks. 2. Identify high-payoff/high-risk nodes. 3. Build a COA. 4. Run Monte Carlo confidence checks. 5. Hand posture into War Game or export a brief.` Tie each step to an operator value: faster understanding, explainable tradeoffs, local/offline rehearsal, and briefable outputs.
- Tradeoffs/risks: This duplicates some feature-list content, but outcome sequencing will make the product easier to sell and evaluate.

## Quick wins (top 3 high-impact/low-effort)
1. Replace the README subtitle with one canonical positioning sentence and move legacy names out of the hero block.
2. Remove or self-host Google Font calls, then add an explicit `offline/local-only` badge to the README and in-app command/about surface.
3. Rewrite the most overclaiming HUD strings from `LIVE INTEL` / `C2 LINK` / `ISR FEED LIVE` to simulation-safe notional equivalents.

## Open questions for the human review
- Who is the first intended audience: training/exercise planners, operational staff rehearsal, defense innovation teams, contractors, classroom wargamers, or public hobbyists?
- Is `StrikeSim 2040` the final external name, or should the product move toward a less directly military/commercially safer brand?
- Should the market promise emphasize `offline C2 visualization`, `COA rehearsal`, `wargame training`, or `campaign planning` as the primary wedge?
- What claims are permissible around IL5/IL6 friendliness, operational relevance, and notional data in the intended sales or demo context?
