#include "cg.h"

static char *dup(const char *s) { return s ? xstrdup(s) : NULL; }
static void *grow(void *p, int *cap, int n, size_t size) {
    if (n < *cap) return p;
    *cap = *cap ? *cap * 2 : 8;
    return xrealloc(p, (size_t)*cap * size);
}

SemSymbol *sem_symbol_add(SemResult *r, const char *name, const char *kind,
                          SemSpan span) {
    r->symbols = grow(r->symbols, &r->csymbols, r->nsymbols, sizeof *r->symbols);
    SemSymbol *s = &r->symbols[r->nsymbols++];
    memset(s, 0, sizeof *s);
    s->name = dup(name); s->kind = dup(kind); s->span = span;
    s->parent = s->legacy_def = -1;
    return s;
}
SemReference *sem_reference_add(SemResult *r, const char *text,
                                const char *kind, SemSpan span) {
    r->references = grow(r->references, &r->creferences, r->nreferences,
                         sizeof *r->references);
    SemReference *v = &r->references[r->nreferences++];
    memset(v, 0, sizeof *v);
    v->text = dup(text); v->kind = dup(kind); v->span = span;
    v->owner = v->target = v->legacy_ref = v->argc = -1;
    return v;
}
SemBinding *sem_binding_add(SemResult *r, const char *module,
                            const char *local_name, SemSpan span) {
    r->bindings = grow(r->bindings, &r->cbindings, r->nbindings,
                       sizeof *r->bindings);
    SemBinding *v = &r->bindings[r->nbindings++];
    memset(v, 0, sizeof *v);
    v->module = dup(module); v->local_name = dup(local_name); v->span = span;
    v->owner = -1;
    return v;
}
SemTypeFact *sem_type_fact_add(SemResult *r, const char *name,
                               const char *kind, SemSpan span) {
    r->type_facts = grow(r->type_facts, &r->ctype_facts, r->ntype_facts,
                         sizeof *r->type_facts);
    SemTypeFact *v = &r->type_facts[r->ntype_facts++];
    memset(v, 0, sizeof *v);
    v->name = dup(name); v->kind = dup(kind); v->span = span; v->owner = -1;
    return v;
}
SemEdge *sem_edge_add(SemResult *r, const char *kind, int source,
                      int target, SemSpan site) {
    r->edges = grow(r->edges, &r->cedges, r->nedges, sizeof *r->edges);
    SemEdge *v = &r->edges[r->nedges++];
    memset(v, 0, sizeof *v);
    v->kind = dup(kind); v->source = source; v->target = target;
    v->source_ref = -1; v->site = site;
    return v;
}

void sem_result_free(SemResult *r) {
    for (int i = 0; i < r->nsymbols; i++) {
        SemSymbol *v = &r->symbols[i];
        free(v->name); free(v->kind); free(v->qualified_name); free(v->signature);
        free(v->documentation); free(v->visibility); free(v->modifiers);
        free(v->decorators); free(v->generic_params); free(v->result_type);
        free(v->scope_key);
    }
    for (int i = 0; i < r->nreferences; i++) {
        SemReference *v = &r->references[i];
        free(v->text); free(v->kind); free(v->qualifier); free(v->strategy);
        free(v->evidence);
    }
    for (int i = 0; i < r->nbindings; i++) {
        SemBinding *v = &r->bindings[i];
        free(v->module); free(v->local_name); free(v->original_name);
        free(v->kind); free(v->exported_name); free(v->scope_key);
        free(v->evidence);
    }
    for (int i = 0; i < r->ntype_facts; i++) {
        SemTypeFact *v = &r->type_facts[i];
        free(v->name); free(v->kind); free(v->value); free(v->evidence);
    }
    for (int i = 0; i < r->nedges; i++) {
        SemEdge *v = &r->edges[i];
        free(v->kind); free(v->original_text); free(v->strategy);
        free(v->provenance); free(v->evidence); free(v->channel);
        free(v->registration_path);
    }
    free(r->symbols); free(r->references); free(r->bindings);
    free(r->type_facts); free(r->edges); free(r->parser_id);
    memset(r, 0, sizeof *r);
}

