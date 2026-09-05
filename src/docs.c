/*
 * Documentation closure — grounded plans and bounded evidence packets for the
 * existing agent connector. Generation remains an agent task; this module
 * supplies the repository truth that constrains it.
 */
#include "cg.h"
#include <ctype.h>
#include <dirent.h>
#include <fnmatch.h>
#include <sys/stat.h>
#include <unistd.h>

#define DOCS_EVIDENCE_CAP 16000
#define DOCS_INVENTORY_CAP 256

/* Scoped to a synchronous CLI/MCP dispatch and reset before it returns. */
static const char *docs_feature_override;

typedef struct {
    Cg *cg;
    char root[4096];
    char feature[256];
    char spec_path[4700];
    char dir[4700];
    Kvx *wf;
    Kvx *spec;
    char *mode;
    char *status;
    char **audiences;
    int naudiences;
    char **targets;
    int ntargets;
    bool incremental;
} DocsProject;

static char *docs_str(const Kvx *k, const char *sec, const char *key,
                      const char *dflt) {
    char *v = kvx_str(k, sec, key);
    return v ? v : xstrdup(dflt ? dflt : "");
}

static void docs_free_list(char **v, int n) {
    for (int i = 0; i < n; i++) free(v[i]);
    free(v);
}

static void docs_project_close(DocsProject *p) {
    kvx_free(p->wf);
    kvx_free(p->spec);
    free(p->mode);
    free(p->status);
    docs_free_list(p->audiences, p->naudiences);
    docs_free_list(p->targets, p->ntargets);
}

static int docs_defaults(char ***out, const char **items, int n) {
    char **v = xmalloc(sizeof(char *) * (size_t)n);
    for (int i = 0; i < n; i++) v[i] = xstrdup(items[i]);
    *out = v;
    return n;
}

static bool docs_tasks_qualified(const Kvx *spec) {
    char **ids = NULL;
    int n = kvx_subsections(spec, "task", &ids);
    bool saw = false, all = true;
    for (int i = 0; i < n; i++) {
        char sec[300];
        snprintf(sec, sizeof sec, "task.%s", ids[i]);
        const char *wave = kvx_raw(spec, sec, "wave");
        if (wave && wave[0]) {
            saw = true;
            char *status = docs_str(spec, sec, "status", "pending");
            if (strcmp(status, "done") != 0) all = false;
            free(status);
        }
        free(ids[i]);
    }
    free(ids);
    return saw && all;
}

static int docs_project_open(Cg *cg, DocsProject *p) {
    memset(p, 0, sizeof *p);
    p->cg = cg;
    snprintf(p->root, sizeof p->root, "%s", cg->root);
    char wfpath[4700];
    snprintf(wfpath, sizeof wfpath, "%s/spec/workflow.kvx", p->root);
    p->wf = kvx_parse(wfpath);
    if (!p->wf) {
        fprintf(stderr, "cg docs: no spec/workflow.kvx in %s\n", p->root);
        return -1;
    }
    char *feature = docs_feature_override ? xstrdup(docs_feature_override)
                                         : kvx_str(p->wf, "meta", "active_feature");
    if (!feature || !feature[0]) {
        fprintf(stderr, "cg docs: active feature is not configured\n");
        free(feature);
        docs_project_close(p);
        return -1;
    }
    if (strlen(feature) >= sizeof p->feature || strchr(feature, '/') ||
        strchr(feature, '\\') || strcmp(feature, ".") == 0 || strcmp(feature, "..") == 0) {
        fprintf(stderr, "cg docs: invalid feature name\n");
        free(feature); docs_project_close(p); return -1;
    }
    snprintf(p->feature, sizeof p->feature, "%s", feature);
    free(feature);
    snprintf(p->spec_path, sizeof p->spec_path, "%s/spec/%s/spec.kvx",
             p->root, p->feature);
    p->spec = kvx_parse(p->spec_path);
    if (!p->spec) {
        fprintf(stderr, "cg docs: cannot parse %s\n", p->spec_path);
        docs_project_close(p);
        return -1;
    }
    snprintf(p->dir, sizeof p->dir, "%s/%s/%s", p->root, CG_DOCS_DIR,
             p->feature);
    p->mode = kvx_has(p->spec, "documentation")
        ? docs_str(p->spec, "documentation", "mode", "auto")
        : xstrdup("legacy");
    p->status = kvx_has(p->spec, "documentation")
        ? docs_str(p->spec, "documentation", "status", "pending")
        : xstrdup("legacy");
    if (strcmp(p->mode, "off") == 0) {
        free(p->status);
        p->status = xstrdup("off");
    }
    if ((strcmp(p->mode, "auto") == 0 || strcmp(p->mode, "manual") == 0) &&
        strcmp(p->status, "done") != 0 && !docs_tasks_qualified(p->spec)) {
        free(p->status);
        p->status = xstrdup("waiting");
    }
    p->naudiences = kvx_list(p->spec, "documentation", "audiences",
                             &p->audiences);
    if (p->naudiences == 0) {
        const char *a[] = { "user", "developer" };
        p->naudiences = docs_defaults(&p->audiences, a, 2);
    }
    p->ntargets = kvx_list(p->spec, "documentation", "targets", &p->targets);
    if (p->ntargets == 0) {
        const char *t[] = { "README.md", "docs/**", "CONTRIBUTING.md",
                            "CHANGELOG.md" };
        p->ntargets = docs_defaults(&p->targets, t, 4);
    }
    char baseline[4800];
    struct stat st;
    snprintf(baseline, sizeof baseline, "%s/%s/baseline.json", p->root, CG_DOCS_DIR);
    p->incremental = stat(baseline, &st) == 0 && S_ISREG(st.st_mode);
    return 0;
}

static bool docs_suffix(const char *name) {
    const char *dot = strrchr(name, '.');
    return dot && (strcmp(dot, ".md") == 0 || strcmp(dot, ".mdx") == 0 ||
                   strcmp(dot, ".rst") == 0);
}

