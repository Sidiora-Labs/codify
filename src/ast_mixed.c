#include "ast.h"
#include "semantic.h"
#include <ctype.h>
#include <strings.h>

extern const TSLanguage *tree_sitter_pascal(void);
extern const TSLanguage *tree_sitter_COBOL(void);
extern const TSLanguage *tree_sitter_vb_dotnet(void);
extern const TSLanguage *tree_sitter_cfml(void);
extern const TSLanguage *tree_sitter_cfscript(void);
extern const TSLanguage *tree_sitter_cfquery(void);
extern const TSLanguage *tree_sitter_arkts(void);

#define MIXED_LINE_STEP 4096u
typedef struct {uint32_t line, start;} MixedLinePoint;
typedef struct MixedLines {
    const AstContext *ctx;
    MixedLinePoint *points;
    size_t count;
    struct MixedLines *previous;
} MixedLines;
static _Thread_local MixedLines *current_lines;

static void lines_begin(MixedLines *m,const AstContext *c) {
    memset(m,0,sizeof *m);m->ctx=c;m->previous=current_lines;
    m->count=c->length/MIXED_LINE_STEP+1;
    m->points=xmalloc(m->count*sizeof *m->points);
    uint32_t line=1,start=0;
    for(size_t block=0;block<m->count;block++) {
        m->points[block]=(MixedLinePoint){line,start};
        size_t lo=block*MIXED_LINE_STEP,hi=lo+MIXED_LINE_STEP;
        if(hi>c->length)hi=c->length;
        for(size_t i=lo;i<hi;i++)if(c->source[i]=='\n') {
            line++;start=(uint32_t)(i+1);
        }
    }
    current_lines=m;
}
static void lines_end(MixedLines *m) {
    current_lines=m->previous;free(m->points);
}
static void line_pos(const MixedLines *m,size_t byte,int *line,int *column) {
    size_t block=byte/MIXED_LINE_STEP;
    if(block>=m->count)block=m->count-1;
    uint32_t count=m->points[block].line,start=m->points[block].start;
    for(size_t i=block*MIXED_LINE_STEP;i<byte;i++)if(m->ctx->source[i]=='\n') {
        count++;start=(uint32_t)(i+1);
    }
    *line=(int)count;*column=(int)(byte-start);
}
static SemSpan span_bytes(const AstContext *c, size_t lo, size_t hi) {
    SemSpan s = {.line=1, .end_line=1};
    if (hi > c->length) hi = c->length;
    if (lo > hi) lo = hi;
    s.start_byte=lo;s.end_byte=hi;
    if(current_lines && current_lines->ctx==c) {
        line_pos(current_lines,lo,&s.line,&s.column);
        line_pos(current_lines,hi,&s.end_line,&s.end_column);
        return s;
    }
    for (size_t i=0; i<hi; i++) {
        if (c->source[i]=='\n') {
            if (i < lo) s.line++;
            s.end_line++;
        }
    }
    size_t x=lo; while (x && c->source[x-1]!='\n') x--; s.column=(int)(lo-x);
    x=hi; while (x && c->source[x-1]!='\n') x--; s.end_column=(int)(hi-x);
    return s;
}

static SemSpan span_node(AstContext *c, TSNode n) {
    (void)c;
    TSPoint a=ts_node_start_point(n), b=ts_node_end_point(n);
    return (SemSpan){.line=(int)a.row+1,.column=(int)a.column,
                     .end_line=(int)b.row+1,.end_column=(int)b.column,
                     .start_byte=ts_node_start_byte(n),.end_byte=ts_node_end_byte(n)};
}

static bool eq(const char *a, const char *b) { return strcmp(a,b)==0; }
static void decl(AstContext *c,const char *name,const char *kind,size_t lo,size_t hi,int owner);
static bool boundary(const AstContext *c,size_t p,size_t n);
static void identify(AstContext *c,const char *prefix) {
    if(c->result->sem.parser_id)return;
    size_t n=strlen(prefix)+strlen(c->language)+2;
    c->result->sem.parser_id=xmalloc(n);
    snprintf(c->result->sem.parser_id,n,"%s:%s",prefix,c->language);
}
static char *node_name(AstContext *c, TSNode n) {
    if(eq(ts_node_type(n),"program_name")) return ast_text(c,n);
    TSNode f=ast_field(n,"name");
    if (ts_node_is_null(f)) f=ast_field(n,"header");
    if (!ts_node_is_null(f) && eq(ts_node_type(f),"declProc")) f=ast_field(f,"name");
    if (ts_node_is_null(f)) {
        TSTreeCursor cursor=ts_tree_cursor_new(n);
        if(ts_tree_cursor_goto_first_child(&cursor))do {
            TSNode ch=ts_tree_cursor_current_node(&cursor);
            const char *t=ts_node_type(ch);
            if (ts_node_is_named(ch) && (eq(t,"identifier") || eq(t,"program_name") ||
                eq(t,"moduleName") || eq(t,"paragraph_name"))) {f=ch;break;}
        } while(ts_tree_cursor_goto_next_sibling(&cursor));
        ts_tree_cursor_delete(&cursor);
    }
    if (ts_node_is_null(f)) return NULL;
    char *s=ast_text(c,f);
    if (s && strlen(s)>256) { free(s); return NULL; }
    return s;
}

