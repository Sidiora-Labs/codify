/* Codify agent sessions — run Codex or Claude CLI sessions on spec tasks.
 *
 * A session is: claim the task (parallel mode), mark it started, seed a
 * prompt from `cg resume --task <id> --prompt`, and hand that prompt to the
 * configured driver in a terminal (or a headless VS Code task). The board
 * stays fresh while sessions run via a graph.db watcher plus a slow poll
 * that exists only while there is something to watch.
 *
 * Every cg verb is called defensively: older binaries without resume /
 * handoff / spec run fail with a clear message or a fallback, never a hang.
 *
 * Plain JS, zero dependencies, no build step. */
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

let deps;                    /* {cg, cgJson, refresh, workspaceRoot} */
const sessions = new Map();  /* key (task id or wave:N) -> {terminal?, execution?, agent, wave?} */
let pollTimer;
let seq = 0;                 /* agent-name counter for this window */

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
        deps.refresh();
    }, 3000);
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
    const r = await deps.cg(['resume', '--task', id, '--prompt']);
    let body = r.code === 0 ? r.stdout : '';
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
    const s = await deps.cg(['spec', 'start', id]);
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

    /* the graph is the ground truth an external agent mutates; watching it
     * keeps the board honest without the agent telling us anything */
    const watcher = vscode.workspace.createFileSystemWatcher('**/.codegraph/graph.db');
    let dbTimer;
    const bump = () => {
        clearTimeout(dbTimer);
        dbTimer = setTimeout(() => deps.refresh(), 1000);
    };
    watcher.onDidChange(bump);
    watcher.onDidCreate(bump);
    ctx.subscriptions.push(watcher, {
        dispose: () => {
            clearTimeout(dbTimer);
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

module.exports = { register };
