#include <stdio.h>
extern int hf_client_authority_guard(const char *operation, FILE *output);
/*
 * cg integrate — vendor-neutral installation and diagnostics for coding
 * agents. Detection and planning are read-only; apply is recoverable and
 * idempotent; doctor reports facts without pretending every host has the
 * same native capabilities.
 */
#include "cg.h"
extern int hyperfide_owned_write(const char *,const char *,size_t,const char *,bool);
#include <ctype.h>
#include <fcntl.h>
#include <errno.h>
#include <sys/stat.h>
#include <unistd.h>

typedef enum { CFG_JSON, CFG_VSCODE, CFG_TOML } ConfigKind;

typedef struct {
    const char *id, *label, *path, *root_key;
    ConfigKind kind;
    const char *instructions, *skills, *hooks, *sessions, *cloud;
} Adapter;

static const Adapter ADAPTERS[] = {
    { "codex", "Codex", "$HOME/.codex/config.toml", "mcp_servers",
      CFG_TOML, "native", "native", "native", "native", "native" },
    { "claude-code", "Claude Code", "$ROOT/.mcp.json", "mcpServers",
      CFG_JSON, "native", "native", "native", "native", "none" },
    { "copilot-vscode", "Copilot and VS Code", "$ROOT/.vscode/mcp.json",
      "servers", CFG_VSCODE, "native", "native", "native", "native",
      "native" },
    { "cursor", "Cursor", "$ROOT/.cursor/mcp.json", "mcpServers",
      CFG_JSON, "native", "native", "native", "native", "none" },
    { "gemini-cli", "Gemini CLI", "$ROOT/.gemini/settings.json",
      "mcpServers", CFG_JSON, "native", "native", "native", "native",
      "none" },
    { "opencode", "OpenCode", "$ROOT/.opencode/opencode.json", "mcp",
      CFG_JSON, "native", "portable", "portable", "native", "none" },
    { "zed", "Zed", "$ROOT/.zed/settings.json", "context_servers",
      CFG_JSON, "portable", "portable", "portable", "none", "none" },
    { "windsurf", "Windsurf", "$HOME/.codeium/windsurf/mcp_config.json",
      "mcpServers", CFG_JSON, "native", "portable", "portable", "native",
      "none" },
    { "cline", "Cline",
      "$HOME/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/"
      "cline_mcp_settings.json", "mcpServers", CFG_JSON, "native",
      "portable", "portable", "native", "none" },
    { "continue", "Continue", "$HOME/.continue/config.json", "mcpServers",
      CFG_JSON, "native", "portable", "portable", "native", "none" },
};
#define NADAPTERS ((int)(sizeof ADAPTERS / sizeof ADAPTERS[0]))

typedef struct {
    bool exists, configured, malformed, stale_name, unsupported;
    char protocol[64];
} ConfigState;

void integrate_self(char out[4096]) {
    const char *ov = getenv("CG_BINARY");
    if (ov && ov[0]) { snprintf(out, 4096, "%s", ov); return; }
    ssize_t n = readlink("/proc/self/exe", out, 4095);
    if (n > 0) out[n] = 0;
    else snprintf(out, 4096, "cg");
}

static void integrate_path(const Cg *cg, const char *tmpl, char out[4700]) {
    const char *home = getenv("HOME");
    StrBuf b; sb_init(&b);
    for (const char *p = tmpl; *p;) {
        if (strncmp(p, "$ROOT", 5) == 0) {
            sb_puts(&b, cg->root); p += 5;
        } else if (strncmp(p, "$HOME", 5) == 0) {
            sb_puts(&b, home && home[0] ? home : cg->root); p += 5;
        } else sb_putc(&b, *p++);
    }
    snprintf(out, 4700, "%s", b.p);
    sb_free(&b);
}

static bool json_balanced(const char *s) {
    int braces = 0, brackets = 0;
    bool string = false, escape = false;
    for (; *s; s++) {
        if (string) {
            if (escape) escape = false;
            else if (*s == '\\') escape = true;
            else if (*s == '"') string = false;
            continue;
        }
        if (*s == '"') string = true;
        else if (*s == '{') braces++;
        else if (*s == '}') { if (--braces < 0) return false; }
        else if (*s == '[') brackets++;
        else if (*s == ']') { if (--brackets < 0) return false; }
    }
    return !string && braces == 0 && brackets == 0;
}

static bool protocol_supported(const char *v) {
    return strcmp(v, CG_MCP_VERSION) == 0 ||
           strcmp(v, "2025-06-18") == 0 || strcmp(v, "2025-03-26") == 0 ||
           strcmp(v, "2024-11-05") == 0;
}

