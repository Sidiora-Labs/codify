#!/usr/bin/env bash
# drift: where work parts from what it declared, and tasks that would
# collide if run at once.
#   spec — cg spec done and cg fleet merge-up report paths outside touches
#          and public symbols changed but not declared (warn; an opt-in
#          approve = ["drift"] makes merge-up wait); cg drift check;
#          collision prediction (touch overlap, call-graph neighbours) and
#          the supervisor serializing a predicted collision
# Run one section: 33_drift.sh spec
. "$(dirname "$0")/../lib.sh"
section="${1:-all}"

want() { [ "$section" = all ] || [ "$section" = "$1" ]; }

setup_repo() {
    rm -rf "$TMP/proj"
    mkdir -p "$TMP/proj/src" "$TMP/proj/lib"
    cd "$TMP/proj"
    git init -q -b main . 2>/dev/null || git init -q .
    git config user.email t@t; git config user.name t
    cat > src/a.ts <<'EOF'
export function alpha(): number {
  return 1;
}
function helperA(): number {
  return 2;
}
EOF
    cat > lib/b.ts <<'EOF'
export function beta(): number {
  return 3;
}
EOF
    cat > src/c.ts <<'EOF'
import { alpha } from "./a";
export function gamma(): number {
  return alpha() + 1;
}
EOF
    echo 'export function delta(): number { return 4; }' > src/d.ts
    "$CG" spec new drift >/dev/null
    "$CG" spec docs off >/dev/null
    "$CG" spec start 1.1 >/dev/null
    "$CG" spec done 1.1 >/dev/null
    "$CG" spec mode parallel >/dev/null
    "$CG" spec add 2.1 --title "Alpha" --wave 1 --reqs 1.1 --symbols alpha \
          --touches 'src/a.ts' >/dev/null
    "$CG" spec add 2.2 --title "Delta" --wave 1 --reqs 1.1 --symbols delta \
          --touches 'src/d.ts' >/dev/null
    "$CG" spec add 3.1 --title "Gamma" --wave 2 --reqs 1.1 --symbols gamma \
          --touches 'src/c.ts' >/dev/null
    "$CG" spec add 3.2 --title "Beta" --wave 2 --reqs 1.1 --symbols beta \
          --touches 'lib/b.ts' >/dev/null
    "$CG" init >/dev/null
    printf '.codegraph/\n*.lock\n' > .gitignore
    git add -A >/dev/null; git commit -qm base >/dev/null
}

evk() { "$CG" events --kind "$1" --json -n 200; }

if want spec; then
    setup_repo
    # ---- spec done: in scope, plus a stray path and an undeclared export
    "$CG" spec start 2.1 >/dev/null
    printf 'export function alpha(): number {\n  return 10;\n}\nfunction helperA(): number {\n  return 20;\n}\n' > src/a.ts
    printf 'export function beta(): number {\n  return 30;\n}\n' > lib/b.ts
    out="$("$CG" spec done 2.1 2>&1)"
    has "$out" "done 2.1 — Alpha"                    # drift never refuses
    has "$out" "drift: 1 path(s) changed outside the task's touches: lib/b.ts"
    has "$out" "drift: 1 public symbol(s) changed but not declared: beta (lib/b.ts)"
    hasnt "$out" "helperA"                           # private: not drift
    hasnt "$out" "alpha (src/a.ts)"                  # declared: not drift
    evk drift.spec | python3 -c '
import json, sys
ev = [json.loads(l) for l in sys.stdin if l.strip()]
assert len(ev) == 1 and ev[0]["subject"] == "drift/2.1", ev
p = ev[0]["payload"]
assert p["files_outside"] == ["lib/b.ts"], p
assert [s["name"] for s in p["symbols_undeclared"]] == ["beta"], p
assert p["base"] == "HEAD", p
' || fail "drift.spec event"

    # ---- cg drift check, and a task with no drift says so
    out="$("$CG" drift check 2.1 --json)"
    echo "$out" | python3 -c '