static void docs_inventory_walk(const char *root, const char *rel, int depth,
                                StrBuf *text, StrBuf *json, int *count) {
    if (depth > 8 || *count >= DOCS_INVENTORY_CAP) return;
    char abs[4700];
    snprintf(abs, sizeof abs, "%s%s%s", root, rel[0] ? "/" : "", rel);
    DIR *d = opendir(abs);
    if (!d) return;
    struct dirent *e;
    while ((e = readdir(d)) && *count < DOCS_INVENTORY_CAP) {
        if (e->d_name[0] == '.') continue;
        char child[4096];
        snprintf(child, sizeof child, "%s%s%s", rel, rel[0] ? "/" : "",
                 e->d_name);
        char cabs[4700];
        snprintf(cabs, sizeof cabs, "%s/%s", root, child);
        struct stat st;
        if (lstat(cabs, &st) != 0) continue;
        if (S_ISDIR(st.st_mode)) {
            if (strcmp(e->d_name, "node_modules") == 0 ||
                strcmp(e->d_name, "target") == 0 ||
                strcmp(e->d_name, "vendor") == 0 ||
                strcmp(e->d_name, "spec") == 0) continue;
            docs_inventory_walk(root, child, depth + 1, text, json, count);
        } else if (S_ISREG(st.st_mode) && docs_suffix(e->d_name)) {
            sb_printf(text, "- %s (%ld bytes)\n", child, (long)st.st_size);
            if (*count) sb_putc(json, ',');
            sb_puts(json, "{\"path\":"); sb_json_str(json, child);
            sb_printf(json, ",\"bytes\":%ld}", (long)st.st_size);
            (*count)++;
        }
    }
    closedir(d);
}

/* Inventory project-authored documentation, excluding generated spec mirrors
 * and dependency trees. Both renderings are optional and caller-owned. */
static int docs_inventory(const DocsProject *p, StrBuf *text, StrBuf *json) {
    int count = 0;
    if (text) sb_init(text);
    if (json) sb_init(json);
    StrBuf sink_text, sink_json;
    if (!text) { sb_init(&sink_text); text = &sink_text; }
    if (!json) { sb_init(&sink_json); json = &sink_json; }
    docs_inventory_walk(p->root, "", 0, text, json, &count);
    if (text == &sink_text) sb_free(&sink_text);
    if (json == &sink_json) sb_free(&sink_json);
    return count;
}

static void docs_targets_json(const DocsProject *p, StrBuf *b) {
    sb_putc(b, '[');
    for (int i = 0; i < p->ntargets; i++) {
        if (i) sb_putc(b, ',');
        sb_puts(b, "{\"path\":"); sb_json_str(b, p->targets[i]);
        bool glob = strpbrk(p->targets[i], "*?[") != NULL;
        char abs[4700]; struct stat st;
        snprintf(abs, sizeof abs, "%s/%s", p->root, p->targets[i]);
        sb_printf(b, ",\"glob\":%s,\"exists\":%s}",
                  glob ? "true" : "false",
                  !glob && stat(abs, &st) == 0 ? "true" : "false");
    }
    sb_putc(b, ']');
}

static bool docs_target_match(const DocsProject *p, const char *path) {
    for (int i = 0; i < p->ntargets; i++) {
        const char *pat = p->targets[i];
        size_t n = strlen(pat);
        if (n >= 3 && strcmp(pat + n - 3, "/**") == 0 &&
            strncmp(path, pat, n - 2) == 0) return true;
        if (fnmatch(pat, path, FNM_PATHNAME) == 0) return true;
    }
    return false;
}

static bool docs_regular(const DocsProject *p, const char *rel) {
    if (!rel || !rel[0] || rel[0] == '/' || strstr(rel, "../") ||
        strcmp(rel, "..") == 0) return false;
    char abs[4800]; struct stat st;
    snprintf(abs, sizeof abs, "%s/%s", p->root, rel);
    char resolved[4096];
    size_t root_len = strlen(p->root);
    return realpath(abs, resolved) &&
           strncmp(resolved, p->root, root_len) == 0 &&
           resolved[root_len] == '/' &&
           stat(abs, &st) == 0 && S_ISREG(st.st_mode);
}

static bool docs_string_in_file(const DocsProject *p, const char *rel,
                                const char *needle) {
    if (!docs_regular(p, rel)) return false;
    char abs[4800];
    snprintf(abs, sizeof abs, "%s/%s", p->root, rel);
    char *body = read_entire_file(abs, NULL);
    bool found = body && strstr(body, needle) != NULL;
    free(body);
    return found;
}

static bool docs_symbol_exists(Cg *cg, const char *name, const char *path) {
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT 1 FROM symbols s JOIN files f ON f.id=s.file_id "
        "WHERE s.name=?1 AND f.path=?2 LIMIT 1");
    sqlite3_bind_text(st, 1, name, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, path, -1, SQLITE_TRANSIENT);
    bool found = sqlite3_step(st) == SQLITE_ROW;
    sqlite3_finalize(st);
    return found;
}

static bool docs_route_exists(Cg *cg, const char *value, const char *path) {
    const char *pattern = value;
    char method[24] = "";
    const char *space = strchr(value, ' ');
    if (space && (size_t)(space - value) < sizeof method) {
        snprintf(method, sizeof method, "%.*s", (int)(space - value), value);
        pattern = space + 1;
    }
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT 1 FROM routes r JOIN files f ON f.id=r.file_id "
        "WHERE r.pattern=?1 AND (?2='' OR r.method=?2) AND f.path=?3 LIMIT 1");
    sqlite3_bind_text(st, 1, pattern, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, method, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 3, path, -1, SQLITE_TRANSIENT);
    bool found = sqlite3_step(st) == SQLITE_ROW;
    sqlite3_finalize(st);
    return found;
}

/* Seed the private claims ledger with every changed graph entry point and
 * route attributed to this feature. The documentation agent supplies the
 * document mapping and may append additional claims; the checker proves them. */
