#ifndef CG_WATCH_HEALTH_H
#define CG_WATCH_HEALTH_H
#include "cg.h"

typedef struct {
    bool pending;
    unsigned long long generation;
    char reason[32];
} WatchHealth;

/* A branch-scoped, durable whole-tree reconciliation request. These calls
 * use a small file lock, independent of the index and SQLite write locks. */
bool watch_health_mark(const Cg *cg, const char *reason);
bool watch_health_read(const Cg *cg, WatchHealth *out);
bool watch_health_clear_if(const Cg *cg, unsigned long long generation);

#endif
