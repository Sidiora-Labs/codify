/* Codify fleet view — the agent hierarchy, live, in the sidebar.
 *
 * A fleet is a tree: Main Gideon owns the main branch, a feature manager owns
 * feature/<name>, and wave workers own wave/<feature>/<n>, each in its own
 * worktree. cg knows all of that already, but across three commands — the
 * agents registry (cg fleet status), the live claims (cg spec status), and the
 * branch registry (cg branches). fleetTree() joins them into the one shape the
 * view draws. It is pure and vscode-free on purpose: the join is where the
 * interesting mistakes are, and a shell can test it.
 *
 * Two deliberate refusals:
 *
 *   - a refresh never runs `cg fleet pr`, because that command *opens* a pull
 *     request. Open PRs are shown from what an explicit action reported, never
 *     discovered by polling.
 *   - merge state is only what the registry can prove: equal heads mean the
 *     base already contains the branch. The view never invents a commit count
 *     it has not been given.
 *
 * Every cg call goes through the extension's single refresh scheduler and is
 * raced against a timeout, so the view cannot sit on a spinner forever.
 *
 * Plain JS, zero dependencies, no build step. */
const fs = require('fs');
/* The join below is plain data work, and the tests drive it from a shell.
 * Importing vscode the way acp.js does keeps that possible. */
let vscode = null;
try { vscode = require('vscode'); } catch (_) { /* headless: model only */ }

/* A heartbeat is written whenever an agent touches the graph. Two minutes of
 * silence is worth a second look; a quarter of an hour means the agent is
 * almost certainly gone and its claim is about to expire anyway. */
const STALE_SEC = 120;
const COLD_SEC = 900;

/* A refresh that cannot finish is worse than one that failed: the view would
 * show a spinner nobody can clear. Every call gets this long, then gives up
 * with something the user can act on. */
const CALL_TIMEOUT_MS = 20000;

/* ---------------- the join (pure, no vscode) ---------------- */

/* Heartbeats read as ages, not clock times: "4m ago" is the number a person
 * actually compares against the others in the list. */
function relAge(seen, now) {
    if (!seen || seen <= 0) {
        return { seconds: null, text: 'never seen', stale: true, cold: true };
    }
    const s = Math.max(0, Math.round((now || Math.floor(Date.now() / 1000)) - seen));
    const text = s < 10 ? 'just now'
        : s < 90 ? `${s}s ago`
        : s < 5400 ? `${Math.round(s / 60)}m ago`
        : s < 172800 ? `${Math.round(s / 3600)}h ago`
        : `${Math.floor(s / 86400)}d ago`;
    return { seconds: s, text, stale: s >= STALE_SEC, cold: s >= COLD_SEC };
}

/* What the branch registry can prove about a branch and the branch it was cut
 * from. `exists` (fs.existsSync in the extension, absent in tests) turns a
 * registered worktree that has since been removed into a visible warning. */
function mergeState(name, base, reg, exists) {
    if (!name) return { state: 'none', label: '' };
    const row = reg.get(name);
    if (!row) {
        return { state: 'absent', label: 'not in the branch registry',
                 head: null, worktree: null, worktreeMissing: false };
    }
    const worktree = row.worktree || null;
    const worktreeMissing = !!(worktree && exists && exists(worktree) === false);
    const b = base ? reg.get(base) : null;
    let state = 'unknown';
    let label = base ? `${base} not indexed` : '';
    if (!base) {
        state = 'root';
        label = '';
    } else if (b && b.head && row.head) {
        const same = b.head === row.head;
        state = same ? 'in-sync' : 'unmerged';
        label = same ? `in sync with ${base}` : `unmerged into ${base}`;
    }
    return { state, label, head: row.head || null, base: base || null,
             worktree, worktreeMissing, files: row.files || 0,
             updated: row.updated || null };
}

/* `cg fleet tree` (task 2.3) may or may not exist in the binary on PATH, and
 * its shape is not ours to pin down. Whatever it says about who reports to
 * whom is taken as a hint; the rest of the join stands without it. */
function parentsFromTree(tree) {
    const parents = new Map();
    let root = null;
    const kids = (n) => [].concat(n.children || [], n.managers || [],
                                  n.workers || [], n.agents || [])
        .filter((c) => c && typeof c === 'object');
    const nameOf = (n) => typeof n.agent === 'string' ? n.agent
        : typeof n.name === 'string' ? n.name : null;
    const walk = (n, parent) => {
        if (!n || typeof n !== 'object') return;
        const name = nameOf(n);
        if (name) {
            if (parent && parent !== name) parents.set(name, parent);
            else if (!parent && !root) root = name;
        }
        for (const c of kids(n)) walk(c, name || parent);
    };
    if (tree && typeof tree === 'object') {
        if (Array.isArray(tree)) {
            for (const n of tree) walk(n, null);
        } else {
            const start = tree.main || tree.root || tree;
            walk(start, null);
            if (start !== tree) for (const c of kids(tree)) walk(c, root);
        }
    }
    return { parents, root };
}

