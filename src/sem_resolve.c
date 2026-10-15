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
    char path[512], visibility[32], signature[512];
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
            !strcmp(kind,"impl")) { sqlite3_finalize(q); return owner; }
        owner=parent;
    }
    sqlite3_finalize(q);
    return 0;
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

static int candidates(Cg *cg, const char *name, Candidate *out) {
    sqlite3_stmt *q=cg_prep(cg,
        "SELECT s.id,s.file_id,ifnull(ss.parent_id,0),f.path,"
        "ifnull(ss.visibility,''),ifnull(s.sig,''),s.decl "
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
    /* Revisit all semantic references when definitions change. This includes
     * unchanged callers of deleted or newly introduced candidates. */
    sqlite3_stmt *refs=cg_prep(cg,
        "SELECT r.id,r.file_id,r.name,ifnull(sr.qualifier,r.qual),r.argc,"
        "ifnull(sr.owner_id,0),ifnull(sr.original_text,r.name),"
        "sr.start_line,sr.start_column FROM semantic_references sr "
        "JOIN refs r ON r.id=sr.ref_id JOIN files f ON f.id=r.file_id "
        "WHERE f.branch_id=? AND r.kind='call' ORDER BY r.id");
    sqlite3_bind_int64(refs,1,cg->branch_id);
    sqlite3_stmt *upd=cg_prep(cg,
        "UPDATE semantic_references SET target_id=?,strategy=?,evidence=? WHERE ref_id=?");
    sqlite3_stmt *legacy=cg_prep(cg,
        "UPDATE refs SET target_id=?,verdict=?,conf=? WHERE id=?");
    sqlite3_stmt *del=cg_prep(cg,
        "DELETE FROM semantic_edges WHERE branch_id=? AND source_ref_id=? "
        "AND provenance='resolved-receiver'");
    sqlite3_stmt *edge=cg_prep(cg,
        "INSERT INTO semantic_edges(branch_id,source_file_id,target_file_id,"
        "source_id,target_id,source_ref_id,kind,original_text,strategy,"
        "provenance,evidence,start_line,start_column,synthesized) "
        "VALUES(?,?,?,?,?,?,'calls',?,?,'resolved-receiver',?,?,?,0)");
    Candidate c[MAX_CANDIDATES];
    while (sqlite3_step(refs)==SQLITE_ROW) {
        long rid=sqlite3_column_int64(refs,0), fid=sqlite3_column_int64(refs,1);
        char name[256],qual[256],original[512];
        snprintf(name,sizeof name,"%s",col(refs,2));
        snprintf(qual,sizeof qual,"%s",col(refs,3));
        snprintf(original,sizeof original,"%s",col(refs,6));
        int argc=sqlite3_column_int(refs,4), line=sqlite3_column_int(refs,7);
        int column=sqlite3_column_int(refs,8);
        long source=sqlite3_column_int64(refs,5), owner=0, namespace_file=0;
        int ambiguous=0;
        const char *strategy="unresolved", *why="no matching definition";
        if (!strcmp(qual,"this") || !strcmp(qual,"self") || !strcmp(qual,"cls")) {
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
        }
        int nc=candidates(cg,name,c);
        int best=-1, matches=0;
        if (nc>MAX_CANDIDATES) {ambiguous=1;why="candidate limit exceeded";}
        else if (!ambiguous && (!*qual || owner || namespace_file)) {
            for (int i=0;i<nc;i++) {
                Candidate *v=&c[i];
                if (*qual && owner && v->parent_id!=owner) continue;
                if (*qual && namespace_file && v->file_id!=namespace_file) continue;
                if (!*qual && owner && v->parent_id!=owner) continue;
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
                    if (*qual && owner && v->parent_id!=owner) continue;
                    if (*qual && namespace_file && v->file_id!=namespace_file) continue;
                    if (!*qual && owner && v->parent_id!=owner) continue;
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
        sqlite3_bind_text(legacy,2,target?"internal":"unknown",-1,SQLITE_STATIC);
        sqlite3_bind_text(legacy,3,target?strategy:"semantic-unresolved",-1,SQLITE_TRANSIENT);
        sqlite3_bind_int64(legacy,4,rid);
        sqlite3_step(legacy); sqlite3_reset(legacy); sqlite3_clear_bindings(legacy);
        if (target) {
            sqlite3_bind_int64(edge,1,cg->branch_id);
            sqlite3_bind_int64(edge,2,fid);
            sqlite3_bind_int64(edge,3,target_file);
            bind_nullable_id(edge,4,source);
            sqlite3_bind_int64(edge,5,target); sqlite3_bind_int64(edge,6,rid);
            sqlite3_bind_text(edge,7,original,-1,SQLITE_TRANSIENT);
            sqlite3_bind_text(edge,8,strategy,-1,SQLITE_TRANSIENT);
            sqlite3_bind_text(edge,9,evidence,-1,SQLITE_TRANSIENT);
            sqlite3_bind_int(edge,10,line); sqlite3_bind_int(edge,11,column);
            sqlite3_step(edge); sqlite3_reset(edge); sqlite3_clear_bindings(edge);
        }
    }
    sqlite3_finalize(refs); sqlite3_finalize(upd); sqlite3_finalize(legacy);
    sqlite3_finalize(del); sqlite3_finalize(edge);
    return 0;
}

int sem_resolve_register(void) {
    return sem_pass_register("receiver-resolution",20,sem_resolve_run);
}
