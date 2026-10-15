#include "ast.h"
#include "index_health.h"
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

static void project_semantic(ParseResult *result) {
    SemResult *sem = &result->sem;
    for (int i = 0; i < sem->nsymbols; i++) {
        SemSymbol *s = &sem->symbols[i];
        if (s->legacy_def >= 0 && s->legacy_def < result->ndefs) continue;
        if (!s->name || !s->kind) continue;
        if (result->ndefs == result->cdefs) {
            result->cdefs = result->cdefs ? result->cdefs * 2 : 64;
            result->defs = xrealloc(result->defs, sizeof(SymDef) *
                                                  (size_t)result->cdefs);
        }
        int index = result->ndefs++;
        SymDef *d = &result->defs[index];
        d->name = xstrdup(s->name);
        d->kind = s->kind; /* owned by result->sem until parse_result_free */
        d->line = s->span.line;
        d->end_line = s->span.end_line;
        d->sig = xstrdup(s->signature ? s->signature : s->name);
        d->decl = s->declaration;
        s->legacy_def = index;
    }
    for (int i = 0; i < sem->nreferences; i++) {
        SemReference *s = &sem->references[i];
        if (s->legacy_ref >= 0 && s->legacy_ref < result->nrefs) continue;
        /* Existing reference resolution models calls. Other reference kinds
         * remain in rich semantic storage and are never mislabeled as calls. */
        if (!s->text || !s->kind ||
            (strcmp(s->kind, "call") != 0 && strcmp(s->kind, "c") != 0))
            continue;
        if (result->nrefs == result->crefs) {
            result->crefs = result->crefs ? result->crefs * 2 : 128;
            result->refs = xrealloc(result->refs, sizeof(SymRef) *
                                                  (size_t)result->crefs);
        }
        int index = result->nrefs++;
        SymRef *r = &result->refs[index];
        r->name = xstrdup(s->text);
        r->line = s->span.line;
        r->ref_kind = 'c';
        r->argc = s->argc;
        snprintf(r->qual, sizeof r->qual, "%s", s->qualifier ? s->qualifier : "");
        s->legacy_ref = index;
    }
    for (int i = 0; i < sem->nbindings; i++) {
        SemBinding *b = &sem->bindings[i];
        if (b->is_export || !b->module) continue;
        if (result->nimports == result->cimports) {
            result->cimports = result->cimports ? result->cimports * 2 : 8;
            result->imports = xrealloc(result->imports, sizeof(ImportDef) *
                                                       (size_t)result->cimports);
        }
        ImportDef *im = &result->imports[result->nimports++];
        /* The existing import index stores namespace/whole-module bindings
         * as *, while the semantic binding keeps the local alias. */
        im->name = xstrdup(b->kind &&
                           (strcmp(b->kind, "namespace") == 0 ||
                            strcmp(b->kind, "require") == 0 ||
                            strcmp(b->kind, "module_import") == 0)
                           ? "*" : (b->local_name ? b->local_name : "*"));
        im->module = xstrdup(b->module);
        im->line = b->span.line;
        im->system = b->is_system;
    }
}

static bool collect_comment(AstContext *ctx, TSNode node, void *unused) {
    (void)unused;
    if ((ts_node_is_error(node) || ts_node_is_missing(node)) &&
        !strstr(ctx->result->diagnostics, "syntax_recovery"))
        parse_diagnostic_add(ctx->result, "syntax_recovery", ast_line(node));
    const char *type = ts_node_type(node);
    if (strcmp(type, "comment") != 0 && !strstr(type, "comment")) {
        if (!ts_node_eq(node, ctx->root)) {
            int line = ast_line(node);
            int end = (int)ts_node_end_point(node).row + 1;
            bool documentation = false;
            for (int i = 0; i < ctx->result->ncmts; i++) {
                CmtDef *c = &ctx->result->cmts[i];
                if (c->below && line >= c->line && end <= c->end_line) {
                    documentation = true;
                    break;
                }
            }
            if (!documentation && (!ctx->result->first_code_line ||
                                   line < ctx->result->first_code_line))
                ctx->result->first_code_line = line;
        }
        return true;
    }
    uint32_t start = ts_node_start_byte(node);
    uint32_t end = ts_node_end_byte(node);
    if (end <= start || end - start > 4000 || end > ctx->length) return false;
    ParseResult *pr = ctx->result;
    int line = ast_line(node), end_line = (int)ts_node_end_point(node).row + 1;
    bool pure = true;
    for (size_t at = start; at > 0 && ctx->source[at - 1] != '\n'; at--)
        if (ctx->source[at - 1] != ' ' && ctx->source[at - 1] != '\t' &&
            ctx->source[at - 1] != '\r') { pure = false; break; }
    char *body = ast_slice(ctx, start, end);
    if (pure && pr->ncmts) {
        CmtDef *prior = &pr->cmts[pr->ncmts - 1];
        size_t a = strlen(prior->body), b = strlen(body);
        if (prior->pure && !prior->below && prior->end_line + 1 == line &&
            a + b + 1 <= 4000) {
            prior->body = xrealloc(prior->body, a + b + 2);
            prior->body[a] = '\n';
            memcpy(prior->body + a + 1, body, b + 1);
            prior->end_line = end_line;
            free(body);
            return false;
        }
    }
    if (pr->ncmts == pr->ccmts) {
        pr->ccmts = pr->ccmts ? pr->ccmts * 2 : 16;
        pr->cmts = xrealloc(pr->cmts, sizeof(CmtDef) * (size_t)pr->ccmts);
    }
    CmtDef *c = &pr->cmts[pr->ncmts++];
    c->body = body;
    c->line = line;
    c->end_line = end_line;
    c->below = false;
    c->pure = pure;
    return false;
}

