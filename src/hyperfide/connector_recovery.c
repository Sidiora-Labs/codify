/* Native connector boundary. The supervisor owns persistent pipes and process lifetime.
 * CLI presence is measured here; inference/resume capability needs a separate live receipt. */
#define _GNU_SOURCE
#include "components.h"
#include "supervisor.h"
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
typedef struct { char key[64]; const char *start; size_t len; } Field;
static const char *space(const char *p){while(*p&&strchr(" \t\r\n",*p))p++;return p;}
static const char *endstr(const char *p){if(*p++!='"')return NULL;while(*p&&*p!='"'){if((unsigned char)*p<32)return NULL;if(*p++=='\\'){if(!*p)return NULL;if(*p=='u'){p++;for(int i=0;i<4;i++)if(!isxdigit((unsigned char)*p++))return NULL;}else if(!strchr("\"\\/bfnrt",*p++))return NULL;}}return *p=='"'?p+1:NULL;}
static const char *skip(const char *p,unsigned d){p=space(p);if(d>32)return NULL;if(*p=='"')return endstr(p);if(*p=='{'||*p=='['){int obj=*p=='{';char close=obj?'}':']';p=space(p+1);if(*p==close)return p+1;for(;;){if(obj){p=endstr(p);if(!p||*(p=space(p))!=':')return NULL;p++;}p=skip(p,d+1);if(!p)return NULL;p=space(p);if(*p==close)return p+1;if(*p!=',')return NULL;p=space(p+1);}}const char *b=p;while(*p&&!strchr(",}] \t\r\n",*p))p++;return p==b?NULL:p;}
static int fields(const char *json,Field *fs,int cap,const char *allowed){const char *p=space(json);int n=0;if(*p++!='{')return -1;p=space(p);if(*p=='}')return *space(p+1)?-1:0;for(;;){const char *q=endstr(p);if(!q||n==cap)return -1;size_t len=(size_t)(q-p-2);if(len==0||len>=sizeof fs[n].key||memchr(p+1,'\\',len))return -1;memcpy(fs[n].key,p+1,len);fs[n].key[len]=0;char match[72];snprintf(match,sizeof match,"|%.63s|",fs[n].key);if(!strstr(allowed,match))return -1;for(int i=0;i<n;i++)if(!strcmp(fs[i].key,fs[n].key))return -1;p=space(q);if(*p++!=':')return -1;p=space(p);q=skip(p,0);if(!q)return -1;fs[n].start=p;fs[n++].len=(size_t)(q-p);p=space(q);if(*p=='}')return *space(p+1)?-1:n;if(*p!=',')return -1;p=space(p+1);}}
static Field *field(Field *fs,int n,const char *k){for(int i=0;i<n;i++)if(!strcmp(fs[i].key,k))return fs+i;return NULL;}
static int string(Field *f,char *dst,size_t cap){if(!f||f->len<2||*f->start!='"')return 0;size_t j=0;const char *p=f->start+1,*e=f->start+f->len-1;while(p<e){unsigned char ch=(unsigned char)*p++;if(ch=='\\'){ch=(unsigned char)*p++;const char *keys="\"\\/bfnrt",*vals="\"\\/\b\f\n\r\t",*k=strchr(keys,ch);if(!k)return 0;ch=(unsigned char)vals[k-keys];}if(!ch||j+1>=cap)return 0;dst[j++]=(char)ch;}dst[j]=0;return 1;}
static void quoted(FILE *o,const char *s){fputc('"',o);for(const unsigned char *p=(const unsigned char*)s;*p;p++){switch(*p){case '"':fputs("\\\"",o);break;case '\\':fputs("\\\\",o);break;case '\n':fputs("\\n",o);break;case '\r':fputs("\\r",o);break;case '\t':fputs("\\t",o);break;default:if(*p<32)fprintf(o,"\\u%04x",*p);else fputc(*p,o);}}fputc('"',o);}
static int error(FILE *o,const char *code){fprintf(o,"{\"error\":{\"code\":\"%s\"}}",code);return 1;}
static int safe_id(const char *s){if(!*s||strlen(s)>128)return 0;for(;*s;s++)if(!isalnum((unsigned char)*s)&&!strchr("._:-",*s))return 0;return 1;}

