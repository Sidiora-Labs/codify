#include "ast.h"
#include <assert.h>
#include <pthread.h>
#include <string.h>

extern const TSLanguage *tree_sitter_json(void);

static bool visit(AstContext *ctx, TSNode node, void *user) {
    int *count = user;
    if (strcmp(ts_node_type(node), "pair") == 0) {
        TSNode key = ast_field(node, "key");
        char *name = ast_text(ctx, key);
        assert(name && strcmp(name, "\"item\"") == 0);
        assert(ast_line(key) == 2 && ast_column(key) == 2);
        free(name);
        ++*count;
    }
    return true;
}

static void extract(AstContext *ctx) {
    assert(ctx->parser && ctx->tree);
    assert(strcmp(ts_node_type(ctx->root), "document") == 0);
    int pairs = 0;
    ast_walk(ctx, ctx->root, visit, &pairs);
    assert(pairs == 1);
    assert(!ctx->truncated && !ctx->cancelled);
    SemSpan span = { .line = 2, .column = 2, .end_line = 2,
                     .end_column = 8, .start_byte = 4, .end_byte = 10 };
    SemSymbol *symbol = sem_symbol_add(&ctx->result->sem, "item", "property", span);
    assert(symbol);
    SemReference *reference = sem_reference_add(&ctx->result->sem, "item", "call", span);
    assert(reference);
}

static const AstAdapter JSON = { "runtime_fixture", tree_sitter_json, extract };
static void extract_recovery(AstContext *ctx) {
    assert(ctx->tree && ts_node_has_error(ctx->root));
}
static const AstAdapter RECOVERY = {
    "runtime_recovery", tree_sitter_json, extract_recovery
};
static void extract_file_only(AstContext *ctx) {
    assert(!ctx->tree && ts_node_is_null(ctx->root));
    ctx->result->sem.parser_id = xstrdup("file-only:fixture");
}
static const AstAdapter FILE_ONLY = {
    "runtime_file_only", NULL, extract_file_only
};

static void *run_parse(void *unused) {
    (void)unused;
    static const char source[] = "{\n  \"item\": [1, 2, 3]\n}\n";
    ParseResult result = {0};
    assert(ast_try_parse("runtime_fixture", "sample.fixture", source,
                         sizeof source - 1, &result));
    assert(result.ndefs == 1 && result.nrefs == 1);
    assert(result.sem.symbols[0].legacy_def == 0);
    assert(result.sem.references[0].legacy_ref == 0);
    assert(result.nlines == 3 && result.first_code_line == 1);
    assert(strcmp(result.sem.parser_id, "tree-sitter:runtime_fixture") == 0);
    parse_result_free(&result);
    return NULL;
}

int main(void) {
    assert(ast_register(&JSON));
    assert(ast_register(&RECOVERY));
    assert(ast_register(&FILE_ONLY));
    assert(!ast_register(&JSON));
    assert(!ast_adapter("absent"));
    assert(ast_adapter("runtime_fixture") == &JSON);
    pthread_t threads[4];
    for (int i = 0; i < 4; i++) assert(pthread_create(&threads[i], NULL,
                                                        run_parse, NULL) == 0);
    for (int i = 0; i < 4; i++) assert(pthread_join(threads[i], NULL) == 0);
    size_t cancelled = 1;
    ParseResult result = {0};
    assert(!ast_try_parse_ex("runtime_fixture", "sample.fixture", "{}", 2,
                              &result, &cancelled));
    assert(!ast_try_parse("absent", "sample.fixture", "{}", 2, &result));
    parse_result_free(&result);
    assert(ast_try_parse("runtime_recovery", "broken.fixture", "{", 1, &result));
    assert(result.partial && strcmp(result.diagnostic, "syntax_recovery") == 0);
    assert(strcmp(result.parser, "tree-sitter:runtime_recovery") == 0);
    parse_result_free(&result);
    assert(ast_try_parse("runtime_file_only", "plain.fixture", "{}", 2, &result));
    assert(strcmp(result.parser, "file-only:fixture") == 0);
    parse_result_free(&result);
    /* A long source line must still be parsed by the labelled fallback. */
    char large[8192];
    memset(large, ' ', sizeof large);
    memcpy(large, "function wide() {", 17);
    large[sizeof large - 3] = '}';
    large[sizeof large - 2] = '\n';
    large[sizeof large - 1] = 0;
    lang_global_init();
    lang_parse("javascript", "wide.js", large, sizeof large - 1, &result);
    assert(result.ndefs >= 1);
    assert(strcmp(result.parser, "heuristic") == 0 && !result.partial);
    parse_result_free(&result);
    return 0;
}
