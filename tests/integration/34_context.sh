#!/usr/bin/env bash
# context: the task packet an agent starts from (cg resume --prompt), built
# from the spec and the graph and fitted to a budget; the manager's packet
# (cg fleet brief); and cg work update's upstream delta.
. "$(dirname "$0")/../lib.sh"

mkdir -p "$TMP/proj/src"
cd "$TMP/proj"
git init -q -b main . 2>/dev/null || git init -q .
git config user.email t@t; git config user.name t
cat > src/auth.ts <<'EOF'
/** Hash a password for storage and comparison. */
export function hashPassword(p: string): string {
  return digest(p);
}
function digest(x: string): string {
  return x.split("").reverse().join("");
}
EOF
cat > src/login.ts <<'EOF'
import { hashPassword } from "./auth";
import { lookup } from "./store";
export function login(user: string, pass: string): boolean {
  return hashPassword(pass) === lookup(user);
}
EOF
cat > src/store.ts <<'EOF'
export function lookup(user: string): string {
  return user.toUpperCase();
}
EOF
"$CG" spec new ctx >/dev/null
"$CG" spec docs off >/dev/null
"$CG" spec start 1.1 >/dev/null
"$CG" spec done 1.1 >/dev/null
"$CG" spec mode parallel >/dev/null
"$CG" spec add 2.1 --title "Salted hashing" --wave 1 --reqs 1.1 \
      --symbols hashPassword,saltFor --touches 'src/auth.ts' \
      --verify 'true' --do "Add saltFor(user);Hash with the salt" >/dev/null
"$CG" spec add 2.2 --title "Store lookups" --wave 1 --reqs 1.1 \
      --symbols lookup --touches 'src/store.ts' >/dev/null
"$CG" spec add 2.3 --title "Store cache" --wave 1 --reqs 1.1 \
      --touches 'src/cache.ts' >/dev/null
"$CG" spec add 3.1 --title "Login audit" --wave 2 --requires 2.2 --reqs 1.1 \
      --symbols login,auditLogin --touches 'src/login.ts,src/audit.ts' >/dev/null
"$CG" init >/dev/null
printf '.codegraph/\n*.lock\n' > .gitignore
git add -A >/dev/null; git commit -qm base >/dev/null
# 2.2 is done, with a tagged commit that says what it did
"$CG" spec start 2.2 >/dev/null
echo '// cached' >> src/store.ts
"$CG" spec done 2.2 >/dev/null
git add -A >/dev/null; git commit -qm "store: uppercase lookups [spec:ctx/2.2]" >/dev/null
"$CG" git-sync >/dev/null
"$CG" remember "Passwords must be salted per user, never globally" \
      --type constraint --task ctx/2.1 >/dev/null
"$CG" remember "hashPassword output is compared, so keep it deterministic" \
      --type decision >/dev/null
CG_AGENT=w-sib "$CG" spec claim 2.3 >/dev/null
"$CG" sync >/dev/null

# ---- the worker's packet
out="$("$CG" resume --task 2.1 --prompt)"
has "$out" "# resume: ctx/2.1"                       # the old header stays
has "$out" "## Task 2.1 — Salted hashing"
has "$out" "Acceptance criteria — the work is judged against these:"
has "$out" "- 1.1: "
has "$out" "Steps:"
has "$out" "- Add saltFor(user)"
has "$out" "- edit only: src/auth.ts"
has "$out" "- symbols to introduce or change: hashPassword saltFor"
has "$out" "- verified by: true"
has "$out" "### The code you will touch (from the graph)"
has "$out" '`hashPassword` (function) src/auth.ts:2'
has "$out" "purpose: /** Hash a password for storage and comparison. */"
has "$out" "return digest(p);"                          # its opening lines
has "$out" "called by: login src/login.ts:3"
has "$out" "calls: digest src/auth.ts:5"
has "$out" '`saltFor` — new: not in the graph yet; this task introduces it'
has "$out" "### Working alongside you — leave their paths alone"
has "$out" "- w-sib on ctx/2.3: src/cache.ts"
has "$out" "### Decisions and constraints"
has "$out" "Passwords must be salted per user, never globally"
has "$out" "hashPassword output is compared, so keep it deterministic"
has "$out" "### Files in scope"
has "$out" "src/auth.ts: hashPassword, digest"
hasnt "$out" "fleet:"                                  # nothing outside a fleet
hasnt "$out" "### What your prerequisites produced"    # 2.1 requires nothing
tail="${out##*when done:}"
[ -n "$tail" ] || fail "the closing instructions must still end the prompt"

