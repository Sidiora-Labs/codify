/* Codify task UI — the plan as a tree you can work from, and a detail panel
 * that shows why a task is or is not done.
 *
 * The tree groups feature → section → wave because that is how a spec is
 * written and how a fleet divides work: a wave is what one worker takes on
 * one branch. Every row carries what decides whether you can pick it up —
 * status, the agent holding the lease and its role, the branch that work is
 * on, and the requires that are not satisfied yet.
 *
 * Two sources, no third implementation of the workflow:
 *   - live state (status, claims, graph evidence, tagged commits, memories)
 *     comes from `cg spec status` / `cg spec trace --no-sync`, always through
 *     the caller's one refresh chain — this module owns no timer and no
 *     watcher;
 *   - the declaration a task is judged against (section, do-steps, acceptance
 *     criteria, verify_cmd) is read straight from the spec .kvx, because no
 *     cg query exposes those per task without mutating it.
 *
 * The pure half — kvx reading, merging, filtering, the resume prompt, the
 * panel HTML — never touches the vscode module, so the integration test
 * drives it under plain node.
 *
 * Plain JS, zero dependencies, no build step. */
let vscode = null;
try { vscode = require('vscode'); } catch (_) { /* headless: pure half only */ }
const fs = require('fs');
const path = require('path');

let deps;                      /* {cg, cgJson, workspaceRoot, show, ...} */
let provider;                  /* the one TaskTreeProvider */
let treeView;                  /* created here so the filter can be shown */
const panels = new Map();      /* task id -> {panel, webview} detail panels */
const verifyTerms = new Map(); /* task id -> terminal running its verify_cmd */

const STATUS_FILTERS = ['all', 'pending', 'in_progress', 'implemented', 'done',
    'blocked', 'open'];

/* ---------------- kvx reading (headless-safe) ----------------
 *
 * kvx is one `key = value` per line, [section] headers, double-quoted
 * strings, ["a","b"] lists and # comments outside quotes (src/kvx.c). There
 * are no escapes, so unquoting is a slice — this reader deliberately mirrors
 * that grammar and nothing more. */

function stripComment(line) {
    let inq = false;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') inq = !inq;
        else if (line[i] === '#' && !inq) return line.slice(0, i);
    }
    return line;
}

function kvxUnquote(raw) {
    const s = String(raw === undefined || raw === null ? '' : raw).trim();
    if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
        return s.slice(1, -1);
    }
    return s;
}

function kvxList(raw) {
    const s = String(raw || '').trim();
    if (!(s.startsWith('[') && s.endsWith(']'))) {
        const one = kvxUnquote(s);
        return one ? [one] : [];
    }
    const out = [];
    let cur = '';
    let inq = false;
    for (const ch of s.slice(1, -1)) {
        if (ch === '"') { inq = !inq; cur += ch; continue; }
        if (ch === ',' && !inq) {
            const v = kvxUnquote(cur);
            if (v) out.push(v);
            cur = '';
            continue;
        }
        cur += ch;
    }
    const last = kvxUnquote(cur);
    if (last) out.push(last);
    return out;
}

/* section name -> [[key, raw], ...] in file order, last write wins */
function parseKvx(text) {
    const sections = new Map();
    let cur = '';
    for (const raw of String(text || '').split('\n')) {
        const line = stripComment(raw).trim();
        if (!line) continue;
        if (line[0] === '[') {
            const end = line.indexOf(']');
            if (end < 0) continue;
            cur = line.slice(1, end).trim();
            if (!sections.has(cur)) sections.set(cur, []);
            continue;
        }
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        if (!key) continue;
        if (!sections.has(cur)) sections.set(cur, []);
        const rows = sections.get(cur);
        const at = rows.findIndex((r) => r[0] === key);
        if (at >= 0) rows[at][1] = line.slice(eq + 1).trim();
        else rows.push([key, line.slice(eq + 1).trim()]);
    }
    return sections;
}

/* The spec file as the task UI needs it: every task with the fields it is
 * judged against, and the [req.*] acceptance clauses a task's `reqs` name
 * (clause "5.1" is ac_1 of [req.5], the same mapping cg prints). */
function readSpec(text) {
    const sections = parseKvx(text);
    const raw = (sec, key) => {
        const rows = sections.get(sec);
        if (!rows) return undefined;
        const row = rows.find((r) => r[0] === key);
        return row ? row[1] : undefined;
    };
    const str = (sec, key) => kvxUnquote(raw(sec, key) || '');
    const list = (sec, key) => kvxList(raw(sec, key) || '');

    const clauses = {};
    const reqs = {};
    const tasks = [];
    const byId = new Map();

    for (const [name, rows] of sections) {
        const rm = /^req\.(.+)$/.exec(name);
        if (rm) {
            reqs[rm[1]] = { id: rm[1], title: str(name, 'title'),
                story: str(name, 'story') };
            for (const [key, value] of rows) {
                const am = /^ac_(\d+)$/.exec(key);
                if (am) clauses[`${rm[1]}.${am[1]}`] = kvxUnquote(value);
            }
            continue;
        }
        const tm = /^task\.(.+)$/.exec(name);
        if (!tm) continue;
        const id = tm[1];
        const waveRaw = raw(name, 'wave');
        const wave = waveRaw === undefined ? null : Number(kvxUnquote(waveRaw));
        const t = {
            id,
            title: str(name, 'title'),
            status: str(name, 'status') || 'pending',
            /* a task without a wave is a group heading, not work */
            wave: Number.isFinite(wave) ? wave : null,
            section: str(name, 'section'),
            note: str(name, 'note'),
            property: str(name, 'property'),
            validates: str(name, 'validates'),
            verify_cmd: str(name, 'verify_cmd'),
            requires: list(name, 'requires'),
            reqs: list(name, 'reqs'),
            symbols: list(name, 'symbols'),
            touches: list(name, 'touches'),
            do: rows.filter(([k]) => /^do_\d+$/.test(k))
                .sort((a, b) => Number(a[0].slice(3)) - Number(b[0].slice(3)))
                .map(([, v]) => kvxUnquote(v)),
        };
        t.group = t.wave === null;
        tasks.push(t);
        byId.set(id, t);
    }

    /* a leaf inherits the heading it is written under */
    for (const t of tasks) {
        if (t.section) continue;
        const parts = t.id.split('.');
        for (let n = parts.length - 1; n > 0 && !t.section; n--) {
            const parent = byId.get(parts.slice(0, n).join('.'));
            if (parent) t.section = parent.section || parent.title;
        }
    }
    return {
        feature: str('meta', 'feature'),
        intro: str('meta', 'intro'),
        clauses, reqs, tasks, byId,
    };
}

/* ---------------- merged rows (headless-safe) ---------------- */