static int add_symbol(AstContext *c, TSNode n, const char *kind, int parent) {
    char *name=node_name(c,n); if (!name || !*name) {free(name);return -1;}
    SemSymbol *s=sem_symbol_add(&c->result->sem,name,kind,span_node(c,n));
    if (!s) {free(name);return -1;}
    int id=c->result->sem.nsymbols-1;
    s->parent=parent;
    s->declaration=eq(ts_node_type(n),"declProc");
    s->scope_key=xstrdup(name);
    if (parent>=0 && parent<id) {
        const char *p=c->result->sem.symbols[parent].qualified_name;
        if (!p) p=c->result->sem.symbols[parent].name;
        size_t len=strlen(p)+strlen(name)+2; s->qualified_name=xmalloc(len);
        snprintf(s->qualified_name,len,"%s.%s",p,name);
    } else s->qualified_name=xstrdup(name);
    TSNode f=ast_field(n,"return_type");
    if (ts_node_is_null(f)) f=ast_field(n,"type");
    if (!ts_node_is_null(f)) s->result_type=ast_text(c,f);
    f=ast_field(n,"modifiers");
    if (!ts_node_is_null(f)) s->modifiers=ast_text(c,f);
    f=ast_field(n,"decorator");
    if (!ts_node_is_null(f)) s->decorators=ast_text(c,f);
    f=ast_field(n,"type_parameters");
    if (!ts_node_is_null(f)) s->generic_params=ast_text(c,f);
    static const struct {const char *field,*kind;} facts[]={
        {"inherits","inherits"},{"implements","implements"},
        {"parent","inherits"}
    };
    for(size_t i=0;i<sizeof facts/sizeof *facts;i++) {
        f=ast_field(n,facts[i].field);
        if(ts_node_is_null(f))continue;
        char *target=ast_text(c,f);if(!target)continue;
        SemTypeFact *tf=sem_type_fact_add(&c->result->sem,name,facts[i].kind,span_node(c,f));
        if(tf){tf->owner=id;tf->value=target;tf->evidence=xstrdup(ts_node_type(n));}
        else free(target);
    }
    free(name); return id;
}

static void add_ref(AstContext *c, TSNode n, TSNode name, const char *kind,int owner) {
    if (ts_node_is_null(name)) return;
    char *text=ast_text(c,name);
    if (!text || !*text || strlen(text)>256) {free(text);return;}
    SemReference *r=sem_reference_add(&c->result->sem,text,kind,span_node(c,name));
    if (r) {r->owner=owner;r->strategy=xstrdup("syntax");r->evidence=xstrdup(ts_node_type(n));}
    free(text);
}

