#include "cg.h"
#include <unistd.h>
#include <sys/stat.h>

static const char *SCHEMA =
    "PRAGMA journal_mode=WAL;"
    "PRAGMA synchronous=NORMAL;"
    "CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);"
    "CREATE TABLE IF NOT EXISTS files("
    "  id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, lang TEXT,"
    "  size INTEGER, mtime INTEGER, hash TEXT, lines INTEGER);"
    "CREATE TABLE IF NOT EXISTS symbols("
    "  id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL REFERENCES files(id),"
    "  name TEXT NOT NULL, kind TEXT, line INTEGER, end_line INTEGER, sig TEXT);"
    "CREATE INDEX IF NOT EXISTS idx_sym_name ON symbols(name);"
    "CREATE INDEX IF NOT EXISTS idx_sym_file ON symbols(file_id);"
    "CREATE TABLE IF NOT EXISTS refs("
    "  id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL,"
    "  name TEXT NOT NULL, line INTEGER, sym_id INTEGER);"
    "CREATE INDEX IF NOT EXISTS idx_ref_name ON refs(name);"
    "CREATE INDEX IF NOT EXISTS idx_ref_file ON refs(file_id);"
    "CREATE INDEX IF NOT EXISTS idx_ref_sym  ON refs(sym_id);"
    "CREATE TABLE IF NOT EXISTS routes("
    "  id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL, framework TEXT,"
    "  method TEXT, pattern TEXT, handler TEXT, line INTEGER);"
    "CREATE INDEX IF NOT EXISTS idx_route_file ON routes(file_id);"
    /* trigram FTS: instant case-insensitive substring search on names */
    "CREATE VIRTUAL TABLE IF NOT EXISTS symbol_fts USING fts5("
    "  name, kind UNINDEXED, path UNINDEXED, sig, tokenize='trigram');"
    /* word FTS over file bodies */
    "CREATE VIRTUAL TABLE IF NOT EXISTS body_fts USING fts5("
    "  path UNINDEXED, body, tokenize='unicode61');";

int cg_find_root(char *out, size_t cap) {
    char cwd[4096];
    if (!getcwd(cwd, sizeof cwd)) return -1;
    char probe[4600];
    for (;;) {
        snprintf(probe, sizeof probe, "%s/%s", cwd, CG_DIR);
        struct stat st;
        if (stat(probe, &st) == 0 && S_ISDIR(st.st_mode)) {
            snprintf(out, cap, "%s", cwd);
            return 0;
        }
        char *slash = strrchr(cwd, '/');
        if (!slash || slash == cwd) return -1;
        *slash = 0;
    }
}

int cg_open(Cg *cg, bool create) {
    memset(cg, 0, sizeof *cg);
    if (create) {
        if (!getcwd(cg->root, sizeof cg->root)) return -1;
        char p[4600];
        snprintf(p, sizeof p, "%s/%s", cg->root, CG_OBJECTS);
        if (mkdirs(p) != 0) {
            fprintf(stderr, "cg: cannot create %s\n", p);
            return -1;
        }
    } else if (cg_find_root(cg->root, sizeof cg->root) != 0) {
        fprintf(stderr, "cg: not inside a Codify project (run `cg init`)\n");
        return -1;
    }
    char dbpath[4600];
    snprintf(dbpath, sizeof dbpath, "%s/%s", cg->root, CG_DB);
    if (sqlite3_open(dbpath, &cg->db) != SQLITE_OK) {
        fprintf(stderr, "cg: cannot open %s: %s\n", dbpath, sqlite3_errmsg(cg->db));
        return -1;
    }
    char *err = NULL;
    if (sqlite3_exec(cg->db, SCHEMA, NULL, NULL, &err) != SQLITE_OK) {
        fprintf(stderr, "cg: schema: %s\n", err ? err : "?");
        sqlite3_free(err);
        return -1;
    }
    return 0;
}

void cg_close(Cg *cg) {
    if (cg->db) sqlite3_close(cg->db);
    cg->db = NULL;
}

sqlite3_stmt *cg_prep(Cg *cg, const char *sql) {
    sqlite3_stmt *st = NULL;
    if (sqlite3_prepare_v2(cg->db, sql, -1, &st, NULL) != SQLITE_OK) {
        fprintf(stderr, "cg: sql error: %s\n  in: %s\n", sqlite3_errmsg(cg->db), sql);
        exit(2);
    }
    return st;
}

void cg_exec(Cg *cg, const char *sql) {
    char *err = NULL;
    if (sqlite3_exec(cg->db, sql, NULL, NULL, &err) != SQLITE_OK) {
        fprintf(stderr, "cg: sql error: %s\n  in: %s\n", err ? err : "?", sql);
        sqlite3_free(err);
        exit(2);
    }
}

void cg_meta_set(Cg *cg, const char *k, const char *v) {
    sqlite3_stmt *st = cg_prep(cg,
        "INSERT INTO meta(key,value) VALUES(?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    sqlite3_bind_text(st, 1, k, -1, SQLITE_STATIC);
    sqlite3_bind_text(st, 2, v, -1, SQLITE_STATIC);
    sqlite3_step(st);
    sqlite3_finalize(st);
}

char *cg_meta_get(Cg *cg, const char *k) {
    sqlite3_stmt *st = cg_prep(cg, "SELECT value FROM meta WHERE key=?");
    sqlite3_bind_text(st, 1, k, -1, SQLITE_STATIC);
    char *out = NULL;
    if (sqlite3_step(st) == SQLITE_ROW) {
        const unsigned char *v = sqlite3_column_text(st, 0);
        if (v) out = xstrdup((const char *)v);
    }
    sqlite3_finalize(st);
    return out;
}
