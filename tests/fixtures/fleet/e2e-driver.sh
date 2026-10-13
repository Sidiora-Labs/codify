#!/bin/sh
# The scripted fleet for 35_fleet_e2e.sh: every role, every failure mode.
#   usage (custom driver): e2e-driver.sh ${PROMPT_FILE} ${TASK} ${ROOT} ${AGENT}
#   E2E_DIR   scratch dir for markers; CG the cg binary
#
# Workers (feature alpha):
#   2.1  fails its first attempt with an error result; the retry does the work
#   2.2  stalls on its first attempt (sleeps until stopped); the retry changes
#        alpha's signature — the interface change
#   3.2  (wave 2) writes src/d.ts calling alpha and indexes its branch, then
#        waits for 2.2 to merge into wave 1's branch so the change reaches it
#        as drift; edits docs/d.md, which 2.1's retry also edited — the
#        conflict, met when wave 2 lands on a main that carries wave 1
#   beta/2.1 plain work
# Wave managers (one per wave, CG_WAVE): land the wave once its tasks are
#   done, merged up, and every earlier wave has landed; a land that does not
#   merge is resolved on the wave branch by keeping the wave's version.
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
        i=0; while ! git -C "$ROOT/../../.." log --oneline wave/alpha/1 2>/dev/null | grep -q "into wave/alpha/1 \[spec:alpha/2.2\]"; do
            i=$((i+1)); [ $i -gt 600 ] && break; sleep 0.2
            # still working: a waiting agent that says so is not a stalled one
            [ $((i % 3)) -eq 0 ] && printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"waiting for 2.2 to merge into wave 1"}]}}'
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

# ---- the wave manager
mark "wake wave $CG_WAVE"
# a task that did not merge up: resolve it the manager's way
for f in "$D"/mergeup-"$CG_FEATURE"-*.err; do
    [ -f "$f" ] || continue
    grep -q "does not merge" "$f" || continue
    id="$(basename "$f" .err | sed "s/^mergeup-$CG_FEATURE-//")"
    mark "resolving $id"
    "$CG" fleet merge-up "$id" --keep >/dev/null 2>&1
    git checkout --theirs -- . 2>/dev/null; git add -A >/dev/null
    git commit -qm "resolve $id into $CG_BRANCH" >/dev/null 2>&1
    : > "$f"
    mark "resolved $id"
done
# where this wave and the ones before it stand
"$CG" fleet tree -f "$CG_FEATURE" --json > "$D/tree-$CG_FEATURE-$CG_WAVE.json"
left="$(python3 -c 'import json,sys; w = int(sys.argv[2]); m = [m for m in json.load(open(sys.argv[1]))["managers"] if m["wave"] == w][0]; print(m["tasks"]["total"] - m["tasks"]["done"])' "$D/tree-$CG_FEATURE-$CG_WAVE.json" "$CG_WAVE")"
[ "$left" -eq 0 ] || { mark "left $left"; exit 0; }
for b in $(python3 -c 'import json,sys; w = int(sys.argv[2]); [print(x["branch"]) for m in json.load(open(sys.argv[1]))["managers"] if m["wave"] == w for x in m["workers"]]' "$D/tree-$CG_FEATURE-$CG_WAVE.json" "$CG_WAVE"); do
    git merge-base --is-ancestor "$b" "$CG_BRANCH" 2>/dev/null || { mark "unmerged $b"; exit 0; }
done
before="$(python3 -c 'import json,sys; w = int(sys.argv[2]); print(sum(1 for m in json.load(open(sys.argv[1]))["managers"] if m["wave"] < w and not m["complete"]))' "$D/tree-$CG_FEATURE-$CG_WAVE.json" "$CG_WAVE")"
[ "$before" -eq 0 ] || { mark "waiting on $before earlier wave(s)"; exit 0; }
mark "landing wave $CG_WAVE"
"$CG" fleet land "$CG_WAVE" -f "$CG_FEATURE" >"$D/land-$CG_FEATURE-$CG_WAVE.out" 2>"$D/land-$CG_FEATURE-$CG_WAVE.err"; rc=$?
if [ "$rc" -ne 0 ] && grep -q "does not merge" "$D/land-$CG_FEATURE-$CG_WAVE.out"; then
    # main moved under the wave: bring it in, keep the wave's side of what
    # both touched, and land again
    mark "land conflict wave $CG_WAVE"
    git merge -q --no-edit "${CG_BASE:-main}" >/dev/null 2>&1
    for p in $(git diff --name-only --diff-filter=U); do
        git checkout --ours -- "$p"; git add -- "$p"
    done
    git commit -qm "merge ${CG_BASE:-main} into $CG_BRANCH" >/dev/null 2>&1
    mark "resolved land wave $CG_WAVE"
    "$CG" fleet land "$CG_WAVE" -f "$CG_FEATURE" >"$D/land-$CG_FEATURE-$CG_WAVE.out" 2>"$D/land-$CG_FEATURE-$CG_WAVE.err"; rc=$?
fi
mark "land rc=$rc"
exit 0
