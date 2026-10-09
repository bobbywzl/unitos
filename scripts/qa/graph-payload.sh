#!/bin/bash
# The workspace page's weight with the graph closed (GR-18): the page HTML
# and the RSC payload router.refresh() downloads on every sync refresh,
# raw and gzipped, for each project id given.
# usage: scripts/qa/graph-payload.sh <base url> <project id>...
BASE=$1
shift
for id in "$@"; do
  html=$(curl -s "$BASE/n/$id" | wc -c)
  htmlgz=$(curl -s "$BASE/n/$id" | gzip -c | wc -c)
  rsc=$(curl -sL -H "RSC: 1" "$BASE/n/$id" | wc -c)
  rscgz=$(curl -sL -H "RSC: 1" "$BASE/n/$id" | gzip -c | wc -c)
  graph=$(curl -s -o /dev/null -w "%{http_code} %{size_download}" "$BASE/api/notebooks/$id/graph")
  echo "$id html=$html (gz $htmlgz) rsc=$rsc (gz $rscgz) graph-route=$graph"
done
