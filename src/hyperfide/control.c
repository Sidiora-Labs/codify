#define _GNU_SOURCE
#include "components.h"
#include "supervisor.h"
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <signal.h>
#include <sqlite3.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include <openssl/evp.h>

/* Runner control semantics (execution-contract §5.1, req 12 ac_4):
 *  pause   PAUSING->PAUSED       close input + job admission, SIGSTOP the slot-UID tree, keep processes.
 *  drain   DRAINING->DRAINED     close input + admission, let in-flight work finish; at the policy
 *                                deadline either keep reporting DRAINING or terminate (on_drain_deadline).
 *  cancel  CANCELLING->CANCELLED fence publication, revoke slot credentials, SIGKILL without grace.
 *  stop    STOPPING->STOPPED     fence publication, revoke, SIGTERM with grace then SIGKILL; outputs kept.
 *  resume  PAUSED/DRAINING->RUNNING; never revives a terminated launch.
 * Every command needs current coordinator authority fetched over the 12.1
 * transport (12.4-capture runner.control.authorize). Its fence is durable before
 * any signal; repeated commands return the recorded outcome; termination is
 * CONFIRMED only for an observed empty slot-UID tree, otherwise UNRESOLVED.
 * Slot reuse (runner.slot.release) waits for process and credential residue
 * absence and for durable captures of every required output. */
#define CONTROL_OUTPUT_LIMIT (16U*1024U*1024U)
#define CONTROL_CHUNK 196608U
typedef struct {char transport[4096],state[4096],slots[4096],organisation[37],run[37],sandbox[37],boot[37],generation[32];} ControlConfig;
typedef struct {int64_t grace_ms,drain_ms;int stop_at_deadline;} ControlPolicy;

static long long wall_ms(void){struct timespec t;clock_gettime(CLOCK_REALTIME,&t);return (long long)t.tv_sec*1000LL+t.tv_nsec/1000000;}
static void pause_ms(long ms){struct timespec t={ms/1000,(ms%1000)*1000000L};while(nanosleep(&t,&t)&&errno==EINTR){}}
static int secure_state(const char *state){struct stat st;return state&&state[0]=='/'&&!lstat(state,&st)&&S_ISDIR(st.st_mode)&&st.st_uid==geteuid()&&!(st.st_mode&077)&&geteuid()==0;}
static int text_at(const HfJson *j,int object,const char *key,char *out,size_t n){return hf_json_string(j,hf_json_field(j,object,key),out,n);}
static int load_config(const char *path,const char *state,ControlConfig *c){
 memset(c,0,sizeof *c);char *raw=NULL;size_t n=0;HfJson *j=malloc(sizeof *j);
 int ok=j&&hf_private_read(path,65536,&raw,&n)&&hf_json_parse(j,raw)&&hf_json_get(j,"transport_config",c->transport,sizeof c->transport)&&c->transport[0]=='/'&&
  hf_json_get(j,"state_dir",c->state,sizeof c->state)&&!strcmp(c->state,state)&&hf_json_get(j,"slot_root",c->slots,sizeof c->slots)&&c->slots[0]=='/'&&
  hf_json_get(j,"organisation_id",c->organisation,sizeof c->organisation)&&hf_uuid_valid(c->organisation)&&hf_json_get(j,"run_id",c->run,sizeof c->run)&&hf_uuid_valid(c->run)&&
  hf_json_get(j,"sandbox_id",c->sandbox,sizeof c->sandbox)&&hf_uuid_valid(c->sandbox)&&hf_json_get(j,"boot_id",c->boot,sizeof c->boot)&&hf_uuid_valid(c->boot)&&
  hf_json_get(j,"boot_generation",c->generation,sizeof c->generation)&&*c->generation;
 free(raw);free(j);return ok;
}
/* Config is the request's explicit root-private runner config, else <state_dir>/runner.json. */
static int request_config(const HfJson *j,const char *state,ControlConfig *c){
 char path[4200];if(!hf_json_get(j,"config_path",path,sizeof path))snprintf(path,sizeof path,"%s/runner.json",state);return load_config(path,state,c);
}
/* 1 accepted (result token in *result, *body owned by caller), 0 refused (code), -1 unreachable/uncertain. */
static int service(const ControlConfig *c,const char *action,const char *input,HfJson *j,int *result,char **body,char code[96]){
 *body=NULL;*result=-1;snprintf(code,96,"TRANSPORT_UNAVAILABLE");char *payload=NULL;size_t n=0;FILE *out=open_memstream(&payload,&n);char operation[37],idempotency[37],correlation[37];
 if(!out||!hf_uuid_generate(operation)||!hf_uuid_generate(idempotency)||!hf_uuid_generate(correlation)){if(out)fclose(out);free(payload);return -1;}
 fprintf(out,"{\"run_id\":\"%s\",\"component\":\"12.4-capture\",\"action\":\"%s\",\"input\":%s,\"expected_version\":null,\"authority\":null}",c->run,action,input);
 if(fclose(out)){free(payload);return -1;}
 HfHttpResponse r={0};int sent=hf_supervisor_call(c->transport,0,payload,operation,idempotency,correlation,NULL,NULL,NULL,&r);free(payload);
 int accepted=0;if(!sent||!r.body||!hf_json_parse(j,r.body)||!hf_json_bool(j,hf_json_field(j,0,"ok"),&accepted)){hf_http_response_free(&r);return -1;}
 if(accepted&&r.status>=200&&r.status<300&&(*result=hf_json_field(j,0,"result"))>=0){*body=r.body;r.body=NULL;hf_http_response_free(&r);return 1;}
 int error=hf_json_field(j,0,"error");int known=error>=0&&text_at(j,error,"code",code,96);hf_http_response_free(&r);return known&&r.status<500?0:-1;
}
int hf_runner_control_api(const char *config_path,const char *component,const char *action,const char *input,HfHttpResponse *response){
 ControlConfig c;char *raw=NULL;size_t n=0;HfJson *j=malloc(sizeof *j);char state[4096];
 int ok=j&&hf_private_read(config_path,65536,&raw,&n)&&hf_json_parse(j,raw)&&hf_json_get(j,"state_dir",state,sizeof state);free(raw);free(j);
 if(!ok||!load_config(config_path,state,&c))return 0;
 char *payload=NULL;size_t m=0;FILE *out=open_memstream(&payload,&m);char operation[37],idempotency[37],correlation[37];
 if(!out||!hf_uuid_generate(operation)||!hf_uuid_generate(idempotency)||!hf_uuid_generate(correlation)){if(out)fclose(out);free(payload);return 0;}
 fprintf(out,"{\"run_id\":\"%s\",\"component\":\"%s\",\"action\":\"%s\",\"input\":%s,\"expected_version\":null,\"authority\":null}",c.run,component,action,input);
 if(fclose(out)){free(payload);return 0;}
 ok=hf_supervisor_call(c.transport,0,payload,operation,idempotency,correlation,NULL,NULL,NULL,response);free(payload);return ok;
}

static sqlite3 *ledger(const char *state){
 if(!secure_state(state))return NULL;
 char path[4200];snprintf(path,sizeof path,"%s/control.db",state);struct stat st;
 if(!lstat(path,&st)&&(!S_ISREG(st.st_mode)||st.st_uid!=geteuid()||(st.st_mode&077)||st.st_nlink!=1))return NULL;
 sqlite3 *db=NULL;mode_t mask=umask(077);int rc=sqlite3_open_v2(path,&db,SQLITE_OPEN_READWRITE|SQLITE_OPEN_CREATE,NULL);umask(mask);
 if(rc!=SQLITE_OK){sqlite3_close(db);return NULL;}sqlite3_busy_timeout(db,5000);
 if(sqlite3_exec(db,"PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;"
  "CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY,action TEXT NOT NULL,launch TEXT NOT NULL,uid INTEGER NOT NULL,slot TEXT NOT NULL,fence INTEGER NOT NULL,authority TEXT NOT NULL,phase TEXT NOT NULL,receipt TEXT,receipt_digest TEXT,report_delivered INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,updated INTEGER NOT NULL);"
  "CREATE TABLE IF NOT EXISTS fences(launch TEXT PRIMARY KEY,uid INTEGER NOT NULL,mode TEXT NOT NULL,command TEXT NOT NULL,fence INTEGER NOT NULL,admission_closed INTEGER NOT NULL,input_closed INTEGER NOT NULL,publication_fenced INTEGER NOT NULL,updated INTEGER NOT NULL);"
  "CREATE TABLE IF NOT EXISTS outputs(command TEXT NOT NULL,name TEXT NOT NULL,path TEXT NOT NULL,digest TEXT,size INTEGER,local_durable INTEGER NOT NULL,capture_receipt TEXT,PRIMARY KEY(command,name));"
  "CREATE TABLE IF NOT EXISTS credentials(command TEXT NOT NULL,name TEXT NOT NULL,digest TEXT,state TEXT NOT NULL,PRIMARY KEY(command,name));"
  "CREATE TABLE IF NOT EXISTS refusals(command TEXT PRIMARY KEY,code TEXT NOT NULL,at INTEGER NOT NULL);"
  "CREATE TABLE IF NOT EXISTS job_cancellations(operation TEXT PRIMARY KEY,uid INTEGER NOT NULL,reason TEXT NOT NULL,termination TEXT NOT NULL,at INTEGER NOT NULL);",NULL,NULL,NULL)!=SQLITE_OK){sqlite3_close(db);return NULL;}
 return db;
}
static int exec_bind(sqlite3 *db,const char *sql,const char *const *text,int count){
 sqlite3_stmt *q=NULL;int ok=sqlite3_prepare_v2(db,sql,-1,&q,NULL)==SQLITE_OK;
 for(int k=0;ok&&k<count;++k)ok=(text[k]?sqlite3_bind_text(q,k+1,text[k],-1,SQLITE_TRANSIENT):sqlite3_bind_null(q,k+1))==SQLITE_OK;
 ok=ok&&sqlite3_step(q)==SQLITE_DONE;sqlite3_finalize(q);return ok;
}
static int refuse(sqlite3 *db,FILE *out,const char *command,const char *code){
 if(db&&command&&hf_uuid_valid(command)){char at[32];snprintf(at,sizeof at,"%lld",(long long)time(NULL));const char *v[]={command,code,at};exec_bind(db,"INSERT INTO refusals(command,code,at) VALUES(?,?,?) ON CONFLICT(command) DO UPDATE SET code=excluded.code,at=excluded.at",v,3);}
 return hf_native_error(out,code);
}
int hf_runner_admission_closed(const char *state,uid_t uid){
 char path[4200];snprintf(path,sizeof path,"%s/control.db",state);struct stat st;if(lstat(path,&st))return errno==ENOENT?0:1;
 sqlite3 *db=ledger(state);if(!db)return 1;sqlite3_stmt *q=NULL;int closed=1;
 if(sqlite3_prepare_v2(db,"SELECT count(*) FROM fences WHERE uid=? AND admission_closed=1",-1,&q,NULL)==SQLITE_OK){sqlite3_bind_int64(q,1,uid);if(sqlite3_step(q)==SQLITE_ROW)closed=sqlite3_column_int(q,0)>0;}
 sqlite3_finalize(q);sqlite3_close(db);return closed;
}

