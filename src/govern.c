/*
 * Governance: the commands that make Codify present at every step rather than
 * only at the bookends.
 *
 *   cg check   one exit code for CI: render staleness, lint, task evidence
 *   cg brief   everything a session needs to start, in one call
 *   cg review  the change paired with the acceptance criteria it claims
 *   cg guard   edits that fall outside the active task's declared scope
 *
 * Everything here advises by default. `cg guard` only fails the process with
 * --strict, so wiring it into a hook can never break a workflow that was
 * working before.
 */
#include "cg.h"
#include <unistd.h>
#include <sys/stat.h>
#include <fnmatch.h>

/* run a cg subcommand in-process and capture its stdout */
static int run_capture(char **out, int (*fn)(void *), void *ctx) {
    return cg_capture(out, fn, ctx);
}

typedef struct { int argc; char **argv; bool json; } SpecCall;

static int call_spec(void *v) {
    SpecCall *c = v;
    fflush(stderr);
    int saved = dup(2);
    dup2(1, 2);                       /* refusals go to stderr; keep them */
    int rc = cmd_spec(c->argc, c->argv, c->json);
    fflush(stdout);
    fflush(stderr);
    dup2(saved, 2);
    close(saved);
    return rc;
}

static int spec_sub(char **out, bool json, int argc, ...) {
    va_list ap;
    char *argv[8];
    va_start(ap, argc);
    for (int i = 0; i < argc && i < 8; i++) argv[i] = va_arg(ap, char *);
    va_end(ap);
    SpecCall c = { argc, argv, json };
    return run_capture(out, call_spec, &c);
}

static bool has_spec_repo(const char *root) {
    char p[4600];
    struct stat st;
    snprintf(p, sizeof p, "%s/spec/workflow.kvx", root);
    return stat(p, &st) == 0;
}

/* One command for CI. Everything Codify can prove about the repository,
 * gated behind a single exit code so a pipeline needs exactly one step. */
