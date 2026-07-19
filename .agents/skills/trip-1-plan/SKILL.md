---
name: TRIP-1-plan
description: Plan a new feature following project standards
argument-hint: "describe the feature you want to build"
---

# Planning Mode

You are now in **planning mode** for **StrikeSim 2040**.

## Prerequisites - Read First

Before creating any plan, you MUST read ALL THE LINES of:

1. @docs/ARCHI.md - Understand current system architecture

## Your Task

Plan the following feature: $ARGUMENTS

---

## Step 1: Discovery & Clarification (Interactive)

**Do NOT start writing a plan immediately.** First, engage in a discovery conversation to fully understand the user's intent.

### 1.1 Initial Understanding

After reading the feature request, summarize your understanding in 2-3 sentences, then **use the `AskUserQuestion` tool** to present clarifying questions with structured options.

Frame questions around:

- **Scope**: What's included vs excluded?
- **Behavior**: How should it work from the user's perspective?
- **Constraints**: Any technical limitations, deadlines, or dependencies?
- **Priority**: What's most important if trade-offs are needed?

For each question, provide 2-4 concrete options based on your analysis of the codebase and the feature request. Always let the user provide custom input via the built-in "Other" option.

After the user answers, proceed **directly to writing the plan** (Step 2) — no approach-confirmation question. Ask a follow-up round with `AskUserQuestion` only if a blocking ambiguity remains (**maximum 3 rounds total**; if still unclear, summarize what you know and proceed with noted assumptions).

---

## Step 2: Plan Document Creation

Once understanding is confirmed, create the plan document.

### File Naming

Depending on the feature (major, minor, patch), propose a new version using SemVer (x.y.z) and create:
`docs/1-plans/F_[version]_[feature-name].plan.md`

### Required Sections

