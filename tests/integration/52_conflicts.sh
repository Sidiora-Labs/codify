#!/usr/bin/env bash
# Projection findings (codify-v15 task 3.2, req 9 ac_1-ac_3 and the first
# five clauses of ac_6): beyond git's textual conflicts, a projection build
# finds symbol (two branches change one function, even when git merges them
# cleanly), interface (a signature changed on one branch, called in new code
# on another), and near (edits within three lines) collisions, keeps them in
# projection_findings, emits projection.conflict once, projection.resolved
# when a fix lands, projection.built per build, and steers the agents on both
# branches once per finding unless [projection] steer = false.
. "$(dirname "$0")/../lib.sh"

export HOME="$TMP/home"
mkdir -p "$HOME"
unset CG_AGENT CG_ROLE

pyjson() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }
g() { git -C "$TMP/proj" "$@"; }
events() { "$CG" events --since 0 -n 1000 --kind "$1" --json; }
nevents() { events "$1" | grep -c . || true; }

# ---- main: one function long enough for two separate hunks, a public
# helper, a settings file, and a line both branches will rewrite
mkdir -p "$TMP/proj/src"
cd "$TMP/proj"
git init -q -b main . 2>/dev/null || { git init -q . && git checkout -q -b main; }
git config user.email t@t
git config user.name t
printf '.codegraph/\n' > .gitignore
cat > src/core.c <<'EOF'
int compute(int x) {
    int a = x + 1;
    int b = a * 2;
    int c = b - 3;
    int d = c + 4;
    int e = d * 5;
    int f = e - 6;
    int g = f + 7;
    return g;
}
EOF
printf 'int helper(int x) { return x + 1; }\n' > src/api.c
printf 'k1 = 1\nk2 = 2\nk3 = 3\nk4 = 4\nk5 = 5\nk6 = 6\nk7 = 7\nk8 = 8\n' > settings.txt
printf 'shared line\n' > shared.txt
git add -A
git commit -qm base
"$CG" init >/dev/null

# feat-a: line 2 of compute, helper's signature, settings line 3, shared.txt
git worktree add -q -b feat-a "$TMP/wt-a"
sed -i 's/x + 1;/x + 10;/' "$TMP/wt-a/src/core.c"
printf 'int helper(int x, int y) { return x + y; }\n' > "$TMP/wt-a/src/api.c"
sed -i 's/^k3 = 3$/k3 = 30/' "$TMP/wt-a/settings.txt"
printf 'shared line from A\n' > "$TMP/wt-a/shared.txt"
git -C "$TMP/wt-a" commit -qam "a: compute, helper(x, y), k3, shared"
# feat-b: line 8 of compute (git merges it with A's cleanly), a new caller
# of helper, settings line 5 (two lines from A's), shared.txt again
git worktree add -q -b feat-b "$TMP/wt-b"
sed -i 's/f + 7;/f + 70;/' "$TMP/wt-b/src/core.c"
printf 'int helper(int x);\nint use_helper(void) { return helper(1); }\n' \
    > "$TMP/wt-b/src/use.c"
sed -i 's/^k5 = 5$/k5 = 50/' "$TMP/wt-b/settings.txt"
printf 'shared line from B\n' > "$TMP/wt-b/shared.txt"
git -C "$TMP/wt-b" add -A
git -C "$TMP/wt-b" commit -qm "b: compute, use_helper, k5, shared"
for w in a b; do (cd "$TMP/wt-$w" && "$CG" sync >/dev/null); done

# an agent on each branch: Claude Code sessions whose cwd is the worktree
hook_start() {
    printf '{"hook_event_name":"SessionStart","session_id":"%s","transcript_path":"%s/t.jsonl","cwd":"%s","source":"startup"}' \
        "$1" "$HOME" "$2" | "$CG" hook event --host claude >/dev/null
}
hook_start aaaaaaaa-0000-0000-0000-000000000001 "$TMP/wt-a"
hook_start bbbbbbbb-0000-0000-0000-000000000002 "$TMP/wt-b"
AA="claude:aaaaaaaa"
AB="claude:bbbbbbbb"
row="$(sqlite3 .codegraph/graph.db "SELECT branch FROM agents WHERE agent='$AA'")"
[ "$row" = "feat-a" ] || fail "session agent on feat-a: $row"

# ---- the build
out="$("$CG" projection build)"
has "$out" "+ feat-a"
has "$out" "+ feat-b"
has "$out" "findings:"
d="$("$CG" projection build --json --force)"
echo "$d" | pyjson "
c = d['conflicts']
# git: only shared.txt conflicts; core.c and settings.txt merge cleanly
assert [x['path'] for x in c] == ['shared.txt'], c
f = d['findings']['findings']
by = {(x['kind'], x['path']): x for x in f}
s = by[('symbol', 'src/core.c')]
assert s['symbol'] == 'compute' and s['branches'] == ['feat-a', 'feat-b'], s
assert 'feat-a 2' in s['lines'] and 'feat-b 8' in s['lines'], s
assert {a['agent'] for a in s['agents']} == {'$AA', '$AB'}, s
assert s['advice'], s
i = by[('interface', 'src/api.c')]
assert i['symbol'] == 'helper' and i['branches'] == ['feat-a', 'feat-b'], i
assert i['changer'] == 'feat-a' and 'src/use.c:2' in i['lines'], i
n = by[('near', 'settings.txt')]
assert n['branches'] == ['feat-a', 'feat-b'] and n['symbol'] is None, n
assert 'feat-a 3' in n['lines'] and 'feat-b 5' in n['lines'], n
k = by[('content', 'shared.txt')]
assert k['branches'] == ['feat-a', 'feat-b'], k
assert ('near', 'shared.txt') not in by, 'near repeats the content conflict'
assert d['findings']['count'] == 4, f
for x in f:
    assert isinstance(x['age'], int) and x['first_seen'] > 0, x
