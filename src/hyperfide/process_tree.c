#define _GNU_SOURCE
#include "components.h"
#include "supervisor.h"
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <sqlite3.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

int hf_runner_binding(const char *request,HfRunnerBinding *binding) {
 memset(binding,0,sizeof *binding);HfJson *j=malloc(sizeof *j),*identity=malloc(sizeof *identity);char state[4096],launch[37];
 int ok=j&&identity&&hf_json_parse(j,request)&&hf_json_get(j,"state_dir",state,sizeof state)&&state[0]=='/'&&hf_json_get(j,"launch_id",launch,sizeof launch)&&hf_uuid_valid(launch)&&geteuid()==0;
 struct stat info;if(ok)ok=!lstat(state,&info)&&S_ISDIR(info.st_mode)&&info.st_uid==geteuid()&&!(info.st_mode&077);
 char path[4200];snprintf(path,sizeof path,"%s/launches.db",ok?state:"");if(ok)ok=!lstat(path,&info)&&S_ISREG(info.st_mode)&&info.st_uid==geteuid()&&!(info.st_mode&077)&&info.st_nlink==1;
 sqlite3 *db=NULL;sqlite3_stmt *q=NULL;if(ok)ok=sqlite3_open_v2(path,&db,SQLITE_OPEN_READONLY,NULL)==SQLITE_OK&&sqlite3_prepare_v2(db,"SELECT uid,gid,identity,state,broker_pid,broker_start,agent_pid,agent_start,os_boot FROM launches WHERE id=?",-1,&q,NULL)==SQLITE_OK;
 if(ok){sqlite3_bind_text(q,1,launch,-1,SQLITE_STATIC);ok=sqlite3_step(q)==SQLITE_ROW;}
 if(ok){const char *raw=(const char*)sqlite3_column_text(q,2);ok=raw&&hf_json_parse(identity,raw);binding->uid=(uid_t)sqlite3_column_int64(q,0);binding->gid=(gid_t)sqlite3_column_int64(q,1);snprintf(binding->state,sizeof binding->state,"%s",sqlite3_column_text(q,3));binding->broker_pid=sqlite3_column_int(q,4);binding->agent_pid=sqlite3_column_int(q,6);}
 const char *fields[]={"attempt_id","attempt_generation","sandbox_id","boot_id","boot_generation"};
 for(unsigned k=0;ok&&k<5;++k){char expected[128],actual[128];ok=hf_json_get(identity,fields[k],expected,sizeof expected)&&hf_json_get(j,fields[k],actual,sizeof actual)&&!strcmp(expected,actual);}
 if(ok){snprintf(binding->state_dir,sizeof binding->state_dir,"%s",state);snprintf(binding->launch_id,sizeof binding->launch_id,"%s",launch);snprintf(binding->identity,sizeof binding->identity,"%s",(const char*)sqlite3_column_text(q,2));const char *boot=(const char*)sqlite3_column_text(q,8),*start=(const char*)sqlite3_column_text(q,7),*broker_start=(const char*)sqlite3_column_text(q,5);if(boot&&start&&broker_start){snprintf(binding->os_boot_id,sizeof binding->os_boot_id,"%s",boot);binding->agent_start=strtoull(start,NULL,10);binding->broker_start=strtoull(broker_start,NULL,10);}else ok=0;}
 sqlite3_finalize(q);sqlite3_close(db);free(j);free(identity);HfProcessIdentity current;
 return ok&&binding->uid>0&&hf_process_identity(getpid(),&current)&&!strcmp(current.os_boot_id,binding->os_boot_id);
}
int hf_runner_processes(const HfRunnerBinding *binding,HfProcessIdentity *list,size_t capacity) {
 DIR *dir=opendir("/proc");if(!dir)return -1;struct dirent *entry;size_t count=0;
 while((entry=readdir(dir))){char *end=NULL;errno=0;long pid=strtol(entry->d_name,&end,10);if(errno||!end||*end||pid<=0||pid>INT_MAX)continue;HfProcessIdentity process;
  if(hf_process_identity((pid_t)pid,&process)&&process.uid==binding->uid&&process.state!='Z'&&process.state!='X'){if(count==capacity){closedir(dir);return -1;}list[count++]=process;}}
 closedir(dir);return (int)count;
}
int hf_component_12_3(const char *action,const char *request,FILE *out) {
 if(strcmp(action,"process_tree.observe"))return hf_native_error(out,"UNKNOWN_ACTION");
 HfRunnerBinding binding;
 if(!hf_runner_binding(request,&binding))return hf_native_error(out,"IDENTITY_MISMATCH");
 HfProcessIdentity list[1024];int count=hf_runner_processes(&binding,list,1024);if(count<0)return hf_native_error(out,"PROCESS_INVENTORY_INCOMPLETE");
 unsigned long long virtual_bytes=0;long resident=0;int exact_agent=0;
 fprintf(out,"{\"launch_id\":\"%s\",\"tree_scope\":\"DEDICATED_SLOT_UID\",\"os_liveness\":\"%s\",\"ipc_health\":\"UNOBSERVED\",\"useful_progress\":\"UNKNOWN\",\"authority_renewed\":false,\"processes\":[",binding.launch_id,count?"PRESENT":"QUIESCENT");
 for(int k=0;k<count;++k){if(k)fputc(',',out);hf_process_json(out,&list[k]);virtual_bytes+=list[k].virtual_bytes;resident+=list[k].resident_pages;if(list[k].pid==binding.agent_pid&&list[k].start_time==binding.agent_start&&!strcmp(list[k].os_boot_id,binding.os_boot_id))exact_agent=1;}
 fprintf(out,"],\"exact_agent_observed\":%s,\"virtual_bytes\":\"%llu\",\"resident_pages\":%ld,\"progress_must_be_measured_separately\":true}",exact_agent?"true":"false",virtual_bytes,resident);return 0;
}