/* A require counts as met when it is done — or implemented, in the modes
 * where implemented unlocks dependent work (src/spec.c: prod and parallel). */
function requireMet(status, mode) {
    if (status === 'done') return true;
    return status === 'implemented' && (mode === 'prod' || mode === 'parallel');
}

function asSymbols(v) {
    return (v || []).map((s) => (typeof s === 'string' ? { name: s } : s));
}

function asTouches(v) {
    return (v || []).map((t) => (typeof t === 'string' ? { pattern: t } : t));
}

/* One row per leaf task: the declaration, the live status and graph evidence,
 * the claim that owns it, and the requires that are not satisfied yet. The
 * spec supplies the order; trace supplies the truth. */
function mergeTasks(spec, trace, status, plan) {
    const traced = new Map(((trace && trace.tasks) || []).map((t) => [t.id, t]));
    const claims = new Map((((status && status.claims) || [])).map((c) => [c.id, c]));
    const mode = (status && status.mode) || 'standard';
    const feature = (spec && spec.feature) || (trace && trace.feature) ||
        (status && status.feature) || '';
    const waveBranch = new Map();
    for (const w of (plan && plan.waves) || []) {
        if (w.branch) waveBranch.set(String(w.wave), w.branch);
    }
    const nextId = status && status.next ? status.next.id : undefined;

    const order = [];
    const seen = new Set();
    for (const t of (spec && spec.tasks) || []) {
        if (t.group) continue;
        order.push(t.id);
        seen.add(t.id);
    }
    for (const t of (trace && trace.tasks) || []) {
        if (!seen.has(t.id)) { order.push(t.id); seen.add(t.id); }
    }

    const statusOf = (id) => {
        const tr = traced.get(id);
        if (tr) return tr.status;
        const sp = spec && spec.byId.get(id);
        return sp ? sp.status : 'pending';
    };

    return order.map((id) => {
        const sp = (spec && spec.byId.get(id)) || {};
        const tr = traced.get(id) || {};
        const claim = claims.get(id) || null;
        const row = {
            id,
            feature,
            title: tr.title || sp.title || id,
            status: tr.status || sp.status || 'pending',
            wave: tr.wave !== undefined && tr.wave !== null ? tr.wave : sp.wave,
            section: sp.section || '',
            requires: sp.requires || [],
            reqs: sp.reqs || [],
            do: sp.do || [],
            note: sp.note || '',
            verify_cmd: sp.verify_cmd || '',
            symbols: asSymbols(tr.symbols || sp.symbols),
            touches: asTouches(tr.touches || sp.touches),
            commits: tr.commits || [],
            memories: tr.memories || [],
            claim,
            agent: claim ? claim.agent || '' : '',
            role: claim ? claim.role || '' : '',
            branch: claim ? claim.branch || '' : '',
            worktree: claim ? claim.worktree || '' : '',
            waveBranch: waveBranch.get(String(sp.wave)) || '',
            next: id === nextId,
        };
        row.blockers = row.requires
            .filter((r) => !requireMet(statusOf(r), mode))
            .map((r) => ({ id: r, status: statusOf(r) }));
        return row;
    });
}

/* ---------------- the filter (headless-safe) ----------------
 *
 * One pure function so the view title, the quick picks and the test all mean
 * the same thing by "pending", "wave 5" or "mine". Unknown keys are ignored
 * rather than emptying the tree: a filter that silently hides work is worse
 * than no filter. */
function taskFilter(rows, filter) {
    const f = filter || {};
    const status = f.status || 'all';
    const wave = f.wave === undefined || f.wave === null || f.wave === ''
        ? 'all' : f.wave;
    const owner = f.owner || 'all';
    const text = String(f.text || '').trim().toLowerCase();

    return (rows || []).filter((r) => {
        if (status !== 'all') {
            if (status === 'blocked') {
                if (!(r.blockers && r.blockers.length)) return false;
            } else if (status === 'open') {
                if (r.status === 'done') return false;
            } else if (r.status !== status) {
                return false;
            }
        }
        if (String(wave) !== 'all' && String(r.wave) !== String(wave)) return false;
        if (owner !== 'all') {
            const agent = r.agent || (r.claim && r.claim.agent) || '';
            if (owner === 'unclaimed') { if (agent) return false; }
            else if (agent !== owner) return false;
        }
        if (text && !haystack(r).includes(text)) return false;
        return true;
    });
}

function haystack(r) {
    return [
        r.id, r.title, r.section, r.status, r.agent, r.role, r.branch,
        (r.symbols || []).map((s) => s.name || s).join(' '),
        (r.touches || []).map((t) => t.pattern || t).join(' '),
    ].join(' ').toLowerCase();
}

/* what the view title shows when a filter is on; '' when nothing is hidden */
function filterLabel(filter) {
    const f = filter || {};
    const bits = [];
    if (f.status && f.status !== 'all') bits.push(f.status.replace('_', ' '));
    if (f.wave !== undefined && String(f.wave) !== 'all' && f.wave !== '') {
        bits.push(`wave ${f.wave}`);
    }
    if (f.owner && f.owner !== 'all') bits.push(f.owner);
    if (f.text) bits.push(`"${f.text}"`);
    return bits.join(' · ');
}

/* ---------------- resume prompt (headless-safe) ----------------
 *
 * The briefing `cg spec run` hands a worker, written from the spec fields so
 * it can be copied for a task nobody has started yet: what the task is, the
 * steps it declared, the scope it is judged against, and the only two ways it
 * is allowed to end. Wording follows `cg resume --prompt` (src/govern.c) and
 * the task detail `cg spec start` prints. */
function resumePrompt(row, opts) {
    const o = opts || {};
    const tag = row.feature ? `${row.feature}/${row.id}` : row.id;
    const L = [];
    L.push(`# resume: ${tag}`);
    L.push(`task ${row.id} — ${row.title}  (${row.status}${
        row.wave !== undefined && row.wave !== null ? `, wave ${row.wave}` : ''})`);
    if (row.section) L.push(`section: ${row.section}`);
    if (row.requires && row.requires.length) {
        const blocked = new Set((row.blockers || []).map((b) => b.id));
        L.push('requires: ' + row.requires
            .map((r) => `${r}${blocked.has(r) ? ' (NOT ready)' : ' (done)'}`)
            .join(' '));
    }
    for (const step of row.do || []) L.push(`  - ${step}`);
    if (row.note) L.push(`  - ${row.note}`);
    const clauses = o.clauses || {};
    if (row.reqs && row.reqs.length) {
        L.push('acceptance criteria:');
        for (const c of row.reqs) {
            L.push(clauses[c] ? `  ${c}: ${clauses[c]}` : `  ${c}`);
        }
    }
    const touches = (row.touches || []).map((t) => t.pattern || t);
    if (touches.length) L.push('touches: ' + touches.join(' '));
    const symbols = (row.symbols || []).map((s) => s.name || s);
    if (symbols.length) L.push('symbols: ' + symbols.join(' '));
    if (row.verify_cmd) L.push(`verify: ${row.verify_cmd}`);
    if (row.agent) {
        L.push(`lease: held by ${row.agent}${row.role ? ` (${row.role})` : ''}` +
            `${row.branch ? ` on ${row.branch}` : ''}`);
    } else {
        L.push('lease: none — claim with `cg spec claim ' + row.id + '`');
    }
    const mem = (row.memories || []).slice(0, 5);
    if (mem.length) {
        L.push('task memories:');
        for (const m of mem) L.push(`  [${m.type}] ${m.body}`);
    }
    L.push('');
    L.push('run `cg context <area>` for the code, and keep edits inside the ' +
        'touches above.');
    L.push(`when done: run the verify command, then \`cg spec done ${row.id}\`.`);
    L.push(`before stopping: \`cg handoff --task ${row.id} --done ... ` +
        '--next ...` to hand off.');
    return L.join('\n') + '\n';
}