static ConfigState integrate_config_state(const Adapter *a,
                                          const char *path) {
    ConfigState s;
    memset(&s, 0, sizeof s);
    char *body = read_entire_file(path, NULL);
    if (!body) return s;
    s.exists = true;
    if (a->kind != CFG_TOML) s.malformed = !json_balanced(body);
    if (a->kind == CFG_TOML)
        s.configured = (strstr(body, "[mcp_servers.codify]") || strstr(body, "[mcp_servers.hyperfide]")) &&
                       strstr(body, "args");
    else
        s.configured = (strstr(body, "\"codify\"") || strstr(body, "\"hyperfide\"")) &&
                       strstr(body, "\"mcp\"");
    bool legacy=a->kind==CFG_TOML?strstr(body,"[mcp_servers.codify]")!=NULL:strstr(body,"\"codify\"")!=NULL;
    bool canonical=a->kind==CFG_TOML?strstr(body,"[mcp_servers.hyperfide]")!=NULL:strstr(body,"\"hyperfide\"")!=NULL;
    if(legacy&&canonical)s.malformed=true;
    s.stale_name = strstr(body, "codegraph") != NULL;
    const char *p = strstr(body, "\"protocolVersion\"");
    if (p && (p = strchr(p, ':'))) {
        p++;
        while (*p && (isspace((unsigned char)*p) || *p == '"')) p++;
        size_t n = strcspn(p, "\" \t\r\n,}");
        snprintf(s.protocol, sizeof s.protocol, "%.*s", (int)n, p);
        s.unsupported = s.protocol[0] && !protocol_supported(s.protocol);
    }
    free(body);
    return s;
}

static const char *integrate_action(const ConfigState *s) {
    if (!s->exists) return "create";
    if (s->malformed) return "conflict";
    if (s->configured) return "unchanged";
    return "merge";
}

static int ensure_parent(const char *path) {
    char dir[4700];
    snprintf(dir, sizeof dir, "%s", path);
    char *slash = strrchr(dir, '/');
    if (!slash) return 0;
    *slash = 0;
    return mkdirs(dir);
}

static int backup_existing(const char *path,const char *body) {
    if(!body)return 0;
    char parent[4700],directory[4900],backup[5200],hash[65];
    snprintf(parent,sizeof parent,"%s",path);
    char *slash=strrchr(parent,'/');if(slash)*slash=0;else snprintf(parent,sizeof parent,".");
    const char *leaf=strrchr(path,'/');leaf=leaf?leaf+1:path;
    sha256_hex(body,strlen(body),hash);
    snprintf(directory,sizeof directory,"%s/.hyperfide-backups",parent);
    if(mkdirs(directory))return -1;
    struct stat st;if(lstat(directory,&st)||!S_ISDIR(st.st_mode))return -1;
    snprintf(backup,sizeof backup,"%s/%s.%s",directory,leaf,hash);
    int fd=open(backup,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0600);
    if(fd<0){
        if(errno!=EEXIST||lstat(backup,&st)||!S_ISREG(st.st_mode)||st.st_nlink!=1)return -1;
        size_t n=0;char *old=read_entire_file(backup,&n);
        bool same=old&&n==strlen(body)&&!memcmp(old,body,n);free(old);return same?0:-1;
    }
    size_t n=0,len=strlen(body);while(n<len){ssize_t k=write(fd,body+n,len-n);if(k<=0){close(fd);return -1;}n+=(size_t)k;}
    int rc=fsync(fd);if(close(fd))rc=-1;
    int dfd=open(directory,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);if(dfd<0)return -1;
    if(fsync(dfd))rc=-1;
    if(close(dfd))rc=-1;
    return rc;
}

static char *integrate_entry(const char *bin, bool vscode) {
    StrBuf b; sb_init(&b);
    sb_puts(&b, "\"hyperfide\":{");
    if (vscode) sb_puts(&b, "\"type\":\"stdio\",");
    sb_puts(&b, "\"command\":"); sb_json_str(&b, bin);
    sb_puts(&b, ",\"args\":[\"mcp\"]}");
    return b.p;
}

