/* Authority selection precedes any legacy SQLite open, indexing or journal replay.
 * Descriptor and environment are operator configuration, never request fields.
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include <ctype.h>
#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <fcntl.h>

enum { HF_LOCAL=0, HF_DISTRIBUTED=1, HF_OFFLINE=2, HF_OFFLINE_LOCAL=3, HF_MODE_INVALID=-1 };
static const char *hf_ws25(const char *p){while(*p&&isspace((unsigned char)*p))p++;return p;}
static int hf_string25(const char **cursor,char *out,size_t cap){
 const char *p=hf_ws25(*cursor);size_t n=0;if(*p++!='"')return 0;
 while(*p&&*p!='"'){unsigned char c=(unsigned char)*p++;if(c<32||c>=127||c=='\\'||n+1>=cap)return 0;out[n++]=(char)c;}
 if(*p++!='"')return 0;
 out[n]=0;*cursor=p;return 1;
}
static int hf_uuid25(const char *s){
 if(strlen(s)!=36)return 0;
 for(size_t i=0;i<36;i++){if(i==8||i==13||i==18||i==23){if(s[i]!='-')return 0;}else if(!strchr("0123456789abcdef",s[i]))return 0;}return 1;
}
static int hf_descriptor25(const char *filename,int *distributed){
 struct stat st;if(lstat(filename,&st)!=0)return errno==ENOENT?0:-1;
 if(!S_ISREG(st.st_mode)||S_ISLNK(st.st_mode)||st.st_uid!=geteuid()||(st.st_mode&0077)||st.st_size<2||st.st_size>4096)return -1;
 int fd=open(filename,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);if(fd<0)return -1;struct stat actual;if(fstat(fd,&actual)||actual.st_dev!=st.st_dev||actual.st_ino!=st.st_ino||actual.st_size!=st.st_size){close(fd);return -1;}
 FILE *f=fdopen(fd,"rb");if(!f){close(fd);return -1;}char data[4097];size_t n=fread(data,1,sizeof(data)-1,f);int ok=!ferror(f);fclose(f);if(!ok||n!=(size_t)st.st_size||memchr(data,0,n))return -1;data[n]=0;
 const char *p=hf_ws25(data);if(*p++!='{')return -1;unsigned seen=0;char mode[64]="";
 for(;;){char key[64],value[128];p=hf_ws25(p);if(*p=='}'){p++;break;}if(!hf_string25(&p,key,sizeof key))return -1;p=hf_ws25(p);if(*p++!=':')return -1;p=hf_ws25(p);
 if(!strcmp(key,"schema_version")){if(seen&1||*p++!='1'||isdigit((unsigned char)*p))return -1;seen|=1;}
 else if(!strcmp(key,"mode")){if(seen&2||!hf_string25(&p,mode,sizeof mode))return -1;seen|=2;}
 else if(!strcmp(key,"authority_epoch")){if(seen&4||!hf_string25(&p,value,sizeof value)||!hf_uuid25(value))return -1;seen|=4;}
 else return -1;
 p=hf_ws25(p);if(*p==','){p++;if(*hf_ws25(p)=='}')return -1;continue;}if(*p=='}'){p++;break;}return -1;}
 if(*hf_ws25(p)||seen!=7||strcmp(mode,"distributed"))return -1;
 *distributed=1;return 1;
}
static int hf_mode_at25(const char *selected_root){
 int distributed=0;const char *descriptor=getenv("HYPERFIDE_AUTHORITY_DESCRIPTOR");
 if(descriptor&&descriptor[0]){
 if(descriptor[0]!='/')return HF_MODE_INVALID;
 if(hf_descriptor25(descriptor,&distributed)!=1)return HF_MODE_INVALID;
 }else{
 char directory[PATH_MAX];if(selected_root){if(!realpath(selected_root,directory))return HF_MODE_INVALID;}else if(!getcwd(directory,sizeof directory))return HF_MODE_INVALID;
 for(;;){char candidate[PATH_MAX];int n=snprintf(candidate,sizeof candidate,"%s/.hyperfide/authority.json",directory);if(n<0||(size_t)n>=sizeof candidate)return HF_MODE_INVALID;
 int found=hf_descriptor25(candidate,&distributed);if(found<0)return HF_MODE_INVALID;if(found)break;char *slash=strrchr(directory,'/');if(!slash||slash==directory)break;*slash=0;}
 }
 const char *mode=getenv("HYPERFIDE_MODE");
 if(!mode||!mode[0])return distributed?HF_DISTRIBUTED:HF_LOCAL;
 if(!strcmp(mode,"distributed"))return distributed?HF_DISTRIBUTED:HF_MODE_INVALID;
 if(!strcmp(mode,"offline"))return distributed?HF_OFFLINE:HF_OFFLINE_LOCAL;
 if(!strcmp(mode,"local"))return distributed?HF_MODE_INVALID:HF_LOCAL;
 return HF_MODE_INVALID;
}
int hf_client_authority_mode(void){return hf_mode_at25(NULL);}
int hf_client_authority_guard_at(const char *operation,const char *selected_root,FILE *output){
 (void)operation;
 int mode=hf_mode_at25(selected_root);
 if(mode==HF_LOCAL||mode==HF_OFFLINE_LOCAL)return 0;
 /* Offline mode without a distributed descriptor is explicitly local; it
  * cannot grant remote authority. With a descriptor no legacy DB is opened. */

 const char *code=mode==HF_MODE_INVALID?"AUTHORITY_MODE_INVALID":mode==HF_OFFLINE?"OFFLINE_AUTHORITY_UNAVAILABLE":"DISTRIBUTED_TRANSPORT_REQUIRED";
 if(output)fprintf(output,"{\"ok\":false,\"error\":{\"code\":\"%s\",\"message\":\"Legacy local operation is unavailable in this authority mode; use the authenticated authority interface\"},\"operation\":\"%s\",\"local_fallback\":false}\n",code,"legacy");
 return 78;
}
int hf_client_authority_guard(const char *operation,FILE *output){return hf_client_authority_guard_at(operation,NULL,output);}
int hf_client_authority_guard_args(const char *operation,int argc,char **argv,FILE *output){
 int result=hf_client_authority_guard(operation,output);if(result)return result;
 for(int i=0;i+1<argc;i++)if(!strcmp(argv[i],"--root")){result=hf_client_authority_guard_at(operation,argv[i+1],output);if(result)return result;}
 return 0;
}
int hf_component_25_3(const char *action,const char *request_json,FILE *output){
 if(strcmp(action,"authority.mode")||strcmp(hf_ws25(request_json),"{}")){fputs("{\"ok\":false,\"error\":{\"code\":\"INVALID_REQUEST\"}}\n",output);return 1;}
 int mode=hf_client_authority_mode();if(mode<0){fputs("{\"ok\":false,\"error\":{\"code\":\"AUTHORITY_MODE_INVALID\"}}\n",output);return 1;}
 fprintf(output,"{\"ok\":true,\"mode\":\"%s\",\"remote_ownership\":false,\"local_fallback\":false,\"transport_status\":\"REQUIRES_AUTHENTICATED_TRANSPORT\"}\n",mode==HF_LOCAL?"local":(mode==HF_OFFLINE||mode==HF_OFFLINE_LOCAL)?"offline":"distributed");return 0;
}

