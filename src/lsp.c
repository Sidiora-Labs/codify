/*
 * `cg lsp` — a Language Server over the Codify graph.
 *
 * The VS Code extension shells out to the CLI, which means every other editor
 * gets nothing. One LSP server covers Neovim, Zed, JetBrains, Emacs, Helix and
 * Sublime at once, and it is also the only way Codify's governance becomes
 * ambient: scope drift and spec staleness arrive as squiggles in the editor
 * instead of waiting for someone to run a command.
 *
 * Transport is Content-Length framed JSON-RPC 2.0 on stdio, per the LSP spec.
 * Reading reuses json.c, the same minimal scanner the MCP server uses.
 */
#include "cg.h"
#include <ctype.h>
#include <unistd.h>
#include <sys/stat.h>
#include <fnmatch.h>

/* LSP SymbolKind: 12 = Function. The graph's kinds are heuristic, so one
 * honest value beats a wrong-looking taxonomy. */
#define LSP_KIND_FN 12

/* ---------------- framing ---------------- */

/* Read one Content-Length framed message. Returns a malloc'd body, or NULL at
 * end of stream. Headers other than Content-Length are skipped. */
static char *lsp_read(void) {
    char line[512];
    long len = -1;
    for (;;) {
        if (!fgets(line, sizeof line, stdin)) return NULL;
        if (line[0] == '\r' || line[0] == '\n') {
            if (len >= 0) break;            /* blank line ends the header */
            continue;
        }
        if (strncasecmp(line, "Content-Length:", 15) == 0)
            len = atol(line + 15);
    }
    if (len < 0 || len > 64L * 1024 * 1024) return NULL;
    char *body = xmalloc((size_t)len + 1);
    size_t got = fread(body, 1, (size_t)len, stdin);
    body[got] = 0;
    return body;
}

static void lsp_send(const char *payload) {
    printf("Content-Length: %zu\r\n\r\n%s", strlen(payload), payload);
    fflush(stdout);
}

static void lsp_reply(const char *id, const char *result) {
    StrBuf b; sb_init(&b);
    sb_printf(&b, "{\"jsonrpc\":\"2.0\",\"id\":%s,\"result\":%s}", id, result);
    lsp_send(b.p);
    sb_free(&b);
}

static void lsp_notify(const char *method, const char *params) {
    StrBuf b; sb_init(&b);
    sb_printf(&b, "{\"jsonrpc\":\"2.0\",\"method\":\"%s\",\"params\":%s}",
              method, params);
    lsp_send(b.p);
    sb_free(&b);
}

/* ---------------- uri <-> path ---------------- */

static void uri_to_path(const char *uri, char *out, size_t cap) {
    const char *p = strncmp(uri, "file://", 7) == 0 ? uri + 7 : uri;
    size_t o = 0;
    for (; *p && o + 1 < cap; p++) {
        if (*p == '%' && isxdigit((unsigned char)p[1]) &&
            isxdigit((unsigned char)p[2])) {
            char hex[3] = { p[1], p[2], 0 };
            out[o++] = (char)strtol(hex, NULL, 16);
            p += 2;
        } else {
            out[o++] = *p;
        }
    }
    out[o] = 0;
}

static void path_to_uri(const char *root, const char *rel, StrBuf *b) {
    StrBuf u; sb_init(&u);
    sb_printf(&u, "file://%s/%s", root, rel);
    sb_json_str(b, u.p);
    sb_free(&u);
}

/* repo-relative path for an absolute one, or NULL when outside the project */
static const char *rel_of(const Cg *cg, const char *abs) {
    size_t rl = strlen(cg->root);
    if (strncmp(abs, cg->root, rl) == 0 && abs[rl] == '/') return abs + rl + 1;
    return NULL;
}

/* ---------------- graph lookups ---------------- */

