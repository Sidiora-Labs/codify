#!/usr/bin/env node
/* Headless driver for the AcpClient protocol core.
 * Usage: node test-client.js <acp.js> <fake-agent.js> <tmpdir>
 * Exits non-zero with a FAIL line on the first broken assertion. */
'use strict';

const fs = require('fs');
const path = require('path');

const [, , ACP_JS, FAKE, TMP] = process.argv;
const { AcpClient, splitCommand, workspacePath, readTextFile, writeTextFile } =
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

    const sess = await c.request('session/new', {
        cwd: dir,
        mcpServers: [{ name: 'codify', command: 'cg', args: ['mcp'], env: [] }],
    }, 5000);
    assert(sess.sessionId === 'sess_fake_1', 'sessionId returned');

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
    for (const want of ['agent_thought_chunk', 'plan', 'agent_message_chunk',
        'tool_call', 'tool_call_update']) {
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

(async () => {
    splitSanity();
    bridgeSanity();
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
