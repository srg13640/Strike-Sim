# M4 — Go-to-Market Packaging
- Dimension: Marketability
- Focus: Demo/pitch readiness, packaging/deployment, pricing/licensing, distribution, objections.
- Files inspected: README.md; StrikeSim2040.html; Open StrikeSim 2040.command; _codex_review/README.md; _codex_review/CODEX_PROMPT.md; _stark/audits/00-MASTER-FIXLIST.md; _stark/MORNING_REPORT.md; _stark/START_HERE.md; program-briefs/2026-06-26-credible-warfighting-tool.md; HANDOFF.md; REVIEW_PROMPT.md; repository license/deploy/pricing filename search.

## Summary
StrikeSim 2040 has a strong marketable core: a no-build, offline-capable browser wargame/C2 visualization prototype with 3D graph, 2D map, MIL-STD-2525 symbology, Monte Carlo, War Game, and Campaign Planner positioning. The strongest go-to-market angle is not "another simulation demo"; it is a portable, air-gap-friendly strike-planning training and experimentation package that can be opened from files or a static server. The packaging layer is not yet buyer-ready: distribution is still mostly README plus a macOS launcher, pricing/licensing is undefined, and the current demo claims are exposed to known P0 credibility defects. The path to a sharper pitch is to ship a constrained demo package first, not to widen the product surface.

## Strengths
- Offline/no-build posture is unusually strong for defense distribution: README states there is no build step, package manager, or backend and only a static server is needed (README.md:17-30).
- The README concisely names high-value capabilities: 3D network view, Geo/Map modes, task-org/table views, Monte Carlo COA simulation, NDS Campaign Planner, and import/export (README.md:34-47).
- The app already presents itself with operator-facing branding and classification framing: "STRIKESIM 2040" and "MULTI-DOMAIN STRIKE WARGAME · NOTIONAL // UNCLASS" are visible in the shell (StrikeSim2040.html:1265).
- The local launcher improves demo portability by finding or starting a static server and opening the app with cache-busting (Open StrikeSim 2040.command:11-20, Open StrikeSim 2040.command:35-43).
- Existing internal material already recognizes demo packaging as a priority, including a "10-minute demo script" and a suggested closing pitch around offline operation and iteration speed (_stark/MORNING_REPORT.md:79-98).

## Findings
### M4-01 — Core demo claims are exposed to known P0 credibility defects
- Severity: P0   Impact: 5   Effort: M
- Location: README.md:5-8; README.md:41-45; _stark/audits/00-MASTER-FIXLIST.md:14-36
- Observation: The product pitch leans on force-network visualization, MIL-STD-2525 map symbology, Monte Carlo COA simulation, War Game, and Campaign Planner capabilities (README.md:5-8, README.md:41-45). The current master fix list still classifies several directly demo-facing issues as P0, including air/sea/space units rendering as ground symbols, marker pile-up, missing combat-table difficulty labels, stale/empty plan simulation, mislabeled beam search, correlated Monte Carlo trials, and divergent inline/worker simulation copies (_stark/audits/00-MASTER-FIXLIST.md:14-36).
- Recommendation: Create a dedicated "demo-safe" release profile before pitching: either fix the P0s that touch the walkthrough or temporarily hide/label affected paths so the demo never claims unsupported fidelity. The demo script should exercise only verified flows and include a preflight checklist for map symbols, COA generation, Monte Carlo run, War Game launch, and Campaign Planner handoff.
- Tradeoffs/risks: Narrowing the demo may feel less impressive, but letting an SME hit a stale COA or wrong military symbol is a worse sales failure than showing fewer features.

### M4-02 — Offline/air-gap selling point is undercut by live Google Fonts dependency
- Severity: P1   Impact: 4   Effort: S
- Location: README.md:10-12; README.md:85-89; StrikeSim2040.html:15-19; _stark/audits/00-MASTER-FIXLIST.md:69-70
- Observation: The README says the tool runs fully offline with no external network calls at runtime and describes `OFFLINE_MODE = true` plus local vendored libraries (README.md:10-12, README.md:85-89). The HTML still preconnects to Google Fonts and loads Inter, Oswald, Orbitron, and Share Tech Mono from `fonts.googleapis.com` / `fonts.gstatic.com` (StrikeSim2040.html:15-19), and the audit rollup already flags "online-only Google Fonts in an offline-first tool" (_stark/audits/00-MASTER-FIXLIST.md:69-70).
- Recommendation: Self-host the selected font files under `vendor/fonts/`, replace the remote `<link>` tags with local `@font-face`, and add a one-line offline dependency statement to README. For a demo package, also include a "network disconnected" smoke step so the air-gap claim is demonstrable in the room.
- Tradeoffs/risks: Self-hosting adds a small asset-management task and possible font licensing checks, but it removes an obvious objection during any IL5/IL6 or field-use conversation.

