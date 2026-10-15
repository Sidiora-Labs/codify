#include "ast.h"
#include "semantic.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* The six grammars below are statically linked; only named syntax nodes are
 * considered. This avoids interpreting identifiers in strings and comments. */
extern const TSLanguage *tree_sitter_java(void);
extern const TSLanguage *tree_sitter_kotlin(void);
extern const TSLanguage *tree_sitter_scala(void);
extern const TSLanguage *tree_sitter_c_sharp(void);
extern const TSLanguage *tree_sitter_swift(void);
extern const TSLanguage *tree_sitter_dart(void);

typedef struct { AstContext *ctx; } Managed;

static bool is_type(const char *t, const char *s) { return t && !strcmp(t, s); }
static bool has(const char *t, const char *s) { return strstr(t, s) != NULL; }

static SemSpan span(TSNode n) {
    TSPoint a = ts_node_start_point(n), b = ts_node_end_point(n);
    return (SemSpan){.line = (int)a.row + 1, .column = (int)a.column,
        .end_line = (int)b.row + 1, .end_column = (int)b.column,
        .start_byte = ts_node_start_byte(n), .end_byte = ts_node_end_byte(n)};
}

static TSNode direct_type(TSNode n, const char *type) {
    uint32_t count = ts_node_named_child_count(n);
    for (uint32_t i = 0; i < count; i++) {
        TSNode c = ts_node_named_child(n, i);
        if (is_type(ts_node_type(c), type)) return c;
    }
    return (TSNode){0};
}

static TSNode field_or_type(TSNode n, const char *field, const char *type) {
    TSNode c = ast_field(n, field);
    return ts_node_is_null(c) && type ? direct_type(n, type) : c;
}

static char *node_text(AstContext *c, TSNode n) {
    return ts_node_is_null(n) ? NULL : ast_text(c, n);
}

static char *limited_text(AstContext *c, TSNode n, TSNode body) {
    uint32_t a = ts_node_start_byte(n), b = ts_node_end_byte(n);
    if (!ts_node_is_null(body) && ts_node_start_byte(body) > a)
        b = ts_node_start_byte(body);
    if (b > a + 400) b = a + 400;
    char *s = ast_slice(c, a, b);
    if (!s) return NULL;
    size_t len = strlen(s);
    while (len && isspace((unsigned char)s[len - 1])) s[--len] = 0;
    return s;
}

static const char *decl_kind(const char *lang, const char *t) {
    if (is_type(t, "namespace_declaration") ||
        is_type(t, "file_scoped_namespace_declaration") ||
        is_type(t, "package_declaration") || is_type(t, "package_clause") ||
        is_type(t, "package_header")) return "namespace";
    if (is_type(t, "class_declaration") || is_type(t, "class_definition") ||
        is_type(t, "record_declaration") || is_type(t, "extension_type_declaration")) return "class";
    if (is_type(t, "interface_declaration")) return "interface";
    if (is_type(t, "trait_definition")) return "trait";
    if (is_type(t, "protocol_declaration")) return "protocol";
    if (is_type(t, "object_declaration") || is_type(t, "object_definition") ||
        is_type(t, "companion_object")) return "object";
    if (is_type(t, "enum_declaration") || is_type(t, "enum_definition")) return "enum";
    if (is_type(t, "extension_declaration") || is_type(t, "extension_definition")) return "extension";
    if (is_type(t, "method_declaration") || is_type(t, "protocol_function_declaration") ||
        is_type(t, "method_signature")) return "method";
    if (is_type(t, "function_declaration") || is_type(t, "function_definition") ||
        is_type(t, "local_function_statement") || is_type(t, "local_function_declaration")) return "function";
    if (is_type(t, "constructor_declaration") || is_type(t, "compact_constructor_declaration") ||
        is_type(t, "secondary_constructor") || is_type(t, "constructor_signature")) return "constructor";
    if (is_type(t, "function_signature") && is_type(lang, "dart")) return "function";
    return NULL;
}

static bool callable(const char *kind) {
    return !strcmp(kind, "method") || !strcmp(kind, "function") ||
           !strcmp(kind, "constructor");
}

