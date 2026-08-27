#!/usr/bin/env bash
# VS Code extension: syntax, manifest coherence, and the LSP client driven
# against the real cg binary. The client is plain Node, so it is testable
# without VS Code — which is most of what could actually break.
. "$(dirname "$0")/../lib.sh"

EXT="$(cd "$(dirname "$0")/../../editors/vscode" && pwd)"

command -v node >/dev/null 2>&1 || { echo "14_vscode skipped (no node)"; exit 0; }

# ---- every source file parses
for f in "$EXT"/*.js; do
    node --check "$f" || fail "syntax error in $f"
done

# ---- the manifest and the code agree about which commands exist
node - "$EXT" <<'JS'
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
// commands are registered from extension.js and agents.js
const src = fs.readFileSync(path.join(dir, 'extension.js'), 'utf8') +
    fs.readFileSync(path.join(dir, 'agents.js'), 'utf8');

const declared = pkg.contributes.commands.map((c) => c.command);
const registered = [...src.matchAll(/'(codify\.[A-Za-z.]+)':/g)].map((m) => m[1]);

for (const c of declared) {
    if (!registered.includes(c)) throw new Error(`declared but not registered: ${c}`);
}
for (const c of registered) {
    if (!declared.includes(c)) throw new Error(`registered but not declared: ${c}`);
}

// menu entries may only reference declared commands
const menus = Object.values(pkg.contributes.menus).flat();
for (const m of menus) {
    if (!declared.includes(m.command)) {
        throw new Error(`menu references unknown command: ${m.command}`);
    }
}

// views the code registers must exist in the manifest
const views = Object.values(pkg.contributes.views).flat().map((v) => v.id);
for (const v of ['codifyTasks', 'codifyMemories']) {
    if (!views.includes(v)) throw new Error(`missing view: ${v}`);
}
if (!/registerTreeDataProvider\('codifyMemories'/.test(src)) {
    throw new Error('codifyMemories view is declared but never populated');
}

// the extension must not have grown dependencies: the whole point is that
// `vsce package` needs no npm install
if (pkg.dependencies || pkg.devDependencies) {
    throw new Error('extension must stay dependency-free');
}
console.log('manifest coherent:', declared.length, 'commands');
JS

# ---- the LSP client speaks to the real server
cp -r "$FIXTURES/sample" "$TMP/proj"
cd "$TMP/proj"
"$CG" init >/dev/null

node - "$EXT" "$CG" "$TMP/proj" <<'JS'
const path = require('path');
const { LspClient } = require(path.join(process.argv[2], 'client.js'));
const [, , , bin, root] = process.argv;

(async () => {
    const logs = [];
    const c = new LspClient(bin, root, (m) => logs.push(m));
    const ok = await c.start();
    if (!ok) throw new Error('client failed to start: ' + logs.join('; '));

    const uri = 'file://' + root + '/src/util.ts';
    const src = require('fs').readFileSync(root + '/src/util.ts', 'utf8')
        .split('\n');
    const line = src.findIndex((l) => l.includes('formatName'));
    const character = src[line].indexOf('formatName') + 2;
    const at = { textDocument: { uri }, position: { line, character } };

    const defs = await c.request('textDocument/definition', at);
    if (!defs || !defs.length) throw new Error('no definition');
    if (!defs[0].uri.endsWith('src/util.ts')) {
        throw new Error('definition uri: ' + defs[0].uri);
    }
    if (defs[0].range.start.line !== line) {
        throw new Error(`definition line ${defs[0].range.start.line} != ${line}`);
    }

    const refs = await c.request('textDocument/references', at);
    if (!refs || !refs.length) throw new Error('no references');

    const hover = await c.request('textDocument/hover', at);
    if (!hover || !/formatName/.test(hover.contents.value)) {
        throw new Error('hover: ' + JSON.stringify(hover));
    }

    const syms = await c.request('workspace/symbol', { query: 'formatName' });
    if (!syms.some((s) => s.name === 'formatName')) {
        throw new Error('workspace symbols: ' + JSON.stringify(syms));
    }

    const lenses = await c.request('textDocument/codeLens',
        { textDocument: { uri } });
    if (!lenses.length) throw new Error('no code lenses');

    // diagnostics arrive as a notification after didOpen
    const got = new Promise((resolve) => {
        c.onNotification('textDocument/publishDiagnostics', resolve);
        c.notify('textDocument/didOpen', {
            textDocument: { uri, languageId: 'typescript', version: 1, text: '' },
        });
    });
    const diag = await Promise.race([
        got,
        new Promise((_, r) => setTimeout(() => r(new Error('no diagnostics')), 15000)),
    ]);
    if (diag.uri !== uri) throw new Error('diagnostics uri: ' + diag.uri);

    // an unimplemented method must answer rather than hang
    const none = await c.request('textDocument/formatting',
        { textDocument: { uri } });
    if (none !== null) throw new Error('expected null for unknown method');

    c.dispose();
    console.log('lsp client ok');
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
JS

# ---- large payloads survive framing (the buffer must not be split on chars)
node - "$EXT" "$CG" "$TMP/proj" <<'JS'
const path = require('path');
const { LspClient } = require(path.join(process.argv[2], 'client.js'));
const [, , , bin, root] = process.argv;

(async () => {
    const c = new LspClient(bin, root, () => {});
    if (!await c.start()) throw new Error('client failed to start');
    // an empty query returns every symbol in one large frame
    const all = await c.request('workspace/symbol', { query: '' });
    if (!Array.isArray(all) || all.length < 3) {
        throw new Error('expected many symbols, got ' + JSON.stringify(all).slice(0, 200));
    }
    for (const s of all) {
        if (!s.location || !s.location.uri) throw new Error('malformed symbol');
    }
    c.dispose();
    console.log('lsp framing ok (' + all.length + ' symbols in one frame)');
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
JS

echo "14_vscode ok"
