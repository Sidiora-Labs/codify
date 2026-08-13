/*
 * MCP (Model Context Protocol) stdio server + auto-install.
 *
 * `cg mcp`         — newline-delimited JSON-RPC 2.0 on stdin/stdout,
 *                    exposing the graph as tools. The graph is incrementally
 *                    synced before every read so answers are always fresh.
 * `cg mcp-install` — writes/merges Codify into the MCP configs of popular
 *                    coding agents (Claude Code, Cursor, VS Code, Windsurf,
 *                    Gemini CLI, Codex CLI).
 */
#include "cg.h"
#include <unistd.h>
#include <sys/stat.h>

/* ---------------- tool table ---------------- */

typedef struct {
    Cg *cg;
    const SysInfo *si;
    const char *args;      /* arguments object, or NULL */
} CallCtx;

static int t_search(void *v) {
    CallCtx *c = v;
    char *q = c->args ? json_get_string(c->args, "query") : NULL;
    if (!q) { printf("{\"error\":\"missing query\"}\n"); return 1; }
    int limit = (int)json_get_int(c->args, "limit", 20);
    int rc = cmd_search(c->cg, q, limit > 0 ? limit : 20, true);
    free(q);
    return rc;
}
static int t_context(void *v) {
    CallCtx *c = v;
    char *q = c->args ? json_get_string(c->args, "query") : NULL;
    if (!q) { printf("{\"error\":\"missing query\"}\n"); return 1; }
    int rc = cmd_context(c->cg, q, true);
    free(q);
    return rc;
}
static int t_symbol(void *v) {
    CallCtx *c = v;
    char *n = c->args ? json_get_string(c->args, "name") : NULL;
    if (!n) { printf("{\"error\":\"missing name\"}\n"); return 1; }
    int rc = cmd_symbol(c->cg, n, true);
    free(n);
    return rc;
}
static int t_impact(void *v) {
    CallCtx *c = v;
    char *n = c->args ? json_get_string(c->args, "name") : NULL;
    if (!n) { printf("{\"error\":\"missing name\"}\n"); return 1; }
    int depth = (int)json_get_int(c->args, "depth", 3);
    int rc = cmd_impact(c->cg, n, depth > 0 ? depth : 3, true);
    free(n);
    return rc;
}
static int t_routes(void *v) {
    CallCtx *c = v;
    char *f = c->args ? json_get_string(c->args, "filter") : NULL;
    int rc = cmd_routes(c->cg, f, true);
    free(f);
    return rc;
}
static int t_status(void *v)  { CallCtx *c = v; return cmd_status(c->cg, true); }
static int t_changes(void *v) { CallCtx *c = v; return cmd_changes(c->cg, true); }
static int t_log(void *v) {
    CallCtx *c = v;
    int limit = c->args ? (int)json_get_int(c->args, "limit", 20) : 20;
    return cmd_log(c->cg, limit > 0 ? limit : 20, true);
}
static int t_commit(void *v) {
    CallCtx *c = v;
    char *m = c->args ? json_get_string(c->args, "message") : NULL;
    if (!m) { printf("{\"error\":\"missing message\"}\n"); return 1; }
    int rc = cmd_commit(c->cg, m, false);
    free(m);
    return rc;
}

/* spec tools: cmd_spec reports refusals on stderr, which cg_capture does not
 * see — temporarily fold stderr into the captured stdout so the agent gets
 * the explanation, not just isError:true */
static int run_spec(int argc, char **argv, bool json) {
    fflush(stderr);
    int saved = dup(2);
    dup2(1, 2);
    int rc = cmd_spec(argc, argv, json);
    fflush(stdout);
    fflush(stderr);
    dup2(saved, 2);
    close(saved);
    return rc;
}

static int t_spec_status(void *v) {
    (void)v;
    char *a[] = { "status" };
    return run_spec(1, a, true);
}
static int t_spec_next(void *v) {
    (void)v;
    char *a[] = { "next" };
    return run_spec(1, a, true);
}
static int t_spec_start(void *v) {
    CallCtx *c = v;
    char *id = c->args ? json_get_string(c->args, "id") : NULL;
    if (!id) { printf("{\"error\":\"missing id\"}\n"); return 1; }
    char *a[] = { "start", id };
    int rc = run_spec(2, a, false);
    free(id);
    return rc;
}
static int t_spec_done(void *v) {
    CallCtx *c = v;
    char *id = c->args ? json_get_string(c->args, "id") : NULL;
    if (!id) { printf("{\"error\":\"missing id\"}\n"); return 1; }
    char *force = c->args ? json_get_raw(c->args, "force") : NULL;
    bool f = force && strcmp(force, "true") == 0;
    free(force);
    char *a[] = { "done", id, "--force" };
    int rc = run_spec(f ? 3 : 2, a, false);
    free(id);
    return rc;
}
static int t_spec_render(void *v) {
    CallCtx *c = v;
    char *check = c->args ? json_get_raw(c->args, "check") : NULL;
    bool chk = check && strcmp(check, "true") == 0;
    free(check);
    char *a[] = { "render", "--check" };
    return run_spec(chk ? 2 : 1, a, false);
}
static int t_spec_trace(void *v) {
    CallCtx *c = v;
    char *id = c->args ? json_get_string(c->args, "id") : NULL;
    char *a[] = { "trace", id };
    int rc = run_spec(id ? 2 : 1, a, true);
    free(id);
    return rc;
}

