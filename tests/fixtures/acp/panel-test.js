#!/usr/bin/env node
/* Drives the agent panel's inline script under a DOM shim: rendering,
 * markdown, tool cards, permissions, the slash palette, and the messages it
 * posts back to the extension. Usage: node panel-test.js <agentpanel.html> */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { bootstrap } = require('./dom-shim.js');

const HTML = fs.readFileSync(path.resolve(process.argv[2]), 'utf8');
let step = '';
function ok(what) { console.log(`ok: ${what}`); }
function assert(cond, what) {
    if (!cond) { console.error(`FAIL [${step}]: ${what}`); process.exit(1); }
}

const IDS = ['log', 'scroll', 'input', 'statusline', 'driver', 'taskchip',
    'taskstatus', 'slashmenu', 'tobottom', 'send', 'stop', 'ctxfeature', 'hint',
    'livedot', 'sessionbar', 'sessiontitle', 'mcpstate', 'usage', 'modewrap',
    'mode', 'configs', 'activitybar', 'activitylabel', 'toolactivity',
    'planactivity', 'queueactivity', 'permitactivity', 'history',
    'refreshhistory', 'buildversion', 'configure', 'cgbar', 'taskactions',
    'tooltimeline', 'agentactivity', 'nowline', 'usagebar', 'usagefill',
    'cost', 'retry'];