function taskNode(id, claim, planned) {
    return {
        kind: 'task',
        id,
        title: (planned && planned.title) || '',
        status: (planned && planned.status) || (claim ? 'in_progress' : 'pending'),
        agent: claim ? claim.agent : null,
        attempt: claim && claim.attempt_id ? claim.attempt_id : null,
        branch: claim ? claim.branch || null : null,
        worktree: claim ? claim.worktree || null : null,
        expiresInMin: claim && claim.expires_in_min !== undefined
            ? claim.expires_in_min : null,
        host: claim ? claim.host || null : null,
        live: !!claim,
    };
}

/* Join the three reports into Main → managers → workers → tasks.
 *
 * Every input is optional and none of them is trusted to be well formed: the
 * view has to render something honest when cg is an older build, when the
 * repository has no [hierarchy] at all, or when a call timed out. */
function fleetTree(status, specStatus, branches, opts) {
    const arr = (v) => Array.isArray(v) ? v : [];
    const o = opts || {};
    const now = o.now || Math.floor(Date.now() / 1000);
    const plan = o.plan || null;
    const exists = o.exists || null;
    const prs = o.prs || {};
    const hierarchy = Object.assign(
        { configured: false, enabled: false, main: 'main', remote: 'origin' },
        (status && status.hierarchy) || {});

    const reg = new Map();
    for (const b of arr(branches && branches.branches)) {
        if (b && b.name) reg.set(b.name, b);
    }
    const agents = arr(status && status.agents).filter((a) => a && a.agent);
    const claims = arr(specStatus && specStatus.claims)
        .filter((c) => c && c.id && c.agent);
    const feature = (specStatus && specStatus.feature) ||
        (plan && plan.feature) || null;
    let hint = { parents: new Map(), root: null };
    try { hint = parentsFromTree(o.tree); } catch { /* a shape we do not know */ }

    const claimsBy = new Map();
    for (const c of claims) {
        if (!claimsBy.has(c.agent)) claimsBy.set(c.agent, []);
        claimsBy.get(c.agent).push(c);
    }
    const plannedTask = new Map();          /* task id -> {id,status,title} */
    const waveOf = new Map();               /* wave number -> plan wave */
    for (const w of arr(plan && plan.waves)) {
        if (!w || w.wave === undefined) continue;
        waveOf.set(w.wave, w);
        for (const t of arr(w.tasks)) if (t && t.id) plannedTask.set(t.id, t);
    }
    const seenOf = (name) => {
        const row = agents.find((a) => a.agent === name);
        return row ? row.seen : null;
    };
    const tasksOf = (name) => {
        const ids = new Set();
        for (const c of claimsBy.get(name) || []) ids.add(c.id);
        const row = agents.find((a) => a.agent === name);
        for (const t of arr(row && row.tasks)) {
            const ix = String(t).lastIndexOf('/');
            ids.add(ix >= 0 ? String(t).slice(ix + 1) : String(t));
        }
        const claimFor = (id) => (claimsBy.get(name) || []).find((c) => c.id === id);
        return [...ids].sort(byDotted)
            .map((id) => taskNode(id, claimFor(id), plannedTask.get(id)));
    };
    /* A wave worker owns its whole wave, not only the task it happens to hold
     * a claim on: the unclaimed ones are the work still waiting for it. Tasks
     * another agent claimed are left to show under that agent instead. */
    const waveTasks = (name, planWave, live) => {
        const out = new Map();
        for (const t of arr(planWave && planWave.tasks)) {
            if (!t || !t.id) continue;
            const claim = claims.find((c) => c.id === t.id);
            if (claim && claim.agent !== name) continue;
            out.set(t.id, taskNode(t.id, claim, t));
        }
        if (live) for (const t of tasksOf(name)) if (!out.has(t.id)) out.set(t.id, t);
        return [...out.values()].sort((a, b) => byDotted(a.id, b.id));
    };

    /* Main: whoever registered as the main role, else whoever the plan or a
     * tree hint names, else the role's configured agent template. */
    const mainRow = agents.find((a) => a.role === 'main');
    const mainName = (mainRow && mainRow.agent) ||
        (plan && plan.main && plan.main.agent) || hint.root || 'gideon';
    const mainBranch = (plan && plan.main && plan.main.branch) || hierarchy.main;

    /* Managers: the live ones, plus the slot the plan says the active feature
     * has, so the tree shows the shape of the work before anyone starts. */
    const managers = new Map();
    const addManager = (agent, feat, live, seen) => {
        if (!agent || managers.has(agent)) return managers.get(agent);
        const branch = plan && plan.feature_manager && plan.feature === feat
            ? plan.feature_manager.branch : feat ? `feature/${feat}` : null;
        const node = {
            kind: 'manager', agent, role: 'feature', feature: feat || null,
            wave: null, live, seen: seen || null, age: relAge(seen, now),
            branch, base: mainBranch,
            merge: mergeState(branch, mainBranch, reg, exists),
            worktree: branch && reg.get(branch) ? reg.get(branch).worktree : null,
            prs: (feat && prs[feat]) || [],
            tasks: tasksOf(agent),
            children: [],
        };
        managers.set(agent, node);
        return node;
    };
    for (const a of agents) {
        if (a.role === 'feature') addManager(a.agent, a.feature, true, a.seen);
    }
    if (plan && plan.feature_manager && plan.feature_manager.agent) {
        const known = [...managers.values()].some((m) => m.feature === plan.feature);
        if (!known) {
            addManager(plan.feature_manager.agent, plan.feature, false,
                       seenOf(plan.feature_manager.agent));
        }
    }

    /* Workers: the live ones, plus every wave the plan lays out, so an empty
     * wave still shows its branch and its tasks. */
    const workers = new Map();
    const addWorker = (agent, feat, wave, live, seen) => {
        if (!agent) return null;
        if (workers.has(agent)) {
            const w = workers.get(agent);
            if (live && !w.live) { w.live = true; w.seen = seen; w.age = relAge(seen, now); }
            return w;
        }
        const planWave = wave === null || wave === undefined
            ? null : waveOf.get(wave);
        const claim = (claimsBy.get(agent) || [])[0];
        const branch = (claim && claim.branch) || (planWave && planWave.branch) || null;
        const base = (planWave && planWave.base) ||
            (feat ? `feature/${feat}` : mainBranch);
        const row = branch ? reg.get(branch) : null;
        const node = {
            kind: 'worker', agent, role: 'worker',
            feature: feat || null,
            wave: wave === undefined ? null : wave,
            live, seen: seen || null, age: relAge(seen, now),
            branch, base,
            merge: mergeState(branch, base, reg, exists),
            worktree: (claim && claim.worktree) || (row && row.worktree) || null,
            attempt: (claim && claim.attempt_id) || null,
            host: (claim && claim.host) || null,
            tasks: waveTasks(agent, planWave, live),
            children: [],
        };
        workers.set(agent, node);
        return node;
    };
    for (const a of agents) {
        if (a.role === 'worker') addWorker(a.agent, a.feature, a.wave, true, a.seen);
    }
    for (const w of arr(plan && plan.waves)) {
        if (!w || !w.agent) continue;
        const live = arr(w.live).filter((n) => workers.has(n) ||
            agents.some((a) => a.agent === n && a.role === 'worker'));
        if (live.length) continue;                 /* a live worker owns it */
        addWorker(w.agent, plan.feature, w.wave, false, seenOf(w.agent));
    }
    /* An agent that never declared a role still holds a claim, and hiding it
     * would make the board lie about who is in the repository. */
    for (const a of agents) {
        if (a.role || a.agent === mainName) continue;
        if (!(claimsBy.get(a.agent) || []).length) continue;
        const w = addWorker(a.agent, a.feature || feature, a.wave, true, a.seen);
        if (w) { w.role = null; w.note = 'no role'; }
    }

    /* Attach: the agent's own parent, else a tree hint, else the manager that
     * owns its feature, else Main. */
    const managerFor = (feat) =>
        [...managers.values()].find((m) => m.feature && m.feature === feat);
    const orphans = [];
    for (const w of workers.values()) {
        const row = agents.find((a) => a.agent === w.agent);
        const claim = (claimsBy.get(w.agent) || [])[0];
        const parent = (row && row.parent) || (claim && claim.parent) ||
            hint.parents.get(w.agent) ||
            (managerFor(w.feature) && managerFor(w.feature).agent) || mainName;
        w.parent = parent;
        const m = managers.get(parent);
        if (m) m.children.push(w);
        else orphans.push(w);
    }
    for (const m of managers.values()) {
        m.children.sort((a, b) => (a.wave === b.wave)
            ? String(a.agent).localeCompare(String(b.agent))
            : Number(a.wave === null ? 1e9 : a.wave) -
              Number(b.wave === null ? 1e9 : b.wave));
    }
    const managerList = [...managers.values()]
        .sort((a, b) => String(a.feature || a.agent)
            .localeCompare(String(b.feature || b.agent)));

    const main = {
        kind: 'main', agent: mainName, role: 'main', feature: null, wave: null,
        live: !!mainRow, seen: mainRow ? mainRow.seen : null,
        age: relAge(mainRow ? mainRow.seen : null, now),
        branch: mainBranch, base: null,
        merge: mergeState(mainBranch, null, reg, exists),
        worktree: reg.get(mainBranch) ? reg.get(mainBranch).worktree : null,
        remote: hierarchy.remote,
        tasks: tasksOf(mainName),
        children: managerList.concat(orphans),
    };
    const everyone = [main, ...managerList, ...workers.values()];
    return {
        hierarchy,
        feature,
        main,
        managers: managerList,
        workers: [...workers.values()],
        counts: {
            agents: agents.length,
            live: everyone.filter((n) => n.live).length,
            stale: everyone.filter((n) => n.live && n.age.stale).length,
            claims: claims.length,
            branches: reg.size,
        },
    };
}

