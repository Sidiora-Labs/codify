/*
 * cg remember / recall / forget — durable agent memory.
 *
 * Memories are deliberate notes written while working — decisions,
 * constraints, outcomes, preferences, facts — stored in the same SQLite
 * database as the code graph and linked to spec tasks by "feature/id".
 * The spec engine records terse outcome memories automatically on
 * `cg spec done` (including refused completions) and surfaces relevant
 * memories on next/start/trace, so an agent meets its own notes exactly
 * when they matter. Retrieval is FTS5 over the body (prefix terms OR'd,
 * bm25 rank) with recency as the tie-breaker.
 */
#include "cg.h"
#include <ctype.h>
#include <time.h>

bool memory_open_quiet(Cg *g) {
    char root[4096];
    if (cg_find_root(root, sizeof root) != 0) return false;
    return cg_open(g, false) == 0;
}

static void bind_opt(sqlite3_stmt *st, int i, const char *v) {
    if (v && v[0]) sqlite3_bind_text(st, i, v, -1, SQLITE_TRANSIENT);
    else sqlite3_bind_null(st, i);
}

long memory_add(Cg *cg, const char *type, const char *task, const char *body,
                const char *symbols, const char *files, const char *source) {
    /* The spec engine writes an outcome on every done and every refusal, so
     * repeating a task drops identical rows in. Collapse them at write time:
     * refresh the existing row's timestamp instead of adding a twin. */
    if (source && strcmp(source, "auto") == 0) {
        sqlite3_stmt *dup = cg_prep(cg,
            "SELECT id FROM memories WHERE body=? AND type=? "
            "AND ifnull(task,'')=ifnull(?,'') ORDER BY id DESC LIMIT 1");
        sqlite3_bind_text(dup, 1, body, -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(dup, 2, type, -1, SQLITE_TRANSIENT);
        bind_opt(dup, 3, task);
        long found = -1;
        if (sqlite3_step(dup) == SQLITE_ROW)
            found = (long)sqlite3_column_int64(dup, 0);
        sqlite3_finalize(dup);
        if (found > 0) {
            sqlite3_stmt *up = cg_prep(cg,
                "UPDATE memories SET created=? WHERE id=?");
            sqlite3_bind_int64(up, 1, (sqlite3_int64)time(NULL));
            sqlite3_bind_int64(up, 2, found);
            sqlite3_step(up);
            sqlite3_finalize(up);
            return found;
        }
    }
    sqlite3_stmt *st = cg_prep(cg,
        "INSERT INTO memories(created,type,task,body,symbols,files,source)"
        " VALUES(?,?,?,?,?,?,?)");
    sqlite3_bind_int64(st, 1, (sqlite3_int64)time(NULL));
    sqlite3_bind_text(st, 2, type, -1, SQLITE_TRANSIENT);
    bind_opt(st, 3, task);
    sqlite3_bind_text(st, 4, body, -1, SQLITE_TRANSIENT);
    bind_opt(st, 5, symbols);
    bind_opt(st, 6, files);
    sqlite3_bind_text(st, 7, source, -1, SQLITE_TRANSIENT);
    int rc = sqlite3_step(st);
    sqlite3_finalize(st);
    if (rc != SQLITE_DONE) return -1;
    long id = (long)sqlite3_last_insert_rowid(cg->db);

    st = cg_prep(cg,
        "INSERT INTO memory_fts(rowid,body,task,symbols) VALUES(?,?,?,?)");
    sqlite3_bind_int64(st, 1, id);
    sqlite3_bind_text(st, 2, body, -1, SQLITE_TRANSIENT);
    bind_opt(st, 3, task);
    bind_opt(st, 4, symbols);
    sqlite3_step(st);
    sqlite3_finalize(st);
    return id;
}

/* free text -> safe FTS5 query: quoted prefix terms OR'd; NULL if no terms */
static char *fts_query(const char *q) {
    StrBuf b; sb_init(&b);
    int terms = 0;
    for (const char *p = q; *p; ) {
        if (isalnum((unsigned char)*p) || *p == '_') {
            const char *s = p;
            while (isalnum((unsigned char)*p) || *p == '_') p++;
            if (terms) sb_puts(&b, " OR ");
            sb_putc(&b, '"');
            for (const char *c = s; c < p; c++) sb_putc(&b, *c);
            sb_puts(&b, "\"*");
            terms++;
        } else {
            p++;
        }
    }
    if (!terms) { sb_free(&b); return NULL; }
    return b.p;
}

static char *col_dup(sqlite3_stmt *st, int i) {
    const char *v = (const char *)sqlite3_column_text(st, i);
    return v ? xstrdup(v) : NULL;
}

static void mem_row(sqlite3_stmt *st, Memory *m) {
    m->id = (long)sqlite3_column_int64(st, 0);
    m->created = (long)sqlite3_column_int64(st, 1);
    m->type = col_dup(st, 2);
    if (!m->type) m->type = xstrdup("");
    m->task = col_dup(st, 3);
    m->body = col_dup(st, 4);
    if (!m->body) m->body = xstrdup("");
    m->symbols = col_dup(st, 5);
    m->files = col_dup(st, 6);
    m->source = col_dup(st, 7);
    if (!m->source) m->source = xstrdup("");
}

/* Decisions get reversed. A superseded memory is still true history, so it
 * is never deleted — it just sorts last, so the current decision is what a
 * session meets first. */
#define SUPERSEDED_RANK \
    " (SELECT COUNT(*) FROM memory_superseded x WHERE x.id = m.id) "

int memory_query(Cg *cg, const char *query, const char *task,
                 const char *type, int limit, Memory **out) {
    char *fq = query && query[0] ? fts_query(query) : NULL;
    sqlite3_stmt *st;
    if (fq) {
        st = cg_prep(cg,
            "SELECT m.id,m.created,m.type,m.task,m.body,m.symbols,m.files,"
            "m.source FROM memory_fts f JOIN memories m ON m.id = f.rowid"
            " WHERE memory_fts MATCH ?1 AND (?2 IS NULL OR m.task = ?2)"
            " AND (?3 IS NULL OR m.type = ?3)"
            " ORDER BY" SUPERSEDED_RANK ", bm25(memory_fts),"
            " m.created DESC, m.id DESC LIMIT ?4");
        sqlite3_bind_text(st, 1, fq, -1, SQLITE_TRANSIENT);
    } else {
        st = cg_prep(cg,
            "SELECT m.id,m.created,m.type,m.task,m.body,m.symbols,m.files,"
            "m.source FROM memories m WHERE (?2 IS NULL OR m.task = ?2)"
            " AND (?3 IS NULL OR m.type = ?3)"
            " ORDER BY" SUPERSEDED_RANK ", m.created DESC, m.id DESC LIMIT ?4");
    }
    free(fq);
    bind_opt(st, 2, task);
    bind_opt(st, 3, type);
    sqlite3_bind_int(st, 4, limit > 0 ? limit : 10);

    int n = 0, cap = 8;
    Memory *v = xmalloc(sizeof(Memory) * (size_t)cap);
    while (sqlite3_step(st) == SQLITE_ROW) {
        if (n == cap) { cap *= 2; v = xrealloc(v, sizeof(Memory) * (size_t)cap); }
        mem_row(st, &v[n++]);
    }
    sqlite3_finalize(st);
    *out = v;
    return n;
}

void memory_clear(Memory *m) {
    free(m->type); free(m->task); free(m->body);
    free(m->symbols); free(m->files); free(m->source);
}

void memory_free(Memory *v, int n) {
    for (int i = 0; i < n; i++) memory_clear(&v[i]);
    free(v);
}

void memory_json(const Memory *m, StrBuf *b) {
    sb_printf(b, "{\"id\":%ld,\"created\":%ld,\"type\":", m->id, m->created);
    sb_json_str(b, m->type);
    sb_puts(b, ",\"task\":");
    if (m->task) sb_json_str(b, m->task);
    else sb_puts(b, "null");
    sb_puts(b, ",\"body\":");
    sb_json_str(b, m->body);
    if (m->symbols) { sb_puts(b, ",\"symbols\":"); sb_json_str(b, m->symbols); }
    if (m->files)   { sb_puts(b, ",\"files\":");   sb_json_str(b, m->files); }
    sb_puts(b, ",\"source\":");
    sb_json_str(b, m->source);
    sb_putc(b, '}');
}

/* one-line form for hints under a task: first line of the body, truncated */
void memory_print_brief(const Memory *m, const char *indent) {
    size_t n = strcspn(m->body, "\n");
    bool cut = false;
    if (n > 120) {
        n = 120;
        while (n && (m->body[n] & 0xC0) == 0x80) n--;  /* keep UTF-8 whole */
        cut = true;
    }
    printf("%s#%ld [%s] %.*s%s\n", indent, m->id, m->type, (int)n, m->body,
           cut || m->body[n] ? "..." : "");
}

int cmd_remember(Cg *cg, const char *text, const char *type, const char *task,
                 const char *symbols, const char *files, bool json) {
    if (!text || !text[0]) {
        fprintf(stderr, "cg: empty memory text\n");
        return 1;
    }
    const char *ty = type && type[0] ? type : "fact";
    long id = memory_add(cg, ty, task, text, symbols, files, "manual");
    if (id < 0) {
        fprintf(stderr, "cg: could not save memory\n");
        return 1;
    }
    if (json) {
        StrBuf b; sb_init(&b);
        sb_printf(&b, "{\"id\":%ld,\"type\":", id);
        sb_json_str(&b, ty);
        sb_puts(&b, ",\"task\":");
        if (task && task[0]) sb_json_str(&b, task);
        else sb_puts(&b, "null");
        sb_puts(&b, "}\n");
        fputs(b.p, stdout);
        sb_free(&b);
    } else if (task && task[0]) {
        printf("remembered #%ld [%s] (task %s)\n", id, ty, task);
    } else {
        printf("remembered #%ld [%s]\n", id, ty);
    }
    return 0;
}

int cmd_recall(Cg *cg, const char *query, const char *task, const char *type,
               int limit, bool json) {
    Memory *v = NULL;
    int n = memory_query(cg, query, task, type, limit, &v);
    if (json) {
        StrBuf b; sb_init(&b);
        sb_printf(&b, "{\"count\":%d,\"memories\":[", n);
        for (int i = 0; i < n; i++) {
            if (i) sb_putc(&b, ',');
            memory_json(&v[i], &b);
        }
        sb_puts(&b, "]}\n");
        fputs(b.p, stdout);
        sb_free(&b);
    } else if (n == 0) {
        printf("no memories%s\n", query || task || type ? " match" : " yet");
    } else {
        for (int i = 0; i < n; i++) {
            char when[32] = "?";
            time_t t = (time_t)v[i].created;
            struct tm tmv;
            if (localtime_r(&t, &tmv))
                strftime(when, sizeof when, "%Y-%m-%d", &tmv);
            printf("#%ld  [%s]  %s", v[i].id, v[i].type, when);
            if (v[i].task) printf("  (task %s)", v[i].task);
            if (strcmp(v[i].source, "manual") != 0) printf("  %s", v[i].source);
            printf("\n");
            for (const char *p = v[i].body; *p; ) {
                size_t len = strcspn(p, "\n");
                printf("    %.*s\n", (int)len, p);
                p += len;
                if (*p) p++;
            }
            if (v[i].symbols) printf("    symbols: %s\n", v[i].symbols);
            if (v[i].files)   printf("    files: %s\n", v[i].files);
        }
    }
    memory_free(v, n);
    return 0;
}

int cmd_forget(Cg *cg, const char *idstr) {
    if (idstr && idstr[0] == '#') idstr++;
    long id = idstr ? atol(idstr) : 0;
    if (id <= 0) {
        fprintf(stderr, "usage: cg forget <id>\n");
        return 1;
    }
    sqlite3_stmt *st = cg_prep(cg, "DELETE FROM memories WHERE id=?");
    sqlite3_bind_int64(st, 1, id);
    sqlite3_step(st);
    sqlite3_finalize(st);
    if (sqlite3_changes(cg->db) == 0) {
        fprintf(stderr, "cg: no memory #%ld\n", id);
        return 1;
    }
    st = cg_prep(cg, "DELETE FROM memory_fts WHERE rowid=?");
    sqlite3_bind_int64(st, 1, id);
    sqlite3_step(st);
    sqlite3_finalize(st);
    printf("forgot #%ld\n", id);
    return 0;
}

/* Mark `old_id` as replaced by `new_id`. Nothing is deleted: the reversal
 * itself is history worth keeping, it simply stops leading the results. */
int memory_supersede(Cg *cg, long old_id, long new_id) {
    sqlite3_stmt *ck = cg_prep(cg, "SELECT 1 FROM memories WHERE id=?");
    sqlite3_bind_int64(ck, 1, old_id);
    bool exists = sqlite3_step(ck) == SQLITE_ROW;
    sqlite3_finalize(ck);
    if (!exists) {
        fprintf(stderr, "cg: no memory %ld to supersede\n", old_id);
        return 1;
    }
    sqlite3_stmt *st = cg_prep(cg,
        "INSERT INTO memory_superseded(id,by_id,at) VALUES(?,?,?) "
        "ON CONFLICT(id) DO UPDATE SET by_id=excluded.by_id,at=excluded.at");
    sqlite3_bind_int64(st, 1, old_id);
    sqlite3_bind_int64(st, 2, new_id);
    sqlite3_bind_int64(st, 3, (sqlite3_int64)time(NULL));
    sqlite3_step(st);
    sqlite3_finalize(st);
    return 0;
}

/* Memories anchored to a file, or to a symbol defined in it. Retrieval by
 * proximity complements full text: "what was decided about this file" is a
 * different question from "what mentions this word". */
int cmd_recall_near(Cg *cg, const char *path, int limit, bool json) {
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT DISTINCT m.id,m.created,m.type,m.task,m.body,m.symbols,"
        "m.files,m.source FROM memories m "
        "WHERE ifnull(m.files,'') LIKE '%'||?1||'%' "
        "   OR EXISTS (SELECT 1 FROM symbols s JOIN files f ON f.id=s.file_id "
        "              WHERE f.path=?1 AND ifnull(m.symbols,'') "
        "                    LIKE '%'||s.name||'%') "
        "ORDER BY (SELECT COUNT(*) FROM memory_superseded x WHERE x.id=m.id), "
        "         m.created DESC LIMIT ?2");
    sqlite3_bind_text(st, 1, path, -1, SQLITE_STATIC);
    sqlite3_bind_int(st, 2, limit > 0 ? limit : 10);

    StrBuf b; sb_init(&b);
    if (json) sb_puts(&b, "{\"memories\":[");
    int n = 0;
    while (sqlite3_step(st) == SQLITE_ROW) {
        Memory m;
        mem_row(st, &m);
        if (json) {
            if (n) sb_putc(&b, ',');
            memory_json(&m, &b);
        } else {
            if (!n) sb_printf(&b, "memories near %s:\n", path);
            sb_printf(&b, "  [%s] %s\n", m.type, m.body);
        }
        memory_clear(&m);
        n++;
    }
    sqlite3_finalize(st);
    if (json) sb_puts(&b, "]}\n");
    else if (!n) sb_printf(&b, "no memories anchored near %s\n", path);
    fputs(b.p, stdout);
    sb_free(&b);
    return 0;
}

