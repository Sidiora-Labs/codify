/* Grammar-backed structural extraction for scripting and configuration files.
 * Only syntax nodes can create facts: text inside strings and comments is inert.
 */
#include "ast.h"
#include "semantic.h"
#include <string.h>
#include <stdlib.h>

extern const TSLanguage *tree_sitter_lua(void);
extern const TSLanguage *tree_sitter_luau(void);
extern const TSLanguage *tree_sitter_r(void);
extern const TSLanguage *tree_sitter_erlang(void);
extern const TSLanguage *tree_sitter_solidity(void);
extern const TSLanguage *tree_sitter_hcl(void);
extern const TSLanguage *tree_sitter_nix(void);

static int is(TSNode n, const char *type) {
    return !ts_node_is_null(n) && !strcmp(ts_node_type(n), type);
}
static TSNode named(TSNode n, unsigned i) { return ts_node_named_child(n, i); }
static SemSpan span(TSNode n) {
    TSPoint a=ts_node_start_point(n), b=ts_node_end_point(n);
    return (SemSpan){.line=(int)a.row+1,.column=(int)a.column,
        .end_line=(int)b.row+1,.end_column=(int)b.column,
        .start_byte=ts_node_start_byte(n),.end_byte=ts_node_end_byte(n)};
}
static TSNode first_named(TSNode n) { return named(n,0); }
/* ast_walk visits named nodes in source order. An active declaration owns
 * descendants until its source span ends. Each declaration is pushed and
 * popped once, including a file with many top-level siblings. */
typedef struct { int active[512]; unsigned depth; } ExtendedState;
static int enclosing(AstContext *c, ExtendedState *state, TSNode n) {
    uint32_t start=ts_node_start_byte(n),end=ts_node_end_byte(n);
    while(state->depth) {
        SemSpan span=c->result->sem.symbols[state->active[state->depth-1]].span;
        if(span.start_byte<=start && span.end_byte>=end)break;
        state->depth--;
    }
    return state->depth?state->active[state->depth-1]:-1;
}
static void unquote(char *text) {
    if(!text)return;
    size_t n=strlen(text);
    if(n>1 && text[0]=='"' && text[n-1]=='"') {
        memmove(text,text+1,n-2);text[n-2]=0;
    }
}
static void add_symbol(AstContext *c, TSNode whole, TSNode id,
                       const char *kind, TSNode signature, int parent) {
    if(ts_node_is_null(id))return;
    char *name=ast_text(c,id);
    if(!name || !*name){free(name);return;}
    unquote(name);
    SemSymbol *s=sem_symbol_add(&c->result->sem,name,kind,span(whole));
    if(s) {
        s->parent=parent;
        if(!ts_node_is_null(signature))s->signature=ast_text(c,signature);
        if(s->parent>=0) {
            const char *p=c->result->sem.symbols[s->parent].qualified_name;
            if(!p)p=c->result->sem.symbols[s->parent].name;
            if(p){size_t len=strlen(p)+strlen(name)+2; s->qualified_name=malloc(len);
                if(s->qualified_name)snprintf(s->qualified_name,len,"%s.%s",p,name);}
        }
        if(!s->qualified_name)s->qualified_name=strdup(name);
    }
    free(name);
}
static void add_ref(AstContext *c, TSNode node, TSNode id,
                    const char *kind, int owner) {
    if(ts_node_is_null(id))return;
    char *name=ast_text(c,id);
    if(!name || !*name){free(name);return;}
    SemReference *r=sem_reference_add(&c->result->sem,name,kind,span(id));
    if(r) { r->owner=owner; r->strategy=strdup("syntax");
        r->evidence=strdup(ts_node_type(node)); }
    free(name);
}
/* Keep only statically named identifiers; expression calls remain an explicit
 * boundary until receiver resolution can establish their target. */
