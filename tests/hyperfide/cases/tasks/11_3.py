#!/usr/bin/env python3
"""Real installed-base verification and native runtime observations for 11.3."""
import copy,hashlib,importlib.util,json,os,shutil,socket,subprocess,tempfile,threading,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location("preparation_fixture",Path(__file__).with_name("11_1.py"))
prep=importlib.util.module_from_spec(spec);spec.loader.exec_module(prep)
FAILED=[]
def digest(data):return "sha256:"+hashlib.sha256(data).hexdigest()
def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()
def expect(value,message):
    if not value:raise AssertionError(message)
def check(identity,callback):
    try:callback();actual="observed"
    except Exception as error:actual=type(error).__name__+": "+str(error);FAILED.append(identity)
    print(json.dumps({"type":"assertion","id":"readiness."+identity,"expected":"observed","actual":actual}),flush=True)
def git(path,*args):
    return subprocess.run(["git","-C",str(path),*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,check=True).stdout.strip()
class Fixture:
    def __init__(self,base):
        self.base=base
        (base/"prep").mkdir();self.prep=prep.Fixture(base/"prep")
        self.workspaces=base/"workspaces";self.workspace=self.workspaces/"slot";self.repo=self.workspace/"fixture"
        self.repo.mkdir(parents=True);git(self.repo,"init","-q");git(self.repo,"config","user.name","Fixture");git(self.repo,"config","user.email","fixture@example.invalid")
        (self.repo/"source.txt").write_text("pinned\n");git(self.repo,"add","source.txt");git(self.repo,"commit","-qm","fixture")
        self.manifests=base/"manifests";self.manifests.mkdir();self.diagnostics=base/"diagnostics";self.diagnostics.mkdir()
        info={}
        for line in Path("/etc/os-release").read_text().splitlines():
            if "=" in line:
                key,value=line.split("=",1);info[key]=value.strip('"')
        p=self.prep.profile;p["os"]={"distribution":info["ID"],"version":info["VERSION_ID"],"architecture":os.uname().machine}
        # Version bindings below execute the installed Git binary and hash its real output.
        self.gitbin=str(Path(shutil.which("git")).resolve())
        version_bytes=subprocess.check_output([self.gitbin,"--version"]);version=version_bytes.decode().strip().split()[-1]
        for group in ["toolchains","native_agents","connectors","system_packages"]:
            p[group]=[{"name":"git","version":version}]
        p["package_managers"]=[{"name":"git","version":version,"locks":[self.prep.pin("package-lock.json")]}]
        p["supervisor"]={"name":"git","version":version};p["hyperfide"]={"version":version}
        p["repositories"][0]["commit"]=git(self.repo,"rev-parse","HEAD")
        self.listener=socket.socket();self.listener.bind(("127.0.0.1",0));self.listener.listen(32)
        self.listener.settimeout(.1);self.closed=False
        def accept():
            while not self.closed:
                try:
                    client,_=self.listener.accept();client.close()
                except (TimeoutError,OSError):pass
        self.thread=threading.Thread(target=accept,daemon=True);self.thread.start()
        p["network"]={"routes":["127.0.0.1:"+str(self.listener.getsockname()[1])],"registries":[]}
        p["required_capabilities"]=["execute","transfer","network"]
        self.scope={"run_id":"fixture-run","actor_id":"fixture-actor","attempt_id":None}
        self.records={"schema_version":1,"records":[{"schema_version":1,"reference_id":"secret/model-fixture",
          "credential_version":"v1","status":"AVAILABLE","expires_at":"2099-01-01T00:00:00.000Z",
          "assignment_scope":self.scope.copy(),"attachment_id":"attachment-observation-only"}]}
        self.scopefile=base/"scope.json";self.credentialfile=base/"availability.json";self.scanfile=base/"scan.json";self.bindingsfile=base/"tools.json"
        self.bindings={"bindings":[{"name":name,"version":version,"executable":self.gitbin,"argv":["--version"],"output_digest":digest(version_bytes)} for name in ["git","hyperfide"]]}
        for path,value in [(self.scopefile,self.scope),(self.credentialfile,self.records),(self.scanfile,prep.SCAN),(self.bindingsfile,self.bindings)]:
            path.write_text(json.dumps(value));path.chmod(0o600)
        node=Path(shutil.which("node")).resolve();module=ROOT/"services/hyperfide/dist/preparation/manifests.js"
        self.env=os.environ.copy();self.env.update(HF_EXECUTION_HOST_CLASS="remote",
          HF_PREPARATION_WORKSPACE_ROOT=str(self.workspaces),HF_PREPARATION_BASE_ROOT=str(self.prep.allowed),
          HF_PREPARATION_MANIFEST_ROOT=str(self.manifests),HF_READINESS_DIAGNOSTICS_ROOT=str(self.diagnostics),
          HF_READINESS_MODULE_PATH=str(module),HF_READINESS_MODULE_DIGEST=digest(module.read_bytes()),
          HF_READINESS_NODE_EXECUTABLE=str(node),HF_READINESS_NODE_DIGEST=digest(node.read_bytes()),
          HF_READINESS_SCAN_POLICY_FILE=str(self.scanfile),HF_READINESS_TOOL_BINDINGS_FILE=str(self.bindingsfile),
          HF_CREDENTIAL_AVAILABILITY_FILE=str(self.credentialfile),HF_INVOCATION_SCOPE_FILE=str(self.scopefile),
          HF_SANDBOX_BOOT_ID="boot-fixture")
        self.request={"schema_version":1,"workspace":"slot","base":"candidate","manifest":"manifest.json",
          "boot_id":"boot-fixture","profile_digest":"","preparation_digest":"","minimum_free_bytes":"1",
          "minimum_free_inodes":"1","network_timeout_milliseconds":1000}
        self.publish()
    def publish(self):
        self.manifest=self.prep.create();(self.manifests/"manifest.json").write_text(json.dumps(self.manifest))
        self.request["preparation_digest"]=self.manifest["digest"];self.request["profile_digest"]=digest(canonical(self.prep.profile))
        self.env["HF_RUNNER_PROFILE_DIGEST"]=self.request["profile_digest"];self.env["HF_RUNNER_PREPARATION_DIGEST"]=self.request["preparation_digest"]
        self.workspace_inventory()
    def workspace_inventory(self):
        for pin in [self.prep.profile["recipe"],self.prep.profile["preparation_evidence"][0],self.prep.profile["package_managers"][0]["locks"][0]]:
            target=self.workspace/pin["path"];target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(self.prep.candidate/pin["path"],target)
        row,r=self.prep.invoke(payload={"candidate_path":"slot","profile":self.prep.profile,"scan_policy":prep.SCAN},
          extra_env={"HF_PREPARATION_ALLOWED_ROOT":str(self.workspaces)})
        expect(r.returncode==0 and row.get("ok"),"workspace inventory creation failed")
        path=self.base/"workspace-manifest.json";path.write_text(json.dumps(row["result"]));path.chmod(0o600)
        self.env["HF_READINESS_WORKSPACE_MANIFEST_FILE"]=str(path);self.env["HF_RUNNER_WORKSPACE_DIGEST"]=row["result"]["digest"]
    def invoke(self):
        r=subprocess.run([str(ROOT/"build/hyperfide-native"),"--component","11.3","--action","environment.readiness"],
          input=json.dumps(self.request),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=self.env,cwd=ROOT,timeout=35)
        rows=[json.loads(line) for line in r.stdout.splitlines() if line.strip()]
        expect(len(rows)==1,"missing native response");return rows[0],r
    def ready(self):
        row,r=self.invoke();expect(r.returncode==0 and row.get("ok") and row["result"]["state"]=="READY","valid environment refused: "+json.dumps(row))
        expect(row["result"]["authority_granted"] is False,"observation granted authority")
        expect(row["result"]["network_probes"]==1,"network was not probed")
        bindings=[{"id":"fixture","commit":git(self.repo,"rev-parse","HEAD"),"tree":git(self.repo,"rev-parse","HEAD^{tree}")}]
        expect(row["result"]["source_bindings"]==bindings,"actual source tree observations missing")
        expect(row["result"]["source_state_digest"]==digest(canonical(bindings)),"source fingerprint not canonical actual tree bindings")
        expect(row["result"]["workspace_digest"]==self.env["HF_RUNNER_WORKSPACE_DIGEST"],"workspace inventory binding missing")
    def refused(self,reason=None):
        row,r=self.invoke();expect(not row.get("ok") or row.get("result",{}).get("state")=="NOT_READY","unsafe environment accepted")
        if reason:expect(row.get("result",{}).get("reason")==reason,"wrong refusal: "+json.dumps(row))
        expect(all(c not in r.stdout+r.stderr for values in prep.SCAN.values() for c in values),"canary leaked")
    def close(self):
        self.closed=True;self.listener.close();self.thread.join(timeout=1)
def main():
    with tempfile.TemporaryDirectory(prefix="hf-readiness-") as temp:
        def case(identity,fn):
            def run():
                with tempfile.TemporaryDirectory(dir=temp) as path:
                    f=Fixture(Path(path))
                    try:fn(f)
                    finally:f.close()
            check(identity,run)
        case("actual-base-source-tools-network",lambda f:f.ready())

        def absent_inventory(f):
            f.env.pop("HF_READINESS_WORKSPACE_MANIFEST_FILE");f.env.pop("HF_RUNNER_WORKSPACE_DIGEST");f.refused("WORKSPACE_INVENTORY_INVALID")
        case("workspace.inventory-mandatory",absent_inventory)
        def index_bypass(f):
            git(f.repo,"update-index","--assume-unchanged","source.txt");(f.repo/"source.txt").write_text("modified\n")
            r=subprocess.run(["git","-C",str(f.repo),"diff","--quiet","HEAD"],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            expect(r.returncode==0,"fixture did not exercise an actual Git index visibility bypass");f.refused("WORKSPACE_INVENTORY_INVALID")
        case("source.actual-index-flag-bypass",index_bypass)
        def root_config(f):
            (f.workspace/"package.json").write_text('{"name":"unexpected-ancestor-config"}');f.refused("WORKSPACE_INVENTORY_INVALID")
        case("source.ancestor-config-denied",root_config)
        def source_semantics(f):
            (f.repo/"source.txt").write_text("new source\n");git(f.repo,"commit","-qam","new");f.workspace_inventory();f.refused("SOURCE_MISMATCH")
        case("source.profile-head-disagreement",source_semantics)
        def subreaper(f):
            f.prep.profile["required_capabilities"].append("linux.subreaper");f.publish();f.ready()
        case("capability.actual-linux-subreaper",subreaper)

        def changed_base(f):
            (f.prep.candidate/".hidden").write_text("drift");f.refused("PREPARATION_MANIFEST_INVALID")
        case("base.actual-byte-drift",changed_base)
        def canary(f):
            (f.prep.candidate/"extra.bin").write_bytes(b"prefix"+prep.SECRET.encode());f.refused("PREPARATION_MANIFEST_INVALID")
        case("base.actual-canary",canary)
        case("identity.boot-mismatch",lambda f:(f.request.update(boot_id="wrong"),f.refused("RUNTIME_BINDING_MISMATCH")))
        case("identity.profile-mismatch",lambda f:(f.env.update(HF_RUNNER_PROFILE_DIGEST="sha256:"+"1"*64),f.refused("RUNTIME_BINDING_MISMATCH")))
        case("identity.preparation-mismatch",lambda f:(f.env.update(HF_RUNNER_PREPARATION_DIGEST="sha256:"+"1"*64),f.refused("RUNTIME_BINDING_MISMATCH")))
        case("source.untracked-config-denied",lambda f:((f.repo/"package.json").write_text('{"scripts":{"preinstall":"unsafe"}}'),f.refused("WORKSPACE_INVENTORY_INVALID")))
        def ignored(f,covered=False,mutate=False):
            (f.repo/".git/info/exclude").write_text("node_modules/\n")
            path=f.repo/"node_modules/pkg/index.js";path.parent.mkdir(parents=True);path.write_text("module.exports=1;\n")
            if covered:f.workspace_inventory()
            if mutate:path.write_text("module.exports=2;\n")
            if covered and not mutate:f.ready()
            else:f.refused("WORKSPACE_INVENTORY_INVALID")
        case("source.ignored-dependency-denied",ignored)
        case("source.complete-workspace-inventory",lambda f:ignored(f,True))
        case("source.covered-dependency-byte-drift",lambda f:ignored(f,True,True))
        case("source.tracked-byte-mutation",lambda f:((f.repo/"source.txt").write_text("modified"),f.refused("WORKSPACE_INVENTORY_INVALID")))
        case("source.wrong-head",lambda f:((f.repo/"source.txt").write_text("new"),git(f.repo,"commit","-qam","new"),f.refused("WORKSPACE_INVENTORY_INVALID")))
        def tools(f):
            f.bindings["bindings"][0]["output_digest"]="sha256:"+"a"*64;f.bindingsfile.write_text(json.dumps(f.bindings));f.refused("TOOLCHAIN_MISMATCH")
        case("tools.actual-output-drift",tools)
        def credential(f,key,value):
            f.records["records"][0][key]=value;f.credentialfile.write_text(json.dumps(f.records));f.refused("CREDENTIAL_UNAVAILABLE")
        for status in ["MISSING","EXPIRED","REVOKED","AUTH_BLOCKED"]:
            case("credential."+status.lower(),lambda f,status=status:credential(f,"status",status))
        case("credential.noncanonical-expiration",lambda f:credential(f,"expires_at","2099-02-30T00:00:00.000Z"))
        case("credential.expiration-past",lambda f:credential(f,"expires_at","2000-01-01T00:00:00.000Z"))
        case("credential.wrong-scope",lambda f:credential(f,"assignment_scope",{**f.scope,"actor_id":"other"}))
        case("credential.unknown-field",lambda f:credential(f,"secret_value","forbidden"))
        def duplicate(f):
            f.records["records"].append(copy.deepcopy(f.records["records"][0]));f.credentialfile.write_text(json.dumps(f.records));f.refused("CREDENTIAL_UNAVAILABLE")
        case("credential.duplicate-reference",duplicate)
        case("storage.bytes",lambda f:(f.request.update(minimum_free_bytes="9223372036854775807"),f.refused("STORAGE_CAPACITY_INSUFFICIENT")))
        case("storage.inodes",lambda f:(f.request.update(minimum_free_inodes="9223372036854775807"),f.refused("STORAGE_CAPACITY_INSUFFICIENT")))
        def network(f):
            f.listener.close();f.refused("NETWORK_UNAVAILABLE")
        case("network.actual-refusal",network)
        def capability(f):
            f.prep.profile["required_capabilities"].append("unsupported");f.publish();f.refused("CAPABILITY_UNSUPPORTED")
        case("capability.unsupported",capability)
        def os_wrong(f):
            f.prep.profile["os"]["version"]="0.0.0";f.publish();f.refused("OS_PROFILE_MISMATCH")
        case("os.actual-mismatch",os_wrong)
        case("module.wrong-content-pin",lambda f:(f.env.update(HF_READINESS_MODULE_DIGEST="sha256:"+"0"*64),f.refused("PREPARATION_MANIFEST_INVALID")))
        case("node.wrong-content-pin",lambda f:(f.env.update(HF_READINESS_NODE_DIGEST="sha256:"+"0"*64),f.refused("PREPARATION_MANIFEST_INVALID")))
        case("host.supervisory",lambda f:(f.env.update(HF_EXECUTION_HOST_CLASS="supervisory"),f.refused("READINESS_CONFIG_INVALID")))
    print(json.dumps({"type":"cleanup","status":"complete"}),flush=True)
    return bool(FAILED)
if __name__=="__main__":raise SystemExit(main())
