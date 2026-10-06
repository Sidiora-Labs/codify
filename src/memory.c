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
            "AND ifnull(task,'')=ifnull(?,'') "
            "AND ifnull(branch,'')=ifnull(?4,'') ORDER BY id DESC LIMIT 1");
        sqlite3_bind_text(dup, 1, body, -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(dup, 2, type, -1, SQLITE_TRANSIENT);
        bind_opt(dup, 3, task);
        bind_opt(dup, 4, cg->branch);
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
    /* the branch the decision was actually made on: a worker's notes stay
     * its own until `cg fleet merge-up` promotes them to the base */
    sqlite3_stmt *st = cg_prep(cg,
        "INSERT INTO memories(created,type,task,body,symbols,files,source,"
        "branch) VALUES(?,?,?,?,?,?,?,?)");
    sqlite3_bind_int64(st, 1, (sqlite3_int64)time(NULL));
    sqlite3_bind_text(st, 2, type, -1, SQLITE_TRANSIENT);
    bind_opt(st, 3, task);
    sqlite3_bind_text(st, 4, body, -1, SQLITE_TRANSIENT);
    bind_opt(st, 5, symbols);
    bind_opt(st, 6, files);
    sqlite3_bind_text(st, 7, source, -1, SQLITE_TRANSIENT);
    bind_opt(st, 8, cg->branch);
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

/* Columns 0..7 are the original row; 8 and 9 (class, confidence) and 10
 * (branch) are read only when the statement selected them, so a query
 * written before classification or branches existed still fills a valid
 * Memory. Every SELECT that feeds this must keep that column order. */
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
    m->cls = NULL;
    m->confidence = 0;
    m->branch = NULL;
    int nc = sqlite3_column_count(st);
    if (nc > 9) {
        m->cls = col_dup(st, 8);
        if (sqlite3_column_type(st, 9) != SQLITE_NULL)
            m->confidence = sqlite3_column_double(st, 9);
    }
    if (nc > 10) m->branch = col_dup(st, 10);
}

bool memory_get(Cg *cg, long id, Memory *out) {
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT id,created,type,task,body,symbols,files,source,class,"
        "confidence,branch FROM memories WHERE id=?");
    sqlite3_bind_int64(st, 1, id);
    bool found = sqlite3_step(st) == SQLITE_ROW;
    if (found) mem_row(st, out);
    sqlite3_finalize(st);
    return found;
}

/* The branch a recall answers for, or NULL when it answers for all of them.
 * Empty (no registry yet, graph opened busy) also means all: filtering on a
 * name nothing carries would hide every memory the project has. */
static const char *mem_scope(Cg *cg, char *out, size_t cap) {
    out[0] = 0;
    if (!cg || cg->scope_branch < 0) return NULL;
    if (cg->scope_branch > 0) {
        sqlite3_stmt *st = cg_prep(cg, "SELECT name FROM branches WHERE id=?");
        sqlite3_bind_int64(st, 1, cg->scope_branch);
        if (sqlite3_step(st) == SQLITE_ROW) {
            const char *n = (const char *)sqlite3_column_text(st, 0);
            snprintf(out, cap, "%s", n ? n : "");
        }
        sqlite3_finalize(st);
    } else {
        snprintf(out, cap, "%s", cg->branch);
    }
    return out[0] ? out : NULL;
}

/* A branch sees its own decisions, everything the branches it came from
 * decided (the base chain the registry records), and rows written before
 * memories carried a branch at all. Bind the scope name to ?5; NULL there
 * turns the whole clause off, which is what --all-branches wants. */
#define MEM_BRANCH_CTE \
    "WITH RECURSIVE anc(name) AS (SELECT ?5 UNION " \
    "SELECT b.base FROM branches b JOIN anc a ON b.name=a.name " \
    "WHERE b.base IS NOT NULL) "
#define MEM_BRANCH_WHERE \
    " AND (?5 IS NULL OR m.branch IS NULL " \
    "      OR m.branch IN (SELECT name FROM anc)) "

/* Decisions get reversed. A superseded memory is still true history, so it
 * is never deleted — it just sorts last, so the current decision is what a
 * session meets first. */
#define SUPERSEDED_RANK \
    " (SELECT COUNT(*) FROM memory_superseded x WHERE x.id = m.id) "

int memory_query(Cg *cg, const char *query, const char *task,
                 const char *type, int limit, Memory **out) {
    char *fq = query && query[0] ? fts_query(query) : NULL;
    char scope[256];
    const char *sb = mem_scope(cg, scope, sizeof scope);
    sqlite3_stmt *st;
    if (fq) {
        st = cg_prep(cg, MEM_BRANCH_CTE
            "SELECT m.id,m.created,m.type,m.task,m.body,m.symbols,m.files,"
            "m.source,m.class,m.confidence,m.branch"
            " FROM memory_fts f JOIN memories m ON m.id = f.rowid"
            " WHERE memory_fts MATCH ?1 AND (?2 IS NULL OR m.task = ?2)"
            " AND (?3 IS NULL OR m.type = ?3)" MEM_BRANCH_WHERE
            " ORDER BY" SUPERSEDED_RANK ", bm25(memory_fts),"
            " m.created DESC, m.id DESC LIMIT ?4");
        sqlite3_bind_text(st, 1, fq, -1, SQLITE_TRANSIENT);
    } else {
        st = cg_prep(cg, MEM_BRANCH_CTE
            "SELECT m.id,m.created,m.type,m.task,m.body,m.symbols,m.files,"
            "m.source,m.class,m.confidence,m.branch"
            " FROM memories m WHERE (?2 IS NULL OR m.task = ?2)"
            " AND (?3 IS NULL OR m.type = ?3)" MEM_BRANCH_WHERE
            " ORDER BY" SUPERSEDED_RANK ", m.created DESC, m.id DESC LIMIT ?4");
    }
    free(fq);
    bind_opt(st, 2, task);
    bind_opt(st, 3, type);
    sqlite3_bind_int(st, 4, limit > 0 ? limit : 10);
    bind_opt(st, 5, sb);

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
    free(m->cls); free(m->branch);
    memset(m, 0, sizeof *m);
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
    /* class is always present so a reader can tell "not classified yet"
     * (null) from "classified as noise" without a second query */
    sb_puts(b, ",\"class\":");
    if (m->cls) sb_json_str(b, m->cls);
    else sb_puts(b, "null");
    if (m->cls) sb_printf(b, ",\"confidence\":%.2f", m->confidence);
    sb_puts(b, ",\"branch\":");
    if (m->branch) sb_json_str(b, m->branch);
    else sb_puts(b, "null");
    sb_putc(b, '}');
}

/* one-line form for hints under a task: id, type, Jev's class, and the first
 * line of the body, cut on a character boundary so UTF-8 survives */
