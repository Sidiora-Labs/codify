#define _GNU_SOURCE
#include "components.h"
#include "supervisor.h"
#include <arpa/inet.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <sqlite3.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/file.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include <openssl/evp.h>

/* Root-owned local observations are not task authority. Every new instruction is
 * fetched through the authenticated primary API before this ledger accepts it. */
typedef struct {
 char transport[4096],state[4096],slots[4096],plan[4096];
 char organisation[37],run[37],sandbox[37],boot[37],generation[32],consumer[128];
} RunnerConfig;
typedef struct {
 char launch[37],command[37],session[37],attempt[37],attempt_generation[32],epoch[37],sequence[32],slot[37],digest[72];
 char kind[16],plan_digest[72],event[37];long long deadline_ns;char *body;uid_t uid;gid_t gid;
} Instruction;
static long long monotonic_ns(void) {struct timespec t;if(clock_gettime(CLOCK_MONOTONIC,&t))return -1;return (long long)t.tv_sec*1000000000LL+t.tv_nsec;}
static int decimal(const char *s) {
 if (!s||!*s||(*s=='0'&&s[1])) return 0;
 unsigned long long n=0;for (;*s;++s) {if (*s<'0'||*s>'9'||n>(9223372036854775807ULL-(unsigned)(*s-'0'))/10) return 0;n=n*10+(unsigned)(*s-'0');}return 1;
}
static int secure_directory(const char *path) {
 if (!path||*path!='/') return 0;
 int fd=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC);char *copy=strdup(path),*save=NULL;if (fd<0||!copy) {if(fd>=0)close(fd);free(copy);return 0;}
 for(char *p=strtok_r(copy,"/",&save);p;p=strtok_r(NULL,"/",&save)) {
  if(!strcmp(p,".")||!strcmp(p,"..")){close(fd);free(copy);return 0;}
  int next=openat(fd,p,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(fd);fd=next;if(fd<0){free(copy);return 0;}
 }
 free(copy);struct stat st;int ok=!fstat(fd,&st)&&st.st_uid==geteuid()&&!(st.st_mode&077);close(fd);return ok;
}
static int load_config(const char *path,RunnerConfig *c) {
 char *data=NULL;size_t length=0;HfJson *j=malloc(sizeof *j);memset(c,0,sizeof *c);
 const char *keys[]={"transport_config","state_dir","slot_root","connector_plan_path","organisation_id","run_id","sandbox_id","boot_id","boot_generation","consumer_id","readiness_env_path","preparation_recipes"};
 int ok=j&&hf_private_read(path,65536,&data,&length)&&hf_json_parse(j,data)&&hf_json_only(j,0,keys,12)&&
 hf_json_get(j,"transport_config",c->transport,sizeof c->transport)&&hf_json_get(j,"state_dir",c->state,sizeof c->state)&&
 hf_json_get(j,"slot_root",c->slots,sizeof c->slots)&&hf_json_get(j,"connector_plan_path",c->plan,sizeof c->plan)&&
 hf_json_get(j,"organisation_id",c->organisation,sizeof c->organisation)&&hf_uuid_valid(c->organisation)&&
 hf_json_get(j,"run_id",c->run,sizeof c->run)&&hf_uuid_valid(c->run)&&hf_json_get(j,"sandbox_id",c->sandbox,sizeof c->sandbox)&&hf_uuid_valid(c->sandbox)&&
 hf_json_get(j,"boot_id",c->boot,sizeof c->boot)&&hf_uuid_valid(c->boot)&&hf_json_get(j,"boot_generation",c->generation,sizeof c->generation)&&decimal(c->generation)&&strcmp(c->generation,"0")&&
 hf_json_get(j,"consumer_id",c->consumer,sizeof c->consumer)&&*c->consumer&&secure_directory(c->state)&&geteuid()==0;
 free(data);free(j);return ok;
}
static int api(const RunnerConfig *c,const char *component,const char *action,const char *input,HfHttpResponse *response) {
 char *payload=NULL;size_t n=0;FILE *out=open_memstream(&payload,&n);char operation[37],idempotency[37],correlation[37];
 if(!out||!hf_uuid_generate(operation)||!hf_uuid_generate(idempotency)||!hf_uuid_generate(correlation)){if(out)fclose(out);free(payload);return 0;}
 fprintf(out,"{\"run_id\":\"%s\",\"component\":\"%s\",\"action\":\"%s\",\"input\":%s,\"expected_version\":null,\"authority\":null}",c->run,component,action,input);
 if(fclose(out)){free(payload);return 0;}
 int ok=hf_supervisor_call(c->transport,0,payload,operation,idempotency,correlation,NULL,NULL,NULL,response);free(payload);return ok;
}
static int result_json(HfHttpResponse *r,HfJson *j) {
 int accepted=0;return r->status>=200&&r->status<300&&r->body&&hf_json_parse(j,r->body)&&hf_json_bool(j,hf_json_field(j,0,"ok"),&accepted)&&accepted&&hf_json_field(j,0,"result")>=0;
}
static int placement(const RunnerConfig *c,const char *action,const char *job,const char *tool) {
 char input[256];snprintf(input,sizeof input,"{\"runner_action\":\"%s\"}",action);HfHttpResponse response={0};HfJson *j=malloc(sizeof *j);int ok=0;
 if(j&&api(c,"1.1","placement.runner.authorize",input,&response)&&result_json(&response,j)) {
  int r=hf_json_field(j,0,"result"),yes=0;char text[128];
  ok=hf_json_bool(j,hf_json_field(j,r,"authorized"),&yes)&&yes&&hf_json_string(j,hf_json_field(j,r,"runner_action"),text,sizeof text)&&!strcmp(text,action)&&
   hf_json_string(j,hf_json_field(j,r,"job_class"),text,sizeof text)&&!strcmp(text,job)&&hf_json_string(j,hf_json_field(j,r,"tool"),text,sizeof text)&&!strcmp(text,tool)&&
   hf_json_string(j,hf_json_field(j,r,"location"),text,sizeof text)&&!strcmp(text,"REMOTE_EXECUTION")&&hf_json_string(j,hf_json_field(j,r,"boot_generation"),text,sizeof text)&&!strcmp(text,c->generation);
 }
 free(j);hf_http_response_free(&response);return ok;
}
static int atstring(const HfJson *j,int o,const char *key,char *out,size_t n){return hf_json_string(j,hf_json_field(j,o,key),out,n);}
static int fetch_instruction(const RunnerConfig *c,const char *event,Instruction *i) {
 memset(i,0,sizeof *i);if(!hf_uuid_valid(event))return 0;snprintf(i->event,sizeof i->event,"%s",event);long long started=monotonic_ns();if(started<0)return 0;
 char *input=NULL;size_t n=0;FILE *out=open_memstream(&input,&n);if(!out)return 0;
 fprintf(out,"{\"organisation_id\":\"%s\",\"run_id\":\"%s\",\"event_id\":\"%s\",\"consumer_id\":",c->organisation,c->run,event);hf_json_write_string(out,c->consumer);fputc('}',out);fclose(out);
 HfHttpResponse response={0};HfJson *j=malloc(sizeof *j),*body=malloc(sizeof *body);int ok=0,accepted=0;char actual[128],*encoded=NULL;
 if(j&&body&&api(c,"6.3","instructions.handoff",input,&response)&&result_json(&response,j)) {
  int r=hf_json_field(j,0,"result");
  ok=hf_json_bool(j,hf_json_field(j,r,"accepted"),&accepted)&&accepted;
  const char *names[]={"organisation_id","run_id","sandbox_id","boot_id","sandbox_boot_generation"};
  const char *expected[]={c->organisation,c->run,c->sandbox,c->boot,c->generation};
  for(unsigned k=0;ok&&k<5;++k)ok=atstring(j,r,names[k],actual,sizeof actual)&&!strcmp(actual,expected[k]);
  ok=ok&&atstring(j,r,"command_id",i->command,sizeof i->command)&&hf_uuid_valid(i->command)&&atstring(j,r,"kind",i->kind,sizeof i->kind)&&
   atstring(j,r,"attempt_id",i->attempt,sizeof i->attempt)&&hf_uuid_valid(i->attempt)&&atstring(j,r,"attempt_generation",i->attempt_generation,sizeof i->attempt_generation)&&decimal(i->attempt_generation)&&
   atstring(j,r,"authority_epoch",i->epoch,sizeof i->epoch)&&hf_uuid_valid(i->epoch)&&atstring(j,r,"sequence",i->sequence,sizeof i->sequence)&&decimal(i->sequence)&&
   atstring(j,r,"payload_digest",i->digest,sizeof i->digest)&&strlen(i->digest)==71&&!strncmp(i->digest,"sha256:",7);
  int t=hf_json_field(j,r,"payload_base64url");if(ok&&t>=0){encoded=malloc(j->tokens[t].end-j->tokens[t].start+1);ok=encoded&&hf_json_string(j,t,encoded,j->tokens[t].end-j->tokens[t].start+1);}else ok=0;
  size_t bytes=0;unsigned char *decoded=ok?hf_base64url_decode(encoded,&bytes):NULL;char hash[65];
  ok=ok&&decoded&&bytes<=65536&&!memchr(decoded,0,bytes)&&hf_sha256_bytes(decoded,bytes,hash)&&!strcmp(i->digest+7,hash);
  if(ok){i->body=malloc(bytes+1);ok=i->body!=NULL;if(ok){memcpy(i->body,decoded,bytes);i->body[bytes]=0;ok=hf_json_parse(body,i->body)&&hf_json_get(body,"launch_id",i->launch,sizeof i->launch)&&hf_uuid_valid(i->launch);}}
  free(decoded);
  int64_t remaining=0;ok=ok&&hf_json_i64(j,hf_json_field(j,r,"remaining_lease_ms"),&remaining)&&remaining>=0&&remaining<=300000;
  if(ok&&(!strcmp(i->kind,"START")||!strcmp(i->kind,"STEER"))){i->deadline_ns=started+remaining*1000000LL;ok=remaining>0&&monotonic_ns()<i->deadline_ns;}
  if(ok&&!strcmp(i->kind,"START"))ok=hf_json_get(body,"slot_id",i->slot,sizeof i->slot)&&hf_uuid_valid(i->slot)&&hf_json_get(body,"agent_session_id",i->session,sizeof i->session)&&hf_uuid_valid(i->session)&&hf_json_get(body,"connector_plan_digest",i->plan_digest,sizeof i->plan_digest)&&strlen(i->plan_digest)==71&&!strncmp(i->plan_digest,"sha256:",7);
 }
 free(encoded);free(input);free(j);free(body);hf_http_response_free(&response);if(!ok){free(i->body);i->body=NULL;}return ok;
}
static sqlite3 *ledger(const RunnerConfig *c) {
 char path[4200];snprintf(path,sizeof path,"%s/launches.db",c->state);struct stat st;
 if(!lstat(path,&st)&&(!S_ISREG(st.st_mode)||st.st_uid!=geteuid()||(st.st_mode&077)||st.st_nlink!=1))return NULL;
 sqlite3 *db=NULL;mode_t mask=umask(077);int rc=sqlite3_open_v2(path,&db,SQLITE_OPEN_READWRITE|SQLITE_OPEN_CREATE|SQLITE_OPEN_FULLMUTEX,NULL);umask(mask);
 if(rc!=SQLITE_OK){sqlite3_close(db);return NULL;}sqlite3_busy_timeout(db,5000);
 if(sqlite3_exec(db,"PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;CREATE TABLE IF NOT EXISTS launches(id TEXT PRIMARY KEY,command TEXT UNIQUE NOT NULL,digest TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL,uid INTEGER NOT NULL,gid INTEGER NOT NULL,slot TEXT NOT NULL,identity TEXT NOT NULL,broker_pid INTEGER,broker_start TEXT,agent_pid INTEGER,agent_start TEXT,os_boot TEXT,exit_code INTEGER,updated INTEGER NOT NULL);CREATE UNIQUE INDEX IF NOT EXISTS active_slot_uid ON launches(uid) WHERE state NOT IN ('STOPPED','EXITED');CREATE TABLE IF NOT EXISTS native_ack_outbox(command TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(command,version));CREATE TABLE IF NOT EXISTS frames(id TEXT PRIMARY KEY,launch TEXT NOT NULL,digest TEXT NOT NULL,state TEXT NOT NULL);",NULL,NULL,NULL)!=SQLITE_OK){sqlite3_close(db);return NULL;}return db;
}
/* A frame UUID is one immutable launch/byte identity. Exact retries never
 * write stdin again; conflicting retries must not masquerade as duplicates. */
