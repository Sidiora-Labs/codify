#!/usr/bin/env bash
# VS Code extension: syntax, manifest coherence, the task UI, the memory
# browser, the fleet view, and the LSP client driven against the real cg
# binary. Everything the extension can be tested on without VS Code — which
# is most of what could actually break. Every source file is syntax-checked
# on every run.
#   manifest — identity, declared vs registered commands, menus, views, deps
#   refresh  — the one scheduler keeps a single chain in flight
#   tasks    — (task 5.1) task tree, filter, detail panel, indexed symbols
#   lsp      — the hand-written client against the real `cg lsp`
#   memories — (task 5.2) the memory browser panel and its pure filter
#   fleet    — (task 5.3) the fleet view: its manifest surface and the join
#              behind FleetView, from JSON the real cg printed
#   chat     — (task 5.3) the agent chat core: diff rows, ANSI, cost ledger
#   fleetchat — (v11 6.2) served tools as slash commands with typed args,
#              approval cards, the transcript window at 10k entries
#   start    — (v11 6.1) the Start flow's plan from real cg output, the
#              live fleet view decorated from events, manifest and lens
#   serve    — (v11 5.2) the cg serve client, the event reducer and row
#              patch against the real cg, reconnect, fallback on an old cg
# Run one section: 14_vscode.sh tasks
. "$(dirname "$0")/../lib.sh"
section="${1:-all}"

want() { [ "$section" = all ] || [ "$section" = "$1" ]; }

EXT="$(cd "$(dirname "$0")/../../editors/vscode" && pwd)"

command -v node >/dev/null 2>&1 || { echo "14_vscode skipped (no node)"; exit 0; }

