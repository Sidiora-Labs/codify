/*
 * Git interop. Codify keeps its own snapshots, but every real repository also
 * has git — so read it rather than ignore it. History is ingested by piping
 * git(1) (no libgit2, no new link-time dependency), and the resulting churn
 * becomes a ranking signal for search and context.
 *
 * Branch identity is read from git's own files (HEAD, refs, packed-refs,
 * the worktree's gitdir and commondir) without spawning anything: every cg
 * process resolves its branch at open, and a fleet runs thousands of opens.
 * The branches registry maps those names to the ids file rows are scoped by.
 *
 * Everything here degrades to a no-op when the project has no git repository.
 */
#include "cg.h"
#include <time.h>
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

/* ---------------- branch identity without spawning git ---------------- */

/* strip one trailing newline family; returns s */
static char *chomp(char *s) {
    size_t n = strlen(s);
    while (n > 0 && (s[n - 1] == '\n' || s[n - 1] == '\r' || s[n - 1] == ' '))
        s[--n] = 0;
    return s;
}

/* a path written by git, absolute or relative to `base`, made absolute
 * and normalised (realpath), into out. false when it does not exist */
static bool git_abs(const char *base, const char *p, char *out, size_t cap) {
    char joined[8300];
    if (p[0] == '/') snprintf(joined, sizeof joined, "%s", p);
    else snprintf(joined, sizeof joined, "%s/%s", base, p);
    char *r = realpath(joined, NULL);
    if (!r) return false;
    snprintf(out, cap, "%s", r);
    free(r);
    return true;
}

/* tree's own git directory (.git itself, or what a .git file points at)
 * and the common directory that holds refs and objects. In the main
 * worktree the two are the same. false when tree has no .git. */
static bool git_dirs(const char *tree, char *gitdir, char *common, size_t cap) {
    char p[4600];
    struct stat st;
    snprintf(p, sizeof p, "%s/.git", tree);
    if (stat(p, &st) != 0) return false;
    if (S_ISDIR(st.st_mode)) {
        size_t n = strlen(p);
        if (n >= cap) return false;
        memcpy(gitdir, p, n + 1);
        memcpy(common, p, n + 1);
        return true;
    }
    char *s = read_entire_file(p, NULL);
    if (!s) return false;
    chomp(s);
    bool ok = strncmp(s, "gitdir: ", 8) == 0 &&
              git_abs(tree, s + 8, gitdir, cap);
    free(s);
    if (!ok) return false;
    /* a linked worktree's gitdir carries `commondir`, relative to itself */
    snprintf(p, sizeof p, "%s/commondir", gitdir);
    s = read_entire_file(p, NULL);
    if (s) {
        chomp(s);
        ok = git_abs(gitdir, s, common, cap);
        free(s);
        return ok;
    }
    snprintf(common, cap, "%s", gitdir);
    return true;
}

bool git_worktree_main(const char *tree, char *main_out, size_t cap) {
    char gitdir[4096], common[4096];
    if (!git_dirs(tree, gitdir, common, sizeof gitdir)) return false;
    if (strcmp(gitdir, common) == 0) return false;   /* not linked */
    /* the common dir is <main>/.git; anything else (a bare repository,
     * GIT_DIR games) has no main worktree to join */
    size_t n = strlen(common);
    if (n < 5 || strcmp(common + n - 5, "/.git") != 0) return false;
    snprintf(main_out, cap, "%.*s", (int)(n - 5), common);
    return main_out[0] != 0;
}

/* the commit a ref names: loose file first, then packed-refs */
static bool git_ref_sha(const char *common, const char *ref, char *sha,
                        size_t cap) {
    char p[4700];
    snprintf(p, sizeof p, "%s/%s", common, ref);
    char *s = read_entire_file(p, NULL);
    if (s) {
        chomp(s);
        bool ok = strlen(s) >= 40;
        if (ok) snprintf(sha, cap, "%.40s", s);
        free(s);
        if (ok) return true;
    }
    snprintf(p, sizeof p, "%s/packed-refs", common);
    s = read_entire_file(p, NULL);
    if (!s) return false;
    bool found = false;
    size_t rl = strlen(ref);
    for (char *line = s; line && *line && !found; ) {
        char *e = strchr(line, '\n');
        if (e) *e = 0;
        if (line[0] != '#' && line[0] != '^' && strlen(line) > 41 &&
            line[40] == ' ' && strcmp(line + 41, ref) == 0 && rl > 0) {
            snprintf(sha, cap, "%.40s", line);
            found = true;
        }
        line = e ? e + 1 : NULL;
    }
    free(s);
    return found;
}

