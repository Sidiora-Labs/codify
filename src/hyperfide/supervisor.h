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
typedef struct {
 char state_dir[4096],launch_id[37],identity[2048],state[32],os_boot_id[37];
 uid_t uid;gid_t gid;pid_t broker_pid,agent_pid;
 unsigned long long broker_start,agent_start;
} HfRunnerBinding;
int hf_runner_binding(const char *request,HfRunnerBinding *binding);
int hf_runner_processes(const HfRunnerBinding *,HfProcessIdentity *,size_t);
int hf_runner_job_claim(const char *,const char *,HfHttpResponse *);
int hf_runner_job_placement(const char *,const char *);
int hf_runner_job_execute(const char *,FILE *);

/* Dedicated slot UID cleanup survives a blocked or dead supervising broker. */
pid_t hf_slot_watchdog(uid_t uid, long long deadline_ns, int *writer, const char *owner);
int hf_slot_watchdog_finish(pid_t guard, int *writer);
int hf_slot_owner(uid_t uid, const char *owner);

int hf_slot_control_lock(uid_t uid, const char *owner);

typedef struct {
 char context_path[4096],workspace_path[4096],workspace_parent[4096];
 char node_path[4096],recipe_path[4096],node_digest[72],recipe_digest[72];
 char stage_root[4096],out_root[4096],diagnostics_root[4096];
 uid_t uid;gid_t gid;
} HfPreparationStage;
int hf_runner_stage_preparation(const char *config_path,const HfJson *claim,int result,HfPreparationStage *stage);
typedef struct {
 char charge_id[37],charge_generation[32],sandbox_id[37],boot_id[37],boot_generation[32],kernel_boot_id[37];
 char cgroup_path[4096],evidence_digest[72];
 unsigned long long cpu_millis,memory_bytes,disk_bytes;
 int cpu_enforced,memory_enforced,disk_enforced,root_fd,scope_fd,child_attached,status;
 HfProcessIdentity attached;char reason[128];
 dev_t root_dev,scope_dev;ino_t root_ino,scope_ino;
} HfBudgetHandle;
enum {HF_BUDGET_ERROR=-1,HF_BUDGET_UNAVAILABLE=0,HF_BUDGET_READY=1};
int hf_budget_prepare(const char *trusted_config_path,const char *authenticated_charge_json,HfBudgetHandle *);
int hf_budget_attach(HfBudgetHandle *,const HfProcessIdentity *);
int hf_budget_observe(const HfBudgetHandle *,FILE *);
int hf_budget_release(HfBudgetHandle *);
int hf_supervisor_daemon(const char *request,FILE *out);

#endif
