/* Codify fleet view — the agent hierarchy, live, in the sidebar.
 *
 * A fleet is a tree: Main Gideon owns the main branch, a wave manager owns
 * each wave's wave/<feature>/<n>, and a task worker owns each task's
 * task/<feature>/<id>, each in its own worktree. (A workflow whose templates
 * name neither {wave} nor {task} keeps the older shape: one feature manager
 * on feature/<name>, wave workers on wave/<feature>/<n>.) `cg fleet tree` reports that hierarchy directly and is preferred
 * wherever it speaks; what it does not cover — the waves nobody has started,
 * the tasks in each one, and whether a branch is already in its base — is
 * joined from the agents registry (cg fleet status), the live claims (cg spec
 * status), the plan (cg fleet plan) and the branch registry (cg branches). On
 * a cg too old to have a tree, that join carries the whole view on its own.
 * fleetTree() does all of it and is pure and vscode-free on purpose: the join
 * is where the interesting mistakes are, and a shell can test it.
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
const path = require('path');
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

/* `cg fleet tree --json` is cg's own walk of the hierarchy:
 *
 *   {feature, enabled, main:{agent,role,branch,worktree},
 *    managers:[{agent,role,parent,feature,wave,branch,base,worktree,seen,
 *               tasks:{total,done,claimed}, ahead, merged, complete,
 *               workers:[{agent,role,parent,wave,branch,base,worktree,task,
 *                         attempt,state,heartbeat,seen}]}]}
 *
 * Where it speaks it wins, because it is one authoritative answer instead of
 * our join of three reports — and it is the only source for `ahead`, which is
 * a commit count nothing else here could produce. It is not the whole picture:
 * it lists only agents that have registered, and a worker's branch/base/
 * worktree stay empty in the registry until its attempt fills them in, so the
 * plan, the claims and the branch registry still fill the gaps.
 *
 * A manager's `wave` is its wave, or null for a manager of the whole
 * feature (the older shape, and any cg before managers were per wave).
 *
 * Any other shape returns null, and the join falls back to composing the tree
 * itself with only the generic parent hint below. */
function treeFacts(tree) {
    if (!tree || typeof tree !== 'object' || Array.isArray(tree)) return null;
    const main = tree.main;
    if (!main || typeof main !== 'object' || typeof main.agent !== 'string' ||
        !Array.isArray(tree.managers)) return null;
    const str = (v) => (typeof v === 'string' && v) ? v : null;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
    const managers = [];
    const workers = [];
    for (const m of tree.managers) {
        if (!m || typeof m !== 'object' || typeof m.agent !== 'string') continue;
        const t = (m.tasks && typeof m.tasks === 'object') ? m.tasks : {};
        const mwave = num(m.wave);
        const mgr = {
            agent: m.agent,
            parent: str(m.parent) || main.agent,
            feature: str(m.feature) || str(tree.feature),
            wave: (mwave !== null && mwave >= 0) ? mwave : null,
            branch: str(m.branch), base: str(m.base), worktree: str(m.worktree),
            seen: num(m.seen), ahead: num(m.ahead),
            merged: m.merged === true, complete: m.complete === true,
            progress: {
                total: num(t.total) || 0,
                done: num(t.done) || 0,
                claimed: num(t.claimed) || 0,
            },
        };
        managers.push(mgr);
        for (const w of (Array.isArray(m.workers) ? m.workers : [])) {
            if (!w || typeof w !== 'object' || typeof w.agent !== 'string') continue;
            const wave = num(w.wave);
            workers.push({
                agent: w.agent,
                parent: str(w.parent) || m.agent,
                feature: mgr.feature,
                /* cg stores -1 for a worker with no wave of its own */
                wave: (wave !== null && wave >= 0) ? wave : null,
                branch: str(w.branch), base: str(w.base),
                worktree: str(w.worktree), task: str(w.task),
                attempt: str(w.attempt), state: str(w.state),
                heartbeat: num(w.heartbeat), seen: num(w.seen),
            });
        }
    }
    return {
        feature: str(tree.feature),
        enabled: tree.enabled === true,
        main: { agent: main.agent, branch: str(main.branch),
                worktree: str(main.worktree) },
        managers, workers,
    };
}

/* An older cg has no `fleet tree`, and a newer one may grow a shape this
 * version has never seen. Whatever such a report says about who reports to
 * whom is still taken as a hint; the rest of the join stands without it. */
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

/* `cg fleet plan --json` in either shape, as one:
 *   {managers:[{wave|null, agent, branch, base, live}],
 *    workers:[{wave, task|null, agent, branch, base, live, tasks}]}
 * The current shape nests a worker row per task (or per wave) under each
 * manager; an older cg gave one feature_manager and a row per wave. */