static int launch_update(const char *state,const char *launch,uid_t uid,const char *value){
 char path[4200];snprintf(path,sizeof path,"%s/launches.db",state);sqlite3 *db=NULL;sqlite3_stmt *q=NULL;int ok=sqlite3_open_v2(path,&db,SQLITE_OPEN_READWRITE,NULL)==SQLITE_OK;
 if(ok){sqlite3_busy_timeout(db,5000);ok=sqlite3_prepare_v2(db,"UPDATE launches SET state=?,updated=unixepoch() WHERE id=? AND uid=?",-1,&q,NULL)==SQLITE_OK;}
 if(ok){sqlite3_bind_text(q,1,value,-1,SQLITE_STATIC);sqlite3_bind_text(q,2,launch,-1,SQLITE_STATIC);sqlite3_bind_int64(q,3,uid);ok=sqlite3_step(q)==SQLITE_DONE&&sqlite3_changes(db)==1;}
 sqlite3_finalize(q);sqlite3_close(db);return ok;
}
/* 1 present (slot/uid filled), 0 absent, -1 unreadable. */
static int launch_row(const char *state,const char *launch,char slot[37],uid_t *uid,char identity[2048]){
 char path[4200];snprintf(path,sizeof path,"%s/launches.db",state);struct stat st;if(lstat(path,&st))return errno==ENOENT?0:-1;
 if(!S_ISREG(st.st_mode)||st.st_uid!=geteuid()||(st.st_mode&077))return -1;
 sqlite3 *db=NULL;sqlite3_stmt *q=NULL;int found=-1;
 if(sqlite3_open_v2(path,&db,SQLITE_OPEN_READONLY,NULL)==SQLITE_OK&&sqlite3_prepare_v2(db,"SELECT slot,uid,identity FROM launches WHERE id=?",-1,&q,NULL)==SQLITE_OK){
  sqlite3_bind_text(q,1,launch,-1,SQLITE_STATIC);int step=sqlite3_step(q);
  if(step==SQLITE_ROW){snprintf(slot,37,"%s",(const char*)sqlite3_column_text(q,0));*uid=(uid_t)sqlite3_column_int64(q,1);if(identity)snprintf(identity,2048,"%s",(const char*)sqlite3_column_text(q,2));found=1;}else if(step==SQLITE_DONE)found=0;}
 sqlite3_finalize(q);sqlite3_close(db);return found;
}
static int slot_state(const ControlConfig *c,const char *slot,uid_t uid,const char *value){
 char path[4200];snprintf(path,sizeof path,"%s/.supervisor-slots.db",c->slots);struct stat st;if(lstat(path,&st)||!S_ISREG(st.st_mode)||st.st_uid!=0||(st.st_mode&077))return 0;
 sqlite3 *db=NULL;sqlite3_stmt *q=NULL;int ok=sqlite3_open_v2(path,&db,SQLITE_OPEN_READWRITE,NULL)==SQLITE_OK;
 if(ok){sqlite3_busy_timeout(db,5000);ok=sqlite3_prepare_v2(db,"UPDATE slots SET state=? WHERE id=? AND uid=?",-1,&q,NULL)==SQLITE_OK;}
 if(ok){sqlite3_bind_text(q,1,value,-1,SQLITE_STATIC);sqlite3_bind_text(q,2,slot,-1,SQLITE_STATIC);sqlite3_bind_int64(q,3,uid);ok=sqlite3_step(q)==SQLITE_DONE&&sqlite3_changes(db)==1;}
 sqlite3_finalize(q);sqlite3_close(db);return ok;
}
static int uid_tree(uid_t uid,HfProcessIdentity *list,size_t capacity){HfRunnerBinding b;memset(&b,0,sizeof b);b.uid=uid;return hf_runner_processes(&b,list,capacity);}
static int signal_tree(uid_t uid,int number){
 HfProcessIdentity list[1024];int count=uid_tree(uid,list,1024);if(count<0)return -1;
 for(int k=0;k<count;++k)if(hf_process_matches(&list[k],NULL)&&kill(list[k].pid,number)&&errno!=ESRCH)return -1;
 return count;
}
/* TERM (unless kill_first), wait grace, then KILL rounds; returns remaining processes or -1. */
static int terminate(uid_t uid,long long grace_ms,int kill_first){
 if(!kill_first&&signal_tree(uid,SIGCONT)>=0&&signal_tree(uid,SIGTERM)>0){long long until=wall_ms()+grace_ms;while(wall_ms()<until){HfProcessIdentity l[1024];int n=uid_tree(uid,l,1024);if(n<=0)break;while(waitpid(-1,NULL,WNOHANG)>0){}pause_ms(20);}}
 for(int round=0;round<60;++round){int n=signal_tree(uid,SIGKILL);if(n<=0)return n;if(round==0)signal_tree(uid,SIGCONT);while(waitpid(-1,NULL,WNOHANG)>0){}pause_ms(50);}
 HfProcessIdentity l[1024];return uid_tree(uid,l,1024);
}
/* Freeze (SIGSTOP) or thaw (SIGCONT) the exact tree; 1 when every process reached the wanted state. */
static int freeze(uid_t uid,int stop){
 for(int round=0;round<40;++round){
  if(signal_tree(uid,stop?SIGSTOP:SIGCONT)<0)return 0;
  pause_ms(25);
  HfProcessIdentity l[1024];int n=uid_tree(uid,l,1024),settled=n>=0;for(int k=0;settled&&k<n;++k){int stopped=l[k].state=='T'||l[k].state=='t';settled=stop?stopped:!stopped;}if(settled)return 1;
 }return 0;
}
static int jobs_active(const char *state,uid_t uid){
 char path[4200];snprintf(path,sizeof path,"%s/jobs.db",state);struct stat st;if(lstat(path,&st))return errno==ENOENT?0:-1;
 sqlite3 *db=NULL;sqlite3_stmt *q=NULL;int count=-1;
 if(sqlite3_open_v2(path,&db,SQLITE_OPEN_READONLY,NULL)==SQLITE_OK&&sqlite3_prepare_v2(db,"SELECT count(*) FROM jobs WHERE uid=? AND state<>'TERMINAL'",-1,&q,NULL)==SQLITE_OK){sqlite3_bind_int64(q,1,uid);if(sqlite3_step(q)==SQLITE_ROW)count=sqlite3_column_int(q,0);}
 sqlite3_finalize(q);sqlite3_close(db);return count;
}
static int fd_digest(int fd,char out[72],unsigned long long *size){
 unsigned char buffer[65536],hash[32];unsigned length=0;EVP_MD_CTX *ctx=EVP_MD_CTX_new();int ok=ctx&&EVP_DigestInit_ex(ctx,EVP_sha256(),NULL)==1;ssize_t n=0;*size=0;
 while(ok&&(n=read(fd,buffer,sizeof buffer))>0){ok=EVP_DigestUpdate(ctx,buffer,(size_t)n)==1;*size+=(unsigned long long)n;}
 ok=ok&&n==0&&EVP_DigestFinal_ex(ctx,hash,&length)==1&&length==32;EVP_MD_CTX_free(ctx);
 if(ok){strcpy(out,"sha256:");for(unsigned k=0;k<32;++k)snprintf(out+7+k*2,3,"%02x",hash[k]);}return ok;
}
/* Slot credential material lives in <slot_root>/<slot>/home/.hyperfide/credentials.
 * Every component is opened beneath its parent without following links. */
