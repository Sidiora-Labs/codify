#!/usr/bin/env bash
# cg recap: a resume brief from past Claude Code and Codex sessions. The
# transcripts are fixtures; the System One endpoint is the fake curl from
# 28_jev (CG_JEV_CURL), the writer is the fake OpenAI endpoint from
# 29_changelog (CG_CHANGELOG_CURL). Nothing here reaches the network.
. "$(dirname "$0")/../lib.sh"

cp -r "$FIXTURES/sample" "$TMP/proj"
cd "$TMP/proj"
"$CG" init >/dev/null
git init -q . && git config user.email t@example.com && git config user.name T
git add -A && git commit -q -m "feat: first"

# the transcripts, placed where the discovery looks, dated inside the window;
# the Codex rollout names this project as its cwd, a second one another project
mkdir -p "$TMP/claude" "$TMP/codex/2026/09/21"
cp "$FIXTURES/recap/claude/"*.jsonl "$TMP/claude/"
for f in "$FIXTURES/recap/codex/2026/09/21/"*.jsonl; do
    sed "s|__ROOT__|$TMP/proj|" "$f" > "$TMP/codex/2026/09/21/$(basename "$f")"
done
touch -d '2 days ago' "$TMP/claude/"*.jsonl
touch -d '1 day ago' "$TMP/codex/2026/09/21/"*.jsonl
export CG_RECAP_CLAUDE_DIR="$TMP/claude" CG_RECAP_CODEX_DIR="$TMP/codex"
export CG_RECAP_PARALLEL=1                       # the fakes count calls by file name
export JEV_FAKE_DIR="$TMP/jev" OPENAI_FAKE_DIR="$TMP/openai"
export CG_JEV_CURL="$FIXTURES/jev/fake-curl.sh" CG_CHANGELOG_CURL="$FIXTURES/jev/fake-openai.sh"

# ---- the facts block needs no key and no model
out="$("$CG" recap --facts)"
has "$out" "HEAD:"
has "$out" "feat: first"
[ ! -d "$JEV_FAKE_DIR" ] && [ ! -d "$OPENAI_FAKE_DIR" ] || fail "--facts called a model"

# ---- no key: a clear error, no call
rc=0; "$CG" recap >/dev/null 2>"$TMP/err" || rc=$?
[ "$rc" -eq 1 ] || fail "recap without a key should exit 1, got $rc"
has "$(cat "$TMP/err")" "CENTRA_API_KEY"
[ ! -d "$JEV_FAKE_DIR" ] || fail "a decision call was made without a key"

# ---- the decision pass: by position in the one chunk each session makes,
#      statement 3 is judged noise and statement 4 no longer true
printf 'CENTRA_API_KEY=sk-recap-1\n' > .env
export JEV_FAKE_CHOICE="k001=goal,k002=constraint,k003=noise,k004=done,k005=fact,k006=done"
export JEV_FAKE_NOUL="t004=0.2"
out="$("$CG" recap --decided 2>"$TMP/err")"
has "$(cat "$TMP/err")" "2 sessions (claude-code 1, codex 1)"
has "$out" "# Decided log"
has "$out" "openrouter/upstage/solar-decide"
before() { case "$1" in *"$2"*"$3"*) : ;; *) fail "expected '$2' before '$3'" ;; esac; }
before "$out" "[s1] claude-code 2026-09-20 — Add the gauge widget" "[s2] codex 2026-09-21"
# what a person said, with the harness stripped off
has "$out" "goal 0.88/0.95/0.95 [user] Add a gauge widget to the dashboard"
has "$out" "constraint 0.88/0.95/0.95 [user] Use sqlite for the cache, not redis"
has "$out" "[user] Wire the gauge into the CLI help"
has "$out" "[assistant] The help text now lists gauge under widgets."
has "$out" "[tool] ran: make test"
has "$out" "files edited: src/gauge.c"
# what the model ruled out, in both sessions (the fake steers by position)
hasnt "$out" "reuse the existing StrBuf helpers"          # s1 statement 3: noise
hasnt "$out" "The gauge lives in src/gauge.c"             # s1 statement 4: no longer true
hasnt "$out" "tools.exec_command"                         # s2 statement 3: noise
hasnt "$out" "Done: gauge in help"                        # s2 statement 4: no longer true
has "$out" "(4 of 6 statements)"
has "$out" "(2 of 4 statements)"
# what never gets near a model
for secret in "must never reach the model" "must never appear" "gauge_secret_code" \
              "task-notification" "environment_context" "ls -la"; do
    hasnt "$out" "$secret"
    if grep -rq -- "$secret" "$JEV_FAKE_DIR"/request.*.json; then fail "'$secret' was sent to the decision model"; fi
