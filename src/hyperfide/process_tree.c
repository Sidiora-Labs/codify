#define _GNU_SOURCE
#include "components.h"
#include "supervisor.h"
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <signal.h>
#include <sqlite3.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/statfs.h>
#include <sys/wait.h>
#include <time.h>
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
 return ok&&binding->uid>0&&hf_slot_owner(binding->uid,binding->launch_id)&&hf_process_identity(getpid(),&current)&&!strcmp(current.os_boot_id,binding->os_boot_id);
}
int hf_runner_processes(const HfRunnerBinding *binding,HfProcessIdentity *list,size_t capacity) {
 DIR *dir=opendir("/proc");if(!dir)return -1;struct dirent *entry;size_t count=0;
 while((entry=readdir(dir))){char *end=NULL;errno=0;long pid=strtol(entry->d_name,&end,10);if(errno||!end||*end||pid<=0||pid>INT_MAX)continue;HfProcessIdentity process;
  if(hf_process_identity((pid_t)pid,&process)&&process.uid==binding->uid&&process.state!='Z'&&process.state!='X'){if(count==capacity){closedir(dir);return -1;}list[count++]=process;}}
 closedir(dir);return (int)count;
}
/* Task 12.3 observations. Process liveness, IPC health, useful progress, limits,
 * sandbox reachability and assurance validity are reported as separate fields;
 * none of them is inferred from another and none renews task authority. */
typedef struct {pid_t pid,ppid;uid_t uid;unsigned long long start;char state;} TreeNode;
static int node_order(const void *a,const void *b){pid_t x=((const TreeNode*)a)->pid,y=((const TreeNode*)b)->pid;return (x>y)-(x<y);}
static const TreeNode *node_find(const TreeNode *nodes,size_t count,pid_t pid){TreeNode key={.pid=pid};return bsearch(&key,nodes,count,sizeof *nodes,node_order);}
static int node_agent(const TreeNode *n,const HfRunnerBinding *b){return n->pid==b->agent_pid&&n->start==b->agent_start&&n->uid==b->uid;}
static int node_broker(const TreeNode *n,const HfRunnerBinding *b){return n->pid==b->broker_pid&&n->start==b->broker_start;}
/* Walk the live parent chain. Orphans reparented to the subreaper broker remain
 * job members only when the process directly below the broker is slot-owned. */
