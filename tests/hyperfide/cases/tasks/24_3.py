#!/usr/bin/env python3
from pathlib import Path
import importlib.util,sys
spec=importlib.util.spec_from_file_location("recovery_common",Path(__file__).with_name("24_1.py"));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
FENCING_PROBE="\nimport {FileExternalFenceJournal,createExternalWriterFence,createExternalWriterObserver} from './services/hyperfide/dist/recovery/fencing.js';\nimport fs from 'node:fs/promises';\nimport {randomUUID,createHash} from 'node:crypto';\nconst root=await fs.mkdtemp('/tmp/hyperfide/fence-journal-');await fs.chmod(root,0o700);\nconst D='sha256:'+'a'.repeat(64),deployment=randomUUID(),op=randomUUID();\nconst binding={deployment_id:deployment,operation_id:op,source_epoch:null,topology_digest:D,authority_digest:D,authority_nonce:randomUUID()};\nconst resource={schema_version:1,reference_key:'constructor',operation_id:op,topology_digest:D,resource_identity_digest:D,destroy_operation:{operation_id:op},authority_digest:D,custody_evidence_digest:D,custody_expires_at:new Date(Date.now()+10000).toISOString()};\nconst outcomes={};\ntry {\n const journal=new FileExternalFenceJournal(root);\n await journal.withOperation(binding,async get=>{\n  const disk=JSON.parse(await fs.readFile(root+'/'+op+'.json','utf8'));\n  outcomes['authority-durable-before-effects']=disk.binding.authority_digest===D&&disk.binding.authority_nonce===binding.authority_nonce;\n  const slot=get('constructor');outcomes['prototype-key-is-data']=(await slot.read())===null;\n  const first=await slot.prepare(resource);outcomes['first-resource-prepared']=first.created===true&&first.state.state==='PREPARED';\n  await slot.record({binding:resource,receipt:null,observations:[]});\n });\n await journal.withOperation(binding,async get=>{\n  const slot=get('constructor'),old=await slot.prepare(resource);\n  outcomes['unknown-keeps-original-operation']=old.created===false&&old.state.state==='UNKNOWN'&&old.state.binding.destroy_operation.operation_id===op;\n  let conflict=false;try{await slot.prepare({...resource,resource_identity_digest:'sha256:'+'b'.repeat(64)})}catch(e){conflict=e.code==='EXTERNAL_FENCE_JOURNAL_CONFLICT'}\n  outcomes['resource-substitution-refused']=conflict;\n });\n let entered=false;try{await journal.withOperation({...binding,operation_id:randomUUID()},async()=>{entered=true})}catch(e){outcomes['nonce-cross-operation-refused']=e.code==='EXTERNAL_FENCE_NONCE_CONFLICT'&&!entered}\n\n const renewed={...binding,authority_digest:'sha256:'+'b'.repeat(64),authority_nonce:randomUUID()};\n await journal.withOperation(renewed,async get=>{\n  const prior=await get('constructor').read();\n  outcomes['renewal-retains-original-unknown']=prior?.state==='UNKNOWN'&&prior.binding.authority_digest===binding.authority_digest;\n });\n const retained=JSON.parse(await fs.readFile(root+'/'+op+'.json','utf8'));\n outcomes['renewed-authority-append-only']=retained.authorizations.length===2&&retained.binding.authority_digest===binding.authority_digest;\n outcomes['operation-locks-cleaned']=(await fs.readdir(root)).every(f=>!f.endsWith('.lock'));\n const hardOp=randomUUID(),hardBinding={...binding,operation_id:hardOp,authority_nonce:null};\n await journal.withOperation(hardBinding,async()=>{});\n await fs.link(root+'/'+hardOp+'.json',root+'/alias.json');\n try{await journal.withOperation(hardBinding,async()=>{})}catch(e){outcomes['hardlink-journal-refused']=e.code==='EXTERNAL_FENCE_JOURNAL_UNSAFE'}\n const config={schema_version:1,deployment_id:deployment,organisation_id:randomUUID(),run_id:randomUUID(),source_epoch:null,evidence_scope:'LIVE_PROVIDER',legacy_topology_digest:D,legacy_pid_namespace:await fs.readlink('/proc/self/ns/pid'),legacy_mount_namespace:await fs.readlink('/proc/self/ns/mnt'),required_writer_ids:['writer'],resources:[{reference_key:'writer-node',topology_digest:D,writer_ids:['writer'],backend:'PROVIDER'}]};\n let effects=0;const providers={isolateConfiguredResource:async()=>{effects++;throw new Error('unexpected external effect')}},legacy={disableAdmission:async()=>{effects++;throw new Error('unexpected legacy effect')},observeIsolation:async()=>{effects++;throw new Error('unexpected legacy observation')}};\n const authority={kind:'ISOLATION_PERMIT',permit:{}};\n try{createExternalWriterFence({...config,evidence_scope:'COMPONENT_FIXTURE'},providers,legacy,journal,authority)}catch(e){outcomes['fixture-proof-not-production']=e.code==='EXTERNAL_FENCE_EVIDENCE_SCOPE_MISMATCH'}\n try{const fence=createExternalWriterFence(config,providers,legacy,journal,authority);await fence.isolate({deployment_id:deployment,operation_id:randomUUID(),source_epoch:null})}catch(e){outcomes['unbranded-permit-refused-before-effects']=effects===0}\n try{createExternalWriterFence({...config,required_writer_ids:['writer','missing']},providers,legacy,journal,authority)}catch(e){outcomes['uncovered-writer-refused']=e.code==='EXTERNAL_FENCE_CONFIG_INCOMPLETE'}\n try{createExternalWriterFence({...config,resources:[{...config.resources[0],backend:'OWNED_HOST'}]},providers,legacy,journal,authority)}catch(e){outcomes['missing-host-backend-refused']=e.code==='EXTERNAL_FENCE_BACKEND_UNAVAILABLE'}\n\n const completeOp=randomUUID(),completeBinding={...binding,operation_id:completeOp,authority_nonce:null};\n const now=Date.now(),completeReceipt={expires_at:new Date(now+20000).toISOString(),deployment_id:deployment,operation_id:completeOp,source_epoch:null,fence_id:completeOp,isolated_writer:'topology:'+D.slice(7),observed_at:new Date(now).toISOString(),evidence_digest:D};\n await journal.withOperation(completeBinding,async(_,recordCompletion)=>{await recordCompletion(completeReceipt)});\n const retainedReceipt=await journal.readCompleted({deployment_id:deployment,operation_id:completeOp,source_epoch:null,topology_digest:D});\n outcomes['completion-exact-json-bytes-retained']=JSON.stringify(retainedReceipt)===JSON.stringify(completeReceipt);\n const savedComplete=JSON.parse(await fs.readFile(root+'/'+completeOp+'.json','utf8'));\n outcomes['completion-persisted-before-return']=savedComplete.completion_receipt_json===JSON.stringify(completeReceipt);\n const originalProof='sha256:'+createHash('sha256').update(JSON.stringify(completeReceipt)).digest('hex');\n await journal.withOperation(completeBinding,async(_,recordCompletion)=>{await recordCompletion({...completeReceipt,evidence_digest:'sha256:'+'b'.repeat(64)})});\n const acceptedOld=await journal.readCompleted({deployment_id:deployment,operation_id:completeOp,source_epoch:null,topology_digest:D,expected_proof_digest:originalProof});\n outcomes['accepted-completion-proof-survives-later-observation']=JSON.stringify(acceptedOld)===JSON.stringify(completeReceipt);\n\n try{await journal.readCompleted({deployment_id:deployment,operation_id:op,source_epoch:null,topology_digest:D})}catch(e){outcomes['missing-completion-refused']=e.code==='EXTERNAL_FENCE_COMPLETION_UNVERIFIED'}\n try{await journal.readCompleted({deployment_id:deployment,operation_id:completeOp,source_epoch:null,topology_digest:'sha256:'+'b'.repeat(64)})}catch(e){outcomes['completion-topology-substitution-refused']=e.code==='EXTERNAL_FENCE_COMPLETION_UNVERIFIED'}\n\n const obsBinding={...binding,authority_digest:'sha256:'+'c'.repeat(64),authority_nonce:randomUUID()};\n await journal.withObservation(obsBinding,async get=>{\n  const slot=get('constructor'),before=await slot.read();\n  outcomes['observation-capability-has-no-mutation-admission']=!('prepare' in slot)&&!('record' in slot);\n  const now=Date.now(),observation={reference_key:'constructor',operation_id:op,status:'UNKNOWN',observed_state:'UNKNOWN',topology_digest:D,resource_identity_digest:D,observed_at:new Date(now).toISOString(),expires_at:new Date(now+10000).toISOString(),evidence_digest:D,evidence_scope:'COMPONENT_FIXTURE',authority:'OBSERVATION_ONLY'};\n  await slot.recordObservation({binding:before.binding,observation,provider_observation:{operation:{operation_id:op},outcome:{status:'UNKNOWN'}},authorization_digest:obsBinding.authority_digest,authorization_expires_at:new Date(now+15000).toISOString()});\n  const after=await slot.read();outcomes['observation-retains-destructive-binding']=JSON.stringify(after.binding)===JSON.stringify(before.binding)&&after.state===before.state&&after.receipt===before.receipt;\n  outcomes['observation-journal-persists-only-new-read']=after.writer_observations.length===1&&after.writer_observations[0].authorization_digest===obsBinding.authority_digest;\n  try{await get('never-prepared').recordObservation({binding:before.binding,observation,provider_observation:{operation:{},outcome:{}},authorization_digest:obsBinding.authority_digest,authorization_expires_at:new Date(now+15000).toISOString()})}catch(e){outcomes['observation-cannot-prepare-new-resource']=e.code==='EXTERNAL_FENCE_OBSERVATION_UNPREPARED'}\n });\n const missingObservation={...binding,operation_id:randomUUID(),authority_nonce:randomUUID()};\n try{await journal.withObservation(missingObservation,async()=>{})}catch(e){outcomes['observation-missing-operation-no-nonce-custody']=e.code==='EXTERNAL_FENCE_OBSERVATION_UNPREPARED'&&!(await fs.readdir(root)).includes('nonce-'+missingObservation.authority_nonce+'.json')}\n let observeEffects=0;\n try{const reader=createExternalWriterObserver(config,{observeConfiguredResource:async()=>{observeEffects++;throw Error('unexpected read')}},legacy,journal);await reader.observe({},new AbortController().signal)}catch(e){outcomes['observation-unbranded-proof-refused']=observeEffects===0&&effects===0}\n console.log(JSON.stringify(outcomes));\n if(Object.keys(outcomes).length!==25||Object.values(outcomes).some(v=>v!==true))throw new Error('journal/authority regression');\n}finally{await fs.rm(root,{recursive:true,force:true})}\n"
SERVICE_PROBE="\nimport {startExternalFencingService} from './services/hyperfide/dist/recovery/fencing_service.js';\nimport {externalFenceTopologyDigest} from './services/hyperfide/dist/recovery/fencing.js';\nimport {issueIsolationPermit} from './services/hyperfide/dist/identity/credentials.js';\nimport {createIsolationHttpClient} from './services/hyperfide/dist/transport/isolation.js';\nimport {createProviderIsolation} from './services/hyperfide/dist/providers/placement.js';\nimport fs from 'node:fs/promises';import net from 'node:net';\nimport {randomUUID,generateKeyPairSync} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';\nconst root=await fs.mkdtemp('/tmp/hyperfide/fencing-service-');await fs.chmod(root,0o700);\nconst outcomes={};let service;const controller=new AbortController();\ntry{\n for(const key of Object.keys(process.env))if(key==='DATABASE_URL'||key.startsWith('PG')||key==='HF_IDENTITY_CONFIG_FILE')delete process.env[key];\n const cert=root+'/cert.pem',key=root+'/key.pem';\n await promisify(execFile)('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1','-days','1']);await fs.chmod(key,0o600);\n const pair=generateKeyPairSync('ed25519'),signer=root+'/signer.pem',verifier=root+'/verifier.json';\n await fs.writeFile(signer,pair.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});\n await fs.writeFile(verifier,JSON.stringify({schema_version:1,issuers:[{key_id:'service-fixture',public_key_b64:pair.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64url')}]}),{mode:0o600});\n const socket=net.createServer();await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve)});const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));\n const D='sha256:'+'a'.repeat(64),topology={schema_version:1,deployment_id:randomUUID(),organisation_id:randomUUID(),run_id:randomUUID(),source_epoch:null,evidence_scope:'LIVE_PROVIDER',legacy_topology_digest:D,legacy_pid_namespace:await fs.readlink('/proc/self/ns/pid'),legacy_mount_namespace:await fs.readlink('/proc/self/ns/mnt'),required_writer_ids:['writer'],resources:[{reference_key:'writer-node',topology_digest:D,writer_ids:['writer'],backend:'PROVIDER'}]};\n const journal=root+'/journal';await fs.mkdir(journal,{mode:0o700});const origin='https://127.0.0.1:'+port;\n const config={schema_version:1,topology,journal_directory:journal,verifier_file:verifier,transport:{origin,host:'127.0.0.1',port,certificate:cert,private_key:key}},configFile=root+'/service.json';\n await fs.writeFile(configFile,JSON.stringify(config),{mode:0o600});\n let effects=0;const actualIsolation=createProviderIsolation({env:{},signal:controller.signal,registry:new Map()});const providers={isolateConfiguredResource:async(...args)=>{effects++;return actualIsolation(...args)}},legacy={disableAdmission:async()=>{throw new Error('No physical legacy isolation fixture configured')},observeIsolation:async()=>{throw new Error('No physical legacy isolation fixture configured')}};\n service=await startExternalFencingService({env:{HYPERFIDE_EXTERNAL_FENCE_CONFIG_FILE:configFile},signal:controller.signal,providers,legacy});\n outcomes['listener-starts-without-database']=!process.env.DATABASE_URL&&service.address===origin&&service.describe().activation_authority===false;\n const client=await createIsolationHttpClient({origin,caFile:cert,deadlineMs:3000});\n const claims=patch=>({schema_version:1,purpose:'EXTERNAL_WRITER_ISOLATION_ONLY',deployment_id:topology.deployment_id,organisation_id:topology.organisation_id,run_id:topology.run_id,operation_id:randomUUID(),source_epoch:null,topology_digest:externalFenceTopologyDigest(topology),resources:[{reference_key:'writer-node',topology_digest:D}],issued_at:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Date.now()+30000).toISOString(),nonce:randomUUID(),...patch});\n async function invoke(patch){const envelope=await issueIsolationPermit(claims(patch),{key_id:'service-fixture',private_key_file:signer});return client.isolate(envelope,new AbortController().signal)}\n const wrongTopology=await invoke({topology_digest:'sha256:'+'b'.repeat(64)});\n outcomes['signed-wrong-topology-no-effects']=wrongTopology.outcome!=='SUCCEEDED'&&effects===0&&(await fs.readdir(journal)).length===0;\n const wrongResources=await invoke({resources:[{reference_key:'other-writer',topology_digest:D}]});\n outcomes['signed-wrong-resources-no-effects']=wrongResources.outcome!=='SUCCEEDED'&&effects===0&&(await fs.readdir(journal)).length===0;\n const unavailable=await invoke({});\n outcomes['unavailable-physical-backend-stays-unknown']=unavailable.outcome==='UNKNOWN'&&effects===0;\n const files=await fs.readdir(journal);outcomes['unknown-retains-durable-authority-custody']=files.some(f=>f.endsWith('.json')&&!f.startsWith('nonce-'))&&files.some(f=>f.startsWith('nonce-'))&&files.every(f=>!f.endsWith('.lock'));\n await fs.chmod(configFile,0o644);try{await startExternalFencingService({env:{HYPERFIDE_EXTERNAL_FENCE_CONFIG_FILE:configFile},signal:controller.signal,providers,legacy})}catch(e){outcomes['unsafe-server-config-refused']=e.code==='EXTERNAL_FENCE_CONFIG_UNSAFE'}await fs.chmod(configFile,0o600);\n await fs.writeFile(configFile,JSON.stringify({...config,topology:{...topology,evidence_scope:'COMPONENT_FIXTURE'}}));try{await startExternalFencingService({env:{HYPERFIDE_EXTERNAL_FENCE_CONFIG_FILE:configFile},signal:controller.signal,providers,legacy})}catch(e){outcomes['fixture-topology-cannot-start-production-listener']=e.code==='EXTERNAL_FENCE_CONFIG_INVALID'}\n await service.close();service=undefined;\n outcomes['listener-shutdown-observed']=await new Promise(resolve=>{const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.destroy();resolve(false)});s.once('error',()=>resolve(true))});\n console.log(JSON.stringify(outcomes));if(Object.keys(outcomes).length!==8||Object.values(outcomes).some(v=>v!==true))throw new Error('Composite fencing boundary differs');\n}finally{controller.abort();await service?.close();await fs.rm(root,{recursive:true,force:true})}\n"
def fencing_tests():
 import subprocess,json
 process=subprocess.run(["node","--input-type=module"],input=FENCING_PROBE,text=True,capture_output=True,cwd=m.ROOT,timeout=30)
 m.expect(process.returncode==0,"Actual fencing journal probe failed: "+process.stderr[-400:])
 for key,value in json.loads(process.stdout).items():m.check("recovery.fence."+key,lambda value=value:m.expect(value is True))
 process=subprocess.run(["node","--input-type=module"],input=SERVICE_PROBE,text=True,capture_output=True,cwd=m.ROOT,timeout=30)
 m.expect(process.returncode==0,"Actual composite listener probe failed: "+process.stderr[-400:])
 for key,value in json.loads(process.stdout).items():m.check("recovery.fencing-service."+key,lambda value=value:m.expect(value is True))