/* Task ids are dotted numbers, and "10.1" sorts after "9.1" only if they are
 * compared segment by segment. */
function byDotted(a, b) {
    const x = String(a).split('.');
    const y = String(b).split('.');
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const p = Number(x[i]);
        const q = Number(y[i]);
        if (Number.isNaN(p) || Number.isNaN(q)) {
            const c = String(x[i] || '').localeCompare(String(y[i] || ''));
            if (c) return c;
            continue;
        }
        if (p !== q) return p - q;
    }
    return 0;
}

/* ---------------- the view ---------------- */

const ROLE_TITLE = { main: 'Main Gideon', feature: 'Feature Manager',
                     worker: 'Wave Worker' };

const STATUS_ICON = {
    done: ['pass-filled', 'testing.iconPassed'],
    implemented: ['circle-large-filled', 'charts.purple'],
    in_progress: ['play-circle', 'charts.yellow'],
    pending: ['circle-outline', null],
};

function short(s, n) {
    return s ? String(s).slice(0, n === undefined ? 8 : n) : '';
}

/* A promise that always settles: a wedged cg call must not wedge the view. */
function withTimeout(p, ms, onTimeout) {
    let timer;
    return Promise.race([
        Promise.resolve(p).then((v) => { clearTimeout(timer); return v; },
                               () => { clearTimeout(timer); return null; }),
        new Promise((resolve) => {
            timer = setTimeout(() => { if (onTimeout) onTimeout(); resolve(null); }, ms);
        }),
    ]);
}

