/*
 * cg help — the command table and the four views drawn from it.
 *
 * HELP is the single source for what cg can do: the grouped overview
 * (`cg`, `cg help`, -h, --help), one command's detail (`cg help <name>`,
 * `cg <name> --help`), every detail at once (--all), the JSON an editor or
 * agent builds menus from (--json), and the `usage:` line main prints on a
 * bad argument (help_usage). Adding a command means adding a row here;
 * tests/integration/43_help.sh fails when main or a subcommand dispatcher
 * answers a name this table does not carry.
 *
 * Contract for the usage field: where another file still prints its own
 * `usage: cg ...` line on a bad argument (spec.c, fleet.c, config.c, ...),
 * the row's usage is that line byte for byte, so the two never disagree;
 * 43_help.sh compares them.
 */
#include "cg.h"
#include <unistd.h>
#include <sys/ioctl.h>

typedef struct {
    const char *group;    /* key into GROUPS */
    const char *name;     /* "search", or "spec next" for a subcommand */
    const char *args;     /* principal arguments, for the overview column */
    const char *usage;    /* the full usage line, after "cg " */
    const char *summary;  /* one line */
    const char *detail;   /* paragraphs separated by \n */
    const char *flags;    /* "FLAG\tdescription\n" per flag */
    const char *examples; /* one command per line */
    const char *related;  /* comma-separated names */
    const char *aliases;  /* comma-separated names that resolve here */
    bool hide;            /* left out of the overview; `cg help <parent>`
                             lists it with the other subcommands */
} HelpCmd;

typedef struct { const char *key, *title, *blurb; } HelpGroup;

static const HelpGroup GROUPS[] = {
    {"graph", "graph", "the code graph: index, search, and read"},
    {"vc", "version control", "snapshots, history, and the event log"},
    {"memory", "memory", "durable agent notes, stored beside the graph"},
    {"agentic", "agentic", "agents, editors, governance, and generated docs"},
    {"spec", "spec workflow", "kvx specs: any repo with spec/workflow.kvx"},
    {"fleet", "fleet", "a hierarchy of agents on branches and worktrees"},
    {"jev", "jev", "TypeSafe System One decisions via OpenRouter"},
    {"skills", "skills", "memories promoted into .agents/skills"},
    {"config", "configuration", "settings, the machine, and this help"},
};
#define NGROUPS (int)(sizeof GROUPS / sizeof GROUPS[0])