static const char *SEM_SCHEMA =
    "CREATE TABLE IF NOT EXISTS semantic_symbols("
    "symbol_id INTEGER PRIMARY KEY,file_id INTEGER NOT NULL,ordinal INTEGER NOT NULL,"
    "qualified_name TEXT,parent_id INTEGER,start_byte INTEGER,end_byte INTEGER,"
    "start_line INTEGER,start_column INTEGER,end_line INTEGER,end_column INTEGER,"
    "documentation TEXT,visibility TEXT,modifiers TEXT,decorators TEXT,"
    "generic_params TEXT,result_type TEXT,scope_key TEXT,exported INTEGER,parser_id TEXT);"
    "CREATE INDEX IF NOT EXISTS idx_sem_symbol_file ON semantic_symbols(file_id,ordinal);"
    "CREATE INDEX IF NOT EXISTS idx_sem_symbol_qualified ON semantic_symbols(qualified_name);"
    "CREATE INDEX IF NOT EXISTS idx_sem_symbol_parent ON semantic_symbols(parent_id);"
    "CREATE TABLE IF NOT EXISTS semantic_references("
    "ref_id INTEGER PRIMARY KEY,file_id INTEGER NOT NULL,ordinal INTEGER NOT NULL,"
    "owner_id INTEGER,target_id INTEGER,original_text TEXT,kind TEXT,qualifier TEXT,"
    "start_byte INTEGER,end_byte INTEGER,start_line INTEGER,start_column INTEGER,"
    "end_line INTEGER,end_column INTEGER,strategy TEXT,evidence TEXT,argc INTEGER);"
    "CREATE INDEX IF NOT EXISTS idx_sem_ref_file ON semantic_references(file_id,ordinal);"
    "CREATE INDEX IF NOT EXISTS idx_sem_ref_target ON semantic_references(target_id);"
    "CREATE TABLE IF NOT EXISTS semantic_bindings("
    "id INTEGER PRIMARY KEY,file_id INTEGER NOT NULL,owner_id INTEGER,"
    "module TEXT,local_name TEXT,original_name TEXT,kind TEXT,exported_name TEXT,"
    "scope_key TEXT,evidence TEXT,is_export INTEGER,is_system INTEGER,"
    "start_byte INTEGER,end_byte INTEGER,start_line INTEGER,start_column INTEGER,"
    "end_line INTEGER,end_column INTEGER,target_file_id INTEGER,target_symbol_id INTEGER);"
    "CREATE INDEX IF NOT EXISTS idx_sem_binding_file ON semantic_bindings(file_id);"
    "CREATE INDEX IF NOT EXISTS idx_sem_binding_module ON semantic_bindings(module);"
    "CREATE INDEX IF NOT EXISTS idx_sem_binding_target ON semantic_bindings(target_file_id);"
    "CREATE TABLE IF NOT EXISTS semantic_type_facts("
    "id INTEGER PRIMARY KEY,file_id INTEGER NOT NULL,owner_id INTEGER,"
    "name TEXT,kind TEXT,value TEXT,evidence TEXT,"
    "start_byte INTEGER,end_byte INTEGER,start_line INTEGER,start_column INTEGER,"
    "end_line INTEGER,end_column INTEGER);"
    "CREATE INDEX IF NOT EXISTS idx_sem_type_file ON semantic_type_facts(file_id);"
    "CREATE INDEX IF NOT EXISTS idx_sem_type_owner ON semantic_type_facts(owner_id,kind);"
    "CREATE TABLE IF NOT EXISTS semantic_edges("
    "id INTEGER PRIMARY KEY,branch_id INTEGER NOT NULL,source_file_id INTEGER NOT NULL,"
    "target_file_id INTEGER,source_id INTEGER,target_id INTEGER,source_ref_id INTEGER,"
    "kind TEXT NOT NULL,original_text TEXT,strategy TEXT,provenance TEXT,evidence TEXT,"
    "channel TEXT,registration_path TEXT,"
    "start_byte INTEGER,end_byte INTEGER,start_line INTEGER,start_column INTEGER,"
    "end_line INTEGER,end_column INTEGER,registration_start_byte INTEGER,"
    "registration_end_byte INTEGER,registration_line INTEGER,registration_column INTEGER,"
    "registration_end_line INTEGER,registration_end_column INTEGER,"
    "synthesized INTEGER NOT NULL DEFAULT 0);"
    "CREATE INDEX IF NOT EXISTS idx_sem_edge_source ON semantic_edges(branch_id,source_id,kind);"
    "CREATE INDEX IF NOT EXISTS idx_sem_edge_target ON semantic_edges(branch_id,target_id,kind);"
    "CREATE INDEX IF NOT EXISTS idx_sem_edge_file ON semantic_edges(branch_id,source_file_id);"
    "CREATE INDEX IF NOT EXISTS idx_sem_edge_target_file ON semantic_edges(branch_id,target_file_id);"
    "CREATE INDEX IF NOT EXISTS idx_sem_edge_channel ON semantic_edges(branch_id,channel,kind);"
    "CREATE TABLE IF NOT EXISTS semantic_dependencies("
    "id INTEGER PRIMARY KEY,branch_id INTEGER NOT NULL,file_id INTEGER NOT NULL,"
    "dependency_key TEXT NOT NULL,dependency_hash TEXT,kind TEXT NOT NULL,"
    "UNIQUE(branch_id,file_id,dependency_key,kind));"
    "CREATE INDEX IF NOT EXISTS idx_sem_dep_key ON semantic_dependencies(branch_id,dependency_key);"
    "CREATE TRIGGER IF NOT EXISTS sem_edge_branch_insert BEFORE INSERT ON semantic_edges "
    "BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM files f WHERE f.id=NEW.source_file_id "
    "AND f.branch_id=NEW.branch_id) OR (NEW.target_file_id IS NOT NULL AND NOT EXISTS "
    "(SELECT 1 FROM files f WHERE f.id=NEW.target_file_id AND f.branch_id=NEW.branch_id)) "
    "OR (NEW.source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM symbols s "
    "WHERE s.id=NEW.source_id AND s.file_id=NEW.source_file_id)) "
    "OR (NEW.target_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM symbols s "
    "JOIN files f ON f.id=s.file_id WHERE s.id=NEW.target_id AND "
    "f.branch_id=NEW.branch_id AND (NEW.target_file_id IS NULL OR "
    "s.file_id=NEW.target_file_id))) "
    "THEN RAISE(ABORT,'semantic edge crosses branch or file') END; END;"
    "CREATE TRIGGER IF NOT EXISTS sem_edge_branch_update BEFORE UPDATE ON semantic_edges "
    "BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM files f WHERE f.id=NEW.source_file_id "
    "AND f.branch_id=NEW.branch_id) OR (NEW.target_file_id IS NOT NULL AND NOT EXISTS "
    "(SELECT 1 FROM files f WHERE f.id=NEW.target_file_id AND f.branch_id=NEW.branch_id)) "
    "OR (NEW.source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM symbols s "
    "WHERE s.id=NEW.source_id AND s.file_id=NEW.source_file_id)) "
    "OR (NEW.target_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM symbols s "
    "JOIN files f ON f.id=s.file_id WHERE s.id=NEW.target_id AND "
    "f.branch_id=NEW.branch_id AND (NEW.target_file_id IS NULL OR "
    "s.file_id=NEW.target_file_id))) "
    "THEN RAISE(ABORT,'semantic edge crosses branch or file') END; END;";