import base64,contextlib,io,json,os,socket,ssl,subprocess,tempfile,time,uuid,shutil
from urllib import request as urlrequest,error as urlerror
DRAIN_MS=4000
FENCE_RESOURCE="hf-task-24.3-fencing-database"
INVENTORY={}
def u(n):return m.uid(0x100+n)
def q(text):return m.sql(text)
def restart(f):
 f.identity.stop();f.identity.start()
def fencing_record():return m.observation_dir()/"fencing-fixture.json"
def identity_module():
 spec=importlib.util.spec_from_file_location("actual_identity_fixture_24_3",m.ROOT/"tests/hyperfide/support/identity_fixture.py")
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
def fencing_configuration(root):
 cert,key=root/"cert.pem",root/"key.pem"
 subprocess.run(["openssl","req","-x509","-newkey","rsa:2048","-nodes","-keyout",str(key),"-out",str(cert),"-subj","/CN=127.0.0.1","-addext","subjectAltName=IP:127.0.0.1","-days","1"],check=True,capture_output=True);key.chmod(0o600)
 signer=root/"signer.pem";subprocess.run(["openssl","genpkey","-algorithm","Ed25519","-out",str(signer)],check=True,capture_output=True);signer.chmod(0o600)
 public=subprocess.check_output(["openssl","pkey","-in",str(signer),"-pubout","-outform","DER"],stderr=subprocess.DEVNULL)
 verifier=root/"verifier.json";verifier.write_text(json.dumps({"schema_version":1,"issuers":[{"key_id":"managed-fixture","public_key_b64":base64.urlsafe_b64encode(public[-32:]).decode().rstrip("=")}]}));verifier.chmod(0o600)
 with socket.socket() as sock:sock.bind(("127.0.0.1",0));port=sock.getsockname()[1]
 journal=root/"journal";journal.mkdir(mode=0o700)
 topology={"schema_version":1,"deployment_id":str(uuid.uuid4()),"organisation_id":str(uuid.uuid4()),"run_id":str(uuid.uuid4()),"source_epoch":None,"evidence_scope":"LIVE_PROVIDER","legacy_topology_digest":m.D,"legacy_pid_namespace":os.readlink("/proc/self/ns/pid"),"legacy_mount_namespace":os.readlink("/proc/self/ns/mnt"),"required_writer_ids":["writer"],"resources":[{"reference_key":"writer-node","topology_digest":m.D,"writer_ids":["writer"],"backend":"PROVIDER"}]}
 config=root/"service.json"
 config.write_text(json.dumps({"schema_version":1,"topology":topology,"journal_directory":str(journal),"verifier_file":str(verifier),"transport":{"origin":"https://127.0.0.1:"+str(port),"host":"127.0.0.1","port":port,"certificate":str(cert),"private_key":str(key)}}));config.chmod(0o600)
 return config,cert,port,journal
