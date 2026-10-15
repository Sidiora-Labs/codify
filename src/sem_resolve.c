#include "cg.h"
#include "sem_resolve.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

/* The pass uses indexed source facts only. A missing or contradictory fact is
 * an unresolved boundary, never permission to guess from a matching name. */
#define MAX_CANDIDATES 128
typedef struct {
    long id, file_id, parent_id;
    char path[512], qualified[512], visibility[32], signature[512];
    int declaration, min_args, max_args;
} Candidate;

static const char *col(sqlite3_stmt *q, int n) {
    const char *s = (const char *)sqlite3_column_text(q, n);
    return s ? s : "";
}

/* Count only top-level parameters. -1 means that the recorded signature does
 * not establish arity; variadics retain an open upper bound. */
static void signature_arity(const char *sig, int *minimum, int *maximum) {
    *minimum = *maximum = -1;
    if (!sig || !*sig) return;
    const char *p = strchr(sig, '(');
    if (!p) return;
    int depth = 1, square = 0, angle = 0, braces = 0, commas = 0;
    int required = 0, total = 0, optional = 0, variadic = 0, seen = 0;
    for (p++; *p && depth; p++) {
        if (*p == '(') depth++;
        else if (*p == ')') { if (--depth == 0) break; }
        else if (*p == '[') square++;
        else if (*p == ']' && square) square--;
        else if (*p == '<') angle++;
        else if (*p == '>' && angle) angle--;
        else if (*p == '{') braces++;
        else if (*p == '}' && braces) braces--;
        if (depth != 1 || square || angle || braces) continue;
        if (*p == ',' ) { total++; required += !optional; optional=0; seen=0; commas++; }
        else if (*p == '=' || *p == '?') optional=1;
        else if (*p == '.' && p[1]=='.' && p[2]=='.') variadic=1;
        else if (!isspace((unsigned char)*p)) seen=1;
    }
    if (depth != 0) return;
    if (seen || commas) { total++; required += !optional && !variadic; }
    *minimum = required;
    *maximum = variadic ? -1 : total;
}

static long nearest_class(Cg *cg, long owner) {
    sqlite3_stmt *q = cg_prep(cg,
        "SELECT ss.parent_id,s.kind FROM semantic_symbols ss "
        "JOIN symbols s ON s.id=ss.symbol_id WHERE ss.symbol_id=?");
    for (int depth=0; owner>0 && depth<16; depth++) {
        sqlite3_bind_int64(q,1,owner);
        if (sqlite3_step(q)!=SQLITE_ROW) break;
        long parent=sqlite3_column_int64(q,0);
        char kind[64]; snprintf(kind,sizeof kind,"%s",col(q,1));
        sqlite3_reset(q); sqlite3_clear_bindings(q);
        if (!strcmp(kind,"class") || !strcmp(kind,"struct") ||
            !strcmp(kind,"interface") || !strcmp(kind,"trait") ||
            !strcmp(kind,"impl") || !strcmp(kind,"object") ||
            !strcmp(kind,"contract") || !strcmp(kind,"module") ||
            !strcmp(kind,"namespace") || !strcmp(kind,"record") ||
            !strcmp(kind,"actor") || !strcmp(kind,"protocol") ||
            !strcmp(kind,"extension") || !strcmp(kind,"enum")) {
            sqlite3_finalize(q); return owner;
        }
        owner=parent;
    }
    sqlite3_finalize(q);
    return 0;
}

static long symbol_parent(Cg *cg, long symbol_id) {
    if (symbol_id<=0) return 0;
    sqlite3_stmt *q=cg_prep(cg,
        "SELECT parent_id FROM semantic_symbols WHERE symbol_id=?");
    sqlite3_bind_int64(q,1,symbol_id);
    long parent=sqlite3_step(q)==SQLITE_ROW ? sqlite3_column_int64(q,0) : 0;
    sqlite3_finalize(q);
    return parent;
}

static long binding_target(Cg *cg, long file_id, const char *receiver,
                           long *target_file, int *ambiguous) {
    sqlite3_stmt *q=cg_prep(cg,
        "SELECT target_symbol_id,target_file_id FROM semantic_bindings "
        "WHERE file_id=? AND local_name=? AND is_export=0 AND is_system=0");
    sqlite3_bind_int64(q,1,file_id); sqlite3_bind_text(q,2,receiver,-1,SQLITE_TRANSIENT);
    long sym=0, file=0; int n=0;
    while (sqlite3_step(q)==SQLITE_ROW) {
        long s=sqlite3_column_int64(q,0), f=sqlite3_column_int64(q,1);
        if ((s || f) && (++n==1)) {sym=s;file=f;}
        else if ((s || f) && (s!=sym || f!=file)) *ambiguous=1;
    }
    sqlite3_finalize(q); *target_file=file; return sym;
}

