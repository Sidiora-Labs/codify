#ifndef CG_SEM_INCREMENTAL_H
#define CG_SEM_INCREMENTAL_H

#include "cg.h"

/* Debt is written in the same transaction as changed source facts. It is
 * cleared only with the transaction that publishes all resolver passes. */
void sem_incremental_init(Cg *cg);
void sem_incremental_note(Cg *cg, long file_id);
int sem_incremental_pending(Cg *cg);
int sem_incremental_needs_run(Cg *cg);
int sem_incremental_run(Cg *cg, int force_full);

#endif