/* Authenticated network dispatch. A handled response, including an unknown
 * outcome, never falls through to the local SQLite implementation. */
#include "transport.h"
#define HF_CLIENT_BYTES25 (768U*1024U)
static int hf_json25(const char *data,size_t length,int response,const char *operation){
 if(!data||length>(response?HF_BODY_LIMIT:HF_CLIENT_BYTES25)||memchr(data,0,length))return 0;
 HfJson *json=malloc(sizeof *json);if(!json)return 0;
 if(!hf_json_parse(json,data)||json->length!=length){free(json);return 0;}
 if(!response){free(json);return 1;}
 int64_t version=0;int ok=0;
 if(!hf_json_i64(json,hf_json_field(json,0,"protocol_version"),&version)||version!=1||!hf_json_bool(json,hf_json_field(json,0,"ok"),&ok)){free(json);return 0;}
 if(operation){
 char actual[64],id[64];
 if(!hf_json_get(json,"operation_id",actual,sizeof actual)||strcmp(actual,operation)||!hf_json_get(json,"id",id,sizeof id)||strcmp(id,operation)){free(json);return 0;}
 }
 free(json);return ok?2:1;
}
static int hf_client_error25(FILE *err,const char *code,const char *message){
 fprintf(err,"{\"ok\":false,\"error\":{\"code\":\"%s\",\"message\":\"%s\"},\"local_fallback\":false}\n",code,message);return 78;
}
static char *hf_read25(const char *filename,size_t *length){
 int fd=!strcmp(filename,"-")?dup(STDIN_FILENO):open(filename,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);if(fd<0)return NULL;
 if(strcmp(filename,"-")){struct stat st;if(fstat(fd,&st)||!S_ISREG(st.st_mode)||st.st_size<0||(uint64_t)st.st_size>HF_CLIENT_BYTES25){close(fd);return NULL;}}
 char *bytes=malloc(HF_CLIENT_BYTES25+1);if(!bytes){close(fd);return NULL;}size_t n=0;
 for(;;){ssize_t r=read(fd,bytes+n,HF_CLIENT_BYTES25+1-n);if(r<0&&errno==EINTR)continue;if(r<0){free(bytes);close(fd);return NULL;}if(!r)break;n+=(size_t)r;if(n>HF_CLIENT_BYTES25){free(bytes);close(fd);return NULL;}}
 close(fd);bytes[n]=0;*length=n;return bytes;
}
static int hf_invoke25(const char *payload,const char *operation,const char *idempotency,const char *correlation,const char *causation,FILE *out,FILE *err){
 const char *configuration=getenv("HYPERFIDE_TRANSPORT_CONFIG");if(!configuration||!configuration[0])return hf_client_error25(err,"TRANSPORT_CONFIG_REQUIRED","Trusted transport configuration is required");
 HfTransportConfig config;if(!hf_transport_config(configuration,&config))return hf_client_error25(err,"TRANSPORT_CONFIG_INVALID","Trusted transport configuration is invalid");
 const char *origin=getenv("HYPERFIDE_AUTHORITY_URL");if(origin&&strcmp(origin,config.origin))return hf_client_error25(err,"AUTHORITY_ORIGIN_CONFLICT","Authority origin conflicts with signed transport configuration");
 if(!hf_uuid25(operation)||!hf_uuid25(idempotency)||!hf_uuid25(correlation)||(causation&&!hf_uuid25(causation)))return hf_client_error25(err,"OPERATION_ID_INVALID","Explicit canonical operation idempotency and correlation UUIDs are required");
 if(!hf_json25(payload,strlen(payload),0,NULL))return hf_client_error25(err,"INVALID_JSON","A bounded protocol1 JSON object is required");
 char *body=hf_envelope(payload,operation,idempotency,correlation,causation);if(!body)return hf_client_error25(err,"INVALID_REQUEST","Could not encode the immutable authority operation");
 HfHttpResponse response={0};int completed=hf_transport_post(&config,0,body,NULL,NULL,&response);free(body);
 if(!completed){
 int uncertain=response.uncertain;hf_http_response_free(&response);
 if(uncertain){fprintf(err,"{\"ok\":false,\"error\":{\"code\":\"AUTHORITY_OUTCOME_UNKNOWN\",\"message\":\"Request may have been accepted; reconcile the same operation before retry\"},\"operation_id\":\"%s\",\"idempotency_key\":\"%s\",\"automatic_replay\":false,\"local_fallback\":false}\n",operation,idempotency);return 75;}
 return hf_client_error25(err,"AUTHORITY_TRANSPORT_FAILED","Verified authority exchange failed before a confirmed response");
 }
 int parsed=hf_json25(response.body,response.length,1,response.status>=200&&response.status<300?operation:NULL);
 if(!parsed||(parsed==2&&(response.status<200||response.status>=300))){hf_http_response_free(&response);return hf_client_error25(err,"AUTHORITY_PROTOCOL_INVALID","Authority returned an invalid protocol1 response");}
 fwrite(response.body,1,response.length,out);fputc('\n',out);
 int success=response.status>=200&&response.status<300&&parsed==2;hf_http_response_free(&response);return success?0:1;
}
typedef struct {const char *command,*subcommand,*component,*action;} HfRoute25;
static const HfRoute25 hf_routes25[]={
 {"spec","status","spec-import","spec.inspect"},
 {"spec","frontier","spec-dependencies","spec.next"},
 {"spec","resolve","spec-dependencies","spec.task.resolve"},
 {"submission","submit","16.1","submission.submit"},
 {"submission","inspect","16.1","submission.inspect"},
 {"submission","revoke","16.1","submission.revoke"},
 {"qualification","inspect","16.3","qualification.coverage.inspect"},
 {"assurance","inspect","16.4","assurance.validity.inspect"},
 {"graph","status","7.4","graph.query.status"},
 {"graph","search","7.4","graph.query.search"},
 {"graph","context","7.4","graph.query.context"},
 {"graph","traverse","7.4","graph.query.traverse"},
 {"fleet","status","23.1","fleet.views.snapshot"},
 {"fleet","entities","23.1","fleet.views.entities"},
 {"fleet","resources","23.2","fleet.resources.snapshot"},
 {"hierarchy","inspect","3.1","hierarchy.inspect"},
 {"hierarchy","view","3.3","hierarchy.view"},
 {"hierarchy","acquire","3.1","hierarchy.leader.acquire"},
 {"hierarchy","configure","3.1","hierarchy.package.configure"},
 {"hierarchy","assign","3.1","hierarchy.package.assign"},
 {"human","submit" ,"1.2","human.submit"},
 {"human","escalate","1.2","human.escalate"},
 {"human","autonomous","1.2","human.autonomous"},
 {"human","status","1.2","human.status"},
 {NULL,NULL,NULL,NULL}
};
int hf_client_dispatch(int argc,char **argv,FILE *out,FILE *err){
 if(argc<2)return -1;
 int authority=!strcmp(argv[1],"authority");
 if(authority&&argc==3&&!strcmp(argv[2],"mode")){
 int mode=hf_client_authority_mode();if(mode<0)return hf_client_error25(err,"AUTHORITY_MODE_INVALID","Authority configuration is invalid");
 fprintf(out,"{\"ok\":true,\"mode\":\"%s\",\"local_fallback\":false}\n",mode==HF_LOCAL?"local":mode==HF_DISTRIBUTED?"distributed":"offline");return 0;
 }
 int mode=hf_client_authority_mode();if(mode<0)return hf_client_error25(err,"AUTHORITY_MODE_INVALID","Authority configuration is invalid");
 if(!authority&&(mode==HF_LOCAL||mode==HF_OFFLINE_LOCAL)){int guard=hf_client_authority_guard_args("cli",argc,argv,err);return guard?guard:-1;}
 if(mode==HF_OFFLINE||mode==HF_OFFLINE_LOCAL)return hf_client_error25(err,"OFFLINE_AUTHORITY_UNAVAILABLE","Remote authority is unavailable while offline");
 const HfRoute25 *route=NULL;
 if(!authority){for(const HfRoute25 *r=hf_routes25;r->command;r++)if(argc>2&&!strcmp(argv[1],r->command)&&!strcmp(argv[2],r->subcommand)){route=r;break;}if(!route)return hf_client_error25(err,"DISTRIBUTED_COMMAND_UNSUPPORTED","This legacy command has no qualified distributed mapping");}
 else if(argc<3||strcmp(argv[2],"invoke"))return hf_client_error25(err,"INVALID_ARGS","Use authority mode or authority invoke with explicit operation identities");
 const char *input=NULL,*run=NULL,*operation=NULL,*idempotency=NULL,*correlation=NULL,*causation=NULL,*expected=NULL,*authority_file=NULL;
 for(int i=3;i<argc;i+=2){
 if(i+1>=argc)return hf_client_error25(err,"INVALID_ARGS","Options require values");
 const char *key=argv[i],*value=argv[i+1];const char **slot=NULL;
 if(!strcmp(key,authority?"--payload-file":"--input-file"))slot=&input;
 else if(!strcmp(key,"--run-id"))slot=&run;
 else if(!strcmp(key,"--operation-id"))slot=&operation;
 else if(!strcmp(key,"--idempotency-key"))slot=&idempotency;
 else if(!strcmp(key,"--correlation-id"))slot=&correlation;
 else if(!strcmp(key,"--causation-id"))slot=&causation;
 else if(!strcmp(key,"--expected-version"))slot=&expected;
 else if(!strcmp(key,"--authority-file"))slot=&authority_file;
 else return hf_client_error25(err,"INVALID_ARGS","Unsupported or legacy distributed option");
 if(*slot)return hf_client_error25(err,"INVALID_ARGS","Duplicate distributed option");
 *slot=value;
 }
 if(!operation||!idempotency||!correlation||(!authority&&(!run||!hf_uuid25(run))))return hf_client_error25(err,"OPERATION_ID_REQUIRED","Explicit run and stable operation idempotency correlation identities are required");
 size_t length=0;char *data=NULL;
 if(input)data=hf_read25(input,&length);
 else if(route&&!strcmp(route->action,"spec.inspect")){data=malloc(64);if(data)snprintf(data,64,"{\"run_id\":\"%s\"}",run);}
 if(!data)return hf_client_error25(err,"INPUT_REQUIRED","A bounded regular JSON input file or stdin dash is required");
 if(!hf_json25(data,strlen(data),0,NULL)){free(data);return hf_client_error25(err,"INVALID_JSON","Input must be a bounded JSON object");}
 char *payload=data,*proof=NULL;
 if(!authority){
 if(expected){if(!*expected||(*expected=='0'&&expected[1])||strlen(expected)>19){free(data);return hf_client_error25(err,"INVALID_VERSION","Expected state version must be canonical decimal");}for(const char *p=expected;*p;p++)if(!isdigit((unsigned char)*p)){free(data);return hf_client_error25(err,"INVALID_VERSION","Expected state version must be canonical decimal");}}
 if(authority_file){size_t n=0;proof=hf_read25(authority_file,&n);if(!proof||!hf_json25(proof,n,0,NULL)){free(proof);free(data);return hf_client_error25(err,"INVALID_AUTHORITY","Authority metadata must be a bounded JSON object");}}
 size_t size=strlen(data)+(proof?strlen(proof):4)+1024;payload=malloc(size);if(!payload){free(proof);free(data);return hf_client_error25(err,"RESOURCE_LIMIT","Could not encode authority request");}
 char version[32]="null";if(expected)snprintf(version,sizeof version,"\"%s\"",expected);
 snprintf(payload,size,"{\"run_id\":\"%s\",\"component\":\"%s\",\"action\":\"%s\",\"input\":%s,\"expected_version\":%s,\"authority\":%s}",run,route->component,route->action,data,version,proof?proof:"null");
 }
 int result=hf_invoke25(payload,operation,idempotency,correlation,causation,out,err);
 if(payload!=data)free(payload);
 free(data);free(proof);return result;
}
