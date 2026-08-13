/* Codify CLI — see README.md */
#include "cg.h"

static void usage(void) {
    printf(
"Codify %s — the agent workflow tool: code graph + version control,\n"
"100%% local, from small projects to large codebases\n"
"\n"
"usage: cg <command> [args]\n"
"\n"
"graph\n"
"  init                     create .codegraph/ here and build the index\n"
"  index [--full]           (re)index the project\n"
"  sync                     incremental index (changed files only)\n"
"  search <query> [-n N]    find code by name (FTS5 trigram + full text)\n"
"  symbol <name>            definition(s), snippet, reference count\n"
"  impact <name> [-d N]     callers/callees to depth N (default 3)\n"
"  context <query>          one-call context: symbols, snippets, edges,\n"
"                           entry points, routes\n"
"  routes [filter]          framework-aware URL routes -> handlers\n"
"  watch [--debounce MS]    auto-sync on file changes (native OS events)\n"
"  info                     machine profile and how the pipeline was sized\n"
"\n"
"version control\n"
"  commit -m <msg>          snapshot the working tree (content-addressed)\n"
"  log [-n N]               commit history\n"
"  status                   working tree vs HEAD\n"
"  diff [A] [B]             HEAD vs worktree | A vs worktree | A vs B\n"
"  checkout <id> [--force]  restore a snapshot\n"
"  changes                  impact radius of uncommitted edits\n"
"\n"
"agentic\n"
"  mcp                      run as an MCP server (stdio) for coding agents\n"
"  mcp-install              auto-connect to Claude Code, Cursor, VS Code,\n"
"                           Windsurf, Gemini CLI, Codex CLI\n"
"  changelog [-n N] [-o F]  changelog from snapshots with symbol-level diffs\n"
"  agentmd [--write]        generate AGENTS.md + CLAUDE.md from the graph\n"
"\n"
"spec workflow (Ion kvx specs — works in any repo with spec/workflow.kvx)\n"
"  spec render [--check]    regenerate IDE pointer files + markdown mirror\n"
"  spec [status]            task board for the active feature\n"
"  spec next                next eligible task with its acceptance criteria\n"
"  spec start <id>          mark a task in_progress (one at a time)\n"
"  spec done <id>           verify_cmd + graph checks (symbols/touches),\n"
"                           then mark done\n"
"  spec trace [<id>]        trace tasks to code: symbols in the graph,\n"
"                           touched paths, tagged commits\n"
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
        sb_printf(&b,
            "{\"profile\":\"%s\",\"cores_online\":%d,\"cores_affinity\":%d,"
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
    if (strcmp(cmd, "spec") == 0)
        return cmd_spec(argc - 2, argv + 2, json);

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
        char root[4096];
        if (cg_find_root(root, sizeof root) == 0) {
            fprintf(stderr, "cg: already initialized at %s\n", root);
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
        if (argc < 3) { fprintf(stderr, "usage: cg impact <name>\n"); rc = 1; }
        else rc = cmd_impact(&cg, argv[2], depth > 0 ? depth : 3, json);
    } else if (strcmp(cmd, "context") == 0) {
        if (argc < 3) { fprintf(stderr, "usage: cg context <query>\n"); rc = 1; }
        else rc = cmd_context(&cg, argv[2], json);
    } else if (strcmp(cmd, "routes") == 0) {
        rc = cmd_routes(&cg, argc >= 3 ? argv[2] : NULL, json);
    } else if (strcmp(cmd, "watch") == 0) {
        int deb = atoi(opt(&argc, argv, "--debounce", "300"));
        rc = cmd_watch(&cg, &si, deb > 0 ? deb : 300);
    } else if (strcmp(cmd, "commit") == 0) {
        const char *msg = opt(&argc, argv, "-m", NULL);
        if (!msg) { fprintf(stderr, "usage: cg commit -m <message>\n"); rc = 1; }
        else {
            IndexStats st;
            cg_index(&cg, &si, false, &st, true);   /* graph stays fresh */
            rc = cmd_commit(&cg, msg, false);
        }
    } else if (strcmp(cmd, "log") == 0) {
        int limit = atoi(opt(&argc, argv, "-n", "20"));
        rc = cmd_log(&cg, limit > 0 ? limit : 20, json);
    } else if (strcmp(cmd, "status") == 0) {
        rc = cmd_status(&cg, json);
    } else if (strcmp(cmd, "diff") == 0) {
        rc = cmd_diff(&cg, argc >= 3 ? argv[2] : NULL,
                      argc >= 4 ? argv[3] : NULL);
    } else if (strcmp(cmd, "checkout") == 0) {
        bool force = flag(&argc, argv, "--force");
        if (argc < 3) { fprintf(stderr, "usage: cg checkout <id>\n"); rc = 1; }
        else rc = cmd_checkout(&cg, argv[2], force);
    } else if (strcmp(cmd, "changes") == 0) {
        rc = cmd_changes(&cg, json);
    } else if (strcmp(cmd, "mcp") == 0) {
        rc = cmd_mcp(&cg, &si);
    } else if (strcmp(cmd, "mcp-install") == 0) {
        rc = cmd_mcp_install(&cg);
    } else if (strcmp(cmd, "changelog") == 0) {
        int limit = atoi(opt(&argc, argv, "-n", "50"));
        const char *out = opt(&argc, argv, "-o", NULL);
        rc = cmd_changelog(&cg, limit > 0 ? limit : 50, out);
    } else if (strcmp(cmd, "agentmd") == 0) {
        bool write_files = flag(&argc, argv, "--write");
        IndexStats st;
        cg_index(&cg, &si, false, &st, true);   /* fresh graph first */
        rc = cmd_agentmd(&cg, write_files);
    } else {
        fprintf(stderr, "cg: unknown command '%s' (try `cg help`)\n", cmd);
        rc = 1;
    }
    cg_close(&cg);
    return rc;
}