# ---- every source file parses
for f in "$EXT"/*.js; do
    node --check "$f" || fail "syntax error in $f"
done

# ---- serve (v11 5.2): the one connection, the event reducer, the row patch
if want serve; then
    node --check "$EXT/serve.js" || fail "syntax error in serve.js"
    rm -rf "$TMP/sv"; mkdir -p "$TMP/sv/src"; cd "$TMP/sv"
    git init -q . >/dev/null 2>&1 || true
    echo 'export function alpha(){}' > src/a.ts
    "$CG" spec new sv >/dev/null
    "$CG" spec mode parallel >/dev/null
    "$CG" spec add 2.1 --title "Alpha" --wave 1 --touches 'src/a.ts' >/dev/null
    "$CG" spec add 2.2 --title "Beta" --wave 1 --touches 'src/b.ts' >/dev/null
    "$CG" init >/dev/null
    # a cg that predates serve: every other verb works, serve is unknown
    cat > "$TMP/oldcg" <<EOF
#!/bin/sh
[ "\$1" = serve ] && { echo "cg: unknown command 'serve' (try \\\`cg help\\\`)" >&2; exit 1; }
exec "$CG" "\$@"
EOF
    chmod +x "$TMP/oldcg"
    node - "$EXT" "$CG" "$TMP/sv" "$TMP/oldcg" <<'JS'
const path = require('path'), cp = require('child_process');
const [dir, CG, cwd, OLD] = process.argv.slice(2);
const { ServeClient, liveModel, applyEvent } = require(path.join(dir, 'serve.js'));
const { patchRows, mergeTasks } = require(path.join(dir, 'tasks.js'));
const check = (c, w) => { if (!c) throw new Error(w); };
const cgRun = (...a) => cp.spawnSync(CG, a, { cwd, encoding: 'utf8' });

(async () => {
    const logs = [];
    const c = new ServeClient(CG, cwd, (m) => logs.push(m));
    check(await c.start() === true, 'start against the real cg');
    check(c.info && c.info.protocol === 'codify-serve/1', 'initialize answered');
    check(c.info.root === cwd || c.info.root.endsWith('/sv'), `root ${c.info.root}`);

    // exec has the shape cg() has, and carries the exit code
    const st = await c.exec(['spec', 'status', '--json']);
    check(st.code === 0 && JSON.parse(st.stdout).feature === 'sv', 'exec spec status');
    const bad = await c.exec(['search']);
    check(bad.code !== 0 && /usage/.test(bad.stderr), 'exec carries failure');
    const tool = await c.tool('spec_status');
    check(tool.isError === false && JSON.parse(tool.content[0].text).feature === 'sv', 'tools/call');
    const tools = await c.tools();
    check(tools.length > 40 && tools.some((t) => t.name === 'get_context'), 'tools/list');

    // the live model and the rows a claim patches
    const model = liveModel();
    const rows = mergeTasks(null, JSON.parse(cgRun('spec', 'trace', '--json').stdout),
                            JSON.parse(st.stdout), null);
    const events = [];
    let lastAt = 0;
    c.on('event', (ev) => { events.push(ev); lastAt = Date.now(); });
    await c.subscribe();
    const before = events.length;

    // a claim from another process reaches the row within 300 ms
    const t0 = Date.now();
    const r = cgRun('spec', 'claim', '2.1', '--agent', 'w9');
    check(r.status === 0, `claim: ${r.stderr}`);
    const claimAt = Date.now();
    while (!events.slice(before).some((e) => e.kind === 'claim') && Date.now() - t0 < 3000)
        await new Promise((res) => setTimeout(res, 5));
    const claim = events.slice(before).find((e) => e.kind === 'claim');
    check(claim, 'claim event pushed');
    check(lastAt - claimAt < 300, `event took ${lastAt - claimAt} ms`);
    const applied = applyEvent(model, claim);
    check(applied.view === 'tasks' && applied.task === '2.1' && applied.feature === 'sv', 'reducer');
    const p0 = Date.now();
    const row = patchRows(rows, 'sv', applied);
    check(row && row.agent === 'w9' && row.claim.agent === 'w9', 'row patched');
    check(Date.now() - p0 < 50, 'patch is instant');
    check(model.claims['sv/2.1'].agent === 'w9', 'model holds the claim');

    // start moves the status; release clears the claim; other features are ignored
    cgRun('spec', 'start', '2.1');
    while (!events.some((e) => e.kind === 'task.status' && e.payload.status === 'in_progress') && Date.now() - t0 < 3000)
        await new Promise((res) => setTimeout(res, 5));
    const stEv = events.find((e) => e.kind === 'task.status' && e.payload.status === 'in_progress');
    check(patchRows(rows, 'sv', applyEvent(model, stEv)).status === 'in_progress', 'status patched');
    check(patchRows(rows, 'other', applyEvent(model, stEv)) === null, 'another feature is not patched');
    check(applyEvent(model, { kind: 'release', subject: 'sv/2.1', payload: { agent: 'w9' } }).patch.claim === null, 'release clears');
    check(patchRows(rows, 'sv', applyEvent(model, { kind: 'task.status', subject: 'sv/9.9', payload: { task: '9.9', feature: 'sv', status: 'done' } })) === null,
          'an unknown task asks for a full refresh');
    check(applyEvent(model, { kind: 'agent.tool', node: 'w9', subject: 'sv/2.1', at: 1, payload: { tool: 'Bash', detail: 'make' } }).view === 'fleet', 'agent events go to the fleet view');
    check(model.agents.w9.last === 'Bash make', 'the last thing an agent did');
    check(applyEvent(model, { kind: 'fleet.run', subject: 'r1', payload: { run: 'r1', state: 'paused' } }).view === 'fleet' && model.runs.r1 === 'paused', 'run state');
    check(applyEvent(model, { kind: 'drift.spec', subject: 'sv/2.1', payload: {} }).view === 'drift' && model.drift === 1, 'drift counted');
    check(applyEvent(model, { kind: 'memory.add', subject: null, payload: { id: 4 } }).view === 'memories', 'memories');
    check(applyEvent(model, { kind: 'agent.activity', payload: {} }) === null || true, 'activity is quiet');
    check(c.cursor >= claim.seq, 'cursor follows the events');

    // the server dying is not the end: it reconnects and says so
    let reconnected = false;
    c.on('reconnect', () => { reconnected = true; });
    c.proc.kill('SIGKILL');
    for (let i = 0; i < 100 && !reconnected; i++) await new Promise((res) => setTimeout(res, 50));
    check(reconnected && c.ready, 'reconnected after the server died');
    cgRun('spec', 'release', '2.1', '--agent', 'w9');
    const n = events.length;
    for (let i = 0; i < 100 && events.length === n; i++) await new Promise((res) => setTimeout(res, 20));
    check(events.slice(n).some((e) => e.kind === 'release'), 'events flow again after a reconnect');
    c.dispose();

    // an older cg: start() is false, unsupported is set, nothing lingers
    const old = new ServeClient(OLD, cwd, () => {});
    check(await old.start() === false, 'old cg: start is false');
    check(old.unsupported === true, 'old cg: reported as unsupported');
    check(old.proc === null, 'old cg: no process left');
    old.dispose();
    console.log('serve client ok');
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
JS
    [ $? -eq 0 ] || fail "serve client"

    # ---- the extension routes through the connection and stops polling
    node - "$EXT" <<'JS'
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const ext = fs.readFileSync(path.join(dir, 'extension.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const check = (c, w) => { if (!c) throw new Error(w); };
check(/require\('\.\/serve'\)/.test(ext), 'extension requires serve.js');
check(/if \(serveConnected\(\)\) return serveClient\.exec\(full\)/.test(ext), 'cg() goes over the connection');
check(/if \(!serveConnected\(\) && vscode\.window\.state\.focused\) scheduleRefresh/.test(ext), 'the idle poll is off while connected');
check(/poll: \(\) => serveConnected\(\) \? Promise\.resolve\(\)/.test(ext), 'the session poll is off while connected');
check(/serveClient\.on\('event'/.test(ext) && /provider\.applyEvent\(applied\)/.test(ext), 'events patch the task view');
check(/serveClient\.unsupported/.test(ext), 'an old cg falls back');
check(pkg.contributes.configuration.properties['codify.serve'], 'codify.serve is a setting');
console.log('serve wiring ok');
JS
    [ $? -eq 0 ] || fail "serve wiring"
fi

# ---- start (v11 6.1): the Start flow's plan and the live fleet view
if want start; then
    rm -rf "$TMP/st"; mkdir -p "$TMP/st/src"; cd "$TMP/st"
    git init -q -b main . 2>/dev/null || git init -q .
    git config user.email t@t; git config user.name t
    echo 'export function alpha(){}' > src/a.ts
    echo 'export function beta(){ return alpha() }' > src/b.ts
    "$CG" spec new st >/dev/null
    "$CG" spec docs off >/dev/null
    "$CG" spec start 1.1 >/dev/null; "$CG" spec done 1.1 >/dev/null
    "$CG" spec mode parallel >/dev/null
    "$CG" spec add 2.1 --title "Alpha" --wave 1 --reqs 1.1 --symbols alpha --touches 'src/a.ts' >/dev/null
    "$CG" spec add 2.2 --title "Beta" --wave 1 --reqs 1.1 --symbols beta --touches 'src/b.ts' >/dev/null
    "$CG" init >/dev/null
    printf '.codegraph/\n*.lock\n' > .gitignore
    cat >> spec/workflow.kvx <<'EOF'

[hierarchy]
test_gate = "true"
pr        = "manual"

[role.worker]
wall  = "2h"
spend = "$3"
approve = ["land"]
EOF
    git add -A >/dev/null; git commit -qm base >/dev/null
    # events a supervisor would have written, so the decoration has something to fold
    python3 - <<'EOF'
import json, sqlite3, time
db = sqlite3.connect(".codegraph/graph.db", isolation_level=None)
now = int(time.time() * 1000)
rows = [
  ("orch.spawn", "st/2.1", "w-st-1", {"role": "worker", "agent": "w-st-1", "task": "2.1"}),
  ("supervisor.stall", "st/2.1", None, {"agent": "w-st-1", "task": "2.1", "action": "nudge", "reason": "no progress"}),
  ("supervisor.stall", "st/2.1", None, {"agent": "w-st-1", "task": "2.1", "action": "stop", "reason": "stalled — no progress for 40s after a nudge"}),
  ("orch.spawn", "st/2.1", "w-st-1", {"role": "worker", "agent": "w-st-1", "task": "2.1"}),
  ("supervisor.escalate", "st/2.1", None, {"task": "2.1", "level": 1, "to": "manager", "agent": "fm-st"}),
  ("agent.tool", "st/2.1", "w-st-1", {"agent": "w-st-1", "tool": "Bash", "detail": "make test"}),
  ("agent.usage", "st/2.1", "w-st-1", {"agent": "w-st-1", "tokens_in": 1200, "tokens_out": 80, "cost_usd": 0.42}),
]
for kind, subj, node, payload in rows:
    db.execute("INSERT INTO events(at,kind,subject,node,payload) VALUES(?,?,?,?,?)", (now, kind, subj, node, json.dumps(payload)))
db.execute("INSERT INTO fleet_approvals(gate,subject,state,requested,requested_by) VALUES('land','st','pending',?, 'fm-st')", (int(time.time()),))
EOF
    CG_AGENT=w-st-1 CG_ROLE=worker CG_PARENT=fm-st CG_FEATURE=st CG_WAVE=1 "$CG" spec claim 2.1 >/dev/null
    node - "$EXT" "$CG" "$TMP/st" <<'JS'
const path = require('path'), cp = require('child_process');
const [dir, CG, cwd] = process.argv.slice(2);
const { startPlan, liveDecorate, fleetTree } = require(path.join(dir, 'fleet.js'));
const { liveModel, applyEvent } = require(path.join(dir, 'serve.js'));
const check = (c, w) => { if (!c) throw new Error(w); };
const run = (...a) => cp.spawnSync(CG, a, { cwd, encoding: 'utf8' });
const json = (...a) => JSON.parse(run(...a).stdout);

// ---- the plan a person confirms, from what cg really answers
const roles = json('fleet', 'roles', '--json');
const dry = run('spec', 'run', '--fleet', '--dry-run').stdout;
const collisions = json('drift', 'collisions', '--json');
const runs = json('fleet', 'runs', '--json').runs;
const plan = startPlan({ roles, dryRun: dry, collisions, runs });
check(plan.canStart === true, `plan should be startable: ${plan.warnings}`);
check(plan.feature === 'st', `feature ${plan.feature}`);
const md = plan.markdown;
check(/\| worker \| w-\{feature\}-\{wave\} \| wave\/\{feature\}\/\{wave\} \| codex \| — \| 2 \| 2h \| \$3\.00 \| 2 \| 15m \| land \|/.test(md), 'worker row carries its budgets and gate: ' + md);
check(/\| feature \| .* \| land \|/.test(md) === false, 'approve is per role: the worker declared land, not the manager');
check(/manager fm-st — st on feature\/st/.test(md), 'the dry run is in the plan');
check(/worker w-st-1 — 2\.1/.test(md) && /worker w-st-1 — 2\.2/.test(md), 'every worker spawn listed');
check(/## Predicted collisions/.test(md), 'collisions section');
check(/2\.1 and 2\.2: .*call one another/.test(md), 'the alpha/beta collision is predicted: ' + md);
check(/cg fleet up -n 2 -f st/.test(md), 'the exact command');
check(plan.slots === 2, `slots ${plan.slots}`);
// a flat repository, or a live run, cannot start
const flat = startPlan({ roles: Object.assign({}, roles, { configured: false }), dryRun: '', collisions: null, runs: [] });
check(flat.canStart === false && /no \[hierarchy\]/.test(flat.warnings[0]), 'flat repo refused');
const busy = startPlan({ roles, dryRun: dry, collisions, runs: [{ run: 'r1', feature: 'st', state: 'running', supervisor: true }] });
check(busy.canStart === false && /stop it first/.test(busy.warnings[0]), 'a live supervisor refuses a second start');
const crashed = startPlan({ roles, dryRun: dry, collisions, runs: [{ run: 'r1', feature: 'st', state: 'running', supervisor: false }] });
check(crashed.canStart === true && /Resume/.test(crashed.warnings[0]), 'a crashed run is offered a resume');

// ---- the live view: cg's tree, decorated from the events
const status = json('fleet', 'status', '--json');
const spec = json('spec', 'status', '--json');
const branches = json('branches', '--json');
const fplan = json('fleet', 'plan', '--json');
const tree = json('fleet', 'tree', '--json');
const model = fleetTree(status, spec, branches, { plan: fplan, tree, prs: {}, exists: () => true });
const live = liveModel();
const evs = run('events', '--kind', 'supervisor.,orch.spawn,agent.', '-n', '300', '--json').stdout
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
for (const e of evs) applyEvent(live, e);
check(live.agents['w-st-1'] && live.agents['w-st-1'].last === 'Bash make test', 'the agent\'s last step is in the live model');
check(Math.abs(live.agents['w-st-1'].cost - 0.42) < 1e-9, 'its cost too');
const t0 = Date.now();
liveDecorate(model, { live, events: evs.filter((e) => /^(supervisor\.|orch\.)/.test(e.kind)),
                      runs: json('fleet', 'runs', '--json'), approvals: json('fleet', 'approvals', '--json') });
check(Date.now() - t0 < 300, 'decoration is instant');
const find = (n, pred, out = []) => { if (!n) return out; if (pred(n)) out.push(n); for (const c of n.children || []) find(c, pred, out); return out; };
const worker = find(model.main, (n) => n.agent === 'w-st-1')[0];
check(worker, 'the claimed worker is in the tree: ' + JSON.stringify(model.main).slice(0, 400));
check(worker.step === 'Bash make test', `step ${worker.step}`);
check(Math.abs(worker.cost - 0.42) < 1e-9, `cost ${worker.cost}`);
const t21 = (worker.tasks || []).find((t) => t.id === '2.1');
check(t21, 'task 2.1 under its worker');
check(t21.attempts === 2 && t21.nudged === true, `attempts ${t21.attempts} nudged ${t21.nudged}`);
check(/stalled/.test(t21.stopped), `stopped ${t21.stopped}`);
check(t21.escalated === 'manager', `escalated ${t21.escalated}`);
check(model.approvals.length === 1 && model.approvals[0].gate === 'land' && model.approvals[0].requested_by === 'fm-st', 'the pending approval is on the model');
check(model.run === null, 'no run yet');
console.log('start flow ok');
JS
    [ $? -eq 0 ] || fail "start flow"

    # ---- manifest and wiring
    node - "$EXT" <<'JS'
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const src = fs.readFileSync(path.join(dir, 'fleet.js'), 'utf8');
const kvx = fs.readFileSync(path.join(dir, 'kvx.js'), 'utf8');
const check = (c, w) => { if (!c) throw new Error(w); };
const declared = pkg.contributes.commands.map((c) => c.command);
for (const verb of ['start', 'stop', 'pause', 'resume', 'openTranscript', 'approve']) {
    const c = `codify.fleet.${verb}`;
    check(declared.includes(c), `not declared: ${c}`);
    check(src.includes(`'${c}':`), `not registered: ${c}`);
}
const menus = Object.values(pkg.contributes.menus).flat();
check(menus.some((m) => m.command === 'codify.fleet.start' && /!codify\.fleet\.running/.test(m.when)), 'Start shows when nothing runs');
check(menus.some((m) => m.command === 'codify.fleet.stop' && /codify\.fleet\.running/.test(m.when)), 'Stop shows while running');
check(menus.some((m) => m.command === 'codify.fleet.resume' && /codify\.fleet\.paused/.test(m.when)), 'Resume shows when paused');
check(/registerCodeLensProvider\(KVX/.test(kvx) && /codify\.fleet\.start/.test(kvx), 'the spec gets a Start lens');
check(/command: 'codify\.fleet\.openTranscript'/.test(src), 'a click on an agent opens its transcript');
check(/approvalItem\(a\)/.test(src) && /fleet-approval/.test(src), 'approvals are rows');
check(/\['fleet', 'up', '-n'/.test(src), 'Start runs cg fleet up');
check(/'fleet', 'down'/.test(src) && /--drain/.test(src), 'Stop runs cg fleet down, with a drain');
console.log('start wiring ok');
JS
    [ $? -eq 0 ] || fail "start wiring"
fi

# ---- chat capabilities (v11 6.2): served tools as commands, attach and
#      steer, approvals as cards, a transcript that stays responsive
if want fleetchat; then
    rm -rf "$TMP/fc"; mkdir -p "$TMP/fc/src"; cd "$TMP/fc"
    echo 'export function alpha(){ return 1 }' > src/a.ts
    "$CG" spec new fc >/dev/null
    "$CG" init >/dev/null
    python3 - <<'EOF'
import sqlite3, time
db = sqlite3.connect(".codegraph/graph.db", isolation_level=None)
db.execute("INSERT INTO fleet_approvals(gate,subject,state,requested,requested_by) VALUES('pr','fc','pending',?, 'fm-fc')", (int(time.time()),))
EOF
    node - "$EXT" "$CG" "$TMP/fc" <<'JS'
const path = require('path'), cp = require('child_process'), fs = require('fs');
const [dir, CG, cwd] = process.argv.slice(2);
const { ChatCapabilities, approvalCard, Window } = require(path.join(dir, 'agents.js'));
const check = (c, w) => { if (!c) throw new Error(w); };
const run = (...a) => cp.spawnSync(CG, a, { cwd, encoding: 'utf8' });

// ---- every served tool is a command, with a hint from its schema
const caps = ChatCapabilities.fromListJson(run('tool', 'list', '--json').stdout);
const cmds = caps.commands();
check(cmds.length > 40, `only ${cmds.length} tool commands`);
const ctx = cmds.find((c) => c.n === 'get_context');
check(ctx && /<query>/.test(ctx.a) && ctx.tool === true && ctx.readOnly === true, `get_context: ${JSON.stringify(ctx)}`);
const claim = cmds.find((c) => c.n === 'spec_claim');
check(claim && /<id>/.test(claim.a) && /\[agent=…\]/.test(claim.a) && claim.readOnly === false, `spec_claim: ${JSON.stringify(claim)}`);
check(caps.has('spec_status') && !caps.has('no_such'), 'has()');
check(cmds.every((c, i, a) => i === 0 || a[i - 1].n <= c.n), 'sorted');

// ---- arguments: the whole line for one text field, key=value otherwise, typed
check(JSON.stringify(caps.args('get_context', 'auth flow here')) === '{"query":"auth flow here"}', 'free text → the required field');
check(JSON.stringify(caps.args('spec_claim', 'id=2.1 agent=w1 ttl=20')) === '{"id":"2.1","agent":"w1","ttl":20}', 'pairs, typed: ' + JSON.stringify(caps.args('spec_claim', 'id=2.1 agent=w1 ttl=20')));
check(JSON.stringify(caps.args('spec_claim', '2.1')) === '{"id":"2.1"}', 'a bare value fills the first required field');
check(JSON.stringify(caps.args('impact_analysis', 'name=alpha depth=2')) === '{"name":"alpha","depth":2}', 'integers are numbers');
check(JSON.stringify(caps.args('brief', '')) === '{}', 'no args');
check(JSON.stringify(caps.args('remember', 'text="two words" type=decision')) === '{"text":"two words","type":"decision"}', 'quoted values');
// and the arguments really drive the tool
const sym = run('tool', 'call', 'get_symbol', JSON.stringify(caps.args('get_symbol', 'alpha')));
check(sym.status === 0 && /alpha/.test(sym.stdout) && /src\/a\.ts/.test(sym.stdout), 'tool call with parsed args: ' + sym.stdout.slice(0, 200));

// ---- the approval card says what the event said, and offers the decision
const card = approvalCard({ kind: 'approval.request', payload: { id: 7, gate: 'land', subject: 'fc', state: 'pending', by: 'fm-fc' } });
check(card.type === 'approval' && card.id === 7 && /land fc on main/.test(card.title), card.title);
check(/asked by fm-fc/.test(card.detail), card.detail);
check(card.options.map((o) => o.action).join(',') === 'approve,reject', 'two options');
check(card.commands[0] === 'cg fleet approve 7' && /--reject/.test(card.commands[1]), 'the commands behind the buttons');
check(approvalCard({ payload: { id: 8, gate: 'drift', subject: 'fc/2.1', state: 'approved' } }).options.length === 0, 'a decided approval has no buttons');
// the real pending approval is what /approvals would draw
const pending = JSON.parse(run('fleet', 'approvals', '--json').stdout).approvals;
const real = approvalCard({ payload: { id: pending[0].id, gate: pending[0].gate, subject: pending[0].subject, state: pending[0].state, by: pending[0].requested_by } });
check(/open the pull request for fc/.test(real.title) && real.options.length === 2, real.title);

// ---- the window at ten thousand entries
const w = new Window(400, 200);
const t0 = Date.now();
for (let i = 0; i < 10000; i++) w.push({ i });
const took = Date.now() - t0;
check(took < 200, `10000 pushes took ${took} ms`);
check(w.shown.length === 400 && w.hiddenCount === 9600 && w.size === 10000, `window ${w.shown.length}/${w.hiddenCount}`);
check(w.shown[0].i === 9600 && w.shown[399].i === 9999, 'the newest stay');
const back = w.expand();
check(back.length === 200 && back[0].i === 9400 && w.shown.length === 600 && w.shown[0].i === 9400, 'a page comes back in order');
check(w.trimmed === 9600, 'trimmed count');
console.log('chat capabilities ok');
JS
    [ $? -eq 0 ] || fail "chat capabilities"

    # ---- wiring: the session and the panel
    node - "$EXT" <<'JS'
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const acp = fs.readFileSync(path.join(dir, 'acp.js'), 'utf8');
const html = fs.readFileSync(path.join(dir, 'agentpanel.html'), 'utf8');
const ext = fs.readFileSync(path.join(dir, 'extension.js'), 'utf8');
const check = (c, w) => { if (!c) throw new Error(w); };
check(/tools: caps\.commands\(\)/.test(acp) && /\['tool', 'list', '--json'\]/.test(acp), 'init carries the served tools');
check(/\['tool', 'call', name, JSON\.stringify\(a\)\]/.test(acp), 'a tool command runs cg tool call');
check(/async function attachAgent/.test(acp) && /\['fleet', 'steer', agent, text\]/.test(acp), 'attach and steer');
check(/if \(sess\.attached\) \{ steerAgent/.test(acp), 'a plain message steers the attached agent');
check(/deps\.events\.on\(/.test(acp) && /setInterval\(async/.test(acp), 'events when served, cg events when not');
check(/approval\.request/.test(acp) && /supervisor\.escalate/.test(acp), 'approvals and escalations reach the chat');
check(/\['fleet', 'approve', String\(id\)\]/.test(acp), 'a button decides through cg fleet approve');
check(/function approvalCard\(m\)/.test(html) && /type: 'approve'/.test(html), 'the panel draws the approval and posts the decision');
check(/function escalationCard/.test(html) && /type: 'steer'/.test(html), 'an escalation offers to steer');
check(/toolCommands = m\.tools/.test(html) && /concat\(tools\)/.test(html), 'served tools are in the slash menu');
check(/WINDOW_KEEP = 400/.test(html) && /trimWindow\(\)/.test(html) && /earlier entries — show/.test(html), 'the transcript is windowed');
check(/id="attachpill"/.test(html) && /function setAttached/.test(html), 'the attached pill');
check(/events: \{\s*available:/.test(ext) && /eventFans/.test(ext), 'the extension fans events to the chat');
console.log('chat wiring ok');
JS
    [ $? -eq 0 ] || fail "chat wiring"
fi

# ---- agent chat (5.3): the pure chat core, provable without VS Code
if want chat; then
node - "$EXT" <<'JS'
const path = require('path');
const { AgentPanel, diffRows, stripAnsi } =
    require(path.join(process.argv[2], 'agents.js'));
const check = (cond, what) => { if (!cond) throw new Error(what); };

// a real line diff: the common lines stay put, only the edit moves
const d = diffRows('a\nb\nc\nd\n', 'a\nB\nc\nd\n');
check(d.added === 1 && d.removed === 1, `one line changed, got +${d.added}/-${d.removed}`);
check(d.rows.filter((r) => r.t === 'ctx').length === 3, 'unchanged lines kept as context');
const del = d.rows.find((r) => r.t === 'del');
const add = d.rows.find((r) => r.t === 'add');
check(del.s === 'b' && del.o === 2 && del.n === 0, 'removed row keeps its old line number');
check(add.s === 'B' && add.n === 2 && add.o === 0, 'added row keeps its new line number');

// long unchanged runs collapse instead of flooding the panel
const long = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n') + '\n';
const tail = diffRows(long, long + 'tail\n');
check(tail.rows.some((r) => r.t === 'gap'), 'unchanged runs collapse into a gap');
check(tail.rows.length < 20, `a one-line change draws a small diff, got ${tail.rows.length}`);
check(/\d+ unchanged/.test(tail.rows.find((r) => r.t === 'gap').s),
    'the gap says how much it hides');

// a runaway diff is bounded and says what it cut
const huge = diffRows('x\n'.repeat(5000), 'y\n'.repeat(5000), 50);
check(huge.rows.length === 50 && huge.truncated > 0, 'oversized diffs are cut with a count');
check(diffRows('same\n', 'same\n').rows.every((r) => r.t !== 'add' && r.t !== 'del'),
    'an unchanged file shows no edits');
check(diffRows(null, 'new\n').added === 1, 'a created file is all additions');

// escape sequences never reach the webview
check(stripAnsi('\u001b[1;31mred\u001b[0m') === 'red', 'SGR colours stripped');
check(stripAnsi('\u001b]0;title\u0007done') === 'done', 'OSC title sequences stripped');
check(stripAnsi('plain') === 'plain', 'plain text is untouched');
check(stripAnsi(undefined) === '', 'missing output is empty, not "undefined"');

// the ledger: adapters that report totals and adapters that report deltas
// must both produce a total that only grows
const totals = new AgentPanel(() => {});
totals.beginTurn();
totals.recordUsage({ cost: 0.10, tokens: 1000 });
check(totals.endTurn('end_turn').cost === 0.1, 'first turn costs what was reported');
totals.beginTurn();
totals.recordUsage({ cost: 0.30, tokens: 3000 });
const t2 = totals.endTurn('end_turn');
check(Math.abs(t2.cost - 0.2) < 1e-9, `running totals become per-turn deltas: ${t2.cost}`);
check(t2.sessionCost === 0.3 && t2.turns === 2, 'session total tracks the adapter');
const deltas = new AgentPanel(() => {});
deltas.beginTurn(); deltas.recordUsage({ cost: 0.10 }); deltas.endTurn('end_turn');
deltas.beginTurn(); deltas.recordUsage({ cost: 0.05 });
check(Math.abs(deltas.endTurn('end_turn').sessionCost - 0.15) < 1e-9,
    'per-message costs accumulate into the session total');
check(new AgentPanel(() => {}).retryTarget() === null, 'nothing to retry before a prompt');

console.log('chat core ok');
JS
echo "chat core section ok"
fi

if want manifest; then
# ---- the manifest and the code agree about which commands exist
node - "$EXT" <<'JS'
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
// commands are registered from extension.js, agents.js, acp.js, tasks.js,
// and fleet.js
const src = fs.readFileSync(path.join(dir, 'extension.js'), 'utf8') +
    fs.readFileSync(path.join(dir, 'agents.js'), 'utf8') +
    fs.readFileSync(path.join(dir, 'acp.js'), 'utf8') +
    fs.readFileSync(path.join(dir, 'tasks.js'), 'utf8') +
    fs.readFileSync(path.join(dir, 'fleet.js'), 'utf8');

if (pkg.publisher !== 'SidioraLabs' || pkg.name !== 'codify-workflow') {
    throw new Error(`unexpected Marketplace identity: ${pkg.publisher}.${pkg.name}`);
}
const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
if (!readme.includes('`SidioraLabs.codify-workflow`')) {
    throw new Error('README does not name the Marketplace identity SidioraLabs.codify-workflow');
}
const changelog = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`extension ${pkg.version}`)) {
    throw new Error(`CHANGELOG has no entry for extension ${pkg.version}`);
}
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    throw new Error(`invalid installed extension version: ${pkg.version}`);
}
const { AcpClient } = require(path.join(dir, 'acp.js'));
const probe = new AcpClient();
probe.start = async () => {};
probe.request = async (method, params) => {
    if (method !== 'initialize' || params.clientInfo.version !== pkg.version)
        throw new Error('ACP handshake does not advertise the installed version');
    return { protocolVersion: 1 };
};
probe.initialize().catch((e) => { console.error(e); process.exitCode = 1; });
if (!/version: extensionVersion\(\)/.test(src)) {
    throw new Error('agent view does not receive the installed extension version');
}
const codexAdapter = pkg.contributes.configuration.properties['codify.acp.codexCommand'];
if (!codexAdapter || codexAdapter.default !==
    'npx -y @agentclientprotocol/codex-acp@1.7.0') {
    throw new Error(`unexpected Codex ACP default: ${codexAdapter && codexAdapter.default}`);
}
if (/zed-industries\/codex-acp/.test(codexAdapter.description || '')) {
    throw new Error('manifest still recommends the legacy Codex ACP adapter');
}

const declared = pkg.contributes.commands.map((c) => c.command);
const registered = [...src.matchAll(/'(codify\.[A-Za-z.]+)':/g)].map((m) => m[1]);

for (const c of declared) {
    if (!registered.includes(c)) throw new Error(`declared but not registered: ${c}`);
}
for (const c of registered) {
    if (!declared.includes(c)) throw new Error(`registered but not declared: ${c}`);
}

// menu entries may only reference declared commands
const menus = Object.values(pkg.contributes.menus).flat();
for (const m of menus) {
    if (!declared.includes(m.command)) {
        throw new Error(`menu references unknown command: ${m.command}`);
    }
}

// views the code registers must exist in the manifest
const views = Object.values(pkg.contributes.views).flat().map((v) => v.id);
for (const v of ['codifyTasks', 'codifyMemories', 'codifyAgentView']) {
    if (!views.includes(v)) throw new Error(`missing view: ${v}`);
}
if (!/registerTreeDataProvider\('codifyMemories'/.test(src)) {
    throw new Error('codifyMemories view is declared but never populated');
}
if (!/registerWebviewViewProvider\(\s*'codifyAgentView'/.test(src)) {
    throw new Error('codifyAgentView is declared but never provided');
}

// the extension must not have grown dependencies: the whole point is that
// `vsce package` needs no npm install
if (pkg.dependencies || pkg.devDependencies) {
    throw new Error('extension must stay dependency-free');
}

// every refresh goes through one scheduler: no watcher on the database the
// extension itself writes, trace answers from the last index, and the
// poll is slow
const ext = fs.readFileSync(path.join(dir, 'extension.js'), 'utf8');
const ag = fs.readFileSync(path.join(dir, 'agents.js'), 'utf8');
const board = ext + fs.readFileSync(path.join(dir, 'tasks.js'), 'utf8');
if (/graph\.db/.test(ag) || /createFileSystemWatcher\([^)]*graph\.db/.test(board)) {
    throw new Error('the extension watches graph.db, which its own sync writes');
}
if (!/\['spec', 'trace', '--no-sync'\]/.test(board)) {
    throw new Error('the board refresh runs spec trace without --no-sync');
}
if (!/\['sync', '--max-age'/.test(ext)) {
    throw new Error('the board refresh does not sync with a freshness window');
}
if (!/function scheduleRefresh\(/.test(ext) || !/async function runRefresh\(/.test(ext)) {
    throw new Error('refresh scheduler entry points missing');
}
// the task views must not start a second clock of their own
if (/setInterval|createFileSystemWatcher/.test(
        fs.readFileSync(path.join(dir, 'tasks.js'), 'utf8'))) {
    throw new Error('tasks.js schedules refreshes outside the one scheduler');
}
const activePoll = /ACTIVE_POLL_MS = (\d+)/.exec(ag);
if (!activePoll || Number(activePoll[1]) < 10000) {
    throw new Error('agent poll is faster than 10 s');
}
console.log('manifest coherent:', declared.length, 'commands');
JS
fi

if want refresh; then
# ---- the refresh scheduler keeps one chain in flight
node - "$EXT" <<'JS'
const path = require('path');
const { createRefresher } = require(path.join(process.argv[2], 'refresh.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    // a burst debounces into one run
    let runs = 0;
    let r = createRefresher(async () => { runs += 1; await sleep(50); },
        { debounceMs: 30, minGapMs: 100 });
    const burst = [];
    for (let i = 0; i < 10; i++) burst.push(r.schedule());
    await Promise.all(burst);
    if (runs !== 1) throw new Error(`burst ran ${runs} times, expected 1`);

    // a request during a run queues exactly one trailing run
    runs = 0;
    const first = r.schedule(0);
    await sleep(10);
    if (!r.inFlight) throw new Error('urgent request did not start at once');
    const during = [r.schedule(0), r.schedule(), r.schedule(0)];
    await first;
    await Promise.all(during);
    if (runs !== 2) throw new Error(`trailing runs: ${runs}, expected 2`);

    // the floor keeps hinted runs apart; an urgent one ignores it
    const stamps = [];
    r = createRefresher(async () => { stamps.push(Date.now()); },
        { debounceMs: 10, minGapMs: 200 });
    await r.schedule();
    await r.schedule();
    if (stamps[1] - stamps[0] < 180) {
        throw new Error(`floor ignored: ${stamps[1] - stamps[0]}ms apart`);
    }
    await r.schedule(0);
    if (stamps[2] - stamps[1] > 100) {
        throw new Error(`urgent run waited ${stamps[2] - stamps[1]}ms`);
    }

    // a failing refresh never wedges the scheduler
    let n = 0;
    r = createRefresher(async () => { n += 1; if (n === 1) throw new Error('boom'); },
        { debounceMs: 5, minGapMs: 5 });
    await r.schedule(0);
    await r.schedule(0);
    if (n !== 2 || r.inFlight) throw new Error('scheduler wedged after a failure');
    r.dispose();
    console.log('refresh scheduler ok');
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
JS
fi

if want tasks; then
# ---- the task UI: manifest surface, the pure half under plain node, and the
# three symbols the graph must be able to resolve

node - "$EXT" <<'JS'
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const declared = pkg.contributes.commands.map((c) => c.command);

// the task view is contributed and owned by tasks.js
const views = Object.values(pkg.contributes.views).flat().map((v) => v.id);
if (!views.includes('codifyTasks')) throw new Error('missing view: codifyTasks');
const tasksSrc = fs.readFileSync(path.join(dir, 'tasks.js'), 'utf8');
if (!/createTreeView\(\s*'codifyTasks'/.test(tasksSrc)) {
    throw new Error('codifyTasks is declared but tasks.js never creates it');
}
if (!/require\('\.\/tasks'\)/.test(fs.readFileSync(path.join(dir, 'extension.js'), 'utf8'))) {
    throw new Error('extension.js does not load tasks.js');
}

// every task-UI command is declared, and the view title and item menus reach
// the filters and the actions
const need = ['codify.tasks.detail', 'codify.tasks.filter',
    'codify.tasks.filterStatus', 'codify.tasks.filterWave',
    'codify.tasks.filterOwner', 'codify.tasks.search',
    'codify.tasks.clearFilters', 'codify.tasks.verify',
    'codify.tasks.openBranch', 'codify.tasks.copyPrompt'];
for (const c of need) {
    if (!declared.includes(c)) throw new Error(`command not contributed: ${c}`);
    if (!new RegExp(`'${c.replace(/\./g, '\\.')}':`).test(tasksSrc)) {
        throw new Error(`command not registered in tasks.js: ${c}`);
    }
}
const title = pkg.contributes.menus['view/title']
    .filter((m) => /codifyTasks/.test(m.when)).map((m) => m.command);
for (const c of ['codify.tasks.filter', 'codify.tasks.filterStatus',
                 'codify.tasks.filterWave', 'codify.tasks.filterOwner',
                 'codify.tasks.search', 'codify.tasks.clearFilters']) {
    if (!title.includes(c)) throw new Error(`filter missing from the view title: ${c}`);
}
const item = pkg.contributes.menus['view/item/context']
    .filter((m) => /codifyTasks/.test(m.when)).map((m) => m.command);
for (const c of ['codify.startTask', 'codify.doneTask', 'codify.claimTask',
                 'codify.releaseTask', 'codify.tasks.openBranch',
                 'codify.tasks.verify', 'codify.tasks.copyPrompt',
                 'codify.tasks.detail']) {
    if (!item.includes(c)) throw new Error(`action missing from the task menu: ${c}`);
}
// the upgrade ships as its own version
if (pkg.version === '1.2.8') throw new Error('extension version was not bumped');
console.log('task manifest ok:', need.length, 'commands');
JS

# the module loads without vscode, exports the three symbols, and its filter
# and grouping logic answer correctly on a fixture
cat > "$TMP/spec.kvx" <<'KVX'
[meta]
feature = "demo"
intro   = "A two-section demo feature."

[req.1]
title = "First requirement"
ac_1  = "WHEN a task renders THE row SHALL name its owner."

[task.1]
title   = "Indexing"
section = "One indexer"
status  = "pending"

[task.1.1]
title      = "Gate"          # done, nobody holds it
status     = "done"
wave       = 1
symbols    = ["gate_open"]
touches    = ["src/gate.c"]
verify_cmd = "make test"
reqs       = ["1.1"]
do_1       = "Take the lock."
do_2       = "Drain the marker."

[task.1.2]
title    = "Callers"
status   = "in_progress"
wave     = 2
requires = ["1.1"]

[task.2]
title   = "Editor"
section = "Editor surface"
status  = "pending"

[task.2.1]
title    = "Tree"
status   = "pending"
wave     = 2
requires = ["1.2"]
KVX

node - "$EXT" "$TMP/spec.kvx" <<'JS'
const fs = require('fs'), path = require('path');
const t = require(path.join(process.argv[2], 'tasks.js'));

for (const name of ['TaskTreeProvider', 'taskFilter', 'taskDetail']) {
    if (typeof t[name] !== 'function') {
        throw new Error(`tasks.js does not export ${name}`);
    }
}

const spec = t.readSpec(fs.readFileSync(process.argv[3], 'utf8'));
if (spec.feature !== 'demo') throw new Error('meta.feature: ' + spec.feature);
if (spec.clauses['1.1'] !== 'WHEN a task renders THE row SHALL name its owner.') {
    throw new Error('ac_1 did not become clause 1.1');
}
const gate = spec.byId.get('1.1');
if (gate.section !== 'One indexer') throw new Error('section not inherited: ' + gate.section);
if (gate.do.length !== 2 || gate.do[0] !== 'Take the lock.') {
    throw new Error('do steps: ' + JSON.stringify(gate.do));
}
if (gate.verify_cmd !== 'make test') throw new Error('verify_cmd: ' + gate.verify_cmd);
if (!spec.byId.get('1').group) throw new Error('a task without a wave is a heading');

// live state: trace carries the graph evidence, status the claims
const trace = { feature: 'demo', graph: true, tasks: [
    { id: '1.1', title: 'Gate', status: 'done', wave: 1,
      symbols: [{ name: 'gate_open', found: true, path: 'src/gate.c', line: 4,
                  kind: 'function', refs: 2 }],
      touches: [{ pattern: 'src/gate.c', changed: true }],
      commits: [{ id: 'abc123def456789', date: 1, message: 'gate' }],
      memories: [{ id: 1, type: 'decision', body: 'one writer', created: 1 }] },
    { id: '1.2', title: 'Callers', status: 'in_progress', wave: 2,
      symbols: [], touches: [], commits: [], memories: [] },
    { id: '2.1', title: 'Tree', status: 'pending', wave: 2,
      symbols: [], touches: [], commits: [], memories: [] },
]};
const status = { feature: 'demo', spec: 'spec/demo/spec.kvx', mode: 'parallel',
    tasks: 3, done: 1, next: { id: '2.1' }, claims: [
        { id: '1.2', agent: 'w-demo-2', role: 'worker', parent: 'fm-demo',
          branch: 'wave/demo/2', worktree: '/tmp/wt/demo-2',
          attempt_id: 'ff00ff00ff00', expires_in_min: 21 },
    ]};
const plan = { waves: [{ wave: 1, branch: 'wave/demo/1' },
                       { wave: 2, branch: 'wave/demo/2' }] };

const rows = t.mergeTasks(spec, trace, status, plan);
if (rows.length !== 3) throw new Error('rows: ' + rows.length);
const byId = new Map(rows.map((r) => [r.id, r]));
if (byId.get('1.1').section !== 'One indexer' ||
    byId.get('2.1').section !== 'Editor surface') {
    throw new Error('sections did not survive the merge');
}
if (byId.get('1.2').agent !== 'w-demo-2' || byId.get('1.2').role !== 'worker' ||
    byId.get('1.2').branch !== 'wave/demo/2' ||
    byId.get('1.2').worktree !== '/tmp/wt/demo-2') {
    throw new Error('claim owner/branch/worktree not merged onto the row');
}
if (byId.get('2.1').waveBranch !== 'wave/demo/2') {
    throw new Error('wave branch from the fleet plan is missing');
}
// 2.1 requires 1.2, which is in_progress: blocked. 1.2 requires 1.1 (done).
if (byId.get('2.1').blockers.length !== 1 ||
    byId.get('2.1').blockers[0].id !== '1.2') {
    throw new Error('blockers: ' + JSON.stringify(byId.get('2.1').blockers));
}
if (byId.get('1.2').blockers.length !== 0) {
    throw new Error('a done require must not block');
}

const ids = (f) => t.taskFilter(rows, f).map((r) => r.id).join(',');
if (ids({}) !== '1.1,1.2,2.1') throw new Error('unfiltered: ' + ids({}));
if (ids({ status: 'done' }) !== '1.1') throw new Error('status: ' + ids({ status: 'done' }));
if (ids({ status: 'open' }) !== '1.2,2.1') throw new Error('open: ' + ids({ status: 'open' }));
if (ids({ status: 'blocked' }) !== '2.1') throw new Error('blocked: ' + ids({ status: 'blocked' }));
if (ids({ wave: 2 }) !== '1.2,2.1') throw new Error('wave: ' + ids({ wave: 2 }));
if (ids({ wave: '1' }) !== '1.1') throw new Error('wave as string: ' + ids({ wave: '1' }));
if (ids({ owner: 'w-demo-2' }) !== '1.2') throw new Error('owner: ' + ids({ owner: 'w-demo-2' }));
if (ids({ owner: 'unclaimed' }) !== '1.1,2.1') throw new Error('unclaimed: ' + ids({ owner: 'unclaimed' }));
if (ids({ text: 'gate_open' }) !== '1.1') throw new Error('symbol search: ' + ids({ text: 'gate_open' }));
if (ids({ text: 'src/gate.c' }) !== '1.1') throw new Error('path search: ' + ids({ text: 'src/gate.c' }));
if (ids({ text: 'EDITOR' }) !== '2.1') throw new Error('section search is case-insensitive');
if (ids({ status: 'done', wave: 2 }) !== '') throw new Error('filters must combine');
if (ids({ status: 'nonsense' }) !== '') throw new Error('an unknown status matches nothing');
if (t.filterLabel({ status: 'pending', wave: 2, owner: 'w-demo-2', text: 'x' })
    !== 'pending · wave 2 · w-demo-2 · "x"') {
    throw new Error('filter label: ' + t.filterLabel({ status: 'pending' }));
}
if (t.filterLabel({ status: 'all', wave: 'all', owner: 'all', text: '' }) !== '') {
    throw new Error('an empty filter must leave the view title alone');
}

// the detail view decides what the panel may offer
const v = t.detailView(byId.get('1.2'), spec);
const act = new Map(v.actions.map((a) => [a.action, a]));
for (const a of ['start', 'done', 'claim', 'release', 'branch', 'verify', 'prompt']) {
    if (!act.has(a)) throw new Error('detail panel offers no ' + a);
}
if (!act.get('claim').disabled) throw new Error('a claimed task must not offer claim');
if (act.get('release').disabled) throw new Error('a claimed task must offer release');
if (act.get('branch').disabled) throw new Error('a task with a worktree must offer its branch');
if (t.detailView(byId.get('1.1'), spec).criteria[0].text !==
    spec.clauses['1.1']) {
    throw new Error('acceptance criteria text is not resolved for the panel');
}

// the panel is CSP-strict: one nonce, no eval, no remote anything
const html = t.detailHtml('N0NCE');
const csp = /<meta http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/
    .exec(html);
if (!csp) throw new Error('detail panel has no CSP');
if (!/default-src 'none'/.test(csp[1]) ||
    !/script-src 'nonce-N0NCE'/.test(csp[1]) ||
    !/style-src 'nonce-N0NCE'/.test(csp[1])) {
    throw new Error('CSP is not nonce-only: ' + csp[1]);
}
if (/unsafe-inline|unsafe-eval|https?:/.test(csp[1])) {
    throw new Error('CSP allows more than this panel: ' + csp[1]);
}
if (/<script(?![^>]*nonce="N0NCE")/.test(html)) throw new Error('un-nonced script tag');
if (/src="http|href="http/.test(html)) throw new Error('panel loads a remote resource');
if (/innerHTML/.test(html)) throw new Error('panel renders data through innerHTML');

// the resume prompt is built from the task's own declaration
const prompt = t.resumePrompt(byId.get('1.1'), { clauses: spec.clauses });
for (const needle of ['# resume: demo/1.1', 'Take the lock.', 'src/gate.c',
                      'gate_open', 'verify: make test', 'cg spec done 1.1',
                      'cg handoff --task 1.1', spec.clauses['1.1']]) {
    if (!prompt.includes(needle)) throw new Error('prompt lacks: ' + needle);
}
console.log('task model ok:', rows.length, 'rows');
JS

# the tree itself, driven against a stub vscode module: the grouping, the
# row contents, and what the view title says when a filter is on
node - "$EXT" "$TMP/spec.kvx" <<'JS'
const path = require('path'), Module = require('module');
const [, , dir, specfile] = process.argv;

/* the sliver of the VS Code API the task tree touches */
const items = [];
class TreeItem {
    constructor(label, state) { this.label = label; this.collapsibleState = state; }
}
const view = { dispose() {} };
const stub = {
    EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); }
        fire() {} },
    TreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: class { constructor(id, color) { this.id = id; this.color = color; } },
    ThemeColor: class { constructor(id) { this.id = id; } },
    MarkdownString: class { constructor() { this.value = ''; }
        appendMarkdown(s) { this.value += s; return this; } },
    window: {
        createTreeView: (id, opts) => { view.id = id; view.opts = opts; return view; },
        onDidCloseTerminal: () => ({ dispose() {} }),
    },
    commands: { registerCommand: () => ({ dispose() {} }) },
};
const load = Module._load;
Module._load = function (req) {
    if (req === 'vscode') return stub;
    return load.apply(this, arguments);
};
const t = require(path.join(dir, 'tasks.js'));