static int integrate_json_apply(const Adapter *a, const char *path,
                                const char *bin) {
    char *body = read_entire_file(path, NULL);
    char *entry = integrate_entry(bin, a->kind == CFG_VSCODE);
    if (!body) {
        ensure_parent(path);
        StrBuf b; sb_init(&b);
        sb_printf(&b, "{\n  \"%s\": {\n    %s\n  }\n}\n", a->root_key,
                  entry);
        int rc = write_entire_file(path, b.p, b.len);
        sb_free(&b); free(entry);
        return rc;
    }
    if (!json_balanced(body)) { free(body); free(entry); return 2; }
    if(strstr(body,"\"codify\"")&&strstr(body,"\"hyperfide\"")){free(body);free(entry);return 2;}
    if ((strstr(body, "\"codify\"") || strstr(body, "\"hyperfide\"")) && strstr(body, "\"mcp\"")) {
        free(body); free(entry); return 1;
    }
    char needle[128];
    snprintf(needle, sizeof needle, "\"%s\"", a->root_key);
    char *key = strstr(body, needle);
    char *brace = key ? strchr(key + strlen(needle), '{') : NULL;
    StrBuf b; sb_init(&b);
    if (brace) {
        size_t head = (size_t)(brace + 1 - body);
        sb_printf(&b, "%.*s", (int)head, body);
        const char *p = brace + 1;
        while (*p && isspace((unsigned char)*p)) p++;
        sb_printf(&b, "\n    %s%s", entry, *p == '}' ? "\n  " : ",");
        sb_puts(&b, body + head);
    } else {
        char *last = strrchr(body, '}');
        if (!last) { sb_free(&b); free(body); free(entry); return 2; }
        const char *p = body + 1;
        while (*p && isspace((unsigned char)*p)) p++;
        size_t head = (size_t)(last - body);
        sb_printf(&b, "%.*s%s\n  \"%s\": {\n    %s\n  }\n}\n",
                  (int)head, body, *p == '}' ? "" : ",", a->root_key,
                  entry);
    }
    int rc = backup_existing(path, body);
    if (rc == 0) rc = write_entire_file(path, b.p, b.len);
    sb_free(&b); free(body); free(entry);
    return rc;
}

static int integrate_toml_apply(const char *path, const char *bin) {
    char *body = read_entire_file(path, NULL);
    if(body&&strstr(body,"[mcp_servers.codify]")&&strstr(body,"[mcp_servers.hyperfide]")){free(body);return 2;}
    if (body && (strstr(body, "[mcp_servers.codify]") || strstr(body, "[mcp_servers.hyperfide]"))) { free(body); return 1; }
    ensure_parent(path);
    if (backup_existing(path, body) != 0) { free(body); return -1; }
    FILE *f = fopen(path, "a");
    if (!f) { free(body); return -1; }
    fprintf(f, "%s[mcp_servers.hyperfide]\ncommand = \"%s\"\n"
               "args = [\"mcp\"]\n", body && body[0] ? "\n" : "", bin);
    int rc = fclose(f);
    free(body);
    return rc;
}

static const char *SKILL_BODY =
"---\nname: codify-workflow\ndescription: Ground coding work in the local "
"Hyperfide graph, spec, evidence, and handoff lifecycle.\n---\n\n"
"<!-- hyperfide-owned: portable-agent-skill v1 -->\n"
"# Hyperfide workflow\n\n"
"1. Run `hyperfide brief`, then `hyperfide spec next` and `hyperfide spec start <id>`.\n"
"2. Use `hyperfide survey` and `hyperfide context` before broad reads. Use grep_code, "
"find_files, search_code, and get_context (MCP) before any shell search; "
"from the CLI, `hyperfide grep <pattern>` and `hyperfide files <glob>` replace grep, rg, "
"and find.\n"
"3. Implement only the claimed task; record durable decisions with `hyperfide "
"remember`.\n"
"4. Run `hyperfide review`, `hyperfide guard`, and the task verification.\n"
"5. Snapshot with `hyperfide commit`, qualify with `hyperfide spec done`, and prove with "
"`hyperfide spec trace`.\n"
"6. When `hyperfide spec next` returns `@docs`, build `hyperfide docs packet`, update only "
"the configured documentation targets and claims ledger, then finish with "
"`hyperfide docs close`. Never recursively run `hyperfide spec run` from documentation "
"closure.\n"
"Never force completion or treat a snapshot, declaration, or heartbeat as "
"qualification.\n";

static const char *EVENT_SH =
"#!/bin/sh\n"
"# hyperfide-owned: portable-event-shim v1\n"
"source_name=${1:-generic}\n"
"exec hyperfide event ingest --source \"$source_name\"\n";

static const char *SHIM_HOSTS[] = {
    "codex", "claude", "copilot", "cursor", "gemini", NULL
};

static const char *asset_state(const char *path, const char *marker) {
    char *body = read_entire_file(path, NULL);
    if (!body) return "create";
    bool owned = strstr(body, marker) != NULL;
    if(!owned&&!strncmp(marker,"codify-owned:",13)) { char modern[160];snprintf(modern,sizeof modern,"hyperfide-owned:%s",marker+13);owned=strstr(body,modern)!=NULL; }
    free(body);
    return owned ? "unchanged" : "conflict";
}

