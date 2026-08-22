#!/usr/bin/env bash
# show, test-impact, why — the read side of the lifecycle
. "$(dirname "$0")/../lib.sh"

cp -r "$FIXTURES/sample" "$TMP/proj"
cd "$TMP/proj"
mkdir -p tests
cat > tests/util.test.ts <<'TS'
import { formatName } from "../src/util";
test("formats", () => { formatName("a"); });
TS
"$CG" init >/dev/null

# ---- show returns one symbol body, not the file
out="$("$CG" show formatName)"
has "$out" "formatName"
has "$out" "src/util.ts"
hasnt "$out" "slugify"          # a sibling in the same file must not appear
out="$("$CG" show formatName --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert d['definitions'], d
assert d['definitions'][0]['body'], 'body missing'
assert 'formatName' in d['definitions'][0]['body']
"
expect_rc 1 "$CG" show definitelyNotASymbol

# ---- test-impact finds the test that references a symbol
out="$("$CG" test-impact formatName)"
has "$out" "tests/util.test.ts"

# a symbol no test touches is reported as uncovered
out="$("$CG" test-impact slugify)"
has "$out" "no test references"

out="$("$CG" test-impact formatName --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert any('util.test.ts' in c['path'] for c in d['covered']), d
"

# ---- why joins symbol to commits, tasks, and memories
"$CG" commit -m "initial import" >/dev/null
"$CG" remember "formatName trims before casing" --type decision \
      --symbols formatName >/dev/null
out="$("$CG" why formatName)"
has "$out" "defined"
has "$out" "initial import"
has "$out" "trims before casing"

out="$("$CG" why formatName --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert d['definitions'], d
assert d['commits'], 'no commits joined'
assert d['memories'], 'no memories joined'
"

# ---- multi-word context finds symbols (regression: used to return [])
out="$("$CG" context 'format name' --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert d['symbols'], 'tokenized context returned no symbols'
assert any(s['name'] == 'formatName' for s in d['symbols']), d['symbols']
"

echo "10_lifecycle ok"

# ---- show addresses a position, which is what editors actually hold
out="$("$CG" show src/util.ts:2)"
has "$out" "formatName"
out="$("$CG" show src/util.ts:2 --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert d['definitions'][0]['line'] <= 2 <= d['definitions'][0]['end_line'], d
"

echo "10_lifecycle position ok"

# ---- brief returns session state in one call
cd "$TMP/proj"
out="$("$CG" brief)"
has "$out" "project: $TMP/proj"
has "$out" "uncommitted"
out="$("$CG" brief --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert d['root'].endswith('proj'), d
assert 'memories' in d and 'uncommitted' in d, d
"

# ---- guard is quiet with no task in progress, and advisory once there is one
out="$("$CG" guard)"
has "$out" "no task in progress"

"$CG" spec new demo >/dev/null
"$CG" spec add 2.1 --title "Touch util only" --wave 0 --touches 'src/util.ts' \
      --reqs 1.1 >/dev/null
"$CG" spec start 1.1 >/dev/null && "$CG" spec done 1.1 >/dev/null
"$CG" spec start 2.1 >/dev/null

echo "// edit" >> src/util.ts
out="$("$CG" guard src/util.ts)"
has "$out" "inside task 2.1's declared scope"

out="$("$CG" guard src/server.ts)"
has "$out" "outside the scope"
has "$out" "advisory only"
expect_rc 0 "$CG" guard src/server.ts          # advisory by default
expect_rc 1 "$CG" guard src/server.ts --strict # opt-in enforcement

out="$("$CG" guard src/server.ts --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert d['guarded'] is True, d
assert d['task'] == '2.1', d
assert d['out_of_scope'] == ['src/server.ts'], d
"

# ---- review pairs the change with the criteria it claims
out="$("$CG" review)"
has "$out" "review of 2.1"
has "$out" "symbols you changed"
out="$("$CG" review --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert d['task']['id'] == '2.1', d
assert 'changed' in d and 'symbols' in d, d
"

# ---- hook install writes agent and git hooks, and never clobbers
out="$("$CG" hook install)"
has "$out" "claude-code"
[ -f .claude/settings.json ] || fail ".claude/settings.json not written"
grep -q "sync" .claude/settings.json || fail "sync hook missing"
out="$("$CG" hook install)"
has "$out" "already defines hooks"

echo "10_lifecycle governance ok"
