#define _GNU_SOURCE
#include "transport.h"
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <sys/stat.h>
#include <pthread.h>
#include <curl/curl.h>
#include <openssl/evp.h>
#include <openssl/pem.h>
#include <openssl/rand.h>
#include <openssl/crypto.h>

static void whitespace(const char **p) { while (**p && strchr(" \t\r\n", **p)) ++*p; }
static int hex_value(char ch) {
    if (ch >= '0' && ch <= '9') return ch - '0';
    if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10;
    if (ch >= 'A' && ch <= 'F') return ch - 'A' + 10;
    return -1;
}
static int utf8(const char *text) {
    const unsigned char *p = (const unsigned char *)text;
    while (*p) {
        unsigned ch = *p++;
        if (ch < 128) continue;
        unsigned count = ch >= 0xc2 && ch <= 0xdf ? 1 : ch >= 0xe0 && ch <= 0xef ? 2 : ch >= 0xf0 && ch <= 0xf4 ? 3 : 0;
        if (!count) return 0;
        unsigned cp = ch & ((1U << (6 - count)) - 1U);
        for (unsigned i = 0; i < count; ++i) {
            if (*p < 0x80 || *p > 0xbf) return 0;
            cp = (cp << 6) | (*p++ & 63U);
        }
        if ((count == 1 && cp < 0x80) || (count == 2 && cp < 0x800) || (count == 3 && cp < 0x10000) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return 0;
    }
    return 1;
}
static int token_new(HfJson *json, int parent, char type, const char *p) {
    if (json->count >= HF_JSON_TOKENS) return -1;
    int index = json->count++;
    json->tokens[index] = (HfJsonToken){.start=(size_t)(p-json->text),.parent=parent,.type=type,.next=index+1};
    return index;
}
static int parse_string(HfJson *json, const char **cursor, int parent) {
    const char *p = *cursor;
    if (*p != '"') return -1;
    int index = token_new(json,parent,'s',p++);
    if (index < 0) return -1;
    while (*p && *p != '"') {
        if ((unsigned char)*p < 32) return -1;
        if (*p++ == '\\') {
            if (*p == 'u') {
                ++p;
                for (int i=0;i<4;++i) { if (!*p || hex_value(*p++) < 0) return -1; }
            } else {
                if (!*p || !strchr("\"\\/bfnrt",*p++)) return -1;
            }
        }
    }
    if (*p++ != '"') return -1;
    json->tokens[index].end=(size_t)(p-json->text);
    *cursor=p;
    return index;
}
static int parse_value(HfJson *json,const char **cursor,int parent,unsigned depth) {
    if (depth>64) return -1;
    whitespace(cursor);
    const char *p=*cursor;
    if (*p=='"') return parse_string(json,cursor,parent);
    if (*p=='{' || *p=='[') {
        char type=*p++, close=type=='{'?'}':']';
        int index=token_new(json,parent,type,p-1);
        if (index<0) return -1;
        whitespace(&p);
        if (*p!=close) {
            for (;;) {
                int key=-1;
                if (type=='{') {
                    key=parse_string(json,&p,index);
                    if (key<0) return -1;
                    char decoded[512];
                    if (!hf_json_string(json,key,decoded,sizeof decoded)) return -1;
                    for (int previous=index+1;previous<key;) {
                        char prior[512];
                        if (!hf_json_string(json,previous,prior,sizeof prior) || !strcmp(decoded,prior)) return -1;
                        previous=json->tokens[previous+1].next;
                    }
                    whitespace(&p);
                    if (*p++!=':') return -1;
                }
                if (parse_value(json,&p,index,depth+1)<0) return -1;
                ++json->tokens[index].count;
                whitespace(&p);
                if (*p==close) break;
                if (*p++!=',') return -1;
                whitespace(&p);
            }
        }
        ++p;
        json->tokens[index].end=(size_t)(p-json->text);
        json->tokens[index].next=json->count;
        *cursor=p;
        return index;
    }
    int index=token_new(json,parent,'v',p);
    if (index<0) return -1;
    if (!strncmp(p,"true",4)) p+=4;
    else if (!strncmp(p,"false",5)) p+=5;
    else if (!strncmp(p,"null",4)) p+=4;
    else {
        if (*p=='-') ++p;
        if (*p=='0') ++p;
        else {
            if (*p<'1'||*p>'9') return -1;
            while (isdigit((unsigned char)*p)) ++p;
        }
        if (*p=='.') {
            ++p;
            if (!isdigit((unsigned char)*p)) return -1;
            while (isdigit((unsigned char)*p)) ++p;
        }
        if (*p=='e'||*p=='E') {
            ++p;
            if (*p=='+'||*p=='-') ++p;
            if (!isdigit((unsigned char)*p)) return -1;
            while (isdigit((unsigned char)*p)) ++p;
        }
    }
    json->tokens[index].end=(size_t)(p-json->text);
    *cursor=p;
    return index;
}
int hf_json_parse(HfJson *json,const char *text) {
    if (!json||!text||strlen(text)>HF_BODY_LIMIT||!utf8(text)) return 0;
    memset(json,0,sizeof *json);
    json->text=text; json->length=strlen(text);
    const char *p=text;
    if (parse_value(json,&p,-1,0)!=0) return 0;
    whitespace(&p);
    return !*p && json->tokens[0].type=='{';
}
static int append_codepoint(char *out,size_t *used,size_t cap,unsigned cp) {
    unsigned char bytes[4]; size_t n=0;
    if (!cp||cp>0x10ffff||(cp>=0xd800&&cp<=0xdfff)) return 0;
    if (cp<0x80) bytes[n++]=(unsigned char)cp;
    else if (cp<0x800) {bytes[n++]=(unsigned char)(0xc0|(cp>>6));bytes[n++]=(unsigned char)(0x80|(cp&63));}
    else if (cp<0x10000) {bytes[n++]=(unsigned char)(0xe0|(cp>>12));bytes[n++]=(unsigned char)(0x80|((cp>>6)&63));bytes[n++]=(unsigned char)(0x80|(cp&63));}
    else {bytes[n++]=(unsigned char)(0xf0|(cp>>18));bytes[n++]=(unsigned char)(0x80|((cp>>12)&63));bytes[n++]=(unsigned char)(0x80|((cp>>6)&63));bytes[n++]=(unsigned char)(0x80|(cp&63));}
    if (*used+n>=cap) return 0;
    memcpy(out+*used,bytes,n); *used+=n; return 1;
}
int hf_json_string(const HfJson *json,int token,char *out,size_t cap) {
    if (!json||token<0||token>=json->count||json->tokens[token].type!='s'||!cap) return 0;
    const char *p=json->text+json->tokens[token].start+1;
    const char *end=json->text+json->tokens[token].end-1;
    size_t used=0;
    while (p<end) {
        unsigned char ch=(unsigned char)*p++;
        if (ch=='\\') {
            if (p>=end) return 0;
            ch=(unsigned char)*p++;
            if (ch=='u') {
                unsigned cp=0;
                for (int i=0;i<4;++i) {if (p>=end||hex_value(*p)<0) return 0;cp=(cp<<4)|(unsigned)hex_value(*p++);}
                if (cp>=0xd800&&cp<=0xdbff) {
                    if (end-p<6||p[0]!='\\'||p[1]!='u') return 0;
                    p+=2; unsigned low=0;
                    for (int i=0;i<4;++i) {if (hex_value(*p)<0) return 0;low=(low<<4)|(unsigned)hex_value(*p++);}
                    if (low<0xdc00||low>0xdfff) return 0;
                    cp=0x10000+((cp-0xd800)<<10)+(low-0xdc00);
                }
                if (!append_codepoint(out,&used,cap,cp)) return 0;
                continue;
            }
            if (ch=='b') ch='\b'; else if (ch=='f') ch='\f'; else if (ch=='n') ch='\n';
            else if (ch=='r') ch='\r'; else if (ch=='t') ch='\t';
            else if (!strchr("\"\\/",ch)) return 0;
        }
        if (!ch||used+1>=cap) return 0;
        out[used++]=(char)ch;
    }
    out[used]=0; return utf8(out);
}
int hf_json_field(const HfJson *json,int object,const char *name) {
    if (object<0||object>=json->count||json->tokens[object].type!='{') return -1;
    for (int key=object+1;key<json->tokens[object].next;) {
        char decoded[512];
        if (!hf_json_string(json,key,decoded,sizeof decoded)) return -1;
        if (!strcmp(name,decoded)) return key+1;
        key=json->tokens[key+1].next;
    }
    return -1;
}
int hf_json_get(const HfJson *json,const char *name,char *out,size_t cap) {return hf_json_string(json,hf_json_field(json,0,name),out,cap);}
int hf_json_only(const HfJson *json,int object,const char *const *names,size_t count) {
    if (object<0||object>=json->count||json->tokens[object].type!='{') return 0;
    for (int key=object+1;key<json->tokens[object].next;) {
        char decoded[512]; int found=0;
        if (!hf_json_string(json,key,decoded,sizeof decoded)) return 0;
        for (size_t i=0;i<count;++i) if (!strcmp(decoded,names[i])) found=1;
        if (!found) return 0;
        key=json->tokens[key+1].next;
    }
    return 1;
}
char *hf_json_raw(const HfJson *json,int token) {
    if (token<0||token>=json->count) return NULL;
    return strndup(json->text+json->tokens[token].start,json->tokens[token].end-json->tokens[token].start);
}
int hf_json_bool(const HfJson *json,int token,int *out) {
    char *raw=hf_json_raw(json,token); if (!raw) return 0;
    int valid=!strcmp(raw,"true")||!strcmp(raw,"false");
    if (valid) *out=!strcmp(raw,"true");
    free(raw); return valid;
}
int hf_json_i64(const HfJson *json,int token,int64_t *out) {
    char *raw=hf_json_raw(json,token); if (!raw) return 0;
    char *end=NULL; errno=0; long long value=strtoll(raw,&end,10);
    int valid=*raw && !errno && end && !*end && json->tokens[token].type=='v';
    if (valid) *out=(int64_t)value;
    free(raw); return valid;
}
void hf_json_write_string(FILE *out,const char *value) {
    fputc('"',out);
    for (const unsigned char *p=(const unsigned char *)value;*p;++p) {
        if (*p=='"'||*p=='\\') fprintf(out,"\\%c",*p);
        else if (*p<32) fprintf(out,"\\u%04x",*p);
        else fputc(*p,out);
    }
    fputc('"',out);
}
int hf_uuid_valid(const char *value) {
    if (!value||strlen(value)!=36) return 0;
    for (int i=0;i<36;++i) {
        if (i==8||i==13||i==18||i==23) {if (value[i]!='-') return 0;}
        else if (!((value[i]>='0'&&value[i]<='9')||(value[i]>='a'&&value[i]<='f'))) return 0;
    }
    return 1;
}
int hf_uuid_generate(char out[37]) {
    unsigned char bytes[16]; if (RAND_bytes(bytes,sizeof bytes)!=1) return 0;
    bytes[6]=(unsigned char)((bytes[6]&15)|0x40);bytes[8]=(unsigned char)((bytes[8]&63)|0x80);
    snprintf(out,37,"%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15]);
    return 1;
}
int hf_sha256_bytes(const void *data,size_t length,char out[65]) {
    unsigned char hash[32];unsigned size=0;
    if (EVP_Digest(data,length,hash,&size,EVP_sha256(),NULL)!=1||size!=32) return 0;
    for (unsigned i=0;i<32;++i) snprintf(out+i*2,3,"%02x",hash[i]);
    return 1;
}
char *hf_base64url(const unsigned char *data,size_t length) {
    if (length>HF_BODY_LIMIT) return NULL;
    size_t cap=4*((length+2)/3)+1;char *out=malloc(cap);
    if (!out) return NULL;
    int n=EVP_EncodeBlock((unsigned char *)out,data,(int)length);
    if (n<0) {free(out);return NULL;}
    while (n>0&&out[n-1]=='=') --n;
    out[n]=0;
    for (int i=0;i<n;++i) {if (out[i]=='+') out[i]='-';else if (out[i]=='/') out[i]='_';}
    return out;
}
unsigned char *hf_base64url_decode(const char *text,size_t *length) {
    size_t n=strlen(text);if (n>HF_BODY_LIMIT||n%4==1) return NULL;
    for (size_t i=0;i<n;++i) if (!isalnum((unsigned char)text[i])&&text[i]!='-'&&text[i]!='_') return NULL;
    size_t padded=(n+3)/4*4;char *copy=calloc(padded+1,1);unsigned char *out=malloc(padded+1);
    if (!copy||!out) {free(copy);free(out);return NULL;}
    memcpy(copy,text,n);
    for (size_t i=0;i<n;++i) {if (copy[i]=='-') copy[i]='+';else if (copy[i]=='_') copy[i]='/';}
    for (size_t i=n;i<padded;++i) copy[i]='=';
    int count=EVP_DecodeBlock(out,(unsigned char *)copy,(int)padded);free(copy);
    if (count<0||(size_t)count<padded-n) {free(out);return NULL;}
    *length=(size_t)count-(padded-n);out[*length]=0;
    char *roundtrip=hf_base64url(out,*length);
    int valid=roundtrip&&!strcmp(roundtrip,text);free(roundtrip);
    if (!valid) {free(out);return NULL;}
    return out;
}
int hf_private_read(const char *path,size_t maximum,char **data,size_t *length) {
    if (!path||path[0]!='/') return 0;
    int fd=open(path,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);if (fd<0) return 0;
    struct stat st;
    if (fstat(fd,&st)||!S_ISREG(st.st_mode)||st.st_uid!=geteuid()||(st.st_mode&077)||st.st_nlink!=1||st.st_size<0||(uint64_t)st.st_size>maximum) {close(fd);return 0;}
    *length=(size_t)st.st_size;*data=malloc(*length+1);
    if (!*data) {close(fd);return 0;}
    size_t used=0;
    while (used<*length) {ssize_t n=read(fd,*data+used,*length-used);if (n<=0) {free(*data);*data=NULL;close(fd);return 0;}used+=(size_t)n;}
    char extra;int valid=read(fd,&extra,1)==0;close(fd);(*data)[*length]=0;
    if (!valid||memchr(*data,0,*length)) {free(*data);*data=NULL;return 0;}
    return 1;
}
static int protected_directory(int fd,int root_only) {
    struct stat st;
    if (fstat(fd,&st)||!S_ISDIR(st.st_mode)) return 0;
    if (st.st_uid!=0&&(root_only||st.st_uid!=geteuid())) return 0;
    return !(st.st_mode&022)||(st.st_uid==0&&(st.st_mode&S_ISVTX));
}
static int protected_read_mode(const char *path,size_t maximum,char **data,size_t *length,int public_anchor) {
    if (!data||!length) return 0;
    *data=NULL;*length=0;
    if (!path||path[0]!='/'||strlen(path)>4095||!path[1]||path[strlen(path)-1]=='/') return 0;
    char *copy=strdup(path+1);if (!copy) return 0;
    int directory=open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC),fd=-1,valid=0,all_root=1;
    if (directory<0||!protected_directory(directory,0)) goto done;
    char *part=copy;
    for (;;) {
        char *slash=strchr(part,'/');
        if (slash) *slash=0;
        if (!*part||!strcmp(part,".")||!strcmp(part,"..")) goto done;
        if (!slash) {fd=openat(directory,part,O_RDONLY|O_NONBLOCK|O_NOFOLLOW|O_CLOEXEC);break;}
        int next=openat(directory,part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
        if (next<0) goto done;
        struct stat st;
        if (!protected_directory(next,0)||fstat(next,&st)) {close(next);goto done;}
        if (st.st_uid!=0) all_root=0;
        close(directory);directory=next;part=slash+1;
    }
    struct stat before,after;
    if (fd<0||fstat(fd,&before)||!S_ISREG(before.st_mode)||before.st_nlink!=1||before.st_size<0||(uint64_t)before.st_size>maximum) goto done;
    mode_t mode=before.st_mode&07777;
    int own=before.st_uid==geteuid()&&(mode==0600||mode==0400);
    int root_group=all_root&&before.st_uid==0&&before.st_gid==getegid()&&(mode==0640||mode==0440);
    int root_public=all_root&&before.st_uid==0&&(mode==0644||mode==0444||mode==0640||mode==0440);
    if (public_anchor?!root_public:(!own&&!root_group)) goto done;
    *length=(size_t)before.st_size;*data=malloc(*length+1);
    if (!*data) goto done;
    size_t used=0;
    while (used<*length) {
        ssize_t n=read(fd,*data+used,*length-used);
        if (n<0&&errno==EINTR) continue;
        if (n<=0) goto done;
        used+=(size_t)n;
    }
    char extra;
    if (read(fd,&extra,1)!=0||fstat(fd,&after)||before.st_dev!=after.st_dev||before.st_ino!=after.st_ino||before.st_size!=after.st_size||before.st_mode!=after.st_mode||before.st_uid!=after.st_uid||before.st_gid!=after.st_gid||after.st_nlink!=1||before.st_mtim.tv_sec!=after.st_mtim.tv_sec||before.st_mtim.tv_nsec!=after.st_mtim.tv_nsec||before.st_ctim.tv_sec!=after.st_ctim.tv_sec||before.st_ctim.tv_nsec!=after.st_ctim.tv_nsec||memchr(*data,0,*length)) goto done;
    (*data)[*length]=0;valid=1;
done:
    if (fd>=0) close(fd);
    if (directory>=0) close(directory);
    free(copy);
    if (!valid) {if (*data) {OPENSSL_cleanse(*data,*length);free(*data);}*data=NULL;*length=0;}
    return valid;
}
int hf_protected_read(const char *path,size_t maximum,char **data,size_t *length) {
    return protected_read_mode(path,maximum,data,length,0);
}
int hf_private_write(const char *path,const void *data,size_t length,int replace) {
    if (!path||path[0]!='/'||strlen(path)>4000) return 0;
    char *parent=strdup(path);if (!parent) return 0;
    char *slash=strrchr(parent,'/');char *name=slash+1;
    if (!*name||!strcmp(name,".")||!strcmp(name,"..")) {free(parent);return 0;}
    char basename[4096];snprintf(basename,sizeof basename,"%s",name);
    if (slash==parent) slash[1]=0;else *slash=0;
    int dir=open(parent,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);free(parent);
    struct stat st;
    if (dir<0) return 0;
    if (fstat(dir,&st)||st.st_uid!=geteuid()||(st.st_mode&077)) {close(dir);return 0;}
    char id[37],temporary[128];if (!hf_uuid_generate(id)) {close(dir);return 0;}
    snprintf(temporary,sizeof temporary,".hf-write-%s",id);
    int fd=openat(dir,temporary,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);
    if (fd<0) {close(dir);return 0;}
    const unsigned char *p=data;size_t used=0;int valid=1;
    while (used<length) {ssize_t n=write(fd,p+used,length-used);if (n<0&&errno==EINTR) continue;if (n<=0) {valid=0;break;}used+=(size_t)n;}
    if (fsync(fd)) valid=0;
    if (close(fd)) valid=0;
    if (valid) {
        if (replace) {if (renameat(dir,temporary,dir,basename)) valid=0;}
        else if (linkat(dir,temporary,dir,basename,0)) valid=0;
    }
    unlinkat(dir,temporary,0);
    if (valid&&fsync(dir)) valid=0;
    close(dir);return valid;
}
int hf_native_error(FILE *out,const char *code) {fprintf(stderr,"hyperfide native: %s\n",code);(void)out;return 1;}
static int origin_valid(const char *origin) {
    if (!origin||strlen(origin)>500||strncmp(origin,"https://",8)||strchr(origin,'\n')||strchr(origin,'\r')) return 0;
    CURLU *url=curl_url();if (!url) return 0;
    int valid=curl_url_set(url,CURLUPART_URL,origin,0)==CURLUE_OK;char *part=NULL;
    if (valid&&(curl_url_get(url,CURLUPART_SCHEME,&part,0)!=CURLUE_OK||strcmp(part,"https"))) valid=0;
    curl_free(part);part=NULL;
    if (valid&&(curl_url_get(url,CURLUPART_PATH,&part,0)!=CURLUE_OK||strcmp(part,"/"))) valid=0;
    curl_free(part);part=NULL;
    CURLUPart forbidden[]={CURLUPART_USER,CURLUPART_PASSWORD,CURLUPART_QUERY,CURLUPART_FRAGMENT};
    for (unsigned i=0;i<sizeof forbidden/sizeof forbidden[0];++i) {if (curl_url_get(url,forbidden[i],&part,0)==CURLUE_OK) valid=0;curl_free(part);part=NULL;}
    if (valid&&curl_url_get(url,CURLUPART_URL,&part,CURLU_NO_DEFAULT_PORT)==CURLUE_OK) {
        size_t n=strlen(part);if (n&&part[n-1]=='/') part[n-1]=0;
        if (strcmp(part,origin)) valid=0;
    } else valid=0;
    curl_free(part);curl_url_cleanup(url);return valid;
}
int hf_transport_config(const char *path,HfTransportConfig *config) {
    char *text=NULL;size_t length=0;
    if (!hf_protected_read(path,32768,&text,&length)) return 0;
    HfJson *json=malloc(sizeof *json);if (!json) {free(text);return 0;}
    const char *keys[]={"origin","ca_file","key_path","credential_id","grant_path","timeout_ms","run_id"};
    memset(config,0,sizeof *config);config->timeout_ms=10000;
    int valid=hf_json_parse(json,text)&&hf_json_only(json,0,keys,sizeof keys/sizeof keys[0])&&hf_json_get(json,"origin",config->origin,sizeof config->origin)&&origin_valid(config->origin)&&hf_json_get(json,"key_path",config->key_path,sizeof config->key_path)&&config->key_path[0]=='/';
    if (valid&&hf_json_field(json,0,"ca_file")>=0) valid=hf_json_get(json,"ca_file",config->ca_file,sizeof config->ca_file)&&config->ca_file[0]=='/';
    if (valid&&hf_json_field(json,0,"credential_id")>=0) valid=hf_json_get(json,"credential_id",config->credential_id,sizeof config->credential_id)&&hf_uuid_valid(config->credential_id);
    if (valid&&hf_json_field(json,0,"run_id")>=0) valid=hf_json_get(json,"run_id",config->run_id,sizeof config->run_id)&&hf_uuid_valid(config->run_id);
    if (valid&&hf_json_field(json,0,"grant_path")>=0) valid=hf_json_get(json,"grant_path",config->grant_path,sizeof config->grant_path)&&config->grant_path[0]=='/';
    if (valid&&hf_json_field(json,0,"timeout_ms")>=0) {int64_t timeout=0;valid=hf_json_i64(json,hf_json_field(json,0,"timeout_ms"),&timeout)&&timeout>=100&&timeout<=60000;if (valid) config->timeout_ms=(long)timeout;}
    free(json);OPENSSL_cleanse(text,length);free(text);return valid;
}
static int no_password(char *buf,int size,int rwflag,void *userdata) {(void)buf;(void)size;(void)rwflag;(void)userdata;return 0;}
static EVP_PKEY *private_key(const char *path) {
    char *pem=NULL;size_t size=0;if (!hf_protected_read(path,4096,&pem,&size)) return NULL;
    BIO *bio=BIO_new_mem_buf(pem,(int)size);EVP_PKEY *key=bio?PEM_read_bio_PrivateKey(bio,NULL,no_password,NULL):NULL;
    BIO_free(bio);OPENSSL_cleanse(pem,size);free(pem);
    if (key&&!EVP_PKEY_is_a(key,"ED25519")) {EVP_PKEY_free(key);return NULL;}
    return key;
}
int hf_transport_keygen(const char *path,char public_key[44]) {
    EVP_PKEY *key=EVP_PKEY_Q_keygen(NULL,NULL,"ED25519");BIO *bio=BIO_new(BIO_s_mem());int valid=0;
    if (key&&bio&&PEM_write_bio_PrivateKey(bio,key,NULL,NULL,0,NULL,NULL)==1) {
        char *pem=NULL;long size=BIO_get_mem_data(bio,&pem);unsigned char raw[32];size_t n=sizeof raw;
        if (size>0&&size<=4096&&EVP_PKEY_get_raw_public_key(key,raw,&n)==1&&n==32) {
            char *encoded=hf_base64url(raw,n);
            if (encoded&&strlen(encoded)==43&&hf_private_write(path,pem,(size_t)size,0)) {memcpy(public_key,encoded,44);valid=1;}
            free(encoded);
        }
        if (size>0) OPENSSL_cleanse(pem,(size_t)size);
    }
    BIO_free(bio);EVP_PKEY_free(key);return valid;
}
static int seconds_valid(const char *value) {
    if (!value||!*value||strlen(value)>12||(value[0]=='0'&&value[1])) return 0;
    for (const char *p=value;*p;++p) if (!isdigit((unsigned char)*p)) return 0;
    return 1;
}
int hf_transport_sign(const char *path,const char *domain,const char *endpoint,const char *origin,const char *identity,const char *seconds,const char *nonce,const char *body,char signature[87]) {
    if ((!strcmp(domain,"HYPERFIDE-REQUEST-V1")&&strcmp(endpoint,"/v1/invoke"))||(!strcmp(domain,"HYPERFIDE-ENROLL-V1")&&strcmp(endpoint,"/v1/enroll"))||(strcmp(domain,"HYPERFIDE-REQUEST-V1")&&strcmp(domain,"HYPERFIDE-ENROLL-V1"))||!origin_valid(origin)||!hf_uuid_valid(identity)||!seconds_valid(seconds)||!hf_uuid_valid(nonce)||strlen(body)>HF_BODY_LIMIT) return 0;
    char hash[65],message[2048];if (!hf_sha256_bytes(body,strlen(body),hash)) return 0;
    int n=snprintf(message,sizeof message,"%s\nPOST\n%s\n%s\n%s\n%s\n%s\nsha256:%s\n",domain,endpoint,origin,identity,seconds,nonce,hash);
    if (n<0||(size_t)n>=sizeof message) return 0;
    EVP_PKEY *key=private_key(path);EVP_MD_CTX *ctx=EVP_MD_CTX_new();unsigned char raw[64];size_t size=sizeof raw;int valid=0;
    if (key&&ctx&&EVP_DigestSignInit(ctx,NULL,NULL,NULL,key)==1&&EVP_DigestSign(ctx,raw,&size,(unsigned char *)message,(size_t)n)==1&&size==64) {
        char *encoded=hf_base64url(raw,size);if (encoded&&strlen(encoded)==86) {memcpy(signature,encoded,87);valid=1;}free(encoded);
    }
    EVP_MD_CTX_free(ctx);EVP_PKEY_free(key);return valid;
}
/* Runtime libraries must still satisfy the link contract the binary was built for. */
int hf_transport_qualified(void) {
    const curl_version_info_data *version=curl_version_info(CURLVERSION_NOW);
    return version&&version->version_num>=0x075500&&version->ssl_version&&!strncmp(version->ssl_version,"OpenSSL/",8)&&(version->features&CURL_VERSION_SSL)&&OpenSSL_version_num()>=0x30000000UL;
}
static pthread_once_t curl_once=PTHREAD_ONCE_INIT;
static int curl_ready;
static void curl_initialize(void) {curl_ready=curl_global_init(CURL_GLOBAL_DEFAULT)==CURLE_OK;}
static size_t response_write(char *data,size_t size,size_t count,void *opaque) {
    HfHttpResponse *response=opaque;
    if (size&&count>SIZE_MAX/size) return 0;
    size_t n=size*count;
    if (n>HF_BODY_LIMIT-response->length||memchr(data,0,n)) return 0;
    char *next=realloc(response->body,response->length+n+1);if (!next) return 0;
    response->body=next;memcpy(next+response->length,data,n);response->length+=n;next[response->length]=0;return n;
}
int hf_transport_post(const HfTransportConfig *config,int enrollment,const char *body,const char *seconds,const char *nonce,HfHttpResponse *response) {
    memset(response,0,sizeof *response);
    if (!config||!body||strlen(body)>HF_BODY_LIMIT||!origin_valid(config->origin)) {snprintf(response->error,sizeof response->error,"INVALID_TRANSPORT_INPUT");return 0;}
    if (!hf_transport_qualified()) {snprintf(response->error,sizeof response->error,"UNQUALIFIED_NATIVE_TLS_RUNTIME");return 0;}
    pthread_once(&curl_once,curl_initialize);
    if (!curl_ready) return 0;
    char identity[37],authorization[256]="",signature[87],auto_seconds[32],auto_nonce[37];
    if (!seconds) {snprintf(auto_seconds,sizeof auto_seconds,"%lld",(long long)time(NULL));seconds=auto_seconds;}
    if (!nonce) {if (!hf_uuid_generate(auto_nonce)) return 0;nonce=auto_nonce;}
    if (enrollment) {
        char *grant=NULL;size_t length=0;HfJson *json=malloc(sizeof *json);char secret[44];
        const char *allowed[]={"grant_id","secret_b64"};
        int valid=json&&hf_private_read(config->grant_path,1024,&grant,&length)&&hf_json_parse(json,grant)&&hf_json_only(json,0,allowed,2)&&hf_json_get(json,"grant_id",identity,sizeof identity)&&hf_uuid_valid(identity)&&hf_json_get(json,"secret_b64",secret,sizeof secret);
        size_t decoded_length=0;unsigned char *decoded=valid?hf_base64url_decode(secret,&decoded_length):NULL;
        valid=valid&&decoded&&decoded_length==32;
        if (valid) snprintf(authorization,sizeof authorization,"Authorization: HyperfideGrant %s.%s",identity,secret);
        if (decoded) {OPENSSL_cleanse(decoded,decoded_length);free(decoded);}
        if (grant) {OPENSSL_cleanse(grant,length);free(grant);}free(json);OPENSSL_cleanse(secret,sizeof secret);
        if (!valid) {snprintf(response->error,sizeof response->error,"INVALID_GRANT_FILE");return 0;}
    } else {snprintf(identity,sizeof identity,"%s",config->credential_id);if (!hf_uuid_valid(identity)) return 0;}
    const char *endpoint=enrollment?"/v1/enroll":"/v1/invoke";
    const char *domain=enrollment?"HYPERFIDE-ENROLL-V1":"HYPERFIDE-REQUEST-V1";
    if (!hf_transport_sign(config->key_path,domain,endpoint,config->origin,identity,seconds,nonce,body,signature)) {OPENSSL_cleanse(authorization,sizeof authorization);snprintf(response->error,sizeof response->error,"INVALID_SIGNING_KEY_OR_PROOF");return 0;}
    char url[1024],header[256];snprintf(url,sizeof url,"%s%s",config->origin,endpoint);
    struct curl_slist *headers=NULL;
    headers=curl_slist_append(headers,"Content-Type: application/json");
    headers=curl_slist_append(headers,"Accept: application/json");
    headers=curl_slist_append(headers,"Expect:");
    snprintf(header,sizeof header,"HF-Request-Time: %s",seconds);headers=curl_slist_append(headers,header);
    snprintf(header,sizeof header,"HF-Request-Nonce: %s",nonce);headers=curl_slist_append(headers,header);
    snprintf(header,sizeof header,"HF-Request-Signature: %s",signature);headers=curl_slist_append(headers,header);
    if (enrollment) headers=curl_slist_append(headers,authorization);
    else {snprintf(header,sizeof header,"HF-Credential-Id: %s",identity);headers=curl_slist_append(headers,header);}
    CURL *curl=curl_easy_init();CURLcode code=CURLE_FAILED_INIT;int configured=curl&&headers;
#define HF_CURL(option,value) do {if (configured&&curl_easy_setopt(curl,option,value)!=CURLE_OK) configured=0;} while (0)
    HF_CURL(CURLOPT_URL,url);HF_CURL(CURLOPT_POST,1L);HF_CURL(CURLOPT_POSTFIELDS,body);HF_CURL(CURLOPT_POSTFIELDSIZE_LARGE,(curl_off_t)strlen(body));
    HF_CURL(CURLOPT_HTTPHEADER,headers);HF_CURL(CURLOPT_PROTOCOLS_STR,"HTTPS");HF_CURL(CURLOPT_REDIR_PROTOCOLS_STR,"HTTPS");HF_CURL(CURLOPT_FOLLOWLOCATION,0L);
    HF_CURL(CURLOPT_SSL_VERIFYPEER,1L);HF_CURL(CURLOPT_SSL_VERIFYHOST,2L);HF_CURL(CURLOPT_SSLVERSION,CURL_SSLVERSION_TLSv1_2);
    HF_CURL(CURLOPT_PROXY,"");HF_CURL(CURLOPT_NOSIGNAL,1L);HF_CURL(CURLOPT_CONNECTTIMEOUT_MS,config->timeout_ms);HF_CURL(CURLOPT_TIMEOUT_MS,config->timeout_ms);
    HF_CURL(CURLOPT_WRITEFUNCTION,response_write);HF_CURL(CURLOPT_WRITEDATA,response);
    if (*config->ca_file) {
        char *ca=NULL;size_t ca_size=0;
        if (!protected_read_mode(config->ca_file,65536,&ca,&ca_size,1)||!ca_size) {
            free(ca);curl_easy_cleanup(curl);curl_slist_free_all(headers);OPENSSL_cleanse(authorization,sizeof authorization);
            snprintf(response->error,sizeof response->error,"INVALID_PROTECTED_CA");return 0;
        }
        struct curl_blob anchor={.data=ca,.len=ca_size,.flags=CURL_BLOB_COPY};
        HF_CURL(CURLOPT_CAINFO_BLOB,&anchor);free(ca);
    }
    if (configured) {
        code=curl_easy_perform(curl);curl_easy_getinfo(curl,CURLINFO_RESPONSE_CODE,&response->status);
        if (code!=CURLE_OK) {
            curl_off_t uploaded=0;curl_easy_getinfo(curl,CURLINFO_SIZE_UPLOAD_T,&uploaded);
            response->uncertain=uploaded>0||code==CURLE_OPERATION_TIMEDOUT||code==CURLE_RECV_ERROR||code==CURLE_GOT_NOTHING;
        }
    }
#undef HF_CURL
    if (code!=CURLE_OK) snprintf(response->error,sizeof response->error,"HTTPS_TRANSPORT_%d",(int)code);
    if (!response->body) response->body=strdup("");
    curl_easy_cleanup(curl);curl_slist_free_all(headers);OPENSSL_cleanse(authorization,sizeof authorization);
    return code==CURLE_OK;
}
char *hf_envelope(const char *payload,const char *operation,const char *idempotency,const char *correlation,const char *causation) {
    if (!payload||!hf_uuid_valid(operation)||!hf_uuid_valid(idempotency)||!hf_uuid_valid(correlation)||(causation&&!hf_uuid_valid(causation))||strlen(payload)>768U*1024U) return NULL;
    HfJson *json=malloc(sizeof *json);if (!json) return NULL;
    int valid=hf_json_parse(json,payload);free(json);if (!valid) return NULL;
    char hash[65];if (!hf_sha256_bytes(payload,strlen(payload),hash)) return NULL;
    char *encoded=hf_base64url((const unsigned char *)payload,strlen(payload));if (!encoded) return NULL;
    char *body=NULL;size_t n=0;FILE *out=open_memstream(&body,&n);
    if (!out) {free(encoded);return NULL;}
    fprintf(out,"{\"protocol_version\":1,\"operation_id\":\"%s\",\"idempotency_key\":\"%s\",\"payload_digest\":\"sha256:%s\",\"correlation_id\":\"%s\",\"causation_id\":",operation,idempotency,hash,correlation);
    if (causation) hf_json_write_string(out,causation);else fputs("null",out);
    fputs(",\"payload_b64\":",out);hf_json_write_string(out,encoded);fputc('}',out);free(encoded);
    if (fclose(out)||n>HF_BODY_LIMIT) {free(body);return NULL;}
    return body;
}
void hf_http_response_free(HfHttpResponse *response) {free(response->body);memset(response,0,sizeof *response);}