static int credential_dir(const ControlConfig *c,const char *slot){
 int fd=open(c->slots,O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);const char *parts[]={slot,"home",".hyperfide","credentials"};
 for(unsigned k=0;fd>=0&&k<4;++k){int next=openat(fd,parts[k],O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);int saved=errno;close(fd);fd=next;errno=saved;}
 return fd<0?(errno==ENOENT?-2:-1):fd;
}
/* Unlink every credential entry and record it; returns residue count after the pass or -1. */
static int revoke_credentials(sqlite3 *db,const ControlConfig *c,const char *slot,const char *command){
 if(!c||!*c->slots)return -1;
 int dir=credential_dir(c,slot);if(dir==-2)return 0;if(dir<0)return -1;
 DIR *listing=fdopendir(dup(dir));if(!listing){close(dir);return -1;}struct dirent *e;int residue=0;
 while((e=readdir(listing))){
  if(!strcmp(e->d_name,".")||!strcmp(e->d_name,".."))continue;
  char digest[72]="";unsigned long long size=0;
  int fd=openat(dir,e->d_name,O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK);struct stat st;
  if(fd>=0&&!fstat(fd,&st)&&S_ISREG(st.st_mode)&&!fd_digest(fd,digest,&size))digest[0]=0;
  if(fd>=0)close(fd);
  int removed=!unlinkat(dir,e->d_name,0)||errno==ENOENT;if(!removed&&errno==EISDIR)removed=0;
  const char *v[]={command,e->d_name,*digest?digest:NULL,removed?"REVOKED":"UNRESOLVED"};
  exec_bind(db,"INSERT INTO credentials(command,name,digest,state) VALUES(?,?,?,?) ON CONFLICT(command,name) DO UPDATE SET state=excluded.state,digest=COALESCE(excluded.digest,credentials.digest)",v,4);
  if(!removed)++residue;
 }
 closedir(listing);fsync(dir);close(dir);return residue;
}
static int credential_residue(const ControlConfig *c,const char *slot){
 if(!c||!*c->slots)return -1;
 int dir=credential_dir(c,slot);if(dir==-2)return 0;if(dir<0)return -1;
 DIR *listing=fdopendir(dir);if(!listing){close(dir);return -1;}struct dirent *e;int count=0;while((e=readdir(listing)))if(strcmp(e->d_name,".")&&strcmp(e->d_name,".."))++count;closedir(listing);return count;
}
static int output_path(const char *state,const char *launch,const char *name,char path[4200]){
 if(!strcmp(name,"launch.stdout"))return snprintf(path,4200,"%s/%s.stdout",state,launch)<4200;
 if(!strcmp(name,"launch.stderr"))return snprintf(path,4200,"%s/%s.stderr",state,launch)<4200;
 char op[37];if(strlen(name)==48&&!strncmp(name,"job.",4)&&!strcmp(name+40,".receipt")){memcpy(op,name+4,36);op[36]=0;if(hf_uuid_valid(op))return snprintf(path,4200,"%s/job-%s.receipt.json",state,op)<4200;}
 return 0;
}
/* fsync and digest every required output locally; capture receipts come later. */
static void record_outputs(sqlite3 *db,const char *state,const char *launch,const char *command,const HfJson *a,int list){
 for(int t=list+1;list>=0&&t<a->tokens[list].next;t=a->tokens[t].next){
  char name[128],path[4200],digest[72]="";unsigned long long size=0;if(!hf_json_string(a,t,name,sizeof name)||!output_path(state,launch,name,path))continue;
  sqlite3_stmt *q=NULL;int captured=0;if(sqlite3_prepare_v2(db,"SELECT capture_receipt FROM outputs WHERE command=? AND name=?",-1,&q,NULL)==SQLITE_OK){sqlite3_bind_text(q,1,command,-1,SQLITE_STATIC);sqlite3_bind_text(q,2,name,-1,SQLITE_STATIC);captured=sqlite3_step(q)==SQLITE_ROW&&sqlite3_column_type(q,0)!=SQLITE_NULL;}sqlite3_finalize(q);if(captured)continue;
  int fd=open(path,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);struct stat st;int durable=fd>=0&&!fstat(fd,&st)&&S_ISREG(st.st_mode)&&st.st_uid==0&&(unsigned long long)st.st_size<=CONTROL_OUTPUT_LIMIT&&!fsync(fd)&&fd_digest(fd,digest,&size);if(fd>=0)close(fd);
  char sz[32];snprintf(sz,sizeof sz,"%llu",size);const char *v[]={command,name,path,durable?digest:NULL,durable?sz:NULL,durable?"1":"0"};
  exec_bind(db,"INSERT INTO outputs(command,name,path,digest,size,local_durable) VALUES(?,?,?,?,?,?) ON CONFLICT(command,name) DO UPDATE SET path=excluded.path,digest=excluded.digest,size=excluded.size,local_durable=excluded.local_durable",v,6);
 }
}
/* Upload every locally durable, uncaptured output in fixed chunks; 1 when all captured. */
static int capture_outputs(sqlite3 *db,const ControlConfig *c,const char *command){
 sqlite3_stmt *q=NULL;int all=1;if(sqlite3_prepare_v2(db,"SELECT name,path,digest,size,local_durable,capture_receipt FROM outputs WHERE command=? ORDER BY name",-1,&q,NULL)!=SQLITE_OK)return 0;sqlite3_bind_text(q,1,command,-1,SQLITE_STATIC);
 char names[16][128],paths[16][4200],digests[16][72];long long sizes[16];int pending=0;
 while(sqlite3_step(q)==SQLITE_ROW){if(sqlite3_column_type(q,5)!=SQLITE_NULL)continue;if(!sqlite3_column_int(q,4)){all=0;continue;}if(pending==16){all=0;break;}
  snprintf(names[pending],128,"%s",sqlite3_column_text(q,0));snprintf(paths[pending],4200,"%s",sqlite3_column_text(q,1));snprintf(digests[pending],72,"%s",sqlite3_column_text(q,2));sizes[pending]=sqlite3_column_int64(q,3);++pending;}
 sqlite3_finalize(q);if(!pending)return all;if(!c)return 0;
 for(int k=0;k<pending;++k){
  int fd=open(paths[k],O_RDONLY|O_CLOEXEC|O_NOFOLLOW);unsigned char *bytes=malloc((size_t)sizes[k]+1);size_t used=0;
  while(fd>=0&&bytes&&used<(size_t)sizes[k]){ssize_t n=read(fd,bytes+used,(size_t)sizes[k]-used);if(n<=0)break;used+=(size_t)n;}if(fd>=0)close(fd);
  char check[65];int same=bytes&&used==(size_t)sizes[k]&&hf_sha256_bytes(bytes,used,check)&&!strcmp(check,digests[k]+7);
  char receipt[72]="";size_t offset=0;int sequence=0;
  do{size_t part=used-offset>CONTROL_CHUNK?CONTROL_CHUNK:used-offset;char *encoded=same?malloc(((part+2)/3)*4+1):NULL;if(encoded)EVP_EncodeBlock((unsigned char*)encoded,bytes+offset,(int)part);
   char *input=NULL;size_t n=0;FILE *out=encoded?open_memstream(&input,&n):NULL;if(!out){free(encoded);same=0;break;}
   fprintf(out,"{\"command_id\":\"%s\",\"name\":\"%s\",\"sequence\":%d,\"offset_bytes\":\"%zu\",\"total_digest\":\"%s\",\"total_size_bytes\":\"%zu\",\"data_base64\":\"%s\"}",command,names[k],sequence,offset,digests[k],used,encoded);fclose(out);free(encoded);
   HfJson *j=malloc(sizeof *j);int result=-1;char *body=NULL,code[96],state[32]="";int accepted=j?service(c,"runner.capture.put",input,j,&result,&body,code):-1;free(input);
   if(accepted==1&&text_at(j,result,"state",state,sizeof state)&&!strcmp(state,"COMPLETE"))text_at(j,result,"receipt_digest",receipt,sizeof receipt);
   free(body);free(j);if(accepted!=1){same=0;break;}offset+=part;++sequence;
  }while(offset<used);
  free(bytes);
  if(same&&strlen(receipt)==71){const char *v[]={receipt,command,names[k]};exec_bind(db,"UPDATE outputs SET capture_receipt=? WHERE command=? AND name=?",v,3);}else all=0;
 }
 return all;
}
static int policy_of(const HfJson *a,int r,ControlPolicy *p){
 int t=hf_json_field(a,r,"policy");char mode[16];
 return t>=0&&hf_json_i64(a,hf_json_field(a,t,"grace_ms"),&p->grace_ms)&&p->grace_ms>=0&&p->grace_ms<=600000&&hf_json_i64(a,hf_json_field(a,t,"drain_deadline_ms"),&p->drain_ms)&&p->drain_ms>0&&
  text_at(a,t,"on_drain_deadline",mode,sizeof mode)&&((p->stop_at_deadline=!strcmp(mode,"STOP"))||!strcmp(mode,"REPORT"));
}
static const char *mode_of(const char *action){return !strcmp(action,"runner.pause")?"PAUSE":!strcmp(action,"runner.drain")?"DRAIN":!strcmp(action,"runner.cancel")?"CANCEL":!strcmp(action,"runner.stop")?"STOP":"RESUME";}
static const char *starting_phase(const char *action){return !strcmp(action,"runner.pause")?"PAUSING":!strcmp(action,"runner.drain")?"DRAINING":!strcmp(action,"runner.cancel")?"CANCELLING":!strcmp(action,"runner.stop")?"STOPPING":"RESUMING";}
static int final_phase(const char *phase){return !strcmp(phase,"PAUSED")||!strcmp(phase,"DRAINED")||!strcmp(phase,"CANCELLED")||!strcmp(phase,"STOPPED")||!strcmp(phase,"RESUMED")||!strcmp(phase,"SUPERSEDED");}
static const char *status_of(const char *action,const char *phase){
 if(!strcmp(action,"runner.stop"))return !strcmp(phase,"STOPPED")?"CONFIRMED_STOPPED":"UNKNOWN";
 if(!strcmp(phase,"PAUSED"))return "PAUSED";
 if(!strcmp(phase,"DRAINED"))return "DRAINED";
 if(!strcmp(phase,"DRAINING"))return "DRAINING";
 if(!strcmp(phase,"CANCELLED"))return "CANCELLED";
 if(!strcmp(phase,"RESUMED"))return "RUNNING";
 return "UNRESOLVED";
}
static const char *termination_of(const char *phase){return !strcmp(phase,"PAUSED")?"FROZEN":(!strcmp(phase,"DRAINED")||!strcmp(phase,"CANCELLED")||!strcmp(phase,"STOPPED"))?"CONFIRMED":(!strcmp(phase,"RESUMED")||!strcmp(phase,"DRAINING"))?"NOT_REQUIRED":"UNRESOLVED";}
static const char *outcome_of(const char *phase){return final_phase(phase)||!strcmp(phase,"DRAINING")?(!strcmp(phase,"RESUMED")?"RESUMED":phase):"UNRESOLVED";}