static TSNode body_node(TSNode n) {
    TSNode b = ast_field(n, "body");
    if (!ts_node_is_null(b)) return b;
    const char *names[] = {"class_body", "function_body", "block", "enum_body",
                           "interface_body", "protocol_body", "extension_body",
                           "template_body", "declaration_list"};
    for (size_t i = 0; i < sizeof(names)/sizeof(names[0]); i++) {
        b = direct_type(n, names[i]);
        if (!ts_node_is_null(b)) return b;
    }
    return (TSNode){0};
}

static TSNode name_node(TSNode n) {
    TSNode x = ast_field(n, "name");
    if (!ts_node_is_null(x)) return x;
    uint32_t count = ts_node_named_child_count(n);
    for (uint32_t i = 0; i < count; i++) {
        TSNode c = ts_node_named_child(n, i);
        const char *t = ts_node_type(c);
        if (is_type(t, "identifier") || is_type(t, "simple_identifier") ||
            is_type(t, "type_identifier") || is_type(t, "name") ||
            is_type(t, "scoped_identifier") || is_type(t, "qualified_identifier") ||
            is_type(t, "package_identifier")) return c;
    }
    TSNode sig = direct_type(n, "function_signature");
    if (!ts_node_is_null(sig)) return name_node(sig);
    return (TSNode){0};
}

static char *first_type_params(AstContext *c, TSNode n) {
    TSNode x = field_or_type(n, "type_parameters", "type_parameters");
    if (ts_node_is_null(x)) x = direct_type(n, "type_parameter_list");
    return node_text(c, x);
}

static TSNode body_node(TSNode n);

static char *result_type(AstContext *c, TSNode n) {
    const char *fields[] = {"return_type", "returns", "type"};
    for (size_t i = 0; i < 3; i++) {
        TSNode x = ast_field(n, fields[i]);
        if (!ts_node_is_null(x)) return ast_text(c, x);
    }
    if (is_type(c->language, "dart") && is_type(ts_node_type(n), "method_signature")) {
        TSNode sig = direct_type(n, "function_signature");
        uint32_t count = ts_node_named_child_count(sig);
        for (uint32_t i = 0; i < count; i++) {
            TSNode x = ts_node_named_child(sig, i);
            const char *t = ts_node_type(x);
            if (has(t, "type") || is_type(t, "void_type")) return ast_text(c, x);
        }
    }
    if (is_type(c->language, "kotlin") || is_type(c->language, "swift")) {
        TSNode body = body_node(n);
        uint32_t after = 0;
        uint32_t count = ts_node_named_child_count(n);
        for (uint32_t i = 0; i < count; i++) {
            TSNode x = ts_node_named_child(n, i);
            const char *t = ts_node_type(x);
            if (has(t, "parameters") || is_type(t, "parameter"))
                after = ts_node_end_byte(x);
            else if (after && (has(t, "type") || is_type(t, "user_type")) &&
                     (ts_node_is_null(body) || ts_node_start_byte(x) < ts_node_start_byte(body)))
                return ast_text(c, x);
        }
    }
    return NULL;
}

static void relation_leaf(AstContext *c, int owner, TSNode n, const char *kind) {
    if (ts_node_is_null(n) || owner < 0) return;
    char *value = ast_text(c, n);
    if (!value || !*value) { free(value); return; }
    SemTypeFact *f = sem_type_fact_add(&c->result->sem, value, kind, span(n));
    f->owner = owner;
    f->value = xstrdup(value);
    f->evidence = xstrdup("syntax");
    free(value);
}

static void relation(AstContext *c, int owner, TSNode n, const char *kind,
                     unsigned depth) {
    if (ts_node_is_null(n) || depth > 24) return;
    const char *t = ts_node_type(n);
    if (is_type(t, "type_identifier") || is_type(t, "user_type") ||
        is_type(t, "identifier") || is_type(t, "simple_identifier")) {
        relation_leaf(c, owner, n, kind);
        return;
    }
    uint32_t count = ts_node_named_child_count(n);
    if (!count) { relation_leaf(c, owner, n, kind); return; }
    for (uint32_t i = 0; i < count; i++)
        relation(c, owner, ts_node_named_child(n, i), kind, depth + 1);
}