#define S_QUERY  "{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}," \
                 "\"limit\":{\"type\":\"integer\"}},\"required\":[\"query\"]}"
#define S_CTX    "{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}," \
                 "\"required\":[\"query\"]}"
#define S_NAME   "{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"}}," \
                 "\"required\":[\"name\"]}"
#define S_IMPACT "{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"}," \
                 "\"depth\":{\"type\":\"integer\"}},\"required\":[\"name\"]}"
#define S_FILTER "{\"type\":\"object\",\"properties\":{\"filter\":{\"type\":\"string\"}}}"
#define S_EMPTY  "{\"type\":\"object\",\"properties\":{}}"
#define S_LIMIT  "{\"type\":\"object\",\"properties\":{\"limit\":{\"type\":\"integer\"}}}"
#define S_MSG    "{\"type\":\"object\",\"properties\":{\"message\":{\"type\":\"string\"}}," \
                 "\"required\":[\"message\"]}"
#define S_TASKID "{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"," \
                 "\"description\":\"dotted task id, e.g. 16.7\"}},\"required\":[\"id\"]}"
#define S_TASKDN "{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"," \
                 "\"description\":\"dotted task id, e.g. 16.7\"}," \
                 "\"force\":{\"type\":\"boolean\"}},\"required\":[\"id\"]}"
#define S_CHECK  "{\"type\":\"object\",\"properties\":{\"check\":{\"type\":\"boolean\"}}}"
#define S_TRACE  "{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"," \
                 "\"description\":\"dotted task id; omit for all tasks\"}}}"

static const struct {
    const char *name, *desc, *schema;
    int (*fn)(void *);
    bool sync_first;
} TOOLS[] = {
    { "search_code",
      "Full-text + trigram search over symbols and file contents. Returns "
      "matching symbols with locations and full-text file hits.",
      S_QUERY, t_search, true },
    { "get_context",
      "One-call surgical context for a query: top symbol definitions with "
      "code snippets, their callers and callees, entry points, and related "
      "routes. Use this first when exploring unfamiliar code.",
      S_CTX, t_context, true },
    { "get_symbol",
      "Definition(s) of a symbol by name: location, code snippet, reference "
      "count.",
      S_NAME, t_symbol, true },
    { "impact_analysis",
      "Impact radius of a symbol before changing it: transitive callers "
      "(who breaks) and callees (what it depends on) to the given depth.",
      S_IMPACT, t_impact, true },
    { "list_routes",
      "Framework-aware HTTP routes (URL pattern -> handler) detected across "
      "the codebase, optionally filtered.",
      S_FILTER, t_routes, true },
    { "vcs_status",
      "Working-tree status vs the last Codify snapshot (added/modified/"
      "deleted files).",
      S_EMPTY, t_status, false },
    { "change_impact",
      "Impact radius of uncommitted edits: symbols in changed files plus "
      "their external callers. Run before committing.",
      S_EMPTY, t_changes, true },
    { "vcs_log",
      "Snapshot history (Codify's local version control).",
      S_LIMIT, t_log, false },
    { "vcs_commit",
      "Snapshot the working tree into Codify's local, content-addressed "
      "version control. Automatically tagged with the in-progress spec task "
      "when one exists.",
      S_MSG, t_commit, false },
    { "spec_status",
      "Task board of the active Ion spec feature (spec/<feature>/spec.kvx): "
      "totals, current in-progress task, and the next eligible task.",
      S_EMPTY, t_spec_status, false },
    { "spec_next",
      "The next eligible spec task — lowest wave whose `requires` are all "
      "done — with its implementation bullets and expanded acceptance "
      "criteria. Call before starting new work.",
      S_EMPTY, t_spec_next, false },
    { "spec_start",
      "Mark a spec task in_progress in spec.kvx (enforces one-at-a-time and "
      "met `requires`) and refresh the markdown mirror. Do this before "
      "implementing the task.",
      S_TASKID, t_spec_start, false },
    { "spec_done",
      "Mark a spec task done: runs the task's verify_cmd first (refuses on "
      "failure unless force), rewrites its status in spec.kvx, refreshes the "
      "markdown mirror, and reports the next eligible task.",
      S_TASKDN, t_spec_done, false },
    { "spec_render",
      "Regenerate the spec system's IDE pointer files and markdown mirror "
      "from the kvx sources (check:true only reports staleness).",
      S_CHECK, t_spec_render, false },
    { "spec_trace",
      "Trace spec tasks to code: declared symbols resolved in the graph "
      "(location, refs), touched paths matched against actual changes, and "
      "commits tagged with the task. One task by id, or all tasks.",
      S_TRACE, t_spec_trace, false },   /* trace refreshes its own graph */
};
#define NTOOLS ((int)(sizeof TOOLS / sizeof TOOLS[0]))

