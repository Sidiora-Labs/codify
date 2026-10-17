# Events, serve, and drivers

Everything a fleet does — a task changing status, a claim, an agent
spawning, a tool call it made, a merge, a gate, a pull request, a stall, a
drift finding, an approval — is appended to one table with a sequence
number. Anything that wants to follow the fleet reads that table from a
cursor instead of polling commands and diffing their output: `hyperfide events`
in a terminal, `hyperfide serve` for an editor, the supervisor itself.

`hyperfide` is the command; `cg` is the deprecated compatibility alias from
the same executable, with identical arguments, JSON and exit codes.

Implemented in `src/events.c`, `src/serve.c`, and `src/drivers.c`; covered
by `tests/integration/30_events.sh` and `tests/integration/31_serve.sh`.

## The event log

```
events(seq INTEGER PRIMARY KEY AUTOINCREMENT, at, kind, subject, run, node, branch, payload)
```

`at` is milliseconds since the epoch, `subject` is what the event is about
(`alpha/2.1`, a feature, an agent, a run id), `node` is the agent that
caused it when one did, and `payload` is JSON. The table is additive: it
needed no schema version bump, so no project's graph is rebuilt to get it.

Three ways in, one table:

- **Triggers on the durable tables** — attempts, leases, agents, memories,
  runtime events. The event commits or rolls back with the change it
  describes, and every writer emits without being taught to, including an
  older binary that has never heard of events.
- **The kvx status hook.** Task status lives in `spec.kvx`, not SQLite, so
  every status rewrite reports its transition here as `task.status`.
- **Explicit emits** for what has no row of its own: fleet merges, gates,
  lands, pull requests, supervisor decisions, orchestrator spawns and exits,
  drift, and agent output.

