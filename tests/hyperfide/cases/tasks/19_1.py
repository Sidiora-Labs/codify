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
TASK=os.environ.get("HYPERFIDE_INTEGRATION_TEST_TASK","19.1")
DATABASE="hf_integration_"+TASK.replace(".","_")
FAILED=[]
U=lambda n:f"00000000-0000-4000-8000-{n:012x}"
SCOPE={"organisation_id":U(1),"run_id":U(5)}
D="sha256:"+"c"*64
IDS={
"19.1":["candidate.registered-wire","candidate.strict-input","candidate.scope-denied","candidate.real-merge","candidate.deterministic-objects","candidate.conflict-refused","candidate.typed-generations","candidate.immutable-request","candidate.empty-targets-refused"],
"19.2":["publication.registered-wire","publication.strict-input","publication.role-denied","publication.unsigned-push-denied","publication.target-unchanged","publication.immutable-admission","publication.target-lock-exclusive","publication.effective-hook-path-pinned","publication.github-configured-boundary","publication.github-sole-publisher","publication.github-worker-bypass-refused","publication.github-force-bypass-refused","publication.github-unknown-bypass-refused","publication.client-hook-suppressed","publication.server-hook-still-enforced","publication.token-persist-failure-revokes","publication.askpass-failure-revokes","publication.orphan-remains-unknown","publication.custody-preflight-no-mint","publication.source-url-rewrite-isolated","publication.https-source-config-isolated","publication.invalid-token-response-revokes"],
"19.3":["closure.registered-wire","closure.level-required","closure.wave-required","closure.programme-cannot-narrow","closure.policy-requires-gates","closure.policy-requires-acceptance","closure.evaluation-immutable","closure.unregistered-assertions-refused","closure.declared-coverage-bound","closure.policy-valid-shape"],
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
        authabsent=proof.get("observed_absent") is True and isinstance(proof.get("database"),str) and re.fullmatch(r"hf_integration_identity_[a-z0-9_]{1,55}",proof["database"]) is not None and not sql("SELECT datname FROM pg_database WHERE datname='"+proof["database"]+"'",database="postgres").stdout.strip()
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
                policy=json.loads(real.policy.read_text());policy["allowed_actions"].append("system.describe");real.policy.write_text(json.dumps(policy))
                identity=json.loads(real.identity_config.read_text())
                for principal in identity["principals"]:principal["allowed_actions"].append("system.describe")
                real.identity_config.write_text(json.dumps(identity))
            self.auth=IdentityFixture(database=self.auth_database,components=sorted(fragment_paths[name].stem for name in needed),extra_env={k:v for k,v in self.env.items() if k.startswith('HYPERFIDE_INTEGRATION_') or k.startswith('HYPERFIDE_GATEWAY_')},extra_setup=setup)
        except Exception as error:self.auth_error=str(error)
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
    def mismatch():
        wrong=json.loads(json.dumps(f.cfg));wrong["closure"]["programme_gates"][0]["covers"]=["V-033"]
        node("import {closurePolicy} from "+json.dumps(module)+";let denied=false;try{closurePolicy(JSON.parse(process.argv[1]))}catch(e){denied=e.code==='CLOSURE_POLICY_INVALID'}if(!denied)throw Error('Unrelated registered full case claimed coverage');",[json.dumps(wrong)])
    check(IDS[TASK][8],mismatch)
    check(IDS[TASK][9],lambda:node("import {closurePolicy} from "+json.dumps(module)+";closurePolicy(JSON.parse(process.argv[1]));",[json.dumps(f.cfg)]))
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
    finally:cleanup()
if __name__=="__main__":raise SystemExit(main())
