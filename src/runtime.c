/*
 * cg state — one truthful view across the independent state machines an
 * agent otherwise conflates: Git, Codify snapshots, spec declarations, and
 * live execution attempts. None of these is presented as proof of another.
 */
#include "cg.h"
#include <ctype.h>
#include <dirent.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>

typedef struct {
    bool available;
    bool dirty;
    int changed;
    char branch[512];
} GitState;

static void state_git(const Cg *cg, GitState *s) {
    memset(s, 0, sizeof *s);
    if (!git_available(cg)) return;
    StrBuf cmd; sb_init(&cmd);
    sb_printf(&cmd, "git -C '%s' status --porcelain=v1 --branch 2>/dev/null",
              cg->root);
    FILE *f = popen(cmd.p, "r");
    sb_free(&cmd);
    if (!f) return;
    char *line = NULL;
    size_t cap = 0;
    ssize_t n;
    while ((n = getline(&line, &cap, f)) > 0) {
        while (n > 0 && (line[n - 1] == '\n' || line[n - 1] == '\r'))
            line[--n] = 0;
        if (strncmp(line, "## ", 3) == 0) {
            snprintf(s->branch, sizeof s->branch, "%s", line + 3);
        } else if (n > 0) {
            s->changed++;
        }
    }
    free(line);
    int rc = pclose(f);
    s->available = WIFEXITED(rc) && WEXITSTATUS(rc) == 0;
    s->dirty = s->changed > 0;
}

typedef struct { Cg *g; bool json; } StateVcsCall;
static int state_call_vcs(void *v) {
    StateVcsCall *c = v;
    return cmd_status(c->g, c->json);
}

typedef struct { bool json; bool reconcile; } StateSpecCall;
static int state_call_spec(void *v) {
    StateSpecCall *c = v;
    char *status[] = { "status" };
    char *reconcile[] = { "reconcile" };
    return cmd_spec(1, c->reconcile ? reconcile : status, c->json);
}

static void state_raw_json(StrBuf *b, const char *raw) {
    if (!raw) { sb_puts(b, "null"); return; }
    while (*raw && isspace((unsigned char)*raw)) raw++;
    size_t n = strlen(raw);
    while (n && isspace((unsigned char)raw[n - 1])) n--;
    if (!n) sb_puts(b, "null");
    else sb_printf(b, "%.*s", (int)n, raw);
}

static bool state_live_attempt(Cg *cg, const char *agent, SpecAttempt *a,
                               char host[256], char session[256]) {
    memset(a, 0, sizeof *a);
    host[0] = session[0] = 0;
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT attempt_id,task,agent,fence,heartbeat,expires,"
        "ifnull(host,''),ifnull(session,'') FROM attempts "
        "WHERE agent=? AND state='running' "
        "AND expires>strftime('%s','now') ORDER BY fence DESC LIMIT 1");
    sqlite3_bind_text(st, 1, agent, -1, SQLITE_TRANSIENT);
    bool found = sqlite3_step(st) == SQLITE_ROW;
    if (found) {
        snprintf(a->attempt_id, sizeof a->attempt_id, "%s",
                 (const char *)sqlite3_column_text(st, 0));
        snprintf(a->task, sizeof a->task, "%s",
                 (const char *)sqlite3_column_text(st, 1));
        snprintf(a->agent, sizeof a->agent, "%s",
                 (const char *)sqlite3_column_text(st, 2));
        a->fence = (long)sqlite3_column_int64(st, 3);
        a->heartbeat = (long)sqlite3_column_int64(st, 4);
        a->expires = (long)sqlite3_column_int64(st, 5);
        snprintf(host, 256, "%s", (const char *)sqlite3_column_text(st, 6));
        snprintf(session, 256, "%s",
                 (const char *)sqlite3_column_text(st, 7));
    }
    sqlite3_finalize(st);
    return found;
}

