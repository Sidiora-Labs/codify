/* unit tests for src/routes.c — route extraction precision */
#include "cg.h"
#include "tap.h"

static char *slurp(const char *path, size_t *len) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    rewind(f);
    char *buf = malloc((size_t)n + 1);
    *len = fread(buf, 1, (size_t)n, f);
    buf[*len] = 0;
    fclose(f);
    return buf;
}

static bool parse_fixture(const char *lang, const char *name, ParseResult *pr) {
    char path[256];
    snprintf(path, sizeof path, "tests/fixtures/routes/%s", name);
    size_t len = 0;
    char *src = slurp(path, &len);
    if (!src) return false;
    lang_parse(lang, path, src, len, pr);
    free(src);
    return true;
}

static const RouteDef *route(const ParseResult *pr, const char *method,
                             const char *pattern) {
    for (int i = 0; i < pr->nroutes; i++)
        if (strcmp(pr->routes[i].method, method) == 0 &&
            strcmp(pr->routes[i].pattern, pattern) == 0)
            return &pr->routes[i];
    return NULL;
}

static void dump(const ParseResult *pr) {
    for (int i = 0; i < pr->nroutes; i++)
        printf("  # unexpected %s %s line %d [%s]\n", pr->routes[i].method,
               pr->routes[i].pattern, pr->routes[i].line,
               pr->routes[i].framework);
}

int main(void) {
    lang_global_init();
    ParseResult pr;

    ok(parse_fixture("python", "false_positives.py", &pr), "python fixture readable");
    ok(pr.nroutes == 0, "dict.get(key, default) is not a FastAPI route");
    if (pr.nroutes) dump(&pr);
    parse_result_free(&pr);

    ok(parse_fixture("javascript", "false_positives.mjs", &pr), "mjs fixture readable");
    ok(pr.nroutes == 0, "*_path keys and shell strings are not hapi routes");
    if (pr.nroutes) dump(&pr);
    parse_result_free(&pr);

    ok(parse_fixture("python", "true_positives.py", &pr), "python routes readable");
    const RouteDef *r = route(&pr, "GET", "/items");
    ok(r && r->handler && strcmp(r->handler, "list_items") == 0, "app.get call form");
    ok(route(&pr, "POST", "/orders") != NULL, "router.post call form");
    ok(route(&pr, "DELETE", "/users/{id}") != NULL, "*_router receiver");
    ok(route(&pr, "PUT", "/") != NULL, "api receiver with root path");
    ok(route(&pr, "GET", "/health") != NULL, "decorated app.get");
    ok(route(&pr, "PATCH", "/orders/{id}") != NULL, "decorated router.patch");
    ok(pr.nroutes == 6, "exactly the six python routes (got %d)", pr.nroutes);
    parse_result_free(&pr);

    ok(parse_fixture("javascript", "true_positives.js", &pr), "js routes readable");
    ok(route(&pr, "*", "/hapi/items") != NULL, "hapi path key");
    ok(route(&pr, "PAGE", "/vue/account") != NULL, "vue-router path key");
    ok(route(&pr, "PAGE", "/react/home") != NULL, "react-router path key");
    parse_result_free(&pr);

    return t_done("routes");
}
