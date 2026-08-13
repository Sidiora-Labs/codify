/*
 * Framework-aware route detection. Regex patterns run against the ORIGINAL
 * line (strings intact), gated by language; plus file-path conventions for
 * file-based routers (Next.js, SvelteKit).
 *
 * Frameworks: Express, Koa, Fastify, Hapi, NestJS, Next.js, SvelteKit,
 * Flask, FastAPI, Django, Rails, Sinatra, Laravel, Spring, ASP.NET,
 * Gin/Echo (Go), Fiber/Chi (Go), Actix, Axum.
 */
#include "cg.h"
#include <regex.h>

typedef struct {
    const char *framework;
    const char *langs;        /* comma list of spec names this applies to */
    const char *file_hint;    /* substring path must contain, or NULL */
    const char *pat;          /* ERE against original line */
    int g_method;             /* capture group for method, 0 = none */
    int g_pattern;            /* capture group for url pattern */
    int g_handler;            /* capture group for handler, 0 = none */
    const char *fixed_method; /* used when g_method == 0 */
    regex_t re;
} RoutePat;

static RoutePat RP[] = {
    { "express", "js", NULL,
      "(app|router|server)\\.(get|post|put|delete|patch|all|options|head)[ \t]*\\("
      "[ \t]*['\"`]([^'\"`]+)['\"`]([ \t]*,[ \t]*([A-Za-z_][A-Za-z0-9_.]*))?",
      2, 3, 5, NULL, {0} },
    { "koa-router", "js", NULL,
      "(koaRouter|kr)\\.(get|post|put|delete|patch)[ \t]*\\([ \t]*['\"`]([^'\"`]+)",
      2, 3, 0, NULL, {0} },
    { "fastify", "js", NULL,
      "fastify\\.(get|post|put|delete|patch)[ \t]*\\([ \t]*['\"`]([^'\"`]+)",
      1, 2, 0, NULL, {0} },
    { "hapi", "js", NULL,
      "path:[ \t]*['\"`](/[^'\"`]*)['\"`]",
      0, 1, 0, "*", {0} },
    { "nestjs", "js", NULL,
      "@(Get|Post|Put|Delete|Patch|Head|Options)\\([ \t]*['\"`]?([^'\"`)]*)",
      1, 2, 0, NULL, {0} },
    { "flask", "python", NULL,
      "@[A-Za-z_][A-Za-z0-9_]*\\.route\\([ \t]*['\"]([^'\"]+)",
      0, 1, 0, "*", {0} },
    { "fastapi", "python", NULL,
      "@[A-Za-z_][A-Za-z0-9_]*\\.(get|post|put|delete|patch)\\([ \t]*['\"]([^'\"]+)",
      1, 2, 0, NULL, {0} },
    { "django", "python", "urls",
      "(path|re_path|url)\\([ \t]*r?['\"]([^'\"]*)['\"][ \t]*,[ \t]*([A-Za-z_][A-Za-z0-9_.]*)?",
      0, 2, 3, "*", {0} },
    { "rails", "ruby", "routes",
      "^[ \t]*(get|post|put|patch|delete|resources|resource|root)[ \t]+['\":]([A-Za-z0-9_/:.()-]*)",
      1, 2, 0, NULL, {0} },
    { "sinatra", "ruby", NULL,
      "^[ \t]*(get|post|put|patch|delete)[ \t]+['\"]([^'\"]+)['\"][ \t]+do",
      1, 2, 0, NULL, {0} },
    { "laravel", "php", NULL,
      "Route::(get|post|put|patch|delete|any|resource|apiResource)\\([ \t]*['\"]([^'\"]+)",
      1, 2, 0, NULL, {0} },
    { "spring", "java", NULL,
      "@(Get|Post|Put|Delete|Patch|Request)Mapping[ \t]*\\([ \t]*(value[ \t]*=[ \t]*)?[{ \t]*\"([^\"]*)",
      1, 3, 0, NULL, {0} },
    { "aspnet-attr", "csharp", NULL,
      "\\[Http(Get|Post|Put|Delete|Patch)\\([ \t]*\"([^\"]*)",
      1, 2, 0, NULL, {0} },
    { "aspnet-minimal", "csharp", NULL,
      "\\.Map(Get|Post|Put|Delete|Patch)\\([ \t]*\"([^\"]*)\"[ \t]*,[ \t]*([A-Za-z_][A-Za-z0-9_.]*)?",
      1, 2, 3, NULL, {0} },
    { "gin/echo", "go", NULL,
      "[A-Za-z_][A-Za-z0-9_]*\\.(GET|POST|PUT|DELETE|PATCH|Any)\\([ \t]*\"([^\"]*)\"[ \t]*,[ \t]*([A-Za-z_][A-Za-z0-9_.]*)?",
      1, 2, 3, NULL, {0} },
    { "fiber/chi", "go", NULL,
      "[A-Za-z_][A-Za-z0-9_]*\\.(Get|Post|Put|Delete|Patch)\\([ \t]*\"([^\"]*)\"[ \t]*,[ \t]*([A-Za-z_][A-Za-z0-9_.]*)?",
      1, 2, 3, NULL, {0} },
    { "actix", "rust", NULL,
      "\\.route\\([ \t]*\"([^\"]*)\"[ \t]*,[ \t]*web::(get|post|put|delete|patch)",
      2, 1, 0, NULL, {0} },
    { "axum", "rust", NULL,
      "\\.route\\([ \t]*\"([^\"]*)\"[ \t]*,[ \t]*(get|post|put|delete|patch)[ \t]*\\([ \t]*([A-Za-z_][A-Za-z0-9_:]*)?",
      2, 1, 3, NULL, {0} },
    { "actix-macro", "rust", NULL,
      "#\\[(get|post|put|delete|patch)\\([ \t]*\"([^\"]*)",
      1, 2, 0, NULL, {0} },
};
#define NRP ((int)(sizeof RP / sizeof RP[0]))