static int node_relation(const TreeNode *nodes,size_t count,const TreeNode *self,const HfRunnerBinding *b,int *depth){
 int slot=0;const TreeNode *q=self,*below=NULL;
 for(int step=0;q&&step<4096;++step){
  *depth=step;
  if(node_agent(q,b))return step?HF_TREE_DESCENDANT:HF_TREE_AGENT;
  if(node_broker(q,b))return below&&below->uid==b->uid?HF_TREE_ADOPTED:slot?HF_TREE_ESCAPED:0;
  if(q->uid==b->uid)slot=1;
  if(q->ppid<=0)break;
  below=q;q=node_find(nodes,count,q->ppid);
 }
 return slot?HF_TREE_ESCAPED:0;
}
/* Fields absent from HfProcessIdentity; bound to the same start_time to refuse PID reuse races. */
static int stat_extra(pid_t pid,unsigned long long start,pid_t *session,unsigned long long *ticks,long *threads){
 char path[64],line[8192];snprintf(path,sizeof path,"/proc/%ld/stat",(long)pid);FILE *f=fopen(path,"re");if(!f)return 0;
 int ok=fgets(line,sizeof line,f)!=NULL;fclose(f);char *end=ok?strrchr(line,')'):NULL;if(!end||end[1]!=' ')return 0;
 char *save=NULL,*value=strtok_r(end+2," ",&save);unsigned long long utime=0,stime=0,observed=0;int field=3;
 for(;value;value=strtok_r(NULL," ",&save),++field){
  if(field==6)*session=(pid_t)strtol(value,NULL,10);else if(field==14)utime=strtoull(value,NULL,10);else if(field==15)stime=strtoull(value,NULL,10);
  else if(field==20)*threads=strtol(value,NULL,10);else if(field==22){observed=strtoull(value,NULL,10);break;}
 }
 *ticks=utime+stime;return field==22&&observed==start;
}
int hf_process_tree_inventory(const HfRunnerBinding *b,HfProcessTree *tree){
 memset(tree,0,sizeof *tree);tree->agent_index=-1;
 size_t capacity=65536,count=0;TreeNode *nodes=calloc(capacity,sizeof *nodes);DIR *dir=opendir("/proc");
 if(!nodes||!dir){free(nodes);if(dir)closedir(dir);return -1;}
 struct dirent *entry;int overflow=0;
 while((entry=readdir(dir))){char *end=NULL;errno=0;long pid=strtol(entry->d_name,&end,10);if(errno||!end||*end||pid<=0||pid>INT_MAX)continue;HfProcessIdentity p;
  if(!hf_process_identity((pid_t)pid,&p)||strcmp(p.os_boot_id,b->os_boot_id))continue;
  if(count==capacity){overflow=1;break;}nodes[count++]=(TreeNode){p.pid,p.ppid,p.uid,p.start_time,p.state};}
 closedir(dir);if(overflow){free(nodes);return -1;}
 qsort(nodes,count,sizeof *nodes,node_order);
 for(size_t k=0;k<count;++k){
  if(node_broker(&nodes[k],b))tree->broker_present=nodes[k].state!='Z'&&nodes[k].state!='X';
  if(nodes[k].state=='Z'||nodes[k].state=='X')continue;
  int depth=0,relation=node_relation(nodes,count,&nodes[k],b,&depth);if(!relation)continue;
  if(tree->count==1024){free(nodes);return -1;}
  HfTreeMember *m=&tree->members[tree->count];
  if(!hf_process_identity(nodes[k].pid,&m->process)||m->process.start_time!=nodes[k].start||!stat_extra(nodes[k].pid,nodes[k].start,&m->session,&m->cpu_ticks,&m->threads)){memset(m,0,sizeof *m);++tree->raced;continue;}
  m->relation=relation;m->depth=depth;m->uid_changed=m->process.uid!=b->uid;if(relation==HF_TREE_AGENT)tree->agent_index=tree->count;++tree->count;
 }
 free(nodes);return tree->count;
}
/* Exact-identity tree cancellation for stop/checkpoint owners: a PID whose start
 * time or boot changed is never signalled. */
int hf_process_tree_cancel(const HfRunnerBinding *b,int rounds,int *remaining){
 HfProcessTree *tree=malloc(sizeof *tree);if(!tree)return 0;struct timespec delay={.tv_nsec=100000000};int result=0;*remaining=-1;
 for(int round=0;round<rounds;++round){
  int count=hf_process_tree_inventory(b,tree);*remaining=count;if(count<0)break;if(!count&&!tree->raced){result=1;break;}
  for(int k=0;k<count;++k){HfProcessIdentity now;if(hf_process_matches(&tree->members[k].process,&now))kill(now.pid,round<2?SIGTERM:SIGKILL);}
  while(waitpid(-1,NULL,WNOHANG)>0){}nanosleep(&delay,NULL);
 }
 free(tree);return result;
}
static int read_small(const char *path,char *out,size_t capacity){
 int fd=open(path,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);if(fd<0)return 0;ssize_t n=read(fd,out,capacity-1);close(fd);if(n<0)return 0;
 out[n]=0;if(n&&out[n-1]=='\n')out[n-1]=0;return 1;
}
static long long keyed(const char *text,const char *key){
 size_t n=strlen(key);for(const char *p=text;p&&*p;p=strchr(p,'\n'),p=p?p+1:NULL)if(!strncmp(p,key,n)&&p[n]==' ')return strtoll(p+n+1,NULL,10);return -1;
}
static int cgroup_of(pid_t pid,char *out,size_t capacity){
 char path[64],text[4096];snprintf(path,sizeof path,"/proc/%ld/cgroup",(long)pid);if(!read_small(path,text,sizeof text))return 0;
 for(char *line=text;line&&*line;){char *next=strchr(line,'\n');if(next)*next++=0;
  if(!strncmp(line,"0::/",4)&&!strstr(line,"/..")&&strlen(line+3)<capacity){snprintf(out,capacity,"%s",line+3);return 1;}line=next;}
 return 0;
}
static int cgroup_within(const char *path,const char *scope){size_t n=strlen(scope);return !strcmp(scope,"/")||(!strncmp(path,scope,n)&&(path[n]==0||path[n]=='/'));}
static int limit_line(pid_t pid,const char *name,char *soft,size_t capacity){
 char path[64],line[256];snprintf(path,sizeof path,"/proc/%ld/limits",(long)pid);FILE *f=fopen(path,"re");if(!f)return 0;int found=0;size_t n=strlen(name);
 while(!found&&fgets(line,sizeof line,f))if(!strncmp(line,name,n)&&line[n]==' '){char value[64];found=sscanf(line+n," %63s",value)==1;if(found)snprintf(soft,capacity,"%s",value);}
 fclose(f);return found;
}
static const char *const progress_states[]={"WORKING","IDLE","MODEL_WAITING","BUILD_WAITING","TOOL_WAITING","MODEL_ERROR","TOOL_ERROR","AUTH_FAILED","RATE_LIMITED","QUOTA_EXHAUSTED"};
typedef struct {int available;unsigned long long stdout_bytes,stderr_bytes;time_t last_output;long long events,useful,noop,repeated,invalid,max_sequence;int last_useful;char last_state[32];} ProgressScan;
static FILE *spool(const HfRunnerBinding *b,const char *suffix,struct stat *st){
 char path[4200];snprintf(path,sizeof path,"%s/%s.%s",b->state_dir,b->launch_id,suffix);int fd=open(path,O_RDONLY|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK);
 if(fd<0)return NULL;
 if(fstat(fd,st)||!S_ISREG(st->st_mode)||st->st_uid!=geteuid()||st->st_nlink!=1||(st->st_mode&022)){close(fd);return NULL;}
 FILE *f=fdopen(fd,"re");if(!f)close(fd);return f;
}
/* Useful progress comes only from structured events in the broker-owned stdout
 * spool; byte growth is activity, never progress or success. */
