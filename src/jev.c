/*
 * Jev: TypeSafe AI's System One decision model, over curl.
 *
 * Codify's core loop — graph, memory, spec — runs with no network. Jev is
 * the one remote call, and the features built on it (memory
 * classification, failure triage, finding rank) treat it as mandatory: no
 * OPENROUTER_API_KEY means a clear error, never a quiet fallback. What Jev
 * returns is still advice. It narrows, ranks, and flags; verify_cmd and
 * the graph checks decide.
 *
 * One request is one POST to the decisions endpoint:
 *   {"model":M,"questions":{name:{"criteria":..,"instructions":..,"type":..}},"state":S}
 * built canonically (sorted names and criteria keys, compact) so the same
 * question always hashes the same in the log. The transport is the
 * system's curl, run through popen with a private config file: the key is
 * never on a command line where ps could read it, and the body goes
 * through a file so no shell ever sees it. 429 and 529 back off and retry;
 * anything else fails at once. Every call, failed or not, appends one JSON
 * line to .codegraph/jev.log.
 *
 * Knobs: CG_JEV_MODEL, CG_JEV_ENDPOINT, CG_JEV_CURL (a path or a name on
 * PATH; the tests point it at a fake), CG_JEV_TIMEOUT (seconds),
 * CG_JEV_ATTEMPTS, CG_JEV_BACKOFF_MS.
 */
#include "cg.h"
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <math.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define JEV_DEFAULT_MODEL    "typesafe/jev-1.13"
#define JEV_DEFAULT_ENDPOINT "https://openrouter.ai/api/alpha/decisions"
#define JEV_MAX_CHOICE       255
#define JEV_EXCERPT          512
#define JEV_MAX_ANSWERS      512

typedef struct {
    const char *key;        /* NULL when OPENROUTER_API_KEY is unset */
    char model[160];
    char endpoint[600];
    char curl[600];         /* name or path, before PATH lookup */
    long timeout_s;
    int attempts;
    long backoff_ms;
} JevConfig;

static void jev_config(JevConfig *c) {
    const char *e;
    memset(c, 0, sizeof *c);
    e = getenv("OPENROUTER_API_KEY");
    c->key = (e && e[0]) ? e : NULL;
    e = getenv("CG_JEV_MODEL");
    snprintf(c->model, sizeof c->model, "%s", (e && e[0]) ? e : JEV_DEFAULT_MODEL);
    e = getenv("CG_JEV_ENDPOINT");
    snprintf(c->endpoint, sizeof c->endpoint, "%s",
             (e && e[0]) ? e : JEV_DEFAULT_ENDPOINT);
    e = getenv("CG_JEV_CURL");
    snprintf(c->curl, sizeof c->curl, "%s", (e && e[0]) ? e : "curl");
    e = getenv("CG_JEV_TIMEOUT");
    c->timeout_s = (e && atol(e) > 0) ? atol(e) : 30;
    e = getenv("CG_JEV_ATTEMPTS");
    c->attempts = (e && atoi(e) > 0) ? atoi(e) : 4;
    e = getenv("CG_JEV_BACKOFF_MS");
    c->backoff_ms = (e && atol(e) >= 0 && e[0]) ? atol(e) : 500;
}

/* ---------------- questions ---------------- */

static char **dup_list(const char *const *v, int n) {
    if (n <= 0 || !v) return NULL;
    char **out = xmalloc(sizeof(char *) * (size_t)n);
    for (int i = 0; i < n; i++) out[i] = xstrdup(v[i] ? v[i] : "");
    return out;
}

int jev_question_noul(JevQuestion *q, const char *name,
                      const char *instructions, const char *when_true,
                      const char *when_false) {
    memset(q, 0, sizeof *q);
    q->type = JEV_NOUL;
    q->name = xstrdup(name);
    q->instructions = xstrdup(instructions ? instructions : "");
    if (when_true || when_false) {
        const char *keys[2] = { "true", "false" };
        const char *descs[2] = { when_true ? when_true : "",
                                 when_false ? when_false : "" };
        q->keys = dup_list(keys, 2);
        q->descs = dup_list(descs, 2);
        q->n = 2;
    }
    return 0;
}

int jev_question_choice(JevQuestion *q, const char *name,
                        const char *instructions, const char *const *keys,
                        const char *const *descs, int n) {
    memset(q, 0, sizeof *q);
    if (n < 2 || n > JEV_MAX_CHOICE) return -1;
    q->type = JEV_CHOICE;
    q->name = xstrdup(name);
    q->instructions = xstrdup(instructions ? instructions : "");
    q->keys = dup_list(keys, n);
    q->descs = dup_list(descs, n);
    q->n = n;
    return 0;
}

int jev_question_score(JevQuestion *q, const char *name,
                       const char *instructions, const char *const *levels,
                       int n) {
    memset(q, 0, sizeof *q);
    if (n < 2) return -1;
    q->type = JEV_SCORE;
    q->name = xstrdup(name);
    q->instructions = xstrdup(instructions ? instructions : "");
    q->descs = dup_list(levels, n);
    q->n = n;
    return 0;
}

void jev_question_free(JevQuestion *q) {
    free(q->name); free(q->instructions);
    for (int i = 0; i < q->n; i++) {
        if (q->keys) free(q->keys[i]);
        if (q->descs) free(q->descs[i]);
    }
    free(q->keys); free(q->descs);
    memset(q, 0, sizeof *q);
}

/* ---------------- request body ---------------- */

static const char *jev_type_name(int t) {
    return t == JEV_NOUL ? "noul" : t == JEV_CHOICE ? "choice" : "score";
}

/* Just enough of a JSON check to refuse a state that would make the whole
 * request unreadable server-side: one value, balanced, nothing after it. */
static bool json_value_ok(const char *s) {
    const char *p = s;
    while (*p && isspace((unsigned char)*p)) p++;
    if (!*p) return false;
    if (*p == '{' || *p == '[') {
        int depth = 0;
        for (; *p; p++) {
            if (*p == '"') {
                p++;
                while (*p && *p != '"') { if (*p == '\\' && p[1]) p++; p++; }
                if (!*p) return false;
                continue;
            }
            if (*p == '{' || *p == '[') depth++;
            else if (*p == '}' || *p == ']') { if (--depth == 0) { p++; break; } }
        }
        if (depth != 0) return false;
    } else if (*p == '"') {
        p++;
        while (*p && *p != '"') { if (*p == '\\' && p[1]) p++; p++; }
        if (!*p) return false;
        p++;
    } else if (strncmp(p, "true", 4) == 0) p += 4;
    else if (strncmp(p, "false", 5) == 0) p += 5;
    else if (strncmp(p, "null", 4) == 0) p += 4;
    else if (*p == '-' || isdigit((unsigned char)*p)) {
        char *e; strtod(p, &e); if (e == p) return false; p = e;
    } else return false;
    while (*p && isspace((unsigned char)*p)) p++;
    return *p == 0;
}

static int cmp_str_idx(const void *a, const void *b, void *arg) {
    char **v = arg;
    return strcmp(v[*(const int *)a], v[*(const int *)b]);
}

static void sorted_order(char **v, int n, int *idx) {
    for (int i = 0; i < n; i++) idx[i] = i;
    qsort_r(idx, (size_t)n, sizeof idx[0], cmp_str_idx, v);
}