typedef struct {
 char command[37],action[32],launch[37],slot[37],phase[16],state[4096],identity[2048];uid_t uid;long long fence,created;
 char *authority;HfJson *a;int r;ControlPolicy policy;int prelaunch,policy_terminated,broker_alive,remaining,residue;
 HfProcessIdentity list[1024];
} Control;
static int load_command(sqlite3 *db,const char *id,Control *x){
 sqlite3_stmt *q=NULL;int found=0;if(sqlite3_prepare_v2(db,"SELECT action,launch,uid,slot,fence,authority,phase,created FROM commands WHERE id=?",-1,&q,NULL)!=SQLITE_OK)return -1;
 sqlite3_bind_text(q,1,id,-1,SQLITE_STATIC);
 if(sqlite3_step(q)==SQLITE_ROW){found=1;snprintf(x->command,37,"%s",id);snprintf(x->action,32,"%s",sqlite3_column_text(q,0));snprintf(x->launch,37,"%s",sqlite3_column_text(q,1));x->uid=(uid_t)sqlite3_column_int64(q,2);snprintf(x->slot,37,"%s",sqlite3_column_text(q,3));x->fence=sqlite3_column_int64(q,4);x->authority=strdup((const char*)sqlite3_column_text(q,5));snprintf(x->phase,16,"%s",sqlite3_column_text(q,6));x->created=sqlite3_column_int64(q,7);}
 sqlite3_finalize(q);
 if(found){x->a=malloc(sizeof *x->a);found=x->authority&&x->a&&hf_json_parse(x->a,x->authority)&&policy_of(x->a,0,&x->policy)?1:-1;x->r=0;}
 return found;
}
static void free_control(Control *x){free(x->authority);free(x->a);x->authority=NULL;x->a=NULL;}
static int set_phase(sqlite3 *db,const Control *x){char at[32];snprintf(at,sizeof at,"%lld",(long long)time(NULL));const char *v[]={x->phase,at,x->command};return exec_bind(db,"UPDATE commands SET phase=?,updated=? WHERE id=?",v,3);}

/* Render the receipt from the durable ledger plus a fresh kernel observation. */
static char *render(sqlite3 *db,Control *x,const ControlConfig *c){
 int count=x->prelaunch?0:uid_tree(x->uid,x->list,1024);x->remaining=count;
 int residue=x->prelaunch?0:credential_residue(c,x->slot);x->residue=residue;
 char *data=NULL;size_t n=0;FILE *out=open_memstream(&data,&n);if(!out)return NULL;char observation[37];if(!hf_uuid_generate(observation)){fclose(out);free(data);return NULL;}
 fprintf(out,"{\"status\":\"%s\",\"action\":\"%s\",\"phase\":\"%s\",\"command_id\":\"%s\",\"launch_id\":\"%s\",\"slot_id\":\"%s\",\"observation_id\":\"%s\",\"observed_at_seconds\":%lld,\"binding\":",status_of(x->action,x->phase),x->action,x->phase,x->command,x->launch,x->slot,observation,(long long)time(NULL));
 if(*x->identity)fputs(x->identity,out);else{fputc('{',out);const char *k[]={"attempt_id","attempt_generation","sandbox_id","boot_id","boot_generation"};for(unsigned i=0;i<5;++i){char v[128]="";text_at(x->a,x->r,k[i],v,sizeof v);if(i)fputc(',',out);fprintf(out,"\"%s\":",k[i]);hf_json_write_string(out,v);}fputc('}',out);}
 fputs(",\"processes\":[",out);for(int k=0;k<count;++k){if(k)fputc(',',out);hf_process_json(out,&x->list[k]);}
 fprintf(out,"],\"remaining_descendants\":%d,\"ipc_closed\":%s,\"termination\":\"%s\",\"terminated_by_policy\":%s,\"prelaunch\":%s,\"authority\":{\"command_id\":\"%s\",\"fence_sequence\":\"%lld\"",count<0?0:count,x->broker_alive?"false":"true",termination_of(x->phase),x->policy_terminated?"true":"false",x->prelaunch?"true":"false",x->command,x->fence);
 const char *ak[]={"authority_epoch","attempt_generation","boot_generation"};for(unsigned i=0;i<3;++i){char v[64]="";text_at(x->a,x->r,ak[i],v,sizeof v);fprintf(out,",\"%s\":",ak[i]);hf_json_write_string(out,v);}
 fputs(",\"verified_via\":\"12.1-transport:runner.control.authorize\"}",out);
 sqlite3_stmt *q=NULL;int admission=0,input=0,publication=0;
 if(sqlite3_prepare_v2(db,"SELECT admission_closed,input_closed,publication_fenced FROM fences WHERE launch=?",-1,&q,NULL)==SQLITE_OK){sqlite3_bind_text(q,1,x->launch,-1,SQLITE_STATIC);if(sqlite3_step(q)==SQLITE_ROW){admission=sqlite3_column_int(q,0);input=sqlite3_column_int(q,1);publication=sqlite3_column_int(q,2);}}sqlite3_finalize(q);
 fprintf(out,",\"fence\":{\"admission_closed\":%s,\"input_closed\":%s,\"publication_fenced\":%s},\"required_artifacts\":[",admission?"true":"false",input?"true":"false",publication?"true":"false");
 char debt[4096]="";size_t used=0;int outputs_ok=1,credentials_ok=1;
#define DEBT(...) do{int w=snprintf(debt+used,sizeof debt-used,"%s\"",used?",":"");if(w>0&&(size_t)w<sizeof debt-used)used+=(size_t)w;w=snprintf(debt+used,sizeof debt-used,__VA_ARGS__);if(w>0&&(size_t)w<sizeof debt-used)used+=(size_t)w;if(used<sizeof debt-1){debt[used++]='"';debt[used]=0;}}while(0)
 if(sqlite3_prepare_v2(db,"SELECT name,digest,size,local_durable,capture_receipt FROM outputs WHERE command=? ORDER BY name",-1,&q,NULL)==SQLITE_OK){sqlite3_bind_text(q,1,x->command,-1,SQLITE_STATIC);int first=1;
  while(sqlite3_step(q)==SQLITE_ROW){const char *name=(const char*)sqlite3_column_text(q,0);int durable=sqlite3_column_int(q,3),captured=sqlite3_column_type(q,4)!=SQLITE_NULL;
   fprintf(out,"%s{\"name\":",first?"":",");first=0;hf_json_write_string(out,name);fputs(",\"digest\":",out);if(sqlite3_column_type(q,1)!=SQLITE_NULL)hf_json_write_string(out,(const char*)sqlite3_column_text(q,1));else fputs("null",out);
   fputs(",\"size_bytes\":",out);if(sqlite3_column_type(q,2)!=SQLITE_NULL)fprintf(out,"\"%lld\"",sqlite3_column_int64(q,2));else fputs("null",out);fprintf(out,",\"local_durable\":%s,\"capture_receipt\":",durable?"true":"false");
   if(captured)hf_json_write_string(out,(const char*)sqlite3_column_text(q,4));else fputs("null",out);fputc('}',out);
   if(!durable){outputs_ok=0;DEBT("OUTPUT_MISSING:%s",name);}else if(!captured){outputs_ok=0;DEBT("OUTPUT_NOT_CAPTURED:%s",name);}}}
 sqlite3_finalize(q);fputs("],\"credential_revocation\":[",out);
 int cred_first=1;
 if(sqlite3_prepare_v2(db,"SELECT name,state FROM credentials WHERE command=? ORDER BY name",-1,&q,NULL)==SQLITE_OK){sqlite3_bind_text(q,1,x->command,-1,SQLITE_STATIC);
  while(sqlite3_step(q)==SQLITE_ROW){const char *name=(const char*)sqlite3_column_text(q,0),*state=(const char*)sqlite3_column_text(q,1);fprintf(out,"%s{\"name\":",cred_first?"":",");cred_first=0;hf_json_write_string(out,name);fprintf(out,",\"state\":\"%s\"}",state);if(!strcmp(state,"UNRESOLVED")){credentials_ok=0;DEBT("CREDENTIAL_UNRESOLVED:%s",name);}}}
 sqlite3_finalize(q);
 int publication_fence=hf_json_field(x->a,x->r,"publication_fence");char *fence_raw=publication_fence>=0?hf_json_raw(x->a,publication_fence):NULL;int coordinator=fence_raw&&strcmp(fence_raw,"null");free(fence_raw);
 if(!strcmp(x->action,"runner.cancel")||!strcmp(x->action,"runner.stop")){fprintf(out,"%s{\"name\":\"coordinator.publication-fence\",\"state\":\"%s\"}",cred_first?"":",",coordinator?"REVOKED":"UNRESOLVED");cred_first=0;if(!coordinator){credentials_ok=0;DEBT("COORDINATOR_FENCE_UNCONFIRMED");}}
 if(residue!=0){credentials_ok=0;DEBT("CREDENTIAL_RESIDUE:%d",residue);}
 if(count!=0&&strcmp(x->phase,"PAUSED")&&strcmp(x->phase,"RESUMED")&&strcmp(x->phase,"DRAINING"))DEBT("PROCESS_RESIDUE:%d",count);
 if(x->prelaunch)DEBT("LAUNCH_NOT_STARTED_FENCE_PENDING");
 int terminal=!strcmp(x->phase,"CANCELLED")||!strcmp(x->phase,"STOPPED")||!strcmp(x->phase,"DRAINED");
 int complete=terminal&&count==0&&outputs_ok&&credentials_ok&&!x->prelaunch&&!x->broker_alive;
 fprintf(out,"],\"cleanup_complete\":%s,\"cleanup_debt\":[%s],\"native_context_recoverable\":false,\"recovery_required\":%s}",complete?"true":"false",debt,complete||!strcmp(x->phase,"PAUSED")||!strcmp(x->phase,"RESUMED")||!strcmp(x->phase,"DRAINING")?"false":"true");
#undef DEBT
 if(fclose(out)){free(data);return NULL;}return data;
}

