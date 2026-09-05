/*
 * cg integrate — vendor-neutral installation and diagnostics for coding
 * agents. Detection and planning are read-only; apply is recoverable and
 * idempotent; doctor reports facts without pretending every host has the
 * same native capabilities.
 */
#include "cg.h"
#include <ctype.h>
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

static void integrate_self(char out[4096]) {
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
        s.configured = strstr(body, "[mcp_servers.codify]") &&
                       strstr(body, "args");
    else
        s.configured = strstr(body, "\"codify\"") &&
                       strstr(body, "\"mcp\"");
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

static int backup_existing(const char *path, const char *body) {
    if (!body) return 0;
    char backup[4800];
    snprintf(backup, sizeof backup, "%s.codify.bak", path);
    if (access(backup, F_OK) == 0) return 0;
    return write_entire_file(backup, body, strlen(body));
}

static char *integrate_entry(const char *bin, bool vscode) {
    StrBuf b; sb_init(&b);
    sb_puts(&b, "\"codify\":{");
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
    if (strstr(body, "\"codify\"") && strstr(body, "\"mcp\"")) {
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
    if (body && strstr(body, "[mcp_servers.codify]")) { free(body); return 1; }
    ensure_parent(path);
    if (backup_existing(path, body) != 0) { free(body); return -1; }
    FILE *f = fopen(path, "a");
    if (!f) { free(body); return -1; }
    fprintf(f, "%s[mcp_servers.codify]\ncommand = \"%s\"\n"
               "args = [\"mcp\"]\n", body && body[0] ? "\n" : "", bin);
    int rc = fclose(f);
    free(body);
    return rc;
}

static const char *SKILL_BODY =
"---\nname: codify-workflow\ndescription: Ground coding work in the local "
"Codify graph, spec, evidence, and handoff lifecycle.\n---\n\n"
"<!-- codify-owned: portable-agent-skill v1 -->\n"
"# Codify workflow\n\n"
"1. Run `cg brief`, then `cg spec next` and `cg spec start <id>`.\n"
"2. Use `cg survey` and `cg context` before broad reads.\n"
"3. Implement only the claimed task; record durable decisions with `cg "
"remember`.\n"
"4. Run `cg review`, `cg guard`, and the task verification.\n"
"5. Snapshot with `cg commit`, qualify with `cg spec done`, and prove with "
"`cg spec trace`.\n"
"6. When `cg spec next` returns `@docs`, build `cg docs packet`, update only "
"the configured documentation targets and claims ledger, then finish with "
"`cg docs close`. Never recursively run `cg spec run` from documentation "
"closure.\n"
"Never force completion or treat a snapshot, declaration, or heartbeat as "
"qualification.\n";

static const char *EVENT_SH =
"#!/bin/sh\n"
"# codify-owned: portable-event-shim v1\n"
"source_name=${1:-generic}\n"
"exec cg event ingest --source \"$source_name\"\n";

static const char *SHIM_HOSTS[] = {
    "codex", "claude", "copilot", "cursor", "gemini", NULL
};

static const char *asset_state(const char *path, const char *marker) {
    char *body = read_entire_file(path, NULL);
    if (!body) return "create";
    bool owned = strstr(body, marker) != NULL;
    free(body);
    return owned ? "unchanged" : "conflict";
}

static int apply_asset(const char *path, const char *body, bool executable) {
    char *old = read_entire_file(path, NULL);
    if (old && !strstr(old, "codify-owned:")) { free(old); return 2; }
    if (old && strcmp(old, body) == 0) { free(old); return 1; }
    ensure_parent(path);
    if (backup_existing(path, old) != 0) { free(old); return -1; }
    free(old);
    if (write_entire_file(path, body, strlen(body)) != 0) return -1;
    return executable ? chmod(path, 0755) : 0;
}

static char *host_shim_body(const char *host) {
    StrBuf b; sb_init(&b);
    sb_printf(&b, "#!/bin/sh\n# codify-owned: %s-event-shim v1\n"
                  "exec \"$(dirname \"$0\")/event.sh\" %s\n", host, host);
    return b.p;
}

typedef struct { Cg *cg; } IntegrateAgentmd;
static int integrate_agentmd_call(void *v) {
    return cmd_agentmd(((IntegrateAgentmd *)v)->cg, true);
}

/* Generate the graph projection only when its ownership marker is present or
 * the path is empty. Capture cmd_agentmd's normal CLI report so JSON apply
 * remains one valid document. Returns apply_asset-style status. A busy
 * database is not a failure: the projection renders from the last completed
 * index and the next apply catches up. */
static int integrate_agent_context(Cg *cg) {
    char path[4700];
    snprintf(path, sizeof path, "%s/%s", cg->root, CG_AGENT_CONTEXT);
    char *before = read_entire_file(path, NULL);
    if (before && !strstr(before, "codify-owned: graph-agent-context")) {
        free(before); return 2;
    }
    SysInfo si;
    IndexStats st;
    sysinfo_detect(&si);
    /* A busy database is not a failure here: the projection is rendered from
     * the last completed index and the next apply catches up. */
    if (cg_index(cg, &si, false, &st, true) != 0 && !st.busy) {
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
    snprintf(path, sizeof path, "%s/.agents/skills/codify-workflow/SKILL.md",
             cg->root);
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
    snprintf(skill, sizeof skill, "%s/.agents/skills/codify-workflow/SKILL.md",
             cg->root);
    snprintf(event, sizeof event, "%s/.codify/hooks/event.sh", cg->root);
    snprintf(context, sizeof context, "%s/%s", cg->root, CG_AGENT_CONTEXT);
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
    snprintf(path, sizeof path, "%s/.agents/skills/codify-workflow/SKILL.md",
             cg->root);
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
    if (json) sb_printf(&b, "],\"changed\":%d,\"errors\":%d}\n",
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
    snprintf(skill, sizeof skill, "%s/.agents/skills/codify-workflow/SKILL.md", cg->root);
    snprintf(event, sizeof event, "%s/.codify/hooks/event.sh", cg->root);
    snprintf(context, sizeof context, "%s/%s", cg->root, CG_AGENT_CONTEXT);
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
    if (json) {
        printf("{\"ok\":%s,\"findings\":[%s]}\n", n ? "false" : "true",
               findings.p);
    } else if (n) {
        printf("integration doctor — %d finding(s):\n%s", n, findings.p);
    } else printf("integration doctor — healthy\n");
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
        sb_puts(&b, "]}\n"); fputs(b.p, stdout); sb_free(&b);
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
    }
    return 0;
}

int cmd_integrate(Cg *cg, const char *action, bool json, bool compatibility) {
    if (!action || !action[0]) action = "detect";
    if (compatibility && !json)
        printf("Codify compatibility installer -> `cg integrate apply`\n");
    if (strcmp(action, "detect") == 0) return integrate_detect(cg, json);
    if (strcmp(action, "plan") == 0) return integrate_plan(cg, json);
    if (strcmp(action, "apply") == 0) return integrate_apply(cg, json);
    if (strcmp(action, "doctor") == 0) return integrate_doctor(cg, json);
    fprintf(stderr, "usage: cg integrate [detect|plan|apply|doctor]\n");
    return 1;
}
