#ifndef HYPERFIDE_CLIENT_H
#define HYPERFIDE_CLIENT_H
#include <stdio.h>
typedef enum {
 HF_DECISION_GUARD=1,HF_DECISION_READINESS,HF_DECISION_TRIAGE,
 HF_DECISION_MEMORY,HF_DECISION_RECAP
} HfDecisionPurpose;
typedef enum {HF_DECISION_SUBMIT=1,HF_DECISION_RESULT} HfDecisionPhase;
int hf_client_dispatch(int argc,char **argv,FILE *output,FILE *error);
int hf_client_authority_mode(void);
int hf_client_decision_invoke(HfDecisionPurpose purpose,HfDecisionPhase phase,
 const char *input_json,const char *operation_id,const char *idempotency_key,
 const char *correlation_id,long remaining_budget_ms,FILE *output,FILE *error);
#endif
