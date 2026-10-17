# Source reference: Scripts and tooling

This part of the [source reference](../SOURCE-REFERENCE.md) lists the indexed declarations of the maintenance scripts under `scripts/`, the deployment helpers under `deploy/hyperfide/`, the supervisory host under `runtime/` and the spec-pack tools under `spec/hyperfide/tools/`: 124 declarations in 8 files at revision `a2a367f9` of the Hyperfide 2.0 development tree (`hyperfide version` 2.0.0-dev, not a release). Method, column meanings and caveats are described in the entry point; source links resolve from this directory and line numbers refer to revision `a2a367f9`.

## deploy/hyperfide/install-service.mjs

[Open source](../../deploy/hyperfide/install-service.mjs)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `options` | object | 9 | <code>const args=process.argv.slice(2),options={};let promote=false;</code> |
| `refuse` | function | 10 | <code>function refuse(code){throw Object.assign(new Error(code),{code});}</code> |
| `parseArguments` | function | 11 | <code>function parseArguments(){for(let i=0;i&lt;args.length;i++){</code> |
| `protectedPath` | function | 17 | <code>async function protectedPath(filename,directory){</code> |
| `syncDirectory` | function | 26 | <code>async function syncDirectory(directory){const h=await fs.open(directory,'r');try{await h.sync();}finally{await h.close();}}</code> |
| `rootDirectory` | function | 27 | <code>async function rootDirectory(directory){</code> |
| `copyFile` | function | 32 | <code>async function copyFile(source,destination,mode,expectedSize){</code> |
| `readManifest` | function | 45 | <code>async function readManifest(filename){</code> |
| `immutableTree` | function | 57 | <code>async function immutableTree(directory){</code> |
| `syncTree` | function | 65 | <code>async function syncTree(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true}))if(entry.isDirectory())await syncTree(path.join(directory,entry.name));await syncDirectory(direct…</code> |
| `run` | function | 66 | <code>async function run(){</code> |

## deploy/hyperfide/migrate.mjs

[Open source](../../deploy/hyperfide/migrate.mjs)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `fail` | function | 8 | <code>function fail(code){throw Object.assign(new Error(code),{code});}</code> |
| `regular` | function | 9 | <code>async function regular(filename,privateFile=false){</code> |
| `main` | function | 14 | <code>async function main(){</code> |

## runtime/supervisory_host.py

[Open source](../../runtime/supervisory_host.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Refusal` | class | 27 | <code>class Refusal(Exception):</code> |
| `__init__` | method | 28 | <code>def __init__(self,code,message):self.code,self.message=code,message;super().__init__(message)</code> |
| `need` | function | 29 | <code>def need(ok,code='INVALID_REQUEST',message='Request is invalid'):</code> |
| `exact` | function | 31 | <code>def exact(v,keys):need(type(v) is dict and set(v)==set(keys));return v</code> |
| `integer` | function | 32 | <code>def integer(v,lo,hi):need(type(v) is int and lo&lt;=v&lt;=hi);return v</code> |
| `uid` | function | 33 | <code>def uid(v):need(type(v) is str and UUID.fullmatch(v));return v</code> |
| `decimal` | function | 34 | <code>def decimal(v,positive=False):</code> |
| `canonical` | function | 36 | <code>def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()</code> |
| `digest` | function | 37 | <code>def digest(b):return 'sha256:'+hashlib.sha256(b).hexdigest()</code> |
| `pairs` | function | 38 | <code>def pairs(items):</code> |
| `parse` | function | 42 | <code>def parse(data):</code> |
| `components` | function | 46 | <code>def components(v):</code> |
| `protected` | function | 49 | <code>def protected(path,private_leaf=False):</code> |
| `root_directory` | function | 58 | <code>def root_directory(v):</code> |
| `private_bytes` | function | 60 | <code>def private_bytes(v,limit,root=None):</code> |
| `atomic` | function | 73 | <code>def atomic(path,value):</code> |
| `process` | function | 84 | <code>def process(pid):</code> |
| `identity` | function | 100 | <code>def identity(p):return {k:p&#91;k&#93; for k in IDENTITY_KEYS}</code> |
| `same` | function | 101 | <code>def same(expected,p):return p is not None and identity(p)==expected</code> |
| `born_same` | function | 102 | <code>def born_same(expected,p):return p is not None and all(expected&#91;k&#93;==p&#91;k&#93; for k in ('pid','start_time','kernel_boot_id'))</code> |
| `uid_processes` | function | 103 | <code>def uid_processes(target):</code> |
| `kernel_probe` | function | 110 | <code>def kernel_probe():</code> |
| `secure_execution` | function | 119 | <code>def secure_execution(v,allowed):</code> |
| `binary_fd` | function | 130 | <code>def binary_fd(plan):</code> |
| `expiry` | function | 140 | <code>def expiry(v):</code> |
| `Entry` | class | 145 | <code>class Entry:</code> |
| `__init__` | method | 146 | <code>def __init__(self,path,record):</code> |
| `save` | method | 148 | <code>def save(self):atomic(self.path/'state.json',self.record)</code> |
| `op` | method | 149 | <code>def op(self,key):return self.path/'operations'/(uid(key)+'.json')</code> |
| `receipt` | method | 150 | <code>def receipt(self,key,request):</code> |
| `begin` | method | 157 | <code>def begin(self,key,kind,request):</code> |
| `finish` | method | 159 | <code>def finish(self,key,kind,request,result):atomic(self.op(key),{'kind':kind,'request_digest':request,'state':'COMPLETED','result':result});return result</code> |
| `Host` | class | 160 | <code>class Host:</code> |
| `__init__` | method | 161 | <code>def __init__(self,c,config_digest):</code> |
| `load` | method | 175 | <code>def load(self):</code> |
| `view` | method | 191 | <code>def view(self,e,after='0',limit=64):</code> |
| `observe` | method | 194 | <code>def observe(self,e):</code> |
| `capture` | method | 210 | <code>def capture(self,e,fd,stream):</code> |
| `read_handshake` | method | 239 | <code>async def read_handshake(self,fd):</code> |
| `child` | method | 250 | <code>def child(self,p,exe,stdin,out,err,gate,ready,exec_error,parent):</code> |
| `start` | method | 269 | <code>async def start(self,q):</code> |
| `get` | method | 326 | <code>def get(self,launch):</code> |
| `require_identity` | method | 328 | <code>def require_identity(self,e,v):</code> |
| `input` | method | 330 | <code>async def input(self,q):</code> |
| `reap` | method | 347 | <code>def reap(self):</code> |
| `terminate` | method | 359 | <code>async def terminate(self,e,natural=False):</code> |
| `stop` | method | 386 | <code>async def stop(self,q):</code> |
| `root_profile` | method | 392 | <code>def root_profile(self,q):</code> |
| `profile_inspect` | method | 395 | <code>def profile_inspect(self,q):</code> |
| `start_profile` | method | 398 | <code>async def start_profile(self,q):</code> |
| `dispatch` | method | 413 | <code>async def dispatch(self,q,peer_uid=0):</code> |
| `client` | method | 424 | <code>async def client(self,reader,writer):</code> |
| `monitor` | method | 443 | <code>async def monitor(self):</code> |
| `shutdown` | method | 461 | <code>async def shutdown(self):</code> |
| `run` | method | 469 | <code>async def run(self):</code> |
| `main` | function | 493 | <code>def main():</code> |

## scripts/bench-indexing.py

[Open source](../../scripts/bench-indexing.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `command` | function | 26 | <code>def command(args, cwd, env=None, timeout_s=None):</code> |
| `db_size` | function | 58 | <code>def db_size(db):</code> |
| `database_path` | function | 66 | <code>def database_path(root):</code> |
| `coverage` | function | 73 | <code>def coverage(db, branch):</code> |
| `stage` | function | 90 | <code>def stage(cg, root, db, name, flags, env, branch="main", timeout_s=None):</code> |
| `compare_baseline` | function | 102 | <code>def compare_baseline(current, baseline, factor, floor_ms):</code> |
| `main` | function | 142 | <code>def main():</code> |

## scripts/format_changelog.py

[Open source](../../scripts/format_changelog.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `FormatError` | class | 90 | <code>class FormatError(ValueError):</code> |
| `git` | function | 94 | <code>def git(repo: Path, &#42;args: str) -&gt; str:</code> |
| `Dates` | class | 105 | <code>class Dates:</code> |
| `__init__` | method | 108 | <code>def __init__(self, repo: Path):</code> |
| `_records` | method | 126 | <code>def _records(payload: str) -&gt; dict&#91;str, tuple&#91;str, str, str, str&#93;&#93;:</code> |
| `resolve` | method | 140 | <code>def resolve(self, commit: str) -&gt; tuple&#91;str, str&#93;:</code> |
| `metadata` | method | 168 | <code>def metadata(self, commit: str) -&gt; tuple&#91;str, str, str&#93;:</code> |
| `metadata_token` | function | 205 | <code>def metadata_token(value: str) -&gt; str:</code> |
| `quoted_subject` | function | 211 | <code>def quoted_subject(subject: str) -&gt; str:</code> |
| `entry_type` | function | 223 | <code>def entry_type(subject: str) -&gt; str:</code> |
| `Entry` | class | 244 | <code>class Entry:</code> |
| `parse_entry` | function | 250 | <code>def parse_entry(</code> |
| `section` | function | 282 | <code>def section(body: str, dates: Dates, newline: str, missing_metadata: str) -&gt; str:</code> |
| `format_changelog` | function | 375 | <code>def format_changelog(text: str, repo: Path, missing_metadata: str = "recover") -&gt; str:</code> |
| `atomic_output` | function | 396 | <code>def atomic_output(path: Path, content: bytes, mode: int = 0o644) -&gt; None:</code> |
| `main` | function | 410 | <code>def main(argv: list&#91;str&#93; &#124; None = None) -&gt; int:</code> |

## scripts/hyperfide-native-components.py

[Open source](../../scripts/hyperfide-native-components.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `parse` | function | 14 | <code>def parse(text):</code> |
| `contained` | function | 36 | <code>def contained(root, path, required=True):</code> |
| `inventory` | function | 51 | <code>def inventory(root):</code> |
| `version_tuple` | function | 151 | <code>def version_tuple(text):</code> |
| `tool` | function | 155 | <code>def tool(argv, stdin=None):</code> |
| `package` | function | 162 | <code>def package(name):</code> |
| `resolve` | function | 168 | <code>def resolve(library, declaration):</code> |
| `link_contract` | function | 199 | <code>def link_contract(items):</code> |
| `generate` | function | 219 | <code>def generate(items):</code> |
| `main` | function | 230 | <code>def main():</code> |

## spec/hyperfide/tools/render_native.py

[Open source](../../spec/hyperfide/tools/render_native.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `render` | function | 22 | <code>def render(root, mode):</code> |
| `main` | function | 130 | <code>def main():</code> |

## spec/hyperfide/tools/validate_pack.py

[Open source](../../spec/hyperfide/tools/validate_pack.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `InvalidKVX` | class | 25 | <code>class InvalidKVX(ValueError):</code> |
| `strict_json` | function | 29 | <code>def strict_json(text: str):</code> |
| `parse_kvx` | function | 44 | <code>def parse_kvx(text: str) -&gt; dict:</code> |
| `workflow_errors` | function | 74 | <code>def workflow_errors(root: Path, mode: str) -&gt; list&#91;str&#93;:</code> |
| `dependency_errors` | function | 90 | <code>def dependency_errors(tasks: dict) -&gt; list&#91;str&#93;:</code> |
| `task_errors` | function | 124 | <code>def task_errors(tasks: dict, clauses: set, cases: set, mode: str = 'draft') -&gt; list&#91;str&#93;:</code> |
| `negative_self_tests` | function | 224 | <code>def negative_self_tests() -&gt; list&#91;dict&#93;:</code> |
| `Validator` | class | 300 | <code>class Validator:</code> |
| `__init__` | method | 301 | <code>def __init__(self, root: Path, output: Path, publication_policy: Path &#124; None = None, mode: str = 'draft'):</code> |
| `public_files` | method | 311 | <code>def public_files(self, pattern: str):</code> |
| `validate_privacy` | method | 324 | <code>def validate_privacy(self) -&gt; None:</code> |
| `needed` | method | 367 | <code>def needed(self, relative: str) -&gt; Path &#124; None:</code> |
| `run` | method | 380 | <code>def run(self) -&gt; dict:</code> |
| `validate_spec` | method | 456 | <code>def validate_spec(self, sections: dict) -&gt; set:</code> |
| `validate_traceability` | method | 571 | <code>def validate_traceability(self, sections: dict, cases: set) -&gt; None:</code> |
| `validate_markdown_and_diagrams` | method | 623 | <code>def validate_markdown_and_diagrams(self) -&gt; None:</code> |
| `validate_whitespace` | method | 659 | <code>def validate_whitespace(self) -&gt; None:</code> |
| `private_audit` | function | 674 | <code>def private_audit(root: Path) -&gt; str:</code> |
| `main` | function | 703 | <code>def main() -&gt; int:</code> |
