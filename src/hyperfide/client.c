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
#include "transport.h"

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
 char *protected=NULL;size_t n=0;if(!hf_protected_read(filename,4096,&protected,&n)||n<2){free(protected);return -1;}
 char data[4097];memcpy(data,protected,n+1);free(protected);
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
 int result=hf_json_field(json,0,"result");char outcome[32];
 int unknown=ok&&result>=0&&hf_json_string(json,hf_json_field(json,result,"outcome"),outcome,sizeof outcome)&&!strcmp(outcome,"UNKNOWN");
 free(json);return unknown?3:ok?2:1;
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
static int hf_load_transport25(HfTransportConfig *config,FILE *err){
 const char *configuration=getenv("HYPERFIDE_TRANSPORT_CONFIG");if(!configuration||!configuration[0])return hf_client_error25(err,"TRANSPORT_CONFIG_REQUIRED","Trusted target transport configuration is required");
 struct stat info;if(lstat(configuration,&info)!=0&&errno==ENOENT)return hf_client_error25(err,"TRANSPORT_CONFIG_REQUIRED","Target transport credential has not been attached");
 if(!hf_transport_config(configuration,config))return hf_client_error25(err,"TRANSPORT_CONFIG_INVALID","Trusted transport configuration is invalid");
 return 0;
}
static int hf_invoke_config25(const HfTransportConfig *supplied,const char *payload,const char *operation,const char *idempotency,const char *correlation,const char *causation,FILE *out,FILE *err){
 HfTransportConfig config;
 if(supplied)config=*supplied;else{int result=hf_load_transport25(&config,err);if(result)return result;}
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
 if(!parsed||(parsed>=2&&(response.status<200||response.status>=300))){hf_http_response_free(&response);return hf_client_error25(err,"AUTHORITY_PROTOCOL_INVALID","Authority returned an invalid protocol1 response");}
 fwrite(response.body,1,response.length,out);fputc('\n',out);
 int success=response.status>=200&&response.status<300&&parsed==2;hf_http_response_free(&response);
 if(parsed==3){fprintf(err,"{\"ok\":false,\"error\":{\"code\":\"AUTHORITY_OUTCOME_UNKNOWN\",\"message\":\"Authority explicitly reported UNKNOWN; reconcile the same operation before retry\"},\"operation_id\":\"%s\",\"idempotency_key\":\"%s\",\"automatic_replay\":false,\"local_fallback\":false}\n",operation,idempotency);return 75;}
 return success?0:1;
}
static int hf_invoke25(const char *payload,const char *operation,const char *idempotency,const char *correlation,const char *causation,FILE *out,FILE *err){
 return hf_invoke_config25(NULL,payload,operation,idempotency,correlation,causation,out,err);
}
typedef struct {const char *command,*subcommand,*component,*action;} HfRoute25;
static const HfRoute25 hf_routes25[]={
 {"spec","status","spec-import","spec.inspect"},
 {"spec","frontier","spec-dependencies","spec.next"},
 {"spec","resolve","spec-dependencies","spec.task.resolve"},
 {"task","claim","5.1","scheduler.claim"},
 {"task","dispatch","5.3","scheduler.dispatch.ensure"},
 {"task","renew","5.2","scheduler.lease.renew"},
 {"task","cancel","5.2","scheduler.compute.cancel"},
 {"task","eligible","5.4","scheduler.resources.eligible"},
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
 {"docs","packet","28.2","docs.packet"},
 {"docs","inspect","28.2","docs.inspect"},
 {"docs","check","28.2","docs.check"},
 {"docs","close","28.2","docs.close"},
 {"supervisor","describe","13.4.supervision","supervisor.session.describe"},
 {"supervisor","launch","13.4.supervision","supervisor.session.launch"},
 {"supervisor","inspect","13.4.supervision","supervisor.session.inspect"},
 {"supervisor","input","13.4.supervision","supervisor.session.input"},
 {"supervisor","stop","13.4.supervision","supervisor.session.stop"},
 {"work","open","25.3-workflow","work.open"},
 {"work","update","25.3-workflow","work.update"},
 {"work","handoff","25.3-workflow","work.handoff"},
 {"work","projection","25.3-workflow","work.projection"},
 {"hierarchy","describe","3.1","hierarchy.describe"},
 {"hierarchy","inspect","3.1","hierarchy.inspect"},
 {"hierarchy","view","3.3","hierarchy.view"},
 {"hierarchy","acquire","3.1","hierarchy.leader.acquire"},
 {"hierarchy","configure","3.1","hierarchy.package.configure"},
 {"hierarchy","assign","3.1","hierarchy.package.assign"},
 {"human","describe","1.2","human.describe"},
 {"human","submit" ,"1.2","human.submit"},
 {"human","escalate","1.2","human.escalate"},
 {"human","autonomous","1.2","human.autonomous"},
 {"human","status","1.2","human.status"},
 {NULL,NULL,NULL,NULL}
};
static int hf_client_mcp25(FILE *out,FILE *err);
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
 if(!authority&&!strcmp(argv[1],"mcp")){if(argc!=2)return hf_client_error25(err,"INVALID_ARGS","Distributed MCP accepts no legacy options");return hf_client_mcp25(out,err);}
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

