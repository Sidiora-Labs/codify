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
const DEFAULT_CODEX_ACP_COMMAND =
    'npx -y @agentclientprotocol/codex-acp@1.7.0';

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
                /* The panel renders both select and boolean session options.
                 * Advertising boolean support is what permits an ACP agent to
                 * include those controls in session/new and later updates. */
                session: { configOptions: { boolean: {} } },
                auth: { terminal: false },
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

/* Codify previously documented Zed's adapter. Its embedded Codex build can
 * advertise a newly released model while lacking that model's metadata. Keep
 * explicit custom commands intact, but redirect that exact legacy npx package
 * to the app-server adapter release qualified with the current panel. */
function normalizeCodexAdapterCommand(value) {
    const command = String(value || '').trim() || DEFAULT_CODEX_ACP_COMMAND;
    const argv = splitCommand(command);
    const legacyPackage = argv.find((arg) =>
        arg === '@zed-industries/codex-acp' ||
        arg.startsWith('@zed-industries/codex-acp@'));
    const legacyCommand = argv[0] === 'npx' && legacyPackage ? command : '';
    return {
        command: legacyCommand ? DEFAULT_CODEX_ACP_COMMAND : command,
        legacyCommand,
    };
}

/* ---------------- PANEL: everything below needs VS Code ---------------- */

let deps;                    /* {cg, cgJson, refresh, workspaceRoot, startTerminal} */
let extensionCtx;            /* VS Code ExtensionContext for workspace history */
const panels = new Map();    /* task id -> editor-panel session */
let permitSeq = 0;
const SESSION_HISTORY_KEY = 'codify.acp.sessionHistory.v1';
const SESSION_HISTORY_MAX = 60;
const VIEW_DRIVER_KEY = 'codify.acp.viewDriver.v1';
let sessionHistory = [];

/* The sidebar chat view — resolved once, lives as long as the window. */
let agentView = null;        /* vscode.WebviewView */
let viewSession = null;      /* the session bound to the sidebar view */
let viewDriver = '';         /* header picker choice; '' -> settings */
let historyProbeStarted = false;

function config() { return vscode.workspace.getConfiguration('codify'); }

function firstLine(s) {
    return String(s || '').trim().split('\n')[0] || 'no output';
}

const DRIVER_IDS = ['codex', 'claude', 'custom'];
function driverId(v) { return DRIVER_IDS.indexOf(v) >= 0 ? v : 'codex'; }

/* Every adapter the picker can offer, with the command each would run. The
 * custom entry exists only while codify.acp.customCommand is set, so the
 * picker never offers a provider that cannot start. */
function adapterCatalog() {
    const custom = (config().get('acp.customCommand') || '').trim();
    const codex = normalizeCodexAdapterCommand(config().get('acp.codexCommand'));
    const list = [
        { id: 'codex', label: 'Codex', command: codex.command },
        { id: 'claude', label: 'Claude Code',
            command: config().get('acp.claudeCommand') || 'claude-code-acp' },
    ];
    if (custom) list.push({ id: 'custom', label: 'Custom', command: custom });
    return list;
}

function adapterMap() {
    const out = {};
    adapterCatalog().forEach((a) => { out[a.id] = { label: a.label, command: a.command }; });
    return out;
}

/* Which adapter the next session runs. Precedence: an explicit argument, the
 * header picker's remembered choice, then codify.agent.driver. A configured
 * custom command wins only when nothing explicit was chosen — the picker's
 * Codex/Claude entries must mean what they say — or when "custom" itself is
 * the choice. */
function adapterCommand(override) {
    const custom = (config().get('acp.customCommand') || '').trim();
    const explicit = override || viewDriver;
    let driver = driverId(explicit || config().get('agent.driver'));
    if (driver === 'custom' && !custom) driver = 'codex';
    if (custom && (driver === 'custom' || !explicit)) {
        return { driver: 'custom', argv: splitCommand(custom), legacyCommand: '' };
    }
    if (driver === 'claude') {
        const cmd = config().get('acp.claudeCommand') || 'claude-code-acp';
        return { driver, argv: splitCommand(cmd), legacyCommand: '' };
    }
    const selected = normalizeCodexAdapterCommand(
        config().get('acp.codexCommand'));
    return { driver: 'codex', argv: splitCommand(selected.command),
        legacyCommand: selected.legacyCommand };
}

function rememberViewDriver(value) {
    viewDriver = driverId(value);
    if (extensionCtx && extensionCtx.workspaceState) {
        extensionCtx.workspaceState.update(VIEW_DRIVER_KEY, viewDriver);
    }
}

/* Text an agent harness injects into the user role rather than the user
 * typing it: Claude Code's local-command caveat and <command-name> blocks,
 * and the "This session is being continued" summary it sends after context
 * compaction. Replayed transcripts and session/list titles both carry it.
 * Returns { kind, text } — kind '' means ordinary user text. */
const COMPACTION_RE = /^\s*This session is being continued from a previous conversation/;
function classifyUserText(raw) {
    let text = String(raw || '');
    let kind = '';
    const caveat = text.match(/^\s*<local-command-caveat>[\s\S]*?<\/local-command-caveat>\s*/);
    if (caveat) { text = text.slice(caveat[0].length); kind = 'caveat'; }
    const cmd = text.match(/^\s*<command-name>([\s\S]*?)<\/command-name>[\s\S]*?(?:<command-args>([\s\S]*?)<\/command-args>)?/);
    if (cmd) {
        const args = (cmd[2] || '').trim();
        return { kind: 'command', text: cmd[1].trim() + (args ? ' ' + args : '') };
    }
    if (COMPACTION_RE.test(text)) return { kind: 'compaction', text };
    if (/^\s*<system-reminder>/.test(text)) return { kind: 'system', text };
    return { kind, text };
}

/* A history title a person can pick from: harness prefixes stripped, a
 * compaction summary reduced to its "Primary Request" sentence and marked as
 * a continuation, everything on one line and bounded. */