static int report(sqlite3 *db,const ControlConfig *c,const Control *x,const char *receipt){
 HfJson *r=malloc(sizeof *r);if(!r||!hf_json_parse(r,receipt)){free(r);return 0;}char digest[65];hf_sha256_bytes(receipt,strlen(receipt),digest);
 char *creds=hf_json_raw(r,hf_json_field(r,0,"credential_revocation")),*debt=hf_json_raw(r,hf_json_field(r,0,"cleanup_debt"));int complete=0;hf_json_bool(r,hf_json_field(r,0,"cleanup_complete"),&complete);
 char *input=NULL;size_t n=0;FILE *out=open_memstream(&input,&n);int ok=0;
 if(out&&creds&&debt){fprintf(out,"{\"command_id\":\"%s\",\"outcome\":\"%s\",\"termination\":\"%s\",\"remaining_descendants\":%d,\"cleanup_complete\":%s,\"cleanup_debt\":%s,\"credential_revocation\":%s,\"receipt_digest\":\"sha256:%s\"}",x->command,outcome_of(x->phase),termination_of(x->phase),x->remaining<0?-1:x->remaining,complete?"true":"false",debt,creds,digest);fclose(out);out=NULL;
  HfJson *j=malloc(sizeof *j);int result=-1;char *body=NULL,code[96]="TRANSPORT_UNAVAILABLE";int sent=c&&j?service(c,"runner.control.report",input,j,&result,&body,code):-1;ok=sent==1;free(body);free(j);
  if(!ok){char reason[128],at[32];snprintf(reason,sizeof reason,"%s:%s",sent==0?"REPORT_REFUSED":"REPORT_UNDELIVERED",code);snprintf(at,sizeof at,"%lld",(long long)time(NULL));const char *v[]={x->command,reason,at};exec_bind(db,"INSERT INTO refusals(command,code,at) VALUES(?,?,?) ON CONFLICT(command) DO UPDATE SET code=excluded.code,at=excluded.at",v,3);}}
 if(out)fclose(out);
 free(input);free(creds);free(debt);free(r);
 const char *v[]={ok?"1":"0",x->command};exec_bind(db,"UPDATE commands SET report_delivered=? WHERE id=?",v,2);return ok;
}
static int store_receipt(sqlite3 *db,const Control *x,const char *receipt){char digest[72]="sha256:";hf_sha256_bytes(receipt,strlen(receipt),digest+7);const char *v[]={receipt,digest,x->command};return exec_bind(db,"UPDATE commands SET receipt=?,receipt_digest=? WHERE id=?",v,3);}

/* Apply the action to the live tree; updates x->phase. Fence/admission are already durable. */
static void execute(sqlite3 *db,const ControlConfig *c,Control *x,const char *request){
 int list=hf_json_field(x->a,x->r,"required_outputs");
 if(x->prelaunch){record_outputs(db,x->state,x->launch,x->command,x->a,list);return;}
 if(!strcmp(x->action,"runner.pause")){launch_update(x->state,x->launch,x->uid,"PAUSED");snprintf(x->phase,16,"%s",freeze(x->uid,1)?"PAUSED":"PAUSING");return;}
 if(!strcmp(x->action,"runner.resume")){
  HfProcessIdentity l[1024];int alive=uid_tree(x->uid,l,1024);
  if(alive>0&&freeze(x->uid,0)){launch_update(x->state,x->launch,x->uid,"RUNNING");const char *v[]={x->launch};exec_bind(db,"UPDATE fences SET admission_closed=0,input_closed=0,mode='RESUME',updated=unixepoch() WHERE launch=?",v,1);snprintf(x->phase,16,"RESUMED");}
  else snprintf(x->phase,16,"RESUMING");
  return;
 }
 int terminal=!strcmp(x->action,"runner.cancel")||!strcmp(x->action,"runner.stop");
 if(!strcmp(x->action,"runner.drain")){
  launch_update(x->state,x->launch,x->uid,"DRAINING");HfProcessIdentity l[1024];int alive=uid_tree(x->uid,l,1024),jobs=jobs_active(x->state,x->uid);
  if(alive==0&&jobs==0)terminal=1;
  else if(alive>0&&x->policy.stop_at_deadline&&wall_ms()>=x->created*1000LL+x->policy.drain_ms){x->policy_terminated=1;terminal=1;}
  else{snprintf(x->phase,16,"DRAINING");return;}
 }
 if(!terminal)return;
 if(c)slot_state(c,x->slot,x->uid,"CLEANUP_REQUIRED");
 if(strcmp(x->action,"runner.drain"))launch_update(x->state,x->launch,x->uid,!strcmp(x->action,"runner.cancel")?"CANCELLING":"STOPPING");
 revoke_credentials(db,c,x->slot,x->command);
 int remaining=terminate(x->uid,!strcmp(x->action,"runner.cancel")?0:x->policy.grace_ms,!strcmp(x->action,"runner.cancel"));
 /* A live broker closes stdin, retires its watchdog and fsyncs both logs. */
 char *rpc=NULL;size_t n=0;FILE *stream=open_memstream(&rpc,&n);if(stream){hf_launch_rpc(x->state,!strcmp(x->action,"runner.cancel")?"launch.cancel":"runner.stop",request,stream);fclose(stream);}free(rpc);
 revoke_credentials(db,c,x->slot,x->command);if(remaining!=0)remaining=terminate(x->uid,0,1);
 record_outputs(db,x->state,x->launch,x->command,x->a,list);
 if(remaining==0){snprintf(x->phase,16,"%s",!strcmp(x->action,"runner.cancel")?"CANCELLED":!strcmp(x->action,"runner.stop")?"STOPPED":"DRAINED");launch_update(x->state,x->launch,x->uid,!strcmp(x->action,"runner.stop")?"STOPPED":x->phase);}
 else snprintf(x->phase,16,"%s",starting_phase(x->action));
 capture_outputs(db,c,x->command);
}
static int broker_alive(const HfRunnerBinding *b){HfProcessIdentity broker;return b&&hf_process_identity(b->broker_pid,&broker)&&broker.start_time==b->broker_start&&!strcmp(broker.os_boot_id,b->os_boot_id)&&broker.state!='Z';}
/* Render; a confirmed phase contradicted by the same fresh observation is never
 * reported: it reverts to the in-progress phase (UNRESOLVED) and is re-rendered. */
