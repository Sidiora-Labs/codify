#!/usr/bin/env bash
# The projection follows the work (codify-v15 task 3.3, req 9 ac_4, ac_5 and
# the last clauses of ac_6): cg hook post-edit and cg hook event mark the
# projection dirty and start one background `cg projection build --quiet`
# when the last build is older than [projection] min_interval (15s) and
# [projection] auto is not false; cg watch and watch --fleet rebuild when
# edits settle; cg serve rebuilds after a merge and streams projection.*;
# fleet merge-up prints the branch's known findings before merging; the
# findings reach projection status (by branch, with ages), brief, state,
# fleet tree --json, and the MCP tool projection_status.
#   hooks   — post-edit and hook event triggers, the interval, auto = false,
#             the steer in a post-edit hook's additionalContext, surfaces
#   watch   — cg watch and cg watch --fleet
#   fleet   — fleet tree --json, merge-up findings first, serve streaming
# Run one section: 53_projection_live.sh hooks
. "$(dirname "$0")/../lib.sh"
section="${1:-all}"
want() { [ "$section" = all ] || [ "$section" = "$1" ]; }

export HOME="$TMP/home"
mkdir -p "$HOME"
unset CG_AGENT CG_ROLE CG_PARENT

pyjson() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }
nevents() {
    "$CG" events --since 0 -n 1000 --kind "$1" --json | grep -c . || true
}
# wait_built <n> <seconds>: until n projection.built events exist
wait_built() {
    local i=0 lim=$(( $2 * 10 ))
    while [ "$(nevents projection.built)" -lt "$1" ]; do
        i=$((i + 1))
        [ "$i" -le "$lim" ] || fail "no projection.built #$1 within $2s (have $(nevents projection.built))"
        sleep 0.1
    done
}
ms() { date +%s%3N; }

# ---- two branches whose work collides, as in 52_conflicts
conflict_repo() {
    rm -rf "$TMP/proj" "$TMP/wt-a" "$TMP/wt-b"
    mkdir -p "$TMP/proj/src"
    cd "$TMP/proj"
    git init -q -b main . 2>/dev/null || { git init -q . && git checkout -q -b main; }
    git config user.email t@t
    git config user.name t
    printf '.codegraph/\ncodify.kvx\n' > .gitignore
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
    printf 'shared line\n' > shared.txt
    git add -A
    git commit -qm base
    "$CG" init >/dev/null
    git worktree add -q -b feat-a "$TMP/wt-a"
    sed -i 's/x + 1;/x + 10;/' "$TMP/wt-a/src/core.c"
    printf 'shared line from A\n' > "$TMP/wt-a/shared.txt"
    git -C "$TMP/wt-a" commit -qam "a: compute, shared"
    git worktree add -q -b feat-b "$TMP/wt-b"
    sed -i 's/f + 7;/f + 70;/' "$TMP/wt-b/src/core.c"
    printf 'shared line from B\n' > "$TMP/wt-b/shared.txt"
    git -C "$TMP/wt-b" commit -qam "b: compute, shared"
    for w in a b; do (cd "$TMP/wt-$w" && "$CG" sync >/dev/null); done
}

hook() {   # hook <event> <session> <cwd> [extra json]
    printf '{"hook_event_name":"%s","session_id":"%s","transcript_path":"%s/t.jsonl","cwd":"%s"%s}' \
        "$1" "$2" "$HOME" "$3" "${4:-}" | "$CG" hook event --host claude >/dev/null
}
SA=aaaaaaaa-0000-0000-0000-000000000001
SB=bbbbbbbb-0000-0000-0000-000000000002
AA="claude:aaaaaaaa"
AB="claude:bbbbbbbb"

