# Engineering Handoff — Strike Sim (MDSC 3D Network Visualizer)

> Paste this into an LLM that has read/write access to this repository. You are taking
> over implementation of a prioritized backlog. Another engineer (the original author of
> this code, "Claude") will **review your work afterward and correct anything wrong**, so
> your job is to make correct, verifiable, well-documented changes — not to be clever.

---

## 1. Your mission

Work the remaining backlog in `reviews/output/backlog.md`, plus two image-wiring tasks
(below). Make focused, verified changes. After each change, record what you did in a
worklog (Section 6) and commit it. The reviewing engineer will pull your commits and the
worklog, verify each in a real browser, and fix anything you got wrong.

**Baseline commit:** `80ec99c` (run `git log` to see history). Branch: `main`.

## 2. Orient yourself first (read before editing)

- `README.md` — what the app is, how to run, the architecture and conventions.
- `reviews/output/backlog.md` — the prioritized backlog (Dana's triage of two persona
  reviews). This is your task list. `reviews/output/review-1-hank.md` and
  `review-2-alex.md` are the source reviews (user-experience + technical).
- The code: `DST2040.HTML` is the shell (markup, styles, orchestration, the COA UI, and
  the deeper simulation engine). Modules: `state.js` (AppState), `ui.js` (UiModule),
  `sim.js` (SimModule), `map.js` (MapModule), `engine.js` (EngineModule), `views.js`
  (ViewsModule), `inline-datasets.js` (auto-loader).

**How to run / verify:** it's a no-build static app. Serve it and open in a browser:
`python3 -m http.server 8000` then open `http://localhost:8000/DST2040.HTML`. Wait ~5s
for the graph to settle. Open DevTools console — **a correct change leaves the console
clean** (only one benign "Multiple instances of Three.js" warning is acceptable).

## 3. Non-negotiable constraints (do not violate)

1. **No build step, no framework, no bundler.** Plain `<script>` modules only. It must
   run from a static file server with no tooling.
2. **Fully offline.** `OFFLINE_MODE = true`. No remote fetches at runtime, no CDN links.
   Only relative-path requests (which bypass the offline check) are allowed.
3. **No console errors.** If your change requests a file that may be absent, probe with
   `fetch(url, {method:'HEAD'})` first (a 404 there is silent) — never let an `<img>` or
   `TextureLoader` hit a missing URL (that logs a console error).
4. **Don't break the working app.** Verify every change in a browser. The 3D graph, geo
   mode, map, table, and task-org views all currently work — keep them working.
5. **Module pattern:** modules attach `window.<Name>Module` and **alias their public
   methods onto the original global names**; shared script-scoped state is injected via
   `Module.init({getX})`. Follow this pattern; don't introduce a different architecture.

## 4. What is ALREADY DONE — do NOT redo these

These backlog items and issues are fixed and committed. Read the commits if unsure.

- **M-01 console-error flood** — DONE (`57b26fa`). `map.js` uses a canvas blank-grid
  layer (zero network) + a `fetch`-HEAD tile probe. `engine.js` no longer force-loads a
  texture.
- **M-01b Geo Mode visibility** — DONE (`57b26fa`). Procedural globe + camera reframe.
- **M-02 view-mode status line** — DONE (`0d872ed`). `#view-status` header badge.
- **Datasets geocoded** — DONE (`59989c3`). All 224 nodes have lat/lon (was ~40). See
  `tools/geocode-datasets.js`. Geo mode now shows the real West Pacific theater.
- **Map offline vector basemap** — DONE (`496a09a`). `assets/land.geojson` (clipped
  Natural Earth coastlines) drawn as vectors. Map mode shows real geography offline.
- **Marker occlusion** — DONE (`0f352f0`). Land is in a `basemapPane` (z 250) below the
  markers.
- **Globe photo-texture support** — DONE (`80ec99c`) but see Task A below: the code
  probes for `assets/earth.jpg`, which does NOT match the file the user actually added.

## 5. NEW assets the user just added (in `assets/`)

