/* The event log: one append-only table every state change lands in, so an
 * editor, a supervisor, or a terminal can follow the fleet by sequence
 * number instead of polling commands and diffing their output.
 *
 * Three ways in, one table:
 *   - triggers on the durable tables (attempts, leases, agents, memories,
 *     runtime_events) — the event commits or rolls back with the change it
 *     describes, and every writer, including an older cg binary that knows
 *     nothing of this file, emits without being taught to;
 *   - the kvx status hook — task status lives in spec.kvx, not SQLite, so
 *     kvx_set_status reports each transition here;
 *   - explicit events_emit calls for what has no row of its own: fleet
 *     merges, gates, pull requests, orchestrator spawns and exits.
 *
 * seq is AUTOINCREMENT so a cursor never sees a number reused after the
 * retention prune; meta.events_pruned_through tells a reader whose cursor
 * fell behind the prune that it missed events. */
#include "cg.h"
#include <signal.h>
#include <time.h>

#define EVENTS_KEEP_DFLT 50000
#define EVENTS_PRUNE_EVERY 512

/* ms since the epoch, in SQL, for the triggers */
#define EV_NOW "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)"

/* Runs on every open after cg_schema_upgrade, never inside SCHEMA: two of
 * these triggers name columns that only the v16 upgrade adds, and a trigger
 * over a missing column would stop an old database from opening. Names
 * carry a version so a changed body gets a new trigger instead of silently
 * keeping the old one. */
static const char *EVENT_TRIGGERS =
    "CREATE TRIGGER IF NOT EXISTS ev1_attempt_start AFTER INSERT ON attempts "
    "BEGIN INSERT INTO events(at,kind,subject,node,payload) VALUES(" EV_NOW ","
    "'attempt.start',NEW.task,NEW.agent,json_object('attempt',NEW.attempt_id,"
    "'fence',NEW.fence,'agent',NEW.agent,'host',NEW.host)); END;"
    "CREATE TRIGGER IF NOT EXISTS ev1_attempt_state AFTER UPDATE OF state ON "
    "attempts WHEN NEW.state IS NOT OLD.state "
    "BEGIN INSERT INTO events(at,kind,subject,node,branch,payload) VALUES("
    EV_NOW ",'attempt.end',NEW.task,NEW.agent,NEW.branch,json_object("
    "'attempt',NEW.attempt_id,'fence',NEW.fence,'state',NEW.state,'from',"
    "OLD.state,'reason',NEW.reason)); END;"
    "CREATE TRIGGER IF NOT EXISTS ev1_attempt_branch AFTER UPDATE OF branch ON "
    "attempts WHEN NEW.branch IS NOT OLD.branch "
    "BEGIN INSERT INTO events(at,kind,subject,node,branch,payload) VALUES("
    EV_NOW ",'attempt.branch',NEW.task,NEW.agent,NEW.branch,json_object("
    "'attempt',NEW.attempt_id,'branch',NEW.branch,'worktree',NEW.worktree,"
    "'parent',NEW.parent)); END;"
    "CREATE TRIGGER IF NOT EXISTS ev1_claim AFTER INSERT ON leases "
    "BEGIN INSERT INTO events(at,kind,subject,node,payload) VALUES(" EV_NOW ","
    "'claim',NEW.task,NEW.agent,json_object('agent',NEW.agent,'expires',"
    "NEW.expires,'touches',NEW.touches)); END;"
    "CREATE TRIGGER IF NOT EXISTS ev1_release AFTER DELETE ON leases "
    "BEGIN INSERT INTO events(at,kind,subject,node,payload) VALUES(" EV_NOW ","
    "'release',OLD.task,OLD.agent,json_object('agent',OLD.agent,'expired',"
    "OLD.expires<=strftime('%s','now'))); END;"
    "CREATE TRIGGER IF NOT EXISTS ev1_agent_join AFTER INSERT ON agents "
    "BEGIN INSERT INTO events(at,kind,subject,node,branch,payload) VALUES("
    EV_NOW ",'agent.join',NEW.agent,NEW.agent,NEW.branch,json_object('role',"
    "NEW.role,'parent',NEW.parent,'feature',NEW.feature,'wave',NEW.wave,"
    "'worktree',NEW.worktree,'base',NEW.base)); END;"
    "CREATE TRIGGER IF NOT EXISTS ev1_agent_update AFTER UPDATE ON agents "
    "WHEN NEW.role IS NOT OLD.role OR NEW.parent IS NOT OLD.parent "
    "OR NEW.feature IS NOT OLD.feature OR NEW.wave IS NOT OLD.wave "
    "OR NEW.branch IS NOT OLD.branch "
    "BEGIN INSERT INTO events(at,kind,subject,node,branch,payload) VALUES("
    EV_NOW ",'agent.update',NEW.agent,NEW.agent,NEW.branch,json_object("
    "'role',NEW.role,'parent',NEW.parent,'feature',NEW.feature,'wave',"
    "NEW.wave,'worktree',NEW.worktree,'base',NEW.base)); END;"
    "CREATE TRIGGER IF NOT EXISTS ev1_memory AFTER INSERT ON memories "
    "BEGIN INSERT INTO events(at,kind,subject,branch,payload) VALUES(" EV_NOW
    ",'memory.add',NEW.task,NEW.branch,json_object('id',NEW.id,'type',"
    "NEW.type,'source',NEW.source)); END;"
    "CREATE TRIGGER IF NOT EXISTS ev1_activity AFTER INSERT ON runtime_events "
    "BEGIN INSERT INTO events(at,kind,subject,node,payload) VALUES(" EV_NOW ","
    "'agent.activity',NEW.task,NEW.session,json_object('source',NEW.source,"
    "'kind',NEW.kind,'attempt',NEW.attempt_id,'evidence_delta',"
    "NEW.evidence_delta,'activity',NEW.activity)); END;";

