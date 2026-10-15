#include "ast.h"
#include "semantic.h"

#include <stdlib.h>
#include <string.h>
#include <stdio.h>

extern const TSLanguage *tree_sitter_c(void);
extern const TSLanguage *tree_sitter_cpp(void);
extern const TSLanguage *tree_sitter_objc(void);
extern const TSLanguage *tree_sitter_go(void);
extern const TSLanguage *tree_sitter_rust(void);

static bool is(TSNode n, const char *kind) {
    return !ts_node_is_null(n) && strcmp(ts_node_type(n), kind) == 0;
}

static SemSpan span(TSNode n) {
    TSPoint a = ts_node_start_point(n), b = ts_node_end_point(n);
    return (SemSpan){.line=(int)a.row+1, .column=(int)a.column,
        .end_line=(int)b.row+1, .end_column=(int)b.column,
        .start_byte=ts_node_start_byte(n), .end_byte=ts_node_end_byte(n)};
}

static TSNode field(TSNode n, const char *name) {
    return ts_node_child_by_field_name(n, name, (uint32_t)strlen(name));
}

static TSNode named(TSNode n, unsigned i) { return ts_node_named_child(n, i); }

static char *copy_text(AstContext *ctx, TSNode n) {
    return ts_node_is_null(n) ? NULL : ast_text(ctx, n);
}

static char *slice_until(AstContext *ctx, TSNode n, TSNode end) {
    uint32_t a=ts_node_start_byte(n), b=ts_node_start_byte(end);
    if (ts_node_is_null(end) || b<a) b=ts_node_end_byte(n);
    return ast_slice(ctx, a, b);
}

/* Declarator/name paths vary by language. Only syntax leaf identifiers may
 * establish a declaration name; arbitrary source text is never a fallback. */
static TSNode name_leaf(TSNode n) {
    if (ts_node_is_null(n)) return n;
    const char *t=ts_node_type(n);
    if (!strcmp(t,"identifier") || !strcmp(t,"field_identifier") ||
        !strcmp(t,"type_identifier") || !strcmp(t,"namespace_identifier") ||
        !strcmp(t,"property_identifier")) return n;
    TSNode d=field(n,"declarator");
    if (!ts_node_is_null(d)) return name_leaf(d);
    d=field(n,"name");
    if (!ts_node_is_null(d)) return name_leaf(d);
    /* Qualified C++ names and Rust scoped names resolve to the terminal. */
    for (int i=(int)ts_node_named_child_count(n)-1;i>=0;i--) {
        d=name_leaf(named(n,(unsigned)i));
        if (!ts_node_is_null(d)) return d;
    }
    return (TSNode){0};
}

static char *qualified(const char *parent, const char *name) {
    if (!name) return NULL;
    if (!parent || !*parent) return xstrdup(name);
    size_t a=strlen(parent), b=strlen(name);
    char *s=xmalloc(a+b+3);
    memcpy(s,parent,a); memcpy(s+a,"::",2); memcpy(s+a+2,name,b+1);
    return s;
}

static int known_type(AstContext *ctx, TSNode type_node) {
    TSNode leaf=name_leaf(type_node);
    char *name=copy_text(ctx,leaf);
    if (!name) return -1;
    int found=-1;
    SemResult *r=&ctx->result->sem;
    for (int i=0;i<r->nsymbols;i++) {
        SemSymbol *s=&r->symbols[i];
        if (strcmp(s->name,name) ||
            (strcmp(s->kind,"class") && strcmp(s->kind,"struct") &&
             strcmp(s->kind,"interface") && strcmp(s->kind,"trait"))) continue;
        if (found>=0) { found=-1; break; }
        found=i;
    }
    free(name);
    return found;
}