static const HelpCmd HELP[] = {
/* ---------------- graph ---------------- */
{ .group = "graph", .name = "init", .args = "[--nested]",
  .usage = "init [--nested] [--force]",
  .summary = "create .codegraph/ here and build the index",
  .detail = "Creates .codegraph/ in the current directory and builds the "
    "initial index. In a linked git worktree of an initialized repository "
    "it joins the repository's shared graph under this branch instead and "
    "creates nothing here.\nIt refuses inside an enclosing Codify project, "
    "which would otherwise capture this directory, and in your home "
    "directory, where every project underneath would bind to it.",
  .flags = "--nested\tmake this directory its own project even inside "
    "another one, or in a linked worktree\n"
    "--force\tinitialize in your home directory anyway\n",
  .examples = "cg init\ncg init --nested",
  .related = "index,sync,root,branches" },
{ .group = "graph", .name = "index", .args = "[--full]",
  .usage = "index [--full] [--workers N]",
  .summary = "(re)index the project now; waits for the gate",
  .detail = "The blocking form of sync: it always walks the tree, waiting "
    "for a pass already running instead of coalescing into it. Exits 75 "
    "when the database stays busy past the lock wait.",
  .flags = "--full\treparse every file, not only the changed ones\n"
    "--workers N\tparse workers for this pass; beats CG_INDEX_WORKERS and "
    "[index] workers in codify.kvx (1 to 64, 0 = auto)\n",
  .examples = "cg index\ncg index --full --workers 8",
  .related = "sync,watch,info,config" },
{ .group = "graph", .name = "sync", .args = "[paths] [--wait MS]",
  .usage = "sync [paths] [--max-age MS] [--background] [--wait MS] [--auto] "
    "[--workers N]",
  .summary = "incremental index; coalesces, skips when fresh",
  .detail = "What hooks, watchers, and editors call after every edit. It "
    "coalesces into a pass already running (a short wait, then a dirty "
    "note instead of a second walk), skips when the graph is fresh, and "
    "walks only the paths named. --json reports what the pass did.",
  .flags = "paths\tsync only these files or directories\n"
    "--max-age MS\tskip when the last pass is younger than MS\n"
    "--background\tdo not wait for the gate (lock wait 0)\n"
    "--wait MS\thow long to wait for a running pass (default 2000)\n"
    "--auto\tan implicit sync from a hook or editor: skipped when "
    "[sync] auto = false\n"
    "--workers N\tparse workers for this pass; beats CG_INDEX_WORKERS and "
    "[index] workers (1 to 64, 0 = auto)\n",
  .examples = "cg sync\ncg sync src/main.c --json\ncg sync --auto --background",
  .related = "index,watch,hook" },
{ .group = "graph", .name = "search", .args = "<query> [-n N]",
  .usage = "search <query> [-n N]",
  .summary = "find code by name, doc comment, or body",
  .detail = "Symbol and full-text search (FTS5 trigram + full text). A "
    "phrase matches names (export memory finds memory_export and "
    "exportMemory), doc comments, and bodies, ranked in that order with "
    "source before tests; file hits show the matching line. Definitions "
    "answer, never their prototypes.",
  .flags = "-n N\tmaximum results (default 20)\n",
  .examples = "cg search \"export memory\"\ncg search index_pass -n 5 --json",
  .related = "symbol,context,show" },
{ .group = "graph", .name = "symbol", .args = "<name>",
  .usage = "symbol <name>",
  .summary = "definition(s), snippet, reference count",
  .related = "search,show,impact,why" },
{ .group = "graph", .name = "impact", .args = "<name> [-d N]",
  .usage = "impact <name> [-d N] [--budget N]",
  .summary = "callers and callees to depth N (default 3)",
  .detail = "Transitive callers and callees of a symbol, fitted to a token "
    "budget.",
  .flags = "-d N\tdepth (default 3)\n"
    "--budget N\ttoken budget (default 8000)\n",
  .related = "symbol,changes,test-impact" },
{ .group = "graph", .name = "context", .args = "<query>",
  .usage = "context <query> [--budget N] [-n K]",
  .summary = "one call: symbols, snippets, edges, routes",
  .detail = "The context bundle for an agent: memories, symbols, snippets, "
    "edges, entry points, and routes, filled to a token budget with "
    "explicit omitted counts (and tokens_used in --json). A file path gets "
    "the file's outline (purpose, symbols, imports, dependents); a "
    "directory gets its files.",
  .flags = "--budget N\ttoken budget (default 4000)\n"
    "-n K\ttop K symbols (default 8)\n",
  .examples = "cg context \"journal replay\"\ncg context src/help.c",
  .related = "survey,search,show" },
{ .group = "graph", .name = "survey", .args = "[scope]",
  .usage = "survey [path|query] [--budget N]",
  .summary = "purpose lines and docs across many files",
  .detail = "The tier below bodies: file purpose lines and symbol docs with "
    "signatures across about 100 files per call, never a body. The scope is "
    "a path prefix or a query. Uncovered files and symbols are named, and "
    "anything cut by the budget is an explicit omitted count.",
  .flags = "--budget N\ttoken budget (default 16000)\n",
  .examples = "cg survey src/\ncg survey \"spec workflow\"",
  .related = "context,anchors" },
{ .group = "graph", .name = "show", .args = "<symbol|path:line>",
  .usage = "show <symbol|path:line> [--full]",
  .summary = "print just that symbol's body",
  .detail = "By name, or by the cursor position an editor holds. Long "
    "bodies truncate with a (+N more lines, use --full) marker.",
  .flags = "--full\tthe whole body, however long\n",
  .related = "symbol,context" },
{ .group = "graph", .name = "routes", .args = "[filter]",
  .usage = "routes [filter]",
  .summary = "framework-aware URL routes -> handlers",
  .related = "context" },
{ .group = "graph", .name = "anchors", .args = "[--stale] [--uncovered]",
  .usage = "anchors [--stale] [--uncovered]",
  .summary = "anchor health: stale docs, uncovered symbols",
  .detail = "Docs whose code moved on, and uncovered symbols ranked by "
    "coordination score (fan-out x extent x referencing files): the "
    "backfill work list.",
  .flags = "--stale\tonly the docs whose code changed since\n"
    "--uncovered\tonly the undocumented symbols\n",
  .related = "survey,review" },
{ .group = "graph", .name = "test-impact", .args = "[symbol]",
  .usage = "test-impact [symbol]",
  .summary = "tests referencing a symbol, or your changes",
  .detail = "With no symbol, every symbol in your uncommitted changes.",
  .related = "changes,impact" },
{ .group = "graph", .name = "why", .args = "<symbol>",
  .usage = "why <symbol>",
  .summary = "provenance: commits, tasks, and decisions",
  .detail = "The commits that changed a symbol, the tasks they implemented, "
    "and the decisions recorded against it.",
  .related = "git-sync,recall,spec trace" },
{ .group = "graph", .name = "watch", .args = "[--debounce MS]",
  .usage = "watch [--debounce MS] [--fleet]",
  .summary = "auto-sync on file changes (native OS events)",
  .flags = "--debounce MS\tquiet time before a sync (default 300)\n"
    "--fleet\tone watcher for every worktree the graph knows, each synced "
    "under its own branch\n",
  .related = "sync,hook" },
{ .group = "graph", .name = "root", .args = "",
  .usage = "root",
  .summary = "print the tree cg operates on",
  .detail = "--json adds the shared project, the worktree flag, and the "
    "branch.",
  .related = "info,branches" },
{ .group = "graph", .name = "branches", .args = "",
  .usage = "branches",
  .summary = "every branch indexed into the shared graph",
  .detail = "Each branch with its worktree, head, base, and file count. "
    "Query commands answer for the branch you are on; --branch <name> asks "
    "another and --all-branches asks them all.",
  .related = "root,init" },

/* ---------------- version control ---------------- */
{ .group = "vc", .name = "commit", .args = "-m <msg>",
  .usage = "commit -m <message> [--task <id>] [--amend] [--git]",
  .summary = "snapshot the working tree, tagged with the task",
  .detail = "Content-addressed snapshot (SHA-256, deduplicated blobs) of the "
    "working tree, auto-tagged [spec:<feature>/<id>] with the in-progress "
    "task. The graph is synced first.",
  .flags = "-m <message>\tthe commit message (required)\n"
    "--task <id>\ttag with this in-progress task\n"
    "--amend\treplace the last snapshot\n"
    "--git\talso make a real git commit with the same tag\n",
  .examples = "cg commit -m \"help: one table\"\ncg commit -m fix --git",
  .related = "log,status,diff,spec done" },
{ .group = "vc", .name = "log", .args = "[-n N]",
  .usage = "log [-n N]",
  .summary = "snapshot history",
  .flags = "-n N\thow many (default 20)\n",
  .related = "commit,diff,checkout" },
{ .group = "vc", .name = "status", .args = "",
  .usage = "status",
  .summary = "working tree vs HEAD",
  .related = "diff,changes,state" },
{ .group = "vc", .name = "diff", .args = "[A] [B]",
  .usage = "diff [A] [B]",
  .summary = "HEAD vs worktree | A vs worktree | A vs B",
  .detail = "LCS line diff between snapshots or the worktree.",
  .related = "status,log" },
{ .group = "vc", .name = "checkout", .args = "<id> [--force]",
  .usage = "checkout <id> [--force]",
  .summary = "restore a snapshot",
  .flags = "--force\toverwrite uncommitted changes\n",
  .related = "log,diff" },
{ .group = "vc", .name = "changes", .args = "[--limit N]",
  .usage = "changes [--limit N]",
  .summary = "impact radius of uncommitted edits",
  .detail = "The symbols you touched plus their external callers, capped by "
    "default (40 symbols, 8 callers each) with (+N more) markers.",
  .flags = "--limit N\toverride the cap\n",
  .related = "status,review,test-impact" },
{ .group = "vc", .name = "git-sync", .args = "[-n N]",
  .usage = "git-sync [-n N]",
  .summary = "ingest git history for provenance and ranking",
  .detail = "Commits, authors, and per-file churn, which then rank search "
    "and context and answer cg why.",
  .flags = "-n N\thow many commits (default 2000)\n",
  .related = "why,changelog" },
{ .group = "vc", .name = "state", .args = "",
  .usage = "state",
  .summary = "Git, snapshot, spec, live ownership, staleness",
  .detail = "The four authorities side by side, each labelled, none taken "
    "as proof of another: Git state, Codify snapshot state, declared spec "
    "state, and live fenced attempts.",
  .related = "status,spec reconcile,brief" },
{ .group = "vc", .name = "events", .args = "[--since N] [--follow]",
  .usage = "events [--since N] [--kind K[,K...]] [-n N] "
    "[--follow [--for SECONDS]] [--head] [--json]",
  .summary = "the event log, by sequence number",
  .detail = "Every task, claim, attempt, agent, fleet, supervisor, drift, "
    "and approval change by sequence number. --json is one object per "
    "line.",
  .flags = "--since N\tevents after sequence N\n"
    "--kind K,..\tthese kinds; a trailing . is a prefix (fleet.)\n"
    "-n N\thow many (default 50)\n"
    "--follow, -f\tkeep streaming new events\n"
    "--for SECONDS\tstop following after this long\n"
    "--head\tprint the newest sequence number\n",
  .examples = "cg events --kind fleet. -n 20\ncg events --follow --json",
  .related = "event,serve" },
{ .group = "vc", .name = "event", .args = "ingest|history|progress",
  .usage = "event [ingest [--source HOST] | history [-n N] | progress]",
  .summary = "normalized lifecycle evidence from agent hosts",
  .detail = "Native host hooks feed JSON to cg event ingest. Each event gets "
    "a stable identity, the exact workspace revision, and an evidence "
    "delta; cg event progress classifies repeated failure, oscillation, "
    "and no-evidence windows.",
  .related = "events,work" },
{ .group = "vc", .name = "event ingest", .args = "[--source HOST]",
  .usage = "event ingest [--source HOST]",
  .summary = "normalize one host lifecycle JSON from stdin",
  .flags = "--source HOST\tthe agent host that sent it (default generic)\n",
  .hide = true },
{ .group = "vc", .name = "event history", .args = "[-n N]",
  .usage = "event history [-n N]",
  .summary = "recent ingested events",
  .flags = "-n N\thow many (default 20)\n",
  .hide = true },
{ .group = "vc", .name = "event progress", .args = "",
  .usage = "event progress",
  .summary = "evidence versus activity: loops and stalls",
  .detail = "Classifies repeated failure, repeated observation, A-B patch "
    "oscillation, and no-evidence windows. Recovery is advisory unless "
    "CG_PROGRESS_ENFORCE=1.",
  .hide = true },

/* ---------------- memory ---------------- */
{ .group = "memory", .name = "remember", .args = "<text>",
  .usage = "remember \"<text>\" [--type T] [--task <feature/id>] "
    "[--symbols a,b] [--files x,y] [--supersedes <id>]",
  .summary = "save a memory (decision, constraint, fact, ...)",
  .detail = "Memories written while a spec task is in progress link "
    "themselves to it. Never store secrets in them.",
  .flags = "--type T\tdecision|constraint|outcome|preference|fact "
    "(default fact)\n"
    "--task <feature/id>\tdefaults to the in-progress spec task\n"
    "--symbols a,b\tanchor to these symbols\n"
    "--files x,y\tanchor to these files\n"
    "--supersedes <id>\tretire a reversed decision (kept as history)\n",
  .examples = "cg remember \"help text lives in help.c\" --type decision",
  .related = "recall,forget,memory" },
{ .group = "memory", .name = "recall", .args = "[query] [-n N]",
  .usage = "recall [query] [-n N] [--task T] [--type T] [--near <file>]",
  .summary = "search memories (full text + recency)",
  .flags = "-n N\thow many (default 10)\n"
    "--task T\tonly this task's memories\n"
    "--type T\tonly this type\n"
    "--near <file>\tanchored retrieval: memories about this file\n",
  .related = "remember,brief" },
{ .group = "memory", .name = "forget", .args = "<id>",
  .usage = "forget <id>",
  .summary = "delete a memory",
  .related = "remember,memory compact" },
{ .group = "memory", .name = "memory", .args = "<subcommand>",
  .usage = "memory compact [--dry-run] | classify [<id>|--all|--unclassified]"
    " [-n N] | export [-o FILE] | import <FILE|-> | --from DIR",
  .summary = "compact, classify, export, import",
  .related = "remember,recall,skills", .hide = true },
{ .group = "memory", .name = "memory compact", .args = "[--dry-run]",
  .usage = "memory compact [--dry-run]",
  .summary = "drop duplicate memories",
  .flags = "--dry-run\tpreview, change nothing\n" },
{ .group = "memory", .name = "memory classify", .args = "[<id>|--all]",
  .usage = "memory classify [<id>|--all|--unclassified] [-n N]",
  .summary = "ask Jev what each memory is",
  .detail = "Classes are skill, decision, constraint, fact, and noise, "
    "stored with a confidence. No argument does the unclassified ones.",
  .flags = "--all\treclassify every memory\n"
    "--unclassified\tonly those without a class (the default)\n"
    "-n N\tcap the batch\n",
  .related = "skills,jev" },
{ .group = "memory", .name = "memory export", .args = "[-o FILE]",
  .usage = "memory export [-o FILE] [--task T] [--type T] [--branch B] "
    "[--since DAYS]",
  .summary = "memories as JSONL, one per line",
  .detail = "A header line, then one object per memory keyed by its content "
    "id, to stdout or FILE.",
  .flags = "-o FILE\twrite here instead of stdout\n"
    "--task T\ta task tag or prefix\n"
    "--type T\tonly this type\n"
    "--branch B\tonly memories carrying this branch\n"
    "--since DAYS\tonly the last DAYS days\n",
  .related = "memory import" },
{ .group = "memory", .name = "memory import", .args = "<FILE|-> | --from DIR",
  .usage = "memory import <FILE|-> | --from DIR [--dry-run] [--keep-branch] "
    "[--retask OLD=NEW]",
  .summary = "add the memories this graph lacks, by content id",
  .detail = "One transaction; creation time, class, and supersession "
    "travel. --from reads another project's graph read-only.",
  .flags = "--from DIR\tread another Codify project's graph\n"
    "--dry-run\treport, write nothing\n"
    "--keep-branch\tkeep branch names this graph does not track\n"
    "--retask OLD=NEW\trewrite a task-tag prefix\n",
  .related = "memory export" },

/* ---------------- agentic ---------------- */
{ .group = "agentic", .name = "brief", .args = "",
  .usage = "brief",
  .summary = "session state: task, changes, decisions",
  .detail = "Root, active task with its criteria, uncommitted paths, recent "
    "decisions, and whether CODEMAP.md is current.",
  .related = "resume,recall,spec next" },
{ .group = "agentic", .name = "review", .args = "",
  .usage = "review",
  .summary = "changed symbols vs acceptance criteria + risk",
  .related = "guard,changes,check" },
{ .group = "agentic", .name = "guard", .args = "[paths] [--strict]",
  .usage = "guard [paths] [--strict]",
  .summary = "edits outside the active task's declared scope",
  .detail = "Grounding, contract, and hygiene findings against the "
    "in-progress task's touches. Warns; only --strict fails.",
  .flags = "--strict\texit non-zero on findings\n",
  .related = "review,drift" },
{ .group = "agentic", .name = "check", .args = "[--strict]",
  .usage = "check [--strict]",
  .summary = "one CI gate: render, lint, evidence, tree",
  .flags = "--strict\twarnings fail too\n",
  .related = "spec lint,codemap" },
{ .group = "agentic", .name = "drift", .args = "check|collisions|coverage",
  .usage = "drift check <id> [--base REF] | collisions [-f F] "
    "| coverage [-f F] | summary [-f F]",
  .summary = "a task's change against its declaration",
  .related = "guard,spec trace" },
{ .group = "agentic", .name = "drift check", .args = "<id> [--base REF]",
  .usage = "drift check <id> [--base REF]",
  .summary = "a task's change against its touches and symbols",
  .flags = "--base REF\tcompare from here (default CG_BASE, then the "
    "merge base)\n",
  .hide = true },
{ .group = "agentic", .name = "drift collisions", .args = "[-f F]",
  .usage = "drift collisions [-f F]",
  .summary = "open tasks that would collide if run at once", .hide = true },
{ .group = "agentic", .name = "drift coverage", .args = "[-f F]",
  .usage = "drift coverage [-f F]",
  .summary = "acceptance criteria with no qualified task", .hide = true },
{ .group = "agentic", .name = "drift summary", .args = "[-f F]",
  .usage = "drift summary [-f F]",
  .summary = "drift counts for a feature", .hide = true },
{ .group = "agentic", .name = "work", .args = "open|update|close",
  .usage = "work [open [--task ID] | update REVISION | "
    "close [--task ID] [--evidence CLAUSE=PROOF]]",
  .summary = "task packet, revision deltas, closing evidence",
  .related = "resume,state" },
{ .group = "agentic", .name = "work open", .args = "[--task ID]",
  .usage = "work open [--task ID]",
  .summary = "objective, criteria, scope, state, context in one packet",
  .detail = "Its opaque revision feeds cg work update.", .hide = true },
{ .group = "agentic", .name = "work update", .args = "REVISION",
  .usage = "work update REVISION",
  .summary = "only what changed since REVISION", .hide = true },
{ .group = "agentic", .name = "work close", .args = "[--task ID]",
  .usage = "work close [--task ID] [--evidence CLAUSE=PROOF]",
  .summary = "pair every criterion with evidence or unverified",
  .flags = "--evidence CLAUSE=PROOF\tevidence for one criterion "
    "(repeatable)\n", .hide = true },
{ .group = "agentic", .name = "handoff", .args = "[--task <id>]",
  .usage = "handoff [--task <id>] [--done \"a;b\"] [--next \"a;b\"] "
    "[--blocked \"x\"] [-m <note>]",
  .summary = "record session state against a task",
  .detail = "Stored as a structured memory; each handoff supersedes the "
    "previous one for the task.",
  .flags = "--task <id>\tdefaults to your current task\n"
    "--done \"a;b\"\twhat got done\n"
    "--next \"a;b\"\twhat comes next\n"
    "--blocked \"x\"\twhat blocks it\n"
    "-m <note>\ta free note\n",
  .related = "resume" },
{ .group = "agentic", .name = "resume", .args = "[--task <id>] [--prompt]",
  .usage = "resume [--task <id>] [--prompt] [--budget N]",
  .summary = "task packet + latest handoff + memories",
  .detail = "Everything a fresh session needs to pick a task up: the "
    "packet, the latest handoff, task-scoped memories, tree state, and "
    "lease state.",
  .flags = "--prompt\ta paste-ready briefing built from the graph\n"
    "--budget N\ttoken budget for --prompt (default 6000)\n",
  .related = "handoff,brief" },
{ .group = "agentic", .name = "hook", .args = "install|post-edit",
  .usage = "hook install | post-edit",
  .summary = "agent and git hooks that keep the graph fresh",
  .related = "integrate,sync" },
{ .group = "agentic", .name = "hook install", .args = "",
  .usage = "hook install",
  .summary = "wire agent + git hooks so the graph self-syncs",
  .hide = true },
{ .group = "agentic", .name = "hook post-edit", .args = "",
  .usage = "hook post-edit",
  .summary = "the wired edit hook: sync + guard (stdin payload)",
  .detail = "Reads the host's payload on stdin and does one targeted "
    "background sync plus a guard of the edited path, in one process. "
    "Outside a Codify project it does nothing and succeeds.",
  .hide = true },
{ .group = "agentic", .name = "journal", .args = "list|apply|drop",
  .usage = "journal [list | apply | drop <id> | --failed | --all] [--json]",
  .summary = "pending writes queued while the database was busy",
  .detail = "Pending writes queued while the database was busy: list, "
    "apply, drop. Lifecycle writes that find the database busy are "
    "appended under .codegraph/journal/ and replayed, in order, by the "
    "next process that holds the write lock.",
  .related = "state,check" },
{ .group = "agentic", .name = "journal list", .args = "",
  .usage = "journal list",
  .summary = "pending and failed records", .hide = true },
{ .group = "agentic", .name = "journal apply", .args = "",
  .usage = "journal apply",
  .summary = "replay the journal now", .hide = true },
{ .group = "agentic", .name = "journal drop", .args = "<id>|--failed|--all",
  .usage = "journal drop <id> | --failed | --all",
  .summary = "remove queued records", .hide = true },
{ .group = "agentic", .name = "mcp", .args = "",
  .usage = "mcp",
  .summary = "run as an MCP server (stdio) for coding agents",
  .related = "tool,integrate" },
{ .group = "agentic", .name = "lsp", .args = "",
  .usage = "lsp",
  .summary = "run as a Language Server (stdio) for editors",
  .related = "serve" },
{ .group = "agentic", .name = "serve", .args = "",
  .usage = "serve",
  .summary = "one JSON-RPC connection (stdio) for editors",
  .detail = "Every MCP tool, any cg command (exec), cancel, and pushed "
    "event subscriptions from a sequence number. Idle, it holds no lock.",
  .related = "lsp,events" },
{ .group = "agentic", .name = "tool", .args = "list | call <name> [json]",
  .usage = "tool list [--json] | call <name> [json-args|-]",
  .summary = "run one MCP tool without an MCP client",
  .related = "mcp" },
{ .group = "agentic", .name = "tool list", .args = "",
  .usage = "tool list [--json]",
  .summary = "every MCP tool with its title", .hide = true },
{ .group = "agentic", .name = "tool call", .args = "<name> [json-args|-]",
  .usage = "tool call <name> [json-args|-]",
  .summary = "call one tool; - reads the arguments from stdin",
  .hide = true },
{ .group = "agentic", .name = "integrate", .args = "[detect|plan|apply|doctor]",
  .usage = "integrate [detect|plan|apply|doctor]",
  .summary = "configure and diagnose every agent host",
  .detail = "Codex, Claude Code, Copilot/VS Code, Cursor, Gemini CLI, "
    "OpenCode, Zed, Windsurf, Cline, and Continue. Planning is read-only; "
    "apply is idempotent and backed up.",
  .related = "mcp-install,hook install" },
{ .group = "agentic", .name = "integrate detect", .args = "",
  .usage = "integrate detect",
  .summary = "which agent hosts are present (the default)", .hide = true },
{ .group = "agentic", .name = "integrate plan", .args = "",
  .usage = "integrate plan",
  .summary = "what apply would change, read-only", .hide = true },
{ .group = "agentic", .name = "integrate apply", .args = "",
  .usage = "integrate apply",
  .summary = "write the host configs, with .codify.bak copies",
  .hide = true },
{ .group = "agentic", .name = "integrate doctor", .args = "",
  .usage = "integrate doctor",
  .summary = "diagnose each configured host", .hide = true },
{ .group = "agentic", .name = "mcp-install", .args = "",
  .usage = "mcp-install",
  .summary = "connect Claude Code, Cursor, VS Code, and more",
  .detail = "Compatibility alias for cg integrate apply: Claude Code, "
    "Cursor, VS Code, Windsurf, Gemini CLI, Codex CLI.",
  .related = "integrate" },
{ .group = "agentic", .name = "agentmd", .args = "[--write]",
  .usage = "agentmd [--write]",
  .summary = "generate .codify/agent-context.md",
  .detail = "Graph orientation for agents. Root AGENTS.md and CLAUDE.md "
    "stay owned by cg spec render.",
  .flags = "--write\twrite the file instead of printing it\n",
  .related = "codemap,spec render" },
{ .group = "agentic", .name = "codemap", .args = "[-o FILE|-] [--check]",
  .usage = "codemap [-o FILE|-] [--budget N] [--force] [--check] [--json]",
  .summary = "write CODEMAP.md, the repository map",
  .detail = "Overview, layout, entry points, modules, dependencies, tests, "
    "and workflow, from the graph and never a model. Byte-stable; never "
    "overwrites a file it did not generate.",
  .flags = "-o FILE|-\twrite here, - for stdout\n"
    "--budget N\ttoken budget (default 8000)\n"
    "--force\toverwrite a file Codify did not generate\n"
    "--check\texit 1 when CODEMAP.md is missing or stale; write nothing\n",
  .examples = "cg codemap\ncg codemap --check",
  .related = "agentmd,brief" },
{ .group = "agentic", .name = "changelog", .args = "[-n N] [-o F]",
  .usage = "changelog [-n N] [-o FILE] [--unreleased] [--tag V] "
    "[--snapshots] [--summarize|--no-summarize]",
  .summary = "release notes from git history",
  .detail = "A release per tag or version bump, groups per subject prefix, "
    "task references from [spec:...] tags. With CENTRA_API_KEY a model "
    "adds Highlights per release.",
  .flags = "-n N\thow many releases (default 50)\n"
    "-o FILE\twrite here, relative to the repository root\n"
    "--unreleased\tonly the newest section\n"
    "--tag V\tname the newest section V, dated today\n"
    "--snapshots\tthe snapshot-chain form, with symbol-level diffs\n"
    "--summarize\tinsist on Highlights\n"
    "--no-summarize\tkeep the model out\n",
  .examples = "cg changelog -o CHANGELOG.md\ncg changelog --unreleased",
  .related = "git-sync,recap" },
{ .group = "agentic", .name = "recap", .args = "[--sessions N]",
  .usage = "recap [--sessions N] [--since DAYS] [--budget CHARS] [-o FILE] "
    "[--agents claude,codex] [--decided] [--facts]",
  .summary = "resume brief from past Claude Code, Codex sessions",
  .detail = "Solar Decide picks the statements, the gateway model writes "
    ".codify/recap.md. Needs CENTRA_API_KEY.",
  .flags = "--sessions N\thow many sessions (default 6)\n"
    "--since DAYS\thow far back (default 21)\n"
    "--budget CHARS\tsize of the decided log (default 24000)\n"
    "-o FILE\twrite here, - for stdout\n"
    "--agents claude,codex\twhich hosts' sessions\n"
    "--decided\tstop at the picked statements (no prose)\n"
    "--facts\tthe repository facts alone (no model)\n",
  .related = "resume,changelog" },
{ .group = "agentic", .name = "docs", .args = "status|plan|packet|check",
  .usage = "docs [status|plan|packet|generate|check|trace|close] "
    "[-f feature]",
  .summary = "grounded documentation closure evidence",
  .related = "spec docs" },
{ .group = "agentic", .name = "docs status", .args = "",
  .usage = "docs status [-f feature]",
  .summary = "mode, effective state, targets, baseline", .hide = true },
{ .group = "agentic", .name = "docs plan", .args = "",
  .usage = "docs plan [-f feature]",
  .summary = "read-only plan, audiences, target scope", .hide = true },
{ .group = "agentic", .name = "docs packet", .args = "",
  .usage = "docs packet [-f feature]", .aliases = "docs generate",
  .summary = "write the evidence packet under .codegraph/docs/",
  .hide = true },
{ .group = "agentic", .name = "docs check", .args = "",
  .usage = "docs check [-f feature]",
  .summary = "validate scope, links, claims, and evidence", .hide = true },
{ .group = "agentic", .name = "docs trace", .args = "",
  .usage = "docs trace [-f feature]",
  .summary = "claims and snapshots back to their tasks", .hide = true },
{ .group = "agentic", .name = "docs close", .args = "",
  .usage = "docs close [-f feature]",
  .summary = "re-check, snapshot, close the @docs attempt", .hide = true },

/* ---------------- spec workflow ---------------- */
{ .group = "spec", .name = "spec", .args = "[<subcommand>]",
  .usage = "spec [render [--check] | status | next | "
    "new <feature> | add <id> --title T [--wave N] [--requires a,b]"
    " [--symbols a,b] [--touches a,b] [--verify CMD] [--do \"a;b\"]"
    " [--reqs a,b] | lint | mode <standard|prod|parallel> | start <id> | "
    "implemented <id> | done <id> [--force] | trace [<id>] | "
    "wave | ready | claim <id> [--agent N] [--ttl M] | "
    "release <id> [--agent N] [--force] | "
    "claim-next [--agent N] [--ttl M] | heartbeat <id> "
    "[--agent N] [--attempt ID] [--fence N] [--ttl M] | "
    "reconcile [--repair] | docs [status|auto|manual|off|start|"
    "block|reset|done]] [-f <feature>]",
  .summary = "the task board; cg help spec lists every subcommand",
  .detail = "Specs are kvx files under spec/, independent of .codegraph/. "
    "The loop: spec next, spec start <id>, implement, cg commit, spec done "
    "<id>. Every subcommand takes -f <feature> to name a feature other "
    "than the active one, and --root DIR for another tree.",
  .examples = "cg spec\ncg spec next\ncg spec done 4.1",
  .related = "brief,commit,fleet" },
{ .group = "spec", .name = "spec status", .args = "",
  .usage = "spec status",
  .summary = "task board: mode, counts, current and next task",
  .hide = true },
{ .group = "spec", .name = "spec next", .args = "",
  .usage = "spec next",
  .summary = "next eligible task with its acceptance criteria",
  .detail = "The lowest-wave pending task whose requires are satisfied, "
    "with its do-bullets and expanded criteria." },
{ .group = "spec", .name = "spec start", .args = "<id>",
  .usage = "spec start <id>",
  .summary = "mark a task in_progress (honors workflow limit)",
  .flags = "--force\tstart despite the limit or unmet requires\n" },
{ .group = "spec", .name = "spec done", .args = "<id>",
  .usage = "spec done <id>",
  .summary = "verify_cmd + graph checks, then mark done",
  .detail = "Runs the task's verify_cmd and checks its symbols and touches "
    "against the graph; marks it done only when qualification passes, and "
    "records an outcome memory.",
  .flags = "--force\tmark done without qualifying\n",
  .related = "spec implemented,spec trace" },
{ .group = "spec", .name = "spec implemented", .args = "<id>",
  .usage = "spec implemented <id>",
  .summary = "graph-check coding work without verify_cmd",
  .detail = "Prod mode only: marks coding complete as implemented, "
    "qualification pending. No --force." },
{ .group = "spec", .name = "spec ready", .args = "",
  .usage = "spec ready",
  .summary = "every eligible task across waves (parallel view)" },
{ .group = "spec", .name = "spec wave", .args = "",
  .usage = "spec wave",
  .summary = "every eligible task in the current wave", .hide = true },
{ .group = "spec", .name = "spec claim-next", .args = "[--agent N]",
  .usage = "spec claim-next [--agent N] [--ttl M]",
  .summary = "atomically claim the first conflict-free task",
  .detail = "Returns the full packet: task, lease, task-scoped memories. "
    "Exits 3 when the frontier is empty.",
  .flags = "--agent N\tthe owning agent\n--ttl M\tlease minutes "
    "(default 30)\n" },
{ .group = "spec", .name = "spec claim", .args = "<id>",
  .usage = "spec claim <id> [--agent NAME] [--ttl MIN]",
  .summary = "lease a task to an agent with an expiry",
  .flags = "--agent NAME\tthe owning agent\n--ttl MIN\tlease minutes "
    "(default 30)\n", .hide = true },
{ .group = "spec", .name = "spec release", .args = "<id>",
  .usage = "spec release <id> [--agent NAME] [--ttl MIN]",
  .summary = "release a lease (another agent's needs --force)",
  .flags = "--agent NAME\tthe agent that holds it\n--force\trelease "
    "another agent's lease\n", .hide = true },
{ .group = "spec", .name = "spec heartbeat", .args = "<id>",
  .usage = "spec heartbeat <id> [--agent NAME] [--attempt ID] [--fence N] "
    "[--ttl MIN]",
  .summary = "renew a live attempt", .hide = true },
{ .group = "spec", .name = "spec reconcile", .args = "[--repair]",
  .usage = "spec reconcile [--repair]",
  .summary = "report stale in-progress declarations",
  .flags = "--repair\tfix them instead of only reporting\n", .hide = true },
{ .group = "spec", .name = "spec trace", .args = "[<id>]",
  .usage = "spec trace [<id>] [--no-sync]",
  .summary = "tasks to code: symbols, paths, tagged commits",
  .flags = "--no-sync\tskip the graph refresh first\n" },
{ .group = "spec", .name = "spec run", .args = "[-n N] [--driver D]",
  .usage = "spec run [-n N] [--driver codex|claude|custom] [--dry-run] "
    "[--max-fail K] [--agent-prefix P] [--fleet [-f <feature>] "
    "[--max-rounds R] [--status] [--resume [RUN]]]",
  .summary = "orchestrate: one agent per eligible task",
  .detail = "Claims eligible tasks and drives one agent process per slot.",
  .flags = "-n N\tslots\n--driver D\tcodex, claude, or custom\n"
    "--dry-run\tshow what would run\n--max-fail K\tstop after K "
    "failures\n--agent-prefix P\tagent name prefix\n--fleet\tthe "
    "hierarchical form (see cg fleet up)\n",
  .related = "fleet up,spec claim-next" },
{ .group = "spec", .name = "spec render", .args = "[--check]",
  .usage = "spec render [--check]",
  .summary = "regenerate IDE pointer files + markdown mirror",
  .flags = "--check\texit 2 if anything is stale\n" },
{ .group = "spec", .name = "spec new", .args = "<feature>",
  .usage = "spec new <feature>",
  .summary = "scaffold spec/<feature>/spec.kvx and activate it" },
{ .group = "spec", .name = "spec add", .args = "<id> --title T",
  .usage = "spec add <id> --title T",
  .summary = "insert a task, preserving every other byte",
  .flags = "--wave N\twave\n--requires a,b\tprerequisite tasks\n"
    "--symbols a,b\tdeclared symbols\n--touches a,b\tdeclared paths\n"
    "--verify CMD\tverify_cmd\n--do \"a;b\"\tdo-bullets\n--reqs a,b\t"
    "requirements it covers\n--section S\tsection heading\n" },
{ .group = "spec", .name = "spec lint", .args = "",
  .usage = "spec lint",
  .summary = "validate the plan (cycles, dead globs); exits 2" },
{ .group = "spec", .name = "spec mode", .args = "<prod|standard>",
  .usage = "spec mode <prod|standard>",
  .summary = "configure implementation dependency semantics",
  .hide = true },
{ .group = "spec", .name = "spec docs", .args = "<action>",
  .usage = "spec docs [status|auto|manual|off|start|block|reset|done]",
  .summary = "documentation closure: status, auto, manual, ...",
  .detail = "Inspect or configure the reserved @docs closure stage: "
    "status, auto, manual, off, start, block, reset, done.",
  .related = "docs" },

/* ---------------- fleet ---------------- */
{ .group = "fleet", .name = "fleet", .args = "<subcommand>",
  .usage = "fleet roles | status | plan [-f F] | "
    "tree [-f F] | begin <id> [-f F] [--agent A] | "
    "merge-up <id> [--force] [--keep] | land <feature> "
    "[--no-pr] | pr <feature> [--dry-run] | checkpoint [--dry-run]",
  .summary = "a hierarchy of agents: main, managers, workers",
  .detail = "Configured by [hierarchy] and [role.*] in spec/workflow.kvx.",
  .related = "spec run,events", .hide = true },
{ .group = "fleet", .name = "fleet up", .args = "[-f F] [-n N]",
  .usage = "fleet up [--foreground] [--resume [RUN]] [-f F | --all] [-n N] "
    "[--driver D] [--max-fail K] [--max-rounds R] [--dry-run]",
  .summary = "start a durable run under a detached supervisor",
  .detail = "Main, managers, and workers at once, supervised until every "
    "task is qualified and merged. --resume continues an unfinished run, "
    "adopting agents still alive." },
{ .group = "fleet", .name = "fleet down", .args = "[--drain] [RUN]",
  .usage = "fleet down [--drain] [--wait SECONDS] [RUN]",
  .summary = "stop a run: claims released, branches kept",
  .flags = "--drain\tlet live work finish first\n--wait SECONDS\thow long "
    "to wait (default 30)\n" },
{ .group = "fleet", .name = "fleet pause", .args = "[RUN]",
  .usage = "fleet pause [RUN]",
  .summary = "freeze spawning" },
{ .group = "fleet", .name = "fleet resume", .args = "[RUN]",
  .usage = "fleet resume [RUN]",
  .summary = "continue a paused run" },
{ .group = "fleet", .name = "fleet runs", .args = "",
  .usage = "fleet runs",
  .summary = "runs, their state, whether a supervisor lives" },
{ .group = "fleet", .name = "fleet status", .args = "",
  .usage = "fleet status",
  .summary = "who is alive in which role, on which task" },
{ .group = "fleet", .name = "fleet tree", .args = "[-f F]",
  .usage = "fleet tree [-f F]",
  .summary = "the live tree with progress and heartbeats" },
{ .group = "fleet", .name = "fleet plan", .args = "[-f F]",
  .usage = "fleet plan [-f F]",
  .summary = "which manager and worker own what, planned and live" },
{ .group = "fleet", .name = "fleet roles", .args = "",
  .usage = "fleet roles",
  .summary = "branch templates, base, remote, gates, PR policy" },
{ .group = "fleet", .name = "fleet begin", .args = "<id> [--agent A]",
  .usage = "fleet begin <task-id> [-f <feature>] [--agent A]",
  .summary = "the wave worktree and branch for a task, claimed" },
{ .group = "fleet", .name = "fleet merge-up", .args = "<id> [--keep]",
  .usage = "fleet merge-up <task-id> [-f <feature>] [--force] [--keep]",
  .summary = "merge a qualified wave branch into the feature",
  .flags = "--force\tmerge despite the task not being done\n--keep\tleave "
    "conflicts in the feature worktree to resolve\n" },
{ .group = "fleet", .name = "fleet land", .args = "<feature> [--no-pr]",
  .usage = "fleet land <feature> [--no-pr]",
  .summary = "merge the feature into main behind test and lint",
  .detail = "Red resets main to where it was; green opens the PR when the "
    "policy says auto." },
{ .group = "fleet", .name = "fleet pr", .args = "<feature> [--dry-run]",
  .usage = "fleet pr <feature> [--dry-run]",
  .summary = "open the pull request through gh" },
{ .group = "fleet", .name = "fleet checkpoint", .args = "[--dry-run]",
  .usage = "fleet checkpoint [--dry-run]",
  .summary = "merge the open Codify pull requests in order" },
{ .group = "fleet", .name = "fleet approvals", .args = "[--all]",
  .usage = "fleet approvals [--all]",
  .summary = "what waits at an opt-in gate ([role.*] approve)" },
{ .group = "fleet", .name = "fleet approve", .args = "<id> [--reject]",
  .usage = "fleet approve <id> [--reject] [-m note]",
  .summary = "the decision that releases a gate", .hide = true },
{ .group = "fleet", .name = "fleet steer", .args = "<agent> <message>",
  .usage = "fleet steer <agent> <message>",
  .summary = "a message for a running agent's next edit or prompt" },
{ .group = "fleet", .name = "fleet brief", .args = "[feature]",
  .usage = "fleet brief [feature]",
  .summary = "the feature manager's briefing" },

/* ---------------- jev ---------------- */
{ .group = "jev", .name = "jev", .args = "doctor|ask|log",
  .usage = "jev doctor [--probe] | ask ... | log [-n N]",
  .summary = "TypeSafe System One decisions via OpenRouter",
  .detail = "OPENROUTER_API_KEY is mandatory; CG_JEV_MODEL, CG_JEV_ENDPOINT, "
    "and CG_JEV_CURL override the model, endpoint, and curl.",
  .related = "memory classify,guard", .hide = true },
{ .group = "jev", .name = "jev doctor", .args = "[--probe]",
  .usage = "jev doctor [--probe]",
  .summary = "key, curl, endpoint, model, and log health",
  .flags = "--probe\tsend one tiny decision\n" },
{ .group = "jev", .name = "jev ask", .args = "[<request.json>|-]",
  .usage = "jev ask [<request.json>|-] [--state S | --state-file F] "
    "[--noul NAME INSTRUCTIONS [--option true=D --option false=D]] "
    "[--choice NAME INSTRUCTIONS --option KEY=DESC ...] "
    "[--score NAME INSTRUCTIONS --level TEXT ...] [--json]",
  .summary = "ask Jev directly; answers as text or --json" },
{ .group = "jev", .name = "jev log", .args = "[-n N]",
  .usage = "jev log [-n N]",
  .summary = "the last N calls from .codegraph/jev.log" },

/* ---------------- skills ---------------- */
{ .group = "skills", .name = "skills", .args = "list|promote|render",
  .usage = "skills list | promote <memory-id> | render",
  .summary = "memories classed skill, rendered as SKILL.md",
  .related = "memory classify", .hide = true },
{ .group = "skills", .name = "skills list", .args = "",
  .usage = "skills list",
  .summary = "skill memories, and which are rendered" },
{ .group = "skills", .name = "skills promote", .args = "<id>",
  .usage = "skills promote <memory-id>",
  .summary = "render one memory as .agents/skills/<slug>/SKILL.md" },
{ .group = "skills", .name = "skills render", .args = "",
  .usage = "skills render",
  .summary = "refresh every generated SKILL.md from its memory" },

/* ---------------- configuration ---------------- */
{ .group = "config", .name = "config", .args = "[init|get|set|check]",
  .usage = "config [init | get <section.key> | "
    "set <section.key> <value> | check] [--json]",
  .summary = "every codify.kvx setting with its origin",
  .detail = "Works before cg init and in a spec-only repository.",
  .related = "info", .aliases = "config list,config show" },
{ .group = "config", .name = "config init", .args = "",
  .usage = "config init",
  .summary = "write the commented defaults (never over a file)",
  .hide = true },
{ .group = "config", .name = "config get", .args = "<section.key>",
  .usage = "config get <section.key>",
  .summary = "read one key", .hide = true },
{ .group = "config", .name = "config set", .args = "<section.key> <value>",
  .usage = "config set <section.key> <value>",
  .summary = "surgically write one key", .hide = true },
{ .group = "config", .name = "config check", .args = "",
  .usage = "config check",
  .summary = "unknown keys and unusable values", .hide = true },
{ .group = "config", .name = "info", .args = "",
  .usage = "info",
  .summary = "machine profile and how the pipeline was sized",
  .related = "config,root" },
{ .group = "config", .name = "version", .args = "",
  .usage = "version", .aliases = "--version",
  .summary = "print the version" },
{ .group = "config", .name = "help", .args = "[<command>] [--all]",
  .usage = "help [<command>] [--all] [--json]",
  .summary = "this map, one command's detail, or all of them",
  .detail = "cg <command> --help and cg <command> -h show the same detail.",
  .flags = "--all\tevery command's detail, in group order\n"
    "--json\tevery command and subcommand, for menus\n",
  .aliases = "-h,--help" },
};
#define NHELP (int)(sizeof HELP / sizeof HELP[0])

