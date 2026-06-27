# StrikeSim 2040 — Layout / Chrome Inventory (Audit 13)

**Target file:** `StrikeSim2040.html` (~5500 lines) plus JS modules `stage.js`, `wargame.js`, `campaign.js`.
**Date:** 2026-06-27 · **Mode:** read-only audit. No edits made.

**Purpose:** Give an engineer an exact, line-referenced map of the current floating-panel chrome so it can be rebuilt as a clean docked shell. The current layout is *not* a grid/flex shell — it is a full-bleed `position:absolute` canvas under a set of `position:absolute` panels, with a layer of **`position:fixed` buttons injected by JS modules** that float over everything and collide.

---

## 0. Root layout approach (point 7)

There is **no CSS grid or flexbox app shell**. The root is a full-viewport positioned-overlay model:

- `html, body { height:100%; margin:0; padding:0; }` — body `overflow:hidden` (lines 274–284).
- `#app { position: relative; width:100vw; height:100vh; overflow:hidden; }` (lines 286–291). This is the positioning context for the absolute panels.
- The four canvas surfaces (`#graph`, `#map`, `#table`, `#org-chart`) are **`position:absolute; inset:0` with `right:var(--side-width)`** — i.e. each is a full-bleed layer, only inset on the right to leave room for the sidebar. They sit at `z-index:1`.
- `#left-panel` and `#side` are **`position:absolute`** siblings overlaying the canvas, NOT flex/grid children.
- A separate set of action buttons (`#wg-launch`, `#cp-launch`, `#stage-fs-btn`, `#retry-3d-btn`) are **`position:fixed` children of `<body>`** injected by JS at runtime — they are outside `#app`'s box model entirely and are positioned by hard-coded `top/left/right` pixel values that all converge on the same top strip.

**Key variable:** `--side-width: 380px` defined in `:root` (line 71). Body class `right-collapsed` shrinks it to `22px` (line 367). The canvas surfaces read this var for their right inset; `#stage-fs-btn` reads a *different* fallback (`var(--side-width, 360px)`) — note the **360 vs 380 mismatch**.

So: full-bleed canvas + absolute side panels + fixed floating buttons. Rebuild target should be a single CSS grid/flex shell with a real header row and docked rails.

---

## 1. Fixed / absolute chrome elements & the floating top-row buttons (point 1)

### 1a. Floating top-row buttons (all `position:fixed`, injected by JS, children of `<body>`)

These are the overlapping buttons. **None are in the HTML markup — all created at runtime by JS modules and appended to `document.body`.** They all land on the same ~`top:14px` strip:

| Button | id | Defined in | Exact positioning | z-index | Notes |
|---|---|---|---|---|---|
| War Game launch | `#wg-launch` | `wargame.js` line **45** (CSS string), created line **175**, appended to body | `position:fixed; top:14px; left:50%; transform:translateX(-50%)` | **1400** | Dead-center top. |
| Campaign Planner | `#cp-launch` | `campaign.js` line **356** (CSS string), created line **458**, appended body line **460** | `position:fixed; top:14px; left:14px` | **1399** | Top-left corner. Media query `@media (max-width:620px){#cp-launch{top:52px;left:12px}}` (line 361) drops it to a 2nd row only on narrow screens. |
| Fullscreen / Exit Full | `#stage-fs-btn` | `stage.js` line **120** (CSS string), created line **128**, appended body line **133** | `position:fixed; top:14px; right:calc(var(--side-width, 360px) + 14px)` | **1400** | Top-right, offset left of sidebar. Toggles text "⛶ Fullscreen" ↔ "⤢ Exit Full" (lines 112–113). **Uses fallback 360px, but real --side-width is 380px → 20px misalignment vs sidebar edge.** |
| Retry 3D | `#retry-3d-btn` | `StrikeSim2040.html` line **3425** (inline `cssText`), created in `showRetry3dButton()` lines 3417–3431, appended to body line 3429 | `position:fixed; top:14px; left:50%; transform:translateX(-50%); z-index:1500` | **1500** | **Same center slot as `#wg-launch`.** Only shown when 3D fails, but when shown it stacks directly on top of the War Game button (both centered at top:14px). |

**Exact CSS snippets:**

`#wg-launch` (wargame.js:45–49):
```
'#wg-launch{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:1400;',
  'background:linear-gradient(180deg,#15324a,#0d2032);color:#dff1ff;border:1px solid #2c6f9b;',
  'padding:8px 16px;border-radius:8px;font:600 13px/1 system-ui,sans-serif;letter-spacing:.04em;',
  'cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.06);}',
'#wg-launch:hover{...}',
```

