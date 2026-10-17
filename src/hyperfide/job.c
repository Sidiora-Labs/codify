#define _GNU_SOURCE
#include "components.h"
#include "supervisor.h"
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <poll.h>
#include <signal.h>
#include <sqlite3.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include <openssl/evp.h>

#define JOB_STREAM_LIMIT (64U*1024U)
#define JOB_ARTIFACT_LIMIT (128U*1024U)
extern int hf_component_11_3(const char *,const char *,FILE *) __attribute__((weak));
static long long mono(void){struct timespec t;if(clock_gettime(CLOCK_MONOTONIC,&t))return -1;return (long long)t.tv_sec*1000000000LL+t.tv_nsec;}
static int utc_now(char result[40]){struct timespec now;struct tm tm;if(clock_gettime(CLOCK_REALTIME,&now)||!gmtime_r(&now.tv_sec,&tm))return 0;size_t n=strftime(result,40,"%Y-%m-%dT%H:%M:%S",&tm);return n&&snprintf(result+n,40-n,".%03ldZ",now.tv_nsec/1000000)>0;}
static int string_at(const HfJson *j,int object,const char *name,char *out,size_t n){return hf_json_string(j,hf_json_field(j,object,name),out,n);}
static int relative(const char *s){if(!s||!*s||*s=='/'||strchr(s,'\\'))return 0;const char *p=s;while(*p){const char *end=strchr(p,'/');size_t n=end?(size_t)(end-p):strlen(p);if(!n||(n==1&&p[0]=='.')||(n==2&&p[0]=='.'&&p[1]=='.'))return 0;for(size_t k=0;k<n;++k)if((unsigned char)p[k]<32)return 0;if(!end)break;p=end+1;}return 1;}
static int open_beneath(int root,const char *path,int directory){
 if(!relative(path))return -1;
 char *copy=strdup(path),*save=NULL;int fd=dup(root);if(!copy||fd<0){free(copy);if(fd>=0)close(fd);return -1;}
 for(char *p=strtok_r(copy,"/",&save);p;p=strtok_r(NULL,"/",&save)){int last=save&&!*save;int next=openat(fd,p,O_RDONLY|O_CLOEXEC|O_NOFOLLOW|((!last||directory)?O_DIRECTORY:0));close(fd);fd=next;if(fd<0)break;}free(copy);return fd;
}
static char *standard64(const unsigned char *data,size_t n){if(n>JOB_ARTIFACT_LIMIT)return NULL;size_t capacity=((n+2)/3)*4+1;char *out=malloc(capacity);if(!out)return NULL;int result=EVP_EncodeBlock((unsigned char*)out,data,(int)n);if(result<0){free(out);return NULL;}out[result]=0;return out;}
static int fd_hash(int fd,char out[65]){
 unsigned char buffer[65536],digest[32];unsigned length=0;EVP_MD_CTX *ctx=EVP_MD_CTX_new();int ok=ctx&&EVP_DigestInit_ex(ctx,EVP_sha256(),NULL)==1;ssize_t n=0;
 while(ok&&(n=read(fd,buffer,sizeof buffer))>0)ok=EVP_DigestUpdate(ctx,buffer,(size_t)n)==1;
 ok=ok&&n==0&&EVP_DigestFinal_ex(ctx,digest,&length)==1&&length==32;EVP_MD_CTX_free(ctx);
 if(ok){for(unsigned k=0;k<32;++k)snprintf(out+k*2,3,"%02x",digest[k]);ok=lseek(fd,0,SEEK_SET)==0;}return ok;
}
static int no_processes(uid_t uid,HfProcessIdentity *list,size_t *count){
 DIR *dir=opendir("/proc");if(!dir)return 0;struct dirent *entry;*count=0;int complete=1;
 while((entry=readdir(dir))){char *end=NULL;long pid=strtol(entry->d_name,&end,10);if(*end||pid<=0||pid>2147483647)continue;HfProcessIdentity p;
  if(hf_process_identity((pid_t)pid,&p)&&p.uid==uid&&p.state!='Z'&&p.state!='X'){if(*count==1024){complete=0;break;}list[(*count)++]=p;}}
 closedir(dir);return complete;
}
static int terminate_uid(uid_t uid){
 struct timespec delay={.tv_nsec=10000000};
 for(int pass=0;pass<100;++pass){HfProcessIdentity list[1024];size_t count=0;if(!no_processes(uid,list,&count))return 0;if(!count)return 1;
  for(size_t k=0;k<count;++k)if(hf_process_matches(&list[k],NULL)&&kill(list[k].pid,pass<2?SIGTERM:SIGKILL)&&errno!=ESRCH)return 0;
  nanosleep(&delay,NULL);
 }return 0;
}
static int trusted_environment(const char *config_path){
 char *raw=NULL,*env_raw=NULL;size_t n=0;HfJson *config=malloc(sizeof *config),*env=malloc(sizeof *env);char file[4096];
 int ok=config&&env&&hf_private_read(config_path,65536,&raw,&n)&&hf_json_parse(config,raw)&&hf_json_get(config,"readiness_env_path",file,sizeof file)&&hf_private_read(file,65536,&env_raw,&n)&&hf_json_parse(env,env_raw);
 const char *allowed[]={"HF_PREPARATION_WORKSPACE_ROOT","HF_PREPARATION_BASE_ROOT","HF_PREPARATION_MANIFEST_ROOT","HF_READINESS_MODULE_PATH","HF_READINESS_MODULE_DIGEST","HF_READINESS_NODE_EXECUTABLE","HF_READINESS_NODE_DIGEST","HF_READINESS_SCAN_POLICY_FILE","HF_READINESS_TOOL_BINDINGS_FILE","HF_CREDENTIAL_AVAILABILITY_FILE","HF_INVOCATION_SCOPE_FILE","HF_READINESS_DIAGNOSTICS_ROOT","HF_READINESS_WORKSPACE_MANIFEST_FILE","HF_RUNNER_WORKSPACE_DIGEST"};
 if(ok)ok=hf_json_only(env,0,allowed,sizeof allowed/sizeof allowed[0]);
 if(ok)ok=clearenv()==0&&setenv("PATH","/usr/local/bin:/usr/bin:/bin",1)==0;
 for(unsigned k=0;ok&&k<sizeof allowed/sizeof allowed[0];++k){int t=hf_json_field(env,0,allowed[k]);char value[4096];if(t>=0)ok=hf_json_string(env,t,value,sizeof value)&&setenv(allowed[k],value,1)==0;}
 free(raw);free(env_raw);free(config);free(env);return ok;
}
typedef struct {char commit[65],tree[65],state[72],workspace[72];} MeasuredSource;
static int readiness_unprivileged(const HfJson *job,int result,MeasuredSource *measured){
 if(geteuid()==0)return 0;
 int ready=hf_json_field(job,result,"readiness"),binding=hf_json_field(job,result,"binding");
 char boot[37],profile[72],preparation[72],expected_state[72],expected_workspace[72];
 if(!hf_component_11_3||ready<0||binding<0||!string_at(job,binding,"boot_id",boot,sizeof boot)||!string_at(job,ready,"profile_digest",profile,sizeof profile)||!string_at(job,ready,"preparation_digest",preparation,sizeof preparation)||!string_at(job,ready,"source_state_digest",expected_state,sizeof expected_state)||!string_at(job,ready,"workspace_digest",expected_workspace,sizeof expected_workspace))return 0;
 if(setenv("HF_EXECUTION_HOST_CLASS","remote",1)||setenv("HF_SANDBOX_BOOT_ID",boot,1)||setenv("HF_RUNNER_PROFILE_DIGEST",profile,1)||setenv("HF_RUNNER_PREPARATION_DIGEST",preparation,1))return 0;
 char *request=hf_json_raw(job,hf_json_field(job,ready,"readiness_input")),*output=NULL;size_t n=0;FILE *stream=open_memstream(&output,&n);int code=request&&stream?hf_component_11_3("environment.readiness",request,stream):1;if(stream&&fclose(stream))code=1;free(request);
 HfJson *observed=malloc(sizeof *observed);char actual[128];int authority=1;
 int ok=!code&&output&&observed&&hf_json_parse(observed,output)&&hf_json_get(observed,"state",actual,sizeof actual)&&!strcmp(actual,"READY")&&
 hf_json_get(observed,"boot_id",actual,sizeof actual)&&!strcmp(actual,boot)&&hf_json_get(observed,"profile_digest",actual,sizeof actual)&&!strcmp(actual,profile)&&hf_json_get(observed,"preparation_digest",actual,sizeof actual)&&!strcmp(actual,preparation)&&
 hf_json_get(observed,"source_state_digest",actual,sizeof actual)&&!strcmp(actual,expected_state)&&hf_json_get(observed,"workspace_digest",actual,sizeof actual)&&!strcmp(actual,expected_workspace)&&hf_json_bool(observed,hf_json_field(observed,0,"authority_granted"),&authority)&&!authority;
 if(ok){
  int sources=hf_json_field(observed,0,"source_bindings"),ready_key=hf_json_field(job,ready,"source_repository_key");char wanted_key[256],key[256],commit[65],tree[65],wanted_commit[65],wanted_tree[65];int matches=0;
  ok=sources>=0&&observed->tokens[sources].type=='['&&hf_json_string(job,ready_key,wanted_key,sizeof wanted_key)&&string_at(job,binding,"source_object_id",wanted_commit,sizeof wanted_commit)&&string_at(job,binding,"source_tree_id",wanted_tree,sizeof wanted_tree);
  if(ok)for(int t=sources+1;t<observed->tokens[sources].next;t=observed->tokens[t].next){
   if(string_at(observed,t,"id",key,sizeof key)&&!strcmp(key,wanted_key)){++matches;if(!string_at(observed,t,"commit",commit,sizeof commit)||!string_at(observed,t,"tree",tree,sizeof tree)||strcmp(commit,wanted_commit)||strcmp(tree,wanted_tree)){ok=0;break;}snprintf(measured->commit,sizeof measured->commit,"%s",commit);snprintf(measured->tree,sizeof measured->tree,"%s",tree);}
  }
  ok=ok&&matches==1;if(ok){snprintf(measured->state,sizeof measured->state,"%s",expected_state);snprintf(measured->workspace,sizeof measured->workspace,"%s",expected_workspace);}
 }
 free(output);free(observed);return ok;
}