static char *settle(sqlite3 *db,const ControlConfig *c,Control *x){
 set_phase(db,x);char *receipt=render(db,x,c);
 if(receipt&&x->remaining!=0&&(!strcmp(x->phase,"CANCELLED")||!strcmp(x->phase,"STOPPED")||!strcmp(x->phase,"DRAINED"))){
  free(receipt);snprintf(x->phase,16,"%s",starting_phase(x->action));set_phase(db,x);receipt=render(db,x,c);}
 return receipt;
}
static int finish(sqlite3 *db,const ControlConfig *c,Control *x,FILE *out,int replayed){
 char *receipt=settle(db,c,x);if(!receipt)return hf_native_error(out,"RECEIPT_UNAVAILABLE");
 store_receipt(db,x,receipt);int delivered=report(db,c,x,receipt);
 fprintf(out,"{\"replayed\":%s,\"report_delivered\":%s,",replayed?"true":"false",delivered?"true":"false");fputs(receipt+1,out);free(receipt);return 0;
}
static int verify_authority(const HfJson *a,int r,const char *command,const char *action,const char *launch,const char *identity,const ControlConfig *c,long long *fence){
 char value[128],expected[128];HfJson *id=malloc(sizeof *id);int ok=id!=NULL;
 if(ok)ok=text_at(a,r,"command_id",value,sizeof value)&&!strcmp(value,command)&&text_at(a,r,"action",value,sizeof value)&&!strcmp(value,action)&&text_at(a,r,"launch_id",value,sizeof value)&&!strcmp(value,launch)&&
  text_at(a,r,"sandbox_id",value,sizeof value)&&!strcmp(value,c->sandbox)&&text_at(a,r,"boot_id",value,sizeof value)&&!strcmp(value,c->boot)&&text_at(a,r,"boot_generation",value,sizeof value)&&!strcmp(value,c->generation)&&
  text_at(a,r,"fence_sequence",value,sizeof value)&&(*fence=strtoll(value,NULL,10))>0&&text_at(a,r,"authority_epoch",value,sizeof value)&&hf_uuid_valid(value);
 if(ok&&identity&&*identity){ok=hf_json_parse(id,identity);const char *k[]={"attempt_id","attempt_generation","sandbox_id","boot_id","boot_generation"};for(unsigned i=0;ok&&i<5;++i)ok=hf_json_get(id,k[i],expected,sizeof expected)&&text_at(a,r,k[i],value,sizeof value)&&!strcmp(value,expected);}
 int list=hf_json_field(a,r,"required_outputs");ok=ok&&list>=0&&a->tokens[list].type=='['&&a->tokens[list].count<=16;
 for(int t=list+1;ok&&t<a->tokens[list].next;t=a->tokens[t].next){char path[4200];ok=hf_json_string(a,t,value,sizeof value)&&output_path("/",launch,value,path);}
 ControlPolicy p;ok=ok&&policy_of(a,r,&p);free(id);return ok;
}
static int control_command(const char *action,const char *request,FILE *out){
 HfJson *j=malloc(sizeof *j);char command[37],state[4096],launch[37];ControlConfig config,*c=NULL;Control x;memset(&x,0,sizeof x);
 int ok=j&&hf_json_parse(j,request)&&hf_json_get(j,"command_id",command,sizeof command)&&hf_uuid_valid(command)&&hf_json_get(j,"state_dir",state,sizeof state)&&hf_json_get(j,"launch_id",launch,sizeof launch)&&hf_uuid_valid(launch);
 if(!ok){free(j);return hf_native_error(out,"COMMAND_ID_REQUIRED");}
 sqlite3 *db=ledger(state);if(!db){free(j);return hf_native_error(out,"CONTROL_LEDGER_UNAVAILABLE");}
 if(request_config(j,state,&config))c=&config;
 int found=load_command(db,command,&x);HfRunnerBinding b;int bound=hf_runner_binding(request,&b);
 snprintf(x.state,sizeof x.state,"%s",state);
 if(found<0){free(j);free_control(&x);sqlite3_close(db);return hf_native_error(out,"CONTROL_LEDGER_CORRUPT");}
 if(found){
  if(strcmp(x.action,action)||strcmp(x.launch,launch)){free(j);free_control(&x);int rc=refuse(db,out,command,"COMMAND_CONFLICT");sqlite3_close(db);return rc;}
  if(final_phase(x.phase)){
   /* Recorded outcome is returned verbatim; only an undelivered report is retried. */
   sqlite3_stmt *q=NULL;char *receipt=NULL;int delivered=0;
   if(sqlite3_prepare_v2(db,"SELECT receipt,report_delivered FROM commands WHERE id=?",-1,&q,NULL)==SQLITE_OK){sqlite3_bind_text(q,1,command,-1,SQLITE_STATIC);if(sqlite3_step(q)==SQLITE_ROW&&sqlite3_column_type(q,0)!=SQLITE_NULL){receipt=strdup((const char*)sqlite3_column_text(q,0));delivered=sqlite3_column_int(q,1);}}sqlite3_finalize(q);
   if(!receipt){free(j);free_control(&x);sqlite3_close(db);return hf_native_error(out,"RECORDED_RECEIPT_MISSING");}
   HfJson *parsed=malloc(sizeof *parsed);if(parsed&&hf_json_parse(parsed,receipt)){int remaining=0;int64_t v=0;if(hf_json_i64(parsed,hf_json_field(parsed,0,"remaining_descendants"),&v))remaining=(int)v;x.remaining=remaining;}free(parsed);
   if(!delivered&&c)delivered=report(db,c,&x,receipt);
   fprintf(out,"{\"replayed\":true,\"report_delivered\":%s,",delivered?"true":"false");fputs(receipt+1,out);free(receipt);free(j);free_control(&x);sqlite3_close(db);return 0;
  }
  /* Non-final (restart or repeat): continue under the recorded authority. */
  if(bound){snprintf(x.identity,sizeof x.identity,"%s",b.identity);x.broker_alive=broker_alive(&b);}
  else{char slot[37];uid_t uid=0;int row=launch_row(state,launch,slot,&uid,NULL);if(row!=0){free(j);free_control(&x);int rc=refuse(db,out,command,"IDENTITY_MISMATCH");sqlite3_close(db);return rc;}x.prelaunch=1;}
  if(!x.prelaunch&&!*x.slot){
   /* A launch acknowledged after a pre-launch cancel adopts the recorded fence. */
   char slot[37],uid_text[32];uid_t uid=0;launch_row(state,launch,slot,&uid,NULL);snprintf(x.slot,37,"%s",slot);x.uid=uid;snprintf(uid_text,sizeof uid_text,"%lu",(unsigned long)uid);
   const char *v[]={x.slot,uid_text,command};exec_bind(db,"UPDATE commands SET slot=?,uid=? WHERE id=?",v,3);const char *f[]={uid_text,launch};exec_bind(db,"UPDATE fences SET uid=? WHERE launch=?",f,2);}
  execute(db,c,&x,request);if(!x.prelaunch)x.broker_alive=bound&&broker_alive(&b);
  int rc=finish(db,c,&x,out,0);free(j);free_control(&x);sqlite3_close(db);return rc;
 }
 char slot[37]="",identity[2048]="";uid_t uid=0;int row=launch_row(state,launch,slot,&uid,identity);
 int prelaunch=row==0&&(!strcmp(action,"runner.cancel")||!strcmp(action,"runner.stop"));
 if(!bound&&!prelaunch){free(j);int rc=refuse(db,out,command,"IDENTITY_MISMATCH");sqlite3_close(db);return rc;}
 if(!c){free(j);int rc=refuse(db,out,command,"AUTHORITY_TRANSPORT_UNCONFIGURED");sqlite3_close(db);return rc;}
 char input[256];snprintf(input,sizeof input,"{\"command_id\":\"%s\",\"launch_id\":\"%s\",\"action\":\"%s\"}",command,launch,action);
 HfJson *a=malloc(sizeof *a);int r=-1;char *body=NULL,code[96];int granted=a?service(c,"runner.control.authorize",input,a,&r,&body,code):-1;
 if(granted!=1){char reason[128];snprintf(reason,sizeof reason,granted==0?"CONTROL_AUTHORITY_REFUSED:%s":"AUTHORITY_UNAVAILABLE",code);free(a);free(body);free(j);int rc=refuse(db,out,command,reason);sqlite3_close(db);return rc;}
 long long fence=0;
 if(!verify_authority(a,r,command,action,launch,bound?b.identity:NULL,c,&fence)){free(a);free(body);free(j);int rc=refuse(db,out,command,"AUTHORITY_TARGET_MISMATCH");sqlite3_close(db);return rc;}
 /* Ordering against the launch's applied fence: late or superseded commands never act. */
 sqlite3_stmt *q=NULL;long long applied=0;char mode[16]="";
 if(sqlite3_prepare_v2(db,"SELECT fence,mode FROM fences WHERE launch=?",-1,&q,NULL)==SQLITE_OK){sqlite3_bind_text(q,1,launch,-1,SQLITE_STATIC);if(sqlite3_step(q)==SQLITE_ROW){applied=sqlite3_column_int64(q,0);snprintf(mode,sizeof mode,"%s",sqlite3_column_text(q,1));}}sqlite3_finalize(q);
 const char *refusal=fence<=applied?"CONTROL_ORDERING_STALE":((!strcmp(mode,"CANCEL")||!strcmp(mode,"STOP"))&&strcmp(action,"runner.cancel")&&strcmp(action,"runner.stop"))?"CONTROL_LAUNCH_TERMINATING":(!strcmp(action,"runner.resume")&&strcmp(mode,"PAUSE")&&strcmp(mode,"DRAIN"))?"CONTROL_RESUME_STATE_INVALID":NULL;
 if(refusal){free(a);free(body);free(j);int rc=refuse(db,out,command,refusal);sqlite3_close(db);return rc;}
 char *raw=hf_json_raw(a,r);free(body);free(a);
 if(!raw){free(j);sqlite3_close(db);return hf_native_error(out,"AUTHORITY_UNAVAILABLE");}
 int closes=strcmp(action,"runner.resume")!=0,publication=!strcmp(action,"runner.cancel")||!strcmp(action,"runner.stop");
 char at[32],fence_text[32],uid_text[32];snprintf(at,sizeof at,"%lld",(long long)time(NULL));snprintf(fence_text,sizeof fence_text,"%lld",fence);snprintf(uid_text,sizeof uid_text,"%lu",(unsigned long)(bound?b.uid:uid));
 const char *cv[]={command,action,launch,uid_text,slot,fence_text,raw,starting_phase(action),at,at};
 const char *fv[]={launch,uid_text,mode_of(action),command,fence_text,closes?"1":"0",closes?"1":"0",publication?"1":"0",at};
 ok=sqlite3_exec(db,"BEGIN IMMEDIATE",NULL,NULL,NULL)==SQLITE_OK&&exec_bind(db,"INSERT INTO commands(id,action,launch,uid,slot,fence,authority,phase,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)",cv,10)&&
  exec_bind(db,"UPDATE commands SET phase='SUPERSEDED',updated=? WHERE launch=? AND id<>? AND phase NOT IN('PAUSED','DRAINED','CANCELLED','STOPPED','RESUMED','SUPERSEDED')",(const char*[]){at,launch,command},3)&&
  exec_bind(db,"INSERT INTO fences(launch,uid,mode,command,fence,admission_closed,input_closed,publication_fenced,updated) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(launch) DO UPDATE SET uid=excluded.uid,mode=excluded.mode,command=excluded.command,fence=excluded.fence,admission_closed=excluded.admission_closed,input_closed=excluded.input_closed,publication_fenced=MAX(fences.publication_fenced,excluded.publication_fenced),updated=excluded.updated",fv,9)&&
  sqlite3_exec(db,"COMMIT",NULL,NULL,NULL)==SQLITE_OK;
 free(raw);if(!ok){sqlite3_exec(db,"ROLLBACK",NULL,NULL,NULL);free(j);sqlite3_close(db);return hf_native_error(out,"DURABLE_FENCE_FAILED");}
 int loaded=load_command(db,command,&x);snprintf(x.state,sizeof x.state,"%s",state);x.prelaunch=prelaunch&&!bound;if(bound){snprintf(x.identity,sizeof x.identity,"%s",b.identity);}
 if(loaded!=1){free(j);free_control(&x);sqlite3_close(db);return hf_native_error(out,"CONTROL_LEDGER_CORRUPT");}
 execute(db,c,&x,request);x.broker_alive=!x.prelaunch&&bound&&broker_alive(&b);
 int rc=finish(db,c,&x,out,0);free(j);free_control(&x);sqlite3_close(db);return rc;
}

