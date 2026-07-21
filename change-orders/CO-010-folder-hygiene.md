# CHANGE_ORDER `CO-010` — folder-hygiene

> Produced 2026-07-20. Root-level reorganization: every AI-workshop artifact moves under
> one `_workshop/` folder; the game runtime, paperwork, and websites stay exactly where
> the code expects them. Executed by Claude with reference recon before every move.

---

## 1. Gap this closes

The project root mixed four jobs — game runtime, change-order paperwork, AI-session
artifacts, and websites — into ~55 visible entries. The owner could no longer tell
what to click or what was safe to touch. Runtime files cannot move (loaded by exact
name), so the fix is consolidating everything *non-runtime* into `_workshop/`.

## 2. Reference recon (why each move is safe)

- `.agents/` TRIP skills, root game `.js`, and `schemas/` reference **none** of the
  moved paths (verified by grep before moving).
- `_stark/` was written to by **7** `tools/*.js` proof scripts — those scripts were
  updated in this CO (see §4) and each was **run** post-change to prove the new path.
- `loop.run.yaml` + `loop-runs/` + `loop-specs/` reference each other relatively —
  moved **together** as `_workshop/loop/` with a re-anchor note (dormant since Jun 26;
  `gate_cmd`/`sandbox_root` need re-pointing if the loop is ever revived).
- `docs/ARCHI.md` §4 layout lines updated to match.
- `skills-lock.json` and `.claude/`, `.agents/` stay at root (live workflow anchors).
- `CODEX_HANDOFF-2026-07-11.md` already lives in `change-orders/` — untouched.

## 3. Mapping table (old → new)

| Old (root) | New |
|---|---|
| `_codex_review/`, `reviews/`, `_fable/`, `_CODEX Ideas/`, `_GEMINI Ideas/` | `_workshop/agents/…` |
| `_stark/` | `_workshop/design-proofs/` |
| `_design_explorations/` | `_workshop/design-explorations/` |
| `loop-runs/`, `loop-specs/`, `loop.run.yaml` | `_workshop/loop/…` |
| `sandbox/` | `_workshop/sandbox/` |
| `program-briefs/`, `HANDOFF.md`, `REVIEW_PROMPT.md`, `Janus_Implementation_Plan.md` | `_workshop/briefs/…` |
| `Open StrikeSim 2040.command`, `Open StrikeSim 2040 (Safari).command` | `_workshop/superseded-launchers/…` (replaced by `▶ Play StrikeSim 2040.command`) |

**Not moved (load-bearing):** `StrikeSim2040.html`, every root `.js` (including
`sim-worker.js`), `assets/`, `vendor/`, `milsymbol/`, `scenarios/`, both `grok*.json`
datasets, `tools/`, `docs/`, `change-orders/`, `schemas/`, `site/`, `site-preview/`,
`Matt Olson's project/`, `VERSION`, `README.md`, `START_HERE.md`, `skills-lock.json`.

## 4. Code touched

`tools/console-mockup.js`, `tools/milsymbol-proof.js`, `tools/rings-proof.js`,
`tools/symbol-proof.js`, `tools/taskorg-layout-proof.js`, `tools/taskorg-proof.js`,
`tools/theater-proof.js` — output path `'_stark'` → `'_workshop', 'design-proofs'`.
No game runtime code changed.

## 5. Verification

- All 7 rewired design-proof tools executed successfully post-move.
- `node tools/cofm-proof.js`, `node tools/director-ux-proof.js`,
  `node tools/validate-scenarios.js`, and the **full** `node tools/wargame-loop-gate.js`
  (200-match balance) run natively on the Mac.
- Tracked moves used `git mv` so history follows every file.

## 6. Rollback

`git revert` the commit (moves and tool edits are one commit). Untracked moved items
(`_fable/`, idea folders, `_design_explorations/`, `Janus_Implementation_Plan.md`)
are outside git — drag them back from `_workshop/` if ever needed at root.
