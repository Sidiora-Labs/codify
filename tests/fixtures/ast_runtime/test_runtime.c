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
}

static const AstAdapter JSON = { "runtime_fixture", tree_sitter_json, extract };

static void *run_parse(void *unused) {
    (void)unused;
    static const char source[] = "{\n  \"item\": [1, 2, 3]\n}\n";
    ParseResult result = {0};
    assert(ast_try_parse("runtime_fixture", "sample.fixture", source,
                         sizeof source - 1, &result));
    parse_result_free(&result);
    return NULL;
}

int main(void) {
    assert(ast_register(&JSON));
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
    parse_result_free(&result);
    return 0;
}