/* ---------------- detail panel HTML (headless-safe) ----------------
 *
 * The shell is static and the model arrives by postMessage, so a refresh
 * repaints the panel without losing the scroll position. Nothing is rendered
 * with innerHTML from data — every value goes in through textContent — and
 * the CSP allows exactly this file's nonce and no network, no eval, no remote
 * fonts or images. */
function detailHtml(nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Codify task</title>
<style nonce="${nonce}">
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    line-height: 1.5;
  }
  #root { max-width: 900px; margin: 0 auto; padding: 0 18px 32px; }
  .hidden { display: none !important; }
  @keyframes rise { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
  section.card { animation: rise 0.16s ease-out; }

  header {
    position: sticky; top: 0; z-index: 2;
    padding: 16px 0 10px;
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25));
  }
  h1 { font-size: 1.32em; font-weight: 600; margin: 0 0 6px; }
  h1 .id {
    font-family: var(--vscode-editor-font-family);
    color: var(--vscode-descriptionForeground); margin-right: 8px;
  }
  .meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .pill {
    font-size: 0.85em; padding: 0 8px; border-radius: 9px; white-space: nowrap;
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.4));
    color: var(--vscode-descriptionForeground);
  }
  .pill.done, .pill.implemented {
    color: var(--vscode-testing-iconPassed, #3fb950);
    border-color: var(--vscode-testing-iconPassed, #3fb950);
  }
  .pill.in_progress {
    color: var(--vscode-charts-yellow, #d29922);
    border-color: var(--vscode-charts-yellow, #d29922);
  }
  .pill.blocked {
    color: var(--vscode-editorWarning-foreground, #cca700);
    border-color: var(--vscode-editorWarning-foreground, #cca700);
  }
  #bar { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 0 2px; }
  button {
    font-family: inherit; font-size: 0.92em; cursor: pointer;
    border-radius: 3px; padding: 3px 11px;
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.18));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border: 1px solid transparent;
  }
  button:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.3)); }
  button.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.45; cursor: default; }
  button:focus-visible, a:focus-visible, [tabindex]:focus-visible {
    outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px;
  }

  section.card { margin-top: 18px; }
  section.card > h2 {
    font-size: 0.82em; font-weight: 600; letter-spacing: 0.08em;
    text-transform: uppercase; margin: 0 0 7px;
    color: var(--vscode-descriptionForeground);
  }
  section.card > h2 .count { opacity: 0.7; font-weight: 400; }
  ol, ul { margin: 0; padding-left: 20px; }
  li { margin: 2px 0; }
  ul.plain { list-style: none; padding: 0; }
  .row {
    display: flex; gap: 8px; align-items: baseline;
    padding: 3px 6px; border-radius: 4px;
  }
  .row.link { cursor: pointer; }
  .row.link:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.12)); }
  .row .name {
    font-family: var(--vscode-editor-font-family);
    color: var(--vscode-textLink-foreground, #4a9eda);
    overflow-wrap: anywhere;
  }
  .row .where, .row .note {
    color: var(--vscode-descriptionForeground); font-size: 0.9em;
    overflow-wrap: anywhere;
  }
  .mark { flex: none; width: 1.1em; text-align: center; }
  .ok { color: var(--vscode-testing-iconPassed, #3fb950); }
  .miss { color: var(--vscode-testing-iconFailed, #f85149); }
  code, pre {
    font-family: var(--vscode-editor-font-family);
    font-size: 0.93em;
  }
  pre.cmd {
    margin: 0; padding: 8px 10px; border-radius: 4px; overflow-x: auto;
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.12));
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.22));
    white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .empty {
    color: var(--vscode-descriptionForeground);
    font-style: italic; padding: 4px 0;
  }
  .banner {
    margin-top: 14px; padding: 8px 11px; border-radius: 4px;
    border-left: 3px solid var(--vscode-editorWarning-foreground, #cca700);
    background: var(--vscode-inputValidation-warningBackground, rgba(204,167,0,0.1));
  }
  .banner.error {
    border-left-color: var(--vscode-testing-iconFailed, #f85149);
    background: var(--vscode-inputValidation-errorBackground, rgba(248,81,73,0.1));
  }
  .kv { display: grid; grid-template-columns: max-content 1fr; gap: 2px 14px; }
  .kv dt { color: var(--vscode-descriptionForeground); }
  .kv dd { margin: 0; overflow-wrap: anywhere; }
  .mem .type {
    font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--vscode-descriptionForeground); flex: none;
  }
</style>
</head>
<body>
<div id="root">
  <div id="loading" class="empty">Loading task…</div>
  <div id="doc" class="hidden"></div>
</div>
<script nonce="${nonce}">
const vs = acquireVsCodeApi();
const doc = document.getElementById('doc');
const loading = document.getElementById('loading');

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
}
function card(title, count) {
    const s = el('section', 'card');
    const h = el('h2', null, title);
    if (count !== undefined && count !== null) {
        h.appendChild(el('span', 'count', '  ' + count));
    }
    s.appendChild(h);
    return s;
}
function empty(s, text) { s.appendChild(el('div', 'empty', text)); return s; }
function post(msg) { vs.postMessage(msg); }

function button(label, action, opts) {
    const o = opts || {};
    const b = el('button', o.primary ? 'primary' : null, label);
    b.disabled = !!o.disabled;
    if (o.why) b.title = o.why;
    b.addEventListener('click', () => post({ type: 'action', action: action }));
    return b;
}

function render(v) {
    loading.classList.add('hidden');
    doc.classList.remove('hidden');
    doc.textContent = '';

    const head = el('header');
    const h1 = el('h1');
    h1.appendChild(el('span', 'id', v.id));
    h1.appendChild(document.createTextNode(v.title || ''));
    head.appendChild(h1);

    const meta = el('div', 'meta');
    meta.appendChild(el('span', 'pill ' + (v.blockers.length ? 'blocked' : v.status),
        v.blockers.length ? v.status + ' · blocked' : v.status));
    if (v.wave !== null && v.wave !== undefined) meta.appendChild(el('span', 'pill', 'wave ' + v.wave));
    if (v.section) meta.appendChild(el('span', 'pill', v.section));
    if (v.feature) meta.appendChild(el('span', 'pill', v.feature));
    if (v.agent) {
        meta.appendChild(el('span', 'pill',
            v.agent + (v.role ? ' · ' + v.role : '')));
    }
    if (v.branch) meta.appendChild(el('span', 'pill', v.branch));
    head.appendChild(meta);

    const bar = el('div');
    bar.id = 'bar';
    for (const a of v.actions) {
        bar.appendChild(button(a.label, a.action,
            { primary: a.primary, disabled: a.disabled, why: a.why }));
    }
    head.appendChild(bar);
    doc.appendChild(head);

    if (v.error) {
        const b = el('div', 'banner error', v.error);
        doc.appendChild(b);
    }
    if (v.blockers.length) {
        const b = el('div', 'banner');
        b.appendChild(el('div', null, 'Blocked by ' + v.blockers.length +
            ' unmet require' + (v.blockers.length === 1 ? '' : 's') + ':'));
        const ul = el('ul');
        for (const x of v.blockers) {
            ul.appendChild(el('li', null, x.id + ' — ' + x.status));
        }
        b.appendChild(ul);
        doc.appendChild(b);
    }

    /* acceptance criteria — what the task is measured against */
    const ac = card('Acceptance criteria', v.criteria.length || null);
    if (v.criteria.length) {
        const ul = el('ul', 'plain');
        for (const c of v.criteria) {
            const li = el('li', 'row');
            li.appendChild(el('span', 'name', c.clause));
            li.appendChild(el('span', 'note', c.text || '(no text in the spec)'));
            ul.appendChild(li);
        }
        ac.appendChild(ul);
    } else empty(ac, 'This task declares no reqs.');
    doc.appendChild(ac);

    const steps = card('Steps', v.steps.length || null);
    if (v.steps.length) {
        const ol = el('ol');
        for (const s of v.steps) ol.appendChild(el('li', null, s));
        steps.appendChild(ol);
    } else empty(steps, 'No do-steps declared.');
    doc.appendChild(steps);

    /* declared scope, with what the graph found */
    const syms = card('Symbols', v.symbols.length || null);
    if (v.symbols.length) {
        const ul = el('ul', 'plain');
        for (const s of v.symbols) {
            const li = el('li', 'row link');
            li.tabIndex = 0;
            li.appendChild(el('span', 'mark ' + (s.found ? 'ok' : 'miss'),
                s.found ? '✓' : '✗'));
            li.appendChild(el('span', 'name', s.name));
            li.appendChild(el('span', 'where', s.found
                ? s.path + ':' + s.line + '  ' + (s.kind || '') +
                  (s.refs ? ', ' + s.refs + ' refs' : '')
                : 'not in the graph yet'));
            const go = () => post({ type: 'symbol', name: s.name,
                path: s.path, line: s.line });
            li.addEventListener('click', go);
            li.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
            });
            ul.appendChild(li);
        }
        syms.appendChild(ul);
    } else empty(syms, 'No symbols declared — nothing for the graph to check.');
    doc.appendChild(syms);

    const touch = card('Touches', v.touches.length || null);
    if (v.touches.length) {
        const ul = el('ul', 'plain');
        for (const t of v.touches) {
            const li = el('li', 'row link');
            li.tabIndex = 0;
            li.appendChild(el('span', 'mark ' + (t.changed ? 'ok' : 'miss'),
                t.changed ? '✓' : '·'));
            li.appendChild(el('span', 'name', t.pattern));
            li.appendChild(el('span', 'where',
                t.changed ? 'changed' : 'no matching change yet'));
            const go = () => post({ type: 'path', path: t.pattern });
            li.addEventListener('click', go);
            li.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
            });
            ul.appendChild(li);
        }
        touch.appendChild(ul);
    } else empty(touch, 'No touched paths declared.');
    doc.appendChild(touch);

    const ver = card('Verify command');
    if (v.verify_cmd) {
        ver.appendChild(el('pre', 'cmd', v.verify_cmd));
    } else {
        empty(ver, 'No verify_cmd — cg spec done checks only the graph.');
    }
    doc.appendChild(ver);

    const tr = card('Trace', v.commits.length || null);
    const kv = el('dl', 'kv');
    const add = (k, val) => {
        kv.appendChild(el('dt', null, k));
        kv.appendChild(el('dd', null, val));
    };
    add('symbols in graph', v.found + ' of ' + v.symbols.length);
    add('paths changed', v.changed + ' of ' + v.touches.length);
    add('tagged commits', String(v.commits.length));
    if (v.worktree) add('worktree', v.worktree);
    if (v.attempt) add('attempt', v.attempt);
    tr.appendChild(kv);
    if (v.commits.length) {
        const ul = el('ul', 'plain');
        for (const c of v.commits) {
            const li = el('li', 'row');
            li.appendChild(el('span', 'name', c.id.slice(0, 12)));
            li.appendChild(el('span', 'note', c.message));
            ul.appendChild(li);
        }
        tr.appendChild(ul);
    } else {
        empty(tr, 'No snapshot is tagged with this task yet.');
    }
    doc.appendChild(tr);

    const mem = card('Memories', v.memories.length || null);
    if (v.memories.length) {
        const ul = el('ul', 'plain');
        for (const m of v.memories) {
            const li = el('li', 'row mem');
            li.appendChild(el('span', 'type', m.type));
            li.appendChild(el('span', 'note', m.body));
            ul.appendChild(li);
        }
        mem.appendChild(ul);
    } else empty(mem, 'Nothing was remembered under this task yet.');
    doc.appendChild(mem);
}