static int frame_reserve(sqlite3 *db,const char *id,const char *launch,const char *digest){
 sqlite3_stmt *q=NULL;int ok=sqlite3_prepare_v2(db,"INSERT INTO frames(id,launch,digest,state) VALUES(?,?,?,'SENDING') ON CONFLICT(id) DO NOTHING",-1,&q,NULL)==SQLITE_OK;
 if(ok){sqlite3_bind_text(q,1,id,-1,SQLITE_STATIC);sqlite3_bind_text(q,2,launch,-1,SQLITE_STATIC);sqlite3_bind_text(q,3,digest,-1,SQLITE_STATIC);ok=sqlite3_step(q)==SQLITE_DONE;}
 int inserted=ok&&sqlite3_changes(db)==1;sqlite3_finalize(q);if(!ok)return -2;if(inserted)return 1;
 q=NULL;ok=sqlite3_prepare_v2(db,"SELECT launch,digest FROM frames WHERE id=?",-1,&q,NULL)==SQLITE_OK;
 if(ok){sqlite3_bind_text(q,1,id,-1,SQLITE_STATIC);ok=sqlite3_step(q)==SQLITE_ROW&&!strcmp((const char*)sqlite3_column_text(q,0),launch)&&!strcmp((const char*)sqlite3_column_text(q,1),digest);}
 sqlite3_finalize(q);return ok?0:-1;
}
static int queue_ack(sqlite3 *db,const RunnerConfig *c,const Instruction *i,int version,const char *state,const HfProcessIdentity *process) {
 char *payload=NULL;size_t length=0;FILE *out=open_memstream(&payload,&length);if(!out)return 0;
 fprintf(out,"{\"organisation_id\":\"%s\",\"run_id\":\"%s\",\"command_id\":\"%s\",\"operation_id\":\"%s\",\"attempt_id\":\"%s\",\"attempt_generation\":\"%s\",\"authority_epoch\":\"%s\",\"sandbox_id\":\"%s\",\"boot_id\":\"%s\",\"sandbox_boot_generation\":\"%s\",\"sequence\":\"%s\",\"payload_digest\":\"%s\",\"ledger_receipt_id\":\"%s\",\"ledger_version\":\"%d\",\"state\":\"%s\",\"observed_process\":",c->organisation,c->run,i->command,i->command,i->attempt,i->attempt_generation,i->epoch,c->sandbox,c->boot,c->generation,i->sequence,i->digest,i->command,version,state);
 if(process)fprintf(out,"{\"os_boot_id\":\"%s\",\"pid\":%ld,\"start_time\":\"%llu\",\"pgid\":%ld}",process->os_boot_id,(long)process->pid,process->start_time,(long)process->pgid);else fputs("null",out);
 fputc('}',out);if(fclose(out)){free(payload);return 0;}sqlite3_stmt *q=NULL;
 int ok=sqlite3_prepare_v2(db,"INSERT INTO native_ack_outbox(command,version,payload) VALUES(?,?,?) ON CONFLICT(command,version) DO NOTHING",-1,&q,NULL)==SQLITE_OK;
 if(ok){sqlite3_bind_text(q,1,i->command,-1,SQLITE_STATIC);sqlite3_bind_int(q,2,version);sqlite3_bind_text(q,3,payload,-1,SQLITE_STATIC);ok=sqlite3_step(q)==SQLITE_DONE;}sqlite3_finalize(q);q=NULL;
 if(ok){ok=sqlite3_prepare_v2(db,"SELECT payload FROM native_ack_outbox WHERE command=? AND version=?",-1,&q,NULL)==SQLITE_OK;if(ok){sqlite3_bind_text(q,1,i->command,-1,SQLITE_STATIC);sqlite3_bind_int(q,2,version);ok=sqlite3_step(q)==SQLITE_ROW&&!strcmp((const char*)sqlite3_column_text(q,0),payload);}}sqlite3_finalize(q);free(payload);return ok;
}
static void flush_acks(sqlite3 *db,const RunnerConfig *c,const Instruction *i) {
 for(int round=0;round<4;++round){sqlite3_stmt *q=NULL;char *payload=NULL;int version=0;
  if(sqlite3_prepare_v2(db,"SELECT version,payload FROM native_ack_outbox WHERE command=? AND delivered=0 ORDER BY version LIMIT 1",-1,&q,NULL)!=SQLITE_OK)return;
  sqlite3_bind_text(q,1,i->command,-1,SQLITE_STATIC);if(sqlite3_step(q)==SQLITE_ROW){version=sqlite3_column_int(q,0);payload=strdup((const char*)sqlite3_column_text(q,1));}sqlite3_finalize(q);if(!payload)return;
  HfHttpResponse response={0};HfJson *j=malloc(sizeof *j);int ok=j&&api(c,"6.3","instructions.ack",payload,&response)&&result_json(&response,j);free(j);free(payload);hf_http_response_free(&response);if(!ok)return;
  if(sqlite3_prepare_v2(db,"UPDATE native_ack_outbox SET delivered=1 WHERE command=? AND version=?",-1,&q,NULL)==SQLITE_OK){sqlite3_bind_text(q,1,i->command,-1,SQLITE_STATIC);sqlite3_bind_int(q,2,version);sqlite3_step(q);}sqlite3_finalize(q);
 }
}
static int input_permitted(sqlite3 *db,const char *launch) {
 sqlite3_stmt *q=NULL;int ok=sqlite3_prepare_v2(db,"SELECT state FROM launches WHERE id=?",-1,&q,NULL)==SQLITE_OK;
 if(ok){sqlite3_bind_text(q,1,launch,-1,SQLITE_STATIC);ok=sqlite3_step(q)==SQLITE_ROW&&!strcmp((const char*)sqlite3_column_text(q,0),"RUNNING");}sqlite3_finalize(q);return ok;
}

