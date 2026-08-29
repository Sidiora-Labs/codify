#!/usr/bin/env node
/* Fake ACP agent for the integration tests: speaks newline-delimited
 * JSON-RPC 2.0 on stdio like claude-code-acp / codex-acp do.
 *
 * Env knobs:
 *   FAKE_ACP_PROTOVER  answer initialize with this protocolVersion
 *   FAKE_ACP_LOG       append every received request's params here (jsonl)
 *   FAKE_ACP_GARBAGE   emit one non-JSON line right after initialize
 *   FAKE_ACP_DIE       exit(7) immediately after answering initialize
 */
'use strict';

const fs = require('fs');
const PROTOVER = process.env.FAKE_ACP_PROTOVER
    ? Number(process.env.FAKE_ACP_PROTOVER) : 1;

let buf = '';
let nextId = 1000;                 /* agent -> client request ids */
const waiting = new Map();         /* id -> resolve */
let sessionCwd = '';
let cancelled = false;
let cancelTimer = null;
let pendingCancelPrompt = null;
let currentMode = 'agent';
let currentModel = 'fake-fast';
let thinking = true;

function modes() {
    return { currentModeId: currentMode, availableModes: [
        { id: 'agent', name: 'Agent', description: 'Work autonomously' },
        { id: 'plan', name: 'Plan', description: 'Plan before editing' },
    ] };
}

function configOptions() {
    return [
        { id: 'model', name: 'Model', type: 'select', category: 'model',
            currentValue: currentModel, options: [
                { value: 'fake-fast', name: 'Fast' },
                { value: 'fake-deep', name: 'Deep' },
            ] },
        { id: 'thinking', name: 'Thinking', type: 'boolean',
            category: 'thought_level', currentValue: thinking },
    ];
}

