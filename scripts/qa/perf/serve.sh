#!/bin/bash
# The production build on :3400, through the delay proxy on :5433.
cd "$(dirname "$0")/../../.."
pkill -f "next-serve[r]"; sleep 1
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5433/dissect}" DIRECT_URL="${DIRECT_URL:-$DATABASE_URL}" PORT=3400
nohup npm start > .qa/server.log 2>&1 &
until curl -s -o /dev/null http://localhost:3400/signin; do sleep 1; done; echo "serving on :3400"
