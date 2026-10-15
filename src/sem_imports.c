#include "sem_imports.h"
#include "semantic.h"
#include <ctype.h>
#include <sys/stat.h>

/* This pass only accepts exact branch-local files and unambiguous exports.
 * Its fixed limits turn malformed configuration and export cycles into
 * unresolved bindings rather than unbounded traversal. */
#define PATH_CAP 4096
#define EXPORT_DEPTH 24

typedef struct {
    long id, file_id, target_file_id;
    char *module, *local, *original, *kind, *exported;
    int is_export, is_system;
} Binding;

typedef struct { char *path, *name, *entry; } Package;

typedef struct {
    Cg *cg;
    Binding *bindings; int nbindings, capbindings;
    Package *packages; int npackages, cappackages;
    sqlite3_stmt *find_file, *update_binding, *add_dependency;
} ImportPass;

static void make_scope(Cg *cg,const long *changed,int n) {
    cg_exec(cg,"CREATE TEMP TABLE IF NOT EXISTS sem_import_scope(id INTEGER PRIMARY KEY)");
    cg_exec(cg,"DELETE FROM temp.sem_import_scope");
    sqlite3_stmt *put=cg_prep(cg,"INSERT OR IGNORE INTO temp.sem_import_scope(id) VALUES(?1)");
    for (int i=0;i<n;i++) {
        sqlite3_bind_int64(put,1,changed[i]);
        if (sqlite3_step(put)!=SQLITE_DONE) {
            fprintf(stderr,"cg: import scope: %s\n",sqlite3_errmsg(cg->db)); exit(2);
        }
        sqlite3_reset(put); sqlite3_clear_bindings(put);
    }
    sqlite3_finalize(put);
    /* Follow reverse file dependencies until the export chain closes.
     * The depth bound protects an index damaged by arbitrary cycles. */
    sqlite3_stmt *more=cg_prep(cg,
        "INSERT OR IGNORE INTO temp.sem_import_scope(id) "
        "SELECT d.file_id FROM semantic_dependencies d "
        "JOIN files source ON source.id=d.file_id AND source.branch_id=?1 "
        "JOIN files target ON target.branch_id=?1 "
        "AND target.path=d.dependency_key "
        "JOIN temp.sem_import_scope scope ON scope.id=target.id "
        "WHERE d.branch_id=?1 AND d.kind='module-file' "
        "UNION SELECT b.file_id FROM semantic_bindings b "
        "JOIN files source ON source.id=b.file_id AND source.branch_id=?1 "
        "JOIN temp.sem_import_scope scope ON scope.id=b.target_file_id");
    for (int depth=0;depth<EXPORT_DEPTH;depth++) {
        sqlite3_bind_int64(more,1,cg->branch_id);
        if (sqlite3_step(more)!=SQLITE_DONE) {
            fprintf(stderr,"cg: import scope: %s\n",sqlite3_errmsg(cg->db)); exit(2);
        }
        int added=sqlite3_changes(cg->db);
        sqlite3_reset(more); sqlite3_clear_bindings(more);
        if (!added) break;
    }
    sqlite3_finalize(more);
}

