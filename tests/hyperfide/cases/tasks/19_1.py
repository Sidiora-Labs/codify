#!/usr/bin/env python3
"""Domain19 component probes: actual Git, PostgreSQL and registered JSONL APIs.

These bounded receipts do not establish deployment of a protected Git server,
frontier-fleet capacity, or full V-030/V-033/V-034 campaigns. Missing peer
authorities remain explicit integration holds and are never fabricated passes.
"""
from __future__ import annotations
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit,urlunsplit

ROOT=Path(__file__).resolve().parents[4]
TASK=os.environ.get("HYPERFIDE_INTEGRATION_TEST_TASK","19.1")
DATABASE="hf_integration_"+TASK.replace(".","_")
FAILED=[]
U=lambda n:f"00000000-0000-4000-8000-{n:012x}"
SCOPE={"organisation_id":U(1),"run_id":U(5)}
D="sha256:"+"c"*64
IDS={
"19.1":["candidate.registered-wire","candidate.strict-input","candidate.scope-denied","candidate.real-merge","candidate.deterministic-objects","candidate.conflict-refused","candidate.typed-generations","candidate.immutable-request","candidate.empty-targets-refused"],
"19.2":["publication.registered-wire","publication.strict-input","publication.role-denied","publication.unsigned-push-denied","publication.target-unchanged","publication.immutable-admission","publication.target-lock-exclusive","publication.effective-hook-path-pinned","publication.github-configured-boundary","publication.github-sole-publisher","publication.github-worker-bypass-refused","publication.github-force-bypass-refused","publication.github-unknown-bypass-refused"],
"19.3":["closure.registered-wire","closure.level-required","closure.wave-required","closure.programme-cannot-narrow","closure.policy-requires-gates","closure.policy-requires-acceptance","closure.evaluation-immutable","closure.unregistered-assertions-refused"],
"19.4":["release.registered-wire","release.strict-input","release.empty-set-refused","release.caller-cannot-claim-published","release.immutable-manifest","release.partial-remains-explicit"]
}
ACTIONS={
"19.1":["integration.candidate.create","integration.candidate.inspect","integration.candidate.verify","integration.candidate.admit"],
"19.2":["integration.publication.capabilities","integration.publication.authorize","integration.publication.execute","integration.publication.reconcile","integration.publication.inspect"],
"19.3":["integration.closure.evaluate","integration.closure.verify","integration.closure.inspect"],
"19.4":["integration.release.create","integration.release.inspect","integration.release.evaluate"]
}
def expect(condition,message):
    if not condition:raise AssertionError(message)
def check(identity,callback):
    try:
        callback();actual="observed"
    except Exception as error:
        FAILED.append(identity);actual=type(error).__name__+": "+str(error)
    print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
def run(argv,*,cwd=ROOT,text="",env=None,allow_error=False):
    result=subprocess.run([str(x) for x in argv],cwd=cwd,input=text,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,timeout=90)
    if not allow_error:expect(result.returncode==0,"Command failed: "+result.stderr[-1500:])
    return result
def db_env(database=DATABASE):
    env=os.environ.copy()
    parsed=urlsplit(env["DATABASE_URL"])
    env["DATABASE_URL"]=urlunsplit((parsed.scheme,parsed.netloc,"/"+database,parsed.query,parsed.fragment))
    env["PGDATABASE"]=database
    return env
def sql(statement,*,database=DATABASE,allow_error=False):
    result=run(["psql","-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-d",database],text=statement,env=db_env(database),allow_error=True)
    if not allow_error:expect(result.returncode==0,"Synthetic PostgreSQL query failed: "+" | ".join(x for x in result.stderr.splitlines() if x.startswith("ERROR:")))
    return result
def node(source,args=None,env=None):
    return run(["node","--input-type=module","-e",source,*[str(x) for x in (args or [])]],env=env or db_env())
