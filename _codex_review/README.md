# _codex_review — StrikeSim 2040 multi-agent review

This folder is the drop zone for an automated, multi-subagent review of StrikeSim 2040.
It is a **read-only assessment** workspace — nothing here changes app code.

## How to run it
Paste **`CODEX_PROMPT.md`** into Codex (or any agent harness that can spawn subagents).
It instructs an orchestrator to spin up **20 specialist reviewers** (4 per dimension) and
then consolidate their reports into `MASTER_CATALOG.md`.

## Review dimensions
1. **Logic** — correctness (Monte-Carlo stats, war-game rules, data/symbology, math)
2. **Functionality** — does it work, robustly, across all surfaces
3. **Ease of use** — onboarding, IA, controls, accessibility, feedback
4. **Look & feel** — design-system consistency, motion taste, data-viz, layout
5. **Marketability** — positioning, differentiation, credibility, go-to-market

## Structure
```
_codex_review/
├── CODEX_PROMPT.md        # paste this into Codex (the directive)
├── README.md              # this file
├── MASTER_CATALOG.md      # orchestrator writes the consolidated, prioritized catalog here
├── _TEMPLATE.md           # the report format each subagent follows
└── findings/
    ├── 01-logic/          # L1–L4 reports
    ├── 02-functionality/  # F1–F4 reports
    ├── 03-ease-of-use/    # U1–U4 reports
    ├── 04-look-and-feel/  # V1–V4 reports
    └── 05-marketability/  # M1–M4 reports
```

## For the human review (you + Claude)
Start with `MASTER_CATALOG.md` → "Top 10" and the consolidated table, then drill into
individual reports under `findings/` as needed. We'll triage from the table into the
next build round.
