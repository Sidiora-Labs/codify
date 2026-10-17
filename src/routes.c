/*
 * Framework-aware route detection. Regex patterns run against the ORIGINAL
 * line (strings intact), gated by language; plus file-path conventions for
 * file-based routers (Next.js, SvelteKit).
 *
 * Frameworks: Express, Koa, Fastify, Hapi, NestJS, Next.js, SvelteKit,
 * Flask, FastAPI, Django, Rails, Sinatra, Laravel, Spring, ASP.NET,
 * Gin/Echo (Go), Fiber/Chi (Go), Actix, Axum.
 */
#include "cg.h"
#include "index_health.h"
#include <regex.h>
#include <ctype.h>

typedef struct {
    const char *framework;
    const char *langs;        /* comma list of spec names this applies to */
    const char *file_hint;    /* substring path must contain, or NULL */
    const char *pat;          /* ERE against original line */
    int g_method;             /* capture group for method, 0 = none */
    int g_pattern;            /* capture group for url pattern */
    int g_handler;            /* capture group for handler, 0 = none */
    const char *fixed_method; /* used when g_method == 0 */
    regex_t re;
} RoutePat;

static RoutePat RP[] = {
    { "express", "js", NULL,
      "(app|router|server)\\.(get|post|put|delete|patch|all|options|head)[ \t]*\\("
      "[ \t]*['\"`]([^'\"`]+)['\"`]([ \t]*,[ \t]*([A-Za-z_][A-Za-z0-9_.]*))?",
      2, 3, 5, NULL, {0} },
    { "react-router", "js", NULL,
      "<Route[ \t]+path=[{]?[ \t]*['\"]([^'\"]+)['\"][ \t]*[}]?",
      0, 1, 0, "PAGE", {0} },
    { "react-router", "js", NULL,
      "(^|[^A-Za-z0-9_$])path:[ \t]*['\"]([^'\"]+)['\"][ \t]*,[ \t]*(element|Component|loader|action):",
      0, 2, 0, "PAGE", {0} },
    { "vue-router", "js", NULL,
      "(^|[^A-Za-z0-9_$])path:[ \t]*['\"]([^'\"]+)['\"][ \t]*,[ \t]*component:",
      0, 2, 0, "PAGE", {0} },
    { "react-navigation", "js", NULL,
      "<Link[ \t]+to=['\"](/[^'\"]*)['\"]",
      0, 1, 0, "NAV", {0} },
    { "page-navigation", "js", NULL,
      "<Link[ \t]+href=['\"](/[^'\"]*)['\"]",
      0, 1, 0, "NAV", {0} },
    { "vue-navigation", "js", NULL,
      "<RouterLink[ \t]+to=['\"](/[^'\"]*)['\"]",
      0, 1, 0, "NAV", {0} },
    { "koa-router", "js", NULL,
      "(koaRouter|kr)\\.(get|post|put|delete|patch)[ \t]*\\([ \t]*['\"`]([^'\"`]+)",
      2, 3, 0, NULL, {0} },
    { "fastify", "js", NULL,
      "fastify\\.(get|post|put|delete|patch)[ \t]*\\([ \t]*['\"`]([^'\"`]+)",
      1, 2, 0, NULL, {0} },
    { "hapi", "js", NULL,
      "(^|[^A-Za-z0-9_$])path:[ \t]*['\"`](/[^'\"`]*)['\"`]",
      0, 2, 0, "*", {0} },
    { "nestjs", "js", NULL,
      "@(Get|Post|Put|Delete|Patch|Head|Options)\\([ \t]*['\"`]?([^'\"`)]*)",
      1, 2, 0, NULL, {0} },
    { "flask", "python", NULL,
      "@[A-Za-z_][A-Za-z0-9_]*\\.route\\([ \t]*['\"]([^'\"]+)",
      0, 1, 0, "*", {0} },
    { "fastapi", "python", NULL,
      "@[A-Za-z_][A-Za-z0-9_]*\\.(get|post|put|delete|patch)\\([ \t]*['\"](/[^'\"]*)",
      1, 2, 0, NULL, {0} },
    /* Undecorated calls share their shape with dict.get(key, default), so
     * the receiver must be named as an app/router and the path rooted. */
    { "fastapi", "python", NULL,
      "(^|[^A-Za-z0-9_])(app|router|api|[A-Za-z_][A-Za-z0-9_]*_(app|router|api))\\.(get|post|put|delete|patch)\\([ \t]*['\"](/[^'\"]*)['\"][ \t]*,[ \t]*([A-Za-z_][A-Za-z0-9_]*)",
      4, 5, 6, NULL, {0} },
    { "django", "python", "urls",
      "(path|re_path|url)\\([ \t]*r?['\"]([^'\"]*)['\"][ \t]*,[ \t]*([A-Za-z_][A-Za-z0-9_.]*)?",
      0, 2, 3, "*", {0} },
    { "rails", "ruby", "routes",
      "^[ \t]*(get|post|put|patch|delete|resources|resource|root)[ \t]+['\":]([A-Za-z0-9_/:.()-]*)",
      1, 2, 0, NULL, {0} },
    { "sinatra", "ruby", NULL,
      "^[ \t]*(get|post|put|patch|delete)[ \t]+['\"]([^'\"]+)['\"][ \t]+do",
      1, 2, 0, NULL, {0} },
    { "laravel", "php", NULL,
      "Route::(get|post|put|patch|delete|any|resource|apiResource)\\([ \t]*['\"]([^'\"]+)",
      1, 2, 0, NULL, {0} },
    { "spring", "java", NULL,
      "@(Get|Post|Put|Delete|Patch|Request)Mapping[ \t]*\\([ \t]*(value[ \t]*=[ \t]*)?[{ \t]*\"([^\"]*)",
      1, 3, 0, NULL, {0} },
    { "aspnet-attr", "csharp", NULL,
      "\\[Http(Get|Post|Put|Delete|Patch)\\([ \t]*\"([^\"]*)",
      1, 2, 0, NULL, {0} },
    { "aspnet-minimal", "csharp", NULL,
      "\\.Map(Get|Post|Put|Delete|Patch)\\([ \t]*\"([^\"]*)\"[ \t]*,[ \t]*([A-Za-z_][A-Za-z0-9_.]*)?",
      1, 2, 3, NULL, {0} },
    { "gin/echo", "go", NULL,
      "[A-Za-z_][A-Za-z0-9_]*\\.(GET|POST|PUT|DELETE|PATCH|Any)\\([ \t]*\"([^\"]*)\"[ \t]*,[ \t]*([A-Za-z_][A-Za-z0-9_.]*)?",
      1, 2, 3, NULL, {0} },
    { "fiber/chi", "go", NULL,
      "[A-Za-z_][A-Za-z0-9_]*\\.(Get|Post|Put|Delete|Patch)\\([ \t]*\"([^\"]*)\"[ \t]*,[ \t]*([A-Za-z_][A-Za-z0-9_.]*)?",
      1, 2, 3, NULL, {0} },
    { "actix", "rust", NULL,
      "\\.route\\([ \t]*\"([^\"]*)\"[ \t]*,[ \t]*web::(get|post|put|delete|patch)",
      2, 1, 0, NULL, {0} },
    { "axum", "rust", NULL,
      "\\.route\\([ \t]*\"([^\"]*)\"[ \t]*,[ \t]*(get|post|put|delete|patch)[ \t]*\\([ \t]*([A-Za-z_][A-Za-z0-9_:]*)?",
      2, 1, 3, NULL, {0} },
    { "actix-macro", "rust", NULL,
      "#\\[(get|post|put|delete|patch)\\([ \t]*\"([^\"]*)",
      1, 2, 0, NULL, {0} },
    { "vapor", "swift", NULL,
      "[A-Za-z_][A-Za-z0-9_]*\\.(get|post|put|patch|delete)\\([ \t]*\"([^\"]+)\"",
      1, 2, 0, NULL, {0} },
    { "django", "python", "urls",
      "(path|re_path)\\([ \t]*['\"]([^'\"]+)['\"][ \t]*,[ \t]*([A-Za-z_][A-Za-z0-9_.]*)",
      0, 2, 3, "PAGE", {0} },
    { "express-mount", "js", NULL,
      "(app|router)\\.use\\([ \t]*['\"]([^'\"]+)['\"][ \t]*,[ \t]*([A-Za-z_][A-Za-z0-9_]*)",
      0, 2, 3, "MOUNT", {0} },
    { "fastapi-mount", "python", NULL,
      "include_router\\([ \t]*([A-Za-z_][A-Za-z0-9_]*)",
      0, 1, 0, "MOUNT", {0} },
};
#define NRP ((int)(sizeof RP / sizeof RP[0]))