static int docs_claims_template(DocsProject *p, const char *path) {
    struct stat st;
    bool claims_exist = stat(path, &st) == 0;
    StrBuf b, required; sb_init(&b); sb_init(&required);
    sb_puts(&b,
        "# Derived documentation claim ledger. Fill document mappings; add "
        "claims when prose makes additional factual assertions.\n\n"
        "[coverage]\n"
        "user                 = \"\"\n"
        "developer            = \"\"\n"
        "release_or_migration = \"\"\n"
        "exclusions           = \"\"\n"
        "unresolved           = \"\"\n\n");
    sb_puts(&required,
        "# Derived required public surface. Regenerated from task-tagged "
        "snapshots; do not edit.\n\n");
    char needle[400];
    snprintf(needle, sizeof needle, "[spec:%s/", p->feature);
    char **paths = NULL;
    int np = 0;
    if (p->incremental) np = vcs_changed_paths(p->cg, needle, &paths);
    else {
        /* The first closure covers the whole indexed project, not merely the
         * feature that happened to introduce documentation generation. */
        sqlite3_stmt *files = cg_prep(p->cg, "SELECT path FROM files ORDER BY path");
        while (sqlite3_step(files) == SQLITE_ROW) {
            paths = xrealloc(paths, (size_t)(np + 1) * sizeof *paths);
            paths[np++] = xstrdup((const char *)sqlite3_column_text(files, 0));
        }
        sqlite3_finalize(files);
    }
    int nclaim = 0;
    for (int i = 0; i < np; i++) {
        sqlite3_stmt *ss = cg_prep(p->cg,
            "SELECT s.id,s.name,s.kind,s.line FROM symbols s JOIN files f "
            "ON f.id=s.file_id WHERE f.path=?1 ORDER BY s.line");
        sqlite3_bind_text(ss, 1, paths[i], -1, SQLITE_TRANSIENT);
        while (sqlite3_step(ss) == SQLITE_ROW) {
            long id = sqlite3_column_int64(ss, 0);
            const char *name = (const char *)sqlite3_column_text(ss, 1);
            const char *kind = (const char *)sqlite3_column_text(ss, 2);
            int line = sqlite3_column_int(ss, 3);
            if (!name || !kind || !is_entrypoint(p->cg, id, name, kind, paths[i]))
                continue;
            sb_printf(&b, "[claim.%d]\ntype     = \"symbol\"\n", ++nclaim);
            sb_puts(&b, "value    = "); sb_json_str(&b, name);
            sb_puts(&b, "\ndocument = \"\"\nevidence = ");
            char ev[700]; snprintf(ev, sizeof ev, "%s:%d", paths[i], line);
            sb_json_str(&b, ev); sb_puts(&b, "\nrequired = true\n\n");
            sb_printf(&required, "[required.%d]\ntype = \"symbol\"\nvalue = ",
                      nclaim);
            sb_json_str(&required, name);
            sb_puts(&required, "\nevidence = "); sb_json_str(&required, ev);
            sb_puts(&required, "\n\n");
        }
        sqlite3_finalize(ss);
        sqlite3_stmt *rs = cg_prep(p->cg,
            "SELECT method,pattern,line FROM routes r JOIN files f ON "
            "f.id=r.file_id WHERE f.path=?1 ORDER BY line");
        sqlite3_bind_text(rs, 1, paths[i], -1, SQLITE_TRANSIENT);
        while (sqlite3_step(rs) == SQLITE_ROW) {
            const char *method = (const char *)sqlite3_column_text(rs, 0);
            const char *pattern = (const char *)sqlite3_column_text(rs, 1);
            int line = sqlite3_column_int(rs, 2);
            char value[700], ev[700];
            snprintf(value, sizeof value, "%s %s", method, pattern);
            snprintf(ev, sizeof ev, "%s:%d", paths[i], line);
            sb_printf(&b, "[claim.%d]\ntype     = \"route\"\n", ++nclaim);
            sb_puts(&b, "value    = "); sb_json_str(&b, value);
            sb_puts(&b, "\ndocument = \"\"\nevidence = ");
            sb_json_str(&b, ev); sb_puts(&b, "\nrequired = true\n\n");
            sb_printf(&required, "[required.%d]\ntype = \"route\"\nvalue = ",
                      nclaim);
            sb_json_str(&required, value);
            sb_puts(&required, "\nevidence = "); sb_json_str(&required, ev);
            sb_puts(&required, "\n\n");
        }
        sqlite3_finalize(rs);
    }
    for (int i = 0; i < np; i++) free(paths[i]);
    free(paths);
    if (nclaim == 0) {
        sb_puts(&b, "[claim.1]\ntype     = \"path\"\nvalue    = ");
        char spec_rel[512];
        snprintf(spec_rel, sizeof spec_rel, "spec/%s/spec.kvx", p->feature);
        sb_json_str(&b, spec_rel);
        sb_puts(&b, "\ndocument = \"\"\nevidence = ");
        sb_json_str(&b, spec_rel);
        sb_puts(&b, "\nrequired = true\n");
        sb_puts(&required, "[required.1]\ntype = \"path\"\nvalue = ");
        sb_json_str(&required, spec_rel);
        sb_puts(&required, "\nevidence = "); sb_json_str(&required, spec_rel);
        sb_putc(&required, '\n');
    }
    char required_path[4800];
    snprintf(required_path, sizeof required_path, "%s/required.kvx", p->dir);
    int rc = write_entire_file(required_path, required.p, required.len);
    if (rc == 0 && !claims_exist) rc = write_entire_file(path, b.p, b.len);
    sb_free(&b); sb_free(&required);
    return rc;
}

/* Read-only generation plan. It states audiences and safe targets explicitly
 * so a connector never has to guess what "write the docs" means. */
