#include "cg.h"
#include "sem_types.h"

#include <ctype.h>

#define TYPE_MAX_CANDIDATES 64
#define TYPE_MAX_WALK 256

static const char *relation_kind(const char *kind) {
    if (!kind) return NULL;
    static const char *const kinds[] = {
        "inherits", "implements", "type", "returns", "instantiates",
        "overrides", "decorates", "exports", NULL
    };
    for (int i = 0; kinds[i]; i++)
        if (strcmp(kind, kinds[i]) == 0) return kinds[i];
    return NULL;
}

static bool is_type_kind(const char *s) {
    return s && (!strcmp(s,"class") || !strcmp(s,"interface") ||
                 !strcmp(s,"struct") || !strcmp(s,"trait") ||
                 !strcmp(s,"enum") || !strcmp(s,"type") ||
                 !strcmp(s,"object") || !strcmp(s,"protocol") ||
                 !strcmp(s,"type_alias") || !strcmp(s,"typedef") ||
                 !strcmp(s,"record") || !strcmp(s,"union"));
}

/* Strip type arguments, nullable/array suffixes and C++ access markers.
 * Composite and dynamic types have no single defensible target. */
static bool canonical_name(const char *src, char out[256]) {
    if (!src) return false;
    while (isspace((unsigned char)*src)) src++;
    if (*src==':') { src++; while (isspace((unsigned char)*src)) src++; }
    if (src[0]=='-' && src[1]=='>') {
        src+=2; while (isspace((unsigned char)*src)) src++;
    }
    if (*src=='@') src++;
    if (!strncmp(src,"virtual ",8)) src+=8;
    if (!strncmp(src,"public ",7)) src += 7;
    else if (!strncmp(src,"protected ",10)) src += 10;
    else if (!strncmp(src,"private ",8)) src += 8;
    while (isspace((unsigned char)*src)) src++;
    size_t n = 0;
    while (src[n] && n < 255) {
        unsigned char c = (unsigned char)src[n];
        if (isalnum(c) || c == '_' || c == '.' || c == ':' || c == '$') n++;
        else break;
    }
    if (!n || n == 255) return false;
    memcpy(out,src,n); out[n] = 0;
    while (isspace((unsigned char)src[n])) n++;
    if (src[n] && src[n]!='<' && src[n]!='[' && src[n]!='?' &&
        src[n]!='*' && src[n]!='&') return false;
    return true;
}

typedef struct { long id, file_id, parent_id; int score; } Candidate;

static bool candidate_allowed(const char *relation, const char *kind,
                              const char *visibility, long from_file,
                              long target_file) {
    if ((!strcmp(relation,"inherits") || !strcmp(relation,"implements") ||
         !strcmp(relation,"type") || !strcmp(relation,"returns") ||
         !strcmp(relation,"instantiates")) && !is_type_kind(kind)) return false;
    if (!strcmp(relation,"implements") && kind &&
        strcmp(kind,"interface") && strcmp(kind,"trait") &&
        strcmp(kind,"protocol")) return false;
    if (!strcmp(relation,"overrides") && is_type_kind(kind)) return false;
    if (visibility && (!strcmp(visibility,"private") ||
                       !strcmp(visibility,"fileprivate")) &&
        from_file != target_file) return false;
    return true;
}

/* Exact qualification wins; otherwise lexical parent, same file and a
 * resolved import are positive evidence. Repository-wide equal candidates
 * abstain. We never use row order as a tie break. */
