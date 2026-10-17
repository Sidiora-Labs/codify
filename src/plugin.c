/*
 * The Claude Code plugin and the Codex hooks that cg integrate installs.
 *
 * plugin_render writes a one-plugin marketplace under
 * $HOME/.codify/plugins/claude-code/ from string templates and the absolute
 * cg path; plugin_install asks the claude CLI to register and install it
 * (or prints the two commands when claude is not on PATH); plugin_state
 * reads what Claude Code recorded under $HOME/.claude/plugins. The Codex
 * hooks are one repo file, <root>/.codex/hooks.json.
 *
 * Ownership follows apply_asset in integrate.c: a file carrying the
 * codify-owned: marker is ours to rewrite, anything else at one of our paths
 * is a conflict that is reported and left alone. Every marker names the cg
 * version, so a new cg regenerates the whole tree. No .codify.bak copies:
 * these files are generated in full and nobody else's edits live in them.
 */
#include "cg.h"
#include <ctype.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

/* The marker every generated file carries, version included. */
#define PLUGIN_MARK "codify-owned: claude-code-plugin cg " CG_VERSION
#define CODEX_MARK  "codify-owned: codex-hooks cg " CG_VERSION
#define HOOK_TIMEOUT 20

void plugin_root(char out[4700]) {
    const char *home = getenv("HOME");
    snprintf(out, 4700, "%s/.codify/plugins/claude-code",
             home && home[0] ? home : ".");
}

static int plugin_mkparent(const char *path) {
    char dir[4700];
    snprintf(dir, sizeof dir, "%s", path);
    char *slash = strrchr(dir, '/');
    if (!slash) return 0;
    *slash = 0;
    return mkdirs(dir);
}

/* 0 written, 1 unchanged, 2 conflict (not ours, kept), -1 error */
static int plugin_write(const char *path, const char *body) {
    char *old = read_entire_file(path, NULL);
    if (old && !strstr(old, "codify-owned:")) { free(old); return 2; }
    if (old && strcmp(old, body) == 0) { free(old); return 1; }
    free(old);
    if (plugin_mkparent(path) != 0) return -1;
    return write_entire_file(path, body, strlen(body)) == 0 ? 0 : -1;
}

/* The cg path as a shell word: quoted only when it needs to be. */
static void shell_word(StrBuf *b, const char *s) {
    bool plain = s[0] != 0;
    for (const char *p = s; *p; p++)
        if (!isalnum((unsigned char)*p) && !strchr("/._-+=:@", *p))
            plain = false;
    if (plain) sb_puts(b, s); else sb_shquote(b, s);
}

/* One command hook: {"type":"command","command":"<bin> <args>","timeout":20}.
 * tail is appended to the command line (the Codex marker comment). */
static void hook_cmd(StrBuf *b, const char *bin, const char *args,
                     const char *tail) {
    StrBuf c; sb_init(&c);
    shell_word(&c, bin);
    sb_printf(&c, " %s%s", args, tail ? tail : "");
    sb_puts(b, "{ \"type\": \"command\", \"command\": ");
    sb_json_str(b, c.p);
    sb_printf(b, ", \"timeout\": %d }", HOOK_TIMEOUT);
    sb_free(&c);
}

/* One matcher group; matcher NULL for the events that take none. */
static void hook_group(StrBuf *b, const char *matcher, const char *bin,
                       const char *args, const char *tail) {
    sb_puts(b, "      {");
    if (matcher) {
        sb_puts(b, " \"matcher\": ");
        sb_json_str(b, matcher);
        sb_putc(b, ',');
    }
    sb_puts(b, " \"hooks\": [ ");
    hook_cmd(b, bin, args, tail);
    sb_puts(b, " ] }");
}

typedef struct { const char *event, *matcher, *args; } HookRow;

/* req 5.2: every row a command hook calling cg by absolute path.
 * WorktreeCreate and WorktreeRemove are deliberately absent: a
 * WorktreeCreate hook REPLACES git's worktree creation and must print the
 * new path, and one that prints nothing makes creation fail (hooks.md),
 * so an observing hook there would break the host. Native worktrees are
 * seen from the subagent's cwd instead. */
