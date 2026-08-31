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
    "  name TEXT NOT NULL, line INTEGER, sym_id INTEGER,"
    "  qual TEXT, kind TEXT NOT NULL DEFAULT 'call',"
    "  target_id INTEGER DEFAULT NULL,"
    "  verdict TEXT DEFAULT NULL,"
    "  conf TEXT DEFAULT NULL,"
    "  argc INTEGER DEFAULT -1);"
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
    "  path UNINDEXED, body, tokenize='unicode61');"
    /* agent memory: deliberate notes, linked to spec tasks by "feature/id" */
    "CREATE TABLE IF NOT EXISTS memories("
    "  id INTEGER PRIMARY KEY, created INTEGER NOT NULL, type TEXT NOT NULL,"
    "  task TEXT, body TEXT NOT NULL, symbols TEXT, files TEXT,"
    "  source TEXT NOT NULL);"
    "CREATE INDEX IF NOT EXISTS idx_mem_task ON memories(task);"
    /* a superseded memory stays readable but stops surfacing first */
    "CREATE TABLE IF NOT EXISTS memory_superseded("
    "  id INTEGER PRIMARY KEY, by_id INTEGER NOT NULL, at INTEGER NOT NULL);"
    "CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5("
    "  body, task, symbols, tokenize='unicode61');"
    /* git history, ingested by `cg git-sync`; empty when the repo has no git */
    "CREATE TABLE IF NOT EXISTS git_commits("
    "  hash TEXT PRIMARY KEY, author TEXT, date INTEGER, subject TEXT);"
    "CREATE TABLE IF NOT EXISTS git_churn("
    "  path TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(path,hash));"
    "CREATE INDEX IF NOT EXISTS idx_churn_path ON git_churn(path);"
    /* leases: parallel-mode task claims, one row per claimed spec task */
    "CREATE TABLE IF NOT EXISTS leases("
    "  task TEXT PRIMARY KEY, agent TEXT NOT NULL, claimed INTEGER NOT NULL,"
    "  expires INTEGER NOT NULL, touches TEXT);"
    /* attempts are the authoritative live execution record. A task's kvx
     * status says what was declared; this table says who is actually alive. */
    "CREATE TABLE IF NOT EXISTS attempts("
    "  attempt_id TEXT PRIMARY KEY, task TEXT NOT NULL, agent TEXT NOT NULL,"
    "  host TEXT, session TEXT, fence INTEGER NOT NULL, state TEXT NOT NULL,"
    "  started INTEGER NOT NULL, heartbeat INTEGER NOT NULL,"
    "  expires INTEGER NOT NULL, reason TEXT);"
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_attempt_fence ON attempts(fence);"
    "CREATE INDEX IF NOT EXISTS idx_attempt_task ON attempts(task,state);"
    "CREATE INDEX IF NOT EXISTS idx_attempt_agent ON attempts(agent,state);"
    /* normalized native hook events: durable activity/evidence history */
    "CREATE TABLE IF NOT EXISTS runtime_events("
    "  id INTEGER PRIMARY KEY, created INTEGER NOT NULL,"
    "  source TEXT NOT NULL, kind TEXT NOT NULL, session TEXT NOT NULL,"
    "  attempt_id TEXT, task TEXT, fingerprint TEXT UNIQUE NOT NULL,"
    "  revision TEXT NOT NULL, previous_revision TEXT,"
    "  evidence_delta INTEGER NOT NULL, activity INTEGER NOT NULL,"
    "  output_hash TEXT, output_changed INTEGER NOT NULL, payload TEXT);"
    "CREATE INDEX IF NOT EXISTS idx_event_attempt "
    "ON runtime_events(attempt_id,created);"
    "CREATE INDEX IF NOT EXISTS idx_event_session "
    "ON runtime_events(session,created);"
    /* content hashes cached by nanosecond file metadata make lifecycle
     * revisions exact without re-reading every file on every heartbeat */
    "CREATE TABLE IF NOT EXISTS runtime_files("
    "  path TEXT PRIMARY KEY, size INTEGER NOT NULL,"
    "  mtime_ns INTEGER NOT NULL, ctime_ns INTEGER NOT NULL,"
    "  hash TEXT NOT NULL);"
    /* per-file import rows; name '*' means a whole-module import */
    "CREATE TABLE IF NOT EXISTS imports("
    "  id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL,"
    "  name TEXT NOT NULL, module TEXT NOT NULL, line INTEGER,"
    "  system INTEGER NOT NULL DEFAULT 0,"
    "  target_file_id INTEGER DEFAULT NULL,"
    "  origin TEXT DEFAULT NULL);"
    "CREATE INDEX IF NOT EXISTS idx_import_file ON imports(file_id);"
    "CREATE INDEX IF NOT EXISTS idx_import_name ON imports(name);"
    /* the intent layer: comment spans bound to the symbol they describe.
     * anchored_hash is the bound symbol's body hash as of the last change
     * to this comment's own text — drift detection compares against it. */
    "CREATE TABLE IF NOT EXISTS comments("
    "  id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL REFERENCES files(id),"
    "  line INTEGER NOT NULL, end_line INTEGER, kind TEXT, sym_id INTEGER,"
    "  body TEXT NOT NULL, anchored_hash TEXT);"
    "CREATE INDEX IF NOT EXISTS idx_cmt_file ON comments(file_id);"
    "CREATE INDEX IF NOT EXISTS idx_cmt_sym  ON comments(sym_id);"
    /* word FTS over comment text, separate from body_fts so prose can be
     * searched without competing with code tokens. Body only: the rowid is
     * comments.id, so path, kind, and the bound symbol come from the join
     * rather than from duplicated UNINDEXED columns on every row. */
    "CREATE VIRTUAL TABLE IF NOT EXISTS comment_fts USING fts5("
    "  body, tokenize='unicode61');";

