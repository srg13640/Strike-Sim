# CHANGE_ORDER `CO-008` — coaching-module-styling-and-visibility

> Produced 2026-07-20 to address tutorial coaching module visibility and legibility feedback.
> Focus: High-contrast light orange background palette, larger typography, and emoji badge icon.

---

## 1. Gap this closes

The `COMPUTER COACH` module (`.dir-coach` in `director.js`) currently renders with a dark slate-cyan gradient background (`linear-gradient(135deg, rgba(8,57,79,.96), rgba(9,28,42,.96))`). Because StrikeSim 2040 uses a dark tactical HUD background, the current coach card blends into the surrounding interface.

During the tutorial steps (Steps 1 through 5), new operators need immediate visual cueing so that guidance stands out clearly from standard combat feeds. In addition, the body text size (11.5px–12.5px) is small, and there is no iconography to draw visual anchor focus.

This Change Order updates the coaching module styling to feature a **high-visibility light orange / warm amber background**, **larger typography**, and a **coaching emoji icon** (🎓 / 💡).

---

## 2. Industry reference & Design baseline

- **Reference Asset:** `assets/image.png` shows the legacy dark-blue implementation of the tutorial coach panel (*"COMPUTER COACH · STEP 3 OF 5" / "Make an honest forecast before seeing the model."*).
- **Color Palette:**
  - **Background:** High-contrast light orange gradient (`linear-gradient(135deg, #fff7ed, #ffedd5)` or warm tactical light-amber `#ffebd6`).
  - **Border / Inset Accent:** Warm amber border (`#f97316` / `#fb923c`) with an inset left accent stripe (`#ea580c`).
  - **Typography Color:** High-contrast dark amber/brown (`#7c2d12` body text, `#9a3412` bold headings, `#9a3412` step tag — `#c2410c` was rejected in review: ~4.6:1 at 12px fails AAA). Contrast target, stated honestly: **WCAG AA at every rendered size; AAA for body copy** (`#7c2d12` on `#ffedd5` ≈ 9.5:1).
- **Typography Scale:**
  - Step tag: 10px → 12px (letter-spacing: 0.18em)
  - Title heading (`b`): 15px → 17px (dock/feed: 13px → 15px)
  - Body text (`p`): 12.5px → 14px (dock: 11.5px → 13px, line-height: 1.5)
- **Iconography:** Include the 🎓 coaching emoji badge (pinned in review — one glyph only, so proof-script string matches stay unambiguous) in `tutorialCoach(...)` HTML rendering inside `director.js`.
- **Copy dependency (review finding):** the Brief's coach body text says "Follow the **cyan** coach card" — update to "orange" in the same change. The dock divider `rgba(99,220,255,.32)` (cyan) becomes a warm `rgba(234,88,12,.35)`.
- **Scope decision (review finding):** the light card intentionally applies to ALL `.dir-coach` instances (main card, `#dir-dock`, `#dir-feed`) — tutorial guidance should pop everywhere it appears. The dark `.dir-btn` chip remains unchanged and reads clearly on the light card.

---

## 3. Acceptance criteria

- [ ] `.dir-coach` containers use a light orange / warm amber background gradient with high contrast dark text.
- [ ] Border and inset shadow accent styling use warm orange / amber hues (`#f97316`, `#ea580c`).
- [ ] Typography scale for `.dir-coach .step`, `.dir-coach b`, and `.dir-coach p` is increased across main card, `#dir-dock`, and `#dir-feed` contexts.
- [ ] `COMPUTER COACH` header badge includes an emoji icon (e.g., 🎓 `COMPUTER COACH`).
- [ ] Responsive rules (`@media(max-width:760px)`) maintain clean layout without overflow on mobile screens.
- [ ] `node tools/director-ux-proof.js` passes with zero failures.
- [ ] `node tools/wargame-loop-gate.js` returns exit code 0.

---

## 4. Scope

- **MAY touch:**
  - `director.js` (CSS rules for `.dir-coach`, `.dir-coach .step`, `.dir-coach b`, `.dir-coach p`, `#dir-dock .dir-coach`, `#dir-feed .dir-coach`, and HTML builder function `tutorialCoach`).
  - `tools/director-ux-proof.js` (update string checks if exact HTML strings are matched).
- **MUST NOT touch:**
  - Core match logic (`game.js`, `wargame.js`, `engine.js`, `sim.js`, `moe.js`, `red-mind.js`).
  - Scenario JSON definitions or schema files.
  - Public module API signatures (`window.DirectorModule.*`).

---

## 5. Work plan

1. **Review Reference Asset:** Inspect `assets/image.png` for baseline component dimensions and text layout.
2. **Update CSS Styles in `director.js`:**
   - Modify `.dir-coach` to use light orange background (`linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)`).
   - Set border to `1px solid #fdba74` and inset shadow to `inset 4px 0 0 #ea580c, 0 8px 24px rgba(0,0,0,.35)`.
   - Update text colors:
     - `.dir-coach .step`: `#9a3412`
     - `.dir-coach b`: `#9a3412`
     - `.dir-coach p`: `#7c2d12`
   - Increase font sizes across desktop, `#dir-dock`, and `#dir-feed` selectors.
3. **Update HTML Builder in `director.js`:**
   - Modify `tutorialCoach(step, title, body, actionHtml)` to include the emoji indicator:
     `'🎓 COMPUTER COACH · STEP ' + esc(step) + ' OF 5'`
4. **Update Automated Proofs:**
   - Run `node tools/director-ux-proof.js` and update any string match assertions if necessary.
5. **Verify Gate & Visual Inspection:**
   - Execute `node tools/wargame-loop-gate.js`.
   - Launch browser to test tutorial flow (Steps 1 through 5) and verify contrast, font size, and emoji display.

---

## 6. Smoke test

```bash
# 1. Run Director UX Proof script
node tools/director-ux-proof.js

# 2. Run Wargame Loop Gate
node tools/wargame-loop-gate.js

# 3. Launch local server to visually test tutorial coach module:
python3 -m http.server 8000
# Open http://localhost:8000/StrikeSim2040.html
# Click "TUTORIAL" and inspect Step 1 through Step 5 coach cards.
```

Expected output: `director-ux-proof.js` and `wargame-loop-gate.js` exit 0; tutorial coach panel displays in vibrant light orange background with large legible text and 🎓 emoji.

---

## 7. Dependencies

- **Blocked by:** None.
- **Blocks:** CO-009 (soft sequencing block — both change orders edit `director.js`; run CO-008 first and commit before starting CO-009 to avoid same-file merge friction).

---

## 8. One-line invocation

```text
Claude Code:   "Execute change-orders/CO-008-coaching-module-styling.md end-to-end. Follow the work plan exactly."
Codex CLI:     "codex exec --file change-orders/CO-008-coaching-module-styling.md"
Generic:       "Implement the change order in change-orders/CO-008-coaching-module-styling.md, in order, with tests passing."
```

---

## 9. Rollback

`git revert` the commit. The change is strictly visual/CSS and HTML presentation in `director.js`.
