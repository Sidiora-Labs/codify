/*
 * cg recap: a resume brief built from what past agent sessions said.
 *
 * Claude Code keeps a JSONL transcript per session under
 * ~/.claude/projects/<cwd with every non-alphanumeric turned into "-">/,
 * and Codex under ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl with the
 * working directory in its first record. Those transcripts are the only
 * record of why the code is the way it is between commits, and they are
 * far too long to hand to the next agent.
 *
 * Two models, two jobs. The transcripts are cut into statements (a user
 * request, one paragraph or bullet of what the assistant said, an edit or
 * a command) and handed in chunks to a System One decision model — Solar
 * Decide through the Centra gateway — which answers three typed questions
 * per statement: which kind it is, whether it still holds at the end of
 * the session, and whether an agent resuming the work needs it. It writes
 * no prose, so a chunk costs one forward pass. The statements whose
 * probabilities score highest, within a character budget, form the decided
 * log: every line quoted from a session, none invented. That log, with
 * facts read from the repository (spec status, recent commits, memories),
 * goes to the gateway chat model — the one `cg changelog` uses — which
 * writes the brief. The decided log is kept beside the brief so a reader
 * can check any sentence against what was actually said.
 *
 * Both calls use the CENTRA_API_KEY that `cg changelog` reads (environment
 * or .env). Nothing here runs without it; there is no local fallback that
 * would quietly produce a worse brief. Decisions are cached per chunk under
 * .codegraph/recap-cache/, so a rerun pays only for new sessions.
 *
 * Knobs: CG_RECAP_DECIDE_MODEL, CG_RECAP_DECIDE_ENDPOINT (the System One
 * side), CG_RECAP_MODEL (the writer; defaults to the changelog model),
 * CG_RECAP_CLAUDE_DIR and CG_RECAP_CODEX_DIR (where to look; the tests
 * point them at fixtures), CG_RECAP_MAX_SNIPPETS (per session, 160),
 * CG_RECAP_CHUNK (statements per call, 6) and CG_RECAP_PARALLEL (calls in
 * flight, 6). curl for the decision call comes from CG_JEV_CURL, for the
 * writer from CG_CHANGELOG_CURL, as the fixtures those tests have expect.
 */
#include "cg.h"
#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <math.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define RECAP_DECIDE_MODEL    "openrouter/upstage/solar-decide"
#define RECAP_DECIDE_ENDPOINT "https://gateway.centra.ag/v1/systemone"
#define RECAP_CHUNK           6       /* statements per call, 3 questions each; the
                                         gateway allows 100 questions per request
                                         but bills each against the whole state */
#define RECAP_CHUNK_CHARS     9000
#define RECAP_PARALLEL        6       /* decision calls in flight at once */
#define RECAP_MAX_SNIPPETS    160
#define RECAP_USER_MAX        800
#define RECAP_ASSISTANT_MAX   400
#define RECAP_TOOL_MAX        200
#define RECAP_KEEP_USERS      50
#define RECAP_MIN_TRUE        0.5
#define RECAP_MIN_NEED        0.5

/* ---------------- statements and sessions ---------------- */

typedef struct {
    char *text;
    char role;          /* 'u' user, 'a' assistant, 't' tool */
    int kind;           /* index into KIND_KEYS; -1 undecided */
    double pk, pt, pn;  /* P(kind), P(still true), P(needed) */
    bool picked;
} Snip;

typedef struct {
    const char *agent;  /* "claude-code" | "codex" */
    char path[4600];
    char title[200];
    char date[11];      /* first record's day */
    long mtime;
    Snip *s; int n, cap;
    char *last_a;       /* the assistant's final message, cleaned: the "ending" */
    char *last_raw;     /* the same as received, to spot a repeat */
    char **files; int nfiles;
} Session;

static const char *const KIND_KEYS[] = {
    "goal", "decision", "constraint", "fact", "done", "open_thread",
    "dead_end", "noise" };
static const char *const KIND_DESCS[] = {
    "What the user asked for, or what the work set out to achieve.",
    "A choice that was made between alternatives, with or without the reason.",
    "A rule future work must respect: a must, a must-not, a limit, a dependency.",
    "A durable piece of knowledge about the code, the tools, or the environment.",
    "A report that a piece of work is finished, tested, committed, or merged.",
    "Work started but not finished, a question left open, a next step named.",
    "Something tried that did not work, or a direction that was abandoned.",
    "Chatter, a status line, a restatement of the obvious, or a transient detail "
        "with no value to someone resuming the work." };
#define NKINDS ((int)(sizeof KIND_KEYS / sizeof KIND_KEYS[0]))
#define KIND_NOISE (NKINDS - 1)

static void sess_push(Session *s, char role, const char *text) {
    if (!text) return;
    while (*text && isspace((unsigned char)*text)) text++;
    size_t n = strlen(text);
    while (n && isspace((unsigned char)text[n - 1])) n--;
    if (n < 12 && role != 't') return;
    if (n == 0) return;
    size_t max = role == 'u' ? RECAP_USER_MAX
               : role == 'a' ? RECAP_ASSISTANT_MAX : RECAP_TOOL_MAX;
    char *t;
    if (n > max) {
        /* cut at the budget, on a UTF-8 boundary, and mark the cut with an
         * ellipsis so the model does not read the fragment as complete */
        while (max > 0 && ((unsigned char)text[max] & 0xC0) == 0x80) max--;
        t = xmalloc(max + 4);
        memcpy(t, text, max);
        memcpy(t + max, "\xe2\x80\xa6", 4);
    } else {
        t = xmalloc(n + 1);
        memcpy(t, text, n);
        t[n] = 0;
    }
    for (char *c = t; *c; c++) if (*c == '\n' || *c == '\r' || *c == '\t') *c = ' ';
    /* an exact repeat within a session is the same statement */
    for (int i = s->n - 1; i >= 0 && i >= s->n - 40; i--)
        if (strcmp(s->s[i].text, t) == 0) { free(t); return; }
    if (s->n == s->cap) {
        s->cap = s->cap ? s->cap * 2 : 64;
        s->s = xrealloc(s->s, sizeof(Snip) * (size_t)s->cap);
    }
    Snip *p = &s->s[s->n++];
    memset(p, 0, sizeof *p);
    p->role = role;
    p->kind = -1;
    p->text = t;
}

static void sess_file(Session *s, const char *path) {
    if (!path || !path[0]) return;
    for (int i = 0; i < s->nfiles; i++) if (strcmp(s->files[i], path) == 0) return;
    if (s->nfiles >= 60) return;
    s->files = xrealloc(s->files, sizeof(char *) * (size_t)(s->nfiles + 1));
    s->files[s->nfiles++] = xstrdup(path);
}