int cmd_check(Cg *cg, bool json, bool strict)
{
    int failures = 0, warnings = 0;
    StrBuf rep; sb_init(&rep);

    if (has_spec_repo(cg->root)) {
        char *out = NULL;
        int rc = spec_sub(&out, false, 2, "render", "--check");
        if (rc != 0) {
            failures++;
            sb_puts(&rep, "  FAIL  spec render is stale — run `cg spec render`\n");
        } else {
            sb_puts(&rep, "  ok    spec render is current\n");
        }
        free(out);

        out = NULL;
        rc = spec_sub(&out, false, 1, "lint");
        if (rc == 2) {
            failures++;
            sb_puts(&rep, "  FAIL  spec lint found errors:\n");
            if (out) sb_printf(&rep, "%s", out);
        } else if (out && strstr(out, "warn")) {
            warnings++;
            sb_puts(&rep, "  warn  spec lint found warnings:\n");
            sb_printf(&rep, "%s", out);
        } else {
            sb_puts(&rep, "  ok    spec lint is clean\n");
        }
        free(out);

        /* every task claimed done must still hold its evidence */
        out = NULL;
        spec_sub(&out, true, 1, "trace");
        if (out) {
            int bad = 0;
            for (const char *p = out; (p = strstr(p, "\"ok\":false")); p++) bad++;
            if (bad) {
                failures++;
                sb_printf(&rep, "  FAIL  %d task check(s) no longer hold — "
                          "run `cg spec trace` for detail\n", bad);
            } else {
                sb_puts(&rep, "  ok    task evidence holds\n");
            }
        }
        free(out);
        /* In parallel mode a lease is what keeps two agents off the same
         * files. An expired lease on a task still in_progress means somebody
         * died holding it, and the wave is quietly stuck. */
        sqlite3_stmt *lq = cg_prep(cg,
            "SELECT COUNT(*) FROM leases WHERE expires <= strftime('%s','now')");
        int expired = 0;
        if (sqlite3_step(lq) == SQLITE_ROW) expired = sqlite3_column_int(lq, 0);
        sqlite3_finalize(lq);
        if (expired) {
            warnings++;
            sb_printf(&rep, "  warn  %d expired task lease(s) — run "
                      "`cg spec release <id>` or re-claim\n", expired);
        }
        sqlite3_stmt *dq = cg_prep(cg,
            "SELECT l.task, l.agent FROM leases l JOIN leases o "
            "ON o.task<>l.task AND o.touches=l.touches "
            "WHERE l.touches<>'' AND l.expires > strftime('%s','now') LIMIT 5");
        int clash = 0;
        while (sqlite3_step(dq) == SQLITE_ROW) {
            if (!clash++) {
                failures++;
                sb_puts(&rep, "  FAIL  overlapping live claims:\n");
            }
            sb_printf(&rep, "        %s held by %s\n",
                      (const char *)sqlite3_column_text(dq, 0),
                      (const char *)sqlite3_column_text(dq, 1));
        }
        sqlite3_finalize(dq);
        if (!expired && !clash)
            sb_puts(&rep, "  ok    task claims are consistent\n");
    } else {
        sb_puts(&rep, "  skip  no spec/workflow.kvx — nothing to gate\n");
    }

    /* uncommitted work is a warning, not a failure: CI may legitimately run
     * against a dirty tree, but an agent should know before it reports done */
    {
        char **paths = NULL;
        int np = vcs_changed_paths(cg, NULL, &paths);
        if (np > 0) {
            warnings++;
            sb_printf(&rep, "  warn  %d uncommitted path(s)\n", np);
        } else {
            sb_puts(&rep, "  ok    working tree matches the last snapshot\n");
        }
        for (int i = 0; i < np; i++) free(paths[i]);
        free(paths);
    }

    if (json) {
        printf("{\"failures\":%d,\"warnings\":%d,\"report\":", failures,
               warnings);
        StrBuf j; sb_init(&j);
        sb_json_str(&j, rep.p ? rep.p : "");
        fputs(j.p, stdout);
        sb_free(&j);
        printf("}\n");
    } else {
        printf("cg check — %s\n", cg->root);
        fputs(rep.p, stdout);
        printf("%d failure(s), %d warning(s)\n", failures, warnings);
    }
    sb_free(&rep);
    if (failures) return 1;
    return (strict && warnings) ? 1 : 0;
}

/* ---------------- brief ---------------- */

/* Extract the active or next task object from `spec status --json`, so the
 * governance commands read the same data the agent sees. */
static char *active_task_json(bool *is_current) {
    char *out = NULL;
    spec_sub(&out, true, 1, "status");
    if (!out) return NULL;
    char *cur = json_get_object(out, "current");
    if (cur) { if (is_current) *is_current = true; free(out); return cur; }
    char *next = json_get_object(out, "next");
    if (is_current) *is_current = false;
    free(out);
    return next;
}

/* Everything a session needs before its first real decision, in one call.
 * Without this an agent spends four or five round trips reassembling state
 * it had yesterday. */
