#include "index_health.h"
#include <ctype.h>
#include <errno.h>
#include <sys/stat.h>

int index_health_init(Cg *cg) {
    if (sqlite3_exec(cg->db,
        "CREATE TABLE IF NOT EXISTS extraction_health("
        "branch_id INTEGER NOT NULL,path TEXT NOT NULL,"
        "status TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',"
        "parser TEXT NOT NULL DEFAULT '',diagnostic_line INTEGER NOT NULL DEFAULT 0,"
        "diagnostics TEXT NOT NULL DEFAULT '',"
        "generated INTEGER NOT NULL DEFAULT 0,content_hash TEXT,"
        "last_success_hash TEXT,extraction_version INTEGER,pending_version INTEGER,"
        "PRIMARY KEY(branch_id,path));", NULL, NULL, NULL) != SQLITE_OK)
        return -1;
    /* A development build may have created the first health table before
     * bounded diagnostic history and deferred semantic stamping existed. */
    static const char *cols[][2] = {
        {"diagnostics", "TEXT NOT NULL DEFAULT ''"},
        {"pending_version", "INTEGER"},
    };
    for (size_t i = 0; i < sizeof cols / sizeof *cols; i++) {
        sqlite3_stmt *q = cg_prep(cg,
            "SELECT 1 FROM pragma_table_info('extraction_health') WHERE name=?1");
        sqlite3_bind_text(q, 1, cols[i][0], -1, SQLITE_STATIC);
        bool present = sqlite3_step(q) == SQLITE_ROW;
        sqlite3_finalize(q);
        if (present) continue;
        char sql[160];
        snprintf(sql, sizeof sql, "ALTER TABLE extraction_health ADD COLUMN %s %s",
                 cols[i][0], cols[i][1]);
        if (sqlite3_exec(cg->db, sql, NULL, NULL, NULL) != SQLITE_OK) return -1;
    }
    return 0;
}

bool index_health_stale(Cg *cg, const char *path) {
    sqlite3_stmt *q = cg_prep(cg,
        "SELECT status,extraction_version FROM extraction_health "
        "WHERE branch_id=?1 AND path=?2");
    sqlite3_bind_int64(q, 1, cg->branch_id);
    sqlite3_bind_text(q, 2, path, -1, SQLITE_STATIC);
    bool stale = true;
    if (sqlite3_step(q) == SQLITE_ROW) {
        const char *status = (const char *)sqlite3_column_text(q, 0);
        stale = !status || (strcmp(status, "complete") != 0 &&
                            strcmp(status, "skipped") != 0) ||
            sqlite3_column_type(q, 1) == SQLITE_NULL ||
            sqlite3_column_int(q, 1) != CG_EXTRACTION_VERSION;
    }
    sqlite3_finalize(q);
    return stale;
}

bool index_health_branch_stale(Cg *cg) {
    if (index_health_init(cg) != 0) return true;
    sqlite3_stmt *q = cg_prep(cg,
        "SELECT EXISTS(SELECT 1 FROM files f LEFT JOIN extraction_health h "
        "ON h.branch_id=f.branch_id AND h.path=f.path "
        "WHERE f.branch_id=?1 AND (h.status IS NULL OR h.status IN ('partial','failed') "
        "OR h.extraction_version IS NULL OR h.extraction_version<>?2)) "
        "OR EXISTS(SELECT 1 FROM extraction_health h WHERE h.branch_id=?1 "
        "AND (h.status IN ('partial','failed') OR h.extraction_version IS NULL "
        "OR h.extraction_version<>?2))");
    sqlite3_bind_int64(q, 1, cg->branch_id);
    sqlite3_bind_int(q, 2, CG_EXTRACTION_VERSION);
    bool stale = sqlite3_step(q) != SQLITE_ROW || sqlite3_column_int(q, 0);
    sqlite3_finalize(q);
    return stale;
}