static int symbol(AstContext *ctx, TSNode n, TSNode name_node,
                  const char *kind, int owner, bool decl, TSNode body) {
    if (ts_node_is_null(name_node)) return -1;
    char *name=copy_text(ctx,name_node);
    if (!name || !*name) { free(name); return -1; }
    SemResult *r=&ctx->result->sem;
    SemSymbol *s=sem_symbol_add(r,name,kind,span(n));
    int index=r->nsymbols-1;
    s->parent=owner;
    s->legacy_def=-1;
    s->declaration=decl;
    s->qualified_name=qualified(owner>=0 ? r->symbols[owner].qualified_name : NULL,name);
    s->signature=slice_until(ctx,n,body);
    if (!strcmp(ctx->language,"go") && name[0]>='A' && name[0]<='Z')
        s->exported=true;
    TSNode result=field(n,"return_type");
    if (ts_node_is_null(result)) result=field(n,"result");
    s->result_type=copy_text(ctx,result);
    s->generic_params=copy_text(ctx,field(n,"type_parameters"));
    TSNode previous=ts_node_prev_named_sibling(n);
    if (!ts_node_is_null(previous) && strstr(ts_node_type(previous),"comment") &&
        ts_node_end_point(previous).row+1 >= ts_node_start_point(n).row)
        s->documentation=copy_text(ctx,previous);
    unsigned count=ts_node_named_child_count(n);
    for (unsigned i=0;i<count;i++) {
        TSNode c=named(n,i);
        if (is(c,"visibility_modifier")) {
            s->visibility=copy_text(ctx,c); s->exported=true; break;
        }
        if (is(c,"storage_class_specifier")) {
            char *modifier=copy_text(ctx,c);
            if (modifier && !strcmp(modifier,"static")) {
                s->visibility=xstrdup("file"); s->exported=false;
            }
            s->modifiers=modifier;
        }
    }
    free(name);
    return index;
}

static void type_fact(AstContext *ctx, TSNode n, const char *kind,
                      int owner, const char *name, TSNode value) {
    if (!name || ts_node_is_null(value)) return;
    char *v=copy_text(ctx,value);
    if (!v || !*v) { free(v); return; }
    SemTypeFact *f=sem_type_fact_add(&ctx->result->sem,name,kind,span(n));
    f->owner=owner; f->value=v; f->evidence=xstrdup("syntax");
}

static void binding(AstContext *ctx, TSNode n, const char *kind,
                    TSNode module_node, TSNode local_node, bool system) {
    if (ts_node_is_null(module_node)) return;
    char *module=copy_text(ctx,module_node);
    char *local=copy_text(ctx,local_node);
    if (!module) { free(local); return; }
    size_t len=strlen(module);
    if (len>=2 && ((module[0]=='"' && module[len-1]=='"') ||
                   (module[0]=='<' && module[len-1]=='>'))) {
        memmove(module,module+1,len-2); module[len-2]=0;
    }
    SemBinding *b=sem_binding_add(&ctx->result->sem,module,local,span(n));
    b->kind=xstrdup(kind); b->is_system=system;
    b->owner=-1; b->evidence=xstrdup("syntax");
    if (local && *local) b->original_name=xstrdup(local);
    free(module); free(local);
}

static void ref(AstContext *ctx, TSNode n, TSNode target, const char *kind,
                int owner, TSNode qualifier) {
    TSNode leaf=name_leaf(target);
    if (ts_node_is_null(leaf)) return;
    char *name=copy_text(ctx,leaf);
    if (!name || !*name) { free(name); return; }
    SemReference *r=sem_reference_add(&ctx->result->sem,name,kind,span(n));
    r->owner=owner; r->target=-1; r->legacy_ref=-1; r->argc=-1;
    r->strategy=xstrdup("syntax"); r->evidence=xstrdup("syntax");
    r->qualifier=copy_text(ctx,qualifier);
    free(name);
}

static TSNode child_type(TSNode n, const char *type) {
    unsigned count=ts_node_named_child_count(n);
    for (unsigned i=0;i<count;i++) {
        TSNode c=named(n,i);
        if (is(c,type)) return c;
    }
    return (TSNode){0};
}

static bool inside_error(TSNode n) {
    for (TSNode p=n;!ts_node_is_null(p);p=ts_node_parent(p))
        if (ts_node_is_error(p) || ts_node_is_missing(p)) return true;
    return false;
}