int cmd_brief(Cg *cg, bool json)
{
    StrBuf b; sb_init(&b);
    bool have_spec = has_spec_repo(cg->root);
    bool is_current = false;
    char *task = have_spec ? active_task_json(&is_current) : NULL;

    char **paths = NULL;
    int np = vcs_changed_paths(cg, NULL, &paths);

    Memory *mem = NULL;
    int nm = memory_query(cg, NULL, NULL, NULL, 6, &mem);

    if (json) {
        sb_puts(&b, "{\"root\":");
        sb_json_str(&b, cg->root);
        sb_printf(&b, ",\"has_spec\":%s", have_spec ? "true" : "false");
        sb_printf(&b, ",\"task_is_in_progress\":%s",
                  is_current ? "true" : "false");
        sb_puts(&b, ",\"task\":");
        sb_puts(&b, task ? task : "null");
        sb_puts(&b, ",\"uncommitted\":[");
        for (int i = 0; i < np && i < 50; i++) {
            if (i) sb_putc(&b, ',');
            sb_json_str(&b, paths[i]);
        }
        sb_printf(&b, "],\"uncommitted_count\":%d", np);
        sb_puts(&b, ",\"memories\":[");
        for (int i = 0; i < nm; i++) {
            if (i) sb_putc(&b, ',');
            memory_json(&mem[i], &b);
        }
        sb_puts(&b, "]}\n");
    } else {
        sb_printf(&b, "project: %s\n", cg->root);
        if (!have_spec) {
            sb_puts(&b, "spec: none — `cg spec new <feature>` to start one\n");
        } else if (task) {
            char *id = json_get_string(task, "id");
            char *ti = json_get_string(task, "title");
            sb_printf(&b, "task: %s — %s  (%s)\n", id ? id : "?",
                      ti ? ti : "?", is_current ? "in progress" : "next up");
            free(id); free(ti);
            char *vc = json_get_string(task, "verify_cmd");
            if (vc) { sb_printf(&b, "verify: %s\n", vc); free(vc); }
        } else {
            sb_puts(&b, "task: none eligible\n");
        }
        if (np) {
            sb_printf(&b, "uncommitted: %d path(s)\n", np);
            for (int i = 0; i < np && i < 8; i++)
                sb_printf(&b, "  %s\n", paths[i]);
            if (np > 8) sb_printf(&b, "  ... and %d more\n", np - 8);
        } else {
            sb_puts(&b, "uncommitted: clean\n");
        }
        if (nm) {
            sb_puts(&b, "recent decisions:\n");
            for (int i = 0; i < nm; i++)
                sb_printf(&b, "  [%s] %s\n", mem[i].type, mem[i].body);
        }
    }
    fputs(b.p, stdout);
    sb_free(&b);
    for (int i = 0; i < np; i++) free(paths[i]);
    free(paths);
    memory_free(mem, nm);
    free(task);
    return 0;
}

/* ---------------- guard ---------------- */

/* Does `path` fall inside the active task's declared touches? */
static bool path_in_scope(const char *task_json, const char *path) {
    char *arr = json_get_raw(task_json, "touches");
    if (!arr) return true;                  /* nothing declared: nothing to say */
    bool any = false, hit = false;
    for (const char *p = arr; *p; p++) {
        if (*p != '"') continue;
        const char *s = ++p;
        while (*p && *p != '"') p++;
        char pat[1024];
        snprintf(pat, sizeof pat, "%.*s", (int)(p - s), s);
        if (!pat[0]) continue;
        any = true;
        if (fnmatch(pat, path, 0) == 0 || strcmp(pat, path) == 0) {
            hit = true;
            break;
        }
        /* a declared directory covers everything beneath it */
        size_t pl = strlen(pat);
        if (strncmp(path, pat, pl) == 0 && (path[pl] == '/' || path[pl] == 0)) {
            hit = true;
            break;
        }
    }
    free(arr);
    return any ? hit : true;
}

/* Scope drift is the failure mode nobody notices until review. Given paths
 * (or the working tree), report the ones the active task never claimed.
 * Advisory by default so this is safe to wire into a hook. */
