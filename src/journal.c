/*
 * The write journal: lifecycle writes that survive a busy database.
 *
 * An agent closing a task while an editor's language server re-indexes the
 * tree used to get exit 75 from `cg remember`, `cg handoff`, or the
 * bookkeeping behind `cg spec done`, and went off to debug SQLite instead of
 * finishing. These writes do not need to see the current state to be
 * correct — a memory, an event, a lease release — so when the lock wait runs
 * out they are appended here instead, and the next cg process that holds
 * the write lock applies them. Writes that must see the current state to be
 * correct (claims, fleet claims, the indexer) still wait and exit 75.
 *
 * Layout (docs/journal.md):
 *   .codegraph/journal/<ms>-<pid>-<seq>.json    one pending record each
 *   .codegraph/journal/failed/<id>.json + .err  records the database refused
 * A record is written whole to a dot-temp file and renamed into place, so a
 * reader never sees half of one. Names are zero-padded so name order is
 * wall-time order.
 *
 * Replay holds an flock on the directory (never waited on: a second replayer
 * simply leaves the work to the first) and applies each record in its own
 * transaction, recording its id in journal_applied in that same transaction
 * — a crash between COMMIT and unlink can therefore never apply a record
 * twice. A record the database rejects for a reason other than busy moves to
 * failed/ with the error and is reported once, when it moves.
 */
#include "cg.h"
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#include <ctype.h>

#define JOURNAL_SUBDIR CG_DIR "/journal"

static int g_queued;          /* records this process appended */
static bool g_announced;      /* the command printed its own queued line */
static bool g_busy_seen;      /* this process waited out the lock once */
static bool g_atexit;
static char g_command[64] = "cg";
static int g_seq;

void journal_set_command(const char *cmd, const char *sub) {
    if (!cmd) return;
    if (sub && sub[0] && sub[0] != '-')
        snprintf(g_command, sizeof g_command, "%s %s", cmd, sub);
    else
        snprintf(g_command, sizeof g_command, "%s", cmd);
}

bool journal_busy_seen(void) { return g_busy_seen; }
void journal_mark_busy(void) { g_busy_seen = true; }
int  journal_queued_count(void) { return g_queued; }
void journal_announced(void) { g_announced = true; }

static void journal_dir(const Cg *cg, char *out, size_t cap) {
    snprintf(out, cap, "%s/%s", cg->shared, JOURNAL_SUBDIR);
}

/* One line for everything a command queued without saying so itself: the
 * implicit events, the spec bookkeeping. Printed at exit so it is one line
 * however many records the command left. */
static void journal_atexit(void) {
    if (!g_queued || g_announced) return;
    fprintf(stderr,
        "cg: the graph database is busy — %d write%s queued in "
        "%s/; the next cg command that gets the lock applies %s\n",
        g_queued, g_queued == 1 ? "" : "s", JOURNAL_SUBDIR,
        g_queued == 1 ? "it" : "them");
}

int journal_append(Cg *cg, const char *op, const char *args,
                   const char *summary) {
    char dir[4700];
    journal_dir(cg, dir, sizeof dir);
    if (mkdirs(dir) != 0) return -1;
    long at = now_ms();
    char id[96];
    snprintf(id, sizeof id, "%013ld-%07ld-%04d", at, (long)getpid(), ++g_seq);

    StrBuf b; sb_init(&b);
    sb_printf(&b, "{\"v\":%d,\"id\":", JOURNAL_VERSION);
    sb_json_str(&b, id);
    sb_printf(&b, ",\"at\":%ld,\"pid\":%ld,\"op\":", at, (long)getpid());
    sb_json_str(&b, op);
    sb_puts(&b, ",\"command\":");
    sb_json_str(&b, g_command);
    sb_puts(&b, ",\"summary\":");
    sb_json_str(&b, summary ? summary : "");
    sb_puts(&b, ",\"branch\":");
    sb_json_str(&b, cg->branch);
    sb_puts(&b, ",\"agent\":");
    sb_json_str(&b, cg_agent_name(NULL));
    const char *run = getenv("CG_RUN");
    sb_puts(&b, ",\"run\":");
    if (run && run[0]) sb_json_str(&b, run); else sb_puts(&b, "null");
    sb_puts(&b, ",\"args\":");
    sb_puts(&b, args && args[0] ? args : "{}");
    sb_puts(&b, "}\n");

    char tmp[4900], fin[4900];
    snprintf(tmp, sizeof tmp, "%s/.tmp-%s", dir, id);
    snprintf(fin, sizeof fin, "%s/%s.json", dir, id);
    int fd = open(tmp, O_CREAT | O_WRONLY | O_TRUNC | O_CLOEXEC, 0644);
    bool ok = fd >= 0;
    size_t off = 0;
    while (ok && off < b.len) {
        ssize_t w = write(fd, b.p + off, b.len - off);
        if (w < 0) { if (errno == EINTR) continue; ok = false; break; }
        off += (size_t)w;
    }
    if (fd >= 0) {
        if (ok && fsync(fd) != 0) ok = false;
        close(fd);
    }
    if (ok && rename(tmp, fin) != 0) ok = false;
    if (!ok) unlink(tmp);
    sb_free(&b);
    if (!ok) return -1;
    g_queued++;
    if (!g_atexit) { atexit(journal_atexit); g_atexit = true; }
    return 0;
}

