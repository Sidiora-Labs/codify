#ifndef HYPERFIDE_SUPERVISOR_H
#define HYPERFIDE_SUPERVISOR_H
#include "transport.h"
#include <sys/types.h>
typedef struct {
    pid_t pid,ppid,pgid;
    uid_t uid;
    unsigned long long start_time,virtual_bytes;
    long resident_pages;
    char os_boot_id[37],state;
} HfProcessIdentity;
int hf_process_identity(pid_t pid,HfProcessIdentity *identity);
int hf_process_matches(const HfProcessIdentity *expected,HfProcessIdentity *observed);
void hf_process_json(FILE *output,const HfProcessIdentity *identity);
int hf_supervisor_call(const char *config_path,int enrollment,const char *payload,
 const char *operation_id,const char *idempotency_key,const char *correlation_id,
 const char *causation_id,const char *seconds,const char *nonce,HfHttpResponse *response);
/* Trusted supervisor-local IPC. Workers must not share the supervisor UID. */
int hf_launch_rpc(const char *state_dir,const char *action,const char *payload,FILE *output);
#endif