void index_health_record(Cg *cg, const char *path, const IndexHealthResult *r) {
    sqlite3_stmt *q = cg_prep(cg,
        "INSERT INTO extraction_health(branch_id,path,status,reason,parser,"
        "diagnostic_line,diagnostics,generated,content_hash,last_success_hash,"
        "extraction_version,pending_version) "
        "VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,"
        "CASE WHEN ?3='complete' THEN ?9 ELSE NULL END,"
        "CASE WHEN ?3='skipped' THEN ?10 ELSE NULL END,"
        "CASE WHEN ?3='complete' THEN ?10 ELSE NULL END) "
        "ON CONFLICT(branch_id,path) DO UPDATE SET "
        "status=excluded.status,reason=excluded.reason,parser=excluded.parser,"
        "diagnostic_line=excluded.diagnostic_line,"
        "diagnostics=excluded.diagnostics,generated=excluded.generated,"
        "content_hash=excluded.content_hash,"
        "last_success_hash=coalesce(excluded.last_success_hash,extraction_health.last_success_hash),"
        "extraction_version=excluded.extraction_version,"
        "pending_version=excluded.pending_version");
    sqlite3_bind_int64(q, 1, cg->branch_id);
    sqlite3_bind_text(q, 2, path, -1, SQLITE_STATIC);
    sqlite3_bind_text(q, 3, r->status, -1, SQLITE_STATIC);
    sqlite3_bind_text(q, 4, r->reason ? r->reason : "", -1, SQLITE_STATIC);
    sqlite3_bind_text(q, 5, r->parser ? r->parser : "", -1, SQLITE_STATIC);
    sqlite3_bind_int(q, 6, r->diagnostic_line);
    sqlite3_bind_text(q, 7, r->diagnostics ? r->diagnostics : r->reason,
                      -1, SQLITE_STATIC);
    sqlite3_bind_int(q, 8, r->generated ? 1 : 0);
    if (r->content_hash && r->content_hash[0])
        sqlite3_bind_text(q, 9, r->content_hash, -1, SQLITE_STATIC);
    else sqlite3_bind_null(q, 9);
    sqlite3_bind_int(q, 10, CG_EXTRACTION_VERSION);
    sqlite3_step(q);
    sqlite3_finalize(q);
}

void parse_diagnostic_add(ParseResult *pr, const char *code, int line) {
    if (!pr || !code || !code[0]) return;
    if (!pr->partial) {
        pr->partial = true;
        pr->diagnostic_line = line;
        snprintf(pr->diagnostic, sizeof pr->diagnostic, "%s", code);
    }
    if (pr->diagnostic_count >= 8) return;
    size_t used = strlen(pr->diagnostics);
    if (used + 24 + strlen(code) >= sizeof pr->diagnostics) return;
    snprintf(pr->diagnostics + used, sizeof pr->diagnostics - used,
             "%s%d:%s", used ? ";" : "", line, code);
    pr->diagnostic_count++;
}

void index_health_finish(Cg *cg) {
    sqlite3_stmt *q = cg_prep(cg,
        "UPDATE extraction_health SET extraction_version=pending_version,"
        "pending_version=NULL WHERE branch_id=?1 AND status='complete' "
        "AND pending_version=?2");
    sqlite3_bind_int64(q, 1, cg->branch_id);
    sqlite3_bind_int(q, 2, CG_EXTRACTION_VERSION);
    sqlite3_step(q);
    sqlite3_finalize(q);
}

void index_health_remove(Cg *cg, long file_id) {
    sqlite3_stmt *q = cg_prep(cg,
        "DELETE FROM extraction_health WHERE branch_id=?1 AND path="
        "(SELECT path FROM files WHERE id=?2)");
    sqlite3_bind_int64(q, 1, cg->branch_id);
    sqlite3_bind_int64(q, 2, file_id);
    sqlite3_step(q);
    sqlite3_finalize(q);
}

void index_health_prune_missing(Cg *cg) {
    sqlite3_stmt *q = cg_prep(cg,
        "SELECT h.path FROM extraction_health h WHERE h.branch_id=?1 "
        "AND NOT EXISTS(SELECT 1 FROM files f WHERE f.branch_id=h.branch_id "
        "AND f.path=h.path)");
    sqlite3_bind_int64(q, 1, cg->branch_id);
    sqlite3_stmt *del = cg_prep(cg,
        "DELETE FROM extraction_health WHERE branch_id=?1 AND path=?2");
    while (sqlite3_step(q) == SQLITE_ROW) {
        const char *path = (const char *)sqlite3_column_text(q, 0);
        char abs[4900];
        struct stat st;
        if (!path || !path_format(abs, sizeof abs, "%s/%s", cg->root, path) ||
            lstat(abs, &st) == 0 || errno != ENOENT) continue;
        sqlite3_bind_int64(del, 1, cg->branch_id);
        sqlite3_bind_text(del, 2, path, -1, SQLITE_TRANSIENT);
        sqlite3_step(del);
        sqlite3_reset(del);
        sqlite3_clear_bindings(del);
    }
    sqlite3_finalize(del);
    sqlite3_finalize(q);
}

/* Generated detection is conservative and deterministic. A marker in the
 * first 2 KiB or a conventional output directory is sufficient evidence. */
bool index_health_generated(const char *path, const char *body, size_t len) {
    if (strstr(path, "/generated/") || strstr(path, "/gen/") ||
        strstr(path, "/dist/") || strstr(path, "/build/")) return true;
    size_t n = len < 2048 ? len : 2048;
    for (size_t i = 0; i < n; i++) {
        const char *marks[] = {"@generated", "auto-generated", "autogenerated",
                               "do not edit", "generated file"};
        for (size_t j = 0; j < sizeof marks / sizeof *marks; j++) {
            size_t m = strlen(marks[j]);
            if (i + m > n) continue;
            size_t k = 0;
            while (k < m && tolower((unsigned char)body[i+k]) == marks[j][k]) k++;
            if (k == m) return true;
        }
    }
    return false;
}
