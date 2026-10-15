#include "ast.h"
#include "semantic.h"

#include <stdlib.h>
#include <string.h>

extern const TSLanguage *tree_sitter_python(void);
extern const TSLanguage *tree_sitter_ruby(void);
extern const TSLanguage *tree_sitter_php(void);

typedef struct { AstContext *ctx; int owner; } DynWalk;
static TSNode first_named(TSNode n);

static bool is(TSNode n, const char *s) {
    return !ts_node_is_null(n) && strcmp(ts_node_type(n), s) == 0;
}

static SemSpan span(TSNode n) {
    TSPoint a = ts_node_start_point(n), b = ts_node_end_point(n);
    return (SemSpan){(int)a.row + 1, (int)a.column, (int)b.row + 1,
                     (int)b.column, ts_node_start_byte(n), ts_node_end_byte(n)};
}

static char *text(AstContext *c, TSNode n) {
    return ts_node_is_null(n) ? NULL : ast_text(c, n);
}

static char *short_name(const char *s) {
    if (!s) return NULL;
    const char *p = s;
    for (const char *q = s; *q; q++)
        if (*q == '.' || *q == '\\' || *q == '/') p = q + 1;
    return strdup(p);
}

static char *qualified(SemResult *r, int owner, const char *name) {
    const char *prefix = owner >= 0 ? r->symbols[owner].qualified_name : NULL;
    if (!prefix || !*prefix) return strdup(name);
    size_t a = strlen(prefix), b = strlen(name);
    char *out = malloc(a + b + 2);
    if (out) { memcpy(out, prefix, a); out[a] = '.'; memcpy(out + a + 1, name, b + 1); }
    return out;
}

static char *decorators_text(AstContext *ctx, TSNode wrapper) {
    if (ts_node_is_null(wrapper)) return NULL;
    if (!is(wrapper, "decorated_definition")) return text(ctx, wrapper);
    size_t start = 0, end = 0;
    for (uint32_t i = 0; i < ts_node_named_child_count(wrapper); i++) {
        TSNode child = ts_node_named_child(wrapper, i);
        if (!is(child, "decorator")) continue;
        if (!start) start = ts_node_start_byte(child);
        end = ts_node_end_byte(child);
    }
    return end > start ? ast_slice(ctx, (uint32_t)start, (uint32_t)end) : NULL;
}

static int add_symbol(DynWalk *w, TSNode node, TSNode name_node,
                      const char *kind, TSNode params, TSNode result,
                      TSNode decorators) {
    char *name = text(w->ctx, name_node);
    if (!name || !*name) { free(name); return -1; }
    SemResult *r = &w->ctx->result->sem;
    int idx = r->nsymbols;
    SemSymbol *s = sem_symbol_add(r, name, kind, span(node));
    if (!s) { free(name); return -1; }
    s->parent = w->owner;
    s->qualified_name = qualified(r, w->owner, name);
    s->signature = text(w->ctx, params);
    s->result_type = text(w->ctx, result);
    s->decorators = decorators_text(w->ctx, decorators);
    bool module_owner = w->owner >= 0 &&
        !strcmp(r->symbols[w->owner].kind, "module") &&
        strcmp(w->ctx->language, "python") != 0;
    s->exported = (w->owner < 0 || module_owner) &&
                  (strcmp(w->ctx->language, "python") != 0 || name[0] != '_');
    s->scope_key = s->qualified_name ? strdup(s->qualified_name) : NULL;
    if (name[0] == '_' && strcmp(w->ctx->language, "python") == 0)
        s->visibility = strdup("private-convention");
    free(name);
    return idx;
}

static void add_ref(DynWalk *w, TSNode site, TSNode target, TSNode receiver,
                    TSNode args) {
    char *raw = text(w->ctx, target);
    if (!raw || !*raw) { free(raw); return; }
    char *name = short_name(raw);
    SemReference *ref = sem_reference_add(&w->ctx->result->sem, name,
                                          "call", span(site));
    if (ref) {
        ref->owner = w->owner;
        ref->qualifier = text(w->ctx, receiver);
        ref->strategy = strdup("syntax-call");
        ref->evidence = strdup(raw);
        ref->argc = -1;
        if (!ts_node_is_null(args)) {
            int argc = 0;
            for (uint32_t i = 0; i < ts_node_named_child_count(args); i++) {
                TSNode child = ts_node_named_child(args, i);
                if (!is(child, "comment")) argc++;
            }
            ref->argc = argc;
        }
    }
    free(raw); free(name);
}