if want hooks; then
    conflict_repo
    # session starts are not work: nothing is built
    hook SessionStart "$SA" "$TMP/wt-a" ',"source":"startup"'
    hook SessionStart "$SB" "$TMP/wt-b" ',"source":"startup"'
    [ "$(nevents projection.built)" = 0 ] || fail "a session start built the projection"

    # ---- a post-edit hook: returns at once, the build lands in the background
    payload="{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$TMP/wt-a/src/core.c\"}}"
    t0="$(ms)"
    out="$(cd "$TMP/wt-a" && echo "$payload" | "$CG" hook post-edit)"
    t1="$(ms)"
    [ $((t1 - t0)) -lt 3000 ] || fail "post-edit waited for the build: $((t1 - t0))ms"
    wait_built 1 5
    landed="$(( $(ms) - t0 ))"
    [ "$landed" -lt 5000 ] || fail "background build took ${landed}ms"
    [ -s .codegraph/projection.dirty ] && fail "the build left the dirty note"
    "$CG" projection findings --json | pyjson "
kinds = sorted(x['kind'] for x in d['findings'])
assert kinds == ['content', 'symbol'], kinds
" || fail "background build findings"
    # the build ran quiet and detached: the ref exists, nobody printed
    git rev-parse -q --verify refs/codify/projection >/dev/null || fail "no projection ref"

    # ---- within [projection] min_interval: marked dirty, not rebuilt
    (cd "$TMP/wt-b" && echo "$payload" | "$CG" hook post-edit >/dev/null)
    [ -s .codegraph/projection.dirty ] || fail "post-edit did not mark the projection dirty"
    has "$(cat .codegraph/projection.dirty)" "post-edit"
    sleep 1.5
    [ "$(nevents projection.built)" = 1 ] || fail "rebuilt inside min_interval"

    # ---- the steer the build sent reaches the next post-edit's additionalContext
    out="$(cd "$TMP/wt-a" && echo "$payload" | CG_AGENT="$AA" "$CG" hook post-edit)"
    echo "$out" | pyjson "
h = d['hookSpecificOutput']
assert h['hookEventName'] == 'PostToolUse', d
c = h['additionalContext']
assert 'Projection: your branch feat-a and feat-b (agent $AB) both change compute in src/core.c' in c, c
" || fail "steer in additionalContext: $out"

    # ---- the surfaces, from real cg output
    out="$("$CG" projection status)"
    has "$out" "last build"
    has "$out" "findings by branch:"
    has "$out" "feat-a at $TMP/wt-a — 2 findings"
    has "$out" "feat-b at $TMP/wt-b — 2 findings"
    has "$out" "    symbol    src/core.c  compute  with feat-b  ("
    has "$out" "    content   shared.txt  with feat-a  ("
    has "$out" "both branches change compute"
    "$CG" projection status --json | pyjson "
f = d['findings']
assert f['count'] == 2 and len(f['findings']) == 2, f
b = f['by_branch']
assert b['feat-a']['findings'] == 2 and b['feat-a']['worktree'].endswith('/wt-a'), b
assert b['feat-b']['findings'] == 2, b
" || fail "projection status --json"
    out="$("$CG" brief)"
    has "$out" "projection: 2 branches folded, 2 findings — "
    has "$out" "compute in src/core.c (feat-a, feat-b)"
    has "$out" "shared.txt (feat-a, feat-b)"
    "$CG" brief --json | pyjson "
p = d['projection']
assert p['branches'] == 2 and p['findings'] == 2 and len(p['first']) == 2, p
assert {x['kind'] for x in p['first']} == {'symbol', 'content'}, p
assert p['first'][0]['branches'] == ['feat-a', 'feat-b'], p
assert isinstance(p['age'], int) and p['commit'], p
" || fail "brief --json projection"
    out="$("$CG" state)"
    has "$out" "projection: 2 branches folded, 2 findings"
    "$CG" state --json | pyjson "
p = d['projection']
assert p['findings'] == 2 and p['branches'] == 2, p
" || fail "state --json projection"
    "$CG" tool call projection_status | pyjson "
