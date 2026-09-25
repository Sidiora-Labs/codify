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
