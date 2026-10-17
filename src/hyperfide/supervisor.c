#define _GNU_SOURCE
#include "components.h"
#include "supervisor.h"
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <pwd.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/mount.h>
#include <sys/socket.h>
#include <sys/statvfs.h>
#include <netinet/in.h>
#include <sqlite3.h>
#include <curl/curl.h>
#include <openssl/crypto.h>
#include <openssl/opensslv.h>
/* Native link prerequisites: EVP *_ex/PureEd25519 and CURLOPT_PROTOCOLS_STR. */
#if OPENSSL_VERSION_NUMBER < 0x30000000L
#error "OpenSSL 3.0 or newer is required"
#endif
#if LIBCURL_VERSION_NUM < 0x075500
#error "libcurl 7.85 or newer is required"
#endif

int hf_process_identity(pid_t pid,HfProcessIdentity *identity) {
    if (pid<=0) return 0;
    char path[128],statline[8192],boot[128];
    snprintf(path,sizeof path,"/proc/%ld/stat",(long)pid);
    FILE *stream=fopen(path,"re");if (!stream) return 0;
    int valid=fgets(statline,sizeof statline,stream)!=NULL;fclose(stream);if (!valid) return 0;
    char *end=strrchr(statline,')');if (!end||end[1]!=' ') return 0;
    memset(identity,0,sizeof *identity);identity->pid=pid;
    char *save=NULL,*value=strtok_r(end+2," ",&save);int field=3;
    while (value) {
        if (field==3) identity->state=*value;
        else if (field==4) identity->ppid=(pid_t)strtol(value,NULL,10);
        else if (field==5) identity->pgid=(pid_t)strtol(value,NULL,10);
        else if (field==22) identity->start_time=strtoull(value,NULL,10);
        else if (field==23) identity->virtual_bytes=strtoull(value,NULL,10);
        else if (field==24) identity->resident_pages=strtol(value,NULL,10);
        value=strtok_r(NULL," ",&save);++field;
    }
    if (field<25||!identity->start_time) return 0;
    snprintf(path,sizeof path,"/proc/%ld/status",(long)pid);stream=fopen(path,"re");if (!stream) return 0;
    unsigned real_uid=0,effective_uid=0;valid=0;
    while (fgets(statline,sizeof statline,stream)) if (sscanf(statline,"Uid: %u %u",&real_uid,&effective_uid)==2) {identity->uid=(uid_t)effective_uid;valid=1;break;}
    fclose(stream);if (!valid) return 0;
    stream=fopen("/proc/sys/kernel/random/boot_id","re");if (!stream) return 0;
    valid=fgets(boot,sizeof boot,stream)!=NULL;fclose(stream);if (!valid) return 0;
    boot[strcspn(boot,"\r\n")]=0;if (!hf_uuid_valid(boot)) return 0;
    memcpy(identity->os_boot_id,boot,37);return 1;
}
int hf_process_matches(const HfProcessIdentity *expected,HfProcessIdentity *observed) {
    HfProcessIdentity current;if (!hf_process_identity(expected->pid,&current)) return 0;
    if (observed) *observed=current;
    return current.start_time==expected->start_time&&!strcmp(current.os_boot_id,expected->os_boot_id)&&current.uid==expected->uid&&current.pgid==expected->pgid;
}
void hf_process_json(FILE *out,const HfProcessIdentity *p) {
    fprintf(out,"{\"pid\":%ld,\"ppid\":%ld,\"pgid\":%ld,\"uid\":%lu,\"start_time\":\"%llu\",\"os_boot_id\":\"%s\",\"state\":\"%c\",\"virtual_bytes\":\"%llu\",\"resident_pages\":%ld}",(long)p->pid,(long)p->ppid,(long)p->pgid,(unsigned long)p->uid,p->start_time,p->os_boot_id,p->state,p->virtual_bytes,p->resident_pages);
}
int hf_supervisor_call(const char *path,int enrollment,const char *payload,const char *operation,const char *idempotency,const char *correlation,const char *causation,const char *seconds,const char *nonce,HfHttpResponse *response) {
    HfTransportConfig config;if (!hf_transport_config(path,&config)) return 0;
    char *body=hf_envelope(payload,operation,idempotency,correlation,causation);if (!body) return 0;
    int result=hf_transport_post(&config,enrollment,body,seconds,nonce,response);free(body);return result;
}
static int private_root(const char *path,int *fd) {
    if (!path||*path!='/') return 0;
    int current=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if (current<0) return 0;
    char *copy=strdup(path),*save=NULL;if (!copy) {close(current);return 0;}
    for (char *part=strtok_r(copy,"/",&save);part;part=strtok_r(NULL,"/",&save)) {
        if (!strcmp(part,".")||!strcmp(part,"..")) {close(current);free(copy);return 0;}
        int next=openat(current,part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(current);current=next;
        if (current<0) {free(copy);return 0;}
    }
    free(copy);struct stat st;
    if (fstat(current,&st)||st.st_uid!=geteuid()||(st.st_mode&022)) {close(current);return 0;}
    *fd=current;return 1;
}
static int placement_prepare(const char *,const char *,const char *);
/* Isolation profiles. Separate worktrees are never an OS boundary; shared-kernel
 * distinct UIDs separate ordinary jobs only. Credential-sensitive work requires a
 * dedicated VM boot that no other slot may share while it is active. */
typedef struct {const char *name,*boundary;int vm_level,accepts_credentials,exclusive;} SlotProfile;
static const SlotProfile slot_profiles[]={
    {"distinct_uid","shared-kernel-distinct-uid",0,0,0},
    {"vm_dedicated","dedicated-vm-boot",1,1,1},
};
static const SlotProfile *slot_profile(const char *name) {
    for (size_t i=0;i<sizeof slot_profiles/sizeof slot_profiles[0];++i) if (!strcmp(name,slot_profiles[i].name)) return &slot_profiles[i];
    return NULL;
}
static const char *const slot_directories[]={"worktree","build","home","tmp","sessions","logs"};
#define SLOT_DIRECTORY_COUNT (sizeof slot_directories/sizeof slot_directories[0])
#define SLOT_ACTIVE "('PREPARING','READY','CLEANUP_REQUIRED')"
static int kernel_boot(char output[37]) {
    FILE *stream=fopen("/proc/sys/kernel/random/boot_id","re");if (!stream) return 0;
    char line[128];int valid=fgets(line,sizeof line,stream)!=NULL;fclose(stream);
    if (!valid) return 0;
    line[strcspn(line,"\r\n")]=0;if (!hf_uuid_valid(line)) return 0;
    memcpy(output,line,37);return 1;
}
static int digest_valid(const char *value) {
    if (strlen(value)!=71||strncmp(value,"sha256:",7)) return 0;
    for (size_t i=7;i<71;++i) if (!((value[i]>='0'&&value[i]<='9')||(value[i]>='a'&&value[i]<='f'))) return 0;
    return 1;
}
/* Opens the root-private slot ledger, upgrading earlier ledgers additively so
 * other readers of slots(uid,gid,boot_id,state) keep their contract. */
static int slot_db_open(const char *root,int create,sqlite3 **db) {
    char path[4200];struct stat st;*db=NULL;
    snprintf(path,sizeof path,"%s/.supervisor-slots.db",root);
    if (lstat(path,&st)) {if (errno!=ENOENT||!create) return errno==ENOENT?-1:0;}
    else if (!S_ISREG(st.st_mode)||st.st_uid!=geteuid()||(st.st_mode&077)||st.st_nlink!=1) return 0;
    mode_t mask=umask(0077);
    int rc=sqlite3_open_v2(path,db,create?SQLITE_OPEN_READWRITE|SQLITE_OPEN_CREATE|SQLITE_OPEN_FULLMUTEX:SQLITE_OPEN_READWRITE|SQLITE_OPEN_FULLMUTEX,NULL);
    umask(mask);
    if (rc!=SQLITE_OK) {sqlite3_close(*db);*db=NULL;return 0;}
    sqlite3_busy_timeout(*db,5000);
    if (sqlite3_exec(*db,"PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;CREATE TABLE IF NOT EXISTS slots(id TEXT PRIMARY KEY,uid INTEGER NOT NULL,gid INTEGER NOT NULL,boot_id TEXT NOT NULL,preparation TEXT NOT NULL,port INTEGER NOT NULL,state TEXT NOT NULL,profile TEXT NOT NULL DEFAULT 'distinct_uid',credential_sensitive INTEGER NOT NULL DEFAULT 0,kernel_boot_id TEXT NOT NULL DEFAULT '',storage_bytes INTEGER NOT NULL DEFAULT 0);",NULL,NULL,NULL)!=SQLITE_OK) {sqlite3_close(*db);*db=NULL;return 0;}
    sqlite3_stmt *probe=NULL;
    if (sqlite3_prepare_v2(*db,"SELECT profile,credential_sensitive,kernel_boot_id,storage_bytes FROM slots LIMIT 0",-1,&probe,NULL)!=SQLITE_OK) {
        sqlite3_finalize(probe);probe=NULL;
        const char *columns[]={"profile TEXT NOT NULL DEFAULT 'distinct_uid'","credential_sensitive INTEGER NOT NULL DEFAULT 0","kernel_boot_id TEXT NOT NULL DEFAULT ''","storage_bytes INTEGER NOT NULL DEFAULT 0"};
        for (unsigned i=0;i<4;++i) {char sql[256];snprintf(sql,sizeof sql,"ALTER TABLE slots ADD COLUMN %s",columns[i]);sqlite3_exec(*db,sql,NULL,NULL,NULL);}
        if (sqlite3_prepare_v2(*db,"SELECT profile,credential_sensitive,kernel_boot_id,storage_bytes FROM slots LIMIT 0",-1,&probe,NULL)!=SQLITE_OK) {sqlite3_finalize(probe);sqlite3_close(*db);*db=NULL;return 0;}
    }
    sqlite3_finalize(probe);
    if (sqlite3_exec(*db,"CREATE UNIQUE INDEX IF NOT EXISTS slots_active_uid ON slots(uid) WHERE state IN " SLOT_ACTIVE ";CREATE UNIQUE INDEX IF NOT EXISTS slots_active_port ON slots(port) WHERE state IN " SLOT_ACTIVE ";",NULL,NULL,NULL)!=SQLITE_OK) {sqlite3_close(*db);*db=NULL;return 0;}
    return 1;
}
static void slot_entry(FILE *out,sqlite3_stmt *row) {
    /* Columns: id,uid,gid,port,profile,credential_sensitive,storage_bytes,kernel_boot_id,state */
    const SlotProfile *profile=slot_profile((const char *)sqlite3_column_text(row,4));
    long long storage=sqlite3_column_int64(row,6);
    fputs("{\"slot_id\":",out);hf_json_write_string(out,(const char *)sqlite3_column_text(row,0));
    fputs(",\"state\":",out);hf_json_write_string(out,(const char *)sqlite3_column_text(row,8));
    fprintf(out,",\"uid\":%lld,\"gid\":%lld,\"port\":%d,\"isolation_profile\":",(long long)sqlite3_column_int64(row,1),(long long)sqlite3_column_int64(row,2),sqlite3_column_int(row,3));
    hf_json_write_string(out,profile?profile->name:"unqualified");
    fputs(",\"isolation_boundary\":",out);hf_json_write_string(out,profile?profile->boundary:"none");
    fprintf(out,",\"vm_level_isolation\":%s,\"worktree_is_security_boundary\":false,\"credential_sensitive\":%s,\"storage\":\"%s\",\"storage_quota_bytes\":%lld,\"os_boot_id\":",profile&&profile->vm_level?"true":"false",sqlite3_column_int(row,5)?"true":"false",storage>0?"dedicated-tmpfs":"shared-filesystem",storage);
    hf_json_write_string(out,(const char *)sqlite3_column_text(row,7));fputc('}',out);
}
/* Registered inventory is derived only from the slot ledger: READY slots of this
 * sandbox boot, prepared by this preparation, on the current kernel boot. */
int hf_slot_inventory(const char *root,const char *boot_id,const char *preparation,char **json,size_t *length) {
    char kernel[37];*json=NULL;*length=0;
    if (!root||*root!='/'||!hf_uuid_valid(boot_id)||!digest_valid(preparation)||!kernel_boot(kernel)) return 0;
    int rootfd;if (!private_root(root,&rootfd)) return 0;
    close(rootfd);
    sqlite3 *db=NULL;int opened=slot_db_open(root,0,&db);
    FILE *out=open_memstream(json,length);if (!out) {sqlite3_close(db);return 0;}
    int valid=opened!=0;fputc('[',out);
    if (opened==1) {
        sqlite3_stmt *row=NULL;
        valid=sqlite3_prepare_v2(db,"SELECT id,uid,gid,port,profile,credential_sensitive,storage_bytes,kernel_boot_id,state FROM slots WHERE state='READY' AND boot_id=? AND preparation=? AND kernel_boot_id=? ORDER BY id",-1,&row,NULL)==SQLITE_OK;
        if (valid) {sqlite3_bind_text(row,1,boot_id,-1,SQLITE_STATIC);sqlite3_bind_text(row,2,preparation,-1,SQLITE_STATIC);sqlite3_bind_text(row,3,kernel,-1,SQLITE_STATIC);}
        int step=SQLITE_DONE,count=0; /* initialised: the loop guard may skip sqlite3_step when the statement failed to prepare */
        while (valid&&(step=sqlite3_step(row))==SQLITE_ROW) {if (count++) fputc(',',out);if (count>256) valid=0;else slot_entry(out,row);}
        if (valid&&step!=SQLITE_DONE) valid=0;
        sqlite3_finalize(row);
    }
    sqlite3_close(db);fputc(']',out);
    if (fclose(out)||!valid) {free(*json);*json=NULL;*length=0;return 0;}
    return 1;
}
static int uid_has_processes(uid_t uid) {
    DIR *proc=opendir("/proc");if (!proc) return -1;
    struct dirent *entry;int found=0;
    while (!found&&(entry=readdir(proc))) {
        char *end=NULL;long pid=strtol(entry->d_name,&end,10);
        if (pid<=0||*end) continue;
        struct stat st;if (!fstatat(dirfd(proc),entry->d_name,&st,0)&&st.st_uid==uid) found=1;
    }
    closedir(proc);return found;
}
static void slot_result(FILE *out,const char *root,const char *slot,const char *boot,const char *kernel,long long uid,long long gid,int port,const SlotProfile *profile,int sensitive,long long storage,int replayed) {
    fputs("{\"slot_id\":",out);hf_json_write_string(out,slot);
    fputs(",\"boot_id\":",out);hf_json_write_string(out,boot);
    fputs(",\"os_boot_id\":",out);hf_json_write_string(out,kernel);
    fprintf(out,",\"uid\":%lld,\"gid\":%lld,\"port\":%d,\"isolation\":\"%s\",\"isolation_profile\":\"%s\",\"isolation_boundary\":\"%s\",\"vm_level_isolation\":%s,\"worktree_is_security_boundary\":false,\"credential_sensitive\":%s,\"storage\":{\"kind\":\"%s\",\"quota_bytes\":%lld},\"cache_policy\":\"per-slot-private\",\"port_reservation\":\"logical-bind-rechecked-at-launch\",\"replayed\":%s,\"paths\":{",uid,gid,port,profile->name,profile->name,profile->boundary,profile->vm_level?"true":"false",sensitive?"true":"false",storage>0?"dedicated-tmpfs":"shared-filesystem",storage,replayed?"true":"false");
    char path[4300];
    for (unsigned i=0;i<SLOT_DIRECTORY_COUNT;++i) {if (i) fputc(',',out);hf_json_write_string(out,slot_directories[i]);fputc(':',out);snprintf(path,sizeof path,"%s/%s/%s",root,slot,slot_directories[i]);hf_json_write_string(out,path);}
    /* Default tool locations all resolve inside the slot so colliding defaults stay separate. */
    const char *variables[][2]={{"HOME","home"},{"TMPDIR","tmp"},{"TMP","tmp"},{"TEMP","tmp"},{"XDG_CACHE_HOME","home/.cache"},{"XDG_CONFIG_HOME","home/.config"},{"XDG_DATA_HOME","home/.local/share"},{"XDG_STATE_HOME","home/.local/state"},{"HF_SLOT_WORKTREE","worktree"},{"HF_SLOT_BUILD","build"}};
    fputs("},\"environment\":{",out);
    for (unsigned i=0;i<sizeof variables/sizeof variables[0];++i) {if (i) fputc(',',out);hf_json_write_string(out,variables[i][0]);fputc(':',out);snprintf(path,sizeof path,"%s/%s/%s",root,slot,variables[i][1]);hf_json_write_string(out,path);}
    fputs(",\"HF_SLOT_ID\":",out);hf_json_write_string(out,slot);fprintf(out,",\"HF_SLOT_PORT\":\"%d\"}}",port);
}
static int slot_allocate(const HfJson *json,FILE *out) {
    const char *keys[]={"root","slot_id","uid","gid","isolation_profile","credential_sensitive","boot_id","preparation_digest","config_path","run_id","boot_generation","storage_bytes"};
    char config[4096],run_id[37],generation[32],kernel[37];
    char root[4096],slot[37],profile_name[64],boot[37],preparation[72];int64_t uid=0,gid=0,storage=0;int sensitive=0;
    if (!hf_json_only(json,0,keys,12)||!hf_json_get(json,"config_path",config,sizeof config)||!hf_json_get(json,"run_id",run_id,sizeof run_id)||!hf_uuid_valid(run_id)||!hf_json_get(json,"boot_generation",generation,sizeof generation)||!hf_json_get(json,"root",root,sizeof root)||!hf_json_get(json,"slot_id",slot,sizeof slot)||!hf_uuid_valid(slot)||!hf_json_get(json,"isolation_profile",profile_name,sizeof profile_name)||!hf_json_get(json,"boot_id",boot,sizeof boot)||!hf_uuid_valid(boot)||!hf_json_get(json,"preparation_digest",preparation,sizeof preparation)||!hf_json_i64(json,hf_json_field(json,0,"uid"),&uid)||!hf_json_i64(json,hf_json_field(json,0,"gid"),&gid)||uid<=0||uid>UINT32_MAX-1||gid<=0||gid>UINT32_MAX-1||!hf_json_bool(json,hf_json_field(json,0,"credential_sensitive"),&sensitive)||geteuid()!=0||(uid_t)uid==geteuid()) return hf_native_error(out,"UNQUALIFIED_SLOT_PROFILE");
    if (hf_json_field(json,0,"storage_bytes")>=0&&(!hf_json_i64(json,hf_json_field(json,0,"storage_bytes"),&storage)||storage<1048576||storage>68719476736LL)) return hf_native_error(out,"INVALID_SLOT_STORAGE_QUOTA");
    if (!strcmp(profile_name,"worktree_only")) return hf_native_error(out,"WORKTREE_IS_NOT_AN_OS_BOUNDARY");
    const SlotProfile *profile=slot_profile(profile_name);
    if (!profile) return hf_native_error(out,"UNQUALIFIED_SLOT_PROFILE");
    if (sensitive&&!profile->accepts_credentials) return hf_native_error(out,"CREDENTIAL_SENSITIVE_REQUIRES_VM_BOUNDARY");
    if (!digest_valid(preparation)) return hf_native_error(out,"INVALID_PREPARATION_DIGEST");
    if (!kernel_boot(kernel)) return hf_native_error(out,"KERNEL_BOOT_IDENTITY_UNAVAILABLE");
    if (!getpwuid((uid_t)uid)||!getgrgid((gid_t)gid)) return hf_native_error(out,"UNKNOWN_SLOT_OS_PRINCIPAL");
    if (!placement_prepare(config,run_id,generation)) return hf_native_error(out,"PLACEMENT_AUTHORITY_UNAVAILABLE_OR_DENIED");
    int rootfd;if (!private_root(root,&rootfd)) return hf_native_error(out,"UNTRUSTED_SLOT_ROOT");
    struct stat rootstat;
    if (fstat(rootfd,&rootstat)||!(rootstat.st_mode&S_IXOTH)) {close(rootfd);return hf_native_error(out,"SLOT_ROOT_NOT_TRAVERSABLE");}
    sqlite3 *db=NULL;int opened=slot_db_open(root,1,&db);
    if (opened!=1) {close(rootfd);return hf_native_error(out,opened?"SLOT_DATABASE_UNAVAILABLE":"UNTRUSTED_SLOT_DATABASE");}
    sqlite3_stmt *statement=NULL;
    int rc=sqlite3_exec(db,"BEGIN IMMEDIATE",NULL,NULL,NULL);
    if (rc==SQLITE_OK) rc=sqlite3_prepare_v2(db,"SELECT uid,gid,boot_id,preparation,port,state,profile,credential_sensitive,storage_bytes,kernel_boot_id FROM slots WHERE id=?",-1,&statement,NULL);
    if (rc!=SQLITE_OK) {sqlite3_close(db);close(rootfd);return hf_native_error(out,"SLOT_DATABASE_UNAVAILABLE");}
    sqlite3_bind_text(statement,1,slot,-1,SQLITE_STATIC);int step=sqlite3_step(statement);int port=0;
    if (step==SQLITE_ROW) {
        int same=sqlite3_column_int64(statement,0)==uid&&sqlite3_column_int64(statement,1)==gid&&!strcmp((const char *)sqlite3_column_text(statement,2),boot)&&!strcmp((const char *)sqlite3_column_text(statement,3),preparation)&&!strcmp((const char *)sqlite3_column_text(statement,5),"READY")&&!strcmp((const char *)sqlite3_column_text(statement,6),profile->name)&&sqlite3_column_int(statement,7)==sensitive&&sqlite3_column_int64(statement,8)==storage&&!strcmp((const char *)sqlite3_column_text(statement,9),kernel);
        port=sqlite3_column_int(statement,4);sqlite3_finalize(statement);
        sqlite3_exec(db,"ROLLBACK",NULL,NULL,NULL);sqlite3_close(db);close(rootfd);
        if (!same) return hf_native_error(out,"SLOT_IDEMPOTENCY_OR_RECOVERY_CONFLICT");
        slot_result(out,root,slot,boot,kernel,uid,gid,port,profile,sensitive,storage,1);return 0;
    }
    sqlite3_finalize(statement);statement=NULL;
    /* Slots from an earlier kernel boot cannot hold live processes or mounts. */
    rc=sqlite3_prepare_v2(db,"UPDATE slots SET state='STALE_BOOT' WHERE state IN " SLOT_ACTIVE " AND kernel_boot_id<>?",-1,&statement,NULL);
    if (rc==SQLITE_OK) {sqlite3_bind_text(statement,1,kernel,-1,SQLITE_STATIC);rc=sqlite3_step(statement)==SQLITE_DONE?SQLITE_OK:SQLITE_ERROR;}
    sqlite3_finalize(statement);statement=NULL;
    int active=0,exclusive=0;
    if (rc==SQLITE_OK) rc=sqlite3_prepare_v2(db,"SELECT profile,credential_sensitive FROM slots WHERE state IN " SLOT_ACTIVE,-1,&statement,NULL);
    while (rc==SQLITE_OK&&(step=sqlite3_step(statement))==SQLITE_ROW) {
        const SlotProfile *other=slot_profile((const char *)sqlite3_column_text(statement,0));
        ++active;if (!other||other->exclusive||sqlite3_column_int(statement,1)) exclusive=1;
    }
    if (rc==SQLITE_OK&&step!=SQLITE_DONE) rc=SQLITE_ERROR;
    sqlite3_finalize(statement);statement=NULL;
    if (rc!=SQLITE_OK) {sqlite3_exec(db,"ROLLBACK",NULL,NULL,NULL);sqlite3_close(db);close(rootfd);return hf_native_error(out,"SLOT_DATABASE_UNAVAILABLE");}
    if (exclusive||(active&&(profile->exclusive||sensitive))) {sqlite3_exec(db,"ROLLBACK",NULL,NULL,NULL);sqlite3_close(db);close(rootfd);return hf_native_error(out,"UNSAFE_COLOCATION_REFUSED");}
    int sock=socket(AF_INET,SOCK_STREAM|SOCK_CLOEXEC,0);struct sockaddr_in address={.sin_family=AF_INET,.sin_addr.s_addr=htonl(INADDR_LOOPBACK),.sin_port=0};socklen_t address_length=sizeof address;
    if (sock<0||bind(sock,(struct sockaddr *)&address,sizeof address)||getsockname(sock,(struct sockaddr *)&address,&address_length)) {if (sock>=0) close(sock);sqlite3_exec(db,"ROLLBACK",NULL,NULL,NULL);sqlite3_close(db);close(rootfd);return hf_native_error(out,"PORT_UNAVAILABLE");}
    port=ntohs(address.sin_port);
    rc=sqlite3_prepare_v2(db,"INSERT INTO slots(id,uid,gid,boot_id,preparation,port,state,profile,credential_sensitive,kernel_boot_id,storage_bytes) VALUES(?,?,?,?,?,?,'PREPARING',?,?,?,?)",-1,&statement,NULL);
    if (rc==SQLITE_OK) {sqlite3_bind_text(statement,1,slot,-1,SQLITE_STATIC);sqlite3_bind_int64(statement,2,uid);sqlite3_bind_int64(statement,3,gid);sqlite3_bind_text(statement,4,boot,-1,SQLITE_STATIC);sqlite3_bind_text(statement,5,preparation,-1,SQLITE_STATIC);sqlite3_bind_int(statement,6,port);sqlite3_bind_text(statement,7,profile->name,-1,SQLITE_STATIC);sqlite3_bind_int(statement,8,sensitive);sqlite3_bind_text(statement,9,kernel,-1,SQLITE_STATIC);sqlite3_bind_int64(statement,10,storage);rc=sqlite3_step(statement);}
    sqlite3_finalize(statement);
    if (rc!=SQLITE_DONE||sqlite3_exec(db,"COMMIT",NULL,NULL,NULL)!=SQLITE_OK) {close(sock);sqlite3_exec(db,"ROLLBACK",NULL,NULL,NULL);sqlite3_close(db);close(rootfd);return hf_native_error(out,"SLOT_RESOURCE_CONFLICT");}
    int valid=mkdirat(rootfd,slot,0700)==0;
    if (valid&&storage>0) {
        /* A dedicated bounded filesystem keeps one slot's exhaustion away from others. */
        int base=openat(rootfd,slot,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);char target[64],options[256];
        snprintf(target,sizeof target,"/proc/self/fd/%d",base);
        snprintf(options,sizeof options,"size=%lld,nr_inodes=%lld,mode=0700,uid=%lld,gid=%lld",(long long)storage,(long long)(storage/4096+1024),(long long)uid,(long long)gid);
        if (base<0||mount("tmpfs",target,"tmpfs",MS_NOSUID|MS_NODEV,options)) valid=0;
        if (base>=0) close(base);
    }
    int dir=valid?openat(rootfd,slot,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC):-1;
    if (dir<0) valid=0;
    if (valid&&(fchown(dir,(uid_t)uid,(gid_t)gid)||fchmod(dir,0700))) valid=0;
    for (unsigned i=0;valid&&i<SLOT_DIRECTORY_COUNT;++i) {
        if (mkdirat(dir,slot_directories[i],0700)) {valid=0;break;}
        int child=openat(dir,slot_directories[i],O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
        if (child<0||fchown(child,(uid_t)uid,(gid_t)gid)) valid=0;
        if (child>=0) close(child);
    }
    if (dir>=0) {if (fsync(dir)) valid=0;close(dir);}
    if (fsync(rootfd)) valid=0;
    rc=sqlite3_prepare_v2(db,"UPDATE slots SET state=? WHERE id=?",-1,&statement,NULL);
    if (rc==SQLITE_OK) {sqlite3_bind_text(statement,1,valid?"READY":"CLEANUP_REQUIRED",-1,SQLITE_STATIC);sqlite3_bind_text(statement,2,slot,-1,SQLITE_STATIC);rc=sqlite3_step(statement);}
    sqlite3_finalize(statement);sqlite3_close(db);close(rootfd);close(sock);
    if (!valid||rc!=SQLITE_DONE) return hf_native_error(out,"SLOT_PREPARATION_CLEANUP_REQUIRED");
    slot_result(out,root,slot,boot,kernel,uid,gid,port,profile,sensitive,storage,0);return 0;
}
static int slot_release(const HfJson *json,FILE *out) {
    const char *keys[]={"root","slot_id"};char root[4096],slot[37];
    if (!hf_json_only(json,0,keys,2)||!hf_json_get(json,"root",root,sizeof root)||!hf_json_get(json,"slot_id",slot,sizeof slot)||!hf_uuid_valid(slot)||geteuid()!=0) return hf_native_error(out,"INVALID_SLOT_RELEASE");
    int rootfd;if (!private_root(root,&rootfd)) return hf_native_error(out,"UNTRUSTED_SLOT_ROOT");
    sqlite3 *db=NULL;int opened=slot_db_open(root,0,&db);
    if (opened!=1) {close(rootfd);return hf_native_error(out,"SLOT_DATABASE_UNAVAILABLE");}
    sqlite3_stmt *statement=NULL;int rc=sqlite3_exec(db,"BEGIN IMMEDIATE",NULL,NULL,NULL);
    if (rc==SQLITE_OK) rc=sqlite3_prepare_v2(db,"SELECT uid,state,storage_bytes FROM slots WHERE id=?",-1,&statement,NULL);
    if (rc!=SQLITE_OK) {sqlite3_close(db);close(rootfd);return hf_native_error(out,"SLOT_DATABASE_UNAVAILABLE");}
    sqlite3_bind_text(statement,1,slot,-1,SQLITE_STATIC);
    if (sqlite3_step(statement)!=SQLITE_ROW) {sqlite3_finalize(statement);sqlite3_exec(db,"ROLLBACK",NULL,NULL,NULL);sqlite3_close(db);close(rootfd);return hf_native_error(out,"UNKNOWN_SLOT");}
    uid_t uid=(uid_t)sqlite3_column_int64(statement,0);long long storage=sqlite3_column_int64(statement,2);char state[32];
    snprintf(state,sizeof state,"%s",(const char *)sqlite3_column_text(statement,1));sqlite3_finalize(statement);statement=NULL;
    if (!strcmp(state,"RELEASED")) {sqlite3_exec(db,"ROLLBACK",NULL,NULL,NULL);sqlite3_close(db);close(rootfd);fputs("{\"slot_id\":",out);hf_json_write_string(out,slot);fputs(",\"released\":true,\"replayed\":true}",out);return 0;}
    if (strcmp(state,"READY")&&strcmp(state,"CLEANUP_REQUIRED")&&strcmp(state,"STALE_BOOT")) {sqlite3_exec(db,"ROLLBACK",NULL,NULL,NULL);sqlite3_close(db);close(rootfd);return hf_native_error(out,"SLOT_NOT_RELEASABLE");}
    if (uid_has_processes(uid)) {sqlite3_exec(db,"ROLLBACK",NULL,NULL,NULL);sqlite3_close(db);close(rootfd);return hf_native_error(out,"SLOT_PROCESSES_ACTIVE");}
    int valid=1;char path[4200];snprintf(path,sizeof path,"%s/%s",root,slot);
    if (storage>0&&strcmp(state,"STALE_BOOT")&&umount2(path,MNT_DETACH|UMOUNT_NOFOLLOW)&&errno!=EINVAL) valid=0;
    int dir=valid?openat(rootfd,slot,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC):-1;
    /* Residual shared-filesystem contents become root-only until scrubbed. */
    if (dir<0&&errno!=ENOENT) valid=0;
    if (dir>=0) {if (fchown(dir,0,0)||fchmod(dir,0700)||fsync(dir)) valid=0;close(dir);}
    close(rootfd);
    if (valid) {
        rc=sqlite3_prepare_v2(db,"UPDATE slots SET state='RELEASED' WHERE id=?",-1,&statement,NULL);
        if (rc==SQLITE_OK) {sqlite3_bind_text(statement,1,slot,-1,SQLITE_STATIC);rc=sqlite3_step(statement);}
        sqlite3_finalize(statement);
        valid=rc==SQLITE_DONE&&sqlite3_exec(db,"COMMIT",NULL,NULL,NULL)==SQLITE_OK;
    }
    if (!valid) sqlite3_exec(db,"ROLLBACK",NULL,NULL,NULL);
    sqlite3_close(db);
    if (!valid) return hf_native_error(out,"SLOT_RELEASE_CLEANUP_REQUIRED");
    fputs("{\"slot_id\":",out);hf_json_write_string(out,slot);
    fprintf(out,",\"released\":true,\"replayed\":false,\"storage_discarded\":%s,\"residual_contents\":\"%s\"}",storage>0?"true":"false",storage>0?"none":"root-quarantined");
    return 0;
}
static int slot_inventory_action(const HfJson *json,FILE *out) {
    const char *keys[]={"root","boot_id","preparation_digest"};char root[4096],boot[37],preparation[72],kernel[37];
    if (!hf_json_only(json,0,keys,3)||!hf_json_get(json,"root",root,sizeof root)||!hf_json_get(json,"boot_id",boot,sizeof boot)||!hf_json_get(json,"preparation_digest",preparation,sizeof preparation)||!kernel_boot(kernel)) return hf_native_error(out,"INVALID_SLOT_INVENTORY_REQUEST");
    char *inventory=NULL;size_t length=0;
    if (!hf_slot_inventory(root,boot,preparation,&inventory,&length)) return hf_native_error(out,"SLOT_INVENTORY_UNAVAILABLE");
    fputs("{\"boot_id\":",out);hf_json_write_string(out,boot);fputs(",\"os_boot_id\":",out);hf_json_write_string(out,kernel);
    fputs(",\"preparation_digest\":",out);hf_json_write_string(out,preparation);fputs(",\"inventory\":",out);fputs(inventory,out);
    /* Pressure is advisory and dynamic, so it is never part of registered bytes. */
    unsigned long long available=0;FILE *meminfo=fopen("/proc/meminfo","re");char line[256];
    while (meminfo&&fgets(line,sizeof line,meminfo)) if (sscanf(line,"MemAvailable: %llu kB",&available)==1) {available*=1024ULL;break;}
    if (meminfo) fclose(meminfo);
    fprintf(out,",\"pressure\":{\"memory_available_bytes\":%llu,\"slots\":[",available);
    HfJson *parsed=malloc(sizeof *parsed);int first=1;char *wrapped=NULL;
    if (parsed&&asprintf(&wrapped,"{\"inventory\":%s}",inventory)>0&&hf_json_parse(parsed,wrapped)) {
        int array=hf_json_field(parsed,0,"inventory");
        for (int item=array+1;array>0&&item<parsed->count;++item) {
            if (parsed->tokens[item].parent!=array) continue;
            char id[37],path[4200];struct statvfs fs;
            if (!hf_json_string(parsed,hf_json_field(parsed,item,"slot_id"),id,sizeof id)) continue;
            snprintf(path,sizeof path,"%s/%s",root,id);
            if (statvfs(path,&fs)) continue;
            if (!first) fputc(',',out);
            first=0;
            fputs("{\"slot_id\":",out);hf_json_write_string(out,id);
            fprintf(out,",\"total_bytes\":%llu,\"free_bytes\":%llu,\"used_bytes\":%llu,\"free_inodes\":%llu}",(unsigned long long)fs.f_blocks*fs.f_frsize,(unsigned long long)fs.f_bavail*fs.f_frsize,(unsigned long long)(fs.f_blocks-fs.f_bfree)*fs.f_frsize,(unsigned long long)fs.f_favail);
        }
    }
    free(parsed);free(wrapped);free(inventory);fputs("]}}",out);return 0;
}
static int request_action(const char *action,const HfJson *json,FILE *out) {
    const char *keys[]={"config_path","payload_json","operation_id","idempotency_key","correlation_id","causation_id","seconds","nonce"};
    char config[4096],operation[37],idempotency[37],correlation[37],causation[37],seconds[32],nonce[37];
    if (!hf_json_only(json,0,keys,8)||!hf_json_get(json,"config_path",config,sizeof config)||!hf_json_get(json,"operation_id",operation,sizeof operation)||!hf_json_get(json,"idempotency_key",idempotency,sizeof idempotency)||!hf_json_get(json,"correlation_id",correlation,sizeof correlation)) return hf_native_error(out,"INVALID_TRANSPORT_REQUEST");
    int token=hf_json_field(json,0,"payload_json");size_t cap=token>=0?json->tokens[token].end-json->tokens[token].start+1:0;
    char *payload=cap?malloc(cap):NULL;
    if (!payload||!hf_json_string(json,token,payload,cap)) {free(payload);return hf_native_error(out,"INVALID_PAYLOAD_JSON");}
    const char *cause=NULL,*request_seconds=NULL,*request_nonce=NULL;
    if (hf_json_field(json,0,"causation_id")>=0) {char *raw=hf_json_raw(json,hf_json_field(json,0,"causation_id"));if (raw&&strcmp(raw,"null")) {if (!hf_json_get(json,"causation_id",causation,sizeof causation)) {free(raw);free(payload);return hf_native_error(out,"INVALID_CAUSATION");}cause=causation;}free(raw);}
    if (hf_json_field(json,0,"seconds")>=0) {if (!hf_json_get(json,"seconds",seconds,sizeof seconds)) {free(payload);return hf_native_error(out,"INVALID_REQUEST_TIME");}request_seconds=seconds;}
    if (hf_json_field(json,0,"nonce")>=0) {if (!hf_json_get(json,"nonce",nonce,sizeof nonce)) {free(payload);return hf_native_error(out,"INVALID_REQUEST_NONCE");}request_nonce=nonce;}
    HfHttpResponse response={0};int completed=hf_supervisor_call(config,!strcmp(action,"supervisor.enroll"),payload,operation,idempotency,correlation,cause,request_seconds,request_nonce,&response);
    HfJson *body=malloc(sizeof *body);int parsed=body&&response.body&&hf_json_parse(body,response.body);
    int backend_ok=0;int64_t version=0;
    int accepted=completed&&response.status>=200&&response.status<300&&parsed&&hf_json_bool(body,hf_json_field(body,0,"ok"),&backend_ok)&&backend_ok&&hf_json_i64(body,hf_json_field(body,0,"protocol_version"),&version)&&version==1;
    if (accepted&&!strcmp(action,"supervisor.enroll")) {
        int result_token=hf_json_field(body,0,"result");char credential[37],run[37],sandbox[37],boot[37],generation[32],role[32];
        accepted=result_token>=0&&hf_json_string(body,hf_json_field(body,result_token,"credential_id"),credential,sizeof credential)&&hf_uuid_valid(credential)&&hf_json_string(body,hf_json_field(body,result_token,"run_id"),run,sizeof run)&&hf_uuid_valid(run)&&hf_json_string(body,hf_json_field(body,result_token,"sandbox_id"),sandbox,sizeof sandbox)&&hf_uuid_valid(sandbox)&&hf_json_string(body,hf_json_field(body,result_token,"boot_id"),boot,sizeof boot)&&hf_uuid_valid(boot)&&hf_json_string(body,hf_json_field(body,result_token,"boot_generation"),generation,sizeof generation)&&hf_json_string(body,hf_json_field(body,result_token,"role"),role,sizeof role)&&!strcmp(role,"RUNNER");
    }
    if (accepted&&!strcmp(action,"supervisor.enroll")) {
        HfJson *sent=malloc(sizeof *sent);char expected[128],actual[128];int result_token=hf_json_field(body,0,"result");
        accepted=sent&&hf_json_parse(sent,payload);
        const char *bindings[]={"run_id","sandbox_id","boot_id","boot_generation"};
        for (unsigned i=0;accepted&&i<4;++i) accepted=hf_json_get(sent,bindings[i],expected,sizeof expected)&&hf_json_string(body,hf_json_field(body,result_token,bindings[i]),actual,sizeof actual)&&!strcmp(expected,actual);
        free(sent);
        if (accepted) {
            HfTransportConfig settings;char credential[37],receipt_path[4200];
            accepted=hf_transport_config(config,&settings)&&hf_json_string(body,hf_json_field(body,result_token,"credential_id"),credential,sizeof credential);
            char *updated=NULL;size_t size=0;FILE *writer=accepted?open_memstream(&updated,&size):NULL;
            if (writer) {
                fputs("{\"origin\":",writer);hf_json_write_string(writer,settings.origin);fputs(",\"key_path\":",writer);hf_json_write_string(writer,settings.key_path);fputs(",\"credential_id\":",writer);hf_json_write_string(writer,credential);
                if (*settings.ca_file) {fputs(",\"ca_file\":",writer);hf_json_write_string(writer,settings.ca_file);}
                fprintf(writer,",\"timeout_ms\":%ld}",settings.timeout_ms);
                accepted=fclose(writer)==0&&hf_private_write(config,updated,size,1);free(updated);
                snprintf(receipt_path,sizeof receipt_path,"%s.enrollment.json",settings.key_path);
                if (accepted) accepted=hf_private_write(receipt_path,response.body,response.length,1);
                if (accepted&&*settings.grant_path&&unlink(settings.grant_path)) {accepted=0;snprintf(response.error,sizeof response.error,"ENROLLMENT_SECRET_CLEANUP_REQUIRED");}
            } else accepted=0;
            if (!accepted) {response.uncertain=1;if (!*response.error) snprintf(response.error,sizeof response.error,"ENROLLMENT_PERSISTENCE_REQUIRES_RECONCILIATION");}
        }
    }
    free(payload);free(body);
    fprintf(out,"{\"completed\":%s,\"uncertain\":%s,\"http_status\":%ld,\"accepted\":%s,\"response\":",completed?"true":"false",response.uncertain?"true":"false",response.status,accepted?"true":"false");
    if (parsed) fputs(response.body,out);else fputs("null",out);
    fputs(",\"error\":",out);hf_json_write_string(out,response.error);fputc('}',out);hf_http_response_free(&response);return 0;
}
static int placement_prepare(const char *config,const char *run,const char *generation) {
    char payload[1024],operation[37],idempotency[37],correlation[37];
    if (!hf_uuid_generate(operation)||!hf_uuid_generate(idempotency)||!hf_uuid_generate(correlation)) return 0;
    snprintf(payload,sizeof payload,"{\"run_id\":\"%s\",\"component\":\"1.1\",\"action\":\"placement.runner.authorize\",\"input\":{\"runner_action\":\"runner.slot.prepare\"},\"expected_version\":null,\"authority\":null}",run);
    HfHttpResponse response={0};HfJson *json=malloc(sizeof *json);int ok=0,authorized=0;
    if (json&&hf_supervisor_call(config,0,payload,operation,idempotency,correlation,NULL,NULL,NULL,&response)&&response.status>=200&&response.status<300&&response.body&&hf_json_parse(json,response.body)&&hf_json_bool(json,hf_json_field(json,0,"ok"),&ok)&&ok) {
        int result=hf_json_field(json,0,"result");char actual_job[64],tool[64],actual_generation[32],location[32];
        ok=result>=0&&hf_json_bool(json,hf_json_field(json,result,"authorized"),&authorized)&&authorized&&hf_json_string(json,hf_json_field(json,result,"job_class"),actual_job,sizeof actual_job)&&!strcmp(actual_job,"dependency_preparation")&&hf_json_string(json,hf_json_field(json,result,"tool"),tool,sizeof tool)&&!strcmp(tool,"native.file.write")&&hf_json_string(json,hf_json_field(json,result,"boot_generation"),actual_generation,sizeof actual_generation)&&!strcmp(actual_generation,generation)&&hf_json_string(json,hf_json_field(json,result,"location"),location,sizeof location)&&!strcmp(location,"REMOTE_EXECUTION");
    } else ok=0;
    free(json);hf_http_response_free(&response);return ok;
}
static int write_transport(const char *path,const HfTransportConfig *settings,const char *key_path,const char *credential) {
    char *updated=NULL;size_t size=0;FILE *writer=open_memstream(&updated,&size);if (!writer) return 0;
    fputs("{\"origin\":",writer);hf_json_write_string(writer,settings->origin);fputs(",\"key_path\":",writer);hf_json_write_string(writer,key_path);fputs(",\"credential_id\":",writer);hf_json_write_string(writer,credential);
    if (*settings->ca_file) {fputs(",\"ca_file\":",writer);hf_json_write_string(writer,settings->ca_file);}
    if (*settings->run_id) {fputs(",\"run_id\":",writer);hf_json_write_string(writer,settings->run_id);}
    fprintf(writer,",\"timeout_ms\":%ld}",settings->timeout_ms);
    int valid=fclose(writer)==0&&hf_private_write(path,updated,size,1);free(updated);return valid;
}
/* Server-returned enrollment identity must match exactly what this boot asked for. */
static int enrollment_result(const HfHttpResponse *response,const char *payload,const char *previous,char credential[37]) {
    HfJson *body=malloc(sizeof *body),*sent=malloc(sizeof *sent);int ok=0;int64_t version=0;char role[32],expected[128],actual[128];
    int valid=body&&sent&&response->status>=200&&response->status<300&&response->body&&hf_json_parse(body,response->body)&&hf_json_bool(body,hf_json_field(body,0,"ok"),&ok)&&ok&&hf_json_i64(body,hf_json_field(body,0,"protocol_version"),&version)&&version==1&&hf_json_parse(sent,payload);
    int result=valid?hf_json_field(body,0,"result"):-1;
    valid=valid&&result>=0&&hf_json_string(body,hf_json_field(body,result,"credential_id"),credential,37)&&hf_uuid_valid(credential)&&(!previous||strcmp(previous,credential))&&hf_json_string(body,hf_json_field(body,result,"role"),role,sizeof role)&&!strcmp(role,"RUNNER");
    const char *bindings[]={"run_id","sandbox_id","boot_id","boot_generation"};
    for (unsigned i=0;valid&&i<4;++i) valid=hf_json_get(sent,bindings[i],expected,sizeof expected)&&hf_json_string(body,hf_json_field(body,result,bindings[i]),actual,sizeof actual)&&!strcmp(expected,actual);
    free(body);free(sent);return valid;
}
/* Key/credential rotation through task14.1 enrollment: a fresh Ed25519 key is
 * enrolled with a coordinator-issued one-time grant. The journal fixes every
 * request byte before the network so a lost reply replays the same operation;
 * the old key is destroyed only after the new credential is proven and
 * atomically installed. RUNNER principals cannot revoke; the coordinator revokes
 * the retired credential with identity.principal.revoke. */
static int credential_rotate(const HfJson *json,FILE *out) {
    const char *keys[]={"config_path","grant_path","provisioning_intent_id","run_id","sandbox_id","boot_id","boot_generation"};
    char config[4096],grant[4096],intent[37],run[37],sandbox[37],boot[37],generation[32],journal[4200];
    if (!hf_json_only(json,0,keys,7)||!hf_json_get(json,"config_path",config,sizeof config)||!hf_json_get(json,"grant_path",grant,sizeof grant)||*grant!='/'||!hf_json_get(json,"provisioning_intent_id",intent,sizeof intent)||!hf_uuid_valid(intent)||!hf_json_get(json,"run_id",run,sizeof run)||!hf_uuid_valid(run)||!hf_json_get(json,"sandbox_id",sandbox,sizeof sandbox)||!hf_uuid_valid(sandbox)||!hf_json_get(json,"boot_id",boot,sizeof boot)||!hf_uuid_valid(boot)||!hf_json_get(json,"boot_generation",generation,sizeof generation)||!*generation||strspn(generation,"0123456789")!=strlen(generation)) return hf_native_error(out,"INVALID_ROTATION_REQUEST");
    HfTransportConfig settings;
    if (!hf_transport_config(config,&settings)||!*settings.credential_id||*settings.grant_path) return hf_native_error(out,"ROTATION_REQUIRES_ENROLLED_CONFIG");
    snprintf(journal,sizeof journal,"%s.rotation.json",config);
    char *raw=NULL;size_t raw_length=0;HfJson *state=malloc(sizeof *state);
    char old_credential[37],new_key[4096],public_key[44],operation[37],idempotency[37],correlation[37],*payload=NULL;int resumed=0;
    if (!state) return hf_native_error(out,"RESOURCE_LIMIT");
    struct stat st;
    if (!lstat(journal,&st)) {
        const char *jk[]={"schema_version","old_credential_id","old_key_path","new_key_path","public_key_b64","grant_path","operation_id","idempotency_key","correlation_id","payload"};
        char old_key[4096],grant_seen[4096];int64_t schema=0;
        int valid=hf_private_read(journal,65536,&raw,&raw_length)&&hf_json_parse(state,raw)&&hf_json_only(state,0,jk,10)&&hf_json_i64(state,hf_json_field(state,0,"schema_version"),&schema)&&schema==1&&hf_json_get(state,"old_credential_id",old_credential,sizeof old_credential)&&hf_json_get(state,"old_key_path",old_key,sizeof old_key)&&hf_json_get(state,"new_key_path",new_key,sizeof new_key)&&hf_json_get(state,"public_key_b64",public_key,sizeof public_key)&&hf_json_get(state,"grant_path",grant_seen,sizeof grant_seen)&&!strcmp(grant_seen,grant)&&hf_json_get(state,"operation_id",operation,sizeof operation)&&hf_json_get(state,"idempotency_key",idempotency,sizeof idempotency)&&hf_json_get(state,"correlation_id",correlation,sizeof correlation);
        int token=valid?hf_json_field(state,0,"payload"):-1;size_t cap=token>=0?state->tokens[token].end-state->tokens[token].start+1:0;
        payload=cap?malloc(cap):NULL;valid=valid&&payload&&hf_json_string(state,token,payload,cap);
        free(raw);
        /* The config may already name the new key if retirement was interrupted. */
        if (valid&&!strcmp(settings.key_path,new_key)&&strcmp(settings.credential_id,old_credential)) {
            char old_receipt[4300];snprintf(old_receipt,sizeof old_receipt,"%s.enrollment.json",old_key);
            int retired=(!unlink(old_key)||errno==ENOENT)&&(!unlink(old_receipt)||errno==ENOENT);
            int grant_removed=!unlink(grant)||errno==ENOENT,journal_removed=!unlink(journal);
            fputs("{\"rotated\":true,\"resumed\":true,\"old_credential_id\":",out);hf_json_write_string(out,old_credential);
            fputs(",\"new_credential_id\":",out);hf_json_write_string(out,settings.credential_id);
            fputs(",\"public_key_b64\":",out);hf_json_write_string(out,public_key);
            fprintf(out,",\"old_key_destroyed\":%s,\"grant_removed\":%s,\"journal_cleared\":%s,\"new_credential_proven\":true,\"old_credential_server_revocation\":\"COORDINATOR_REQUIRED\"}",retired?"true":"false",grant_removed?"true":"false",journal_removed?"true":"false");
            free(payload);free(state);return 0;
        }
        if (valid&&(strcmp(settings.credential_id,old_credential)||strcmp(settings.key_path,old_key))) valid=0;
        if (!valid) {free(payload);free(state);return hf_native_error(out,"ROTATION_JOURNAL_REQUIRES_RECONCILIATION");}
        resumed=1;
    } else if (errno==ENOENT) {
        char suffix[37];
        if (!hf_uuid_generate(suffix)||!hf_uuid_generate(operation)||!hf_uuid_generate(idempotency)||!hf_uuid_generate(correlation)) {free(state);return hf_native_error(out,"ROTATION_RANDOMNESS_UNAVAILABLE");}
        if (strlen(settings.key_path)+38>=sizeof new_key) {free(state);return hf_native_error(out,"ROTATION_KEY_PATH_TOO_LONG");}
        /* The length guard above makes truncation impossible; checking the result keeps -Wformat-truncation (used by the 12.3 case build) honest about it. */
        int written=snprintf(new_key,sizeof new_key,"%s.%.36s",settings.key_path,suffix);
        if (written<0||(size_t)written>=sizeof new_key) {free(state);return hf_native_error(out,"ROTATION_KEY_PATH_TOO_LONG");}
        memcpy(old_credential,settings.credential_id,37);
        if (!hf_transport_keygen(new_key,public_key)) {free(state);return hf_native_error(out,"ROTATION_KEY_GENERATION_FAILED");}
        size_t size=0;FILE *s=open_memstream(&payload,&size);
        if (s) {
            fputs("{\"run_id\":",s);hf_json_write_string(s,run);fputs(",\"provisioning_intent_id\":",s);hf_json_write_string(s,intent);
            fputs(",\"sandbox_id\":",s);hf_json_write_string(s,sandbox);fputs(",\"boot_generation\":",s);hf_json_write_string(s,generation);
            fputs(",\"boot_id\":",s);hf_json_write_string(s,boot);fputs(",\"public_key_b64\":",s);hf_json_write_string(s,public_key);fputc('}',s);
        }
        char *record=NULL;size_t record_size=0;FILE *r=s&&!fclose(s)?open_memstream(&record,&record_size):NULL;
        if (r) {
            fputs("{\"schema_version\":1,\"old_credential_id\":",r);hf_json_write_string(r,old_credential);fputs(",\"old_key_path\":",r);hf_json_write_string(r,settings.key_path);
            fputs(",\"new_key_path\":",r);hf_json_write_string(r,new_key);fputs(",\"public_key_b64\":",r);hf_json_write_string(r,public_key);
            fputs(",\"grant_path\":",r);hf_json_write_string(r,grant);fputs(",\"operation_id\":",r);hf_json_write_string(r,operation);
            fputs(",\"idempotency_key\":",r);hf_json_write_string(r,idempotency);fputs(",\"correlation_id\":",r);hf_json_write_string(r,correlation);
            fputs(",\"payload\":",r);hf_json_write_string(r,payload);fputc('}',r);
        }
        int valid=r&&!fclose(r)&&hf_private_write(journal,record,record_size,0);free(record);
        if (!valid) {unlink(new_key);free(payload);free(state);return hf_native_error(out,"ROTATION_JOURNAL_PERSISTENCE_FAILED");}
    } else {free(state);return hf_native_error(out,"ROTATION_JOURNAL_UNTRUSTED");}
    free(state);
    HfTransportConfig next=settings;snprintf(next.key_path,sizeof next.key_path,"%s",new_key);snprintf(next.grant_path,sizeof next.grant_path,"%s",grant);
    char *body=hf_envelope(payload,operation,idempotency,correlation,NULL);
    HfHttpResponse response={0};int completed=body&&hf_transport_post(&next,1,body,NULL,NULL,&response);free(body);
    char credential[37];
    if (!completed||!enrollment_result(&response,payload,old_credential,credential)) {
        /* Not installed: the journal and key are retained so the next attempt replays the
         * exact enrollment (lost reply, or a live predecessor not yet retired by 14.1). */
        char code[128]="";HfJson *reply=malloc(sizeof *reply);
        if (reply&&response.body&&hf_json_parse(reply,response.body)) {int error=hf_json_field(reply,0,"error");if (error>=0&&!hf_json_string(reply,hf_json_field(reply,error,"code"),code,sizeof code)) *code=0;}
        free(reply);
        fprintf(out,"{\"rotated\":false,\"rotation_pending\":true,\"resumed\":%s,\"completed\":%s,\"http_status\":%ld,\"error\":",resumed?"true":"false",completed?"true":"false",response.status);hf_json_write_string(out,*code?code:response.error);fputc('}',out);
        hf_http_response_free(&response);free(payload);return 0;
    }
    /* Prove the new credential over the signed path before retiring anything. */
    snprintf(next.credential_id,sizeof next.credential_id,"%s",credential);*next.grant_path=0;
    char describe[256],probe_operation[37],probe_idempotency[37],probe_correlation[37];
    snprintf(describe,sizeof describe,"{\"run_id\":\"%s\",\"component\":\"14.1\",\"action\":\"identity.describe\",\"input\":{},\"expected_version\":null,\"authority\":null}",run);
    HfHttpResponse probe={0};HfJson *seen=malloc(sizeof *seen);int proven=0;
    char *probe_body=hf_uuid_generate(probe_operation)&&hf_uuid_generate(probe_idempotency)&&hf_uuid_generate(probe_correlation)?hf_envelope(describe,probe_operation,probe_idempotency,probe_correlation,NULL):NULL;
    if (seen&&probe_body&&hf_transport_post(&next,0,probe_body,NULL,NULL,&probe)&&probe.status==200&&hf_json_parse(seen,probe.body)) {
        int ok=0,result=hf_json_field(seen,0,"result"),principal=result>=0?hf_json_field(seen,result,"principal"):-1;char id[37];
        proven=hf_json_bool(seen,hf_json_field(seen,0,"ok"),&ok)&&ok&&principal>=0&&hf_json_string(seen,hf_json_field(seen,principal,"credential_id"),id,sizeof id)&&!strcmp(id,credential);
    }
    free(probe_body);free(seen);hf_http_response_free(&probe);
    if (!proven) {
        fprintf(out,"{\"rotated\":false,\"rotation_pending\":true,\"resumed\":%s,\"new_credential_id\":\"%s\",\"error\":\"ROTATION_NEW_CREDENTIAL_UNPROVEN\"}",resumed?"true":"false",credential);
        hf_http_response_free(&response);free(payload);return 0;
    }
    char receipt[4300];snprintf(receipt,sizeof receipt,"%s.enrollment.json",new_key);
    int installed=hf_private_write(receipt,response.body,response.length,1)&&write_transport(config,&settings,new_key,credential);
    hf_http_response_free(&response);free(payload);
    if (!installed) return hf_native_error(out,"ROTATION_INSTALL_REQUIRES_RECONCILIATION");
    char old_receipt[4300];snprintf(old_receipt,sizeof old_receipt,"%s.enrollment.json",settings.key_path);
    int retired=(!unlink(settings.key_path)||errno==ENOENT);
    if (unlink(old_receipt)&&errno!=ENOENT) retired=0;
    int grant_removed=!unlink(grant)||errno==ENOENT;
    int journal_removed=!unlink(journal);
    fputs("{\"rotated\":true,\"resumed\":",out);fputs(resumed?"true":"false",out);
    fputs(",\"old_credential_id\":",out);hf_json_write_string(out,old_credential);
    fputs(",\"new_credential_id\":",out);hf_json_write_string(out,credential);
    fputs(",\"public_key_b64\":",out);hf_json_write_string(out,public_key);
    fprintf(out,",\"old_key_destroyed\":%s,\"grant_removed\":%s,\"journal_cleared\":%s,\"new_credential_proven\":true,\"old_credential_server_revocation\":\"COORDINATOR_REQUIRED\"}",retired?"true":"false",grant_removed?"true":"false",journal_removed?"true":"false");
    return 0;
}
/* Exposes the native exact-byte proof for interoperability probes; it needs the
 * same private key access as signing itself and grants no additional authority. */
static int request_proof(const HfJson *json,FILE *out) {
    const char *keys[]={"config_path","payload_json","operation_id","idempotency_key","correlation_id","seconds","nonce"};
    char config[4096],operation[37],idempotency[37],correlation[37],seconds[32],nonce[37];
    if (!hf_json_only(json,0,keys,7)||!hf_json_get(json,"config_path",config,sizeof config)||!hf_json_get(json,"operation_id",operation,sizeof operation)||!hf_json_get(json,"idempotency_key",idempotency,sizeof idempotency)||!hf_json_get(json,"correlation_id",correlation,sizeof correlation)||!hf_json_get(json,"seconds",seconds,sizeof seconds)||!hf_json_get(json,"nonce",nonce,sizeof nonce)) return hf_native_error(out,"INVALID_PROOF_REQUEST");
    int token=hf_json_field(json,0,"payload_json");size_t cap=token>=0?json->tokens[token].end-json->tokens[token].start+1:0;
    char *payload=cap?malloc(cap):NULL;HfTransportConfig settings;
    if (!payload||!hf_json_string(json,token,payload,cap)||!hf_transport_config(config,&settings)||!*settings.credential_id) {free(payload);return hf_native_error(out,"INVALID_PROOF_REQUEST");}
    char *body=hf_envelope(payload,operation,idempotency,correlation,NULL);free(payload);char signature[87];
    if (!body||!hf_transport_sign(settings.key_path,"HYPERFIDE-REQUEST-V1","/v1/invoke",settings.origin,settings.credential_id,seconds,nonce,body,signature)) {free(body);return hf_native_error(out,"PROOF_REFUSED");}
    fputs("{\"endpoint\":\"/v1/invoke\",\"body\":",out);hf_json_write_string(out,body);
    fputs(",\"headers\":{\"HF-Credential-Id\":",out);hf_json_write_string(out,settings.credential_id);
    fputs(",\"HF-Request-Time\":",out);hf_json_write_string(out,seconds);fputs(",\"HF-Request-Nonce\":",out);hf_json_write_string(out,nonce);
    fputs(",\"HF-Request-Signature\":",out);hf_json_write_string(out,signature);fputs("}}",out);free(body);return 0;
}
int hf_component_12_1(const char *action,const char *request,FILE *out) {
    HfJson *json=malloc(sizeof *json);if (!json) return hf_native_error(out,"RESOURCE_LIMIT");
    if (!hf_json_parse(json,request)) {free(json);return hf_native_error(out,"INVALID_JSON");}
    int result=1;
    if (!strcmp(action,"supervisor.serve")) {free(json);return hf_supervisor_daemon(request,out);}
    if (!strcmp(action,"supervisor.describe")) {
        const char *keys[]={NULL};
        if (!hf_json_only(json,0,keys,0)) result=hf_native_error(out,"UNKNOWN_FIELD");
        else {const curl_version_info_data *version=curl_version_info(CURLVERSION_NOW);fputs("{\"protocol_version\":1,\"proof\":\"Ed25519-exact-bytes-v1\",\"tls_peer_verified\":true,\"tls_hostname_verified\":true,\"redirects\":false,\"libcurl\":",out);hf_json_write_string(out,version->version);fputs(",\"tls_backend\":",out);hf_json_write_string(out,version->ssl_version?version->ssl_version:"");fputs(",\"libcrypto\":",out);hf_json_write_string(out,OpenSSL_version(OPENSSL_VERSION));fputs(",\"libcurl_headers\":",out);hf_json_write_string(out,LIBCURL_VERSION);fputs(",\"openssl_headers\":",out);hf_json_write_string(out,OPENSSL_VERSION_TEXT);fprintf(out,",\"native_prerequisites_qualified\":%s,\"minimums\":{\"libcurl\":\"7.85.0\",\"openssl\":\"3.0.0\"},\"slot_profiles\":[\"distinct_uid\",\"vm_dedicated\"],\"refused_slot_profiles\":[\"worktree_only\"],\"credential_sensitive_requires\":\"vm_dedicated\",\"full_case_status\":\"INCOMPLETE\"}",hf_transport_qualified()?"true":"false");result=0;}
    } else if (!strcmp(action,"supervisor.keygen")) {
        char path[4096],public_key[44];const char *keys[]={"key_path"};
        if (!hf_json_only(json,0,keys,1)||!hf_json_get(json,"key_path",path,sizeof path)||!hf_transport_keygen(path,public_key)) result=hf_native_error(out,"KEY_GENERATION_REFUSED");
        else {fprintf(out,"{\"public_key_b64\":\"%s\",\"private_key_format\":\"PKCS8-PEM\"}",public_key);result=0;}
    } else if (!strcmp(action,"supervisor.slot.allocate")) result=slot_allocate(json,out);
    else if (!strcmp(action,"supervisor.slot.release")) result=slot_release(json,out);
    else if (!strcmp(action,"supervisor.slot.inventory")) result=slot_inventory_action(json,out);
    else if (!strcmp(action,"supervisor.rotate")) result=credential_rotate(json,out);
    else if (!strcmp(action,"supervisor.proof")) result=request_proof(json,out);
    else if (!strcmp(action,"supervisor.enroll")||!strcmp(action,"supervisor.invoke")||!strcmp(action,"supervisor.register")||!strcmp(action,"supervisor.heartbeat")||!strcmp(action,"supervisor.reconnect")) result=request_action(action,json,out);
    else result=hf_native_error(out,"UNKNOWN_ACTION");
    free(json);return result;
}
