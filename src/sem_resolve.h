#ifndef CG_SEM_RESOLVE_H
#define CG_SEM_RESOLVE_H

#include "semantic.h"

/* Registration order 20: explicit import targets must already be available. */
int sem_resolve_register(void);
int sem_resolve_run(Cg *cg, const long *changed_files, int nfiles);

#endif
