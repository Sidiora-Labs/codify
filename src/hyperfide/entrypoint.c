/* Trusted local launchers use only the packaged runtime beside the actual ELF. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <unistd.h>
#include <limits.h>
#include <sys/stat.h>
#include <errno.h>

static int launcher_error(const char *code) {
    fprintf(stderr,"{\"ok\":false,\"error\":{\"code\":\"%s\"},\"local_fallback\":false}\n",code);
    return 78;
}
static int ordinary_executable(const char *path,int executable) {
    struct stat st;
    return !lstat(path,&st)&&S_ISREG(st.st_mode)&&st.st_size>0&&
        (!executable||access(path,X_OK)==0);
}
int hf_entrypoint_dispatch(int argc,char **argv) {
    if(argc<2)return -1;
    const char *module=NULL;
    if(!strcmp(argv[1],"bootstrap"))module="bootstrap.js";
    else if(!strcmp(argv[1],"issue-watcher"))module="issue-watcher.js";
    else if(!strcmp(argv[1],"supervisory-host"))module="supervisory-host.js";
    else return -1;
    char root[PATH_MAX],executable[PATH_MAX],node[PATH_MAX],entry[PATH_MAX];
    const char *configured=getenv("HYPERFIDE_RELEASE_ROOT");
    if(configured){
        if(configured[0]!='/'||!realpath(configured,root))return launcher_error("RELEASE_ROOT_INVALID");
    }else{
        ssize_t n=readlink("/proc/self/exe",executable,sizeof executable-1);
        if(n<=0||n>=(ssize_t)sizeof executable-1)return launcher_error("RELEASE_ROOT_REQUIRED");
        executable[n]=0;
        char *slash=strrchr(executable,'/');if(!slash)return launcher_error("RELEASE_ROOT_REQUIRED");*slash=0;
        slash=strrchr(executable,'/');
        if(!slash||strcmp(slash+1,"bin"))return launcher_error("PACKAGED_RUNTIME_REQUIRED");
        *slash=0;if(!realpath(executable,root))return launcher_error("RELEASE_ROOT_INVALID");
    }
    int n=snprintf(node,sizeof node,"%s/runtime/node",root);
    int m=snprintf(entry,sizeof entry,"%s/services/dist/%s",root,module);
    if(n<0||m<0||n>=(int)sizeof node||m>=(int)sizeof entry||
       !ordinary_executable(node,1)||!ordinary_executable(entry,0))
        return launcher_error("PACKAGED_RUNTIME_UNAVAILABLE");
    char **args=calloc((size_t)argc+1,sizeof *args);
    if(!args)return launcher_error("RESOURCE_LIMIT");
    args[0]=node;args[1]=entry;
    for(int i=2;i<argc;i++)args[i]=argv[i];
    args[argc]=NULL;
    execv(node,args);
    free(args);return launcher_error("PACKAGED_RUNTIME_UNAVAILABLE");
}
int hf_component_entrypoint(const char *action,const char *request_json,FILE *output) {
    const unsigned char *p=(const unsigned char *)request_json;
    while(isspace(*p))p++;
    int valid=*p++=='{';while(valid&&isspace(*p))p++;
    valid=valid&&*p++=='}';while(valid&&isspace(*p))p++;
    valid=valid&&!*p;
    if(strcmp(action,"entrypoint.launchers.describe")||!valid){
        fputs("{\"ok\":false,\"error\":{\"code\":\"INVALID_REQUEST\"}}\n",output);return 1;
    }
    fputs("{\"ok\":true,\"canonical_command\":\"hyperfide\",\"compatibility_command\":\"cg\",\"launchers\":[\"bootstrap\",\"issue-watcher\",\"supervisory-host\"],\"runtime_resolution\":\"PACKAGED_RELEASE_ONLY\",\"path_fallback\":false,\"supervision_required\":true}\n",output);
    return 0;
}