def cleanup():
    sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='"+DATABASE+"' AND pid<>pg_backend_pid()",database="postgres")
    sql('DROP DATABASE IF EXISTS "'+DATABASE+'";',database="postgres")
    absent=not sql("SELECT datname FROM pg_database WHERE datname='"+DATABASE+"'",database="postgres").stdout.strip()
    artifact=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/domain19-standalone-"+TASK))/"integration"/"database-absence.json"
    artifact.parent.mkdir(parents=True,exist_ok=True)
    artifact.write_text(json.dumps({"database":DATABASE,"observed_absent":absent,"observer":"PostgreSQL pg_database after DROP DATABASE"})+"\n")
    authartifact=artifact.parent/"identity-database-absence.json"
    authabsent=False
    if authartifact.is_file():
        proof=json.loads(authartifact.read_text())
        authabsent=proof.get("observed_absent") is True and isinstance(proof.get("database"),str) and not sql("SELECT datname FROM pg_database WHERE datname='"+proof["database"]+"'",database="postgres").stdout.strip()
    resources=[{"id":"integration-"+TASK+"-database","status":"deleted" if absent else "unknown","observed_absent":absent,"evidence_artifact":"integration/database-absence.json"},{"id":"integration-"+TASK+"-identity-database","status":"deleted" if authabsent else "unknown","observed_absent":authabsent,"evidence_artifact":"integration/identity-database-absence.json"}]
    print(json.dumps({"type":"cleanup","complete":absent and authabsent,"resources":resources}),flush=True)
def bootstrap():
    sql('CREATE DATABASE "'+DATABASE+'";',database="postgres")
    sql((ROOT/"services/hyperfide/migrations/0001-authority.sql").read_text())
    sql((ROOT/"services/hyperfide/migrations/0019-integration.sql").read_text())
    spec=importlib.util.spec_from_file_location("storage_fixture",ROOT/"tests/hyperfide/cases/tasks/4_1.py")
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    sql(module.SEED)
    sql("UPDATE hyperfide.runs SET state='RUNNING',state_version=state_version+1;")