static void emit_location(Cg *cg, StrBuf *b, const char *path, int line,
                          int end_line) {
    sb_puts(b, "{\"uri\":");
    path_to_uri(cg->root, path, b);
    /* LSP positions are zero-based; the graph stores one-based lines */
    sb_printf(b, ",\"range\":{\"start\":{\"line\":%d,\"character\":0},"
                 "\"end\":{\"line\":%d,\"character\":0}}}",
              line > 0 ? line - 1 : 0,
              (end_line > line ? end_line : line) > 0
                  ? (end_line > line ? end_line : line) - 1 : 0);
}

/* the identifier under a zero-based line/character in a file on disk */
static bool word_at(const char *abs, int line0, int chr, char *out, size_t cap) {
    char *data = read_entire_file(abs, NULL);
    if (!data) return false;
    const char *p = data;
    for (int i = 0; i < line0 && p; i++) {
        p = strchr(p, '\n');
        if (p) p++;
    }
    if (!p) { free(data); return false; }
    const char *eol = strchr(p, '\n');
    size_t ll = eol ? (size_t)(eol - p) : strlen(p);
    if ((size_t)chr > ll) { free(data); return false; }
    size_t s = (size_t)chr, e = (size_t)chr;
    while (s > 0 && (isalnum((unsigned char)p[s-1]) || p[s-1] == '_')) s--;
    while (e < ll && (isalnum((unsigned char)p[e]) || p[e] == '_')) e++;
    if (e == s) { free(data); return false; }
    snprintf(out, cap, "%.*s", (int)(e - s), p + s);
    free(data);
    return true;
}

/* ---------------- hover ---------------- */

/* Hover is where Codify's four layers meet: what the symbol is, who depends
 * on it, which task owns it, and what was decided about it. Seeing that on a
 * mouse-over is the whole product in one gesture. */
void lsp_hover(Cg *cg, const char *name, StrBuf *md) {
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT s.kind,f.path,s.line,s.sig FROM symbols s "
        "JOIN files f ON f.id=s.file_id WHERE s.name=? ORDER BY s.line LIMIT 3");
    sqlite3_bind_text(st, 1, name, -1, SQLITE_STATIC);
    int n = 0;
    while (sqlite3_step(st) == SQLITE_ROW) {
        const char *kind = (const char *)sqlite3_column_text(st, 0);
        const char *path = (const char *)sqlite3_column_text(st, 1);
        int line = sqlite3_column_int(st, 2);
        const char *sig = (const char *)sqlite3_column_text(st, 3);
        if (!n) sb_printf(md, "**%s** *(%s)*\n\n", name, kind ? kind : "");
        if (sig && sig[0]) sb_printf(md, "```\n%s\n```\n", sig);
        sb_printf(md, "`%s:%d`\n\n", path, line);
        n++;
    }
    sqlite3_finalize(st);
    if (!n) return;

    sqlite3_stmt *rc = cg_prep(cg, "SELECT COUNT(*) FROM refs WHERE name=?");
    sqlite3_bind_text(rc, 1, name, -1, SQLITE_STATIC);
    int refs = 0;
    if (sqlite3_step(rc) == SQLITE_ROW) refs = sqlite3_column_int(rc, 0);
    sqlite3_finalize(rc);
    sb_printf(md, "%d reference%s", refs, refs == 1 ? "" : "s");

    Memory *mem = NULL;
    int nm = memory_query(cg, name, NULL, NULL, 3, &mem);
    if (nm) {
        sb_puts(md, "\n\n---\n\n**Decisions recorded here**\n\n");
        for (int i = 0; i < nm; i++)
            sb_printf(md, "- *%s*: %s\n", mem[i].type, mem[i].body);
    }
    memory_free(mem, nm);
}

/* ---------------- diagnostics ---------------- */

/* Diagnostics are how governance stops being a command someone remembers to
 * run. A kvx syntax error, a stale render, or an edit outside the task's
 * declared scope all show up as squiggles while you type. */
