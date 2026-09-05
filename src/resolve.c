/*
 * Import resolution: resolve module strings to repository files and
 * classify origin as repo, manifest, system, or unknown.
 *
 * Runs once after the parallel parse, over the database, single-threaded.
 * The Makefile discovers C sources in src, so there is no build change.
 */
#include "cg.h"
#include <ctype.h>

/* ---- manifest loading ---- */

/* A manifest entry: a dependency name from package.json, go.mod, etc. */
typedef struct { char *name; } ManifestDep;

typedef struct {
    ManifestDep *deps;
    int ndeps, cdeps;
    bool loaded;       /* at least one manifest was found for this lang */
} Manifest;

static void manifest_add(Manifest *m, const char *name, size_t len) {
    if (m->ndeps == m->cdeps) {
        m->cdeps = m->cdeps ? m->cdeps * 2 : 32;
        m->deps = xrealloc(m->deps, sizeof(ManifestDep) * (size_t)m->cdeps);
    }
    m->deps[m->ndeps].name = xmalloc(len + 1);
    memcpy(m->deps[m->ndeps].name, name, len);
    m->deps[m->ndeps].name[len] = 0;
    m->ndeps++;
}

static void manifest_free(Manifest *m) {
    for (int i = 0; i < m->ndeps; i++) free(m->deps[i].name);
    free(m->deps);
    memset(m, 0, sizeof *m);
}

static bool manifest_has(const Manifest *m, const char *module) {
    for (int i = 0; i < m->ndeps; i++)
        if (strcmp(m->deps[i].name, module) == 0) return true;
    /* scoped packages: @scope/pkg matches when module starts with it */
    for (int i = 0; i < m->ndeps; i++) {
        size_t dl = strlen(m->deps[i].name);
        if (strncmp(m->deps[i].name, module, dl) == 0 &&
            (module[dl] == '/' || module[dl] == 0))
            return true;
    }
    return false;
}

/* package.json: read dependencies and devDependencies keys */
static void load_package_json(const char *root, Manifest *js) {
    char path[4096];
    if (!path_format(path, sizeof path, "%s/package.json", root)) return;
    size_t len;
    char *data = read_entire_file(path, &len);
    if (!data) return;
    js->loaded = true;
    const char *sections[] = { "dependencies", "devDependencies",
                               "peerDependencies", NULL };
    for (int s = 0; sections[s]; s++) {
        char *obj = json_get_object(data, sections[s]);
        if (!obj) continue;
        char *keys[256];
        int nk = json_object_keys(obj, keys, 256);
        for (int i = 0; i < nk; i++) {
            manifest_add(js, keys[i], strlen(keys[i]));
            free(keys[i]);
        }
        free(obj);
    }
    free(data);
}

/* go.mod: require ( ... ) blocks and single require lines */
static void load_go_mod(const char *root, Manifest *go) {
    char path[4096];
    if (!path_format(path, sizeof path, "%s/go.mod", root)) return;
    size_t len;
    char *data = read_entire_file(path, &len);
    if (!data) return;
    go->loaded = true;
    bool in_block = false;
    const char *p = data;
    while (*p) {
        while (*p && (*p == ' ' || *p == '\t')) p++;
        const char *ls = p;
        const char *nl = strchr(p, '\n');
        size_t ll = nl ? (size_t)(nl - ls) : strlen(ls);
        p = nl ? nl + 1 : ls + ll;
        if (ll == 0) continue;
        /* detect require ( */
        if (ll >= 7 && strncmp(ls, "require", 7) == 0) {
            const char *after = ls + 7;
            while (after < ls + ll && (*after == ' ' || *after == '\t')) after++;
            if (*after == '(') { in_block = true; continue; }
            /* single-line require: require mod/path v1.2.3 */
            if (after < ls + ll) {
                const char *end = after;
                while (end < ls + ll && *end != ' ' && *end != '\t') end++;
                manifest_add(go, after, (size_t)(end - after));
            }
            continue;
        }
        if (in_block) {
            if (ls[0] == ')') { in_block = false; continue; }
            const char *s = ls;
            while (s < ls + ll && (*s == ' ' || *s == '\t')) s++;
            if (s >= ls + ll || *s == '/' || *s == ')') continue;
            const char *e = s;
            while (e < ls + ll && *e != ' ' && *e != '\t') e++;
            manifest_add(go, s, (size_t)(e - s));
        }
    }
    free(data);
}

/* requirements.txt / pyproject.toml: line-shaped dependency names */
static void load_requirements_txt(const char *root, Manifest *py) {
    char path[4096];
    if (!path_format(path, sizeof path, "%s/requirements.txt", root)) return;
    size_t len;
    char *data = read_entire_file(path, &len);
    if (!data) return;
    py->loaded = true;
    const char *p = data;
    while (*p) {
        while (*p == ' ' || *p == '\t') p++;
        if (*p == '#' || *p == '-' || *p == '\n') {
            while (*p && *p != '\n') p++;
            if (*p == '\n') p++;
            continue;
        }
        const char *s = p;
        while (*p && *p != '\n' && *p != '=' && *p != '>' && *p != '<' &&
               *p != '!' && *p != '[' && *p != ';' && *p != ' ' && *p != '\t')
            p++;
        if (p > s)
            manifest_add(py, s, (size_t)(p - s));
        while (*p && *p != '\n') p++;
        if (*p == '\n') p++;
    }
    free(data);
}

/* pyproject.toml: [project] dependencies = [...] — very simple extraction */
static void load_pyproject_toml(const char *root, Manifest *py) {
    char path[4096];
    if (!path_format(path, sizeof path, "%s/pyproject.toml", root)) return;
    size_t len;
    char *data = read_entire_file(path, &len);
    if (!data) return;
    py->loaded = true;
    /* find dependencies = [ ... ] */
    const char *dep = strstr(data, "dependencies");
    if (!dep) { free(data); return; }
    const char *eq = strchr(dep, '=');
    if (!eq) { free(data); return; }
    const char *bracket = strchr(eq, '[');
    if (!bracket) { free(data); return; }
    const char *end = strchr(bracket, ']');
    if (!end) end = data + len;
    const char *p = bracket + 1;
    while (p < end) {
        while (p < end && *p != '"' && *p != '\'') p++;
        if (p >= end) break;
        char q = *p++;
        const char *s = p;
        /* package name ends at version spec or quote */
        while (p < end && *p != q && *p != '>' && *p != '<' && *p != '=' &&
               *p != '!' && *p != '[' && *p != ';') p++;
        size_t nl = (size_t)(p - s);
        while (nl && (s[nl-1] == ' ' || s[nl-1] == '\t')) nl--;
        if (nl) manifest_add(py, s, nl);
        while (p < end && *p != q) p++;
        if (p < end) p++;
    }
    free(data);
}