static int apply_asset(const char *path, const char *body, bool executable) {
    char *old = read_entire_file(path, NULL);
    if (old && !strstr(old, "codify-owned:") && !strstr(old,"hyperfide-owned:")) { free(old); return 2; }
    if (old && strcmp(old, body) == 0) { free(old); return 1; }
    ensure_parent(path);
    if (backup_existing(path, old) != 0) { free(old); return -1; }
    free(old);
    if (hyperfide_owned_write(path, body, strlen(body), "integration-asset v1", true) != 0) return -1;
    return executable ? chmod(path, 0755) : 0;
}

/* the portable skill, for the Claude Code plugin's copy (src/plugin.c) */
const char *integrate_skill_body(void) { return SKILL_BODY; }

/* --no-plugin: apply leaves the Claude Code plugin and the Codex hooks out */
static bool skip_plugin;
void integrate_skip_plugin(bool skip) { skip_plugin = skip; }

/* Apply's plugin step: render the marketplace tree, install it through the
 * claude CLI, and write the Codex hooks. JSON adds the "plugin" and
 * "codex_hooks" members; text adds lines. Conflicts count as errors, like
 * every other generated asset; an install claude refused is reported, not
 * failed (warn, don't block). */
static void integrate_plugin_apply(Cg *cg, const char *bin, bool json,
                                   StrBuf *b, int *changed, int *errors) {
    if (skip_plugin) {
        if (json) sb_puts(b, ",\"plugin\":{\"result\":\"skipped\"},"
                             "\"codex_hooks\":{\"result\":\"skipped\"}");
        else sb_printf(b, "  %-20s skipped (--no-plugin)\n",
                       "Claude Code plugin");
        return;
    }
    char root[4700];
    plugin_root(root);
    StrBuf files; sb_init(&files);
    int pchanged = 0, pconflicts = 0;
    int perr = plugin_render(bin, json, &files, &pchanged, &pconflicts);
    *changed += pchanged;
    *errors += perr + pconflicts;
    StrBuf inst; sb_init(&inst);
    plugin_install(json, &inst);
    char cpath[4700];
    int crc = plugin_codex_hooks(cg, bin, cpath);
    const char *cres = crc == 0 ? "configured" : crc == 1
        ? "already configured" : crc == 2 ? "conflict" : "error";
    if (crc == 0) (*changed)++;
    if (crc < 0 || crc == 2) (*errors)++;
    if (json) {
        sb_puts(b, ",\"plugin\":{\"root\":"); sb_json_str(b, root);
        sb_printf(b, ",\"changed\":%d,\"conflicts\":%d,\"files\":[%s],"
                     "\"install\":%s}", pchanged, pconflicts, files.p,
                  inst.p);
        sb_puts(b, ",\"codex_hooks\":{\"path\":"); sb_json_str(b, cpath);
        sb_puts(b, ",\"result\":"); sb_json_str(b, cres);
        sb_puts(b, ",\"note\":\"Codex runs these hooks only after they are "
                   "trusted once through /hooks\"}");
    } else {
        sb_printf(b, "  %-20s %d written, %d conflict(s)  %s\n",
                  "Claude Code plugin", pchanged, pconflicts, root);
        sb_puts(b, files.p);
        sb_puts(b, inst.p);
        sb_printf(b, "  %-20s %-20s %s\n", "Codex hooks", cres, cpath);
        if (crc == 0)
            sb_puts(b, "      trust them once in Codex through /hooks\n");
    }
    sb_free(&files); sb_free(&inst);
}

/* detect and doctor: the plugin and the Codex hooks as they stand */
static void integrate_plugin_report(Cg *cg, bool json, StrBuf *b) {
    PluginState ps;
    plugin_state(&ps);
    char cpath[4700];
    const char *cs = plugin_codex_state(cg, cpath);
    if (json) {
        sb_puts(b, ",\"plugin\":"); plugin_state_json(&ps, b);
        sb_puts(b, ",\"codex_hooks\":{\"path\":"); sb_json_str(b, cpath);
        sb_puts(b, ",\"state\":"); sb_json_str(b, cs);
        sb_puts(b, ",\"trust\":\"Codex runs these hooks only after they are "
                   "trusted once through /hooks\"}");
    } else {
        sb_printf(b, "  %-20s %-10s %s%s%s\n", "Claude Code plugin",
                  ps.installed ? "installed" : ps.rendered ? "rendered"
                  : "missing", ps.installed ? "codify@codify " : "",
                  ps.installed ? ps.version : "",
                  ps.installed && !ps.current ? " (cg is " CG_VERSION ")"
                  : "");
        sb_printf(b, "    %s\n", ps.root);
        sb_printf(b, "  %-20s %-10s %s\n", "Codex hooks", cs, cpath);
        sb_puts(b, "    Codex runs them only after they are trusted once "
                   "through /hooks\n");
    }
}

