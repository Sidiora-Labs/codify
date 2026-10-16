#define _GNU_SOURCE
#include "components.h"
#include "supervisor.h"
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <pwd.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <sqlite3.h>
#include <curl/curl.h>
#include <openssl/crypto.h>

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
static int slot_allocate(const HfJson *json,FILE *out) {
    const char *keys[]={"root","slot_id","uid","gid","isolation_profile","credential_sensitive","boot_id","preparation_digest","config_path","run_id","boot_generation"};
    char config[4096],run_id[37],generation[32];
    char root[4096],slot[37],profile[64],boot[37],preparation[72];int64_t uid=0,gid=0;int sensitive=0;
    if (!hf_json_only(json,0,keys,11)||!hf_json_get(json,"config_path",config,sizeof config)||!hf_json_get(json,"run_id",run_id,sizeof run_id)||!hf_uuid_valid(run_id)||!hf_json_get(json,"boot_generation",generation,sizeof generation)||!hf_json_get(json,"root",root,sizeof root)||!hf_json_get(json,"slot_id",slot,sizeof slot)||!hf_uuid_valid(slot)||!hf_json_get(json,"isolation_profile",profile,sizeof profile)||strcmp(profile,"distinct_uid")||!hf_json_get(json,"boot_id",boot,sizeof boot)||!hf_uuid_valid(boot)||!hf_json_get(json,"preparation_digest",preparation,sizeof preparation)||strlen(preparation)!=71||strncmp(preparation,"sha256:",7)||!hf_json_i64(json,hf_json_field(json,0,"uid"),&uid)||!hf_json_i64(json,hf_json_field(json,0,"gid"),&gid)||uid<=0||uid>UINT32_MAX||gid<=0||gid>UINT32_MAX||!hf_json_bool(json,hf_json_field(json,0,"credential_sensitive"),&sensitive)||geteuid()!=0) return hf_native_error(out,"UNQUALIFIED_SLOT_PROFILE");
    for (size_t i=7;i<71;++i) if (!((preparation[i]>='0'&&preparation[i]<='9')||(preparation[i]>='a'&&preparation[i]<='f'))) return hf_native_error(out,"INVALID_PREPARATION_DIGEST");
    if (!getpwuid((uid_t)uid)||!getgrgid((gid_t)gid)) return hf_native_error(out,"UNKNOWN_SLOT_OS_PRINCIPAL");
    if (!placement_prepare(config,run_id,generation)) return hf_native_error(out,"PLACEMENT_AUTHORITY_UNAVAILABLE_OR_DENIED");
    int rootfd;if (!private_root(root,&rootfd)) return hf_native_error(out,"UNTRUSTED_SLOT_ROOT");
    struct stat rootstat;
    if (fstat(rootfd,&rootstat)||!(rootstat.st_mode&S_IXOTH)) {close(rootfd);return hf_native_error(out,"SLOT_ROOT_NOT_TRAVERSABLE");}
    char dbpath[4200];snprintf(dbpath,sizeof dbpath,"%s/.supervisor-slots.db",root);
    struct stat dbstat;if (!lstat(dbpath,&dbstat)&&(!S_ISREG(dbstat.st_mode)||dbstat.st_uid!=geteuid()||(dbstat.st_mode&077)||dbstat.st_nlink!=1)) {close(rootfd);return hf_native_error(out,"UNTRUSTED_SLOT_DATABASE");}
    mode_t mask=umask(0077);sqlite3 *db=NULL;int rc=sqlite3_open_v2(dbpath,&db,SQLITE_OPEN_READWRITE|SQLITE_OPEN_CREATE|SQLITE_OPEN_FULLMUTEX,NULL);umask(mask);
    if (rc!=SQLITE_OK) {sqlite3_close(db);close(rootfd);return hf_native_error(out,"SLOT_DATABASE_UNAVAILABLE");}
    sqlite3_busy_timeout(db,5000);
    rc=sqlite3_exec(db,"PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;CREATE TABLE IF NOT EXISTS slots(id TEXT PRIMARY KEY,uid INTEGER UNIQUE NOT NULL,gid INTEGER NOT NULL,boot_id TEXT NOT NULL,preparation TEXT NOT NULL,port INTEGER UNIQUE NOT NULL,state TEXT NOT NULL);BEGIN IMMEDIATE;",NULL,NULL,NULL);
    sqlite3_stmt *statement=NULL;
    if (rc==SQLITE_OK) rc=sqlite3_prepare_v2(db,"SELECT uid,gid,boot_id,preparation,port,state FROM slots WHERE id=?",-1,&statement,NULL);
    if (rc!=SQLITE_OK) {sqlite3_close(db);close(rootfd);return hf_native_error(out,"SLOT_DATABASE_UNAVAILABLE");}
    sqlite3_bind_text(statement,1,slot,-1,SQLITE_STATIC);int step=sqlite3_step(statement);int port=0;
    if (step==SQLITE_ROW) {
        int same=sqlite3_column_int64(statement,0)==uid&&sqlite3_column_int64(statement,1)==gid&&!strcmp((const char *)sqlite3_column_text(statement,2),boot)&&!strcmp((const char *)sqlite3_column_text(statement,3),preparation)&&!strcmp((const char *)sqlite3_column_text(statement,5),"READY");
        port=sqlite3_column_int(statement,4);sqlite3_finalize(statement);
        sqlite3_exec(db,"ROLLBACK",NULL,NULL,NULL);sqlite3_close(db);close(rootfd);
        if (!same) return hf_native_error(out,"SLOT_IDEMPOTENCY_OR_RECOVERY_CONFLICT");
        fprintf(out,"{\"slot_id\":\"%s\",\"uid\":%lld,\"gid\":%lld,\"port\":%d,\"replayed\":true,\"isolation\":\"distinct_uid\"}",slot,(long long)uid,(long long)gid,port);return 0;
    }
    sqlite3_finalize(statement);
    int sock=socket(AF_INET,SOCK_STREAM|SOCK_CLOEXEC,0);struct sockaddr_in address={.sin_family=AF_INET,.sin_addr.s_addr=htonl(INADDR_LOOPBACK),.sin_port=0};socklen_t address_length=sizeof address;
    if (sock<0||bind(sock,(struct sockaddr *)&address,sizeof address)||getsockname(sock,(struct sockaddr *)&address,&address_length)) {if (sock>=0) close(sock);sqlite3_exec(db,"ROLLBACK",NULL,NULL,NULL);sqlite3_close(db);close(rootfd);return hf_native_error(out,"PORT_UNAVAILABLE");}
    port=ntohs(address.sin_port);
    rc=sqlite3_prepare_v2(db,"INSERT INTO slots VALUES(?,?,?,?,?,?,'PREPARING')",-1,&statement,NULL);
    if (rc==SQLITE_OK) {sqlite3_bind_text(statement,1,slot,-1,SQLITE_STATIC);sqlite3_bind_int64(statement,2,uid);sqlite3_bind_int64(statement,3,gid);sqlite3_bind_text(statement,4,boot,-1,SQLITE_STATIC);sqlite3_bind_text(statement,5,preparation,-1,SQLITE_STATIC);sqlite3_bind_int(statement,6,port);rc=sqlite3_step(statement);}
    sqlite3_finalize(statement);
    if (rc!=SQLITE_DONE||sqlite3_exec(db,"COMMIT",NULL,NULL,NULL)!=SQLITE_OK) {close(sock);sqlite3_exec(db,"ROLLBACK",NULL,NULL,NULL);sqlite3_close(db);close(rootfd);return hf_native_error(out,"SLOT_RESOURCE_CONFLICT");}
    int valid=mkdirat(rootfd,slot,0700)==0;int dir=valid?openat(rootfd,slot,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC):-1;
    const char *directories[]={"worktree","build","home","tmp","sessions","logs"};
    if (dir<0) valid=0;
    if (valid&&fchown(dir,(uid_t)uid,(gid_t)gid)) valid=0;
    for (unsigned i=0;valid&&i<sizeof directories/sizeof directories[0];++i) {
        if (mkdirat(dir,directories[i],0700)) {valid=0;break;}
        int child=openat(dir,directories[i],O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
        if (child<0||fchown(child,(uid_t)uid,(gid_t)gid)) valid=0;
        if (child>=0) close(child);
    }
    if (dir>=0) {if (fsync(dir)) valid=0;close(dir);}
    if (fsync(rootfd)) valid=0;
    rc=sqlite3_prepare_v2(db,"UPDATE slots SET state=? WHERE id=?",-1,&statement,NULL);
    if (rc==SQLITE_OK) {sqlite3_bind_text(statement,1,valid?"READY":"CLEANUP_REQUIRED",-1,SQLITE_STATIC);sqlite3_bind_text(statement,2,slot,-1,SQLITE_STATIC);rc=sqlite3_step(statement);}
    sqlite3_finalize(statement);sqlite3_close(db);close(rootfd);close(sock);
    if (!valid||rc!=SQLITE_DONE) return hf_native_error(out,"SLOT_PREPARATION_CLEANUP_REQUIRED");
    fprintf(out,"{\"slot_id\":\"%s\",\"boot_id\":\"%s\",\"uid\":%lld,\"gid\":%lld,\"port\":%d,\"isolation\":\"distinct_uid\",\"credential_sensitive\":%s,\"port_reservation\":\"logical-bind-rechecked-at-launch\",\"paths\":{",slot,boot,(long long)uid,(long long)gid,port,sensitive?"true":"false");
    for (unsigned i=0;i<sizeof directories/sizeof directories[0];++i) {if (i) fputc(',',out);hf_json_write_string(out,directories[i]);fputc(':',out);char path[4300];snprintf(path,sizeof path,"%s/%s/%s",root,slot,directories[i]);hf_json_write_string(out,path);}
    fputs("}}",out);return 0;
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
int hf_component_12_1(const char *action,const char *request,FILE *out) {
    HfJson *json=malloc(sizeof *json);if (!json) return hf_native_error(out,"RESOURCE_LIMIT");
    if (!hf_json_parse(json,request)) {free(json);return hf_native_error(out,"INVALID_JSON");}
    int result=1;
    if (!strcmp(action,"supervisor.describe")) {
        const char *keys[]={NULL};
        if (!hf_json_only(json,0,keys,0)) result=hf_native_error(out,"UNKNOWN_FIELD");
        else {const curl_version_info_data *version=curl_version_info(CURLVERSION_NOW);fputs("{\"protocol_version\":1,\"proof\":\"Ed25519-exact-bytes-v1\",\"tls_peer_verified\":true,\"tls_hostname_verified\":true,\"redirects\":false,\"libcurl\":",out);hf_json_write_string(out,version->version);fputs(",\"tls_backend\":",out);hf_json_write_string(out,version->ssl_version?version->ssl_version:"");fputs(",\"libcrypto\":",out);hf_json_write_string(out,OpenSSL_version(OPENSSL_VERSION));fputs(",\"slot_profiles\":[\"distinct_uid\"],\"full_case_status\":\"INCOMPLETE\"}",out);result=0;}
    } else if (!strcmp(action,"supervisor.keygen")) {
        char path[4096],public_key[44];const char *keys[]={"key_path"};
        if (!hf_json_only(json,0,keys,1)||!hf_json_get(json,"key_path",path,sizeof path)||!hf_transport_keygen(path,public_key)) result=hf_native_error(out,"KEY_GENERATION_REFUSED");
        else {fprintf(out,"{\"public_key_b64\":\"%s\",\"private_key_format\":\"PKCS8-PEM\"}",public_key);result=0;}
    } else if (!strcmp(action,"supervisor.slot.allocate")) result=slot_allocate(json,out);
    else if (!strcmp(action,"supervisor.enroll")||!strcmp(action,"supervisor.invoke")||!strcmp(action,"supervisor.register")||!strcmp(action,"supervisor.heartbeat")||!strcmp(action,"supervisor.reconnect")) result=request_action(action,json,out);
    else result=hf_native_error(out,"UNKNOWN_ACTION");
    free(json);return result;
}