/* The fleet as a TreeView: Main Gideon, the feature managers under it, the
 * wave workers under them, and each worker's tasks under that. The model is
 * rebuilt by the extension's one refresh scheduler and only while the view is
 * visible — a collapsed fleet costs nothing. */
class FleetView {
    constructor(deps) {
        this.deps = deps;
        this._em = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._em.event;
        this.model = null;
        this.state = 'loading';       /* loading | ready | error */
        this.error = null;
        this.prs = {};                /* feature -> [{number,url,branch}] */
        this.hasTree = undefined;     /* cg fleet tree probed once per window */
        this.visible = true;
        this.force = false;           /* one pass even while the view is hidden */
        this.view = null;
    }

    /* One pass of the fleet's own cg calls, run inside the extension's
     * refresh chain. `specStatus` is the board's report, reused rather than
     * asked for a second time. */
    async refresh(specStatus) {
        if (!this.visible && !this.force) return;
        this.force = false;
        const { cgJson } = this.deps;
        const call = (args) => withTimeout(cgJson(args), CALL_TIMEOUT_MS,
            () => { this.error = `\`cg ${args.join(' ')}\` did not answer in ` +
                                 `${CALL_TIMEOUT_MS / 1000}s`; });
        this.error = null;
        const status = await call(['fleet', 'status']);
        if (!status) {
            this.model = null;
            this.state = 'error';
            if (!this.error) this.error = 'cg fleet status returned nothing — ' +
                'is cg on PATH and this a Codify repository?';
            this._done();
            return;
        }
        const configured = status.hierarchy && status.hierarchy.configured;
        const spec = specStatus || await call(['spec', 'status']);
        const branches = configured ? await call(['branches']) : null;
        const plan = configured ? await call(['fleet', 'plan']) : null;
        let tree;
        if (configured && this.hasTree !== false) {
            tree = await call(['fleet', 'tree']);
            this.hasTree = !!tree;     /* an older cg prints usage, not JSON */
        }
        this.model = fleetTree(status, spec, branches, {
            plan, tree, prs: this.prs, exists: (p) => {
                try { return fs.existsSync(p); } catch { return true; }
            },
        });
        this.state = 'ready';
        this._done();
    }

    _done() {
        this._em.fire();
        const m = this.model;
        if (this.view) {
            this.view.description = m && m.hierarchy.configured
                ? `${m.counts.live} live` +
                  (m.counts.stale ? ` · ${m.counts.stale} stale` : '')
                : undefined;
        }
        vscode.commands.executeCommand('setContext', 'codify.fleet',
            !!(m && m.hierarchy.configured));
    }

    getTreeItem(el) { return el; }