def listening(port):
 try:
  with socket.create_connection(("127.0.0.1",port),timeout=2):return True
 except OSError:return False
def managed_fencing_tests():
 """The provisioner service loads the registered external-fencing fragment with its real 8.4 and legacy-writer dependencies."""
 module=identity_module();root=Path(tempfile.mkdtemp(prefix="hf-fencing-component-"));root.chmod(0o700)
 database="hf_identity_"+uuid.uuid4().hex
 fencing_record().write_text(json.dumps({"database":database,"resource":FENCE_RESOURCE}))
 fixture=None
 try:
  config,cert,port,journal=fencing_configuration(root)
  fixture=module.IdentityFixture(service_role="provisioner",database=database,extra_components=m.component_dependencies(["external-fencing"]),extra_env={"HYPERFIDE_EXTERNAL_FENCE_CONFIG_FILE":str(config)})
  def ask(payload):
   status,response=fixture.request(fixture.operation("external-fencing","recovery.fencing.describe",payload));return response
  described=ask({})
  m.check("recovery.fencing-component.registered-provisioner-service",lambda:m.expect(described.get("ok") is True and "external-fencing" in [p.stem for p in fixture.components.glob("*.json")] and described["result"]["configured"] is True and described["result"]["writer_routes"]==1 and described["result"]["resources"]==1 and described["result"]["topology_digest"].startswith("sha256:"),str(described)))
  m.check("recovery.fencing-component.no-activation-authority",lambda:m.expect(described["result"]["activation_authority"] is False and described["result"]["database_required_for_listener"] is False and described["result"]["production_qualification"]=="NOT_ESTABLISHED_BY_CONFIGURATION"))
  closed=ask({"isolate":True})
  m.check("recovery.fencing-component.input-closed",lambda:m.expect(closed.get("ok") is False and closed["error"]["code"]=="EXTERNAL_FENCE_INPUT_INVALID",str(closed)))
  m.check("recovery.fencing-component.listener-bound",lambda:m.expect(listening(port)))
  def unsigned():
   context=ssl.create_default_context(cafile=str(cert))
   try:urlrequest.urlopen(urlrequest.Request("https://127.0.0.1:"+str(port)+"/v1/isolation",data=b"{}",method="POST",headers={"Content-Type":"application/json"}),context=context,timeout=5);m.expect(False,"Unsigned isolation request was accepted")
   except urlerror.HTTPError as e:m.expect(400<=e.code<500,"Unexpected unsigned isolation status "+str(e.code))
   m.expect([p.name for p in journal.iterdir()]==[],"Unsigned isolation request reached the fence journal")
  m.check("recovery.fencing-component.unsigned-isolation-refused",unsigned)
  fixture.stop()
  m.check("recovery.fencing-component.listener-closed-on-shutdown",lambda:m.expect(not listening(port)))
  fixture.env.pop("HYPERFIDE_EXTERNAL_FENCE_CONFIG_FILE")
  def refused():
   try:fixture.start()
   except AssertionError as e:
    fixture.child=None
    m.expect("COMPONENT_LOAD_FAILED" in str(e) and "Canonical private server fencing configuration required" in str(e),str(e)[:400]);return
   m.expect(False,"Provisioner started without trusted fencing configuration")
  m.check("recovery.fencing-component.missing-config-refuses-startup",refused)
 finally:
  if fixture:fixture.close()
  shutil.rmtree(root,ignore_errors=True)
