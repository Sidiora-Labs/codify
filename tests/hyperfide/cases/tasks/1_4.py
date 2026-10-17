#!/usr/bin/env python3
"""Task 1.4 component qualification: actual service, linker and authoring boundaries."""
from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import time
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[4]
IDS = [
    "foundation.service.control", "foundation.service.provisioner", "foundation.service.dispatch",
    "foundation.policy.inactive", "foundation.policy.unapproved", "foundation.policy.stale-spec",
    "foundation.policy.stale-policy", "foundation.policy.missing", "foundation.policy.role-denied",
    "foundation.policy.boot-action-denied", "foundation.policy.request-cannot-approve",
    "foundation.policy.request-action-denied", "foundation.policy.authorize",
    "foundation.registry.duplicate-id", "foundation.registry.duplicate-action",
    "foundation.registry.unknown-schema", "foundation.registry.unknown-api",
    "foundation.registry.missing-module", "foundation.registry.escaping-module",
    "foundation.registry.symlink-module", "foundation.registry.missing-export",
    "foundation.registry.missing-dependency", "foundation.registry.cycle",
    "foundation.registry.role-dependency", "foundation.registry.returned-action-mismatch",
    "foundation.registry.factory-failure", "foundation.registry.import-failure",
    "foundation.registry.validate-before-import", "foundation.registry.reverse-close", "foundation.registry.sigterm-pending-factory",
    "foundation.registry.sigterm-pending-import",
    "foundation.request.unknown-component", "foundation.request.unknown-action",
    "foundation.request.malformed", "foundation.request.failed-handler",
    "foundation.request.stable-result-snapshot",
    "foundation.native.linked-dispatch", "foundation.native.unknown-component",
    "foundation.native.unknown-action", "foundation.native.invalid-input",
    "foundation.native.duplicate-id", "foundation.native.schema",
    "foundation.native.missing-source", "foundation.native.escaping-source",
    "foundation.native.missing-symbol", "foundation.native.boolean-schema", "foundation.native.make-injection",
    "foundation.build.pinned", "foundation.authoring.approved-validation",
    "foundation.authoring.preserve-state", "foundation.authoring.check-no-write",
    "foundation.authoring.structure-mismatch", "foundation.authoring.unknown-task",
    "foundation.authoring.draft-refusal",
    "foundation.authoring.workflow-missing", "foundation.authoring.workflow-duplicate",
    "foundation.authoring.workflow-stale", "foundation.authoring.preamble-duplicate",
    "foundation.authoring.verification-scope", "foundation.authoring.draft-control",
    "foundation.authoring.historical-receipts", "foundation.harness.canonical-source-order",
]
FAILED = []


def run(argv, *, cwd=ROOT, text="", timeout=40):
    result = subprocess.run([str(x) for x in argv], cwd=cwd, input=text, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout,
                            env=dict(os.environ, HYPERFIDE_REQUIRE_SYNC_REPLICA="0"))
    return result


def expect(condition, detail):
    if not condition:
        raise AssertionError(detail)


def check(identity, callback):
    try:
        callback()
        actual = "observed"
    except Exception as error:
        actual = f"{type(error).__name__}: {error}"
        FAILED.append(identity)
    print(json.dumps({"type": "assertion", "id": identity, "expected": "observed", "actual": actual}), flush=True)


def response(result):
    rows = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    expect(len(rows) == 1, f"expected one JSONL response, got {result.stdout!r}; stderr={result.stderr!r}")
    return rows[0]


def error_code(result):
    lines = [line for line in (result.stdout + "\n" + result.stderr).splitlines() if line.strip()]
    for line in reversed(lines):
        try:
            payload = json.loads(line)
            if isinstance(payload, dict) and payload.get("ok") is False:
                return payload["error"]["code"]
        except (ValueError, KeyError, TypeError):
            pass
    raise AssertionError(f"missing structured failure: {result.returncode} {result.stdout!r} {result.stderr!r}")


BASE_POLICY = {
    "schema_version": 1, "programme_id": "fixture-run", "repository": "fixture/repository",
    "spec_revision": "fixture-revision", "policy_revision": 1, "status": "ACTIVE",
    "approval": {"decision": "APPROVED", "record_id": "fixture-operator-approval",
                 "spec_revision": "fixture-revision", "policy_revision": 1},
    "allowed_roles": ["control", "provisioner", "dispatch"],
    "allowed_actions": ["programme.activate", "programme.provision", "programme.dispatch",
                        "programme.authorize", "fixture.echo", "fixture.other"],
}


