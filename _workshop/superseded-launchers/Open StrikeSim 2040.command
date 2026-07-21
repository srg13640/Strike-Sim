#!/bin/bash
# ============================================================
#  Open StrikeSim 2040
#  Just DOUBLE-CLICK this file. The app opens in your browser.
#  (You can close the little black window that appears.)
# ============================================================

# Move into the folder this file lives in (works on any machine).
cd "$(dirname "$0")" || exit 1

# Reuse a real StrikeSim 2040 server on 8000 if it is already up. If some other
# process owns 8000, pick the next free port instead of opening the wrong app.
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

# Open the app in the default web browser.
open "http://localhost:${PORT}/StrikeSim2040.html?t=$(date +%s)"

echo ""
echo "   ✅  StrikeSim 2040 is opening in your browser..."
echo ""
echo "   You can close this window now."
echo "   (Leave it running and the app stays available at"
echo "    http://localhost:${PORT}/StrikeSim2040.html )"
echo ""