static void sess_free(Session *s) {
    for (int i = 0; i < s->n; i++) free(s->s[i].text);
    free(s->s);
    for (int i = 0; i < s->nfiles; i++) free(s->files[i]);
    free(s->files);
    free(s->last_a); free(s->last_raw);
    memset(s, 0, sizeof *s);
}

/* ---------------- text cleaning ---------------- */

/* drop every <tag>...</tag> block in place */
static void strip_blocks(char *t, const char *tag) {
    char open[64], close[64];
    snprintf(open, sizeof open, "<%s", tag);
    snprintf(close, sizeof close, "</%s>", tag);
    char *p;
    while ((p = strstr(t, open)) != NULL) {
        char *e = strstr(p, close);
        if (!e) { *p = 0; break; }
        e += strlen(close);
        memmove(p, e, strlen(e) + 1);
    }
}

/* The user's own words out of a prompt: what is inside <user_query> when
 * the harness wrapped it, what follows "## My request:" when Codex pasted
 * files first; reminders removed; nothing when the prompt is a harness
 * notification rather than a person speaking. malloc'd or NULL. */
static char *user_words(const char *raw) {
    if (!raw) return NULL;
    char *t = xstrdup(raw);
    char *q = strstr(t, "<user_query>");
    if (q) {
        q += strlen("<user_query>");
        char *e = strstr(q, "</user_query>");
        if (e) *e = 0;
        memmove(t, q, strlen(q) + 1);
    }
    char *m = strstr(t, "## My request:");
    if (m) { m += strlen("## My request:"); memmove(t, m, strlen(m) + 1); }
    strip_blocks(t, "system-reminder");
    strip_blocks(t, "system_reminder");
    strip_blocks(t, "recommended_plugins");
    strip_blocks(t, "environment_context");
    strip_blocks(t, "task-notification");
    strip_blocks(t, "ide_selection");
    strip_blocks(t, "ide_opened_file");
    char *p = t;
    while (*p && isspace((unsigned char)*p)) p++;
    if (!*p || *p == '<') { free(t); return NULL; }   /* harness, not a person */
    if (strncmp(p, "# Files pasted", 14) == 0) { free(t); return NULL; }
    /* Claude Code's compaction summary: the harness restating the
     * transcript, which is already here in the original */
    if (strncmp(p, "This session is being continued", 31) == 0) { free(t); return NULL; }
    if (p != t) memmove(t, p, strlen(p) + 1);
    return t;
}

/* One assistant message into statements: a bullet is one, a paragraph is
 * one, headings and code are none. */
/* One assistant message into statements: a bullet is one, a paragraph is
 * one, headings, tables and code are none. The cleaned text also becomes
 * the session's ending, so nothing the splitter dropped reaches the model
 * by that road either. */
static void assistant_words(Session *s, const char *text) {
    if (!text) return;
    StrBuf para; sb_init(&para);
    StrBuf clean; sb_init(&clean);
    bool code = false;
    const char *p = text;
#define EMIT(str) do { sess_push(s, 'a', (str)); if (clean.len) sb_putc(&clean, ' '); sb_puts(&clean, (str)); } while (0)
    while (*p) {
        const char *nl = strchr(p, '\n');
        size_t len = nl ? (size_t)(nl - p) : strlen(p);
        const char *l = p; size_t ll = len;
        while (ll && isspace((unsigned char)*l)) { l++; ll--; }
        while (ll && isspace((unsigned char)l[ll - 1])) ll--;
        if (ll >= 3 && strncmp(l, "```", 3) == 0) { code = !code; goto next; }
        if (code) goto next;
        bool bullet = ll >= 2 && ((l[0] == '-' || l[0] == '*' || l[0] == '+') && l[1] == ' ');
        if (!bullet && ll >= 3 && isdigit((unsigned char)l[0])) {
            size_t k = 0; while (k < ll && isdigit((unsigned char)l[k])) k++;
            bullet = k < ll && (l[k] == '.' || l[k] == ')') && k + 1 < ll && l[k + 1] == ' ';
        }
        if (ll == 0 || bullet || l[0] == '#' || l[0] == '|') {
            if (para.len) { EMIT(para.p); para.len = 0; para.p[0] = 0; }
            if (bullet) {
                const char *b = l; size_t bl = ll;
                while (bl && (*b == '-' || *b == '*' || *b == '+' || *b == ' ' ||
                              isdigit((unsigned char)*b) || *b == '.' || *b == ')')) { b++; bl--; }
                char *one = xmalloc(bl + 1); memcpy(one, b, bl); one[bl] = 0;
                EMIT(one);
                free(one);
            }
            goto next;
        }
        if (para.len) sb_putc(&para, ' ');
        for (size_t i = 0; i < ll; i++) sb_putc(&para, l[i]);
next:
        if (!nl) break;
        p = nl + 1;
    }
    if (para.len) EMIT(para.p);
#undef EMIT
    sb_free(&para);
    if (clean.len) { free(s->last_a); s->last_a = clean.p; }
    else sb_free(&clean);
    free(s->last_raw); s->last_raw = xstrdup(text);
}

/* a command worth remembering: it committed, moved a task, ran a build or
 * the tests, or touched the fleet — not every ls */
static bool command_matters(const char *cmd) {
    static const char *const words[] = {
        "commit", "spec ", "make", "test", "fleet", "cargo ", "npm ", "pytest",
        "git push", "git merge", "git rebase", "cg done", "install", NULL };
    for (int i = 0; words[i]; i++) if (strstr(cmd, words[i])) return true;
    return false;
}

static void set_date(Session *s, const char *ts) {
    if (s->date[0] || !ts || strlen(ts) < 10) return;
    snprintf(s->date, sizeof s->date, "%.10s", ts);
}

/* ---------------- Claude Code transcripts ---------------- */

