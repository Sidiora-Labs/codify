#!/usr/bin/env bash
# Documentation closure: lifecycle, evidence, verification, and connectors.
. "$(dirname "$0")/../lib.sh"

part="${1:-all}"
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"

lifecycle() {
    mkdir -p "$TMP/new"
    "$CG" spec new demo --root "$TMP/new" >/dev/null
    grep -q '^\[documentation\]$' "$TMP/new/spec/demo/spec.kvx" \
        || fail "new feature did not enable documentation"
    grep -q '^mode.*=.*"auto"' "$TMP/new/spec/demo/spec.kvx" \
        || fail "new feature documentation mode is not auto"

    cd "$TMP/new"
    out="$("$CG" spec status)"
    has "$out" "documentation: waiting (auto)"
    "$CG" spec start 1.1 >/dev/null
    out="$("$CG" spec done 1.1)"
    has "$out" "next: @docs"
    out="$("$CG" spec next)"
    has "$out" "task @docs"
    "$CG" spec status --json | python3 -c '
import json, sys
d=json.load(sys.stdin)
assert d["documentation"] == {
  "configured": True, "mode": "auto", "status": "pending", "ready": True
}, d
assert d["next"]["id"] == "@docs" and d["next"]["virtual"] is True, d
'

    "$CG" spec docs start >/dev/null
    out="$("$CG" spec docs done 2>&1)" \
        && fail "documentation closed without verification"
    has "$out" "no successful documentation verification"
    "$CG" spec docs block >/dev/null
    out="$("$CG" spec status)"
    has "$out" "documentation: blocked (auto)"
    has "$out" "documentation blocked"
    "$CG" spec docs reset >/dev/null
    "$CG" spec docs start >/dev/null
    mkdir -p .codegraph/docs/demo
    printf 'verified\n' > .codegraph/docs/demo/verified
    out="$("$CG" spec docs done 2>&1)" \
        && fail "low-level documentation completion bypassed close"
    has "$out" "completion is owned by"
    printf 'closing\n' > .codegraph/docs/demo/closing
    out="$("$CG" spec docs done 2>&1)" \
        && fail "forged derived markers authorized completion"
    has "$out" "completion is owned by"
    out="$("$CG" spec status)"
    has "$out" "documentation: in_progress (auto)"

    mkdir -p "$TMP/off"
    "$CG" spec new off-demo --root "$TMP/off" >/dev/null
    cd "$TMP/off"
    "$CG" spec docs off >/dev/null
    "$CG" spec start 1.1 >/dev/null
    out="$("$CG" spec done 1.1)"
    has "$out" "all tasks done"
    hasnt "$out" "@docs"

    mkdir -p "$TMP/manual"
    "$CG" spec new manual-demo --root "$TMP/manual" >/dev/null
    cd "$TMP/manual"
    "$CG" spec docs manual >/dev/null
    "$CG" spec mode prod >/dev/null
    "$CG" spec start 1.1 >/dev/null
    "$CG" spec implemented 1.1 >/dev/null
    out="$("$CG" spec status)"
    has "$out" "documentation: waiting (manual)"
    "$CG" spec done 1.1 >/dev/null
    out="$("$CG" spec next --json)"
    has "$out" '"id":"@docs"'
    has "$out" '"mode":"manual"'

    cp -r "$FIXTURES/specrepo" "$TMP/legacy"
    cd "$TMP/legacy"
    out="$("$CG" spec status --json)"
    has "$out" '"configured":false'
    has "$out" '"mode":"legacy"'

    mkdir -p "$TMP/parallel"
    "$CG" spec new parallel-demo --root "$TMP/parallel" >/dev/null
    cd "$TMP/parallel"
    "$CG" spec mode parallel >/dev/null
    "$CG" spec start 1.1 >/dev/null
    "$CG" spec done 1.1 >/dev/null
    out="$("$CG" spec docs start --attempt forged --fence 99 2>&1)" \
        && fail "forged documentation owner was accepted"
    : "$out"
}