static char *host_shim_body(const char *host) {
    StrBuf b; sb_init(&b);
    sb_printf(&b, "#!/bin/sh\n# hyperfide-owned: %s-event-shim v1\n"
                  "exec \"$(dirname \"$0\")/event.sh\" %s\n", host, host);
    return b.p;
}

typedef struct { Cg *cg; } IntegrateAgentmd;
static int integrate_agentmd_call(void *v) {
    return cmd_agentmd(((IntegrateAgentmd *)v)->cg, true);
}

/* Only absent or legacy/current-owned context may be regenerated; preserve
 * user-owned content. Capture the CLI report to keep JSON apply valid.
 * Auto-sync honors project policy; busy indexing permits the last completed
 * graph. Return apply_asset-style changed/unchanged/refused/error status. */
static int integrate_agent_context(Cg *cg) {
    char path[4700];
    config_context_path(cg->root, "agent-context.md", path, sizeof path);
    char *before = read_entire_file(path, NULL);
    if (before && !strstr(before, "codify-owned: graph-agent-context") && !strstr(before,"hyperfide-owned: graph-agent-context")) {
        free(before); return 2;
    }
    SysInfo si;
    IndexStats st;
    sysinfo_detect(&si);
    /* A busy database is not a failure here: the projection is rendered from
     * the last completed index and the next apply catches up. */
    if (config_auto_sync(cg->root) &&
        cg_index(cg, &si, false, &st, true) != 0 && !st.busy) {
        free(before); return -1;
    }
    IntegrateAgentmd call = { cg };
    char *report = NULL;
    int rc = cg_capture(&report, integrate_agentmd_call, &call);
    free(report);
    if (rc != 0) { free(before); return -1; }
    char *after = read_entire_file(path, NULL);
    bool changed = !before || !after || strcmp(before, after) != 0;
    free(before); free(after);
    return changed ? 0 : 1;
}

int integrate_apply_portable(Cg *cg, bool quiet) {
    int errors = 0, changed = 0, rc;
    char path[4700];
    path_format(path, sizeof path, "%s/%s/codify-workflow/SKILL.md", cg->root,
                config_skills_rel(cg->root));
    rc = apply_asset(path, SKILL_BODY, false);
    if (rc == 0) changed++; else if (rc < 0 || rc == 2) errors++;
    snprintf(path, sizeof path, "%s/.codify/hooks/event.sh", cg->root);
    rc = apply_asset(path, EVENT_SH, true);
    if (rc == 0) changed++; else if (rc < 0 || rc == 2) errors++;
    for (int i = 0; SHIM_HOSTS[i]; i++) {
        snprintf(path, sizeof path, "%s/.codify/hooks/%s.sh", cg->root,
                 SHIM_HOSTS[i]);
        char *body = host_shim_body(SHIM_HOSTS[i]);
        rc = apply_asset(path, body, true);
        free(body);
        if (rc == 0) changed++; else if (rc < 0 || rc == 2) errors++;
    }
    rc = integrate_agent_context(cg);
    if (rc == 0) changed++; else if (rc < 0 || rc == 2) errors++;
    if (!quiet)
        printf("  portable assets: %d change(s), %d conflict(s)\n",
               changed, errors);
    return errors ? 1 : 0;
}

static void adapter_json(const Adapter *a, const char *path,
                         const ConfigState *s, StrBuf *b) {
    sb_puts(b, "{\"id\":"); sb_json_str(b, a->id);
    sb_puts(b, ",\"label\":"); sb_json_str(b, a->label);
    sb_puts(b, ",\"path\":"); sb_json_str(b, path);
    sb_puts(b, ",\"capabilities\":{\"mcp\":\"native\","
               "\"instructions\":"); sb_json_str(b, a->instructions);
    sb_puts(b, ",\"skills\":"); sb_json_str(b, a->skills);
    sb_puts(b, ",\"hooks\":"); sb_json_str(b, a->hooks);
    sb_puts(b, ",\"sessions\":"); sb_json_str(b, a->sessions);
    sb_puts(b, ",\"cloud\":"); sb_json_str(b, a->cloud);
    sb_puts(b, "},\"state\":");
    sb_json_str(b, s->malformed ? "malformed" : s->configured ? "configured"
                : s->exists ? "incomplete" : "missing");
    sb_puts(b, ",\"action\":"); sb_json_str(b, integrate_action(s));
    sb_putc(b, '}');
}

