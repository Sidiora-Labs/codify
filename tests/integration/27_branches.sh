#!/usr/bin/env bash
# the unified multi-branch graph.
#   schema   — (task 3.1) branches registry, files scoped by branch, a linked
#              worktree joins the shared .codegraph, per-branch freshness and
#              gates, schema v15 upgrade keeps the registry
#   queries  — (task 3.2) branch-scoped search/context/memory, --all-branches
# Run one section: 27_branches.sh schema
. "$(dirname "$0")/../lib.sh"
section="${1:-all}"

want() { [ "$section" = all ] || [ "$section" = "$1" ]; }

pyjson() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }

db_count() {   # db_count <proj> <branch name> -> files rows on that branch
    python3 - "$1/.codegraph/graph.db" "$2" <<'EOF'
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
row = db.execute("SELECT count(*) FROM files WHERE branch_id="
                 "(SELECT id FROM branches WHERE name=?)", (sys.argv[2],)).fetchone()
print(row[0])
EOF
}

git_repo() {   # git_repo <dir>: init on main with one commit
    ( cd "$1" && (git init -q -b main . 2>/dev/null || { git init -q . && git checkout -q -b main; }) \
      && git config user.email t@t && git config user.name t \
      && git add -A && git commit -qm base )
}

if want schema; then
    cp -r "$FIXTURES/sample" "$TMP/proj"
    git_repo "$TMP/proj"
    cd "$TMP/proj"
    "$CG" init >/dev/null

    # ---- the main worktree registers its branch; counts match the index
    nf="$("$CG" info --json | pyjson 'print(d["project_files"])')"
    [ "$nf" -ge 4 ] || fail "project_files $nf"
    out="$("$CG" branches)"
    has "$out" "* main"
    has "$out" "$nf files"
    has "$out" "$TMP/proj"
    out="$("$CG" branches --json)"
    echo "$out" | pyjson "
assert d['current'] == 'main' and d['current_id'] > 0, d
assert d['root'] == d['shared'] == '$TMP/proj', d
assert len(d['branches']) == 1, d
b = d['branches'][0]
assert b['name'] == 'main' and b['current'] is True, b
assert b['files'] == $nf, b
assert b['worktree'] == '$TMP/proj', b
assert b['head'] and len(b['head']) == 40, b
assert b['base'] is None and b['updated'] > 0, b
" || fail "branches JSON"
    out="$("$CG" root --json)"
    echo "$out" | pyjson "
assert d['root'] == d['shared'] == '$TMP/proj', d
assert d['worktree'] is False and d['branch'] == 'main', d
" || fail "root JSON"
    has "$("$CG" info)" "branch: main"

    # ---- a linked worktree resolves to the shared project and joins it
    git worktree add -q "$TMP/wt" -b wave/x
    cd "$TMP/wt"
    out="$("$CG" root)"
    [ "$out" = "$TMP/wt" ] || fail "root in worktree: $out"
    out="$("$CG" root --json)"
    echo "$out" | pyjson "
assert d['root'] == '$TMP/wt' and d['shared'] == '$TMP/proj', d
assert d['worktree'] is True and d['branch'] == 'wave/x', d
" || fail "worktree root JSON"
    out="$("$CG" init)"
    has "$out" "joined $TMP/proj as worktree $TMP/wt on branch wave/x"
    [ ! -e "$TMP/wt/.codegraph" ] || fail "join must not create a second .codegraph"
    out="$("$CG" info)"
    has "$out" "project root: $TMP/wt"
    has "$out" "worktree of: $TMP/proj"
    has "$out" "branch: wave/x"
    out="$("$CG" branches)"
    has "$out" "* wave/x"
    has "$out" "  main"
    out="$("$CG" branches --json)"
    echo "$out" | pyjson "