def inflight(task,attempt,sandbox,slot,lease,key,session=None,execution="RUNNING",sandbox_state="RUNNING"):
 o,r=m.ORG,m.RUN
 text="BEGIN;\n"
 text+=f"INSERT INTO hyperfide.sandboxes(organisation_id,id,pool_id,observed_state) VALUES('{o}','{sandbox}','{m.uid(8)}','{sandbox_state}');\n"
 text+=f"INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind) VALUES('{o}','{slot}','{sandbox}','{key}',1,'AGENT');\n"
 text+=f"INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) VALUES('{o}','{r}','{task}','{key}','{m.uid(6)}','{m.uid(4)}','{m.D}','{{}}',1);\n"
 text+=f"INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,execution_state,compute_authority,sandbox_id,slot_id,sandbox_boot_generation,lease_expires_at) VALUES('{o}','{r}','{attempt}','{task}',1,'{m.EPOCH}','{m.D}','{execution}','CURRENT','{sandbox}','{slot}',1,clock_timestamp()+interval '30 minutes');\n"
 text+=f"UPDATE hyperfide.tasks SET generation=1,current_attempt_id='{attempt}',state='RUNNING',state_version=state_version+1 WHERE organisation_id='{o}' AND run_id='{r}' AND id='{task}';\n"
 text+=f"INSERT INTO hyperfide.compute_leases(organisation_id,run_id,id,attempt_id,attempt_generation,authority_epoch,sandbox_boot_generation,expires_at) VALUES('{o}','{r}','{lease}','{attempt}',1,'{m.EPOCH}',1,clock_timestamp()+interval '30 minutes');\n"
 if session:text+=f"INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id,attempt_id,sandbox_id,slot_id,sandbox_boot_generation,state) VALUES('{o}','{r}','{session}','WORKER','codex','fixture','{key}','{attempt}','{sandbox}','{slot}',1,'RUNNING');\n"
 q(text+"COMMIT;")