static void add_read(DynWalk *w, TSNode node) {
    char *name = text(w->ctx, node);
    if (!name || !*name) { free(name); return; }
    SemReference *ref = sem_reference_add(&w->ctx->result->sem, name,
                                          "read", span(node));
    if (ref) {
        ref->owner = w->owner;
        ref->strategy = strdup("syntax-read");
        ref->evidence = strdup(name);
    }
    free(name);
}

static void add_binding(DynWalk *w, TSNode site, const char *module,
                        const char *original, const char *local, const char *kind) {
    if (!local || !*local) return;
    SemBinding *b = sem_binding_add(&w->ctx->result->sem, module, local, span(site));
    if (!b) return;
    b->owner = w->owner;
    b->original_name = original ? strdup(original) : NULL;
    b->kind = strdup(kind);
    b->evidence = text(w->ctx, site);
}

static void add_type(DynWalk *w, TSNode site, TSNode variable, TSNode type_node,
                     const char *kind) {
    char *name = text(w->ctx, variable), *raw = text(w->ctx, type_node);
    if (name && raw && *name && *raw && strlen(name) < 128 && strlen(raw) < 256) {
        char *type_name = short_name(raw);
        SemTypeFact *f = sem_type_fact_add(&w->ctx->result->sem, name, kind,
                                           span(site));
        if (f) {
            f->owner = w->owner;
            f->value = type_name;
            f->evidence = text(w->ctx, site);
            type_name = NULL;
        }
        free(type_name);
    }
    free(name); free(raw);
}

static void add_relation(AstContext *ctx, int owner, TSNode site,
                         const char *kind, TSNode target) {
    if (owner < 0 || ts_node_is_null(target)) return;
    char *raw = text(ctx, target);
    if (!raw || !*raw) { free(raw); return; }
    SemTypeFact *f = sem_type_fact_add(&ctx->result->sem,
                                       ctx->result->sem.symbols[owner].name,
                                       kind, span(site));
    if (f) { f->owner = owner; f->value = raw; f->evidence = text(ctx, site); raw = NULL; }
    free(raw);
}

static void add_relation_children(AstContext *ctx, int owner, TSNode list,
                                  const char *kind) {
    if (ts_node_is_null(list)) return;
    uint32_t count = ts_node_named_child_count(list);
    if (!count) { add_relation(ctx, owner, list, kind, list); return; }
    for (uint32_t i = 0; i < count; i++)
        add_relation(ctx, owner, ts_node_named_child(list, i), kind,
                     ts_node_named_child(list, i));
}

static char *literal_string(AstContext *ctx, TSNode node) {
    if (!is(node, "string")) return NULL;
    char *raw = text(ctx, node);
    if (!raw) return NULL;
    size_t n = strlen(raw);
    if (n < 2 || (raw[0] != '\'' && raw[0] != '"') || raw[n-1] != raw[0]) {
        free(raw); return NULL;
    }
    raw[n-1] = 0;
    memmove(raw, raw + 1, n - 1);
    return raw;
}