typedef struct {
    int symbols[512];
    uint32_t ends[512];
    unsigned depth;
    int cobol_paragraph;
} MixedOwners;
static bool grammar_visit(AstContext *c, TSNode n, void *unused) {
    MixedOwners *owners=unused;
    uint32_t start=ts_node_start_byte(n),end=ts_node_end_byte(n);
    while(owners->depth && owners->ends[owners->depth-1]<=start)owners->depth--;
    int owner=owners->depth?owners->symbols[owners->depth-1]:-1;
    const char *t=ts_node_type(n), *lang=c->language;
    if(eq(lang,"cobol") && owners->cobol_paragraph>=0 &&
       !eq(t,"paragraph_header") && !eq(t,"section_header"))
        owner=owners->cobol_paragraph;
    const char *kind=NULL;
    if (eq(lang,"pascal")) {
        if (eq(t,"unit") || eq(t,"program")) kind="module";
        else if (eq(t,"declType") || eq(t,"declClass")) kind="type";
        else if (eq(t,"declProc") || eq(t,"defProc")) {
            if (!(eq(t,"declProc") && eq(ts_node_type(ts_node_parent(n)),"defProc"))) kind="function";
        }
        else if (eq(t,"exprCall")) add_ref(c,n,ast_field(n,"entity"),"call",owner);
        else if (eq(t,"declUses")) {
            TSTreeCursor cursor=ts_tree_cursor_new(n);
            if(ts_tree_cursor_goto_first_child(&cursor))do {
                TSNode ch=ts_tree_cursor_current_node(&cursor);
                if (!eq(ts_node_type(ch),"moduleName")) continue;
                char *v=ast_text(c,ch);
                if (v) {SemBinding *b=sem_binding_add(&c->result->sem,v,v,span_node(c,ch));
                    if (b) b->kind=xstrdup("import");
                    free(v);}
            } while(ts_tree_cursor_goto_next_sibling(&cursor));
            ts_tree_cursor_delete(&cursor);
        }
    } else if (eq(lang,"cobol")) {
        if (eq(t,"program_definition")) owners->cobol_paragraph=-1;
        else if (eq(t,"program_name")) kind="program";
        else if (eq(t,"paragraph_header") || eq(t,"section_header")) {
            char *v=ast_text(c,n);
            if(v){size_t len=strlen(v);while(len&&(isspace((unsigned char)v[len-1])||v[len-1]=='.'))v[--len]=0;
                if(len)decl(c,v,eq(t,"paragraph_header")?"paragraph":"section",start,start+len,owner);
                if(len)owners->cobol_paragraph=c->result->sem.nsymbols-1;
                free(v);}
        }
        else if (eq(t,"copy_statement")) {
            TSNode f=ast_field(n,"book"); char *v=ast_text(c,f);
            if (v) {SemBinding *b=sem_binding_add(&c->result->sem,v,v,span_node(c,f));
                if (b) b->kind=xstrdup("copy");
                free(v);}
        } else if (eq(t,"perform_procedure")) {
            TSNode f=ast_field(n,"label"); if (ts_node_is_null(f)) f=ts_node_named_child(n,0);
            add_ref(c,n,f,"call",owner);
        }
    } else if (eq(lang,"vbnet")) {
        if (eq(t,"class_block") || eq(t,"interface_block") || eq(t,"structure_block") || eq(t,"module_block") || eq(t,"enum_block")) kind="class";
        else if (eq(t,"namespace_block")) kind="namespace";
        else if (eq(t,"method_declaration") || eq(t,"constructor_declaration")) kind="method";
        else if (eq(t,"property_declaration")) kind="property";
        else if (eq(t,"event_declaration")) kind="event";
        else if (eq(t,"invocation")) add_ref(c,n,ast_field(n,"target"),"call",owner);
        else if (eq(t,"imports_statement")) {
            TSNode f=ast_field(n,"namespace"); char *v=ast_text(c,f);
            if (v) {SemBinding *b=sem_binding_add(&c->result->sem,v,v,span_node(c,f));
                if (b) b->kind=xstrdup("import");
                    free(v);}
        }
    } else if (eq(lang,"arkts")) {
        if (eq(t,"struct_declaration") || eq(t,"class_declaration")) kind="class";
        else if (eq(t,"function_declaration")) kind="function";
        else if (eq(t,"method_definition")) kind="method";
        else if (eq(t,"call_expression")) add_ref(c,n,ast_field(n,"function"),"call",owner);
    } else if (eq(lang,"cfscript") || eq(lang,"cfml") || eq(lang,"cfquery")) {
        if (eq(t,"component")) kind="component";
        else if (eq(t,"function_declaration") || eq(t,"method_definition") || eq(t,"cf_function_tag")) kind="function";
        else if (eq(t,"cf_query_tag") || eq(t,"query_expression")) kind="query";
        else if (eq(lang,"cfquery") && eq(t,"query_identifier")) add_ref(c,n,n,"sql-identifier",owner);
        else if (eq(t,"call_expression")) add_ref(c,n,ast_field(n,"function"),"call",owner);
    }
    if (kind) {
        int id=add_symbol(c,n,kind,owner);
        if(id>=0 && end>start && owners->depth<512) {
            owners->symbols[owners->depth]=id;
            owners->ends[owners->depth++]=end;
        }
    }
    return true;
}

static void grammar_extract(AstContext *c) {
    MixedOwners owners={.cobol_paragraph=-1};
    identify(c,"tree-sitter");ast_walk(c,c->root,grammar_visit,&owners);
}

/* Search helpers operate on the original byte buffer, never on a normalized
 * copy; every recorded site can therefore be mapped back to the source. */