static void sb_question(StrBuf *b, const JevQuestion *q) {
    sb_putc(b, '{');
    if (q->type == JEV_SCORE) {
        sb_puts(b, "\"criteria\":[");
        for (int i = 0; i < q->n; i++) {
            if (i) sb_putc(b, ',');
            sb_json_str(b, q->descs[i]);
        }
        sb_puts(b, "],");
    } else if (q->n > 0) {
        int *idx = xmalloc(sizeof(int) * (size_t)q->n);
        sorted_order(q->keys, q->n, idx);
        sb_puts(b, "\"criteria\":{");
        for (int i = 0; i < q->n; i++) {
            if (i) sb_putc(b, ',');
            sb_json_str(b, q->keys[idx[i]]);
            sb_putc(b, ':');
            sb_json_str(b, q->descs[idx[i]]);
        }
        sb_puts(b, "},");
        free(idx);
    }
    sb_puts(b, "\"instructions\":");
    sb_json_str(b, q->instructions);
    sb_puts(b, ",\"type\":\"");
    sb_puts(b, jev_type_name(q->type));
    sb_puts(b, "\"}");
}

void jev_request_json(const char *model, const char *state_json,
                      const JevQuestion *qs, int nq, StrBuf *out) {
    char **names = xmalloc(sizeof(char *) * (size_t)(nq > 0 ? nq : 1));
    int *idx = xmalloc(sizeof(int) * (size_t)(nq > 0 ? nq : 1));
    for (int i = 0; i < nq; i++) names[i] = qs[i].name;
    sorted_order(names, nq, idx);
    sb_puts(out, "{\"model\":");
    sb_json_str(out, model);
    sb_puts(out, ",\"questions\":{");
    for (int i = 0; i < nq; i++) {
        if (i) sb_putc(out, ',');
        sb_json_str(out, qs[idx[i]].name);
        sb_putc(out, ':');
        sb_question(out, &qs[idx[i]]);
    }
    sb_puts(out, "},\"state\":");
    const char *s = state_json;
    while (*s && isspace((unsigned char)*s)) s++;
    size_t n = strlen(s);
    while (n > 0 && isspace((unsigned char)s[n - 1])) n--;
    for (size_t i = 0; i < n; i++) sb_putc(out, s[i]);
    sb_putc(out, '}');
    free(names); free(idx);
}

/* ---------------- transport ---------------- */

/* curl's config-file quoting: backslash and double quote escaped */
static void sb_cfgquote(StrBuf *b, const char *s) {
    sb_putc(b, '"');
    for (; *s; s++) {
        if (*s == '"' || *s == '\\') sb_putc(b, '\\');
        if (*s == '\n' || *s == '\r') continue;
        sb_putc(b, *s);
    }
    sb_putc(b, '"');
}

/* Where the per-call config and body live: inside the project's
 * .codegraph, or a private per-user directory when there is no project.
 * Both files are 0600 and removed after the call. */
static int jev_tmp_dir(const Cg *cg, char *out, size_t cap) {
    if (cg) {
        snprintf(out, cap, "%s/%s", cg->shared, CG_DIR);
        return 0;
    }
    snprintf(out, cap, "/tmp/codify-%ld", (long)getuid());
    if (mkdir(out, 0700) != 0 && errno != EEXIST) return -1;
    struct stat st;
    if (stat(out, &st) != 0 || !S_ISDIR(st.st_mode) || st.st_uid != getuid())
        return -1;
    return 0;
}

static int write_private(const char *path, const char *data) {
    int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
    if (fd < 0) return -1;
    size_t len = strlen(data), off = 0;
    while (off < len) {
        ssize_t w = write(fd, data + off, len - off);
        if (w <= 0) { close(fd); return -1; }
        off += (size_t)w;
    }
    close(fd);
    return 0;
}

static void sleep_ms(long ms) {
    if (ms <= 0) return;
    struct timespec ts = { ms / 1000, (ms % 1000) * 1000000L };
    nanosleep(&ts, NULL);
}

static void excerpt_of(const char *s, char *out, size_t cap) {
    while (*s && isspace((unsigned char)*s)) s++;
    size_t n = 0;
    for (; s[n] && n < cap - 1 && n < JEV_EXCERPT; n++) out[n] = s[n];
    while (n > 0 && isspace((unsigned char)out[n - 1])) n--;
    out[n] = 0;
    for (size_t i = 0; i < n; i++) if (out[i] == '\n' || out[i] == '\r') out[i] = ' ';
}

/* One curl run. *body gets the response (malloc'd, status line stripped),
 * *status the HTTP code (0 when curl never got one). Returns curl's exit
 * code, -1 when it could not be started. */
static int curl_once(const char *curl, const char *cfg, char **body,
                     int *status) {
    StrBuf cmd; sb_init(&cmd);
    sb_shquote(&cmd, curl);
    sb_puts(&cmd, " -K ");
    sb_shquote(&cmd, cfg);
    sb_puts(&cmd, " 2>&1");
    *body = NULL; *status = 0;
    FILE *f = popen(cmd.p, "r");
    sb_free(&cmd);
    if (!f) return -1;
    StrBuf out; sb_init(&out);
    char buf[8192];
    size_t n;
    while ((n = fread(buf, 1, sizeof buf, f)) > 0)
        for (size_t i = 0; i < n; i++) sb_putc(&out, buf[i]);
    int rc = pclose(f);
    rc = WIFEXITED(rc) ? WEXITSTATUS(rc) : -1;
    /* write-out appends "\n<code>" to whatever curl printed */
    char *nl = strrchr(out.p, '\n');
    if (nl) {
        const char *code = nl + 1;
        if (strlen(code) == 3 && isdigit((unsigned char)code[0]) &&
            isdigit((unsigned char)code[1]) && isdigit((unsigned char)code[2])) {
            *status = atoi(code);
            *nl = 0;
        }
    }
    *body = out.p;
    return rc;
}

/* ---------------- response ---------------- */

static double jnum(const char *obj, const char *key, bool *ok) {
    char *raw = json_get_raw(obj, key);
    if (!raw || !(raw[0] == '-' || isdigit((unsigned char)raw[0]))) {
        free(raw);
        if (ok) *ok = false;
        return NAN;
    }
    double v = strtod(raw, NULL);
    free(raw);
    return v;
}