function sessionTitle(raw) {
    const c = classifyUserText(raw);
    let text = c.text;
    if (c.kind === 'command') text = '/' + text.replace(/^\//, '');
    else if (c.kind === 'compaction') {
        const m = text.match(/Primary Request and Intent:?\s*([\s\S]*?)(?:\n\s*\n|\n\s*2\.)/);
        let gist = m ? m[1] : '';
        gist = gist.replace(/^\s*(The user|User)\s+(wants|asked|needs|requested)\s+(to\s+)?/i, '')
            .replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
        text = '↻ continued' + (gist ? ': ' + gist : ' session');
    } else if (c.kind === 'system') text = '';
    text = text.replace(/\s+/g, ' ').trim();
    if (text.length > 80) text = text.slice(0, 77).replace(/\s+\S*$/, '') + '…';
    return text;
}

function sessionRecord(row, driver) {
    if (!row || !row.sessionId) return undefined;
    return {
        sessionId: String(row.sessionId),
        title: row.title == null ? '' : sessionTitle(row.title),
        updatedAt: row.updatedAt || new Date().toISOString(),
        cwd: row.cwd || (deps && deps.workspaceRoot && deps.workspaceRoot()) || '',
        driver: driverId(driver),
    };
}

function mergeSessionHistory(rows, driver) {
    const merged = new Map(sessionHistory.map((r) => [`${r.driver}:${r.sessionId}`, r]));
    for (const row of rows || []) {
        const next = sessionRecord(row, row.driver || driver);
        if (!next) continue;
        const key = `${next.driver}:${next.sessionId}`;
        merged.set(key, Object.assign({}, merged.get(key) || {}, next));
    }
    sessionHistory = Array.from(merged.values())
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .slice(0, SESSION_HISTORY_MAX);
    if (extensionCtx && extensionCtx.workspaceState) {
        extensionCtx.workspaceState.update(SESSION_HISTORY_KEY, sessionHistory);
    }
    return sessionHistory;
}

function rememberSession(sess, extra) {
    if (!sess || !sess.sessionId) return;
    const info = Object.assign({}, sess.sessionInfo || {}, extra || {}, {
        sessionId: sess.sessionId, driver: sess.driver,
        cwd: deps.workspaceRoot(), updatedAt: (extra && extra.updatedAt) ||
            (sess.sessionInfo && sess.sessionInfo.updatedAt) || new Date().toISOString(),
    });
    mergeSessionHistory([info], sess.driver);
    postView({ type: 'sessions', sessions: sessionHistory });
}

function mcpServers() {
    const binary = config().get('binaryPath') || 'cg';
    return [{ name: 'codify', command: binary, args: ['mcp'], env: [] }];
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
    if (id === '@docs') {
        const s = await deps.cgJson(['spec', 'status']);
        return s && s.documentation && s.documentation.status;
    }
    const t = await deps.cgJson(['spec', 'trace']);
    const row = t && t.tasks && t.tasks.find((x) => x.id === id);
    return row ? row.status : undefined;
}

async function taskRow(id) {
    if (id === '@docs') {
        const s = await deps.cgJson(['spec', 'status']);
        return { id, title: 'Generate and verify project documentation',
            status: s && s.documentation ? s.documentation.status : '' };
    }
    const t = await deps.cgJson(['spec', 'trace']);
    return (t && t.tasks && t.tasks.find((x) => x.id === id)) || { id, title: '' };
}

/* Resume packet as a string; degrades like the terminal path. */
async function resumePrompt(id) {
    const r = id === '@docs'
        ? await deps.cg(['docs', 'packet'])
        : await deps.cg(['resume', '--task', id, '--prompt']);
    if (id === '@docs' && r.code === 0 && r.stdout.trim()) {
        return 'You own Codify\'s final @docs closure. Update only configured ' +
            'documentation targets from this evidence, keep user, developer, ' +
            'and release coverage explicit, then finish with `cg docs close`. ' +
            'Do not run `cg spec run` or `cg spec done @docs`.\n\n' + r.stdout;
    }
    if (r.code === 0 && r.stdout.trim()) return r.stdout;
    if (id === '@docs') throw new Error('Documentation evidence packet failed: ' + r.stderr);
    const b = await deps.cg(['brief']);
    return `You are resuming Codify task ${id}.\n\n` +
        (b.stdout || '').trimEnd() + '\n\n' +
        'Use `cg context <area>` to load relevant code, run ' +
        `\`cg spec implemented ${id}\` or \`cg spec done ${id}\` when finished, ` +
        'and `cg handoff` if you stop early.\n';
}

function panelPost(sess, msg) {
    try { sess.webview.postMessage(msg); } catch (_) { /* disposed */ }
}

function panelHtml(webview) {
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const raw = fs.readFileSync(path.join(__dirname, 'agentpanel.html'), 'utf8');
    return raw
        .replace(/\$\{cspSource\}/g, webview.cspSource)
        .replace(/\$\{nonce\}/g, nonce);
}

/* One prompt turn. Turns are serialized, queued input is reported to the
 * activity bar, localEcho absorbs mirrored user_message_chunk updates, and a
 * successful turn refreshes the compact workspace session registry. */
function sendPrompt(sess, text, echo) {
    if (sess.running) {
        sess.queue.push({ text, echo });
        panelPost(sess, { type: 'queue', count: sess.queue.length });
        return;
    }
    sess.running = true;
    sess.localEcho = echo || text;
    panelPost(sess, { type: 'chunk', role: 'user',
        text: echo || text, cmd: !!echo });
    panelPost(sess, { type: 'turn', running: true });
    sess.client.request('session/prompt', {
        sessionId: sess.sessionId,
        prompt: [{ type: 'text', text }],
    }).then(
        async (res) => {
            sess.running = false;
            sess.localEcho = '';
            panelPost(sess, { type: 'turn', running: false,
                stopReason: (res && res.stopReason) || 'end_turn' });
            rememberSession(sess);
            deps.refresh();
            const status = await taskStatus(sess.taskId);
            if (status) panelPost(sess, { type: 'task_status', status });
            if (sess.queue.length) {
                const q = sess.queue.shift();
                panelPost(sess, { type: 'queue', count: sess.queue.length });
                sendPrompt(sess, q.text, q.echo);
            }
        },
        (e) => {
            sess.running = false;
            sess.localEcho = '';
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
    case 'user_message_chunk': {
        const text = u.content && u.content.type === 'text' ? u.content.text : '';
        /* Most adapters echo the prompt we already drew locally. Consume that
         * echo, but retain user chunks received while restoring a session. */
        if (text && sess.localEcho && sess.localEcho.indexOf(text) === 0) {
            sess.localEcho = sess.localEcho.slice(text.length);
        } else if (text) {
            const c = classifyUserText(text);
            panelPost(sess, c.kind ? { type: 'chunk', role: 'user', text: c.text, harness: c.kind }
                : { type: 'chunk', role: 'user', text });
        }
        break;
    }
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
    case 'available_commands_update':
        sess.commands = Array.isArray(u.availableCommands) ? u.availableCommands : [];
        panelPost(sess, { type: 'agent_commands', commands: sess.commands });
        break;
    case 'current_mode_update':
        if (sess.modes) sess.modes.currentModeId = u.currentModeId;
        panelPost(sess, { type: 'mode', currentModeId: u.currentModeId,
            modes: sess.modes && sess.modes.availableModes });
        break;
    case 'config_option_update':
        sess.configOptions = Array.isArray(u.configOptions) ? u.configOptions : [];
        panelPost(sess, { type: 'config', options: sess.configOptions });
        break;
    case 'session_info_update':
        sess.sessionInfo = Object.assign({}, sess.sessionInfo || {});
        if (u.title !== undefined) sess.sessionInfo.title = sessionTitle(u.title);
        if (u.updatedAt !== undefined) sess.sessionInfo.updatedAt = u.updatedAt;
        panelPost(sess, { type: 'session_info', title: sess.sessionInfo.title,
            updatedAt: u.updatedAt });
        rememberSession(sess, sess.sessionInfo);
        break;
    case 'usage_update':
        panelPost(sess, { type: 'usage', used: u.used, size: u.size, cost: u.cost });
        break;
    default:
        break; /* unknown variants are forward-compatible */
    }
}

async function endOfSession(sess, why) {
    if (sess.panel) panels.delete(sess.taskId);
    if (viewSession === sess) {
        viewSession = null;
        panelPost(sess, { type: 'session_end', why });
    }
    if (!sess.taskId) { deps.refresh(); return; }
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

/* Start and initialize one adapter process without assuming whether the next
 * operation creates, lists, loads, or resumes a session. The driver recorded
 * on the session is whichever adapter actually launched — codex, claude, or
 * custom — so history restores through the same one. */
async function connectAgent(sess, driverOverride) {
    const { driver, argv, legacyCommand } = adapterCommand(driverOverride);
    sess.driver = driverId(driver);
    if (legacyCommand && !sess.probe) {
        panelPost(sess, { type: 'notice', text:
            'Using @agentclientprotocol/codex-acp 1.7.0 because the legacy ' +
            '@zed-industries/codex-acp launcher lacks current Codex model metadata. ' +
            'Update codify.acp.codexCommand to remove this compatibility redirect.' });
    }
    sess.client = new AcpClient({
        command: argv[0],
        args: argv.slice(1),
        cwd: deps.workspaceRoot(),
        onNotify: (m, p) => { if (m === 'session/update') sessionUpdate(sess, p); },
        onRequest: (m, p) => sessionRequest(sess, m, p),
        onClose: (reason) => {
            if (sess.disposed || sess.closing || sess.probe) return;
            sess.closing = true;
            panelPost(sess, { type: 'status', text: `agent closed: ${reason}` });
            panelPost(sess, { type: 'turn', running: false, stopReason: 'closed' });
            if (sess.panel ? panels.has(sess.taskId) : viewSession === sess) {
                endOfSession(sess, reason);
            }
        },
    });
    return sess.client.initialize();
}

/* Apply the common state returned by session/new, session/load, and
 * session/resume after any replay notifications have already been rendered. */
function publishConnectedSession(sess, res) {
    res = res || {};
    sess.modes = res.modes || sess.modes;
    sess.configOptions = res.configOptions || sess.configOptions || [];
    panelPost(sess, { type: 'connection',
        agent: sess.client.agent && sess.client.agent.agentInfo,
        mcpServers: ['codify'] });
    if (sess.modes) panelPost(sess, { type: 'mode',
        currentModeId: sess.modes.currentModeId,
        modes: sess.modes.availableModes || [] });
    if (sess.configOptions.length) {
        panelPost(sess, { type: 'config', options: sess.configOptions });
    }
    if (sess.sessionInfo) {
        panelPost(sess, { type: 'session_info', title: sess.sessionInfo.title,
            updatedAt: sess.sessionInfo.updatedAt });
    }
    rememberSession(sess);
}

/* Negotiate the adapter, create a fresh session, and inject Codify's MCP
 * server. Initial updates may legally arrive before session/new returns. */
async function connectSession(sess, driverOverride) {
    await connectAgent(sess, driverOverride);
    const res = await sess.client.request('session/new', {
        cwd: deps.workspaceRoot(),
        mcpServers: mcpServers(),
    }, 120000);
    sess.sessionId = res && res.sessionId;
    if (!sess.sessionId) throw new Error('agent returned no sessionId');
    publishConnectedSession(sess, res);
}

function connectFailureHint(sess, e) {
    const auth = sess.client && sess.client.agent && sess.client.agent.authMethods;
    const hint = auth && auth.length
        ? ` (auth methods: ${auth.map((a) => a.name || a.id).join(', ')})` : '';
    return `${e.message}${hint}`;
}

/* Post to whichever surface owns this session; a null session means the
 * idle sidebar view. */
function surfacePost(sess, msg) {
    if (sess) panelPost(sess, msg);
    else postView(msg);
}

/* Open a workspace-relative (or absolute) path in the editor. */
async function openLocation(p, line) {
    const root = deps.workspaceRoot();
    if (!root || !p) return;
    let abs;
    try {
        abs = workspacePath(root, path.isAbsolute(p) ? p : path.join(root, p));
    } catch (_) {
        return;                       /* outside the workspace: not ours to open */
    }
    try {
        const doc = await vscode.workspace.openTextDocument(abs);
        const ed = await vscode.window.showTextDocument(doc, { preview: true });
        if (line) {
            const at = new vscode.Position(Math.max(0, line - 1), 0);
            ed.selection = new vscode.Selection(at, at);
            ed.revealRange(new vscode.Range(at, at),
                vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
    } catch (e) {
        vscode.window.showWarningMessage(`Codify: cannot open ${p} — ${e.message}`);
    }
}

/* External Markdown links leave the webview through VS Code so navigation is
 * explicit and only http(s) targets accepted from agent-authored content. */
async function openExternal(href) {
    let target;
    try { target = new URL(String(href || '')); } catch (_) { return; }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return;
    await vscode.env.openExternal(vscode.Uri.parse(target.href));
}

/* cg verbs the chat can run inline. `zero` means the command takes no
 * arguments, so trailing text is the user's instruction instead. */
const CG_CMDS = {
    brief:   { argv: () => ['brief'], zero: true,
        ask: 'Pick up from this state; say what you plan to do first.' },
    next:    { argv: () => ['spec', 'next'], zero: true,
        ask: 'Is this the right task to take? Say what it needs.' },
    status:  { argv: () => ['spec', 'status'], zero: true,
        ask: 'Summarise where the board stands.' },
    review:  { argv: () => ['review'], zero: true,
        ask: 'Review this against the acceptance criteria and flag the risk.' },
    check:   { argv: () => ['check'], zero: true,
        ask: 'Fix whatever this gate reports.' },
    guard:   { argv: () => ['guard'], zero: true,
        ask: 'Are these edits inside the task scope? Address any drift.' },
    changes: { argv: () => ['changes'], zero: true,
        ask: 'What is the blast radius of these edits?' },
    docs:    { argv: () => ['docs', 'status'], zero: true,
        ask: 'Summarise documentation closure and its next action.' },
    docplan: { argv: () => ['docs', 'plan'], zero: true,
        ask: 'Use this plan to explain which documents need work.' },
    doccheck:{ argv: () => ['docs', 'check'], zero: true,
        ask: 'Fix every failed documentation check before closure.' },
    doctrace:{ argv: () => ['docs', 'trace'], zero: true,
        ask: 'Explain how the documentation is grounded in project evidence.' },
    tests:   { argv: (a) => (a ? ['test-impact', a] : ['test-impact']),
        ask: 'Which of these should I run, and why?' },
    context: { argv: (a) => ['context', a], need: 'a query',
        ask: 'Use this context to answer what I ask next.' },
    search:  { argv: (a) => ['search', a], need: 'a query',
        ask: 'Which of these is the definition I want?' },
    impact:  { argv: (a) => ['impact', a], need: 'a symbol',
        ask: 'What breaks if I change this?' },
    why:     { argv: (a) => ['why', a], need: 'a symbol',
        ask: 'Explain why this exists the way it does.' },
};

async function boardInfo() {
    const st = await deps.cgJson(['spec', 'status']);
    return st && st.feature
        ? { feature: st.feature, mode: st.mode || '' } : { feature: 'codify', mode: '' };
}

/* Run a Codify command, show its output in the transcript, and hand the
 * result to the agent as context. */
async function runCgSlash(sess, cmd, args, send) {
    const spec = CG_CMDS[cmd];
    if (spec.need && !args) {
        surfacePost(sess, { type: 'chunk', role: 'user',
            text: `/${cmd}`, cmd: true });
        surfacePost(sess, { type: 'status',
            text: `/${cmd} needs ${spec.need} — try /${cmd} <${spec.need.split(' ').pop()}>` });
        return;
    }
    const argv = spec.argv(args);
    const r = await deps.cg(argv);
    const out = ((r.stdout || '') + (r.code === 0 ? '' : '\n' + (r.stderr || ''))).trim();
    const echo = `/${cmd}${args ? ' ' + args : ''}`;
    surfacePost(sess, { type: 'cmdout', cmd: argv.join(' '),
        ok: r.code === 0, output: out || '(no output)' });
    if (!out) {
        surfacePost(sess, { type: 'chunk', role: 'user', text: echo, cmd: true });
        return;
    }
    const ask = (spec.zero && args) ? args : spec.ask;
    const prompt = `\`cg ${argv.join(' ')}\` says:\n\n\`\`\`\n${out}\n\`\`\`\n\n${ask}`;
    await send(prompt, echo);
}

/* Attach a spec task to a live session: claim, start, and brief the agent
 * with the resume packet — the board discipline, mid-conversation. */
async function attachTask(sess, id) {
    const mode = await deps.cgJson(['spec', 'status']);
    if (mode && mode.mode === 'parallel' && !sess.claimed) {
        const c = await deps.cg(['spec', 'claim', id, '--agent', sess.agent]);
        if (c.code !== 0) {
            surfacePost(sess, { type: 'status',
                text: `claim of ${id} refused — ${firstLine(c.stderr || c.stdout)}` });
            return;
        }
        sess.claimed = true;
    }
    sess.taskId = id;
    const s = id === '@docs'
        ? await deps.cg(['spec', 'docs', 'start'])
        : await deps.cg(['spec', 'start', id]);
    if (s.code !== 0) {
        surfacePost(sess, { type: 'status',
            text: `spec start ${id}: ${firstLine(s.stderr || s.stdout)}` });
    }
    const task = await taskRow(id);
    surfacePost(sess, { type: 'task',
        task: { id, title: task.title || '', status: task.status || '' } });
    const prompt = await resumePrompt(id);
    sendPrompt(sess, prompt, `/task ${id}`);
    deps.refresh();
}

/* Task lifecycle straight from the chat: the same cg verbs the board's
 * inline actions run, shown as a card and reflected on the task pill. The
 * agent is told the outcome so a refused `done` becomes its next step rather
 * than a surprise. */
async function taskLifecycle(sess, verb, send) {
    const id = sess && sess.taskId;
    if (!id) {
        surfacePost(sess, { type: 'status',
            text: `/${verb} needs an attached task — use /task <id> first` });
        return;
    }
    const argv = id === '@docs'
        ? (verb === 'done' ? ['docs', 'close'] : ['spec', 'docs', verb])
        : ['spec', verb, id];
    const r = await deps.cg(argv);
    const out = ((r.stdout || '') + (r.code === 0 ? '' : '\n' + (r.stderr || ''))).trim();
    surfacePost(sess, { type: 'chunk', role: 'user', text: `/${verb}`, cmd: true });
    surfacePost(sess, { type: 'cmdout', cmd: argv.join(' '), ok: r.code === 0,
        output: out || '(no output)', open: r.code !== 0 });
    const status = await taskStatus(id);
    if (status) surfacePost(sess, { type: 'task_status', status });
    deps.refresh();
    if (r.code !== 0 && send) {
        await send(`\`cg ${argv.join(' ')}\` was refused:\n\n\`\`\`\n${out}\n\`\`\`\n\n` +
            'Fix what it reports, then say when it is ready to run again.',
        `/${verb}`);
    }
}

async function pickTaskId(placeHolder) {
    const trace = await deps.cgJson(['spec', 'trace']);
    const items = ((trace && trace.tasks) || [])
        .filter((t) => t.status === 'pending' || t.status === 'in_progress')
        .map((t) => ({ label: `${t.id}  ${t.title}`, description: t.status, id: t.id }));
    if (!items.length) {
        vscode.window.showInformationMessage('Codify: no eligible tasks.');
        return undefined;
    }
    const pick = await vscode.window.showQuickPick(items, { placeHolder });
    return pick && pick.id;
}

/* Webview messages any session surface understands: native ACP controls and
 * commands, workspace locations, validated external links, and the provider
 * configure gear (which never needs a session). */
function handleSessionMessage(sess, msg) {
    if (!msg) return false;
    if (msg.type === 'send' && msg.text) {
        sendPrompt(sess, String(msg.text));
        return true;
    }
    if (msg.type === 'agent_command' && msg.name) {
        const input = String(msg.input || '').trim();
        const text = `/${String(msg.name)}${input ? ' ' + input : ''}`;
        sendPrompt(sess, text);
        return true;
    }
    if (msg.type === 'set_mode' && msg.modeId) {
        sess.client.request('session/set_mode', {
            sessionId: sess.sessionId, modeId: String(msg.modeId),
        }, 30000).catch((e) => panelPost(sess,
            { type: 'status', text: `mode change failed: ${e.message}` }));
        return true;
    }
    if (msg.type === 'set_config' && msg.configId) {
        const params = { sessionId: sess.sessionId,
            configId: String(msg.configId), value: msg.value };
        if (msg.valueType === 'boolean') params.type = 'boolean';
        sess.client.request('session/set_config_option', params, 30000).then(
            (res) => {
                if (res && Array.isArray(res.configOptions)) {
                    sess.configOptions = res.configOptions;
                    panelPost(sess, { type: 'config', options: res.configOptions });
                }
            },
            (e) => panelPost(sess,
                { type: 'status', text: `setting change failed: ${e.message}` }));
        return true;
    }
    if (msg.type === 'cancel') { cancelTurn(sess); return true; }
    if (msg.type === 'permission') {
        const resolve = sess.permits.get(msg.pid);
        if (resolve) {
            sess.permits.delete(msg.pid);
            resolve({ outcome: { outcome: 'selected', optionId: msg.optionId } });
            panelPost(sess, { type: 'permission_done', pid: msg.pid });
        }
        return true;
    }
    if (msg.type === 'handoff' && sess.taskId) {
        vscode.commands.executeCommand('codify.agent.handoff', sess.taskId);
        return true;
    }
    if (msg.type === 'open') { openLocation(msg.path, msg.line); return true; }
    if (msg.type === 'external') { openExternal(msg.href); return true; }
    if (msg.type === 'copy') {
        vscode.env.clipboard.writeText(String(msg.text || ''));
        return true;
    }
    if (msg.type === 'ready') {
        if (sess.initMsg) panelPost(sess, sess.initMsg);
        return true;
    }
    if (msg.type === 'configure') { cmdConfigure(); return true; }
    if (msg.type === 'slash') {
        sessionSlash(sess, String(msg.cmd || ''), String(msg.args || ''));
        return true;
    }
    return false;
}

/* Slash commands against a live session (sidebar or editor panel). The task
 * lifecycle verbs (/done, /implemented) run the real qualification and hand a
 * refusal back to the agent rather than silently marking the task. */
async function sessionSlash(sess, cmd, args) {
    if (CG_CMDS[cmd]) {
        await runCgSlash(sess, cmd, args,
            (text, echo) => sendPrompt(sess, text, echo));
        return;
    }
    if (cmd === 'task') {
        const id = args || await pickTaskId('Attach which task to this chat?');
        if (id) await attachTask(sess, id);
        return;
    }
    if (cmd === 'remember') {
        if (!args) {
            surfacePost(sess, { type: 'status', text: '/remember needs the decision text' });
            return;
        }
        const r = await deps.cg(['remember', args]);
        surfacePost(sess, { type: 'chunk', role: 'user',
            text: `/remember ${args}`, cmd: true });
        surfacePost(sess, { type: 'cmdout', cmd: 'remember', ok: r.code === 0,
            output: (r.stdout || r.stderr || '').trim() || 'saved' });
        deps.refresh();
        return;
    }
    if (cmd === 'open') {
        if (args) openLocation(args);
        return;
    }
    if (cmd === 'handoff') {
        if (sess.taskId) vscode.commands.executeCommand('codify.agent.handoff', sess.taskId);
        else surfacePost(sess, { type: 'status', text: 'no task is attached to this chat' });
        return;
    }
    if (cmd === 'done' || cmd === 'implemented') {
        await taskLifecycle(sess, cmd, (text, echo) => sendPrompt(sess, text, echo));
        return;
    }
    if (cmd === 'new') { await resetViewSession(); return; }
    surfacePost(sess, { type: 'status', text: `unknown command /${cmd}` });
}

function newSession(webview, extra) {
    return Object.assign({
        taskId: undefined, agent: '', claimed: false, panel: undefined,
        webview, client: undefined, sessionId: undefined,
        running: false, queue: [], permits: new Map(),
        commands: [], modes: undefined, configOptions: [], sessionInfo: undefined,
        localEcho: '',
        disposed: false, closing: false, initMsg: undefined,
    }, extra || {});
}

/* Editor-panel session on a task. The sidebar view is the default surface;
 * editor panels carry concurrent task sessions beside it and receive the same
 * visible build identity and labelled adapter catalog as the sidebar. */
async function openAgentPanel(id, agent, promptText, claimed) {
    const { driver } = adapterCommand();
    const task = await taskRow(id);
    const panel = vscode.window.createWebviewPanel(
        'codifyAgent', `codify: ${driver} ${id}`,
        vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = panelHtml(panel.webview);

    const sess = newSession(panel.webview, { taskId: id, agent, claimed, panel });
    panels.set(id, sess);

    panel.webview.onDidReceiveMessage((msg) => handleSessionMessage(sess, msg));
    panel.onDidDispose(() => {
        sess.disposed = true;
        cancelTurn(sess);
        if (sess.client) sess.client.stop();
        if (panels.has(id)) endOfSession(sess, 'panel closed');
    });

    sess.initMsg = { type: 'init', idle: false, version: extensionVersion(),
        task: { id, title: task.title || '', status: task.status || '' },
        agent, driver, drivers: [driver], adapters: adapterMap(), feature: id };
    panelPost(sess, sess.initMsg);

    try {
        await connectSession(sess);
    } catch (e) {
        const why = connectFailureHint(sess, e);
        panelPost(sess, { type: 'status', text: why });
        panels.delete(id);
        if (claimed) await deps.cg(['spec', 'release', id, '--agent', agent]);
        deps.refresh();
        /* the terminal path stays the fallback when no adapter is available */
        const items = deps.startTerminal ? ['Use terminal session'] : [];
        const pick = await vscode.window.showErrorMessage(
            `Codify: agent session on ${id} failed to start — ${why}`, ...items);
        if (pick === 'Use terminal session') {
            try { panel.dispose(); } catch (_) { /* already gone */ }
            await deps.startTerminal(id);
        }
        return;
    }
    sendPrompt(sess, promptText);
}

/* Claim (parallel mode), start, seed the resume packet, open an editor
 * panel. Same discipline as the terminal path in agents.js: reserve before
 * the first await, release the lease on every failure path. */
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
    const s = id === '@docs'
        ? await deps.cg(['spec', 'docs', 'start'])
        : await deps.cg(['spec', 'start', id]);
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

/* ---------------- the sidebar chat view ---------------- */

function currentDriver() {
    return adapterCommand(viewDriver).driver;
}

function postView(msg) {
    if (agentView) {
        try { agentView.webview.postMessage(msg); } catch (_) { /* hidden */ }
    }
}

function viewIdle() { return !viewSession; }

/* Reveal the view and wait for VS Code to resolve it. */
async function focusView() {
    try {
        await vscode.commands.executeCommand('codifyAgentView.focus');
    } catch (_) { /* view container hidden by the user */ }
    for (let i = 0; i < 50 && !agentView; i++) {
        await new Promise((r) => setTimeout(r, 100));
    }
    return !!agentView;
}

function agentCapabilities(sess) {
    return (sess && sess.client && sess.client.agent &&
        sess.client.agent.agentCapabilities) || {};
}

/* Merge the durable workspace registry with the adapter's authoritative,
 * paginated session/list surface. A probe never becomes the active chat. */
async function listPastSessions(quiet) {
    postView({ type: 'sessions', sessions: sessionHistory, loading: true });
    let sess = viewSession && viewSession.client ? viewSession : undefined;
    let probe;
    try {
        if (!sess) {
            probe = newSession(agentView.webview, {
                agent: `vscode-history-${++permitSeq}`, probe: true,
            });
            sess = probe;
            await connectAgent(sess, viewDriver);
        }
        const caps = agentCapabilities(sess);
        const lifecycle = caps.sessionCapabilities || {};
        if (!lifecycle.list) {
            postView({ type: 'sessions', sessions: sessionHistory,
                note: sessionHistory.length ?
                    'Adapter cannot list more sessions; showing saved workspace history.' :
                    'This adapter does not expose session history.' });
            return sessionHistory;
        }
        const found = [];
        let cursor;
        for (let page = 0; page < 5; page++) {
            const res = await sess.client.request('session/list', {
                cwd: deps.workspaceRoot(), cursor: cursor || null,
            }, 30000);
            for (const row of (res && res.sessions) || []) {
                found.push(Object.assign({}, row, { driver: sess.driver }));
            }
            cursor = res && res.nextCursor;
            if (!cursor) break;
        }
        mergeSessionHistory(found, sess.driver);
        postView({ type: 'sessions', sessions: sessionHistory });
        return sessionHistory;
    } catch (e) {
        postView({ type: 'sessions', sessions: sessionHistory,
            note: `Session history unavailable: ${e.message}` });
        if (!quiet) postView({ type: 'status', text: `session history: ${e.message}` });
        return sessionHistory;
    } finally {
        if (probe && probe.client) {
            probe.closing = true;
            probe.client.stop();
        }
    }
}

/* Restore a selected session with full replay when possible, otherwise use
 * ACP resume and state clearly that the previous transcript was not replayed.
 * The session's own driver becomes the remembered view driver so a later chat
 * continues with the same provider. */
async function restorePastSession(sessionId, driver) {
    const known = sessionHistory.find((r) => r.sessionId === sessionId &&
        (!driver || r.driver === driver));
    if (!known) {
        postView({ type: 'status', text: 'That past session is no longer available.' });
        return;
    }
    if (viewSession) await resetViewSession();
    rememberViewDriver(known.driver);
    postView({ type: 'reset', driver: viewDriver });

    const sess = newSession(agentView.webview, {
        agent: `vscode-restore-${++permitSeq}`, sessionId: known.sessionId,
        sessionInfo: { title: known.title, updatedAt: known.updatedAt }, restoring: true,
    });
    viewSession = sess;
    postView({ type: 'status', text: `restoring ${known.title || known.sessionId}…` });
    postView({ type: 'session', live: true });
    try {
        await connectAgent(sess, viewDriver);
        const caps = agentCapabilities(sess);
        const lifecycle = caps.sessionCapabilities || {};
        let res;
        let replayed = false;
        const params = { sessionId: known.sessionId, cwd: deps.workspaceRoot(),
            mcpServers: mcpServers() };
        if (caps.loadSession) {
            res = await sess.client.request('session/load', params, 120000);
            replayed = true;
        } else if (lifecycle.resume) {
            res = await sess.client.request('session/resume', params, 120000);
        } else {
            throw new Error('adapter can list sessions but cannot load or resume them');
        }
        publishConnectedSession(sess, res);
        postView({ type: 'status', text: '' });
        postView({ type: 'notice', text: replayed ? 'Past session loaded.' :
            'Session context resumed; this adapter cannot replay the earlier transcript.' });
    } catch (e) {
        sess.closing = true;
        if (sess.client) sess.client.stop();
        if (viewSession === sess) viewSession = null;
        postView({ type: 'session', live: false });
        postView({ type: 'status', text: `restore failed: ${e.message}` });
    }
}

/* Chat in the sidebar: the adapter spawns lazily on the first message —
 * a workspace session with Codify's MCP tools, no task and no claim unless
 * taskOpts says so. */
async function startChatSession(firstText, taskOpts, echo) {
    const sess = newSession(agentView.webview,
        Object.assign({ agent: `vscode-chat-${++permitSeq}` }, taskOpts || {}));
    viewSession = sess;
    const driver = currentDriver();
    postView({ type: 'status', text: `starting ${driver} agent…` });
    postView({ type: 'session', live: true });
    try {
        await connectSession(sess, viewDriver);
    } catch (e) {
        const why = connectFailureHint(sess, e);
        viewSession = null;
        if (sess.claimed) {
            await deps.cg(['spec', 'release', sess.taskId, '--agent', sess.agent]);
        }
        postView({ type: 'status', text: why });
        postView({ type: 'session', live: false });
        deps.refresh();
        const items = sess.taskId && deps.startTerminal
            ? ['Use terminal session'] : [];
        const pick = await vscode.window.showErrorMessage(
            `Codify: ${driver} agent failed to start — ${why}`, ...items);
        if (pick === 'Use terminal session') await deps.startTerminal(sess.taskId);
        return;
    }
    postView({ type: 'status', text: '' });
    sendPrompt(sess, firstText, echo);
    deps.refresh();
}

/* Start-on-task, sidebar edition: the agents.js discipline, then the
 * session runs in the view with the resume packet as its first message. */
async function startTaskInView(id) {
    const agent = `vscode-acp-${++permitSeq}`;
    /* reserve before the first await so a double invocation offers
     * replace/beside instead of racing this claim */
    viewSession = newSession(agentView.webview, { taskId: id, agent, starting: true });
    let claimed = false;
    const mode = await deps.cgJson(['spec', 'status']);
    if (mode && mode.mode === 'parallel') {
        const c = await deps.cg(['spec', 'claim', id, '--agent', agent]);
        if (c.code !== 0) {
            viewSession = null;
            vscode.window.showErrorMessage(
                `Codify: claim of ${id} refused — ${firstLine(c.stderr || c.stdout)}`);
            return;
        }
        claimed = true;
    }
    const s = id === '@docs'
        ? await deps.cg(['spec', 'docs', 'start'])
        : await deps.cg(['spec', 'start', id]);
    if (s.code !== 0) {
        vscode.window.showWarningMessage(
            `Codify: spec start ${id}: ${firstLine(s.stderr || s.stdout)}`);
    }
    const task = await taskRow(id);
    postView({ type: 'task',
        task: { id, title: task.title || '', status: task.status || '' } });
    const prompt = await resumePrompt(id);
    viewSession = null;   /* startChatSession installs the live session */
    await startChatSession(prompt, { taskId: id, agent, claimed }, `/task ${id}`);
}

/* End the view's session (offering handoff/release for an unqualified
 * attached task) and put the view back in its idle chat state. */
async function resetViewSession() {
    const sess = viewSession;
    viewSession = null;
    if (sess && sess.client) {
        sess.closing = true;
        cancelTurn(sess);
        sess.client.stop();
        if (sess.taskId) await endOfSession(sess, 'new chat');
    } else if (sess && sess.claimed) {
        await deps.cg(['spec', 'release', sess.taskId, '--agent', sess.agent]);
    }
    postView({ type: 'reset', driver: currentDriver() });
    deps.refresh();
}

async function postViewInit() {
    const b = await boardInfo();
    const sess = viewSession;
    let task;
    if (sess && sess.taskId) {
        const row = await taskRow(sess.taskId);
        task = { id: sess.taskId, title: row.title || '', status: row.status || '' };
    }
    postView({ type: 'init', idle: viewIdle(), version: extensionVersion(),
        driver: currentDriver(), drivers: adapterCatalog().map((a) => a.id),
        adapters: adapterMap(),
        feature: b.feature + (b.mode ? ' · ' + b.mode : ''), task });
    postView({ type: 'sessions', sessions: sessionHistory });
    if (sess && sess.client) postView({ type: 'session', live: true });
    if (!historyProbeStarted) {
        historyProbeStarted = true;
        setTimeout(() => listPastSessions(true), 0);
    }
}

/* Slash commands with no session yet: the cg output becomes the opening
 * prompt, so /brief starts the agent already briefed. Task verbs need an
 * attached task and say so instead of starting a session. */
async function idleSlash(cmd, args) {
    if (CG_CMDS[cmd]) {
        await runCgSlash(null, cmd, args,
            (text, echo) => startChatSession(text, undefined, echo));
        return;
    }
    if (cmd === 'task') {
        const id = args || await pickTaskId('Work which task in the agent chat?');
        if (id) await startTaskInView(id);
        return;
    }
    if (cmd === 'remember') {
        if (!args) {
            postView({ type: 'status', text: '/remember needs the decision text' });
            return;
        }
        const r = await deps.cg(['remember', args]);
        postView({ type: 'chunk', role: 'user', text: `/remember ${args}`, cmd: true });
        postView({ type: 'cmdout', cmd: 'remember', ok: r.code === 0,
            output: (r.stdout || r.stderr || '').trim() || 'saved' });
        deps.refresh();
        return;
    }
    if (cmd === 'open') { if (args) openLocation(args); return; }
    if (cmd === 'new') { postView({ type: 'reset', driver: currentDriver() }); return; }
    if (cmd === 'handoff' || cmd === 'done' || cmd === 'implemented') {
        postView({ type: 'status', text: 'no task is attached to this chat' });
        return;
    }
    postView({ type: 'status', text: `unknown command /${cmd}` });
}

/* The picker chose a provider. "custom" with nothing configured asks for the
 * command right there instead of silently falling back. */
async function chooseDriver(value) {
    const id = driverId(value);
    if (id === 'custom' && !(config().get('acp.customCommand') || '').trim()) {
        const cmd = await vscode.window.showInputBox({
            prompt: 'Command that starts your ACP agent (quote-aware)',
            placeHolder: 'e.g. my-acp-agent --stdio',
            ignoreFocusOut: true,
        });
        if (!cmd || !cmd.trim()) {
            postView({ type: 'adapter', driver: currentDriver(), adapters: adapterMap() });
            return;
        }
        await config().update('acp.customCommand', cmd.trim(),
            vscode.ConfigurationTarget.Global);
    }
    rememberViewDriver(id);
    postView({ type: 'adapter', driver: currentDriver(), adapters: adapterMap() });
    listPastSessions(true);
}

/* One quick pick for everything the agent view can be configured with:
 * which provider, each adapter's command, and the settings page itself. */
async function cmdConfigure() {
    const cur = currentDriver();
    const cat = adapterCatalog();
    const items = cat.map((a) => ({
        label: `${a.id === cur ? '$(check) ' : ''}Use ${a.label}`,
        description: a.command, id: a.id, act: 'use',
    }));
    if (!cat.some((a) => a.id === 'custom')) {
        items.push({ label: 'Use a custom ACP agent…', act: 'use', id: 'custom',
            description: 'any command that speaks ACP on stdio' });
    }
    items.push({ label: 'Edit Codex adapter command…', act: 'edit',
        key: 'acp.codexCommand', description: 'codify.acp.codexCommand' });
    items.push({ label: 'Edit Claude Code adapter command…', act: 'edit',
        key: 'acp.claudeCommand', description: 'codify.acp.claudeCommand' });
    items.push({ label: 'Edit custom agent command…', act: 'edit',
        key: 'acp.customCommand', description: 'codify.acp.customCommand (empty removes it)' });
    items.push({ label: '$(settings-gear) Open Codify agent settings', act: 'settings' });
    const pick = await vscode.window.showQuickPick(items,
        { placeHolder: `Agent provider: ${cur} — choose or configure` });
    if (!pick) return;
    if (pick.act === 'use') { await chooseDriver(pick.id); return; }
    if (pick.act === 'settings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'codify.acp');
        return;
    }
    const value = await vscode.window.showInputBox({
        prompt: `codify.${pick.key}`, value: config().get(pick.key) || '',
        ignoreFocusOut: true,
    });
    if (value === undefined) return;
    await config().update(pick.key, value.trim(), vscode.ConfigurationTarget.Global);
    if (pick.key === 'acp.customCommand' && !value.trim() && viewDriver === 'custom') {
        rememberViewDriver(config().get('agent.driver'));
    }
    postView({ type: 'adapter', driver: currentDriver(), adapters: adapterMap() });
}

function registerAgentView(ctx) {
    const provider = {
        resolveWebviewView(view) {
            agentView = view;
            view.webview.options = { enableScripts: true };
            view.webview.html = panelHtml(view.webview);
            view.webview.onDidReceiveMessage((msg) => {
                if (!msg) return;
                if (msg.type === 'ready') { postViewInit(); return; }
                if (msg.type === 'driver') { chooseDriver(msg.value); return; }
                if (msg.type === 'configure') { cmdConfigure(); return; }
                if (msg.type === 'refresh_sessions') { listPastSessions(false); return; }
                if (msg.type === 'load_session' && msg.sessionId) {
                    restorePastSession(String(msg.sessionId), String(msg.driver || ''));
                    return;
                }
                if (msg.type === 'open') { openLocation(msg.path, msg.line); return; }
                if (msg.type === 'external') { openExternal(msg.href); return; }
                if (msg.type === 'copy') {
                    vscode.env.clipboard.writeText(String(msg.text || ''));
                    return;
                }
                if (viewSession && viewSession.starting) return; /* still claiming */
                if (viewSession && handleSessionMessage(viewSession, msg)) return;
                if (msg.type === 'slash') {
                    idleSlash(String(msg.cmd || ''), String(msg.args || ''));
                    return;
                }
                if (msg.type === 'send' && msg.text && viewIdle()) {
                    startChatSession(String(msg.text));
                }
            });
            view.onDidDispose(() => {
                if (agentView === view) agentView = null;
                historyProbeStarted = false;
                const sess = viewSession;
                viewSession = null;
                if (sess && sess.client) {
                    sess.disposed = true;
                    cancelTurn(sess);
                    sess.client.stop();
                    if (sess.taskId) endOfSession(sess, 'view closed');
                }
            });
            postViewInit();
        },
    };
    ctx.subscriptions.push(vscode.window.registerWebviewViewProvider(
        'codifyAgentView', provider,
        { webviewOptions: { retainContextWhenHidden: true } }));
}

/* ---------------- commands ---------------- */

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
            { placeHolder: 'Start an agent on which task?' });
        if (!pick) return;
        id = pick.id;
    }
    if (!deps.workspaceRoot()) return;
    if (panels.has(id) || (viewSession && viewSession.taskId === id)) {
        const p = panels.get(id);
        if (p && p.panel) p.panel.reveal();
        else await focusView();
        return;
    }
    if (viewIdle()) {
        if (await focusView()) await startTaskInView(id);
        else await startPanelSession(id);   /* view unavailable: open beside */
    } else {
        const pick = await vscode.window.showWarningMessage(
            `Codify: the agent view already has a chat. Start ${id} where?`,
            'Replace current chat', 'Open beside');
        if (pick === 'Replace current chat') {
            await resetViewSession();
            if (await focusView()) await startTaskInView(id);
        } else if (pick === 'Open beside') {
            await startPanelSession(id);
        }
    }
    deps.refresh();
}

async function cmdNewChat() {
    if (await focusView()) await resetViewSession();
}

function registerAcpCommands(ctx) {
    const cmds = {
        'codify.agent.openPanel': cmdOpenPanel,
        'codify.agent.newChat': cmdNewChat,
        'codify.agent.configure': cmdConfigure,
    };
    for (const [name, fn] of Object.entries(cmds)) {
        ctx.subscriptions.push(vscode.commands.registerCommand(name, fn));
    }
}

function register(ctx, d) {
    deps = d;
    extensionCtx = ctx;
    const stored = ctx.workspaceState && ctx.workspaceState.get(SESSION_HISTORY_KEY, []);
    sessionHistory = Array.isArray(stored) ? stored.filter((r) => r && r.sessionId) : [];
    const pickedDriver = ctx.workspaceState && ctx.workspaceState.get(VIEW_DRIVER_KEY, '');
    viewDriver = pickedDriver ? driverId(pickedDriver) : '';
    registerAcpCommands(ctx);
    registerAgentView(ctx);
    return {
        hasPanel: (id) => panels.has(id) ||
            !!(viewSession && viewSession.taskId === id),
    };
}

module.exports = {
    AcpClient, splitCommand, normalizeCodexAdapterCommand, register, DRIVER_IDS,
    /* exported for the headless fs-bridge tests */
    workspacePath, readTextFile, writeTextFile, sessionUpdate,
    classifyUserText, sessionTitle,
};
