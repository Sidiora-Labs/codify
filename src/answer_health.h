#ifndef CG_ANSWER_HEALTH_H
#define CG_ANSWER_HEALTH_H

#include "cg.h"

/* Append a bounded, branch-aware index-health object to an existing JSON
 * answer. Only paths named by that answer are considered contributors. */
char *answer_health_json(Cg *cg, const char *answer);
int answer_health_status(Cg *cg, bool json);
void answer_health_append(StrBuf *out, Cg *cg, const char *answer);
void answer_health_text(Cg *cg);

#endif
