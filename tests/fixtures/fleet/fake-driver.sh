#!/bin/sh
# A scripted agent for orchestrator tests: speaks Claude Code stream-json
# (default) or Codex exec --json (FAKE_DIALECT=codex) on stdout, does the
# task's work through the real cg CLI, and qualifies it.
#   usage (custom driver template):
#     fake-driver.sh ${PROMPT_FILE} ${TASK} ${ROOT} ${AGENT} ${MODEL}
# FAKE_OUT names the file each task writes (default out-<task>.txt under
# ROOT); FAKE_FAIL=<task> makes that task exit 1 without qualifying.
PF="$1"; TASK="$2"; ROOT="$3"; AGENT="$4"; MODEL="${5:-}"
CG="${CG:-cg}"
[ -s "$PF" ] || exit 9
cd "$ROOT" || exit 9
out="${FAKE_OUT:-out-$TASK.txt}"
if [ "${FAKE_DIALECT:-claude}" = codex ]; then
    printf '%s\n' '{"type":"thread.started","thread_id":"th-'"$AGENT"'"}'
    printf '%s\n' '{"type":"turn.started"}'
    printf '%s\n' '{"type":"item.started","item":{"id":"i1","type":"command_execution","command":"touch '"$out"'","status":"in_progress"}}'
    : > "$out"
    printf '%s\n' '{"type":"item.completed","item":{"id":"i1","type":"command_execution","command":"touch '"$out"'","exit_code":0,"status":"completed"}}'
    printf '%s\n' '{"type":"item.completed","item":{"id":"i2","type":"agent_message","text":"Wrote '"$out"' for '"$TASK"'."}}'
    printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":1200,"cached_input_tokens":300,"output_tokens":45}}'
else
    printf '%s\n' '{"type":"system","subtype":"init","session_id":"sess-'"$AGENT"'","model":"'"${MODEL:-fake-model}"'","tools":["Bash","Edit"]}'
    printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"Starting '"$TASK"'."},{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"touch '"$out"'"}}],"usage":{"input_tokens":900,"output_tokens":30}}}'
    : > "$out"
    echo "not json: a stderr line mixed into the log" >&2
    printf '%s\n' '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":""}]}}'
    printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t2","name":"Edit","input":{"file_path":"'"$out"'","old_string":"","new_string":"x"}}],"usage":{"input_tokens":950,"output_tokens":20}}}'
fi
if [ "${FAKE_FAIL:-}" = "$TASK" ]; then
    [ "${FAKE_DIALECT:-claude}" = codex ] \
        && printf '%s\n' '{"type":"turn.failed","error":{"message":"scripted failure"}}' \
        || printf '%s\n' '{"type":"result","subtype":"error_during_execution","is_error":true,"total_cost_usd":0.004,"num_turns":2,"duration_ms":40,"session_id":"sess-'"$AGENT"'","usage":{"input_tokens":1850,"output_tokens":50}}'
    exit 1
fi
"$CG" spec done "$TASK" >/dev/null 2>&1 || exit 7
if [ "${FAKE_DIALECT:-claude}" != codex ]; then
    printf '%s\n' '{"type":"result","subtype":"success","is_error":false,"total_cost_usd":0.0123,"num_turns":3,"duration_ms":55,"session_id":"sess-'"$AGENT"'","result":"Done: '"$TASK"' qualified.","usage":{"input_tokens":1850,"output_tokens":50}}'
fi
exit 0
