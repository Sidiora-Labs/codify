#!/usr/bin/env bash
# codify.kvx — project configuration: defaults, relocated spec, context and
# skills paths, rejected paths, [sync] auto=false, [index] workers, and the
# cg config command
. "$(dirname "$0")/../lib.sh"

export HOME="$TMP/home"
mkdir -p "$HOME"

json_get() {   # json_get '<json>' 'python expression over d'
    python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(eval(sys.argv[2]))' "$1" "$2"
}

# ---- no file: every setting is the default, behaviour unchanged
cp -r "$FIXTURES/specrepo" "$TMP/plain"
cd "$TMP/plain"
out="$("$CG" config)"
has "$out" "absent"
has "$out" "paths.spec     spec"
has "$out" "default"
hasnt "$out" "codify.kvx  "
out="$("$CG" spec render --check)"
has "$out" "0 stale"                      # byte parity with the goldens
out="$("$CG" config check)"
has "$out" "absent — every setting is the default"
"$CG" init >/dev/null
out="$("$CG" brief 2>&1)"
hasnt "$out" "auto-sync is off"
hasnt "$("$CG" brief --json)" "auto_sync"
[ ! -e codify.kvx ] || fail "a command wrote codify.kvx"

# ---- cg config: init, refuse overwrite, get, set, --json — before cg init
mkdir -p "$TMP/cfg"
cd "$TMP/cfg"
out="$("$CG" config init)"
has "$out" "wrote $TMP/cfg/codify.kvx"
has "$(cat codify.kvx)" "# codify.kvx — project configuration for Codify. Every key is optional."
has "$(cat codify.kvx)" 'codemap = "CODEMAP.md"      # written by cg codemap'
has "$(cat codify.kvx)" '# workers = auto'            # commented, with its default
cp codify.kvx "$TMP/template.kvx"
expect_rc 1 "$CG" config init
cmp -s codify.kvx "$TMP/template.kvx" || fail "config init overwrote the file"
[ ! -d .codegraph ] || fail "cg config created a graph"

[ "$("$CG" config get sync.auto)" = true ] || fail "get sync.auto"
[ "$("$CG" config get paths.spec)" = spec ] || fail "get paths.spec"
expect_rc 1 "$CG" config get paths.nope
out="$("$CG" config set paths.context .agents/ctx)"
has "$out" "paths.context = .agents/ctx"
[ "$("$CG" config get paths.context)" = .agents/ctx ] || fail "set did not stick"
"$CG" config set sync.auto off >/dev/null
[ "$("$CG" config get sync.auto)" = false ] || fail "bool set"
grep -q '^auto = false' codify.kvx || fail "bool written quoted: $(grep auto codify.kvx)"
grep -q 'agent-context.md, recap.md' codify.kvx || fail "set lost a comment"
cp codify.kvx "$TMP/before-bad.kvx"
expect_rc 1 "$CG" config set paths.spec /etc
expect_rc 1 "$CG" config set paths.spec ../out
expect_rc 1 "$CG" config set paths.spec ""
expect_rc 1 "$CG" config set sync.auto maybe
expect_rc 1 "$CG" config set bogus.key 1
cmp -s codify.kvx "$TMP/before-bad.kvx" || fail "a rejected set wrote the file"

d="$("$CG" config --json)"
[ "$(json_get "$d" 'd["present"]')" = True ] || fail "config --json present"
[ "$(json_get "$d" '[s["origin"] for s in d["settings"] if s["key"]=="paths.context"][0]')" = codify.kvx ] \
    || fail "origin of a set key: $d"
[ "$(json_get "$d" '[s["value"] for s in d["settings"] if s["key"]=="sync.auto"][0]')" = False ] \
    || fail "sync.auto value in JSON: $d"
[ "$(json_get "$d" 'len(d["settings"])')" = 6 ] || fail "every setting listed: $d"
out="$("$CG" config)"
has "$out" "paths.context  .agents/ctx"
has "$out" "codify.kvx"
d="$("$CG" config get paths.context --json)"
[ "$(json_get "$d" 'd["value"]')" = .agents/ctx ] || fail "get --json: $d"

