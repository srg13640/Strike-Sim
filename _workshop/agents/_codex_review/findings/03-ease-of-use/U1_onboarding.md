# U1 — Onboarding & First Run
- Dimension: Ease of Use
- Focus: Onboarding, first-run, discoverability, learnability, and mission framing for a cold operator.
- Files inspected: StrikeSim2040.html; ui.js; _stark/audits/00-MASTER-FIXLIST.md

## Summary
StrikeSim 2040 now has several meaningful onboarding pieces: a first-run intro, visible mission hint text, active view status, keyboard shortcuts, toasts, and an event log. The gap is that these pieces are still mostly descriptive instead of mission-progressive: they tell a new user what the tool is, but they do not anchor the current scenario, walk the user through a complete first COA, or keep the next step obvious after dismissal. The UI also splits the core workflow across multiple panels, which raises the learnability cost for a first-time operator. For an offline/air-gapped tool, first-run polish should also avoid remote dependencies that change the initial visual experience.

## Strengths
- The app includes a proper first-run orientation card with a concise Blue-vs-Red explanation, three starter steps, local dismissal, and a persistent help button.
- The shell exposes persistent context through `view-status`, `mission-brief`, and shortcut hints instead of relying only on modals.
- COA Builder, Monte Carlo presets, success criteria, preview outcome, and goal-plan affordances are already present, so the product has the raw ingredients for a guided workflow.
- `ui.js` centralizes toasts and the event log, which gives future onboarding/checklist work a stable notification surface.

## Findings
### U1-01 — Mission framing is still generic, not scenario-specific
- Severity: P1   Impact: 5   Effort: M
- Location: StrikeSim2040.html:1542; StrikeSim2040.html:3825; StrikeSim2040.html:3827; StrikeSim2040.html:5280
- Observation: The persistent brief says only “Explore the force network, build an attack plan, then run Monte Carlo risk checks before committing” at `StrikeSim2040.html:1542`, while the first-run card labels the app and gives a generic Blue command sentence at `StrikeSim2040.html:3825` and `StrikeSim2040.html:3827`. A concrete objective appears only after generating a COA, where the modal derives “Neutralize [N] high-payoff enemy nodes” at `StrikeSim2040.html:5280`.
- Recommendation: Add a persistent “Current Mission” card above the first operational controls with scenario name, Blue task/purpose, Red intent, victory or success criteria, starting force posture, and the recommended first action. Feed it from scenario metadata so imported scenarios can carry their own mission brief.
- Tradeoffs/risks: This requires agreeing on a small scenario-metadata schema; without that, the brief will become another hard-coded banner.

### U1-02 — First-run orientation is passive and disappears before the task is learned
- Severity: P2   Impact: 4   Effort: M
- Location: StrikeSim2040.html:3828; StrikeSim2040.html:3830; StrikeSim2040.html:3832; StrikeSim2040.html:3835; StrikeSim2040.html:3840
- Observation: The first-run card lists starter steps such as picking a Red target at `StrikeSim2040.html:3828` and running trials at `StrikeSim2040.html:3830`, but the only primary action is “Got it” at `StrikeSim2040.html:3832`. Dismissal stores `strikesim-intro-seen` at `StrikeSim2040.html:3835`, and the recovery affordance is a small `?` button at `StrikeSim2040.html:3840` that reopens the same static intro.
- Recommendation: Convert the intro into a lightweight guided checklist: `1. Pick target`, `2. Generate/apply COA`, `3. Run Monte Carlo`, `4. Preview or brief result`. Each step should focus or open the relevant panel and mark complete based on actual app state.
- Tradeoffs/risks: A checklist adds state management, but it can remain local-only and should not require a framework or bundler.