static bool at(const AstContext *c,size_t p,const char *s) {
    size_t n=strlen(s);return p+n<=c->length && !strncasecmp(c->source+p,s,n);
}
static size_t until(const AstContext *c,size_t p,char end) {
    char quote=0; for(;p<c->length;p++) { char x=c->source[p];
        if (quote) {if (x==quote && (!p || c->source[p-1]!='\\')) quote=0;}
        else if (x=='\'' || x=='"') quote=x;
        else if (x==end) return p;
    } return c->length;
}
static char *attr(const AstContext *c,size_t a,size_t b,const char *key,size_t *site) {
    size_t k=strlen(key);
    for(size_t p=a;p+k<b;p++) {
        if (strncasecmp(c->source+p,key,k) || (p>a && (isalnum((unsigned char)c->source[p-1])||c->source[p-1]=='-'))) continue;
        size_t q=p+k;while(q<b && isspace((unsigned char)c->source[q]))q++;
        if(q>=b || c->source[q++]!='=')continue;
        while(q<b && isspace((unsigned char)c->source[q]))q++;
        if(q>=b)break;
        char quote=c->source[q]; if(quote=='\''||quote=='"')q++; else quote=0;
        size_t start=q;while(q<b && (quote?c->source[q]!=quote:!isspace((unsigned char)c->source[q])&&c->source[q]!='>'))q++;
        if(site)*site=start;
        return strndup(c->source+start,q-start);
    } return NULL;
}
static void decl(AstContext *c,const char *name,const char *kind,size_t lo,size_t hi,int owner) {
    if(!name||!*name)return;
    SemSymbol *s=sem_symbol_add(&c->result->sem,name,kind,span_bytes(c,lo,hi));
    if(s) {
        s->parent=owner;s->scope_key=xstrdup(name);
        if(owner>=0 && owner<c->result->sem.nsymbols-1) {
            const SemSymbol *parent=&c->result->sem.symbols[owner];
            const char *prefix=parent->qualified_name?parent->qualified_name:parent->name;
            size_t n=strlen(prefix)+strlen(name)+2;
            s->qualified_name=xmalloc(n);snprintf(s->qualified_name,n,"%s.%s",prefix,name);
        } else s->qualified_name=xstrdup(name);
    }
}
static void ref(AstContext *c,const char *text,const char *kind,size_t lo,size_t hi,int owner,const char *why) {
    if(!text||!*text)return;
    SemReference *r=sem_reference_add(&c->result->sem,text,kind,span_bytes(c,lo,hi));
    if(r) {r->owner=owner;r->strategy=xstrdup("declarative");r->evidence=xstrdup(why);}
}

static void embedded_fallback(AstContext *c,size_t a,size_t b) {
    /* Small scanner for a script block before its language family is linked.
     * Only an unquoted function declaration is structurally evident here. */
    char quote=0;bool line_comment=false,block_comment=false;
    for(size_t p=a;p<b;p++) {
        char ch=c->source[p],nx=p+1<b?c->source[p+1]:0;
        if(line_comment) {if(ch=='\n')line_comment=false;continue;}
        if(block_comment) {if(ch=='*'&&nx=='/')block_comment=false,p++;continue;}
        if(quote) {if(ch==quote && (p==a||c->source[p-1]!='\\'))quote=0;continue;}
        if(ch=='/'&&nx=='/') {line_comment=true;p++;continue;}
        if(ch=='/'&&nx=='*') {block_comment=true;p++;continue;}
        if(ch=='\''||ch=='"'||ch=='`') {quote=ch;continue;}
        if(p+8<b && !memcmp(c->source+p,"function",8) &&
           (p==a||!isalnum((unsigned char)c->source[p-1])) &&
           !isalnum((unsigned char)c->source[p+8])) {
            size_t q=p+8;while(q<b&&isspace((unsigned char)c->source[q]))q++;
            size_t start=q;while(q<b&&(isalnum((unsigned char)c->source[q])||c->source[q]=='_'))q++;
            if(q>start) {char *name=strndup(c->source+start,q-start);
                decl(c,name,"function",start,q,-1);free(name);}
            p=q;
        }
    }
}

