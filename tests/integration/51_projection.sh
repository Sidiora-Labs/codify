#!/usr/bin/env bash
# cg projection (codify-v15 task 3.1, req 8): every active branch folded onto
# the base with git merge-tree — committed work, uncommitted work through a
# shadow commit, conflicts folded with markers and attributed — written to
# refs/codify/projection, stored, rebuilt only when the inputs change, and
# optionally checked out and indexed as branch codify/projection.
. "$(dirname "$0")/../lib.sh"

export HOME="$TMP/home"
mkdir -p "$HOME"

pyjson() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }
g() { git -C "$TMP/proj" "$@"; }
nrows() {
    python3 - "$TMP/proj/.codegraph/graph.db" <<'EOF'
import sqlite3, sys
print(sqlite3.connect(sys.argv[1]).execute(
    "SELECT count(*) FROM projections").fetchone()[0])
EOF
}

# ---- main plus branches in worktrees
mkdir -p "$TMP/proj/src"
cd "$TMP/proj"
git init -q -b main . 2>/dev/null || { git init -q . && git checkout -q -b main; }
git config user.email t@t
git config user.name t
printf '.codegraph/\n*.log\n' > .gitignore
printf 'int core(void) { return 0; }\n' > src/core.c
printf 'shared line\n' > shared.txt
printf 'notes\n' > notes.txt
git add -A
git commit -qm base
"$CG" init >/dev/null

# feat-a: clean, committed — defines a symbol nobody else has, edits shared.txt
git worktree add -q -b feat-a "$TMP/wt-a"
printf 'int alpha_only_symbol(void) { return 1; }\n' > "$TMP/wt-a/src/alpha.c"
printf 'shared line from A\n' > "$TMP/wt-a/shared.txt"
git -C "$TMP/wt-a" add -A
git -C "$TMP/wt-a" commit -qm "a: alpha"
# feat-b: committed nothing; an uncommitted edit and an untracked file
git worktree add -q -b feat-b "$TMP/wt-b"
printf 'notes edited in b, not committed\n' > "$TMP/wt-b/notes.txt"
printf 'int beta_dirty_symbol(void) { return 2; }\n' > "$TMP/wt-b/src/beta.c"
printf 'ignored\n' > "$TMP/wt-b/scratch.log"
# feat-c: committed, conflicts with feat-a on shared.txt
git worktree add -q -b feat-c "$TMP/wt-c"
printf 'shared line from C\n' > "$TMP/wt-c/shared.txt"
git -C "$TMP/wt-c" commit -qam "c: shared"
# feat-d: a branch with no worktree — never active on its own
git branch -q feat-d main
git worktree add -q "$TMP/wt-d" feat-d
printf 'd\n' > "$TMP/wt-d/d.txt"
git -C "$TMP/wt-d" add -A
git -C "$TMP/wt-d" commit -qm "d"
git worktree remove "$TMP/wt-d"

# each worktree joins the shared graph, which registers its branch
for w in a b c; do (cd "$TMP/wt-$w" && "$CG" sync >/dev/null); done
bstat_before="$(git -C "$TMP/wt-b" status --porcelain)"

# ---- the build: text
out="$("$CG" projection build)"
has "$out" "base main @"
has "$out" "+ feat-a"
has "$out" "+ feat-b"
has "$out" "+ feat-c"
has "$out" "1 commit ahead"
has "$out" "2 dirty files"                      # notes.txt + src/beta.c
has "$out" "conflicts (1):"
has "$out" "shared.txt  content  feat-c, feat-a"
has "$out" "refs/codify/projection"
hasnt "$out" "feat-d"