### U1-03 — The core “build, test, decide” workflow is split across disconnected surfaces
- Severity: P2   Impact: 4   Effort: M
- Location: StrikeSim2040.html:1473; StrikeSim2040.html:1595; StrikeSim2040.html:1600; StrikeSim2040.html:1632; StrikeSim2040.html:1640; StrikeSim2040.html:1774
- Observation: The left rail’s primary panel is labeled “Controls” at `StrikeSim2040.html:1473`, but its visible groups are view/highlight/session actions. The COA entry point is a separate “COA Generator” section at `StrikeSim2040.html:1595`, the builder begins elsewhere at `StrikeSim2040.html:1600`, Monte Carlo is another panel at `StrikeSim2040.html:1632`, the main trial button sits at `StrikeSim2040.html:1640`, and goal planning has another action at `StrikeSim2040.html:1774`.
- Recommendation: Add one top-level “Plan Workflow” strip or pinned right-panel section that presents the canonical path in order: `Generate Goal Plan`, `Apply to COA`, `Run Trials`, `Preview Outcome`, `Open War Game`. Keep the detailed controls where they are, but give new users one obvious mission route.
- Tradeoffs/risks: This duplicates some controls unless the new strip calls existing handlers; avoid introducing separate logic paths.

### U1-04 — The command-bar view switcher uses tablist semantics without a full tab model
- Severity: P2   Impact: 3   Effort: S
- Location: StrikeSim2040.html:1268; StrikeSim2040.html:1269; StrikeSim2040.html:1272; StrikeSim2040.html:2238; StrikeSim2040.html:2240
- Observation: The command-bar switcher declares `role="tablist"` at `StrikeSim2040.html:1268`, but the children are plain buttons such as `3D` at `StrikeSim2040.html:1269` and `TASK ORG` at `StrikeSim2040.html:1272`. The active-state code loops over `#cb-switch button` at `StrikeSim2040.html:2238` and sets only class plus `aria-selected` at `StrikeSim2040.html:2240`, without adding `role="tab"`, `aria-controls`, or roving keyboard behavior.
- Recommendation: Either implement actual tab semantics (`role="tab"`, `aria-controls`, selected tab focus management) or change the container to `role="group"` and expose each button as a pressed view toggle with `aria-pressed`.
- Tradeoffs/risks: Full tab semantics are better for assistive tech but require more careful keyboard behavior; `role="group"` is simpler and probably sufficient for this app.

### U1-05 — Offline-first first run still depends on remote Google Fonts
- Severity: P2   Impact: 3   Effort: S
- Location: StrikeSim2040.html:15; StrikeSim2040.html:16; StrikeSim2040.html:17; StrikeSim2040.html:19; _stark/audits/00-MASTER-FIXLIST.md:69
- Observation: The shell documents that display fonts are loaded from Google Fonts at `StrikeSim2040.html:15` and explicitly says they fall back if offline at `StrikeSim2040.html:16`. It then preconnects to `fonts.googleapis.com` at `StrikeSim2040.html:17` and loads the stylesheet remotely at `StrikeSim2040.html:19`. The master fix list already calls this out as “online-only Google Fonts in an offline-first tool” at `_stark/audits/00-MASTER-FIXLIST.md:69`.
- Recommendation: Vendor the selected WOFF2 files under `vendor/fonts/` and use local `@font-face`, or remove the remote font import and tune the existing fallback stack. Keep all first-run chrome deterministic in air-gapped mode.
- Tradeoffs/risks: Vendoring fonts adds license/package-size review; removing them may require small visual retuning.

## Quick wins (top 3 high-impact/low-effort)
1. Add a top-of-panel “Current Mission” card that states objective, success criteria, and the next recommended action.
2. Change the first-run `Got it` modal into a persistent checklist with buttons wired to existing COA and Monte Carlo handlers.
3. Replace the command-bar `tablist` with either complete tab semantics or a simpler `role="group"` plus `aria-pressed`.

## Open questions for the human review
- Should the default scenario ship with explicit Blue task/purpose and Red intent text, or should that be generated from graph metadata?
- Is “Monte Carlo first” the intended first operator success moment, or should “War Game” become the primary beginner path?
- Should the first-run checklist reset when an imported scenario changes, or remain a one-time product intro?