class Fixture:
    def __init__(self,base):
        self.base=base
        self.repository=base/"repository";self.receive=base/"receive.git"
        self.repository.mkdir()
        run(["git","init","-q","-b","main"],cwd=self.repository)
        self.gitenv={**os.environ,"GIT_CONFIG_NOSYSTEM":"1","GIT_CONFIG_GLOBAL":"/dev/null","GIT_AUTHOR_NAME":"Fixture","GIT_AUTHOR_EMAIL":"fixture@example.invalid","GIT_COMMITTER_NAME":"Fixture","GIT_COMMITTER_EMAIL":"fixture@example.invalid","GIT_AUTHOR_DATE":"2000-01-01T00:00:00Z","GIT_COMMITTER_DATE":"2000-01-01T00:00:00Z"}
        (self.repository/"base.txt").write_text("base\n")
        self.g(["add","base.txt"]);self.g(["commit","-qm","base"])
        self.base_oid=self.g(["rev-parse","HEAD"]).stdout.strip()
        run(["git","clone","--bare","-q",self.repository,self.receive],env=self.gitenv)
        self.g(["checkout","-qb","feature"]);(self.repository/"worker.txt").write_text("actual implementation\n")
        self.g(["add","worker.txt"]);self.g(["commit","-qm","feature"])
        self.feature_oid=self.g(["rev-parse","HEAD"]).stdout.strip()
        self.g(["checkout","-q","main"])
        self.gate={"id":"actual-test","kind":"test","argv":["python3","-c","import json;print(json.dumps({'type':'assertion','id':'actual','expected':1,'actual':1}))"],"timeout_ms":3000,"proof":{"manifest_path":"tests/hyperfide/manifests/tasks/19.1.json","manifest_digest":D,"registry_path":"tests/hyperfide/registry.json","registry_digest":D,"expected_assertion_ids":["fixture.actual-assertion"],"case_ids":["V-030"]}}
        self.cfg={"version":1,"organisation_id":U(1),"root":str(base),"repositories":[{"repository_id":U(3),"path":str(self.repository),"target_ref":"refs/heads/main","receive_path":str(self.receive),"gates":[self.gate],"review_policy_digest":D,"review_rubrics":[D],"required_graph":True}],"closure":{"wave_gates":[{**self.gate,"covers":[]}],"programme_gates":[{**self.gate,"covers":["V-034"]}],"required_acceptance_ids":["V-034"],"required_docs":False}}
        self.config=base/"integration.json";self.config.write_text(json.dumps(self.cfg))
        self.key=base/"gateway.key";self.key.write_bytes(os.urandom(32));self.key.chmod(0o600)
        self.env={**db_env(),"HYPERFIDE_INTEGRATION_CONFIG":str(self.config),"HYPERFIDE_GATEWAY_KEY_FILE":str(self.key),"HYPERFIDE_INTEGRATION_EXECUTOR_ID":U(200)}
        self.auth=None;self.auth_error=None
        try:
            identity_spec=importlib.util.spec_from_file_location("real_identity_fixture",ROOT/"tests/hyperfide/support/identity_fixture.py")
            identity_module=importlib.util.module_from_spec(identity_spec);identity_spec.loader.exec_module(identity_module);IdentityFixture=identity_module.IdentityFixture
            needed=set()
            def dependency(name):
                if name in needed:return
                needed.add(name)
                fragment=ROOT/"services/hyperfide/components"/(name+".json")
                if not fragment.is_file():raise RuntimeError("Actual peer component dependency unavailable: "+name)
                for parent in json.loads(fragment.read_text())["requires"]:dependency(parent)
            for name in ["1.4","4.1","4.2","14.1"]+["19."+str(n) for n in range(1,int(TASK.split(".")[1])+1)]:dependency(name)
            def setup(real):
                realcfg=json.loads(json.dumps(self.cfg));realcfg["organisation_id"]=real.ids["organisation"]
                self.config.write_text(json.dumps(realcfg))
                policy=json.loads(real.policy.read_text());policy["allowed_actions"].append("system.describe");real.policy.write_text(json.dumps(policy))
                identity=json.loads(real.identity_config.read_text())
                for principal in identity["principals"]:principal["allowed_actions"].append("system.describe")
                real.identity_config.write_text(json.dumps(identity))
            self.auth=IdentityFixture(components=sorted(needed),extra_env={k:v for k,v in self.env.items() if k.startswith('HYPERFIDE_INTEGRATION_') or k.startswith('HYPERFIDE_GATEWAY_')},extra_setup=setup)
        except Exception as error:self.auth_error=str(error)
    def close(self):
        database=self.auth.database if self.auth else None
        if self.auth:self.auth.close()
        absent=bool(database) and not sql("SELECT datname FROM pg_database WHERE datname='"+database+"'",database="postgres").stdout.strip()
        artifact=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/domain19-standalone-"+TASK))/"integration"/"identity-database-absence.json"
        artifact.parent.mkdir(parents=True,exist_ok=True)
        artifact.write_text(json.dumps({"database":database,"observed_absent":absent,"dependency_error":self.auth_error,"observer":"PostgreSQL pg_database after fixture DROP"})+"\n")

    def g(self,args,allow_error=False):
        return run(["git","-c","core.hooksPath=/dev/null","-c","gc.auto=0",*args],cwd=self.repository,env=self.gitenv,allow_error=allow_error)
    def invoke(self,component,action,value):
        expect(self.auth is not None,"Real authenticated dependency closure unavailable: "+str(self.auth_error))
        actual=dict(value)
        if actual.get("organisation_id")==U(1):actual["organisation_id"]=self.auth.ids["organisation"]
        if actual.get("run_id")==U(5):actual["run_id"]=self.auth.ids["run"]
        status,row=self.auth.invoke(action,actual,component=component)
        expect(status in (200,400,401,403,409,422,500,503),"Unexpected real HTTPS response")
        return row
    def reject(self,component,action,value,code):
        row=self.invoke(component,action,value)
        expect(row.get("ok") is False and row.get("error",{}).get("code")==code,"Wrong product refusal: "+json.dumps(row))
    def wire(self):
        row=self.invoke("system","system.describe",{})
        expect(row.get("ok") is True,"Registry describe failed")
        data=row.get("result",row.get("output",{}))
        expect(TASK in json.dumps(data) and all(a in json.dumps(data) for a in ACTIONS[TASK]),"Task component/action not linked")