static void python_channel(DynWalk *w, TSNode call, TSNode callee, TSNode args) {
    if (!is(callee, "attribute") || ts_node_is_null(args)) return;
    char *receiver = text(w->ctx, ast_field(callee, "object"));
    char *verb = text(w->ctx, ast_field(callee, "attribute"));
    TSNode first = first_named(args);
    char *literal = literal_string(w->ctx, first);
    const char *kind = NULL, *value = NULL;
    if (receiver && verb && literal && *literal) {
        bool requests_bound = false;
        SemResult *sem = &w->ctx->result->sem;
        for (int i = 0; i < sem->nbindings; i++) {
            SemBinding *b = &sem->bindings[i];
            if (b->module && b->local_name && !strcmp(b->module, "requests") &&
                !strcmp(b->local_name, receiver)) { requests_bound = true; break; }
        }
        if (requests_bound && literal[0] == '/' && literal[1] != '/' &&
            (!strcmp(verb, "get") || !strcmp(verb, "post") ||
             !strcmp(verb, "put") || !strcmp(verb, "patch") || !strcmp(verb, "delete"))) {
            kind = "channel:http:producer";
            value = !strcmp(verb, "get") ? "GET" :
                    !strcmp(verb, "post") ? "POST" :
                    !strcmp(verb, "put") ? "PUT" :
                    !strcmp(verb, "patch") ? "PATCH" : "DELETE";
        }
        if (kind) {
            SemTypeFact *f = sem_type_fact_add(&w->ctx->result->sem, literal, kind, span(call));
            if (f) { f->owner = w->owner; f->value = strdup(value); f->evidence = text(w->ctx, call); }
        }
    }
    free(receiver); free(verb); free(literal);
}

static TSNode first_named(TSNode n) {
    return ts_node_is_null(n) ? (TSNode){0} : ts_node_named_child(n, 0);
}

static void python_import(DynWalk *w, TSNode node) {
    bool from = is(node, "import_from_statement");
    char *module = from ? text(w->ctx, ast_field(node, "module_name")) : NULL;
    uint32_t count = ts_node_named_child_count(node);
    for (uint32_t i = 0; i < count; i++) {
        TSNode child = ts_node_named_child(node, i);
        if (from && (is(child, "relative_import") || is(child, "dotted_name")) &&
            ts_node_eq(child, ast_field(node, "module_name"))) continue;
        if (is(child, "aliased_import")) {
            char *orig = text(w->ctx, ast_field(child, "name"));
            char *local = text(w->ctx, ast_field(child, "alias"));
            add_binding(w, child, from ? module : orig, from ? orig : NULL,
                        local, from ? "from-import" : "module_import");
            free(orig); free(local);
        } else if (is(child, "dotted_name")) {
            char *orig = text(w->ctx, child);
            char *local = from ? short_name(orig) : strdup(orig);
            if (!from && local) { char *dot = strchr(local, '.'); if (dot) *dot = 0; }
            add_binding(w, child, from ? module : orig, from ? orig : NULL,
                        local, from ? "from-import" : "module_import");
            free(orig); free(local);
        } else if (is(child, "wildcard_import")) {
            add_binding(w, child, module, "*", "*", "wildcard-import");
        }
    }
    free(module);
}

static void php_import(DynWalk *w, TSNode node) {
    uint32_t n = ts_node_named_child_count(node);
    char *prefix = NULL;
    TSNode group = ast_field(node, "body");
    if (!ts_node_is_null(group)) {
        for (uint32_t i = 0; i < n; i++) {
            TSNode ch = ts_node_named_child(node, i);
            if (is(ch, "namespace_name")) { prefix = text(w->ctx, ch); break; }
        }
    }
    for (uint32_t i = 0; i < n; i++) {
        TSNode child = ts_node_named_child(node, i);
        bool grouped = is(child, "namespace_use_group");
        uint32_t clauses = grouped ? ts_node_named_child_count(child) : 1;
        for (uint32_t j = 0; j < clauses; j++) {
            TSNode clause = grouped ? ts_node_named_child(child, j) : child;
            if (!is(clause, "namespace_use_clause")) continue;
            char *part = text(w->ctx, first_named(clause));
            if (!part) continue;
            char *module = part;
            if (prefix && *prefix) {
                size_t a = strlen(prefix), b = strlen(part);
                module = malloc(a + b + 2);
                if (module) { memcpy(module, prefix, a); module[a] = '\\'; memcpy(module+a+1, part, b+1); }
            }
            char *alias = text(w->ctx, ast_field(clause, "alias"));
            char *local = alias ? strdup(alias) : short_name(module);
            add_binding(w, clause, module, module, local, "namespace-use");
            if (module != part) free(module);
            free(part); free(alias); free(local);
        }
    }
    free(prefix);
}

