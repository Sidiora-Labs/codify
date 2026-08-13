#!/usr/bin/env bash
# commit, log, status, diff, changes, checkout
. "$(dirname "$0")/../lib.sh"

cp -r "$FIXTURES/sample" "$TMP/proj"
cd "$TMP/proj"
"$CG" init >/dev/null

out="$("$CG" commit -m "first snapshot")"
has "$out" "first snapshot"
first="$(printf '%s' "$out" | grep -o '\[[0-9a-f]*\]' | tr -d '[]')"
[ -n "$first" ] || fail "no commit id in: $out"

# identical tree -> nothing to commit
out="$("$CG" commit -m "noop")"
has "$out" "nothing to commit"

# modify + add
cat >> src/util.ts <<'EOF'

export function slugify(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "-");
}
EOF
echo "# scratch" > NOTES.md

out="$("$CG" status)"
has "$out" "src/util.ts"
has "$out" "NOTES.md"

# diff HEAD vs worktree shows the added function
out="$("$CG" diff)"
has "$out" "slugify"

# changes: symbols touched in modified files
"$CG" sync >/dev/null
out="$("$CG" changes)"
has "$out" "slugify"

out="$("$CG" commit -m "second snapshot")"
has "$out" "second snapshot"

out="$("$CG" log)"
has "$out" "first snapshot"
has "$out" "second snapshot"
"$CG" log --json | python3 -c "
import json, sys
d = json.load(sys.stdin)
assert len(d['commits']) == 2, d
assert d['commits'][0]['message'] == 'second snapshot', d
"

# checkout the first snapshot restores content (and removes NOTES.md)
"$CG" checkout "$first" --force >/dev/null
if grep -q "slugify" src/util.ts; then
    fail "checkout did not restore util.ts"
fi
[ ! -f NOTES.md ] || fail "checkout left NOTES.md behind"

# dirty-tree checkout without --force refuses
echo "dirty" >> src/util.ts
expect_rc 1 "$CG" checkout "$first"

echo ok