# the ref exists and holds all three contributions, the uncommitted edit too
proj="$(g rev-parse --verify refs/codify/projection)"
[ -n "$proj" ] || fail "no ref"
has "$(g show "$proj:src/alpha.c")" "alpha_only_symbol"
has "$(g show "$proj:notes.txt")" "notes edited in b, not committed"
has "$(g show "$proj:src/beta.c")" "beta_dirty_symbol"
g cat-file -e "$proj:scratch.log" 2>/dev/null && fail ".gitignore not honored"
shared="$(g show "$proj:shared.txt")"
has "$shared" "<<<<<<<"
has "$shared" "shared line from A"
has "$shared" "shared line from C"
log="$(g log --format=%s "$proj")"
has "$log" "projection: + feat-a"
has "$log" "projection: + feat-b"
has "$log" "projection: + feat-c"
has "$log" "projection: shadow of feat-b"
# merge parents: the previous projection and the contribution
[ "$(g rev-parse "$proj^2")" = "$(g rev-parse feat-c)" ] || fail "second parent"
# the real index and worktree of feat-b are untouched; no branch moved
[ "$(git -C "$TMP/wt-b" status --porcelain)" = "$bstat_before" ] \
    || fail "feat-b's index or worktree changed"
[ "$(g rev-parse feat-b)" = "$(g rev-parse main)" ] || fail "feat-b moved"

# ---- --json shape
d="$("$CG" projection build --json --force)"
echo "$d" | pyjson "
assert d['base'] == 'main' and len(d['base_head']) == 40, d
assert d['ref'] == 'refs/codify/projection' and len(d['commit']) == 40, d
assert isinstance(d['ms'], int) and d['unchanged'] is False, d
names = [b['name'] for b in d['branches']]
assert names == ['feat-a', 'feat-b', 'feat-c'], names
for b in d['branches']:
    for k in ('name','head','contribution','dirty','commits','merged','conflicts'):
        assert k in b, (k, b)
b = {x['name']: x for x in d['branches']}
assert b['feat-b']['dirty'] == 2 and b['feat-b']['contribution'] != b['feat-b']['head']
assert b['feat-a']['dirty'] == 0 and b['feat-a']['contribution'] == b['feat-a']['head']
assert b['feat-a']['commits'] == 1 and b['feat-c']['conflicts'] == 1
assert all(x['merged'] for x in d['branches'])
assert d['conflicts'] == [{'path': 'shared.txt', 'kind': 'content',
                           'branches': ['feat-c', 'feat-a']}], d['conflicts']
" || fail "build --json: $d"

# ---- unchanged inputs: a no-op that says so; --force rebuilds
n0="$(nrows)"
out="$("$CG" projection build)"
has "$out" "projection unchanged"
[ "$(nrows)" = "$n0" ] || fail "a no-op build stored a row"
d="$("$CG" projection build --json)"
echo "$d" | pyjson "assert d['unchanged'] is True, d" || fail "unchanged json"
out="$("$CG" projection build --force)"
hasnt "$out" "unchanged"
[ "$(nrows)" = "$((n0 + 1))" ] || fail "--force did not rebuild"
# a new uncommitted edit changes the fingerprint
printf 'more\n' >> "$TMP/wt-b/notes.txt"
out="$("$CG" projection build)"
hasnt "$out" "unchanged"
has "$(g show refs/codify/projection:notes.txt)" "more"

# ---- status prints the last build without rebuilding
n1="$(nrows)"
out="$("$CG" projection status)"
has "$out" "+ feat-a"
has "$out" "shared.txt  content  feat-c, feat-a"
[ "$(nrows)" = "$n1" ] || fail "status rebuilt"
"$CG" projection status --json | pyjson "assert d['commit'] and d['branches']" \
    || fail "status --json"

# ---- diff and show
out="$("$CG" projection diff)"
has "$out" "src/alpha.c"
has "$out" "shared.txt"
has "$out" "changed"
out="$("$CG" projection diff feat-a)"
hasnt "$out" "src/alpha.c"
has "$out" "notes.txt"
out="$("$CG" projection show)"
has "$out" "src/alpha.c"
has "$out" "src/beta.c"
has "$out" "notes.txt"
"$CG" projection show --json | pyjson "
assert {'status': 'A', 'path': 'src/alpha.c'} in d['paths'], d" || fail "show --json"