static int jev_parse(const char *resp, JevResult *out) {
    const char *p = resp;
    while (*p && isspace((unsigned char)*p)) p++;
    char ex[JEV_EXCERPT + 1];
    if (*p != '{') {
        excerpt_of(resp, ex, sizeof ex);
        snprintf(out->error, sizeof out->error,
                 "jev response is not JSON: %s", ex[0] ? ex : "(empty)");
        return JEV_EPARSE;
    }
    char *answers = json_get_object(resp, "answers");
    if (!answers) {
        excerpt_of(resp, ex, sizeof ex);
        snprintf(out->error, sizeof out->error,
                 "jev response carries no answers object: %s", ex);
        return JEV_EPARSE;
    }
    char **keys = xmalloc(sizeof(char *) * JEV_MAX_ANSWERS);
    int n = json_object_keys(answers, keys, JEV_MAX_ANSWERS);
    out->answers = xmalloc(sizeof(JevAnswer) * (size_t)(n > 0 ? n : 1));
    memset(out->answers, 0, sizeof(JevAnswer) * (size_t)(n > 0 ? n : 1));
    int rc = JEV_OK;
    for (int i = 0; i < n && rc == JEV_OK; i++) {
        JevAnswer *a = &out->answers[out->n];
        char *obj = json_get_object(answers, keys[i]);
        char *type = obj ? json_get_string(obj, "type") : NULL;
        bool ok = true;
        if (!obj) {
            snprintf(out->error, sizeof out->error,
                     "jev answer %s is not an object", keys[i]);
            rc = JEV_EPARSE;
        } else if (type && strcmp(type, "noul") == 0) {
            a->type = JEV_NOUL;
            a->value = jnum(obj, "noul", &ok);
            a->confidence = a->value > 0.5 ? a->value : 1.0 - a->value;
        } else if (type && strcmp(type, "choice") == 0) {
            a->type = JEV_CHOICE;
            a->choice = json_get_string(obj, "choice");
            if (!a->choice) ok = false;
            a->confidence = jnum(obj, "confidence", NULL);
            a->probabilities = json_get_object(obj, "probabilities");
        } else if (type && strcmp(type, "score") == 0) {
            a->type = JEV_SCORE;
            a->value = jnum(obj, "score", &ok);
            a->confidence = jnum(obj, "confidence", NULL);
            a->probabilities = json_get_object(obj, "probabilities");
            a->legend = json_get_object(obj, "legend");
        } else {
            snprintf(out->error, sizeof out->error,
                     "jev answer %s has unsupported type %s", keys[i],
                     type ? type : "(none)");
            rc = JEV_EPARSE;
        }
        if (rc == JEV_OK && !ok) {
            snprintf(out->error, sizeof out->error,
                     "jev answer %s has no %s value", keys[i], type);
            rc = JEV_EPARSE;
        }
        if (rc == JEV_OK) { a->name = xstrdup(keys[i]); out->n++; }
        else { free(a->choice); free(a->probabilities); free(a->legend); }
        free(type); free(obj);
    }
    for (int i = 0; i < n; i++) free(keys[i]);
    free(keys); free(answers);
    if (rc != JEV_OK) return rc;
    char *usage = json_get_object(resp, "usage");
    if (usage) {
        out->input_tokens = json_get_int(usage, "input_tokens", 0);
        out->output_tokens = json_get_int(usage, "output_tokens", 0);
        double c = jnum(usage, "cost", NULL);
        out->cost = isnan(c) ? 0 : c;
        free(usage);
    }
    out->model = json_get_string(resp, "model");
    if (!out->model) out->model = xstrdup(out->requested_model);
    out->id = json_get_string(resp, "id");
    if (!out->id) out->id = xstrdup("");
    return JEV_OK;
}

const JevAnswer *jev_answer(const JevResult *r, const char *name) {
    for (int i = 0; i < r->n; i++)
        if (strcmp(r->answers[i].name, name) == 0) return &r->answers[i];
    return NULL;
}

void jev_result_free(JevResult *r) {
    for (int i = 0; i < r->n; i++) {
        JevAnswer *a = &r->answers[i];
        free(a->name); free(a->choice); free(a->probabilities); free(a->legend);
    }
    free(r->answers);
    free(r->model); free(r->requested_model); free(r->id);
    memset(r, 0, sizeof *r);
}

/* ---------------- log ---------------- */

static void jev_log_path(const Cg *cg, char *out, size_t cap) {
    snprintf(out, cap, "%s/%s/jev.log", cg->shared, CG_DIR);
}

/* One line per call. A failed call logs its status and error so an
 * operator can see a bad key or a rate limit without re-running. */
static void jev_log(const Cg *cg, const JevConfig *c, const JevResult *r,
                    int nq, const char *body, const char *resp) {
    if (!cg) return;
    char path[4700];
    jev_log_path(cg, path, sizeof path);
    StrBuf b; sb_init(&b);
    sb_printf(&b, "{\"ts\":%ld,\"requested_model\":", (long)time(NULL));
    sb_json_str(&b, c->model);
    sb_puts(&b, ",\"endpoint\":");
    sb_json_str(&b, c->endpoint);
    sb_printf(&b, ",\"questions\":%d,\"status\":%d,\"attempts\":%d,\"ms\":%ld",
              nq, r->status, r->attempts, r->ms);
    char hex[65];
    if (body) {
        sha256_hex(body, strlen(body), hex);
        sb_printf(&b, ",\"request_sha256\":\"%s\"", hex);
    }
    if (r->error[0]) {
        sb_puts(&b, ",\"error\":");
        sb_json_str(&b, r->error);
    } else {
        sb_puts(&b, ",\"model\":");
        sb_json_str(&b, r->model ? r->model : c->model);
        sb_puts(&b, ",\"id\":");
        sb_json_str(&b, r->id ? r->id : "");
        sb_printf(&b, ",\"input_tokens\":%ld,\"output_tokens\":%ld,\"cost\":%.10g",
                  r->input_tokens, r->output_tokens, r->cost);
        if (resp) {
            sha256_hex(resp, strlen(resp), hex);
            sb_printf(&b, ",\"response_sha256\":\"%s\"", hex);
        }
    }
    sb_puts(&b, "}\n");
    int fd = open(path, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0644);
    if (fd >= 0) {
        if (write(fd, b.p, strlen(b.p)) < 0) { /* best effort */ }
        close(fd);
    }
    sb_free(&b);
}

/* ---------------- the call ---------------- */

static int count_questions(const char *body) {
    char *qs = json_get_object(body, "questions");
    if (!qs) return 0;
    char **keys = xmalloc(sizeof(char *) * JEV_MAX_ANSWERS);
    int n = json_object_keys(qs, keys, JEV_MAX_ANSWERS);
    for (int i = 0; i < n; i++) free(keys[i]);
    free(keys); free(qs);
    return n;
}

