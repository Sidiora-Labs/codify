#!/usr/bin/env python3
"""Actual hierarchy component/PG tests through a registered diagnostic JSONL adapter.
The adapter supplies a trusted fixture principal and a real primary SQL guard.
It does not qualify public network authentication or native process continuity.
"""
from __future__ import annotations
import concurrent.futures, hashlib, json, os, subprocess, sys, tempfile
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit
ROOT=Path(__file__).resolve().parents[4]
DATABASE="hf_task_3_1_qualification"
RESOURCE="hf-task-3.1-database"
ORG="10000000-0000-0000-0000-000000000001"
RUN="20000000-0000-0000-0000-000000000001"
EPOCH="40000000-0000-0000-0000-000000000001"
DIGEST="sha256:"+"a"*64
OID="a"*40
def uid(n):return f"30000000-0000-0000-0000-{n:012d}"
FAILED=[];OBS=[];COUNTER=0
def expect(value,message):
 if not value:raise AssertionError(message)
def check(identity,fn):
 try:fn();actual="observed"
 except Exception as error:FAILED.append(identity);actual=type(error).__name__+": "+str(error)
 print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
def env(database=None):
 result=os.environ.copy();database=database or DATABASE
 result["PGDATABASE"]=database
 parsed=urlsplit(result["DATABASE_URL"])
 result["DATABASE_URL"]=urlunsplit((parsed.scheme,parsed.netloc,"/"+database,parsed.query,parsed.fragment))
 result["HYPERFIDE_CONTROL_PRIMARY_DATABASE_URL"]=result["DATABASE_URL"]
 return result
def sql(command,allow_error=False,database=None):
 result=subprocess.run(["psql","-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-d",database or DATABASE],
  input=command,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=ROOT,env=env(database),timeout=30)
 if not allow_error:expect(result.returncode==0,"SQL fixture operation failed: "+result.stderr[:300])
 return result
def rows(command):return [json.loads(line) for line in sql(command).stdout.splitlines() if line.strip()]
def observation_dir():
 p=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR",f"/tmp/hyperfide/task-{DATABASE}"))/"hierarchy";p.mkdir(parents=True,exist_ok=True);return p
def cleanup():
 try:
  sql('DROP DATABASE IF EXISTS "'+DATABASE+'" WITH (FORCE);',database="postgres")
  absent=sql("SELECT count(*) FROM pg_database WHERE datname='"+DATABASE+"';",database="postgres").stdout.strip()=="0"
  (observation_dir()/"database-absence.json").write_text(json.dumps({"database":DATABASE,"observed_absent":absent,"observer":"PostgreSQL pg_database after DROP DATABASE"})+"\n")
  print(json.dumps({"type":"cleanup","complete":absent,"resources":[{"id":RESOURCE,"status":"deleted" if absent else "unknown","observed_absent":absent,"evidence_artifact":"hierarchy/database-absence.json"}]}),flush=True)
  return 0 if absent else 1
 except Exception:
  print(json.dumps({"type":"cleanup","complete":False,"resources":[{"id":RESOURCE,"status":"unknown"}]}),flush=True);return 1