static const HookRow CLAUDE_HOOKS[] = {
    { "SessionStart",   NULL, "hook event --host claude" },
    { "SessionEnd",     NULL, "hook event --host claude" },
    { "Stop",           NULL, "hook event --host claude" },
    { "SubagentStart",  NULL, "hook event --host claude" },
    { "SubagentStop",   NULL, "hook event --host claude" },
    { "PreToolUse",  "Agent|Task", "hook event --host claude" },
    { "PreToolUse",  "Bash",       "hook pre-bash" },
    { "PostToolUse", "Edit|Write|MultiEdit|NotebookEdit", "hook post-edit" },
    { "PostToolUse", "Agent|Task", "hook event --host claude" },
    { NULL, NULL, NULL }
};

/* req 5.4. Codex edits through apply_patch; Edit|Write cover hosts that
 * name the tools the Claude way. */
static const HookRow CODEX_HOOKS[] = {
    { "SessionStart",  NULL, "hook event --host codex" },
    { "SessionEnd",    NULL, "hook event --host codex" },
    { "Stop",          NULL, "hook event --host codex" },
    { "SubagentStart", NULL, "hook event --host codex" },
    { "SubagentStop",  NULL, "hook event --host codex" },
    { "PreToolUse",    NULL, "hook event --host codex" },
    { "PostToolUse",   "apply_patch|Edit|Write", "hook post-edit" },
    { "PostToolUse",   NULL, "hook event --host codex" },
    { NULL, NULL, NULL }
};

/* The "hooks" object: rows of one event are grouped under one key, in
 * table order. */
static void hooks_object(StrBuf *b, const HookRow *rows, const char *bin,
                         const char *tail) {
    sb_puts(b, "  \"hooks\": {\n");
    bool first_event = true;
    for (int i = 0; rows[i].event; i++) {
        bool seen = false;
        for (int j = 0; j < i; j++)
            if (strcmp(rows[j].event, rows[i].event) == 0) seen = true;
        if (seen) continue;
        if (!first_event) sb_puts(b, ",\n");
        first_event = false;
        sb_printf(b, "    \"%s\": [\n", rows[i].event);
        bool first = true;
        for (int j = i; rows[j].event; j++) {
            if (strcmp(rows[j].event, rows[i].event) != 0) continue;
            if (!first) sb_puts(b, ",\n");
            first = false;
            hook_group(b, rows[j].matcher, bin, rows[j].args, tail);
        }
        sb_puts(b, "\n    ]");
    }
    sb_puts(b, "\n  }\n");
}

/* Only the documented "hooks" key: the docs do not say how an unknown
 * top-level key in hooks.json is treated, so the marker rides in each
 * command as a shell comment, as it does for Codex. */
static char *claude_hooks_body(const char *bin) {
    StrBuf b; sb_init(&b);
    sb_puts(&b, "{\n");
    hooks_object(&b, CLAUDE_HOOKS, bin, " # " PLUGIN_MARK);
    sb_puts(&b, "}\n");
    return b.p;
}

/* Codex reads its own hooks.json schema; an unknown top-level key is not a
 * risk worth taking there, so the marker rides in each command as a shell
 * comment, which the host's shell ignores. */
char *plugin_codex_hooks_body(const char *bin) {
    StrBuf b; sb_init(&b);
    sb_puts(&b, "{\n");
    hooks_object(&b, CODEX_HOOKS, bin, " # " CODEX_MARK);
    sb_puts(&b, "}\n");
    return b.p;
}

static char *marketplace_body(void) {
    return xstrdup(
        "{\n"
        "  \"name\": \"codify\",\n"
        "  \"owner\": { \"name\": \"Codify\" },\n"
        "  \"description\": \"The Codify plugin for Claude Code, generated by "
        "hyperfide integrate apply\",\n"
        "  \"plugins\": [\n"
        "    {\n"
        "      \"name\": \"codify\",\n"
        "      \"source\": \"./plugins/codify\",\n"
        "      \"description\": \"Codify graph, spec workflow, and native "
        "agent tracking\",\n"
        "      \"version\": \"" CG_VERSION "\"\n"
        "    }\n"
        "  ],\n"
        "  \"_codify\": \"" PLUGIN_MARK "\"\n"
        "}\n");
}