static void parse_embedded(AstContext *c,const char *language,size_t a,size_t b) {
    if(b<=a || b-a>8*1024*1024)return;
    ParseResult sub={0};
    if(!ast_try_parse(language,c->path,c->source+a,b-a,&sub)) {
        parse_result_free(&sub);embedded_fallback(c,a,b);return;
    }
    SemResult *dst=&c->result->sem,*src=&sub.sem;
    int symbase=dst->nsymbols, refbase=dst->nreferences;
    for(int i=0;i<src->nsymbols;i++) {
        SemSymbol x=src->symbols[i]; x.span=span_bytes(c,a+x.span.start_byte,a+x.span.end_byte);
        if(x.parent>=0)x.parent+=symbase;
        x.legacy_def=-1;
        if(dst->nsymbols==dst->csymbols)dst->symbols=xrealloc(dst->symbols,(size_t)(dst->csymbols=dst->csymbols?dst->csymbols*2:16)*sizeof(*dst->symbols));
        dst->symbols[dst->nsymbols++]=x; memset(&src->symbols[i],0,sizeof x);
    }
    for(int i=0;i<src->nreferences;i++) {
        SemReference x=src->references[i];x.span=span_bytes(c,a+x.span.start_byte,a+x.span.end_byte);
        if(x.owner>=0)x.owner+=symbase;
        if(x.target>=0)x.target+=symbase;
        x.legacy_ref=-1;
        if(dst->nreferences==dst->creferences)dst->references=xrealloc(dst->references,(size_t)(dst->creferences=dst->creferences?dst->creferences*2:16)*sizeof(*dst->references));
        dst->references[dst->nreferences++]=x;memset(&src->references[i],0,sizeof x);
    }
    for(int i=0;i<src->nbindings;i++) {
        SemBinding x=src->bindings[i];x.span=span_bytes(c,a+x.span.start_byte,a+x.span.end_byte);
        if(x.owner>=0)x.owner+=symbase;
        if(dst->nbindings==dst->cbindings)dst->bindings=xrealloc(dst->bindings,(size_t)(dst->cbindings=dst->cbindings?dst->cbindings*2:8)*sizeof(*dst->bindings));
        dst->bindings[dst->nbindings++]=x;memset(&src->bindings[i],0,sizeof x);
    }
    for(int i=0;i<src->ntype_facts;i++) {
        SemTypeFact x=src->type_facts[i];x.span=span_bytes(c,a+x.span.start_byte,a+x.span.end_byte);
        if(x.owner>=0)x.owner+=symbase;
        if(dst->ntype_facts==dst->ctype_facts)dst->type_facts=xrealloc(dst->type_facts,(size_t)(dst->ctype_facts=dst->ctype_facts?dst->ctype_facts*2:8)*sizeof(*dst->type_facts));
        dst->type_facts[dst->ntype_facts++]=x;memset(&src->type_facts[i],0,sizeof x);
    }
    for(int i=0;i<src->nedges;i++) {
        SemEdge x=src->edges[i];x.site=span_bytes(c,a+x.site.start_byte,a+x.site.end_byte);
        if(x.source>=0)x.source+=symbase;
        if(x.target>=0)x.target+=symbase;
        if(x.source_ref>=0)x.source_ref+=refbase;
        if(dst->nedges==dst->cedges)dst->edges=xrealloc(dst->edges,(size_t)(dst->cedges=dst->cedges?dst->cedges*2:8)*sizeof(*dst->edges));
        dst->edges[dst->nedges++]=x;memset(&src->edges[i],0,sizeof x);
    }
    parse_result_free(&sub);
}

typedef struct {const char *kind,*name;int id;} MixedLiteralTarget;
static int literal_target_cmp(const void *a,const void *b) {
    const MixedLiteralTarget *x=a,*y=b;
    int by_kind=strcmp(x->kind,y->kind);
    return by_kind?by_kind:strcmp(x->name,y->name);
}
static void link_local_literals(AstContext *c,const char *lang) {
    SemResult *r=&c->result->sem;
    MixedLiteralTarget *targets=xmalloc((size_t)(r->nsymbols?r->nsymbols:1)*sizeof *targets);
    int ntargets=0;
    for(int i=0;i<r->nsymbols;i++) {
        SemSymbol *sym=&r->symbols[i];
        if(!sym->kind || !sym->name)continue;
        if(!eq(sym->kind,"statement") && !eq(sym->kind,"function") && !eq(sym->kind,"query"))continue;
        targets[ntargets++]=(MixedLiteralTarget){sym->kind,sym->name,i};
    }
    qsort(targets,(size_t)ntargets,sizeof *targets,literal_target_cmp);
    for(int i=0;i<r->nreferences;i++) {
        SemReference *ref=&r->references[i];
        if(ref->owner<0 || ref->target>=0 || !ref->text)continue;
        bool mapping=eq(lang,"xml") && eq(ref->kind,"reference");
        bool call=eq(lang,"cfml") && eq(ref->kind,"call");
        bool query=eq(lang,"cfml") && eq(ref->kind,"sql-identifier");
        if(!mapping&&!call&&!query)continue;
        MixedLiteralTarget key={mapping?"statement":call?"function":"query",ref->text,-1};
        MixedLiteralTarget *found=bsearch(&key,targets,(size_t)ntargets,sizeof *targets,literal_target_cmp);
        if(!found)continue;
        size_t at=(size_t)(found-targets);
        if((at>0 && literal_target_cmp(&targets[at-1],&key)==0) ||
           (at+1<(size_t)ntargets && literal_target_cmp(&targets[at+1],&key)==0))continue;
        int target=found->id;
        ref->target=target;
        SemEdge *edge=sem_edge_add(r,call?"calls":"references",ref->owner,target,ref->span);
        if(edge) {
            edge->source_ref=i;
            edge->original_text=xstrdup(ref->text);
            edge->strategy=xstrdup("unique-local-literal");
            edge->provenance=xstrdup("syntax");
            edge->evidence=xstrdup(ref->evidence?ref->evidence:"declarative binding");
        }
    }
    free(targets);
}

