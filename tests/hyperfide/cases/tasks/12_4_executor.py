#!/usr/bin/env python3
"""Real 14/PG/15 executor boundary checks. No positive physical-job qualification.

Historical CLAIMED/UNKNOWN and invalid ADMITTED rows are hostile fixture INPUTS.
They do not claim a real source preparation, allocation, runner, or native ACK.
No synthetic provider adapter is registered or used.
"""
from __future__ import annotations
import base64,hashlib,importlib.util,json,os,select,shutil,subprocess,sys,tempfile,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
RESULTS=[]
def uid():return str(uuid.uuid4())
def digest(b):return "sha256:"+hashlib.sha256(b).hexdigest()
def canonical(v):return json.dumps(v,separators=(",",":"),ensure_ascii=False).encode()
def expect(v,message):
    if not v:raise AssertionError(message)
def check(name,callback):
    try:callback();actual="observed"
    except Exception as e:actual=type(e).__name__+": "+str(e)
    RESULTS.append((name,actual));print(json.dumps({"type":"assertion","id":name,"expected":"observed","actual":actual}),flush=True)
def load(name,path):
    s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
NODE=r"""
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import readline from 'node:readline';
import {createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
const root=process.cwd(),[policyPath,components,keyPath]=process.argv.slice(1);
const mod=async p=>import(pathToFileURL(path.join(root,'services/hyperfide/dist',p)).href);
const {ComponentRegistry}=await mod('components/registry.js');
const {validatePolicy}=await mod('policy/programme.js');
const {isIdentityAuthority}=await mod('identity/enrollment.js');
const {isArtifactStoreCapability}=await mod('artifacts/objects.js');
const {hash}=await mod('transport/protocol.js');
const {runnerCanonical,runnerResultSigningBytes}=await mod('runner/bridge.js');
const {validateNativeControlReceipt}=await mod('runner/executor.js');
const controller=new AbortController();
const registry=new ComponentRegistry({role:'provisioner',policy:validatePolicy(JSON.parse(await fs.readFile(policyPath,'utf8')),'fixture-identity-v1','provisioner'),signal:controller.signal,env:process.env});
try{
 await registry.load(components,path.join(root,'services/hyperfide/dist'));
 const authority=registry.resolveCapability('14.1','identity.authority',isIdentityAuthority);
 registry.installInvocationAuthorizer(i=>authority.authorize(i));
 const native=registry.resolveCapability('12.4-executor','runner.native.v1',v=>v&&typeof v.invokeNativeRunner==='function');
 const store=registry.resolveCapability('15.2','artifact.store.v1',isArtifactStoreCapability);
 process.stdout.write(JSON.stringify({ready:true,role:registry.describe().role})+'\n');
 for await(const line of readline.createInterface({input:process.stdin})){
  let q;try{q=JSON.parse(line);let result;
   if(q.op==='forged-native')result=await native.invokeNativeRunner(q.forged,q.input,controller.signal);
   else if(q.op==='forged-artifact')result=await store.invoke(q.action,q.input,q.forged);
   else{
    const i=await authority.authenticate(Buffer.from(q.body,'base64'),q.headers,controller.signal);await authority.authorize(i);
    if(q.op==='public')result=await registry.invoke(i.payload.component,i.payload.action,i.payload.input,i);
    else if(q.op==='native')result=await native.invokeNativeRunner(i,q.input,controller.signal);
    else if(q.op==='artifact')result=await store.invoke(q.action,q.input,i);
    else if(q.op==='coherence')result=validateNativeControlReceipt(q.receipt,q.target,q.command_id);
    else if(q.op==='signature'){
     const key=createPrivateKey(await fs.readFile(keyPath)),publicKey=createPublicKey(key);
     const metadata={outcome:'UNKNOWN',authority:'NONE',stdout:q.reference,fixture_kind:'REFERENCE_AND_SIGNATURE_ONLY'};
     const d=hash(runnerCanonical(metadata)),wire=runnerResultSigningBytes(i.principal.organisation_id,i.principal.run_id,q.operation_id,q.plan_digest,d);
     const signature=sign(null,wire,key);
     result={valid:verify(null,wire,publicKey,signature),changed_result:verify(null,runnerResultSigningBytes(i.principal.organisation_id,i.principal.run_id,q.operation_id,q.plan_digest,hash(runnerCanonical({...metadata,outcome:'SUCCEEDED'}))),publicKey,signature),changed_operation:verify(null,runnerResultSigningBytes(i.principal.organisation_id,i.principal.run_id,q.other_operation_id,q.plan_digest,d),publicKey,signature),changed_plan:verify(null,runnerResultSigningBytes(i.principal.organisation_id,i.principal.run_id,q.operation_id,q.other_plan_digest,d),publicKey,signature),physical_execution:'NOT_EVALUATED'};
    }else throw new Error('Unknown test operation');
   }
   process.stdout.write(JSON.stringify({id:q.id,ok:true,result})+'\n');
  }catch(e){process.stdout.write(JSON.stringify({id:q?.id??null,ok:false,error:{code:e.code??'ERROR',message:e.message}})+'\n');}
 }
}catch(e){process.stdout.write(JSON.stringify({startup_error:{code:e.code??'ERROR',message:e.message}})+'\n');process.exitCode=1;}
finally{controller.abort();await registry.close();}
"""
class Actor:
    def __init__(self,f,components,config):
        env=f.env.copy();env["HF_RUNNER_EXECUTOR_CONFIG_FILE"]=str(config)
        self.p=subprocess.Popen(["node","--input-type=module","-e",NODE,str(f.policy),str(components),str(f.keys["provisioner"]["path"])],cwd=ROOT,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:self.ready=self.read()
        except BaseException:self.close();raise
    def read(self):
        ready,_,_=select.select([self.p.stdout],[],[],20)
        expect(bool(ready),"Actual provisioner component process response timed out")
        line=self.p.stdout.readline()
        expect(bool(line),"Actual component exited without response")
        return json.loads(line)
    def request(self,value):
        value=dict(value,id=uid());self.p.stdin.write(json.dumps(value)+"\n");self.p.stdin.flush();return self.read()
    def close(self):
        if self.p.stdin and not self.p.stdin.closed:self.p.stdin.close()
        try:self.p.wait(timeout=10)
        except subprocess.TimeoutExpired:self.p.kill();self.p.wait();raise AssertionError("Owned provisioner did not stop")
        error=self.p.stderr.read()
        expect(self.p.returncode in ((0,) if getattr(self,"ready",{}).get("ready") else (0,1)),"Unexpected component process failure: "+error[:500])
        self.p.stdout.close();self.p.stderr.close()
class Fixture:
    def __init__(self,base):
        self.base=base;self.objects_module=load("executor_actual_objects",ROOT/"tests/hyperfide/cases/tasks/15_2.py")
        self.identity_module=load("executor_actual_identity",ROOT/"tests/hyperfide/support/identity_fixture.py")
        self.objects=self.objects_module.ObjectFixture();self.actor=None
        def setup(f):
            m=self.objects_module
            f.env.update({"HF_ARTIFACT_S3_ENDPOINT":self.objects.endpoint,"HF_ARTIFACT_ALLOW_LOOPBACK_HTTP":"1","HF_ARTIFACT_S3_REGION":m.REGION,"HF_ARTIFACT_S3_BUCKET":m.BUCKET,"HF_ARTIFACT_S3_ACCESS_KEY_ID":m.KEY,"HF_ARTIFACT_S3_SECRET_ACCESS_KEY":m.SECRET,"HF_ARTIFACT_S3_SESSION_TOKEN":m.TOKEN,"HF_ARTIFACT_ORGANISATION_ID":f.ids["organisation"],"HF_ARTIFACT_ALLOWED_RUN_IDS":json.dumps([f.ids["run"]])})
            for filename,version,name in (("0008-provider-coordination.sql",8,"0008-provider-coordination"),("0012-runner-registry.sql",12,"0012-runner-registry")):
                data=(ROOT/"services/hyperfide/migrations"/filename).read_bytes()
                f.sql("BEGIN;\n"+data.decode()+"\nINSERT INTO hyperfide.schema_migrations(version,name,checksum) VALUES("+str(version)+",'"+name+"','"+digest(data)+"');\nCOMMIT;")
            self.components=f.path/"executor-components";self.components.mkdir()
            names=("4.2","14.1","8.2","8.3","15.2","12.4-executor")
            actions=list(f.actions)+["provider.remote.execute-bound"]
            for name in names:
                source=ROOT/"services/hyperfide/components"/(name+".json")
                shutil.copyfile(source,self.components/source.name)
                actions+=json.loads(source.read_text())["actions"]
            actions=list(dict.fromkeys(actions))
            config=json.loads(f.identity_config.read_text())
            for p in config["principals"]:p["allowed_actions"]=actions
            f.identity_config.write_text(json.dumps(config))
            policy=json.loads(f.policy.read_text());policy["allowed_actions"]=actions;f.policy.write_text(json.dumps(policy))
            self.config=f.path/"executor.json";self.configuration={"schema_version":1,"principals":[{"credential_id":f.ids["provisioner"],"key_path":str(f.keys["provisioner"]["path"])}],"concurrency":2}
            self.config.write_text(json.dumps(self.configuration));self.config.chmod(0o600)
        try:self.f=self.identity_module.IdentityFixture(extra_components=("15.2",),extra_setup=setup,database="hf_task_12_4_executor")
        except BaseException:self.objects.stop();raise
        try:
            self.scope={"organisation_id":self.f.ids["organisation"],"run_id":self.f.ids["run"]}
            principal=self.f.invoke("identity.describe",{},key="provisioner")[1]
            expect(principal.get("ok") is True,"Actual signed HTTPS provisioner identity failed")
            self.principal=principal["result"]["principal"];self.seed_uncertain_history()
            self.actor=Actor(self.f,self.components,self.config);expect(self.actor.ready.get("ready") is True,"Actual provisioner factory failed: "+json.dumps(self.actor.ready))
        except BaseException:self.close();raise

    def seed_uncertain_history(self):
        f=self.f;i=f.ids;org,run=i["organisation"],i["run"]
        self.repository,self.slot,self.session,self.reservation,self.account=uid(),uid(),uid(),uid(),uid()
        f.sql("INSERT INTO hyperfide.repositories(organisation_id,id,project_id,name,url) VALUES($1,$2,$3,'hostile-fixture-input','https://invalid.example/never-cloned.git')",[org,self.repository,i["project"]])
        f.sql("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind,state) VALUES($1,$2,$3,'fixture-not-physical',1,'TEST','READY')",[org,self.slot,i["sandbox"]])
        f.sql("INSERT INTO hyperfide.capacity_accounts(organisation_id,id,pool_id,dimension,configured_limit,provenance_digest) VALUES($1,$2,$3,'TEST',1,$4)",[org,self.account,i["pool"],digest(b"fixture-not-qualified")])
        f.sql("INSERT INTO hyperfide.reservations(organisation_id,run_id,id,request_id,capacity_account_id,quantity,expires_at) VALUES($1,$2,$3,$4,$5,0,clock_timestamp()+interval '1 hour')",[org,run,self.reservation,uid(),self.account])
        pin=digest(b"HOSTILE_INPUT_NOT_ACTUAL_SOURCE")
        f.sql("INSERT INTO hyperfide.runner_registry(organisation_id,run_id,session_id,credential_id,sandbox_id,boot_generation,boot_id,slot_id,repository_id,state_dir,runner_binary,workspace_path,runner_binary_digest,preparation_digest,readiness_digest,source_digest,source_object_id,source_tree_id,slot_generation,uid,gid,observation_digest) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,'/invalid/never-run','/invalid/no-native-binary','/invalid/no-workspace',$9,$9,$9,$9,$10,$10,1,65534,65534,$9)",[org,run,self.session,i["provisioner"],i["sandbox"],i["boot"],self.slot,self.repository,pin,"1"*40])
        self.ids={}
        request={"session_id":self.session,"operation_id":uid(),"repository_id":self.repository,"reservation_id":self.reservation,"argv":["/invalid/never-run"],"cwd":".","environment":{},"timeout_ms":1000,"source_digest":pin,"policy_digest":pin,"executable_digest":pin,"environment_digest":digest(b"{}"),"artifact_paths":[]}
        binding={"organisation_id":org,"run_id":run,"session_id":self.session,"credential_id":i["provisioner"],"sandbox_id":i["sandbox"],"boot_id":i["boot"],"boot_generation":"1","slot_id":self.slot,"slot_generation":"1","repository_id":self.repository,"state_dir":"/invalid/never-run","runner_binary":"/invalid/no-native-binary","workspace_path":"/invalid/no-workspace","preparation_digest":pin,"source_digest":pin,"source_object_id":"1"*40,"source_tree_id":"1"*40,"uid":65534,"gid":65534,"provider":"fixture","pool_id":i["pool"],"external_sandbox_id":"fixture-resource"}
        for state in ("CLAIMED","UNKNOWN","ADMITTED"):
            operation=uid();self.ids[state]=operation
            packet={"request":dict(request,operation_id=operation),"binding":binding,"allocation":{},"reservations":[]}
            packet_bytes=json.dumps(packet,sort_keys=True,separators=(",",":")).encode()
            f.sql("INSERT INTO hyperfide.runner_remote_jobs(organisation_id,run_id,operation_id,session_id,plan,plan_digest,principal,admission_digest,authority_epoch,reservation_id,expires_at,state,claim_id,executor_credential_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp()+interval '1 hour',$11,$12,$13)",[org,run,operation,self.session,json.dumps(packet),digest(packet_bytes),json.dumps(self.principal),pin,i["epoch"],self.reservation,state,None if state=="ADMITTED" else uid(),None if state=="ADMITTED" else i["provisioner"]])
        self.claimed_before=f.sql("SELECT claim_id::text,executor_credential_id::text FROM hyperfide.runner_remote_jobs WHERE operation_id=$1",[self.ids["CLAIMED"]])[0]
    def proof(self,key="provisioner",component="14.1",action="identity.describe",value=None):
        f=self.f;body=canonical(f.operation(component,action,{} if value is None else value))
        identity=f.ids[key];seconds=str(int(time.time()));nonce=uid()
        signature=f.sign(key,("\n".join(("HYPERFIDE-REQUEST-V1","POST","/v1/invoke",f.origin,identity,seconds,nonce,digest(body),""))).encode())
        return {"body":base64.b64encode(body).decode(),"headers":["hf-credential-id",identity,"hf-request-time",seconds,"hf-request-nonce",nonce,"hf-request-signature",signature]}
    def command(self,op,**values):return self.actor.request({"op":op,**self.proof(),**values})
    def refused(self,value,code):
        expect(value.get("ok") is False and value.get("error",{}).get("code")==code,"Actual boundary did not refuse "+code+": "+json.dumps(value))
    def config_refused(self,name,content=None,mode=0o600,source=None):
        path=self.f.path/(name+".json")
        if source is not None:path.symlink_to(source)
        else:path.write_text(json.dumps(content if content is not None else self.configuration));path.chmod(mode)
        actor=Actor(self.f,self.components,path)
        try:expect("startup_error" in actor.ready,"Invalid trusted configuration was admitted")
        finally:actor.close()
    def wait_admission_refused(self):
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            state=self.f.sql("SELECT state FROM hyperfide.runner_remote_jobs WHERE operation_id=$1",[self.ids["ADMITTED"]])[0]["state"]
            if state=="UNKNOWN":return
            time.sleep(.1)
        status=self.actor.request({"op":"public",**self.proof(component="12.4-executor",action="runner.executor.describe")})
        raise AssertionError("Invalid physical runner admission did not become explicit UNKNOWN: "+json.dumps(status))
    def history_unchanged(self):
        f=self.f
        for state in ("CLAIMED","UNKNOWN"):
            row=f.sql("SELECT state,claim_id::text,executor_credential_id::text FROM hyperfide.runner_remote_jobs WHERE operation_id=$1",[self.ids[state]])[0]
            expect(row["state"]==state,"Uncertain operation was replayed or promoted")
            if state=="CLAIMED":expect({k:row[k] for k in self.claimed_before}==self.claimed_before,"Once-claim custody changed")
        expect(f.sql("SELECT count(*)::int AS n FROM hyperfide.provider_remote_operations")[0]["n"]==0,"A rejected/uncertain fixture crossed the actual provider journal")
    def close(self):
        try:
            if self.actor:self.actor.close();self.actor=None
        finally:
            try:self.f.close()
            finally:self.objects.stop()
def main():
    with tempfile.TemporaryDirectory(prefix="executor-boundaries-",dir="/tmp/hyperfide") as t:
        f=Fixture(Path(t))
        try:
            check("executor.actual-authenticated-provisioner-start",lambda:expect(f.actor.ready.get("role")=="provisioner","Wrong real service role"))
            check("executor.invalid-readiness-no-sdk",f.wait_admission_refused)
            check("executor.uncertain-claim-not-replayed",f.history_unchanged)
            check("executor.genuine-configured-status",lambda:expect(f.actor.request({"op":"public",**f.proof(component="12.4-executor",action="runner.executor.describe")}).get("ok") is True,"Genuine configured status denied"))
            q={"op":"public",**f.proof(component="12.4-executor",action="runner.executor.describe")}
            check("executor.actual-nonce-replay-refused",lambda:(expect(f.actor.request(q).get("ok") is True,"First genuine request failed"),f.refused(f.actor.request(q),"AUTH_REPLAY")))
            native={"session_id":uid(),"operation_id":uid(),"action":"runner.observe"}
            check("executor.forged-native-brand-refused",lambda:f.refused(f.actor.request({"op":"forged-native","forged":{"principal":f.principal},"input":native}),"AUTH_REQUIRED"))
            check("executor.operator-native-denied",lambda:f.refused(f.actor.request({"op":"native",**f.proof(key="operator"),"input":native}),"RUNNER_CONTROL_DENIED"))
            check("executor.native-stop-command-required",lambda:f.refused(f.command("native",input=dict(native,action="runner.stop")),"RUNNER_CONTROL_DENIED"))
            check("executor.native-action-allowlist",lambda:f.refused(f.command("native",input=dict(native,action="runner.execute-arbitrary")),"RUNNER_CONTROL_DENIED"))
            check("executor.native-unregistered-target-refused",lambda:f.refused(f.command("native",input=native),"RUNNER_NOT_CURRENT"))
            # Hostile metadata fixtures exercise the exact runtime validator;
            # they are not observations of a physical runner or stop event.
            target={"launch_id":uid(),"attempt_id":uid(),"attempt_generation":"1","sandbox_id":uid(),"boot_id":uid(),"boot_generation":"1","uid":65534}
            receipt={**{k:v for k,v in target.items() if k!="uid"},"status":"CONFIRMED_STOPPED","observation_id":uid(),"observed_at_seconds":int(time.time()),"processes":[],"remaining_descendants":0,"ipc_closed":True,"cleanup_complete":False}
            coherent=f.command("coherence",target=target,receipt=receipt)
            check("executor.metadata-coherence-is-not-full-cleanup",lambda:expect(coherent.get("ok") is True and coherent["result"]["cleanup_complete"] is False,"Physical-absence metadata discharged unrelated cleanup debt"))
            process={"pid":999999,"pgid":999999,"uid":65534,"start_time":"123","os_boot_id":uid()}
            for name,changed in (("stopped-with-process",dict(receipt,processes=[process],remaining_descendants=1)),("stopped-with-descendant",dict(receipt,remaining_descendants=1)),("stopped-with-open-ipc",dict(receipt,ipc_closed=False)),("inconsistent-descendant-count",dict(receipt,status="RUNNING",processes=[process],remaining_descendants=0)),("mismatched-target-boot",dict(receipt,boot_id=uid())),("invalid-kernel-process",dict(receipt,status="RUNNING",processes=[dict(process,pid=0)],remaining_descendants=1))):
                check("executor.hostile-metadata-"+name,lambda changed=changed:expect(f.command("coherence",target=target,receipt=changed).get("ok") is False,"Contradictory hostile metadata was accepted"))
            check("executor.config-mode-refused",lambda:f.config_refused("bad-mode",mode=0o640))
            check("executor.config-symlink-refused",lambda:f.config_refused("symlink",source=f.config))
            check("executor.config-duplicate-principal-refused",lambda:f.config_refused("duplicate",dict(f.configuration,principals=f.configuration["principals"]*2)))
            check("executor.config-concurrency-zero-refused",lambda:f.config_refused("zero",dict(f.configuration,concurrency=0)))
            check("executor.config-concurrency-excess-refused",lambda:f.config_refused("excess",dict(f.configuration,concurrency=17)))
            wrong={"credential_id":f.f.ids["provisioner"],"key_path":str(f.f.keys["other"]["path"])}
            check("executor.config-wrong-key-refused",lambda:f.config_refused("wrong-key",dict(f.configuration,principals=[wrong])))
            operator={"credential_id":f.f.ids["operator"],"key_path":str(f.f.keys["operator"]["path"])}
            check("executor.config-wrong-role-refused",lambda:f.config_refused("wrong-role",dict(f.configuration,principals=[operator])))
            payload=b"actual executor metadata-ref probe; no physical job assertion"
            put={**f.scope,"digest":digest(payload),"size_bytes":str(len(payload)),"data_base64":base64.b64encode(payload).decode(),"retention_class":"RUN","retention_until":None,"retention_hold":False}
            saved=f.command("artifact",action="artifact.object.put",input=put)
            check("executor.actual15-capture-reference",lambda:expect(saved.get("ok") is True and saved["result"]["availability"]=="VERIFIED" and saved["result"]["receipt"] is not None,"Actual authenticated object publication failed"))
            check("executor.forged-artifact-brand-refused",lambda:f.refused(f.actor.request({"op":"forged-artifact","forged":{"principal":f.principal},"action":"artifact.object.put","input":put}),"AUTH_REQUIRED"))
            check("executor.artifact-cross-scope-refused",lambda:expect(f.command("artifact",action="artifact.object.put",input=dict(put,organisation_id=uid())).get("ok") is False,"Cross-organisation artifact scope admitted"))
            if saved.get("ok"):
                a=saved["result"]["artifact"];ref={"storage_kind":"object","artifact_id":a["artifact_id"],"digest":a["digest"],"size_bytes":a["size_bytes"],"complete":False}
                s=f.command("signature",reference=ref,operation_id=uid(),other_operation_id=uid(),plan_digest=digest(b"plan"),other_plan_digest=digest(b"other-plan"))
                check("executor.actual-provisioner-metadata-signature",lambda:expect(s.get("ok") and s["result"]["valid"] is True,"Actual registered Ed25519 signature did not verify"))
                check("executor.signature-result-tamper-refused",lambda:expect(s["result"]["changed_result"] is False,"Result mutation preserved signature"))
                check("executor.signature-operation-tamper-refused",lambda:expect(s["result"]["changed_operation"] is False,"Operation mutation preserved signature"))
                check("executor.signature-plan-tamper-refused",lambda:expect(s["result"]["changed_plan"] is False,"Plan mutation preserved signature"))
            f.actor.close();f.actor=None
            f.actor=Actor(f.f,f.components,f.config)
            check("executor.restart-uncertain-not-replayed",lambda:(expect(f.actor.ready.get("ready") is True,"Real restarted provisioner failed to initialise"),f.history_unchanged()))
        finally:f.close()
        check("executor.owned-database-absent",lambda:expect(f.f.sql("SELECT count(*)::int AS n FROM pg_database WHERE datname=$1",[f.f.database],admin=True)[0]["n"]==0,"Owned fixture database remains"))
    failed=[name for name,actual in RESULTS if actual!="observed"]
    print(json.dumps({"type":"summary","task":"12.4","assertions":len(RESULTS),"failed":failed,"scope":"actual-service-negative-boundaries","physical_execution":"NOT_QUALIFIED","synthetic_provider_adapters":False}),flush=True)
    return int(bool(failed))
if __name__=="__main__":raise SystemExit(main())