/* Read configuration under the supervisor identity; all filesystem/tool/network
 * probes run after the dedicated slot UID is dropped. The probe owns the same
 * UID-generation lock as work and must leave that UID quiescent before return. */
static int readiness(const HfJson *job,int result,const char *config_path,MeasuredSource *measured,
                     uid_t uid,gid_t gid,long long deadline,const char *operation){
 if(!trusted_environment(config_path)||mono()>=deadline)return 0;
 int descriptor[2],watch_writer=-1;if(pipe2(descriptor,O_CLOEXEC))return 0;
 pid_t watchdog=hf_slot_watchdog(uid,deadline,&watch_writer,operation);
 if(watchdog<0){close(descriptor[0]);close(descriptor[1]);return 0;}
 HfProcessIdentity list[1024];size_t count=0;
 if(!no_processes(uid,list,&count)||count){close(descriptor[0]);close(descriptor[1]);hf_slot_watchdog_finish(watchdog,&watch_writer);return 0;}
 int binding=hf_json_field(job,result,"binding");char home[4096],tmp[4096];
 if(!string_at(job,binding,"home_path",home,sizeof home)||!string_at(job,binding,"tmp_path",tmp,sizeof tmp)){
  close(descriptor[0]);close(descriptor[1]);hf_slot_watchdog_finish(watchdog,&watch_writer);return 0;
 }
 if(prctl(PR_SET_CHILD_SUBREAPER,1)){close(descriptor[0]);close(descriptor[1]);hf_slot_watchdog_finish(watchdog,&watch_writer);return 0;}
 pid_t supervisor=getpid(),child=fork();
 if(child==0){
  close(descriptor[0]);if(descriptor[1]!=3&&dup3(descriptor[1],3,O_CLOEXEC)<0)_exit(125);
  if(close_range(4,~0U,0)||setgroups(0,NULL)||setgid(gid)||setuid(uid)||
     prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0)||prctl(PR_SET_PDEATHSIG,SIGKILL)||getppid()!=supervisor||
     setenv("HOME",home,1)||setenv("TMPDIR",tmp,1))_exit(125);
  MeasuredSource actual={0};int good=readiness_unprivileged(job,result,&actual);
  if(good&&write(3,&actual,sizeof actual)!=(ssize_t)sizeof actual)good=0;
  _exit(good?0:1);
 }
 close(descriptor[1]);fcntl(descriptor[0],F_SETFL,O_NONBLOCK);
 size_t used=0;int status=0,finished=0,ok=child>0;
 while(ok&&!finished&&mono()<deadline){
  ssize_t n=read(descriptor[0],((unsigned char*)measured)+used,sizeof *measured-used);
  if(n>0)used+=(size_t)n;
  else if(n<0&&errno!=EAGAIN&&errno!=EINTR)ok=0;
  pid_t observed=waitpid(child,&status,WNOHANG);
  if(observed==child)finished=1;else if(observed<0&&errno!=EINTR)ok=0;
  if(!finished){struct pollfd fd={descriptor[0],POLLIN,0};(void)poll(&fd,1,10);}
 }
 if(child>0&&!finished){(void)kill(child,SIGKILL);while(waitpid(child,&status,0)<0&&errno==EINTR){}}
 if(used<sizeof *measured){ssize_t n=read(descriptor[0],((unsigned char*)measured)+used,sizeof *measured-used);if(n>0)used+=(size_t)n;}
 close(descriptor[0]);int absent=terminate_uid(uid);
 int stopped=hf_slot_watchdog_finish(watchdog,&watch_writer);
 while(waitpid(-1,NULL,WNOHANG)>0){}
 return ok&&finished&&WIFEXITED(status)&&WEXITSTATUS(status)==0&&used==sizeof *measured&&absent&&stopped;
}

