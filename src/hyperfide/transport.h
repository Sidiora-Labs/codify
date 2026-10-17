#ifndef HYPERFIDE_TRANSPORT_H
#define HYPERFIDE_TRANSPORT_H
#include <stdio.h>
#include <stdint.h>
#include <stddef.h>
#include <sys/types.h>
#define HF_BODY_LIMIT (1024U * 1024U)
#define HF_JSON_TOKENS 65536
typedef struct { size_t start, end; int parent, next, count; char type; } HfJsonToken;
typedef struct { const char *text; size_t length; int count; HfJsonToken tokens[HF_JSON_TOKENS]; } HfJson;
int hf_json_parse(HfJson *json,const char *text);
int hf_json_field(const HfJson *json,int object,const char *name);
int hf_json_string(const HfJson *json,int token,char *output,size_t capacity);
int hf_json_get(const HfJson *json,const char *name,char *output,size_t capacity);
int hf_json_only(const HfJson *json,int object,const char *const *names,size_t count);
char *hf_json_raw(const HfJson *json,int token);
int hf_json_bool(const HfJson *json,int token,int *output);
int hf_json_i64(const HfJson *json,int token,int64_t *output);
void hf_json_write_string(FILE *output,const char *value);
int hf_uuid_valid(const char *value);
int hf_uuid_generate(char output[37]);
int hf_sha256_bytes(const void *data,size_t length,char output[65]);
char *hf_base64url(const unsigned char *data,size_t length);
unsigned char *hf_base64url_decode(const char *text,size_t *length);
int hf_private_read(const char *path,size_t maximum,char **data,size_t *length);
/* Protected operator files may be root-owned and readable by the target primary GID.
 * Unlike private process state, these files must remain immutable to that child. */
int hf_protected_read(const char *path,size_t maximum,char **data,size_t *length);
int hf_private_write(const char *path,const void *data,size_t length,int replace);
int hf_native_error(FILE *output,const char *code);
typedef struct {
    char origin[512],ca_file[4096],key_path[4096],credential_id[37],grant_path[4096],run_id[37];
    long timeout_ms;
} HfTransportConfig;
typedef struct { long status;char *body;size_t length;int uncertain;char error[128]; } HfHttpResponse;
int hf_transport_qualified(void);
int hf_transport_config(const char *path,HfTransportConfig *config);
int hf_transport_keygen(const char *path,char public_key[44]);
int hf_transport_sign(const char *key_path,const char *domain,const char *endpoint,
 const char *origin,const char *identity,const char *seconds,const char *nonce,const char *body,char signature[87]);
int hf_transport_post(const HfTransportConfig *config,int enrollment,const char *body,
 const char *seconds,const char *nonce,HfHttpResponse *response);
char *hf_envelope(const char *payload,const char *operation_id,const char *idempotency_key,
 const char *correlation_id,const char *causation_id);
void hf_http_response_free(HfHttpResponse *response);
#endif
