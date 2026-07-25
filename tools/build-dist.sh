#!/bin/bash
# =============================================================================
#  build-dist.sh — produce a self-contained, deployable copy of the game.  [CO-012]
#
#  Output: dist/  (gitignored). Everything is relative-path, so it works from any
#  static host with no build step, no backend, and no configuration.
#
#  Usage:
#    tools/build-dist.sh            # gates must be green first (this enforces it)
#    tools/build-dist.sh --skip-gates   # escape hatch; do not use for a real share
#
#  Deploy (Cloudflare Pages — gives a *.pages.dev URL a non-technical player can click):
#    npx wrangler pages deploy dist --project-name strikesim-demo
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
OUT="$ROOT/dist"

SKIP_GATES=0
[ "${1:-}" = "--skip-gates" ] && SKIP_GATES=1

if [ "$SKIP_GATES" -eq 0 ]; then
  echo "=== gates (a build you would hand to someone must be green) ==="
  if ! "$ROOT/tools/run-all-gates.sh" >/tmp/dist_gates.log 2>&1; then
    echo "GATES FAILED — refusing to build. Last lines:"
    tail -20 /tmp/dist_gates.log | sed 's/^/   /'
    exit 1
  fi
  echo "  all gates green"
  echo
fi

rm -rf "$OUT"; mkdir -p "$OUT"

# 1. Shell. index.html is the entry point every static host serves at "/".
cp "$ROOT/StrikeSim2040.html" "$OUT/index.html"
cp "$ROOT/StrikeSim2040.html" "$OUT/StrikeSim2040.html"   # keep the historical URL working

# 2. Every module the shell loads, plus the workers and what they importScripts.
grep -o 'src="[^"]*\.js' "$ROOT/StrikeSim2040.html" \
  | sed 's/src="//' | grep -v '^vendor/' | sort -u \
  | while read -r f; do cp "$ROOT/$f" "$OUT/"; done
cp "$ROOT/sim-worker.js" "$ROOT/counterfactual-worker.js" "$ROOT/counterfactual.js" "$OUT/"

# 3. Data + libraries + imagery.
cp "$ROOT/grok150red.json" "$ROOT/grokblue90.json" "$OUT/"
cp -R "$ROOT/vendor" "$ROOT/assets" "$ROOT/scenarios" "$OUT/"
[ -d "$ROOT/tiles" ] && cp -R "$ROOT/tiles" "$OUT/"

# 4. Completeness check — every relative reference must resolve inside dist/.
missing=0
while read -r ref; do
  [ -z "$ref" ] && continue
  [ -e "$OUT/$ref" ] || { echo "  MISSING in dist: $ref"; missing=$((missing + 1)); }
done < <(
  # Only real LOAD paths. Deliberately excludes things like `a.download = 'x.json'`,
  # which name a file the user saves and are not dependencies of the build.
  { grep -oh 'src="[^"]*"' "$OUT"/*.html
    grep -oh "importScripts([^)]*)"        "$OUT"/*.js 2>/dev/null
    grep -oh "fetch(\s*['\"][^'\"]*['\"]"  "$OUT"/*.js "$OUT"/*.html 2>/dev/null
    grep -oh "new Worker(\s*['\"][^'\"]*['\"]" "$OUT"/*.js "$OUT"/*.html 2>/dev/null
  } | grep -oh "[A-Za-z0-9_./-]*\.\(js\|json\|png\|jpg\|jpeg\|svg\|css\|geojson\)" \
    | sed 's/?.*$//' | grep -v '^https\?:' | grep -v '^data:' | sort -u
)

echo "=== dist built ==="
echo "  path : $OUT"
echo "  size : $(du -sh "$OUT" | cut -f1)"
echo "  files: $(find "$OUT" -type f | wc -l | tr -d ' ')"
if [ "$missing" -gt 0 ]; then
  echo "  INCOMPLETE — $missing missing reference(s)"; exit 1
fi
echo "  all relative references resolve"
echo
echo "Deploy a clickable URL with:"
echo "  npx wrangler pages deploy dist --project-name strikesim-demo"
