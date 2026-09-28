/* Agent drivers: how a Codex, Claude Code, or custom agent is launched, and
 * how what it does comes back into Codify.
 *
 * Launch: driver_argv turns a DriverSpec (driver, model, extra args, custom
 * template, structured flag) into an argv. Structured output is the
 * default — Claude's stream-json and Codex's exec --json — because an
 * agent the supervisor cannot read is an agent it cannot supervise.
 *
 * Read back: the agent's stdout and stderr go to its log file, as before.
 * A DriverTap tails that file by byte offset and parses each complete line
 * into agent events (text, tool calls, usage, the final result), so the
 * event log carries what every agent is doing and spending while it runs.
 * Lines that are not JSON — stderr noise, a plain-text driver — are kept in
 * the log and ignored here. The format is recognised from the line itself,
 * so a custom driver that speaks either dialect is read the same way.
 *
 * Steer: a message for a running agent is an agent.steer event. It reaches
 * a Claude Code session at its next edit through the post-edit hook
 * (PostToolUse additionalContext), and any agent through its next prompt;
 * a per-agent cursor in meta records what was delivered, so nothing is
 * delivered twice. */
#include "cg.h"
#include <ctype.h>
#include <time.h>
#include <unistd.h>

/* ---------------- launch ---------------- */

static int split_into(const char *s, char **av, int n, int cap) {
    if (!s) return n;
    while (*s && n < cap - 1) {
        while (*s && isspace((unsigned char)*s)) s++;
        if (!*s) break;
        const char *start = s;
        while (*s && !isspace((unsigned char)*s)) s++;
        char *tok = xmalloc((size_t)(s - start) + 1);
        memcpy(tok, start, (size_t)(s - start));
        tok[s - start] = 0;
        av[n++] = tok;
    }
    return n;
}

/* ${PROMPT_FILE} ${TASK} ${ROOT} ${AGENT} ${MODEL} — plain replacement of
 * exactly these names; anything else is left for the shell */
static char *subst(const char *tmpl, const DriverSpec *d, const char *pf,
                   const char *task, const char *root, const char *agent) {
    static const char *NAMES[] = { "PROMPT_FILE", "TASK", "ROOT", "AGENT",
                                   "MODEL" };
    const char *vals[] = { pf, task, root, agent,
                           d->model ? d->model : "" };
    StrBuf b; sb_init(&b);
    for (const char *p = tmpl; *p;) {
        if (p[0] == '$' && p[1] == '{') {
            const char *end = strchr(p + 2, '}');
            bool hit = false;
            for (int i = 0; end && i < 5; i++) {
                size_t n = strlen(NAMES[i]);
                if ((size_t)(end - (p + 2)) == n &&
                    strncmp(p + 2, NAMES[i], n) == 0) {
                    sb_puts(&b, vals[i] ? vals[i] : "");
                    p = end + 1;
                    hit = true;
                    break;
                }
            }
            if (hit) continue;
        }
        sb_putc(&b, *p++);
    }
    return b.p;
}

int driver_argv(const DriverSpec *d, const char *root, const char *promptfile,
                const char *task, const char *agent, char **av, int cap) {
    int n = 0;
    bool model = d->model && d->model[0];
    if (strcmp(d->driver, "codex") == 0) {
        av[n++] = xstrdup("codex");
        av[n++] = xstrdup("exec");
        av[n++] = xstrdup("--sandbox");
        av[n++] = xstrdup("workspace-write");
        av[n++] = xstrdup("--skip-git-repo-check");
        av[n++] = xstrdup("-C");
        av[n++] = xstrdup(root);
        if (d->structured) av[n++] = xstrdup("--json");
        if (model) { av[n++] = xstrdup("-m"); av[n++] = xstrdup(d->model); }
        n = split_into(d->args, av, n, cap - 1);
        av[n++] = xstrdup("-");            /* the prompt arrives on stdin */
    } else if (strcmp(d->driver, "claude") == 0) {
        av[n++] = xstrdup("claude");
        av[n++] = xstrdup("-p");
        av[n++] = xstrdup("--permission-mode");
        av[n++] = xstrdup("acceptEdits");
        if (d->structured) {
            av[n++] = xstrdup("--output-format");
            av[n++] = xstrdup("stream-json");
            av[n++] = xstrdup("--verbose");   /* stream-json requires it with -p */
        }
        if (model) { av[n++] = xstrdup("--model"); av[n++] = xstrdup(d->model); }
        n = split_into(d->args, av, n, cap);
    } else if (strcmp(d->driver, "custom") == 0) {
        if (!d->cmd || !d->cmd[0]) return -1;
        av[n++] = xstrdup("/bin/sh");
        av[n++] = xstrdup("-c");
        av[n++] = subst(d->cmd, d, promptfile, task, root, agent);
    } else {
        return -1;
    }
    av[n] = NULL;
    return n;
}