static void diag_add(StrBuf *b, int *n, int line, int severity,
                     const char *code, const char *msg) {
    if ((*n)++) sb_putc(b, ',');
    sb_printf(b, "{\"range\":{\"start\":{\"line\":%d,\"character\":0},"
                 "\"end\":{\"line\":%d,\"character\":200}},\"severity\":%d,"
                 "\"source\":\"codify\",\"code\":", line, line, severity);
    sb_json_str(b, code);
    sb_puts(b, ",\"message\":");
    sb_json_str(b, msg);
    sb_putc(b, '}');
}

/* Is this file inside what the in-progress task declared it would touch?
 * A task that declares nothing puts nothing out of scope. */
bool lsp_path_in_task_scope(Cg *cg, const char *rel) {
    (void)cg;
    char **pats = NULL;
    int n = spec_active_touches(&pats);
    if (n == 0) { free(pats); return true; }
    bool hit = false;
    for (int i = 0; i < n; i++) {
        if (!hit) {
            size_t pl = strlen(pats[i]);
            if (fnmatch(pats[i], rel, 0) == 0 || strcmp(pats[i], rel) == 0 ||
                (strncmp(rel, pats[i], pl) == 0 &&
                 (rel[pl] == '/' || rel[pl] == 0)))
                hit = true;
        }
        free(pats[i]);
    }
    free(pats);
    return hit;
}

void lsp_diagnostics(Cg *cg, const char *abs, StrBuf *out) {
    int n = 0;
    sb_puts(out, "[");
    const char *rel = rel_of(cg, abs);
    const char *ext = path_ext(abs);

    /* a kvx file that will not parse silently disables every spec command */
    if (ext && strcmp(ext, ".kvx") == 0) {   /* path_ext keeps the dot */
        Kvx *k = kvx_parse(abs);
        if (!k)
            diag_add(out, &n, 0, 1, "kvx-parse",
                     "Cannot parse this kvx file - cg spec commands will "
                     "refuse to run against it.");
        else
            kvx_free(k);
    }

    /* scope drift, surfaced where the edit happens rather than at review */
    if (rel && !lsp_path_in_task_scope(cg, rel)) {
        char *tag = spec_active_tag();
        if (tag) {
            char *slash = strrchr(tag, '/');
            const char *id = slash ? slash + 1 : tag;
            StrBuf m; sb_init(&m);
            sb_printf(&m, "Outside the scope task %s declared in its "
                          "`touches`. Add it with `cg spec add ... --touches`, "
                          "or switch to a task that owns this file.", id);
            diag_add(out, &n, 0, 2, "scope-drift", m.p);
            sb_free(&m);
            free(tag);
        }
    }
    /* grounding and contract findings for the open file */
    if (rel) {
        GroundFinding *gf = NULL;
        int ng = ground_findings(cg, rel, &gf);
        for (int g = 0; g < ng; g++)
            diag_add(out, &n, gf[g].line > 0 ? gf[g].line - 1 : 0, 2,
                     "ungrounded", gf[g].detail);
        ground_findings_free(gf, ng);

        ContractFinding *cf = NULL;
        int nc = contract_findings(cg, rel, &cf);
        for (int c = 0; c < nc; c++)
            diag_add(out, &n, cf[c].line > 0 ? cf[c].line - 1 : 0, 2,
                     cf[c].kind, cf[c].detail);
        contract_findings_free(cf, nc);
    }
    sb_puts(out, "]");
}

/* ---------------- server ---------------- */

static void publish_diagnostics(Cg *cg, const char *uri, const char *abs) {
    StrBuf d; sb_init(&d);
    lsp_diagnostics(cg, abs, &d);
    StrBuf p; sb_init(&p);
    sb_puts(&p, "{\"uri\":");
    sb_json_str(&p, uri);
    sb_printf(&p, ",\"diagnostics\":%s}", d.p);
    lsp_notify("textDocument/publishDiagnostics", p.p);
    sb_free(&p);
    sb_free(&d);
}