int jev_ask_raw(Cg *cg, const char *body_in, JevResult *out) {
    memset(out, 0, sizeof *out);
    JevConfig c;
    jev_config(&c);
    out->requested_model = xstrdup(c.model);
    if (!c.key) {
        snprintf(out->error, sizeof out->error,
                 "OPENROUTER_API_KEY is not set. Jev is mandatory for this "
                 "command — export the key in the agent's environment "
                 "(cg jev doctor checks it)");
        return JEV_ECONFIG;
    }
    char curl[4096];
    if (!cg_find_exe(c.curl, curl, sizeof curl)) {
        snprintf(out->error, sizeof out->error,
                 "curl not found (looked for \"%.200s\"); install curl or set "
                 "CG_JEV_CURL to its path", c.curl);
        return JEV_ECONFIG;
    }
    /* a body without a model gets the configured one */
    char *body = NULL;
    char *m = json_get_string(body_in, "model");
    if (m) { body = xstrdup(body_in); free(m); }
    else {
        const char *p = body_in;
        while (*p && isspace((unsigned char)*p)) p++;
        if (*p != '{') {
            snprintf(out->error, sizeof out->error, "jev request is not a JSON object");
            return JEV_EPARSE;
        }
        StrBuf b; sb_init(&b);
        sb_puts(&b, "{\"model\":");
        sb_json_str(&b, c.model);
        sb_putc(&b, ',');
        sb_puts(&b, p + 1);
        body = b.p;
    }
    int nq = count_questions(body);

    char dir[4300], cfg[4400], bodyp[4400];
    if (jev_tmp_dir(cg, dir, sizeof dir) != 0) {
        snprintf(out->error, sizeof out->error,
                 "cannot create a private directory for the request under %.300s", dir);
        free(body);
        return JEV_ECONFIG;
    }
    snprintf(cfg, sizeof cfg, "%s/jev.%ld.cfg", dir, (long)getpid());
    snprintf(bodyp, sizeof bodyp, "%s/jev.%ld.body", dir, (long)getpid());
    StrBuf cf; sb_init(&cf);
    sb_puts(&cf, "url = "); sb_cfgquote(&cf, c.endpoint); sb_putc(&cf, '\n');
    sb_puts(&cf, "request = \"POST\"\n");
    StrBuf auth; sb_init(&auth);
    sb_printf(&auth, "Authorization: Bearer %s", c.key);
    sb_puts(&cf, "header = "); sb_cfgquote(&cf, auth.p); sb_putc(&cf, '\n');
    sb_free(&auth);
    sb_puts(&cf, "header = \"Content-Type: application/json\"\n"
                 "header = \"Accept: application/json\"\n"
                 "header = \"X-Title: codify\"\n");
    sb_puts(&cf, "data-binary = ");
    StrBuf at; sb_init(&at); sb_printf(&at, "@%s", bodyp);
    sb_cfgquote(&cf, at.p); sb_putc(&cf, '\n');
    sb_free(&at);
    sb_printf(&cf, "silent\nshow-error\nmax-time = %ld\n"
                   "write-out = \"\\n%%{http_code}\"\n", c.timeout_s);
    if (write_private(bodyp, body) != 0 || write_private(cfg, cf.p) != 0) {
        snprintf(out->error, sizeof out->error,
                 "cannot write the request under %.300s: %s", dir, strerror(errno));
        sb_free(&cf); free(body);
        unlink(bodyp); unlink(cfg);
        return JEV_ECONFIG;
    }
    sb_free(&cf);

    long t0 = now_ms();
    char *resp = NULL;
    int status = 0, crc = 0, rc = JEV_EREQUEST;
    for (int attempt = 1; attempt <= c.attempts; attempt++) {
        out->attempts = attempt;
        free(resp);
        crc = curl_once(curl, cfg, &resp, &status);
        if (crc == 0 && status >= 200 && status < 300) { rc = JEV_OK; break; }
        bool retry = crc != 0 || status == 0 || status == 429 || status == 529;
        if (!retry) break;
        if (attempt < c.attempts) sleep_ms(c.backoff_ms << (attempt - 1));
    }
    unlink(bodyp); unlink(cfg);
    out->ms = now_ms() - t0;
    out->status = status;
    if (rc != JEV_OK) {
        char ex[JEV_EXCERPT + 1];
        excerpt_of(resp ? resp : "", ex, sizeof ex);
        char tries[48] = "";
        if (out->attempts > 1)
            snprintf(tries, sizeof tries, " after %d attempts", out->attempts);
        if (crc != 0)
            snprintf(out->error, sizeof out->error, "jev: curl exited %d%s: %s",
                     crc, tries, ex[0] ? ex : "(no output)");
        else
            snprintf(out->error, sizeof out->error,
                     "jev request failed (status %d)%s: %s", status, tries,
                     ex[0] ? ex : "(empty response)");
        jev_log(cg, &c, out, nq, body, NULL);
        free(resp); free(body);
        return JEV_EREQUEST;
    }
    rc = jev_parse(resp, out);
    jev_log(cg, &c, out, nq, body, rc == JEV_OK ? resp : NULL);
    free(resp); free(body);
    return rc;
}

int jev_ask(Cg *cg, const char *state_json, const JevQuestion *qs, int nq,
            JevResult *out) {
    memset(out, 0, sizeof *out);
    if (nq <= 0) {
        snprintf(out->error, sizeof out->error, "jev: no questions to ask");
        return JEV_ECONFIG;
    }
    if (!state_json || !json_value_ok(state_json)) {
        snprintf(out->error, sizeof out->error, "jev: state is not JSON");
        return JEV_ECONFIG;
    }
    JevConfig c;
    jev_config(&c);
    StrBuf body; sb_init(&body);
    jev_request_json(c.model, state_json, qs, nq, &body);
    int rc = jev_ask_raw(cg, body.p, out);
    sb_free(&body);
    return rc;
}

/* ---------------- printing ---------------- */

static void print_probabilities(const char *probs, StrBuf *b) {
    char *keys[JEV_MAX_CHOICE + 2];
    int n = json_object_keys(probs, keys, JEV_MAX_CHOICE + 2);
    for (int i = 0; i < n; i++) {
        double v = jnum(probs, keys[i], NULL);
        sb_printf(b, "%s%s %.2f", i ? ", " : "", keys[i], isnan(v) ? 0.0 : v);
        free(keys[i]);
    }
}

static void jev_result_json(const JevResult *r, StrBuf *b) {
    sb_puts(b, "{\"model\":"); sb_json_str(b, r->model ? r->model : "");
    sb_puts(b, ",\"requested_model\":");
    sb_json_str(b, r->requested_model ? r->requested_model : "");
    sb_puts(b, ",\"id\":"); sb_json_str(b, r->id ? r->id : "");
    sb_printf(b, ",\"usage\":{\"input_tokens\":%ld,\"output_tokens\":%ld,"
                 "\"cost\":%.10g},\"attempts\":%d,\"ms\":%ld,\"answers\":{",
              r->input_tokens, r->output_tokens, r->cost, r->attempts, r->ms);
    for (int i = 0; i < r->n; i++) {
        const JevAnswer *a = &r->answers[i];
        if (i) sb_putc(b, ',');
        sb_json_str(b, a->name);
        sb_printf(b, ":{\"type\":\"%s\",\"value\":", jev_type_name(a->type));
        if (a->type == JEV_CHOICE) sb_json_str(b, a->choice);
        else sb_printf(b, "%.10g", a->value);
        if (isnan(a->confidence)) sb_puts(b, ",\"confidence\":null");
        else sb_printf(b, ",\"confidence\":%.10g", a->confidence);
        if (a->probabilities) {
            sb_puts(b, ",\"probabilities\":");
            sb_puts(b, a->probabilities);
        }
        if (a->legend) {
            sb_puts(b, ",\"legend\":");
            sb_puts(b, a->legend);
        }
        sb_putc(b, '}');
    }
    sb_puts(b, "}}\n");
}

static void jev_result_text(const JevResult *r, StrBuf *b) {
    int w = 8;
    for (int i = 0; i < r->n; i++) {
        int l = (int)strlen(r->answers[i].name);
        if (l > w) w = l;
    }
    for (int i = 0; i < r->n; i++) {
        const JevAnswer *a = &r->answers[i];
        sb_printf(b, "%-*s  %-6s  ", w, a->name, jev_type_name(a->type));
        if (a->type == JEV_NOUL) {
            sb_printf(b, "%.2f  (%s)", a->value,
                      a->value >= 0.5 ? "yes" : "no");
        } else if (a->type == JEV_CHOICE) {
            sb_puts(b, a->choice);
            if (!isnan(a->confidence)) sb_printf(b, "  confidence %.2f", a->confidence);
            if (a->probabilities) {
                sb_puts(b, "  [");
                print_probabilities(a->probabilities, b);
                sb_putc(b, ']');
            }
        } else {
            sb_printf(b, "%.2f", a->value);
            if (a->legend) {
                char key[32];
                snprintf(key, sizeof key, "%ld", lround(a->value));
                char *lvl = json_get_string(a->legend, key);
                if (lvl) { sb_printf(b, " ~ %s", lvl); free(lvl); }
            }
            if (!isnan(a->confidence)) sb_printf(b, "  confidence %.2f", a->confidence);
        }
        sb_putc(b, '\n');
    }
    sb_printf(b, "model %s · %ld in, %ld out · $%.6f · %ld ms", r->model,
              r->input_tokens, r->output_tokens, r->cost, r->ms);
    if (r->attempts > 1) sb_printf(b, " · %d attempts", r->attempts);
    sb_putc(b, '\n');
}

