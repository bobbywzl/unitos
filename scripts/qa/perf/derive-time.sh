#!/bin/bash
# The reader's AI tools: time to first byte and queries before the model answers (mock model).
HERE=$(cd "$(dirname "$0")" && pwd)
: "${NB:?set NB}" "${DOC:?set DOC}"
export DATABASE_URL="${PG_URL:-postgresql://postgres:postgres@localhost:5432/dissect}"
PGLOG=${PGLOG:-/var/log/postgresql/postgresql-16-main.log}
BLOCK=$(psql -At "$DATABASE_URL" -c "select id from \"Block\" where \"documentId\"='$DOC' and type='PARAGRAPH' order by \"order\" limit 1")
TEXT=$(psql -At "$DATABASE_URL" -c "select substring(text from 1 for 40) from \"Block\" where id='$BLOCK'")
START=$(date -u +"%Y-%m-%d %H:%M:%S")
for type in EXPLAIN SIMPLIFY; do
  body="{\"type\":\"$type\",\"documentId\":\"$DOC\",\"notebookId\":\"$NB\",\"anchor\":{\"blockId\":\"$BLOCK\",\"startOffset\":0,\"endOffset\":40,\"quotedText\":$(printf '%s' "$TEXT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}}"
  curl -s -o /dev/null -H 'content-type: application/json' -d "$body" http://localhost:3400/api/derive; sleep 0.4
  before=$(wc -l < $PGLOG)
  out=$(curl -s -o /dev/null -w "ttfb %{time_starttransfer}s total %{time_total}s %{http_code}" -H 'content-type: application/json' -d "$body" http://localhost:3400/api/derive); sleep 0.5
  n=$(tail -n +$((before+1)) $PGLOG | grep -c "statement: \|execute ")
  printf "derive %-9s %s  %3d queries\n" "$type" "$out" "$n"
done
# The annotations the probes made leave again, so the seeded project stays as it was.
psql -q "$DATABASE_URL" -c "delete from \"Note\" n using \"Section\" s where s.id=n.\"sectionId\" and s.\"notebookId\"='$NB' and n.\"derivationType\" in ('EXPLAIN','SIMPLIFY') and n.\"createdAt\" >= '$START'"