def candidate_cases(f):
    check(IDS[TASK][0],f.wire)
    check(IDS[TASK][1],lambda:f.reject(TASK,"integration.candidate.create",{**SCOPE,"claim_pass":True},"INTEGRATION_INVALID"))
    check(IDS[TASK][2],lambda:f.reject(TASK,"integration.candidate.inspect",{**SCOPE,"organisation_id":U(999),"candidate_id":U(81)},"INTEGRATION_SCOPE_DENIED"))
    module=(ROOT/"services/hyperfide/dist/integration/candidates.js").as_uri()
    merge="import {git} from "+json.dumps(module)+";const [repo,base,next]=process.argv.slice(1);const tree=await git(repo,['merge-tree','--write-tree',base,next]);console.log(tree)"
    tree=node(merge,[f.repository,f.base_oid,f.feature_oid]).stdout.strip()
    check(IDS[TASK][3],lambda:expect(tree==f.g(["rev-parse",f.feature_oid+"^{tree}"]).stdout.strip(),"Actual merged tree differs"))
    check(IDS[TASK][4],lambda:expect(node(merge,[f.repository,f.base_oid,f.feature_oid]).stdout.strip()==tree,"Identical merge inputs changed tree"))
    def conflict():
        f.g(["checkout","-qb","left",f.base_oid]);(f.repository/"base.txt").write_text("left\n");f.g(["commit","-qam","left"]);left=f.g(["rev-parse","HEAD"]).stdout.strip()
        f.g(["checkout","-qb","right",f.base_oid]);(f.repository/"base.txt").write_text("right\n");f.g(["commit","-qam","right"]);right=f.g(["rev-parse","HEAD"]).stdout.strip()
        result=f.g(["merge-tree","--write-tree",left,right],True);expect(result.returncode!=0,"Real conflicting Git trees silently merged");f.g(["checkout","-q","main"])
    check(IDS[TASK][5],conflict)
    check(IDS[TASK][6],lambda:node("import {decimal} from "+json.dumps(module)+";if(decimal('9007199254740993')!=='9007199254740993')throw Error('precision');for(const x of [1,true,'01','0','9223372036854775808']){let refused=false;try{decimal(x)}catch{refused=true}if(!refused)throw Error('invalid generation accepted')}"))
    def immutable():
        sql("INSERT INTO hyperfide.integration_requests(organisation_id,run_id,request_id,request_digest,candidate_ids) VALUES('"+U(1)+"','"+U(5)+"','"+U(100)+"','"+D+"',ARRAY['"+U(101)+"']::uuid[]);")
        result=sql("UPDATE hyperfide.integration_requests SET request_digest='sha256:"+("d"*64)+"';",allow_error=True)
        expect(result.returncode!=0,"Actual PostgreSQL allowed request rewrite")
    check(IDS[TASK][7],immutable)
    check(IDS[TASK][8],lambda:f.reject(TASK,"integration.candidate.create",{**SCOPE,"request_id":U(102),"targets":[],"environment_digest":D,"contract_digest":D},"INTEGRATION_INVALID"))