evidence() {
    mkdir -p "$TMP/evidence/docs"
    "$CG" spec new evidence-demo --root "$TMP/evidence" >/dev/null
    printf '# Evidence Demo\n' > "$TMP/evidence/README.md"
    printf '# Developer Guide\n' > "$TMP/evidence/docs/development.md"
    printf 'int public_api(void) { return 7; }\n' > "$TMP/evidence/main.c"
    cd "$TMP/evidence"
    "$CG" init >/dev/null

    out="$("$CG" docs plan --json)"
    printf '%s' "$out" | python3 -c '
import json, sys
d=json.load(sys.stdin)
assert d["feature"] == "evidence-demo", d
assert d["status"] == "waiting" and d["generation"] == "full-baseline", d
assert d["audiences"] == ["user", "developer"], d
assert any(x["path"] == "README.md" for x in d["inventory"]), d
assert any(x["path"] == "docs/development.md" for x in d["inventory"]), d
'
    out="$("$CG" docs packet 2>&1)" \
        && fail "documentation packet generated before tasks qualified"
    has "$out" "waiting for all ordinary tasks"

    "$CG" spec start 1.1 >/dev/null
    printf 'int public_api(void) { return 8; }\n' > main.c
    "$CG" commit -m "implement public api" >/dev/null
    "$CG" spec done 1.1 >/dev/null
    "$CG" docs packet --json > packet.json
    python3 - <<'PY'
import json
d=json.load(open("packet.json"))
assert d["feature"] == "evidence-demo", d
assert d["packet_path"].endswith("/packet.md"), d
p=d["packet"]
for heading in ("Normative feature specification", "Task-to-code trace",
                "Qualification state", "Snapshot changelog",
                "Changed public surface", "Framework routes",
                "Anchor coverage", "Decisions and outcomes",
                "Snapshot history", "Focused graph context"):
    assert heading in p, heading
assert "Configured audiences: user developer" in p
assert "README.md" in p and "docs/development.md" in p
PY
    python3 - <<'PY'
import json
d=json.load(open(".codegraph/docs/evidence-demo/provenance.json"))
assert d["version"] == 1 and d["generation"] == "full-baseline", d
assert d["audience_sections"]["user"], d
assert d["audience_sections"]["developer"], d
assert len(d["evidence"]) >= 9, d
assert any(e["source"] == "cg spec trace" for e in d["evidence"]), d
PY

    mkdir -p "$TMP/gaps"
    "$CG" spec new gaps-demo --root "$TMP/gaps" >/dev/null
    cd "$TMP/gaps"
    "$CG" init >/dev/null
    "$CG" spec start 1.1 >/dev/null
    "$CG" spec done 1.1 >/dev/null
    "$CG" docs packet >/dev/null
    has "$(cat .codegraph/docs/gaps-demo/packet.md)" \
        'Evidence unavailable from `cg changelog`'
    python3 - <<'PY'
import json
d=json.load(open(".codegraph/docs/gaps-demo/provenance.json"))
row=next(e for e in d["evidence"] if e["source"] == "cg changelog")
assert row["available"] is False and row["exit_code"] != 0, row
PY
}