static long resolve_target(Cg *cg, long owner_id, long file_id,
                           const char *relation, const char *spelling,
                           const char **strategy) {
    char name[256];
    if (!canonical_name(spelling,name)) return 0;
    const char *base = strrchr(name,'.');
    const char *colon = strrchr(name,':');
    if (colon && (!base || colon > base)) base = colon;
    base = base ? base+1 : name;
    sqlite3_stmt *q = cg_prep(cg,
        "SELECT s.id,s.file_id,COALESCE(ss.parent_id,0),s.kind,"
        "ss.qualified_name,ss.visibility,"
        "COALESCE((SELECT 1 FROM semantic_bindings b WHERE b.file_id=?2 "
        "AND b.target_symbol_id=s.id LIMIT 1),0) "
        "FROM symbols s JOIN files f ON f.id=s.file_id "
        "JOIN semantic_symbols ss ON ss.symbol_id=s.id "
        "WHERE f.branch_id=?1 AND (s.name=?3 OR ss.qualified_name=?4) "
        "LIMIT 65");
    sqlite3_bind_int64(q,1,cg->branch_id);
    sqlite3_bind_int64(q,2,file_id);
    sqlite3_bind_text(q,3,base,-1,SQLITE_TRANSIENT);
    sqlite3_bind_text(q,4,name,-1,SQLITE_TRANSIENT);
    Candidate best = {0}; int count = 0, ties = 0;
    while (sqlite3_step(q) == SQLITE_ROW) {
        if (++count > TYPE_MAX_CANDIDATES) { best.id=0; break; }
        long id=sqlite3_column_int64(q,0), target_file=sqlite3_column_int64(q,1);
        long parent=sqlite3_column_int64(q,2);
        const char *kind=(const char *)sqlite3_column_text(q,3);
        const char *qualified=(const char *)sqlite3_column_text(q,4);
        const char *visibility=(const char *)sqlite3_column_text(q,5);
        if (id == owner_id || !candidate_allowed(relation,kind,visibility,file_id,target_file)) continue;
        int score=0;
        if (qualified && strcmp(qualified,name)==0) score+=100;
        if (target_file==file_id) score+=20;
        if (parent==owner_id && parent) score+=30;
        if (sqlite3_column_int(q,6)) score+=25;
        if (score>best.score) {
            best=(Candidate){id,target_file,parent,score}; ties=1;
        } else if (score==best.score) ties++;
    }
    sqlite3_finalize(q);
    if (count>TYPE_MAX_CANDIDATES || ties!=1 || !best.id) return 0;
    *strategy = best.score>=100 ? "qualified" :
                best.parent_id==owner_id && owner_id ? "lexical" :
                best.file_id==file_id ? "same_file" : "import_binding";
    /* Unqualified global names require a real locality or import signal. */
    if (best.score<20) return 0;
    return best.id;
}

/* An override can only target a member owned by a proven ancestor. Equal
 * candidates, including overloads we cannot distinguish, remain unresolved. */
static long resolve_override(Cg *cg,long method,const char *spelling) {
    char name[256]; if (!canonical_name(spelling,name)) return 0;
    sqlite3_stmt *q=cg_prep(cg,
        "SELECT ss.parent_id FROM semantic_symbols ss JOIN files f ON f.id=ss.file_id "
        "WHERE ss.symbol_id=?1 AND f.branch_id=?2");
    sqlite3_bind_int64(q,1,method); sqlite3_bind_int64(q,2,cg->branch_id);
    long owner=sqlite3_step(q)==SQLITE_ROW ? sqlite3_column_int64(q,0) : 0;
    sqlite3_finalize(q);
    if (!owner) return 0;
    long bases[TYPE_MAX_CANDIDATES];
    int n=sem_type_ancestors(cg,owner,bases,TYPE_MAX_CANDIDATES);
    if (!n) return 0;
    q=cg_prep(cg,"SELECT s.id FROM symbols s JOIN semantic_symbols ss "
        "ON ss.symbol_id=s.id JOIN files f ON f.id=s.file_id "
        "WHERE f.branch_id=?1 AND ss.parent_id=?2 AND s.name=?3 "
        "AND s.kind IN ('method','function') "
        "AND COALESCE(ss.visibility,'') NOT IN ('private','fileprivate') LIMIT 2");
    long match=0; int matches=0;
    for (int i=0;i<n && matches<2;i++) {
        sqlite3_reset(q); sqlite3_clear_bindings(q);
        sqlite3_bind_int64(q,1,cg->branch_id);
        sqlite3_bind_int64(q,2,bases[i]);
        sqlite3_bind_text(q,3,name,-1,SQLITE_TRANSIENT);
        while (sqlite3_step(q)==SQLITE_ROW && matches<2) {
            match=sqlite3_column_int64(q,0); matches++;
        }
    }
    sqlite3_finalize(q);
    return matches==1 ? match : 0;
}

