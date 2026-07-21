# Single-Shot Design-Exploration Prompt — StrikeSim

**Purpose.** Generate fresh, *divergent* look-and-feel prototypes of the StrikeSim analyst / C2
wargame tool — each a single self-contained `.html` file — by running the prompt below in a
**fresh context** ("new window") with a distinct aesthetic *seed*, so the result isn't anchored
to the current dark-cyan HUD. Run once per seed; compare side by side.

---

## THE PROMPT (paste into a fresh model/agent context)

You are a senior product designer **and** front-end engineer. In **one shot**, produce a **single
self-contained `.html` file**: a high-fidelity **design prototype** of a multi-domain
strike-planning and command-and-control (C2) wargame tool for defense analysts. The bar is a
beautiful, cohesive, *intentional* visual identity with realistic mock content. Functionality may
be light (view switching, hovers, a faux "generate"); it must **feel** like a real product.

**Hard constraints**
- One file. Inline all CSS + JS. Inline mock data. **No build, no server** — it must open by
  double-click. Google Fonts via CDN is allowed; otherwise self-contained (inline SVG fine). No
  frameworks required.
- Data is **NOTIONAL // UNCLASSIFIED**. Scenario: Indo-Pacific, a **Taiwan invasion-denial**
  problem — Blue (US/allies) vs Red (PLA). Show a persistent classification marking. Never imply
  real/operational data.
- Target ~1280–1680px; degrade gracefully. Mind contrast and focus states.
- **Clean room:** design from this brief only. Do **not** read the existing project files, and do
  **not** reproduce a dark cyan "Iron-Man HUD" — explore a genuinely different feeling.

**Represent ALL of these, composed in YOUR design language**
1. **Command bar** — product identity; view switcher (Force Graph · Map · Table · Task Org); global
   actions (Campaign Planner, War Game); live status (theater/sector, UTC clock, a posture / alert
   indicator); classification marking.
2. **Hero battlespace view** — either a Blue-vs-Red **force-network graph** (nodes + links) or a
   **geographic command picture**; render at least one convincingly with inline SVG/Canvas. Use
   military-symbol-style markers distinguishing friendly / hostile / neutral and domains
   (land/air/sea/space/cyber).
3. **Left rail** — filters (domain, team), highlight toggles, data import/export, a legend, and a
   live event/log feed.
4. **Right rail** — team summary; a **COA (course-of-action) Builder**; and the centerpiece, a
   **Monte Carlo / Denial-MOE results** panel. It must show a headline "**denial achieved /
   chance of success**" with a 95% confidence interval, plus an **effect breakdown** — e.g. Red
   amphibious throughput reduced to *X%* of capacity, operational viability (OSVI) *Y%*, operation-
   halts probability — and a "**Generate COA from Commander's Intent**" control with a
   capability↔cost emphasis.
5. **The conceptual frame**: success is a **Measure of Effectiveness** — the adversary's operation
   is **halted / culminates** (Strategy of Denial) — *not* a body count.

**Design ambition**
- Choose a **strong, distinctive, cohesive** identity: a typography pairing, a deliberate color
  system, a spacing scale, iconography, a data-viz style, and tasteful micro-interactions. Make
  bold, intentional choices. Surprise me.
- Hand-craft charts/gauges (SVG/Canvas/CSS); make the denial metrics legible and elegant.

**Deliver:** the single `.html` file, with a 2–3 sentence design rationale in an HTML comment at
the very top.

---

## Variant seeds (run once each, fresh context)

- **A · Terminal-Pro / Analyst Light** — precise, data-dense analyst workstation; light/warm-neutral
  base; humanist sans + a monospace for all numerics/IDs; tight grid, hairline rules, one restrained
  accent. Bloomberg-terminal-meets-Apple. Rigor over flash.
- **B · Situation Room / Cartographic** — map-forward command picture; deep navy or muted
  slate/parchment cartography; NATO/APP-6 *muted* symbology (no neon); graticules, subtle topo
  texture; classic gravitas — "the wall of a JOC."
- **C · Phosphor / Retro-CRT C2** — a tastefully reimagined 1980s NORAD command post; monochrome
  amber **or** green phosphor on near-black; vector line-art; optional *subtle* scanline/curvature;
  monospaced readouts. Distinctive retro-futurism, not cliché.
- **D · Modern Product / Editorial Dashboard** — 2025 SaaS-grade (Linear / Vercel / Notion / Stripe
  sensibility); soft rounded surfaces, refined neutral palette + one confident accent, elegant
  whitespace and charts; light-mode primary with an optional dark toggle; data-journalism polish.
- *(Or invent an entirely new direction.)*