static void ruby_import(DynWalk *w, TSNode node) {
    TSNode method = ast_field(node, "method");
    char *verb = text(w->ctx, method);
    if (verb && (!strcmp(verb, "require") || !strcmp(verb, "require_relative") ||
                 !strcmp(verb, "include") || !strcmp(verb, "extend"))) {
        TSNode args = ast_field(node, "arguments");
        TSNode val = ts_node_is_null(args) ? first_named(node) : first_named(args);
        char *module = text(w->ctx, val);
        if (module) {
            size_t n = strlen(module);
            if (n >= 2 && (module[0] == '\'' || module[0] == '"') && module[n-1] == module[0]) {
                module[n-1] = 0; memmove(module, module + 1, n - 1);
            }
            char *local = short_name(module);
            add_binding(w, node, module, NULL, local, verb);
            free(local); free(module);
        }
    }
    free(verb);
}

static TSNode python_doc_node(TSNode body) {
    TSNode value = first_named(body);
    if (is(value, "expression_statement")) value = first_named(value);
    return is(value, "string") || is(value, "concatenated_string") ?
           value : (TSNode){0};
}

static void python_capture_doc(AstContext *ctx, TSNode node) {
    if (ts_node_is_null(node)) return;
    ParseResult *pr = ctx->result;
    if (pr->ncmts == pr->ccmts) {
        pr->ccmts = pr->ccmts ? pr->ccmts * 2 : 16;
        pr->cmts = xrealloc(pr->cmts, sizeof *pr->cmts * (size_t)pr->ccmts);
    }
    CmtDef *c = &pr->cmts[pr->ncmts++];
    c->body = text(ctx, node);
    c->line = ast_line(node);
    c->end_line = (int)ts_node_end_point(node).row + 1;
    c->below = true;
    c->pure = true;
}

static char *preceding_comment(AstContext *c, TSNode n) {
    TSPoint start = ts_node_start_point(n);
    for (TSNode current = n; !ts_node_is_null(current);
         current = ts_node_parent(current)) {
        TSNode prev = ts_node_prev_named_sibling(current);
        if (ts_node_is_null(prev)) continue;
        if (!is(prev, "comment")) return NULL;
        TSPoint end = ts_node_end_point(prev);
        return end.row + 1 >= start.row ? text(c, prev) : NULL;
    }
    return NULL;
}

static TSNode py_decorators(TSNode n) {
    TSNode p = ts_node_parent(n);
    return is(p, "decorated_definition") ? p : (TSNode){0};
}

