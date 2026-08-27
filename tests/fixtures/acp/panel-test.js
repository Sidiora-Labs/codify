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
    'livedot'];

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

/* ---- the chat renders an agent message as markdown ---- */
function markdown() {
    step = 'markdown';
    const p = load();
    p.send({ type: 'init', idle: true, driver: 'claude', drivers: ['codex', 'claude'] });
    p.send({ type: 'chunk', role: 'agent', text: '## Plan\n\nUse `cg brief` and ' });
    p.send({ type: 'chunk', role: 'agent',
        text: 'edit src/acp.c:42.\n\n- one\n- two\n\n```c\nint x = 1;\n```\n' });

    const msg = p.log.querySelector('.msg.agent');
    assert(msg, 'agent message rendered');
    assert(msg.querySelector('h2'), 'heading rendered from markdown');
    assert(msg.querySelector('code.inline').textContent === 'cg brief',
        'inline code rendered');
    assert(msg.querySelectorAll('li').length === 2, 'list items rendered');
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

    /* streaming keeps one message, not one per chunk */
    assert(p.log.querySelectorAll('.msg.agent').length === 1,
        'streamed chunks stay in a single message');
    assert(!p.log.querySelector('.welcome'), 'welcome cleared once the chat starts');
    ok('markdown, code blocks, and clickable file paths');
}

/* ---- tool calls, permissions, plan ---- */
function cards() {
    step = 'cards';
    const p = load();
    p.send({ type: 'tool', call: { toolCallId: 't1', title: 'Write acp.js',
        kind: 'edit', status: 'pending' } });
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

    p.send({ type: 'permission', pid: 9, title: 'Write file',
        options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }] });
    const perm = p.log.querySelector('.card.perm');
    assert(perm, 'permission card rendered');
    const buttons = perm.querySelectorAll('button');
    assert(buttons.length === 3, 'head plus both options are buttons');
    buttons[1].click();
    const answer = p.posted.find((x) => x.type === 'permission');
    assert(answer && answer.pid === 9 && answer.optionId === 'allow-once',
        'the selected optionId goes back to the extension');
    p.send({ type: 'permission_done', pid: 9, answer: 'Allow once' });
    assert(perm.classList.contains('answered'), 'answered permission is marked');
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

/* ---- session state: task chip, running, reset ---- */
function state() {
    step = 'state';
    const p = load();
    assert(p.log.querySelector('.welcome'), 'welcome shown when idle');
    p.send({ type: 'init', idle: true, driver: 'codex', drivers: ['codex', 'claude'],
        feature: 'codify-v05 · parallel' });
    assert(p.doc.getElementById('ctxfeature').textContent === 'codify-v05 · parallel',
        'feature and mode shown in the context bar');

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

markdown();
cards();
composer();
state();
handshake();
console.log('agent panel: all scenarios pass');
