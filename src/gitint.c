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
#include <ctype.h>
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

/* ---------------- git-assisted change detection (codify-v15 1.3) ------- */

/* stdout of `git -C tree <args>`, NUL bytes kept (the -z formats); stderr
 * dropped. Returns the exit status, -1 when git could not be run. */
static int git_capture_raw(const char *tree, const char *args, char **out,
                       size_t *len) {
    *out = NULL;
    *len = 0;
    StrBuf cmd; sb_init(&cmd);
    sb_puts(&cmd, "git -C ");
    sb_shquote(&cmd, tree);
    sb_printf(&cmd, " %s 2>/dev/null", args);
    FILE *f = popen(cmd.p, "r");
    sb_free(&cmd);
    if (!f) return -1;
    size_t cap = 65536, n = 0;
    char *buf = xmalloc(cap);
    size_t r;
    while ((r = fread(buf + n, 1, cap - n - 1, f)) > 0) {
        n += r;
        if (cap - n < 4096) { cap *= 2; buf = xrealloc(buf, cap); }
    }
    buf[n] = 0;
    int st = pclose(f);
    *out = buf;
    *len = n;
    if (st == -1) return -1;
    return WIFEXITED(st) ? WEXITSTATUS(st) : -1;
}

static void cand_push(char ***v, int *n, int *cap, const char *p, size_t len) {
    if (!len) return;
    if (*n == *cap) {
        *cap = *cap ? *cap * 2 : 64;
        *v = xrealloc(*v, sizeof **v * (size_t)*cap);
    }
    char *s = xmalloc(len + 1);
    memcpy(s, p, len);
    s[len] = 0;
    (*v)[(*n)++] = s;
}

/* Every path git can name as possibly different from the tree the last pass
 * indexed at commit `since`: whatever the work tree holds that HEAD does not
 * (status: modified, added, deleted, unmerged, untracked — each file, not
 * its directory), plus every path a commit between since and HEAD touched,
 * both sides of a rename. The status paths come first, *nstatus of them:
 * the caller keeps them, since a file dirty at one pass and reverted by the
 * next shows in neither list the second time. A path listed that did not in fact change costs
 * one hash; a path missing would be a stale graph, which is why anything
 * git cannot vouch for (an unknown commit, a failing git) is -1 and the
 * caller walks the tree instead. */