static int uid_processes(uid_t uid,HfProcessIdentity *list,size_t capacity) {
 DIR *dir=opendir("/proc");if(!dir)return -1;struct dirent *entry;size_t count=0;
 while((entry=readdir(dir))){char *end;long pid=strtol(entry->d_name,&end,10);if(*end||pid<=0||pid>INT_MAX)continue;HfProcessIdentity p;if(hf_process_identity((pid_t)pid,&p)&&p.uid==uid&&p.state!='Z'&&p.state!='X'){if(count>=capacity){closedir(dir);return -1;}list[count++]=p;}}
 closedir(dir);return (int)count;
}
static int slot_identity(const RunnerConfig *c,Instruction *i) {
 char path[4200];snprintf(path,sizeof path,"%s/.supervisor-slots.db",c->slots);struct stat st;if(lstat(path,&st)||!S_ISREG(st.st_mode)||st.st_uid!=0||(st.st_mode&077))return 0;
 sqlite3 *db=NULL;sqlite3_stmt *q=NULL;int ok=sqlite3_open_v2(path,&db,SQLITE_OPEN_READONLY,NULL)==SQLITE_OK&&sqlite3_prepare_v2(db,"SELECT uid,gid,boot_id,state FROM slots WHERE id=?",-1,&q,NULL)==SQLITE_OK;
 if(ok){sqlite3_bind_text(q,1,i->slot,-1,SQLITE_STATIC);ok=sqlite3_step(q)==SQLITE_ROW&&sqlite3_column_int64(q,0)>0&&sqlite3_column_int64(q,1)>0&&!strcmp((const char*)sqlite3_column_text(q,2),c->boot)&&!strcmp((const char*)sqlite3_column_text(q,3),"READY");if(ok){i->uid=(uid_t)sqlite3_column_int64(q,0);i->gid=(gid_t)sqlite3_column_int64(q,1);}}
 sqlite3_finalize(q);sqlite3_close(db);
 const char *names[]={"worktree","build","home","tmp","sessions","logs"};
 for(unsigned k=0;ok&&k<6;++k){snprintf(path,sizeof path,"%s/%s/%s",c->slots,i->slot,names[k]);ok=!lstat(path,&st)&&S_ISDIR(st.st_mode)&&st.st_uid==i->uid&&st.st_gid==i->gid&&!(st.st_mode&077);}
 HfProcessIdentity processes[1024];return ok&&uid_processes(i->uid,processes,1024)==0;
}
static int hash_fd(int fd,char digest[65]) {
 EVP_MD_CTX *ctx=EVP_MD_CTX_new();unsigned char hash[32],buffer[65536];unsigned size=0;int ok=ctx&&EVP_DigestInit_ex(ctx,EVP_sha256(),NULL)==1;ssize_t n;
 while(ok&&(n=read(fd,buffer,sizeof buffer))>0)ok=EVP_DigestUpdate(ctx,buffer,(size_t)n)==1;
 ok=ok&&n==0&&EVP_DigestFinal_ex(ctx,hash,&size)==1&&size==32;EVP_MD_CTX_free(ctx);
 if(ok){for(unsigned k=0;k<32;++k)snprintf(digest+k*2,3,"%02x",hash[k]);ok=lseek(fd,0,SEEK_SET)==0;}return ok;
}
static int read_plan(const RunnerConfig *c,const Instruction *i,HfJson *j,char **source,char ***argv,int *binary) {
 size_t n=0;char hash[65],expected[72],cwd[4096],home[4096],tmp[4096],path[4200];int dispatch=0,supervised=0;
 if(!hf_private_read(c->plan,HF_BODY_LIMIT,source,&n)||!hf_sha256_bytes(*source,n,hash)||strcmp(hash,i->plan_digest+7)||!hf_json_parse(j,*source)||
 !hf_json_bool(j,hf_json_field(j,0,"dispatch_eligible"),&dispatch)||!dispatch||!hf_json_bool(j,hf_json_field(j,0,"requires_supervisor"),&supervised)||!supervised||
 !hf_json_get(j,"binary_digest",expected,sizeof expected)||strlen(expected)!=71||strncmp(expected,"sha256:",7)||!hf_json_get(j,"cwd",cwd,sizeof cwd)||!hf_json_get(j,"home",home,sizeof home)||!hf_json_get(j,"temp",tmp,sizeof tmp))return 0;
 snprintf(path,sizeof path,"%s/%s/worktree",c->slots,i->slot);if(strcmp(cwd,path))return 0;snprintf(path,sizeof path,"%s/%s/home",c->slots,i->slot);if(strcmp(home,path))return 0;snprintf(path,sizeof path,"%s/%s/tmp",c->slots,i->slot);if(strcmp(tmp,path))return 0;
 int array=hf_json_field(j,0,"argv");if(array<0||j->tokens[array].type!='['||j->tokens[array].count<1||j->tokens[array].count>256)return 0;
 *argv=calloc((size_t)j->tokens[array].count+1,sizeof(char*));if(!*argv)return 0;int k=0;
 for(int t=array+1;t<j->tokens[array].next;t=j->tokens[t].next){(*argv)[k]=malloc(4096);if(!(*argv)[k]||!hf_json_string(j,t,(*argv)[k],4096))return 0;++k;}
 if((*argv)[0][0]!='/')return 0;
 *binary=open((*argv)[0],O_RDONLY|O_NOFOLLOW|O_CLOEXEC);struct stat st;
 return *binary>=0&&!fstat(*binary,&st)&&S_ISREG(st.st_mode)&&st.st_uid==0&&!(st.st_mode&022)&&hash_fd(*binary,hash)&&!strcmp(hash,expected+7);
}
static void free_argv(char **argv){if(argv){for(int k=0;argv[k];++k)free(argv[k]);free(argv);}}
static int transfer(int fd,void *data,size_t n,int writing){unsigned char *p=data;while(n){ssize_t k=writing?send(fd,p,n,MSG_NOSIGNAL):read(fd,p,n);if(k<0&&errno==EINTR)continue;if(k<=0)return 0;p+=k;n-=(size_t)k;}return 1;}
static int send_packet(int fd,const char *data){size_t n=strlen(data);if(n>HF_BODY_LIMIT)return 0;uint32_t len=htonl((uint32_t)n);return transfer(fd,&len,4,1)&&transfer(fd,(void*)data,n,1);}
static char *receive_packet(int fd){uint32_t wire;if(!transfer(fd,&wire,4,0))return NULL;size_t n=ntohl(wire);if(!n||n>HF_BODY_LIMIT)return NULL;char *data=malloc(n+1);if(!data)return NULL;if(!transfer(fd,data,n,0)||memchr(data,0,n)){free(data);return NULL;}data[n]=0;return data;}
static int socket_path(const char *state,const char *launch,char path[108]){return hf_uuid_valid(launch)&&snprintf(path,108,"%s/%s.sock",state,launch)<108;}
int hf_launch_rpc(const char *state,const char *action,const char *payload,FILE *output) {
 HfJson *j=malloc(sizeof *j);char launch[37],path[108];int ok=j&&secure_directory(state)&&hf_json_parse(j,payload)&&hf_json_get(j,"launch_id",launch,sizeof launch)&&socket_path(state,launch,path);free(j);if(!ok)return hf_native_error(output,"UNTRUSTED_LAUNCH_TARGET");
 int fd=socket(AF_UNIX,SOCK_STREAM|SOCK_CLOEXEC,0);struct sockaddr_un addr={.sun_family=AF_UNIX};snprintf(addr.sun_path,sizeof addr.sun_path,"%s",path);struct timeval timeout={.tv_sec=10};
 if(fd<0)return hf_native_error(output,"IPC_UNAVAILABLE");
 setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&timeout,sizeof timeout);setsockopt(fd,SOL_SOCKET,SO_SNDTIMEO,&timeout,sizeof timeout);
 struct ucred cred;socklen_t length=sizeof cred;
 if(connect(fd,(struct sockaddr*)&addr,sizeof addr)||getsockopt(fd,SOL_SOCKET,SO_PEERCRED,&cred,&length)||cred.uid!=geteuid()){close(fd);return hf_native_error(output,"BROKER_UNAVAILABLE_RECOVERY_REQUIRED");}
 char *request=NULL;size_t n=0;FILE *out=open_memstream(&request,&n);if(!out){close(fd);return 1;}fputs("{\"action\":",out);hf_json_write_string(out,action);fprintf(out,",\"input\":%s}",payload);fclose(out);
 ok=send_packet(fd,request);free(request);char *response=ok?receive_packet(fd):NULL;close(fd);if(!response)return hf_native_error(output,"IPC_DELIVERY_UNCERTAIN");
 j=malloc(sizeof *j);ok=j&&hf_json_parse(j,response);free(j);if(ok)fputs(response,output);free(response);return ok?0:1;
}
static void state_update(sqlite3 *db,const char *launch,const char *state,int exit_code) {
 sqlite3_stmt *q=NULL;if(sqlite3_prepare_v2(db,"UPDATE launches SET state=?,exit_code=?,updated=unixepoch() WHERE id=?",-1,&q,NULL)==SQLITE_OK){sqlite3_bind_text(q,1,state,-1,SQLITE_STATIC);sqlite3_bind_int(q,2,exit_code);sqlite3_bind_text(q,3,launch,-1,SQLITE_STATIC);sqlite3_step(q);}sqlite3_finalize(q);
}
static int stop_uid(uid_t uid) {
 HfProcessIdentity list[1024];int count=uid_processes(uid,list,1024);if(count<0)return 0;
 for(int k=0;k<count;++k)if(hf_process_matches(&list[k],NULL))kill(list[k].pid,SIGTERM);
 struct timespec delay={.tv_nsec=100000000};nanosleep(&delay,NULL);
 for(int round=0;round<30;++round){count=uid_processes(uid,list,1024);if(count==0)return 1;if(count<0)return 0;for(int k=0;k<count;++k)if(hf_process_matches(&list[k],NULL))kill(list[k].pid,SIGKILL);while(waitpid(-1,NULL,WNOHANG)>0){}nanosleep(&delay,NULL);}return 0;
}
/* This separate root process enforces the last primary-observed monotonic
 * deadline even while the broker is blocked in HTTPS or local IPC. Pipe loss
 * means broker death, never authority to keep the dedicated slot UID alive. */
