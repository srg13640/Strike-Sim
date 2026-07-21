# Before reviving this loop

`loop.run.yaml` was written when this trio lived at the project root. If you point a
loop runner at it again, re-anchor these first:

- `sandbox_root: ./loop-runs/…` — still correct **relative to this folder**.
- `gate_cmd: node tools/wargame-loop-gate.js` and `metric_cmd: node tools/…` — the
  `tools/` folder is at the **project root**, two levels up. Either run the loop from
  the project root with paths updated to `_workshop/loop/…`, or change the commands to
  `node ../../tools/wargame-loop-gate.js`.

Dormant since 2026-06-26; archived by CO-010 on 2026-07-20.