/* Automatic outcome memories accumulate: every `spec done`, every refusal.
 * Compaction keeps the newest of each identical body and drops exact repeats,
 * so recall stays about signal rather than volume. Deletes run in one
 * BEGIN IMMEDIATE transaction so the lock is taken up front, not mid-way. */
int cmd_memory_compact(Cg *cg, bool dry_run, bool json) {
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT COUNT(*) FROM memories m WHERE EXISTS ("
        "  SELECT 1 FROM memories o WHERE o.body = m.body "
        "  AND ifnull(o.task,'') = ifnull(m.task,'') AND o.type = m.type "
        "  AND o.id > m.id)");
    long dupes = 0;
    if (sqlite3_step(st) == SQLITE_ROW) dupes = sqlite3_column_int64(st, 0);
    sqlite3_finalize(st);

    if (!dry_run && dupes) {
        cg_exec(cg, "BEGIN IMMEDIATE");
        cg_exec(cg,
            "DELETE FROM memory_fts WHERE rowid IN ("
            "  SELECT m.id FROM memories m WHERE EXISTS ("
            "    SELECT 1 FROM memories o WHERE o.body = m.body "
            "    AND ifnull(o.task,'') = ifnull(m.task,'') AND o.type = m.type "
            "    AND o.id > m.id))");
        cg_exec(cg,
            "DELETE FROM memories WHERE id IN ("
            "  SELECT m.id FROM memories m WHERE EXISTS ("
            "    SELECT 1 FROM memories o WHERE o.body = m.body "
            "    AND ifnull(o.task,'') = ifnull(m.task,'') AND o.type = m.type "
            "    AND o.id > m.id))");
        cg_exec(cg, "COMMIT");
    }
    sqlite3_stmt *rem = cg_prep(cg, "SELECT COUNT(*) FROM memories");
    long left = 0;
    if (sqlite3_step(rem) == SQLITE_ROW) left = sqlite3_column_int64(rem, 0);
    sqlite3_finalize(rem);

    if (json)
        printf("{\"duplicates\":%ld,\"removed\":%ld,\"remaining\":%ld}\n",
               dupes, dry_run ? 0 : dupes, left);
    else if (dry_run)
        printf("compact --dry-run: %ld duplicate(s) would be removed, "
               "%ld would remain\n", dupes, left);
    else
        printf("compact: removed %ld duplicate(s), %ld memories remain\n",
               dupes, left);
    return 0;
}
