/* Codify ACP sessions — drive Codex or Claude Code through the Agent Client
 * Protocol and render the conversation in a Codify-native panel.
 *
 * The protocol core (AcpClient) is plain Node with zero dependencies and no
 * reliance on the vscode module, so the integration tests can drive it
 * headlessly against a fake agent. Everything below the PANEL marker needs
 * VS Code and is only reachable through register().
 *
 * Wire format: newline-delimited JSON-RPC 2.0 over the agent's stdio
 * (verified live against claude-code-acp). Client speaks protocol v1. */
let vscode = null;
try { vscode = require('vscode'); } catch (_) { /* headless: protocol-only */ }
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const PROTOCOL_VERSION = 1;
const STDERR_TAIL_MAX = 8192;

/* ---------------- protocol core (headless-safe) ---------------- */

/* opts: {command, args, cwd, env, onNotify(method, params),
 *        onRequest(method, params) -> value|Promise, onClose(reason)} */
function AcpClient(opts) {
    this.opts = opts || {};
    this.child = undefined;
    this.nextId = 1;
    this.pending = new Map();   /* id -> {resolve, reject, timer} */
    this.buf = '';
    this.stderrTail = '';
    this.closed = false;
    this.agent = undefined;     /* initialize result once negotiated */
}

AcpClient.prototype.start = function () {
    const o = this.opts;
    return new Promise((resolve, reject) => {
        let settled = false;
        try {
            this.child = cp.spawn(o.command, o.args || [], {
                cwd: o.cwd,
                env: Object.assign({}, process.env, o.env || {}),
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        } catch (e) {
            reject(new Error(`cannot spawn ${o.command}: ${e.message}`));
            return;
        }
        this.child.on('error', (e) => {
            const msg = `cannot start ${o.command}: ${e.message}`;
            if (!settled) { settled = true; reject(new Error(msg)); }
            this._fail(msg);
        });
        this.child.on('spawn', () => {
            if (!settled) { settled = true; resolve(); }
        });
        this.child.stdout.on('data', (d) => this._feed(String(d)));
        this.child.stderr.on('data', (d) => {
            this.stderrTail = (this.stderrTail + String(d)).slice(-STDERR_TAIL_MAX);
        });
        this.child.on('exit', (code, sig) => {
            this._fail(`agent exited (${sig || `code ${code}`})`);
        });
        this.child.stdin.on('error', () => { /* surfaced via exit */ });
    });
};

AcpClient.prototype._feed = function (chunk) {
    this.buf += chunk;
    let nl;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
            msg = JSON.parse(line);
        } catch (e) {
            this._fail(`malformed frame from agent: ${line.slice(0, 120)}`);
            this.stop();
            return;
        }
        this._dispatch(msg);
    }
};

AcpClient.prototype._dispatch = function (msg) {
    if (msg.method !== undefined && msg.id !== undefined) {
        /* agent -> client request; the reply must carry the same id */
        Promise.resolve()
            .then(() => {
                if (!this.opts.onRequest) {
                    const err = new Error(`no handler for ${msg.method}`);
                    err.code = -32601;
                    throw err;
                }
                return this.opts.onRequest(msg.method, msg.params);
            })
            .then(
                (result) => this._write({
                    jsonrpc: '2.0', id: msg.id,
                    result: result === undefined ? null : result,
                }),
                (e) => this._write({
                    jsonrpc: '2.0', id: msg.id,
                    error: { code: e.code || -32603, message: e.message || String(e) },
                }));
        return;
    }
    if (msg.method !== undefined) {
        try {
            if (this.opts.onNotify) this.opts.onNotify(msg.method, msg.params);
        } catch (_) { /* a bad handler must not kill the stream */ }
        return;
    }
    if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (p.timer) clearTimeout(p.timer);
        if (msg.error) {
            const e = new Error(msg.error.message || 'agent error');
            e.code = msg.error.code;
            e.data = msg.error.data;
            p.reject(e);
        } else {
            p.resolve(msg.result);
        }
    }
};

