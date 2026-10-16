#define _GNU_SOURCE
#include "components.h"
#include "supervisor.h"
#include <errno.h>
#include <signal.h>
#include <sqlite3.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

static int update(const HfRunnerBinding *b,const char *state) {
 char path[4200];snprintf(path,sizeof path,"%s/launches.db",b->state_dir);sqlite3 *db=NULL;sqlite3_stmt *q=NULL;int ok=sqlite3_open_v2(path,&db,SQLITE_OPEN_READWRITE,NULL)==SQLITE_OK;
 if(ok)ok=sqlite3_exec(db,"PRAGMA synchronous=FULL;BEGIN IMMEDIATE",NULL,NULL,NULL)==SQLITE_OK&&sqlite3_prepare_v2(db,"UPDATE launches SET state=?,updated=unixepoch() WHERE id=? AND uid=?",-1,&q,NULL)==SQLITE_OK;
 if(ok){sqlite3_bind_text(q,1,state,-1,SQLITE_STATIC);sqlite3_bind_text(q,2,b->launch_id,-1,SQLITE_STATIC);sqlite3_bind_int64(q,3,b->uid);ok=sqlite3_step(q)==SQLITE_DONE&&sqlite3_changes(db)==1;}sqlite3_finalize(q);
 if(ok)ok=sqlite3_exec(db,"COMMIT",NULL,NULL,NULL)==SQLITE_OK;else if(db)sqlite3_exec(db,"ROLLBACK",NULL,NULL,NULL);sqlite3_close(db);return ok;
}
static int signal_exact(const HfProcessIdentity *p,int signal_number) {return !hf_process_matches(p,NULL)||kill(p->pid,signal_number)==0||errno==ESRCH;}
static int stop(const HfRunnerBinding *b) {
 if(!update(b,"STOPPING"))return 0;
 struct timespec delay={.tv_nsec=100000000};
 for(int round=0;round<50;++round){HfProcessIdentity list[1024];int count=hf_runner_processes(b,list,1024);if(count<0)return 0;if(!count)return update(b,"STOPPED");
  for(int k=0;k<count;++k)if(!signal_exact(&list[k],round<2?SIGTERM:SIGKILL))return 0;
  while(waitpid(-1,NULL,WNOHANG)>0){}nanosleep(&delay,NULL);
 }return 0;
}
int hf_component_12_4(const char *action,const char *request,FILE *out) {
 if(!strcmp(action,"runner.job.execute"))return hf_runner_job_execute(request,out);
 HfRunnerBinding b;if(!hf_runner_binding(request,&b))return hf_native_error(out,"IDENTITY_MISMATCH");
 if(!strcmp(action,"runner.pause")||!strcmp(action,"runner.drain")){
  /* These modes fence new input locally; they never report stopped processes. */
  HfJson *j=malloc(sizeof *j);char command[37];int ok=j&&hf_json_parse(j,request)&&hf_json_get(j,"command_id",command,sizeof command)&&hf_uuid_valid(command);free(j);if(!ok)return hf_native_error(out,"COMMAND_ID_REQUIRED");
  int changed=update(&b,!strcmp(action,"runner.pause")?"PAUSED":"DRAINING");fprintf(out,"{\"accepted\":%s,\"processes_stopped\":false,\"cleanup_complete\":false}",changed?"true":"false");return 0;
 }
 if(strcmp(action,"runner.observe")&&strcmp(action,"runner.stop"))return hf_native_error(out,"UNKNOWN_ACTION");
 char command[37]="";HfJson *j=malloc(sizeof *j);int stopping=!strcmp(action,"runner.stop");int ok=j&&hf_json_parse(j,request)&&(!stopping||(hf_json_get(j,"command_id",command,sizeof command)&&hf_uuid_valid(command)));free(j);if(!ok)return hf_native_error(out,"COMMAND_ID_REQUIRED");
 /* Prefer the live IPC owner, which closes stdin and flushes both log streams.
  * A dead broker requires explicit tree cleanup, never PID-only adoption. */
 char *rpc=NULL;size_t n=0;FILE *stream=open_memstream(&rpc,&n);int live=0;
 if(stream){live=hf_launch_rpc(b.state_dir,action,request,stream)==0;fclose(stream);}
 if(live){fputs(rpc,out);free(rpc);return 0;}free(rpc);
 int ownership=hf_slot_control_lock(b.uid,b.launch_id);if(ownership<0)return hf_native_error(out,"SLOT_GENERATION_BUSY_OR_SUPERSEDED");
 int stopped=stopping?stop(&b):0;HfProcessIdentity list[1024];int count=hf_runner_processes(&b,list,1024);HfProcessIdentity broker;
 int broker_alive=hf_process_identity(b.broker_pid,&broker)&&broker.start_time==b.broker_start&&!strcmp(broker.os_boot_id,b.os_boot_id);
 char observation[37];if(!hf_uuid_generate(observation)){close(ownership);return hf_native_error(out,"RANDOM_SOURCE_FAILED");}
 fprintf(out,"{\"status\":\"%s\",\"command_id\":",count==0&&!broker_alive&&(!stopping||stopped)?"CONFIRMED_STOPPED":"UNKNOWN");if(*command)hf_json_write_string(out,command);else fputs("null",out);
 fprintf(out,",\"launch_id\":\"%s\",\"observation_id\":\"%s\",\"observed_at_seconds\":%lld,\"binding\":%s,\"processes\":[",b.launch_id,observation,(long long)time(NULL),b.identity);
 for(int k=0;k<count;++k){if(k)fputc(',',out);hf_process_json(out,&list[k]);}
 fprintf(out,"],\"remaining_descendants\":%d,\"ipc_closed\":%s,\"native_context_recoverable\":false,\"required_artifacts\":[],\"credential_revocation\":[],\"cleanup_complete\":false,\"recovery_required\":true}",count,!broker_alive?"true":"false");close(ownership);return 0;
}