/* ---------------- listing ---------------- */

static int name_cmp(const void *a, const void *b) {
    return strcmp(*(char *const *)a, *(char *const *)b);
}

/* record file names (no directory) in dir, sorted; returns the count */
static int list_records(const char *dir, char ***out) {
    *out = NULL;
    DIR *d = opendir(dir);
    if (!d) return 0;
    int n = 0, cap = 0;
    struct dirent *e;
    while ((e = readdir(d))) {
        size_t len = strlen(e->d_name);
        if (e->d_name[0] == '.' || len < 6 ||
            strcmp(e->d_name + len - 5, ".json") != 0)
            continue;
        if (n == cap) {
            cap = cap ? cap * 2 : 16;
            *out = xrealloc(*out, sizeof **out * (size_t)cap);
        }
        (*out)[n++] = xstrdup(e->d_name);
    }
    closedir(d);
    if (n > 1) qsort(*out, (size_t)n, sizeof **out, name_cmp);
    return n;
}

static void free_list(char **v, int n) {
    for (int i = 0; i < n; i++) free(v[i]);
    free(v);
}

int journal_pending(const Cg *cg, int *failed) {
    char dir[4700], fdir[4800];
    journal_dir(cg, dir, sizeof dir);
    char **v;
    int n = list_records(dir, &v);
    free_list(v, n);
    if (failed) {
        snprintf(fdir, sizeof fdir, "%s/failed", dir);
        int nf = list_records(fdir, &v);
        free_list(v, nf);
        *failed = nf;
    }
    return n;
}

/* is anything waiting? a readdir that stops at the first record, so cg_open
 * pays one opendir when the journal is empty or absent */
static bool any_pending(const Cg *cg) {
    char dir[4700];
    journal_dir(cg, dir, sizeof dir);
    DIR *d = opendir(dir);
    if (!d) return false;
    bool any = false;
    struct dirent *e;
    while (!any && (e = readdir(d))) {
        size_t len = strlen(e->d_name);
        any = e->d_name[0] != '.' && len > 5 &&
              strcmp(e->d_name + len - 5, ".json") == 0;
    }
    closedir(d);
    return any;
}

/* ---------------- replay ---------------- */

static bool rc_busy(int rc) {
    int base = rc & 0xff;
    return base == SQLITE_BUSY || base == SQLITE_LOCKED;
}

/* BEGIN IMMEDIATE waiting wait_ms; 0 holding, -1 busy, -2 other error */
static int begin_wait(Cg *cg, long wait_ms) {
    sqlite3_busy_timeout(cg->db, (int)wait_ms);
    int rc = sqlite3_exec(cg->db, "BEGIN IMMEDIATE", NULL, NULL, NULL);
    sqlite3_busy_timeout(cg->db, (int)cg_lock_wait_default());
    if (rc == SQLITE_OK) return 0;
    return rc_busy(rc) ? -1 : -2;
}