b = {x['name']: x for x in d['branches']}
assert d['current'] == 'wave/x', d
assert b['wave/x']['current'] is True and b['main']['current'] is False, b
assert b['wave/x']['files'] == b['main']['files'] == $nf, b
assert b['wave/x']['worktree'] == '$TMP/wt', b
assert b['main']['worktree'] == '$TMP/proj', b
" || fail "two-branch JSON"
    # the worktree has its own gate under the shared .codegraph
    wid="$(echo "$out" | pyjson "print(d['current_id'])")"
    [ -e "$TMP/proj/.codegraph/index.$wid.lock" ] || fail "no per-worktree gate"

    # ---- rows are scoped: a change on wave/x never touches main's rows
    echo 'export function onlyOnWave(){}' > "$TMP/wt/src/wave.ts"
    "$CG" sync >/dev/null
    [ "$(db_count "$TMP/proj" wave/x)" -eq $((nf + 1)) ] || fail "wave/x did not gain the file"
    [ "$(db_count "$TMP/proj" main)" -eq "$nf" ] || fail "main rows changed by a worktree sync"
    rm "$TMP/wt/src/wave.ts"
    "$CG" sync >/dev/null
    [ "$(db_count "$TMP/proj" wave/x)" -eq "$nf" ] || fail "wave/x did not drop the file"
    [ "$(db_count "$TMP/proj" main)" -eq "$nf" ] || fail "main rows removed by a worktree sync"
    # and a main sync never removes wave/x's rows
    echo 'export function onlyOnWave(){}' > "$TMP/wt/src/wave.ts"
    "$CG" sync >/dev/null
    ( cd "$TMP/proj" && "$CG" sync >/dev/null )
    [ "$(db_count "$TMP/proj" wave/x)" -eq $((nf + 1)) ] || fail "main sync removed wave/x rows"

    # ---- freshness is per branch: a new worktree is never "fresh"
    ( cd "$TMP/proj" && "$CG" sync --max-age 60000 --json | pyjson 'assert d["fresh"] is True, d' ) \
        || fail "main should be fresh"
    git -C "$TMP/proj" worktree add -q "$TMP/wt2" -b wave/y
    cd "$TMP/wt2"
    "$CG" sync --max-age 60000 --json | pyjson 'assert d["fresh"] is False, d' \
        || fail "an unindexed branch reported fresh"
    "$CG" sync --max-age 60000 --json | pyjson 'assert d["fresh"] is True, d' \
        || fail "second sync should be fresh"
    [ "$(db_count "$TMP/proj" wave/y)" -eq "$nf" ] || fail "wave/y not indexed"

    # ---- schema upgrade keeps the registry, clears freshness, rebuilds rows
    cd "$TMP/proj"
    python3 - "$TMP/proj/.codegraph/graph.db" <<'EOF'
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute("UPDATE meta SET value='14' WHERE key='schema_version'")
db.commit()
EOF
    err="$("$CG" branches 2>&1 >/dev/null)"
    has "$err" "schema upgraded to v15"
    out="$("$CG" branches --json)"
    echo "$out" | pyjson "
b = {x['name']: x for x in d['branches']}
assert set(b) == {'main', 'wave/x', 'wave/y'}, b
assert all(x['files'] == 0 for x in b.values()), b
" || fail "registry lost on upgrade"
    "$CG" sync --max-age 60000 --json | pyjson 'assert d["fresh"] is False, d' \
        || fail "upgrade left the graph looking fresh"
    [ "$(db_count "$TMP/proj" main)" -eq "$nf" ] || fail "main not rebuilt after upgrade"
    [ "$(db_count "$TMP/proj" wave/x)" -eq 0 ] || fail "wave/x rebuilt from main's tree"

    # ---- an older cg refuses a newer database instead of downgrading it
    python3 - "$TMP/proj/.codegraph/graph.db" <<'EOF'
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute("UPDATE meta SET value='99' WHERE key='schema_version'")
db.commit()
EOF
    expect_rc 1 "$CG" branches
    err="$("$CG" branches 2>&1 >/dev/null || true)"
    has "$err" "is schema v99"
    has "$err" "make install"
    [ "$(db_count "$TMP/proj" main)" -eq "$nf" ] || fail "refusal still dropped the graph"
    python3 - "$TMP/proj/.codegraph/graph.db" <<'EOF'
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute("UPDATE meta SET value='15' WHERE key='schema_version'")
db.commit()
EOF
    has "$("$CG" branches)" "* main"

    # ---- a project without git still has a branch row
    cp -r "$FIXTURES/sample" "$TMP/nogit"
    cd "$TMP/nogit"
    "$CG" init >/dev/null
    out="$("$CG" branches)"
    has "$out" "* (none)"
    has "$out" "$nf files"
    has "$("$CG" symbol formatName)" "src/util.ts"

    # ---- a worktree of a repository that was never initialized binds nothing
    mkdir -p "$TMP/other/src"
    echo 'x' > "$TMP/other/src/a.js"
    git_repo "$TMP/other"
    git -C "$TMP/other" worktree add -q "$TMP/otherwt" -b b2
    cd "$TMP/otherwt"
    expect_rc 1 "$CG" root
    err="$("$CG" root 2>&1 >/dev/null || true)"
    has "$err" "no Codify project"
    # --nested makes the worktree its own project, as before
    out="$("$CG" init --nested)"
    has "$out" "initialized"
    [ -d "$TMP/otherwt/.codegraph" ] || fail "--nested did not create a project"
fi

echo "ok 27_branches ($section)"