extern int sem_search_schema_init(Cg *cg) __attribute__((weak));
extern int sem_search_file_replace(Cg *cg, long file_id) __attribute__((weak));
extern int sem_search_file_copy(Cg *cg, long source_file_id,
                                long dest_file_id) __attribute__((weak));
extern int sem_search_file_purge(Cg *cg, long file_id) __attribute__((weak));
extern int sem_routes_purge_file(Cg *cg, long file_id) __attribute__((weak));
int sem_schema_init(Cg *cg) {
    cg_exec(cg, SEM_SCHEMA);
    return sem_search_schema_init ? sem_search_schema_init(cg) : 0;
}

static void bind_text(sqlite3_stmt *q, int n, const char *s) {
    if (s) sqlite3_bind_text(q, n, s, -1, SQLITE_TRANSIENT);
    else sqlite3_bind_null(q, n);
}
static void bind_id(sqlite3_stmt *q, int n, long id) {
    if (id > 0) sqlite3_bind_int64(q, n, id);
    else sqlite3_bind_null(q, n);
}
static void bind_span(sqlite3_stmt *q, int n, SemSpan s) {
    sqlite3_bind_int64(q,n++, (sqlite3_int64)s.start_byte);
    sqlite3_bind_int64(q,n++, (sqlite3_int64)s.end_byte);
    sqlite3_bind_int(q,n++,s.line); sqlite3_bind_int(q,n++,s.column);
    sqlite3_bind_int(q,n++,s.end_line); sqlite3_bind_int(q,n,s.end_column);
}
static _Thread_local int semantic_error;
static void done(Cg *cg, sqlite3_stmt *q) {
    int rc = sqlite3_step(q);
    if (rc != SQLITE_DONE) {
        fprintf(stderr, "cg: semantic store: %s\n", sqlite3_errmsg(cg->db));
        semantic_error = 1;
    }
    sqlite3_reset(q); sqlite3_clear_bindings(q);
}

