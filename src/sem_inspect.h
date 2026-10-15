#ifndef CG_SEM_INSPECT_H
#define CG_SEM_INSPECT_H
#include "cg.h"

int cmd_sem_hierarchy(Cg *cg, const char *name, int limit, bool json);
int cmd_sem_unreferenced(Cg *cg, const char *path, int limit, bool json);

#endif
