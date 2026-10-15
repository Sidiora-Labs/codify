#!/usr/bin/env bash
. "$(dirname "$0")/../lib.sh"

mkdir "$TMP/proj"
cd "$TMP/proj"
cat > main.go <<'EOF'
package sample
func Greeting() string { return "hello" }
EOF
"$CG" init > /dev/null
printf '[sync]\nauto = false\n' > codify.kvx

"$CG" info --json > "$TMP/info.json"
"$CG" status --json > "$TMP/status.json"
"$CG" tool call index_status '{}' > "$TMP/index.json"
"$CG" tool call get_symbol '{"name":"Greeting"}' > "$TMP/fresh.json"
"$CG" search Greeting --json > "$TMP/cli.json"
python3 - "$TMP" <<'PY'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
info = json.loads((p / 'info.json').read_text())
status = json.loads((p / 'status.json').read_text())
idx = json.loads((p / 'index.json').read_text())
fresh = json.loads((p / 'fresh.json').read_text())
cli = json.loads((p / 'cli.json').read_text())
for obj in (info, status, idx, fresh, cli):
    h = obj['index_health']
    assert h['branch'] and 'coverage' in h and 'parsers' in h, h
    assert 'pending' in h and 'degraded' in h, h
assert fresh['index_health']['source_validation']['files'], fresh
assert fresh['index_health']['source_validation']['files'][0]['state'] == 'verified', fresh
assert cli['index_health']['source_validation']['verified'] == 1, cli
assert fresh['index_health']['source_validation']['limits'] == {
    'files': 16, 'bytes': 4194304, 'ms': 25}, fresh
PY

printf '1 1 overflow\n' > .codegraph/watch.reconcile
"$CG" tool call index_status '{}' > "$TMP/pending.json"
python3 - "$TMP/pending.json" <<'PY'
import json, sys
h = json.load(open(sys.argv[1]))['index_health']
assert h['pending'] and h['degraded'] and h['reason'] == 'overflow', h
PY
rm .codegraph/watch.reconcile

cat > main.go <<'EOF'
package sample
func Greeting() string { return "changed" }
EOF
"$CG" tool call get_symbol '{"name":"Greeting"}' > "$TMP/stale.json"
python3 - "$TMP/stale.json" <<'PY'
import json, sys
h = json.load(open(sys.argv[1]))['index_health']['source_validation']
assert h['stale'] == 1 and h['files'][0]['state'] == 'stale', h
PY

"$CG" sync main.go > /dev/null
"$CG" tool call get_symbol '{"name":"Greeting"}' > "$TMP/resynced.json"
python3 - "$TMP/resynced.json" <<'PY'
import json, sys
h = json.load(open(sys.argv[1]))['index_health']['source_validation']
assert h['verified'] == 1 and h['stale'] == 0, h
PY

python3 - <<'PY'
with open('large.go', 'w') as f:
    f.write('package sample\n' + '// data\n' * 160000)
PY
"$CG" sync large.go > /dev/null
"$CG" tool call find_files '{"pattern":"large.go"}' > "$TMP/large.json"
python3 - "$TMP/large.json" <<'PY'
import json, sys
h = json.load(open(sys.argv[1]))['index_health']['source_validation']
assert h['unchecked'] == 1 and h['files'][0]['state'] == 'unchecked', h
PY

echo "ok: answer health"