- `earth-blue-marble-2048.png` — 2048×1024 equirectangular world image (for the globe).
- `earth-blue-marble-indopac-3072.jpg` — 3072×3072 Indo-Pacific satellite (for the map).

### Task A — point the globe texture at the real file
`engine.js` `EARTH_TEX_URL` is `'assets/earth.jpg'`, but the file is
`assets/earth-blue-marble-2048.png`. Update it so geo mode shows the photo-Earth globe.
**Verify:** enter Geo Mode → the globe shows real continents; console clean.

### Task B — use the Indo-Pacific satellite as the map basemap
Add an `L.imageOverlay(url, bounds)` of `assets/earth-blue-marble-indopac-3072.jpg` in
`map.js` (in the `basemapPane`, beneath markers), so Map mode shows satellite terrain.
The hard part is **georeferencing**: you must find the image's geographic bounds
(`[[south, west], [north, east]]`) so its coastlines line up with the existing vector
coastlines and the unit markers. Estimate bounds, then **verify alignment visually** in
the browser (the satellite coastline must sit under the vector coastline) and adjust
until they match. Keep the vector `land.geojson` as a fallback if the image is absent
(probe with fetch-HEAD). If you cannot get clean alignment, leave it OFF and note that in
the worklog for the reviewer — a misaligned basemap is worse than none.

## 6. Remaining backlog — priority order

Do them top-down. For the ones marked **VERIFY**, confirm the claim against the actual
code before changing anything (the reviews were written by an LLM and may be wrong).

1. **Task A** (globe texture filename) — trivial, do first.
2. **Task B** (satellite map basemap) — moderate; alignment is the work.
3. **M-03** — keep Geo Mode pinned after a filter/data refresh, and add a geospatial-fit
   branch to `resetView()` for geo mode. (Today, changing filters in geo mode can lose
   the pinning.)
4. **P-01 / P-02 / P-03** (UX, from Hank) — plain-language labels + a short first-screen
   explainer; sensible default panel state; clearer "Generate COA" flow. Use *progressive
   disclosure* (simple by default, depth on demand) — see backlog's conflict-resolution.
5. **P-05** — keyboard shortcuts + a small hotkey legend (from Alex).
6. **P-04** — a plain-language "what this means" line on simulation/COA results.
7. **M-08 (VERIFY)** — confirm whether `findBestGoalPlan` is a real beam search or a
   sampler; if a sampler, rename the user-facing label honestly. Code only; low risk.
8. **M-05 / M-06 (VERIFY, then careful)** — only if you first confirm there really are two
   Monte Carlo code paths with different RNG. M-06 (Web Worker) is a perf change; keep the
   math identical.

### Do NOT attempt (flag for the reviewer / product owner instead)
- **M-04** (extract the deep simulation engine into a module) — this is reserved for a
  separate "Project Janus" effort and needs domain validation. Leave it.
- **M-07** (replace the global-alias module pattern) — this fights the no-build constraint
  in Section 3. Do not rip it out. Note any specific brittleness you see, but leave the
  pattern in place.

## 7. How to record your work (so it can be reviewed)

Create/append `reviews/output/handoff-worklog.md`. For EACH item you touch, add:

```
### <backlog id> — <short title>
- Status: done / partial / skipped (why)
- Files changed: <files>
- What I did: <1–3 sentences>
- Verified: how (browser steps + result), or "not verified — reason"
- Risks/notes for reviewer: <anything you're unsure about>
- Commit: <hash>
```

Then **commit each change separately** with a clear message (the existing history is one
commit per fix — match that). If you cannot commit, at least leave the worklog + a clean
working tree so the reviewer can read `git diff`.

## 8. Definition of done (per item)
- The app still loads and the 3D/geo/map/table/org views all still work.
- Console is clean (one benign Three.js warning max).
- You verified the specific behavior in a browser and wrote how in the worklog.
- The change respects every constraint in Section 3.

When you're done, summarize what you completed, what you skipped and why, and hand back to
the reviewing engineer.
