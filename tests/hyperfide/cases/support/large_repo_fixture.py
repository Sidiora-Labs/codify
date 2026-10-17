#!/usr/bin/env python3
"""Deterministic very-large multi-language Git fixture for packet-scoped workspace slices (task 11.5).

The generator is seeded and pins author/committer identity and time, so the same seed always yields the
same commit identities. It writes only below an explicit disposable root and `--cleanup` removes it.

Layout (per language L in LANGUAGES, per module mNN):
  services/<L>/<build roots>                 per-language build manifests and lockfiles
  services/<L>/mNN/src/uK.<ext>              unit K calls unit K+1 (real cross-file reference/import)
  services/<L>/mNN/tests/test_u0.<ext>       test referencing unit 0 and its fixture directory
  services/<L>/mNN/tests/fixtures/case.json  test fixture data
  contracts/                                 shared contracts referenced by unit 0 of every module
  registry/components.json                   registry file
Commit 1 (graph commit) has no gitlink, because graph extraction refuses repositories with gitlinks.
Commit 2 (pinned commit) adds a submodule gitlink inside a sliced directory and changes one unit, so a
graph published at commit 1 is stale relative to commit 2. LFS-tracked assets exist in both commits.
"""
from __future__ import annotations
import argparse, hashlib, json, os, random, shutil, subprocess, sys, tempfile
from pathlib import Path

LANGUAGES = ("c", "cpp", "rust", "go", "python", "typescript", "javascript", "java", "kotlin", "ruby", "shell", "sql", "proto")
UNITS = 20
MODULES = 72
UNRESOLVED_UNIT = ("python", 2, 5)
ROOT_MARKER = ".hf-large-repo-fixture"
IDENTITY = {"GIT_AUTHOR_NAME": "Hyperfide slice fixture", "GIT_AUTHOR_EMAIL": "fixture@example.invalid",
            "GIT_COMMITTER_NAME": "Hyperfide slice fixture", "GIT_COMMITTER_EMAIL": "fixture@example.invalid"}
BUILD_ROOTS = {
    "c": {"Makefile": "all:\n\t@echo c\n"},
    "cpp": {"CMakeLists.txt": "cmake_minimum_required(VERSION 3.20)\nproject(fixture_cpp CXX)\n"},
    "rust": {"Cargo.toml": "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\n", "Cargo.lock": "version = 3\n"},
    "go": {"go.mod": "module example.invalid/fixture\n\ngo 1.22\n", "go.sum": ""},
    "python": {"pyproject.toml": "[project]\nname = \"fixture\"\nversion = \"0.1.0\"\n"},
    "typescript": {"package.json": "{\"name\":\"fixture-ts\",\"version\":\"0.1.0\"}\n", "package-lock.json": "{\"lockfileVersion\":3}\n"},
    "javascript": {"package.json": "{\"name\":\"fixture-js\",\"version\":\"0.1.0\"}\n", "package-lock.json": "{\"lockfileVersion\":3}\n"},
    "java": {"pom.xml": "<project><modelVersion>4.0.0</modelVersion><artifactId>fixture</artifactId></project>\n"},
    "kotlin": {"build.gradle.kts": "plugins { kotlin(\"jvm\") }\n", "settings.gradle.kts": "rootProject.name = \"fixture\"\n"},
    "ruby": {"Gemfile": "source \"https://rubygems.org\"\n", "Gemfile.lock": "GEM\n"},
    "shell": {"Makefile": "check:\n\t@sh -n */src/*.sh\n"},
    "sql": {"BUILD": "filegroup(name = \"sql\")\n"},
    "proto": {"BUILD": "proto_library(name = \"proto\")\n"},
}
EXTENSIONS = {"c": "c", "cpp": "cpp", "rust": "rs", "go": "go", "python": "py", "typescript": "ts", "javascript": "js",
              "java": "java", "kotlin": "kt", "ruby": "rb", "shell": "sh", "sql": "sql", "proto": "proto"}


def name(language: str, module: int, unit) -> str:
    stem = {"c": "c", "cpp": "cpp", "rust": "rs", "go": "Go", "python": "py", "typescript": "ts", "javascript": "js",
            "java": "java", "kotlin": "kt", "ruby": "rb", "shell": "sh", "sql": "sql", "proto": "Proto"}[language]
    if language in ("go", "proto"):
        return f"{stem}M{module:02d}U{unit}"
    if language in ("typescript", "javascript", "java", "kotlin"):
        return f"{stem}M{module:02d}U{unit}"
    return f"{stem}_m{module:02d}_u{unit}"