/* A named import is a constraint even when its target has not yet been
 * populated in the semantic binding table. Keep its module and original
 * spelling so a same-named declaration elsewhere cannot win. */
static void call_import(Cg *cg, long file_id, const char *name,
                        char *module, size_t module_cap,
                        char *original, size_t original_cap,
                        long *symbol, long *file, int *present, int *ambiguous) {
    sqlite3_stmt *q=cg_prep(cg,
        "SELECT b.module,b.original_name,b.target_symbol_id,"
        "coalesce(b.target_file_id,i.target_file_id) "
        "FROM semantic_bindings b LEFT JOIN imports i ON i.file_id=b.file_id "
        "AND i.module=b.module WHERE b.file_id=? AND b.local_name=? "
        "AND b.is_export=0 AND b.module IS NOT NULL");
    sqlite3_bind_int64(q,1,file_id); sqlite3_bind_text(q,2,name,-1,SQLITE_TRANSIENT);
    while (sqlite3_step(q)==SQLITE_ROW) {
        const char *m=col(q,0), *o=col(q,1);
        long s=sqlite3_column_int64(q,2), f=sqlite3_column_int64(q,3);
        if (*present && (strcmp(module,m) || strcmp(original,*o?o:name) ||
                         (*symbol && s && *symbol!=s) || (*file && f && *file!=f)))
            *ambiguous=1;
        if (!*present) {
            snprintf(module,module_cap,"%s",m);
            snprintf(original,original_cap,"%s",*o?o:name);
            *symbol=s; *file=f;
        }
        *present=1;
    }
    sqlite3_finalize(q);
}

static void normalize_module_path(char *out, size_t cap,
                                  const char *from, const char *module) {
    char joined[1024]; snprintf(joined,sizeof joined,"%s",from);
    char *slash=strrchr(joined,'/');
    if (slash) slash[1]=0; else joined[0]=0;
    strncat(joined,module,sizeof joined-strlen(joined)-1);
    char *parts[128]; int n=0;
    char *save=NULL;
    for (char *p=strtok_r(joined,"/",&save);p;p=strtok_r(NULL,"/",&save)) {
        if (!strcmp(p,".")) continue;
        if (!strcmp(p,"..")) {if (n) n--;continue;}
        if (n<128) parts[n++]=p;
    }
    out[0]=0;
    for (int i=0;i<n;i++) {
        if (i) strncat(out,"/",cap-strlen(out)-1);
        strncat(out,parts[i],cap-strlen(out)-1);
    }
    char *dot=strrchr(out,'.');
    if (dot && !strchr(dot,'/')) *dot=0;
}

static int module_file_match(const char *candidate, const char *source,
                             const char *module) {
    if (!module || module[0]!='.') return 0;
    char want[1024], got[1024];
    normalize_module_path(want,sizeof want,source,module);
    snprintf(got,sizeof got,"%s",candidate);
    char *dot=strrchr(got,'.'); if (dot && !strchr(dot,'/')) *dot=0;
    return strcmp(want,got)==0;
}

static long typed_owner(Cg *cg, long file_id, long lexical_owner,
                        const char *receiver, int line, int *ambiguous) {
    sqlite3_stmt *q=cg_prep(cg,
        "SELECT value FROM semantic_type_facts WHERE file_id=? AND name=? "
        "AND kind IN ('variable_type','constructor') "
        "AND (owner_id=? OR owner_id IS NULL) AND start_line<=? "
        "ORDER BY start_line DESC LIMIT 8");
    sqlite3_bind_int64(q,1,file_id); sqlite3_bind_text(q,2,receiver,-1,SQLITE_TRANSIENT);
    sqlite3_bind_int64(q,3,lexical_owner); sqlite3_bind_int(q,4,line);
    char type[256]=""; int facts=0;
    while (sqlite3_step(q)==SQLITE_ROW) {
        const char *v=col(q,0); if (!*v) continue;
        if (!facts++) snprintf(type,sizeof type,"%s",v);
        else if (strcmp(type,v)) *ambiguous=1;
    }
    sqlite3_finalize(q);
    if (!facts || *ambiguous) return 0;
    /* A type name must identify one source symbol in this branch. */
    q=cg_prep(cg,
        "SELECT s.id FROM symbols s JOIN files f ON f.id=s.file_id "
        "WHERE f.branch_id=? AND s.name=? AND s.kind IN "
        "('class','struct','interface','trait','impl','type') LIMIT 2");
    sqlite3_bind_int64(q,1,cg->branch_id);
    sqlite3_bind_text(q,2,type,-1,SQLITE_TRANSIENT);
    long id=0; int n=0;
    while (sqlite3_step(q)==SQLITE_ROW) { id=sqlite3_column_int64(q,0); n++; }
    sqlite3_finalize(q);
    if (n>1) *ambiguous=1;
    return n==1 ? id : 0;
}