# ---- prerequisites: what 2.2 actually produced, with its commit
out="$("$CG" resume --task 3.1 --prompt)"
has "$out" "### What your prerequisites produced"
has "$out" "- 2.2 Store lookups (done)"
has "$out" '`lookup` (function) src/store.ts:1'
has "$out" "store: uppercase lookups [spec:ctx/2.2]"
has "$out" '`login` (function) src/login.ts:3'
has "$out" "calls: hashPassword src/auth.ts:2, lookup src/store.ts:1"
has "$out" '`auditLogin` — new'
has "$out" "src/login.ts: login"
has "$out" "src/audit.ts — new: no indexed file matches yet"
has "$out" "- w-sib on ctx/2.3"                       # a live sibling in the feature

# ---- the budget: the task always, the rest trimmed and named
out="$("$CG" resume --task 2.1 --prompt --budget 150)"
packet="${out#*## Task 2.1}"
packet="${packet%%when done:*}"
has "$out" "## Task 2.1 — Salted hashing"
has "$out" "Acceptance criteria"                        # never trimmed
[ "${#packet}" -lt 1400 ] || fail "a 150-token packet ran to ${#packet} bytes"
case "$out" in
  *"omitted to fit a 150-token budget"*|*"trimmed to fit the budget"*) : ;;
  *) fail "an over-budget packet must say what it left out" ;;
esac
big="$("$CG" resume --task 2.1 --prompt --budget 20000)"
[ "${#big}" -gt "${#out}" ] || fail "a larger budget must not give less"

# ---- cg work update: what merged upstream since the packet was opened
rev="$("$CG" work open --task ctx/3.1 --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["revision"])')"
python3 - <<'EOF'
import json, sqlite3, time
db = sqlite3.connect(".codegraph/graph.db", isolation_level=None)
now = int(time.time() * 1000) + 1000
for subj, base in (("ctx/2.2", "feature/ctx"), ("ctx/2.1", "feature/other")):
    db.execute("INSERT INTO events(at,kind,subject,payload) VALUES(?,?,?,?)",
               (now, "fleet.merge", subj, json.dumps(
                   {"task": subj.split("/")[1], "outcome": "merged",
                    "branch": "wave/ctx/1", "base": base, "head": "abc123"})))
EOF
out="$(CG_BASE=feature/ctx "$CG" work update "$rev" --json)"
echo "$out" | python3 -c '
import json, sys
d = json.load(sys.stdin)
assert d["unchanged"] is False, d
up = d["deltas"]["upstream"]
assert [u["task"] for u in up] == ["ctx/2.2"], up            # other bases filtered
u = up[0]
assert u["base"] == "feature/ctx" and u["branch"] == "wave/ctx/1", u
s = {x["name"]: x["definition"] for x in u["symbols"]}
assert "lookup" in s and "src/store.ts:1" in s["lookup"], s
' || fail "upstream delta: $out"
out="$(CG_BASE=feature/ctx "$CG" work update "$rev")"
has "$out" "upstream merges"
has "$out" "upstream: ctx/2.2 merged into feature/ctx — lookup"

# ---- the manager's packet: subtree, live workers, failures, conflicts,
#      approvals
python3 - <<'EOF'
import json, sqlite3, time
db = sqlite3.connect(".codegraph/graph.db", isolation_level=None)
now = int(time.time() * 1000)
db.execute("INSERT INTO events(at,kind,subject,payload) VALUES(?,?,?,?)",
           (now, "fleet.merge", "ctx/2.1", json.dumps(
               {"outcome": "conflict", "branch": "wave/ctx/1",
                "base": "feature/ctx", "conflicts": ["src/auth.ts"]})))
db.execute("INSERT INTO fleet_approvals(gate,subject,state,requested) "
           "VALUES('land','ctx','pending',?)", (int(time.time()),))
EOF
"$CG" remember "blocked: 2.1 — agent exited rc=1 without completing" \
      --type outcome --task ctx/2.1 >/dev/null
out="$("$CG" fleet brief ctx)"
has "$out" "### Your subtree: 2 of 5 task(s) done"
has "$out" "- 2.1 (wave 1) pending — Salted hashing"
has "$out" "- 2.2 (wave 1) done — Store lookups"
has "$out" "### Live workers"
has "$out" "- w-sib on ctx/2.3"
has "$out" "### Failed attempts"
has "$out" "without completing"
has "$out" "### Merge conflicts to resolve"
has "$out" 'ctx/2.1 (wave/ctx/1): ["src/auth.ts"]'
has "$out" "### Approvals"
has "$out" " land: pending"

echo "context OK"