int journal_begin(Cg *cg) {
    if (g_busy_seen) {
        /* this process already waited out the lock once; a lifecycle
         * command must not pay the full wait again for every write */
        int rc = begin_wait(cg, 0);
        if (rc == 0) {
            if (journal_replay(cg, JOURNAL_HELD) < 0) return -1;
            return 0;
        }
        return -1;
    }
    if (cg_begin_write(cg) == 0) return 0;
    g_busy_seen = true;
    return -1;
}

static void set_err(char *err, size_t cap, const char *msg) {
    if (err && cap) snprintf(err, cap, "%s", msg ? msg : "unknown error");
}

/* The memory and event ops live here because their functions are public;
 * everything that needs another file's statics goes through that file's
 * *_journal_apply. 0 applied, -1 refused (err says why). */
static int apply_record(Cg *cg, const char *rec, char *err, size_t cap) {
    long v = json_get_int(rec, "v", -1);
    char *op = json_get_string(rec, "op");
    char *args = json_get_object(rec, "args");
    char *branch = json_get_string(rec, "branch");
    long at = json_get_int(rec, "at", 0);
    int rc = -1;
    if (v < 1 || !op || !args) {
        set_err(err, cap, "not a journal record (missing v, op, or args)");
    } else if (v > JOURNAL_VERSION) {
        char m[160];
        snprintf(m, sizeof m, "record format v%ld is newer than this cg "
                 "(v%d)", v, JOURNAL_VERSION);
        set_err(err, cap, m);
    } else if (strcmp(op, "memory.add") == 0) {
        char *type = json_get_string(args, "type");
        char *task = json_get_string(args, "task");
        char *body = json_get_string(args, "body");
        char *syms = json_get_string(args, "symbols");
        char *files = json_get_string(args, "files");
        char *source = json_get_string(args, "source");
        long created = json_get_int(args, "created", at / 1000);
        long sup = json_get_int(args, "supersedes", 0);
        if (!type || !body) {
            set_err(err, cap, "memory.add without type or body");
        } else {
            long id = memory_add_at(cg, created, branch, type, task, body,
                                    syms, files, source ? source : "manual");
            if (id < 0) set_err(err, cap, sqlite3_errmsg(cg->db));
            else {
                rc = 0;
                if (sup > 0 && memory_supersede(cg, sup, id) != 0) {
                    set_err(err, cap, "superseded memory does not exist");
                    rc = -1;
                }
            }
        }
        free(type); free(task); free(body); free(syms); free(files);
        free(source);
    } else if (strcmp(op, "event.emit") == 0) {
        char *kind = json_get_string(args, "kind");
        char *subject = json_get_string(args, "subject");
        char *node = json_get_string(args, "node");
        char *payload = json_get_raw(args, "payload");
        char *run = json_get_string(rec, "run");
        long eat = json_get_int(args, "at", at);
        if (payload && strcmp(payload, "null") == 0) {
            free(payload);
            payload = NULL;
        }
        if (!kind) set_err(err, cap, "event.emit without kind");
        else if (events_emit_at(cg, eat, kind, subject, run, node, branch,
                                payload) < 0)
            set_err(err, cap, sqlite3_errmsg(cg->db));
        else rc = 0;
        free(kind); free(subject); free(node); free(payload); free(run);
    } else if (strcmp(op, "lease.release") == 0 ||
               strcmp(op, "attempt.finish") == 0 ||
               strcmp(op, "attempt.heartbeat") == 0) {
        rc = spec_journal_apply(cg, op, args, err, cap);
    } else if (strcmp(op, "handoff.add") == 0 ||
               strcmp(op, "work.update") == 0 ||
               strcmp(op, "work.close") == 0) {
        rc = govern_journal_apply(cg, op, args, branch, at, err, cap);
    } else if (strcmp(op, "event.ingest") == 0) {
        rc = runtime_journal_apply(cg, args, err, cap);
    } else {
        char m[200];
        snprintf(m, sizeof m, "unknown operation '%s'", op);
        set_err(err, cap, m);
    }
    free(op); free(args); free(branch);
    return rc;
}

static bool already_applied(Cg *cg, const char *id) {
    sqlite3_stmt *st = NULL;
    if (sqlite3_prepare_v2(cg->db,
            "SELECT 1 FROM journal_applied WHERE id=?", -1, &st, NULL)
        != SQLITE_OK)
        return false;
    sqlite3_bind_text(st, 1, id, -1, SQLITE_TRANSIENT);
    bool hit = sqlite3_step(st) == SQLITE_ROW;
    sqlite3_finalize(st);
    return hit;
}