/* Cargo.toml: [dependencies] section, key = "version" or key = { ... } */
static void load_cargo_toml(const char *root, Manifest *rs) {
    char path[4096];
    if (!path_format(path, sizeof path, "%s/Cargo.toml", root)) return;
    size_t len;
    char *data = read_entire_file(path, &len);
    if (!data) return;
    rs->loaded = true;
    bool in_deps = false;
    const char *p = data;
    while (*p) {
        while (*p == ' ' || *p == '\t') p++;
        const char *ls = p;
        const char *nl = strchr(p, '\n');
        size_t ll = nl ? (size_t)(nl - ls) : strlen(ls);
        p = nl ? nl + 1 : ls + ll;
        if (ll == 0) continue;
        /* section header */
        if (ls[0] == '[') {
            in_deps = (strstr(ls, "dependencies") != NULL &&
                       strstr(ls, "dev-dependencies") == NULL);
            /* also accept [dev-dependencies] */
            if (strstr(ls, "dev-dependencies")) in_deps = true;
            continue;
        }
        if (!in_deps) continue;
        /* key = value line */
        const char *eq = memchr(ls, '=', ll);
        if (!eq) continue;
        const char *ke = eq;
        while (ke > ls && (ke[-1] == ' ' || ke[-1] == '\t')) ke--;
        if (ke <= ls) continue;
        manifest_add(rs, ls, (size_t)(ke - ls));
    }
    free(data);
}

/* ---- file path resolution ---- */

/* strip known source extensions from a path for matching */
static void strip_ext(char *buf, size_t cap, const char *path) {
    snprintf(buf, cap, "%s", path);
    char *dot = strrchr(buf, '.');
    if (dot && !strchr(dot, '/')) *dot = 0;
}

/* Try to find a repository file matching an import module string.
 * Returns the file_id or -1 if not found. */
static long find_repo_file(Cg *cg, const char *module, const char *from_path,
                           const char *lang) {
    /* exact match first */
    sqlite3_stmt *exact = cg_prep(cg,
        "SELECT id FROM files WHERE path=? LIMIT 1");
    sqlite3_bind_text(exact, 1, module, -1, SQLITE_STATIC);
    long fid = -1;
    if (sqlite3_step(exact) == SQLITE_ROW)
        fid = sqlite3_column_int64(exact, 0);
    sqlite3_finalize(exact);
    if (fid >= 0) return fid;

    /* resolve relative to the importing file's directory */
    const char *slash = strrchr(from_path, '/');
    char resolved[4096];
    if (slash && module[0] == '.') {
        /* ./foo or ../foo relative import */
        size_t dirlen = (size_t)(slash - from_path);
        const char *m = module;
        char dir[4096];
        snprintf(dir, sizeof dir, "%.*s", (int)dirlen, from_path);
        while (m[0] == '.' && m[1] == '/') m += 2;
        if (m[0] == '.' && m[1] == '.' && m[2] == '/') {
            /* walk up */
            char *up = strrchr(dir, '/');
            if (up) *up = 0;
            m += 3;
        }
        if (!path_format(resolved, sizeof resolved, "%s/%s", dir, m)) return -1;
    } else if (module[0] != '.' && module[0] != '/') {
        /* bare name — try as a path from root */
        snprintf(resolved, sizeof resolved, "%s", module);
    } else {
        snprintf(resolved, sizeof resolved, "%s", module);
    }
    /* strip leading ./ */
    const char *rp = resolved;
    while (rp[0] == '.' && rp[1] == '/') rp += 2;

    /* try the resolved path, with and without extensions */
    static const char *JS_EXTS[] = { ".ts", ".tsx", ".js", ".jsx", ".mjs",
                                     ".cjs", ".mts", ".cts", NULL };
    static const char *C_EXTS[]  = { ".h", ".c", ".hpp", ".cpp", ".cc", NULL };
    static const char *PY_EXTS[] = { ".py", NULL };
    static const char *GO_EXTS[] = { ".go", NULL };

    const char **exts = NULL;
    if (strcmp(lang, "javascript") == 0 || strcmp(lang, "typescript") == 0)
        exts = JS_EXTS;
    else if (strcmp(lang, "c") == 0 || strcmp(lang, "cpp") == 0)
        exts = C_EXTS;
    else if (strcmp(lang, "python") == 0)
        exts = PY_EXTS;
    else if (strcmp(lang, "go") == 0)
        exts = GO_EXTS;

    sqlite3_stmt *q = cg_prep(cg, "SELECT id FROM files WHERE path=? LIMIT 1");

    /* try exact resolved */
    sqlite3_bind_text(q, 1, rp, -1, SQLITE_STATIC);
    if (sqlite3_step(q) == SQLITE_ROW)
        fid = sqlite3_column_int64(q, 0);
    sqlite3_reset(q);
    if (fid >= 0) { sqlite3_finalize(q); return fid; }

    /* try with extensions */
    if (exts) {
        for (int i = 0; exts[i] && fid < 0; i++) {
            char trial[4096];
            if (!path_format(trial, sizeof trial, "%s%s", rp, exts[i])) continue;
            sqlite3_bind_text(q, 1, trial, -1, SQLITE_STATIC);
            if (sqlite3_step(q) == SQLITE_ROW)
                fid = sqlite3_column_int64(q, 0);
            sqlite3_reset(q);
        }
    }
    /* try index file for JS/TS */
    if (fid < 0 && exts == JS_EXTS) {
        for (int i = 0; JS_EXTS[i] && fid < 0; i++) {
            char trial[4096];
            if (!path_format(trial, sizeof trial, "%s/index%s", rp, JS_EXTS[i])) continue;
            sqlite3_bind_text(q, 1, trial, -1, SQLITE_STATIC);
            if (sqlite3_step(q) == SQLITE_ROW)
                fid = sqlite3_column_int64(q, 0);
            sqlite3_reset(q);
        }
    }
    /* Python: try as a package (dir/__init__.py) */
    if (fid < 0 && exts == PY_EXTS) {
        /* convert dots to slashes for package paths */
        char pkgpath[4096];
        size_t j = 0;
        for (const char *c = rp; *c && j + 1 < sizeof pkgpath; c++)
            pkgpath[j++] = (*c == '.') ? '/' : *c;
        pkgpath[j] = 0;
        char trial[4096];
        if (!path_format(trial, sizeof trial, "%s/__init__.py", pkgpath)) {
            sqlite3_finalize(q);
            return -1;
        }
        sqlite3_bind_text(q, 1, trial, -1, SQLITE_STATIC);
        if (sqlite3_step(q) == SQLITE_ROW)
            fid = sqlite3_column_int64(q, 0);
        sqlite3_reset(q);
        if (fid < 0) {
            if (!path_format(trial, sizeof trial, "%s.py", pkgpath)) {
                sqlite3_finalize(q);
                return -1;
            }
            sqlite3_bind_text(q, 1, trial, -1, SQLITE_STATIC);
            if (sqlite3_step(q) == SQLITE_ROW)
                fid = sqlite3_column_int64(q, 0);
            sqlite3_reset(q);
        }
    }
    /* suffix match: extensionless module "util" matches "src/util.ts".
     * Skip when the module already has a source extension — those should
     * resolve only by exact or extension-trial paths above, not by
     * stripping both extensions and comparing basenames (which falsely
     * matches helpers.h → helpers.c). */
    if (fid < 0) {
        const char *mdot = strrchr(rp, '.');
        bool mod_has_ext = mdot && !strchr(mdot, '/');
        if (!mod_has_ext) {
            sqlite3_stmt *suffix = cg_prep(cg,
                "SELECT id, path FROM files ORDER BY path");
            while (sqlite3_step(suffix) == SQLITE_ROW) {
                const char *cp = (const char *)sqlite3_column_text(suffix, 1);
                char cne[4096];
                strip_ext(cne, sizeof cne, cp);
                size_t ml = strlen(rp), cl = strlen(cne);
                if (ml && ml <= cl && strcmp(cne + cl - ml, rp) == 0 &&
                    (cl == ml || cne[cl - ml - 1] == '/')) {
                    fid = sqlite3_column_int64(suffix, 0);
                    break;
                }
            }
            sqlite3_finalize(suffix);
        }
    }
    sqlite3_finalize(q);
    return fid;
}