def contract(language: str) -> str:
    return {"go": "GoContractVersion", "proto": "ProtoContract", "typescript": "tsContractVersion", "javascript": "jsContractVersion",
            "java": "javaContractVersion", "kotlin": "ktContractVersion"}.get(language, language[:3] + "_contract_version")


def source(language: str, module: int, unit: int, callees: list[str], uses_contract: bool, own: str | None = None) -> str:
    """One unit: a uniquely named, parameterless definition that calls each callee by name (cross-file edge).

    Parameterless bodies keep every reference resolvable, so closure completeness is decided by real edges only."""
    own = own or name(language, module, unit)
    calls = list(callees) + ([contract(language)] if uses_contract else [])
    if language in ("c", "cpp"):
        body = " + ".join([f"{c}()" for c in calls] or ["0"])
        return "".join(f"int {c}(void);\n" for c in calls) + f"int {own}(void) {{ return {body} + {unit}; }}\n"
    if language == "rust":
        body = " + ".join([f"{c}()" for c in calls] or ["0"])
        return f"pub fn {own}() -> i64 {{ {body} + {unit} }}\n"
    if language == "go":
        body = " + ".join([f"{c}()" for c in calls] or ["0"])
        return f"package m{module:02d}\n\nfunc {own}() int {{ return {body} + {unit} }}\n"
    if language == "python":
        body = " + ".join([f"{c}()" for c in calls] or ["0"])
        return f"def {own}():\n    return {body} + {unit}\n"
    if language in ("typescript", "javascript"):
        body = " + ".join([f"{c}()" for c in calls] or ["0"])
        return f"export function {own}() {{ return {body} + {unit}; }}\n"
    if language == "java":
        body = " + ".join([f"{holder(c)}.{c}()" for c in calls] or ["0"])
        return f"class {holder(own)} {{\n  static int {own}() {{ return {body} + {unit}; }}\n}}\n"
    if language == "kotlin":
        body = " + ".join([f"{c}()" for c in calls] or ["0"])
        return f"fun {own}() = {body} + {unit}\n"
    if language == "ruby":
        body = " + ".join([f"{c}()" for c in calls] or ["0"])
        return f"def {own}()\n  {body} + {unit}\nend\n"
    if language == "shell":
        body = "\n".join(f"  {c}" for c in calls) or "  :"
        return f"{own}() {{\n{body}\n}}\n"
    if language == "sql":
        body = " + ".join([f"{c}()" for c in calls] or ["0"])
        return f"CREATE FUNCTION {own}() RETURNS integer AS $$ SELECT {body} + {unit} $$ LANGUAGE sql;\n"
    if language == "proto":
        fields = "".join(f"  {c} f{n + 1} = {n + 1};\n" for n, c in enumerate(calls))
        return f"syntax = \"proto3\";\nmessage {own} {{\n{fields}}}\n"
    raise ValueError(language)


def holder(function: str) -> str:
    return function[0].upper() + function[1:] + "Holder"


def contract_source(language: str) -> str:
    return source(language, 0, 0, [], False, own=contract(language)).replace("package m00", "package contracts")


def test_source(language: str, module: int) -> str:
    target = name(language, module, 0)
    tested = "test_" + target if "_" in target else "Test" + target[0].upper() + target[1:]
    comment = {"python": "#", "ruby": "#", "shell": "#", "sql": "--"}.get(language, "//")
    # The test names its fixture directory; this is the edge "test fixtures referenced by closure tests".
    return source(language, module, 0, [target], False, own=tested) + comment + " fixture: fixtures/case.json\n"


def git(cwd: Path, *args: str, env: dict | None = None, data: bytes | None = None) -> str:
    environment = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(cwd), "GIT_CONFIG_NOSYSTEM": "1",
                   "GIT_CONFIG_GLOBAL": "/dev/null", "LC_ALL": "C", "GIT_TERMINAL_PROMPT": "0",
                   # Detached auto-gc would repack concurrently with later clones of the fixture.
                   "GIT_CONFIG_COUNT": "3", "GIT_CONFIG_KEY_0": "gc.auto", "GIT_CONFIG_VALUE_0": "0",
                   "GIT_CONFIG_KEY_1": "maintenance.auto", "GIT_CONFIG_VALUE_1": "false",
                   "GIT_CONFIG_KEY_2": "gc.autoDetach", "GIT_CONFIG_VALUE_2": "false", **IDENTITY, **(env or {})}
    result = subprocess.run(["git", *args], cwd=cwd, env=environment, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=600)
    if result.returncode:
        raise RuntimeError("fixture git " + " ".join(args[:2]) + " failed: " + result.stderr.decode()[-800:])
    return result.stdout.decode().strip()


