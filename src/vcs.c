/*
 * Content-addressed version control, integrated with the code graph.
 * Objects: blob (raw bytes), manifest ("<hash> <size>\t<path>\n" sorted),
 * commit (tree/parent/date/message text). SHA-256 addressed, stored under
 * .codegraph/objects/aa/bb.... HEAD holds the current commit hash.
 * `cg changes` joins VCS state with the graph: symbols touched by
 * uncommitted edits plus their inbound callers (the blast radius).
 */
#include "cg.h"
#include <dirent.h>
#include <sys/stat.h>
#include <unistd.h>
#include <time.h>

/* ---------------- object store ---------------- */

static void obj_path(const Cg *cg, const char *hash, char *out, size_t cap) {
    snprintf(out, cap, "%s/%s/%.2s/%s", cg->root, CG_OBJECTS, hash, hash + 2);
}

static int obj_write(const Cg *cg, const void *data, size_t len, char hash[65]) {
    sha256_hex(data, len, hash);
    char p[4900];
    obj_path(cg, hash, p, sizeof p);
    struct stat st;
    if (stat(p, &st) == 0) return 0;              /* dedup */
    char dir[4900];
    snprintf(dir, sizeof dir, "%s/%s/%.2s", cg->root, CG_OBJECTS, hash);
    if (mkdirs(dir) != 0) return -1;
    return write_entire_file(p, data, len);
}

static char *obj_read(const Cg *cg, const char *hash, size_t *len) {
    char p[4900];
    obj_path(cg, hash, p, sizeof p);
    return read_entire_file(p, len);
}

static int head_read(const Cg *cg, char hash[65]) {
    char p[4900];
    snprintf(p, sizeof p, "%s/%s", cg->root, CG_HEAD);
    char *s = read_entire_file(p, NULL);
    if (!s) return -1;
    snprintf(hash, 65, "%.64s", s);
    free(s);
    return strlen(hash) == 64 ? 0 : -1;
}

static void head_write(const Cg *cg, const char *hash) {
    char p[4900];
    snprintf(p, sizeof p, "%s/%s", cg->root, CG_HEAD);
    write_entire_file(p, hash, strlen(hash));
}

/* resolve a (possibly abbreviated) commit id; "HEAD" allowed */
static int resolve_commit(const Cg *cg, const char *ref, char out[65]) {
    if (!ref || strcmp(ref, "HEAD") == 0) return head_read(cg, out);
    size_t n = strlen(ref);
    if (n == 64) { snprintf(out, 65, "%s", ref); return 0; }
    if (n < 4) return -1;
    char dir[4900];
    snprintf(dir, sizeof dir, "%s/%s/%.2s", cg->root, CG_OBJECTS, ref);
    DIR *d = opendir(dir);
    if (!d) return -1;
    struct dirent *e;
    int found = 0;
    while ((e = readdir(d))) {
        if (e->d_name[0] == '.') continue;
        char full[130];
        snprintf(full, sizeof full, "%.2s%s", ref, e->d_name);
        if (strncmp(full, ref, n) == 0) {
            if (found++) { closedir(d); return -2; }   /* ambiguous */
            snprintf(out, 65, "%s", full);
        }
    }
    closedir(d);
    return found == 1 ? 0 : -1;
}

/* ---------------- manifests ---------------- */

typedef struct { char hash[65]; long size; char *path; } MEnt;
typedef struct { MEnt *v; int n, cap; } Manifest;

static void man_push(Manifest *m, const char *hash, long size, const char *path) {
    if (m->n == m->cap) {
        m->cap = m->cap ? m->cap * 2 : 128;
        m->v = xrealloc(m->v, sizeof(MEnt) * (size_t)m->cap);
    }
    snprintf(m->v[m->n].hash, 65, "%s", hash);
    m->v[m->n].size = size;
    m->v[m->n].path = xstrdup(path);
    m->n++;
}

static void man_free(Manifest *m) {
    for (int i = 0; i < m->n; i++) free(m->v[i].path);
    free(m->v);
    memset(m, 0, sizeof *m);
}

static int ment_cmp(const void *a, const void *b) {
    return strcmp(((const MEnt *)a)->path, ((const MEnt *)b)->path);
}

/* hash every non-ignored file in the working tree; optionally store blobs */
static void snapshot_tree(const Cg *cg, Manifest *m, bool store) {
    Ignore ig;
    ignore_load(&ig, cg->root);
    /* local recursive walk (VCS includes binaries; index does not) */
    typedef struct { char rel[4096]; } Frame;
    Frame *stack = xmalloc(sizeof(Frame) * 512);
    int sp = 0;
    stack[sp++].rel[0] = 0;
    while (sp > 0) {
        char rel[4096];
        snprintf(rel, sizeof rel, "%s", stack[--sp].rel);
        char abs[4900];
        snprintf(abs, sizeof abs, "%s/%s", cg->root, rel[0] ? rel : ".");
        DIR *d = opendir(abs);
        if (!d) continue;
        struct dirent *e;
        while ((e = readdir(d))) {
            if (strcmp(e->d_name, ".") == 0 || strcmp(e->d_name, "..") == 0)
                continue;
            char crel[4096];
            if (rel[0]) snprintf(crel, sizeof crel, "%s/%s", rel, e->d_name);
            else        snprintf(crel, sizeof crel, "%s", e->d_name);
            char cabs[4900];
            snprintf(cabs, sizeof cabs, "%s/%s", cg->root, crel);
            struct stat st;
            if (lstat(cabs, &st) != 0 || S_ISLNK(st.st_mode)) continue;
            if (ignore_match(&ig, crel, S_ISDIR(st.st_mode))) continue;
            if (S_ISDIR(st.st_mode)) {
                if (sp < 512) snprintf(stack[sp++].rel, 4096, "%s", crel);
            } else if (S_ISREG(st.st_mode) && st.st_size <= 32L * 1024 * 1024) {
                size_t len = 0;
                char *data = read_entire_file(cabs, &len);
                if (!data) continue;
                char hash[65];
                if (store) obj_write(cg, data, len, hash);
                else sha256_hex(data, len, hash);
                man_push(m, hash, (long)len, crel);
                free(data);
            }
        }
        closedir(d);
    }
    free(stack);
    ignore_free(&ig);
    qsort(m->v, (size_t)m->n, sizeof(MEnt), ment_cmp);
}