window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'task') render(m.view);
    else if (m.type === 'gone') {
        loading.classList.remove('hidden');
        loading.textContent = m.text;
        doc.classList.add('hidden');
    }
});
post({ type: 'ready' });
</script>
</body>
</html>`;
}

/* the panel's model: everything it renders, decided here rather than in the
 * webview, so the buttons can never offer a step the workflow would refuse */
function detailView(row, spec) {
    const symbols = row.symbols || [];
    const touches = row.touches || [];
    const claimed = !!row.agent;
    const blocked = (row.blockers || []).length > 0;
    const clauses = (spec && spec.clauses) || {};
    return {
        id: row.id,
        title: row.title,
        status: row.status,
        wave: row.wave === undefined ? null : row.wave,
        section: row.section,
        feature: row.feature,
        agent: row.agent,
        role: row.role,
        branch: row.branch || row.waveBranch,
        worktree: row.worktree,
        attempt: row.claim && row.claim.attempt_id
            ? String(row.claim.attempt_id).slice(0, 12) : '',
        blockers: row.blockers || [],
        criteria: (row.reqs || []).map((c) => ({ clause: c, text: clauses[c] || '' })),
        steps: row.do || [],
        symbols, touches,
        found: symbols.filter((s) => s.found).length,
        changed: touches.filter((t) => t.changed).length,
        commits: row.commits || [],
        memories: row.memories || [],
        verify_cmd: row.verify_cmd,
        actions: [
            { action: 'start', label: 'Start', primary: row.status === 'pending',
              disabled: row.status === 'done',
              why: row.status === 'done' ? 'Already done.'
                 : blocked ? 'Requires are not met — cg spec start will refuse '
                     + 'without --force.' : 'cg spec start ' + row.id },
            { action: 'done', label: 'Complete (verified)',
              primary: row.status === 'in_progress' || row.status === 'implemented',
              disabled: row.status === 'pending' || row.status === 'done',
              why: 'cg spec done ' + row.id + ' — runs verify_cmd and the graph checks' },
            { action: 'verify', label: 'Run verify', disabled: !row.verify_cmd,
              why: row.verify_cmd || 'This task declares no verify_cmd.' },
            { action: 'claim', label: 'Claim', disabled: claimed,
              why: claimed ? `Held by ${row.agent}.` : 'cg spec claim ' + row.id },
            { action: 'release', label: 'Release', disabled: !claimed,
              why: claimed ? 'cg spec release ' + row.id : 'Nobody holds this task.' },
            { action: 'branch', label: 'Open branch',
              disabled: !(row.worktree || row.branch || row.waveBranch),
              why: row.worktree || row.branch || row.waveBranch ||
                  'No branch or worktree recorded for this task.' },
            { action: 'prompt', label: 'Copy resume prompt' },
            { action: 'spec', label: 'Open in spec' },
            { action: 'trace', label: 'Trace' },
        ],
    };
}

/* ---------------- everything below needs VS Code ---------------- */

function icon(name, color) {
    return color ? new vscode.ThemeIcon(name, new vscode.ThemeColor(color))
                 : new vscode.ThemeIcon(name);
}

function statusIcon(row) {
    if (row.status === 'done') return icon('pass-filled', 'testing.iconPassed');
    if (row.status === 'implemented') return icon('circle-large-filled', 'charts.purple');
    if (row.status === 'in_progress') return icon('play-circle', 'charts.yellow');
    if (row.blockers && row.blockers.length) return icon('circle-slash', 'charts.orange');
    if (row.next) return icon('circle-outline', 'charts.blue');
    return icon('circle-outline');
}

function statusWord(row) {
    if (row.status === 'in_progress') return 'in progress';
    if (row.status === 'implemented') return 'qualification pending';
    if (row.blockers && row.blockers.length) {
        return 'blocked by ' + row.blockers.map((b) => b.id).join(', ');
    }
    if (row.status === 'pending' && row.next) return 'next';
    return row.status;
}

class TaskTreeProvider {
    constructor(d) {
        this.deps = d || deps;
        this._em = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._em.event;
        this.model = null;    /* {status, trace, spec, plan} — or null */
        this.rows = [];
        this.filter = this.loadFilter();
        this.planSupported = true;
    }

    loadFilter() {
        const saved = this.deps && this.deps.state
            ? this.deps.state.get('codify.taskFilter') : null;
        return Object.assign({ status: 'all', wave: 'all', owner: 'all', text: '' },
            saved || {});
    }

    setFilter(patch) {
        this.filter = Object.assign({}, this.filter, patch);
        if (this.deps.state) {
            this.deps.state.update('codify.taskFilter', this.filter);
        }
        this._em.fire();
        this.describe();
    }

    /* the active filter belongs in the view title, where it cannot be
     * forgotten about while the tree looks suspiciously short */
    describe() {
        if (!treeView) return;
        const label = filterLabel(this.filter);
        try {
            treeView.description = label || undefined;
            const shown = this.visible().length;
            treeView.badge = label && this.rows.length
                ? { value: shown, tooltip: `${shown} of ${this.rows.length} tasks — ${label}` }
                : undefined;
        } catch (_) { /* older VS Code: description/badge unsupported */ }
    }

    visible() { return taskFilter(this.rows, this.filter); }

    /* One pass, inside the caller's refresh chain: status, trace from the
     * index that chain just refreshed, the spec file, and the fleet's wave
     * branches when this cg knows about them. */
    async refresh() {
        const status = await this.deps.cgJson(['spec', 'status']);
        if (!status) {
            this.model = null;
            this.rows = [];
        } else {
            const trace = await this.deps.cgJson(['spec', 'trace', '--no-sync']) ||
                { graph: false, tasks: [] };
            const spec = this.readSpecFile(status.spec);
            const plan = await this.fleetPlan();
            this.model = { status, trace, spec, plan };
            this.rows = mergeTasks(spec, trace, status, plan);
        }
        this._em.fire();
        this.describe();
        if (this.deps.onModel) this.deps.onModel(this.model);
        refreshPanels();
    }

    readSpecFile(rel) {
        const root = this.deps.workspaceRoot();
        if (!root || !rel) return null;
        try {
            return readSpec(fs.readFileSync(path.join(root, rel), 'utf8'));
        } catch (_) {
            return null;   /* the board works without the declaration half */
        }
    }

    async fleetPlan() {
        if (!this.planSupported) return null;
        const plan = await this.deps.cgJson(['fleet', 'plan']);
        if (!plan) this.planSupported = false;   /* older cg: ask once */
        return plan;
    }

    row(id) { return this.rows.find((r) => r.id === id); }

    owners() {
        return [...new Set(this.rows.map((r) => r.agent).filter(Boolean))].sort();
    }

    waves() {
        return [...new Set(this.rows.map((r) => r.wave)
            .filter((w) => w !== undefined && w !== null))]
            .sort((a, b) => Number(a) - Number(b));
    }

    getTreeItem(el) { return el; }

    getChildren(el) {
        if (!this.model) return [];
        if (!el) return this.featureNodes();
        if (el.kind === 'feature') return this.sectionNodes(el.rows, el.feature);
        if (el.kind === 'section') return this.waveNodes(el.rows, el.nodeKey);
        if (el.kind === 'wave') return el.rows.map((r) => this.taskNode(r));
        return [];
    }

    featureNodes() {
        const rows = this.visible();
        const s = this.model.status;
        const nodes = [];
        if (!rows.length && this.rows.length) {
            const none = new vscode.TreeItem(
                'No task matches this filter', vscode.TreeItemCollapsibleState.None);
            none.description = filterLabel(this.filter);
            none.iconPath = icon('filter');
            none.contextValue = 'filter-empty';
            none.command = { command: 'codify.tasks.clearFilters',
                title: 'Clear filters' };
            nodes.push(none);
            return nodes;
        }
        const byFeature = groupBy(rows, (r) => r.feature || s.feature || 'tasks');
        for (const [feature, frows] of byFeature) {
            const it = new vscode.TreeItem(feature,
                vscode.TreeItemCollapsibleState.Expanded);
            it.kind = 'feature';
            it.id = `feature:${feature}`;
            it.feature = feature;
            it.rows = frows;
            it.contextValue = 'feature';
            const done = frows.filter((r) => r.status === 'done').length;
            const label = filterLabel(this.filter);
            it.description = `${done}/${frows.length} done` +
                (label ? ` · ${label}` : '');
            it.iconPath = icon('milestone');
            const intro = this.model.spec && this.model.spec.intro;
            it.tooltip = new vscode.MarkdownString(
                `**${feature}**${intro ? `\n\n${intro}` : ''}` +
                `\n\n${s.mode} mode · ${s.done}/${s.tasks} done` +
                (label ? `\n\nfiltered: ${label}` : ''));
            nodes.push(it);
        }
        const docs = this.docsNode();
        if (docs) nodes.push(docs);
        return nodes;
    }

    /* the @docs closure is not in the task list but is the last thing the
     * feature owes, so it keeps its own row */
    docsNode() {
        const d = this.model.status.documentation;
        if (!d || !d.configured || d.mode === 'off') return null;
        const row = { id: '@docs', title: 'Generate and verify project documentation',
            status: d.status, wave: 'closure', blockers: [], virtual: true };
        const it = new vscode.TreeItem('Documentation closure',
            vscode.TreeItemCollapsibleState.None);
        it.kind = 'task';
        it.id = 'task:@docs';
        it.task = row;
        it.contextValue = `task-${d.status}`;
        it.description = d.status + (d.ready ? ' · ready' : '');
        it.iconPath = d.status === 'done'
            ? icon('book', 'testing.iconPassed') : icon('book');
        it.command = { command: 'codify.tasks.detail', title: 'Open task',
            arguments: ['@docs'] };
        return it;
    }

    sectionNodes(rows, feature) {
        const bySection = groupBy(rows, (r) => r.section || 'Tasks');
        /* a spec with no sections should not grow an extra level of nothing */
        if (bySection.size === 1 && !rows.some((r) => r.section)) {
            return this.waveNodes(rows, `feature:${feature}`);
        }
        return [...bySection].map(([section, srows]) => {
            const it = new vscode.TreeItem(section,
                vscode.TreeItemCollapsibleState.Expanded);
            it.kind = 'section';
            it.nodeKey = `section:${feature}:${section}`;
            it.id = it.nodeKey;
            it.rows = srows;
            it.contextValue = 'section';
            const done = srows.filter((r) => r.status === 'done').length;
            it.description = `${done}/${srows.length} done`;
            it.iconPath = icon(done === srows.length ? 'folder' : 'folder-opened');
            return it;
        });
    }

    waveNodes(rows, parentKey) {
        const byWave = groupBy(rows, (r) => String(r.wave));
        return [...byWave]
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([wave, wrows]) => {
                const done = wrows.filter((r) => r.status === 'done').length;
                const impl = wrows.filter((r) => r.status === 'implemented').length;
                const it = new vscode.TreeItem(`Wave ${wave}`,
                    done === wrows.length
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.Expanded);
                it.kind = 'wave';
                it.nodeKey = `${parentKey}:wave:${wave}`;
                it.id = it.nodeKey;
                it.rows = wrows;
                it.contextValue = 'wave';
                const branch = wrows.map((r) => r.waveBranch).find(Boolean) || '';
                it.description = `${done}/${wrows.length} done` +
                    (impl ? ` · ${impl} implemented` : '') +
                    (branch ? ` · ${branch}` : '');
                it.iconPath = icon(done === wrows.length ? 'layers-dot' : 'layers');
                if (branch) {
                    it.tooltip = new vscode.MarkdownString(
                        `Wave ${wave} — branch \`${branch}\``);
                }
                return it;
            });
    }

    taskNode(row) {
        const it = new vscode.TreeItem(`${row.id}  ${row.title}`,
            vscode.TreeItemCollapsibleState.None);
        it.kind = 'task';
        it.id = `task:${row.id}`;
        it.task = row;
        it.contextValue = `task-${row.status}`;
        const badge = this.deps.sessionBadge ? this.deps.sessionBadge(row.id) : '';
        it.description = [
            statusWord(row),
            row.agent ? `$(person) ${row.agent}${row.role ? ` ${row.role}` : ''}` : '',
            row.branch ? `$(git-branch) ${row.branch}` : '',
        ].filter(Boolean).join(' · ') + badge;
        it.iconPath = statusIcon(row);
        it.tooltip = this.tooltip(row);
        it.command = { command: 'codify.tasks.detail', title: 'Open task',
            arguments: [row.id] };
        return it;
    }

    tooltip(row) {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${row.id}** ${row.title}\n\n`);
        md.appendMarkdown(`status: \`${row.status}\`  ·  wave: \`${row.wave}\``);
        if (row.section) md.appendMarkdown(`  ·  ${row.section}`);
        if (row.agent) {
            md.appendMarkdown(`\n\nclaimed by **${row.agent}**` +
                (row.role ? ` (${row.role})` : '') +
                (row.claim && row.claim.parent ? ` under ${row.claim.parent}` : '') +
                (row.claim && row.claim.expires_in_min !== undefined
                    ? ` — ${row.claim.expires_in_min} min left` : ''));
        }
        if (row.branch) md.appendMarkdown(`\n\nbranch: \`${row.branch}\``);
        if (row.worktree) md.appendMarkdown(`\n\nworktree: \`${row.worktree}\``);
        if (row.blockers && row.blockers.length) {
            md.appendMarkdown('\n\nblocked by ' + row.blockers
                .map((b) => `\`${b.id}\` (${b.status})`).join(', '));
        }
        const touches = (row.touches || []).map((t) => t.pattern).join(' ');
        if (touches) md.appendMarkdown(`\n\ntouches: \`${touches}\``);
        if (row.verify_cmd) md.appendMarkdown(`\n\nverify: \`${row.verify_cmd}\``);
        return md;
    }
}