static void markup_extract(AstContext *c) {
    MixedLines lines;lines_begin(&lines,c);
    identify(c,"declarative");
    const char *lang=c->language;int owner=-1,statement=-1,cf_function=-1;
    bool mapping=false;
    size_t begin=0;
    if(eq(lang,"cfml")) {
        size_t q=0;while(q<c->length&&isspace((unsigned char)c->source[q]))q++;
        if(at(c,q,"component") && boundary(c,q,9)) {
            parse_embedded(c,"cfscript",0,c->length);
            free(c->result->sem.parser_id);
            c->result->sem.parser_id=xstrdup("embedded:cfscript");
            lines_end(&lines);return;
        }
    }
    if(eq(lang,"astro") && c->length>=6 && !strncmp(c->source,"---",3)) {
        size_t q=3;while(q+4<c->length && strncmp(c->source+q,"\n---",4))q++;
        if(q+4<c->length) {parse_embedded(c,"typescript",3,q);begin=q+4;}
    }
    for(size_t p=begin;p<c->length;) {
        if(at(c,p,"<!--")) {size_t q=p+4;while(q+3<=c->length&&!at(c,q,"-->"))q++;p=q+3;continue;}
        if(c->source[p]!='<') {p++;continue;}
        size_t e=until(c,p+1,'>');if(e>=c->length)break;
        size_t a=p+1;bool closing=false;if(a<e&&c->source[a]=='/')a++,closing=true;
        size_t z=a;while(z<e&&(isalnum((unsigned char)c->source[z])||c->source[z]=='-'||c->source[z]==':'))z++;
        char *tag=strndup(c->source+a,z-a);
        if(closing && eq(lang,"xml")) {
            if(!strcasecmp(tag,"mapper")) mapping=false,owner=-1;
            else if(!strcasecmp(tag,"select")||!strcasecmp(tag,"insert")||
                    !strcasecmp(tag,"update")||!strcasecmp(tag,"delete")||
                    !strcasecmp(tag,"sql"))statement=-1;
        }
        if(closing && eq(lang,"cfml") && !strcasecmp(tag,"cffunction"))cf_function=-1;
        if(!closing&&*tag) {
            size_t site=0;char *name=NULL;
            if(eq(lang,"xml")&& !strcasecmp(tag,"mapper")) {
                mapping=true;
                name=attr(c,z,e,"namespace",&site);if(name)decl(c,name,"mapper",site,site+strlen(name),-1);
                owner=c->result->sem.nsymbols-1;
            } else if(mapping&&(!strcasecmp(tag,"select")||!strcasecmp(tag,"insert")||!strcasecmp(tag,"update")||!strcasecmp(tag,"delete")||!strcasecmp(tag,"sql"))) {
                name=attr(c,z,e,"id",&site);if(name)decl(c,name,"statement",site,site+strlen(name),owner);
                if(name)statement=c->result->sem.nsymbols-1;
                free(name);name=attr(c,z,e,"resultMap",&site);
                if(name)ref(c,name,"reference",site,site+strlen(name),statement>=0?statement:owner,"result mapping");
            } else if(mapping&&(!strcasecmp(tag,"include")||!strcasecmp(tag,"resultMap"))) {
                name=attr(c,z,e,!strcasecmp(tag,"include")?"refid":"extends",&site);
                if(name)ref(c,name,"reference",site,site+strlen(name),statement>=0?statement:owner,"mapping attribute");
            } else if(eq(lang,"cfml") && !strcasecmp(tag,"cfcomponent")) {
                name=attr(c,z,e,"name",&site);if(name)decl(c,name,"component",site,site+strlen(name),-1);
                owner=c->result->sem.nsymbols-1;
            } else if(eq(lang,"cfml") && !strcasecmp(tag,"cffunction")) {
                name=attr(c,z,e,"name",&site);if(name)decl(c,name,"function",site,site+strlen(name),owner);
                if(name)cf_function=c->result->sem.nsymbols-1;
            } else if(eq(lang,"cfml") && !strcasecmp(tag,"cfquery")) {
                name=attr(c,z,e,"name",&site);if(name)decl(c,name,"query",site,site+strlen(name),cf_function>=0?cf_function:owner);
                size_t q=e+1;while(q<c->length&&!at(c,q,"</cfquery"))q++;
                int query_id=name?c->result->sem.nsymbols-1:-1;
                int first_ref=c->result->sem.nreferences;
                parse_embedded(c,"cfquery",e+1,q);
                for(int ri=first_ref;ri<c->result->sem.nreferences;ri++)
                    if(c->result->sem.references[ri].owner<0)
                        c->result->sem.references[ri].owner=query_id;
            } else if(eq(lang,"cfml") && !strcasecmp(tag,"cfinvoke")) {
                name=attr(c,z,e,"method",&site);
                if(name)ref(c,name,"call",site,site+strlen(name),cf_function>=0?cf_function:owner,"CFML invocation");
            } else if(eq(lang,"cfml") && !strcasecmp(tag,"cfinclude")) {
                name=attr(c,z,e,"template",&site);
                if(name)ref(c,name,"template",site,site+strlen(name),cf_function>=0?cf_function:owner,"CFML include");
            } else if(eq(lang,"cfml") && !strcasecmp(tag,"cfreturn")) {
                size_t q=z;while(q<e&&isspace((unsigned char)c->source[q]))q++;
                size_t call=q;while(q<e&&(isalnum((unsigned char)c->source[q])||c->source[q]=='_'))q++;
                if(q>call && q<e && c->source[q]=='(') {
                    char *method=strndup(c->source+call,q-call);
                    ref(c,method,"call",call,q,cf_function>=0?cf_function:owner,"CFML return call");
                    free(method);
                }
            } else if(eq(lang,"cfml") && !strcasecmp(tag,"cfscript")) {
                size_t q=e+1;while(q<c->length&&!at(c,q,"</cfscript"))q++;
                parse_embedded(c,"cfscript",e+1,q);
            } else if(eq(lang,"vue")||eq(lang,"svelte")||eq(lang,"astro")) {
                if(isupper((unsigned char)tag[0])) ref(c,tag,"component",a,z,owner,"component tag");
                if(!strcasecmp(tag,"script")) {
                    size_t q=e+1;while(q<c->length&&!at(c,q,"</script"))q++;
                    size_t langsite=0;char *sl=attr(c,z,e,"lang",&langsite);
                    parse_embedded(c,sl && (!strcasecmp(sl,"ts")||!strcasecmp(sl,"typescript"))?"typescript":"javascript",e+1,q);
                    free(sl);free(name);free(tag);p=q;continue;
                }
            }
            free(name);
        }
        free(tag);p=e+1;
    }
    link_local_literals(c,lang);
    lines_end(&lines);
}