static char *man_serialize(const Manifest *m, size_t *len) {
    StrBuf b; sb_init(&b);
    for (int i = 0; i < m->n; i++)
        sb_printf(&b, "%s %ld\t%s\n", m->v[i].hash, m->v[i].size, m->v[i].path);
    *len = b.len;
    return b.p;
}

static int man_load(const Cg *cg, const char *tree_hash, Manifest *m) {
    memset(m, 0, sizeof *m);
    size_t len = 0;
    char *data = obj_read(cg, tree_hash, &len);
    if (!data) return -1;
    char *save = NULL;
    for (char *line = strtok_r(data, "\n", &save); line;
         line = strtok_r(NULL, "\n", &save)) {
        char hash[65];
        long size;
        char *tab = strchr(line, '\t');
        if (!tab || sscanf(line, "%64s %ld", hash, &size) != 2) continue;
        man_push(m, hash, size, tab + 1);
    }
    free(data);
    return 0;
}

/* ---------------- commit objects ---------------- */

typedef struct {
    char tree[65], parent[65];
    long date;
    char *message;
} Commit;

static int commit_load(const Cg *cg, const char *hash, Commit *c) {
    memset(c, 0, sizeof *c);
    size_t len = 0;
    char *data = obj_read(cg, hash, &len);
    if (!data) return -1;
    char *msg = strstr(data, "\nmessage ");
    if (msg) c->message = xstrdup(msg + 9);
    sscanf(data, "tree %64s", c->tree);
    char *p = strstr(data, "\nparent ");
    if (p) sscanf(p, "\nparent %64s", c->parent);
    p = strstr(data, "\ndate ");
    if (p) sscanf(p, "\ndate %ld", &c->date);
    free(data);
    return 0;
}

int cmd_commit_with_options(Cg *cg, const char *msg, bool quiet,
                            const char *spec_tag, bool amend) {
    Manifest m = {0};
    snapshot_tree(cg, &m, true);
    size_t mlen = 0;
    char *mdata = man_serialize(&m, &mlen);
    char tree_hash[65];
    obj_write(cg, mdata, mlen, tree_hash);
    free(mdata);

    char parent[65] = "";
    bool has_parent = head_read(cg, parent) == 0;
    if (amend && !has_parent) {
        if (!quiet) fprintf(stderr, "cg: cannot amend before the first snapshot\n");
        man_free(&m);
        return 1;
    }
    if (has_parent) {
        Commit pc;
        if (commit_load(cg, parent, &pc) == 0) {
            bool same = strcmp(pc.tree, tree_hash) == 0;
            if (amend) {
                has_parent = pc.parent[0] != 0;
                snprintf(parent, sizeof parent, "%s", pc.parent);
            }
            free(pc.message);
            if (same && !amend) {
                if (!quiet) printf("nothing to commit (tree unchanged)\n");
                man_free(&m);
                return 0;
            }
        } else if (amend) {
            if (!quiet) fprintf(stderr, "cg: cannot load snapshot being amended\n");
            man_free(&m);
            return 1;
        }
    }

    /* tag the snapshot with the spec task being worked on, if any */
    char *tagged = NULL;
    const char *final_msg = msg ? msg : "";
    if (!strstr(final_msg, "[spec:")) {
        char *tag = spec_tag ? xstrdup(spec_tag) : spec_active_tag();
        if (tag) {
            StrBuf t; sb_init(&t);
            sb_printf(&t, "%s [spec:%s]", final_msg, tag);
            tagged = t.p;
            final_msg = tagged;
            free(tag);
        }
    }

    StrBuf c; sb_init(&c);
    sb_printf(&c, "tree %s\n", tree_hash);
    if (has_parent) sb_printf(&c, "parent %s\n", parent);
    sb_printf(&c, "date %ld\n", (long)time(NULL));
    sb_printf(&c, "message %s", final_msg);
    char commit_hash[65];
    obj_write(cg, c.p, c.len, commit_hash);
    sb_free(&c);
    head_write(cg, commit_hash);

    if (!quiet)
        printf("[%.12s] %d files — %s\n", commit_hash, m.n, final_msg);
    free(tagged);
    man_free(&m);
    return 0;
}

int cmd_commit(Cg *cg, const char *msg, bool quiet) {
    return cmd_commit_with_options(cg, msg, quiet, NULL, false);
}

int cmd_log(Cg *cg, int limit, bool json) {
    char hash[65];
    if (head_read(cg, hash) != 0) {
        if (json) printf("{\"commits\":[]}\n");
        else printf("no commits yet\n");
        return 0;
    }
    StrBuf b; sb_init(&b);
    if (json) sb_puts(&b, "{\"commits\":[");
    int n = 0;
    while (n < limit && hash[0]) {
        Commit c;
        if (commit_load(cg, hash, &c) != 0) break;
        if (json) {
            if (n) sb_putc(&b, ',');
            sb_puts(&b, "{\"id\":");
            sb_json_str(&b, hash);
            sb_printf(&b, ",\"date\":%ld,\"message\":", c.date);
            sb_json_str(&b, c.message ? c.message : "");
            sb_putc(&b, '}');
        } else {
            char when[64] = "?";
            time_t t = (time_t)c.date;
            struct tm tmv;
            if (localtime_r(&t, &tmv))
                strftime(when, sizeof when, "%Y-%m-%d %H:%M", &tmv);
            sb_printf(&b, "%.12s  %s  %s\n", hash, when,
                      c.message ? c.message : "");
        }
        snprintf(hash, 65, "%s", c.parent);
        free(c.message);
        n++;
    }
    if (json) sb_puts(&b, "]}\n");
    fputs(b.p, stdout);
    sb_free(&b);
    return 0;
}