static void type_relations(AstContext *c, TSNode n, int owner) {
    const char *fields[] = {"superclass", "interfaces", "extend", "derive", "class"};
    for (size_t i = 0; i < 5; i++) {
        TSNode x = ast_field(n, fields[i]);
        if (!ts_node_is_null(x)) relation(c, owner, x,
            i == 1 ? "implements" : "inherits", 0);
    }
    const char *types[] = {"superclass", "super_interfaces", "extends_interfaces",
                           "inheritance_specifier", "delegation_specifiers",
                           "base_list", "interfaces", "extends_clause"};
    uint32_t count = ts_node_named_child_count(n);
    for (uint32_t i = 0; i < count; i++) {
        TSNode x = ts_node_named_child(n, i);
        bool already = false;
        for (size_t k = 0; k < 5; k++) {
            TSNode y = ast_field(n, fields[k]);
            if (!ts_node_is_null(y) && ts_node_eq(x, y)) already = true;
        }
        if (already) continue;
        for (size_t j = 0; j < sizeof(types)/sizeof(types[0]); j++)
            if (is_type(ts_node_type(x), types[j])) {
                relation(c, owner, x, j == 1 || j == 2 || j == 6 ?
                         "implements" : "inherits", 0);
                break;
            }
    }
}

static void symbol_metadata(AstContext *c, TSNode n, SemSymbol *s) {
    uint32_t count = ts_node_named_child_count(n);
    for (uint32_t i = 0; i < count; i++) {
        TSNode x = ts_node_named_child(n, i);
        const char *t = ts_node_type(x);
        if (is_type(t, "modifiers") || is_type(t, "modifier") ||
            is_type(t, "access_modifier") || is_type(t, "member_modifier") ||
            is_type(t, "class_modifier") ||
            is_type(t, "function_modifier") || is_type(t, "visibility_modifier") ||
            is_type(t, "inheritance_modifier")) {
            char *v = ast_text(c, x);
            if (!v) continue;
            if (!s->modifiers) s->modifiers = xstrdup(v);
            else {
                size_t len = strlen(s->modifiers) + strlen(v) + 2;
                s->modifiers = xrealloc(s->modifiers, len);
                strcat(s->modifiers, " "); strcat(s->modifiers, v);
            }
            free(v);
        } else if (has(t, "annotation") || has(t, "attribute") ||
                   is_type(t, "decorator")) {
            char *v = ast_text(c, x);
            if (!v) continue;
            if (!s->decorators) s->decorators = xstrdup(v);
            else {
                size_t len = strlen(s->decorators) + strlen(v) + 2;
                s->decorators = xrealloc(s->decorators, len);
                strcat(s->decorators, " "); strcat(s->decorators, v);
            }
            free(v);
        }
    }
    if (s->modifiers) {
        const char *levels[] = {"public", "protected", "private", "internal", "fileprivate"};
        for (size_t i = 0; i < sizeof(levels)/sizeof(levels[0]); i++)
            if (strstr(s->modifiers, levels[i])) {
                s->visibility = xstrdup(levels[i]);
                s->exported = i == 0;
                break;
            }
    }
}

static char *parameter_identity(const char *signature) {
    if (!signature) return NULL;
    const char *open = strchr(signature, '(');
    if (!open) return NULL;
    int depth = 0;
    for (const char *p = open; *p; p++) {
        if (*p == '(') depth++;
        else if (*p == ')' && --depth == 0) {
            size_t len = (size_t)(p - open + 1);
            char *s = xmalloc(len + 1);
            memcpy(s, open, len); s[len] = 0;
            return s;
        }
    }
    return NULL;
}

