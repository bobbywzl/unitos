#!/bin/bash
# Server-side timing of the main pages: median of N runs of total time and size.
: "${NB:?set NB}" "${DOC:?set DOC}"
N=${N:-7}
H=http://localhost:3400
t() { # label url [extra curl args]
  local label=$1 url=$2; shift 2
  local times=() size=0
  for i in $(seq $N); do
    local out=$(curl -s -o /dev/null -w "%{time_total} %{size_download} %{http_code}" "$@" "$url")
    times+=( $(echo $out | cut -d' ' -f1) ); size=$(echo $out | cut -d' ' -f2); code=$(echo $out | cut -d' ' -f3)
  done
  local med=$(printf "%s\n" "${times[@]}" | sort -n | sed -n "$(( (N+1)/2 ))p")
  local min=$(printf "%s\n" "${times[@]}" | sort -n | head -1)
  printf "%-28s med %6.0fms  min %6.0fms  %7d B  %s\n" "$label" $(echo "$med*1000" | bc) $(echo "$min*1000" | bc) $size $code
}
t "dashboard /" "$H/"
t "signin" "$H/signin"
t "reader /n/:id" "$H/n/$NB"
t "reader ?doc" "$H/n/$NB?doc=$DOC"
t "reader RSC refresh" "$H/n/$NB?doc=$DOC" -H "RSC: 1"
t "notes page" "$H/n/$NB/notes"
t "notes RSC refresh" "$H/n/$NB/notes" -H "RSC: 1"
t "annotations page" "$H/n/$NB/annotations"
t "assistant page" "$H/n/$NB/assistant"
t "api notebook" "$H/api/notebooks/$NB"
t "settings" "$H/settings"