/* the schema above, as stored in meta.schema_version */
#define SCHEMA_VERSION "12"

/* Does `base/name` exist at all? `.git` is a file in worktrees and
 * submodules, so existence — not directory-ness — is the boundary test. */
static bool path_exists(const char *base, const char *name) {
    char p[4600];
    struct stat st;
    snprintf(p, sizeof p, "%s/%s", base, name);
    return stat(p, &st) == 0;
}

static bool is_project_dir(const char *base) {
    char p[4600];
    struct stat st;
    snprintf(p, sizeof p, "%s/%s", base, CG_DIR);
    return stat(p, &st) == 0 && S_ISDIR(st.st_mode);
}

/* A directory that owns its subtree. Crossing one of these while looking for
 * .codegraph means the enclosing project is a different project, so the walk
 * must stop rather than silently binding an ancestor's database. */
bool cg_is_boundary(const char *dir) {
    static const char *MARKERS[] = {
        ".git", ".hg", ".svn", "go.mod", "Cargo.toml", "package.json",
        "pyproject.toml", "pom.xml", "build.gradle", "composer.json", NULL
    };
    for (int i = 0; MARKERS[i]; i++)
        if (path_exists(dir, MARKERS[i])) return true;
    return false;
}

int cg_find_root_at(const char *start, char *out, size_t cap) {
    const char *ov = getenv("CODIFY_ROOT");
    if (ov && ov[0]) {                       /* explicit override wins */
        if (!is_project_dir(ov)) return -1;
        snprintf(out, cap, "%s", ov);
        return 0;
    }
    char cwd[4096];
    snprintf(cwd, sizeof cwd, "%s", start);
    size_t n = strlen(cwd);
    while (n > 1 && cwd[n - 1] == '/') cwd[--n] = 0;

    const char *home = getenv("HOME");
    struct stat st0;
    bool have_dev = stat(cwd, &st0) == 0;

    for (;;) {
        if (is_project_dir(cwd)) {           /* probe before any boundary */
            snprintf(out, cap, "%s", cwd);
            return 0;
        }
        if (cg_is_boundary(cwd)) return -1;  /* a different project owns this */
        if (home && home[0] && strcmp(cwd, home) == 0) return -1;
        char *slash = strrchr(cwd, '/');
        if (!slash || slash == cwd) return -1;
        *slash = 0;
        struct stat st;
        if (have_dev && stat(cwd, &st) == 0 && st.st_dev != st0.st_dev)
            return -1;                       /* crossed a mount point */
    }
}

