#ifndef HYPERFIDE_ADVISORY_H
#define HYPERFIDE_ADVISORY_H
#include <stdio.h>

/* Task 21.4 native advisory seam. Advice is bounded, audited and non-authoritative:
 * nothing here grants a lease, waives evidence or publishes a protected branch.
 * The service component "21.4" owns persistence; this component only describes and
 * resolves the finite legacy client contract to the service actions it calls. */
#define HF_ADVISORY_BUDGET_MS 2000
#define HF_ADVISORY_JOB_DEADLINE_MS 1500

int hf_advisory_action_name(const char *purpose,const char *phase,char *out,size_t size);
int hf_component_21_4(const char *action,const char *request_json,FILE *output);
#endif
