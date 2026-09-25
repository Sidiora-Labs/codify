#!/usr/bin/env bash
# the unified multi-branch graph.
#   schema   — (task 3.1) branches registry, files scoped by branch, a linked
#              worktree joins the shared .codegraph, per-branch freshness and
#              gates, schema v16 upgrade keeps the registry
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
    has "$err" "schema upgraded to v16"
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
db.execute("UPDATE meta SET value='16' WHERE key='schema_version'")
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

if want queries; then
    cp -r "$FIXTURES/sample" "$TMP/q"
    git_repo "$TMP/q"
    cd "$TMP/q"
    "$CG" init >/dev/null
    nf="$("$CG" info --json | pyjson 'print(d["project_files"])')"

    # ---- a second branch, indexed from its own worktree
    git worktree add -q "$TMP/qwt" -b feat/b
    cd "$TMP/qwt"
    echo 'export function onlyOnB(){ return formatName("x"); }' > "$TMP/qwt/src/onlyb.ts"
    out="$("$CG" sync --json)"
    echo "$out" | pyjson 'assert d["indexed"] >= 1, d' || fail "worktree sync"
    # identical files are reused from main's rows instead of parsed again
    echo "$out" | pyjson 'assert d["reused"] >= 1, d' || fail "no content reuse across branches"
    [ "$(db_count "$TMP/q" feat/b)" -eq $((nf + 1)) ] || fail "feat/b rows"
    [ "$(db_count "$TMP/q" main)" -eq "$nf" ] || fail "main rows"

    # ---- the reused rows are real rows, not empty ones
    has "$("$CG" symbol formatName)" "src/util.ts"

    # ---- a symbol on both branches is reported once, from this branch
    out="$("$CG" symbol formatName --json)"
    echo "$out" | pyjson "
assert len(d['definitions']) == 1, d
assert d['definitions'][0]['path'] == 'src/util.ts', d
assert 'branch' not in d['definitions'][0], d
" || fail "symbol is not branch-scoped"
    "$CG" search formatName --json | pyjson "
assert sum(1 for x in d['symbols'] if x['name'] == 'formatName') == 1, d
assert len({x['path'] for x in d['files']}) == len(d['files']), d
assert all('branch' not in x for x in d['symbols'] + d['files']), d
" || fail "search repeated a hit once per branch"

    # ---- --all-branches unions them and labels every hit
    out="$("$CG" symbol formatName --all-branches --json)"
    echo "$out" | pyjson "
b = sorted(x['branch'] for x in d['definitions'])
assert len(d['definitions']) == 2, d
assert b == ['feat/b', 'main'], b
" || fail "--all-branches did not union and label"
    has "$("$CG" symbol formatName --all-branches)" "@feat/b"
    has "$("$CG" search formatName --all-branches)" "@main"

    # ---- --branch asks another branch; an unknown one is refused
    expect_rc 1 "$CG" symbol onlyOnB --branch main
    out="$("$CG" symbol onlyOnB --branch main --json 2>/dev/null || true)"
    echo "$out" | pyjson 'assert d["symbol"] is None, d' \
        || fail "main should not have onlyOnB"
    has "$("$CG" symbol onlyOnB --json)" "src/onlyb.ts"
    expect_rc 1 "$CG" search formatName --branch nope
    err="$("$CG" search formatName --branch nope 2>&1 >/dev/null || true)"
    has "$err" "no branch named 'nope'"

    # ---- counts stay per branch: anchors must not multiply by branch
    cd "$TMP/q"
    one="$("$CG" anchors --json | pyjson 'print(d["symbols"])')"
    cd "$TMP/qwt"
    two="$("$CG" anchors --json | pyjson 'print(d["symbols"])')"
    [ "$one" -gt 0 ] || fail "no symbols counted"
    [ "$two" -ge "$one" ] || fail "worktree lost symbols"
    [ "$two" -lt $((one * 2)) ] || fail "anchors counted both branches ($one vs $two)"
    "$CG" check --json | pyjson 'assert isinstance(d["stale_anchors"], int), d' \
        || fail "check JSON"

    # ---- memories carry the branch they were made on
    "$CG" remember "worker note on feat/b" --type decision >/dev/null
    out="$("$CG" recall "worker note" --json)"
    echo "$out" | pyjson "
assert d['count'] == 1, d
assert d['memories'][0]['branch'] == 'feat/b', d
" || fail "memory did not record its branch"
    cd "$TMP/q"
    "$CG" recall "worker note" --json | pyjson 'assert d["count"] == 0, d' \
        || fail "main saw a worker-branch memory"
    "$CG" recall "worker note" --all-branches --json \
        | pyjson 'assert d["count"] == 1, d' || fail "--all-branches missed it"
    # a note on the base is visible from the branch cut from it
    "$CG" remember "shared note on main" --type constraint >/dev/null
    cd "$TMP/qwt"
    "$CG" recall "shared note" --json | pyjson 'assert d["count"] == 1, d' \
        || fail "a branch cannot see its base's memories"

    # ---- brief names the branch, its base, and the other live branches
    out="$("$CG" brief)"
    has "$out" "branch: feat/b"
    has "$out" "other branches: main"
    out="$("$CG" brief --json)"
    echo "$out" | pyjson "
assert d['branch'] == 'feat/b', d
assert d['worktree'] is True, d
assert [x['name'] for x in d['other_branches']] == ['main'], d
" || fail "brief JSON"

    # ---- watch --fleet exists and does not hang without inotify budget
    has "$("$CG" help)" "--all-branches"
fi

echo "ok 27_branches ($section)"
