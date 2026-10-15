#ifndef CG_SEM_TYPES_H
#define CG_SEM_TYPES_H

#include "semantic.h"

/* Register after import and receiver binding, before runtime synthesis. */
int sem_types_register(void);
int sem_types_run(Cg *cg, const long *changed_files, int nfiles);

/* Return the number of IDs written (at most cap). All traversals are
 * branch-scoped, cycle-safe and bounded. A zero result also means no proof. */
int sem_type_ancestors(Cg *cg, long symbol_id, long *out, int cap);
int sem_type_subtypes(Cg *cg, long symbol_id, long *out, int cap);
int sem_type_implementations(Cg *cg, long interface_id, long *out, int cap);

#endif