def commit(cwd: Path, message: str, when: str, stage: bool = True) -> str:
    if stage:
        git(cwd, "add", "-A")
    git(cwd, "-c", "core.hooksPath=/dev/null", "commit", "-q", "--no-gpg-sign", "-m", message,
        env={"GIT_AUTHOR_DATE": when, "GIT_COMMITTER_DATE": when})
    return git(cwd, "rev-parse", "HEAD")


def lfs_pointer(content: bytes) -> tuple[bytes, str]:
    oid = hashlib.sha256(content).hexdigest()
    return (f"version https://git-lfs.github.com/spec/v1\noid sha256:{oid}\nsize {len(content)}\n").encode(), oid


def write(path: Path, text) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text if isinstance(text, bytes) else text.encode())


def build(root: Path, seed: int = 115, modules: int = MODULES, units: int = UNITS) -> dict:
    """Create the fixture below `root` (which must not exist) and return its description."""
    root = Path(root)
    if root.exists():
        raise RuntimeError("fixture root must not pre-exist")
    root.mkdir(parents=True)
    (root / ROOT_MARKER).write_text("disposable\n")
    rng = random.Random(seed)
    repo, sub = root / "repo", root / "submodule"
    # The submodule is a separate repository pinned by gitlink in commit 2.
    sub.mkdir()
    git(sub, "init", "-q", "-b", "main")
    git(sub, "config", "gc.auto", "0")
    write(sub / "README.md", "Vendored fixture submodule\n")
    write(sub / "lib/vendored.go", "package vendored\n\nfunc Vendored(v int) int { return v }\n")
    sub_commit = commit(sub, "submodule fixture", "2026-01-01T00:00:00Z")
    git(sub, "config", "uploadpack.allowFilter", "true")
    git(sub, "config", "uploadpack.allowAnySHA1InWant", "true")

    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "gc.auto", "0")
    files: list[str] = []
    def put(relative: str, text) -> None:
        write(repo / relative, text); files.append(relative)
    put("WORKSPACE", "workspace(name = \"fixture\")\n")
    put("Makefile", "include services/common.mk\nall:\n\t@echo root\n")
    put("services/common.mk", "COMMON := 1\n")
    put("registry/components.json", json.dumps({"schema_version": 1, "languages": list(LANGUAGES)}, sort_keys=True) + "\n")
    for language in LANGUAGES:
        ext = EXTENSIONS[language]
        put(f"contracts/{language}/contract.{ext}", contract_source(language))
        for filename, text in BUILD_ROOTS[language].items():
            put(f"services/{language}/{filename}", text)
        for module in range(modules):
            # Each module's middle unit also calls one earlier module's leaf: a seeded, acyclic cross-module edge.
            dependency = rng.randrange(module) if module else None
            for unit in range(units):
                callees = [name(language, module, unit + 1)] if unit + 1 < units else []
                if dependency is not None and unit == units // 2:
                    callees.append(name(language, dependency, units - 1))
                if (language, module, unit) == UNRESOLVED_UNIT:
                    callees.append("dynamic_plugin_loader")  # deliberately undefined: an edge the graph cannot resolve
                put(f"services/{language}/m{module:02d}/src/u{unit}.{ext}", source(language, module, unit, callees, unit == 0))
            put(f"services/{language}/m{module:02d}/tests/test_u0.{ext}", test_source(language, module))
            put(f"services/{language}/m{module:02d}/tests/fixtures/case.json", json.dumps({"module": module, "language": language}) + "\n")
    # LFS-tracked assets inside a sliceable directory; repository bytes are pointers, objects live in .git/lfs.
    put(".gitattributes", "*.bin filter=lfs diff=lfs merge=lfs -text\n")
    lfs: list[dict] = []
    for module in (0, 1):
        content = hashlib.sha256(f"asset-{seed}-{module}".encode()).digest() * 512
        pointer, oid = lfs_pointer(content)
        relative = f"services/python/m{module:02d}/assets/model.bin"
        put(relative, pointer)
        target = repo / ".git/lfs/objects" / oid[:2] / oid[2:4] / oid
        write(target, content)
        lfs.append({"path": relative, "oid": "sha256:" + oid, "size": len(content), "content_sha256": "sha256:" + hashlib.sha256(content).hexdigest()})
    graph_commit = commit(repo, "large repository fixture", "2026-01-02T00:00:00Z")
    # Commit 2: the pinned commit adds a gitlink inside services/go/m00 and edits one unit.
    gitlink = "services/go/m00/vendor/sub"
    write(repo / ".gitmodules", f"[submodule \"vendor-sub\"]\n\tpath = {gitlink}\n\turl = ../submodule\n")
    changed = "services/python/m00/src/u1.py"
    write(repo / changed, (repo / changed).read_text() + "# pinned-commit change\n")
    git(repo, "add", "-A")
    # The gitlink is staged after `add -A`, which would otherwise record the absent submodule directory as a deletion.
    git(repo, "update-index", "--add", "--cacheinfo", f"160000,{sub_commit},{gitlink}")
    pinned_commit = commit(repo, "pin vendored submodule", "2026-01-03T00:00:00Z", stage=False)
    # Commit 0: a small control sample (shared roots plus module 00 of every language) on its own branch. It is small
    # enough for the live 7.1 HTTPS extraction deadline and proves the large-graph extraction port byte-identical.
    sample_index = root / "control-sample.index"
    entries = git(repo, "ls-tree", "-r", "-z", "--full-tree", graph_commit).split("\0")
    selected = [e for e in entries if e and (lambda p: p.count("/") <= 2 and "/m" not in p or "/m00/" in p)(e.split("\t", 1)[1])]
    git(repo, "update-index", "--add", "-z", "--index-info", env={"GIT_INDEX_FILE": str(sample_index)}, data=("\0".join(selected) + "\0").encode())
    sample_tree = git(repo, "write-tree", env={"GIT_INDEX_FILE": str(sample_index)})
    sample_index.unlink()
    when = "2026-01-01T12:00:00Z"
    control_commit = git(repo, "commit-tree", sample_tree, "-m", "control sample", env={"GIT_AUTHOR_DATE": when, "GIT_COMMITTER_DATE": when})
    git(repo, "update-ref", "refs/heads/control-sample", control_commit)
    files.append(".gitmodules")
    git(repo, "config", "uploadpack.allowFilter", "true")
    git(repo, "config", "uploadpack.allowAnySHA1InWant", "true")
    git(repo, "config", "lfs.allowincompletepush", "false")
    tree_files = int(git(repo, "ls-tree", "-r", "--name-only", graph_commit).count("\n")) + 1
    languages = sorted(LANGUAGES)
    return {"schema_version": 1, "root": str(root), "repository": str(repo), "submodule": str(sub), "seed": seed,
            "graph_commit": graph_commit, "graph_tree": git(repo, "rev-parse", graph_commit + "^{tree}"),
            "pinned_commit": pinned_commit, "pinned_tree": git(repo, "rev-parse", pinned_commit + "^{tree}"),
            "control_commit": control_commit, "control_tree": sample_tree, "control_files": len(selected),
            "submodule_commit": sub_commit, "gitlink": gitlink, "changed_path": changed, "lfs": lfs,
            "file_count": tree_files, "language_count": len(languages), "languages": languages,
            "modules_per_language": modules, "units_per_module": units,
            "unresolved_path": "services/%s/m%02d/src/u%d.%s" % (UNRESOLVED_UNIT[0], UNRESOLVED_UNIT[1], UNRESOLVED_UNIT[2], EXTENSIONS[UNRESOLVED_UNIT[0]])}