" || fail "build --json findings: $d"

# no git conflict where the symbol finding is: both hunks are in the projection
core="$(g show refs/codify/projection:src/core.c)"
hasnt "$core" "<<<<<<<"
has "$core" "x + 10;"
has "$core" "f + 70;"

# ---- cg projection findings: text with ages, and --json
out="$("$CG" projection findings)"
has "$out" "symbol    src/core.c  compute  — feat-a (agent $AA), feat-b (agent $AB)"
has "$out" "interface src/api.c  helper"
has "$out" "near      settings.txt"
has "$out" "content   shared.txt"
has "$out" "lines: feat-a 3; feat-b 5"
has "$out" "s)"
"$CG" projection findings --json | pyjson "
assert d['count'] == 4 and len(d['findings']) == 4, d
" || fail "findings --json"

# ---- events: one projection.conflict per finding, projection.built per build
[ "$(nevents projection.conflict)" = 4 ] || fail "conflict events: $(events projection.conflict)"
[ "$(nevents projection.built)" = 2 ] || fail "built events"
events projection.built | tail -1 | pyjson "
p = d['payload']
assert p['branches'] == 2 and p['conflicts'] == 4 and isinstance(p['ms'], int), p
" || fail "projection.built payload"
events projection.conflict | head -1 | pyjson "
p = d['payload']
for k in ('kind','path','symbol','lines','branches','agents','advice'):
    assert k in p, (k, p)
" || fail "projection.conflict payload"

# ---- steering: each agent once per finding, the req 9.3 sentence
steer="$(events agent.steer)"
[ "$(printf '%s\n' "$steer" | grep -c .)" = 8 ] || fail "8 steers expected: $steer"
has "$steer" "Projection: your branch feat-a and feat-b (agent $AB) both change compute in src/core.c — coordinate or merge feat-b before you qualify; see cg projection findings"
has "$steer" "Projection: your branch feat-b and feat-a (agent $AA) both change compute in src/core.c — coordinate or merge feat-a before you qualify; see cg projection findings"
has "$steer" "both edit settings.txt within 3 lines"
has "$steer" "helper"

# ---- persisting findings: nothing new on the next build
"$CG" projection build --force >/dev/null
[ "$(nevents projection.conflict)" = 4 ] || fail "a persisting finding re-emitted"
[ "$(printf '%s\n' "$(events agent.steer)" | grep -c .)" = 8 ] || fail "re-steered"
[ "$(nevents projection.built)" = 3 ] || fail "built per build"
# an unchanged build is still a build
out="$("$CG" projection build)"
has "$out" "projection unchanged"
has "$out" "compute"
[ "$(nevents projection.built)" = 4 ] || fail "built on a no-op build"

# ---- fixing one branch resolves its finding on the next build
sed -i 's/^k5 = 50$/k5 = 5/' "$TMP/wt-b/settings.txt"
git -C "$TMP/wt-b" commit -qam "b: k5 back"
out="$("$CG" projection build)"
hasnt "$out" "settings.txt"
[ "$(nevents projection.resolved)" = 1 ] || fail "resolved events: $(events projection.resolved)"
events projection.resolved | pyjson "
p = d['payload']
assert p['kind'] == 'near' and p['path'] == 'settings.txt', p
assert p['branches'] == ['feat-a', 'feat-b'], p
" || fail "projection.resolved payload"
"$CG" projection findings --json | pyjson "
assert d['count'] == 3 and 'near' not in [x['kind'] for x in d['findings']], d
" || fail "the resolved finding still listed"
n="$(sqlite3 .codegraph/graph.db "SELECT count(*) FROM projection_findings WHERE resolved IS NOT NULL")"
[ "$n" = 1 ] || fail "resolved rows: $n"

# ---- [projection] steer = false: a finding that comes back is announced
# again but nobody is steered; uncommitted work counts
printf '[projection]\nsteer = false\n' > codify.kvx
sed -i 's/^k5 = 5$/k5 = 55/' "$TMP/wt-b/settings.txt"
before="$(printf '%s\n' "$(events agent.steer)" | grep -c .)"
out="$("$CG" projection build)"
has "$out" "settings.txt"
[ "$(nevents projection.conflict)" = 5 ] || fail "the reappearance was not announced"
after="$(printf '%s\n' "$(events agent.steer)" | grep -c .)"
[ "$before" = "$after" ] || fail "steered with steer = false"
rm codify.kvx

# ---- findings answer from the database, without a build
out="$("$CG" projection findings)"
has "$out" "compute"

echo "52_conflicts: ok"