static void walk(DynWalk *w, TSNode n, unsigned depth) {
    if (depth > 256 || ++w->ctx->visited > 1000000 ||
        (w->ctx->cancel_flag && *w->ctx->cancel_flag)) {
        w->ctx->truncated = true; return;
    }
    if (ts_node_is_error(n) || ts_node_is_missing(n)) return;
    const char *lang = w->ctx->language, *t = ts_node_type(n);
    bool py = strcmp(lang, "python") == 0;
    bool rb = strcmp(lang, "ruby") == 0;
    bool php = strcmp(lang, "php") == 0;
    bool def = (py && (!strcmp(t, "function_definition") || !strcmp(t, "class_definition"))) ||
               (rb && (!strcmp(t, "method") || !strcmp(t, "singleton_method") ||
                       !strcmp(t, "class") || !strcmp(t, "module"))) ||
               (php && (!strcmp(t, "function_definition") || !strcmp(t, "method_declaration") ||
                        !strcmp(t, "class_declaration") || !strcmp(t, "interface_declaration") ||
                        !strcmp(t, "trait_declaration") || !strcmp(t, "namespace_definition")));
    int child_owner = w->owner;
    if (def) {
        bool type = strstr(t, "class") || strstr(t, "interface") || strstr(t, "trait") ||
                    !strcmp(t, "module") || !strcmp(t, "namespace_definition");
        const char *parent_kind = w->owner >= 0 ?
            w->ctx->result->sem.symbols[w->owner].kind : NULL;
        bool class_scope = parent_kind &&
            (!strcmp(parent_kind, "class") || !strcmp(parent_kind, "module"));
        const char *kind = type ? (!strcmp(t, "module") || !strcmp(t, "namespace_definition")
                                    ? "module" : "class") :
                            ((php && !strcmp(t, "method_declaration")) ||
                             (class_scope && (py || rb)) ? "method" : "function");
        TSNode name = ast_field(n, "name");
        TSNode params = ast_field(n, "parameters");
        TSNode result = ast_field(n, "return_type");
        TSNode attrs = py ? py_decorators(n) : ast_field(n, "attributes");
        child_owner = add_symbol(w, n, name, kind, params, result, attrs);
        if (child_owner >= 0) {
            SemSymbol *s = &w->ctx->result->sem.symbols[child_owner];
            TSNode body = ast_field(n, "body");
            if (py) {
                TSNode doc = python_doc_node(body);
                s->documentation = text(w->ctx, doc);
                python_capture_doc(w->ctx, doc);
            }
            else s->documentation = preceding_comment(w->ctx, n);
            if (php && !strcmp(t, "method_declaration")) {
                uint32_t count = ts_node_child_count(n);
                for (uint32_t i = 0; i < count; i++) {
                    TSNode m = ts_node_child(n, i);
                    if (is(m, "visibility_modifier")) s->visibility = text(w->ctx, m);
                }
            }
            if (type) {
                TSNode base = ast_field(n, py ? "superclasses" : rb ? "superclass" : "base_clause");
                if (py) add_relation_children(w->ctx, child_owner, base, "inherits");
                else if (rb) {
                    TSNode superclass = first_named(base);
                    add_relation(w->ctx, child_owner, base, "inherits", superclass);
                }
                if (php) {
                    uint32_t count = ts_node_named_child_count(n);
                    for (uint32_t i = 0; i < count; i++) {
                        TSNode ch = ts_node_named_child(n, i);
                        if (is(ch, "base_clause")) add_relation_children(w->ctx, child_owner, ch, "inherits");
                        if (is(ch, "class_interface_clause") || is(ch, "interface_base_clause"))
                            add_relation_children(w->ctx, child_owner, ch, "implements");
                    }
                }
            }
            if (!ts_node_is_null(result))
                add_relation(w->ctx, child_owner, result, "returns", result);
            if (py && !ts_node_is_null(attrs)) {
                uint32_t count = ts_node_named_child_count(attrs);
                for (uint32_t i = 0; i < count; i++) {
                    TSNode decorator = ts_node_named_child(attrs, i);
                    if (is(decorator, "decorator")) {
                        TSNode target = first_named(decorator);
                        if (is(target, "call")) target = ast_field(target, "function");
                        add_relation(w->ctx, child_owner, decorator, "decorates", target);
                    }
                }
            }
            if (php && !ts_node_is_null(attrs)) {
                uint32_t groups = ts_node_named_child_count(attrs);
                for (uint32_t i = 0; i < groups; i++) {
                    TSNode group = ts_node_named_child(attrs, i);
                    for (uint32_t j = 0; j < ts_node_named_child_count(group); j++) {
                        TSNode attribute = ts_node_named_child(group, j);
                        if (is(attribute, "attribute"))
                            add_relation(w->ctx, child_owner, attribute,
                                         "decorates", first_named(attribute));
                    }
                }
            }
        } else child_owner = w->owner;
    } else if (py && is(n, "module")) {
        python_capture_doc(w->ctx, python_doc_node(n));
    } else if (py && (is(n, "import_statement") || is(n, "import_from_statement"))) {
        python_import(w, n);
    } else if (php && is(n, "namespace_use_declaration")) {
        php_import(w, n);
    } else if (py && is(n, "assignment")) {
        TSNode left = ast_field(n, "left"), type = ast_field(n, "type");
        if (is(left, "identifier") && !ts_node_is_null(type))
            add_type(w, n, left, type, "variable_type");
        TSNode right = ast_field(n, "right");
        if (is(left, "identifier") && is(right, "call")) {
            TSNode ctor = ast_field(right, "function");
            if (is(ctor, "identifier")) add_type(w, n, left, ctor, "constructor");
        }
    } else if (rb && is(n, "assignment")) {
        TSNode left = ast_field(n, "left"), right = ast_field(n, "right");
        if (is(left, "identifier") && is(right, "call")) {
            TSNode recv = ast_field(right, "receiver"), method = ast_field(right, "method");
            char *verb = text(w->ctx, method);
            if (verb && !strcmp(verb, "new") && is(recv, "constant"))
                add_type(w, n, left, recv, "constructor");
            free(verb);
        }
    } else if (php && is(n, "assignment_expression")) {
        TSNode left = ast_field(n, "left"), right = ast_field(n, "right");
        if (is(left, "variable_name") && is(right, "object_creation_expression")) {
            TSNode ctor = first_named(right);
            if (is(ctor, "name") || is(ctor, "qualified_name"))
                add_type(w, n, left, ctor, "constructor");
        }
    } else if (py && is(n, "identifier")) {
        TSNode parent = ts_node_parent(n);
        if (is(parent, "argument_list") || is(parent, "return_statement") ||
            (is(parent, "attribute") && ts_node_eq(n, ast_field(parent, "object"))) ||
            (is(parent, "assignment") && ts_node_eq(n, ast_field(parent, "right"))))
            add_read(w, n);
    } else if (rb && is(n, "identifier")) {
        TSNode parent = ts_node_parent(n);
        if (is(parent, "argument_list") ||
            (is(parent, "call") && ts_node_eq(n, ast_field(parent, "receiver"))) ||
            (is(parent, "assignment") && ts_node_eq(n, ast_field(parent, "right"))))
            add_read(w, n);
    } else if (php && is(n, "variable_name")) {
        TSNode parent = ts_node_parent(n);
        if (is(parent, "argument") || is(parent, "return_statement") ||
            ((is(parent, "member_call_expression") || is(parent, "nullsafe_member_call_expression")) &&
             ts_node_eq(n, ast_field(parent, "object"))))
            add_read(w, n);
    } else if (py && is(n, "call")) {
        TSNode callee = ast_field(n, "function");
        TSNode receiver = is(callee, "attribute") ? ast_field(callee, "object") : (TSNode){0};
        TSNode target = is(callee, "attribute") ? ast_field(callee, "attribute") : callee;
        if (is(target, "identifier")) add_ref(w, n, target, receiver, ast_field(n, "arguments"));
        python_channel(w, n, callee, ast_field(n, "arguments"));
    } else if (rb && is(n, "call")) {
        ruby_import(w, n);
        TSNode method = ast_field(n, "method");
        if (!ts_node_is_null(method)) add_ref(w, n, method, ast_field(n, "receiver"), ast_field(n, "arguments"));
    } else if (php && (is(n, "function_call_expression") ||
                       is(n, "member_call_expression") || is(n, "nullsafe_member_call_expression") ||
                       is(n, "scoped_call_expression"))) {
        TSNode target = ast_field(n, is(n, "function_call_expression") ? "function" : "name");
        TSNode receiver = ast_field(n, is(n, "scoped_call_expression") ? "scope" : "object");
        if (is(target, "name") || is(target, "qualified_name"))
            add_ref(w, n, target, receiver, ast_field(n, "arguments"));
    }
    DynWalk nested = {w->ctx, child_owner};
    uint32_t count = ts_node_named_child_count(n);
    for (uint32_t i = 0; i < count; i++) {
        TSNode child = ts_node_named_child(n, i);
        int before = w->ctx->result->sem.nsymbols;
        if (!ts_node_is_null(child)) walk(&nested, child, depth + 1);
        if (php && is(child, "namespace_definition") &&
            ts_node_is_null(ast_field(child, "body")) &&
            w->ctx->result->sem.nsymbols > before)
            nested.owner = before;
        if (w->ctx->truncated) break;
    }
}

static void extract(AstContext *ctx) {
    DynWalk w = {ctx, -1};
    walk(&w, ctx->root, 0);
}

void ast_dynamic_register(void) {
    static const AstAdapter adapters[] = {
        {"python", tree_sitter_python, extract},
        {"ruby", tree_sitter_ruby, extract},
        {"php", tree_sitter_php, extract},
    };
    for (size_t i = 0; i < sizeof adapters / sizeof adapters[0]; i++)
        ast_register(&adapters[i]);
}
