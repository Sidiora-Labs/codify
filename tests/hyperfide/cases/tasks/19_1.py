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
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit,urlunsplit

ROOT=Path(__file__).resolve().parents[4]
# Fixture Git must never daemonize auto-maintenance: detached children outlive the probe.
os.environ.update({"GIT_CONFIG_COUNT":"2","GIT_CONFIG_KEY_0":"maintenance.auto","GIT_CONFIG_VALUE_0":"false","GIT_CONFIG_KEY_1":"gc.auto","GIT_CONFIG_VALUE_1":"0"})
TASK=os.environ.get("HYPERFIDE_INTEGRATION_TEST_TASK","19.1")
DATABASE="hf_integration_"+TASK.replace(".","_")
FAILED=[]
U=lambda n:f"00000000-0000-4000-8000-{n:012x}"
SCOPE={"organisation_id":U(1),"run_id":U(5)}
D="sha256:"+"c"*64
IDS={
"19.1":["candidate.registered-wire","candidate.strict-input","candidate.scope-denied","candidate.real-merge","candidate.deterministic-objects","candidate.conflict-refused","candidate.typed-generations","candidate.immutable-request","candidate.empty-targets-refused","candidate.authenticated-run-bound","candidate.remote-gates-required","candidate.combined-fail-rejected","candidate.successor-not-released","candidate.level-status-explicit","candidate.input-change-invalidates","candidate.history-intact","candidate.cleanup-reconciles","candidate.cleanup-idempotent"],
"19.2":["publication.registered-wire","publication.strict-input","publication.role-denied","publication.unsigned-push-denied","publication.target-unchanged","publication.immutable-admission","publication.target-lock-exclusive","publication.effective-hook-path-pinned","publication.github-configured-boundary","publication.github-sole-publisher","publication.github-worker-bypass-refused","publication.github-force-bypass-refused","publication.github-unknown-bypass-refused","publication.client-hook-suppressed","publication.server-hook-still-enforced","publication.token-persist-failure-revokes","publication.askpass-failure-revokes","publication.orphan-remains-unknown","publication.custody-preflight-no-mint","publication.source-url-rewrite-isolated","publication.https-source-config-isolated","publication.invalid-token-response-revokes"],
"19.3":["closure.registered-wire","closure.level-required","closure.wave-required","closure.programme-cannot-narrow","closure.policy-requires-gates","closure.policy-requires-acceptance","closure.evaluation-immutable","closure.unregistered-assertions-refused","closure.declared-coverage-bound","closure.policy-valid-shape","closure.policy-programme-cases-registered","closure.dependency-qualified-milestone-only","closure.lease-expiry-keeps-admitted-work","closure.competing-custody-refused","closure.wave-held-without-accepted-candidate","closure.dependency-integrated-after-acceptance","closure.wave-held-despite-passing-tasks","closure.wave-lists-open-blocking-finding","closure.downstream-activation-withheld","closure.levels-report-own-status","closure.programme-requires-end-to-end-rehearsal","closure.programme-end-to-end-rehearsal-current","closure.programme-requires-each-wave-closed"],
"19.4":["release.registered-wire","release.strict-input","release.empty-set-refused","release.caller-cannot-claim-published","release.immutable-manifest","release.partial-remains-explicit"]
}
ACTIONS={
"19.1":["integration.candidate.create","integration.candidate.inspect","integration.candidate.verify","integration.candidate.admit","integration.candidate.status","integration.candidate.cleanup"],
"19.2":["integration.publication.capabilities","integration.publication.authorize","integration.publication.execute","integration.publication.reconcile","integration.publication.inspect"],
"19.3":["integration.closure.evaluate","integration.closure.verify","integration.closure.inspect","integration.closure.reconcile"],
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
def cleanup(emit=True):
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
        authabsent=proof.get("observed_absent") is True and isinstance(proof.get("database"),str) and re.fullmatch(r"hf_integration_identity_[a-z0-9_]{1,55}",proof["database"]) is not None and not sql("SELECT datname FROM pg_database WHERE datname='"+proof["database"]+"'",database="postgres").stdout.strip()
    resources=[{"id":"integration-"+TASK+"-database","status":"deleted" if absent else "unknown","observed_absent":absent,"evidence_artifact":"integration/database-absence.json"},{"id":"integration-"+TASK+"-identity-database","status":"deleted" if authabsent else "unknown","observed_absent":authabsent,"evidence_artifact":"integration/identity-database-absence.json"}]
    if emit:print(json.dumps({"type":"cleanup","complete":absent and authabsent,"resources":resources}),flush=True)
    return absent and authabsent
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
        self.gate={"id":"actual-test","kind":"test","argv":["python3","-c","import json;print(json.dumps({'type':'assertion','id':'actual','expected':1,'actual':1}))"],"timeout_ms":3000,"proof":{"manifest_path":"tests/hyperfide/manifests/tasks/19.1.json","manifest_digest":D,"registry_path":"tests/hyperfide/registry.json","registry_digest":D,"expected_assertion_ids":["fixture.actual-assertion"],"case_ids":["V-034"]}}
        self.cfg={"version":1,"organisation_id":U(1),"root":str(base),"repositories":[{"repository_id":U(3),"path":str(self.repository),"target_ref":"refs/heads/main","receive_path":str(self.receive),"gates":[self.gate],"review_policy_digest":D,"review_rubrics":[D],"required_graph":True}],"closure":{"wave_gates":[{**self.gate,"covers":["V-034"]}],"programme_gates":[{**self.gate,"covers":["V-034"]}],"required_acceptance_ids":["V-034"],"required_docs":False}}
        self.config=base/"integration.json";self.config.write_text(json.dumps(self.cfg))
        self.key=base/"gateway.key";self.key.write_bytes(os.urandom(32));self.key.chmod(0o600)
        self.env={**db_env(),"HYPERFIDE_INTEGRATION_CONFIG":str(self.config),"HYPERFIDE_GATEWAY_KEY_FILE":str(self.key),"HYPERFIDE_INTEGRATION_EXECUTOR_ID":U(200)}
        self.auth=None;self.auth_error=None;self.auth_database="hf_integration_identity_"+TASK.replace(".","_")+"_"+os.urandom(6).hex()
        try:
            identity_spec=importlib.util.spec_from_file_location("real_identity_fixture",ROOT/"tests/hyperfide/support/identity_fixture.py")
            identity_module=importlib.util.module_from_spec(identity_spec);identity_spec.loader.exec_module(identity_module);IdentityFixture=identity_module.IdentityFixture
            needed=set();fragment_paths={json.loads(p.read_text()).get('id'):p for p in (ROOT/'services/hyperfide/components').glob('*.json') if p.name!='schema.json'}
            def dependency(name):
                if name in needed:return
                needed.add(name)
                fragment=fragment_paths.get(name,ROOT/"services/hyperfide/components"/(name+".json"))
                if not fragment.is_file():raise RuntimeError("Actual peer component dependency unavailable: "+name)
                for parent in json.loads(fragment.read_text())["requires"]:dependency(parent)
            for name in ["1.4","4.1","4.2","14.1"]+["19."+str(n) for n in range(1,int(TASK.split(".")[1])+1)]:dependency(name)
            def setup(real):
                for migration in sorted((ROOT/"services/hyperfide/migrations").glob("*.sql")):
                    version=int(migration.name.split("-")[0])
                    present=real.sql("SELECT checksum FROM hyperfide.schema_migrations WHERE version=$1",[version])
                    content=migration.read_bytes();checksum="sha256:"+hashlib.sha256(content).hexdigest()
                    if present:
                        expect(present[0]["checksum"]==checksum,"Actual fixture predecessor migration checksum differs")
                        continue
                    real.sql("BEGIN;"+content.decode()+";INSERT INTO hyperfide.schema_migrations(version,name,checksum) VALUES("+str(version)+",'"+migration.stem+"','"+checksum+"');COMMIT;")
                real.env["HYPERFIDE_CONTROL_PRIMARY_DATABASE_URL"]=real.url
                real.env.pop("DATABASE_URL",None)
                realcfg=json.loads(json.dumps(self.cfg));realcfg["organisation_id"]=real.ids["organisation"]
                self.config.write_text(json.dumps(realcfg))
                authorization=real.path/"integration-authorization.json"
                authorization.write_text(json.dumps({"schema_version":1,"rules":[{"role":"OPERATOR","actions":real.actions,"repositories":[],"artifact_prefixes":[],"git_refs":[],"model_destinations":[],"model_profiles":[]}]}));authorization.chmod(0o600)
                real.env["HF_AUTHORIZATION_CONFIG_FILE"]=str(authorization)
            self.auth=IdentityFixture(extra_actions=("system.describe",),database=self.auth_database,components=sorted(fragment_paths[name].stem for name in needed),extra_env={k:v for k,v in self.env.items() if k.startswith('HYPERFIDE_INTEGRATION_') or k.startswith('HYPERFIDE_GATEWAY_')},extra_setup=setup)
        except Exception as error:
            messages=[];seen=set();current=error
            while current is not None and id(current) not in seen:
                seen.add(id(current));messages.append(type(current).__name__+": "+str(current));current=current.__cause__ or current.__context__
            self.auth_error=" | caused by: ".join(messages)
    def close(self):
        database=self.auth_database
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
def canon(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False)
def sha(value):return "sha256:"+hashlib.sha256(value.encode() if isinstance(value,str) else value).hexdigest()
def q(value):return "NULL" if value is None else "'"+str(value).replace("'","''")+"'"
def integration_seed(ids,run,repository,oids,gate):
    """Recorded rows for two independently qualified contributors and two immutable combined candidates.
    Candidate700 holds the recorded remote FAIL of its combined commit set; candidate701 holds a recorded PASS.
    These rows stand in for 16.x qualification/12.4 remote execution which cannot run in this sandbox."""
    o,r,R=ids["organisation"],ids["run"],repository
    s=[f"INSERT INTO hyperfide.repositories(organisation_id,project_id,id,name,url) VALUES({q(o)},{q(ids['project'])},{q(R)},'integration-fixture','https://example.invalid/integration.git');"]
    for key in ("base","left","right","head"):s.append(f"INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES({q(o)},{q(R)},{q(oids[key])});")
    s.append(f"INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES({q(o)},{q(r)},{q(R)},{q(oids['base'])},'refs/heads/main');")
    s.append(f"INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES({q(o)},{q(r)},{q(U(600))},'integration',1);")
    contributors=[]
    for n,key in enumerate(("left","right")):
        task,attempt,custody=U(610+n),U(620+n),U(630+n)
        s.append(f"INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) VALUES({q(o)},{q(r)},{q(task)},{q('19.1-'+key)},{q(U(600))},{q(run['spec_revision_id'])},{q(D)},'{{}}',1);")
        s.append(f"INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,execution_state) VALUES({q(o)},{q(r)},{q(attempt)},{q(task)},1,{q(run['authority_epoch'])},{q(D)},'SUCCEEDED');")
        s.append(f"INSERT INTO hyperfide.submission_custodies(organisation_id,run_id,id,task_id,source_attempt_id,source_generation,custody_generation,authority_epoch,repository_id,source_object_id,source_manifest_digest,evidence_manifest_digest,criteria_digest,authority,qualification_outcome) VALUES({q(o)},{q(r)},{q(custody)},{q(task)},{q(attempt)},1,1,{q(run['authority_epoch'])},{q(R)},{q(oids[key])},{q(D)},{q(D)},{q(D)},'ACTIVE','PASS');")
        s.append(f"UPDATE hyperfide.tasks SET current_custody_id={q(custody)},state='QUALIFIED',state_version=state_version+1 WHERE organisation_id={q(o)} AND run_id={q(r)} AND id={q(task)};")
        contributors.append({"custody_id":custody,"custody_generation":"1","task_id":task,"source_object_id":oids[key],"criteria_digest":D,"source_manifest_digest":D,"evidence_manifest_digest":D,"proof_criteria_digest":D,"qualification_receipt_digest":sha("isolated-qualification-"+key),"proof_source_manifest_digest":D})
    s.append(f"INSERT INTO hyperfide.branch_authorities(organisation_id,run_id,id,repository_id,branch_ref,branch_generation,authority_epoch,expected_old_head) VALUES({q(o)},{q(r)},{q(U(640))},{q(R)},'refs/heads/main',1,{q(run['authority_epoch'])},{q(oids['base'])});")
    s.append(f"INSERT INTO hyperfide.capacity_accounts(organisation_id,id,pool_id,dimension,configured_limit,provenance_digest) VALUES({q(o)},{q(U(650))},{q(ids['pool'])},'TEST',10,{q(D)});")
    for n in range(4):s.append(f"INSERT INTO hyperfide.reservations(organisation_id,run_id,id,request_id,capacity_account_id,quantity,expires_at,state) VALUES({q(o)},{q(r)},{q(U(660+n))},{q(U(670+n))},{q(U(650))},1,clock_timestamp()+interval '1 hour','ALLOCATED');")
    commit_set=[{"repository_id":R,"candidate_head":oids["head"],"expected_old_head":oids["base"]}];digests={}
    for n,(candidate,state) in enumerate(((U(700),"FAILED"),(U(701),"PENDING"))):
        manifest={"version":1,"request_id":U(710+n),"run_id":r,"spec_revision_id":run["spec_revision_id"],"spec_generation":str(run["spec_generation"]),"policy_digest":run["policy_digest"],"authority_epoch":run["authority_epoch"],"repository_id":R,"branch_authority_id":U(640),"branch_generation":"1","target_ref":"refs/heads/main","expected_old_head":oids["base"],"candidate_head":oids["head"],"tree":oids["tree"],"parents":oids["parents"],"git_provenance_manifest":{"kind":"GIT_CANDIDATE_PROVENANCE_V1","source_object_id":oids["head"]},"git_provenance_manifest_digest":sha(canon({"kind":"GIT_CANDIDATE_PROVENANCE_V1","source_object_id":oids["head"]})),"contributors":contributors,"commit_set":commit_set,"execution_session_id":U(720),"execution_receipt_digest":D,"declared_context":{"environment_digest":D,"contract_digest":D,"authority":"UNVERIFIED_CALLER_LABELS"},"context_authority":"IMMUTABLE_REVIEW_INPUT_BINDINGS","required_gates":[gate],"review_policy_digest":D,"review_rubrics":[D],"required_graph":True,"review_sources":sorted({oids["head"],oids["left"],oids["right"]})}
        digests[candidate]=sha(canon(manifest));first=contributors[0]
        s.append(f"INSERT INTO hyperfide.integration_candidates(organisation_id,run_id,id,task_id,custody_id,custody_generation,repository_id,branch_authority_id,branch_generation,expected_old_head,candidate_head,input_manifest_digest,request_id,state) VALUES({q(o)},{q(r)},{q(candidate)},{q(first['task_id'])},{q(first['custody_id'])},1,{q(R)},{q(U(640))},1,{q(oids['base'])},{q(oids['head'])},{q(digests[candidate])},{q(U(730+n))},{q(state)});")
        s.append(f"INSERT INTO hyperfide.integration_candidate_manifests(organisation_id,run_id,candidate_id,manifest) VALUES({q(o)},{q(r)},{q(candidate)},{q(canon(manifest))}::jsonb);")
        for c in contributors:s.append(f"INSERT INTO hyperfide.candidate_custodies(organisation_id,run_id,candidate_id,custody_id,custody_generation,task_id,repository_id) VALUES({q(o)},{q(r)},{q(candidate)},{q(c['custody_id'])},1,{q(c['task_id'])},{q(R)});")
    for job,candidate,reservation,state,outcome in ((U(740),U(700),U(660),"FAILED","FAIL"),(U(741),U(701),U(661),"SUCCEEDED","PASS"),(U(742),U(700),U(662),"RUNNING",None)):
        s.append(f"INSERT INTO hyperfide.integration_jobs(organisation_id,run_id,id,candidate_id,executor_id,reservation_id,state,finished_at,source_object_id,source_tree_id,review_bindings_digest,verification_input_digest,execution_manifest) VALUES({q(o)},{q(r)},{q(job)},{q(candidate)},{q(U(720))},{q(reservation)},{q(state)},{'NULL' if state=='RUNNING' else 'clock_timestamp()'},{q(oids['head'])},{q(oids['tree'])},{q(D)},{q(D)},{q(canon([{'gate':gate,'remote':{'plan':{'operation_id':U(750)}}}] if state=='RUNNING' else []))}::jsonb);")
        if outcome:
            out=canon({"type":"assertion","id":"fixture.actual-assertion","outcome":outcome})+"\n"
            s.append(f"INSERT INTO hyperfide.integration_gate_receipts(organisation_id,run_id,candidate_id,job_id,gate_id,input_manifest_digest,outcome,exit_code,assertion_count,stdout_digest,stderr_digest,stdout,stderr,proof) VALUES({q(o)},{q(r)},{q(candidate)},{q(job)},{q(gate['id'])},{q(digests[candidate])},{q(outcome)},{0 if outcome=='PASS' else 1},1,{q(sha(out))},{q(sha(''))},{q(out)},'',{q(canon({'scope_digest':D}))}::jsonb);")
    return "\n".join(s),commit_set
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
    check(IDS[TASK][9],lambda:f.reject(TASK,"integration.candidate.inspect",{**SCOPE,"run_id":U(998),"candidate_id":U(81)},"INTEGRATION_SCOPE_DENIED"))
    integration_cases(f)
def integration_cases(f):
    """do_1..do_3 and cleanup through the running service against recorded remote outcomes."""
    state={}
    def prepare():
        if "error" in state:raise AssertionError(state["error"])
        if state:return state
        try:
            expect(f.auth is not None,"Real authenticated dependency closure unavailable: "+str(f.auth_error))
            def commit(name,base,filename):
                f.g(["checkout","-qb",name,base]);(f.repository/filename).write_text(name+"\n");f.g(["add",filename]);f.g(["commit","-qm",name]);oid=f.g(["rev-parse","HEAD"]).stdout.strip();f.g(["checkout","-q","main"]);return oid
            left=commit("task-a",f.base_oid,"task-a.txt");right=commit("task-b",f.base_oid,"task-b.txt")
            env={**f.gitenv,"GIT_AUTHOR_NAME":"Hyperfide","GIT_AUTHOR_EMAIL":"integration@hyperfide.invalid","GIT_COMMITTER_NAME":"Hyperfide","GIT_COMMITTER_EMAIL":"integration@hyperfide.invalid"}
            head=f.base_oid
            for source in (left,right):
                tree=f.g(["merge-tree","--write-tree",head,source]).stdout.strip()
                head=run(["git","commit-tree",tree,"-p",head,"-p",source,"-m","Hyperfide immutable integration candidate"],cwd=f.repository,env=env).stdout.strip()
            oids={"base":f.base_oid,"left":left,"right":right,"head":head,"tree":f.g(["rev-parse",head+"^{tree}"]).stdout.strip(),"parents":f.g(["show","-s","--format=%P",head]).stdout.split()}
            run_row=f.auth.sql("SELECT spec_revision_id,spec_generation::text AS spec_generation,policy_digest,authority_epoch FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2",[f.auth.ids["organisation"],f.auth.ids["run"]])[0]
            statements,commit_set=integration_seed(f.auth.ids,run_row,U(3),oids,f.gate)
            f.auth.sql(statements)
            state.update(oids=oids,commit_set=commit_set,run=run_row)
            return state
        except Exception as error:
            state["error"]=type(error).__name__+": "+str(error);raise
    def db(statement,values=None):return f.auth.sql(statement,values or [])
    def result(row):
        expect(row.get("ok") is True,"Service refused: "+json.dumps(row)[:1500]);return row.get("result",row.get("output"))
    def status(candidate):return result(f.invoke(TASK,"integration.candidate.status",{**SCOPE,"candidate_id":candidate}))
    def remote_required():
        prepare()
        row=f.invoke(TASK,"integration.candidate.verify",{**SCOPE,"candidate_id":U(701),"reservation_id":U(663),"session_id":U(720)})
        code=row.get("error",{}).get("code")
        # Positive remote dispatch needs a live runner.remote.v1 provider: UNVERIFIED here, refusal must be explicit.
        expect(row.get("ok") is False and code in ("INTEGRATION_REMOTE_EXECUTOR_UNAVAILABLE","INTEGRATION_REMOTE_RUNTIME_UNAVAILABLE"),"Gates were not refused explicitly without the remote executor: "+json.dumps(row)[:800])
        expect(db("SELECT count(*)::int AS n FROM hyperfide.integration_jobs WHERE candidate_id=$1 AND reservation_id=$2",[U(701),U(663)])[0]["n"]==0,"Refused verification created job authority")
        expect(db("SELECT count(*)::int AS n FROM hyperfide.integration_gate_receipts")[0]["n"]==2,"Refused verification fabricated a gate receipt")
        expect(db("SELECT state FROM hyperfide.reservations WHERE id=$1",[U(663)])[0]["state"]=="ALLOCATED","Refused verification consumed the separate reservation")
    check(IDS[TASK][10],remote_required)
    def combined_rejected():
        prepare()
        row=f.invoke(TASK,"integration.candidate.admit",{**SCOPE,"candidate_id":U(700)})
        error=row.get("error",{})
        expect(row.get("ok") is False and error.get("code")=="INTEGRATION_CANDIDATE_REJECTED","Failing combined candidate was not rejected: "+json.dumps(row)[:800])
        expect(sha(canon(state["commit_set"])) in error.get("message","") and state["oids"]["head"] in error.get("message",""),"Rejection lacks exact commit-set evidence")
        report=status(U(700))
        expect(report["verdict"]=="REJECTED" and report["evidence"]["commit_set"]==state["commit_set"] and report["evidence"]["commit_set_digest"]==sha(canon(state["commit_set"])),"Status lacks exact rejected commit set")
        gate=report["gates"][0]
        expect(gate["outcome"]=="FAIL" and gate["exit_code"]==1 and gate["job_id"]==U(740) and gate["stdout_digest"].startswith("sha256:"),"Status lacks recorded failing gate evidence")
        expect([c["isolated_qualification"] for c in report["contributors"]]==["PASS","PASS"] and sorted(c["source_object_id"] for c in report["evidence"]["contributors"])==sorted([state["oids"]["left"],state["oids"]["right"]]),"Individually passing contributors not preserved as evidence")
        expect(db("SELECT state FROM hyperfide.integration_candidates WHERE id=$1",[U(700)])[0]["state"]=="FAILED","Rejected candidate state changed")
    check(IDS[TASK][11],combined_rejected)
    def successor_held():
        prepare()
        report=status(U(700))
        expect(report["successors_released"] is False and report["integrated"] is False and report["candidate_qualified"] is False and all(c["integrated"] is False and c["task_state"]=="QUALIFIED" for c in report["contributors"]),"Isolated qualification implied integration")
        program="""import {ResourceContainer} from './services/hyperfide/dist/storage/runtime.js';import {requireMilestone} from './services/hyperfide/dist/scheduler/claim.js';
const [organisation_id,run_id,task]=process.argv.slice(1),r=new ResourceContainer('control',process.env,new AbortController().signal),out={};
try{for(const milestone of ['QUALIFIED','INTEGRATED']){try{await r.gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:0},tx=>requireMilestone(tx,{organisation_id,run_id},task,milestone));out[milestone]='RELEASED'}catch(e){out[milestone]=e.code??String(e.message)}}}finally{await r.close?.()}
console.log(JSON.stringify(out));"""
        env={**f.auth.env};observed=json.loads(run(["node","--input-type=module","-e",program,f.auth.ids["organisation"],f.auth.ids["run"],U(610)],env=env).stdout.strip().splitlines()[-1])
        expect(observed=={"QUALIFIED":"RELEASED","INTEGRATED":"DEPENDENCY_NOT_INTEGRATED"},"Scheduler released an integration-dependent successor from isolated qualification: "+json.dumps(observed))
    check(IDS[TASK][12],successor_held)
    def level_status():
        prepare()
        report=status(U(701))
        names=[o["id"] for o in report["obligations"]]
        expect(names==["run_admits_integration","candidate_not_rejected","run_inputs","branch_authority","contributors","repository_set","reviews","gates","findings"],"Candidate obligations not individually reported: "+json.dumps(names))
        by={o["id"]:o for o in report["obligations"]}
        expect(by["candidate_not_rejected"]["status"]=="MET" and by["run_inputs"]["status"]=="MET" and by["branch_authority"]["status"]=="MET","Current candidate inputs misreported")
        expect(by["contributors"]["status"]=="UNMET" and by["reviews"]["status"]=="UNMET" and by["gates"]["status"]=="UNMET","Missing qualification/review evidence silently satisfied")
        expect(report["gates"][0]["outcome"]=="PASS" and report["verdict"]=="HELD" and report["candidate_qualified"] is False and report["unmet_obligations"],"A passing lower-level gate closed the candidate level: "+json.dumps(report)[:800])
        row=f.invoke(TASK,"integration.candidate.admit",{**SCOPE,"candidate_id":U(701)})
        expect(row.get("ok") is False and row["error"]["code"] in report["unmet_obligations"] and row["error"]["code"]!="INTEGRATION_INPUT_STALE","Admission disagreed with reported obligations: "+json.dumps(row)[:600])
        state["admit_before"]=row["error"]["code"]
    check(IDS[TASK][13],level_status)
    history_sql=["SELECT row_to_json(c)::text AS v FROM hyperfide.submission_custodies c ORDER BY id","SELECT json_build_object('id',id,'state',state,'custody',current_custody_id,'v',state_version)::text AS v FROM hyperfide.tasks WHERE id=ANY($1::uuid[]) ORDER BY id","SELECT row_to_json(r)::text AS v FROM hyperfide.integration_gate_receipts r ORDER BY attempt","SELECT row_to_json(j)::text AS v FROM hyperfide.integration_jobs j WHERE id=ANY($1::uuid[]) ORDER BY id","SELECT row_to_json(m)::text AS v FROM hyperfide.integration_candidate_manifests m ORDER BY candidate_id"]
    def history():return [[r["v"] for r in db(sql_text,[[U(610),U(611),U(740),U(741)]] if "$1" in sql_text else [])] for sql_text in history_sql]
    def input_changed():
        prepare()
        state["history"]=history()
        expect("admit_before" in state,"Pre-change admission was not observed")
        changed=sha("changed-dependency-policy")
        db("UPDATE hyperfide.runs SET policy_digest=$3,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[f.auth.ids["organisation"],f.auth.ids["run"],changed])
        row=f.invoke(TASK,"integration.candidate.admit",{**SCOPE,"candidate_id":U(701)})
        expect(row.get("ok") is False and row["error"]["code"]=="INTEGRATION_INPUT_STALE","Changed dependency input did not invalidate admission: "+json.dumps(row)[:600])
        report=status(U(701));by={o["id"]:o for o in report["obligations"]}
        expect(by["run_inputs"]["status"]=="UNMET" and by["run_inputs"]["code"]=="INTEGRATION_INPUT_STALE" and report["verdict"]=="HELD","Status did not invalidate the affected candidate")
        expect(db("SELECT state FROM hyperfide.integration_candidates WHERE id=$1",[U(701)])[0]["state"]=="PENDING","Stale candidate was admitted")
    check(IDS[TASK][14],input_changed)
    def history_intact():
        prepare()
        expect("history" in state,"History snapshot unavailable")
        after=history()
        expect(after==state["history"] and len(after[0])==2 and len(after[2])==2,"Historical isolated task or gate results changed")
        expect([r["qualification_outcome"] for r in db("SELECT qualification_outcome FROM hyperfide.submission_custodies ORDER BY id")]==["PASS","PASS"],"Isolated qualification history lost")
    check(IDS[TASK][15],history_intact)
    def leftovers():
        leftover=[]
        for directory in (f.repository,f.receive):
            ref="refs/hyperfide/integration/"+U(760 if directory==f.repository else 761)
            run(["git","--git-dir="+str(directory if directory==f.receive else directory/".git"),"update-ref",ref,f.base_oid]);leftover.append((directory,ref))
        bundle=f.base/("candidate-transfer-"+U(762)+".bundle");bundle.write_bytes(b"partial bundle");return leftover,bundle
    def refs_of(directory):return run(["git","--git-dir="+str(directory if directory==f.receive else directory/".git"),"for-each-ref","--format=%(refname)","refs/hyperfide/integration/"]).stdout.split()
    def cleanup_reconciles():
        prepare()
        leftover,bundle=leftovers()
        report=result(f.invoke(TASK,"integration.candidate.cleanup",SCOPE))
        expect(all(not refs_of(directory) for directory,_ in leftover) and sorted(d["ref"] for d in report["deleted_refs"])==sorted(r for _,r in leftover),"Leftover candidate refs not deleted: "+json.dumps(report)[:800])
        expect(not bundle.exists() and report["removed_paths"]==[str(bundle)],"Candidate transfer leftover not removed")
        reservations={r["id"]:r["state"] for r in db("SELECT id,state FROM hyperfide.reservations WHERE id=ANY($1::uuid[])",[[U(660),U(661),U(662),U(663)]])}
        expect(reservations=={U(660):"RELEASE_PENDING",U(661):"RELEASE_PENDING",U(662):"ALLOCATED",U(663):"ALLOCATED"} and sorted(r["reservation_id"] for r in report["released_reservations"])==[U(660),U(661)],"Terminal job reservations not released exactly: "+json.dumps(reservations))
        kinds={(d["kind"],d["resource"]) for d in report["debt"]}
        expect(report["complete"] is False and ("REMOTE_JOB_OUTCOME_UNKNOWN","integration_job:"+U(742)) in kinds and ("REMOTE_WORKSPACE_UNREACHABLE","/tmp/hyperfide/integration-"+U(750)) in kinds,"Unreachable abandoned remote work not reported as debt: "+json.dumps(report["debt"]))
        state["cleanup_debt"]=report["debt"]
    check(IDS[TASK][16],cleanup_reconciles)
    def cleanup_idempotent():
        prepare()
        expect("cleanup_debt" in state,"First cleanup unobserved")
        report=result(f.invoke(TASK,"integration.candidate.cleanup",SCOPE))
        expect(report["deleted_refs"]==[] and report["removed_paths"]==[] and report["released_reservations"]==[],"Repeated cleanup was not idempotent: "+json.dumps(report)[:800])
        expect(report["complete"] is False and report["debt"]==state["cleanup_debt"],"Repeated cleanup erased unresolved debt")
        expect(db("SELECT state FROM hyperfide.integration_jobs WHERE id=$1",[U(742)])[0]["state"]=="RUNNING","Cleanup fabricated an outcome for abandoned remote work")
    check(IDS[TASK][17],cleanup_idempotent)
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
    candidates=(ROOT/"services/hyperfide/dist/integration/candidates.js").as_uri()
    fault_source="import {GitHubPublicationAdapter,validateGitHubProtection} from "+json.dumps(github)+";import {canonical,hash} from "+json.dumps(candidates)+";"+r'''
import fs from 'node:fs/promises';import path from 'node:path';import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
const [repo,base,next,folder,mode]=process.argv.slice(1);await fs.mkdir(folder,{mode:0o700});const privateFile=async(name,data)=>{const p=path.join(folder,name);await fs.writeFile(p,data,{mode:0o600});return p;};
const rsa=generateKeyPairSync('rsa',{modulusLength:2048}),ed=generateKeyPairSync('ed25519');
const profile={owner:'fixture',repository:'repo',repository_numeric_id:1,app_id:9,installation_id:7,target_ref:'refs/heads/main',credential_directory:folder,app_private_key_file:await privateFile('app.pem',rsa.privateKey.export({type:'pkcs8',format:'pem'})),audit_token_file:await privateFile('audit.token','synthetic-unit-credential'),denial_signer_public_key_file:await privateFile('denial.pub',ed.publicKey.export({type:'spki',format:'pem'}))};
const repository={id:1,full_name:'fixture/repo'},rules=[{type:'update',ruleset_id:1},{type:'non_fast_forward',ruleset_id:2}],sets=[{id:1,enforcement:'active',target:'branch',bypass_actors:[{actor_type:'Integration',actor_id:9,bypass_mode:'always'}],rules:[{type:'update'}]},{id:2,enforcement:'active',target:'branch',bypass_actors:[],rules:[{type:'non_fast_forward'}]}];
profile.expected_rules_digest=validateGitHubProtection(profile,repository,rules,sets,null);
const now=Date.now(),receipt={provider:'GITHUB',repository_numeric_id:1,target_ref:profile.target_ref,rules_digest:profile.expected_rules_digest,worker_app_id:8,outcome:'DENIED',exit_code:1,command_digest:hash('synthetic-fixture-only'),before_head:base,after_head:base,observed_at:new Date(now-1000).toISOString(),expires_at:new Date(now+60000).toISOString()};
profile.denial_receipt_file=await privateFile('denial.json',JSON.stringify({receipt,signature:sign(null,Buffer.from(canonical(receipt)),ed.privateKey).toString('base64url')}));
const intent={organisation_id:'00000000-0000-4000-8000-000000000001',run_id:'00000000-0000-4000-8000-000000000005',operation_id:randomUUID(),operation_generation:'1',repository_id:'00000000-0000-4000-8000-000000000003',target_ref:profile.target_ref,expected_old_head:base,candidate_head:next,candidate_digest:hash('candidate')};
let minted=0,revoked=0;const credential=path.join(folder,intent.operation_id+'.json'),askpass=path.join(folder,intent.operation_id+'-askpass.cjs');
const transport=async(route,token,method='GET')=>{
 if(route==='/app')return {status:200,body:{id:9}};
 if(route==='/app/installations/7')return {status:200,body:{app_id:9,suspended_at:null}};
 if(route.endsWith('/access_tokens')){minted++;if(mode==='persist'||mode==='orphan')await fs.writeFile(credential,'occupied',{mode:0o600});if(mode==='askpass')await fs.writeFile(askpass,'occupied',{mode:0o700});return {status:201,body:{token:'synthetic-issued-token',...(mode==='invalid'?{}:{expires_at:new Date(Date.now()+3600000).toISOString(),permissions:{contents:'write'}})}};}
 if(route==='/installation/token'){revoked++;return {status:mode==='orphan'?503:204,body:{}};}
 if(route==='/repos/fixture/repo')return {status:200,body:repository};
 if(route.includes('/rules/branches/'))return {status:200,body:rules};
 if(route.includes('/rulesets/1?'))return {status:200,body:sets[0]};
 if(route.includes('/rulesets/2?'))return {status:200,body:sets[1]};
 if(route.endsWith('/protection'))return {status:404,body:{}};
 if(route.includes('/git/ref/'))return {status:200,body:{object:{sha:base}}};
 throw Error('Unexpected unit transport route');
};
if(mode==='preflight')await fs.writeFile(credential,'existing-custody',{mode:0o600});
const adapter=new GitHubPublicationAdapter(profile,{PATH:process.env.PATH},transport);
if(mode==='preflight'){let blocked=false;try{await adapter.publish(intent,repo)}catch(e){blocked=e.code==='GITHUB_CREDENTIAL_REPLAY_REQUIRES_RECONCILIATION'}if(!blocked||minted!==0)throw Error('Existing custody minted another token');}
else{const result=await adapter.publish(intent,repo);if(minted!==1||revoked<1||result.push_issued!==false||JSON.stringify(result).includes('synthetic-issued-token'))throw Error('Post-mint failure escaped cleanup or exposed token');if(mode==='orphan'){if(result.outcome!=='UNKNOWN'||result.credential_revocation!=='UNKNOWN'||result.credential_custody!=='ORPHANED'||!result.credential_expires_at)throw Error('Orphan authority promoted');}else if(result.outcome!=='REJECTED'||result.credential_revocation!=='CONFIRMED')throw Error('Unsent token was not independently revoked');}
'''
    sentinel=f.base/"client-hook-ran"
    hook=f.repository/".git/hooks/pre-push";hook.write_text("#!/bin/sh\ntouch '"+str(sentinel)+"'\n");hook.chmod(0o700)
    transport_sentinel=f.base/"source-url-transport-ran"
    rewrite="ext::sh -c 'touch "+str(transport_sentinel)+"; exit 1'"
    run(["git","-C",str(f.repository),"config","protocol.ext.allow","always"])
    run(["git","-C",str(f.repository),"config","url."+rewrite+".insteadOf",str(f.receive)])
    probe=node("import {pushManaged} from "+json.dumps(module)+";try{await pushManaged(process.argv[1],process.argv[2],'refs/heads/main',process.argv[3],process.argv[4],'invalid-test-permit',process.env);throw Error('unsigned push unexpectedly succeeded')}catch(e){if(!String(e.stderr??'').includes('gateway rejected'))throw e;console.log('server-hook-rejected')}",[f.repository,f.receive,f.feature_oid,f.base_oid])
    check(IDS[TASK][13],lambda:expect(not sentinel.exists(),"Product managed publication executed an untrusted client pre-push hook"))
    check(IDS[TASK][14],lambda:expect("server-hook-rejected" in probe.stdout and run(["git","--git-dir="+str(f.receive),"rev-parse","refs/heads/main"]).stdout.strip()==f.base_oid,"Suppressing client hooks disabled server enforcement or mutated target"))

    check(IDS[TASK][19],lambda:expect(not transport_sentinel.exists() and "server-hook-rejected" in probe.stdout,"Source-owned URL rewrite redirected managed publication"))
    def https_isolated():
        run(["git","-C",str(f.repository),"config","url."+rewrite+".insteadOf","https://127.0.0.1:1/fixture"])
        source="import {isolatedPush} from "+json.dumps(candidates)+";let refused=false;try{await isolatedPush(process.argv[1],['https://127.0.0.1:1/fixture',process.argv[2]+':refs/heads/main'],process.env,'https')}catch(e){refused=true;if(String(e.stderr??'').includes('ext::'))throw Error('Source rewrite escaped isolation')}if(!refused)throw Error('Unexpected HTTPS connection');"
        node(source,[f.repository,f.feature_oid])
        expect(not transport_sentinel.exists(),"Source config redirected HTTPS transport")
    check(IDS[TASK][20],https_isolated)
    for index,mode in [(15,"persist"),(16,"askpass"),(17,"orphan"),(18,"preflight"),(21,"invalid")]:
        check(IDS[TASK][index],lambda mode=mode:node(fault_source,[f.repository,f.base_oid,f.feature_oid,f.base/("github-fault-"+mode),mode]))

def closure_uuid():return str(__import__("uuid").uuid4())
def closure_digest(label):return "sha256:"+hashlib.sha256(label.encode()).hexdigest()
def closure_seed(f):
    """Seed one actual wave-1 task with qualified custody and wave-2 dependents bound at declared milestones."""
    a=f.auth;org,run,spec=a.ids["organisation"],a.ids["run"],a.ids["spec"];x={k:closure_uuid() for k in ["repository","package1","package2","task","dependent_q","dependent_i","attempt","custody","branch","candidate","intent","publication","package_owner","finding","account","reservation","job"]}
    crit=closure_digest("closure-criteria");x["criteria"]=crit
    a.sql("INSERT INTO hyperfide.repositories(organisation_id,id,project_id,name,url) VALUES($1,$2,$3,'closure-fixture','https://example.invalid/closure.git')",[org,x["repository"],a.ids["project"]])
    a.sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES($1,$2,$3),($1,$2,$4)",[org,x["repository"],f.base_oid,f.feature_oid])
    a.sql("INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES($1,$2,$3,$4,'refs/heads/main')",[org,run,x["repository"],f.base_oid])
    for key,wave in (("package1",1),("package2",2)):a.sql("INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES($1,$2,$3,$4,$5)",[org,run,x[key],"closure-"+key,wave])
    for key,name,package,wave in (("task","closure.alpha","package1",1),("dependent_q","closure.after-qualified","package2",2),("dependent_i","closure.after-integrated","package2",2)):
        a.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,spec_generation,criteria_digest,definition,wave) VALUES($1,$2,$3,$4,$5,$6,1,$7,'{}',$8)",[org,run,x[key],name,x[package],spec,crit,wave])
    a.sql("INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,compute_authority,execution_state) VALUES($1,$2,$3,$4,1,$5,$6,'RELEASED','SUBMITTED')",[org,run,x["attempt"],x["task"],a.ids["epoch"],closure_digest("closure-packet")])
    a.sql("INSERT INTO hyperfide.submission_custodies(organisation_id,run_id,id,task_id,source_attempt_id,source_generation,custody_generation,authority_epoch,repository_id,source_object_id,source_manifest_digest,evidence_manifest_digest,criteria_digest,qualification_outcome) VALUES($1,$2,$3,$4,$5,1,1,$6,$7,$8,$9,$10,$11,'PASS')",[org,run,x["custody"],x["task"],x["attempt"],a.ids["epoch"],x["repository"],f.feature_oid,closure_digest("closure-source"),closure_digest("closure-evidence"),crit])
    a.sql("UPDATE hyperfide.tasks SET current_custody_id=$3,state='QUALIFIED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$4",[org,run,x["custody"],x["task"]])
    a.sql("INSERT INTO hyperfide.task_dependencies(organisation_id,run_id,task_id,predecessor_run_id,predecessor_task_id,milestone,revision,binding_schema_version,predecessor_spec_generation,predecessor_spec_revision_id,predecessor_repository_id,integration_ref) VALUES($1,$2,$3,$2,$4,'QUALIFIED',1,1,1,$5,NULL,NULL),($1,$2,$6,$2,$4,'INTEGRATED',1,1,1,$5,$7,'refs/heads/main')",[org,run,x["dependent_q"],x["task"],spec,x["dependent_i"],x["repository"]])
    return x
def closure_publish(f,x):
    """Record the actual published candidate of the qualified custody (19.2 publication rows), without acceptance."""
    a=f.auth;org,run=a.ids["organisation"],a.ids["run"]
    a.sql("INSERT INTO hyperfide.branch_authorities(organisation_id,run_id,id,repository_id,branch_ref,branch_generation,authority_epoch,expected_old_head) VALUES($1,$2,$3,$4,'refs/heads/main',1,$5,$6)",[org,run,x["branch"],x["repository"],a.ids["epoch"],f.base_oid])
    manifest={"version":1,"repository_id":x["repository"],"target_ref":"refs/heads/main","candidate_head":f.feature_oid,"expected_old_head":f.base_oid,"contributors":[{"task_id":x["task"],"custody_id":x["custody"],"custody_generation":"1","criteria_digest":x["criteria"]}]}
    a.sql("INSERT INTO hyperfide.integration_candidates(organisation_id,run_id,id,task_id,custody_id,custody_generation,repository_id,branch_authority_id,branch_generation,expected_old_head,candidate_head,input_manifest_digest,request_id,state) VALUES($1,$2,$3,$4,$5,1,$6,$7,1,$8,$9,$10,$11,'PUBLISHED')",[org,run,x["candidate"],x["task"],x["custody"],x["repository"],x["branch"],f.base_oid,f.feature_oid,closure_digest(json.dumps(manifest,sort_keys=True)),closure_uuid()])
    a.sql("INSERT INTO hyperfide.integration_candidate_manifests(organisation_id,run_id,candidate_id,manifest) VALUES($1,$2,$3,$4::jsonb)",[org,run,x["candidate"],json.dumps(manifest)])
    a.sql("INSERT INTO hyperfide.publication_intents(organisation_id,run_id,id,candidate_id,intent_digest) VALUES($1,$2,$3,$4,$5)",[org,run,x["intent"],x["candidate"],closure_digest("closure-intent")])
    a.sql("INSERT INTO hyperfide.publication_operations(organisation_id,run_id,id,publication_intent_id,candidate_id,branch_authority_id,branch_generation,authority_epoch,repository_id,expected_old_head,candidate_head,request_id,state,observed_head) VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,$11,'PUBLISHED',$10)",[org,run,x["publication"],x["intent"],x["candidate"],x["branch"],a.ids["epoch"],x["repository"],f.base_oid,f.feature_oid,closure_uuid()])
    a.sql("UPDATE hyperfide.tasks SET state='INTEGRATING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,x["task"]])
def closure_accept(f,x):
    """Mirror the 19.2 accept writes: release custody, mark INTEGRATED and persist the ACCEPTED receipt."""
    a=f.auth;org,run=a.ids["organisation"],a.ids["run"]
    a.sql("UPDATE hyperfide.submission_custodies SET authority='RELEASED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,x["custody"]])
    a.sql("UPDATE hyperfide.tasks SET state='INTEGRATED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,x["task"]])
    a.sql("INSERT INTO hyperfide.publication_acceptance_receipts(organisation_id,run_id,id,operation_id,outcome,reasons,manifest) VALUES($1,$2,$3,$4,'ACCEPTED',ARRAY[]::text[],'{}'::jsonb)",[org,run,closure_uuid(),x["publication"]])
def closure_open_finding(f,x):
    a=f.auth;org,run=a.ids["organisation"],a.ids["run"]
    a.sql("INSERT INTO hyperfide.findings(organisation_id,run_id,id,dedup_digest,owner_package_id,repository_id,source_object_id,severity,summary) VALUES($1,$2,$3,$4,$5,$6,$7,'CRITICAL','Open blocking closure finding')",[org,run,x["finding"],closure_digest("closure-finding"),x["package1"],x["repository"],f.feature_oid])
def closure_expire_lease(f,x):
    a=f.auth;a.sql("UPDATE hyperfide.attempts SET compute_authority='EXPIRED',lease_expires_at=clock_timestamp()-interval '1 hour',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[a.ids["organisation"],a.ids["run"],x["attempt"]])
def closure_programme_receipt(f,x,gate,covered,digest):
    """Seed one succeeded PROGRAMME scope job receipt (bounded synthetic stand-in for an executed full-case gate)."""
    a=f.auth;org,run=a.ids["organisation"],a.ids["run"]
    if "account_seeded" not in x:
        a.sql("INSERT INTO hyperfide.capacity_accounts(organisation_id,id,pool_id,dimension,capacity_class,configured_limit,reserved,provenance_digest,qualification_state) VALUES($1,$2,$3,'CPU_MILLIS','EXECUTION',100,1,$4,'QUALIFIED')",[org,x["account"],a.ids["pool"],closure_digest("closure-capacity")])
        a.sql("INSERT INTO hyperfide.reservations(organisation_id,run_id,id,request_id,capacity_account_id,quantity,expires_at) VALUES($1,$2,$3,$4,$5,1,clock_timestamp()+interval '1 hour')",[org,run,x["reservation"],closure_uuid(),x["account"]]);x["account_seeded"]=True
    job=closure_uuid()
    a.sql("INSERT INTO hyperfide.integration_scope_jobs(organisation_id,run_id,id,executor_id,reservation_id,level,wave,input_manifest_digest,state) VALUES($1,$2,$3,$4,$5,'PROGRAMME',NULL,$6,'SUCCEEDED')",[org,run,job,closure_uuid(),x["reservation"],digest])
    a.sql("INSERT INTO hyperfide.integration_scope_receipts(organisation_id,run_id,id,level,wave,input_manifest_digest,manifest,gate_id,covered_ids,outcome,exit_code,assertion_count,stdout,stderr,job_id) VALUES($1,$2,$3,'PROGRAMME',NULL,$4,'{}'::jsonb,$5,$6::text[],'PASS',0,1,'','',$7)",[org,run,closure_uuid(),digest,gate,covered,job])
def closure_policy_file(f):
    """Specify programme end-to-end and activation/rehearsal obligations in the trusted closure policy before first use."""
    policy=json.loads(json.dumps(f.cfg["closure"]))
    rehearsal={**f.gate,"id":"activation-rehearsal","covers":["V-055"],"proof":{**f.gate["proof"],"case_ids":["V-055"]}}
    policy["programme_gates"].append(rehearsal);policy["end_to_end_ids"]=["V-034"];policy["activation_rehearsal_ids"]=["V-055"]
    current=json.loads(f.config.read_text());current["closure"]=policy;f.config.write_text(json.dumps(current))
    return {**f.cfg,"closure":policy}
def closure_evaluate(f,**scope):
    row=f.invoke(TASK,"integration.closure.evaluate",{**SCOPE,**scope})
    expect(row.get("ok") is True,"Closure evaluation refused: "+json.dumps(row)[:600])
    return row.get("result",row.get("output",{}))
def closure_unmet(result):return set(result["status"]["unmet_obligations"])
def closure_release(result,key):return [d for d in result["dependency_release"] if d["task_key"]==key]
def closure_cases(f):
    specified=closure_policy_file(f)
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
    def mismatch():
        wrong=json.loads(json.dumps(f.cfg));wrong["closure"]["programme_gates"][0]["covers"]=["V-033"]
        node("import {closurePolicy} from "+json.dumps(module)+";let denied=false;try{closurePolicy(JSON.parse(process.argv[1]))}catch(e){denied=e.code==='CLOSURE_POLICY_INVALID'}if(!denied)throw Error('Unrelated registered full case claimed coverage');",[json.dumps(wrong)])
    check(IDS[TASK][8],mismatch)
    check(IDS[TASK][9],lambda:node("import {closurePolicy} from "+json.dumps(module)+";closurePolicy(JSON.parse(process.argv[1]));",[json.dumps(f.cfg)]))
    def programme_cases_registered():
        accepted=node("import {closurePolicy} from "+json.dumps(module)+";const p=closurePolicy(JSON.parse(process.argv[1]));console.log(JSON.stringify(p));",[json.dumps(specified)])
        expect(json.loads(accepted.stdout)["activation_rehearsal_ids"]==["V-055"],"Specified rehearsal obligation dropped")
        wrong=json.loads(json.dumps(specified));wrong["closure"]["activation_rehearsal_ids"]=["V-019"]
        node("import {closurePolicy} from "+json.dumps(module)+";let denied=false;try{closurePolicy(JSON.parse(process.argv[1]))}catch(e){denied=e.code==='CLOSURE_POLICY_INVALID'}if(!denied)throw Error('Unregistered rehearsal obligation accepted');",[json.dumps(wrong)])
    check(IDS[TASK][10],programme_cases_registered)
    state={}
    def qualified_only():
        state["x"]=x=closure_seed(f)
        result=closure_evaluate(f,level="WAVE",wave=1);state["qualified"]=result
        expect([d["released"] for d in closure_release(result,"closure.after-qualified")]==[True],"QUALIFIED-milestone dependent not released by current qualified custody")
        expect([(d["released"],d["code"]) for d in closure_release(result,"closure.after-integrated")]==[(False,"DEPENDENCY_NOT_INTEGRATED")],"Isolated task qualification released an INTEGRATED-milestone dependent")
    check(IDS[TASK][11],qualified_only)
    def lease_expiry():
        x=state["x"];before=closure_evaluate(f,level="TASK",task_id=x["task"]);closure_expire_lease(f,x)
        after=closure_evaluate(f,level="TASK",task_id=x["task"])
        expect([(o["id"],o["met"],o.get("detail")) for o in before["obligations"]]==[(o["id"],o["met"],o.get("detail")) for o in after["obligations"]],"Coding lease expiry changed task qualification")
        expect(after["task_statuses"][0]["milestone"]=="QUALIFIED" and [d["released"] for d in closure_release(after,"closure.after-qualified")]==[True],"Coding lease expiry invalidated admitted qualified work")
    check(IDS[TASK][12],lease_expiry)
    def competing_custody():
        x=state["x"];a=f.auth;org,run=a.ids["organisation"],a.ids["run"];attempt=closure_uuid()
        a.sql("INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,compute_authority,execution_state) VALUES($1,$2,$3,$4,2,$5,$6,'RELEASED','SUBMITTED')",[org,run,attempt,x["task"],a.ids["epoch"],closure_digest("closure-replacement")])
        refused=False
        try:a.sql("INSERT INTO hyperfide.submission_custodies(organisation_id,run_id,id,task_id,source_attempt_id,source_generation,custody_generation,authority_epoch,repository_id,source_object_id,source_manifest_digest,evidence_manifest_digest,criteria_digest,qualification_outcome) VALUES($1,$2,$3,$4,$5,2,2,$6,$7,$8,$9,$10,$11,'PASS')",[org,run,closure_uuid(),x["task"],attempt,a.ids["epoch"],x["repository"],f.feature_oid,closure_digest("other-source"),closure_digest("other-evidence"),x["criteria"]])
        except AssertionError:refused=True
        expect(refused,"Competing replacement custody admitted beside the admitted one")
        result=closure_evaluate(f,level="TASK",task_id=x["task"])
        expect([o.get("detail") for o in result["obligations"] if o["id"]=="task.current-custody:closure.alpha"]==[{"custody_id":x["custody"]}],"Task qualification not computed from the admitted current custody")
    check(IDS[TASK][13],competing_custody)
    def without_acceptance():
        x=state["x"];closure_publish(f,x);result=closure_evaluate(f,level="WAVE",wave=1);state["published"]=result
        unmet=closure_unmet(result)
        expect(result["outcome"]=="HELD" and result["wave_closed"] is False and "wave.accepted-candidate:closure.alpha" in unmet and "wave.integration-receipt:closure.alpha" not in unmet,"Published but unaccepted candidate closed or mislabelled the wave")
        expect([(d["released"],d["code"]) for d in closure_release(result,"closure.after-integrated")]==[(False,"DEPENDENCY_NOT_INTEGRATED")],"Unaccepted publication released an INTEGRATED-milestone dependent")
    check(IDS[TASK][14],without_acceptance)
    def accepted():
        x=state["x"];closure_accept(f,x);result=closure_evaluate(f,level="WAVE",wave=1);state["accepted"]=result
        expect([d["released"] for d in closure_release(result,"closure.after-integrated")]==[True],"Declared INTEGRATED milestone reached but dependent withheld")
    check(IDS[TASK][15],accepted)
    def held_despite_tasks():
        result=state["accepted"];unmet=closure_unmet(result)
        expect(all(t["milestone"]=="INTEGRATED" for t in result["task_statuses"]) and result["status"]["lower_levels_complete"] is True,"Fixture tasks did not all pass")
        expect(result["outcome"]=="HELD" and result["wave_closed"] is False,"Passing tasks silently closed the wave")
        expect({"wave.criteria-current:closure.alpha","wave.gate:actual-test"}<=unmet and any(u.startswith("wave.reviews-current:") for u in unmet) and not any(u.startswith("wave.accepted-candidate:") for u in unmet),"Wave did not list its own unmet criteria/review/gate obligations")
    check(IDS[TASK][16],held_despite_tasks)
    def blocking_finding():
        x=state["x"];before=closure_unmet(state["accepted"]);closure_open_finding(f,x)
        result=closure_evaluate(f,level="WAVE",wave=1);state["finding"]=result;key="wave.blocking-findings:"+x["repository"]
        expect(key not in before and key in closure_unmet(result),"Open blocking finding did not hold the wave")
        detail=[o for o in result["unmet_obligations"] if o["id"]==key][0]
        expect(detail["reason"]=="BLOCKING_FINDING_OPEN:"+x["repository"] and x["finding"] in [b["finding_id"] for b in detail["detail"]],"Open blocking finding not listed")
    check(IDS[TASK][17],blocking_finding)
    def withheld():
        for name in ("qualified","published","accepted","finding"):
            result=state[name]
            expect(result["downstream_release_authorized"] is False and result["external_activation_authorized"] is False and result["programme_qualified"] is False,"Held wave authorized downstream or activation release: "+name)
    check(IDS[TASK][18],withheld)
    def own_status():
        x=state["x"];task=closure_evaluate(f,level="TASK",task_id=x["task"]);wave=closure_evaluate(f,level="WAVE",wave=1);programme=closure_evaluate(f,level="PROGRAMME");state["programme"]=programme
        for level,prefix,result in (("TASK","task.",task),("WAVE","wave.",wave),("PROGRAMME","programme.",programme)):
            expect(result["status"]["level"]==level and result["status"]["closes_higher_levels"] is False and all(o["level"]==level and o["id"].startswith(prefix) for o in result["obligations"]),"Level did not report its own obligations: "+level)
            row=f.invoke(TASK,"integration.closure.inspect",{**SCOPE,"evaluation_id":result["evaluation_id"]});stored=row.get("result",row.get("output",{}))
            expect(row.get("ok") is True and stored["level"]==level and stored["outcome"]==result["outcome"] and stored["manifest"]["status"]["unmet_obligations"]==result["status"]["unmet_obligations"],"Persisted evaluation lost its own level status")
        expect([o["met"] for o in task["obligations"] if o["id"] in ("task.integration-receipt:closure.alpha","task.accepted-candidate:closure.alpha")]==[True,True],"Task-level integration receipts not reported")
        expect(wave["outcome"]=="HELD" and programme["outcome"]=="HELD" and programme["wave_closed"] is False,"Higher level closed")
    check(IDS[TASK][19],own_status)
    def requires_programme_cases():
        result=state["programme"];unmet=closure_unmet(result)
        expect({"programme.end-to-end:V-034","programme.activation-rehearsal:V-055"}<=unmet and not {"programme.end-to-end-specified","programme.activation-rehearsal-specified"}&unmet,"Programme closure did not require specified end-to-end/rehearsal obligations")
        expect(not any(o["id"].startswith(("programme.end-to-end","programme.activation-rehearsal")) for o in state["finding"]["obligations"]),"Wave closure claimed programme obligations")
    check(IDS[TASK][20],requires_programme_cases)
    def programme_cases_current():
        x=state["x"];digest=state["programme"]["input_manifest_digest"]
        closure_programme_receipt(f,x,"actual-test",["V-034"],"sha256:"+"e"*64)
        stale=closure_evaluate(f,level="PROGRAMME")
        expect(stale["input_manifest_digest"]==digest and "programme.end-to-end:V-034" in closure_unmet(stale),"Stale end-to-end receipt satisfied programme closure")
        closure_programme_receipt(f,x,"actual-test",["V-034"],digest);closure_programme_receipt(f,x,"activation-rehearsal",["V-055"],digest)
        result=closure_evaluate(f,level="PROGRAMME");met={o["id"] for o in result["obligations"] if o["met"]}
        expect(result["input_manifest_digest"]==digest and {"programme.end-to-end:V-034","programme.activation-rehearsal:V-055","programme.gate:actual-test","programme.gate:activation-rehearsal"}<=met,"Current end-to-end/rehearsal receipts not recognised")
        expect(result["outcome"]=="HELD" and result["programme_qualified"] is False and result["external_activation_authorized"] is False,"Programme closed while other obligations remain unmet")
        state["programme"]=result
    check(IDS[TASK][21],programme_cases_current)
    def each_wave():
        x=state["x"];result=state["programme"];waves={w["wave"]:w for w in result["wave_statuses"]}
        expect(sorted(waves)==[1,2] and not any(w["closed"] for w in waves.values()) and {"programme.wave-closed:1","programme.wave-closed:2"}<=closure_unmet(result),"Programme did not require each wave's own closure")
        a=f.auth
        # Synthetic lower-level PASS seed: only wave 1's own current evaluation; it must not close the programme.
        a.sql("INSERT INTO hyperfide.integration_closure_evaluations(organisation_id,run_id,id,level,wave,input_manifest_digest,outcome,manifest) VALUES($1,$2,$3,'WAVE',1,$4,'PASS','{}'::jsonb)",[a.ids["organisation"],a.ids["run"],closure_uuid(),waves[1]["input_manifest_digest"]])
        after=closure_evaluate(f,level="PROGRAMME");unmet=closure_unmet(after)
        expect("programme.wave-closed:1" not in unmet and "programme.wave-closed:2" in unmet and after["outcome"]=="HELD" and after["programme_qualified"] is False,"Closed lower wave silently closed the programme")
    check(IDS[TASK][22],each_wave)
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
    try:
        bootstrap()
        with tempfile.TemporaryDirectory(prefix="hf-domain19-",dir="/tmp/hyperfide") as directory:
            fixture=Fixture(Path(directory))
            try:{"19.1":candidate_cases,"19.2":publication_cases,"19.3":closure_cases,"19.4":release_cases}[TASK](fixture)
            finally:fixture.close()
        return 1 if FAILED else 0
    finally:cleanup(emit=False)
if __name__=="__main__":raise SystemExit(main())