/* the identifier a request points at: params.textDocument.uri + position */
static bool request_word(Cg *cg, const char *params, char *word, size_t wcap,
                         char *abs, size_t acap) {
    char *td = json_get_object(params, "textDocument");
    char *uri = td ? json_get_string(td, "uri") : NULL;
    char *pos = json_get_object(params, "position");
    bool ok = false;
    if (uri && pos) {
        uri_to_path(uri, abs, acap);
        int line = (int)json_get_int(pos, "line", 0);
        int chr  = (int)json_get_int(pos, "character", 0);
        ok = word_at(abs, line, chr, word, wcap);
        /* fall back to whatever symbol encloses the cursor */
        if (!ok) {
            const char *rel = rel_of(cg, abs);
            if (rel) ok = graph_symbol_at(cg, rel, line + 1, word, wcap) == 0;
        }
    }
    free(td); free(uri); free(pos);
    return ok;
}

int cmd_lsp(Cg *cg, const SysInfo *si) {
    char *body;
    bool shutting_down = false;
    while ((body = lsp_read())) {
        char *method = json_get_string(body, "method");
        char *id = json_get_raw(body, "id");
        char *params = json_get_object(body, "params");
        if (!method) { free(id); free(params); free(body); continue; }

        if (strcmp(method, "initialize") == 0 && id) {
            /* Everything here is answered from the graph, so the server needs
             * no compiler, no toolchain, and no project configuration. */
            lsp_reply(id,
                "{\"capabilities\":{"
                "\"positionEncoding\":\"utf-16\","
                "\"textDocumentSync\":{\"openClose\":true,\"change\":0,"
                "\"save\":{\"includeText\":false}},"
                "\"definitionProvider\":true,"
                "\"referencesProvider\":true,"
                "\"hoverProvider\":true,"
                "\"documentSymbolProvider\":true,"
                "\"workspaceSymbolProvider\":true,"
                "\"codeLensProvider\":{\"resolveProvider\":false}},"
                "\"serverInfo\":{\"name\":\"codify\",\"version\":\""
                CG_VERSION "\"}}");
        } else if (strcmp(method, "initialized") == 0) {
            /* first sync so answers are current from the first keystroke */
            IndexStats st;
            cg_index(cg, si, false, &st, true);
        } else if (strcmp(method, "shutdown") == 0 && id) {
            shutting_down = true;
            lsp_reply(id, "null");
        } else if (strcmp(method, "exit") == 0) {
            free(method); free(id); free(params); free(body);
            return shutting_down ? 0 : 1;
        } else if (strcmp(method, "textDocument/didOpen") == 0 ||
                   strcmp(method, "textDocument/didSave") == 0) {
            char *td = params ? json_get_object(params, "textDocument") : NULL;
            char *uri = td ? json_get_string(td, "uri") : NULL;
            if (uri) {
                char abs[4096];
                uri_to_path(uri, abs, sizeof abs);
                IndexStats st;
                cg_index(cg, si, false, &st, true);   /* keep the graph fresh */
                publish_diagnostics(cg, uri, abs);
            }
            free(td); free(uri);
        } else if (strcmp(method, "textDocument/definition") == 0 && id) {
            char word[256], abs[4096];
            StrBuf r; sb_init(&r);
            sb_putc(&r, '[');
            if (params && request_word(cg, params, word, sizeof word, abs,
                                       sizeof abs)) {
                sqlite3_stmt *st = cg_prep(cg,
                    "SELECT f.path,s.line,s.end_line FROM symbols s "
                    "JOIN files f ON f.id=s.file_id WHERE s.name=? LIMIT 20");
                sqlite3_bind_text(st, 1, word, -1, SQLITE_STATIC);
                int n = 0;
                while (sqlite3_step(st) == SQLITE_ROW) {
                    if (n++) sb_putc(&r, ',');
                    emit_location(cg, &r, (const char *)sqlite3_column_text(st, 0),
                                  sqlite3_column_int(st, 1),
                                  sqlite3_column_int(st, 2));
                }
                sqlite3_finalize(st);
            }
            sb_putc(&r, ']');
            lsp_reply(id, r.p);
            sb_free(&r);
        } else if (strcmp(method, "textDocument/references") == 0 && id) {
            char word[256], abs[4096];
            StrBuf r; sb_init(&r);
            sb_putc(&r, '[');
            if (params && request_word(cg, params, word, sizeof word, abs,
                                       sizeof abs)) {
                sqlite3_stmt *st = cg_prep(cg,
                    "SELECT f.path,r.line FROM refs r "
                    "JOIN files f ON f.id=r.file_id WHERE r.name=? "
                    "ORDER BY f.path,r.line LIMIT 500");
                sqlite3_bind_text(st, 1, word, -1, SQLITE_STATIC);
                int n = 0;
                while (sqlite3_step(st) == SQLITE_ROW) {
                    if (n++) sb_putc(&r, ',');
                    int ln = sqlite3_column_int(st, 1);
                    emit_location(cg, &r,
                                  (const char *)sqlite3_column_text(st, 0),
                                  ln, ln);
                }
                sqlite3_finalize(st);
            }
            sb_putc(&r, ']');
            lsp_reply(id, r.p);
            sb_free(&r);
        } else if (strcmp(method, "textDocument/hover") == 0 && id) {
            char word[256], abs[4096];
            if (params && request_word(cg, params, word, sizeof word, abs,
                                       sizeof abs)) {
                StrBuf md; sb_init(&md);
                lsp_hover(cg, word, &md);
                if (md.len) {
                    StrBuf r; sb_init(&r);
                    sb_puts(&r, "{\"contents\":{\"kind\":\"markdown\","
                                "\"value\":");
                    sb_json_str(&r, md.p);
                    sb_puts(&r, "}}");
                    lsp_reply(id, r.p);
                    sb_free(&r);
                } else {
                    lsp_reply(id, "null");
                }
                sb_free(&md);
            } else {
                lsp_reply(id, "null");
            }
        } else if (strcmp(method, "workspace/symbol") == 0 && id) {
            char *q = params ? json_get_string(params, "query") : NULL;
            StrBuf r; sb_init(&r);
            sb_putc(&r, '[');
            sqlite3_stmt *st = cg_prep(cg,
                "SELECT s.name,s.kind,f.path,s.line,s.end_line FROM symbols s "
                "JOIN files f ON f.id=s.file_id "
                "WHERE ?1='' OR s.name LIKE '%'||?1||'%' "
                "ORDER BY length(s.name) LIMIT 200");
            sqlite3_bind_text(st, 1, q ? q : "", -1, SQLITE_TRANSIENT);
            int n = 0;
            while (sqlite3_step(st) == SQLITE_ROW) {
                if (n++) sb_putc(&r, ',');
                sb_puts(&r, "{\"name\":");
                sb_json_str(&r, (const char *)sqlite3_column_text(st, 0));
                sb_printf(&r, ",\"kind\":%d,\"location\":", LSP_KIND_FN);
                emit_location(cg, &r, (const char *)sqlite3_column_text(st, 2),
                              sqlite3_column_int(st, 3),
                              sqlite3_column_int(st, 4));
                sb_putc(&r, '}');
            }
            sqlite3_finalize(st);
            sb_putc(&r, ']');
            lsp_reply(id, r.p);
            sb_free(&r);
            free(q);
        } else if (strcmp(method, "textDocument/documentSymbol") == 0 && id) {
            char *td = params ? json_get_object(params, "textDocument") : NULL;
            char *uri = td ? json_get_string(td, "uri") : NULL;
            StrBuf r; sb_init(&r);
            sb_putc(&r, '[');
            if (uri) {
                char abs[4096];
                uri_to_path(uri, abs, sizeof abs);
                const char *rel = rel_of(cg, abs);
                if (rel) {
                    sqlite3_stmt *st = cg_prep(cg,
                        "SELECT s.name,s.line,s.end_line FROM symbols s "
                        "JOIN files f ON f.id=s.file_id WHERE f.path=? "
                        "ORDER BY s.line");
                    sqlite3_bind_text(st, 1, rel, -1, SQLITE_STATIC);
                    int n = 0;
                    while (sqlite3_step(st) == SQLITE_ROW) {
                        int ln = sqlite3_column_int(st, 1);
                        int en = sqlite3_column_int(st, 2);
                        if (n++) sb_putc(&r, ',');
                        sb_puts(&r, "{\"name\":");
                        sb_json_str(&r, (const char *)sqlite3_column_text(st, 0));
                        sb_printf(&r, ",\"kind\":%d,\"range\":{"
                            "\"start\":{\"line\":%d,\"character\":0},"
                            "\"end\":{\"line\":%d,\"character\":0}},"
                            "\"selectionRange\":{"
                            "\"start\":{\"line\":%d,\"character\":0},"
                            "\"end\":{\"line\":%d,\"character\":0}}}",
                            LSP_KIND_FN, ln > 0 ? ln - 1 : 0,
                            (en > ln ? en : ln) > 0 ? (en > ln ? en : ln) - 1 : 0,
                            ln > 0 ? ln - 1 : 0, ln > 0 ? ln - 1 : 0);
                    }
                    sqlite3_finalize(st);
                }
            }
            sb_putc(&r, ']');
            lsp_reply(id, r.p);
            sb_free(&r);
            free(td); free(uri);
        } else if (strcmp(method, "textDocument/codeLens") == 0 && id) {
            /* A lens above each definition: how many callers, and whether any
             * test touches it. Coverage gaps become visible while reading. */
            char *td = params ? json_get_object(params, "textDocument") : NULL;
            char *uri = td ? json_get_string(td, "uri") : NULL;
            StrBuf r; sb_init(&r);
            sb_putc(&r, '[');
            if (uri) {
                char abs[4096];
                uri_to_path(uri, abs, sizeof abs);
                const char *rel = rel_of(cg, abs);
                if (rel) {
                    sqlite3_stmt *st = cg_prep(cg,
                        "SELECT s.name,s.line,"
                        " (SELECT COUNT(*) FROM refs r WHERE r.name=s.name),"
                        " (SELECT COUNT(*) FROM refs r2 JOIN files tf "
                        "   ON tf.id=r2.file_id WHERE r2.name=s.name AND "
                        "   (tf.path LIKE 'test%' OR tf.path LIKE 'tests%' OR "
                        "    tf.path LIKE '%/test%' OR tf.path LIKE '%.test.%' "
                        "    OR tf.path LIKE '%_test.%')) "
                        "FROM symbols s JOIN files f ON f.id=s.file_id "
                        "WHERE f.path=? AND s.kind IN ('function','method',"
                        "'class') ORDER BY s.line LIMIT 300");
                    sqlite3_bind_text(st, 1, rel, -1, SQLITE_STATIC);
                    int n = 0;
                    while (sqlite3_step(st) == SQLITE_ROW) {
                        int ln = sqlite3_column_int(st, 1);
                        int refs = sqlite3_column_int(st, 2);
                        int tests = sqlite3_column_int(st, 3);
                        StrBuf t; sb_init(&t);
                        sb_printf(&t, "%d reference%s", refs,
                                  refs == 1 ? "" : "s");
                        sb_printf(&t, tests ? "  ·  %d test reference%s"
                                            : "  ·  no test references",
                                  tests, tests == 1 ? "" : "s");
                        if (n++) sb_putc(&r, ',');
                        sb_printf(&r, "{\"range\":{"
                            "\"start\":{\"line\":%d,\"character\":0},"
                            "\"end\":{\"line\":%d,\"character\":0}},"
                            "\"command\":{\"title\":",
                            ln > 0 ? ln - 1 : 0, ln > 0 ? ln - 1 : 0);
                        sb_json_str(&r, t.p);
                        sb_puts(&r, ",\"command\":\"\"}}");
                        sb_free(&t);
                    }
                    sqlite3_finalize(st);
                }
            }
            sb_putc(&r, ']');
            lsp_reply(id, r.p);
            sb_free(&r);
            free(td); free(uri);
        } else {
            if (id) lsp_reply(id, "null");  /* unimplemented: answer, not hang */
        }
        free(method); free(id); free(params); free(body);
    }
    return 0;
}
