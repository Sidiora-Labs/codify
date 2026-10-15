#ifndef CG_AST_H
#define CG_AST_H

#include "cg.h"
#include "tree_sitter/api.h"

/* A parse owns its parser and tree only during extract(). The source buffer
 * belongs to the caller and remains valid through the callback. Adapters
 * append owned records to result (and result->sem when available). */
typedef struct AstContext {
    const char *language, *path, *source;
    size_t length;
    ParseResult *result;
    TSParser *parser;
    TSTree *tree;
    TSNode root;
    const size_t *cancel_flag;
    unsigned visited, errors, missing;
    bool cancelled, truncated;
} AstContext;

typedef struct AstAdapter {
    const char *language;                 /* lang_for_path() name */
    const TSLanguage *(*grammar)(void);   /* pinned generated grammar */
    void (*extract)(AstContext *ctx);     /* syntax-derived facts */
} AstAdapter;

/* Each family owns one ast_<family>_register() in src/ast_<family>.c and
 * calls ast_register() once per language. Runtime uses weak family hooks so
 * an absent family does not prevent an independent worker build. */
bool ast_register(const AstAdapter *adapter);
const AstAdapter *ast_adapter(const char *language);
void ast_register_all(void);
bool ast_try_parse(const char *language, const char *path, const char *source,
                   size_t length, ParseResult *result);
bool ast_try_parse_ex(const char *language, const char *path,
                      const char *source, size_t length, ParseResult *result,
                      const size_t *cancel_flag);

/* Walker visits named nodes in source order, including root. Return false
 * from callback to prune descendants. Node and text helpers are bounded by
 * the original source buffer; ast_text returns an owned string. */
typedef bool (*AstVisitFn)(AstContext *ctx, TSNode node, void *user);
void ast_walk(AstContext *ctx, TSNode root, AstVisitFn visit, void *user);
TSNode ast_field(TSNode node, const char *field);
char *ast_text(const AstContext *ctx, TSNode node);
char *ast_slice(const AstContext *ctx, uint32_t start, uint32_t end);
int ast_line(TSNode node);               /* one-based */
int ast_column(TSNode node);             /* zero-based byte column */

#endif
