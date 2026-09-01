#!/usr/bin/env node
/* Headless driver for the AcpClient protocol core.
 * Usage: node test-client.js <acp.js> <fake-agent.js> <tmpdir>
 * Exits non-zero with a FAIL line on the first broken assertion. */
'use strict';

const fs = require('fs');
const path = require('path');

const [, , ACP_JS, FAKE, TMP] = process.argv;
const { AcpClient, splitCommand, normalizeCodexAdapterCommand,
    workspacePath, readTextFile, writeTextFile, sessionUpdate } =
    require(path.resolve(ACP_JS));

let step = '';
function ok(what) { console.log(`ok: ${what}`); }
function assert(cond, what) {
    if (!cond) { console.error(`FAIL [${step}]: ${what}`); process.exit(1); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* client-side fs handlers scoped to a directory, mirroring the bridge */
function fsHandlers(root, answers) {
    return (method, params) => {
        if (method === 'fs/read_text_file') {
            return { content: fs.readFileSync(params.path, 'utf8') };
        }
        if (method === 'fs/write_text_file') {
            assert(params.path.startsWith(root), `write inside ${root}`);
            fs.writeFileSync(params.path, params.content);
            return null;
        }
        if (method === 'session/request_permission') {
            answers.asked.push(params);
            return { outcome: { outcome: 'selected', optionId: answers.pick } };
        }
        throw new Error(`unexpected request ${method}`);
    };
}

function newClient(extra, onNotify, onRequest, onClose) {
    return new AcpClient({
        command: process.execPath,
        args: [FAKE],
        cwd: TMP,
        env: extra || {},
        onNotify, onRequest, onClose,
    });
}

async function happyPath() {
    step = 'happy-path';
    const dir = path.join(TMP, 'happy');
    fs.mkdirSync(dir, { recursive: true });
    const log = path.join(dir, 'agent.jsonl');
    const answers = { pick: 'allow-once', asked: [] };
    const updates = [];
    const c = newClient({ FAKE_ACP_LOG: log },
        (m, p) => { if (m === 'session/update') updates.push(p.update); },
        fsHandlers(dir, answers));

    const init = await c.initialize({ name: 'test', version: '0' });
    assert(init.protocolVersion === 1, 'protocolVersion 1 negotiated');
    assert(init.agentInfo.name === 'fake-acp-agent', 'agentInfo present');
    assert(init.agentCapabilities.loadSession &&
        init.agentCapabilities.sessionCapabilities.list,
    'agent advertises list and full session replay');

    const sess = await c.request('session/new', {
        cwd: dir,
        mcpServers: [{ name: 'codify', command: 'cg', args: ['mcp'], env: [] }],
    }, 5000);
    assert(sess.sessionId === 'sess_fake_1', 'sessionId returned');
    assert(sess.modes.currentModeId === 'agent', 'initial session mode returned');
    assert(sess.configOptions.length === 2, 'initial session config returned');

    const listed = await c.request('session/list', { cwd: dir, cursor: null }, 5000);
    assert(listed.sessions.length === 1 && listed.sessions[0].sessionId === 'sess_past_1',
        'past sessions can be listed for this workspace');
    const loaded = await c.request('session/load', {
        sessionId: 'sess_past_1', cwd: dir,
        mcpServers: [{ name: 'codify', command: 'cg', args: ['mcp'], env: [] }],
    }, 5000);
    assert(loaded.modes.currentModeId === 'agent', 'past session load returns controls');
    assert(updates.some((u) => u.sessionUpdate === 'agent_message_chunk' &&
        u.content.text === 'Earlier context restored.'),
    'session/load replays the earlier transcript');

    await c.request('session/set_mode', {
        sessionId: sess.sessionId, modeId: 'plan' }, 5000);
    const changed = await c.request('session/set_config_option', {
        sessionId: sess.sessionId, configId: 'thinking',
        type: 'boolean', value: false }, 5000);
    assert(changed.configOptions.find((o) => o.id === 'thinking').currentValue === false,
        'boolean session config round-trips');

    const res = await c.request('session/prompt', {
        sessionId: sess.sessionId,
        prompt: [{ type: 'text', text: 'do the write' }],
    }, 10000);
    assert(res.stopReason === 'end_turn', `stopReason end_turn, got ${res.stopReason}`);

    assert(answers.asked.length === 1, 'exactly one permission request');
    assert(answers.asked[0].options.length === 2, 'permission options offered');
    assert(fs.readFileSync(path.join(dir, 'acp-out.txt'), 'utf8')
        === 'written by fake agent\n', 'file written through fs bridge');

    const kinds = updates.map((u) => u.sessionUpdate);
    for (const want of ['user_message_chunk', 'agent_thought_chunk', 'plan', 'agent_message_chunk',
        'tool_call', 'tool_call_update', 'available_commands_update',
        'current_mode_update', 'config_option_update', 'session_info_update',
        'usage_update']) {
        assert(kinds.includes(want), `update stream carries ${want}`);
    }
    const done = updates.find((u) =>
        u.sessionUpdate === 'tool_call_update' && u.status === 'completed');
    assert(done, 'tool call reported completed');
    assert(done.content[0].content.text === 'readback ok',
        'agent read back what the client wrote');

    /* session/new params crossed the wire verbatim */
    const seen = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)
        .map((l) => JSON.parse(l)).find((e) => e.method === 'session/new');
    assert(seen.params.cwd === dir, 'cwd delivered to agent');
    assert(seen.params.mcpServers[0].name === 'codify' &&
        seen.params.mcpServers[0].args[0] === 'mcp',
    'mcpServers delivered to agent');
    const initialized = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)
        .map((l) => JSON.parse(l)).find((e) => e.method === 'initialize');
    assert(initialized.params.clientCapabilities.fs.readTextFile &&
        initialized.params.clientCapabilities.fs.writeTextFile,
    'client advertises the fs bridge it serves');
    assert(initialized.params.clientCapabilities.session.configOptions.boolean,
        'client advertises boolean session controls');
    const loadedWire = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)
        .map((l) => JSON.parse(l)).find((e) => e.method === 'session/load');
    assert(loadedWire.params.mcpServers[0].name === 'codify',
        'restored session receives the Codify MCP server');

    c.stop();
    ok('happy path: handshake, prompt turn, permission, fs round-trip');
}

