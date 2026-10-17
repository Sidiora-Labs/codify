/*
 * Agent context file generation: .codify/agent-context.md built from the graph —
 * languages, directory map, build tooling, entry points, routes, and the
 * most-referenced ("load-bearing") symbols, plus a cg cheatsheet so agents
 * can query the graph themselves.
 */
#include "cg.h"
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>

/* Preserve unknown/user files and a durable byte-identical backup before
 * replacing generator-owned text. Old and new ownership markers both qualify. */
static int owned_write_at(const char *,const char *,size_t,const char *,bool);
int hyperfide_owned_write(const char *filename,const char *data,size_t length,
                         const char *marker,bool force) {
    char absolute[5800],parent[5800],allowed[5800];
    if(strlen(filename)>=sizeof absolute)return -1;
    if(filename[0]=='/')snprintf(absolute,sizeof absolute,"%s",filename);
    else {if(!getcwd(absolute,sizeof absolute))return -1;size_t n=strlen(absolute);snprintf(absolute+n,sizeof absolute-n,"/%s",filename);}
    const char *boundary=getenv("HYPERFIDE_GENERATION_ROOT");
    if(boundary){
        if(!realpath(boundary,allowed))return -1;
        size_t n=strlen(allowed);
        if(strncmp(absolute,allowed,n)||absolute[n]!='/')return -1;
    }
    snprintf(parent,sizeof parent,"%s",absolute);
    char *last=strrchr(parent,'/');if(!last||!last[1])return -1;
    char leaf[512];if(strlen(last+1)>=sizeof leaf)return -1;snprintf(leaf,sizeof leaf,"%s",last+1);*last=0;
    if(!strcmp(leaf,".")||!strcmp(leaf,".."))return -1;
    int directory=open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW);if(directory<0)return -1;
    char *state=NULL;
    for(char *part=strtok_r(parent,"/",&state);part;part=strtok_r(NULL,"/",&state)){
        if(!strcmp(part,"."))continue;
        if(!strcmp(part,"..")){close(directory);return -1;}
        int next=openat(directory,part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
        if(next<0&&errno==ENOENT){
            if(mkdirat(directory,part,0755)&&errno!=EEXIST){close(directory);return -1;}
            next=openat(directory,part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
        }
        if(next<0){close(directory);return -1;}
        close(directory);directory=next;
    }
    char anchored[700];snprintf(anchored,sizeof anchored,"/proc/self/fd/%d/%s",directory,leaf);
    int rc=owned_write_at(anchored,data,length,marker,force);
    close(directory);return rc;
}
static int owned_write_at(const char *filename,const char *data,size_t length,
                         const char *marker,bool force) {
    struct stat info;bool exists=lstat(filename,&info)==0;
    if(exists&&!S_ISREG(info.st_mode))return -1;
    size_t old_length=0;char *old=exists?read_entire_file(filename,&old_length):NULL;
    if(exists&&!old)return -1;
    if(old){
        char legacy[160],canonical[160];
        snprintf(legacy,sizeof legacy,"codify-owned: %s",marker);
        snprintf(canonical,sizeof canonical,"hyperfide-owned: %s",marker);
        if(!force&&!strstr(old,legacy)&&!strstr(old,canonical)){free(old);return -1;}
        if(old_length==length&&!memcmp(old,data,length)){free(old);return 0;}
    }
    char parent[5200],backup_dir[5400],backup[6400],temporary[6400],hash[65];
    snprintf(parent,sizeof parent,"%s",filename);
    char *slash=strrchr(parent,'/');
    if(slash){if(slash==parent)slash[1]=0;else *slash=0;}else snprintf(parent,sizeof parent,".");
    if(mkdirs(parent)) {free(old);return -1;}
    if(old){
        sha256_hex(old,old_length,hash);
        const char *base=strrchr(filename,'/');base=base?base+1:filename;
        char leaf[512];if(strlen(base)>=sizeof leaf){free(old);return -1;}
        snprintf(leaf,sizeof leaf,"%s",base);
        snprintf(backup_dir,sizeof backup_dir,"%s/.hyperfide-backups",parent);
        if(mkdirs(backup_dir)){free(old);return -1;}
        snprintf(backup,sizeof backup,"%s/%s.%s",backup_dir,leaf,hash);
        int fd=open(backup,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0600);
        if(fd<0&&errno==EEXIST){
            struct stat backup_info;
            if(lstat(backup,&backup_info)||!S_ISREG(backup_info.st_mode)||backup_info.st_nlink!=1){free(old);return -1;}
            size_t n=0;char *prior=read_entire_file(backup,&n);
            bool same=prior&&n==old_length&&!memcmp(prior,old,n);free(prior);
            if(!same){free(old);return -1;}
        }else if(fd<0){free(old);return -1;}
        else {
            size_t written=0;
            while(written<old_length){ssize_t n=write(fd,old+written,old_length-written);if(n<=0){close(fd);free(old);return -1;}written+=(size_t)n;}
            int synced=fsync(fd),closed=close(fd);
            if(synced||closed){free(old);return -1;}
        }
        int directory=open(backup_dir,O_RDONLY|O_DIRECTORY);
        if(directory<0){free(old);return -1;}
        int status=fsync(directory);close(directory);if(status){free(old);return -1;}
    }
    free(old);sha256_hex(data,length,hash);
    snprintf(temporary,sizeof temporary,"%s.hyperfide-new-%ld-%ld-%s",filename,(long)getpid(),now_ms(),hash);
    int fd=open(temporary,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,exists?(info.st_mode&0777):0644);
    if(fd<0)return -1;
    size_t written=0;
    while(written<length){ssize_t n=write(fd,data+written,length-written);if(n<=0){close(fd);unlink(temporary);return -1;}written+=(size_t)n;}
    int synced=fsync(fd),closed=close(fd);
    if(synced||closed){unlink(temporary);return -1;}
    if(rename(temporary,filename)){unlink(temporary);return -1;}
    int directory=open(parent,O_RDONLY|O_DIRECTORY);if(directory<0)return -1;
    int status=fsync(directory);close(directory);return status;
}

typedef struct { char name[128]; int files; long lines;
                 char top_lang[32]; int top_lang_n;
                 char langs[8][32]; int langn[8]; int nlangs; } DirAgg;

static void dir_lang(DirAgg *d, const char *lang) {
    for (int i = 0; i < d->nlangs; i++)
        if (strcmp(d->langs[i], lang) == 0) {
            if (++d->langn[i] > d->top_lang_n) {
                d->top_lang_n = d->langn[i];
                snprintf(d->top_lang, sizeof d->top_lang, "%s", lang);
            }
            return;
        }
    if (d->nlangs < 8) {
        snprintf(d->langs[d->nlangs], 32, "%s", lang);
        d->langn[d->nlangs] = 1;
        if (d->top_lang_n == 0) {
            snprintf(d->top_lang, sizeof d->top_lang, "%s", lang);
            d->top_lang_n = 1;
        }
        d->nlangs++;
    }
}

static const struct { const char *file, *what; } TOOLING[] = {
    { "Makefile",           "make" },
    { "CMakeLists.txt",     "CMake" },
    { "package.json",       "npm/node" },
    { "go.mod",             "Go modules" },
    { "Cargo.toml",         "Cargo (Rust)" },
    { "pyproject.toml",     "Python (pyproject)" },
    { "requirements.txt",   "Python (pip)" },
    { "pom.xml",            "Maven (Java)" },
    { "build.gradle",       "Gradle" },
    { "build.gradle.kts",   "Gradle (Kotlin)" },
    { "composer.json",      "Composer (PHP)" },
    { "Gemfile",            "Bundler (Ruby)" },
    { "Dockerfile",         "Docker" },
    { "docker-compose.yml", "Docker Compose" },
    { "foundry.toml",       "Foundry (Solidity)" },
    { "hardhat.config.js",  "Hardhat (Solidity)" },
    { NULL, NULL }
};

int cmd_agentmd(Cg *cg, bool write_files) {
    StrBuf md; sb_init(&md);
    int rc = 0;
    const char *base = strrchr(cg->root, '/');
    base = base && base[1] ? base + 1 : cg->root;

    sb_printf(&md, "# %s — Agent Context\n\n", base);
    sb_puts(&md, "<!-- hyperfide-owned: graph-agent-context v1 -->\n\n"
                 "_Generated graph context owned by `hyperfide agentmd`. Regenerate "
                 "with `hyperfide agentmd --write` after significant changes. "
                 "Workflow instructions remain owned by `hyperfide spec render`._\n\n");

    /* ---- language table ---- */
    sb_puts(&md, "## Languages\n\n| Language | Files | Lines |\n|---|---:|---:|\n");
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT lang, COUNT(*), SUM(lines) FROM files WHERE lang IS NOT NULL "
        "GROUP BY lang ORDER BY 2 DESC");
    long tot_files = 0, tot_lines = 0;
    while (sqlite3_step(st) == SQLITE_ROW) {
        const char *lang = (const char *)sqlite3_column_text(st, 0);
        long nf = sqlite3_column_int64(st, 1);
        long nl = sqlite3_column_int64(st, 2);
        sb_printf(&md, "| %s | %ld | %ld |\n", lang, nf, nl);
        tot_files += nf;
        tot_lines += nl;
    }
    sqlite3_finalize(st);
    sb_printf(&md, "\n%ld source files, %ld lines total.\n\n",
              tot_files, tot_lines);

    /* ---- directory map ---- */
    sb_puts(&md, "## Directory map\n\n");
    DirAgg *dirs = xmalloc(sizeof(DirAgg) * 256);
    int ndirs = 0;
    st = cg_prep(cg, "SELECT path, lang, lines FROM files WHERE lang IS NOT NULL");
    while (sqlite3_step(st) == SQLITE_ROW) {
        const char *path = (const char *)sqlite3_column_text(st, 0);
        const char *lang = (const char *)sqlite3_column_text(st, 1);
        long lines = sqlite3_column_int64(st, 2);
        char seg[128];
        const char *slash = strchr(path, '/');
        if (slash) snprintf(seg, sizeof seg, "%.*s/", (int)(slash - path), path);
        else       snprintf(seg, sizeof seg, "(root)");
        DirAgg *d = NULL;
        for (int i = 0; i < ndirs; i++)
            if (strcmp(dirs[i].name, seg) == 0) { d = &dirs[i]; break; }
        if (!d && ndirs < 256) {
            d = &dirs[ndirs++];
            memset(d, 0, sizeof *d);
            snprintf(d->name, sizeof d->name, "%s", seg);
        }
        if (d) {
            d->files++;
            d->lines += lines;
            dir_lang(d, lang);
        }
    }
    sqlite3_finalize(st);
    for (int i = 0; i < ndirs; i++)
        sb_printf(&md, "- `%s` — %d files, %ld lines (mostly %s)\n",
                  dirs[i].name, dirs[i].files, dirs[i].lines, dirs[i].top_lang);
    free(dirs);
    sb_putc(&md, '\n');

    /* ---- build & tooling ---- */
    sb_puts(&md, "## Build & tooling\n\n");
    bool any_tool = false;
    for (int i = 0; TOOLING[i].file; i++) {
        char p[4900];
        snprintf(p, sizeof p, "%s/%s", cg->root, TOOLING[i].file);
        struct stat sb2;
        if (stat(p, &sb2) != 0) continue;
        any_tool = true;
        sb_printf(&md, "- `%s` — %s", TOOLING[i].file, TOOLING[i].what);
        if (strcmp(TOOLING[i].file, "package.json") == 0) {
            char *body = read_entire_file(p, NULL);
            char *scripts = body ? json_get_object(body, "scripts") : NULL;
            if (scripts) {
                char *keys[24];
                int nk = json_object_keys(scripts, keys, 24);
                if (nk) {
                    sb_puts(&md, " (scripts:");
                    for (int k = 0; k < nk; k++) {
                        sb_printf(&md, " `%s`", keys[k]);
                        free(keys[k]);
                    }
                    sb_putc(&md, ')');
                }
                free(scripts);
            }
            free(body);
        }
        sb_putc(&md, '\n');
    }
    if (!any_tool) sb_puts(&md, "- no standard build files detected\n");
    sb_putc(&md, '\n');

    /* ---- entry points ---- */
    sb_puts(&md, "## Entry points\n\n");
    int ne = 0;
    st = cg_prep(cg,
        "SELECT s.name, s.kind, f.path, s.line FROM symbols s "
        "JOIN files f ON f.id=s.file_id "
        "WHERE s.name IN ('main','Main','__main__') AND s.decl=0 "
        "ORDER BY f.path LIMIT 15");
    while (sqlite3_step(st) == SQLITE_ROW) {
        sb_printf(&md, "- %s `%s` — `%s:%d`\n",
                  (const char *)sqlite3_column_text(st, 1),
                  (const char *)sqlite3_column_text(st, 0),
                  (const char *)sqlite3_column_text(st, 2),
                  sqlite3_column_int(st, 3));
        ne++;
    }
    sqlite3_finalize(st);
    if (!ne) sb_puts(&md, "- no `main` entry points (library or web project)\n");
    sb_putc(&md, '\n');

    /* ---- routes ---- */
    st = cg_prep(cg,
        "SELECT r.method, r.pattern, r.handler, f.path, r.line, r.framework "
        "FROM routes r JOIN files f ON f.id=r.file_id ORDER BY r.pattern LIMIT 60");
    int nr = 0;
    StrBuf rt; sb_init(&rt);
    while (sqlite3_step(st) == SQLITE_ROW) {
        const char *h = (const char *)sqlite3_column_text(st, 2);
        sb_printf(&rt, "| %s | `%s` | %s%s%s | `%s:%d` |\n",
                  (const char *)sqlite3_column_text(st, 0),
                  (const char *)sqlite3_column_text(st, 1),
                  h ? "`" : "", h ? h : "—", h ? "`" : "",
                  (const char *)sqlite3_column_text(st, 3),
                  sqlite3_column_int(st, 4));
        nr++;
    }
    sqlite3_finalize(st);
    if (nr) {
        sb_puts(&md, "## HTTP routes\n\n| Method | Pattern | Handler | Where |\n"
                     "|---|---|---|---|\n");
        sb_puts(&md, rt.p);
        sb_putc(&md, '\n');
    }
    sb_free(&rt);

    /* ---- load-bearing symbols ---- */
    sb_puts(&md, "## Load-bearing symbols (most referenced)\n\n");
    st = cg_prep(cg,
        "SELECT r.name, COUNT(*) AS c FROM refs r "
        "WHERE EXISTS(SELECT 1 FROM symbols s WHERE s.name=r.name) "
        "GROUP BY r.name ORDER BY c DESC LIMIT 15");
    sqlite3_stmt *loc = cg_prep(cg,
        "SELECT s.kind, f.path, s.line FROM symbols s "
        "JOIN files f ON f.id=s.file_id WHERE s.name=? "
        "ORDER BY s.decl, s.id LIMIT 1");
    while (sqlite3_step(st) == SQLITE_ROW) {
        const char *name = (const char *)sqlite3_column_text(st, 0);
        int c = sqlite3_column_int(st, 1);
        sqlite3_bind_text(loc, 1, name, -1, SQLITE_TRANSIENT);
        if (sqlite3_step(loc) == SQLITE_ROW)
            sb_printf(&md, "- `%s` (%s, %d refs) — `%s:%d`\n", name,
                      (const char *)sqlite3_column_text(loc, 0), c,
                      (const char *)sqlite3_column_text(loc, 1),
                      sqlite3_column_int(loc, 2));
        sqlite3_reset(loc);
        sqlite3_clear_bindings(loc);
    }
    sqlite3_finalize(loc);
    sqlite3_finalize(st);

    /* ---- cheatsheet ---- */
    sb_puts(&md,
        "\n## Querying this codebase\n\n"
        "This project is indexed by Codify (SQLite + FTS5, 100% local). "
        "Prefer these over grep/file-walking — one call returns definitions, "
        "snippets, and call edges:\n\n"
        "```bash\n"
        "cg context <query>      # symbols + snippets + callers/callees + routes\n"
        "cg search <text>        # instant name/full-text search\n"
        "cg grep <pattern> [-i]  # line search, each hit in its symbol\n"
        "cg files <glob|words>   # find files; --dirs maps directories\n"
        "cg symbol <name>        # definition + snippet + reference count\n"
        "cg impact <name> -d 3   # who breaks if this changes\n"
        "cg routes [filter]      # URL pattern -> handler\n"
        "cg changes              # impact radius of uncommitted edits\n"
        "```\n\n"
        "All of the above accept `--json`. The graph auto-syncs via "
        "`hyperfide watch`, or connect over MCP with `hyperfide mcp-install`.\n\n"
        "Over MCP, use `grep_code`, `find_files`, `search_code`, and "
        "`get_context` before any shell search: `hyperfide grep` and `hyperfide files` "
        "answer what grep, rg, and find would, ranked and capped to a token "
        "budget.\n\n"
        /* an agent that re-runs a queued write duplicates it, and one that
         * does not re-run an exit 75 loses it: the two must not blur */
        "When another process (an editor's indexer) holds the database, "
        "`hyperfide remember`, `hyperfide handoff`, and the bookkeeping behind "
        "`hyperfide spec done` say **queued**: the write is kept in "
        "`.codegraph/journal/` and the next `cg` command applies it — do not "
        "re-run it. Exit 75 (a claim) means nothing changed: re-run the same "
        "command. `hyperfide journal` lists what is queued.\n");

    if (write_files) {
        char dir[4700], path[4900];
        config_context_dir(cg->root, dir, sizeof dir);
        config_context_path(cg->root, "agent-context.md", path, sizeof path);
        if (hyperfide_owned_write(path, md.p, md.len, "graph-agent-context v1", false) == 0)
            printf("wrote %s\n", path);
        else {
            fprintf(stderr, "cg: cannot write %s\n", path);
            rc = 1;
        }
    } else {
        fputs(md.p, stdout);
    }
    sb_free(&md);
    return rc;
}