static int docs_plan(Cg *cg, bool json) {
    DocsProject p;
    if (docs_project_open(cg, &p) != 0) return 1;
    StrBuf invt, invj;
    int ninv = docs_inventory(&p, &invt, &invj);
    if (json) {
        StrBuf b; sb_init(&b);
        sb_puts(&b, "{\"feature\":"); sb_json_str(&b, p.feature);
        sb_puts(&b, ",\"mode\":"); sb_json_str(&b, p.mode);
        sb_puts(&b, ",\"status\":"); sb_json_str(&b, p.status);
        sb_puts(&b, ",\"generation\":");
        sb_json_str(&b, p.incremental ? "incremental" : "full-baseline");
        sb_puts(&b, ",\"audiences\":[");
        for (int i = 0; i < p.naudiences; i++) {
            if (i) sb_putc(&b, ',');
            sb_json_str(&b, p.audiences[i]);
        }
        sb_puts(&b, "],\"targets\":"); docs_targets_json(&p, &b);
        sb_puts(&b, ",\"inventory\":["); sb_puts(&b, invj.p); sb_puts(&b, "]}");
        sb_putc(&b, '\n'); fputs(b.p, stdout); sb_free(&b);
    } else {
        printf("documentation plan: %s\n", p.feature);
        printf("  mode: %s   status: %s   generation: %s\n", p.mode, p.status,
               p.incremental ? "incremental" : "full baseline");
        printf("  audiences:");
        for (int i = 0; i < p.naudiences; i++) printf(" %s", p.audiences[i]);
        printf("\n  targets:\n");
        for (int i = 0; i < p.ntargets; i++) printf("    - %s\n", p.targets[i]);
        printf("  existing documentation (%d):\n", ninv);
        fputs(invt.len ? invt.p : "    (none)\n", stdout);
        printf("  outputs: user guidance, developer guidance, release/migration "
               "notes, explicit exclusions\n");
    }
    sb_free(&invt); sb_free(&invj); docs_project_close(&p);
    return 0;
}

typedef struct { int argc; char **argv; bool json; } DocsSpecCall;
static int docs_call_spec(void *v) {
    DocsSpecCall *c = v;
    if (docs_feature_override) {
        char **args = xmalloc((size_t)(c->argc + 2) * sizeof *args);
        memcpy(args, c->argv, (size_t)c->argc * sizeof *args);
        args[c->argc] = "-f";
        args[c->argc + 1] = (char *)docs_feature_override;
        int rc = cmd_spec(c->argc + 2, args, c->json);
        free(args);
        return rc;
    }
    return cmd_spec(c->argc, c->argv, c->json);
}
typedef struct { Cg *cg; int which; const char *feature; } DocsCall;
static int docs_call_evidence(void *v) {
    DocsCall *c = v;
    switch (c->which) {
    case 0: return cmd_changelog(c->cg, 50, NULL);
    case 1: return cmd_changes(c->cg, 40, false);
    case 2: return cmd_routes(c->cg, NULL, false);
    case 3: return cmd_anchors(c->cg, false, false, false);
    case 4: return cmd_recall(c->cg, NULL, NULL, NULL, 12, false);
    case 5: return cmd_log(c->cg, 30, false);
    default: return cmd_context(c->cg, c->feature, 6000, 8, false);
    }
}

static void docs_append_capture(StrBuf *packet, StrBuf *ledger,
                                const char *title, const char *source,
                                int (*fn)(void *), void *arg) {
    char *out = NULL;
    int rc = cg_capture(&out, fn, arg);
    sb_printf(packet, "\n## %s\n\n", title);
    if (rc != 0 || !out || !out[0]) {
        sb_printf(packet, "Evidence unavailable from `%s` (exit %d). Treat "
                          "related claims as unresolved.\n", source, rc);
    } else {
        size_t n = strlen(out);
        size_t take = n > DOCS_EVIDENCE_CAP ? DOCS_EVIDENCE_CAP : n;
        sb_puts(packet, "```text\n");
        for (size_t i = 0; i < take; i++) sb_putc(packet, out[i]);
        if (take < n)
            sb_printf(packet, "\n... %zu bytes omitted by evidence budget\n",
                      n - take);
        if (take == 0 || out[take - 1] != '\n') sb_putc(packet, '\n');
        sb_puts(packet, "```\n");
    }
    if (ledger->len) sb_putc(ledger, ',');
    sb_puts(ledger, "{\"source\":"); sb_json_str(ledger, source);
    sb_printf(ledger, ",\"available\":%s,\"exit_code\":%d}",
              rc == 0 && out && out[0] ? "true" : "false", rc);
    free(out);
}

/* Materialize the bounded prompt consumed by the configured agent. The
 * packet and ledger are derived files; the feature spec remains normative. */
