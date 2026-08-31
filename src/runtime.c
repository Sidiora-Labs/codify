/*
 * cg state — one truthful view across the independent state machines an
 * agent otherwise conflates: Git, Codify snapshots, spec declarations, and
 * live execution attempts. None of these is presented as proof of another.
 */
#include "cg.h"
#include <ctype.h>
#include <sys/wait.h>

typedef struct {
    bool available;
    bool dirty;
    int changed;
    char branch[512];
} GitState;

static void state_git(const Cg *cg, GitState *s) {
    memset(s, 0, sizeof *s);
    if (!git_available(cg)) return;
    StrBuf cmd; sb_init(&cmd);
    sb_printf(&cmd, "git -C '%s' status --porcelain=v1 --branch 2>/dev/null",
              cg->root);
    FILE *f = popen(cmd.p, "r");
    sb_free(&cmd);
    if (!f) return;
    char *line = NULL;
    size_t cap = 0;
    ssize_t n;
    while ((n = getline(&line, &cap, f)) > 0) {
        while (n > 0 && (line[n - 1] == '\n' || line[n - 1] == '\r'))
            line[--n] = 0;
        if (strncmp(line, "## ", 3) == 0) {
            snprintf(s->branch, sizeof s->branch, "%s", line + 3);
        } else if (n > 0) {
            s->changed++;
        }
    }
    free(line);
    int rc = pclose(f);
    s->available = WIFEXITED(rc) && WEXITSTATUS(rc) == 0;
    s->dirty = s->changed > 0;
}

typedef struct { Cg *g; bool json; } StateVcsCall;
static int state_call_vcs(void *v) {
    StateVcsCall *c = v;
    return cmd_status(c->g, c->json);
}

typedef struct { bool json; bool reconcile; } StateSpecCall;
static int state_call_spec(void *v) {
    StateSpecCall *c = v;
    char *status[] = { "status" };
    char *reconcile[] = { "reconcile" };
    return cmd_spec(1, c->reconcile ? reconcile : status, c->json);
}

static void state_raw_json(StrBuf *b, const char *raw) {
    if (!raw) { sb_puts(b, "null"); return; }
    while (*raw && isspace((unsigned char)*raw)) raw++;
    size_t n = strlen(raw);
    while (n && isspace((unsigned char)raw[n - 1])) n--;
    if (!n) sb_puts(b, "null");
    else sb_printf(b, "%.*s", (int)n, raw);
}

static bool state_live_attempt(Cg *cg, const char *agent, SpecAttempt *a,
                               char host[256], char session[256]) {
    memset(a, 0, sizeof *a);
    host[0] = session[0] = 0;
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT attempt_id,task,agent,fence,heartbeat,expires,"
        "ifnull(host,''),ifnull(session,'') FROM attempts "
        "WHERE agent=? AND state='running' "
        "AND expires>strftime('%s','now') ORDER BY fence DESC LIMIT 1");
    sqlite3_bind_text(st, 1, agent, -1, SQLITE_TRANSIENT);
    bool found = sqlite3_step(st) == SQLITE_ROW;
    if (found) {
        snprintf(a->attempt_id, sizeof a->attempt_id, "%s",
                 (const char *)sqlite3_column_text(st, 0));
        snprintf(a->task, sizeof a->task, "%s",
                 (const char *)sqlite3_column_text(st, 1));
        snprintf(a->agent, sizeof a->agent, "%s",
                 (const char *)sqlite3_column_text(st, 2));
        a->fence = (long)sqlite3_column_int64(st, 3);
        a->heartbeat = (long)sqlite3_column_int64(st, 4);
        a->expires = (long)sqlite3_column_int64(st, 5);
        snprintf(host, 256, "%s", (const char *)sqlite3_column_text(st, 6));
        snprintf(session, 256, "%s",
                 (const char *)sqlite3_column_text(st, 7));
    }
    sqlite3_finalize(st);
    return found;
}

int cmd_state(Cg *cg, bool json) {
    GitState git;
    state_git(cg, &git);
    const char *agent = cg_agent_name(NULL);
    SpecAttempt attempt;
    char host[256], session[256];
    bool live = state_live_attempt(cg, agent, &attempt, host, session);

    char *snapshot = NULL, *declaration = NULL, *stale = NULL;
    StateVcsCall vc = { cg, json };
    StateSpecCall sc = { json, false }, sr = { json, true };
    cg_capture(&snapshot, state_call_vcs, &vc);
    cg_capture(&declaration, state_call_spec, &sc);
    cg_capture(&stale, state_call_spec, &sr);

    if (json) {
        StrBuf b; sb_init(&b);
        sb_puts(&b, "{\"git\":{\"available\":");
        sb_puts(&b, git.available ? "true" : "false");
        sb_puts(&b, ",\"branch\":");
        if (git.available) sb_json_str(&b, git.branch);
        else sb_puts(&b, "null");
        sb_printf(&b, ",\"dirty\":%s,\"changed\":%d},"
                  "\"codify_snapshot\":", git.dirty ? "true" : "false",
                  git.changed);
        state_raw_json(&b, snapshot);
        sb_puts(&b, ",\"spec_declaration\":");
        state_raw_json(&b, declaration);
        sb_puts(&b, ",\"live_runtime\":{\"agent\":");
        sb_json_str(&b, agent);
        sb_puts(&b, ",\"owned_attempt\":");
        if (!live) {
            sb_puts(&b, "null");
        } else {
            sb_puts(&b, "{\"task\":"); sb_json_str(&b, attempt.task);
            sb_puts(&b, ",\"attempt_id\":");
            sb_json_str(&b, attempt.attempt_id);
            sb_printf(&b, ",\"fence\":%ld,\"heartbeat\":%ld,"
                      "\"expires\":%ld,\"host\":", attempt.fence,
                      attempt.heartbeat, attempt.expires);
            sb_json_str(&b, host);
            sb_puts(&b, ",\"session\":"); sb_json_str(&b, session);
            sb_putc(&b, '}');
        }
        sb_puts(&b, "},\"stale_state\":");
        state_raw_json(&b, stale);
        sb_puts(&b, "}\n");
        fputs(b.p, stdout);
        sb_free(&b);
    } else {
        printf("Git state: %s", git.available ? git.branch : "unavailable");
        if (git.available)
            printf(" — %s (%d changed)", git.dirty ? "dirty" : "clean",
                   git.changed);
        putchar('\n');
        printf("Codify snapshot state:\n%s", snapshot ? snapshot : "");
        printf("Spec declaration state:\n%s", declaration ? declaration : "");
        printf("Live runtime ownership: ");
        if (live)
            printf("%s attempt %.12s fence %ld (agent %s)\n", attempt.task,
                   attempt.attempt_id, attempt.fence, agent);
        else
            printf("none for agent %s\n", agent);
        printf("Stale state:\n%s", stale ? stale : "");
    }
    free(snapshot); free(declaration); free(stale);
    return 0;
}
