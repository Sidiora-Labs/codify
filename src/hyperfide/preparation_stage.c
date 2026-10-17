#define _GNU_SOURCE
#include "supervisor.h"
#include <openssl/evp.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define HF_STAGE_MAX (64ULL*1024*1024*1024)
#define HF_STAGE_FILES 64

/* A successful claim supplies authority; artifact receipts establish byte identity only.
 * All credential-bearing RPCs run here as root, before the worker recipe starts. */
static int string(const HfJson *j,int o,const char *k,char *v,size_t n) {
 return hf_json_string(j,hf_json_field(j,o,k),v,n);
}
static int equals(const HfJson *j,int o,const char *k,const char *expected) {
 char value[4096];return string(j,o,k,value,sizeof value)&&!strcmp(value,expected);
}
static int sha_valid(const char *s) {
 if(strlen(s)!=71||strncmp(s,"sha256:",7))return 0;
 for(int i=7;i<71;i++)if(!((s[i]>='0'&&s[i]<='9')||(s[i]>='a'&&s[i]<='f')))return 0;
 return 1;
}
static int quantity(const HfJson *j,int o,const char *k,uint64_t *n) {
 char text[32],*end; if(!string(j,o,k,text,sizeof text)||!text[0]||(text[0]=='0'&&text[1]))return 0;
 for(char *p=text;*p;p++)if(*p<'0'||*p>'9')return 0;
 errno=0;unsigned long long value=strtoull(text,&end,10);
 if(errno||*end||value>HF_STAGE_MAX)return 0;
 *n=value;return 1;
}
static int positive(const HfJson *j,int o,const char *key,uint64_t maximum,uint64_t *result){
 char value[32],*end=NULL;if(!string(j,o,key,value,sizeof value)||!value[0]||value[0]=='0')return 0;
 for(const char *p=value;*p;p++)if(*p<'0'||*p>'9')return 0;
 errno=0;unsigned long long n=strtoull(value,&end,10);if(errno||!end||*end||n>maximum)return 0;*result=n;return 1;
}
static int target_binding(const HfJson *j,int target,int physical,const char *operation,const char *org,const char *run,const char *sandbox,const char *boot,const char *boot_generation,const char *slot,const char *repository,const char *reservation,const char *workspace,uid_t uid,gid_t gid,const char *source_object,const char *source_tree){
 const char *keys[]={"target_binding_id","organisation_id","run_id","preparation_operation_id","task_id","request_id","reservation_id","allocation_id","allocation_generation","sandbox_id","sandbox_boot_generation","boot_id","target_slot_id","target_slot_generation","target_runner_session_id","target_uid","target_gid","assignee_session_id","repository_id","source_digest","source_object_id","source_tree_id","profile_id","profile_digest","boot_preparation_digest","workspace_path","home_path","tmp_path","generation","state","execution_authority"};
 if(!hf_json_only(j,target,keys,sizeof keys/sizeof keys[0]))return 0;
 const char *uuid_keys[]={"target_binding_id","organisation_id","run_id","preparation_operation_id","task_id","request_id","reservation_id","allocation_id","sandbox_id","boot_id","target_slot_id","target_runner_session_id","assignee_session_id","repository_id","profile_id"};
 char value[4096];
 for(size_t n=0;n<sizeof uuid_keys/sizeof uuid_keys[0];n++)if(!string(j,target,uuid_keys[n],value,sizeof value)||!hf_uuid_valid(value))return 0;
 const char *generation_keys[]={"allocation_generation","sandbox_boot_generation","target_slot_generation","generation"};
 uint64_t number;
 for(size_t n=0;n<sizeof generation_keys/sizeof generation_keys[0];n++)if(!positive(j,target,generation_keys[n],9223372036854775807ULL,&number))return 0;
 if(!positive(j,target,"target_uid",UINT_MAX,&number)||number!=uid||!positive(j,target,"target_gid",UINT_MAX,&number)||number!=gid)return 0;
 const char *sha_keys[]={"source_digest","profile_digest","boot_preparation_digest"};
 for(size_t n=0;n<sizeof sha_keys/sizeof sha_keys[0];n++)if(!string(j,target,sha_keys[n],value,sizeof value)||!sha_valid(value))return 0;
 const char *fixed_keys[]={"organisation_id","run_id","preparation_operation_id","sandbox_id","boot_id","sandbox_boot_generation","target_slot_id","repository_id","reservation_id","workspace_path","source_object_id","source_tree_id"};
 const char *fixed_values[]={org,run,operation,sandbox,boot,boot_generation,slot,repository,reservation,workspace,source_object,source_tree};
 for(size_t n=0;n<sizeof fixed_keys/sizeof fixed_keys[0];n++)if(!equals(j,target,fixed_keys[n],fixed_values[n]))return 0;
 const char *target_keys[]={"target_runner_session_id","target_slot_generation","home_path","tmp_path"};
 const char *physical_keys[]={"session_id","slot_generation","home_path","tmp_path"};
 for(size_t n=0;n<sizeof target_keys/sizeof target_keys[0];n++)if(!string(j,physical,physical_keys[n],value,sizeof value)||!equals(j,target,target_keys[n],value))return 0;
 for(size_t n=2;n<4;n++)if(!string(j,target,target_keys[n],value,sizeof value)||value[0]!='/'||strstr(value,"//")||strstr(value,"/../")||strstr(value,"/./"))return 0;
 if(!string(j,target,"state",value,65)||!value[0])return 0;
 char *authority=hf_json_raw(j,hf_json_field(j,target,"execution_authority"));int ok=authority&&!strcmp(authority,"false");free(authority);return ok;
}
static int strict_dir(const char *path,int create) {
 if(!path||path[0]!='/'||strlen(path)>=4096)return -1;
 char *copy=strdup(path),*save=NULL;int fd=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC);
 if(!copy||fd<0){free(copy);if(fd>=0)close(fd);return -1;}
 for(char *p=strtok_r(copy,"/",&save);p;p=strtok_r(NULL,"/",&save)){
  if(!strcmp(p,".")||!strcmp(p,".."))goto bad;
  if(create&&mkdirat(fd,p,0755)&&errno!=EEXIST)goto bad;
  int next=openat(fd,p,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
  if(next<0)goto bad;
  struct stat st;if(fstat(next,&st)||st.st_uid!=0||(st.st_mode&022)){close(next);goto bad;}
  close(fd);fd=next;
 }
 free(copy);return fd;
bad:free(copy);close(fd);return -1;
}
static int protected_read(const char *path,size_t maximum,char **text,size_t *length) {
 if(!path||path[0]!='/'||strlen(path)>=4096)return 0;
 char parent[4096];strcpy(parent,path);char *leaf=strrchr(parent,'/');if(!leaf||!leaf[1])return 0;*leaf++=0;
 int dir=strict_dir(parent[0]?parent:"/",0);if(dir<0)return 0;
 int fd=openat(dir,leaf,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);close(dir);if(fd<0)return 0;
 struct stat before,after;int ok=!fstat(fd,&before)&&S_ISREG(before.st_mode)&&before.st_uid==0&&before.st_nlink==1&&!(before.st_mode&077)&&before.st_size>=0&&(uint64_t)before.st_size<=maximum;
 char *data=ok?malloc((size_t)before.st_size+1):NULL;size_t used=0;if(!data)ok=0;
 while(ok&&used<(size_t)before.st_size){ssize_t n=read(fd,data+used,(size_t)before.st_size-used);if(n<0&&errno==EINTR)continue;if(n<=0){ok=0;break;}used+=(size_t)n;}
 if(ok&&(fstat(fd,&after)||before.st_dev!=after.st_dev||before.st_ino!=after.st_ino||before.st_size!=after.st_size||before.st_mtim.tv_sec!=after.st_mtim.tv_sec||before.st_mtim.tv_nsec!=after.st_mtim.tv_nsec||memchr(data,0,used)))ok=0;
 close(fd);if(!ok){free(data);return 0;}data[used]=0;*text=data;*length=used;return 1;
}
static int workspace_parent(const char *path,const char *leaf,uid_t uid,gid_t gid) {
 if(!path||path[0]!='/'||strstr(path,"//"))return 0;
 char *copy=strdup(path),*save=NULL;int fd=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC);int ok=copy&&fd>=0;
 for(char *part=ok?strtok_r(copy,"/",&save):NULL;part&&ok;part=strtok_r(NULL,"/",&save)){
  if(!strcmp(part,".")||!strcmp(part,"..")){ok=0;break;}
  int next=openat(fd,part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
  if(next<0){ok=0;break;}close(fd);fd=next;
  struct stat st;if(fstat(fd,&st)||(st.st_uid!=0&&st.st_uid!=uid)||(st.st_mode&022)||!((st.st_uid==uid&&(st.st_mode&0100))||(st.st_gid==gid&&(st.st_mode&0010))||(st.st_mode&0001)))ok=0;
 }
 struct stat st;if(ok&&(fstat(fd,&st)||st.st_uid!=uid||(st.st_mode&077)))ok=0;
 if(ok){errno=0;if(fstatat(fd,leaf,&st,AT_SYMLINK_NOFOLLOW)==0||errno!=ENOENT)ok=0;}
 if(fd>=0)close(fd);
 free(copy);return ok;
}
static int pinned_binary(const char *path,const char *digest,int executable) {
 if(!sha_valid(digest)||!path||path[0]!='/')return 0;
 char parent[4096];if(snprintf(parent,sizeof parent,"%s",path)>=(int)sizeof parent)return 0;
 char *leaf=strrchr(parent,'/');if(!leaf||!leaf[1])return 0;*leaf++=0;
 int dir=strict_dir(parent[0]?parent:"/",0);if(dir<0)return 0;
 int fd=openat(dir,leaf,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);close(dir);if(fd<0)return 0;
 struct stat before,after;int ok=!fstat(fd,&before)&&S_ISREG(before.st_mode)&&before.st_uid==0&&!(before.st_mode&022)&&(!executable||(before.st_mode&0111))&&before.st_size>=0;
 EVP_MD_CTX *h=EVP_MD_CTX_new();if(!h||!ok||EVP_DigestInit_ex(h,EVP_sha256(),NULL)!=1)ok=0;
 unsigned char buf[65536],sum[32];unsigned size=0;ssize_t got;
 while(ok&&(got=read(fd,buf,sizeof buf))>0)if(EVP_DigestUpdate(h,buf,(size_t)got)!=1)ok=0;
 if(ok&&got<0)ok=0;
 if(ok&&(EVP_DigestFinal_ex(h,sum,&size)!=1||size!=32||fstat(fd,&after)||before.st_dev!=after.st_dev||before.st_ino!=after.st_ino||before.st_size!=after.st_size||before.st_mtim.tv_sec!=after.st_mtim.tv_sec||before.st_mtim.tv_nsec!=after.st_mtim.tv_nsec))ok=0;
 char hex[72]="sha256:";for(unsigned i=0;i<32&&ok;i++)snprintf(hex+7+i*2,3,"%02x",sum[i]);
 ok=ok&&!strcmp(hex,digest);EVP_MD_CTX_free(h);close(fd);return ok;
}
static int write_all(int fd,const void *data,size_t n) {
 const unsigned char *p=data;
 while(n){ssize_t w=write(fd,p,n);if(w<0&&errno==EINTR)continue;if(w<=0)return 0;p+=w;n-=(size_t)w;}return 1;
}
static unsigned char *decode(const char *encoded,size_t *size) {
 size_t n=strlen(encoded);if(n%4||n>4*((262144+2)/3))return NULL;
 char *url=strdup(encoded);if(!url)return NULL;
 size_t end=n;while(end&&url[end-1]=='=')url[--end]=0;
 if(n-end>2){free(url);return NULL;}
 for(size_t i=0;i<end;i++){
  if(url[i]=='+')url[i]='-';else if(url[i]=='/')url[i]='_';
  else if(!((url[i]>='a'&&url[i]<='z')||(url[i]>='A'&&url[i]<='Z')||(url[i]>='0'&&url[i]<='9'))){free(url);return NULL;}
 }
 unsigned char *bytes=hf_base64url_decode(url,size);
 if(bytes&&4*((*size+2)/3)!=n){free(bytes);bytes=NULL;}
 free(url);return bytes;
}
typedef struct {char org[37],run[37],operation[37],transport[4096];} Fetch;
static HfJson *rpc(const Fetch *f,const char *action,const char *id,HfHttpResponse *response) {
 if(!hf_uuid_valid(id))return NULL;
 char *payload=NULL;size_t size=0;FILE *out=open_memstream(&payload,&size);if(!out)return NULL;
 fprintf(out,"{\"run_id\":\"%s\",\"component\":\"15.2\",\"action\":\"%s\",\"input\":{\"organisation_id\":\"%s\",\"run_id\":\"%s\",\"artifact_id\":\"%s\"},\"expected_version\":null,\"authority\":null}",f->run,action,f->org,f->run,id);
 if(fclose(out)){free(payload);return NULL;}
 char operation[37],idem[37];if(!hf_uuid_generate(operation)||!hf_uuid_generate(idem)){free(payload);return NULL;}
 int sent=hf_supervisor_call(f->transport,0,payload,operation,idem,f->operation,f->operation,NULL,NULL,response);free(payload);
 HfJson *j=calloc(1,sizeof *j);int accepted=0;
 if(!sent||response->uncertain||response->status!=200||!response->body||!j||!hf_json_parse(j,response->body)||!hf_json_bool(j,hf_json_field(j,0,"ok"),&accepted)||!accepted){free(j);return NULL;}
 int r=hf_json_field(j,0,"result"),a=hf_json_field(j,r,"artifact"),receipt=hf_json_field(j,r,"receipt");
 if(!equals(j,r,"outcome","SUCCEEDED")||!equals(j,r,"availability","VERIFIED")||!equals(j,a,"organisation_id",f->org)||!equals(j,a,"run_id",f->run)||!equals(j,a,"artifact_id",id)||!equals(j,a,"status","COMPLETE")||!equals(j,receipt,"organisation_id",f->org)||!equals(j,receipt,"run_id",f->run)||!equals(j,receipt,"artifact_id",id)){free(j);return NULL;}
 return j;
}
static int fetch_object(const Fetch *f,const char *id,const char *digest,uint64_t size,int fd,EVP_MD_CTX *whole) {
 if(size>262144||!sha_valid(digest))return 0;
 HfHttpResponse response={0};HfJson *j=rpc(f,"artifact.object.read",id,&response);int ok=0;
 if(j){
  int r=hf_json_field(j,0,"result"),a=hf_json_field(j,r,"artifact"),receipt=hf_json_field(j,r,"receipt");
  uint64_t declared=0;char *encoded=malloc(349529);unsigned char *bytes=NULL;size_t n=0;char hex[65];
  if(encoded&&equals(j,a,"digest",digest)&&equals(j,receipt,"digest",digest)&&quantity(j,a,"size_bytes",&declared)&&declared==size&&quantity(j,receipt,"size_bytes",&declared)&&declared==size&&string(j,r,"data_base64",encoded,349529)&&(bytes=decode(encoded,&n))&&n==size&&hf_sha256_bytes(bytes,n,hex)&&!strcmp(hex,digest+7)&&write_all(fd,bytes,n)&&EVP_DigestUpdate(whole,bytes,n)==1)ok=1;
  free(encoded);free(bytes);free(j);
 }
 hf_http_response_free(&response);return ok;
}
static int fetch_content(const Fetch *f,const char *id,const char *kind,const char *digest,const char *parent_digest,uint64_t size,int fd) {
 EVP_MD_CTX *whole=EVP_MD_CTX_new();int ok=whole&&EVP_DigestInit_ex(whole,EVP_sha256(),NULL)==1;
 if(ok&&!strcmp(kind,"object"))ok=fetch_object(f,id,digest,size,fd,whole);
 else if(ok&&!strcmp(kind,"manifest")){
  HfHttpResponse response={0};HfJson *j=rpc(f,"artifact.manifest.read",id,&response);ok=0;
  if(j){
   int r=hf_json_field(j,0,"result"),a=hf_json_field(j,r,"artifact"),m=hf_json_field(j,r,"manifest"),chunks=hf_json_field(j,m,"chunks"),missing=hf_json_field(j,m,"missing_ranges");
   uint64_t total=0;int complete=0,truncated=1;int64_t count=0,version=0;
   char *raw=hf_json_raw(j,m);char hex[65];uint64_t offset=0;
   ok=raw&&sha_valid(parent_digest)&&hf_sha256_bytes(raw,strlen(raw),hex)&&!strcmp(hex,parent_digest+7)&&equals(j,a,"digest",parent_digest)&&equals(j,m,"organisation_id",f->org)&&equals(j,m,"run_id",f->run)&&equals(j,m,"kind","chunk-manifest")&&equals(j,m,"content_digest",digest)&&quantity(j,m,"total_size_bytes",&total)&&total==size&&hf_json_i64(j,hf_json_field(j,m,"schema_version"),&version)&&version==1&&hf_json_bool(j,hf_json_field(j,m,"complete"),&complete)&&complete&&hf_json_bool(j,hf_json_field(j,m,"truncated"),&truncated)&&!truncated&&missing>=0&&j->tokens[missing].type=='['&&j->tokens[missing].count==0&&chunks>=0&&j->tokens[chunks].type=='['&&j->tokens[chunks].count<=4096&&hf_json_i64(j,hf_json_field(j,m,"expected_chunks"),&count)&&count==j->tokens[chunks].count;
   free(raw);int index=chunks+1;
   for(int64_t sequence=0;ok&&sequence<count;sequence++){
    char child[37],child_digest[72];uint64_t bytes=0,at=0;int64_t actual=-1;
    ok=index>=0&&index<j->count&&hf_json_i64(j,hf_json_field(j,index,"sequence"),&actual)&&actual==sequence&&string(j,index,"artifact_id",child,sizeof child)&&hf_uuid_valid(child)&&string(j,index,"digest",child_digest,sizeof child_digest)&&sha_valid(child_digest)&&quantity(j,index,"offset_bytes",&at)&&at==offset&&quantity(j,index,"size_bytes",&bytes)&&bytes<=262144&&bytes<=size-offset&&fetch_object(f,child,child_digest,bytes,fd,whole);
    if(ok)offset+=bytes;
    index=j->tokens[index].next;
   }
   ok=ok&&offset==size;free(j);
  }
  hf_http_response_free(&response);
 }else ok=0;
 unsigned char sum[32];unsigned n=0;char actual[72]="sha256:";
 if(ok&&(EVP_DigestFinal_ex(whole,sum,&n)!=1||n!=32))ok=0;
 for(unsigned i=0;i<32&&ok;i++)snprintf(actual+7+i*2,3,"%02x",sum[i]);
 ok=ok&&!strcmp(actual,digest);EVP_MD_CTX_free(whole);return ok;
}
static int mkdir_owned(int parent,const char *name,uid_t uid,gid_t gid,mode_t mode) {
 if(mkdirat(parent,name,0700))return -1;
 int fd=openat(parent,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
 if(fd<0)return -1;
 if(fchown(fd,uid,gid)||fchmod(fd,mode)||fsync(fd)){close(fd);return -1;}return fd;
}
static int stage_file(const Fetch *f,int dir,int context,const char *root,const char *role,const char *id,const char *kind,const char *digest,const char *parent,uint64_t bytes,int sequence,gid_t gid,FILE *json) {
 char name[40],path[4096];snprintf(name,sizeof name,"artifact-%03d",sequence);
 if(snprintf(path,sizeof path,"%s/%s",root,name)>=(int)sizeof path)return 0;
 int fd=openat(dir,name,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);if(fd<0)return 0;
 int ok=fetch_content(f,id,kind,digest,parent,bytes,fd)&&fchown(fd,0,gid)==0&&fchmod(fd,0440)==0&&fsync(fd)==0;
 close(fd);if(!ok)return 0;
 if(context)fputc(',',json);
 fputs("{\"role\":",json);hf_json_write_string(json,role);fputs(",\"path\":",json);hf_json_write_string(json,path);
 fprintf(json,",\"digest\":\"%s\",\"size_bytes\":\"%llu\"}",digest,(unsigned long long)bytes);return 1;
}
int hf_runner_stage_preparation(const char *config_path,const HfJson *claim,int result,HfPreparationStage *stage) {
 if(!config_path||!claim||!stage||geteuid()!=0)return 0;
 memset(stage,0,sizeof *stage);int ok=0,base=-1,dir=-1,output=-1,diagnostics=-1,context=-1;
 char *config_text=NULL,*context_text=NULL,*target_text=NULL;size_t length=0,context_size=0;HfJson *config=calloc(1,sizeof *config);FILE *json=NULL;
 if(!config||!protected_read(config_path,HF_BODY_LIMIT,&config_text,&length)||!hf_json_parse(config,config_text))goto done;
 int plan=hf_json_field(claim,result,"plan"),p=hf_json_field(claim,plan,"preparation"),b=hf_json_field(claim,result,"binding");
 int job=hf_json_field(claim,p,"job_binding");
 int entries=hf_json_field(claim,p,"staging"),recipes=hf_json_field(config,0,"preparation_recipes"),bound_recipes=hf_json_field(claim,b,"preparation_recipes");
 char recipe[80],operation[37],plan_digest[72],transport[4096],workspace[4096],repository[37],slot[37],sandbox[37],boot[37],generation[32];
 Fetch fetch={0};int64_t uid=0,gid=0;
 if(!equals(claim,result,"job_class","PREPARATION")||!string(claim,result,"operation_id",operation,sizeof operation)||!hf_uuid_valid(operation)||!string(claim,result,"plan_digest",plan_digest,sizeof plan_digest)||!sha_valid(plan_digest)||!string(claim,p,"recipe_id",recipe,sizeof recipe)||(strcmp(recipe,"environment.prepare.v1")&&strcmp(recipe,"checkpoint.restore.v1"))||!string(config,0,"transport_config",transport,sizeof transport)||transport[0]!='/')goto done;
 char job_namespace[32],job_id[37],job_lease[32],reservation[37],plan_reservation[37],input_packet[72],job_manifest[72];
 const char *job_keys[]={"namespace","job_id","lease_generation","reservation_id","input_packet_digest","input_manifest_digest"};
 if(!hf_json_only(claim,job,job_keys,6)||!string(claim,job,"namespace",job_namespace,sizeof job_namespace)||!string(claim,job,"job_id",job_id,sizeof job_id)||!hf_uuid_valid(job_id)||!string(claim,job,"reservation_id",reservation,sizeof reservation)||!hf_uuid_valid(reservation)||!string(claim,plan,"reservation_id",plan_reservation,sizeof plan_reservation)||strcmp(reservation,plan_reservation)||!string(claim,job,"lease_generation",job_lease,sizeof job_lease)||!string(claim,job,"input_packet_digest",input_packet,sizeof input_packet)||!sha_valid(input_packet)||!string(claim,job,"input_manifest_digest",job_manifest,sizeof job_manifest)||!sha_valid(job_manifest))goto done;
 if(strcmp(job_namespace,"QUALIFICATION")&&strcmp(job_namespace,"REPRODUCTION")&&strcmp(job_namespace,"CANDIDATE")&&strcmp(job_namespace,"CHECKPOINT")&&strcmp(job_namespace,"PREWARM"))goto done;
 if((!strcmp(recipe,"checkpoint.restore.v1"))!=(!strcmp(job_namespace,"CHECKPOINT")))goto done;
 /* Qualification preparation precedes the first verifier lease claim. Zero
  * binds that unclaimed job snapshot; staging grants no execution authority. */
 if(!job_lease[0]||(job_lease[0]=='0'&&strcmp(job_lease,"0"))||(!strcmp(job_lease,"0")&&strcmp(job_namespace,"REPRODUCTION")&&strcmp(job_namespace,"QUALIFICATION")))goto done;
 for(const char *q=job_lease;*q;q++)if(*q<'0'||*q>'9')goto done;
 char *lease_end=NULL;errno=0;unsigned long long lease_generation=strtoull(job_lease,&lease_end,10);if(errno||!lease_end||*lease_end||lease_generation>9223372036854775807ULL)goto done;
 if(!string(claim,b,"organisation_id",fetch.org,sizeof fetch.org)||!hf_uuid_valid(fetch.org)||!string(claim,b,"run_id",fetch.run,sizeof fetch.run)||!hf_uuid_valid(fetch.run)||!equals(config,0,"organisation_id",fetch.org)||!equals(config,0,"run_id",fetch.run)||!string(claim,b,"workspace_path",workspace,sizeof workspace)||workspace[0]!='/'||strlen(workspace)<2||workspace[strlen(workspace)-1]=='/'||strstr(workspace,"//")||!hf_json_i64(claim,hf_json_field(claim,b,"uid"),&uid)||uid<=0||uid>=UINT_MAX||!hf_json_i64(claim,hf_json_field(claim,b,"gid"),&gid)||gid<=0||gid>=UINT_MAX)goto done;
 char *transport_text=NULL;size_t transport_size=0;
 if(!protected_read(transport,32768,&transport_text,&transport_size))goto done;
 free(transport_text);
 strcpy(fetch.transport,transport);strcpy(fetch.operation,operation);stage->uid=(uid_t)uid;stage->gid=(gid_t)gid;
 strcpy(stage->workspace_path,workspace);strcpy(stage->workspace_parent,workspace);char *leaf=strrchr(stage->workspace_parent,'/');if(!leaf||!leaf[1]||!strcmp(leaf+1,".")||!strcmp(leaf+1,".."))goto done;char workspace_name[4096];strcpy(workspace_name,leaf+1);if(leaf==stage->workspace_parent)goto done;*leaf=0;
 if(!workspace_parent(stage->workspace_parent,workspace_name,stage->uid,stage->gid))goto done;
 int trusted=hf_json_field(config,recipes,recipe),bound=hf_json_field(claim,bound_recipes,recipe);
 const char *keys[]={"node_path","node_digest","recipe_path","recipe_digest","base_root","native_path","native_digest","max_stage_bytes"};
 char values[8][4096];for(int i=0;i<8;i++)if(!string(config,trusted,keys[i],values[i],sizeof values[i])||!equals(claim,bound,keys[i],values[i]))goto done;
 uint64_t budget=0;if(!quantity(config,trusted,"max_stage_bytes",&budget)||!budget)goto done;
 if(!pinned_binary(values[0],values[1],1)||!pinned_binary(values[2],values[3],0)||!pinned_binary(values[5],values[6],1))goto done;
 int base_check=strict_dir(values[4],0);if(base_check<0)goto done;close(base_check);
 strcpy(stage->node_path,values[0]);strcpy(stage->node_digest,values[1]);strcpy(stage->recipe_path,values[2]);strcpy(stage->recipe_digest,values[3]);
 if(snprintf(stage->stage_root,sizeof stage->stage_root,"/run/hyperfide-stage/%s",operation)>=(int)sizeof stage->stage_root||snprintf(stage->context_path,sizeof stage->context_path,"%s/context.json",stage->stage_root)>=(int)sizeof stage->context_path||snprintf(stage->out_root,sizeof stage->out_root,"%s/out",stage->stage_root)>=(int)sizeof stage->out_root||snprintf(stage->diagnostics_root,sizeof stage->diagnostics_root,"%s/diagnostics",stage->stage_root)>=(int)sizeof stage->diagnostics_root)goto done;
 int argv=hf_json_field(claim,plan,"argv");
 if(argv<0||claim->tokens[argv].type!='['||claim->tokens[argv].count!=4)goto done;
 int arg=argv+1;const char *expected[]={stage->node_path,stage->recipe_path,"--job-context",stage->context_path};
 for(int i=0;i<4;i++){char value[4096];if(!hf_json_string(claim,arg,value,sizeof value)||strcmp(value,expected[i]))goto done;arg=claim->tokens[arg].next;}
 if(!equals(claim,plan,"executable_digest",stage->node_digest)||entries<0||claim->tokens[entries].type!='['||claim->tokens[entries].count>HF_STAGE_FILES)goto done;
 const char *scope_keys[]={"sandbox_id","boot_id","slot_id","repository_id"};
 char *scope_values[]={sandbox,boot,slot,repository};
 for(int i=0;i<4;i++)if(!string(claim,b,scope_keys[i],scope_values[i],37)||!hf_uuid_valid(scope_values[i]))goto done;
 uint64_t boot_generation=0;if(!quantity(claim,b,"boot_generation",&boot_generation)||!boot_generation)goto done;
 snprintf(generation,sizeof generation,"%llu",(unsigned long long)boot_generation);
 int source=hf_json_field(claim,p,"source");char source_values[4][4096];const char *source_keys[]={"repository_key","source_object_id","source_tree_id","source_manifest_digest"};
 int tree_unmeasured=0;
 for(int i=0;i<4;i++){
  if(i==2){char *raw=hf_json_raw(claim,hf_json_field(claim,source,source_keys[i]));tree_unmeasured=raw&&!strcmp(raw,"null");free(raw);if(tree_unmeasured){if(strcmp(recipe,"checkpoint.restore.v1"))goto done;source_values[i][0]=0;continue;}}
  if(!string(claim,source,source_keys[i],source_values[i],sizeof source_values[i])||!source_values[i][0])goto done;
 }
 if(!sha_valid(source_values[3]))goto done;
 if(!strcmp(recipe,"environment.prepare.v1")){
  int target=hf_json_field(claim,p,"target_binding");
  if(!target_binding(claim,target,b,operation,fetch.org,fetch.run,sandbox,boot,generation,slot,repository,reservation,workspace,stage->uid,stage->gid,source_values[1],source_values[2]))goto done;
  target_text=hf_json_raw(claim,target);if(!target_text||strlen(target_text)>32768)goto done;
 }

 base=strict_dir("/run/hyperfide-stage",1);if(base<0||fchmod(base,0711))goto done;
 dir=mkdir_owned(base,operation,0,stage->gid,0750);if(dir<0)goto done;
 output=mkdir_owned(dir,"out",stage->uid,stage->gid,0700);diagnostics=mkdir_owned(dir,"diagnostics",stage->uid,stage->gid,0700);
 if(output<0||diagnostics<0)goto done;
 json=open_memstream(&context_text,&context_size);if(!json)goto done;
 fprintf(json,"{\"schema_version\":1,\"operation_id\":\"%s\",\"plan_digest\":\"%s\",\"recipe_id\":\"%s\",\"scope\":{\"organisation_id\":\"%s\",\"run_id\":\"%s\",\"sandbox_id\":\"%s\",\"boot_id\":\"%s\",\"boot_generation\":\"%s\",\"slot_id\":\"%s\",\"repository_id\":\"%s\"},\"source\":{",operation,plan_digest,recipe,fetch.org,fetch.run,sandbox,boot,generation,slot,repository);
 for(int i=0;i<4;i++){if(i)fputc(',',json);hf_json_write_string(json,source_keys[i]);fputc(':',json);if(i==2&&tree_unmeasured)fputs("null",json);else hf_json_write_string(json,source_values[i]);}
 fprintf(json,"},\"job_binding\":{\"namespace\":\"%s\",\"job_id\":\"%s\",\"lease_generation\":\"%s\",\"reservation_id\":\"%s\",\"input_packet_digest\":\"%s\",\"input_manifest_digest\":\"%s\"",job_namespace,job_id,job_lease,reservation,input_packet,job_manifest);
 fputc('}',json);if(target_text){fputs(",\"target_binding\":",json);fputs(target_text,json);}
 fputs(",\"workspace\":{\"parent\":",json);hf_json_write_string(json,stage->workspace_parent);fputs(",\"name\":",json);hf_json_write_string(json,workspace_name);fputs(",\"path\":",json);hf_json_write_string(json,workspace);fputs("},\"staging\":[",json);
 char ids[HF_STAGE_FILES][37],roles[HF_STAGE_FILES][128];uint64_t total=0;int item=entries+1;
 for(int i=0;i<claim->tokens[entries].count;i++){
  char kind[20],digest[72],parent_digest[72]="";uint64_t bytes=0;
  if(!string(claim,item,"role",roles[i],sizeof roles[i])||!roles[i][0]||!string(claim,item,"artifact_id",ids[i],37)||!hf_uuid_valid(ids[i])||!string(claim,item,"storage_kind",kind,sizeof kind)||!string(claim,item,"digest",digest,sizeof digest)||!sha_valid(digest)||!quantity(claim,item,"size_bytes",&bytes)||bytes>budget-total)goto done;
  if(!strcmp(roles[i],"input-manifest")||(!strcmp(roles[i],"checkpoint.capsule")&&bytes>128ULL*1024*1024))goto done;
  for(const char *q=roles[i];*q;q++)if(!((*q>='a'&&*q<='z')||(*q>='A'&&*q<='Z')||(*q>='0'&&*q<='9')||strchr("._:-",*q)))goto done;
  for(int prior=0;prior<i;prior++)if(!strcmp(roles[i],roles[prior]))goto done;
  if(!strcmp(kind,"manifest")&&(!string(claim,item,"manifest_digest",parent_digest,sizeof parent_digest)||!sha_valid(parent_digest)))goto done;
  if(!stage_file(&fetch,dir,i,stage->stage_root,roles[i],ids[i],kind,digest,parent_digest,bytes,i,stage->gid,json))goto done;
  total+=bytes;item=claim->tokens[item].next;
 }
 char input_id[37],input_digest[72];if(!string(claim,p,"input_manifest_artifact_id",input_id,sizeof input_id)||!hf_uuid_valid(input_id)||!string(claim,p,"input_manifest_digest",input_digest,sizeof input_digest)||!sha_valid(input_digest))goto done;
 /* The input manifest is an ordinary bounded object. Discover its authenticated
  * exact size, then fetch and hash the bytes independently like every other input. */
 HfHttpResponse response={0};HfJson *manifest=rpc(&fetch,"artifact.object.inspect",input_id,&response);uint64_t input_size=0;
 if(!manifest){hf_http_response_free(&response);goto done;}
 int mr=hf_json_field(manifest,0,"result"),ma=hf_json_field(manifest,mr,"artifact");
 int input_ok=equals(manifest,ma,"digest",input_digest)&&quantity(manifest,ma,"size_bytes",&input_size)&&input_size<=262144&&input_size<=budget-total;
 free(manifest);hf_http_response_free(&response);if(!input_ok)goto done;
 if(!stage_file(&fetch,dir,claim->tokens[entries].count,stage->stage_root,"input-manifest",input_id,"object",input_digest,"",input_size,HF_STAGE_FILES,stage->gid,json))goto done;
 fprintf(json,"],\"max_stage_bytes\":\"%llu\",\"native\":{\"path\":",(unsigned long long)budget);hf_json_write_string(json,values[5]);fprintf(json,",\"digest\":\"%s\"},\"base_root\":",values[6]);hf_json_write_string(json,values[4]);fputs(",\"diagnostics_root\":",json);hf_json_write_string(json,stage->diagnostics_root);fputs(",\"out_root\":",json);hf_json_write_string(json,stage->out_root);fputc('}',json);
 if(fclose(json)){json=NULL;goto done;}json=NULL;
 if(!workspace_parent(stage->workspace_parent,workspace_name,stage->uid,stage->gid))goto done;
 context=openat(dir,"context.json",O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);
 if(context<0||!write_all(context,context_text,context_size)||fchown(context,0,stage->gid)||fchmod(context,0440)||fsync(context)||fsync(dir)||fsync(base))goto done;
 ok=1;
done:
 if(json)fclose(json);
 free(context_text);free(target_text);free(config_text);free(config);
 if(context>=0)close(context);
 if(diagnostics>=0)close(diagnostics);
 if(output>=0)close(output);
 if(dir>=0)close(dir);
 if(base>=0)close(base);
 if(!ok)memset(stage,0,sizeof *stage);
 return ok;
}
