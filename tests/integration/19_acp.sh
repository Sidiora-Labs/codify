#!/usr/bin/env bash
# ACP client core: the extension's AcpClient driven headlessly against a fake
# newline-delimited JSON-RPC agent — handshake, prompt turns, permission
# round-trips, the fs bridge, cancel, and every failure mode that must not
# hang. No VS Code involved; the protocol core is plain Node by design.
. "$(dirname "$0")/../lib.sh"

EXT="$(cd "$(dirname "$0")/../../editors/vscode" && pwd)"
ACPFIX="$FIXTURES/acp"

command -v node >/dev/null 2>&1 || { echo "19_acp skipped (no node)"; exit 0; }

# ---- fixture and module sources parse
node --check "$EXT/acp.js" || fail "syntax error in acp.js"
node --check "$ACPFIX/fake-agent.js" || fail "syntax error in fake-agent.js"
node --check "$ACPFIX/test-client.js" || fail "syntax error in test-client.js"

# ---- full protocol scenario suite
out="$(node "$ACPFIX/test-client.js" "$EXT/acp.js" "$ACPFIX/fake-agent.js" "$TMP")" \
    || fail "acp scenario suite failed:
$out"
has "$out" "acp client: all scenarios pass"
has "$out" "happy path"
has "$out" "fs bridge: workspace-scoped reads and writes"
has "$out" "cancel resolves the in-flight turn as cancelled"
has "$out" "protocol version mismatch fails loudly"
has "$out" "agent death rejects pending requests"

# ---- the panel page is CSP-strict and placeholder-driven
panel="$(cat "$EXT/agentpanel.html")"
has "$panel" 'Content-Security-Policy'
has "$panel" 'nonce="${nonce}"'
has "$panel" 'acquireVsCodeApi'
hasnt "$panel" 'onclick='
hasnt "$panel" 'http://'

echo "PASS 19_acp.sh"