bool git_head(const char *tree, char *branch, size_t bcap, char *sha,
              size_t scap) {
    branch[0] = 0;
    sha[0] = 0;
    char gitdir[4096], common[4096], p[4700];
    if (!git_dirs(tree, gitdir, common, sizeof gitdir)) return false;
    snprintf(p, sizeof p, "%s/HEAD", gitdir);
    char *s = read_entire_file(p, NULL);
    if (!s) return false;
    chomp(s);
    if (strncmp(s, "ref: ", 5) == 0) {
        const char *ref = s + 5;
        const char *name = strncmp(ref, "refs/heads/", 11) == 0 ? ref + 11 : ref;
        snprintf(branch, bcap, "%s", name);
        if (!git_ref_sha(common, ref, sha, scap)) sha[0] = 0;
    } else {
        snprintf(branch, bcap, "(detached)");
        if (strlen(s) >= 40) snprintf(sha, scap, "%.40s", s);
    }
    free(s);
    return true;
}

/* ---------------- spawning git (the lifecycle commands only) ---------------- */

int git_run(const char *tree, const char *args, StrBuf *out) {
    StrBuf cmd; sb_init(&cmd);
    sb_puts(&cmd, "git -C ");
    sb_shquote(&cmd, tree);
    sb_putc(&cmd, ' ');
    sb_puts(&cmd, args);
    sb_puts(&cmd, " 2>&1");
    FILE *f = popen(cmd.p, "r");
    sb_free(&cmd);
    if (!f) return -1;
    char buf[4097];
    size_t n;
    while ((n = fread(buf, 1, sizeof buf - 1, f)) > 0) {
        buf[n] = 0;
        if (out) sb_puts(out, buf);
    }
    int st = pclose(f);
    if (st == -1) return -1;
    if (WIFEXITED(st)) return WEXITSTATUS(st);
    return 128 + (WIFSIGNALED(st) ? WTERMSIG(st) : 0);
}

bool git_branch_exists(const char *tree, const char *branch) {
    StrBuf a; sb_init(&a);
    sb_puts(&a, "rev-parse --verify --quiet ");
    StrBuf ref; sb_init(&ref);
    sb_printf(&ref, "refs/heads/%s", branch);
    sb_shquote(&a, ref.p);
    sb_free(&ref);
    int rc = git_run(tree, a.p, NULL);
    sb_free(&a);
    return rc == 0;
}

int git_worktree_add(const char *tree, const char *path, const char *branch,
                     const char *base, bool *created, bool *branch_created,
                     StrBuf *err) {
    *created = false;
    *branch_created = false;
    struct stat st;
    char p[4600];
    snprintf(p, sizeof p, "%s/.git", path);
    if (stat(p, &st) == 0) return 0;                /* already a worktree */
    /* a stale registration (directory removed by hand) blocks `add` */
    git_run(tree, "worktree prune", NULL);
    bool have = git_branch_exists(tree, branch);
    StrBuf a; sb_init(&a);
    if (have) {
        sb_puts(&a, "worktree add ");
        sb_shquote(&a, path);
        sb_putc(&a, ' ');
        sb_shquote(&a, branch);
    } else {
        sb_puts(&a, "worktree add -b ");
        sb_shquote(&a, branch);
        sb_putc(&a, ' ');
        sb_shquote(&a, path);
        sb_putc(&a, ' ');
        sb_shquote(&a, base);
    }
    int rc = git_run(tree, a.p, err);
    sb_free(&a);
    if (rc != 0) return -1;
    *created = true;
    *branch_created = !have;
    return 0;
}

int git_conflicted_paths(const char *tree, char ***out) {
    *out = NULL;
    StrBuf o; sb_init(&o);
    if (git_run(tree, "diff --name-only --diff-filter=U", &o) != 0) {
        sb_free(&o);
        return 0;
    }
    int n = 0, cap = 0;
    for (char *line = o.p; line && *line; ) {
        char *e = strchr(line, '\n');
        if (e) *e = 0;
        if (*line) {
            if (n == cap) {
                cap = cap ? cap * 2 : 8;
                *out = xrealloc(*out, (size_t)cap * sizeof **out);
            }
            (*out)[n++] = xstrdup(line);
        }
        line = e ? e + 1 : NULL;
    }
    sb_free(&o);
    return n;
}

/* ---------------- branch registry ---------------- */

long branch_register(Cg *cg, const char *name, const char *worktree,
                     const char *head, const char *base) {
    sqlite3_stmt *st = cg_prep(cg,
        "INSERT INTO branches(name,worktree,head,base,updated) "
        "VALUES(?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET "
        "worktree=excluded.worktree,head=excluded.head,"
        "base=ifnull(excluded.base,branches.base),updated=excluded.updated");
    sqlite3_bind_text(st, 1, name, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, worktree, -1, SQLITE_TRANSIENT);
    if (head && head[0]) sqlite3_bind_text(st, 3, head, -1, SQLITE_TRANSIENT);
    else sqlite3_bind_null(st, 3);
    if (base && base[0]) sqlite3_bind_text(st, 4, base, -1, SQLITE_TRANSIENT);
    else sqlite3_bind_null(st, 4);
    sqlite3_bind_int64(st, 5, (long)time(NULL));
    bool ok = sqlite3_step(st) == SQLITE_DONE;
    sqlite3_finalize(st);
    if (!ok) return -1;
    st = cg_prep(cg, "SELECT id FROM branches WHERE name=?");
    sqlite3_bind_text(st, 1, name, -1, SQLITE_TRANSIENT);
    long id = sqlite3_step(st) == SQLITE_ROW ? (long)sqlite3_column_int64(st, 0)
                                             : -1;
    sqlite3_finalize(st);
    return id;
}

