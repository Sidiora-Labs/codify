/*
 * VS Code language features backed by `cg lsp`.
 *
 * LSP results map almost one-to-one onto VS Code's provider APIs; the only
 * real work is converting positions (LSP is zero-based, and so is VS Code, so
 * they agree) and URIs. Everything here degrades to an empty result when the
 * server is not running, so the extension never blocks an editor action.
 */
const vscode = require('vscode');

/* every language Codify indexes, plus its own spec format */
const SELECTOR = [
    'typescript', 'typescriptreact', 'javascript', 'javascriptreact',
    'python', 'go', 'rust', 'java', 'csharp', 'vb', 'php', 'ruby',
    'c', 'cpp', 'swift', 'kotlin', 'erlang', 'solidity', 'svelte', 'vue',
    'astro', 'kvx',
].map((language) => ({ scheme: 'file', language }));

function toRange(r) {
    return new vscode.Range(
        r.start.line, r.start.character, r.end.line, r.end.character);
}

function toLocation(l) {
    return new vscode.Location(vscode.Uri.parse(l.uri), toRange(l.range));
}

function docParams(doc, pos) {
    const p = { textDocument: { uri: doc.uri.toString() } };
    if (pos) p.position = { line: pos.line, character: pos.character };
    return p;
}

function register(ctx, client, diagnostics) {
    const one = (r) => (Array.isArray(r) ? r : r ? [r] : []).map(toLocation);

    ctx.subscriptions.push(
        vscode.languages.registerDefinitionProvider(SELECTOR, {
            async provideDefinition(doc, pos) {
                return one(await client.tryRequest(
                    'textDocument/definition', docParams(doc, pos), []));
            },
        }),

        vscode.languages.registerReferenceProvider(SELECTOR, {
            async provideReferences(doc, pos) {
                return one(await client.tryRequest(
                    'textDocument/references', docParams(doc, pos), []));
            },
        }),

        vscode.languages.registerHoverProvider(SELECTOR, {
            async provideHover(doc, pos) {
                const r = await client.tryRequest(
                    'textDocument/hover', docParams(doc, pos), null);
                if (!r || !r.contents) return null;
                const value = typeof r.contents === 'string'
                    ? r.contents : r.contents.value;
                if (!value) return null;
                const md = new vscode.MarkdownString(value);
                md.isTrusted = true;
                return new vscode.Hover(md);
            },
        }),

        vscode.languages.registerDocumentSymbolProvider(SELECTOR, {
            async provideDocumentSymbols(doc) {
                const r = await client.tryRequest(
                    'textDocument/documentSymbol', docParams(doc), []);
                return r.map((s) => new vscode.DocumentSymbol(
                    s.name, s.detail || '',
                    vscode.SymbolKind.Function,
                    toRange(s.range), toRange(s.selectionRange || s.range)));
            },
        }),

        vscode.languages.registerWorkspaceSymbolProvider({
            async provideWorkspaceSymbols(query) {
                const r = await client.tryRequest(
                    'workspace/symbol', { query: query || '' }, []);
                return r.map((s) => new vscode.SymbolInformation(
                    s.name, vscode.SymbolKind.Function, s.containerName || '',
                    toLocation(s.location)));
            },
        }),

        vscode.languages.registerCodeLensProvider(SELECTOR, {
            async provideCodeLenses(doc) {
                const r = await client.tryRequest(
                    'textDocument/codeLens', docParams(doc), []);
                return r.map((l) => new vscode.CodeLens(toRange(l.range), {
                    title: l.command ? l.command.title : '',
                    /* the server sends a title-only lens; make it useful by
                     * wiring it to the reference search VS Code already has */
                    command: 'editor.action.findReferences',
                    arguments: [doc.uri, new vscode.Position(
                        l.range.start.line, l.range.start.character)],
                }));
            },
        }),
    );

    /* Diagnostics arrive as notifications. The server only syncs on open and
     * save, so tell it about both — that is what makes a kvx error or a
     * scope-drift warning appear in the Problems panel. */
    client.onNotification('textDocument/publishDiagnostics', (p) => {
        if (!p || !p.uri) return;
        const uri = vscode.Uri.parse(p.uri);
        diagnostics.set(uri, (p.diagnostics || []).map((d) => {
            const dg = new vscode.Diagnostic(toRange(d.range), d.message,
                d.severity === 1 ? vscode.DiagnosticSeverity.Error
                : d.severity === 3 ? vscode.DiagnosticSeverity.Information
                : d.severity === 4 ? vscode.DiagnosticSeverity.Hint
                : vscode.DiagnosticSeverity.Warning);
            dg.source = d.source || 'codify';
            if (d.code) dg.code = d.code;
            return dg;
        }));
    });

    const sync = (doc, method) => {
        if (doc.uri.scheme !== 'file') return;
        client.notify(method, {
            textDocument: {
                uri: doc.uri.toString(),
                languageId: doc.languageId,
                version: doc.version,
                text: method.endsWith('didOpen') ? '' : undefined,
            },
        });
    };

    ctx.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(
            (d) => sync(d, 'textDocument/didOpen')),
        vscode.workspace.onDidSaveTextDocument(
            (d) => sync(d, 'textDocument/didSave')),
    );
    for (const d of vscode.workspace.textDocuments) {
        sync(d, 'textDocument/didOpen');
    }

    /* Re-check every open file when the task changes: what counts as
     * "in scope" depends on which task is in progress. */
    return function revalidate() {
        for (const d of vscode.workspace.textDocuments) {
            sync(d, 'textDocument/didSave');
        }
    };
}

module.exports = { register, SELECTOR };