async function rejectPath() {
    step = 'reject-path';
    const dir = path.join(TMP, 'reject');
    fs.mkdirSync(dir, { recursive: true });
    const answers = { pick: 'reject-once', asked: [] };
    const updates = [];
    const c = newClient({},
        (m, p) => { if (m === 'session/update') updates.push(p.update); },
        fsHandlers(dir, answers));
    await c.initialize();
    const sess = await c.request('session/new', { cwd: dir, mcpServers: [] }, 5000);
    const res = await c.request('session/prompt', {
        sessionId: sess.sessionId, prompt: [{ type: 'text', text: 'go' }],
    }, 10000);
    assert(res.stopReason === 'end_turn', 'turn still ends after a rejection');
    assert(!fs.existsSync(path.join(dir, 'acp-out.txt')),
        'no write after rejected permission');
    assert(updates.some((u) => u.sessionUpdate === 'tool_call_update' &&
        u.status === 'failed'), 'tool call reported failed');
    c.stop();
    ok('permission rejection path');
}

async function cancelPath() {
    step = 'cancel';
    let chunks = 0;
    const c = newClient({},
        (m, p) => {
            if (m === 'session/update' &&
                p.update.sessionUpdate === 'agent_message_chunk') chunks++;
        },
        () => { throw new Error('unexpected request'); });
    await c.initialize();
    const sess = await c.request('session/new', { cwd: TMP, mcpServers: [] }, 5000);
    const turn = c.request('session/prompt', {
        sessionId: sess.sessionId, prompt: [{ type: 'text', text: 'cancel-me' }],
    }, 10000);
    while (chunks === 0) await sleep(20);      /* the turn is really streaming */
    c.notify('session/cancel', { sessionId: sess.sessionId });
    const res = await turn;
    assert(res.stopReason === 'cancelled', `stopReason cancelled, got ${res.stopReason}`);
    c.stop();
    ok('cancel resolves the in-flight turn as cancelled');
}

async function versionMismatch() {
    step = 'version-mismatch';
    const c = newClient({ FAKE_ACP_PROTOVER: '99' });
    let err;
    await c.initialize().catch((e) => { err = e; });
    assert(err, 'initialize rejected');
    assert(/protocol/.test(err.message), `message names the protocol: ${err.message}`);
    c.stop();
    ok('protocol version mismatch fails loudly');
}

async function spawnFailure() {
    step = 'spawn-failure';
    const c = new AcpClient({ command: path.join(TMP, 'no-such-agent-binary') });
    let err;
    await c.initialize().catch((e) => { err = e; });
    assert(err, 'initialize rejected on spawn failure');
    ok('missing adapter fails loudly, no hang');
}

async function malformedFrame() {
    step = 'malformed-frame';
    let closed = '';
    const c = newClient({ FAKE_ACP_GARBAGE: '1' }, undefined, undefined,
        (reason) => { closed = reason; });
    await c.initialize();               /* the garbage line follows the reply */
    await sleep(150);
    assert(closed.includes('malformed frame'), `onClose reported: ${closed}`);
    let err;
    await c.request('session/new', { cwd: TMP, mcpServers: [] }, 2000)
        .catch((e) => { err = e; });
    assert(err, 'requests after a protocol fault reject');
    ok('malformed frame closes the client and rejects new requests');
}