# set creates the file when absent
mkdir -p "$TMP/cfg2" && cd "$TMP/cfg2"
"$CG" config set paths.codemap docs/MAP.md >/dev/null
head -1 codify.kvx | grep -q '^# codify.kvx' || fail "set did not start the file"
[ "$("$CG" config get paths.codemap)" = docs/MAP.md ] || fail "codemap path"

# check: unknown sections and keys, bad values — listed, exit 1
cat > codify.kvx <<'EOF'
[sync]
auto = maybe
debounce = 3

[paths]
spec = "/abs/spec"
skils = "x"

[extras]
k = 1
EOF
out="$("$CG" config check 2>&1)" && fail "config check should exit 1"
has "$out" "unknown section [extras]"
has "$out" "unknown key debounce in [sync]"
has "$out" "unknown key skils in [paths]"
has "$out" "[sync] auto = maybe"
has "$out" "[paths] spec"
has "$out" "codify.kvx"
d="$("$CG" config check --json 2>/dev/null || true)"
[ "$(json_get "$d" 'd["ok"]')" = False ] || fail "check --json ok: $d"
[ "$(json_get "$d" 'len(d["problems"])')" = 5 ] || fail "check --json count: $d"
[ "$(json_get "$d" 'sorted(set(p["kind"] for p in d["problems"]))')" = \
  "['bad_value', 'unknown_key', 'unknown_section']" ] || fail "kinds: $d"
out="$("$CG" config 2>&1)"
has "$out" "problem(s)"
[ "$("$CG" config get paths.spec 2>/dev/null)" = spec ] || fail "bad value must fall back"
printf '[sync]\nauto = false\n' > codify.kvx
out="$("$CG" config check)"
has "$out" ": ok"

# ---- a relocated spec directory: planning/specs
cp -r "$FIXTURES/specrepo" "$TMP/moved"
cd "$TMP/moved"
mkdir -p planning
mv spec planning/specs
printf '[paths]\nspec = "planning/specs"\n' > codify.kvx
out="$("$CG" spec status)"
has "$out" "feature: demo (planning/specs/demo/spec.kvx)"
has "$out" "next: 1.2"
( cd planning/specs/demo && "$CG" spec status >/dev/null 2>&1 ) \
    || fail "relocated root discovery from the spec subdirectory"
mkdir -p src/deep
out="$(cd src/deep && "$CG" spec next)"
has "$out" "task 1.2"
"$CG" spec render >/dev/null
has "$(cat CLAUDE.md)" "planning/specs/workflow.kvx"
has "$(cat CLAUDE.md)" "planning/specs/demo/spec.kvx"
hasnt "$(cat CLAUDE.md)" '`spec/workflow.kvx`'
[ -f planning/specs/demo/tasks.md ] || fail "mirror not rendered in place"
[ ! -e spec ] || fail "render recreated spec/"
out="$("$CG" spec render --check)"
has "$out" "0 stale"
"$CG" spec start 1.2 >/dev/null
grep -q -- "- \[-\] 1.2" planning/specs/demo/tasks.md || fail "start mirror"
out="$(cd src/deep && "$CG" spec done 1.2 2>&1)" && fail "done must run verify_cmd"
has "$out" "verify_cmd failed"
touch verify.marker
out="$(cd src/deep && "$CG" spec done 1.2)"
has "$out" "done 1.2"
grep -q -- "- \[x\] 1.2" planning/specs/demo/tasks.md || fail "done mirror"
grep -q 'status     = "done"' planning/specs/demo/spec.kvx || fail "status not written"
"$CG" init >/dev/null
out="$("$CG" brief 2>&1)"
has "$out" "demo"
out="$("$CG" check 2>&1)" || true
hasnt "$out" "no spec/workflow.kvx"

