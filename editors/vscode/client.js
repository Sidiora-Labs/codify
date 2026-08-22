/*
 * A minimal Language Server client for `cg lsp`.
 *
 * VS Code ships no generic LSP client, and the usual answer — the
 * `vscode-languageclient` package — would mean npm dependencies and a build
 * step. Codify's whole promise is one binary and no dependencies, so the
 * extension keeps that promise by speaking the protocol itself. It is about
 * 150 lines: Content-Length framing, request/response correlation, and
 * notification dispatch. Nothing else is needed, because the server
 * deliberately declares `change: 0` sync (open and save only).
 */
const cp = require('child_process');

class LspClient {
    constructor(bin, cwd, log) {
        this.bin = bin;
        this.cwd = cwd;
        this.log = log;
        this.proc = null;
        this.seq = 0;
        this.pending = new Map();
        this.handlers = new Map();
        this.buf = Buffer.alloc(0);
        this.ready = false;
    }

    /* Spawn and initialize. Resolves false when the server cannot start —
     * the extension stays useful without it rather than failing loudly. */
    async start() {
        try {
            this.proc = cp.spawn(this.bin, ['lsp'], {
                cwd: this.cwd,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        } catch (e) {
            this.log(`language server did not start: ${e.message}`);
            return false;
        }
        this.proc.on('error', (e) => {
            this.log(`language server error: ${e.message}`);
            this.ready = false;
        });
        this.proc.on('exit', (code) => {
            if (this.ready) this.log(`language server exited (code ${code})`);
            this.ready = false;
            for (const { reject } of this.pending.values()) {
                reject(new Error('language server exited'));
            }
            this.pending.clear();
        });
        this.proc.stderr.on('data', (d) => this.log(`lsp: ${d}`));
        this.proc.stdout.on('data', (d) => this._consume(d));

        try {
            const init = await this.request('initialize', {
                processId: process.pid,
                rootUri: uriOf(this.cwd),
                capabilities: {},
                clientInfo: { name: 'codify-vscode' },
            }, 15000);
            this.notify('initialized', {});
            this.ready = true;
            this.caps = (init && init.capabilities) || {};
            return true;
        } catch (e) {
            this.log(`language server handshake failed: ${e.message}`);
            this.dispose();
            return false;
        }
    }

    dispose() {
        if (!this.proc) return;
        try {
            this.notify('exit', null);
            this.proc.kill();
        } catch { /* already gone */ }
        this.proc = null;
        this.ready = false;
    }

    onNotification(method, fn) { this.handlers.set(method, fn); }

    request(method, params, timeoutMs = 20000) {
        if (!this.proc) return Promise.reject(new Error('no language server'));
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
        this._send({ jsonrpc: '2.0', id, method, params });
        return p;
    }

    notify(method, params) {
        if (!this.proc) return;
        this._send({ jsonrpc: '2.0', method, params });
    }

    /* Requests that should never break a feature: log and answer empty. */
    async tryRequest(method, params, fallback) {
        if (!this.ready) return fallback;
        try {
            const r = await this.request(method, params);
            return r === null || r === undefined ? fallback : r;
        } catch (e) {
            this.log(`${method}: ${e.message}`);
            return fallback;
        }
    }

    _send(msg) {
        const body = Buffer.from(JSON.stringify(msg), 'utf8');
        try {
            this.proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
            this.proc.stdin.write(body);
        } catch (e) {
            this.log(`write failed: ${e.message}`);
        }
    }

    /* Content-Length counts bytes, so framing must work on the Buffer and
     * only decode once a whole message is in hand. */
    _consume(chunk) {
        this.buf = Buffer.concat([this.buf, chunk]);
        for (;;) {
            const split = this.buf.indexOf('\r\n\r\n');
            if (split < 0) return;
            const header = this.buf.slice(0, split).toString('ascii');
            const m = /content-length:\s*(\d+)/i.exec(header);
            if (!m) { this.buf = this.buf.slice(split + 4); continue; }
            const len = parseInt(m[1], 10);
            const start = split + 4;
            if (this.buf.length < start + len) return;      /* need more bytes */
            const body = this.buf.slice(start, start + len).toString('utf8');
            this.buf = this.buf.slice(start + len);
            let msg;
            try { msg = JSON.parse(body); } catch { continue; }
            this._dispatch(msg);
        }
    }

    _dispatch(msg) {
        if (msg.id !== undefined && this.pending.has(msg.id)) {
            const { resolve, reject } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message || 'lsp error'));
            else resolve(msg.result);
            return;
        }
        if (msg.method) {
            const fn = this.handlers.get(msg.method);
            if (fn) fn(msg.params);
            /* server-to-client requests we do not implement still need an
             * answer, or a conforming server would wait forever */
            else if (msg.id !== undefined) {
                this._send({ jsonrpc: '2.0', id: msg.id, result: null });
            }
        }
    }
}

function uriOf(fsPath) {
    return 'file://' + fsPath.split('/').map(encodeURIComponent).join('/')
        .replace(/%3A/gi, ':');
}

module.exports = { LspClient };