verify_docs() {
    mkdir -p "$TMP/verify"
    "$CG" spec new verify-demo --root "$TMP/verify" >/dev/null
    cd "$TMP/verify"
    "$CG" init >/dev/null
    "$CG" spec start 1.1 >/dev/null
    printf 'int main(void) { return 0; }\n' > main.c
    printf "const app = require('express')();\napp.get('/health', (_q, r) => r.send('ok'));\n" > server.js
    printf 'make verify-docs\n' > commands.txt
    printf '# Verify Demo\n\nInitial user notes.\n' > README.md
    mkdir -p docs
    printf '# Development\n\nInitial developer notes.\n' > docs/development.md
    printf '# Changelog\n\nInitial release.\n' > CHANGELOG.md
    "$CG" commit -m "implement verified feature" >/dev/null
    "$CG" spec done 1.1 >/dev/null
    "$CG" docs packet >/dev/null
    "$CG" spec docs start >/dev/null

    cat > .codegraph/docs/verify-demo/claims.kvx <<'EOF'
[coverage]
user                 = "README.md"
developer            = "docs/development.md"
release_or_migration = "CHANGELOG.md"
exclusions           = "No generated API reference; this fixture is an application."
unresolved           = ""

[claim.1]
type     = "symbol"
value    = "main"
document = "docs/development.md"
evidence = "main.c:1"

[claim.2]
type     = "route"
value    = "GET /health"
document = "README.md"
evidence = "server.js:2"

[claim.3]
type     = "command"
value    = "make verify-docs"
document = "README.md"
evidence = "commands.txt:1"

[claim.4]
type     = "path"
value    = "main.c"
document = "docs/development.md"
evidence = "main.c:1"
EOF
    printf '# Verify Demo\n\nUse `make verify-docs`; health is `GET /health`.\n\n[Developer guide](docs/missing.md)\n' > README.md
    printf '# Development\n\nThe `main` entry point is in `main.c`.\n' > docs/development.md
    printf '# Changelog\n\nDocumented the verified feature and migration impact.\n' > CHANGELOG.md

    out="$("$CG" docs check 2>&1)" && fail "broken local link passed"
    has "$out" "docs/missing.md"
    [ ! -e .codegraph/docs/verify-demo/verified ] \
        || fail "failed check left a verified marker"
    printf '# Verify Demo\n\nUse `make verify-docs`; health is `GET /health`.\n\n[Developer guide](docs/development.md)\n' > README.md

    printf 'int main(void) { return 1; }\n' > main.c
    out="$("$CG" docs check 2>&1)" && fail "out-of-scope code edit passed"
    has "$out" "main.c"
    printf 'int main(void) { return 0; }\n' > main.c

    mv docs/development.md docs/development.saved
    out="$("$CG" docs check 2>&1)" && fail "deleted canonical doc passed"
    has "$out" "developer coverage"
    mv docs/development.saved docs/development.md

    # A derived required ledger cannot erase actual required public coverage.
    cp .codegraph/docs/verify-demo/claims.kvx "$TMP/valid-claims.kvx"
    python3 - <<'PY'
from pathlib import Path
p = Path('.codegraph/docs/verify-demo/claims.kvx')
s = p.read_text()
p.write_text(s.replace('value    = "GET /health"', 'value    = "GET /invented"'))
Path('.codegraph/docs/verify-demo/required.kvx').write_text('[required.1]\ntype = "path"\nvalue = "main.c"\n')
PY
    out="$("$CG" docs check 2>&1)" && fail "edited required ledger bypassed coverage"
    has "$out" "FAIL  required route GET /health is documented"
    cp "$TMP/valid-claims.kvx" .codegraph/docs/verify-demo/claims.kvx

    # Symbol names alone are insufficient: evidence must locate the definition.
    sed 's/evidence = "main.c:1"/evidence = "commands.txt:1"/' \
        "$TMP/valid-claims.kvx" > .codegraph/docs/verify-demo/claims.kvx
    out="$("$CG" docs check 2>&1)" && fail "unrelated symbol evidence passed"
    has "$out" "FAIL  claim main resolves as symbol"
    cp "$TMP/valid-claims.kvx" .codegraph/docs/verify-demo/claims.kvx

    # A documentation symlink must not escape the project, even to a sibling.
    mv docs/development.md "$TMP/development.md"
    ln -s "$TMP/development.md" docs/development.md
    out="$("$CG" docs check 2>&1)" && fail "external document symlink passed"
    has "$out" "FAIL  developer coverage"
    unlink docs/development.md
    mv "$TMP/development.md" docs/development.md

    "$CG" docs check --json > "$TMP/check.json" \
        || { cat "$TMP/check.json"; fail "valid documentation did not pass"; }
    python3 - "$TMP/check.json" <<'PY'
import json, sys
d=json.load(open(sys.argv[1]))
assert d["ok"] is True and d["errors"] == 0 and d["checks"] >= 15, d
PY
    [ -s .codegraph/docs/verify-demo/verified ] \
        || fail "successful check did not write verified marker"
    out="$("$CG" spec docs done 2>&1)" \
        && fail "spec docs done bypassed atomic close"
    has "$out" "completion is owned by"

    "$CG" docs close --json > "$TMP/close.json"
    python3 - "$TMP/close.json" <<'PY'
import json, sys
d=json.load(open(sys.argv[1]))
assert d["closed"] is True and d["task"] == "@docs", d
PY
    [ -s .codegraph/docs/verify-demo/baseline.json ] \
        || fail "close did not record incremental baseline"
    out="$("$CG" spec status)"
    has "$out" "documentation: done (auto)"
    has "$out" "all tasks done"
    out="$("$CG" log)"
    has "$out" "[spec:verify-demo/@docs]"
    "$CG" docs trace --json > "$TMP/trace.json"
    python3 - "$TMP/trace.json" <<'PY'
import json, sys
d=json.load(open(sys.argv[1]))
assert d["feature"] == "verify-demo" and d["status"] == "done", d
assert d["source_commits"] and d["documentation_commits"], d
assert d["documentation_commits"][0]["message"].endswith("[spec:verify-demo/@docs]"), d
PY
    out="$("$CG" docs plan --json)"
    has "$out" '"generation":"incremental"'
    "$CG" spec new followup-demo >/dev/null
    out="$("$CG" docs plan --json)"
    has "$out" '"feature":"followup-demo"'
    has "$out" '"generation":"incremental"'
    out="$("$CG" docs status -f verify-demo --json)"
    has "$out" '"feature":"verify-demo"'
    has "$out" '"status":"done"'
    "$CG" spec docs off >/dev/null
    out="$("$CG" docs status --json)"
    has "$out" '"status":"off"'
}

