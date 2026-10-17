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
#include <limits.h>
#include <openssl/evp.h>
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
/* Bounded native capture: own process group, no stdin, stderr discarded; optional CODEX_HOME for the slot home. */
static int capture(const char *exe,char *const argv[],const char *codex_home,char *buf,size_t cap){int pipefd[2];if(*exe!='/'||pipe2(pipefd,O_CLOEXEC|O_NONBLOCK))return 0;pid_t pid=fork();if(pid<0){close(pipefd[0]);close(pipefd[1]);return 0;}if(pid==0){setpgid(0,0);dup2(pipefd[1],STDOUT_FILENO);int null=open("/dev/null",O_RDWR);dup2(null,STDERR_FILENO);dup2(null,STDIN_FILENO);close(pipefd[0]);close(pipefd[1]);if(codex_home&&setenv("CODEX_HOME",codex_home,1))_exit(127);execv(exe,argv);_exit(127);}close(pipefd[1]);setpgid(pid,pid);size_t n=0;int status=0,exited=0;long deadline=millis()+10000;while(millis()<deadline){ssize_t got=read(pipefd[0],buf+n,cap-1-n);if(got>0){n+=(size_t)got;if(n==cap-1)break;}if(waitpid(pid,&status,WNOHANG)==pid){exited=1;while((got=read(pipefd[0],buf+n,cap-1-n))>0){n+=(size_t)got;if(n==cap-1)break;}break;}struct pollfd fd={pipefd[0],POLLIN,0};poll(&fd,1,20);}close(pipefd[0]);kill(-pid,SIGKILL);if(!exited)waitpid(pid,&status,0);buf[n]=0;return exited&&WIFEXITED(status)&&WEXITSTATUS(status)==0&&n>0&&n<cap-1;}
static int version(const char *exe,char *buf,size_t cap){char *const argv[]={(char*)exe,"--version",NULL};return capture(exe,argv,NULL,buf,cap);}
typedef struct {
 char connector[16],auth_mode[32],path[4096],version[64],digest[80],profile_digest[80],profile_id[129],alias[129],model[255],provider[255],observed_model[255],observed_provider[255],permission[129],receipt_digest[80];
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
 if(!string(field(f,n,"connector"),a->connector,sizeof a->connector)||!string(field(f,n,"auth_mode"),a->auth_mode,sizeof a->auth_mode)||!safe_id(a->auth_mode)||!string(field(b,bn,"path"),a->path,sizeof a->path)||*a->path!='/'||
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
 if(a->live_qualified)snprintf(a->receipt_digest,sizeof a->receipt_digest,"%s",receipt);
 good=1;
 done:free(bs);free(cs);free(qs);free(json);return good;
}
static int provider(Field *fs,int n,char *name,FILE *out){if(!string(field(fs,n,"connector"),name,16)||(!strcmp(name,"codex")?0:strcmp(name,"claude")))return error(out,"CONNECTOR_INVALID");return 0;}
/* Lenient member lookup for native-owned JSON (CLI config, protocol frames): unknown keys are the CLI's, not ours. */
static int member(const char *json,const char *key,Field *out){const char *p=space(json);if(*p++!='{')return 0;p=space(p);if(*p=='}')return 0;
 for(;;){const char *q=endstr(p);if(!q)return 0;size_t len=(size_t)(q-p-2);int hit=len==strlen(key)&&!memcmp(p+1,key,len);p=space(q);if(*p++!=':')return 0;p=space(p);q=skip(p,0);if(!q)return 0;
 if(hit){out->start=p;out->len=(size_t)(q-p);snprintf(out->key,sizeof out->key,"%s",key);return 1;}p=space(q);if(*p=='}')return 0;if(*p!=',')return 0;p=space(p+1);}}
static int member_string(const char *json,const char *key,char *dst,size_t cap){Field f;return member(json,key,&f)&&string(&f,dst,cap);}
static char *field_text(Field *f){return f?strndup(f->start,f->len):NULL;}
static int array_has(Field *f,const char *const *names){if(!f||*f->start!='[')return 0;char *a=field_text(f);if(!a)return 0;const char *p=space(a+1);int found=0;
 while(*p&&*p!=']'){const char *q=skip(p,0);if(!q)break;if(*p=='"'){Field e={"",p,(size_t)(q-p)};char v[256];if(string(&e,v,sizeof v))for(const char *const *n=names;*n;n++)if(!strcmp(v,*n))found=1;}p=space(q);if(*p==',')p=space(p+1);}free(a);return found;}
static long slurp(const char *filename,char *buf,size_t cap,int trusted){int fd=open(filename,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);if(fd<0)return -1;struct stat st;
 if(fstat(fd,&st)||!S_ISREG(st.st_mode)||(size_t)st.st_size>=cap||(trusted&&((st.st_mode&022)||(st.st_uid!=geteuid()&&st.st_uid!=0)))){close(fd);return -1;}
 size_t n=0;while(n<(size_t)st.st_size){ssize_t got=read(fd,buf+n,(size_t)st.st_size-n);if(got<=0){close(fd);return -1;}n+=(size_t)got;}close(fd);buf[n]=0;return memchr(buf,0,n)?-1:(long)n;}
static void hexdigest(const unsigned char *h,char out[80]){strcpy(out,"sha256:");for(int i=0;i<32;i++)sprintf(out+7+2*i,"%02x",h[i]);}
static int bytes_sha(const void *data,size_t len,char out[80]){unsigned char h[32];unsigned size=0;if(EVP_Digest(data,len,h,&size,EVP_sha256(),NULL)!=1||size!=32)return 0;hexdigest(h,out);return 1;}
static int file_sha(const char *filename,char out[80]){char real[PATH_MAX];if(!realpath(filename,real))return 0;int fd=open(real,O_RDONLY|O_CLOEXEC);if(fd<0)return 0;
 EVP_MD_CTX *c=EVP_MD_CTX_new();unsigned char h[32],b[65536];unsigned size=0;int ok=c&&EVP_DigestInit_ex(c,EVP_sha256(),NULL)==1;ssize_t got=0;
 while(ok&&(got=read(fd,b,sizeof b))>0){ok=EVP_DigestUpdate(c,b,(size_t)got)==1;}ok=ok&&got==0&&EVP_DigestFinal_ex(c,h,&size)==1&&size==32;EVP_MD_CTX_free(c);close(fd);if(ok)hexdigest(h,out);return ok;}
/* Top-level TOML basic strings only (`key = "value"` before the first table); anything escaped is left unresolved. */
static int toml_get(const char *text,const char *key,char *out,size_t cap){size_t k=strlen(key);
 for(const char *line=text;line&&*line;line=strchr(line,'\n')?strchr(line,'\n')+1:NULL){const char *p=line;while(*p==' '||*p=='\t'){p++;}if(*p=='[')return 0;
 if(strncmp(p,key,k)){continue;}p+=k;while(*p==' '||*p=='\t')p++;if(*p++!='='){continue;}while(*p==' '||*p=='\t')p++;if(*p++!='"')return -1;const char *e=p;while(*e&&*e!='"'&&*e!='\\'&&*e!='\n')e++;
 if(*e!='"'||(size_t)(e-p)>=cap){return -1;}memcpy(out,p,(size_t)(e-p));out[e-p]=0;e++;while(*e==' '||*e=='\t'||*e=='\r')e++;if(*e&&*e!='\n'&&*e!='#')return -1;return 1;}return 0;}
typedef struct {int found;char model[255],provider[255],path[4096],config_digest[80];} Resolution;
/* Resolve the user's frontier alias from the CLI's own configuration in the slot home:
 * Codex: profile layer $CODEX_HOME/<alias>.config.toml over config.toml; Claude Code: settings.json env ANTHROPIC_DEFAULT_<ALIAS>_MODEL.
 * Returns 0 with found=0 when the CLI configuration does not declare the alias, -1 when it is malformed. */
static int resolve_alias(const char *name,const char *alias,const char *home,Resolution *r){
 memset(r,0,sizeof *r);if(!safe_id(alias)||strchr(alias,':')||!absdir(home))return -1;
 static char text[65536];char other[65536];long len;
 if(!strcmp(name,"codex")){
  snprintf(r->path,sizeof r->path,"%s/%s.config.toml",home,alias);if(access(r->path,F_OK))return 0;
  if((len=slurp(r->path,text,sizeof text,1))<0||toml_get(text,"model",r->model,sizeof r->model)!=1||!safe_id(r->model))return -1;
  int pv=toml_get(text,"model_provider",r->provider,sizeof r->provider);if(pv<0)return -1;
  if(!pv){char base[4096];snprintf(base,sizeof base,"%s/config.toml",home);if(!access(base,F_OK)){if(slurp(base,other,sizeof other,1)<0||toml_get(other,"model_provider",r->provider,sizeof r->provider)<0)return -1;}}
  if(r->provider[0]&&!safe_id(r->provider))return -1;
  r->found=1;return bytes_sha(text,(size_t)len,r->config_digest)?0:-1;
 }
 char upper[32];size_t i=0;if(strcmp(alias,"opus")&&strcmp(alias,"sonnet")&&strcmp(alias,"haiku"))return 0;for(;alias[i];i++)upper[i]=(char)toupper((unsigned char)alias[i]);upper[i]=0;
 snprintf(r->path,sizeof r->path,"%s/.claude/settings.json",home);if(access(r->path,F_OK))return 0;
 if((len=slurp(r->path,text,sizeof text,1))<0||!skip(text,0)||*space(skip(text,0)))return -1;
 Field env;if(!member(text,"env",&env))return 0;char *e=field_text(&env);if(!e)return -1;
 char key[64],flag[16];snprintf(key,sizeof key,"ANTHROPIC_DEFAULT_%s_MODEL",upper);int ok=member_string(e,key,r->model,sizeof r->model);
 if(ok&&!safe_id(r->model)){free(e);return -1;}
 const char *flags[][2]={{"CLAUDE_CODE_USE_BEDROCK","bedrock"},{"CLAUDE_CODE_USE_VERTEX","vertex"},{"CLAUDE_CODE_USE_FOUNDRY","foundry"}};
 for(int f=0;f<3;f++)if(member_string(e,flags[f][0],flag,sizeof flag)&&!strcmp(flag,"1")){if(r->provider[0]){free(e);return -1;}snprintf(r->provider,sizeof r->provider,"%s",flags[f][1]);}
 free(e);if(!ok)return 0;r->found=1;return bytes_sha(text,(size_t)len,r->config_digest)?0:-1;
}
static void resolution_json(FILE *o,const Resolution *r){fputs("{\"source\":",o);quoted(o,r->found?"cli-config":"auth-profile");fputs(",\"config_path\":",o);if(r->found)quoted(o,r->path);else fputs("null",o);
 fputs(",\"config_digest\":",o);if(r->found)quoted(o,r->config_digest);else fputs("null",o);fputs(",\"resolved_model_id\":",o);if(r->found)quoted(o,r->model);else fputs("null",o);
 fputs(",\"resolved_provider_id\":",o);if(r->found&&r->provider[0])quoted(o,r->provider);else fputs("null",o);fputc('}',o);}
/* Server qualification receipt (agents/qualification.ts): Ed25519 over the exact payload bytes, public key pinned by the host.
 * Snapshot flags never qualify; only a verified, unexpired receipt bound to this measured binary and profile does. */
enum {CAP_LAUNCH,CAP_INPUT,CAP_OUTPUT,CAP_STEER,CAP_CANCEL,CAP_CHILD,CAP_RESUME,CAP_COUNT};
static const char *const CAP_NAMES[CAP_COUNT]={"launch","input","output","steer","cancel","child_registration","resume"};
typedef struct {char digest[80],observed_model[255],observed_provider[255],caps[CAP_COUNT][16];} Receipt;
static int nibble(char c){return c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:-1;}
static int unhex(const char *s,unsigned char *out,size_t n){if(strlen(s)!=2*n)return 0;for(size_t i=0;i<n;i++){int hi=nibble(s[2*i]),lo=nibble(s[2*i+1]);if(hi<0||lo<0)return 0;out[i]=(unsigned char)(hi*16+lo);}return 1;}
static int integer(Field *f,long *v){if(!f||!f->len||f->len>12)return 0;long x=0;for(size_t i=0;i<f->len;i++){if(!isdigit((unsigned char)f->start[i]))return 0;x=x*10+(f->start[i]-'0');}*v=x;return 1;}
static int same(Field *f,const char *v){char s[4096];return string(f,s,sizeof s)&&!strcmp(s,v);}
static int receipt(const AuthProfile *a,Receipt *r){
 memset(r,0,sizeof *r);const char *keyfile=getenv("HF_CONNECTOR_QUALIFICATION_PUBLIC_KEY_FILE"),*file=getenv("HF_CONNECTOR_QUALIFICATION_RECEIPT_FILE");
 if(!keyfile||!file||*keyfile!='/'||*file!='/')return 0;
 char keytext[160],*json=malloc(65536),*payload=malloc(16384);unsigned char key[32],sig[64];int good=0;EVP_PKEY *pk=NULL;EVP_MD_CTX *c=NULL;
 if(!json||!payload||slurp(keyfile,keytext,sizeof keytext,1)<0)goto done;
 keytext[strcspn(keytext,"\r\n")]=0;if(!unhex(keytext,key,32)||slurp(file,json,65536,0)<0)goto done;
 Field f[3];int n=fields(json,f,3,"|schema_version||payload||signature|");char sigtext[160];
 if(n!=3||!raw(field(f,n,"schema_version"),"1")||!string(field(f,n,"payload"),payload,16384)||!string(field(f,n,"signature"),sigtext,sizeof sigtext)||!unhex(sigtext,sig,64))goto done;
 size_t plen=strlen(payload);
 if(!(pk=EVP_PKEY_new_raw_public_key(EVP_PKEY_ED25519,NULL,key,32))||!(c=EVP_MD_CTX_new())||EVP_DigestVerifyInit(c,NULL,NULL,NULL,pk)!=1||EVP_DigestVerify(c,sig,64,(const unsigned char*)payload,plen)!=1)goto done;
 Field p[20],cf[CAP_COUNT];n=fields(payload,p,20,"|schema_version||receipt_id||connector||cli_version||binary_digest||auth_mode||profile_id||profile_digest||configured_model_alias||requested_model_id||observed_model_id||observed_provider_id||capabilities||issued_at||expires_at||evidence_digest||auth_qualification_digest|");
 if(n!=17||!raw(field(p,n,"schema_version"),"1"))goto done;
 char measured[80];long issued,expires,now=(long)time(NULL);
 if(!file_sha(a->path,measured)||strcmp(measured,a->digest)||!same(field(p,n,"binary_digest"),measured)||!same(field(p,n,"connector"),a->connector)||!same(field(p,n,"cli_version"),a->version)||
 !same(field(p,n,"auth_mode"),a->auth_mode)||!same(field(p,n,"profile_id"),a->profile_id)||!same(field(p,n,"profile_digest"),a->profile_digest)||
 !same(field(p,n,"configured_model_alias"),a->alias)||!same(field(p,n,"requested_model_id"),a->model)||!same(field(p,n,"observed_model_id"),a->model)||!same(field(p,n,"observed_provider_id"),a->provider)||
 !integer(field(p,n,"issued_at"),&issued)||!integer(field(p,n,"expires_at"),&expires)||issued>now+60||expires<=now||expires<=issued)goto done;
 Field *cap=field(p,n,"capabilities");char *caps=field_text(cap);if(!caps)goto done;
 int cn=fields(caps,cf,CAP_COUNT,"|launch||input||output||steer||cancel||child_registration||resume|");
 int all=cn==CAP_COUNT;for(int i=0;all&&i<CAP_COUNT;i++)all=string(field(cf,cn,CAP_NAMES[i]),r->caps[i],sizeof r->caps[i]);free(caps);
 if(!all||!bytes_sha(payload,plen,r->digest))goto done;
 snprintf(r->observed_model,sizeof r->observed_model,"%s",a->model);snprintf(r->observed_provider,sizeof r->observed_provider,"%s",a->provider);good=1;
 done:EVP_MD_CTX_free(c);EVP_PKEY_free(pk);free(json);free(payload);return good;
}
static int cap_is(const Receipt *r,int cap,const char *v){return !strcmp(r->caps[cap],v);}
static int dispatch_qualified(const Receipt *r,int resume){return cap_is(r,CAP_LAUNCH,"QUALIFIED")&&cap_is(r,CAP_INPUT,"QUALIFIED")&&cap_is(r,CAP_OUTPUT,"QUALIFIED")&&cap_is(r,CAP_CANCEL,"QUALIFIED")&&cap_is(r,CAP_CHILD,"REFUSED")&&(!resume||cap_is(r,CAP_RESUME,"QUALIFIED"));}
static int resume_receipt(const AuthProfile *a,Receipt *r){return a->explicit_resume&&receipt(a,r)&&cap_is(r,CAP_RESUME,"QUALIFIED");}
int hf_connector_resume_qualified(const char *connector,char *out,size_t size){
 /* Offline recipe files carry no authority; only a verified server receipt qualifying resume for this pinned binary does. */
 AuthProfile a={0};Receipt r;char actual[256],expected[256];
 if(!connector||!out||size<72||!snapshot(&a)||strcmp(a.connector,connector)||!version(a.path,actual,sizeof actual))return 0;
 snprintf(expected,sizeof expected,!strcmp(connector,"codex")?"codex-cli %s\n":"%s (Claude Code)\n",a.version);
 if(strcmp(actual,expected)||!resume_receipt(&a,&r))return 0;
 snprintf(out,size,"%s",r.digest);return 1;
}
int hf_component_13_1(const char *action,const char *json,FILE *out){
Field fs[16];int n=fields(json,fs,16,"|connector||expected_version||alias||auth_profile||workspace||home||temp||permission_mode||native_session_id||operation||turn_id||text||request_id||frame|");
if(n<0)return error(out,"CONNECTOR_INVALID");
if(!strcmp(action,"connector.describe")){if(n)return error(out,"CONNECTOR_INVALID");fputs("{\"schema_version\":1,\"connectors\":[\"codex\",\"claude\"],\"transport\":{\"codex\":\"app-server-jsonl\",\"claude\":\"stream-json\"},\"capabilities\":{\"launch\":\"requires-profile-probe\",\"input\":\"protocol-supported\",\"output\":\"protocol-supported\",\"steer\":\"codex-active-turn-only\",\"cancel\":\"supervisor-process-tree\",\"child_registration\":\"refused-delegation-disabled-per-version\",\"resume\":\"signed-server-receipt-required\"},\"alias_resolution\":\"cli-config-then-auth-profile\",\"dispatch\":\"signed-server-receipt-required\",\"live_qualified\":false}",out);return 0;}
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
 Receipt granted;
 if(session[0]&&!resume_receipt(&profile,&granted))return error(out,"CONNECTOR_UNSUPPORTED");
 if(!strcmp(name,"claude")){fputs("{\"steps\":[],\"native_identity_source\":\"system.init.session_id\",\"context_restored\":false}",out);return 0;}
 fputs("{\"steps\":[{\"await_response\":true,\"frame\":{\"id\":",out);quoted(out,request);fputs(",\"method\":\"initialize\",\"params\":{\"clientInfo\":{\"name\":\"hyperfide\",\"version\":\"1\"},\"capabilities\":{\"experimentalApi\":false}}}},{\"await_response\":false,\"frame\":{\"method\":\"initialized\",\"params\":{}}},{\"await_response\":true,\"frame\":{\"id\":",out);
 char second[160];snprintf(second,sizeof second,"%s:thread",request);quoted(out,second);
 fputs(",\"method\":",out);quoted(out,session[0]?"thread/resume":"thread/start");fputs(",\"params\":{",out);
 if(session[0]){fputs("\"threadId\":",out);quoted(out,session);}
 else{fputs("\"model\":",out);quoted(out,profile.model);fputs(",\"modelProvider\":",out);quoted(out,profile.provider);fputs(",\"cwd\":",out);quoted(out,workspace);fputs(",\"approvalPolicy\":\"never\",\"sandbox\":\"workspace-write\"",out);}
 fputs("}}}],\"native_identity_source\":\"result.thread.id\",\"context_restored\":false}",out);return 0;
}
if(!strcmp(action,"connector.resolve")){
 char alias[129],home[4096];Resolution res;
 if(!keys(fs,n,"|connector||alias||home|")||n!=3||!string(field(fs,n,"alias"),alias,sizeof alias)||!safe_id(alias)||!string(field(fs,n,"home"),home,sizeof home)||!absdir(home))return error(out,"CONNECTOR_INVALID");
 if(resolve_alias(name,alias,home,&res))return error(out,"CONNECTOR_CONFIG_INVALID");
 if(!res.found)return error(out,"CONNECTOR_ALIAS_UNRESOLVED");
 fputs("{\"connector\":",out);quoted(out,name);fputs(",\"version\":",out);quoted(out,pin);fputs(",\"alias\":",out);quoted(out,alias);fputs(",\"resolution\":",out);resolution_json(out,&res);
 fputs(",\"matches_auth_profile\":",out);fputs(!strcmp(alias,profile.alias)&&!strcmp(res.model,profile.model)&&(!res.provider[0]||!strcmp(res.provider,profile.provider))?"true":"false",out);fputs(",\"observed\":false,\"live_qualified\":false}",out);return 0;
}
if(!strcmp(action,"connector.observe")){
 /* Interpret one native handshake frame: the identity, model and provider the CLI itself reported. */
 char alias[129],home[4096],*frame=malloc(65536);Resolution res;int rc=0;
 if(!frame)return error(out,"CONNECTOR_INVALID");
 if(!keys(fs,n,"|connector||alias||home||frame|")||n!=4||!string(field(fs,n,"alias"),alias,sizeof alias)||!safe_id(alias)||!string(field(fs,n,"home"),home,sizeof home)||!absdir(home)||
 !string(field(fs,n,"frame"),frame,65536)||!skip(frame,0)||*space(skip(frame,0))){free(frame);return error(out,"CONNECTOR_INVALID");}
 if(resolve_alias(name,alias,home,&res)){free(frame);return error(out,"CONNECTOR_CONFIG_INVALID");}
 char session[256]="",model[255]="",provider_id[255]="",kind[32],digest_text[80];int child=-1;
 if(!strcmp(name,"codex")){Field result;char *r=member(frame,"result",&result)?field_text(&result):NULL;Field thread;char *t=r&&member(r,"thread",&thread)?field_text(&thread):NULL;
  int ok=r&&t&&member_string(r,"model",model,sizeof model)&&member_string(r,"modelProvider",provider_id,sizeof provider_id)&&member_string(t,"id",session,sizeof session);free(r);free(t);if(!ok)rc=error(out,"CONNECTOR_FRAME_INVALID");}
 else{char cv[64];Field tools;static const char *const delegation[]={"Agent","Task","Workflow",NULL};
  if(!member_string(frame,"type",kind,sizeof kind)||strcmp(kind,"system")||!member_string(frame,"subtype",kind,sizeof kind)||strcmp(kind,"init")||!member_string(frame,"session_id",session,sizeof session)||
  !member_string(frame,"model",model,sizeof model)||!member_string(frame,"claude_code_version",cv,sizeof cv)||!member(frame,"tools",&tools)||*tools.start!='[')rc=error(out,"CONNECTOR_FRAME_INVALID");
  else if(strcmp(cv,pin))rc=error(out,"CONNECTOR_VERSION_MISMATCH");
  else child=array_has(&tools,delegation);}
 if(!rc&&(!safe_id(session)||!safe_id(model)||(provider_id[0]&&!safe_id(provider_id))))rc=error(out,"CONNECTOR_FRAME_INVALID");
 if(rc){free(frame);return rc;}
 bytes_sha(frame,strlen(frame),digest_text);free(frame);
 const int matches=!strcmp(model,profile.model)&&(!provider_id[0]||!strcmp(provider_id,profile.provider))&&(!res.found||(!strcmp(model,res.model)&&(!res.provider[0]||!provider_id[0]||!strcmp(provider_id,res.provider))));
 fputs("{\"connector\":",out);quoted(out,name);fputs(",\"version\":",out);quoted(out,pin);fputs(",\"native_session_id\":",out);quoted(out,session);fputs(",\"observed_model_id\":",out);quoted(out,model);
 fputs(",\"observed_provider_id\":",out);if(provider_id[0])quoted(out,provider_id);else fputs("null",out);fputs(",\"resolution\":",out);resolution_json(out,&res);
 fprintf(out,",\"matches_configuration\":%s,\"child_registration\":%s,\"observation_digest\":",matches?"true":"false",child<0?"null":child?"\"AVAILABLE\"":"\"REFUSED\"");quoted(out,digest_text);fputs(",\"live_qualified\":false}",out);return 0;
}
if(!strcmp(action,"connector.children")){
 /* Child registration is refused by construction; prove the pinned Codex build honours the launch-time disabling. */
 char home[4096];static char listing[32768];
 if(!keys(fs,n,"|connector||home|")||n!=2||!string(field(fs,n,"home"),home,sizeof home)||!absdir(home))return error(out,"CONNECTOR_INVALID");
 if(strcmp(name,"codex"))return error(out,"CONNECTOR_UNSUPPORTED");
 char *const argv[]={(char*)exe,"--disable","multi_agent","--disable","multi_agent_v2","--disable","multi_agent_v2_dynamic_tools","-c","agents.enabled=false","features","list",NULL};
 if(!capture(exe,argv,home,listing,sizeof listing))return error(out,"CONNECTOR_EXECUTABLE_UNAVAILABLE");
 static const char *const features[]={"multi_agent","multi_agent_v2","multi_agent_v2_dynamic_tools"};
 for(int i=0;i<3;i++){int seen=0;size_t k=strlen(features[i]);for(const char *line=listing;line&&*line;line=strchr(line,'\n')?strchr(line,'\n')+1:NULL){
  if(strncmp(line,features[i],k)||(line[k]!=' '&&line[k]!='\t')){continue;}const char *end=strchr(line,'\n');size_t len=end?(size_t)(end-line):strlen(line);while(len&&isspace((unsigned char)line[len-1]))len--;
  if(len>=5&&!strncmp(line+len-5,"false",5))seen=1;else if(len>=4&&!strncmp(line+len-4,"true",4))return error(out,"CONNECTOR_DELEGATION_ESCAPED");}
  if(!seen)return error(out,"CONNECTOR_UNSUPPORTED");}
 char evidence[80];bytes_sha(listing,strlen(listing),evidence);
 fputs("{\"connector\":\"codex\",\"version\":",out);quoted(out,pin);fputs(",\"child_registration\":\"REFUSED\",\"mechanism\":\"features-disabled\",\"features\":{\"multi_agent\":false,\"multi_agent_v2\":false,\"multi_agent_v2_dynamic_tools\":false},\"evidence_digest\":",out);quoted(out,evidence);fputs(",\"live_qualified\":false}",out);return 0;
}
if(!strcmp(action,"connector.launch")){
if(!keys(fs,n,"|connector||expected_version||alias||auth_profile||workspace||home||temp||permission_mode||native_session_id|"))return error(out,"CONNECTOR_INVALID");
char alias[129],auth[129],workspace[4096],home[4096],temp[4096],permission[32],session[129]="",ev[64];
if(!string(field(fs,n,"expected_version"),ev,sizeof ev)||strcmp(ev,pin)||!string(field(fs,n,"alias"),alias,sizeof alias)||!safe_id(alias)||
!string(field(fs,n,"auth_profile"),auth,sizeof auth)||!safe_id(auth)||!string(field(fs,n,"workspace"),workspace,sizeof workspace)||!absdir(workspace)||
!string(field(fs,n,"home"),home,sizeof home)||!absdir(home)||!string(field(fs,n,"temp"),temp,sizeof temp)||!absdir(temp)||
!string(field(fs,n,"permission_mode"),permission,sizeof permission)||(strcmp(permission,"workspace-write")&&strcmp(permission,"supervision"))||n<8||n>9||
(field(fs,n,"native_session_id")&&!string(field(fs,n,"native_session_id"),session,sizeof session))||(session[0]&&!safe_id(session))||
!strcmp(workspace,home)||!strcmp(workspace,temp)||!strcmp(home,temp))return error(out,"CONNECTOR_INVALID");
const int supervisory=!strcmp(permission,"supervision");
const char *mcp_config=getenv("HF_SUPERVISOR_MCP_CONFIG_FILE");
if(supervisory&& (strcmp(name,"claude")||session[0]||!mcp_config||mcp_config[0]!='/'))return error(out,"CONNECTOR_UNSUPPORTED");
const char *resolved=profile.model,*configured_alias=profile.alias,*provider_name=profile.provider,*auth_ref=profile.profile_id;
if(!profile.unattended||(session[0]&&!profile.explicit_resume))return error(out,"CONNECTOR_UNSUPPORTED");
if(!resolved||!safe_id(resolved)||!configured_alias||strcmp(alias,configured_alias)||!provider_name||!safe_id(provider_name)||!auth_ref||strcmp(auth,auth_ref))return error(out,"CONNECTOR_PROFILE_UNRESOLVED");
Resolution res;if(resolve_alias(name,alias,home,&res))return error(out,"CONNECTOR_CONFIG_INVALID");
if(res.found&&(strcmp(res.model,resolved)||(res.provider[0]&&strcmp(res.provider,provider_name))))return error(out,"CONNECTOR_PROFILE_DRIFT");
Receipt granted;const int eligible=receipt(&profile,&granted)&&dispatch_qualified(&granted,session[0]!=0)&&!supervisory;
if(session[0]&&!eligible)return error(out,"CONNECTOR_UNSUPPORTED");
fputs("{\"connector\":",out);quoted(out,name);fputs(",\"version\":",out);quoted(out,pin);fputs(",\"requested_model_id\":",out);quoted(out,resolved);fputs(",\"configured_provider_id\":",out);quoted(out,provider_name);fputs(",\"observed_model_id\":",out);if(eligible)quoted(out,granted.observed_model);else fputs("null",out);fputs(",\"observed_provider_id\":",out);if(eligible)quoted(out,granted.observed_provider);else fputs("null",out);fputs(",\"alias_resolution\":",out);resolution_json(out,&res);fputs(",\"auth_profile\":",out);quoted(out,auth);fputs(",\"argv\":[",out);quoted(out,exe);
if(!strcmp(name,"codex"))fputs(",\"app-server\",\"--listen\",\"stdio://\",\"--disable\",\"multi_agent\",\"--disable\",\"multi_agent_v2\",\"--disable\",\"multi_agent_v2_dynamic_tools\",\"-c\",\"agents.enabled=false\"",out);
else if(supervisory){fputs(",\"--print\",\"--restricted\",\"--tools\",\"\",\"--strict-mcp-config\",\"--mcp-config\",",out);quoted(out,mcp_config);fputs(",\"--input-format\",\"stream-json\",\"--output-format\",\"stream-json\",\"--verbose\",\"--permission-mode\",\"dontAsk\",\"--permission-prompts\",\"none\",\"--setting-sources\",\"\",\"--model\",",out);quoted(out,resolved);}
else {fputs(",\"--print\",\"--input-format\",\"stream-json\",\"--output-format\",\"stream-json\",\"--verbose\",\"--permission-mode\",\"dontAsk\",\"--permission-prompts\",\"none\",\"--strict-mcp-config\",\"--setting-sources\",\"\",\"--disallowedTools\",\"Agent,Task,Workflow\",\"--model\",",out);quoted(out,resolved);if(session[0]){fputs(",\"--resume\",",out);quoted(out,session);}}
fputs("],\"permission_mode\":",out);quoted(out,permission);fputs(",\"binary_digest\":",out);quoted(out,profile.digest);fputs(",\"profile_digest\":",out);quoted(out,profile.profile_digest);fputs(",\"permission_profile_id\":",out);quoted(out,profile.permission);fputs(eligible?",\"dispatch_eligible\":true,\"qualification_receipt_digest\":":",\"dispatch_eligible\":false,\"qualification_receipt_digest\":null",out);if(eligible)quoted(out,granted.digest);fputs(",\"cwd\":",out);quoted(out,workspace);fputs(",\"home\":",out);quoted(out,home);fputs(",\"temp\":",out);quoted(out,temp);fputs(",\"native_session_id\":",out);if(session[0])quoted(out,session);else fputs("null",out);fputs(eligible?",\"delegation_enabled\":false,\"requires_supervisor\":true,\"live_qualified\":true}":",\"delegation_enabled\":false,\"requires_supervisor\":true,\"live_qualified\":false}",out);return 0;}
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
if(!strcmp(op,"resume")||!strcmp(op,"cancel")){Receipt granted;if(!strcmp(op,"resume")&&!resume_receipt(&profile,&granted))return error(out,"CONNECTOR_UNSUPPORTED");if(text[0]||(!strcmp(op,"cancel")&&!turn[0])||(!strcmp(op,"resume")&&turn[0]))return error(out,"CONNECTOR_INVALID");fputs("{\"frame\":{\"id\":",out);quoted(out,request_id);fprintf(out,",\"method\":\"%s\",\"params\":{\"threadId\":",!strcmp(op,"resume")?"thread/resume":"turn/interrupt");quoted(out,session);if(turn[0]){fputs(",\"turnId\":",out);quoted(out,turn);}fputs("}},\"delivery\":\"unacknowledged\",\"replay_safe\":false}",out);return 0;}
return error(out,"CONNECTOR_UNSUPPORTED");}
return error(out,"CONNECTOR_UNSUPPORTED");
}
