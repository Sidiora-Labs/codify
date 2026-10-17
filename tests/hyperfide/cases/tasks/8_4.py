#!/usr/bin/env python3
"""Real signed permits and owned OS-process isolation; component evidence only."""
from __future__ import annotations
import copy,hashlib,importlib.util,json,os,subprocess,sys,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
IDS=[
"provider.isolation.genuine-permit","provider.isolation.forged-authority","provider.isolation.wrong-operation",
"provider.isolation.unknown-resource","provider.isolation.custody-required","provider.isolation.empty-custody-measured",
"provider.isolation.persist-before-destroy","provider.isolation.actual-process-reaped","provider.isolation.independent-absence",
"provider.isolation.component-only","provider.isolation.reobserve-no-repeat","provider.isolation.retained-binding",
"provider.isolation.renewal-not-destruction","provider.observation.genuine-distinct-permit",
"provider.observation.no-new-operation","provider.observation.no-destructive-authority","provider.observation.read-only-absence",
"provider.observation.attributable-journal","provider.observation.cached-absence-not-proof","provider.observation.present-measured",
"provider.observation.transport-unknown","provider.observation.no-destroy-capability","provider.observation.wrong-boot",
"provider.observation.wrong-resource-scope","provider.observation.cancel-before-effect","provider.observation.expired-permit",
"provider.isolation.invalid-topology-mode","provider.isolation.incomplete-delete-no-absence"]
IDS+=["provider.placement.real-configure","provider.placement.no-caller-failure","provider.placement.no-invented-observation","provider.placement.recorded-failure-backoff","provider.placement.idempotent-backoff","provider.placement.unknown-no-retry-authority","provider.placement.cross-run-observation","provider.placement.private-connectivity-policy","provider.placement.no-probe-from-metadata","provider.placement.no-invented-enrollment"]
IDS+=["provider.relocation.incompatible-profile-refused","provider.relocation.unbound-manifest-refused","provider.relocation.compatible-profile-accepted","provider.relocation.identities-preserved","provider.relocation.old-attempt-fenced","provider.relocation.idempotent-replay","provider.relocation.fresh-enrollment-required"]
SCRIPT=r"""
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import * as permits from './services/hyperfide/dist/identity/credentials.js';
import {createProviderIsolation,createProviderIsolationObserver} from './services/hyperfide/dist/providers/placement.js';
import {digestDocument} from './services/hyperfide/dist/providers/pools.js';
const ids=JSON.parse(process.env.HYPERFIDE_ISOLATION_ASSERTIONS);
let failures=0,child=null,root=null,cleanup=false;
const assert=(v,m)=>{if(!v)throw Error(m)};
const check=async(n,fn)=>{try{await fn();console.log(JSON.stringify({type:'assertion',id:ids[n],expected:'observed',actual:'observed'}))}catch(e){failures++;console.log(JSON.stringify({type:'assertion',id:ids[n],expected:'observed',actual:String(e.stack??e)}))}};
const reject=async(fn,code)=>{try{await fn()}catch(e){if(code)assert(e.code===code,'wrong error '+e.code);return}throw Error('request unexpectedly accepted')};
const clone=v=>JSON.parse(JSON.stringify(v));
const exists=pid=>{try{process.kill(pid,0);return true}catch(e){if(e.code==='ESRCH')return false;throw e}};
try{
 root=await fs.mkdtemp(path.join(os.tmpdir(),'hyperfide-isolation-'));
 const privateKey=path.join(root,'issuer.pem'),verifierFile=path.join(root,'issuers.json'),configFile=path.join(root,'topology.json'),journalFile=path.join(root,'journal.json'),workspace=path.join(root,'empty-workspace');
 await fs.mkdir(workspace,{mode:0o700});
 const key=generateKeyPairSync('ed25519');
 await fs.writeFile(privateKey,key.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});
 const publicRaw=key.publicKey.export({format:'der',type:'spki'}).subarray(-32);
 await fs.writeFile(verifierFile,JSON.stringify({schema_version:1,issuers:[{key_id:'fixture-issuer',public_key_b64:publicRaw.toString('base64url')}]}),{mode:0o600});
 const verifier=await permits.loadIsolationPermitVerifier(verifierFile),observerVerifier=await permits.loadWriterObservationPermitVerifier(verifierFile),issuer={key_id:'fixture-issuer',private_key_file:privateKey};
 const config={schema_version:1,deployment_id:randomUUID(),organisation_id:randomUUID(),run_id:randomUUID(),source_epoch:randomUUID(),topology_digest:digestDocument({kind:'owned-os-component-fixture'}),evidence_scope:'COMPONENT_FIXTURE',maximum_operation_ms:2000,proof_max_age_ms:2000,resources:[]};
 const target={reference_key:'owned-stateless-child',scope:{organisation_id:config.organisation_id,pool_id:randomUUID(),provider:'railway',provider_account_id:'COMPONENT_FIXTURE',environment_id:'local-owned-process',region:'local',configuration_digest:digestDocument({fixture:'local-process'})},resource:{native_sandbox_id:randomUUID(),sandbox_boot_generation:'1'},boot_id:randomUUID(),preparation_digest:digestDocument({empty:true}),resource_topology_digest:digestDocument({local_only:true})};
 config.resources.push(target);await fs.writeFile(configFile,JSON.stringify(config),{mode:0o600});
 const operationId=randomUUID();
 const expected={deployment_id:config.deployment_id,operation_id:operationId,organisation_id:config.organisation_id,run_id:config.run_id,source_epoch:config.source_epoch,topology_digest:config.topology_digest,resource_reference:target.reference_key,resource_topology_digest:target.resource_topology_digest};
 const claims=(purpose)=>({schema_version:1,purpose,deployment_id:config.deployment_id,operation_id:operationId,organisation_id:config.organisation_id,run_id:config.run_id,source_epoch:config.source_epoch,topology_digest:config.topology_digest,resources:[{reference_key:target.reference_key,topology_digest:target.resource_topology_digest}],issued_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),nonce:randomUUID()});
 const destructiveClaims=claims('EXTERNAL_WRITER_ISOLATION_ONLY'),permit=verifier.verify(await permits.issueIsolationPermit(destructiveClaims,issuer),expected);
 const observationPermit=observerVerifier.verify(await permits.issueWriterObservationPermit(claims('EXTERNAL_WRITER_OBSERVATION_ONLY'),issuer),expected);
 const signal=new AbortController().signal;
 let destroyCalls=0,observeCalls=0,prepareCalls=0,journalRecords=0,observations=[],mode='actual',custodyMeasured=false,prepareBeforeEffect=false;
 const store=async(value)=>{
  const temporary=journalFile+'.next',file=await fs.open(temporary,'w',0o600);
  try{await file.writeFile(JSON.stringify(value));await file.sync()}finally{await file.close()}
  await fs.rename(temporary,journalFile);const dir=await fs.open(root,'r');try{await dir.sync()}finally{await dir.close()}
 };
 const read=async()=>{try{return JSON.parse(await fs.readFile(journalFile,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}};
 const journal={read,prepare:async(binding)=>{prepareCalls++;const prior=await read();if(prior)return{created:false,state:prior};const state={binding:clone(binding),receipt:null};await store(state);return{created:true,state}},record:async(value)=>{journalRecords++;const old=await read();assert(JSON.stringify(old.binding)===JSON.stringify(value.binding),'immutable binding changed');await store({binding:old.binding,receipt:value.receipt,provider_observations:value.observations})}};
 const outcome=(op,result)=>({schema_version:1,status:'SUCCEEDED',acceptance:'CONFIRMED_ACCEPTED',operation_id:op.identity.operation_id,payload_digest:op.identity.payload_digest,scope:op.scope,observed_at:new Date().toISOString(),provider_request_id:'owned-os-fixture',resource:op.resource,result,error:null,reconcile_required:false,retry:'NEVER'});
 const transport={
  destroy:async(op)=>{destroyCalls++;const saved=await read();prepareBeforeEffect=!!saved&&saved.binding.destroy_operation.identity.operation_id===op.identity.operation_id;assert(prepareBeforeEffect,'effect preceded durable prepare');if(mode!=='no-delete'&&child&&exists(child.pid)){const exited=once(child,'exit');child.kill('SIGTERM');await exited}return outcome(op,{deletion:'CONFIRMED'})},
  observe:async(op)=>{observeCalls++;if(mode==='unknown')throw Error('owned fixture unavailable');const present=mode==='present'||!!child&&exists(child.pid);return outcome(op,{provider_state:present?'RUNNING':'DESTROYED',health:present?'HEALTHY':'ABSENT'})}
 };
 const runtime={env:{HYPERFIDE_WRITER_ISOLATION_CONFIG:configFile},signal,registry:new Map([['railway',()=>transport]])};
 const custody=async(t,id)=>{assert((await fs.readdir(workspace)).length===0,'fixture workspace not empty');assert(child&&exists(child.pid),'owned child not running');custodyMeasured=true;return{operation_id:id,resource_identity_digest:digestDocument({scope:t.scope,resource:t.resource,boot_id:t.boot_id,preparation_digest:t.preparation_digest}),evidence_digest:digestDocument({evidence_scope:'COMPONENT_FIXTURE',empty_paths:await fs.readdir(workspace),owned_pid:child.pid}),observed_at:new Date().toISOString(),expires_at:new Date(Date.now()+10000).toISOString()}};
 const isolate=createProviderIsolation({...runtime,destructionPreflight:custody});
 const observe=createProviderIsolationObserver({...runtime,registry:new Map([['railway',()=>({observe:transport.observe})]])});
 const readonlyJournal={read,recordObservation:async(value)=>{observations.push(clone(value));const file=await fs.open(path.join(root,'observation-'+observations.length+'.json'),'wx',0o600);try{await file.writeFile(JSON.stringify(value));await file.sync()}finally{await file.close()}}};
 await check(0,async()=>assert(permits.isVerifiedIsolationPermit(permit),'real signature not privately branded'));
 await check(1,async()=>reject(()=>isolate(target.reference_key,operationId,clone(permit),signal,journal)));
 await check(2,async()=>reject(()=>isolate(target.reference_key,randomUUID(),permit,signal,journal),'ISOLATION_PERMIT_SCOPE'));
 await check(3,async()=>reject(()=>isolate('unlisted',operationId,permit,signal,journal),'ISOLATION_SCOPE_DENIED'));
 await check(4,async()=>reject(()=>createProviderIsolation(runtime)(target.reference_key,operationId,permit,signal,journal),'DESTRUCTION_PREFLIGHT_UNAVAILABLE'));
 child=spawn(process.execPath,['-e',"setInterval(()=>{},1000)"],{stdio:'ignore'});await once(child,'spawn');
 let receipt;
 await check(5,async()=>{receipt=await isolate(target.reference_key,operationId,permit,signal,journal);assert(custodyMeasured,'actual empty workspace not inspected')});
 await check(6,async()=>assert(prepareBeforeEffect&&prepareCalls===1&&journalRecords>=2,'fsynced prepare missing before actual kill'));
 await check(7,async()=>assert(child.exitCode!==null||child.signalCode!==null,'owned child not waited/reaped'));
 await check(8,async()=>assert(receipt?.status==='ISOLATED'&&receipt.observed_state==='ABSENT'&&observeCalls===1&&!exists(child.pid),'independent physical absence not measured'));
 await check(9,async()=>assert(receipt.evidence_scope==='COMPONENT_FIXTURE'&&!('activation_granted'in receipt),'component proof promoted to live authority'));
 const original=JSON.stringify((await read()).binding);
 await check(10,async()=>{await isolate(target.reference_key,operationId,permit,signal,journal);assert(destroyCalls===1&&observeCalls===2,'reconciliation repeated destructive effect')});
 await check(11,async()=>assert(JSON.stringify((await read()).binding)===original,'durable operation binding changed'));
 await check(12,async()=>{const renewal=verifier.verify(await permits.issueIsolationPermit(claims('EXTERNAL_WRITER_ISOLATION_ONLY'),issuer),expected);await reject(()=>isolate(target.reference_key,operationId,renewal,signal,journal),'ISOLATION_JOURNAL_CONFLICT');assert(destroyCalls===1,'renewal destroyed again')});
 await check(13,async()=>{assert(permits.isVerifiedWriterObservationPermit(observationPermit),'distinct observation signature not branded');await reject(()=>observe(target.reference_key,operationId,permit,signal,readonlyJournal),'OBSERVATION_PERMIT_REQUIRED')});
 await check(14,async()=>reject(()=>observe(target.reference_key,operationId,observationPermit,signal,{read:async()=>null,recordObservation:readonlyJournal.recordObservation}),'ISOLATION_OPERATION_UNKNOWN'));
 await check(15,async()=>{await reject(()=>isolate(target.reference_key,operationId,observationPermit,signal,journal));assert(destroyCalls===1,'observation permit gained destruction')});
 let observed;
 await check(16,async()=>{observed=await observe(target.reference_key,operationId,observationPermit,signal,readonlyJournal);assert(observed.status==='OBSERVED'&&observed.observed_state==='ABSENT'&&observed.authority==='OBSERVATION_ONLY','new exact-resource observation missing')});
 await check(17,async()=>assert(observations[0].authorization_digest===observationPermit.permit_digest&&observations[0].provider_observation.operation.kind==='observe'&&JSON.stringify(observations[0].binding)===original,'fresh observation provenance absent'));
 await check(18,async()=>{mode='unknown';const unknown=await observe(target.reference_key,operationId,observationPermit,signal,readonlyJournal);assert(unknown.status==='UNKNOWN'&&unknown.observed_state==='UNKNOWN','cached prior absence became proof')});
 await check(19,async()=>{mode='present';const present=await observe(target.reference_key,operationId,observationPermit,signal,readonlyJournal);assert(present.status==='OBSERVED'&&present.observed_state==='PRESENT','actual present result lost')});
 await check(20,async()=>{mode='unknown';const unknown=await observe(target.reference_key,operationId,observationPermit,signal,readonlyJournal);assert(unknown.status==='UNKNOWN','transport failure granted observation')});
 await check(21,async()=>assert(destroyCalls===1&&prepareCalls===1&&!('prepare'in readonlyJournal),'observer acquired prepare/destroy'));
 await check(22,async()=>{const state=await read();await reject(()=>observe(target.reference_key,operationId,observationPermit,signal,{read:async()=>({...state,binding:{...state.binding,resource_identity_digest:digestDocument({wrong:true})}}),recordObservation:readonlyJournal.recordObservation}),'ISOLATION_JOURNAL_CONFLICT')});
 await check(23,async()=>{const wrong=observerVerifier.verifySigned(await permits.issueWriterObservationPermit({...claims('EXTERNAL_WRITER_OBSERVATION_ONLY'),resources:[{reference_key:'other',topology_digest:target.resource_topology_digest}]},issuer));await reject(()=>observe(target.reference_key,operationId,wrong,signal,readonlyJournal),'OBSERVATION_PERMIT_SCOPE')});
 await check(24,async()=>{const c=new AbortController();c.abort();const before=observeCalls;await reject(()=>observe(target.reference_key,operationId,observationPermit,c.signal,readonlyJournal),'AUTH_EXPIRED');assert(before===observeCalls,'cancelled request invoked provider')});
 await check(25,async()=>{const brief=claims('EXTERNAL_WRITER_OBSERVATION_ONLY');brief.expires_at=new Date(Date.now()+100).toISOString();const p=observerVerifier.verifySigned(await permits.issueWriterObservationPermit(brief,issuer));await new Promise(r=>setTimeout(r,120));const before=observeCalls;await reject(()=>observe(target.reference_key,operationId,p,signal,readonlyJournal));assert(before===observeCalls,'expired authority invoked provider')});
 await check(26,async()=>{await fs.chmod(configFile,0o644);try{await reject(()=>observe(target.reference_key,operationId,observationPermit,signal,readonlyJournal),'ISOLATION_CONFIG_INVALID')}finally{await fs.chmod(configFile,0o600)}});
 await check(27,async()=>{
  mode='no-delete';const nextId=randomUUID(),nextClaims={...claims('EXTERNAL_WRITER_ISOLATION_ONLY'),operation_id:nextId};const nextPermit=verifier.verifySigned(await permits.issueIsolationPermit(nextClaims,issuer));
  child=spawn(process.execPath,['-e',"setInterval(()=>{},1000)"],{stdio:'ignore'});await once(child,'spawn');
  const nextJournal={read:async()=>null,prepare:async(binding)=>({created:true,state:{binding,receipt:null}}),record:async()=>{}};
  const noDelete=createProviderIsolation({...runtime,destructionPreflight:custody,registry:new Map([['railway',()=>({destroy:async(op)=>outcome(op,{deletion:'CONFIRMED'}),observe:transport.observe})]])});
  const result=await noDelete(target.reference_key,nextId,nextPermit,signal,nextJournal);assert(result.status==='UNKNOWN'&&exists(child.pid),'accepted delete inferred physical absence');
 });
 if(child&&exists(child.pid)){const exit=once(child,'exit');child.kill('SIGTERM');await exit}
 cleanup=!child||!exists(child.pid);await fs.rm(root,{recursive:true,force:true});root=null;
}catch(e){console.error(e.stack??e);failures++}
finally{
 if(child&&exists(child.pid)){const exit=once(child,'exit');child.kill('SIGKILL');await exit}
 if(root)await fs.rm(root,{recursive:true,force:true});
 console.log(JSON.stringify({type:'fixture_cleanup',resources:[],complete:cleanup}));process.exitCode=failures||!cleanup?1:0;
}
"""
def main():
 if sys.argv[1:]==["--inventory"]:print(json.dumps(IDS));return 0
 if sys.argv[1:]:raise SystemExit("unknown arguments")
 env=dict(os.environ,HYPERFIDE_ISOLATION_ASSERTIONS=json.dumps(IDS))
 physical=subprocess.run(["node","--input-type=module","-e",SCRIPT],cwd=ROOT,env=env,timeout=60)
 failed=physical.returncode!=0;f=None;cleanup=False
 spec=importlib.util.spec_from_file_location("provider_intent_fixture",ROOT/"tests/hyperfide/cases/tasks/8_3.py");m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 def check(n,fn):
  nonlocal failed
  try:fn();actual="observed"
  except Exception as e:failed=True;actual=type(e).__name__+": "+str(e)
  print(json.dumps({"type":"assertion","id":IDS[n],"expected":"observed","actual":actual}),flush=True)
 def setup(f):
  m.prepare_provider_intent_fixture(f)
  f.connectivity=f.path/"connectivity.json"
  policy={"schema_version":1,"evidence_scope":"COMPONENT_FIXTURE","targets":[{"name":name,"url":"https://"+name+".component.invalid/check","header_name":"Authorization","header_prefix":"Bearer ","credential_ref":"secret-ref:fixture/"+name,"expected_status":200,"denied_statuses":[401,403],"expected_body_sha256":None} for name in ["coordinator","git","artifact","model"]],"timeout_ms":100,"maximum_attempts":3,"base_backoff_ms":100,"max_backoff_ms":2000,"proof_max_age_ms":10000}
  f.connectivity.write_text(json.dumps(policy));f.connectivity.chmod(0o600);f.env["HYPERFIDE_CONNECTIVITY_CONFIG"]=str(f.connectivity)
  # Distinct target pools publish self-digested manifests derived from the source preparation.
  org=f.ids["organisation"];parent=f.sql("SELECT manifest FROM hyperfide.environment_profiles WHERE organisation_id=$1 AND id=$2",[org,f.profile])[0]["manifest"]
  canonical=lambda value:json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()
  def lower_cpu(profile):profile["resources"]["cpu_millis"]-=1
  def unbound(value):value["profile"]["profile_version"]="tampered-without-rehash"
  f.targets={}
  for key,change,tamper in [("compatible",None,None),("incompatible",lower_cpu,None),("unbound",None,unbound)]:
   value=copy.deepcopy(parent);value["profile"]["profile_version"]=key+"-"+uuid.uuid4().hex[:8]
   if change:change(value["profile"])
   value.pop("digest");value["digest"]=m.sha(canonical(value))
   if tamper:tamper(value)
   profile=str(uuid.uuid4());pool=str(uuid.uuid4())
   f.sql("INSERT INTO hyperfide.environment_profiles(organisation_id,id,provider,runtime_platform,content_digest,manifest) VALUES($1,$2,'railway','linux-x86_64',$3,$4)",[org,profile,value["digest"],value])
   entry=copy.deepcopy(f.config["pools"][0]);entry.update(id=pool,profile_id=profile,preparation_digest=value["digest"])
   f.config["pools"].append(entry);f.targets[key]={"pool":pool,"profile":profile,"preparation":value["digest"]}
  f.configfile.write_text(json.dumps(f.config));f.connectivity_policy=policy
 def invoke(action,value,component="8.4",key="provisioner"):
  return f.invoke(action,value,component=component,key=key)
 def result(action,value,component="8.4",key="provisioner"):
  status,response=invoke(action,value,component,key);m.expect(status==200 and response.get("ok") is True,(status,response));return response["result"]
 def reject(action,value,code=None):
  status,response=invoke(action,value);m.expect(status>=400 or response.get("ok") is False,(status,response))
  if code:m.expect(code in json.dumps(response),response)
 try:
  f=m.pools.ProvisionerFixture(extra_components=["8.2","8.3","8.4"],extra_setup=setup)
  check(28,lambda:m.expect(result("provider.pools.configure",{},"8.2","operator")["configured"]==1+len(f.targets),"actual pools not configured"))
  m.seed_provider_capacity(f);org=f.ids["organisation"];run=f.ids["run"]
  request={"run_id":run,"pool_id":f.pool,"sandbox_id":str(uuid.uuid4()),"request_key":str(uuid.uuid4()),"deadline_at":m.utc(),"reservation_ids":f.reservations,"profile_id":f.profile,"preparation_digest":f.preparation,"purpose":"PREPARATION"}
  created=result("provider.intents.prepare-create",request,"8.3","operator")["intent"];op=created["operation"]
  observation_id=str(uuid.uuid4())
  observed=time.strftime("%Y-%m-%dT%H:%M:%S",time.gmtime())+".000Z"
  outcome={"schema_version":1,"status":"UNKNOWN","acceptance":"UNKNOWN","operation_id":op["identity"]["operation_id"],"payload_digest":op["identity"]["payload_digest"],"scope":op["scope"],"observed_at":observed,"provider_request_id":"COMPONENT_FIXTURE_NOT_LIVE","resource":None,"result":None,"error":{"code":"RATE_LIMIT","provider_code":None,"message":"Explicit fixture observation; no provider request","retry_after_ms":100},"reconcile_required":True,"retry":"AFTER_RECONCILIATION"}
  evidence={"operation":op,"outcome":outcome}
  f.sql("INSERT INTO hyperfide.provider_observations(organisation_id,id,intent_id,operation_id,payload_digest,observation,observed_at,evidence_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[org,observation_id,created["id"],op["identity"]["operation_id"],op["identity"]["payload_digest"],evidence,observed,m.sha(json.dumps(evidence,sort_keys=True,separators=(",",":")).encode())])
  check(29,lambda:reject("provider.placement.record-failure",{"pool_id":f.pool,"failed":True},"INVALID_REQUEST"))
  check(30,lambda:reject("provider.placement.record-failure",{"observation_id":str(uuid.uuid4())},"PROVIDER_FAILURE_UNVERIFIED"))
  state={}
  def backoff():
   state.update(result("provider.placement.record-failure",{"observation_id":observation_id}));m.expect(state["recorded"] is True and f.sql("SELECT state,failure_count FROM hyperfide.provider_pool_health WHERE organisation_id=$1 AND pool_id=$2",[org,f.pool])[0]=={"state":"OPEN","failure_count":1},"durable backoff missing")
  check(31,backoff)
  check(32,lambda:m.expect(result("provider.placement.record-failure",{"observation_id":observation_id})["recorded"] is False and f.sql("SELECT failure_count FROM hyperfide.provider_pool_health WHERE organisation_id=$1 AND pool_id=$2",[org,f.pool])[0]["failure_count"]==1,"same observation charged twice"))
  check(33,lambda:m.expect(state["reconciliation_required"] is True,"unknown provider delivery allowed blind retry"))
  def wrong_run():
   # A separate real run and durable intent, not a forged request principal.
   other_run=str(uuid.uuid4());other_intent=str(uuid.uuid4());other_observation=str(uuid.uuid4());other_sandbox=str(uuid.uuid4())
   f.sql("INSERT INTO hyperfide.runs(organisation_id,id,project_id,spec_revision_id,policy_digest,authority_epoch,state) VALUES($1,$2,$3,$4,$5,$6,'RUNNING')",[org,other_run,f.ids["project"],f.ids["spec"],m.sha(b"other-fixture-policy"),f.ids["epoch"]])
   f.sql("INSERT INTO hyperfide.sandboxes(organisation_id,id,pool_id,preparation_digest) VALUES($1,$2,$3,$4)",[org,other_sandbox,f.pool,f.preparation])
   f.sql("INSERT INTO hyperfide.provisioning_intents(organisation_id,run_id,id,pool_id,sandbox_id,configuration_digest,kind,request_key,request_digest,payload_digest,operation,boot_generation,preparation_purpose,profile_id) SELECT organisation_id,$3,$4,pool_id,$6,configuration_digest,kind,$5,request_digest,payload_digest,operation,boot_generation,preparation_purpose,profile_id FROM hyperfide.provisioning_intents WHERE organisation_id=$1 AND id=$2",[org,created["id"],other_run,other_intent,str(uuid.uuid4()),other_sandbox])
   f.sql("INSERT INTO hyperfide.provider_observations(organisation_id,id,intent_id,operation_id,payload_digest,observation,observed_at,evidence_digest) SELECT organisation_id,$3,$4,operation_id,payload_digest,observation,observed_at,evidence_digest FROM hyperfide.provider_observations WHERE organisation_id=$1 AND id=$2",[org,observation_id,other_observation,other_intent])
   reject("provider.placement.record-failure",{"observation_id":other_observation},"AUTH_SCOPE_DENIED")
  check(34,wrong_run)
  def private_policy():
   f.connectivity.chmod(0o644)
   try:reject("provider.placement.record-failure",{"observation_id":observation_id},"CONNECTIVITY_CONFIG_INVALID")
   finally:f.connectivity.chmod(0o600)
  check(35,private_policy)
  check(36,lambda:reject("provider.placement.probe",{"pool_id":f.pool,"sandbox_id":request["sandbox_id"],"run_id":run,"native_sandbox_id":"caller"}))
  check(37,lambda:reject("provider.relocation.confirm-enrollment",{"run_id":run,"plan_id":str(uuid.uuid4()),"sandbox_id":request["sandbox_id"]},"RELOCATION_PLAN_INVALID"))
  # Relocation fixture: durable task/attempt/checkpoint rows for the original sandbox and
  # seeded COMPONENT_FIXTURE connectivity records for the targets (no live pool probe).
  rel={k:str(uuid.uuid4()) for k in ("feature","task","slot","attempt","lease","repository","artifact","checkpoint")}
  old_sandbox=request["sandbox_id"];epoch=f.ids["epoch"];packet=m.sha(b"relocation-packet")
  m.expect(len(f.sql("SELECT 1 FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2 AND pool_id=$3",[org,old_sandbox,f.pool]))==1,"original sandbox missing")
  f.sql("INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES($1,$2,$3,'relocation-fixture',1)",[org,run,rel["feature"]])
  f.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave,generation,state) VALUES($1,$2,$3,'relocation-fixture',$4,$5,$6,'{}',1,1,'RUNNING')",[org,run,rel["task"],rel["feature"],f.ids["spec"],m.sha(b"criteria")])
  f.sql("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind) VALUES($1,$2,$3,'relocation-fixture',1,'AGENT')",[org,rel["slot"],old_sandbox])
  f.sql("INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,execution_state,compute_authority,sandbox_id,slot_id,sandbox_boot_generation,lease_expires_at) VALUES($1,$2,$3,$4,1,$5,$6,'RUNNING','CURRENT',$7,$8,1,clock_timestamp()+interval '10 minutes')",[org,run,rel["attempt"],rel["task"],epoch,packet,old_sandbox,rel["slot"]])
  f.sql("INSERT INTO hyperfide.compute_leases(organisation_id,run_id,id,attempt_id,attempt_generation,authority_epoch,sandbox_boot_generation,expires_at) VALUES($1,$2,$3,$4,1,$5,1,clock_timestamp()+interval '10 minutes')",[org,run,rel["lease"],rel["attempt"],epoch])
  f.sql("INSERT INTO hyperfide.repositories(organisation_id,id,project_id,name,url) VALUES($1,$2,$3,'relocation-fixture','https://example.invalid/relocation.git')",[org,rel["repository"],f.ids["project"]])
  f.sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES($1,$2,repeat('b',40))",[org,rel["repository"]])
  f.sql("INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES($1,$2,$3,repeat('b',40),'refs/heads/main')",[org,run,rel["repository"]])
  checkpoint_digest=m.sha(b"relocation-checkpoint")
  f.sql("INSERT INTO hyperfide.artifacts(organisation_id,run_id,id,digest,size_bytes,storage_backend,storage_key,status) VALUES($1,$2,$3,$4,21,'fixture','relocation-checkpoint','COMPLETE')",[org,run,rel["artifact"],checkpoint_digest])
  f.sql("INSERT INTO hyperfide.checkpoints(organisation_id,run_id,id,attempt_id,attempt_generation,artifact_id,repository_id,source_object_id,input_packet_digest,support_level) VALUES($1,$2,$3,$4,1,$5,$6,repeat('b',40),$7,'SOURCE_ONLY')",[org,run,rel["checkpoint"],rel["attempt"],rel["artifact"],rel["repository"],packet])
  digest_script="import fs from 'node:fs';import{digestDocument}from'./services/hyperfide/dist/providers/pools.js';process.stdout.write(digestDocument(JSON.parse(fs.readFileSync(0,'utf8'))));"
  endpoints=subprocess.run(["node","--input-type=module","-e",digest_script],input=json.dumps(f.connectivity_policy["targets"]),cwd=ROOT,env=f.env,text=True,capture_output=True,timeout=10)
  m.expect(endpoints.returncode==0,endpoints.stderr)
  saved=f.pool;saved_reservations=list(f.reservations)
  for target in f.targets.values():
   f.pool=target["pool"];m.seed_provider_capacity(f)
   target["config"]=f.sql("SELECT configuration_digest FROM hyperfide.provider_pool_configurations WHERE organisation_id=$1 AND pool_id=$2 AND active",[org,target["pool"]])[0]["configuration_digest"]
   target["sandbox"]=str(uuid.uuid4())
   f.sql("INSERT INTO hyperfide.sandboxes(organisation_id,id,pool_id,native_sandbox_id,observed_state,preparation_digest) VALUES($1,$2,$3,$4,'RUNNING',$5)",[org,target["sandbox"],target["pool"],"relocation-target-"+target["sandbox"],target["preparation"]])
   f.sql("INSERT INTO hyperfide.provider_connectivity_probes(organisation_id,id,pool_id,sandbox_id,boot_generation,configuration_digest,endpoints_digest,credential_lineage,enrollment_evidence_digest,evidence_digest,evidence_scope,status,observation,expires_at) VALUES($1,$2,$3,$4,1,$5,$6,'component-fixture',$7,$8,'COMPONENT_FIXTURE','PASS',$9,clock_timestamp()+interval '10 minutes')",[org,str(uuid.uuid4()),target["pool"],target["sandbox"],target["config"],endpoints.stdout,m.sha(b"fixture-enrollment"),m.sha(b"fixture-probe"),{"evidence_scope":"COMPONENT_FIXTURE","live_pool_qualified":False}])
  f.pool=saved;f.reservations=saved_reservations
  plan_input=lambda key:{"run_id":run,"old_attempt_id":rel["attempt"],"expected_generation":"1","expected_authority_epoch":epoch,"target_pool_id":f.targets[key]["pool"],"checkpoint_id":rel["checkpoint"],"reason_observation_id":observation_id}
  attempt_state=lambda:f.sql("SELECT compute_authority FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,rel["attempt"]])[0]["compute_authority"]
  def incompatible():
   reject("provider.relocation.plan",plan_input("incompatible"),"ENVIRONMENT_INCOMPATIBLE")
   m.expect(attempt_state()=="CURRENT","refused relocation fenced the source attempt")
  check(38,incompatible)
  def unbound():
   reject("provider.relocation.plan",plan_input("unbound"),"ENVIRONMENT_COMPATIBILITY_UNVERIFIED")
   m.expect(attempt_state()=="CURRENT","unbound manifest fenced the source attempt")
  check(39,unbound)
  plan={}
  def compatible():
   plan.update(result("provider.relocation.plan",plan_input("compatible")))
   m.expect(plan["created"] is True and plan["state"]=="PENDING_ADMISSION" and plan["preparation_digest"]==f.targets["compatible"]["preparation"],plan)
   m.expect(isinstance(plan["environment_compatibility_evidence_digest"],str) and plan["environment_compatibility_evidence_digest"].startswith("sha256:"),"compatibility evidence missing")
  check(40,compatible)
  def preserved():
   source=plan["source_manifest"]
   m.expect(source=={"checkpoint_id":rel["checkpoint"],"artifact_digest":checkpoint_digest,"repository_id":rel["repository"],"source_object_id":"b"*40,"input_packet_digest":packet,"support_level":"SOURCE_ONLY"},source)
   row=f.sql("SELECT task_id,old_authority_epoch,source_manifest_digest,target_pool_id FROM hyperfide.provider_relocation_plans WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,plan["id"]])[0]
   m.expect(row=={"task_id":rel["task"],"old_authority_epoch":epoch,"source_manifest_digest":plan["source_manifest_digest"],"target_pool_id":f.targets["compatible"]["pool"]},row)
  check(41,preserved)
  def fenced():
   lease=f.sql("SELECT state FROM hyperfide.compute_leases WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,rel["lease"]])[0]["state"]
   m.expect(attempt_state()=="REVOKED" and lease=="REVOKED" and plan["old_compute_fenced"] is True and plan["admission_granted"] is False,"old compute authority not fenced")
  check(42,fenced)
  def replay():
   again=result("provider.relocation.plan",plan_input("compatible"))
   m.expect(again["created"] is False and again["plan"]["id"]==plan["id"],again)
   reject("provider.relocation.plan",plan_input("incompatible"),"IDEMPOTENCY_CONFLICT")
  check(43,replay)
  def fresh():
   m.expect(plan["fresh_enrollment_required"] is True,"fresh enrollment not demanded")
   reject("provider.relocation.confirm-enrollment",{"run_id":run,"plan_id":plan["id"],"sandbox_id":f.targets["compatible"]["sandbox"]},"ENROLLMENT_UNVERIFIED")
   m.expect(f.sql("SELECT state FROM hyperfide.provider_relocation_plans WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,plan["id"]])[0]["state"]=="PENDING_ADMISSION","unenrolled target admitted")
  check(44,fresh)
  f.close();f=None;cleanup=True
 finally:
  if f is not None:f.close()
  print(json.dumps({"type":"cleanup","resources":[],"complete":cleanup and physical.returncode==0}),flush=True)
 return 1 if failed or not cleanup else 0
if __name__=="__main__":sys.exit(main())