void memory_print_brief(const Memory *m, const char *indent) {
    size_t n = strcspn(m->body, "\n");
    bool cut = false;
    if (n > 120) {
        n = 120;
        while (n && (m->body[n] & 0xC0) == 0x80) n--;  /* keep UTF-8 whole */
        cut = true;
    }
    printf("%s#%ld [%s%s%s] %.*s%s\n", indent, m->id, m->type,
           m->cls ? "/" : "", m->cls ? m->cls : "", (int)n, m->body,
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
            if (v[i].cls)
                printf("  class %s %.2f", v[i].cls, v[i].confidence);
            if (v[i].task) printf("  (task %s)", v[i].task);
            /* only when it is somebody else's: a note from the branch you
             * are standing on needs no label */
            if (v[i].branch && strcmp(v[i].branch, cg->branch) != 0)
                printf("  @%s", v[i].branch);
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

/* Memories anchored to a file, or to a symbol defined in it, superseded ones
 * last. Retrieval by proximity complements full text: "what was decided about
 * this file" is a different question from "what mentions this word". */
int cmd_recall_near(Cg *cg, const char *path, int limit, bool json) {
    char scope[256];
    const char *sb = mem_scope(cg, scope, sizeof scope);
    sqlite3_stmt *st = cg_prep(cg, MEM_BRANCH_CTE
        "SELECT DISTINCT m.id,m.created,m.type,m.task,m.body,m.symbols,"
        "m.files,m.source,m.class,m.confidence,m.branch FROM memories m "
        "WHERE (ifnull(m.files,'') LIKE '%'||?1||'%' "
        "   OR EXISTS (SELECT 1 FROM symbols s JOIN files f ON f.id=s.file_id "
        "              WHERE f.path=?1 AND ifnull(m.symbols,'') "
        "                    LIKE '%'||s.name||'%')) " MEM_BRANCH_WHERE
        "ORDER BY (SELECT COUNT(*) FROM memory_superseded x WHERE x.id=m.id), "
        "         m.created DESC LIMIT ?2");
    sqlite3_bind_text(st, 1, path, -1, SQLITE_STATIC);
    sqlite3_bind_int(st, 2, limit > 0 ? limit : 10);
    bind_opt(st, 5, sb);

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

/* ---------------- classification (Jev) ----------------
 *
 * A note is not automatically worth keeping, and the ones worth keeping are
 * not all the same kind of thing. `cg memory classify` asks Jev, per
 * memory, which kind it is and how reusable it is, and writes the verdict
 * on the row. The verdict is advice: nothing reads `class` as a gate, and a
 * memory classed `noise` is still recalled. What it buys is a shortlist —
 * the memories classed `skill` are the ones `cg skills promote` turns into
 * a portable SKILL.md.
 */

/* The vocabulary. The request body sorts option keys, so this order is only
 * the order a reader of the code sees them in. */
static const char *const CLASS_KEYS[] = {
    "skill", "decision", "constraint", "fact", "noise"
};
static const char *const CLASS_DESCS[] = {
    "A reusable technique, recipe, or way of working — it would help on "
    "other tasks, not only the one it came from.",
    "A choice that was made, closing off the alternatives.",
    "A rule that binds future work: something that must, or must not, be "
    "done here.",
    "A durable piece of knowledge about this project.",
    "Noise: a restatement of the obvious, a status line, or a note that has "
    "already expired.",
};
#define NCLASSES ((int)(sizeof CLASS_KEYS / sizeof CLASS_KEYS[0]))
#define CLASSIFY_DEFAULT_LIMIT 50

static void state_field(StrBuf *b, const char *key, const char *val) {
    sb_printf(b, ",\"%s\":", key);
    if (val && val[0]) sb_json_str(b, val);
    else sb_puts(b, "null");
}

/* Everything Jev is allowed to judge the memory on — the note itself and
 * where it was taken, never the rest of the database. */
static char *classify_state(const Memory *m) {
    StrBuf b; sb_init(&b);
    sb_printf(&b, "{\"id\":%ld", m->id);
    state_field(&b, "type", m->type);
    state_field(&b, "task", m->task);
    state_field(&b, "symbols", m->symbols);
    state_field(&b, "files", m->files);
    state_field(&b, "source", m->source);
    state_field(&b, "body", m->body);
    sb_putc(&b, '}');
    return b.p;
}

/* One decision per memory: which class, and whether it is reusable beyond
 * its own task. Fills m->cls / m->confidence; *reusable gets the noul (-1
 * when Jev did not answer it). -1 with the reason already on stderr. */
static int classify_one(Cg *cg, Memory *m, double *reusable) {
    JevQuestion qs[2];
    jev_question_choice(&qs[0], "class",
        "A coding agent wrote this note while working in a repository. "
        "Which one kind of note is it?", CLASS_KEYS, CLASS_DESCS, NCLASSES);
    jev_question_noul(&qs[1], "reusable",
        "This note would still be useful on a different task in a different "
        "part of the repository.",
        "it generalises beyond the task it came from",
        "it only makes sense for that one task, file, or moment");
    char *state = classify_state(m);
    JevResult r;
    int rc = jev_ask(cg, state, qs, 2, &r);
    free(state);
    jev_question_free(&qs[0]);
    jev_question_free(&qs[1]);
    if (rc != JEV_OK) {
        char what[96];
        snprintf(what, sizeof what, "classifying memory #%ld", m->id);
        jev_report_error(&r, what);
        jev_result_free(&r);
        return -1;
    }
    const JevAnswer *cls = jev_answer(&r, "class");
    const JevAnswer *reuse = jev_answer(&r, "reusable");
    if (!cls || !cls->choice || !cls->choice[0]) {
        fprintf(stderr, "cg: jev gave no class for memory #%ld\n", m->id);
        jev_result_free(&r);
        return -1;
    }
    free(m->cls);
    m->cls = xstrdup(cls->choice);
    m->confidence = cls->confidence;
    *reusable = reuse ? reuse->value : -1;
    jev_result_free(&r);
    return 0;
}

static void classify_store(Cg *cg, const Memory *m) {
    sqlite3_stmt *st = cg_prep(cg,
        "UPDATE memories SET class=?,confidence=? WHERE id=?");
    sqlite3_bind_text(st, 1, m->cls, -1, SQLITE_TRANSIENT);
    sqlite3_bind_double(st, 2, m->confidence);
    sqlite3_bind_int64(st, 3, m->id);
    sqlite3_step(st);
    sqlite3_finalize(st);
}

/* Rows for a classify selector: a memory id, --all, or anything else (the
 * unclassified ones). *out is malloc'd and each Memory is the caller's to
 * clear. -1 when the selector is unusable — the reason is on stderr. */
static int classify_select(Cg *cg, const char *sel, int limit, Memory **out) {
    *out = NULL;
    long id = 0;
    bool all = sel && strcmp(sel, "--all") == 0;
    if (sel && sel[0] && !all && strcmp(sel, "--unclassified") != 0) {
        const char *p = sel[0] == '#' ? sel + 1 : sel;
        id = atol(p);
        if (id <= 0) {
            fprintf(stderr, "usage: cg memory classify "
                    "[<id>|--all|--unclassified] [-n N]\n");
            return -1;
        }
    }
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT id,created,type,task,body,symbols,files,source,class,"
        "confidence,branch FROM memories"
        " WHERE (?1 = 0 OR id = ?1) AND (?1 > 0 OR ?2 = 1 OR class IS NULL)"
        " ORDER BY id LIMIT ?3");
    sqlite3_bind_int64(st, 1, id);
    sqlite3_bind_int(st, 2, all ? 1 : 0);
    sqlite3_bind_int(st, 3, limit);
    int n = 0, cap = 8;
    Memory *v = xmalloc(sizeof(Memory) * (size_t)cap);
    while (sqlite3_step(st) == SQLITE_ROW) {
        if (n == cap) { cap *= 2; v = xrealloc(v, sizeof(Memory) * (size_t)cap); }
        mem_row(st, &v[n++]);
    }
    sqlite3_finalize(st);
    if (id > 0 && n == 0) {
        fprintf(stderr, "cg: no memory #%ld\n", id);
        free(v);
        return -1;
    }
    *out = v;
    return n;
}

int cmd_memory_classify(Cg *cg, const char *sel, int limit, bool json) {
    if (limit <= 0) limit = CLASSIFY_DEFAULT_LIMIT;
    Memory *v = NULL;
    int n = classify_select(cg, sel, limit, &v);
    if (n < 0) return 1;
    bool all = sel && strcmp(sel, "--all") == 0;
    if (n == 0) {
        if (json)
            printf("{\"ok\":true,\"classified\":0,\"memories\":[],"
                   "\"candidates\":[]}\n");
        else
            printf("no memories to classify%s\n",
                   all ? "" : " — every memory already has a class "
                              "(--all reclassifies)");
        free(v);
        return 0;
    }
    StrBuf rows; sb_init(&rows);
    StrBuf cand; sb_init(&cand);
    int done = 0, ncand = 0, rc = 0;
    for (int i = 0; i < n; i++) {
        double reusable = -1;
        if (classify_one(cg, &v[i], &reusable) != 0) { rc = 1; break; }
        classify_store(cg, &v[i]);
        /* a skill Jev itself calls task-bound is not a candidate: the whole
         * point of a skill is that it travels */
        bool candidate = strcmp(v[i].cls, "skill") == 0 &&
                         (reusable < 0 || reusable >= 0.5);
        if (candidate) {
            sb_printf(&cand, "%s%ld", ncand ? "," : "", v[i].id);
            ncand++;
        }
        if (json) {
            if (done) sb_putc(&rows, ',');
            memory_json(&v[i], &rows);
            rows.len--;                 /* reopen to add this ask's answers */
            rows.p[rows.len] = 0;
            if (reusable >= 0) sb_printf(&rows, ",\"reusable\":%.2f", reusable);
            sb_printf(&rows, ",\"candidate\":%s}", candidate ? "true" : "false");
        } else {
            size_t blen = strcspn(v[i].body, "\n");
            bool cut = blen > 56;
            if (cut) {
                blen = 56;
                while (blen && (v[i].body[blen] & 0xC0) == 0x80) blen--;
            }
            sb_printf(&rows, "  #%-4ld %-12s %-10s %.2f", v[i].id, v[i].type,
                      v[i].cls, v[i].confidence);
            if (reusable >= 0) sb_printf(&rows, "  reusable %.2f", reusable);
            sb_printf(&rows, "  %.*s%s\n", (int)blen, v[i].body,
                      cut ? "..." : "");
        }
        done++;
    }
    if (json) {
        printf("{\"ok\":%s,\"classified\":%d,\"memories\":[%s],"
               "\"candidates\":[%s]}\n", rc ? "false" : "true", done,
               rows.p, cand.p);
    } else if (done || !rc) {      /* a failure already said why on stderr */
        printf("classified %d memor%s:\n", done, done == 1 ? "y" : "ies");
        fputs(rows.p, stdout);
        if (ncand)
            printf("skill candidates: %s — promote with "
                   "`cg skills promote <id>`\n", cand.p);
        else
            printf("skill candidates: none\n");
    }
    sb_free(&rows);
    sb_free(&cand);
    memory_free(v, n);
    return rc;
}

/* Hand a merged branch's decisions to the branch that absorbed its code.
 * `cg fleet merge-up` calls this the moment the merge lands: the worker's
 * branch is about to disappear, and what it learned has to outlive it —
 * otherwise the next agent on the base repeats the reasoning. Rows the base
 * already holds word for word are dropped instead of duplicated. Returns the
 * number moved, 0 when from and to are the same branch, -1 when either name
 * is empty. */
int memory_promote_branch(Cg *cg, const char *from, const char *to) {
    if (!from || !from[0] || !to || !to[0]) return -1;
    if (strcmp(from, to) == 0) return 0;
    sqlite3_stmt *st = cg_prep(cg,
        "DELETE FROM memory_fts WHERE rowid IN ("
        "  SELECT m.id FROM memories m WHERE m.branch=?1 AND EXISTS("
        "    SELECT 1 FROM memories o WHERE o.branch=?2 AND o.body=m.body "
        "    AND o.type=m.type AND ifnull(o.task,'')=ifnull(m.task,'')))");
    sqlite3_bind_text(st, 1, from, -1, SQLITE_STATIC);
    sqlite3_bind_text(st, 2, to, -1, SQLITE_STATIC);
    sqlite3_step(st);
    sqlite3_finalize(st);
    st = cg_prep(cg,
        "DELETE FROM memories WHERE branch=?1 AND EXISTS("
        "  SELECT 1 FROM memories o WHERE o.branch=?2 AND o.body=memories.body "
        "  AND o.type=memories.type "
        "  AND ifnull(o.task,'')=ifnull(memories.task,''))");
    sqlite3_bind_text(st, 1, from, -1, SQLITE_STATIC);
    sqlite3_bind_text(st, 2, to, -1, SQLITE_STATIC);
    sqlite3_step(st);
    sqlite3_finalize(st);

    st = cg_prep(cg, "UPDATE memories SET branch=?2 WHERE branch=?1");
    sqlite3_bind_text(st, 1, from, -1, SQLITE_STATIC);
    sqlite3_bind_text(st, 2, to, -1, SQLITE_STATIC);
    sqlite3_step(st);
    sqlite3_finalize(st);
    return sqlite3_changes(cg->db);
}

/* ---------------- transport: export / import ----------------
 *
 * Memories travel between graphs as JSONL (docs/memory-transport.md): one
 * header line, then one object per memory. Identity across graphs is the
 * content id, never the row id, so the same note is recognised wherever it
 * lands and a second import of the same file changes nothing. Supersession
 * travels as the content id of the superseding memory.
 */
#define PORT_FORMAT  "codify-memories"
#define PORT_VERSION 1

/* The same triple compact calls a duplicate (type, task with NULL as empty,
 * body), joined by 0x1F so no two triples hash the same input. Part of the
 * export format: changing it changes every id in every file ever written. */
void memory_content_id(const char *type, const char *task, const char *body,
                       char out[65]) {
    StrBuf b; sb_init(&b);
    sb_puts(&b, type ? type : "");
    sb_putc(&b, '\x1f');
    sb_puts(&b, task ? task : "");
    sb_putc(&b, '\x1f');
    sb_puts(&b, body ? body : "");
    sha256_hex(b.p, b.len, out);
    sb_free(&b);
}

static bool db_has(sqlite3 *db, const char *sql, const char *a,
                   const char *b) {
    sqlite3_stmt *st = NULL;
    if (sqlite3_prepare_v2(db, sql, -1, &st, NULL) != SQLITE_OK) return false;
    sqlite3_bind_text(st, 1, a, -1, SQLITE_STATIC);
    if (b) sqlite3_bind_text(st, 2, b, -1, SQLITE_STATIC);
    bool found = sqlite3_step(st) == SQLITE_ROW;
    sqlite3_finalize(st);
    return found;
}

static bool db_has_column(sqlite3 *db, const char *table, const char *col) {
    return db_has(db, "SELECT 1 FROM pragma_table_info(?1) WHERE name=?2",
                  table, col);
}

static bool db_has_table(sqlite3 *db, const char *table) {
    return db_has(db, "SELECT 1 FROM sqlite_master WHERE type='table' "
                      "AND name=?1", table, NULL);
}

static void port_str(StrBuf *b, const char *key, const char *v) {
    sb_printf(b, ",\"%s\":", key);
    if (v) sb_json_str(b, v);
    else sb_puts(b, "null");
}

/* The export of one graph as JSONL. Works on a bare handle because --from
 * reads another project's graph, which may predate class, confidence, and
 * branch: a missing column exports as null. -1 with the reason in err. */
static int port_export(sqlite3 *db, const char *project,
                       const MemExportOpts *o, StrBuf *out, int *count,
                       char *err, size_t errcap) {
    bool has_cls = db_has_column(db, "memories", "class");
    bool has_conf = db_has_column(db, "memories", "confidence");
    bool has_br = db_has_column(db, "memories", "branch");
    bool has_sup = db_has_table(db, "memory_superseded");
    StrBuf q; sb_init(&q);
    sb_printf(&q,
        "SELECT m.id,m.created,m.type,m.task,m.body,m.symbols,m.files,"
        "m.source,%s,%s,%s,%s FROM memories m %s"
        " WHERE (?1 IS NULL OR m.task=?1 OR substr(m.task,1,length(?1)+1)"
        "=?1||'/') AND (?2 IS NULL OR m.type=?2)"
        " AND (?3 IS NULL OR %s=?3) AND (?4=0 OR m.created>=?4)"
        " ORDER BY m.created, m.id",
        has_cls ? "m.class" : "NULL", has_conf ? "m.confidence" : "NULL",
        has_br ? "m.branch" : "NULL",
        has_sup ? "b.type,b.task,b.body,s.at" : "NULL,NULL,NULL,NULL",
        has_sup ? "LEFT JOIN memory_superseded s ON s.id=m.id "
                  "LEFT JOIN memories b ON b.id=s.by_id" : "",
        has_br ? "m.branch" : "NULL");
    sqlite3_stmt *st = NULL;
    int rc = sqlite3_prepare_v2(db, q.p, -1, &st, NULL);
    sb_free(&q);
    if (rc != SQLITE_OK) {
        snprintf(err, errcap, "cannot read memories: %s", sqlite3_errmsg(db));
        return -1;
    }
    bind_opt(st, 1, o->task);
    bind_opt(st, 2, o->type);
    bind_opt(st, 3, o->branch);
    sqlite3_bind_int64(st, 4, o->since_days > 0
        ? (sqlite3_int64)time(NULL) - (sqlite3_int64)o->since_days * 86400 : 0);
    StrBuf rows; sb_init(&rows);
    int n = 0;
    while ((rc = sqlite3_step(st)) == SQLITE_ROW) {
        Memory m;
        mem_row(st, &m);
        char cid[65];
        memory_content_id(m.type, m.task, m.body, cid);
        sb_puts(&rows, "{\"id\":");
        sb_json_str(&rows, cid);
        sb_printf(&rows, ",\"created\":%ld", m.created);
        port_str(&rows, "type", m.type);
        port_str(&rows, "task", m.task);
        port_str(&rows, "body", m.body);
        port_str(&rows, "symbols", m.symbols);
        port_str(&rows, "files", m.files);
        port_str(&rows, "source", m.source);
        port_str(&rows, "branch", m.branch);
        port_str(&rows, "class", m.cls);
        if (sqlite3_column_type(st, 9) != SQLITE_NULL)
            sb_printf(&rows, ",\"confidence\":%.15g",
                      sqlite3_column_double(st, 9));
        else
            sb_puts(&rows, ",\"confidence\":null");
        /* a link whose superseding row was forgotten exports as none */
        if (sqlite3_column_type(st, 13) != SQLITE_NULL) {
            char sup[65];
            memory_content_id((const char *)sqlite3_column_text(st, 11),
                              (const char *)sqlite3_column_text(st, 12),
                              (const char *)sqlite3_column_text(st, 13), sup);
            port_str(&rows, "superseded_by", sup);
            sb_printf(&rows, ",\"superseded_at\":%lld",
                      (long long)sqlite3_column_int64(st, 14));
        } else {
            sb_puts(&rows, ",\"superseded_by\":null,\"superseded_at\":null");
        }
        sb_puts(&rows, "}\n");
        memory_clear(&m);
        n++;
    }
    sqlite3_finalize(st);
    if (rc != SQLITE_DONE) {
        snprintf(err, errcap, "cannot read memories: %s", sqlite3_errmsg(db));
        sb_free(&rows);
        return -1;
    }
    /* no timestamp: two exports of the same graph are byte-identical */
    sb_printf(out, "{\"format\":\"%s\",\"version\":%d", PORT_FORMAT,
              PORT_VERSION);
    port_str(out, "project", project);
    port_str(out, "cg_version", CG_VERSION);
    sb_printf(out, ",\"count\":%d}\n", n);
    sb_puts(out, rows.p);
    sb_free(&rows);
    *count = n;
    return 0;
}

static const char *base_name(const char *path) {
    const char *s = strrchr(path, '/');
    return s && s[1] ? s + 1 : path;
}

int cmd_memory_export(Cg *cg, const MemExportOpts *o, bool json) {
    if (o->since_days < 0) {
        fprintf(stderr, "cg: memory export: --since takes a number of days\n");
        return 1;
    }
    StrBuf out; sb_init(&out);
    int n = 0;
    char err[512];
    if (port_export(cg->db, base_name(cg->shared), o, &out, &n, err,
                    sizeof err) != 0) {
        fprintf(stderr, "cg: memory export: %s\n", err);
        sb_free(&out);
        return 1;
    }
    int rc = 0;
    if (!o->outfile || strcmp(o->outfile, "-") == 0) {
        fputs(out.p, stdout);
    } else if (write_entire_file(o->outfile, out.p, out.len) != 0) {
        fprintf(stderr, "cg: memory export: cannot write %s\n", o->outfile);
        rc = 1;
    } else if (json) {
        StrBuf b; sb_init(&b);
        sb_printf(&b, "{\"ok\":true,\"exported\":%d,\"file\":", n);
        sb_json_str(&b, o->outfile);
        sb_puts(&b, "}\n");
        fputs(b.p, stdout);
        sb_free(&b);
    } else {
        printf("exported %d memor%s to %s\n", n, n == 1 ? "y" : "ies",
               o->outfile);
    }
    sb_free(&out);
    return rc;
}

/* Strict JSON shape check. The reader in json.c is forgiving by design, so
 * a line cut off mid-string would read as a shorter body; an import must
 * refuse that line, not store half of it. */
static const char *jv_value(const char *p, int depth);

static const char *jv_ws(const char *p) {
    while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
    return p;
}

static const char *jv_string(const char *p) {
    if (*p++ != '"') return NULL;
    while (*p != '"') {
        if ((unsigned char)*p < 0x20) return NULL;      /* NUL included */
        if (*p == '\\') {
            p++;
            if (*p == 'u') {
                for (int i = 1; i <= 4; i++)
                    if (!isxdigit((unsigned char)p[i])) return NULL;
                p += 4;
            } else if (!*p || !strchr("\"\\/bfnrt", *p)) {
                return NULL;
            }
        }
        p++;
    }
    return p + 1;
}

static const char *jv_digits(const char *p) {
    if (!isdigit((unsigned char)*p)) return NULL;
    while (isdigit((unsigned char)*p)) p++;
    return p;
}

static const char *jv_number(const char *p) {
    if (*p == '-') p++;
    if (!(p = jv_digits(p))) return NULL;
    if (*p == '.' && !(p = jv_digits(p + 1))) return NULL;
    if (*p == 'e' || *p == 'E') {
        p++;
        if (*p == '+' || *p == '-') p++;
        if (!(p = jv_digits(p))) return NULL;
    }
    return p;
}

static const char *jv_value(const char *p, int depth) {
    if (depth > 32) return NULL;
    p = jv_ws(p);
    if (*p == '"') return jv_string(p);
    if (*p == '{' || *p == '[') {
        char close = *p == '{' ? '}' : ']';
        p = jv_ws(p + 1);
        if (*p == close) return p + 1;
        for (;;) {
            if (close == '}') {
                if (!(p = jv_string(p))) return NULL;
                p = jv_ws(p);
                if (*p++ != ':') return NULL;
            }
            if (!(p = jv_value(p, depth + 1))) return NULL;
            p = jv_ws(p);
            if (*p == close) return p + 1;
            if (*p++ != ',') return NULL;
            p = jv_ws(p);
        }
    }
    static const char *const LIT[] = { "true", "false", "null" };
    for (int i = 0; i < 3; i++)
        if (strncmp(p, LIT[i], strlen(LIT[i])) == 0) return p + strlen(LIT[i]);
    return jv_number(p);
}

static bool json_object_ok(const char *s) {
    s = jv_ws(s);
    if (*s != '{') return false;
    const char *e = jv_value(s, 0);
    return e && !*jv_ws(e);
}

/* absent or null reads as NULL; a value that is not a string sets *bad */
static char *port_get_str(const char *obj, const char *key, bool *bad) {
    char *raw = json_get_raw(obj, key);
    if (!raw || strcmp(raw, "null") == 0) { free(raw); return NULL; }
    char *v = json_string_value(raw);
    free(raw);
    if (!v) *bad = true;
    return v;
}

typedef struct {
    int line;
    char *type, *task, *body, *symbols, *files, *source, *branch, *cls;
    double confidence;
    bool has_conf;
    long created;
    char *link;           /* what the file calls it: its id, or computed */
    char *sup;            /* link key of the memory that superseded it */
    long sup_at;
    char cid[65];         /* content id as the target will hold it */
    long row;             /* target row; 0 while a dry run leaves it unborn */
    int dup_of;           /* earlier record with the same cid, or -1 */
    bool fresh;           /* to be inserted (not already in the target) */
} PortRec;

static void port_rec_free(PortRec *r) {
    free(r->type); free(r->task); free(r->body); free(r->symbols);
    free(r->files); free(r->source); free(r->branch); free(r->cls);
    free(r->link); free(r->sup);
}

/* `cg remember --type` stores any word it is given, so a graph may hold
 * types beyond the documented five; what travels is any short lowercase
 * word, and anything else is refused as unknown */
static bool port_type_ok(const char *t) {
    size_t n = strlen(t);
    if (n == 0 || n > 32) return false;
    for (const char *p = t; *p; p++)
        if (!islower((unsigned char)*p) && !isdigit((unsigned char)*p) &&
            *p != '_' && *p != '-') return false;
    return true;
}

/* NULL when the line is a memory; otherwise why it is not */
static const char *port_parse_line(const char *s, PortRec *r) {
    if (!json_object_ok(s)) return "bad JSON";
    bool bad = false;
    r->body = port_get_str(s, "body", &bad);
    if (bad) return "body is not a string";
    if (!r->body || !r->body[0]) return "missing body";
    r->type = port_get_str(s, "type", &bad);
    if (bad || !r->type || !r->type[0]) return "missing type";
    if (!port_type_ok(r->type)) return "unknown type";
    r->task = port_get_str(s, "task", &bad);
    r->symbols = port_get_str(s, "symbols", &bad);
    r->files = port_get_str(s, "files", &bad);
    r->source = port_get_str(s, "source", &bad);
    r->branch = port_get_str(s, "branch", &bad);
    r->cls = port_get_str(s, "class", &bad);
    r->link = port_get_str(s, "id", &bad);
    r->sup = port_get_str(s, "superseded_by", &bad);
    if (bad) return "a text field is not a string";
    if (r->task && strchr(r->task, '\x1f')) return "task holds a 0x1F byte";
    char *raw = json_get_raw(s, "created");
    r->created = raw && strcmp(raw, "null") != 0 ? atol(raw) : 0;
    free(raw);
    if (r->created <= 0) r->created = (long)time(NULL);
    raw = json_get_raw(s, "confidence");
    if (raw && strcmp(raw, "null") != 0) {
        char *end = NULL;
        r->confidence = strtod(raw, &end);
        if (end == raw) { free(raw); return "confidence is not a number"; }
        r->has_conf = true;
    }
    free(raw);
    r->sup_at = json_get_int(s, "superseded_at", 0);
    if (!r->link || !r->link[0]) {
        free(r->link);
        r->link = xmalloc(65);
        memory_content_id(r->type, r->task, r->body, r->link);
    }
    return NULL;
}

typedef struct {
    char *project;
    PortRec *v;
    int n;
    int invalid;
    StrBuf ej, et;        /* per-line errors: JSON items, text lines */
} PortIn;

static void port_bad_line(PortIn *in, int line, const char *why) {
    if (in->ej.len) sb_putc(&in->ej, ',');
    sb_printf(&in->ej, "{\"line\":%d,\"reason\":", line);
    sb_json_str(&in->ej, why);
    sb_putc(&in->ej, '}');
    sb_printf(&in->et, "  line %d: %s\n", line, why);
    in->invalid++;
}

/* Header first: an unknown format or a newer version stops here, before
 * the target is touched. Per-line problems are counted and skipped. Lines
 * are numbered from 1 in the input as given, header included. */
static int port_parse(char *text, PortIn *in, char *err, size_t errcap) {
    int line = 0, cap = 0;
    bool header = false;
    for (char *p = text; p && *p; ) {
        char *nl = strchr(p, '\n');
        if (nl) *nl = 0;
        line++;
        size_t len = strlen(p);
        if (len && p[len - 1] == '\r') p[--len] = 0;
        char *s = p;
        p = nl ? nl + 1 : NULL;
        if (!*jv_ws(s)) continue;
        if (!header) {
            header = true;
            char *fmt = json_object_ok(s) ? json_get_string(s, "format") : NULL;
            if (!fmt || strcmp(fmt, PORT_FORMAT) != 0) {
                snprintf(err, errcap, "line %d is not a %s header (format "
                         "%s) — nothing imported", line, PORT_FORMAT,
                         fmt ? fmt : "missing");
                free(fmt);
                return -1;
            }
            free(fmt);
            long ver = json_get_int(s, "version", 0);
            if (ver < 1) {
                snprintf(err, errcap, "header has no usable version — "
                         "nothing imported");
                return -1;
            }
            if (ver > PORT_VERSION) {
                snprintf(err, errcap, "format version %ld is newer than this "
                         "cg (%s) reads (up to %d) — nothing imported",
                         ver, CG_VERSION, PORT_VERSION);
                return -1;
            }
            in->project = json_get_string(s, "project");
            continue;
        }
        PortRec r;
        memset(&r, 0, sizeof r);
        r.line = line;
        r.dup_of = -1;
        const char *why = port_parse_line(s, &r);
        if (why) {
            port_bad_line(in, line, why);
            port_rec_free(&r);
            continue;
        }
        if (in->n == cap) {
            cap = cap ? cap * 2 : 16;
            in->v = xrealloc(in->v, sizeof(PortRec) * (size_t)cap);
        }
        in->v[in->n++] = r;
    }
    if (!header) {
        snprintf(err, errcap, "empty input — no %s header", PORT_FORMAT);
        return -1;
    }
    if (!in->project || !in->project[0]) {
        free(in->project);
        in->project = xstrdup("unknown");
    }
    return 0;
}

typedef struct { char cid[65]; long row; } CidRow;

static int cid_cmp(const void *a, const void *b) {
    const CidRow *x = a, *y = b;
    int c = strcmp(x->cid, y->cid);
    return c ? c : (x->row > y->row) - (x->row < y->row);
}

/* the lowest row holding cid (the oldest, as compact would keep), or 0 */
static long cid_row(const CidRow *v, int n, const char *cid) {
    int lo = 0, hi = n;
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        if (strcmp(v[mid].cid, cid) < 0) lo = mid + 1;
        else hi = mid;
    }
    return lo < n && strcmp(v[lo].cid, cid) == 0 ? v[lo].row : 0;
}

/* Every memory the target holds, by content id. Computed per import rather
 * than stored, so no new column has to be kept in step with every writer. */
static int target_cids(Cg *cg, CidRow **out) {
    sqlite3_stmt *st = cg_prep(cg, "SELECT id,type,task,body FROM memories");
    int n = 0, cap = 64;
    CidRow *v = xmalloc(sizeof *v * (size_t)cap);
    while (sqlite3_step(st) == SQLITE_ROW) {
        if (n == cap) { cap *= 2; v = xrealloc(v, sizeof *v * (size_t)cap); }
        v[n].row = (long)sqlite3_column_int64(st, 0);
        memory_content_id((const char *)sqlite3_column_text(st, 1),
                          (const char *)sqlite3_column_text(st, 2),
                          (const char *)sqlite3_column_text(st, 3), v[n].cid);
        n++;
    }
    sqlite3_finalize(st);
    qsort(v, (size_t)n, sizeof *v, cid_cmp);
    *out = v;
    return n;
}

/* Read another project's graph without touching it: a read-only handle and
 * SELECTs only — no schema upgrade, no triggers, no journal-mode change. */
static int port_from_dir(Cg *cg, const char *dir, StrBuf *out,
                         char *err, size_t errcap) {
    char abs[4096], root[4096], shared[4096];
    if (!realpath(dir, abs) ||
        cg_find_project_at(abs, root, shared, sizeof root) != 0) {
        snprintf(err, errcap, "%s is not inside a Codify project", dir);
        return -1;
    }
    char a[4096], b[4096];
    if (realpath(shared, a) && realpath(cg->shared, b) && strcmp(a, b) == 0) {
        snprintf(err, errcap, "%s is this project's own graph — a graph "
                 "cannot import itself", dir);
        return -1;
    }
    char dbpath[4600];
    snprintf(dbpath, sizeof dbpath, "%s/%s", shared, CG_DB);
    sqlite3 *db = NULL;
    if (sqlite3_open_v2(dbpath, &db, SQLITE_OPEN_READONLY, NULL) != SQLITE_OK) {
        snprintf(err, errcap, "cannot open %.900s read-only: %s", dbpath,
                 db ? sqlite3_errmsg(db) : "out of memory");
        sqlite3_close(db);
        return -1;
    }
    sqlite3_busy_timeout(db, (int)cg_lock_wait_default());
    int rc = -1;
    if (!db_has_table(db, "memories")) {
        snprintf(err, errcap, "%.900s holds no memories table", dbpath);
    } else {
        MemExportOpts all = {0};
        int n = 0;
        rc = port_export(db, base_name(shared), &all, out, &n, err, errcap);
    }
    sqlite3_close(db);
    return rc;
}

static bool port_step(Cg *cg, sqlite3_stmt *st, char *err, size_t errcap) {
    int rc = sqlite3_step(st);
    sqlite3_finalize(st);
    if (rc == SQLITE_DONE || rc == SQLITE_ROW) return true;
    snprintf(err, errcap, "%s", sqlite3_errmsg(cg->db));
    return false;
}

static bool port_insert(Cg *cg, PortRec *r, char *err, size_t errcap) {
    sqlite3_stmt *st = cg_prep(cg,
        "INSERT INTO memories(created,type,task,body,symbols,files,source,"
        "branch,class,confidence) VALUES(?,?,?,?,?,?,?,?,?,?)");
    sqlite3_bind_int64(st, 1, r->created);
    sqlite3_bind_text(st, 2, r->type, -1, SQLITE_STATIC);
    bind_opt(st, 3, r->task);
    sqlite3_bind_text(st, 4, r->body, -1, SQLITE_STATIC);
    bind_opt(st, 5, r->symbols);
    bind_opt(st, 6, r->files);
    sqlite3_bind_text(st, 7, r->source, -1, SQLITE_STATIC);
    bind_opt(st, 8, r->branch);
    bind_opt(st, 9, r->cls);
    if (r->cls && r->has_conf) sqlite3_bind_double(st, 10, r->confidence);
    else sqlite3_bind_null(st, 10);
    if (!port_step(cg, st, err, errcap)) return false;
    r->row = (long)sqlite3_last_insert_rowid(cg->db);
    st = cg_prep(cg,
        "INSERT INTO memory_fts(rowid,body,task,symbols) VALUES(?,?,?,?)");
    sqlite3_bind_int64(st, 1, r->row);
    sqlite3_bind_text(st, 2, r->body, -1, SQLITE_STATIC);
    bind_opt(st, 3, r->task);
    bind_opt(st, 4, r->symbols);
    return port_step(cg, st, err, errcap);
}

/* Restore "superseded by" wherever both ends are in the target now — rows
 * already there or arriving in this import, in any line order. A link the
 * target already has is its own decision and stays. A dry run counts the
 * links it would make. Returns that count, -1 on a write error. */
static int port_relink(Cg *cg, PortIn *in, const CidRow *tv, int tn,
                       bool dry, char *err, size_t errcap) {
    CidRow *lk = xmalloc(sizeof *lk * (size_t)(in->n ? in->n : 1));
    for (int i = 0; i < in->n; i++) {
        snprintf(lk[i].cid, sizeof lk[i].cid, "%s", in->v[i].link);
        lk[i].row = i + 1;                   /* 0 stays "not in the file" */
    }
    qsort(lk, (size_t)in->n, sizeof *lk, cid_cmp);
    int made = 0;
    for (int i = 0; i < in->n; i++) {
        PortRec *r = &in->v[i];
        if (!r->sup || !r->sup[0] || r->dup_of >= 0) continue;
        long by = 0;
        bool known;
        int at = (int)cid_row(lk, in->n, r->sup);
        if (at > 0) {
            const PortRec *s = &in->v[at - 1];
            if (s->dup_of >= 0) s = &in->v[s->dup_of];
            if (s == r) continue;
            by = s->row;
            known = s->row > 0 || s->fresh;
        } else {
            by = cid_row(tv, tn, r->sup);
            known = by > 0;
        }
        if (!known || (by > 0 && by == r->row)) continue;
        if (dry) {
            bool linked = false;
            if (!r->fresh) {
                sqlite3_stmt *ck = cg_prep(cg,
                    "SELECT 1 FROM memory_superseded WHERE id=?");
                sqlite3_bind_int64(ck, 1, r->row);
                linked = sqlite3_step(ck) == SQLITE_ROW;
                sqlite3_finalize(ck);
            }
            if (!linked) made++;
            continue;
        }
        sqlite3_stmt *st = cg_prep(cg,
            "INSERT OR IGNORE INTO memory_superseded(id,by_id,at) "
            "VALUES(?,?,?)");
        sqlite3_bind_int64(st, 1, r->row);
        sqlite3_bind_int64(st, 2, by);
        sqlite3_bind_int64(st, 3, r->sup_at > 0 ? (sqlite3_int64)r->sup_at
                                                : (sqlite3_int64)time(NULL));
        if (!port_step(cg, st, err, errcap)) { free(lk); return -1; }
        made += sqlite3_changes(cg->db);
    }
    free(lk);
    return made;
}

/* What the import does to each record before it lands: --retask, the
 * branch rule, provenance, and the content id the target will know it by.
 * Sets fresh/row/dup_of against the target and the records before it. */
static void port_plan(Cg *cg, PortIn *in, const MemImportOpts *o,
                      const CidRow *tv, int tn, int *cleared) {
    const char *eq = o->retask ? strchr(o->retask, '=') : NULL;
    size_t olen = eq ? (size_t)(eq - o->retask) : 0;
    for (int i = 0; i < in->n; i++) {
        PortRec *r = &in->v[i];
        /* a tag prefix, matched on a boundary: codify-v12 rewrites
         * codify-v12/1.1 but never codify-v120/1.1 */
        if (eq && r->task && strncmp(r->task, o->retask, olen) == 0 &&
            (r->task[olen] == 0 || r->task[olen] == '/' ||
             o->retask[olen - 1] == '/')) {
            StrBuf t; sb_init(&t);
            sb_puts(&t, eq + 1);
            sb_puts(&t, r->task + olen);
            free(r->task);
            r->task = t.len ? t.p : NULL;
            if (!t.len) sb_free(&t);
        }
        if (r->branch && !o->keep_branch &&
            !db_has(cg->db, "SELECT 1 FROM branches WHERE name=?1",
                    r->branch, NULL)) {
            free(r->branch);
            r->branch = NULL;
            (*cleared)++;
        }
        /* provenance: where it came from and how it was first written; a
         * memory already imported once keeps its first origin */
        const char *orig = r->source && r->source[0] ? r->source : "manual";
        if (strncmp(orig, "import:", 7) != 0) {
            StrBuf s; sb_init(&s);
            sb_printf(&s, "import:%s/%s", in->project, orig);
            free(r->source);
            r->source = s.p;
        }
        memory_content_id(r->type, r->task, r->body, r->cid);
        r->row = cid_row(tv, tn, r->cid);
        r->fresh = r->row == 0;
    }
    /* the same note twice in one file lands once: the first line wins */
    CidRow *byc = xmalloc(sizeof *byc * (size_t)(in->n ? in->n : 1));
    for (int i = 0; i < in->n; i++) {
        snprintf(byc[i].cid, sizeof byc[i].cid, "%s", in->v[i].cid);
        byc[i].row = i;
    }
    qsort(byc, (size_t)in->n, sizeof *byc, cid_cmp);
    for (int i = 1; i < in->n; i++) {
        int first = (int)byc[i - 1].row;
        if (in->v[first].dup_of >= 0) first = in->v[first].dup_of;
        if (strcmp(byc[i].cid, byc[i - 1].cid) != 0) continue;
        PortRec *r = &in->v[byc[i].row];
        r->dup_of = first;
        r->fresh = false;
    }
    free(byc);
}

static int port_read_input(Cg *cg, const MemImportOpts *o, char **text,
                           char *err, size_t errcap) {
    *text = NULL;
    if (o->from) {
        StrBuf b; sb_init(&b);
        if (port_from_dir(cg, o->from, &b, err, errcap) != 0) {
            sb_free(&b);
            return -1;
        }
        *text = b.p;
        return 0;
    }
    if (o->data) { *text = xstrdup(o->data); return 0; }
    const char *path = strcmp(o->file, "-") == 0 ? "/dev/stdin" : o->file;
    *text = read_entire_file(path, NULL);
    if (!*text) {
        snprintf(err, errcap, "cannot read %s", o->file);
        return -1;
    }
    return 0;
}

int cmd_memory_import(Cg *cg, const MemImportOpts *o, bool json) {
    int given = (o->file != NULL) + (o->from != NULL) + (o->data != NULL);
    if (given != 1) {
        fprintf(stderr, "usage: cg memory import <FILE|-> | --from DIR "
                "[--dry-run] [--keep-branch] [--retask OLD=NEW]\n");
        return 1;
    }
    if (o->retask && (!strchr(o->retask, '=') || o->retask[0] == '=')) {
        fprintf(stderr, "cg: memory import: --retask takes OLD=NEW "
                "(a task-tag prefix and its replacement)\n");
        return 1;
    }
    char err[1024] = "";
    char *text = NULL;
    if (port_read_input(cg, o, &text, err, sizeof err) != 0) {
        fprintf(stderr, "cg: memory import: %s\n", err);
        return 1;
    }
    PortIn in;
    memset(&in, 0, sizeof in);
    sb_init(&in.ej);
    sb_init(&in.et);
    int rc = port_parse(text, &in, err, sizeof err) == 0 ? 0 : 1;
    free(text);
    CidRow *tv = NULL;
    int tn = 0, cleared = 0, imported = 0, skipped = 0, relinked = 0;
    if (rc == 0) {
        tn = target_cids(cg, &tv);
        port_plan(cg, &in, o, tv, tn, &cleared);
        for (int i = 0; i < in.n; i++) {
            if (in.v[i].fresh) imported++;
            else skipped++;
        }
    }
    if (rc == 0 && o->dry_run) {
        relinked = port_relink(cg, &in, tv, tn, true, err, sizeof err);
    } else if (rc == 0) {
        if (cg_begin_write(cg) != 0) {
            cg_busy_report("The memory import");
            rc = CG_EXIT_BUSY;
            goto out;
        }
        /* The memories trigger logs one memory.add per row; a bulk import
         * folds those into one memory.import event inside the same
         * transaction, so no follower ever saw the rows it replaces. */
        sqlite3_stmt *hs = cg_prep(cg, "SELECT ifnull(max(seq),0) FROM events");
        long before = sqlite3_step(hs) == SQLITE_ROW
                    ? (long)sqlite3_column_int64(hs, 0) : 0;
        sqlite3_finalize(hs);
        for (int i = 0; rc == 0 && i < in.n; i++)
            if (in.v[i].fresh && !port_insert(cg, &in.v[i], err, sizeof err))
                rc = 1;
        for (int i = 0; rc == 0 && i < in.n; i++)
            if (in.v[i].dup_of >= 0) in.v[i].row = in.v[in.v[i].dup_of].row;
        if (rc == 0) {
            relinked = port_relink(cg, &in, tv, tn, false, err, sizeof err);
            if (relinked < 0) rc = 1;
        }
        if (rc == 0 && (imported || relinked)) {
            sqlite3_stmt *d = cg_prep(cg,
                "DELETE FROM events WHERE seq>? AND kind='memory.add'");
            sqlite3_bind_int64(d, 1, before);
            if (!port_step(cg, d, err, sizeof err)) rc = 1;
            StrBuf p; sb_init(&p);
            sb_puts(&p, "{\"project\":");
            sb_json_str(&p, in.project);
            sb_printf(&p, ",\"imported\":%d,\"skipped\":%d,\"invalid\":%d,"
                      "\"relinked\":%d}", imported, skipped, in.invalid,
                      relinked);
            if (rc == 0 && events_emit(cg, "memory.import", NULL, p.p) < 0) {
                snprintf(err, sizeof err, "%s", sqlite3_errmsg(cg->db));
                rc = 1;
            }
            sb_free(&p);
        }
        if (rc == 0 && sqlite3_exec(cg->db, "COMMIT", NULL, NULL, NULL)
                       != SQLITE_OK) {
            snprintf(err, sizeof err, "%s", sqlite3_errmsg(cg->db));
            rc = 1;
        }
        if (rc != 0) {
            sqlite3_exec(cg->db, "ROLLBACK", NULL, NULL, NULL);
            fprintf(stderr, "cg: memory import: %s — rolled back, nothing "
                    "imported\n", err);
            goto out;
        }
    }
    if (rc != 0) {
        fprintf(stderr, "cg: memory import: %s\n", err);
        goto out;
    }
    if (json) {
        StrBuf b; sb_init(&b);
        sb_printf(&b, "{\"ok\":true,\"dry_run\":%s,\"project\":",
                  o->dry_run ? "true" : "false");
        sb_json_str(&b, in.project);
        sb_printf(&b, ",\"read\":%d,\"imported\":%d,\"skipped\":%d,"
                  "\"invalid\":%d,\"relinked\":%d,\"branches_cleared\":%d,"
                  "\"errors\":[%s]}\n", in.n + in.invalid, imported, skipped,
                  in.invalid, relinked, cleared, in.ej.p ? in.ej.p : "");
        fputs(b.p, stdout);
        sb_free(&b);
    } else {
        if (in.invalid) fputs(in.et.p, stderr);
        printf("%s from %s: %d imported, %d skipped (already present), "
               "%d invalid, %d supersession%s relinked",
               o->dry_run ? "memory import --dry-run (nothing written)"
                          : "memory import",
               in.project, imported, skipped, in.invalid, relinked,
               relinked == 1 ? "" : "s");
        if (cleared)
            printf(", %d branch%s cleared", cleared, cleared == 1 ? "" : "es");
        printf("\n");
    }
out:
    for (int i = 0; i < in.n; i++) port_rec_free(&in.v[i]);
    free(in.v);
    free(in.project);
    free(tv);
    sb_free(&in.ej);
    sb_free(&in.et);
    return rc;
}