# spec new scaffolds under the configured directory
mkdir -p "$TMP/newrepo" && cd "$TMP/newrepo"
printf '[paths]\nspec = "planning/specs"\n' > codify.kvx
out="$("$CG" spec new payments)"
has "$out" "created"
[ -f planning/specs/workflow.kvx ]      || fail "workflow.kvx not under planning/specs"
[ -f planning/specs/payments/spec.kvx ] || fail "feature not under planning/specs"
[ -f planning/specs/payments/tasks.md ] || fail "mirror not under planning/specs"
[ ! -e spec ] || fail "spec new created spec/"
has "$(cat planning/specs/workflow.kvx)" "planning/specs/"
out="$("$CG" spec status)"
has "$out" "feature: payments"

# ---- context and skills paths
cp -r "$FIXTURES/sample" "$TMP/ctx"
cd "$TMP/ctx"
printf '[paths]\ncontext = ".agents/ctx"\nskills = "tools/skills"\n' > codify.kvx
"$CG" init >/dev/null
out="$("$CG" agentmd --write)"
has "$out" "$TMP/ctx/.agents/ctx/agent-context.md"
[ -f .agents/ctx/agent-context.md ] || fail "agent context not in the configured dir"
[ ! -e .codify/agent-context.md ] || fail "agent context also written to .codify"
"$CG" remember "Use the trigram index for symbol search" >/dev/null
out="$("$CG" skills promote 1)"
has "$out" "tools/skills/use-the-trigram-index-for-symbol-search/SKILL.md"
[ -f tools/skills/use-the-trigram-index-for-symbol-search/SKILL.md ] \
    || fail "skill not under the configured dir"
out="$("$CG" skills list)"
has "$out" "promoted under tools/skills"
"$CG" integrate apply >/dev/null 2>&1 || true
[ -f tools/skills/codify-workflow/SKILL.md ] || fail "workflow skill not under tools/skills"
[ ! -e .agents/skills/codify-workflow/SKILL.md ] || fail "workflow skill in the default dir"

# ---- rejected paths: absolute, .., empty — named, then the default is used
cp -r "$FIXTURES/specrepo" "$TMP/bad"
cd "$TMP/bad"
for v in '"/abs/spec"' '"../outside"' '""' '"a/../../b"'; do
    printf '[paths]\nspec = %s\n' "$v" > codify.kvx
    err="$("$CG" spec status 2>&1 >/dev/null)"
    has "$err" "codify.kvx"
    has "$err" "spec"
    out="$("$CG" spec status 2>/dev/null)"
    has "$out" "feature: demo (spec/demo/spec.kvx)"
done
# a warning is said once per process, not once per lookup
printf '[paths]\nspec = "/abs"\n' > codify.kvx
n="$("$CG" spec status 2>&1 >/dev/null | grep -c 'codify.kvx' || true)"
[ "$n" -eq 1 ] || fail "expected one warning, got $n"

# ---- cg check warns, never fails, on a bad codify.kvx
cp -r "$FIXTURES/specrepo" "$TMP/checked"
cd "$TMP/checked"
"$CG" init >/dev/null
rc0=0; "$CG" check >/dev/null 2>&1 || rc0=$?
printf '[paths]\nspec = "../x"\nnope = 1\n[weird]\n' > codify.kvx
rc1=0; out="$("$CG" check 2>&1)" || rc1=$?
[ "$rc0" -eq "$rc1" ] || fail "a bad codify.kvx changed cg check's exit ($rc0 -> $rc1)"
has "$out" "warn"
has "$out" "codify.kvx problem(s)"
hasnt "$out" "FAIL"
d="$("$CG" check --json 2>/dev/null || true)"
[ "$(json_get "$d" 'd["config_problems"]')" = 3 ] || fail "check --json config_problems: $d"
printf '[sync]\nauto = true\n' > codify.kvx
out="$("$CG" check 2>&1)" || true
has "$out" "codify.kvx is valid"

