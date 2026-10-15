#include "ast.h"
#include <limits.h>
#include <pthread.h>
#include <strings.h>

#define AST_MAX_ADAPTERS 96
#define AST_MAX_SOURCE (32u * 1024u * 1024u)
#define AST_MAX_NODES 500000u
#define AST_MAX_DEPTH 512u
#define AST_TIMEOUT_US 2000000u

static const AstAdapter *adapters[AST_MAX_ADAPTERS];
static unsigned nadapters;
static pthread_once_t registry_once = PTHREAD_ONCE_INIT;

extern void ast_web_register(void) __attribute__((weak));
extern void ast_systems_register(void) __attribute__((weak));
extern void ast_dynamic_register(void) __attribute__((weak));
extern void ast_managed_register(void) __attribute__((weak));
extern void ast_extended_register(void) __attribute__((weak));
extern void ast_mixed_register(void) __attribute__((weak));

static void register_families(void) {
    if (ast_web_register) ast_web_register();
    if (ast_systems_register) ast_systems_register();
    if (ast_dynamic_register) ast_dynamic_register();
    if (ast_managed_register) ast_managed_register();
    if (ast_extended_register) ast_extended_register();
    if (ast_mixed_register) ast_mixed_register();
}

bool ast_register(const AstAdapter *adapter) {
    if (!adapter || !adapter->language || !adapter->extract ||
        nadapters >= AST_MAX_ADAPTERS) return false;
    for (unsigned i = 0; i < nadapters; i++)
        if (strcmp(adapters[i]->language, adapter->language) == 0)
            return false;
    adapters[nadapters++] = adapter;
    return true;
}

void ast_register_all(void) { pthread_once(&registry_once, register_families); }

const AstAdapter *ast_adapter(const char *language) {
    if (!language) return NULL;
    ast_register_all();
    for (unsigned i = 0; i < nadapters; i++)
        if (strcmp(adapters[i]->language, language) == 0) return adapters[i];
    return NULL;
}

TSNode ast_field(TSNode node, const char *field) {
    return field ? ts_node_child_by_field_name(node, field,
                                               (uint32_t)strlen(field))
                 : (TSNode){0};
}

char *ast_slice(const AstContext *ctx, uint32_t start, uint32_t end) {
    if (!ctx || !ctx->source || start > end || end > ctx->length) return NULL;
    size_t n = (size_t)end - start;
    char *s = xmalloc(n + 1);
    memcpy(s, ctx->source + start, n);
    s[n] = 0;
    return s;
}

char *ast_text(const AstContext *ctx, TSNode node) {
    return ts_node_is_null(node) ? NULL :
           ast_slice(ctx, ts_node_start_byte(node), ts_node_end_byte(node));
}

int ast_line(TSNode node) { return (int)ts_node_start_point(node).row + 1; }
int ast_column(TSNode node) { return (int)ts_node_start_point(node).column; }

/* Iterative depth-first traversal bounds both stack use and malformed-tree
 * work. Children are visited in source order. */
void ast_walk(AstContext *ctx, TSNode root, AstVisitFn visit, void *user) {
    if (!ctx || !visit || ts_node_is_null(root)) return;
    typedef struct { TSNode node; uint32_t next; bool entered; } Frame;
    Frame stack[AST_MAX_DEPTH];
    unsigned depth = 1;
    stack[0] = (Frame){ .node = root };
    while (depth) {
        if (ctx->cancel_flag && *ctx->cancel_flag) {
            ctx->cancelled = true;
            return;
        }
        Frame *f = &stack[depth - 1];
        if (!f->entered) {
            f->entered = true;
            if (++ctx->visited > AST_MAX_NODES) { ctx->truncated = true; return; }
            if (ts_node_is_error(f->node)) ctx->errors++;
            if (ts_node_is_missing(f->node)) ctx->missing++;
            if (ts_node_is_named(f->node) && !visit(ctx, f->node, user)) {
                depth--;
                continue;
            }
        }
        uint32_t count = ts_node_child_count(f->node);
        if (f->next == count) { depth--; continue; }
        TSNode child = ts_node_child(f->node, f->next++);
        if (depth == AST_MAX_DEPTH) { ctx->truncated = true; return; }
        stack[depth++] = (Frame){ .node = child };
    }
}

bool ast_try_parse_ex(const char *language, const char *path,
                      const char *source, size_t length, ParseResult *result,
                      const size_t *cancel_flag) {
    if (!source || !result || length > AST_MAX_SOURCE || length > UINT32_MAX)
        return false;
    const AstAdapter *adapter = NULL;
    const char *ext = path ? path_ext(path) : NULL;
    if (ext && strcasecmp(ext, ".tsx") == 0) adapter = ast_adapter("tsx");
    if (!adapter) adapter = ast_adapter(language);
    if (!adapter) return false;
    AstContext ctx = { .language = language, .path = path, .source = source,
                       .length = length, .result = result,
                       .cancel_flag = cancel_flag };
    if (cancel_flag && *cancel_flag) return false;
    if (adapter->grammar) {
        const TSLanguage *grammar = adapter->grammar();
        if (!grammar) return false;
        ctx.parser = ts_parser_new();
        if (!ctx.parser) return false;
        if (!ts_parser_set_language(ctx.parser, grammar)) {
            ts_parser_delete(ctx.parser);
            return false;
        }
        ts_parser_set_timeout_micros(ctx.parser, AST_TIMEOUT_US);
        if (cancel_flag) ts_parser_set_cancellation_flag(ctx.parser, cancel_flag);
        ctx.tree = ts_parser_parse_string(ctx.parser, NULL, source,
                                          (uint32_t)length);
        if (!ctx.tree) { ts_parser_delete(ctx.parser); return false; }
        ctx.root = ts_tree_root_node(ctx.tree);
    }
    adapter->extract(&ctx);
    if (ctx.tree) ts_tree_delete(ctx.tree);
    if (ctx.parser) ts_parser_delete(ctx.parser);
    return true;
}

bool ast_try_parse(const char *language, const char *path, const char *source,
                   size_t length, ParseResult *result) {
    return ast_try_parse_ex(language, path, source, length, result, NULL);
}
