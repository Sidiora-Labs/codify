#!/bin/sh
# The scripted fleet for 35_fleet_e2e.sh: every role, every failure mode.
#   usage (custom driver): e2e-driver.sh ${PROMPT_FILE} ${TASK} ${ROOT} ${AGENT}
#   E2E_DIR   scratch dir for markers; CG the cg binary
#
# Workers (feature alpha):
#   2.1  fails its first attempt with an error result; the retry does the work
#   2.2  stalls on its first attempt (sleeps until stopped); the retry changes
#        alpha's signature — the interface change
#   3.2  writes src/d.ts calling alpha and indexes its branch, then waits for
#        2.2 to merge so the change lands under it; edits docs/d.md, which
#        2.1's retry also edited — the merge conflict
#   beta/2.1 plain work
# Manager: resolves a conflicting merge-up by taking the wave's version, and
#   lands once every task is done.
PF="$1"; TASK="$2"; ROOT="$3"; AGENT="$4"
D="${E2E_DIR:?E2E_DIR}"; CG="${CG:-cg}"
cd "$ROOT" || exit 9
mark() { echo "$(date +%s%N) $CG_ROLE $CG_FEATURE/${TASK:-} $1" >> "$D/log"; }
attempt_of() { n=1; while [ -f "$D/att-$CG_FEATURE-$1-$n" ]; do n=$((n+1)); done; : > "$D/att-$CG_FEATURE-$1-$n"; echo "$n"; }

if [ "$CG_ROLE" = worker ]; then
    n="$(attempt_of "$TASK")"
    mark "start attempt $n"
    cp "$PF" "$D/prompt-$CG_FEATURE-$TASK-$n"
    printf '%s\n' '{"type":"system","subtype":"init","session_id":"s-'"$AGENT"'-'"$n"'","model":"fake"}'
    case "$CG_FEATURE/$TASK" in
      alpha/2.1)
        if [ "$n" = 1 ]; then
            printf '%s\n' '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"tsc: cannot find name beta","total_cost_usd":0.02,"num_turns":1}'
            mark "fail"; exit 1
        fi
        echo 'export function beta(): number { return 2; }' > src/b.ts
        echo "# doc, by 2.1" > docs/d.md ;;         # the other side of 3.2's conflict
      alpha/2.2)
        if [ "$n" = 1 ]; then mark "stalling"; sleep 300; exit 0; fi
        printf 'export function alpha(n: number): number {\n  return n;\n}\n' > src/a.ts ;;
      alpha/3.2)
        printf 'import { alpha } from "./a";\nexport function delta(): number {\n  return alpha();\n}\n' > src/d.ts
        "$CG" sync >/dev/null 2>&1
        mark "indexed, waiting for 2.2"
        i=0; while ! git -C "$ROOT/../../.." log --oneline feature/alpha 2>/dev/null | grep -q "into feature/alpha \[spec:alpha/2.2\]"; do
            i=$((i+1)); [ $i -gt 600 ] && break; sleep 0.2
            # still working: a waiting agent that says so is not a stalled one
            [ $((i % 3)) -eq 0 ] && printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"waiting for 2.2 to land on the feature branch"}]}}'
        done
        mark "2.2 merged"
        printf 'import { alpha } from "./a";\nexport function delta(): number {\n  return alpha(4);\n}\n' > src/d.ts
        echo "# doc, by the worker" > docs/d.md ;;
      beta/2.1)
        echo 'export function b1(): number { return 1; }' > src/b1.ts ;;
    esac
    printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"src"}}],"usage":{"input_tokens":100,"output_tokens":10}}}'
    "$CG" spec start "$TASK" >/dev/null 2>&1
    "$CG" spec done "$TASK" >/dev/null 2>&1 || { mark "done refused"; exit 1; }
    git add -A >/dev/null; git commit -qm "$TASK [spec:$CG_FEATURE/$TASK]" >/dev/null
    printf '%s\n' '{"type":"result","subtype":"success","is_error":false,"total_cost_usd":0.05,"num_turns":3,"result":"done"}'
    mark "qualified"
    "$CG" fleet merge-up "$TASK" >"$D/mergeup-$CG_FEATURE-$TASK.err" 2>&1; rc=$?
    mark "merge-up rc=$rc"
    exit 0
fi

# ---- the feature manager
mark "wake"
# a wave that did not merge: resolve it the manager's way
for f in "$D"/mergeup-"$CG_FEATURE"-*.err; do
    [ -f "$f" ] || continue
    grep -q "does not merge" "$f" || continue
    id="$(basename "$f" .err | sed "s/^mergeup-$CG_FEATURE-//")"
    mark "resolving $id"
    "$CG" fleet merge-up "$id" --keep >/dev/null 2>&1
    git checkout --theirs -- . 2>/dev/null; git add -A >/dev/null
    git commit -qm "resolve $id into feature/$CG_FEATURE" >/dev/null 2>&1
    : > "$f"
    mark "resolved $id"
done
left="$("$CG" fleet tree -f "$CG_FEATURE" --json | python3 -c 'import json,sys; m = json.load(sys.stdin)["managers"][0]; print(m["tasks"]["total"] - m["tasks"]["done"])')"
[ "$left" -eq 0 ] || { mark "left $left"; exit 0; }
unmerged="$(git branch --no-merged "feature/$CG_FEATURE" --list "task/$CG_FEATURE/*" | tr -d ' *')"
[ -z "$unmerged" ] || { mark "unmerged $unmerged"; exit 0; }
mark "landing"
"$CG" fleet land "$CG_FEATURE" >/dev/null 2>"$D/land-$CG_FEATURE.err"; rc=$?
mark "land rc=$rc"
exit 0