/* ---------------- cg jev ask ---------------- */

typedef struct {
    JevQuestion *qs; int n, cap;
} AskArgs;

static JevQuestion *ask_push(AskArgs *a) {
    if (a->n == a->cap) {
        a->cap = a->cap ? a->cap * 2 : 4;
        a->qs = xrealloc(a->qs, sizeof(JevQuestion) * (size_t)a->cap);
    }
    JevQuestion *q = &a->qs[a->n++];
    memset(q, 0, sizeof *q);
    return q;
}

static void list_push(char ***v, int *n, const char *s) {
    *v = xrealloc(*v, sizeof(char *) * (size_t)(*n + 1));
    (*v)[(*n)++] = xstrdup(s);
}

static int ask_usage(void) {
    fprintf(stderr,
        "usage: cg jev ask [<request.json>|-] [--state S | --state-file F]\n"
        "                  [--noul NAME INSTRUCTIONS [--option true=D --option false=D]]\n"
        "                  [--choice NAME INSTRUCTIONS --option KEY=DESC ...]\n"
        "                  [--score NAME INSTRUCTIONS --level TEXT ...] [--json]\n");
    return 1;
}

static int jev_ask_cli(Cg *cg, int argc, char **argv, bool json) {
    const char *file = NULL, *state = NULL, *state_file = NULL;
    AskArgs a = {0};
    int rc = 0;
    for (int i = 3; i < argc && rc == 0; i++) {
        const char *s = argv[i];
        if (strcmp(s, "--state") == 0 && i + 1 < argc) state = argv[++i];
        else if (strcmp(s, "--state-file") == 0 && i + 1 < argc) state_file = argv[++i];
        else if ((strcmp(s, "--noul") == 0 || strcmp(s, "--choice") == 0 ||
                  strcmp(s, "--score") == 0) && i + 2 < argc) {
            JevQuestion *q = ask_push(&a);
            q->type = s[2] == 'n' ? JEV_NOUL : s[2] == 'c' ? JEV_CHOICE : JEV_SCORE;
            q->name = xstrdup(argv[i + 1]);
            q->instructions = xstrdup(argv[i + 2]);
            i += 2;
        } else if (strcmp(s, "--option") == 0 && i + 1 < argc) {
            const char *eq = strchr(argv[i + 1], '=');
            if (a.n == 0 || a.qs[a.n - 1].type == JEV_SCORE || !eq || eq == argv[i + 1]) {
                fprintf(stderr, "cg: --option KEY=DESC belongs after a --choice "
                                "or --noul question\n");
                rc = 1; break;
            }
            JevQuestion *q = &a.qs[a.n - 1];
            char *key = xmalloc((size_t)(eq - argv[i + 1]) + 1);
            memcpy(key, argv[i + 1], (size_t)(eq - argv[i + 1]));
            key[eq - argv[i + 1]] = 0;
            if (q->type == JEV_NOUL && strcmp(key, "true") != 0 &&
                strcmp(key, "false") != 0) {
                fprintf(stderr, "cg: a noul question takes only true= and "
                                "false= options\n");
                free(key); rc = 1; break;
            }
            int n = q->n;
            list_push(&q->keys, &n, key);
            list_push(&q->descs, &q->n, eq + 1);
            free(key);
            i++;
        } else if (strcmp(s, "--level") == 0 && i + 1 < argc) {
            if (a.n == 0 || a.qs[a.n - 1].type != JEV_SCORE) {
                fprintf(stderr, "cg: --level TEXT belongs after a --score question\n");
                rc = 1; break;
            }
            JevQuestion *q = &a.qs[a.n - 1];
            list_push(&q->descs, &q->n, argv[i + 1]);
            i++;
        } else if (s[0] == '-' && s[1] && strcmp(s, "-") != 0) {
            fprintf(stderr, "cg: unknown option %s\n", s);
            rc = ask_usage();
        } else if (!file) file = s;
        else { rc = ask_usage(); }
    }
    for (int i = 0; i < a.n && rc == 0; i++) {
        JevQuestion *q = &a.qs[i];
        if (q->type == JEV_CHOICE && (q->n < 2 || q->n > JEV_MAX_CHOICE)) {
            fprintf(stderr, "cg: choice %s needs at least 2 options (at most %d)\n",
                    q->name, JEV_MAX_CHOICE);
            rc = 1;
        } else if (q->type == JEV_SCORE && q->n < 2) {
            fprintf(stderr, "cg: score %s needs at least 2 levels\n", q->name);
            rc = 1;
        } else if (q->type == JEV_NOUL && q->n == 1) {
            fprintf(stderr, "cg: noul %s needs both true= and false= or neither\n",
                    q->name);
            rc = 1;
        }
    }
    char *state_owned = NULL, *file_owned = NULL;
    JevResult r; memset(&r, 0, sizeof r);
    if (rc == 0 && file) {
        if (a.n > 0 || state || state_file) {
            fprintf(stderr, "cg: a request file carries its own state and questions\n");
            rc = 1;
        } else if (strcmp(file, "-") == 0) {
            StrBuf b; sb_init(&b);
            char buf[8192]; size_t n;
            while ((n = fread(buf, 1, sizeof buf, stdin)) > 0)
                for (size_t i = 0; i < n; i++) sb_putc(&b, buf[i]);
            file_owned = b.p;
        } else {
            size_t len;
            file_owned = read_entire_file(file, &len);
            if (!file_owned) {
                fprintf(stderr, "cg: cannot read %s: %s\n", file, strerror(errno));
                rc = 1;
            }
        }
        if (rc == 0) {
            char *qs = json_get_object(file_owned, "questions");
            char *st = json_get_raw(file_owned, "state");
            if (!qs || !st) {
                fprintf(stderr, "cg: the request needs \"state\" and a "
                                "\"questions\" object\n");
                rc = 1;
            } else {
                rc = jev_ask_raw(cg, file_owned, &r);
            }
            free(qs); free(st);
        }
    } else if (rc == 0) {
        if (a.n == 0) {
            fprintf(stderr, "cg: no questions — add --noul, --choice, or --score, "
                            "or pass a request file\n");
            rc = ask_usage();
        } else if (state_file) {
            size_t len;
            state_owned = read_entire_file(state_file, &len);
            if (!state_owned) {
                fprintf(stderr, "cg: cannot read %s: %s\n", state_file, strerror(errno));
                rc = 1;
            }
        } else if (!state) {
            fprintf(stderr, "cg: no state — pass --state S or --state-file F\n");
            rc = ask_usage();
        } else if (json_value_ok(state)) {
            state_owned = xstrdup(state);
        } else if (strchr("{[\"", state[0])) {
            /* looks like JSON and is not: a typo, not a sentence */
            fprintf(stderr, "cg: state is not JSON: %.80s\n", state);
            rc = 1;
        } else {
            /* plain words become a JSON string */
            StrBuf b; sb_init(&b);
            sb_json_str(&b, state);
            state_owned = b.p;
        }
        if (rc == 0) rc = jev_ask(cg, state_owned, a.qs, a.n, &r);
    }
    if (rc == 0) {
        if (!cg)
            fprintf(stderr, "jev: no Codify project here, the call was not logged\n");
        StrBuf b; sb_init(&b);
        if (json) jev_result_json(&r, &b); else jev_result_text(&r, &b);
        fputs(b.p, stdout);
        sb_free(&b);
    } else if (r.error[0]) {
        fprintf(stderr, "cg: %s\n", r.error);
        rc = 1;
    }
    jev_result_free(&r);
    for (int i = 0; i < a.n; i++) jev_question_free(&a.qs[i]);
    free(a.qs); free(state_owned); free(file_owned);
    return rc;
}