function load() {
    const m = HTML.match(/<script nonce="\$\{nonce\}">([\s\S]*?)<\/script>/);
    if (!m) throw new Error('no panel script');
    const doc = bootstrap(IDS);
    const posted = [];
    const listeners = [];
    const ctx = {
        acquireVsCodeApi: () => ({ postMessage: (x) => posted.push(x) }),
        document: doc,
        window: { addEventListener: (ev, fn) => { if (ev === 'message') listeners.push(fn); } },
        requestAnimationFrame: (fn) => fn(),
        setTimeout: (fn) => fn,
        console,
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    new vm.Script(m[1], { filename: 'agentpanel.js' }).runInContext(ctx);
    const send = (msg) => listeners.forEach((fn) => fn({ data: msg }));
    return { doc, posted, send,
        log: doc.getElementById('log'), input: doc.getElementById('input') };
}

/* ---- streamed Markdown: rich blocks, task nesting, and safe links ---- */
function markdown() {
    step = 'markdown';
    const p = load();
    p.send({ type: 'init', idle: true, driver: 'claude', drivers: ['codex', 'claude'] });
    p.send({ type: 'chunk', role: 'agent', text: '## Plan\n\nUse `cg brief` and ' });
    p.send({ type: 'chunk', role: 'agent',
        text: 'edit src/acp.c:42 with **care** and *focus*.\n\n' +
            '- [x] connected\n  - [ ] nested check\n\n' +
            '| signal | state |\n| --- | --- |\n| MCP | ready |\n\n' +
            '> Follow the evidence.\n\n[ACP docs](https://agentclientprotocol.com)\n\n' +
            '```c\nint x = 1;\n```\n' });

    const msg = p.log.querySelector('.msg.agent');
    assert(msg, 'agent message rendered');
    assert(msg.querySelector('h2'), 'heading rendered from markdown');
    assert(msg.querySelector('code.inline').textContent === 'cg brief',
        'inline code rendered');
    assert(msg.querySelectorAll('li').length === 2, 'nested list items rendered');
    assert(msg.querySelectorAll('li.task').length === 2, 'task lists rendered');
    assert(msg.querySelector('li ul'), 'nested list structure preserved');
    assert(msg.querySelector('strong') && msg.querySelector('em'),
        'emphasis rendered');
    assert(msg.querySelector('table') && msg.querySelector('blockquote'),
        'table and quote rendered');
    const code = msg.querySelector('.codeblock');
    assert(code, 'fenced code block rendered');
    assert(code.querySelector('pre').textContent === 'int x = 1;', 'code text kept verbatim');
    assert(/c/.test(code.querySelector('.cbhead').textContent), 'code language shown');

    const link = msg.querySelectorAll('.flink').find((b) => b.dataset.path === 'src/acp.c');
    assert(link, 'file path became a link');
    assert(link.dataset.line === '42', 'line number captured');
    link.click();
    const open = p.posted.find((x) => x.type === 'open');
    assert(open && open.path === 'src/acp.c' && open.line === 42,
        'clicking a file link asks the extension to open it');
    msg.querySelector('a').click();
    assert(p.posted.some((x) => x.type === 'external' &&
        x.href === 'https://agentclientprotocol.com'),
    'external links leave through the extension');

    /* streaming keeps one message, not one per chunk */
    assert(p.log.querySelectorAll('.msg.agent').length === 1,
        'streamed chunks stay in a single message');
    assert(!p.log.querySelector('.welcome'), 'welcome cleared once the chat starts');
    ok('markdown, code blocks, and clickable file paths');
}

/* ---- tool evidence plus the persistent activity summary ---- */
function cards() {
    step = 'cards';
    const p = load();
    p.send({ type: 'tool', call: { toolCallId: 't1', title: 'Write acp.js',
        kind: 'edit', status: 'pending' } });
    assert(p.doc.getElementById('toolactivity').textContent === '1 tool active',
        'active tool summarized above the transcript');
    let card = p.log.querySelector('.card.tool');
    assert(card, 'tool card created');
    assert(card.querySelector('.title').textContent.indexOf('Write acp.js') === 0,
        'tool title shown');

    p.send({ type: 'tool', call: { toolCallId: 't1', status: 'completed',
        content: [{ type: 'diff', path: 'editors/vscode/acp.js',
            oldText: 'old\n', newText: 'new\n' }],
        locations: [{ path: 'editors/vscode/acp.js', line: 7 }] } });
    card = p.log.querySelector('.card.tool');
    assert(p.log.querySelectorAll('.card.tool').length === 1,
        'the update reuses the same card');
    /* the extension normally pre-computes the rows; a bare oldText/newText
     * pair must still render rather than disappear */
    assert(card.querySelector('table.dtable'), 'diff rendered as a real diff table');
    assert(card.querySelector('tr.drow.del') && card.querySelector('tr.drow.add'),
        'diff rows are marked added and removed');
    assert(/\+1/.test(card.querySelector('.dhead').textContent) &&
        /1/.test(card.querySelector('.dhead .minus').textContent),
    'the diff header counts what changed');
    assert(p.doc.getElementById('toolactivity').textContent === '1 done',
        'completed tool summarized');
    card.querySelector('.locs .flink').click();
    assert(p.posted.some((x) => x.type === 'open' && x.line === 7),
        'tool locations open in the editor');

    p.send({ type: 'tool', call: { toolCallId: 't2', title: 'boom', status: 'failed' } });
    const failed = p.log.querySelectorAll('.card.tool')[1];
    assert(failed.classList.contains('failed'), 'failed tool call is marked');
    assert(!failed.classList.contains('closed'), 'failed tool call stays open');

    p.send({ type: 'plan', entries: [
        { content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }] });
    const plan = p.log.querySelector('.card.plan');
    assert(plan, 'plan card rendered');
    assert(plan.querySelector('.sub').textContent === '1/2', 'plan progress counted');
    assert(p.doc.getElementById('planactivity').textContent === 'plan 1/2',
        'plan progress stays visible while its card can collapse');

    p.send({ type: 'permission', pid: 9, title: 'Write file',
        options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }] });
    const perm = p.log.querySelector('.card.perm');
    assert(perm, 'permission card rendered');
    assert(p.doc.getElementById('permitactivity').textContent === 'permission needed',
        'permission need is visible outside its card');
    const buttons = perm.querySelectorAll('button');
    assert(buttons.length === 3, 'head plus both options are buttons');
    buttons[1].click();
    const answer = p.posted.find((x) => x.type === 'permission');
    assert(answer && answer.pid === 9 && answer.optionId === 'allow-once',
        'the selected optionId goes back to the extension');
    p.send({ type: 'permission_done', pid: 9, answer: 'Allow once' });
    assert(perm.classList.contains('answered'), 'answered permission is marked');
    assert(p.doc.getElementById('permitactivity').classList.contains('hidden'),
        'permission summary clears after an answer');
    ok('tool cards, diffs, plan progress, and permission round-trip');
}