function planShape(plan) {
    const arr = (v) => Array.isArray(v) ? v : [];
    const out = { managers: [], workers: [] };
    if (!plan || typeof plan !== 'object') return out;
    const wv = (v) => (typeof v === 'number' && v >= 0) ? v : null;
    if (Array.isArray(plan.managers)) {
        for (const m of plan.managers) {
            if (!m || typeof m !== 'object') continue;
            out.managers.push({ wave: wv(m.wave), agent: m.agent || null,
                                branch: m.branch || null, base: m.base || null,
                                live: arr(m.live) });
            for (const w of arr(m.workers)) {
                if (!w || typeof w !== 'object') continue;
                out.workers.push({ wave: wv(w.wave), task: w.task || null,
                                   agent: w.agent || null, branch: w.branch || null,
                                   base: w.base || null, live: arr(w.live),
                                   tasks: arr(w.tasks), parent: m.agent || null });
            }
        }
        return out;
    }
    const fm = plan.feature_manager;
    if (fm && typeof fm === 'object') {
        out.managers.push({ wave: null, agent: fm.agent || null,
                            branch: fm.branch || null, base: fm.base || null,
                            live: arr(fm.live) });
    }
    for (const w of arr(plan.waves)) {
        if (!w || w.wave === undefined) continue;
        out.workers.push({ wave: w.wave, task: null, agent: w.agent || null,
                           branch: w.branch || null, base: w.base || null,
                           live: arr(w.live), tasks: arr(w.tasks),
                           parent: fm && fm.agent || null });
    }
    return out;
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

/* Build Main → managers → workers → tasks, and say where it came from.
 *
 * `opts.tree` is `cg fleet tree --json`. When treeFacts() recognises it, it
 * decides who exists, who reports to whom, which branch and worktree each
 * agent owns, and the subtree numbers (progress, ahead, merged, complete)
 * nothing else here could compute; the result is tagged source:'tree'. The
 * other reports then only fill gaps the tree leaves: the waves nobody has
 * started and their tasks (from the plan), the branch fields a worker's
 * registry row carries only once an attempt fills them in (from the claim),
 * and merge state (from the branch registry). With no usable tree the same
 * join composes the whole hierarchy on its own and is tagged
 * source:'composed', which is what an older cg gets.
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
    /* cg's own answer, when the binary is new enough to give one */
    let facts = null;
    try { facts = treeFacts(o.tree); } catch { facts = null; }
    const feature = (specStatus && specStatus.feature) ||
        (plan && plan.feature) || (facts && facts.feature) || null;
    let hint = { parents: new Map(), root: null };
    try { hint = parentsFromTree(o.tree); } catch { /* a shape we do not know */ }
    const treeParent = new Map();
    for (const n of facts ? facts.managers.concat(facts.workers) : []) {
        if (n.parent) treeParent.set(n.agent, n.parent);
    }

    const claimsBy = new Map();
    for (const c of claims) {
        if (!claimsBy.has(c.agent)) claimsBy.set(c.agent, []);
        claimsBy.get(c.agent).push(c);
    }
    const plannedTask = new Map();          /* task id -> {id,status,title} */
    const shape = planShape(plan);
    const planOf = new Map();               /* worker agent -> plan row */
    const waveOf = new Map();               /* wave number -> plan row (per wave) */
    for (const w of shape.workers) {
        if (w.agent) planOf.set(w.agent, w);
        if (w.task === null && w.wave !== null) waveOf.set(w.wave, w);
        for (const t of w.tasks) if (t && t.id) plannedTask.set(t.id, t);
    }
    const planMgr = (feat, wave) => plan && plan.feature === feat
        ? shape.managers.find((m) => m.wave === (wave === undefined ? null : wave))
        : null;
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
    /* Every task of `name`'s wave, from three angles that rarely agree: the
     * plan's wave (the work the wave owns, claimed or not — the unclaimed ones
     * are what is still waiting for it), the agent's own claims and registry
     * row when it is live, and `held`, the task cg's tree says it is on right
     * now, which survives even when the plan has moved past it and the claim
     * is gone. A task another agent claimed is dropped here so it shows under
     * that agent instead of twice. */
    const waveTasks = (name, planWave, live, held) => {
        const out = new Map();
        for (const t of arr(planWave && planWave.tasks)) {
            if (!t || !t.id) continue;
            const claim = claims.find((c) => c.id === t.id);
            if (claim && claim.agent !== name) continue;
            out.set(t.id, taskNode(t.id, claim, t));
        }
        if (live) for (const t of tasksOf(name)) if (!out.has(t.id)) out.set(t.id, t);
        /* the task cg's tree says this worker is on, even when the plan has
         * moved on and no claim survives */
        if (held && !out.has(held)) {
            out.set(held, taskNode(held,
                claims.find((c) => c.id === held && c.agent === name),
                plannedTask.get(held)));
        }
        return [...out.values()].sort((a, b) => byDotted(a.id, b.id));
    };

    /* Main: whoever registered as the main role, else whoever the plan or a
     * tree hint names, else the role's configured agent template. */
    const mainRow = agents.find((a) => a.role === 'main');
    const mainName = (facts && facts.main.agent) || (mainRow && mainRow.agent) ||
        (plan && plan.main && plan.main.agent) || hint.root || 'gideon';
    const mainBranch = (facts && facts.main.branch) ||
        (plan && plan.main && plan.main.branch) || hierarchy.main;

    /* Managers: the live ones, plus the slot the plan says the active feature
     * has, so the tree shows the shape of the work before anyone starts. */
    const managers = new Map();
    const addManager = (agent, feat, live, seen, tf, wave) => {
        if (!agent || managers.has(agent)) return managers.get(agent);
        const mw = tf && tf.wave !== undefined ? tf.wave
            : wave === undefined ? null : wave;
        const pm = planMgr(feat, mw);
        const branch = (tf && tf.branch) || (pm && pm.branch) ||
            (feat ? (mw === null ? `feature/${feat}` : `wave/${feat}/${mw}`) : null);
        const base = (tf && tf.base) || mainBranch;
        const node = {
            kind: 'manager', agent, role: 'feature', feature: feat || null,
            wave: mw, live, seen: seen || null, age: relAge(seen, now),
            branch, base,
            merge: mergeState(branch, base, reg, exists),
            worktree: (tf && tf.worktree) ||
                (branch && reg.get(branch) ? reg.get(branch).worktree : null),
            prs: (feat && prs[feat]) || [],
            tasks: tasksOf(agent),
            children: [],
        };
        /* What cg counted while walking the subtree: how much of the feature
         * is done, and how far its branch has run past the branch it lands
         * in. `ahead` is a commit count — nothing else the view reads could
         * produce it, so it appears only when the tree is there. */
        if (tf) {
            node.progress = tf.progress;
            node.ahead = tf.ahead === null ? null : Math.max(0, tf.ahead);
            node.merged = tf.merged;
            node.complete = tf.complete;
        }
        managers.set(agent, node);
        return node;
    };
    /* the tree first, so its identities and branches win over our guesses */
    for (const m of facts ? facts.managers : []) {
        const live = (m.seen || 0) > 0 ||
            agents.some((a) => a.agent === m.agent);
        addManager(m.agent, m.feature, live, m.seen || seenOf(m.agent), m);
    }
    for (const a of agents) {
        if (a.role !== 'feature') continue;
        /* a manager registers under its wave; one of the whole feature has
         * none (cg stores -1) */
        const w = typeof a.wave === 'number' && a.wave >= 0 ? a.wave : null;
        addManager(a.agent, a.feature, true, a.seen, null, w);
    }
    /* every manager the plan lays out — one per wave with work, or one for
     * the feature — so the tree shows the shape before anyone starts */
    for (const pm of shape.managers) {
        if (!pm.agent) continue;
        const known = [...managers.values()].some((m) =>
            m.agent === pm.agent ||
            (m.feature === plan.feature && m.wave === pm.wave));
        if (!known) addManager(pm.agent, plan.feature, false, seenOf(pm.agent),
                               null, pm.wave);
    }

    /* Workers: the live ones, plus every wave the plan lays out, so an empty
     * wave still shows its branch and its tasks. */
    const workers = new Map();
    const addWorker = (agent, feat, wave, live, seen, tf) => {
        if (!agent) return null;
        if (workers.has(agent)) {
            const w = workers.get(agent);
            if (live && !w.live) { w.live = true; w.seen = seen; w.age = relAge(seen, now); }
            return w;
        }
        const planWave = planOf.get(agent) ||
            (wave === null || wave === undefined ? null : waveOf.get(wave)) ||
            null;
        const claim = (claimsBy.get(agent) || [])[0];
        /* The registry row a worker registers with carries no branch until an
         * attempt fills it in, so an empty field in the tree is a gap to fill,
         * not an answer. */
        const branch = (tf && tf.branch) || (claim && claim.branch) ||
            (planWave && planWave.branch) || null;
        const base = (tf && tf.base) || (planWave && planWave.base) ||
            (feat ? `feature/${feat}` : mainBranch);
        const row = branch ? reg.get(branch) : null;
        /* a heartbeat is the fresher of the two clocks an agent writes */
        const beat = Math.max((tf && tf.heartbeat) || 0, seen || 0) || null;
        const node = {
            kind: 'worker', agent, role: 'worker',
            feature: feat || null,
            wave: wave === undefined ? null : wave,
            live, seen: beat, age: relAge(beat, now),
            branch, base,
            merge: mergeState(branch, base, reg, exists),
            worktree: (tf && tf.worktree) || (claim && claim.worktree) ||
                (row && row.worktree) || null,
            attempt: (tf && tf.attempt) || (claim && claim.attempt_id) || null,
            state: (tf && tf.state) || null,
            host: (claim && claim.host) || null,
            tasks: waveTasks(agent, planWave, live, tf && tf.task),
            children: [],
        };
        workers.set(agent, node);
        return node;
    };
    for (const w of facts ? facts.workers : []) {
        const live = (w.heartbeat || w.seen || 0) > 0 ||
            agents.some((a) => a.agent === w.agent);
        addWorker(w.agent, w.feature || feature, w.wave, live,
                  w.seen || seenOf(w.agent), w);
    }
    for (const a of agents) {
        if (a.role === 'worker') addWorker(a.agent, a.feature, a.wave, true, a.seen);
    }
    for (const w of shape.workers) {
        if (!w.agent) continue;
        const live = w.live.filter((n) => workers.has(n) ||
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
     * owns its wave (or its whole feature), else Main. */
    const managerFor = (feat, wave) => {
        const ms = [...managers.values()].filter((m) => m.feature && m.feature === feat);
        return ms.find((m) => m.wave !== null && m.wave === wave) ||
            ms.find((m) => m.wave === null) || ms[0];
    };
    const orphans = [];
    for (const w of workers.values()) {
        const row = agents.find((a) => a.agent === w.agent);
        const claim = (claimsBy.get(w.agent) || [])[0];
        const parent = treeParent.get(w.agent) ||
            (row && row.parent) || (claim && claim.parent) ||
            hint.parents.get(w.agent) ||
            (managerFor(w.feature, w.wave) && managerFor(w.feature, w.wave).agent) ||
            mainName;
        w.parent = parent;
        const m = managers.get(parent);
        if (m) m.children.push(w);
        else orphans.push(w);
    }
    for (const m of managers.values()) {
        m.parent = treeParent.get(m.agent) || mainName;
        m.children.sort((a, b) => (a.wave === b.wave)
            ? String(a.agent).localeCompare(String(b.agent))
            : Number(a.wave === null ? 1e9 : a.wave) -
              Number(b.wave === null ? 1e9 : b.wave));
    }
    const managerList = [...managers.values()]
        .sort((a, b) => String(a.feature || a.agent)
            .localeCompare(String(b.feature || b.agent)) ||
            Number(a.wave === null ? -1 : a.wave) -
            Number(b.wave === null ? -1 : b.wave));

    const main = {
        kind: 'main', agent: mainName, role: 'main', feature: null, wave: null,
        live: !!mainRow, seen: mainRow ? mainRow.seen : null,
        age: relAge(mainRow ? mainRow.seen : null, now),
        branch: mainBranch, base: null,
        merge: mergeState(mainBranch, null, reg, exists),
        worktree: (facts && facts.main.worktree) ||
            (reg.get(mainBranch) ? reg.get(mainBranch).worktree : null),
        remote: hierarchy.remote,
        tasks: tasksOf(mainName),
        children: managerList.concat(orphans),
    };
    const everyone = [main, ...managerList, ...workers.values()];
    return {
        hierarchy,
        /* 'tree' means cg walked the hierarchy itself and this is its answer;
         * 'composed' means we joined it from the other reports. */
        source: facts ? 'tree' : 'composed',
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

/* ---------------- native sessions (codify-v15 2.3, pure) ----------------
 *
 * The host's own agents — a Claude Code or Codex session and the subagents
 * it spawned through its Agent tool — as `cg hook event` recorded them.
 * `cg fleet tree --json` (and `cg fleet status --json`) carry them as
 *
 *   native: [{agent, host, session, model, started, state, stale, seen, cwd,
 *             worktree, branch, task, task_source, description, agent_type,
 *             parent, depth, last_tool, tool_calls, ended, transcript,
 *             children: [...]}]
 *
 * nativeNodes() turns that into the Sessions root: a session per host
 * session, its subagents nested. They are not fleet roles — nobody planned
 * them — so they sit beside Main Gideon rather than under it. State is the
 * row's own (live, pending, stopped) except that a live row cg marked stale,
 * or one silent past STALE_SEC by our clock, reads as stale. Merge state is
 * what the branch registry proves for the worktree branch against the base
 * it was registered with (the session's branch). */
function nativeNode(n, depth, ctx, rootTranscript) {
    const str = (v) => (typeof v === 'string' && v) ? v : null;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
    const seen = num(n.seen);
    const age = relAge(seen, ctx.now);
    const raw = str(n.state) || 'live';
    const state = raw === 'live' && (n.stale === true || age.stale) ? 'stale' : raw;
    const branch = str(n.branch);
    const row = branch ? ctx.reg.get(branch) : null;
    const base = (row && row.base) || null;
    const id = String(n.agent).slice(String(n.agent).lastIndexOf(':') + 1);
    /* a live subagent's transcript is reported only when it stops, but the
     * host writes it beside the session's: <session>/subagents/agent-<id> */
    let transcript = str(n.transcript);
    if (!transcript && depth > 0 && raw !== 'pending' && rootTranscript &&
        /\.jsonl$/.test(rootTranscript)) {
        transcript = `${rootTranscript.slice(0, -6)}/subagents/agent-${id}.jsonl`;
    }
    const node = {
        kind: depth ? 'subagent' : 'session',
        agent: n.agent, host: str(n.host), session: str(n.session),
        model: str(n.model), state, rawState: raw,
        started: num(n.started), seen, age, ended: num(n.ended),
        cwd: str(n.cwd), worktree: str(n.worktree), branch, base,
        merge: branch ? mergeState(branch, base, ctx.reg, ctx.exists)
                      : { state: 'none', label: '' },
        task: str(n.task), taskSource: str(n.task_source),
        description: str(n.description), agentType: str(n.agent_type),
        parent: str(n.parent), depth: num(n.depth) === null ? depth : n.depth,
        lastTool: str(n.last_tool), toolCalls: num(n.tool_calls) || 0,
        lastMessage: str(n.last_message),
        transcript, children: [],
    };
    const rt = depth ? rootTranscript : str(n.transcript);
    for (const c of Array.isArray(n.children) ? n.children : []) {
        if (c && typeof c === 'object' && typeof c.agent === 'string') {
            const k = nativeNode(c, depth + 1, ctx, rt);
            k.parent = k.parent || node.agent;
            node.children.push(k);
        }
    }
    return node;
}

/* sessions, live and stale rows, subagents still running, worktree branches */
function nativeCounts(nodes) {
    const c = { sessions: 0, live: 0, stale: 0, stopped: 0, subagents: 0,
                worktrees: 0 };
    const branches = new Set();
    const walk = (n) => {
        if (n.kind === 'session') c.sessions += 1;
        else if (n.state === 'live' || n.state === 'stale') c.subagents += 1;
        if (n.state === 'live') c.live += 1;
        if (n.state === 'stale') c.stale += 1;
        if (n.state === 'stopped') c.stopped += 1;
        if (n.worktree && n.branch) branches.add(n.branch);
        for (const k of n.children) walk(k);
    };
    for (const n of nodes) walk(n);
    c.worktrees = branches.size;
    return c;
}

/* `native` is the tree's native[] (anything else is no sessions); opts are
 * {now, branches (cg branches --json), exists}. */
function nativeNodes(native, opts) {
    const o = opts || {};
    const reg = new Map();
    const bl = o.branches && Array.isArray(o.branches.branches) ? o.branches.branches : [];
    for (const b of bl) if (b && b.name) reg.set(b.name, b);
    const ctx = { now: o.now || Math.floor(Date.now() / 1000), reg,
                  exists: o.exists || null };
    const nodes = [];
    for (const n of Array.isArray(native) ? native : []) {
        if (n && typeof n === 'object' && typeof n.agent === 'string') {
            nodes.push(nativeNode(n, 0, ctx, null));
        }
    }
    return { nodes, counts: nativeCounts(nodes), ctx };
}

/* Fold the serve reducer's rows (serve.js applyNative: model.native, the
 * latest row per agent) onto the Sessions model in place, so an
 * agent.native.* event moves its row at once; the catch-up refresh that
 * follows replaces the whole model with cg's answer. A row older than the
 * model's is skipped; one the model has never seen is added under its
 * parent, or as a new session. Returns the number of rows patched or added. */
function patchSessions(sessions, liveNative, now) {
    if (!sessions || !liveNative) return 0;
    const ctx = Object.assign({}, sessions.ctx,
        { now: now || Math.floor(Date.now() / 1000) });
    const index = new Map();
    const walk = (n) => { index.set(n.agent, n); n.children.forEach(walk); };
    sessions.nodes.forEach(walk);
    const rows = Object.values(liveNative)
        .filter((r) => r && typeof r.agent === 'string')
        .sort((a, b) => (a.depth || 0) - (b.depth || 0) || (a.seq || 0) - (b.seq || 0));
    let changed = 0;
    for (const r of rows) {
        const have = index.get(r.agent);
        if (have && have.seen && r.seen && r.seen < have.seen) continue;
        const parent = r.parent ? index.get(r.parent) : null;
        const depth = have ? (have.kind === 'session' ? 0 : have.depth || 1)
            : parent ? (parent.kind === 'session' ? 1 : (parent.depth || 1) + 1) : 0;
        let rootT = null;
        for (let p = have && have.parent ? index.get(have.parent) : parent; p;
             p = p.parent ? index.get(p.parent) : null) {
            if (p.kind === 'session') { rootT = p.transcript; break; }
        }
        const merged = have ? {
            agent: have.agent, host: have.host, session: have.session,
            model: have.model, started: have.started, state: have.rawState,
            seen: have.seen, cwd: have.cwd, worktree: have.worktree,
            branch: have.branch, task: have.task, task_source: have.taskSource,
            description: have.description, agent_type: have.agentType,
            parent: have.parent, depth: have.depth, last_tool: have.lastTool,
            tool_calls: have.toolCalls, ended: have.ended,
            transcript: have.transcript, last_message: have.lastMessage,
        } : {};
        for (const [k, v] of Object.entries(r)) {
            if (v !== undefined && v !== null && v !== '' && k !== 'seq') merged[k] = v;
        }
        if (merged.state === 'live') merged.ended = null;
        const fresh = nativeNode(merged, depth, ctx, rootT);
        if (have) {
            fresh.children = have.children;
            Object.assign(have, fresh);
        } else {
            if (parent) parent.children.push(fresh);
            else sessions.nodes.push(fresh);
            index.set(fresh.agent, fresh);
        }
        changed += 1;
    }
    sessions.counts = nativeCounts(sessions.nodes);
    return changed;
}

/* ---------------- the Start flow (headless-safe) ----------------
 *
 * What a person sees before the fleet starts: the roles and what each may
 * spend, the agents and branches the plan would spawn (cg's own dry run),
 * the tasks that would collide and so run one after the other, and what is
 * already running. One markdown document, built from cg's JSON. */
function startPlan(input) {
    const i = input || {};
    const roles = i.roles || {};
    const lines = [];
    const feature = i.feature || (i.dryRun && /feature (\S+)/.exec(i.dryRun) || [])[1] || '';
    lines.push(`# Start the fleet${feature ? ` — ${feature}` : ''}`, '');
    const warnings = [];
    if (roles.configured === false) warnings.push('spec/workflow.kvx has no [hierarchy] — the fleet cannot start');
    else if (roles.enabled === false) warnings.push('[hierarchy] is disabled (enabled = false)');
    for (const p of roles.problems || []) warnings.push(p);
    const open = (i.runs || []).filter((r) => ['running', 'paused', 'draining', 'stopping'].includes(r.state));
    for (const r of open) warnings.push(`run ${r.run} (${r.feature}) is ${r.state}${r.supervisor ? ' with a live supervisor — stop it first' : ' with no supervisor — `Resume` continues it'}`);
    if (warnings.length) {
        lines.push('## Before you start', '');
        for (const w of warnings) lines.push(`- ⚠ ${w}`);
        lines.push('');
    }
    lines.push('## Roles', '', '| role | agent | branch | driver | model | max | wall | spend | retries | stall | approve |', '|---|---|---|---|---|---|---|---|---|---|---|');
    const secs = (s) => !s ? '—' : s % 3600 === 0 ? `${s / 3600}h` : s % 60 === 0 ? `${s / 60}m` : `${s}s`;
    for (const r of roles.roles || []) {
        const c = r.caps || {};
        lines.push(`| ${r.name} | ${r.agent} | ${r.branch} | ${c.driver || ''} | ${c.model || '—'} | ${c.max ?? ''} | ${secs(c.wall_s)} | ${c.spend_usd ? '$' + c.spend_usd.toFixed(2) : '—'} | ${c.retries ?? ''} | ${secs(c.stall_s)} | ${(c.approve || []).join(', ') || '—'} |`);
    }
    lines.push('');
    if (roles.test_gate || roles.lint_gate) {
        lines.push(`Gates: test \`${roles.test_gate || '—'}\`, lint \`${roles.lint_gate || '—'}\`; pull requests ${roles.pr || 'auto'}.`, '');
    }
    lines.push('## What would be spawned', '');
    if (i.dryRun && i.dryRun.trim()) {
        lines.push('```', ...i.dryRun.trimEnd().split('\n'), '```', '');
    } else {
        lines.push('_cg spec run --fleet --dry-run printed nothing_', '');
    }
    const coll = (i.collisions && i.collisions.collisions) || [];
    lines.push('## Predicted collisions', '');
    if (!coll.length) lines.push('None — every open task may run beside the others.', '');
    else {
        lines.push('These run one after the other instead of at once:', '');
        for (const c of coll) lines.push(`- ${c.a} and ${c.b}: ${c.why}`);
        lines.push('');
    }
    const workers = (roles.roles || []).find((r) => r.name === 'worker');
    const slots = i.slots || (workers && workers.caps && workers.caps.max) || 2;
    lines.push('## Command', '', '```', `cg fleet up -n ${slots}${feature ? ` -f ${feature}` : ''}${i.all ? ' --all' : ''}`, '```', '',
               'The supervisor runs detached: it survives this window, and `cg fleet up --resume` continues it after a crash. Stop, Pause and Resume are on the fleet view while it runs.');
    return { markdown: lines.join('\n'), warnings, canStart: roles.configured !== false && roles.enabled !== false && !open.some((r) => r.supervisor), slots, feature };
}

/* What the events say about each live agent and task, folded onto the tree
 * cg drew: the last thing it said or did, what it has spent, whether it was
 * nudged, restarted, or stopped, and what waits for a person. `live` is the
 * extension's live model (serve.js applyEvent); `events` the recent
 * supervisor.* and orch.* rows; `approvals` cg fleet approvals --json. */
function liveDecorate(model, input) {
    if (!model) return model;
    const i = input || {};
    const agents = (i.live && i.live.agents) || {};
    const byTask = new Map();
    for (const ev of i.events || []) {
        const p = ev.payload || {};
        const key = ev.subject || '';
        const b = byTask.get(key) || { attempts: 0, nudges: 0, stopped: null, escalated: null, blocked: false };
        if (ev.kind === 'orch.spawn' && p.role === 'worker') b.attempts += 1;
        if (ev.kind === 'supervisor.stall' && p.action === 'nudge') b.nudges += 1;
        if ((ev.kind === 'supervisor.stall' || ev.kind === 'supervisor.budget') && p.action === 'stop') b.stopped = p.reason;
        if (ev.kind === 'supervisor.escalate') b.escalated = p.to;
        if (ev.kind === 'supervisor.blocked') b.blocked = true;
        byTask.set(key, b);
    }
    const walk = (n) => {
        if (!n) return;
        const a = agents[n.agent];
        if (a) {
            if (a.last) n.step = String(a.last).split('\n')[0].slice(0, 80);
            if (a.cost !== undefined) n.cost = a.cost;
            if (a.tokens_in !== undefined) n.tokens = { in: a.tokens_in, out: a.tokens_out };
        }
        for (const t of n.tasks || []) {
            const b = byTask.get(`${n.feature || (model.feature || '')}/${t.id}`);
            if (b) {
                t.attempts = b.attempts;
                t.nudged = b.nudges > 0;
                t.stopped = b.stopped;
                t.escalated = b.escalated;
                t.blocked = b.blocked;
            }
        }
        for (const c of n.children || []) walk(c);
    };
    walk(model.main);
    model.approvals = ((i.approvals && i.approvals.approvals) || []).filter((a) => a.state === 'pending');
    model.runs = (i.runs && i.runs.runs) || [];
    model.run = model.runs.find((r) => ['running', 'paused', 'draining', 'stopping'].includes(r.state)) || null;
    return model;
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

/* A manager with a wave is that wave's manager; a worker on one task is a
 * task worker. Without either it is the older shape's role. */
function roleTitle(n) {
    if (n.kind === 'manager' && n.wave !== null && n.wave !== undefined) {
        return 'Wave Manager';
    }
    if (n.kind === 'worker' && n.tasks && n.tasks.length === 1 && n.branch &&
        n.branch.indexOf(n.tasks[0].id) >= 0) return 'Task Worker';
    return ROLE_TITLE[n.role] || 'agent';
}

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
 * wave workers under them, and each worker's tasks and any pull request it
 * reported under that.
 *
 * It owns no clock. One pass of its cg calls — fleet status, spec status (the
 * board's, handed over rather than asked for twice), branches, fleet plan and,
 * once per window, fleet tree — runs inside the extension's single refresh
 * scheduler, and only while the view is visible, so a collapsed fleet costs
 * nothing. Every one of those calls is raced against CALL_TIMEOUT_MS, and the
 * loading, error and unconfigured states each render something the user can
 * act on, so the view cannot sit on a spinner. */
/* codify-v15 3.3: the Projection node's model, from `projection` in cg fleet
 * tree --json. Each finding names its branches, and each branch the file in
 * its own worktree (null when cg knows no worktree for it); `badges` is the
 * live finding count per branch, for the rows that own those branches. */
function projectionNodes(proj, now) {
    if (!proj) return null;
    const trees = {};
    const badges = {};
    for (const b of proj.branches || []) {
        trees[b.name] = b.worktree || null;
        if (b.findings) badges[b.name] = b.findings;
    }
    const findings = (proj.findings || []).map((f) => ({
        kind: f.kind,
        path: f.path,
        symbol: f.symbol || null,
        advice: f.advice || '',
        lines: f.lines || '',
        branches: (f.branches || []).map((name) => ({
            name,
            worktree: trees[name] || null,
            open: trees[name] && f.path ? path.join(trees[name], f.path) : null,
        })),
    }));
    return {
        commit: proj.commit || null,
        built: proj.built || 0,
        age: relAge(proj.built, now),
        folded: proj.folded || 0,
        count: proj.count !== undefined ? proj.count : findings.length,
        findings,
        badges,
    };
}

function findingBadge(projection, branch) {
    const n = projection && branch ? projection.badges[branch] : 0;
    return n ? `${n} finding${n === 1 ? '' : 's'}` : null;
}

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
        this.sessions = null;         /* codify-v15 2.3: the Sessions root */
        this.projection = null;       /* codify-v15 3.3: the Projection root */
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
        this.sessions = await this.nativeModel(status, tree, branches, call);
        this.projection = projectionNodes(tree && tree.projection);
        /* v11: what the supervisor and the agents have been doing */
        if (configured) {
            const runs = await call(['fleet', 'runs']);
            const approvals = await call(['fleet', 'approvals']);
            let events = [];
            const evr = await this.deps.cg(['events', '--kind', 'supervisor.,orch.spawn', '-n', '300', '--json']);
            if (evr && evr.code === 0) {
                events = evr.stdout.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
            }
            liveDecorate(this.model, { live: this.deps.live && this.deps.live(), events, runs, approvals });
            this.hasRuns = !!runs;
        }
        this.state = 'ready';
        this._done();
    }

    _done() {
        this._em.fire();
        const m = this.model;
        if (this.view) {
            const run = m && m.run;
            this.view.description = m && m.hierarchy.configured
                ? (run ? `${run.state}${run.supervisor ? '' : ' · no supervisor'} · ` : '') +
                  `${m.counts.live} live` +
                  (m.counts.stale ? ` · ${m.counts.stale} stale` : '') +
                  (m.approvals && m.approvals.length ? ` · ${m.approvals.length} waiting for you` : '')
                : undefined;
        }
        vscode.commands.executeCommand('setContext', 'codify.fleet',
            !!(m && m.hierarchy.configured));
        vscode.commands.executeCommand('setContext', 'codify.fleet.running',
            !!(m && m.run && m.run.supervisor && m.run.state !== 'paused'));
        vscode.commands.executeCommand('setContext', 'codify.fleet.paused',
            !!(m && m.run && (m.run.state === 'paused' || !m.run.supervisor)));
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
        const sessions = this.sessionsRoot();
        if (!m || !m.hierarchy.configured) return sessions ? [sessions] : [];
        const top = [];
        /* what waits for a person comes first: nothing below moves until
         * it is decided */
        for (const a of m.approvals || []) top.push(this.approvalItem(a));
        top.push(this.nodeItem(m.main));
        if (sessions) top.push(sessions);
        const projection = this.projectionRoot();
        if (projection) top.push(projection);
        return top;
    }

    /* ---- the projection's findings (codify-v15 3.3) ---- */

    /* Every finding with the branches it involves; a branch row opens the
     * file in that branch's worktree. Absent until a build has run. */
    projectionRoot() {
        const p = this.projection;
        if (!p) return null;
        const kids = p.findings.map((f, i) => this.findingItem(f, i));
        const it = new vscode.TreeItem('Projection', kids.length
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None);
        it.id = 'fleet:projection';
        it.childItems = kids;
        it.node = p;
        it.description = `${p.count} finding${p.count === 1 ? '' : 's'} · ` +
            `${p.folded} branch${p.folded === 1 ? '' : 'es'} folded · built ${p.age.text}`;
        it.iconPath = new vscode.ThemeIcon('git-merge', p.count
            ? new vscode.ThemeColor('list.warningForeground') : undefined);
        it.tooltip = `refs/codify/projection${p.commit ? ` @ ${p.commit.slice(0, 12)}` : ''}` +
            ' — every branch in flight folded onto the base; cg projection status';
        it.contextValue = 'fleet-projection';
        return it;
    }

    findingItem(f, i) {
        const kids = f.branches.map((b) => this.findingBranchItem(f, b, i));
        const label = `${f.kind} ${f.symbol ? `${f.symbol} in ` : ''}${f.path}`;
        const it = new vscode.TreeItem(label, kids.length
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None);
        it.id = `fleet:projection:${i}:${f.kind}:${f.path}`;
        it.childItems = kids;
        it.node = f;
        it.description = f.branches.map((b) => b.name).join(', ');
        it.tooltip = [f.advice, f.lines].filter(Boolean).join('\n');
        it.iconPath = new vscode.ThemeIcon('warning',
            new vscode.ThemeColor('list.warningForeground'));
        it.contextValue = 'fleet-finding';
        const first = f.branches.find((b) => b.open);
        if (first) {
            it.command = { command: 'vscode.open', title: 'Open file',
                           arguments: [vscode.Uri.file(first.open)] };
        }
        return it;
    }

    findingBranchItem(f, b, i) {
        const it = new vscode.TreeItem(b.name, vscode.TreeItemCollapsibleState.None);
        it.id = `fleet:projection:${i}:${f.kind}:${f.path}:${b.name}`;
        it.childItems = [];
        it.node = b;
        it.description = b.worktree || 'no worktree';
        it.iconPath = new vscode.ThemeIcon('git-branch');
        it.contextValue = 'fleet-finding-branch';
        if (b.open) {
            it.tooltip = b.open;
            it.command = { command: 'vscode.open', title: 'Open file',
                           arguments: [vscode.Uri.file(b.open)] };
        }
        return it;
    }

    /* ---- native sessions (codify-v15 2.3) ---- */

    /* The Sessions model from what this refresh already read: the tree's
     * native[] when cg drew one, else fleet status's (a repository without
     * a [hierarchy] has only that). Branch merge state needs the registry,
     * read here only when a native agent works on a branch and the fleet
     * pass did not read it already. */
    async nativeModel(status, tree, branches, call) {
        const native = (tree && Array.isArray(tree.native)) ? tree.native
            : (status && Array.isArray(status.native)) ? status.native : [];
        if (!native.length) return null;
        let reg = branches;
        const anyBranch = JSON.stringify(native).includes('"branch":"');
        if (!reg && anyBranch && call) reg = await call(['branches']);
        return nativeNodes(native, { branches: reg, exists: (p) => {
            try { return fs.existsSync(p); } catch { return true; }
        } });
    }

    /* agent.native.* arrived: fold the serve reducer's rows onto the model
     * and redraw now; the catch-up refresh replaces it with cg's answer. */
    patchLive() {
        const live = this.deps && this.deps.live ? this.deps.live() : null;
        if (!live || !live.native || !Object.keys(live.native).length) return 0;
        if (!this.sessions) this.sessions = nativeNodes([], {});
        const n = patchSessions(this.sessions, live.native);
        if (n) this._em.fire();
        return n;
    }

    sessionsRoot() {
        const s = this.sessions;
        if (!s || !s.nodes.length) return null;
        const kids = s.nodes.map((n) => this.sessionItem(n));
        const it = new vscode.TreeItem('Sessions',
            vscode.TreeItemCollapsibleState.Expanded);
        it.id = 'fleet:native';
        it.childItems = kids;
        const c = s.counts;
        it.description = `${c.live} live` +
            (c.stale ? ` · ${c.stale} stale` : '') +
            ` · ${c.subagents} subagent${c.subagents === 1 ? '' : 's'}` +
            (c.worktrees ? ` · ${c.worktrees} worktree branch${c.worktrees === 1 ? '' : 'es'}` : '');
        it.iconPath = new vscode.ThemeIcon('hubot');
        it.contextValue = 'fleet-native-root';
        it.tooltip = 'Claude Code and Codex sessions on this project and the ' +
            'subagents they spawned, from `cg hook event`';
        return it;
    }

    /* One native agent: who (the session, or the subagent's type), its
     * state and age since the last hook, its worktree branch and whether
     * that is in its base, its task and where the task came from, and the
     * last tool it ran. */
    sessionItem(n) {
        const kids = n.children.map((c) => this.sessionItem(c));
        const label = n.kind === 'session' ? n.agent
            : `${n.agentType || 'subagent'}${n.description ? ` — ${n.description}` : ''}`;
        const it = new vscode.TreeItem(label, kids.length
            ? (n.state === 'stopped' ? vscode.TreeItemCollapsibleState.Collapsed
                                     : vscode.TreeItemCollapsibleState.Expanded)
            : vscode.TreeItemCollapsibleState.None);
        it.id = `fleet:native:${n.agent}`;
        it.childItems = kids;
        it.node = n;
        const bits = [n.state, n.age.text];
        if (n.branch) {
            bits.push(n.branch + (n.merge.state === 'unmerged' ? ' (unmerged)'
                : n.merge.state === 'in-sync' ? ' (merged)' : ''));
        }
        if (n.merge.worktreeMissing) bits.push('worktree gone');
        if (n.task) bits.push(`task ${n.task}${n.taskSource ? ` (${n.taskSource})` : ''}`);
        if (n.lastTool) bits.push(`› ${n.lastTool}`);
        const nfs = findingBadge(this.projection, n.branch);
        if (nfs) bits.push(nfs);
        it.description = bits.join(' · ');
        const icon = n.kind === 'session' ? 'terminal' : 'person';
        const color = n.state === 'live' ? 'testing.iconPassed'
            : n.state === 'stale' ? 'list.warningForeground' : null;
        it.iconPath = color ? new vscode.ThemeIcon(icon, new vscode.ThemeColor(color))
                            : new vscode.ThemeIcon(icon);
        it.contextValue = `fleet-native-${n.kind}` +
            (n.worktree ? '-nwt' : '') + (n.transcript ? '-ntx' : '');
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${n.agent}** — ${n.kind === 'session' ? 'session' : 'subagent'}` +
            `${n.host ? ` on ${n.host}` : ''}\n\n`);
        if (n.parent) md.appendMarkdown(`spawned by \`${n.parent}\`\n\n`);
        if (n.model) md.appendMarkdown(`model ${n.model}\n\n`);
        md.appendMarkdown(`${n.state} · last hook ${n.age.text}` +
            (n.toolCalls ? ` · ${n.toolCalls} tool call${n.toolCalls === 1 ? '' : 's'}` : '') + '\n\n');
        if (n.branch) {
            md.appendMarkdown(`branch \`${n.branch}\`` +
                (n.base ? ` from \`${n.base}\`` : '') +
                (n.merge.label ? ` — ${n.merge.label}` : '') + '\n\n');
        }
        if (n.worktree) md.appendMarkdown(`worktree \`${n.worktree}\`\n\n`);
        else if (n.cwd) md.appendMarkdown(`cwd \`${n.cwd}\`\n\n`);
        if (n.task) md.appendMarkdown(`task ${n.task} (from ${n.taskSource || '?'})\n\n`);
        if (n.lastMessage) md.appendMarkdown(`> ${n.lastMessage.split('\n')[0]}\n\n`);
        if (n.transcript) md.appendMarkdown(`transcript \`${n.transcript}\``);
        it.tooltip = md;
        if (n.transcript) {
            it.command = { command: 'codify.fleet.openSessionTranscript',
                           title: 'Open transcript', arguments: [{ node: n }] };
        }
        return it;
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

    /* One agent — main, manager, or worker — and, under it, the agents that
     * report to it. The row reads the way the fleet is organised: who this is,
     * the branch it owns, how much of its subtree is done, how long ago it was
     * heard from, and whether its branch is still unmerged or its worktree has
     * gone. Whether it is merged is cg's own verdict when the tree gave one
     * and the branch registry's inference otherwise, and progress appears at
     * all only when cg counted it. */
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
        if (n.kind !== 'worker') bits.push(roleTitle(n));
        if (n.wave !== null && n.wave !== undefined &&
            n.kind !== 'main') bits.push(`wave ${n.wave}`);
        if (n.branch) bits.push(n.branch);
        if (n.note) bits.push(n.note);
        if (n.progress && n.progress.total) {
            bits.push(`${n.progress.done}/${n.progress.total} done` +
                (n.progress.claimed ? ` · ${n.progress.claimed} running` : ''));
        }
        if (n.state && n.state !== 'idle' && n.state !== 'running') bits.push(n.state);
        if (n.cost !== undefined && n.cost !== null) bits.push(`$${Number(n.cost).toFixed(2)}`);
        if (n.live) bits.push(n.age.text + (n.age.stale ? ' · stale' : ''));
        else bits.push('not started');
        if (n.step) bits.push(`› ${n.step}`);
        /* cg's own verdict when it gave one, the registry's otherwise */
        if (n.merged === false || (n.merged === undefined &&
                                   n.merge && n.merge.state === 'unmerged')) {
            bits.push('unmerged');
        }
        if (n.merge && n.merge.worktreeMissing) bits.push('worktree gone');
        const nf = findingBadge(this.projection, n.branch);
        if (nf) bits.push(nf);
        it.description = bits.join(' · ');
        it.iconPath = this.agentIcon(n);
        it.tooltip = this.agentTooltip(n);
        it.contextValue = `fleet-${n.kind}` +
            (n.worktree ? '-worktree' : '') +
            (n.kind === 'worker' && n.tasks && n.tasks.length ? '-tasks' : '');
        /* a click opens what the agent has said and done */
        it.command = { command: 'codify.fleet.openTranscript', title: 'Open transcript',
                       arguments: [{ node: n }] };
        return it;
    }

    approvalItem(a) {
        const it = new vscode.TreeItem(`#${a.id} ${a.gate} of ${a.subject}`);
        it.id = `fleet:approval:${a.id}`;
        it.description = `asked by ${a.requested_by || '?'} — click to decide`;
        it.iconPath = new vscode.ThemeIcon('shield', new vscode.ThemeColor('list.warningForeground'));
        it.contextValue = 'fleet-approval';
        it.command = { command: 'codify.fleet.approve', title: 'Decide', arguments: [{ approval: a }] };
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
        md.appendMarkdown(`**${n.agent}** — ${roleTitle(n)}\n\n`);
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
        /* only cg's own tree can say these, so they simply do not show on an
         * older binary rather than being guessed at */
        if (n.progress) {
            md.appendMarkdown(`${n.progress.done}/${n.progress.total} tasks done` +
                ` · ${n.progress.claimed} running` +
                (n.complete ? ' · **subtree complete**' : '') + '\n\n');
        }
        if (n.ahead !== null && n.ahead !== undefined && n.base) {
            md.appendMarkdown(n.ahead
                ? `${n.ahead} commit${n.ahead === 1 ? '' : 's'} ahead of ` +
                  `\`${n.base}\`\n\n`
                : `nothing to merge into \`${n.base}\`\n\n`);
        }
        if (n.state) md.appendMarkdown(`attempt state ${n.state}\n\n`);
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

    taskBadges(t) {
        const b = [];
        if (t.attempts > 1) b.push(`attempt ${t.attempts}`);
        if (t.nudged) b.push('nudged');
        if (t.stopped) b.push(`stopped: ${t.stopped}`);
        if (t.escalated) b.push(`escalated to ${t.escalated}`);
        if (t.blocked) b.push('blocked');
        return b;
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
        bits.push(...this.taskBadges(t));
        it.description = bits.join(' · ');
        const [icon0, color0] = STATUS_ICON[t.status] || STATUS_ICON.pending;
        const icon = t.blocked ? 'error' : t.stopped || t.nudged ? 'warning' : icon0;
        const color = t.blocked ? 'list.errorForeground'
            : t.stopped || t.nudged ? 'list.warningForeground' : color0;
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
        : `task ${id}'s branch into its manager's branch`;
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

/* A wave manager's node lands (or opens the pull request for) its wave;
 * anything else, the feature. */
function landTarget(node, feature) {
    const wave = node && node.kind === 'manager' &&
        node.wave !== null && node.wave !== undefined ? node.wave : null;
    return wave === null
        ? { what: [feature], label: (node && node.kind === 'manager' &&
              node.branch) || `feature/${feature}` }
        : { what: [String(wave), '-f', feature],
            label: node.branch || `wave/${feature}/${wave}` };
}

async function cmdLand(arg) {
    const node = view.nodeOf(arg);
    const feature = featureOf(node);
    if (!feature) {
        vscode.window.showInformationMessage('No active feature to land.');
        return;
    }
    const target = landTarget(node, feature);
    const main = view.model ? view.model.hierarchy.main : 'main';
    const ok = await vscode.window.showWarningMessage(
        `Land ${target.label} into ${main}?`,
        { modal: true, detail: 'The gates run first. If one is red, ' +
            `${main} is reset to where it was and nothing lands. On green, ` +
            'the pull request policy decides whether a PR is opened.' },
        'Land', 'Land without a pull request');
    if (!ok) return;
    const args = ['fleet', 'land', ...target.what, '--json'];
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
    const node = view.nodeOf(arg);
    const feature = featureOf(node);
    if (!feature) {
        vscode.window.showInformationMessage('No active feature for a pull request.');
        return;
    }
    const target = landTarget(node, feature);
    const choice = await vscode.window.showWarningMessage(
        `Open the pull request for ${target.label}?`,
        { modal: true, detail: 'This pushes the feature branch to the remote ' +
            'and asks gh to open a pull request. A dry run only prints the ' +
            'commands it would run.' },
        'Open it', 'Dry run');
    if (!choice) return;
    const args = ['fleet', 'pr', ...target.what, '--json'];
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

/* ---------------- the Start flow ---------------- */

const START_SCHEME = 'codify-fleet-plan';
let planText = '';
let planEmitter = null;   /* created in register: vscode is absent headless */

async function cmdStart(arg) {
    const feature = arg && typeof arg === 'string' ? arg
        : arg && arg.feature ? arg.feature : undefined;
    const { cg, cgJson } = deps;
    const roles = await cgJson(['fleet', 'roles']);
    const dry = await cg(['spec', 'run', '--fleet', '--dry-run',
                          ...(feature ? ['-f', feature] : [])]);
    const collisions = await cgJson(['drift', 'collisions', ...(feature ? ['-f', feature] : [])]);
    const runs = await cgJson(['fleet', 'runs']);
    const plan = startPlan({ roles, dryRun: dry.stdout + (dry.code ? dry.stderr : ''),
                             collisions, runs: (runs && runs.runs) || [], feature });
    planText = plan.markdown;
    if (planEmitter) planEmitter.fire(vscode.Uri.parse(`${START_SCHEME}:/plan.md`));
    const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.parse(`${START_SCHEME}:/plan.md`));
    await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
    if (arg && arg.previewOnly) return;
    if (!plan.canStart) {
        vscode.window.showWarningMessage(
            `The fleet cannot start: ${plan.warnings[0] || 'see the plan'}`);
        return;
    }
    const slots = await vscode.window.showInputBox({
        prompt: 'Worker slots (agents writing code at once)',
        value: String(plan.slots), validateInput: (v) => /^\d+$/.test(v) && Number(v) > 0 ? null : 'a positive number',
    });
    if (!slots) return;
    const go = await vscode.window.showInformationMessage(
        `Start the fleet${plan.feature ? ` for ${plan.feature}` : ''} with ${slots} worker slot(s)?`,
        { modal: true, detail: 'A detached supervisor spawns the manager and workers and keeps them going until every task is qualified and merged. Stop, Pause and Resume are on the fleet view.' },
        'Start');
    if (go !== 'Start') return;
    const r = await run(['fleet', 'up', '-n', slots, ...(plan.feature ? ['-f', plan.feature] : []), '--json'], 'fleet up');
    const j = parse(r);
    if (j && j.run) {
        vscode.window.showInformationMessage(`Fleet up — run ${j.run}, supervisor pid ${j.pid}. Log: ${j.log}`);
    } else {
        vscode.window.showErrorMessage('cg fleet up refused — see the Codify output.');
    }
    view.force = true;
    await deps.refresh();
}

async function fleetControl(verb, label) {
    const r = await run(['fleet', verb, '--json'], `fleet ${verb}`);
    const j = parse(r);
    if (j && j.state) vscode.window.showInformationMessage(`Fleet ${label}: run ${j.run} is ${j.state}.`);
    else if (r.code !== 0) vscode.window.showErrorMessage(`cg fleet ${verb} failed — see the Codify output.`);
    view.force = true;
    await deps.refresh();
}

async function cmdStop() {
    const choice = await vscode.window.showWarningMessage(
        'Stop the fleet?',
        { modal: true, detail: 'Stop terminates the agents now and releases their claims; branches are kept. Drain lets the live agents finish first.' },
        'Stop now', 'Drain');
    if (!choice) return;
    const args = ['fleet', 'down', '--json'];
    if (choice === 'Drain') args.push('--drain');
    const r = await run(args, 'fleet down');
    const j = parse(r);
    if (j) vscode.window.showInformationMessage(`Fleet: run ${j.run} is ${j.state}.`);
    view.force = true;
    await deps.refresh();
}

/* the agent's log: what it said and did, as the driver wrote it */
async function cmdOpenTranscript(arg) {
    const n = arg && arg.node ? arg.node : null;
    const root = deps.workspaceRoot();
    if (!n || !root) return;
    const dir = path.join(root, '.codegraph', 'agents');
    let candidates = [];
    if (n.kind === 'main') candidates = ['main.log'];
    else if (n.kind === 'manager') candidates = [`${n.feature}-manager.log`];
    else {
        const ids = (n.tasks || []).map((t) => t.id);
        candidates = ids.map((id) => `${n.feature}-${id}.log`);
    }
    const found = candidates.map((f) => path.join(dir, f)).filter((p) => fs.existsSync(p));
    if (!found.length) {
        vscode.window.showInformationMessage(`${n.agent} has no transcript yet (${candidates.join(', ') || 'no task'}).`);
        return;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(found[found.length - 1]));
    await vscode.window.showTextDocument(doc, { preview: true });
}

async function cmdApprove(arg) {
    let a = arg && arg.approval ? arg.approval : null;
    if (!a) {
        const j = await deps.cgJson(['fleet', 'approvals']);
        const items = ((j && j.approvals) || []).map((x) => ({
            label: `#${x.id} ${x.gate} of ${x.subject}`, description: `asked by ${x.requested_by || '?'}`, a: x }));
        if (!items.length) { vscode.window.showInformationMessage('Nothing waits for approval.'); return; }
        const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Approval to decide' });
        if (!pick) return;
        a = pick.a;
    }
    const choice = await vscode.window.showWarningMessage(
        `Approval #${a.id}: ${a.gate} of ${a.subject}`,
        { modal: true, detail: `Requested by ${a.requested_by || 'an agent'}. Approve lets it go ahead once; Reject stops it and the agent reports to its parent.` },
        'Approve', 'Reject');
    if (!choice) return;
    const note = await vscode.window.showInputBox({ prompt: 'Note (optional)' });
    const args = ['fleet', 'approve', String(a.id), '--json'];
    if (choice === 'Reject') args.push('--reject');
    if (note) args.push('-m', note);
    await run(args, 'fleet approve');
    view.force = true;
    await deps.refresh();
}

/* ---- native sessions (codify-v15 2.3) ---- */

function sessionNodes() {
    const out = [];
    const walk = (n) => { out.push(n); n.children.forEach(walk); };
    if (view.sessions) view.sessions.nodes.forEach(walk);
    return out;
}

/* a native agent's worktree; from the palette, a pick of the ones that have one */
async function cmdOpenSessionWorktree(arg) {
    const n = view.nodeOf(arg);
    let dir = n && n.worktree;
    if (!dir) {
        const all = sessionNodes().filter((x) => x.worktree).map((x) => ({
            label: x.agent, description: x.branch || '', detail: x.worktree,
            dir: x.worktree }));
        if (!all.length) {
            vscode.window.showInformationMessage('No native agent works in a worktree.');
            return;
        }
        const pick = await vscode.window.showQuickPick(all,
            { placeHolder: 'Open which native agent worktree?' });
        if (!pick) return;
        dir = pick.dir;
    }
    await cmdOpenWorktree({ node: { worktree: dir } });
}

/* the transcript file the host writes (JSONL), opened as a document */
async function cmdOpenSessionTranscript(arg) {
    let n = view.nodeOf(arg);
    if (!n) {
        const all = sessionNodes().filter((x) => x.transcript).map((x) => ({
            label: x.agent, description: x.state, detail: x.transcript, n: x }));
        if (!all.length) {
            vscode.window.showInformationMessage('No native agent transcript is known yet.');
            return;
        }
        const pick = await vscode.window.showQuickPick(all,
            { placeHolder: 'Open which transcript?' });
        if (!pick) return;
        n = pick.n;
    }
    if (!n.transcript || !fs.existsSync(n.transcript)) {
        vscode.window.showInformationMessage(
            `${n.agent} has no transcript on disk${n.transcript ? ` (${n.transcript})` : ''}.`);
        return;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(n.transcript));
    await vscode.window.showTextDocument(doc, { preview: true });
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

    planEmitter = new vscode.EventEmitter();
    {
        ctx.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(START_SCHEME, {
            onDidChange: planEmitter.event,
            provideTextDocumentContent: () => planText,
        }));
    }
    const cmds = {
        'codify.fleet.start': cmdStart,
        'codify.fleet.stop': cmdStop,
        'codify.fleet.pause': () => fleetControl('pause', 'paused'),
        'codify.fleet.resume': () => fleetControl('resume', 'resumed'),
        'codify.fleet.openTranscript': cmdOpenTranscript,
        'codify.fleet.approve': cmdApprove,
        'codify.fleet.refresh': cmdRefresh,
        'codify.fleet.openWorktree': cmdOpenWorktree,
        'codify.fleet.begin': cmdBegin,
        'codify.fleet.mergeUp': cmdMergeUp,
        'codify.fleet.land': cmdLand,
        'codify.fleet.openPr': cmdOpenPr,
        'codify.fleet.checkpoint': cmdCheckpoint,
        'codify.fleet.openSessionWorktree': cmdOpenSessionWorktree,
        'codify.fleet.openSessionTranscript': cmdOpenSessionTranscript,
    };
    for (const [name, fn] of Object.entries(cmds)) {
        ctx.subscriptions.push(vscode.commands.registerCommand(name, fn));
    }

    return {
        refresh: (specStatus) => view.refresh(specStatus),
        /* a fleet event arrived: the next refresh redraws this view even
         * while it is hidden, so it is right the moment it is opened */
        touch: () => { view.force = true; view.patchLive(); },
        get visible() { return view.visible; },
    };
}

module.exports = { register, FleetView, fleetTree, relAge, mergeState,
                   treeFacts, parentsFromTree, startPlan, liveDecorate,
                   nativeNodes, patchSessions, projectionNodes, findingBadge };