connector() {
    root="$repo_root"
    node --check "$root/editors/vscode/extension.js"
    node --check "$root/editors/vscode/agents.js"
    node --check "$root/editors/vscode/acp.js"
    has "$(cat "$root/editors/vscode/extension.js")" "id: '@docs'"
    has "$(cat "$root/editors/vscode/agents.js")" "['docs', 'packet']"
    has "$(cat "$root/editors/vscode/acp.js")" "['docs', 'close']"

    mkdir -p "$TMP/connector/docs"
    cd "$TMP/connector"
    "$CG" spec new connector-demo >/dev/null
    "$CG" spec mode parallel >/dev/null
    printf 'int public_api(void) { return 1; }\n' > main.c
    printf '# Connector Demo\n' > README.md
    printf '# Development\n' > docs/development.md
    printf '# Changelog\n' > CHANGELOG.md
    "$CG" init >/dev/null
    "$CG" commit -m base >/dev/null
    "$CG" spec start 1.1 >/dev/null
    printf 'int public_api(void) { return 2; }\n' > main.c
    "$CG" commit -m 'implement connector demo' >/dev/null
    "$CG" spec done 1.1 >/dev/null

    cat > "$TMP/docs-driver.sh" <<'EOF'
#!/bin/sh
prompt=$1 task=$2 root=$3 cg=$5
[ "$task" = '@docs' ] || exit 9
grep -q 'final @docs closure' "$prompt" || exit 9
cd "$root" || exit 9
printf '# Connector Demo\n\nThe `public_api` behavior is documented for users. See `spec/connector-demo/spec.kvx` for the normative contract.\n' > README.md
printf '# Development\n\nThe `public_api` symbol is implemented in `main.c`.\n' > docs/development.md
printf '# Changelog\n\nDocumented the connector closure release.\n' > CHANGELOG.md
cat > .codegraph/docs/connector-demo/claims.kvx <<'CLAIMS'
[coverage]
user                 = "README.md"
developer            = "docs/development.md"
release_or_migration = "CHANGELOG.md"
exclusions           = "No generated API reference for this C fixture."
unresolved           = ""

[claim.1]
type     = "symbol"
value    = "public_api"
document = "docs/development.md"
evidence = "main.c:1"

[claim.2]
type     = "path"
value    = "spec/connector-demo/spec.kvx"
document = "README.md"
evidence = "spec/connector-demo/spec.kvx"
CLAIMS
exec "$cg" docs close
EOF
    chmod +x "$TMP/docs-driver.sh"
    cat >> spec/workflow.kvx <<EOF

[agents]
driver = "custom"
cmd = "$TMP/docs-driver.sh \${PROMPT_FILE} \${TASK} \${ROOT} \${AGENT} $CG"
max = 1
ttl = 120
EOF
    "$CG" commit -m 'configure documentation connector' >/dev/null

    rc=0; out="$($CG spec run -n 1 2>&1)" || rc=$?
    if [ "$rc" -ne 0 ]; then
        [ ! -f .codegraph/agents/connector-demo-@docs.log ] \
            || cat .codegraph/agents/connector-demo-@docs.log >&2
        fail "documentation connector run failed: $out"
    fi
    has "$out" '[run] task @docs → custom'
    has "$out" '[run] task @docs exit 0 → status done'
    [ -s .codegraph/agents/connector-demo-@docs.prompt ] \
        || fail 'documentation agent prompt was not written'
    [ -s .codegraph/agents/connector-demo-@docs.log ] \
        || fail 'documentation agent log was not written'
    has "$(cat .codegraph/agents/connector-demo-@docs.prompt)" 'cg docs close'
    st="$($CG spec status --json)"
    has "$st" '"status":"done"'
    has "$st" '"claims":[]'
    has "$($CG log)" '[spec:connector-demo/@docs]'

    mkdir -p "$TMP/manual-connector"
    cd "$TMP/manual-connector"
    "$CG" spec new manual-connector >/dev/null
    "$CG" spec docs manual >/dev/null
    "$CG" init >/dev/null
    "$CG" spec start 1.1 >/dev/null
    "$CG" spec done 1.1 >/dev/null
    claim="$($CG spec claim @docs --agent docs-agent --ttl 2 --json)"
    attempt="$(printf '%s' "$claim" | python3 -c 'import json,sys; print(json.load(sys.stdin)["attempt_id"])')"
    fence="$(printf '%s' "$claim" | python3 -c 'import json,sys; print(json.load(sys.stdin)["fence"])')"
    out="$(CG_TASK=manual-connector/@docs CG_ATTEMPT=forged CG_FENCE=99 \
        "$CG" spec docs start --agent docs-agent 2>&1)" \
        && fail "inherited stale documentation credentials passed"
    has "$out" 'stale or foreign attempt'
    out="$("$CG" spec docs start 2>&1)" \
        && fail "unowned documentation start bypassed a live attempt"
    has "$out" 'requires its --attempt and --fence'
    CG_TASK=manual-connector/@docs CG_ATTEMPT="$attempt" CG_FENCE="$fence" \
        "$CG" spec start @docs --agent docs-agent >/dev/null
    hb="$($CG spec heartbeat @docs --agent docs-agent --attempt "$attempt" --fence "$fence" --json)"
    has "$hb" '"heartbeat"'
    "$CG" spec release @docs --agent docs-agent --attempt "$attempt" --fence "$fence" >/dev/null
    "$CG" spec docs reset >/dev/null
}

case "$part" in
    lifecycle) lifecycle ;;
    evidence) evidence ;;
    verify) verify_docs ;;
    connector) connector ;;
    all) lifecycle; evidence; verify_docs; connector ;;
    *) fail "unknown docs test part: $part" ;;
esac

echo "ok - documentation closure $part"