/* ---- main resolution entry point ---- */

void resolve_imports(Cg *cg) {
    /* Load manifests once */
    Manifest js_m = {0}, go_m = {0}, py_m = {0}, rs_m = {0};
    load_package_json(cg->root, &js_m);
    load_go_mod(cg->root, &go_m);
    load_requirements_txt(cg->root, &py_m);
    load_pyproject_toml(cg->root, &py_m);
    load_cargo_toml(cg->root, &rs_m);

    /* Walk all imports and resolve each */
    sqlite3_stmt *sel = cg_prep(cg,
        "SELECT i.id, i.module, i.system, f.path, f.lang "
        "FROM imports i JOIN files f ON f.id = i.file_id "
        "ORDER BY i.id");
    sqlite3_stmt *upd = cg_prep(cg,
        "UPDATE imports SET target_file_id=?, origin=? WHERE id=?");

    while (sqlite3_step(sel) == SQLITE_ROW) {
        long imp_id  = sqlite3_column_int64(sel, 0);
        const char *module = (const char *)sqlite3_column_text(sel, 1);
        int sys      = sqlite3_column_int(sel, 2);
        const char *from_path = (const char *)sqlite3_column_text(sel, 3);
        const char *lang = (const char *)sqlite3_column_text(sel, 4);
        if (!module || !from_path || !lang) continue;

        const char *origin = NULL;
        long target_fid = -1;

        if (sys) {
            /* system #include <header.h> */
            origin = "system";
        } else {
            /* try to resolve to a repo file */
            target_fid = find_repo_file(cg, module, from_path, lang);
            if (target_fid >= 0) {
                origin = "repo";
            } else {
                /* check manifests */
                /* For JS/TS, extract the package name from the module path:
                 * "express/lib/router" → "express"
                 * "@scope/pkg/util" → "@scope/pkg" */
                bool in_manifest = false;
                if (strcmp(lang, "javascript") == 0 ||
                    strcmp(lang, "typescript") == 0) {
                    if (js_m.loaded) {
                        char pkg[512];
                        snprintf(pkg, sizeof pkg, "%s", module);
                        if (pkg[0] == '@') {
                            /* scoped: keep @scope/name */
                            char *s2 = strchr(pkg + 1, '/');
                            if (s2) {
                                char *s3 = strchr(s2 + 1, '/');
                                if (s3) *s3 = 0;
                            }
                        } else {
                            char *s = strchr(pkg, '/');
                            if (s) *s = 0;
                        }
                        in_manifest = manifest_has(&js_m, pkg);
                    }
                } else if (strcmp(lang, "go") == 0) {
                    in_manifest = go_m.loaded && manifest_has(&go_m, module);
                } else if (strcmp(lang, "python") == 0) {
                    /* extract top-level package name */
                    char pkg[512];
                    snprintf(pkg, sizeof pkg, "%s", module);
                    char *dot = strchr(pkg, '.');
                    if (dot) *dot = 0;
                    in_manifest = py_m.loaded && manifest_has(&py_m, pkg);
                } else if (strcmp(lang, "rust") == 0) {
                    /* extract crate name (first segment of ::path) */
                    char pkg[512];
                    snprintf(pkg, sizeof pkg, "%s", module);
                    char *sep = strstr(pkg, "::");
                    if (sep) *sep = 0;
                    in_manifest = rs_m.loaded && manifest_has(&rs_m, pkg);
                }

                if (in_manifest) {
                    origin = "manifest";
                } else {
                    origin = "unknown";
                }
            }
        }

        /* update the import row */
        if (target_fid >= 0)
            sqlite3_bind_int64(upd, 1, target_fid);
        else
            sqlite3_bind_null(upd, 1);
        sqlite3_bind_text(upd, 2, origin, -1, SQLITE_STATIC);
        sqlite3_bind_int64(upd, 3, imp_id);
        sqlite3_step(upd);
        sqlite3_reset(upd);
    }

    sqlite3_finalize(sel);
    sqlite3_finalize(upd);

    manifest_free(&js_m);
    manifest_free(&go_m);
    manifest_free(&py_m);
    manifest_free(&rs_m);
}

/* ---- builtin tables ---- */

/* C and POSIX builtins, gated on the headers actually included.
 * Sized by measured frequency in this tree, not by completeness. */
static const struct { const char *header; const char *names; } C_BUILTINS[] = {
    {"stdio.h",   "printf,fprintf,sprintf,snprintf,fopen,fclose,fread,fwrite,"
                  "fgets,fputs,puts,putchar,getchar,feof,ferror,fflush,fseek,"
                  "ftell,rewind,remove,rename,tmpfile,perror,sscanf,fscanf,"
                  "vprintf,vfprintf,vsprintf,vsnprintf,stdin,stdout,stderr"},
    {"stdlib.h",  "malloc,calloc,realloc,free,exit,abort,atoi,atol,atof,"
                  "strtol,strtoul,strtod,strtoll,strtoull,qsort,bsearch,"
                  "abs,labs,rand,srand,getenv,system,atexit"},
    {"string.h",  "memcpy,memmove,memset,memcmp,memchr,strlen,strcpy,strncpy,"
                  "strcat,strncat,strcmp,strncmp,strchr,strrchr,strstr,strtok,"
                  "strerror,strdup,strndup,strcasecmp,strncasecmp"},
    {"stdint.h",  "int8_t,int16_t,int32_t,int64_t,uint8_t,uint16_t,uint32_t,"
                  "uint64_t,intptr_t,uintptr_t,size_t,ptrdiff_t"},
    {"stdbool.h", "true,false"},
    {"ctype.h",   "isalpha,isdigit,isalnum,isspace,isupper,islower,toupper,"
                  "tolower,isprint,ispunct,isxdigit"},
    {"math.h",    "sin,cos,tan,sqrt,pow,fabs,ceil,floor,round,log,log10,exp"},
    {"assert.h",  "assert"},
    {"errno.h",   "errno"},
    {"unistd.h",  "read,write,close,lseek,unlink,rmdir,getcwd,chdir,fork,"
                  "exec,execl,execv,pipe,dup,dup2,sleep,usleep,access,isatty,"
                  "sysconf,getpid,getppid"},
    {"fcntl.h",   "open,fcntl,O_RDONLY,O_WRONLY,O_RDWR,O_CREAT,O_TRUNC"},
    {"sys/stat.h","stat,fstat,lstat,mkdir,chmod,umask,S_ISDIR,S_ISREG"},
    {"dirent.h",  "opendir,readdir,closedir"},
    {"pthread.h", "pthread_create,pthread_join,pthread_mutex_init,"
                  "pthread_mutex_lock,pthread_mutex_unlock,pthread_mutex_destroy,"
                  "pthread_cond_init,pthread_cond_wait,pthread_cond_signal,"
                  "pthread_cond_broadcast,pthread_cond_destroy"},
    {"time.h",    "time,clock,difftime,mktime,strftime,localtime,gmtime"},
    {"signal.h",  "signal,raise,kill,sigaction"},
    {"stdarg.h",  "va_start,va_end,va_arg,va_copy,va_list"},
    {"sqlite3.h", "sqlite3_open,sqlite3_close,sqlite3_exec,sqlite3_prepare_v2,"
                  "sqlite3_step,sqlite3_finalize,sqlite3_bind_text,"
                  "sqlite3_bind_int,sqlite3_bind_int64,sqlite3_bind_null,"
                  "sqlite3_bind_double,sqlite3_bind_blob,"
                  "sqlite3_column_text,sqlite3_column_int,sqlite3_column_int64,"
                  "sqlite3_column_double,sqlite3_column_blob,"
                  "sqlite3_column_bytes,sqlite3_column_type,"
                  "sqlite3_reset,sqlite3_errmsg,sqlite3_changes,"
                  "sqlite3_last_insert_rowid,SQLITE_ROW,SQLITE_DONE,"
                  "SQLITE_OK,SQLITE_STATIC,SQLITE_TRANSIENT"},
    {NULL, NULL}
};