AcpClient.prototype.request = function (method, params, timeoutMs) {
    if (this.closed) {
        return Promise.reject(new Error(`agent connection closed (${method})`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
        const entry = { resolve, reject, timer: undefined };
        if (timeoutMs) {
            entry.timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`${method} timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        }
        this.pending.set(id, entry);
        this._write({ jsonrpc: '2.0', id, method, params });
    });
};

AcpClient.prototype.notify = function (method, params) {
    if (!this.closed) this._write({ jsonrpc: '2.0', method, params });
};

AcpClient.prototype._write = function (obj) {
    if (!this.child || this.closed) return;
    try {
        this.child.stdin.write(JSON.stringify(obj) + '\n');
    } catch (_) { /* exit handler owns the failure */ }
};

AcpClient.prototype._fail = function (reason) {
    if (this.closed) return;
    this.closed = true;
    const tail = this.stderrTail.trim();
    const full = tail ? `${reason} — ${tail.split('\n').pop()}` : reason;
    for (const [, p] of this.pending) {
        if (p.timer) clearTimeout(p.timer);
        p.reject(new Error(full));
    }
    this.pending.clear();
    if (this.opts.onClose) {
        try { this.opts.onClose(full); } catch (_) { /* ignore */ }
    }
};

AcpClient.prototype.stop = function () {
    const child = this.child;
    this._fail('client stopped');
    if (!child || child.exitCode !== null) return;
    try { child.kill('SIGTERM'); } catch (_) { return; }
    const killer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (_) { /* gone */ }
    }, 3000);
    if (killer.unref) killer.unref();
    child.on('exit', () => clearTimeout(killer));
};

/* Handshake. Rejects on spawn failure, version mismatch, or a 30s silence —
 * a session must fail loudly, never hang. */
AcpClient.prototype.initialize = function (clientInfo) {
    return this.start()
        .then(() => this.request('initialize', {
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: {
                fs: { readTextFile: true, writeTextFile: true },
                terminal: false,
            },
            clientInfo: clientInfo ||
                { name: 'codify', title: 'Codify', version: extensionVersion() },
        }, 30000))
        .then((res) => {
            if (!res || res.protocolVersion !== PROTOCOL_VERSION) {
                const got = res && res.protocolVersion;
                throw new Error(
                    `agent offered ACP protocol v${got}; this client requires v${PROTOCOL_VERSION}`);
            }
            this.agent = res;
            return res;
        });
};

function extensionVersion() {
    try { return require('./package.json').version; } catch (_) { return '0.0.0'; }
}

/* Minimal quote-aware argv split for the adapter command settings. */
function splitCommand(s) {
    const out = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(String(s || ''))) !== null) {
        out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
    }
    return out;
}

/* ---------------- PANEL: everything below needs VS Code ---------------- */

let deps;                    /* {cg, cgJson, refresh, workspaceRoot, startTerminal} */
const panels = new Map();    /* task id -> PanelSession */
let permitSeq = 0;

function config() { return vscode.workspace.getConfiguration('codify'); }

function firstLine(s) {
    return String(s || '').trim().split('\n')[0] || 'no output';
}

function adapterCommand() {
    const driver = config().get('agent.driver') === 'claude' ? 'claude' : 'codex';
    const custom = (config().get('acp.customCommand') || '').trim();
    if (custom) return { driver: 'custom', argv: splitCommand(custom) };
    const cmd = driver === 'claude'
        ? (config().get('acp.claudeCommand') || 'claude-code-acp')
        : (config().get('acp.codexCommand') || 'codex-acp');
    return { driver, argv: splitCommand(cmd) };
}

/* The session's fs bridge: serve workspace files, refuse everything else.
 * ACP paths are absolute by contract. Pure in (root, params) so the
 * headless tests exercise exactly what a session runs. */
function workspacePath(root, p) {
    const r = path.resolve(String(root || ''));
    const abs = path.resolve(String(p || ''));
    if (abs !== r && !abs.startsWith(r + path.sep)) {
        const err = new Error(`path outside workspace: ${p}`);
        err.code = -32602;
        throw err;
    }
    return abs;
}

function readTextFile(root, params) {
    const abs = workspacePath(root, params.path);
    let text = fs.readFileSync(abs, 'utf8');
    if (params.line || params.limit) {
        const lines = text.split('\n');
        const from = Math.max(1, params.line || 1) - 1;
        const n = params.limit || lines.length;
        text = lines.slice(from, from + n).join('\n');
    }
    return { content: text };
}

function writeTextFile(root, params) {
    const abs = workspacePath(root, params.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(params.content));
    return null;
}

async function taskStatus(id) {
    const t = await deps.cgJson(['spec', 'trace']);
    const row = t && t.tasks && t.tasks.find((x) => x.id === id);
    return row ? row.status : undefined;
}

async function taskRow(id) {
    const t = await deps.cgJson(['spec', 'trace']);
    return (t && t.tasks && t.tasks.find((x) => x.id === id)) || { id, title: '' };
}

/* Resume packet as a string; degrades like the terminal path. */
async function resumePrompt(id) {
    const r = await deps.cg(['resume', '--task', id, '--prompt']);
    if (r.code === 0 && r.stdout.trim()) return r.stdout;
    const b = await deps.cg(['brief']);
    return `You are resuming Codify task ${id}.\n\n` +
        (b.stdout || '').trimEnd() + '\n\n' +
        'Use `cg context <area>` to load relevant code, run ' +
        `\`cg spec implemented ${id}\` or \`cg spec done ${id}\` when finished, ` +
        'and `cg handoff` if you stop early.\n';
}

function panelPost(sess, msg) {
    try { sess.panel.webview.postMessage(msg); } catch (_) { /* disposed */ }
}

function panelHtml(webview) {
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const raw = fs.readFileSync(path.join(__dirname, 'agentpanel.html'), 'utf8');
    return raw
        .replace(/\$\{cspSource\}/g, webview.cspSource)
        .replace(/\$\{nonce\}/g, nonce);
}

/* One prompt turn. Turns are serialized: input sent while the agent is
 * thinking queues until the turn ends. */
function sendPrompt(sess, text) {
    if (sess.running) { sess.queue.push(text); return; }
    sess.running = true;
    panelPost(sess, { type: 'chunk', role: 'user', text });
    panelPost(sess, { type: 'turn', running: true });
    sess.client.request('session/prompt', {
        sessionId: sess.sessionId,
        prompt: [{ type: 'text', text }],
    }).then(
        async (res) => {
            sess.running = false;
            panelPost(sess, { type: 'turn', running: false,
                stopReason: (res && res.stopReason) || 'end_turn' });
            deps.refresh();
            const status = await taskStatus(sess.taskId);
            if (status) panelPost(sess, { type: 'task_status', status });
            if (sess.queue.length) sendPrompt(sess, sess.queue.shift());
        },
        (e) => {
            sess.running = false;
            panelPost(sess, { type: 'turn', running: false, stopReason: 'error' });
            panelPost(sess, { type: 'status', text: e.message });
        });
}

function cancelTurn(sess) {
    if (!sess.running) return;
    sess.client.notify('session/cancel', { sessionId: sess.sessionId });
    /* outstanding permission asks die with the turn */
    for (const [pid, resolve] of sess.permits) {
        resolve({ outcome: { outcome: 'cancelled' } });
        panelPost(sess, { type: 'permission_done', pid });
    }
    sess.permits.clear();
}

function sessionRequest(sess, method, params) {
    if (method === 'fs/read_text_file') {
        return readTextFile(deps.workspaceRoot(), params);
    }
    if (method === 'fs/write_text_file') {
        return writeTextFile(deps.workspaceRoot(), params);
    }
    if (method === 'session/request_permission') {
        return new Promise((resolve) => {
            const pid = ++permitSeq;
            sess.permits.set(pid, resolve);
            panelPost(sess, {
                type: 'permission', pid,
                title: (params.toolCall && params.toolCall.title) || 'Permission request',
                options: params.options || [],
            });
        });
    }
    const err = new Error(`unsupported method: ${method}`);
    err.code = -32601;
    throw err;
}

function sessionUpdate(sess, params) {
    const u = (params && params.update) || {};
    switch (u.sessionUpdate) {
    case 'agent_message_chunk':
        panelPost(sess, { type: 'chunk', role: 'agent',
            text: u.content && u.content.type === 'text' ? u.content.text : '' });
        break;
    case 'agent_thought_chunk':
        panelPost(sess, { type: 'chunk', role: 'thought',
            text: u.content && u.content.type === 'text' ? u.content.text : '' });
        break;
    case 'tool_call':
    case 'tool_call_update':
        panelPost(sess, { type: 'tool', call: u });
        break;
    case 'plan':
        panelPost(sess, { type: 'plan', entries: u.entries || [] });
        break;
    default:
        break; /* mode/command updates are informational */
    }
}

async function endOfSession(sess, why) {
    panels.delete(sess.taskId);
    const status = await taskStatus(sess.taskId);
    if (status === 'done' || status === 'implemented') {
        deps.refresh();
        return;
    }
    const items = ['Record handoff'];
    if (sess.claimed) items.push('Release claim');
    items.push('Keep');
    const pick = await vscode.window.showWarningMessage(
        `Codify: agent session on ${sess.taskId} ended (${why}) without the ` +
        'task qualifying.', ...items);
    if (pick === 'Record handoff') {
        await vscode.commands.executeCommand('codify.agent.handoff', sess.taskId);
    } else if (pick === 'Release claim') {
        const r = await deps.cg(
            ['spec', 'release', sess.taskId, '--agent', sess.agent]);
        if (r.code !== 0) {
            vscode.window.showErrorMessage(
                `Codify: release of ${sess.taskId} failed — ` +
                firstLine(r.stderr || r.stdout));
        }
    }
    deps.refresh();
}

/* task id -> live panel session: webview + ACP client + board bookkeeping */
async function openAgentPanel(id, agent, promptText, claimed) {
    const { driver, argv } = adapterCommand();
    const task = await taskRow(id);
    const panel = vscode.window.createWebviewPanel(
        'codifyAgent', `codify: ${driver} ${id}`,
        vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = panelHtml(panel.webview);

    const sess = {
        taskId: id, agent, claimed, panel,
        client: undefined, sessionId: undefined,
        running: false, queue: [], permits: new Map(), disposed: false,
    };
    panels.set(id, sess);

    sess.client = new AcpClient({
        command: argv[0],
        args: argv.slice(1),
        cwd: deps.workspaceRoot(),
        onNotify: (m, p) => { if (m === 'session/update') sessionUpdate(sess, p); },
        onRequest: (m, p) => sessionRequest(sess, m, p),
        onClose: (reason) => {
            if (sess.disposed) return;
            panelPost(sess, { type: 'status', text: `agent closed: ${reason}` });
            panelPost(sess, { type: 'turn', running: false, stopReason: 'closed' });
            if (panels.has(id)) endOfSession(sess, reason);
        },
    });

    panel.webview.onDidReceiveMessage((msg) => {
        if (!msg) return;
        if (msg.type === 'send' && msg.text) sendPrompt(sess, String(msg.text));
        else if (msg.type === 'cancel') cancelTurn(sess);
        else if (msg.type === 'permission') {
            const resolve = sess.permits.get(msg.pid);
            if (resolve) {
                sess.permits.delete(msg.pid);
                resolve({ outcome: { outcome: 'selected', optionId: msg.optionId } });
                panelPost(sess, { type: 'permission_done', pid: msg.pid });
            }
        } else if (msg.type === 'handoff') {
            vscode.commands.executeCommand('codify.agent.handoff', id);
        }
    });

    panel.onDidDispose(() => {
        sess.disposed = true;
        cancelTurn(sess);
        sess.client.stop();
        if (panels.has(id)) endOfSession(sess, 'panel closed');
    });

    panelPost(sess, { type: 'init',
        task: { id, title: task.title || '', status: task.status || '' },
        agent, driver });

    try {
        await sess.client.initialize();
        const binary = config().get('binaryPath') || 'cg';
        const res = await sess.client.request('session/new', {
            cwd: deps.workspaceRoot(),
            mcpServers: [
                { name: 'codify', command: binary, args: ['mcp'], env: [] },
            ],
        }, 120000);
        sess.sessionId = res && res.sessionId;
        if (!sess.sessionId) throw new Error('agent returned no sessionId');
    } catch (e) {
        const auth = sess.client.agent && sess.client.agent.authMethods;
        const hint = auth && auth.length
            ? ` (auth methods: ${auth.map((a) => a.name || a.id).join(', ')})` : '';
        panelPost(sess, { type: 'status', text: `${e.message}${hint}` });
        panels.delete(id);
        if (claimed) await deps.cg(['spec', 'release', id, '--agent', agent]);
        deps.refresh();
        /* the terminal path stays the fallback when no adapter is available */
        const items = deps.startTerminal ? ['Use terminal session'] : [];
        const pick = await vscode.window.showErrorMessage(
            `Codify: agent session on ${id} failed to start — ${e.message}${hint}`,
            ...items);
        if (pick === 'Use terminal session') {
            try { panel.dispose(); } catch (_) { /* already gone */ }
            await deps.startTerminal(id);
        }
        return;
    }
    sendPrompt(sess, promptText);
}

/* Claim (parallel mode), start, seed the resume packet, open the panel.
 * Same discipline as the terminal path in agents.js: reserve before the
 * first await, release the lease on every failure path. */
async function startPanelSession(id) {
    if (!deps.workspaceRoot()) return;
    if (panels.has(id)) {
        const existing = panels.get(id);
        if (existing.panel) existing.panel.reveal();
        else vscode.window.showInformationMessage(
            `Codify: a panel session is already starting for ${id}.`);
        return;
    }
    const agent = `vscode-acp-${++permitSeq}`;
    panels.set(id, { starting: true, taskId: id, agent });
    let claimed = false;
    const mode = await deps.cgJson(['spec', 'status']);
    if (mode && mode.mode === 'parallel') {
        const c = await deps.cg(['spec', 'claim', id, '--agent', agent]);
        if (c.code !== 0) {
            panels.delete(id);
            vscode.window.showErrorMessage(
                `Codify: claim of ${id} refused — ${firstLine(c.stderr || c.stdout)}`);
            return;
        }
        claimed = true;
    }
    const s = await deps.cg(['spec', 'start', id]);
    if (s.code !== 0) {
        vscode.window.showWarningMessage(
            `Codify: spec start ${id}: ${firstLine(s.stderr || s.stdout)}`);
    }
    const prompt = await resumePrompt(id);
    /* openAgentPanel overwrites the reservation with the live entry, so the
     * duplicate guard never has a gap */
    await openAgentPanel(id, agent, prompt, claimed);
    deps.refresh();
}

async function cmdOpenPanel(arg) {
    let id = typeof arg === 'string' ? arg : arg && arg.task && arg.task.id;
    if (!id) {
        const trace = await deps.cgJson(['spec', 'trace']);
        const items = ((trace && trace.tasks) || [])
            .filter((t) => t.status === 'pending' || t.status === 'in_progress')
            .map((t) => ({ label: `${t.id}  ${t.title}`, description: t.status, id: t.id }));
        if (!items.length) {
            vscode.window.showInformationMessage('Codify: no matching tasks.');
            return;
        }
        const pick = await vscode.window.showQuickPick(items,
            { placeHolder: 'Open an agent panel on which task?' });
        if (!pick) return;
        id = pick.id;
    }
    await startPanelSession(id);
}

function registerAcpCommands(ctx) {
    const cmds = {
        'codify.agent.openPanel': cmdOpenPanel,
    };
    for (const [name, fn] of Object.entries(cmds)) {
        ctx.subscriptions.push(vscode.commands.registerCommand(name, fn));
    }
}

function register(ctx, d) {
    deps = d;
    registerAcpCommands(ctx);
    return {
        hasPanel: (id) => panels.has(id),
    };
}

module.exports = {
    AcpClient, splitCommand, register,
    /* exported for the headless fs-bridge tests */
    workspacePath, readTextFile, writeTextFile,
};