static const char *const GLOBAL_FLAGS =
    "--json\tmachine-readable output (most query commands)\n"
    "--branch <name>\tanswer for another indexed branch\n"
    "--all-branches\tanswer for every branch, labelling each hit\n"
    "--no-soft\tleave out prose-derived soft edges\n";

/* ---------------- terminal ---------------- */

static int help_width(void) {
    int w = 0;
    const char *c = getenv("COLUMNS");
    if (c && *c) w = atoi(c);
    if (w <= 0) {
        struct winsize ws;
        if (ioctl(STDOUT_FILENO, TIOCGWINSZ, &ws) == 0 && ws.ws_col > 0)
            w = ws.ws_col;
    }
    if (w <= 0) w = 80;
    return w < 60 ? 60 : w;
}

/* bold/dim only when a person is reading: never into a pipe or a file, so
 * scripts and the tests see plain text; CG_COLOR settles it either way */
static bool help_styled(void) {
    const char *f = getenv("CG_COLOR");
    if (f && !strcmp(f, "0")) return false;
    if (f && !strcmp(f, "1")) return true;
    const char *nc = getenv("NO_COLOR");
    if (nc && *nc) return false;
    const char *t = getenv("TERM");
    if (t && !strcmp(t, "dumb")) return false;
    return isatty(STDOUT_FILENO);
}