/* ---------------- cg jev doctor ---------------- */

static void curl_version(const char *curl, char *out, size_t cap) {
    out[0] = 0;
    StrBuf cmd; sb_init(&cmd);
    sb_shquote(&cmd, curl);
    sb_puts(&cmd, " --version 2>/dev/null");
    FILE *f = popen(cmd.p, "r");
    sb_free(&cmd);
    if (!f) return;
    char line[512];
    if (fgets(line, sizeof line, f)) {
        /* "curl 8.5.0 (x86_64-...)" -> "8.5.0" */
        char *p = line;
        while (*p && !isspace((unsigned char)*p)) p++;
        while (*p && isspace((unsigned char)*p)) p++;
        char *e = p;
        while (*e && !isspace((unsigned char)*e)) e++;
        *e = 0;
        snprintf(out, cap, "%.60s", p);
    }
    pclose(f);
}

static void key_hint(const char *key, char *out, size_t cap) {
    size_t n = strlen(key);
    if (n > 14) snprintf(out, cap, "%.6s…%s", key, key + n - 4);
    else snprintf(out, cap, "set");
}

/* Count the log's lines and note the newest timestamp. */
static long log_stats(const char *path, long *last_ts) {
    *last_ts = 0;
    size_t len;
    char *body = read_entire_file(path, &len);
    if (!body) return 0;
    long n = 0;
    char *last = NULL;
    for (char *p = body; *p; p++) {
        if (*p == '\n') { n++; }
        else if (p == body || p[-1] == '\n') last = p;
    }
    if (last) *last_ts = json_get_int(last, "ts", 0);
    free(body);
    return n;
}

static int jev_doctor(Cg *cg, bool probe, bool json) {
    JevConfig c;
    jev_config(&c);
    char curl[4096], ver[64] = "";
    bool have_curl = cg_find_exe(c.curl, curl, sizeof curl);
    if (have_curl) curl_version(curl, ver, sizeof ver);
    char hint[64] = "";
    if (c.key) key_hint(c.key, hint, sizeof hint);
    char logp[4700] = "";
    long calls = 0, last = 0;
    if (cg) {
        jev_log_path(cg, logp, sizeof logp);
        calls = log_stats(logp, &last);
    }
    JevResult r; memset(&r, 0, sizeof r);
    int prc = -1;
    if (probe && c.key && have_curl) {
        JevQuestion q;
        jev_question_noul(&q, "probe", "The state is the single word ping.",
                          NULL, NULL);
        prc = jev_ask(cg, "\"ping\"", &q, 1, &r);
        jev_question_free(&q);
    }
    bool ok = c.key && have_curl && (!probe || prc == JEV_OK);
    StrBuf b; sb_init(&b);
    if (json) {
        sb_printf(&b, "{\"ok\":%s,\"model\":", ok ? "true" : "false");
        sb_json_str(&b, c.model);
        sb_puts(&b, ",\"endpoint\":"); sb_json_str(&b, c.endpoint);
        sb_printf(&b, ",\"key\":%s,\"key_hint\":", c.key ? "true" : "false");
        sb_json_str(&b, hint);
        sb_puts(&b, ",\"curl\":");
        if (have_curl) sb_json_str(&b, curl); else sb_puts(&b, "null");
        sb_puts(&b, ",\"curl_wanted\":"); sb_json_str(&b, c.curl);
        sb_puts(&b, ",\"curl_version\":"); sb_json_str(&b, ver);
        sb_printf(&b, ",\"timeout_s\":%ld,\"attempts\":%d,\"log\":",
                  c.timeout_s, c.attempts);
        if (cg) sb_json_str(&b, logp); else sb_puts(&b, "null");
        sb_printf(&b, ",\"calls\":%ld,\"last_call\":%ld,\"probe\":", calls, last);
        if (!probe) sb_puts(&b, "null");
        else if (prc == JEV_OK) {
            const JevAnswer *a = jev_answer(&r, "probe");
            sb_printf(&b, "{\"ok\":true,\"value\":%.10g,\"ms\":%ld,\"cost\":%.10g,"
                          "\"model\":", a ? a->value : -1.0, r.ms, r.cost);
            sb_json_str(&b, r.model ? r.model : "");
            sb_putc(&b, '}');
        } else {
            sb_puts(&b, "{\"ok\":false,\"error\":");
            sb_json_str(&b, r.error[0] ? r.error : "not attempted");
            sb_putc(&b, '}');
        }
        sb_puts(&b, "}\n");
    } else {
        sb_printf(&b, "jev: %s via %s\n", c.model, c.endpoint);
        if (c.key) sb_printf(&b, "key: OPENROUTER_API_KEY set (%s)\n", hint);
        else sb_puts(&b, "key: OPENROUTER_API_KEY is not set — Jev is mandatory; "
                         "export it in the agent's environment\n");
        if (have_curl) sb_printf(&b, "curl: %s (%s)\n", curl, ver[0] ? ver : "version unknown");
        else sb_printf(&b, "curl: not found (looked for \"%s\") — install curl or "
                           "set CG_JEV_CURL\n", c.curl);
        if (cg) {
            sb_printf(&b, "log: %s — %ld call%s", logp, calls, calls == 1 ? "" : "s");
            if (last > 0) {
                char when[32];
                time_t t = (time_t)last;
                strftime(when, sizeof when, "%Y-%m-%d %H:%M", localtime(&t));
                sb_printf(&b, ", last %s", when);
            }
            sb_putc(&b, '\n');
        } else {
            sb_puts(&b, "log: (no Codify project here — calls are not logged)\n");
        }
        if (probe) {
            if (prc == JEV_OK) {
                const JevAnswer *a = jev_answer(&r, "probe");
                sb_printf(&b, "probe: ok — %s answered noul %.2f in %ld ms ($%.6f)\n",
                          r.model, a ? a->value : -1.0, r.ms, r.cost);
            } else if (prc < 0) {
                sb_puts(&b, "probe: skipped — fix the lines above first\n");
            } else {
                sb_printf(&b, "probe: failed — %s\n", r.error);
            }
        }
    }
    fputs(b.p, stdout);
    sb_free(&b);
    jev_result_free(&r);
    return ok ? 0 : 1;
}

/* ---------------- cg jev log ---------------- */

