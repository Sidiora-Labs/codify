/* Codify CLI — see README.md */
#include "cg.h"
#include <unistd.h>
#include <sys/stat.h>

static void usage(void) {
    printf(
"Codify %s — the agent workflow tool: code graph + version control,\n"
"100%% local, from small projects to large codebases\n"
"\n"
"usage: cg <command> [args]\n"
"\n"
"graph\n"
"  init [--nested]          create .codegraph/ here and build the index\n"
"  root                     print the project root cg resolves to\n"
"  index [--full]           (re)index the project\n"
"  sync                     incremental index (changed files only)\n"
"  search <query> [-n N]    find code by name (FTS5 trigram + full text)\n"
"  symbol <name>            definition(s), snippet, reference count\n"
"  impact <name> [-d N]     callers/callees to depth N (default 3)\n"
"  context <query>          one-call context: symbols, snippets, edges,\n"
"                           entry points, routes\n"
"  routes [filter]          framework-aware URL routes -> handlers\n"
"  survey [scope]           purpose lines and docs across many files,\n"
"                           never bodies (scope: path prefix or query)\n"
"  anchors [--stale] [--uncovered]\n"
"                           anchor health: stale docs, and uncovered\n"
"                           symbols ranked by coordination score\n"
"  show <symbol|path:line>  print just that symbol's body\n"
"  test-impact [symbol]     tests referencing a symbol, or your changes\n"
"  why <symbol>             provenance: commits, tasks, and decisions\n"
"  watch [--debounce MS]    auto-sync on file changes (native OS events)\n"
"  info                     machine profile and how the pipeline was sized\n"
"\n"
"version control\n"
"  commit -m <msg>          snapshot; --task <id>, --amend, --git\n"
"  git-sync [-n N]          ingest git history for provenance and ranking\n"
"  log [-n N]               commit history\n"
"  status                   working tree vs HEAD\n"
"  state                    Git, snapshot, spec, live ownership, staleness\n"
"  event ingest|history|progress\n"
"                           normalized lifecycle evidence (stdin for ingest)\n"
"  diff [A] [B]             HEAD vs worktree | A vs worktree | A vs B\n"
"  checkout <id> [--force]  restore a snapshot\n"
"  changes                  impact radius of uncommitted edits\n"
"\n"
"memory (durable agent notes, stored beside the graph)\n"
"  remember <text>          save a memory; --type decision|constraint|\n"
"                           outcome|preference|fact, --task <feature/id>\n"
"                           (defaults to the in-progress spec task)\n"
"  recall [query] [-n N]    search memories (FTS + recency); --task, --type,\n"
"                           --near <file> for anchored retrieval\n"
"  memory compact           drop duplicate memories (--dry-run to preview)\n"
"  forget <id>              delete a memory\n"
"\n"
"agentic\n"
"  mcp                      run as an MCP server (stdio) for coding agents\n"
"  lsp                      run as a Language Server (stdio) for editors\n"
"  mcp-install              auto-connect to Claude Code, Cursor, VS Code,\n"
"                           Windsurf, Gemini CLI, Codex CLI\n"
"  integrate [detect|plan|apply|doctor]\n"
"                           configure and diagnose every agent host\n"
"  changelog [-n N] [-o F]  changelog from snapshots with symbol-level diffs\n"
"  agentmd [--write]        generate AGENTS.md + CLAUDE.md from the graph\n"
"  check [--strict]         one CI gate: render, lint, evidence, tree\n"
"  brief                    session state: task, changes, decisions\n"
"  review                   changed symbols vs acceptance criteria + risk\n"
"  guard [paths] [--strict] edits outside the active task's declared scope\n"
"  handoff [--task <id>]    record session state against a task: --done,\n"
"                           --next, --blocked, -m <note>\n"
"  resume [--task <id>]     task packet + latest handoff + memories + tree\n"
"                           state; --prompt for a paste-ready block\n"
"  hook install             wire agent + git hooks so the graph self-syncs\n"
"\n"
"spec workflow (Ion kvx specs — works in any repo with spec/workflow.kvx)\n"
"  spec render [--check]    regenerate IDE pointer files + markdown mirror\n"
"  spec [status]            task board for the active feature\n"
"  spec next                next eligible task with its acceptance criteria\n"
"  spec ready               all eligible tasks across waves (parallel view)\n"
"  spec claim-next          atomically claim the first conflict-free task;\n"
"                           --agent <name>, --ttl <min>\n"
"  spec heartbeat <id>      renew a live attempt; --attempt, --fence, --ttl\n"
"  spec reconcile           report stale in-progress declarations; --repair\n"
"  spec mode <prod|standard> configure implementation dependency semantics\n"
"  spec start <id>          mark a task in_progress (honors workflow limit)\n"
"  spec implemented <id>    graph-check coding work without verify_cmd;\n"
"                           mark qualification pending (Prod mode only)\n"
"  spec done <id>           verify_cmd + graph checks (symbols/touches),\n"
"                           then mark done; records an outcome memory\n"
"  spec trace [<id>]        trace tasks to code: symbols in the graph,\n"
"                           touched paths, tagged commits\n"
"  spec run [-n N]          orchestrate parallel/prod work: claim eligible\n"
"                           tasks and drive one agent per slot; --driver\n"
"                           codex|claude|custom, --dry-run, --max-fail K,\n"
"                           --agent-prefix P\n"
"\n"
"most query commands accept --json for machine-readable output\n",
        CG_VERSION);
}