async function agentDeath() {
    step = 'agent-death';
    let closed = '';
    const c = newClient({ FAKE_ACP_DIE: '1' }, undefined, undefined,
        (reason) => { closed = reason; });
    await c.initialize();
    let err;
    await c.request('session/new', { cwd: TMP, mcpServers: [] }, 5000)
        .catch((e) => { err = e; });
    assert(err && /exited/.test(err.message),
        `pending request rejected with exit reason: ${err && err.message}`);
    assert(/exited/.test(closed), 'onClose fired with the exit reason');
    ok('agent death rejects pending requests');
}

function bridgeSanity() {
    step = 'fs-bridge';
    const root = path.join(TMP, 'bridge-root');
    fs.mkdirSync(root, { recursive: true });

    assert(workspacePath(root, path.join(root, 'a', 'b.txt'))
        === path.join(root, 'a', 'b.txt'), 'path inside the root is served');
    assert(workspacePath(root, root) === root, 'the root itself is served');
    for (const evil of ['/etc/passwd', path.join(root, '..', 'evil.txt'),
        root + '-sibling/x']) {
        let err;
        try { workspacePath(root, evil); } catch (e) { err = e; }
        assert(err && err.code === -32602, `refused with -32602: ${evil}`);
    }

    writeTextFile(root, { path: path.join(root, 'deep', 'dir', 'f.txt'),
        content: 'l1\nl2\nl3\nl4\n' });
    assert(fs.existsSync(path.join(root, 'deep', 'dir', 'f.txt')),
        'write creates parent directories');
    const sliced = readTextFile(root,
        { path: path.join(root, 'deep', 'dir', 'f.txt'), line: 2, limit: 2 });
    assert(sliced.content === 'l2\nl3', `line/limit slice 1-based: ${sliced.content}`);
    const whole = readTextFile(root,
        { path: path.join(root, 'deep', 'dir', 'f.txt') });
    assert(whole.content === 'l1\nl2\nl3\nl4\n', 'unsliced read returns the file');
    ok('fs bridge: workspace-scoped reads and writes, outside paths refused');
}

function splitSanity() {
    step = 'split-command';
    const a = splitCommand(`npx -y "@zed-industries/claude-code-acp" --flag 'x y'`);
    assert(a.length === 5 && a[2] === '@zed-industries/claude-code-acp' &&
        a[4] === 'x y', `quote-aware split: ${JSON.stringify(a)}`);
    ok('splitCommand handles quoting');
}

function adapterCommandSanity() {
    step = 'adapter-command';
    const legacy = normalizeCodexAdapterCommand(
        'npx -y @zed-industries/codex-acp');
    assert(legacy.command ===
        'npx -y @agentclientprotocol/codex-acp@1.7.0',
    `legacy adapter redirected: ${legacy.command}`);
    assert(legacy.legacyCommand === 'npx -y @zed-industries/codex-acp',
        'legacy command is retained for the visible compatibility notice');

    const custom = normalizeCodexAdapterCommand('/opt/agents/codex-acp --stdio');
    assert(custom.command === '/opt/agents/codex-acp --stdio' &&
        !custom.legacyCommand, 'explicit custom adapter is preserved');

    const fallback = normalizeCodexAdapterCommand('');
    assert(fallback.command ===
        'npx -y @agentclientprotocol/codex-acp@1.7.0',
    `empty setting uses the verified adapter: ${fallback.command}`);
    ok('Codex adapter defaults and legacy-package redirect');
}

function updateMappingSanity() {
    step = 'session-update-mapping';
    const shown = [];
    const sess = { webview: { postMessage: (m) => shown.push(m) },
        commands: [], configOptions: [], modes: {
            currentModeId: 'agent', availableModes: [{ id: 'agent', name: 'Agent' }] } };
    const emit = (update) => sessionUpdate(sess, { sessionId: 's', update });
    emit({ sessionUpdate: 'available_commands_update', availableCommands: [
        { name: 'init', description: 'Initialize' }] });
    emit({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' });
    emit({ sessionUpdate: 'config_option_update', configOptions: [
        { id: 'thinking', type: 'boolean', currentValue: true }] });
    emit({ sessionUpdate: 'session_info_update', title: 'A useful title' });
    emit({ sessionUpdate: 'usage_update', used: 5, size: 10 });
    const types = shown.map((m) => m.type);
    for (const type of ['agent_commands', 'mode', 'config', 'session_info', 'usage']) {
        assert(types.includes(type), `extension maps ${type} into a panel message`);
    }
    assert(sess.modes.currentModeId === 'plan', 'session mode state retained');
    assert(sess.commands[0].name === 'init', 'agent commands retained');
    ok('all stable session state updates map to the panel');
}

(async () => {
    splitSanity();
    adapterCommandSanity();
    bridgeSanity();
    updateMappingSanity();
    await happyPath();
    await rejectPath();
    await cancelPath();
    await versionMismatch();
    await spawnFailure();
    await malformedFrame();
    await agentDeath();
    console.log('acp client: all scenarios pass');
    process.exit(0);
})().catch((e) => {
    console.error(`FAIL [${step}]: ${e.stack || e}`);
    process.exit(1);
});