int integrate_plan(Cg *cg, bool json) {
    StrBuf b; sb_init(&b);
    if (json) sb_puts(&b, "{\"action\":\"plan\",\"hosts\":[");
    else sb_puts(&b, "integration plan (read-only):\n");
    for (int i = 0; i < NADAPTERS; i++) {
        char path[4700]; integrate_path(cg, ADAPTERS[i].path, path);
        ConfigState s = integrate_config_state(&ADAPTERS[i], path);
        if (json) {
            if (i) sb_putc(&b, ',');
            adapter_json(&ADAPTERS[i], path, &s, &b);
        } else {
            sb_printf(&b, "  %-20s %-9s %s\n", ADAPTERS[i].label,
                      integrate_action(&s), path);
        }
    }
    char skill[4700], event[4700], context[4700];
    path_format(skill, sizeof skill, "%s/%s/codify-workflow/SKILL.md", cg->root,
                config_skills_rel(cg->root));
    snprintf(event, sizeof event, "%s/.codify/hooks/event.sh", cg->root);
    config_context_path(cg->root, "agent-context.md", context, sizeof context);
    if (json) {
        sb_puts(&b, "],\"assets\":[{\"path\":"); sb_json_str(&b, skill);
        sb_puts(&b, ",\"action\":");
        sb_json_str(&b, asset_state(skill, "codify-owned:"));
        sb_puts(&b, "},{\"path\":"); sb_json_str(&b, event);
        sb_puts(&b, ",\"action\":");
        sb_json_str(&b, asset_state(event, "codify-owned:"));
        sb_putc(&b, '}');
        for (int i = 0; SHIM_HOSTS[i]; i++) {
            char shim[4700];
            snprintf(shim, sizeof shim, "%s/.codify/hooks/%s.sh", cg->root,
                     SHIM_HOSTS[i]);
            sb_puts(&b, ",{\"path\":"); sb_json_str(&b, shim);
            sb_puts(&b, ",\"action\":");
            sb_json_str(&b, asset_state(shim, "codify-owned:"));
            sb_putc(&b, '}');
        }
        sb_puts(&b, ",{\"path\":"); sb_json_str(&b, context);
        sb_puts(&b, ",\"action\":");
        sb_json_str(&b, asset_state(context, "codify-owned: graph-agent-context"));
        sb_putc(&b, '}');
        sb_puts(&b, "]}\n");
    } else {
        sb_printf(&b, "  %-20s %-9s %s\n", "Portable Agent Skill",
                  asset_state(skill, "codify-owned:"), skill);
        sb_printf(&b, "  %-20s %-9s %s\n", "Lifecycle hook shims",
                  asset_state(event, "codify-owned:"), event);
        for (int i = 0; SHIM_HOSTS[i]; i++) {
            char shim[4700];
            snprintf(shim, sizeof shim, "%s/.codify/hooks/%s.sh", cg->root,
                     SHIM_HOSTS[i]);
            sb_printf(&b, "  %-20s %-9s %s\n", SHIM_HOSTS[i],
                      asset_state(shim, "codify-owned:"), shim);
        }
        sb_printf(&b, "  %-20s %-9s %s\n", "Graph agent context",
                  asset_state(context, "codify-owned: graph-agent-context"),
                  context);
    }
    fputs(b.p, stdout); sb_free(&b);
    return 0;
}

int integrate_apply(Cg *cg, bool json) {
    char bin[4096]; integrate_self(bin);
    StrBuf b; sb_init(&b);
    int errors = 0, changed = 0;
    if (json) sb_puts(&b, "{\"action\":\"apply\",\"hosts\":[");
    else sb_printf(&b, "applying Codify integrations (%s mcp):\n", bin);
    for (int i = 0; i < NADAPTERS; i++) {
        char path[4700]; integrate_path(cg, ADAPTERS[i].path, path);
        int rc = ADAPTERS[i].kind == CFG_TOML
            ? integrate_toml_apply(path, bin)
            : integrate_json_apply(&ADAPTERS[i], path, bin);
        const char *result = rc == 0 ? "configured" : rc == 1
            ? "already configured" : rc == 2 ? "conflict" : "error";
        if (rc == 0) changed++;
        if (rc < 0 || rc == 2) errors++;
        if (json) {
            if (i) sb_putc(&b, ',');
            sb_puts(&b, "{\"id\":"); sb_json_str(&b, ADAPTERS[i].id);
            sb_puts(&b, ",\"path\":"); sb_json_str(&b, path);
            sb_puts(&b, ",\"result\":"); sb_json_str(&b, result);
            sb_putc(&b, '}');
        } else sb_printf(&b, "  %-20s %-20s %s\n", ADAPTERS[i].label,
                         result, path);
    }
    char path[4700];
    path_format(path, sizeof path, "%s/%s/codify-workflow/SKILL.md", cg->root,
                config_skills_rel(cg->root));
    int arc = apply_asset(path, SKILL_BODY, false);
    if (arc == 0) changed++; else if (arc < 0 || arc == 2) errors++;
    snprintf(path, sizeof path, "%s/.codify/hooks/event.sh", cg->root);
    arc = apply_asset(path, EVENT_SH, true);
    if (arc == 0) changed++; else if (arc < 0 || arc == 2) errors++;
    for (int i = 0; SHIM_HOSTS[i]; i++) {
        snprintf(path, sizeof path, "%s/.codify/hooks/%s.sh", cg->root,
                 SHIM_HOSTS[i]);
        char *body = host_shim_body(SHIM_HOSTS[i]);
        arc = apply_asset(path, body, true);
        free(body);
        if (arc == 0) changed++; else if (arc < 0 || arc == 2) errors++;
    }
    arc = integrate_agent_context(cg);
    if (arc == 0) changed++; else if (arc < 0 || arc == 2) errors++;
    if (json) sb_putc(&b, ']');
    integrate_plugin_apply(cg, bin, json, &b, &changed, &errors);
    if (json) sb_printf(&b, ",\"changed\":%d,\"errors\":%d}\n",
                        changed, errors);
    else sb_printf(&b, "portable assets: %s (%d change(s), %d conflict(s))\n",
                   errors ? "attention needed" : "ready", changed, errors);
    fputs(b.p, stdout); sb_free(&b);
    return errors ? 1 : 0;
}

