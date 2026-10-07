#!/usr/bin/env bash
# The write journal: a lifecycle write that finds the database busy past the
# lock wait is queued under .codegraph/journal/ and the command succeeds; the
# next process that holds the write lock applies it, once, with the fields it
# was written with. Writes that must see the live state (claims) still exit 75
# and say why they are not journaled.
. "$(dirname "$0")/../lib.sh"

cp -r "$FIXTURES/sample" "$TMP/proj"
cd "$TMP/proj"
"$CG" init >/dev/null
"$CG" spec new jr >/dev/null
printf 'verify_cmd = "true"\n' >> spec/jr/spec.kvx
"$CG" sync >/dev/null

DB="$TMP/proj/.codegraph/graph.db"
JDIR="$TMP/proj/.codegraph/journal"

# hold_lock <seconds> — another process holds the WAL write lock, the way a
# long index transaction in an editor's cg lsp would (same as 23_dblock.sh).
hold_lock() {
    python3 - "$DB" "$1" <<'PY' &
import sqlite3, sys, time
c = sqlite3.connect(sys.argv[1], isolation_level=None, timeout=30)
c.execute("BEGIN IMMEDIATE")
c.execute("UPDATE meta SET value=value WHERE key='schema_version'")
print("held", flush=True)
time.sleep(float(sys.argv[2]))
c.execute("COMMIT")
PY
    sleep 0.5
}

sql() { python3 -c "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print('\n'.join('|'.join('' if v is None else str(v) for v in r) for r in c.execute(sys.argv[2])))" "$DB" "$1"; }
pending() { find "$JDIR" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' '; }
export CG_BUSY_TIMEOUT_MS=200

# 1. Under a four-second hold: remember exits 0 and says queued; --json says
#    so too; recall lists the note marked queued; brief, state and check count
#    it (check as a warning, exit 0); a claim still exits 75, not journaled.
hold_lock 4
out="$("$CG" remember "journal keeps decisions" --type decision --task jr/1.1 \
       --symbols formatName --files src/a.c 2>&1)"
has "$out" "queued"
has "$out" "next cg command"
js="$("$CG" remember "second queued note" --json 2>/dev/null)"
has "$js" '"queued":true'
[ "$(pending)" = 2 ] || fail "expected 2 journal records, got $(pending)"
rec="$(ls "$JDIR"/*.json | head -1)"
cp "$rec" "$TMP/saved-record.json"
rc_line="$("$CG" recall "journal keeps" 2>&1)"
has "$rc_line" "queued"
has "$rc_line" "journal keeps decisions"
has "$("$CG" recall "journal keeps" --json)" '"queued":true'
has "$("$CG" brief 2>&1)" "journal: 2 write(s) queued"
has "$("$CG" brief --json 2>/dev/null)" '"journal":{"pending":2,"failed":0}'
has "$("$CG" state 2>&1)" "Write journal: 2 write(s) queued"
rc=0; ck="$("$CG" check 2>&1)" || rc=$?
[ "$rc" -eq 0 ] || fail "check must only warn on pending journal records, got $rc"
has "$ck" "warn  write journal: 2 queued"
lst="$("$CG" journal list 2>&1)"
has "$lst" "pending: 2"
has "$lst" "memory.add"
has "$("$CG" journal list --json)" '"pending":[{"id":'
rc=0; out="$("$CG" spec claim 1.1 --agent beta 2>&1)" || rc=$?
[ "$rc" -eq 75 ] || fail "claim must still exit 75 under a held lock, got $rc"
has "$out" "database is busy"
has "$out" "safe to retry"
has "$out" "CG_BUSY_TIMEOUT_MS"
has "$out" "not journaled"
rc=0; out="$("$CG" journal apply --json 2>/dev/null)" || rc=$?
[ "$rc" -eq 75 ] || fail "journal apply under a held lock should exit 75, got $rc"
has "$out" '"busy":true'
wait

# 2. The first command after the hold applies the queue, in order, with the
#    original fields; the journal directory is left empty.
"$CG" recall nothing-matches >/dev/null 2>&1
[ "$(pending)" = 0 ] || fail "journal not drained: $(ls "$JDIR")"
want="$(python3 -c "
import json,sys; r=json.load(open(sys.argv[1])); a=r['args']
print('|'.join(str(x) for x in [a['created'],a['type'],a['task'],a['symbols'],a['files'],a['source'],r['branch'] or '']))" "$TMP/saved-record.json")"
got="$(sql "SELECT created,type,task,symbols,files,source,ifnull(branch,'') FROM memories WHERE body='journal keeps decisions'")"
[ "$got" = "$want" ] || fail "memory fields changed in replay: got '$got' want '$want'"
has "$want" "decision|jr/1.1|formatName|src/a.c|manual"
[ "$(sql "SELECT COUNT(*) FROM memories WHERE body='second queued note'")" = 1 ] \
    || fail "second queued memory not applied"
has "$("$CG" recall "journal keeps" 2>&1)" "#"
hasnt "$("$CG" brief 2>&1)" "journal:"