typedef struct { StrBuf b; int width; bool style; int col; } Out;

/* columns on screen: UTF-8 continuation bytes take none */
static int dwidth(const char *s, size_t n) {
    int w = 0;
    for (size_t i = 0; i < n && s[i]; i++)
        if (((unsigned char)s[i] & 0xC0) != 0x80) w++;
    return w;
}

static void o_raw(Out *o, const char *s, size_t n) {
    for (size_t i = 0; i < n; i++) sb_putc(&o->b, s[i]);
    o->col += dwidth(s, n);
}
static void o_str(Out *o, const char *s) { o_raw(o, s, strlen(s)); }
static void o_nl(Out *o) { sb_putc(&o->b, '\n'); o->col = 0; }
static void o_pad(Out *o, int to) { while (o->col < to) o_raw(o, " ", 1); }
static void o_on(Out *o, const char *sgr) {
    if (o->style) sb_puts(&o->b, sgr);
}
#define BOLD "\033[1m"
#define DIM  "\033[2m"
#define OFF  "\033[0m"

/* Words of s from the current column, continuing at `indent` on each new
 * line, never past the width; \n starts a new paragraph line. A word wider
 * than the line is cut, so no line is ever wider than the terminal. */
static void o_wrap(Out *o, const char *s, int indent) {
    const char *p = s;
    bool first = true;
    while (*p) {
        if (*p == '\n') { o_nl(o); o_pad(o, indent); p++; first = true;
                          continue; }
        if (*p == ' ') { p++; continue; }
        size_t n = strcspn(p, " \n");
        int w = dwidth(p, n);
        int need = w + (first ? 0 : 1);
        if (o->col + need > o->width && o->col > indent) {
            o_nl(o); o_pad(o, indent); first = true; need = w;
        }
        if (!first) o_raw(o, " ", 1);
        while (o->col + dwidth(p, n) > o->width) {   /* an overlong word */
            size_t k = 0; int room = o->width - o->col;
            if (room < 1) { o_nl(o); o_pad(o, indent); continue; }
            while (k < n && dwidth(p, k + 1) <= room) k++;
            while (k < n && ((unsigned char)p[k] & 0xC0) == 0x80) k++;
            o_raw(o, p, k); p += k; n -= k;
            o_nl(o); o_pad(o, indent);
        }
        o_raw(o, p, n);
        p += n;
        first = false;
    }
}