/* ---- the composer: slash palette, history, submit ---- */
function composer() {
    step = 'composer';
    const p = load();
    const input = p.input;

    input.value = '/br';
    input.dispatch('input');
    assert(p.doc.body.classList.contains('slashing'), 'slash palette opened');
    const items = p.doc.getElementById('slashmenu').querySelectorAll('.sitem');
    assert(items.length === 1 && items[0].textContent.indexOf('/brief') === 0,
        'palette filtered to /brief');
    input.dispatch('keydown', { key: 'Enter', shiftKey: false });
    const slash = p.posted.find((x) => x.type === 'slash');
    assert(slash && slash.cmd === 'brief', 'accepting a zero-arg command runs it');
    assert(!p.doc.body.classList.contains('slashing'), 'palette closed after accept');

    input.value = '/context acp client';
    input.dispatch('keydown', { key: 'Enter', shiftKey: false });
    const ctx = p.posted.filter((x) => x.type === 'slash').pop();
    assert(ctx.cmd === 'context' && ctx.args === 'acp client',
        'arguments are passed through to the extension');

    input.value = 'plain question';
    input.dispatch('keydown', { key: 'Enter', shiftKey: false });
    const sent = p.posted.filter((x) => x.type === 'send').pop();
    assert(sent && sent.text === 'plain question', 'plain text is sent to the agent');
    assert(input.value === '', 'composer cleared after send');

    input.value = '';
    input.dispatch('keydown', { key: 'ArrowUp' });
    assert(input.value === 'plain question', 'ArrowUp recalls the last message');

    input.value = '/nope';
    input.dispatch('keydown', { key: 'Enter', shiftKey: false });
    assert(p.log.querySelector('.sysline.err'), 'unknown command reported inline');
    assert(!p.posted.some((x) => x.type === 'slash' && x.cmd === 'nope'),
        'unknown command never reaches the extension');
    ok('slash palette, arguments, history, and unknown commands');
}

/* ---- ACP-native session state and controls ---- */
function agentState() {
    step = 'agent-state';
    const p = load();
    p.send({ type: 'session', live: true });
    p.send({ type: 'connection', agent: { name: 'codex-acp' },
        mcpServers: ['codify'] });
    assert(p.doc.getElementById('mcpstate').textContent === 'MCP · codify',
        'the injected MCP server is visible');
    assert(p.doc.getElementById('sessiontitle').textContent === 'codex-acp',
        'the connected ACP adapter is visible');

    p.send({ type: 'mode', currentModeId: 'plan', modes: [
        { id: 'agent', name: 'Agent' }, { id: 'plan', name: 'Plan' }] });
    const mode = p.doc.getElementById('mode');
    assert(mode.value === 'plan', 'current ACP mode shown');
    mode.value = 'agent'; mode.dispatch('change');
    assert(p.posted.some((x) => x.type === 'set_mode' && x.modeId === 'agent'),
        'mode changes round-trip to the extension');

    p.send({ type: 'config', options: [
        { id: 'model', name: 'Model', type: 'select', currentValue: 'deep',
            options: [{ value: 'fast', name: 'Fast' }, { value: 'deep', name: 'Deep' }] },
        { id: 'thinking', name: 'Thinking', type: 'boolean', currentValue: true },
    ] });
    const selectors = p.doc.getElementById('configs').querySelectorAll('select');
    assert(selectors.length === 2, 'select and boolean ACP config controls rendered');
    selectors[1].value = 'false'; selectors[1].dispatch('change');
    assert(p.posted.some((x) => x.type === 'set_config' &&
        x.configId === 'thinking' && x.value === false),
    'config changes round-trip with their value type');

    p.send({ type: 'session_info', title: 'Refine agent panel' });
    p.send({ type: 'usage', used: 8000, size: 10000 });
    assert(p.doc.getElementById('sessiontitle').textContent === 'Refine agent panel',
        'session title updates in place');
    assert(p.doc.getElementById('usage').textContent === 'context 80%',
        'context usage is understandable');

    p.send({ type: 'agent_commands', commands: [
        { name: 'init', description: 'Initialize the workspace' },
        { name: 'review', description: 'Agent review' },
    ] });
    p.input.value = '/init'; p.input.dispatch('input');
    p.input.dispatch('keydown', { key: 'Enter', shiftKey: false });
    assert(p.posted.some((x) => x.type === 'agent_command' && x.name === 'init'),
        'an advertised agent command can be run from the composer');
    p.input.value = '/agent-review focus security';
    p.input.dispatch('keydown', { key: 'Enter', shiftKey: false });
    assert(p.posted.some((x) => x.type === 'agent_command' && x.name === 'review' &&
        x.input === 'focus security'),
    'agent command collisions are namespaced instead of shadowing Codify commands');
    ok('ACP commands, MCP state, modes, config, title, and usage');
}