static char *plugin_json_body(void) {
    /* The installed package name is pinned by existing plugin registrations. */
    return xstrdup(
        "{\n"
        "  \"name\": \"codify\",\n"
        "  \"version\": \"" CG_VERSION "\",\n"
        "  \"description\": \"Codify: the local code graph, the spec "
        "workflow, and native session and subagent tracking\",\n"
        "  \"author\": { \"name\": \"Codify\" },\n"
        "  \"_codify\": \"" PLUGIN_MARK "\"\n"
        "}\n");
}

/* The marker rides in the server's env: .mcp.json's top level is a map of
 * servers, so a stray key there would read as one. */
static char *mcp_json_body(const char *bin) {
    /* Keep the server key aligned with the pinned codify plugin package identity. */
    StrBuf b; sb_init(&b);
    sb_puts(&b, "{\n  \"mcpServers\": {\n    \"codify\": {\n"
                "      \"command\": ");
    sb_json_str(&b, bin);
    sb_puts(&b, ",\n      \"args\": [\"mcp\"],\n"
                "      \"env\": { \"CODIFY_OWNED\": \"" PLUGIN_MARK "\" }\n"
                "    }\n  }\n}\n");
    return b.p;
}

static char *skill_body(void) {
    StrBuf b; sb_init(&b);
    sb_puts(&b, integrate_skill_body());
    sb_puts(&b, "\n<!-- " PLUGIN_MARK " -->\n");
    return b.p;
}

static char *command_body(const char *bin, const char *desc,
                          const char *args) {
    StrBuf b; sb_init(&b);
    sb_printf(&b, "---\ndescription: %s\n---\n<!-- " PLUGIN_MARK " -->\n\n"
                  "Run `", desc);
    shell_word(&b, bin);
    sb_printf(&b, " %s` and work from what it reports.\n", args);
    return b.p;
}

typedef struct { const char *rel; char *body; } PluginFile;

/* Render the marketplace tree. Appends one entry per file to out (JSON
 * array items or text lines). Counts written files into *changed and
 * foreign files into *conflicts; returns the number of write errors. */
int plugin_render(const char *bin, bool json, StrBuf *out, int *changed,
                  int *conflicts) {
    char root[4700];
    plugin_root(root);
    PluginFile files[] = {
        { ".claude-plugin/marketplace.json", marketplace_body() },
        { "plugins/codify/.claude-plugin/plugin.json", plugin_json_body() },
        { "plugins/codify/hooks/hooks.json", claude_hooks_body(bin) },
        { "plugins/codify/.mcp.json", mcp_json_body(bin) },
        { "plugins/codify/skills/codify-workflow/SKILL.md", skill_body() },
        { "plugins/codify/commands/brief.md",
          command_body(bin, "Codify brief - repo state, the active task, and "
                            "prior decisions", "brief") },
        { "plugins/codify/commands/fleet.md",
          command_body(bin, "Codify fleet - every agent, branch, and task in "
                            "flight", "fleet status") },
        { "plugins/codify/commands/projection.md",
          command_body(bin, "Codify projection - the branches folded together "
                            "and the conflicts before the merge",
                       "projection status") },
    };
    int n = (int)(sizeof files / sizeof files[0]), errors = 0;
    for (int i = 0; i < n; i++) {
        char path[4800];
        snprintf(path, sizeof path, "%s/%s", root, files[i].rel);
        int rc = plugin_write(path, files[i].body);
        free(files[i].body);
        const char *result = rc == 0 ? "written" : rc == 1 ? "unchanged"
                           : rc == 2 ? "conflict" : "error";
        if (rc == 0) (*changed)++;
        else if (rc == 2) (*conflicts)++;
        else if (rc < 0) errors++;
        if (json) {
            if (i) sb_putc(out, ',');
            sb_puts(out, "{\"path\":"); sb_json_str(out, path);
            sb_puts(out, ",\"result\":"); sb_json_str(out, result);
            sb_putc(out, '}');
        } else if (rc == 2) {
            sb_printf(out, "    conflict: %s is not codify-owned - left "
                           "alone\n", path);
        } else if (rc < 0) {
            sb_printf(out, "    error: cannot write %s\n", path);
        }
    }
    return errors;
}

