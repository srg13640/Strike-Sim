#!/bin/bash
# ============================================================
#  Open StrikeSim 2040 — in SAFARI
#  Double-click this if the 3D view won't start in Chrome.
#  Safari on Apple Silicon renders 3D (WebGL) through Metal and
#  almost always works. (You can close the little black window.)
# ============================================================

cd "$(dirname "$0")" || exit 1

# Reuse a running StrikeSim server on 8000, else pick the next free port.
PORT=""
if command -v curl >/dev/null 2>&1 && curl -fsI "http://localhost:8000/StrikeSim2040.html?t=$(date +%s)" >/dev/null 2>&1; then
  PORT=8000
else
  for candidate in $(seq 8000 8020); do
    if ! lsof -ti tcp:"$candidate" >/dev/null 2>&1; then
      PORT="$candidate"
      nohup python3 -m http.server "$PORT" >"/tmp/strikesim_server_${PORT}.log" 2>&1 &
      sleep 1
      break
    fi
  done
fi

if [ -z "$PORT" ]; then
  echo ""
  echo "   No free local port found between 8000 and 8020."
  echo "   Close another local server and try again."
  echo ""
  exit 1
fi

# Open specifically in Safari, regardless of the default browser.
open -a "Safari" "http://localhost:${PORT}/StrikeSim2040.html?t=$(date +%s)"

echo ""
echo "   ✅  StrikeSim 2040 is opening in Safari..."
echo "   If 3D still doesn't appear, the Map / Table / Task Org views are the full tool."
echo "   You can close this window now."
echo ""