/* ---------------- status / changes ---------------- */

typedef struct { StrBuf added, modified, deleted; int na, nm, nd;
                 char mod_paths[256][1024]; int nmod_paths; } TreeDiff;

static void tree_status(Cg *cg, TreeDiff *td, bool json) {
    memset(td, 0, sizeof *td);
    sb_init(&td->added); sb_init(&td->modified); sb_init(&td->deleted);

    Manifest work = {0}, head = {0};
    snapshot_tree(cg, &work, false);
    char hh[65];
    bool has_head = head_read(cg, hh) == 0;
    if (has_head) {
        Commit c;
        if (commit_load(cg, hh, &c) == 0) {
            man_load(cg, c.tree, &head);
            free(c.message);
        }
    }
    int wi = 0, hi = 0;
    while (wi < work.n || hi < head.n) {
        int c = (wi >= work.n) ? 1 : (hi >= head.n) ? -1
              : strcmp(work.v[wi].path, head.v[hi].path);
        const char *mark = NULL, *path = NULL;
        StrBuf *dst = NULL;
        int *cnt = NULL;
        if (c == 0) {
            if (strcmp(work.v[wi].hash, head.v[hi].hash) != 0) {
                mark = "M"; path = work.v[wi].path;
                dst = &td->modified; cnt = &td->nm;
                if (td->nmod_paths < 256)
                    snprintf(td->mod_paths[td->nmod_paths++], 1024, "%s", path);
            }
            wi++; hi++;
        } else if (c < 0) {
            mark = "A"; path = work.v[wi].path;
            dst = &td->added; cnt = &td->na;
            if (td->nmod_paths < 256)
                snprintf(td->mod_paths[td->nmod_paths++], 1024, "%s", path);
            wi++;
        } else {
            mark = "D"; path = head.v[hi].path;
            dst = &td->deleted; cnt = &td->nd;
            hi++;
        }
        if (mark) {
            if (json) {
                if (*cnt) sb_putc(dst, ',');
                sb_json_str(dst, path);
            } else {
                sb_printf(dst, "  %s %s\n", mark, path);
            }
            (*cnt)++;
        }
    }
    man_free(&work);
    man_free(&head);
}

int cmd_status(Cg *cg, bool json) {
    TreeDiff td;
    tree_status(cg, &td, json);
    char hh[65] = "";
    head_read(cg, hh);
    if (json) {
        StrBuf b; sb_init(&b);
        sb_puts(&b, "{\"head\":");
        if (hh[0]) sb_json_str(&b, hh); else sb_puts(&b, "null");
        sb_puts(&b, ",\"added\":[");    sb_puts(&b, td.added.p);
        sb_puts(&b, "],\"modified\":[");sb_puts(&b, td.modified.p);
        sb_puts(&b, "],\"deleted\":["); sb_puts(&b, td.deleted.p);
        sb_puts(&b, "]}\n");
        fputs(b.p, stdout);
        sb_free(&b);
    } else {
        if (hh[0]) printf("HEAD %.12s\n", hh);
        else printf("no commits yet\n");
        if (!td.na && !td.nm && !td.nd) printf("working tree clean\n");
        if (td.na) { printf("added:\n%s", td.added.p); }
        if (td.nm) { printf("modified:\n%s", td.modified.p); }
        if (td.nd) { printf("deleted:\n%s", td.deleted.p); }
    }
    sb_free(&td.added); sb_free(&td.modified); sb_free(&td.deleted);
    return 0;
}