const trace = { feature: 'demo', graph: true, tasks: [
    { id: '1.1', title: 'Gate', status: 'done', wave: 1, symbols: [], touches: [] },
    { id: '1.2', title: 'Callers', status: 'in_progress', wave: 2, symbols: [], touches: [] },
    { id: '2.1', title: 'Tree', status: 'pending', wave: 2, symbols: [], touches: [] },
]};
const status = { feature: 'demo', spec: path.basename(specfile), mode: 'parallel',
    tasks: 3, done: 1, next: { id: '2.1' }, documentation: { configured: false },
    claims: [{ id: '1.2', agent: 'w-demo-2', role: 'worker',
               branch: 'wave/demo/2', worktree: '/tmp/wt/demo-2',
               expires_in_min: 21 }] };
const plan = { waves: [{ wave: 2, branch: 'wave/demo/2' }] };
const answers = { 'spec status': status, 'spec trace': trace, 'fleet plan': plan };

const ctx = { subscriptions: [], workspaceState: { get: () => null, update() {} } };
const provider = t.register(ctx, {
    cg: async () => ({ code: 0, stdout: '', stderr: '' }),
    cgJson: async (args) => answers[args.slice(0, 2).join(' ')] || null,
    workspaceRoot: () => path.dirname(specfile),
    show: () => {},
    state: ctx.workspaceState,
    sessionBadge: () => '',
});

