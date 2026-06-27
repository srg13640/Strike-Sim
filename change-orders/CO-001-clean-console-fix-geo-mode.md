# CHANGE_ORDER `CO-001` — clean-console-fix-geo-mode

> Produced by program-architect 2026-06-26 from PROGRAM_BRIEF `2026-06-26-credible-warfighting-tool.md`.
> This is the credibility floor. Nothing else in the program ships until this passes.

---

## 1. Gap this closes

The app currently floods the browser console with ~237 errors on load, and the **Geo
Mode** button silently does nothing. Both are the single fastest "this is a prototype,
not a tool" signals a reviewer hits. We close both before any visible upgrade work.

## 2. Industry reference

This change has no library to adopt — it's a *quality bar*. Reference points:

- **Bar:** A fresh Chrome / Safari / Firefox window opens `StrikeSim2040.html` and shows **zero red** in DevTools console at idle.
- **Bar:** Every UI button that is wired performs a visible action within ~1 second, or is removed.
- **Industry parallel:** Lattice and Maven both treat a clean console + no silent-no-op buttons as table stakes for a deployable build.

## 3. Acceptance criteria

- [ ] Open `StrikeSim2040.html` cold in Chrome. Console shows **0 errors and 0 warnings** on load. (Info messages OK.)
- [ ] Console shows **0 errors** after 60 seconds of idle (no spurious tile / texture probes firing).
- [ ] Clicking the **Geo Mode** button (a) makes the globe visibly appear, (b) reframes the camera to a Blue-perspective opening shot within 1.5s, (c) shows nodes pinned to lat/lon on the globe surface.
- [ ] Switching from Geo Mode back to graph view and back to Geo Mode again works without errors and without re-throwing the camera.
- [ ] All other UI views (Map, Table, Task-Org) still work as before.
- [ ] All existing scenarios still load (`grokblue90.json`, `grok150red.json`).
- [ ] `node tools/wargame-loop-gate.js` returns exit 0.

## 4. Scope

- **MAY touch:** `engine.js` (globe lifecycle, camera reframe), `map.js` (tile probe — if missing tiles are causing 404s, gate the probe with a HEAD check or stop probing), `StrikeSim2040.html` (any inline script that throws on startup), `assets/` (add missing earth texture if root cause), `inline-datasets.js` (if it 404s on a moved asset).
- **MUST NOT touch:** `campaign.js`, `game.js`, `wargame.js`, scenario JSONs, vendor libraries, public module APIs (`window.<X>Module.<method>` signatures stay identical).
- **Schema changes:** none.

## 5. Work plan

1. **Inventory the console.** Open the app cold in Chrome, capture every distinct error to a list. Bucket them: (a) 404s for missing files, (b) runtime exceptions, (c) deprecation warnings.
2. **For 404s:** for each, decide — vendor the missing asset (e.g. an earth texture) OR gate the request behind a HEAD probe so the absence is silent. The pattern is already in `engine.js` (`fetch-HEAD probe guards the load`); generalize it.
3. **For runtime exceptions:** trace each to file:line, fix in place. No swallow-with-try/catch unless the error is genuinely benign and that's documented inline.
4. **Geo Mode diagnosis:** open `engine.js`, find the globe / earth mesh code (`EARTH_RADIUS`, `earthMesh`). Either the texture probe is failing (and the globe stays invisible) or the camera reframe never fires on the geo-mode toggle. Fix whichever it is. The README says "Geo Mode pins nodes to a globe by lat/lon" — that's the contract.
5. **Add a regression test:** extend `tools/wargame-loop-gate.js` (or add `tools/console-clean-gate.js`) to launch a headless browser (Puppeteer), open the app, count console errors, fail if > 0. Wire it into the existing gate command.
6. **Update the persona-1 (Hank) and persona-2 (Alex) review prompts** in `reviews/` to remove the "237 errors" and "Geo Mode does nothing" calls since those become test-enforced.

## 6. Smoke test

```bash
# In one terminal:
cd "Strike Sim"
python3 -m http.server 8000

# In another:
open http://localhost:8000/StrikeSim2040.html
# Open DevTools (Cmd-Opt-I), Console tab.
# Click Geo Mode.
# Wait 60s.
# Confirm: 0 red errors. Globe visible. Nodes on the globe.

# Or run the gate:
node tools/wargame-loop-gate.js && echo OK
```

Expected: zero console errors; Geo Mode renders the globe with nodes pinned to it; gate exits 0.

## 7. Dependencies

- **Blocked by:** nothing. This is the foundation.
- **Blocks:** CO-002, CO-003, CO-004 (don't refactor on top of a broken baseline).

## 8. One-line invocation

```text
Claude Code:   "Execute change-orders/CO-001-clean-console-fix-geo-mode.md end-to-end. Follow the work plan exactly. Stop after step 5 and show me the gate output before claiming done."
Codex CLI:     "codex exec --file change-orders/CO-001-clean-console-fix-geo-mode.md"
Generic:       "Implement the change order in change-orders/CO-001-clean-console-fix-geo-mode.md, in order, with the smoke test passing before you stop."
```

## 9. Rollback

`git revert` the merge commit. The CO is additive (new console-gate test, asset add) plus surgical fixes — no structural change.