/* 0 written, 1 unchanged, 2 conflict, -1 error */
int plugin_codex_hooks(const Cg *cg, const char *bin, char path[4700]) {
    snprintf(path, 4700, "%s/.codex/hooks.json", cg->root);
    char *body = plugin_codex_hooks_body(bin);
    int rc = plugin_write(path, body);
    free(body);
    return rc;
}

/* "create", "unchanged", "stale", or "conflict" for a generated file */
const char *plugin_file_state(const char *path, const char *mark) {
    char *body = read_entire_file(path, NULL);
    if (!body) return "create";
    const char *s = !strstr(body, "codify-owned:") ? "conflict"
                  : strstr(body, mark) ? "unchanged" : "stale";
    free(body);
    return s;
}

const char *plugin_codex_state(const Cg *cg, char path[4700]) {
    snprintf(path, 4700, "%s/.codex/hooks.json", cg->root);
    const char *s = plugin_file_state(path, CODEX_MARK);
    return strcmp(s, "create") == 0 ? "missing"
         : strcmp(s, "unchanged") == 0 ? "configured" : s;
}

/* What Claude Code recorded: known_marketplaces.json names the marketplace
 * and where it lives; installed_plugins.json ({"version":2,"plugins":
 * {"codify@codify":[{"scope","installPath","version",...}]}}) the install.
 * Both formats are as claude 2.1 writes them. */
void plugin_state(PluginState *st) {
    memset(st, 0, sizeof *st);
    char root[4700], path[4800];
    plugin_root(root);
    snprintf(st->root, sizeof st->root, "%s", root);
    snprintf(path, sizeof path, "%s/plugins/codify/.claude-plugin/plugin.json",
             root);
    char *body = read_entire_file(path, NULL);
    if (body && strstr(body, "codify-owned:")) {
        st->rendered = true;
        char *v = json_get_string(body, "version");
        if (v) snprintf(st->rendered_version, sizeof st->rendered_version,
                        "%s", v);
        free(v);
    }
    free(body);
    const char *home = getenv("HOME");
    if (!home || !home[0]) return;
    snprintf(path, sizeof path, "%s/.claude/plugins/known_marketplaces.json",
             home);
    body = read_entire_file(path, NULL);
    if (body) {
        char *m = json_get_object(body, "codify");
        if (m) {
            st->registered = true;
            char *loc = json_get_string(m, "installLocation");
            if (!loc) {
                char *src = json_get_object(m, "source");
                if (src) loc = json_get_string(src, "path");
                free(src);
            }
            if (loc) snprintf(st->registered_path,
                              sizeof st->registered_path, "%s", loc);
            free(loc);
        }
        free(m);
    }
    free(body);
    snprintf(path, sizeof path, "%s/.claude/plugins/installed_plugins.json",
             home);
    body = read_entire_file(path, NULL);
    if (body) {
        char *plugins = json_get_object(body, "plugins");
        char *arr = plugins ? json_get_raw(plugins, "codify@codify") : NULL;
        char **items = NULL;
        int n = arr ? json_array_items(arr, &items) : 0;
        if (arr && arr[0] == '{') {      /* version 1 kept one object */
            items = xmalloc(sizeof *items);
            items[0] = xstrdup(arr);
            n = 1;
        }
        for (int i = 0; i < n; i++) {
            if (!st->entry) {
                st->entry = true;
                char *v = json_get_string(items[i], "version");
                if (v) snprintf(st->version, sizeof st->version, "%s", v);
                free(v);
            }
            free(items[i]);
        }
        free(items); free(arr); free(plugins);
    }
    free(body);
    st->installed = st->registered && st->entry;
    st->current = st->installed && strcmp(st->version, CG_VERSION) == 0;
}

void plugin_state_json(const PluginState *st, StrBuf *b) {
    sb_puts(b, "{\"root\":"); sb_json_str(b, st->root);
    sb_printf(b, ",\"rendered\":%s,\"rendered_version\":",
              st->rendered ? "true" : "false");
    sb_json_str(b, st->rendered_version);
    sb_printf(b, ",\"registered\":%s,\"installed\":%s,\"version\":",
              st->registered ? "true" : "false",
              st->installed ? "true" : "false");
    sb_json_str(b, st->version);
    sb_puts(b, ",\"cg_version\":\"" CG_VERSION "\"");
    sb_printf(b, ",\"current\":%s}", st->current ? "true" : "false");
}

