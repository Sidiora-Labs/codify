#include "ast.h"
#include "semantic.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

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
        }
    }
    if (overloads != 2) die(lang, "expected two method overloads");
    int hierarchy = 0;
    for (int i = 0; i < r.sem.ntype_facts; i++) {
        SemTypeFact *f = &r.sem.type_facts[i];
        if (f->owner == box && (!strcmp(f->kind, "inherits") ||
                                !strcmp(f->kind, "implements"))) hierarchy++;
    }
    if (!hierarchy) die(lang, "inheritance facts missing");
    for (int i = 0; i < r.sem.nreferences; i++) {
        SemReference *v = &r.sem.references[i];
        if (!strcasecmp(v->text, "get")) calls++;
        if (!strcmp(v->text, "ghostCall")) false_calls++;
    }
    if (!calls) die(lang, "call missing");
    if (false_calls) die(lang, "string/comment interpreted as call");
    parse_result_free(&r);
    free(src);
}

int main(int argc, char **argv) {
    if (argc != 2) return 2;
    const char *names[] = {"java", "kotlin", "scala", "csharp", "swift", "dart"};
    const char *exts[] = {"java", "kt", "scala", "cs", "swift", "dart"};
    for (int i = 0; i < 6; i++) {
        char path[1024];
        snprintf(path, sizeof path, "%s/Box.%s", argv[1], exts[i]);
        check(names[i], path);
    }
    puts("managed grammars: declarations, ownership, overloads, hierarchy, calls and negatives passed");
    return 0;
}