    getChildren(el) {
        if (el) return el.childItems || [];
        if (this.state === 'loading') return [this.noticeItem(
            'Loading the fleet…', 'sync~spin', undefined)];
        if (this.state === 'error') return [this.noticeItem(
            this.error || 'The fleet could not be read', 'warning',
            'codify.fleet.refresh')];
        const m = this.model;
        /* Nothing configured: the welcome view explains it better than a
         * placeholder row ever could, and it only shows on an empty tree. */
        if (!m || !m.hierarchy.configured) return [];
        return [this.nodeItem(m.main)];
    }

    noticeItem(label, icon, command) {
        const it = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        it.iconPath = new vscode.ThemeIcon(icon);
        it.contextValue = 'fleet-notice';
        if (command) {
            it.command = { command, title: 'Retry' };
            it.description = 'click to retry';
        }
        return it;
    }

    /* One agent — main, manager, or worker — with its branch, its heartbeat,
     * and what the registry knows about merging it upward. */
    nodeItem(n) {
        const kids = (n.children || []).map((c) => this.nodeItem(c))
            .concat((n.prs || []).map((p) => this.prItem(p)))
            .concat((n.tasks || []).map((t) => this.taskItem(t, n.agent)));
        const it = new vscode.TreeItem(n.agent, kids.length
            ? (n.kind === 'main' || n.live
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed)
            : vscode.TreeItemCollapsibleState.None);
        it.id = `fleet:${n.kind}:${n.agent}`;
        it.childItems = kids;
        it.node = n;
        /* The row reads left to right the way the fleet is organised: who this
         * is, which branch it owns, and how long ago it was last heard from. */
        const bits = [];
        if (n.kind !== 'worker') bits.push(ROLE_TITLE[n.role] || 'agent');
        else if (n.wave !== null && n.wave !== undefined) bits.push(`wave ${n.wave}`);
        if (n.branch) bits.push(n.branch);
        if (n.note) bits.push(n.note);
        if (n.live) bits.push(n.age.text + (n.age.stale ? ' · stale' : ''));
        else bits.push('not started');
        if (n.merge && n.merge.state === 'unmerged') bits.push('unmerged');
        if (n.merge && n.merge.worktreeMissing) bits.push('worktree gone');
        it.description = bits.join(' · ');
        it.iconPath = this.agentIcon(n);
        it.tooltip = this.agentTooltip(n);
        it.contextValue = `fleet-${n.kind}` +
            (n.worktree ? '-worktree' : '') +
            (n.kind === 'worker' && n.tasks && n.tasks.length ? '-tasks' : '');
        return it;
    }

    agentIcon(n) {
        const icon = n.kind === 'main' ? 'organization'
            : n.kind === 'manager' ? 'git-merge' : 'person';
        if (!n.live) return new vscode.ThemeIcon(icon);
        const color = n.age.cold ? 'list.errorForeground'
            : n.age.stale ? 'list.warningForeground'
            : 'testing.iconPassed';
        return new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
    }