int walk_git_candidates(const char *root, const char *since, char ***out,
                        int *nstatus) {
    *out = NULL;
    *nstatus = 0;
    size_t sl = since ? strlen(since) : 0;
    if (sl < 7 || sl > 64) return -1;
    for (size_t i = 0; i < sl; i++)
        if (!isxdigit((unsigned char)since[i])) return -1;
    char **v = NULL;
    int n = 0, cap = 0;
    char *buf;
    size_t len;
    int rc = git_capture_raw(root, "-c core.quotepath=off status --porcelain=v2 -z "
                         "--untracked-files=all --no-renames --ignore-submodules=none",
                         &buf, &len);
    if (rc != 0) { free(buf); return -1; }
    /* porcelain v2 -z: one NUL-terminated record per entry; the path is the
     * last field, after a fixed number of space-separated ones; a rename
     * record ("2") is followed by its original path as one more record */
    for (size_t i = 0; i < len; ) {
        const char *rec = buf + i;
        size_t rl = strnlen(rec, len - i);
        int skip = rec[0] == '1' ? 8 : rec[0] == '2' ? 9 : rec[0] == 'u' ? 10
                 : (rec[0] == '?' || rec[0] == '!') ? 1 : -1;
        if (skip > 0 && rec[0] != '!') {
            const char *p = rec;
            const char *end = rec + rl;
            for (int k = 0; k < skip && p < end; k++) {
                const char *sp = memchr(p, ' ', (size_t)(end - p));
                p = sp ? sp + 1 : end;
            }
            cand_push(&v, &n, &cap, p, (size_t)(end - p));
        }
        i += rl + 1;
        if (rec[0] == '2' && i < len) {          /* the rename's origin */
            size_t ol = strnlen(buf + i, len - i);
            cand_push(&v, &n, &cap, buf + i, ol);
            i += ol + 1;
        }
    }
    free(buf);
    *nstatus = n;

    char head[65] = "", branch[256];
    git_head(root, branch, sizeof branch, head, sizeof head);
    if (!head[0] || strncmp(head, since, sl) != 0 || strlen(head) != sl) {
        StrBuf a; sb_init(&a);
        sb_printf(&a, "-c core.quotepath=off diff --name-only -z --no-renames "
                  "%s HEAD --", since);
        rc = git_capture_raw(root, a.p, &buf, &len);
        sb_free(&a);
        if (rc != 0) {
            free(buf);
            for (int k = 0; k < n; k++) free(v[k]);
            free(v);
            return -1;
        }
        for (size_t i = 0; i < len; ) {
            size_t rl = strnlen(buf + i, len - i);
            cand_push(&v, &n, &cap, buf + i, rl);
            i += rl + 1;
        }
        free(buf);
    }
    *out = v;
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
 * busy, never upgraded mid-way. Counts are optional; -1 when git cannot be
 * run. This is also the evidence `cg spec done` reads for `touches`, so it
 * runs quietly from there. */
int git_ingest(Cg *cg, int limit, long *ncommits_out, long *npaths_out,
               long *seen_out) {
    StrBuf cmd; sb_init(&cmd);
    sb_printf(&cmd,
        "git -C '%s' log --no-merges --no-renames -n %d "
        "--pretty=format:'\x01%%H\t%%an\t%%at\t%%s' --name-only 2>/dev/null",
        cg->root, limit);
    FILE *f = popen(cmd.p, "r");
    sb_free(&cmd);
    if (!f) return -1;

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
    if (ncommits_out) *ncommits_out = ncommits;
    if (npaths_out) *npaths_out = npaths;
    if (seen_out) *seen_out = seen;
    return 0;
}

int cmd_git_sync(Cg *cg, int limit, bool json) {
    if (!git_available(cg)) {
        if (json) printf("{\"git\":false,\"commits\":0,\"paths\":0}\n");
        else printf("no git repository here — nothing to ingest\n");
        return 0;
    }
    long ncommits = 0, npaths = 0, seen = 0;
    if (git_ingest(cg, limit, &ncommits, &npaths, &seen) != 0) {
        fprintf(stderr, "cg: cannot run git\n");
        return 1;
    }
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

/* ---------------- codify-v15 3.1: plumbing for the projection ---------------- */
#include <ctype.h>

/* The identity projection and shadow commits are written under. They are
 * synthetic — nobody authored them — and a fixed identity keeps a commit id
 * a function of its tree, parents, and date, which is what lets an unchanged
 * dirty worktree produce the same shadow commit twice. */
#define GIT_PROJ_IDENT "GIT_AUTHOR_NAME='Codify projection' " \
    "GIT_AUTHOR_EMAIL='projection@codify.local' " \
    "GIT_COMMITTER_NAME='Codify projection' " \
    "GIT_COMMITTER_EMAIL='projection@codify.local' "

/* `[env] git -C <tree> <args>`, stdout captured byte for byte (NULs kept,
 * which git_run's string buffer cannot do); stderr discarded unless
 * keep_err folds it in. Returns the exit status, -1 when git did not start. */
static int git_capture(const char *tree, const char *env, const char *args,
                       StrBuf *out, bool keep_err) {
    StrBuf cmd; sb_init(&cmd);
    if (env && env[0]) { sb_puts(&cmd, env); sb_putc(&cmd, ' '); }
    sb_puts(&cmd, "git -C ");
    sb_shquote(&cmd, tree);
    sb_putc(&cmd, ' ');
    sb_puts(&cmd, args);
    sb_puts(&cmd, keep_err ? " 2>&1" : " 2>/dev/null");
    FILE *f = popen(cmd.p, "r");
    sb_free(&cmd);
    if (!f) return -1;
    char buf[8192];
    size_t n;
    while ((n = fread(buf, 1, sizeof buf, f)) > 0)
        if (out) for (size_t i = 0; i < n; i++) sb_putc(out, buf[i]);
    int st = pclose(f);
    if (st == -1) return -1;
    if (WIFEXITED(st)) return WEXITSTATUS(st);
    return 128 + (WIFSIGNALED(st) ? WTERMSIG(st) : 0);
}

/* the leading 40- or 64-hex object id of s into out; false when absent */
static bool git_take_oid(const char *s, char *out, size_t cap) {
    out[0] = 0;
    while (*s == ' ' || *s == '\n') s++;
    size_t n = 0;
    while (isxdigit((unsigned char)s[n])) n++;
    if ((n != 40 && n != 64) || n >= cap) return false;
    memcpy(out, s, n);
    out[n] = 0;
    return true;
}

int git_version(int *major, int *minor) {
    *major = *minor = 0;
    FILE *f = popen("git --version 2>/dev/null", "r");
    if (!f) return -1;
    char line[256] = "";
    if (!fgets(line, sizeof line, f)) line[0] = 0;
    int st = pclose(f);
    if (st == -1 || !WIFEXITED(st) || WEXITSTATUS(st) != 0) return -1;
    const char *p = strstr(line, "version ");
    if (!p || sscanf(p + 8, "%d.%d", major, minor) != 2) return -1;
    return 0;
}

int git_rev_commit(const char *tree, const char *rev, char *sha, size_t cap) {
    StrBuf r; sb_init(&r);
    sb_printf(&r, "%s^{commit}", rev);
    StrBuf a; sb_init(&a);
    sb_puts(&a, "rev-parse --verify --quiet ");
    sb_shquote(&a, r.p);
    StrBuf o; sb_init(&o);
    int rc = git_capture(tree, NULL, a.p, &o, false);
    bool ok = rc == 0 && o.p && git_take_oid(o.p, sha, cap);
    if (!ok) sha[0] = 0;
    sb_free(&a); sb_free(&r); sb_free(&o);
    return ok ? 0 : -1;
}

bool git_is_ancestor(const char *tree, const char *a, const char *b) {
    StrBuf args; sb_init(&args);
    sb_printf(&args, "merge-base --is-ancestor %s %s", a, b);
    int rc = git_capture(tree, NULL, args.p, NULL, false);
    sb_free(&args);
    return rc == 0;
}

long git_count_commits(const char *tree, const char *from, const char *to) {
    StrBuf args; sb_init(&args);
    sb_printf(&args, "rev-list --count %s..%s", from, to);
    StrBuf o; sb_init(&o);
    int rc = git_capture(tree, NULL, args.p, &o, false);
    long n = rc == 0 && o.p ? atol(o.p) : 0;
    sb_free(&args); sb_free(&o);
    return n;
}

/* NUL-separated git output into a vector of malloc'd strings */
static int git_split_z(const StrBuf *o, char ***out) {
    *out = NULL;
    int n = 0, cap = 0;
    size_t i = 0;
    while (o->p && i < o->len) {
        size_t s = i;
        while (i < o->len && o->p[i]) i++;
        if (i > s) {
            if (n == cap) {
                cap = cap ? cap * 2 : 16;
                *out = xrealloc(*out, (size_t)cap * sizeof **out);
            }
            char *v = xmalloc(i - s + 1);
            memcpy(v, o->p + s, i - s);
            v[i - s] = 0;
            (*out)[n++] = v;
        }
        i++;
    }
    return n;
}

int git_changed_paths(const char *tree, const char *from, const char *to,
                      char ***out) {
    *out = NULL;
    StrBuf args; sb_init(&args);
    sb_printf(&args, "diff --no-renames --name-only -z %s %s", from, to);
    StrBuf o; sb_init(&o);
    int rc = git_capture(tree, NULL, args.p, &o, false);
    int n = rc == 0 ? git_split_z(&o, out) : 0;
    sb_free(&args); sb_free(&o);
    return n;
}

/* the word inside a message's "CONFLICT (...)", normalised: git says
 * "content" in the message and "contents" in the type field, and tells
 * add/add apart only in the message */
static void git_conflict_kind(const char *msg, char *out, size_t cap) {
    const char *p = strstr(msg, "CONFLICT (");
    if (!p) { snprintf(out, cap, "content"); return; }
    p += 10;
    const char *e = strchr(p, ')');
    size_t n = e ? (size_t)(e - p) : strlen(p);
    if ((n == 7 && !strncmp(p, "content", 7)) ||
        (n == 8 && !strncmp(p, "contents", 8)))
        snprintf(out, cap, "content");
    else
        snprintf(out, cap, "%.*s", (int)n, p);
}

int git_merge_tree(const char *tree, const char *a, const char *b,
                   char *tree_out, size_t cap, ProjectionConflict **conf,
                   int *nconf) {
    *conf = NULL;
    *nconf = 0;
    tree_out[0] = 0;
    StrBuf args; sb_init(&args);
    sb_printf(&args, "merge-tree --write-tree --messages -z %s %s", a, b);
    StrBuf o; sb_init(&o);
    int rc = git_capture(tree, NULL, args.p, &o, false);
    sb_free(&args);
    if ((rc != 0 && rc != 1) || !o.p || !git_take_oid(o.p, tree_out, cap)) {
        sb_free(&o);
        tree_out[0] = 0;
        return -1;
    }
    if (rc == 0) { sb_free(&o); return 0; }
    /* -z layout: <tree> NUL, one "<mode> <oid> <stage>\t<path>" NUL per
     * conflicted stage, an empty field, then each message as
     * <npaths> NUL <path>... NUL <type> NUL <text> NUL */
    size_t i = strlen(o.p) + 1;
    int vcap = 0, n = 0;
    ProjectionConflict *v = NULL;
    while (i < o.len && o.p[i]) {
        const char *ent = o.p + i;
        i += strlen(ent) + 1;
        const char *tab = strchr(ent, '\t');
        if (!tab) continue;
        const char *path = tab + 1;
        bool seen = false;
        for (int k = 0; k < n && !seen; k++) seen = !strcmp(v[k].path, path);
        if (seen) continue;
        if (n == vcap) {
            vcap = vcap ? vcap * 2 : 8;
            v = xrealloc(v, (size_t)vcap * sizeof *v);
        }
        memset(&v[n], 0, sizeof v[n]);
        v[n].path = xstrdup(path);
        snprintf(v[n].kind, sizeof v[n].kind, "content");
        n++;
    }
    i++;                                    /* the empty separator */
    while (i < o.len) {
        long np = atol(o.p + i);
        i += strlen(o.p + i) + 1;
        const char *paths[16];
        int got = 0;
        for (long k = 0; k < np && i < o.len; k++) {
            if (got < 16) paths[got++] = o.p + i;
            i += strlen(o.p + i) + 1;
        }
        if (i >= o.len) break;
        const char *type = o.p + i;
        i += strlen(type) + 1;
        const char *msg = i < o.len ? o.p + i : "";
        i += strlen(msg) + 1;
        if (strncmp(type, "CONFLICT", 8) != 0) continue;
        char kind[32];
        git_conflict_kind(msg, kind, sizeof kind);
        for (int k = 0; k < got; k++)
            for (int c = 0; c < n; c++)
                if (!strcmp(v[c].path, paths[k]))
                    snprintf(v[c].kind, sizeof v[c].kind, "%s", kind);
    }
    sb_free(&o);
    *conf = v;
    *nconf = n;
    return 1;
}

int git_commit_tree(const char *tree, const char *treeid,
                    const char *const *parents, int nparents,
                    const char *msg, long date, char *out, size_t cap) {
    StrBuf env; sb_init(&env);
    sb_puts(&env, GIT_PROJ_IDENT);
    if (date > 0)
        sb_printf(&env, "GIT_AUTHOR_DATE='@%ld +0000' "
                  "GIT_COMMITTER_DATE='@%ld +0000'", date, date);
    StrBuf a; sb_init(&a);
    sb_printf(&a, "commit-tree %s", treeid);
    for (int i = 0; i < nparents; i++) sb_printf(&a, " -p %s", parents[i]);
    sb_puts(&a, " -m ");
    sb_shquote(&a, msg);
    StrBuf o; sb_init(&o);
    int rc = git_capture(tree, env.p, a.p, &o, false);
    bool ok = rc == 0 && o.p && git_take_oid(o.p, out, cap);
    if (!ok) out[0] = 0;
    sb_free(&env); sb_free(&a); sb_free(&o);
    return ok ? 0 : -1;
}

int git_update_ref(const char *tree, const char *ref, const char *sha) {
    StrBuf a; sb_init(&a);
    sb_puts(&a, "update-ref ");
    sb_shquote(&a, ref);
    sb_printf(&a, " %s", sha);
    int rc = git_capture(tree, NULL, a.p, NULL, false);
    sb_free(&a);
    return rc == 0 ? 0 : -1;
}

long git_commit_time(const char *tree, const char *rev) {
    StrBuf a; sb_init(&a);
    sb_printf(&a, "show -s --format=%%ct %s", rev);
    StrBuf o; sb_init(&o);
    int rc = git_capture(tree, NULL, a.p, &o, false);
    long t = rc == 0 && o.p ? atol(o.p) : 0;
    sb_free(&a); sb_free(&o);
    return t;
}

int git_shadow_tree(const char *worktree, const char *tmp_index,
                    char *tree_out, size_t cap) {
    tree_out[0] = 0;
    StrBuf o; sb_init(&o);
    int rc = git_capture(worktree, NULL, "rev-parse --git-path index", &o,
                         false);
    char idx[4600] = "";
    if (rc == 0 && o.p) {
        chomp(o.p);
        if (o.p[0] == '/') snprintf(idx, sizeof idx, "%s", o.p);
        else snprintf(idx, sizeof idx, "%s/%s", worktree, o.p);
    }
    sb_free(&o);
    size_t len = 0;
    char *data = idx[0] ? read_entire_file(idx, &len) : NULL;
    unlink(tmp_index);
    if (data) {
        int w = write_entire_file(tmp_index, data, len);
        free(data);
        if (w != 0) return -1;
    }
    StrBuf env; sb_init(&env);
    sb_puts(&env, "GIT_OPTIONAL_LOCKS=0 GIT_INDEX_FILE=");
    sb_shquote(&env, tmp_index);
    rc = git_capture(worktree, env.p,
                     "add -A -- . ':(exclude)" CG_DIR "'", NULL, false);
    if (rc == 0) {
        sb_init(&o);
        rc = git_capture(worktree, env.p, "write-tree", &o, false);
        if (rc != 0 || !o.p || !git_take_oid(o.p, tree_out, cap)) rc = -1;
        sb_free(&o);
    }
    sb_free(&env);
    unlink(tmp_index);
    return rc == 0 ? 0 : -1;
}

int git_tree_diff_count(const char *tree, const char *a, const char *b) {
    StrBuf args; sb_init(&args);
    sb_printf(&args, "diff-tree -r --no-renames --name-only -z %s %s", a, b);
    StrBuf o; sb_init(&o);
    int rc = git_capture(tree, NULL, args.p, &o, false);
    char **v = NULL;
    int n = rc == 0 ? git_split_z(&o, &v) : 0;
    for (int i = 0; i < n; i++) free(v[i]);
    free(v);
    sb_free(&args); sb_free(&o);
    return n;
}

int git_capture_text(const char *tree, const char *args, StrBuf *out) {
    return git_capture(tree, NULL, args, out, true);
}