| Kind | What happened |
|---|---|
| `task.status` | a task's status changed (`from`, `status`, the spec file written) |
| `claim`, `release`, `attempt.start`, `attempt.end`, `attempt.branch` | lease and attempt lifecycle |
| `agent.join`, `agent.update` | an agent registered its role, parent, feature, wave, worktree |
| `orch.spawn`, `orch.exit`, `orch.stop`, `orch.complete` | the orchestrator started, reaped, or stopped a process, or finished a subtree |
| `fleet.run`, `fleet.begin`, `fleet.merge`, `fleet.gate`, `fleet.land`, `fleet.pr`, `fleet.checkpoint` | the run and the branch flow |
| `fleet.sync`, `fleet.forward` | a worker merged its base into its task branch (`hyperfide fleet sync`); the supervisor merged main forward into a wave branch and steered its workers |
| `agent.session`, `agent.text`, `agent.tool`, `agent.usage`, `agent.result` | what an agent said, did, and spent (from its structured output) |
| `agent.steer`, `agent.steer.delivered` | a message queued for an agent, and its delivery |
| `agent.native.start`, `agent.native.spawn`, `agent.native.tool`, `agent.native.stop`, `agent.native.worktree` | a host's own session or subagent (Claude Code, Codex) started, announced a spawn through its Agent tool, finished a tool call, stopped, or created/removed a worktree — from `hyperfide hook event` (see below) |
| `supervisor.stall`, `supervisor.escalate`, `supervisor.blocked`, `supervisor.budget` | supervision decisions |
| `approval.request`, `approval.decided` | the opt-in approval gates |
| `drift.spec`, `drift.interface`, `drift.collision`, `drift.coverage` | drift findings (see [drift.md](drift.md)) |
| `projection.conflict`, `projection.resolved`, `projection.built` | a projection build found a new conflict finding (kind, path, symbol, lines, branches, agents, advice), stopped finding one, or finished (branches, conflicts, new, resolved, ms, commit); see [projection.md](projection.md#findings) |
| `memory.add`, `memory.import` | a memory was written; memories were imported (`hyperfide memory import`) |
| `agent.activity` | a runtime event was ingested (`hyperfide event ingest`): source, kind, attempt, evidence delta |

Retention is by count: 50000 events by default (`HYPERFIDE_EVENTS_KEEP`), pruned
in batches. `seq` is `AUTOINCREMENT`, so a number is never reused after a
prune, and `meta.events_pruned_through` tells a reader whose cursor fell
behind the prune that it missed events.

## `hyperfide events`

```
hyperfide events [--since N] [--kind K,..] [-n N] [--follow [--for S]] [--head] [--json]
```

```
$ hyperfide events --kind supervisor.,drift. --since 0 -n 3
    56  20:11:29  supervisor.stall alpha/2.2   on main  {"agent":"w-alpha-2.2","task":"2.2","action":"nudge","reason":"no progress","value":2}
    60  20:11:31  supervisor.stall alpha/2.2   on main  {"agent":"w-alpha-2.2","task":"2.2","action":"stop","reason":"stalled — no progress for 2s after a nudge","value":2}
    83  20:11:32  drift.interface alpha/2.2    by w-alpha-2.2  on task/alpha/2.2  {"symbol":"alpha","change":"signature",...}
```

`--kind` takes a comma list; an entry ending in `.` or `*` matches as a
prefix, so `fleet.` is every fleet event. `-n` is the newest N (default 50)
unless `--since` gives a cursor. `--follow` keeps printing as events commit
(`-f` for short; `--for S` stops after S seconds), `--head` prints the current highest
sequence number, and `--json` is one object per line.

<a id="cg-serve"></a>

## `hyperfide serve`

One long-lived connection for an editor or supervisor UI: newline-delimited
JSON-RPC 2.0 over stdio.

| Method | Does |
|---|---|
| `initialize` | protocol (`codify-serve/1`, the protocol id keeps its Codify name), version, root, branch, event head, capabilities |
| `tools/list`, `tools/call` | every MCP tool, from the same table `hyperfide mcp` serves |
| `exec {args:[...]}` | any `hyperfide` command, exactly as the CLI runs it: `{exit, stdout, stderr, cancelled, truncated}` |
| `cancel {id}` | stop an in-flight `tools/call` or `exec` |
| `subscribe {since?, kinds?}` | push `events` notifications from that sequence number; `kinds` is the same comma-list string `hyperfide events --kind` takes |
| `snapshot {all?}` | the native agents now: `{head, native: [...], counts: {live, subagents, worktree_branches}}` — the same tree `hyperfide fleet tree --json` carries, current to event `head`; `all` includes sessions stopped for more than a day. Runs the transcript discovery pass (`hyperfide fleet discover`) first |
| `unsubscribe {subscription}`, `ping`, `shutdown` | |

```
→ {"jsonrpc":"2.0","id":3,"method":"subscribe","params":{"since":136}}
← {"jsonrpc":"2.0","id":3,"result":{"subscription":1,"cursor":136,"head":138}}
← {"jsonrpc":"2.0","method":"events","params":{"subscription":1,"events":[{"seq":137,"kind":"orch.complete",...},{"seq":138,"kind":"fleet.run",...}],"cursor":138}}
```

Every call runs in a child process — this binary, re-executed — so a
`verify_cmd` that takes minutes never holds up an event push, up to 32
calls run at once, and a cancel is a signal to one process group. The
server's own connection only reads the event log: idle, it holds no write
lock and runs no index pass. It wakes on writes to the database files
(inotify on Linux, a 150 ms stat poll elsewhere) and reads each
subscriber's events from its cursor, so an event reaches the client within
milliseconds of its commit; the suite asserts under 250 ms.

An editor follows native agents the way it follows fleet agents: it takes
a `snapshot` (or `hyperfide fleet tree --json`), subscribes from that head, and
folds every `agent.native.start`, `agent.native.spawn`,
`agent.native.tool` and `agent.native.stop` onto the rows — each payload
carries the agent's whole row, so no event needs a second call. The VS
Code extension's Sessions root (see
[hierarchy.md](hierarchy.md#native-sessions-in-the-editor)) is built that
way.

## `hyperfide tool`

`hyperfide tool list` prints the MCP tool table; `hyperfide tool call <name> [json]` runs
one tool without an MCP client and prints its result:

```
$ hyperfide tool call get_symbol '{"name":"alpha"}'
{"definitions":[{"name":"alpha","kind":"function","path":"src/a.ts","line":1,"end_line":3,"references":1,...}]}
```

## Drivers and structured output

A driver is how an agent is launched and how what it does comes back. The
driver, model, and extra arguments come from the role's capabilities (see
[hierarchy.md](hierarchy.md#role-capabilities)).

Structured output is the default, because an agent the supervisor cannot
read is an agent it cannot supervise: `claude -p --output-format
stream-json --verbose` and `codex exec --json`. The agent's stdout and
stderr still go to its log under `.codegraph/agents/`. A tap follows that
file by byte offset and turns each complete JSON line into `agent.session`,
`agent.text`, `agent.tool`, `agent.usage`, and `agent.result` events, with
tokens and cost counted per node. The dialect is recognised from the line
itself, so a `custom` driver that prints either format is read the same
way. Lines that are not JSON stay in the log and are ignored.

## Steering a running agent

```
$ hyperfide fleet steer w-alpha-3.2 "try the smaller fix"
queued for w-alpha-3.2 (#139): delivered at its next edit (Claude Code, through the post-edit hook) or its next prompt
```

A steering message is an `agent.steer` event. A Claude Code session gets it
at its next edit: the post-edit hook (`hyperfide hook post-edit`) returns it as
`additionalContext`. Any agent gets it in its next prompt. A per-agent
cursor records what was delivered, so nothing arrives twice, and delivery
is recorded as `agent.steer.delivered`. The supervisor steers with the same
call: stall nudges, escalations, and interface-drift notices all go out
this way.

<a id="native-agents-cg-hook-event"></a>

## Native agents (`hyperfide hook event`)

A Claude Code or Codex session, and every subagent it spawns through its own
Agent tool, never passes through `hyperfide fleet`. Its hooks do:

```
hyperfide hook event --host claude|codex [--json]     # one hook payload on stdin
```

Each payload is recorded in the `agents` registry with `kind = 'native'`
and then fed to `hyperfide event ingest --source <host>`, so runtime evidence
(`hyperfide event history`, `hyperfide event progress`, `agent.activity`)
keeps working unchanged.

| Hook | Registry | Event |
|---|---|---|
| `SessionStart` | the session `<host>:<first 8 of session_id>`: host, session, cwd, model, started, state `live` | `agent.native.start` |
| `PreToolUse` of `Agent` or `Task` | a pending spawn `<host>:spawn:<tool_use_id>` (description, subagent_type, model, task) | `agent.native.spawn` (also isolation, run_in_background, tool_use_id, the first 200 characters of the prompt) |
| `SubagentStart` | the subagent `<host>:<agent_id>`, parent the spawner; claims the pending spawn named by `toolUseId` in its `meta.json`, else the oldest pending spawn of its type in the session | `agent.native.start` |
| `PreToolUse` / `PostToolUse` | heartbeat (`seen`), `last_tool`, `tool_calls` of the agent the payload speaks for | `agent.native.tool` (on `PostToolUse`) |
| `SubagentStop` | state `stopped`, `ended`, `transcript` | `agent.native.stop` (with the last message excerpt) |
| `Stop`, `SessionEnd` | the session `stopped` (any later hook makes it `live` again) | `agent.native.stop`, once per transition |
| `WorktreeCreate`, `WorktreeRemove` | heartbeat | `agent.native.worktree` (the payload kept) |

Every `agent.native.*` event carries `node` = the agent name (for a spawn,
the spawner), `subject` = the task when known, and a payload with agent,
host, session, parent, state, agent_type, description, model, depth, cwd,
worktree, branch, task, and task_source.

- **Worktrees.** A `cwd` inside a linked worktree of the project records
  the worktree and its branch on the agent (read from the repository's own
  files, no process spawned) and registers the branch in `hyperfide branches` with
  base the session's branch.
- **Tasks**, in order, with `task_source`: `env` (`HYPERFIDE_TASK` in the hook's
  environment), `attempt` (a live attempt whose session is this session),
  `prompt` (a task id of the active feature named in the spawn's
  description or prompt — a bare dotted id such as `2.1` or a
  `[spec:feature/id]` tag), `parent` (the parent's task).
- **Views.** `hyperfide fleet status` lists native sessions and their subagents as
  an indented tree after the fleet roles (age since the last hook, state —
  `stale` after 120 s without a hook — host, model, branch, task, last
  tool); `hyperfide fleet status --json` and `hyperfide fleet tree --json` carry
  `native: [{agent, host, session, model, started, state, stale, seen, cwd,
  worktree, branch, task, task_source, description, agent_type, parent,
  depth, last_tool, tool_calls, ended, transcript, children: [...]}]`
  (`fleet tree --json` answers `{"hierarchy": false, "native": [...]}` in a
  repository without a `[hierarchy]`). `hyperfide brief` and `hyperfide state` print
  `native agents: N live, M subagents, K worktree branches`. Sessions
  stopped for more than a day are hidden unless `--all`.
- **Never fatal.** The command always exits 0; a malformed payload is
  logged to `.codegraph/hooks.log` and stderr, and a database still busy
  after 3 s leaves the registry untouched for that one payload.

## The Hyperfide control plane

The event log is one checkout's SQLite table, and every surface above
reads it locally. In distributed authority mode (a
`.hyperfide/authority.json` descriptor, or `HYPERFIDE_AUTHORITY_DESCRIPTOR`;
`hyperfide authority mode` prints the mode), `hyperfide events` refuses with
`DISTRIBUTED_COMMAND_UNSUPPORTED`, exit 78 (`src/hyperfide/client.c`), and
`hyperfide fleet status` is routed to the service's fleet view instead of
the local tables.

The service keeps its own durable events in PostgreSQL: a transactional
outbox and committed delivery (`services/hyperfide/src/events/outbox.ts`),
inbox deduplication and replay-gap recovery (`events/inbox.ts`,
`events/recovery.ts`), and generation-bound start, steering and cancellation
instructions (`events/instructions.ts`). Historical SQLite sequence numbers
are imported as provenance and never become a delivery cursor
([migration.md](../spec/hyperfide/migration.md)). Tasks 6.1 to 6.4 and
25.3 are `pending` in `spec/hyperfide/spec.kvx`, so that path is not
qualified in this revision.

## Limitations

- An event records that something happened, not that it is still true. A
  `fleet.merge` with `outcome: "conflict"` stays in the log after the
  conflict is resolved; read the later events or the branch state for the
  current answer.
- The log is local to one `.codegraph/`. Nothing replicates it between
  machines.
- A Codex agent is steered only through its next prompt; only Claude Code
  has a hook that can deliver a message during a turn.
- Cost comes from what the agent reports. A driver that prints no usage
  counts as zero spend, and a USD `spend` budget cannot stop it.