/* Called before deleting symbol rows: incoming resolved edges and bindings
 * must lose stale targets even when their source files are unchanged. */
int sem_file_purge(Cg *cg, long file_id) {
    semantic_error = 0;
    if (sem_routes_purge_file && sem_routes_purge_file(cg,file_id)!=0)
        return -1;
    if (sem_search_file_purge && sem_search_file_purge(cg,file_id)!=0)
        return -1;
    sqlite3_stmt *q = cg_prep(cg,
        "UPDATE semantic_references SET target_id=NULL,strategy=NULL,evidence=NULL "
        "WHERE target_id IN (SELECT id FROM symbols WHERE file_id=?1)");
    sqlite3_bind_int64(q,1,file_id); done(cg,q); sqlite3_finalize(q);
    q = cg_prep(cg,"UPDATE semantic_bindings SET target_symbol_id=NULL "
                   "WHERE target_symbol_id IN (SELECT id FROM symbols WHERE file_id=?1)");
    sqlite3_bind_int64(q,1,file_id); done(cg,q); sqlite3_finalize(q);
    q = cg_prep(cg,"UPDATE semantic_bindings SET target_file_id=NULL "
                   "WHERE target_file_id=?1");
    sqlite3_bind_int64(q,1,file_id); done(cg,q); sqlite3_finalize(q);
    q = cg_prep(cg,"DELETE FROM semantic_edges WHERE source_file_id=?1 "
                   "OR target_file_id=?1 OR source_id IN "
                   "(SELECT id FROM symbols WHERE file_id=?1) OR target_id IN "
                   "(SELECT id FROM symbols WHERE file_id=?1)");
    sqlite3_bind_int64(q,1,file_id); done(cg,q); sqlite3_finalize(q);
    const char *tables[] = {"semantic_dependencies", "semantic_type_facts",
                            "semantic_bindings", "semantic_references",
                            "semantic_symbols"};
    for (size_t i=0;i<sizeof tables/sizeof *tables;i++) {
        char sql[128];
        snprintf(sql,sizeof sql,"DELETE FROM %s WHERE file_id=?1",tables[i]);
        q = cg_prep(cg,sql); sqlite3_bind_int64(q,1,file_id);
        done(cg,q); sqlite3_finalize(q);
    }
    return semantic_error ? -1 : 0;
}

static long mapped(const long *ids, int n, int index) {
    return index >= 0 && index < n ? ids[index] : 0;
}