int events_install(Cg *cg) {
    /* A SQLite built without JSON1 cannot create these; the log then holds
     * only explicit events. Opening the project must never fail over it. */
    return sqlite3_exec(cg->db, EVENT_TRIGGERS, NULL, NULL, NULL) == SQLITE_OK
         ? 0 : -1;
}

static long now_ms_wall(void) {
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    return (long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

static void bind_or_null(sqlite3_stmt *st, int i, const char *v) {
    if (v && v[0]) sqlite3_bind_text(st, i, v, -1, SQLITE_TRANSIENT);
    else sqlite3_bind_null(st, i);
}

/* Prune in batches: only once the log has grown EVENTS_PRUNE_EVERY past
 * the keep count, so an emit almost never pays for a DELETE. */
static void events_prune(Cg *cg, long seq) {
    const char *env = getenv("CG_EVENTS_KEEP");
    long keep = env && env[0] ? atol(env) : EVENTS_KEEP_DFLT;
    if (keep < 16) keep = 16;
    if (seq - events_pruned_through(cg) <= keep + EVENTS_PRUNE_EVERY) return;
    long floor = seq - keep;
    sqlite3_stmt *d = cg_prep(cg, "DELETE FROM events WHERE seq<=?");
    sqlite3_bind_int64(d, 1, floor);
    sqlite3_step(d);
    sqlite3_finalize(d);
    char buf[32];
    snprintf(buf, sizeof buf, "%ld", floor);
    cg_meta_set(cg, "events_pruned_through", buf);
}

long events_emit(Cg *cg, const char *kind, const char *subject,
                 const char *payload) {
    return events_emit_as(cg, kind, subject, getenv("CG_AGENT"), payload);
}

long events_emit_as(Cg *cg, const char *kind, const char *subject,
                    const char *node, const char *payload) {
    if (!cg || !cg->db || !kind) return -1;
    sqlite3_stmt *st = NULL;
    if (sqlite3_prepare_v2(cg->db,
            "INSERT INTO events(at,kind,subject,run,node,branch,payload) "
            "VALUES(?,?,?,?,?,?,?)", -1, &st, NULL) != SQLITE_OK)
        return -1;
    sqlite3_bind_int64(st, 1, now_ms_wall());
    sqlite3_bind_text(st, 2, kind, -1, SQLITE_TRANSIENT);
    bind_or_null(st, 3, subject);
    bind_or_null(st, 4, getenv("CG_RUN"));
    bind_or_null(st, 5, node);
    bind_or_null(st, 6, cg->branch);
    bind_or_null(st, 7, payload);
    int rc = sqlite3_step(st);
    sqlite3_finalize(st);
    if (rc != SQLITE_DONE) return -1;
    long seq = (long)sqlite3_last_insert_rowid(cg->db);
    events_prune(cg, seq);
    return seq;
}

/* For callers with no connection of their own. Best effort: a busy
 * database loses the event rather than stalling the lifecycle command. */
long events_emit_quiet(const char *kind, const char *subject,
                       const char *payload) {
    Cg g;
    if (!memory_open_quiet(&g)) return -1;
    long seq = events_emit(&g, kind, subject, payload);
    cg_close(&g);
    return seq;
}

/* ---------------- task status, reported by kvx ---------------- */

/* A caller that rewrites spec.kvx while holding the database write lock
 * binds its connection here first: the hook's event then joins that
 * transaction, where a second connection would wait on the lock the caller
 * itself holds. */
static Cg *g_bound;

void events_bind(Cg *cg) { g_bound = cg; }
void events_unbind(void) { g_bound = NULL; }

/* ".../<spec dir>/<feature>/spec.kvx" -> feature. Only the file name and
 * its directory are read, because codify.kvx may put the spec directory
 * anywhere in the tree. */
static bool feature_of(const char *path, char *out, size_t cap) {
    size_t len = strlen(path), tail = strlen("/spec.kvx");
    if (len <= tail || strcmp(path + len - tail, "/spec.kvx") != 0)
        return false;
    const char *e = path + len - tail;
    const char *p = e;
    while (p > path && p[-1] != '/') p--;
    if (p == e || p == path) return false;
    size_t n = (size_t)(e - p);
    if (n >= cap) return false;
    memcpy(out, p, n);
    out[n] = 0;
    return true;
}

void events_kvx_status(const char *path, const char *section,
                       const char *from, const char *to) {
    if (from && to && strcmp(from, to) == 0) return;
    char feature[256], id[256];
    if (!feature_of(path, feature, sizeof feature)) return;
    if (strncmp(section, "task.", 5) == 0)
        snprintf(id, sizeof id, "%s", section + 5);
    else if (strcmp(section, "documentation") == 0)
        snprintf(id, sizeof id, "%s", CG_DOC_TASK);
    else
        return;
    char subject[600];
    snprintf(subject, sizeof subject, "%s/%s", feature, id);
    StrBuf b; sb_init(&b);
    sb_puts(&b, "{\"feature\":"); sb_json_str(&b, feature);
    sb_puts(&b, ",\"task\":");    sb_json_str(&b, id);
    sb_puts(&b, ",\"status\":");  sb_json_str(&b, to ? to : "");
    sb_puts(&b, ",\"from\":");
    if (from) sb_json_str(&b, from); else sb_puts(&b, "null");
    sb_puts(&b, ",\"path\":");    sb_json_str(&b, path);
    sb_putc(&b, '}');
    if (g_bound) events_emit(g_bound, "task.status", subject, b.p);
    else events_emit_quiet("task.status", subject, b.p);
    sb_free(&b);
}

/* ---------------- reading ---------------- */

long events_head(Cg *cg) {
    sqlite3_stmt *st = NULL;
    long seq = 0;
    if (sqlite3_prepare_v2(cg->db, "SELECT ifnull(MAX(seq),0) FROM events",
                           -1, &st, NULL) != SQLITE_OK)
        return 0;
    if (sqlite3_step(st) == SQLITE_ROW) seq = sqlite3_column_int64(st, 0);
    sqlite3_finalize(st);
    return seq;
}

long events_pruned_through(Cg *cg) {
    char *v = cg_meta_get(cg, "events_pruned_through");
    long n = v ? atol(v) : 0;
    free(v);
    return n;
}

#define EV_MAX_KINDS 16

/* kinds: comma list; an entry ending in '.' or '*' matches as a prefix
 * ("fleet." is every fleet event) */
long events_since(Cg *cg, long since, const char *kinds, int limit,
                  EventFn fn, void *ud) {
    char *list[EV_MAX_KINDS];
    bool prefix[EV_MAX_KINDS];
    int nk = 0;
    char *dup = kinds && kinds[0] ? xstrdup(kinds) : NULL;
    for (char *save = NULL, *t = dup ? strtok_r(dup, ",", &save) : NULL;
         t && nk < EV_MAX_KINDS; t = strtok_r(NULL, ",", &save)) {
        while (*t == ' ') t++;
        size_t n = strlen(t);
        while (n && t[n - 1] == ' ') t[--n] = 0;
        if (!n) continue;
        prefix[nk] = t[n - 1] == '*' || t[n - 1] == '.';
        if (t[n - 1] == '*') t[n - 1] = 0;
        list[nk++] = t;
    }
    StrBuf q; sb_init(&q);
    sb_puts(&q, "SELECT seq,at,kind,subject,run,node,branch,payload FROM "
                "events WHERE seq>?");
    if (nk) {
        sb_puts(&q, " AND (");
        for (int i = 0; i < nk; i++)
            sb_printf(&q, "%skind %s ?", i ? " OR " : "",
                      prefix[i] ? "GLOB" : "=");
        sb_putc(&q, ')');
    }
    sb_puts(&q, " ORDER BY seq LIMIT ?");
    sqlite3_stmt *st = NULL;
    long last = since;
    if (sqlite3_prepare_v2(cg->db, q.p, -1, &st, NULL) != SQLITE_OK) {
        sb_free(&q); free(dup);
        return -1;
    }
    sqlite3_bind_int64(st, 1, since);
    for (int i = 0; i < nk; i++) {
        if (prefix[i]) {
            char g[300];
            snprintf(g, sizeof g, "%s*", list[i]);
            sqlite3_bind_text(st, 2 + i, g, -1, SQLITE_TRANSIENT);
        } else
            sqlite3_bind_text(st, 2 + i, list[i], -1, SQLITE_TRANSIENT);
    }
    sqlite3_bind_int(st, 2 + nk, limit > 0 ? limit : 500);
    while (sqlite3_step(st) == SQLITE_ROW) {
        EventRow e;
        e.seq = sqlite3_column_int64(st, 0);
        e.at = sqlite3_column_int64(st, 1);
        e.kind = (const char *)sqlite3_column_text(st, 2);
        e.subject = (const char *)sqlite3_column_text(st, 3);
        e.run = (const char *)sqlite3_column_text(st, 4);
        e.node = (const char *)sqlite3_column_text(st, 5);
        e.branch = (const char *)sqlite3_column_text(st, 6);
        e.payload = (const char *)sqlite3_column_text(st, 7);
        last = e.seq;
        if (fn && fn(&e, ud) != 0) break;
    }
    sqlite3_finalize(st);
    sb_free(&q);
    free(dup);
    return last;
}

void events_json(StrBuf *b, const EventRow *e) {
    sb_printf(b, "{\"seq\":%ld,\"at\":%ld,\"kind\":", e->seq, e->at);
    sb_json_str(b, e->kind ? e->kind : "");
#define EV_OPT(name, v) do { sb_puts(b, ",\"" name "\":"); \
        if (v) sb_json_str(b, v); else sb_puts(b, "null"); } while (0)
    EV_OPT("subject", e->subject);
    EV_OPT("run", e->run);
    EV_OPT("node", e->node);
    EV_OPT("branch", e->branch);
#undef EV_OPT
    /* payloads are JSON written by this file or by json_object() */
    sb_puts(b, ",\"payload\":");
    sb_puts(b, e->payload && e->payload[0] ? e->payload : "null");
    sb_putc(b, '}');
}

/* ---------------- cg events ---------------- */

static volatile sig_atomic_t g_ev_stop;
static void ev_on_signal(int sig) { (void)sig; g_ev_stop = 1; }

static int ev_print(const EventRow *e, void *ud) {
    bool json = *(bool *)ud;
    StrBuf b; sb_init(&b);
    if (json) {
        events_json(&b, e);
        sb_putc(&b, '\n');
    } else {
        time_t t = (time_t)(e->at / 1000);
        struct tm tm;
        localtime_r(&t, &tm);
        char ts[16];
        strftime(ts, sizeof ts, "%H:%M:%S", &tm);
        sb_printf(&b, "%6ld  %s  %-15s %-22s", e->seq, ts, e->kind,
                  e->subject ? e->subject : "-");
        if (e->node) sb_printf(&b, "  by %s", e->node);
        if (e->branch) sb_printf(&b, "  on %s", e->branch);
        if (e->payload && e->payload[0]) sb_printf(&b, "  %s", e->payload);
        sb_putc(&b, '\n');
    }
    fputs(b.p, stdout);
    sb_free(&b);
    return 0;
}

typedef struct { long *v; long cap; long n; } EvRing;

static int ev_ring_add(const EventRow *e, void *ud) {
    EvRing *r = ud;
    r->v[r->n % r->cap] = e->seq;
    r->n++;
    return 0;
}

int cmd_events(Cg *cg, int argc, char **argv, bool json) {
    long since = -1, limit = 50;
    double run_for = 0;
    bool follow = false;
    const char *kinds = NULL;
    for (int i = 0; i < argc; i++) {
        if (strcmp(argv[i], "--since") == 0 && i + 1 < argc)
            since = atol(argv[++i]);
        else if (strcmp(argv[i], "--kind") == 0 && i + 1 < argc)
            kinds = argv[++i];
        else if (strcmp(argv[i], "-n") == 0 && i + 1 < argc)
            limit = atol(argv[++i]);
        else if (strcmp(argv[i], "--for") == 0 && i + 1 < argc)
            run_for = atof(argv[++i]);
        else if (strcmp(argv[i], "--follow") == 0 || strcmp(argv[i], "-f") == 0)
            follow = true;
        else if (strcmp(argv[i], "--head") == 0) {
            if (json) printf("{\"head\":%ld,\"pruned_through\":%ld}\n",
                             events_head(cg), events_pruned_through(cg));
            else printf("%ld\n", events_head(cg));
            return 0;
        } else {
            fprintf(stderr, "usage: cg events [--since N] [--kind K[,K...]] "
                    "[-n N] [--follow [--for SECONDS]] [--head] [--json]\n");
            return 1;
        }
    }
    if (limit <= 0) limit = 50;
    long floor = events_pruned_through(cg);
    bool explicit_since = since >= 0;
    if (!explicit_since) {
        /* no cursor: the last `limit` events, oldest first */
        long head = events_head(cg);
        since = head > limit ? head - limit : 0;
    } else if (since < floor) {
        fprintf(stderr, "cg events: events up to #%ld were pruned — output "
                "starts after them\n", floor);
    }
    long cursor = since;
    if (kinds && !explicit_since) {
        /* a kind filter without a cursor still means "the latest N" */
        EvRing r = { xmalloc(sizeof(long) * (size_t)limit), limit, 0 };
        events_since(cg, 0, kinds, 1 << 30, ev_ring_add, &r);
        cursor = 0;
        if (r.n > r.cap) cursor = r.v[r.n % r.cap] - 1;
        free(r.v);
    }
    if (!follow) {
        events_since(cg, cursor, kinds, (int)limit, ev_print, &json);
        return 0;
    }

    struct sigaction sa, oldint, oldterm;
    memset(&sa, 0, sizeof sa);
    sa.sa_handler = ev_on_signal;
    g_ev_stop = 0;
    sigaction(SIGINT, &sa, &oldint);
    sigaction(SIGTERM, &sa, &oldterm);
    setvbuf(stdout, NULL, _IOLBF, 0);
    long deadline = run_for > 0 ? now_ms_wall() + (long)(run_for * 1000) : 0;
    cursor = events_since(cg, cursor, kinds, (int)limit, ev_print, &json);
    while (!g_ev_stop && (!deadline || now_ms_wall() < deadline)) {
        long next = events_since(cg, cursor, kinds, 500, ev_print, &json);
        if (next > cursor) { cursor = next; continue; }
        struct timespec ts = { 0, 100 * 1000 * 1000 };
        nanosleep(&ts, NULL);
    }
    sigaction(SIGINT, &oldint, NULL);
    sigaction(SIGTERM, &oldterm, NULL);
    return 0;
}