void routes_global_init(void) {
    static bool done = false;
    if (done) return;
    done = true;
    for (int i = 0; i < NRP; i++) {
        int rc = regcomp(&RP[i].re, RP[i].pat, REG_EXTENDED);
        if (rc != 0) {
            char eb[256];
            regerror(rc, &RP[i].re, eb, sizeof eb);
            fprintf(stderr, "cg: internal route regex error (%s): %s\n",
                    RP[i].framework, eb);
            exit(2);
        }
    }
}

static bool lang_in(const char *langs, const char *lang) {
    const char *p = strstr(langs, lang);
    if (!p) return false;
    size_t n = strlen(lang);
    return (p == langs || p[-1] == ',') && (p[n] == 0 || p[n] == ',');
}

static void upcase(char *s) {
    for (; *s; s++) if (*s >= 'a' && *s <= 'z') *s -= 32;
}

/* A registration token inside a comment or string is prose, not wiring.
 * The route path itself is expected to be a literal after this position. */
static bool code_at(const char *s,size_t pos,const char *lang) {
    char quote=0;bool escape=false;
    for(size_t i=0;i<pos;i++) {
        char c=s[i],n=s[i+1];
        if(quote) {
            if(escape){escape=false;continue;}
            if(c=='\\'){escape=true;continue;}
            if(c==quote)quote=0;
        } else {
            if(c=='\''||c=='\"'||c=='`')quote=c;
            else if(c=='/'&&n=='/')return false;
            else if(c=='#'&&(strcmp(lang,"python")==0||strcmp(lang,"ruby")==0))return false;
        }
    }
    return !quote;
}