static int jev_log_cmd(Cg *cg, int limit, bool json) {
    if (!cg) {
        fprintf(stderr, "cg: no Codify project here — jev.log lives in .codegraph\n");
        return 1;
    }
    char path[4700];
    jev_log_path(cg, path, sizeof path);
    size_t len;
    char *body = read_entire_file(path, &len);
    if (!body) body = xstrdup("");
    /* split lines, keep the last `limit` */
    int n = 0;
    for (char *p = body; *p; p++) if (*p == '\n') n++;
    char **lines = xmalloc(sizeof(char *) * (size_t)(n + 1));
    int k = 0;
    for (char *p = body; *p;) {
        char *e = strchr(p, '\n');
        if (!e) break;
        *e = 0;
        if (*p) lines[k++] = p;
        p = e + 1;
    }
    int from = k > limit ? k - limit : 0;
    StrBuf b; sb_init(&b);
    if (json) {
        sb_putc(&b, '[');
        for (int i = from; i < k; i++) {
            if (i > from) sb_putc(&b, ',');
            sb_puts(&b, lines[i]);
        }
        sb_puts(&b, "]\n");
    } else if (k == 0) {
        sb_printf(&b, "no jev calls logged yet (%s)\n", path);
    } else {
        for (int i = from; i < k; i++) {
            long ts = json_get_int(lines[i], "ts", 0);
            char when[32] = "-";
            if (ts > 0) {
                time_t t = (time_t)ts;
                strftime(when, sizeof when, "%Y-%m-%d %H:%M:%S", localtime(&t));
            }
            char *err = json_get_string(lines[i], "error");
            long qn = json_get_int(lines[i], "questions", 0);
            long ms = json_get_int(lines[i], "ms", 0);
            long att = json_get_int(lines[i], "attempts", 1);
            if (err) {
                sb_printf(&b, "%s  fail  %ldq  status %ld (%ld attempt%s)  %s\n",
                          when, qn, json_get_int(lines[i], "status", 0), att,
                          att == 1 ? "" : "s", err);
                free(err);
            } else {
                char *model = json_get_string(lines[i], "model");
                char *id = json_get_string(lines[i], "id");
                double cost = jnum(lines[i], "cost", NULL);
                sb_printf(&b, "%s  ok    %ldq  %s  %ld/%ld tok  $%.6f  %ld ms",
                          when, qn, model ? model : "?",
                          json_get_int(lines[i], "input_tokens", 0),
                          json_get_int(lines[i], "output_tokens", 0),
                          isnan(cost) ? 0.0 : cost, ms);
                if (att > 1) sb_printf(&b, "  %ld attempts", att);
                if (id && id[0]) sb_printf(&b, "  %s", id);
                sb_putc(&b, '\n');
                free(model); free(id);
            }
        }
    }
    fputs(b.p, stdout);
    sb_free(&b);
    free(lines); free(body);
    return 0;
}

int cmd_jev(Cg *cg, int argc, char **argv, bool json) {
    const char *sub = argc >= 3 ? argv[2] : "doctor";
    if (strcmp(sub, "doctor") == 0) {
        bool probe = false;
        for (int i = 3; i < argc; i++)
            if (strcmp(argv[i], "--probe") == 0) probe = true;
        return jev_doctor(cg, probe, json);
    }
    if (strcmp(sub, "ask") == 0) return jev_ask_cli(cg, argc, argv, json);
    if (strcmp(sub, "log") == 0) {
        int limit = 10;
        for (int i = 3; i + 1 < argc; i++)
            if (strcmp(argv[i], "-n") == 0) limit = atoi(argv[i + 1]);
        return jev_log_cmd(cg, limit > 0 ? limit : 10, json);
    }
    fprintf(stderr, "usage: cg jev doctor [--probe] | ask ... | log [-n N]\n");
    return 1;
}

/* ---------------- advisory decisions ----------------
 *
 * Triage, rank, and readiness are the Jev steps that live inside commands
 * which must keep working without them. So they share one gate and one
 * shape of warning: the key is checked in a single place, a failed call
 * reads like a missing key, and the caller's own verdict is untouched
 * either way. A caller that only adds an advisory line to its output can
 * ignore the return value and print nothing when the fields stay empty.
 */

#define JEV_TAIL_BYTES 4096
#define JEV_TAIL_LINES 40
#define JEV_MAX_RANK   50

bool jev_advisory_ready(const char *what) {
    const char *k = getenv("OPENROUTER_API_KEY");
    if (k && k[0]) return true;
    fprintf(stderr, "jev: OPENROUTER_API_KEY is not set — %s skipped\n", what);
    return false;
}

static void jev_advisory_failed(const char *what, const JevResult *r) {
    fprintf(stderr, "jev: %s skipped — %s\n", what,
            r->error[0] ? r->error : "the answer was not usable");
}

/* The last JEV_TAIL_LINES lines, and at most JEV_TAIL_BYTES bytes, of a
 * command's output: the part where a failure says what it was. */
static void jev_tail(const char *s, StrBuf *out) {
    size_t n = strlen(s);
    const char *from = s;
    if (n > JEV_TAIL_BYTES) from = s + n - JEV_TAIL_BYTES;
    const char *p = s + n;
    int lines = 0;
    while (p > from) {
        if (p[-1] == '\n' && p != s + n && ++lines >= JEV_TAIL_LINES) break;
        p--;
    }
    if (lines >= JEV_TAIL_LINES) from = p;
    while (*from == '\n' || *from == '\r') from++;
    sb_puts(out, from);
    while (out->len > 0 && (out->p[out->len - 1] == '\n' ||
                            out->p[out->len - 1] == '\r' ||
                            out->p[out->len - 1] == ' '))
        out->p[--out->len] = 0;
}

static double answer_confidence(const JevAnswer *a) {
    return (a && !isnan(a->confidence)) ? a->confidence : -1.0;
}

static void sb_confidence(StrBuf *b, double c) {
    if (c >= 0) sb_printf(b, " (confidence %.2f)", c);
}

