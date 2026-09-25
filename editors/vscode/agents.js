/* Codify agent sessions — run Codex or Claude CLI sessions on spec tasks.
 *
 * A session is: claim the task (parallel mode), mark it started, seed a
 * prompt from `cg resume --task <id> --prompt`, and hand that prompt to the
 * configured driver in a terminal (or a headless VS Code task). The board
 * stays fresh while sessions run through a poll that exists only while
 * there is something to watch; it goes through the extension's single
 * refresh scheduler, so it can never stack up behind a slow one.
 *
 * Every cg verb is called defensively: older binaries without resume /
 * handoff / spec run fail with a clear message or a fallback, never a hang.
 *
 * Plain JS, zero dependencies, no build step. */
/* The chat core at the bottom of this file must be provable without VS Code,
 * so the module loads headlessly; every vscode use below sits inside a
 * function the editor calls. */
let vscode = null;
try { vscode = require('vscode'); } catch (_) { /* headless: chat core only */ }
const fs = require('fs');
const path = require('path');

let deps;                    /* {cg, cgJson, refresh, poll, workspaceRoot} */
const sessions = new Map();  /* key (task id or wave:N) -> {terminal?, execution?, agent, wave?} */
let pollTimer;
let seq = 0;                 /* agent-name counter for this window */

/* An agent's claim or `spec done` lands in the graph and the spec file;
 * the spec watcher catches the latter at once, and this cadence is for the
 * rest. Ten seconds is what a person notices; faster only burns cg calls. */
const ACTIVE_POLL_MS = 10000;

function config() { return vscode.workspace.getConfiguration('codify'); }

function firstLine(s) {
    return String(s || '').trim().split('\n')[0] || 'no output';
}

function driverName() {
    return config().get('agent.driver') === 'claude' ? 'claude' : 'codex';
}

function driverBits() {
    const d = driverName();
    return d === 'claude'
        ? { name: d,
            bin: config().get('agent.claudePath') || 'claude',
            args: (config().get('agent.claudeArgs') || '').trim() }
        : { name: d,
            bin: config().get('agent.codexPath') || 'codex',
            args: (config().get('agent.codexArgs') || '').trim() };
}

/* interactive launch: the prompt goes in as the first message */
function driverLaunch(promptfile) {
    const d = driverBits();
    const extra = d.args ? ` ${d.args}` : '';
    return `${d.bin}${extra} "$(cat '${promptfile}')"`;
}

/* headless launch: prompt on stdin, exit code is the outcome */
function headlessLaunch(promptfile) {
    const d = driverBits();
    const extra = d.args ? ` ${d.args}` : '';
    return d.name === 'claude'
        ? `${d.bin} -p${extra} < '${promptfile}'`
        : `${d.bin} exec --sandbox workspace-write${extra} - < '${promptfile}'`;
}

/* ---------------- board freshness ---------------- */

function ensurePolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
        if (!sessions.size) { stopPollingIfIdle(); return; }
        (deps.poll || deps.refresh)();
    }, ACTIVE_POLL_MS);
}

function stopPollingIfIdle() {
    if (!sessions.size && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
    }
}

/* ---------------- cg helpers (all defensive) ---------------- */

