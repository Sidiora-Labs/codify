#!/usr/bin/env python3
"""Registered recovery-process tests against isolated real PostgreSQL state.

These component checks do not establish live provider fencing, production HA,
connector cleanup, or a complete disaster recovery campaign.
"""
from pathlib import Path
import hashlib,json,os,select,subprocess,sys,tempfile,uuid
from urllib.parse import urlsplit,urlunsplit
ROOT=Path(__file__).resolve().parents[4]
TASK="24.1"
FAILED=[]
IDS=[]
DB=None
RESOURCE=None
def uid(n):return "00000000-0000-4000-8000-"+format(n,"012x")
ORG=uid(1);RUN=uid(5);EPOCH=uid(99);ATTEMPT=uid(20)
SCOPE={"organisation_id":ORG,"run_id":RUN,"authority_epoch":EPOCH}
D="sha256:"+"a"*64
ACTIONS={
"24.1":["recovery.control.describe","recovery.control.reconstruct","recovery.offline.evaluate","recovery.control.resume","recovery.control.adopt"],
"24.2":["recovery.worker.describe","recovery.worker.loss","recovery.worker.inventory"],
"24.3":["recovery.stop.describe","recovery.stop.request","recovery.stop.reconcile","recovery.stop.finalize"],
"24.4":["recovery.drill.describe","recovery.drill.plan","recovery.drill.execute","recovery.drill.inspect"]}
def expect(condition,message="unexpected result"):
 if not condition:raise AssertionError(message)
def check(identity,fn):
 IDS.append(identity)
 try:fn();actual="observed"
 except Exception as e:FAILED.append(identity);actual=type(e).__name__+": "+str(e)
 print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
def env_for(db):
 env=os.environ.copy();env["PGDATABASE"]=db
 env["HYPERFIDE_OFFLINE_POLICY"]="BOUNDED_LOCAL";env["HYPERFIDE_MAX_OFFLINE_MS"]="60000"
 p=urlsplit(env["DATABASE_URL"])
 env["DATABASE_URL"]=urlunsplit((p.scheme,p.netloc,"/"+db,p.query,p.fragment))
 return env
def sql(text,db=None):
 p=subprocess.run(["psql","-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-d",db or DB],
 input=text,text=True,capture_output=True,env=env_for(db or DB),timeout=30)
 expect(p.returncode==0,"Disposable PostgreSQL fixture failed: "+" | ".join(x for x in p.stderr.splitlines() if x.startswith(("ERROR:","DETAIL:")))[:500])
 return p.stdout.strip()