def seed():
 sql('DROP DATABASE IF EXISTS "'+DATABASE+'" WITH (FORCE);',database="postgres")
 sql('CREATE DATABASE "'+DATABASE+'";',database="postgres")
 for version,name in [(1,"0001-authority"),(3,"0003-hierarchy")]:
  data=(ROOT/"services/hyperfide/migrations"/(name+".sql")).read_bytes()
  sql("BEGIN;\n"+data.decode()+"\nINSERT INTO hyperfide.schema_migrations(version,name,checksum) VALUES("+str(version)+",'"+name+"','sha256:"+hashlib.sha256(data).hexdigest()+"');\nCOMMIT;")
 sql(f"""
 INSERT INTO hyperfide.organisations(id,name) VALUES('{ORG}','hierarchy-fixture');
 INSERT INTO hyperfide.projects(organisation_id,id,name) VALUES('{ORG}','{uid(1)}','fixture-project');
 INSERT INTO hyperfide.repositories(organisation_id,id,project_id,name,url) VALUES('{ORG}','{uid(2)}','{uid(1)}','fixture','https://example.invalid/fixture.git');
 INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES('{ORG}','{uid(2)}','{OID}');
 INSERT INTO hyperfide.spec_revisions(organisation_id,id,project_id,source_digest,source_content,document,schema_version)
 VALUES('{ORG}','{uid(3)}','{uid(1)}','sha256:'||encode(sha256(convert_to('fixture','UTF8')),'hex'),'fixture','{{"meta":{{"slug":"fixture"}}}}',1);
 INSERT INTO hyperfide.runs(organisation_id,id,project_id,spec_revision_id,policy_digest,authority_epoch,state)
 VALUES('{ORG}','{RUN}','{uid(1)}','{uid(3)}','{DIGEST}','{EPOCH}','RUNNING');
 INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref)
 VALUES('{ORG}','{RUN}','{uid(2)}','{OID}','refs/heads/main');
 INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave)
 VALUES('{ORG}','{RUN}','{uid(10)}','feature:alpha:wave:1',1),('{ORG}','{RUN}','{uid(11)}','feature:alpha:wave:2',2),('{ORG}','{RUN}','{uid(12)}','feature:beta:wave:1',1);
 INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave)
 VALUES('{ORG}','{RUN}','{uid(20)}','alpha.1','{uid(10)}','{uid(3)}','{DIGEST}','{{"feature_key":"alpha","purpose":"Keep mandatory intent","touches":["src/a.c"]}}',1),
 ('{ORG}','{RUN}','{uid(21)}','alpha.2','{uid(11)}','{uid(3)}','{DIGEST}','{{"feature_key":"alpha"}}',2);
 INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id)
 VALUES('{ORG}','{RUN}','{uid(30)}','LEADER','diagnostic','fixture','leader-one'),
 ('{ORG}','{RUN}','{uid(31)}','LEADER','diagnostic','fixture','leader-two'),
 ('{ORG}','{RUN}','{uid(32)}','FEATURE_MANAGER','diagnostic','fixture','manager-one'),
 ('{ORG}','{RUN}','{uid(33)}','FEATURE_MANAGER','diagnostic','fixture','manager-two');
 INSERT INTO hyperfide.provider_pools(organisation_id,id,provider,account_key,environment_key,region)
 VALUES('{ORG}','{uid(40)}','fixture','fixture','fixture','fixture');
 INSERT INTO hyperfide.sandboxes(organisation_id,id,pool_id,native_sandbox_id,observed_state)
 VALUES('{ORG}','{uid(41)}','{uid(40)}','fixture-sandbox','RUNNING');
 INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind)
 VALUES('{ORG}','{uid(42)}','{uid(41)}','worker',1,'AGENT');
 INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,execution_state,compute_authority,sandbox_id,slot_id,sandbox_boot_generation,lease_expires_at)
 VALUES('{ORG}','{RUN}','{uid(43)}','{uid(20)}',1,'{EPOCH}','{DIGEST}','RUNNING','CURRENT','{uid(41)}','{uid(42)}',1,clock_timestamp()+interval '1 hour');
 UPDATE hyperfide.tasks SET generation=1,current_attempt_id='{uid(43)}',state='RUNNING',state_version=state_version+1 WHERE organisation_id='{ORG}' AND run_id='{RUN}' AND id='{uid(20)}';
 INSERT INTO hyperfide.compute_leases(organisation_id,run_id,id,attempt_id,attempt_generation,authority_epoch,sandbox_boot_generation,expires_at)
 VALUES('{ORG}','{RUN}','{uid(44)}','{uid(43)}',1,'{EPOCH}',1,clock_timestamp()+interval '1 hour');
 INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,parent_session_id,connector,account_key,native_session_id,slot_id,sandbox_id,sandbox_boot_generation,attempt_id,state)
 VALUES('{ORG}','{RUN}','{uid(34)}','WORKER','{uid(32)}','diagnostic','fixture','worker-one','{uid(42)}','{uid(41)}',1,'{uid(43)}','RUNNING');
 INSERT INTO hyperfide.findings(organisation_id,run_id,id,dedup_digest,owner_package_id,repository_id,source_object_id,severity,summary)
 VALUES('{ORG}','{RUN}','{uid(45)}','{DIGEST}','{uid(10)}','{uid(2)}','{OID}','ERROR','Persistent finding owned by the package');
 CREATE TABLE public.hf_hierarchy_diagnostic_credentials(session_id uuid PRIMARY KEY,active boolean NOT NULL);
 INSERT INTO public.hf_hierarchy_diagnostic_credentials SELECT id,true FROM hyperfide.agent_sessions;
 """)