    agentTooltip(n) {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${n.agent}** — ${ROLE_TITLE[n.role] || 'agent'}\n\n`);
        if (n.parent) md.appendMarkdown(`reports to \`${n.parent}\`\n\n`);
        if (n.feature) md.appendMarkdown(`feature \`${n.feature}\`` +
            (n.wave !== null && n.wave !== undefined ? ` · wave ${n.wave}` : '') + '\n\n');
        if (n.branch) {
            md.appendMarkdown(`branch \`${n.branch}\`` +
                (n.base ? ` from \`${n.base}\`` : '') + '\n\n');
        }
        if (n.merge && n.merge.label) {
            md.appendMarkdown(n.merge.state === 'unmerged'
                ? `${n.merge.label} — its head \`${short(n.merge.head)}\` is not ` +
                  `the base's\n\n`
                : `${n.merge.label}\n\n`);
        }
        if (n.attempt) md.appendMarkdown(`attempt \`${short(n.attempt, 12)}\`\n\n`);
        if (n.host) md.appendMarkdown(`host ${n.host}\n\n`);
        if (n.worktree) {
            md.appendMarkdown(`worktree \`${n.worktree}\`` +
                (n.merge && n.merge.worktreeMissing ? ' — **missing on disk**' : '') +
                '\n\n');
        }
        md.appendMarkdown(n.live
            ? `last seen ${n.age.text}${n.age.stale ? ' — heartbeat is stale' : ''}`
            : 'planned by `cg fleet plan`; no agent has registered yet');
        return md;
    }

    taskItem(t, owner) {
        const it = new vscode.TreeItem(t.title ? `${t.id}  ${t.title}` : t.id,
            vscode.TreeItemCollapsibleState.None);
        it.id = `fleet:task:${owner || t.agent || 'plan'}:${t.id}`;
        it.node = t;
        it.childItems = [];
        const bits = [t.status];
        if (t.attempt) bits.push(`attempt ${short(t.attempt, 8)}`);
        if (t.expiresInMin !== null && t.expiresInMin !== undefined) {
            bits.push(`${t.expiresInMin} min left`);
        }
        it.description = bits.join(' · ');
        const [icon, color] = STATUS_ICON[t.status] || STATUS_ICON.pending;
        it.iconPath = color
            ? new vscode.ThemeIcon(icon, new vscode.ThemeColor(color))
            : new vscode.ThemeIcon(icon);
        it.contextValue = `fleet-task-${t.status}`;
        it.tooltip = new vscode.MarkdownString(
            `**${t.id}** ${t.title}\n\n` +
            `status ${t.status}\n\n` +
            (t.branch ? `branch \`${t.branch}\`\n\n` : '') +
            (t.attempt ? `attempt \`${short(t.attempt, 16)}\`\n\n` : '') +
            (t.live ? 'held by a live claim' : 'no live claim'));
        it.command = { command: 'codify.openTask', title: 'Open task',
                       arguments: [t.id] };
        return it;
    }

    prItem(p) {
        const it = new vscode.TreeItem(`#${p.number} ${p.title || p.branch || ''}`.trim(),
            vscode.TreeItemCollapsibleState.None);
        it.id = `fleet:pr:${p.number}`;
        it.childItems = [];
        it.node = p;
        it.description = p.state || 'open';
        it.iconPath = new vscode.ThemeIcon('git-pull-request',
            new vscode.ThemeColor('charts.green'));
        it.contextValue = 'fleet-pr';
        it.tooltip = p.url || '';
        if (p.url) {
            it.command = { command: 'vscode.open', title: 'Open pull request',
                           arguments: [vscode.Uri.parse(p.url)] };
        }
        return it;
    }

    /* What an action was invoked on: a tree item, or nothing when it came
     * from the command palette. */
    nodeOf(arg) { return arg && arg.node ? arg.node : null; }

    /* The only place open pull requests come from: what `cg fleet pr` or a
     * landing reported when the user asked for one. Polling for them would
     * mean running a command that opens one. */
    remember(feature, pr) {
        if (!feature || !pr || !pr.number) return;
        const list = this.prs[feature] || [];
        const ix = list.findIndex((x) => x.number === pr.number);
        if (ix >= 0) list[ix] = pr; else list.push(pr);
        this.prs[feature] = list;
    }
}

/* ---------------- commands ---------------- */

let view;
let deps;

function featureOf(node) {
    if (node && node.feature) return node.feature;
    const m = view.model;
    return (m && m.feature) || undefined;
}

async function run(args, title) {
    const r = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `Codify: ${title}` },
        () => deps.cg(args));
    deps.show(`$ cg ${args.join(' ')}\n\n${r.stdout}${r.stderr}`);
    return r;
}

function parse(r) {
    try { return JSON.parse(r.stdout); } catch { return null; }
}

/* Pick a task the fleet could begin: everything the plan lays out that is not
 * done, newest wave last, with who holds it right now. */
async function pickTask(placeHolder) {
    const m = view.model;
    const items = [];
    const seen = new Set();
    const walk = (n) => {
        for (const t of n.tasks || []) {
            if (seen.has(t.id) || t.status === 'done') continue;
            seen.add(t.id);
            items.push({
                label: t.title ? `${t.id}  ${t.title}` : t.id,
                description: t.live ? `${t.status} · ${n.agent}` : t.status,
                detail: n.branch ? `${n.branch}${n.wave !== null &&
                    n.wave !== undefined ? ` · wave ${n.wave}` : ''}` : undefined,
                id: t.id,
            });
        }
        for (const c of n.children || []) walk(c);
    };
    if (m) walk(m.main);
    items.sort((a, b) => byDotted(a.id, b.id));
    if (!items.length) {
        vscode.window.showInformationMessage(
            'No fleet tasks to act on — the plan has none that are not done.');
        return undefined;
    }
    const pick = await vscode.window.showQuickPick(items, { placeHolder });
    return pick && pick.id;
}

function taskIdOf(arg) {
    const n = view.nodeOf(arg);
    if (n && n.kind === 'task') return n.id;
    if (n && n.tasks && n.tasks.length === 1) return n.tasks[0].id;
    return undefined;
}

async function cmdRefresh() {
    view.force = true;
    await deps.refresh();
}

/* A worktree is a folder; opening one is a window decision, so the view asks
 * rather than guessing and throwing away what the user has open. */