/* impact radius of uncommitted edits: symbols in touched files + callers */
int cmd_changes(Cg *cg, bool json) {
    TreeDiff td;
    tree_status(cg, &td, false);
    StrBuf b; sb_init(&b);
    if (json) sb_puts(&b, "{\"changed_files\":[");
    else sb_printf(&b, "%d changed file%s\n", td.nmod_paths,
                   td.nmod_paths == 1 ? "" : "s");

    sqlite3_stmt *syms = cg_prep(cg,
        "SELECT s.id,s.name,s.kind,s.line FROM symbols s "
        "JOIN files f ON f.id=s.file_id WHERE f.path=? ORDER BY s.line");
    sqlite3_stmt *cals = cg_prep(cg,
        "SELECT DISTINCT s2.name, f2.path, s2.line "
        "FROM refs r JOIN symbols s2 ON s2.id=r.sym_id "
        "JOIN files f2 ON f2.id=s2.file_id "
        "WHERE r.name=? AND f2.path<>? LIMIT 12");

    for (int i = 0; i < td.nmod_paths; i++) {
        const char *path = td.mod_paths[i];
        if (json) {
            if (i) sb_putc(&b, ',');
            sb_puts(&b, "{\"path\":");
            sb_json_str(&b, path);
            sb_puts(&b, ",\"symbols\":[");
        } else {
            sb_printf(&b, "\n%s\n", path);
        }
        sqlite3_bind_text(syms, 1, path, -1, SQLITE_TRANSIENT);
        int ns = 0;
        while (sqlite3_step(syms) == SQLITE_ROW) {
            const char *nm = (const char *)sqlite3_column_text(syms, 1);
            const char *kd = (const char *)sqlite3_column_text(syms, 2);
            int line = sqlite3_column_int(syms, 3);
            if (json) {
                if (ns) sb_putc(&b, ',');
                sb_puts(&b, "{\"name\":"); sb_json_str(&b, nm);
                sb_puts(&b, ",\"kind\":"); sb_json_str(&b, kd ? kd : "");
                sb_printf(&b, ",\"line\":%d,\"external_callers\":[", line);
            } else {
                sb_printf(&b, "  %s %s:%d", kd ? kd : "?", nm, line);
            }
            sqlite3_bind_text(cals, 1, nm, -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(cals, 2, path, -1, SQLITE_TRANSIENT);
            int nc = 0;
            while (sqlite3_step(cals) == SQLITE_ROW) {
                const char *cn = (const char *)sqlite3_column_text(cals, 0);
                const char *cp = (const char *)sqlite3_column_text(cals, 1);
                int cl = sqlite3_column_int(cals, 2);
                if (json) {
                    if (nc) sb_putc(&b, ',');
                    sb_puts(&b, "{\"name\":"); sb_json_str(&b, cn);
                    sb_puts(&b, ",\"path\":"); sb_json_str(&b, cp);
                    sb_printf(&b, ",\"line\":%d}", cl);
                } else {
                    sb_printf(&b, "%s %s(%s:%d)", nc ? "," : "  ← callers:",
                              cn, cp, cl);
                }
                nc++;
            }
            sqlite3_reset(cals);
            sqlite3_clear_bindings(cals);
            if (json) sb_puts(&b, "]}");
            else sb_putc(&b, '\n');
            ns++;
        }
        sqlite3_reset(syms);
        sqlite3_clear_bindings(syms);
        if (json) sb_puts(&b, "]}");
    }
    sqlite3_finalize(syms);
    sqlite3_finalize(cals);
    if (json) sb_puts(&b, "]}\n");
    fputs(b.p, stdout);
    sb_free(&b);
    sb_free(&td.added); sb_free(&td.modified); sb_free(&td.deleted);
    return 0;
}

/* ---------------- diff ---------------- */

typedef struct { const char *s; size_t n; unsigned long h; } DLine;

static int split_dlines(char *data, size_t len, DLine **out) {
    int cap = 256, n = 0;
    DLine *v = xmalloc(sizeof(DLine) * (size_t)cap);
    size_t pos = 0;
    while (pos < len) {
        const char *ls = data + pos;
        const char *nl = memchr(ls, '\n', len - pos);
        size_t ll = nl ? (size_t)(nl - ls) : len - pos;
        if (n == cap) { cap *= 2; v = xrealloc(v, sizeof(DLine) * (size_t)cap); }
        unsigned long h = 5381;
        for (size_t i = 0; i < ll; i++) h = h * 33 + (unsigned char)ls[i];
        v[n].s = ls; v[n].n = ll; v[n].h = h;
        n++;
        pos += ll + (nl ? 1 : 0);
    }
    *out = v;
    return n;
}

static bool dl_eq(const DLine *a, const DLine *b) {
    return a->h == b->h && a->n == b->n && memcmp(a->s, b->s, a->n) == 0;
}

static void emit_line(StrBuf *b, char mark, const DLine *l) {
    sb_putc(b, mark);
    sb_putc(b, ' ');
    size_t n = l->n > 400 ? 400 : l->n;
    for (size_t i = 0; i < n; i++) sb_putc(b, l->s[i]);
    sb_putc(b, '\n');
}

/* LCS DP diff, capped; falls back to a summary for huge files */
static void diff_blobs(StrBuf *b, char *ad, size_t al, char *bd, size_t bl) {
    if (looks_binary(ad, al) || looks_binary(bd, bl)) {
        sb_puts(b, "  (binary files differ)\n");
        return;
    }
    DLine *A, *B;
    int an = split_dlines(ad, al, &A);
    int bn = split_dlines(bd, bl, &B);
    int lo = 0;
    while (lo < an && lo < bn && dl_eq(&A[lo], &B[lo])) lo++;
    int ahi = an, bhi = bn;
    while (ahi > lo && bhi > lo && dl_eq(&A[ahi-1], &B[bhi-1])) { ahi--; bhi--; }
    long n = ahi - lo, m = bhi - lo;
    if (n == 0 && m == 0) { free(A); free(B); return; }
    if (n * m > 16L * 1000 * 1000) {
        sb_printf(b, "  (diff too large: -%ld +%ld lines)\n", n, m);
        free(A); free(B);
        return;
    }
    /* LCS length table */
    int W = (int)m + 1;
    int *dp = xmalloc(sizeof(int) * (size_t)(n + 1) * (size_t)W);
    for (long j = 0; j <= m; j++) dp[j] = 0;
    for (long i = 1; i <= n; i++) {
        dp[i * W] = 0;
        for (long j = 1; j <= m; j++) {
            if (dl_eq(&A[lo + i - 1], &B[lo + j - 1]))
                dp[i * W + j] = dp[(i-1) * W + j - 1] + 1;
            else {
                int u = dp[(i-1) * W + j], l = dp[i * W + j - 1];
                dp[i * W + j] = u > l ? u : l;
            }
        }
    }
    /* backtrack into ops (reversed) */
    typedef struct { char mark; int ai, bi; } Op;
    Op *ops = xmalloc(sizeof(Op) * (size_t)(n + m + 1));
    int nops = 0;
    long i = n, j = m;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && dl_eq(&A[lo + i - 1], &B[lo + j - 1])) {
            ops[nops++] = (Op){' ', (int)(lo + i - 1), (int)(lo + j - 1)};
            i--; j--;
        } else if (j > 0 && (i == 0 || dp[i * W + j - 1] >= dp[(i-1) * W + j])) {
            ops[nops++] = (Op){'+', -1, (int)(lo + j - 1)};
            j--;
        } else {
            ops[nops++] = (Op){'-', (int)(lo + i - 1), -1};
            i--;
        }
    }
    free(dp);
    sb_printf(b, "  @@ -%d,%ld +%d,%ld @@\n", lo + 1, n, lo + 1, m);
    int context = 0;
    for (int k = nops - 1; k >= 0; k--) {
        if (ops[k].mark == ' ') {
            bool near_change =
                (k + 1 < nops && ops[k+1].mark != ' ') ||
                (k > 0 && ops[k-1].mark != ' ') ||
                (k + 2 < nops && ops[k+2].mark != ' ') ||
                (k - 2 >= 0 && ops[k-2].mark != ' ');
            if (near_change) { emit_line(b, ' ', &A[ops[k].ai]); context = 0; }
            else if (context++ == 0) sb_puts(b, "  ⋮\n");
        } else if (ops[k].mark == '-') {
            emit_line(b, '-', &A[ops[k].ai]); context = 0;
        } else {
            emit_line(b, '+', &B[ops[k].bi]); context = 0;
        }
    }
    free(ops);
    free(A); free(B);
}