async function specMode() {
    const s = await deps.cgJson(['spec', 'status']);
    return (s && s.mode) || 'standard';
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

async function liveClaim(id) {
    const s = await deps.cgJson(['spec', 'status']);
    return ((s && s.claims) || []).find((c) => c.id === id);
}

async function pickTask(filter, placeHolder) {
    const trace = await deps.cgJson(['spec', 'trace']);
    const items = ((trace && trace.tasks) || [])
        .filter((t) => !filter || filter(t))
        .map((t) => ({ label: `${t.id}  ${t.title}`, description: t.status, id: t.id }));
    if (!items.length) {
        vscode.window.showInformationMessage('Codify: no matching tasks.');
        return undefined;
    }
    const pick = await vscode.window.showQuickPick(items,
        { placeHolder: placeHolder || 'Codify task' });
    return pick && pick.id;
}

function taskIdFrom(arg) {
    if (typeof arg === 'string') return arg;
    if (arg && arg.task) return arg.task.id;
    return undefined;
}

/* Seed prompt for a fresh session. `cg resume` is the real source; a binary
 * without it degrades to the session brief plus explicit instructions. */
async function promptFileFor(id) {
    const root = deps.workspaceRoot();
    if (!root) return undefined;
    const r = id === '@docs'
        ? await deps.cg(['docs', 'packet'])
        : await deps.cg(['resume', '--task', id, '--prompt']);
    let body = r.code === 0 ? r.stdout : '';
    if (id === '@docs' && !body.trim())
        throw new Error('Documentation evidence packet failed: ' + r.stderr);
    if (id === '@docs' && body.trim()) {
        body = 'You own Codify\'s final @docs closure. Update only configured ' +
            'documentation targets from this evidence, keep user, developer, ' +
            'and release coverage explicit, then finish with `cg docs close`. ' +
            'Do not run `cg spec run` or `cg spec done @docs`.\n\n' + body;
    }
    if (!body.trim()) {
        const b = await deps.cg(['brief']);
        body = `You are resuming Codify task ${id}.\n\n` +
            (b.stdout || '').trimEnd() + '\n\n' +
            'Use `cg context <area>` to load relevant code, run ' +
            `\`cg spec implemented ${id}\` or \`cg spec done ${id}\` when ` +
            'finished, and `cg handoff` if you stop early.\n';
    }
    const dir = path.join(root, '.codegraph', 'agents');
    const file = path.join(dir, `vscode-${id}.prompt`);
    try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, body);
    } catch (e) {
        vscode.window.showErrorMessage(`Codify: cannot write ${file}: ${e.message}`);
        return undefined;
    }
    return file;
}

async function offerRelease(id, agent, exitCode) {
    const claim = await liveClaim(id);
    if (!claim) return;
    const why = exitCode === undefined
        ? `Task ${id} is not complete.`
        : `The agent on ${id} exited (rc=${exitCode}) without completing it.`;
    const pick = await vscode.window.showWarningMessage(
        `Codify: ${why} Release the claim held by ${claim.agent}?`,
        'Release', 'Keep claim');
    if (pick !== 'Release') return;
    let r = await deps.cg(['spec', 'release', id, '--agent', claim.agent || agent]);
    /* an older cg without --agent on release still honours the plain form */
    if (r.code !== 0) r = await deps.cg(['spec', 'release', id]);
    if (r.code !== 0) {
        vscode.window.showErrorMessage(
            `Codify: release of ${id} failed — ${firstLine(r.stderr || r.stdout)}`);
    }
    deps.refresh();
}

/* ---------------- session lifecycle ---------------- */

function openTerminal(id, agent, promptfile) {
    const term = vscode.window.createTerminal({
        name: `codify: ${driverName()} ${id}`,
        cwd: deps.workspaceRoot(),
    });
    sessions.set(id, { terminal: term, agent });
    term.show();
    term.sendText(driverLaunch(promptfile), true);
    ensurePolling();
}

function runHeadless(id, agent, promptfile) {
    const task = new vscode.Task(
        { type: 'codify-agent', task: id }, vscode.TaskScope.Workspace,
        `agent ${id}`, 'codify',
        new vscode.ShellExecution(headlessLaunch(promptfile),
            { cwd: deps.workspaceRoot() }));
    sessions.set(id, { agent, headless: true });
    vscode.tasks.executeTask(task).then(
        (ex) => { const s = sessions.get(id); if (s) s.execution = ex; },
        (e) => {
            sessions.delete(id);
            stopPollingIfIdle();
            vscode.window.showErrorMessage(
                `Codify: headless agent on ${id} failed to start: ${e.message}`);
        });
    ensurePolling();
}

/* Claim (parallel mode), start, seed the prompt, launch the driver.
 * The sessions entry is reserved before the first await so a second rapid
 * invocation hits the duplicate guard instead of racing this one; every
 * failure path below must delete the reservation. */