/* Observation only: no authority, never changes state. */
static int observe(const char *request,FILE *out){
 HfRunnerBinding b;if(!hf_runner_binding(request,&b))return hf_native_error(out,"IDENTITY_MISMATCH");
 char *rpc=NULL;size_t n=0;FILE *stream=open_memstream(&rpc,&n);int live=0;
 if(stream){live=hf_launch_rpc(b.state_dir,"runner.observe",request,stream)==0;fclose(stream);}
 HfProcessIdentity list[1024];int count=hf_runner_processes(&b,list,1024);int alive=broker_alive(&b);
 sqlite3 *db=ledger(b.state_dir);sqlite3_stmt *q=NULL;char command[37]="",act[32]="",phase[16]="";
 if(db&&sqlite3_prepare_v2(db,"SELECT id,action,phase FROM commands WHERE launch=? ORDER BY fence DESC LIMIT 1",-1,&q,NULL)==SQLITE_OK){sqlite3_bind_text(q,1,b.launch_id,-1,SQLITE_STATIC);if(sqlite3_step(q)==SQLITE_ROW){snprintf(command,37,"%s",sqlite3_column_text(q,0));snprintf(act,32,"%s",sqlite3_column_text(q,1));snprintf(phase,16,"%s",sqlite3_column_text(q,2));}}
 sqlite3_finalize(q);char observation[37];if(!hf_uuid_generate(observation)){sqlite3_close(db);free(rpc);return hf_native_error(out,"RANDOM_SOURCE_FAILED");}
 const char *status=count==0&&!alive?"CONFIRMED_STOPPED":(live&&count>0&&(!*phase||!strcmp(phase,"RESUMED")))?"RUNNING":"UNKNOWN";
 fprintf(out,"{\"status\":\"%s\",\"command_id\":null,\"launch_id\":\"%s\",\"observation_id\":\"%s\",\"observed_at_seconds\":%lld,\"binding\":%s,\"processes\":[",status,b.launch_id,observation,(long long)time(NULL),b.identity);
 for(int k=0;k<count;++k){if(k)fputc(',',out);hf_process_json(out,&list[k]);}
 fprintf(out,"],\"remaining_descendants\":%d,\"ipc_closed\":%s,\"broker_observation_live\":%s,\"control\":",count<0?0:count,alive?"false":"true",live?"true":"false");
 if(*command)fprintf(out,"{\"command_id\":\"%s\",\"action\":\"%s\",\"phase\":\"%s\"}",command,act,phase);else fputs("null",out);
 fputs(",\"required_artifacts\":[",out);int complete=*command&&count==0&&!alive,first=1;
 if(db&&*command&&sqlite3_prepare_v2(db,"SELECT name,digest,local_durable,capture_receipt FROM outputs WHERE command=? ORDER BY name",-1,&q,NULL)==SQLITE_OK){sqlite3_bind_text(q,1,command,-1,SQLITE_STATIC);
  while(sqlite3_step(q)==SQLITE_ROW){int captured=sqlite3_column_type(q,3)!=SQLITE_NULL;if(!captured||!sqlite3_column_int(q,2))complete=0;fprintf(out,"%s{\"name\":",first?"":",");first=0;hf_json_write_string(out,(const char*)sqlite3_column_text(q,0));fputs(",\"digest\":",out);if(sqlite3_column_type(q,1)!=SQLITE_NULL)hf_json_write_string(out,(const char*)sqlite3_column_text(q,1));else fputs("null",out);fprintf(out,",\"local_durable\":%s,\"capture_receipt\":",sqlite3_column_int(q,2)?"true":"false");if(captured)hf_json_write_string(out,(const char*)sqlite3_column_text(q,3));else fputs("null",out);fputc('}',out);}}
 sqlite3_finalize(q);fputs("],\"credential_revocation\":[",out);first=1;
 if(db&&*command&&sqlite3_prepare_v2(db,"SELECT name,state FROM credentials WHERE command=? ORDER BY name",-1,&q,NULL)==SQLITE_OK){sqlite3_bind_text(q,1,command,-1,SQLITE_STATIC);while(sqlite3_step(q)==SQLITE_ROW){if(!strcmp((const char*)sqlite3_column_text(q,1),"UNRESOLVED"))complete=0;fprintf(out,"%s{\"name\":",first?"":",");first=0;hf_json_write_string(out,(const char*)sqlite3_column_text(q,0));fprintf(out,",\"state\":\"%s\"}",sqlite3_column_text(q,1));}}
 sqlite3_finalize(q);sqlite3_close(db);free(rpc);
 if(strcmp(phase,"CANCELLED")&&strcmp(phase,"STOPPED")&&strcmp(phase,"DRAINED"))complete=0;
 fprintf(out,"],\"native_context_recoverable\":false,\"cleanup_complete\":%s,\"recovery_required\":%s}",complete?"true":"false",complete?"false":"true");return 0;
}

/* Slot reuse gate: residue checks, durable outputs and the coordinator workspace release. */
static int slot_release(const char *request,FILE *out){
 HfJson *j=malloc(sizeof *j);char command[37],state[4096],launch[37];ControlConfig config,*c=NULL;Control x;memset(&x,0,sizeof x);
 int ok=j&&hf_json_parse(j,request)&&hf_json_get(j,"command_id",command,sizeof command)&&hf_uuid_valid(command)&&hf_json_get(j,"state_dir",state,sizeof state)&&hf_json_get(j,"launch_id",launch,sizeof launch)&&hf_uuid_valid(launch);
 sqlite3 *db=ok?ledger(state):NULL;if(ok&&request_config(j,state,&config))c=&config;free(j);
 if(!db)return hf_native_error(out,"CONTROL_LEDGER_UNAVAILABLE");
 if(load_command(db,command,&x)!=1||strcmp(x.launch,launch)||(strcmp(x.phase,"CANCELLED")&&strcmp(x.phase,"STOPPED")&&strcmp(x.phase,"DRAINED"))){free_control(&x);sqlite3_close(db);return hf_native_error(out,"SLOT_RELEASE_NOT_TERMINATED");}
 snprintf(x.state,sizeof x.state,"%s",state);
 revoke_credentials(db,c,x.slot,x.command);HfProcessIdentity list[1024];int processes=uid_tree(x.uid,list,1024),credentials=credential_residue(c,x.slot);
 int captured=capture_outputs(db,c,x.command);
 sqlite3_stmt *q=NULL;int delivered=0,recorded_complete=0;char *receipt=NULL;
 if(sqlite3_prepare_v2(db,"SELECT report_delivered,receipt FROM commands WHERE id=?",-1,&q,NULL)==SQLITE_OK){sqlite3_bind_text(q,1,command,-1,SQLITE_STATIC);if(sqlite3_step(q)==SQLITE_ROW){delivered=sqlite3_column_int(q,0);if(sqlite3_column_type(q,1)!=SQLITE_NULL)receipt=strdup((const char*)sqlite3_column_text(q,1));}}sqlite3_finalize(q);
 HfJson *parsed=malloc(sizeof *parsed);int64_t remaining=0;if(receipt&&parsed&&hf_json_parse(parsed,receipt)){hf_json_bool(parsed,hf_json_field(parsed,0,"cleanup_complete"),&recorded_complete);if(hf_json_i64(parsed,hf_json_field(parsed,0,"remaining_descendants"),&remaining))x.remaining=(int)remaining;}free(parsed);
 /* The recorded outcome is immutable; only a newly proven cleanup completion is re-reported. */
 if(!recorded_complete){char *fresh=render(db,&x,c);HfJson *check=malloc(sizeof *check);int now_complete=0;
  if(fresh&&check&&hf_json_parse(check,fresh))hf_json_bool(check,hf_json_field(check,0,"cleanup_complete"),&now_complete);
  free(check);
  if(now_complete){free(receipt);receipt=fresh;store_receipt(db,&x,receipt);delivered=report(db,c,&x,receipt);}else free(fresh);}
 if(!delivered&&receipt)delivered=report(db,c,&x,receipt);
 char blocking[1024]="";size_t used=0;
#define BLOCK(s) do{int w=snprintf(blocking+used,sizeof blocking-used,"%s\"%s\"",used?",":"",s);if(w>0&&(size_t)w<sizeof blocking-used)used+=(size_t)w;}while(0)
 if(processes!=0)BLOCK("PROCESS_RESIDUE");
 if(credentials!=0)BLOCK("CREDENTIAL_RESIDUE");
 if(!captured)BLOCK("OUTPUTS_NOT_DURABLE");
 if(!delivered)BLOCK("REPORT_UNDELIVERED");
 char service_state[32]="UNAVAILABLE";
 if(c){char digest[65],evidence[512];snprintf(evidence,sizeof evidence,"%s:%d:%d:%d",command,processes,credentials,captured);hf_sha256_bytes(evidence,strlen(evidence),digest);
  char input[512];snprintf(input,sizeof input,"{\"slot_id\":\"%s\",\"launch_id\":\"%s\",\"command_id\":\"%s\",\"process_residue\":\"%s\",\"credential_residue\":\"%s\",\"evidence_digest\":\"sha256:%s\"}",x.slot,launch,command,processes==0?"ABSENT":"PRESENT",credentials==0?"ABSENT":"PRESENT",digest);
  HfJson *s=malloc(sizeof *s);int result=-1;char *body=NULL,code[96];int accepted=s?service(c,"runner.workspace.release",input,s,&result,&body,code):-1;
  if(accepted==1)text_at(s,result,"state",service_state,sizeof service_state);else snprintf(service_state,sizeof service_state,"%s",accepted==0?"REFUSED":"UNAVAILABLE");free(body);free(s);}
 if(strcmp(service_state,"FREE"))BLOCK("COORDINATOR_WORKSPACE_NOT_FREE");
#undef BLOCK
 int reusable=used==0;
 if(reusable){reusable=c&&slot_state(c,x.slot,x.uid,"READY");launch_update(state,launch,x.uid,"STOPPED");const char *v[]={launch};exec_bind(db,"UPDATE fences SET admission_closed=0,input_closed=0,updated=unixepoch() WHERE launch=?",v,1);}
 else if(c)slot_state(c,x.slot,x.uid,"CLEANUP_REQUIRED");
 fprintf(out,"{\"command_id\":\"%s\",\"launch_id\":\"%s\",\"slot_id\":\"%s\",\"uid\":%lu,\"reusable\":%s,\"blocking\":[%s],\"process_residue\":%d,\"credential_residue\":%d,\"outputs_durable\":%s,\"report_delivered\":%s,\"coordinator_workspace\":\"%s\",\"receipt\":%s}",
  command,launch,x.slot,(unsigned long)x.uid,reusable?"true":"false",blocking,processes,credentials,captured?"true":"false",delivered?"true":"false",service_state,receipt?receipt:"null");
 free(receipt);free_control(&x);sqlite3_close(db);return 0;
}

/* Restart reconciliation: resume in-progress commands under their recorded
 * authority, redeliver lost reports, and cancel jobs whose executor vanished. */
