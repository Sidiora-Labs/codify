/* unit tests for src/lang.c — language-aware definitions and references */
#include "cg.h"
#include "tap.h"

static const SymDef *definition(const ParseResult *result, const char *name) {
    for (int i = 0; i < result->ndefs; i++)
        if (strcmp(result->defs[i].name, name) == 0)
            return &result->defs[i];
    return NULL;
}

static bool reference(const ParseResult *result, const char *name) {
    for (int i = 0; i < result->nrefs; i++)
        if (strcmp(result->refs[i].name, name) == 0)
            return true;
    return false;
}

int main(void) {
    lang_global_init();

    const char rust[] =
        "pub mod delete;\n"
        "pub fn new() {}\n"
        "fn call() { delete(); new(); if (true) {} }\n";
    ParseResult parsed;
    lang_parse("rust", "src/lib.rs", rust, sizeof rust - 1, &parsed);

    const SymDef *delete_module = definition(&parsed, "delete");
    ok(delete_module != NULL, "Rust permits a module named delete");
    ok(delete_module && strcmp(delete_module->kind, "module") == 0,
       "delete retains its module kind");
    ok(definition(&parsed, "new") != NULL, "Rust permits a function named new");
    ok(reference(&parsed, "delete"), "Rust delete call is a reference");
    ok(reference(&parsed, "new"), "Rust new call is a reference");
    ok(!reference(&parsed, "if"), "Rust control-flow keyword is not a reference");

    parse_result_free(&parsed);
    return t_done("lang");
}