done
n="$(ls "$JEV_FAKE_DIR"/request.*.json | wc -l)"
[ "$n" -eq 2 ] || fail "expected one decision call per session (2), got $n"
python3 - "$JEV_FAKE_DIR/request.1.json" "$JEV_FAKE_DIR/call.1.txt" <<'EOF' || fail "decision request shape"
import json, sys
d = json.load(open(sys.argv[1]))
assert d["model"] == "openrouter/upstage/solar-decide", d["model"]
q = d["questions"]
assert len(q) == 18 and len(q) <= 100, len(q)          # 6 statements x 3
assert q["k001"]["type"] == "choice" and set(q["k001"]["criteria"]) >= {"goal", "decision", "noise", "open_thread"}
assert q["t001"]["type"] == "noul" and q["n001"]["type"] == "noul"
s = d["state"]
assert s["agent"] == "claude-code" and s["session_title"] == "Add the gauge widget"
assert [x["who"] for x in s["statements"]] == ["user", "user", "assistant", "assistant", "assistant", "tool"], s["statements"]
assert s["statements"][0]["text"].startswith("Add a gauge widget")
call = open(sys.argv[2]).read()
assert "url=https://gateway.centra.ag/v1/systemone" in call, call
assert "auth=sk-recap-1" in call, call
EOF
[ -f .codegraph/recap/decided.md ] || fail "the decided log was not kept beside the graph"
[ ! -d "$OPENAI_FAKE_DIR" ] || fail "--decided called the writer"

# ---- the whole thing: the writer gets FACTS and the DECIDED LOG, the brief
#      lands in .codify/recap.md; a rerun answers the decisions from the cache
out="$("$CG" recap 2>"$TMP/err")"
has "$out" "wrote $TMP/proj/.codify/recap.md"
has "$(cat "$TMP/err")" "0 decision calls (2 from the cache)"    # the --decided run filled it
brief="$(cat .codify/recap.md)"
has "$brief" "<!-- cg recap"
has "$brief" "picked by openrouter/upstage/solar-decide"
has "$brief" "This release adds the gauge"                        # the fake writer's canned prose
python3 - "$OPENAI_FAKE_DIR/req-1.json" <<'EOF' || fail "writer request shape"
import json, sys
d = json.load(open(sys.argv[1]))
c = d["messages"][0]["content"]
assert "=== FACTS ===" in c and "=== DECIDED LOG ===" in c, c[:300]
assert c.index("=== FACTS ===") < c.index("=== DECIDED LOG ==="), "facts first"
assert "feat: first" in c, "commits missing"
assert "Use sqlite for the cache, not redis" in c, "picked statement missing"
assert "reuse the existing StrBuf helpers" not in c, "a noise statement reached the writer"
assert "must never reach the model" not in c
assert "never invent" in c and "[s1]" in c
EOF
n="$(ls "$JEV_FAKE_DIR"/request.*.json | wc -l)"
[ "$n" -eq 2 ] || fail "the second run should decide from the cache, made $((n - 2)) new calls"
out="$("$CG" recap --json 2>/dev/null)"
has "$out" '"cached":2'
has "$out" '"calls":0'
has "$out" '"sessions":2'
[ "$(ls "$OPENAI_FAKE_DIR"/req-*.json | wc -l)" -eq 2 ] || fail "the writer is asked on every run"

# ---- -o - to stdout, --agents narrows the sources, --sessions caps them
out="$("$CG" recap -o - --agents codex 2>"$TMP/err")"
has "$(cat "$TMP/err")" "1 session (claude-code 0, codex 1)"
has "$out" "This release adds the gauge"
out="$("$CG" recap --decided --sessions 1 2>"$TMP/err")"
has "$(cat "$TMP/err")" "1 session (claude-code 0, codex 1)"      # the newest one

# ---- a failed decision call skips its chunk and says so; all failing stops
rm -rf .codegraph/recap-cache
JEV_FAKE_MODE=500 rc=0; JEV_FAKE_MODE=500 "$CG" recap --decided >/dev/null 2>"$TMP/err" || rc=$?
[ "$rc" -eq 1 ] || fail "every call failing should exit 1, got $rc"
has "$(cat "$TMP/err")" "skipped — jev request failed (status 500)"
has "$(cat "$TMP/err")" "every decision call failed"

echo "36_recap ok"