/* JS/Node builtins — always available, not header-gated */
static const char *JS_BUILTINS[] = {
    "console","log","warn","error","info","debug",
    "setTimeout","setInterval","clearTimeout","clearInterval",
    "parseInt","parseFloat","isNaN","isFinite","encodeURI","decodeURI",
    "encodeURIComponent","decodeURIComponent",
    "JSON","parse","stringify",
    "Object","keys","values","entries","assign","freeze","create",
    "Array","isArray","from","of","push","pop","shift","unshift",
    "map","filter","reduce","forEach","find","findIndex","includes",
    "some","every","flat","flatMap","sort","reverse","join","slice","splice",
    "concat","indexOf","lastIndexOf","fill",
    "String","charAt","charCodeAt","substring","trim","trimStart","trimEnd",
    "startsWith","endsWith","repeat","padStart","padEnd","split","replace",
    "replaceAll","match","search","toLowerCase","toUpperCase","normalize",
    "Number","toFixed","toPrecision",
    "Math","abs","ceil","floor","round","max","min","random","sqrt","pow",
    "Date","now","getTime","toISOString","toLocaleDateString",
    "Promise","resolve","reject","all","allSettled","race","any","then","catch","finally",
    "RegExp","test","exec",
    "Map","Set","WeakMap","WeakSet","get","set","has","delete","clear","size",
    "Symbol","iterator","asyncIterator","hasInstance","toPrimitive",
    "Error","TypeError","RangeError","ReferenceError","SyntaxError",
    "Proxy","Reflect","globalThis","queueMicrotask","structuredClone",
    "Buffer","process","require","module","exports","__dirname","__filename",
    "fetch","Response","Request","Headers","URL","URLSearchParams",
    "TextEncoder","TextDecoder","Blob","File","FormData",
    "ReadableStream","WritableStream","TransformStream",
    NULL
};

/* Python builtins — always available */
static const char *PY_BUILTINS[] = {
    "print","len","range","enumerate","zip","map","filter","sorted","reversed",
    "list","dict","set","tuple","frozenset","str","int","float","bool","bytes",
    "bytearray","complex","type","object","super","property","classmethod",
    "staticmethod","isinstance","issubclass","hasattr","getattr","setattr",
    "delattr","callable","iter","next","open","close","read","write",
    "input","repr","format","chr","ord","hex","oct","bin","abs","round",
    "min","max","sum","pow","divmod","hash","id","dir","vars","globals",
    "locals","any","all","eval","exec","compile","__import__",
    "ValueError","TypeError","KeyError","IndexError","AttributeError",
    "RuntimeError","StopIteration","OSError","IOError","FileNotFoundError",
    "ImportError","ModuleNotFoundError","NameError","NotImplementedError",
    "Exception","BaseException","SystemExit","KeyboardInterrupt",
    "AssertionError","ZeroDivisionError","OverflowError","MemoryError",
    "True","False","None","NotImplemented","Ellipsis",
    NULL
};

/* Go stdlib builtins — always available (universe scope) */
static const char *GO_BUILTINS[] = {
    "append","cap","close","complex","copy","delete","imag","len",
    "make","new","panic","print","println","real","recover",
    "error","Error","string","bool","byte","rune",
    "int","int8","int16","int32","int64",
    "uint","uint8","uint16","uint32","uint64","uintptr",
    "float32","float64","complex64","complex128",
    "true","false","nil","iota",
    NULL
};

static bool in_list(const char *const *list, const char *name) {
    for (int i = 0; list[i]; i++)
        if (strcmp(list[i], name) == 0) return true;
    return false;
}

/* Check if a name is a C builtin gated by the headers this file includes */
static bool c_builtin(Cg *cg, long file_id, const char *name) {
    /* load the system headers this file includes */
    sqlite3_stmt *q = cg_prep(cg,
        "SELECT module FROM imports WHERE file_id=? AND system=1");
    sqlite3_bind_int64(q, 1, file_id);
    bool found = false;
    while (sqlite3_step(q) == SQLITE_ROW && !found) {
        const char *hdr = (const char *)sqlite3_column_text(q, 0);
        for (int i = 0; C_BUILTINS[i].header && !found; i++) {
            if (strcmp(C_BUILTINS[i].header, hdr) != 0) continue;
            /* scan comma-separated names */
            const char *p = C_BUILTINS[i].names;
            while (*p) {
                const char *s = p;
                while (*p && *p != ',') p++;
                size_t n = (size_t)(p - s);
                if (n == strlen(name) && strncmp(s, name, n) == 0)
                    found = true;
                if (*p == ',') p++;
            }
        }
    }
    sqlite3_finalize(q);
    return found;
}

/* The four resolving languages */
static bool is_resolving_lang(const char *lang) {
    return lang && (strcmp(lang, "c") == 0 || strcmp(lang, "cpp") == 0 ||
                    strcmp(lang, "javascript") == 0 ||
                    strcmp(lang, "typescript") == 0 ||
                    strcmp(lang, "python") == 0 || strcmp(lang, "go") == 0);
}

static bool is_builtin(Cg *cg, const char *lang, long file_id,
                       const char *name) {
    if (strcmp(lang, "c") == 0 || strcmp(lang, "cpp") == 0)
        return c_builtin(cg, file_id, name);
    if (strcmp(lang, "javascript") == 0 || strcmp(lang, "typescript") == 0)
        return in_list(JS_BUILTINS, name);
    if (strcmp(lang, "python") == 0)
        return in_list(PY_BUILTINS, name);
    if (strcmp(lang, "go") == 0)
        return in_list(GO_BUILTINS, name);
    return false;
}