def seed():
 sql("""BEGIN;
INSERT INTO hyperfide.organisations(id,name) VALUES('%s','recovery-fixture');
INSERT INTO hyperfide.projects(organisation_id,id,name) VALUES('%s','%s','fixture');
INSERT INTO hyperfide.repositories(organisation_id,id,project_id,name,url) VALUES('%s','%s','%s','repo','https://example.invalid/repo');
INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES('%s','%s',repeat('a',40));
INSERT INTO hyperfide.spec_revisions(organisation_id,id,project_id,source_digest,source_content,document,schema_version) VALUES('%s','%s','%s','sha256:'||encode(sha256(convert_to('fixture','UTF8')),'hex'),'fixture','{}',1);
INSERT INTO hyperfide.runs(organisation_id,id,project_id,spec_revision_id,policy_digest,authority_epoch,state) VALUES('%s','%s','%s','%s','%s','%s','RUNNING');
INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES('%s','%s','%s',repeat('a',40),'refs/heads/main');
INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES('%s','%s','%s','package',1);
INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) VALUES('%s','%s','%s','1.1','%s','%s','%s','{}',1);
INSERT INTO hyperfide.provider_pools(organisation_id,id,provider,account_key,environment_key,region) VALUES('%s','%s','railway','fixture','fixture','fixture');
INSERT INTO hyperfide.sandboxes(organisation_id,id,pool_id,observed_state) VALUES('%s','%s','%s','RUNNING');
INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind) VALUES('%s','%s','%s','worker',1,'AGENT');
INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,execution_state,compute_authority,sandbox_id,slot_id,sandbox_boot_generation,lease_expires_at) VALUES('%s','%s','%s','%s',1,'%s','%s','RUNNING','CURRENT','%s','%s',1,clock_timestamp()+interval '30 minutes');
UPDATE hyperfide.tasks SET generation=1,current_attempt_id='%s',state='RUNNING',state_version=state_version+1 WHERE organisation_id='%s' AND run_id='%s';
INSERT INTO hyperfide.compute_leases(organisation_id,run_id,id,attempt_id,attempt_generation,authority_epoch,sandbox_boot_generation,expires_at) VALUES('%s','%s','%s','%s',1,'%s',1,clock_timestamp()+interval '30 minutes');
INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id,attempt_id,sandbox_id,slot_id,sandbox_boot_generation,state) VALUES('%s','%s','%s','WORKER','codex','fixture','worker','%s','%s','%s',1,'RUNNING');
INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id,state) VALUES('%s','%s','%s','LEADER','claude','fixture','leader','RUNNING');
INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-00000000001b','1.2','00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000004','sha256:'||repeat('a',64),'{}',1);
INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,execution_state,compute_authority,sandbox_id,slot_id,sandbox_boot_generation) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-00000000001c','00000000-0000-4000-8000-00000000001b',1,'00000000-0000-4000-8000-000000000063','sha256:'||repeat('a',64),'SUBMITTED','RELEASED','00000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-00000000000a',1);
UPDATE hyperfide.tasks SET generation=1,current_attempt_id='00000000-0000-4000-8000-00000000001c',state='SUBMITTED',state_version=state_version+1 WHERE id='00000000-0000-4000-8000-00000000001b';
INSERT INTO hyperfide.submission_custodies(organisation_id,run_id,id,task_id,source_attempt_id,source_generation,custody_generation,authority_epoch,repository_id,source_object_id,source_manifest_digest,evidence_manifest_digest,criteria_digest) VALUES('%s','%s','%s','%s','%s',1,1,'%s','%s',repeat('a',40),'%s','%s','%s');
INSERT INTO hyperfide.qualification_jobs(organisation_id,run_id,id,custody_id,custody_generation,rubric_digest,state,lease_generation,lease_owner,lease_expires_at) VALUES('%s','%s','%s','%s',1,'%s','RUNNING',1,'%s',clock_timestamp()-interval '1 minute');
COMMIT;
""".replace(uid(99),EPOCH)%(ORG,ORG,uid(2),ORG,uid(3),uid(2),ORG,uid(3),ORG,uid(4),uid(2),ORG,RUN,uid(2),uid(4),D,EPOCH,ORG,RUN,uid(3),ORG,RUN,uid(6),ORG,RUN,uid(7),uid(6),uid(4),D,ORG,uid(8),ORG,uid(9),uid(8),ORG,uid(10),uid(9),ORG,RUN,ATTEMPT,uid(7),EPOCH,D,uid(9),uid(10),ATTEMPT,ORG,RUN,ORG,RUN,uid(21),ATTEMPT,EPOCH,ORG,RUN,uid(22),ATTEMPT,uid(9),uid(10),ORG,RUN,uid(23),ORG,RUN,uid(24),uid(27),uid(28),EPOCH,uid(3),D,D,D,ORG,RUN,uid(25),uid(24),D,uid(26)))
def component_dependencies(names):
 fragments={}
 for file in (ROOT/"services/hyperfide/components").glob("*.json"):
  value=json.loads(file.read_text())
  if "id" in value:fragments[value["id"]]=(file.stem,value)
 result=[];visited=set()
 def visit(name):
  if name in visited:return
  expect(name in fragments,"Actual component dependency is unavailable: "+name)
  stem,value=fragments[name];visited.add(name)
  for prerequisite in value["requires"]:visit(prerequisite)
  result.append(stem)
 for name in names:visit(name)
 return result
