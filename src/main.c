#include <stdio.h>
extern int hf_client_authority_guard(const char *operation, FILE *output);
extern int hf_client_dispatch(int argc,char **argv,FILE *out,FILE *err);
extern int hf_entrypoint_dispatch(int argc,char **argv);
extern int hf_client_authority_guard_args(const char *operation,int argc,char **argv,FILE *output);
/* Codify CLI — see README.md */
#include "cg.h"
#include "sem_flow.h"
#include "sem_search.h"
#include "sem_inspect.h"
#include "answer_health.h"
#include <poll.h>
#include <unistd.h>
#include <sys/stat.h>

/* the overview lives in help.c beside the table it is drawn from */
static void usage(void) {
    help_overview();
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

/* --workers N on index, sync, and info: 1..CG_MAX_WORKERS, or auto/0 for
 * "not given". *out is 0 when absent; false (after saying why) when the
 * value is unusable — a mistyped count fails loudly, unlike the file. */
static bool workers_opt(int *argc, char **argv, const char *cmd, int *out) {
    const char *v = opt(argc, argv, "--workers", NULL);
    *out = 0;
    if (!v) return true;
    int n = config_parse_workers(v);
    if (n < 0) {
        fprintf(stderr, "hyperfide %s: --workers takes 1 to %d, or auto — not "
                "'%s'\n", cmd, CG_MAX_WORKERS, v);
        return false;
    }
    *out = n;
    return true;
}

static int query_budget_arg(int argc, char **argv) {
    for (int i = 2; i + 1 < argc; i++)
        if (strcmp(argv[i], "--budget") == 0) return atoi(argv[i + 1]);
    return 0;
}

static int cmd_info(const SysInfo *si, Cg *cg, bool json, int flag_workers,
                    bool canonical_workers) {
    /* the count an unbounded foreground pass would ask for, and who chose
     * it; background passes, the file count, and the slot gate bound it
     * per pass (cg sync --json reports what one actually used) */
    const char *worigin;
    int wanted = syncgate_worker_request(cg ? cg->root : NULL, si,
                                         flag_workers, &worigin);
    /* Environment aliasing copies the canonical value into the legacy slot. */
    if (!strcmp(worigin, "CG_INDEX_WORKERS") && canonical_workers)
        worigin = "HYPERFIDE_INDEX_WORKERS";
    char key[64];
    char *ms = NULL, *nf = NULL, *nb = NULL;
    if (cg) {
        cg_bkey(cg, "last_index_ms", key, sizeof key);
        ms = cg_meta_get(cg, key);
        cg_bkey(cg, "project_files", key, sizeof key);
        nf = cg_meta_get(cg, key);
        cg_bkey(cg, "last_index_bytes", key, sizeof key);
        nb = cg_meta_get(cg, key);
    }
    if (json) {
        StrBuf b; sb_init(&b);
        sb_puts(&b, "{\"root\":");
        if (cg) sb_json_str(&b, cg->root); else sb_puts(&b, "null");
        sb_puts(&b, ",\"shared\":");
        if (cg) sb_json_str(&b, cg->shared); else sb_puts(&b, "null");
        sb_printf(&b, ",\"worktree\":%s,\"branch\":",
                  cg && cg->worktree ? "true" : "false");
        if (cg) sb_json_str(&b, cg->branch); else sb_puts(&b, "null");
        sb_printf(&b,
            ",\"profile\":\"%s\",\"cores_online\":%d,\"cores_affinity\":%d,"
            "\"cores_cgroup_quota\":%.2f,\"cores_effective\":%d,"
            "\"mem_total_kb\":%ld,\"mem_available_kb\":%ld,"
            "\"cgroup_mem_limit_kb\":%ld,\"workers\":%d,"
            "\"workers_origin\":\"%s\",\"machine_workers\":%d,"
            "\"db_cache_kb\":%d,\"mmap_bytes\":%ld",
            si->profile, si->cores_online, si->cores_affinity,
            si->cores_quota, si->cores_effective, si->mem_total_kb,
            si->mem_avail_kb, si->cg_mem_limit_kb, wanted, worigin,
            si->workers, si->db_cache_kb, si->mmap_bytes);
        if (ms) sb_printf(&b, ",\"last_index_ms\":%s", ms);
        if (nf) sb_printf(&b, ",\"project_files\":%s", nf);
        if (nb) sb_printf(&b, ",\"last_index_bytes\":%s", nb);
        if (cg) sb_printf(&b, ",\"fts_mode\":\"%s\",\"sqlite\":\"%s\"",
                          db_fts_contentless(cg) ? "contentless" : "content",
                          sqlite3_libversion());
        if (cg) { sb_putc(&b, ','); answer_health_append(&b, cg, NULL); }
        sb_puts(&b, "}\n");
        fputs(b.p, stdout);
        sb_free(&b);
    } else {
        /* The bound project is the single most useful line here: it is how a
         * user notices that cg resolved to an ancestor they did not expect. */
        if (cg) printf("project root: %s\n", cg->root);
        else    printf("project root: (none — not inside a Codify project)\n");
        if (cg && cg->worktree) printf("worktree of: %s\n", cg->shared);
        if (cg) printf("branch: %s\n", cg->branch);
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
        printf("sized pipeline: %d workers (%s), %d KB db cache, %ld MB "
               "mmap\n", wanted, worigin, si->db_cache_kb,
               si->mmap_bytes / 1048576);
        if (ms && nf)
            printf("measured project cost: %s files, last index %sms%s%s\n",
                   nf, ms, nb ? ", " : "", nb ? nb : "");
        if (cg)
            printf("body index: %s (SQLite %s)\n",
                   db_fts_contentless(cg)
                       ? "contentless, text read from disk"
                       : "stores file content (contentless needs SQLite "
                         "3.43.0 or newer when the graph is built)",
                   sqlite3_libversion());
        if (cg) answer_health_text(cg);
    }
    free(ms); free(nf); free(nb);
    return 0;
}

/* Read-mostly commands refresh the graph first, but a pass that started
 * within the last few seconds and left no dirty note is reused rather than
 * repeated: agents run review, brief, and agentmd back to back, and each
 * used to walk the tree again. Waits for a pass in flight (the default
 * lock wait) so the answer is never older than the edit it follows. */
#define FRESH_WINDOW_MS 3000
static void index_fresh(Cg *cg, const SysInfo *si) {
    if (!config_auto_sync(cg->root)) return;
    IndexOpts o = {0};
    o.max_age_ms = FRESH_WINDOW_MS;
    o.lock_wait_ms = -1;
    o.quiet = true;
    IndexStats st;
    cg_index_ex(cg, si, &o, &st);
}

int main(int argc, char **argv) {
    const char *cmd = argc > 1 ? argv[1] : "";
    bool canonical_workers = getenv("HYPERFIDE_INDEX_WORKERS") &&
                             getenv("HYPERFIDE_INDEX_WORKERS")[0];
    bool host_hook = argc >= 3 && !strcmp(cmd, "hook") &&
        (!strcmp(argv[2], "post-edit") || !strcmp(argv[2], "event") ||
         !strcmp(argv[2], "pre-bash"));
    if (hyperfide_environment_aliases() != 0) return host_hook ? 0 : 78;
    if (argc < 2) { usage(); return 1; }
    int hrc = help_route(argc, argv);
    if (hrc >= 0) return hrc;
    kvx_status_hook = events_kvx_status;
    journal_set_command(cmd, argc > 2 ? argv[2] : NULL);
    bool json = flag(&argc, argv, "--json");
    native_no_discover = flag(&argc, argv, "--no-discover"); /* codify-v15 2.4 */
    bool no_soft = flag(&argc, argv, "--no-soft");
    bool all_branches = flag(&argc, argv, "--all-branches");
    const char *scope_branch = opt(&argc, argv, "--branch", NULL);

    if (strcmp(cmd, "version") == 0 || strcmp(cmd, "--version") == 0) {
        printf("%s\n", CG_VERSION);
        return 0;
    }

    { int launcher_rc = hf_entrypoint_dispatch(argc,argv); if (launcher_rc >= 0) return host_hook ? 0 : launcher_rc; }
    { int remote_rc = hf_client_dispatch(argc,argv,stdout,stderr); if (remote_rc >= 0) return host_hook ? 0 : remote_rc; }

    /* spec works without .codegraph — dispatch before opening the graph */
    if (strcmp(cmd, "spec") == 0) {
        if (argc > 2 && strcmp(argv[2], "run") == 0)
            return cmd_spec_run(argc - 3, argv + 3);
        return cmd_spec(argc - 2, argv + 2, json);
    }

    if (strcmp(cmd, "root") == 0)
        return cmd_root(json);

    /* codify.kvx belongs to the tree, not the graph: config answers in a
     * spec-only repository and before cg init */
    if (strcmp(cmd, "config") == 0)
        return cmd_config(argc - 2, argv + 2, json);

    SysInfo si;
    sysinfo_detect(&si);

    if (strcmp(cmd, "info") == 0) {
        Cg cg, *pcg = NULL;
        char root[4096];
        if (cg_find_root(root, sizeof root) == 0 && cg_open(&cg, false) == 0)
            pcg = &cg;
        int fw;
        if (!workers_opt(&argc, argv, "info", &fw)) {
            if (pcg) cg_close(pcg);
            return 1;
        }
        int rc = cmd_info(&si, pcg, json, fw, canonical_workers);
        if (pcg) cg_close(pcg);
        return rc;
    }

    Cg cg;
    if (strcmp(cmd, "init") == 0) {
        bool nested = flag(&argc, argv, "--nested");
        bool force  = flag(&argc, argv, "--force");
        char here[4096], root[4096];
        if (!getcwd(here, sizeof here)) {
            fprintf(stderr, "hyperfide: cannot determine the current directory\n");
            return 1;
        }
        char probe[4600];
        struct stat pst;
        snprintf(probe, sizeof probe, "%s/%s", here, CG_DIR);
        /* a no-op, so `hyperfide init && hyperfide index` chains on a tree
         * that is already set up */
        if (stat(probe, &pst) == 0) {
            fprintf(stderr, "hyperfide: already initialized at %s — nothing "
                            "to do\n", here);
            return 0;
        }
        const char *home = getenv("HOME");
        if (!force && home && home[0] && strcmp(here, home) == 0) {
            fprintf(stderr,
                "hyperfide: refusing to initialize in your home directory.\n"
                "    Every project underneath would silently bind to this "
                "index.\n    Run hyperfide init inside a project, or --force if you "
                "meant it.\n");
            return 1;
        }
        /* A linked worktree of an initialized repository joins the shared
         * graph: its files are indexed under their own branch, nothing is
         * created here. --nested still makes it a separate project. */
        char shared[4096];
        if (!nested && cg_find_project_at(here, root, shared, sizeof root) == 0
            && strcmp(root, here) == 0 && strcmp(shared, here) != 0) {
            if (cg_open(&cg, false) != 0) return 1;
            progress_request(!json);
            IndexStats st;
            cg_index(&cg, &si, true, &st, false);
            printf("joined %s as worktree %s on branch %s\n", cg.shared,
                   cg.root, cg.branch);
            cg_close(&cg);
            return 0;
        }
        /* An ancestor project is legitimate in a monorepo, but it is far more
         * often a stray index that would silently capture this directory. */
        if (cg_find_root(root, sizeof root) == 0 && !nested) {
            fprintf(stderr,
                "hyperfide: %s is already a Codify project and encloses this "
                "directory.\n    Commands here would operate on it, not on "
                "%s.\n    Use --nested to make this its own project "
                "anyway.\n", root, here);
            return 1;
        }
        /* a fifty-thousand-file tree must show activity in the first second:
         * each step is named as it begins, the walk's count once known */
        progress_request(!json);
        progress_step("creating the graph directory");
        if (cg_open(&cg, true) != 0) return 1;
        IndexStats st;
        cg_index(&cg, &si, true, &st, false);
        printf("initialized %s/%s [%s profile]\n", cg.root, CG_DIR, si.profile);
        cg_close(&cg);
        return 0;
    }

    /* an agent host fires its hooks in whatever directory it runs in (the
     * Claude Code plugin is user-scoped, so everywhere); outside a Codify
     * project there is nothing to do, and a failing hook would be reported
     * to the agent as an error on every event */
    if (strcmp(cmd, "hook") == 0 && argc >= 3 &&
        strcmp(argv[2], "install") != 0) {
        char root[4096];
        if (cg_find_root(root, sizeof root) != 0) {
            char drain[4096];
            if (!isatty(STDIN_FILENO))
                while (fread(drain, 1, sizeof drain, stdin) > 0) {}
            return 0;
        }
    }

    /* jev doctor is how an operator finds out why Jev is unavailable, so
     * it must answer outside a project too; ask and log just lose the
     * .codegraph/jev.log there */
    if (strcmp(cmd, "jev") == 0) {
        Cg *pcg = NULL;
        char root[4096];
        if (cg_find_root(root, sizeof root) == 0 && cg_open(&cg, false) == 0)
            pcg = &cg;
        int rc = cmd_jev(pcg, argc, argv, json);
        if (pcg) cg_close(pcg);
        return rc;
    }

    /* Every command below needs the graph, but a name that is no command
     * at all is answered first: the suggestion must not hide behind "not
     * inside a Codify project" when cg is run from an uninitialised tree. */
    if (!help_known(cmd)) {
        fprintf(stderr, "hyperfide: unknown command '%s' (try `hyperfide help`)\n", cmd);
        help_suggest(cmd);
        return 1;
    }

    if (cg_open(&cg, false) != 0) return 1;
    cg.no_soft = no_soft;
    /* Reads answer for the branch the caller is standing on unless it says
     * otherwise; --all-branches unions every tracked branch and labels each
     * hit. Writes are never redirected — the indexer always writes here. */
    /* on memory export --branch names the branch a memory carries, which
     * need not be one this graph tracks: a filter, not a read scope */
    bool mem_export = (strcmp(cmd, "memory") == 0 && argc > 2 &&
                       strcmp(argv[2], "export") == 0) ||
                      strcmp(cmd, "projection") == 0;  /* --branch adds */
    if (cg_scope_set(&cg, mem_export ? NULL : scope_branch,
                     all_branches) != 0) {
        fprintf(stderr, "hyperfide: no branch named '%s' in this graph "
                        "(hyperfide branches lists them)\n", scope_branch);
        cg_close(&cg);
        return 1;
    }
    /* codify-v15 1.2: --path/--lang/--no-tests, parsed once for the reads
     * that narrow by them; graph.c applies the filter inside their SQL */
    if (strcmp(cmd, "search") == 0 || strcmp(cmd, "context") == 0 ||
        strcmp(cmd, "survey") == 0) {
        QueryFilter qf;
        if (query_filter_parse(&argc, argv, &qf) != 0) {
            cg_close(&cg);
            return 1;
        }
        cg_filter_set(&cg, &qf);
    }
    int rc = 0;
    bool health_answer = json &&
        (strcmp(cmd, "search") == 0 || strcmp(cmd, "context") == 0 ||
         strcmp(cmd, "symbol") == 0 || strcmp(cmd, "impact") == 0 ||
         strcmp(cmd, "flow") == 0 ||
         strcmp(cmd, "routes") == 0 || strcmp(cmd, "files") == 0 ||
         strcmp(cmd, "survey") == 0 || strcmp(cmd, "show") == 0 ||
         strcmp(cmd, "why") == 0 || strcmp(cmd, "grep") == 0 ||
         strcmp(cmd, "test-impact") == 0 || strcmp(cmd, "inspect") == 0);
    AnswerCapture answer_capture = {0};
    int requested_budget = json && (strcmp(cmd, "context") == 0 ||
        strcmp(cmd, "impact") == 0) ? query_budget_arg(argc, argv) : 0;
    size_t answer_max = requested_budget > 0 && requested_budget < 1000000 ?
        (size_t)requested_budget * 4 : 0;
    if (health_answer) answer_health_capture_begin(&answer_capture, answer_max);

    if (strcmp(cmd, "journal") == 0) {
        rc = cmd_journal(&cg, argc - 2, argv + 2, json);
    } else if (strcmp(cmd, "index") == 0) {
        IndexOpts o = {0};                 /* cg_index's blocking pass */
        o.full = flag(&argc, argv, "--full");
        o.lock_wait_ms = -1;
        if (!workers_opt(&argc, argv, "index", &o.workers)) {
            cg_close(&cg);
            return 1;
        }
        journal_replay(&cg, JOURNAL_PROBE);     /* queued writes first */
        IndexStats st;
        progress_request(!json);
        o.quiet = json;
        rc = cg_index_ex(&cg, &si, &o, &st);
        if (json) {
            StrBuf jb; sb_init(&jb);
            index_stats_json(&st, false, &jb);
            puts(jb.p);
            sb_free(&jb);
        }
        if (rc != 0 && st.busy) { cg_busy_report("The index"); rc = CG_EXIT_BUSY; }
    } else if (strcmp(cmd, "sync") == 0) {
        /* sync is what hooks, watchers, and editors call after every edit,
         * so it coalesces by default: a short wait for a pass already
         * running, then a dirty note instead of a second walk. cg index is
         * the blocking form for a person who wants the pass to happen now. */
        IndexOpts o = {0};
        /* --auto: a hook or editor asking, not a person; it honours
         * [sync] auto like every other implicit sync */
        bool implicit  = flag(&argc, argv, "--auto");
        o.max_age_ms   = atol(opt(&argc, argv, "--max-age", "0"));
        o.background   = flag(&argc, argv, "--background");
        if (!workers_opt(&argc, argv, "sync", &o.workers)) {
            cg_close(&cg);
            return 1;
        }
        o.lock_wait_ms = atol(opt(&argc, argv, "--wait",
                                  o.background ? "0" : "2000"));
        o.quiet = json;
        o.paths = (const char *const *)(argv + 2);
        o.npaths = argc - 2;
        IndexStats st;
        journal_replay(&cg, JOURNAL_PROBE);     /* queued writes first */
        if (implicit && !config_auto_sync(cg.root)) {
            if (json) printf("{\"skipped\":\"auto-sync is off\"}\n");
            cg_close(&cg);
            return 0;
        }
        progress_request(!json && !implicit && !o.background);
        rc = cg_index_ex(&cg, &si, &o, &st);
        if (json) {
            StrBuf jb; sb_init(&jb);
            index_stats_json(&st, o.npaths > 0, &jb);
            puts(jb.p);
            sb_free(&jb);
        }
        if (rc != 0 && st.busy) {
            if (!json) cg_busy_report("The sync");
            rc = CG_EXIT_BUSY;
        }
    } else if (strcmp(cmd, "search") == 0) {
        int limit = atoi(opt(&argc, argv, "-n", "20"));
        const char *kind = opt(&argc, argv, "--kind", NULL);
        const char *name = opt(&argc, argv, "--name", NULL);
        sem_search_filter_set(&cg, kind, name);
        if (argc < 3) { help_usage("search"); rc = 1; }
        else rc = cmd_search(&cg, argv[2], limit > 0 ? limit : 20, json);
        sem_search_filter_set(&cg, NULL, NULL);
    } else if (strcmp(cmd, "grep") == 0) {      /* codify-v15 1.1 */
        GrepOpts go;
        memset(&go, 0, sizeof go);
        go.regex = flag(&argc, argv, "-E") | flag(&argc, argv, "--regex");
        go.icase = flag(&argc, argv, "-i");
        go.no_tests = flag(&argc, argv, "--no-tests");
        go.files_only = flag(&argc, argv, "--files");
        go.count_only = flag(&argc, argv, "--count");
        go.lang = opt(&argc, argv, "--lang", NULL);
        go.symbol = opt(&argc, argv, "--symbol", NULL);
        go.kind = opt(&argc, argv, "--kind", NULL);
        go.context = atoi(opt(&argc, argv, "-C", "0"));
        go.limit = atoi(opt(&argc, argv, "-n", "50"));
        go.budget = atoi(opt(&argc, argv, "--budget", "4000"));
        const char *pg;
        while (go.npaths < GREP_MAX_PATHS &&
               (pg = opt(&argc, argv, "--path", NULL)))
            go.paths[go.npaths++] = pg;
        if (argc < 3) { help_usage("grep"); rc = 1; }
        else {
            go.pattern = argv[2];
            index_fresh(&cg, &si);              /* hits are read as they are */
            rc = cmd_grep(&cg, &si, &go, json);
        }
    } else if (strcmp(cmd, "symbol") == 0) {
        if (argc < 3) { help_usage("symbol"); rc = 1; }
        else rc = cmd_symbol(&cg, argv[2], json);
    } else if (strcmp(cmd, "impact") == 0) {
        int depth = atoi(opt(&argc, argv, "-d", "3"));
        int budget = atoi(opt(&argc, argv, "--budget", "8000"));
        if (json && requested_budget > 0)
            budget = answer_health_query_budget(budget);
        if (argc < 3) { help_usage("impact"); rc = 1; }
        else rc = cmd_impact(&cg, argv[2], depth > 0 ? depth : 3,
                             budget > 0 ? budget : 8000, json);
    } else if (strcmp(cmd, "flow") == 0) {
        SemFlowLimits lim = {
            .depth = atoi(opt(&argc, argv, "--depth", "3")),
            .nodes = atoi(opt(&argc, argv, "--max-nodes", "64")),
            .edges = atoi(opt(&argc, argv, "--max-edges", "128")),
            .time_ms = atoi(opt(&argc, argv, "--max-ms", "200")),
            .output_bytes = atoi(opt(&argc, argv, "--max-output", "16000")),
        };
        if (argc < 4) { help_usage("flow"); rc = 1; }
        else rc = sem_flow_query(&cg, argv[2], argv[3],
                                 argc > 4 ? argv[4] : NULL, lim, json);
    } else if (strcmp(cmd, "context") == 0) {
        int budget = atoi(opt(&argc, argv, "--budget", "4000"));
        if (json && requested_budget > 0)
            budget = answer_health_query_budget(budget);
        int limit = atoi(opt(&argc, argv, "-n", "8"));
        const char *kind = opt(&argc, argv, "--kind", NULL);
        const char *name = opt(&argc, argv, "--name", NULL);
        sem_search_filter_set(&cg, kind, name);
        if (argc < 3) { help_usage("context"); rc = 1; }
        else rc = cmd_context(&cg, argv[2], budget > 0 ? budget : 4000,
                              limit > 0 ? limit : 8, json);
        sem_search_filter_set(&cg, NULL, NULL);
    } else if (strcmp(cmd, "show") == 0) {
        bool full = flag(&argc, argv, "--full");
        if (argc < 3) { help_usage("show");
                        rc = 1; }
        else rc = cmd_show(&cg, argv[2], full, json);
    } else if (strcmp(cmd, "test-impact") == 0) {
        rc = cmd_test_impact(&cg, argc >= 3 ? argv[2] : NULL, json);
    } else if (strcmp(cmd, "why") == 0) {
        if (argc < 3) { help_usage("why"); rc = 1; }
        else rc = cmd_why(&cg, argv[2], json);
    } else if (strcmp(cmd, "inspect") == 0) {
        int limit = atoi(opt(&argc, argv, "-n", "20"));
        const char *path = opt(&argc, argv, "--path", NULL);
        if (argc < 3) { help_usage("inspect"); rc = 1; }
        else if (strcmp(argv[2], "hierarchy") == 0) {
            if (argc < 4) { help_usage("inspect hierarchy"); rc = 1; }
            else {
                index_fresh(&cg, &si);
                rc = cmd_sem_hierarchy(&cg, argv[3], limit, json);
            }
        } else if (strcmp(argv[2], "unused") == 0) {
            index_fresh(&cg, &si);
            rc = cmd_sem_unreferenced(&cg, path, limit, json);
        } else { help_usage("inspect"); rc = 1; }
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
    } else if (strcmp(cmd, "files") == 0) {
        rc = cmd_files(&cg, argc - 1, argv + 1, json);
    } else if (strcmp(cmd, "watch") == 0) {
        int deb = atoi(opt(&argc, argv, "--debounce", "300"));
        bool fleet = flag(&argc, argv, "--fleet");
        rc = fleet ? watch_fleet(&cg, &si, deb > 0 ? deb : 300)
                   : cmd_watch(&cg, &si, deb > 0 ? deb : 300);
    } else if (strcmp(cmd, "brief") == 0) {
        rc = cmd_brief(&cg, json);
    } else if (strcmp(cmd, "fleet") == 0) {
        rc = cmd_fleet(&cg, argc, argv, json);
    } else if (strcmp(cmd, "branches") == 0) {
        rc = cmd_branches(&cg, argc, argv, json);
    } else if (strcmp(cmd, "review") == 0) {
        index_fresh(&cg, &si);                  /* review needs a fresh graph */
        rc = cmd_review(&cg, json);
    } else if (strcmp(cmd, "guard") == 0) {
        bool strict = flag(&argc, argv, "--strict");
        rc = cmd_guard(&cg, argc - 2, argv + 2, json, strict);
    } else if (strcmp(cmd, "hook") == 0) {
        if (argc >= 3 && strcmp(argv[2], "install") == 0)
            rc = cmd_hook_install(&cg);
        else if (argc >= 3 && strcmp(argv[2], "post-edit") == 0)
            rc = cmd_hook_post_edit(&cg, &si, json);
        else if (argc >= 3 && strcmp(argv[2], "event") == 0)
            rc = cmd_hook_event(&cg, opt(&argc, argv, "--host", "claude"),
                                json);
        else if (argc >= 3 && strcmp(argv[2], "pre-bash") == 0)
            rc = cmd_hook_pre_bash(&cg, json);
        else {          /* hooks never fail the host: drain, note, exit 0 */
            /* A host pipes its payload and closes; a shell (an agent's
             * tool, a terminal) hands over a stdin that never closes, so
             * the drain reads only what arrives within a short wait. */
            char drain[4096];
            struct pollfd pfd = { .fd = STDIN_FILENO, .events = POLLIN };
            while (!isatty(STDIN_FILENO) && poll(&pfd, 1, 200) > 0) {
                ssize_t n = read(STDIN_FILENO, drain, sizeof drain);
                if (n <= 0) break;
            }
            help_usage("hook");
            rc = 0;
        }
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
            help_usage("commit");
            rc = 1;
        } else if (task && !tag) {
            fprintf(stderr,
                    "hyperfide: --task %s is not an in_progress task of the active spec\n",
                    task);
            rc = 1;
        }
        else {
            IndexStats st;
            if (config_auto_sync(cg.root))
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
        rc = answer_health_status(&cg, json);
    } else if (strcmp(cmd, "state") == 0) {
        rc = cmd_state(&cg, json);
    } else if (strcmp(cmd, "event") == 0) {
        rc = cmd_event(&cg, argc - 2, argv + 2, json);
    } else if (strcmp(cmd, "events") == 0) {
        rc = cmd_events(&cg, argc - 2, argv + 2, json);
    } else if (strcmp(cmd, "drift") == 0) {
        rc = cmd_drift(&cg, argc - 2, argv + 2, json);
    } else if (strcmp(cmd, "work") == 0) {
        rc = cmd_work(&cg, argc - 2, argv + 2, json);
    } else if (strcmp(cmd, "diff") == 0) {
        rc = cmd_diff(&cg, argc >= 3 ? argv[2] : NULL,
                      argc >= 4 ? argv[3] : NULL);
    } else if (strcmp(cmd, "checkout") == 0) {
        bool force = flag(&argc, argv, "--force");
        if (argc < 3) { help_usage("checkout"); rc = 1; }
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
            help_usage("remember");
            rc = 1;
        } else {
            char *dflt = task ? NULL : spec_active_tag();
            rc = cmd_remember_ex(&cg, argv[2], type, task ? task : dflt,
                                 symbols, files,
                                 supersedes ? atol(supersedes) : 0, json);
            free(dflt);
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
        } else if (argc >= 3 && strcmp(argv[2], "classify") == 0) {
            int limit = atoi(opt(&argc, argv, "-n", "0"));
            rc = cmd_memory_classify(&cg, argc >= 4 ? argv[3] : NULL, limit,
                                     json);
        } else if (argc >= 3 && strcmp(argv[2], "export") == 0) {
            MemExportOpts o = {0};
            o.outfile = opt(&argc, argv, "-o", NULL);
            o.task = opt(&argc, argv, "--task", NULL);
            o.type = opt(&argc, argv, "--type", NULL);
            o.branch = scope_branch;
            o.since_days = atoi(opt(&argc, argv, "--since", "0"));
            rc = cmd_memory_export(&cg, &o, json);
        } else if (argc >= 3 && strcmp(argv[2], "import") == 0) {
            MemImportOpts o = {0};
            o.from = opt(&argc, argv, "--from", NULL);
            o.retask = opt(&argc, argv, "--retask", NULL);
            o.dry_run = flag(&argc, argv, "--dry-run");
            o.keep_branch = flag(&argc, argv, "--keep-branch");
            o.file = argc >= 4 ? argv[3] : NULL;
            rc = cmd_memory_import(&cg, &o, json);
        } else {
            help_usage("memory");
            rc = 1;
        }
    } else if (strcmp(cmd, "skills") == 0) {
        rc = cmd_skills(&cg, argc, argv, json);
    } else if (strcmp(cmd, "forget") == 0) {
        if (argc < 3) { help_usage("forget"); rc = 1; }
        else rc = cmd_forget(&cg, argv[2]);
    } else if (strcmp(cmd, "lsp") == 0) {
        rc = cmd_lsp(&cg, &si);
    } else if (strcmp(cmd, "mcp") == 0) {
        rc = cmd_mcp(&cg, &si);
    } else if (strcmp(cmd, "projection") == 0) {     /* codify-v15 3.1 */
        rc = cmd_projection(&cg, &si, argc - 2, argv + 2, scope_branch, json);
    } else if (strcmp(cmd, "serve") == 0) {
        rc = cmd_serve(&cg, &si);
    } else if (strcmp(cmd, "tool") == 0) {
        rc = cmd_tool(&cg, &si, argc - 2, argv + 2, json);
    } else if (strcmp(cmd, "mcp-install") == 0) {
        rc = cmd_mcp_install(&cg);
    } else if (strcmp(cmd, "integrate") == 0) {
        integrate_skip_plugin(flag(&argc, argv, "--no-plugin"));
        rc = cmd_integrate(&cg, argc >= 3 ? argv[2] : "detect", json, false);
    } else if (strcmp(cmd, "changelog") == 0) {
        ChangelogOpts o = {0};
        o.limit = atoi(opt(&argc, argv, "-n", "50"));
        if (o.limit <= 0) o.limit = 50;
        o.outfile = opt(&argc, argv, "-o", NULL);
        o.tag = opt(&argc, argv, "--tag", NULL);
        o.unreleased = flag(&argc, argv, "--unreleased");
        bool snaps = flag(&argc, argv, "--snapshots");
        if (flag(&argc, argv, "--summarize")) o.summarize = 1;
        if (flag(&argc, argv, "--no-summarize")) o.summarize = -1;
        /* git history when there is one, the snapshot chain otherwise */
        rc = !snaps && git_available(&cg) ? cmd_changelog_git(&cg, &o)
                                          : cmd_changelog(&cg, o.limit, o.outfile);
    } else if (strcmp(cmd, "recap") == 0) {
        RecapOpts o = {0};
        o.sessions = atoi(opt(&argc, argv, "--sessions", "6"));
        o.since_days = atoi(opt(&argc, argv, "--since", "21"));
        o.budget = atol(opt(&argc, argv, "--budget", "24000"));
        o.outfile = opt(&argc, argv, "-o", NULL);
        o.agents = opt(&argc, argv, "--agents", NULL);
        o.decided_only = flag(&argc, argv, "--decided");
        o.facts_only = flag(&argc, argv, "--facts");
        o.json = json;
        rc = cmd_recap(&cg, &o);
    } else if (strcmp(cmd, "agentmd") == 0) {
        bool write_files = flag(&argc, argv, "--write");
        index_fresh(&cg, &si);                  /* fresh graph first */
        rc = cmd_agentmd(&cg, write_files);
    } else if (strcmp(cmd, "codemap") == 0) {
        CodemapOpts o = {0};
        o.outfile = opt(&argc, argv, "-o", NULL);
        const char *budget = opt(&argc, argv, "--budget", NULL);
        o.force = flag(&argc, argv, "--force");
        o.check = flag(&argc, argv, "--check");
        o.json = json;
        if (budget) {
            o.budget = atoi(budget);
            if (o.budget <= 0) o.budget = -1;   /* cmd_codemap rejects it */
        }
        index_fresh(&cg, &si);                  /* fresh graph first */
        rc = cmd_codemap(&cg, &o);
    } else if (strcmp(cmd, "docs") == 0) {
        rc = cmd_docs(&cg, argc - 2, argv + 2, json);
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
        const char *budget = opt(&argc, argv, "--budget", NULL);
        if (budget) setenv("CG_PACKET_BUDGET", budget, 1);
        if (prompt) index_fresh(&cg, &si);    /* a briefing shows code as it is */
        rc = cmd_resume(&cg, task, json, prompt);
    } else {
        fprintf(stderr, "hyperfide: unknown command '%s' (try `hyperfide help`)\n", cmd);
        help_suggest(cmd);
        rc = 1;
    }
    if (health_answer) answer_health_capture_end(&answer_capture, &cg);
    cg_close(&cg);
    return rc;
}