/* ---------------- parse ---------------- */

static double raw_num(const char *obj, const char *key, double dflt) {
    char *r = obj ? json_get_raw(obj, key) : NULL;
    double v = r && (isdigit((unsigned char)r[0]) || r[0] == '-') ? atof(r) : dflt;
    free(r);
    return v;
}

static bool raw_true(const char *obj, const char *key) {
    char *r = obj ? json_get_raw(obj, key) : NULL;
    bool t = r && strcmp(r, "true") == 0;
    free(r);
    return t;
}

/* A short, human line for a tool call: the command for a shell, the path
 * for a file tool, else the first string field of the input. */
static char *tool_detail(const char *input) {
    static const char *KEYS[] = { "command", "file_path", "path", "pattern",
                                  "url", "query", "description", NULL };
    for (int i = 0; input && KEYS[i]; i++) {
        char *v = json_get_string(input, KEYS[i]);
        if (v) return v;
    }
    return NULL;
}

static void emit_usage(DriverEventFn fn, void *ud, const char *usage,
                       double cost, long turns) {
    if (!usage && cost < 0) return;
    DriverEvent e = { .kind = "usage", .cost = cost, .turns = turns };
    e.tokens_in = (long)raw_num(usage, "input_tokens", 0) +
                  (long)raw_num(usage, "cache_read_input_tokens", 0) +
                  (long)raw_num(usage, "cache_creation_input_tokens", 0) +
                  (long)raw_num(usage, "cached_input_tokens", 0);
    e.tokens_out = (long)raw_num(usage, "output_tokens", 0);
    fn(&e, ud);
}

/* Claude Code stream-json: system/init, assistant and user messages whose
 * content is an array of text / tool_use / tool_result blocks, and a final
 * result with cost and usage. */
static int parse_claude(const char *line, const char *type, DriverEventFn fn,
                        void *ud) {
    int n = 0;
    if (strcmp(type, "system") == 0) {
        char *sid = json_get_string(line, "session_id");
        char *model = json_get_string(line, "model");
        if (sid) {
            DriverEvent e = { .kind = "session", .session = sid, .text = model };
            fn(&e, ud);
            n++;
        }
        free(sid); free(model);
    } else if (strcmp(type, "assistant") == 0) {
        char *msg = json_get_object(line, "message");
        char *content = msg ? json_get_raw(msg, "content") : NULL;
        char **items = NULL;
        int ni = content ? json_array_items(content, &items) : 0;
        for (int i = 0; i < ni; i++) {
            char *bt = json_get_string(items[i], "type");
            if (bt && strcmp(bt, "text") == 0) {
                char *t = json_get_string(items[i], "text");
                if (t && t[0]) {
                    DriverEvent e = { .kind = "text", .text = t };
                    fn(&e, ud);
                    n++;
                }
                free(t);
            } else if (bt && strcmp(bt, "tool_use") == 0) {
                char *name = json_get_string(items[i], "name");
                char *input = json_get_object(items[i], "input");
                char *det = tool_detail(input);
                DriverEvent e = { .kind = "tool", .tool = name, .text = det };
                fn(&e, ud);
                n++;
                free(name); free(input); free(det);
            }
            free(bt);
            free(items[i]);
        }
        free(items);
        char *usage = msg ? json_get_object(msg, "usage") : NULL;
        if (usage) { emit_usage(fn, ud, usage, -1, 0); n++; }
        free(usage); free(content); free(msg);
    } else if (strcmp(type, "result") == 0) {
        char *usage = json_get_object(line, "usage");
        char *sub = json_get_string(line, "subtype");
        char *sid = json_get_string(line, "session_id");
        char *res = json_get_string(line, "result");
        DriverEvent e = { .kind = "result", .subtype = sub, .session = sid,
                          .text = res };
        e.cost = raw_num(line, "total_cost_usd", -1);
        e.turns = (long)raw_num(line, "num_turns", 0);
        e.duration_ms = (long)raw_num(line, "duration_ms", 0);
        e.is_error = raw_true(line, "is_error");
        e.tokens_in = (long)raw_num(usage, "input_tokens", 0) +
                      (long)raw_num(usage, "cache_read_input_tokens", 0) +
                      (long)raw_num(usage, "cache_creation_input_tokens", 0);
        e.tokens_out = (long)raw_num(usage, "output_tokens", 0);
        fn(&e, ud);
        n++;
        free(usage); free(sub); free(sid); free(res);
    }
    return n;
}

