/* Native JavaScript, TypeScript and JSX/TSX syntax extraction. */
#include "ast.h"
#include "semantic.h"
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

extern const TSLanguage *tree_sitter_javascript(void);
extern const TSLanguage *tree_sitter_typescript(void);
extern const TSLanguage *tree_sitter_tsx(void);

static bool is(TSNode n, const char *type) {
    return !ts_node_is_null(n) && strcmp(ts_node_type(n), type) == 0;
}
static SemSpan span(TSNode n) {
    TSPoint a = ts_node_start_point(n), b = ts_node_end_point(n);
    return (SemSpan){(int)a.row+1, (int)a.column, (int)b.row+1,
                     (int)b.column, ts_node_start_byte(n), ts_node_end_byte(n)};
}
static char *text(AstContext *c, TSNode n) {
    return ts_node_is_null(n) ? NULL : ast_text(c, n);
}
static char *unquote(AstContext *c, TSNode n) {
    char *s = text(c,n);
    if (!s) return NULL;
    size_t z = strlen(s);
    if (z >= 2 && (s[0] == '\'' || s[0] == '"' || s[0] == '`') && s[z-1] == s[0]) {
        memmove(s,s+1,z-2); s[z-2]=0;
    }
    return s;
}
static char *head(AstContext *c, TSNode n, TSNode body) {
    uint32_t end = ts_node_is_null(body) ? ts_node_end_byte(n) : ts_node_start_byte(body);
    if (end - ts_node_start_byte(n) > 8192) end = ts_node_start_byte(n)+8192;
    return ast_slice(c,ts_node_start_byte(n),end);
}
static char *qualified(SemResult *r, int parent, const char *name) {
    if (parent < 0 || !r->symbols[parent].qualified_name) return strdup(name);
    const char *p = r->symbols[parent].qualified_name;
    size_t n = strlen(p)+strlen(name)+2;
    char *q = malloc(n);
    if (q) snprintf(q,n,"%s.%s",p,name);
    return q;
}
static bool contains_word(const char *s, const char *word) {
    if (!s) return false;
    size_t n=strlen(word);
    for (const char *p=s;(p=strstr(p,word));p++)
        if ((p==s || !(isalnum((unsigned char)p[-1]) || p[-1]=='_')) &&
            !(isalnum((unsigned char)p[n]) || p[n]=='_')) return true;
    return false;
}
static char *decorator_target(AstContext *c, TSNode decorator) {
    TSNode expr=ts_node_named_child(decorator,0);
    if (is(expr,"call_expression")) expr=ast_field(expr,"function");
    if (!is(expr,"identifier") && !is(expr,"member_expression")) return NULL;
    char *target=text(c,expr);
    if (!target || !*target || strlen(target)>255) { free(target); return NULL; }
    return target;
}
static int symbol(AstContext *c, TSNode n, TSNode name, const char *kind,
                  int parent, bool exported, TSNode body) {
    char *sname = text(c,name);
    if (!sname || !*sname || strlen(sname)>512) { free(sname); return parent; }
    SemResult *r=&c->result->sem;
    SemSymbol *s=sem_symbol_add(r,sname,kind,span(n));
    if (!s) { free(sname); return parent; }
    int index=r->nsymbols-1;
    s->parent=parent; s->exported=exported;
    s->qualified_name=qualified(r,parent,sname);
    s->signature=head(c,n,body);
    s->scope_key=s->qualified_name ? strdup(s->qualified_name) : NULL;
    char *prefix=ast_slice(c,ts_node_start_byte(n),ts_node_start_byte(name));
    static const char *mods[]={"async","static","abstract","readonly","override","declare"};
    char modbuf[96]={0};
    for (size_t m=0;m<sizeof(mods)/sizeof(mods[0]);m++) {
        if (!contains_word(prefix,mods[m])) continue;
        if (*modbuf) strcat(modbuf,",");
        strcat(modbuf,mods[m]);
    }
    if (*modbuf) s->modifiers=strdup(modbuf);
    free(prefix);
    TSNode gp=ast_field(n,"type_parameters"), rt=ast_field(n,"return_type");
    s->generic_params=text(c,gp); s->result_type=text(c,rt);
    if (is(name,"private_property_identifier")) s->visibility=strdup("private");
    for (uint32_t i=0;i<ts_node_named_child_count(n);i++) {
        TSNode child=ts_node_named_child(n,i);
        if (is(child,"accessibility_modifier")) {
            free(s->visibility); s->visibility=text(c,child);
        }
        if (is(child,"decorator")) {
            char *d=text(c,child);
            if (d) {
                size_t a=s->decorators?strlen(s->decorators):0,b=strlen(d);
                char *v=realloc(s->decorators,a+b+2);
                if (v) { s->decorators=v; if (a) s->decorators[a++]=',';
                         memcpy(s->decorators+a,d,b+1); }
                free(d);
            }
            char *target=decorator_target(c,child);
            if (target) {
                SemTypeFact *f=sem_type_fact_add(r,s->name,"decorates",span(child));
                if (f) { f->owner=index; f->value=strdup(target);
                    f->evidence=strdup("decorator"); }
                free(target);
            }
        }
    }
    if (s->result_type) {
        SemTypeFact *f=sem_type_fact_add(r,s->name,"returns",span(rt));
        if (f) { f->owner=index; f->value=strdup(s->result_type);
            f->evidence=strdup("return_type"); }
    }
    if (s->exported) {
        SemTypeFact *f=sem_type_fact_add(r,s->name,"exports",span(name));
        if (f) { f->owner=index; f->value=strdup(s->name);
            f->evidence=strdup("export_statement"); }
    }
    free(sname);
    return index;
}
static const char *bare_call_boundary(AstContext *c, TSNode site, const char *name) {
    for (TSNode parent=ts_node_parent(site); !ts_node_is_null(parent);
         parent=ts_node_parent(parent)) {
        if (is(parent,"if_statement")) {
            TSNode condition=ast_field(parent,"condition");
            if (!ts_node_is_null(condition) &&
                ts_node_end_byte(condition)<=ts_node_start_byte(site) &&
                ts_node_end_point(condition).row==ts_node_start_point(site).row) {
                char *value=text(c,condition);
                bool local=contains_word(value,name);
                free(value);
                if (local) return "(local)";
            }
        }
        if (is(parent,"function_declaration") || is(parent,"method_definition") ||
            is(parent,"arrow_function") || is(parent,"function_expression")) {
            TSNode params=ast_field(parent,"parameters");
            char *value=text(c,params);
            bool parameter=contains_word(value,name);
            free(value);
            if (parameter) return "(param)";
            break;
        }
    }
    return NULL;
}
static void reference(AstContext *c, TSNode site, TSNode name, const char *kind,
                      int owner, const char *qualifier) {
    char *s=text(c,name);
    if (!s || !*s || strlen(s)>512) { free(s); return; }
    if (!qualifier && strcmp(kind,"call")==0)
        qualifier=bare_call_boundary(c,site,s);
    SemResult *r=&c->result->sem;
    SemReference *ref=sem_reference_add(r,s,kind,span(site));
    if (ref) {
        ref->owner=owner; ref->target=-1; ref->qualifier=qualifier?strdup(qualifier):NULL;
        ref->strategy=strdup("syntax"); ref->evidence=strdup(ts_node_type(site));
        ref->argc=-1;
    }
    free(s);
}
static void binding(AstContext *c, TSNode site, const char *module,
                    const char *local, const char *original, const char *kind,
                    const char *exported, bool is_export) {
    SemBinding *b=sem_binding_add(&c->result->sem,module,local,span(site));
    if (b) { b->original_name=original?strdup(original):NULL;
        b->kind=strdup(kind); b->exported_name=exported?strdup(exported):NULL;
        b->is_export=is_export; b->owner=-1; b->evidence=strdup("syntax"); }
}
static void imports(AstContext *c, TSNode n) {
    TSNode source=ast_field(n,"source");
    char *module=unquote(c,source);
    bool found=false;
    for (uint32_t i=0;i<ts_node_named_child_count(n);i++) {
        TSNode ch=ts_node_named_child(n,i);
        if (is(ch,"import_clause") || is(ch,"import_require_clause")) {
            for (uint32_t j=0;j<ts_node_named_child_count(ch);j++) {
                TSNode item=ts_node_named_child(ch,j);
                if (is(item,"identifier")) {
                    char *local=text(c,item);
                    binding(c,item,module,local,"default","default",NULL,false);
                    free(local); found=true;
                } else if (is(item,"namespace_import")) {
                    TSNode id=ts_node_named_child(item,0); char *local=text(c,id);
                    binding(c,item,module,local,"*","namespace",NULL,false);
                    free(local); found=true;
                } else if (is(item,"named_imports")) {
                    for (uint32_t k=0;k<ts_node_named_child_count(item);k++) {
                        TSNode spec=ts_node_named_child(item,k);
                        if (!is(spec,"import_specifier")) continue;
                        TSNode orig=ast_field(spec,"name"), alias=ast_field(spec,"alias");
                        char *o=unquote(c,orig), *a=ts_node_is_null(alias)?NULL:unquote(c,alias);
                        binding(c,spec,module,a?a:o,o,"import",NULL,false);
                        free(o); free(a); found=true;
                    }
                }
            }
        }
    }
    if (!found && module) binding(c,n,module,NULL,"*","import",NULL,false);
    free(module);
}
static bool export_context(TSNode n) {
    TSNode p=ts_node_parent(n);
    return is(p,"export_statement");
}
static void exports(AstContext *c, TSNode n) {
    TSNode source=ast_field(n,"source"), decl=ast_field(n,"declaration");
    char *module=unquote(c,source);
    bool found=false;
    for (uint32_t i=0;i<ts_node_named_child_count(n);i++) {
        TSNode item=ts_node_named_child(n,i);
        if (is(item,"export_clause")) for (uint32_t j=0;j<ts_node_named_child_count(item);j++) {
            TSNode spec=ts_node_named_child(item,j);
            TSNode name=ast_field(spec,"name"),alias=ast_field(spec,"alias");
            char *o=unquote(c,name),*a=ts_node_is_null(alias)?NULL:unquote(c,alias);
            binding(c,spec,module,o,o,module?"reexport":"export",a?a:o,true);
            free(o);free(a);found=true;
        }
        if (is(item,"namespace_export")) {
            TSNode id=ts_node_named_child(item,0); char *a=text(c,id);
            binding(c,item,module,a,"*","reexport",a,true);
            free(a);found=true;
        }
    }
    if (!ts_node_is_null(decl)) {
        TSNode dn=ast_field(decl,"name");
        if (ts_node_is_null(dn) && is(decl,"lexical_declaration")) {
            TSNode d=ts_node_named_child(decl,0);
            dn=ast_field(d,"name");
        }
        char *local=text(c,dn);
        if (local) {
            char *prefix=ast_slice(c,ts_node_start_byte(n),ts_node_start_byte(decl));
            bool def=prefix && strstr(prefix,"default")!=NULL;
            binding(c,n,NULL,local,local,"export",def?"default":local,true);
            free(prefix);free(local);found=true;
        }
    }
    if (!found && ts_node_is_null(decl)) {
        const char *kind=module?"export_all":"export";
        binding(c,n,module,NULL,module?"*":"default",kind,module?"*":"default",true);
    }
    free(module);
}
static void fact(AstContext *c, TSNode node, TSNode name,
                 const char *kind, int owner, const char *value) {
    char *s=text(c,name);
    if (!s || !*s) { free(s); return; }
    SemTypeFact *f=sem_type_fact_add(&c->result->sem,s,kind,span(node));
    if (f) { f->owner=owner; f->value=value?strdup(value):NULL;
        f->evidence=strdup(ts_node_type(node)); }
    free(s);
}
static void named_fact(AstContext *c, TSNode node, const char *name,
                       const char *kind, int owner, const char *value) {
    if (!name || !*name) return;
    SemTypeFact *f=sem_type_fact_add(&c->result->sem,name,kind,span(node));
    if (f) { f->owner=owner; f->value=value?strdup(value):NULL;
        f->evidence=strdup(ts_node_type(node)); }
}
static void heritage(AstContext *c, TSNode n, int owner) {
    for (uint32_t i=0;i<ts_node_named_child_count(n);i++) {
        TSNode ch=ts_node_named_child(n,i);
        if (!is(ch,"class_heritage")) continue;
        for (uint32_t j=0;j<ts_node_named_child_count(ch);j++) {
            TSNode rel=ts_node_named_child(ch,j);
            const char *kind=is(rel,"extends_clause")?"inherits":
                             is(rel,"implements_clause")?"implements":NULL;
            if (!kind) continue;
            for (uint32_t k=0;k<ts_node_named_child_count(rel);k++) {
                TSNode type=ts_node_named_child(rel,k);
                if (is(type,"type_arguments")) continue;
                char *value=text(c,type);
                named_fact(c,type,value,kind,owner,value);
                free(value);
            }
        }
    }
}
static bool component_name(const char *s) {
    return s && isupper((unsigned char)s[0]);
}
static bool local_path(const char *s) {
    return s && s[0]=='/' && s[1]!='/' && !strstr(s,"://");
}
static bool locally_constructed(AstContext *c, TSNode root,
                                const char *receiver, int depth, int *budget) {
    if (depth>64 || *budget<=0) return false;
    --*budget;
    if (is(root,"variable_declarator")) {
        TSNode name=ast_field(root,"name"),value=ast_field(root,"value");
        char *s=text(c,name);
        TSNode decl=ts_node_parent(root),scope=ts_node_parent(decl);
        if (is(scope,"export_statement")) scope=ts_node_parent(scope);
        bool match=s && strcmp(s,receiver)==0 && is(value,"new_expression") &&
                   is(scope,"program");
        free(s);
        if (match) return true;
    }
    for (uint32_t i=0;i<ts_node_named_child_count(root);i++)
        if (locally_constructed(c,ts_node_named_child(root,i),receiver,depth+1,budget))
            return true;
    return false;
}
static int declaration_count(AstContext *c, TSNode root,
                             const char *name, int depth, int *budget) {
    if (depth>64 || *budget<=0) return 0;
    --*budget;
    int count=0;
    if (is(root,"variable_declarator") || is(root,"required_parameter") ||
        is(root,"optional_parameter")) {
        TSNode id=ast_field(root,"name"); char *s=text(c,id);
        count=s && strcmp(s,name)==0; free(s);
    } else if (is(root,"identifier") && is(ts_node_parent(root),"formal_parameters")) {
        char *s=text(c,root);
        count=s && strcmp(s,name)==0; free(s);
    }
    for (uint32_t i=0;i<ts_node_named_child_count(root);i++)
        count+=declaration_count(c,ts_node_named_child(root,i),name,depth+1,budget);
    return count;
}
static bool imported_receiver(AstContext *c, const char *receiver) {
    SemResult *r=&c->result->sem;
    for (int i=0;i<r->nbindings;i++)
        if (!r->bindings[i].is_export && r->bindings[i].local_name &&
            strcmp(r->bindings[i].local_name,receiver)==0)
            return true;
    return false;
}
static void channel_fact(AstContext *c, TSNode n, TSNode fn,
                         TSNode args, int owner) {
    TSNode first=ts_node_named_child(args,0);
    if (!is(first,"string")) return;
    char *literal=unquote(c,first);
    if (!literal) return;
    TSNode object=ast_field(fn,"object"),property=ast_field(fn,"property");
    char *receiver=text(c,object),*method=text(c,property),*callee=text(c,fn);
    if (receiver && method &&
        (strcmp(receiver,"bus")==0 || strcmp(receiver,"socket")==0 ||
         strcmp(receiver,"queue")==0)) {
        const char *medium=strcmp(receiver,"queue")==0?"queue":
                           strcmp(receiver,"socket")==0?"socket":"bus";
        const char *direction=NULL;
        if (strcmp(method,"emit")==0 || strcmp(method,"publish")==0 ||
            strcmp(method,"send")==0) direction="producer";
        if (strcmp(method,"on")==0 || strcmp(method,"once")==0 ||
            strcmp(method,"subscribe")==0) direction="consumer";
        if (direction) {
            char kind[48]; snprintf(kind,sizeof(kind),"channel:%s:%s",medium,direction);
            int budget=4096;
            int competing=declaration_count(c,c->root,receiver,0,&budget);
            if (budget<=0) competing=-1;
            budget=4096;
            bool local=c->path && competing==1 &&
                locally_constructed(c,c->root,receiver,0,&budget);
            bool imported=!local && competing==0 && imported_receiver(c,receiver);
            size_t z=(local?strlen(c->path):strlen("import"))+strlen(receiver)+2;
            char *identity=malloc(z);
            if (identity && (local || imported)) {
                snprintf(identity,z,"%s:%s",local?c->path:"import",receiver);
                named_fact(c,n,literal,kind,owner,identity);
            }
            free(identity);
        }
    }
    if (local_path(literal)) {
        const char *http=NULL;
        if (callee && strcmp(callee,"fetch")==0) {
            http="GET";
            TSNode options=ts_node_named_child(args,1);
            for (uint32_t i=0;!ts_node_is_null(options) &&
                               i<ts_node_named_child_count(options);i++) {
                TSNode pair=ts_node_named_child(options,i);
                TSNode key=ast_field(pair,"key"),value=ast_field(pair,"value");
                char *key_name=text(c,key);
                if (key_name && strcmp(key_name,"method")==0 && is(value,"string")) {
                    char *m=unquote(c,value);
                    if (m) {
                        static const char *methods[]={"GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"};
                        http=NULL;
                        for (size_t j=0;j<sizeof(methods)/sizeof(methods[0]);j++)
                            if (strcasecmp(m,methods[j])==0) { http=methods[j]; break; }
                        free(m);
                    }
                }
                free(key_name);
            }
        } else if (receiver && method &&
                   (strcmp(receiver,"axios")==0 || strcmp(receiver,"http")==0)) {
            static const char *methods[]={"get","post","put","patch","delete","head","options"};
            for (size_t j=0;j<sizeof(methods)/sizeof(methods[0]);j++)
                if (strcmp(method,methods[j])==0) { http=methods[j]; break; }
        }
        if (http) {
            char upper[16]; size_t i=0;
            while (http[i] && i<sizeof(upper)-1) { upper[i]=(char)toupper((unsigned char)http[i]); i++; }
            upper[i]=0;
            named_fact(c,n,literal,"channel:http:producer",owner,upper);
        }
    }
    free(literal);free(receiver);free(method);free(callee);
}
static int call_arity(TSNode args) {
    if (!is(args,"arguments") || ts_node_has_error(args)) return -1;
    uint32_t children=ts_node_named_child_count(args);
    if (children>512) return -1;
    int count=0;
    for (uint32_t i=0;i<children;i++) {
        TSNode arg=ts_node_named_child(args,i);
        if (is(arg,"spread_element") || ts_node_is_error(arg) ||
            ts_node_is_missing(arg)) return -1;
        if (!ts_node_is_extra(arg) && ++count>256) return -1;
    }
    return count;
}
static void visit(AstContext *c, TSNode n, int owner, int depth) {
    if (c->cancelled || c->truncated) return;
    if (c->cancel_flag && *c->cancel_flag) { c->cancelled=true; return; }
    if (++c->visited>500000u) { c->truncated=true; return; }
    if (depth>256) { c->truncated=true; return; }
    if (ts_node_is_error(n)) { c->errors++; return; }
    if (ts_node_is_missing(n)) { c->missing++; return; }
    const char *kind=ts_node_type(n);
    TSNode name=ast_field(n,"name"),body=ast_field(n,"body");
    int child_owner=owner;
    bool exported=export_context(n);
    if (is(n,"class_declaration") || is(n,"abstract_class_declaration") || is(n,"class")) {
        child_owner=symbol(c,n,name,"class",owner,exported,body);
        heritage(c,n,child_owner);
    }
    else if (is(n,"interface_declaration")) {
        child_owner=symbol(c,n,name,"interface",owner,exported,body);
        for (uint32_t i=0;i<ts_node_named_child_count(n);i++) {
            TSNode clause=ts_node_named_child(n,i);
            if (!is(clause,"extends_type_clause")) continue;
            for (uint32_t j=0;j<ts_node_named_child_count(clause);j++) {
                TSNode base=ts_node_named_child(clause,j); char *value=text(c,base);
                named_fact(c,base,value,"inherits",child_owner,value);
                free(value);
            }
        }
    }
    else if (is(n,"type_alias_declaration"))
        child_owner=symbol(c,n,name,"type",owner,exported,ast_field(n,"value"));
    else if (is(n,"enum_declaration"))
        child_owner=symbol(c,n,name,"enum",owner,exported,body);
    else if (is(n,"function_declaration") || is(n,"generator_function_declaration") ||
             is(n,"function_signature"))
        child_owner=symbol(c,n,name,"function",owner,exported,body);
    else if (is(n,"method_definition") || is(n,"method_signature") ||
             is(n,"abstract_method_signature"))
        child_owner=symbol(c,n,name,"method",owner,exported,body);
    else if (is(n,"variable_declarator")) {
        TSNode v=ast_field(n,"value");
        if (is(v,"call_expression")) {
            TSNode fn=ast_field(v,"function"), args=ast_field(v,"arguments");
            char *callee=text(c,fn);
            TSNode first=ts_node_named_child(args,0);
            if (callee && strcmp(callee,"require")==0 && is(first,"string")) {
                char *module=unquote(c,first), *local=text(c,name);
                if (module) binding(c,n,module,local,"*","require",NULL,false);
                free(module); free(local);
            }
            free(callee);
        }
        if (is(v,"arrow_function") || is(v,"function_expression") || is(v,"function"))
            child_owner=symbol(c,n,name,"function",owner,export_context(ts_node_parent(n)),v);
        else if (is(v,"object"))
            child_owner=symbol(c,n,name,"object",owner,export_context(ts_node_parent(n)),v);
        else if (is(v,"new_expression"))
            child_owner=symbol(c,n,name,"variable",owner,export_context(ts_node_parent(n)),v);
        TSNode type=ast_field(n,"type");
        if (!ts_node_is_null(type)) {
            char *value=text(c,type);
            fact(c,type,name,"variable_type",owner,value);
            free(value);
        }
        if (is(v,"new_expression")) {
            TSNode ctor=ast_field(v,"constructor"); char *value=text(c,ctor);
            fact(c,n,name,"constructor",owner,value);
            free(value);
        }
        if (is(name,"array_pattern") && is(v,"call_expression")) {
            TSNode fn=ast_field(v,"function"); char *callee=text(c,fn);
            if (callee && strcmp(callee,"useState")==0 && ts_node_named_child_count(name)>=2) {
                TSNode state=ts_node_named_child(name,0), setter=ts_node_named_child(name,1);
                char *state_name=text(c,state), *setter_name=text(c,setter);
                const char *component=owner>=0?c->result->sem.symbols[owner].qualified_name:NULL;
                named_fact(c,n,setter_name,"state_setter",owner,component);
                named_fact(c,n,setter_name,"state_variable",owner,state_name);
                free(state_name);free(setter_name);
            }
            free(callee);
        }
    } else if (is(n,"pair")) {
        TSNode key=ast_field(n,"key"),val=ast_field(n,"value");
        if (is(val,"arrow_function") || is(val,"function_expression") || is(val,"function"))
            child_owner=symbol(c,n,key,"action",owner,false,val);
    } else if (is(n,"import_statement")) imports(c,n);
    else if (is(n,"export_statement")) exports(c,n);
    else if (is(n,"call_expression")) {
        TSNode fn=ast_field(n,"function");
        int before=c->result->sem.nreferences;
        if (is(fn,"identifier")) reference(c,n,fn,"call",owner,NULL);
        else if (is(fn,"member_expression")) {
            TSNode prop=ast_field(fn,"property"),obj=ast_field(fn,"object");
            char *qual=text(c,obj);
            const char *boundary=(!is(obj,"identifier") &&
                                  !is(obj,"this") && !is(obj,"super") &&
                                  !is(obj,"member_expression")) ? "(expr)" : qual;
            reference(c,n,prop,"call",owner,boundary);
            free(qual);
        }
        TSNode args=ast_field(n,"arguments");
        if (c->result->sem.nreferences>before)
            c->result->sem.references[c->result->sem.nreferences-1].argc=call_arity(args);
        channel_fact(c,n,fn,args,owner);
        char *callee=text(c,fn);
        TSNode first=ts_node_named_child(args,0), second=ts_node_named_child(args,1);
        TSNode method=is(fn,"member_expression")?ast_field(fn,"property"):fn;
        char *method_name=text(c,method);
        char *channel=is(first,"string")?unquote(c,first):NULL;
        if (channel && method_name &&
            (strcmp(method_name,"on")==0 || strcmp(method_name,"once")==0 ||
             strcmp(method_name,"addEventListener")==0 || strcmp(method_name,"subscribe")==0)) {
            char *cb=text(c,second);
            named_fact(c,n,channel,"event_subscription",owner,cb);
            free(cb);
        }
        if (channel && method_name &&
            (strcmp(method_name,"emit")==0 || strcmp(method_name,"dispatchEvent")==0 ||
             strcmp(method_name,"publish")==0))
            named_fact(c,n,channel,"event_emit",owner,method_name);
        if (channel && method_name && strcmp(method_name,"addObserver")==0) {
            char *cb=text(c,second);
            named_fact(c,n,channel,"observer_subscription",owner,cb);
            free(cb);
        }
        if (channel && method_name && strcmp(method_name,"notifyObservers")==0)
            named_fact(c,n,channel,"observer_notify",owner,NULL);
        if (callee && strncmp(callee,"set",3)==0 && isupper((unsigned char)callee[3]))
            named_fact(c,n,callee,"state_setter_call",owner,NULL);
        for (uint32_t i=0;i<ts_node_named_child_count(args);i++) {
            TSNode arg=ts_node_named_child(args,i);
            if (is(arg,"arrow_function") || is(arg,"function_expression") ||
                (i>0 && is(arg,"identifier"))) {
                char *callback=is(arg,"identifier")?text(c,arg):strdup("<inline>");
                named_fact(c,arg,callee,"callback_registration",owner,callback);
                free(callback);
            }
        }
        free(callee);free(method_name);free(channel);
    } else if (is(n,"new_expression")) {
        TSNode ctor=ast_field(n,"constructor");
        reference(c,n,ctor,"instantiation",owner,NULL);
        char *value=text(c,ctor);
        named_fact(c,n,value,"instantiates",owner,value);
        free(value);
    } else if (is(n,"jsx_opening_element") || is(n,"jsx_self_closing_element")) {
        TSNode tag=ast_field(n,"name"); char *tag_name=text(c,tag);
        if (component_name(tag_name)) {
            reference(c,n,tag,"component",owner,NULL);
            named_fact(c,n,tag_name,"jsx_component",owner,NULL);
        }
        free(tag_name);
    } else if (is(n,"type_identifier")) {
        TSNode p=ts_node_parent(n);
        if (!ts_node_eq(n,ast_field(p,"name"))) reference(c,n,n,"type",owner,NULL);
    }
    (void)kind;
    for (uint32_t i=0;i<ts_node_named_child_count(n);i++)
        visit(c,ts_node_named_child(n,i),child_owner,depth+1);
}
static void extract(AstContext *c) { visit(c,c->root,-1,0); }
void ast_web_register(void) {
    static const AstAdapter adapters[] = {
        {"javascript",tree_sitter_javascript,extract},
        {"typescript",tree_sitter_typescript,extract},
        {"tsx",tree_sitter_tsx,extract}
    };
    for (size_t i=0;i<sizeof(adapters)/sizeof(adapters[0]);i++)
        ast_register(&adapters[i]);
}