async function startAgentSession(id, headless) {
    if (!deps.workspaceRoot()) return;
    if (sessions.has(id)) {
        vscode.window.showInformationMessage(
            `Codify: a tracked agent session already exists for ${id}.`);
        return;
    }
    const agent = `vscode-${++seq}`;
    sessions.set(id, { starting: true, agent });
    let claimed = false;
    if (await specMode() === 'parallel') {
        const c = await deps.cg(['spec', 'claim', id, '--agent', agent]);
        if (c.code !== 0) {
            sessions.delete(id);
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
        /* already in_progress is a normal pickup, not a stop */
        vscode.window.showWarningMessage(
            `Codify: spec start ${id}: ${firstLine(s.stderr || s.stdout)}`);
    }
    const promptfile = await promptFileFor(id);
    if (!promptfile) {
        sessions.delete(id);
        /* do not leak the lease we just took */
        if (claimed) await deps.cg(['spec', 'release', id, '--agent', agent]);
        vscode.window.showErrorMessage(
            `Codify: no agent session started on ${id} — could not seed its ` +
            `prompt${claimed ? '; claim released' : ''}.`);
        deps.refresh();
        return;
    }
    if (headless) runHeadless(id, agent, promptfile);
    else openTerminal(id, agent, promptfile);
    deps.refresh();
}

/* ---------------- commands ---------------- */

async function cmdStartOnTask(arg) {
    const id = taskIdFrom(arg) ||
        await pickTask((t) => t.status === 'pending' || t.status === 'in_progress',
            'Start an agent session on which task?');
    if (!id) return;
    /* the ACP panel is the default surface; the terminal stays one setting
     * (or one failed adapter) away */
    if (config().get('agent.interface') !== 'terminal') {
        await vscode.commands.executeCommand('codify.agent.openPanel', id);
        return;
    }
    await startAgentSession(id, false);
}

async function cmdStartHeadless(arg) {
    const id = taskIdFrom(arg) ||
        await pickTask((t) => t.status === 'pending' || t.status === 'in_progress',
            'Run a headless agent on which task?');
    if (id) await startAgentSession(id, true);
}

async function cmdHandoff(arg) {
    const id = taskIdFrom(arg) ||
        await pickTask((t) => t.status === 'in_progress', 'Hand off which task?');
    if (!id) return;
    const done = await vscode.window.showInputBox(
        { prompt: `Task ${id} — steps already done (separate with ;)` });
    if (done === undefined) return;
    const next = await vscode.window.showInputBox(
        { prompt: 'Next steps for the following session (separate with ;)' });
    if (next === undefined) return;
    const blocked = await vscode.window.showInputBox(
        { prompt: 'Blockers, if any' });
    if (blocked === undefined) return;
    const args = ['handoff', '--task', id];
    if (done) args.push('--done', done);
    if (next) args.push('--next', next);
    if (blocked) args.push('--blocked', blocked);
    const r = await deps.cg(args);
    if (r.code !== 0) {
        vscode.window.showErrorMessage(
            `Codify: cg handoff failed — ${firstLine(r.stderr || r.stdout)}`);
    } else {
        vscode.window.showInformationMessage(`Codify: handoff recorded for ${id}.`);
    }
    deps.refresh();
}

async function cmdResume(arg) {
    const id = taskIdFrom(arg) ||
        await pickTask((t) => t.status === 'in_progress',
            'Resume which task in a fresh agent session?');
    if (!id) return;
    if (sessions.has(id)) {
        vscode.window.showInformationMessage(
            `Codify: a tracked agent session already exists for ${id}.`);
        return;
    }
    const agent = `vscode-${++seq}`;
    sessions.set(id, { starting: true, agent });   /* reserve before awaiting */
    const promptfile = await promptFileFor(id);
    if (!promptfile) {
        sessions.delete(id);
        return;
    }
    openTerminal(id, agent, promptfile);
    deps.refresh();
}

async function cmdRunWave() {
    if (!deps.workspaceRoot()) return;
    const n = config().get('agent.parallelism') || 2;
    const term = vscode.window.createTerminal({
        name: 'codify: spec run', cwd: deps.workspaceRoot(),
    });
    sessions.set(`wave:${++seq}`, { terminal: term, wave: true });
    term.show();
    term.sendText(`${config().get('binaryPath') || 'cg'} spec run -n ${n} ` +
        `--driver ${driverName()}`, true);
    ensurePolling();
}

async function cmdStop(arg) {
    let id = taskIdFrom(arg);
    if (!id || !sessions.has(id)) {
        const items = [...sessions.entries()].map(([key, s]) => ({
            label: s.terminal ? s.terminal.name : `codify: headless ${key}`,
            description: s.wave ? 'wave runner' : `task ${key}`,
            id: key,
        }));
        if (!items.length) {
            vscode.window.showInformationMessage('Codify: no tracked agent sessions.');
            return;
        }
        const pick = await vscode.window.showQuickPick(items,
            { placeHolder: 'Stop which agent session?' });
        if (!pick) return;
        id = pick.id;
    }
    const s = sessions.get(id);
    if (!s) return;
    if (s.terminal) {
        s.terminal.dispose();   /* onDidCloseTerminal offers the release */
    } else {
        if (s.execution) s.execution.terminate();
        sessions.delete(id);
        stopPollingIfIdle();
        deps.refresh();
    }
}

/* ---------------- registration ---------------- */

function registerAgentCommands(ctx) {
    const cmds = {
        'codify.agent.startOnTask': cmdStartOnTask,
        'codify.agent.startHeadless': cmdStartHeadless,
        'codify.agent.handoff': cmdHandoff,
        'codify.agent.resume': cmdResume,
        'codify.agent.runWave': cmdRunWave,
        'codify.agent.stop': cmdStop,
    };
    for (const [name, fn] of Object.entries(cmds)) {
        ctx.subscriptions.push(vscode.commands.registerCommand(name, fn));
    }
}

function register(ctx, d) {
    deps = d;
    registerAgentCommands(ctx);

    ctx.subscriptions.push(vscode.window.onDidCloseTerminal(async (term) => {
        for (const [id, s] of sessions) {
            if (s.terminal !== term) continue;
            sessions.delete(id);
            stopPollingIfIdle();
            if (!s.wave) {
                const status = await taskStatus(id);
                if (status !== 'done' && status !== 'implemented') {
                    offerRelease(id, s.agent, undefined);
                }
            }
            deps.refresh();
            break;
        }
    }));

    ctx.subscriptions.push(vscode.tasks.onDidEndTaskProcess(async (e) => {
        const def = e.execution.task.definition;
        if (!def || def.type !== 'codify-agent') return;
        const id = def.task;
        const s = sessions.get(id);
        sessions.delete(id);
        stopPollingIfIdle();
        const status = await taskStatus(id);
        if (status === 'done' || status === 'implemented') {
            vscode.window.showInformationMessage(
                `Codify: headless agent finished ${id} (${status}).`);
        } else {
            offerRelease(id, s && s.agent, e.exitCode);
        }
        deps.refresh();
    }));

    ctx.subscriptions.push({
        dispose: () => {
            if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined; }
        },
    });

    return {
        hasTerminal: (id) => {
            const s = sessions.get(id);
            return !!(s && (s.terminal || s.headless));
        },
        /* direct terminal path for the panel's adapter-failure fallback —
         * bypasses the codify.agent.interface switch on purpose */
        startTerminal: (id) => startAgentSession(id, false),
    };
}