async function cmdOpenWorktree(arg) {
    const n = view.nodeOf(arg);
    let dir = n && n.worktree;
    if (!dir) {
        const all = [];
        const walk = (x) => {
            if (x.worktree) {
                all.push({ label: x.agent, description: x.worktree, dir: x.worktree });
            }
            for (const c of x.children || []) walk(c);
        };
        if (view.model) walk(view.model.main);
        if (!all.length) {
            vscode.window.showInformationMessage(
                'No fleet worktrees yet — `cg fleet begin <task>` creates one.');
            return;
        }
        const pick = await vscode.window.showQuickPick(all,
            { placeHolder: 'Open which worktree?' });
        if (!pick) return;
        dir = pick.dir;
    }
    if (!fs.existsSync(dir)) {
        vscode.window.showWarningMessage(
            `That worktree is gone from disk: ${dir}`);
        return;
    }
    const uri = vscode.Uri.file(dir);
    const how = await vscode.window.showQuickPick([
        { label: '$(multiple-windows) Open in a new window', id: 'window' },
        { label: '$(add) Add to this workspace', id: 'add' },
    ], { placeHolder: dir });
    if (!how) return;
    if (how.id === 'window') {
        await vscode.commands.executeCommand('vscode.openFolder', uri,
            { forceNewWindow: true });
    } else {
        vscode.workspace.updateWorkspaceFolders(
            vscode.workspace.workspaceFolders
                ? vscode.workspace.workspaceFolders.length : 0,
            null, { uri });
    }
}

async function cmdBegin(arg) {
    const id = taskIdOf(arg) || await pickTask('Begin which task?');
    if (!id) return;
    const feature = featureOf(view.nodeOf(arg));
    const args = ['fleet', 'begin', id, '--json'];
    if (feature) args.push('-f', feature);
    const r = await run(args, `fleet begin ${id}`);
    const j = parse(r);
    if (r.code !== 0 || !j) {
        vscode.window.showErrorMessage(
            `cg fleet begin ${id} refused — see the Codify output.`);
        await deps.refresh();
        return;
    }
    const pick = await vscode.window.showInformationMessage(
        `${j.agent} has ${j.branch} for ${id}.`, 'Open worktree');
    if (pick === 'Open worktree') await cmdOpenWorktree({ node: { worktree: j.worktree } });
    await deps.refresh();
}

async function cmdMergeUp(arg) {
    const id = taskIdOf(arg) || await pickTask('Merge which task up?');
    if (!id) return;
    const node = view.nodeOf(arg);
    const feature = featureOf(node);
    const where = node && node.branch ? `${node.branch} into ${node.base}`
        : `task ${id}'s wave branch into the feature branch`;
    const choice = await vscode.window.showWarningMessage(
        `Merge ${where}?`,
        { modal: true, detail: 'cg refuses unless the task qualified on its ' +
            'own branch. A conflict is aborted unless you keep it.' },
        'Merge', 'Merge and keep a conflict');
    if (!choice) return;
    const args = ['fleet', 'merge-up', id, '--json'];
    if (choice === 'Merge and keep a conflict') args.push('--keep');
    if (feature) args.push('-f', feature);
    const r = await run(args, `fleet merge-up ${id}`);
    const j = parse(r);
    if (j && j.merged) {
        vscode.window.showInformationMessage(
            `Merged ${j.branch} into ${j.base}: ${j.commits} commit(s).`);
    } else if (j && j.conflicts && j.conflicts.length) {
        vscode.window.showWarningMessage(
            `${j.branch} conflicts with ${j.base} in ${j.conflicts.length} path(s) — ` +
            'see the Codify output.');
    } else if (r.code !== 0) {
        vscode.window.showErrorMessage(
            `cg fleet merge-up ${id} refused — see the Codify output.`);
    } else if (j && j.commits === 0) {
        vscode.window.showInformationMessage(
            `Nothing to merge: ${j.base} already contains ${j.branch}.`);
    }
    await deps.refresh();
}

async function cmdLand(arg) {
    const feature = featureOf(view.nodeOf(arg));
    if (!feature) {
        vscode.window.showInformationMessage('No active feature to land.');
        return;
    }
    const main = view.model ? view.model.hierarchy.main : 'main';
    const ok = await vscode.window.showWarningMessage(
        `Land feature/${feature} into ${main}?`,
        { modal: true, detail: 'The gates run first. If one is red, ' +
            `${main} is reset to where it was and nothing lands. On green, ` +
            'the pull request policy decides whether a PR is opened.' },
        'Land', 'Land without a pull request');
    if (!ok) return;
    const args = ['fleet', 'land', feature, '--json'];
    if (ok === 'Land without a pull request') args.push('--no-pr');
    const r = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification,
          title: `Codify: landing ${feature} — running the gates` },
        () => deps.cg(args));
    deps.show(`$ cg ${args.join(' ')}\n\n${r.stdout}${r.stderr}`);
    const j = parse(r);
    if (j && j.landed) {
        if (j.pr) view.remember(feature, prFrom(j.pr));
        vscode.window.showInformationMessage(
            `Landed ${j.branch} into ${j.main}: ${j.commits} commit(s).`);
    } else if (j && j.gates) {
        const red = Object.keys(j.gates).find((g) => j.gates[g] && !j.gates[g].ok);
        vscode.window.showErrorMessage(red
            ? `The ${red} gate failed — ${j.main} was reset. See the Codify output.`
            : 'Landing refused — see the Codify output.');
    } else if (r.code !== 0) {
        vscode.window.showErrorMessage(
            `cg fleet land ${feature} refused — see the Codify output.`);
    }
    await deps.refresh();
}