# 3. Replaying twice changes nothing: the same record put back (under its own
#    name, and again under another) is skipped.
before="$(sql "SELECT COUNT(*) FROM memories")"
cp "$TMP/saved-record.json" "$JDIR/$(basename "$rec")"
out="$("$CG" journal apply --json)"
has "$out" '"failed":0'
[ "$(sql "SELECT COUNT(*) FROM memories")" = "$before" ] \
    || fail "a replayed record was applied twice"
[ "$(pending)" = 0 ] || fail "replayed record left behind"
cp "$TMP/saved-record.json" "$JDIR/9999999999999-0000001-0001.json"
"$CG" journal apply >/dev/null
[ "$(sql "SELECT COUNT(*) FROM memories")" = "$before" ] \
    || fail "a renamed copy of an applied record was applied again"

# 4. A corrupted record and one from a newer format land in failed/ and are
#    reported once; the valid record between them is still applied.
printf '{"v":1,"id":"broken' > "$JDIR/0000000000001-0000001-0001.json"
printf '{"v":99,"id":"0000000000002-0000001-0001","at":2,"op":"memory.add","args":{}}' \
    > "$JDIR/0000000000002-0000001-0001.json"
python3 - "$TMP/saved-record.json" "$JDIR/0000000000003-0000001-0001.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
r["id"] = "0000000000003-0000001-0001"
r["args"]["body"] = "applied between two bad records"
json.dump(r, open(sys.argv[2], "w"))
PY
err="$("$CG" brief 2>&1 >/dev/null)"
[ "$(printf '%s\n' "$err" | grep -c 'was refused')" = 2 ] \
    || fail "expected two refusal reports, got: $err"
has "$err" "0000000000001-0000001-0001"
has "$err" "failed/"
[ -f "$JDIR/failed/0000000000001-0000001-0001.json" ] || fail "corrupt record not moved"
[ -f "$JDIR/failed/0000000000001-0000001-0001.err" ] || fail "no error beside the failed record"
[ -f "$JDIR/failed/0000000000002-0000001-0001.json" ] || fail "newer-version record not moved"
[ "$(sql "SELECT COUNT(*) FROM memories WHERE body='applied between two bad records'")" = 1 ] \
    || fail "a bad record stopped the replay"
again="$("$CG" brief 2>&1 >/dev/null)"
hasnt "$again" "was refused"
has "$("$CG" check 2>&1)" "2 refused"
has "$("$CG" journal list --json)" '"error":'
has "$("$CG" journal drop --failed --json)" '"dropped":2'
[ -z "$(ls "$JDIR/failed" 2>/dev/null)" ] || fail "drop --failed left files"

# 5. drop <id> removes one pending record; drop --all clears the queue.
hold_lock 4
"$CG" remember "dropped before it lands" >/dev/null 2>&1
"$CG" remember "also dropped" >/dev/null 2>&1
id="$("$CG" journal list --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["pending"][0]["id"])')"
has "$("$CG" journal drop "$id" --json)" '"dropped":1'
[ "$(pending)" = 1 ] || fail "drop <id> removed the wrong count"
has "$("$CG" journal drop --all)" "dropped 1"
wait
"$CG" brief >/dev/null 2>&1
[ "$(sql "SELECT COUNT(*) FROM memories WHERE body IN ('dropped before it lands','also dropped')")" = 0 ] \
    || fail "a dropped record was applied"

# 6. spec done after a passed verification never exits 75: the kvx status is
#    written, the lease release and outcome memory are journaled, and the
#    next command applies them.
"$CG" spec mode parallel >/dev/null
"$CG" spec claim 1.1 --agent alpha >/dev/null
CG_AGENT=alpha "$CG" spec start 1.1 >/dev/null
hold_lock 4
rc=0; out="$(CG_AGENT=alpha "$CG" spec done 1.1 --json 2>/dev/null)" || rc=$?
[ "$rc" -eq 0 ] || fail "spec done exited $rc under a held lock after passing"
has "$out" '"queued":true'
has "$(cat spec/jr/spec.kvx)" 'status     = "done"'
wait
"$CG" journal apply >/dev/null
[ "$(sql "SELECT COUNT(*) FROM leases")" = 0 ] || fail "lease not released by replay"
[ "$(sql "SELECT state FROM attempts WHERE task='jr/1.1'")" = completed ] \
    || fail "attempt not finished by replay"
[ "$(sql "SELECT COUNT(*) FROM memories WHERE type='outcome' AND task='jr/1.1'")" = 1 ] \
    || fail "outcome memory not applied"

# 7. Two processes replaying at once never apply a record twice.
hold_lock 4
for i in 1 2 3 4 5 6; do "$CG" remember "race note $i" >/dev/null 2>&1; done
wait
"$CG" journal apply >/dev/null 2>&1 & "$CG" journal apply >/dev/null 2>&1 &
"$CG" brief >/dev/null 2>&1
wait
"$CG" journal apply >/dev/null
[ "$(sql "SELECT COUNT(*) FROM memories WHERE body LIKE 'race note %'")" = 6 ] \
    || fail "concurrent replay applied a record twice or lost one"
[ "$(pending)" = 0 ] || fail "concurrent replay left records behind"

echo "42_journal ok"