/* ---- session state: task, build, history, running, queue, cancel, reset ---- */
function state() {
    step = 'state';
    const p = load();
    assert(p.log.querySelector('.welcome'), 'welcome shown when idle');
    p.send({ type: 'init', idle: true, version: '0.9.0',
        driver: 'codex', drivers: ['codex', 'claude'],
        feature: 'codify-v05 · parallel' });
    assert(p.doc.getElementById('ctxfeature').textContent === 'codify-v05 · parallel',
        'feature and mode shown in the context bar');
    assert(p.doc.getElementById('buildversion').textContent === 'v0.9.0',
        'the running extension version is visible');

    p.send({ type: 'sessions', sessions: [
        { sessionId: 'sess_old', title: 'Earlier work', driver: 'claude',
            updatedAt: '2026-08-28T12:00:00Z' },
    ] });
    const history = p.doc.getElementById('history');
    assert(history.children.length === 2 && /Earlier work/.test(history.textContent),
        'past-session selector shows workspace history');
    history.value = 'sess_old'; history.selectedIndex = 1; history.dispatch('change');
    assert(p.posted.some((x) => x.type === 'load_session' &&
        x.sessionId === 'sess_old' && x.driver === 'claude'),
    'selecting history requests the matching adapter session');
    p.doc.getElementById('refreshhistory').click();
    assert(p.posted.some((x) => x.type === 'refresh_sessions'),
        'history can be refreshed from the adapter');

    p.send({ type: 'task', task: { id: '3.2', title: 'Sidebar view', status: 'in_progress' } });
    const chip = p.doc.getElementById('taskchip');
    assert(/3\.2/.test(chip.textContent) && chip.classList.contains('attached'),
        'attached task shown on the chip');
    assert(p.doc.getElementById('taskstatus').textContent === 'in_progress',
        'task status pill updated');
    chip.click();
    assert(p.posted.some((x) => x.type === 'slash' && x.cmd === 'task'),
        'clicking the chip offers to attach a task');

    p.send({ type: 'turn', running: true });
    assert(p.doc.body.classList.contains('running'), 'running state toggles the composer');
    assert(p.doc.getElementById('activitylabel').textContent === 'Agent working',
        'activity says what the agent is doing');
    p.send({ type: 'queue', count: 2 });
    assert(p.doc.getElementById('queueactivity').textContent === '2 queued',
        'queued follow-ups remain visible');
    p.doc.getElementById('stop').click();
    assert(p.posted.some((x) => x.type === 'cancel'), 'Stop cancels the turn');
    p.send({ type: 'turn', running: false, stopReason: 'cancelled' });
    assert(!p.doc.body.classList.contains('running'), 'running cleared at turn end');
    assert(/cancelled/.test(p.log.textContent), 'stop reason surfaced');

    p.send({ type: 'cmdout', cmd: 'brief', ok: true, output: 'task 3.2 in progress' });
    assert(/task 3\.2 in progress/.test(p.log.querySelector('.card.cg').textContent),
        'cg output rendered as a card');

    p.send({ type: 'reset', driver: 'claude' });
    assert(!p.log.querySelector('.card.cg'), 'reset clears the transcript');
    assert(p.log.querySelector('.welcome'), 'reset restores the welcome');
    assert(!p.doc.getElementById('taskchip').classList.contains('attached'),
        'reset detaches the task');
    ok('context bar, task attach, turn state, and reset');
}