static void o_init(Out *o) {
    sb_init(&o->b);
    o->width = help_width();
    o->style = help_styled();
    o->col = 0;
}
static void o_flush(Out *o, FILE *f) {
    fputs(o->b.p ? o->b.p : "", f);
    sb_free(&o->b);
}

/* ---------------- lookup ---------------- */

static bool in_list(const char *list, const char *name) {
    if (!list) return false;
    size_t n = strlen(name);
    for (const char *p = list; *p; ) {
        size_t k = strcspn(p, ",");
        if (k == n && !strncmp(p, name, n)) return true;
        p += k;
        if (*p == ',') p++;
    }
    return false;
}

static const HelpCmd *help_find(const char *name) {
    for (int i = 0; i < NHELP; i++)
        if (!strcmp(HELP[i].name, name)) return &HELP[i];
    for (int i = 0; i < NHELP; i++)
        if (in_list(HELP[i].aliases, name)) return &HELP[i];
    return NULL;
}

/* the subcommands of a top-level name: rows named "<parent> <word>" */
static bool is_child(const HelpCmd *c, const char *parent) {
    size_t n = strlen(parent);
    return !strncmp(c->name, parent, n) && c->name[n] == ' ';
}

static const HelpGroup *group_of(const HelpCmd *c) {
    for (int i = 0; i < NGROUPS; i++)
        if (!strcmp(GROUPS[i].key, c->group)) return &GROUPS[i];
    return &GROUPS[0];
}