/* Codex exec --json: thread.started, turn.started/completed (with usage),
 * item.started/completed where the item is an agent_message, a
 * command_execution, a file_change, an mcp_tool_call, ..., and errors. */
static int parse_codex(const char *line, const char *type, DriverEventFn fn,
                       void *ud) {
    int n = 0;
    if (strcmp(type, "thread.started") == 0) {
        char *tid = json_get_string(line, "thread_id");
        if (tid) {
            DriverEvent e = { .kind = "session", .session = tid };
            fn(&e, ud);
            n++;
        }
        free(tid);
    } else if (strcmp(type, "item.started") == 0 ||
               strcmp(type, "item.completed") == 0) {
        bool done = strcmp(type, "item.completed") == 0;
        char *item = json_get_object(line, "item");
        char *it = item ? json_get_string(item, "type") : NULL;
        if (it && strcmp(it, "agent_message") == 0 && done) {
            char *t = json_get_string(item, "text");
            if (t && t[0]) {
                DriverEvent e = { .kind = "text", .text = t };
                fn(&e, ud);
                n++;
            }
            free(t);
        } else if (it && !done && strcmp(it, "reasoning") != 0 &&
                   strcmp(it, "agent_message") != 0) {
            /* a tool starts: report it once, when it begins */
            char *det = json_get_string(item, "command");
            if (!det) det = tool_detail(item);
            if (!det) {
                char *changes = json_get_raw(item, "changes");
                char **ch = NULL;
                int nc = changes ? json_array_items(changes, &ch) : 0;
                if (nc > 0) det = json_get_string(ch[0], "path");
                for (int i = 0; i < nc; i++) free(ch[i]);
                free(ch); free(changes);
            }
            char *tool = json_get_string(item, "tool");
            DriverEvent e = { .kind = "tool", .tool = tool ? tool : it,
                              .text = det };
            fn(&e, ud);
            n++;
            free(det); free(tool);
        }
        free(it); free(item);
    } else if (strcmp(type, "turn.completed") == 0) {
        char *usage = json_get_object(line, "usage");
        emit_usage(fn, ud, usage, -1, 1);
        n++;
        free(usage);
    } else if (strcmp(type, "turn.failed") == 0 || strcmp(type, "error") == 0) {
        char *err = json_get_object(line, "error");
        char *msg = err ? json_get_string(err, "message")
                        : json_get_string(line, "message");
        DriverEvent e = { .kind = "result", .subtype = "error", .text = msg,
                          .is_error = true, .cost = -1 };
        fn(&e, ud);
        n++;
        free(msg); free(err);
    }
    return n;
}

int driver_stream_parse(const char *line, DriverEventFn fn, void *ud) {
    while (*line == ' ' || *line == '\t') line++;
    if (*line != '{') return 0;
    char *type = json_get_string(line, "type");
    if (!type) return 0;
    int n = strchr(type, '.') || strcmp(type, "error") == 0
          ? parse_codex(line, type, fn, ud)
          : parse_claude(line, type, fn, ud);
    free(type);
    return n;
}

/* ---------------- tap ---------------- */