static void doctor_find(StrBuf *findings, int *n, bool json,
                        const char *fmt, ...) {
    va_list ap;
    char msg[5200];
    va_start(ap, fmt);
    vsnprintf(msg, sizeof msg, fmt, ap);
    va_end(ap);
    if (json) {
        if (*n) sb_putc(findings, ',');
        sb_json_str(findings, msg);
    } else {
        sb_printf(findings, "  ! %s\n", msg);
    }
    (*n)++;
}

int integrate_doctor(Cg *cg, bool json) {
    StrBuf findings; sb_init(&findings);
    int n = 0;
    char bin[4096]; integrate_self(bin);
    if (access(bin, X_OK) != 0)
        doctor_find(&findings, &n, json,
                    "Codify binary is missing or not executable: %s", bin);
    for (int i = 0; i < NADAPTERS; i++) {
        char path[4700]; integrate_path(cg, ADAPTERS[i].path, path);
        ConfigState s = integrate_config_state(&ADAPTERS[i], path);
        if (!s.exists)
            doctor_find(&findings, &n, json, "%s is not configured: %s",
                        ADAPTERS[i].label, path);
        else if (s.malformed)
            doctor_find(&findings, &n, json, "%s config is malformed: %s",
                        ADAPTERS[i].label, path);
        else if (!s.configured)
            doctor_find(&findings, &n, json,
                        "%s integration is incomplete: %s",
                        ADAPTERS[i].label, path);
        if (s.stale_name)
            doctor_find(&findings, &n, json,
                        "%s uses stale server name codegraph: %s",
                        ADAPTERS[i].label, path);
        if (s.unsupported)
            doctor_find(&findings, &n, json,
                        "%s declares unsupported protocol %s",
                        ADAPTERS[i].label, s.protocol);
    }
    char skill[4700], event[4700], context[4700];
    path_format(skill, sizeof skill, "%s/%s/codify-workflow/SKILL.md", cg->root,
                config_skills_rel(cg->root));
    snprintf(event, sizeof event, "%s/.codify/hooks/event.sh", cg->root);
    config_context_path(cg->root, "agent-context.md", context, sizeof context);
    const char *ss = asset_state(skill, "codify-owned:");
    const char *es = asset_state(event, "codify-owned:");
    if (strcmp(ss, "create") == 0)
        doctor_find(&findings, &n, json,
                    "portable Agent Skill is missing: %s", skill);
    else if (strcmp(ss, "conflict") == 0)
        doctor_find(&findings, &n, json,
                    "Agent Skill has conflicting generated-file ownership: %s",
                    skill);
    if (strcmp(es, "create") == 0)
        doctor_find(&findings, &n, json,
                    "portable event hook is missing: %s", event);
    else if (strcmp(es, "conflict") == 0)
        doctor_find(&findings, &n, json,
                    "event hook has conflicting generated-file ownership: %s",
                    event);
    const char *cs = asset_state(context, "codify-owned: graph-agent-context");
    if (strcmp(cs, "create") == 0)
        doctor_find(&findings, &n, json,
                    "graph agent context is missing: %s", context);
    else if (strcmp(cs, "conflict") == 0)
        doctor_find(&findings, &n, json,
                    "graph context has conflicting generated-file ownership: %s",
                    context);
    for (int i = 0; SHIM_HOSTS[i]; i++) {
        char shim[4700];
        snprintf(shim, sizeof shim, "%s/.codify/hooks/%s.sh", cg->root,
                 SHIM_HOSTS[i]);
        const char *state = asset_state(shim, "codify-owned:");
        if (strcmp(state, "create") == 0)
            doctor_find(&findings, &n, json, "%s hook shim is missing: %s",
                        SHIM_HOSTS[i], shim);
        else if (strcmp(state, "conflict") == 0)
            doctor_find(&findings, &n, json,
                        "%s hook shim has conflicting ownership: %s",
                        SHIM_HOSTS[i], shim);
    }
    /* Skills promoted from memories are generated assets like any other, so
     * doctor is where their drift shows up: a rendered SKILL.md whose memory
     * was forgotten, or that no longer matches the note it came from. */
    char **sf = NULL;
    int nsf = skill_findings(cg, &sf);
    for (int i = 0; i < nsf; i++) {
        doctor_find(&findings, &n, json, "%s", sf[i]);
        free(sf[i]);
    }
    free(sf);
    /* The plugin and the Codex hooks: a foreign file at one of their paths
     * or an installed plugin older than cg is a finding; not installed is
     * a state, reported beside the findings, since --no-plugin is a choice. */
    PluginState ps;
    plugin_state(&ps);
    if (ps.installed && !ps.current)
        doctor_find(&findings, &n, json,
                    "Claude Code plugin codify@codify is %s but cg is %s: "
                    "run cg integrate apply", ps.version, CG_VERSION);
    char ppath[4800];
    snprintf(ppath, sizeof ppath,
             "%s/plugins/codify/.claude-plugin/plugin.json", ps.root);
    if (strcmp(plugin_file_state(ppath, "codify-owned:"), "conflict") == 0)
        doctor_find(&findings, &n, json,
                    "Claude Code plugin has conflicting ownership: %s", ppath);
    char cpath[4700];
    if (strcmp(plugin_codex_state(cg, cpath), "conflict") == 0)
        doctor_find(&findings, &n, json,
                    "Codex hooks have conflicting ownership: %s", cpath);
    StrBuf extra; sb_init(&extra);
    integrate_plugin_report(cg, json, &extra);
    if (json) {
        printf("{\"ok\":%s,\"findings\":[%s]%s}\n", n ? "false" : "true",
               findings.p, extra.p);
    } else {
        if (n) printf("integration doctor — %d finding(s):\n%s", n,
                      findings.p);
        else printf("integration doctor — healthy\n");
        fputs(extra.p, stdout);
    }
    sb_free(&extra);
    sb_free(&findings);
    return n ? 1 : 0;
}