def publication_cases(f):
    check(IDS[TASK][0],f.wire)
    check(IDS[TASK][1],lambda:f.reject(TASK,"integration.publication.execute",{**SCOPE,"operation_id":U(1),"new_head":f.feature_oid},"INTEGRATION_INVALID"))
    check(IDS[TASK][2],lambda:f.reject(TASK,"integration.publication.execute",{**SCOPE,"operation_id":U(1)},"PUBLICATION_ROLE_DENIED"))
    server=f.base/"server.json";server.write_text(json.dumps(f.env));server.chmod(0o600)
    module=(ROOT/"services/hyperfide/dist/integration/publication.js").as_uri()
    custom=f.base/"untrusted-hooks";custom.mkdir()
    run(["git","--git-dir="+str(f.receive),"config","core.hooksPath",custom])
    node("import {installGatewayHook} from "+json.dumps(module)+";await installGatewayHook(process.argv[1],process.argv[2]);",[f.receive,server])
    def unsigned():
        result=run(["git","push",f.receive,f.feature_oid+":refs/heads/main"],cwd=f.repository,env=f.gitenv,allow_error=True)
        expect(result.returncode!=0 and "gateway rejected" in result.stderr,"Actual receive hook allowed unsigned protected update")
    check(IDS[TASK][3],unsigned)
    check(IDS[TASK][4],lambda:expect(run(["git","--git-dir="+str(f.receive),"rev-parse","refs/heads/main"]).stdout.strip()==f.base_oid,"Rejected push changed actual target"))
    def immutable_admission():
        cols=sql("SELECT count(*) FROM pg_trigger WHERE tgname='immutable_gateway_admission' AND NOT tgisinternal;").stdout.strip()
        expect(cols=="1","Gateway admission immutable trigger missing")
        expect(sql("SELECT count(*) FROM hyperfide.publication_gateway_admissions;").stdout.strip()=="0","Unsigned push fabricated an admission")
    check(IDS[TASK][5],immutable_admission)
    def target_exclusive():
        result=sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='hyperfide.publication_target_locks'::regclass AND contype='p';").stdout.strip()
        expect(result=="PRIMARY KEY (organisation_id, repository_id, target_ref)","Cross-run target exclusion absent")
    check(IDS[TASK][6],target_exclusive)
    check(IDS[TASK][7],lambda:expect(run(["git","--git-dir="+str(f.receive),"config","--get","core.hooksPath"]).stdout.strip()==str(f.receive/"hooks"),"Operator installer retained disabled effective hook path"))
    def unsupported_github():
        row=f.invoke(TASK,"integration.publication.capabilities",{**SCOPE,"repository_id":U(3)})
        result=row.get("result",row.get("output",{}))
        expect(row.get("ok") is True and result["github"]["live_qualified"] is False and result["github"]["adapter_implemented"] is True and result["github"]["status"]=="NOT_CONFIGURED","Local hook fixture implied hosted GitHub publication authority")
    check(IDS[TASK][8],unsupported_github)
    github=(ROOT/"services/hyperfide/dist/integration/github.js").as_uri()
    source="import {validateGitHubProtection} from "+json.dumps(github)+";const p={owner:'fixture',repository:'repo',repository_numeric_id:1,app_id:9};const r={id:1,full_name:'fixture/repo'},rules=[{type:'update',ruleset_id:1},{type:'non_fast_forward',ruleset_id:2}],sets=[{id:1,enforcement:'active',target:'branch',bypass_actors:[{actor_type:'Integration',actor_id:9,bypass_mode:'always'}],rules:[{type:'update'}]},{id:2,enforcement:'active',target:'branch',bypass_actors:[],rules:[{type:'non_fast_forward'}]}];"
    check(IDS[TASK][9],lambda:node(source+"if(!validateGitHubProtection(p,r,rules,sets,null).startsWith('sha256:'))throw Error('missing policy digest')"))
    for index,mutation in [(10,"sets[0].bypass_actors.push({actor_type:'Team',actor_id:22,bypass_mode:'always'});"),(11,"sets[1].bypass_actors.push({actor_type:'Integration',actor_id:9,bypass_mode:'always'});"),(12,"delete sets[0].bypass_actors;")]:
        check(IDS[TASK][index],lambda mutation=mutation:node(source+mutation+"let denied=false;try{validateGitHubProtection(p,r,rules,sets,null)}catch{denied=true}if(!denied)throw Error('unsafe hosted policy accepted')"))