/* ---------------- server loop ---------------- */

static void send_line(StrBuf *b) {
    fwrite(b->p, 1, b->len, stdout);
    fputc('\n', stdout);
    fflush(stdout);
    sb_free(b);
}

static void reply_result(const char *id, const char *result_json) {
    StrBuf b; sb_init(&b);
    sb_printf(&b, "{\"jsonrpc\":\"2.0\",\"id\":%s,\"result\":%s", id, result_json);
    sb_putc(&b, '}');
    send_line(&b);
}

static void reply_error(const char *id, int code, const char *msg) {
    StrBuf b; sb_init(&b);
    sb_printf(&b, "{\"jsonrpc\":\"2.0\",\"id\":%s,\"error\":{\"code\":%d,"
                  "\"message\":", id, code);
    sb_json_str(&b, msg);
    sb_puts(&b, "}}");
    send_line(&b);
}

int cmd_mcp(Cg *cg, const SysInfo *si) {
    char *line = NULL;
    size_t cap = 0;
    ssize_t n;
    while ((n = getline(&line, &cap, stdin)) > 0) {
        if (n <= 1) continue;
        char *method = json_get_string(line, "method");
        char *id = json_get_raw(line, "id");
        if (!method) { free(id); continue; }

        if (strcmp(method, "initialize") == 0 && id) {
            char *params = json_get_object(line, "params");
            char *ver = params ? json_get_string(params, "protocolVersion") : NULL;
            StrBuf r; sb_init(&r);
            sb_puts(&r, "{\"protocolVersion\":");
            sb_json_str(&r, ver ? ver : "2025-06-18");
            sb_puts(&r, ",\"capabilities\":{\"tools\":{\"listChanged\":false}},"
                        "\"serverInfo\":{\"name\":\"codify\",\"version\":\""
                        CG_VERSION "\"}}");
            reply_result(id, r.p);
            sb_free(&r);
            free(ver); free(params);
        } else if (strcmp(method, "tools/list") == 0 && id) {
            StrBuf r; sb_init(&r);
            sb_puts(&r, "{\"tools\":[");
            for (int i = 0; i < NTOOLS; i++) {
                if (i) sb_putc(&r, ',');
                sb_puts(&r, "{\"name\":");
                sb_json_str(&r, TOOLS[i].name);
                sb_puts(&r, ",\"description\":");
                sb_json_str(&r, TOOLS[i].desc);
                sb_printf(&r, ",\"inputSchema\":%s}", TOOLS[i].schema);
            }
            sb_puts(&r, "]}");
            reply_result(id, r.p);
            sb_free(&r);
        } else if (strcmp(method, "tools/call") == 0 && id) {
            char *params = json_get_object(line, "params");
            char *name = params ? json_get_string(params, "name") : NULL;
            char *args = params ? json_get_object(params, "arguments") : NULL;
            int ti = -1;
            for (int i = 0; name && i < NTOOLS; i++)
                if (strcmp(TOOLS[i].name, name) == 0) { ti = i; break; }
            if (ti < 0) {
                reply_error(id, -32602, "unknown tool");
            } else {
                if (TOOLS[ti].sync_first) {          /* always fresh */
                    IndexStats st;
                    cg_index(cg, si, false, &st, true);
                }
                CallCtx ctx = { cg, si, args };
                char *out = NULL;
                int rc = cg_capture(&out, TOOLS[ti].fn, &ctx);
                StrBuf r; sb_init(&r);
                sb_puts(&r, "{\"content\":[{\"type\":\"text\",\"text\":");
                sb_json_str(&r, out ? out : "");
                sb_printf(&r, "}],\"isError\":%s}", rc == 0 ? "false" : "true");
                reply_result(id, r.p);
                sb_free(&r);
                free(out);
            }
            free(params); free(name); free(args);
        } else if (strcmp(method, "ping") == 0 && id) {
            reply_result(id, "{}");
        } else if (id) {
            reply_error(id, -32601, "method not found");
        }
        /* notifications (no id) are accepted silently */
        free(method);
        free(id);
    }
    free(line);
    return 0;
}

/* ---------------- auto-install into agent configs ---------------- */

static int self_path(char *out, size_t cap) {
    ssize_t n = readlink("/proc/self/exe", out, cap - 1);
    if (n <= 0) return -1;
    out[n] = 0;
    return 0;
}

