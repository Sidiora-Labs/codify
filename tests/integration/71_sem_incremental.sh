#!/usr/bin/env bash
# Branch-scoped debt survives a stopped pass, and a completed pass publishes
# exactly one new generation. Unchanged scans leave the generation alone.
. "$(dirname "$0")/../lib.sh"

mkdir -p "$TMP/project/src"
cd "$TMP/project"
git init -q -b main . 2>/dev/null || git init -q .
git config user.email test@example.invalid
git config user.name Test
cat > src/one.c <<'EOF'
int alpha(void) { return 1; }
int caller(void) { return alpha(); }
EOF
"$CG" init >/dev/null
DB="$(ls .*/graph.db)"
q() { sqlite3 "$DB" "$1"; }
branch="$(q 'SELECT id FROM branches LIMIT 1')"
[ -n "$branch" ] || fail "no branch"

generation() {
    q "SELECT value FROM meta WHERE key='semantic_generation:$branch'"
}
debt() {
    q "SELECT count(*) FROM semantic_change_debt WHERE branch_id=$branch"
}

g1="$(generation)"
[ -n "$g1" ] || fail "initial semantic generation absent"
[ "$(debt)" = 0 ] || fail "initial change debt remains"
q "INSERT INTO semantic_change_debt(branch_id,file_id) VALUES(999999,1)"
"$CG" sync >/dev/null
[ "$(generation)" = "$g1" ] || fail "no-op scan republished semantics"
[ "$(q 'SELECT count(*) FROM semantic_change_debt WHERE branch_id=999999')" = 1 ] || \
    fail "another branch's debt was changed"

cat > src/one.c <<'EOF'
int alpha(void) { return 200; }
int caller(void) { return alpha(); }
EOF
"$CG" sync >/dev/null
g2="$(generation)"
[ "$g2" -gt "$g1" ] || fail "changed source did not publish semantics"
[ "$(debt)" = 0 ] || fail "changed source debt remains"

# A previous writer may have committed source chunks before it was stopped.
# The next sync must finish the branch even if metadata sees no new edit.
fid="$(q "SELECT id FROM files WHERE branch_id=$branch AND path='src/one.c'")"
q "INSERT INTO semantic_change_debt(branch_id,file_id) VALUES($branch,$fid)"
CG_SEM_FAIL_BEFORE_PUBLISH=1 "$CG" sync >/dev/null 2>&1 && \
    fail "injected interrupted pass unexpectedly succeeded"
[ "$(generation)" = "$g2" ] || fail "failed pass published generation"
[ "$(debt)" = 1 ] || fail "failed pass lost retry debt"
"$CG" sync >/dev/null
g3="$(generation)"
[ "$g3" -gt "$g2" ] || fail "interrupted pass debt was not retried"
[ "$(debt)" = 0 ] || fail "interrupted pass debt was not cleared"

rm src/one.c
"$CG" sync >/dev/null
[ "$(generation)" -gt "$g3" ] || fail "deletion did not republish semantics"
[ "$(debt)" = 0 ] || fail "deletion debt remains"
"$CG" sync >/dev/null
[ "$(debt)" = 0 ] || fail "no-op recreated debt"

# A binary source with no indexed rows can be seen on every full walk. Its
# coverage update must not manufacture semantic work or retry debt.
g4="$(generation)"
printf '\000' > src/blob.c
for attempt in 1 2; do
    "$CG" sync >/dev/null
    [ "$(generation)" = "$g4" ] || fail "binary no-op published semantics ($attempt)"
    [ "$(debt)" = 0 ] || fail "binary no-op created semantic debt ($attempt)"
    [ "$(q "SELECT value FROM meta WHERE key='index_pending_resolve:$branch'")" = 0 ] || \
        fail "binary no-op created resolution debt ($attempt)"
done
echo "PASS: semantic debt, generation, deletion and no-op"