def control(kind,scope_id):return q(f"SELECT mode||':'||status||':'||generation FROM hyperfide.recovery_controls WHERE scope_kind='{kind}' AND scope_id='{scope_id}';")
def gate(kind,scope_id):return q(f"SELECT mode FROM hyperfide.execution_controls WHERE scope_kind='{kind}' AND scope_id='{scope_id}';")
def attempt_state(attempt):return q(f"SELECT compute_authority||':'||execution_state FROM hyperfide.attempts WHERE id='{attempt}';")
def lease_state(lease):return q(f"SELECT state FROM hyperfide.compute_leases WHERE id='{lease}';")
def run_state():return q(f"SELECT state FROM hyperfide.runs WHERE id='{m.RUN}';")
def open_debts(op):return sorted(q(f"SELECT id FROM hyperfide.recovery_resource_debts WHERE operation_id='{op}' AND status<>'RESOLVED';").split())
def debt_resources(op,kind):return sorted(q(f"SELECT resource_id FROM hyperfide.recovery_resource_debts WHERE operation_id='{op}' AND resource_kind='{kind}';").split())
def record_inventory(name,value):
 INVENTORY[name]=value
 m.observation_dir().joinpath("stop-inventory.json").write_text(json.dumps(INVENTORY,indent=1,sort_keys=True)+"\n")
def pause_tests(f):
 # A finished worker exited and its lease lapsed; nothing remains in flight, so pause can become durable without a supervisor.
 q(f"UPDATE hyperfide.agent_sessions SET state='STOPPED',state_version=state_version+1 WHERE id='{m.uid(22)}';")
 q(f"UPDATE hyperfide.attempts SET lease_expires_at=clock_timestamp()-interval '1 minute',state_version=state_version+1 WHERE id='{m.ATTEMPT}';")
 pause={"scope":m.SCOPE,"operation_id":u(1),"scope_kind":"RUN","scope_id":m.RUN,"mode":"PAUSE","reason":"operator pause"}
 paused=f.ok("recovery.stop.request",pause)
 m.check("recovery.pause.admission-gated",lambda:m.expect(paused["admission_blocked"] is True and gate("RUN",m.RUN)=="PAUSE" and run_state()=="PAUSING"))
 m.check("recovery.pause.preserves-authority",lambda:m.expect(paused["compute_revoked"] is False and paused["submission_custody_preserved"] is True and q(f"SELECT authority FROM hyperfide.submission_custodies WHERE id='{m.uid(24)}';")=="ACTIVE" and attempt_state(m.ATTEMPT)=="CURRENT:RUNNING"))
 m.check("recovery.pause.idempotent-command",lambda:m.expect(f.ok("recovery.stop.request",pause)==paused))
 m.check("recovery.pause.resume-before-quiescence-refused",lambda:f.rejected("recovery.control.resume",{"scope":m.SCOPE,"operation_id":u(2)},"RECOVERY_RUN_STATE_INVALID",component="24.1"))
 first=f.ok("recovery.stop.reconcile",{"scope":m.SCOPE,"operation_id":u(1)})
 m.check("recovery.pause.quiescence-confirmed",lambda:m.expect(first["quiescence_complete"] is True and first["unreachable_resource_debt"]==[] and first["stop_complete"] is False and run_state()=="PAUSED",str(first)))
 again=f.ok("recovery.stop.reconcile",{"scope":m.SCOPE,"operation_id":u(1)})
 m.check("recovery.pause.reconcile-idempotent",lambda:m.expect(again==first and run_state()=="PAUSED",str(again)))
 resume={"scope":m.SCOPE,"operation_id":u(3)}
 resumed=f.ok("recovery.control.resume",resume,component="24.1")
 m.check("recovery.pause.resume-restores-run",lambda:m.expect(resumed["resumed"] is True and resumed["fresh_attempts_required"] is True and run_state()=="RUNNING" and gate("RUN",m.RUN)=="ACTIVE" and control("RUN",m.RUN).startswith("PAUSE:COMPLETE:")))
 m.check("recovery.pause.resume-idempotent",lambda:m.expect(f.ok("recovery.control.resume",resume,component="24.1")==resumed and run_state()=="RUNNING"))
 m.check("recovery.pause.second-resume-refused",lambda:f.rejected("recovery.control.resume",{"scope":m.SCOPE,"operation_id":u(4)},"RECOVERY_RUN_STATE_INVALID",component="24.1"))
