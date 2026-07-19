# Tutorial 0.1.1 — Tests That Read Your Source Code (Static Contracts)

*Level: Beginner · Style: Balanced · Concept: contract testing with regular expressions*

## What just happened, in plain words

This release fixed a test that was failing. Nothing in the game was broken — the *test* was out of date. Understanding why teaches you one of the most useful ideas in this codebase: **a test is a promise-checker, and some promises are about the code itself.**

## Two kinds of tests in StrikeSim

Most tests you'll hear about *run* the program and check the result — StrikeSim's "e2e" (end-to-end) checks do this: play a scripted match, then verify a replay reproduces it exactly.

But `tools/online-layer-proof.js` also contains **static contracts**: tests that never run the game at all. They open `director.js` as a plain text file and check that certain lines still say what they're supposed to say. Static = "without running it."

Why would you test *text*? Because some rules live in a single line of code, and that line encodes a security decision. Example rule: *the world seed (the number that makes a match reproducible) must never come from the player — only from a challenge link.* If someone accidentally edits that line, the game still runs fine… but cheating becomes possible. A static contract catches the edit itself.

## The tool: regular expressions

A **regular expression** (regex) is a pattern for matching text, like a super-powered "Find" box. Three symbols cover most of what you'll see here:

- `\s*` — "any amount of whitespace here"
- `\.` — "a literal dot" (an undecorated `.` means "any character," so we *escape* it with `\`)
- `\(` `\)` — literal parentheses, escaped for the same reason

So this contract from the proof:

```js
check('pre-match model stashed for replay payloads (I-4)',
  /op\.startModel = op\.challenge \? null : readPlayerModel\(\)/.test(dir));
```

means: "in the text of director.js (`dir`), the exact phrase `op.startModel = op.challenge ? null : readPlayerModel()` must appear." `.test(dir)` returns true/false, and `check(name, result)` records a pass or fail.

## Why it broke — and why that's the system working

The new two-turn tutorial changed the real line in `director.js` to:

```js
op.startModel = (op.challenge || op.tutorial) ? null : readPlayerModel();
```

Read it aloud: "if this is a challenge **or** the tutorial, use a neutral player model; otherwise use the player's real habits." A sensible change — the tutorial should also be a clean, neutral world. But the old pattern no longer matched the new text, so the proof failed with 46/48. The test was saying: *someone changed a security-relevant line — a human must look.* We looked, the change was good, so we updated the contract to bless the new text:

```js
check('pre-match model stashed for replay payloads (I-4)',
  /op\.startModel = \(op\.challenge \|\| op\.tutorial\) \? null : readPlayerModel\(\)/.test(dir));
```

(`\|\|` is the escaped version of `||`, JavaScript's "or".)

## Pinning the new rules

We also added three *new* contracts so the tutorial's own promises can't silently drift later:

1. The tutorial never ingests a challenge link (`op.challenge = op.tutorial ? null : …`).
2. Its fixed seed `204002` exists in exactly two places: the seed logic, and the BRIEF screen badge that honestly shows it to the player.
3. The "COPY CHALLENGE LINK" button is hidden in tutorials (`!op.tutorial && …`) — training worlds aren't competitive ones.

That last pattern — *make a claim in code, then pin it with a named check* — is the architecture principle at work here (ARCHI.md §19): in this repo, new behavior ships **with** the contract that protects it.

## Performance footnote

Static contracts are nearly free: reading a file and pattern-matching takes milliseconds. That's why the proof runs them first, before the expensive part (real engine matches). Cheap checks first, costly checks last — a pattern worth stealing for anything you build.

## Try it yourself

```bash
node tools/online-layer-proof.js --static   # just the text contracts, instant
node tools/online-layer-proof.js            # everything, incl. real engine fixtures
```

Change one character inside the seed line of `director.js`, rerun the first command, and watch the tripwire fire. (Undo it after!)