static void claude_content(Session *s, const char *msg, bool user) {
    char *raw = json_get_raw(msg, "content");
    if (!raw) return;
    if (raw[0] == '"') {
        char *t = json_string_value(raw);
        if (user) { char *w = user_words(t); sess_push(s, 'u', w); free(w); }
        else assistant_words(s, t);
        free(t);
    } else if (raw[0] == '[') {
        char **items = NULL;
        int n = json_array_items(raw, &items);
        for (int i = 0; i < n; i++) {
            char *type = json_get_string(items[i], "type");
            if (type && strcmp(type, "text") == 0) {
                char *t = json_get_string(items[i], "text");
                if (user) { char *w = user_words(t); sess_push(s, 'u', w); free(w); }
                else assistant_words(s, t);
                free(t);
            } else if (type && strcmp(type, "tool_use") == 0) {
                char *name = json_get_string(items[i], "name");
                char *in = json_get_object(items[i], "input");
                if (name && in) {
                    if (strstr(name, "Edit") || strcmp(name, "Write") == 0 ||
                        strcmp(name, "StrReplace") == 0 || strcmp(name, "NotebookEdit") == 0) {
                        char *fp = json_get_string(in, "file_path");
                        if (!fp) fp = json_get_string(in, "path");
                        sess_file(s, fp);
                        free(fp);
                    } else if (strcmp(name, "Bash") == 0 || strcmp(name, "Shell") == 0) {
                        char *cmd = json_get_string(in, "command");
                        if (cmd && command_matters(cmd)) {
                            StrBuf b; sb_init(&b);
                            sb_printf(&b, "ran: %s", cmd);
                            sess_push(s, 't', b.p);
                            sb_free(&b);
                        }
                        free(cmd);
                    }
                }
                free(name); free(in);
            }
            free(type);
            free(items[i]);
        }
        free(items);
    }
    free(raw);
}

static int parse_claude(Session *s, FILE *f) {
    char *line = NULL; size_t cap = 0; ssize_t len;
    int records = 0;
    while ((len = getline(&line, &cap, f)) > 0) {
        char *type = json_get_string(line, "type");
        if (!type) continue;
        records++;
        if (strcmp(type, "ai-title") == 0) {
            char *t = json_get_string(line, "aiTitle");
            if (t) snprintf(s->title, sizeof s->title, "%s", t);
            free(t);
        } else if (strcmp(type, "user") == 0 || strcmp(type, "assistant") == 0) {
            char *side = json_get_string(line, "isSidechain");
            char *ts = json_get_string(line, "timestamp");
            set_date(s, ts);
            free(ts);
            char *msg = json_get_object(line, "message");
            if (msg) claude_content(s, msg, type[0] == 'u');
            free(msg); free(side);
        }
        free(type);
    }
    free(line);
    return records;
}

/* ---------------- Codex rollouts ---------------- */

static void codex_texts(Session *s, const char *content, char role) {
    char **items = NULL;
    int n = json_array_items(content, &items);
    for (int i = 0; i < n; i++) {
        char *t = json_get_string(items[i], "text");
        if (t) {
            if (role == 'u') { char *w = user_words(t); sess_push(s, 'u', w); free(w); }
            else assistant_words(s, t);
        }
        free(t); free(items[i]);
    }
    free(items);
}

static int parse_codex(Session *s, FILE *f) {
    char *line = NULL; size_t cap = 0; ssize_t len;
    int records = 0;
    while ((len = getline(&line, &cap, f)) > 0) {
        char *type = json_get_string(line, "type");
        if (!type) continue;
        records++;
        char *ts = json_get_string(line, "timestamp");
        set_date(s, ts);
        free(ts);
        char *pl = json_get_object(line, "payload");
        if (pl) {
            char *pt = json_get_string(pl, "type");
            if (strcmp(type, "response_item") == 0 && pt) {
                if (strcmp(pt, "message") == 0) {
                    char *role = json_get_string(pl, "role");
                    char *content = json_get_raw(pl, "content");
                    if (role && content && content[0] == '[') {
                        if (strcmp(role, "user") == 0) codex_texts(s, content, 'u');
                        else if (strcmp(role, "assistant") == 0) codex_texts(s, content, 'a');
                    }
                    free(role); free(content);
                } else if (strcmp(pt, "custom_tool_call") == 0 ||
                           strcmp(pt, "function_call") == 0) {
                    char *name = json_get_string(pl, "name");
                    char *in = json_get_string(pl, "input");
                    if (!in) in = json_get_string(pl, "arguments");
                    if (name && in) {
                        if (strstr(name, "apply_patch") || strstr(name, "edit")) {
                            /* "*** Update File: path" lines name the files */
                            for (char *p = in; (p = strstr(p, "File: ")) != NULL; p += 6) {
                                char *e = strchr(p + 6, '\n');
                                char fp[600];
                                snprintf(fp, sizeof fp, "%.*s", e ? (int)(e - p - 6) : 500, p + 6);
                                sess_file(s, fp);
                            }
                        } else if (command_matters(in)) {
                            /* the first line of the script or command */
                            char *e = strchr(in, '\n');
                            StrBuf b; sb_init(&b);
                            sb_printf(&b, "ran: %.*s", e ? (int)(e - in) : 300, in);
                            sess_push(s, 't', b.p);
                            sb_free(&b);
                        }
                    }
                    free(name); free(in);
                }
            } else if (strcmp(type, "event_msg") == 0 && pt &&
                       strcmp(pt, "task_complete") == 0) {
                char *t = json_get_string(pl, "last_agent_message");
                if (t && (!s->last_raw || strcmp(t, s->last_raw) != 0))
                    assistant_words(s, t);
                free(t);
            }
            free(pt); free(pl);
        }
        free(type);
    }
    free(line);
    return records;
}

/* ---------------- discovery ---------------- */

typedef struct { Session *v; int n, cap; } Sessions;

static void sessions_add(Sessions *ss, const Session *s) {
    if (ss->n == ss->cap) {
        ss->cap = ss->cap ? ss->cap * 2 : 16;
        ss->v = xrealloc(ss->v, sizeof(Session) * (size_t)ss->cap);
    }
    ss->v[ss->n++] = *s;
}

static long file_mtime(const char *path) {
    struct stat st;
    return stat(path, &st) == 0 ? (long)st.st_mtime : 0;
}

/* Claude Code's project directory name: the cwd with every character that
 * is not a letter or digit replaced by "-" */
static void claude_dir(const char *root, char *out, size_t cap) {
    const char *e = getenv("CG_RECAP_CLAUDE_DIR");
    if (e && e[0]) { snprintf(out, cap, "%s", e); return; }
    const char *home = getenv("HOME");
    char m[4200]; size_t k = 0;
    for (const char *p = root; *p && k + 1 < sizeof m; p++)
        m[k++] = isalnum((unsigned char)*p) ? *p : '-';
    m[k] = 0;
    snprintf(out, cap, "%s/.claude/projects/%s", home ? home : "", m);
}

static void find_claude(const char *root, long oldest, Sessions *out) {
    char dir[4300];
    claude_dir(root, dir, sizeof dir);
    DIR *d = opendir(dir);
    if (!d) return;
    struct dirent *de;
    while ((de = readdir(d)) != NULL) {
        size_t n = strlen(de->d_name);
        if (n < 7 || strcmp(de->d_name + n - 6, ".jsonl") != 0) continue;
        Session s; memset(&s, 0, sizeof s);
        s.agent = "claude-code";
        snprintf(s.path, sizeof s.path, "%s/%s", dir, de->d_name);
        s.mtime = file_mtime(s.path);
        if (s.mtime < oldest) continue;
        sessions_add(out, &s);
    }
    closedir(d);
}