/* ---------------- views ---------------- */

/* name + args on the left, the summary on the right; a left side wider
 * than the column puts the summary on the next line */
static void row(Out *o, const char *name, const char *args, const char *sum,
                int lcol) {
    o_pad(o, 2);
    o_on(o, BOLD); o_str(o, name); o_on(o, OFF);
    if (args && *args) {
        o_raw(o, " ", 1);
        o_on(o, DIM); o_wrap(o, args, 4); o_on(o, OFF);
    }
    if (o->col + 2 > lcol) { o_nl(o); }
    o_pad(o, lcol);
    o_wrap(o, sum, lcol);
    o_nl(o);
}

static int left_col(const Out *o) {
    int c = o->width * 36 / 100;
    return c > 30 ? 30 : c;
}

static void flags_block(Out *o, const char *flags, int lcol) {
    for (const char *p = flags; p && *p; ) {
        size_t n = strcspn(p, "\n");
        const char *tab = memchr(p, '\t', n);
        char flag[128], desc[512];
        size_t fl = tab ? (size_t)(tab - p) : n;
        snprintf(flag, sizeof flag, "%.*s", (int)fl, p);
        snprintf(desc, sizeof desc, "%.*s", tab ? (int)(n - fl - 1) : 0,
                 tab ? tab + 1 : "");
        o_pad(o, 2);
        o_on(o, BOLD); o_wrap(o, flag, 4); o_on(o, OFF);
        if (o->col + 2 > lcol) o_nl(o);
        o_pad(o, lcol);
        o_wrap(o, desc, lcol);
        o_nl(o);
        p += n;
        if (*p) p++;
    }
}

