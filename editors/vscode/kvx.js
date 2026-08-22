/*
 * kvx editing support.
 *
 * The graph knows nothing about spec files, so these features are computed
 * from the document itself: jump from a `requires` entry to the task it names,
 * complete the keys a task section actually understands, and show what a
 * declared symbol or path means without leaving the file.
 */
const vscode = require('vscode');

const KVX = { scheme: 'file', language: 'kvx' };

/* keys that mean something to the spec engine, with what they do */
const TASK_KEYS = {
    title: 'Human-readable task name. Required.',
    status: 'pending | in_progress | implemented | done. Rewritten by `cg spec start` and `cg spec done` — edit by hand only to correct a mistake.',
    wave: 'Dependency wave. A task without a wave is a group heading, not work.',
    requires: 'Task ids that must be satisfied first, e.g. ["1.1", "1.2"]. `cg spec lint` reports cycles and unknown ids.',
    symbols: 'Symbols this task introduces. `cg spec done` refuses until each one exists in the code graph.',
    touches: 'Paths or globs this task changes. Checked against real changes at completion, and used by `cg guard` to flag scope drift while you work.',
    verify_cmd: 'Executable qualification. `cg spec done` runs it and refuses on a non-zero exit.',
    reqs: 'Acceptance criteria this task satisfies, e.g. ["1.1"] for [req.1] ac_1.',
    section: 'Heading this task appears under in the rendered markdown.',
    note: 'Free-text note carried into the rendered task list.',
    property: 'Property the implementation must hold.',
    validates: 'What completing this task demonstrates.',
    do_1: 'First implementation step. Number them do_1, do_2, ...',
};

const META_KEYS = {
    feature: 'Feature id. Should match the directory name.',
    intro: 'One or two sentences on what this feature is for.',
    name: 'Workflow name, shown in generated agent briefs.',
    active_feature: 'Which spec/<feature>/ the spec commands operate on.',
    source_of_truth: 'Reminder that generated files are pointers, not sources.',
};

function lineInfo(doc, line) {
    /* the section a line belongs to, scanning upward for the last header */
    for (let i = line; i >= 0; i--) {
        const m = /^\s*\[([^\]]+)\]/.exec(doc.lineAt(i).text);
        if (m) return m[1];
    }
    return '';
}

function findSection(doc, name) {
    const needle = `[${name}]`;
    for (let i = 0; i < doc.lineCount; i++) {
        if (doc.lineAt(i).text.trim().startsWith(needle)) {
            return new vscode.Position(i, 0);
        }
    }
    return null;
}

