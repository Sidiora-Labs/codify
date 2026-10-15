#include "cg.h"
#include "sem_search.h"
#include <ctype.h>
#include <strings.h>

static __thread const Cg *filter_owner;
static __thread char filter_kind[64], filter_name[256];
void sem_search_filter_set(Cg *cg, const char *kind, const char *name) {
    filter_owner = kind || name ? cg : NULL;
    snprintf(filter_kind, sizeof filter_kind, "%s", kind ? kind : "");
    snprintf(filter_name, sizeof filter_name, "%s", name ? name : "");
}
const char *sem_search_filter_kind(const Cg *cg) {
    return filter_owner == cg && filter_kind[0] ? filter_kind : NULL;
}
const char *sem_search_filter_name(const Cg *cg) {
    return filter_owner == cg && filter_name[0] ? filter_name : NULL;
}

static bool typo_one(const char *a, const char *b) {
    size_t x = strlen(a), y = strlen(b);
    if (x > y + 1 || y > x + 1) return false;
    int errors = 0;
    size_t i = 0, j = 0;
    for (; i < x && j < y; ) {
        if (tolower((unsigned char)a[i]) == tolower((unsigned char)b[j])) {
            i++; j++; continue;
        }
        if (++errors > 1) return false;
        if (x > y) i++;
        else if (y > x) j++;
        else { i++; j++; }
    }
    return errors + (i < x || j < y ? 1 : 0) <= 1;
}

int sem_search_schema_init(Cg *cg) {
    return sqlite3_exec(cg->db,
        "CREATE TABLE IF NOT EXISTS semantic_identifier_postings("
        "symbol_id INTEGER NOT NULL,file_id INTEGER NOT NULL,segment TEXT NOT NULL,"
        "PRIMARY KEY(symbol_id,segment));"
        "CREATE INDEX IF NOT EXISTS idx_sem_identifier_segment "
        "ON semantic_identifier_postings(segment);"
        "CREATE INDEX IF NOT EXISTS idx_sem_identifier_file "
        "ON semantic_identifier_postings(file_id);",
        NULL, NULL, NULL) == SQLITE_OK ? 0 : -1;
}

/* Split underscores, punctuation and lower-to-upper case boundaries. Keep
 * the whole folded identifier as well as its words for precise lookup. */
static int post_name(sqlite3_stmt *put, long sid, long fid, const char *name) {
    if (!name || !*name) return 0;
    char word[128]; int n = 0;
    for (const unsigned char *p = (const unsigned char *)name; ; p++) {
        int c = *p;
        bool boundary = !isalnum(c) || (n && isupper(c) && islower(p[-1]));
        if (boundary || !c || n == (int)sizeof word - 1) {
            if (n) {
                word[n] = 0;
                sqlite3_bind_int64(put, 1, sid);
                sqlite3_bind_int64(put, 2, fid);
                sqlite3_bind_text(put, 3, word, -1, SQLITE_TRANSIENT);
                int rc = sqlite3_step(put);
                sqlite3_reset(put);
                if (rc != SQLITE_DONE) return -1;
                n = 0;
            }
        }
        if (!c) break;
        if (isalnum(c)) word[n++] = (char)tolower(c);
    }
    return 0;
}

int sem_search_file_purge(Cg *cg, long file_id) {
    sqlite3_stmt *st = cg_prep(cg,
        "DELETE FROM semantic_identifier_postings WHERE file_id=?");
    sqlite3_bind_int64(st, 1, file_id);
    int rc = sqlite3_step(st) == SQLITE_DONE ? 0 : -1;
    sqlite3_finalize(st);
    return rc;
}

int sem_search_file_replace(Cg *cg, long file_id) {
    if (sem_search_file_purge(cg, file_id)) return -1;
    sqlite3_stmt *get = cg_prep(cg,
        "SELECT s.id,s.name,ss.qualified_name FROM symbols s "
        "LEFT JOIN semantic_symbols ss ON ss.symbol_id=s.id WHERE s.file_id=?");
    sqlite3_stmt *put = cg_prep(cg,
        "INSERT OR IGNORE INTO semantic_identifier_postings"
        "(symbol_id,file_id,segment) VALUES(?,?,?)");
    sqlite3_bind_int64(get, 1, file_id);
    int rc = 0;
    int step = SQLITE_DONE;
    while ((step = sqlite3_step(get)) == SQLITE_ROW) {
        long id = sqlite3_column_int64(get, 0);
        if (post_name(put, id, file_id,
                      (const char *)sqlite3_column_text(get, 1)) ||
            post_name(put, id, file_id,
                      (const char *)sqlite3_column_text(get, 2))) {
            rc = -1;
            break;
        }
    }
    if (step != SQLITE_DONE && rc == 0) rc = -1;
    sqlite3_finalize(put); sqlite3_finalize(get);
    return rc;
}