int cg_find_root(char *out, size_t cap) {
    char cwd[4096];
    if (!getcwd(cwd, sizeof cwd)) return -1;
    return cg_find_root_at(cwd, out, cap);
}

/* Report which project cg binds to here. The whole class of "it silently used
 * an ancestor" confusion is one command away from being diagnosed. */
int cmd_root(bool json) {
    char root[4096];
    if (cg_find_root(root, sizeof root) != 0) {
        if (json) printf("{\"root\":null}\n");
        else fprintf(stderr, "cg: no Codify project here or in any parent "
                             "directory (run `cg init`)\n");
        return 1;
    }
    if (json) {
        StrBuf b; sb_init(&b);
        sb_puts(&b, "{\"root\":");
        sb_json_str(&b, root);
        sb_puts(&b, "}\n");
        fputs(b.p, stdout);
        sb_free(&b);
    } else {
        printf("%s\n", root);
    }
    return 0;
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
    /* WAL lets readers run while one writer indexes, and the busy timeout
     * makes concurrent cg processes wait instead of failing outright. */
    sqlite3_busy_timeout(cg->db, 5000);
    sqlite3_exec(cg->db, "PRAGMA journal_mode=WAL;PRAGMA synchronous=NORMAL",
                 NULL, NULL, NULL);
    char *err = NULL;
    if (sqlite3_exec(cg->db, SCHEMA, NULL, NULL, &err) != SQLITE_OK) {
        fprintf(stderr, "cg: schema: %s\n", err ? err : "?");
        sqlite3_free(err);
        return -1;
    }
    if (cg_schema_upgrade(cg) != 0) return -1;
    return 0;
}

/* Derived tables (everything the indexer rebuilds from source) are dropped
 * and recreated on every schema_version mismatch — even with an empty files
 * table, an old DB may carry the old refs shape. Agent memory, git history,
 * leases, attempts, and runtime events are never touched: they are durable
 * state a version bump must not destroy. The DROPs are IF EXISTS, a no-op on
 * a fresh DB. */
int cg_schema_upgrade(Cg *cg) {
    char *ver = cg_meta_get(cg, "schema_version");
    bool current = ver && strcmp(ver, SCHEMA_VERSION) == 0;
    free(ver);
    if (current) return 0;
    /* meta rows mean an existing project DB, not a freshly created one */
    long nmeta = 0;
    sqlite3_stmt *st = NULL;
    if (sqlite3_prepare_v2(cg->db, "SELECT COUNT(*) FROM meta", -1, &st,
                           NULL) == SQLITE_OK) {
        if (sqlite3_step(st) == SQLITE_ROW) nmeta = sqlite3_column_int64(st, 0);
        sqlite3_finalize(st);
    }
    static const char *DROPS =
        "DROP TABLE IF EXISTS files;DROP TABLE IF EXISTS symbols;"
        "DROP TABLE IF EXISTS refs;DROP TABLE IF EXISTS routes;"
        "DROP TABLE IF EXISTS imports;DROP TABLE IF EXISTS symbol_fts;"
        "DROP TABLE IF EXISTS body_fts;DROP TABLE IF EXISTS comments;"
        "DROP TABLE IF EXISTS comment_fts;";
    char *err = NULL;
    if (sqlite3_exec(cg->db, DROPS, NULL, NULL, &err) != SQLITE_OK ||
        sqlite3_exec(cg->db, SCHEMA, NULL, NULL, &err) != SQLITE_OK) {
        fprintf(stderr, "cg: schema upgrade: %s\n", err ? err : "?");
        sqlite3_free(err);
        return -1;
    }
    if (nmeta > 0)
        fprintf(stderr, "cg: schema upgraded to v%s — run 'cg sync' to "
                        "rebuild the graph\n", SCHEMA_VERSION);
    cg_meta_set(cg, "schema_version", SCHEMA_VERSION);
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