# ---- --strict leaves the conflicting branch out
out="$("$CG" projection build --strict)"
has "$out" "feat-c"
has "$out" "skipped — conflicts (--strict): shared.txt"
shared="$(g show refs/codify/projection:shared.txt)"
hasnt "$shared" "<<<<<<<"
hasnt "$shared" "from C"
has "$(g show refs/codify/projection:src/alpha.c)" "alpha_only_symbol"

# ---- --branch adds a branch that is not otherwise active
out="$("$CG" projection build --branch feat-d)"
has "$out" "+ feat-d"
has "$(g show refs/codify/projection:d.txt)" "d"
out="$("$CG" projection build)"
hasnt "$out" "feat-d"

# ---- a registered branch whose worktree is gone is reported and skipped
git worktree add -q -b feat-e "$TMP/wt-e"
(cd "$TMP/wt-e" && "$CG" sync >/dev/null)
rm -rf "$TMP/wt-e"
out="$("$CG" projection build)"
has "$out" "feat-e"
has "$out" "worktree missing"
has "$out" "+ feat-a"

# ---- [projection] exclude; no active branch is the base's own commit
printf '[projection]\nexclude = ["feat-*"]\n' > codify.kvx
out="$("$CG" projection build)"
has "$out" "no active branches"
[ "$(g rev-parse refs/codify/projection)" = "$(g rev-parse main)" ] \
    || fail "the empty projection is not the base commit"
rm codify.kvx

# ---- --index: checked out detached and indexed as branch codify/projection
d="$("$CG" projection build --index --json)"
echo "$d" | pyjson "
i = d['index']
assert i['branch'] == 'codify/projection' and i['ok'] is True, i
assert i['worktree'].endswith('.codegraph/worktrees/projection'), i
" || fail "--index json: $d"
wt="$TMP/proj/.codegraph/worktrees/projection"
[ -f "$wt/src/alpha.c" ] || fail "projection worktree not checked out"
[ "$(git -C "$wt" rev-parse HEAD)" = "$(g rev-parse refs/codify/projection)" ] \
    || fail "projection worktree not at the ref"
out="$("$CG" search alpha_only_symbol --branch codify/projection)"
has "$out" "alpha_only_symbol"
has "$out" "src/alpha.c"
out="$("$CG" search beta_dirty_symbol --branch codify/projection)"
has "$out" "beta_dirty_symbol"
out="$("$CG" search alpha_only_symbol)"            # main has no such symbol
hasnt "$out" "src/alpha.c"
has "$("$CG" branches)" "codify/projection"
# unchanged commit: the checkout is skipped
d="$("$CG" projection build --index --json)"
echo "$d" | pyjson "assert d['index']['checked_out'] is False, d" \
    || fail "checkout not skipped: $d"
# the projection branch never folds itself in
hasnt "$("$CG" projection build --force)" "+ codify/projection"

# ---- the lock: a second caller waits, then gives up past --wait
python3 - "$TMP/proj/.codegraph/projection.lock" <<'EOF' &
import fcntl, sys, time
f = open(sys.argv[1], "a")
fcntl.flock(f, fcntl.LOCK_EX)
open(sys.argv[1] + ".held", "w").close()
time.sleep(1.5)
EOF
holder=$!
for _ in $(seq 50); do [ -e "$TMP/proj/.codegraph/projection.lock.held" ] && break; sleep 0.05; done
expect_rc 75 "$CG" projection build --wait 100
out="$("$CG" projection build --wait 5000)"         # waits, then reports
has "$out" "refs/codify/projection"
wait "$holder"

# ---- no git: said exactly, exit 1
mkdir -p "$TMP/nogit"
cd "$TMP/nogit"
printf 'int x(void) { return 0; }\n' > x.c
"$CG" init >/dev/null
expect_rc 1 "$CG" projection build
err="$("$CG" projection build 2>&1 || true)"
has "$err" "cg projection: no git repository at $TMP/nogit"

echo "51_projection: ok"