void routes_global_init(void) {
    static bool done = false;
    if (done) return;
    done = true;
    for (int i = 0; i < NRP; i++) {
        int rc = regcomp(&RP[i].re, RP[i].pat, REG_EXTENDED);
        if (rc != 0) {
            char eb[256];
            regerror(rc, &RP[i].re, eb, sizeof eb);
            fprintf(stderr, "cg: internal route regex error (%s): %s\n",
                    RP[i].framework, eb);
            exit(2);
        }
    }
}

static bool lang_in(const char *langs, const char *lang) {
    const char *p = strstr(langs, lang);
    if (!p) return false;
    size_t n = strlen(lang);
    return (p == langs || p[-1] == ',') && (p[n] == 0 || p[n] == ',');
}

static void upcase(char *s) {
    for (; *s; s++) if (*s >= 'a' && *s <= 'z') *s -= 32;
}

void routes_scan_line(const char *lang, const char *path, int lineno,
                      const char *orig, ParseResult *pr) {
    for (int i = 0; i < NRP; i++) {
        RoutePat *r = &RP[i];
        if (!lang_in(r->langs, lang)) continue;
        if (r->file_hint && !strstr(path, r->file_hint)) continue;
        regmatch_t m[8];
        if (regexec(&r->re, orig, 8, m, 0) != 0) continue;

        char method[32] = "*", pattern[512] = "", handler[128] = "";
        if (r->g_method && m[r->g_method].rm_so >= 0) {
            size_t n = (size_t)(m[r->g_method].rm_eo - m[r->g_method].rm_so);
            if (n >= sizeof method) n = sizeof method - 1;
            memcpy(method, orig + m[r->g_method].rm_so, n);
            method[n] = 0;
            upcase(method);
        } else if (r->fixed_method) {
            snprintf(method, sizeof method, "%s", r->fixed_method);
        }
        if (m[r->g_pattern].rm_so >= 0) {
            size_t n = (size_t)(m[r->g_pattern].rm_eo - m[r->g_pattern].rm_so);
            if (n >= sizeof pattern) n = sizeof pattern - 1;
            memcpy(pattern, orig + m[r->g_pattern].rm_so, n);
            pattern[n] = 0;
        }
        if (r->g_handler && m[r->g_handler].rm_so >= 0 &&
            m[r->g_handler].rm_eo > m[r->g_handler].rm_so) {
            size_t n = (size_t)(m[r->g_handler].rm_eo - m[r->g_handler].rm_so);
            if (n >= sizeof handler) n = sizeof handler - 1;
            memcpy(handler, orig + m[r->g_handler].rm_so, n);
            handler[n] = 0;
        }
        route_add(pr, r->framework, method, pattern,
                  handler[0] ? handler : NULL, lineno);
        return;   /* first matching framework wins for a line */
    }
}

/* File-based routers: derive the URL from the file path itself. */
void routes_scan_file(const char *path, ParseResult *pr) {
    const char *p;
    if ((p = strstr(path, "pages/api/")) != NULL) {
        char url[512];
        snprintf(url, sizeof url, "/api/%s", p + strlen("pages/api/"));
        char *dot = strrchr(url, '.');
        if (dot) *dot = 0;
        size_t n = strlen(url);
        if (n > 6 && strcmp(url + n - 6, "/index") == 0) url[n - 6] = 0;
        route_add(pr, "nextjs", "*", url, NULL, 1);
    } else if ((p = strstr(path, "app/")) != NULL &&
               (strstr(path, "/route.ts") || strstr(path, "/route.js"))) {
        char url[512];
        snprintf(url, sizeof url, "/%s", p + 4);
        char *cut = strstr(url, "/route.");
        if (cut) *cut = 0;
        route_add(pr, "nextjs-app", "*", url[0] ? url : "/", NULL, 1);
    } else if ((p = strstr(path, "src/routes/")) != NULL &&
               strstr(path, "+server.")) {
        char url[512];
        snprintf(url, sizeof url, "/%s", p + strlen("src/routes/"));
        char *cut = strstr(url, "/+server.");
        if (cut) *cut = 0;
        route_add(pr, "sveltekit", "*", url[0] ? url : "/", NULL, 1);
    }
}
