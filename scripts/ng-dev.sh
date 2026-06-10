#!/usr/bin/env bash
# Kill anything bound to port 4200, then start ng serve on the same port.
# Use this when a stale dev server is hogging the port and `ng serve` refuses
# to bind. Equivalent to `npm start` / `npm run dev`.

PORT=4200

fuser -k "${PORT}/tcp" 2>/dev/null
# Fallback for systems where fuser isn't available or didn't catch the pid.
PIDS=$(lsof -ti "tcp:${PORT}" 2>/dev/null)
if [ -n "$PIDS" ]; then
  echo "Killing leftover PIDs on ${PORT}: $PIDS"
  kill -9 $PIDS 2>/dev/null
fi

cd "$(dirname "$0")/.."
exec npx ng serve --port "$PORT" "$@"