# 7.1's HTTPS action is bounded by the service's fixed 15 s invocation deadline, which a >20,000-file `cg index`
# cannot meet (measured ~131 s). This is a faithful port of graph/extraction.ts create() (COMMIT source, no overlay):
# it reuses the exported canonical/digest/GRAPH_TABLES/validateManifest/validateChunk and the same cg binary, and the
# probe proves byte equality (bundle digest) against the live 7.1 service on a small control commit.
EXTRACT_JS = r"""
import fs from 'node:fs/promises';import path from 'node:path';import {spawnSync} from 'node:child_process';import {DatabaseSync} from 'node:sqlite';
import {GRAPH_TABLES,canonical,digest,validateManifest,validateChunk} from './services/hyperfide/dist/graph/extraction.js';
const a=JSON.parse(process.argv[1]);
const env={PATH:process.env.PATH??'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_COUNT:'3',GIT_CONFIG_KEY_0:'maintenance.auto',GIT_CONFIG_VALUE_0:'false',
 GIT_CONFIG_KEY_1:'gc.auto',GIT_CONFIG_VALUE_1:'0',GIT_CONFIG_KEY_2:'gc.autoDetach',GIT_CONFIG_VALUE_2:'false',GIT_TERMINAL_PROMPT:'0',LC_ALL:'C.UTF-8',CG_BUSY_TIMEOUT_MS:'1000'};
const run=(exe,args,cwd)=>{const r=spawnSync(exe,args,{cwd,env:{...env,HOME:cwd},maxBuffer:64*1024*1024,timeout:900000});if(r.status!==0)throw new Error(exe+' '+args[0]+' failed: '+String(r.stderr).slice(-600));return String(r.stdout).trim();};
const work=await fs.mkdtemp(path.join(a.scratch,'extract-'));
try{
 run('git',['-c','core.hooksPath=/dev/null','clone','--local','--no-hardlinks','--no-checkout','--',a.repository,work+'/source'],a.scratch);
 const root=work+'/source';
 if(run('git',['rev-parse',a.commit+'^{commit}'],root)!==a.commit||run('git',['rev-parse',a.commit+'^{tree}'],root)!==a.tree)throw new Error('commit/tree identity differs');
 run('git',['-c','core.hooksPath=/dev/null','checkout','--detach','--force',a.commit],root);
 if(run('git',['ls-tree','-r',a.commit],root).split('\n').some(l=>l.startsWith('160000 ')))throw new Error('GRAPH_SUBMODULE_MANIFEST_REQUIRED');
 await fs.mkdir(root+'/.codegraph/objects',{recursive:true});
 const started=Date.now();run(a.cg,['index','--full','--json','--workers','1'],root);const indexMs=Date.now()-started;
 const db=new DatabaseSync(root+'/.codegraph/graph.db',{readOnly:true});const facts=[],counts={};let rowBytes=0;
 try{db.exec('BEGIN');
  for(const table of GRAPH_TABLES){
   const st=db.prepare('SELECT * FROM "'+table+'"');st.setReadBigInts(true);const rows=[];
   for(const row of st.iterate()){const n={};for(const [k,v] of Object.entries(row))n[k]=typeof v==='bigint'?v.toString():v instanceof Uint8Array?{base64:Buffer.from(v).toString('base64')}:v;
    if(table==='files'){delete n.mtime;delete n.mtime_ns;}const c=Buffer.from(canonical(n));rowBytes+=c.length+256;if(rowBytes>a.max_bytes)throw new Error('GRAPH_BUDGET_EXCEEDED');rows.push([c,n]);if(facts.length+rows.length>a.max_rows)throw new Error('GRAPH_BUDGET_EXCEEDED');}
   rows.sort((x,y)=>Buffer.compare(x[0],y[0]));counts[table]=rows.length;rows.forEach(([,row],i)=>facts.push({table,key:String(i),row}));
  }
  var health=facts.filter(f=>f.table==='extraction_health').map(f=>f.row);
  if(db.prepare('SELECT id FROM branches').all().length!==1)throw new Error('GRAPH_BRANCH_MIX');
  if(db.prepare("SELECT key FROM meta WHERE key LIKE '%pending_resolve%' AND value NOT IN ('','0')").all().length)throw new Error('GRAPH_INCOMPLETE');
  db.exec('COMMIT');}finally{db.close();}
 const failed=health.filter(h=>h.status==='failed'||h.status==='partial'||h.pending_version!==null);
 const coverage={complete:failed.length===0,failed_files:failed.length,skipped_files:health.filter(h=>h.status==='skipped').length,
  parser_versions:[...new Set(health.map(h=>String(h.extraction_version)))].sort(),limitations:['Legacy parser diagnostics and size/ignore rules are preserved','Unsupported languages and skipped files remain explicit']};
 for(const f of facts.filter(f=>f.table==='files')){
  const rel=String(f.row.path),bytes=await fs.readFile(path.join(root,rel));if(digest(bytes)!=='sha256:'+String(f.row.hash))throw new Error('GRAPH_SOURCE_CHANGED');
  if(bytes.length<=2*1024*1024){const parts=Math.max(1,Math.ceil(bytes.length/32768));for(let part=0;part<parts;part++)facts.push({table:'source_bodies',key:digest(rel).slice(7)+':'+part,row:{path:rel,content_digest:digest(bytes),part_index:part,part_count:parts,total_bytes:bytes.length,body_base64:bytes.subarray(part*32768,(part+1)*32768).toString('base64')}});}
 }
 counts.source_bodies=facts.filter(f=>f.table==='source_bodies').length;
 const configDigest=digest(canonical({configuration:a.configuration,native_config_digest:digest(Buffer.alloc(0))}));
 const sourceManifest={organisation_id:a.organisation_id,run_id:a.run_id,repository_id:a.repository_id,commit:a.commit,tree:a.tree,overlay_digest:null,overlay_name:null};
 const identity={...sourceManifest,generation:a.generation,source_kind:'COMMIT',parser_digest:digest(await fs.readFile(a.cg)),config_digest:configDigest,source_manifest_digest:digest(canonical(sourceManifest))};
 const chunks=[];let pending=[],pendingBytes=2;
 const finish=()=>{if(!pending.length)return;const body={schema_version:1,identity,index:chunks.length,rows:pending};chunks.push({...body,digest:digest(canonical(body))});pending=[];pendingBytes=2;};
 for(const fact of facts){const size=Buffer.byteLength(canonical(fact));if(size>a.chunk_bytes-4096)throw new Error('GRAPH_FACT_TOO_LARGE');if(pending.length&&pendingBytes+size>a.chunk_bytes-4096)finish();pendingBytes+=size+(pending.length?1:0);pending.push(fact);}
 finish();
 if(facts.length>a.max_rows||chunks.reduce((n,c)=>n+Buffer.byteLength(canonical(c)),0)>a.max_bytes)throw new Error('GRAPH_BUDGET_EXCEEDED');
 const body={schema_version:1,identity,complete:coverage.complete===true,counts,chunks:chunks.map(c=>({index:c.index,digest:c.digest,rows:c.rows.length,bytes:Buffer.byteLength(canonical(c))})),coverage,authority:'NONE',cache:'NON_AUTHORITATIVE'};
 const manifest=validateManifest({...body,bundle_digest:digest(canonical(body))});
 const destination=path.join(a.scratch,'bundles',manifest.bundle_digest.slice(7));await fs.mkdir(destination,{recursive:true});
 for(const c of chunks){validateChunk(c);await fs.writeFile(path.join(destination,c.index+'.json'),canonical(c),{mode:0o600});}
 await fs.writeFile(path.join(destination,'manifest.json'),canonical(manifest),{mode:0o600});
 process.stdout.write(JSON.stringify({manifest,directory:destination,index_ms:indexMs,facts:facts.length}));
}finally{await fs.rm(work,{recursive:true,force:true});}
"""


