/*
 * Git interop. Codify keeps its own snapshots, but every real repository also
 * has git — so read it rather than ignore it. History is ingested by piping
 * git(1) (no libgit2, no new link-time dependency), and the resulting churn
 * becomes a ranking signal for search and context.
 *
 * Everything here degrades to a no-op when the project has no git repository.
 */
#include "cg.h"
#include <unistd.h>
#include <sys/stat.h>
#include <sys/wait.h>

bool git_available(const Cg *cg) {
    char p[4600];
    struct stat st;
    snprintf(p, sizeof p, "%s/.git", cg->root);
    if (stat(p, &st) != 0) return false;
    return system("git --version >/dev/null 2>&1") == 0;
}

/* Read `git log` in one pass: a header line per commit, then the paths it
 * touched. --no-renames keeps paths comparable with the graph's own. The
 * import is one BEGIN IMMEDIATE transaction: taken up front, or reported
 * busy, never upgraded mid-way. */
int cmd_git_sync(Cg *cg, int limit, bool json) {
    if (!git_available(cg)) {
        if (json) printf("{\"git\":false,\"commits\":0,\"paths\":0}\n");
        else printf("no git repository here — nothing to ingest\n");
        return 0;
    }
    StrBuf cmd; sb_init(&cmd);
    sb_printf(&cmd,
        "git -C '%s' log --no-merges --no-renames -n %d "
        "--pretty=format:'\x01%%H\t%%an\t%%at\t%%s' --name-only 2>/dev/null",
        cg->root, limit);
    FILE *f = popen(cmd.p, "r");
    sb_free(&cmd);
    if (!f) {
        fprintf(stderr, "cg: cannot run git\n");
        return 1;
    }

    cg_exec(cg, "BEGIN IMMEDIATE");
    sqlite3_stmt *ins = cg_prep(cg,
        "INSERT INTO git_commits(hash,author,date,subject) VALUES(?,?,?,?) "
        "ON CONFLICT(hash) DO NOTHING");
    sqlite3_stmt *chu = cg_prep(cg,
        "INSERT INTO git_churn(path,hash) VALUES(?,?) "
        "ON CONFLICT(path,hash) DO NOTHING");

    char *line = NULL;
    size_t cap = 0;
    ssize_t n;
    char cur[65] = "";
    long ncommits = 0, npaths = 0, seen = 0;
    while ((n = getline(&line, &cap, f)) > 0) {
        while (n > 0 && (line[n-1] == '\n' || line[n-1] == '\r')) line[--n] = 0;
        if (n == 0) continue;
        if (line[0] == '\x01') {                     /* commit header */
            char *h = line + 1;
            char *a = strchr(h, '\t');   if (!a) continue; *a++ = 0;
            char *d = strchr(a, '\t');   if (!d) continue; *d++ = 0;
            char *s = strchr(d, '\t');   if (!s) continue; *s++ = 0;
            snprintf(cur, sizeof cur, "%s", h);
            sqlite3_reset(ins);
            sqlite3_bind_text(ins, 1, h, -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(ins, 2, a, -1, SQLITE_TRANSIENT);
            sqlite3_bind_int64(ins, 3, atol(d));
            sqlite3_bind_text(ins, 4, s, -1, SQLITE_TRANSIENT);
            seen++;
            /* ON CONFLICT DO NOTHING still reports DONE, so count real
             * insertions — that is what makes re-running a cheap no-op */
            if (sqlite3_step(ins) == SQLITE_DONE && sqlite3_changes(cg->db))
                ncommits++;
        } else if (cur[0]) {                         /* a touched path */
            sqlite3_reset(chu);
            sqlite3_bind_text(chu, 1, line, -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(chu, 2, cur, -1, SQLITE_TRANSIENT);
            if (sqlite3_step(chu) == SQLITE_DONE && sqlite3_changes(cg->db))
                npaths++;
        }
    }
    free(line);
    sqlite3_finalize(ins);
    sqlite3_finalize(chu);
    cg_exec(cg, "COMMIT");
    pclose(f);

    if (json)
        printf("{\"git\":true,\"commits\":%ld,\"paths\":%ld,\"scanned\":%ld}\n",
               ncommits, npaths, seen);
    else if (ncommits)
        printf("git-sync: %ld new commits, %ld file touches (%ld scanned)\n",
               ncommits, npaths, seen);
    else
        printf("git-sync: up to date (%ld commits scanned)\n", seen);
    return 0;
}

/* How often a path has changed. Frequently-edited code is where work happens,
 * so this lifts live code above dead code in otherwise-equal matches. */
int git_churn_for_path(Cg *cg, const char *path) {
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT COUNT(*) FROM git_churn WHERE path=?");
    sqlite3_bind_text(st, 1, path, -1, SQLITE_STATIC);
    int n = 0;
    if (sqlite3_step(st) == SQLITE_ROW) n = sqlite3_column_int(st, 0);
    sqlite3_finalize(st);
    return n;
}

/* Mirror a Codify snapshot into a real git commit carrying the same spec tag,
 * so a team using git sees the same attribution Codify records. */
int git_commit_mirror(Cg *cg, const char *message) {
    if (!git_available(cg)) {
        fprintf(stderr, "cg: --git needs a git repository at %s\n", cg->root);
        return 1;
    }
    StrBuf c; sb_init(&c);
    sb_printf(&c, "git -C '%s' add -A", cg->root);
    int rc = system(c.p);
    sb_free(&c);
    if (rc != 0) { fprintf(stderr, "cg: git add failed\n"); return 1; }

    StrBuf m; sb_init(&m);
    for (const char *p = message; *p; p++) {         /* single-quote safe */
        if (*p == '\'') sb_puts(&m, "'\\''");
        else sb_putc(&m, *p);
    }
    sb_init(&c);
    sb_printf(&c, "git -C '%s' commit -q -m '%s'", cg->root, m.p);
    rc = system(c.p);
    sb_free(&c);
    sb_free(&m);
    if (rc != 0) {
        fprintf(stderr, "cg: git commit failed (nothing staged?)\n");
        return 1;
    }
    printf("git: committed\n");
    return 0;
}