/* ---- providers: labelled adapters, the gear, and switching ---- */
function providers() {
    step = 'providers';
    const p = load();
    p.send({ type: 'init', idle: true, driver: 'codex', drivers: ['codex', 'claude', 'custom'],
        adapters: {
            codex: { label: 'Codex', command: 'npx -y @agentclientprotocol/codex-acp@1.7.0' },
            claude: { label: 'Claude Code', command: 'npx -y @zed-industries/claude-code-acp' },
            custom: { label: 'Custom', command: 'my-agent --acp' },
        } });
    const driver = p.doc.getElementById('driver');
    assert(driver.children.length === 3, 'every configured adapter is offered');
    assert(driver.children[1].textContent === 'Claude Code',
        'adapters are shown by label, not id');
    assert(/codex-acp@1\.7\.0/.test(driver.title), 'the selected adapter command is visible');
    driver.value = 'claude'; driver.dispatch('change');
    assert(p.posted.some((x) => x.type === 'driver' && x.value === 'claude'),
        'switching provider is sent to the extension');
    p.doc.getElementById('configure').click();
    assert(p.posted.some((x) => x.type === 'configure'),
        'the gear opens the provider configuration');
    p.send({ type: 'adapter', driver: 'custom',
        adapters: { codex: { label: 'Codex', command: 'x' },
            custom: { label: 'Custom', command: 'my-agent' } } });
    assert(driver.value === 'custom' && driver.children.length === 2,
        'adapter changes from the extension re-label the picker');
    ok('provider picker, labels, and configure gear');
}

/* ---- the Codify toolbar and task actions ---- */
function toolbar() {
    step = 'toolbar';
    const p = load();
    p.send({ type: 'init', idle: true, driver: 'codex', drivers: ['codex', 'claude'] });
    assert(p.doc.getElementById('taskactions').classList.contains('hidden'),
        'task actions wait for an attached task');
    const buttons = p.doc.body.querySelectorAll('.cgbtn');
    const names = buttons.map((b) => b.dataset.cmd);
    ['brief', 'next', 'status', 'review', 'check', 'guard', 'changes', 'remember',
        'implemented', 'done', 'handoff'].forEach((n) =>
        assert(names.includes(n), 'toolbar offers ' + n));
    buttons.find((b) => b.dataset.cmd === 'brief').click();
    assert(p.posted.some((x) => x.type === 'slash' && x.cmd === 'brief'),
        'toolbar buttons run the Codify command');
    buttons.find((b) => b.dataset.cmd === 'remember').click();
    assert(p.input.value === '/remember ', 'remember pre-fills the composer for the note');

    p.send({ type: 'task', task: { id: '5.2', title: 'Panel', status: 'in_progress' } });
    assert(!p.doc.getElementById('taskactions').classList.contains('hidden'),
        'task actions appear once a task is attached');
    buttons.find((b) => b.dataset.cmd === 'done').click();
    assert(p.posted.some((x) => x.type === 'slash' && x.cmd === 'done'),
        'done asks the extension to qualify the task');
    p.send({ type: 'cmdout', cmd: 'spec done 5.2', ok: false, open: true,
        output: 'verify_cmd failed' });
    const bad = p.log.querySelector('.card.cg');
    assert(bad.classList.contains('bad') && !bad.classList.contains('closed'),
        'a failed qualification is marked and left open');
    p.send({ type: 'task', task: null });
    assert(p.doc.getElementById('taskactions').classList.contains('hidden'),
        'task actions hide when the task detaches');
    ok('Codify toolbar and task actions');
}