/* a rollout belongs to this project when its first record's cwd is the
 * root or somewhere under it (a fleet worktree counts) */
static bool codex_owned(const char *path, const char *root) {
    FILE *f = fopen(path, "r");
    if (!f) return false;
    char *line = NULL; size_t cap = 0;
    bool ok = false;
    if (getline(&line, &cap, f) > 0) {
        char *pl = json_get_object(line, "payload");
        char *cwd = pl ? json_get_string(pl, "cwd") : NULL;
        if (cwd) {
            size_t rl = strlen(root);
            ok = strncmp(cwd, root, rl) == 0 && (cwd[rl] == 0 || cwd[rl] == '/');
        }
        free(cwd); free(pl);
    }
    free(line);
    fclose(f);
    return ok;
}

static void find_codex_in(const char *dir, const char *root, long oldest,
                          int depth, Sessions *out) {
    DIR *d = opendir(dir);
    if (!d) return;
    struct dirent *de;
    while ((de = readdir(d)) != NULL) {
        if (de->d_name[0] == '.') continue;
        char p[4400];
        snprintf(p, sizeof p, "%s/%s", dir, de->d_name);
        struct stat st;
        if (stat(p, &st) != 0) continue;
        if (S_ISDIR(st.st_mode)) {
            if (depth < 4) find_codex_in(p, root, oldest, depth + 1, out);
            continue;
        }
        size_t n = strlen(de->d_name);
        if (strncmp(de->d_name, "rollout-", 8) != 0 || n < 7 ||
            strcmp(de->d_name + n - 6, ".jsonl") != 0) continue;
        if ((long)st.st_mtime < oldest) continue;
        if (!codex_owned(p, root)) continue;
        Session s; memset(&s, 0, sizeof s);
        s.agent = "codex";
        snprintf(s.path, sizeof s.path, "%s", p);
        s.mtime = (long)st.st_mtime;
        sessions_add(out, &s);
    }
    closedir(d);
}

static void find_codex(const char *root, long oldest, Sessions *out) {
    const char *e = getenv("CG_RECAP_CODEX_DIR");
    char dir[4300];
    if (e && e[0]) snprintf(dir, sizeof dir, "%s", e);
    else {
        const char *home = getenv("HOME");
        snprintf(dir, sizeof dir, "%s/.codex/sessions", home ? home : "");
    }
    find_codex_in(dir, root, oldest, 0, out);
}

static int cmp_newest(const void *a, const void *b) {
    const Session *x = a, *y = b;
    return x->mtime < y->mtime ? 1 : x->mtime > y->mtime ? -1 : strcmp(x->path, y->path);
}

static int cmp_oldest(const void *a, const void *b) { return -cmp_newest(a, b); }

/* Keep a session to its cap: the newest user requests first (they are the
 * spine of what happened), then the newest of everything else. */
static void sess_cap(Session *s, int cap) {
    if (s->n <= cap) return;
    bool *keep = xmalloc(sizeof(bool) * (size_t)s->n);
    memset(keep, 0, sizeof(bool) * (size_t)s->n);
    int kept = 0, users = 0;
    for (int i = s->n - 1; i >= 0 && users < RECAP_KEEP_USERS && kept < cap; i--)
        if (s->s[i].role == 'u') { keep[i] = true; kept++; users++; }
    for (int i = s->n - 1; i >= 0 && kept < cap; i--)
        if (!keep[i]) { keep[i] = true; kept++; }
    int w = 0;
    for (int i = 0; i < s->n; i++) {
        if (keep[i]) s->s[w++] = s->s[i];
        else free(s->s[i].text);
    }
    s->n = w;
    free(keep);
}

/* ---------------- the decision pass ---------------- */

typedef struct {
    ChatModel writer;               /* key, curl, and the prose model */
    char decide_model[160];
    char decide_endpoint[600];
    char cache_dir[4400];
    int calls, cached, failed;
    double cost;
} Recap;

static void recap_config(const Cg *cg, Recap *r) {
    chat_model_config(cg, &r->writer);
    const char *e = getenv("CG_RECAP_MODEL");
    if (e && e[0]) snprintf(r->writer.model, sizeof r->writer.model, "%s", e);
    e = getenv("CG_RECAP_DECIDE_MODEL");
    snprintf(r->decide_model, sizeof r->decide_model, "%s",
             e && e[0] ? e : RECAP_DECIDE_MODEL);
    e = getenv("CG_RECAP_DECIDE_ENDPOINT");
    snprintf(r->decide_endpoint, sizeof r->decide_endpoint, "%s",
             e && e[0] ? e : RECAP_DECIDE_ENDPOINT);
    snprintf(r->cache_dir, sizeof r->cache_dir, "%s/%s/recap-cache", cg->shared, CG_DIR);
}

static const char *role_name(char r) {
    return r == 'u' ? "user" : r == 'a' ? "assistant" : "tool";
}

/* The state one chunk is judged in: where it comes from, how the session
 * ended (so "still true" has something to check against), and the numbered
 * statements. */
static void chunk_state(const Session *s, int from, int to, StrBuf *b) {
    sb_puts(b, "{\"agent\":"); sb_json_str(b, s->agent);
    sb_puts(b, ",\"date\":"); sb_json_str(b, s->date[0] ? s->date : "unknown");
    sb_puts(b, ",\"session_title\":"); sb_json_str(b, s->title[0] ? s->title : "");
    sb_printf(b, ",\"statements_in_session\":%d", s->n);
    sb_puts(b, ",\"how_the_session_ended\":");
    if (s->last_a) {
        char tail[600];
        size_t n = strlen(s->last_a);
        const char *from = n > 500 ? s->last_a + n - 500 : s->last_a;
        while (((unsigned char)*from & 0xC0) == 0x80) from++;
        snprintf(tail, sizeof tail, "%s", from);
        sb_json_str(b, tail);
    } else sb_puts(b, "null");
    sb_puts(b, ",\"statements\":[");
    for (int i = from; i < to; i++) {
        if (i > from) sb_putc(b, ',');
        sb_printf(b, "{\"n\":%d,\"who\":\"%s\",\"text\":", i - from + 1, role_name(s->s[i].role));
        sb_json_str(b, s->s[i].text);
        sb_putc(b, '}');
    }
    sb_puts(b, "]}");
}

static void cache_path(const Recap *r, const char *state, char *out, size_t cap) {
    char h[65], seed[4200];
    sha256_hex(state, strlen(state), h);
    snprintf(seed, sizeof seed, "%s|%s", r->decide_model, h);
    sha256_hex(seed, strlen(seed), h);
    snprintf(out, cap, "%s/%.20s.txt", r->cache_dir, h);
}