static bool flag(int *argc, char **argv, const char *name) {
    for (int i = 1; i < *argc; i++) {
        if (strcmp(argv[i], name) == 0) {
            memmove(&argv[i], &argv[i + 1],
                    sizeof(char *) * (size_t)(*argc - i - 1));
            (*argc)--;
            return true;
        }
    }
    return false;
}

static const char *opt(int *argc, char **argv, const char *name,
                       const char *dflt) {
    for (int i = 1; i < *argc - 1; i++) {
        if (strcmp(argv[i], name) == 0) {
            const char *v = argv[i + 1];
            memmove(&argv[i], &argv[i + 2],
                    sizeof(char *) * (size_t)(*argc - i - 2));
            *argc -= 2;
            return v;
        }
    }
    return dflt;
}

static int cmd_info(const SysInfo *si, Cg *cg, bool json) {
    char *ms = cg ? cg_meta_get(cg, "last_index_ms") : NULL;
    char *nf = cg ? cg_meta_get(cg, "project_files") : NULL;
    char *nb = cg ? cg_meta_get(cg, "last_index_bytes") : NULL;
    if (json) {
        StrBuf b; sb_init(&b);
        sb_puts(&b, "{\"root\":");
        if (cg) sb_json_str(&b, cg->root); else sb_puts(&b, "null");
        sb_printf(&b,
            ",\"profile\":\"%s\",\"cores_online\":%d,\"cores_affinity\":%d,"
            "\"cores_cgroup_quota\":%.2f,\"cores_effective\":%d,"
            "\"mem_total_kb\":%ld,\"mem_available_kb\":%ld,"
            "\"cgroup_mem_limit_kb\":%ld,\"workers\":%d,"
            "\"db_cache_kb\":%d,\"mmap_bytes\":%ld",
            si->profile, si->cores_online, si->cores_affinity,
            si->cores_quota, si->cores_effective, si->mem_total_kb,
            si->mem_avail_kb, si->cg_mem_limit_kb, si->workers,
            si->db_cache_kb, si->mmap_bytes);
        if (ms) sb_printf(&b, ",\"last_index_ms\":%s", ms);
        if (nf) sb_printf(&b, ",\"project_files\":%s", nf);
        if (nb) sb_printf(&b, ",\"last_index_bytes\":%s", nb);
        sb_puts(&b, "}\n");
        fputs(b.p, stdout);
        sb_free(&b);
    } else {
        /* The bound project is the single most useful line here: it is how a
         * user notices that cg resolved to an ancestor they did not expect. */
        if (cg) printf("project root: %s\n", cg->root);
        else    printf("project root: (none — not inside a Codify project)\n");
        printf("machine profile: %s\n", si->profile);
        printf("  cores: %d online, %d affinity", si->cores_online,
               si->cores_affinity);
        if (si->cores_quota > 0)
            printf(", %.2f cgroup quota", si->cores_quota);
        else
            printf(", no cgroup quota");
        printf(" -> %d effective\n", si->cores_effective);
        printf("  memory: %.1f GB total, %.1f GB honestly available",
               si->mem_total_kb / 1048576.0, si->mem_avail_kb / 1048576.0);
        if (si->cg_mem_limit_kb > 0)
            printf(" (cgroup limit %.1f GB)", si->cg_mem_limit_kb / 1048576.0);
        printf("\n");
        printf("sized pipeline: %d workers, %d KB db cache, %ld MB mmap\n",
               si->workers, si->db_cache_kb, si->mmap_bytes / 1048576);
        if (ms && nf)
            printf("measured project cost: %s files, last index %sms%s%s\n",
                   nf, ms, nb ? ", " : "", nb ? nb : "");
    }
    free(ms); free(nf); free(nb);
    return 0;
}