static char *server_entry(const char *bin, bool vscode_style) {
    StrBuf b; sb_init(&b);
    sb_puts(&b, "\"codify\":{");
    if (vscode_style) sb_puts(&b, "\"type\":\"stdio\",");
    sb_puts(&b, "\"command\":");
    sb_json_str(&b, bin);
    sb_puts(&b, ",\"args\":[\"mcp\"]}");
    return b.p;
}

/* merge `entry` under `root_key` in a JSON config file; create if missing */
static void install_json(const char *path, const char *root_key,
                         const char *entry, const char *agent) {
    char *body = read_entire_file(path, NULL);
    if (!body) {
        char dir[4096];
        snprintf(dir, sizeof dir, "%s", path);
        char *slash = strrchr(dir, '/');
        if (slash) { *slash = 0; mkdirs(dir); }
        StrBuf b; sb_init(&b);
        sb_printf(&b, "{\n  \"%s\": {\n    %s\n  }\n}\n", root_key, entry);
        if (write_entire_file(path, b.p, b.len) == 0)
            printf("  ✓ %-12s %s (created)\n", agent, path);
        else
            printf("  ✗ %-12s cannot write %s\n", agent, path);
        sb_free(&b);
        return;
    }
    if (strstr(body, "\"codify\"")) {
        printf("  • %-12s already configured (%s)\n", agent, path);
        free(body);
        return;
    }
    char needle[128];
    snprintf(needle, sizeof needle, "\"%s\"", root_key);
    char *k = strstr(body, needle);
    char *brace = k ? strchr(k + strlen(needle), '{') : NULL;
    if (brace) {
        /* splice entry right after the opening brace */
        const char *p = brace + 1;
        while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r') p++;
        bool empty = (*p == '}');
        StrBuf b; sb_init(&b);
        size_t head = (size_t)(brace + 1 - body);
        for (size_t i = 0; i < head; i++) sb_putc(&b, body[i]);
        sb_printf(&b, "\n    %s%s", entry, empty ? "\n  " : ",");
        sb_puts(&b, body + head);
        if (write_entire_file(path, b.p, b.len) == 0)
            printf("  ✓ %-12s %s (merged)\n", agent, path);
        else
            printf("  ✗ %-12s cannot write %s\n", agent, path);
        sb_free(&b);
    } else {
        printf("  ! %-12s %s exists but has no \"%s\" section — add manually:\n"
               "      \"%s\": { %s }\n", agent, path, root_key, root_key, entry);
    }
    free(body);
}

int cmd_mcp_install(Cg *cg) {
    char bin[4096];
    if (self_path(bin, sizeof bin) != 0)
        snprintf(bin, sizeof bin, "cg");
    char *std = server_entry(bin, false);
    char *vsc = server_entry(bin, true);
    const char *home = getenv("HOME");
    char path[4600];

    printf("connecting Codify MCP server (%s mcp) to coding agents:\n", bin);

    /* project-scoped configs */
    snprintf(path, sizeof path, "%s/.mcp.json", cg->root);
    install_json(path, "mcpServers", std, "claude-code");
    snprintf(path, sizeof path, "%s/.cursor/mcp.json", cg->root);
    install_json(path, "mcpServers", std, "cursor");
    snprintf(path, sizeof path, "%s/.vscode/mcp.json", cg->root);
    install_json(path, "servers", vsc, "vscode");
    snprintf(path, sizeof path, "%s/.gemini/settings.json", cg->root);
    install_json(path, "mcpServers", std, "gemini-cli");

    /* user-scoped configs */
    if (home) {
        snprintf(path, sizeof path, "%s/.codeium/windsurf/mcp_config.json", home);
        install_json(path, "mcpServers", std, "windsurf");

        snprintf(path, sizeof path, "%s/.codex/config.toml", home);
        char *toml = read_entire_file(path, NULL);
        if (toml && strstr(toml, "mcp_servers.codegraph")) {
            printf("  • %-12s already configured (%s)\n", "codex-cli", path);
        } else {
            char dir[4600];
            snprintf(dir, sizeof dir, "%s/.codex", home);
            mkdirs(dir);
            FILE *f = fopen(path, "a");
            if (f) {
                fprintf(f, "%s[mcp_servers.codegraph]\ncommand = \"%s\"\n"
                           "args = [\"mcp\"]\n", toml ? "\n" : "", bin);
                fclose(f);
                printf("  ✓ %-12s %s (appended)\n", "codex-cli", path);
            } else {
                printf("  ✗ %-12s cannot write %s\n", "codex-cli", path);
            }
        }
        free(toml);
    }
    free(std);
    free(vsc);
    printf("\nrestart your agent (or reload MCP servers) to pick up the "
           "connection.\n");
    return 0;
}