static int add_symbol(AstContext *c, TSNode n, const char *kind, int parent) {
    TSNode name = name_node(n);
    if (ts_node_is_null(name) && !strcmp(kind, "constructor")) {
        /* Kotlin's secondary constructor is anonymous in the grammar. */
        if (parent >= 0) name = n;
    }
    char *s = node_text(c, name);
    if (!s || !*s) { free(s); return -1; }
    if (ts_node_eq(name, n)) {
        free(s); s = xstrdup("constructor");
    }
    int idx = c->result->sem.nsymbols;
    SemSymbol *sym = sem_symbol_add(&c->result->sem, s, kind, span(n));
    sym->parent = parent;
    sym->signature = limited_text(c, n, body_node(n));
    sym->generic_params = first_type_params(c, n);
    sym->result_type = result_type(c, n);
    symbol_metadata(c, n, sym);
    if (parent >= 0 && parent < idx) {
        const char *q = c->result->sem.symbols[parent].qualified_name;
        if (q) {
            size_t len = strlen(q) + strlen(s) + 2;
            sym->qualified_name = xmalloc(len);
            snprintf(sym->qualified_name, len, "%s.%s", q, s);
        }
    }
    if (!sym->qualified_name) sym->qualified_name = xstrdup(s);
    if (callable(kind)) {
        char *params = parameter_identity(sym->signature);
        size_t len = strlen(sym->qualified_name) + (params ? strlen(params) : 2) + 2;
        sym->scope_key = xmalloc(len);
        snprintf(sym->scope_key, len, "%s%s", sym->qualified_name,
                 params ? params : "()");
        free(params);
    } else sym->scope_key = xstrdup(sym->qualified_name);
    if (parent >= 0) {
        SemEdge *e = sem_edge_add(&c->result->sem, "contains", parent, idx, span(n));
        e->strategy = xstrdup("syntax"); e->provenance = xstrdup("ast");
        e->evidence = xstrdup("lexical ownership");
    }
    if (sym->result_type) {
        SemTypeFact *f = sem_type_fact_add(&c->result->sem,
                                          sym->result_type, "returns", span(n));
        f->owner = idx;
        f->value = xstrdup(sym->result_type);
        f->evidence = xstrdup("syntax");
    }
    if (is_type(c->language, "java") && is_type(kind, "method") &&
        sym->modifiers && strstr(sym->modifiers, "native")) {
        SemTypeFact *f = sem_type_fact_add(&c->result->sem, s,
                                          "native_bridge_call", span(n));
        f->owner = idx;
        f->evidence = xstrdup("native modifier");
    }
    type_relations(c, n, idx);
    free(s);
    return idx;
}

static bool call_type(const char *lang, const char *t) {
    if (is_type(t, "method_invocation") || is_type(t, "invocation_expression") ||
        is_type(t, "call_expression")) return true;
    if (is_type(lang, "kotlin") && is_type(t, "constructor_invocation")) return true;
    return is_type(lang, "dart") && is_type(t, "constructor_invocation");
}

static void import_binding(AstContext *c, TSNode n) {
    const char *t = ts_node_type(n);
    bool directive = is_type(t, "import_declaration") || is_type(t, "import") ||
        is_type(t, "using_directive") || is_type(t, "import_or_export");
    if (!directive) return;
    TSNode path = (TSNode){0}, alias = (TSNode){0};
    if (is_type(c->language, "java") || is_type(c->language, "kotlin") ||
        is_type(c->language, "swift")) {
        path = ts_node_named_child(n, 0);
        if (is_type(c->language, "kotlin") && ts_node_named_child_count(n) > 1)
            alias = ts_node_named_child(n, 1);
    } else if (is_type(c->language, "csharp")) {
        path = direct_type(n, "qualified_name");
        if (ts_node_is_null(path)) path = ts_node_named_child(n, 0);
    } else if (is_type(c->language, "dart")) {
        TSNode specification = direct_type(direct_type(n, "library_import"),
                                           "import_specification");
        if (ts_node_is_null(specification)) return;
        TSNode uri = direct_type(specification, "configurable_uri");
        path = direct_type(uri, "uri");
        if (ts_node_named_child_count(specification) > 1)
            alias = ts_node_named_child(specification,
                                        ts_node_named_child_count(specification) - 1);
    } else if (is_type(c->language, "scala")) {
        /* Scala's path fields are repeated; take the source span after import. */
        TSNode first = ts_node_named_child(n, 0);
        TSNode last = ts_node_named_child(n, ts_node_named_child_count(n) - 1);
        if (!ts_node_is_null(first) && !ts_node_is_null(last)) {
            char *module = ast_slice(c, ts_node_start_byte(first), ts_node_end_byte(last));
            if (module) {
                const char *tail = strrchr(module, '.');
                SemBinding *b = sem_binding_add(&c->result->sem, module,
                                                tail ? tail + 1 : module, span(n));
                b->kind = xstrdup("import");
                b->original_name = xstrdup(tail ? tail + 1 : module);
                b->evidence = xstrdup("syntax");
                free(module);
            }
        }
        return;
    }
    if (ts_node_is_null(path)) return;
    char *module = ast_text(c, path), *local = node_text(c, alias);
    if (!module || !*module) { free(module); free(local); return; }
    bool wildcard = is_type(c->language, "java") &&
        !ts_node_is_null(direct_type(n, "asterisk"));
    if (wildcard) { free(local); local = xstrdup("*"); }
    if (is_type(c->language, "dart") &&
        (module[0] == '\'' || module[0] == '"')) {
        size_t len = strlen(module);
        if (len > 1 && module[len - 1] == module[0]) {
            memmove(module, module + 1, len - 2);
            module[len - 2] = 0;
        }
    }
    const char *tail = strrchr(module, '.');
    if (!tail) tail = strrchr(module, '/');
    const char *original = wildcard ? "*" : (tail ? tail + 1 : module);
    bool split_symbol = !wildcard && (is_type(c->language, "java") ||
        is_type(c->language, "kotlin") || is_type(c->language, "csharp"));
    char *module_part = split_symbol && tail ? ast_slice(c,
        ts_node_start_byte(path), ts_node_start_byte(path) + (uint32_t)(tail - module)) : NULL;
    SemBinding *b = sem_binding_add(&c->result->sem,
                                    module_part ? module_part : module,
                                    local ? local : original, span(n));
    b->kind = xstrdup("import");
    b->original_name = xstrdup(original);
    b->evidence = xstrdup("syntax");
    free(module_part); free(module); free(local);
}