WRAPPER="""import {createComponent as original} from '../hierarchy/packages.js';
import {FoundationError} from '../policy/programme.js';
export function createComponent(ctx){
 const component=original(ctx);
 const principal=JSON.parse(process.env.HF_DIAGNOSTIC_PRINCIPAL);
 const guard=async tx=>{
  const r=await tx.query("SELECT 1 FROM public.hf_hierarchy_diagnostic_credentials c JOIN hyperfide.agent_sessions s ON s.id=c.session_id JOIN hyperfide.runs r ON r.organisation_id=s.organisation_id AND r.id=s.run_id WHERE c.session_id=$1 AND c.active AND s.organisation_id=$2 AND s.run_id=$3 AND r.authority_epoch=$4 AND s.state IN ('REGISTERED','RUNNING','DISCONNECTED') FOR SHARE OF c,s,r",[principal.actor_id,principal.organisation_id,principal.run_id,principal.deployment_epoch]);
  if(!r.rowCount)throw new FoundationError('DIAGNOSTIC_PRINCIPAL_REVOKED','Trusted diagnostic principal is not current');
 };
 return {...component,actions:Object.fromEntries(Object.entries(component.actions).map(([name,action])=>[name,(input,context)=>action(input,{...context,invocation:Object.freeze({principal:Object.freeze(principal),guard})})]))};
}
"""
class Service:
 def __init__(self,base,task="3.1",wrapper=WRAPPER):
  self.base=base;self.base.mkdir(parents=True,exist_ok=True);self.component=task
  self.components=base/"components";self.components.mkdir(exist_ok=True)
  self.module_root=base/"module-root";self.module_root.mkdir(exist_ok=True)
  policy_proxy=self.module_root/"policy/programme.js";policy_proxy.parent.mkdir(parents=True,exist_ok=True)
  policy_proxy.write_text("export * from "+json.dumps((ROOT/"services/hyperfide/dist/policy/programme.js").as_uri())+";\n")
  self.actions=[]
  def add(name):
   source=ROOT/"services/hyperfide/components"/(name+".json")
   declaration=json.loads(source.read_text())
   for dependency in declaration["requires"]:
    if not (self.components/(dependency+".json")).exists():add(dependency)
   self.actions.extend(declaration["actions"])
   (self.components/(name+".json")).write_text(json.dumps(declaration))
   proxy=self.module_root/declaration["module"];proxy.parent.mkdir(parents=True,exist_ok=True)
   source_module=ROOT/"services/hyperfide/dist"/declaration["module"]
   proxy.write_text("export * from "+json.dumps(source_module.as_uri())+";\n")
  add(task)
  target=self.module_root/"diagnostics"/(task.replace(".","_")+".js")
  target.parent.mkdir(parents=True,exist_ok=True);target.write_text(wrapper)
  declaration=json.loads((self.components/(task+".json")).read_text());declaration["module"]="diagnostics/"+target.name
  (self.components/(task+".json")).write_text(json.dumps(declaration))
  self.policy={"schema_version":1,"programme_id":RUN,"repository":"diagnostic/fixture","spec_revision":"hierarchy-fixture","policy_revision":1,"status":"ACTIVE",
   "approval":{"decision":"APPROVED","record_id":"authorised-bounded-component-diagnostic","spec_revision":"hierarchy-fixture","policy_revision":1},
   "allowed_roles":["control"],"allowed_actions":list(dict.fromkeys(["programme.activate"]+self.actions))}
  self.policy_path=base/"policy.json";self.policy_path.write_text(json.dumps(self.policy))
 def request(self,action,value=None,actor=None,diagnostic=True,epoch=None):
  global COUNTER
  COUNTER+=1;process_env=env()
  process_env["HF_DIAGNOSTIC_PRINCIPAL"]=json.dumps({"actor_id":actor or uid(30),"organisation_id":ORG,"run_id":RUN,"deployment_epoch":epoch or EPOCH})
  component_dir=self.components
  if not diagnostic:
   component_dir=self.base/"original";component_dir.mkdir(exist_ok=True)
   for source in self.components.glob("*.json"):
    declaration=json.loads(source.read_text())
    if declaration["id"]==self.component:declaration=json.loads((ROOT/"services/hyperfide/components"/source.name).read_text())
    (component_dir/source.name).write_text(json.dumps(declaration))
  request={"id":"hierarchy-probe-"+str(COUNTER),"component":self.component,"action":action,"input":value or {}}
  result=subprocess.run(["node",str(ROOT/"services/hyperfide/dist/control.js"),"--policy",str(self.policy_path),"--spec-revision",self.policy["spec_revision"],"--components",str(component_dir),"--module-root",str(self.module_root)],
   cwd=ROOT,env=process_env,input=json.dumps(request)+"\n",text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
  lines=result.stdout.splitlines();expect(len(lines)==1,"Expected one actual service JSONL response; stderr="+result.stderr[:200])
  response=json.loads(lines[0]);expect(response.get("id")==request["id"],"Service response correlation mismatch")
  OBS.append({"action":action,"ok":response.get("ok"),"error_code":response.get("error",{}).get("code")})
  return result,response
 def ok(self,action,value=None,**kwargs):
  result,response=self.request(action,value,**kwargs);expect(result.returncode==0 and response.get("ok") is True,"Expected service success: "+str(response.get("error")));return response["result"]
 def reject(self,action,value,code,**kwargs):
  result,response=self.request(action,value,**kwargs);expect(result.returncode!=0 and response.get("ok") is False and response.get("error",{}).get("code")==code,"Expected "+code+", got "+str(response.get("error")));return response
def snapshot():
 return sql(f"SELECT jsonb_build_object('tasks',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM hyperfide.tasks t),'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM hyperfide.attempts a),'leases',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM hyperfide.compute_leases l),'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM hyperfide.agent_sessions s),'custodies',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM hyperfide.submission_custodies c),'findings',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM hyperfide.findings f))::text;").stdout.strip()
def main():
 seed()
 with tempfile.TemporaryDirectory(prefix="hf-hierarchy-3-1-") as tmp:
  s=Service(Path(tmp));leader={"idempotency_key":"leader-first","expected_generation":"0","reason":"Initial diagnostic leadership"}
  def primary_brand():
   program="""import {leadership,requireAuthority} from './services/hyperfide/dist/hierarchy/packages.js';
let queries=0;const fake={query(){queries++;throw new Error('must not query');}};
for(const call of [()=>leadership(fake,{organisation_id:'10000000-0000-0000-0000-000000000001',run_id:'20000000-0000-0000-0000-000000000001'}),()=>requireAuthority(fake,{})]){
 try{await call();throw new Error('unbranded transaction accepted');}catch(e){if(e.code!=='TX_CLOSED')throw e;}
}
if(queries!==0)throw new Error('forged session queried before refusal');
console.log(JSON.stringify({refused:true,queries}));
"""
   result=subprocess.run(["node","--input-type=module","-e",program],cwd=ROOT,env=env(),text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
   expect(result.returncode==0 and json.loads(result.stdout)=={"refused":True,"queries":0},"Authority helpers accepted a forged/replica-shaped session")
  check("hierarchy.primary.brand-refusal",primary_brand)
  check("hierarchy.describe",lambda:expect(s.ok("hierarchy.describe")["dispatch_authority"] is False,"Describe granted dispatch"))
  check("hierarchy.auth.missing-context",lambda:s.reject("hierarchy.leader.acquire",leader,"AUTHENTICATED_ACTOR_REQUIRED",diagnostic=False))
  check("hierarchy.leader.acquire",lambda:expect(s.ok("hierarchy.leader.acquire",leader)["leader_generation"]=="1","First leader generation differs"))
  check("hierarchy.leader.exact-replay",lambda:expect(s.ok("hierarchy.leader.acquire",leader)["leader_generation"]=="1","Replay changed generation"))
  check("hierarchy.leader.conflicting-replay",lambda:s.reject("hierarchy.leader.acquire",dict(leader,reason="Conflicting payload"),"IDEMPOTENCY_CONFLICT"))
  check("hierarchy.leader.role-refusal",lambda:s.reject("hierarchy.leader.acquire",dict(leader,idempotency_key="worker-leader",expected_generation="1"),"ROLE_DENIED",actor=uid(34)))
  check("hierarchy.leader.bad-generation",lambda:s.reject("hierarchy.leader.acquire",dict(leader,idempotency_key="bad-generation",expected_generation="01"),"INVALID_REQUEST"))
  check("hierarchy.leader.extra-field",lambda:s.reject("hierarchy.leader.acquire",dict(leader,actor_id=uid(31)),"INVALID_REQUEST"))
  for number,feature,policy in [(10,"alpha","FEATURE_STABLE"),(11,"alpha","FEATURE_STABLE"),(12,"beta","WAVE")]:
   check("hierarchy.package.configure-"+str(number),lambda n=number,f=feature,p=policy:s.ok("hierarchy.package.configure",{"idempotency_key":"configure-"+str(n),"leader_generation":"1","package_id":uid(n),"feature_key":f,"allocation_policy":p}))
  assign={"idempotency_key":"assign-first","leader_generation":"1","package_id":uid(10),"expected_generation":"1","manager_session_id":uid(32)}
  check("hierarchy.package.assign",lambda:expect(s.ok("hierarchy.package.assign",assign)["package_generation"]=="2","Owner generation did not advance"))
  check("hierarchy.package.assign-replay",lambda:expect(s.ok("hierarchy.package.assign",assign)["package_generation"]=="2","Replay advanced owner generation"))
  check("hierarchy.package.no-silent-reassignment",lambda:s.reject("hierarchy.package.assign",dict(assign,idempotency_key="silent-reassignment",expected_generation="2",manager_session_id=uid(33)),"HANDOFF_REQUIRED"))
  check("hierarchy.policy.stable-owner",lambda:s.reject("hierarchy.package.assign",dict(assign,idempotency_key="wrong-stable-owner",package_id=uid(11),manager_session_id=uid(33)),"OWNERSHIP_POLICY_CONFLICT"))
  check("hierarchy.policy.successive-waves",lambda:s.ok("hierarchy.package.assign",dict(assign,idempotency_key="successive-wave",package_id=uid(11))))
  check("hierarchy.policy.wave-allocation",lambda:s.ok("hierarchy.package.assign",dict(assign,idempotency_key="wave-owner",package_id=uid(12),manager_session_id=uid(33))))
  bind={"idempotency_key":"bind-worker","leader_generation":"1","package_id":uid(10),"package_generation":"2","session_id":uid(34),"role":"WORKER"}
  check("hierarchy.role.bind",lambda:expect(s.ok("hierarchy.role.bind",bind)["execution_authority"] is False,"Role binding granted execution"))
  check("hierarchy.role.no-escalation",lambda:s.reject("hierarchy.role.bind",dict(bind,idempotency_key="role-escalation",role="INTEGRATOR"),"ROLE_DENIED"))
  handoff={"idempotency_key":"handoff-all","leader_generation":"1","package_ids":[uid(10),uid(11)],"expected_generations":{uid(10):"2",uid(11):"2"},"successor_id":uid(33),"context":{"summary":"Persisted engineering handoff","decision_refs":["decision:one"],"pending_instruction_refs":["instruction:one"],"native_session_refs":["fixture:manager-one"]}}
  check("hierarchy.handoff.partial-stable-refusal",lambda:s.reject("hierarchy.package.handoff.propose",dict(handoff,idempotency_key="partial-handoff",package_ids=[uid(10)],expected_generations={uid(10):"2"}),"OWNERSHIP_POLICY_CONFLICT"))
  before=snapshot();state={}
  check("hierarchy.handoff.propose",lambda:state.update(s.ok("hierarchy.package.handoff.propose",handoff)))
  check("hierarchy.handoff.predecessor-retained",lambda:expect(sql(f"SELECT count(*) FROM hyperfide.feature_packages WHERE id IN ('{uid(10)}','{uid(11)}') AND manager_session_id='{uid(32)}';").stdout.strip()=="2","Proposal changed current owner"))
  ack={"idempotency_key":"ack-all","leader_generation":"1","handoff_id":state.get("handoff_id",uid(999))}
  check("hierarchy.handoff.wrong-successor",lambda:s.reject("hierarchy.package.handoff.acknowledge",ack,"HANDOFF_SUCCESSOR_MISMATCH",actor=uid(32)))
  check("hierarchy.handoff.acknowledge",lambda:expect(s.ok("hierarchy.package.handoff.acknowledge",ack,actor=uid(33))["ownership_changed"] is True,"Acknowledgement did not transfer ownership"))
  check("hierarchy.handoff.ack-replay-after-restart",lambda:expect(s.ok("hierarchy.package.handoff.acknowledge",ack,actor=uid(33))["ownership_changed"] is True,"Restart/replay lost durable handoff"))
  check("hierarchy.handoff.healthy-work-preserved",lambda:expect(snapshot()==before,"Manager replacement rewrote task/attempt/lease/session/custody history"))
  check("hierarchy.handoff.current-owner",lambda:expect(sql(f"SELECT count(*) FROM hyperfide.feature_packages p JOIN hyperfide.hierarchy_packages h ON h.package_id=p.id AND h.organisation_id=p.organisation_id AND h.run_id=p.run_id WHERE p.id IN ('{uid(10)}','{uid(11)}') AND p.manager_session_id='{uid(33)}' AND h.owner_generation=3;").stdout.strip()=="2","Current owner/generation mismatch"))
  def ack_binding():
   sql(f"INSERT INTO hyperfide.hierarchy_handoffs(organisation_id,run_id,id,authority_epoch,leader_generation,predecessor_id,successor_id,package_snapshot,task_ids,finding_ids,context) SELECT organisation_id,run_id,'{uid(95)}',authority_epoch,leader_generation,predecessor_id,successor_id,package_snapshot,task_ids,finding_ids,context FROM hyperfide.hierarchy_handoffs WHERE id='{state['handoff_id']}';")
   bad=sql(f"INSERT INTO hyperfide.hierarchy_handoff_acknowledgements(organisation_id,run_id,handoff_id,successor_id) VALUES('{ORG}','{RUN}','{uid(95)}','{uid(32)}');",allow_error=True)
   expect(bad.returncode!=0 and "foreign key" in bad.stderr.lower(),"Database accepted an acknowledgement from the wrong recorded successor")
  check("hierarchy.handoff.relational-successor-binding",ack_binding)
  check("hierarchy.history.immutable",lambda:expect(sql("UPDATE hyperfide.hierarchy_handoffs SET context='{}';",allow_error=True).returncode!=0,"Historical handoff was editable"))
  check("hierarchy.history.finding-owner",lambda:expect(sql(f"SELECT count(*) FROM hyperfide.findings f JOIN hyperfide.feature_packages p ON p.id=f.owner_package_id AND p.organisation_id=f.organisation_id AND p.run_id=f.run_id WHERE f.id='{uid(45)}' AND f.owner_package_id='{uid(10)}' AND p.manager_session_id='{uid(33)}';").stdout.strip()=="1","Finding lost its accountable manager through handoff"))
  def race():
   def request(actor):return s.request("hierarchy.leader.acquire",{"idempotency_key":"replace-"+actor,"expected_generation":"1","reason":"Leader replacement"},actor=actor)[1]
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(request,[uid(30),uid(31)]))
   expect(sum(x.get("ok") is True for x in responses)==1,"Concurrent leaders both acquired or neither did")
   expect(sum(x.get("error",{}).get("code")=="LEADER_GENERATION_STALE" for x in responses)==1,"Losing leader did not see a fenced conflict")
  check("hierarchy.leader.concurrent-cas",race)
  check("hierarchy.leader.stale-mutation",lambda:s.reject("hierarchy.package.assign",dict(assign,idempotency_key="stale-leader"),"LEADER_GENERATION_STALE"))
  check("hierarchy.leader.old-exact-replay",lambda:expect(s.ok("hierarchy.leader.acquire",leader)["leader_generation"]=="1","Historical exact replay was rewritten"))
  check("hierarchy.auth.wrong-platform-epoch",lambda:s.reject("hierarchy.leader.acquire",dict(leader,idempotency_key="wrong-epoch",expected_generation="2"),"DIAGNOSTIC_PRINCIPAL_REVOKED",epoch=uid(90)))
  def revoked():
   sql(f"UPDATE public.hf_hierarchy_diagnostic_credentials SET active=false WHERE session_id='{uid(30)}';")
   try:s.reject("hierarchy.leader.acquire",leader,"DIAGNOSTIC_PRINCIPAL_REVOKED")
   finally:sql(f"UPDATE public.hf_hierarchy_diagnostic_credentials SET active=true WHERE session_id='{uid(30)}';")
  check("hierarchy.auth.revoked-before-replay",revoked)
  def checksum():
   old=sql("SELECT checksum FROM hyperfide.schema_migrations WHERE version=3;").stdout.strip()
   sql("UPDATE hyperfide.schema_migrations SET checksum='sha256:"+"0"*64+"' WHERE version=3;")
   try:s.reject("hierarchy.leader.acquire",dict(leader,idempotency_key="wrong-schema",expected_generation="2"),"HIERARCHY_SCHEMA_REQUIRED")
   finally:sql("UPDATE hyperfide.schema_migrations SET checksum='"+old+"' WHERE version=3;")
  check("hierarchy.migration.provenance",checksum)
  (observation_dir()/"observations.json").write_text(json.dumps({"observations":sorted(OBS,key=lambda row:json.dumps(row,sort_keys=True)),"failed":FAILED,"scope":"REGISTERED_DIAGNOSTIC_COMPONENT; NOT NETWORK_AUTH_OR_LIVE_NATIVE_RECOVERY"},sort_keys=True)+"\n")
 return 1 if FAILED else 0
if __name__=="__main__":
 if "--cleanup" in sys.argv:raise SystemExit(cleanup())
 try:raise SystemExit(main())
 except Exception as error:
  print(json.dumps({"type":"diagnostic","error":type(error).__name__,"message":str(error)}),flush=True);raise
