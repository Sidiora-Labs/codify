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