function groupBy(rows, key) {
    const out = new Map();
    for (const r of rows) {
        const k = key(r);
        if (!out.has(k)) out.set(k, []);
        out.get(k).push(r);
    }
    return out;
}

/* ---------------- the detail panel ---------------- */

/* Open (or reveal) the detail panel for a task. One panel per task, reused,
 * so clicking around the tree never buries the editor in panels. */
async function taskDetail(arg) {
    const id = await resolveId(arg, 'Open which task?');
    if (!id) return;
    const open = panels.get(id);
    if (open) {
        open.panel.reveal(open.panel.viewColumn, true);
        postTask(id);
        return;
    }
    const panel = vscode.window.createWebviewPanel(
        'codifyTaskDetail', `codify: ${id}`,
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
        { enableScripts: true, retainContextWhenHidden: true });
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    panel.webview.html = detailHtml(nonce);
    panels.set(id, { panel, webview: panel.webview });
    panel.onDidDispose(() => panels.delete(id));
    panel.webview.onDidReceiveMessage((msg) => panelMessage(id, msg));
}

function postTask(id) {
    const entry = panels.get(id);
    if (!entry) return;
    const row = provider && provider.row(id);
    if (!row) {
        try {
            entry.webview.postMessage({ type: 'gone',
                text: `Task ${id} is no longer in the spec.` });
        } catch (_) { /* disposed */ }
        return;
    }
    const view = detailView(row, provider.model && provider.model.spec);
    try {
        entry.webview.postMessage({ type: 'task', view });
    } catch (_) { /* disposed between refresh and post */ }
}