static int reconcile(const char *request,FILE *out){
 HfJson *j=malloc(sizeof *j);char state[4096];ControlConfig config,*c=NULL;
 int ok=j&&hf_json_parse(j,request)&&hf_json_get(j,"state_dir",state,sizeof state);sqlite3 *db=ok?ledger(state):NULL;if(db&&request_config(j,state,&config))c=&config;free(j);
 if(!db)return hf_native_error(out,"CONTROL_LEDGER_UNAVAILABLE");
 char ids[64][37];int count=0;sqlite3_stmt *q=NULL;
 if(sqlite3_prepare_v2(db,"SELECT id FROM commands WHERE phase NOT IN('PAUSED','DRAINED','CANCELLED','STOPPED','RESUMED','SUPERSEDED') OR report_delivered=0 ORDER BY fence",-1,&q,NULL)==SQLITE_OK)while(count<64&&sqlite3_step(q)==SQLITE_ROW)snprintf(ids[count++],37,"%s",sqlite3_column_text(q,0));
 sqlite3_finalize(q);fputs("{\"commands\":[",out);
 for(int k=0;k<count;++k){
  Control x;memset(&x,0,sizeof x);if(load_command(db,ids[k],&x)!=1){free_control(&x);continue;}snprintf(x.state,sizeof x.state,"%s",state);char before[16];snprintf(before,16,"%s",x.phase);
  char identity[2048]="",slot[37];uid_t uid=0;int row=launch_row(state,x.launch,slot,&uid,identity);int delivered=0;
  if(!final_phase(x.phase)){
   char *req=NULL;size_t n=0;FILE *w=open_memstream(&req,&n);HfJson *id=malloc(sizeof *id);int built=0;
   if(w&&id&&row==1&&hf_json_parse(id,identity)){fprintf(w,"{\"state_dir\":");hf_json_write_string(w,state);fprintf(w,",\"launch_id\":\"%s\",\"command_id\":\"%s\"",x.launch,x.command);const char *keys[]={"attempt_id","attempt_generation","sandbox_id","boot_id","boot_generation"};for(unsigned i=0;i<5;++i){char v[128]="";hf_json_get(id,keys[i],v,sizeof v);fprintf(w,",\"%s\":",keys[i]);hf_json_write_string(w,v);}fputc('}',w);built=1;}
   if(w)fclose(w);
   free(id);HfRunnerBinding b;int bound=built&&hf_runner_binding(req,&b);
   if(bound){snprintf(x.identity,sizeof x.identity,"%s",b.identity);if(!*x.slot){snprintf(x.slot,37,"%s",slot);x.uid=uid;}}else x.prelaunch=row==0;
   if(bound||x.prelaunch){execute(db,c,&x,req?req:"{}");x.broker_alive=bound&&broker_alive(&b);char *receipt=settle(db,c,&x);if(receipt){store_receipt(db,&x,receipt);delivered=report(db,c,&x,receipt);free(receipt);}}
   free(req);
  }else{
   sqlite3_stmt *s=NULL;char *receipt=NULL;if(sqlite3_prepare_v2(db,"SELECT receipt FROM commands WHERE id=?",-1,&s,NULL)==SQLITE_OK){sqlite3_bind_text(s,1,x.command,-1,SQLITE_STATIC);if(sqlite3_step(s)==SQLITE_ROW&&sqlite3_column_type(s,0)!=SQLITE_NULL)receipt=strdup((const char*)sqlite3_column_text(s,0));}sqlite3_finalize(s);
   if(receipt){HfJson *p=malloc(sizeof *p);int64_t v=0;if(p&&hf_json_parse(p,receipt)&&hf_json_i64(p,hf_json_field(p,0,"remaining_descendants"),&v))x.remaining=(int)v;free(p);delivered=report(db,c,&x,receipt);free(receipt);}
  }
  fprintf(out,"%s{\"command_id\":\"%s\",\"action\":\"%s\",\"phase_before\":\"%s\",\"phase\":\"%s\",\"report_delivered\":%s}",k?",":"",x.command,x.action,before,x.phase,delivered?"true":"false");free_control(&x);
 }
 fputs("],\"jobs\":[",out);
 char path[4200];snprintf(path,sizeof path,"%s/jobs.db",state);sqlite3 *jobs=NULL;int first=1;struct stat st;
 if(!lstat(path,&st)&&S_ISREG(st.st_mode)&&st.st_uid==0&&!(st.st_mode&077)&&sqlite3_open_v2(path,&jobs,SQLITE_OPEN_READWRITE,NULL)==SQLITE_OK){
  sqlite3_busy_timeout(jobs,5000);char ops[64][37];uid_t uids[64];long pids[64];unsigned long long starts[64];int n=0;
  if(sqlite3_prepare_v2(jobs,"SELECT id,uid,COALESCE(pid,0),COALESCE(start_time,'0') FROM jobs WHERE state<>'TERMINAL'",-1,&q,NULL)==SQLITE_OK)while(n<64&&sqlite3_step(q)==SQLITE_ROW){snprintf(ops[n],37,"%s",sqlite3_column_text(q,0));uids[n]=(uid_t)sqlite3_column_int64(q,1);pids[n]=sqlite3_column_int64(q,2);starts[n]=strtoull((const char*)sqlite3_column_text(q,3),NULL,10);++n;}
  sqlite3_finalize(q);
  for(int k=0;k<n;++k){
   HfProcessIdentity child;int alive=pids[k]>0&&hf_process_identity((pid_t)pids[k],&child)&&child.start_time==starts[k]&&child.state!='Z';
   if(alive)continue;
   /* The executor vanished (disconnected/restarted): its slot lock, if still held, belongs to a live owner. */
   int lock=hf_slot_control_lock(uids[k],ops[k]);int owner_live=lock<0&&hf_slot_owner(uids[k],ops[k]);if(owner_live)continue;
   int remaining=terminate(uids[k],0,1);if(lock>=0)close(lock);
   char receipt[512],file[4400];int w=snprintf(receipt,sizeof receipt,"{\"operation_id\":\"%s\",\"outcome\":\"CANCELLED_DISCONNECTED\",\"termination\":\"%s\",\"remaining_descendants\":%d,\"reconciled_at_seconds\":%lld}",ops[k],remaining==0?"CONFIRMED":"UNRESOLVED",remaining,(long long)time(NULL));
   snprintf(file,sizeof file,"%s/job-%.36s.cancelled.json",state,ops[k]);int written=w>0&&hf_private_write(file,receipt,(size_t)w,1);
   char uid_text[32],at[32];snprintf(uid_text,sizeof uid_text,"%lu",(unsigned long)uids[k]);snprintf(at,sizeof at,"%lld",(long long)time(NULL));const char *v[]={ops[k],uid_text,"EXECUTOR_DISCONNECTED",remaining==0?"CONFIRMED":"UNRESOLVED",at};
   exec_bind(db,"INSERT INTO job_cancellations(operation,uid,reason,termination,at) VALUES(?,?,?,?,?) ON CONFLICT(operation) DO NOTHING",v,5);
   if(remaining==0&&written){sqlite3_stmt *u=NULL;if(sqlite3_prepare_v2(jobs,"UPDATE jobs SET state='TERMINAL' WHERE id=? AND state<>'TERMINAL'",-1,&u,NULL)==SQLITE_OK){sqlite3_bind_text(u,1,ops[k],-1,SQLITE_STATIC);sqlite3_step(u);}sqlite3_finalize(u);}
   fprintf(out,"%s{\"operation_id\":\"%s\",\"outcome\":\"CANCELLED_DISCONNECTED\",\"termination\":\"%s\",\"remaining_descendants\":%d}",first?"":",",ops[k],remaining==0?"CONFIRMED":"UNRESOLVED",remaining);first=0;
  }
  sqlite3_close(jobs);
 }
 fputs("]}",out);sqlite3_close(db);return 0;
}

/* Root-local replay of a root-private claim file through the production stager. */
static int stage(const char *request,FILE *out){
 HfJson *j=malloc(sizeof *j),*claim=malloc(sizeof *claim);char config[4096],path[4096],*raw=NULL;size_t n=0;HfPreparationStage s;
 int ok=j&&claim&&hf_json_parse(j,request)&&hf_json_get(j,"config_path",config,sizeof config)&&hf_json_get(j,"claim_path",path,sizeof path)&&hf_private_read(path,HF_BODY_LIMIT,&raw,&n)&&hf_json_parse(claim,raw);
 int result=ok?hf_json_field(claim,0,"result"):-1;ok=ok&&result>=0&&hf_runner_stage_preparation(config,claim,result,&s);
 char digest[72]="";unsigned long long size=0;if(ok){int fd=open(s.context_path,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);ok=fd>=0&&fd_digest(fd,digest,&size);if(fd>=0)close(fd);}
 free(j);free(claim);free(raw);if(!ok)return hf_native_error(out,"PREPARATION_STAGE_REFUSED");
 fputs("{\"context_path\":",out);hf_json_write_string(out,s.context_path);fprintf(out,",\"context_digest\":\"%s\",\"stage_root\":",digest);hf_json_write_string(out,s.stage_root);
 fputs(",\"out_root\":",out);hf_json_write_string(out,s.out_root);fputs(",\"diagnostics_root\":",out);hf_json_write_string(out,s.diagnostics_root);fputs(",\"workspace_path\":",out);hf_json_write_string(out,s.workspace_path);
 fprintf(out,",\"node_digest\":\"%s\",\"recipe_digest\":\"%s\",\"uid\":%lu,\"gid\":%lu,\"authority\":\"NONE\"}",s.node_digest,s.recipe_digest,(unsigned long)s.uid,(unsigned long)s.gid);return 0;
}

int hf_component_12_4(const char *action,const char *request,FILE *out) {
 if(!strcmp(action,"runner.job.execute"))return hf_runner_job_execute(request,out);
 if(geteuid()!=0)return hf_native_error(out,"ROOT_REQUIRED");
 if(!strcmp(action,"runner.observe"))return observe(request,out);
 if(!strcmp(action,"runner.pause")||!strcmp(action,"runner.drain")||!strcmp(action,"runner.cancel")||!strcmp(action,"runner.stop")||!strcmp(action,"runner.resume"))return control_command(action,request,out);
 if(!strcmp(action,"runner.slot.release"))return slot_release(request,out);
 if(!strcmp(action,"runner.reconcile"))return reconcile(request,out);
 if(!strcmp(action,"runner.preparation.stage"))return stage(request,out);
 return hf_native_error(out,"UNKNOWN_ACTION");
}