### M4-03 — Distribution is still developer/demo-machine oriented, not buyer-installable
- Severity: P1   Impact: 4   Effort: M
- Location: README.md:15-30; Open StrikeSim 2040.command:1-4; Open StrikeSim 2040.command:14-20; Open StrikeSim 2040.command:35-43
- Observation: The quick start is simple but still asks the user to run a static server command and open localhost (README.md:15-30). The friendlier launcher is a macOS `.command` bash script that relies on `curl`, `lsof`, `python3 -m http.server`, and `open` (Open StrikeSim 2040.command:1-4, Open StrikeSim 2040.command:14-20, Open StrikeSim 2040.command:35-43). That is good for a founder laptop demo but weak for distribution to a program office, training cell, Windows-heavy unit, or locked-down workstation.
- Recommendation: Package a release ZIP with `START_HERE.html` or `START_HERE.md`, macOS/Windows/Linux launchers, a known-good browser note, checksums, offline dependency manifest, sample scenario manifest, and a troubleshooting page. Treat the current `.command` as one launcher in a cross-platform kit, not the product distribution mechanism.
- Tradeoffs/risks: A true installer may be premature; a signed ZIP plus scripts is the lower-friction middle ground until the buyer environment is known.

### M4-04 — Pricing, licensing, and evaluation terms are absent from the sellable surface
- Severity: P1   Impact: 4   Effort: S
- Location: StrikeSim2040.html:33; repository license/deploy/pricing filename search
- Observation: The app identifies at least one third-party component and its license in code comments, e.g. `milsymbol.js (MIT)` (StrikeSim2040.html:33). A filename search for top-level license, pricing, EULA, deployment, or install artifacts only surfaced `milsymbol/LICENSE`, not a StrikeSim product license, evaluation agreement, pricing sheet, deployment note, or third-party notices file. That leaves a buyer with unresolved questions: Is this open-source, proprietary, evaluation-only, government-purpose-rights, training-only, per-seat, per-site, or services-led?
- Recommendation: Add a minimal go-to-market terms bundle: `LICENSE` or `EVALUATION_LICENSE.md`, `THIRD_PARTY_NOTICES.md`, `PRICING.md` with placeholder bands, and `DEPLOYMENT.md` for offline/static-host use. If the commercial path is not legally settled, label it explicitly as "evaluation package; terms TBD" rather than leaving the repo silent.
- Tradeoffs/risks: Publishing prices too early can anchor negotiations, but having no terms at all makes pilots and subcontractor conversations harder to advance.

### M4-05 — Audience and offer are still ambiguous across training, analysis, and C2 display
- Severity: P2   Impact: 3   Effort: S
- Location: _codex_review/CODEX_PROMPT.md:90; _stark/MORNING_REPORT.md:141-142; StrikeSim2040.html:1536-1542; _stark/START_HERE.md:16
- Observation: The review brief itself names multiple possible target users and surfaces: training aid, analyst planning tool, command-post display, differentiation, compliance, and offline posture (_codex_review/CODEX_PROMPT.md:90). Internal notes also call out "Audience decision (training / analytic / C2)" and vetted/notional scenario decisions as next steps (_stark/MORNING_REPORT.md:141-142), while the app shell currently gives a broad mission brief: "Explore the force network, build an attack plan, then run Monte Carlo risk checks before committing" (StrikeSim2040.html:1536-1542). The repo also notes that the order of battle is realistic but made-up and fine for demos if notional data is acceptable (_stark/START_HERE.md:16).
- Recommendation: Pick one primary wedge for the next package, e.g. "offline training and COA rehearsal sandbox for staff officers using notional UNCLASS data." Then write the landing README, first-run card, demo script, pricing model, and objection handling around that wedge; keep analyst/C2-display claims as future expansion.
- Tradeoffs/risks: Narrow positioning may exclude some use cases, but it makes the demo sharper and reduces classification, ATO, and operational-use objections.

## Quick wins (top 3 high-impact/low-effort)
1. Remove remote Google Fonts and self-host the exact fonts used by the command UI.
2. Add `DEMO.md` with a 7-10 minute verified click path and a preflight checklist tied to known-safe features.
3. Add `EVALUATION_LICENSE.md`, `THIRD_PARTY_NOTICES.md`, and a one-page `DEPLOYMENT.md` for offline/static-server use.

## Open questions for the human review
- Is the next sellable wedge training/rehearsal, analytic planning, command-post display, or dual-use public game?
- Who is allowed to receive a demo package right now, and under what ethics/licensing constraints?
- Should the near-term package be a repo/ZIP evaluation kit, a hosted private demo, or a services-led subcontractor artifact?
- Which P0 issues must be fixed before any external walkthrough, and which features should be hidden from the first pitch?
