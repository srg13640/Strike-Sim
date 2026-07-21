# Strike Sim — what is all this? (plain-language map)

**To play: double-click `▶ Play StrikeSim 2040.command`.** That's it. It starts the
local server and opens the current game in Safari. (The two older "Open StrikeSim
2040…" launchers do the same job and are safe to ignore or delete.)

## The four things living in this folder

**1. The game itself — do not move these.**
`StrikeSim2040.html` plus every loose `.js` file at the top level (`director.js`,
`game.js`, `cofm.js`, `moe.js`, …) and the folders `assets/`, `vendor/`, `milsymbol/`,
`scenarios/`. The game loads these by exact name and location, so moving or renaming
any of them breaks it. This is why the root looks crowded — it's the engine room.

**2. The paperwork that keeps the game honest.**
`change-orders/` (specs for each change), `docs/` (architecture + model documents),
`tools/` (the automated proof scripts that gate every change), `VERSION`, `README.md`.

**3. The AI workshop — artifacts from Codex/Claude/Gemini sessions.**
`loop-runs/`, `loop-specs/`, `loop.run.yaml`, `sandbox/`, `reviews/`, `_codex_review/`,
`_stark/`, `_fable/`, `_CODEX Ideas/`, `_GEMINI Ideas/`, `program-briefs/`,
`HANDOFF.md`, `CODEX_HANDOFF-*.md`, `REVIEW_PROMPT.md`, `Janus_Implementation_Plan.md`,
`skills-lock.json`. None of this runs the game; it's the workshop's sawdust and
blueprints. Tidying it into one `_workshop/` folder is possible but needs a proper
change order, because some AI workflows write to these exact paths.

**4. The websites (separate projects).**
`site/` and `site-preview/` — the public-site work. `site-preview` is its own Git
project and bundles a *copy* of the game that must be resynced after game changes
(last resync: 2026-07-20, current through CO-009). `Matt Olson's project/` is a
separate collaboration folder.

## House rules learned the hard way

- The game at the root is the source of truth; the website bundle is a copy.
- Every change lands via a change order in `change-orders/` with the proof gates in
  `tools/` green before commit.
- A cleanup/restructure is welcome — as its own change order with a path-mapping
  table, not as a casual drag-and-drop. (Ask Claude or Codex for "CO-010 folder
  hygiene" and reference this file.)
