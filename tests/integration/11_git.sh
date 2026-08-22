#!/usr/bin/env bash
# git interop: history ingestion, churn ranking, commit --git
. "$(dirname "$0")/../lib.sh"

cp -r "$FIXTURES/sample" "$TMP/proj"
cd "$TMP/proj"

# ---- with no git repository everything degrades quietly
"$CG" init >/dev/null
out="$("$CG" git-sync --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert d['git'] is False, d
assert d['commits'] == 0, d
"

# ---- now make it a real git repo with history
git init -q .
git config user.email "t@example.com"
git config user.name "Test"
git add -A
git commit -qm "initial"
for i in 1 2 3; do
    echo "// touch $i" >> src/util.ts
    git add -A
    git commit -qm "edit util $i"
done

out="$("$CG" git-sync --json)"          # first ingest carries the history
python3 -c "
import json
d = json.loads(r'''$out''')
assert d['git'] is True, d
assert d['commits'] >= 4, d
assert d['paths'] >= 4, d
"

# re-running is idempotent: already-ingested commits are not double counted
out="$("$CG" git-sync --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert d['commits'] == 0, ('git-sync should be idempotent', d)
"

# ---- .gitignore from a real repo is honoured by the index
echo "ignored/" > .gitignore
mkdir -p ignored
echo "function hiddenThing(){}" > ignored/hidden.js
"$CG" index --full >/dev/null
out="$("$CG" search hiddenThing)"
hasnt "$out" "ignored/hidden.js"

# ---- commit --git mirrors the snapshot into git with the same message
echo "// more" >> src/util.ts
out="$("$CG" commit -m "mirrored change" --git)"
has "$out" "git: committed"
out="$(git log -1 --pretty=%s)"
has "$out" "mirrored change"

# --git without a git repo is an explicit failure, not a silent skip
mkdir -p "$TMP/nogit" && cd "$TMP/nogit"
echo "function z(){}" > z.js
"$CG" init >/dev/null
expect_rc 1 "$CG" commit -m "x" --git

echo "11_git ok"