def drain_tests(f):
 # Fresh dispatched work after resume; DRAIN lets this in-flight attempt finish until the persisted deadline.
 inflight(u(0x18),u(0x19),u(0x1a),u(0x1b),u(0x1c),"drain",session=u(0x1d))
 drain={"scope":m.SCOPE,"operation_id":u(0x40),"scope_kind":"ATTEMPT","scope_id":u(0x19),"mode":"DRAIN","reason":"drain attempt"}
 drained=f.ok("recovery.stop.request",drain)
 m.check("recovery.drain.deadline-persisted",lambda:m.expect(drained["fallback_mode"]=="STOP" and drained["drain_deadline"] is not None and q(f"SELECT round(extract(epoch FROM deadline_at-accepted_at)*1000)::bigint FROM hyperfide.recovery_controls WHERE scope_id='{u(0x19)}';")==str(DRAIN_MS)))
 m.check("recovery.drain.admission-gated",lambda:m.expect(drained["admission_blocked"] is True and gate("ATTEMPT",u(0x19))=="DRAIN"))
 m.check("recovery.drain.inflight-allowed-to-finish",lambda:m.expect(drained["compute_revoked"] is False and attempt_state(u(0x19))=="CURRENT:RUNNING" and lease_state(u(0x1c))=="ACTIVE" and q(f"SELECT state FROM hyperfide.agent_sessions WHERE id='{u(0x1d)}';")=="RUNNING"))
 m.check("recovery.drain.observes-finish-debt",lambda:m.expect(q(f"SELECT resource_kind||':'||desired_state FROM hyperfide.recovery_resource_debts WHERE operation_id='{u(0x40)}';")=="SUPERVISOR:FINISHED"))
 early=f.ok("recovery.stop.reconcile",{"scope":m.SCOPE,"operation_id":u(0x40)})
 m.check("recovery.drain.no-fallback-before-deadline",lambda:m.expect("fallback_operation_id" not in early and early["supervisor_available"] is False and early["stop_complete"] is False and control("ATTEMPT",u(0x19)).startswith("DRAIN:ACTIVE:") and attempt_state(u(0x19))=="CURRENT:RUNNING",str(early)))
 restart(f)
 m.check("recovery.drain.control-survives-restart",lambda:m.expect(control("ATTEMPT",u(0x19)).startswith("DRAIN:ACTIVE:") and f.ok("recovery.stop.request",drain)==drained))
 deadline=float(q(f"SELECT extract(epoch FROM deadline_at-clock_timestamp()) FROM hyperfide.recovery_controls WHERE scope_id='{u(0x19)}';"))
 time.sleep(max(0.0,deadline)+0.3)
 expired=f.ok("recovery.stop.reconcile",{"scope":m.SCOPE,"operation_id":u(0x40)})
 record_inventory("drain_deadline_reconcile",expired)
 m.check("recovery.drain.deadline-fallback-applied",lambda:m.expect(expired.get("fallback_operation_id") and expired["fallback"]["mode"]=="STOP" and expired["fallback"]["compute_revoked"] is True and expired["drain_complete"] is False and expired["cleanup_complete"] is False,str(expired)))
 m.check("recovery.drain.fallback-revokes-authority",lambda:m.expect(attempt_state(u(0x19))=="REVOKED:CANCELLED" and lease_state(u(0x1c))=="REVOKED" and control("ATTEMPT",u(0x19)).startswith("STOP:ACTIVE:") and gate("ATTEMPT",u(0x19))=="STOP"))
 later=f.ok("recovery.stop.reconcile",{"scope":m.SCOPE,"operation_id":u(0x40)})
 m.check("recovery.drain.fallback-applied-once",lambda:m.expect("fallback_operation_id" not in later and q(f"SELECT count(*) FROM hyperfide.recovery_operations WHERE operation_id='{expired['fallback_operation_id']}';")=="1" and control("ATTEMPT",u(0x19))=="STOP:ACTIVE:2",str(later)))
 m.check("recovery.drain.fallback-session-is-debt",lambda:m.expect(debt_resources(expired["fallback_operation_id"],"SUPERVISOR")==[u(0x1d)] and q(f"SELECT state FROM hyperfide.agent_sessions WHERE id='{u(0x1d)}';")=="RUNNING"))
def stop_tests(f):
 # V-017: one run simultaneously provisioning, building, reviewing and preparing a merge when the operator stops it.
 inflight(u(0x30),u(0x31),u(0x32),u(0x33),u(0x34),"provisioning",execution="PREPARING",sandbox_state="CREATING")
 inflight(u(0x10),u(0x11),u(0x12),u(0x13),u(0x14),"build",session=u(0x15))
 q(f"UPDATE hyperfide.qualification_jobs SET lease_expires_at=clock_timestamp()+interval '30 minutes',state_version=state_version+1 WHERE id='{m.uid(25)}';")
 q(f"INSERT INTO hyperfide.integration_preparations(organisation_id,run_id,request_id,request_digest,state,execution_manifest) VALUES('{m.ORG}','{m.RUN}','{u(0x35)}','{m.D}','PREPARING','{{}}');")
 custody_before=q(f"SELECT source_manifest_digest||':'||evidence_manifest_digest||':'||count(*) OVER () FROM hyperfide.submission_custodies WHERE id='{m.uid(24)}';")
 m.check("recovery.stop.real-process",lambda:m.expect(f.ok("recovery.stop.describe",{})["unreachable_means"]=="DEBT"))
 request={"scope":m.SCOPE,"operation_id":m.uid(50),"scope_kind":"RUN","scope_id":m.RUN,"mode":"STOP","reason":"component fixture stop"}
 result=f.ok("recovery.stop.request",request)
 record_inventory("run_stop_request",result)
 m.check("recovery.stop.durable-control",lambda:m.expect(control("RUN",m.RUN).startswith("STOP:ACTIVE:")))
 m.check("recovery.stop.no-new-admission",lambda:m.expect(result["admission_blocked"] is True and gate("RUN",m.RUN)=="STOP"))
 m.check("recovery.stop.run-stopping",lambda:m.expect(run_state()=="STOPPING"))
 m.check("recovery.stop.during-provisioning",lambda:m.expect(attempt_state(u(0x31))=="REVOKED:CANCELLED" and lease_state(u(0x34))=="REVOKED" and u(0x30) in result["affected_task_ids"]))
 m.check("recovery.stop.during-build",lambda:m.expect(attempt_state(u(0x11))=="REVOKED:CANCELLED" and lease_state(u(0x14))=="REVOKED"))
 m.check("recovery.stop.revoke-before-external-call",lambda:m.expect(q("SELECT count(*) FROM hyperfide.compute_leases WHERE state='ACTIVE';")=="0" and q("SELECT count(*) FROM hyperfide.attempts WHERE compute_authority='CURRENT';")=="0"))
 m.check("recovery.stop.worker-and-leader-debt",lambda:m.expect(debt_resources(m.uid(50),"SUPERVISOR")==sorted([u(0x15),u(0x1d),m.uid(23)])))
 m.check("recovery.stop.during-review",lambda:m.expect(q("SELECT state||':'||lease_generation||':'||coalesce(lease_owner::text,'none') FROM hyperfide.qualification_jobs;")=="CANCELLED:2:none"))
 m.check("recovery.stop.custody-explicitly-revoked",lambda:m.expect(q(f"SELECT authority FROM hyperfide.submission_custodies WHERE id='{m.uid(24)}';")=="REVOKED" and {"custody_id":m.uid(24),"authority":"REVOKED","history_preserved":True} in result["custody_dispositions"]))
 m.check("recovery.stop.artifacts-preserved",lambda:m.expect(result["custody_history_preserved"] is True and q(f"SELECT source_manifest_digest||':'||evidence_manifest_digest||':'||count(*) OVER () FROM hyperfide.submission_custodies WHERE id='{m.uid(24)}';")==custody_before))
 m.check("recovery.stop.during-merge-preparation-fenced",lambda:m.expect(q(f"SELECT state FROM hyperfide.integration_preparations WHERE request_id='{u(0x35)}';")=="PREPARING" and result["unknown_external_effects"]=="RECONCILE"))
 m.check("recovery.stop.not-falsely-complete",lambda:m.expect(result["process_stop_complete"] is False and result["cleanup_complete"] is False))
 m.check("recovery.stop.idempotent-command",lambda:m.expect(f.ok("recovery.stop.request",request)==result))
 m.check("recovery.stop.enclosing-control-precedence",lambda:f.rejected("recovery.stop.request",{**request,"operation_id":m.uid(51),"scope_kind":"ATTEMPT","scope_id":u(0x11),"mode":"PAUSE"},"RECOVERY_ENCLOSING_CONTROL"))
 m.check("recovery.stop.drain-cannot-weaken-stop",lambda:f.rejected("recovery.stop.request",{**request,"operation_id":u(0x41),"mode":"DRAIN"},"RECOVERY_ENCLOSING_CONTROL"))
 before=open_debts(m.uid(50))
 restart(f)
 m.check("recovery.stop.debt-survives-restart",lambda:m.expect(len(before)==3 and open_debts(m.uid(50))==before and control("RUN",m.RUN).startswith("STOP:ACTIVE:") and run_state()=="STOPPING"))
 m.check("recovery.stop.intent-replayed-after-restart",lambda:m.expect(f.ok("recovery.stop.request",request)==result))
 report=f.ok("recovery.stop.reconcile",{"scope":m.SCOPE,"operation_id":m.uid(50)})
 record_inventory("run_stop_reconcile_after_restart",report)
 m.check("recovery.stop.unreachable-debt-reported",lambda:m.expect(report["supervisor_available"] is False and sorted(d["id"] for d in report["unreachable_resource_debt"])==before and all(o["status"]=="SUPERVISOR_UNAVAILABLE" for o in report["observations"]) and report["reason"]=="UNREACHABLE_OR_UNCONFIRMED_RESOURCES",str(report)))
 m.check("recovery.stop.publication-fenced",lambda:m.expect(report["publication_reconciled"] is False))
 m.check("recovery.stop.reconcile-never-complete",lambda:m.expect(report["stop_complete"] is False and report["cleanup_complete"] is False and report["process_stop_complete"] is False and run_state()=="STOPPING"))
 m.check("recovery.stop.reconcile-idempotent",lambda:m.expect(f.ok("recovery.stop.reconcile",{"scope":m.SCOPE,"operation_id":m.uid(50)})==report and open_debts(m.uid(50))==before))
 m.check("recovery.stop.finalize-unproven-cleanup",lambda:f.rejected("recovery.stop.finalize",{"scope":m.SCOPE,"operation_id":m.uid(50)},"RECOVERY_DEPENDENCY_UNAVAILABLE"))
 m.check("recovery.stop.finalize-leaves-run-stopping",lambda:m.expect(run_state()=="STOPPING" and open_debts(m.uid(50))==before))
 m.check("recovery.stop.resume-with-open-debt-refused",lambda:f.rejected("recovery.control.resume",{"scope":m.SCOPE,"operation_id":u(0x42)},"RECOVERY_RUN_STATE_INVALID",component="24.1"))
 m.check("recovery.stop.reject-caller-confirmation",lambda:f.rejected("recovery.stop.reconcile",{"scope":m.SCOPE,"operation_id":m.uid(50),"stopped":True},"RECOVERY_INPUT_INVALID"))
 m.check("recovery.stop.cross-run-scope",lambda:f.rejected("recovery.stop.request",{**request,"operation_id":m.uid(52),"scope_id":m.uid(80)},"RECOVERY_SCOPE_INVALID"))
 m.check("recovery.stop.stale-epoch",lambda:f.rejected("recovery.stop.request",{**request,"operation_id":m.uid(53),"scope":{**m.SCOPE,"authority_epoch":m.uid(98)}},"RECOVERY_STALE_EPOCH"))
 return request