static void mark_applied(Cg *cg, const char *id) {
    sqlite3_stmt *st = NULL;
    if (sqlite3_prepare_v2(cg->db,
            "INSERT OR IGNORE INTO journal_applied(id,at) VALUES(?,?)", -1,
            &st, NULL) != SQLITE_OK)
        return;
    sqlite3_bind_text(st, 1, id, -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(st, 2, (sqlite3_int64)time(NULL));
    sqlite3_step(st);
    sqlite3_finalize(st);
}

/* Move a refused record aside with its error; this is the one time it is
 * reported. */
static void fail_record(const char *dir, const char *name, const char *err) {
    char fdir[4800], from[5000], to[5100], errp[5100];
    snprintf(fdir, sizeof fdir, "%s/failed", dir);
    mkdirs(fdir);
    snprintf(from, sizeof from, "%s/%s", dir, name);
    snprintf(to, sizeof to, "%s/%s", fdir, name);
    snprintf(errp, sizeof errp, "%s/%.*s.err", fdir,
             (int)(strlen(name) - 5), name);
    write_entire_file(errp, err, strlen(err));
    if (rename(from, to) != 0) unlink(from);
    fprintf(stderr, "cg: journal record %.*s was refused: %s — moved to "
            "%s/failed/ (cg journal lists it)\n", (int)(strlen(name) - 5),
            name, err, JOURNAL_SUBDIR);
}

/* own pid's records first, then everyone else's, each group in name order:
 * a process that queued a write and now holds the lock sees it before its
 * next write lands */
static void order_own_first(char **v, int n) {
    char mine[32];
    snprintf(mine, sizeof mine, "-%07ld-", (long)getpid());
    char **tmp = xmalloc(sizeof *tmp * (size_t)(n ? n : 1));
    int k = 0;
    for (int i = 0; i < n; i++)
        if (strlen(v[i]) > 14 && strncmp(v[i] + 13, mine, strlen(mine)) == 0)
            tmp[k++] = v[i];
    for (int i = 0; i < n; i++)
        if (!(strlen(v[i]) > 14 && strncmp(v[i] + 13, mine, strlen(mine)) == 0))
            tmp[k++] = v[i];
    memcpy(v, tmp, sizeof *v * (size_t)n);
    free(tmp);
}

static int g_replaying;

int journal_replay(Cg *cg, JournalMode mode) {
    if (!cg || !cg->db || g_replaying) return 0;
    bool held = mode == JOURNAL_HELD;
    if (!any_pending(cg)) return 0;
    char dir[4700];
    journal_dir(cg, dir, sizeof dir);
    int dfd = open(dir, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dfd < 0) return 0;
    /* never wait on another replayer: it may be waiting on the very database
     * lock this process holds */
    if (flock(dfd, LOCK_EX | LOCK_NB) != 0) { close(dfd); return 0; }
    g_replaying = 1;

    bool in_tx = held;
    if (!in_tx) {
        long wait = mode == JOURNAL_PROBE ? 0
                  : (cg->lock_wait_ms > 0 ? cg->lock_wait_ms
                                          : cg_lock_wait_default());
        int b = begin_wait(cg, wait);
        if (b != 0) {
            if (b == -1) g_busy_seen = mode == JOURNAL_WAIT || g_busy_seen;
            flock(dfd, LOCK_UN); close(dfd);
            g_replaying = 0;
            return -1;
        }
        in_tx = true;
    }
    sqlite3_exec(cg->db,
        "CREATE TABLE IF NOT EXISTS journal_applied("
        "id TEXT PRIMARY KEY, at INTEGER NOT NULL)", NULL, NULL, NULL);

    char **v;
    int n = list_records(dir, &v);
    order_own_first(v, n);
    int applied = 0;
    bool lost = false;
    for (int i = 0; i < n && !lost; i++) {
        if (!in_tx) {
            if (begin_wait(cg, cg->lock_wait_ms > 0 ? cg->lock_wait_ms
                                                   : cg_lock_wait_default())
                != 0) {
                lost = true;
                break;
            }
            in_tx = true;
        }
        char path[5000];
        snprintf(path, sizeof path, "%s/%s", dir, v[i]);
        size_t len = 0;
        char *rec = read_entire_file(path, &len);
        if (!rec) continue;            /* another replayer got there first */
        /* the envelope's id is the identity, so a record copied back under
         * another name is still recognised; the file name stands in only
         * when the record is too broken to carry one */
        char id[128];
        char *eid = json_get_string(rec, "id");
        if (eid && eid[0] && strlen(eid) < sizeof id)
            snprintf(id, sizeof id, "%s", eid);
        else
            snprintf(id, sizeof id, "%.*s", (int)(strlen(v[i]) - 5), v[i]);
        free(eid);
        if (already_applied(cg, id)) {
            /* applied before a crash took the unlink with it */
            unlink(path);
            free(rec);
            continue;
        }
        char err[512] = "";
        sqlite3_exec(cg->db, "SAVEPOINT journal_rec", NULL, NULL, NULL);
        int rc = apply_record(cg, rec, err, sizeof err);
        free(rec);
        if (rc == 0) {
            mark_applied(cg, id);
            sqlite3_exec(cg->db, "RELEASE journal_rec", NULL, NULL, NULL);
            if (sqlite3_exec(cg->db, "COMMIT", NULL, NULL, NULL) != SQLITE_OK) {
                sqlite3_exec(cg->db, "ROLLBACK", NULL, NULL, NULL);
                in_tx = false;
                lost = true;
                break;
            }
            in_tx = false;
            unlink(path);
            applied++;
        } else {
            sqlite3_exec(cg->db, "ROLLBACK TO journal_rec; RELEASE journal_rec",
                         NULL, NULL, NULL);
            sqlite3_exec(cg->db, "COMMIT", NULL, NULL, NULL);
            in_tx = false;
            fail_record(dir, v[i], err);
        }
    }
    free_list(v, n);
    if (!lost) {
        /* a week of applied ids is far longer than any crash window */
        if (!in_tx && begin_wait(cg, held ? (cg->lock_wait_ms > 0
                                 ? cg->lock_wait_ms : cg_lock_wait_default())
                                 : 0) == 0)
            in_tx = true;
        if (in_tx) {
            sqlite3_exec(cg->db, "DELETE FROM journal_applied WHERE at < "
                         "strftime('%s','now') - 7*86400", NULL, NULL, NULL);
            if (!held) {
                sqlite3_exec(cg->db, "COMMIT", NULL, NULL, NULL);
                in_tx = false;
            }
        } else if (held) {
            lost = true;
        }
    }
    flock(dfd, LOCK_UN);
    close(dfd);
    g_replaying = 0;
    if (lost) {
        if (in_tx) sqlite3_exec(cg->db, "ROLLBACK", NULL, NULL, NULL);
        return -1;
    }
    return applied;
}

/* ---------------- recall over queued memories ---------------- */

static bool ci_contains(const char *hay, const char *needle, size_t n) {
    if (!hay) return false;
    for (const char *p = hay; *p; p++) {
        size_t i = 0;
        while (i < n && p[i] &&
               tolower((unsigned char)p[i]) == tolower((unsigned char)needle[i]))
            i++;
        if (i == n) return true;
    }
    return false;
}

/* any word of the query, as recall's FTS ORs its prefix terms */
static bool query_hits(const char *q, const char *body, const char *task,
                       const char *syms) {
    if (!q || !q[0]) return true;
    for (const char *p = q; *p; ) {
        if (isalnum((unsigned char)*p) || *p == '_') {
            const char *s = p;
            while (isalnum((unsigned char)*p) || *p == '_') p++;
            size_t n = (size_t)(p - s);
            if (ci_contains(body, s, n) || ci_contains(task, s, n) ||
                ci_contains(syms, s, n))
                return true;
        } else {
            p++;
        }
    }
    return false;
}

int journal_queued_memories(const Cg *cg, const char *query, const char *task,
                            const char *type, Memory **out) {
    *out = NULL;
    char dir[4700];
    journal_dir(cg, dir, sizeof dir);
    char **v;
    int n = list_records(dir, &v);
    int k = 0;
    for (int i = 0; i < n; i++) {
        char path[5000];
        snprintf(path, sizeof path, "%s/%s", dir, v[i]);
        size_t len;
        char *rec = read_entire_file(path, &len);
        if (!rec) continue;
        char *op = json_get_string(rec, "op");
        char *args = json_get_object(rec, "args");
        if (op && args && strcmp(op, "memory.add") == 0) {
            Memory m;
            memset(&m, 0, sizeof m);
            m.type = json_get_string(args, "type");
            m.task = json_get_string(args, "task");
            m.body = json_get_string(args, "body");
            m.symbols = json_get_string(args, "symbols");
            m.files = json_get_string(args, "files");
            m.source = json_get_string(args, "source");
            m.branch = json_get_string(rec, "branch");
            m.created = json_get_int(args, "created", 0);
            if (!m.type) m.type = xstrdup("");
            if (!m.body) m.body = xstrdup("");
            if (!m.source) m.source = xstrdup("manual");
            bool keep = (!task || (m.task && strcmp(m.task, task) == 0)) &&
                        (!type || strcmp(m.type, type) == 0) &&
                        query_hits(query, m.body, m.task, m.symbols);
            if (keep) {
                *out = xrealloc(*out, sizeof **out * (size_t)(k + 1));
                (*out)[k++] = m;
            } else {
                memory_clear(&m);
            }
        }
        free(op); free(args); free(rec);
    }
    free_list(v, n);
    return k;
}

/* ---------------- cg journal ---------------- */

static void when_str(long at_ms, char *out, size_t cap) {
    time_t t = (time_t)(at_ms / 1000);
    struct tm tmv;
    if (localtime_r(&t, &tmv)) strftime(out, cap, "%Y-%m-%d %H:%M:%S", &tmv);
    else snprintf(out, cap, "?");
}

/* one listing row from a record file; error is the .err text for failed */
static void list_one(const char *dir, const char *name, const char *error,
                     bool json, StrBuf *b, int idx) {
    char path[5000];
    snprintf(path, sizeof path, "%s/%s", dir, name);
    size_t len;
    char *rec = read_entire_file(path, &len);
    char *op = rec ? json_get_string(rec, "op") : NULL;
    char *cmd = rec ? json_get_string(rec, "command") : NULL;
    char *sum = rec ? json_get_string(rec, "summary") : NULL;
    long at = rec ? json_get_int(rec, "at", 0) : 0;
    char id[128];
    snprintf(id, sizeof id, "%.*s", (int)(strlen(name) - 5), name);
    if (!at) at = atol(id);
    char when[32];
    when_str(at, when, sizeof when);
    if (json) {
        if (idx) sb_putc(b, ',');
        sb_puts(b, "{\"id\":"); sb_json_str(b, id);
        sb_printf(b, ",\"at\":%ld,\"op\":", at);
        if (op) sb_json_str(b, op); else sb_puts(b, "null");
        sb_puts(b, ",\"command\":");
        if (cmd) sb_json_str(b, cmd); else sb_puts(b, "null");
        sb_puts(b, ",\"summary\":");
        if (sum) sb_json_str(b, sum); else sb_puts(b, "null");
        if (error) { sb_puts(b, ",\"error\":"); sb_json_str(b, error); }
        sb_putc(b, '}');
    } else {
        sb_printf(b, "  %s  %s  %-14s %s%s%s\n", id, when,
                  cmd ? cmd : "?", op ? op : "unreadable",
                  sum && sum[0] ? " — " : "", sum ? sum : "");
        if (error) sb_printf(b, "      error: %s\n", error);
    }
    free(rec); free(op); free(cmd); free(sum);
}

static int journal_list(Cg *cg, bool json) {
    char dir[4700], fdir[4800];
    journal_dir(cg, dir, sizeof dir);
    snprintf(fdir, sizeof fdir, "%s/failed", dir);
    char **pv, **fv;
    int np = list_records(dir, &pv);
    int nf = list_records(fdir, &fv);
    StrBuf b; sb_init(&b);
    if (json) sb_puts(&b, "{\"pending\":[");
    else if (!np && !nf) sb_puts(&b, "journal: empty — nothing queued\n");
    else if (np) sb_printf(&b, "pending: %d (applied by the next cg command "
                           "that gets the write lock)\n", np);
    for (int i = 0; i < np; i++) list_one(dir, pv[i], NULL, json, &b, i);
    if (json) sb_puts(&b, "],\"failed\":[");
    else if (nf) sb_printf(&b, "failed: %d (refused by the database; "
                           "cg journal drop --failed clears them)\n", nf);
    for (int i = 0; i < nf; i++) {
        char errp[5000];
        snprintf(errp, sizeof errp, "%s/%.*s.err", fdir,
                 (int)(strlen(fv[i]) - 5), fv[i]);
        size_t len;
        char *e = read_entire_file(errp, &len);
        list_one(fdir, fv[i], e ? e : "unknown", json, &b, i);
        free(e);
    }
    if (json) sb_puts(&b, "]}\n");
    fputs(b.p, stdout);
    sb_free(&b);
    free_list(pv, np);
    free_list(fv, nf);
    return 0;
}

static int drop_in(const char *dir, const char *only, bool err_too) {
    char **v;
    int n = list_records(dir, &v), dropped = 0;
    for (int i = 0; i < n; i++) {
        if (only) {
            size_t ol = strlen(only);
            if (strncmp(v[i], only, ol) != 0 ||
                (v[i][ol] != 0 && strcmp(v[i] + ol, ".json") != 0))
                continue;
        }
        char p[5000];
        snprintf(p, sizeof p, "%s/%s", dir, v[i]);
        if (unlink(p) == 0) dropped++;
        if (err_too) {
            snprintf(p, sizeof p, "%s/%.*s.err", dir,
                     (int)(strlen(v[i]) - 5), v[i]);
            unlink(p);
        }
    }
    free_list(v, n);
    return dropped;
}

int cmd_journal(Cg *cg, int argc, char **argv, bool json) {
    const char *sub = argc > 0 ? argv[0] : "list";
    if (strcmp(sub, "list") == 0) return journal_list(cg, json);
    if (strcmp(sub, "apply") == 0) {
        int failed_before = 0, failed_after = 0;
        journal_pending(cg, &failed_before);
        int n = journal_replay(cg, JOURNAL_WAIT);
        int left = journal_pending(cg, &failed_after);
        if (n < 0) {
            if (json)
                printf("{\"applied\":0,\"busy\":true,\"pending\":%d}\n", left);
            else {
                cg_busy_why("the journal is applied only under the write "
                            "lock; the records stay queued");
                cg_busy_report("The journal replay");
            }
            return CG_EXIT_BUSY;
        }
        int nf = failed_after - failed_before;
        if (json)
            printf("{\"applied\":%d,\"failed\":%d,\"pending\":%d}\n", n,
                   nf > 0 ? nf : 0, left);
        else
            printf("journal: applied %d record(s)%s, %d pending\n", n,
                   nf > 0 ? ", some refused (cg journal)" : "", left);
        return 0;
    }
    if (strcmp(sub, "drop") == 0) {
        bool all = false, failed = false;
        const char *id = NULL;
        for (int i = 1; i < argc; i++) {
            if (strcmp(argv[i], "--all") == 0) all = true;
            else if (strcmp(argv[i], "--failed") == 0) failed = true;
            else if (argv[i][0] != '-') id = argv[i];
        }
        if (!all && !failed && !id) {
            fprintf(stderr, "usage: cg journal drop <id> | --failed | --all\n");
            return 1;
        }
        char dir[4700], fdir[4800];
        journal_dir(cg, dir, sizeof dir);
        snprintf(fdir, sizeof fdir, "%s/failed", dir);
        int n = 0;
        if (all || id) n += drop_in(dir, all ? NULL : id, false);
        if (all || failed || id) n += drop_in(fdir, (all || failed) ? NULL : id,
                                             true);
        if (id && !n) {
            fprintf(stderr, "cg journal: no record '%s'\n", id);
            return 1;
        }
        if (json) printf("{\"dropped\":%d}\n", n);
        else printf("journal: dropped %d record(s)\n", n);
        return 0;
    }
    fprintf(stderr, "usage: cg journal [list | apply | drop <id> | "
                    "drop --failed | drop --all]\n");
    return 1;
}