/* ---- ref resolution ---- */

/* Tiered resolution: same file → imported name → same directory → unique.
 * No tier fires → unresolved. */

typedef struct { long id; long file_id; char path[512]; } Cand;

static int find_candidates(Cg *cg, const char *name, Cand *out, int cap) {
    sqlite3_stmt *q = cg_prep(cg,
        "SELECT s.id, s.file_id, f.path FROM symbols s "
        "JOIN files f ON f.id=s.file_id WHERE s.name=? ORDER BY f.path, s.line");
    sqlite3_bind_text(q, 1, name, -1, SQLITE_STATIC);
    int n = 0;
    while (n < cap && sqlite3_step(q) == SQLITE_ROW) {
        out[n].id = sqlite3_column_int64(q, 0);
        out[n].file_id = sqlite3_column_int64(q, 1);
        const char *p = (const char *)sqlite3_column_text(q, 2);
        snprintf(out[n].path, sizeof out[n].path, "%s", p ? p : "");
        n++;
    }
    sqlite3_finalize(q);
    return n;
}

/* Module matches: does an import's module string plausibly name a file? */
static bool mod_matches(const char *module, const char *cand_path) {
    char mod[512];
    snprintf(mod, sizeof mod, "%s", module);
    /* strip source extension from module */
    char *mdot = strrchr(mod, '.');
    if (mdot && mdot != mod && mdot[-1] != '/' && mdot[-1] != '.') {
        static const char *EXTS[] = { "js","jsx","ts","tsx","mjs","cjs",
                                      "c","cc","cpp","h","hh","hpp",
                                      "py","go","rs", NULL };
        for (int i = 0; EXTS[i]; i++)
            if (strcmp(mdot + 1, EXTS[i]) == 0) { *mdot = 0; break; }
    }
    /* normalize separators */
    char norm[512];
    size_t j = 0;
    for (const char *p = mod; *p && j + 1 < sizeof norm; p++) {
        if (p[0] == ':' && p[1] == ':') { norm[j++] = '/'; p++; }
        else if (*p == '.') norm[j++] = '/';
        else norm[j++] = *p;
    }
    norm[j] = 0;
    const char *m = norm;
    while (*m == '/') m++;
    if (!*m) return false;
    /* strip extension from candidate */
    char noext[1024];
    snprintf(noext, sizeof noext, "%s", cand_path);
    char *dot = strrchr(noext, '.');
    if (dot && !strchr(dot, '/')) *dot = 0;
    size_t ml = strlen(m), pl = strlen(noext);
    if (ml <= pl && strcmp(noext + pl - ml, m) == 0 &&
        (pl == ml || noext[pl - ml - 1] == '/'))
        return true;
    return false;
}

/* Cache of imports for a file — avoids re-querying per ref */
typedef struct { char name[128]; char module[256]; } ImpCache;

static int load_imports(Cg *cg, long file_id, ImpCache *out, int cap) {
    sqlite3_stmt *q = cg_prep(cg,
        "SELECT name, module FROM imports WHERE file_id=? ORDER BY id LIMIT ?");
    sqlite3_bind_int64(q, 1, file_id);
    sqlite3_bind_int(q, 2, cap);
    int n = 0;
    while (n < cap && sqlite3_step(q) == SQLITE_ROW) {
        snprintf(out[n].name, sizeof out[n].name, "%s",
                 (const char *)sqlite3_column_text(q, 0));
        snprintf(out[n].module, sizeof out[n].module, "%s",
                 (const char *)sqlite3_column_text(q, 1));
        n++;
    }
    sqlite3_finalize(q);
    return n;
}

void resolve_refs(Cg *cg) {
    sqlite3_stmt *sel = cg_prep(cg,
        "SELECT r.id, r.name, r.file_id, r.qual, f.path, f.lang "
        "FROM refs r JOIN files f ON f.id=r.file_id "
        "WHERE r.kind='call' ORDER BY r.file_id, r.id");
    sqlite3_stmt *upd = cg_prep(cg,
        "UPDATE refs SET target_id=?, verdict=?, conf=? WHERE id=?");

    long cur_fid = -1;
    ImpCache imps[64];
    int nimps = 0;
    char cur_path[512] = "";
    char cur_lang[32] = "";

    /* counters per language for meta stats */
    long internal_c = 0, external_c = 0, unknown_c = 0;

    while (sqlite3_step(sel) == SQLITE_ROW) {
        long ref_id   = sqlite3_column_int64(sel, 0);
        const char *name = (const char *)sqlite3_column_text(sel, 1);
        long file_id  = sqlite3_column_int64(sel, 2);
        const char *qual = (const char *)sqlite3_column_text(sel, 3);
        const char *path = (const char *)sqlite3_column_text(sel, 4);
        const char *lang = (const char *)sqlite3_column_text(sel, 5);
        if (!name || !path || !lang) continue;

        /* refresh import cache on file change */
        if (file_id != cur_fid) {
            cur_fid = file_id;
            nimps = load_imports(cg, file_id, imps, 64);
            snprintf(cur_path, sizeof cur_path, "%s", path);
            snprintf(cur_lang, sizeof cur_lang, "%s", lang);
        }

        const char *verdict = NULL;
        const char *conf = NULL;
        long target_id = -1;

        /* member calls with unresolvable receiver → external */
        if (qual && qual[0]) {
            verdict = "external";
            conf = "receiver";
            goto store;
        }

        /* non-resolving language → external (no findings) */
        if (!is_resolving_lang(lang)) {
            verdict = "external";
            conf = "no-resolve";
            goto store;
        }

        /* builtin check */
        if (is_builtin(cg, lang, file_id, name)) {
            verdict = "external";
            conf = "builtin";
            goto store;
        }

        /* find candidate definitions */
        {
            Cand cands[32];
            int nc = find_candidates(cg, name, cands, 32);

            if (nc == 0) {
                verdict = "unknown";
                conf = "no-def";
                goto store;
            }

            /* tiered resolution */
            int best = -1;
            const char *rule = NULL;

            /* tier 0: same file */
            for (int i = 0; i < nc && best < 0; i++)
                if (cands[i].file_id == file_id)
                    { best = i; rule = "same-file"; }

            /* tier 1: file named by this file's imports */
            for (int i = 0; i < nc && best < 0; i++)
                for (int k = 0; k < nimps && best < 0; k++)
                    if ((strcmp(imps[k].name, name) == 0 ||
                         strcmp(imps[k].name, "*") == 0) &&
                        mod_matches(imps[k].module, cands[i].path))
                        { best = i; rule = "import"; }

            /* tier 2: same directory */
            if (best < 0) {
                const char *slash = strrchr(cur_path, '/');
                size_t dirlen = slash ? (size_t)(slash - cur_path) : 0;
                for (int i = 0; i < nc && best < 0; i++) {
                    const char *cs = strrchr(cands[i].path, '/');
                    size_t cd = cs ? (size_t)(cs - cands[i].path) : 0;
                    if (cd == dirlen &&
                        (dirlen == 0 ||
                         strncmp(cands[i].path, cur_path, dirlen) == 0))
                        { best = i; rule = "same-dir"; }
                }
            }

            /* tier 3: unique definition repository-wide */
            if (best < 0 && nc == 1)
                { best = 0; rule = "unique"; }

            /* no tier fired → unresolved */
            if (best < 0) {
                verdict = "unknown";
                conf = "ambiguous";
            } else {
                verdict = "internal";
                conf = rule;
                target_id = cands[best].id;
            }
        }

    store:
        if (target_id >= 0)
            sqlite3_bind_int64(upd, 1, target_id);
        else
            sqlite3_bind_null(upd, 1);
        sqlite3_bind_text(upd, 2, verdict, -1, SQLITE_STATIC);
        sqlite3_bind_text(upd, 3, conf, -1, SQLITE_STATIC);
        sqlite3_bind_int64(upd, 4, ref_id);
        sqlite3_step(upd);
        sqlite3_reset(upd);

        /* stats */
        if (strcmp(verdict, "internal") == 0) internal_c++;
        else if (strcmp(verdict, "external") == 0) external_c++;
        else unknown_c++;
    }

    sqlite3_finalize(sel);
    sqlite3_finalize(upd);

    /* record resolution stats in meta */
    char buf[64];
    snprintf(buf, sizeof buf, "%ld", internal_c);
    cg_meta_set(cg, "resolve_internal", buf);
    snprintf(buf, sizeof buf, "%ld", external_c);
    cg_meta_set(cg, "resolve_external", buf);
    snprintf(buf, sizeof buf, "%ld", unknown_c);
    cg_meta_set(cg, "resolve_unknown", buf);
    long total = internal_c + external_c + unknown_c;
    if (total > 0) {
        snprintf(buf, sizeof buf, "%ld%%", internal_c * 100 / total);
        cg_meta_set(cg, "resolve_internal_pct", buf);
        snprintf(buf, sizeof buf, "%ld%%", external_c * 100 / total);
        cg_meta_set(cg, "resolve_external_pct", buf);
        snprintf(buf, sizeof buf, "%ld%%", unknown_c * 100 / total);
        cg_meta_set(cg, "resolve_unknown_pct", buf);
    }
}

