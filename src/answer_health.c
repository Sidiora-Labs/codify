#include "answer_health.h"
#include "watch_health.h"
#include "index_health.h"
#include <errno.h>
#include <sys/stat.h>
#include <unistd.h>

#define AH_FILES 16
#define AH_BYTES (4 * 1024 * 1024)
#define AH_FILE_BYTES (1024 * 1024)
#define AH_MS 25

typedef struct { Cg *cg; } StatusCall;
static int status_call(void *v) { return cmd_status(((StatusCall *)v)->cg, true); }

static bool table_exists(Cg *cg, const char *name) {
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?");
    sqlite3_bind_text(st, 1, name, -1, SQLITE_STATIC);
    bool yes = sqlite3_step(st) == SQLITE_ROW;
    sqlite3_finalize(st);
    return yes;
}

static long selected_branch(Cg *cg) {
    return cg->scope_branch > 0 ? cg->scope_branch : cg->branch_id;
}

static void branch_name(Cg *cg, long id, char *out, size_t cap) {
    snprintf(out, cap, "%s", cg->branch);
    if (cg->scope_branch == -1) { snprintf(out, cap, "*"); return; }
    if (id == cg->branch_id) return;
    sqlite3_stmt *st = cg_prep(cg, "SELECT name FROM branches WHERE id=?");
    sqlite3_bind_int64(st, 1, id);
    if (sqlite3_step(st) == SQLITE_ROW)
        snprintf(out, cap, "%s", sqlite3_column_text(st, 0));
    sqlite3_finalize(st);
}

static bool safe_path(const char *p) {
    if (!p || !*p || p[0] == '/') return false;
    for (const char *s = p; *s; s++)
        if ((s == p || s[-1] == '/') && s[0] == '.' && s[1] == '.' &&
            (s[2] == '/' || s[2] == 0)) return false;
    return true;
}

/* A bounded read makes validation independent of index pass outcomes. */
static const char *validate_file(const char *root, const char *path,
                                 const char *expected, long *bytes,
                                 long started) {
    if (!safe_path(path) || !expected || !expected[0]) return "unchecked";
    if (now_ms() - started >= AH_MS || *bytes >= AH_BYTES) return "unchecked";
    char full[8192];
    if (snprintf(full, sizeof full, "%s/%s", root, path) >= (int)sizeof full)
        return "unchecked";
    struct stat st;
    if (lstat(full, &st) != 0) return errno == ENOENT ? "stale" : "unchecked";
    if (!S_ISREG(st.st_mode) || st.st_size < 0 || st.st_size > AH_FILE_BYTES ||
        st.st_size > AH_BYTES - *bytes) return "unchecked";
    FILE *f = fopen(full, "rb");
    if (!f) return "unchecked";
    size_t n = (size_t)st.st_size;
    char *buf = xmalloc(n + 1);
    size_t got = fread(buf, 1, n, f);
    bool eof = fgetc(f) == EOF && !ferror(f);
    fclose(f);
    const char *result = "unchecked";
    if (got == n && eof && now_ms() - started < AH_MS) {
        char hash[65]; sha256_hex(buf, n, hash);
        result = strcmp(hash, expected) == 0 ? "verified" : "stale";
        *bytes += (long)n;
    }
    free(buf);
    return result;
}

static int get_paths(const char *json, char paths[AH_FILES][4096],
                     int *omitted) {
    int n = 0; *omitted = 0;
    if (!json) return 0;
    for (const char *p = json; (p = strstr(p, "\"path\"")); p += 6) {
        const char *q = p + 6;
        while (*q == ' ' || *q == '\t') q++;
        if (*q++ != ':') continue;
        while (*q == ' ' || *q == '\t') q++;
        if (*q != '"') continue;
        char *value = json_string_value(q);
        if (!value) continue;
        if (safe_path(value)) {
            int i;
            for (i = 0; i < n; i++) if (strcmp(paths[i], value) == 0) break;
            if (i == n) {
                if (n < AH_FILES) snprintf(paths[n++], sizeof paths[0], "%s", value);
                else (*omitted)++;
            }
        }
        free(value);
    }
    return n;
}