/* One parse worker owns one current file. Keep lexical state across lines so
 * a route-looking token in a multiline comment or literal cannot register.
 * The scrubbed line keeps literal URL bytes and source offsets intact. */
typedef struct {
    const ParseResult *owner;
    char path[4096];
    int last_line;
    bool block, triple;
    bool flask_hint, fastapi_hint;
    char quote;
    char pending[8192];
    int pending_line;
    size_t pending_head,pending_open;
    bool pending_active;
} RouteLex;
static _Thread_local RouteLex lex;

static void scrub_route_line(const char *lang,const char *path,int line,
                             const ParseResult *pr,const char *raw,char *out) {
    if(lex.owner!=pr || line<=lex.last_line || strcmp(lex.path,path)!=0) {
        memset(&lex,0,sizeof lex);lex.owner=pr;
        snprintf(lex.path,sizeof lex.path,"%s",path);
    }
    lex.last_line=line;
    size_t n=strlen(raw);
    memcpy(out,raw,n+1);
    bool python=strcmp(lang,"python")==0||strcmp(lang,"ruby")==0;
    bool escape=false;
    bool continuation=lex.quote!=0;
    for(size_t i=0;i<n;i++) {
        char c=raw[i],a=i+1<n?raw[i+1]:0,b=i+2<n?raw[i+2]:0;
        if(lex.block) {
            out[i]=' ';
            if(c=='*'&&a=='/'){out[++i]=' ';lex.block=false;}
            continue;
        }
        if(lex.quote) {
            /* Contents of a literal remain for route path capture; a route
             * token inside the literal is rejected by code_at or by the
             * state carried into the following line. */
            if(continuation)out[i]=' ';
            if(escape){escape=false;continue;}
            if(c=='\\'){escape=true;continue;}
            if(lex.triple) {
                if(c==lex.quote&&a==c&&b==c){
                    if(continuation){out[i+1]=' ';out[i+2]=' ';}
                    i+=2;lex.quote=0;lex.triple=false;continuation=false;
                }
            } else if(c==lex.quote){lex.quote=0;continuation=false;}
            continue;
        }
        if(c=='/'&&a=='*'){
            out[i]=' ';out[i+1]=' ';i++;lex.block=true;continue;
        }
        if(c=='/'&&a=='/'){
            memset(out+i,' ',n-i);break;
        }
        if(python&&c=='#'){
            memset(out+i,' ',n-i);break;
        }
        /* A Rust lifetime such as &'static is not a character literal. */
        if(c=='\''&&strcmp(lang,"rust")==0 &&
           !(a=='\\' ? (i+3<n&&raw[i+3]=='\'') : (i+2<n&&raw[i+2]=='\'')))
            continue;
        if(c=='\''||c=='\"'||c=='`') {
            lex.quote=c;
            if(python&&a==c&&b==c){lex.triple=true;i+=2;}
        }
    }
}