static int candidates(Cg *cg, const char *name, Candidate *out, int address) {
    sqlite3_stmt *q=cg_prep(cg,address ?
        "SELECT s.id,s.file_id,ifnull(ss.parent_id,0),f.path,"
        "ifnull(ss.visibility,''),ifnull(s.sig,''),s.decl,"
        "ifnull(ss.qualified_name,'') "
        "FROM symbols s JOIN files f ON f.id=s.file_id "
        "JOIN semantic_symbols ss ON ss.symbol_id=s.id "
        "WHERE f.branch_id=? AND ss.qualified_name=? AND s.kind='block' "
        "ORDER BY f.path,s.line,s.id LIMIT 129" :
        "SELECT s.id,s.file_id,ifnull(ss.parent_id,0),f.path,"
        "ifnull(ss.visibility,''),ifnull(s.sig,''),s.decl,"
        "ifnull(ss.qualified_name,'') "
        "FROM symbols s JOIN files f ON f.id=s.file_id "
        "JOIN semantic_symbols ss ON ss.symbol_id=s.id "
        "WHERE f.branch_id=? AND s.name=? ORDER BY f.path,s.line,s.id LIMIT 129");
    sqlite3_bind_int64(q,1,cg->branch_id);
    sqlite3_bind_text(q,2,name,-1,SQLITE_TRANSIENT);
    int n=0;
    while (sqlite3_step(q)==SQLITE_ROW) {
        if (n==MAX_CANDIDATES) { n++; break; }
        Candidate *c=&out[n++]; memset(c,0,sizeof *c);
        c->id=sqlite3_column_int64(q,0); c->file_id=sqlite3_column_int64(q,1);
        c->parent_id=sqlite3_column_int64(q,2);
        snprintf(c->path,sizeof c->path,"%s",col(q,3));
        snprintf(c->visibility,sizeof c->visibility,"%s",col(q,4));
        snprintf(c->signature,sizeof c->signature,"%s",col(q,5));
        c->declaration=sqlite3_column_int(q,6);
        snprintf(c->qualified,sizeof c->qualified,"%s",col(q,7));
        signature_arity(c->signature,&c->min_args,&c->max_args);
    }
    sqlite3_finalize(q); return n;
}

static void bind_nullable_id(sqlite3_stmt *q, int colno, long id) {
    if (id>0) sqlite3_bind_int64(q,colno,id);
    else sqlite3_bind_null(q,colno);
}

