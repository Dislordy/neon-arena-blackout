#!/bin/bash
# Neon Arena: Blackout — start the game and share it with friends (Chromebook / Linux / macOS).
# Usage:  ./scripts/play.sh            (game + public ngrok link)
#         ./scripts/play.sh --local    (game only, http://localhost:3000)
set -e
cd "$(dirname "$0")/.."
pkill -f "node server.js" 2>/dev/null || true
pkill -f "ngrok http" 2>/dev/null || true
[ -d node_modules ] || npm install
npm start &
GAME_PID=$!
trap 'kill $GAME_PID 2>/dev/null; pkill -f "ngrok http" 2>/dev/null' EXIT
sleep 3
if [ "$1" = "--local" ] || ! command -v ngrok >/dev/null; then
  [ "$1" = "--local" ] || echo "ngrok not installed — running locally only. See README 'Share with friends'."
  echo "Open http://localhost:3000  (Ctrl+C to stop)"
  wait $GAME_PID
else
  ngrok http 3000
fi