static TSNode last_identifier(TSNode n) {
    if (ts_node_is_null(n)) return n;
    const char *t = ts_node_type(n);
    if (has(t, "identifier") || is_type(t, "name")) return n;
    uint32_t count = ts_node_named_child_count(n);
    for (uint32_t i = count; i > 0; i--) {
        TSNode x = last_identifier(ts_node_named_child(n, i - 1));
        if (!ts_node_is_null(x)) return x;
    }
    return (TSNode){0};
}

static void add_call(AstContext *c, TSNode n, int owner) {
    TSNode callee = ast_field(n, "name");
    if (ts_node_is_null(callee)) callee = ast_field(n, "function");
    if (ts_node_is_null(callee)) callee = ast_field(n, "object");
    if (ts_node_is_null(callee)) callee = ts_node_named_child(n, 0);
    TSNode id = last_identifier(callee);
    if (ts_node_is_null(id)) return;
    char *name = ast_text(c, id), *whole = ast_text(c, callee);
    if (!name || !*name) { free(name); free(whole); return; }
    SemReference *r = sem_reference_add(&c->result->sem, name, "call", span(id));
    r->owner = owner;
    r->strategy = xstrdup("syntax");
    r->evidence = whole ? whole : xstrdup(name);
    if (whole && strlen(whole) > strlen(name)) {
        char *end = strstr(whole, name);
        if (end && end > whole && (end[-1] == '.' || end[-1] == ':')) {
            r->qualifier = xmalloc((size_t)(end - whole));
            memcpy(r->qualifier, whole, (size_t)(end - whole - 1));
            r->qualifier[end - whole - 1] = 0;
        }
    }
    TSNode args = ast_field(n, "arguments");
    if (ts_node_is_null(args)) args = direct_type(n, "value_arguments");
    r->argc = ts_node_is_null(args) ? -1 : (int)ts_node_named_child_count(args);
    free(name);
}

static void dart_selector_call(AstContext *c, TSNode n, int owner) {
    if (ts_node_is_null(direct_type(n, "argument_part"))) return;
    TSNode prior = ts_node_prev_named_sibling(n);
    TSNode id = last_identifier(prior);
    if (ts_node_is_null(id)) return;
    char *name = ast_text(c, id);
    if (!name || !*name) { free(name); return; }
    SemReference *r = sem_reference_add(&c->result->sem, name, "call", span(id));
    r->owner = owner;
    r->strategy = xstrdup("syntax");
    r->evidence = ast_text(c, n);
    TSNode args = direct_type(direct_type(n, "argument_part"), "arguments");
    r->argc = ts_node_is_null(args) ? -1 : (int)ts_node_named_child_count(args);
    free(name);
}