function replaySession(sid) {
    update(sid, { sessionUpdate: 'session_info_update',
        title: 'Past fake session', updatedAt: '2026-08-28T12:00:00Z' });
    update(sid, { sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'Continue the earlier work.' } });
    update(sid, { sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Earlier context restored.' } });
}

function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function notify(method, params) { send({ jsonrpc: '2.0', method, params }); }
function update(sessionId, u) { notify('session/update', { sessionId, update: u }); }

function request(method, params) {
    return new Promise((resolve) => {
        const id = nextId++;
        waiting.set(id, resolve);
        send({ jsonrpc: '2.0', id, method, params });
    });
}

function logLine(method, params) {
    if (!process.env.FAKE_ACP_LOG) return;
    fs.appendFileSync(process.env.FAKE_ACP_LOG,
        JSON.stringify({ method, params }) + '\n');
}

async function promptTurn(id, params) {
    const sid = params.sessionId;
    const text = (params.prompt || [])
        .filter((b) => b.type === 'text').map((b) => b.text).join('');

    update(sid, { sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text } });

    if (text.indexOf('cancel-me') >= 0) {
        /* stream slowly until session/cancel arrives */
        pendingCancelPrompt = { id, sid };
        let n = 0;
        cancelTimer = setInterval(() => {
            if (cancelled) return;
            update(sid, { sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: `tick ${++n} ` } });
        }, 50);
        return;
    }

    update(sid, { sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'planning the write' } });
    update(sid, { sessionUpdate: 'plan', entries: [
        { content: 'write the file', status: 'in_progress' },
        { content: 'read it back', status: 'pending' },
    ] });
    update(sid, { sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Working on it. ' } });
    update(sid, { sessionUpdate: 'tool_call', toolCallId: 'tc_1',
        title: 'Write acp-out.txt', kind: 'edit', status: 'pending' });

    const perm = await request('session/request_permission', {
        sessionId: sid,
        toolCall: { toolCallId: 'tc_1', title: 'Write acp-out.txt' },
        options: [
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
        ],
    });
    const picked = perm && perm.outcome && perm.outcome.outcome === 'selected'
        ? perm.outcome.optionId : 'rejected';

    if (picked !== 'allow-once') {
        update(sid, { sessionUpdate: 'tool_call_update', toolCallId: 'tc_1',
            status: 'failed' });
        reply(id, { stopReason: 'end_turn' });
        return;
    }

    const target = sessionCwd + '/acp-out.txt';
    await request('fs/write_text_file', {
        sessionId: sid, path: target, content: 'written by fake agent\n' });
    const back = await request('fs/read_text_file', {
        sessionId: sid, path: target });
    const ok = back && back.content === 'written by fake agent\n';
    update(sid, { sessionUpdate: 'tool_call_update', toolCallId: 'tc_1',
        status: ok ? 'completed' : 'failed',
        content: [{ type: 'content',
            content: { type: 'text', text: `readback ${ok ? 'ok' : 'MISMATCH'}` } }] });
    update(sid, { sessionUpdate: 'plan', entries: [
        { content: 'write the file', status: 'completed' },
        { content: 'read it back', status: 'completed' },
    ] });
    update(sid, { sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Done.' } });
    reply(id, { stopReason: 'end_turn' });
}

function dispatch(msg) {
    /* responses to our own agent -> client requests */
    if (msg.method === undefined && msg.id !== undefined) {
        const r = waiting.get(msg.id);
        if (r) { waiting.delete(msg.id); r(msg.result); }
        return;
    }
    logLine(msg.method, msg.params);

    if (msg.method === 'initialize') {
        reply(msg.id, {
            protocolVersion: PROTOVER,
            agentCapabilities: { loadSession: true,
                sessionCapabilities: { list: {}, resume: {} } },
            agentInfo: { name: 'fake-acp-agent', version: '1.0.0' },
            authMethods: [],
        });
        if (process.env.FAKE_ACP_GARBAGE) {
            process.stdout.write('this is not json\n');
        }
        if (process.env.FAKE_ACP_DIE) process.exit(7);
        return;
    }
    if (msg.method === 'session/new') {
        sessionCwd = msg.params.cwd;
        /* Real adapters may publish initial state before session/new resolves.
         * A client must retain these notifications rather than race them. */
        update('sess_fake_1', { sessionUpdate: 'available_commands_update',
            availableCommands: [
                { name: 'init', description: 'Initialize the workspace' },
                { name: 'review', description: 'Agent-native review command' },
            ] });
        update('sess_fake_1', { sessionUpdate: 'current_mode_update',
            currentModeId: currentMode });
        update('sess_fake_1', { sessionUpdate: 'config_option_update',
            configOptions: configOptions() });
        update('sess_fake_1', { sessionUpdate: 'session_info_update',
            title: 'Fake ACP session', updatedAt: '2026-08-29T00:00:00Z' });
        update('sess_fake_1', { sessionUpdate: 'usage_update', used: 1200,
            size: 12000, cost: { amount: 0.01, currency: 'USD' } });
        reply(msg.id, { sessionId: 'sess_fake_1', modes: modes(),
            configOptions: configOptions() });
        return;
    }
    if (msg.method === 'session/list') {
        reply(msg.id, { sessions: [
            { sessionId: 'sess_past_1', cwd: msg.params.cwd || sessionCwd,
                title: 'Past fake session', updatedAt: '2026-08-28T12:00:00Z' },
        ] });
        return;
    }
    if (msg.method === 'session/load') {
        sessionCwd = msg.params.cwd;
        replaySession(msg.params.sessionId);
        reply(msg.id, { modes: modes(), configOptions: configOptions() });
        return;
    }
    if (msg.method === 'session/resume') {
        sessionCwd = msg.params.cwd;
        update(msg.params.sessionId, { sessionUpdate: 'session_info_update',
            title: 'Resumed fake session', updatedAt: '2026-08-29T10:00:00Z' });
        reply(msg.id, { modes: modes(), configOptions: configOptions() });
        return;
    }
    if (msg.method === 'session/set_mode') {
        currentMode = msg.params.modeId;
        update(msg.params.sessionId, { sessionUpdate: 'current_mode_update',
            currentModeId: currentMode });
        reply(msg.id, {});
        return;
    }
    if (msg.method === 'session/set_config_option') {
        if (msg.params.configId === 'model') currentModel = msg.params.value;
        if (msg.params.configId === 'thinking') thinking = !!msg.params.value;
        const next = configOptions();
        update(msg.params.sessionId, { sessionUpdate: 'config_option_update',
            configOptions: next });
        reply(msg.id, { configOptions: next });
        return;
    }
    if (msg.method === 'session/prompt') {
        promptTurn(msg.id, msg.params);
        return;
    }
    if (msg.method === 'session/cancel') {
        cancelled = true;
        if (cancelTimer) clearInterval(cancelTimer);
        if (pendingCancelPrompt) {
            reply(pendingCancelPrompt.id, { stopReason: 'cancelled' });
            pendingCancelPrompt = null;
        }
        return;
    }
    if (msg.id !== undefined) {
        send({ jsonrpc: '2.0', id: msg.id,
            error: { code: -32601, message: `unknown method ${msg.method}` } });
    }
}

process.stdin.on('data', (d) => {
    buf += String(d);
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) dispatch(JSON.parse(line));
    }
});
process.stdin.on('end', () => process.exit(0));
