# Source reference: C core: native components

This part of the [source reference](../SOURCE-REFERENCE.md) lists the indexed declarations of the Hyperfide native components under `src/hyperfide/`: command branding, the control client, the supervisor and its daemon, transport, preparation, connectors, checkpoints, budgets, readiness and the component entry points: 709 declarations in 26 files at revision `a2a367f9` of the Hyperfide 2.0 development tree (`hyperfide version` 2.0.0-dev, not a release). Method, column meanings and caveats are described in the entry point; source links resolve from this directory and line numbers refer to revision `a2a367f9`.

## src/hyperfide/advisory.c

[Open source](../../src/hyperfide/advisory.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `hf_advisory_purposes` | variable | 6 | <code>static const char &#42;const hf_advisory_purposes&#91;&#93;={"guard","readiness","triage","memory","recap",NULL};</code> |
| `hf_advisory_phases` | variable | 7 | <code>static const char &#42;const hf_advisory_phases&#91;&#93;={"submit","result",NULL};</code> |
| `hf_advisory_known` | function | 9 | <code>static int hf_advisory_known(const char &#42;const &#42;list,const char &#42;value){</code> |
| `hf_advisory_action_name` | function | 14 | <code>int hf_advisory_action_name(const char &#42;purpose,const char &#42;phase,char &#42;out,size_t size){</code> |
| `hf_advisory_ws` | function | 20 | <code>static const char &#42;hf_advisory_ws(const char &#42;p){while(isspace((unsigned char)&#42;p))p++;return p;}</code> |
| `hf_advisory_fields` | function | 23 | <code>static int hf_advisory_fields(const char &#42;json,const char &#42;const &#42;names,char values&#91;&#93;&#91;32&#93;,size_t count){</code> |
| `hf_advisory_error` | function | 52 | <code>static int hf_advisory_error(FILE &#42;output,const char &#42;code,const char &#42;message){</code> |
| `hf_component_21_4` | function | 57 | <code>int hf_component_21_4(const char &#42;action,const char &#42;request_json,FILE &#42;output){</code> |

## src/hyperfide/advisory.h

[Open source](../../src/hyperfide/advisory.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `HYPERFIDE_ADVISORY_H` | macro | 2 | <code>#define HYPERFIDE_ADVISORY_H</code> |
| `HF_ADVISORY_BUDGET_MS` | macro | 9 | <code>#define HF_ADVISORY_BUDGET_MS 2000</code> |
| `HF_ADVISORY_JOB_DEADLINE_MS` | macro | 10 | <code>#define HF_ADVISORY_JOB_DEADLINE_MS 1500</code> |
| `hf_advisory_action_name` | function | 12 | <code>int hf_advisory_action_name(const char &#42;purpose,const char &#42;phase,char &#42;out,size_t size);</code> |
| `hf_component_21_4` | function | 13 | <code>int hf_component_21_4(const char &#42;action,const char &#42;request_json,FILE &#42;output);</code> |

## src/hyperfide/bootstrap.c

[Open source](../../src/hyperfide/bootstrap.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `_GNU_SOURCE` | macro | 3 | <code>#define _GNU_SOURCE</code> |
| `HpRepository` | typedef | 9 | <code>typedef struct {</code> |
| `HpLock` | typedef | 14 | <code>typedef struct {</code> |
| `HpCommand` | typedef | 17 | <code>typedef struct {</code> |
| `bootstrap_signal` | function | 22 | <code>static void bootstrap_signal(int signal_number) {</code> |
| `repository_index` | function | 26 | <code>static int repository_index(HpRepository &#42;repos, int count, const char &#42;id) {</code> |
| `source_allowed` | function | 32 | <code>static int source_allowed(const char &#42;source) {</code> |
| `log_run` | function | 51 | <code>static int log_run(const char &#42;cwd, const char &#42;temporary, int &#42;sequence,</code> |
| `git_run` | function | 61 | <code>static int git_run(const char &#42;cwd, const char &#42;temporary, int &#42;seq,</code> |
| `file_digest` | function | 94 | <code>static int file_digest(const char &#42;directory, const char &#42;path,</code> |
| `parse_repositories` | function | 105 | <code>static int parse_repositories(const char &#42;raw, HpRepository &#42;&#42;out, int &#42;count) {</code> |
| `parse_locks` | function | 151 | <code>static int parse_locks(const char &#42;raw, HpLock &#42;&#42;out, int &#42;count,</code> |
| `commands_free` | function | 185 | <code>static void commands_free(HpCommand &#42;items, int count) {</code> |
| `parse_commands` | function | 195 | <code>static int parse_commands(const char &#42;raw, HpCommand &#42;&#42;out, int &#42;count,</code> |
| `verify_git_head` | function | 251 | <code>static int verify_git_head(const char &#42;repo, const char &#42;temporary, int &#42;seq,</code> |
| `git_output` | function | 269 | <code>static char &#42;git_output(const char &#42;repo, const char &#42;temporary, int &#42;sequence,</code> |
| `submodule_pin` | function | 306 | <code>static int submodule_pin(const char &#42;pins, const char &#42;path,</code> |
| `materialize_modules` | function | 330 | <code>static int materialize_modules(const char &#42;repo, const char &#42;prefix,</code> |
| `verify_modules` | function | 441 | <code>static int verify_modules(const char &#42;repo, const char &#42;pins,</code> |
| `git_metadata_digest` | function | 468 | <code>static int git_metadata_digest(const char &#42;repo, const char &#42;temporary,</code> |
| `verify_locks` | function | 554 | <code>static int verify_locks(const char &#42;temporary, HpLock &#42;locks, int count,</code> |
| `parse_cache_paths` | function | 567 | <code>static int parse_cache_paths(const char &#42;raw, HpLock &#42;&#42;out, int &#42;count,</code> |
| `copy_file_at` | function | 613 | <code>static int copy_file_at(int source_root, const char &#42;source_relative,</code> |
| `read_manifest_at` | function | 702 | <code>static char &#42;read_manifest_at(int root, const char &#42;name) {</code> |
| `cache_manifest` | function | 737 | <code>static int cache_manifest(int fd, HpLock &#42;paths, int count, const char &#42;key,</code> |
| `cache_capture` | function | 783 | <code>static int cache_capture(int cache, const char &#42;cachehex, const char &#42;key,</code> |
| `materialize` | function | 862 | <code>static int materialize(const char &#42;action, const char &#42;request,</code> |
| `reap_orphans` | function | 1232 | <code>static void reap_orphans(void) {</code> |
| `hf_component_11_2` | function | 1246 | <code>int hf_component_11_2(const char &#42;action, const char &#42;request, FILE &#42;output) {</code> |

## src/hyperfide/branding.c

[Open source](../../src/hyperfide/branding.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `empty_object` | function | 6 | <code>static int empty_object(const char &#42;p) {</code> |
| `hf_component_branding` | function | 15 | <code>int hf_component_branding(const char &#42;action, const char &#42;request_json, FILE &#42;output) {</code> |

## src/hyperfide/budget.c

[Open source](../../src/hyperfide/budget.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `_GNU_SOURCE` | macro | 1 | <code>#define _GNU_SOURCE</code> |
| `CGROUP2_MAGIC` | macro | 20 | <code>#define CGROUP2_MAGIC 0x63677270</code> |
| `state` | function | 21 | <code>static int state(HfBudgetHandle &#42;h,int value,const char &#42;reason){h-&gt;status=value;snprintf(h-&gt;reason,sizeof h-&gt;reason,"%s",reason);return value;}</code> |
| `number` | function | 22 | <code>static int number(const char &#42;text,unsigned long long &#42;value){</code> |
| `decimal_at` | function | 27 | <code>static int decimal_at(const HfJson &#42;j,int object,const char &#42;name,unsigned long long &#42;value){</code> |
| `string_at` | function | 30 | <code>static int string_at(const HfJson &#42;j,int object,const char &#42;name,char &#42;out,size_t n){return hf_json_string(j,hf_json_field(j,object,name),out,n);}</code> |
| `digest` | function | 31 | <code>static int digest(const char &#42;s){if(strlen(s)!=71&#124;&#124;strncmp(s,"sha256:",7))return 0;for(int k=7;k&lt;71;k++)if(!isdigit((unsigned char)s&#91;k&#93;)&amp;&amp;(s&#91;k&#93;&lt;'a'&#124;&#124;s&#91;k&#93;&gt;'f'))return 0;return 1;}</code> |
| `uid_at` | function | 32 | <code>static int uid_at(const HfJson &#42;j,int object,const char &#42;name,unsigned long long &#42;value){</code> |
| `protected_dir` | function | 35 | <code>static int protected_dir(int fd,int sticky){</code> |
| `directory` | function | 40 | <code>static int directory(const char &#42;path,int sticky){</code> |
| `config_read` | function | 50 | <code>static char &#42;config_read(const char &#42;path){</code> |
| `read_at` | function | 63 | <code>static int read_at(int fd,const char &#42;name,char &#42;out,size_t capacity){</code> |
| `write_at` | function | 70 | <code>static int write_at(int fd,const char &#42;name,const char &#42;text){</code> |
| `same_fd` | function | 74 | <code>static int same_fd(int fd,dev_t dev,ino_t ino){</code> |
| `leaf` | function | 77 | <code>static const char &#42;leaf(const HfBudgetHandle &#42;h){const char &#42;p=strrchr(h-&gt;cgroup_path,'/');return p?p+1:"";}</code> |
| `pinned` | function | 78 | <code>static int pinned(const HfBudgetHandle &#42;h,int child){</code> |
| `word` | function | 84 | <code>static int word(const char &#42;text,const char &#42;wanted){</code> |
| `decode_mount` | function | 87 | <code>static int decode_mount(char &#42;text){</code> |
| `beneath` | function | 90 | <code>static int beneath(const char &#42;path,const char &#42;parent){size_t n=strlen(parent);return !strcmp(parent,"/")?path&#91;0&#93;=='/':!strncmp(path,parent,n)&amp;&amp;(path&#91;n&#93;==0&#124;&#124;path&#91;n&#93;=='/');}</code> |
| `mountpoint` | function | 91 | <code>static int mountpoint(const char &#42;root,char output&#91;4096&#93;){</code> |
| `cpu_limit` | function | 98 | <code>static int cpu_limit(const char &#42;text,unsigned long long &#42;quota,unsigned long long &#42;period,int &#42;finite){</code> |
| `remaining` | function | 101 | <code>static int remaining(const char &#42;root,unsigned long long &#42;cpu,unsigned long long &#42;memory){</code> |
| `resources` | function | 111 | <code>static int resources(const HfJson &#42;j,int object,const char &#42;name,unsigned long long out&#91;3&#93;){</code> |
| `parsed` | function | 114 | <code>static int parsed(HfBudgetHandle &#42;h,const HfJson &#42;config,const HfJson &#42;wrapper,char root&#91;4096&#93;){</code> |
| `swap_unavailable_safe` | function | 132 | <code>static int swap_unavailable_safe(void);</code> |
| `hf_budget_prepare` | function | 133 | <code>int hf_budget_prepare(const char &#42;config_path,const char &#42;authenticated_charge_json,HfBudgetHandle &#42;h){</code> |
| `swap_unavailable_safe` | function | 162 | <code>static int swap_unavailable_safe(void){</code> |
| `limits_current` | function | 167 | <code>static int limits_current(const HfBudgetHandle &#42;h){</code> |
| `member` | function | 174 | <code>static int member(const HfBudgetHandle &#42;h,pid_t pid){</code> |
| `process_credentials` | function | 177 | <code>static int process_credentials(pid_t pid,uid_t uid,gid_t gid){</code> |
| `quiescent` | function | 198 | <code>static int quiescent(const HfBudgetHandle &#42;h){</code> |
| `hf_budget_attach` | function | 203 | <code>int hf_budget_attach(HfBudgetHandle &#42;h,const HfProcessIdentity &#42;expected){</code> |
| `hf_budget_observe` | function | 216 | <code>int hf_budget_observe(const HfBudgetHandle &#42;h,FILE &#42;out){</code> |
| `hf_budget_release` | function | 226 | <code>int hf_budget_release(HfBudgetHandle &#42;h){</code> |

## src/hyperfide/checkpoint.c

[Open source](../../src/hyperfide/checkpoint.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `_GNU_SOURCE` | macro | 4 | <code>#define _GNU_SOURCE</code> |
| `sha256_hex` | function | 22 | <code>extern void sha256_hex(const void &#42;, size_t, char&#91;65&#93;);</code> |
| `MAX_CAP` | macro | 23 | <code>#define MAX_CAP (128U &#42; 1024U &#42; 1024U)</code> |
| `MAX_TREE` | macro | 24 | <code>#define MAX_TREE (64U &#42; 1024U &#42; 1024U)</code> |
| `MAX_FILE` | macro | 25 | <code>#define MAX_FILE (16U &#42; 1024U &#42; 1024U)</code> |
| `MAX_ITEMS` | macro | 26 | <code>#define MAX_ITEMS 20000U</code> |
| `CHUNK` | macro | 27 | <code>#define CHUNK 196608U</code> |
| `Buf` | typedef | 28 | <code>typedef struct {</code> |
| `Pair` | typedef | 32 | <code>typedef struct {</code> |
| `Obj` | typedef | 36 | <code>typedef struct {</code> |
| `Name` | typedef | 40 | <code>typedef struct {</code> |
| `bad` | function | 45 | <code>static int bad(const char &#42;s) {</code> |
| `append` | function | 49 | <code>static int append(Buf &#42;b, const void &#42;p, size_t n) {</code> |
| `u32` | function | 67 | <code>static int u32(Buf &#42;b, uint32_t v) {</code> |
| `u64` | function | 73 | <code>static int u64(Buf &#42;b, uint64_t v) {</code> |
| `r32` | function | 79 | <code>static uint32_t r32(const unsigned char &#42;p) {</code> |
| `r64` | function | 85 | <code>static uint64_t r64(const unsigned char &#42;p) {</code> |
| `drop` | function | 91 | <code>static void drop(Buf &#42;b) {</code> |
| `writeall` | function | 95 | <code>static int writeall(int fd, const void &#42;p, size_t n) {</code> |
| `readbuf` | function | 108 | <code>static int readbuf(int fd, Buf &#42;b, size_t max) {</code> |
| `stat_same` | function | 125 | <code>static int stat_same(const struct stat &#42;a, const struct stat &#42;b) {</code> |
| `safe_path` | function | 131 | <code>static int safe_path(const char &#42;s) {</code> |
| `open_dir_path` | function | 147 | <code>static int open_dir_path(const char &#42;path) {</code> |
| `beneath` | function | 174 | <code>static int beneath(int child, int ancestor) {</code> |
| `relative_dir` | function | 207 | <code>static int relative_dir(int root, const char &#42;path) {</code> |
| `skipws` | function | 226 | <code>static const char &#42;skipws(const char &#42;p) {</code> |
| `parse_string` | function | 233 | <code>static char &#42;parse_string(const char &#42;&#42;pp) {</code> |
| `freeobj` | function | 271 | <code>static void freeobj(Obj &#42;o) {</code> |
| `parse` | function | 275 | <code>static int parse(const char &#42;p, Obj &#42;o) {</code> |
| `get` | function | 318 | <code>static const char &#42;get(Obj &#42;o, const char &#42;k) {</code> |
| `allowed` | function | 324 | <code>static int allowed(Obj &#42;o, const char &#42;const &#42;keys) {</code> |
| `decimal` | function | 335 | <code>static int decimal(const char &#42;s, uint64_t &#42;val) {</code> |
| `hex` | function | 348 | <code>static int hex(const char &#42;s, size_t n) {</code> |
| `digest_ok` | function | 356 | <code>static int digest_ok(const char &#42;s) { return s &amp;&amp; !strncmp(s, "sha256:", 7) &amp;&amp; hex(s + 7, 64); }</code> |
| `uuid` | function | 357 | <code>static int uuid(const char &#42;s) {</code> |
| `hashbuf` | function | 369 | <code>static void hashbuf(Buf &#42;b, char out&#91;72&#93;) {</code> |
| `quoted` | function | 373 | <code>static int quoted(Buf &#42;b, const char &#42;s) {</code> |
| `field` | function | 390 | <code>static int field(Buf &#42;b, const char &#42;k, const char &#42;v, int &#42;first) {</code> |
| `command` | function | 396 | <code>static int command(int dir, const char &#42;const &#42;args, Buf &#42;out, int outputfd) {</code> |
| `GIT` | macro | 464 | <code>#define GIT(dir, out, ...) command(dir, (const char &#42;const&#91;&#93;){__VA_ARGS__, NULL}, out, -1)</code> |
| `gittext` | function | 465 | <code>static int gittext(int dir, Buf &#42;b, const char &#42;a, const char &#42;c) {</code> |
| `sensitive` | function | 472 | <code>static int sensitive(const char &#42;path) {</code> |
| `tracked_prefix` | function | 489 | <code>static int tracked_prefix(Buf &#42;tracked, const char &#42;path) {</code> |
| `cmpname` | function | 500 | <code>static int cmpname(const void &#42;a, const void &#42;b) {</code> |
| `addrecord` | function | 503 | <code>static int addrecord(Buf &#42;b, const char &#42;path, unsigned kind, unsigned mode, const void &#42;data,</code> |
| `collect` | function | 512 | <code>static int collect(int repo, int dir, const char &#42;prefix, Buf &#42;tracked, Buf &#42;tree,</code> |
| `filebuf` | function | 642 | <code>static int filebuf(int dir, const char &#42;name, Buf &#42;b) {</code> |
| `cleanup` | function | 655 | <code>static int cleanup(int dir, const char &#42;name) {</code> |
| `putfile` | function | 672 | <code>static int putfile(int dir, const char &#42;name, const void &#42;data, size_t n, unsigned mode) {</code> |
| `metadata` | function | 680 | <code>static int metadata(Obj &#42;o, const char &#42;head, unsigned rootmode, Buf &#42;meta) {</code> |
| `Parts` | typedef | 724 | <code>typedef struct {</code> |
| `partsdrop` | function | 727 | <code>static void partsdrop(Parts &#42;p) {</code> |
| `unpack` | function | 733 | <code>static int unpack(Buf &#42;b, Parts &#42;p) {</code> |
| `capsule` | function | 755 | <code>static int capsule(int spool, const char &#42;digest, Buf &#42;b, Parts &#42;p) {</code> |
| `capture` | function | 768 | <code>static int capture(Obj &#42;o, int root, int spool, FILE &#42;out) {</code> |
| `base64` | function | 945 | <code>static void base64(FILE &#42;out, const unsigned char &#42;p, size_t n) {</code> |
| `inspect_export` | function | 958 | <code>static int inspect_export(Obj &#42;o, int spool, FILE &#42;out, int exporting) {</code> |
| `parentfd` | function | 997 | <code>static int parentfd(int root, const char &#42;path, char &#42;&#42;leaf) {</code> |
| `clearwork` | function | 1016 | <code>static int clearwork(int fd) {</code> |
| `flush_git_tree` | function | 1034 | <code>static int flush_git_tree(int dir, unsigned depth) {</code> |
| `restore_tree` | function | 1070 | <code>static int restore_tree(int dir, Buf &#42;tree) {</code> |
| `restore` | function | 1184 | <code>static int restore(Obj &#42;o, int root, int spool, FILE &#42;out) {</code> |
| `hf_component_15_1` | function | 1299 | <code>int hf_component_15_1(const char &#42;action, const char &#42;request, FILE &#42;out) {</code> |

## src/hyperfide/client.c

[Open source](../../src/hyperfide/client.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `_GNU_SOURCE` | macro | 4 | <code>#define _GNU_SOURCE</code> |
| `hf_ws25` | function | 20 | <code>static const char &#42;hf_ws25(const char &#42;p){while(&#42;p&amp;&amp;isspace((unsigned char)&#42;p))p++;return p;}</code> |
| `hf_string25` | function | 21 | <code>static int hf_string25(const char &#42;&#42;cursor,char &#42;out,size_t cap){</code> |
| `hf_uuid25` | function | 27 | <code>static int hf_uuid25(const char &#42;s){</code> |
| `hf_descriptor25` | function | 31 | <code>static int hf_descriptor25(const char &#42;filename,int &#42;distributed){</code> |
| `hf_mode_at25` | function | 45 | <code>static int hf_mode_at25(const char &#42;selected_root){</code> |
| `hf_client_authority_mode` | function | 62 | <code>int hf_client_authority_mode(void){return hf_mode_at25(NULL);}</code> |
| `hf_client_authority_guard_at` | function | 63 | <code>int hf_client_authority_guard_at(const char &#42;operation,const char &#42;selected_root,FILE &#42;output){</code> |
| `hf_client_authority_guard` | function | 74 | <code>int hf_client_authority_guard(const char &#42;operation,FILE &#42;output){return hf_client_authority_guard_at(operation,NULL,output);}</code> |
| `hf_client_authority_guard_args` | function | 75 | <code>int hf_client_authority_guard_args(const char &#42;operation,int argc,char &#42;&#42;argv,FILE &#42;output){</code> |
| `hf_cache25` | function | 82 | <code>static void hf_cache25(FILE &#42;output,int mode){</code> |
| `hf_component_25_3` | function | 90 | <code>int hf_component_25_3(const char &#42;action,const char &#42;request_json,FILE &#42;output){</code> |
| `HF_CLIENT_BYTES25` | macro | 99 | <code>#define HF_CLIENT_BYTES25 (768U&#42;1024U)</code> |
| `hf_json25` | function | 100 | <code>static int hf_json25(const char &#42;data,size_t length,int response,const char &#42;operation){</code> |
| `hf_client_error25` | function | 115 | <code>static int hf_client_error25(FILE &#42;err,const char &#42;code,const char &#42;message){</code> |
| `hf_read25` | function | 118 | <code>static char &#42;hf_read25(const char &#42;filename,size_t &#42;length){</code> |
| `hf_load_transport25` | function | 125 | <code>static int hf_load_transport25(HfTransportConfig &#42;config,FILE &#42;err){</code> |
| `hf_invoke_config25` | function | 131 | <code>static int hf_invoke_config25(const HfTransportConfig &#42;supplied,const char &#42;payload,const char &#42;operation,const char &#42;idempotency,const char &#42;correlation,const char &#42;causation,FILE &#42;out,FILE &#42;err){</code> |
| `hf_remaining25` | function | 152 | <code>static long hf_remaining25(const struct timespec &#42;start,long budget){</code> |
| `hf_client_decision_invoke` | function | 157 | <code>int hf_client_decision_invoke(HfDecisionPurpose purpose,HfDecisionPhase phase,const char &#42;input,</code> |
| `hf_invoke25` | function | 193 | <code>static int hf_invoke25(const char &#42;payload,const char &#42;operation,const char &#42;idempotency,const char &#42;correlation,const char &#42;causation,FILE &#42;out,FILE &#42;err){</code> |
| `HfRoute25` | typedef | 196 | <code>typedef struct {const char &#42;command,&#42;subcommand,&#42;component,&#42;action;} HfRoute25;</code> |
| `hf_routes25` | variable | 197 | <code>static const HfRoute25 hf_routes25&#91;&#93;={</code> |
| `hf_client_mcp25` | function | 258 | <code>static int hf_client_mcp25(FILE &#42;out,FILE &#42;err);</code> |
| `hf_client_dispatch` | function | 259 | <code>int hf_client_dispatch(int argc,char &#42;&#42;argv,FILE &#42;out,FILE &#42;err){</code> |
| `HfMcpPolicy25` | typedef | 308 | <code>typedef struct {int restricted,bootstrap,bound;size_t count;char names&#91;128&#93;&#91;128&#93;,target&#91;37&#93;,run&#91;37&#93;,role&#91;33&#93;;} HfMcpPolicy25;</code> |
| `hf_mcp_allowed25` | function | 309 | <code>static int hf_mcp_allowed25(const HfMcpPolicy25 &#42;policy,const char &#42;name){</code> |
| `hf_mcp_known25` | function | 314 | <code>static int hf_mcp_known25(const char &#42;name){</code> |
| `hf_mcp_policy25` | function | 319 | <code>static int hf_mcp_policy25(HfMcpPolicy25 &#42;policy){</code> |
| `hf_mcp_subject25` | function | 351 | <code>static int hf_mcp_subject25(const HfMcpPolicy25 &#42;policy,HfTransportConfig &#42;config,FILE &#42;err){</code> |
| `hf_rpc_error25` | function | 367 | <code>static void hf_rpc_error25(FILE &#42;out,const char &#42;id,int code,const char &#42;message){</code> |
| `hf_rpc_tools25` | function | 371 | <code>static void hf_rpc_tools25(FILE &#42;out,const char &#42;id,const HfMcpPolicy25 &#42;policy){</code> |
| `hf_arg_string25` | function | 382 | <code>static int hf_arg_string25(const HfJson &#42;j,int args,const char &#42;name,char &#42;out,size_t capacity){</code> |
| `hf_rpc_call25` | function | 385 | <code>static void hf_rpc_call25(HfJson &#42;j,FILE &#42;out,const char &#42;id,const HfMcpPolicy25 &#42;policy){</code> |
| `hf_rpc_line25` | function | 432 | <code>static void hf_rpc_line25(const char &#42;line,FILE &#42;out,const HfMcpPolicy25 &#42;policy){</code> |
| `hf_client_mcp25` | function | 447 | <code>static int hf_client_mcp25(FILE &#42;out,FILE &#42;err){</code> |

## src/hyperfide/client.h

[Open source](../../src/hyperfide/client.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `HYPERFIDE_CLIENT_H` | macro | 2 | <code>#define HYPERFIDE_CLIENT_H</code> |
| `HfDecisionPurpose` | typedef | 4 | <code>typedef enum {</code> |
| `HfDecisionPhase` | typedef | 8 | <code>typedef enum {HF_DECISION_SUBMIT=1,HF_DECISION_RESULT} HfDecisionPhase;</code> |
| `hf_client_dispatch` | function | 9 | <code>int hf_client_dispatch(int argc,char &#42;&#42;argv,FILE &#42;output,FILE &#42;error);</code> |
| `hf_client_authority_mode` | function | 10 | <code>int hf_client_authority_mode(void);</code> |
| `hf_client_decision_invoke` | function | 11 | <code>int hf_client_decision_invoke(HfDecisionPurpose purpose,HfDecisionPhase phase,</code> |

## src/hyperfide/component_main.c

[Open source](../../src/hyperfide/component_main.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `_GNU_SOURCE` | macro | 2 | <code>#define _GNU_SOURCE</code> |
| `HF_JSON_LIMIT` | macro | 11 | <code>#define HF_JSON_LIMIT (1024U &#42; 1024U)</code> |
| `ws` | function | 14 | <code>static const char &#42;ws(const char &#42;p) {</code> |
| `value` | function | 18 | <code>static const char &#42;value(const char &#42;p, unsigned depth);</code> |
| `string_end` | function | 20 | <code>static const char &#42;string_end(const char &#42;p) {</code> |
| `number_end` | function | 53 | <code>static const char &#42;number_end(const char &#42;p) {</code> |
| `value` | function | 74 | <code>static const char &#42;value(const char &#42;p, unsigned depth) {</code> |
| `object_valid` | function | 104 | <code>static int object_valid(const char &#42;p, size_t length) {</code> |
| `failure` | function | 112 | <code>static int failure(const char &#42;code, const char &#42;message) {</code> |
| `request_decode` | function | 117 | <code>static int request_decode(const char &#42;encoded,char &#42;out,size_t &#42;length) {</code> |
| `main` | function | 133 | <code>int main(int argc, char &#42;&#42;argv) {</code> |

## src/hyperfide/components.h

[Open source](../../src/hyperfide/components.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `HYPERFIDE_COMPONENTS_H` | macro | 2 | <code>#define HYPERFIDE_COMPONENTS_H</code> |
| `HfNativeEntry` | typedef | 8 | <code>typedef int (&#42;HfNativeEntry)(const char &#42;action, const char &#42;request_json, FILE &#42;output);</code> |
| `HfNativeAction` | typedef | 9 | <code>typedef struct {</code> |

## src/hyperfide/connector_recovery.c

[Open source](../../src/hyperfide/connector_recovery.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `_GNU_SOURCE` | macro | 3 | <code>#define _GNU_SOURCE</code> |
| `Field` | typedef | 20 | <code>typedef struct { char key&#91;64&#93;; const char &#42;start; size_t len; } Field;</code> |
| `space` | function | 21 | <code>static const char &#42;space(const char &#42;p){while(&#42;p&amp;&amp;strchr(" &#92;t&#92;r&#92;n",&#42;p))p++;return p;}</code> |
| `endstr` | function | 22 | <code>static const char &#42;endstr(const char &#42;p){if(&#42;p++!='"')return NULL;while(&#42;p&amp;&amp;&#42;p!='"'){if((unsigned char)&#42;p&lt;32)return NULL;if(&#42;p++=='&#92;&#92;'){if(!&#42;p)return NULL;if(&#42;p=='u'){p++;for(int i=0;i&lt;4;i++)if(!isxdi…</code> |
| `skip` | function | 23 | <code>static const char &#42;skip(const char &#42;p,unsigned d){p=space(p);if(d&gt;32)return NULL;if(&#42;p=='"')return endstr(p);if(&#42;p=='{'&#124;&#124;&#42;p=='&#91;'){int obj=&#42;p=='{';char close=obj?'}':'&#93;';p=space(p+1);if(&#42;p==close)retur…</code> |
| `fields` | function | 24 | <code>static int fields(const char &#42;json,Field &#42;fs,int cap,const char &#42;allowed){const char &#42;p=space(json);int n=0;if(&#42;p++!='{')return -1;p=space(p);if(&#42;p=='}')return &#42;space(p+1)?-1:0;for(;;){const char &#42;q=e…</code> |
| `field` | function | 25 | <code>static Field &#42;field(Field &#42;fs,int n,const char &#42;k){for(int i=0;i&lt;n;i++)if(!strcmp(fs&#91;i&#93;.key,k))return fs+i;return NULL;}</code> |
| `string` | function | 26 | <code>static int string(Field &#42;f,char &#42;dst,size_t cap){if(!f&#124;&#124;f-&gt;len&lt;2&#124;&#124;&#42;f-&gt;start!='"')return 0;size_t j=0;const char &#42;p=f-&gt;start+1,&#42;e=f-&gt;start+f-&gt;len-1;while(p&lt;e){unsigned char ch=(unsigned char)&#42;p++;if(ch…</code> |
| `quoted` | function | 27 | <code>static void quoted(FILE &#42;o,const char &#42;s){fputc('"',o);for(const unsigned char &#42;p=(const unsigned char&#42;)s;&#42;p;p++){switch(&#42;p){case '"':fputs("&#92;&#92;&#92;"",o);break;case '&#92;&#92;':fputs("&#92;&#92;&#92;&#92;",o);break;case '&#92;n':fp…</code> |
| `error` | function | 28 | <code>static int error(FILE &#42;o,const char &#42;code){fprintf(o,"{&#92;"error&#92;":{&#92;"code&#92;":&#92;"%s&#92;"}}",code);return 1;}</code> |
| `safe_id` | function | 29 | <code>static int safe_id(const char &#42;s){if(!&#42;s&#124;&#124;strlen(s)&gt;128)return 0;for(;&#42;s;s++)if(!isalnum((unsigned char)&#42;s)&amp;&amp;!strchr("._:-",&#42;s))return 0;return 1;}</code> |
| `digest` | function | 31 | <code>static int digest(const char &#42;s){if(strlen(s)!=71&#124;&#124;strncmp(s,"sha256:",7))return 0;for(s+=7;&#42;s;s++)if(!strchr("0123456789abcdef",&#42;s))return 0;return 1;}</code> |
| `get` | function | 32 | <code>static int get(Field &#42;fs,int n,const char &#42;key,char &#42;out,size_t size){return string(field(fs,n,key),out,size);}</code> |
| `integer` | function | 33 | <code>static int integer(Field &#42;f,unsigned long long max,unsigned long long &#42;out){if(!f&#124;&#124;!f-&gt;len&#124;&#124;f-&gt;len&gt;20&#124;&#124;(f-&gt;len&gt;1&amp;&amp;&#42;f-&gt;start=='0'))return 0;unsigned long long v=0;for(size_t i=0;i&lt;f-&gt;len;i++){if(!isdig…</code> |
| `decimal` | function | 34 | <code>static int decimal(const char &#42;s,unsigned long long &#42;out){if(!&#42;s&#124;&#124;strlen(s)&gt;20&#124;&#124;(s&#91;0&#93;=='0'&amp;&amp;s&#91;1&#93;))return 0;Field f={"",s,strlen(s)};return integer(&amp;f,~0ULL,out);}</code> |
| `is_null` | function | 35 | <code>static int is_null(Field &#42;f){return f&amp;&amp;f-&gt;len==4&amp;&amp;!memcmp(f-&gt;start,"null",4);}</code> |
| `hf_connector_resume_qualified` | function | 36 | <code>extern int hf_connector_resume_qualified(const char &#42;,char &#42;,size_t);</code> |
| `Observation` | typedef | 39 | <code>typedef struct {const char &#42;state;HfProcessIdentity seen;int have;char kernel_boot&#91;64&#93;;} Observation;</code> |
| `observe` | function | 40 | <code>static void observe(pid_t pid,const char &#42;boot,unsigned long long start,Observation &#42;o){</code> |
| `pipe_observe` | function | 50 | <code>static const char &#42;pipe_observe(int fd,int &#42;pending){</code> |
| `handoff_bound` | function | 59 | <code>static const char &#42;handoff_bound(const char &#42;doc,const char &#42;want,const char &#42;connector,const char &#42;native,const char &#42;fresh,const char &#42;source,const char &#42;configuration,const char &#42;checkpoint,char &#42;c…</code> |
| `opt` | function | 72 | <code>static void opt(FILE &#42;o,const char &#42;s){if(s&amp;&amp;&#42;s)quoted(o,s);else fputs("null",o);}</code> |
| `hf_component_13_3` | function | 73 | <code>int hf_component_13_3(const char &#42;action,const char &#42;json,FILE &#42;out){</code> |

## src/hyperfide/connectors.c

[Open source](../../src/hyperfide/connectors.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `_GNU_SOURCE` | macro | 3 | <code>#define _GNU_SOURCE</code> |
| `Field` | typedef | 20 | <code>typedef struct { char key&#91;64&#93;; const char &#42;start; size_t len; } Field;</code> |
| `space` | function | 21 | <code>static const char &#42;space(const char &#42;p){while(&#42;p&amp;&amp;strchr(" &#92;t&#92;r&#92;n",&#42;p))p++;return p;}</code> |
| `endstr` | function | 22 | <code>static const char &#42;endstr(const char &#42;p){if(&#42;p++!='"')return NULL;while(&#42;p&amp;&amp;&#42;p!='"'){if((unsigned char)&#42;p&lt;32)return NULL;if(&#42;p++=='&#92;&#92;'){if(!&#42;p)return NULL;if(&#42;p=='u'){p++;for(int i=0;i&lt;4;i++)if(!isxdi…</code> |
| `skip` | function | 23 | <code>static const char &#42;skip(const char &#42;p,unsigned d){p=space(p);if(d&gt;32)return NULL;if(&#42;p=='"')return endstr(p);if(&#42;p=='{'&#124;&#124;&#42;p=='&#91;'){int obj=&#42;p=='{';char close=obj?'}':'&#93;';p=space(p+1);if(&#42;p==close)retur…</code> |
| `fields` | function | 24 | <code>static int fields(const char &#42;json,Field &#42;fs,int cap,const char &#42;allowed){const char &#42;p=space(json);int n=0;if(&#42;p++!='{')return -1;p=space(p);if(&#42;p=='}')return &#42;space(p+1)?-1:0;for(;;){const char &#42;q=e…</code> |
| `field` | function | 25 | <code>static Field &#42;field(Field &#42;fs,int n,const char &#42;k){for(int i=0;i&lt;n;i++)if(!strcmp(fs&#91;i&#93;.key,k))return fs+i;return NULL;}</code> |
| `hex4` | function | 26 | <code>static int hex4(const char &#42;p){int n=0;for(int i=0;i&lt;4;i++){int c=(unsigned char)p&#91;i&#93;,v=c&gt;='0'&amp;&amp;c&lt;='9'?c-'0':c&gt;='a'&amp;&amp;c&lt;='f'?c-'a'+10:c&gt;='A'&amp;&amp;c&lt;='F'?c-'A'+10:-1;if(v&lt;0)return -1;n=n&#42;16+v;}return n;}</code> |
| `string` | function | 27 | <code>static int string(Field &#42;f,char &#42;dst,size_t cap){</code> |
| `quoted` | function | 44 | <code>static void quoted(FILE &#42;o,const char &#42;s){fputc('"',o);for(const unsigned char &#42;p=(const unsigned char&#42;)s;&#42;p;p++){switch(&#42;p){case '"':fputs("&#92;&#92;&#92;"",o);break;case '&#92;&#92;':fputs("&#92;&#92;&#92;&#92;",o);break;case '&#92;n':fp…</code> |
| `keys` | function | 45 | <code>static int keys(Field &#42;fs,int n,const char &#42;allowed){for(int i=0;i&lt;n;i++){char match&#91;72&#93;;snprintf(match,sizeof match,"&#124;%.63s&#124;",fs&#91;i&#93;.key);if(!strstr(allowed,match))return 0;}return 1;}</code> |
| `error` | function | 46 | <code>static int error(FILE &#42;o,const char &#42;code){fprintf(o,"{&#92;"error&#92;":{&#92;"code&#92;":&#92;"%s&#92;"}}",code);return 1;}</code> |
| `safe_id` | function | 47 | <code>static int safe_id(const char &#42;s){if(!&#42;s&#124;&#124;strlen(s)&gt;128)return 0;for(;&#42;s;s++)if(!isalnum((unsigned char)&#42;s)&amp;&amp;!strchr("._:-",&#42;s))return 0;return 1;}</code> |
| `absdir` | function | 48 | <code>static int absdir(const char &#42;s){struct stat st;return &#42;s=='/'&amp;&amp;!strstr(s,"/../")&amp;&amp;!strstr(s,"/./")&amp;&amp;stat(s,&amp;st)==0&amp;&amp;S_ISDIR(st.st_mode);}</code> |
| `millis` | function | 49 | <code>static long millis(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&amp;t);return t.tv_sec&#42;1000+t.tv_nsec/1000000;}</code> |
| `capture` | function | 51 | <code>static int capture(const char &#42;exe,char &#42;const argv&#91;&#93;,const char &#42;codex_home,char &#42;buf,size_t cap){int pipefd&#91;2&#93;;if(&#42;exe!='/'&#124;&#124;pipe2(pipefd,O_CLOEXEC&#124;O_NONBLOCK))return 0;pid_t pid=fork();if(pid&lt;0){cl…</code> |
| `version` | function | 52 | <code>static int version(const char &#42;exe,char &#42;buf,size_t cap){char &#42;const argv&#91;&#93;={(char&#42;)exe,"--version",NULL};return capture(exe,argv,NULL,buf,cap);}</code> |
| `AuthProfile` | typedef | 53 | <code>typedef struct {</code> |
| `raw` | function | 57 | <code>static int raw(Field &#42;f,const char &#42;value){return f&amp;&amp;f-&gt;len==strlen(value)&amp;&amp;!memcmp(f-&gt;start,value,f-&gt;len);}</code> |
| `sha` | function | 58 | <code>static int sha(const char &#42;value){if(strlen(value)!=71&#124;&#124;strncmp(value,"sha256:",7))return 0;for(value+=7;&#42;value;value++)if(!strchr("0123456789abcdef",&#42;value))return 0;return 1;}</code> |
| `snapshot` | function | 59 | <code>static int snapshot(AuthProfile &#42;a){</code> |
| `provider` | function | 91 | <code>static int provider(Field &#42;fs,int n,char &#42;name,FILE &#42;out){if(!string(field(fs,n,"connector"),name,16)&#124;&#124;(!strcmp(name,"codex")?0:strcmp(name,"claude")))return error(out,"CONNECTOR_INVALID");return 0;}</code> |
| `member` | function | 93 | <code>static int member(const char &#42;json,const char &#42;key,Field &#42;out){const char &#42;p=space(json);if(&#42;p++!='{')return 0;p=space(p);if(&#42;p=='}')return 0;</code> |
| `member_string` | function | 96 | <code>static int member_string(const char &#42;json,const char &#42;key,char &#42;dst,size_t cap){Field f;return member(json,key,&amp;f)&amp;&amp;string(&amp;f,dst,cap);}</code> |
| `field_text` | function | 97 | <code>static char &#42;field_text(Field &#42;f){return f?strndup(f-&gt;start,f-&gt;len):NULL;}</code> |
| `array_has` | function | 98 | <code>static int array_has(Field &#42;f,const char &#42;const &#42;names){if(!f&#124;&#124;&#42;f-&gt;start!='&#91;')return 0;char &#42;a=field_text(f);if(!a)return 0;const char &#42;p=space(a+1);int found=0;</code> |
| `slurp` | function | 100 | <code>static long slurp(const char &#42;filename,char &#42;buf,size_t cap,int trusted){int fd=open(filename,O_RDONLY&#124;O_CLOEXEC&#124;O_NOFOLLOW);if(fd&lt;0)return -1;struct stat st;</code> |
| `hexdigest` | function | 103 | <code>static void hexdigest(const unsigned char &#42;h,char out&#91;80&#93;){strcpy(out,"sha256:");for(int i=0;i&lt;32;i++)sprintf(out+7+2&#42;i,"%02x",h&#91;i&#93;);}</code> |
| `bytes_sha` | function | 104 | <code>static int bytes_sha(const void &#42;data,size_t len,char out&#91;80&#93;){unsigned char h&#91;32&#93;;unsigned size=0;if(EVP_Digest(data,len,h,&amp;size,EVP_sha256(),NULL)!=1&#124;&#124;size!=32)return 0;hexdigest(h,out);return 1;}</code> |
| `file_sha` | function | 105 | <code>static int file_sha(const char &#42;filename,char out&#91;80&#93;){char real&#91;PATH_MAX&#93;;if(!realpath(filename,real))return 0;int fd=open(real,O_RDONLY&#124;O_CLOEXEC);if(fd&lt;0)return 0;</code> |
| `toml_get` | function | 109 | <code>static int toml_get(const char &#42;text,const char &#42;key,char &#42;out,size_t cap){size_t k=strlen(key);</code> |
| `Resolution` | typedef | 113 | <code>typedef struct {int found;char model&#91;255&#93;,provider&#91;255&#93;,path&#91;4096&#93;,config_digest&#91;80&#93;;} Resolution;</code> |
| `resolve_alias` | function | 117 | <code>static int resolve_alias(const char &#42;name,const char &#42;alias,const char &#42;home,Resolution &#42;r){</code> |
| `resolution_json` | function | 138 | <code>static void resolution_json(FILE &#42;o,const Resolution &#42;r){fputs("{&#92;"source&#92;":",o);quoted(o,r-&gt;found?"cli-config":"auth-profile");fputs(",&#92;"config_path&#92;":",o);if(r-&gt;found)quoted(o,r-&gt;path);else fputs("n…</code> |
| `CAP_NAMES` | variable | 144 | <code>static const char &#42;const CAP_NAMES&#91;CAP_COUNT&#93;={"launch","input","output","steer","cancel","child_registration","resume"};</code> |
| `Receipt` | typedef | 145 | <code>typedef struct {char digest&#91;80&#93;,observed_model&#91;255&#93;,observed_provider&#91;255&#93;,caps&#91;CAP_COUNT&#93;&#91;16&#93;;} Receipt;</code> |
| `nibble` | function | 146 | <code>static int nibble(char c){return c&gt;='0'&amp;&amp;c&lt;='9'?c-'0':c&gt;='a'&amp;&amp;c&lt;='f'?c-'a'+10:-1;}</code> |
| `unhex` | function | 147 | <code>static int unhex(const char &#42;s,unsigned char &#42;out,size_t n){if(strlen(s)!=2&#42;n)return 0;for(size_t i=0;i&lt;n;i++){int hi=nibble(s&#91;2&#42;i&#93;),lo=nibble(s&#91;2&#42;i+1&#93;);if(hi&lt;0&#124;&#124;lo&lt;0)return 0;out&#91;i&#93;=(unsigned char)(h…</code> |
| `integer` | function | 148 | <code>static int integer(Field &#42;f,long &#42;v){if(!f&#124;&#124;!f-&gt;len&#124;&#124;f-&gt;len&gt;12)return 0;long x=0;for(size_t i=0;i&lt;f-&gt;len;i++){if(!isdigit((unsigned char)f-&gt;start&#91;i&#93;))return 0;x=x&#42;10+(f-&gt;start&#91;i&#93;-'0');}&#42;v=x;return 1;}</code> |
| `same` | function | 149 | <code>static int same(Field &#42;f,const char &#42;v){char s&#91;4096&#93;;return string(f,s,sizeof s)&amp;&amp;!strcmp(s,v);}</code> |
| `receipt` | function | 150 | <code>static int receipt(const AuthProfile &#42;a,Receipt &#42;r){</code> |
| `cap_is` | function | 174 | <code>static int cap_is(const Receipt &#42;r,int cap,const char &#42;v){return !strcmp(r-&gt;caps&#91;cap&#93;,v);}</code> |
| `dispatch_qualified` | function | 175 | <code>static int dispatch_qualified(const Receipt &#42;r,int resume){return cap_is(r,CAP_LAUNCH,"QUALIFIED")&amp;&amp;cap_is(r,CAP_INPUT,"QUALIFIED")&amp;&amp;cap_is(r,CAP_OUTPUT,"QUALIFIED")&amp;&amp;cap_is(r,CAP_CANCEL,"QUALIFIED")&amp;…</code> |
| `resume_receipt` | function | 176 | <code>static int resume_receipt(const AuthProfile &#42;a,Receipt &#42;r){return a-&gt;explicit_resume&amp;&amp;receipt(a,r)&amp;&amp;cap_is(r,CAP_RESUME,"QUALIFIED");}</code> |
| `hf_connector_resume_qualified` | function | 177 | <code>int hf_connector_resume_qualified(const char &#42;connector,char &#42;out,size_t size){</code> |
| `hf_component_13_1` | function | 185 | <code>int hf_component_13_1(const char &#42;action,const char &#42;json,FILE &#42;out){</code> |

## src/hyperfide/control.c

[Open source](../../src/hyperfide/control.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `_GNU_SOURCE` | macro | 1 | <code>#define _GNU_SOURCE</code> |
| `CONTROL_OUTPUT_LIMIT` | macro | 31 | <code>#define CONTROL_OUTPUT_LIMIT (16U&#42;1024U&#42;1024U)</code> |
| `CONTROL_CHUNK` | macro | 32 | <code>#define CONTROL_CHUNK 196608U</code> |
| `ControlConfig` | typedef | 33 | <code>typedef struct {char transport&#91;4096&#93;,state&#91;4096&#93;,slots&#91;4096&#93;,organisation&#91;37&#93;,run&#91;37&#93;,sandbox&#91;37&#93;,boot&#91;37&#93;,generation&#91;32&#93;;} ControlConfig;</code> |
| `ControlPolicy` | typedef | 34 | <code>typedef struct {int64_t grace_ms,drain_ms;int stop_at_deadline;} ControlPolicy;</code> |
| `wall_ms` | function | 36 | <code>static long long wall_ms(void){struct timespec t;clock_gettime(CLOCK_REALTIME,&amp;t);return (long long)t.tv_sec&#42;1000LL+t.tv_nsec/1000000;}</code> |
| `pause_ms` | function | 37 | <code>static void pause_ms(long ms){struct timespec t={ms/1000,(ms%1000)&#42;1000000L};while(nanosleep(&amp;t,&amp;t)&amp;&amp;errno==EINTR){}}</code> |
| `secure_state` | function | 38 | <code>static int secure_state(const char &#42;state){struct stat st;return state&amp;&amp;state&#91;0&#93;=='/'&amp;&amp;!lstat(state,&amp;st)&amp;&amp;S_ISDIR(st.st_mode)&amp;&amp;st.st_uid==geteuid()&amp;&amp;!(st.st_mode&amp;077)&amp;&amp;geteuid()==0;}</code> |
| `text_at` | function | 39 | <code>static int text_at(const HfJson &#42;j,int object,const char &#42;key,char &#42;out,size_t n){return hf_json_string(j,hf_json_field(j,object,key),out,n);}</code> |
| `load_config` | function | 40 | <code>static int load_config(const char &#42;path,const char &#42;state,ControlConfig &#42;c){</code> |
| `request_config` | function | 50 | <code>static int request_config(const HfJson &#42;j,const char &#42;state,ControlConfig &#42;c){</code> |
| `service` | function | 54 | <code>static int service(const ControlConfig &#42;c,const char &#42;action,const char &#42;input,HfJson &#42;j,int &#42;result,char &#42;&#42;body,char code&#91;96&#93;){</code> |
| `hf_runner_control_api` | function | 64 | <code>int hf_runner_control_api(const char &#42;config_path,const char &#42;component,const char &#42;action,const char &#42;input,HfHttpResponse &#42;response){</code> |
| `ledger` | function | 75 | <code>static sqlite3 &#42;ledger(const char &#42;state){</code> |
| `exec_bind` | function | 90 | <code>static int exec_bind(sqlite3 &#42;db,const char &#42;sql,const char &#42;const &#42;text,int count){</code> |
| `refuse` | function | 95 | <code>static int refuse(sqlite3 &#42;db,FILE &#42;out,const char &#42;command,const char &#42;code){</code> |
| `hf_runner_admission_closed` | function | 99 | <code>int hf_runner_admission_closed(const char &#42;state,uid_t uid){</code> |
| `launch_update` | function | 106 | <code>static int launch_update(const char &#42;state,const char &#42;launch,uid_t uid,const char &#42;value){</code> |
| `launch_row` | function | 113 | <code>static int launch_row(const char &#42;state,const char &#42;launch,char slot&#91;37&#93;,uid_t &#42;uid,char identity&#91;2048&#93;){</code> |
| `slot_state` | function | 122 | <code>static int slot_state(const ControlConfig &#42;c,const char &#42;slot,uid_t uid,const char &#42;value){</code> |
| `uid_tree` | function | 129 | <code>static int uid_tree(uid_t uid,HfProcessIdentity &#42;list,size_t capacity){HfRunnerBinding b;memset(&amp;b,0,sizeof b);b.uid=uid;return hf_runner_processes(&amp;b,list,capacity);}</code> |
| `signal_tree` | function | 130 | <code>static int signal_tree(uid_t uid,int number){</code> |
| `terminate` | function | 136 | <code>static int terminate(uid_t uid,long long grace_ms,int kill_first){</code> |
| `freeze` | function | 142 | <code>static int freeze(uid_t uid,int stop){</code> |
| `jobs_active` | function | 149 | <code>static int jobs_active(const char &#42;state,uid_t uid){</code> |
| `fd_digest` | function | 155 | <code>static int fd_digest(int fd,char out&#91;72&#93;,unsigned long long &#42;size){</code> |
| `credential_dir` | function | 163 | <code>static int credential_dir(const ControlConfig &#42;c,const char &#42;slot){</code> |
| `revoke_credentials` | function | 169 | <code>static int revoke_credentials(sqlite3 &#42;db,const ControlConfig &#42;c,const char &#42;slot,const char &#42;command){</code> |
| `credential_residue` | function | 186 | <code>static int credential_residue(const ControlConfig &#42;c,const char &#42;slot){</code> |
| `output_path` | function | 191 | <code>static int output_path(const char &#42;state,const char &#42;launch,const char &#42;name,char path&#91;4200&#93;){</code> |
| `record_outputs` | function | 198 | <code>static void record_outputs(sqlite3 &#42;db,const char &#42;state,const char &#42;launch,const char &#42;command,const HfJson &#42;a,int list){</code> |
| `capture_outputs` | function | 208 | <code>static int capture_outputs(sqlite3 &#42;db,const ControlConfig &#42;c,const char &#42;command){</code> |
| `policy_of` | function | 231 | <code>static int policy_of(const HfJson &#42;a,int r,ControlPolicy &#42;p){</code> |
| `mode_of` | function | 236 | <code>static const char &#42;mode_of(const char &#42;action){return !strcmp(action,"runner.pause")?"PAUSE":!strcmp(action,"runner.drain")?"DRAIN":!strcmp(action,"runner.cancel")?"CANCEL":!strcmp(action,"runner.stop…</code> |
| `starting_phase` | function | 237 | <code>static const char &#42;starting_phase(const char &#42;action){return !strcmp(action,"runner.pause")?"PAUSING":!strcmp(action,"runner.drain")?"DRAINING":!strcmp(action,"runner.cancel")?"CANCELLING":!strcmp(act…</code> |
| `final_phase` | function | 238 | <code>static int final_phase(const char &#42;phase){return !strcmp(phase,"PAUSED")&#124;&#124;!strcmp(phase,"DRAINED")&#124;&#124;!strcmp(phase,"CANCELLED")&#124;&#124;!strcmp(phase,"STOPPED")&#124;&#124;!strcmp(phase,"RESUMED")&#124;&#124;!strcmp(phase,"SUPER…</code> |
| `status_of` | function | 239 | <code>static const char &#42;status_of(const char &#42;action,const char &#42;phase){</code> |
| `termination_of` | function | 248 | <code>static const char &#42;termination_of(const char &#42;phase){return !strcmp(phase,"PAUSED")?"FROZEN":(!strcmp(phase,"DRAINED")&#124;&#124;!strcmp(phase,"CANCELLED")&#124;&#124;!strcmp(phase,"STOPPED"))?"CONFIRMED":(!strcmp(phase…</code> |
| `outcome_of` | function | 249 | <code>static const char &#42;outcome_of(const char &#42;phase){return final_phase(phase)&#124;&#124;!strcmp(phase,"DRAINING")?(!strcmp(phase,"RESUMED")?"RESUMED":phase):"UNRESOLVED";}</code> |
| `Control` | typedef | 251 | <code>typedef struct {</code> |
| `load_command` | function | 256 | <code>static int load_command(sqlite3 &#42;db,const char &#42;id,Control &#42;x){</code> |
| `free_control` | function | 264 | <code>static void free_control(Control &#42;x){free(x-&gt;authority);free(x-&gt;a);x-&gt;authority=NULL;x-&gt;a=NULL;}</code> |
| `set_phase` | function | 265 | <code>static int set_phase(sqlite3 &#42;db,const Control &#42;x){char at&#91;32&#93;;snprintf(at,sizeof at,"%lld",(long long)time(NULL));const char &#42;v&#91;&#93;={x-&gt;phase,at,x-&gt;command};return exec_bind(db,"UPDATE commands SET pha…</code> |
| `render` | function | 268 | <code>static char &#42;render(sqlite3 &#42;db,Control &#42;x,const ControlConfig &#42;c){</code> |
| `DEBT` | macro | 282 | <code>#define DEBT(...) do{int w=snprintf(debt+used,sizeof debt-used,"%s&#92;"",used?",":"");if(w&gt;0&amp;&amp;(size_t)w&lt;sizeof debt-used)used+=(size_t)w;w=snprintf(debt+used,sizeof debt-used,__VA_ARGS__);if(w&gt;0&amp;&amp;(size_t…</code> |
| `report` | function | 306 | <code>static int report(sqlite3 &#42;db,const ControlConfig &#42;c,const Control &#42;x,const char &#42;receipt){</code> |
| `store_receipt` | function | 317 | <code>static int store_receipt(sqlite3 &#42;db,const Control &#42;x,const char &#42;receipt){char digest&#91;72&#93;="sha256:";hf_sha256_bytes(receipt,strlen(receipt),digest+7);const char &#42;v&#91;&#93;={receipt,digest,x-&gt;command};retur…</code> |
| `execute` | function | 320 | <code>static void execute(sqlite3 &#42;db,const ControlConfig &#42;c,Control &#42;x,const char &#42;request){</code> |
| `broker_alive` | function | 350 | <code>static int broker_alive(const HfRunnerBinding &#42;b){HfProcessIdentity broker;return b&amp;&amp;hf_process_identity(b-&gt;broker_pid,&amp;broker)&amp;&amp;broker.start_time==b-&gt;broker_start&amp;&amp;!strcmp(broker.os_boot_id,b-&gt;os_boo…</code> |
| `settle` | function | 353 | <code>static char &#42;settle(sqlite3 &#42;db,const ControlConfig &#42;c,Control &#42;x){</code> |
| `finish` | function | 359 | <code>static int finish(sqlite3 &#42;db,const ControlConfig &#42;c,Control &#42;x,FILE &#42;out,int replayed){</code> |
| `verify_authority` | function | 364 | <code>static int verify_authority(const HfJson &#42;a,int r,const char &#42;command,const char &#42;action,const char &#42;launch,const char &#42;identity,const ControlConfig &#42;c,long long &#42;fence){</code> |
| `control_command` | function | 374 | <code>static int control_command(const char &#42;action,const char &#42;request,FILE &#42;out){</code> |
| `observe` | function | 436 | <code>static int observe(const char &#42;request,FILE &#42;out){</code> |
| `slot_release` | function | 460 | <code>static int slot_release(const char &#42;request,FILE &#42;out){</code> |
| `BLOCK` | macro | 479 | <code>#define BLOCK(s) do{int w=snprintf(blocking+used,sizeof blocking-used,"%s&#92;"%s&#92;"",used?",":"",s);if(w&gt;0&amp;&amp;(size_t)w&lt;sizeof blocking-used)used+=(size_t)w;}while(0)</code> |
| `reconcile` | function | 501 | <code>static int reconcile(const char &#42;request,FILE &#42;out){</code> |
| `stage` | function | 550 | <code>static int stage(const char &#42;request,FILE &#42;out){</code> |
| `hf_component_12_4` | function | 561 | <code>int hf_component_12_4(const char &#42;action,const char &#42;request,FILE &#42;out) {</code> |

## src/hyperfide/entrypoint.c

[Open source](../../src/hyperfide/entrypoint.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `launcher_error` | function | 11 | <code>static int launcher_error(const char &#42;code) {</code> |
| `ordinary_executable` | function | 15 | <code>static int ordinary_executable(const char &#42;path,int executable) {</code> |
| `hf_entrypoint_dispatch` | function | 20 | <code>int hf_entrypoint_dispatch(int argc,char &#42;&#42;argv) {</code> |
| `hf_component_entrypoint` | function | 53 | <code>int hf_component_entrypoint(const char &#42;action,const char &#42;request_json,FILE &#42;output) {</code> |

## src/hyperfide/job.c

[Open source](../../src/hyperfide/job.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `_GNU_SOURCE` | macro | 1 | <code>#define _GNU_SOURCE</code> |
| `JOB_STREAM_LIMIT` | macro | 21 | <code>#define JOB_STREAM_LIMIT (64U&#42;1024U)</code> |
| `JOB_ARTIFACT_LIMIT` | macro | 22 | <code>#define JOB_ARTIFACT_LIMIT (128U&#42;1024U)</code> |
| `hf_component_11_3` | function | 23 | <code>extern int hf_component_11_3(const char &#42;,const char &#42;,FILE &#42;) __attribute__((weak));</code> |
| `mono` | function | 24 | <code>static long long mono(void){struct timespec t;if(clock_gettime(CLOCK_MONOTONIC,&amp;t))return -1;return (long long)t.tv_sec&#42;1000000000LL+t.tv_nsec;}</code> |
| `utc_now` | function | 25 | <code>static int utc_now(char result&#91;40&#93;){struct timespec now;struct tm tm;if(clock_gettime(CLOCK_REALTIME,&amp;now)&#124;&#124;!gmtime_r(&amp;now.tv_sec,&amp;tm))return 0;size_t n=strftime(result,40,"%Y-%m-%dT%H:%M:%S",&amp;tm);ret…</code> |
| `string_at` | function | 26 | <code>static int string_at(const HfJson &#42;j,int object,const char &#42;name,char &#42;out,size_t n){return hf_json_string(j,hf_json_field(j,object,name),out,n);}</code> |
| `relative` | function | 27 | <code>static int relative(const char &#42;s){if(!s&#124;&#124;!&#42;s&#124;&#124;&#42;s=='/'&#124;&#124;strchr(s,'&#92;&#92;'))return 0;const char &#42;p=s;while(&#42;p){const char &#42;end=strchr(p,'/');size_t n=end?(size_t)(end-p):strlen(p);if(!n&#124;&#124;(n==1&amp;&amp;p&#91;0&#93;=='.')&#124;…</code> |
| `open_beneath` | function | 28 | <code>static int open_beneath(int root,const char &#42;path,int directory){</code> |
| `standard64` | function | 33 | <code>static char &#42;standard64(const unsigned char &#42;data,size_t n){if(n&gt;JOB_ARTIFACT_LIMIT)return NULL;size_t capacity=((n+2)/3)&#42;4+1;char &#42;out=malloc(capacity);if(!out)return NULL;int result=EVP_EncodeBlock(…</code> |
| `fd_hash` | function | 34 | <code>static int fd_hash(int fd,char out&#91;65&#93;){</code> |
| `no_processes` | function | 40 | <code>static int no_processes(uid_t uid,HfProcessIdentity &#42;list,size_t &#42;count){</code> |
| `terminate_uid` | function | 46 | <code>static int terminate_uid(uid_t uid){</code> |
| `trusted_environment` | function | 53 | <code>static int trusted_environment(const char &#42;config_path){</code> |
| `MeasuredSource` | typedef | 62 | <code>typedef struct {char commit&#91;65&#93;,tree&#91;65&#93;,state&#91;72&#93;,workspace&#91;72&#93;;} MeasuredSource;</code> |
| `readiness_unprivileged` | function | 63 | <code>static int readiness_unprivileged(const HfJson &#42;job,int result,MeasuredSource &#42;measured){</code> |
| `readiness` | function | 88 | <code>static int readiness(const HfJson &#42;job,int result,const char &#42;config_path,MeasuredSource &#42;measured,</code> |
| `EnvEntry` | typedef | 129 | <code>typedef struct {char &#42;key,&#42;value;} EnvEntry;</code> |
| `compare_env` | function | 130 | <code>static int compare_env(const void &#42;a,const void &#42;b){return strcmp(((const EnvEntry&#42;)a)-&gt;key,((const EnvEntry&#42;)b)-&gt;key);}</code> |
| `environment` | function | 131 | <code>static int environment(const HfJson &#42;j,int plan,EnvEntry entries&#91;64&#93;,int &#42;count,char digest&#91;65&#93;){</code> |
| `job_database` | function | 141 | <code>static sqlite3 &#42;job_database(const char &#42;state){</code> |
| `captured` | function | 148 | <code>static void captured(FILE &#42;out,const unsigned char &#42;bytes,size_t n,int complete){</code> |
| `preparation_placement` | function | 154 | <code>static int preparation_placement(const char &#42;config){</code> |
| `hf_runner_job_execute` | function | 162 | <code>int hf_runner_job_execute(const char &#42;request,FILE &#42;out){</code> |

## src/hyperfide/launch.c

[Open source](../../src/hyperfide/launch.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `_GNU_SOURCE` | macro | 1 | <code>#define _GNU_SOURCE</code> |
| `RunnerConfig` | typedef | 27 | <code>typedef struct {</code> |
| `Instruction` | typedef | 31 | <code>typedef struct {</code> |
| `monotonic_ns` | function | 35 | <code>static long long monotonic_ns(void) {struct timespec t;if(clock_gettime(CLOCK_MONOTONIC,&amp;t))return -1;return (long long)t.tv_sec&#42;1000000000LL+t.tv_nsec;}</code> |
| `decimal` | function | 36 | <code>static int decimal(const char &#42;s) {</code> |
| `secure_directory` | function | 40 | <code>static int secure_directory(const char &#42;path) {</code> |
| `load_config` | function | 49 | <code>static int load_config(const char &#42;path,RunnerConfig &#42;c) {</code> |
| `api` | function | 61 | <code>static int api(const RunnerConfig &#42;c,const char &#42;component,const char &#42;action,const char &#42;input,HfHttpResponse &#42;response) {</code> |
| `result_json` | function | 68 | <code>static int result_json(HfHttpResponse &#42;r,HfJson &#42;j) {</code> |
| `placement` | function | 71 | <code>static int placement(const RunnerConfig &#42;c,const char &#42;action,const char &#42;job,const char &#42;tool) {</code> |
| `atstring` | function | 81 | <code>static int atstring(const HfJson &#42;j,int o,const char &#42;key,char &#42;out,size_t n){return hf_json_string(j,hf_json_field(j,o,key),out,n);}</code> |
| `parse_packet` | function | 83 | <code>static int parse_packet(const RunnerConfig &#42;c,const HfJson &#42;j,int r,Instruction &#42;i,long long started) {</code> |
| `fetch_instruction` | function | 104 | <code>static int fetch_instruction(const RunnerConfig &#42;c,const char &#42;event,Instruction &#42;i) {</code> |
| `ledger` | function | 112 | <code>static sqlite3 &#42;ledger(const RunnerConfig &#42;c) {</code> |
| `frame_reserve` | function | 124 | <code>static int frame_reserve(sqlite3 &#42;db,const char &#42;id,const char &#42;launch,const char &#42;digest){</code> |
| `queue_ack` | function | 132 | <code>static int queue_ack(sqlite3 &#42;db,const RunnerConfig &#42;c,const Instruction &#42;i,int version,const char &#42;state,const HfProcessIdentity &#42;process) {</code> |
| `HF_EVENT_SPOOL_LIMIT` | macro | 145 | <code>#define HF_EVENT_SPOOL_LIMIT 4096</code> |
| `HF_EVENT_DATA_LIMIT` | macro | 146 | <code>#define HF_EVENT_DATA_LIMIT 16384</code> |
| `queue_event` | function | 147 | <code>static int queue_event(sqlite3 &#42;db,const RunnerConfig &#42;c,const char &#42;launch,const char &#42;command,const char &#42;kind,const char &#42;data) {</code> |
| `flush_outbox` | function | 163 | <code>static int flush_outbox(sqlite3 &#42;db,const RunnerConfig &#42;c,const char &#42;command,const char &#42;launch,int limit,int &#42;acks,int &#42;events) {</code> |
| `undelivered` | function | 183 | <code>static long long undelivered(sqlite3 &#42;db,const char &#42;command,const char &#42;launch) {</code> |
| `launch_lock` | function | 191 | <code>static int launch_lock(const char &#42;state,const char &#42;launch,int create,int &#42;held) {</code> |
| `broker_owner` | function | 199 | <code>static int broker_owner(const char &#42;state,const char &#42;launch) {</code> |
| `input_permitted` | function | 202 | <code>static int input_permitted(sqlite3 &#42;db,const char &#42;launch) {</code> |
| `uid_processes` | function | 207 | <code>static int uid_processes(uid_t uid,HfProcessIdentity &#42;list,size_t capacity) {</code> |
| `slot_identity` | function | 212 | <code>static int slot_identity(const RunnerConfig &#42;c,Instruction &#42;i) {</code> |
| `hash_fd` | function | 221 | <code>static int hash_fd(int fd,char digest&#91;65&#93;) {</code> |
| `read_plan` | function | 227 | <code>static int read_plan(const RunnerConfig &#42;c,const Instruction &#42;i,HfJson &#42;j,char &#42;&#42;source,char &#42;&#42;&#42;argv,int &#42;binary) {</code> |
| `free_argv` | function | 240 | <code>static void free_argv(char &#42;&#42;argv){if(argv){for(int k=0;argv&#91;k&#93;;++k)free(argv&#91;k&#93;);free(argv);}}</code> |
| `transfer` | function | 241 | <code>static int transfer(int fd,void &#42;data,size_t n,int writing){unsigned char &#42;p=data;while(n){ssize_t k=writing?send(fd,p,n,MSG_NOSIGNAL):read(fd,p,n);if(k&lt;0&amp;&amp;errno==EINTR)continue;if(k&lt;=0)return 0;p+=k;…</code> |
| `send_packet` | function | 242 | <code>static int send_packet(int fd,const char &#42;data){size_t n=strlen(data);if(n&gt;HF_BODY_LIMIT)return 0;uint32_t len=htonl((uint32_t)n);return transfer(fd,&amp;len,4,1)&amp;&amp;transfer(fd,(void&#42;)data,n,1);}</code> |
| `receive_packet` | function | 243 | <code>static char &#42;receive_packet(int fd){uint32_t wire;if(!transfer(fd,&amp;wire,4,0))return NULL;size_t n=ntohl(wire);if(!n&#124;&#124;n&gt;HF_BODY_LIMIT)return NULL;char &#42;data=malloc(n+1);if(!data)return NULL;if(!transfe…</code> |
| `socket_path` | function | 244 | <code>static int socket_path(const char &#42;state,const char &#42;launch,char path&#91;108&#93;){return hf_uuid_valid(launch)&amp;&amp;snprintf(path,108,"%s/%s.sock",state,launch)&lt;108;}</code> |
| `hf_launch_rpc` | function | 245 | <code>int hf_launch_rpc(const char &#42;state,const char &#42;action,const char &#42;payload,FILE &#42;output) {</code> |
| `state_update` | function | 256 | <code>static void state_update(sqlite3 &#42;db,const char &#42;launch,const char &#42;state,int exit_code) {</code> |
| `stop_uid` | function | 259 | <code>static int stop_uid(uid_t uid) {</code> |
| `hf_slot_owner` | function | 268 | <code>int hf_slot_owner(uid_t uid,const char &#42;owner) {</code> |
| `hf_slot_control_lock` | function | 273 | <code>int hf_slot_control_lock(uid_t uid,const char &#42;owner) {</code> |
| `hf_slot_watchdog` | function | 279 | <code>pid_t hf_slot_watchdog(uid_t uid,long long deadline,int &#42;writer,const char &#42;owner) {</code> |
| `hf_slot_watchdog_finish` | function | 302 | <code>int hf_slot_watchdog_finish(pid_t guard,int &#42;writer) {</code> |
| `broker_observation` | function | 307 | <code>static char &#42;broker_observation(const RunnerConfig &#42;c,const Instruction &#42;i,const HfProcessIdentity &#42;broker,const HfProcessIdentity &#42;agent,const char &#42;state,int exit_code,const char &#42;command,int ipc_cl…</code> |
| `spool_json` | function | 314 | <code>static void spool_json(FILE &#42;out,const RunnerConfig &#42;c,const char &#42;launch,const char &#42;suffix,unsigned long long observed) {</code> |
| `terminal_data` | function | 321 | <code>static char &#42;terminal_data(const RunnerConfig &#42;c,const Instruction &#42;i,const char &#42;state,int exit_code,unsigned long long out_bytes,unsigned long long err_bytes,const char &#42;stopped_by) {</code> |
| `append_log` | function | 328 | <code>static int append_log(int fd,const void &#42;data,size_t n){const char &#42;p=data;while(n){ssize_t w=write(fd,p,n);if(w&lt;0&amp;&amp;errno==EINTR)continue;if(w&lt;=0)return 0;p+=w;n-=(size_t)w;}return 1;}</code> |
| `broker` | function | 329 | <code>static void broker(const RunnerConfig &#42;c,const Instruction &#42;i,HfJson &#42;plan,char &#42;&#42;argv,int binary,int ready) {</code> |
| `refuse` | function | 418 | <code>static int refuse(FILE &#42;out,const char &#42;code){last_refusal=code;return hf_native_error(out,code);}</code> |
| `fenced` | function | 419 | <code>static int fenced(sqlite3 &#42;db,const char &#42;launch) {</code> |
| `launch_start` | function | 423 | <code>static int launch_start(const RunnerConfig &#42;c,Instruction &#42;i,FILE &#42;out) {</code> |
| `LaunchRow` | typedef | 464 | <code>typedef struct {char launch&#91;37&#93;,command&#91;37&#93;,state&#91;32&#93;,broker_start&#91;32&#93;,agent_start&#91;32&#93;,os_boot&#91;37&#93;,identity&#91;2048&#93;;long long uid,gid,broker_pid,agent_pid;} LaunchRow;</code> |
| `ReconcileStats` | typedef | 465 | <code>typedef struct {int adopted,orphaned,lost,not_spawned,uncertain;} ReconcileStats;</code> |
| `ack_instruction` | function | 466 | <code>static int ack_instruction(sqlite3 &#42;db,const char &#42;launch,const char &#42;command,Instruction &#42;i,int &#42;version) {</code> |
| `agent_current` | function | 474 | <code>static int agent_current(const LaunchRow &#42;r,HfProcessIdentity &#42;seen) {</code> |
| `reconcile` | function | 477 | <code>static int reconcile(const RunnerConfig &#42;c,FILE &#42;out,ReconcileStats &#42;stats) {</code> |
| `mark_instruction` | function | 520 | <code>static int mark_instruction(sqlite3 &#42;db,const char &#42;event,const char &#42;state,const char &#42;outcome) {</code> |
| `instruction_admit` | function | 525 | <code>static int instruction_admit(sqlite3 &#42;db,const Instruction &#42;i) {</code> |
| `control_payload` | function | 534 | <code>static char &#42;control_payload(const RunnerConfig &#42;c,const Instruction &#42;i) {</code> |
| `ServeStats` | typedef | 543 | <code>typedef struct {int rounds,polls_ok,poll_failures,commands,observations,invalid,starts,replays,refusals,steers,cancels,redelivered,conflicts,acks,events;long long max_backoff_ms;} ServeStats;</code> |
| `final_state` | function | 544 | <code>static int final_state(const char &#42;state){return !strcmp(state,"EXITED")&#124;&#124;!strcmp(state,"STOPPED")&#124;&#124;!strcmp(state,"NOT_SPAWNED")&#124;&#124;!strcmp(state,"LOST")&#124;&#124;!strcmp(state,"LEASE_EXPIRED");}</code> |
| `deliver_control` | function | 548 | <code>static void deliver_control(const RunnerConfig &#42;c,const Instruction &#42;i,ServeStats &#42;st) {</code> |
| `process_instruction` | function | 583 | <code>static void process_instruction(const RunnerConfig &#42;c,Instruction &#42;i,ServeStats &#42;st) {</code> |
| `poll_once` | function | 600 | <code>static int poll_once(const RunnerConfig &#42;c,ServeStats &#42;st) {</code> |
| `serve_signal` | function | 618 | <code>static void serve_signal(int signal_number){(void)signal_number;serve_stop=1;}</code> |
| `pause_ms` | function | 619 | <code>static void pause_ms(long long ms,long long end){while(ms&gt;0&amp;&amp;!serve_stop&amp;&amp;monotonic_ns()&lt;end){struct timespec d={0,(ms&gt;50?50:ms)&#42;1000000L};nanosleep(&amp;d,NULL);ms-=50;}}</code> |
| `serve` | function | 624 | <code>static int serve(const RunnerConfig &#42;c,long long run_seconds,long long interval_ms,FILE &#42;out) {</code> |
| `bounded_i64` | function | 641 | <code>static int bounded_i64(const HfJson &#42;j,const char &#42;key,long long min,long long max,long long &#42;value){int64_t v=0;if(!hf_json_i64(j,hf_json_field(j,0,key),&amp;v)&#124;&#124;v&lt;min&#124;&#124;v&gt;max)return 0;&#42;value=v;return 1;}</code> |
| `hf_component_12_2` | function | 642 | <code>int hf_component_12_2(const char &#42;action,const char &#42;request,FILE &#42;out) {</code> |
| `hf_runner_job_claim` | function | 669 | <code>int hf_runner_job_claim(const char &#42;config_path,const char &#42;operation,HfHttpResponse &#42;response) {</code> |
| `hf_runner_job_placement` | function | 675 | <code>int hf_runner_job_placement(const char &#42;config_path,const char &#42;action) {</code> |

## src/hyperfide/preparation_process.c

[Open source](../../src/hyperfide/preparation_process.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `_GNU_SOURCE` | macro | 4 | <code>#define _GNU_SOURCE</code> |
| `hf_component_11_3` | function | 28 | <code>extern int hf_component_11_3(const char &#42;,const char &#42;,FILE &#42;);</code> |
| `PP_LIMIT` | macro | 30 | <code>#define PP_LIMIT (256ULL&#42;1024&#42;1024)</code> |
| `PP_PROCESSES` | macro | 31 | <code>#define PP_PROCESSES 4096</code> |
| `PP_ENV` | macro | 32 | <code>#define PP_ENV 64</code> |
| `pp_now` | function | 33 | <code>static long long pp_now(void) {</code> |
| `pp_utc` | function | 37 | <code>static int pp_utc(char out&#91;40&#93;) {</code> |
| `pp_directory` | function | 42 | <code>static int pp_directory(const char &#42;path,uid_t uid,gid_t gid) {</code> |
| `pp_log` | function | 56 | <code>static int pp_log(int fd,struct stat &#42;st) {</code> |
| `pp_environment` | variable | 61 | <code>static const char &#42;const pp_environment&#91;&#93;={</code> |
| `pp_free_env` | function | 69 | <code>static void pp_free_env(char &#42;&#42;env) {for(size_t n=0;env&amp;&amp;env&#91;n&#93;;n++)free(env&#91;n&#93;);free(env);}</code> |
| `pp_env` | function | 70 | <code>static char &#42;&#42;pp_env(const HfPreparationProcessSpec &#42;s) {</code> |
| `pp_inventory` | function | 101 | <code>static int pp_inventory(uid_t uid,HfProcessIdentity &#42;list,size_t &#42;count) {</code> |
| `pp_signal` | function | 121 | <code>static int pp_signal(const HfProcessIdentity &#42;expected,uid_t uid,int signal) {</code> |
| `pp_reap_uid` | function | 130 | <code>static void pp_reap_uid(HfProcessIdentity &#42;list,size_t count,pid_t main,int &#42;done,int &#42;known,int &#42;status) {</code> |
| `pp_stop` | function | 139 | <code>static int pp_stop(const HfPreparationProcessSpec &#42;s,HfProcessIdentity &#42;list,pid_t main,int &#42;done,int &#42;known,int &#42;status) {</code> |
| `pp_watchdog` | function | 153 | <code>static int pp_watchdog(const HfPreparationProcessSpec &#42;s) {</code> |
| `pp_clear_capabilities` | function | 157 | <code>static int pp_clear_capabilities(void) {</code> |
| `pp_copy_fd` | function | 162 | <code>static int pp_copy_fd(int fd) {return fcntl(fd,F_DUPFD_CLOEXEC,10);}</code> |
| `pp_child` | function | 163 | <code>static void pp_child(const HfPreparationProcessSpec &#42;s,char &#42;&#42;environment,int out,int error,int ready,int gate,pid_t parent) {</code> |
| `pp_digest` | function | 193 | <code>static int pp_digest(EVP_MD_CTX &#42;ctx,char out&#91;72&#93;) {</code> |
| `pp_drain` | function | 197 | <code>static int pp_drain(int pipe,int log,EVP_MD_CTX &#42;digest,unsigned long long &#42;bytes,unsigned long long &#42;total,</code> |
| `hf_preparation_process` | function | 213 | <code>int hf_preparation_process(const HfPreparationProcessSpec &#42;s,HfPreparationProcessResult &#42;result) {</code> |

## src/hyperfide/preparation_stage.c

[Open source](../../src/hyperfide/preparation_stage.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `_GNU_SOURCE` | macro | 1 | <code>#define _GNU_SOURCE</code> |
| `HF_STAGE_MAX` | macro | 14 | <code>#define HF_STAGE_MAX (64ULL&#42;1024&#42;1024&#42;1024)</code> |
| `HF_STAGE_FILES` | macro | 15 | <code>#define HF_STAGE_FILES 64</code> |
| `string` | function | 19 | <code>static int string(const HfJson &#42;j,int o,const char &#42;k,char &#42;v,size_t n) {</code> |
| `equals` | function | 22 | <code>static int equals(const HfJson &#42;j,int o,const char &#42;k,const char &#42;expected) {</code> |
| `sha_valid` | function | 25 | <code>static int sha_valid(const char &#42;s) {</code> |
| `quantity` | function | 30 | <code>static int quantity(const HfJson &#42;j,int o,const char &#42;k,uint64_t &#42;n) {</code> |
| `positive` | function | 37 | <code>static int positive(const HfJson &#42;j,int o,const char &#42;key,uint64_t maximum,uint64_t &#42;result){</code> |
| `target_binding` | function | 42 | <code>static int target_binding(const HfJson &#42;j,int target,int physical,const char &#42;operation,const char &#42;org,const char &#42;run,const char &#42;sandbox,const char &#42;boot,const char &#42;boot_generation,const char &#42;slo…</code> |
| `strict_dir` | function | 64 | <code>static int strict_dir(const char &#42;path,int create) {</code> |
| `protected_read` | function | 79 | <code>static int protected_read(const char &#42;path,size_t maximum,char &#42;&#42;text,size_t &#42;length) {</code> |
| `workspace_parent` | function | 90 | <code>static int workspace_parent(const char &#42;path,const char &#42;leaf,uid_t uid,gid_t gid) {</code> |
| `pinned_binary` | function | 104 | <code>static int pinned_binary(const char &#42;path,const char &#42;digest,int executable) {</code> |
| `write_all` | function | 119 | <code>static int write_all(int fd,const void &#42;data,size_t n) {</code> |
| `decode` | function | 123 | <code>static unsigned char &#42;decode(const char &#42;encoded,size_t &#42;size) {</code> |
| `Fetch` | typedef | 136 | <code>typedef struct {char org&#91;37&#93;,run&#91;37&#93;,operation&#91;37&#93;,transport&#91;4096&#93;;} Fetch;</code> |
| `rpc` | function | 137 | <code>static HfJson &#42;rpc(const Fetch &#42;f,const char &#42;action,const char &#42;id,HfHttpResponse &#42;response) {</code> |
| `fetch_object` | function | 150 | <code>static int fetch_object(const Fetch &#42;f,const char &#42;id,const char &#42;digest,uint64_t size,int fd,EVP_MD_CTX &#42;whole) {</code> |
| `fetch_content` | function | 161 | <code>static int fetch_content(const Fetch &#42;f,const char &#42;id,const char &#42;kind,const char &#42;digest,const char &#42;parent_digest,uint64_t size,int fd) {</code> |
| `mkdir_owned` | function | 187 | <code>static int mkdir_owned(int parent,const char &#42;name,uid_t uid,gid_t gid,mode_t mode) {</code> |
| `stage_file` | function | 193 | <code>static int stage_file(const Fetch &#42;f,int dir,int context,const char &#42;root,const char &#42;role,const char &#42;id,const char &#42;kind,const char &#42;digest,const char &#42;parent,uint64_t bytes,int sequence,gid_t gid,F…</code> |
| `hf_runner_stage_preparation` | function | 203 | <code>int hf_runner_stage_preparation(const char &#42;config_path,const HfJson &#42;claim,int result,HfPreparationStage &#42;stage) {</code> |

## src/hyperfide/preparation_support.h

[Open source](../../src/hyperfide/preparation_support.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `HF_PREPARATION_SUPPORT_H` | macro | 2 | <code>#define HF_PREPARATION_SUPPORT_H</code> |
| `_GNU_SOURCE` | macro | 3 | <code>#define _GNU_SOURCE</code> |
| `hp_hash_bytes` | function | 21 | <code>static inline int hp_hash_bytes(const void &#42;data, size_t n, char out&#91;65&#93;) {</code> |
| `hp_valid` | function | 36 | <code>static inline int hp_valid(const char &#42;raw) {</code> |
| `hp_get` | function | 64 | <code>static inline char &#42;hp_get(const char &#42;raw, const char &#42;key, int index,</code> |
| `hp_field` | function | 94 | <code>static inline char &#42;hp_field(const char &#42;raw, const char &#42;key) {</code> |
| `hp_item` | function | 97 | <code>static inline char &#42;hp_item(const char &#42;raw, int index) {</code> |
| `hp_text` | function | 100 | <code>static inline int hp_text(const char &#42;raw, const char &#42;key, char &#42;out,</code> |
| `hp_argument` | function | 129 | <code>static inline int hp_argument(const char &#42;raw, char &#42;out, size_t cap) {</code> |
| `hp_count` | function | 138 | <code>static inline int hp_count(const char &#42;raw) {</code> |
| `hp_shape` | function | 158 | <code>static inline int hp_shape(const char &#42;raw, const char &#42;const &#42;keys,</code> |
| `hp_integer` | function | 189 | <code>static inline int hp_integer(const char &#42;raw, const char &#42;key, int min, int max,</code> |
| `hp_relative` | function | 207 | <code>static inline int hp_relative(const char &#42;p) {</code> |
| `hp_id` | function | 226 | <code>static inline int hp_id(const char &#42;p) {</code> |
| `hp_digest` | function | 234 | <code>static inline int hp_digest(const char &#42;p) {</code> |
| `hp_oid` | function | 242 | <code>static inline int hp_oid(const char &#42;p) {</code> |
| `hp_quote` | function | 250 | <code>static inline void hp_quote(FILE &#42;f, const char &#42;p) {</code> |
| `hp_open_dir` | function | 264 | <code>static inline int hp_open_dir(int anchor, const char &#42;relative, int create) {</code> |
| `hp_root` | function | 289 | <code>static inline int hp_root(const char &#42;name) {</code> |
| `hp_hash_file` | function | 301 | <code>static inline int hp_hash_file(int root, const char &#42;relative, char out&#91;72&#93;) {</code> |
| `hp_millis` | function | 372 | <code>static inline long long hp_millis(void) {</code> |
| `hp_spawn_env` | function | 380 | <code>static inline int hp_spawn_env(const char &#42;cwd, char &#42;const argv&#91;&#93;,</code> |
| `hp_spawn` | function | 577 | <code>static inline int hp_spawn(const char &#42;cwd, char &#42;const argv&#91;&#93;, const char &#42;log,</code> |

## src/hyperfide/process_tree.c

[Open source](../../src/hyperfide/process_tree.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `_GNU_SOURCE` | macro | 1 | <code>#define _GNU_SOURCE</code> |
| `hf_runner_binding` | function | 20 | <code>int hf_runner_binding(const char &#42;request,HfRunnerBinding &#42;binding) {</code> |
| `hf_runner_processes` | function | 34 | <code>int hf_runner_processes(const HfRunnerBinding &#42;binding,HfProcessIdentity &#42;list,size_t capacity) {</code> |
| `TreeNode` | typedef | 43 | <code>typedef struct {pid_t pid,ppid;uid_t uid;unsigned long long start;char state;} TreeNode;</code> |
| `node_order` | function | 44 | <code>static int node_order(const void &#42;a,const void &#42;b){pid_t x=((const TreeNode&#42;)a)-&gt;pid,y=((const TreeNode&#42;)b)-&gt;pid;return (x&gt;y)-(x&lt;y);}</code> |
| `node_find` | function | 45 | <code>static const TreeNode &#42;node_find(const TreeNode &#42;nodes,size_t count,pid_t pid){TreeNode key={.pid=pid};return bsearch(&amp;key,nodes,count,sizeof &#42;nodes,node_order);}</code> |
| `node_agent` | function | 46 | <code>static int node_agent(const TreeNode &#42;n,const HfRunnerBinding &#42;b){return n-&gt;pid==b-&gt;agent_pid&amp;&amp;n-&gt;start==b-&gt;agent_start&amp;&amp;n-&gt;uid==b-&gt;uid;}</code> |
| `node_broker` | function | 47 | <code>static int node_broker(const TreeNode &#42;n,const HfRunnerBinding &#42;b){return n-&gt;pid==b-&gt;broker_pid&amp;&amp;n-&gt;start==b-&gt;broker_start;}</code> |
| `node_relation` | function | 50 | <code>static int node_relation(const TreeNode &#42;nodes,size_t count,const TreeNode &#42;self,const HfRunnerBinding &#42;b,int &#42;depth){</code> |
| `stat_extra` | function | 63 | <code>static int stat_extra(pid_t pid,unsigned long long start,pid_t &#42;session,unsigned long long &#42;ticks,long &#42;threads){</code> |
| `hf_process_tree_inventory` | function | 73 | <code>int hf_process_tree_inventory(const HfRunnerBinding &#42;b,HfProcessTree &#42;tree){</code> |
| `hf_process_tree_cancel` | function | 96 | <code>int hf_process_tree_cancel(const HfRunnerBinding &#42;b,int rounds,int &#42;remaining){</code> |
| `read_small` | function | 105 | <code>static int read_small(const char &#42;path,char &#42;out,size_t capacity){</code> |
| `keyed` | function | 109 | <code>static long long keyed(const char &#42;text,const char &#42;key){</code> |
| `cgroup_of` | function | 112 | <code>static int cgroup_of(pid_t pid,char &#42;out,size_t capacity){</code> |
| `cgroup_within` | function | 118 | <code>static int cgroup_within(const char &#42;path,const char &#42;scope){size_t n=strlen(scope);return !strcmp(scope,"/")&#124;&#124;(!strncmp(path,scope,n)&amp;&amp;(path&#91;n&#93;==0&#124;&#124;path&#91;n&#93;=='/'));}</code> |
| `limit_line` | function | 119 | <code>static int limit_line(pid_t pid,const char &#42;name,char &#42;soft,size_t capacity){</code> |
| `progress_states` | variable | 124 | <code>static const char &#42;const progress_states&#91;&#93;={"WORKING","IDLE","MODEL_WAITING","BUILD_WAITING","TOOL_WAITING","MODEL_ERROR","TOOL_ERROR","AUTH_FAILED","RATE_LIMITED","QUOTA_EXHAUSTED"};</code> |
| `ProgressScan` | typedef | 125 | <code>typedef struct {int available;unsigned long long stdout_bytes,stderr_bytes;time_t last_output;long long events,useful,noop,repeated,invalid,max_sequence;int last_useful;char last_state&#91;32&#93;;} ProgressS…</code> |
| `spool` | function | 126 | <code>static FILE &#42;spool(const HfRunnerBinding &#42;b,const char &#42;suffix,struct stat &#42;st){</code> |
| `progress_scan` | function | 134 | <code>static void progress_scan(const HfRunnerBinding &#42;b,HfJson &#42;j,ProgressScan &#42;s){</code> |
| `state_in` | function | 152 | <code>static int state_in(const char &#42;state,const char &#42;const &#42;list,size_t n){for(size_t k=0;k&lt;n;++k)if(!strcmp(state,list&#91;k&#93;))return 1;return 0;}</code> |
| `identity_items` | function | 154 | <code>static int identity_items(const HfJson &#42;j,const char &#42;name,HfProcessIdentity &#42;items,int capacity){</code> |
| `identity_status` | function | 164 | <code>static const char &#42;identity_status(const HfProcessIdentity &#42;expected,const char &#42;boot){</code> |
| `identity_report` | function | 168 | <code>static void identity_report(FILE &#42;out,const char &#42;name,const HfProcessIdentity &#42;items,int count,const char &#42;boot){</code> |
| `relation_names` | variable | 173 | <code>static const char &#42;const relation_names&#91;&#93;={"","AGENT","DESCENDANT","ADOPTED_BY_BROKER","ESCAPED"};</code> |
| `cgroup_value` | function | 174 | <code>static void cgroup_value(FILE &#42;out,const char &#42;dir,const char &#42;file,const char &#42;key){</code> |
| `cgroup_events` | function | 177 | <code>static int cgroup_events(const char &#42;dir,const char &#42;file,const char &#42;key,long long &#42;value){char path&#91;4400&#93;,text&#91;1024&#93;;snprintf(path,sizeof path,"%s/%s",dir,file);&#42;value=read_small(path,text,sizeof te…</code> |
| `cgroup_number` | function | 178 | <code>static int cgroup_number(const char &#42;dir,const char &#42;file,unsigned long long &#42;value,int &#42;unlimited){</code> |
| `limits_report` | function | 182 | <code>static void limits_report(FILE &#42;out,const HfProcessTree &#42;t,int &#42;saturated_any){</code> |
| `ipc_report` | function | 222 | <code>static void ipc_report(FILE &#42;out,const HfRunnerBinding &#42;b,const HfJson &#42;j){</code> |
| `hf_component_12_3` | function | 235 | <code>int hf_component_12_3(const char &#42;action,const char &#42;request,FILE &#42;out) {</code> |

## src/hyperfide/readiness.c

[Open source](../../src/hyperfide/readiness.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `_GNU_SOURCE` | macro | 2 | <code>#define _GNU_SOURCE</code> |
| `readiness_signal` | function | 41 | <code>static void readiness_signal(int number) {</code> |
| `config_file` | function | 45 | <code>static int config_file(const char &#42;name, size_t maximum) {</code> |
| `read_json_fd` | function | 79 | <code>static char &#42;read_json_fd(int fd, size_t maximum) {</code> |
| `environment_equal` | function | 106 | <code>static int environment_equal(const char &#42;name, const char &#42;expected) {</code> |
| `decimal_value` | function | 110 | <code>static int decimal_value(const char &#42;raw, const char &#42;key, uint64_t &#42;out) {</code> |
| `hash_absolute` | function | 123 | <code>static int hash_absolute(const char &#42;path, char out&#91;72&#93;) {</code> |
| `manifest_check` | function | 133 | <code>static int manifest_check(const char &#42;base, int manifest, const char &#42;profile,</code> |
| `profile_os` | function | 210 | <code>static int profile_os(const char &#42;profile) {</code> |
| `find_binding` | function | 251 | <code>static int find_binding(const char &#42;bindings, const char &#42;name,</code> |
| `probe_tool` | function | 275 | <code>static int probe_tool(const char &#42;binding, const char &#42;workspace,</code> |
| `tools_ready` | function | 328 | <code>static int tools_ready(const char &#42;profile, const char &#42;workspace,</code> |
| `source_same_stat` | function | 380 | <code>static int source_same_stat(const struct stat &#42;a, const struct stat &#42;b) {</code> |
| `source_parent` | function | 388 | <code>static int source_parent(int root, const char &#42;relative,</code> |
| `source_metadata_open` | function | 415 | <code>static int source_metadata_open(int root, const char &#42;relative) {</code> |
| `source_metadata_safe` | function | 438 | <code>static int source_metadata_safe(const char &#42;repository, const char &#42;workspace) {</code> |
| `source_git` | function | 512 | <code>static int source_git(const char &#42;repository, const char &#42;diagnostics,</code> |
| `source_config_safe` | function | 542 | <code>static int source_config_safe(const char &#42;repository, const char &#42;diagnostics,</code> |
| `source_blob_at` | function | 578 | <code>static int source_blob_at(int root, const char &#42;relative, const char &#42;mode,</code> |
| `source_lfs_matches` | function | 677 | <code>static int source_lfs_matches(const char &#42;repository, const char &#42;oid,</code> |
| `source_tree_clean` | function | 721 | <code>static int source_tree_clean(const char &#42;repository, const char &#42;commit,</code> |
| `source_ready` | function | 824 | <code>static int source_ready(const char &#42;profile, const char &#42;workspace,</code> |
| `same_scope` | function | 1082 | <code>static int same_scope(const char &#42;a, const char &#42;b) {</code> |
| `future_time` | function | 1094 | <code>static int future_time(const char &#42;raw) {</code> |
| `credentials_ready` | function | 1119 | <code>static int credentials_ready(const char &#42;profile) {</code> |
| `tcp_reachable` | function | 1185 | <code>static int tcp_reachable(const char &#42;hostname, int port, int timeout) {</code> |
| `network_ready` | function | 1242 | <code>static int network_ready(const char &#42;profile, int timeout, int &#42;probes) {</code> |
| `hf_component_11_3` | function | 1281 | <code>int hf_component_11_3(const char &#42;action, const char &#42;request, FILE &#42;output) {</code> |

## src/hyperfide/supervisor.c

[Open source](../../src/hyperfide/supervisor.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `_GNU_SOURCE` | macro | 1 | <code>#define _GNU_SOURCE</code> |
| `hf_process_identity` | function | 29 | <code>int hf_process_identity(pid_t pid,HfProcessIdentity &#42;identity) {</code> |
| `hf_process_matches` | function | 57 | <code>int hf_process_matches(const HfProcessIdentity &#42;expected,HfProcessIdentity &#42;observed) {</code> |
| `hf_process_json` | function | 62 | <code>void hf_process_json(FILE &#42;out,const HfProcessIdentity &#42;p) {</code> |
| `hf_supervisor_call` | function | 65 | <code>int hf_supervisor_call(const char &#42;path,int enrollment,const char &#42;payload,const char &#42;operation,const char &#42;idempotency,const char &#42;correlation,const char &#42;causation,const char &#42;seconds,const char &#42;n…</code> |
| `private_root` | function | 70 | <code>static int private_root(const char &#42;path,int &#42;fd) {</code> |
| `placement_prepare` | function | 83 | <code>static int placement_prepare(const char &#42;,const char &#42;,const char &#42;);</code> |
| `SlotProfile` | typedef | 87 | <code>typedef struct {const char &#42;name,&#42;boundary;int vm_level,accepts_credentials,exclusive;} SlotProfile;</code> |
| `slot_profiles` | variable | 88 | <code>static const SlotProfile slot_profiles&#91;&#93;={</code> |
| `slot_profile` | function | 92 | <code>static const SlotProfile &#42;slot_profile(const char &#42;name) {</code> |
| `slot_directories` | variable | 96 | <code>static const char &#42;const slot_directories&#91;&#93;={"worktree","build","home","tmp","sessions","logs"};</code> |
| `SLOT_DIRECTORY_COUNT` | macro | 97 | <code>#define SLOT_DIRECTORY_COUNT (sizeof slot_directories/sizeof slot_directories&#91;0&#93;)</code> |
| `SLOT_ACTIVE` | macro | 98 | <code>#define SLOT_ACTIVE "('PREPARING','READY','CLEANUP_REQUIRED')"</code> |
| `kernel_boot` | function | 99 | <code>static int kernel_boot(char output&#91;37&#93;) {</code> |
| `digest_valid` | function | 106 | <code>static int digest_valid(const char &#42;value) {</code> |
| `slot_db_open` | function | 113 | <code>static int slot_db_open(const char &#42;root,int create,sqlite3 &#42;&#42;db) {</code> |
| `slot_entry` | function | 135 | <code>static void slot_entry(FILE &#42;out,sqlite3_stmt &#42;row) {</code> |
| `hf_slot_inventory` | function | 149 | <code>int hf_slot_inventory(const char &#42;root,const char &#42;boot_id,const char &#42;preparation,char &#42;&#42;json,size_t &#42;length) {</code> |
| `uid_has_processes` | function | 170 | <code>static int uid_has_processes(uid_t uid) {</code> |
| `slot_result` | function | 180 | <code>static void slot_result(FILE &#42;out,const char &#42;root,const char &#42;slot,const char &#42;boot,const char &#42;kernel,long long uid,long long gid,int port,const SlotProfile &#42;profile,int sensitive,long long storage,…</code> |
| `slot_allocate` | function | 193 | <code>static int slot_allocate(const HfJson &#42;json,FILE &#42;out) {</code> |
| `slot_release` | function | 272 | <code>static int slot_release(const HfJson &#42;json,FILE &#42;out) {</code> |
| `slot_inventory_action` | function | 308 | <code>static int slot_inventory_action(const HfJson &#42;json,FILE &#42;out) {</code> |
| `request_action` | function | 337 | <code>static int request_action(const char &#42;action,const HfJson &#42;json,FILE &#42;out) {</code> |
| `placement_prepare` | function | 383 | <code>static int placement_prepare(const char &#42;config,const char &#42;run,const char &#42;generation) {</code> |
| `write_transport` | function | 394 | <code>static int write_transport(const char &#42;path,const HfTransportConfig &#42;settings,const char &#42;key_path,const char &#42;credential) {</code> |
| `enrollment_result` | function | 403 | <code>static int enrollment_result(const HfHttpResponse &#42;response,const char &#42;payload,const char &#42;previous,char credential&#91;37&#93;) {</code> |
| `credential_rotate` | function | 418 | <code>static int credential_rotate(const HfJson &#42;json,FILE &#42;out) {</code> |
| `request_proof` | function | 521 | <code>static int request_proof(const HfJson &#42;json,FILE &#42;out) {</code> |
| `hf_component_12_1` | function | 535 | <code>int hf_component_12_1(const char &#42;action,const char &#42;request,FILE &#42;out) {</code> |

## src/hyperfide/supervisor.h

[Open source](../../src/hyperfide/supervisor.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `HYPERFIDE_SUPERVISOR_H` | macro | 2 | <code>#define HYPERFIDE_SUPERVISOR_H</code> |
| `HfProcessIdentity` | typedef | 5 | <code>typedef struct {</code> |
| `hf_process_identity` | function | 12 | <code>int hf_process_identity(pid_t pid,HfProcessIdentity &#42;identity);</code> |
| `hf_process_matches` | function | 13 | <code>int hf_process_matches(const HfProcessIdentity &#42;expected,HfProcessIdentity &#42;observed);</code> |
| `hf_process_json` | function | 14 | <code>void hf_process_json(FILE &#42;output,const HfProcessIdentity &#42;identity);</code> |
| `hf_supervisor_call` | function | 15 | <code>int hf_supervisor_call(const char &#42;config_path,int enrollment,const char &#42;payload,</code> |
| `hf_launch_rpc` | function | 19 | <code>int hf_launch_rpc(const char &#42;state_dir,const char &#42;action,const char &#42;payload,FILE &#42;output);</code> |
| `HfRunnerBinding` | typedef | 20 | <code>typedef struct {</code> |
| `hf_runner_binding` | function | 25 | <code>int hf_runner_binding(const char &#42;request,HfRunnerBinding &#42;binding);</code> |
| `hf_runner_processes` | function | 26 | <code>int hf_runner_processes(const HfRunnerBinding &#42;,HfProcessIdentity &#42;,size_t);</code> |
| `HfTreeMember` | typedef | 31 | <code>typedef struct {</code> |
| `HfProcessTree` | typedef | 36 | <code>typedef struct {</code> |
| `hf_process_tree_inventory` | function | 40 | <code>int hf_process_tree_inventory(const HfRunnerBinding &#42;,HfProcessTree &#42;);</code> |
| `hf_process_tree_cancel` | function | 41 | <code>int hf_process_tree_cancel(const HfRunnerBinding &#42;,int rounds,int &#42;remaining);</code> |
| `hf_runner_job_claim` | function | 42 | <code>int hf_runner_job_claim(const char &#42;,const char &#42;,HfHttpResponse &#42;);</code> |
| `hf_runner_job_placement` | function | 43 | <code>int hf_runner_job_placement(const char &#42;,const char &#42;);</code> |
| `hf_runner_job_execute` | function | 44 | <code>int hf_runner_job_execute(const char &#42;,FILE &#42;);</code> |
| `hf_runner_admission_closed` | function | 46 | <code>int hf_runner_admission_closed(const char &#42;state_dir,uid_t uid);</code> |
| `hf_runner_control_api` | function | 47 | <code>int hf_runner_control_api(const char &#42;config_path,const char &#42;component,const char &#42;action,const char &#42;input,HfHttpResponse &#42;response);</code> |
| `hf_slot_watchdog` | function | 50 | <code>pid_t hf_slot_watchdog(uid_t uid, long long deadline_ns, int &#42;writer, const char &#42;owner);</code> |
| `hf_slot_watchdog_finish` | function | 51 | <code>int hf_slot_watchdog_finish(pid_t guard, int &#42;writer);</code> |
| `hf_slot_owner` | function | 52 | <code>int hf_slot_owner(uid_t uid, const char &#42;owner);</code> |
| `hf_slot_control_lock` | function | 54 | <code>int hf_slot_control_lock(uid_t uid, const char &#42;owner);</code> |
| `HfPreparationStage` | typedef | 56 | <code>typedef struct {</code> |
| `hf_runner_stage_preparation` | function | 62 | <code>int hf_runner_stage_preparation(const char &#42;config_path,const HfJson &#42;claim,int result,HfPreparationStage &#42;stage);</code> |
| `HfBudgetHandle` | typedef | 63 | <code>typedef struct {</code> |
| `hf_budget_prepare` | function | 72 | <code>int hf_budget_prepare(const char &#42;trusted_config_path,const char &#42;authenticated_charge_json,HfBudgetHandle &#42;);</code> |
| `hf_budget_attach` | function | 73 | <code>int hf_budget_attach(HfBudgetHandle &#42;,const HfProcessIdentity &#42;);</code> |
| `hf_budget_observe` | function | 74 | <code>int hf_budget_observe(const HfBudgetHandle &#42;,FILE &#42;);</code> |
| `hf_budget_release` | function | 75 | <code>int hf_budget_release(HfBudgetHandle &#42;);</code> |
| `hf_supervisor_daemon` | function | 76 | <code>int hf_supervisor_daemon(const char &#42;request,FILE &#42;out);</code> |
| `hf_slot_inventory` | function | 78 | <code>int hf_slot_inventory(const char &#42;root,const char &#42;boot_id,const char &#42;preparation,char &#42;&#42;json,size_t &#42;length);</code> |
| `HfPreparationProcessSpec` | typedef | 80 | <code>typedef struct {</code> |
| `HfPreparationProcessResult` | typedef | 91 | <code>typedef struct {</code> |
| `hf_preparation_process` | function | 98 | <code>int hf_preparation_process(const HfPreparationProcessSpec &#42;,HfPreparationProcessResult &#42;);</code> |

## src/hyperfide/supervisor_daemon.c

[Open source](../../src/hyperfide/supervisor_daemon.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `_GNU_SOURCE` | macro | 1 | <code>#define _GNU_SOURCE</code> |
| `Daemon` | typedef | 17 | <code>typedef struct {</code> |
| `stop_daemon` | function | 27 | <code>static void stop_daemon(int signal_number) {(void)signal_number;stopping=1;}</code> |
| `decimal` | function | 28 | <code>static int decimal(const char &#42;value,int positive) {</code> |
| `private_path` | function | 33 | <code>static int private_path(const char &#42;path,int directory) {</code> |
| `read_private` | function | 59 | <code>static int read_private(const char &#42;path,size_t max,char &#42;&#42;data,size_t &#42;size) {</code> |
| `field` | function | 68 | <code>static int field(const HfJson &#42;j,int token,const char &#42;key,char &#42;out,size_t cap) {</code> |
| `is_null` | function | 71 | <code>static int is_null(const HfJson &#42;j,int token) {</code> |
| `emit` | function | 75 | <code>static int emit(FILE &#42;out,const char &#42;event,const Daemon &#42;d) {</code> |
| `state_save` | function | 83 | <code>static int state_save(int dir,const Daemon &#42;d) {</code> |
| `make_payload` | function | 110 | <code>static char &#42;make_payload(Daemon &#42;d,const char &#42;kind) {</code> |
| `state_load` | function | 117 | <code>static int state_load(int dir,Daemon &#42;d) {</code> |
| `prep_valid` | function | 152 | <code>static int prep_valid(const char &#42;prep) {</code> |
| `receipt_identity` | function | 159 | <code>static int receipt_identity(Daemon &#42;d,const HfJson &#42;config,const char &#42;key_path,char &#42;&#42;receipt,size_t &#42;size) {</code> |
| `observation_bound` | function | 177 | <code>static int observation_bound(const HfJson &#42;slots,int list,const HfJson &#42;o,int item,const char &#42;root) {</code> |
| `registration_now` | function | 194 | <code>static char &#42;registration_now(Daemon &#42;d) {</code> |
| `load_config` | function | 224 | <code>static int load_config(const char &#42;request,Daemon &#42;d) {</code> |
| `accept_response` | function | 285 | <code>static int accept_response(Daemon &#42;d,const HfHttpResponse &#42;response) {</code> |
| `version_conflict` | function | 311 | <code>static int version_conflict(const HfHttpResponse &#42;r) {</code> |
| `pause_ms` | function | 316 | <code>static void pause_ms(long ms) {</code> |
| `hf_supervisor_daemon` | function | 320 | <code>int hf_supervisor_daemon(const char &#42;request,FILE &#42;out) {</code> |

## src/hyperfide/transport.c

[Open source](../../src/hyperfide/transport.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `_GNU_SOURCE` | macro | 1 | <code>#define _GNU_SOURCE</code> |
| `whitespace` | function | 19 | <code>static void whitespace(const char &#42;&#42;p) { while (&#42;&#42;p &amp;&amp; strchr(" &#92;t&#92;r&#92;n", &#42;&#42;p)) ++&#42;p; }</code> |
| `hex_value` | function | 20 | <code>static int hex_value(char ch) {</code> |
| `utf8` | function | 26 | <code>static int utf8(const char &#42;text) {</code> |
| `token_new` | function | 42 | <code>static int token_new(HfJson &#42;json, int parent, char type, const char &#42;p) {</code> |
| `parse_string` | function | 48 | <code>static int parse_string(HfJson &#42;json, const char &#42;&#42;cursor, int parent) {</code> |
| `parse_value` | function | 69 | <code>static int parse_value(HfJson &#42;json,const char &#42;&#42;cursor,int parent,unsigned depth) {</code> |
| `hf_json_parse` | function | 137 | <code>int hf_json_parse(HfJson &#42;json,const char &#42;text) {</code> |
| `append_codepoint` | function | 146 | <code>static int append_codepoint(char &#42;out,size_t &#42;used,size_t cap,unsigned cp) {</code> |
| `hf_json_string` | function | 156 | <code>int hf_json_string(const HfJson &#42;json,int token,char &#42;out,size_t cap) {</code> |
| `hf_json_field` | function | 188 | <code>int hf_json_field(const HfJson &#42;json,int object,const char &#42;name) {</code> |
| `hf_json_get` | function | 198 | <code>int hf_json_get(const HfJson &#42;json,const char &#42;name,char &#42;out,size_t cap) {return hf_json_string(json,hf_json_field(json,0,name),out,cap);}</code> |
| `hf_json_only` | function | 199 | <code>int hf_json_only(const HfJson &#42;json,int object,const char &#42;const &#42;names,size_t count) {</code> |
| `hf_json_raw` | function | 210 | <code>char &#42;hf_json_raw(const HfJson &#42;json,int token) {</code> |
| `hf_json_bool` | function | 214 | <code>int hf_json_bool(const HfJson &#42;json,int token,int &#42;out) {</code> |
| `hf_json_i64` | function | 220 | <code>int hf_json_i64(const HfJson &#42;json,int token,int64_t &#42;out) {</code> |
| `hf_json_write_string` | function | 227 | <code>void hf_json_write_string(FILE &#42;out,const char &#42;value) {</code> |
| `hf_uuid_valid` | function | 236 | <code>int hf_uuid_valid(const char &#42;value) {</code> |
| `hf_uuid_generate` | function | 244 | <code>int hf_uuid_generate(char out&#91;37&#93;) {</code> |
| `hf_sha256_bytes` | function | 250 | <code>int hf_sha256_bytes(const void &#42;data,size_t length,char out&#91;65&#93;) {</code> |
| `hf_base64url` | function | 256 | <code>char &#42;hf_base64url(const unsigned char &#42;data,size_t length) {</code> |
| `hf_base64url_decode` | function | 267 | <code>unsigned char &#42;hf_base64url_decode(const char &#42;text,size_t &#42;length) {</code> |
| `hf_private_read` | function | 283 | <code>int hf_private_read(const char &#42;path,size_t maximum,char &#42;&#42;data,size_t &#42;length) {</code> |
| `protected_directory` | function | 296 | <code>static int protected_directory(int fd,int root_only) {</code> |
| `protected_read_mode` | function | 302 | <code>static int protected_read_mode(const char &#42;path,size_t maximum,char &#42;&#42;data,size_t &#42;length,int public_anchor) {</code> |
| `hf_protected_read` | function | 348 | <code>int hf_protected_read(const char &#42;path,size_t maximum,char &#42;&#42;data,size_t &#42;length) {</code> |
| `hf_private_write` | function | 351 | <code>int hf_private_write(const char &#42;path,const void &#42;data,size_t length,int replace) {</code> |
| `hf_native_error` | function | 378 | <code>int hf_native_error(FILE &#42;out,const char &#42;code) {fprintf(stderr,"hyperfide native: %s&#92;n",code);(void)out;return 1;}</code> |
| `origin_valid` | function | 379 | <code>static int origin_valid(const char &#42;origin) {</code> |
| `hf_transport_config` | function | 395 | <code>int hf_transport_config(const char &#42;path,HfTransportConfig &#42;config) {</code> |
| `no_password` | function | 409 | <code>static int no_password(char &#42;buf,int size,int rwflag,void &#42;userdata) {(void)buf;(void)size;(void)rwflag;(void)userdata;return 0;}</code> |
| `private_key` | function | 410 | <code>static EVP_PKEY &#42;private_key(const char &#42;path) {</code> |
| `hf_transport_keygen` | function | 417 | <code>int hf_transport_keygen(const char &#42;path,char public_key&#91;44&#93;) {</code> |
| `seconds_valid` | function | 430 | <code>static int seconds_valid(const char &#42;value) {</code> |
| `hf_transport_sign` | function | 435 | <code>int hf_transport_sign(const char &#42;path,const char &#42;domain,const char &#42;endpoint,const char &#42;origin,const char &#42;identity,const char &#42;seconds,const char &#42;nonce,const char &#42;body,char signature&#91;87&#93;) {</code> |
| `hf_transport_qualified` | function | 447 | <code>int hf_transport_qualified(void) {</code> |
| `curl_initialize` | function | 453 | <code>static void curl_initialize(void) {curl_ready=curl_global_init(CURL_GLOBAL_DEFAULT)==CURLE_OK;}</code> |
| `response_write` | function | 454 | <code>static size_t response_write(char &#42;data,size_t size,size_t count,void &#42;opaque) {</code> |
| `hf_transport_post` | function | 462 | <code>int hf_transport_post(const HfTransportConfig &#42;config,int enrollment,const char &#42;body,const char &#42;seconds,const char &#42;nonce,HfHttpResponse &#42;response) {</code> |
| `HF_CURL` | macro | 496 | <code>#define HF_CURL(option,value) do {if (configured&amp;&amp;curl_easy_setopt(curl,option,value)!=CURLE_OK) configured=0;} while (0)</code> |
| `hf_envelope` | function | 524 | <code>char &#42;hf_envelope(const char &#42;payload,const char &#42;operation,const char &#42;idempotency,const char &#42;correlation,const char &#42;causation) {</code> |
| `hf_http_response_free` | function | 538 | <code>void hf_http_response_free(HfHttpResponse &#42;response) {free(response-&gt;body);memset(response,0,sizeof &#42;response);}</code> |

## src/hyperfide/transport.h

[Open source](../../src/hyperfide/transport.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `HYPERFIDE_TRANSPORT_H` | macro | 2 | <code>#define HYPERFIDE_TRANSPORT_H</code> |
| `HF_BODY_LIMIT` | macro | 7 | <code>#define HF_BODY_LIMIT (1024U &#42; 1024U)</code> |
| `HF_JSON_TOKENS` | macro | 8 | <code>#define HF_JSON_TOKENS 65536</code> |
| `HfJsonToken` | typedef | 9 | <code>typedef struct { size_t start, end; int parent, next, count; char type; } HfJsonToken;</code> |
| `HfJson` | typedef | 10 | <code>typedef struct { const char &#42;text; size_t length; int count; HfJsonToken tokens&#91;HF_JSON_TOKENS&#93;; } HfJson;</code> |
| `hf_json_parse` | function | 11 | <code>int hf_json_parse(HfJson &#42;json,const char &#42;text);</code> |
| `hf_json_field` | function | 12 | <code>int hf_json_field(const HfJson &#42;json,int object,const char &#42;name);</code> |
| `hf_json_string` | function | 13 | <code>int hf_json_string(const HfJson &#42;json,int token,char &#42;output,size_t capacity);</code> |
| `hf_json_get` | function | 14 | <code>int hf_json_get(const HfJson &#42;json,const char &#42;name,char &#42;output,size_t capacity);</code> |
| `hf_json_only` | function | 15 | <code>int hf_json_only(const HfJson &#42;json,int object,const char &#42;const &#42;names,size_t count);</code> |
| `hf_json_raw` | function | 16 | <code>char &#42;hf_json_raw(const HfJson &#42;json,int token);</code> |
| `hf_json_bool` | function | 17 | <code>int hf_json_bool(const HfJson &#42;json,int token,int &#42;output);</code> |
| `hf_json_i64` | function | 18 | <code>int hf_json_i64(const HfJson &#42;json,int token,int64_t &#42;output);</code> |
| `hf_json_write_string` | function | 19 | <code>void hf_json_write_string(FILE &#42;output,const char &#42;value);</code> |
| `hf_uuid_valid` | function | 20 | <code>int hf_uuid_valid(const char &#42;value);</code> |
| `hf_uuid_generate` | function | 21 | <code>int hf_uuid_generate(char output&#91;37&#93;);</code> |
| `hf_sha256_bytes` | function | 22 | <code>int hf_sha256_bytes(const void &#42;data,size_t length,char output&#91;65&#93;);</code> |
| `hf_base64url` | function | 23 | <code>char &#42;hf_base64url(const unsigned char &#42;data,size_t length);</code> |
| `hf_base64url_decode` | function | 24 | <code>unsigned char &#42;hf_base64url_decode(const char &#42;text,size_t &#42;length);</code> |
| `hf_private_read` | function | 25 | <code>int hf_private_read(const char &#42;path,size_t maximum,char &#42;&#42;data,size_t &#42;length);</code> |
| `hf_protected_read` | function | 28 | <code>int hf_protected_read(const char &#42;path,size_t maximum,char &#42;&#42;data,size_t &#42;length);</code> |
| `hf_private_write` | function | 29 | <code>int hf_private_write(const char &#42;path,const void &#42;data,size_t length,int replace);</code> |
| `hf_native_error` | function | 30 | <code>int hf_native_error(FILE &#42;output,const char &#42;code);</code> |
| `HfTransportConfig` | typedef | 31 | <code>typedef struct {</code> |
| `HfHttpResponse` | typedef | 35 | <code>typedef struct { long status;char &#42;body;size_t length;int uncertain;char error&#91;128&#93;; } HfHttpResponse;</code> |
| `hf_transport_qualified` | function | 36 | <code>int hf_transport_qualified(void);</code> |
| `hf_transport_config` | function | 37 | <code>int hf_transport_config(const char &#42;path,HfTransportConfig &#42;config);</code> |
| `hf_transport_keygen` | function | 38 | <code>int hf_transport_keygen(const char &#42;path,char public_key&#91;44&#93;);</code> |
| `hf_transport_sign` | function | 39 | <code>int hf_transport_sign(const char &#42;key_path,const char &#42;domain,const char &#42;endpoint,</code> |
| `hf_transport_post` | function | 41 | <code>int hf_transport_post(const HfTransportConfig &#42;config,int enrollment,const char &#42;body,</code> |
| `hf_envelope` | function | 43 | <code>char &#42;hf_envelope(const char &#42;payload,const char &#42;operation_id,const char &#42;idempotency_key,</code> |
| `hf_http_response_free` | function | 45 | <code>void hf_http_response_free(HfHttpResponse &#42;response);</code> |