static void scan_routes(AstContext *ctx) {
    routes_scan_file(ctx->path, ctx->result);
    size_t pos = 0;
    int line = 1;
    while (pos < ctx->length) {
        const char *start = ctx->source + pos;
        const char *end = memchr(start, '\n', ctx->length - pos);
        size_t n = end ? (size_t)(end - start) : ctx->length - pos;
        char *slice = xmalloc(n + 1);
        memcpy(slice, start, n);
        slice[n] = 0;
        routes_scan_line(ctx->language, ctx->path, line, slice, ctx->result);
        free(slice);
        pos += n + (end != NULL);
        line++;
    }
    ctx->result->nlines = line - 1;
}

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

/* Cursor movement is constant-time between siblings. Indexed ts_node_child
 * lookup rescans preceding siblings and is quadratic on wide source files. */
void ast_walk(AstContext *ctx, TSNode root, AstVisitFn visit, void *user) {
    if (!ctx || !visit || ts_node_is_null(root)) return;
    TSTreeCursor cursor = ts_tree_cursor_new(root);
    unsigned depth = 0;
    for (;;) {
        if (ctx->cancel_flag && *ctx->cancel_flag) {
            ctx->cancelled = true;
            break;
        }
        TSNode node = ts_tree_cursor_current_node(&cursor);
        if (++ctx->visited > AST_MAX_NODES) {
            ctx->truncated = true;
            break;
        }
        if (ts_node_is_error(node)) ctx->errors++;
        if (ts_node_is_missing(node)) ctx->missing++;
        bool descend = !ts_node_is_named(node) || visit(ctx, node, user);
        if (descend) {
            if (depth == AST_MAX_DEPTH - 1 && ts_node_child_count(node)) {
                ctx->truncated = true;
                break;
            }
            if (depth < AST_MAX_DEPTH - 1 &&
                ts_tree_cursor_goto_first_child(&cursor)) {
                depth++;
                continue;
            }
        }
        while (depth > 0 && !ts_tree_cursor_goto_next_sibling(&cursor)) {
            ts_tree_cursor_goto_parent(&cursor);
            depth--;
        }
        if (depth == 0) break;
    }
    ts_tree_cursor_delete(&cursor);
}

bool ast_try_parse_ex(const char *language, const char *path,
                      const char *source, size_t length, ParseResult *result,
                      const size_t *cancel_flag) {
    if (!source || !result) return false;
    if (length > AST_MAX_SOURCE || length > UINT32_MAX) {
        parse_diagnostic_add(result, "ast_source_limit", 0);
        return false;
    }
    const AstAdapter *adapter = NULL;
    const char *ext = path ? path_ext(path) : NULL;
    if (ext && strcasecmp(ext, ".tsx") == 0) adapter = ast_adapter("tsx");
    if (!adapter) adapter = ast_adapter(language);
    if (!adapter) return false;
    AstContext ctx = { .language = language, .path = path, .source = source,
                       .length = length, .result = result,
                       .cancel_flag = cancel_flag };
    if (cancel_flag && *cancel_flag) {
        parse_diagnostic_add(result, "ast_cancelled", 0);
        return false;
    }
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
        if (!ctx.tree) {
            ts_parser_delete(ctx.parser);
            parse_diagnostic_add(result, cancel_flag && *cancel_flag ?
                                 "ast_cancelled" : "ast_timeout", 0);
            return false;
        }
        ctx.root = ts_tree_root_node(ctx.tree);
    }
    adapter->extract(&ctx);
    if (ctx.tree) {
        AstContext comments = ctx;
        comments.visited = 0;
        ast_walk(&comments, ctx.root, collect_comment, NULL);
        ctx.truncated |= comments.truncated;
        ctx.cancelled |= comments.cancelled;
    }
    if (ctx.tree && (ctx.errors || ctx.missing || ts_node_has_error(ctx.root)) &&
        !strstr(result->diagnostics, "syntax_recovery"))
        parse_diagnostic_add(result, "syntax_recovery", ast_line(ctx.root));
    if (ctx.truncated)
        parse_diagnostic_add(result, "ast_node_limit", 0);
    if (ctx.cancelled)
        parse_diagnostic_add(result, "ast_cancelled", 0);
    if (!result->sem.parser_id) {
        const char *prefix = adapter->grammar ? "tree-sitter:" : "adapter:";
        size_t n = strlen(prefix) + strlen(adapter->language) + 1;
        result->sem.parser_id = xmalloc(n);
        snprintf(result->sem.parser_id, n, "%s%s", prefix, adapter->language);
    }
    snprintf(result->parser, sizeof result->parser, "%s", result->sem.parser_id);
    project_semantic(result);
    scan_routes(&ctx);
    if (ctx.tree) ts_tree_delete(ctx.tree);
    if (ctx.parser) ts_parser_delete(ctx.parser);
    return true;
}

bool ast_try_parse(const char *language, const char *path, const char *source,
                   size_t length, ParseResult *result) {
    return ast_try_parse_ex(language, path, source, length, result, NULL);
}