function prFrom(j) {
    if (!j || (!j.number && !j.url)) return null;
    return { number: j.number || 0, url: j.url || '', branch: j.branch || '',
             title: j.branch || '', state: j.already_open ? 'open' : 'opened' };
}

async function cmdOpenPr(arg) {
    const feature = featureOf(view.nodeOf(arg));
    if (!feature) {
        vscode.window.showInformationMessage('No active feature for a pull request.');
        return;
    }
    const choice = await vscode.window.showWarningMessage(
        `Open the pull request for feature/${feature}?`,
        { modal: true, detail: 'This pushes the feature branch to the remote ' +
            'and asks gh to open a pull request. A dry run only prints the ' +
            'commands it would run.' },
        'Open it', 'Dry run');
    if (!choice) return;
    const args = ['fleet', 'pr', feature, '--json'];
    if (choice === 'Dry run') args.push('--dry-run');
    const r = await run(args, `fleet pr ${feature}`);
    const j = parse(r);
    const pr = prFrom(j);
    if (pr) {
        view.remember(feature, pr);
        const pick = await vscode.window.showInformationMessage(
            j.already_open ? `Pull request #${pr.number} is already open.`
                           : `Opened pull request #${pr.number || ''}.`,
            ...(pr.url ? ['Open in browser'] : []));
        if (pick === 'Open in browser') {
            await vscode.env.openExternal(vscode.Uri.parse(pr.url));
        }
    } else if (j && j.reason) {
        vscode.window.showInformationMessage(
            `No pull request opened (${j.reason}) — the commands are in the Codify output.`);
    } else if (r.code !== 0) {
        vscode.window.showErrorMessage(
            `cg fleet pr ${feature} failed — see the Codify output.`);
    }
    await deps.refresh();
}

async function cmdCheckpoint() {
    const choice = await vscode.window.showWarningMessage(
        'Merge the open Codify pull requests?',
        { modal: true, detail: 'cg fleet checkpoint merges them lowest number ' +
            'first and stops at the first one that will not merge. A dry run ' +
            'only prints what it would do.' },
        'Merge them', 'Dry run');
    if (!choice) return;
    const args = ['fleet', 'checkpoint', '--json'];
    if (choice === 'Dry run') args.push('--dry-run');
    const r = await run(args, 'fleet checkpoint');
    const j = parse(r);
    if (j && j.merged) {
        const ok = j.merged.filter((p) => p.ok).length;
        const bad = j.merged.find((p) => !p.ok);
        if (bad) {
            vscode.window.showWarningMessage(
                `Checkpoint stopped at #${bad.number} — ${ok} merged, ` +
                `${j.remaining} left. See the Codify output.`);
        } else if (j.reason) {
            vscode.window.showInformationMessage(
                `Checkpoint (${j.reason}) — the commands are in the Codify output.`);
        } else {
            vscode.window.showInformationMessage(
                `Checkpoint: ${ok} pull request(s) merged` +
                (j.local_main && j.local_main.updated ? ', local main fast-forwarded.' : '.'));
        }
    } else if (r.code !== 0) {
        vscode.window.showErrorMessage(
            'cg fleet checkpoint failed — see the Codify output.');
    }
    await deps.refresh();
}

/* ---------------- registration ---------------- */

function register(ctx, d) {
    deps = d;
    view = new FleetView(d);
    const tv = vscode.window.createTreeView('codifyFleet', {
        treeDataProvider: view, showCollapseAll: true,
    });
    view.view = tv;
    view.visible = tv.visible;
    /* The fleet's cg calls are only worth making while someone is looking;
     * becoming visible asks the one scheduler for a pass, it never starts a
     * timer of its own. */
    ctx.subscriptions.push(tv, tv.onDidChangeVisibility((e) => {
        view.visible = e.visible;
        if (e.visible) { view.force = true; deps.refresh(); }
    }));

    const cmds = {
        'codify.fleet.refresh': cmdRefresh,
        'codify.fleet.openWorktree': cmdOpenWorktree,
        'codify.fleet.begin': cmdBegin,
        'codify.fleet.mergeUp': cmdMergeUp,
        'codify.fleet.land': cmdLand,
        'codify.fleet.openPr': cmdOpenPr,
        'codify.fleet.checkpoint': cmdCheckpoint,
    };
    for (const [name, fn] of Object.entries(cmds)) {
        ctx.subscriptions.push(vscode.commands.registerCommand(name, fn));
    }

    return {
        refresh: (specStatus) => view.refresh(specStatus),
        get visible() { return view.visible; },
    };
}

module.exports = { register, FleetView, fleetTree, relAge, mergeState, parentsFromTree };
