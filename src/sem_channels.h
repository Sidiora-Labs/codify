#ifndef CG_SEM_CHANNELS_H
#define CG_SEM_CHANNELS_H

#include "cg.h"

/* Syntax adapters emit semantic_type_facts with kind
 * channel:<http|queue|bus|socket>:<producer|consumer>, a literal name,
 * and value containing the HTTP method or a proven receiver identity.
 * A pass runs after routes and owns only its synthesized edges. */
void sem_channels_register(void);
int sem_channels_pass(Cg *cg, const long *changed_files, int nfiles);

#endif
