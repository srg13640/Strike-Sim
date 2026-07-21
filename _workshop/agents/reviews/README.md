# Persona Reviews

Three role-played review prompts for getting human-flavored feedback on Strike Sim — and
how to chain them. The idea: two very different people kick the tires, and a third person
turns their reactions into an actual to-do list.

## The cast

1. **`persona-1-curmudgeon.md` — "Hank," 52, hates complicated tech.**
   A non-technical usability review. Catches jargon, confusion, friction, and anything
   that quietly doesn't work for a normal person. (If Hank can't use it, lots of people
   can't.)

2. **`persona-2-gamer.md` — "Alex," 17, gamer / math-wiz / coder.**
   A sharp technical + game-feel review. Judges the simulation math, performance,
   controls, the bugs (console errors, broken Geo Mode), and the code itself.

3. **`persona-3-developer.md` — "Dana," senior engineer.**
   Takes Hank's and Alex's reviews and turns them into a prioritized, buildable backlog
   with root causes, effort, and acceptance criteria — resolving the places where "make
   it simpler" (Hank) and "give me more depth" (Alex) pull in opposite directions.

## How to run it

Each prompt tells the reviewer where to save its output. They all land in
**`reviews/output/`**:

1. Run `persona-1-curmudgeon.md` → saves **`reviews/output/review-1-hank.md`**.
2. Run `persona-2-gamer.md` → saves **`reviews/output/review-2-alex.md`**.
3. Run `persona-3-developer.md` → reads both of the above and saves the engineering
   backlog to **`reviews/output/backlog.md`**.
4. Bring `reviews/output/backlog.md` back to your engineer (Claude) to implement and
   verify.

(If a reviewer can't write files, it'll print its output and tell you the exact path to
save it to — same result.)

## Also available

`../REVIEW_PROMPT.md` is a fourth lens: a formal senior-architect technical review
(extraction correctness, the module pattern, offline robustness, test gaps, handoff
readiness) — plus the two specific runtime issues already reported (the ~237 console
errors and Geo Mode doing nothing). Use it alongside the personas for a more
code-focused pass.