typedef struct {char *key,*value;} EnvEntry;
static int compare_env(const void *a,const void *b){return strcmp(((const EnvEntry*)a)->key,((const EnvEntry*)b)->key);}
static int environment(const HfJson *j,int plan,EnvEntry entries[64],int *count,char digest[65]){
 int object=hf_json_field(j,plan,"environment");*count=0;if(object<0||j->tokens[object].type!='{'||j->tokens[object].count>128)return 0;
 for(int t=object+1;t<j->tokens[object].next;){if(*count==64)return 0;int value=t+1;entries[*count].key=calloc(128,1);entries[*count].value=calloc(4096,1);if(!entries[*count].key||!entries[*count].value||!hf_json_string(j,t,entries[*count].key,128)||!hf_json_string(j,value,entries[*count].value,4096))return 0;
  const char *key=entries[*count].key;for(const char *p=key;*p;++p)if(!((*p>='A'&&*p<='Z')||(*p>='0'&&*p<='9')||*p=='_'))return 0;
  if(!*key||!strncmp(key,"LD_",3)||!strncmp(key,"DYLD_",5)||!strncmp(key,"HF_",3)||!strcmp(key,"HOME")||!strcmp(key,"TMPDIR")||!strcmp(key,"PATH"))return 0;
  ++*count;t=j->tokens[value].next;
 }
 qsort(entries,(size_t)*count,sizeof entries[0],compare_env);char *raw=NULL;size_t n=0;FILE *out=open_memstream(&raw,&n);if(!out)return 0;fputc('{',out);
 for(int k=0;k<*count;++k){if(k)fputc(',',out);hf_json_write_string(out,entries[k].key);fputc(':',out);hf_json_write_string(out,entries[k].value);}fputc('}',out);int ok=fclose(out)==0&&hf_sha256_bytes(raw,n,digest);free(raw);return ok;
}
static sqlite3 *job_database(const char *state){
 char path[4200];snprintf(path,sizeof path,"%s/jobs.db",state);struct stat st;if(lstat(state,&st)||!S_ISDIR(st.st_mode)||st.st_uid!=0||(st.st_mode&077))return NULL;
 if(!lstat(path,&st)&&(!S_ISREG(st.st_mode)||st.st_uid!=0||(st.st_mode&077)||st.st_nlink!=1))return NULL;
 sqlite3 *db=NULL;mode_t mask=umask(077);int rc=sqlite3_open_v2(path,&db,SQLITE_OPEN_READWRITE|SQLITE_OPEN_CREATE,NULL);umask(mask);
 if(rc!=SQLITE_OK){sqlite3_close(db);return NULL;}sqlite3_busy_timeout(db,5000);
 if(sqlite3_exec(db,"PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,digest TEXT NOT NULL,state TEXT NOT NULL,uid INTEGER NOT NULL,pid INTEGER,start_time TEXT,os_boot_id TEXT);CREATE UNIQUE INDEX IF NOT EXISTS job_active_uid ON jobs(uid) WHERE state NOT IN('TERMINAL');",NULL,NULL,NULL)!=SQLITE_OK){sqlite3_close(db);return NULL;}return db;
}
static void captured(FILE *out,const unsigned char *bytes,size_t n,int complete){
 char sha[65],*encoded=standard64(bytes,n);if(!encoded||!hf_sha256_bytes(bytes,n,sha)){free(encoded);fputs("null",out);return;}
 fprintf(out,"{\"base64\":\"%s\",\"digest\":\"sha256:%s\",\"size_bytes\":\"%zu\",\"complete\":%s}",encoded,sha,n,complete?"true":"false");free(encoded);
}
/* Dependency preparation is a registered runner tool (policy/placement.ts) that the
 * 12.2 placement helper does not map; authorise it over the same 12.1 transport. */