/* ---- sub-agents, the tool timeline, and turn summaries ---- */
function subagents() {
    step = 'subagents';
    const p = load();
    p.send({ type: 'init', idle: true, driver: 'claude', drivers: ['codex', 'claude'] });
    p.send({ type: 'turn', running: true });
    assert(p.doc.getElementById('tooltimeline').classList.contains('hidden'),
        'timeline is empty until a tool runs');
    p.send({ type: 'tool', call: { toolCallId: 'a1', title: 'Task: explore the lexer',
        kind: 'other', status: 'in_progress',
        rawInput: { subagent_type: 'Explore', description: 'Find the lexer',
            prompt: 'Where is the lexer?' } } });
    const agent = p.log.querySelector('.card.agent');
    assert(agent, 'a Task tool call renders as a sub-agent card');
    assert(agent.querySelector('.kind').textContent === 'sub-agent', 'kind badge names it');
    assert(/Where is the lexer/.test(agent.querySelector('.inp').textContent),
        'the delegated prompt is shown');
    assert(p.doc.getElementById('agentactivity').textContent === '1 sub-agent active',
        'sub-agent activity is summarized');
    assert(p.doc.getElementById('toolactivity').classList.contains('hidden'),
        'sub-agents are not counted as plain tools');
    assert(/Task: explore the lexer/.test(p.doc.getElementById('nowline').textContent),
        'the now line says what is running');

    p.send({ type: 'tool', call: { toolCallId: 'c1', title: 'Read lexer.c', kind: 'read',
        status: 'completed', parentToolCallId: 'a1',
        locations: [{ path: 'src/lexer.c' }] } });
    assert(agent.querySelector('.children .card.tool'), 'child tool nests under its agent');
    assert(agent.querySelector('.title .sub').textContent === '1 tool',
        'the agent card counts its tools');
    const dots = p.doc.getElementById('tooltimeline').querySelectorAll('.tdot');
    assert(dots.length === 2, 'every call gets a timeline dot');
    assert(dots[1].classList.contains('completed') && dots[0].classList.contains('agent'),
        'dots carry status and agent shape');
    const child = agent.querySelector('.children .card.tool');
    assert(child.classList.contains('closed'), 'a finished child tool starts collapsed');
    dots[1].click();
    assert(!child.classList.contains('closed'), 'clicking a dot reveals its card');

    p.send({ type: 'tool', call: { toolCallId: 'a1', status: 'completed' } });
    assert(p.doc.getElementById('nowline').classList.contains('hidden'),
        'the now line clears when nothing runs');
    p.send({ type: 'tool', call: { toolCallId: 't9', title: 'boom', status: 'failed' } });
    p.send({ type: 'turn', running: false, stopReason: 'end_turn' });
    const sum = p.log.querySelector('.sysline.turnsum');
    assert(sum, 'turn summary rendered');
    assert(/turn complete/.test(sum.textContent) && /2 tools \(1 failed\)/.test(sum.textContent) &&
        /1 sub-agent/.test(sum.textContent) && /1 file touched/.test(sum.textContent),
    'summary counts tools, failures, sub-agents, and files');
    p.send({ type: 'usage', used: 80, size: 100 });
    assert(p.doc.getElementById('usagefill').style.width === '80%' &&
        p.doc.getElementById('usagebar').classList.contains('high'),
    'context usage draws as a bar');
    ok('sub-agents, tool timeline, now line, and turn summary');
}

/* ---- replayed harness text and the timeline row ---- */
function replay() {
    step = 'replay';
    const p = load();
    p.send({ type: 'init', idle: true, driver: 'claude', drivers: ['codex', 'claude'] });
    p.send({ type: 'chunk', role: 'user', harness: 'caveat', text: '' });
    p.send({ type: 'chunk', role: 'user', harness: 'command', text: 'clear' });
    p.send({ type: 'chunk', role: 'user', harness: 'compaction',
        text: 'This session is being continued from a previous conversation that ran out of context.\n\nSummary:\n1. Primary Request and Intent: fix the lock' });
    p.send({ type: 'chunk', role: 'user', text: 'real question' });
    assert(p.log.querySelectorAll('.msg.user').length === 1,
        'only what the user typed becomes a user bubble');
    assert(/local command · \/clear/.test(p.log.querySelector('.sysline.cmdnote').textContent),
        'a local command is a one-line note');
    const note = p.log.querySelector('details.harness.compaction');
    assert(note && /context compacted/.test(note.querySelector('summary').textContent),
        'a compaction summary collapses into a labelled note');
    assert(/fix the lock/.test(note.querySelector('pre').textContent),
        'the summary text stays available inside the note');

    for (let i = 0; i < 60; i++) {
        p.send({ type: 'tool', call: { toolCallId: 'r' + i, title: 'Read ' + i,
            kind: 'read', status: 'completed' } });
    }
    const tl = p.doc.getElementById('tooltimeline');
    assert(tl.querySelectorAll('.tdot').length === 48, 'the timeline keeps one row of dots');
    assert(tl.querySelector('.more').textContent === '+12', 'older calls fold into a count');
    ok('replayed harness text and timeline row cap');
}

