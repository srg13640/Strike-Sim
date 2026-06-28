# StrikeSim 2040 Campaign Game Plan

## Intent

Build StrikeSim 2040 into a planner-grade campaign game, not only a target-network
visualizer. The new layer should help an Army or joint planner reason through how a
campaign defeats an adversary at the strategic and operational level: what must be
protected, what must be denied, what allies must carry, and what the defense industrial
base must sustain.

This is an unclassified abstraction. It does not encode real operational plans,
classified intelligence, live order of battle, or targetable recommendations.

## NDS Alignment

The current official National Defense Strategy source used for this design is the
2026 National Defense Strategy PDF published by Defense.gov:
https://media.defense.gov/2026/Jan/23/2003864773/-1/-1/0/2026-NATIONAL-DEFENSE-STRATEGY.PDF

The planner mode translates that strategy into four playable lines of effort:

| NDS line | Game metric | Planning question |
|---|---|---|
| Defend the U.S. homeland | Homeland | Can the campaign absorb attacks on C2, infrastructure, mobilization, and civil resilience? |
| Deter China in the Indo-Pacific | Denial | Can the force prevent a fast adversary fait accompli? |
| Increase ally and partner burden sharing | Allies | Are partners operationally consequential, or just politically supportive? |
| Supercharge the defense industrial base | DIB | Can production, repair, and allocation sustain the campaign after the first salvo? |

## First Implemented Slice

`campaign.js` adds a self-contained Campaign Planner button and panel. The player:

1. Chooses a campaign frame: Indo-Pacific denial, homeland/force-flow resilience, or
   multi-theater opportunism check.
2. Chooses a planner lens: Joint, Army, Navy, Air Force, Marine littoral, or Space/Cyber.
3. Plays through campaign phases with a limited planning budget.
4. Selects initiatives such as partner access, contested logistics rehearsal, DIB surge,
   mission assurance, air/missile defense prioritization, or decision advantage rehearsal.
5. Resolves phase pressure against strategic metrics.
6. Exports a Markdown campaign brief or launches the existing War Game with Blue/Red
   action points and turn length shaped by campaign posture.

## Why This Is The Right Next Layer

The existing War Game is good at simultaneous orders and deterministic replay. It is
not yet good at asking whether the match should be fought under a credible campaign
posture. The campaign layer fills that gap without destabilizing the current map,
3D graph, Monte Carlo, or wargame modules.

For Army planners specifically, the mode foregrounds sustainment, protection, theater
posture, mobilization, contested logistics, and coalition endurance. Other service
lenses change the scoring emphasis while preserving the joint campaign frame.

## Next Increments

1. Persist campaign state as JSON so a planner can stop, resume, and compare COAs.
2. Add an assumptions register for each phase: intelligence assumptions, logistics
   assumptions, policy assumptions, and risk acceptance.
3. Link campaign initiatives to actual scenario nodes by category, not individual
   target recommendations.
4. Add an AAR view that contrasts intended NDS effects against War Game outcomes.
5. Add scenario templates for theater sustainment, homeland resilience, coalition
   access, and defense-industrial-base constraints.
6. Add a red-team campaign AI that stresses Blue's weakest NDS line instead of only
   attacking high-value nodes.
