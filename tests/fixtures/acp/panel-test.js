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
    'refreshhistory', 'buildversion'];

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
    assert(card.querySelector('pre.del') && card.querySelector('pre.add'),
        'diff rendered as removed + added');
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
handshake();
responsiveContract();
console.log('agent panel: all scenarios pass');