static void add_type_reference(AstContext *c, TSNode n, int owner) {
    if (owner < 0) return;
    const char *t = ts_node_type(n);
    TSNode parent = ts_node_parent(n);
    if (ts_node_is_null(parent)) return;
    const char *pt = ts_node_type(parent);
    if (is_type(pt, "type_parameter") || is_type(pt, "type_parameters")) return;
    if (!ts_node_is_null(name_node(parent)) && ts_node_eq(name_node(parent), n) &&
        decl_kind(c->language, pt)) return;
    bool type_node = is_type(t, "type_identifier") ||
        (is_type(c->language, "kotlin") && is_type(t, "user_type"));
    if (!type_node && is_type(c->language, "csharp") && is_type(t, "identifier"))
        type_node = ts_node_eq(ast_field(parent, "type"), n) ||
                    ts_node_eq(ast_field(parent, "returns"), n) ||
                    is_type(pt, "base_list");
    if (!type_node) return;
    char *name = ast_text(c, n);
    if (!name || !*name) { free(name); return; }
    SemReference *r = sem_reference_add(&c->result->sem, name, "type", span(n));
    r->owner = owner;
    r->strategy = xstrdup("syntax");
    r->evidence = xstrdup(pt);
    free(name);
}

static void visit(Managed *m, TSNode n, int parent, unsigned depth) {
    AstContext *c = m->ctx;
    if (depth > 256 || c->cancelled || c->truncated) return;
    if (c->cancel_flag && *c->cancel_flag) { c->cancelled = true; return; }
    if (++c->visited > 250000) { c->truncated = true; return; }
    const char *t = ts_node_type(n);
    if (ts_node_is_error(n) || ts_node_is_missing(n)) return;
    const char *kind = decl_kind(c->language, t);
    TSNode pn = ts_node_parent(n);
    if (is_type(t, "function_signature") && !ts_node_is_null(pn) &&
        is_type(ts_node_type(pn), "method_signature")) kind = NULL;
    if (kind && is_type(kind, "function") && parent >= 0) {
        const char *pk = c->result->sem.symbols[parent].kind;
        if (is_type(pk, "class") || is_type(pk, "interface") || is_type(pk, "trait") ||
            is_type(pk, "protocol") || is_type(pk, "object") || is_type(pk, "extension"))
            kind = "method";
    }
    int owner = parent;
    if (kind) {
        int idx = add_symbol(c, n, kind, parent);
        if (idx >= 0) owner = idx;
    } else if (call_type(c->language, t)) add_call(c, n, parent);
    else if (is_type(c->language, "dart") && is_type(t, "selector"))
        dart_selector_call(c, n, parent);
    add_type_reference(c, n, parent);
    import_binding(c, n);
    int pending_method = -1;
    int file_namespace = -1;
    TSTreeCursor cursor = ts_tree_cursor_new(n);
    if (!ts_tree_cursor_goto_first_child(&cursor)) {
        ts_tree_cursor_delete(&cursor);
        return;
    }
    do {
        TSNode child = ts_tree_cursor_current_node(&cursor);
        if (!ts_node_is_named(child)) continue;
        const char *ct = ts_node_type(child);
        int child_owner = file_namespace >= 0 ? file_namespace : owner;
        if (is_type(c->language, "dart") && pending_method >= 0 &&
            is_type(ct, "function_body")) child_owner = pending_method;
        int before = c->result->sem.nsymbols;
        visit(m, child, child_owner, depth + 1);
        if (is_type(c->language, "dart") &&
            (is_type(ct, "method_signature") || is_type(ct, "function_signature")) &&
            c->result->sem.nsymbols > before)
            pending_method = c->result->sem.nsymbols - 1;
        else if (is_type(ct, "function_body")) pending_method = -1;
        if ((is_type(ct, "package_declaration") || is_type(ct, "package_header") ||
             is_type(ct, "package_clause") || is_type(ct, "file_scoped_namespace_declaration")) &&
            c->result->sem.nsymbols > before)
            file_namespace = c->result->sem.nsymbols - 1;
    } while (ts_tree_cursor_goto_next_sibling(&cursor));
    ts_tree_cursor_delete(&cursor);
}

static void extract(AstContext *c) {
    Managed m = {.ctx = c};
    visit(&m, c->root, -1, 0);
}

void ast_managed_register(void) {
    static const AstAdapter adapters[] = {
        {"java", tree_sitter_java, extract},
        {"kotlin", tree_sitter_kotlin, extract},
        {"scala", tree_sitter_scala, extract},
        {"csharp", tree_sitter_c_sharp, extract},
        {"swift", tree_sitter_swift, extract},
        {"dart", tree_sitter_dart, extract},
    };
    for (size_t i = 0; i < sizeof(adapters)/sizeof(adapters[0]); i++)
        ast_register(&adapters[i]);
}