static int integrate_detect(Cg *cg, bool json) {
    if (json) {
        StrBuf b; sb_init(&b);
        sb_puts(&b, "{\"action\":\"detect\",\"hosts\":[");
        for (int i = 0; i < NADAPTERS; i++) {
            char path[4700]; integrate_path(cg, ADAPTERS[i].path, path);
            ConfigState s = integrate_config_state(&ADAPTERS[i], path);
            if (i) sb_putc(&b, ',');
            adapter_json(&ADAPTERS[i], path, &s, &b);
        }
        sb_putc(&b, ']');
        integrate_plugin_report(cg, true, &b);
        sb_puts(&b, "}\n"); fputs(b.p, stdout); sb_free(&b);
    } else {
        printf("Codify host capability registry:\n");
        for (int i = 0; i < NADAPTERS; i++) {
            char path[4700]; integrate_path(cg, ADAPTERS[i].path, path);
            ConfigState s = integrate_config_state(&ADAPTERS[i], path);
            printf("  %-20s %-10s mcp=native instructions=%s skills=%s "
                   "hooks=%s sessions=%s cloud=%s\n", ADAPTERS[i].label,
                   s.configured ? "configured" : s.exists ? "incomplete" : "missing",
                   ADAPTERS[i].instructions, ADAPTERS[i].skills,
                   ADAPTERS[i].hooks, ADAPTERS[i].sessions,
                   ADAPTERS[i].cloud);
            printf("    %s\n", path);
        }
        StrBuf b; sb_init(&b);
        integrate_plugin_report(cg, false, &b);
        fputs(b.p, stdout); sb_free(&b);
    }
    return 0;
}

int cmd_integrate(Cg *cg, const char *action, bool json, bool compatibility) {
    { int authority_rc = hf_client_authority_guard("integrate", stderr); if (authority_rc) return authority_rc; }
    if (!action || !action[0]) action = "detect";
    if (compatibility && !json)
        printf("Codify compatibility installer -> `hyperfide integrate apply`\n");
    if (strcmp(action, "detect") == 0) return integrate_detect(cg, json);
    if (strcmp(action, "plan") == 0) return integrate_plan(cg, json);
    if (strcmp(action, "apply") == 0) return integrate_apply(cg, json);
    if (strcmp(action, "doctor") == 0) return integrate_doctor(cg, json);
    help_usage("integrate");
    return 1;
}
