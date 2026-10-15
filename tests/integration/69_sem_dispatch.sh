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
   "$root/tests/fixtures/semantic/dispatch/observer.js" \
   "$root/tests/fixtures/semantic/dispatch/native.c" \
   "$root/tests/fixtures/semantic/dispatch/Bridge.java" \
   "$root/tests/fixtures/semantic/dispatch/Worker.java" \
   "$root/tests/fixtures/semantic/dispatch/Flow.dfm" \
   "$root/tests/fixtures/semantic/dispatch/Flow.pas" "$project/src/"
cd "$project"
"$CG" init >/dev/null
db="$(printf '%s\n' .*/graph.db | head -1)"
count() { sqlite3 "$db" "$1"; }
require() {
  local got
  got="$(count "$1")"
  [ "$got" -eq "$2" ] || { echo "FAIL: expected $2, got $got: $1" >&2; exit 1; }
}
require "SELECT count(*) FROM semantic_edges WHERE kind='callback' AND channel='bus.on'" 1
require "SELECT count(*) FROM semantic_edges WHERE kind='observer_dispatch'" 1
require "SELECT count(*) FROM semantic_edges WHERE kind='pointer_dispatch' AND channel='ops.run'" 1
require "SELECT count(*) FROM semantic_edges WHERE kind='native_dispatch' AND channel='nativeOpen'" 1
require "SELECT count(*) FROM semantic_edges e JOIN semantic_symbols src ON src.symbol_id=e.source_id JOIN semantic_symbols dst ON dst.symbol_id=e.target_id WHERE e.kind='interface_dispatch' AND src.qualified_name='Worker.invoke' AND dst.qualified_name='Concrete.work'" 1
require "SELECT count(*) FROM semantic_edges e JOIN symbols src ON src.id=e.source_id JOIN symbols dst ON dst.id=e.target_id JOIN files f ON f.id=dst.file_id WHERE e.kind='form_event_dispatch' AND src.name='SaveButton' AND dst.name='HandleSave' AND f.path='src/Flow.pas'" 1
require "SELECT count(*) FROM semantic_edges WHERE kind='renders_component'" 1
require "SELECT count(*) FROM semantic_edges WHERE kind='state_render' AND source_id=target_id" 1
require "SELECT count(*) FROM semantic_edges WHERE strategy LIKE 'dispatch:%' AND (provenance<>'heuristic' OR registration_path='' OR registration_line IS NULL)" 0
require "SELECT count(*) FROM semantic_edges WHERE kind='callback' AND original_text='unproved'" 0
require "SELECT count(*) FROM semantic_edges WHERE kind='observer_dispatch' AND original_text='unknownObserver'" 0
require "SELECT count(*) FROM semantic_edges e JOIN symbols s ON s.id=e.source_id WHERE e.kind='observer_dispatch' AND s.name='shadow'" 0
require "SELECT count(*) FROM semantic_edges WHERE kind='native_dispatch' AND channel='computed'" 0

# Form handlers follow the owning form type and exact companion unit.
sed -i 's/OnClick = HandleSave/OnClick = UnknownHandler/' src/Flow.dfm
"$CG" sync >/dev/null
require "SELECT count(*) FROM semantic_edges WHERE kind='form_event_dispatch'" 0
sed -i 's/OnClick = UnknownHandler/OnClick = HandleSave/' src/Flow.dfm
"$CG" sync >/dev/null
require "SELECT count(*) FROM semantic_edges WHERE kind='form_event_dispatch'" 1
sed -i 's/procedure HandleSave(Sender: TObject);/procedure OtherHandler(Sender: TObject);/' src/Flow.pas
"$CG" sync >/dev/null
require "SELECT count(*) FROM semantic_edges WHERE kind='form_event_dispatch'" 0
sed -i 's/procedure OtherHandler(Sender: TObject);/procedure HandleSave(Sender: TObject);/' src/Flow.pas
"$CG" sync >/dev/null
require "SELECT count(*) FROM semantic_edges WHERE kind='form_event_dispatch'" 1

# A same-name overload has no safe target without signature evidence.
sed -i 's/public void work() {}/public void work() {} public void work(int x) {}/' src/Worker.java
"$CG" sync >/dev/null
require "SELECT count(*) FROM semantic_edges WHERE kind='interface_dispatch'" 0
sed -i 's/ public void work(int x) {}//' src/Worker.java
"$CG" sync >/dev/null
require "SELECT count(*) FROM semantic_edges WHERE kind='interface_dispatch'" 1
sed -i 's/implements Worker//' src/Worker.java
"$CG" sync >/dev/null
require "SELECT count(*) FROM semantic_edges WHERE kind='interface_dispatch'" 0

# Rewiring a registration removes the old edge from an unchanged caller.
sed -i "s/addObserver('changed'/addObserver('other'/" src/observer.js
"$CG" sync >/dev/null
require "SELECT count(*) FROM semantic_edges WHERE kind='observer_dispatch'" 0
sed -i "s/addObserver('other'/addObserver('changed'/" src/observer.js
"$CG" sync >/dev/null
require "SELECT count(*) FROM semantic_edges WHERE kind='observer_dispatch'" 1

# C table and native registration changes invalidate unchanged callers.
sed -i 's/\.run = increment/.run = absent/' src/native.c
sed -i 's/{"nativeOpen", "()V"/{"otherOpen", "()V"/' src/native.c
"$CG" sync >/dev/null
require "SELECT count(*) FROM semantic_edges WHERE kind='pointer_dispatch'" 0
require "SELECT count(*) FROM semantic_edges WHERE kind='native_dispatch'" 0

# JSX and callback edges follow source edits; dynamic calls remain boundaries.
sed -i 's/<Child \/>/<Absent \/>/' src/web.tsx
sed -i 's/bus.on('\''saved'\'', handleSaved)/bus.on('\''saved'\'', missingHandler)/' src/web.tsx
"$CG" sync >/dev/null
require "SELECT count(*) FROM semantic_edges WHERE kind='renders_component'" 0
require "SELECT count(*) FROM semantic_edges WHERE kind='callback' AND channel='bus.on'" 0
require "SELECT count(*) FROM semantic_edges WHERE kind='observer_dispatch'" 1
