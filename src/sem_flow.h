#ifndef CG_SEM_FLOW_H
#define CG_SEM_FLOW_H

#include "cg.h"

typedef struct {
    int depth, nodes, edges, time_ms, output_bytes;
} SemFlowLimits;

/* mode: callers, callees, impact, or paths. Paths needs a target name.
 * The response is JSON in both CLI --json and MCP; plain CLI is summarized. */
int sem_flow_query(Cg *cg, const char *mode, const char *name,
                   const char *target, SemFlowLimits limits, bool json);

#endif