int cmd_diff(Cg *cg, const char *ra, const char *rb) {
    /* a=NULL: HEAD vs worktree. b=NULL: ra vs worktree. else ra vs rb */
    char ha[65];
    if (resolve_commit(cg, ra ? ra : "HEAD", ha) != 0) {
        fprintf(stderr, "cg: cannot resolve '%s'\n", ra ? ra : "HEAD");
        return 1;
    }
    Commit ca;
    if (commit_load(cg, ha, &ca) != 0) {
        fprintf(stderr, "cg: bad commit %s\n", ha);
        return 1;
    }
    Manifest ma = {0}, mb = {0};
    man_load(cg, ca.tree, &ma);
    free(ca.message);
    bool b_is_worktree = (rb == NULL);
    if (b_is_worktree) {
        snapshot_tree(cg, &mb, false);
    } else {
        char hb[65];
        if (resolve_commit(cg, rb, hb) != 0) {
            fprintf(stderr, "cg: cannot resolve '%s'\n", rb);
            man_free(&ma);
            return 1;
        }
        Commit cb;
        if (commit_load(cg, hb, &cb) != 0) {
            fprintf(stderr, "cg: bad commit %s\n", hb);
            man_free(&ma);
            return 1;
        }
        man_load(cg, cb.tree, &mb);
        free(cb.message);
    }

    StrBuf out; sb_init(&out);
    int ai = 0, bi = 0;
    while (ai < ma.n || bi < mb.n) {
        int c = (ai >= ma.n) ? 1 : (bi >= mb.n) ? -1
              : strcmp(ma.v[ai].path, mb.v[bi].path);
        if (c == 0) {
            if (strcmp(ma.v[ai].hash, mb.v[bi].hash) != 0) {
                sb_printf(&out, "── %s\n", ma.v[ai].path);
                size_t al = 0, blen = 0;
                char *ad = obj_read(cg, ma.v[ai].hash, &al);
                char *bd;
                if (b_is_worktree) {
                    char abs[4900];
                    snprintf(abs, sizeof abs, "%s/%s", cg->root, mb.v[bi].path);
                    bd = read_entire_file(abs, &blen);
                } else {
                    bd = obj_read(cg, mb.v[bi].hash, &blen);
                }
                if (ad && bd) diff_blobs(&out, ad, al, bd, blen);
                free(ad); free(bd);
            }
            ai++; bi++;
        } else if (c < 0) {
            sb_printf(&out, "── %s (deleted)\n", ma.v[ai].path);
            ai++;
        } else {
            sb_printf(&out, "── %s (added, %ld bytes)\n",
                      mb.v[bi].path, mb.v[bi].size);
            bi++;
        }
    }
    if (out.len == 0) sb_puts(&out, "no differences\n");
    fputs(out.p, stdout);
    sb_free(&out);
    man_free(&ma);
    man_free(&mb);
    return 0;
}

/* ---------------- changelog ---------------- */

/* does (name,kind) exist in pr? */
static bool has_def(const ParseResult *pr, const char *name, const char *kind) {
    for (int i = 0; i < pr->ndefs; i++)
        if (strcmp(pr->defs[i].name, name) == 0 &&
            strcmp(pr->defs[i].kind, kind) == 0)
            return true;
    return false;
}

static bool has_route(const ParseResult *pr, const RouteDef *r) {
    for (int i = 0; i < pr->nroutes; i++)
        if (strcmp(pr->routes[i].method, r->method) == 0 &&
            strcmp(pr->routes[i].pattern, r->pattern) == 0)
            return true;
    return false;
}

static long count_lines(const char *d, size_t n) {
    long c = 0;
    for (size_t i = 0; i < n; i++)
        if (d[i] == '\n') c++;
    if (n && d[n - 1] != '\n') c++;
    return c;
}

static int cmp_u64(const void *a, const void *b) {
    uint64_t x = *(const uint64_t *)a, y = *(const uint64_t *)b;
    return x < y ? -1 : x > y;
}

static uint64_t *line_hashes(const char *d, size_t n, long *count) {
    long total = count_lines(d, n);
    uint64_t *v = xmalloc(sizeof(uint64_t) * (size_t)(total ? total : 1));
    long k = 0;
    size_t pos = 0;
    while (pos < n && k < total) {
        const char *nl = memchr(d + pos, '\n', n - pos);
        size_t ll = nl ? (size_t)(nl - (d + pos)) : n - pos;
        uint64_t h = 1469598103934665603ULL;
        for (size_t i = 0; i < ll; i++) {
            h ^= (unsigned char)d[pos + i];
            h *= 1099511628211ULL;
        }
        v[k++] = h;
        pos += ll + (nl ? 1 : 0);
    }
    *count = k;
    qsort(v, (size_t)k, sizeof(uint64_t), cmp_u64);
    return v;
}

/* multiset diff of line hashes: cheap +added/−removed without full LCS */
static void line_delta(const char *od, size_t ol, const char *nd, size_t nl,
                       long *add, long *del) {
    long na, nb;
    uint64_t *a = line_hashes(od, ol, &na);
    uint64_t *b = line_hashes(nd, nl, &nb);
    long i = 0, j = 0, common = 0;
    while (i < na && j < nb) {
        if (a[i] == b[j]) { common++; i++; j++; }
        else if (a[i] < b[j]) i++;
        else j++;
    }
    free(a); free(b);
    *add = nb - common;
    *del = na - common;
}

