#!/bin/bash
# =============================================================================
#  run-all-gates.sh — THE single entry point for "is this safe to commit?"  [CO-012]
#
#  Replaces the documented one-liner loops, which used `|| break`. `break` returns 0,
#  so those loops reported SUCCESS even when a proof failed. Every gate here is
#  accumulated into an explicit failure list and the script exits non-zero if any
#  gate fails. Never reintroduce `|| break`.
#
#  Usage:
#    tools/run-all-gates.sh              # standard pass (skips the ~15 min balance gate)
#    tools/run-all-gates.sh --full       # adds wargame-loop-gate.js (slow, engine work)
#
#  Report-only scripts (no assertions, always exit 0) are deliberately EXCLUDED so they
#  cannot pad the green count: milsymbol, rings, taskorg, taskorg-layout, theater.
#  Dataset-rewriting generators are never run here.
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

FULL=0
[ "${1:-}" = "--full" ] && FULL=1

FAILED=()
PASSED=0

run() { # run <label> <cmd...>
  local label="$1"; shift
  printf '  %-34s ' "$label"
  if out=$("$@" 2>&1); then
    printf 'PASS\n'; PASSED=$((PASSED + 1))
  else
    printf 'FAIL (exit %s)\n' "$?"
    printf '%s\n' "$out" | tail -12 | sed 's/^/        | /'
    FAILED+=("$label")
  fi
}

echo "=== syntax gate ==="
syntax_bad=0
for f in *.js tools/*.js; do
  node --check "$f" >/dev/null 2>&1 || { echo "  SYNTAX FAIL: $f"; syntax_bad=$((syntax_bad + 1)); }
done
if [ "$syntax_bad" -eq 0 ]; then
  echo "  all files parse                   PASS"; PASSED=$((PASSED + 1))
else
  FAILED+=("syntax gate ($syntax_bad file(s))")
fi

echo
echo "=== proof contracts ==="
SKIP_RE='(milsymbol|rings|taskorg|taskorg-layout|theater)-proof\.js$'
for p in tools/*-proof.js; do
  [[ "$p" =~ $SKIP_RE ]] && continue
  run "$(basename "$p" .js)" node "$p"
done

echo
echo "=== data contracts ==="
run "validate-scenarios" node tools/validate-scenarios.js

echo
echo "=== determinism: locale invariance (CO-012) ==="
# The resolver must not depend on host ICU collation. lt/lv collate the shipped node-id
# vocabulary differently from en-US; identical seeds must still produce identical results.
en=$(LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 node tools/wargame-loop-eval.js --matches 3 --seed-base 11 2>&1 \
       | sed 's/"elapsed_ms":[0-9]*//')
lt=$(LC_ALL=lt_LT.UTF-8 LANG=lt_LT.UTF-8 node tools/wargame-loop-eval.js --matches 3 --seed-base 11 2>&1 \
       | sed 's/"elapsed_ms":[0-9]*//')
printf '  %-34s ' "en-US vs lt-LT identical"
if [ "$en" = "$lt" ]; then
  printf 'PASS\n'; PASSED=$((PASSED + 1))
else
  printf 'FAIL\n'
  echo "        | en-US: ${en:0:180}"
  echo "        | lt-LT: ${lt:0:180}"
  FAILED+=("locale invariance")
fi

if [ "$FULL" -eq 1 ]; then
  echo
  echo "=== balance gate (slow) ==="
  run "wargame-loop-gate" node tools/wargame-loop-gate.js
fi

echo
echo "======================================================"
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "ALL GATES GREEN  ($PASSED passed)"
  exit 0
fi
echo "GATES FAILED  ($PASSED passed, ${#FAILED[@]} failed)"
for f in "${FAILED[@]}"; do echo "   - $f"; done
exit 1