int cg_branch_resolve(Cg *cg) {
    if (!git_head(cg->root, cg->branch, sizeof cg->branch, cg->head,
                  sizeof cg->head))
        snprintf(cg->branch, sizeof cg->branch, "(none)");
    sqlite3_stmt *st = cg_prep(cg, "SELECT id FROM branches WHERE name=?");
    sqlite3_bind_text(st, 1, cg->branch, -1, SQLITE_STATIC);
    cg->branch_id = sqlite3_step(st) == SQLITE_ROW
                  ? (long)sqlite3_column_int64(st, 0) : 0;
    sqlite3_finalize(st);
    if (cg->branch_id > 0) return 0;
    long id = branch_register(cg, cg->branch, cg->root, cg->head, NULL);
    if (id <= 0) return -1;
    cg->branch_id = id;
    return 0;
}

static void ago(long since, char *out, size_t cap) {
    long d = (long)time(NULL) - since;
    if (d < 0) d = 0;
    if (d < 90) snprintf(out, cap, "%lds ago", d);
    else if (d < 5400) snprintf(out, cap, "%ldm ago", (d + 30) / 60);
    else if (d < 172800) snprintf(out, cap, "%ldh ago", (d + 1800) / 3600);
    else snprintf(out, cap, "%ldd ago", d / 86400);
}

/* cg branches: every branch the shared graph holds rows for, with the
 * worktree it was last indexed from. The current one is marked. */
int cmd_branches(Cg *cg, int argc, char **argv, bool json) {
    (void)argc; (void)argv;
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT b.id,b.name,ifnull(b.worktree,''),ifnull(b.head,''),"
        "ifnull(b.base,''),b.updated,"
        "(SELECT count(*) FROM files f WHERE f.branch_id=b.id) "
        "FROM branches b ORDER BY b.name");
    StrBuf b; sb_init(&b);
    if (json) {
        sb_puts(&b, "{\"current\":");
        sb_json_str(&b, cg->branch);
        sb_printf(&b, ",\"current_id\":%ld,\"root\":", cg->branch_id);
        sb_json_str(&b, cg->root);
        sb_puts(&b, ",\"shared\":");
        sb_json_str(&b, cg->shared);
        sb_puts(&b, ",\"branches\":[");
    }
    int n = 0;
    while (sqlite3_step(st) == SQLITE_ROW) {
        long id = (long)sqlite3_column_int64(st, 0);
        const char *name = (const char *)sqlite3_column_text(st, 1);
        const char *wt = (const char *)sqlite3_column_text(st, 2);
        const char *head = (const char *)sqlite3_column_text(st, 3);
        const char *base = (const char *)sqlite3_column_text(st, 4);
        long updated = (long)sqlite3_column_int64(st, 5);
        long files = (long)sqlite3_column_int64(st, 6);
        bool cur = id == cg->branch_id;
        if (json) {
            if (n) sb_putc(&b, ',');
            sb_printf(&b, "{\"id\":%ld,\"name\":", id);
            sb_json_str(&b, name);
            sb_puts(&b, ",\"worktree\":"); sb_json_str(&b, wt);
            sb_puts(&b, ",\"head\":");
            if (head[0]) sb_json_str(&b, head); else sb_puts(&b, "null");
            sb_puts(&b, ",\"base\":");
            if (base[0]) sb_json_str(&b, base); else sb_puts(&b, "null");
            sb_printf(&b, ",\"files\":%ld,\"updated\":%ld,\"current\":%s}",
                      files, updated, cur ? "true" : "false");
        } else {
            char when[32];
            ago(updated, when, sizeof when);
            sb_printf(&b, "%c %-28s %6ld files  %-8.8s %-40s %s", cur ? '*' : ' ',
                      name, files, head[0] ? head : "-", wt, when);
            if (base[0]) sb_printf(&b, "  base %s", base);
            sb_putc(&b, '\n');
        }
        n++;
    }
    sqlite3_finalize(st);
    if (json) sb_puts(&b, "]}\n");
    else if (!n) sb_puts(&b, "no branches indexed yet — run cg sync\n");
    fputs(b.p, stdout);
    sb_free(&b);
    return 0;
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