/* --- agent chat (5.3) ---
 *
 * The part of the chat surface that must hold together without VS Code and
 * without an agent on the other end: what a retry re-sends, which permission
 * asks are still outstanding, what the turn and the session have cost, and
 * the two renderers the transcript cannot fake — a real line diff and ANSI
 * removal. acp.js owns the protocol and the webview; this owns the promises
 * a test can pin down. */

/* CSI/OSC escapes plus the carriage returns a progress bar uses to overwrite
 * its own line. A webview draws these as mojibake, and a transcript that
 * shows mojibake is a transcript nobody trusts. */
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

function stripAnsi(text) {
    const s = String(text == null ? '' : text);
    return s.replace(ANSI_RE, '')
        .replace(/\r\n/g, '\n')
        .replace(/[^\n]*\r(?!\n)/g, '')   /* keep only what the line ended as */
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

const DIFF_CELL_BUDGET = 250000;   /* LCS is O(n·m): past this, show blocks */
const DIFF_CONTEXT = 3;            /* unchanged lines kept around a change */

function diffLines(text) {
    const s = String(text == null ? '' : text);
    if (!s) return [];
    const lines = s.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
}

/* Longest common subsequence over whole lines, walked back into rows. */
function lcsRows(a, b) {
    const w = b.length + 1;
    const table = new Uint32Array((a.length + 1) * w);
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            table[i * w + j] = a[i] === b[j]
                ? table[(i + 1) * w + j + 1] + 1
                : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
        }
    }
    const rows = [];
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { rows.push({ t: 'ctx', s: a[i] }); i++; j++; }
        else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) {
            rows.push({ t: 'del', s: a[i] }); i++;
        } else { rows.push({ t: 'add', s: b[j] }); j++; }
    }
    while (i < a.length) { rows.push({ t: 'del', s: a[i] }); i++; }
    while (j < b.length) { rows.push({ t: 'add', s: b[j] }); j++; }
    return rows;
}