/* one modified file: file bullet with line delta + nested symbol changes */
static void changelog_file(Cg *cg, StrBuf *md, const char *path,
                           const char *old_hash, const char *new_hash,
                           int *sym_lines, long *tot_add, long *tot_del) {
    size_t ol = 0, nl = 0;
    char *od = obj_read(cg, old_hash, &ol);
    char *nd = obj_read(cg, new_hash, &nl);
    if (!od || !nd) {
        sb_printf(md, "- Modified `%s`\n", path);
        free(od); free(nd);
        return;
    }
    if (looks_binary(od, ol) || looks_binary(nd, nl)) {
        sb_printf(md, "- Modified `%s` (binary, %zu → %zu bytes)\n",
                  path, ol, nl);
        free(od); free(nd);
        return;
    }
    long add = 0, del = 0;
    line_delta(od, ol, nd, nl, &add, &del);
    *tot_add += add;
    *tot_del += del;
    sb_printf(md, "- Modified `%s` (+%ld −%ld)\n", path, add, del);

    const char *lang = lang_for_path(path);
    if (lang) {
        ParseResult po, pn;
        lang_parse(lang, path, od, ol, &po);
        lang_parse(lang, path, nd, nl, &pn);
        for (int i = 0; i < pn.ndefs && *sym_lines < 60; i++)
            if (!has_def(&po, pn.defs[i].name, pn.defs[i].kind)) {
                sb_printf(md, "  - added %s `%s` (line %d)\n", pn.defs[i].kind,
                          pn.defs[i].name, pn.defs[i].line);
                (*sym_lines)++;
            }
        for (int i = 0; i < po.ndefs && *sym_lines < 60; i++)
            if (!has_def(&pn, po.defs[i].name, po.defs[i].kind)) {
                sb_printf(md, "  - removed %s `%s`\n", po.defs[i].kind,
                          po.defs[i].name);
                (*sym_lines)++;
            }
        for (int i = 0; i < pn.nroutes && *sym_lines < 60; i++)
            if (!has_route(&po, &pn.routes[i])) {
                sb_printf(md, "  - new route `%s %s` (line %d)\n",
                          pn.routes[i].method, pn.routes[i].pattern,
                          pn.routes[i].line);
                (*sym_lines)++;
            }
        for (int i = 0; i < po.nroutes && *sym_lines < 60; i++)
            if (!has_route(&pn, &po.routes[i])) {
                sb_printf(md, "  - removed route `%s %s`\n",
                          po.routes[i].method, po.routes[i].pattern);
                (*sym_lines)++;
            }
        parse_result_free(&po);
        parse_result_free(&pn);
    }
    free(od);
    free(nd);
}

int cmd_changelog(Cg *cg, int limit, const char *outfile) {
    char hash[65];
    if (head_read(cg, hash) != 0) {
        fprintf(stderr, "cg: no commits yet — run `cg commit -m ...` first\n");
        return 1;
    }
    lang_global_init();
    StrBuf md; sb_init(&md);
    sb_puts(&md, "# Changelog\n\n_Generated by Codify " CG_VERSION
                 " from local snapshots (`cg log`). Symbol-level changes are "
                 "derived from the code graph._\n");
    int n = 0;
    while (n < limit && hash[0]) {
        Commit c;
        if (commit_load(cg, hash, &c) != 0) break;
        char when[64] = "?";
        time_t t = (time_t)c.date;
        struct tm tmv;
        if (localtime_r(&t, &tmv))
            strftime(when, sizeof when, "%Y-%m-%d %H:%M", &tmv);
        sb_printf(&md, "\n## %s — %s (`%.12s`)\n\n", when,
                  c.message && c.message[0] ? c.message : "(no message)", hash);

        if (!c.parent[0]) {
            Manifest m = {0};
            man_load(cg, c.tree, &m);
            sb_printf(&md, "Initial snapshot — %d files.\n", m.n);
            man_free(&m);
        } else {
            Commit pc;
            Manifest ma = {0}, mb = {0};
            if (commit_load(cg, c.parent, &pc) == 0) {
                man_load(cg, pc.tree, &ma);   /* old */
                free(pc.message);
            }
            man_load(cg, c.tree, &mb);         /* new */
            int added = 0, deleted = 0, modified = 0, listed = 0, sym_lines = 0;
            long tot_add = 0, tot_del = 0;
            StrBuf body; sb_init(&body);
            int ai = 0, bi = 0;
            while (ai < ma.n || bi < mb.n) {
                int cmp = (ai >= ma.n) ? 1 : (bi >= mb.n) ? -1
                        : strcmp(ma.v[ai].path, mb.v[bi].path);
                if (cmp == 0) {
                    if (strcmp(ma.v[ai].hash, mb.v[bi].hash) != 0) {
                        modified++;
                        if (listed++ < 50)
                            changelog_file(cg, &body, mb.v[bi].path,
                                           ma.v[ai].hash, mb.v[bi].hash,
                                           &sym_lines, &tot_add, &tot_del);
                        else {
                            long a = 0, d = 0;
                            size_t ol = 0, nl2 = 0;
                            char *od = obj_read(cg, ma.v[ai].hash, &ol);
                            char *nd = obj_read(cg, mb.v[bi].hash, &nl2);
                            if (od && nd && !looks_binary(od, ol) &&
                                !looks_binary(nd, nl2)) {
                                line_delta(od, ol, nd, nl2, &a, &d);
                                tot_add += a;
                                tot_del += d;
                            }
                            free(od); free(nd);
                        }
                    }
                    ai++; bi++;
                } else if (cmp < 0) {
                    deleted++;
                    size_t bl = 0;
                    char *bd = obj_read(cg, ma.v[ai].hash, &bl);
                    long lines = bd && !looks_binary(bd, bl)
                                   ? count_lines(bd, bl) : 0;
                    tot_del += lines;
                    free(bd);
                    if (listed++ < 50)
                        sb_printf(&body, "- Deleted `%s` (−%ld)\n",
                                  ma.v[ai].path, lines);
                    ai++;
                } else {
                    added++;
                    size_t bl = 0;
                    char *bd = obj_read(cg, mb.v[bi].hash, &bl);
                    bool binary = !bd || looks_binary(bd, bl);
                    long lines = binary ? 0 : count_lines(bd, bl);
                    tot_add += lines;
                    if (listed++ < 50) {
                        if (binary)
                            sb_printf(&body, "- New file `%s` (binary, %ld bytes)\n",
                                      mb.v[bi].path, mb.v[bi].size);
                        else
                            sb_printf(&body, "- New file `%s` (+%ld)\n",
                                      mb.v[bi].path, lines);
                        const char *lang = lang_for_path(mb.v[bi].path);
                        if (lang && bd && !binary) {
                            ParseResult pr;
                            lang_parse(lang, mb.v[bi].path, bd, bl, &pr);
                            int shown = 0;
                            for (int k = 0; k < pr.ndefs && shown < 8 &&
                                            sym_lines < 60; k++, shown++) {
                                sb_printf(&body, "  - added %s `%s` (line %d)\n",
                                          pr.defs[k].kind, pr.defs[k].name,
                                          pr.defs[k].line);
                                sym_lines++;
                            }
                            if (pr.ndefs > shown)
                                sb_printf(&body, "  - …and %d more symbols\n",
                                          pr.ndefs - shown);
                            parse_result_free(&pr);
                        }
                    }
                    free(bd);
                    bi++;
                }
            }
            sb_printf(&md, "**%d file%s changed** (%d added, %d modified, "
                           "%d deleted), **+%ld −%ld lines**\n\n",
                      added + modified + deleted,
                      added + modified + deleted == 1 ? "" : "s",
                      added, modified, deleted, tot_add, tot_del);
            sb_puts(&md, body.p);
            if (listed > 50)
                sb_printf(&md, "- …and %d more file changes (+%ld −%ld total "
                               "includes them)\n", listed - 50, tot_add, tot_del);
            sb_free(&body);
            man_free(&ma);
            man_free(&mb);
        }
        snprintf(hash, 65, "%s", c.parent);
        free(c.message);
        n++;
    }
    sb_putc(&md, '\n');
    if (outfile) {
        char abs[4900];
        if (outfile[0] == '/') snprintf(abs, sizeof abs, "%s", outfile);
        else snprintf(abs, sizeof abs, "%s/%s", cg->root, outfile);
        if (write_entire_file(abs, md.p, md.len) != 0) {
            fprintf(stderr, "cg: cannot write %s\n", abs);
            sb_free(&md);
            return 1;
        }
        printf("wrote %s (%d release entr%s)\n", abs, n, n == 1 ? "y" : "ies");
    } else {
        fputs(md.p, stdout);
    }
    sb_free(&md);
    return 0;
}

