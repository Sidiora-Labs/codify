/* One `cg serve` connection for the whole extension.
 *
 * Every cg call the editor makes goes down this one pipe as a JSON-RPC
 * `exec`, and every change in the repository comes back up it as a pushed
 * `events` notification — so nothing here polls. The client speaks the
 * protocol itself (newline-delimited JSON-RPC 2.0, see src/serve.c), keeps
 * Codify's zero-dependency promise, and reconnects with a backoff when the
 * server goes away; a reconnect tells the extension to take one full
 * refresh, because events pushed while the pipe was down are gone.
 *
 * `applyEvent` is the pure half: it folds one event into a small live model
 * the views patch themselves from, and names which view the event touched.
 * Headless-safe — no vscode import — so the integration test drives both
 * halves against the real binary. */
const cp = require('child_process');

const INIT_TIMEOUT_MS = 8000;
const CALL_TIMEOUT_MS = 10 * 60 * 1000;   /* a verify_cmd may take minutes */
const RECONNECT_MS = [500, 1000, 2000, 5000, 10000];

class ServeClient {
    constructor(bin, cwd, log) {
        this.bin = bin;
        this.cwd = cwd;
        this.log = log || (() => {});
        this.proc = null;
        this.ready = false;
        this.disposed = false;
        this.seq = 0;
        this.pending = new Map();
        this.buf = '';
        this.listeners = { event: [], gap: [], reconnect: [], down: [] };
        this.subs = [];            /* {kinds, since, id} — replayed on reconnect */
        this.cursor = 0;           /* last event seq seen */
        this.retries = 0;
        this.info = null;          /* the initialize result */
        this.unsupported = false;  /* the binary has no `serve` */
    }

    on(name, fn) { (this.listeners[name] || (this.listeners[name] = [])).push(fn); }
    _emit(name, arg) { for (const fn of this.listeners[name] || []) { try { fn(arg); } catch (e) { this.log(`serve ${name} handler: ${e.message}`); } } }

    /* Resolves true when the server answered initialize. False means the
     * extension should fall back to one-shot cg processes: an older cg
     * without `serve`, or no cg at all. */
    async start() {
        if (this.disposed) return false;
        let stderr = '';
        try {
            this.proc = cp.spawn(this.bin, ['serve'], {
                cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'],
            });
        } catch (e) {
            this.log(`cg serve did not start: ${e.message}`);
            return false;
        }
        const proc = this.proc;
        proc.on('error', (e) => this.log(`cg serve error: ${e.message}`));
        /* a server that has exited makes the next write an EPIPE: the exit
         * handler below is the answer to that, not a crash */
        proc.stdin.on('error', () => {});
        proc.stderr.on('data', (d) => { stderr += d; if (stderr.length > 4096) stderr = stderr.slice(-4096); });
        proc.stdout.on('data', (d) => this._consume(d));
        proc.on('exit', (code) => {
            if (this.proc !== proc) return;
            const was = this.ready;
            this.ready = false;
            this.proc = null;
            for (const { reject } of this.pending.values()) reject(new Error('cg serve exited'));
            this.pending.clear();
            if (this.disposed) return;
            if (/unknown command/.test(stderr)) { this.unsupported = true; return; }
            if (was) {
                this.log(`cg serve exited (code ${code}) — reconnecting`);
                this._emit('down', code);
                this._reconnect();
            }
        });
        try {
            this.info = await this.request('initialize', {}, INIT_TIMEOUT_MS);
            this.ready = true;
            this.retries = 0;
            if (!this.cursor && this.info) this.cursor = this.info.head || 0;
            return true;
        } catch (e) {
            if (!this.unsupported && !/unknown command/.test(stderr))
                this.log(`cg serve handshake failed: ${e.message}`);
            if (/unknown command/.test(stderr)) this.unsupported = true;
            this._kill();
            return false;
        }
    }

    _reconnect() {
        if (this.disposed) return;
        const wait = RECONNECT_MS[Math.min(this.retries, RECONNECT_MS.length - 1)];
        this.retries += 1;
        setTimeout(async () => {
            if (this.disposed) return;
            if (await this.start()) {
                for (const s of this.subs) {
                    try {
                        const r = await this.request('subscribe',
                            { since: this.cursor, kinds: s.kinds });
                        s.id = r.subscription;
                    } catch (_) { /* the next reconnect tries again */ }
                }
                this._emit('reconnect', this.retries);
            } else if (!this.unsupported) {
                this._reconnect();
            }
        }, wait);
    }

