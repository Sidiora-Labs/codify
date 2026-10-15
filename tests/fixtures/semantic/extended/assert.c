#include "cg.h"
#include "ast.h"
#include <stdio.h>
#include <string.h>

extern void ast_extended_register(void);

typedef struct {
    const char *path, *language, *symbol, *kind, *reference;
} Case;

static int has_symbol(const SemResult *r, const char *name, const char *kind) {
    for (int i=0;i<r->nsymbols;i++)
        if (!strcmp(r->symbols[i].name,name) && !strcmp(r->symbols[i].kind,kind))
            return 1;
    return 0;
}
static int has_ref(const SemResult *r, const char *name) {
    for (int i=0;i<r->nreferences;i++)
        if (!strcmp(r->references[i].text,name)) return 1;
    return 0;
}

int main(void) {
    static const Case cases[] = {
        {"sample.lua","lua","launch","function","run"},
        {"sample.luau","luau","launch","function","run"},
        {"sample.r","r","launch","function","run"},
        {"sample.erl","erlang","launch","function","run"},
        {"sample.sol","solidity","Ledger","contract","run"},
        {"sample.tf","terraform","local_file","block","format"},
        {"sample.nix","nix","launch","function","run"},
    };
    int failed=0;
    ast_extended_register();
    for (size_t i=0;i<sizeof cases/sizeof cases[0];i++) {
        char path[512];
        snprintf(path,sizeof path,"tests/fixtures/semantic/extended/%s",cases[i].path);
        size_t len=0; char *source=read_entire_file(path,&len);
        ParseResult result={0};
        const AstAdapter *adapter=ast_adapter(cases[i].language);
        if (!source || !adapter || !adapter->grammar ||
            !ast_try_parse(cases[i].language,path,source,len,&result)) {
            fprintf(stderr,"%s: grammar parse unavailable\n",cases[i].path);
            failed++; free(source); continue;
        }
        if (!has_symbol(&result.sem,cases[i].symbol,cases[i].kind) ||
            !has_ref(&result.sem,cases[i].reference) ||
            has_symbol(&result.sem,"phantom","function") ||
            has_ref(&result.sem,"phantom") || has_ref(&result.sem,"fake")) {
            fprintf(stderr,"%s: positive or negative structural assertion failed\n",cases[i].path);
            failed++;
        }
        for (int j=0;j<result.sem.nsymbols;j++) {
            const SemSymbol *s=&result.sem.symbols[j];
            if (s->parent==j || s->span.start_byte>=s->span.end_byte ||
                s->span.end_byte>len || s->span.line<1) {
                fprintf(stderr,"%s: invalid ownership or span for %s\n",path,s->name);
                failed++;
            }
        }
        for (int j=0;j<result.sem.nreferences;j++) {
            const SemReference *r=&result.sem.references[j];
            if (r->span.start_byte>=r->span.end_byte || r->span.end_byte>len)
                failed++;
        }
        if (!strcmp(cases[i].language,"solidity") &&
            (!has_symbol(&result.sem,"Updated","event") ||
             !has_symbol(&result.sem,"launch","function"))) failed++;
        if (!strcmp(cases[i].language,"terraform") &&
            !has_symbol(&result.sem,"filename","attribute")) failed++;
        if (!strcmp(cases[i].language,"erlang") &&
            (!has_symbol(&result.sem,"sample","module") ||
             !has_symbol(&result.sem,"state","record"))) failed++;
        if (!strcmp(cases[i].language,"nix") &&
            !has_symbol(&result.sem,"value","attribute")) failed++;
        parse_result_free(&result); free(source);
    }
    if (failed) fprintf(stderr,"extended AST: %d failed assertions\n",failed);
    else puts("extended AST: seven grammars and structural positive/negative fixtures passed");
    return failed?1:0;
}
