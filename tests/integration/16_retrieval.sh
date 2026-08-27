#!/usr/bin/env bash
# retrieval accuracy + agent efficiency: ranking, budgets, dedup, caps
. "$(dirname "$0")/../lib.sh"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# ---- self-index: codify's own source plus its test fixtures, so ranking is
# measured against the real decoys (fixture symbols named like ours)
mkdir -p "$TMP/self/tests"
cp -r "$ROOT/src" "$TMP/self/src"
cp -r "$ROOT/tests/fixtures" "$TMP/self/tests/fixtures"
cd "$TMP/self"
"$CG" init >/dev/null

# (1) 'cg search "find symbols"' must rank the real definition in src/graph.c
# above the fixture decoy UserService.find in tests/fixtures/.../server.ts
out="$("$CG" search 'find symbols' --json)"
python3 -c "
import json, sys
d = json.loads(r'''$out''')
syms = d['symbols']
names = [(s['name'], s['path']) for s in syms]
good = next((i for i, (n, p) in enumerate(names)
             if n == 'find_symbols' and p == 'src/graph.c'), None)
assert good is not None, names
decoy = next((i for i, (n, p) in enumerate(names)
              if n == 'find' and 'server.ts' in p), None)
assert decoy is None or good < decoy, names
"

# (2) 'cg context "symbol search"' must rank cmd_search/find_symbols above
# the t_search/t_symbol MCP wrappers
out="$("$CG" context 'symbol search' --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
syms = [s for s in d['symbols'] if 'name' in s or 'n' in s]
names = [s.get('name') or s.get('n') for s in syms]
good = [names.index(n) for n in ('cmd_search', 'find_symbols') if n in names]
assert good, names
bad = [names.index(n) for n in ('t_search', 't_symbol') if n in names]
for g in good:
    for b in bad:
        assert g < b, names
"

# (3) context is deterministic: two runs, byte-identical
a="$("$CG" context 'symbol search' --json)"
b="$("$CG" context 'symbol search' --json)"
[ "$a" = "$b" ] || fail "context not deterministic across runs"

# (4) --budget 200 (~800 bytes) keeps the whole response under 1200 bytes
out="$("$CG" context 'symbol search' --budget 200 --json)"
bytes=$(printf '%s' "$out" | wc -c)
[ "$bytes" -lt 1200 ] || fail "budget 200 produced $bytes bytes"
printf '%s' "$out" | python3 -m json.tool >/dev/null \
    || fail "budgeted context --json invalid"

# impact honors --budget the same way (cg_prep has many callers repo-wide)
out="$("$CG" impact cg_prep --budget 200 --json)"
bytes=$(printf '%s' "$out" | wc -c)
[ "$bytes" -lt 1200 ] || fail "impact budget 200 produced $bytes bytes"
printf '%s' "$out" | python3 -m json.tool >/dev/null \
    || fail "budgeted impact --json invalid"

# (5) a symbol's full form appears exactly once in context JSON; repeats are
# compact {"n","at"} references
out="$("$CG" context 'symbol search' --json)"
python3 -c "
import json, re
out = r'''$out'''
d = json.loads(out)
top = (d['symbols'][0].get('name') or d['symbols'][0].get('n'))
n = len(re.findall('\"name\":\"%s\"' % top, out))
assert n == 1, (top, n)
"

# ---- caps on the write-side surfaces, using the small fixture project
cp -r "$FIXTURES/sample" "$TMP/proj"
cd "$TMP/proj"
"$CG" init >/dev/null
"$CG" commit -m base >/dev/null

# (6) cg changes caps symbols at 40 (override with --limit) and marks omissions
for i in $(seq 1 45); do
    echo "export function capFn$i(): number { return $i; }"
done > src/big.ts
"$CG" sync >/dev/null
out="$("$CG" changes --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
f = next(f for f in d['changed_files'] if f['path'] == 'src/big.ts')
named = [s for s in f['symbols'] if 'name' in s]
marks = [s for s in f['symbols'] if 'omitted' in s]
assert len(named) == 40, len(named)
assert marks and marks[-1]['omitted'] == 5, marks
"
out="$("$CG" changes --limit 5 --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
f = next(f for f in d['changed_files'] if f['path'] == 'src/big.ts')
named = [s for s in f['symbols'] if 'name' in s]
marks = [s for s in f['symbols'] if 'omitted' in s]
assert len(named) == 5, len(named)
assert marks and marks[-1]['omitted'] == 40, marks
"

# (7) cg show truncates long bodies with a marker; --full restores them
{
    echo "export function longFn(): number {"
    for i in $(seq 1 45); do echo "  const v$i = $i;"; done
    echo "  return v1;"
    echo "}"
} > src/long.ts
"$CG" sync >/dev/null
out="$("$CG" show longFn)"
has "$out" "more lines, use --full"
hasnt "$out" "v45"
# 48-line body, 40 shown: last printed line is 40 (v39) and the marker counts
# exactly the other 8 — no line is both shown and reported omitted
has "$out" "v39"
hasnt "$out" "v40"
has "$out" "(+8 more lines"
out="$("$CG" show longFn --full)"
hasnt "$out" "more lines, use --full"
has "$out" "v45"

# short bodies never carry the marker
out="$("$CG" show formatName)"
hasnt "$out" "use --full"

# (8) search body hits carry a jump-to line number
out="$("$CG" search capFn7 --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
hits = [f for f in d['files'] if f['path'] == 'src/big.ts']
assert hits, d['files']
assert hits[0].get('line', 0) > 0, hits
"

# (9) doc-first snippets buy strictly more symbols for the same budget where
# docs exist — measured against the body-first baseline the same binary
# keeps alive under CG_BODY_FIRST=1
for i in 1 2 3 4 5 6; do
    {
        echo "/** ledger step $i: guards an invariant no parser could infer. */"
        echo "export function ledger_step$i(): number {"
        for j in $(seq 1 30); do echo "  const v$j = $j + $i;"; done
        echo "  return v1;"
        echo "}"
    } > "src/ledger$i.ts"
done
"$CG" sync >/dev/null
count_syms() {
    python3 -c "
import json, sys
d = json.load(sys.stdin)
print(len([s for s in d.get('symbols', []) if 'name' in s or 'n' in s]))"
}
docfirst=$("$CG" context ledger --budget 300 --json | count_syms)
bodyfirst=$(CG_BODY_FIRST=1 "$CG" context ledger --budget 300 --json | count_syms)
[ "$docfirst" -gt "$bodyfirst" ] \
    || fail "doc-first fits $docfirst symbols, body-first $bodyfirst — no gain"

echo ok