static int docs_packet(Cg *cg, bool json) {
    DocsProject p;
    if (docs_project_open(cg, &p) != 0) return 1;
    if (strcmp(p.mode, "legacy") == 0 || strcmp(p.mode, "off") == 0) {
        fprintf(stderr, "cg docs: documentation is %s — enable it with "
                        "`cg spec docs auto` or `manual`\n", p.mode);
        docs_project_close(&p); return 1;
    }
    if (strcmp(p.status, "waiting") == 0) {
        fprintf(stderr, "cg docs: documentation is waiting for all ordinary "
                        "tasks to qualify\n");
        docs_project_close(&p); return 1;
    }
    if (mkdirs(p.dir) != 0) {
        fprintf(stderr, "cg docs: cannot create %s\n", p.dir);
        docs_project_close(&p); return 1;
    }
    StrBuf packet, ledger, invt, invj;
    sb_init(&packet); sb_init(&ledger);
    int ninv = docs_inventory(&p, &invt, &invj);
    char revision[65]; runtime_workspace_revision(cg, revision);

    sb_printf(&packet, "# Codify documentation closure: %s\n\n", p.feature);
    sb_printf(&packet, "Generation: **%s**. Workspace baseline: `%s`.\n\n",
              p.incremental ? "incremental update" : "full baseline", revision);
    sb_puts(&packet,
        "Use this packet as evidence, then inspect exact repository sources "
        "when a claim needs more proof. Update both user-facing and "
        "developer-facing documentation. Preserve unrelated human material; "
        "do not delete or rename documents. Do not state a command, route, "
        "symbol, configuration, behavior, test result, or compatibility claim "
        "that the evidence cannot support. Record gaps as explicit unresolved "
        "items. Only edit configured targets.\n\nConfigured audiences:");
    for (int i = 0; i < p.naudiences; i++) sb_printf(&packet, " %s", p.audiences[i]);
    sb_puts(&packet, "\n\nConfigured targets:\n");
    for (int i = 0; i < p.ntargets; i++) sb_printf(&packet, "- `%s`\n", p.targets[i]);
    sb_printf(&packet, "\nExisting documentation (%d):\n%s", ninv,
              invt.len ? invt.p : "- none\n");

    size_t slen = 0;
    char *spec_body = read_entire_file(p.spec_path, &slen);
    sb_puts(&packet, "\n## Normative feature specification\n\n```kvx\n");
    if (spec_body) {
        size_t take = slen > DOCS_EVIDENCE_CAP ? DOCS_EVIDENCE_CAP : slen;
        for (size_t i = 0; i < take; i++) sb_putc(&packet, spec_body[i]);
        if (take < slen) sb_printf(&packet, "\n# ... %zu bytes omitted\n", slen-take);
    } else sb_puts(&packet, "# unavailable — claims depending on the spec are unresolved\n");
    sb_puts(&packet, "\n```\n");
    sb_puts(&ledger, "{\"source\":\"active feature spec\",\"available\":");
    sb_puts(&ledger, spec_body ? "true" : "false"); sb_putc(&ledger, '}');
    free(spec_body);

    char *tracev[] = { "trace" };
    DocsSpecCall trace = { 1, tracev, false };
    docs_append_capture(&packet, &ledger, "Task-to-code trace", "cg spec trace",
                        docs_call_spec, &trace);
    char *statusv[] = { "status" };
    DocsSpecCall status = { 1, statusv, false };
    docs_append_capture(&packet, &ledger, "Qualification state", "cg spec status",
                        docs_call_spec, &status);
    const char *titles[] = { "Snapshot changelog", "Changed public surface",
        "Framework routes", "Anchor coverage", "Decisions and outcomes",
        "Snapshot history", "Focused graph context" };
    const char *sources[] = { "cg changelog", "cg changes", "cg routes",
        "cg anchors", "cg recall", "cg log", "cg context <feature>" };
    for (int i = 0; i < 7; i++) {
        DocsCall call = { cg, i, p.feature };
        docs_append_capture(&packet, &ledger, titles[i], sources[i],
                            docs_call_evidence, &call);
    }
    sb_puts(&packet, "\n## Required closure\n\nAfter editing, run `cg docs check`. "
                     "Unsupported claims must remain explicitly unresolved; a "
                     "successful check is required before documentation can close. "
                     "Fill the coverage and document fields in the private claim "
                     "ledger before checking.\n");

    char packet_path[4800], ledger_path[4800], claims_path[4800];
    snprintf(packet_path, sizeof packet_path, "%s/packet.md", p.dir);
    snprintf(ledger_path, sizeof ledger_path, "%s/provenance.json", p.dir);
    snprintf(claims_path, sizeof claims_path, "%s/claims.kvx", p.dir);
    int rc = write_entire_file(packet_path, packet.p, packet.len);
    if (rc == 0) rc = docs_claims_template(&p, claims_path);
    StrBuf manifest; sb_init(&manifest);
    sb_puts(&manifest, "{\"version\":1,\"feature\":");
    sb_json_str(&manifest, p.feature);
    sb_puts(&manifest, ",\"generation\":");
    sb_json_str(&manifest, p.incremental ? "incremental" : "full-baseline");
    sb_puts(&manifest, ",\"workspace_revision\":"); sb_json_str(&manifest, revision);
    sb_puts(&manifest, ",\"packet\":");
    char packet_rel[512];
    snprintf(packet_rel, sizeof packet_rel, "%s/%s/packet.md", CG_DOCS_DIR,
             p.feature);
    sb_json_str(&manifest, packet_rel);
    sb_puts(&manifest, ",\"audience_sections\":{\"user\":[\"spec\","
                       "\"changelog\",\"routes\"],\"developer\":[\"trace\","
                       "\"changes\",\"anchors\",\"memory\"]},\"evidence\":[");
    sb_puts(&manifest, ledger.p);
    sb_puts(&manifest, "],\"claims\":[],\"unresolved\":[]}\n");
    if (rc == 0) rc = write_entire_file(ledger_path, manifest.p, manifest.len);
    if (rc != 0) fprintf(stderr, "cg docs: could not write evidence packet\n");
    else if (json) {
        StrBuf b; sb_init(&b);
        sb_puts(&b, "{\"feature\":"); sb_json_str(&b, p.feature);
        sb_puts(&b, ",\"packet_path\":"); sb_json_str(&b, packet_rel);
        sb_puts(&b, ",\"provenance_path\":");
        char prov_rel[512];
        snprintf(prov_rel, sizeof prov_rel, "%s/%s/provenance.json", CG_DOCS_DIR,
                 p.feature);
        sb_json_str(&b, prov_rel);
        sb_puts(&b, ",\"claims_path\":");
        char claims_rel[512];
        snprintf(claims_rel, sizeof claims_rel, "%s/%s/claims.kvx",
                 CG_DOCS_DIR, p.feature);
        sb_json_str(&b, claims_rel);
        sb_puts(&b, ",\"required_surface_path\":");
        char required_rel[512];
        snprintf(required_rel, sizeof required_rel, "%s/%s/required.kvx",
                 CG_DOCS_DIR, p.feature);
        sb_json_str(&b, required_rel);
        sb_puts(&b, ",\"workspace_revision\":"); sb_json_str(&b, revision);
        sb_puts(&b, ",\"packet\":"); sb_json_str(&b, packet.p);
        sb_puts(&b, "}\n"); fputs(b.p, stdout); sb_free(&b);
    } else {
        printf("wrote %s\nwrote %s\nwrote %s\n", packet_path, ledger_path,
               claims_path);
        fputs(packet.p, stdout);
    }
    sb_free(&manifest); sb_free(&packet); sb_free(&ledger);
    sb_free(&invt); sb_free(&invj); docs_project_close(&p);
    return rc == 0 ? 0 : 1;
}

typedef struct { int errors; int checks; StrBuf report; } DocsCheck;

static void docs_check_say(DocsCheck *c, bool ok, const char *fmt, ...) {
    c->checks++;
    if (!ok) c->errors++;
    sb_printf(&c->report, "%s  ", ok ? "ok" : "FAIL");
    va_list ap;
    va_start(ap, fmt);
    char msg[1200];
    vsnprintf(msg, sizeof msg, fmt, ap);
    va_end(ap);
    sb_puts(&c->report, msg);
    sb_putc(&c->report, '\n');
}