/* ---- 5.3: diffs as diffs, terminal output as terminal output ---- */
function evidence() {
    step = 'evidence';
    const p = load();
    p.send({ type: 'init', idle: false, driver: 'claude', drivers: ['claude'],
        diffStyle: 'split' });
    p.send({ type: 'tool', call: { toolCallId: 'd1', title: 'Edit main.c',
        kind: 'edit', status: 'completed',
        content: [{ type: 'diff', path: 'src/main.c', added: 1, removed: 1,
            truncated: 3,
            rows: [{ t: 'ctx', s: 'int main(void) {', o: 1, n: 1 },
                { t: 'del', s: '    return 1;', o: 2, n: 0 },
                { t: 'add', s: '    return 0;', o: 0, n: 2 },
                { t: 'gap', s: '12 unchanged lines' }] }] } });
    const card = p.log.querySelector('.card.tool');
    const rows = card.querySelectorAll('tr.drow');
    assert(rows.length === 4, 'every row is drawn, collapsed context included');
    assert(rows[1].classList.contains('del') && rows[2].classList.contains('add'),
        'rows carry their add/remove colouring');
    assert(rows[1].querySelectorAll('td').length === 4,
        'the configured split style opens old beside new');
    assert(rows[1].querySelector('td.dcode.del'), 'the removed side is the marked one');
    assert(/12 unchanged lines/.test(rows[3].textContent),
        'unchanged runs collapse into a gap row');
    assert(/3 more rows/.test(card.querySelector('.dcut').textContent),
        'a cut diff says how much it is not showing');
    const toggle = card.querySelector('.dhead button.icon');
    assert(toggle.textContent === 'unified', 'the toggle offers the other style');
    toggle.click();
    assert(card.querySelectorAll('tr.drow')[1].querySelectorAll('td').length === 3,
        'a diff can be flipped to one column in place');
    card.querySelector('.dhead button.path').click();
    assert(p.posted.some((x) => x.type === 'open' && x.path === 'src/main.c'),
        'the diff header opens the file it changed');

    p.send({ type: 'tool', call: { toolCallId: 'x1', title: 'make test',
        kind: 'execute', status: 'failed',
        content: [{ type: 'content',
            content: { type: 'text', text: '\u001b[31mFAIL\u001b[0m 19_acp.sh' } },
        { type: 'terminal', terminalId: 'term-1', command: 'make test',
            exitCode: 2, output: 'ok 1\nnot ok 2' }] } });
    const run = p.log.querySelectorAll('.card.tool')[1];
    const blocks = run.querySelectorAll('pre.term');
    assert(blocks.length === 2, 'command output and terminals both render monospace');
    assert(blocks[0].textContent === 'FAIL 19_acp.sh',
        'ANSI escapes never reach the screen');
    assert(!run.querySelector('.out .md'),
        'command output is not re-interpreted as Markdown');
    assert(/exit 2/.test(run.querySelector('.termhead').textContent) &&
        run.querySelector('.termhead .rc.bad'), 'a non-zero exit is called out');
    ok('diff tables, split and unified, terminal output with ANSI stripped');
}

