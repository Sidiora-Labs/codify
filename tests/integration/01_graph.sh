#!/usr/bin/env bash
# init, index, search, symbol, impact, context, routes, info
. "$(dirname "$0")/../lib.sh"

cp -r "$FIXTURES/sample" "$TMP/proj"
cd "$TMP/proj"

out="$("$CG" init)"
has "$out" "initialized"
[ -f .codegraph/graph.db ] || fail ".codegraph/graph.db not created"

# double init refuses
expect_rc 1 "$CG" init

# info reports a sane machine profile and measured cost
out="$("$CG" info --json)"
has "$out" '"profile"'
has "$out" '"workers"'
python3 -c "
import json, sys
d = json.loads('''$out''')
assert d['workers'] >= 1, d
assert d['mem_total_kb'] > 0, 'memory detection broken'
assert d['project_files'] >= 4, d
"

# search: symbol hit across languages
out="$("$CG" search formatName)"
has "$out" "src/util.ts"
out="$("$CG" search load_tasks)"
has "$out" "lib/tasks.py"
out="$("$CG" search handleReq)"
has "$out" "main.go"

# substring (trigram) search
out="$("$CG" search ormatNam)"
has "$out" "formatName"

# symbol: definition + snippet + references
out="$("$CG" symbol formatName)"
has "$out" "util.ts"
has "$out" "function formatName"

# impact: save_tasks calls load_tasks -> load_tasks impact lists save_tasks
out="$("$CG" impact load_tasks -d 2)"
has "$out" "save_tasks"

# context: one-call bundle
out="$("$CG" context formatName)"
has "$out" "formatName"
has "$out" "util.ts"

# routes: express endpoints with handlers
out="$("$CG" routes)"
has "$out" "GET"
has "$out" "/users"
has "$out" "getUsers"
has "$out" "POST"

# json outputs parse
"$CG" search formatName --json | python3 -m json.tool >/dev/null \
    || fail "search --json invalid"
"$CG" routes --json | python3 -m json.tool >/dev/null \
    || fail "routes --json invalid"

# incremental sync picks up a new file
cat > src/extra.ts <<'EOF'
export function extraThing(): number { return 1; }
EOF
"$CG" sync >/dev/null
out="$("$CG" search extraThing)"
has "$out" "src/extra.ts"

# and removal purges it
rm src/extra.ts
"$CG" sync >/dev/null
out="$("$CG" search extraThing || true)"
hasnt "$out" "src/extra.ts"

echo ok