int sem_file_replace(Cg *cg, long file_id, const SemResult *r,
                     const long *legacy_symbol_ids, int nlegacy_symbols,
                     const long *legacy_ref_ids, int nlegacy_refs) {
    if (!r) return 0;
    semantic_error = 0;
    long *syms = r->nsymbols ? xmalloc((size_t)r->nsymbols*sizeof *syms) : NULL;
    long *refs = r->nreferences ? xmalloc((size_t)r->nreferences*sizeof *refs) : NULL;
    sqlite3_stmt *q = cg_prep(cg,"INSERT INTO symbols(file_id,name,kind,line,end_line,sig,decl) "
                                    "VALUES(?1,?2,?3,?4,?5,?6,?7)");
    for (int i=0;i<r->nsymbols;i++) {
        const SemSymbol *s=&r->symbols[i];
        long id=mapped(legacy_symbol_ids,nlegacy_symbols,s->legacy_def);
        if (!id) {
            sqlite3_bind_int64(q,1,file_id); bind_text(q,2,s->name);
            bind_text(q,3,s->kind); sqlite3_bind_int(q,4,s->span.line);
            sqlite3_bind_int(q,5,s->span.end_line);
            bind_text(q,6,s->signature); sqlite3_bind_int(q,7,s->declaration);
            done(cg,q); id=sqlite3_last_insert_rowid(cg->db);
        }
        syms[i]=id;
    }
    sqlite3_finalize(q);
    q=cg_prep(cg,"INSERT INTO semantic_symbols(symbol_id,file_id,ordinal,"
                 "qualified_name,parent_id,start_byte,end_byte,start_line,start_column,"
                 "end_line,end_column,documentation,visibility,modifiers,decorators,"
                 "generic_params,result_type,scope_key,exported,parser_id)"
                 " VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)");
    for (int i=0;i<r->nsymbols;i++) {
        const SemSymbol *s=&r->symbols[i];
        bind_id(q,1,syms[i]); sqlite3_bind_int64(q,2,file_id);
        sqlite3_bind_int(q,3,i); bind_text(q,4,s->qualified_name);
        bind_id(q,5,mapped(syms,r->nsymbols,s->parent)); bind_span(q,6,s->span);
        bind_text(q,12,s->documentation); bind_text(q,13,s->visibility);
        bind_text(q,14,s->modifiers); bind_text(q,15,s->decorators);
        bind_text(q,16,s->generic_params); bind_text(q,17,s->result_type);
        bind_text(q,18,s->scope_key); sqlite3_bind_int(q,19,s->exported);
        bind_text(q,20,r->parser_id); done(cg,q);
    }
    sqlite3_finalize(q);
    q=cg_prep(cg,"INSERT INTO refs(file_id,name,line,sym_id,qual,kind,argc) "
                 "VALUES(?1,?2,?3,?4,?5,?6,?7)");
    for (int i=0;i<r->nreferences;i++) {
        const SemReference *v=&r->references[i];
        long id=mapped(legacy_ref_ids,nlegacy_refs,v->legacy_ref);
        if (!id) {
            sqlite3_bind_int64(q,1,file_id); bind_text(q,2,v->text);
            sqlite3_bind_int(q,3,v->span.line);
            bind_id(q,4,mapped(syms,r->nsymbols,v->owner));
            bind_text(q,5,v->qualifier); bind_text(q,6,v->kind);
            sqlite3_bind_int(q,7,v->argc); done(cg,q);
            id=sqlite3_last_insert_rowid(cg->db);
        }
        refs[i]=id;
    }
    sqlite3_finalize(q);
    q=cg_prep(cg,"INSERT INTO semantic_references(ref_id,file_id,ordinal,"
                 "owner_id,target_id,original_text,kind,qualifier,start_byte,end_byte,"
                 "start_line,start_column,end_line,end_column,strategy,evidence,argc) "
                 "VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)");
    for (int i=0;i<r->nreferences;i++) {
        const SemReference *v=&r->references[i];
        bind_id(q,1,refs[i]); sqlite3_bind_int64(q,2,file_id);
        sqlite3_bind_int(q,3,i); bind_id(q,4,mapped(syms,r->nsymbols,v->owner));
        bind_id(q,5,mapped(syms,r->nsymbols,v->target)); bind_text(q,6,v->text);
        bind_text(q,7,v->kind); bind_text(q,8,v->qualifier);
        bind_span(q,9,v->span); bind_text(q,15,v->strategy);
        bind_text(q,16,v->evidence); sqlite3_bind_int(q,17,v->argc); done(cg,q);
    }
    sqlite3_finalize(q);
    q=cg_prep(cg,"INSERT INTO semantic_bindings(file_id,owner_id,module,local_name,"
                 "original_name,kind,exported_name,scope_key,evidence,is_export,is_system,"
                 "start_byte,end_byte,start_line,start_column,end_line,end_column)"
                 " VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)");
    for (int i=0;i<r->nbindings;i++) {
        const SemBinding *v=&r->bindings[i];
        sqlite3_bind_int64(q,1,file_id); bind_id(q,2,mapped(syms,r->nsymbols,v->owner));
        bind_text(q,3,v->module); bind_text(q,4,v->local_name);
        bind_text(q,5,v->original_name); bind_text(q,6,v->kind);
        bind_text(q,7,v->exported_name); bind_text(q,8,v->scope_key);
        bind_text(q,9,v->evidence); sqlite3_bind_int(q,10,v->is_export);
        sqlite3_bind_int(q,11,v->is_system); bind_span(q,12,v->span); done(cg,q);
    }
    sqlite3_finalize(q);
    q=cg_prep(cg,"INSERT INTO semantic_type_facts(file_id,owner_id,name,kind,value,"
                 "evidence,start_byte,end_byte,start_line,start_column,end_line,end_column)"
                 " VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)");
    for (int i=0;i<r->ntype_facts;i++) {
        const SemTypeFact *v=&r->type_facts[i];
        sqlite3_bind_int64(q,1,file_id); bind_id(q,2,mapped(syms,r->nsymbols,v->owner));
        bind_text(q,3,v->name); bind_text(q,4,v->kind); bind_text(q,5,v->value);
        bind_text(q,6,v->evidence); bind_span(q,7,v->span); done(cg,q);
    }
    sqlite3_finalize(q);
    q=cg_prep(cg,"INSERT INTO semantic_edges(branch_id,source_file_id,target_file_id,"
                 "source_id,target_id,source_ref_id,kind,original_text,strategy,provenance,"
                 "evidence,channel,registration_path,start_byte,end_byte,start_line,"
                 "start_column,end_line,end_column,registration_start_byte,"
                 "registration_end_byte,registration_line,registration_column,"
                 "registration_end_line,registration_end_column,synthesized)"
                 " VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26)");
    for (int i=0;i<r->nedges;i++) {
        const SemEdge *v=&r->edges[i];
        sqlite3_bind_int64(q,1,cg->branch_id); sqlite3_bind_int64(q,2,file_id);
        if (v->target>=0 && v->target<r->nsymbols) sqlite3_bind_int64(q,3,file_id);
        bind_id(q,4,mapped(syms,r->nsymbols,v->source));
        bind_id(q,5,mapped(syms,r->nsymbols,v->target));
        bind_id(q,6,mapped(refs,r->nreferences,v->source_ref));
        bind_text(q,7,v->kind); bind_text(q,8,v->original_text);
        bind_text(q,9,v->strategy); bind_text(q,10,v->provenance);
        bind_text(q,11,v->evidence); bind_text(q,12,v->channel);
        bind_text(q,13,v->registration_path); bind_span(q,14,v->site);
        bind_span(q,20,v->registration_site);
        sqlite3_bind_int(q,26,v->synthesized); done(cg,q);
    }
    sqlite3_finalize(q); free(syms); free(refs);
    if (semantic_error) return -1;
    return sem_search_file_replace ? sem_search_file_replace(cg,file_id) : 0;
}