static bool boundary(const AstContext *c,size_t p,size_t n) {
    return (p==0||!isalnum((unsigned char)c->source[p-1])) &&
           (p+n>=c->length||!isalnum((unsigned char)c->source[p+n]));
}
static void delphi_extract(AstContext *c) {
    int stack[128],depth=0;
    bool comment=false;
    for(size_t line=0;line<c->length;) {
        size_t end=line;while(end<c->length&&c->source[end]!='\n')end++;
        size_t p=line;while(p<end&&isspace((unsigned char)c->source[p]))p++;
        if(comment) {
            while(p<end&&c->source[p]!='}')p++;
            if(p<end)comment=false;
        } else if(p<end&&c->source[p]=='{') {
            comment=true;while(p<end&&c->source[p]!='}')p++;
            if(p<end)comment=false;
        } else if(p<end) {
            size_t keyword=0;
            if(p+7<=end&&!strncasecmp(c->source+p,"object ",7))keyword=7;
            else if(p+10<=end&&!strncasecmp(c->source+p,"inherited ",10))keyword=10;
            else if(p+7<=end&&!strncasecmp(c->source+p,"inline ",7))keyword=7;
            if(keyword) {
                size_t a=p+keyword,q=a;
                while(q<end&&(isalnum((unsigned char)c->source[q])||c->source[q]=='_'))q++;
                if(q>a) {
                    char *name=strndup(c->source+a,q-a);
                    int owner=depth?stack[depth-1]:-1;
                    decl(c,name,"component",a,q,owner);free(name);
                    if(depth<128)stack[depth++]=c->result->sem.nsymbols-1;
                }
                while(q<end&&isspace((unsigned char)c->source[q]))q++;
                if(q<end&&c->source[q]==':') {
                    q++;while(q<end&&isspace((unsigned char)c->source[q]))q++;
                    size_t a=q;while(q<end&&(isalnum((unsigned char)c->source[q])||c->source[q]=='_'||c->source[q]=='.'))q++;
                    if(q>a){char *name=strndup(c->source+a,q-a);
                        ref(c,name,"type",a,q,depth?stack[depth-1]:-1,"form component type");free(name);}
                }
            } else if(p+3<=end&&!strncasecmp(c->source+p,"end",3)&&
                      (p+3==end||isspace((unsigned char)c->source[p+3]))){
                if(depth)depth--;
            } else if(p+3<end&&!strncasecmp(c->source+p,"On",2)&&
                      isalpha((unsigned char)c->source[p+2])) {
                size_t q=p+2;while(q<end&&isalnum((unsigned char)c->source[q]))q++;
                while(q<end&&isspace((unsigned char)c->source[q]))q++;
                if(q<end&&c->source[q]=='=') {
                    q++;while(q<end&&isspace((unsigned char)c->source[q]))q++;
                    size_t a=q;while(q<end&&(isalnum((unsigned char)c->source[q])||c->source[q]=='_'||c->source[q]=='.'))q++;
                    size_t tail=q;while(tail<end&&isspace((unsigned char)c->source[tail]))tail++;
                    if(q>a&&(tail==end||c->source[tail]=='{')){
                        char *handler=strndup(c->source+a,q-a);
                        if(strcasecmp(handler,"nil"))
                            ref(c,handler,"call",a,q,depth?stack[depth-1]:-1,"form event assignment");
                        free(handler);
                    }
                }
            }
        }
        line=end+(end<c->length);
    }
}
static void text_extract(AstContext *c) {
    MixedLines lines;lines_begin(&lines,c);
    identify(c,"declarative");
    const char *lang=c->language;
    if(eq(lang,"delphi_form")) {delphi_extract(c);lines_end(&lines);return;}
    for(size_t p=0;p<c->length;) {
        if(eq(lang,"razor") && at(c,p,"@*")) {
            p+=2;while(p+2<c->length&&!at(c,p,"*@"))p++;
            p+=2;continue;
        }
        if(eq(lang,"razor") && at(c,p,"<!--")) {
            p+=4;while(p+3<c->length&&!at(c,p,"-->"))p++;
            p+=3;continue;
        }
        if(eq(lang,"razor")) {
            if(at(c,p,"@model ")||at(c,p,"@inherits ")||at(c,p,"@inject ")) {
                size_t a=p+(at(c,p,"@model ")?7:at(c,p,"@inject ")?8:10),q=a;
                while(q<c->length && (isalnum((unsigned char)c->source[q])||c->source[q]=='_'||c->source[q]=='.'))q++;
                if(q>a){char *n=strndup(c->source+a,q-a);ref(c,n,"type",a,q,-1,"razor directive");free(n);}
            }
        } else if(eq(lang,"liquid")) {
            if(at(c,p,"{%")) {
                size_t q=p+2;while(q+2<c->length&&!at(c,q,"%}"))q++;
                size_t a=p+2;while(a<q&&isspace((unsigned char)c->source[a]))a++;
                if((at(c,a,"comment") && boundary(c,a,7)) ||
                   (at(c,a,"raw") && boundary(c,a,3))) {
                    bool raw=at(c,a,"raw");
                    const char *end=raw?"{% endraw":"{% endcomment";
                    p=q+2;while(p+strlen(end)<c->length&&!at(c,p,end))p++;
                    if(p+strlen(end)<c->length) {while(p+2<c->length&&!at(c,p,"%}"))p++;p+=2;}
                    continue;
                }
                if((at(c,a,"render")&&boundary(c,a,6))||(at(c,a,"include")&&boundary(c,a,7))) {
                    a+=at(c,a,"render")?6:7;while(a<q&&isspace((unsigned char)c->source[a]))a++;
                    if(a<q&&(c->source[a]=='\''||c->source[a]=='"')) {
                        char quote=c->source[a++];size_t b=a;while(b<q&&c->source[b]!=quote)b++;
                        if(b>a){char *n=strndup(c->source+a,b-a);ref(c,n,"template",a,b,-1,"liquid include");free(n);}
                    }
                } p=q+2;continue;
            }
        }
        p++;
    }
    lines_end(&lines);
}