static int digest(const char *s){if(strlen(s)!=71||strncmp(s,"sha256:",7))return 0;for(s+=7;*s;s++)if(!strchr("0123456789abcdef",*s))return 0;return 1;}
static int get(Field *fs,int n,const char *key,char *out,size_t size){return string(field(fs,n,key),out,size);}
static int integer(Field *f,unsigned long long max,unsigned long long *out){if(!f||!f->len||f->len>20||(f->len>1&&*f->start=='0'))return 0;unsigned long long v=0;for(size_t i=0;i<f->len;i++){if(!isdigit((unsigned char)f->start[i])||v>(max-(unsigned)(f->start[i]-'0'))/10)return 0;v=v*10+(unsigned)(f->start[i]-'0');}*out=v;return 1;}
static int decimal(const char *s,unsigned long long *out){if(!*s||strlen(s)>20||(s[0]=='0'&&s[1]))return 0;Field f={"",s,strlen(s)};return integer(&f,~0ULL,out);}
static int is_null(Field *f){return f&&f->len==4&&!memcmp(f->start,"null",4);}
extern int hf_connector_resume_qualified(const char *,char *,size_t);

/* Measured, never caller-asserted: the recorded launch identity is compared with /proc and the kernel boot id. */
typedef struct {const char *state;HfProcessIdentity seen;int have;char kernel_boot[64];} Observation;
static void observe(pid_t pid,const char *boot,unsigned long long start,Observation *o){
 memset(o,0,sizeof *o);o->state="UNOBSERVABLE";
 FILE *f=fopen("/proc/sys/kernel/random/boot_id","re");if(!f)return;
 int ok=fgets(o->kernel_boot,sizeof o->kernel_boot,f)!=NULL;fclose(f);o->kernel_boot[strcspn(o->kernel_boot,"\r\n")]=0;
 if(!ok||!hf_uuid_valid(o->kernel_boot)){o->kernel_boot[0]=0;return;}
 if(strcmp(o->kernel_boot,boot)){o->state="BOOT_CHANGED";return;}
 if(hf_process_identity(pid,&o->seen)){o->have=1;o->state=o->seen.start_time!=start?"PID_REUSED":strchr("ZXx",o->seen.state)?"EXITED":"ALIVE";return;}
 errno=0;if(kill(pid,0)<0&&errno==ESRCH)o->state="ABSENT";
}
/* Supervisor-held write end of the native stdin pipe: POLLERR is a dead reader, FIONREAD is undelivered bytes. */
static const char *pipe_observe(int fd,int *pending){
 struct stat st;int flags=fcntl(fd,F_GETFL);*pending=0;
 if(fd<3||flags<0||(flags&O_ACCMODE)!=O_WRONLY||fstat(fd,&st)||!S_ISFIFO(st.st_mode))return NULL;
 struct pollfd p={fd,POLLOUT,0};if(poll(&p,1,0)<0)return NULL;
 if(p.revents&(POLLERR|POLLNVAL))return "CLOSED";
 if(ioctl(fd,FIONREAD,pending)<0)return NULL;
 return "OPEN";
}
/* The handoff record must hash to the supplied digest and carry provenance equal to this request. */
static const char *handoff_bound(const char *doc,const char *want,const char *connector,const char *native,const char *fresh,const char *source,const char *configuration,const char *checkpoint,char *context,size_t cap){
 char hex[65],have[80],tmp[256];if(!hf_sha256_bytes(doc,strlen(doc),hex))return "HANDOFF_UNVERIFIABLE";snprintf(have,sizeof have,"sha256:%s",hex);
 if(strcmp(have,want))return "HANDOFF_DIGEST_MISMATCH";
 Field hs[12];int n=fields(doc,hs,12,"|schema_version||kind||connector||prior_native_session_id||new_agent_session_id||source_manifest_digest||configuration_digest||checkpoint_reference||context_digest|");
 Field *v=field(hs,n,"schema_version"),*cp=field(hs,n,"checkpoint_reference");
 if(n!=9||!v||v->len!=1||*v->start!='1'||!get(hs,n,"kind",tmp,sizeof tmp)||strcmp(tmp,"hyperfide.connector.handoff"))return "HANDOFF_INVALID";
 if(!get(hs,n,"connector",tmp,sizeof tmp)||strcmp(tmp,connector)||!get(hs,n,"prior_native_session_id",tmp,sizeof tmp)||strcmp(tmp,native)||
    !get(hs,n,"new_agent_session_id",tmp,sizeof tmp)||strcmp(tmp,fresh))return "HANDOFF_SESSION_MISMATCH";
 if(!get(hs,n,"source_manifest_digest",tmp,sizeof tmp)||strcmp(tmp,source)||!get(hs,n,"configuration_digest",tmp,sizeof tmp)||strcmp(tmp,configuration))return "HANDOFF_SOURCE_MISMATCH";
 if(checkpoint[0]?!get(hs,n,"checkpoint_reference",tmp,sizeof tmp)||strcmp(tmp,checkpoint):!is_null(cp))return "HANDOFF_CHECKPOINT_MISMATCH";
 if(!get(hs,n,"context_digest",context,cap)||!digest(context))return "HANDOFF_INVALID";
 return NULL;
}
static void opt(FILE *o,const char *s){if(s&&*s)quoted(o,s);else fputs("null",o);}
int hf_component_13_3(const char *action,const char *json,FILE *out){
 if(strcmp(action,"connector.recover"))return error(out,"CONNECTOR_UNSUPPORTED");
 Field fs[24];int n=fields(json,fs,24,"|connector||native_session_id||source_manifest_digest||configuration_digest||auth_state||transport_state||process_pid||process_boot_id||process_start_time||protocol_delivery||protocol_fd||saved_native_session_id||checkpoint_source_manifest_digest||checkpoint_configuration_digest||checkpoint_reference||new_agent_session_id||handoff_digest||handoff_document|");
 char connector[16],native[256],source[80],configuration[80],auth[32],transport[32],boot[129],start[32],delivery[32];unsigned long long pid=0,start_time=0,fd=0;
 if(n<10||!get(fs,n,"connector",connector,sizeof connector)||(strcmp(connector,"codex")&&strcmp(connector,"claude"))||
 !get(fs,n,"native_session_id",native,sizeof native)||!safe_id(native)||
 !get(fs,n,"source_manifest_digest",source,sizeof source)||!digest(source)||
 !get(fs,n,"configuration_digest",configuration,sizeof configuration)||!digest(configuration)||
 !get(fs,n,"auth_state",auth,sizeof auth)||(strcmp(auth,"VALID")&&strcmp(auth,"EXPIRED")&&strcmp(auth,"REVOKED")&&strcmp(auth,"UNKNOWN"))||
 !get(fs,n,"transport_state",transport,sizeof transport)||(strcmp(transport,"CONNECTED")&&strcmp(transport,"LOST"))||
 !integer(field(fs,n,"process_pid"),4194304,&pid)||pid<2||
 !get(fs,n,"process_boot_id",boot,sizeof boot)||!hf_uuid_valid(boot)||
 !get(fs,n,"process_start_time",start,sizeof start)||!decimal(start,&start_time)||!start_time||
 !get(fs,n,"protocol_delivery",delivery,sizeof delivery)||(strcmp(delivery,"ACKNOWLEDGED")&&strcmp(delivery,"PARTIAL")&&strcmp(delivery,"UNKNOWN"))||
 (field(fs,n,"protocol_fd")&&!integer(field(fs,n,"protocol_fd"),65535,&fd)))return error(out,"RECOVERY_INVALID");
 const char *pipe_state="NOT_SUPPLIED";int pending=0;
 if(field(fs,n,"protocol_fd")&&!(pipe_state=pipe_observe((int)fd,&pending)))return error(out,"PROTOCOL_FD_UNOBSERVABLE");
 Observation ob;observe((pid_t)pid,boot,start_time,&ob);
 const char *decision="RECONCILE",*reason="PROCESS_UNOBSERVABLE";int lost=0;
 char new_agent[256]="",handoff_ref[80]="",qualification[80]="",checkpoint[80]="",context[80]="";
 if(strcmp(auth,"VALID")){decision="BLOCKED_AUTH";reason=auth;}
 else if(!strcmp(ob.state,"BOOT_CHANGED"))reason="PROCESS_BOOT_CHANGED";
 else if(!strcmp(ob.state,"PID_REUSED"))reason="PROCESS_PID_REUSED";
 else if(!strcmp(ob.state,"ALIVE")){
  if(!strcmp(pipe_state,"CLOSED"))reason="PROTOCOL_PIPE_CLOSED";
  else if(strcmp(delivery,"ACKNOWLEDGED")||pending>0){decision="REHANDSHAKE_EXISTING";reason="PROTOCOL_DELIVERY_UNCERTAIN";}
  else{decision=!strcmp(transport,"LOST")?"RECONNECT_EXISTING":"CONTINUE_EXISTING";reason="EXACT_PROCESS_OBSERVED";}
 }else if(!strcmp(pipe_state,"OPEN"))reason="PROTOCOL_PIPE_ORPHANED";
 else if(!strcmp(ob.state,"EXITED")||!strcmp(ob.state,"ABSENT")){
  char saved[256]="",cs[80]="",cc[80]="",fresh[256]="",handoff[80]="",doc[16384]="";
  int qualified=hf_connector_resume_qualified(connector,qualification,sizeof qualification);
  int saved_present=get(fs,n,"saved_native_session_id",saved,sizeof saved)&&safe_id(saved);
  int cp_present=get(fs,n,"checkpoint_reference",checkpoint,sizeof checkpoint)&&digest(checkpoint)&&
   get(fs,n,"checkpoint_source_manifest_digest",cs,sizeof cs)&&digest(cs)&&
   get(fs,n,"checkpoint_configuration_digest",cc,sizeof cc)&&digest(cc);
  if(!cp_present)checkpoint[0]=0;
  int compatible=saved_present&&cp_present&&!strcmp(saved,native)&&!strcmp(cs,source)&&!strcmp(cc,configuration);
  if(compatible&&qualified){decision="RESUME_EXACT_SAVED";reason="QUALIFIED_CONTEXT_CANDIDATE";}
  else if(get(fs,n,"new_agent_session_id",fresh,sizeof fresh)&&safe_id(fresh)&&strcmp(fresh,native)&&
          get(fs,n,"handoff_digest",handoff,sizeof handoff)&&digest(handoff)){
   const char *unbound=!get(fs,n,"handoff_document",doc,sizeof doc)?"HANDOFF_DOCUMENT_ABSENT":
    handoff_bound(doc,handoff,connector,native,fresh,source,configuration,checkpoint,context,sizeof context);
   lost=1;
   if(unbound){decision="BLOCKED_CONTEXT";reason=unbound;}
   else{decision="FRESH_HANDOFF";reason=compatible?"NATIVE_RESUME_UNQUALIFIED":saved_present||cp_present?"CHECKPOINT_MISMATCH":"SAVED_CONTEXT_UNAVAILABLE";strcpy(new_agent,fresh);strcpy(handoff_ref,handoff);}
  }else{decision="BLOCKED_CONTEXT";reason=compatible?"NATIVE_RESUME_UNQUALIFIED":"SAVED_CONTEXT_UNAVAILABLE";lost=1;}
 }
 fputs("{\"decision\":",out);quoted(out,decision);fputs(",\"reason\":",out);quoted(out,reason);fputs(",\"native_session_id\":",out);if(new_agent[0])fputs("null",out);else quoted(out,native);
 fputs(",\"new_agent_session_id\":",out);opt(out,new_agent);
 fputs(",\"handoff_digest\":",out);opt(out,handoff_ref);
 fputs(",\"native_qualification_digest\":",out);opt(out,qualification);
 fprintf(out,",\"process_observation\":{\"state\":\"%s\",\"pid\":%llu,\"kernel_boot_id\":",ob.state,pid);opt(out,ob.kernel_boot);
 if(ob.have)fprintf(out,",\"observed_start_time\":\"%llu\",\"observed_state\":\"%c\"}",ob.seen.start_time,ob.seen.state);else fputs(",\"observed_start_time\":null,\"observed_state\":null}",out);
 fprintf(out,",\"protocol_pipe\":{\"state\":\"%s\",\"pending_bytes\":%d}",pipe_state,pending);
 fputs(",\"provenance\":",out);
 if(new_agent[0]){fputs("{\"prior_native_session_id\":",out);quoted(out,native);fputs(",\"new_agent_session_id\":",out);quoted(out,new_agent);
  fputs(",\"handoff_digest\":",out);quoted(out,handoff_ref);fputs(",\"context_digest\":",out);quoted(out,context);fputs(",\"checkpoint_reference\":",out);opt(out,checkpoint);
  fputs(",\"source_manifest_digest\":",out);quoted(out,source);fputs(",\"configuration_digest\":",out);quoted(out,configuration);fputs(",\"recovery_reason\":",out);quoted(out,reason);
  fputs(",\"session_persisted\":false}",out);}
 else fputs("null",out);
 fprintf(out,",\"context_lost\":%s,\"context_restored\":false,\"replay_pending_input\":false,\"grants_authority\":false}",lost?"true":"false");return 0;
}