int cmd_guard(Cg *cg, int npath, char **pathv, bool json, bool strict)
{
    bool is_current = false;
    char *task = has_spec_repo(cg->root) ? active_task_json(&is_current) : NULL;
    if (!task || !is_current) {
        if (json) printf("{\"guarded\":false,\"reason\":\"no task in progress\","
                         "\"out_of_scope\":[]}\n");
        else printf("guard: no task in progress — nothing to measure against\n");
        free(task);
        return 0;
    }
    char *id = json_get_string(task, "id");

    char **owned = NULL;
    int nown = 0;
    if (npath == 0) {
        nown = vcs_changed_paths(cg, NULL, &owned);
        pathv = owned;
        npath = nown;
    }

    StrBuf b; sb_init(&b);
    int bad = 0;
    for (int i = 0; i < npath; i++) {
        const char *rel = pathv[i];
        size_t rl = strlen(cg->root);       /* accept absolute paths too */
        if (strncmp(rel, cg->root, rl) == 0 && rel[rl] == '/') rel += rl + 1;
        if (path_in_scope(task, rel)) continue;
        if (json) {
            if (bad) sb_putc(&b, ',');
            sb_json_str(&b, rel);
        } else {
            sb_printf(&b, "  %s\n", rel);
        }
        bad++;
    }

    if (json) {
        printf("{\"guarded\":true,\"task\":");
        StrBuf j; sb_init(&j);
        sb_json_str(&j, id ? id : "");
        fputs(j.p, stdout);
        sb_free(&j);
        printf(",\"out_of_scope\":[%s],\"count\":%d,\"strict\":%s}\n",
               b.p ? b.p : "", bad, strict ? "true" : "false");
    } else if (bad) {
        printf("guard: %d path(s) outside the scope task %s declared:\n", bad,
               id ? id : "?");
        fputs(b.p, stdout);
        printf("%s\n", strict
               ? "strict mode: failing."
               : "advisory only — declare them with `cg spec add ... --touches` "
                 "or use --strict to enforce.");
    } else {
        printf("guard: every change is inside task %s's declared scope\n",
               id ? id : "?");
    }
    sb_free(&b);
    for (int i = 0; i < nown; i++) free(owned[i]);
    free(owned);
    free(id);
    free(task);
    return (strict && bad) ? 1 : 0;
}

/* ---------------- review ---------------- */

/* The missing step between "implemented" and "done": the change, paired with
 * the criteria it claims to satisfy and the callers it puts at risk. One call
 * gives a reviewing agent everything it needs without reading the diff twice. */