static void progress_scan(const HfRunnerBinding *b,HfJson *j,ProgressScan *s){
 memset(s,0,sizeof *s);s->max_sequence=-1;snprintf(s->last_state,sizeof s->last_state,"NONE");struct stat out,err;
 FILE *e=spool(b,"stderr",&err),*f=spool(b,"stdout",&out);if(e)fclose(e);if(!f||!e){if(f)fclose(f);return;}
 s->available=1;s->stdout_bytes=(unsigned long long)out.st_size;s->stderr_bytes=(unsigned long long)err.st_size;s->last_output=out.st_mtime>err.st_mtime?out.st_mtime:err.st_mtime;
 char *line=NULL;size_t capacity=0;ssize_t n;unsigned long long scanned=0;
 while(scanned<=64ULL*1024*1024&&(n=getline(&line,&capacity,f))>0){scanned+=(unsigned long long)n;
  if(line[0]!='{'||!strstr(line,"\"type\":\"progress\""))continue;
  line[strcspn(line,"\r\n")]=0;
  const char *names[]={"type","sequence","useful","state"};char type[16],state[32]="WORKING";int64_t sequence=-1;int useful=0,known=0,field;
  int ok=n<=65536&&hf_json_parse(j,line)&&hf_json_only(j,0,names,4)&&hf_json_get(j,"type",type,sizeof type)&&!strcmp(type,"progress")&&hf_json_i64(j,hf_json_field(j,0,"sequence"),&sequence)&&sequence>=0&&hf_json_bool(j,hf_json_field(j,0,"useful"),&useful);
  if(ok&&(field=hf_json_field(j,0,"state"))>=0)ok=hf_json_string(j,field,state,sizeof state);
  for(unsigned k=0;ok&&k<sizeof progress_states/sizeof *progress_states;++k)known|=!strcmp(state,progress_states[k]);
  if(!ok||!known){++s->invalid;continue;}
  ++s->events;snprintf(s->last_state,sizeof s->last_state,"%s",state);s->last_useful=0;
  if(!useful)++s->noop;else if(sequence<=s->max_sequence)++s->repeated;else{++s->useful;s->max_sequence=sequence;s->last_useful=1;}
 }
 free(line);fclose(f);
}
static int state_in(const char *state,const char *const *list,size_t n){for(size_t k=0;k<n;++k)if(!strcmp(state,list[k]))return 1;return 0;}
/* Reads {"pid":N,"start_time":"S"} items; returns -1 when malformed. */
static int identity_items(const HfJson *j,const char *name,HfProcessIdentity *items,int capacity){
 int array=hf_json_field(j,0,name),count=0;if(array<0)return 0;if(j->tokens[array].type!='[')return -1;
 const char *names[]={"pid","start_time"};
 for(int item=array+1;item<j->tokens[array].next;item=j->tokens[item].next){
  int64_t pid=0;char start[32],*end=NULL;if(count==capacity||j->tokens[item].type!='{'||!hf_json_only(j,item,names,2)||!hf_json_i64(j,hf_json_field(j,item,"pid"),&pid)||pid<=0||pid>INT_MAX||!hf_json_string(j,hf_json_field(j,item,"start_time"),start,sizeof start))return -1;
  errno=0;unsigned long long value=strtoull(start,&end,10);if(errno||!*start||*end||!value)return -1;
  memset(&items[count],0,sizeof *items);items[count].pid=(pid_t)pid;items[count].start_time=value;++count;
 }
 return count;
}
static const char *identity_status(const HfProcessIdentity *expected,const char *boot){
 HfProcessIdentity now;if(!hf_process_identity(expected->pid,&now)||now.state=='Z'||now.state=='X')return "EXITED";
 return now.start_time!=expected->start_time||strcmp(now.os_boot_id,boot)?"PID_REUSED":"EXACT_PRESENT";
}
static void identity_report(FILE *out,const char *name,const HfProcessIdentity *items,int count,const char *boot){
 fprintf(out,",\"%s\":[",name);
 for(int k=0;k<count;++k)fprintf(out,"%s{\"pid\":%ld,\"start_time\":\"%llu\",\"os_boot_id\":\"%s\",\"status\":\"%s\"}",k?",":"",(long)items[k].pid,items[k].start_time,boot,identity_status(&items[k],boot));
 fputc(']',out);
}
static const char *const relation_names[]={"","AGENT","DESCENDANT","ADOPTED_BY_BROKER","ESCAPED"};
static void cgroup_value(FILE *out,const char *dir,const char *file,const char *key){
 char path[4400],value[128];snprintf(path,sizeof path,"%s/%s",dir,file);fprintf(out,",\"%s\":",key);if(read_small(path,value,sizeof value))hf_json_write_string(out,value);else fputs("null",out);
}
static int cgroup_events(const char *dir,const char *file,const char *key,long long *value){char path[4400],text[1024];snprintf(path,sizeof path,"%s/%s",dir,file);*value=read_small(path,text,sizeof text)?keyed(text,key):-1;return *value>=0;}
static int cgroup_number(const char *dir,const char *file,unsigned long long *value,int *unlimited){
 char path[4400],text[128],*end=NULL;snprintf(path,sizeof path,"%s/%s",dir,file);if(!read_small(path,text,sizeof text))return 0;
 *unlimited=!strncmp(text,"max",3);if(*unlimited)return 1;errno=0;*value=strtoull(text,&end,10);return !errno&&end!=text;
}
static void limits_report(FILE *out,const HfProcessTree *t,int *saturated_any){
 char scope[4096]="",dir[4200]="";struct statfs fs;
 pid_t anchor=t->agent_index>=0?t->members[t->agent_index].process.pid:t->count?t->members[0].process.pid:0;
 int cgroup=anchor&&!statfs("/sys/fs/cgroup",&fs)&&fs.f_type==0x63677270&&cgroup_of(anchor,scope,sizeof scope)&&strcmp(scope,"/");
 if(cgroup)snprintf(dir,sizeof dir,"/sys/fs/cgroup%s",scope);
 const char *dimensions[6];int saturated=0;
 fprintf(out,",\"limits\":{\"scope\":\"%s\",\"applies_to\":\"COMPLETE_JOB_TREE\",\"cgroup\":",cgroup?"CGROUP_V2":t->count?"PROCESS_RLIMITS_ONLY":"NO_LIVE_PROCESS");
 if(!cgroup)fputs("null",out);else{
  int outside=0;for(int k=0;k<t->count;++k){char path[4096];if(!cgroup_of(t->members[k].process.pid,path,sizeof path)||!cgroup_within(path,scope))++outside;}
  fputs("{\"path\":",out);hf_json_write_string(out,scope);fprintf(out,",\"covers_all_accountable\":%s,\"outside_job_cgroup\":%d",outside?"false":"true",outside);
  unsigned long long max=0,current=0;int unlimited=0,have_max,have_current;long long events,oom,oom_kill,throttled;
  have_max=cgroup_number(dir,"pids.max",&max,&unlimited);have_current=cgroup_number(dir,"pids.current",&current,&(int){0});cgroup_events(dir,"pids.events","max",&events);
  int pids_saturated=have_max&&!unlimited&&((have_current&&current>=max)||events>0);
  fprintf(out,",\"pids\":{\"available\":%s",have_max?"true":"false");cgroup_value(out,dir,"pids.max","max");cgroup_value(out,dir,"pids.current","current");fprintf(out,",\"limit_events\":%lld,\"saturated\":%s}",events,pids_saturated?"true":"false");
  if(pids_saturated)dimensions[saturated++]="cgroup.pids";
  have_max=cgroup_number(dir,"memory.max",&max,&unlimited);have_current=cgroup_number(dir,"memory.current",&current,&(int){0});
  cgroup_events(dir,"memory.events","max",&events);cgroup_events(dir,"memory.events","oom",&oom);cgroup_events(dir,"memory.events","oom_kill",&oom_kill);
  int memory_saturated=have_max&&!unlimited&&((have_current&&current>=max)||events>0||oom>0||oom_kill>0);
  fprintf(out,",\"memory\":{\"available\":%s",have_max?"true":"false");cgroup_value(out,dir,"memory.max","max");cgroup_value(out,dir,"memory.current","current");cgroup_value(out,dir,"memory.swap.max","swap_max");
  fprintf(out,",\"limit_events\":%lld,\"oom_events\":%lld,\"oom_kills\":%lld,\"saturated\":%s}",events,oom,oom_kill,memory_saturated?"true":"false");
  if(memory_saturated)dimensions[saturated++]="cgroup.memory";
  char path[4400],quota[128]="";snprintf(path,sizeof path,"%s/cpu.max",dir);int have_cpu=read_small(path,quota,sizeof quota);cgroup_events(dir,"cpu.stat","nr_throttled",&throttled);
  long long usage;cgroup_events(dir,"cpu.stat","usage_usec",&usage);int cpu_saturated=have_cpu&&strncmp(quota,"max",3)&&throttled>0;
  fprintf(out,",\"cpu\":{\"available\":%s",have_cpu?"true":"false");cgroup_value(out,dir,"cpu.max","max");fprintf(out,",\"usage_usec\":%lld,\"throttled_periods\":%lld,\"saturated\":%s}}",usage,throttled,cpu_saturated?"true":"false");
  if(cpu_saturated)dimensions[saturated++]="cgroup.cpu";
 }
 /* RLIMIT_NPROC counts every task of the slot UID, so compare all slot-owned threads. */
 unsigned long long nproc=ULLONG_MAX,address=ULLONG_MAX,largest=0;long tasks=0;int readable=1;
 for(int k=0;k<t->count;++k){const HfTreeMember *m=&t->members[k];char value[64];if(!m->uid_changed)tasks+=m->threads;if(m->process.virtual_bytes>largest)largest=m->process.virtual_bytes;
  if(!limit_line(m->process.pid,"Max processes",value,sizeof value)){readable=0;continue;}if(!m->uid_changed&&strcmp(value,"unlimited")&&strtoull(value,NULL,10)<nproc)nproc=strtoull(value,NULL,10);
  if(limit_line(m->process.pid,"Max address space",value,sizeof value)&&strcmp(value,"unlimited")&&strtoull(value,NULL,10)<address)address=strtoull(value,NULL,10);}
 int nproc_saturated=nproc!=ULLONG_MAX&&(unsigned long long)tasks>=nproc,address_saturated=address!=ULLONG_MAX&&largest>=address;
 if(nproc_saturated)dimensions[saturated++]="rlimit.nproc";
 if(address_saturated)dimensions[saturated++]="rlimit.address_space";
 fputs(",\"rlimits\":{\"nproc_soft_min\":",out);if(nproc==ULLONG_MAX)fputs("\"unlimited\"",out);else fprintf(out,"\"%llu\"",nproc);
 fprintf(out,",\"slot_tasks_in_use\":%ld,\"nproc_saturated\":%s,\"address_space_soft_min\":",tasks,nproc_saturated?"true":"false");if(address==ULLONG_MAX)fputs("\"unlimited\"",out);else fprintf(out,"\"%llu\"",address);
 fprintf(out,",\"largest_virtual_bytes\":\"%llu\",\"address_space_saturated\":%s,\"complete\":%s},\"saturated\":%s,\"saturated_dimensions\":[",largest,address_saturated?"true":"false",readable?"true":"false",saturated?"true":"false");
 for(int k=0;k<saturated;++k){if(k)fputc(',',out);hf_json_write_string(out,dimensions[k]);}fputs("]}",out);*saturated_any=saturated>0;
}
/* Bounded launch.status RPC to the 12.2 broker; the payload carries only binding fields. */
static void ipc_report(FILE *out,const HfRunnerBinding *b,const HfJson *j){
 char path[4200];struct stat st;snprintf(path,sizeof path,"%s/%s.sock",b->state_dir,b->launch_id);
 const char *health="BROKER_SOCKET_ABSENT";char reported[32]="";
 if(!lstat(path,&st)&&S_ISSOCK(st.st_mode)){
  const char *fields[]={"launch_id","attempt_id","attempt_generation","sandbox_id","boot_id","boot_generation"};char *payload=NULL,*reply=NULL;size_t n=0,m=0;FILE *p=open_memstream(&payload,&n),*r=NULL;
  if(p){fputc('{',p);for(unsigned k=0;k<6;++k){char value[128]="";hf_json_get(j,fields[k],value,sizeof value);fprintf(p,"%s\"%s\":",k?",":"",fields[k]);hf_json_write_string(p,value);}fputc('}',p);fclose(p);}
  r=payload?open_memstream(&reply,&m):NULL;int rc=r?hf_launch_rpc(b->state_dir,"launch.status",payload,r):1;if(r)fclose(r);
  HfJson *response=malloc(sizeof *response);char launch[37]="";
  if(rc)health="UNRESPONSIVE";else if(response&&reply&&hf_json_parse(response,reply)&&hf_json_get(response,"launch_id",launch,sizeof launch)&&!strcmp(launch,b->launch_id)){health="RESPONSIVE";hf_json_get(response,"state",reported,sizeof reported);}else health="UNEXPECTED_RESPONSE";
  free(response);free(payload);free(reply);
 }
 fprintf(out,",\"ipc_health\":\"%s\",\"broker_reported_state\":",health);if(*reported)hf_json_write_string(out,reported);else fputs("null",out);
}
int hf_component_12_3(const char *action,const char *request,FILE *out) {
 if(strcmp(action,"process_tree.observe"))return hf_native_error(out,"UNKNOWN_ACTION");
 HfJson *j=malloc(sizeof *j);const char *allowed[]={"state_dir","launch_id","attempt_id","attempt_generation","sandbox_id","boot_id","boot_generation","progress_baseline","tracked","native_children","stall_after_seconds"};
 if(!j||!hf_json_parse(j,request)||!hf_json_only(j,0,allowed,sizeof allowed/sizeof *allowed)){free(j);return hf_native_error(out,"INVALID_REQUEST");}
 HfRunnerBinding binding;
 if(!hf_runner_binding(request,&binding)){free(j);return hf_native_error(out,"IDENTITY_MISMATCH");}
 int64_t base_out=-1,base_err=-1,base_sequence=-1,stall=0;int baseline=hf_json_field(j,0,"progress_baseline"),field=hf_json_field(j,0,"stall_after_seconds");
 const char *base_names[]={"stdout_bytes","stderr_bytes","sequence"};
 int ok=(baseline<0||(j->tokens[baseline].type=='{'&&hf_json_only(j,baseline,base_names,3)&&hf_json_i64(j,hf_json_field(j,baseline,"stdout_bytes"),&base_out)&&hf_json_i64(j,hf_json_field(j,baseline,"stderr_bytes"),&base_err)&&hf_json_i64(j,hf_json_field(j,baseline,"sequence"),&base_sequence)&&base_out>=0&&base_err>=0&&base_sequence>=-1))
  &&(field<0||(hf_json_i64(j,field,&stall)&&stall>0&&stall<=86400));
 HfProcessIdentity *tracked=malloc(2048*sizeof *tracked),*children=tracked?tracked+1024:NULL;int tracked_count=tracked?identity_items(j,"tracked",tracked,1024):-1,child_count=tracked?identity_items(j,"native_children",children,1024):-1;
 HfProcessTree *t=malloc(sizeof *t);
 if(!ok||tracked_count<0||child_count<0||!t){free(j);free(tracked);free(t);return hf_native_error(out,"INVALID_REQUEST");}
 int count=hf_process_tree_inventory(&binding,t);if(count<0){free(j);free(tracked);free(t);return hf_native_error(out,"PROCESS_INVENTORY_INCOMPLETE");}
 int counts[5]={0},undeclared=0;unsigned long long virtual_bytes=0,tree_ticks=0,outside_ticks=0;long resident=0,tree_resident=0,outside_resident=0;pid_t agent_session=-1,agent_group=-1;
 if(t->agent_index>=0){agent_session=t->members[t->agent_index].session;agent_group=t->members[t->agent_index].process.pgid;}
 for(int k=0;k<count;++k){HfTreeMember *m=&t->members[k];for(int c=0;c<child_count;++c)if(children[c].pid==m->process.pid&&children[c].start_time==m->process.start_time)m->native_child=1;
  ++counts[m->relation];if(m->relation!=HF_TREE_AGENT&&!m->native_child)++undeclared;virtual_bytes+=m->process.virtual_bytes;resident+=m->process.resident_pages;
  if(m->relation<=HF_TREE_DESCENDANT){tree_ticks+=m->cpu_ticks;tree_resident+=m->process.resident_pages;}else{outside_ticks+=m->cpu_ticks;outside_resident+=m->process.resident_pages;}}
 HfProcessIdentity agent={.pid=binding.agent_pid,.start_time=binding.agent_start};const char *agent_liveness=identity_status(&agent,binding.os_boot_id);
 if(!strcmp(agent_liveness,"EXACT_PRESENT")&&t->agent_index<0)agent_liveness="IDENTITY_CHANGED";
 HfProcessIdentity broker={.pid=binding.broker_pid,.start_time=binding.broker_start};
 fprintf(out,"{\"launch_id\":\"%s\",\"tree_scope\":\"AGENT_TREE_AND_DEDICATED_SLOT_UID\",\"os_liveness\":\"%s\",\"agent_liveness\":\"%s\",\"broker_liveness\":\"%s\",\"ledger_state\":",binding.launch_id,count?"PRESENT":"QUIESCENT",agent_liveness,identity_status(&broker,binding.os_boot_id));
 hf_json_write_string(out,binding.state);ipc_report(out,&binding,j);
 fputs(",\"sandbox_reachability\":{\"status\":\"UNOBSERVED_BY_SUPERVISOR\",\"reason\":\"Reachability is observed by the controller over the authenticated transport, never from inside the sandbox\"}",out);
 fputs(",\"assurance_validity\":{\"status\":\"UNOBSERVED_BY_SUPERVISOR\",\"reason\":\"Assurance validity is decided by the primary API from signed evidence; local liveness or progress cannot establish it\"}",out);
 fputs(",\"authority_renewed\":false,\"processes\":[",out);
 for(int k=0;k<count;++k){if(k)fputc(',',out);hf_process_json(out,&t->members[k].process);}
 fputs("],\"tree\":[",out);
 for(int k=0;k<count;++k){const HfTreeMember *m=&t->members[k];if(k)fputc(',',out);fputs("{\"process\":",out);hf_process_json(out,&m->process);
  fprintf(out,",\"relation\":\"%s\",\"depth\":%d,\"session_id\":%ld,\"left_session\":%s,\"left_process_group\":%s,\"uid_changed\":%s,\"native_child_agent\":%s,\"threads\":%ld,\"cpu_ticks\":\"%llu\"}",relation_names[m->relation],m->depth,(long)m->session,
   agent_session>=0&&m->session!=agent_session?"true":"false",agent_group>=0&&m->process.pgid!=agent_group?"true":"false",m->uid_changed?"true":"false",m->native_child?"true":"false",m->threads,m->cpu_ticks);}
 fprintf(out,"],\"accounting\":{\"accountable_processes\":%d,\"agent\":%d,\"descendants\":%d,\"adopted_by_broker\":%d,\"escaped\":%d,\"undeclared_non_agent\":%d,\"inventory_raced\":%d,\"cancellation_scope\":\"ALL_ACCOUNTABLE_EXACT_IDENTITIES\",\"tree_cpu_ticks\":\"%llu\",\"outside_tree_cpu_ticks\":\"%llu\",\"tree_resident_pages\":%ld,\"outside_tree_resident_pages\":%ld}",
  count,counts[HF_TREE_AGENT],counts[HF_TREE_DESCENDANT],counts[HF_TREE_ADOPTED],counts[HF_TREE_ESCAPED],undeclared,t->raced,tree_ticks,outside_ticks,tree_resident,outside_resident);
 identity_report(out,"tracked",tracked,tracked_count,binding.os_boot_id);identity_report(out,"native_children",children,child_count,binding.os_boot_id);
 int saturated=0;limits_report(out,t,&saturated);
 ProgressScan s;progress_scan(&binding,j,&s);time_t now=time(NULL);long long idle=s.available&&now>=s.last_output?(long long)(now-s.last_output):-1;
 int advanced=baseline>=0?s.max_sequence>base_sequence:s.useful>0,grew=baseline>=0&&s.available&&(s.stdout_bytes>(unsigned long long)base_out||s.stderr_bytes>(unsigned long long)base_err);
 const char *waiting[]={"MODEL_WAITING","BUILD_WAITING","TOOL_WAITING"},*errors[]={"MODEL_ERROR","TOOL_ERROR","AUTH_FAILED","RATE_LIMITED","QUOTA_EXHAUSTED"};
 const char *progress=!s.available?"UNOBSERVABLE":baseline>=0?(advanced?"ADVANCED":"NOT_ADVANCED"):(advanced?"OBSERVED":"NONE_OBSERVED");
 char execution[48];
 if(!count)snprintf(execution,sizeof execution,"QUIESCENT");
 else if(s.events&&!s.last_useful&&state_in(s.last_state,waiting,3))snprintf(execution,sizeof execution,"%s",s.last_state);
 else if(s.events&&!s.last_useful&&state_in(s.last_state,errors,5))snprintf(execution,sizeof execution,"REPORTED_%s",s.last_state);
 else if(advanced&&s.available)snprintf(execution,sizeof execution,"PROGRESSING");
 else if(grew)snprintf(execution,sizeof execution,"ACTIVE_NO_PROGRESS");
 else if(stall>0&&idle>=stall)snprintf(execution,sizeof execution,"STALLED");
 else snprintf(execution,sizeof execution,"IDLE_ALIVE");
 fprintf(out,",\"useful_progress\":\"%s\",\"execution_state\":\"%s\",\"progress\":{\"source\":\"STRUCTURED_EVENTS_IN_BROKER_STDOUT_SPOOL\",\"self_reported\":true,\"spool_available\":%s,\"stdout_bytes\":\"%llu\",\"stderr_bytes\":\"%llu\",\"output_grew\":%s,\"seconds_since_output\":%lld,"
  "\"events\":%lld,\"useful_events\":%lld,\"noop_events\":%lld,\"repeated_events\":%lld,\"invalid_events\":%lld,\"max_useful_sequence\":%lld,\"last_reported_state\":\"%s\",\"success_inferred\":false},\"progress_baseline_next\":{\"stdout_bytes\":%llu,\"stderr_bytes\":%llu,\"sequence\":%lld}",
  progress,execution,s.available?"true":"false",s.stdout_bytes,s.stderr_bytes,baseline<0?"null":grew?"true":"false",idle,s.events,s.useful,s.noop,s.repeated,s.invalid,s.max_sequence,s.last_state,s.stdout_bytes,s.stderr_bytes,s.max_sequence);
 fprintf(out,",\"exact_agent_observed\":%s,\"virtual_bytes\":\"%llu\",\"resident_pages\":%ld,\"limits_saturated\":%s,\"progress_must_be_measured_separately\":true}",t->agent_index>=0?"true":"false",virtual_bytes,resident,saturated?"true":"false");
 free(j);free(tracked);free(t);return 0;
}