`#cp-launch` (campaign.js:356–361):
```
'#cp-launch{position:fixed;top:14px;left:14px;z-index:1399;',
  'background:linear-gradient(180deg,#20351f,#102214);color:#e9ffe7;border:1px solid #4f8a48;',
  'padding:8px 14px;border-radius:8px;font:700 12px/1 system-ui,sans-serif;letter-spacing:.04em;',
  'cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.06);}',
'#cp-launch:hover{...}',
'@media (max-width:620px){#cp-launch{top:52px;left:12px;}}',
```

`#stage-fs-btn` (stage.js:120–124):
```
'#stage-fs-btn{position:fixed;top:14px;right:calc(var(--side-width, 360px) + 14px);z-index:1400;',
  'background:linear-gradient(180deg,#15324a,#0d2032);color:#dff1ff;border:1px solid #2c6f9b;',
  'padding:7px 13px;border-radius:8px;font:600 12px/1 system-ui,sans-serif;letter-spacing:.03em;',
  'cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.4);}',
'#stage-fs-btn:hover{border-color:#4bb8ff;color:#fff;}'
```

`#retry-3d-btn` (StrikeSim2040.html:3425–3427, inline cssText):
```
b.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:1500;' +
  'background:linear-gradient(180deg,#6a3a16,#3f2010);color:#ffe9d6;border:1px solid #b5651d;' +
  'padding:8px 16px;border-radius:8px;font:600 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.5);';
```

**Reparenting note (stage.js:136–149):** `reparentOverlays()` moves `stage-fs-btn`, `wg-launch`, `retry-3d-btn` from `<body>` INTO `#app` before fullscreen so they survive the fullscreen subtree. They remain `position:fixed` so viewport position is unchanged. `#cp-launch` is NOT in that list (it can vanish in fullscreen).

### 1b. Other fixed/absolute chrome (HTML `<style>` block)