def historical_tests(f,request):
 # A historical sandbox still owes physical cleanup; it cannot own a task handed to another sandbox.
 q("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id,attempt_id,sandbox_id,slot_id,sandbox_boot_generation,state) VALUES('"+m.ORG+"','"+m.RUN+"','"+u(0x20)+"','WORKER','codex','fixture','orphan','"+m.ATTEMPT+"','"+m.uid(9)+"','"+m.uid(10)+"',1,'RUNNING');")
 q("INSERT INTO hyperfide.sandboxes(organisation_id,id,pool_id,observed_state) VALUES('"+m.ORG+"','"+m.uid(70)+"','"+m.uid(8)+"','RUNNING');")
 q("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind) VALUES('"+m.ORG+"','"+m.uid(71)+"','"+m.uid(70)+"','replacement',1,'AGENT');")
 q("INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,execution_state,compute_authority,sandbox_id,slot_id,sandbox_boot_generation) VALUES('"+m.ORG+"','"+m.RUN+"','"+m.uid(72)+"','"+m.uid(7)+"',2,'"+m.EPOCH+"','"+m.D+"','SUBMITTED','RELEASED','"+m.uid(70)+"','"+m.uid(71)+"',1);")
 q("UPDATE hyperfide.tasks SET current_attempt_id='"+m.uid(72)+"',generation=2,state='SUBMITTED',state_version=state_version+1 WHERE id='"+m.uid(7)+"';")
 q("INSERT INTO hyperfide.submission_custodies(organisation_id,run_id,id,task_id,source_attempt_id,source_generation,custody_generation,authority_epoch,repository_id,source_object_id,source_manifest_digest,evidence_manifest_digest,criteria_digest) SELECT organisation_id,run_id,'"+m.uid(73)+"','"+m.uid(7)+"','"+m.uid(72)+"',2,1,authority_epoch,repository_id,source_object_id,source_manifest_digest,evidence_manifest_digest,criteria_digest FROM hyperfide.submission_custodies WHERE id='"+m.uid(24)+"';")
 old=f.ok("recovery.stop.request",{**request,"operation_id":m.uid(74),"scope_kind":"SANDBOX","scope_id":m.uid(9)})
 m.check("recovery.stop.historical-sandbox-excludes-new-task",lambda:m.expect(m.uid(7) not in old["affected_task_ids"]))
 m.check("recovery.stop.historical-sandbox-preserves-new-task",lambda:m.expect(q("SELECT state FROM hyperfide.tasks WHERE id='"+m.uid(7)+"';")=="SUBMITTED"))
 m.check("recovery.stop.historical-sandbox-preserves-new-custody",lambda:m.expect(q("SELECT authority FROM hyperfide.submission_custodies WHERE id='"+m.uid(73)+"';")=="ACTIVE"))
 m.check("recovery.stop.historical-sandbox-preserves-new-attempt",lambda:m.expect(q("SELECT compute_authority||':'||execution_state FROM hyperfide.attempts WHERE id='"+m.uid(72)+"';")=="RELEASED:SUBMITTED"))
 m.check("recovery.stop.historical-sandbox-retains-physical-debt",lambda:m.expect(q("SELECT count(*) FROM hyperfide.recovery_resource_debts WHERE operation_id='"+m.uid(74)+"' AND resource_id='"+u(0x20)+"';")=="1"))
 q("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) VALUES('"+m.ORG+"','"+m.RUN+"','"+m.uid(75)+"','1.3','"+m.uid(6)+"','"+m.uid(4)+"','"+m.D+"','{}',1);")
 whole=f.ok("recovery.stop.request",{**request,"operation_id":m.uid(76)})
 m.check("recovery.stop.run-includes-unattempted-task",lambda:m.expect(m.uid(75) in whole["affected_task_ids"]))
 m.check("recovery.stop.unattempted-task-admission-blocked",lambda:m.expect(q("SELECT state FROM hyperfide.tasks WHERE id='"+m.uid(75)+"';")=="BLOCKED"))