    request(method, params, timeoutMs = CALL_TIMEOUT_MS) {
        if (!this.proc) return Promise.reject(new Error('no cg serve'));
        const id = ++this.seq;
        const p = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`${method} timed out`));
            }, timeoutMs);
            this.pending.set(id, {
                resolve: (v) => { clearTimeout(timer); resolve(v); },
                reject: (e) => { clearTimeout(timer); reject(e); },
            });
        });
        try {
            this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        } catch (e) {
            this.pending.delete(id);
            return Promise.reject(e);
        }
        return p;
    }

    /* the same shape as the extension's execFile-based cg(): never rejects */
    async exec(args) {
        try {
            const r = await this.request('exec', { args });
            return { code: r.exit, stdout: r.stdout || '', stderr: r.stderr || '' };
        } catch (e) {
            return { code: 1, stdout: '', stderr: `cg serve: ${e.message}\n` };
        }
    }

    async tool(name, args) {
        return this.request('tools/call', { name, arguments: args || {} });
    }

    async tools() {
        const r = await this.request('tools/list', {}, 20000);
        return (r && r.tools) || [];
    }

    async subscribe(kinds) {
        const s = { kinds: kinds || undefined, id: null };
        this.subs.push(s);
        const r = await this.request('subscribe', { since: this.cursor, kinds: s.kinds }, 20000);
        s.id = r.subscription;
        return s.id;
    }

    async cancel(reqId) {
        return this.request('cancel', { id: reqId }, 20000);
    }

    _consume(chunk) {
        this.buf += chunk;
        let nl;
        while ((nl = this.buf.indexOf('\n')) >= 0) {
            const line = this.buf.slice(0, nl);
            this.buf = this.buf.slice(nl + 1);
            if (!line.trim()) continue;
            let msg;
            try { msg = JSON.parse(line); } catch { continue; }
            this._dispatch(msg);
        }
    }

    _dispatch(msg) {
        if (msg.id !== undefined && this.pending.has(msg.id)) {
            const { resolve, reject } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message || 'serve error'));
            else resolve(msg.result);
            return;
        }
        if (msg.method === 'events' && msg.params) {
            for (const ev of msg.params.events || []) {
                if (ev.seq > this.cursor) this.cursor = ev.seq;
                this._emit('event', ev);
            }
        } else if (msg.method === 'events/gap') {
            this._emit('gap', msg.params);
        }
    }

    _kill() {
        const p = this.proc;
        this.proc = null;
        this.ready = false;
        if (!p) return;
        try { p.stdin.end(); } catch (_) { /* gone */ }
        try { p.kill(); } catch (_) { /* gone */ }
    }

    dispose() {
        this.disposed = true;
        this._kill();
        for (const { reject } of this.pending.values()) reject(new Error('disposed'));
        this.pending.clear();
    }
}

/* ---------------- the pure half ----------------
 *
 * A live model is the little the views need to patch themselves without
 * asking cg again: task statuses and claims, who is alive in the fleet,
 * run states, and counts. applyEvent folds one event in and returns which
 * view it touched ('tasks' | 'fleet' | 'memories' | 'drift' | null) with
 * the patch the view can apply directly. */
function liveModel() {
    return { seq: 0, tasks: {}, claims: {}, agents: {}, runs: {}, drift: 0,
             memories: 0, approvals: {} };
}

function splitSubject(subject) {
    const s = String(subject || '');
    const i = s.indexOf('/');
    return i < 0 ? { feature: '', id: s } : { feature: s.slice(0, i), id: s.slice(i + 1) };
}

function applyEvent(model, ev) {
    if (!ev || !ev.kind) return null;
    if (ev.seq) model.seq = Math.max(model.seq, ev.seq);
    const p = ev.payload || {};
    const k = ev.kind;
    if (k === 'task.status') {
        const t = model.tasks[ev.subject] || (model.tasks[ev.subject] = {});
        t.status = p.status;
        t.feature = p.feature;
        return { view: 'tasks', task: p.task, feature: p.feature,
                 patch: { status: p.status } };
    }
    if (k === 'claim') {
        const { id, feature } = splitSubject(ev.subject);
        model.claims[ev.subject] = { agent: p.agent, expires: p.expires };
        return { view: 'tasks', task: id, feature,
                 patch: { claim: { id, agent: p.agent }, agent: p.agent || '' } };
    }
    if (k === 'release' || (k === 'attempt.end' && p.state !== 'running')) {
        const { id, feature } = splitSubject(ev.subject);
        delete model.claims[ev.subject];
        return { view: 'tasks', task: id, feature,
                 patch: { claim: null, agent: '', role: '', branch: '' } };
    }
    if (k === 'attempt.start' || k === 'attempt.branch') {
        const { id, feature } = splitSubject(ev.subject);
        const c = model.claims[ev.subject] || (model.claims[ev.subject] = {});
        if (p.agent) c.agent = p.agent;
        if (p.branch) c.branch = p.branch;
        const patch = { agent: p.agent || c.agent || '' };
        if (p.branch) patch.branch = p.branch;
        if (p.worktree) patch.worktree = p.worktree;
        return { view: 'tasks', task: id, feature, patch, fleet: true };
    }
    if (k.startsWith('agent.') && k !== 'agent.activity') {
        if (k === 'agent.join' || k === 'agent.update') {
            model.agents[ev.subject] = Object.assign(model.agents[ev.subject] || {},
                p, { seen: ev.at });
        } else if (ev.node) {
            const a = model.agents[ev.node] || (model.agents[ev.node] = {});
            a.seen = ev.at;
            if (k === 'agent.usage' || k === 'agent.result') {
                a.cost = p.cost_usd; a.tokens_in = p.tokens_in; a.tokens_out = p.tokens_out;
            }
            if (k === 'agent.text') a.last = p.text;
            if (k === 'agent.tool') a.last = `${p.tool}${p.detail ? ' ' + p.detail : ''}`;
        }
        return { view: 'fleet', agent: ev.node || ev.subject };
    }
    if (k.startsWith('fleet.') || k.startsWith('orch.') || k.startsWith('supervisor.')) {
        if (k === 'fleet.run') model.runs[p.run] = p.state;
        return { view: 'fleet', kind: k };
    }
    if (k.startsWith('approval.')) {
        model.approvals[p.id] = p.state;
        return { view: 'fleet', kind: k, approval: p };
    }
    if (k.startsWith('drift.')) {
        model.drift += 1;
        return { view: 'drift', kind: k };
    }
    if (k === 'memory.add') {
        model.memories += 1;
        return { view: 'memories', id: p.id };
    }
    return null;
}

module.exports = { ServeClient, liveModel, applyEvent, splitSubject };