| Element | Line | Positioning | z-index |
|---|---|---|---|
| `#fr-help-btn` (floating "?" help) | 959 | `position:fixed; bottom:16px; left:16px` | 1450 |
| `#first-run-card` (orientation overlay) | 947 | `position:fixed; inset:0` | 4000 |
| `.failure-popup` (`#failurePopup`) | 192–199 | `position:fixed` | 10000 |
| `#toast-container` | 225–233 | `position:fixed; top:12px; right:12px` | 50 |
| `.modal-backdrop` | 849–856 | `position:fixed; inset:0` | 20 |
| `.loading` (#graph-loading) | 836–841 | `position:absolute; top:50%; left:calc(50% - 180px)` | 3 |
| `#wg-hud` (War Game drawer) | wargame.js:50 | `position:fixed; top:0; right:0; width:340px; height:100%` | 1390 |
| `#cp-hud` (Campaign drawer) | campaign.js:362 | `position:fixed; top:0; left:0; width:min(430px,...)` | 1392 |

**Overlaps:** `#wg-launch` (center), `#retry-3d-btn` (center, z1500) collide directly; `#cp-launch` (top-left z1399) sits over the left-panel header region; `#stage-fs-btn` (top-right) sits near the sidebar `Collapse` button. All four share the `top:14px` band with no shared container or spacing logic.

---

## 2. LEFT controls panel — Quick Actions / Data I/O / Legend / Event Log (point 2)

- **Container:** `<aside id="left-panel" aria-label="Quick controls">` — HTML markup lines **1174–1230**.
- **CSS:** lines **591–606**.
- **Positioning:** `position:absolute; top:0; left:0; width:340px; height:100%` — an absolute left rail (NOT a grid column).
- **z-index: 4.**
- Collapse: handle `#left-panel-handle` (`.panel-handle`, lines 643–658, z-index 2 within the panel) + `#left-panel-collapse-btn`. Collapsed state `#left-panel.locked-collapsed { transform: translateX(calc(-100% + var(--handle-width))) }` (line 607), `--handle-width:22px`.
- Inner scroller `#left-panel-content` (lines 634–642). Contents: Quick Actions panel (`.left-actions` grid, lines 1185–1201), Data I/O (1202–1208), `#legend` (1210–1217), `#event-log` (1219–1228).

**Exact CSS (591–606):**
```
#left-panel {
  --handle-width: 22px;
  position: absolute;
  top: 0; left: 0;
  width: 340px; height: 100%;
  background: linear-gradient(180deg, rgba(10,15,20,.95) 0%, rgba(10,15,20,.98) 100%);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column;
  overflow: hidden;
  z-index: 4;
  transform: translateX(0);
  transition: transform 0.2s ease;
}
```

---

## 3. RIGHT sidebar — #side (point 3)

- **Container:** `<aside id="side">` — HTML markup lines **1233+** (Team Summary, Team Resources, Search, Filters, COA, Monte Carlo inside `#side-content`).
- **CSS:** lines **380–396**.
- **Positioning:** `position:absolute; top:0; right:0; width:380px; height:100%`.
- **z-index: 3.** (Lower than the left panel's 4.)
- Collapse: `#side.collapsed { transform: translateX(calc(100% - var(--handle-width))) }` (line 396, `--handle-width:22px` line 382). Handle `#right-panel-handle` markup line 1234; `body.right-collapsed { --side-width:22px }` (line 367) reclaims canvas width.
- Inner scroller `#side-content` (lines 438–446).

**Exact CSS (380–396):**
```
#side {
  --handle-width: 22px;
  position: absolute;
  top: 0; right: 0;
  width: 380px; height: 100%;
  background: linear-gradient(180deg, rgba(10,15,20,.95) 0%, rgba(10,15,20,.98) 100%);
  border-left: 1px solid var(--border);
  display: flex; flex-direction: column;
  overflow: hidden;
  z-index: 3;
  transition: transform 0.2s ease;
}
#side.collapsed { transform: translateX(calc(100% - var(--handle-width))); }
```

**Note:** width is hard-coded `380px` here but the canvas inset uses `var(--side-width)` (also 380, line 71). The `#stage-fs-btn` uses `var(--side-width, 360px)` fallback — keep these unified in the rebuild.

---

## 4. NODE-DETAIL panel — the one that bleeds over the left controls (point 4)

There are **two distinct "detail" surfaces** — do not confuse them:

### 4a. `#node-popup` — THE overlapping panel (Strike / Save Resources / Close, Vulnerabilities, Coords)
- **id:** `#node-popup` — empty container in markup at line **994** (`<div id="node-popup" role="dialog" aria-live="polite"></div>`), a direct child of `<body>`, before `#app`.
- **CSS:** lines **256–268**.
- **Positioning:** `position: absolute; min-width:220px; max-width:320px`.
- **z-index: 6.**
- **Rendered/positioned by JS:** `showNodePopup()` (lines 1828–1857) fills it with Team/Type/Health/Difficulty/Vulnerabilities/Coords/Resources + Strike/Save Resources/Close buttons (innerHTML at 1837–1855). Positioned by `updateNodePopupPosition()` (lines 1813–1826).

**Exact CSS (256–268):**
```
#node-popup {
  position: absolute;
  min-width: 220px;
  max-width: 320px;
  background: rgba(15,23,32,0.95);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.35);
  z-index: 6;
  display: none;
  pointer-events: auto;
}
```

**WHY it overlaps the left controls** (positioning logic, lines 1813–1826):
```
const coords = graphInstance.graph2ScreenCoords(node);   // node's projected screen X/Y
const left = rect.left + coords.x + 12;                   // anchored to node, +12px
let top  = rect.top + coords.y - pop.offsetHeight / 2;
pop.style.left = Math.max(margin, Math.min(left, window.innerWidth - pop.offsetWidth - margin)) + 'px';
pop.style.top  = Math.max(margin, Math.min(top,  maxTop)) + 'px';
```
The popup is anchored to the selected node's **projected screen position** and clamped **only to the viewport edges** (`margin = 8px`). It has **zero awareness of the left-panel's 340px footprint**. When a selected node projects near the left edge of `#graph` (which itself starts at `left:0`, underneath the left-panel), the popup is placed at small X values — landing directly on top of the Quick Action buttons. Compounding it: **`#node-popup` z-index:6 > `#left-panel` z-index:4**, so it renders *above* the controls instead of being pushed aside or clipped. Net cause = node-anchored absolute positioning + viewport-only clamping + higher z-index than the left rail.

### 4b. `#details` — the in-sidebar "Selected Node Details" card (NOT floating)
- **id:** `#details` — markup lines **1508–1524** (inside `#side`); CSS lines **543–550**.
- `position:` static — it is a normal flow child of the sidebar (`flex: 0 0 auto`), not floating. Contains `#d-title`, `#details-content`, `Strike Node` (`#neutralize-btn-main`), Neighbors, Strike Log. This one does NOT overlap anything; it lives docked in the right rail.

---

## 5. Main canvas containers — #graph / #map / #table / #org-chart (point 5)

All four are **`position:absolute`, full-bleed, inset on the right by the sidebar width**, stacked at `z-index:1`. Only `#graph` is visible by default; the others are `display:none` and toggled.

| Surface | Lines | Positioning |
|---|---|---|
| `#graph` (3D) | 294–300 | `position:absolute; left:0; top:0; right:var(--side-width); bottom:0; z-index:1` |
| `#map` | 304–312 | `position:absolute; left:0; top:0; right:var(--side-width); bottom:0; display:none; z-index:1` |
| `#org-chart` | 323–333 | `position:absolute; ...right:var(--side-width)...; display:none; z-index:1; overflow:auto` |
| `#table` | 356–365 | `position:absolute; ...right:var(--side-width)...; display:none; z-index:1; overflow:auto` |

```
#graph { position:absolute; left:0; top:0; right:var(--side-width); bottom:0; z-index:1; }
```

**Implications for rebuild:** the canvas left edge is `left:0`, so it slides UNDER the left-panel (the left-panel overlays it, not docks beside it). There is no left inset equivalent to `right:var(--side-width)` — a rebuild into a docked shell should give the canvas both a left and right inset (or make it the center cell of a 3-column grid) so the rails dock rather than overlay.

---

## 6. Full z-index scale currently in use (point 6)

Every `z-index` value found, with its owner (grep across HTML + the JS module strings):

| z-index | Owner | Source / line |
|---|---|---|
| 1 | canvas surfaces `#graph`/`#map`/`#org-chart`/`#table`; `#side header`; `#side-content` sticky; `.sticky-actions`; `#left-panel header`; `#left-panel-content` sticky | HTML 300, 311, 330, 363, 410, 570, 619 |
| 2 | `.panel-handle`; event-log header sticky | HTML 653 |
| 3 | `#side` sidebar; `.loading` | HTML 393, 841 |
| 4 | `#left-panel` left rail | HTML 603 |
| 6 | `#node-popup`; Leaflet `.leaflet-top/.leaflet-bottom` | HTML 265, 753 |
| 10 | `.compass-control`; `.basemap-status` (Leaflet map controls) | HTML 677, 694 |
| 20 | `.modal-backdrop` | HTML 856 |
| 50 | `#toast-container` | HTML 233 |
| 1390 | `#wg-hud` (War Game drawer) | wargame.js:50 |
| 1392 | `#cp-hud` (Campaign drawer) | campaign.js:362 |
| 1399 | `#cp-launch` (Campaign Planner button) | campaign.js:356 |
| 1400 | `#wg-launch` (War Game button) AND `#stage-fs-btn` (Fullscreen) — **tie** | wargame.js:45, stage.js:120 |
| 1450 | `#fr-help-btn` (help "?") | HTML 959 |
| 1500 | `#retry-3d-btn` | HTML 3425 |
| 1500 | (legacy) inline `b.style.cssText` toast/badge variant at HTML:3425 (same value) | HTML 3425 |
| 4000 | `#first-run-card` | HTML 947 |
| 10000 | `.failure-popup` | HTML 199 |

**Observations for designing a new coherent scale:**
- Two huge gaps: 50 → 1390, and 4000 → 10000. The 1390–1500 cluster is the "floating chrome" band; everything in it was hand-picked per-module with no shared token.
- **z-index collision:** `#wg-launch` and `#stage-fs-btn` both at 1400; `#retry-3d-btn` at 1500 stacks over `#wg-launch` in the same center slot.
- **Inverted rail order:** left-panel (4) is ABOVE right sidebar (3) — arbitrary.
- `#node-popup` (6) > `#left-panel` (4) is the direct enabler of the node-detail overlap (see §4a).
- Suggested rebuild tokens: `--z-canvas:0`, `--z-rail:10`, `--z-popup:20`, `--z-header-bar:30`, `--z-drawer:40`, `--z-modal:50`, `--z-toast:60`, `--z-firstrun:70`, `--z-critical:80` — and put ALL top-row buttons into one fl/grid header bar at a single z so they can't collide.

---

## Summary of root problems

1. **No app shell.** Everything is absolute/fixed over a full-bleed canvas; the rails overlay the canvas rather than dock beside it (canvas `left:0`, §5).
2. **Four independent fixed buttons share one top strip** with hard-coded `top:14px` and no shared container (§1a): `#cp-launch` left, `#wg-launch`+`#retry-3d-btn` center (colliding), `#stage-fs-btn` right.
3. **Node-detail (`#node-popup`) is node-anchored + viewport-clamped + z-index 6 > left-panel 4**, so it lands on and renders above the Quick-Action buttons (§4a, lines 1813–1826).
4. **Width-token drift:** `--side-width:380px` vs `#stage-fs-btn`'s `var(--side-width,360px)` fallback vs hard-coded `width:380px` on `#side` (§3).