/* ---- grounding findings ---- */

/* Near-miss: simple edit distance (Levenshtein), capped for performance */
static int edit_distance(const char *a, const char *b) {
    size_t la = strlen(a), lb = strlen(b);
    if (la > 30 || lb > 30) return 99;
    int prev[32], curr[32];
    for (size_t j = 0; j <= lb; j++) prev[j] = (int)j;
    for (size_t i = 1; i <= la; i++) {
        curr[0] = (int)i;
        for (size_t j = 1; j <= lb; j++) {
            int cost = (a[i-1] == b[j-1]) ? 0 : 1;
            int d1 = prev[j] + 1, d2 = curr[j-1] + 1, d3 = prev[j-1] + cost;
            curr[j] = d1 < d2 ? (d1 < d3 ? d1 : d3) : (d2 < d3 ? d2 : d3);
        }
        for (size_t j = 0; j <= lb; j++) prev[j] = curr[j];
    }
    return prev[lb];
}

/* Find the closest symbol name via FTS and edit distance */
static bool near_miss(Cg *cg, const char *name, char *out, size_t cap) {
    /* query symbol_fts for trigram matches */
    sqlite3_stmt *q = cg_prep(cg,
        "SELECT DISTINCT s.name FROM symbol_fts "
        "JOIN symbols s ON s.rowid=symbol_fts.rowid "
        "WHERE symbol_fts MATCH ?1 LIMIT 20");
    /* trigram query: the name itself, which FTS5 matches by trigram overlap */
    sqlite3_bind_text(q, 1, name, -1, SQLITE_STATIC);
    int best_dist = 99;
    out[0] = 0;
    while (sqlite3_step(q) == SQLITE_ROW) {
        const char *cand = (const char *)sqlite3_column_text(q, 0);
        if (!cand || strcmp(cand, name) == 0) continue;
        int d = edit_distance(name, cand);
        if (d < best_dist && d <= 2) {
            best_dist = d;
            snprintf(out, cap, "%s", cand);
        }
    }
    sqlite3_finalize(q);
    return out[0] != 0;
}

/* Calibration: does this file's accounted-ref share pass the floor?
 * A file with too many unknown refs has a parser problem, not code problems. */
bool file_calibrated(Cg *cg, long file_id, const char *lang) {
    /* count total and unknown refs for this file */
    sqlite3_stmt *q = cg_prep(cg,
        "SELECT COUNT(*), SUM(CASE WHEN verdict='unknown' THEN 1 ELSE 0 END) "
        "FROM refs WHERE file_id=? AND kind='call'");
    sqlite3_bind_int64(q, 1, file_id);
    long total = 0, unknown = 0;
    if (sqlite3_step(q) == SQLITE_ROW) {
        total = sqlite3_column_int64(q, 0);
        unknown = sqlite3_column_int64(q, 1);
    }
    sqlite3_finalize(q);
    if (total == 0) return true;  /* no refs = nothing to report */

    /* compute the language median accounted share */
    sqlite3_stmt *med = cg_prep(cg,
        "SELECT f.id, "
        "  (SELECT COUNT(*) FROM refs r2 WHERE r2.file_id=f.id AND r2.kind='call') AS t, "
        "  (SELECT SUM(CASE WHEN r3.verdict='unknown' THEN 1 ELSE 0 END) "
        "   FROM refs r3 WHERE r3.file_id=f.id AND r3.kind='call') AS u "
        "FROM files f WHERE f.lang=? AND "
        "  (SELECT COUNT(*) FROM refs r4 WHERE r4.file_id=f.id AND r4.kind='call') > 0 "
        "ORDER BY f.id");
    sqlite3_bind_text(med, 1, lang, -1, SQLITE_STATIC);
    int nfiles = 0;
    double *shares = NULL;
    int cshares = 0;
    while (sqlite3_step(med) == SQLITE_ROW) {
        long ft = sqlite3_column_int64(med, 1);
        long fu = sqlite3_column_int64(med, 2);
        if (ft == 0) continue;
        if (nfiles == cshares) {
            cshares = cshares ? cshares * 2 : 16;
            shares = xrealloc(shares, sizeof(double) * (size_t)cshares);
        }
        shares[nfiles++] = (double)(ft - fu) / (double)ft;
    }
    sqlite3_finalize(med);
    if (nfiles == 0) { free(shares); return true; }

    /* sort and pick median */
    for (int i = 0; i < nfiles - 1; i++)
        for (int j = i + 1; j < nfiles; j++)
            if (shares[j] < shares[i]) {
                double tmp = shares[i]; shares[i] = shares[j]; shares[j] = tmp;
            }
    double median = shares[nfiles / 2];
    free(shares);

    /* this file's accounted share */
    double file_share = (double)(total - unknown) / (double)total;

    /* calibration floor: 50% below the median, or absolute floor of 30% */
    double floor_val = median * 0.5;
    if (floor_val < 0.30) floor_val = 0.30;

    return file_share >= floor_val;
}

