#ifndef INDEX_HEALTH_H
#define INDEX_HEALTH_H

#include "cg.h"

/* Changes only when extracted facts may differ for identical source bytes. */
#define CG_EXTRACTION_VERSION 1

typedef struct {
    const char *status;       /* complete, partial, skipped, failed */
    const char *reason;       /* bounded reason code */
    const char *parser;
    int diagnostic_line;
    const char *diagnostics;
    bool generated;
    const char *content_hash; /* current bytes, when read successfully */
} IndexHealthResult;

int index_health_init(Cg *cg);
bool index_health_stale(Cg *cg, const char *path);
bool index_health_branch_stale(Cg *cg);
void index_health_record(Cg *cg, const char *path, const IndexHealthResult *r);
void index_health_finish(Cg *cg);
void index_health_remove(Cg *cg, long file_id);
void index_health_prune_missing(Cg *cg);
bool index_health_generated(const char *path, const char *body, size_t len);
void parse_diagnostic_add(ParseResult *pr, const char *code, int line);

#endif