static char *copy_col(sqlite3_stmt *q, int col) {
    const char *s=(const char *)sqlite3_column_text(q,col);
    return s ? xstrdup(s) : NULL;
}
static void bind_str(sqlite3_stmt *q, int col, const char *s) {
    if (s) sqlite3_bind_text(q,col,s,-1,SQLITE_TRANSIENT);
    else sqlite3_bind_null(q,col);
}
static void checked_step(Cg *cg, sqlite3_stmt *q) {
    if (sqlite3_step(q)!=SQLITE_DONE) {
        fprintf(stderr,"cg: import binding update: %s\n",sqlite3_errmsg(cg->db));
        exit(2);
    }
    sqlite3_reset(q); sqlite3_clear_bindings(q);
}
static bool normalize(const char *input, char out[PATH_CAP]) {
    if (!input || *input=='/' || strlen(input)>=PATH_CAP) return false;
    char tmp[PATH_CAP]; snprintf(tmp,sizeof tmp,"%s",input);
    char *parts[512]; int n=0; char *save=NULL;
    for (char *p=strtok_r(tmp,"/",&save);p;p=strtok_r(NULL,"/",&save)) {
        if (!strcmp(p,".")) continue;
        if (!strcmp(p,"..")) { if (!n) return false; n--; continue; }
        if (n==512) return false;
        parts[n++]=p;
    }
    size_t used=0; out[0]=0;
    for (int i=0;i<n;i++) {
        size_t len=strlen(parts[i]);
        if (used+len+(i>0)>=PATH_CAP) return false;
        if (i) out[used++]='/';
        memcpy(out+used,parts[i],len); used+=len; out[used]=0;
    }
    return true;
}
static bool dirname_join(const char *from, const char *module, char out[PATH_CAP]) {
    char joined[PATH_CAP]; const char *slash=strrchr(from,'/');
    if (slash) {
        if (!path_format(joined,sizeof joined,"%.*s/%s",(int)(slash-from),from,module)) return false;
    } else if (!path_format(joined,sizeof joined,"%s",module)) return false;
    return normalize(joined,out);
}
static long exact_file(ImportPass *p, const char *path) {
    sqlite3_bind_text(p->find_file,1,path,-1,SQLITE_TRANSIENT);
    sqlite3_bind_int64(p->find_file,2,p->cg->branch_id);
    long id=sqlite3_step(p->find_file)==SQLITE_ROW ? sqlite3_column_int64(p->find_file,0) : 0;
    sqlite3_reset(p->find_file); sqlite3_clear_bindings(p->find_file);
    return id;
}
static long candidate_file(ImportPass *p, const char *input, const char *lang) {
    char path[PATH_CAP]; if (!normalize(input,path) || !*path) return 0;
    long id=exact_file(p,path); if (id) return id;
    const char *exts=NULL;
    if (!strcmp(lang,"typescript") || !strcmp(lang,"javascript"))
        exts=".ts .tsx .js .jsx .mts .cts .mjs .cjs .json";
    else if (!strcmp(lang,"python")) exts=".py";
    else if (!strcmp(lang,"c") || !strcmp(lang,"cpp")) exts=".h .hpp .hh .c .cpp .cc";
    else if (!strcmp(lang,"ruby")) exts=".rb";
    else if (!strcmp(lang,"php")) exts=".php";
    else if (!strcmp(lang,"rust")) exts=".rs";
    else if (!strcmp(lang,"go")) exts=".go";
    if (!exts) return 0;
    char list[128]; snprintf(list,sizeof list,"%s",exts);
    char *save=NULL;
    for (char *ext=strtok_r(list," ",&save);ext;ext=strtok_r(NULL," ",&save)) {
        char trial[PATH_CAP];
        if (path_format(trial,sizeof trial,"%s%s",path,ext) && (id=exact_file(p,trial))) return id;
        if (path_format(trial,sizeof trial,"%s/index%s",path,ext) && (id=exact_file(p,trial))) return id;
    }
    if (!strcmp(lang,"python")) {
        char trial[PATH_CAP];
        if (path_format(trial,sizeof trial,"%s/__init__.py",path)) return exact_file(p,trial);
    }
    return 0;
}
static void dependency(ImportPass *p, long fid, const char *key, const char *hash,
                       const char *kind) {
    sqlite3_stmt *q=p->add_dependency;
    sqlite3_bind_int64(q,1,p->cg->branch_id);
    sqlite3_bind_int64(q,2,fid); bind_str(q,3,key); bind_str(q,4,hash);
    bind_str(q,5,kind); checked_step(p->cg,q);
}
static void file_dependency(ImportPass *p,long source,long target) {
    sqlite3_stmt *q=cg_prep(p->cg,
        "SELECT path FROM files WHERE id=?1 AND branch_id=?2");
    sqlite3_bind_int64(q,1,target); sqlite3_bind_int64(q,2,p->cg->branch_id);
    if (sqlite3_step(q)==SQLITE_ROW) {
        const char *path=(const char *)sqlite3_column_text(q,0);
        if (path) dependency(p,source,path,NULL,"module-file");
    }
    sqlite3_finalize(q);
}
static void unresolved_candidates(ImportPass *p,long source,const char *from,
                                  const char *module,const char *lang) {
    if (!module || module[0]!='.' ||
        (strcmp(lang,"typescript") && strcmp(lang,"javascript"))) return;
    char base[PATH_CAP]; if (!dirname_join(from,module,base)) return;
    static const char *exts[]={".ts",".tsx",".js",".jsx",".mts",".cts",
                                ".mjs",".cjs",NULL};
    for (int i=0;exts[i];i++) {
        char path[PATH_CAP];
        if (path_format(path,sizeof path,"%s%s",base,exts[i]))
            dependency(p,source,path,NULL,"module-file");
        if (path_format(path,sizeof path,"%s/index%s",base,exts[i]))
            dependency(p,source,path,NULL,"module-file");
    }
}
static char *config_data(ImportPass *p, long fid, const char *relative,
                         const char *kind) {
    char absolute[PATH_CAP];
    if (!path_format(absolute,sizeof absolute,"%s/%s",p->cg->root,relative)) return NULL;
    size_t len=0; char *data=read_entire_file(absolute,&len);
    char hash[65]; sha256_hex(data ? data : "",data ? len : 0,hash);
    dependency(p,fid,relative,data ? hash : NULL,kind);
    return data;
}
static void strip_json_comments(char *data) {
    int state=0; /* 0 code, 1 string, 2 line comment, 3 block comment */
    for (size_t i=0;data[i];i++) {
        if (state==1) {
            if (data[i]=='\\' && data[i+1]) { i++; continue; }
            if (data[i]=='"') state=0;
        } else if (state==2) {
            if (data[i]=='\n') state=0;
            else data[i]=' ';
        } else if (state==3) {
            if (data[i]=='*' && data[i+1]=='/') {
                data[i++]=' '; data[i]=' '; state=0;
            } else if (data[i]!='\n') data[i]=' ';
        } else if (data[i]=='"') state=1;
        else if (data[i]=='/' && data[i+1]=='/') {
            data[i++]=' '; data[i]=' '; state=2;
        } else if (data[i]=='/' && data[i+1]=='*') {
            data[i++]=' '; data[i]=' '; state=3;
        }
    }
}
/* JSON path mapping is limited to literal strings and a single '*' segment.
 * Dynamic/computed entries remain unresolved. */