int ground_findings(Cg *cg, const char *path, GroundFinding **out) {
    int n = 0, cap = 0;
    *out = NULL;

    /* determine file_id and lang */
    sqlite3_stmt *fq = cg_prep(cg,
        "SELECT id, lang FROM files WHERE path=?");
    sqlite3_bind_text(fq, 1, path, -1, SQLITE_STATIC);
    long file_id = -1;
    char lang[32] = "";
    if (sqlite3_step(fq) == SQLITE_ROW) {
        file_id = sqlite3_column_int64(fq, 0);
        const char *l = (const char *)sqlite3_column_text(fq, 1);
        if (l) snprintf(lang, sizeof lang, "%s", l);
    }
    sqlite3_finalize(fq);
    if (file_id < 0) return 0;

    /* non-resolving language → no findings */
    if (!is_resolving_lang(lang)) return 0;

    /* calibration check */
    if (!file_calibrated(cg, file_id, lang)) return 0;

    /* ungrounded calls: verdict=unknown in resolving languages */
    sqlite3_stmt *q = cg_prep(cg,
        "SELECT r.name, r.line FROM refs r "
        "WHERE r.file_id=? AND r.kind='call' AND r.verdict='unknown' "
        "ORDER BY r.line");
    sqlite3_bind_int64(q, 1, file_id);
    while (sqlite3_step(q) == SQLITE_ROW) {
        const char *name = (const char *)sqlite3_column_text(q, 0);
        int line = sqlite3_column_int(q, 1);
        if (!name) continue;
        if (n == cap) {
            cap = cap ? cap * 2 : 16;
            *out = xrealloc(*out, sizeof(GroundFinding) * (size_t)cap);
        }
        GroundFinding *f = &(*out)[n++];
        snprintf(f->path, sizeof f->path, "%s", path);
        f->line = line;
        snprintf(f->name, sizeof f->name, "%s", name);
        snprintf(f->kind, sizeof f->kind, "call");
        f->near[0] = 0;
        near_miss(cg, name, f->near, sizeof f->near);
        if (f->near[0])
            snprintf(f->detail, sizeof f->detail,
                     "%s() is not defined — did you mean %s?", name, f->near);
        else
            snprintf(f->detail, sizeof f->detail,
                     "%s() is not defined and nothing external accounts for it",
                     name);
    }
    sqlite3_finalize(q);

    /* ungrounded imports: origin=unknown */
    q = cg_prep(cg,
        "SELECT i.module, i.line FROM imports i "
        "WHERE i.file_id=? AND i.origin='unknown' ORDER BY i.line");
    sqlite3_bind_int64(q, 1, file_id);
    while (sqlite3_step(q) == SQLITE_ROW) {
        const char *module = (const char *)sqlite3_column_text(q, 0);
        int line = sqlite3_column_int(q, 1);
        if (!module) continue;
        if (n == cap) {
            cap = cap ? cap * 2 : 16;
            *out = xrealloc(*out, sizeof(GroundFinding) * (size_t)cap);
        }
        GroundFinding *f = &(*out)[n++];
        snprintf(f->path, sizeof f->path, "%s", path);
        f->line = line;
        snprintf(f->name, sizeof f->name, "%s", module);
        snprintf(f->kind, sizeof f->kind, "import");
        f->near[0] = 0;
        snprintf(f->detail, sizeof f->detail,
                 "import '%s' is not a repository path and not in any manifest",
                 module);
    }
    sqlite3_finalize(q);

    return n;
}

void ground_findings_free(GroundFinding *v, int n) {
    (void)n;
    free(v);
}

/* ---- contract findings ---- */

/* Callable kinds — kinds that can legitimately be called with () */
static bool kind_callable(const char *kind) {
    return kind && (strcmp(kind, "function") == 0 ||
                    strcmp(kind, "method") == 0 ||
                    strcmp(kind, "class") == 0 ||
                    strcmp(kind, "macro") == 0);
}

int contract_findings(Cg *cg, const char *path, ContractFinding **out) {
    int n = 0, cap = 0;
    *out = NULL;

    sqlite3_stmt *fq = cg_prep(cg, "SELECT id FROM files WHERE path=?");
    sqlite3_bind_text(fq, 1, path, -1, SQLITE_STATIC);
    long file_id = -1;
    if (sqlite3_step(fq) == SQLITE_ROW)
        file_id = sqlite3_column_int64(fq, 0);
    sqlite3_finalize(fq);
    if (file_id < 0) return 0;

    /* kind mismatch: a call targeting a non-callable symbol */
    sqlite3_stmt *q = cg_prep(cg,
        "SELECT r.name, r.line, s.kind FROM refs r "
        "JOIN symbols s ON s.id=r.target_id "
        "WHERE r.file_id=? AND r.kind='call' AND r.target_id IS NOT NULL "
        "ORDER BY r.line");
    sqlite3_bind_int64(q, 1, file_id);
    while (sqlite3_step(q) == SQLITE_ROW) {
        const char *name = (const char *)sqlite3_column_text(q, 0);
        int line = sqlite3_column_int(q, 1);
        const char *tkind = (const char *)sqlite3_column_text(q, 2);
        if (!name || !tkind) continue;
        if (!kind_callable(tkind)) {
            if (n == cap) {
                cap = cap ? cap * 2 : 8;
                *out = xrealloc(*out, sizeof(ContractFinding) * (size_t)cap);
            }
            ContractFinding *f = &(*out)[n++];
            snprintf(f->path, sizeof f->path, "%s", path);
            f->line = line;
            snprintf(f->name, sizeof f->name, "%s", name);
            snprintf(f->kind, sizeof f->kind, "kind-mismatch");
            snprintf(f->detail, sizeof f->detail,
                     "%s() calls a %s, not a function", name, tkind);
        }
    }
    sqlite3_finalize(q);

    /* dead route handlers: handler string that names no symbol */
    q = cg_prep(cg,
        "SELECT r.handler, r.line FROM routes r "
        "WHERE r.file_id=? AND r.handler IS NOT NULL AND r.handler<>'' "
        "AND NOT EXISTS (SELECT 1 FROM symbols s WHERE s.name=r.handler) "
        "ORDER BY r.line");
    sqlite3_bind_int64(q, 1, file_id);
    while (sqlite3_step(q) == SQLITE_ROW) {
        const char *handler = (const char *)sqlite3_column_text(q, 0);
        int line = sqlite3_column_int(q, 1);
        if (!handler) continue;
        if (n == cap) {
            cap = cap ? cap * 2 : 8;
            *out = xrealloc(*out, sizeof(ContractFinding) * (size_t)cap);
        }
        ContractFinding *f = &(*out)[n++];
        snprintf(f->path, sizeof f->path, "%s", path);
        f->line = line;
        snprintf(f->name, sizeof f->name, "%s", handler);
        snprintf(f->kind, sizeof f->kind, "dead-handler");
        snprintf(f->detail, sizeof f->detail,
                 "route handler '%s' resolves to no symbol", handler);
    }
    sqlite3_finalize(q);

    return n;
}

void contract_findings_free(ContractFinding *v, int n) {
    (void)n;
    free(v);
}

/* ---- hygiene findings ---- */

