#include "cg.h"
#include <unistd.h>
#include <sys/stat.h>

static const char *SCHEMA =
    "PRAGMA journal_mode=WAL;"
    "PRAGMA synchronous=NORMAL;"
    "CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);"
    /* branches: every branch whose tree has been indexed into this
     * database, one row each, with the worktree it was last seen in. The
     * registry is durable state, never dropped by a schema upgrade: its ids
     * are what file rows are scoped by. */
    "CREATE TABLE IF NOT EXISTS branches("
    "  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, worktree TEXT,"
    "  head TEXT, base TEXT, updated INTEGER NOT NULL);"
    /* a path exists once per branch; ids stay unique across branches so
     * every child table keys by file id alone */
    "CREATE TABLE IF NOT EXISTS files("
    "  id INTEGER PRIMARY KEY, branch_id INTEGER NOT NULL DEFAULT 0,"
    "  path TEXT NOT NULL, lang TEXT,"
    "  size INTEGER, mtime INTEGER, mtime_ns INTEGER, hash TEXT, lines INTEGER,"
    "  base TEXT,"                       /* last path segment (1.3) */
    "  UNIQUE(branch_id, path));"
    "CREATE INDEX IF NOT EXISTS idx_file_path ON files(path);"
    "CREATE TABLE IF NOT EXISTS symbols("
    "  id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL REFERENCES files(id),"
    "  name TEXT NOT NULL, kind TEXT, line INTEGER, end_line INTEGER, sig TEXT,"
    "  decl INTEGER NOT NULL DEFAULT 0);"
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
    /* trigram FTS: instant case-insensitive substring search on names;
     * words is the name split into its words (name_words), so a phrase
     * finds memory_export and exportMemory alike */
    "CREATE VIRTUAL TABLE IF NOT EXISTS symbol_fts USING fts5("
    "  name, kind UNINDEXED, path UNINDEXED, sig, words, tokenize='trigram');"
    /* word FTS over file bodies: body_fts, created by db_fts_create in
     * the mode meta.fts_mode records (contentless on SQLite 3.43+) */
    /* agent memory: deliberate notes, linked to spec tasks by "feature/id".
     * branch is where the note was taken (NULL for the main tree); class and
     * confidence are Jev's verdict, filled by `cg memory classify`, over a
     * fixed vocabulary — skill, decision, constraint, fact, noise — with
     * NULL meaning "not classified yet". Both are advisory: nothing gates on
     * them, and a promoted skill is recorded by the generated SKILL.md that
     * names the memory, never by this column, so re-classifying a memory
     * cannot silently un-promote a skill. */
    "CREATE TABLE IF NOT EXISTS memories("
    "  id INTEGER PRIMARY KEY, created INTEGER NOT NULL, type TEXT NOT NULL,"
    "  task TEXT, body TEXT NOT NULL, symbols TEXT, files TEXT,"
    "  source TEXT NOT NULL, branch TEXT, class TEXT, confidence REAL);"
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
     * status says what was declared; this table says who is actually alive.
     * branch, worktree, and parent are where and for whom a fleet worker
     * runs it; `cg fleet begin` fills them, plain claims leave them NULL. */
    "CREATE TABLE IF NOT EXISTS attempts("
    "  attempt_id TEXT PRIMARY KEY, task TEXT NOT NULL, agent TEXT NOT NULL,"
    "  host TEXT, session TEXT, fence INTEGER NOT NULL, state TEXT NOT NULL,"
    "  started INTEGER NOT NULL, heartbeat INTEGER NOT NULL,"
    "  expires INTEGER NOT NULL, reason TEXT, branch TEXT, worktree TEXT,"
    "  parent TEXT);"
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_attempt_fence ON attempts(fence);"
    "CREATE INDEX IF NOT EXISTS idx_attempt_task ON attempts(task,state);"
    "CREATE INDEX IF NOT EXISTS idx_attempt_agent ON attempts(agent,state);"
    /* agents: who is alive in which fleet role. One row per agent name,
     * refreshed on every claim, start, heartbeat, and fleet report; the
     * branch columns are filled by the branch lifecycle. Durable state,
     * never dropped by a schema upgrade. */
    "CREATE TABLE IF NOT EXISTS agents("
    "  agent TEXT PRIMARY KEY, role TEXT, parent TEXT, feature TEXT,"
    "  wave INTEGER, host TEXT, session TEXT, branch TEXT, worktree TEXT,"
    "  base TEXT, seen INTEGER NOT NULL,"
    /* v18: native agents (native.c) — the same columns the upgrade adds */
    "  kind TEXT, host_kind TEXT, agent_id TEXT, agent_type TEXT,"
    "  description TEXT, model TEXT, depth INTEGER, state TEXT,"
    "  started INTEGER, ended INTEGER, transcript TEXT, cwd TEXT, task TEXT,"
    "  task_source TEXT, last_tool TEXT, tool_calls INTEGER);"
    /* normalized native hook events: durable activity/evidence history */
    "CREATE TABLE IF NOT EXISTS runtime_events("
    "  id INTEGER PRIMARY KEY, created INTEGER NOT NULL,"
    "  source TEXT NOT NULL, kind TEXT NOT NULL, session TEXT NOT NULL,"
    "  attempt_id TEXT, task TEXT, fingerprint TEXT UNIQUE NOT NULL,"
    "  semantic_fingerprint TEXT,"
    "  revision TEXT NOT NULL, previous_revision TEXT,"
    "  evidence_delta INTEGER NOT NULL, activity INTEGER NOT NULL,"
    "  output_hash TEXT, output_changed INTEGER NOT NULL, payload TEXT);"
    "CREATE INDEX IF NOT EXISTS idx_event_attempt "
    "ON runtime_events(attempt_id,created);"
    "CREATE INDEX IF NOT EXISTS idx_event_session "
    "ON runtime_events(session,created);"
    /* the event log (events.c): every state change by sequence number, for
     * followers that must not poll. Durable, never dropped by an upgrade;
     * added without a version bump because nothing derived depends on it. */
    "CREATE TABLE IF NOT EXISTS events("
    "  seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL,"
    "  kind TEXT NOT NULL, subject TEXT, run TEXT, node TEXT, branch TEXT,"
    "  payload TEXT);"
    "CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind,seq);"
    /* the supervisor asks "has this agent or its task done anything since
     * seq N" for every live worker on a short cadence */
    "CREATE INDEX IF NOT EXISTS idx_events_node ON events(node,seq);"
    "CREATE INDEX IF NOT EXISTS idx_events_subject ON events(subject,seq);"
    /* durable fleet runs (orchestrate.c): a supervisor's whole state, so a
     * restarted supervisor continues the run instead of starting over.
     * state is also the control channel — cg fleet pause/down write it and
     * the supervisor reads it every tick. Durable, never dropped. */
    "CREATE TABLE IF NOT EXISTS fleet_runs("
    "  run TEXT PRIMARY KEY, feature TEXT NOT NULL, state TEXT NOT NULL,"
    "  pid INTEGER, pid_start INTEGER, host TEXT, driver TEXT, slots INTEGER,"
    "  max_fail INTEGER, wakes_left INTEGER,"
    "  failures INTEGER NOT NULL DEFAULT 0,"
    "  first_turn INTEGER NOT NULL DEFAULT 1,"
    "  last_wake INTEGER NOT NULL DEFAULT 0, rc INTEGER, reason TEXT,"
    "  log TEXT, started INTEGER NOT NULL, updated INTEGER NOT NULL);"
    /* one row per process the supervisor spawned; state live|exited|killed.
     * pid_start is the kernel's start time, so a reused pid is never
     * mistaken for the agent it replaced. */
    "CREATE TABLE IF NOT EXISTS fleet_nodes("
    "  id INTEGER PRIMARY KEY, run TEXT NOT NULL, role TEXT NOT NULL,"
    "  agent TEXT NOT NULL, parent TEXT, feature TEXT, task TEXT,"
    "  wave INTEGER, branch TEXT, base TEXT, worktree TEXT, pid INTEGER,"
    "  pid_start INTEGER, attempt TEXT, fence INTEGER, state TEXT NOT NULL,"
    "  exit INTEGER, outcome TEXT, log TEXT, started INTEGER NOT NULL,"
    "  ended INTEGER);"
    "CREATE INDEX IF NOT EXISTS idx_fleet_nodes_run ON fleet_nodes(run,state);"
    /* opt-in approval gates ([role.*] approve): pending until a person
     * decides; an agent's land or pr waits on it */
    "CREATE TABLE IF NOT EXISTS fleet_approvals("
    "  id INTEGER PRIMARY KEY, run TEXT, gate TEXT NOT NULL,"
    "  subject TEXT NOT NULL, state TEXT NOT NULL, requested INTEGER NOT NULL,"
    "  requested_by TEXT, decided INTEGER, decided_by TEXT, note TEXT);"
    /* content hashes cached by nanosecond file metadata make lifecycle
     * revisions exact without re-reading every file on every heartbeat */
    "CREATE TABLE IF NOT EXISTS runtime_files("
    "  path TEXT PRIMARY KEY, size INTEGER NOT NULL,"
    "  mtime_ns INTEGER NOT NULL, ctime_ns INTEGER NOT NULL,"
    "  hash TEXT NOT NULL);"
    /* opaque work revisions preserve only the baselines needed for compact
     * state/evidence/workspace deltas; packets never leave the local DB */
    "CREATE TABLE IF NOT EXISTS work_packets("
    "  revision TEXT PRIMARY KEY, created INTEGER NOT NULL,"
    "  task TEXT NOT NULL, event_id INTEGER NOT NULL,"
    "  workspace_revision TEXT NOT NULL, state_hash TEXT NOT NULL);"
    "CREATE TABLE IF NOT EXISTS work_files("
    "  revision TEXT NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL,"
    "  PRIMARY KEY(revision,path));"
    "CREATE INDEX IF NOT EXISTS idx_work_files_revision "
    "ON work_files(revision);"
    "CREATE TABLE IF NOT EXISTS work_evidence("
    "  id INTEGER PRIMARY KEY, created INTEGER NOT NULL,task TEXT NOT NULL,"
    "  criterion TEXT NOT NULL,evidence TEXT NOT NULL,source TEXT NOT NULL);"
    "CREATE INDEX IF NOT EXISTS idx_work_evidence_task "
    "ON work_evidence(task,criterion,created);"
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
    "  body, tokenize='unicode61');"
    /* codify-v15 3.1: one row per projection build — the fold of every
     * active branch onto the base (projection.c). Durable: never dropped
     * by a schema upgrade. branches and conflicts are JSON arrays. */
    "CREATE TABLE IF NOT EXISTS projections("
    "  id INTEGER PRIMARY KEY, built INTEGER NOT NULL, base TEXT,"
    "  base_head TEXT, commit_id TEXT, fingerprint TEXT, branches TEXT,"
    "  conflicts TEXT, ms INTEGER);"
    /* codify-v15 1.2 */
    /* cg files: name_words(path) under trigram, rowid = files.id, so
     * "sync gate" finds syncgate.c and sync_gate.py alike */
    "CREATE VIRTUAL TABLE IF NOT EXISTS file_fts USING fts5("
    "  words, tokenize='trigram');"
    /* codify-v15 1.1: trigram candidates for cg grep. Contentless (cg grep
     * reads its hits from disk) and detail=none (it asks for each trigram
     * alone, never a phrase), so it costs a fraction of body_fts. rowid is
     * files.id. SQLite before 3.43 has no contentless_delete: cg_open makes
     * the content-bearing form first and this line is then a no-op. */
    "CREATE VIRTUAL TABLE IF NOT EXISTS body_tri USING fts5("
    "  body, content='', contentless_delete=1, detail=none,"
    "  tokenize='trigram');"
    /* codify-v15 3.2: what projection builds found (conflicts.c), one row
     * per kind, path, symbol, and branch set (sorted, comma-joined).
     * resolved is NULL while a build still finds it, else when one stopped;
     * stamp is the build that last saw it. Durable: never dropped. */
    "CREATE TABLE IF NOT EXISTS projection_findings("
    "  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, path TEXT NOT NULL,"
    "  symbol TEXT NOT NULL DEFAULT '', branches TEXT NOT NULL,"
    "  lines TEXT, agents TEXT, advice TEXT, changer TEXT,"
    "  first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,"
    "  resolved INTEGER, stamp INTEGER NOT NULL DEFAULT 0,"
    "  steered INTEGER NOT NULL DEFAULT 0,"
    "  UNIQUE(kind, path, symbol, branches));";

