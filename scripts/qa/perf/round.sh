#!/bin/bash
# One measurement round: server timings, query counts, and the browser flow.
# Needs: the prod server on :3400 through the delay proxy, ids.env.
HERE=$(cd "$(dirname "$0")" && pwd)
: "${NB:?set NB}" "${DOC:?set DOC}"
export DATABASE_URL="${PG_URL:-postgresql://postgres:postgres@localhost:5432/dissect}"
echo "## server (10ms RTT to Postgres)"; $HERE/bench.sh
echo "## queries per render"; $HERE/qcount.sh
echo "## browser flow"; NB=$NB DOC=$DOC node $HERE/perf.mjs 2>&1 | tee /tmp/perf-out.txt
id=$(grep RESTORE_NOTE /tmp/perf-out.txt | awk '{print $2}')
[ -n "$id" ] && psql -q "$DATABASE_URL" -c "UPDATE \"Note\" SET status='PENDING' WHERE id='$id'"