void answer_health_append(StrBuf *out, Cg *cg, const char *answer) {
    char branch[256];
    long bid = selected_branch(cg);
    branch_name(cg, bid, branch, sizeof branch);
    sb_puts(out, "\"index_health\":{\"branch\":");
    sb_json_str(out, branch);
    bool has_extraction = table_exists(cg, "extraction_health");
    sqlite3_stmt *counts = NULL;
    if (has_extraction) {
        counts = cg_prep(cg,
            "SELECT CASE WHEN h.status='complete' AND ("
            "COALESCE(h.extraction_version,0)<>?2 OR "
            "h.content_hash IS NULL OR h.last_success_hash IS NULL OR "
            "h.content_hash<>h.last_success_hash) THEN 'unchecked' "
            "ELSE COALESCE(h.status,'unchecked') END,COUNT(*) FROM files f "
            "LEFT JOIN extraction_health h ON h.branch_id=f.branch_id "
            "AND h.path=f.path WHERE (?1=-1 OR f.branch_id=?1) "
            "GROUP BY 1");
        sqlite3_bind_int64(counts, 1, cg->scope_branch == -1 ? -1 : bid);
        sqlite3_bind_int(counts, 2, CG_EXTRACTION_VERSION);
    } else {
        counts = cg_prep(cg, "SELECT 'unchecked',COUNT(*) FROM files f "
                             "WHERE (?1=-1 OR f.branch_id=?1)");
        sqlite3_bind_int64(counts, 1, cg->scope_branch == -1 ? -1 : bid);
    }
    int complete = 0, partial = 0, skipped = 0, failed = 0, unchecked = 0;
    while (counts && sqlite3_step(counts) == SQLITE_ROW) {
        const char *status = (const char *)sqlite3_column_text(counts, 0);
        int count = sqlite3_column_int(counts, 1);
        if (strcmp(status, "complete") == 0) complete += count;
        else if (strcmp(status, "partial") == 0) partial += count;
        else if (strcmp(status, "skipped") == 0) skipped += count;
        else if (strcmp(status, "failed") == 0) failed += count;
        else unchecked += count;
    }
    if (counts) sqlite3_finalize(counts);
    sb_printf(out, ",\"coverage\":{\"complete\":%d,\"partial\":%d,"
              "\"skipped\":%d,\"failed\":%d,\"unchecked\":%d}",
              complete, partial, skipped, failed, unchecked);
    sb_puts(out, ",\"parsers\":[");
    if (has_extraction) {
        sqlite3_stmt *st = cg_prep(cg,
            "SELECT COALESCE(h.parser,'unknown'),COUNT(*) "
            "FROM extraction_health h WHERE (?1=-1 OR h.branch_id=?1) "
            "GROUP BY h.parser ORDER BY COUNT(*) DESC,h.parser LIMIT 32");
        sqlite3_bind_int64(st, 1, cg->scope_branch == -1 ? -1 : bid);
        int i = 0;
        while (sqlite3_step(st) == SQLITE_ROW) {
            if (i++) sb_putc(out, ',');
            sb_puts(out, "{\"name\":");
            sb_json_str(out, (const char *)sqlite3_column_text(st, 0));
            sb_printf(out, ",\"files\":%d}", sqlite3_column_int(st, 1));
        }
        sqlite3_finalize(st);
    }
    sb_putc(out, ']');
    WatchHealth wh = {0};
    bool watch_ok = (cg->scope_branch == 0 || bid == cg->branch_id) &&
        cg->scope_branch != -1 && watch_health_read(cg, &wh);
    bool pending = !watch_ok || wh.pending;
    sb_printf(out, ",\"pending\":%s,\"degraded\":%s,\"reason\":",
              pending ? "true" : "false",
              pending || partial || failed || skipped || unchecked ? "true" : "false");
    sb_json_str(out, watch_ok ? (wh.pending ? wh.reason : "") : "health_unavailable");
    char key[64];
    snprintf(key, sizeof key, "last_index_at:%ld", bid);
    char *last = cg->scope_branch == -1 ? NULL : cg_meta_get(cg, key);
    sb_puts(out, ",\"state\":");
    sb_json_str(out, !last ? "unindexed" :
                pending || partial || failed || skipped || unchecked ?
                "degraded" : "recorded");
    sb_puts(out, ",\"last_index_at\":");
    if (last) sb_printf(out, "%ld", atol(last)); else sb_puts(out, "null");
    free(last);
    sb_puts(out, ",\"source_validation\":{");
    sb_printf(out, "\"limits\":{\"files\":%d,\"bytes\":%d,\"ms\":%d},"
              "\"files\":[", AH_FILES, AH_BYTES, AH_MS);
    char paths[AH_FILES][4096]; int omitted = 0;
    int n = get_paths(answer, paths, &omitted);
    int verified = 0, stale = 0, uncheck = 0;
    long bytes = 0, started = now_ms();
    sqlite3_stmt *file = has_extraction ? cg_prep(cg,
        "SELECT f.branch_id,f.hash,COALESCE(h.status,'unchecked'),"
        "COALESCE(h.parser,'unknown'),COALESCE(h.extraction_version,0),"
        "h.content_hash,h.last_success_hash "
        "FROM files f LEFT JOIN extraction_health h ON "
        "h.branch_id=f.branch_id AND h.path=f.path WHERE f.path=? "
        "AND (?=-1 OR f.branch_id=?) ORDER BY f.branch_id LIMIT 2") :
        cg_prep(cg, "SELECT f.branch_id,f.hash,'unchecked','unknown',0,NULL,NULL "
                    "FROM files f WHERE f.path=? AND (?=-1 OR f.branch_id=?) "
                    "ORDER BY f.branch_id LIMIT 2");
    for (int i = 0; i < n; i++) {
        sqlite3_bind_text(file, 1, paths[i], -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(file, 2, cg->scope_branch == -1 ? -1 : bid);
        sqlite3_bind_int64(file, 3, bid);
        const char *state = "unchecked";
        char extraction[32] = "unchecked", parser[64] = "unknown";
        if (sqlite3_step(file) == SQLITE_ROW) {
            long file_branch = sqlite3_column_int64(file, 0);
            const char *hash = (const char *)sqlite3_column_text(file, 1);
            snprintf(extraction, sizeof extraction, "%s",
                     sqlite3_column_text(file, 2));
            snprintf(parser, sizeof parser, "%s",
                     sqlite3_column_text(file, 3));
            if (strcmp(extraction, "complete") == 0 &&
                (sqlite3_column_int(file, 4) != CG_EXTRACTION_VERSION ||
                 sqlite3_column_type(file, 5) == SQLITE_NULL ||
                 sqlite3_column_type(file, 6) == SQLITE_NULL ||
                 strcmp((const char *)sqlite3_column_text(file, 5),
                        (const char *)sqlite3_column_text(file, 6)) != 0))
                snprintf(extraction, sizeof extraction, "unchecked");
            char tree[4096];
            const char *root = file_branch == cg->branch_id ? cg->root :
                branch_tree(cg, file_branch, tree, sizeof tree);
            /* An all-branch answer can name the same path more than once.
             * Without a branch on that row, certainty would be fabricated. */
            if (cg->scope_branch != -1 || sqlite3_step(file) != SQLITE_ROW)
                state = validate_file(root, paths[i], hash, &bytes, started);
        }
        sqlite3_reset(file); sqlite3_clear_bindings(file);
        if (i) sb_putc(out, ',');
        sb_puts(out, "{\"path\":"); sb_json_str(out, paths[i]);
        sb_puts(out, ",\"state\":"); sb_json_str(out, state);
        sb_puts(out, ",\"extraction\":"); sb_json_str(out, extraction);
        sb_puts(out, ",\"parser\":"); sb_json_str(out, parser);
        sb_putc(out, '}');
        if (strcmp(state, "verified") == 0) verified++;
        else if (strcmp(state, "stale") == 0) stale++;
        else uncheck++;
    }
    sqlite3_finalize(file);
    sb_printf(out, "],\"verified\":%d,\"stale\":%d,"
              "\"unchecked\":%d,\"omitted\":%d}}",
              verified, stale, uncheck, omitted);
}

char *answer_health_json(Cg *cg, const char *answer) {
    if (!answer) return NULL;
    size_t n = strlen(answer);
    while (n && (answer[n - 1] == '\n' || answer[n - 1] == ' ')) n--;
    if (!n || answer[0] != '{' || answer[n - 1] != '}') return xstrdup(answer);
    StrBuf out; sb_init(&out);
    for (size_t i = 0; i < n - 1; i++) sb_putc(&out, answer[i]);
    if (n > 2) sb_putc(&out, ',');
    answer_health_append(&out, cg, answer);
    sb_puts(&out, "}\n");
    return out.p;
}

int answer_health_status(Cg *cg, bool json) {
    if (!json) {
        int rc = cmd_status(cg, false);
        answer_health_text(cg);
        return rc;
    }
    StatusCall call = { cg }; char *base = NULL;
    int rc = cg_capture(&base, status_call, &call);
    char *result = answer_health_json(cg, base);
    if (result) fputs(result, stdout);
    free(base); free(result);
    return rc;
}

void answer_health_text(Cg *cg) {
    StrBuf b; sb_init(&b);
    sb_putc(&b, '{'); answer_health_append(&b, cg, NULL); sb_putc(&b, '}');
    char *h = json_get_object(b.p, "index_health");
    char *coverage = h ? json_get_object(h, "coverage") : NULL;
    char *reason = h ? json_get_string(h, "reason") : NULL;
    char *branch = h ? json_get_string(h, "branch") : NULL;
    printf("index: branch %s; complete %ld, partial %ld, skipped %ld, "
           "failed %ld, unchecked %ld%s%s\n", branch ? branch : cg->branch,
           coverage ? json_get_int(coverage, "complete", 0) : 0,
           coverage ? json_get_int(coverage, "partial", 0) : 0,
           coverage ? json_get_int(coverage, "skipped", 0) : 0,
           coverage ? json_get_int(coverage, "failed", 0) : 0,
           coverage ? json_get_int(coverage, "unchecked", 0) : 0,
           reason && reason[0] ? "; pending reconciliation: " : "",
           reason && reason[0] ? reason : "");
    free(h); free(coverage); free(reason); free(branch); sb_free(&b);
}

void answer_health_capture_begin(AnswerCapture *cap) {
    cap->saved_stdout = -1;
    cap->stream = tmpfile();
    if (!cap->stream) return;
    fflush(stdout);
    cap->saved_stdout = dup(STDOUT_FILENO);
    if (cap->saved_stdout < 0 ||
        dup2(fileno(cap->stream), STDOUT_FILENO) < 0) {
        if (cap->saved_stdout >= 0) close(cap->saved_stdout);
        cap->saved_stdout = -1;
        fclose(cap->stream);
        cap->stream = NULL;
    }
}

void answer_health_capture_end(AnswerCapture *cap, Cg *cg) {
    if (cap->saved_stdout < 0 || !cap->stream) return;
    fflush(stdout);
    dup2(cap->saved_stdout, STDOUT_FILENO);
    close(cap->saved_stdout);
    cap->saved_stdout = -1;
    long len = ftell(cap->stream);
    rewind(cap->stream);
    if (len < 0 || len > 8 * 1024 * 1024) {
        char buf[8192]; size_t n;
        while ((n = fread(buf, 1, sizeof buf, cap->stream)) > 0)
            fwrite(buf, 1, n, stdout);
    } else {
        char *raw = xmalloc((size_t)len + 1);
        size_t n = fread(raw, 1, (size_t)len, cap->stream);
        raw[n] = 0;
        char *out = answer_health_json(cg, raw);
        if (out) fputs(out, stdout);
        free(out); free(raw);
    }
    fclose(cap->stream);
    cap->stream = NULL;
}