static int preparation_placement(const char *config){
 HfHttpResponse response={0};HfJson *j=malloc(sizeof *j);int ok=j&&hf_runner_control_api(config,"1.1","placement.runner.authorize","{\"runner_action\":\"runner.preparation.execute\"}",&response)&&response.status>=200&&response.status<300&&response.body&&hf_json_parse(j,response.body);
 int accepted=0,authorized=0,result=ok?hf_json_field(j,0,"result"):-1;char text[128];
 ok=ok&&hf_json_bool(j,hf_json_field(j,0,"ok"),&accepted)&&accepted&&result>=0&&hf_json_bool(j,hf_json_field(j,result,"authorized"),&authorized)&&authorized&&
  string_at(j,result,"runner_action",text,sizeof text)&&!strcmp(text,"runner.preparation.execute")&&string_at(j,result,"job_class",text,sizeof text)&&!strcmp(text,"dependency_preparation")&&
  string_at(j,result,"tool",text,sizeof text)&&!strcmp(text,"native.spawn")&&string_at(j,result,"location",text,sizeof text)&&!strcmp(text,"REMOTE_EXECUTION");
 free(j);hf_http_response_free(&response);return ok;
}
int hf_runner_job_execute(const char *request,FILE *out){
 HfJson *input=malloc(sizeof *input),*job=malloc(sizeof *job);char config[4096],operation[37];const char *keys[]={"config_path","operation_id"};HfHttpResponse response={0};
 int ok=input&&job&&hf_json_parse(input,request)&&hf_json_only(input,0,keys,2)&&hf_json_get(input,"config_path",config,sizeof config)&&hf_json_get(input,"operation_id",operation,sizeof operation)&&hf_uuid_valid(operation)&&geteuid()==0;
 if(!ok){free(input);free(job);return hf_native_error(out,"UNTRUSTED_JOB_TOKEN");}free(input);long long request_started=mono();
 if(!hf_runner_job_claim(config,operation,&response)||!response.body||!hf_json_parse(job,response.body)){hf_http_response_free(&response);free(job);return hf_native_error(out,"CURRENT_JOB_CLAIM_UNAVAILABLE");}
 int result=hf_json_field(job,0,"result"),plan=hf_json_field(job,result,"plan"),binding=hf_json_field(job,result,"binding");char state_dir[4096],workspace[4096],relative_cwd[4096],expected_executable[72],expected_environment[72],plan_digest[72],kind[32]="",slot[37];
 int64_t uid=0,gid=0,timeout=0,remaining=0;char actual_operation[37],job_class[32]="EXECUTION";string_at(job,result,"job_class",job_class,sizeof job_class);int preparing=!strcmp(job_class,"PREPARATION");
 ok=result>=0&&plan>=0&&binding>=0&&string_at(job,result,"operation_id",actual_operation,sizeof actual_operation)&&!strcmp(actual_operation,operation)&&string_at(job,result,"plan_digest",plan_digest,sizeof plan_digest)&&
 string_at(job,binding,"state_dir",state_dir,sizeof state_dir)&&string_at(job,binding,"workspace_path",workspace,sizeof workspace)&&string_at(job,binding,"capacity_kind",kind,sizeof kind)&&string_at(job,binding,"slot_id",slot,sizeof slot)&&
 hf_json_i64(job,hf_json_field(job,binding,"uid"),&uid)&&uid>0&&uid<=UINT32_MAX&&hf_json_i64(job,hf_json_field(job,binding,"gid"),&gid)&&gid>0&&gid<=UINT32_MAX&&
 hf_json_i64(job,hf_json_field(job,plan,"timeout_ms"),&timeout)&&timeout>0&&timeout<=259200000&&hf_json_i64(job,hf_json_field(job,result,"remaining_ms"),&remaining)&&remaining>0&&
 string_at(job,plan,"cwd",relative_cwd,sizeof relative_cwd)&&(!strcmp(relative_cwd,".")||relative(relative_cwd))&&string_at(job,plan,"executable_digest",expected_executable,sizeof expected_executable)&&strlen(expected_executable)==71&&string_at(job,plan,"environment_digest",expected_environment,sizeof expected_environment)&&strlen(expected_environment)==71;
 const char *tool=preparing?"runner.preparation.execute":!strcmp(kind,"TEST")?"runner.test.execute":!strcmp(kind,"REVIEW")?"runner.review.execute":!strcmp(kind,"INTEGRATION")?"runner.integration.execute":!strcmp(kind,"INDEX")?"runner.index.execute":!strcmp(kind,"BUILD")?"runner.build.execute":NULL;
 if(!ok||!tool||!(preparing?preparation_placement(config):hf_runner_job_placement(config,tool))){hf_http_response_free(&response);free(job);return hf_native_error(out,"JOB_SCOPE_OR_PLACEMENT_DENIED");}
 /* Pause/drain/cancel/stop close admission durably before any new job may start on the slot UID. */
 if(hf_runner_admission_closed(state_dir,(uid_t)uid)){hf_http_response_free(&response);free(job);return hf_native_error(out,"JOB_ADMISSION_FENCED");}
 HfProcessIdentity owned[1024];size_t owned_count=0;MeasuredSource measured={0};
 if(!no_processes((uid_t)uid,owned,&owned_count)||owned_count||(!preparing&&!readiness(job,result,config,&measured,(uid_t)uid,(gid_t)gid,request_started+(timeout<remaining?timeout:remaining)*1000000LL,operation))){hf_http_response_free(&response);free(job);return hf_native_error(out,"ACTUAL_WORKSPACE_NOT_READY_OR_SLOT_BUSY");}
 /* Preparation jobs execute only against the privileged immutable stage for this exact claim. */
 HfPreparationStage stage;memset(&stage,0,sizeof stage);
 if(preparing&&!hf_runner_stage_preparation(config,job,result,&stage)){hf_http_response_free(&response);free(job);return hf_native_error(out,"PREPARATION_STAGE_FAILED");}
 /* Preparation creates its absent target beneath the staged slot-owned parent. */
 int root=open(preparing?stage.workspace_parent:workspace,O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW),cwd=-1;struct stat st;if(root>=0&&!fstat(root,&st)&&st.st_uid==(uid_t)uid&&!(st.st_mode&077))cwd=!strcmp(relative_cwd,".")?dup(root):open_beneath(root,relative_cwd,1);
 int array=hf_json_field(job,plan,"argv");char **argv=NULL;int argc=0,binary=-1;char executable[65],environment_digest[65];EnvEntry env[64]={0};int env_count=0;
 ok=cwd>=0&&array>=0&&job->tokens[array].type=='['&&job->tokens[array].count>0&&job->tokens[array].count<=256;
 if(ok){argv=calloc((size_t)job->tokens[array].count+1,sizeof *argv);ok=argv!=NULL;}
 for(int t=array+1;ok&&t<job->tokens[array].next;t=job->tokens[t].next){argv[argc]=calloc(4096,1);ok=argv[argc]&&hf_json_string(job,t,argv[argc],4096);++argc;}
 if(ok&&preparing)ok=argc==4&&!strcmp(argv[2],"--job-context")&&!strcmp(argv[3],stage.context_path)&&!strcmp(argv[0],stage.node_path);
 if(ok&&argv[0][0]=='/')binary=open(argv[0],O_RDONLY|O_CLOEXEC|O_NOFOLLOW);
 ok=ok&&binary>=0&&!fstat(binary,&st)&&S_ISREG(st.st_mode)&&st.st_uid==0&&!(st.st_mode&022)&&fd_hash(binary,executable)&&!strcmp(expected_executable+7,executable)&&environment(job,plan,env,&env_count,environment_digest)&&!strcmp(expected_environment+7,environment_digest);
 int artifacts=hf_json_field(job,plan,"artifact_paths");if(ok)ok=artifacts>=0&&job->tokens[artifacts].type=='['&&job->tokens[artifacts].count<=64;
 for(int t=artifacts+1;ok&&t<job->tokens[artifacts].next;t=job->tokens[t].next){char file[4096];ok=hf_json_string(job,t,file,sizeof file)&&relative(file);if(ok){int existing=open_beneath(cwd,file,0);if(existing>=0){close(existing);ok=0;}}}
 sqlite3 *db=ok?job_database(state_dir):NULL;sqlite3_stmt *q=NULL;char receipt_path[4200];snprintf(receipt_path,sizeof receipt_path,"%s/job-%s.receipt.json",ok?state_dir:"",operation);
 if(ok&&db){int rc=sqlite3_prepare_v2(db,"INSERT INTO jobs(id,digest,state,uid) VALUES(?,?,'INTENT',?)",-1,&q,NULL);if(rc==SQLITE_OK){sqlite3_bind_text(q,1,operation,-1,SQLITE_STATIC);sqlite3_bind_text(q,2,plan_digest,-1,SQLITE_STATIC);sqlite3_bind_int64(q,3,uid);rc=sqlite3_step(q);}sqlite3_finalize(q);ok=rc==SQLITE_DONE;}else ok=0;
 if(!ok){if(binary>=0)close(binary);if(root>=0)close(root);if(cwd>=0)close(cwd);sqlite3_close(db);for(int k=0;k<argc;++k)free(argv[k]);
 free(argv);for(int k=0;k<64;++k){free(env[k].key);free(env[k].value);}hf_http_response_free(&response);free(job);return hf_native_error(out,"IMMUTABLE_JOB_OR_EXECUTABLE_CONFLICT");}
 int pipes_in[2],pipes_out[2],pipes_err[2],gate[2],dropped[2],attach_gate[2];if(pipe2(pipes_in,O_CLOEXEC)||pipe2(pipes_out,O_CLOEXEC)||pipe2(pipes_err,O_CLOEXEC)||pipe2(gate,O_CLOEXEC)||pipe2(dropped,O_CLOEXEC)||pipe2(attach_gate,O_CLOEXEC)){sqlite3_close(db);return hf_native_error(out,"IPC_UNAVAILABLE");}
 /* A held per-boot charge from the authenticated claim is enforced through the
  * delegated cgroup-v2 backend (<state_dir>/budget.json); absence is reported. */
 HfBudgetHandle charge_budget;memset(&charge_budget,0,sizeof charge_budget);charge_budget.root_fd=charge_budget.scope_fd=-1;int budget_status=-2,budget_attached=-2,budget_released=-2;
 {int charge=hf_json_field(job,result,"budget");char *charge_raw=charge>=0?hf_json_raw(job,charge):NULL;
  if(charge_raw&&strcmp(charge_raw,"null")){char budget_config[4200];snprintf(budget_config,sizeof budget_config,"%s/budget.json",state_dir);budget_status=hf_budget_prepare(budget_config,charge_raw,&charge_budget);}
  free(charge_raw);}
 long long budget=timeout<remaining?timeout:remaining,deadline=request_started+budget*1000000LL;int watch_writer=-1;
 pid_t watchdog=hf_slot_watchdog((uid_t)uid,deadline,&watch_writer,operation);if(watchdog<0){sqlite3_close(db);return hf_native_error(out,"JOB_WATCHDOG_UNAVAILABLE");}
 char started_at[40],ended_at[40];long long measured_start=mono();if(!utc_now(started_at)){close(watch_writer);sqlite3_close(db);return hf_native_error(out,"CLOCK_UNAVAILABLE");}
 prctl(PR_SET_CHILD_SUBREAPER,1);signal(SIGPIPE,SIG_IGN);pid_t supervisor=getpid();pid_t child=fork();
 if(child==0){close(gate[1]);close(pipes_in[1]);close(pipes_out[0]);close(pipes_err[0]);close(dropped[0]);close(attach_gate[1]);pid_t parent=supervisor;prctl(PR_SET_PDEATHSIG,SIGKILL);if(getppid()!=parent)_exit(125);setpgid(0,0);char release;
  if(read(gate[0],&release,1)!=1||release!='G')_exit(125);
  if(dup2(pipes_in[0],0)<0||dup2(pipes_out[1],1)<0||dup2(pipes_err[1],2)<0||fchdir(cwd))_exit(125);
  char home[4096],tmp[4096];if(!string_at(job,binding,"home_path",home,sizeof home)||!string_at(job,binding,"tmp_path",tmp,sizeof tmp))_exit(125);
  if(clearenv()||setenv("PATH","/usr/local/bin:/usr/bin:/bin",1)||setenv("HOME",home,1)||setenv("TMPDIR",tmp,1))_exit(125);
  for(int k=0;k<env_count;++k)if(setenv(env[k].key,env[k].value,1))_exit(125);
  if(setgroups(0,NULL)||setgid((gid_t)gid)||setuid((uid_t)uid)||prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0))_exit(125);
  struct rlimit process_limit={512,512},file_limit={512,512};if(setrlimit(RLIMIT_NPROC,&process_limit)||setrlimit(RLIMIT_NOFILE,&file_limit))_exit(125);
  umask(077);if(prctl(PR_SET_PDEATHSIG,SIGKILL)||getppid()!=parent)_exit(125);
  if(binary!=3&&dup3(binary,3,O_CLOEXEC)<0)_exit(125);
  /* Privileges are dropped: the parent attaches this exact identity to the budget cgroup. */
  char attached;if(write(dropped[1],"R",1)!=1||read(attach_gate[0],&attached,1)!=1||attached!='B')_exit(125);
  if(close_range(4,~0U,0))_exit(125);
  fexecve(3,argv,environ);_exit(127);
 }
 close(gate[0]);close(pipes_in[0]);close(pipes_out[1]);close(pipes_err[1]);close(binary);close(dropped[1]);close(attach_gate[0]);HfProcessIdentity identity;ok=child>0&&hf_process_identity(child,&identity);
 if(ok&&sqlite3_prepare_v2(db,"UPDATE jobs SET state='START_RECORDED',pid=?,start_time=?,os_boot_id=? WHERE id=?",-1,&q,NULL)==SQLITE_OK){char start[32];snprintf(start,sizeof start,"%llu",identity.start_time);sqlite3_bind_int(q,1,child);sqlite3_bind_text(q,2,start,-1,SQLITE_TRANSIENT);sqlite3_bind_text(q,3,identity.os_boot_id,-1,SQLITE_STATIC);sqlite3_bind_text(q,4,operation,-1,SQLITE_STATIC);ok=sqlite3_step(q)==SQLITE_DONE;}else ok=0;sqlite3_finalize(q);
 if(!ok||mono()>=deadline||write(gate[1],"G",1)!=1){if(child>0)kill(child,SIGKILL);close(gate[1]);close(dropped[0]);close(attach_gate[1]);terminate_uid((uid_t)uid);if(budget_status==HF_BUDGET_READY)hf_budget_release(&charge_budget);sqlite3_close(db);return hf_native_error(out,"DURABLE_START_FAILED");}close(gate[1]);
 {char ready=0;struct pollfd wait_ready={dropped[0],POLLIN,0};int polled=poll(&wait_ready,1,(int)((deadline-mono())/1000000LL>10000?10000:(deadline-mono())/1000000LL));
  HfProcessIdentity dropped_identity;ok=polled==1&&read(dropped[0],&ready,1)==1&&ready=='R'&&hf_process_identity(child,&dropped_identity)&&dropped_identity.start_time==identity.start_time;
  if(ok)ok=dropped_identity.uid==(uid_t)uid&&dropped_identity.pgid==child&&!strcmp(dropped_identity.os_boot_id,identity.os_boot_id);
  if(ok)identity=dropped_identity;
  if(ok&&budget_status==HF_BUDGET_READY)ok=(budget_attached=hf_budget_attach(&charge_budget,&dropped_identity))==HF_BUDGET_READY;
  if(!ok||write(attach_gate[1],"B",1)!=1){kill(child,SIGKILL);close(dropped[0]);close(attach_gate[1]);terminate_uid((uid_t)uid);hf_slot_watchdog_finish(watchdog,&watch_writer);while(waitpid(-1,NULL,WNOHANG)>0){}if(budget_status==HF_BUDGET_READY)hf_budget_release(&charge_budget);sqlite3_close(db);return hf_native_error(out,budget_status==HF_BUDGET_READY?"BUDGET_ATTACH_FAILED":"PRIVILEGE_DROP_FAILED");}
  close(dropped[0]);close(attach_gate[1]);}
 fcntl(pipes_in[1],F_SETFL,O_NONBLOCK);fcntl(pipes_out[0],F_SETFL,O_NONBLOCK);fcntl(pipes_err[0],F_SETFL,O_NONBLOCK);
 unsigned char *stdout_bytes=malloc(JOB_STREAM_LIMIT),*stderr_bytes=malloc(JOB_STREAM_LIMIT);size_t sizes[2]={0,0};int eof[2]={0,0},timed_out=0,interrupted=0,truncated=0,exit_code=-1,signal_number=0,finished=0,input_open=1;
 int input_token=hf_json_field(job,plan,"stdin");char *stdin_bytes=NULL;size_t input_length=0,input_offset=0;
 if(input_token>=0){stdin_bytes=malloc(65537);if(stdin_bytes&&hf_json_string(job,input_token,stdin_bytes,65537))input_length=strlen(stdin_bytes);else interrupted=1;}
 if(!input_length){close(pipes_in[1]);input_open=0;}
 long long cleanup_deadline=deadline+3000000000LL;
 while(!finished||!eof[0]||!eof[1]){
  if(mono()>=deadline&&!timed_out){timed_out=1;interrupted=1;terminate_uid((uid_t)uid);}
  if(timed_out&&mono()>=cleanup_deadline){interrupted=1;break;}
  if(!stdout_bytes||!stderr_bytes){truncated=1;interrupted=1;terminate_uid((uid_t)uid);}
  struct pollfd fds[]={{pipes_out[0],POLLIN,0},{pipes_err[0],POLLIN,0},{input_open?pipes_in[1]:-1,POLLOUT,0}};int polled=poll(fds,3,20);if(polled<0&&errno!=EINTR){interrupted=1;terminate_uid((uid_t)uid);}
  if(input_open&&(fds[2].revents&POLLOUT)){ssize_t n=write(pipes_in[1],stdin_bytes+input_offset,input_length-input_offset);if(n>0)input_offset+=(size_t)n;else if(n<0&&errno!=EAGAIN&&errno!=EINTR)interrupted=1;if(input_offset==input_length||interrupted){close(pipes_in[1]);input_open=0;}}
  for(int k=0;k<2;++k)if(!eof[k]&&(fds[k].revents&(POLLIN|POLLHUP|POLLERR))){unsigned char buffer[8192];ssize_t n;while((n=read(fds[k].fd,buffer,sizeof buffer))>0){if(sizes[k]+(size_t)n>JOB_STREAM_LIMIT){truncated=1;interrupted=1;terminate_uid((uid_t)uid);}else if(stdout_bytes&&stderr_bytes){memcpy((k?stderr_bytes:stdout_bytes)+sizes[k],buffer,(size_t)n);sizes[k]+=(size_t)n;}}if(n==0){eof[k]=1;close(fds[k].fd);}}
  int status;pid_t waited=waitpid(child,&status,WNOHANG);if(waited==child){finished=1;if(WIFEXITED(status))exit_code=WEXITSTATUS(status);else if(WIFSIGNALED(status)){signal_number=WTERMSIG(status);exit_code=128+signal_number;}}
  if(finished&&(!no_processes((uid_t)uid,owned,&owned_count)||owned_count)){interrupted=1;terminate_uid((uid_t)uid);}
  if(finished&&mono()>=deadline){interrupted=1;break;}
 }
 if(input_open)close(pipes_in[1]);
 free(stdin_bytes);int absent=terminate_uid((uid_t)uid);hf_slot_watchdog_finish(watchdog,&watch_writer);long long measured_end=mono();if(!utc_now(ended_at)){sqlite3_close(db);return hf_native_error(out,"CLOCK_UNAVAILABLE");}while(waitpid(-1,NULL,WNOHANG)>0){}if(!eof[0])close(pipes_out[0]);if(!eof[1])close(pipes_err[0]);
 char *receipt=NULL;size_t receipt_length=0;FILE *writer=open_memstream(&receipt,&receipt_length);char *raw_argv=hf_json_raw(job,array),*raw_cwd=hf_json_raw(job,hf_json_field(job,plan,"cwd"));
 if(!writer||!raw_argv||!raw_cwd){sqlite3_close(db);return hf_native_error(out,"RECEIPT_UNAVAILABLE");}
 fprintf(writer,"{\"execution_plane\":\"REMOTE\",\"operation_id\":\"%s\",\"argv\":%s,\"cwd\":",operation,raw_argv);fputs(raw_cwd,writer);fputs(",\"requested_cwd\":",writer);fputs(raw_cwd,writer);fputs(",\"workspace_path\":",writer);hf_json_write_string(writer,workspace);
 const char *scope_fields[]={"session_id","organisation_id","run_id","repository_id","sandbox_id","boot_id","boot_generation","slot_id","slot_generation","provider","external_sandbox_id"};
 for(unsigned k=0;k<sizeof scope_fields/sizeof scope_fields[0];++k){char value[4096];if(!string_at(job,binding,scope_fields[k],value,sizeof value)){interrupted=1;value[0]=0;}fputc(',',writer);hf_json_write_string(writer,!strcmp(scope_fields[k],"external_sandbox_id")?"native_resource_id":scope_fields[k]);fputc(':',writer);hf_json_write_string(writer,value);}
 fprintf(writer,",\"started_at\":\"%s\",\"ended_at\":\"%s\",\"duration_ms\":%lld",started_at,ended_at,(measured_end-measured_start)/1000000);
 fprintf(writer,",\"source_object_id\":\"%s\",\"source_tree_id\":\"%s\",\"source_state_digest\":\"%s\",\"workspace_digest\":\"%s\"",measured.commit,measured.tree,measured.state,measured.workspace);
 char manifest_digest[72];string_at(job,plan,"source_digest",manifest_digest,sizeof manifest_digest);fprintf(writer,",\"source_manifest_digest\":\"%s\"",manifest_digest);
 int provenance=hf_json_field(job,plan,"source_provenance_digest");if(provenance>=0){char *raw=hf_json_raw(job,provenance);if(raw){fprintf(writer,",\"source_provenance_digest\":%s",raw);free(raw);}}
 const char *pins[]={"source_digest","policy_digest"};for(unsigned k=0;k<2;++k){char value[72];string_at(job,plan,pins[k],value,sizeof value);fputc(',',writer);hf_json_write_string(writer,pins[k]);fputc(':',writer);hf_json_write_string(writer,value);}
 fprintf(writer,",\"executable_digest\":\"sha256:%s\",\"environment_digest\":\"sha256:%s\",\"start_identity\":",executable,environment_digest);hf_process_json(writer,&identity);
 fprintf(writer,",\"exit_code\":%d,\"signal\":%d,\"timed_out\":%s,\"interrupted\":%s,\"truncated\":%s,\"output_complete\":%s,\"stdout\":",exit_code,signal_number,timed_out?"true":"false",interrupted?"true":"false",truncated?"true":"false",!truncated&&eof[0]&&eof[1]?"true":"false");captured(writer,stdout_bytes,sizes[0],!truncated&&eof[0]);fputs(",\"stderr\":",writer);captured(writer,stderr_bytes,sizes[1],!truncated&&eof[1]);fputs(",\"artifacts\":[",writer);
 size_t artifact_bytes=0;int artifact_count=0,artifact_complete=1;
 for(int t=artifacts+1;t<job->tokens[artifacts].next;t=job->tokens[t].next){char name[4096];if(!hf_json_string(job,t,name,sizeof name)){artifact_complete=0;break;}int fd=open_beneath(cwd,name,0);struct stat before,after;if(fd<0||fstat(fd,&before)||!S_ISREG(before.st_mode)||before.st_size<0||(unsigned long long)before.st_size>JOB_ARTIFACT_LIMIT-artifact_bytes){if(fd>=0)close(fd);artifact_complete=0;break;}size_t length=(size_t)before.st_size;unsigned char *bytes=malloc(length?length:1);size_t offset=0;while(bytes&&offset<length){ssize_t n=read(fd,bytes+offset,length-offset);if(n<=0)break;offset+=(size_t)n;}int stable=bytes&&offset==length&&!fstat(fd,&after)&&before.st_dev==after.st_dev&&before.st_ino==after.st_ino&&before.st_size==after.st_size&&before.st_mtim.tv_sec==after.st_mtim.tv_sec&&before.st_mtim.tv_nsec==after.st_mtim.tv_nsec;close(fd);if(!stable){free(bytes);artifact_complete=0;break;}char sha[65],*encoded=standard64(bytes,length);if(!encoded||!hf_sha256_bytes(bytes,length,sha)){free(bytes);free(encoded);artifact_complete=0;break;}if(artifact_count++)fputc(',',writer);fputs("{\"path\":",writer);hf_json_write_string(writer,name);fprintf(writer,",\"base64\":\"%s\",\"digest\":\"sha256:%s\",\"size_bytes\":\"%zu\",\"complete\":true}",encoded,sha,length);free(bytes);free(encoded);artifact_bytes+=length;
 }
 fprintf(writer,"],\"artifacts_complete\":%s,\"cleanup_status\":\"%s\",\"observed_process_absent\":%s,\"plan_digest\":\"%s\",\"authority_renewed\":false",artifact_complete?"true":"false",absent?"CONFIRMED":"UNKNOWN",absent?"true":"false",plan_digest);
 fprintf(writer,",\"job_class\":\"%s\",\"admission_fenced_at_completion\":%s,\"budget\":",preparing?"PREPARATION":"EXECUTION",hf_runner_admission_closed(state_dir,(uid_t)uid)?"true":"false");
 if(budget_status==-2)fputs("{\"status\":\"UNCHARGED\"}",writer);else hf_budget_observe(&charge_budget,writer);
 if(budget_status==HF_BUDGET_READY)budget_released=hf_budget_release(&charge_budget);
 fprintf(writer,",\"budget_attach_code\":%d,\"budget_release_code\":%d,\"preparation_stage\":",budget_attached,budget_released);
 if(preparing){char context_digest[65]="";int fd=open(stage.context_path,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);if(fd<0||!fd_hash(fd,context_digest))context_digest[0]=0;if(fd>=0)close(fd);
  const char *names[]={"stage_root","context_path","out_root","diagnostics_root","workspace_path","node_path","recipe_path"};const char *values[]={stage.stage_root,stage.context_path,stage.out_root,stage.diagnostics_root,stage.workspace_path,stage.node_path,stage.recipe_path};
  fputc('{',writer);for(unsigned k=0;k<7;++k){if(k)fputc(',',writer);hf_json_write_string(writer,names[k]);fputc(':',writer);hf_json_write_string(writer,values[k]);}
  fprintf(writer,",\"context_digest\":\"sha256:%s\",\"node_digest\":\"%s\",\"recipe_digest\":\"%s\",\"uid\":%lu,\"gid\":%lu}",context_digest,stage.node_digest,stage.recipe_digest,(unsigned long)stage.uid,(unsigned long)stage.gid);}
 else fputs("null",writer);
 fputc('}',writer);int closed=fclose(writer)==0;
 char receipt_digest[65],*encoded=closed&&hf_sha256_bytes(receipt,receipt_length,receipt_digest)?hf_base64url((const unsigned char*)receipt,receipt_length):NULL;
 int persisted=encoded&&hf_private_write(receipt_path,receipt,receipt_length,0);
 if(persisted&&sqlite3_prepare_v2(db,"UPDATE jobs SET state='TERMINAL' WHERE id=?",-1,&q,NULL)==SQLITE_OK){sqlite3_bind_text(q,1,operation,-1,SQLITE_STATIC);sqlite3_step(q);}sqlite3_finalize(q);sqlite3_close(db);
 for(int k=0;k<argc;++k)free(argv[k]);
 free(argv);for(int k=0;k<64;++k){free(env[k].key);free(env[k].value);}close(root);close(cwd);free(raw_argv);free(raw_cwd);free(stdout_bytes);free(stderr_bytes);free(receipt);hf_http_response_free(&response);free(job);
 if(!persisted){free(encoded);return hf_native_error(out,"DURABLE_RECEIPT_UNAVAILABLE");}
 fprintf(out,"{\"schema_version\":1,\"receipt_json_b64\":\"%s\",\"receipt_digest\":\"sha256:%s\",\"qualification\":\"INCOMPLETE\"}",encoded,receipt_digest);free(encoded);return 0;
}