static bool alias_match(const char *pattern,const char *module,char capture[PATH_CAP]) {
    const char *star=strchr(pattern,'*'); capture[0]=0;
    if (!star) return strcmp(pattern,module)==0;
    if (strchr(star+1,'*')) return false;
    size_t pre=(size_t)(star-pattern), post=strlen(star+1), ml=strlen(module);
    if (ml<pre+post || strncmp(pattern,module,pre) ||
        strcmp(star+1,module+ml-post)) return false;
    size_t n=ml-pre-post; if (n>=PATH_CAP) return false;
    memcpy(capture,module+pre,n); capture[n]=0; return true;
}
static bool alias_value(const char *value,const char *capture,char out[PATH_CAP]) {
    const char *star=strchr(value,'*');
    if (!star) return path_format(out,PATH_CAP,"%s",value);
    if (strchr(star+1,'*')) return false;
    return path_format(out,PATH_CAP,"%.*s%s%s",(int)(star-value),value,capture,star+1);
}
static long config_aliases(ImportPass *p,long fid,const char *from,
                           const char *module,const char *lang) {
    if (strcmp(lang,"typescript") && strcmp(lang,"javascript")) return 0;
    char dir[PATH_CAP]; snprintf(dir,sizeof dir,"%s",from);
    char *last=strrchr(dir,'/'); if (last) *last=0; else dir[0]=0;
    for (;;) {
        const char *names[]={"tsconfig.json","jsconfig.json"};
        for (int ni=0;ni<2;ni++) {
            char rel[PATH_CAP];
            if (!path_format(rel,sizeof rel,"%s%s%s",dir,*dir?"/":"",names[ni])) continue;
            char *data=config_data(p,fid,rel,"project-config");
            if (!data) continue;
            strip_json_comments(data);
            char *compiler=json_get_object(data,"compilerOptions");
            char *paths=compiler ? json_get_object(compiler,"paths") : NULL;
            char *base=compiler ? json_get_string(compiler,"baseUrl") : NULL;
            long result=0;
            if (paths) {
                char *keys[256]; int count=json_object_keys(paths,keys,256);
                for (int k=0;k<count;k++) {
                    char capture[PATH_CAP];
                    if (alias_match(keys[k],module,capture)) {
                        char *raw=json_get_raw(paths,keys[k]);
                        /* A path target is an array of literal strings. */
                        if (raw) {
                            const char *q=strchr(raw,'"');
                            while (q && !result) {
                                const char *end=strchr(q+1,'"'); if (!end) break;
                                char value[PATH_CAP],repl[PATH_CAP],joined[PATH_CAP];
                                size_t n=(size_t)(end-q-1);
                                if (n<sizeof value) {
                                    memcpy(value,q+1,n); value[n]=0;
                                    if (alias_value(value,capture,repl) &&
                                        path_format(joined,sizeof joined,"%s%s%s%s%s",
                                            dir,*dir?"/":"",base?base:"",base?"/":"",repl))
                                        result=candidate_file(p,joined,lang);
                                }
                                q=strchr(end+1,'"');
                            }
                            free(raw);
                        }
                    }
                    free(keys[k]);
                }
            }
            if (!result && base) {
                char joined[PATH_CAP];
                if (path_format(joined,sizeof joined,"%s%s%s/%s",dir,*dir?"/":"",base,module))
                    result=candidate_file(p,joined,lang);
            }
            free(paths); free(base); free(compiler); free(data);
            if (result) return result;
            /* The nearest config defines resolution for this subtree. */
            return 0;
        }
        if (!*dir) break;
        last=strrchr(dir,'/'); if (last) *last=0; else dir[0]=0;
    }
    return 0;
}
static void load_packages(ImportPass *p) {
    sqlite3_stmt *q=cg_prep(p->cg,"SELECT path FROM files WHERE branch_id=?1 "
                        "AND (path='package.json' OR path LIKE '%/package.json')");
    sqlite3_bind_int64(q,1,p->cg->branch_id);
    while (sqlite3_step(q)==SQLITE_ROW) {
        const char *rel=(const char *)sqlite3_column_text(q,0);
        if (!rel || strstr(rel,"node_modules/")) continue;
        char abs[PATH_CAP]; if (!path_format(abs,sizeof abs,"%s/%s",p->cg->root,rel)) continue;
        size_t size=0; char *data=read_entire_file(abs,&size); if (!data) continue;
        char *name=json_get_string(data,"name");
        if (!name) { free(data); continue; }
        char *entry=json_get_string(data,"module");
        if (!entry) entry=json_get_string(data,"main");
        if (!entry) entry=json_get_string(data,"types");
        if (!entry) entry=xstrdup("index");
        if (p->npackages==p->cappackages) {
            p->cappackages=p->cappackages ? p->cappackages*2 : 16;
            p->packages=xrealloc(p->packages,sizeof *p->packages*(size_t)p->cappackages);
        }
        Package *pkg=&p->packages[p->npackages++];
        pkg->path=xstrdup(rel); pkg->name=name; pkg->entry=entry;
        free(data);
    }
    sqlite3_finalize(q);
}
static long workspace_package(ImportPass *p,long fid,const char *from,
                              const char *module,const char *lang) {
    if (strcmp(lang,"javascript") && strcmp(lang,"typescript")) return 0;
    long result=0; int matches=0;
    for (int i=0;i<p->npackages;i++) {
        Package *pkg=&p->packages[i]; size_t len=strlen(pkg->name);
        if (strncmp(module,pkg->name,len) || (module[len] && module[len]!='/')) continue;
        char dir[PATH_CAP],target[PATH_CAP];
        snprintf(dir,sizeof dir,"%s",pkg->path);
        char *slash=strrchr(dir,'/'); if (slash) *slash=0; else dir[0]=0;
        const char *sub=module[len]=='/' ? module+len+1 : pkg->entry;
        if (!path_format(target,sizeof target,"%s%s%s",dir,*dir?"/":"",sub)) continue;
        long id=candidate_file(p,target,lang);
        if (id) { result=id; matches++; }
        char *manifest=config_data(p,fid,pkg->path,"workspace-package");
        free(manifest);
    }
    (void)from;
    return matches==1 ? result : 0;
}
static long module_file(ImportPass *p,long fid,const char *from,const char *module,
                        const char *lang) {
    if (!module || !*module) return 0;
    char resolved[PATH_CAP];
    if (!strcmp(lang,"python")) {
        const char *part=module;
        char base[PATH_CAP]="";
        if (*part=='.') {
            const char *slash=strrchr(from,'/');
            if (slash) snprintf(base,sizeof base,"%.*s",(int)(slash-from),from);
            while (*part=='.') {
                if (part!=module) {
                    char *up=strrchr(base,'/');
                    if (up) *up=0; else base[0]=0;
                }
                part++;
            }
        }
        if (!path_format(resolved,sizeof resolved,"%s%s%s",base,*base&&*part?"/":"",part))
            return 0;
        for (char *c=resolved;*c;c++) if (*c=='.') *c='/';
        return candidate_file(p,resolved,lang);
    }
    if (module[0]=='.') {
        if (!dirname_join(from,module,resolved)) return 0;
        return candidate_file(p,resolved,lang);
    }
    if (!strcmp(lang,"rust")) {
        char base[PATH_CAP]="";
        const char *part=module;
        const char *slash=strrchr(from,'/');
        if (!strncmp(module,"crate::",7)) {
            part+=7;
            if (!strncmp(from,"src/",4)) snprintf(base,sizeof base,"src");
            else {
                const char *src=strstr(from,"/src/");
                if (src) snprintf(base,sizeof base,"%.*s/src",(int)(src-from),from);
                else if (slash) snprintf(base,sizeof base,"%.*s",(int)(slash-from),from);
            }
        } else if (!strncmp(module,"self::",6) || !strncmp(module,"super::",7)) {
            bool parent=!strncmp(module,"super::",7);
            part+=parent ? 7 : 6;
            if (slash) snprintf(base,sizeof base,"%.*s",(int)(slash-from),from);
            if (parent) {
                char *up=strrchr(base,'/');
                if (up) *up=0; else base[0]=0;
            }
        }
        if (!path_format(resolved,sizeof resolved,"%s%s%s",base,*base?"/":"",part)) return 0;
        for (char *c=resolved;*c;c++) if (c[0]==':' && c[1]==':') { *c='/'; memmove(c+1,c+2,strlen(c+2)+1); }
        long id=candidate_file(p,resolved,lang);
        if (id) return id;
        char *last=strrchr(resolved,'/');
        if (last) { *last=0; return candidate_file(p,resolved,lang); }
        return 0;
    }
    if (!strcmp(lang,"go")) {
        /* Fully qualified package imports are resolved only to exact
         * repository paths or an explicit local module root. */
        long id=candidate_file(p,module,lang); if (id) return id;
        char modpath[PATH_CAP]; if (!path_format(modpath,sizeof modpath,"%s/go.mod",p->cg->root)) return 0;
        size_t len=0; char *data=read_entire_file(modpath,&len);
        if (data) {
            const char *line=strstr(data,"module ");
            if (line) {
                line+=7; while (*line==' ' || *line=='\t') line++;
                const char *end=line; while (*end && !isspace((unsigned char)*end)) end++;
                size_t n=(size_t)(end-line);
                if (!strncmp(module,line,n) && module[n]=='/') id=candidate_file(p,module+n+1,lang);
            }
            free(data);
        }
        char *manifest=config_data(p,fid,"go.mod","module-config");
        free(manifest);
        return id;
    }
    if (!strcmp(lang,"c") || !strcmp(lang,"cpp")) {
        if (dirname_join(from,module,resolved)) {
            long id=candidate_file(p,resolved,lang); if (id) return id;
        }
        return candidate_file(p,module,lang);
    }
    if (!strcmp(lang,"php")) {
        snprintf(resolved,sizeof resolved,"%s",module);
        for (char *c=resolved;*c;c++) if (*c=='\\') *c='/';
        long id=candidate_file(p,resolved,lang);
        if (id) return id;
        char joined[PATH_CAP];
        if (dirname_join(from,resolved,joined)) return candidate_file(p,joined,lang);
        return 0;
    }
    long id=config_aliases(p,fid,from,module,lang); if (id) return id;
    id=workspace_package(p,fid,from,module,lang); if (id) return id;
    if (!strcmp(lang,"typescript") || !strcmp(lang,"javascript")) return 0;
    return candidate_file(p,module,lang);
}
static long symbol_named(ImportPass *p,long file,const char *name) {
    if (!name || !*name || !file) return 0;
    sqlite3_stmt *q=cg_prep(p->cg,
        "SELECT s.id FROM symbols s WHERE s.file_id=?1 AND s.name=?2 "
        "AND s.decl=0 LIMIT 2");
    sqlite3_bind_int64(q,1,file); bind_str(q,2,name);
    long id=0; if (sqlite3_step(q)==SQLITE_ROW) {
        id=sqlite3_column_int64(q,0);
        if (sqlite3_step(q)==SQLITE_ROW) id=0;
    }
    sqlite3_finalize(q); return id;
}
static long exported_symbol(ImportPass *p,long file,const char *name,
                            long visited[EXPORT_DEPTH],int depth) {
    if (!file || !name || depth==EXPORT_DEPTH) return 0;
    for (int i=0;i<depth;i++) if (visited[i]==file) return 0;
    visited[depth]=file;
    sqlite3_stmt *q=cg_prep(p->cg,
       "SELECT id,local_name,original_name,kind,target_file_id,target_symbol_id "
       "FROM semantic_bindings WHERE file_id=?1 AND is_export=1 "
       "AND (exported_name=?2 OR kind='export_all') ORDER BY id");
    sqlite3_bind_int64(q,1,file); bind_str(q,2,name);
    long found=0; int matches=0;
    while (sqlite3_step(q)==SQLITE_ROW) {
        const char *local=(const char *)sqlite3_column_text(q,1);
        const char *original=(const char *)sqlite3_column_text(q,2);
        const char *kind=(const char *)sqlite3_column_text(q,3);
        long target=sqlite3_column_int64(q,4), sym=sqlite3_column_int64(q,5);
        long id=0;
        if (target) {
            const char *query=(kind && !strcmp(kind,"export_all")) ? name :
                              (original && *original ? original : local);
            id=exported_symbol(p,target,query,visited,depth+1);
        } else if (sym) id=sym;
        else if (local) id=symbol_named(p,file,local);
        if (id) { found=id; matches++; }
        if (matches>1) break;
    }
    sqlite3_finalize(q);
    if (matches==1) return found;
    /* Older syntax adapters may expose exported flags without an export
     * binding. This fallback still requires an explicit exported symbol. */
    q=cg_prep(p->cg,"SELECT s.id FROM symbols s JOIN semantic_symbols ss "
                "ON ss.symbol_id=s.id WHERE s.file_id=?1 AND s.name=?2 "
                "AND ss.exported=1 LIMIT 2");
    sqlite3_bind_int64(q,1,file); bind_str(q,2,name);
    long id=0; if (sqlite3_step(q)==SQLITE_ROW) {
        id=sqlite3_column_int64(q,0); if (sqlite3_step(q)==SQLITE_ROW) id=0;
    }
    sqlite3_finalize(q); return id;
}
static void update(ImportPass *p,long id,long file,long symbol) {
    sqlite3_stmt *q=p->update_binding;
    if (file) sqlite3_bind_int64(q,1,file); else sqlite3_bind_null(q,1);
    if (symbol) sqlite3_bind_int64(q,2,symbol); else sqlite3_bind_null(q,2);
    sqlite3_bind_int64(q,3,id); checked_step(p->cg,q);
}
int sem_imports_pass(Cg *cg,const long *changed_files,int nfiles) {
    if (changed_files && nfiles==0) return 0;
    if (changed_files) make_scope(cg,changed_files,nfiles);
    ImportPass p={.cg=cg};
    p.find_file=cg_prep(cg,"SELECT id FROM files WHERE path=?1 AND branch_id=?2 LIMIT 1");
    p.update_binding=cg_prep(cg,"UPDATE semantic_bindings SET target_file_id=?1,"
                              "target_symbol_id=?2 WHERE id=?3");
    p.add_dependency=cg_prep(cg,"INSERT INTO semantic_dependencies("
        "branch_id,file_id,dependency_key,dependency_hash,kind) VALUES(?1,?2,?3,?4,?5) "
        "ON CONFLICT(branch_id,file_id,dependency_key,kind) DO UPDATE SET "
        "dependency_hash=excluded.dependency_hash");
    sqlite3_stmt *q=cg_prep(cg,changed_files ?
       "SELECT b.id,b.file_id,b.module,b.local_name,b.original_name,b.kind,"
       "b.exported_name,b.is_export,b.is_system,b.target_file_id "
       "FROM semantic_bindings b JOIN files f ON f.id=b.file_id "
       "JOIN temp.sem_import_scope scope ON scope.id=b.file_id "
       "WHERE f.branch_id=?1 ORDER BY b.id" :
       "SELECT b.id,b.file_id,b.module,b.local_name,b.original_name,b.kind,"
       "b.exported_name,b.is_export,b.is_system,b.target_file_id "
       "FROM semantic_bindings b JOIN files f ON f.id=b.file_id "
       "WHERE f.branch_id=?1 ORDER BY b.id");
    sqlite3_bind_int64(q,1,cg->branch_id);
    while (sqlite3_step(q)==SQLITE_ROW) {
        if (p.nbindings==p.capbindings) {
            p.capbindings=p.capbindings ? p.capbindings*2 : 128;
            p.bindings=xrealloc(p.bindings,sizeof *p.bindings*(size_t)p.capbindings);
        }
        Binding *b=&p.bindings[p.nbindings++];
        *b=(Binding){.id=sqlite3_column_int64(q,0),.file_id=sqlite3_column_int64(q,1),
            .module=copy_col(q,2),.local=copy_col(q,3),.original=copy_col(q,4),
            .kind=copy_col(q,5),.exported=copy_col(q,6),
            .is_export=sqlite3_column_int(q,7),.is_system=sqlite3_column_int(q,8),
            .target_file_id=sqlite3_column_int64(q,9)};
    }
    sqlite3_finalize(q);
    if (p.nbindings) load_packages(&p);
    /* Every nonempty pass checks current source and config state. Replacing
     * dependencies for affected files avoids stale reverse keys. */
    q=cg_prep(cg,changed_files ?
        "DELETE FROM semantic_dependencies WHERE branch_id=?1 AND file_id "
        "IN (SELECT id FROM temp.sem_import_scope)" :
        "DELETE FROM semantic_dependencies WHERE branch_id=?1");
    sqlite3_bind_int64(q,1,cg->branch_id); checked_step(cg,q); sqlite3_finalize(q);
    for (int i=0;i<p.nbindings;i++) {
        Binding *b=&p.bindings[i];
        sqlite3_stmt *fq=cg_prep(cg,"SELECT path,lang FROM files WHERE id=?1 AND branch_id=?2");
        sqlite3_bind_int64(fq,1,b->file_id); sqlite3_bind_int64(fq,2,cg->branch_id);
        if (sqlite3_step(fq)!=SQLITE_ROW) { sqlite3_finalize(fq); continue; }
        char *from=copy_col(fq,0), *lang=copy_col(fq,1); sqlite3_finalize(fq);
        long file=0,symbol=0;
        if (!b->is_system && b->module && lang)
            file=module_file(&p,b->file_id,from,b->module,lang);
        if (file) file_dependency(&p,b->file_id,file);
        else if (b->module && lang)
            unresolved_candidates(&p,b->file_id,from,b->module,lang);
        /* A namespace import has a file target, deliberately no symbol. */
        if (file && (b->original || (b->kind && !strcmp(b->kind,"default"))) &&
            (!b->original || strcmp(b->original,"*")) &&
            (!b->kind || strcmp(b->kind,"namespace"))) {
            long visited[EXPORT_DEPTH]={0};
            const char *wanted=!strcmp(b->kind ? b->kind : "","default") ? "default" : b->original;
            symbol=exported_symbol(&p,file,wanted,visited,0);
            if (!symbol && !strcmp(lang,"python") && b->kind &&
                !strcmp(b->kind,"from-import"))
                symbol=symbol_named(&p,file,wanted);
        }
        if (b->is_export && !file && b->local)
            symbol=symbol_named(&p,b->file_id,b->local);
        update(&p,b->id,file,symbol);
        b->target_file_id=file;
        free(from); free(lang);
    }
    /* A second pass resolves re-export targets that were unknown at entry.
     * Additional chains are handled recursively by exported_symbol. */
    for (int i=0;i<p.nbindings;i++) {
        Binding *b=&p.bindings[i];
        if (!b->target_file_id || !b->original || !strcmp(b->original,"*")) continue;
        long visited[EXPORT_DEPTH]={0};
        long sym=exported_symbol(&p,b->target_file_id,b->original,visited,0);
        if (sym) update(&p,b->id,b->target_file_id,sym);
    }
    for (int i=0;i<p.nbindings;i++) {
        Binding *b=&p.bindings[i];
        free(b->module); free(b->local); free(b->original);
        free(b->kind); free(b->exported);
    }
    free(p.bindings);
    for (int i=0;i<p.npackages;i++) {
        free(p.packages[i].path);free(p.packages[i].name);free(p.packages[i].entry);
    }
    free(p.packages);
    sqlite3_finalize(p.find_file);sqlite3_finalize(p.update_binding);
    sqlite3_finalize(p.add_dependency);
    return 0;
}
int sem_imports_register(void) { return sem_pass_register("imports",10,sem_imports_pass); }

bool sem_imports_config_changed(Cg *cg) {
    sqlite3_stmt *q=cg_prep(cg,"SELECT DISTINCT dependency_key,dependency_hash "
        "FROM semantic_dependencies WHERE branch_id=?1 AND kind IN "
        "('project-config','workspace-package','module-config')");
    sqlite3_bind_int64(q,1,cg->branch_id);
    bool changed=false;
    while (sqlite3_step(q)==SQLITE_ROW) {
        const char *rel=(const char *)sqlite3_column_text(q,0);
        const char *old=(const char *)sqlite3_column_text(q,1);
        char abs[PATH_CAP];
        if (!rel || !path_format(abs,sizeof abs,"%s/%s",cg->root,rel)) continue;
        size_t len=0; char *data=read_entire_file(abs,&len);
        if ((data!=NULL)!=(old!=NULL)) changed=true;
        else if (data && old) {
            char hash[65]; sha256_hex(data,len,hash);
            if (strcmp(hash,old)) changed=true;
        }
        free(data);
        if (changed) break;
    }
    sqlite3_finalize(q);
    return changed;
}