/* one line per statement: n kind pk pt pn */
static bool cache_read(const char *path, Session *s, int from, int to) {
    char *body = read_entire_file(path, NULL);
    if (!body) return false;
    int got = 0;
    for (char *l = body, *nl; l && *l; l = nl ? nl + 1 : NULL) {
        nl = strchr(l, '\n');
        if (nl) *nl = 0;
        int n, k; double pk, pt, pn;
        if (sscanf(l, "%d %d %lf %lf %lf", &n, &k, &pk, &pt, &pn) == 5 &&
            n >= 1 && from + n - 1 < to && k >= 0 && k < NKINDS) {
            Snip *p = &s->s[from + n - 1];
            p->kind = k; p->pk = pk; p->pt = pt; p->pn = pn;
            got++;
        }
    }
    free(body);
    return got == to - from;
}

static void cache_write(const char *path, const Session *s, int from, int to) {
    StrBuf b; sb_init(&b);
    for (int i = from; i < to; i++)
        sb_printf(&b, "%d %d %.6f %.6f %.6f\n", i - from + 1, s->s[i].kind,
                  s->s[i].pk, s->s[i].pt, s->s[i].pn);
    FILE *f = fopen(path, "w");
    if (f) { fputs(b.p, f); fclose(f); }
    sb_free(&b);
}

/* Judge statements [from, to) of one session: three typed questions per
 * statement, one request. Returns 0, or -1 with the reason on stderr; the
 * statements keep kind -1 then and never get picked. */
static int decide_chunk(Cg *cg, Recap *r, Session *s, int from, int to) {
    StrBuf state; sb_init(&state);
    chunk_state(s, from, to, &state);
    char cp[4500];
    cache_path(r, state.p, cp, sizeof cp);
    if (cache_read(cp, s, from, to)) { r->cached++; sb_free(&state); return 0; }

    int n = to - from;
    JevQuestion *qs = xmalloc(sizeof(JevQuestion) * (size_t)n * 3);
    for (int i = 0; i < n; i++) {
        char name[16], ins[400];
        snprintf(name, sizeof name, "k%03d", i + 1);
        snprintf(ins, sizeof ins, "Statement %d, read against the whole session: "
                 "which one kind of statement is it?", i + 1);
        jev_question_choice(&qs[3 * i], name, ins, KIND_KEYS, KIND_DESCS, NKINDS);
        snprintf(name, sizeof name, "t%03d", i + 1);
        snprintf(ins, sizeof ins, "Statement %d still holds at the end of the session: "
                 "nothing later in the session reverted, superseded, or "
                 "contradicted it.", i + 1);
        jev_question_noul(&qs[3 * i + 1], name, ins,
                          "it still holds when the session ends",
                          "the session later reversed, replaced, or disproved it");
        snprintf(name, sizeof name, "n%03d", i + 1);
        snprintf(ins, sizeof ins, "A new agent resuming work on this project, "
                 "with the code and the spec in front of it but no memory of "
                 "this session, needs statement %d.", i + 1);
        jev_question_noul(&qs[3 * i + 2], name, ins,
                          "it tells the new agent something it could not get from the code or the spec",
                          "the code, the spec, or common sense already says it, or it no longer matters");
    }
    JevResult res;
    int rc = jev_ask_at(cg, r->writer.key, r->decide_model, r->decide_endpoint,
                        state.p, qs, n * 3, &res);
    r->calls++;
    if (rc != JEV_OK) {
        r->failed++;
        fprintf(stderr, "cg recap: %s statements %d-%d of %s skipped — %s\n",
                s->agent, from + 1, to, s->title[0] ? s->title : s->path, res.error);
    } else {
        r->cost += res.cost;
        for (int i = 0; i < n; i++) {
            char name[16];
            snprintf(name, sizeof name, "k%03d", i + 1);
            const JevAnswer *k = jev_answer(&res, name);
            snprintf(name, sizeof name, "t%03d", i + 1);
            const JevAnswer *t = jev_answer(&res, name);
            snprintf(name, sizeof name, "n%03d", i + 1);
            const JevAnswer *nd = jev_answer(&res, name);
            Snip *p = &s->s[from + i];
            if (k && k->choice) {
                for (int j = 0; j < NKINDS; j++)
                    if (strcmp(k->choice, KIND_KEYS[j]) == 0) p->kind = j;
                /* the winning key's own probability, when the server sent them */
                double pk = NAN;
                if (k->probabilities) {
                    char *raw = json_get_raw(k->probabilities, k->choice);
                    if (raw) { pk = strtod(raw, NULL); free(raw); }
                }
                p->pk = !isnan(pk) ? pk : !isnan(k->confidence) ? k->confidence : 0.5;
            }
            p->pt = t && !isnan(t->value) ? t->value : 0.5;
            p->pn = nd && !isnan(nd->value) ? nd->value : 0.5;
        }
        mkdirs(r->cache_dir);
        cache_write(cp, s, from, to);
    }
    for (int i = 0; i < n * 3; i++) jev_question_free(&qs[i]);
    free(qs);
    jev_result_free(&res);
    sb_free(&state);
    return rc == JEV_OK ? 0 : -1;
}

/* A chunk is the unit of one decision call. The endpoint bills every
 * question against the whole state, so a chunk's cost grows with
 * statements squared: small chunks are cheaper and answer in seconds,
 * large ones time out upstream. */
typedef struct { int sess, from, to; } Chunk;

static int chunks_of(const Sessions *ss, Chunk **out) {
    const char *e = getenv("CG_RECAP_CHUNK");
    int chunk = e && atoi(e) > 0 && atoi(e) <= 33 ? atoi(e) : RECAP_CHUNK;
    Chunk *v = NULL; int n = 0, cap = 0;
    for (int i = 0; i < ss->n; i++) {
        const Session *s = &ss->v[i];
        int from = 0;
        while (from < s->n) {
            int to = from; long chars = 0;
            while (to < s->n && to - from < chunk &&
                   (to == from || chars + (long)strlen(s->s[to].text) < RECAP_CHUNK_CHARS)) {
                chars += (long)strlen(s->s[to].text);
                to++;
            }
            if (n == cap) { cap = cap ? cap * 2 : 32; v = xrealloc(v, sizeof(Chunk) * (size_t)cap); }
            v[n].sess = i; v[n].from = from; v[n].to = to; n++;
            from = to;
        }
    }
    *out = v;
    return n;
}

