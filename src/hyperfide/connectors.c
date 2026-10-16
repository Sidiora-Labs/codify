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
static int hex4(const char *p){int n=0;for(int i=0;i<4;i++){int c=(unsigned char)p[i],v=c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:c>='A'&&c<='F'?c-'A'+10:-1;if(v<0)return -1;n=n*16+v;}return n;}
static int string(Field *f,char *dst,size_t cap){
 if(!f||f->len<2||*f->start!='"')return 0;
 size_t j=0;const char *p=f->start+1,*e=f->start+f->len-1;
 while(p<e){uint32_t ch=(unsigned char)*p++;
 if(ch>=128){if(j+1>=cap)return 0;dst[j++]=(char)ch;continue;}
 if(ch=='\\'){if(p>=e)return 0;ch=(unsigned char)*p++;
 if(ch=='u'){if(e-p<4)return 0;int cp=hex4(p);if(cp<0)return 0;p+=4;ch=(uint32_t)cp;
 if(ch>=0xd800&&ch<=0xdbff){if(e-p<6||p[0]!='\\'||p[1]!='u')return 0;int low=hex4(p+2);if(low<0xdc00||low>0xdfff)return 0;ch=0x10000+((ch-0xd800)<<10)+(uint32_t)(low-0xdc00);p+=6;}
 else if(ch>=0xdc00&&ch<=0xdfff)return 0;
 }else{const char *keys="\"\\/bfnrt",*vals="\"\\/\b\f\n\r\t",*k=strchr(keys,(int)ch);if(!k)return 0;ch=(unsigned char)vals[k-keys];}}
 if(!ch)return 0;
 if(ch<0x80){if(j+1>=cap)return 0;dst[j++]=(char)ch;}
 else if(ch<0x800){if(j+2>=cap)return 0;dst[j++]=(char)(0xc0|(ch>>6));dst[j++]=(char)(0x80|(ch&63));}
 else if(ch<0x10000){if(j+3>=cap)return 0;dst[j++]=(char)(0xe0|(ch>>12));dst[j++]=(char)(0x80|((ch>>6)&63));dst[j++]=(char)(0x80|(ch&63));}
 else{if(j+4>=cap)return 0;dst[j++]=(char)(0xf0|(ch>>18));dst[j++]=(char)(0x80|((ch>>12)&63));dst[j++]=(char)(0x80|((ch>>6)&63));dst[j++]=(char)(0x80|(ch&63));}
 }dst[j]=0;return 1;
}
static void quoted(FILE *o,const char *s){fputc('"',o);for(const unsigned char *p=(const unsigned char*)s;*p;p++){switch(*p){case '"':fputs("\\\"",o);break;case '\\':fputs("\\\\",o);break;case '\n':fputs("\\n",o);break;case '\r':fputs("\\r",o);break;case '\t':fputs("\\t",o);break;default:if(*p<32)fprintf(o,"\\u%04x",*p);else fputc(*p,o);}}fputc('"',o);}
static int keys(Field *fs,int n,const char *allowed){for(int i=0;i<n;i++){char match[72];snprintf(match,sizeof match,"|%.63s|",fs[i].key);if(!strstr(allowed,match))return 0;}return 1;}
static int error(FILE *o,const char *code){fprintf(o,"{\"error\":{\"code\":\"%s\"}}",code);return 1;}
static int safe_id(const char *s){if(!*s||strlen(s)>128)return 0;for(;*s;s++)if(!isalnum((unsigned char)*s)&&!strchr("._:-",*s))return 0;return 1;}
static int absdir(const char *s){struct stat st;return *s=='/'&&!strstr(s,"/../")&&!strstr(s,"/./")&&stat(s,&st)==0&&S_ISDIR(st.st_mode);}
static long millis(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec*1000+t.tv_nsec/1000000;}
static int version(const char *exe,char *buf,size_t cap){int pipefd[2];if(*exe!='/'||pipe2(pipefd,O_CLOEXEC|O_NONBLOCK))return 0;pid_t pid=fork();if(pid<0){close(pipefd[0]);close(pipefd[1]);return 0;}if(pid==0){setpgid(0,0);dup2(pipefd[1],STDOUT_FILENO);int null=open("/dev/null",O_RDWR);dup2(null,STDERR_FILENO);dup2(null,STDIN_FILENO);close(pipefd[0]);close(pipefd[1]);execl(exe,exe,"--version",(char*)NULL);_exit(127);}close(pipefd[1]);setpgid(pid,pid);size_t n=0;int status=0,exited=0;long deadline=millis()+10000;while(millis()<deadline){ssize_t got=read(pipefd[0],buf+n,cap-1-n);if(got>0){n+=(size_t)got;if(n==cap-1)break;}if(waitpid(pid,&status,WNOHANG)==pid){exited=1;while((got=read(pipefd[0],buf+n,cap-1-n))>0){n+=(size_t)got;if(n==cap-1)break;}break;}struct pollfd fd={pipefd[0],POLLIN,0};poll(&fd,1,20);}close(pipefd[0]);kill(-pid,SIGKILL);if(!exited)waitpid(pid,&status,0);buf[n]=0;return exited&&WIFEXITED(status)&&WEXITSTATUS(status)==0&&n>0&&n<cap-1;}
typedef struct {
 char connector[16],path[4096],version[64],digest[80],profile_digest[80],profile_id[129],alias[129],model[255],provider[255],observed_model[255],observed_provider[255],permission[129];
 int unattended,explicit_resume,live_qualified;
} AuthProfile;
static int raw(Field *f,const char *value){return f&&f->len==strlen(value)&&!memcmp(f->start,value,f->len);}
static int sha(const char *value){if(strlen(value)!=71||strncmp(value,"sha256:",7))return 0;for(value+=7;*value;value++)if(!strchr("0123456789abcdef",*value))return 0;return 1;}
static int snapshot(AuthProfile *a){
 const char *filename=getenv("HF_NATIVE_AUTH_SNAPSHOT_FILE");if(!filename||*filename!='/')return 0;
 int fd=open(filename,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);if(fd<0)return 0;struct stat st;
 if(fstat(fd,&st)||!S_ISREG(st.st_mode)||st.st_size<2||st.st_size>65536){close(fd);return 0;}
 char *json=calloc((size_t)st.st_size+1,1);if(!json){close(fd);return 0;}
 size_t count=0;while(count<(size_t)st.st_size){ssize_t got=read(fd,json+count,(size_t)st.st_size-count);if(got<=0){free(json);close(fd);return 0;}count+=(size_t)got;}close(fd);
 Field f[20];int n=fields(json,f,20,"|schema_version||profile_id||profile_revision||profile_digest||connector||auth_mode||binary||credential_reference||configured_model_alias||requested_model_id||observed_model_id||configured_provider_id||observed_provider_id||permission_profile_id||capabilities||qualification|");
 Field b[3],c[5],q[3];char *bs=NULL,*cs=NULL,*qs=NULL;
 int good=0;
 if(n!=16||!raw(field(f,n,"schema_version"),"1"))goto done;
 Field *bf=field(f,n,"binary"),*cf=field(f,n,"capabilities"),*qf=field(f,n,"qualification");
 if(!bf||!cf||!qf)goto done;
 bs=strndup(bf->start,bf->len);cs=strndup(cf->start,cf->len);qs=strndup(qf->start,qf->len);if(!bs||!cs||!qs)goto done;
 int bn=fields(bs,b,3,"|path||digest||version|"),cn=fields(cs,c,5,"|unattended||refresh||concurrent_account||portable_session||explicit_resume|"),qn=fields(qs,q,3,"|state||live_qualified||receipt_digest|");
 if(bn!=3||cn!=5||qn!=3)goto done;
 if(!string(field(f,n,"connector"),a->connector,sizeof a->connector)||!string(field(b,bn,"path"),a->path,sizeof a->path)||*a->path!='/'||
 !string(field(b,bn,"version"),a->version,sizeof a->version)||!string(field(b,bn,"digest"),a->digest,sizeof a->digest)||!sha(a->digest)||
 !string(field(f,n,"profile_id"),a->profile_id,sizeof a->profile_id)||!safe_id(a->profile_id)||
 !string(field(f,n,"profile_digest"),a->profile_digest,sizeof a->profile_digest)||!sha(a->profile_digest)||
 !string(field(f,n,"configured_model_alias"),a->alias,sizeof a->alias)||!safe_id(a->alias)||
 !string(field(f,n,"requested_model_id"),a->model,sizeof a->model)||!safe_id(a->model)||
 !string(field(f,n,"configured_provider_id"),a->provider,sizeof a->provider)||!safe_id(a->provider)||
 !string(field(f,n,"permission_profile_id"),a->permission,sizeof a->permission)||!safe_id(a->permission))goto done;
 a->unattended=raw(field(c,cn,"unattended"),"true");a->explicit_resume=raw(field(c,cn,"explicit_resume"),"true");
 char state[32],receipt[80];a->live_qualified=string(field(q,qn,"state"),state,sizeof state)&&!strcmp(state,"QUALIFIED")&&raw(field(q,qn,"live_qualified"),"true")&&string(field(q,qn,"receipt_digest"),receipt,sizeof receipt)&&sha(receipt);
 if(!raw(field(f,n,"observed_model_id"),"null")&&!string(field(f,n,"observed_model_id"),a->observed_model,sizeof a->observed_model))goto done;
 if(!raw(field(f,n,"observed_provider_id"),"null")&&!string(field(f,n,"observed_provider_id"),a->observed_provider,sizeof a->observed_provider))goto done;
 a->live_qualified=a->live_qualified&&a->observed_model[0]&&a->observed_provider[0];
 good=1;
 done:free(bs);free(cs);free(qs);free(json);return good;
}
static int provider(Field *fs,int n,char *name,FILE *out){if(!string(field(fs,n,"connector"),name,16)||(!strcmp(name,"codex")?0:strcmp(name,"claude")))return error(out,"CONNECTOR_INVALID");return 0;}
int hf_component_13_1(const char *action,const char *json,FILE *out){
Field fs[16];int n=fields(json,fs,16,"|connector||expected_version||alias||auth_profile||workspace||home||temp||permission_mode||native_session_id||operation||turn_id||text||request_id|");
if(n<0)return error(out,"CONNECTOR_INVALID");
if(!strcmp(action,"connector.describe")){if(n)return error(out,"CONNECTOR_INVALID");fputs("{\"schema_version\":1,\"connectors\":[\"codex\",\"claude\"],\"transport\":{\"codex\":\"app-server-jsonl\",\"claude\":\"stream-json\"},\"capabilities\":{\"launch\":\"requires-profile-probe\",\"input\":\"protocol-supported\",\"output\":\"protocol-supported\",\"steer\":\"codex-active-turn-only\",\"cancel\":\"supervisor-process-tree\",\"child_registration\":\"unsupported-delegation-disabled\",\"resume\":\"exact-id-and-checkpoint-required\"},\"live_qualified\":false}",out);return 0;}
char name[16];if(provider(fs,n,name,out))return 1;
AuthProfile profile={0};
if(!snapshot(&profile)||strcmp(profile.connector,name))return error(out,"CONNECTOR_NOT_CONFIGURED");
const char *exe=profile.path,*pin=profile.version;
char actual[256];if(!version(exe,actual,sizeof actual))return error(out,"CONNECTOR_EXECUTABLE_UNAVAILABLE");
char expected[256];snprintf(expected,sizeof expected,!strcmp(name,"codex")?"codex-cli %s\n":"%s (Claude Code)\n",pin);
if(strcmp(actual,expected))return error(out,"CONNECTOR_VERSION_MISMATCH");
if(!strcmp(action,"connector.probe")){if(n!=1)return error(out,"CONNECTOR_INVALID");fputs("{\"connector\":",out);quoted(out,name);fputs(",\"version\":",out);quoted(out,pin);fputs(",\"executable_observed\":true,\"live_qualified\":false}",out);return 0;}
if(!strcmp(action,"connector.initialize")){
 char request[129],workspace[4096],session[129]="";
 if(!keys(fs,n,"|connector||request_id||workspace||native_session_id|")||n<3||n>4||
 !string(field(fs,n,"request_id"),request,sizeof request)||!safe_id(request)||
 !string(field(fs,n,"workspace"),workspace,sizeof workspace)||!absdir(workspace)||
 (field(fs,n,"native_session_id")&&(!string(field(fs,n,"native_session_id"),session,sizeof session)||!safe_id(session))))return error(out,"CONNECTOR_INVALID");
 if(session[0]&&!profile.explicit_resume)return error(out,"CONNECTOR_UNSUPPORTED");
 if(!strcmp(name,"claude")){fputs("{\"steps\":[],\"native_identity_source\":\"system.init.session_id\",\"context_restored\":false}",out);return 0;}
 fputs("{\"steps\":[{\"await_response\":true,\"frame\":{\"id\":",out);quoted(out,request);fputs(",\"method\":\"initialize\",\"params\":{\"clientInfo\":{\"name\":\"hyperfide\",\"version\":\"1\"},\"capabilities\":{\"experimentalApi\":false}}}},{\"await_response\":false,\"frame\":{\"method\":\"initialized\",\"params\":{}}},{\"await_response\":true,\"frame\":{\"id\":",out);
 char second[160];snprintf(second,sizeof second,"%s:thread",request);quoted(out,second);
 fputs(",\"method\":",out);quoted(out,session[0]?"thread/resume":"thread/start");fputs(",\"params\":{",out);
 if(session[0]){fputs("\"threadId\":",out);quoted(out,session);}
 else{fputs("\"model\":",out);quoted(out,profile.model);fputs(",\"modelProvider\":",out);quoted(out,profile.provider);fputs(",\"cwd\":",out);quoted(out,workspace);fputs(",\"approvalPolicy\":\"never\",\"sandbox\":\"workspaceWrite\"",out);}
 fputs("}}}],\"native_identity_source\":\"result.thread.id\",\"context_restored\":false}",out);return 0;
}
if(!strcmp(action,"connector.launch")){
if(!keys(fs,n,"|connector||expected_version||alias||auth_profile||workspace||home||temp||permission_mode||native_session_id|"))return error(out,"CONNECTOR_INVALID");
char alias[129],auth[129],workspace[4096],home[4096],temp[4096],permission[32],session[129]="",ev[64];
if(!string(field(fs,n,"expected_version"),ev,sizeof ev)||strcmp(ev,pin)||!string(field(fs,n,"alias"),alias,sizeof alias)||!safe_id(alias)||
!string(field(fs,n,"auth_profile"),auth,sizeof auth)||!safe_id(auth)||!string(field(fs,n,"workspace"),workspace,sizeof workspace)||!absdir(workspace)||
!string(field(fs,n,"home"),home,sizeof home)||!absdir(home)||!string(field(fs,n,"temp"),temp,sizeof temp)||!absdir(temp)||
!string(field(fs,n,"permission_mode"),permission,sizeof permission)||strcmp(permission,"workspace-write")||n<8||n>9||
(field(fs,n,"native_session_id")&&!string(field(fs,n,"native_session_id"),session,sizeof session))||(session[0]&&!safe_id(session))||
!strcmp(workspace,home)||!strcmp(workspace,temp)||!strcmp(home,temp))return error(out,"CONNECTOR_INVALID");
const char *resolved=profile.model,*configured_alias=profile.alias,*provider_name=profile.provider,*auth_ref=profile.profile_id;
if(!profile.unattended||(session[0]&&!profile.explicit_resume))return error(out,"CONNECTOR_UNSUPPORTED");
if(!resolved||!safe_id(resolved)||!configured_alias||strcmp(alias,configured_alias)||!provider_name||!safe_id(provider_name)||!auth_ref||strcmp(auth,auth_ref))return error(out,"CONNECTOR_PROFILE_UNRESOLVED");
fputs("{\"connector\":",out);quoted(out,name);fputs(",\"version\":",out);quoted(out,pin);fputs(",\"requested_model_id\":",out);quoted(out,resolved);fputs(",\"configured_provider_id\":",out);quoted(out,provider_name);fputs(",\"observed_model_id\":",out);if(profile.observed_model[0])quoted(out,profile.observed_model);else fputs("null",out);fputs(",\"observed_provider_id\":",out);if(profile.observed_provider[0])quoted(out,profile.observed_provider);else fputs("null",out);fputs(",\"auth_profile\":",out);quoted(out,auth);fputs(",\"argv\":[",out);quoted(out,exe);
if(!strcmp(name,"codex"))fputs(",\"app-server\",\"--listen\",\"stdio://\",\"--disable\",\"multi_agent\"",out);
else {fputs(",\"--print\",\"--input-format\",\"stream-json\",\"--output-format\",\"stream-json\",\"--verbose\",\"--permission-mode\",\"dontAsk\",\"--permission-prompts\",\"none\",\"--strict-mcp-config\",\"--setting-sources\",\"\",\"--disallowedTools\",\"Agent,Task\",\"--model\",",out);quoted(out,resolved);if(session[0]){fputs(",\"--resume\",",out);quoted(out,session);}}
fputs("],\"binary_digest\":",out);quoted(out,profile.digest);fputs(",\"profile_digest\":",out);quoted(out,profile.profile_digest);fputs(",\"permission_profile_id\":",out);quoted(out,profile.permission);fprintf(out,",\"dispatch_eligible\":%s",profile.live_qualified?"true":"false");fputs(",\"cwd\":",out);quoted(out,workspace);fputs(",\"home\":",out);quoted(out,home);fputs(",\"temp\":",out);quoted(out,temp);fputs(",\"native_session_id\":",out);if(session[0])quoted(out,session);else fputs("null",out);fputs(",\"delegation_enabled\":false,\"requires_supervisor\":true,\"live_qualified\":false}",out);return 0;}
if(!strcmp(action,"connector.encode")){
if(!keys(fs,n,"|connector||operation||native_session_id||turn_id||text||request_id|"))return error(out,"CONNECTOR_INVALID");
char op[32],session[129],turn[129]="",text[65536]="",request_id[129];
if(!string(field(fs,n,"operation"),op,sizeof op)||!string(field(fs,n,"native_session_id"),session,sizeof session)||!safe_id(session)||
(field(fs,n,"turn_id")&&(!string(field(fs,n,"turn_id"),turn,sizeof turn)||!safe_id(turn)))||
(field(fs,n,"text")&&!string(field(fs,n,"text"),text,sizeof text))||n<4||n>6||!string(field(fs,n,"request_id"),request_id,sizeof request_id)||!safe_id(request_id))return error(out,"CONNECTOR_INVALID");
if(!strcmp(name,"claude")){
if(strcmp(op,"input"))return error(out,"CONNECTOR_UNSUPPORTED");
if(!text[0]||turn[0]||n!=5)return error(out,"CONNECTOR_INVALID");
fputs("{\"frame\":{\"type\":\"user\",\"session_id\":",out);quoted(out,session);fputs(",\"message\":{\"role\":\"user\",\"content\":",out);quoted(out,text);fputs("}},\"delivery\":\"unacknowledged\",\"replay_safe\":false}",out);return 0;}
if(!strcmp(op,"input")||!strcmp(op,"steer")){if(!text[0]||(!strcmp(op,"steer")&&!turn[0])||(!strcmp(op,"input")&&turn[0]))return error(out,"CONNECTOR_INVALID");fputs("{\"frame\":{\"id\":",out);quoted(out,request_id);fprintf(out,",\"method\":\"turn/%s\",\"params\":{\"threadId\":",!strcmp(op,"steer")?"steer":"start");quoted(out,session);fputs(",\"input\":[{\"type\":\"text\",\"text\":",out);quoted(out,text);fputs("}]",out);if(turn[0]){fputs(",\"expectedTurnId\":",out);quoted(out,turn);}fputs("}},\"delivery\":\"unacknowledged\",\"replay_safe\":false}",out);return 0;}
if(!strcmp(op,"resume")||!strcmp(op,"cancel")){if(!strcmp(op,"resume")&&!profile.explicit_resume)return error(out,"CONNECTOR_UNSUPPORTED");if(text[0]||(!strcmp(op,"cancel")&&!turn[0])||(!strcmp(op,"resume")&&turn[0]))return error(out,"CONNECTOR_INVALID");fputs("{\"frame\":{\"id\":",out);quoted(out,request_id);fprintf(out,",\"method\":\"%s\",\"params\":{\"threadId\":",!strcmp(op,"resume")?"thread/resume":"turn/interrupt");quoted(out,session);if(turn[0]){fputs(",\"turnId\":",out);quoted(out,turn);}fputs("}},\"delivery\":\"unacknowledged\",\"replay_safe\":false}",out);return 0;}
return error(out,"CONNECTOR_UNSUPPORTED");}
return error(out,"CONNECTOR_UNSUPPORTED");
}