/* Entry-point detection: symbols that should never be reported as unused. */
bool is_entrypoint(Cg *cg, long sym_id, const char *name, const char *kind,
                   const char *path) {
    (void)sym_id;
    /* main is always an entry point */
    if (strcmp(name, "main") == 0) return true;
    /* test files — everything in them is an entry point */
    if (graph_path_is_test(path)) return true;
    /* exported symbols (name starts with uppercase in Go) */
    if (name[0] >= 'A' && name[0] <= 'Z') {
        const char *lang = lang_for_path(path);
        if (lang && strcmp(lang, "go") == 0) return true;
    }
    /* route handlers */
    sqlite3_stmt *q = cg_prep(cg,
        "SELECT 1 FROM routes WHERE handler=? LIMIT 1");
    sqlite3_bind_text(q, 1, name, -1, SQLITE_STATIC);
    bool is_handler = sqlite3_step(q) == SQLITE_ROW;
    sqlite3_finalize(q);
    if (is_handler) return true;
    /* dispatch table: name appears as a string literal in a strcmp call.
     * This handles main.c's command dispatch pattern. */
    sqlite3_stmt *dq = cg_prep(cg,
        "SELECT 1 FROM refs WHERE name='strcmp' AND kind='call' "
        "AND file_id IN (SELECT id FROM files WHERE path LIKE '%%main.%%') "
        "LIMIT 1");
    bool has_dispatch = sqlite3_step(dq) == SQLITE_ROW;
    sqlite3_finalize(dq);
    if (has_dispatch) {
        /* check if the name appears as a string in any file with strcmp */
        sqlite3_stmt *sq = cg_prep(cg,
            "SELECT 1 FROM body_fts WHERE body MATCH ? LIMIT 1");
        char quoted[256];
        snprintf(quoted, sizeof quoted, "\"%s\"", name);
        sqlite3_bind_text(sq, 1, quoted, -1, SQLITE_STATIC);
        bool in_body = sqlite3_step(sq) == SQLITE_ROW;
        sqlite3_finalize(sq);
        if (in_body) return true;
    }
    /* kind-based: classes/types/interfaces are used structurally, not called */
    if (kind && (strcmp(kind, "class") == 0 || strcmp(kind, "type") == 0 ||
                 strcmp(kind, "interface") == 0 || strcmp(kind, "struct") == 0 ||
                 strcmp(kind, "enum") == 0 || strcmp(kind, "typedef") == 0 ||
                 strcmp(kind, "macro") == 0 || strcmp(kind, "namespace") == 0 ||
                 strcmp(kind, "module") == 0))
        return true;
    return false;
}

/* Unused symbols in a single file */
static int hygiene_file(Cg *cg, const char *path, long file_id,
                        HygieneFinding **out, int *n, int *cap) {
    /* unused imports: imported name with no reference in its file */
    sqlite3_stmt *q = cg_prep(cg,
        "SELECT i.name, i.module, i.line FROM imports i "
        "WHERE i.file_id=? AND i.name<>'*' "
        "AND NOT EXISTS (SELECT 1 FROM refs r WHERE r.file_id=? AND r.name=i.name) "
        "ORDER BY i.line");
    sqlite3_bind_int64(q, 1, file_id);
    sqlite3_bind_int64(q, 2, file_id);
    while (sqlite3_step(q) == SQLITE_ROW) {
        const char *name = (const char *)sqlite3_column_text(q, 0);
        const char *mod = (const char *)sqlite3_column_text(q, 1);
        int line = sqlite3_column_int(q, 2);
        if (!name) continue;
        if (*n == *cap) {
            *cap = *cap ? *cap * 2 : 16;
            *out = xrealloc(*out, sizeof(HygieneFinding) * (size_t)*cap);
        }
        HygieneFinding *f = &(*out)[(*n)++];
        snprintf(f->path, sizeof f->path, "%s", path);
        f->line = line;
        snprintf(f->name, sizeof f->name, "%s", name);
        snprintf(f->kind, sizeof f->kind, "unused-import");
        snprintf(f->detail, sizeof f->detail,
                 "'%s' imported from '%s' is not referenced in this file",
                 name, mod ? mod : "?");
    }
    sqlite3_finalize(q);

    /* unused symbols: no inbound reference (target_id or name match) */
    q = cg_prep(cg,
        "SELECT s.id, s.name, s.kind, s.line FROM symbols s "
        "WHERE s.file_id=? AND s.kind IN ('function','method') "
        "AND NOT EXISTS (SELECT 1 FROM refs r WHERE r.target_id=s.id) "
        "AND NOT EXISTS (SELECT 1 FROM refs r2 WHERE r2.name=s.name "
        "  AND r2.target_id IS NULL AND r2.file_id<>?) "
        "ORDER BY s.line");
    sqlite3_bind_int64(q, 1, file_id);
    sqlite3_bind_int64(q, 2, file_id);
    while (sqlite3_step(q) == SQLITE_ROW) {
        long sid = sqlite3_column_int64(q, 0);
        const char *name = (const char *)sqlite3_column_text(q, 1);
        const char *kind = (const char *)sqlite3_column_text(q, 2);
        int line = sqlite3_column_int(q, 3);
        if (!name || !kind) continue;
        if (is_entrypoint(cg, sid, name, kind, path)) continue;
        if (*n == *cap) {
            *cap = *cap ? *cap * 2 : 16;
            *out = xrealloc(*out, sizeof(HygieneFinding) * (size_t)*cap);
        }
        HygieneFinding *f = &(*out)[(*n)++];
        snprintf(f->path, sizeof f->path, "%s", path);
        f->line = line;
        snprintf(f->name, sizeof f->name, "%s", name);
        snprintf(f->kind, sizeof f->kind, "unused-sym");
        snprintf(f->detail, sizeof f->detail,
                 "%s '%s' has no inbound reference", kind, name);
    }
    sqlite3_finalize(q);

    return *n;
}

/* Delta hygiene: only for a single file (the changed file) */
int hygiene_findings(Cg *cg, const char *path, HygieneFinding **out) {
    *out = NULL;
    int n = 0, cap = 0;
    sqlite3_stmt *fq = cg_prep(cg, "SELECT id FROM files WHERE path=?");
    sqlite3_bind_text(fq, 1, path, -1, SQLITE_STATIC);
    long file_id = -1;
    if (sqlite3_step(fq) == SQLITE_ROW)
        file_id = sqlite3_column_int64(fq, 0);
    sqlite3_finalize(fq);
    if (file_id < 0) return 0;
    hygiene_file(cg, path, file_id, out, &n, &cap);
    return n;
}

/* Full-repo hygiene sweep */
int hygiene_findings_all(Cg *cg, HygieneFinding **out, int limit) {
    *out = NULL;
    int n = 0, cap = 0;
    sqlite3_stmt *q = cg_prep(cg, "SELECT id, path FROM files ORDER BY path");
    while (sqlite3_step(q) == SQLITE_ROW && n < limit) {
        long fid = sqlite3_column_int64(q, 0);
        const char *path = (const char *)sqlite3_column_text(q, 1);
        if (!path) continue;
        hygiene_file(cg, path, fid, out, &n, &cap);
    }
    sqlite3_finalize(q);
    return n;
}

void hygiene_findings_free(HygieneFinding *v, int n) {
    (void)n;
    free(v);
}