static bool chunk_cached(Recap *r, Session *s, const Chunk *c) {
    StrBuf state; sb_init(&state);
    chunk_state(s, c->from, c->to, &state);
    char cp[4500];
    cache_path(r, state.p, cp, sizeof cp);
    struct stat st;
    bool ok = stat(cp, &st) == 0;
    sb_free(&state);
    return ok;
}

/* Every chunk not yet in the cache, decided by `par` forked workers at
 * once (chunk j goes to worker j mod par); each worker writes the cache and
 * nothing else, so the parent's own pass afterwards finds the answers
 * there. A worker's failed chunk stays absent and the parent asks again
 * once, serially. Forking rather than threading keeps jev's per-pid
 * private request files from colliding. */
static void decide_parallel(Cg *cg, Recap *r, Sessions *ss, const Chunk *v, int n, int par) {
    pid_t *kids = xmalloc(sizeof(pid_t) * (size_t)par);
    int started = 0;
    for (int k = 0; k < par; k++) {
        pid_t pid = fork();
        if (pid < 0) break;
        if (pid == 0) {
            for (int j = k; j < n; j += par)
                if (!chunk_cached(r, &ss->v[v[j].sess], &v[j]))
                    decide_chunk(cg, r, &ss->v[v[j].sess], v[j].from, v[j].to);
            _exit(0);
        }
        kids[started++] = pid;
    }
    for (int k = 0; k < started; k++) { int st; waitpid(kids[k], &st, 0); }
    free(kids);
}

static void decide_all(Cg *cg, Recap *r, Sessions *ss) {
    Chunk *v = NULL;
    int n = chunks_of(ss, &v);
    const char *e = getenv("CG_RECAP_PARALLEL");
    int par = e && atoi(e) >= 1 && atoi(e) <= 32 ? atoi(e) : RECAP_PARALLEL;
    int todo = 0;
    for (int j = 0; j < n; j++) if (!chunk_cached(r, &ss->v[v[j].sess], &v[j])) todo++;
    if (todo > 1 && par > 1) {
        mkdirs(r->cache_dir);
        decide_parallel(cg, r, ss, v, n, par < todo ? par : todo);
    }
    for (int j = 0; j < n; j++)
        decide_chunk(cg, r, &ss->v[v[j].sess], v[j].from, v[j].to);
    /* the parent saw the workers' answers as cache hits: report what was
     * actually asked this run */
    r->calls = todo;
    r->cached = n - todo;
    free(v);
}

/* ---------------- selection ---------------- */

typedef struct { int sess, idx; double score; } Pick;

static double snip_score(const Snip *p) {
    if (p->kind < 0 || p->kind == KIND_NOISE) return -1;
    if (p->pt < RECAP_MIN_TRUE || p->pn < RECAP_MIN_NEED) return -1;
    return p->pk * p->pt * p->pn;
}

static int cmp_pick(const void *a, const void *b) {
    const Pick *x = a, *y = b;
    return x->score < y->score ? 1 : x->score > y->score ? -1 : 0;
}

/* Every statement that cleared the bar, best first, until the budget is
 * spent; returns how many were picked. */
static int select_picks(Sessions *ss, long budget) {
    int total = 0;
    for (int i = 0; i < ss->n; i++) total += ss->v[i].n;
    Pick *v = xmalloc(sizeof(Pick) * (size_t)(total ? total : 1));
    int n = 0;
    for (int i = 0; i < ss->n; i++)
        for (int j = 0; j < ss->v[i].n; j++) {
            double sc = snip_score(&ss->v[i].s[j]);
            if (sc >= 0) { v[n].sess = i; v[n].idx = j; v[n].score = sc; n++; }
        }
    qsort(v, (size_t)n, sizeof v[0], cmp_pick);
    long used = 0; int picked = 0;
    for (int i = 0; i < n; i++) {
        long len = (long)strlen(ss->v[v[i].sess].s[v[i].idx].text) + 40;
        if (used + len > budget) continue;
        used += len;
        ss->v[v[i].sess].s[v[i].idx].picked = true;
        picked++;
    }
    free(v);
    return picked;
}

/* The decided log: sessions oldest first, statements in the order they
 * were said, each with the probabilities that put it here. */
static void render_decided(const Sessions *ss, const Recap *r, StrBuf *b) {
    sb_printf(b, "# Decided log\n\nStatements picked from %d session%s by %s: "
                 "kind, P(still true), P(needed to resume). Nothing here was "
                 "written by a model.\n", ss->n, ss->n == 1 ? "" : "s", r->decide_model);
    for (int i = 0; i < ss->n; i++) {
        const Session *s = &ss->v[i];
        int np = 0;
        for (int j = 0; j < s->n; j++) if (s->s[j].picked) np++;
        sb_printf(b, "\n## [s%d] %s %s — %s (%d of %d statements)\n", i + 1, s->agent,
                  s->date[0] ? s->date : "undated", s->title[0] ? s->title : "untitled",
                  np, s->n);
        if (s->nfiles) {
            sb_puts(b, "files edited:");
            for (int j = 0; j < s->nfiles && j < 30; j++) sb_printf(b, " %s", s->files[j]);
            if (s->nfiles > 30) sb_printf(b, " (+%d)", s->nfiles - 30);
            sb_putc(b, '\n');
        }
        for (int j = 0; j < s->n; j++) {
            const Snip *p = &s->s[j];
            if (!p->picked) continue;
            sb_printf(b, "- %s %.2f/%.2f/%.2f [%s] %s\n", KIND_KEYS[p->kind],
                      p->pk, p->pt, p->pn, role_name(p->role), p->text);
        }
    }
}

/* ---------------- repository facts ---------------- */

static void run_capture(const char *cmd, StrBuf *out) {
    FILE *f = popen(cmd, "r");
    if (!f) return;
    char buf[8192]; size_t n;
    while ((n = fread(buf, 1, sizeof buf, f)) > 0)
        for (size_t i = 0; i < n; i++) sb_putc(out, buf[i]);
    pclose(f);
}

