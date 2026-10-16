#define _GNU_SOURCE
#include "supervisor.h"
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <signal.h>
#include <stdlib.h>
#include <stdio_ext.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

/* Pending bytes and the acknowledged CAS version share one fsync/rename boundary.
 * Losing a reply can therefore only replay the same operation, never mint a retry. */
typedef struct {
 char config[4096],transport[4096],root[4096],registration[4096];
 char organisation[37],run[37],sandbox[37],boot[37],generation[32],credential[37];
 char binding[65],version[32],operation[37],idempotency[37],correlation[37],kind[16];
 char *registration_json,*payload;
 int registered;
 long interval;
} Daemon;
static volatile sig_atomic_t stopping;
static void stop_daemon(int signal_number) {(void)signal_number;stopping=1;}
static int decimal(const char *value,int positive) {
 size_t n=strlen(value);if (!n||n>19||(n>1&&value[0]=='0'))return 0;
 for(size_t i=0;i<n;++i)if(value[i]<'0'||value[i]>'9')return 0;
 return (!positive||strcmp(value,"0"))&&(n<19||strcmp(value,"9223372036854775807")<=0);
}
static int private_path(const char *path,int directory) {
 if(!path||*path!='/'||strlen(path)>=4096)return -1;
 char *copy=strdup(path),*save=NULL;if(!copy)return -1;
 int fd=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC);
 struct stat rootstat;if(fd>=0&&(fstat(fd,&rootstat)||rootstat.st_uid!=0||(rootstat.st_mode&022))){close(fd);fd=-1;}
 unsigned depth=0;
 for(char *part=strtok_r(copy,"/",&save);fd>=0&&part;part=strtok_r(NULL,"/",&save)){
  if(!strcmp(part,".")||!strcmp(part,"..")){close(fd);fd=-1;break;}
  char *following=save;while(following&&*following=='/')++following;
  int final=!following||!*following;
  int next=openat(fd,part,O_RDONLY|O_NOFOLLOW|O_CLOEXEC|((!final||directory==1)?O_DIRECTORY:O_NONBLOCK));
  close(fd);fd=next;
  if(fd>=0&&(!final||directory==1)){
   struct stat ancestor;
   int sticky_tmp=depth==0&&!strcmp(part,"tmp");
   if(fstat(fd,&ancestor)||ancestor.st_uid!=0||!S_ISDIR(ancestor.st_mode)||
     ((ancestor.st_mode&022)&&!(sticky_tmp&&(ancestor.st_mode&S_ISVTX)))){close(fd);fd=-1;}
  }
  ++depth;
 }
 free(copy);struct stat st;
 if(fd<0)return -1;
 if(fstat(fd,&st)||st.st_uid!=0||(directory==1?(!S_ISDIR(st.st_mode)||(st.st_mode&077)!=0):
   (!S_ISREG(st.st_mode)||st.st_nlink!=1||(st.st_mode&(directory==2?022:077))!=0))){close(fd);return -1;}
 return fd;
}
static int read_private(const char *path,size_t max,char **data,size_t *size) {
 int fd=private_path(path,0);if(fd<0)return 0;
 struct stat st;if(fstat(fd,&st)||st.st_size<2||(unsigned long long)st.st_size>max){close(fd);return 0;}
 size_t n=(size_t)st.st_size;char *bytes=malloc(n+1);if(!bytes){close(fd);return 0;}
 size_t used=0;while(used<n){ssize_t got=read(fd,bytes+used,n-used);if(got<0&&errno==EINTR)continue;
  if(got<=0){free(bytes);close(fd);return 0;}used+=(size_t)got;}
 char extra;ssize_t tail=read(fd,&extra,1);close(fd);if(tail!=0||memchr(bytes,0,n)){free(bytes);return 0;}
 bytes[n]=0;*data=bytes;*size=n;return 1;
}
static int field(const HfJson *j,int token,const char *key,char *out,size_t cap) {
 return hf_json_string(j,hf_json_field(j,token,key),out,cap);
}
static int is_null(const HfJson *j,int token) {
 return token>=0&&j->tokens[token].type=='v'&&j->tokens[token].end-j->tokens[token].start==4&&
  !memcmp(j->text+j->tokens[token].start,"null",4);
}
static int emit(FILE *out,const char *event,const Daemon *d) {
 fputs("{\"event\":",out);hf_json_write_string(out,event);
 fputs(",\"state_version\":",out);hf_json_write_string(out,d->version);
 fputs(",\"dispatch_ready\":false,\"execution_authority\":false}\n",out);
 /* Losing a controller/log reader must not stop the independently hosted runner. */
 if(fflush(out)!=0){__fpurge(out);clearerr(out);}
 return 1;
}
static int state_save(int dir,const Daemon *d) {
 char *data=NULL;size_t size=0;FILE *s=open_memstream(&data,&size);if(!s)return 0;
 fputs("{\"schema_version\":1,\"binding\":",s);hf_json_write_string(s,d->binding);
 fprintf(s,",\"registered\":%s,\"state_version\":",d->registered?"true":"false");hf_json_write_string(s,d->version);
 fputs(",\"pending\":",s);
 if(d->payload){
  fputs("{\"kind\":",s);hf_json_write_string(s,d->kind);
  fputs(",\"operation_id\":",s);hf_json_write_string(s,d->operation);
  fputs(",\"idempotency_key\":",s);hf_json_write_string(s,d->idempotency);
  fputs(",\"correlation_id\":",s);hf_json_write_string(s,d->correlation);
  fputs(",\"payload\":",s);hf_json_write_string(s,d->payload);fputc('}',s);
 }else fputs("null",s);
 fputc('}',s);if(fclose(s)){free(data);return 0;}
 char temp[80],uuid[37];if(!hf_uuid_generate(uuid)){free(data);return 0;}
 snprintf(temp,sizeof temp,".daemon-state-%s",uuid);
 int fd=openat(dir,temp,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);int ok=fd>=0;
 size_t used=0;while(ok&&used<size){ssize_t n=write(fd,data+used,size-used);if(n<0&&errno==EINTR)continue;
  if(n<=0)ok=0;else used+=(size_t)n;}
 free(data);if(ok&&fsync(fd))ok=0;if(fd>=0&&close(fd))ok=0;
 if(ok&&renameat(dir,temp,dir,"daemon-state.json"))ok=0;
 if(ok&&fsync(dir))ok=0;
 if(!ok)unlinkat(dir,temp,0);
 return ok;
}
static char *make_payload(Daemon *d,const char *kind) {
 char *data=NULL;size_t size=0;FILE *s=open_memstream(&data,&size);if(!s)return NULL;
 fprintf(s,"{\"run_id\":\"%s\",\"component\":\"14.1\",\"action\":\"identity.runner.%s\",\"input\":",d->run,kind);
 if(!strcmp(kind,"register"))fputs(d->registration_json,s);
 else {fputs("{\"expected_version\":",s);hf_json_write_string(s,d->version);fputc('}',s);}
 fputs(",\"expected_version\":null,\"authority\":null}",s);if(fclose(s)){free(data);return NULL;}return data;
}
static int state_load(int dir,Daemon *d) {
 struct stat st;if(fstatat(dir,"daemon-state.json",&st,AT_SYMLINK_NOFOLLOW))return errno==ENOENT;
 if(!S_ISREG(st.st_mode)||st.st_uid!=0||(st.st_mode&077)||st.st_nlink!=1)return 0;
 char path[4200],*raw=NULL;size_t n=0;snprintf(path,sizeof path,"%s/daemon-state.json",d->root);
 if(!read_private(path,HF_BODY_LIMIT,&raw,&n))return 0;
 HfJson *j=malloc(sizeof *j);char binding[65];int64_t schema=0;int valid=j&&hf_json_parse(j,raw);
 const char *keys[]={"schema_version","binding","registered","state_version","pending"};
 if(valid)valid=hf_json_only(j,0,keys,5)&&hf_json_i64(j,hf_json_field(j,0,"schema_version"),&schema)&&schema==1&&
  hf_json_get(j,"binding",binding,sizeof binding)&&!strcmp(binding,d->binding)&&
  hf_json_bool(j,hf_json_field(j,0,"registered"),&d->registered)&&
  hf_json_get(j,"state_version",d->version,sizeof d->version)&&decimal(d->version,d->registered)&&
  (d->registered||!strcmp(d->version,"0"));
 int p=valid?hf_json_field(j,0,"pending"):-1;
 if(valid&&!is_null(j,p)){
  const char *pk[]={"kind","operation_id","idempotency_key","correlation_id","payload"};
  valid=hf_json_only(j,p,pk,5)&&field(j,p,"kind",d->kind,sizeof d->kind)&&
   !strcmp(d->kind,d->registered?"heartbeat":"register")&&
   field(j,p,"operation_id",d->operation,sizeof d->operation)&&hf_uuid_valid(d->operation)&&
   field(j,p,"idempotency_key",d->idempotency,sizeof d->idempotency)&&hf_uuid_valid(d->idempotency)&&
   field(j,p,"correlation_id",d->correlation,sizeof d->correlation)&&hf_uuid_valid(d->correlation);
  int t=valid?hf_json_field(j,p,"payload"):-1;size_t cap=t>=0?j->tokens[t].end-j->tokens[t].start+1:0;
  d->payload=cap?malloc(cap):NULL;valid=valid&&d->payload&&hf_json_string(j,t,d->payload,cap);
  char *expected=valid?make_payload(d,d->kind):NULL;
  valid=valid&&expected&&!strcmp(expected,d->payload);free(expected);
 }
 free(j);free(raw);return valid;
}
static int load_config(const char *request,Daemon *d) {
 HfJson *j=malloc(sizeof *j);const char *keys[]={"config_path"};char *raw=NULL,*registration=NULL,*transport=NULL;
 size_t n=0,rn=0,tn=0;int valid=geteuid()==0&&j&&hf_json_parse(j,request)&&hf_json_only(j,0,keys,1)&&
  hf_json_get(j,"config_path",d->config,sizeof d->config)&&read_private(d->config,65536,&raw,&n)&&hf_json_parse(j,raw);
 const char *names[]={"transport_config","state_dir","organisation_id","run_id","sandbox_id","boot_id","boot_generation","runner_registration_path"};
 char *values[]={d->transport,d->root,d->organisation,d->run,d->sandbox,d->boot,d->generation,d->registration};
 const size_t caps[]={sizeof d->transport,sizeof d->root,37,37,37,37,sizeof d->generation,sizeof d->registration};
 for(size_t k=0;valid&&k<8;++k)valid=hf_json_get(j,names[k],values[k],caps[k]);
 if(valid)valid=hf_uuid_valid(d->organisation)&&hf_uuid_valid(d->run)&&hf_uuid_valid(d->sandbox)&&hf_uuid_valid(d->boot)&&
  decimal(d->generation,1);
 d->interval=30000;int64_t interval=30000;
 if(valid&&hf_json_field(j,0,"heartbeat_interval_ms")>=0)
  valid=hf_json_i64(j,hf_json_field(j,0,"heartbeat_interval_ms"),&interval)&&interval>=1000&&interval<=30000;
 d->interval=(long)interval;
 /* A14-only loop cannot certify06 dispatch readiness. Consumer registration is
  * integrated by the supervisor owner against06's frozen boot-bound protocol. */
 if(valid&&hf_json_field(j,0,"consumer_id")>=0)valid=0;
 HfTransportConfig settings;
 if(valid)valid=read_private(d->transport,32768,&transport,&tn)&&hf_transport_config(d->transport,&settings)&&
  settings.timeout_ms<=10000&&*settings.credential_id&&hf_uuid_valid(settings.credential_id)&&!*settings.grant_path;
 if(valid){
  int key=private_path(settings.key_path,0),ca=*settings.ca_file?private_path(settings.ca_file,2):-2;
  valid=key>=0&&ca!=-1;
  if(key>=0)close(key);
  if(ca>=0)close(ca);
 }
 if(valid)memcpy(d->credential,settings.credential_id,sizeof d->credential);
 if(valid)valid=read_private(d->registration,300000,&registration,&rn)&&hf_json_parse(j,registration);
 const char *rk[]={"preparation_digest","inventory"};char prep[72];
 if(valid)valid=hf_json_only(j,0,rk,2)&&hf_json_get(j,"preparation_digest",prep,sizeof prep)&&strlen(prep)==71&&
  !strncmp(prep,"sha256:",7);
 for(size_t k=7;valid&&k<71;++k)valid=(prep[k]>='0'&&prep[k]<='9')||(prep[k]>='a'&&prep[k]<='f');
 int inventory=valid?hf_json_field(j,0,"inventory"):-1;
 if(valid)valid=inventory>=0&&j->tokens[inventory].type=='['&&j->tokens[inventory].count<=256&&
  j->tokens[inventory].end-j->tokens[inventory].start<=262144;
 if(valid){
  /* Pin full private config, transport, and inventory bytes, excluding key bytes. */
  char *bound=NULL;size_t count=0;FILE *s=open_memstream(&bound,&count);
  if(s){fprintf(s,"%zu:",n);fwrite(raw,1,n,s);fprintf(s,"%zu:",tn);fwrite(transport,1,tn,s);
   fprintf(s,"%zu:",rn);fwrite(registration,1,rn,s);valid=fclose(s)==0&&hf_sha256_bytes(bound,count,d->binding);free(bound);}
  else valid=0;
 }
 if(valid){d->registration_json=registration;registration=NULL;}
 free(j);free(raw);free(registration);free(transport);return valid;
}
static int accept_response(Daemon *d,const HfHttpResponse *response) {
 HfJson *j=malloc(sizeof *j);int ok=0;int64_t protocol=0;
 int valid=j&&response->body&&hf_json_parse(j,response->body)&&
  hf_json_bool(j,hf_json_field(j,0,"ok"),&ok)&&ok&&
  hf_json_i64(j,hf_json_field(j,0,"protocol_version"),&protocol)&&protocol==1;
 int r=valid?hf_json_field(j,0,"result"):-1;char version[32],heartbeat[64];
 if(valid)valid=field(j,r,"state_version",version,sizeof version)&&decimal(version,1)&&
  field(j,r,"heartbeat_at",heartbeat,sizeof heartbeat)&&strlen(heartbeat)==24&&heartbeat[23]=='Z';
 if(valid&&!d->registered){
  char credential[37],sandbox[37],boot[37],generation[32];int registered=0;
  valid=hf_json_bool(j,hf_json_field(j,r,"registered"),&registered)&&registered&&
   field(j,r,"credential_id",credential,sizeof credential)&&!strcmp(credential,d->credential)&&
   field(j,r,"sandbox_id",sandbox,sizeof sandbox)&&!strcmp(sandbox,d->sandbox)&&
   field(j,r,"boot_id",boot,sizeof boot)&&!strcmp(boot,d->boot)&&
   field(j,r,"boot_generation",generation,sizeof generation)&&!strcmp(generation,d->generation);
 }else if(valid){
  int heartbeating=0;unsigned long long before=strtoull(d->version,NULL,10),after=strtoull(version,NULL,10);
  valid=hf_json_bool(j,hf_json_field(j,r,"heartbeat"),&heartbeating)&&heartbeating&&
   before<9223372036854775807ULL&&after==before+1;
 }
 if(valid){memcpy(d->version,version,strlen(version)+1);d->registered=1;}
 free(j);return valid;
}
static int version_conflict(const HfHttpResponse *r) {
 HfJson *j=malloc(sizeof *j);char code[128];int conflict=j&&r->body&&hf_json_parse(j,r->body)&&
  field(j,hf_json_field(j,0,"error"),"code",code,sizeof code)&&!strcmp(code,"VERSION_CONFLICT");
 free(j);return conflict;
}
static void pause_ms(long ms) {
 struct timespec wait={.tv_sec=ms/1000,.tv_nsec=(ms%1000)*1000000};
 while(!stopping&&nanosleep(&wait,&wait)&&errno==EINTR){}
}
int hf_supervisor_daemon(const char *request,FILE *out) {
 Daemon d={0};int dir=-1,lock=-1,result=1;const char *error="DAEMON_CONFIGURATION_INVALID";
 struct sigaction previous_term,previous_int,previous_pipe,action={0};int installed=0;
 int output_fd=fileno(out),output_flags=-1,error_fd=fileno(stderr),error_flags=-1;
 if(output_fd>=0){output_flags=fcntl(output_fd,F_GETFL);if(output_flags<0||fcntl(output_fd,F_SETFL,output_flags|O_NONBLOCK))return 1;}
 if(error_fd>=0){error_flags=fcntl(error_fd,F_GETFL);if(error_flags<0||fcntl(error_fd,F_SETFL,error_flags|O_NONBLOCK)){
  if(output_flags>=0)(void)fcntl(output_fd,F_SETFL,output_flags);
  return 1;}}
 strcpy(d.version,"0");
 if(!load_config(request,&d))goto done;
 dir=private_path(d.root,1);if(dir<0){error="DAEMON_STATE_DIRECTORY_UNTRUSTED";goto done;}
 lock=openat(dir,"daemon.lock",O_RDWR|O_CREAT|O_NOFOLLOW|O_CLOEXEC,0600);struct stat st;
 if(lock<0||fstat(lock,&st)||!S_ISREG(st.st_mode)||st.st_uid!=0||(st.st_mode&077)||st.st_nlink!=1||
   flock(lock,LOCK_EX|LOCK_NB)){error="DAEMON_ALREADY_RUNNING_OR_LOCK_UNTRUSTED";goto done;}
 if(!state_load(dir,&d)){error="DAEMON_STATE_REQUIRES_RECONCILIATION";goto done;}
 stopping=0;action.sa_handler=stop_daemon;sigemptyset(&action.sa_mask);
 if(sigaction(SIGTERM,&action,&previous_term)){error="DAEMON_SIGNAL_SETUP_FAILED";goto done;}
 if(sigaction(SIGINT,&action,&previous_int)){sigaction(SIGTERM,&previous_term,NULL);error="DAEMON_SIGNAL_SETUP_FAILED";goto done;}
 struct sigaction ignore_pipe={0};ignore_pipe.sa_handler=SIG_IGN;sigemptyset(&ignore_pipe.sa_mask);
 if(sigaction(SIGPIPE,&ignore_pipe,&previous_pipe)){sigaction(SIGTERM,&previous_term,NULL);sigaction(SIGINT,&previous_int,NULL);error="DAEMON_SIGNAL_SETUP_FAILED";goto done;}
 installed=1;
 /* Event delivery is advisory; neither controller channel may block the daemon. */
 long retry=1000;
 while(!stopping){
  if(!d.payload){
   snprintf(d.kind,sizeof d.kind,"%s",d.registered?"heartbeat":"register");
   if(!hf_uuid_generate(d.operation)||!hf_uuid_generate(d.idempotency)||!hf_uuid_generate(d.correlation)||
     !(d.payload=make_payload(&d,d.kind))||!state_save(dir,&d)){error="DAEMON_PENDING_PERSISTENCE_FAILED";goto done;}
  }
  HfHttpResponse response={0};
  int completed=hf_supervisor_call(d.transport,0,d.payload,d.operation,d.idempotency,d.correlation,NULL,NULL,NULL,&response);
  if(version_conflict(&response)){hf_http_response_free(&response);error="DAEMON_VERSION_CONFLICT_PENDING_RETAINED";goto done;}
  if(completed&&response.status>=200&&response.status<300){
   if(!accept_response(&d,&response)){hf_http_response_free(&response);error="DAEMON_RESPONSE_BINDING_INVALID";goto done;}
   hf_http_response_free(&response);free(d.payload);d.payload=NULL;
   if(!state_save(dir,&d)){error="DAEMON_ACK_PERSISTENCE_FAILED";goto done;}
   if(!emit(out,"RUNNER_HEARTBEATING",&d)){error="DAEMON_OBSERVER_OUTPUT_UNAVAILABLE";goto done;}
   retry=1000;pause_ms(d.interval);
  }else{
   long status=response.status;hf_http_response_free(&response);
   if(completed&&status>=400&&status<500&&status!=408&&status!=429){error="DAEMON_REQUEST_REJECTED_PENDING_RETAINED";goto done;}
   if(!emit(out,"RECONNECT_PENDING",&d)){error="DAEMON_OBSERVER_OUTPUT_UNAVAILABLE";goto done;}
   pause_ms(retry);if(retry<10000)retry=retry>5000?10000:retry*2;
  }
 }
 result=emit(out,"STOPPED",&d)?0:1;
done:
 if(lock>=0)close(lock);
 if(dir>=0)close(dir);
 free(d.registration_json);free(d.payload);
 if(result)result=hf_native_error(out,error);
 /* Keep both descriptors nonblocking until all final diagnostics are attempted.
  * Drop advisory buffered bytes before restoring flags for the caller/stdio exit. */
 (void)fflush(out);__fpurge(out);clearerr(out);
 if(out!=stderr){(void)fflush(stderr);__fpurge(stderr);clearerr(stderr);}
 if(error_flags>=0)(void)fcntl(error_fd,F_SETFL,error_flags);
 if(output_flags>=0)(void)fcntl(output_fd,F_SETFL,output_flags);
 if(installed){sigaction(SIGTERM,&previous_term,NULL);sigaction(SIGINT,&previous_int,NULL);sigaction(SIGPIPE,&previous_pipe,NULL);}
 return result;
}
