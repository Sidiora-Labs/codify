#ifndef CG_SEM_ROUTES_H
#define CG_SEM_ROUTES_H

#include "cg.h"

typedef struct {
    long route_symbol_id, handler_symbol_id, file_id;
    int line, column;
    char registration_path[4096];
} SemRouteMatch;

/* Register after semantic schema initialization. A changed registration or
 * handler definition causes route facts and links to be rebuilt. */
void sem_routes_register(void);
int sem_routes_pass(Cg *cg, const long *changed_files, int nfiles);
int sem_routes_purge_file(Cg *cg, long file_id);

/* Exact local method/path lookup. 1 = one route, 0 = none, -1 = ambiguous.
 * A wildcard method is never proof of a method-specific handler. */
int sem_route_lookup_unique(Cg *cg, const char *method, const char *path,
                            SemRouteMatch *match);

#endif