def cancel_tests(f,request):
 cancel={**request,"operation_id":u(0x50),"mode":"CANCEL","reason":"operator cancel"}
 cancelled=f.ok("recovery.stop.request",cancel)
 m.check("recovery.cancel.terminal-intent",lambda:m.expect(run_state()=="CANCELLING" and control("RUN",m.RUN).startswith("CANCEL:ACTIVE:") and gate("RUN",m.RUN)=="STOP" and cancelled["compute_revoked"] is True))
 m.check("recovery.cancel.tasks-cancelled",lambda:m.expect(q(f"SELECT state FROM hyperfide.tasks WHERE id='{m.uid(75)}';")=="CANCELLED" and q(f"SELECT state FROM hyperfide.tasks WHERE id='{u(0x10)}';")=="CANCELLED"))
 m.check("recovery.cancel.idempotent-command",lambda:m.expect(f.ok("recovery.stop.request",cancel)==cancelled))
 m.check("recovery.cancel.resume-refused",lambda:f.rejected("recovery.control.resume",{"scope":m.SCOPE,"operation_id":u(0x51)},"RECOVERY_TERMINAL_CONTROL",component="24.1"))
 m.check("recovery.cancel.cannot-weaken-to-stop",lambda:f.rejected("recovery.stop.request",{**request,"operation_id":u(0x52)},"RECOVERY_ENCLOSING_CONTROL"))
 restart(f)
 report=f.ok("recovery.stop.reconcile",{"scope":m.SCOPE,"operation_id":u(0x50)})
 record_inventory("cancel_reconcile_after_restart",report)
 m.check("recovery.cancel.unreachable-debt-after-restart",lambda:m.expect(report["stop_complete"] is False and len(report["unreachable_resource_debt"])==len(open_debts(u(0x50)))>0 and run_state()=="CANCELLING",str(report)))
 m.check("recovery.cancel.finalize-unproven-refused",lambda:f.rejected("recovery.stop.finalize",{"scope":m.SCOPE,"operation_id":u(0x50)},"RECOVERY_DEPENDENCY_UNAVAILABLE"))
 m.check("recovery.cancel.resume-refused-after-restart",lambda:f.rejected("recovery.control.resume",{"scope":m.SCOPE,"operation_id":u(0x53)},"RECOVERY_TERMINAL_CONTROL",component="24.1"))
 total=q("SELECT count(*) FROM hyperfide.recovery_resource_debts WHERE status<>'RESOLVED';")
 record_inventory("open_debt_total",int(total))
 m.check("recovery.cleanup.debt-inventory-explicit",lambda:m.expect(int(total)>0 and q("SELECT count(*) FROM hyperfide.recovery_resource_debts WHERE status='RESOLVED';")=="0"))
def tests(f):
 m.check("recovery.stop.registered-control-component",lambda:m.expect(f.ok("recovery.stop.describe",{})["modes"]==["PAUSE","DRAIN","CANCEL","STOP"]))
 pause_tests(f)
 drain_tests(f)
 request=stop_tests(f)
 historical_tests(f,request)
 cancel_tests(f,request)
def drop_fencing_database():
 record=fencing_record()
 if not record.exists():return None
 item=json.loads(record.read_text());database=item["database"]
 m.expect(database.startswith("hf_identity_") and all(c.isalnum() or c=="_" for c in database),"Unsafe fencing fixture identity")
 m.sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='"+database+"' AND pid<>pg_backend_pid();","postgres")
 m.sql('DROP DATABASE IF EXISTS "'+database+'";',"postgres")
 m.expect(m.sql("SELECT count(*) FROM pg_database WHERE datname='"+database+"';","postgres")=="0","Fencing fixture database remains")
 m.observation_dir().joinpath("fencing-database-absence.json").write_text(json.dumps({"resource":FENCE_RESOURCE,"database":database,"observed_absent":True,"observer":"PostgreSQL pg_database query after DROP DATABASE"})+"\n")
 return database
def cleanup(emit):
 """Drop both disposable databases; only the independent cleanup command emits the single cleanup event."""
 captured=io.StringIO()
 with contextlib.redirect_stdout(captured):complete=m.cleanup()
 event=json.loads(captured.getvalue().strip().splitlines()[-1])
 resources=event["resources"]
 try:
  fenced=drop_fencing_database()
  if fenced:resources.append({"id":FENCE_RESOURCE,"status":"deleted","observed_absent":True,"evidence_artifact":"recovery/fencing-database-absence.json"})
 except Exception:
  complete=False;resources.append({"id":FENCE_RESOURCE,"status":"unknown","observed_absent":False,"evidence_artifact":"recovery/fencing-database-absence.json"})
 if emit:print(json.dumps({"type":"cleanup","complete":complete,"resources":resources}),flush=True)
 return complete
def main():
 m.TASK="24.3"
 if sys.argv[1:] and sys.argv[1:]!=["--cleanup"]:raise SystemExit("unsupported argument")
 if "--cleanup" in sys.argv:return 0 if cleanup(True) else 1
 os.environ["HYPERFIDE_DRAIN_TIMEOUT_MS"]=str(DRAIN_MS)
 fixture=None
 try:
  fencing_tests()
  managed_fencing_tests()
  fixture=m.setup("24.3")
  tests(fixture)
 finally:
  if fixture:fixture.close()
  complete=cleanup(False)
 return 1 if m.FAILED or not complete else 0
if __name__=="__main__":sys.exit(main())