static int insert_edge(Cg *cg, sqlite3_stmt *q, long source_file,
                       long target_file, long source, long target,
                       const char *kind, const char *original,
                       const char *strategy, const char *evidence,
                       sqlite3_stmt *site) {
    sqlite3_reset(q); sqlite3_clear_bindings(q);
    sqlite3_bind_int64(q,1,cg->branch_id);
    sqlite3_bind_int64(q,2,source_file);
    sqlite3_bind_int64(q,3,target_file);
    sqlite3_bind_int64(q,4,source);
    sqlite3_bind_int64(q,5,target);
    sqlite3_bind_text(q,6,kind,-1,SQLITE_TRANSIENT);
    if (original) sqlite3_bind_text(q,7,original,-1,SQLITE_TRANSIENT);
    sqlite3_bind_text(q,8,strategy,-1,SQLITE_TRANSIENT);
    sqlite3_bind_text(q,9,"resolved",-1,SQLITE_STATIC);
    if (evidence) sqlite3_bind_text(q,10,evidence,-1,SQLITE_TRANSIENT);
    for (int i=0;i<6;i++) sqlite3_bind_value(q,11+i,sqlite3_column_value(site,7+i));
    return sqlite3_step(q)==SQLITE_DONE ? 0 : -1;
}

int sem_types_run(Cg *cg, const long *changed_files, int nfiles) {
    if (changed_files && nfiles==0) return 0;
    if (!cg || !cg->branch_id) return -1;
    if (changed_files) {
        sqlite3_stmt *scope=cg_prep(cg,
            "CREATE TEMP TABLE IF NOT EXISTS sem_type_scope(file_id INTEGER PRIMARY KEY)");
        int rc=sqlite3_step(scope); sqlite3_finalize(scope);
        if (rc!=SQLITE_DONE) return -1;
        scope=cg_prep(cg,"DELETE FROM temp.sem_type_scope");
        rc=sqlite3_step(scope); sqlite3_finalize(scope);
        if (rc!=SQLITE_DONE) return -1;
        scope=cg_prep(cg,"INSERT OR IGNORE INTO temp.sem_type_scope(file_id) VALUES(?1)");
        for (int i=0;i<nfiles;i++) {
            if (changed_files[i]<=0) continue;
            sqlite3_reset(scope); sqlite3_clear_bindings(scope);
            sqlite3_bind_int64(scope,1,changed_files[i]);
            if (sqlite3_step(scope)!=SQLITE_DONE) { sqlite3_finalize(scope); return -1; }
        }
        sqlite3_finalize(scope);
    }
    /* Replace source-owned edges only. The caller supplies changed files and
     * their reverse dependents; a full pass recomputes the whole branch. */
    sqlite3_stmt *del=cg_prep(cg,changed_files ?
         "DELETE FROM semantic_edges WHERE branch_id=?1 AND strategy='type_hierarchy' "
         "AND source_file_id IN (SELECT file_id FROM temp.sem_type_scope)" :
         "DELETE FROM semantic_edges WHERE branch_id=?1 AND strategy='type_hierarchy'");
    sqlite3_bind_int64(del,1,cg->branch_id);
    int rc=sqlite3_step(del)==SQLITE_DONE ? 0 : -1;
    sqlite3_finalize(del);
    if (rc) return rc;
    sqlite3_stmt *depdel=cg_prep(cg,changed_files ?
        "DELETE FROM semantic_dependencies WHERE branch_id=?1 AND kind='type_relation' "
        "AND file_id IN (SELECT file_id FROM temp.sem_type_scope)" :
        "DELETE FROM semantic_dependencies WHERE branch_id=?1 AND kind='type_relation'");
    sqlite3_bind_int64(depdel,1,cg->branch_id);
    rc=sqlite3_step(depdel)==SQLITE_DONE ? 0 : -1;
    sqlite3_finalize(depdel);
    if (rc) return rc;
    sqlite3_stmt *dep=cg_prep(cg,
        "INSERT OR IGNORE INTO semantic_dependencies(branch_id,file_id,"
        "dependency_key,kind) VALUES(?1,?2,?3,'type_relation')");
    sqlite3_stmt *edge=cg_prep(cg,
        "INSERT INTO semantic_edges(branch_id,source_file_id,target_file_id,"
        "source_id,target_id,kind,original_text,strategy,provenance,evidence,"
        "start_byte,end_byte,start_line,start_column,end_line,end_column) "
        "VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)");
    sqlite3_stmt *parents=cg_prep(cg,changed_files ?
        "SELECT ss.symbol_id,ss.file_id,ss.parent_id,NULL,NULL,NULL,NULL,"
        "ss.start_byte,ss.end_byte,ss.start_line,ss.start_column,"
        "ss.end_line,ss.end_column FROM semantic_symbols ss "
        "JOIN files f ON f.id=ss.file_id WHERE f.branch_id=?1 "
        "AND ss.parent_id IS NOT NULL "
        "AND ss.file_id IN (SELECT file_id FROM temp.sem_type_scope)" :
        "SELECT ss.symbol_id,ss.file_id,ss.parent_id,NULL,NULL,NULL,NULL,"
        "ss.start_byte,ss.end_byte,ss.start_line,ss.start_column,"
        "ss.end_line,ss.end_column FROM semantic_symbols ss "
        "JOIN files f ON f.id=ss.file_id WHERE f.branch_id=?1 "
        "AND ss.parent_id IS NOT NULL");
    sqlite3_stmt *already=cg_prep(cg,
        "SELECT 1 FROM semantic_edges WHERE branch_id=?1 AND source_id=?2 "
        "AND target_id=?3 AND kind='contains' LIMIT 1");
    sqlite3_bind_int64(parents,1,cg->branch_id);
    while (!rc && sqlite3_step(parents)==SQLITE_ROW) {
        long child=sqlite3_column_int64(parents,0), file=sqlite3_column_int64(parents,1);
        long parent=sqlite3_column_int64(parents,2);
        sqlite3_reset(already); sqlite3_clear_bindings(already);
        sqlite3_bind_int64(already,1,cg->branch_id);
        sqlite3_bind_int64(already,2,parent);
        sqlite3_bind_int64(already,3,child);
        if (sqlite3_step(already)==SQLITE_ROW) continue;
        /* Containment follows stored parent identity within one file. */
        rc=insert_edge(cg,edge,file,file,parent,child,"contains",NULL,
                       "type_hierarchy","lexical ownership",parents);
    }
    sqlite3_finalize(already);
    sqlite3_finalize(parents);
    sqlite3_stmt *facts=cg_prep(cg,changed_files ?
        "SELECT tf.owner_id,tf.file_id,tf.kind,tf.value,tf.evidence,"
        "tf.name,tf.id,tf.start_byte,tf.end_byte,tf.start_line,"
        "tf.start_column,tf.end_line,tf.end_column FROM semantic_type_facts tf "
        "JOIN files f ON f.id=tf.file_id WHERE f.branch_id=?1 "
        "AND tf.owner_id IS NOT NULL "
        "AND tf.file_id IN (SELECT file_id FROM temp.sem_type_scope)" :
        "SELECT tf.owner_id,tf.file_id,tf.kind,tf.value,tf.evidence,"
        "tf.name,tf.id,tf.start_byte,tf.end_byte,tf.start_line,"
        "tf.start_column,tf.end_line,tf.end_column FROM semantic_type_facts tf "
        "JOIN files f ON f.id=tf.file_id WHERE f.branch_id=?1 "
        "AND tf.owner_id IS NOT NULL");
    sqlite3_bind_int64(facts,1,cg->branch_id);
    sqlite3_stmt *target_file=cg_prep(cg,"SELECT file_id FROM symbols WHERE id=?1");
    while (!rc && sqlite3_step(facts)==SQLITE_ROW) {
        long owner=sqlite3_column_int64(facts,0), file=sqlite3_column_int64(facts,1);
        const char *kind=(const char *)sqlite3_column_text(facts,2);
        const char *value=(const char *)sqlite3_column_text(facts,3);
        const char *evidence=(const char *)sqlite3_column_text(facts,4);
        if (!relation_kind(kind) || !value || !strcmp(kind,"overrides")) continue;
        char normalized[256];
        if (!canonical_name(value,normalized)) continue;
        char key[262];
        snprintf(key,sizeof key,"type:%s",normalized);
        sqlite3_reset(dep); sqlite3_clear_bindings(dep);
        sqlite3_bind_int64(dep,1,cg->branch_id);
        sqlite3_bind_int64(dep,2,file);
        sqlite3_bind_text(dep,3,key,-1,SQLITE_TRANSIENT);
        if (sqlite3_step(dep)!=SQLITE_DONE) { rc=-1; break; }
        const char *resolution=NULL;
        long target=resolve_target(cg,owner,file,kind,value,&resolution);
        if (!target) continue;
        sqlite3_reset(target_file); sqlite3_clear_bindings(target_file);
        sqlite3_bind_int64(target_file,1,target);
        if (sqlite3_step(target_file)!=SQLITE_ROW) continue;
        long dest_file=sqlite3_column_int64(target_file,0);
        /* The resolution evidence is retained as text and source span. */
        char note[256];
        snprintf(note,sizeof note,"%s; %s",resolution,evidence?evidence:"syntax type fact");
        rc=insert_edge(cg,edge,file,dest_file,owner,target,kind,value,
                       "type_hierarchy",note,facts);
    }
    sqlite3_finalize(target_file);
    sqlite3_finalize(facts);
    if (!rc) {
        sqlite3_stmt *overrides=cg_prep(cg,changed_files ?
            "SELECT tf.owner_id,tf.file_id,tf.value,tf.evidence,tf.id,tf.name,NULL,"
            "tf.start_byte,tf.end_byte,tf.start_line,tf.start_column,"
            "tf.end_line,tf.end_column FROM semantic_type_facts tf "
            "JOIN files f ON f.id=tf.file_id WHERE f.branch_id=?1 "
            "AND tf.kind='overrides' AND tf.owner_id IS NOT NULL "
            "AND tf.file_id IN (SELECT file_id FROM temp.sem_type_scope)" :
            "SELECT tf.owner_id,tf.file_id,tf.value,tf.evidence,tf.id,tf.name,NULL,"
            "tf.start_byte,tf.end_byte,tf.start_line,tf.start_column,"
            "tf.end_line,tf.end_column FROM semantic_type_facts tf "
            "JOIN files f ON f.id=tf.file_id WHERE f.branch_id=?1 "
            "AND tf.kind='overrides' AND tf.owner_id IS NOT NULL");
        sqlite3_bind_int64(overrides,1,cg->branch_id);
        sqlite3_stmt *fileq=cg_prep(cg,"SELECT file_id FROM symbols WHERE id=?1");
        while (!rc && sqlite3_step(overrides)==SQLITE_ROW) {
            long source=sqlite3_column_int64(overrides,0);
            long file=sqlite3_column_int64(overrides,1);
            const char *value=(const char *)sqlite3_column_text(overrides,2);
            const char *evidence=(const char *)sqlite3_column_text(overrides,3);
            if (!value) continue;
            long target=resolve_override(cg,source,value);
            if (!target) continue;
            sqlite3_reset(fileq); sqlite3_clear_bindings(fileq);
            sqlite3_bind_int64(fileq,1,target);
            if (sqlite3_step(fileq)!=SQLITE_ROW) continue;
            long destination=sqlite3_column_int64(fileq,0);
            rc=insert_edge(cg,edge,file,destination,source,target,
                           "overrides",value,"type_hierarchy",
                           evidence?evidence:"explicit override",overrides);
        }
        sqlite3_finalize(fileq);
        sqlite3_finalize(overrides);
    }
    sqlite3_finalize(dep);
    sqlite3_finalize(edge);
    return rc;
}