int hf_slot_owner(uid_t uid,const char *owner) {
 char path[128],value[128]={0};snprintf(path,sizeof path,"/run/hyperfide/slot-%u.lock",(unsigned)uid);
 int fd=open(path,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);struct stat st;int ok=fd>=0&&!fstat(fd,&st)&&S_ISREG(st.st_mode)&&st.st_uid==0&&!(st.st_mode&077)&&st.st_nlink==1;
 ssize_t n=ok?read(fd,value,sizeof value-1):-1;if(fd>=0)close(fd);return n>0&&!strcmp(value,owner);
}
int hf_slot_control_lock(uid_t uid,const char *owner) {
 char path[128];snprintf(path,sizeof path,"/run/hyperfide/slot-%u.lock",(unsigned)uid);
 int fd=open(path,O_RDWR|O_CLOEXEC|O_NOFOLLOW);struct stat st;
 if(fd<0||fstat(fd,&st)||!S_ISREG(st.st_mode)||st.st_uid!=0||(st.st_mode&077)||st.st_nlink!=1||flock(fd,LOCK_EX|LOCK_NB)||!hf_slot_owner(uid,owner)){if(fd>=0)close(fd);return -1;}
 return fd;
}
pid_t hf_slot_watchdog(uid_t uid,long long deadline,int *writer,const char *owner) {
 struct stat st;if(!hf_uuid_valid(owner)||geteuid()!=0)return -1;
 if(mkdir("/run/hyperfide",0700)&&errno!=EEXIST)return -1;
 if(lstat("/run/hyperfide",&st)||!S_ISDIR(st.st_mode)||st.st_uid!=0||(st.st_mode&077))return -1;
 char path[128];snprintf(path,sizeof path,"/run/hyperfide/slot-%u.lock",(unsigned)uid);
 int lock=open(path,O_RDWR|O_CREAT|O_CLOEXEC|O_NOFOLLOW,0600);
 if(lock<0||fstat(lock,&st)||!S_ISREG(st.st_mode)||st.st_uid!=0||(st.st_mode&077)||st.st_nlink!=1||flock(lock,LOCK_EX|LOCK_NB)||ftruncate(lock,0)||write(lock,owner,strlen(owner))!=(ssize_t)strlen(owner)||fsync(lock)){if(lock>=0)close(lock);return -1;}
 int channel[2];if(pipe2(channel,O_CLOEXEC|O_NONBLOCK)){close(lock);return -1;}
 pid_t child=fork();if(child<0){close(channel[0]);close(channel[1]);close(lock);return -1;}
 if(child==0){
  close(channel[1]);int readfd=fcntl(channel[0],F_DUPFD_CLOEXEC,10),lockfd=fcntl(lock,F_DUPFD_CLOEXEC,10);
  if(readfd<0||lockfd<0||dup3(readfd,3,O_CLOEXEC)<0||dup3(lockfd,4,O_CLOEXEC)<0||close_range(5,~0U,0))_exit(125);
  for(;;){
   long long now=monotonic_ns();if(now<0||now>=deadline){stop_uid(uid);_exit(0);}
   long long left=(deadline-now+999999)/1000000;int milliseconds=left>1000?1000:(int)left;
   struct pollfd item={3,POLLIN,0};int n=poll(&item,1,milliseconds);
   if(n<0&&errno==EINTR)continue;
   if(n<0||(item.revents&(POLLHUP|POLLERR|POLLNVAL))){stop_uid(uid);_exit(0);}
   if(item.revents&POLLIN){long long next;ssize_t bytes=read(3,&next,sizeof next);now=monotonic_ns();if(bytes==sizeof next&&next==0){stop_uid(uid);_exit(0);}if(bytes!=sizeof next||now<0||now>=deadline||next<=now){stop_uid(uid);_exit(0);}deadline=next;}
  }
 }
 close(channel[0]);close(lock);*writer=channel[1];return child;
}
int hf_slot_watchdog_finish(pid_t guard,int *writer) {
 if(*writer>=0){long long disarm=0;ssize_t written=write(*writer,&disarm,sizeof disarm);(void)written;close(*writer);*writer=-1;}
 int status;pid_t waited;do{waited=waitpid(guard,&status,0);}while(waited<0&&errno==EINTR);
 return waited==guard&&WIFEXITED(status)&&WEXITSTATUS(status)==0;
}
static char *broker_observation(const RunnerConfig *c,const Instruction *i,const HfProcessIdentity *broker,const HfProcessIdentity *agent,const char *state,int exit_code,const char *command,int ipc_closed) {
 char *data=NULL;size_t n=0;FILE *out=open_memstream(&data,&n);if(!out)return NULL;char observation[37];hf_uuid_generate(observation);time_t now=time(NULL);
 fprintf(out,"{\"status\":\"%s\",\"command_id\":",!strcmp(state,"STOPPED")?"CONFIRMED_STOPPED":!strcmp(state,"RUNNING")?"RUNNING":"UNKNOWN");if(command&&*command)hf_json_write_string(out,command);else fputs("null",out);
 fprintf(out,",\"launch_id\":\"%s\",\"agent_session_id\":\"%s\",\"organisation_id\":\"%s\",\"run_id\":\"%s\",\"attempt_id\":\"%s\",\"attempt_generation\":\"%s\",\"sandbox_id\":\"%s\",\"boot_id\":\"%s\",\"boot_generation\":\"%s\",\"authority_epoch\":\"%s\",\"observation_id\":\"%s\",\"observed_at_seconds\":%lld,\"state\":\"%s\",\"exit_code\":%d,\"broker\":",i->launch,i->session,c->organisation,c->run,i->attempt,i->attempt_generation,c->sandbox,c->boot,c->generation,i->epoch,observation,(long long)now,state,exit_code);hf_process_json(out,broker);fputs(",\"agent\":",out);hf_process_json(out,agent);
 HfProcessIdentity list[1024];int count=uid_processes(i->uid,list,1024);fputs(",\"processes\":[",out);for(int k=0;k<count;++k){if(k)fputc(',',out);hf_process_json(out,&list[k]);}
 fprintf(out,"],\"remaining_descendants\":%d,\"ipc_closed\":%s,\"required_artifacts\":[],\"credential_revocation\":[],\"cleanup_complete\":false,\"resource_observation_complete\":%s}",count<0?-1:count,ipc_closed?"true":"false",count<0?"false":"true");fclose(out);return data;
}
static int append_log(int fd,const void *data,size_t n){const char *p=data;while(n){ssize_t w=write(fd,p,n);if(w<0&&errno==EINTR)continue;if(w<=0)return 0;p+=w;n-=(size_t)w;}return 1;}
static void broker(const RunnerConfig *c,const Instruction *i,HfJson *plan,char **argv,int binary,int ready) {
 signal(SIGPIPE,SIG_IGN);prctl(PR_SET_CHILD_SUBREAPER,1);setsid();
 int nullfd=open("/dev/null",O_RDWR|O_CLOEXEC);if(nullfd<0)_exit(125);
 for(int descriptor=0;descriptor<3;++descriptor)if(dup2(nullfd,descriptor)<0)_exit(125);
 if(nullfd>2)close(nullfd);
 sqlite3 *db=ledger(c);char path[4200],socketname[108];int server=-1,log_out=-1,log_err=-1,watch_write=-1,input[2],output[2],error[2],gate[2];
 if(!db||!socket_path(c->state,i->launch,socketname))goto failed;
 server=socket(AF_UNIX,SOCK_STREAM|SOCK_CLOEXEC|SOCK_NONBLOCK,0);struct sockaddr_un address={.sun_family=AF_UNIX};snprintf(address.sun_path,sizeof address.sun_path,"%s",socketname);
 if(server<0||bind(server,(struct sockaddr*)&address,sizeof address)||chmod(socketname,0600)||listen(server,16))goto failed;
 snprintf(path,sizeof path,"%s/%s.stdout",c->state,i->launch);log_out=open(path,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);snprintf(path,sizeof path,"%s/%s.stderr",c->state,i->launch);log_err=open(path,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);
 if(log_out<0||log_err<0||pipe2(input,O_CLOEXEC)||pipe2(output,O_CLOEXEC)||pipe2(error,O_CLOEXEC)||pipe2(gate,O_CLOEXEC))goto failed;
 pid_t watchdog=hf_slot_watchdog(i->uid,i->deadline_ns,&watch_write,i->launch);if(watchdog<0)goto failed;
 pid_t parent=getpid();pid_t agent=fork();if(agent<0)goto failed;
 if(agent==0){close(gate[1]);close(input[1]);close(output[0]);close(error[0]);prctl(PR_SET_PDEATHSIG,SIGKILL);if(getppid()==1)_exit(125);setpgid(0,0);char release;
  if(read(gate[0],&release,1)!=1||release!='G')_exit(125);
  close(gate[0]);
  if(dup2(input[0],0)<0||dup2(output[1],1)<0||dup2(error[1],2)<0)_exit(125);
  char cwd[4096],home[4096],tmp[4096];if(!hf_json_get(plan,"cwd",cwd,sizeof cwd)||!hf_json_get(plan,"home",home,sizeof home)||!hf_json_get(plan,"temp",tmp,sizeof tmp))_exit(125);
  if(clearenv()||setenv("PATH","/usr/local/bin:/usr/bin:/bin",1)||setenv("HOME",home,1)||setenv("TMPDIR",tmp,1)||setenv("HF_JOB_HOME",home,1)||setenv("HF_JOB_TMPDIR",tmp,1))_exit(125);
  int env=hf_json_field(plan,0,"environment");const char *allowed[]={"CODEX_HOME","CLAUDE_CONFIG_DIR","SSL_CERT_FILE","NODE_EXTRA_CA_CERTS"};
  if(env>=0){if(!hf_json_only(plan,env,allowed,4))_exit(125);for(unsigned k=0;k<4;++k){char value[4096];int t=hf_json_field(plan,env,allowed[k]);if(t>=0&&(!hf_json_string(plan,t,value,sizeof value)||setenv(allowed[k],value,1)))_exit(125);}}
  if(setgroups(0,NULL)||setgid(i->gid)||setuid(i->uid)||chdir(cwd)||prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0))_exit(125);
  umask(0077);if(prctl(PR_SET_PDEATHSIG,SIGKILL)||getppid()!=parent)_exit(125);if(binary!=3&&dup3(binary,3,O_CLOEXEC)<0)_exit(125);
  if(close_range(4,~0U,0))_exit(125);
  fexecve(3,argv,environ);_exit(127);
 }
 close(gate[0]);close(input[0]);close(output[1]);close(error[1]);close(binary);
 HfProcessIdentity bp,ap;int identity=hf_process_identity(getpid(),&bp)&&hf_process_identity(agent,&ap);sqlite3_stmt *q=NULL;
 if(identity&&sqlite3_prepare_v2(db,"UPDATE launches SET state='RUNNING',broker_pid=?,broker_start=?,agent_pid=?,agent_start=?,os_boot=?,updated=unixepoch() WHERE id=? AND state='ACCEPTED'",-1,&q,NULL)==SQLITE_OK){char bs[32],as[32];snprintf(bs,sizeof bs,"%llu",bp.start_time);snprintf(as,sizeof as,"%llu",ap.start_time);sqlite3_bind_int(q,1,getpid());sqlite3_bind_text(q,2,bs,-1,SQLITE_TRANSIENT);sqlite3_bind_int(q,3,agent);sqlite3_bind_text(q,4,as,-1,SQLITE_TRANSIENT);sqlite3_bind_text(q,5,ap.os_boot_id,-1,SQLITE_STATIC);sqlite3_bind_text(q,6,i->launch,-1,SQLITE_STATIC);identity=sqlite3_step(q)==SQLITE_DONE&&sqlite3_changes(db)==1;}else identity=0;sqlite3_finalize(q);
 if(!identity||!queue_ack(db,c,i,2,"EXECUTING",&ap)||monotonic_ns()>=i->deadline_ns||write(gate[1],"G",1)!=1){kill(agent,SIGKILL);close(gate[1]);waitpid(agent,NULL,0);goto failed;}close(gate[1]);
 fcntl(input[1],F_SETFL,O_NONBLOCK);fcntl(output[0],F_SETFL,O_NONBLOCK);fcntl(error[0],F_SETFL,O_NONBLOCK);
 if(write(ready,"R",1)!=1){/* Controller loss is not cancellation. */}close(ready);ready=-1;
 long long deadline=i->deadline_ns,next_refresh=0;
 const char *state="RUNNING";int exit_code=-1,stdin_open=1;unsigned long long bytes_out=0,bytes_err=0;char stopped_by[37]="";
 for(;;){
  long long now=monotonic_ns();
  if(!strcmp(state,"RUNNING")&&now>=deadline){if(stdin_open){close(input[1]);stdin_open=0;}stop_uid(i->uid);hf_slot_watchdog_finish(watchdog,&watch_write);state="LEASE_EXPIRED";state_update(db,i->launch,state,exit_code);if(!queue_ack(db,c,i,3,"TERMINAL",&ap)){stop_uid(i->uid);state="UNCERTAIN";state_update(db,i->launch,state,exit_code);}}
  if(now>=next_refresh){
   if(!strcmp(state,"RUNNING")){Instruction fresh;if(fetch_instruction(c,i->event,&fresh)){if(!strcmp(fresh.command,i->command)&&!strcmp(fresh.digest,i->digest)&&fresh.deadline_ns>monotonic_ns()&&monotonic_ns()<deadline){long long next=fresh.deadline_ns;if(write(watch_write,&next,sizeof next)==sizeof next)deadline=next;else{stop_uid(i->uid);state="UNCERTAIN";}}free(fresh.body);}}
   flush_acks(db,c,i);next_refresh=monotonic_ns()+30000000000LL;
  }
  int status=0;pid_t reaped;while((reaped=waitpid(-1,&status,WNOHANG))>0)if(reaped==agent){exit_code=WIFEXITED(status)?WEXITSTATUS(status):128+WTERMSIG(status);if(stdin_open){close(input[1]);stdin_open=0;}int absent=stop_uid(i->uid);hf_slot_watchdog_finish(watchdog,&watch_write);state=absent?"EXITED":"UNCERTAIN";state_update(db,i->launch,state,exit_code);if(!queue_ack(db,c,i,3,"TERMINAL",&ap)){stop_uid(i->uid);state="UNCERTAIN";state_update(db,i->launch,state,exit_code);}}
  struct pollfd fds[]={{server,POLLIN,0},{output[0],POLLIN,0},{error[0],POLLIN,0}};int polled=poll(fds,3,200);if(polled<0&&errno!=EINTR){state="UNCERTAIN";break;}
  for(int k=1;k<3;++k)if(fds[k].revents&(POLLIN|POLLHUP)){char buffer[65536];ssize_t n;while((n=read(fds[k].fd,buffer,sizeof buffer))>0){unsigned long long *total=k==1?&bytes_out:&bytes_err;if(*total+(unsigned long long)n>64ULL*1024*1024||!append_log(k==1?log_out:log_err,buffer,(size_t)n)){state="SPOOL_EXHAUSTED";stop_uid(i->uid);break;}*total+=(unsigned long long)n;}}
  if(!(fds[0].revents&POLLIN))continue;
  int client=accept4(server,NULL,NULL,SOCK_CLOEXEC);if(client<0)continue;struct ucred peer;socklen_t peer_size=sizeof peer;struct timeval timeout={.tv_sec=3};setsockopt(client,SOL_SOCKET,SO_RCVTIMEO,&timeout,sizeof timeout);setsockopt(client,SOL_SOCKET,SO_SNDTIMEO,&timeout,sizeof timeout);
  if(getsockopt(client,SOL_SOCKET,SO_PEERCRED,&peer,&peer_size)||peer.uid!=geteuid()){close(client);continue;}
  char *request=receive_packet(client),*reply=NULL;size_t reply_n=0;FILE *out=open_memstream(&reply,&reply_n);HfJson *j=malloc(sizeof *j);char action[64],target[37];int valid=request&&out&&j&&hf_json_parse(j,request)&&hf_json_get(j,"action",action,sizeof action);int payload=valid?hf_json_field(j,0,"input"):-1;
  valid=valid&&payload>=0&&atstring(j,payload,"launch_id",target,sizeof target)&&!strcmp(target,i->launch);
  const char *ids[]={"attempt_id","attempt_generation","sandbox_id","boot_id","boot_generation"};const char *values[]={i->attempt,i->attempt_generation,c->sandbox,c->boot,c->generation};
  for(unsigned k=0;valid&&k<5;++k){char value[128];valid=atstring(j,payload,ids[k],value,sizeof value)&&!strcmp(value,values[k]);}
  if(!valid||watch_write<0||!hf_slot_owner(i->uid,i->launch)){if(out)hf_native_error(out,"IDENTITY_MISMATCH");}
  else if(!strcmp(action,"runner.observe")||!strcmp(action,"launch.status")){char *obs=broker_observation(c,i,&bp,&ap,state,exit_code,stopped_by,!stdin_open);if(obs){fputs(obs,out);free(obs);}else hf_native_error(out,"OBSERVATION_FAILED");}
  else if(!strcmp(action,"runner.stop")||!strcmp(action,"launch.cancel")){
   char command[37];if(!atstring(j,payload,"command_id",command,sizeof command)||!hf_uuid_valid(command))hf_native_error(out,"INVALID_COMMAND");
   else{snprintf(stopped_by,sizeof stopped_by,"%s",command);state_update(db,i->launch,"STOPPING",exit_code);if(stdin_open){close(input[1]);stdin_open=0;}int stopped=stop_uid(i->uid);hf_slot_watchdog_finish(watchdog,&watch_write);state=stopped?"STOPPED":"UNCERTAIN";state_update(db,i->launch,state,exit_code);fsync(log_out);fsync(log_err);char *obs=broker_observation(c,i,&bp,&ap,state,exit_code,command,1);if(obs){fputs(obs,out);free(obs);}else hf_native_error(out,"OBSERVATION_FAILED");}
  }else if(!strcmp(action,"launch.send")){
   char request_id[37],digest[72],encoded[8192];int accepted=atstring(j,payload,"request_id",request_id,sizeof request_id)&&hf_uuid_valid(request_id)&&atstring(j,payload,"frame_b64",encoded,sizeof encoded)&&stdin_open&&!strcmp(state,"RUNNING")&&input_permitted(db,i->launch);size_t length=0;unsigned char *frame=accepted?hf_base64url_decode(encoded,&length):NULL;char hash[65];accepted=accepted&&frame&&length>0&&length<=4096&&hf_sha256_bytes(frame,length,hash);snprintf(digest,sizeof digest,"sha256:%s",accepted?hash:"");
   sqlite3_stmt *s=NULL;const char *delivery="REJECTED";
   if(accepted){
    int reservation=frame_reserve(db,request_id,i->launch,digest);
    if(reservation==1){ssize_t sent=write(input[1],frame,length);delivery=sent==(ssize_t)length?"WRITTEN_UNACKNOWLEDGED":"UNCERTAIN";int saved=sqlite3_prepare_v2(db,"UPDATE frames SET state=? WHERE id=?",-1,&s,NULL)==SQLITE_OK;if(saved){sqlite3_bind_text(s,1,delivery,-1,SQLITE_STATIC);sqlite3_bind_text(s,2,request_id,-1,SQLITE_STATIC);saved=sqlite3_step(s)==SQLITE_DONE&&sqlite3_changes(db)==1;}sqlite3_finalize(s);s=NULL;if(!saved)delivery="UNCERTAIN";}
    else delivery=reservation==0?"DUPLICATE_NOT_REPLAYED":reservation==-1?"FRAME_IDENTITY_CONFLICT":"LEDGER_UNAVAILABLE";
   }
   free(frame);fprintf(out,"{\"delivery\":\"%s\",\"replay_safe\":false,\"native_acknowledged\":false}",delivery);
  }else hf_native_error(out,"UNKNOWN_BROKER_ACTION");
  if(out){fclose(out);if(reply)send_packet(client,reply);}free(reply);free(request);free(j);close(client);
 }
 stop_uid(i->uid);state_update(db,i->launch,"UNCERTAIN",exit_code);
 failed:
 if(watch_write>=0)close(watch_write);
 if(ready>=0){ssize_t notice=write(ready,"F",1);(void)notice;close(ready);}if(db)sqlite3_close(db);if(server>=0)close(server);if(log_out>=0)close(log_out);if(log_err>=0)close(log_err);_exit(0);
}
static int launch_start(const RunnerConfig *c,Instruction *i,FILE *out) {
 if(strcmp(i->kind,"START"))return hf_native_error(out,"NOT_A_START_INSTRUCTION");
 sqlite3 *db=ledger(c);if(!db)return hf_native_error(out,"LEDGER_UNAVAILABLE");sqlite3_stmt *q=NULL;
 if(sqlite3_exec(db,"BEGIN IMMEDIATE",NULL,NULL,NULL)!=SQLITE_OK){sqlite3_close(db);return hf_native_error(out,"LEDGER_BUSY");}
 int rc=sqlite3_prepare_v2(db,"SELECT command,digest,state FROM launches WHERE id=?",-1,&q,NULL);if(rc==SQLITE_OK)sqlite3_bind_text(q,1,i->launch,-1,SQLITE_STATIC);
 if(rc!=SQLITE_OK){sqlite3_exec(db,"ROLLBACK",NULL,NULL,NULL);sqlite3_close(db);return 1;}
 int step=sqlite3_step(q);if(step==SQLITE_ROW){int same=!strcmp((const char*)sqlite3_column_text(q,0),i->command)&&!strcmp((const char*)sqlite3_column_text(q,1),i->digest);char state[32];snprintf(state,sizeof state,"%s",sqlite3_column_text(q,2));sqlite3_finalize(q);sqlite3_exec(db,"ROLLBACK",NULL,NULL,NULL);sqlite3_close(db);if(!same)return hf_native_error(out,"START_IDENTITY_CONFLICT");fprintf(out,"{\"launch_id\":\"%s\",\"state\":\"%s\",\"replayed\":true,\"spawned_again\":false}",i->launch,state);return 0;}
 sqlite3_finalize(q);
 if(!slot_identity(c,i)||!placement(c,"runner.agent.launch","implementation","native.spawn")){sqlite3_exec(db,"ROLLBACK",NULL,NULL,NULL);sqlite3_close(db);return hf_native_error(out,"SLOT_OR_PLACEMENT_NOT_CURRENT");}
 HfJson *plan=malloc(sizeof *plan);char *plan_source=NULL,**argv=NULL;int binary=-1;
 if(!plan||!read_plan(c,i,plan,&plan_source,&argv,&binary)){if(binary>=0)close(binary);free_argv(argv);free(plan_source);free(plan);sqlite3_exec(db,"ROLLBACK",NULL,NULL,NULL);sqlite3_close(db);return hf_native_error(out,"CONNECTOR_PLAN_NOT_QUALIFIED");}
 char *identity=NULL;size_t n=0;FILE *writer=open_memstream(&identity,&n);if(!writer){sqlite3_exec(db,"ROLLBACK",NULL,NULL,NULL);sqlite3_close(db);close(binary);free_argv(argv);free(plan_source);free(plan);return 1;}
 fprintf(writer,"{\"organisation_id\":\"%s\",\"run_id\":\"%s\",\"sandbox_id\":\"%s\",\"boot_id\":\"%s\",\"boot_generation\":\"%s\",\"attempt_id\":\"%s\",\"attempt_generation\":\"%s\",\"authority_epoch\":\"%s\",\"agent_session_id\":\"%s\"}",c->organisation,c->run,c->sandbox,c->boot,c->generation,i->attempt,i->attempt_generation,i->epoch,i->session);fclose(writer);
 rc=sqlite3_prepare_v2(db,"INSERT INTO launches(id,command,digest,body,state,uid,gid,slot,identity,updated) VALUES(?,?,?,?,'ACCEPTED',?,?,?,?,unixepoch())",-1,&q,NULL);
 if(rc==SQLITE_OK){sqlite3_bind_text(q,1,i->launch,-1,SQLITE_STATIC);sqlite3_bind_text(q,2,i->command,-1,SQLITE_STATIC);sqlite3_bind_text(q,3,i->digest,-1,SQLITE_STATIC);sqlite3_bind_text(q,4,i->body,-1,SQLITE_STATIC);sqlite3_bind_int64(q,5,i->uid);sqlite3_bind_int64(q,6,i->gid);sqlite3_bind_text(q,7,i->slot,-1,SQLITE_STATIC);sqlite3_bind_text(q,8,identity,-1,SQLITE_STATIC);rc=sqlite3_step(q);}sqlite3_finalize(q);free(identity);
 int accepted=rc==SQLITE_DONE&&queue_ack(db,c,i,1,"ACCEPTED",NULL)&&sqlite3_exec(db,"COMMIT",NULL,NULL,NULL)==SQLITE_OK;if(!accepted)sqlite3_exec(db,"ROLLBACK",NULL,NULL,NULL);sqlite3_close(db);int ready[2];
 if(!accepted||pipe2(ready,O_CLOEXEC)){close(binary);free_argv(argv);free(plan_source);free(plan);return hf_native_error(out,"DURABLE_ACCEPTANCE_FAILED");}
 pid_t child=fork();if(child==0){close(ready[0]);broker(c,i,plan,argv,binary,ready[1]);}close(ready[1]);close(binary);free_argv(argv);free(plan_source);free(plan);
 struct pollfd pollfd={ready[0],POLLIN,0};char status='F';if(child>0&&poll(&pollfd,1,10000)>0&&read(ready[0],&status,1)!=1)status='F';close(ready[0]);
 fprintf(out,"{\"launch_id\":\"%s\",\"command_id\":\"%s\",\"state\":\"%s\",\"durably_accepted\":true,\"replayed\":false,\"native_session_observed\":false}",i->launch,i->command,status=='R'?"EXECUTING":"UNCERTAIN");return 0;
}
int hf_component_12_2(const char *action,const char *request,FILE *out) {
 HfJson *j=malloc(sizeof *j);char config_path[4096],event[37];RunnerConfig c;Instruction instruction;const char *keys[]={"config_path","event_id"};
 int ok=j&&hf_json_parse(j,request)&&hf_json_only(j,0,keys,2)&&hf_json_get(j,"config_path",config_path,sizeof config_path)&&hf_json_get(j,"event_id",event,sizeof event)&&load_config(config_path,&c);free(j);
 if(!ok)return hf_native_error(out,"UNTRUSTED_RUNNER_CONFIG");
 if(!fetch_instruction(&c,event,&instruction))return hf_native_error(out,"CURRENT_INSTRUCTION_UNAVAILABLE");
 int result=1;if(!strcmp(action,"launch.start"))result=launch_start(&c,&instruction,out);
 else if(!strcmp(action,"launch.instruction")){
  if(!strcmp(instruction.kind,"START"))result=launch_start(&c,&instruction,out);
  else {HfJson *body=malloc(sizeof *body);char *payload=NULL;size_t n=0;FILE *writer=open_memstream(&payload,&n);if(body&&writer&&hf_json_parse(body,instruction.body)){
    fprintf(writer,"{\"launch_id\":\"%s\",\"attempt_id\":\"%s\",\"attempt_generation\":\"%s\",\"sandbox_id\":\"%s\",\"boot_id\":\"%s\",\"boot_generation\":\"%s\",\"command_id\":\"%s\"",instruction.launch,instruction.attempt,instruction.attempt_generation,c.sandbox,c.boot,c.generation,instruction.command);
    if(!strcmp(instruction.kind,"STEER")){char frame[8192],id[37];if(hf_json_get(body,"frame_b64",frame,sizeof frame)&&hf_json_get(body,"request_id",id,sizeof id)&&hf_uuid_valid(id)){fputs(",\"frame_b64\":",writer);hf_json_write_string(writer,frame);fprintf(writer,",\"request_id\":\"%s\"",id);}else result=hf_native_error(out,"INVALID_FRAME");}
    fputc('}',writer);fclose(writer);writer=NULL;
    if(!strcmp(instruction.kind,"CANCEL"))result=hf_launch_rpc(c.state,"launch.cancel",payload,out);
    else if(!strcmp(instruction.kind,"STEER"))result=hf_launch_rpc(c.state,"launch.send",payload,out);
   }if(writer)fclose(writer);free(payload);free(body);}
 }else result=hf_native_error(out,"UNKNOWN_ACTION");free(instruction.body);return result;
}