class ServiceFixture:
    def __init__(self, directory):
        self.path = directory
        self.modules = directory / "modules"
        self.components = directory / "components"
        self.modules.mkdir()
        self.components.mkdir()
        self.events = directory / "events.jsonl"
        self.policy_file = directory / "policy.json"
        (self.modules / "package.json").write_text('{"type":"module"}\n')
        self.policy = copy.deepcopy(BASE_POLICY)
        self.fixture()

    def module(self, name, content):
        (self.modules / name).write_text(content)

    def fixture(self, ident="fixture", *, roles=None, requires=None, action="fixture.echo",
                name=None, tail="", factory=None):
        name = name or ident + ".js"
        self.module(name, f"""import fs from 'node:fs';
const log = kind => fs.appendFileSync({json.dumps(str(self.events))}, JSON.stringify({{kind,id:{json.dumps(ident)}}})+'\\n');
log('import');
export function createComponent(ctx) {{
  log('factory');
  {factory or ''}
  return {{apiVersion:1,actions:{{{json.dumps(action)}:async (input,context)=>{{
    log('action'); {tail}
    return {{received:input,role:context.role,component:{json.dumps(ident)}}};
  }}}},close:async()=>{{log('close');}}}};
}}
""")
        fragment = {"schema_version": 1, "id": ident, "task": "1.4",
                    "roles": roles or ["control", "provisioner", "dispatch"],
                    "module": name, "entry": "createComponent", "api_version": 1,
                    "actions": [action], "requires": requires or []}
        self.fragment(ident + ".json", fragment)
        return fragment

    def fragment(self, name, value):
        (self.components / name).write_text(json.dumps(value) + "\n")

    def event_rows(self):
        return [json.loads(line) for line in self.events.read_text().splitlines()] if self.events.exists() else []

    def invoke(self, *, role="control", request=None, raw=None, revision="fixture-revision", policy=True):
        if policy:
            self.policy_file.write_text(json.dumps(self.policy))
        elif self.policy_file.exists():
            self.policy_file.unlink()
        argv = ["node", ROOT / f"services/hyperfide/dist/{role}.js",
                "--policy", self.policy_file, "--spec-revision", revision,
                "--components", self.components, "--module-root", self.modules]
        request = request or {"id": "fixture-1", "component": "fixture", "action": "fixture.echo", "input": {"x": 7}}
        return run(argv, text=raw if raw is not None else json.dumps(request) + "\n")


def service_case(base, callback):
    with tempfile.TemporaryDirectory(prefix="service-", dir=base) as directory:
        callback(ServiceFixture(Path(directory)))


def policy_reject(base, mutation, code, *, missing=False):
    def case(fixture):
        mutation(fixture.policy)
        result = fixture.invoke(policy=not missing)
        expect(result.returncode != 0 and error_code(result) == code, f"refusal mismatch: {result}")
        expect(not fixture.event_rows(), "module imported or factory executed before policy admission")
    service_case(base, case)


def registry_reject(base, mutation, *, before_import=True):
    def case(fixture):
        mutation(fixture)
        result = fixture.invoke()
        expect(result.returncode != 0 and error_code(result) in {"REGISTRY_INVALID", "COMPONENT_LOAD_FAILED"},
               f"registry refusal mismatch: {result}")
        if before_import:
            expect(not fixture.event_rows(), "module imported before complete registry validation")
    service_case(base, case)


def mutate_fragment(fixture, mutation):
    path = fixture.components / "fixture.json"
    value = json.loads(path.read_text())
    mutation(value)
    fixture.fragment("fixture.json", value)


def native_fixture(base):
    directory = base / "native"
    (directory / "src/hyperfide/components").mkdir(parents=True)
    (directory / "scripts").mkdir()
    for relative in ["Makefile", "scripts/hyperfide-native-components.py",
                     "src/hyperfide/components.h", "src/hyperfide/component_main.c",
                     "src/sha256.c", "src/cg.h", "src/semantic.h",
                     "src/hyperfide/components/schema.kvx"]:
        destination = directory / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / relative, destination)
    (directory / "src/hyperfide/fixture.c").write_text(
        '#include "components.h"\n'
        'int hf_component_99_1(const char *action,const char *request_json,FILE *output) {\n'
        '(void)action; (void)request_json; fputs("{\\"executed\\":true,\\"component\\":\\"99.1\\"}",output); return 0;\n}\n')
    fragment = '[component]\nschema_version = 1\nid = "99.1"\nsource = "src/hyperfide/fixture.c"\nentry = "hf_component_99_1"\nactions = ["fixture.echo"]\n'
    (directory / "src/hyperfide/components/99.1.kvx").write_text(fragment)
    return directory, fragment


def native_exec(directory, component="99.1", action="fixture.echo", text="{}\n"):
    return run([directory / "build/hyperfide-native", "--component", component, "--action", action], cwd=directory, text=text)


