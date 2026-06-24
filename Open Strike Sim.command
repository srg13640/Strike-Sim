#!/bin/bash
# ============================================================
#  Open Strike Sim
#  Just DOUBLE-CLICK this file. The app opens in your browser.
#  (You can close the little black window that appears.)
# ============================================================

# Move into the folder this file lives in (works on any machine).
cd "$(dirname "$0")" || exit 1

# Start the local server only if it isn't already running on port 8000.
if ! lsof -ti tcp:8000 >/dev/null 2>&1; then
  nohup python3 -m http.server 8000 >/tmp/strikesim_server.log 2>&1 &
  sleep 1
fi

# Open the app in the default web browser.
open "http://localhost:8000/DST2040.HTML"

echo ""
echo "   ✅  Strike Sim is opening in your browser..."
echo ""
echo "   You can close this window now."
echo "   (Leave it running and the app stays available at"
echo "    http://localhost:8000/DST2040.HTML )"
echo ""
