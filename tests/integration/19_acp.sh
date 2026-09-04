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

# the chat surface itself: an inline script this size must at least compile,
# and the Codify command set must stay in sync with what acp.js can run
node - "$EXT" <<'JS'
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2];
const html = fs.readFileSync(path.join(dir, 'agentpanel.html'), 'utf8');

const m = html.match(/<script nonce="\$\{nonce\}">([\s\S]*?)<\/script>/);
if (!m) throw new Error('panel script block not found');
new vm.Script(m[1], { filename: 'agentpanel.inline.js' });   // compile only

// no inline style attributes: the CSP nonce does not whitelist them
if (/<[^>]+\sstyle=/.test(html)) throw new Error('inline style attribute in panel');

// every slash command the chat offers must be answerable by acp.js
const acp = fs.readFileSync(path.join(dir, 'acp.js'), 'utf8');
const offered = [...m[1].matchAll(/\{ n: '([a-z]+)'/g)].map((x) => x[1]);
if (offered.length < 10) throw new Error('command palette looks empty');
const cgCmds = acp.slice(acp.indexOf('const CG_CMDS'));
for (const c of offered) {
    const handled = new RegExp(`(^|\\s)${c}:\\s*\\{`, 'm').test(cgCmds) ||
        new RegExp(`cmd === '${c}'`).test(acp) ||
        c === 'help';
    if (!handled) throw new Error(`/${c} is offered by the panel but acp.js cannot run it`);
}

// the chat must ask for its state rather than race the extension's first post
if (!/type: 'ready'/.test(m[1])) throw new Error('panel never sends the ready handshake');
if (!/'ready'/.test(acp)) throw new Error('acp.js ignores the ready handshake');
console.log('panel chat ok:', offered.length, 'codify commands');
JS

# ---- the chat actually renders: the panel script driven against a DOM shim
node --check "$ACPFIX/dom-shim.js" || fail "syntax error in dom-shim.js"
node --check "$ACPFIX/panel-test.js" || fail "syntax error in panel-test.js"
out="$(node "$ACPFIX/panel-test.js" "$EXT/agentpanel.html")" \
    || fail "agent panel rendering failed:
$out"
has "$out" "agent panel: all scenarios pass"
has "$out" "markdown, code blocks, and clickable file paths"
has "$out" "tool cards, diffs, plan progress, and permission round-trip"
has "$out" "slash palette, arguments, history, and unknown commands"
has "$out" "context bar, task attach, turn state, and reset"
has "$out" "provider picker, labels, and configure gear"
has "$out" "Codify toolbar and task actions"
has "$out" "sub-agents, tool timeline, now line, and turn summary"

echo "PASS 19_acp.sh"