int sem_search_file_copy(Cg *cg, long source_file_id, long dest_file_id) {
    (void)source_file_id;
    return sem_search_file_replace(cg, dest_file_id);
}

static bool seen(const SemSearchHit *v, int n, long id) {
    for (int i = 0; i < n; i++) if (v[i].symbol_id == id) return true;
    return false;
}

static int lookup_stage(Cg *cg, const char *term, const char *kind,
                        const char *name, SemSearchHit *out, int n, int cap,
                        int stage) {
    char scope[64];
    branch_scope_sql(cg, "f", scope, sizeof scope);
    const QueryFilter *qf = cg_filter_get(cg);
    char *flt = qf ? query_filter_sql(qf, "f") : xstrdup("");
    StrBuf sql; sb_init(&sql);
    sb_puts(&sql, "SELECT DISTINCT s.id,s.name FROM symbols s JOIN files f ON f.id=s.file_id ");
    if (stage == 1) sb_puts(&sql, "JOIN semantic_identifier_postings p ON p.symbol_id=s.id ");
    sb_printf(&sql, "WHERE 1=1 %s %s", scope, flt);
    free(flt);
    if (kind && *kind) sb_puts(&sql, " AND s.kind=?");
    if (name && *name) sb_puts(&sql,
        " AND (s.name=? OR instr(lower(s.name),lower(?))>0)");
    if (stage == 0) sb_puts(&sql, " AND s.name=? COLLATE NOCASE");
    if (stage == 1) sb_puts(&sql, " AND p.segment=?");
    if (stage == 2) sb_puts(&sql, " AND length(s.name) BETWEEN ? AND ?");
    sb_puts(&sql, " ORDER BY s.decl,f.path,s.line LIMIT 256");
    sqlite3_stmt *st = cg_prep(cg, sql.p);
    sb_free(&sql);
    int b = 1;
    if (kind && *kind) sqlite3_bind_text(st, b++, kind, -1, SQLITE_TRANSIENT);
    if (name && *name) {
        sqlite3_bind_text(st, b++, name, -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(st, b++, name, -1, SQLITE_TRANSIENT);
    }
    if (stage < 2) sqlite3_bind_text(st, b++, term, -1, SQLITE_TRANSIENT);
    else {
        int len = (int)strlen(term);
        sqlite3_bind_int(st, b++, len - 1);
        sqlite3_bind_int(st, b++, len + 1);
    }
    while (n < cap && sqlite3_step(st) == SQLITE_ROW) {
        long id = sqlite3_column_int64(st, 0);
        const char *candidate = (const char *)sqlite3_column_text(st, 1);
        if (stage == 2 && (!candidate || !typo_one(term, candidate))) continue;
        if (seen(out, n, id)) continue;
        out[n++] = (SemSearchHit){id, (SemMatch)stage};
    }
    sqlite3_finalize(st);
    return n;
}

int sem_search_lookup(Cg *cg, const char *term, const char *kind,
                      const char *name, SemSearchHit *out, int cap) {
    if (!term || !*term || cap <= 0) return 0;
    int n = lookup_stage(cg, term, kind, name, out, 0, cap, 0);
    char folded[128]; size_t i = 0;
    for (; term[i] && i + 1 < sizeof folded; i++)
        folded[i] = (char)tolower((unsigned char)term[i]);
    folded[i] = 0;
    if (i && n < cap) n = lookup_stage(cg, folded, kind, name, out, n, cap, 1);
    /* Typo fallback is only attempted when precise lookup found nothing.
     * Bounded candidate loading prevents a broad typo from scanning the DB. */
    if (!n && i >= 3 && i <= 64)
        n = lookup_stage(cg, term, kind, name, out, n, cap < 16 ? cap : 16, 2);
    return n;
}
