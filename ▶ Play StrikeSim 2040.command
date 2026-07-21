#!/bin/bash
# ============================================================
#  ▶ PLAY STRIKESIM 2040 — this is the one to double-click.
#  Starts (or reuses) the local server and opens the game in
#  Safari. Close the little black window afterwards.
#
#  This always runs the CURRENT game (StrikeSim2040.html in
#  this folder) — not the website copy in site-preview.
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

# Safari renders the 3D view reliably on Apple Silicon.
open -a "Safari" "http://localhost:${PORT}/StrikeSim2040.html?t=$(date +%s)"

echo ""
echo "   ✅  StrikeSim 2040 is opening in Safari..."
echo "   New here? Pick GUIDED TUTORIAL on the title screen."
echo "   You can close this window now."
echo ""