static long wall_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    return (long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

void driver_tap_init(DriverTap *t, const char *log, const char *agent,
                     const char *role, const char *subject) {
    memset(t, 0, sizeof *t);
    snprintf(t->log, sizeof t->log, "%s", log);
    snprintf(t->agent, sizeof t->agent, "%s", agent ? agent : "");
    snprintf(t->role, sizeof t->role, "%s", role ? role : "");
    snprintf(t->subject, sizeof t->subject, "%s", subject ? subject : "");
    sb_init(&t->partial);
    t->last_ms = wall_ms();
}

void driver_tap_free(DriverTap *t) {
    sb_free(&t->partial);
}

#define TAP_TEXT_MAX 600

typedef struct { DriverTap *t; StrBuf *batch; int n; } TapCtx;

static void clip(StrBuf *b, const char *key, const char *v) {
    sb_printf(b, ",\"%s\":", key);
    if (!v) { sb_puts(b, "null"); return; }
    size_t n = strlen(v);
    if (n <= TAP_TEXT_MAX) { sb_json_str(b, v); return; }
    char *c = xmalloc(TAP_TEXT_MAX + 4);
    memcpy(c, v, TAP_TEXT_MAX);
    /* never cut a UTF-8 sequence in half */
    size_t k = TAP_TEXT_MAX;
    while (k > 0 && ((unsigned char)c[k] & 0xC0) == 0x80) k--;
    memcpy(c + k, "…", 4);
    sb_json_str(b, c);
    free(c);
}

/* one queued event: kind \x1f payload \x1e */
static void tap_on(const DriverEvent *e, void *ud) {
    TapCtx *c = ud;
    DriverTap *t = c->t;
    StrBuf p; sb_init(&p);
    sb_puts(&p, "{\"agent\":"); sb_json_str(&p, t->agent);
    sb_puts(&p, ",\"role\":");  sb_json_str(&p, t->role);
    const char *kind = NULL;
    if (strcmp(e->kind, "text") == 0) {
        kind = "agent.text";
        t->texts++;
        clip(&p, "text", e->text);
    } else if (strcmp(e->kind, "tool") == 0) {
        kind = "agent.tool";
        t->tools++;
        clip(&p, "tool", e->tool);
        clip(&p, "detail", e->text);
    } else if (strcmp(e->kind, "usage") == 0) {
        kind = "agent.usage";
        t->tokens_in += e->tokens_in;
        t->tokens_out += e->tokens_out;
        t->turns += e->turns;
        if (e->cost >= 0) t->cost = e->cost;
        sb_printf(&p, ",\"tokens_in\":%ld,\"tokens_out\":%ld,\"turns\":%ld,"
                      "\"cost_usd\":%.4f", t->tokens_in, t->tokens_out,
                  t->turns, t->cost);
    } else if (strcmp(e->kind, "result") == 0) {
        kind = "agent.result";
        /* the result's totals are authoritative over the running sums */
        if (e->cost >= 0) t->cost = e->cost;
        if (e->tokens_in) t->tokens_in = e->tokens_in;
        if (e->tokens_out) t->tokens_out = e->tokens_out;
        if (e->turns) t->turns = e->turns;
        t->finished = true;
        t->failed = e->is_error;
        clip(&p, "subtype", e->subtype);
        sb_printf(&p, ",\"is_error\":%s,\"cost_usd\":%.4f,\"tokens_in\":%ld,"
                      "\"tokens_out\":%ld,\"turns\":%ld,\"duration_ms\":%ld",
                  e->is_error ? "true" : "false", t->cost, t->tokens_in,
                  t->tokens_out, t->turns, e->duration_ms);
        clip(&p, "text", e->text);
    } else if (strcmp(e->kind, "session") == 0) {
        kind = "agent.session";
        if (e->session) snprintf(t->session, sizeof t->session, "%s", e->session);
        clip(&p, "session", e->session);
        clip(&p, "model", e->text);
    }
    sb_putc(&p, '}');
    if (kind) {
        sb_puts(c->batch, kind);
        sb_putc(c->batch, '\x1f');
        sb_puts(c->batch, p.p);
        sb_putc(c->batch, '\x1e');
        c->n++;
        t->last_ms = wall_ms();
    }
    sb_free(&p);
}

int driver_tap_poll(DriverTap *t) {
    if (!t->log[0]) return 0;
    if (!t->partial.p) sb_init(&t->partial);   /* sb_grow cannot start at 0 */
    FILE *f = fopen(t->log, "r");
    if (!f) return 0;
    if (fseek(f, t->off, SEEK_SET) != 0) { fclose(f); return 0; }
    char buf[65536];
    size_t n;
    StrBuf batch; sb_init(&batch);
    TapCtx c = { t, &batch, 0 };
    while ((n = fread(buf, 1, sizeof buf, f)) > 0) {
        t->off += (long)n;
        for (size_t i = 0; i < n; i++) {
            if (buf[i] != '\n') { sb_putc(&t->partial, buf[i]); continue; }
            if (t->partial.len) {
                driver_stream_parse(t->partial.p, tap_on, &c);
                t->partial.len = 0;
                t->partial.p[0] = 0;
            }
        }
    }
    fclose(f);
    /* a runaway line that never ends is not a stream we can read */
    if (t->partial.len > (8u << 20)) { t->partial.len = 0; t->partial.p[0] = 0; }
    if (c.n) {
        Cg g;
        if (memory_open_quiet(&g)) {
            cg_exec(&g, "BEGIN");
            for (char *p = batch.p; p && *p; ) {
                char *us = strchr(p, '\x1f');
                char *rs = us ? strchr(us, '\x1e') : NULL;
                if (!us || !rs) break;
                *us = 0; *rs = 0;
                events_emit_as(&g, p, t->subject[0] ? t->subject : NULL,
                               t->agent, us + 1);
                p = rs + 1;
            }
            cg_exec(&g, "COMMIT");
            cg_close(&g);
        }
    }
    sb_free(&batch);
    return c.n;
}

/* ---------------- steer ---------------- */

long driver_steer(Cg *cg, const char *agent, const char *message) {
    StrBuf p; sb_init(&p);
    sb_puts(&p, "{\"agent\":"); sb_json_str(&p, agent);
    sb_puts(&p, ",\"message\":"); sb_json_str(&p, message);
    const char *from = getenv("CG_AGENT");
    sb_puts(&p, ",\"from\":");
    if (from && from[0]) sb_json_str(&p, from); else sb_puts(&p, "null");
    sb_putc(&p, '}');
    long seq = events_emit_as(cg, "agent.steer", agent, from, p.p);
    sb_free(&p);
    return seq;
}

typedef struct { StrBuf *b; long last; int n; } SteerAcc;

static int steer_add(const EventRow *e, void *ud) {
    SteerAcc *a = ud;
    char *msg = e->payload ? json_get_string(e->payload, "message") : NULL;
    char *from = e->payload ? json_get_string(e->payload, "from") : NULL;
    if (msg) {
        if (from) sb_printf(a->b, "- %s (from %s)\n", msg, from);
        else      sb_printf(a->b, "- %s\n", msg);
        a->n++;
    }
    a->last = e->seq;
    free(msg); free(from);
    return 0;
}

char *driver_steer_take(Cg *cg, const char *agent, const char *via) {
    if (!agent || !agent[0]) return NULL;
    char key[300];
    snprintf(key, sizeof key, "steer_delivered:%s", agent);
    char *cur = cg_meta_get(cg, key);
    long since = cur ? atol(cur) : 0;
    free(cur);
    StrBuf body; sb_init(&body);
    SteerAcc a = { &body, since, 0 };
    /* one agent's messages: filter on the subject in the walk */
    sqlite3_stmt *st = NULL;
    if (sqlite3_prepare_v2(cg->db,
            "SELECT seq,at,kind,subject,run,node,branch,payload FROM events "
            "WHERE kind='agent.steer' AND subject=? AND seq>? ORDER BY seq",
            -1, &st, NULL) != SQLITE_OK) {
        sb_free(&body);
        return NULL;
    }
    sqlite3_bind_text(st, 1, agent, -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(st, 2, since);
    while (sqlite3_step(st) == SQLITE_ROW) {
        EventRow e = {0};
        e.seq = sqlite3_column_int64(st, 0);
        e.payload = (const char *)sqlite3_column_text(st, 7);
        steer_add(&e, &a);
    }
    sqlite3_finalize(st);
    if (!a.n) { sb_free(&body); return NULL; }
    char buf[32];
    snprintf(buf, sizeof buf, "%ld", a.last);
    cg_meta_set(cg, key, buf);
    StrBuf p; sb_init(&p);
    sb_puts(&p, "{\"agent\":"); sb_json_str(&p, agent);
    sb_printf(&p, ",\"messages\":%d,\"through\":%ld,\"via\":", a.n, a.last);
    sb_json_str(&p, via ? via : "");
    sb_putc(&p, '}');
    events_emit_as(cg, "agent.steer.delivered", agent, agent, p.p);
    sb_free(&p);
    return body.p;
}