import json, sys
d = json.load(sys.stdin)
assert d["findings"] == 2 and d["files_outside"] == ["lib/b.ts"], d
' || fail "drift check json"
    git checkout -q -- lib/b.ts
    out="$("$CG" drift check 2.1)"
    has "$out" "no drift: drift/2.1 stays inside its declared scope"
    git add -A >/dev/null; git commit -qm "alpha [spec:drift/2.1]" >/dev/null

    # ---- collision prediction: overlapping touches, call-graph neighbours
    out="$("$CG" drift collisions --json)"
    echo "$out" | python3 -c '
import json, sys
d = json.load(sys.stdin)
pairs = {(c["a"], c["b"]): c["why"] for c in d["collisions"]}
assert ("2.2", "3.1") not in pairs and ("2.2", "3.2") not in pairs, pairs
assert ("3.1", "3.2") not in pairs, pairs
' || fail "unexpected collisions: $out"
    "$CG" spec add 4.1 --title "Alpha again" --wave 3 --reqs 1.1 \
          --symbols helperA --touches 'src/a.ts' >/dev/null
    "$CG" spec add 4.2 --title "Uses alpha" --wave 3 --reqs 1.1 \
          --symbols gamma --touches 'src/e.ts' >/dev/null
    "$CG" spec add 4.3 --title "Alpha API" --wave 3 --reqs 1.1 \
          --symbols alpha --touches 'src/f.ts' >/dev/null
    out="$("$CG" drift collisions --json)"
    echo "$out" | python3 -c '
import json, sys
d = json.load(sys.stdin)
pairs = {(c["a"], c["b"]): c["why"] for c in d["collisions"]}
assert "both change gamma" in pairs.get(("3.1", "4.2"), ""), pairs
assert "call one another" in pairs.get(("4.2", "4.3"), ""), pairs
assert "src/c.ts" not in json.dumps(pairs.get(("4.2", "4.3"), "")), pairs
' || fail "predicted collisions: $out"
    out="$("$CG" drift collisions)"
    has "$out" "call one another"

    # ---- merge-up: drift reported against the wave's declaration, and an
    #      opt-in approval makes an agent's merge-up wait
    setup_repo
    proj="$(pwd -P)"
    cat >> spec/workflow.kvx <<'EOF'

[hierarchy]
test_gate = "true"
pr        = "manual"

[role.worker]
approve = ["drift"]
EOF
    git add -A >/dev/null; git commit -qm "hierarchy" >/dev/null
    "$CG" fleet begin 2.1 >/dev/null
    cd "$proj/.codegraph/worktrees/wave-drift-1"
    CG_AGENT=w-drift-1 CG_ROLE=worker CG_PARENT=fm-drift CG_BASE=feature/drift \
        "$CG" spec start 2.1 >/dev/null
    printf 'export function alpha(): number {\n  return 7;\n}\n' > src/a.ts
    printf 'export function beta(): number {\n  return 8;\n}\n' > lib/b.ts
    out="$(CG_AGENT=w-drift-1 CG_BASE=feature/drift "$CG" spec done 2.1 2>&1)"
    has "$out" "drift: 1 path(s) changed outside the task's touches: lib/b.ts"
    git add -A >/dev/null; git commit -qm "alpha [spec:drift/2.1]" >/dev/null
    "$CG" sync >/dev/null
    cd "$proj"
    rc=0; out="$(CG_ROLE=worker CG_AGENT=w-drift-1 "$CG" fleet merge-up 2.1 2>&1)" || rc=$?
    [ "$rc" -eq 4 ] || fail "an agent's drifting merge-up waits (4), got $rc: $out"
    has "$out" "drift: 1 path(s) changed outside the task's touches: lib/b.ts"
    has "$out" "drift of drift/2.1 waits for approval #"
    id="$("$CG" fleet approvals --json | python3 -c 'import json,sys; a=json.load(sys.stdin)["approvals"]; print(a[0]["id"] if a else "")')"
    [ -n "$id" ] || fail "no drift approval recorded"
    hasnt "$(git log --oneline feature/drift 2>/dev/null)" "merge wave/drift/1"
    "$CG" fleet approve "$id" >/dev/null
    out="$(CG_ROLE=worker CG_AGENT=w-drift-1 "$CG" fleet merge-up 2.1 2>&1)"
    has "$out" "merged wave/drift/1 into feature/drift"
    # a person running it is its own approval: no gate, still reported
    evk drift.spec | python3 -c '
