#ifndef CG_SEM_DISPATCH_H
#define CG_SEM_DISPATCH_H

#include "semantic.h"

/* Order 50: consumes persisted syntax facts and resolved type relations. */
int sem_dispatch_run(Cg *cg, const long *changed_files, int nfiles);
void sem_dispatch_register(void);

#endif