/* codify-v15 1.1: the body_tri an SQLite before 3.43 can build (it cannot
 * delete from a contentless table) is created before SCHEMA runs, so
 * SCHEMA's IF NOT EXISTS skips the form it would reject. Answers the meta
 * fts_mode that implies. */
static const char *body_tri_compat(sqlite3 *db) {
    if (sqlite3_libversion_number() >= 3043000) return "contentless";
    sqlite3_exec(db, "CREATE VIRTUAL TABLE IF NOT EXISTS body_tri USING "
                     "fts5(body, detail=none, tokenize='trigram')",
                 NULL, NULL, NULL);
    return "content";
}

/* the schema above, as stored in meta.schema_version */
#define SCHEMA_VERSION "18"

/* codify-v15 1.3: idx_file_base and idx_import_target are created in
 * cg_open after the upgrade — a v17 files table has no base column */
static int db_fts_create(Cg *cg);       /* codify-v15 1.3, below */

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

/* `.git` as a regular file marks a linked worktree (or a submodule); a
 * directory is the main worktree's own repository. */
static bool git_file_at(const char *dir) {
    char p[4600];
    struct stat st;
    snprintf(p, sizeof p, "%s/.git", dir);
    return stat(p, &st) == 0 && S_ISREG(st.st_mode);
}