/* ---------------- checkout ---------------- */

int cmd_checkout(Cg *cg, const char *id, bool force) {
    char hash[65];
    int rc = resolve_commit(cg, id, hash);
    if (rc == -2) { fprintf(stderr, "cg: ambiguous commit '%s'\n", id); return 1; }
    if (rc != 0)  { fprintf(stderr, "cg: cannot resolve '%s'\n", id); return 1; }

    if (!force) {
        TreeDiff td;
        tree_status(cg, &td, false);
        int dirty = td.na + td.nm + td.nd;
        sb_free(&td.added); sb_free(&td.modified); sb_free(&td.deleted);
        if (dirty) {
            fprintf(stderr, "cg: working tree has %d uncommitted change%s; "
                    "commit first or use --force\n", dirty, dirty == 1 ? "" : "s");
            return 1;
        }
    }

    Commit c;
    if (commit_load(cg, hash, &c) != 0) {
        fprintf(stderr, "cg: bad commit %s\n", hash);
        return 1;
    }
    Manifest target = {0}, current = {0};
    man_load(cg, c.tree, &target);
    free(c.message);
    snapshot_tree(cg, &current, false);

    int restored = 0, removed = 0;
    for (int i = 0; i < target.n; i++) {
        /* skip files already identical */
        MEnt key = {.path = target.v[i].path};
        MEnt *cur = bsearch(&key, current.v, (size_t)current.n, sizeof(MEnt),
                            ment_cmp);
        if (cur && strcmp(cur->hash, target.v[i].hash) == 0) continue;
        size_t len = 0;
        char *data = obj_read(cg, target.v[i].hash, &len);
        if (!data) {
            fprintf(stderr, "cg: missing object for %s\n", target.v[i].path);
            continue;
        }
        char abs[4900];
        snprintf(abs, sizeof abs, "%s/%s", cg->root, target.v[i].path);
        char *slash = strrchr(abs, '/');
        if (slash) {
            *slash = 0;
            mkdirs(abs);
            *slash = '/';
        }
        write_entire_file(abs, data, len);
        free(data);
        restored++;
    }
    for (int i = 0; i < current.n; i++) {
        MEnt key = {.path = current.v[i].path};
        if (!bsearch(&key, target.v, (size_t)target.n, sizeof(MEnt), ment_cmp)) {
            char abs[4900];
            snprintf(abs, sizeof abs, "%s/%s", cg->root, current.v[i].path);
            unlink(abs);
            removed++;
        }
    }
    head_write(cg, hash);
    printf("checked out %.12s: %d file%s restored, %d removed "
           "(run `cg sync` to refresh the graph)\n",
           hash, restored, restored == 1 ? "" : "s", removed);
    man_free(&target);
    man_free(&current);
    return 0;
}

/* ---------------- spec-trace helpers ---------------- */

typedef struct { char **v; int n, cap; } PathSet;

