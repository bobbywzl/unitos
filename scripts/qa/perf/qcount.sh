#!/bin/bash
# Count SQL statements per page render from the Postgres log.
: "${NB:?set NB}" "${DOC:?set DOC}"
PGLOG=${PGLOG:-/var/log/postgresql/postgresql-16-main.log}
H=http://localhost:3400
for p in "/" "/n/$NB" "/n/$NB?doc=$DOC" "/n/$NB/notes" "/n/$NB/annotations" "/n/$NB/assistant" "/settings" "/api/notebooks/$NB" "$@"; do
  curl -s -o /dev/null "$H$p"; sleep 0.3
  before=$(wc -l < $PGLOG)
  curl -s -o /dev/null "$H$p"; sleep 0.4
  n=$(tail -n +$((before+1)) $PGLOG | grep -c "statement: \|execute ")
  printf "%-45s %3d queries\n" "$p" "$n"
done