function refreshPanels() {
    for (const id of panels.keys()) postTask(id);
}

async function panelMessage(id, msg) {
    if (!msg) return;
    if (msg.type === 'ready') { postTask(id); return; }
    if (msg.type === 'symbol') { await openSymbol(msg); return; }
    if (msg.type === 'path') { await openPath(msg.path); return; }
    if (msg.type !== 'action') return;
    const cmds = {
        start: 'codify.startTask',
        done: 'codify.doneTask',
        claim: 'codify.claimTask',
        release: 'codify.releaseTask',
        spec: 'codify.openTask',
        trace: 'codify.traceTask',
        verify: 'codify.tasks.verify',
        branch: 'codify.tasks.openBranch',
        prompt: 'codify.tasks.copyPrompt',
    };
    const cmd = cmds[msg.action];
    if (cmd) await vscode.commands.executeCommand(cmd, id);
}

/* A declared symbol is a link into the code when the graph resolved it, and a
 * `cg symbol` lookup when it did not — which is the answer to "why is this
 * task not done yet". */
async function openSymbol(msg) {
    const root = deps.workspaceRoot();
    if (msg.path && msg.line && root) {
        const uri = vscode.Uri.file(path.join(root, msg.path));
        const at = new vscode.Range(msg.line - 1, 0, msg.line - 1, 0);
        await vscode.commands.executeCommand('vscode.open', uri, { selection: at });
        return;
    }
    const r = await deps.cg(['symbol', msg.name]);
    const text = (r.stdout || '') + (r.stderr || '');
    if (r.code === 0 && text.trim()) deps.show(text);
    else {
        vscode.window.showInformationMessage(
            `Codify: ${msg.name} is not in the graph yet.`);
    }
}