/* ---- 5.3: failures in place, retry, cancel, cost, and session switching ---- */
function chatControls() {
    step = 'chat-controls';
    const p = load();
    p.send({ type: 'init', idle: false, driver: 'claude', drivers: ['claude'] });
    assert(!p.doc.body.classList.contains('hasretry'),
        'retry stays hidden until something has been sent');

    p.send({ type: 'chunk', role: 'user', text: 'refactor the lexer' });
    p.send({ type: 'turn', running: true });
    assert(p.doc.body.classList.contains('hasretry'),
        'a sent prompt makes retry reachable');

    /* Esc cancels from the composer and from anywhere else */
    p.input.dispatch('keydown', { key: 'Escape' });
    assert(p.posted.some((x) => x.type === 'cancel'), 'Esc cancels the turn');
    p.posted.length = 0;
    p.doc.dispatch('keydown', { key: 'Escape' });
    assert(p.posted.some((x) => x.type === 'cancel'),
        'Esc still cancels when the focus has left the composer');

    /* a permission that dies with the turn is settled, not left spinning */
    p.send({ type: 'permission', pid: 4, title: 'Run make test', options: [] });
    const perm = p.log.querySelector('.card.perm');
    assert(/waiting for your answer/.test(perm.textContent),
        'the permission card says the agent is blocked on it');
    p.send({ type: 'permission_done', pid: 4, answer: 'cancelled with the turn' });
    assert(perm.classList.contains('answered') &&
        /cancelled with the turn/.test(perm.querySelector('.answer').textContent),
    'a settled permission reports how it ended');
    assert(p.doc.getElementById('permitactivity').classList.contains('hidden'),
        'no permission is left outstanding after a cancel');

    p.send({ type: 'turn', running: false, stopReason: 'error',
        ledger: { stopReason: 'error', ms: 4200, cost: 0.0123, tokens: 25400,
            sessionCost: 0.25, sessionTokens: 120000, currency: 'USD', turns: 3 } });
    const sum = p.log.querySelector('.sysline.turnsum');
    assert(/\$0\.012/.test(sum.textContent) && /25k tokens/.test(sum.textContent),
        'the turn says what it cost and how many tokens it used');
    assert(/4\.2s/.test(sum.textContent), 'the turn says how long it took');
    assert(p.doc.getElementById('cost').textContent === '$0.25',
        'the session total sits in the session bar');
    assert(/3 turns/.test(p.doc.getElementById('cost').title),
        'the session total explains itself on hover');

    p.send({ type: 'error', text: 'adapter exited: code 1',
        raw: 'adapter exited: code 1\n  at spawn()', retry: true });
    const err = p.log.querySelector('.card.err');
    assert(err, 'a failure renders in the transcript, not only in a notification');
    assert(/adapter exited/.test(err.querySelector('.emsg').textContent),
        'the readable message is shown');
    assert(/at spawn/.test(err.querySelector('.eraw pre').textContent),
        'the raw message stays available');
    err.querySelectorAll('.eacts button')[0].click();
    assert(p.posted.some((x) => x.type === 'slash' && x.cmd === 'retry'),
        'retry is reachable from the failure itself');
    err.querySelectorAll('.eacts button')[1].click();
    assert(p.posted.some((x) => x.type === 'copy' && /at spawn/.test(x.text)),
        'the raw message can be copied');
    p.doc.getElementById('retry').click();
    assert(p.posted.filter((x) => x.type === 'slash' && x.cmd === 'retry').length === 2,
        'the toolbar retry re-sends the last prompt too');

    p.send({ type: 'sessionlist', current: 'sess_now', sessions: [
        { sessionId: 'sess_now', title: 'This chat', driver: 'claude' },
        { sessionId: 'sess_old', title: 'Earlier work', driver: 'codex',
            updatedAt: '2026-08-28T12:00:00Z' }] });
    const list = p.log.querySelector('.card.sess');
    const rows = list.querySelectorAll('.row');
    assert(rows.length === 3, 'every known session plus a new chat is offered');
    assert(rows[0].classList.contains('current'), 'the live session is marked');
    rows[1].click();
    assert(p.posted.some((x) => x.type === 'load_session' &&
        x.sessionId === 'sess_old' && x.driver === 'codex'),
    'picking a session asks the extension to switch to it');
    rows[2].click();
    assert(p.posted.some((x) => x.type === 'slash' && x.cmd === 'new'),
        'a fresh chat is one click away');

    /* the palette must offer the turn controls it documents */
    p.input.value = '/'; p.input.dispatch('input');
    const names = p.doc.getElementById('slashmenu').querySelectorAll('.sitem')
        .map((s) => s.textContent);
    ['/cancel', '/retry', '/sessions'].forEach((n) =>
        assert(names.some((t) => t.indexOf(n) === 0), 'palette offers ' + n));

    p.send({ type: 'reset' });
    assert(p.doc.getElementById('cost').textContent === '' &&
        !p.doc.body.classList.contains('hasretry'),
    'a new chat starts with a clean ledger and nothing to retry');
    ok('cancel, retry, inline errors, cost ledger, and session switching');
}

/* ---- the ready handshake ---- */
function handshake() {
    step = 'handshake';
    const p = load();
    assert(p.posted.some((x) => x.type === 'ready'),
        'the panel announces itself instead of racing the first post');
    ok('ready handshake');
}

function responsiveContract() {
    step = 'responsive';
    assert(/@media \(max-width: 430px\)/.test(HTML), 'narrow sidebar breakpoint exists');
    assert(/@media \(min-width: 700px\)/.test(HTML), 'wide editor breakpoint exists');
    assert(/id="activitybar" role="status"/.test(HTML),
        'activity summary is announced accessibly');
    assert(/overflow: hidden/.test(HTML) && /min-width: 0/.test(HTML),
        'page and flex children guard against horizontal overflow');
    ok('responsive and accessible layout hooks');
}

markdown();
cards();
composer();
agentState();
state();
providers();
toolbar();
subagents();
replay();
evidence();
chatControls();
handshake();
responsiveContract();
console.log('agent panel: all scenarios pass');
