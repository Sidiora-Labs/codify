#ifndef CG_SEM_IMPORTS_H
#define CG_SEM_IMPORTS_H
#include "cg.h"
/* Register before receiver and type passes. NULL means a complete pass;
 * a non-NULL empty change set is a proven no-op. */
void sem_imports_register(void);
int sem_imports_pass(Cg *cg, const long *changed_files, int nfiles);
/* True when a configuration dependency changed on disk since resolution. */
bool sem_imports_config_changed(Cg *cg);
#endif