async function openPath(pattern) {
    const root = deps.workspaceRoot();
    if (!root || !pattern) return;
    if (pattern.includes('*')) {
        const stem = pattern.split('*')[0];
        await vscode.commands.executeCommand('workbench.action.quickOpen', stem);
        return;
    }
    const uri = vscode.Uri.file(path.join(root, pattern));
    try {
        await vscode.commands.executeCommand('vscode.open', uri);
    } catch (_) {
        vscode.window.showInformationMessage(
            `Codify: ${pattern} does not exist yet.`);
    }
}

/* ---------------- commands ---------------- */

function taskIdFrom(arg) {
    if (typeof arg === 'string') return arg;
    if (arg && arg.task) return arg.task.id;
    if (arg && arg.id && typeof arg.id === 'string' && !arg.kind) return arg.id;
    return undefined;
}

/* every command works from the tree, the palette, and the panel: an argument
 * when one came with the click, a quick pick when it did not */
async function resolveId(arg, placeHolder, filter) {
    const id = taskIdFrom(arg);
    if (id) return id;
    const rows = (provider ? provider.visible() : []).filter(filter || (() => true));
    if (!rows.length) {
        vscode.window.showInformationMessage('Codify: no matching tasks.');
        return undefined;
    }
    const pick = await vscode.window.showQuickPick(rows.map((r) => ({
        label: `${r.id}  ${r.title}`,
        description: statusWord(r) + (r.agent ? ` · ${r.agent}` : ''),
        detail: (r.touches || []).map((t) => t.pattern).join('  '),
        id: r.id,
    })), { placeHolder: placeHolder || 'Codify task', matchOnDescription: true });
    return pick && pick.id;
}

async function cmdFilterStatus() {
    const counts = new Map();
    for (const r of provider.rows) {
        counts.set(r.status, (counts.get(r.status) || 0) + 1);
    }
    const blocked = provider.rows.filter((r) => r.blockers.length).length;
    const items = STATUS_FILTERS.map((s) => ({
        label: s === 'all' ? 'All statuses' : s.replace('_', ' '),
        description: s === 'all' ? `${provider.rows.length} tasks`
            : s === 'blocked' ? `${blocked} with unmet requires`
            : s === 'open' ? `${provider.rows.filter((r) => r.status !== 'done').length} not done`
            : `${counts.get(s) || 0}`,
        picked: (provider.filter.status || 'all') === s,
        value: s,
    }));
    const pick = await vscode.window.showQuickPick(items,
        { placeHolder: 'Show which tasks?' });
    if (pick) provider.setFilter({ status: pick.value });
}

async function cmdFilterWave() {
    const items = [{ label: 'All waves', value: 'all',
        description: `${provider.rows.length} tasks` }];
    for (const w of provider.waves()) {
        const rows = provider.rows.filter((r) => String(r.wave) === String(w));
        const done = rows.filter((r) => r.status === 'done').length;
        const branch = rows.map((r) => r.waveBranch).find(Boolean) || '';
        items.push({ label: `Wave ${w}`, value: String(w),
            description: `${done}/${rows.length} done${branch ? ` · ${branch}` : ''}` });
    }
    const pick = await vscode.window.showQuickPick(items,
        { placeHolder: 'Show which wave?' });
    if (pick) provider.setFilter({ wave: pick.value });
}

async function cmdFilterOwner() {
    const owners = provider.owners();
    const unclaimed = provider.rows.filter((r) => !r.agent).length;
    const items = [
        { label: 'Anyone', value: 'all', description: `${provider.rows.length} tasks` },
        { label: 'Unclaimed', value: 'unclaimed', description: `${unclaimed} tasks` },
        ...owners.map((a) => {
            const rows = provider.rows.filter((r) => r.agent === a);
            const role = rows.map((r) => r.role).find(Boolean) || '';
            const branch = rows.map((r) => r.branch).find(Boolean) || '';
            return { label: a, value: a,
                description: `${rows.length} claimed${role ? ` · ${role}` : ''}` +
                    `${branch ? ` · ${branch}` : ''}` };
        }),
    ];
    const pick = await vscode.window.showQuickPick(items,
        { placeHolder: owners.length ? 'Show whose tasks?'
            : 'Nothing is claimed right now' });
    if (pick) provider.setFilter({ owner: pick.value });
}