static TSNode simple_id(TSNode node) {
    for(unsigned depth=0;depth<32 && !ts_node_is_null(node);depth++) {
        const char *t=ts_node_type(node);
        if(!strcmp(t,"identifier")||!strcmp(t,"name")||!strcmp(t,"atom"))return node;
        if(strcmp(t,"variable_expression") && strcmp(t,"variable_expr") &&
           strcmp(t,"exp_wrap") && strcmp(t,"expression") && strcmp(t,"var"))break;
        TSNode child=ast_field(node,"variable_name");
        node=ts_node_is_null(child)?first_named(node):child;
    }
    return (TSNode){0};
}
static bool visit(AstContext *c, TSNode n, void *unused) {
    ExtendedState *state=unused;
    int owner=enclosing(c,state,n);
    const char *lang=c->language,*t=ts_node_type(n);
    TSNode id={0},sig={0}; const char *kind=NULL;
    if(!strcmp(lang,"lua")) {
        if(!strcmp(t,"function_declaration")) {id=ast_field(n,"name");kind="function";sig=ast_field(n,"parameters");}
        else if(!strcmp(t,"variable_declaration")) {
            TSNode v=first_named(n); if(is(v,"assignment_statement"))v=first_named(v);
            id=first_named(v);kind="variable";
        } else if(!strcmp(t,"function_call")) add_ref(c,n,simple_id(ast_field(n,"name")),"call",owner);
    } else if(!strcmp(lang,"luau")) {
        if(!strcmp(t,"fn_stmt")||!strcmp(t,"local_fn_stmt")||!strcmp(t,"type_fn_stmt")) {
            id=ast_field(n,"method_name");if(ts_node_is_null(id))id=ast_field(n,"function_name");
            kind=ts_node_is_null(ast_field(n,"method_name"))?"function":"method";
            sig=n;
        } else if(!strcmp(t,"type_stmt")) {id=ast_field(n,"left");kind="type";}
        else if(!strcmp(t,"local_var_stmt")) {
            TSNode list=first_named(n); TSNode bind=first_named(list);
            id=ast_field(bind,"variable_name");kind="variable";
        } else if(!strcmp(t,"call_stmt")) {
            id=ast_field(n,"method_name");if(ts_node_is_null(id))id=simple_id(ast_field(n,"invoked"));
            add_ref(c,n,id,"call",owner);
        }
    } else if(!strcmp(lang,"r")) {
        if(!strcmp(t,"binary_operator")) {
            TSNode op=ast_field(n,"operator"), lhs=ast_field(n,"lhs"),rhs=ast_field(n,"rhs");
            char *o=ast_text(c,op);
            if(o && (!strcmp(o,"<-")||!strcmp(o,"=")||!strcmp(o,"<<-")) && is(lhs,"identifier")) {
                id=lhs;kind=is(rhs,"function_definition")?"function":"variable";sig=rhs;
            }
            free(o);
        } else if(!strcmp(t,"call"))add_ref(c,n,simple_id(ast_field(n,"function")),"call",owner);
    } else if(!strcmp(lang,"erlang")) {
        if(!strcmp(t,"module_attribute")) {id=ast_field(n,"name");kind="module";}
        else if(!strcmp(t,"function_clause")) {id=ast_field(n,"name");kind="function";sig=ast_field(n,"args");}
        else if(!strcmp(t,"record_decl")) {id=ast_field(n,"name");kind="record";}
        else if(!strcmp(t,"call"))add_ref(c,n,simple_id(ast_field(n,"expr")),"call",owner);
    } else if(!strcmp(lang,"solidity")) {
        if(!strcmp(t,"contract_declaration")){id=ast_field(n,"name");kind="contract";}
        else if(!strcmp(t,"function_definition")){id=ast_field(n,"name");kind="function";sig=n;}
        else if(!strcmp(t,"event_definition")){id=ast_field(n,"name");kind="event";}
        else if(!strcmp(t,"modifier_definition")){id=ast_field(n,"name");kind="modifier";}
        else if(!strcmp(t,"state_variable_declaration")){id=ast_field(n,"name");kind="variable";}
        else if(!strcmp(t,"call_expression"))add_ref(c,n,simple_id(ast_field(n,"function")),"call",owner);
    } else if(!strcmp(lang,"terraform")) {
        if(!strcmp(t,"block")) {
            TSNode head=first_named(n),label=named(n,1);
            if(is(head,"block_start")){head=first_named(head);label=named(first_named(n),1);}
            if(!ts_node_is_null(label) && (is(label,"identifier")||is(label,"string_lit"))){id=label;kind="block";}
        } else if(!strcmp(t,"attribute")) {id=first_named(n);kind="attribute";}
        else if(!strcmp(t,"function_call")) add_ref(c,n,simple_id(first_named(n)),"call",owner);
        else if(!strcmp(t,"variable_expr"))add_ref(c,n,simple_id(first_named(n)),"reference",owner);
    } else if(!strcmp(lang,"nix")) {
        if(!strcmp(t,"binding")) {
            TSNode path=ast_field(n,"attrpath"),value=ast_field(n,"expression");
            id=first_named(path); if(is(id,"identifier"))kind=is(value,"function_expression")?"function":"attribute";
        } else if(!strcmp(t,"apply_expression"))add_ref(c,n,simple_id(ast_field(n,"function")),"call",owner);
        else if(!strcmp(t,"variable_expression"))add_ref(c,n,simple_id(ast_field(n,"name")),"reference",owner);
    }
    if(kind) {
        int before=c->result->sem.nsymbols;
        add_symbol(c,n,id,kind,sig,owner);
        if(c->result->sem.nsymbols>before) {
            SemSymbol *symbol=&c->result->sem.symbols[before];
            if(state->depth<sizeof state->active/sizeof state->active[0])
                state->active[state->depth++]=before;
            else c->truncated=true;
            if(!strcmp(lang,"solidity")) {
                TSNode result=ast_field(n,"return_type");
                if(!ts_node_is_null(result))symbol->result_type=ast_text(c,result);
                TSTreeCursor cursor=ts_tree_cursor_new(n);
                unsigned scanned=0;
                if(ts_tree_cursor_goto_first_child(&cursor)) do {
                    if(c->cancel_flag && *c->cancel_flag){c->cancelled=true;break;}
                    if(++scanned>500000u){c->truncated=true;break;}
                    TSNode child=ts_tree_cursor_current_node(&cursor);
                    if(is(child,"visibility"))symbol->visibility=ast_text(c,child);
                    else if(is(child,"inheritance_specifier")) {
                        TSNode ancestor=ast_field(child,"ancestor");
                        char *target=ast_text(c,ancestor);
                        if(target && *target) {
                            SemTypeFact *fact=sem_type_fact_add(&c->result->sem,target,
                                                                 "inherits",span(child));
                            if(fact) {fact->owner=before;fact->value=strdup(target);
                                fact->evidence=strdup("inheritance_specifier");}
                        }
                        free(target);
                    }
                } while(ts_tree_cursor_goto_next_sibling(&cursor));
                ts_tree_cursor_delete(&cursor);
            } else if(!strcmp(lang,"terraform") && !strcmp(t,"block")) {
                TSNode head=first_named(n),label=named(n,1),instance=named(n,2);
                if(is(head,"block_start")) {
                    head=first_named(head);label=named(first_named(n),1);
                    instance=named(first_named(n),2);
                }
                char *type=ast_text(c,head),*l=ast_text(c,label),*v=ast_text(c,instance);
                unquote(l);unquote(v);
                if(type && l) {
                    size_t cap=strlen(type)+strlen(l)+(v?strlen(v):0)+4;
                    char *q=malloc(cap);
                    if(q){snprintf(q,cap,"%s.%s%s%s",type,l,v?".":"",v?v:"");
                        free(symbol->qualified_name);symbol->qualified_name=q;}
                }
                free(type);free(l);free(v);
            }
        }
    }
    return true;
}
static void extract(AstContext *ctx) {
    if(!ctx->result->sem.parser_id) {
        size_t n=strlen(ctx->language)+24;
        ctx->result->sem.parser_id=malloc(n);
        if(ctx->result->sem.parser_id)
            snprintf(ctx->result->sem.parser_id,n,"tree-sitter/%s/extended",ctx->language);
    }
    ExtendedState state={0};
    ast_walk(ctx,ctx->root,visit,&state);
}

void ast_extended_register(void) {
    static const AstAdapter adapters[]={
        {"lua",tree_sitter_lua,extract},{"luau",tree_sitter_luau,extract},
        {"r",tree_sitter_r,extract},{"erlang",tree_sitter_erlang,extract},
        {"solidity",tree_sitter_solidity,extract},{"terraform",tree_sitter_hcl,extract},
        {"nix",tree_sitter_nix,extract}
    };
    for(size_t i=0;i<sizeof adapters/sizeof adapters[0];i++)ast_register(&adapters[i]);
}