static void repo_facts(Cg *cg, int since_days, StrBuf *b) {
    /* the spec: active feature, its intro, task status */
    char wp[4700];
    config_workflow_path(cg->root, wp, sizeof wp);
    Kvx *w = kvx_parse(wp);
    char *feat = w ? kvx_str(w, "meta", "active_feature") : NULL;
    kvx_free(w);
    if (feat && feat[0]) {
        char sp[4700];
        config_feature_path(cg->root, feat, sp, sizeof sp);
        Kvx *k = kvx_parse(sp);
        if (k) {
            char *intro = kvx_str(k, "meta", "intro");
            sb_printf(b, "Active feature: %s\n", feat);
            if (intro) sb_printf(b, "Feature intro: %s\n", intro);
            free(intro);
            char **ids = NULL;
            int n = kvx_subsections(k, "task", &ids);   /* "1.1", not "task.1.1" */
            int done = 0, prog = 0, pend = 0;
            StrBuf open; sb_init(&open);
            for (int i = 0; i < n; i++) {
                char sec[300];
                snprintf(sec, sizeof sec, "task.%s", ids[i]);
                char *st = kvx_str(k, sec, "status");
                char *title = kvx_str(k, sec, "title");
                long wave = kvx_long(k, sec, "wave", 0);
                if (wave > 0) {
                    if (st && strcmp(st, "done") == 0) done++;
                    else if (st && strcmp(st, "in_progress") == 0) {
                        prog++;
                        sb_printf(&open, "  in_progress %s (wave %ld): %s\n", ids[i], wave, title ? title : "");
                    } else {
                        pend++;
                        if (pend <= 10)
                            sb_printf(&open, "  %s %s (wave %ld): %s\n", st ? st : "pending", ids[i], wave, title ? title : "");
                    }
                }
                free(st); free(title); free(ids[i]);
            }
            free(ids);
            sb_printf(b, "Tasks: %d done, %d in progress, %d not started\n", done, prog, pend);
            if (open.len) sb_printf(b, "Open tasks:\n%s", open.p);
            sb_free(&open);
            kvx_free(k);
        }
    }
    free(feat);

    /* git: the head, the dirty count, the commits of the window */
    if (git_available(cg)) {
        StrBuf cmd; sb_init(&cmd);
        sb_puts(&cmd, "git -C "); sb_shquote(&cmd, cg->root);
        sb_puts(&cmd, " log -1 --date=short --format='%ad %h %s' 2>/dev/null");
        StrBuf o; sb_init(&o);
        run_capture(cmd.p, &o);
        if (o.len) sb_printf(b, "HEAD: %s", o.p);
        cmd.len = 0; o.len = 0; o.p[0] = 0;
        sb_puts(&cmd, "git -C "); sb_shquote(&cmd, cg->root);
        sb_puts(&cmd, " status --porcelain 2>/dev/null | wc -l");
        run_capture(cmd.p, &o);
        if (o.len) sb_printf(b, "Uncommitted paths: %s", o.p);
        cmd.len = 0; o.len = 0; o.p[0] = 0;
        sb_puts(&cmd, "git -C "); sb_shquote(&cmd, cg->root);
        sb_printf(&cmd, " log --since='%d days ago' --date=short --format='%%ad %%s' -n 200 2>/dev/null",
                  since_days > 0 ? since_days : 21);
        run_capture(cmd.p, &o);
        if (o.len) sb_printf(b, "Commits of the last %d days (newest first):\n%s",
                             since_days > 0 ? since_days : 21, o.p);
        sb_free(&o); sb_free(&cmd);
    }

    /* memories: the decisions and constraints agents chose to keep */
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT type, COALESCE(task,''), body FROM memories "
        "WHERE type IN ('decision','constraint','handoff','fact') "
        "AND id NOT IN (SELECT id FROM memory_superseded) "
        "ORDER BY id DESC LIMIT 25");
    bool any = false;
    while (st && sqlite3_step(st) == SQLITE_ROW) {
        if (!any) { sb_puts(b, "Stored memories (newest first):\n"); any = true; }
        const char *type = (const char *)sqlite3_column_text(st, 0);
        const char *task = (const char *)sqlite3_column_text(st, 1);
        const char *body = (const char *)sqlite3_column_text(st, 2);
        sb_printf(b, "  [%s%s%s] %.300s\n", type ? type : "", task && task[0] ? " " : "",
                  task ? task : "", body ? body : "");
    }
    if (st) sqlite3_finalize(st);
}

/* ---------------- the writer ---------------- */

static char *write_brief(Cg *cg, Recap *r, const Sessions *ss, const char *facts,
                         const char *decided, int since_days, char *err, size_t errcap) {
    const char *name = strrchr(cg->root, '/');
    name = name && name[1] ? name + 1 : cg->root;
    StrBuf p; sb_init(&p);
    sb_printf(&p,
        "You write the resume brief for a coding agent about to continue work "
        "on the project \"%s\" (%s). The agent has the code and the spec in "
        "front of it but no memory of the sessions that produced them.\n\n"
        "You are given two sources. FACTS were read from the repository: the "
        "active feature and its task statuses, the recent commits, and the "
        "memories agents stored. DECIDED LOG holds statements quoted verbatim "
        "from %d past agent sessions ([s1] is the oldest), each picked by a "
        "decision model with three probabilities: that the statement is of the "
        "kind named, that it still held when its session ended, and that a "
        "resuming agent needs it.\n\n"
        "Write a compact brief in Markdown with exactly these sections:\n"
        "## Project — what this project is and how work is done in it (4-8 sentences).\n"
        "## Last %d days — what changed, grouped by theme, with task ids and dates "
        "where the sources give them.\n"
        "## Recent sessions — one short paragraph per session, newest first, "
        "headed by its tag and date: what it set out to do, what it got done, "
        "what it left open.\n"
        "## Key facts to resume — bullets: decisions and why, constraints, "
        "pitfalls, dead ends, and facts about the code or environment that are "
        "not obvious from the code. End every bullet with its source tag, e.g. [s3].\n"
        "## Next step — the concrete actions to take now, tied to task ids, and "
        "the open questions a person must answer.\n\n"
        "Rules: use only the two sources; never invent a file, command, task id, "
        "number, or result; a commit subject names what that commit built or "
        "tested, it is not a report of a failure; when a statement's kind is done but FACTS say the task "
        "is not done, trust FACTS and say so; when two sessions conflict, prefer "
        "the newer one and note the change; write plain prose, no preamble, no "
        "closing remarks, no marketing tone; aim for %ld words or fewer.\n\n"
        "=== FACTS ===\n%s\n=== DECIDED LOG ===\n%s",
        name, cg->root, ss->n, since_days > 0 ? since_days : 21,
        (long)(1200), facts, decided);
    char *text = chat_model_ask(cg, &r->writer, p.p, "codify recap", 4000, err, errcap);
    sb_free(&p);
    return text;
}

/* ---------------- cg recap ---------------- */

static bool agent_wanted(const char *list, const char *agent) {
    if (!list || !list[0]) return true;
    return strstr(list, agent) != NULL;
}

