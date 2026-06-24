# Things that bugged me (Hank review)

## What I actually tried

I opened it the easy way first: `Open Strike Sim.command`. It works, but it still feels like I’m expected to know I’m supposed to keep a local server running in the background and wait on a browser page. If a random port is busy, I’d expect a beginner to get stuck pretty fast.

Then I opened the app in Chrome and clicked around like a normal person: first the main controls, then `Map`, `Geo Mode`, `Generate COA`, then down through `COA Builder`, `Simulation`, and `Goal Planner`.

## Things that bugged me

1. **Too much military/math lingo on the first screen**
   - What I tried: Read the page and figure out what I’m looking at before doing anything.
   - What happened: It leads with **MDSC**, **COA**, **cascScore**, and **Monte Carlo** right away. I see `224 nodes · 323 links`, a bunch of domains and methods, and lots of buttons with no “what is this for?” context.
   - Why it bugs me: If I can’t decode the labels in the first 10 seconds, I’m not using it for a real-world task—I’m guessing.
   - What’d make sense: Start with plain language (“Network view,” “Attack plan,” “risk check”) and put a tiny “This screen shows…” line up top before all the heavy words.

2. **I have to hunt for controls; they’re hidden in panels and not obvious to me**
   - What I tried: Clicked the obvious controls on the left side.
   - What happened: The left control panel is mostly hidden until I hover and the right side is packed with sections and buttons. It looks like you’re expected to already know what to use.
   - Why it bugs me: A casual user clicks once and still feels like they’re in an admin panel, not a tool they can use.
   - What’d make sense: Start with one clear control area open (3–4 primary actions), with everything else collapsed by default and clearly labeled.

3. **“Geo Mode” is not understandable at the moment of use**
   - What I tried: Clicked **Geo Mode** expecting a map-style position view.
   - What happened: The button text flips to **Forces On**. No obvious status explanation.
   - Why it bugs me: I can’t tell whether it’s “on,” “off,” “working,” or “I hit the wrong button.”
   - What’d make sense: Use labels like `Geolocation: On` / `Geolocation: Off` and maybe a one-line status line: “Nodes pinned by latitude/longitude: On.”

4. **Map / 3D switching is confusing in text and state**
   - What I tried: Clicked **Map**, then clicked again to return.
   - What happened: The button text flips `Map` → `3D`, which is the only signal anything changed. No strong visual status message.
   - Why it bugs me: I can’t trust whether I’m in the right mode unless I can trust the whole screen changing in an obvious way.
   - What’d make sense: Put the current mode in plain text right under the button (e.g., `Current view: 3D / Map`).

5. **`Generate COA` didn’t feel interactive for me**
   - What I tried: Clicked **Generate COA**.
   - What happened: I didn’t get a clear modal opening step. The same “goal” controls were already visible, but this button didn’t feel like it gave me a separate guided flow.
   - Why it bugs me: If a button is a major action, it should announce something immediate. If it did something, I couldn’t trust that it had done it.
   - What’d make sense: Either remove the button and fold that flow into clearer buttons, or show a clear wizard/step header with explicit “building options…” feedback.

6. **A lot of outputs are advanced even before I know what to do**
   - What I tried: Hit **Generate Goal Plan** and **Run** buttons after a first pass.
   - What happened: It spits out dense result text with percentages and step labels, but there’s still no simple “what does this mean next” guidance.
   - Why it bugs me: I’m left with numbers, not action. It feels like a calculator with no instruction card.
   - What’d make sense: Add one short sentence under each result: “What this means” and a single recommended next step.

## What would make me stop and do this again

I like that the data is packed and the tool seems capable. But for someone who just wants to understand a mission picture without becoming a software trainee, this version is still too much expert-jargon and not enough plain guidance.

**Would I use this again? — Only if somebody fixes the interface language, first-run clarity, and the `Generate COA` interaction so a normal person can tell immediately what just happened.**
