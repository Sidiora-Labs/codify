#include "ast.h"
#include "semantic.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

extern void ast_managed_register(void);

static void die(const char *lang, const char *what) {
    fprintf(stderr, "managed %s: %s\n", lang, what);
    exit(1);
}

static void check(const char *lang, const char *path) {
    size_t len = 0;
    char *src = read_entire_file(path, &len);
    if (!src) die(lang, "fixture unreadable");
    ParseResult r = {0};
    if (!ast_try_parse(lang, path, src, len, &r)) die(lang, "grammar unavailable");
    int box = -1, overloads = 0, calls = 0, false_calls = 0;
    const char *overload_keys[2] = {0};
    for (int i = 0; i < r.sem.nsymbols; i++) {
        SemSymbol *s = &r.sem.symbols[i];
        if (!strcmp(s->name, "Box")) {
            box = i;
            if (!s->generic_params || !*s->generic_params)
                die(lang, "missing generic parameters");
        }
    }
    if (box < 0) die(lang, "missing Box class");
    for (int i = 0; i < r.sem.nsymbols; i++) {
        SemSymbol *s = &r.sem.symbols[i];
        if (!strcasecmp(s->name, "get")) {
            overloads++;
            if (s->parent != box) die(lang, "method owner is not Box");
            if (!s->qualified_name || !strstr(s->qualified_name, "."))
                die(lang, "qualified method name missing");
            if (!s->scope_key || !strchr(s->scope_key, '('))
                die(lang, "overload identity missing");
            if (!s->result_type) die(lang, "result type missing");
            if (overloads <= 2) overload_keys[overloads - 1] = s->scope_key;
        }
    }
    if (overloads != 2) die(lang, "expected two method overloads");
    if (!strcmp(overload_keys[0], overload_keys[1]))
        die(lang, "overloads have identical identity");
    int hierarchy = 0, base = 0, contract = 0;
    for (int i = 0; i < r.sem.ntype_facts; i++) {
        SemTypeFact *f = &r.sem.type_facts[i];
        if (f->owner == box && (!strcmp(f->kind, "inherits") ||
                                !strcmp(f->kind, "implements"))) {
            hierarchy++;
            if (strstr(f->name, "Base")) base++;
            if (strstr(f->name, "Runnable")) contract++;
        }
    }
    if (hierarchy < 2 || !base || !contract)
        die(lang, "individual inheritance facts missing");
    for (int i = 0; i < r.sem.nreferences; i++) {
        SemReference *v = &r.sem.references[i];
        if (!strcasecmp(v->text, "get")) {
            calls++;
            if (v->owner < 0 || v->owner >= r.sem.nsymbols ||
                strcasecmp(r.sem.symbols[v->owner].name, "run"))
                die(lang, "call owner missing");
        }
        if (!strcmp(v->text, "ghostCall")) false_calls++;
    }
    if (!calls) die(lang, "call missing");
    if (false_calls) die(lang, "string/comment interpreted as call");
    if (r.sem.nbindings < 1 || !r.sem.bindings[0].module ||
        !r.sem.bindings[0].local_name)
        die(lang, "import binding missing");
    if (!strcmp(lang, "kotlin") && strcmp(r.sem.bindings[0].local_name, "JList"))
        die(lang, "Kotlin alias missing");
    if (!strcmp(lang, "dart") && strcmp(r.sem.bindings[0].local_name, "math"))
        die(lang, "Dart alias missing");
    parse_result_free(&r);

    char *damaged = xmalloc(len + 16);
    memcpy(damaged, src, len);
    memcpy(damaged + len, ") ) )\n", 7);
    ParseResult partial = {0};
    if (!ast_try_parse(lang, path, damaged, len + 6, &partial))
        die(lang, "recovery parse unavailable");
    int recovered = 0;
    for (int i = 0; i < partial.sem.nsymbols; i++)
        if (!strcmp(partial.sem.symbols[i].name, "Box")) recovered++;
    if (recovered != 1) die(lang, "bounded recovery lost valid class");
    parse_result_free(&partial);
    free(damaged);
    free(src);
}

static void check_namespace(const char *lang, const char *source) {
    ParseResult r = {0};
    if (!ast_try_parse(lang, "namespace.fixture", source, strlen(source), &r))
        die(lang, "namespace parse unavailable");
    int found = 0;
    for (int i = 0; i < r.sem.nsymbols; i++) {
        SemSymbol *s = &r.sem.symbols[i];
        if (strcmp(s->name, "Named")) continue;
        if (s->parent < 0 || !s->qualified_name ||
            strcmp(s->qualified_name, "acme.demo.Named"))
            die(lang, "package owner or qualified name missing");
        found++;
    }
    if (found != 1) die(lang, "namespaced class missing");
    parse_result_free(&r);
}

int main(int argc, char **argv) {
    if (argc != 2) return 2;
    lang_global_init();
    routes_global_init();
    ast_managed_register();
    const char *names[] = {"java", "kotlin", "scala", "csharp", "swift", "dart"};
    const char *exts[] = {"java", "kt", "scala", "cs", "swift", "dart"};
    for (int i = 0; i < 6; i++) {
        char path[1024];
        snprintf(path, sizeof path, "%s/Box.%s", argv[1], exts[i]);
        check(names[i], path);
    }
    check_namespace("java", "package acme.demo; class Named {}\n");
    check_namespace("kotlin", "package acme.demo\nclass Named {}\n");
    check_namespace("scala", "package acme.demo\nclass Named {}\n");
    check_namespace("csharp", "namespace acme.demo; class Named {}\n");
    puts("managed grammars: declarations, ownership, overloads, hierarchy, calls and negatives passed");
    return 0;
}