int jev_triage_failure(Cg *cg, const char *output, JevTriage *out) {
    memset(out, 0, sizeof *out);
    out->category_confidence = out->action_confidence = -1.0;
    if (!jev_advisory_ready("failure triage")) return JEV_ECONFIG;
    static const char *const cats[] = {
        "test_failure", "build_error", "missing_dependency", "flaky",
        "environment", "spec_mismatch" };
    static const char *const catd[] = {
        "A test ran and reported that the code does not do what it asserts.",
        "The compiler, linker, or bundler refused the code.",
        "A tool, package, or header the command needs is not installed.",
        "The same command would probably pass on a second run: a timeout, a "
            "race, a busy port, a flaky fixture.",
        "The machine rather than the change: permissions, disk, network, a "
            "missing environment variable.",
        "The code is right and the task's own expectation or verify command "
            "is wrong." };
    static const char *const acts[] = {
        "fix_code", "fix_test", "rerun", "install_dependency", "revise_spec",
        "ask_human" };
    static const char *const actd[] = {
        "Change the implementation until the command passes.",
        "Change the test or its fixture, because that is the part that is "
            "wrong.",
        "Run the same command again without changing anything.",
        "Install the missing tool or package, then run the command again.",
        "Change the task's verify command or its acceptance criteria.",
        "Stop and ask a person: this needs a decision the agent cannot "
            "make." };
    JevQuestion qs[2];
    jev_question_choice(&qs[0], "failure_category",
        "The state carries the tail of a task's failed verify command. "
        "Which kind of failure is it?", cats, catd, 6);
    jev_question_choice(&qs[1], "next_action",
        "What should the agent that owns this task do next about this "
        "failure?", acts, actd, 6);
    StrBuf tail; sb_init(&tail);
    jev_tail(output ? output : "", &tail);
    StrBuf state; sb_init(&state);
    sb_puts(&state, "{\"failed_command\":\"verify_cmd\",\"output_tail\":");
    sb_json_str(&state, tail.p);
    sb_putc(&state, '}');
    sb_free(&tail);
    JevResult r;
    int rc = jev_ask(cg, state.p, qs, 2, &r);
    sb_free(&state);
    jev_question_free(&qs[0]);
    jev_question_free(&qs[1]);
    const JevAnswer *cat = rc == JEV_OK ? jev_answer(&r, "failure_category") : NULL;
    const JevAnswer *act = rc == JEV_OK ? jev_answer(&r, "next_action") : NULL;
    if (!cat || !cat->choice || !act || !act->choice) {
        if (rc == JEV_OK) {
            rc = JEV_EPARSE;
            snprintf(r.error, sizeof r.error,
                     "jev answered without a category or a next action");
        }
        jev_advisory_failed("failure triage", &r);
        jev_result_free(&r);
        return rc;
    }
    snprintf(out->category, sizeof out->category, "%s", cat->choice);
    snprintf(out->action, sizeof out->action, "%s", act->choice);
    out->category_confidence = answer_confidence(cat);
    out->action_confidence = answer_confidence(act);
    StrBuf line; sb_init(&line);
    sb_puts(&line, out->category);
    sb_confidence(&line, out->category_confidence);
    sb_puts(&line, " → ");
    sb_puts(&line, out->action);
    sb_confidence(&line, out->action_confidence);
    snprintf(out->line, sizeof out->line, "%s", line.p);
    sb_free(&line);
    jev_result_free(&r);
    return JEV_OK;
}

/* most severe first, stable: the unranked tail keeps its collected order */
static void rank_sort(JevFinding *v, int n) {
    for (int i = 1; i < n; i++) {
        JevFinding t = v[i];
        int j = i;
        while (j > 0 && v[j - 1].score < t.score) { v[j] = v[j - 1]; j--; }
        v[j] = t;
    }
}

int jev_rank_findings(Cg *cg, JevFinding *v, int n) {
    for (int i = 0; i < n; i++) { v[i].score = -1.0; v[i].level[0] = 0; }
    if (n <= 0) return JEV_OK;
    if (!jev_advisory_ready("finding rank")) return JEV_ECONFIG;
    static const char *const levels[] = {
        "Noise: correct as written, or so minor that acting on it wastes time.",
        "Minor: worth tidying while the file is open anyway.",
        "Worth fixing before this change lands.",
        "Serious: probably a real defect this change introduced.",
        "Blocking: the change is broken or unsafe until this is addressed." };
    int nq = n < JEV_MAX_RANK ? n : JEV_MAX_RANK;
    JevQuestion *qs = xmalloc(sizeof(JevQuestion) * (size_t)nq);
    StrBuf state; sb_init(&state);
    sb_puts(&state, "{\"findings\":[");
    for (int i = 0; i < nq; i++) {
        char name[16];
        snprintf(name, sizeof name, "f%d", i);
        StrBuf ins; sb_init(&ins);
        sb_printf(&ins, "Finding %s: a %s finding at %s line %d — %s. How "
                        "severe is it for the change under review?", name,
                  v[i].kind, v[i].path, v[i].line, v[i].detail);
        jev_question_score(&qs[i], name, ins.p, levels, 5);
        sb_free(&ins);
        if (i) sb_putc(&state, ',');
        sb_puts(&state, "{\"id\":");
        sb_json_str(&state, name);
        sb_puts(&state, ",\"kind\":"); sb_json_str(&state, v[i].kind);
        sb_puts(&state, ",\"path\":"); sb_json_str(&state, v[i].path);
        sb_printf(&state, ",\"line\":%d,\"detail\":", v[i].line);
        sb_json_str(&state, v[i].detail);
        sb_putc(&state, '}');
    }
    sb_printf(&state, "],\"total\":%d}", n);
    JevResult r;
    int rc = jev_ask(cg, state.p, qs, nq, &r);
    sb_free(&state);
    for (int i = 0; i < nq; i++) jev_question_free(&qs[i]);
    free(qs);
    if (rc != JEV_OK) {
        jev_advisory_failed("finding rank", &r);
        jev_result_free(&r);
        return rc;
    }
    for (int i = 0; i < nq; i++) {
        char name[16];
        snprintf(name, sizeof name, "f%d", i);
        const JevAnswer *a = jev_answer(&r, name);
        if (!a || isnan(a->value)) continue;
        v[i].score = a->value;
        if (!a->legend) continue;
        char key[32];
        snprintf(key, sizeof key, "%ld", lround(a->value));
        char *lvl = json_get_string(a->legend, key);
        if (!lvl) continue;
        /* the legend repeats the whole criterion; its first clause is the
         * label a reader wants beside the number */
        char *cut = strpbrk(lvl, ":.");
        if (cut) *cut = 0;
        snprintf(v[i].level, sizeof v[i].level, "%s", lvl);
        free(lvl);
    }
    jev_result_free(&r);
    rank_sort(v, n);
    return JEV_OK;
}

int jev_pr_readiness(Cg *cg, const char *state_json, JevReadiness *out) {
    memset(out, 0, sizeof *out);
    out->value = -1.0;
    snprintf(out->band, sizeof out->band, "unknown");
    if (!jev_advisory_ready("pull request readiness")) return JEV_ECONFIG;
    JevQuestion q;
    jev_question_noul(&q, "readiness",
        "The state describes a feature branch waiting on a pull request: "
        "its tasks and their statuses, the gate results, and the commits it "
        "carries. Is it ready to merge?",
        "Every task is qualified and the gates are green.",
        "Tasks are unfinished, a gate is red or unknown, or there is nothing "
        "to merge.");
    JevResult r;
    int rc = jev_ask(cg, state_json, &q, 1, &r);
    jev_question_free(&q);
    const JevAnswer *a = rc == JEV_OK ? jev_answer(&r, "readiness") : NULL;
    if (!a || isnan(a->value)) {
        if (rc == JEV_OK) {
            rc = JEV_EPARSE;
            snprintf(r.error, sizeof r.error, "jev answered without a value");
        }
        jev_advisory_failed("pull request readiness", &r);
        jev_result_free(&r);
        return rc;
    }
    out->value = a->value;
    snprintf(out->band, sizeof out->band, "%s",
             a->value >= 0.75 ? "high" : a->value >= 0.4 ? "medium" : "low");
    jev_result_free(&r);
    return JEV_OK;
}

/* Jev is mandatory for the features built on it, so a failed call has to
 * read the same everywhere: what was being decided, then why it failed.
 * Returns 1 so a caller can `return jev_report_error(...)`. */
int jev_report_error(const JevResult *r, const char *what) {
    fprintf(stderr, "cg: %s: %s\n", what,
            r && r->error[0] ? r->error : "jev call failed");
    return 1;
}