static const char *route_opener(const char *s,const char *lang) {
    const char *keys[]={".get(",".post(",".put(",".patch(",".delete(",
        ".route(",".MapGet(",".MapPost(","Route::", "path(",
        ".GET(",".POST(",".use(","Mapping(","HttpGet("};
    for(size_t i=0;i<sizeof keys/sizeof keys[0];i++) {
        const char *p=strstr(s,keys[i]);
        if(p&&code_at(s,(size_t)(p-s),lang))return p;
    }
    return NULL;
}

static bool route_statement_complete(const char *s,size_t start) {
    char quote=0;bool escape=false,opened=false;
    int depth=0;
    for(size_t i=start;s[i];i++) {
        char c=s[i];
        if(quote){
            if(escape){escape=false;continue;}
            if(c=='\\'){escape=true;continue;}
            if(c==quote)quote=0;
            continue;
        }
        if(c=='\''||c=='\"'||c=='`'){quote=c;continue;}
        if(c=='('){opened=true;depth++;}
        else if(c==')'&&opened){depth--;if(depth==0)return true;}
    }
    return false;
}

static void route_limit(ParseResult *pr,int line) {
    parse_diagnostic_add(pr,"route_statement_limit",line);
}

void routes_scan_line(const char *lang, const char *path, int lineno,
                      const char *orig, ParseResult *pr) {
    const char *route_lang=(strcmp(lang,"javascript")==0 ||
        strcmp(lang,"typescript")==0 || strcmp(lang,"tsx")==0 ||
        strcmp(lang,"jsx")==0)?"js":lang;
    size_t length=strlen(orig);
    if(length>1048576)return;
    char *scan=xmalloc(length+1);
    scrub_route_line(lang,path,lineno,pr,orig,scan);
    const char *trim=scan;while (*trim==' '||*trim=='\t')trim++;
    if(strcmp(route_lang,"python")==0) {
        if(strncmp(trim,"from flask import ",18)==0 ||
           strncmp(trim,"import flask",12)==0)lex.flask_hint=true;
        if(strncmp(trim,"from fastapi import ",20)==0 ||
           strncmp(trim,"import fastapi",14)==0)lex.fastapi_hint=true;
    }
    if (strncmp(trim,"//",2)==0 || strncmp(trim,"# ",2)==0 ||
        strncmp(trim,"* ",2)==0) {free(scan);return;}
    /* File routers encode path in the directory and method in the exported
     * function. A wildcard route would erase the method distinction. */
    const char *server=strstr(path,"/+server.");
    const char *next=strstr(path,"/route.");
    if ((server&&strstr(path,"src/routes/")) || (next&&strstr(path,"app/"))) {
        static const char *verbs[]={"GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"};
        if(strstr(trim,"export "))for(size_t j=0;j<sizeof verbs/sizeof verbs[0];j++) {
            char needle[32];snprintf(needle,sizeof needle,"function %s",verbs[j]);
            const char *found=strstr(trim,needle);
            if(!found){snprintf(needle,sizeof needle,"const %s",verbs[j]);found=strstr(trim,needle);}
            if(!found||!code_at(orig,(size_t)(found-scan),lang))continue;
            const char *base=server?strstr(path,"src/routes/")+11:strstr(path,"app/")+4;
            char url[512];snprintf(url,sizeof url,"/%.*s",(int)((server?server:next)-base),base);
            if(!url[1])strcpy(url,"/");
            route_add(pr,server?"sveltekit":"nextjs-app",verbs[j],url,verbs[j],lineno);
            free(scan);return;
        }
    }
    bool pending=lex.pending_active;
    if(pending){
        size_t used=strlen(lex.pending);
        if(used+length+2<sizeof lex.pending){
            lex.pending[used++]=' ';
            memcpy(lex.pending+used,scan,length+1);
        } else {
            route_limit(pr,lex.pending_line);
            lex.pending_active=false;pending=false;
        }
    }
    for(int attempt=0;attempt<(pending?2:1);attempt++) {
    const char *source=pending&&attempt==0?lex.pending:scan;
    int site_line=pending&&attempt==0?lex.pending_line:lineno;
    if(pending&&attempt==0&&
       !route_statement_complete(source,lex.pending_open))continue;
    for (int i = 0; i < NRP; i++) {
        RoutePat *r = &RP[i];
        if (!lang_in(r->langs, route_lang)) continue;
        if (r->file_hint && !strstr(path, r->file_hint)) continue;
        regmatch_t m[8];
        if (regexec(&r->re, source, 8, m, 0) != 0) continue;
        if(pending&&attempt==0&&(size_t)m[0].rm_so>=lex.pending_head)continue;
        if (!code_at(source,(size_t)m[0].rm_so,lang)) continue;

        char method[32] = "*", pattern[512] = "", handler[128] = "";
        if (r->g_method && m[r->g_method].rm_so >= 0) {
            size_t n = (size_t)(m[r->g_method].rm_eo - m[r->g_method].rm_so);
            if (n >= sizeof method) n = sizeof method - 1;
            memcpy(method, source + m[r->g_method].rm_so, n);
            method[n] = 0;
            upcase(method);
        } else if (r->fixed_method) {
            snprintf(method, sizeof method, "%s", r->fixed_method);
        }
        if(strcmp(r->framework,"flask")==0) {
            const char *ms=strstr(source,"methods=");
            if(!ms)snprintf(method,sizeof method,"GET");
            else {
                const char *verbs[]={"GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"};
                int found=0;
                for(size_t j=0;j<sizeof verbs/sizeof verbs[0];j++)
                    if(strstr(ms,verbs[j])){snprintf(method,sizeof method,"%s",verbs[j]);found++;}
                if(found!=1)snprintf(method,sizeof method,"*");
            }
        }
        if(strcmp(r->framework,"laravel")==0 &&
           (strcmp(method,"RESOURCE")==0||strcmp(method,"APIRESOURCE")==0||
            strcmp(method,"ANY")==0))snprintf(method,sizeof method,"*");
        if (m[r->g_pattern].rm_so >= 0) {
            size_t n = (size_t)(m[r->g_pattern].rm_eo - m[r->g_pattern].rm_so);
            if (n >= sizeof pattern) n = sizeof pattern - 1;
            memcpy(pattern, source + m[r->g_pattern].rm_so, n);
            pattern[n] = 0;
        }
        /* A URL path never carries raw whitespace; '/bin/sh -c ...' is argv. */
        if(strcmp(method,"MOUNT")!=0 && strpbrk(pattern," \t"))continue;
        if(pattern[0] && pattern[0]!='/' && strcmp(method,"MOUNT")!=0) {
            size_t pn=strlen(pattern);
            if(pn+1<sizeof pattern) {
                memmove(pattern+1,pattern,pn+1);
                pattern[0]='/';
            }
        }
        if(strstr(pattern,"${")||strstr(pattern,"#{"))
            snprintf(method,sizeof method,"DYNAMIC");
        if (r->g_handler && m[r->g_handler].rm_so >= 0 &&
            m[r->g_handler].rm_eo > m[r->g_handler].rm_so) {
            size_t n = (size_t)(m[r->g_handler].rm_eo - m[r->g_handler].rm_so);
            if (n >= sizeof handler) n = sizeof handler - 1;
            memcpy(handler, source + m[r->g_handler].rm_so, n);
            handler[n] = 0;
        }
        if(strcmp(r->framework,"react-router")==0) {
            const char *h=strstr(source,"element={<");
            if(h)h+=10;
            else if((h=strstr(source,"element:"))!=NULL){
                h+=8;while(*h==' '||*h=='\t')h++;
                if(*h=='<')h++;else h=NULL;
            }
            if(h){size_t n=0;
                while((isalnum((unsigned char)h[n])||h[n]=='_')&&n<sizeof handler-1)n++;
                if(n){memcpy(handler,h,n);handler[n]=0;}}
        } else if(strcmp(r->framework,"vue-router")==0) {
            const char *h=strstr(source,"component:");
            if(h){h+=10;while(*h==' '||*h=='\t')h++;
                size_t n=0;while((isalnum((unsigned char)h[n])||h[n]=='_')&&n<sizeof handler-1)n++;
                if(n){memcpy(handler,h,n);handler[n]=0;}}
        } else if(strcmp(r->framework,"rails")==0) {
            const char *h=strstr(source,"to:");
            if(h){h+=3;while(*h==' '||*h=='\t')h++;
                if(*h=='\''||*h=='\"'){
                    char quote=*h++;size_t n=0;
                    while(h[n]&&h[n]!=quote&&n<sizeof handler-1)n++;
                    if(h[n]==quote){memcpy(handler,h,n);handler[n]=0;}}}
        } else if(strcmp(r->framework,"laravel")==0) {
            const char *owner=strstr(source,"::class");
            if(owner){const char *start=owner;
                while(start>source&&(isalnum((unsigned char)start[-1])||start[-1]=='_'))start--;
                const char *h=strchr(owner,',');
                if(h){h++;while(*h==' '||*h=='\t')h++;
                    if(*h=='\''||*h=='\"'){
                        char quote=*h++;const char *end=strchr(h,quote);
                        if(end){size_t on=(size_t)(owner-start),mn=(size_t)(end-h);
                            if(on+mn+2<sizeof handler){memcpy(handler,start,on);handler[on]='#';
                                memcpy(handler+on+1,h,mn);handler[on+mn+1]=0;}}}}
            }
        } else if(strcmp(r->framework,"vapor")==0) {
            const char *h=strstr(source,"use:");
            if(h){h+=4;while(*h==' '||*h=='\t')h++;
                size_t n=0;while((isalnum((unsigned char)h[n])||h[n]=='_')&&n<sizeof handler-1)n++;
                if(n){memcpy(handler,h,n);handler[n]=0;}}
        }
        const char *framework=r->framework;
        if(strcmp(framework,"fastapi")==0 && lex.flask_hint &&
           !lex.fastapi_hint)framework="flask";
        route_add(pr, framework, method, pattern,
                  handler[0] ? handler : NULL, site_line);
        lex.pending_active=false;
        free(scan);return;   /* first matching framework wins for a line */
    }
    }
    if(pending&&route_statement_complete(lex.pending,lex.pending_open))
        lex.pending_active=false;
    const char *opener=!lex.pending_active?route_opener(scan,lang):NULL;
    if(opener&&!route_statement_complete(scan,(size_t)(opener-scan))&&
       length<sizeof lex.pending-1){
        memcpy(lex.pending,scan,length+1);
        lex.pending_line=lineno;
        lex.pending_head=length;
        lex.pending_open=(size_t)(opener-scan);
        lex.pending_active=true;
    } else if(opener&&length>=sizeof lex.pending-1) {
        route_limit(pr,lineno);
    }
    free(scan);
}