static void ps_add(PathSet *p, const char *path) {
    for (int i = 0; i < p->n; i++)
        if (strcmp(p->v[i], path) == 0) return;
    if (p->n == p->cap) {
        p->cap = p->cap ? p->cap * 2 : 32;
        p->v = xrealloc(p->v, sizeof(char *) * (size_t)p->cap);
    }
    p->v[p->n++] = xstrdup(path);
}

/* both manifests are path-sorted; add every added/modified/deleted path */
static void man_diff_paths(const Manifest *a, const Manifest *b, PathSet *p) {
    int ai = 0, bi = 0;
    while (ai < a->n || bi < b->n) {
        int c = (ai >= a->n) ? 1 : (bi >= b->n) ? -1
              : strcmp(a->v[ai].path, b->v[bi].path);
        if (c < 0)       ps_add(p, a->v[ai++].path);
        else if (c > 0)  ps_add(p, b->v[bi++].path);
        else {
            if (strcmp(a->v[ai].hash, b->v[bi].hash) != 0)
                ps_add(p, a->v[ai].path);
            ai++; bi++;
        }
    }
}

/* Commits whose snapshot changed `path`, newest first. This is the history
 * half of `cg why` — provenance for a file, walked from HEAD. */
int vcs_commits_for_path(Cg *cg, const char *path, int limit, char ***ids,
                         char ***msgs, long **dates) {
    *ids = NULL; *msgs = NULL; *dates = NULL;
    char hash[65];
    if (head_read(cg, hash) != 0) return 0;
    int n = 0, cap = 8;
    char **iv = xmalloc(sizeof(char *) * (size_t)cap);
    char **mv = xmalloc(sizeof(char *) * (size_t)cap);
    long *dv  = xmalloc(sizeof(long) * (size_t)cap);
    while (hash[0] && n < limit) {
        Commit c;
        if (commit_load(cg, hash, &c) != 0) break;
        Manifest cur, par;
        memset(&cur, 0, sizeof cur);
        memset(&par, 0, sizeof par);
        man_load(cg, c.tree, &cur);
        Commit pc;
        bool have_par = c.parent[0] && commit_load(cg, c.parent, &pc) == 0;
        if (have_par) man_load(cg, pc.tree, &par);

        PathSet ps;
        memset(&ps, 0, sizeof ps);
        man_diff_paths(&par, &cur, &ps);
        bool hit = false;
        for (int i = 0; i < ps.n; i++)
            if (strcmp(ps.v[i], path) == 0) { hit = true; break; }
        for (int i = 0; i < ps.n; i++) free(ps.v[i]);
        free(ps.v);
        man_free(&cur);
        man_free(&par);
        if (have_par) free(pc.message);

        if (hit) {
            if (n == cap) {
                cap *= 2;
                iv = xrealloc(iv, sizeof(char *) * (size_t)cap);
                mv = xrealloc(mv, sizeof(char *) * (size_t)cap);
                dv = xrealloc(dv, sizeof(long) * (size_t)cap);
            }
            iv[n] = xstrdup(hash);
            mv[n] = xstrdup(c.message ? c.message : "");
            dv[n] = c.date;
            n++;
        }
        snprintf(hash, sizeof hash, "%s", c.parent);
        free(c.message);
    }
    *ids = iv; *msgs = mv; *dates = dv;
    return n;
}

int vcs_find_commits(Cg *cg, const char *needle, char ***ids, char ***msgs,
                     long **dates) {
    *ids = NULL; *msgs = NULL; *dates = NULL;
    char hash[65];
    if (head_read(cg, hash) != 0) return 0;
    int n = 0, cap = 8;
    char **iv = xmalloc(sizeof(char *) * (size_t)cap);
    char **mv = xmalloc(sizeof(char *) * (size_t)cap);
    long *dv  = xmalloc(sizeof(long) * (size_t)cap);
    while (hash[0]) {
        Commit c;
        if (commit_load(cg, hash, &c) != 0) break;
        if (c.message && strstr(c.message, needle)) {
            if (n == cap) {
                cap *= 2;
                iv = xrealloc(iv, sizeof(char *) * (size_t)cap);
                mv = xrealloc(mv, sizeof(char *) * (size_t)cap);
                dv = xrealloc(dv, sizeof(long) * (size_t)cap);
            }
            iv[n] = xstrdup(hash);
            mv[n] = xstrdup(c.message);
            dv[n] = c.date;
            n++;
        }
        snprintf(hash, sizeof hash, "%s", c.parent);
        free(c.message);
    }
    *ids = iv; *msgs = mv; *dates = dv;
    return n;
}

int vcs_changed_paths(Cg *cg, const char *needle, char ***out) {
    PathSet p = {0};

    /* worktree vs HEAD (everything counts as changed when no HEAD yet) */
    Manifest work = {0}, headm = {0};
    snapshot_tree(cg, &work, false);
    char hash[65];
    bool has_head = head_read(cg, hash) == 0;
    if (has_head) {
        Commit c;
        if (commit_load(cg, hash, &c) == 0) {
            man_load(cg, c.tree, &headm);
            free(c.message);
        }
    }
    man_diff_paths(&work, &headm, &p);
    man_free(&work);
    man_free(&headm);

    /* plus everything changed by commits whose message contains needle */
    if (needle && has_head) {
        while (hash[0]) {
            Commit c;
            if (commit_load(cg, hash, &c) != 0) break;
            if (c.message && strstr(c.message, needle)) {
                Manifest tree = {0}, parent = {0};
                man_load(cg, c.tree, &tree);
                if (c.parent[0]) {
                    Commit pc;
                    if (commit_load(cg, c.parent, &pc) == 0) {
                        man_load(cg, pc.tree, &parent);
                        free(pc.message);
                    }
                }
                man_diff_paths(&tree, &parent, &p);
                man_free(&tree);
                man_free(&parent);
            }
            snprintf(hash, sizeof hash, "%s", c.parent);
            free(c.message);
        }
    }
    *out = p.v;
    return p.n;
}