static bool docs_allowed_system_path(const DocsProject *p, const char *path) {
    char prefix[400];
    snprintf(prefix, sizeof prefix, "spec/%s/", p->feature);
    if (strncmp(path, prefix, strlen(prefix)) != 0) return false;
    const char *name = path + strlen(prefix);
    return strcmp(name, "spec.kvx") == 0 || strcmp(name, "requirements.md") == 0 ||
           strcmp(name, "design.md") == 0 || strcmp(name, "tasks.md") == 0;
}

static int docs_check_links(const DocsProject *p, const char *doc,
                            DocsCheck *c) {
    char abs[4800];
    snprintf(abs, sizeof abs, "%s/%s", p->root, doc);
    char *body = read_entire_file(abs, NULL);
    if (!body) { docs_check_say(c, false, "%s is unreadable", doc); return 1; }
    int bad = 0;
    const char *at = body;
    while ((at = strstr(at, "](")) != NULL) {
        const char *start = at + 2;
        const char *end = strchr(start, ')');
        if (!end) break;
        size_t n = (size_t)(end - start);
        if (n == 0 || n >= 1800) { at = end + 1; continue; }
        char link[1800];
        memcpy(link, start, n); link[n] = 0;
        if (link[0] == '<' && n > 1 && link[n - 1] == '>') {
            memmove(link, link + 1, n - 2); link[n - 2] = 0;
        }
        char *title = strstr(link, " \"");
        if (title) *title = 0;
        char *hash = strchr(link, '#'); if (hash) *hash = 0;
        char *query = strchr(link, '?'); if (query) *query = 0;
        if (!link[0] || link[0] == '#' || strstr(link, "://") ||
            strncmp(link, "mailto:", 7) == 0 ||
            strncmp(link, "data:", 5) == 0) { at = end + 1; continue; }
        char candidate[10000];
        if (link[0] == '/') snprintf(candidate, sizeof candidate, "%s%s",
                                     p->root, link);
        else {
            char dir[4096]; snprintf(dir, sizeof dir, "%s", doc);
            char *slash = strrchr(dir, '/');
            if (slash) *slash = 0; else dir[0] = 0;
            snprintf(candidate, sizeof candidate, "%s/%s%s%s", p->root, dir,
                     dir[0] ? "/" : "", link);
        }
        char resolved[4096];
        bool ok = realpath(candidate, resolved) != NULL &&
                  strncmp(resolved, p->root, strlen(p->root)) == 0 &&
                  (resolved[strlen(p->root)] == '/' ||
                   resolved[strlen(p->root)] == '\0');
        docs_check_say(c, ok, "%s local link %s", doc, link);
        if (!ok) bad++;
        at = end + 1;
    }
    free(body);
    return bad;
}

static bool docs_claim_evidence(const DocsProject *p, const char *evidence,
                                char rel[4096]) {
    snprintf(rel, 4096, "%s", evidence ? evidence : "");
    char *colon = strrchr(rel, ':');
    if (colon && colon[1]) {
        bool digits = true;
        for (char *q = colon + 1; *q; q++) if (!isdigit((unsigned char)*q)) digits = false;
        if (digits) *colon = 0;
    }
    return docs_regular(p, rel);
}

static int docs_check_claims(DocsProject *p, DocsCheck *c) {
    char path[4800];
    snprintf(path, sizeof path, "%s/claims.kvx", p->dir);
    /* Required coverage is derived afresh, not trusted from an editable file. */
    if (docs_claims_template(p, path) != 0) {
        docs_check_say(c, false, "cannot derive required public surface");
        return 1;
    }
    Kvx *claims = kvx_parse(path);
    if (!claims) {
        docs_check_say(c, false, "claim ledger is missing: %s", path);
        return 1;
    }
    const char *coverage_keys[] = { "user", "developer", "release_or_migration" };
    for (int i = 0; i < 3; i++) {
        char *doc = docs_str(claims, "coverage", coverage_keys[i], "");
        bool ok = doc[0] && docs_target_match(p, doc) && docs_regular(p, doc);
        docs_check_say(c, ok, "%s coverage mapped to %s", coverage_keys[i],
                       doc[0] ? doc : "(missing)");
        if (ok) docs_check_links(p, doc, c);
        free(doc);
    }
    char *exclusions = docs_str(claims, "coverage", "exclusions", "");
    docs_check_say(c, exclusions[0] != 0, "project exclusions are explicit");
    free(exclusions);
    char *unresolved = docs_str(claims, "coverage", "unresolved", "");
    docs_check_say(c, unresolved[0] == 0, "unresolved claims: %s",
                   unresolved[0] ? unresolved : "none");
    free(unresolved);

    char **ids = NULL;
    int n = kvx_subsections(claims, "claim", &ids);
    char **claim_types = xmalloc(sizeof(char *) * (size_t)(n > 0 ? n : 1));
    char **claim_values = xmalloc(sizeof(char *) * (size_t)(n > 0 ? n : 1));
    docs_check_say(c, n > 0, "claim ledger contains %d claim(s)", n);
    for (int i = 0; i < n; i++) {
        char sec[300]; snprintf(sec, sizeof sec, "claim.%s", ids[i]);
        char *type = docs_str(claims, sec, "type", "");
        char *value = docs_str(claims, sec, "value", "");
        char *doc = docs_str(claims, sec, "document", "");
        char *evidence = docs_str(claims, sec, "evidence", "");
        char erel[4096];
        bool mapped = doc[0] && docs_target_match(p, doc) && docs_regular(p, doc) &&
                      docs_string_in_file(p, doc, value);
        docs_check_say(c, mapped, "claim %s appears in mapped document %s",
                       value, doc[0] ? doc : "(missing)");
        bool evok = docs_claim_evidence(p, evidence, erel);
        docs_check_say(c, evok, "claim %s evidence %s", value,
                       evidence[0] ? evidence : "(missing)");
        bool grounded = false;
        if (strcmp(type, "path") == 0) grounded = docs_regular(p, value);
        else if (strcmp(type, "symbol") == 0)
            grounded = evok && docs_symbol_exists(p->cg, value, erel);
        else if (strcmp(type, "route") == 0)
            grounded = evok && docs_route_exists(p->cg, value, erel);
        else if (strcmp(type, "command") == 0)
            grounded = evok && docs_string_in_file(p, erel, value);
        docs_check_say(c, grounded, "claim %s resolves as %s", value,
                       type[0] ? type : "unknown type");
        claim_types[i] = type;
        claim_values[i] = value;
        free(doc); free(evidence); free(ids[i]);
    }
    free(ids);
    char required_path[4800];
    snprintf(required_path, sizeof required_path, "%s/required.kvx", p->dir);
    Kvx *required = kvx_parse(required_path);
    char **rids = NULL;
    int nr = required ? kvx_subsections(required, "required", &rids) : 0;
    docs_check_say(c, required != NULL && nr > 0,
                   "required public surface ledger contains %d item(s)", nr);
    for (int i = 0; i < nr; i++) {
        char sec[300]; snprintf(sec, sizeof sec, "required.%s", rids[i]);
        char *type = docs_str(required, sec, "type", "");
        char *value = docs_str(required, sec, "value", "");
        bool covered = false;
        for (int j = 0; j < n; j++)
            if (strcmp(type, claim_types[j]) == 0 &&
                strcmp(value, claim_values[j]) == 0) covered = true;
        docs_check_say(c, covered, "required %s %s is documented", type, value);
        free(type); free(value); free(rids[i]);
    }
    free(rids); kvx_free(required);
    for (int i = 0; i < n; i++) {
        free(claim_types[i]); free(claim_values[i]);
    }
    free(claim_types); free(claim_values);
    kvx_free(claims);
    return c->errors ? 1 : 0;
}

