# Owner's Guide — StrikeSim 2040

UNCLASSIFIED // NOTIONAL RESEARCH TOOL

A plain-language guide for the **owner** of this project — no coding required. It answers
the questions a non-developer actually has: *What is this? How do I run it? How do I know
it's safe to hand to someone?*

For the developer/architecture view, see [`README.md`](../README.md),
[`START_HERE.md`](../START_HERE.md), and [`docs/ARCHI.md`](ARCHI.md).

---

## 1. What this is, in one paragraph

StrikeSim 2040 is a **browser-based wargame**. It opens in a normal web browser, runs
**fully offline** (no internet, no login, no server, nothing "phones home"), and lets a
player plan and play out a multi-domain strike scenario. Everything the game needs is
inside this folder.

## 2. How to run it

No installation. You only need a small local web server so the browser will load the
files (opening the file directly can trip browser security rules). Both options below are
already documented in the README:

- **Easiest (Mac):** double-click **`▶ Play StrikeSim 2040.command`**.
- **Manual:** in a terminal, from this folder, run `python3 -m http.server 8000`, then
  open `http://localhost:8000/StrikeSim2040.html`.

First load takes a few seconds while it draws the 3D view. New here? Pick the
**guided tutorial** on the title screen.

## 3. How changes are kept safe

This project has an unusually strong safety culture for a game:

- **Every change is a "change order."** Each meaningful change is written up in
  [`change-orders/`](../change-orders) before it lands, so there's a paper trail of *what*
  changed and *why*.
- **Automated safety checks ("the gates").** A single command runs a battery of checks
  over the game's logic and data. If anything is broken, it fails loudly.

  ```bash
  tools/run-all-gates.sh
  ```

  A green result ends with `ALL GATES GREEN`. These now also run **automatically** on
  every change via GitHub Actions (see [`.github/workflows/gates.yml`](../.github/workflows/gates.yml)).

## 4. What "green gates" does — and does NOT — promise

Think of the gates as a **rigorous logic-and-data inspection**, not a full test drive.

| Green gates DO promise | Green gates do NOT promise |
|------------------------|----------------------------|
| The simulation math and rules pass their contracts | That every screen *looks* right in your browser |
| The scenario data files are valid and consistent | That the 3D view / map render perfectly on all hardware |
| Results are deterministic (same seed → same outcome) | That every button/keyboard path was exercised |

The honest list of what stays **manual** lives in
[`docs/4-unit-tests/COVERAGE-DEBT.md`](4-unit-tests/COVERAGE-DEBT.md). Before handing the
game to someone, the safe recipe is: **gates green + a quick manual play-through** (title
screen → tutorial → run a turn → read the after-action report).

## 5. Is it safe to share? (a quick checklist)

- [ ] `tools/run-all-gates.sh` prints `ALL GATES GREEN`.
- [ ] You did a manual play-through and nothing looked broken.
- [ ] The classification banner still reads **"UNCLASSIFIED // NOTIONAL."**
- [ ] If you built a shareable copy, you used `tools/build-dist.sh` (it refuses to build
      unless the gates are green).

One caution: the game can **import** scenario JSON files. Only import files from sources
you trust, the same way you'd be careful opening any document from a stranger.

## 6. Where things live (the short version)

`START_HERE.md` has the full "four folders" map. The one-line version:

- **The game:** `StrikeSim2040.html` + the loose `.js` files + `assets/`, `vendor/`,
  `scenarios/`. Don't move or rename these.
- **The paperwork:** `change-orders/`, `docs/`, `tools/`, `VERSION`, `README.md`.
- **The workshop:** `_workshop/` — AI/session scratch work; none of it runs the game.

## 7. Current status

- **Version:** see [`VERSION`](../VERSION) (currently a working prototype).
- **Known parked features:** the Campaign Planner launcher is hidden pending a rebuild;
  online features are intentionally switched off for the offline build. These are
  deliberate, not bugs.
