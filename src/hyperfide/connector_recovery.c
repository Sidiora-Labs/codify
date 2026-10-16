/* Native connector boundary. The supervisor owns persistent pipes and process lifetime.
 * CLI presence is measured here; inference/resume capability needs a separate live receipt. */
#define _GNU_SOURCE
#include "components.h"
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
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
extern int hf_connector_resume_qualified(const char *,char *,size_t);
int hf_component_13_3(const char *action,const char *json,FILE *out){
 if(strcmp(action,"connector.recover"))return error(out,"CONNECTOR_UNSUPPORTED");
 Field fs[24];int n=fields(json,fs,24,"|connector||native_session_id||source_manifest_digest||configuration_digest||auth_state||transport_state||process_state||process_boot_id||observed_boot_id||process_start_time||observed_process_start_time||saved_native_session_id||checkpoint_source_manifest_digest||checkpoint_configuration_digest||checkpoint_reference||new_agent_session_id||handoff_digest||protocol_delivery|");
 char connector[16],native[256],source[80],configuration[80],auth[32],transport[32],process[32],boot[129],observed_boot[129],start[32],observed_start[32],delivery[32];
 if(n<12||!get(fs,n,"connector",connector,sizeof connector)||(strcmp(connector,"codex")&&strcmp(connector,"claude"))||
 !get(fs,n,"native_session_id",native,sizeof native)||!safe_id(native)||
 !get(fs,n,"source_manifest_digest",source,sizeof source)||!digest(source)||
 !get(fs,n,"configuration_digest",configuration,sizeof configuration)||!digest(configuration)||
 !get(fs,n,"auth_state",auth,sizeof auth)||(strcmp(auth,"VALID")&&strcmp(auth,"EXPIRED")&&strcmp(auth,"REVOKED")&&strcmp(auth,"UNKNOWN"))||
 !get(fs,n,"transport_state",transport,sizeof transport)||(strcmp(transport,"CONNECTED")&&strcmp(transport,"LOST"))||
 !get(fs,n,"process_state",process,sizeof process)||(strcmp(process,"ALIVE_VERIFIED")&&strcmp(process,"EXITED_VERIFIED")&&strcmp(process,"UNKNOWN"))||
 !get(fs,n,"process_boot_id",boot,sizeof boot)||!safe_id(boot)||!get(fs,n,"observed_boot_id",observed_boot,sizeof observed_boot)||!safe_id(observed_boot)||
 !get(fs,n,"process_start_time",start,sizeof start)||!safe_id(start)||!get(fs,n,"observed_process_start_time",observed_start,sizeof observed_start)||!safe_id(observed_start)||
 !get(fs,n,"protocol_delivery",delivery,sizeof delivery)||(strcmp(delivery,"ACKNOWLEDGED")&&strcmp(delivery,"PARTIAL")&&strcmp(delivery,"UNKNOWN")))return error(out,"RECOVERY_INVALID");
 const char *decision="RECONCILE",*reason="PROCESS_OUTCOME_UNKNOWN";int lost=0;char new_agent[256]="",handoff_ref[80]="",qualification[80]="";
 if(strcmp(auth,"VALID")){decision="BLOCKED_AUTH";reason=auth;}
 else if(!strcmp(process,"ALIVE_VERIFIED")){
  if(strcmp(boot,observed_boot)||strcmp(start,observed_start)){decision="RECONCILE";reason="PROCESS_IDENTITY_MISMATCH";}
  else if(strcmp(delivery,"ACKNOWLEDGED")){decision="REHANDSHAKE_EXISTING";reason="PROTOCOL_DELIVERY_UNCERTAIN";}
  else{decision=!strcmp(transport,"LOST")?"RECONNECT_EXISTING":"CONTINUE_EXISTING";reason="EXACT_PROCESS_OBSERVED";}
 }else if(!strcmp(process,"EXITED_VERIFIED")){
  char saved[256]="",cs[80]="",cc[80]="",checkpoint[80]="",fresh[256]="",handoff[80]="";
  int qualified=hf_connector_resume_qualified(connector,qualification,sizeof qualification);
  int saved_present=get(fs,n,"saved_native_session_id",saved,sizeof saved)&&safe_id(saved);
  int cp_present=get(fs,n,"checkpoint_reference",checkpoint,sizeof checkpoint)&&digest(checkpoint)&&
   get(fs,n,"checkpoint_source_manifest_digest",cs,sizeof cs)&&digest(cs)&&
   get(fs,n,"checkpoint_configuration_digest",cc,sizeof cc)&&digest(cc);
  int compatible=saved_present&&cp_present&&!strcmp(saved,native)&&!strcmp(cs,source)&&!strcmp(cc,configuration);
  if(compatible&&qualified){decision="RESUME_EXACT_SAVED";reason="QUALIFIED_CONTEXT_CANDIDATE";}
  else if(get(fs,n,"new_agent_session_id",fresh,sizeof fresh)&&safe_id(fresh)&&strcmp(fresh,native)&&
          get(fs,n,"handoff_digest",handoff,sizeof handoff)&&digest(handoff)){
   decision="FRESH_HANDOFF";reason=compatible?"NATIVE_RESUME_UNQUALIFIED":saved_present||cp_present?"CHECKPOINT_MISMATCH":"SAVED_CONTEXT_UNAVAILABLE";lost=1;strcpy(new_agent,fresh);strcpy(handoff_ref,handoff);
  }else{decision="BLOCKED_CONTEXT";reason=compatible?"NATIVE_RESUME_UNQUALIFIED":"SAVED_CONTEXT_UNAVAILABLE";lost=1;}
 }
 fputs("{\"decision\":",out);quoted(out,decision);fputs(",\"reason\":",out);quoted(out,reason);fputs(",\"native_session_id\":",out);if(new_agent[0])fputs("null",out);else quoted(out,native);
 fputs(",\"new_agent_session_id\":",out);if(new_agent[0])quoted(out,new_agent);else fputs("null",out);
 fputs(",\"handoff_digest\":",out);if(handoff_ref[0])quoted(out,handoff_ref);else fputs("null",out);
 fputs(",\"native_qualification_digest\":",out);if(qualification[0])quoted(out,qualification);else fputs("null",out);
 fprintf(out,",\"context_lost\":%s,\"context_restored\":false,\"replay_pending_input\":false,\"grants_authority\":false}",lost?"true":"false");return 0;
}