void help_overview(void) {
    Out o; o_init(&o);
    int lcol = left_col(&o);
    char head[256];
    snprintf(head, sizeof head, "Codify %s — code graph, version control, "
             "and the agent workflow, local-first", CG_VERSION);
    o_on(&o, BOLD); o_wrap(&o, head, 0); o_on(&o, OFF); o_nl(&o);
    o_nl(&o);
    o_wrap(&o, "usage: cg <command> [args]", 0); o_nl(&o);
    for (int g = 0; g < NGROUPS; g++) {
        o_nl(&o);
        o_on(&o, BOLD); o_str(&o, GROUPS[g].title); o_on(&o, OFF);
        o_raw(&o, "  ", 2);
        o_on(&o, DIM); o_wrap(&o, GROUPS[g].blurb, 2); o_on(&o, OFF);
        o_nl(&o);
        for (int i = 0; i < NHELP; i++)
            if (!HELP[i].hide && !strcmp(HELP[i].group, GROUPS[g].key))
                row(&o, HELP[i].name, HELP[i].args, HELP[i].summary, lcol);
    }
    o_nl(&o);
    o_on(&o, BOLD); o_str(&o, "global flags"); o_on(&o, OFF); o_nl(&o);
    flags_block(&o, GLOBAL_FLAGS, lcol);
    o_nl(&o);
    o_wrap(&o, "cg help <command> (or cg <command> --help) for its usage, "
           "flags, and examples; cg help --all for every command", 0);
    o_nl(&o);
    o_flush(&o, stdout);
}

static void section(Out *o, const char *title) {
    o_nl(o);
    o_on(o, BOLD); o_str(o, title); o_on(o, OFF); o_nl(o);
}

static void detail(Out *o, const HelpCmd *c) {
    int lcol = left_col(o);
    o_on(o, BOLD); o_str(o, "usage: cg "); o_wrap(o, c->usage, 4);
    o_on(o, OFF); o_nl(o);
    o_nl(o);
    o_pad(o, 2); o_wrap(o, c->summary, 2); o_nl(o);
    if (c->detail) { o_nl(o); o_pad(o, 2); o_wrap(o, c->detail, 2); o_nl(o); }
    bool any = false;
    for (int i = 0; i < NHELP; i++) {
        if (!is_child(&HELP[i], c->name)) continue;
        if (!any) section(o, "subcommands");
        any = true;
        row(o, HELP[i].name + strlen(c->name) + 1, HELP[i].args,
            HELP[i].summary, lcol);
    }
    if (c->flags) { section(o, "flags"); flags_block(o, c->flags, lcol); }
    if (c->examples) {
        section(o, "examples");
        for (const char *p = c->examples; *p; ) {
            size_t n = strcspn(p, "\n");
            char line[512];
            snprintf(line, sizeof line, "%.*s", (int)n, p);
            o_pad(o, 2); o_wrap(o, line, 4); o_nl(o);
            p += n;
            if (*p) p++;
        }
    }
    if (c->related) {
        section(o, "related");
        o_pad(o, 2);
        bool first = true;
        for (const char *p = c->related; *p; ) {
            size_t n = strcspn(p, ",");
            char word[128];
            snprintf(word, sizeof word, "%scg %.*s", first ? "" : ", ",
                     (int)n, p);
            /* keep "cg spec trace" on one line: wrap per name, not word */
            if (o->col + dwidth(word, strlen(word)) > o->width) {
                o_nl(o); o_pad(o, 2);
                if (!first) { memmove(word, word + 2, strlen(word) - 1); }
            }
            o_str(o, word);
            first = false;
            p += n;
            if (*p) p++;
        }
        o_nl(o);
    }
}

/* closest names: an edit distance within a third of the length, or one
 * name containing the other; at most five, nearest first */
static int edit_dist(const char *a, const char *b) {
    size_t la = strlen(a), lb = strlen(b);
    if (la > 64 || lb > 64) return 99;
    int d[65][65];
    for (size_t i = 0; i <= la; i++) d[i][0] = (int)i;
    for (size_t j = 0; j <= lb; j++) d[0][j] = (int)j;
    for (size_t i = 1; i <= la; i++)
        for (size_t j = 1; j <= lb; j++) {
            int c = d[i - 1][j - 1] + (a[i - 1] != b[j - 1]);
            if (d[i - 1][j] + 1 < c) c = d[i - 1][j] + 1;
            if (d[i][j - 1] + 1 < c) c = d[i][j - 1] + 1;
            d[i][j] = c;
        }
    return d[la][lb];
}