async function cmdSearch() {
    const text = await vscode.window.showInputBox({
        prompt: 'Filter tasks by id, title, section, owner, symbol or path',
        placeHolder: 'graph, src/scan.c, TaskTreeProvider…',
        value: provider.filter.text || '',
    });
    if (text === undefined) return;
    provider.setFilter({ text: text.trim() });
}

function cmdClearFilters() {
    provider.setFilter({ status: 'all', wave: 'all', owner: 'all', text: '' });
}

/* one entry point for all four, so the toolbar needs one icon */
async function cmdFilter() {
    const label = filterLabel(provider.filter);
    const items = [
        { label: '$(circle-outline) Status…', cmd: 'codify.tasks.filterStatus',
          description: provider.filter.status },
        { label: '$(layers) Wave…', cmd: 'codify.tasks.filterWave',
          description: String(provider.filter.wave) },
        { label: '$(person) Owner…', cmd: 'codify.tasks.filterOwner',
          description: String(provider.filter.owner) },
        { label: '$(search) Search…', cmd: 'codify.tasks.search',
          description: provider.filter.text || '' },
        { label: '$(clear-all) Clear filters', cmd: 'codify.tasks.clearFilters' },
    ];
    const pick = await vscode.window.showQuickPick(items, {
        placeHolder: label ? `Filtered: ${label}` : 'No filter — showing every task',
    });
    if (pick) await vscode.commands.executeCommand(pick.cmd);
}

/* The verify command runs where you can watch it and stop it: a terminal,
 * one per task, in the task's own worktree when the fleet gave it one. */
async function cmdVerify(arg) {
    const id = await resolveId(arg, 'Run which task\'s verify command?',
        (r) => !!r.verify_cmd);
    if (!id) return;
    const row = provider.row(id);
    if (!row || !row.verify_cmd) {
        vscode.window.showInformationMessage(
            `Codify: task ${id} declares no verify_cmd — \`cg spec done\` ` +
            'checks only the graph.');
        return;
    }
    const cwd = row.worktree && fs.existsSync(row.worktree)
        ? row.worktree : deps.workspaceRoot();
    let term = verifyTerms.get(id);
    if (!term || term.exitStatus !== undefined) {
        term = vscode.window.createTerminal({ name: `codify: verify ${id}`, cwd });
        verifyTerms.set(id, term);
    }
    term.show(true);
    term.sendText(row.verify_cmd, true);
}

/* Opening a worktree reloads or replaces a window, so it is always a choice,
 * never a side effect of clicking a task. */
async function cmdOpenBranch(arg) {
    const id = await resolveId(arg, 'Open the branch of which task?');
    if (!id) return;
    const row = provider.row(id);
    if (!row) return;
    const branch = row.branch || row.waveBranch;
    if (row.worktree && fs.existsSync(row.worktree)) {
        const pick = await vscode.window.showQuickPick([
            { label: '$(empty-window) Open worktree in a new window', v: 'new' },
            { label: '$(window) Open worktree in this window', v: 'here' },
            { label: '$(clippy) Copy the worktree path', v: 'copy' },
        ], { placeHolder: `${row.worktree}${branch ? ` — ${branch}` : ''}` });
        if (!pick) return;
        if (pick.v === 'copy') {
            await vscode.env.clipboard.writeText(row.worktree);
            vscode.window.showInformationMessage('Codify: worktree path copied.');
            return;
        }
        await vscode.commands.executeCommand('vscode.openFolder',
            vscode.Uri.file(row.worktree), { forceNewWindow: pick.v === 'new' });
        return;
    }
    if (!branch) {
        vscode.window.showInformationMessage(
            `Codify: no branch is recorded for ${id}. \`cg fleet begin ${id}\` ` +
            'creates the wave branch and its worktree.');
        return;
    }
    /* Checking out for someone is how work gets lost; offer the command. */
    const pick = await vscode.window.showInformationMessage(
        `Codify: ${id} has no worktree here. Its branch is ${branch}.`,
        'Copy branch name', `Copy git switch command`);
    if (pick === 'Copy branch name') {
        await vscode.env.clipboard.writeText(branch);
    } else if (pick) {
        await vscode.env.clipboard.writeText(`git switch ${branch}`);
    }
}

async function cmdCopyPrompt(arg) {
    const id = await resolveId(arg, 'Copy the resume prompt of which task?');
    if (!id) return;
    const row = provider.row(id);
    if (!row) return;
    const text = resumePrompt(row,
        { clauses: (provider.model && provider.model.spec &&
            provider.model.spec.clauses) || {} });
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage(
        `Codify: resume prompt for ${id} copied — paste it into any agent.`);
}

/* ---------------- registration ---------------- */

function register(ctx, d) {
    deps = d;
    provider = new TaskTreeProvider(d);
    treeView = vscode.window.createTreeView('codifyTasks', {
        treeDataProvider: provider, showCollapseAll: true,
    });
    ctx.subscriptions.push(treeView);

    const cmds = {
        'codify.tasks.detail': taskDetail,
        'codify.tasks.filter': cmdFilter,
        'codify.tasks.filterStatus': cmdFilterStatus,
        'codify.tasks.filterWave': cmdFilterWave,
        'codify.tasks.filterOwner': cmdFilterOwner,
        'codify.tasks.search': cmdSearch,
        'codify.tasks.clearFilters': cmdClearFilters,
        'codify.tasks.verify': cmdVerify,
        'codify.tasks.openBranch': cmdOpenBranch,
        'codify.tasks.copyPrompt': cmdCopyPrompt,
    };
    for (const [name, fn] of Object.entries(cmds)) {
        ctx.subscriptions.push(vscode.commands.registerCommand(name, fn));
    }
    ctx.subscriptions.push(vscode.window.onDidCloseTerminal((t) => {
        for (const [id, term] of verifyTerms) {
            if (term === t) verifyTerms.delete(id);
        }
    }));
    ctx.subscriptions.push({
        dispose: () => {
            for (const { panel } of panels.values()) panel.dispose();
            panels.clear();
        },
    });
    return provider;
}

module.exports = {
    /* the view */
    TaskTreeProvider, taskFilter, taskDetail, register,
    /* the pure half, exported for the integration test */
    parseKvx, readSpec, mergeTasks, resumePrompt, detailHtml, detailView,
    filterLabel, statusWord,
};