int sem_resolve_run(Cg *cg, const long *changed_files, int nfiles) {
    if (changed_files && nfiles==0) return 0;
    /* The orchestrator expands the source set with unchanged callers of old
     * and new definition keys. A NULL set is an explicit full rebuild. */
    {
        char *error=NULL;
        if (sqlite3_exec(cg->db,
                "CREATE TEMP TABLE IF NOT EXISTS sem_resolve_scope_files("
                "file_id INTEGER PRIMARY KEY);"
                "DELETE FROM temp.sem_resolve_scope_files;",
                NULL,NULL,&error)!=SQLITE_OK) {
            fprintf(stderr,"cg: receiver scope: %s\n",error?error:"unknown error");
            sqlite3_free(error); return -1;
        }
        if (changed_files) {
            sqlite3_stmt *ins=cg_prep(cg,
                "INSERT OR IGNORE INTO temp.sem_resolve_scope_files(file_id) VALUES(?)");
            for (int i=0;i<nfiles;i++) {
                sqlite3_bind_int64(ins,1,changed_files[i]);
                if (sqlite3_step(ins)!=SQLITE_DONE) {
                    sqlite3_finalize(ins); return -1;
                }
                sqlite3_reset(ins); sqlite3_clear_bindings(ins);
            }
            sqlite3_finalize(ins);
        }
    }
    sqlite3_stmt *refs=cg_prep(cg,
        "SELECT r.id,r.file_id,r.name,ifnull(sr.qualifier,r.qual),r.argc,"
        "ifnull(sr.owner_id,0),ifnull(sr.original_text,r.name),"
        "sr.start_line,sr.start_column,r.kind,r.verdict,r.conf,f.path "
        "FROM semantic_references sr "
        "JOIN refs r ON r.id=sr.ref_id JOIN files f ON f.id=r.file_id "
        "WHERE f.branch_id=? AND r.kind IN ('call','reference') "
        "AND (? OR r.file_id IN (SELECT file_id FROM temp.sem_resolve_scope_files)) "
        "ORDER BY r.id");
    sqlite3_bind_int64(refs,1,cg->branch_id);
    sqlite3_bind_int(refs,2,changed_files==NULL);
    sqlite3_stmt *upd=cg_prep(cg,
        "UPDATE semantic_references SET target_id=?,strategy=?,evidence=? WHERE ref_id=?");
    sqlite3_stmt *legacy=cg_prep(cg,
        "UPDATE refs SET target_id=?,verdict=?,conf=? WHERE id=?");
    sqlite3_stmt *del=cg_prep(cg,
        "DELETE FROM semantic_edges WHERE branch_id=? AND source_ref_id=? "
        "AND provenance='resolved-receiver'");
    sqlite3_stmt *existing=cg_prep(cg,
        "SELECT 1 FROM semantic_edges WHERE branch_id=? AND source_ref_id=? "
        "AND source_file_id=? AND source_id IS ? AND target_id=? AND kind=? "
        "AND start_line=? AND start_column=? "
        "AND provenance<>'resolved-receiver' LIMIT 1");
    sqlite3_stmt *edge=cg_prep(cg,
        "INSERT INTO semantic_edges(branch_id,source_file_id,target_file_id,"
        "source_id,target_id,source_ref_id,kind,original_text,strategy,"
        "provenance,evidence,start_line,start_column,synthesized) "
        "VALUES(?,?,?,?,?,?,?,?,?,'resolved-receiver',?,?,?,0)");
    Candidate c[MAX_CANDIDATES];
    while (sqlite3_step(refs)==SQLITE_ROW) {
        long rid=sqlite3_column_int64(refs,0), fid=sqlite3_column_int64(refs,1);
        char name[256],qual[256],original[512];
        snprintf(name,sizeof name,"%s",col(refs,2));
        snprintf(qual,sizeof qual,"%s",col(refs,3));
        snprintf(original,sizeof original,"%s",col(refs,6));
        int argc=sqlite3_column_int(refs,4), line=sqlite3_column_int(refs,7);
        int column=sqlite3_column_int(refs,8);
        bool value_ref=strcmp(col(refs,9),"reference")==0;
        char old_verdict[32],old_conf[64],source_path[512];
        snprintf(old_verdict,sizeof old_verdict,"%s",col(refs,10));
        snprintf(old_conf,sizeof old_conf,"%s",col(refs,11));
        snprintf(source_path,sizeof source_path,"%s",col(refs,12));
        long source=sqlite3_column_int64(refs,5), owner=0, namespace_file=0;
        long imported_symbol=0, imported_file=0;
        char import_module[512]="", imported_name[256]="";
        int has_import=0;
        int ambiguous=0;
        const char *strategy="unresolved", *why="no matching definition";
        if (value_ref) {
            strategy="lexical-reference";
            if (*qual) why="qualified reference requires binding evidence";
        } else if (!strcmp(qual,"this") || !strcmp(qual,"self") || !strcmp(qual,"cls")) {
            owner=nearest_class(cg,source); strategy="receiver-owner";
            if (!owner) why="receiver has no known owner";
        } else if (*qual) {
            owner=binding_target(cg,fid,qual,&namespace_file,&ambiguous);
            if (owner || namespace_file) strategy="imported-receiver";
            else {
                owner=typed_owner(cg,fid,source,qual,line,&ambiguous);
                if (owner) strategy="declared-receiver";
                else why=ambiguous ? "conflicting receiver evidence" : "unknown receiver";
            }
        } else {
            owner=nearest_class(cg,source);
            if (owner) strategy="lexical-owner";
            else strategy="unqualified";
            call_import(cg,fid,name,import_module,sizeof import_module,
                        imported_name,sizeof imported_name,&imported_symbol,
                        &imported_file,&has_import,&ambiguous);
            if (has_import) strategy="named-import";
        }
        const char *lookup_name=has_import && *imported_name ? imported_name : name;
        if (value_ref && !strncmp(qual,"resource.",9)) {
            const char *last=strrchr(qual,'.');
            if (last && last[1]) lookup_name=last+1;
        }
        int resource_address=value_ref && !strncmp(qual,"resource.",9);
        int nc=candidates(cg,resource_address?qual:lookup_name,c,resource_address);
        int best=-1, matches=0;
        if (nc>MAX_CANDIDATES) {ambiguous=1;why="candidate limit exceeded";}
        else if (value_ref && !strncmp(qual,"resource.",9) && !ambiguous) {
            strategy="resource-address";
            for (int i=0;i<nc;i++)
                if (!strcmp(c[i].qualified,qual) && !c[i].declaration) {
                    best=i; matches++;
                }
            why=matches>1 ? "duplicate resource address" : "resource address absent";
        } else if (value_ref && !*qual && !ambiguous) {
            long parent=symbol_parent(cg,source);
            /* Prefer a local declaration, then another member of the same
             * lexical owner, then file scope. A tie at any tier abstains. */
            for (int tier=0;tier<3 && matches==0;tier++) {
                for (int i=0;i<nc;i++) {
                    Candidate *v=&c[i];
                    if (v->file_id!=fid || v->declaration) continue;
                    if (tier==0 && (!source || v->parent_id!=source)) continue;
                    if (tier==1 && (!source || v->parent_id!=parent)) continue;
                    if (tier==2 && v->parent_id) continue;
                    if (!strcmp(v->visibility,"private") &&
                        v->parent_id && v->parent_id!=source &&
                        v->parent_id!=parent) continue;
                    best=i;matches++;
                }
            }
            why=matches>1 ? "equally plausible lexical targets" :
                "no unique lexical target";
        } else if (!ambiguous && (!*qual || owner || namespace_file)) {
            for (int i=0;i<nc;i++) {
                Candidate *v=&c[i];
                if (has_import && imported_symbol && v->id!=imported_symbol) continue;
                if (has_import && imported_file && v->file_id!=imported_file) continue;
                if (has_import && !imported_symbol && !imported_file &&
                    !module_file_match(v->path,source_path,import_module)) continue;
                if (*qual && owner && v->parent_id!=owner) continue;
                if (*qual && namespace_file && v->file_id!=namespace_file) continue;
                if (!*qual && owner && !has_import && v->parent_id!=owner) continue;
                if (!*qual && !owner && v->parent_id) continue;
                if (!strcmp(v->visibility,"private") &&
                    !(owner && v->parent_id==owner) && v->file_id!=fid) continue;
                if (!strcmp(v->visibility,"protected") &&
                    !(owner && v->parent_id==owner) && v->file_id!=fid) continue;
                if (argc>=0 && v->min_args>=0 &&
                    (argc<v->min_args || (v->max_args>=0 && argc>v->max_args))) continue;
                if (!v->declaration) {best=i;matches++;}
            }
            if (matches==0) {
                for (int i=0;i<nc;i++) {
                    Candidate *v=&c[i];
                    if (has_import && imported_symbol && v->id!=imported_symbol) continue;
                    if (has_import && imported_file && v->file_id!=imported_file) continue;
                    if (has_import && !imported_symbol && !imported_file &&
                        !module_file_match(v->path,source_path,import_module)) continue;
                    if (*qual && owner && v->parent_id!=owner) continue;
                    if (*qual && namespace_file && v->file_id!=namespace_file) continue;
                    if (!*qual && owner && !has_import && v->parent_id!=owner) continue;
                    if (!*qual && !owner && v->parent_id) continue;
                    if (!strcmp(v->visibility,"private") &&
                        !(owner && v->parent_id==owner) && v->file_id!=fid) continue;
                    if (!strcmp(v->visibility,"protected") &&
                        !(owner && v->parent_id==owner) && v->file_id!=fid) continue;
                    if (argc>=0 && v->min_args>=0 &&
                        (argc<v->min_args || (v->max_args>=0 && argc>v->max_args))) continue;
                    if (v->declaration) {best=i;matches++;}
                }
            }
            why=matches>1 ? "equally plausible overloads" : "no compatible definition";
        }
        long target=(!ambiguous && matches==1) ? c[best].id : 0;
        long target_file=target ? c[best].file_id : 0;
        char evidence[768];
        if (target)
            snprintf(evidence,sizeof evidence,"receiver=%.160s; owner=%ld; argc=%d; target=%.400s:%ld",
                     *qual?qual:"(unqualified)",owner,argc,c[best].path,target);
        else {
            snprintf(evidence,sizeof evidence,"receiver=%.160s; argc=%d; candidates=%d; reason=%.256s",
                     *qual?qual:"(unqualified)",argc,matches,why);
            if (matches>1) {
                size_t used=strlen(evidence);
                used+=(size_t)snprintf(evidence+used,sizeof evidence-used,"; candidate_ids=");
                int listed=0;
                for (int i=0;i<nc && i<MAX_CANDIDATES && listed<8;i++) {
                    Candidate *v=&c[i];
                    if (*qual && owner && v->parent_id!=owner) continue;
                    if (*qual && namespace_file && v->file_id!=namespace_file) continue;
                    if (!*qual && owner && v->parent_id!=owner) continue;
                    if (!*qual && !owner && v->parent_id) continue;
                    if (argc>=0 && v->min_args>=0 &&
                        (argc<v->min_args || (v->max_args>=0 && argc>v->max_args))) continue;
                    if (used+32>=sizeof evidence) break;
                    used+=(size_t)snprintf(evidence+used,sizeof evidence-used,
                                           "%s%ld",listed?",":"",v->id);
                    listed++;
                }
            }
        }
        sqlite3_bind_int64(del,1,cg->branch_id); sqlite3_bind_int64(del,2,rid);
        sqlite3_step(del); sqlite3_reset(del); sqlite3_clear_bindings(del);
        bind_nullable_id(upd,1,target);
        sqlite3_bind_text(upd,2,target?strategy:"unresolved",-1,SQLITE_TRANSIENT);
        sqlite3_bind_text(upd,3,evidence,-1,SQLITE_TRANSIENT);
        sqlite3_bind_int64(upd,4,rid);
        sqlite3_step(upd); sqlite3_reset(upd); sqlite3_clear_bindings(upd);
        bind_nullable_id(legacy,1,target);
        int preserve_external=!target && !strcmp(old_verdict,"external") &&
                              !strcmp(old_conf,"builtin");
        sqlite3_bind_text(legacy,2,target?"internal":preserve_external?"external":"unknown",-1,SQLITE_STATIC);
        sqlite3_bind_text(legacy,3,target?strategy:preserve_external?old_conf:"semantic-unresolved",-1,SQLITE_TRANSIENT);
        sqlite3_bind_int64(legacy,4,rid);
        sqlite3_step(legacy); sqlite3_reset(legacy); sqlite3_clear_bindings(legacy);
        if (target) {
            sqlite3_bind_int64(existing,1,cg->branch_id);
            sqlite3_bind_int64(existing,2,rid);
            sqlite3_bind_int64(existing,3,fid);
            bind_nullable_id(existing,4,source);
            sqlite3_bind_int64(existing,5,target);
            sqlite3_bind_text(existing,6,value_ref?"references":"calls",-1,SQLITE_STATIC);
            sqlite3_bind_int(existing,7,line);
            sqlite3_bind_int(existing,8,column);
            int already_linked=sqlite3_step(existing)==SQLITE_ROW;
            sqlite3_reset(existing); sqlite3_clear_bindings(existing);
            if (already_linked) continue;
            sqlite3_bind_int64(edge,1,cg->branch_id);
            sqlite3_bind_int64(edge,2,fid);
            sqlite3_bind_int64(edge,3,target_file);
            bind_nullable_id(edge,4,source);
            sqlite3_bind_int64(edge,5,target); sqlite3_bind_int64(edge,6,rid);
            sqlite3_bind_text(edge,7,value_ref?"references":"calls",-1,SQLITE_STATIC);
            sqlite3_bind_text(edge,8,original,-1,SQLITE_TRANSIENT);
            sqlite3_bind_text(edge,9,strategy,-1,SQLITE_TRANSIENT);
            sqlite3_bind_text(edge,10,evidence,-1,SQLITE_TRANSIENT);
            sqlite3_bind_int(edge,11,line); sqlite3_bind_int(edge,12,column);
            sqlite3_step(edge); sqlite3_reset(edge); sqlite3_clear_bindings(edge);
        }
    }
    sqlite3_finalize(refs); sqlite3_finalize(upd); sqlite3_finalize(legacy);
    sqlite3_finalize(del); sqlite3_finalize(existing); sqlite3_finalize(edge);
    return 0;
}

int sem_resolve_register(void) {
    return sem_pass_register("receiver-resolution",20,sem_resolve_run);
}
