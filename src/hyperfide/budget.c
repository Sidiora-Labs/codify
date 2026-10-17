#define _GNU_SOURCE
#include "supervisor.h"
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <sched.h>
#include <signal.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/statfs.h>
#include <unistd.h>

/* Internal supervisor API only: the caller obtains this charge from the real
 * authenticated scheduler claim and pins logical boot in protected config.
 * Parsing JSON here authenticates nobody. Child execution remains gated until
 * descriptor-bound kernel limits and the dropped-privilege process match. */
#define CGROUP2_MAGIC 0x63677270
static int state(HfBudgetHandle *h,int value,const char *reason){h->status=value;snprintf(h->reason,sizeof h->reason,"%s",reason);return value;}
static int number(const char *text,unsigned long long *value){
 if(!text||!*text||(text[0]=='0'&&text[1]))return 0;
 for(const char *p=text;*p;p++)if(*p<'0'||*p>'9')return 0;
 errno=0;char *end=NULL;*value=strtoull(text,&end,10);return !errno&&end&&!*end;
}
static int decimal_at(const HfJson *j,int object,const char *name,unsigned long long *value){
 char text[32];return hf_json_string(j,hf_json_field(j,object,name),text,sizeof text)&&number(text,value);
}
static int string_at(const HfJson *j,int object,const char *name,char *out,size_t n){return hf_json_string(j,hf_json_field(j,object,name),out,n);}
static int digest(const char *s){if(strlen(s)!=71||strncmp(s,"sha256:",7))return 0;for(int k=7;k<71;k++)if(!isdigit((unsigned char)s[k])&&(s[k]<'a'||s[k]>'f'))return 0;return 1;}
static int uid_at(const HfJson *j,int object,const char *name,unsigned long long *value){
 int64_t n=0;if(!hf_json_i64(j,hf_json_field(j,object,name),&n)||n<1||n>INT_MAX)return 0;*value=(unsigned long long)n;return 1;
}
static int protected_dir(int fd,int sticky){
 struct stat s;return !fstat(fd,&s)&&S_ISDIR(s.st_mode)&&s.st_uid==0&&(!(s.st_mode&022)||(sticky&&(s.st_mode&S_ISVTX)));
}
/* Anchor every component. A sticky root-owned /tmp is safe only because each
 * subsequently opened component must itself be root-owned and protected. */