static void file_only(AstContext *c) {
    size_t n=strlen(c->language)+11;
    c->result->sem.parser_id=xmalloc(n);
    snprintf(c->result->sem.parser_id,n,"file-only:%s",c->language);
}

void ast_mixed_register(void) {
    static const AstAdapter a[]={
        {"pascal",tree_sitter_pascal,grammar_extract},
        {"cobol",tree_sitter_COBOL,grammar_extract},
        {"vbnet",tree_sitter_vb_dotnet,grammar_extract},
        {"cfscript",tree_sitter_cfscript,grammar_extract},
        {"cfquery",tree_sitter_cfquery,grammar_extract},
        {"arkts",tree_sitter_arkts,grammar_extract},
        {"cfml",tree_sitter_cfml,markup_extract},
        {"vue",NULL,markup_extract},{"svelte",NULL,markup_extract},
        {"astro",NULL,markup_extract},{"xml",NULL,markup_extract},
        {"liquid",NULL,text_extract},{"razor",NULL,text_extract},
        {"delphi_form",NULL,text_extract},
        {"json",NULL,file_only},{"yaml",NULL,file_only},
        {"twig",NULL,file_only},{"properties",NULL,file_only},
    };
    for(size_t i=0;i<sizeof a/sizeof *a;i++)ast_register(&a[i]);
}