```markdown
# [Feature Name] Implementation Plan

## Overview

[2-4 sentences describing the feature and its purpose]

## Problem Statement (if applicable)

[Current limitations/issues this feature addresses]

## Solution Architecture

[High-level design approach]

## Implementation Details

### 1. [Component/Module/File Name]

**File**: `path/to/file`

[Detailed description of changes needed]

**Current state** (if modifying existing):
[Describe what currently exists]

**Modifications**:

- Specific change 1 (around line X)
- Specific change 2 (around line Y)

### 2. [Next Component/Module/File]

[Continue with same pattern]

## Technical Considerations

- **Pattern Usage**: Which existing patterns to follow (from ARCHI.md — `window.<Name>Module` globals, `Module.init({...})` injection, `AppState.activeGraph()`)
- **Determinism**: Seed-stability of every new mechanic — RNG only through seeded engine paths; repeat runs byte-identical where contracts require; replay/payload compatibility (pre-match `pm` snapshot if Red's model is touched)
- **Resolver Discipline**: No combat/victory math outside `game.js`; forecasts/counterfactuals/replay reuse the one resolver
- **Offline-Complete**: No runtime network; anything network-touching keys off `online-flags.js`; vendored deps only
- **Proof Impact**: Which `tools/*-proof.js` contracts the change touches; whether a new contract is needed; balance-gate exposure for engine-touching work
- **Presentation Boundary**: cinematics/audio read state, never mutate it; reduced-motion (`html.cin-rm`) and perf (`html.cin-perf`) twins for any new visual; no WATCH audio bed
- **Edge Cases**: Empty/malformed scenario data, mid-loop phase transitions, worker unavailability, `file://` context

## Design-Spine Compliance

[Mandatory in every plan. Confirm each line explicitly, with one sentence of justification:]

- [ ] No engine fork — all adjudication stays in `game.js`
- [ ] No new top-level mode — everything enters through the Operation Loop (BRIEF chips for variants)
- [ ] Determinism preserved — seed-stable, replay-safe
- [ ] Offline-complete kept — no network; `online-flags.js` gates anything online
- [ ] No prediction theater — ranges and scored judgment, never single-number claims

## Files to Modify/Create

[Comprehensive numbered list with purposes]

1. `path/to/file1` (modify) - Purpose description
2. `path/to/file2` (new) - Purpose description

## Type Definitions (if applicable)

[New types, interfaces, structs, or modifications to existing ones]

## Performance & Cost Impact (if applicable)

[Expected performance implications]

## Backward Compatibility (if applicable)

[Migration strategy if needed]

## Test Impact

[2-5 bullets: which existing tests the change affects, what new logic will need tests, whether an integration/E2E check applies. No test code — the TRIP-2 testing gate consumes this section.]

## To-dos

### Phase 1: [Phase Name] (if multiple phases are needed) or simply skip title if only one phase is needed

- [ ] Task description
- [ ] Another task

### Phase 2: [Phase Name] (if applicable)

- [ ] Task description
- [ ] Another task

**Note**: For simple plans, a single phase is sufficient. Split into multiple phases only for complex features requiring sequential implementation.

**Note**: Do NOT write test code during planning — the Test Impact section above only names what the TRIP-2 testing gate will run and author.
```

## Quality Standards

- **Zero Ambiguity**: Every step must be clear and actionable
- **File-Level Specificity**: List exact files and functions to modify
- **Architecture Alignment**: Must conform to existing patterns in ARCHI.md
- **Risk Assessment**: Highlight potential failure points

---

## Step 3: Codex Second-Opinion Review

Before the user sees the plan, run the Codex plan review loop.

### Confirm

`AskUserQuestion`: "I'll run Codex as a second-opinion reviewer and iterate until clean. Proceed?"
Options: "Yes, run Codex review" (recommended) / "Skip Codex, go to user review" / "Cap iterations at N"

Skip for trivial plans (single-file, low-risk). Run for non-trivial (new module, schema/algorithm change).

### Loop

1. **Start**: `bash .claude/skills/codex-plan-review/scripts/start.sh --prompt-file .claude/skills/codex-plan-review/prompts/start.tpl <plan-path>`
2. **Parse trailing tag**: `APPROVED` -> Step 4. `NEEDS_REWORK` -> surface to user. `REQUEST_CHANGES` -> continue.
3. **Address findings critically** — quote each P1/P2, push back on incorrect ones, fix legitimate ones by editing the plan in place.
4. **Write implementer notes** (1-3 sentences): which findings you fixed, which you pushed back on and why, any user decisions that override existing docs or environment limitations that can't be resolved in the plan.
5. **Resume** with notes:
   ```bash
   bash .claude/skills/codex-plan-review/scripts/resume.sh \
       --prompt-file .claude/skills/codex-plan-review/prompts/resume.tpl \
       --notes "Fixed X. Pushed back on Y because Z. User decided W." \
       <plan-path>
   ```
   -> back to step 2.
6. **Cap at 5 rounds** (or user-specified). Surface remaining findings and let user decide.

Surface Codex reviews verbatim. Keep edits scoped to findings. Reset thread (`reset.sh <plan-path>`) only if context is genuinely confused.

---

## Step 4: User Review & Validation

After Codex review converges (or is skipped), present a summary to the user including:

- **Feature**: [name]
- **Approach**: [1-2 sentences]
- **Files affected**: [count] files ([list key ones])
- **Estimated complexity**: [simple/moderate/complex]
- **Codex status**: [APPROVED / skipped / capped at N rounds with open findings]

Then **use the `AskUserQuestion` tool** to collect feedback:

- **Question**: "Please review the plan at `docs/1-plans/F_x.y.z_feature-name.plan.md`. How would you like to proceed?"
- **Options**: "Approved" (ready for implementation), "Request changes" (I have modifications), "Needs rework" (significant issues to address)

Handle feedback:

- **If "Request changes"**: Update the plan and re-present. Run another Codex pass if changes are substantive.
- **If "Needs rework"**: Discuss issues, rework the plan, and re-present.
- **If "Other" (custom input)**: Handle accordingly.
- **If "Approved"**: **Use the `AskUserQuestion` tool** to ask:
  - **Question**: "Plan approved. Would you like to start implementation now?"
  - **Options**: "Yes, implement now" (proceed with `TRIP-2-implement` using this plan), "Not yet" (I'll implement later)

---

## IMPORTANT: No Code Implementation

**DO NOT write code snippets or implement anything during planning.**

This is a high-level planning phase only. Your plan should describe:

- WHAT needs to be done (features, changes, structures)
- WHERE changes will happen (files, modules, functions)
- WHY certain approaches are chosen (trade-offs, rationale)

But NOT:

- Actual code implementations
- Detailed algorithm code

Keep it architectural and descriptive. Code comes in the `TRIP-2-implement` phase.

## For New Game Mechanics (engine-touching)

Required analysis:

- Which resolver phase it hooks (order validation, resolution, MOE adjudication)
- Seed/determinism impact — any new RNG draw shifts existing replays and fixtures; flag it explicitly
- Red-mind interaction (doctrine types, level-k/QRE, player-model/exploit-policy exposure)
- Logistics coupling (stocks/routes/DDIL) if the mechanic consumes or produces supply
- Proof contract to add or extend in `tools/`; expected balance-gate shift within the 0.45–0.55 Blue band

## For New UI / Loop-Phase Work

Required analysis:

- Which loop phase it serves (§9 anti-goals: no chrome without a phase, no new top-level modes)
- Module seam: which `window.<Name>Module` owns it; which live getters the shell must inject
- Reduced-motion + perf-mode class twins; audio doctrine (gesture unlock, no WATCH bed)
- Stage Manager (resize) implications; offline-tile fallback behavior if map-touching

## For Scenario / Data Changes

Required analysis:

- Schema impact (`schemas/strikesim-scenario.schema.json`) and `tools/validate-scenarios.js` coverage
- Builder/tagging script updates (`tools/build-*.js`, geocode, geographyClass)
- In-place graph-swap compatibility (BRIEF variant chips)
- Share-payload/replay exposure (does the payload spec carry or reference this data?)

## For Share / Online-Layer Work

Required analysis:

- `online-flags.js` gating (the ONE swappable build file rule; hosted variants stay in `site/`, parked)
- Payload spec versioning and the ONE validator shared by `share.js` intake and `tools/replay-verify.js`
- Fail-silent intake preserved; determinism-as-anti-cheat unbroken (seed + order log + `pm` snapshot)
