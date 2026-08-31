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
#include <time.h>
#include <ctype.h>

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

/* Do two space-joined touch-pattern lists share any pair of patterns that
 * could cover a common path? Delegates the per-pattern question to
 * spec_globs_overlap so glob-vs-glob near-misses are caught too. */
static bool lease_touches_overlap(const char *a, const char *b) {
    char abuf[2048], bbuf[2048];
    snprintf(abuf, sizeof abuf, "%s", a);
    char *sa;
    for (char *pa = strtok_r(abuf, " ", &sa); pa;
         pa = strtok_r(NULL, " ", &sa)) {
        snprintf(bbuf, sizeof bbuf, "%s", b);
        char *sb;
        for (char *pb = strtok_r(bbuf, " ", &sb); pb;
             pb = strtok_r(NULL, " ", &sb))
            if (spec_globs_overlap(pa, pb)) return true;
    }
    return false;
}

/* One command for CI. Everything Codify can prove about the repository,
 * gated behind a single exit code so a pipeline needs exactly one step.
 * Anchor drift is reported here but never gates: warn, don't block. */
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

        /* Every task claimed done must still hold its evidence. Pending
         * tasks legitimately lack theirs, so track which task's trace we are
         * inside and only count misses under done/implemented status. */
        out = NULL;
        spec_sub(&out, true, 1, "trace");
        if (out) {
            int bad = 0;
            char status[32] = "";
            for (const char *p = out; *p; p++) {
                if (strncmp(p, "\"status\":\"", 10) == 0) {
                    const char *s = p + 10;
                    const char *e = strchr(s, '"');
                    if (e) snprintf(status, sizeof status, "%.*s",
                                    (int)(e - s), s);
                } else if (strncmp(p, "\"found\":false", 13) == 0 ||
                           strncmp(p, "\"changed\":false", 15) == 0) {
                    if (strcmp(status, "done") == 0 ||
                        strcmp(status, "implemented") == 0)
                        bad++;
                }
            }
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
        /* Two live claims whose touch patterns can cover a common path are a
         * collision in waiting, whether the patterns are equal or merely
         * compatible globs — compare them pairwise instead of joining on
         * string equality. */
        sqlite3_stmt *dq = cg_prep(cg,
            "SELECT task, agent, ifnull(touches,'') FROM leases "
            "WHERE expires > strftime('%s','now') LIMIT 64");
        enum { MAXL = 64 };
        char *lt[MAXL], *la[MAXL], *lo[MAXL];
        bool flagged[MAXL] = { false };
        int nl = 0;
        while (nl < MAXL && sqlite3_step(dq) == SQLITE_ROW) {
            const char *t = (const char *)sqlite3_column_text(dq, 0);
            const char *a = (const char *)sqlite3_column_text(dq, 1);
            const char *o = (const char *)sqlite3_column_text(dq, 2);
            lt[nl] = xstrdup(t ? t : "");
            la[nl] = xstrdup(a ? a : "");
            lo[nl] = xstrdup(o ? o : "");
            nl++;
        }
        sqlite3_finalize(dq);
        int clash = 0;
        for (int i = 0; i < nl; i++) {
            for (int j = i + 1; j < nl; j++) {
                if (!lo[i][0] || !lo[j][0]) continue;
                if (!lease_touches_overlap(lo[i], lo[j])) continue;
                if (!clash++) {
                    failures++;
                    sb_puts(&rep, "  FAIL  overlapping live claims:\n");
                }
                if (!flagged[i]) {
                    flagged[i] = true;
                    sb_printf(&rep, "        %s held by %s\n", lt[i], la[i]);
                }
                if (!flagged[j]) {
                    flagged[j] = true;
                    sb_printf(&rep, "        %s held by %s\n", lt[j], la[j]);
                }
            }
        }
        for (int i = 0; i < nl; i++) { free(lt[i]); free(la[i]); free(lo[i]); }
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

    /* the intent layer degrades loudly: a stale anchor is a doc comment
     * outliving the code it describes — a warning, never a gate */
    int stale = anchor_stale(cg, NULL, NULL);
    if (stale) {
        warnings++;
        sb_printf(&rep, "  warn  %d stale anchor(s) — doc comments whose "
                  "code has moved on (cg anchors --stale)\n", stale);
    } else {
        sb_puts(&rep, "  ok    anchors current\n");
    }

    /* grounding, contract, and hygiene finding counts */
    int nfindings = 0;
    {
        char **paths = NULL;
        int np = vcs_changed_paths(cg, NULL, &paths);
        for (int i = 0; i < np; i++) {
            GroundFinding *gf = NULL;
            nfindings += ground_findings(cg, paths[i], &gf);
            ground_findings_free(gf, 0);
            ContractFinding *cf = NULL;
            nfindings += contract_findings(cg, paths[i], &cf);
            contract_findings_free(cf, 0);
            HygieneFinding *hf = NULL;
            nfindings += hygiene_findings(cg, paths[i], &hf);
            hygiene_findings_free(hf, 0);
            free(paths[i]);
        }
        free(paths);
    }
    if (nfindings) {
        warnings++;
        sb_printf(&rep, "  warn  %d finding(s) — grounding, contract, or hygiene "
                  "(cg guard for details)\n", nfindings);
    } else {
        sb_puts(&rep, "  ok    no grounding/contract/hygiene findings\n");
    }

    if (json) {
        printf("{\"failures\":%d,\"warnings\":%d,\"stale_anchors\":%d,"
               "\"findings\":%d,\"report\":", failures, warnings, stale,
               nfindings);
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

/* A briefing memory longer than a few lines is a document, not a reminder —
 * cap bodies at 400 bytes, cutting on a UTF-8 boundary. */
static void brief_cap_body(Memory *m) {
    if (!m->body || strlen(m->body) <= 400) return;
    size_t cut = 400;
    while (cut > 0 && (m->body[cut] & 0xC0) == 0x80) cut--;
    char *nb = xmalloc(cut + 4);
    memcpy(nb, m->body, cut);
    memcpy(nb + cut, "\xE2\x80\xA6", 4);          /* ellipsis + NUL */
    free(m->body);
    m->body = nb;
}

/* Memories scoped to the active task, then recent ones — deduplicated by id
 * and by identical body, capped at 6 total. Task context must outrank mere
 * recency or a busy repository buries the one note that matters. */
static int brief_memories(Cg *cg, const char *task_json, Memory **out) {
    Memory *mem = xmalloc(12 * sizeof *mem);
    int nm = 0;

    Memory *tmem = NULL;
    int ntm = 0;
    if (task_json) {
        char *tid = json_get_string(task_json, "id");
        if (tid) {
            char *tag = spec_resolve_task(tid, NULL);
            if (tag) ntm = spec_task_memories_tag(tag, &tmem);
            free(tag);
        }
        free(tid);
    }
    Memory *rmem = NULL;
    int nrm = memory_query(cg, NULL, NULL, NULL, 6, &rmem);

    for (int pass = 0; pass < 2; pass++) {
        Memory *src = pass ? rmem : tmem;
        int n = pass ? nrm : ntm;
        for (int i = 0; i < n; i++) {
            bool dup = nm >= 6;
            for (int k = 0; !dup && k < nm; k++)
                if (mem[k].id == src[i].id ||
                    (mem[k].body && src[i].body &&
                     strcmp(mem[k].body, src[i].body) == 0))
                    dup = true;
            if (dup) {
                memory_clear(&src[i]);
            } else {
                mem[nm] = src[i];             /* move; fields now owned here */
                brief_cap_body(&mem[nm]);
                nm++;
            }
        }
        free(src);
    }
    *out = mem;
    return nm;
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
    int nm = brief_memories(cg, task, &mem);

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
/* stale anchors filtered to the paths guard is looking at */
typedef struct {
    char **pathv;
    int npath;
    const char *root;
    StrBuf txt, js;
    int n;
} GuardStale;

static void guard_stale_cb(void *u, const char *path, int line,
                           const char *sym, int sym_line) {
    GuardStale *g = u;
    size_t rl = strlen(g->root);
    bool hit = false;
    for (int i = 0; i < g->npath && !hit; i++) {
        const char *rel = g->pathv[i];
        if (strncmp(rel, g->root, rl) == 0 && rel[rl] == '/') rel += rl + 1;
        hit = strcmp(rel, path) == 0;
    }
    if (!hit) return;
    sb_printf(&g->txt, "  %s:%d — doc for %s (line %d) predates this "
              "change\n", path, line, sym, sym_line);
    if (g->n) sb_putc(&g->js, ',');
    sb_puts(&g->js, "{\"path\":");
    sb_json_str(&g->js, path);
    sb_printf(&g->js, ",\"line\":%d,\"symbol\":", line);
    sb_json_str(&g->js, sym);
    sb_putc(&g->js, '}');
    g->n++;
}

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

    /* anchors this work made stale: advisory always, never part of the
     * exit code — the warn-dont-block rule is load-bearing here */
    GuardStale gs = { pathv, npath, cg->root, {0}, {0}, 0 };
    sb_init(&gs.txt);
    sb_init(&gs.js);
    anchor_stale(cg, guard_stale_cb, &gs);

    if (json) {
        printf("{\"guarded\":true,\"task\":");
        StrBuf j; sb_init(&j);
        sb_json_str(&j, id ? id : "");
        fputs(j.p, stdout);
        sb_free(&j);
        printf(",\"out_of_scope\":[%s],\"count\":%d,"
               "\"stale_anchors\":[%s],\"strict\":%s}\n",
               b.p ? b.p : "", bad, gs.js.p ? gs.js.p : "",
               strict ? "true" : "false");
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
    if (!json && gs.n) {
        printf("guard: %d anchor(s) went stale in this work (advisory):\n",
               gs.n);
        fputs(gs.txt.p, stdout);
    }
    /* grounding, contract, and hygiene findings for the changed paths */
    int nfindings = 0;
    for (int i = 0; i < npath; i++) {
        const char *rel = pathv[i];
        size_t rl2 = strlen(cg->root);
        if (strncmp(rel, cg->root, rl2) == 0 && rel[rl2] == '/') rel += rl2 + 1;
        GroundFinding *gf = NULL;
        int ng = ground_findings(cg, rel, &gf);
        for (int g = 0; g < ng; g++) {
            nfindings++;
            if (!json)
                printf("  warn  %s:%d: %s\n", gf[g].path, gf[g].line,
                       gf[g].detail);
        }
        ground_findings_free(gf, ng);
        ContractFinding *cf = NULL;
        int nc = contract_findings(cg, rel, &cf);
        for (int c = 0; c < nc; c++) {
            nfindings++;
            if (!json)
                printf("  warn  %s:%d: %s\n", cf[c].path, cf[c].line,
                       cf[c].detail);
        }
        contract_findings_free(cf, nc);
        HygieneFinding *hf = NULL;
        int nh = hygiene_findings(cg, rel, &hf);
        for (int h = 0; h < nh; h++) {
            nfindings++;
            if (!json)
                printf("  warn  %s:%d: %s\n", hf[h].path, hf[h].line,
                       hf[h].detail);
        }
        hygiene_findings_free(hf, nh);
    }
    if (!json && nfindings)
        printf("guard: %d finding(s) (advisory)\n", nfindings);
    sb_free(&gs.txt);
    sb_free(&gs.js);
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

    /* findings the change introduced */
    int nfindings = 0;
    StrBuf ftxt; sb_init(&ftxt);
    for (int i = 0; i < np; i++) {
        GroundFinding *gf = NULL;
        int ng = ground_findings(cg, paths[i], &gf);
        for (int g = 0; g < ng; g++) {
            nfindings++;
            sb_printf(&ftxt, "  %s:%d: %s\n", gf[g].path, gf[g].line,
                      gf[g].detail);
        }
        ground_findings_free(gf, ng);
        ContractFinding *cf = NULL;
        int nc = contract_findings(cg, paths[i], &cf);
        for (int c = 0; c < nc; c++) {
            nfindings++;
            sb_printf(&ftxt, "  %s:%d: %s\n", cf[c].path, cf[c].line,
                      cf[c].detail);
        }
        contract_findings_free(cf, nc);
        HygieneFinding *hf = NULL;
        int nh = hygiene_findings(cg, paths[i], &hf);
        for (int h = 0; h < nh; h++) {
            nfindings++;
            sb_printf(&ftxt, "  %s:%d: %s\n", hf[h].path, hf[h].line,
                      hf[h].detail);
        }
        hygiene_findings_free(hf, nh);
    }

    if (json) {
        sb_printf(&b, "],\"external_caller_count\":%d,\"findings\":%d}\n",
                  nrisk, nfindings);
    } else {
        if (!nsym) sb_puts(&b, "  (none)\n");
        if (nrisk) {
            sb_puts(&b, "\nat risk:\n");
            sb_puts(&b, risk.p);
        }
        if (nfindings) {
            sb_printf(&b, "\nfindings (%d):\n", nfindings);
            sb_puts(&b, ftxt.p);
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
    sb_free(&ftxt);
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
    int portable_rc = integrate_apply_portable(cg, false);
    int git_rc = cmd_hook_install_git(cg, bin);
    return portable_rc != 0 ? portable_rc : git_rc;
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

/* ---------------- handoff / resume ---------------- */

/* A handoff is one structured memory: 'handoff|done:…|next:…|blocked:…|
 * note:…|files:…'. Each new handoff supersedes the previous live one, so
 * resume always reads exactly one authoritative note per task. */

static const char *HANDOFF_KEYS[] = { "done", "next", "blocked", "note",
                                      "files" };

/* extract one field from a handoff body; malloc'd, NULL when absent */
static char *handoff_field(const char *body, const char *key) {
    char pat[16];
    snprintf(pat, sizeof pat, "|%s:", key);
    const char *p = strstr(body, pat);
    if (!p) return NULL;
    p += strlen(pat);
    const char *end = body + strlen(body);
    for (size_t i = 0; i < sizeof HANDOFF_KEYS / sizeof *HANDOFF_KEYS; i++) {
        char q[16];
        snprintf(q, sizeof q, "|%s:", HANDOFF_KEYS[i]);
        const char *m = strstr(p, q);
        if (m && m < end) end = m;
    }
    size_t n = (size_t)(end - p);
    char *v = xmalloc(n + 1);
    memcpy(v, p, n);
    v[n] = 0;
    return v;
}

/* id of the newest non-superseded handoff memory for a task, or -1 */
static long handoff_live_id(Cg *cg, const char *tag) {
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT m.id FROM memories m WHERE m.type='handoff' AND m.task=? "
        "AND m.id NOT IN (SELECT id FROM memory_superseded) "
        "ORDER BY m.id DESC LIMIT 1");
    sqlite3_bind_text(st, 1, tag, -1, SQLITE_TRANSIENT);
    long id = -1;
    if (sqlite3_step(st) == SQLITE_ROW) id = sqlite3_column_int64(st, 0);
    sqlite3_finalize(st);
    return id;
}

/* uncommitted paths, comma-joined, capped at `cap` entries; malloc'd */
static char *handoff_files(Cg *cg, int cap, int *count) {
    char **paths = NULL;
    int np = vcs_changed_paths(cg, NULL, &paths);
    StrBuf f; sb_init(&f);
    for (int i = 0; i < np && i < cap; i++) {
        if (i) sb_putc(&f, ',');
        sb_puts(&f, paths[i]);
    }
    for (int i = 0; i < np; i++) free(paths[i]);
    free(paths);
    if (count) *count = np;
    if (f.len == 0) { sb_free(&f); return NULL; }
    return f.p;
}

/* Session state that survives the session: what got done, what comes next,
 * what is blocked — stored against the task, not the conversation. */
int cmd_handoff(Cg *cg, const char *task, const char *done, const char *next,
                const char *blocked, const char *note, bool json)
{
    char *tag = spec_resolve_task(task, cg_agent_name(NULL));
    if (!tag) {
        fprintf(stderr, task && task[0]
                ? "cg handoff: unknown task '%s'\n"
                : "cg handoff: no task in progress — pass --task <id>\n",
                task ? task : "");
        return 1;
    }
    char *files = handoff_files(cg, 20, NULL);

    StrBuf body; sb_init(&body);
    sb_puts(&body, "handoff");
    if (done && done[0])       sb_printf(&body, "|done:%s", done);
    if (next && next[0])       sb_printf(&body, "|next:%s", next);
    if (blocked && blocked[0]) sb_printf(&body, "|blocked:%s", blocked);
    if (note && note[0])       sb_printf(&body, "|note:%s", note);
    if (files)                 sb_printf(&body, "|files:%s", files);

    long prev = handoff_live_id(cg, tag);
    long id = memory_add(cg, "handoff", tag, body.p, NULL, files, "manual");
    if (id < 0) {
        fprintf(stderr, "cg handoff: cannot store handoff\n");
        sb_free(&body); free(files); free(tag);
        return 1;
    }
    if (prev > 0) memory_supersede(cg, prev, id);

    if (json) {
        StrBuf j; sb_init(&j);
        sb_printf(&j, "{\"handoff\":%ld,\"task\":", id);
        sb_json_str(&j, tag);
        if (prev > 0) sb_printf(&j, ",\"superseded\":%ld", prev);
        else          sb_puts(&j, ",\"superseded\":null");
        sb_puts(&j, "}\n");
        fputs(j.p, stdout);
        sb_free(&j);
    } else {
        printf("handoff recorded for %s\n", tag);
        if (prev > 0) printf("  supersedes handoff #%ld\n", prev);
        if (next && next[0]) printf("  next: %s\n", next);
    }
    sb_free(&body);
    free(files);
    free(tag);
    return 0;
}

/* append one parsed handoff field to a JSON object under construction */
static void resume_json_field(StrBuf *b, const char *name, const char *v) {
    sb_printf(b, ",\"%s\":", name);
    if (v) sb_json_str(b, v);
    else   sb_puts(b, "null");
}

/* The other half of handoff: everything a fresh session needs to pick a task
 * back up — the task packet, the latest live handoff, task-scoped memories,
 * the dirty paths, and who (if anyone) holds the lease. */
int cmd_resume(Cg *cg, const char *task, bool json, bool prompt)
{
    char *tag = spec_resolve_task(task, cg_agent_name(NULL));
    if (!tag) {
        fprintf(stderr, task && task[0]
                ? "cg resume: unknown task '%s'\n"
                : "cg resume: no task in progress — pass --task <id>\n",
                task ? task : "");
        return 1;
    }
    char *packet = spec_task_packet(tag);

    /* latest live handoff, parsed */
    char *hdone = NULL, *hnext = NULL, *hblocked = NULL, *hnote = NULL,
         *hfiles = NULL;
    bool have_handoff = false;
    {
        long hid = handoff_live_id(cg, tag);
        if (hid > 0) {
            sqlite3_stmt *st = cg_prep(cg,
                "SELECT body FROM memories WHERE id=?");
            sqlite3_bind_int64(st, 1, hid);
            if (sqlite3_step(st) == SQLITE_ROW) {
                const char *body = (const char *)sqlite3_column_text(st, 0);
                if (body) {
                    have_handoff = true;
                    hdone    = handoff_field(body, "done");
                    hnext    = handoff_field(body, "next");
                    hblocked = handoff_field(body, "blocked");
                    hnote    = handoff_field(body, "note");
                    hfiles   = handoff_field(body, "files");
                }
            }
            sqlite3_finalize(st);
        }
    }

    /* task-scoped memories, minus raw handoff rows (already parsed above) */
    Memory *mem = NULL;
    int nm = spec_task_memories_tag(tag, &mem);
    char **paths = NULL;
    int np = vcs_changed_paths(cg, NULL, &paths);

    char *lagent = NULL;
    long lmin = 0;
    {
        sqlite3_stmt *st = cg_prep(cg,
            "SELECT agent, (expires - strftime('%s','now'))/60 FROM leases "
            "WHERE task=? AND expires > strftime('%s','now')");
        sqlite3_bind_text(st, 1, tag, -1, SQLITE_TRANSIENT);
        if (sqlite3_step(st) == SQLITE_ROW) {
            const char *a = (const char *)sqlite3_column_text(st, 0);
            lagent = xstrdup(a ? a : "");
            lmin = sqlite3_column_int64(st, 1);
        }
        sqlite3_finalize(st);
    }

    StrBuf b; sb_init(&b);
    if (json) {
        sb_puts(&b, "{\"root\":");
        sb_json_str(&b, cg->root);
        sb_puts(&b, ",\"task\":");
        sb_puts(&b, packet ? packet : "null");
        if (have_handoff) {
            sb_puts(&b, ",\"handoff\":{\"done\":");
            if (hdone) sb_json_str(&b, hdone); else sb_puts(&b, "null");
            resume_json_field(&b, "next", hnext);
            resume_json_field(&b, "blocked", hblocked);
            resume_json_field(&b, "note", hnote);
            sb_puts(&b, ",\"files\":[");
            if (hfiles) {
                char *sav;
                int i = 0;
                for (char *f = strtok_r(hfiles, ",", &sav); f;
                     f = strtok_r(NULL, ",", &sav)) {
                    if (i++) sb_putc(&b, ',');
                    sb_json_str(&b, f);
                }
            }
            sb_puts(&b, "]}");
        } else {
            sb_puts(&b, ",\"handoff\":null");
        }
        sb_puts(&b, ",\"memories\":[");
        int shown = 0;
        for (int i = 0; i < nm && shown < 5; i++) {
            if (strcmp(mem[i].type, "handoff") == 0) continue;
            if (shown++) sb_putc(&b, ',');
            memory_json(&mem[i], &b);
        }
        sb_puts(&b, "],\"uncommitted\":[");
        for (int i = 0; i < np && i < 20; i++) {
            if (i) sb_putc(&b, ',');
            sb_json_str(&b, paths[i]);
        }
        sb_printf(&b, "],\"uncommitted_count\":%d", np);
        if (lagent) {
            sb_puts(&b, ",\"lease\":{\"agent\":");
            sb_json_str(&b, lagent);
            sb_printf(&b, ",\"expires_in_min\":%ld}", lmin);
        } else {
            sb_puts(&b, ",\"lease\":null");
        }
        sb_puts(&b, "}\n");
    } else {
        char *id = packet ? json_get_string(packet, "id") : NULL;
        char *ti = packet ? json_get_string(packet, "title") : NULL;
        char *stt = packet ? json_get_string(packet, "status") : NULL;
        char *vc = packet ? json_get_string(packet, "verify_cmd") : NULL;
        if (prompt) sb_printf(&b, "# resume: %s\n", tag);
        else        sb_printf(&b, "resume — %s\n", tag);
        sb_printf(&b, "task %s — %s  (%s)\n", id ? id : "?", ti ? ti : "?",
                  stt ? stt : "?");
        if (vc) sb_printf(&b, "verify: %s\n", vc);
        if (have_handoff) {
            sb_puts(&b, "last handoff:\n");
            if (hdone)    sb_printf(&b, "  done: %s\n", hdone);
            if (hnext)    sb_printf(&b, "  next: %s\n", hnext);
            if (hblocked) sb_printf(&b, "  blocked: %s\n", hblocked);
            if (hnote)    sb_printf(&b, "  note: %s\n", hnote);
            if (hfiles)   sb_printf(&b, "  files: %s\n", hfiles);
        } else {
            sb_puts(&b, "last handoff: none recorded\n");
        }
        int shown = 0;
        for (int i = 0; i < nm && shown < 5; i++) {
            if (strcmp(mem[i].type, "handoff") == 0) continue;
            if (!shown) sb_puts(&b, "task memories:\n");
            sb_printf(&b, "  [%s] %s\n", mem[i].type, mem[i].body);
            shown++;
        }
        if (np) {
            sb_printf(&b, "uncommitted (%d):\n", np);
            for (int i = 0; i < np && i < 20; i++)
                sb_printf(&b, "  %s\n", paths[i]);
            if (np > 20) sb_printf(&b, "  ... and %d more\n", np - 20);
        } else {
            sb_puts(&b, "uncommitted: clean\n");
        }
        if (lagent)
            sb_printf(&b, "lease: held by %s, expires in %ld min\n",
                      lagent, lmin);
        else
            sb_puts(&b, "lease: none — claim with `cg spec claim <id>`\n");
        if (prompt) {
            const char *sid = id ? id : "?";
            sb_printf(&b,
                "\nwhen done: run the verify command, then `cg spec done %s`."
                "\nbefore stopping: `cg handoff --task %s --done ... "
                "--next ...` to hand off.\n", sid, sid);
        }
        free(id); free(ti); free(stt); free(vc);
    }
    fputs(b.p, stdout);
    sb_free(&b);
    memory_free(mem, nm);
    for (int i = 0; i < np; i++) free(paths[i]);
    free(paths);
    free(lagent);
    free(hdone); free(hnext); free(hblocked); free(hnote); free(hfiles);
    free(packet);
    free(tag);
    return 0;
}

/* ---------------- revisioned work packets ---------------- */

typedef struct { Cg *cg; const char *query; } WorkCapture;
static int work_call_state(void *v) {
    return cmd_state(((WorkCapture *)v)->cg, true);
}
static int work_call_progress(void *v) {
    return runtime_progress(((WorkCapture *)v)->cg, true);
}
static int work_call_context(void *v) {
    WorkCapture *c = v;
    return cmd_context(c->cg, c->query, 2400, 4, true);
}
static int work_call_tests(void *v) {
    WorkCapture *c = v;
    return cmd_test_impact(c->cg, c->query, true);
}

static void work_raw_json(StrBuf *b, const char *raw) {
    if (!raw) { sb_puts(b, "null"); return; }
    while (*raw && isspace((unsigned char)*raw)) raw++;
    size_t n = strlen(raw);
    while (n && isspace((unsigned char)raw[n - 1])) n--;
    if (n) sb_printf(b, "%.*s", (int)n, raw);
    else sb_puts(b, "null");
}

static long work_last_event(Cg *cg, const char *task) {
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT ifnull(MAX(id),0) FROM runtime_events WHERE task=?");
    sqlite3_bind_text(st, 1, task, -1, SQLITE_TRANSIENT);
    long id = 0;
    if (sqlite3_step(st) == SQLITE_ROW) id = sqlite3_column_int64(st, 0);
    sqlite3_finalize(st);
    return id;
}

static void work_event_json(Cg *cg, StrBuf *b, const char *task, long after,
                            bool latest_only) {
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT id,created,source,kind,session,ifnull(attempt_id,''),"
        "fingerprint,revision,evidence_delta,output_changed "
        "FROM runtime_events WHERE task=? AND id>? ORDER BY id DESC LIMIT ?");
    sqlite3_bind_text(st, 1, task, -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(st, 2, after);
    sqlite3_bind_int(st, 3, latest_only ? 1 : 30);
    int n = 0;
    if (!latest_only) sb_putc(b, '[');
    while (sqlite3_step(st) == SQLITE_ROW) {
        if (!latest_only && n) sb_putc(b, ',');
        sb_printf(b, "{\"id\":%ld,\"created\":%ld,\"source\":",
                  (long)sqlite3_column_int64(st, 0),
                  (long)sqlite3_column_int64(st, 1));
        sb_json_str(b, (const char *)sqlite3_column_text(st, 2));
        sb_puts(b, ",\"kind\":");
        sb_json_str(b, (const char *)sqlite3_column_text(st, 3));
        sb_puts(b, ",\"session\":");
        sb_json_str(b, (const char *)sqlite3_column_text(st, 4));
        sb_puts(b, ",\"attempt_id\":");
        const char *attempt = (const char *)sqlite3_column_text(st, 5);
        if (attempt[0]) sb_json_str(b, attempt); else sb_puts(b, "null");
        sb_puts(b, ",\"fingerprint\":");
        sb_json_str(b, (const char *)sqlite3_column_text(st, 6));
        sb_puts(b, ",\"workspace_revision\":");
        sb_json_str(b, (const char *)sqlite3_column_text(st, 7));
        sb_printf(b, ",\"evidence_delta\":%d,\"output_changed\":%s}",
                  sqlite3_column_int(st, 8),
                  sqlite3_column_int(st, 9) ? "true" : "false");
        n++;
    }
    sqlite3_finalize(st);
    if (!latest_only) sb_putc(b, ']');
    else if (!n) sb_puts(b, "null");
}

static void work_memories_json(Cg *cg, StrBuf *b, const char *task) {
    Memory *mem = NULL;
    int n = spec_task_memories_tag(task, &mem);
    sb_putc(b, '[');
    for (int i = 0; i < n; i++) {
        if (i) sb_putc(b, ',');
        brief_cap_body(&mem[i]);
        memory_json(&mem[i], b);
    }
    sb_putc(b, ']');
    memory_free(mem, n);
    (void)cg;
}

static void work_revision_create(Cg *cg, const char *task, long event_id,
                                 const char *workspace, const char *state_hash,
                                 const char *parent, char revision[65]) {
    char seed[1600];
    snprintf(seed, sizeof seed, "%s|%ld|%s|%s|%s|%ld|%ld", task, event_id,
             workspace, state_hash, parent ? parent : "", now_ms(),
             (long)getpid());
    sha256_hex(seed, strlen(seed), revision);
    cg_exec(cg, "BEGIN IMMEDIATE");
    sqlite3_stmt *st = cg_prep(cg,
        "INSERT INTO work_packets(revision,created,task,event_id,"
        "workspace_revision,state_hash) VALUES(?,?,?,?,?,?)");
    sqlite3_bind_text(st, 1, revision, -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(st, 2, (long)time(NULL));
    sqlite3_bind_text(st, 3, task, -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(st, 4, event_id);
    sqlite3_bind_text(st, 5, workspace, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 6, state_hash, -1, SQLITE_TRANSIENT);
    sqlite3_step(st); sqlite3_finalize(st);
    st = cg_prep(cg,
        "INSERT INTO work_files(revision,path,hash) "
        "SELECT ?,path,hash FROM runtime_files");
    sqlite3_bind_text(st, 1, revision, -1, SQLITE_TRANSIENT);
    sqlite3_step(st); sqlite3_finalize(st);
    cg_exec(cg, "COMMIT");
}

int work_open(Cg *cg, const char *task, bool json) {
    char *tag = spec_resolve_task(task, cg_agent_name(NULL));
    if (!tag) {
        fprintf(stderr, "cg work open: no resolvable task; pass --task <id>\n");
        return 1;
    }
    char *packet = spec_task_packet(tag);
    if (!packet) { free(tag); return 1; }
    char *title = json_get_string(packet, "title");
    char *criteria = json_get_raw(packet, "acceptance_criteria");
    char *scope = json_get_raw(packet, "touches");
    char *verify = json_get_string(packet, "verify_cmd");
    SysInfo si; IndexStats index_stats;
    sysinfo_detect(&si);
    cg_index(cg, &si, false, &index_stats, true);
    char *focus = graph_task_focus(cg, packet);

    WorkCapture call = { cg, focus };
    char *state = NULL, *context = NULL, *tests = NULL, *progress = NULL;
    run_capture(&state, work_call_state, &call);
    run_capture(&context, work_call_context, &call);
    run_capture(&tests, work_call_tests, &call);
    run_capture(&progress, work_call_progress, &call);
    char state_hash[65], workspace[65], revision[65];
    sha256_hex(state ? state : "", state ? strlen(state) : 0, state_hash);
    runtime_workspace_revision(cg, workspace);
    long event_id = work_last_event(cg, tag);
    work_revision_create(cg, tag, event_id, workspace, state_hash, NULL,
                         revision);

    if (json) {
        StrBuf b; sb_init(&b);
        sb_puts(&b, "{\"revision\":"); sb_json_str(&b, revision);
        sb_puts(&b, ",\"task_id\":"); sb_json_str(&b, tag);
        sb_puts(&b, ",\"objective\":");
        sb_json_str(&b, title ? title : tag);
        sb_puts(&b, ",\"criteria\":"); work_raw_json(&b, criteria);
        sb_puts(&b, ",\"allowed_scope\":"); work_raw_json(&b, scope);
        sb_puts(&b, ",\"state\":"); work_raw_json(&b, state);
        sb_puts(&b, ",\"memories\":"); work_memories_json(cg, &b, tag);
        sb_puts(&b, ",\"context\":"); work_raw_json(&b, context);
        sb_puts(&b, ",\"tests\":{\"verify_command\":");
        if (verify) sb_json_str(&b, verify); else sb_puts(&b, "null");
        sb_puts(&b, ",\"impact\":"); work_raw_json(&b, tests);
        sb_puts(&b, "},\"last_event\":");
        work_event_json(cg, &b, tag, 0, true);
        sb_puts(&b, ",\"progress\":"); work_raw_json(&b, progress);
        sb_puts(&b, "}\n");
        fputs(b.p, stdout); sb_free(&b);
    } else {
        printf("work %.12s — %s\n", revision, title ? title : tag);
        printf("task: %s\nverify: %s\n", tag, verify ? verify : "not declared");
        printf("update: cg work update %s\n", revision);
    }
    free(tag); free(packet); free(title); free(criteria); free(scope);
    free(verify); free(focus); free(state); free(context); free(tests);
    free(progress);
    return 0;
}

static void work_workspace_delta(Cg *cg, StrBuf *b, const char *revision,
                                 int *count) {
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT r.path,CASE WHEN w.path IS NULL THEN 'added' ELSE 'modified' END "
        "FROM runtime_files r LEFT JOIN work_files w "
        "ON w.revision=? AND w.path=r.path "
        "WHERE w.path IS NULL OR w.hash<>r.hash UNION ALL "
        "SELECT w.path,'deleted' FROM work_files w LEFT JOIN runtime_files r "
        "ON r.path=w.path WHERE w.revision=? AND r.path IS NULL ORDER BY 1");
    sqlite3_bind_text(st, 1, revision, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, revision, -1, SQLITE_TRANSIENT);
    int n = 0; sb_putc(b, '[');
    while (sqlite3_step(st) == SQLITE_ROW) {
        if (n++) sb_putc(b, ',');
        sb_puts(b, "{\"path\":");
        sb_json_str(b, (const char *)sqlite3_column_text(st, 0));
        sb_puts(b, ",\"change\":");
        sb_json_str(b, (const char *)sqlite3_column_text(st, 1));
        sb_putc(b, '}');
    }
    sqlite3_finalize(st); sb_putc(b, ']');
    *count = n;
}

int work_update(Cg *cg, const char *revision, bool json) {
    if (!revision || !revision[0]) {
        fprintf(stderr, "cg work update: revision required\n"); return 1;
    }
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT task,event_id,workspace_revision,state_hash FROM work_packets "
        "WHERE revision=?");
    sqlite3_bind_text(st, 1, revision, -1, SQLITE_TRANSIENT);
    if (sqlite3_step(st) != SQLITE_ROW) {
        sqlite3_finalize(st);
        fprintf(stderr, "cg work update: unknown revision '%s'\n", revision);
        return 1;
    }
    char *task = xstrdup((const char *)sqlite3_column_text(st, 0));
    long prior_event = sqlite3_column_int64(st, 1);
    char prior_workspace[65], prior_state[65];
    snprintf(prior_workspace, sizeof prior_workspace, "%s",
             (const char *)sqlite3_column_text(st, 2));
    snprintf(prior_state, sizeof prior_state, "%s",
             (const char *)sqlite3_column_text(st, 3));
    sqlite3_finalize(st);

    WorkCapture call = { cg, NULL };
    char *state = NULL;
    run_capture(&state, work_call_state, &call);
    char state_hash[65], workspace[65];
    sha256_hex(state ? state : "", state ? strlen(state) : 0, state_hash);
    runtime_workspace_revision(cg, workspace);
    long event_id = work_last_event(cg, task);
    bool state_changed = strcmp(prior_state, state_hash) != 0;
    bool evidence_changed = event_id > prior_event;
    bool workspace_changed = strcmp(prior_workspace, workspace) != 0;

    StrBuf paths; sb_init(&paths);
    int npaths = 0;
    work_workspace_delta(cg, &paths, revision, &npaths);
    workspace_changed = workspace_changed || npaths > 0;
    bool unchanged = !state_changed && !evidence_changed && !workspace_changed;
    char next_revision[65];
    snprintf(next_revision, sizeof next_revision, "%s", revision);
    if (!unchanged)
        work_revision_create(cg, task, event_id, workspace, state_hash,
                             revision, next_revision);

    if (json) {
        StrBuf b; sb_init(&b);
        sb_puts(&b, "{\"revision\":"); sb_json_str(&b, next_revision);
        sb_puts(&b, ",\"since\":"); sb_json_str(&b, revision);
        sb_printf(&b, ",\"unchanged\":%s,\"deltas\":{\"state\":",
                  unchanged ? "true" : "false");
        if (state_changed) work_raw_json(&b, state); else sb_puts(&b, "null");
        sb_puts(&b, ",\"evidence\":");
        work_event_json(cg, &b, task, prior_event, false);
        sb_puts(&b, ",\"workspace\":"); sb_puts(&b, paths.p);
        sb_puts(&b, "}}\n"); fputs(b.p, stdout); sb_free(&b);
    } else if (unchanged) {
        printf("work %.12s: no state, evidence, or workspace changes\n",
               revision);
    } else {
        printf("work %.12s -> %.12s: %d workspace change(s)%s%s\n",
               revision, next_revision, npaths,
               evidence_changed ? ", new evidence" : "",
               state_changed ? ", state changed" : "");
    }
    sb_free(&paths); free(task); free(state);
    return 0;
}

static const char *work_supplied_evidence(const char *clause, int n,
                                          char **evidence) {
    size_t len = strlen(clause);
    for (int i = 0; i < n; i++)
        if (strncmp(evidence[i], clause, len) == 0 && evidence[i][len] == '=')
            return evidence[i] + len + 1;
    return NULL;
}

static char *work_recorded_evidence(Cg *cg, const char *task,
                                    const char *clause) {
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT evidence FROM work_evidence WHERE task=? AND criterion=? "
        "ORDER BY id DESC LIMIT 1");
    sqlite3_bind_text(st, 1, task, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, clause, -1, SQLITE_TRANSIENT);
    char *out = NULL;
    if (sqlite3_step(st) == SQLITE_ROW)
        out = xstrdup((const char *)sqlite3_column_text(st, 0));
    sqlite3_finalize(st);
    if (out) return out;

    /* Native hooks may record criterion coverage before close. Preserve the
     * durable event identity as the proof rather than trusting an ephemeral
     * agent summary. */
    st = cg_prep(cg,
        "SELECT id,kind,fingerprint,revision,ifnull(payload,'{}') "
        "FROM runtime_events WHERE task=? ORDER BY id DESC LIMIT 100");
    sqlite3_bind_text(st, 1, task, -1, SQLITE_TRANSIENT);
    while (!out && sqlite3_step(st) == SQLITE_ROW) {
        const char *payload = (const char *)sqlite3_column_text(st, 4);
        char *covered = json_get_string(payload, "criterion");
        if (covered && strcmp(covered, clause) == 0) {
            char proof[512];
            snprintf(proof, sizeof proof,
                     "runtime event #%ld %s fingerprint %.12s revision %.12s",
                     (long)sqlite3_column_int64(st, 0),
                     (const char *)sqlite3_column_text(st, 1),
                     (const char *)sqlite3_column_text(st, 2),
                     (const char *)sqlite3_column_text(st, 3));
            out = xstrdup(proof);
        }
        free(covered);
    }
    sqlite3_finalize(st);
    return out;
}

int work_close(Cg *cg, const char *requested, int nevidence, char **evidence,
               bool json) {
    char *task = spec_resolve_task(requested, cg_agent_name(NULL));
    if (!task) {
        fprintf(stderr, "cg work close: no resolvable task; pass --task <id>\n");
        return 1;
    }
    char *packet = spec_task_packet(task);
    char *criteria = packet ? json_get_raw(packet, "acceptance_criteria") : NULL;
    StrBuf body; sb_init(&body);
    if (json) { sb_puts(&body, "{\"task\":"); sb_json_str(&body, task); }
    else printf("work close — %s\n", task);
    if (json) sb_puts(&body, ",\"criteria\":[");
    int count = 0, verified = 0;
    const char *p = criteria ? criteria : "";
    while ((p = strstr(p, "\"clause\":")) != NULL) {
        char *obj = xstrdup(p - 1);
        char *clause = json_get_string(obj, "clause");
        char *text = json_get_string(obj, "text");
        free(obj);
        if (!clause) { p += 9; free(text); continue; }
        const char *given = work_supplied_evidence(clause, nevidence, evidence);
        char *prior = NULL;
        if (!given) prior = work_recorded_evidence(cg, task, clause);
        const char *proof = given ? given : prior;
        if (given && given[0]) {
            sqlite3_stmt *ins = cg_prep(cg,
                "INSERT INTO work_evidence(created,task,criterion,evidence,"
                "source) VALUES(strftime('%s','now'),?,?,?,'manual')");
            sqlite3_bind_text(ins, 1, task, -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(ins, 2, clause, -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(ins, 3, given, -1, SQLITE_TRANSIENT);
            sqlite3_step(ins); sqlite3_finalize(ins);
        }
        bool ok = proof && proof[0];
        if (ok) verified++;
        if (json) {
            if (count) sb_putc(&body, ',');
            sb_puts(&body, "{\"clause\":"); sb_json_str(&body, clause);
            sb_puts(&body, ",\"text\":"); sb_json_str(&body, text ? text : "");
            sb_puts(&body, ",\"result\":");
            sb_json_str(&body, ok ? "verified" : "unverified");
            sb_puts(&body, ",\"evidence\":");
            if (ok) sb_json_str(&body, proof); else sb_puts(&body, "null");
            sb_putc(&body, '}');
        } else {
            printf("  %s  %s — %s\n", ok ? "verified" : "unverified",
                   clause, proof ? proof : (text ? text : "no evidence"));
        }
        count++; free(prior); free(clause); free(text); p += 9;
    }
    if (json) {
        sb_printf(&body, "],\"verified\":%d,\"unverified\":%d}\n",
                  verified, count - verified);
        fputs(body.p, stdout);
    }
    sb_free(&body); free(criteria); free(packet); free(task);
    return 0;
}

int cmd_work(Cg *cg, int argc, char **argv, bool json) {
    const char *sub = argc > 0 ? argv[0] : "open";
    const char *task = NULL, *revision = NULL;
    char *evidence[64]; int nevidence = 0;
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--task") == 0 && i + 1 < argc) task = argv[++i];
        else if (strcmp(argv[i], "--evidence") == 0 && i + 1 < argc &&
                 nevidence < 64) evidence[nevidence++] = argv[++i];
        else if (argv[i][0] != '-' && !revision) revision = argv[i];
    }
    if (strcmp(sub, "open") == 0) return work_open(cg, task, json);
    if (strcmp(sub, "update") == 0) return work_update(cg, revision, json);
    if (strcmp(sub, "close") == 0)
        return work_close(cg, task, nevidence, evidence, json);
    fprintf(stderr, "usage: cg work [open [--task ID] | update REVISION | "
                    "close [--task ID] [--evidence CLAUSE=PROOF]]\n");
    return 1;
}