int hf_runner_job_claim(const char *config_path,const char *operation,HfHttpResponse *response) {
 RunnerConfig c;if(!hf_uuid_valid(operation)||!load_config(config_path,&c))return 0;
 char input[128];snprintf(input,sizeof input,"{\"operation_id\":\"%s\"}",operation);HfJson *j=malloc(sizeof *j);int ok=j&&api(&c,"12.4","runner.job.claim",input,response)&&result_json(response,j);
 if(ok){int result=hf_json_field(j,0,"result"),binding=hf_json_field(j,result,"binding");char actual[128];const char *names[]={"organisation_id","run_id","sandbox_id","boot_id","boot_generation"};const char *expected[]={c.organisation,c.run,c.sandbox,c.boot,c.generation};for(unsigned k=0;ok&&k<5;++k)ok=atstring(j,binding,names[k],actual,sizeof actual)&&!strcmp(actual,expected[k]);}
 free(j);return ok;
}
int hf_runner_job_placement(const char *config_path,const char *action) {
 RunnerConfig c;if(!load_config(config_path,&c))return 0;
 const char *job=!strcmp(action,"runner.test.execute")?"test":!strcmp(action,"runner.review.execute")?"review_execution":!strcmp(action,"runner.integration.execute")?"integration":!strcmp(action,"runner.index.execute")?"indexing":!strcmp(action,"runner.build.execute")?"build":NULL;
 return job&&placement(&c,action,job,"native.spawn");
}