static int directory(const char *path,int sticky){
 if(!path||path[0]!='/'||strlen(path)>=4096||strstr(path,"//")||(strlen(path)>1&&path[strlen(path)-1]=='/'))return -1;
 for(const unsigned char *c=(const unsigned char*)path;*c;c++)if(*c<32||*c==127||*c=='\\')return -1;
 int fd=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(fd<0)return -1;
 if(!strcmp(path,"/"))return fd;
 char copy[4096];snprintf(copy,sizeof copy,"%s",path);char *save=NULL,*part=strtok_r(copy+1,"/",&save);
 while(part){if(!strcmp(part,".")||!strcmp(part,"..")||!protected_dir(fd,sticky)){close(fd);return -1;}
  int next=openat(fd,part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(fd);fd=next;if(fd<0)return -1;part=strtok_r(NULL,"/",&save);}
 if(!protected_dir(fd,sticky)){close(fd);return -1;}return fd;
}
static char *config_read(const char *path){
 if(!path||path[0]!='/'||strlen(path)>=4096)return NULL;
 char parent[4096];snprintf(parent,sizeof parent,"%s",path);char *name=strrchr(parent,'/');if(!name||!name[1])return NULL;*name++=0;
 int dir=directory(*parent?parent:"/",1);if(dir<0)return NULL;
 int fd=openat(dir,name,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);close(dir);if(fd<0)return NULL;
 struct stat before,after;char *raw=NULL;
 if(fstat(fd,&before)||!S_ISREG(before.st_mode)||before.st_uid!=0||(before.st_mode&0777)!=0600||before.st_nlink!=1||before.st_size<1||before.st_size>65536)goto done;
 raw=malloc((size_t)before.st_size+1);if(!raw)goto done;
 size_t used=0;while(used<(size_t)before.st_size){ssize_t n=read(fd,raw+used,(size_t)before.st_size-used);if(n<0&&errno==EINTR)continue;if(n<=0){free(raw);raw=NULL;goto done;}used+=(size_t)n;}
 char extra;if(read(fd,&extra,1)!=0||memchr(raw,0,used)||fstat(fd,&after)||before.st_dev!=after.st_dev||before.st_ino!=after.st_ino||before.st_size!=after.st_size||before.st_uid!=after.st_uid||before.st_mode!=after.st_mode||after.st_nlink!=1||before.st_mtim.tv_sec!=after.st_mtim.tv_sec||before.st_mtim.tv_nsec!=after.st_mtim.tv_nsec||before.st_ctim.tv_sec!=after.st_ctim.tv_sec||before.st_ctim.tv_nsec!=after.st_ctim.tv_nsec){free(raw);raw=NULL;goto done;}
 raw[used]=0;
 done:close(fd);return raw;
}
static int read_at(int fd,const char *name,char *out,size_t capacity){
 int file=openat(fd,name,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);if(file<0)return errno==ENOENT?0:-1;
 size_t used=0;while(used+1<capacity){ssize_t n=read(file,out+used,capacity-1-used);if(n<0&&errno==EINTR)continue;if(n<0){close(file);return -1;}if(!n)break;used+=(size_t)n;}
 char extra;int ok=read(file,&extra,1)==0;close(file);if(!ok||memchr(out,0,used))return -1;
 while(used&&isspace((unsigned char)out[used-1]))used--;
 out[used]=0;return 1;
}
static int write_at(int fd,const char *name,const char *text){
 int file=openat(fd,name,O_WRONLY|O_NOFOLLOW|O_CLOEXEC);if(file<0)return 0;
 size_t length=strlen(text);ssize_t n;do n=write(file,text,length);while(n<0&&errno==EINTR);int saved=errno;int closed=close(file);errno=saved;return n==(ssize_t)length&&closed==0;
}
static int same_fd(int fd,dev_t dev,ino_t ino){
 struct stat s;struct statfs fs;return fd>=0&&!fstat(fd,&s)&&S_ISDIR(s.st_mode)&&s.st_uid==0&&!(s.st_mode&022)&&s.st_dev==dev&&s.st_ino==ino&&!fstatfs(fd,&fs)&&(unsigned long)fs.f_type==CGROUP2_MAGIC;
}
static const char *leaf(const HfBudgetHandle *h){const char *p=strrchr(h->cgroup_path,'/');return p?p+1:"";}
static int pinned(const HfBudgetHandle *h,int child){
 if(!same_fd(h->root_fd,h->root_dev,h->root_ino))return 0;
 char parent[4096];snprintf(parent,sizeof parent,"%s",h->cgroup_path);char *slash=strrchr(parent,'/');if(!slash)return 0;*slash=0;
 int current=directory(*parent?parent:"/",0);int ok=same_fd(current,h->root_dev,h->root_ino);if(current>=0)close(current);if(!ok||!child)return ok;
 struct stat s;return same_fd(h->scope_fd,h->scope_dev,h->scope_ino)&&!fstatat(h->root_fd,leaf(h),&s,AT_SYMLINK_NOFOLLOW)&&s.st_dev==h->scope_dev&&s.st_ino==h->scope_ino;
}
static int word(const char *text,const char *wanted){
 size_t n=strlen(wanted);for(const char *p=text;*p;){while(isspace((unsigned char)*p))p++;const char *start=p;while(*p&&!isspace((unsigned char)*p))p++;if((size_t)(p-start)==n&&!memcmp(start,wanted,n))return 1;}return 0;
}
static int decode_mount(char *text){
 char *out=text;for(char *p=text;*p;p++){if(*p=='\\'){if(strlen(p)<4||p[1]<'0'||p[1]>'7'||p[2]<'0'||p[2]>'7'||p[3]<'0'||p[3]>'7')return 0;unsigned c=(unsigned)(p[1]-'0')*64U+(unsigned)(p[2]-'0')*8U+(unsigned)(p[3]-'0');if(c<32||c==127)return 0;*out++=(char)c;p+=3;}else *out++=*p;}*out=0;return 1;
}
static int beneath(const char *path,const char *parent){size_t n=strlen(parent);return !strcmp(parent,"/")?path[0]=='/':!strncmp(path,parent,n)&&(path[n]==0||path[n]=='/');}
static int mountpoint(const char *root,char output[4096]){
 FILE *file=fopen("/proc/self/mountinfo","re");if(!file)return 0;char *line=NULL;size_t cap=0,best=0;int ok=1;
 while(getline(&line,&cap,file)>=0){if(strlen(line)>65536){ok=0;break;}char *split=strstr(line," - cgroup2 ");if(!split)continue;*split=0;char mounted[4096],tree[4096];if(sscanf(line,"%*s %*s %*s %4095s %4095s",tree,mounted)!=2||!decode_mount(tree)||!decode_mount(mounted)||!beneath(root,mounted)){ok=0;break;}
  if(strlen(mounted)>best){snprintf(output,4096,"%s",mounted);best=strlen(mounted);}}
 if(ferror(file))ok=0;
 free(line);fclose(file);return ok&&best>0;
}
static int cpu_limit(const char *text,unsigned long long *quota,unsigned long long *period,int *finite){
 char a[32],b[32],extra;int n=sscanf(text,"%31s %31s %c",a,b,&extra);if(n!=2||!number(b,period)||!*period)return 0;*finite=strcmp(a,"max")!=0;return !*finite||number(a,quota);
}
static int remaining(const char *root,unsigned long long *cpu,unsigned long long *memory){
 cpu_set_t affinity;CPU_ZERO(&affinity);if(sched_getaffinity(0,sizeof affinity,&affinity)||CPU_COUNT(&affinity)<1)return 0;*cpu=(unsigned long long)CPU_COUNT(&affinity)*1000;
 FILE *mem=fopen("/proc/meminfo","re");if(!mem)return 0;char *line=NULL;size_t cap=0;unsigned long long available=0;int found=0;while(getline(&line,&cap,mem)>=0)if(sscanf(line,"MemAvailable: %llu kB",&available)==1&&!strncmp(line,"MemAvailable:",13)){found=1;break;}free(line);fclose(mem);if(!found||available>ULLONG_MAX/1024)return 0;*memory=available*1024;
 char mount[4096],current[4096];if(!mountpoint(root,mount))return 0;snprintf(current,sizeof current,"%s",root);
 for(unsigned depth=0;depth<128;depth++){int fd=directory(current,0);if(fd<0)return 0;char text[256],used[128];int cq=read_at(fd,"cpu.max",text,sizeof text);if(cq<0){close(fd);return 0;}if(cq){unsigned long long q=0,p=0;int finite=0;if(!cpu_limit(text,&q,&p,&finite)||(finite&&q>ULLONG_MAX/1000)){close(fd);return 0;}if(finite&&q*1000/p<*cpu)*cpu=q*1000/p;}
  int mm=read_at(fd,"memory.max",text,sizeof text);if(mm<0){close(fd);return 0;}if(mm&&strcmp(text,"max")){unsigned long long limit=0,usage=0;if(!number(text,&limit)||read_at(fd,"memory.current",used,sizeof used)!=1||!number(used,&usage)){close(fd);return 0;}unsigned long long free_bytes=limit>usage?limit-usage:0;if(free_bytes<*memory)*memory=free_bytes;}close(fd);
  if(!strcmp(current,mount))return 1;
  char *last=strrchr(current,'/');if(!last||!beneath(current,mount))return 0;if(last==current)last[1]=0;else *last=0;}
 return 0;
}
static int resources(const HfJson *j,int object,const char *name,unsigned long long out[3]){
 static const char *keys[]={"cpu_millis","memory_bytes","disk_bytes"};int t=hf_json_field(j,object,name);if(t<0||!hf_json_only(j,t,keys,3))return 0;for(int k=0;k<3;k++)if(!decimal_at(j,t,keys[k],&out[k]))return 0;return out[0]&&out[1];
}
static int parsed(HfBudgetHandle *h,const HfJson *config,const HfJson *wrapper,char root[4096]){
 const char *ck[]={"schema_version","backend","organisation_id","run_id","sandbox_id","boot_id","boot_generation","delegated_root","cpu_controller","memory_controller","slots","disk_quota"};
 const char *wk[]={"charge","boot_id","uid","gid"};
 const char *qk[]={"charge_id","generation","request_id","organisation_id","run_id","sandbox_id","sandbox_boot_generation","slot_id","attempt_id","job_kind","resources","usable_limits","qualification_id","evidence_digest"};
 int charge=hf_json_field(wrapper,0,"charge");int64_t version=0;char backend[32],controller[16],actual[128],expected[128],slot[37],kind[65],cfgboot[37];unsigned long long wanted_uid=0,wanted_gid=0,requested[3],usable[3],generation=0,bootgen=0;
 if(!hf_json_only(config,0,ck,12)||!hf_json_only(wrapper,0,wk,4)||!hf_json_only(wrapper,charge,qk,14)||!hf_json_i64(config,hf_json_field(config,0,"schema_version"),&version)||version!=1||!hf_json_get(config,"backend",backend,sizeof backend)||strcmp(backend,"cgroup-v2")||!hf_json_get(config,"cpu_controller",controller,sizeof controller)||strcmp(controller,"cpu")||!hf_json_get(config,"memory_controller",controller,sizeof controller)||strcmp(controller,"memory"))return 0;
 const char *fields[]={"organisation_id","run_id","sandbox_id"};for(int k=0;k<3;k++)if(!hf_json_get(config,fields[k],expected,sizeof expected)||!hf_uuid_valid(expected)||!string_at(wrapper,charge,fields[k],actual,sizeof actual)||strcmp(actual,expected))return 0;
 if(!hf_json_get(config,"boot_id",cfgboot,sizeof cfgboot)||!hf_uuid_valid(cfgboot)||!hf_json_get(wrapper,"boot_id",h->boot_id,sizeof h->boot_id)||strcmp(cfgboot,h->boot_id)||!hf_json_get(config,"boot_generation",expected,sizeof expected)||!number(expected,&bootgen)||!bootgen||!string_at(wrapper,charge,"sandbox_boot_generation",h->boot_generation,sizeof h->boot_generation)||strcmp(expected,h->boot_generation)||!string_at(wrapper,charge,"sandbox_id",h->sandbox_id,sizeof h->sandbox_id))return 0;
 if(!string_at(wrapper,charge,"charge_id",h->charge_id,sizeof h->charge_id)||!hf_uuid_valid(h->charge_id)||!string_at(wrapper,charge,"generation",h->charge_generation,sizeof h->charge_generation)||!number(h->charge_generation,&generation)||!generation||!string_at(wrapper,charge,"request_id",actual,sizeof actual)||!hf_uuid_valid(actual)||!string_at(wrapper,charge,"qualification_id",actual,sizeof actual)||!hf_uuid_valid(actual)||!string_at(wrapper,charge,"evidence_digest",h->evidence_digest,sizeof h->evidence_digest)||!digest(h->evidence_digest)||!string_at(wrapper,charge,"slot_id",slot,sizeof slot)||!hf_uuid_valid(slot)||!string_at(wrapper,charge,"job_kind",kind,sizeof kind)||!*kind)return 0;
 for(const char *p=kind;*p;p++)if(!(*p>='A'&&*p<='Z')&&*p!='_')return 0;
 int attempt=hf_json_field(wrapper,charge,"attempt_id");char *raw=hf_json_raw(wrapper,attempt);int valid=raw&&!strcmp(raw,"null");free(raw);if(!valid&&(!hf_json_string(wrapper,attempt,actual,sizeof actual)||!hf_uuid_valid(actual)))return 0;
 if(!uid_at(wrapper,0,"uid",&wanted_uid)||!uid_at(wrapper,0,"gid",&wanted_gid)||!resources(wrapper,charge,"resources",requested)||!resources(wrapper,charge,"usable_limits",usable))return 0;
 for(int k=0;k<3;k++)if(requested[k]>usable[k])return 0;
 int slots=hf_json_field(config,0,"slots"),matched=0;if(slots<0||config->tokens[slots].type!='['||config->tokens[slots].count<1||config->tokens[slots].count>1024)return 0;
 const char *sk[]={"slot_id","uid","gid"};for(int t=slots+1;t<config->tokens[slots].next;t=config->tokens[t].next){unsigned long long uid=0,gid=0;if(!hf_json_only(config,t,sk,3)||!string_at(config,t,"slot_id",actual,sizeof actual)||!hf_uuid_valid(actual)||!uid_at(config,t,"uid",&uid)||!uid_at(config,t,"gid",&gid))return 0;for(int prior=slots+1;prior<t;prior=config->tokens[prior].next){char previous[37];unsigned long long previous_uid=0;if(!string_at(config,prior,"slot_id",previous,sizeof previous)||!uid_at(config,prior,"uid",&previous_uid)||!strcmp(previous,actual)||previous_uid==uid)return 0;}if(!strcmp(actual,slot)){if(++matched!=1||uid!=wanted_uid||gid!=wanted_gid)return 0;}}
 if(matched!=1||!hf_json_get(config,"delegated_root",root,4096)||root[0]!='/')return 0;
 h->slot_uid=(uid_t)wanted_uid;h->slot_gid=(gid_t)wanted_gid;h->cpu_millis=requested[0];h->memory_bytes=requested[1];h->disk_bytes=requested[2];return 1;
}
static int swap_unavailable_safe(void);
int hf_budget_prepare(const char *config_path,const char *authenticated_charge_json,HfBudgetHandle *h){
 if(!h)return HF_BUDGET_ERROR;
 memset(h,0,sizeof *h);h->root_fd=h->scope_fd=-1;state(h,HF_BUDGET_ERROR,"INVALID_TRUSTED_BUDGET_INPUT");if(geteuid()!=0)return state(h,HF_BUDGET_UNAVAILABLE,"ROOT_PRIVILEGE_UNAVAILABLE");
 char *raw=config_read(config_path),root[4096];HfJson *config=malloc(sizeof *config),*charge=malloc(sizeof *charge);
 int ok=raw&&config&&charge&&authenticated_charge_json&&hf_json_parse(config,raw)&&hf_json_parse(charge,authenticated_charge_json)&&parsed(h,config,charge,root);
 if(!ok){free(raw);free(config);free(charge);return h->status;}
 int disk=hf_json_field(config,0,"disk_quota");char *quota=hf_json_raw(config,disk);int unsupported=!quota||strcmp(quota,"null");free(quota);free(raw);free(config);free(charge);
 if(unsupported)return state(h,HF_BUDGET_UNAVAILABLE,"DISK_QUOTA_BACKEND_UNSUPPORTED");
 HfProcessIdentity current;if(!hf_process_identity(getpid(),&current))return state(h,HF_BUDGET_UNAVAILABLE,"KERNEL_BOOT_UNAVAILABLE");snprintf(h->kernel_boot_id,sizeof h->kernel_boot_id,"%s",current.os_boot_id);
 h->root_fd=directory(root,0);struct stat s;struct statfs fs;
 if(h->root_fd<0||fstat(h->root_fd,&s)||fstatfs(h->root_fd,&fs)||(unsigned long)fs.f_type!=CGROUP2_MAGIC)return state(h,HF_BUDGET_UNAVAILABLE,"CGROUP_V2_DELEGATION_UNAVAILABLE");
 h->root_dev=s.st_dev;h->root_ino=s.st_ino;char text[256];
 if(read_at(h->root_fd,"cgroup.type",text,sizeof text)!=1||strcmp(text,"domain")||read_at(h->root_fd,"cgroup.subtree_control",text,sizeof text)!=1||!word(text,"cpu")||!word(text,"memory"))return state(h,HF_BUDGET_UNAVAILABLE,"CONTROLLERS_NOT_DELEGATED");
 char procs[65536];if(read_at(h->root_fd,"cgroup.procs",procs,sizeof procs)!=1||*procs)return state(h,HF_BUDGET_UNAVAILABLE,"DELEGATION_CONTAINS_CONTROL_PROCESSES");
 unsigned long long cpu=0,memory=0;if(!remaining(root,&cpu,&memory)||h->cpu_millis>cpu||h->memory_bytes>memory)return state(h,HF_BUDGET_UNAVAILABLE,"OBSERVED_HEADROOM_INSUFFICIENT");
 long page=sysconf(_SC_PAGESIZE);if(page<1||h->memory_bytes%(unsigned long long)page||h->cpu_millis>ULLONG_MAX/1000)return state(h,HF_BUDGET_UNAVAILABLE,"KERNEL_LIMIT_GRANULARITY_UNAVAILABLE");
 char name[128];int n=snprintf(name,sizeof name,"hf-%s-g%s",h->charge_id,h->charge_generation);if(n<0||(size_t)n>=sizeof name||snprintf(h->cgroup_path,sizeof h->cgroup_path,"%s/%s",root,name)>=(int)sizeof h->cgroup_path)return state(h,HF_BUDGET_ERROR,"BUDGET_SCOPE_PATH_INVALID");
 if(!same_fd(h->root_fd,h->root_dev,h->root_ino)||mkdirat(h->root_fd,name,0700))return state(h,HF_BUDGET_UNAVAILABLE,"FRESH_CGROUP_SCOPE_UNAVAILABLE");
 h->scope_fd=openat(h->root_fd,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(h->scope_fd<0||fstat(h->scope_fd,&s))return state(h,HF_BUDGET_ERROR,"CGROUP_SCOPE_OPEN_UNCERTAIN");h->scope_dev=s.st_dev;h->scope_ino=s.st_ino;
 if(!pinned(h,1))return state(h,HF_BUDGET_ERROR,"CGROUP_SCOPE_IDENTITY_CHANGED");
 char limit[128];snprintf(limit,sizeof limit,"%llu 1000000\n",h->cpu_millis*1000);if(!write_at(h->scope_fd,"cpu.max",limit)||read_at(h->scope_fd,"cpu.max",text,sizeof text)!=1)return state(h,HF_BUDGET_UNAVAILABLE,"CPU_LIMIT_UNAVAILABLE");
 unsigned long long q=0,p=0;int finite=0;h->cpu_enforced=cpu_limit(text,&q,&p,&finite)&&finite&&p==1000000&&q==h->cpu_millis*1000;if(!h->cpu_enforced)return state(h,HF_BUDGET_UNAVAILABLE,"CPU_LIMIT_READBACK_MISMATCH");
 snprintf(limit,sizeof limit,"%llu\n",h->memory_bytes);if(!pinned(h,1)||!write_at(h->scope_fd,"memory.max",limit)||read_at(h->scope_fd,"memory.max",text,sizeof text)!=1)return state(h,HF_BUDGET_UNAVAILABLE,"MEMORY_LIMIT_UNAVAILABLE");
 unsigned long long actual=0;h->memory_enforced=number(text,&actual)&&actual==h->memory_bytes;if(!h->memory_enforced)return state(h,HF_BUDGET_UNAVAILABLE,"MEMORY_LIMIT_READBACK_MISMATCH");
 int swap=read_at(h->scope_fd,"memory.swap.max",text,sizeof text);if(swap<0||(!swap&&!swap_unavailable_safe())||(swap&&(!write_at(h->scope_fd,"memory.swap.max","0\n")||read_at(h->scope_fd,"memory.swap.max",text,sizeof text)!=1||strcmp(text,"0"))))return state(h,HF_BUDGET_UNAVAILABLE,"SWAP_LIMIT_UNAVAILABLE");
 int oom=read_at(h->scope_fd,"memory.oom.group",text,sizeof text);if(oom<0||(oom==1&&(!write_at(h->scope_fd,"memory.oom.group","1\n")||read_at(h->scope_fd,"memory.oom.group",text,sizeof text)!=1||strcmp(text,"1"))))return state(h,HF_BUDGET_UNAVAILABLE,"OOM_GROUP_READBACK_UNAVAILABLE");
 if(h->disk_bytes)return state(h,HF_BUDGET_UNAVAILABLE,"DISK_QUOTA_UNAVAILABLE");
 return state(h,HF_BUDGET_READY,"KERNEL_LIMITS_VERIFIED");
}
static int swap_unavailable_safe(void){
 FILE *file=fopen("/proc/meminfo","re");if(!file)return 0;char *line=NULL;size_t cap=0;unsigned long long value=1;int found=0;
 while(getline(&line,&cap,file)>=0)if(!strncmp(line,"SwapTotal:",10)&&sscanf(line,"SwapTotal: %llu kB",&value)==1){found=1;break;}
 int ok=found&&!value&&!ferror(file);free(line);fclose(file);return ok;
}
static int limits_current(const HfBudgetHandle *h){
 char text[256];unsigned long long q=0,p=0,m=0;int finite=0;
 if(!pinned(h,1)||read_at(h->scope_fd,"cpu.max",text,sizeof text)!=1||!cpu_limit(text,&q,&p,&finite)||!finite||p!=1000000||q!=h->cpu_millis*1000)return 0;
 if(read_at(h->scope_fd,"memory.max",text,sizeof text)!=1||!number(text,&m)||m!=h->memory_bytes)return 0;
 int swap=read_at(h->scope_fd,"memory.swap.max",text,sizeof text);
 return (swap==0&&swap_unavailable_safe())||(swap==1&&!strcmp(text,"0"));
}
static int member(const HfBudgetHandle *h,pid_t pid){
 char text[65536];if(read_at(h->scope_fd,"cgroup.procs",text,sizeof text)!=1)return 0;char *save=NULL;for(char *p=strtok_r(text,"\n",&save);p;p=strtok_r(NULL,"\n",&save)){unsigned long long value=0;if(!number(p,&value))return 0;if(value==(unsigned long long)pid)return 1;}return 0;
}
static int process_credentials(pid_t pid,uid_t uid,gid_t gid){
 char path[128];snprintf(path,sizeof path,"/proc/%ld/status",(long)pid);
 FILE *file=fopen(path,"re");if(!file)return 0;
 char *line=NULL;size_t cap=0;int checked=0,ok=1;
 while(getline(&line,&cap,file)>=0){
  if(!strncmp(line,"Uid:",4)||!strncmp(line,"Gid:",4)){
   unsigned long a,b,c,d,wanted=line[0]=='U'?(unsigned long)uid:(unsigned long)gid;char extra;
   if(sscanf(line+4,"%lu %lu %lu %lu %c",&a,&b,&c,&d,&extra)!=4||a!=wanted||b!=wanted||c!=wanted||d!=wanted)ok=0;
   checked|=line[0]=='U'?1:2;
  }else if(!strncmp(line,"NoNewPrivs:",11)){
   unsigned value=0;char extra;if(sscanf(line+11,"%u %c",&value,&extra)!=1||value!=1)ok=0;checked|=16;
  }else if(!strncmp(line,"Groups:",7)){
   char *at=line+7;while(*at){while(isspace((unsigned char)*at))at++;if(!*at)break;errno=0;char *end=NULL;unsigned long group=strtoul(at,&end,10);if(errno||end==at||group!=(unsigned long)gid){ok=0;break;}at=end;}checked|=32;
  }else if(!strncmp(line,"CapEff:",7)||!strncmp(line,"CapPrm:",7)){
   unsigned long long caps=1;char extra;if(sscanf(line+7,"%llx %c",&caps,&extra)!=1||caps)ok=0;
   checked|=line[3]=='E'?4:8;
  }
 }
 if(ferror(file))ok=0;
 free(line);fclose(file);return ok&&checked==63;
}
static int quiescent(const HfBudgetHandle *h){
 char procs[65536],events[4096];
 if(!pinned(h,1)||read_at(h->scope_fd,"cgroup.procs",procs,sizeof procs)!=1||*procs||read_at(h->scope_fd,"cgroup.events",events,sizeof events)!=1)return 0;
 const char *at=strstr(events,"populated ");return at&&(at==events||at[-1]=='\n')&&at[10]=='0'&&(at[11]==0||at[11]=='\n');
}
int hf_budget_attach(HfBudgetHandle *h,const HfProcessIdentity *expected){
 if(!h||!expected)return HF_BUDGET_ERROR;
 if(h->status!=HF_BUDGET_READY||!limits_current(h))return state(h,HF_BUDGET_ERROR,"BUDGET_ATTACHMENT_NOT_ADMITTED");
 /* Sequential fixed phases share the charge only after the previous child
  * is absent and the complete owned cgroup is quiescent. PID reuse refuses. */
 if(h->child_attached){
  errno=0;if(kill(h->attached.pid,0)!=-1||errno!=ESRCH||!quiescent(h))return state(h,HF_BUDGET_ERROR,"PREVIOUS_PHASE_NOT_QUIESCENT");
  h->child_attached=0;memset(&h->attached,0,sizeof h->attached);
 }
 HfProcessIdentity actual,current;if(expected->pid<=1||expected->uid!=h->slot_uid||!hf_process_matches(expected,&actual)||actual.ppid!=getpid()||actual.uid!=h->slot_uid||!process_credentials(actual.pid,h->slot_uid,h->slot_gid)||!hf_process_identity(getpid(),&current)||strcmp(current.os_boot_id,h->kernel_boot_id)||strcmp(actual.os_boot_id,h->kernel_boot_id)||actual.state=='Z'||actual.state=='X')return state(h,HF_BUDGET_ERROR,"CHILD_KERNEL_IDENTITY_MISMATCH");
 char pid[32];snprintf(pid,sizeof pid,"%ld\n",(long)actual.pid);if(!write_at(h->scope_fd,"cgroup.procs",pid)||!pinned(h,1)||!hf_process_matches(expected,&actual)||!member(h,actual.pid))return state(h,HF_BUDGET_ERROR,"CHILD_CGROUP_ATTACHMENT_UNCERTAIN");
 h->attached=actual;h->child_attached=1;return state(h,HF_BUDGET_READY,"CHILD_CGROUP_VERIFIED");
}
int hf_budget_observe(const HfBudgetHandle *h,FILE *out){
 if(!h||!out)return HF_BUDGET_ERROR;
 int valid=h->scope_fd>=0&&pinned(h,1),cpu=0,memory=0,populated=-1;char text[65536];unsigned long long q=0,p=0,bytes=0;int finite=0;
 if(valid){cpu=read_at(h->scope_fd,"cpu.max",text,sizeof text)==1&&cpu_limit(text,&q,&p,&finite)&&finite&&p==1000000&&q==h->cpu_millis*1000;memory=read_at(h->scope_fd,"memory.max",text,sizeof text)==1&&number(text,&bytes)&&bytes==h->memory_bytes;if(read_at(h->scope_fd,"cgroup.events",text,sizeof text)==1){char *at=strstr(text,"populated ");if(at&&(at==text||at[-1]=='\n')&&(at[10]=='0'||at[10]=='1')&&(at[11]==0||at[11]=='\n'))populated=at[10]-'0';}}
 int observed=h->status;if(h->status==HF_BUDGET_READY&&(!valid||!cpu||!memory||!limits_current(h)))observed=HF_BUDGET_UNAVAILABLE;
 fprintf(out,"{\"schema_version\":1,\"status\":\"%s\",\"reason\":",observed==HF_BUDGET_READY?"READY":observed==HF_BUDGET_ERROR?"ERROR":"UNAVAILABLE");hf_json_write_string(out,h->reason);
 fprintf(out,",\"charge_id\":");hf_json_write_string(out,h->charge_id);fputs(",\"charge_generation\":",out);hf_json_write_string(out,h->charge_generation);fputs(",\"sandbox_id\":",out);hf_json_write_string(out,h->sandbox_id);fputs(",\"boot_id\":",out);hf_json_write_string(out,h->boot_id);fputs(",\"boot_generation\":",out);hf_json_write_string(out,h->boot_generation);fputs(",\"evidence_digest\":",out);hf_json_write_string(out,h->evidence_digest);
 fprintf(out,",\"cpu_enforced\":%s,\"memory_enforced\":%s,\"disk_enforced\":false,\"child_attached\":%s,\"group_populated\":",cpu?"true":"false",memory?"true":"false",h->child_attached?"true":"false");if(populated<0)fputs("null",out);else fputs(populated?"true":"false",out);
 fputs(",\"process\":",out);HfProcessIdentity actual;if(h->child_attached&&valid&&hf_process_matches(&h->attached,&actual)&&member(h,actual.pid))hf_process_json(out,&actual);else fputs("null",out);fputs(",\"authority\":\"NONE\",\"capacity_admitted\":false,\"cleanup_complete\":false}",out);return observed;
}
int hf_budget_release(HfBudgetHandle *h){
 if(!h)return HF_BUDGET_ERROR;
 if(h->scope_fd>=0){if(!pinned(h,1))return state(h,HF_BUDGET_ERROR,"CGROUP_RELEASE_IDENTITY_CHANGED");if(!quiescent(h))return state(h,HF_BUDGET_ERROR,"CGROUP_RELEASE_NOT_QUIESCENT");
  if(unlinkat(h->root_fd,leaf(h),AT_REMOVEDIR))return state(h,HF_BUDGET_ERROR,"CGROUP_RELEASE_UNCERTAIN");
  struct stat s;if(!fstatat(h->root_fd,leaf(h),&s,AT_SYMLINK_NOFOLLOW)||errno!=ENOENT)return state(h,HF_BUDGET_ERROR,"CGROUP_REMOVAL_UNCONFIRMED");close(h->scope_fd);h->scope_fd=-1;}
 if(h->scope_fd<0&&h->root_fd>=0&&*h->cgroup_path&&h->scope_ino==0){struct stat existing;if(!fstatat(h->root_fd,leaf(h),&existing,AT_SYMLINK_NOFOLLOW)||errno!=ENOENT)return state(h,HF_BUDGET_ERROR,"CGROUP_CREATION_CUSTODY_UNCERTAIN");}
 if(h->root_fd>=0){close(h->root_fd);h->root_fd=-1;}h->child_attached=0;h->cpu_enforced=h->memory_enforced=h->disk_enforced=0;state(h,HF_BUDGET_UNAVAILABLE,"CGROUP_RELEASED");return HF_BUDGET_READY;
}