/* File-based routers: derive the URL from the file path itself. */
void routes_scan_file(const char *path, ParseResult *pr) {
    const char *p;
    if ((p = strstr(path, "pages/api/")) != NULL) {
        char url[512];
        snprintf(url, sizeof url, "/api/%s", p + strlen("pages/api/"));
        char *dot = strrchr(url, '.');
        if (dot) *dot = 0;
        size_t n = strlen(url);
        if (n > 6 && strcmp(url + n - 6, "/index") == 0) url[n - 6] = 0;
        route_add(pr, "nextjs", "*", url, NULL, 1);
    } else if ((p=strstr(path,"server/api/"))!=NULL) {
        char url[512],method[16]="*";
        snprintf(url,sizeof url,"/api/%s",p+11);
        char *dot=strrchr(url,'.');if(dot)*dot=0;
        dot=strrchr(url,'.');
        if(dot) {
            const char *verbs[]={"get","post","put","patch","delete"};
            for(size_t i=0;i<sizeof verbs/sizeof verbs[0];i++)
                if(strcmp(dot+1,verbs[i])==0){snprintf(method,sizeof method,"%s",verbs[i]);upcase(method);*dot=0;break;}
        }
        route_add(pr,"nuxt",method,url,NULL,1);
    } else if ((p = strstr(path,"pages/")) != NULL && strstr(path,".vue")) {
        char url[512];snprintf(url,sizeof url,"/%s",p+6);
        char *dot=strrchr(url,'.');if(dot)*dot=0;
        size_t n=strlen(url);if(n>=6&&strcmp(url+n-6,"/index")==0)url[n-6]=0;
        route_add(pr,"nuxt","PAGE",url[0]?url:"/",NULL,1);
    } else if ((p=strstr(path,"app/"))!=NULL && strstr(path,"/page.")) {
        char url[512];snprintf(url,sizeof url,"/%s",p+4);
        char *cut=strstr(url,"/page.");if(cut)*cut=0;
        route_add(pr,"nextjs-app","PAGE",url[0]?url:"/",NULL,1);
    } else if ((p=strstr(path,"src/routes/"))!=NULL &&
               (strstr(path,"/+page.")||strstr(path,"/+page.server."))) {
        char url[512];snprintf(url,sizeof url,"/%s",p+11);
        char *cut=strstr(url,"/+page");if(cut)*cut=0;
        route_add(pr,"sveltekit","PAGE",url[0]?url:"/",NULL,1);
    } else if ((p=strstr(path,"app/"))!=NULL &&
               (strstr(path,"/index.tsx")||strstr(path,"/index.jsx"))) {
        char url[512];snprintf(url,sizeof url,"/%s",p+4);
        char *cut=strstr(url,"/index.");if(cut)*cut=0;
        route_add(pr,"expo-router","PAGE",url[0]?url:"/",NULL,1);
    } else if ((p=strstr(path,"app/"))!=NULL &&
               (strstr(path,".tsx")||strstr(path,".jsx"))) {
        char url[512];snprintf(url,sizeof url,"/%s",p+4);
        char *dot=strrchr(url,'.');if(dot)*dot=0;
        if(strchr(url,'(')||strchr(url,')'))return;
        route_add(pr,"expo-router","PAGE",url[0]?url:"/",NULL,1);
    }
}