# ---- [sync] auto = false: implicit syncs leave the graph alone
cp -r "$FIXTURES/sample" "$TMP/manual"
cd "$TMP/manual"
"$CG" init >/dev/null                       # cg init always indexes
printf '[sync]\nauto = false\n' > codify.kvx
has "$("$CG" search formatName)" "formatName"
cat > src/manual.ts <<'EOF'
export function manualSentinel(): string { return "manual"; }
EOF
payload='{"session_id":"s1","hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"'"$PWD"'/src/manual.ts","old_string":"","new_string":"x"}}'
printf '%s' "$payload" | "$CG" hook post-edit >/dev/null 2>&1 || true
"$CG" agentmd >/dev/null 2>&1                 # a read command with freshness
"$CG" review >/dev/null 2>&1 || true
out="$("$CG" sync --auto --json)"            # the git hook's implicit sync
has "$out" "auto-sync is off"
printf '%s\n%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_code","arguments":{"query":"manualSentinel"}}}' \
    | "$CG" mcp > "$TMP/mcp.out" 2>/dev/null
has "$(cat "$TMP/mcp.out")" '"id":2'
hasnt "$(cat "$TMP/mcp.out")" "src/manual.ts"
out="$(timeout 5 "$CG" watch 2>&1)" || true
has "$out" "auto-sync is off"
hasnt "$("$CG" search manualSentinel 2>&1)" "src/manual.ts"
out="$("$CG" brief 2>&1)"
has "$out" "auto-sync is off"
d="$("$CG" brief --json 2>/dev/null)"
[ "$(json_get "$d" 'd["auto_sync"]')" = False ] || fail "brief --json auto_sync"
# the post-commit hook template carries the implicit flag
mkdir -p .git/hooks
"$CG" hook install >/dev/null 2>&1 || true
[ ! -f .git/hooks/post-commit ] || has "$(cat .git/hooks/post-commit)" "sync --background --auto"
# explicit sync still runs
"$CG" sync >/dev/null
has "$("$CG" search manualSentinel)" "src/manual.ts"
# and cg index still runs
cat > src/manual2.ts <<'EOF'
export function manualSecond(): string { return "two"; }
EOF
"$CG" index >/dev/null
has "$("$CG" search manualSecond)" "src/manual2.ts"

# auto on (the default): the same hook syncs
printf '[sync]\nauto = true\n' > codify.kvx
cat > src/auto.ts <<'EOF'
export function autoSentinel(): string { return "auto"; }
EOF
payload='{"session_id":"s1","hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"'"$PWD"'/src/auto.ts","old_string":"","new_string":"x"}}'
printf '%s' "$payload" | "$CG" hook post-edit >/dev/null 2>&1 || true
has "$("$CG" search autoSentinel)" "src/auto.ts"
hasnt "$("$CG" brief 2>&1)" "auto-sync is off"