int cmd_review(Cg *cg, bool json)
{
    bool is_current = false;
    char *task = has_spec_repo(cg->root) ? active_task_json(&is_current) : NULL;
    char **paths = NULL;
    int np = vcs_changed_paths(cg, NULL, &paths);

    StrBuf b; sb_init(&b);
    if (json) {
        sb_puts(&b, "{\"task\":");
        sb_puts(&b, task ? task : "null");
        sb_puts(&b, ",\"changed\":[");
    } else {
        char *id = task ? json_get_string(task, "id") : NULL;
        char *ti = task ? json_get_string(task, "title") : NULL;
        if (id) sb_printf(&b, "review of %s — %s\n", id, ti ? ti : "");
        else    sb_puts(&b, "review (no task in progress)\n");
        free(id); free(ti);
        sb_printf(&b, "\nchanged paths (%d):\n", np);
    }

    int nsym = 0, nrisk = 0;
    StrBuf risk; sb_init(&risk);
    for (int i = 0; i < np; i++) {
        if (json) {
            if (i) sb_putc(&b, ',');
            sb_json_str(&b, paths[i]);
        } else {
            sb_printf(&b, "  %s%s\n", paths[i],
                      graph_path_is_test(paths[i]) ? "  (test)" : "");
        }
    }
    if (json) sb_puts(&b, "],\"symbols\":[");
    else      sb_puts(&b, "\nsymbols you changed:\n");

    for (int i = 0; i < np; i++) {
        sqlite3_stmt *st = cg_prep(cg,
            "SELECT s.name,s.kind,s.line FROM symbols s "
            "JOIN files f ON f.id=s.file_id WHERE f.path=? ORDER BY s.line");
        sqlite3_bind_text(st, 1, paths[i], -1, SQLITE_STATIC);
        while (sqlite3_step(st) == SQLITE_ROW) {
            const char *nm = (const char *)sqlite3_column_text(st, 0);
            const char *kd = (const char *)sqlite3_column_text(st, 1);
            int line = sqlite3_column_int(st, 2);
            /* header guards and constants are not what a review is about */
            if (kd && (strcmp(kd, "macro") == 0 || strcmp(kd, "typedef") == 0))
                continue;
            char sym[256];
            snprintf(sym, sizeof sym, "%s", nm);

            /* callers living outside the changed set are the blast radius */
            sqlite3_stmt *cq = cg_prep(cg,
                "SELECT DISTINCT c.name, cf.path FROM refs r "
                "JOIN symbols c ON c.id=r.sym_id "
                "JOIN files cf ON cf.id=c.file_id "
                "WHERE r.name=? AND c.name<>? LIMIT 6");
            sqlite3_bind_text(cq, 1, sym, -1, SQLITE_STATIC);
            sqlite3_bind_text(cq, 2, sym, -1, SQLITE_STATIC);
            int ext = 0;
            while (sqlite3_step(cq) == SQLITE_ROW) {
                const char *cp = (const char *)sqlite3_column_text(cq, 1);
                bool internal = false;
                for (int k = 0; k < np; k++)
                    if (strcmp(cp, paths[k]) == 0) { internal = true; break; }
                if (internal) continue;
                if (!json && ext == 0)
                    sb_printf(&risk, "  %s is called from:\n", sym);
                if (!json)
                    sb_printf(&risk, "      %s (%s)\n",
                              (const char *)sqlite3_column_text(cq, 0), cp);
                ext++;
                nrisk++;
            }
            sqlite3_finalize(cq);

            if (json) {
                if (nsym) sb_putc(&b, ',');
                sb_puts(&b, "{\"name\":");   sb_json_str(&b, sym);
                sb_puts(&b, ",\"kind\":");   sb_json_str(&b, kd ? kd : "");
                sb_puts(&b, ",\"path\":");   sb_json_str(&b, paths[i]);
                sb_printf(&b, ",\"line\":%d,\"external_callers\":%d}", line,
                          ext);
            } else {
                sb_printf(&b, "  %-28s %s:%d%s\n", sym, paths[i], line,
                          ext ? "  ← has external callers" : "");
            }
            nsym++;
        }
        sqlite3_finalize(st);
    }

    if (json) {
        sb_printf(&b, "],\"external_caller_count\":%d}\n", nrisk);
    } else {
        if (!nsym) sb_puts(&b, "  (none)\n");
        if (nrisk) {
            sb_puts(&b, "\nat risk:\n");
            sb_puts(&b, risk.p);
        }
        if (task) {
            char *acs = json_get_raw(task, "acceptance_criteria");
            if (acs) {
                sb_puts(&b, "\nacceptance criteria to satisfy:\n");
                for (const char *p = acs; (p = strstr(p, "\"text\":")); ) {
                    p += 7;
                    while (*p && *p != '"') p++;
                    if (!*p) break;
                    const char *s2 = ++p;
                    while (*p && !(*p == '"' && p[-1] != '\\')) p++;
                    sb_printf(&b, "  - %.*s\n", (int)(p - s2), s2);
                }
                free(acs);
            }
        }
    }
    fputs(b.p, stdout);
    sb_free(&b);
    sb_free(&risk);
    for (int i = 0; i < np; i++) free(paths[i]);
    free(paths);
    free(task);
    return 0;
}

/* ---------------- hook install ---------------- */

/* Governance only becomes ambient when nobody has to invoke it. These hooks
 * keep the graph fresh after every agent edit and surface scope drift at the
 * moment it happens — advisory, so a misconfigured hook can never wedge a
 * workflow that worked before. */
static int cmd_hook_install_git(Cg *cg, const char *bin);

static int write_exec(const char *path, const char *body) {
    if (write_entire_file(path, body, strlen(body)) != 0) return -1;
    return chmod(path, 0755);
}