typedef struct {int restricted,bootstrap,bound;size_t count;char names[128][128],target[37],run[37],role[33];} HfMcpPolicy25;
static int hf_mcp_allowed25(const HfMcpPolicy25 *policy,const char *name){
 if(!policy->restricted)return 1;
 for(size_t i=0;i<policy->count;i++)if(!strcmp(policy->names[i],name))return 1;
 return 0;
}
static int hf_mcp_known25(const char *name){
 if(!strcmp(name,"authority_invoke"))return 1;
 for(const HfRoute25 *r=hf_routes25;r->command;r++){char candidate[128];snprintf(candidate,sizeof candidate,"%s_%s",r->command,r->subcommand);if(!strcmp(candidate,name))return 1;}
 return 0;
}
static int hf_mcp_policy25(HfMcpPolicy25 *policy){
 memset(policy,0,sizeof *policy);
 const char *filename=getenv("HYPERFIDE_MCP_TOOL_POLICY_FILE");if(!filename)return 1;
 char *text=NULL;size_t length=0;HfJson *j=malloc(sizeof *j);if(!j)return 0;
 int valid=filename[0]=='/'&&hf_protected_read(filename,32768,&text,&length)&&hf_json_parse(j,text);
 const char *const allowed[]={"schema_version","allowed_tools","bootstrap_catalog","target_session_id","run_id","target_role"};int64_t version=0;
 if(valid)valid=hf_json_only(j,0,allowed,6)&&hf_json_i64(j,hf_json_field(j,0,"schema_version"),&version)&&version==1;
 unsigned seen=0;
 if(valid)for(int key=1;key<j->tokens[0].next;key=j->tokens[key+1].next){
 char name[64];if(!hf_json_string(j,key,name,sizeof name)){valid=0;break;}
 unsigned bit=!strcmp(name,"schema_version")?1:!strcmp(name,"allowed_tools")?2:!strcmp(name,"bootstrap_catalog")?4:!strcmp(name,"target_session_id")?8:!strcmp(name,"run_id")?16:32;
 if(seen&bit){valid=0;break;}seen|=bit;
 }
 int array=valid?hf_json_field(j,0,"allowed_tools"):-1;
 if(valid)valid=array>=0&&j->tokens[array].type=='[';
 if(valid)for(int token=array+1;token<j->tokens[array].next;token=j->tokens[token].next){
 if(policy->count>=128||!hf_json_string(j,token,policy->names[policy->count],128)||!hf_mcp_known25(policy->names[policy->count])){valid=0;break;}
 for(size_t i=0;i<policy->count;i++)if(!strcmp(policy->names[i],policy->names[policy->count]))valid=0;
 if(!valid)break;
 policy->count++;
 }
 int bootstrap=valid?hf_json_field(j,0,"bootstrap_catalog"):-1;
 if(valid&&bootstrap>=0)valid=hf_json_bool(j,bootstrap,&policy->bootstrap);
 policy->restricted=1;
 if(valid&&(seen&56)){
 policy->bound=1;
 valid=(seen&56)==56&&hf_json_get(j,"target_session_id",policy->target,sizeof policy->target)&&hf_uuid25(policy->target)&&hf_json_get(j,"run_id",policy->run,sizeof policy->run)&&hf_uuid25(policy->run)&&hf_json_get(j,"target_role",policy->role,sizeof policy->role)&&policy->role[0];
 if(valid)for(const char *q=policy->role;*q;q++)if(!(*q>='A'&&*q<='Z')&&*q!='_')valid=0;
 }
 if(valid&&policy->bootstrap&&(!policy->bound||hf_mcp_allowed25(policy,"authority_invoke")))valid=0;
 free(text);free(j);return valid;
}
static int hf_mcp_subject25(const HfMcpPolicy25 *policy,HfTransportConfig *config,FILE *err){
 if(!policy->bound)return 0;
 int loaded=hf_load_transport25(config,err);if(loaded)return loaded;
 char operation[37],idempotency[37],correlation[37],payload[512];
 if(!hf_uuid_generate(operation)||!hf_uuid_generate(idempotency)||!hf_uuid_generate(correlation))return hf_client_error25(err,"RESOURCE_LIMIT","Cannot allocate subject verification identity");
 snprintf(payload,sizeof payload,"{\"run_id\":\"%s\",\"component\":\"14.1\",\"action\":\"identity.describe\",\"input\":{},\"expected_version\":null,\"authority\":null}",policy->run);
 char *body=NULL;size_t length=0;FILE *capture=open_memstream(&body,&length);if(!capture)return hf_client_error25(err,"RESOURCE_LIMIT","Cannot allocate subject verification response");
 int result=hf_invoke_config25(config,payload,operation,idempotency,correlation,NULL,capture,err);fclose(capture);
 if(result){if(length)fwrite(body,1,length,err);free(body);return result;}
 HfJson *j=malloc(sizeof *j);char actor[37],run[37],role[33],credential[37];int valid=j&&hf_json_parse(j,body);
 if(valid){int principal=hf_json_field(j,hf_json_field(j,0,"result"),"principal");
 valid=hf_json_string(j,hf_json_field(j,principal,"actor_id"),actor,sizeof actor)&&!strcmp(actor,policy->target)&&hf_json_string(j,hf_json_field(j,principal,"run_id"),run,sizeof run)&&!strcmp(run,policy->run)&&hf_json_string(j,hf_json_field(j,principal,"role"),role,sizeof role)&&!strcmp(role,policy->role)&&hf_json_string(j,hf_json_field(j,principal,"credential_id"),credential,sizeof credential)&&!strcmp(credential,config->credential_id);}
 free(j);free(body);
 if(!valid)return hf_client_error25(err,"AUTHORITY_SUBJECT_MISMATCH","Attached credential does not match trusted supervisor session run and role");
 return 0;
}
static void hf_rpc_error25(FILE *out,const char *id,int code,const char *message){
 fprintf(out,"{\"jsonrpc\":\"2.0\",\"id\":%s,\"error\":{\"code\":%d,\"message\":",id?id:"null",code);
 hf_json_write_string(out,message);fputs("}}\n",out);
}
static void hf_rpc_tools25(FILE *out,const char *id,const HfMcpPolicy25 *policy){
 int emitted=0;
 fprintf(out,"{\"jsonrpc\":\"2.0\",\"id\":%s,\"result\":{\"tools\":[",id);
 if(hf_mcp_allowed25(policy,"authority_invoke")){emitted=1;fputs("{\"name\":\"authority_invoke\",\"description\":\"Invoke a scoped protocol1 operation through verified TLS and Ed25519. Explicit stable operation identities are mandatory.\",\"inputSchema\":{\"type\":\"object\",\"additionalProperties\":false,\"properties\":{\"payload\":{\"type\":\"object\"},\"operation_id\":{\"type\":\"string\",\"format\":\"uuid\"},\"idempotency_key\":{\"type\":\"string\",\"format\":\"uuid\"},\"correlation_id\":{\"type\":\"string\",\"format\":\"uuid\"},\"causation_id\":{\"type\":[\"string\",\"null\"]}},\"required\":[\"payload\",\"operation_id\",\"idempotency_key\",\"correlation_id\"]}}",out);}
 for(const HfRoute25 *r=hf_routes25;r->command;r++){
 char candidate[128];snprintf(candidate,sizeof candidate,"%s_%s",r->command,r->subcommand);if(!hf_mcp_allowed25(policy,candidate))continue;
 if(emitted++)fputc(',',out);
 fprintf(out,"{\"name\":\"%s_%s\",\"description\":\"Scoped %s. The server enforces current role, scope and authority; this mapping grants none.\",\"inputSchema\":{\"type\":\"object\",\"additionalProperties\":false,\"properties\":{\"run_id\":{\"type\":\"string\",\"format\":\"uuid\"},\"input\":{\"type\":\"object\"},\"operation_id\":{\"type\":\"string\",\"format\":\"uuid\"},\"idempotency_key\":{\"type\":\"string\",\"format\":\"uuid\"},\"correlation_id\":{\"type\":\"string\",\"format\":\"uuid\"},\"causation_id\":{\"type\":[\"string\",\"null\"]},\"expected_version\":{\"type\":[\"string\",\"null\"]},\"authority\":{\"type\":[\"object\",\"null\"]}},\"required\":[\"run_id\",\"input\",\"operation_id\",\"idempotency_key\",\"correlation_id\"]}}",r->command,r->subcommand,r->action);
 }
 fputs("]}}\n",out);
}
static int hf_arg_string25(const HfJson *j,int args,const char *name,char *out,size_t capacity){
 return hf_json_string(j,hf_json_field(j,args,name),out,capacity);
}
static void hf_rpc_call25(HfJson *j,FILE *out,const char *id,const HfMcpPolicy25 *policy){
 int params=hf_json_field(j,0,"params"),args=hf_json_field(j,params,"arguments");
 char name[128],operation[37],idempotency[37],correlation[37],causation[37],run[37],expected[32];
 if(!hf_json_string(j,hf_json_field(j,params,"name"),name,sizeof name)){hf_rpc_error25(out,id,-32602,"A finite tool name is required");return;}
 if(!hf_mcp_allowed25(policy,name)){hf_rpc_error25(out,id,-32601,"Tool is not permitted by trusted supervisor policy");return;}
 if(!hf_arg_string25(j,args,"operation_id",operation,sizeof operation)||!hf_uuid25(operation)||
 !hf_arg_string25(j,args,"idempotency_key",idempotency,sizeof idempotency)||!hf_uuid25(idempotency)||
 !hf_arg_string25(j,args,"correlation_id",correlation,sizeof correlation)||!hf_uuid25(correlation)){
 hf_rpc_error25(out,id,-32602,"Explicit canonical operation idempotency and correlation identities are required");return;}
 const char *cause=NULL;int cause_token=hf_json_field(j,args,"causation_id");
 if(cause_token>=0){char *raw=hf_json_raw(j,cause_token);int nil=raw&&!strcmp(raw,"null");free(raw);
 if(!nil){if(!hf_arg_string25(j,args,"causation_id",causation,sizeof causation)||!hf_uuid25(causation)){hf_rpc_error25(out,id,-32602,"Invalid causation identity");return;}cause=causation;}}
 char *payload=NULL,*input=NULL,*authority=NULL;
 if(!strcmp(name,"authority_invoke")){
 const char *const allowed[]={"payload","operation_id","idempotency_key","correlation_id","causation_id"};
 if(!hf_json_only(j,args,allowed,5)){hf_rpc_error25(out,id,-32602,"Unexpected authority tool fields");return;}
 payload=hf_json_raw(j,hf_json_field(j,args,"payload"));
 }else{
 const HfRoute25 *route=NULL;
 for(const HfRoute25 *r=hf_routes25;r->command;r++){char route_name[128];snprintf(route_name,sizeof route_name,"%s_%s",r->command,r->subcommand);if(!strcmp(route_name,name)){route=r;break;}}
 if(!route){hf_rpc_error25(out,id,-32602,"Unsupported distributed tool mapping");return;}
 const char *const allowed[]={"run_id","input","operation_id","idempotency_key","correlation_id","causation_id","expected_version","authority"};
 if(!hf_json_only(j,args,allowed,8)||!hf_arg_string25(j,args,"run_id",run,sizeof run)||!hf_uuid25(run)){hf_rpc_error25(out,id,-32602,"Scoped run and finite tool fields are required");return;}
 input=hf_json_raw(j,hf_json_field(j,args,"input"));authority=hf_json_raw(j,hf_json_field(j,args,"authority"));
 char version[40]="null";int version_token=hf_json_field(j,args,"expected_version");
 if(version_token>=0){char *raw=hf_json_raw(j,version_token);int nil=raw&&!strcmp(raw,"null");free(raw);
 if(!nil){
 if(!hf_arg_string25(j,args,"expected_version",expected,sizeof expected)||!expected[0]||strlen(expected)>19||(*expected=='0'&&expected[1])){free(input);free(authority);hf_rpc_error25(out,id,-32602,"Canonical decimal state version required");return;}
 for(const char *p=expected;*p;p++)if(!isdigit((unsigned char)*p)){free(input);free(authority);hf_rpc_error25(out,id,-32602,"Canonical decimal state version required");return;}
 snprintf(version,sizeof version,"\"%s\"",expected);
 }}
 if(!input||!hf_json25(input,strlen(input),0,NULL)){free(input);free(authority);hf_rpc_error25(out,id,-32602,"A bounded JSON input object is required");return;}
 size_t size=strlen(input)+(authority?strlen(authority):4)+1024;payload=malloc(size);
 if(payload)snprintf(payload,size,"{\"run_id\":\"%s\",\"component\":\"%s\",\"action\":\"%s\",\"input\":%s,\"expected_version\":%s,\"authority\":%s}",run,route->component,route->action,input,version,authority?authority:"null");
 }
 if(!payload||!hf_json25(payload,strlen(payload),0,NULL)){free(payload);free(input);free(authority);hf_rpc_error25(out,id,-32602,"A bounded protocol1 JSON payload is required");return;}
 char *body=NULL,*failure=NULL;size_t body_size=0,failure_size=0;
 FILE *success=open_memstream(&body,&body_size),*errors=open_memstream(&failure,&failure_size);
 if(!success||!errors){if(success)fclose(success);if(errors)fclose(errors);free(body);free(failure);free(payload);free(input);free(authority);hf_rpc_error25(out,id,-32603,"Response allocation failed");return;}
 HfTransportConfig subject_config;int result=hf_mcp_subject25(policy,&subject_config,errors);
 if(!result)result=hf_invoke_config25(policy->bound?&subject_config:NULL,payload,operation,idempotency,correlation,cause,success,errors);
 fclose(success);fclose(errors);
 fprintf(out,"{\"jsonrpc\":\"2.0\",\"id\":%s,\"result\":{\"content\":[{\"type\":\"text\",\"text\":",id);
 hf_json_write_string(out,body_size?body:failure_size?failure:"Authority returned no result");
 fprintf(out,"}],\"isError\":%s}}\n",result?"true":"false");
 free(body);free(failure);free(payload);free(input);free(authority);
}
static void hf_rpc_line25(const char *line,FILE *out,const HfMcpPolicy25 *policy){
 HfJson *j=malloc(sizeof *j);if(!j){hf_rpc_error25(out,NULL,-32603,"Request allocation failed");return;}
 if(!hf_json_parse(j,line)){free(j);hf_rpc_error25(out,NULL,-32700,"Invalid bounded JSON request");return;}
 char version[16],method[128];char *id=hf_json_raw(j,hf_json_field(j,0,"id"));
 if(!hf_json_get(j,"jsonrpc",version,sizeof version)||strcmp(version,"2.0")||!hf_json_get(j,"method",method,sizeof method)){
 hf_rpc_error25(out,id,-32600,"JSON-RPC2 method required");free(id);free(j);return;}
 if(!id){free(j);return;} /* Notifications cannot start unobservable authority mutations. */
 if(id[0]=='{'||id[0]=='['||!strcmp(id,"null")||!strcmp(id,"true")||!strcmp(id,"false")){hf_rpc_error25(out,NULL,-32600,"Invalid request identity");free(id);free(j);return;}
 if(!strcmp(method,"initialize"))fprintf(out,"{\"jsonrpc\":\"2.0\",\"id\":%s,\"result\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{\"tools\":{}},\"serverInfo\":{\"name\":\"Hyperfide\",\"version\":\"2.0.0-dev\"},\"instructions\":\"Distributed tools use verified authority. Stable operation identities are required. No local fallback or forced task qualification.\"}}\n",id);
 else if(!strcmp(method,"ping"))fprintf(out,"{\"jsonrpc\":\"2.0\",\"id\":%s,\"result\":{}}\n",id);
 else if(!strcmp(method,"tools/list"))hf_rpc_tools25(out,id,policy);
 else if(!strcmp(method,"tools/call"))hf_rpc_call25(j,out,id,policy);
 else hf_rpc_error25(out,id,-32601,"Unsupported distributed method");
 free(id);free(j);
}
static int hf_client_mcp25(FILE *out,FILE *err){
 HfMcpPolicy25 policy;if(!hf_mcp_policy25(&policy))return hf_client_error25(err,"MCP_TOOL_POLICY_INVALID","Trusted finite MCP tool policy is invalid");
 const char *configuration=getenv("HYPERFIDE_TRANSPORT_CONFIG");HfTransportConfig config;
 int configured=configuration&&hf_transport_config(configuration,&config);
 if(!configured){
 struct stat pending;int absent=configuration&&configuration[0]=='/'&&lstat(configuration,&pending)!=0&&errno==ENOENT;
 if(!absent||!policy.restricted||!policy.bootstrap)return hf_client_error25(err,"TRANSPORT_CONFIG_REQUIRED","Distributed MCP requires trusted target transport configuration");
 }
 char *line=malloc(HF_BODY_LIMIT+1);if(!line)return hf_client_error25(err,"RESOURCE_LIMIT","Request allocation failed");
 size_t length=0;int invalid=0,ch;
 while((ch=fgetc(stdin))!=EOF){
 if(ch=='\n'){line[length]=0;if(invalid)hf_rpc_error25(out,NULL,-32700,"Request exceeds protocol byte limit or contains NUL");else if(length)hf_rpc_line25(line,out,&policy);fflush(out);length=0;invalid=0;continue;}
 if(ch==0)invalid=1;
 if(length<HF_BODY_LIMIT)line[length++]=(char)ch;else invalid=1;
 }
 if(length||invalid){line[length]=0;if(invalid)hf_rpc_error25(out,NULL,-32700,"Invalid bounded request");else hf_rpc_line25(line,out,&policy);fflush(out);}
 free(line);return ferror(stdin)?1:0;
}