/* claude, when the operator has it: CG_CLAUDE names it outright, else PATH */
static bool find_claude(char *out, size_t cap) {
    const char *ov = getenv("CG_CLAUDE");
    return cg_find_exe(ov && ov[0] ? ov : "claude", out, cap);
}

/* Run `<claude> <args>`; its exit status, and its last output line in
 * last. Non-essential traffic is off: registering a local directory needs
 * no network. */
static int claude_run(const char *claude, const char *args, char *last,
                      size_t cap) {
    StrBuf c; sb_init(&c);
    sb_puts(&c, "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 ");
    sb_shquote(&c, claude);
    sb_printf(&c, " %s </dev/null 2>&1", args);
    fflush(stdout);
    FILE *p = popen(c.p, "r");
    sb_free(&c);
    last[0] = 0;
    if (!p) return -1;
    char line[2048];
    while (fgets(line, sizeof line, p)) {
        size_t n = strcspn(line, "\r\n");
        line[n] = 0;
        /* drop terminal escapes and the spinner's carriage returns */
        char clean[2048]; size_t k = 0;
        for (size_t i = 0; line[i] && k + 1 < sizeof clean; i++) {
            if (line[i] == 0x1b) {
                while (line[i] && !isalpha((unsigned char)line[i])) i++;
                if (!line[i]) break;
                continue;
            }
            clean[k++] = line[i];
        }
        clean[k] = 0;
        char *s = clean;
        while (*s && isspace((unsigned char)*s)) s++;
        if (*s) snprintf(last, cap, "%s", s);
    }
    int st = pclose(p);
    return st == -1 ? -1 : WIFEXITED(st) ? WEXITSTATUS(st) : -1;
}

/* Register the marketplace and install the plugin through the claude CLI.
 * Already installed at this version: nothing runs. Installed at another
 * version: the marketplace is refreshed and the plugin updated. No claude
 * on PATH: the two commands are printed for the operator. Returns 0 when
 * the plugin is (now) installed or already was, 1 when the commands were
 * only printed, -1 when claude reported a failure. Appends a JSON object
 * or text lines to out. */
int plugin_install(bool json, StrBuf *out) {
    PluginState st;
    plugin_state(&st);
    StrBuf root; sb_init(&root);
    sb_shquote(&root, st.root);
    char add[5000], inst[256];
    snprintf(add, sizeof add, "plugin marketplace %s %s",
             st.registered ? "update" : "add",
             st.registered ? "codify" : root.p);
    snprintf(inst, sizeof inst, "plugin %s codify@codify --scope user",
             st.installed ? "update" : "install");
    sb_free(&root);
    char claude[4096];
    const char *result;
    char detail[2048] = "";
    int rc;
    if (st.current) {
        result = "already installed"; rc = 0;
    } else if (!find_claude(claude, sizeof claude)) {
        result = "manual"; rc = 1;
    } else {
        int a = claude_run(claude, add, detail, sizeof detail);
        int b = a == 0 ? claude_run(claude, inst, detail, sizeof detail) : -1;
        if (a == 0 && b == 0) {
            result = st.installed ? "updated" : "installed"; rc = 0;
        } else {
            result = "failed"; rc = -1;
        }
    }
    if (json) {
        sb_puts(out, "{\"result\":"); sb_json_str(out, result);
        sb_puts(out, ",\"commands\":[");
        char cmd[5200];
        snprintf(cmd, sizeof cmd, "claude %s", add);
        sb_json_str(out, cmd);
        snprintf(cmd, sizeof cmd, "claude %s", inst);
        sb_putc(out, ','); sb_json_str(out, cmd);
        sb_puts(out, "],\"output\":"); sb_json_str(out, detail);
        sb_putc(out, '}');
    } else if (rc == 1) {
        sb_printf(out, "  %-20s claude is not on PATH - run:\n"
                       "      claude %s\n      claude %s\n",
                  "plugin install", add, inst);
    } else {
        sb_printf(out, "  %-20s %-20s codify@codify %s\n", "plugin install",
                  result, CG_VERSION);
        if (detail[0]) sb_printf(out, "      claude: %s\n", detail);
        if (rc == -1)
            sb_printf(out, "      run by hand: claude %s && claude %s\n",
                      add, inst);
    }
    return rc;
}