int main(int argc, char **argv) {
    if (argc < 2) { usage(); return 1; }
    const char *cmd = argv[1];
    bool json = flag(&argc, argv, "--json");
    bool no_soft = flag(&argc, argv, "--no-soft");

    if (strcmp(cmd, "help") == 0 || strcmp(cmd, "--help") == 0 ||
        strcmp(cmd, "-h") == 0) {
        usage();
        return 0;
    }

    if (strcmp(cmd, "version") == 0 || strcmp(cmd, "--version") == 0) {
        printf("%s\n", CG_VERSION);
        return 0;
    }

    /* spec works without .codegraph — dispatch before opening the graph */
    if (strcmp(cmd, "spec") == 0) {
        if (argc > 2 && strcmp(argv[2], "run") == 0)
            return cmd_spec_run(argc - 3, argv + 3);
        return cmd_spec(argc - 2, argv + 2, json);
    }

    if (strcmp(cmd, "root") == 0)
        return cmd_root(json);

    SysInfo si;
    sysinfo_detect(&si);

    if (strcmp(cmd, "info") == 0) {
        Cg cg, *pcg = NULL;
        char root[4096];
        if (cg_find_root(root, sizeof root) == 0 && cg_open(&cg, false) == 0)
            pcg = &cg;
        int rc = cmd_info(&si, pcg, json);
        if (pcg) cg_close(pcg);
        return rc;
    }

    Cg cg;
    if (strcmp(cmd, "init") == 0) {
        bool nested = flag(&argc, argv, "--nested");
        bool force  = flag(&argc, argv, "--force");
        char here[4096], root[4096];
        if (!getcwd(here, sizeof here)) {
            fprintf(stderr, "cg: cannot determine the current directory\n");
            return 1;
        }
        char probe[4600];
        struct stat pst;
        snprintf(probe, sizeof probe, "%s/%s", here, CG_DIR);
        if (stat(probe, &pst) == 0) {
            fprintf(stderr, "cg: already initialized at %s\n", here);
            return 1;
        }
        const char *home = getenv("HOME");
        if (!force && home && home[0] && strcmp(here, home) == 0) {
            fprintf(stderr,
                "cg: refusing to initialize in your home directory.\n"
                "    Every project underneath would silently bind to this "
                "index.\n    Run cg init inside a project, or --force if you "
                "meant it.\n");
            return 1;
        }
        /* An ancestor project is legitimate in a monorepo, but it is far more
         * often a stray index that would silently capture this directory. */
        if (cg_find_root(root, sizeof root) == 0 && !nested) {
            fprintf(stderr,
                "cg: %s is already a Codify project and encloses this "
                "directory.\n    Commands here would operate on it, not on "
                "%s.\n    Use --nested to make this its own project "
                "anyway.\n", root, here);
            return 1;
        }
        if (cg_open(&cg, true) != 0) return 1;
        IndexStats st;
        cg_index(&cg, &si, true, &st, false);
        printf("initialized %s/%s [%s profile]\n", cg.root, CG_DIR, si.profile);
        cg_close(&cg);
        return 0;
    }

    if (cg_open(&cg, false) != 0) return 1;
    cg.no_soft = no_soft;
    int rc = 0;

    if (strcmp(cmd, "index") == 0) {
        bool full = flag(&argc, argv, "--full");
        IndexStats st;
        rc = cg_index(&cg, &si, full, &st, false);
    } else if (strcmp(cmd, "sync") == 0) {
        IndexStats st;
        rc = cg_index(&cg, &si, false, &st, false);
    } else if (strcmp(cmd, "search") == 0) {
        int limit = atoi(opt(&argc, argv, "-n", "20"));
        if (argc < 3) { fprintf(stderr, "usage: cg search <query>\n"); rc = 1; }
        else rc = cmd_search(&cg, argv[2], limit > 0 ? limit : 20, json);
    } else if (strcmp(cmd, "symbol") == 0) {
        if (argc < 3) { fprintf(stderr, "usage: cg symbol <name>\n"); rc = 1; }
        else rc = cmd_symbol(&cg, argv[2], json);
    } else if (strcmp(cmd, "impact") == 0) {
        int depth = atoi(opt(&argc, argv, "-d", "3"));
        int budget = atoi(opt(&argc, argv, "--budget", "8000"));
        if (argc < 3) { fprintf(stderr, "usage: cg impact <name> [-d N] "
                                        "[--budget N]\n"); rc = 1; }
        else rc = cmd_impact(&cg, argv[2], depth > 0 ? depth : 3,
                             budget > 0 ? budget : 8000, json);
    } else if (strcmp(cmd, "context") == 0) {
        int budget = atoi(opt(&argc, argv, "--budget", "4000"));
        int limit = atoi(opt(&argc, argv, "-n", "8"));
        if (argc < 3) { fprintf(stderr, "usage: cg context <query> "
                                        "[--budget N] [-n K]\n"); rc = 1; }
        else rc = cmd_context(&cg, argv[2], budget > 0 ? budget : 4000,
                              limit > 0 ? limit : 8, json);
    } else if (strcmp(cmd, "show") == 0) {
        bool full = flag(&argc, argv, "--full");
        if (argc < 3) { fprintf(stderr, "usage: cg show <symbol> [--full]\n");
                        rc = 1; }
        else rc = cmd_show(&cg, argv[2], full, json);
    } else if (strcmp(cmd, "test-impact") == 0) {
        rc = cmd_test_impact(&cg, argc >= 3 ? argv[2] : NULL, json);
    } else if (strcmp(cmd, "why") == 0) {
        if (argc < 3) { fprintf(stderr, "usage: cg why <symbol>\n"); rc = 1; }
        else rc = cmd_why(&cg, argv[2], json);
    } else if (strcmp(cmd, "routes") == 0) {
        rc = cmd_routes(&cg, argc >= 3 ? argv[2] : NULL, json);
    } else if (strcmp(cmd, "anchors") == 0) {
        bool st = flag(&argc, argv, "--stale");
        bool un = flag(&argc, argv, "--uncovered");
        rc = cmd_anchors(&cg, st, un, json);
    } else if (strcmp(cmd, "survey") == 0) {
        int budget = atoi(opt(&argc, argv, "--budget", "16000"));
        rc = cmd_survey(&cg, argc >= 3 ? argv[2] : NULL,
                        budget > 0 ? budget : 16000, json);
    } else if (strcmp(cmd, "watch") == 0) {
        int deb = atoi(opt(&argc, argv, "--debounce", "300"));
        rc = cmd_watch(&cg, &si, deb > 0 ? deb : 300);
    } else if (strcmp(cmd, "brief") == 0) {
        rc = cmd_brief(&cg, json);
    } else if (strcmp(cmd, "review") == 0) {
        IndexStats st;
        cg_index(&cg, &si, false, &st, true);   /* review needs a fresh graph */
        rc = cmd_review(&cg, json);
    } else if (strcmp(cmd, "guard") == 0) {
        bool strict = flag(&argc, argv, "--strict");
        rc = cmd_guard(&cg, argc - 2, argv + 2, json, strict);
    } else if (strcmp(cmd, "hook") == 0) {
        if (argc >= 3 && strcmp(argv[2], "install") == 0)
            rc = cmd_hook_install(&cg);
        else { fprintf(stderr, "usage: cg hook install\n"); rc = 1; }
    } else if (strcmp(cmd, "check") == 0) {
        bool strict = flag(&argc, argv, "--strict");
        rc = cmd_check(&cg, json, strict);
    } else if (strcmp(cmd, "git-sync") == 0) {
        int limit = atoi(opt(&argc, argv, "-n", "2000"));
        rc = cmd_git_sync(&cg, limit > 0 ? limit : 2000, json);
    } else if (strcmp(cmd, "commit") == 0) {
        const char *msg = opt(&argc, argv, "-m", NULL);
        const char *task = opt(&argc, argv, "--task", NULL);
        bool amend = flag(&argc, argv, "--amend");
        bool to_git = flag(&argc, argv, "--git");
        char *tag = task ? spec_task_tag(task) : NULL;
        if (!msg) {
            fprintf(stderr,
                    "usage: cg commit -m <message> [--task <id>] [--amend]\n");
            rc = 1;
        } else if (task && !tag) {
            fprintf(stderr,
                    "cg: --task %s is not an in_progress task of the active spec\n",
                    task);
            rc = 1;
        }
        else {
            IndexStats st;
            cg_index(&cg, &si, false, &st, true);   /* graph stays fresh */
            rc = cmd_commit_with_options(&cg, msg, false, tag, amend);
            if (rc == 0 && to_git) {
                StrBuf gm; sb_init(&gm);
                sb_printf(&gm, "%s%s%s", msg, tag ? " " : "", tag ? tag : "");
                rc = git_commit_mirror(&cg, gm.p);
                sb_free(&gm);
            }
        }
        free(tag);
    } else if (strcmp(cmd, "log") == 0) {
        int limit = atoi(opt(&argc, argv, "-n", "20"));
        rc = cmd_log(&cg, limit > 0 ? limit : 20, json);
    } else if (strcmp(cmd, "status") == 0) {
        rc = cmd_status(&cg, json);
    } else if (strcmp(cmd, "state") == 0) {
        rc = cmd_state(&cg, json);
    } else if (strcmp(cmd, "event") == 0) {
        rc = cmd_event(&cg, argc - 2, argv + 2, json);
    } else if (strcmp(cmd, "diff") == 0) {
        rc = cmd_diff(&cg, argc >= 3 ? argv[2] : NULL,
                      argc >= 4 ? argv[3] : NULL);
    } else if (strcmp(cmd, "checkout") == 0) {
        bool force = flag(&argc, argv, "--force");
        if (argc < 3) { fprintf(stderr, "usage: cg checkout <id>\n"); rc = 1; }
        else rc = cmd_checkout(&cg, argv[2], force);
    } else if (strcmp(cmd, "changes") == 0) {
        int limit = atoi(opt(&argc, argv, "--limit", "0"));
        rc = cmd_changes(&cg, limit, json);
    } else if (strcmp(cmd, "remember") == 0) {
        const char *type = opt(&argc, argv, "--type", NULL);
        const char *task = opt(&argc, argv, "--task", NULL);
        const char *symbols = opt(&argc, argv, "--symbols", NULL);
        const char *files = opt(&argc, argv, "--files", NULL);
        const char *supersedes = opt(&argc, argv, "--supersedes", NULL);
        if (argc < 3) {
            fprintf(stderr, "usage: cg remember \"<text>\" [--type T] "
                    "[--task <feature/id>] [--symbols a,b] [--files x,y]\n");
            rc = 1;
        } else {
            char *dflt = task ? NULL : spec_active_tag();
            rc = cmd_remember(&cg, argv[2], type, task ? task : dflt,
                              symbols, files, json);
            free(dflt);
            if (rc == 0 && supersedes)
                rc = memory_supersede(&cg, atol(supersedes),
                                      (long)sqlite3_last_insert_rowid(cg.db));
        }
    } else if (strcmp(cmd, "recall") == 0) {
        const char *task = opt(&argc, argv, "--task", NULL);
        const char *type = opt(&argc, argv, "--type", NULL);
        const char *near = opt(&argc, argv, "--near", NULL);
        int limit = atoi(opt(&argc, argv, "-n", "10"));
        if (near)
            rc = cmd_recall_near(&cg, near, limit > 0 ? limit : 10, json);
        else
            rc = cmd_recall(&cg, argc >= 3 ? argv[2] : NULL, task, type,
                            limit > 0 ? limit : 10, json);
    } else if (strcmp(cmd, "memory") == 0) {
        if (argc >= 3 && strcmp(argv[2], "compact") == 0) {
            bool dry = flag(&argc, argv, "--dry-run");
            rc = cmd_memory_compact(&cg, dry, json);
        } else {
            fprintf(stderr, "usage: cg memory compact [--dry-run]\n");
            rc = 1;
        }
    } else if (strcmp(cmd, "forget") == 0) {
        if (argc < 3) { fprintf(stderr, "usage: cg forget <id>\n"); rc = 1; }
        else rc = cmd_forget(&cg, argv[2]);
    } else if (strcmp(cmd, "lsp") == 0) {
        rc = cmd_lsp(&cg, &si);
    } else if (strcmp(cmd, "mcp") == 0) {
        rc = cmd_mcp(&cg, &si);
    } else if (strcmp(cmd, "mcp-install") == 0) {
        rc = cmd_mcp_install(&cg);
    } else if (strcmp(cmd, "integrate") == 0) {
        rc = cmd_integrate(&cg, argc >= 3 ? argv[2] : "detect", json, false);
    } else if (strcmp(cmd, "changelog") == 0) {
        int limit = atoi(opt(&argc, argv, "-n", "50"));
        const char *out = opt(&argc, argv, "-o", NULL);
        rc = cmd_changelog(&cg, limit > 0 ? limit : 50, out);
    } else if (strcmp(cmd, "agentmd") == 0) {
        bool write_files = flag(&argc, argv, "--write");
        IndexStats st;
        cg_index(&cg, &si, false, &st, true);   /* fresh graph first */
        rc = cmd_agentmd(&cg, write_files);
    } else if (strcmp(cmd, "handoff") == 0) {
        const char *task = opt(&argc, argv, "--task", NULL);
        const char *done = opt(&argc, argv, "--done", NULL);
        const char *next = opt(&argc, argv, "--next", NULL);
        const char *blocked = opt(&argc, argv, "--blocked", NULL);
        const char *note = opt(&argc, argv, "-m", NULL);
        rc = cmd_handoff(&cg, task, done, next, blocked, note, json);
    } else if (strcmp(cmd, "resume") == 0) {
        const char *task = opt(&argc, argv, "--task", NULL);
        bool prompt = flag(&argc, argv, "--prompt");
        rc = cmd_resume(&cg, task, json, prompt);
    } else {
        fprintf(stderr, "cg: unknown command '%s' (try `cg help`)\n", cmd);
        rc = 1;
    }
    cg_close(&cg);
    return rc;
}