/* A copy must remap endpoint ids by file-local ordinal; names and line
 * numbers do not uniquely identify overloads. Resolved cross-file links are
 * deliberately retried by the incremental resolver after the copy. */
int sem_file_copy(Cg *cg, long file_id, long twin_file_id) {
    semantic_error = 0;
    cg_exec(cg,"CREATE TEMP TABLE IF NOT EXISTS sem_copy_symbols(old_id INTEGER PRIMARY KEY,new_id INTEGER);");
    cg_exec(cg,"CREATE TEMP TABLE IF NOT EXISTS sem_copy_refs(old_id INTEGER PRIMARY KEY,new_id INTEGER);");
    cg_exec(cg,"DELETE FROM temp.sem_copy_symbols;DELETE FROM temp.sem_copy_refs;");
    sqlite3_stmt *q=cg_prep(cg,
        "INSERT INTO temp.sem_copy_symbols(old_id,new_id) "
        "SELECT a.id,b.id FROM (SELECT id,row_number() OVER (ORDER BY id) n "
        "FROM symbols WHERE file_id=?1) a JOIN "
        "(SELECT id,row_number() OVER (ORDER BY id) n FROM symbols WHERE file_id=?2) b USING(n)");
    sqlite3_bind_int64(q,1,twin_file_id); sqlite3_bind_int64(q,2,file_id);
    done(cg,q); sqlite3_finalize(q);
    q=cg_prep(cg,
        "INSERT INTO temp.sem_copy_refs(old_id,new_id) "
        "SELECT a.id,b.id FROM (SELECT id,row_number() OVER (ORDER BY id) n "
        "FROM refs WHERE file_id=?1 AND kind<>'soft') a JOIN "
        "(SELECT id,row_number() OVER (ORDER BY id) n FROM refs "
        "WHERE file_id=?2 AND kind<>'soft') b USING(n)");
    sqlite3_bind_int64(q,1,twin_file_id); sqlite3_bind_int64(q,2,file_id);
    done(cg,q); sqlite3_finalize(q);
    const char *queries[] = {
        "INSERT INTO semantic_symbols SELECT m.new_id,?1,a.ordinal,a.qualified_name,"
        "p.new_id,a.start_byte,a.end_byte,a.start_line,a.start_column,a.end_line,"
        "a.end_column,a.documentation,a.visibility,a.modifiers,a.decorators,"
        "a.generic_params,a.result_type,a.scope_key,a.exported,a.parser_id "
        "FROM semantic_symbols a JOIN temp.sem_copy_symbols m ON m.old_id=a.symbol_id "
        "LEFT JOIN temp.sem_copy_symbols p ON p.old_id=a.parent_id WHERE a.file_id=?2",
        "INSERT INTO semantic_references SELECT m.new_id,?1,a.ordinal,o.new_id,NULL,"
        "a.original_text,a.kind,a.qualifier,a.start_byte,a.end_byte,a.start_line,"
        "a.start_column,a.end_line,a.end_column,NULL,NULL,a.argc "
        "FROM semantic_references a JOIN temp.sem_copy_refs m ON m.old_id=a.ref_id "
        "LEFT JOIN temp.sem_copy_symbols o ON o.old_id=a.owner_id WHERE a.file_id=?2",
        "INSERT INTO semantic_bindings(file_id,owner_id,module,local_name,original_name,"
        "kind,exported_name,scope_key,evidence,is_export,is_system,start_byte,"
        "end_byte,start_line,start_column,end_line,end_column) "
        "SELECT ?1,m.new_id,a.module,a.local_name,a.original_name,a.kind,"
        "a.exported_name,a.scope_key,a.evidence,a.is_export,a.is_system,"
        "a.start_byte,a.end_byte,a.start_line,a.start_column,a.end_line,a.end_column "
        "FROM semantic_bindings a LEFT JOIN temp.sem_copy_symbols m ON m.old_id=a.owner_id "
        "WHERE a.file_id=?2",
        "INSERT INTO semantic_type_facts(file_id,owner_id,name,kind,value,evidence,"
        "start_byte,end_byte,start_line,start_column,end_line,end_column) "
        "SELECT ?1,m.new_id,a.name,a.kind,a.value,a.evidence,a.start_byte,a.end_byte,"
        "a.start_line,a.start_column,a.end_line,a.end_column FROM semantic_type_facts a "
        "LEFT JOIN temp.sem_copy_symbols m ON m.old_id=a.owner_id WHERE a.file_id=?2",
        "INSERT INTO semantic_edges(branch_id,source_file_id,target_file_id,source_id,"
        "target_id,source_ref_id,kind,original_text,strategy,provenance,evidence,"
        "channel,registration_path,start_byte,end_byte,start_line,start_column,"
        "end_line,end_column,registration_start_byte,registration_end_byte,"
        "registration_line,registration_column,registration_end_line,"
        "registration_end_column,synthesized) SELECT ?3,?1,CASE WHEN a.target_id "
        "IS NOT NULL THEN ?1 ELSE NULL END,s.new_id,t.new_id,r.new_id,a.kind,"
        "a.original_text,a.strategy,a.provenance,a.evidence,a.channel,"
        "a.registration_path,a.start_byte,a.end_byte,a.start_line,a.start_column,"
        "a.end_line,a.end_column,a.registration_start_byte,a.registration_end_byte,"
        "a.registration_line,a.registration_column,a.registration_end_line,"
        "a.registration_end_column,a.synthesized FROM semantic_edges a "
        "LEFT JOIN temp.sem_copy_symbols s ON s.old_id=a.source_id "
        "LEFT JOIN temp.sem_copy_symbols t ON t.old_id=a.target_id "
        "LEFT JOIN temp.sem_copy_refs r ON r.old_id=a.source_ref_id "
        "WHERE a.source_file_id=?2 AND a.synthesized=0 "
        "AND (a.target_id IS NULL OR t.new_id IS NOT NULL)"
    };
    for (size_t i=0;i<sizeof queries/sizeof *queries;i++) {
        q=cg_prep(cg,queries[i]); sqlite3_bind_int64(q,1,file_id);
        sqlite3_bind_int64(q,2,twin_file_id);
        sqlite3_bind_int64(q,3,cg->branch_id); done(cg,q); sqlite3_finalize(q);
    }
    if (semantic_error) return -1;
    return sem_search_file_copy ? sem_search_file_copy(cg,twin_file_id,file_id) : 0;
}