int sem_types_register(void) {
    return sem_pass_register("types",30,sem_types_run);
}

static int walk(Cg *cg,long start,long *out,int cap,bool reverse) {
    if (!cg || !out || cap<=0 || start<=0) return 0;
    if (cap>TYPE_MAX_WALK) cap=TYPE_MAX_WALK;
    long seen[TYPE_MAX_WALK+1]; int ns=1,nout=0,head=0;
    seen[0]=start;
    sqlite3_stmt *q=cg_prep(cg,reverse ?
        "SELECT source_id FROM semantic_edges WHERE branch_id=?1 AND target_id=?2 "
        "AND kind='inherits' AND strategy='type_hierarchy' LIMIT 257" :
        "SELECT target_id FROM semantic_edges WHERE branch_id=?1 AND source_id=?2 "
        "AND kind IN ('inherits','implements') AND strategy='type_hierarchy' LIMIT 257");
    while (head<ns && nout<cap) {
        sqlite3_reset(q); sqlite3_clear_bindings(q);
        sqlite3_bind_int64(q,1,cg->branch_id); sqlite3_bind_int64(q,2,seen[head++]);
        while (sqlite3_step(q)==SQLITE_ROW && nout<cap) {
            long id=sqlite3_column_int64(q,0); bool old=false;
            for (int i=0;i<ns;i++) if (seen[i]==id) { old=true; break; }
            if (old || ns>=TYPE_MAX_WALK) continue;
            seen[ns++]=id;
            out[nout++]=id;
        }
    }
    sqlite3_finalize(q);
    return nout;
}