int cmd_state(Cg *cg, bool json) {
    GitState git;
    state_git(cg, &git);
    const char *agent = cg_agent_name(NULL);
    SpecAttempt attempt;
    char host[256], session[256];
    bool live = state_live_attempt(cg, agent, &attempt, host, session);

    char *snapshot = NULL, *declaration = NULL, *stale = NULL;
    StateVcsCall vc = { cg, json };
    StateSpecCall sc = { json, false }, sr = { json, true };
    cg_capture(&snapshot, state_call_vcs, &vc);
    cg_capture(&declaration, state_call_spec, &sc);
    cg_capture(&stale, state_call_spec, &sr);

    if (json) {
        StrBuf b; sb_init(&b);
        sb_puts(&b, "{\"git\":{\"available\":");
        sb_puts(&b, git.available ? "true" : "false");
        sb_puts(&b, ",\"branch\":");
        if (git.available) sb_json_str(&b, git.branch);
        else sb_puts(&b, "null");
        sb_printf(&b, ",\"dirty\":%s,\"changed\":%d},"
                  "\"codify_snapshot\":", git.dirty ? "true" : "false",
                  git.changed);
        state_raw_json(&b, snapshot);
        sb_puts(&b, ",\"spec_declaration\":");
        state_raw_json(&b, declaration);
        sb_puts(&b, ",\"live_runtime\":{\"agent\":");
        sb_json_str(&b, agent);
        sb_puts(&b, ",\"owned_attempt\":");
        if (!live) {
            sb_puts(&b, "null");
        } else {
            sb_puts(&b, "{\"task\":"); sb_json_str(&b, attempt.task);
            sb_puts(&b, ",\"attempt_id\":");
            sb_json_str(&b, attempt.attempt_id);
            sb_printf(&b, ",\"fence\":%ld,\"heartbeat\":%ld,"
                      "\"expires\":%ld,\"host\":", attempt.fence,
                      attempt.heartbeat, attempt.expires);
            sb_json_str(&b, host);
            sb_puts(&b, ",\"session\":"); sb_json_str(&b, session);
            sb_putc(&b, '}');
        }
        sb_puts(&b, "},\"stale_state\":");
        state_raw_json(&b, stale);
        sb_puts(&b, "}\n");
        fputs(b.p, stdout);
        sb_free(&b);
    } else {
        printf("Git state: %s", git.available ? git.branch : "unavailable");
        if (git.available)
            printf(" — %s (%d changed)", git.dirty ? "dirty" : "clean",
                   git.changed);
        putchar('\n');
        printf("Codify snapshot state:\n%s", snapshot ? snapshot : "");
        printf("Spec declaration state:\n%s", declaration ? declaration : "");
        printf("Live runtime ownership: ");
        if (live)
            printf("%s attempt %.12s fence %ld (agent %s)\n", attempt.task,
                   attempt.attempt_id, attempt.fence, agent);
        else
            printf("none for agent %s\n", agent);
        printf("Stale state:\n%s", stale ? stale : "");
    }
    free(snapshot); free(declaration); free(stale);
    return 0;
}

/* ---------------- normalized lifecycle events ---------------- */

static int runtime_key_cmp(const void *a, const void *b) {
    return strcmp(*(const char *const *)a, *(const char *const *)b);
}

/* Reject truncated hook input before the deliberately small JSON accessors
 * inspect it. The hook boundary needs structural validation, not a full DOM:
 * nested objects/arrays and quoted delimiters are accepted, while trailing
 * bytes, mismatched delimiters, and unterminated strings are refused. */