static TSNode callee_qualifier(TSNode n) {
    const char *t=ts_node_type(n);
    if (!strcmp(t,"field_expression") || !strcmp(t,"selector_expression") ||
        !strcmp(t,"member_expression") || !strcmp(t,"qualified_identifier") ||
        !strcmp(t,"scoped_identifier")) {
        TSNode q=field(n,"argument");
        if (ts_node_is_null(q)) q=field(n,"operand");
        if (ts_node_is_null(q)) q=field(n,"object");
        if (ts_node_is_null(q)) q=field(n,"scope");
        return q;
    }
    return (TSNode){0};
}

static TSNode objc_name(TSNode n) {
    TSNode d=child_type(n,"identifier");
    if (!ts_node_is_null(d)) return d;
    d=child_type(n,"keyword_declarator");
    if (!ts_node_is_null(d)) return name_leaf(d);
    return (TSNode){0};
}

static TSNode first_named(TSNode n) { return named(n,0); }

static TSNode find_table(TSNode n, const char *table, AstContext *ctx,
                         int depth, unsigned *visited) {
    if (depth>128 || ts_node_is_null(n) || ++*visited>100000 ||
        (ctx->cancel_flag && *ctx->cancel_flag)) return (TSNode){0};
    if (is(n,"init_declarator")) {
        TSNode d=field(n,"declarator"), v=field(n,"value");
        char *name=copy_text(ctx,name_leaf(d));
        bool match=name && !strcmp(name,table) && is(v,"initializer_list");
        free(name);
        if (match) return v;
    }
    unsigned count=ts_node_named_child_count(n);
    for (unsigned i=0;i<count;i++) {
        TSNode got=find_table(named(n,i),table,ctx,depth+1,visited);
        if (!ts_node_is_null(got)) return got;
    }
    return (TSNode){0};
}

static void native_registration(AstContext *ctx, TSNode call, int owner) {
    TSNode callee=field(call,"function"), args=field(call,"arguments");
    if (!is(callee,"identifier") || !is(args,"argument_list")) return;
    char *name=copy_text(ctx,callee);
    bool recognized=name && !strcmp(name,"RegisterNatives");
    free(name);
    if (!recognized || ts_node_named_child_count(args)<3) return;
    TSNode arg=named(args,2);
    if (!is(arg,"identifier")) return;
    char *table=copy_text(ctx,arg);
    unsigned visited=0;
    TSNode init=find_table(ctx->root,table,ctx,0,&visited);
    free(table);
    if (ts_node_is_null(init)) return;
    unsigned rows=ts_node_named_child_count(init);
    for (unsigned i=0;i<rows && i<256;i++) {
        TSNode row=named(init,i);
        if (!is(row,"initializer_list") || ts_node_named_child_count(row)<3)
            continue;
        TSNode key_node=named(row,0), target=named(row,2);
        if (!is(key_node,"string_literal") || !is(target,"cast_expression"))
            continue;
        target=field(target,"value");
        if (!is(target,"identifier")) continue;
        char *key=copy_text(ctx,key_node);
        size_t len=key?strlen(key):0;
        if (len>=2 && key[0]=='"' && key[len-1]=='"') {
            key[len-1]=0;
            type_fact(ctx,row,"native_bridge_registration",owner,key+1,target);
        }
        free(key);
    }
}