class Fixture:
 def __init__(self,task):
  global DB,RESOURCE
  import importlib.util
  spec=importlib.util.spec_from_file_location("actual_identity_fixture",ROOT/"tests/hyperfide/support/identity_fixture.py")
  module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  self.task=task
  def prepare(identity):
   global DB,RESOURCE,EPOCH,SCOPE
   EPOCH=identity.ids["epoch"];SCOPE={"organisation_id":ORG,"run_id":RUN,"authority_epoch":EPOCH}
   DB=identity.database;RESOURCE="hf-task-"+task+"-database"
   observation_dir().joinpath("fixture.json").write_text(json.dumps({"database":DB,"resource":RESOURCE}))
   seed()
   identity.ids["organisation"]=ORG;identity.ids["run"]=RUN;identity.ids["epoch"]=EPOCH
   config=json.loads(identity.identity_config.read_text())
   for principal in config["principals"]:
    name="operator" if principal["role"]=="OPERATOR" else "provisioner"
    credential=str(uuid.uuid4());identity.ids[name]=credential
    principal["credential_id"]=credential;principal["actor_id"]=credential
    principal["organisation_id"]=ORG;principal["run_id"]=RUN;principal["deployment_epoch"]=EPOCH
    identity.seed_fixture_principal(principal)
   identity.identity_config.write_text(json.dumps(config))
  self.identity=module.IdentityFixture(extra_components=component_dependencies(["24."+str(i) for i in range(1,int(task[-1])+1)]),extra_env={"HYPERFIDE_OFFLINE_POLICY":"BOUNDED_LOCAL","HYPERFIDE_MAX_OFFLINE_MS":"60000"},extra_setup=prepare)
 def request(self,action,payload,component=None):
  operation=self.identity.operation(component or self.task,action,payload)
  status,response=self.identity.request(operation)
  expect(response.get("operation_id")==operation["operation_id"] or response.get("ok") is False,"Lost signed operation identity")
  return response
 def ok(self,action,payload,component=None):
  row=self.request(action,payload,component);expect(row.get("ok") is True,str(row.get("error")));return row["result"]
 def rejected(self,action,payload,code,component=None):
  row=self.request(action,payload,component);expect(row.get("ok") is False and row.get("error",{}).get("code")==code,str(row))
 def close(self):self.identity.close()
def setup(task):return Fixture(task)
def observation_dir():
 path=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/task-"+TASK+"-raw"))/"recovery"
 path.mkdir(parents=True,exist_ok=True)
 return path
def cleanup():
 global DB,RESOURCE
 complete=True
 try:
  if DB is None and observation_dir().joinpath("fixture.json").exists():
   item=json.loads(observation_dir().joinpath("fixture.json").read_text());DB=item["database"];RESOURCE=item["resource"]
  if DB:
   expect(DB.startswith(("hf_recovery_","hf_identity_")) and all(c.isalnum() or c=="_" for c in DB),"Unsafe fixture identity")
   sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='"+DB+"' AND pid<>pg_backend_pid();","postgres")
   sql('DROP DATABASE IF EXISTS "'+DB+'";',"postgres")
   expect(sql("SELECT count(*) FROM pg_database WHERE datname='"+DB+"';","postgres")=="0","Fixture database remains")
  record={"resource":RESOURCE,"database":DB,"observed_absent":True,"observer":"PostgreSQL pg_database query after DROP DATABASE"}
  observation_dir().joinpath("database-absence.json").write_text(json.dumps(record)+chr(10))
 except Exception:complete=False
 resources=[] if RESOURCE is None else [{"id":RESOURCE,"status":"deleted" if complete else "unknown","observed_absent":complete,"evidence_artifact":"recovery/database-absence.json"}]
 print(json.dumps({"type":"cleanup","complete":complete,"resources":resources}),flush=True)
 return complete