int cg_find_project_at(const char *start, char *root, char *shared,
                       size_t cap) {
    const char *ov = getenv("CODIFY_ROOT");
    if (ov && ov[0]) {                       /* explicit override wins */
        if (!is_project_dir(ov)) return -1;
        snprintf(root, cap, "%s", ov);
        snprintf(shared, cap, "%s", ov);
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
            snprintf(root, cap, "%s", cwd);
            snprintf(shared, cap, "%s", cwd);
            return 0;
        }
        /* A linked worktree stops the walk like any .git does, but its main
         * worktree may be an initialized project: then this tree joins it,
         * its files indexed under their own branch into the shared graph.
         * Nothing is spawned — git's own worktree files name the main. */
        if (git_file_at(cwd)) {
            char main[4096];
            if (git_worktree_main(cwd, main, sizeof main) &&
                is_project_dir(main)) {
                snprintf(root, cap, "%s", cwd);
                snprintf(shared, cap, "%s", main);
                return 0;
            }
            return -1;
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

int cg_find_root_at(const char *start, char *out, size_t cap) {
    char root[4096];
    return cg_find_project_at(start, root, out, cap);
}

int cg_find_root(char *out, size_t cap) {
    char cwd[4096];
    if (!getcwd(cwd, sizeof cwd)) return -1;
    return cg_find_root_at(cwd, out, cap);
}

void cg_bkey(const Cg *cg, const char *name, char *out, size_t cap) {
    snprintf(out, cap, "%s:%ld", name, cg->branch_id);
}

/* Report which project cg binds to here. The whole class of "it silently used
 * an ancestor" confusion is one command away from being diagnosed. */
int cmd_root(bool json) {
    char cwd[4096], root[4096], shared[4096];
    if (!getcwd(cwd, sizeof cwd) ||
        cg_find_project_at(cwd, root, shared, sizeof root) != 0) {
        if (json) printf("{\"root\":null}\n");
        else fprintf(stderr, "cg: no Codify project here or in any parent "
                             "directory (run `cg init`)\n");
        return 1;
    }
    if (json) {
        char branch[256], sha[65];
        bool git = git_head(root, branch, sizeof branch, sha, sizeof sha);
        StrBuf b; sb_init(&b);
        sb_puts(&b, "{\"root\":");
        sb_json_str(&b, root);
        sb_puts(&b, ",\"shared\":");
        sb_json_str(&b, shared);
        sb_printf(&b, ",\"worktree\":%s,\"branch\":",
                  strcmp(root, shared) ? "true" : "false");
        if (git) sb_json_str(&b, branch); else sb_puts(&b, "null");
        sb_puts(&b, "}\n");
        fputs(b.p, stdout);
        sb_free(&b);
    } else {
        /* the tree, not the shared project: scripts cd here and build
         * file paths from it */
        printf("%s\n", root);
    }
    return 0;
}

int cg_open(Cg *cg, bool create) {
    memset(cg, 0, sizeof *cg);
    if (create) {
        if (!getcwd(cg->root, sizeof cg->root)) return -1;
        snprintf(cg->shared, sizeof cg->shared, "%s", cg->root);
        char p[4600];
        snprintf(p, sizeof p, "%s/%s", cg->root, CG_OBJECTS);
        if (mkdirs(p) != 0) {
            fprintf(stderr, "cg: cannot create %s\n", p);
            return -1;
        }
    } else {
        char cwd[4096];
        if (!getcwd(cwd, sizeof cwd) ||
            cg_find_project_at(cwd, cg->root, cg->shared,
                               sizeof cg->root) != 0) {
            fprintf(stderr, "cg: not inside a Codify project (run `cg init`)\n");
            return -1;
        }
    }
    cg->worktree = strcmp(cg->root, cg->shared) != 0;
    char dbpath[4600];
    snprintf(dbpath, sizeof dbpath, "%s/%s", cg->shared, CG_DB);
    if (sqlite3_open(dbpath, &cg->db) != SQLITE_OK) {
        fprintf(stderr, "cg: cannot open %s: %s\n", dbpath, sqlite3_errmsg(cg->db));
        return -1;
    }
    /* WAL lets readers run while one writer indexes, and the busy timeout
     * makes concurrent cg processes wait instead of failing outright. The
     * wait is long on purpose: an agent's lifecycle command must outlast an
     * editor language server re-indexing the whole tree. CG_BUSY_TIMEOUT_MS
     * overrides it (tests use a short one). */
    cg->lock_wait_ms = cg_lock_wait_default();
    sqlite3_busy_timeout(cg->db, (int)cg->lock_wait_ms);
    sqlite3_exec(cg->db, "PRAGMA journal_mode=WAL;PRAGMA synchronous=NORMAL",
                 NULL, NULL, NULL);
    char *err = NULL;
    body_tri_compat(cg->db);
    if (sqlite3_exec(cg->db, SCHEMA, NULL, NULL, &err) != SQLITE_OK) {
        fprintf(stderr, "cg: schema: %s\n", err ? err : "?");
        sqlite3_free(err);
        return -1;
    }
    if (cg_schema_upgrade(cg) != 0) return -1;
    if (sem_schema_init(cg) != 0) return -1;
    if (db_fts_create(cg) != 0) return -1;
    /* callers, reference counts and dependents all ask "who resolved to
     * this symbol": without it each such question scans every ref. Created
     * after the upgrade, since a pre-target_id refs table would refuse it. */
    sqlite3_exec(cg->db,
        "CREATE INDEX IF NOT EXISTS idx_ref_target ON refs(target_id)",
        NULL, NULL, NULL);
    /* codify-v15 1.3: lookups by file name (soft edges, the resolver),
     * which used to scan every path with LIKE '%/'||name, and the imports
     * a changed file is the target of */
    sqlite3_exec(cg->db,
        "CREATE INDEX IF NOT EXISTS idx_file_base ON files(base, branch_id);"
        "CREATE INDEX IF NOT EXISTS idx_import_target ON imports(target_file_id)",
        NULL, NULL, NULL);
    /* The freshness preflight only needs legacy rows. Keep its lookup
     * proportional to those rows, rather than all files on the branch. */
    if (sqlite3_exec(cg->db,
            "CREATE INDEX IF NOT EXISTS idx_file_legacy_time "
            "ON files(branch_id) WHERE mtime_ns IS NULL",
            NULL, NULL, NULL) != SQLITE_OK) {
        fprintf(stderr, "cg: cannot create legacy timestamp index: %s\n",
                sqlite3_errmsg(cg->db));
        return -1;
    }
    events_install(cg);
    /* a branch never seen before is registered here, so the first cg call
     * from a fresh worktree needs one small write; a busy database leaves
     * branch_id 0 and the indexer retries before it writes rows */
    cg_branch_resolve(cg);
    /* writes a busy database queued (journal.c) are applied by the first
     * process to find the lock free — a probe, never a wait, so opening a
     * project for a read never queues behind an indexer */
    journal_replay(cg, JOURNAL_PROBE);
    return 0;
}

/* codify-v15 1.3. A contentless body index stores the words of every file
 * but not the file again: the text is on disk, and snippets and matching
 * lines are read from there (rank_bodies). It needs SQLite 3.43.0 for
 * contentless_delete; an older library keeps today's content-bearing table.
 * The mode is recorded in meta.fts_mode when the table is created and read
 * on every open afterwards, so a database is always used in the mode it
 * was built with — never re-guessed from whichever library opened it. */
#define FTS_CONTENTLESS_MIN 3043000

static char *fts_mode_read(Cg *cg) {
    sqlite3_stmt *st = NULL;
    char *out = NULL;
    if (sqlite3_prepare_v2(cg->db, "SELECT value FROM meta WHERE key='fts_mode'",
                           -1, &st, NULL) != SQLITE_OK)
        return NULL;
    if (sqlite3_step(st) == SQLITE_ROW && sqlite3_column_text(st, 0))
        out = xstrdup((const char *)sqlite3_column_text(st, 0));
    sqlite3_finalize(st);
    return out;
}

bool db_fts_contentless(Cg *cg) {
    char *m = fts_mode_read(cg);
    bool c = m && strcmp(m, "contentless") == 0;
    free(m);
    return c;
}

/* 0 absent, 1 present, 2 present and contentless (read from its DDL, for a
 * table whose fts_mode row a busy database kept from being written) */
static int body_fts_state(Cg *cg) {
    sqlite3_stmt *st = NULL;
    int state = 0;
    if (sqlite3_prepare_v2(cg->db,
            "SELECT sql LIKE '%contentless_delete%' FROM sqlite_master "
            "WHERE name='body_fts'", -1, &st, NULL) != SQLITE_OK)
        return 0;
    if (sqlite3_step(st) == SQLITE_ROW)
        state = sqlite3_column_int(st, 0) ? 2 : 1;
    sqlite3_finalize(st);
    return state;
}

static int db_fts_create(Cg *cg) {
    char *mode = fts_mode_read(cg);
    int state = body_fts_state(cg);
    bool exists = state > 0;
    bool contentless;
    /* an existing table's DDL is the truth: a database stamped by a build
     * whose SCHEMA still created body_fts carries a content-bearing table
     * under a "contentless" meta row, and must be used as what it is */
    if (exists) {
        contentless = state == 2;
    } else if (mode) {
        contentless = strcmp(mode, "contentless") == 0;
    } else {
        contentless = sqlite3_libversion_number() >= FTS_CONTENTLESS_MIN;
    }
    if (contentless && sqlite3_libversion_number() < FTS_CONTENTLESS_MIN) {
        fprintf(stderr,
            "cg: %s/%s keeps a contentless body index, which needs SQLite "
            "3.43.0 or newer; this cg links SQLite %s.\n", cg->shared, CG_DB,
            sqlite3_libversion());
        free(mode);
        return -1;
    }
    if (!exists) {
        char *err = NULL;
        const char *sql = contentless
            ? "CREATE VIRTUAL TABLE IF NOT EXISTS body_fts USING fts5("
              "  path UNINDEXED, body, tokenize='unicode61',"
              "  content='', contentless_delete=1)"
            : "CREATE VIRTUAL TABLE IF NOT EXISTS body_fts USING fts5("
              "  path UNINDEXED, body, tokenize='unicode61')";
        if (sqlite3_exec(cg->db, sql, NULL, NULL, &err) != SQLITE_OK) {
            fprintf(stderr, "cg: schema: %s\n", err ? err : "?");
            sqlite3_free(err);
            free(mode);
            return -1;
        }
    }
    if (!mode || (strcmp(mode, "contentless") == 0) != contentless)
        cg_meta_set(cg, "fts_mode", contentless ? "contentless" : "content");
    free(mode);
    return 0;
}

/* Derived tables (everything the indexer rebuilds from source) are dropped
 * and recreated on every schema_version mismatch — even with an empty files
 * table, an old DB may carry the old refs shape. Agent memory, git history,
 * leases, attempts, runtime events, and the branch and agent registries are
 * never touched: they are durable state a version bump must not destroy.
 * The DROPs are IF EXISTS, a no-op on a fresh DB. Per-branch freshness
 * marks go with the rows they described, so the next sync walks. */
int cg_schema_upgrade(Cg *cg) {
    char *ver = cg_meta_get(cg, "schema_version");
    bool current = ver && strcmp(ver, SCHEMA_VERSION) == 0;
    /* An older cg (an editor's or MCP server's installed binary) must never
     * "upgrade" a newer database: it would drop the graph, a newer cg would
     * rebuild it, and the two would take turns re-indexing the whole tree
     * on every open. Refuse, and name the fix. */
    long stored = ver ? atol(ver) : 0;
    free(ver);
    /* v18 (codify-v15 2.2, 2.4): native agents widen the durable agents
     * table in place, every existing row kept; a column already there is
     * skipped. This runs on every open, before the version check: a DB
     * stamped v18 by a build that predates these columns is otherwise
     * stuck at "the graph predates native agents" with nothing to run. */
    static const char *V18[][2] = {
        {"kind", "TEXT"}, {"host_kind", "TEXT"}, {"agent_id", "TEXT"},
        {"agent_type", "TEXT"}, {"description", "TEXT"}, {"model", "TEXT"},
        {"depth", "INTEGER"}, {"state", "TEXT"}, {"started", "INTEGER"},
        {"ended", "INTEGER"}, {"transcript", "TEXT"}, {"cwd", "TEXT"},
        {"task", "TEXT"}, {"task_source", "TEXT"}, {"last_tool", "TEXT"},
        {"tool_calls", "INTEGER"}, {"discovered", "TEXT"},
    };
    for (size_t i = 0; i < sizeof V18 / sizeof *V18; i++) {
        sqlite3_stmt *q = NULL;
        bool have = false;
        if (sqlite3_prepare_v2(cg->db, "SELECT 1 FROM pragma_table_info("
                               "'agents') WHERE name=?", -1, &q, NULL)
            == SQLITE_OK) {
            sqlite3_bind_text(q, 1, V18[i][0], -1, SQLITE_STATIC);
            have = sqlite3_step(q) == SQLITE_ROW;
            sqlite3_finalize(q);
        }
        if (have) continue;
        char sql[128];
        snprintf(sql, sizeof sql, "ALTER TABLE agents ADD COLUMN %s %s",
                 V18[i][0], V18[i][1]);
        sqlite3_exec(cg->db, sql, NULL, NULL, NULL);
    }
    /* codify-v15 1.3: files.base (the last path segment, behind
     * idx_file_base) joined the derived files table within schema v18. A
     * database stamped v18 before that has the table without the column;
     * widening it here and filling it from path spares the rebuild a version
     * bump would cost, and the index in cg_open then applies. */
    {
        sqlite3_stmt *q = NULL;
        bool have = true;
        if (sqlite3_prepare_v2(cg->db, "SELECT 1 FROM pragma_table_info("
                               "'files') WHERE name='base'", -1, &q, NULL)
            == SQLITE_OK) {
            have = sqlite3_step(q) == SQLITE_ROW;
            sqlite3_finalize(q);
        }
        if (!have)
            sqlite3_exec(cg->db,
                "ALTER TABLE files ADD COLUMN base TEXT;"
                "UPDATE files SET base = replace(path, rtrim(path, "
                "replace(path, '/', '')), '')", NULL, NULL, NULL);
    }
    /* NULL marks legacy rows: a first walk must verify their content before
     * trusting metadata. Do not backfill nanoseconds from whole seconds. */
    {
        sqlite3_stmt *q = NULL;
        bool have = true;
        if (sqlite3_prepare_v2(cg->db, "SELECT 1 FROM pragma_table_info("
                               "'files') WHERE name='mtime_ns'", -1, &q, NULL)
            == SQLITE_OK) {
            have = sqlite3_step(q) == SQLITE_ROW;
            sqlite3_finalize(q);
        }
        if (!have && sqlite3_exec(cg->db,
                "ALTER TABLE files ADD COLUMN mtime_ns INTEGER",
                NULL, NULL, NULL) != SQLITE_OK) return -1;
    }
    if (current) return 0;
    if (stored > atol(SCHEMA_VERSION)) {
        fprintf(stderr,
            "cg: %s/%s is schema v%ld, but this cg (%s) only knows v%s.\n"
            "    A newer cg indexed it — install that build (make install) "
            "or run it from its tree.\n",
            cg->shared, CG_DB, stored, CG_VERSION, SCHEMA_VERSION);
        return -1;
    }
    /* v14 separates semantic event identity from occurrence identity. Ignore
     * duplicate-column errors on fresh databases where SCHEMA already owns
     * the current shape. */
    sqlite3_exec(cg->db,
        "ALTER TABLE runtime_events ADD COLUMN semantic_fingerprint TEXT",
        NULL, NULL, NULL);
    sqlite3_exec(cg->db,
        "UPDATE runtime_events SET semantic_fingerprint=fingerprint "
        "WHERE semantic_fingerprint IS NULL", NULL, NULL, NULL);
    /* v16 widens two durable tables in place: attempts learn the branch a
     * fleet worker runs on, memories learn their branch and Jev's class.
     * Same duplicate-column tolerance as above. */
    static const char *V16[] = {
        "ALTER TABLE attempts ADD COLUMN branch TEXT",
        "ALTER TABLE attempts ADD COLUMN worktree TEXT",
        "ALTER TABLE attempts ADD COLUMN parent TEXT",
        "ALTER TABLE memories ADD COLUMN branch TEXT",
        "ALTER TABLE memories ADD COLUMN class TEXT",
        "ALTER TABLE memories ADD COLUMN confidence REAL",
    };
    for (size_t i = 0; i < sizeof V16 / sizeof *V16; i++)
        sqlite3_exec(cg->db, V16[i], NULL, NULL, NULL);
    /* meta rows mean an existing project DB, not a freshly created one */
    long nmeta = 0;
    sqlite3_stmt *st = NULL;
    if (sqlite3_prepare_v2(cg->db, "SELECT COUNT(*) FROM meta", -1, &st,
                           NULL) == SQLITE_OK) {
        if (sqlite3_step(st) == SQLITE_ROW) nmeta = sqlite3_column_int64(st, 0);
        sqlite3_finalize(st);
    }
    static const char *DROPS =
        "DROP TABLE IF EXISTS semantic_identifier_postings;"
        "DROP TABLE IF EXISTS semantic_dependencies;"
        "DROP TABLE IF EXISTS semantic_edges;"
        "DROP TABLE IF EXISTS semantic_type_facts;"
        "DROP TABLE IF EXISTS semantic_bindings;"
        "DROP TABLE IF EXISTS semantic_references;"
        "DROP TABLE IF EXISTS semantic_symbols;"
        "DROP TABLE IF EXISTS files;DROP TABLE IF EXISTS symbols;"
        "DROP TABLE IF EXISTS refs;DROP TABLE IF EXISTS routes;"
        "DROP TABLE IF EXISTS imports;DROP TABLE IF EXISTS symbol_fts;"
        "DROP TABLE IF EXISTS body_fts;DROP TABLE IF EXISTS comments;"
        "DROP TABLE IF EXISTS comment_fts;"
        "DROP TABLE IF EXISTS file_fts;"
        "DROP TABLE IF EXISTS body_tri;"
        "DELETE FROM meta WHERE key='fts_mode';"
        "DELETE FROM meta WHERE key LIKE 'last_index_%' OR key LIKE 'walk_%' "
        "OR key LIKE 'project_files%' OR key LIKE 'index_pending_resolve%';";
    char *err = NULL;
    if (sqlite3_exec(cg->db, DROPS, NULL, NULL, &err) != SQLITE_OK ||
        !body_tri_compat(cg->db) ||          /* codify-v15 1.1 */
        sqlite3_exec(cg->db, SCHEMA, NULL, NULL, &err) != SQLITE_OK) {
        fprintf(stderr, "cg: schema upgrade: %s\n", err ? err : "?");
        sqlite3_free(err);
        return -1;
    }
    if (nmeta > 0)
        fprintf(stderr, "cg: schema upgraded to v%s — run 'cg sync' to "
                        "rebuild the graph\n", SCHEMA_VERSION);
    cg_meta_set(cg, "schema_version", SCHEMA_VERSION);
    /* codify-v15 1.1: which body_tri form this SQLite built */
    cg_meta_set(cg, "fts_mode", body_tri_compat(cg->db));
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

static bool busy_rc(int rc) {
    int base = rc & 0xff;
    return base == SQLITE_BUSY || base == SQLITE_LOCKED;
}

static const char *g_busy_why;

void cg_busy_why(const char *why) { g_busy_why = why; }

/* Lifecycle writes (memories, events, lease releases, handoffs) never get
 * here: they are journaled instead. What does get here is a write that must
 * see the current state to be correct, so the message says why it was not
 * queued — an agent should retry it, not wait for a replay. */
void cg_busy_report(const char *what) {
    fprintf(stderr,
        "cg: the graph database is busy — another cg process (usually an "
        "editor's `cg lsp`, `cg watch`, or a parallel agent) held the write "
        "lock for the whole wait.\n"
        "    %s was not applied; nothing changed. Re-run the same command — "
        "it is safe to retry.\n"
        "    This write is not journaled: %s.\n"
        "    (waited %ldms; set CG_BUSY_TIMEOUT_MS to wait longer)\n",
        what && what[0] ? what : "The write",
        g_busy_why ? g_busy_why
                   : "it must see the current state of the database to be "
                     "correct, so it cannot be queued for later",
        cg_lock_wait_default());
}

long cg_lock_wait_default(void) {
    const char *env = getenv("CG_BUSY_TIMEOUT_MS");
    long ms = env && env[0] ? atol(env) : 30000;
    return ms > 0 ? ms : 30000;
}

int cg_begin_write(Cg *cg) {
    /* Both bounds matter: the busy handler polls with growing sleeps, so a
     * short wait would return early and a long one would stall a server. */
    long wait = cg->lock_wait_ms > 0 ? cg->lock_wait_ms : cg_lock_wait_default();
    sqlite3_busy_timeout(cg->db, (int)wait);
    char *err = NULL;
    int rc = sqlite3_exec(cg->db, "BEGIN IMMEDIATE", NULL, NULL, &err);
    sqlite3_busy_timeout(cg->db, (int)cg_lock_wait_default());
    /* holding the lock: queued writes go in first, each committed on its
     * own, and the caller gets a fresh transaction after them */
    if (rc == SQLITE_OK) return journal_replay(cg, JOURNAL_HELD) < 0 ? -1 : 0;
    if (busy_rc(rc)) { sqlite3_free(err); return -1; }
    fprintf(stderr, "cg: sql error: %s\n  in: BEGIN IMMEDIATE\n", err ? err : "?");
    sqlite3_free(err);
    exit(2);
}

/* A busy database is not a bug in the command that hit it. Say so, and exit
 * with a status an agent can read as "retry", not "broken" — a bare
 * "database is locked" sends agents off to debug SQLite instead of finishing
 * their task. */
void cg_exec(Cg *cg, const char *sql) {
    char *err = NULL;
    int rc = sqlite3_exec(cg->db, sql, NULL, NULL, &err);
    if (rc == SQLITE_OK) return;
    if (busy_rc(rc)) {
        sqlite3_free(err);
        cg_busy_report("This command");
        exit(CG_EXIT_BUSY);
    }
    fprintf(stderr, "cg: sql error: %s\n  in: %s\n", err ? err : "?", sql);
    sqlite3_free(err);
    exit(2);
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