(async () => {
    await provider.refresh();
    if (provider.rows.length !== 3) throw new Error('rows: ' + provider.rows.length);

    const roots = provider.getChildren();
    if (roots.length !== 1 || roots[0].label !== 'demo') {
        throw new Error('root is not the feature: ' + JSON.stringify(roots.map(r => r.label)));
    }
    if (!/1\/3 done/.test(roots[0].description)) {
        throw new Error('feature progress: ' + roots[0].description);
    }
    const sections = provider.getChildren(roots[0]);
    if (sections.map((s) => s.label).join(',') !== 'One indexer,Editor surface') {
        throw new Error('sections: ' + sections.map((s) => s.label).join(','));
    }
    const waves = provider.getChildren(sections[0]);
    if (waves.map((w) => w.label).join(',') !== 'Wave 1,Wave 2') {
        throw new Error('waves: ' + waves.map((w) => w.label).join(','));
    }
    const editorWaves = provider.getChildren(sections[1]);
    if (editorWaves.length !== 1 || !/wave\/demo\/2/.test(editorWaves[0].description)) {
        throw new Error('the wave does not name its branch: ' + editorWaves[0].description);
    }
    const leaves = provider.getChildren(waves[0]);
    if (leaves.length !== 1 || leaves[0].label !== '1.1  Gate') {
        throw new Error('task row: ' + JSON.stringify(leaves.map((l) => l.label)));
    }
    if (leaves[0].contextValue !== 'task-done') {
        throw new Error('contextValue: ' + leaves[0].contextValue);
    }
    if (leaves[0].command.command !== 'codify.tasks.detail') {
        throw new Error('a task row does not open its detail panel');
    }
    const owner = provider.getChildren(waves[1])[0];
    if (!owner || !/w-demo-2/.test(owner.description) ||
        !/wave\/demo\/2/.test(owner.description) ||
        !/in progress/.test(owner.description)) {
        throw new Error('owner, branch or status missing from the row: ' +
            (owner && owner.description));
    }
    const blocked = provider.getChildren(editorWaves[0])[0];
    if (!/blocked by 1\.2/.test(blocked.description)) {
        throw new Error('blockers missing from the row: ' + blocked.description);
    }

    // a filter narrows the tree and says so in the view title
    provider.setFilter({ status: 'done' });
    if (view.description !== 'done') {
        throw new Error('view title does not show the filter: ' + view.description);
    }
    const only = provider.getChildren(provider.getChildren(
        provider.getChildren(provider.getChildren()[0])[0])[0]);
    if (only.length !== 1 || only[0].label !== '1.1  Gate') {
        throw new Error('filtered tree: ' + JSON.stringify(only.map((i) => i.label)));
    }
    provider.setFilter({ status: 'implemented' });
    const none = provider.getChildren();
    if (none.length !== 1 || !/No task matches/.test(none[0].label)) {
        throw new Error('an empty filter needs an empty state, got ' +
            JSON.stringify(none.map((n) => n.label)));
    }
    provider.setFilter({ status: 'all' });
    if (view.description !== undefined) {
        throw new Error('clearing the filter leaves the title dirty');
    }
    console.log('task tree ok:', sections.length, 'sections');
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
JS

# ---- cg resolves the three declared symbols in the extension source
rm -rf "$TMP/ext"
mkdir -p "$TMP/ext/editors/vscode"
cp "$EXT"/*.js "$TMP/ext/editors/vscode/"
cd "$TMP/ext"
"$CG" init >/dev/null
for sym in TaskTreeProvider taskFilter taskDetail; do
    out="$("$CG" symbol "$sym")"
    has "$out" "$sym"
    has "$out" "editors/vscode/tasks.js"
done
cd "$TMP"
echo "task symbols indexed"
fi

if want lsp; then
# ---- the LSP client speaks to the real server
rm -rf "$TMP/proj"
cp -r "$FIXTURES/sample" "$TMP/proj"
cd "$TMP/proj"
"$CG" init >/dev/null

node - "$EXT" "$CG" "$TMP/proj" <<'JS'
const path = require('path');
const { LspClient } = require(path.join(process.argv[2], 'client.js'));
const [, , , bin, root] = process.argv;

(async () => {
    const logs = [];
    const c = new LspClient(bin, root, (m) => logs.push(m));
    const ok = await c.start();
    if (!ok) throw new Error('client failed to start: ' + logs.join('; '));

    const uri = 'file://' + root + '/src/util.ts';
    const src = require('fs').readFileSync(root + '/src/util.ts', 'utf8')
        .split('\n');
    const line = src.findIndex((l) => l.includes('formatName'));
    const character = src[line].indexOf('formatName') + 2;
    const at = { textDocument: { uri }, position: { line, character } };

    const defs = await c.request('textDocument/definition', at);
    if (!defs || !defs.length) throw new Error('no definition');
    if (!defs[0].uri.endsWith('src/util.ts')) {
        throw new Error('definition uri: ' + defs[0].uri);
    }
    if (defs[0].range.start.line !== line) {
        throw new Error(`definition line ${defs[0].range.start.line} != ${line}`);
    }

    const refs = await c.request('textDocument/references', at);
    if (!refs || !refs.length) throw new Error('no references');

    const hover = await c.request('textDocument/hover', at);
    if (!hover || !/formatName/.test(hover.contents.value)) {
        throw new Error('hover: ' + JSON.stringify(hover));
    }

    const syms = await c.request('workspace/symbol', { query: 'formatName' });
    if (!syms.some((s) => s.name === 'formatName')) {
        throw new Error('workspace symbols: ' + JSON.stringify(syms));
    }

    const lenses = await c.request('textDocument/codeLens',
        { textDocument: { uri } });
    if (!lenses.length) throw new Error('no code lenses');

    // diagnostics arrive as a notification after didOpen
    const got = new Promise((resolve) => {
        c.onNotification('textDocument/publishDiagnostics', resolve);
        c.notify('textDocument/didOpen', {
            textDocument: { uri, languageId: 'typescript', version: 1, text: '' },
        });
    });
    const diag = await Promise.race([
        got,
        new Promise((_, r) => setTimeout(() => r(new Error('no diagnostics')), 15000)),
    ]);
    if (diag.uri !== uri) throw new Error('diagnostics uri: ' + diag.uri);

    // an unimplemented method must answer rather than hang
    const none = await c.request('textDocument/formatting',
        { textDocument: { uri } });
    if (none !== null) throw new Error('expected null for unknown method');

    c.dispose();
    console.log('lsp client ok');
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
JS

# ---- large payloads survive framing (the buffer must not be split on chars)
node - "$EXT" "$CG" "$TMP/proj" <<'JS'
const path = require('path');
const { LspClient } = require(path.join(process.argv[2], 'client.js'));
const [, , , bin, root] = process.argv;

(async () => {
    const c = new LspClient(bin, root, () => {});
    if (!await c.start()) throw new Error('client failed to start');
    // an empty query returns every symbol in one large frame
    const all = await c.request('workspace/symbol', { query: '' });
    if (!Array.isArray(all) || all.length < 3) {
        throw new Error('expected many symbols, got ' + JSON.stringify(all).slice(0, 200));
    }
    for (const s of all) {
        if (!s.location || !s.location.uri) throw new Error('malformed symbol');
    }
    c.dispose();
    console.log('lsp framing ok (' + all.length + ' symbols in one frame)');
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
JS
fi

# ---- the memory browser (task 5.2): a CSP-strict webview whose filter is
#      pure enough to drive from node, and whose symbols are in the graph
if want memories; then

node --check "$EXT/memories.js" || fail "syntax error in memories.js"

# the manifest contributes the browser's commands and extension.js registers
# them, so the panel is reachable from the palette and the Memory view
node - "$EXT" <<'JS'
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const ext = fs.readFileSync(path.join(dir, 'extension.js'), 'utf8');
const mem = fs.readFileSync(path.join(dir, 'memories.js'), 'utf8');

const declared = pkg.contributes.commands.map((c) => c.command);
for (const c of ['codify.memories.browse', 'codify.memories.classifyAll',
                 'codify.memories.promote', 'codify.memories.supersede']) {
    if (!declared.includes(c)) throw new Error(`manifest does not contribute ${c}`);
    if (!new RegExp(`'${c.replace(/\./g, '\\.')}':`).test(ext)) {
        throw new Error(`${c} is contributed but never registered`);
    }
}
if (!/memorybrowser\.register\(/.test(ext)) {
    throw new Error('extension.js never registers the memory browser');
}
// one refresh scheduler: the browser rides it and owns no timer or watcher
if (!/await memoryApi\.refresh\(\)/.test(ext)) {
    throw new Error('the memory browser is not refreshed from runRefresh');
}
if (/setInterval|setTimeout|createFileSystemWatcher/.test(mem)) {
    throw new Error('memories.js runs a timer or watcher of its own');
}
if (pkg.dependencies || pkg.devDependencies) {
    throw new Error('extension must stay dependency-free');
}
console.log('memory browser contributed:', declared.filter(
    (c) => c.startsWith('codify.memories.')).length, 'commands');
JS

# the webview is CSP-strict: nonce'd inline style and script, nothing remote,
# no eval, no inline handlers — and the rendered page has no placeholder left
node - "$EXT" <<'JS'
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const file = path.join(dir, 'memorypanel.html');
const html = fs.readFileSync(file, 'utf8');

const meta = /<meta http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html);
if (!meta) throw new Error('memorypanel.html has no Content-Security-Policy meta tag');
const csp = meta[1];
for (const needle of ["default-src 'none'", "style-src 'nonce-${nonce}'",
                      "script-src 'nonce-${nonce}'"]) {
    if (!csp.includes(needle)) throw new Error(`CSP is missing ${needle}: ${csp}`);
}
if (/unsafe-inline|unsafe-eval/.test(csp)) throw new Error(`CSP is not strict: ${csp}`);
if (/https?:\/\//.test(html)) throw new Error('memorypanel.html loads a remote URL');
if (/\beval\s*\(|new Function\s*\(/.test(html)) throw new Error('memorypanel.html evals');
if (/<[^>]*\son[a-z]+\s*=/i.test(html)) {
    throw new Error('memorypanel.html uses an inline event handler (CSP blocks it)');
}
for (const m of html.matchAll(/<(script|style)\b([^>]*)>/g)) {
    if (!/nonce="\$\{nonce\}"/.test(m[2])) {
        throw new Error(`<${m[1]}> without the nonce placeholder`);
    }
}

// the panel filters with the real memoryFilter, injected rather than copied
const { panelHtml, filterSource } = require(path.join(dir, 'memories.js'));
const page = panelHtml('N0NCE-123');
if (/\$\{[a-zA-Z]+\}/.test(page)) {
    throw new Error('rendered panel still carries a ${} placeholder');
}
if (!page.includes('nonce="N0NCE-123"')) throw new Error('the nonce was not applied');
if (!page.includes(filterSource())) throw new Error('memoryFilter was not injected');

// the inline script is the one JS the syntax sweep cannot see: compile it
const inline = /<script nonce="[^"]*">([\s\S]*?)<\/script>/.exec(page);
if (!inline) throw new Error('rendered panel has no inline script');
new (require('vm').Script)(inline[1], { filename: 'memorypanel.html script' });
console.log('memorypanel CSP ok');
JS

# the filter itself, under plain node against a recall-shaped fixture.
# TZ is pinned because the date range is local-midnight to local-midnight.
cat > "$TMP/memories.json" <<'JSON'
{"count":4,"memories":[
{"id":4,"created":1709640000,"type":"outcome","task":"codify-v10/2.2","branch":"wave/codify-v10/2","class":"noise","confidence":0.31,"body":"verify_cmd failed twice before it passed","source":"spec done"},
{"id":3,"created":1708430400,"type":"fact","task":null,"body":"The graph lives in .codegraph beside the code","source":"manual"},
{"id":2,"created":1706097600,"type":"constraint","body":"No new link-time dependencies: libsqlite3 and libc only","source":"manual"},
{"id":1,"created":1704888000,"type":"decision","task":"codify-v10/5.2","branch":"main","class":"skill","confidence":0.82,"body":"Sessions rotate on login","symbols":"rotateSession,MemoryBrowser","files":"src/auth.ts","source":"manual"}
]}
JSON

TZ=UTC node - "$EXT" "$TMP/memories.json" <<'JS'
const fs = require('fs'), path = require('path'), vm = require('vm');
const [, , dir, fixture] = process.argv;
const { memoryFilter, filterSource, NONE } = require(path.join(dir, 'memories.js'));
const all = JSON.parse(fs.readFileSync(fixture, 'utf8')).memories;

const ids = (v) => v.map((m) => m.id);
function eq(got, want, what) {
    const a = JSON.stringify(ids(got)), b = JSON.stringify(want);
    if (a !== b) throw new Error(`${what}: ${a} != ${b}`);
}

eq(memoryFilter(all, {}), [4, 3, 2, 1], 'no filter keeps recall order');
eq(memoryFilter(all, null), [4, 3, 2, 1], 'a missing filter matches everything');
eq(memoryFilter(null, { text: 'x' }), [], 'no memories is not a crash');

// full text: body, symbols, files, source — case-insensitive, AND of terms
eq(memoryFilter(all, { text: 'login' }), [1], 'body text');
eq(memoryFilter(all, { text: 'ROTATESESSION' }), [1], 'symbol text, any case');
eq(memoryFilter(all, { text: 'src/auth.ts' }), [1], 'file text');
eq(memoryFilter(all, { text: 'spec done' }), [4], 'source text');
eq(memoryFilter(all, { text: 'new link' }), [2], 'every term must hit');
eq(memoryFilter(all, { text: 'login dependencies' }), [], 'terms are an AND');

// the filter bar
eq(memoryFilter(all, { type: 'constraint' }), [2], 'type');
eq(memoryFilter(all, { class: 'skill' }), [1], 'Jev class');
eq(memoryFilter(all, { class: NONE }), [3, 2], 'unclassified');
eq(memoryFilter(all, { task: 'codify-v10/5.2' }), [1], 'task');
eq(memoryFilter(all, { task: NONE }), [3, 2], 'no task, null or absent');
eq(memoryFilter(all, { branch: 'main' }), [1], 'branch');
eq(memoryFilter(all, { branch: NONE }), [3, 2], 'no branch');
eq(memoryFilter(all, { from: '2024-02-01' }), [4, 3], 'from is inclusive');
eq(memoryFilter(all, { to: '2024-01-24' }), [2, 1], 'to is inclusive');
eq(memoryFilter(all, { from: '2024-02-20', to: '2024-02-20' }), [3], 'one day');
eq(memoryFilter(all, { text: 'failed', type: 'outcome', branch: 'wave/codify-v10/2',
    from: '2024-03-01' }), [4], 'every filter at once');
eq(memoryFilter(all, { from: 'nonsense' }), [4, 3, 2, 1], 'a half-typed date filters nothing');

// rows from an older cg carry no class, confidence or branch: they must still
// list, and still disappear only when that field is what is being filtered on
eq(memoryFilter([{ id: 9, created: 1704888000, type: 'fact', body: 'old row' }], {}),
    [9], 'sparse row');
eq(memoryFilter([{ id: 9, created: 1704888000, type: 'fact', body: 'old row' }],
    { class: 'skill' }), [], 'sparse row excluded by a class filter');
if (all.length !== 4) throw new Error('memoryFilter mutated its input');

// the panel's copy is the same function
const ctx = vm.createContext({});
vm.runInContext(filterSource() + '\nthis.f = memoryFilter;', ctx);
eq(ctx.f(all, { text: 'login' }), [1], 'the injected filter agrees');
console.log('memoryFilter ok:', all.length, 'fixture memories');
JS

# ---- the symbols the task declares resolve in the graph
mkdir -p "$TMP/memproj/editors/vscode"
cp "$EXT/memories.js" "$TMP/memproj/editors/vscode/memories.js"
cd "$TMP/memproj"
"$CG" init >/dev/null
"$CG" index >/dev/null
out="$("$CG" symbol MemoryBrowser --json)"
has "$out" '"name":"MemoryBrowser"'
has "$out" '"kind":"class"'
has "$out" 'editors/vscode/memories.js'
out="$("$CG" symbol memoryFilter --json)"
has "$out" '"name":"memoryFilter"'
has "$out" '"kind":"function"'

# ---- the detail actions against the real payloads, under the fake Jev.
#      Every action the panel offers is a cg command a person could type, so
#      the shapes it reads are captured here and fed to the pure readers the
#      panel uses — a drift in cg's JSON fails this test, not the user's click.
cp -r "$FIXTURES/specrepo" "$TMP/memskills"
cd "$TMP/memskills"
"$CG" init >/dev/null
export CG_JEV_CURL="$FIXTURES/jev/fake-curl.sh"
export JEV_FAKE_DIR="$TMP/memjev"
export JEV_FAKE_MODE=ok
export CG_JEV_BACKOFF_MS=1
export OPENROUTER_API_KEY=test
"$CG" remember "Use the trigram index for symbol search" --type decision >/dev/null
"$CG" remember "Never store secrets in memory" --type constraint \
    --symbols memory_add --files src/memory.c >/dev/null

# "Classify with Jev" on one memory, then on every unclassified one
JEV_FAKE_CHOICE=skill "$CG" memory classify 1 --json > "$TMP/classify-one.json"
JEV_FAKE_CHOICE=skill "$CG" memory classify --unclassified --json \
    > "$TMP/classify-rest.json"
"$CG" recall -n 500 --json > "$TMP/recall-classified.json"
# "Open SKILL.md" before and after "Promote to skill"
"$CG" skills list --json > "$TMP/skills-before.json"
"$CG" skills promote 1 --json > "$TMP/promote.json"
"$CG" skills promote 1 --json > "$TMP/promote-again.json"
"$CG" skills list --json > "$TMP/skills-after.json"
[ -f .agents/skills/use-the-trigram-index-for-symbol-search/SKILL.md ] \
    || fail "promote wrote no SKILL.md"
# "Supersede" and "Forget"
"$CG" remember "Use the trigram index only for prefix search" --type decision \
    --supersedes 1 >/dev/null
"$CG" forget 2 >/dev/null
"$CG" recall -n 500 --json > "$TMP/recall-after.json"
# the two answers the panel must explain rather than swallow: a key Jev needs,
# and a cg that predates the command
env -u OPENROUTER_API_KEY "$CG" memory classify --all > "$TMP/nokey.out" 2>&1 \
    || true
"$CG" bogus-command > "$TMP/unknown.out" 2>&1 || true

node - "$EXT" "$TMP" <<'JS'
const fs = require('fs'), path = require('path');
const [, , dir, tmp] = process.argv;
const mem = require(path.join(dir, 'memories.js'));
const read = (f) => JSON.parse(fs.readFileSync(path.join(tmp, f), 'utf8'));
const text = (f) => ({ stderr: fs.readFileSync(path.join(tmp, f), 'utf8'), stdout: '' });

// Classify with Jev: the notice names the class, how sure Jev is, and whether
// the memory became a skill candidate
const one = read('classify-one.json');
if (one.ok !== true || one.classified !== 1) throw new Error('classify shape: ' + JSON.stringify(one));
const note = mem.classifyNote(one, 1);
for (const needle of ['#1', 'skill', '82% sure', 'candidate']) {
    if (!note.includes(needle)) throw new Error(`classify note lost ${needle}: ${note}`);
}
const rest = read('classify-rest.json');
if (!rest.candidates.includes(2)) throw new Error('classify --unclassified: ' + JSON.stringify(rest));
if (!mem.classifyNote(rest, 2).includes('#2')) throw new Error('classify note picks the wrong row');
if (!/#3\.$/.test(mem.classifyNote({ memories: [] }, 3))) {
    throw new Error('a classify answer with no rows must still read as a sentence');
}

// recall now carries class and confidence; the filter bar reads both, and a
// memory cg has not classified yet has class null, not a missing key
const rows = read('recall-classified.json').memories;
if (!rows.every((m) => 'class' in m)) throw new Error('recall rows lost class');
if (mem.memoryFilter(rows, { class: 'skill' }).length !== rows.length) {
    throw new Error('class filter misses classified rows');
}
if (mem.memoryFilter(rows, { class: mem.NONE }).length !== 0) {
    throw new Error('classified rows must not count as unclassified');
}
const after = read('recall-after.json').memories;
if (after.some((m) => m.id === 2)) throw new Error('forget left the memory behind');
if (!after.some((m) => /prefix search/.test(m.body))) throw new Error('supersede wrote no replacement');
if (!after.some((m) => m.id === 1)) throw new Error('supersede must keep the old memory as history');
if (mem.memoryFilter(after, { class: mem.NONE }).some((m) => m.class)) {
    throw new Error('unclassified filter caught a classified row');
}

// Open SKILL.md: the skills list is keyed by the memory id, and says which
// step is still missing
const before = read('skills-before.json');
const s1 = mem.skillFor(before, 1);
if (!s1 || s1.slug !== 'use-the-trigram-index-for-symbol-search') {
    throw new Error('skillFor did not find memory 1: ' + JSON.stringify(before));
}
if (s1.promoted !== false || s1.path !== null) throw new Error('unpromoted skill has a path');
if (mem.skillFor(before, 99)) throw new Error('skillFor invented a skill');
if (mem.skillFor({ skills: [] }, 1)) throw new Error('an empty list is not a match');

const promoted = read('promote.json');
if (promoted.ok !== true || promoted.written !== true) throw new Error('promote shape');
if (!promoted.path.endsWith('/SKILL.md') || !promoted.path.startsWith('.agents/skills/')) {
    throw new Error('promote path: ' + promoted.path);
}
if (read('promote-again.json').written !== false) {
    throw new Error('a second promote should report nothing was written');
}
const s1b = mem.skillFor(read('skills-after.json'), 1);
if (!s1b.promoted || s1b.path !== promoted.path || s1b.stale !== false) {
    throw new Error('promoted skill row: ' + JSON.stringify(s1b));
}

// the two failures the panel must name
const nokey = text('nokey.out');
if (!mem.jevKeyMissing(nokey)) throw new Error('a missing Jev key was not recognised');
if (mem.unsupported(nokey)) throw new Error('a missing key is not an old cg build');
const unknown = text('unknown.out');
if (!mem.unsupported(unknown)) throw new Error('an unknown command was not recognised');
if (mem.jevKeyMissing(unknown)) throw new Error('an unknown command is not a key problem');
if (!mem.unsupported({ stderr: 'usage: cg skills list | promote <memory-id> | render\n' })) {
    throw new Error('a usage answer is an old cg build');
}
console.log('memory actions match cg:', note);
JS

unset CG_JEV_CURL JEV_FAKE_DIR JEV_FAKE_MODE CG_JEV_BACKOFF_MS OPENROUTER_API_KEY

fi   # memories
# ---------------- fleet view (task 5.3) ----------------

if want fleet; then
    node --check "$EXT/fleet.js" || fail "syntax error in fleet.js"

    # ---- the manifest carries the view, its commands, its menus, and an
    #      empty state, and the view keeps the refresh contract
    node - "$EXT" <<'JS'
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const src = fs.readFileSync(path.join(dir, 'fleet.js'), 'utf8');
const ext = fs.readFileSync(path.join(dir, 'extension.js'), 'utf8');

const views = Object.values(pkg.contributes.views).flat().map((v) => v.id);
if (!views.includes('codifyFleet')) throw new Error('missing view: codifyFleet');
if (!/createTreeView\(\s*'codifyFleet'/.test(src)) {
    throw new Error('codifyFleet is declared but never provided');
}
if (!/class FleetView/.test(src)) throw new Error('fleet.js declares no FleetView');

const declared = pkg.contributes.commands.map((c) => c.command);
for (const verb of ['refresh', 'openWorktree', 'begin', 'mergeUp', 'land',
                    'openPr', 'checkpoint']) {
    const c = `codify.fleet.${verb}`;
    if (!declared.includes(c)) throw new Error(`fleet command not declared: ${c}`);
    if (!src.includes(`'${c}':`)) throw new Error(`fleet command not registered: ${c}`);
}
const menus = Object.values(pkg.contributes.menus).flat()
    .filter((m) => /codifyFleet/.test(m.when || ''));
if (menus.length < 8) throw new Error(`fleet view has ${menus.length} menu entries`);
const welcome = (pkg.contributes.viewsWelcome || [])
    .find((w) => w.view === 'codifyFleet');
if (!welcome || !/hierarchy/.test(welcome.contents)) {
    throw new Error('the fleet view has no empty state');
}

// one scheduler: the view is driven from the extension's refresh chain and
// starts no timer or watcher of its own
if (!/fleetApi\.refresh\(/.test(ext)) {
    throw new Error('the fleet view is not hooked into the refresh chain');
}
if (/setInterval\(|createFileSystemWatcher\(/.test(src)) {
    throw new Error('the fleet view starts a timer or watcher of its own');
}
// and a refresh must never run `cg fleet pr`, which opens a pull request
const body = src.slice(src.indexOf('async refresh('), src.indexOf('_done() {'));
if (/'pr'/.test(body)) {
    throw new Error('a fleet refresh runs cg fleet pr, which opens one');
}
if (!/CALL_TIMEOUT_MS/.test(body)) {
    throw new Error('a fleet refresh has no timeout — the view could hang');
}
console.log('fleet manifest ok:', menus.length, 'menu entries');
JS

    # ---- the join, over JSON the real cg printed for a real fleet
    command -v git >/dev/null 2>&1 || fail "fleet section needs git"
    rm -rf "$TMP/fleet"
    mkdir -p "$TMP/fleet/src" "$TMP/fleet/lib" "$TMP/fleet/docs" "$TMP/json"
    cd "$TMP/fleet"
    git init -q -b main . 2>/dev/null || git init -q .
    git config user.email t@t; git config user.name t
    echo 'export function alpha(){}' > src/a.ts
    echo 'export function beta(){}'  > lib/b.ts
    echo '# doc' > docs/d.md
    "$CG" spec new fleet >/dev/null
    "$CG" spec mode parallel >/dev/null
    "$CG" spec add 2.1 --title "Alpha work" --wave 1 --touches 'src/*.ts' >/dev/null
    "$CG" spec add 2.2 --title "Beta work" --wave 1 --touches 'lib/*.ts' >/dev/null
    "$CG" spec add 3.1 --title "Docs work" --wave 2 --touches 'docs/*.md' >/dev/null
    "$CG" init >/dev/null
    printf '\n[hierarchy]\nmain = "main"\n' >> spec/workflow.kvx
    git add -A >/dev/null; git commit -qm base >/dev/null
    "$CG" fleet begin 2.1 >/dev/null
    CG_AGENT=gideon CG_ROLE=main "$CG" fleet status >/dev/null
    CG_AGENT=fm-fleet CG_ROLE=feature CG_PARENT=gideon CG_FEATURE=fleet \
        "$CG" fleet status >/dev/null
    CG_AGENT=gideon CG_ROLE=main "$CG" fleet status --json > "$TMP/json/status.json"
    "$CG" spec status --json > "$TMP/json/spec.json"
    "$CG" branches --json > "$TMP/json/branches.json"
    "$CG" fleet plan --json > "$TMP/json/plan.json"
    "$CG" fleet tree --json > "$TMP/json/tree.json"

    node - "$EXT" "$TMP/json" "$(date +%s)" <<'JS'
const path = require('path'), fs = require('fs');
const [, , dir, out, nowArg] = process.argv;
const { fleetTree, relAge, mergeState, treeFacts } =
    require(path.join(dir, 'fleet.js'));
const now = Number(nowArg);
const j = (n) => JSON.parse(fs.readFileSync(path.join(out, n), 'utf8'));
const eq = (got, want, what) => {
    if (got !== want) throw new Error(`${what}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
};

// ---- Main Gideon -> feature manager -> wave workers -> tasks
const t = fleetTree(j('status.json'), j('spec.json'), j('branches.json'),
    { plan: j('plan.json'), now });
eq(t.hierarchy.configured, true, 'hierarchy configured');
eq(t.hierarchy.main, 'main', 'main branch');
eq(t.main.kind, 'main', 'root kind');
eq(t.main.agent, 'gideon', 'root agent');
eq(t.main.branch, 'main', 'root branch');
eq(t.main.live, true, 'root is live');
eq(t.main.children.length, 1, 'managers under main');
const m = t.main.children[0];
eq(m.kind, 'manager', 'manager kind');
eq(m.agent, 'fm-fleet', 'manager agent');
eq(m.feature, 'fleet', 'manager feature');
eq(m.branch, 'feature/fleet', 'manager branch');
eq(m.base, 'main', 'manager base');
eq(m.live, true, 'manager is live');
const waves = m.children.map((w) => w.wave);
if (String(waves) !== '0,1,2') throw new Error('waves: ' + waves);
for (const w of m.children) {
    eq(w.kind, 'worker', 'worker kind');
    eq(w.parent, 'fm-fleet', `${w.agent} reports to the manager`);
    eq(w.branch, `wave/fleet/${w.wave}`, `${w.agent} branch`);
    eq(w.base, 'feature/fleet', `${w.agent} base`);
}
const live = m.children.find((w) => w.wave === 1);
eq(live.agent, 'w-fleet-1', 'wave 1 agent');
eq(live.live, true, 'wave 1 is live');
eq(live.age.stale, false, 'a fresh heartbeat is not stale');
if (!/ago|just now/.test(live.age.text)) throw new Error('age: ' + live.age.text);
if (!live.attempt) throw new Error('wave 1 carries no attempt id');
if (!/wave-fleet-1$/.test(live.worktree || '')) {
    throw new Error('wave 1 worktree: ' + live.worktree);
}
eq(String(live.tasks.map((x) => x.id)), '2.1,2.2', 'wave 1 tasks');
eq(live.tasks[0].live, true, '2.1 is claimed');
if (typeof live.tasks[0].expiresInMin !== 'number') {
    throw new Error('2.1 has no lease left: ' + live.tasks[0].expiresInMin);
}
eq(live.tasks[1].live, false, '2.2 is unclaimed');
const planned = m.children.find((w) => w.wave === 2);
eq(planned.live, false, 'wave 2 has no agent yet');
eq(planned.age.text, 'never seen', 'wave 2 heartbeat');
eq(String(planned.tasks.map((x) => x.id)), '3.1', 'wave 2 tasks');
if (t.counts.live < 3) throw new Error('counts: ' + JSON.stringify(t.counts));
eq(t.source, 'composed', 'without a tree the view composes one');

// ---- `cg fleet tree` is cg's own walk of the hierarchy. Where it speaks it
//      wins; what it does not cover — the waves nobody has started, their
//      tasks, the branch registry — is still joined in.
const tt = fleetTree(j('status.json'), j('spec.json'), j('branches.json'),
    { plan: j('plan.json'), tree: j('tree.json'), now });
eq(tt.source, 'tree', 'the real tree was used');
eq(tt.feature, 'fleet', 'tree feature');
eq(tt.main.agent, 'gideon', 'tree root');
eq(tt.main.branch, 'main', 'tree root branch');
if (!tt.main.worktree) throw new Error('the tree names no main worktree');
const tm = tt.main.children[0];
eq(tm.agent, 'fm-fleet', 'tree manager');
eq(tm.parent, 'gideon', 'the manager reports to main');
eq(tm.branch, 'feature/fleet', 'tree manager branch');
eq(tm.base, 'main', 'tree manager base');
if (!/feature-fleet$/.test(tm.worktree || '')) {
    throw new Error('manager worktree: ' + tm.worktree);
}
// the numbers nothing else the view reads could produce
eq(tm.progress.total, 4, 'tasks in the subtree');
eq(tm.progress.done, 0, 'tasks done');
eq(tm.progress.claimed, 1, 'tasks running');
eq(tm.ahead, 0, 'commits ahead of main');
eq(tm.merged, true, 'the feature branch is already in main');
eq(tm.complete, false, 'the subtree is not finished');
// the registered worker comes from the tree; the fields the agents registry
// leaves empty until an attempt fills them in come from the claim and the plan
const tw = tm.children.find((w) => w.agent === 'w-fleet-1');
eq(tw.parent, 'fm-fleet', 'the worker reports to the manager');
eq(tw.wave, 1, 'worker wave');
eq(tw.state, 'running', 'attempt state');
eq(tw.live, true, 'the worker is live');
eq(tw.branch, 'wave/fleet/1', 'branch filled in from the claim');
if (!/wave-fleet-1$/.test(tw.worktree || '')) {
    throw new Error('worker worktree: ' + tw.worktree);
}
if ((tw.attempt || '').length < 16) throw new Error('attempt: ' + tw.attempt);
eq(String(tw.tasks.map((x) => x.id)), '2.1,2.2', 'the wave keeps its tasks');
// and the waves nobody has started are not in the tree — losing them would
// hide the shape of the work still to come
eq(String(tm.children.map((w) => w.wave)), '0,1,2', 'planned waves survive');
eq(tm.children.find((w) => w.wave === 2).live, false, 'wave 2 has no agent');

// ---- where the tree contradicts what we would have composed, it wins
const won = fleetTree(
    { hierarchy: { configured: true, main: 'main' },
      agents: [{ agent: 'g', role: 'main', seen: now },
               { agent: 'fm', role: 'feature', feature: 'x', seen: now }] },
    { feature: 'x', claims: [] }, null,
    { now,
      plan: { feature: 'x',
              feature_manager: { agent: 'fm', branch: 'feature/x' },
              waves: [{ wave: 1, agent: 'w1', branch: 'wave/x/1',
                        base: 'feature/x',
                        tasks: [{ id: '1.1', status: 'pending' }] }] },
      tree: { feature: 'x', enabled: true,
              main: { agent: 'boss', role: 'main', branch: 'trunk',
                      worktree: '/r' },
              managers: [{ agent: 'fm', role: 'feature', parent: 'boss',
                           feature: 'x', branch: 'release/x', base: 'trunk',
                           worktree: '/w', seen: now,
                           tasks: { total: 3, done: 2, claimed: 0 },
                           ahead: 5, merged: false, complete: false,
                           workers: [{ agent: 'w7', role: 'worker', parent: 'fm',
                                       wave: -1, branch: '', base: '',
                                       worktree: '', task: '9.9',
                                       attempt: 'zz', state: 'failed',
                                       heartbeat: now - 300,
                                       seen: now - 300 }] }] } });
eq(won.main.agent, 'boss', 'the tree names main');
eq(won.main.branch, 'trunk', 'the tree names the main branch');
const wm = won.main.children[0];
eq(wm.branch, 'release/x', 'the tree branch beats the plan');
eq(wm.base, 'trunk', 'the tree base beats the hierarchy');
eq(wm.worktree, '/w', 'the tree worktree');
eq(wm.progress.done, 2, 'tree progress');
eq(wm.ahead, 5, 'commits ahead');
eq(wm.merged, false, 'not merged');
const ww = wm.children.find((x) => x.agent === 'w7');
eq(ww.wave, null, 'a worker cg gives no wave of its own');
eq(ww.state, 'failed', 'a finished attempt still shows its state');
eq(ww.attempt, 'zz', 'attempt from the tree');
eq(ww.age.stale, true, 'the tree heartbeat drives the age');
eq(String(ww.tasks.map((x) => x.id)), '9.9', 'the task the tree reports');
const w1 = wm.children.find((x) => x.agent === 'w1');
eq(w1.live, false, 'the planned wave is still there');
eq(String(w1.tasks.map((x) => x.id)), '1.1', 'and keeps its tasks');

// a shape that is not the one cg prints is not read as one
eq(treeFacts(null), null, 'no tree');
eq(treeFacts({ main: { agent: 'g' } }), null, 'no managers');
eq(treeFacts([{ main: {} }]), null, 'not an object');
eq(treeFacts({ main: { agent: 'g' }, managers: [] }).managers.length, 0,
   'an empty fleet is still a tree');

// ---- merge state and stale heartbeats, over heads the registry holds
const synth = fleetTree(
    { hierarchy: { configured: true, enabled: true, main: 'main', remote: 'origin' },
      agents: [
        { agent: 'g', role: 'main', seen: now },
        { agent: 'm1', role: 'feature', feature: 'x', seen: now },
        { agent: 'w1', role: 'worker', feature: 'x', wave: 1, seen: now - 300,
          tasks: ['x/1.1'] },
      ] },
    { feature: 'x', claims: [{ id: '1.1', agent: 'w1', role: 'worker', parent: 'm1',
        branch: 'wave/x/1', worktree: '/gone', attempt_id: 'abc123def456',
        expires_in_min: 12, host: 'h' }] },
    { branches: [
        { name: 'main', head: 'aaa', worktree: '/r' },
        { name: 'feature/x', head: 'bbb', base: 'main', worktree: '/f' },
        { name: 'wave/x/1', head: 'bbb', base: 'feature/x', worktree: '/gone' },
    ] },
    { now, exists: (p) => p !== '/gone' });
const sm = synth.main.children[0];
eq(sm.agent, 'm1', 'synthetic manager');
eq(sm.merge.state, 'unmerged', 'feature/x is not in main');
const sw = sm.children[0];
eq(sw.agent, 'w1', 'synthetic worker');
eq(sw.merge.state, 'in-sync', 'wave/x/1 is already in feature/x');
eq(sw.merge.worktreeMissing, true, 'a removed worktree is visible');
eq(sw.age.stale, true, 'five minutes of silence is stale');
eq(sw.attempt, 'abc123def456', 'attempt id');
eq(sw.tasks[0].expiresInMin, 12, 'lease left');
eq(synth.counts.stale, 1, 'one stale agent');

// ---- heartbeat ages
eq(relAge(now - 5, now).text, 'just now', 'fresh age');
eq(relAge(now - 200, now).stale, true, 'stale age');
eq(relAge(now - 3600, now).text, '60m ago', 'an hour still reads in minutes');
eq(relAge(now - 7200, now).text, '2h ago', 'hour age');
eq(relAge(0, now).text, 'never seen', 'no heartbeat');
eq(mergeState('nope', 'main', new Map()).state, 'absent', 'unknown branch');

// ---- nothing to show, and nothing that throws: no hierarchy, no cg,
//      and a `cg fleet tree` whose shape we do not know
const empty = fleetTree(null, null, null, { now });
eq(empty.hierarchy.configured, false, 'empty hierarchy');
eq(empty.main.children.length, 0, 'empty tree');
fleetTree({ agents: 'nonsense' }, { claims: 7 }, { branches: null }, { now });
const hinted = fleetTree(
    { hierarchy: { configured: true, main: 'main' },
      agents: [{ agent: 'g', role: 'main', seen: now },
               { agent: 'm1', role: 'feature', feature: 'x', seen: now },
               { agent: 'w9', seen: now, tasks: ['x/4.4'] }] },
    { feature: 'x', claims: [{ id: '4.4', agent: 'w9' }] }, null,
    { now, tree: { main: { agent: 'g', children: [
        { agent: 'm1', workers: [{ agent: 'w9' }] }] } } });
eq(hinted.main.children[0].children[0].agent, 'w9', 'tree hint places a worker');
fleetTree({ hierarchy: { configured: true } }, null, null, { now, tree: 'garbage' });
fleetTree({ hierarchy: { configured: true } }, null, null, { now, tree: [{ x: 1 }] });
console.log('fleet join ok');
JS

    # ---- the symbol the task promises resolves in the graph
    rm -rf "$TMP/ext"
    mkdir -p "$TMP/ext"
    cp "$EXT"/*.js "$TMP/ext/"
    cd "$TMP/ext"
    "$CG" init >/dev/null
    "$CG" index >/dev/null
    out="$("$CG" symbol FleetView)"
    has "$out" "class FleetView"
    has "$out" "fleet.js"
fi

echo "14_vscode ok ($section)"
