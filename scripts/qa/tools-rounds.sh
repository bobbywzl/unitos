#!/bin/bash
# Rounds of the AI tool loop (SPEC.md §25, scripts/qa/tools-loop.mjs): n
# rounds against a running app, one line per round in <out>/summary.txt, and
# each round's full log beside it. Before every round the QA documents'
# annotations are cleared, so every round starts the same.
#
#   scripts/qa/tools-rounds.sh <rounds> [out dir]
#
# Needs: the app on QA_BASE (a production build: next build, next start), the
# mock models (node scripts/qa/mock-kimi.mjs), DATABASE_URL, and the seeds
# (scripts/qa/seed.mjs, scripts/qa/seed-page.mjs).
set -u
ROUNDS=${1:?rounds}
OUT=${2:-/tmp/tools-rounds}
TEXT_DOC=${QA_TEXT_DOC:-cmw37ayx200007dy9nukvhxy8}
PAGE_DOC=${QA_PAGE_DOC:-qa-handwritten-doc}
mkdir -p "$OUT/shots"
cd "$(dirname "$0")/../.."
for r in $(seq 1 "$ROUNDS"); do
  n=$(printf "%02d" "$r")
  psql "$DATABASE_URL" -Atqc "delete from \"Note\" where id in (select \"noteId\" from \"Source\" where \"documentId\" in ('$PAGE_DOC','$TEXT_DOC'))" > /dev/null 2>&1
  start=$(date +%s)
  timeout 900 node scripts/qa/tools-loop.mjs "$OUT/shots" > "$OUT/round-$n.log" 2>&1
  code=$?
  bad=$(grep -c "^ERROR\|^CRASH" "$OUT/round-$n.log")
  steps=$(grep -c "^ok\|^ERROR\|^CRASH" "$OUT/round-$n.log")
  echo "round $n exit=$code seconds=$(( $(date +%s) - start )) steps=$steps bad=$bad $(grep '^ERROR\|^CRASH' "$OUT/round-$n.log" | cut -c1-110 | tr '\n' ';')" >> "$OUT/summary.txt"
done
echo "clean rounds: $(grep -c 'bad=0' "$OUT/summary.txt") of $ROUNDS" >> "$OUT/summary.txt"
tail -1 "$OUT/summary.txt"