static bool runtime_json_object_valid(const char *payload) {
    const char *p = payload;
    while (*p && isspace((unsigned char)*p)) p++;
    if (*p != '{') return false;
    char stack[256];
    int depth = 0;
    bool string = false, escape = false;
    for (; *p; p++) {
        if (string) {
            if (escape) escape = false;
            else if (*p == '\\') escape = true;
            else if (*p == '"') string = false;
            continue;
        }
        if (*p == '"') { string = true; continue; }
        if (*p == '{' || *p == '[') {
            if (depth == (int)sizeof stack) return false;
            stack[depth++] = *p == '{' ? '}' : ']';
        } else if (*p == '}' || *p == ']') {
            if (!depth || stack[depth - 1] != *p) return false;
            if (--depth == 0) {
                p++;
                while (*p && isspace((unsigned char)*p)) p++;
                return !*p && !string;
            }
        }
    }
    return false;
}

/* Stable for top-level JSON key order and insignificant whitespace. Native
 * hosts use different field names, but preserving every sorted top-level
 * value keeps unknown fields part of deduplication without storing secrets in
 * the fingerprint itself. */
static char *runtime_canonical_json(const char *payload) {
    char *keys[64];
    int n = json_object_keys(payload, keys, 64);
    qsort(keys, (size_t)n, sizeof(char *), runtime_key_cmp);
    StrBuf b; sb_init(&b);
    for (int i = 0; i < n; i++) {
        char *raw = json_get_raw(payload, keys[i]);
        sb_puts(&b, keys[i]); sb_putc(&b, '=');
        if (raw) {
            bool string = false, escape = false;
            for (const char *p = raw; *p; p++) {
                if (string) {
                    sb_putc(&b, *p);
                    if (escape) escape = false;
                    else if (*p == '\\') escape = true;
                    else if (*p == '"') string = false;
                } else if (*p == '"') {
                    string = true; sb_putc(&b, *p);
                } else if (!isspace((unsigned char)*p)) sb_putc(&b, *p);
            }
        }
        sb_putc(&b, '\n');
        free(raw); free(keys[i]);
    }
    if (!n) sb_puts(&b, payload ? payload : "");
    return b.p;
}

static char *runtime_first_string(const char *payload,
                                  const char *const *keys) {
    for (int i = 0; keys[i]; i++) {
        char *v = json_get_string(payload, keys[i]);
        if (v && v[0]) return v;
        free(v);
    }
    return NULL;
}

static char *runtime_first_raw(const char *payload,
                               const char *const *keys) {
    for (int i = 0; keys[i]; i++) {
        char *v = json_get_raw(payload, keys[i]);
        if (v && v[0] && strcmp(v, "null") != 0) return v;
        free(v);
    }
    return NULL;
}

static char *runtime_kind(const char *payload) {
    static const char *const KEYS[] = {
        "kind", "event", "type", "hook_event_name", "eventName",
        "hookType", NULL
    };
    char *native = runtime_first_string(payload, KEYS);
    if (!native) return xstrdup("event");
    for (char *p = native; *p; p++) *p = (char)tolower((unsigned char)*p);
    const char *kind = strstr(native, "heartbeat") ? "heartbeat"
        : strstr(native, "edit") || strstr(native, "write") ? "write"
        : strstr(native, "command") || strstr(native, "tool") ? "command"
        : strstr(native, "stop") || strstr(native, "end") ? "stop"
        : strstr(native, "start") || strstr(native, "session") ? "session"
        : "event";
    free(native);
    return xstrdup(kind);
}

typedef struct {
    char *path;
    long size;
    sqlite3_int64 mtime_ns, ctime_ns;
    char hash[65];
} RuntimeFile;

typedef struct { RuntimeFile *v; int n, cap; } RuntimeFiles;

static void runtime_files_push(RuntimeFiles *files, const char *path,
                               const struct stat *st) {
    if (files->n == files->cap) {
        files->cap = files->cap ? files->cap * 2 : 256;
        files->v = xrealloc(files->v,
                            sizeof(RuntimeFile) * (size_t)files->cap);
    }
    RuntimeFile *f = &files->v[files->n++];
    memset(f, 0, sizeof *f);
    f->path = xstrdup(path);
    f->size = (long)st->st_size;
    f->mtime_ns = (sqlite3_int64)st->st_mtime * 1000000000LL
                  + st->st_mtim.tv_nsec;
    f->ctime_ns = (sqlite3_int64)st->st_ctime * 1000000000LL
                  + st->st_ctim.tv_nsec;
}