#define SEM_MAX_PASSES 16
static struct { const char *name; int order; SemPassFn fn; } passes[SEM_MAX_PASSES];
static int npasses;
/* Optional modules join the pass sequence when linked into the executable.
 * A missing module leaves its capability absent, without a link failure. */
extern void sem_imports_register(void) __attribute__((weak));
extern void sem_resolve_register(void) __attribute__((weak));
extern void sem_types_register(void) __attribute__((weak));
extern void sem_routes_register(void) __attribute__((weak));
extern void sem_dispatch_register(void) __attribute__((weak));
extern void sem_channels_register(void) __attribute__((weak));
static void register_available(void) {
    static bool once;
    if (once) return;
    once = true;
    if (sem_imports_register) sem_imports_register();
    if (sem_resolve_register) sem_resolve_register();
    if (sem_types_register) sem_types_register();
    if (sem_routes_register) sem_routes_register();
    if (sem_dispatch_register) sem_dispatch_register();
    if (sem_channels_register) sem_channels_register();
}
int sem_pass_register(const char *name, int order, SemPassFn fn) {
    if (!name || !fn || npasses == SEM_MAX_PASSES) return -1;
    for (int i=0;i<npasses;i++) if (strcmp(passes[i].name,name)==0) return -1;
    int at=npasses++;
    while (at>0 && passes[at-1].order>order) { passes[at]=passes[at-1]; at--; }
    passes[at].name=name; passes[at].order=order; passes[at].fn=fn;
    return 0;
}
int sem_pass_run(Cg *cg, const long *changed_files, int nfiles) {
    register_available();
    if (changed_files && nfiles==0) return 0;
    for (int i=0;i<npasses;i++)
        if (passes[i].fn(cg,changed_files,nfiles)!=0) return -1;
    return 0;
}