import json, sys
ev = [json.loads(l) for l in sys.stdin if l.strip()]
m = [e for e in ev if e["payload"]["head"] == "wave/drift/1"]
assert m and m[0]["payload"]["base"] == "feature/drift", ev
' || fail "merge-up drift event"

    # ---- the supervisor runs a predicted collision one after the other
    setup_repo
    cat >> spec/workflow.kvx <<EOF

[hierarchy]
test_gate = "true"
pr        = "manual"

[agents]
driver = "custom"
cmd    = "sh $TMP/drv.sh \${TASK} \${ROOT}"
max    = 2
EOF
    # 2.2 (wave 1) and 3.3 (wave 2) are independent by wave, but 3.3 edits
    # a caller of what 2.2 changes
    "$CG" spec add 3.3 --title "Delta user" --wave 2 --reqs 1.1 \
          --symbols useDelta --touches 'src/d2.ts' >/dev/null
    printf 'import { delta } from "./d";\nexport function useDelta(): number {\n  return delta();\n}\n' > src/d2.ts
    for t in 2.1 3.1 3.2; do "$CG" spec start $t >/dev/null 2>&1; "$CG" spec done $t >/dev/null 2>&1; done
    "$CG" sync >/dev/null
    cat > "$TMP/drv.sh" <<EOF
#!/bin/sh
TASK="\$1"; cd "\$2" || exit 9
if [ "\$CG_ROLE" = worker ]; then
    echo "start \$TASK \$(date +%s%N)" >> "$TMP/order"
    sleep 1
    "$CG" spec start "\$TASK" >/dev/null 2>&1
    "$CG" spec done "\$TASK" >/dev/null 2>&1 || exit 1
    git add -A >/dev/null; git commit -qm "\$TASK [spec:drift/\$TASK]" >/dev/null
    echo "end \$TASK \$(date +%s%N)" >> "$TMP/order"
    exec "$CG" fleet merge-up "\$TASK" >/dev/null
fi
left="\$("$CG" fleet tree -f drift --json | python3 -c 'import json,sys; m = json.load(sys.stdin)["managers"][0]; print(m["tasks"]["total"] - m["tasks"]["done"])')"
[ "\$left" -eq 0 ] || exit 0
exec "$CG" fleet land drift --no-pr >/dev/null
EOF
    git add -A >/dev/null; git commit -qm "collision setup" >/dev/null
    rm -f "$TMP/order"
    out="$(timeout 120 "$CG" fleet up --foreground -n 2 2>&1)" || fail "collision run: $out"
    has "$out" "3.3 waits for 2.2 — predicted collision"
    has "$out" "[fleet] drift complete"
    python3 - "$TMP/order" <<'EOF' || fail "3.3 ran alongside 2.2: $(cat "$TMP/order")"
import sys
ev = {}
for line in open(sys.argv[1]):
    kind, task, t = line.split()
    ev[(kind, task)] = int(t)
assert ev[("start", "3.3")] >= ev[("end", "2.2")], ev
EOF
    evk drift.collision | python3 -c '
import json, sys
ev = [json.loads(l) for l in sys.stdin if l.strip()]
assert any(e["payload"]["task"] == "3.3" and e["payload"]["with"] == "2.2" for e in ev), ev
' || fail "collision event"
fi

echo "drift OK"