assert d['findings']['count'] == 2, d
assert set(d['findings']['by_branch']) == {'feat-a', 'feat-b'}, d
" || fail "MCP projection_status"
    has "$("$CG" tool list)" "projection_status"

    # ---- cg hook event: work events build, session starts do not
    printf '[projection]\nmin_interval = "1s"\n' > codify.kvx
    sleep 1.2
    hook SessionStart cccccccc-0000-0000-0000-000000000003 "$TMP/wt-b" ',"source":"startup"'
    sleep 1
    [ "$(nevents projection.built)" = 1 ] || fail "SessionStart built the projection"
    hook PostToolUse "$SB" "$TMP/wt-b" ',"tool_name":"Edit","tool_input":{"file_path":"shared.txt"}'
    wait_built 2 5

    # ---- [projection] auto = false: marked dirty, never built
    printf '[projection]\nauto = false\nmin_interval = "0s"\n' > codify.kvx
    (cd "$TMP/wt-a" && echo "$payload" | "$CG" hook post-edit >/dev/null)
    hook PostToolUse "$SA" "$TMP/wt-a" ',"tool_name":"Edit","tool_input":{"file_path":"src/core.c"}'
    sleep 1.5
    [ "$(nevents projection.built)" = 2 ] || fail "built with auto = false"
    [ -s .codegraph/projection.dirty ] || fail "auto = false lost the dirty note"
    rm codify.kvx
fi

if want watch; then
    conflict_repo
    printf '[projection]\nmin_interval = "0s"\n' > codify.kvx
    "$CG" projection build >/dev/null
    n0="$(nevents projection.built)"

    # ---- cg watch: an edit that settles marks and builds
    "$CG" watch --debounce 100 > "$TMP/watch.out" 2>&1 &
    wpid=$!
    sleep 1
    echo 'int extra(void) { return 1; }' > src/extra.c
    wait_built $((n0 + 1)) 8
    kill "$wpid" 2>/dev/null || true
    wait "$wpid" 2>/dev/null || true

    # ---- cg watch --fleet: an edit in a branch's worktree
    n1="$(nevents projection.built)"
    "$CG" watch --fleet --debounce 100 > "$TMP/watchf.out" 2>&1 &
    wpid=$!
    sleep 1.5
    echo 'int more(void) { return 2; }' > "$TMP/wt-b/src/more.c"
    wait_built $((n1 + 1)) 8
    kill "$wpid" 2>/dev/null || true
    wait "$wpid" 2>/dev/null || true
    rm codify.kvx
fi

if want fleet; then
    rm -rf "$TMP/proj"
    mkdir -p "$TMP/proj/src"
    cd "$TMP/proj"
    git init -q -b main . 2>/dev/null || git init -q .
    git config user.email t@t; git config user.name t
    printf 'export function alpha(x) {\n  const a = x + 1;\n  const b = a * 2;\n  const c = b - 3;\n  const d = c + 4;\n  const e = d * 5;\n  const f = e - 6;\n  return f;\n}\n' > src/a.ts
    "$CG" spec new fleet >/dev/null
    "$CG" spec start 1.1 >/dev/null
    "$CG" spec done 1.1 >/dev/null
    "$CG" spec mode parallel >/dev/null
    "$CG" spec add 2.1 --title "Alpha head" --wave 1 --touches 'src/a.ts' \
          --reqs 1.1 >/dev/null
    "$CG" spec add 2.2 --title "Alpha tail" --wave 1 --touches 'src/b.ts' \
          --reqs 1.1 >/dev/null
    "$CG" init >/dev/null
    printf '.codegraph/\n*.lock\ncodify.kvx\n' > .gitignore
    printf '\n[hierarchy]\ntest_gate = "true"\npr = "manual"\n' >> spec/workflow.kvx
    git add -A >/dev/null; git commit -qm base >/dev/null
    proj="$(pwd -P)"
    wt="$proj/.codegraph/worktrees"
    "$CG" fleet begin 2.1 >/dev/null
    "$CG" fleet begin 2.2 >/dev/null
    cd "$wt/task-fleet-2.1"
    CG_AGENT=w-fleet-2.1 CG_ROLE=worker CG_PARENT=wm-fleet-1 "$CG" spec start 2.1 >/dev/null
    sed -i 's/x + 1;/x + 10;/' src/a.ts
    CG_AGENT=w-fleet-2.1 "$CG" spec done 2.1 >/dev/null
    git add -A >/dev/null; git commit -qm "alpha head [spec:fleet/2.1]" >/dev/null
    "$CG" sync >/dev/null
    cd "$wt/task-fleet-2.2"
    sed -i 's/e - 6;/e - 60;/' src/a.ts
    git add -A >/dev/null; git commit -qm "alpha tail" >/dev/null
    "$CG" sync >/dev/null
    cd "$proj"
    "$CG" projection build >/dev/null

    # ---- fleet tree --json: the projection and a findings count per branch
    "$CG" fleet tree --json | pyjson "