def extract_bundle(repository_root: Path, *, repository: str, commit: str, tree: str, organisation_id: str, run_id: str, repository_id: str,
                   generation: str, configuration: dict, scratch: Path, cg: Path, max_bytes: int = 134217728, max_rows: int = 1000000,
                   chunk_bytes: int = 131072) -> dict:
    """Run the 7.1-equivalent extraction for one COMMIT source; returns {manifest, directory, index_ms, facts}."""
    argument = json.dumps({"repository": repository, "commit": commit, "tree": tree, "organisation_id": organisation_id, "run_id": run_id,
                           "repository_id": repository_id, "generation": generation, "configuration": configuration, "scratch": str(scratch),
                           "cg": str(cg), "max_bytes": max_bytes, "max_rows": max_rows, "chunk_bytes": chunk_bytes})
    result = subprocess.run(["node", "--max-old-space-size=1536", "--input-type=module", "-e", EXTRACT_JS, argument], cwd=repository_root,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=1200)
    if result.returncode:
        raise RuntimeError("fixture graph extraction failed: " + result.stderr[-1500:])
    return json.loads(result.stdout)


def cleanup(root: Path) -> dict:
    root = Path(root)
    if root.exists():
        if not (root / ROOT_MARKER).is_file():
            raise RuntimeError("refusing to remove a directory this fixture did not create")
        shutil.rmtree(root)
    return {"root": str(root), "absent": not root.exists()}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=None)
    parser.add_argument("--seed", type=int, default=115)
    parser.add_argument("--modules", type=int, default=MODULES)
    parser.add_argument("--cleanup", action="store_true")
    options = parser.parse_args(argv)
    if options.cleanup:
        if not options.root:
            raise SystemExit("--cleanup requires --root")
        print(json.dumps(cleanup(Path(options.root))))
        return 0
    root = Path(options.root) if options.root else Path(tempfile.mkdtemp(prefix="hf-large-repo-")) / "fixture"
    print(json.dumps(build(root, options.seed, options.modules), sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