/* Deterministic closure gate: the agent may write prose, but only configured
 * documents with resolvable links and an evidence-mapped claim ledger pass. */
static int docs_check(Cg *cg, bool json) {
    DocsProject p;
    if (docs_project_open(cg, &p) != 0) return 1;
    DocsCheck c; memset(&c, 0, sizeof c); sb_init(&c.report);
    char packet[4800], provenance[4800], marker[4800], report_path[4800];
    snprintf(packet, sizeof packet, "%s/packet.md", p.dir);
    snprintf(provenance, sizeof provenance, "%s/provenance.json", p.dir);
    snprintf(marker, sizeof marker, "%s/verified", p.dir);
    snprintf(report_path, sizeof report_path, "%s/check.json", p.dir);
    docs_check_say(&c, docs_regular(&p, packet + strlen(p.root) + 1),
                   "evidence packet exists");
    docs_check_say(&c, docs_regular(&p, provenance + strlen(p.root) + 1),
                   "provenance manifest exists");

    char **changed = NULL;
    int nc = vcs_changed_paths(cg, NULL, &changed);
    int doc_changes = 0;
    for (int i = 0; i < nc; i++) {
        bool target = docs_target_match(&p, changed[i]);
        bool system = docs_allowed_system_path(&p, changed[i]);
        if (target) {
            bool exists = docs_regular(&p, changed[i]);
            docs_check_say(&c, exists, "documentation target preserved: %s",
                           changed[i]);
            if (exists) { doc_changes++; docs_check_links(&p, changed[i], &c); }
        } else {
            docs_check_say(&c, system, "changed path is in documentation scope: %s",
                           changed[i]);
        }
        free(changed[i]);
    }
    free(changed);
    docs_check_say(&c, doc_changes > 0,
                   "at least one configured document changed (%d)", doc_changes);
    docs_check_claims(&p, &c);

    if (mkdirs(p.dir) != 0) c.errors++;
    if (c.errors == 0) {
        char body[512];
        snprintf(body, sizeof body, "feature=%s\nchecked=%d\ntime_ms=%ld\n",
                 p.feature, c.checks, now_ms());
        if (write_entire_file(marker, body, strlen(body)) != 0) c.errors++;
    } else {
        unlink(marker); /* exact derived marker; a failed recheck revokes it */
    }
    StrBuf report; sb_init(&report);
    sb_printf(&report, "{\"feature\":");
    sb_json_str(&report, p.feature);
    sb_printf(&report, ",\"ok\":%s,\"checks\":%d,\"errors\":%d,\"report\":",
              c.errors == 0 ? "true" : "false", c.checks, c.errors);
    sb_json_str(&report, c.report.p ? c.report.p : "");
    sb_puts(&report, "}\n");
    write_entire_file(report_path, report.p, report.len);
    if (json) fputs(report.p, stdout);
    else {
        printf("documentation check: %s (%d checks, %d errors)\n",
               c.errors == 0 ? "PASS" : "FAIL", c.checks, c.errors);
        fputs(c.report.p ? c.report.p : "", stdout);
    }
    int rc = c.errors == 0 ? 0 : 1;
    sb_free(&report); sb_free(&c.report); docs_project_close(&p);
    return rc;
}

/* Provenance view for reviewers: source task snapshots and the dedicated
 * documentation snapshot remain distinct and visibly linked. */
