# Events, serve, and drivers

Everything a fleet does — a task changing status, a claim, an agent
spawning, a tool call it made, a merge, a gate, a pull request, a stall, a
drift finding, an approval — is appended to one table with a sequence
number. Anything that wants to follow the fleet reads that table from a
cursor instead of polling commands and diffing their output: `cg events`
in a terminal, `cg serve` for an editor, the supervisor itself.

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
  older `cg` binary that has never heard of events.
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
| `agent.session`, `agent.text`, `agent.tool`, `agent.usage`, `agent.result` | what an agent said, did, and spent (from its structured output) |
| `agent.steer`, `agent.steer.delivered` | a message queued for an agent, and its delivery |
| `supervisor.stall`, `supervisor.escalate`, `supervisor.blocked`, `supervisor.budget` | supervision decisions |
| `approval.request`, `approval.decided` | the opt-in approval gates |
| `drift.spec`, `drift.interface`, `drift.collision`, `drift.coverage` | drift findings (see [drift.md](drift.md)) |
| `memory.add` | a memory was written |

Retention is by count: 50000 events by default (`CG_EVENTS_KEEP`), pruned
in batches. `seq` is `AUTOINCREMENT`, so a number is never reused after a
prune, and `meta.events_pruned_through` tells a reader whose cursor fell
behind the prune that it missed events.

## `cg events`

```
cg events [--since N] [--kind K,..] [-n N] [--follow [--for S]] [--head] [--json]
```

```
$ cg events --kind supervisor.,drift. --since 0 -n 3
    56  20:11:29  supervisor.stall alpha/2.2   on main  {"agent":"w-alpha-2.2","task":"2.2","action":"nudge","reason":"no progress","value":2}
    60  20:11:31  supervisor.stall alpha/2.2   on main  {"agent":"w-alpha-2.2","task":"2.2","action":"stop","reason":"stalled — no progress for 2s after a nudge","value":2}
    83  20:11:32  drift.interface alpha/2.2    by w-alpha-2.2  on task/alpha/2.2  {"symbol":"alpha","change":"signature",...}
```

`--kind` takes a comma list; an entry ending in `.` or `*` matches as a
prefix, so `fleet.` is every fleet event. `-n` is the newest N (default 50)
unless `--since` gives a cursor. `--follow` keeps printing as events commit
(`--for S` stops after S seconds), `--head` prints the current highest
sequence number, and `--json` is one object per line.

## `cg serve`

One long-lived connection for an editor or supervisor UI: newline-delimited
JSON-RPC 2.0 over stdio.

| Method | Does |
|---|---|
| `initialize` | protocol (`codify-serve/1`), version, root, branch, event head, capabilities |
| `tools/list`, `tools/call` | every MCP tool, from the same table `cg mcp` serves |
| `exec {args:[...]}` | any `cg` command, exactly as the CLI runs it: `{exit, stdout, stderr, cancelled, truncated}` |
| `cancel {id}` | stop an in-flight `tools/call` or `exec` |
| `subscribe {since?, kinds?}` | push `events` notifications from that sequence number; `kinds` is the same comma-list string `cg events --kind` takes |
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

## `cg tool`

`cg tool list` prints the MCP tool table; `cg tool call <name> [json]` runs
one tool without an MCP client and prints its result:

```
$ cg tool call get_symbol '{"name":"alpha"}'
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
$ cg fleet steer w-alpha-3.2 "try the smaller fix"
queued for w-alpha-3.2 (#139): delivered at its next edit (Claude Code, through the post-edit hook) or its next prompt
```

A steering message is an `agent.steer` event. A Claude Code session gets it
at its next edit: the post-edit hook (`cg hook post-edit`) returns it as
`additionalContext`. Any agent gets it in its next prompt. A per-agent
cursor records what was delivered, so nothing arrives twice, and delivery
is recorded as `agent.steer.delivered`. The supervisor steers with the same
call: stall nudges, escalations, and interface-drift notices all go out
this way.

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