p = d['projection']
assert p['commit'] and isinstance(p['built'], int), p
assert p['count'] == 1 and len(p['findings']) == 1, p
f = p['findings'][0]
assert f['kind'] == 'symbol' and f['symbol'] == 'alpha' and f['path'] == 'src/a.ts', f
assert f['branches'] == ['task/fleet/2.1', 'task/fleet/2.2'], f
br = {b['name']: b for b in p['branches']}
assert br['task/fleet/2.1']['findings'] == 1 and br['task/fleet/2.2']['findings'] == 1, br
assert br['task/fleet/2.1']['worktree'].endswith('/task-fleet-2.1'), br
" || fail "fleet tree --json projection: $("$CG" fleet tree --json)"
    has "$("$CG" brief)" "alpha in src/a.ts (task/fleet/2.1, task/fleet/2.2)"

    # ---- serve streams projection.* and rebuilds after the merge; merge-up
    # prints the branch's findings before it merges
    printf '[projection]\nmin_interval = "0s"\n' > codify.kvx
    python3 - "$CG" <<'PY' || fail "serve projection stream / merge-up"
import json, subprocess, sys, time, threading
CG = sys.argv[1]
p = subprocess.Popen([CG, "serve"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                     text=True, bufsize=1)
notes, replies = [], {}
cv = threading.Condition()
def read():
    for line in p.stdout:
        m = json.loads(line)
        with cv:
            (replies.__setitem__(m["id"], m) if "id" in m else notes.append(m))
            cv.notify_all()
threading.Thread(target=read, daemon=True).start()
def call(i, method, params=None):
    msg = {"jsonrpc": "2.0", "id": i, "method": method}
    if params is not None: msg["params"] = params
    p.stdin.write(json.dumps(msg) + "\n"); p.stdin.flush()
    with cv:
        cv.wait_for(lambda: i in replies, 30)
        return replies[i]
def pushed(kind, timeout):
    end = time.time() + timeout
    with cv:
        while True:
            for m in notes:
                for e in m.get("params", {}).get("events", []):
                    if e["kind"] == kind: return e
            left = end - time.time()
            if left <= 0: return None
            cv.wait(left)
call(1, "initialize")
call(2, "subscribe", {"kinds": "projection.*"})
r = subprocess.run([CG, "fleet", "merge-up", "2.1"], capture_output=True, text=True)
assert r.returncode == 0, r.stderr
out = r.stdout
i = out.find("projection: 1 known finding on task/fleet/2.1")
j = out.find("merged task/fleet/2.1 into wave/fleet/1")
assert i >= 0 and j > i, out
assert "symbol    src/a.ts  alpha  with task/fleet/2.2" in out, out
# the merge is an event; serve's refresh starts the build, and streams it
e = pushed("projection.built", 10)
assert e, notes
assert all(e["kind"].startswith("projection.")
           for m in notes for e in m.get("params", {}).get("events", [])), notes
p.stdin.close(); p.wait(10)
PY
    rm codify.kvx
fi

echo "53_projection_live: ok"