# ---- [index] workers: the configured parse worker count
# Private machine slots so a concurrent suite cannot hold them (a pass that
# gets no slot drops to two workers), and no inherited override.
unset CG_INDEX_WORKERS
export CG_SLOT_DIR="$TMP/slots" CG_INDEX_SLOTS=4
cp -r "$FIXTURES/sample" "$TMP/workers"
cd "$TMP/workers"
"$CG" init >/dev/null
nfiles="$(find . -path ./.codegraph -prune -o -type f -print | wc -l)"
[ "$nfiles" -ge 3 ] || fail "the fixture needs at least three files ($nfiles)"
# every file stale again, so the next sync has all of them to parse
n=0
stale() {
    n=$((n + 1))
    find . -path ./.codegraph -prune -o -type f -print |
        xargs touch -d "2001-01-01 00:00:$(printf %02d "$n")"
}
[ "$("$CG" config get index.workers)" = auto ] || fail "workers default auto"
printf '[index]\nworkers = 1\n' > codify.kvx
stale
d="$("$CG" sync --json)"
[ "$(json_get "$d" 'd["workers"]')" = 1 ] || fail "workers = 1: $d"
printf '[index]\nworkers = 3\n' > codify.kvx
stale
d="$("$CG" sync --json)"
[ "$(json_get "$d" 'd["workers"]')" = 3 ] || fail "workers = 3: $d"
has "$("$CG" info)" "3 workers (codify.kvx)"
d="$("$CG" info --json)"
[ "$(json_get "$d" 'd["workers_origin"]')" = codify.kvx ] || fail "info origin: $d"
# cg index and cg init honour it too; the summary reports what was used
has "$("$CG" index --full)" "[3 workers"
# precedence: --workers, then CG_INDEX_WORKERS, then the file
printf '[index]\nworkers = 1\n' > codify.kvx
stale
d="$("$CG" sync --json --workers 2)"
[ "$(json_get "$d" 'd["workers"]')" = 2 ] || fail "--workers 2 beats workers = 1: $d"
has "$("$CG" index --full --workers 2)" "[2 workers"
has "$(CG_INDEX_WORKERS=2 "$CG" index --full)" "[2 workers"
has "$(CG_INDEX_WORKERS=2 "$CG" index --full --workers 3)" "[3 workers"
has "$(CG_INDEX_WORKERS=2 "$CG" info)" "2 workers (CG_INDEX_WORKERS)"
has "$("$CG" info --workers 5)" "5 workers (flag)"
expect_rc 1 "$CG" sync --workers 65
expect_rc 1 "$CG" index --workers many
# a background pass takes a quarter of the configured count, at least one
printf '[index]\nworkers = 8\n' > codify.kvx
stale
d="$("$CG" sync --json --background --wait 5000)"
[ "$(json_get "$d" 'd["workers"]')" = 2 ] || fail "background quarter of 8: $d"
# a bad value is named with its key and file, warned in cg check, and the
# machine's choice stands in for it
for v in 65 -1 many 2.5; do
    printf '[index]\nworkers = %s\n' "$v" > codify.kvx
    stale
    err="$("$CG" sync --json 2>&1 >/dev/null)"
    has "$err" "codify.kvx"
    has "$err" "[index] workers = $v"
    has "$("$CG" info 2>/dev/null)" "(machine)"
done
out="$("$CG" config check 2>&1)" && fail "config check should exit 1 on workers = 2.5"
has "$out" "[index] workers = 2.5"
out="$("$CG" check 2>&1)" || true
has "$out" "codify.kvx problem(s)"
has "$out" "[index] workers"
# config get, set, and the JSON shape
"$CG" config set index.workers 4 >/dev/null
grep -q '^workers = 4$' codify.kvx || fail "workers written: $(cat codify.kvx)"
[ "$("$CG" config get index.workers)" = 4 ] || fail "get after set"
d="$("$CG" config get index.workers --json)"
[ "$(json_get "$d" 'd["value"]')" = 4 ] || fail "value is a number: $d"
[ "$(json_get "$d" 'd["default"]')" = auto ] || fail "default auto: $d"
cp codify.kvx "$TMP/before-workers.kvx"
expect_rc 1 "$CG" config set index.workers 65
expect_rc 1 "$CG" config set index.workers -3
expect_rc 1 "$CG" config set index.workers lots
cmp -s codify.kvx "$TMP/before-workers.kvx" || fail "a rejected workers set wrote the file"
"$CG" config set index.workers auto >/dev/null
[ "$("$CG" config get index.workers)" = auto ] || fail "set back to auto"
# more workers than cores: a warning from config check, never a failure
cores="$(json_get "$("$CG" info --json)" 'd["cores_effective"]')"
if [ "$cores" -lt 64 ]; then
    printf '[index]\nworkers = 64\n' > codify.kvx
    out="$("$CG" config check)" || fail "over-cores must not fail config check"
    has "$out" "warning:"
    has "$out" "more than the $cores effective core(s)"
    d="$("$CG" config check --json)"
    [ "$(json_get "$d" 'len(d["warnings"])')" = 1 ] || fail "warnings in JSON: $d"
    [ "$(json_get "$d" 'd["ok"]')" = True ] || fail "a warning is not a problem: $d"
fi
printf '[index]\nworkers = 1\n' > codify.kvx
has "$("$CG" config check)" ": ok"
unset CG_SLOT_DIR CG_INDEX_SLOTS

echo "40_config ok"