ACCEPTED_REBIND_PROBE=r'''
import {createResourceContainer} from './services/hyperfide/dist/storage/runtime.js';
import {FileExternalAuthorityJournal} from './services/hyperfide/dist/storage/authority_journal.js';
import {lookupAuthorityActivation} from './services/hyperfide/dist/storage/durability.js';
import {FileExternalFenceJournal} from './services/hyperfide/dist/recovery/fencing.js';
import {createAcceptedRunRecoveryVerifier} from './services/hyperfide/dist/recovery/control.js';
import fs from 'node:fs/promises';import {randomUUID} from 'node:crypto';
const signal=new AbortController().signal,r=createResourceContainer({role:'control',env:process.env,signal});
const D='sha256:'+'a'.repeat(64),org=process.env.HF_RECOVERY_ORG,run=process.env.HF_RECOVERY_RUN,deployment=process.env.HYPERFIDE_DEPLOYMENT_ID;
const dir=await fs.mkdtemp('/tmp/hyperfide/rebind-negative-');await fs.chmod(dir,0o700);let revocations=0;
try{
 const current=(await r.observe({preferReplica:false},async tx=>(await tx.query("SELECT a.operation_id::text,a.epoch::text,e.proof_digest FROM hyperfide.authority_activations a JOIN hyperfide.authority_epochs e ON e.deployment_id=a.deployment_id AND e.epoch=a.epoch WHERE a.deployment_id=$1 AND e.state='ACTIVE'",[deployment])).rows[0])).value;
 const journal=new FileExternalAuthorityJournal(process.env.HYPERFIDE_AUTHORITY_JOURNAL_DIR,input=>lookupAuthorityActivation(r,input));
 const head=await journal.current({deployment_id:deployment});
 const topology={schema_version:1,deployment_id:deployment,organisation_id:org,run_id:run,source_epoch:null,evidence_scope:'LIVE_PROVIDER',legacy_topology_digest:D,legacy_pid_namespace:await fs.readlink('/proc/self/ns/pid'),legacy_mount_namespace:await fs.readlink('/proc/self/ns/mnt'),required_writer_ids:['writer'],resources:[{reference_key:'writer-node',topology_digest:D,writer_ids:['writer'],backend:'OWNED_HOST'}]};
 const factory=createAcceptedRunRecoveryVerifier({resources:r,journal,fenceJournal:new FileExternalFenceJournal(dir),topology,revokeCompute:async()=>{revocations++;throw Error('Missing actual recovery scheduler must never run in this negative probe')}});
 const input={schema_version:1,organisation_id:org,run_id:run,recovery_operation_id:randomUUID(),activation_operation_id:current.operation_id,deployment_id:deployment,expected_run_epoch:randomUUID(),target_epoch:current.epoch,expected_spec_generation:'1',expected_spec_revision_id:process.env.HF_RECOVERY_SPEC,expected_revision_digest:D,external_previous_epoch:null,database_predecessor_epoch:null,fence_proof_digest:current.proof_digest,external_journal_sequence:head.sequence};
 const outcome={};
 try{await factory.prepare({...input,target_epoch:input.expected_run_epoch})}catch(e){outcome['rebind-equal-epoch-refused']=e.code==='RECOVERY_REBIND_SCOPE_DENIED'}
 try{await factory.prepare({...input,organisation_id:randomUUID()})}catch(e){outcome['rebind-outside-trusted-topology-refused']=e.code==='RECOVERY_REBIND_SCOPE_DENIED'}
 try{await factory.prepare(input)}catch(e){outcome['committed-global-epoch-without-physical-completion-refused']=['ENOENT','EXTERNAL_FENCE_COMPLETION_UNVERIFIED'].includes(e.code)&&revocations===0}
 console.log(JSON.stringify(outcome));if(Object.keys(outcome).length!==3||Object.values(outcome).some(v=>v!==true))throw Error('Actual recovery proof negative regression');
}finally{await r.close();await fs.rm(dir,{recursive:true,force:true})}
'''

