# Project Janus Integration: Bounded Rationality in the Simulation Engine

Based on the review of the current `DST2040.HTML` codebase, we currently utilize a `simulateTrial` function within our Monte Carlo logic. While it features nascent variables like `fatigueRate` and `intelNoise`, the simulation fundamentally operates on algorithmic optimization (e.g., `pickRedTargetFromState` searches for the mathematically best move). 

To incorporate **The Janus Paradigm**, we must transition this deterministic logic into a stochastic, human-centric model. Here is the architectural roadmap for Claude to execute the **Phase 1: Stochastic Sandbox**.

## User Review Required

> [!IMPORTANT]
> **Data Integration Strategy**
> The Janus document mentions integrating with Palantir Vantage for live readiness data (Class III/V supply levels, human capital health). Until we have a live API hook, do you approve of hardcoding these logistical constraints and fatigue scalars into our mock datasets (`grok150red.json`/`grokblue90.json`)?

## Open Questions

> [!WARNING]
> **Blunder Manifestation**
> How should "Algorithmic Blunders" be visually represented to the operator? Should a unit that commits a logistical blunder due to cognitive friction be flagged in the Event Log, or should its node visually degrade (e.g., turn amber/gray) on the 3D map?

## Proposed Changes

### 1. State Module Expansion (`state.js`)
We need to extend the scenario state to include Human Capital and Logistical Readiness.
#### [MODIFY] `state.js`
- Inject a `ReadinessState` object for each faction.
- Track variables: `fatigueLevel` (0.0 to 1.0), `supplyClassIII` (Fuel/Mobility), and `supplyClassV` (Ammunition/Lethality).

### 2. The Stochastic Sandbox: Blunder Modeling (`DST2040.HTML` / Future Engine Module)
Modify the core Monte Carlo loop to simulate cognitive friction.
#### [MODIFY] `DST2040.HTML`
- **Modify `simulateTrial()`:** Instead of allowing the Red agent to always pick the highest payoff target, introduce a `cognitiveFriction` scalar. 
- **Implement Proficiency Scaling:** If `fatigueLevel` is high and `supplyClassIII` is low, force the `pickRedTargetFromState()` function to occasionally ignore optimal logic and select targets randomly or skip turns (simulating paralysis or over-extension).
- **Implement Friction Point Identification:** Track the exact turn/step in the Monte Carlo loop where a faction’s logistical deficit causes a systemic failure, and record this threshold.

### 3. UI and Analytical Synthesis
Surface the new stochastic variables in the simulation panels.
#### [MODIFY] `DST2040.HTML`
- Add a "Friction Point Threshold" metric to the `.monte-carlo-panel`.
- Expose sliders for "Adversary Fatigue" and "Logistical Readiness" so the operator can stress-test the Red force dynamically before running the simulation.

## Verification Plan

### Automated Tests
- Run `runMonteCarlo(1000)` with `fatigueLevel = 0` and verify the Red force behaves deterministically/optimally.
- Run `runMonteCarlo(1000)` with `fatigueLevel = 0.9` and assert that the variance in Red force targeting increases by at least 40%, reflecting cognitive blunders.

### Manual Verification
- Deploy to the local preview. Set Red fatigue to maximum and run the simulation. The event log should populate with specific blunder events (e.g., "Red Command paralyzed due to cognitive load").
