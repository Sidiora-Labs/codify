/* Observe one unprivileged preparation phase. The root caller owns the fixed
 * recipe, job-wide watchdog and budget admission; this helper grants no READY
 * state. Each phase must leave the dedicated UID empty before another begins. */
#define _GNU_SOURCE
#include "components.h"
#include "supervisor.h"
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <limits.h>
#include <linux/capability.h>
#include <openssl/evp.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio_ext.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

extern int hf_component_11_3(const char *,const char *,FILE *);

#define PP_LIMIT (256ULL*1024*1024)
#define PP_PROCESSES 4096
#define PP_ENV 64
static long long pp_now(void) {
 struct timespec t;if(clock_gettime(CLOCK_MONOTONIC,&t))return -1;
 return (long long)t.tv_sec*1000000000LL+t.tv_nsec;
}
static int pp_utc(char out[40]) {
 struct timespec t;struct tm tm;char base[24];
 if(clock_gettime(CLOCK_REALTIME,&t)||!gmtime_r(&t.tv_sec,&tm)||strftime(base,sizeof base,"%Y-%m-%dT%H:%M:%S",&tm)!=19)return 0;
 return snprintf(out,40,"%s.%03ldZ",base,t.tv_nsec/1000000)==24;
}
static int pp_directory(const char *path,uid_t uid,gid_t gid) {
 if(!path||path[0]!='/'||strlen(path)>4095||strstr(path,"//"))return 0;
 int fd=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC);char copy[4096];strcpy(copy,path);
 char *save=NULL;int ok=fd>=0;
 for(char *p=strtok_r(copy,"/",&save);ok&&p;p=strtok_r(NULL,"/",&save)){
  if(!strcmp(p,".")||!strcmp(p,"..")){ok=0;break;}
  int next=openat(fd,p,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
  if(next<0){ok=0;break;}close(fd);fd=next;
 }
 struct stat st;
 ok=ok&&!fstat(fd,&st)&&S_ISDIR(st.st_mode)&&st.st_uid==uid&&st.st_gid==gid&&(st.st_mode&0777)==0700;
 if(fd>=0)close(fd);
 return ok;
}
static int pp_log(int fd,struct stat *st) {
 int flags=fcntl(fd,F_GETFL);off_t offset=lseek(fd,0,SEEK_CUR);
 return flags>=0&&(flags&O_ACCMODE)!=O_RDONLY&&!(flags&O_APPEND)&&!fstat(fd,st)&&S_ISREG(st->st_mode)&&
  st->st_uid==0&&(st->st_mode&0777)==0600&&st->st_nlink==1&&st->st_size==0&&offset==0;
}
static const char *const pp_environment[]={
 "PATH","LANG","LC_ALL","LC_CTYPE","TZ","HF_EXECUTION_HOST_CLASS","HF_SANDBOX_BOOT_ID",
 "HF_RUNNER_PROFILE_DIGEST","HF_RUNNER_PREPARATION_DIGEST","HF_RUNNER_WORKSPACE_DIGEST",
 "HF_PREPARATION_WORKSPACE_ROOT","HF_PREPARATION_BASE_ROOT","HF_PREPARATION_MANIFEST_ROOT",
 "HF_READINESS_MODULE_PATH","HF_READINESS_MODULE_DIGEST","HF_READINESS_NODE_EXECUTABLE","HF_READINESS_NODE_DIGEST",
 "HF_READINESS_SCAN_POLICY_FILE","HF_READINESS_TOOL_BINDINGS_FILE","HF_CREDENTIAL_AVAILABILITY_FILE",
 "HF_INVOCATION_SCOPE_FILE","HF_READINESS_DIAGNOSTICS_ROOT","HF_READINESS_WORKSPACE_MANIFEST_FILE"
};
static void pp_free_env(char **env) {for(size_t n=0;env&&env[n];n++)free(env[n]);free(env);}
static char **pp_env(const HfPreparationProcessSpec *s) {
 char **env=calloc(PP_ENV+6,sizeof *env);if(!env)return NULL;
 size_t used=0;uint64_t seen=0;
 const char *const defaults[]={"PATH=/usr/local/bin:/usr/bin:/bin","LANG=C","LC_ALL=C"};
 for(size_t n=0;n<3;n++){env[used]=strdup(defaults[n]);if(!env[used++])goto bad;}
 for(size_t n=0;s->environment&&s->environment[n];n++){
  const char *entry=s->environment[n],*equal=strchr(entry,'=');
  if(n>=PP_ENV||!equal||equal==entry||strlen(entry)>8192)goto bad;
  size_t key=(size_t)(equal-entry);int allowed=0;
  for(size_t k=0;k<sizeof pp_environment/sizeof *pp_environment;k++)
   if(strlen(pp_environment[k])==key&&!strncmp(entry,pp_environment[k],key)){if(seen&(UINT64_C(1)<<k))goto bad;seen|=UINT64_C(1)<<k;allowed=1;break;}
  if(!allowed)goto bad;
  for(const char *p=equal+1;*p;p++)if((unsigned char)*p<32||*p==127)goto bad;
  int replaced=0;
  for(size_t k=0;k<used;k++)if(!strncmp(env[k],entry,key)&&env[k][key]=='='){
   if(k>=3||replaced)goto bad;
   char *copy=strdup(entry);if(!copy)goto bad;
   free(env[k]);env[k]=copy;replaced=1;break;
  }
  if(!replaced){env[used]=strdup(entry);if(!env[used++])goto bad;}
 }
 const char *names[]={"HOME","TMPDIR","HF_JOB_HOME","HF_JOB_TMPDIR"};
 const char *values[]={s->home,s->tmp,s->home,s->tmp};
 for(size_t n=0;n<4;n++){
  size_t size=strlen(names[n])+strlen(values[n])+2;
  env[used]=malloc(size);if(!env[used])goto bad;
  snprintf(env[used++],size,"%s=%s",names[n],values[n]);
 }
 return env;
bad:pp_free_env(env);return NULL;
}
static int pp_inventory(uid_t uid,HfProcessIdentity *list,size_t *count) {
 DIR *dir=opendir("/proc");if(!dir)return 0;struct dirent *entry;*count=0;int ok=1;
 while((entry=readdir(dir))){
  char *end=NULL;errno=0;long n=strtol(entry->d_name,&end,10);
  if(errno||!end||*end||n<=0||n>INT_MAX)continue;
  HfProcessIdentity p;
  if(hf_process_identity((pid_t)n,&p)&&p.uid==uid){
   if(*count==PP_PROCESSES){ok=0;break;}list[(*count)++]=p;
  }else{
   char path[64],line[512];snprintf(path,sizeof path,"/proc/%ld/status",n);
   FILE *status=fopen(path,"re");
   if(!status){if(errno!=ENOENT&&errno!=ESRCH){ok=0;break;}continue;}
   unsigned real=0,effective=0;int found=0;
   while(fgets(line,sizeof line,status))if(sscanf(line,"Uid: %u %u",&real,&effective)==2){found=1;break;}
   fclose(status);if(found&&effective==uid){ok=0;break;}
  }
 }
 closedir(dir);return ok;
}
/* pidfds bind a signal to the observed kernel task even if the numeric PID is recycled. */
static int pp_signal(const HfProcessIdentity *expected,uid_t uid,int signal) {
 int fd=(int)syscall(SYS_pidfd_open,expected->pid,0);
 if(fd<0)return errno==ESRCH;
 HfProcessIdentity observed;int ok=1;
 if(hf_process_matches(expected,&observed)&&observed.uid==uid){
  if(syscall(SYS_pidfd_send_signal,fd,signal,NULL,0)&&errno!=ESRCH)ok=0;
 }
 close(fd);return ok;
}
static void pp_reap_uid(HfProcessIdentity *list,size_t count,pid_t main,int *done,int *known,int *status) {
 for(size_t n=0;n<count;n++){
  if(list[n].state!='Z'&&list[n].state!='X')continue;
  HfProcessIdentity current;
  if(!hf_process_matches(&list[n],&current)||current.uid!=list[n].uid)continue;
  int value=0;pid_t waited=waitpid(list[n].pid,&value,WNOHANG);
  if(waited==main){*done=1;*known=1;*status=value;}
 }
}
static int pp_stop(const HfPreparationProcessSpec *s,HfProcessIdentity *list,pid_t main,int *done,int *known,int *status) {
 long long begin=pp_now();if(begin<0)return 0;int empty=0;
 while(1){
  long long now=pp_now();if(now<0)return 0;if(now-begin>=3000000000LL)break;
  if(!hf_slot_owner(s->uid,s->operation_id))return 0;
  size_t count=0;if(!pp_inventory(s->uid,list,&count))return 0;
  pp_reap_uid(list,count,main,done,known,status);
  if(!count){if(++empty==2)return 1;}else empty=0;
  for(size_t n=0;n<count;n++)
   if(list[n].state!='Z'&&list[n].state!='X'&&(!hf_slot_owner(s->uid,s->operation_id)||!pp_signal(&list[n],s->uid,SIGKILL)))return 0;
  struct timespec delay={.tv_nsec=10000000};while(nanosleep(&delay,&delay)&&errno==EINTR){}
 }
 return 0;
}
static int pp_watchdog(const HfPreparationProcessSpec *s) {
 HfProcessIdentity p;
 return hf_slot_owner(s->uid,s->operation_id)&&hf_process_matches(s->watchdog,&p)&&p.uid==0&&p.state!='Z'&&p.state!='X';
}
static int pp_clear_capabilities(void) {
 struct __user_cap_header_struct header={.version=_LINUX_CAPABILITY_VERSION_3,.pid=0};
 struct __user_cap_data_struct capabilities[2]={{0},{0}};
 return syscall(SYS_capset,&header,capabilities)==0&&prctl(PR_CAP_AMBIENT,PR_CAP_AMBIENT_CLEAR_ALL,0,0,0)==0;
}
static int pp_copy_fd(int fd) {return fcntl(fd,F_DUPFD_CLOEXEC,10);}
static void pp_child(const HfPreparationProcessSpec *s,char **environment,int out,int error,int ready,int gate,pid_t parent) {
 if(prctl(PR_SET_PDEATHSIG,SIGKILL)||getppid()!=parent)_exit(126);
 int output=pp_copy_fd(out),errors=pp_copy_fd(error),notice=pp_copy_fd(ready),release=pp_copy_fd(gate);
 int executable=s->executable_fd>=0?pp_copy_fd(s->executable_fd):-1,null=open("/dev/null",O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
 if(output<0||errors<0||notice<0||release<0||null<0||(s->executable_fd>=0&&executable<0))_exit(126);
 if(setpgid(0,0)||setgroups(0,NULL)||setresgid(s->gid,s->gid,s->gid)||setresuid(s->uid,s->uid,s->uid)||
  getuid()!=s->uid||geteuid()!=s->uid||getgid()!=s->gid||getegid()!=s->gid||!pp_clear_capabilities()||
  prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0)||prctl(PR_SET_DUMPABLE,0)||prctl(PR_SET_PDEATHSIG,SIGKILL)||getppid()!=parent||
  fchdir(s->cwd_fd)||dup2(null,0)<0||dup2(output,1)<0||dup2(errors,2)<0||
  (executable>=0&&dup3(executable,3,O_CLOEXEC)<0)||dup3(release,4,O_CLOEXEC)<0||dup3(notice,5,O_CLOEXEC)<0||
  close_range(6,~0U,0))_exit(126);
 if(executable<0)close(3);
 __fpurge(stdin);__fpurge(stdout);__fpurge(stderr);clearerr(stdin);clearerr(stdout);clearerr(stderr);
 /* No inherited credential/configuration descriptors or environment reach a phase. */
 struct sigaction normal={.sa_handler=SIG_DFL};sigemptyset(&normal.sa_mask);
 for(int signum=1;signum<NSIG;signum++)if(signum!=SIGKILL&&signum!=SIGSTOP)sigaction(signum,&normal,NULL);
 sigset_t empty;sigemptyset(&empty);if(sigprocmask(SIG_SETMASK,&empty,NULL)||clearenv())_exit(126);
 for(size_t n=0;environment[n];n++)if(putenv(environment[n]))_exit(126);
 char value='R';ssize_t written;do{written=write(5,&value,1);}while(written<0&&errno==EINTR);close(5);
 if(written!=1)_exit(126);
 ssize_t received;do{received=read(4,&value,1);}while(received<0&&errno==EINTR);close(4);
 if(received!=1||value!='G'||getppid()!=parent)_exit(126);
 if(executable>=0){fexecve(3,(char *const *)s->argv,environment);_exit(127);}
 FILE *output_stream=fdopen(1,"w"),*error_stream=fdopen(2,"w");
 if(!output_stream||!error_stream)_exit(126);
 setvbuf(output_stream,NULL,_IONBF,0);setvbuf(error_stream,NULL,_IONBF,0);stdout=output_stream;stderr=error_stream;
 int result=s->native_entry(s->native_action,s->native_request,output_stream);
 if(fflush(output_stream)||fflush(error_stream))_exit(126);
 fclose(output_stream);fclose(error_stream);_exit(result>=0&&result<=255?result:126);
}
static int pp_digest(EVP_MD_CTX *ctx,char out[72]) {
 unsigned char bytes[32];unsigned length=0;if(EVP_DigestFinal_ex(ctx,bytes,&length)!=1||length!=32)return 0;
 memcpy(out,"sha256:",7);for(unsigned n=0;n<32;n++)snprintf(out+7+n*2,3,"%02x",bytes[n]);return 1;
}
static int pp_drain(int pipe,int log,EVP_MD_CTX *digest,unsigned long long *bytes,unsigned long long *total,
 size_t limit,int *eof,int *overflow) {
 unsigned char data[65536];
 for(int turn=0;turn<4;turn++){
  ssize_t n=read(pipe,data,sizeof data);
  if(n==0){*eof=1;return 1;}
  if(n<0){if(errno==EINTR){turn--;continue;}return errno==EAGAIN||errno==EWOULDBLOCK;}
  size_t keep=(size_t)n;
  if(keep>limit-*total){keep=(size_t)(limit-*total);*overflow=1;}
  size_t offset=0;
  while(offset<keep){ssize_t count=write(log,data+offset,keep-offset);if(count<0&&errno==EINTR)continue;if(count<=0)return 0;offset+=(size_t)count;}
  if(keep&&EVP_DigestUpdate(digest,data,keep)!=1)return 0;
  *bytes+=keep;*total+=keep;
 }
 return 1;
}
int hf_preparation_process(const HfPreparationProcessSpec *s,HfPreparationProcessResult *result) {
 if(!result)return -1;
 memset(result,0,sizeof *result);
 struct stat out_stat,error_stat,cwd,executable;struct sigaction child_signal;
 long long started=pp_now();int wall_started=pp_utc(result->started_at);
 if(!s||geteuid()!=0||s->uid==0||s->gid==0||s->uid==(uid_t)-1||s->gid==(gid_t)-1||!s->operation_id||!hf_uuid_valid(s->operation_id)||!s->watchdog||
  !wall_started||s->watchdog->pid<=1||s->watchdog->pid==getpid()||s->deadline_ns<=started||started<0||
  s->output_limit_bytes<1||s->output_limit_bytes>PP_LIMIT||
  !pp_directory(s->home,s->uid,s->gid)||!pp_directory(s->tmp,s->uid,s->gid)||
  !pp_log(s->stdout_fd,&out_stat)||!pp_log(s->stderr_fd,&error_stat)||
  (out_stat.st_dev==error_stat.st_dev&&out_stat.st_ino==error_stat.st_ino)||
  fstat(s->cwd_fd,&cwd)||!S_ISDIR(cwd.st_mode)||!pp_watchdog(s)||
  sigaction(SIGCHLD,NULL,&child_signal)||child_signal.sa_handler==SIG_IGN||(child_signal.sa_flags&SA_NOCLDWAIT))return -1;
 int exec=s->executable_fd>=0;
 if(exec){
  if(s->native_entry||!s->argv||!s->argv[0]||s->argv[0][0]!='/'||fstat(s->executable_fd,&executable)||
   !S_ISREG(executable.st_mode)||executable.st_uid!=0||(executable.st_mode&022)||!(executable.st_mode&0111))return -1;
  size_t bytes=0,n=0;for(;s->argv[n];n++){if(n>=256||strlen(s->argv[n])>4096)return -1;bytes+=strlen(s->argv[n])+1;if(bytes>262144)return -1;}
 }else if(s->argv||s->native_entry!=hf_component_11_3||!s->native_action||
  (strcmp(s->native_action,"environment.readiness")&&strcmp(s->native_action,"environment.source.verify"))||
  !s->native_request||strlen(s->native_request)>HF_BODY_LIMIT)return -1;
 char **environment=pp_env(s);HfProcessIdentity *list=calloc(PP_PROCESSES,sizeof *list);size_t count=0;
 if(!environment||!list){pp_free_env(environment);free(list);return -1;}
 if(!pp_inventory(s->uid,list,&count)||count){pp_free_env(environment);free(list);return -1;}
 int old_subreaper=0;if(prctl(PR_GET_CHILD_SUBREAPER,&old_subreaper)||(!old_subreaper&&prctl(PR_SET_CHILD_SUBREAPER,1))){
  pp_free_env(environment);free(list);return -1;
 }
 int pipes[4][2]={{-1,-1},{-1,-1},{-1,-1},{-1,-1}},status=0,done=0,known=0,executed=0,io_ok=1,overflow=0,eof[2]={0,0};
 EVP_MD_CTX *digest[2]={EVP_MD_CTX_new(),EVP_MD_CTX_new()};pid_t child=-1;int main_pidfd=-1;
 if(!digest[0]||!digest[1]||EVP_DigestInit_ex(digest[0],EVP_sha256(),NULL)!=1||
  EVP_DigestInit_ex(digest[1],EVP_sha256(),NULL)!=1)goto finish;
 for(int n=0;n<3;n++)if(pipe2(pipes[n],O_CLOEXEC))goto finish;
 if(socketpair(AF_UNIX,SOCK_STREAM|SOCK_CLOEXEC,0,pipes[3]))goto finish;
 for(int n=0;n<3;n++){int flags=fcntl(pipes[n][0],F_GETFL);if(flags<0||fcntl(pipes[n][0],F_SETFL,flags|O_NONBLOCK))goto finish;}
 pid_t parent=getpid();child=fork();if(child==0)pp_child(s,environment,pipes[0][1],pipes[1][1],pipes[2][1],pipes[3][0],parent);
 if(child<0)goto finish;
 main_pidfd=(int)syscall(SYS_pidfd_open,child,0);
 for(int n=0;n<3;n++){close(pipes[n][1]);pipes[n][1]=-1;}close(pipes[3][0]);pipes[3][0]=-1;
 int ready=0;
 if(main_pidfd<0)goto terminate;
 while(!ready){
  char value=0;ssize_t n=read(pipes[2][0],&value,1);
  if(n==1){ready=value=='R';break;}
  if(n==0||(n<0&&errno!=EINTR&&errno!=EAGAIN&&errno!=EWOULDBLOCK))break;
  long long now=pp_now();if(now<0||now>=s->deadline_ns||!pp_watchdog(s)){result->timed_out=now>=s->deadline_ns;break;}
  struct pollfd p={pipes[2][0],POLLIN|POLLHUP,0};if(poll(&p,1,10)<0&&errno!=EINTR)break;
 }
 close(pipes[2][0]);pipes[2][0]=-1;
 if(!ready||!hf_process_identity(child,&result->process)||result->process.uid!=s->uid||
  result->process.ppid!=parent||!pp_watchdog(s))goto terminate;
 if(s->admit_child&&s->admit_child(s->admit_child_context,&result->process)!=1)goto terminate;
 long long admitted=pp_now();HfProcessIdentity gated;
 if(admitted<0||admitted>=s->deadline_ns||!pp_watchdog(s)||!hf_process_matches(&result->process,&gated)||gated.uid!=s->uid){
  result->timed_out=admitted>=s->deadline_ns;goto terminate;
 }
 char go='G';ssize_t released;
 do{released=send(pipes[3][1],&go,1,MSG_NOSIGNAL);}while(released<0&&errno==EINTR);
 close(pipes[3][1]);pipes[3][1]=-1;if(released!=1)goto terminate;executed=1;
 unsigned long long total=0;
 while(!done){
  for(int n=0;n<2;n++)if(!eof[n]&&!pp_drain(pipes[n][0],n?s->stderr_fd:s->stdout_fd,digest[n],
   n?&result->stderr_bytes:&result->stdout_bytes,&total,s->output_limit_bytes,&eof[n],&overflow))io_ok=0;
  pid_t waited=waitpid(child,&status,WNOHANG);
  if(waited==child){done=known=1;long long finished=pp_now();if(finished>=s->deadline_ns)result->timed_out=1;break;}if(waited<0&&errno!=EINTR){done=1;break;}
  long long now=pp_now();
  if(now<0||now>=s->deadline_ns||!io_ok||overflow||!pp_watchdog(s)){
   result->timed_out=now>=s->deadline_ns;break;
  }
  struct pollfd p[2]={{pipes[0][0],POLLIN|POLLHUP,0},{pipes[1][0],POLLIN|POLLHUP,0}};
  if(poll(p,2,10)<0&&errno!=EINTR){io_ok=0;break;}
 }
 if(!done||!known||!io_ok||overflow)result->interrupted=1;
 if(pp_inventory(s->uid,list,&count)&&count)result->interrupted=1;
terminate:
 if(!executed)result->interrupted=1;
 if(pipes[3][1]>=0){close(pipes[3][1]);pipes[3][1]=-1;}
 if(!done&&main_pidfd>=0&&syscall(SYS_pidfd_send_signal,main_pidfd,SIGKILL,NULL,0)&&errno!=ESRCH)io_ok=0;
 result->uid_absent=pp_stop(s,list,child,&done,&known,&status);
 /* The main process can fail before dropping UID. Reap that exact child too. */
 if(!done){
  long long reap_start=pp_now();
  while(reap_start>=0){
   pid_t waited=waitpid(child,&status,WNOHANG);
   if(waited==child){done=known=1;break;}
   if(waited<0&&errno!=EINTR){done=1;break;}
   long long now=pp_now();if(now<0||now-reap_start>=1000000000LL)break;
   struct timespec pause={.tv_nsec=1000000};nanosleep(&pause,NULL);
  }
 }
 {
  unsigned long long captured=result->stdout_bytes+result->stderr_bytes;long long drain_start=pp_now();
  while((!eof[0]||!eof[1])&&drain_start>=0){
   long long now=pp_now();if(now<0){io_ok=0;break;}if(now-drain_start>=1000000000LL)break;
   for(int n=0;n<2;n++)if(pipes[n][0]>=0&&!eof[n]&&!pp_drain(pipes[n][0],n?s->stderr_fd:s->stdout_fd,digest[n],
    n?&result->stderr_bytes:&result->stdout_bytes,&captured,s->output_limit_bytes,&eof[n],&overflow))io_ok=0;
   if(!eof[0]||!eof[1]){struct pollfd p[2]={{pipes[0][0],POLLIN|POLLHUP,0},{pipes[1][0],POLLIN|POLLHUP,0}};if(poll(p,2,10)<0&&errno!=EINTR){io_ok=0;break;}}
  }
 }
 if(known){result->exit_code=WIFEXITED(status)?WEXITSTATUS(status):128+(WIFSIGNALED(status)?WTERMSIG(status):0);result->signal=WIFSIGNALED(status)?WTERMSIG(status):0;if(result->signal)result->interrupted=1;}
 if(overflow||!io_ok)result->interrupted=1;
 int synced_out=fsync(s->stdout_fd),synced_error=fsync(s->stderr_fd);
 result->output_complete=io_ok&&!overflow&&eof[0]&&eof[1]&&synced_out==0&&synced_error==0;
 if(!pp_digest(digest[0],result->stdout_digest)||!pp_digest(digest[1],result->stderr_digest))result->output_complete=0;
finish:
 for(int n=0;n<4;n++)for(int k=0;k<2;k++)if(pipes[n][k]>=0)close(pipes[n][k]);
 if(main_pidfd>=0)close(main_pidfd);
 EVP_MD_CTX_free(digest[0]);EVP_MD_CTX_free(digest[1]);pp_free_env(environment);free(list);
 long long ended=pp_now();result->duration_ms=ended>=started?(ended-started)/1000000:0;
 if(!pp_utc(result->ended_at))result->output_complete=0;
 if(!old_subreaper&&(child<0||result->uid_absent))prctl(PR_SET_CHILD_SUBREAPER,0);
 return ended>=started&&executed&&known&&result->uid_absent&&result->output_complete?1:0;
}