def closure_cases(f):
    check(IDS[TASK][0],f.wire)
    check(IDS[TASK][1],lambda:f.reject(TASK,"integration.closure.evaluate",SCOPE,"INTEGRATION_INVALID"))
    check(IDS[TASK][2],lambda:f.reject(TASK,"integration.closure.evaluate",{**SCOPE,"level":"WAVE"},"CLOSURE_INVALID"))
    check(IDS[TASK][3],lambda:f.reject(TASK,"integration.closure.evaluate",{**SCOPE,"level":"PROGRAMME","task_id":U(7)},"CLOSURE_INVALID"))
    module=(ROOT/"services/hyperfide/dist/integration/closure.js").as_uri()
    def policy_refuse(field):
        policy=json.loads(json.dumps(f.cfg));policy["closure"][field]=[]
        node("import {closurePolicy} from "+json.dumps(module)+";let refused=false;try{closurePolicy(JSON.parse(process.argv[1]))}catch{refused=true}if(!refused)throw Error('empty scope obligation accepted');",[json.dumps(policy)])
    check(IDS[TASK][4],lambda:policy_refuse("wave_gates"))
    check(IDS[TASK][5],lambda:policy_refuse("required_acceptance_ids"))
    def immutable():
        sql("INSERT INTO hyperfide.integration_closure_evaluations(organisation_id,run_id,id,level,input_manifest_digest,outcome,manifest) VALUES('"+U(1)+"','"+U(5)+"','"+U(400)+"','PROGRAMME','"+D+"','HELD','{\"reasons\":[\"REQUIRED_UNRUN\"]}');")
        expect(sql("UPDATE hyperfide.integration_closure_evaluations SET outcome='PASS';",allow_error=True).returncode!=0,"Held programme receipt rewritten to PASS")
    check(IDS[TASK][6],immutable)
    def reject_unregistered():
        weak=json.loads(json.dumps(f.cfg))
        for gate in weak["closure"]["wave_gates"]+weak["closure"]["programme_gates"]:gate.pop("proof",None)
        node("import {closurePolicy} from "+json.dumps(module)+";let refused=false;try{closurePolicy(JSON.parse(process.argv[1]))}catch(e){refused=['CLOSURE_POLICY_INVALID','INTEGRATION_INVALID'].includes(e.code)}if(!refused)throw Error('arbitrary stdout accepted as full-case proof');",[json.dumps(weak)])
    check(IDS[TASK][7],reject_unregistered)
def release_cases(f):
    check(IDS[TASK][0],f.wire)
    check(IDS[TASK][1],lambda:f.reject(TASK,"integration.release.create",{**SCOPE,"done":True},"INTEGRATION_INVALID"))
    check(IDS[TASK][2],lambda:f.reject(TASK,"integration.release.create",{**SCOPE,"request_id":U(500),"candidate_ids":[],"recovery_policy":"ADVANCE_COMPATIBLE_MANIFEST"},"RELEASE_INVALID"))
    check(IDS[TASK][3],lambda:f.reject(TASK,"integration.release.evaluate",{**SCOPE,"barrier_id":U(500),"published":True},"INTEGRATION_INVALID"))
    def immutable():
        sql("INSERT INTO hyperfide.integration_release_barriers(organisation_id,run_id,id,request_id,manifest_digest,manifest,state) VALUES('"+U(1)+"','"+U(5)+"','"+U(501)+"','"+U(502)+"','"+D+"','{}','PARTIAL');")
        expect(sql("UPDATE hyperfide.integration_release_barriers SET manifest='{\"atomic_across_repositories\":true}',state_version=state_version+1;",allow_error=True).returncode!=0,"Partial release manifest rewritten")
    check(IDS[TASK][4],immutable)
    check(IDS[TASK][5],lambda:expect(sql("SELECT state FROM hyperfide.integration_release_barriers WHERE id='"+U(501)+"';").stdout.strip()=="PARTIAL","Partial publication disappeared"))
def main():
    if "--cleanup" in sys.argv:
        cleanup();return 0
    bootstrap()
    try:
        with tempfile.TemporaryDirectory(prefix="hf-domain19-",dir="/tmp/hyperfide") as directory:
            fixture=Fixture(Path(directory))
            try:{"19.1":candidate_cases,"19.2":publication_cases,"19.3":closure_cases,"19.4":release_cases}[TASK](fixture)
            finally:fixture.close()
        return 1 if FAILED else 0
    finally:cleanup()
if __name__=="__main__":raise SystemExit(main())