void help_suggest(const char *name) {
    int best[5], bd[5], nb = 0;
    int lim = (int)strlen(name) / 3;
    if (lim < 2) lim = 2;
    for (int i = 0; i < NHELP; i++) {
        const char *cand = HELP[i].name;
        const char *last = strrchr(cand, ' ');
        int dd = edit_dist(name, cand);
        if (last) { int dl = edit_dist(name, last + 1); if (dl < dd) dd = dl; }
        if (strlen(name) >= 3 && strstr(cand, name)) dd = dd < 1 ? dd : 1;
        if (dd > lim) continue;
        int k = nb < 5 ? nb++ : 4;
        if (k == 4 && nb == 5 && dd >= bd[4]) continue;
        best[k] = i; bd[k] = dd;
        for (; k > 0 && bd[k] < bd[k - 1]; k--) {
            int t = bd[k]; bd[k] = bd[k - 1]; bd[k - 1] = t;
            t = best[k]; best[k] = best[k - 1]; best[k - 1] = t;
        }
    }
    if (!nb) {
        fprintf(stderr, "  cg help lists every command\n");
        return;
    }
    fprintf(stderr, "  did you mean:");
    for (int i = 0; i < nb; i++)
        fprintf(stderr, "%s cg %s", i ? "," : "", HELP[best[i]].name);
    fprintf(stderr, "?\n");
}

/* "spec next foo" -> the longest leading run of words that names a row */
static const HelpCmd *find_words(int n, char **w) {
    for (int k = n; k > 0; k--) {
        StrBuf b; sb_init(&b);
        for (int i = 0; i < k; i++) {
            if (i) sb_putc(&b, ' ');
            sb_puts(&b, w[i]);
        }
        const HelpCmd *c = help_find(b.p);
        sb_free(&b);
        if (c) return c;
    }
    return NULL;
}

int help_command(const char *name) {
    const HelpCmd *c = help_find(name);
    if (!c) {
        fprintf(stderr, "cg help: no command named '%s'\n", name);
        help_suggest(name);
        return 1;
    }
    Out o; o_init(&o);
    detail(&o, c);
    o_flush(&o, stdout);
    return 0;
}

static void help_all(void) {
    Out o; o_init(&o);
    for (int g = 0; g < NGROUPS; g++) {
        for (int i = 0; i < NHELP; i++) {
            if (strcmp(HELP[i].group, GROUPS[g].key)) continue;
            if (o.b.len) { o_nl(&o); o_str(&o, "--"); o_nl(&o); o_nl(&o); }
            detail(&o, &HELP[i]);
        }
    }
    o_flush(&o, stdout);
}

static void json_list(StrBuf *b, const char *list, char sep) {
    sb_putc(b, '[');
    bool first = true;
    for (const char *p = list; p && *p; ) {
        char stop[2] = { sep, 0 };
        size_t n = strcspn(p, stop);
        char item[512];
        snprintf(item, sizeof item, "%.*s", (int)n, p);
        if (!first) sb_putc(b, ',');
        sb_json_str(b, item);
        first = false;
        p += n;
        if (*p) p++;
    }
    sb_putc(b, ']');
}

static void json_flags(StrBuf *b, const char *flags) {
    sb_putc(b, '[');
    bool first = true;
    for (const char *p = flags; p && *p; ) {
        size_t n = strcspn(p, "\n");
        const char *tab = memchr(p, '\t', n);
        size_t fl = tab ? (size_t)(tab - p) : n;
        char flag[128], desc[512];
        snprintf(flag, sizeof flag, "%.*s", (int)fl, p);
        snprintf(desc, sizeof desc, "%.*s", tab ? (int)(n - fl - 1) : 0,
                 tab ? tab + 1 : "");
        sb_puts(b, first ? "{\"flag\":" : ",{\"flag\":");
        sb_json_str(b, flag);
        sb_puts(b, ",\"description\":");
        sb_json_str(b, desc);
        sb_putc(b, '}');
        first = false;
        p += n;
        if (*p) p++;
    }
    sb_putc(b, ']');
}

static void help_json(void) {
    StrBuf b; sb_init(&b);
    sb_puts(&b, "{\"version\":");
    sb_json_str(&b, CG_VERSION);
    sb_puts(&b, ",\"groups\":[");
    for (int g = 0; g < NGROUPS; g++) {
        sb_puts(&b, g ? ",{\"key\":" : "{\"key\":");
        sb_json_str(&b, GROUPS[g].key);
        sb_puts(&b, ",\"title\":");
        sb_json_str(&b, GROUPS[g].title);
        sb_puts(&b, ",\"summary\":");
        sb_json_str(&b, GROUPS[g].blurb);
        sb_putc(&b, '}');
    }
    sb_puts(&b, "],\"commands\":[");
    for (int i = 0; i < NHELP; i++) {
        const HelpCmd *c = &HELP[i];
        const char *sp = strchr(c->name, ' ');
        sb_puts(&b, i ? ",{\"name\":" : "{\"name\":");
        sb_json_str(&b, c->name);
        sb_puts(&b, ",\"group\":");
        sb_json_str(&b, group_of(c)->title);
        sb_puts(&b, ",\"parent\":");
        if (sp) {
            char parent[64];
            snprintf(parent, sizeof parent, "%.*s", (int)(sp - c->name),
                     c->name);
            sb_json_str(&b, parent);
        } else sb_puts(&b, "null");
        sb_puts(&b, ",\"usage\":");
        StrBuf u; sb_init(&u);
        sb_printf(&u, "cg %s", c->usage);
        sb_json_str(&b, u.p);
        sb_free(&u);
        sb_puts(&b, ",\"args\":");
        sb_json_str(&b, c->args ? c->args : "");
        sb_puts(&b, ",\"summary\":");
        sb_json_str(&b, c->summary);
        sb_puts(&b, ",\"detail\":");
        if (c->detail) sb_json_str(&b, c->detail); else sb_puts(&b, "null");
        sb_puts(&b, ",\"flags\":");
        json_flags(&b, c->flags);
        sb_puts(&b, ",\"examples\":");
        json_list(&b, c->examples, '\n');
        sb_puts(&b, ",\"related\":");
        json_list(&b, c->related, ',');
        sb_puts(&b, ",\"aliases\":");
        json_list(&b, c->aliases, ',');
        sb_puts(&b, ",\"subcommands\":[");
        bool first = true;
        for (int j = 0; j < NHELP; j++) {
            if (!is_child(&HELP[j], c->name)) continue;
            if (!first) sb_putc(&b, ',');
            sb_json_str(&b, HELP[j].name);
            first = false;
        }
        sb_printf(&b, "],\"overview\":%s}", c->hide ? "false" : "true");
    }
    sb_puts(&b, "],\"global_flags\":");
    json_flags(&b, GLOBAL_FLAGS);
    sb_puts(&b, "}\n");
    fputs(b.p, stdout);
    sb_free(&b);
}

/* main's bad-argument line, from the same row cg help shows */
void help_usage(const char *name) {
    const HelpCmd *c = help_find(name);
    fprintf(stderr, "usage: cg %s\n", c ? c->usage : name);
}

/* cg help [--all] [--json] [<name> ...] */
int cmd_help(int argc, char **argv) {
    bool all = false, json = false;
    char *words[8];
    int nw = 0;
    for (int i = 0; i < argc; i++) {
        if (!strcmp(argv[i], "--all")) all = true;
        else if (!strcmp(argv[i], "--json")) json = true;
        else if (nw < 8) words[nw++] = argv[i];
    }
    if (json) { help_json(); return 0; }
    if (all) { help_all(); return 0; }
    if (!nw) { help_overview(); return 0; }
    const HelpCmd *c = find_words(nw, words);
    if (!c) {
        StrBuf b; sb_init(&b);
        for (int i = 0; i < nw; i++) {
            if (i) sb_putc(&b, ' ');
            sb_puts(&b, words[i]);
        }
        int rc = help_command(b.p);
        sb_free(&b);
        return rc;
    }
    return help_command(c->name);
}

/* Help routing for main, before any flag is consumed: cg help ..., -h,
 * --help, and cg <command> [<subcommand>...] --help|-h. The -h/--help must
 * follow only plain words, so `cg commit -m -h` stays a commit message.
 * Returns -1 when argv is not a help request. */
int help_route(int argc, char **argv) {
    if (argc < 2) return -1;
    const char *cmd = argv[1];
    if (!strcmp(cmd, "help") || !strcmp(cmd, "--help") || !strcmp(cmd, "-h"))
        return cmd_help(argc - 2, argv + 2);
    for (int i = 2; i < argc; i++) {
        if (!strcmp(argv[i], "--help") || !strcmp(argv[i], "-h")) {
            const HelpCmd *c = find_words(i - 1, argv + 1);
            if (c) return help_command(c->name);
            return help_command(cmd);
        }
        if (argv[i][0] == '-') break;
    }
    return -1;
}