static void runtime_walk_files(const char *root, const char *rel,
                               const Ignore *ig, RuntimeFiles *files) {
    char abs[4600];
    snprintf(abs, sizeof abs, "%s/%s", root, rel[0] ? rel : ".");
    DIR *d = opendir(abs);
    if (!d) return;
    struct dirent *e;
    while ((e = readdir(d))) {
        if (strcmp(e->d_name, ".") == 0 || strcmp(e->d_name, "..") == 0)
            continue;
        char child[4096], child_abs[4900];
        if (rel[0]) snprintf(child, sizeof child, "%s/%s", rel, e->d_name);
        else snprintf(child, sizeof child, "%s", e->d_name);
        snprintf(child_abs, sizeof child_abs, "%s/%s", root, child);
        struct stat st;
        if (lstat(child_abs, &st) != 0 || S_ISLNK(st.st_mode)) continue;
        bool dir = S_ISDIR(st.st_mode);
        if (ignore_match(ig, child, dir)) continue;
        if (dir) runtime_walk_files(root, child, ig, files);
        else if (S_ISREG(st.st_mode) && st.st_size <= 32L * 1024 * 1024)
            runtime_files_push(files, child, &st);
    }
    closedir(d);
}

static int runtime_file_cmp(const void *a, const void *b) {
    return strcmp(((const RuntimeFile *)a)->path,
                  ((const RuntimeFile *)b)->path);
}

void runtime_workspace_revision(Cg *cg, char out[65]) {
    Ignore ig;
    ignore_load(&ig, cg->root);
    RuntimeFiles files = {0};
    runtime_walk_files(cg->root, "", &ig, &files);
    ignore_free(&ig);
    qsort(files.v, (size_t)files.n, sizeof(RuntimeFile), runtime_file_cmp);

    sqlite3_stmt *find = cg_prep(cg,
        "SELECT size,mtime_ns,ctime_ns,hash FROM runtime_files WHERE path=?");
    sqlite3_stmt *save = cg_prep(cg,
        "INSERT INTO runtime_files(path,size,mtime_ns,ctime_ns,hash) "
        "VALUES(?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET "
        "size=excluded.size,mtime_ns=excluded.mtime_ns,"
        "ctime_ns=excluded.ctime_ns,hash=excluded.hash");
    StrBuf manifest; sb_init(&manifest);
    for (int i = 0; i < files.n; i++) {
        RuntimeFile *f = &files.v[i];
        sqlite3_bind_text(find, 1, f->path, -1, SQLITE_TRANSIENT);
        bool cached = sqlite3_step(find) == SQLITE_ROW
            && sqlite3_column_int64(find, 0) == f->size
            && sqlite3_column_int64(find, 1) == f->mtime_ns
            && sqlite3_column_int64(find, 2) == f->ctime_ns;
        if (cached) {
            snprintf(f->hash, sizeof f->hash, "%s",
                     (const char *)sqlite3_column_text(find, 3));
        }
        sqlite3_reset(find); sqlite3_clear_bindings(find);
        if (!cached) {
            char abs[4900];
            snprintf(abs, sizeof abs, "%s/%s", cg->root, f->path);
            size_t len = 0;
            char *data = read_entire_file(abs, &len);
            if (!data) continue;
            sha256_hex(data, len, f->hash);
            free(data);
            sqlite3_bind_text(save, 1, f->path, -1, SQLITE_TRANSIENT);
            sqlite3_bind_int64(save, 2, f->size);
            sqlite3_bind_int64(save, 3, f->mtime_ns);
            sqlite3_bind_int64(save, 4, f->ctime_ns);
            sqlite3_bind_text(save, 5, f->hash, -1, SQLITE_TRANSIENT);
            sqlite3_step(save);
            sqlite3_reset(save); sqlite3_clear_bindings(save);
        }
        sb_puts(&manifest, f->path); sb_putc(&manifest, '\0');
        sb_puts(&manifest, f->hash); sb_putc(&manifest, '\n');
    }
    sqlite3_finalize(find); sqlite3_finalize(save);
    sha256_hex(manifest.p, manifest.len, out);
    sb_free(&manifest);
    for (int i = 0; i < files.n; i++) free(files.v[i].path);
    free(files.v);
}