int sem_type_ancestors(Cg *cg,long id,long *out,int cap) {
    return walk(cg,id,out,cap,false);
}
int sem_type_subtypes(Cg *cg,long id,long *out,int cap) {
    return walk(cg,id,out,cap,true);
}
int sem_type_implementations(Cg *cg,long id,long *out,int cap) {
    if (!cg || !out || cap<=0 || id<=0) return 0;
    if (cap>TYPE_MAX_WALK) cap=TYPE_MAX_WALK;
    long interfaces[TYPE_MAX_WALK]; interfaces[0]=id;
    int ni=1+sem_type_subtypes(cg,id,interfaces+1,TYPE_MAX_WALK-1);
    sqlite3_stmt *q=cg_prep(cg,
        "SELECT e.source_id FROM semantic_edges e JOIN symbols s ON s.id=e.source_id "
        "WHERE e.branch_id=?1 AND e.target_id=?2 AND e.kind='implements' "
        "AND e.strategy='type_hierarchy' AND s.kind NOT IN ('interface','trait','protocol') "
        "LIMIT 257");
    int n=0;
    for (int j=0;j<ni && n<cap;j++) {
        sqlite3_reset(q); sqlite3_clear_bindings(q);
        sqlite3_bind_int64(q,1,cg->branch_id);
        sqlite3_bind_int64(q,2,interfaces[j]);
        while (sqlite3_step(q)==SQLITE_ROW && n<cap) {
            long implementation=sqlite3_column_int64(q,0);
            bool seen=false;
            for (int i=0;i<n;i++) if (out[i]==implementation) seen=true;
            if (!seen) out[n++]=implementation;
            long descendants[TYPE_MAX_WALK];
            int nd=sem_type_subtypes(cg,implementation,descendants,cap-n);
            for (int k=0;k<nd && n<cap;k++) {
                seen=false;
                for (int i=0;i<n;i++) if (out[i]==descendants[k]) seen=true;
                if (!seen) out[n++]=descendants[k];
            }
        }
    }
    sqlite3_finalize(q);
    return n;
}