function register(ctx, cgJson, workspaceRoot) {
    ctx.subscriptions.push(
        /* `requires = ["1.2"]` jumps to `[task.1.2]`; a touches entry opens
         * the file it names. Both are things you want mid-edit. */
        vscode.languages.registerDefinitionProvider(KVX, {
            provideDefinition(doc, pos) {
                const range = doc.getWordRangeAtPosition(pos, /"[^"]+"/);
                if (!range) return null;
                const raw = doc.getText(range).slice(1, -1);
                const line = doc.lineAt(pos.line).text;
                const key = (/^\s*([A-Za-z_0-9]+)\s*=/.exec(line) || [])[1];

                if (key === 'requires' || key === 'reqs') {
                    const prefix = key === 'reqs' ? 'req.' : 'task.';
                    /* reqs point at an acceptance criterion: 1.2 -> [req.1] */
                    const target = key === 'reqs'
                        ? prefix + raw.split('.')[0] : prefix + raw;
                    const at = findSection(doc, target);
                    return at ? new vscode.Location(doc.uri, at) : null;
                }
                if (key === 'touches' && workspaceRoot() && !raw.includes('*')) {
                    return new vscode.Location(
                        vscode.Uri.joinPath(
                            vscode.Uri.file(workspaceRoot()), ...raw.split('/')),
                        new vscode.Position(0, 0));
                }
                return null;
            },
        }),

        vscode.languages.registerCompletionItemProvider(KVX, {
            async provideCompletionItems(doc, pos) {
                const line = doc.lineAt(pos.line).text;
                const section = lineInfo(doc, pos.line);

                /* completing a value: offer real task ids for requires */
                const key = (/^\s*([A-Za-z_0-9]+)\s*=/.exec(line) || [])[1];
                if (key === 'requires' && /"[^"]*$/.test(
                        line.slice(0, pos.character))) {
                    const trace = await cgJson(['spec', 'trace']);
                    if (!trace) return [];
                    return (trace.tasks || []).map((t) => {
                        const it = new vscode.CompletionItem(
                            t.id, vscode.CompletionItemKind.Reference);
                        it.detail = t.title;
                        it.documentation = `status: ${t.status}   wave: ${t.wave}`;
                        return it;
                    });
                }
                if (/^\s*$/.test(line.slice(0, pos.character)) &&
                    /^task\./.test(section)) {
                    return Object.entries(TASK_KEYS).map(([k, doc2]) => {
                        const it = new vscode.CompletionItem(
                            k, vscode.CompletionItemKind.Property);
                        it.documentation = new vscode.MarkdownString(doc2);
                        it.insertText = new vscode.SnippetString(
                            k === 'status' ? 'status = "${1|pending,in_progress,implemented,done|}"'
                            : k === 'wave' ? 'wave = ${1:0}'
                            : /^(requires|symbols|touches|reqs)$/.test(k)
                                ? `${k} = ["\${1}"]`
                                : `${k} = "\${1}"`);
                        return it;
                    });
                }
                if (/^\s*$/.test(line.slice(0, pos.character)) &&
                    section === 'meta') {
                    return Object.entries(META_KEYS).map(([k, doc2]) => {
                        const it = new vscode.CompletionItem(
                            k, vscode.CompletionItemKind.Property);
                        it.documentation = new vscode.MarkdownString(doc2);
                        it.insertText = new vscode.SnippetString(`${k} = "\${1}"`);
                        return it;
                    });
                }
                return [];
            },
        }, '"'),

        vscode.languages.registerHoverProvider(KVX, {
            provideHover(doc, pos) {
                const range = doc.getWordRangeAtPosition(pos, /[A-Za-z_0-9]+/);
                if (!range) return null;
                const word = doc.getText(range);
                const line = doc.lineAt(pos.line).text;
                if (!new RegExp(`^\\s*${word}\\s*=`).test(line)) return null;
                const key = /^do_\d+$/.test(word) ? 'do_1' : word;
                const text = TASK_KEYS[key] || META_KEYS[key];
                if (!text) return null;
                return new vscode.Hover(new vscode.MarkdownString(
                    `**\`${word}\`** — ${text}`));
            },
        }),

        /* an outline of the spec: requirements, design, and every task */
        vscode.languages.registerDocumentSymbolProvider(KVX, {
            provideDocumentSymbols(doc) {
                const out = [];
                for (let i = 0; i < doc.lineCount; i++) {
                    const m = /^\s*\[([^\]]+)\]/.exec(doc.lineAt(i).text);
                    if (!m) continue;
                    let end = doc.lineCount - 1;
                    for (let j = i + 1; j < doc.lineCount; j++) {
                        if (/^\s*\[/.test(doc.lineAt(j).text)) { end = j - 1; break; }
                    }
                    const range = new vscode.Range(i, 0, end,
                        doc.lineAt(end).text.length);
                    let title = '';
                    for (let j = i + 1; j <= end; j++) {
                        const t = /^\s*title\s*=\s*"([^"]*)"/.exec(
                            doc.lineAt(j).text);
                        if (t) { title = t[1]; break; }
                    }
                    const sym = new vscode.DocumentSymbol(
                        m[1], title,
                        m[1].startsWith('task.') ? vscode.SymbolKind.Event
                        : m[1].startsWith('req.') ? vscode.SymbolKind.Interface
                        : vscode.SymbolKind.Namespace,
                        range, new vscode.Range(i, 0, i,
                            doc.lineAt(i).text.length));
                    out.push(sym);
                }
                return out;
            },
        }),
    );
}

module.exports = { register };