def authoring_fixture(base):
    repository = base / "authoring"
    pack = repository / "spec/hyperfide"
    shutil.copytree(ROOT / "spec/hyperfide", pack, ignore=shutil.ignore_patterns("private", "__pycache__"))
    shutil.copyfile(ROOT / "spec/workflow.kvx", repository / "spec/workflow.kvx")
    # Relative baseline links may refer to real repository sources, but fixture mutation stays in its own pack.
    for child in ROOT.iterdir():
        if child.name not in {"spec", ".git", "artifacts", "node_modules"}:
            (repository / child.name).symlink_to(child, target_is_directory=child.is_dir())
    return pack


def authoring_command(pack, tool, *args):
    return run([sys.executable, ROOT / f"spec/hyperfide/tools/{tool}.py",
                "--mode", "implementation", "--root", pack, *args], timeout=80)


def main():
    with tempfile.TemporaryDirectory(prefix="hyperfide-1-4-") as temporary:
        base = Path(temporary)
        for role in ["control", "provisioner", "dispatch"]:
            def role_test(role=role):
                def case(f):
                    result = f.invoke(role=role)
                    payload = response(result)
                    expect(result.returncode == 0 and payload == {"id": "fixture-1", "ok": True,
                           "result": {"received": {"x": 7}, "role": role, "component": "fixture"}}, f"linked result mismatch {result}")
                    expect([e["kind"] for e in f.event_rows()] == ["import", "factory", "action", "close"],
                           "import/factory/action/close did not actually execute")
                service_case(base, case)
            check("foundation.service." + role, role_test)
        policy_tests = [
            ("inactive", lambda p: p.update(status="INACTIVE"), "PROGRAMME_INACTIVE"),
            ("unapproved", lambda p: p["approval"].update(decision="REJECTED"), "APPROVAL_REQUIRED"),
            ("stale-spec", lambda p: p["approval"].update(spec_revision="old"), "REVISION_MISMATCH"),
            ("stale-policy", lambda p: p["approval"].update(policy_revision=2), "REVISION_MISMATCH"),
            ("missing", lambda p: None, "POLICY_INVALID"),
            ("role-denied", lambda p: p.update(allowed_roles=["dispatch"]), "ROLE_DENIED"),
            ("boot-action-denied", lambda p: p.update(allowed_actions=["fixture.echo"]), "ACTION_DENIED"),
        ]
        for name, mutation, code in policy_tests:
            check("foundation.policy." + name, lambda m=mutation,c=code,n=name: policy_reject(base,m,c,missing=n=="missing"))
        def cannot_approve():
            def case(f):
                f.policy["approval"]["decision"] = "REJECTED"
                result = f.invoke(request={"id":"x","component":"fixture","action":"fixture.echo",
                                           "input":{"approved":True,"approval":{"decision":"APPROVED"}}})
                expect(result.returncode != 0 and not f.event_rows(), "request supplied approval activated a refused programme")
            service_case(base,case)
        check("foundation.policy.request-cannot-approve", cannot_approve)
        def denied_request():
            def case(f):
                f.policy["allowed_actions"].remove("fixture.echo")
                result=f.invoke()
                expect(result.returncode != 0 and error_code(result)=="ACTION_DENIED",f"action allowed: {result}")
                expect(not any(e["kind"]=="action" for e in f.event_rows()),"denied action executed")
            service_case(base,case)
        check("foundation.policy.request-action-denied",denied_request)
        def authorize():
            policy = base / "real-policy.json"
            policy.write_text(json.dumps(BASE_POLICY))
            components=base/"policy-components";components.mkdir()
            shutil.copyfile(ROOT/"services/hyperfide/components/1.4.json",components/"1.4.json")
            result=run(["node",ROOT/"services/hyperfide/dist/control.js","--policy",policy,
                        "--components",components,"--module-root",ROOT/"services/hyperfide/dist",
                        "--spec-revision","fixture-revision"],text=json.dumps({"id":"auth","component":"1.4",
                        "action":"programme.authorize","input":{"action":"fixture.echo","spec_revision":"fixture-revision","policy_revision":1}})+"\n")
            expect(result.returncode==0 and response(result)["ok"] is True,f"real policy component failed: {result}")
        check("foundation.policy.authorize", authorize)
        mutations = [
            ("duplicate-id",lambda f:f.fragment("duplicate.json",json.loads((f.components/"fixture.json").read_text()))),
            ("duplicate-action",lambda f:f.fixture("other")),
            ("unknown-schema",lambda f:mutate_fragment(f,lambda v:v.update(schema_version=9))),
            ("unknown-api",lambda f:mutate_fragment(f,lambda v:v.update(api_version=9))),
            ("missing-module",lambda f:mutate_fragment(f,lambda v:v.update(module="absent.js"))),
            ("escaping-module",lambda f:mutate_fragment(f,lambda v:v.update(module="../outside.js"))),
            ("symlink-module",lambda f:((f.path/"outside.js").write_text("throw new Error('escaped');"),(f.modules/"escape.js").symlink_to(f.path/"outside.js"),mutate_fragment(f,lambda v:v.update(module="escape.js")))),
            ("missing-export",lambda f:mutate_fragment(f,lambda v:v.update(entry="absent"))),
            ("missing-dependency",lambda f:mutate_fragment(f,lambda v:v.update(requires=["absent"]))),
            ("cycle",lambda f:(mutate_fragment(f,lambda v:v.update(requires=["other"])),f.fixture("other",requires=["fixture"],action="fixture.other"))),
            ("role-dependency",lambda f:(mutate_fragment(f,lambda v:v.update(requires=["other"])),f.fixture("other",roles=["dispatch"],action="fixture.other"))),
            ("returned-action-mismatch",lambda f:f.module("fixture.js","export function createComponent(){return {apiVersion:1,actions:{'undeclared.action':()=>true}};}")),
            ("factory-failure",lambda f:f.fixture(factory="throw new Error('factory fault');")),
            ("import-failure",lambda f:f.module("fixture.js","throw new Error('import fault');")),
            ("validate-before-import",lambda f:f.fragment("z-invalid.json",{"schema_version":99,"id":"late"})),
        ]
        for name, mutation in mutations:
            check("foundation.registry."+name,lambda m=mutation,n=name:registry_reject(base,m,before_import=n not in {"missing-export","returned-action-mismatch","factory-failure","import-failure"}))
        def reverse_close():
            def case(f):
                mutate_fragment(f,lambda v:v.update(requires=["dep"]))
                f.fixture("dep",action="fixture.other")
                result=f.invoke()
                closes=[e["id"] for e in f.event_rows() if e["kind"]=="close"]
                expect(result.returncode==0 and closes==["fixture","dep"],f"close order {closes}: {result}")
            service_case(base,case)
        check("foundation.registry.reverse-close",reverse_close)
        def pending_factory():
            def case(f):
                marker=f.path/"factory-resource"
                f.module("fixture.js",f"""import fs from 'node:fs';
const log=k=>fs.appendFileSync({json.dumps(str(f.events))},JSON.stringify({{kind:k,id:'fixture'}})+'\\n');
export async function createComponent(ctx){{
 log('factory-pending');
 await new Promise(r=>setTimeout(r,500));
 fs.writeFileSync({json.dumps(str(marker))},'owned');
 const timer=setInterval(()=>{{}},1000);
 log('resource-open');
 return {{apiVersion:1,actions:{{'fixture.echo':()=>true}},close:async()=>{{
   clearInterval(timer);fs.unlinkSync({json.dumps(str(marker))});log('close');
 }}}};
}}
""")
                f.policy_file.write_text(json.dumps(f.policy))
                argv=["node",ROOT/"services/hyperfide/dist/control.js","--policy",f.policy_file,
                      "--spec-revision","fixture-revision","--components",f.components,"--module-root",f.modules]
                child=subprocess.Popen([str(x) for x in argv],cwd=ROOT,stdin=subprocess.PIPE,
                                       stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
                try:
                    deadline=time.monotonic()+5
                    while not any(e["kind"]=="factory-pending" for e in f.event_rows()):
                        expect(child.poll() is None,"service exited before factory started")
                        expect(time.monotonic()<deadline,"factory did not start")
                        time.sleep(.01)
                    started=time.monotonic()
                    child.send_signal(signal.SIGTERM)
                    stdout,stderr=child.communicate(timeout=8)
                    expect(time.monotonic()-started<6,"SIGTERM cleanup exceeded bounded interval")
                    events=[e["kind"] for e in f.event_rows()]
                    expect("resource-open" in events and "close" in events and not marker.exists(),
                           f"late factory resource not disposed: {events}, stderr={stderr!r}")
                finally:
                    if child.poll() is None:
                        child.kill(); child.communicate()
            service_case(base,case)
        check("foundation.registry.sigterm-pending-factory",pending_factory)
        def pending_import():
            def case(f):
                f.module("fixture.js",f"""import fs from 'node:fs';
const log=k=>fs.appendFileSync({json.dumps(str(f.events))},JSON.stringify({{kind:k,id:'fixture'}})+'\\n');
log('import-pending');
await new Promise(r=>setTimeout(r,500));
log('import-complete');
export function createComponent(ctx){{log('factory');return {{apiVersion:1,actions:{{'fixture.echo':()=>true}}}};}}
""")
                f.policy_file.write_text(json.dumps(f.policy))
                argv=["node",ROOT/"services/hyperfide/dist/control.js","--policy",f.policy_file,
                      "--spec-revision","fixture-revision","--components",f.components,"--module-root",f.modules]
                child=subprocess.Popen([str(x) for x in argv],cwd=ROOT,stdin=subprocess.PIPE,
                                       stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
                try:
                    deadline=time.monotonic()+5
                    while not any(e["kind"]=="import-pending" for e in f.event_rows()):
                        expect(child.poll() is None,"service exited before import started")
                        expect(time.monotonic()<deadline,"import did not start")
                        time.sleep(.01)
                    started=time.monotonic()
                    child.send_signal(signal.SIGTERM)
                    stdout,stderr=child.communicate(timeout=8)
                    expect(time.monotonic()-started<6,"SIGTERM import cleanup exceeded bounded interval")
                    events=[e["kind"] for e in f.event_rows()]
                    expect("import-complete" in events and "factory" not in events,
                           f"factory ran after abort during import: {events}, stderr={stderr!r}")
                finally:
                    if child.poll() is None:
                        child.kill(); child.communicate()
            service_case(base,case)
        check("foundation.registry.sigterm-pending-import",pending_import)
        requests=[
            ("unknown-component",{"id":"bad","component":"absent","action":"fixture.echo","input":{}},"UNKNOWN_COMPONENT"),
            ("unknown-action",{"id":"bad","component":"fixture","action":"fixture.other","input":{}},"UNKNOWN_ACTION"),
            ("malformed",None,"INVALID_REQUEST"),
            ("failed-handler",None,"HANDLER_FAILED"),
        ]
        for name,request,code in requests:
            def request_test(n=name,q=request,c=code):
                def case(f):
                    if n=="failed-handler":
                        f.fixture(tail="throw new Error('handler fault');")
                    result=f.invoke(request=q,raw="not-json\n" if n=="malformed" else None)
                    expect(result.returncode!=0 and error_code(result)==c,f"request refusal mismatch: {result}")
                service_case(base,case)
            check("foundation.request."+name,request_test)
        def stable_result_snapshot():
            def case(f):
                f.module("fixture.js","""export function createComponent(ctx) {
 return {apiVersion:1,actions:{'fixture.echo':()=>{
   let encodings=0;
   return {toJSON(){return ++encodings===1?{validated:true}:undefined;}};
 }}};
}
""")
                result=f.invoke()
                expect(result.returncode==0 and response(result)=={"id":"fixture-1","ok":True,"result":{"validated":True}},
                       f"transport changed or omitted the validated result snapshot: {result}")
            service_case(base,case)
        check("foundation.request.stable-result-snapshot",stable_result_snapshot)
        native=None
        def linked():
            nonlocal native
            native, fragment=native_fixture(base)
            checked=run([sys.executable,native/"scripts/hyperfide-native-components.py","--root",native,"--check"],cwd=native)
            expect(checked.returncode==0,f"positive native helper unavailable: {checked}")
            result=run(["make","hyperfide-native"],cwd=native,timeout=80)
            expect(result.returncode==0,f"native build failed: {result.stdout} {result.stderr}")
            output=native_exec(native)
            expect(output.returncode==0 and response(output)=={"ok":True,"result":{"executed":True,"component":"99.1"}},f"actual linked call failed: {output}")
        check("foundation.native.linked-dispatch",linked)
        def native_negative(component,action,text,code=None):
            expect(native is not None and (native/"build/hyperfide-native").is_file(),"positive native build unavailable")
            result=native_exec(native,component,action,text)
            expect(result.returncode!=0 and response(result)["ok"] is False,f"native accepted invalid request: {result}")
        check("foundation.native.unknown-component",lambda:native_negative("absent","fixture.echo","{}\n"))
        check("foundation.native.unknown-action",lambda:native_negative("99.1","absent.action","{}\n"))
        check("foundation.native.invalid-input",lambda:native_negative("99.1","fixture.echo","[]\n"))
        for name in ["duplicate-id","schema","missing-source","escaping-source","missing-symbol","boolean-schema","make-injection"]:
            def native_fragment_test(name=name):
                expect(native is not None and (native/"build/hyperfide-native").is_file(),"positive native build unavailable")
                with tempfile.TemporaryDirectory(prefix="native-negative-",dir=base) as tmp:
                    isolated=Path(tmp)/"repo"
                    shutil.copytree(native,isolated,ignore=shutil.ignore_patterns("build"))
                    path=isolated/"src/hyperfide/components/99.1.kvx"
                    content=path.read_text()
                    if name=="duplicate-id":
                        (path.parent/"duplicate.kvx").write_text(content)
                    elif name=="schema":
                        path.write_text(content.replace("schema_version = 1","schema_version = 9"))
                    elif name=="missing-source":
                        path.write_text(content.replace("fixture.c","absent.c"))
                    elif name=="escaping-source":
                        path.write_text(content.replace("src/hyperfide/fixture.c","../escape.c"))
                    elif name=="boolean-schema":
                        path.write_text(content.replace("schema_version = 1","schema_version = true"))
                    elif name=="make-injection":
                        path.write_text(content.replace("src/hyperfide/fixture.c","src/hyperfide/$(touch injected).c"))
                    else:
                        path.write_text(content.replace("hf_component_99_1","hf_component_missing"))
                    result=run(["make","hyperfide-native"],cwd=isolated,timeout=80)
                    expect(result.returncode!=0,f"invalid native fragment/link unexpectedly built: {name}")
                    expect(not (isolated/"injected").exists(),"native source path executed make substitution")
                    if name != "missing-symbol":
                        checked=run([sys.executable,isolated/"scripts/hyperfide-native-components.py","--root",isolated,"--check"],cwd=isolated)
                        expect(checked.returncode!=0,
                               f"native helper failed to diagnose {name}: {checked}")
            check("foundation.native."+name,native_fragment_test)
        def pinned_build():
            package=json.loads((ROOT/"services/hyperfide/package.json").read_text())
            lock=json.loads((ROOT/"services/hyperfide/package-lock.json").read_text())
            expect(package["engines"]["node"] in {"24.22.0","=24.22.0"},f"Node version not exact: {package['engines']}")
            expect(lock.get("lockfileVersion")==3 and bool(lock.get("packages")),"lockfile not complete")
            node=run(["node","--version"])
            npm=run(["npm","--version"])
            expect(node.returncode==0 and node.stdout.strip()=="v24.22.0","observed Node differs from pinned build input")
            expect(npm.returncode==0 and "npm@"+npm.stdout.strip()==package["packageManager"],"observed npm differs from pinned package manager")
            for command in [["npm","run","build"],["npm","run","check"]]:
                result=run(command,cwd=ROOT/"services/hyperfide",timeout=100)
                expect(result.returncode==0,f"pinned service build failed: {result.stderr}")
            result=run(["make","hyperfide-native"],timeout=80)
            expect(result.returncode==0,f"production native build failed: {result.stderr}")
        check("foundation.build.pinned",pinned_build)
        pack=authoring_fixture(base)
        historical={str(p.relative_to(pack)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (pack/"evidence").rglob("*") if p.is_file()}
        def validate_approved():
            report=base/"approved-report.json"
            result=authoring_command(pack,"validate_pack","--output",report)
            expect(result.returncode==0,f"approved validation failed: {result.stdout} {result.stderr}")
            expect(json.loads(report.read_text())["runtime_acceptance_status"]=="UNRUN","authoring report promoted runtime status")
        check("foundation.authoring.approved-validation",validate_approved)
        def preserve():
            text=(pack/"spec.kvx").read_text()
            text=re.sub(r"(\[task\.4\.1\][\s\S]*?\nstatus = )\"[^\"]+\"",r'\1"in_progress"',text,count=1)
            text=re.sub(r"(\[task\.8\.1\][\s\S]*?\nstatus = )\"[^\"]+\"",r'\1"done"',text,count=1)
            (pack/"spec.kvx").write_text(text)
            before=text.split("# BEGIN GENERATED DRAFT TASKS AND CASES")[0]
            result=authoring_command(pack,"render_native")
            after=(pack/"spec.kvx").read_text()
            expect(result.returncode==0,f"render failed: {result.stderr}")
            expect(after.split("# BEGIN GENERATED DRAFT TASKS AND CASES")[0]==before,"approved header bytes changed")
            for task_id,status in [("4.1","in_progress"),("8.1","done")]:
                block=re.search(r"(?ms)^\[task\."+re.escape(task_id)+r"\]\n(.*?)(?=^\[|\Z)",after)
                expect(block is not None and f'status = "{status}"' in block.group(1),"render erased exact task progress")
            expected_cases=set(re.findall(r'^\|\s*(V-\d{3})\s*\|', (pack/"verification.md").read_text(), re.M))
            acceptance=dict(re.findall(r'(?ms)^\[acceptance\.(V-\d{3})\]\n(.*?)(?=^\[|\Z)', after))
            expect(set(acceptance)==expected_cases and all('qualification = "UNRUN"' in block and
                   'qualification = "PASS"' not in block for block in acceptance.values()),"component progress promoted full cases")
        check("foundation.authoring.preserve-state",preserve)
        def check_no_write():
            path=pack/"spec.kvx"
            before=path.read_bytes()
            result=authoring_command(pack,"render_native","--check")
            expect(result.returncode==0 and path.read_bytes()==before,f"--check changed or rejected canonical state: {result.stderr}")
        check("foundation.authoring.check-no-write",check_no_write)
        def structural_reject(unknown=False):
            path=pack/"spec.kvx"; before=path.read_text()
            edited=before.replace("[task.8.1]","[task.999.1]",1) if unknown else before.replace('title = "Define capability-aware provider interface and unsupported outcomes"','title = "Unapproved structural mutation"',1)
            path.write_text(edited)
            result=authoring_command(pack,"render_native")
            expect(result.returncode!=0 and path.read_text()==edited,"renderer silently erased mismatched live state")
            path.write_text(before)
        check("foundation.authoring.structure-mismatch",structural_reject)
        check("foundation.authoring.unknown-task",lambda:structural_reject(True))
        def draft_refusal():
            result=run([sys.executable,ROOT/"spec/hyperfide/tools/validate_pack.py","--mode","draft","--root",pack,"--output",base/"draft-report.json"],timeout=80)
            report=base/"draft-report.json"
            expect(result.returncode!=0 and report.is_file(),"draft mode did not produce semantic refusal report")
            payload=json.loads(report.read_text())
            expect(payload["status"]=="FAIL" and bool(payload["errors"]),"draft mode accepted active implementation state")
        check("foundation.authoring.draft-refusal",draft_refusal)
        def workflow_refusal(kind):
            workflow=pack.parent/"workflow.kvx"
            original=workflow.read_bytes()
            native_before=(pack/"spec.kvx").read_bytes()
            try:
                if kind=="missing":
                    workflow.unlink()
                elif kind=="duplicate":
                    workflow.write_bytes(original+b'\n[meta]\nactive_feature = "hyperfide"\n')
                else:
                    text=original.decode()
                    text=re.sub(r'(?m)^active_feature\s*=\s*"[^"]+"','active_feature = "codify-v16"',text)
                    expect(text!=original.decode(),"stale-workflow fixture did not mutate authority")
                    workflow.write_text(text)
                report=base/("workflow-"+kind+"-report.json")
                result=authoring_command(pack,"validate_pack","--output",report)
                expect(result.returncode!=0 and report.exists() and json.loads(report.read_text())["status"]=="FAIL",
                       f"validator admitted {kind} workflow")
                rendered=authoring_command(pack,"render_native")
                expect(rendered.returncode!=0 and (pack/"spec.kvx").read_bytes()==native_before,
                       f"renderer admitted or mutated {kind} workflow")
            finally:
                workflow.write_bytes(original)
        for kind in ["missing","duplicate","stale"]:
            check("foundation.authoring.workflow-"+kind,lambda k=kind:workflow_refusal(k))
        def extra_structural_refusal(kind):
            path=pack/"spec.kvx"; original=path.read_text()
            if kind=="preamble":
                marker="# BEGIN GENERATED DRAFT TASKS AND CASES"
                expect(marker in original,"generated boundary missing")
                altered=original.replace(marker,'[task.4.1]\nstatus = "pending"\n\n'+marker,1)
            else:
                altered=original.replace('verification_scope = "Registered task-component variant only;',
                                         'verification_scope = "Unapproved scope mutation;',1)
                expect(altered!=original,"verification_scope fixture did not mutate native input")
            try:
                path.write_text(altered)
                result=authoring_command(pack,"render_native")
                expect(result.returncode!=0 and path.read_text()==altered,"renderer erased or admitted invalid live structure")
            finally:
                path.write_text(original)
        check("foundation.authoring.preamble-duplicate",lambda:extra_structural_refusal("preamble"))
        check("foundation.authoring.verification-scope",lambda:extra_structural_refusal("scope"))
        def draft_control():
            draft=authoring_fixture(base/"draft-control")
            path=draft/"spec.kvx"
            text=path.read_text()
            text=re.sub(r'(?m)^status = "[^\"]+"', 'status = "draft"', text, count=1)
            text=text.replace('implementation_authorized = true', 'implementation_authorized = false', 1)
            text=re.sub(r'(?m)^state = "[^\"]+"', 'state = "not_started"', text, count=1)
            text=re.sub(r'(?m)^approval_record = .*\n', '', text, count=1)
            text=re.sub(r'(?ms)(^\[task\.[^\]]+\]\n.*?)^status = "[^\"]+"', r'\1status = "pending"', text)
            text=re.sub(r'(?m)^qualification = "[^\"]+"', 'qualification = "UNRUN"', text)
            path.write_text(text)
            workflow=draft.parent/"workflow.kvx"
            workflow.write_text(re.sub(r'(?m)^active_feature\s*= .*', 'active_feature = "codify-v16"', workflow.read_text()))
            report=base/"draft-control-report.json"
            validation=run([sys.executable,ROOT/"spec/hyperfide/tools/validate_pack.py","--mode","draft",
                            "--root",draft,"--output",report],timeout=80)
            expect(validation.returncode==0 and json.loads(report.read_text())["status"]=="PASS",
                   f"valid draft rejected: {validation.stdout} {validation.stderr}")
            rendered=run([sys.executable,ROOT/"spec/hyperfide/tools/render_native.py","--mode","draft",
                          "--root",draft],timeout=80)
            expect(rendered.returncode==0,f"valid draft rendering rejected: {rendered.stderr}")
            expect('[task.1.4]' in (draft/"spec.kvx").read_text(),"draft render omitted real planning tasks")
        check("foundation.authoring.draft-control",draft_control)
        def history():
            current={str(p.relative_to(pack)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (pack/"evidence").rglob("*") if p.is_file()}
            expect(current==historical,"render/validation rewrote historical receipts")
            catalog=json.loads((pack/"evidence/task-catalog.json").read_text())
            expect(all(t["status"]=="pending" for t in catalog["tasks"]),"live state rewrote immutable planning catalog")
        check("foundation.authoring.historical-receipts",history)
        def canonical_source_order():
            directory=base/"inventory-order"
            (directory/"impl/components").mkdir(parents=True)
            (directory/"registrations").mkdir()
            (directory/"impl/components.h").write_text("header fixture\n")
            (directory/"impl/components/schema.kvx").write_text("schema fixture\n")
            child_probe=directory/"probe.py"
            child_probe.write_text("import json\nprint(json.dumps({'type':'assertion','id':'inventory.order','expected':7,'actual':7}))\nprint(json.dumps({'type':'cleanup','resources':[],'complete':True}))\n")
            registration={"schema_version":1,"variant":"task:99.1","task":"99.1",
                          "scope":"task-component","cases":["V-001"],"assertion_ids":["inventory.order"],
                          "argv":[sys.executable,"probe.py"],"timeout_seconds":10,
                          "required_env":[],"fixtures":[],"resources":[],
                          "source_files":["probe.py","impl/components.h","impl/components/schema.kvx"],
                          "source_roots":["impl"]}
            registry={"schema_version":1,"cases":{"V-001":{"title":"Controlled source-order fixture","full_assertion_ids":[]}},
                      "suites":{"contract":["V-001"]},"registration_glob":"registrations/*.json"}
            pins=[]
            for relative in registration["source_files"]:
                data=(directory/relative).read_bytes()
                pins.append({"path":relative,"sha256":hashlib.sha256(data).hexdigest(),"size":len(data)})
            manifest={"schema_version":1,"campaign_id":"controlled-source-order","registered_variant":"task:99.1",
                      "scope":"task-component","case_ids":["V-001"],"expected_assertion_ids":["inventory.order"],
                      "approval":{"approved":True,"allowed_actions":[]},"inputs":pins,"resources":[],
                      "seed":1,"policy":{}}
            for relative,value in [("registry.json",registry),("registrations/99.1.json",registration),("manifest.json",manifest)]:
                (directory/relative).write_text(json.dumps(value)+"\n")
            campaign=directory/"campaign"
            result=run([sys.executable,ROOT/"tests/hyperfide/qualify.py","--root",directory,
                        "--registry",directory/"registry.json","--manifest",directory/"manifest.json",
                        "--output-dir",campaign,"--case","V-001"],cwd=directory,timeout=40)
            payload=response(result)
            expect(result.returncode==0 and payload["status"]=="PASS",f"real runner/checker disagreed on source ordering: {result}")
            receipt_path=Path(payload["campaign_dir"])/"receipts"/(payload["receipt_id"]+".json")
            receipt=json.loads(receipt_path.read_text())
            ordered=[str(Path(row["original_path"]).relative_to(directory)) for row in receipt["source"]["inventory"]]
            expect(ordered==["impl/components.h","impl/components/schema.kvx"],f"source inventory not lexical strings: {ordered}")
            (directory/"impl/components.h").write_text("mutated header fixture\n")
            rejected=run([sys.executable,ROOT/"tests/hyperfide/check-evidence.py","--campaign",
                          payload["campaign_dir"],"--receipt",payload["receipt_id"]],cwd=directory,timeout=30)
            expect(rejected.returncode!=0,"canonical ordering repair weakened source-content tamper refusal")
        check("foundation.harness.canonical-source-order",canonical_source_order)
    print(json.dumps({"type":"cleanup","resources":[],"complete":True}),flush=True)
    return 1 if FAILED else 0


if __name__=="__main__":
    sys.exit(main())