int cmd_recap(Cg *cg, const RecapOpts *o) {
    Recap r; memset(&r, 0, sizeof r);
    recap_config(cg, &r);
    if (o->facts_only) {
        StrBuf facts; sb_init(&facts);
        repo_facts(cg, o->since_days >= 0 ? o->since_days : 21, &facts);
        fputs(facts.p, stdout);
        sb_free(&facts);
        return 0;
    }
    if (!r.writer.have) {
        fprintf(stderr, "cg recap: needs CENTRA_API_KEY (or CG_CHANGELOG_KEY) in the "
                        "environment or %s/.env — both the decision model and the "
                        "writer go through the gateway\n", cg->root);
        return 1;
    }
    int nsess = o->sessions > 0 ? o->sessions : 6;
    int since = o->since_days >= 0 ? o->since_days : 21;
    long budget = o->budget > 0 ? o->budget : 24000;
    long oldest = since > 0 ? (long)time(NULL) - (long)since * 86400L : 0;
    const char *e = getenv("CG_RECAP_MAX_SNIPPETS");
    int cap = e && atoi(e) > 0 ? atoi(e) : RECAP_MAX_SNIPPETS;

    Sessions ss; memset(&ss, 0, sizeof ss);
    if (agent_wanted(o->agents, "claude")) find_claude(cg->root, oldest, &ss);
    if (agent_wanted(o->agents, "codex")) find_codex(cg->root, oldest, &ss);
    qsort(ss.v, (size_t)ss.n, sizeof ss.v[0], cmp_newest);
    if (ss.n > nsess) ss.n = nsess;

    /* parse, cap, drop sessions with nothing said in them */
    int w = 0, statements = 0, ncl = 0, ncx = 0;
    for (int i = 0; i < ss.n; i++) {
        Session *s = &ss.v[i];
        FILE *f = fopen(s->path, "r");
        if (!f) continue;
        if (strcmp(s->agent, "codex") == 0) parse_codex(s, f); else parse_claude(s, f);
        fclose(f);
        if (s->n < 2) { sess_free(s); continue; }
        sess_cap(s, cap);
        statements += s->n;
        if (strcmp(s->agent, "codex") == 0) ncx++; else ncl++;
        ss.v[w++] = *s;
    }
    ss.n = w;
    if (ss.n == 0) {
        char cd[4300];
        claude_dir(cg->root, cd, sizeof cd);
        fprintf(stderr, "cg recap: no Claude Code or Codex sessions for %s in the last %d days "
                        "(looked in %s and ~/.codex/sessions)\n", cg->root, since, cd);
        return 1;
    }
    qsort(ss.v, (size_t)ss.n, sizeof ss.v[0], cmp_oldest);
    fprintf(stderr, "cg recap: %d session%s (claude-code %d, codex %d), %d statements → %s\n",
            ss.n, ss.n == 1 ? "" : "s", ncl, ncx, statements, r.decide_model);

    decide_all(cg, &r, &ss);
    if (r.calls && r.failed >= r.calls) {
        fprintf(stderr, "cg recap: every decision call failed — nothing to build the brief from\n");
        for (int i = 0; i < ss.n; i++) sess_free(&ss.v[i]);
        free(ss.v);
        return 1;
    }
    int picked = select_picks(&ss, budget);
    StrBuf decided; sb_init(&decided);
    render_decided(&ss, &r, &decided);
    fprintf(stderr, "cg recap: %d decision call%s (%d from the cache%s), %d statements picked\n",
            r.calls, r.calls == 1 ? "" : "s", r.cached,
            r.failed ? ", some failed" : "", picked);

    char decided_path[4700];
    snprintf(decided_path, sizeof decided_path, "%s/%s/recap", cg->shared, CG_DIR);
    mkdirs(decided_path);
    snprintf(decided_path, sizeof decided_path, "%s/%s/recap/decided.md", cg->shared, CG_DIR);
    { FILE *f = fopen(decided_path, "w"); if (f) { fputs(decided.p, f); fclose(f); } }

    int rc = 0;
    if (o->decided_only) {
        if (o->json) {
            printf("{\"sessions\":%d,\"statements\":%d,\"picked\":%d,\"calls\":%d,"
                   "\"cached\":%d,\"failed\":%d,\"decide_model\":\"%s\",\"decided\":\"%s\"}\n",
                   ss.n, statements, picked, r.calls, r.cached, r.failed, r.decide_model, decided_path);
        } else fputs(decided.p, stdout);
    } else {
        StrBuf facts; sb_init(&facts);
        repo_facts(cg, since, &facts);
        char err[600];
        char *brief = write_brief(cg, &r, &ss, facts.p, decided.p, since, err, sizeof err);
        sb_free(&facts);
        if (!brief) {
            fprintf(stderr, "cg recap: the writer (%s) failed — %s\n  the decided log is at %s\n",
                    r.writer.model, err, decided_path);
            rc = 1;
        } else {
            char day[11];
            time_t now = time(NULL);
            strftime(day, sizeof day, "%Y-%m-%d", gmtime(&now));
            StrBuf out; sb_init(&out);
            sb_printf(&out, "<!-- cg recap %s: %d sessions (claude-code %d, codex %d), %d of %d "
                            "statements picked by %s, written by %s; sources in %s -->\n",
                      day, ss.n, ncl, ncx, picked, statements, r.decide_model, r.writer.model,
                      decided_path);
            sb_puts(&out, brief);
            sb_putc(&out, '\n');
            char defout[4700];
            config_context_path(cg->root, "recap.md", defout, sizeof defout);
            const char *of = o->outfile && o->outfile[0] ? o->outfile : defout;
            if (strcmp(of, "-") == 0) fputs(out.p, stdout);
            else {
                char path[4700];
                if (of[0] == '/') snprintf(path, sizeof path, "%s", of);
                else path_format(path, sizeof path, "%s/%s", cg->root, of);
                char dir[4700]; snprintf(dir, sizeof dir, "%s", path);
                char *sl = strrchr(dir, '/');
                if (sl) { *sl = 0; mkdirs(dir); }
                FILE *f = fopen(path, "w");
                if (!f) { fprintf(stderr, "cg recap: cannot write %s\n", path); rc = 1; }
                else {
                    fputs(out.p, f); fclose(f);
                    if (o->json)
                        printf("{\"sessions\":%d,\"statements\":%d,\"picked\":%d,\"calls\":%d,"
                               "\"cached\":%d,\"failed\":%d,\"decide_model\":\"%s\",\"writer\":\"%s\","
                               "\"outfile\":\"%s\",\"decided\":\"%s\"}\n",
                               ss.n, statements, picked, r.calls, r.cached, r.failed,
                               r.decide_model, r.writer.model, path, decided_path);
                    else printf("wrote %s (%d sessions, %d statements picked; sources in %s)\n",
                                path, ss.n, picked, decided_path);
                }
            }
            sb_free(&out);
            free(brief);
        }
    }
    sb_free(&decided);
    for (int i = 0; i < ss.n; i++) sess_free(&ss.v[i]);
    free(ss.v);
    return rc;
}