static const char *CLAUDE_SETTINGS_TEMPLATE =
"{\n"
"  \"hooks\": {\n"
"    \"PostToolUse\": [\n"
"      {\n"
"        \"matcher\": \"Edit|Write|MultiEdit|NotebookEdit\",\n"
"        \"hooks\": [\n"
"          { \"type\": \"command\", \"command\": \"%s sync\" },\n"
"          { \"type\": \"command\", \"command\": \"%s guard\" }\n"
"        ]\n"
"      }\n"
"    ]\n"
"  }\n"
"}\n";

int cmd_hook_install(Cg *cg)
{
    char bin[4096];
    ssize_t n = readlink("/proc/self/exe", bin, sizeof bin - 1);
    if (n > 0) bin[n] = 0; else snprintf(bin, sizeof bin, "cg");

    printf("installing Codify hooks in %s:\n", cg->root);

    char dir[4600], path[4700];
    snprintf(dir, sizeof dir, "%s/.claude", cg->root);
    snprintf(path, sizeof path, "%s/settings.json", dir);
    char *existing = read_entire_file(path, NULL);
    if (existing && strstr(existing, "\"hooks\"")) {
        printf("  .  claude-code  %s already defines hooks - add manually:\n"
               "        PostToolUse Edit|Write -> %s sync, %s guard\n",
               path, bin, bin);
    } else if (existing) {
        printf("  !  claude-code  %s has no hooks block - add manually:\n"
               "        PostToolUse Edit|Write -> %s sync\n", path, bin);
    } else {
        mkdirs(dir);
        StrBuf b; sb_init(&b);
        sb_printf(&b, CLAUDE_SETTINGS_TEMPLATE, bin, bin);
        if (write_entire_file(path, b.p, b.len) == 0)
            printf("  ok claude-code  %s (created)\n", path);
        else
            printf("  XX claude-code  cannot write %s\n", path);
        sb_free(&b);
    }
    free(existing);
    return cmd_hook_install_git(cg, bin);
}

/* Git hooks: refresh the graph after a commit lands, and report Codify's
 * findings before one does. The pre-commit gate ends in `|| true` so it can
 * never block a commit until the user decides it should. */
static int cmd_hook_install_git(Cg *cg, const char *bin)
{
    char dir[4600], path[4700];
    struct stat st;
    snprintf(dir, sizeof dir, "%s/.git/hooks", cg->root);
    if (stat(dir, &st) != 0) {
        printf("  .  git          no .git/hooks here - skipped\n");
    } else {
        StrBuf b; sb_init(&b);
        sb_printf(&b,
            "#!/bin/sh\n"
            "# installed by `cg hook install` - keeps the Codify graph and\n"
            "# git provenance current after every commit.\n"
            "%s sync >/dev/null 2>&1 || true\n"
            "%s git-sync -n 200 >/dev/null 2>&1 || true\n", bin, bin);
        snprintf(path, sizeof path, "%s/post-commit", dir);
        if (stat(path, &st) == 0)
            printf("  .  git          %s exists - left alone\n", path);
        else if (write_exec(path, b.p) == 0)
            printf("  ok git          %s (created)\n", path);
        else
            printf("  XX git          cannot write %s\n", path);
        sb_free(&b);

        sb_init(&b);
        sb_printf(&b,
            "#!/bin/sh\n"
            "# installed by `cg hook install` - advisory Codify gate.\n"
            "# Reports problems and still allows the commit; drop the\n"
            "# `|| true` to make it blocking.\n"
            "%s check || true\n", bin);
        snprintf(path, sizeof path, "%s/pre-commit", dir);
        if (stat(path, &st) == 0)
            printf("  .  git          %s exists - left alone\n", path);
        else if (write_exec(path, b.p) == 0)
            printf("  ok git          %s (created)\n", path);
        else
            printf("  XX git          cannot write %s\n", path);
        sb_free(&b);
    }
    printf("\nhooks are advisory: `cg guard` reports scope drift without\n"
           "failing. Use `cg guard --strict` to enforce.\n");
    return 0;
}