/* Collapse long runs of unchanged lines into one gap row, so a diff of a
 * large file still reads as the change it is. */
function trimContext(rows) {
    const keep = rows.map((r) => r.t !== 'ctx');
    for (let i = 0; i < rows.length; i++) {
        if (rows[i].t === 'ctx') continue;
        for (let k = Math.max(0, i - DIFF_CONTEXT); k <= Math.min(rows.length - 1, i + DIFF_CONTEXT); k++) {
            keep[k] = true;
        }
    }
    const out = [];
    let skipped = 0;
    for (let i = 0; i < rows.length; i++) {
        if (keep[i]) {
            if (skipped) { out.push({ t: 'gap', s: `${skipped} unchanged line${skipped === 1 ? '' : 's'}` }); skipped = 0; }
            out.push(rows[i]);
        } else { skipped++; }
    }
    if (skipped) out.push({ t: 'gap', s: `${skipped} unchanged line${skipped === 1 ? '' : 's'}` });
    return out;
}

/* A diff the panel can draw without knowing how to diff: numbered rows with
 * old and new line numbers, the add/remove tally, and how much was cut.
 * Returns {rows, added, removed, truncated}. */
function diffRows(oldText, newText, maxRows) {
    const a = diffLines(oldText), b = diffLines(newText);
    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head++;
    let tail = 0;
    while (tail < a.length - head && tail < b.length - head &&
           a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
    const am = a.slice(head, a.length - tail);
    const bm = b.slice(head, b.length - tail);
    const middle = am.length * bm.length > DIFF_CELL_BUDGET
        ? am.map((s) => ({ t: 'del', s })).concat(bm.map((s) => ({ t: 'add', s })))
        : lcsRows(am, bm);
    const all = a.slice(0, head).map((s) => ({ t: 'ctx', s }))
        .concat(middle, a.slice(a.length - tail).map((s) => ({ t: 'ctx', s })));

    let o = 0, n = 0, added = 0, removed = 0;
    for (const r of all) {
        if (r.t === 'del') { r.o = ++o; r.n = 0; removed++; }
        else if (r.t === 'add') { r.o = 0; r.n = ++n; added++; }
        else { r.o = ++o; r.n = ++n; }
    }
    const trimmed = trimContext(all);
    const cap = maxRows || 400;
    const rows = trimmed.slice(0, cap);
    return { rows, added, removed, truncated: Math.max(0, trimmed.length - cap) };
}

/* One chat surface's bookkeeping.
 *
 * It is a class so its two promises can be tested without an editor: every
 * permission ask is answered exactly once — a cancelled turn or a dead
 * adapter settles whatever is left, so the agent never waits on a card that
 * can no longer be clicked — and the last prompt outlives a failed turn, so
 * retry never asks the user to retype. Cost is accumulated here because only
 * this side sees every turn of the session. */
class AgentPanel {
    constructor(post) {
        this.post = typeof post === 'function' ? post : () => {};
        this.permits = new Map();     /* pid -> resolve of the ACP request */
        this.seq = 0;
        this.last = null;             /* {text, echo} — what retry re-sends */
        this.turn = null;             /* marks of the turn in flight */
        this.session = { cost: 0, currency: '', tokens: 0, turns: 0,
            context: 0, size: 0 };
    }

    /* ---- prompts and retry ---- */
    remember(text, echo) {
        if (String(text || '').trim()) this.last = { text: String(text), echo: echo || '' };
        return this.last;
    }
    retryTarget() { return this.last; }

    beginTurn() {
        this.turn = { at: Date.now(), cost: this.session.cost,
            tokens: this.session.tokens, context: this.session.context };
        return this.turn;
    }

    /* The per-turn ledger the transcript prints under the turn summary. */
    endTurn(stopReason) {
        const t = this.turn;
        this.turn = null;
        this.session.turns++;
        const cost = t ? round6(this.session.cost - t.cost) : 0;
        const tokens = t ? Math.max(0, this.session.tokens - t.tokens) : 0;
        const context = t ? Math.max(0, this.session.context - t.context) : 0;
        return {
            stopReason: stopReason || 'end_turn',
            ms: t ? Date.now() - t.at : 0,
            cost, tokens, context,
            sessionCost: round6(this.session.cost),
            sessionTokens: this.session.tokens,
            currency: this.session.currency, turns: this.session.turns,
        };
    }

    /* Adapters disagree about what a usage_update's cost and token count
     * mean: Claude Code reports the session's running total, others report
     * what the last message cost. A value at or above the running total is
     * taken as the total; a smaller one is taken as an increment. Either way
     * the session total only ever grows, so the number on screen is never a
     * lie about money already spent. */
    recordUsage(u) {
        const usage = u || {};
        const used = Number(usage.used);
        const size = Number(usage.size);
        if (isFinite(used)) this.session.context = used;
        if (isFinite(size)) this.session.size = size;
        const raw = usage.cost && typeof usage.cost === 'object'
            ? usage.cost.amount : usage.cost;
        const amount = Number(raw);
        if (isFinite(amount) && amount > 0) {
            this.session.cost = round6(amount >= this.session.cost
                ? amount : this.session.cost + amount);
        }
        if (usage.cost && usage.cost.currency) this.session.currency = String(usage.cost.currency);
        const tokens = Number(usage.tokens);
        if (isFinite(tokens) && tokens > 0) {
            this.session.tokens = tokens >= this.session.tokens
                ? tokens : this.session.tokens + tokens;
        }
        return {
            used: isFinite(used) ? used : this.session.context,
            size: isFinite(size) ? size : this.session.size,
            cost: round6(this.session.cost), currency: this.session.currency,
            tokens: this.session.tokens,
        };
    }

    /* ---- permission asks ---- */

    /* Show the ask and resolve when the person answers. An ask with nothing
     * to click is answered at once rather than drawn as a card that can
     * never be clicked — an agent blocked on a dead prompt is the one
     * failure this panel must not have. */
    ask(params) {
        const p = params || {};
        const call = p.toolCall || {};
        const options = Array.isArray(p.options) ? p.options : [];
        const pid = ++this.seq;
        const shown = {
            type: 'permission', pid,
            title: call.title || 'Permission request',
            kind: call.kind || '', toolCallId: call.toolCallId || '',
            options,
        };
        return new Promise((resolve) => {
            if (!options.length) {
                this.post(Object.assign({ note: 'the agent offered no choices' }, shown));
                this.post({ type: 'permission_done', pid, answer: 'cancelled — no options offered' });
                resolve({ outcome: { outcome: 'cancelled' } });
                return;
            }
            this.permits.set(pid, resolve);
            this.post(shown);
        });
    }

    answer(pid, optionId) {
        const resolve = this.permits.get(pid);
        if (!resolve) return false;
        this.permits.delete(pid);
        resolve({ outcome: { outcome: 'selected', optionId: String(optionId) } });
        this.post({ type: 'permission_done', pid: pid });
        return true;
    }

    /* Nothing may be left waiting: a cancelled turn or a closed adapter
     * settles every outstanding ask and says so on its card. */
    settle(why) {
        let n = 0;
        for (const [pid, resolve] of this.permits) {
            resolve({ outcome: { outcome: 'cancelled' } });
            this.post({ type: 'permission_done', pid, answer: why || 'cancelled' });
            n++;
        }
        this.permits.clear();
        return n;
    }

    pending() { return this.permits.size; }
}

function round6(n) {
    const v = Number(n);
    return isFinite(v) ? Math.round(v * 1e6) / 1e6 : 0;
}

module.exports = { register, AgentPanel, diffRows, stripAnsi };