def tests(f):
 check("recovery.control.real-registered-process",lambda:expect(f.ok("recovery.control.describe",{})["supervision_failure_domains"]==1))
 probe_env=f.identity.env.copy();probe_env["HF_RECOVERY_ORG"]=ORG;probe_env["HF_RECOVERY_RUN"]=RUN;probe_env["HF_RECOVERY_SPEC"]=uid(4)
 actual=subprocess.run(["node","--input-type=module","-e",ACCEPTED_REBIND_PROBE],cwd=ROOT,env=probe_env,capture_output=True,text=True,timeout=40)
 expect(actual.returncode==0,"Accepted recovery proof probe failed: "+actual.stderr[:1000])
 for name,value in json.loads(actual.stdout).items():check("recovery.control."+name,lambda value=value:expect(value))

 snapshot=f.ok("recovery.control.reconstruct",SCOPE)
 check("recovery.control.consistent-snapshot",lambda:expect(snapshot["snapshot_consistency"]=="SERIALIZABLE" and len(snapshot["packages"])==1))
 check("recovery.control.no-duplicate-dispatch",lambda:expect(snapshot["new_work_authorized"] is False and snapshot["adoption_candidates"][0]["authority"]=="NONE"))
 check("recovery.control.event-state-same-primary",lambda:expect(snapshot["event_recovery"]["source"]=="primary-transaction" and snapshot["event_recovery"]["task_completion_authority"] is False and snapshot["event_recovery"]["counts"]["pending_deliveries"]=="0"))
 check("recovery.control.custody-independent",lambda:expect(len(snapshot["submission_custody"])==1 and len(snapshot["qualification_jobs"])==1))
 check("recovery.control.supervision-limit",lambda:expect(snapshot["uninterrupted_leadership_failover"]=="UNQUALIFIED"))
 check("recovery.control.stale-epoch",lambda:f.rejected("recovery.control.reconstruct",{**SCOPE,"authority_epoch":uid(98)},"RECOVERY_STALE_EPOCH"))
 check("recovery.control.cross-organisation",lambda:f.rejected("recovery.control.reconstruct",{**SCOPE,"organisation_id":uid(97)},"RECOVERY_SCOPE_DENIED"))
 from datetime import datetime,timedelta,timezone
 now=datetime.now(timezone.utc)
 stamp=lambda d:d.isoformat(timespec="milliseconds").replace("+00:00","Z")
 base={"scope":SCOPE,"attempt_id":ATTEMPT,"generation":"1","boot_generation":"1","lease_expires_at":stamp(now+timedelta(minutes=10)),"disconnected_at":stamp(now-timedelta(seconds=1)),"max_offline_ms":60000,"policy":"BOUNDED_LOCAL","requested_operation":"LOCAL_TEST"}
 local=f.ok("recovery.offline.evaluate",base)
 check("recovery.offline.bounded-local",lambda:expect(local["local_continuation"] is True and local["authority"]=="NONE"))
 for op in ["CLAIM","RENEW","SUBMIT","PUBLISH","PROVISION","QUALIFY"]:
  check("recovery.offline.reject-"+op.lower(),lambda op=op:expect(f.ok("recovery.offline.evaluate",{**base,"requested_operation":op})["local_continuation"] is False))
 check("recovery.offline.trusted-budget-ceiling",lambda:expect(f.ok("recovery.offline.evaluate",{**base,"max_offline_ms":3600000})["deadline_at"]==stamp(now-timedelta(seconds=1)+timedelta(seconds=60))))
 check("recovery.offline.safe-pause",lambda:expect(f.ok("recovery.offline.evaluate",{**base,"policy":"PAUSE"})["local_continuation"] is False))
 check("recovery.offline.expired-budget",lambda:expect(f.ok("recovery.offline.evaluate",{**base,"max_offline_ms":0})["local_continuation"] is False))
 check("recovery.offline.malformed-time",lambda:f.rejected("recovery.offline.evaluate",{**base,"disconnected_at":"2026-02-30T12:00:00.000Z"},"RECOVERY_INPUT_INVALID"))
 check("recovery.offline.unknown-field",lambda:f.rejected("recovery.offline.evaluate",{**base,"authority":True},"RECOVERY_INPUT_INVALID"))
 check("recovery.control.adopt-unproven-supervisor",lambda:f.rejected("recovery.control.adopt",{"scope":SCOPE,"operation_id":uid(51),"session_id":uid(22)},"RECOVERY_DEPENDENCY_UNAVAILABLE"))
 check("recovery.control.active-run-cannot-resume",lambda:f.rejected("recovery.control.resume",{"scope":SCOPE,"operation_id":uid(50)},"RECOVERY_RUN_STATE_INVALID"))
 sql("UPDATE hyperfide.tasks SET current_attempt_id=NULL,generation=generation+1,state_version=state_version+1 WHERE id='"+uid(7)+"';")
 stale=f.ok("recovery.control.reconstruct",SCOPE)
 check("recovery.control.task-pointer-fences-adoption",lambda:expect(stale["attempts"][0]["compute_token_current"] is False and len(stale["adoption_candidates"])==0))
 sql("UPDATE hyperfide.runs SET state='CANCELLING',state_version=state_version+1 WHERE organisation_id='"+ORG+"' AND id='"+RUN+"';")
 check("recovery.control.cancellation-is-terminal",lambda:f.rejected("recovery.control.resume",{"scope":SCOPE,"operation_id":uid(52)},"RECOVERY_TERMINAL_CONTROL"))
 sql("UPDATE hyperfide.schema_migrations SET checksum='sha256:'||repeat('b',64) WHERE version=24;")
 check("recovery.control.schema-drift-refusal",lambda:f.rejected("recovery.control.reconstruct",SCOPE,"RECOVERY_SCHEMA_NOT_READY"))
def run(task,callback):
 global TASK
 TASK=task
 if sys.argv[1:] and sys.argv[1:]!=["--cleanup"]:raise SystemExit("unsupported argument")
 if "--cleanup" in sys.argv:
  return 0 if cleanup() else 1
 fixture=None
 try:fixture=setup(task);callback(fixture)
 finally:
  if fixture:fixture.close()
  complete=cleanup()
 return 1 if FAILED or not complete else 0
if __name__=="__main__":sys.exit(run(TASK,tests))