static int docs_trace(Cg *cg, bool json) {
    DocsProject p;
    if (docs_project_open(cg, &p) != 0) return 1;
    char provenance_path[4800], claims_path[4800], baseline_path[4800];
    snprintf(provenance_path, sizeof provenance_path, "%s/provenance.json", p.dir);
    snprintf(claims_path, sizeof claims_path, "%s/claims.kvx", p.dir);
    snprintf(baseline_path, sizeof baseline_path, "%s/baseline.json", p.dir);
    char *provenance = read_entire_file(provenance_path, NULL);
    char *claims = read_entire_file(claims_path, NULL);
    char *baseline = read_entire_file(baseline_path, NULL);
    char source_tag[400], docs_tag[400];
    snprintf(source_tag, sizeof source_tag, "[spec:%s/", p.feature);
    snprintf(docs_tag, sizeof docs_tag, "[spec:%s/%s]", p.feature, CG_DOC_TASK);
    char **sids = NULL, **smsgs = NULL, **dids = NULL, **dmsgs = NULL;
    long *sdates = NULL, *ddates = NULL;
    int ns = vcs_find_commits(cg, source_tag, &sids, &smsgs, &sdates);
    int nd = vcs_find_commits(cg, docs_tag, &dids, &dmsgs, &ddates);
    if (json) {
        StrBuf b; sb_init(&b);
        sb_puts(&b, "{\"feature\":"); sb_json_str(&b, p.feature);
        sb_puts(&b, ",\"status\":"); sb_json_str(&b, p.status);
        sb_puts(&b, ",\"provenance\":");
        if (provenance) sb_puts(&b, provenance); else sb_puts(&b, "null");
        if (b.len && b.p[b.len - 1] == '\n') { b.p[--b.len] = 0; }
        sb_puts(&b, ",\"claims\":");
        if (claims) sb_json_str(&b, claims); else sb_puts(&b, "null");
        sb_puts(&b, ",\"baseline\":");
        if (baseline) sb_puts(&b, baseline); else sb_puts(&b, "null");
        if (b.len && b.p[b.len - 1] == '\n') { b.p[--b.len] = 0; }
        sb_puts(&b, ",\"source_commits\":[");
        for (int i = 0; i < ns; i++) {
            if (i) sb_putc(&b, ',');
            sb_puts(&b, "{\"id\":");
            sb_json_str(&b, sids[i]); sb_puts(&b, ",\"message\":");
            sb_json_str(&b, smsgs[i]); sb_putc(&b, '}');
        }
        sb_puts(&b, "],\"documentation_commits\":[");
        for (int i = 0; i < nd; i++) {
            if (i) sb_putc(&b, ',');
            sb_puts(&b, "{\"id\":");
            sb_json_str(&b, dids[i]); sb_puts(&b, ",\"message\":");
            sb_json_str(&b, dmsgs[i]); sb_putc(&b, '}');
        }
        sb_puts(&b, "]}\n"); fputs(b.p, stdout); sb_free(&b);
    } else {
        printf("documentation trace: %s (%s)\n", p.feature, p.status);
        printf("source task snapshots: %d\n", ns);
        for (int i = 0; i < ns; i++) printf("  %.12s  %s\n", sids[i], smsgs[i]);
        printf("documentation snapshots: %d\n", nd);
        for (int i = 0; i < nd; i++) printf("  %.12s  %s\n", dids[i], dmsgs[i]);
        printf("provenance: %s\nclaims: %s\nbaseline: %s\n", provenance_path,
               claims_path, baseline ? baseline_path : "(not closed)");
    }
    for (int i = 0; i < ns; i++) { free(sids[i]); free(smsgs[i]); }
    for (int i = 0; i < nd; i++) { free(dids[i]); free(dmsgs[i]); }
    free(sids); free(smsgs); free(sdates); free(dids); free(dmsgs); free(ddates);
    free(provenance); free(claims); free(baseline); docs_project_close(&p);
    return 0;
}

/* Snapshot before completion; a failed snapshot retains the live attempt. */
static int docs_call_check(void *v) { return docs_check((Cg *)v, false); }
static int docs_call_finish(void *v) {
    DocsProject *p = v;
    return spec_docs_finish(p->cg, p->feature);
}

static int docs_close(Cg *cg, bool json) {
    DocsProject p;
    if (docs_project_open(cg, &p) != 0) return 1;
    if (strcmp(p.status, "in_progress") != 0) {
        fprintf(stderr, "cg docs: documentation is %s — run `cg spec docs "
                        "start` first\n", p.status);
        docs_project_close(&p); return 1;
    }
    char *check_out = NULL;
    if (cg_capture(&check_out, docs_call_check, cg) != 0) {
        if (check_out) fputs(check_out, stderr);
        free(check_out); docs_project_close(&p); return 1;
    }
    free(check_out);
    char *done_out = NULL;
    if (cg_capture(&done_out, docs_call_finish, &p) != 0) {
        if (done_out) fputs(done_out, stderr);
        free(done_out); docs_project_close(&p); return 1;
    }
    free(done_out);
    char revision[65]; runtime_workspace_revision(cg, revision);
    char baseline_path[4800];
    snprintf(baseline_path, sizeof baseline_path, "%s/baseline.json", p.dir);
    StrBuf baseline; sb_init(&baseline);
    sb_puts(&baseline, "{\"feature\":"); sb_json_str(&baseline, p.feature);
    sb_puts(&baseline, ",\"workspace_revision\":"); sb_json_str(&baseline, revision);
    sb_printf(&baseline, ",\"closed_at_ms\":%ld}\n", now_ms());
    int baseline_rc = write_entire_file(baseline_path, baseline.p, baseline.len);
    snprintf(baseline_path, sizeof baseline_path, "%s/%s/baseline.json",
             p.root, CG_DOCS_DIR);
    if (write_entire_file(baseline_path, baseline.p, baseline.len) != 0 || baseline_rc != 0)
        fprintf(stderr, "cg docs: warning: snapshot closed, but incremental "
                        "baseline could not be persisted\n");
    if (json) {
        printf("{\"closed\":true,\"feature\":\"%s\","
               "\"task\":\"%s\",\"workspace_revision\":\"%s\"}\n",
               p.feature, CG_DOC_TASK, revision);
    } else printf("documentation closed: %s (%s)\n", p.feature, CG_DOC_TASK);
    sb_free(&baseline); docs_project_close(&p);
    return 0;
}

int cmd_docs(Cg *cg, int argc, char **argv, bool json) {
    const char *sub = "status";
    bool action = false;
    docs_feature_override = NULL;
    for (int i = 0; i < argc; i++) {
        if (strcmp(argv[i], "-f") == 0 && i + 1 < argc)
            docs_feature_override = argv[++i];
        else if (!action && argv[i][0] != '-') { sub = argv[i]; action = true; }
        else {
            fprintf(stderr, "cg docs: unexpected argument %s\n", argv[i]);
            docs_feature_override = NULL;
            return 1;
        }
    }
    int rc;
    if (strcmp(sub, "status") == 0 || strcmp(sub, "plan") == 0)
        rc = docs_plan(cg, json);
    else if (strcmp(sub, "packet") == 0 || strcmp(sub, "generate") == 0)
        rc = docs_packet(cg, json);
    else if (strcmp(sub, "check") == 0) rc = docs_check(cg, json);
    else if (strcmp(sub, "trace") == 0) rc = docs_trace(cg, json);
    else if (strcmp(sub, "close") == 0) rc = docs_close(cg, json);
    else {
        fprintf(stderr, "usage: cg docs [status|plan|packet|generate|check|trace|close] [-f feature]\n");
        rc = 1;
    }
    docs_feature_override = NULL;
    return rc;
}
