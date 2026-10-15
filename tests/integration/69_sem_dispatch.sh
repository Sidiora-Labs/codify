#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$(mktemp)"
project="$(mktemp -d)"
trap 'rm -f "$out"; rm -rf "$project"' EXIT
cc -std=gnu11 -Wall -Wextra -Werror -I"$root/src" \
  "$root/tests/fixtures/semantic/dispatch/harness.c" \
  "$root/src/sem_dispatch.c" -lsqlite3 -o "$out"
"$out"

mkdir -p "$project/src"
cp "$root/tests/fixtures/semantic/dispatch/web.tsx" \
   "$root/tests/fixtures/semantic/dispatch/observer.js" "$project/src/"
cd "$project"
"$CG" init >/dev/null
db=".codegraph/graph.db"
count() { sqlite3 "$db" "$1"; }
require() {
  local got
  got="$(count "$1")"
  [ "$got" -eq "$2" ] || { echo "FAIL: expected $2, got $got: $1" >&2; exit 1; }
}
edge_count() {
  count "SELECT count(*) FROM semantic_edges e JOIN symbols s ON s.id=e.source_id JOIN symbols t ON t.id=e.target_id WHERE e.kind='$1' AND s.name='$2' AND t.name='$3' AND e.strategy LIKE 'dispatch:%'"
}
require "SELECT count(*) FROM semantic_edges WHERE kind='callback' AND channel='bus.on'" 1
require "SELECT count(*) FROM semantic_edges WHERE kind='observer_dispatch'" 1
require "SELECT count(*) FROM semantic_edges WHERE kind='renders_component'" 1
require "SELECT count(*) FROM semantic_edges WHERE kind='state_render' AND source_id=target_id" 1
require "SELECT count(*) FROM semantic_edges WHERE strategy LIKE 'dispatch:%' AND (provenance<>'heuristic' OR registration_path='' OR registration_line IS NULL)" 0
require "SELECT count(*) FROM semantic_edges WHERE kind='callback' AND original_text='unproved'" 0
require "SELECT count(*) FROM semantic_edges WHERE kind='observer_dispatch' AND original_text='unknownObserver'" 0

# Rewiring a registration removes the old edge from an unchanged caller.
sed -i "s/addObserver('changed'/addObserver('other'/" src/observer.js
"$CG" sync >/dev/null
require "SELECT count(*) FROM semantic_edges WHERE kind='observer_dispatch'" 0
sed -i "s/addObserver('other'/addObserver('changed'/" src/observer.js
"$CG" sync >/dev/null
require "SELECT count(*) FROM semantic_edges WHERE kind='observer_dispatch'" 1

# JSX and callback edges follow source edits; dynamic calls remain boundaries.
sed -i 's/<Child \/>/<Absent \/>/' src/web.tsx
sed -i 's/bus.on('\''saved'\'', handleSaved)/bus.on('\''saved'\'', missingHandler)/' src/web.tsx
"$CG" sync >/dev/null
require "SELECT count(*) FROM semantic_edges WHERE kind='renders_component'" 0
require "SELECT count(*) FROM semantic_edges WHERE kind='callback' AND channel='bus.on'" 0
require "SELECT count(*) FROM semantic_edges WHERE kind='observer_dispatch'" 1
