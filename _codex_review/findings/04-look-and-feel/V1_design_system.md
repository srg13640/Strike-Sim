# V1 — Design System Consistency
- Dimension: Look & Feel
- Focus: Palette/type/spacing token consistency and high-contrast coverage in the CSS shell.
- Files inspected: StrikeSim2040.html; _stark/audits/00-MASTER-FIXLIST.md

## Summary
The current CSS has a strong visual direction and a useful first pass at root-level design tokens, especially for the Stark-HUD palette, z-index scale, and affiliation colors. The biggest consistency risk is that those tokens are not yet the only source of truth: legacy CSS, later overhaul overrides, inline JS-injected styles, and component-specific hex values still coexist. High-contrast mode no longer shows the prior `--bg:#0000` typo called out in the master fixlist, but it remains incomplete because many visual surfaces bypass the high-contrast token set. The recommended path is not another redesign; it is consolidation so the existing command-and-control look can be maintained predictably.

## Strengths
- `:root` now contains a recognizable visual system with base colors, Stark-HUD tokens, font-family tokens, z-index scale, and canonical affiliation colors in one visible place.
- The CSS already aliases `--team-blue`, `--team-red`, `--team-green`, and `--team-yellow` to the canonical affiliation palette, which is the right direction for map, HUD, and symbology consistency.
- The later HUD pass uses semantic variables such as `--display`, `--mono`, `--cyan`, `--amber`, `--glass-brd`, and glow tokens across major surfaces instead of pure one-off styling.
- Motion-sensitive users are partially considered through `prefers-reduced-motion` rules for global animation and the ticker.

## Findings
### V1-01 — Offline typography still depends on Google Fonts
- Severity: P1   Impact: 4   Effort: M
- Location: StrikeSim2040.html:15; StrikeSim2040.html:19; StrikeSim2040.html:87
- Observation: The file explicitly says the command-picture fonts are loaded from Google Fonts, then requests Inter, Oswald, Orbitron, and Share Tech Mono from `fonts.googleapis.com`. The design tokens later assign `--mono`, `--display`, and `--ui`, but those intended faces will degrade to local fallbacks in an air-gapped/offline run.
- Recommendation: Vendor the required font files under `vendor/` and replace the remote Google Fonts link with local `@font-face` declarations that feed the existing `--mono`, `--display`, and `--ui` variables.
- Tradeoffs/risks: Adds static assets and a small amount of licensing/admin work, but it preserves the intended look in the exact offline mode the app prioritizes.

### V1-02 — High-contrast mode is tokenized only for part of the interface
- Severity: P1   Impact: 4   Effort: M
- Location: StrikeSim2040.html:956; StrikeSim2040.html:968; StrikeSim2040.html:1003; StrikeSim2040.html:6048
- Observation: `body.high-contrast` overrides core variables and team colors, but many prominent surfaces still use literal colors outside that variable set. The first-run panel hard-codes backgrounds, borders, text, and button colors, while the injected radar/ticker CSS hard-codes placement and colors such as `#6f93ad`, `#ffd36b`, and `#bfe0f2`.
- Recommendation: Add high-contrast coverage variables for surface background, surface border, subtle text, bright text, warning fill, and HUD chrome, then replace hard-coded component colors with those variables. Include a small `body.high-contrast` block for first-run, radar, ticker, DEFCON, and popup states.
- Tradeoffs/risks: Some cinematic styling will become less bespoke, but contrast behavior becomes predictable and testable.

### V1-03 — The canonical affiliation palette is forked by the contrast override
- Severity: P2   Impact: 3   Effort: S
- Location: StrikeSim2040.html:95; StrikeSim2040.html:101; StrikeSim2040.html:968
- Observation: The root comment defines `--aff-friend`, `--aff-hostile`, `--aff-neutral`, and `--aff-unknown` as the canonical affiliation palette, then aliases team colors to those values. High-contrast mode skips the canonical `--aff-*` variables and directly overrides `--team-blue`, `--team-red`, `--team-green`, and `--team-yellow`, creating two places future affiliation styling can diverge.
- Recommendation: In high-contrast mode, override `--aff-friend`, `--aff-hostile`, `--aff-neutral`, and `--aff-unknown` first, then keep the team variables as aliases. Only use direct team overrides for truly team-specific exceptions.
- Tradeoffs/risks: Low implementation risk; the main requirement is checking any JavaScript color helpers that currently assume team-level variables are the only contrast switch.

### V1-04 — Legacy and overhaul CSS layers define the same surfaces twice
- Severity: P2   Impact: 3   Effort: M
- Location: StrikeSim2040.html:307; StrikeSim2040.html:323; StrikeSim2040.html:1024; StrikeSim2040.html:1049
- Observation: The shell defines `body` once with a system font stack and radial background, then redefines `body` later with `var(--ui)` and a different radial background. The command bar is also styled in an earlier block, then restyled later with the HUD/glassmorphism treatment. This makes the active design system depend on cascade order rather than clear component ownership.
- Recommendation: Collapse duplicate rules into a single base layer and a single component layer: keep root tokens first, global element rules second, then one authoritative block for command bar, sidebar, modal, table, map chrome, and HUD overlays.
- Tradeoffs/risks: The cleanup must be mechanical and conservative; deleting the wrong earlier rule could affect older module buttons or hidden modal states.

### V1-05 — Spacing, radius, and type scale are still ad hoc
- Severity: P2   Impact: 3   Effort: M
- Location: StrikeSim2040.html:71; StrikeSim2040.html:116; StrikeSim2040.html:144; StrikeSim2040.html:325; StrikeSim2040.html:1003
- Observation: `:root` has viewport layout tokens like `--side-width` and `--bar-h`, plus font-family tokens, but no spacing scale, radius scale, font-size scale, or density tokens. Components therefore hard-code values such as `padding: 16px`, `gap: 12px`, command-bar `gap: 14px; padding: 0 14px`, and first-run panel `padding: 22px 24px`.
- Recommendation: Add a compact token set such as `--space-1` through `--space-6`, `--radius-sm/md/lg`, `--font-xs/sm/md/lg`, and `--control-h`, then migrate the high-traffic surfaces first: command bar, sidebar cards, modals, COA cards, and first-run panel.
- Tradeoffs/risks: Token migration is easy to overdo; start with shared controls and panels before touching map/SVG-specific geometry.

## Quick wins (top 3 high-impact/low-effort)
1. Change high-contrast mode to override `--aff-*` variables first, then keep `--team-*` aliases intact.
2. Move the first-run panel colors onto existing text/surface/border variables so contrast mode reaches onboarding.
3. Add local `@font-face` declarations for the three HUD font families and remove the remote Google Fonts dependency.

## Open questions for the human review
- Should Oswald remain part of the display voice, or should the app standardize fully on Orbitron for display headings and Inter for UI labels?
- Is high-contrast mode intended as an accessibility mode only, or also as an operator/daylight mode for field projection?
- Should JS-injected HUD styles stay in script for portability, or move into the main CSS block so the design system is easier to audit?