static void extract_node(AstContext *ctx, TSNode n, int owner, int depth) {
    if (ctx->cancel_flag && *ctx->cancel_flag) { ctx->cancelled=true; return; }
    if (depth>256 || ++ctx->visited>2000000) { ctx->truncated=true; return; }
    if (ctx->cancelled || ctx->truncated) return;
    if (ts_node_is_error(n)) ctx->errors++;
    if (ts_node_is_missing(n)) ctx->missing++;
    if (inside_error(n)) return; /* recovery is represented by parser coverage */
    const char *lang=ctx->language, *t=ts_node_type(n);
    bool c_family=!strcmp(lang,"c") || !strcmp(lang,"cpp") || !strcmp(lang,"objc");
    bool go=!strcmp(lang,"go"), rust=!strcmp(lang,"rust"), objc=!strcmp(lang,"objc");
    int next_owner=owner;
    TSNode body=field(n,"body"), name=(TSNode){0};

    if (c_family) {
        if (!strcmp(t,"function_definition")) {
            TSNode d=field(n,"declarator"); name=name_leaf(d);
            int method_owner=owner;
            TSNode q=field(d,"declarator");
            if (is(q,"qualified_identifier")) {
                int matched=known_type(ctx,field(q,"scope"));
                if (matched>=0) method_owner=matched;
            }
            const char *kind=method_owner>=0 &&
                (!strcmp(ctx->result->sem.symbols[method_owner].kind,"class") ||
                 !strcmp(ctx->result->sem.symbols[method_owner].kind,"struct"))
                ?"method":"function";
            next_owner=symbol(ctx,n,name,kind,method_owner,false,body);
            if (next_owner>=0) type_fact(ctx,n,"returns",next_owner,"return",field(n,"type"));
        } else if (!strcmp(t,"namespace_definition")) {
            name=field(n,"name"); next_owner=symbol(ctx,n,name,"namespace",owner,false,body);
        } else if (!strcmp(t,"class_specifier") || !strcmp(t,"struct_specifier") ||
                   !strcmp(t,"union_specifier") || !strcmp(t,"enum_specifier")) {
            name=field(n,"name");
            if (!ts_node_is_null(body)) {
                next_owner=symbol(ctx,n,name,!strcmp(t,"class_specifier")?"class":
                    !strcmp(t,"enum_specifier")?"enum":"struct",owner,false,body);
                if (next_owner>=0) type_fact(ctx,n,"inherits",next_owner,"base",child_type(n,"base_class_clause"));
            }
        } else if (!strcmp(t,"preproc_include")) {
            TSNode path=field(n,"path"); char *v=copy_text(ctx,path);
            bool system=v && v[0]=='<';
            binding(ctx,n,"include",path,(TSNode){0},system); free(v);
        } else if (!strcmp(t,"import_declaration")) {
            TSNode module=field(n,"name");
            if (ts_node_is_null(module)) module=field(n,"header");
            binding(ctx,n,"import",module,(TSNode){0},false);
        } else if (objc && !strcmp(t,"module_import")) {
            binding(ctx,n,"import",field(n,"path"),(TSNode){0},false);
        } else if (!strcmp(t,"preproc_def") || !strcmp(t,"preproc_function_def")) {
            name=field(n,"name"); next_owner=symbol(ctx,n,name,"macro",owner,false,(TSNode){0});
            if (next_owner>=0) type_fact(ctx,n,"macro_boundary",next_owner,"expansion",n);
        } else if (!strcmp(t,"declaration") && !ts_node_is_null(field(n,"declarator"))) {
            TSNode d=field(n,"declarator");
            if (is(d,"function_declarator") || is(d,"pointer_declarator")) {
                TSNode f=is(d,"function_declarator")?d:child_type(d,"function_declarator");
                if (!ts_node_is_null(f)) {
                    name=name_leaf(f);
                    next_owner=symbol(ctx,n,name,"function",owner,true,(TSNode){0});
                    if (next_owner>=0) type_fact(ctx,n,"returns",next_owner,"return",field(n,"type"));
                }
            }
            if (next_owner==owner && !ts_node_is_null(d)) {
                TSNode value=field(n,"value");
                if (ts_node_is_null(value)) value=field(d,"value");
                if (is(value,"identifier") || is(value,"qualified_identifier")) {
                    TSNode var=name_leaf(d); char *varname=copy_text(ctx,var);
                    type_fact(ctx,n,"function_value",owner,varname,value); free(varname);
                }
                if (is(value,"initializer_list")) {
                    TSNode var=name_leaf(d);
                    next_owner=symbol(ctx,d,var,"variable",owner,false,value);
                }
            }
        } else if (!strcmp(t,"initializer_pair")) {
            TSNode designator=field(n,"designator"), value=field(n,"value");
            if (owner>=0 && is(value,"identifier") && !ts_node_is_null(designator)) {
                char *slot=copy_text(ctx,name_leaf(designator));
                char *table=ctx->result->sem.symbols[owner].name;
                if (slot && table) {
                    size_t cap=strlen(table)+strlen(slot)+2;
                    char *key=xmalloc(cap); snprintf(key,cap,"%s.%s",table,slot);
                    type_fact(ctx,n,"pointer_slot",owner,key,value); free(key);
                }
                free(slot);
            }
        } else if (!strcmp(t,"pointer_declarator")) {
            TSNode leaf=name_leaf(n);
            char *nm=copy_text(ctx,leaf);
            type_fact(ctx,n,"pointer",owner,nm,n);
            free(nm);
        } else if (objc && (!strcmp(t,"class_interface") ||
                           !strcmp(t,"class_implementation") || !strcmp(t,"protocol_declaration"))) {
            name=objc_name(n); next_owner=symbol(ctx,n,name,
                !strcmp(t,"protocol_declaration")?"interface":"class",owner,false,body);
            if (next_owner>=0) type_fact(ctx,n,"inherits",next_owner,"base",field(n,"superclass"));
        } else if (objc && (!strcmp(t,"method_definition") || !strcmp(t,"method_declaration"))) {
            name=objc_name(n); next_owner=symbol(ctx,n,name,"method",owner,
                !strcmp(t,"method_declaration"),body);
        } else if (objc && !strcmp(t,"message_expression")) {
            ref(ctx,n,field(n,"method"),"call",owner,field(n,"receiver"));
        }
    } else if (go) {
        if (!strcmp(t,"function_declaration") || !strcmp(t,"method_declaration")) {
            name=field(n,"name");
            int method_owner=owner;
            if (!strcmp(t,"method_declaration")) {
                TSNode receiver=field(n,"receiver");
                TSNode param=first_named(receiver), ty=field(param,"type");
                int matched=known_type(ctx,ty);
                if (matched>=0) method_owner=matched;
            }
            next_owner=symbol(ctx,n,name,
                !strcmp(t,"method_declaration")?"method":"function",method_owner,false,body);
            if (next_owner>=0) {
                type_fact(ctx,n,"returns",next_owner,"return",field(n,"result"));
                type_fact(ctx,n,"receiver",next_owner,"receiver",field(n,"receiver"));
            }
        } else if (!strcmp(t,"type_spec") || !strcmp(t,"type_alias")) {
            name=field(n,"name"); TSNode ty=field(n,"type");
            const char *kind=is(ty,"interface_type")?"interface":is(ty,"struct_type")?"struct":"type";
            next_owner=symbol(ctx,n,name,kind,owner,false,ty);
            if (next_owner>=0) type_fact(ctx,n,"type",next_owner,"underlying",ty);
        } else if (!strcmp(t,"method_spec")) {
            name=field(n,"name");
            next_owner=symbol(ctx,n,name,"method",owner,true,(TSNode){0});
        } else if (!strcmp(t,"import_spec")) {
            binding(ctx,n,"import",field(n,"path"),field(n,"name"),false);
        } else if (!strcmp(t,"var_spec") || !strcmp(t,"const_spec")) {
            TSNode value=field(n,"value"), n0=field(n,"name");
            if (ts_node_is_null(n0)) n0=first_named(n);
            if (is(value,"identifier") || is(value,"selector_expression")) {
                char *v=copy_text(ctx,n0);
                type_fact(ctx,n,"function_value",owner,v,value); free(v);
            }
        }
    } else if (rust) {
        if (!strcmp(t,"function_item") || !strcmp(t,"function_signature_item")) {
            name=field(n,"name"); next_owner=symbol(ctx,n,name,owner>=0?"method":"function",
                owner,!strcmp(t,"function_signature_item"),body);
            if (next_owner>=0) type_fact(ctx,n,"returns",next_owner,"return",field(n,"return_type"));
        } else if (!strcmp(t,"impl_item")) {
            TSNode ty=field(n,"type"); name=name_leaf(ty);
            next_owner=symbol(ctx,n,name,"impl",owner,false,body);
            if (next_owner>=0) {
                type_fact(ctx,n,"implements",next_owner,"trait",field(n,"trait"));
                type_fact(ctx,n,"type",next_owner,"self",ty);
            }
        } else if (!strcmp(t,"trait_item") || !strcmp(t,"struct_item") ||
                   !strcmp(t,"enum_item") || !strcmp(t,"mod_item") ||
                   !strcmp(t,"type_item")) {
            name=field(n,"name"); const char *kind=!strcmp(t,"trait_item")?"trait":
                !strcmp(t,"struct_item")?"struct":!strcmp(t,"enum_item")?"enum":
                !strcmp(t,"mod_item")?"module":"type";
            next_owner=symbol(ctx,n,name,kind,owner,false,body);
            if (next_owner>=0 && !strcmp(t,"trait_item"))
                type_fact(ctx,n,"inherits",next_owner,"bounds",field(n,"bounds"));
        } else if (!strcmp(t,"use_declaration")) {
            binding(ctx,n,"use",field(n,"argument"),(TSNode){0},false);
        } else if (!strcmp(t,"extern_crate_declaration")) {
            binding(ctx,n,"extern",field(n,"name"),(TSNode){0},false);
        } else if (!strcmp(t,"macro_invocation")) {
            ref(ctx,n,field(n,"macro"),"macro",owner,(TSNode){0});
            type_fact(ctx,n,"macro_boundary",owner,"invocation",n);
        } else if (!strcmp(t,"let_declaration")) {
            TSNode p=field(n,"pattern"), v=field(n,"value");
            if (is(v,"identifier") || is(v,"scoped_identifier")) {
                char *nm=copy_text(ctx,p);
                type_fact(ctx,n,"function_value",owner,nm,v); free(nm);
            }
        }
    }

    if (!strcmp(t,"call_expression")) {
        TSNode callee=field(n,"function");
        ref(ctx,n,callee,"call",owner,callee_qualifier(callee));
        if (c_family) native_registration(ctx,n,owner);
        if (is(callee,"field_expression")) {
            TSNode table=field(callee,"argument"), slot=field(callee,"field");
            char *a=copy_text(ctx,table), *b=copy_text(ctx,slot);
            if (a && b) {
                size_t cap=strlen(a)+strlen(b)+2;
                char *key=xmalloc(cap); snprintf(key,cap,"%s.%s",a,b);
                type_fact(ctx,n,"pointer_call",owner,key,callee); free(key);
            }
            free(a); free(b);
        }
    }
    if (!strcmp(t,"assignment_expression") || !strcmp(t,"assignment_statement") ||
        !strcmp(t,"short_var_declaration")) {
        TSNode left=field(n,"left"), right=field(n,"right");
        if (is(right,"identifier") || is(right,"qualified_identifier") ||
            is(right,"selector_expression") || is(right,"scoped_identifier")) {
            char *nm=copy_text(ctx,name_leaf(left));
            type_fact(ctx,n,"value_binding",owner,nm,right);
            free(nm);
        }
    }
    if (next_owner<0) next_owner=owner;
    unsigned count=ts_node_named_child_count(n);
    for (unsigned i=0;i<count;i++) {
        TSNode c=named(n,i);
        /* A declaration's name is already captured; nested calls in bodies
         * still receive their lexical owner. */
        extract_node(ctx,c,next_owner,depth+1);
    }
}

static void systems_extract(AstContext *ctx) {
    extract_node(ctx,ctx->root,-1,0);
}

void ast_systems_register(void) {
    static const AstAdapter adapters[]={
        {"c",tree_sitter_c,systems_extract},
        {"cpp",tree_sitter_cpp,systems_extract},
        {"objc",tree_sitter_objc,systems_extract},
        {"go",tree_sitter_go,systems_extract},
        {"rust",tree_sitter_rust,systems_extract},
    };
    for (size_t i=0;i<sizeof adapters/sizeof adapters[0];i++)
        ast_register(&adapters[i]);
}