int runtime_event_ingest(Cg *cg, const char *source, const char *payload,
                         bool json) {
    if (!payload || !runtime_json_object_valid(payload)) {
        fprintf(stderr, "cg event: ingest expects one JSON object on stdin\n");
        return 1;
    }
    static const char *const SESSION_KEYS[] = {
        "session", "session_id", "sessionId", "conversation_id",
        "thread_id", NULL
    };
    static const char *const ATTEMPT_KEYS[] = {
        "attempt_id", "attemptId", NULL
    };
    static const char *const TASK_KEYS[] = { "task", "task_id", NULL };
    static const char *const OUTPUT_KEYS[] = {
        "output", "tool_output", "result", "message", NULL
    };
    char *kind = runtime_kind(payload);
    char *session = runtime_first_string(payload, SESSION_KEYS);
    char *attempt = runtime_first_string(payload, ATTEMPT_KEYS);
    char *task = runtime_first_string(payload, TASK_KEYS);
    char *output = runtime_first_raw(payload, OUTPUT_KEYS);
    const char *env;
    if (!session && (env = getenv("CG_SESSION")) && env[0])
        session = xstrdup(env);
    if (!attempt && (env = getenv("CG_ATTEMPT")) && env[0])
        attempt = xstrdup(env);
    if (!task && (env = getenv("CG_TASK")) && env[0]) task = xstrdup(env);
    if (!task) task = spec_active_tag();
    if (!session) session = xstrdup("local");
    if (!attempt) attempt = xstrdup("");
    if (!task) task = xstrdup("");

    char revision[65], output_hash[65] = "";
    runtime_workspace_revision(cg, revision);
    if (output) sha256_hex(output, strlen(output), output_hash);

    char previous[65] = "", previous_output[65] = "";
    sqlite3_stmt *prev;
    if (attempt[0]) {
        prev = cg_prep(cg,
            "SELECT revision,ifnull(output_hash,'') FROM runtime_events "
            "WHERE attempt_id=? ORDER BY id DESC LIMIT 1");
        sqlite3_bind_text(prev, 1, attempt, -1, SQLITE_TRANSIENT);
    } else {
        prev = cg_prep(cg,
            "SELECT revision,ifnull(output_hash,'') FROM runtime_events "
            "WHERE session=? ORDER BY id DESC LIMIT 1");
        sqlite3_bind_text(prev, 1, session, -1, SQLITE_TRANSIENT);
    }
    bool have_previous = sqlite3_step(prev) == SQLITE_ROW;
    if (have_previous) {
        snprintf(previous, sizeof previous, "%s",
                 (const char *)sqlite3_column_text(prev, 0));
        snprintf(previous_output, sizeof previous_output, "%s",
                 (const char *)sqlite3_column_text(prev, 1));
    }
    sqlite3_finalize(prev);
    bool evidence = have_previous && strcmp(previous, revision) != 0;
    bool output_changed = have_previous && output_hash[0] &&
                          strcmp(previous_output, output_hash) != 0;

    char *canonical = runtime_canonical_json(payload);
    StrBuf seed; sb_init(&seed);
    sb_printf(&seed, "%s\n%s\n%s\n%s\n%s\n%s\n%s", source, kind,
              session, attempt, task, revision, canonical);
    char fingerprint[65];
    sha256_hex(seed.p, seed.len, fingerprint);
    sb_free(&seed); free(canonical);

    sqlite3_stmt *ins = cg_prep(cg,
        "INSERT OR IGNORE INTO runtime_events(created,source,kind,session,"
        "attempt_id,task,fingerprint,revision,previous_revision,"
        "evidence_delta,activity,output_hash,output_changed,payload) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    sqlite3_bind_int64(ins, 1, (long)time(NULL));
    sqlite3_bind_text(ins, 2, source, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(ins, 3, kind, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(ins, 4, session, -1, SQLITE_TRANSIENT);
    if (attempt[0]) sqlite3_bind_text(ins, 5, attempt, -1, SQLITE_TRANSIENT);
    else sqlite3_bind_null(ins, 5);
    if (task[0]) sqlite3_bind_text(ins, 6, task, -1, SQLITE_TRANSIENT);
    else sqlite3_bind_null(ins, 6);
    sqlite3_bind_text(ins, 7, fingerprint, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(ins, 8, revision, -1, SQLITE_TRANSIENT);
    if (previous[0]) sqlite3_bind_text(ins, 9, previous, -1, SQLITE_TRANSIENT);
    else sqlite3_bind_null(ins, 9);
    sqlite3_bind_int(ins, 10, evidence);
    sqlite3_bind_int(ins, 11, 1);
    if (output_hash[0])
        sqlite3_bind_text(ins, 12, output_hash, -1, SQLITE_TRANSIENT);
    else sqlite3_bind_null(ins, 12);
    sqlite3_bind_int(ins, 13, output_changed);
    sqlite3_bind_text(ins, 14, payload, -1, SQLITE_TRANSIENT);
    sqlite3_step(ins);
    bool inserted = sqlite3_changes(cg->db) == 1;
    long id = inserted ? (long)sqlite3_last_insert_rowid(cg->db) : 0;
    sqlite3_finalize(ins);
    if (!inserted) {
        sqlite3_stmt *q = cg_prep(cg,
            "SELECT id FROM runtime_events WHERE fingerprint=?");
        sqlite3_bind_text(q, 1, fingerprint, -1, SQLITE_TRANSIENT);
        if (sqlite3_step(q) == SQLITE_ROW) id = sqlite3_column_int64(q, 0);
        sqlite3_finalize(q);
    }
    bool implementation = evidence && strcmp(kind, "heartbeat") != 0;
    if (json) {
        StrBuf b; sb_init(&b);
        sb_printf(&b, "{\"id\":%ld,\"duplicate\":%s,\"source\":", id,
                  inserted ? "false" : "true");
        sb_json_str(&b, source); sb_puts(&b, ",\"kind\":");
        sb_json_str(&b, kind); sb_puts(&b, ",\"session\":");
        sb_json_str(&b, session); sb_puts(&b, ",\"attempt_id\":");
        if (attempt[0]) sb_json_str(&b, attempt); else sb_puts(&b, "null");
        sb_puts(&b, ",\"task\":");
        if (task[0]) sb_json_str(&b, task); else sb_puts(&b, "null");
        sb_puts(&b, ",\"fingerprint\":"); sb_json_str(&b, fingerprint);
        sb_puts(&b, ",\"workspace_revision\":"); sb_json_str(&b, revision);
        sb_printf(&b, ",\"activity\":true,\"output_changed\":%s,"
                  "\"evidence_delta\":%d,\"implementation_progress\":%s}\n",
                  output_changed ? "true" : "false", evidence,
                  implementation ? "true" : "false");
        fputs(b.p, stdout); sb_free(&b);
    } else {
        printf("event %ld %s/%s %.12s — activity%s%s%s\n", id, source, kind,
               fingerprint, output_changed ? ", output changed" : "",
               evidence ? ", revision changed" : "",
               implementation ? ", implementation progress" : "");
    }
    free(kind); free(session); free(attempt); free(task); free(output);
    return 0;
}

static int runtime_event_history(Cg *cg, int limit, bool json) {
    if (limit < 1) limit = 20;
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT id,created,source,kind,session,ifnull(attempt_id,''),"
        "ifnull(task,''),fingerprint,revision,evidence_delta,activity,"
        "output_changed FROM runtime_events ORDER BY id DESC LIMIT ?");
    sqlite3_bind_int(st, 1, limit);
    int n = 0;
    StrBuf b; sb_init(&b);
    if (json) sb_puts(&b, "{\"events\":[");
    while (sqlite3_step(st) == SQLITE_ROW) {
        if (json) {
            if (n) sb_putc(&b, ',');
            sb_printf(&b, "{\"id\":%ld,\"created\":%ld,\"source\":",
                      (long)sqlite3_column_int64(st, 0),
                      (long)sqlite3_column_int64(st, 1));
            sb_json_str(&b, (const char *)sqlite3_column_text(st, 2));
            sb_puts(&b, ",\"kind\":");
            sb_json_str(&b, (const char *)sqlite3_column_text(st, 3));
            sb_puts(&b, ",\"session\":");
            sb_json_str(&b, (const char *)sqlite3_column_text(st, 4));
            sb_puts(&b, ",\"attempt_id\":");
            const char *attempt = (const char *)sqlite3_column_text(st, 5);
            if (attempt[0]) sb_json_str(&b, attempt); else sb_puts(&b, "null");
            sb_puts(&b, ",\"task\":");
            const char *task = (const char *)sqlite3_column_text(st, 6);
            if (task[0]) sb_json_str(&b, task); else sb_puts(&b, "null");
            sb_puts(&b, ",\"fingerprint\":");
            sb_json_str(&b, (const char *)sqlite3_column_text(st, 7));
            sb_puts(&b, ",\"workspace_revision\":");
            sb_json_str(&b, (const char *)sqlite3_column_text(st, 8));
            sb_printf(&b, ",\"evidence_delta\":%d,\"activity\":%s,"
                      "\"output_changed\":%s}", sqlite3_column_int(st, 9),
                      sqlite3_column_int(st, 10) ? "true" : "false",
                      sqlite3_column_int(st, 11) ? "true" : "false");
        } else {
            sb_printf(&b, "  #%ld %s/%s session=%s%s%s\n",
                      (long)sqlite3_column_int64(st, 0),
                      (const char *)sqlite3_column_text(st, 2),
                      (const char *)sqlite3_column_text(st, 3),
                      (const char *)sqlite3_column_text(st, 4),
                      sqlite3_column_int(st, 9) ? " revision+" : "",
                      sqlite3_column_int(st, 11) ? " output+" : "");
        }
        n++;
    }
    sqlite3_finalize(st);
    if (json) sb_printf(&b, "],\"count\":%d}\n", n);
    else if (!n) sb_puts(&b, "no runtime events\n");
    else {
        StrBuf h; sb_init(&h); sb_printf(&h, "runtime events (%d):\n", n);
        sb_puts(&h, b.p); sb_free(&b); b = h;
    }
    fputs(b.p, stdout); sb_free(&b);
    return 0;
}

int runtime_progress(Cg *cg, bool json) {
    const char *attempt = getenv("CG_ATTEMPT");
    const char *session = getenv("CG_SESSION");
    sqlite3_stmt *st;
    if (attempt && attempt[0]) {
        st = cg_prep(cg,
            "SELECT id,created,source,kind,revision,evidence_delta,"
            "output_changed,session,ifnull(task,'') FROM runtime_events "
            "WHERE attempt_id=? ORDER BY id DESC LIMIT 1");
        sqlite3_bind_text(st, 1, attempt, -1, SQLITE_TRANSIENT);
    } else if (session && session[0]) {
        st = cg_prep(cg,
            "SELECT id,created,source,kind,revision,evidence_delta,"
            "output_changed,session,ifnull(task,'') FROM runtime_events "
            "WHERE session=? ORDER BY id DESC LIMIT 1");
        sqlite3_bind_text(st, 1, session, -1, SQLITE_TRANSIENT);
    } else {
        st = cg_prep(cg,
            "SELECT id,created,source,kind,revision,evidence_delta,"
            "output_changed,session,ifnull(task,'') FROM runtime_events "
            "ORDER BY id DESC LIMIT 1");
    }
    if (sqlite3_step(st) != SQLITE_ROW) {
        sqlite3_finalize(st);
        if (json) printf("{\"activity\":false,\"reason\":\"no events\"}\n");
        else printf("progress: no runtime events\n");
        return 0;
    }
    long id = (long)sqlite3_column_int64(st, 0);
    long created = (long)sqlite3_column_int64(st, 1);
    const char *source = (const char *)sqlite3_column_text(st, 2);
    const char *kind = (const char *)sqlite3_column_text(st, 3);
    const char *revision = (const char *)sqlite3_column_text(st, 4);
    bool evidence = sqlite3_column_int(st, 5) != 0;
    bool output_changed = sqlite3_column_int(st, 6) != 0;
    const char *ev_session = (const char *)sqlite3_column_text(st, 7);
    const char *task = (const char *)sqlite3_column_text(st, 8);
    bool implementation = evidence && strcmp(kind, "heartbeat") != 0;
    long age = (long)time(NULL) - created;
    if (json) {
        StrBuf b; sb_init(&b);
        sb_printf(&b, "{\"activity\":true,\"last_event_id\":%ld,"
                  "\"age_seconds\":%ld,\"source\":", id, age);
        sb_json_str(&b, source); sb_puts(&b, ",\"kind\":");
        sb_json_str(&b, kind); sb_puts(&b, ",\"session\":");
        sb_json_str(&b, ev_session); sb_puts(&b, ",\"task\":");
        if (task[0]) sb_json_str(&b, task); else sb_puts(&b, "null");
        sb_puts(&b, ",\"workspace_revision\":"); sb_json_str(&b, revision);
        sb_printf(&b, ",\"output_changed\":%s,\"evidence_delta\":%d,"
                  "\"implementation_progress\":%s}\n",
                  output_changed ? "true" : "false", evidence,
                  implementation ? "true" : "false");
        fputs(b.p, stdout); sb_free(&b);
    } else {
        printf("progress: %s/%s %lds ago — activity%s%s\n", source, kind, age,
               output_changed ? ", output changed" : "",
               implementation ? ", implementation progress" :
               evidence ? ", evidence changed (heartbeat only)" : "");
    }
    sqlite3_finalize(st);
    return 0;
}

int cmd_event(Cg *cg, int argc, char **argv, bool json) {
    const char *sub = argc > 0 ? argv[0] : "history";
    const char *source = "generic";
    int limit = 20;
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--source") == 0 && i + 1 < argc)
            source = argv[++i];
        else if (strcmp(argv[i], "-n") == 0 && i + 1 < argc)
            limit = atoi(argv[++i]);
    }
    if (strcmp(sub, "ingest") == 0) {
        StrBuf b; sb_init(&b);
        char chunk[4096];
        size_t n;
        while ((n = fread(chunk, 1, sizeof chunk, stdin)) > 0)
            for (size_t i = 0; i < n; i++) sb_putc(&b, chunk[i]);
        while (b.len && isspace((unsigned char)b.p[b.len - 1]))
            b.p[--b.len] = 0;
        int rc = runtime_event_ingest(cg, source, b.p, json);
        sb_free(&b);
        return rc;
    }
    if (strcmp(sub, "history") == 0) return runtime_event_history(cg, limit, json);
    if (strcmp(sub, "progress") == 0) return runtime_progress(cg, json);
    fprintf(stderr, "usage: cg event [ingest [--source HOST] | history [-n N] | progress]\n");
    return 1;
}
