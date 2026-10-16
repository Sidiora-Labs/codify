#!/usr/bin/env python3
"""Real PostgreSQL, signed HTTPS and native instruction boundary tests."""
from __future__ import annotations
import concurrent.futures,base64,hashlib,importlib.util,json,os,re,shutil,signal,subprocess,sys,tempfile,time,uuid,socket,select
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/"tests/hyperfide/support"))
import identity_fixture as identity
TASK="6.1";FAILED=[];IDS=[];OBS=[];ACTIVE=None
def uid(n):return f"00000000-0000-4000-8000-{n:012x}"
S={};CONSUMER=uid(600)
def expect(value,message):
    if not value:raise AssertionError(message)
def check(name,callback):
    IDS.append(name)
    try:callback();actual="observed"
    except Exception as error:actual=type(error).__name__+": "+str(error);FAILED.append(name)
    print(json.dumps({"type":"assertion","id":name,"expected":"observed","actual":actual}),flush=True)
def q(value):return "'"+str(value).replace("'","''")+"'"
def database():return "hf_task_"+TASK.replace(".","_")+"_qualification"
def env():
    result=os.environ.copy();u=urlsplit(result["DATABASE_URL"])
    result["DATABASE_URL"]=urlunsplit((u.scheme,u.netloc,"/"+database(),u.query,u.fragment))
    result["PGDATABASE"]=database()
    return result
def sql(text,admin=False):
    p=subprocess.run(["psql","-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-d","postgres" if admin else database()],
        input=text,text=True,capture_output=True,env=env(),timeout=30)
    expect(p.returncode==0,"PostgreSQL fixture failed: "+" ".join(x for x in p.stderr.splitlines() if x.startswith("ERROR:")))
    return p.stdout.strip()
def target():
    p=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/domain06-"+TASK))/"events"
    p.mkdir(parents=True,exist_ok=True);return p
def cleanup():
    resources=[];complete=True
    for kind in ["database","role","process","directory"]:
        resources.append({"id":"hf-task-"+TASK+"-"+kind,"status":"unknown","observed_absent":False})
    try:
        descriptor=target()/"resource.json"
        record=json.loads(descriptor.read_text()) if descriptor.exists() else {}
        pid=record.get("pid");start=record.get("start_time")
        if isinstance(pid,int) and pid>1 and Path("/proc/"+str(pid)+"/stat").exists():
            fields=Path("/proc/"+str(pid)+"/stat").read_text().split()
            same=fields[21]==start and Path("/proc/sys/kernel/random/boot_id").read_text().strip()==record.get("boot_id")
            expect(same,"Refusing to terminate a process with a different identity")
            os.kill(pid,signal.SIGTERM);end=time.monotonic()+8
            while Path("/proc/"+str(pid)).exists() and time.monotonic()<end:time.sleep(.05)
            if Path("/proc/"+str(pid)).exists():os.kill(pid,signal.SIGKILL)
        sql('DROP DATABASE IF EXISTS "'+database()+'" WITH (FORCE)',True)
        absent=sql("SELECT count(*) FROM pg_database WHERE datname="+q(database()),True)=="0"
        role=record.get("runtime_role")
        if role:
            expect(re.fullmatch(r"hf_ir_[a-f0-9]{32}",role),"Unexpected fixture runtime role")
            sql('DROP ROLE IF EXISTS "'+role+'"',True)
        role_absent=bool(role) and sql("SELECT count(*) FROM pg_roles WHERE rolname="+q(role),True)=="0"
        extra=record.get("dispatcher_process",{})
        extra_pid=extra.get("pid")
        if isinstance(extra_pid,int) and Path("/proc/"+str(extra_pid)+"/stat").exists():
            fields=Path("/proc/"+str(extra_pid)+"/stat").read_text().split()
            expect(fields[21]==extra.get("start_time") and Path("/proc/sys/kernel/random/boot_id").read_text().strip()==extra.get("boot_id"),"Refusing dispatcher cleanup after PID reuse")
            os.kill(extra_pid,signal.SIGTERM);end=time.monotonic()+8
            while Path("/proc/"+str(extra_pid)).exists() and time.monotonic()<end:time.sleep(.05)
            if Path("/proc/"+str(extra_pid)).exists():os.kill(extra_pid,signal.SIGKILL)
        directory=record.get("directory")
        if directory:
            p=Path(directory)
            expect(p.parent==Path(tempfile.gettempdir()) and p.name.startswith("hyperfide-identity-"),"Unexpected fixture cleanup path")
            shutil.rmtree(p,ignore_errors=True)
        observed=[absent,role_absent,not pid or not Path("/proc/"+str(pid)).exists(),not directory or not Path(directory).exists()]
        if TASK=="6.4":
            resources.append({"id":"hf-task-6.4-dispatch-process","status":"unknown","observed_absent":False})
            observed.append(not extra_pid or not Path("/proc/"+str(extra_pid)).exists())
        for row,value in zip(resources,observed):
            row.update(status="deleted" if value else "unknown",observed_absent=value,evidence_artifact="events/resource-absence.json")
        complete=all(observed)
    except Exception as error:
        complete=False
        OBS.append({"cleanup_error":type(error).__name__})
    (target()/"resource-absence.json").write_text(json.dumps({"resources":resources,"complete":complete})+"\n")
    print(json.dumps({"type":"cleanup","complete":complete,"resources":resources}),flush=True)
    return 0 if complete else 1
FIXTURE="""
import {enqueue,lockRun,authorizedRun,lookupConsumerBinding,lookupNativeLaunch} from './events/outbox.js';
import {receive,bootstrapConsumer,supersedeDelivery} from './events/inbox.js';
import {applyExecutionControl} from './scheduler/claim.js';
import {registerRunnerConsumer} from './events/instructions.js';
import fs from 'node:fs/promises';
import {DurableDispatcher,recoverySnapshot} from './events/recovery.js';
export function createComponent(ctx) {
 const g=ctx.dependencies.require('4.2','storage.transactions.v1',v=>typeof v?.withPrimaryTransaction==='function');
 const auth=(context,input,op)=>authorizedRun(g,context,input,['OPERATOR'],op);
 const actions={
  'fixture.worker-admit':async(input,context)=>{
    const result=await authorizedRun(g,context,input,['DISPATCH'],tx=>receive(tx,input,async tx=>{
      await tx.query('UPDATE hyperfide.runs SET state_version=state_version+1 WHERE organisation_id=$1 AND id=$2',[input.organisation_id,input.run_id]);
      return {effect:'COMMITTED_ONCE'};
    }));
    const marker=ctx.env.HF_TEST_DAEMON_CRASH_FILE;
    if(marker)try{await fs.writeFile(marker,JSON.stringify({event_id:input.event_id,status:result.status,inbox_id:result.inbox_id??null}),{flag:'wx',mode:0o600});process.kill(process.pid,'SIGKILL');}
      catch(error){if(error?.code!=='EEXIST')throw error;}
    return result;
  },
  'fixture.native-registration-rollback':(input,context)=>authorizedRun(g,context,input,['RUNNER'],async(tx,i)=>{
    await registerRunnerConsumer(tx,input,i);throw new Error('INTENTIONAL_NATIVE_BOOTSTRAP_ROLLBACK');
  }),
  'fixture.native-registration-crash':(input,context)=>authorizedRun(g,context,input,['RUNNER'],async(tx,i)=>{
    await registerRunnerConsumer(tx,input,i);process.kill(process.pid,'SIGKILL');await new Promise(()=>{});
  }),
  'fixture.runtime-role':(input,context)=>auth(context,input,async tx=>{
   const r=await tx.query("SELECT current_user AS role,rolsuper,rolcreatedb,rolcreaterole,has_table_privilege(current_user,'hyperfide.schema_migrations','INSERT,UPDATE,DELETE') AS migrations_mutable FROM pg_roles WHERE rolname=current_user");
   return r.rows[0];
  }),
  'fixture.atomic': (input,context)=>auth(context,input,async tx=>{
   await lockRun(tx,input.event);
   await tx.query('UPDATE hyperfide.runs SET state_version=state_version+1 WHERE organisation_id=$1 AND id=$2',[input.organisation_id,input.run_id]);
   const result=await enqueue(tx,input.event);if(input.rollback)throw new Error('INTENTIONAL_ROLLBACK');return result;
  }),
  'fixture.selected': (input,context)=>auth(context,input,tx=>enqueue(tx,input.event,{consumer_ids:input.consumer_ids})),
  'fixture.effect': (input,context)=>auth(context,input,tx=>receive(tx,{organisation_id:input.organisation_id,run_id:input.run_id,event_id:input.event_id,consumer_id:input.consumer_id},async tx=>{
    await tx.query('SELECT pg_sleep(0.1)');
    await tx.query('UPDATE hyperfide.runs SET state_version=state_version+1 WHERE organisation_id=$1 AND id=$2',[input.organisation_id,input.run_id]);
    return {applied:true};
  })),
  'fixture.bootstrap':(input,context)=>auth(context,input,tx=>bootstrapConsumer(tx,input,async tx=>{
    const r=await tx.query('SELECT state,state_version FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2',[input.organisation_id,input.run_id]);
    return {run:r.rows[0]};
  })),
  'fixture.supersede':(input,context)=>auth(context,input,tx=>supersedeDelivery(tx,input,async tx=>{
    const r=await tx.query('SELECT authority_epoch,state_version FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2',[input.organisation_id,input.run_id]);
    return {scope:'authenticated-operator-SQL-fixture-only',credential_id:context.invocation.principal.credential_id,primary_run:r.rows[0]};
  })),
  'fixture.native-lookup':(input,context)=>authorizedRun(g,context,input,['OPERATOR','PROVISIONER','LEADER'],(tx,i)=>lookupNativeLaunch(tx,input,i)),
  'fixture.native-forged':(input,context)=>auth(context,input,(tx,i)=>lookupNativeLaunch(tx,input,{...i,principal:{...i.principal,role:'PROVISIONER'}})),
  'fixture.crash':async(input,context)=>{
   const dispatch=new DurableDispatcher(g,input.config,async(claim)=>{
    if(claim.id!==input.expected_event_id)throw new Error('UNEXPECTED_CRASH_DELIVERY');
    if(input.after_receive)await auth(context,input,tx=>receive(tx,{organisation_id:claim.organisation_id,run_id:claim.run_id,event_id:claim.id,consumer_id:claim.consumer_id}));
    process.kill(process.pid,'SIGKILL');
    await new Promise(()=>{});
   },context);
   return dispatch.pass();
  },
  'fixture.binding':(input,context)=>auth(context,input,tx=>lookupConsumerBinding(tx,input)),
  'fixture.control':(input,context)=>auth(context,input,tx=>applyExecutionControl(tx,input,input.control)),
  'fixture.snapshot': (input,context)=>auth(context,input,tx=>recoverySnapshot(tx,input)),
  'fixture.hung': async(input,context)=>{
   const dispatcher=new DurableDispatcher(g,input.config,async()=>new Promise(()=>{}),context);
   const before=Date.now();const result=await dispatcher.pass();await dispatcher.close();return {result,elapsed_ms:Date.now()-before};
  },
  'fixture.dispatch': async(input,context)=>{
   let sends=0,passes=0;
   const dispatch=new DurableDispatcher(g,input.config,async(claim,signal)=>{
    if(signal.aborted)throw new Error('ABORTED');sends++;
    const receipt=await auth(context,input,tx=>receive(tx,{organisation_id:claim.organisation_id,run_id:claim.run_id,event_id:claim.id,consumer_id:claim.consumer_id}));
    if(!receipt.inbox_id)throw new Error('RECEIVER_NOT_COMMITTED');
    if(input.lose_first_ack&&sends===1)throw new Error('ACK_LOST_AFTER_RECEIVER_COMMIT');
    return {inbox_id:receipt.inbox_id};
   },context);
   const first=await dispatch.pass();passes++;
   if(input.poll){
    dispatch.start();const end=Date.now()+1500;
    while(sends<(input.lose_first_ack?2:1)&&Date.now()<end)await new Promise(r=>setTimeout(r,10));
    await dispatch.close();
   }else{await new Promise(r=>setTimeout(r,30));await dispatch.pass();passes++;await dispatch.close();}
   return {sends,passes,first};
  }
 };
 if(ctx.env.HF_TEST_EXECUTION_CONTROLS!=='1'){delete actions['fixture.control'];delete actions['fixture.native-registration-rollback'];delete actions['fixture.native-registration-crash'];}
 return {apiVersion:1,actions};
}
"""
class Service(identity.IdentityFixture):
    def __init__(self,include_instructions=None):
        self.include_instructions=TASK=="6.3" if include_instructions is None else include_instructions
        extras=["6.1","6.2","6.4"]
        if self.include_instructions:extras+=["2.1","2.4","3.1","3.2","5.1","5.2","5.4","7.2","7.3","6.3"]
        try:super().__init__(extra_components=extras,extra_setup=self.prepare,database=database())
        except BaseException:
            child=getattr(self,"child",None);pid=child.pid if child else None
            stat=Path("/proc/"+str(pid)+"/stat") if pid else None
            record={"database":getattr(self,"database",database()),"runtime_role":getattr(self,"runtime_role",None),
                "directory":str(self.path) if hasattr(self,"path") else None,"pid":pid,
                "start_time":stat.read_text().split()[21] if stat and stat.exists() else None,
                "boot_id":Path("/proc/sys/kernel/random/boot_id").read_text().strip()}
            (target()/"resource.json").write_text(json.dumps(record)+"\n")
            raise
    def prepare(self,f):
        for name,version in [('0002-spec',2),('0003-hierarchy',3),('0005-scheduling',5),('0006-event-session-bindings',6),('0007-graph',7),('0032-execution-packets',32)]:
            self.apply_migration(name)
        self.env['HF_SCHEDULER_DISPATCH_CONSUMER_ID']=CONSUMER
        if TASK=='6.4':self.env['HF_TEST_DAEMON_CRASH_FILE']=str(self.path/'worker-after-commit-crash')
        self.env['HF_TEST_EXECUTION_CONTROLS']='1' if self.include_instructions else '0'
        self.runtime_root=self.path/"runtime";module=self.runtime_root/"services/hyperfide/dist"
        module.parent.mkdir(parents=True)
        shutil.copytree(ROOT/"services/hyperfide/dist",module)
        shutil.copytree(ROOT/"services/hyperfide/migrations",module.parent/"migrations")
        (module.parent/"node_modules").symlink_to(ROOT/"services/hyperfide/node_modules",target_is_directory=True)
        self.module_equal=all(hashlib.sha256(p.read_bytes()).digest()==hashlib.sha256((module/p.relative_to(ROOT/"services/hyperfide/dist")).read_bytes()).digest()
            for p in (ROOT/"services/hyperfide/dist").rglob("*") if p.is_file())
        (module/"fixture.js").write_text(FIXTURE)
        syntax=subprocess.run(["node","--check",str(module/"fixture.js")],capture_output=True,text=True)
        expect(syntax.returncode==0,"Trusted fixture module syntax failed: "+syntax.stderr[:1000])
        (module/"package.json").write_text('{"type":"module"}')
        actions=["fixture.atomic","fixture.selected","fixture.effect","fixture.snapshot","fixture.hung","fixture.dispatch","fixture.bootstrap","fixture.supersede","fixture.control","fixture.binding","fixture.native-lookup","fixture.native-forged","fixture.crash","fixture.runtime-role","fixture.native-registration-rollback","fixture.native-registration-crash","fixture.worker-admit"]
        fragment={"schema_version":1,"id":"fixture.events","task":"6.1","roles":["control"],"module":"fixture.js","entry":"createComponent",
            "api_version":1,"actions":actions,"requires":["4.2","6.1","6.2","6.4"]}
        if self.include_instructions:fragment["requires"]+=["5.1","6.3"]
        else:
            actions.remove("fixture.control");actions.remove("fixture.native-registration-rollback");actions.remove("fixture.native-registration-crash")
        (self.components/"fixture.json").write_text(json.dumps(fragment))
        self.actions+=actions
        for path in [self.policy,self.identity_config]:
            value=json.loads(path.read_text())
            if path==self.policy:value["allowed_actions"]=self.actions
            else:
                for record in value["principals"]:
                    record["allowed_actions"]=self.actions
                    # Fixed fixture actions are trusted startup preconditions, seeded before the first HTTPS process.
                    self.sql("UPDATE hyperfide.identity_principals SET allowed_actions=$2 WHERE credential_id=$1",[record["credential_id"],self.actions])
            path.write_text(json.dumps(value))
    def start(self):
        original=identity.ROOT
        try:
            identity.ROOT=self.runtime_root
            super().start()
        finally:identity.ROOT=original
        pid=self.child.pid
        record={"database":self.database,"runtime_role":self.runtime_role,"directory":str(self.path),"pid":pid,
            "start_time":Path("/proc/"+str(pid)+"/stat").read_text().split()[21],
            "boot_id":Path("/proc/sys/kernel/random/boot_id").read_text().strip()}
        (target()/"resource.json").write_text(json.dumps(record)+"\n")
    def request_action(self,action,value,runner=None):
        component={"outbox":"6.1","inbox":"6.2","instructions":"6.3","recovery":"6.4","fixture":"fixture.events"}[action.split(".")[0]]
        value={**S,**value} if action.startswith("fixture.") else value
        use_runner=action in ("instructions.handoff","instructions.ack","instructions.lookup-native","instructions.consumer.register","fixture.native-registration-rollback","fixture.native-registration-crash") if runner is None else runner
        kwargs={"key":"runner","credential":self.runner_credential} if use_runner else {}
        status,response=self.invoke(action,value,component=component,**kwargs)
        OBS.append({"action":action,"http_status":status,"ok":response.get("ok"),"error_code":response.get("error",{}).get("code")})
        return status,response
    def ok(self,action,value=None,runner=None):
        status,response=self.request_action(action,{} if value is None else value,runner)
        expect(status==200 and response.get("ok") is True,"Actual HTTPS service rejected positive operation: "+str(response.get("error")))
        return response["result"]
    def reject(self,action,value,code=None,runner=None):
        status,response=self.request_action(action,value,runner)
        expect(response.get("ok") is False,"Actual HTTPS service accepted negative operation")
        if code:expect(response["error"]["code"]==code,"Unexpected refusal: "+str(response["error"]))
    def enroll_runner(self):
        expect(self.bind()[1].get("ok") is True,"Real provisioner binding failed")
        issue=self.invoke("identity.grant.issue",{"grant_id":self.grant,"provisioning_intent_id":self.ids["intent"],"verifier":identity.sha(self.secret),
            "allowed_actions":["identity.describe","instructions.handoff","instructions.ack","instructions.lookup-native","instructions.consumer.register","fixture.native-registration-rollback","fixture.native-registration-crash"],"ttl_seconds":300})
        expect(issue[1].get("ok") is True,"Real runner grant failed: "+str(issue[1].get("error")))
        enrolled=self.request(self.enrollment(),key="runner",endpoint="/v1/enroll",credential=self.grant)
        expect(enrolled[1].get("ok") is True,"Real runner enrollment failed")
        self.runner_credential=enrolled[1]["result"]["credential_id"]
def event(n,version="1",aggregate=None,event_type="fixture.changed"):
    return dict(S,id=uid(n),aggregate_type="fixture",aggregate_id=uid(aggregate or n),aggregate_version=version,
        event_type=event_type,payload={"source_digest":"sha256:"+"a"*64,"value":n})
def claim(s,lease=300000,limit=64):return s.ok("outbox.claim",dict(S,consumer_id=CONSUMER,limit=limit,lease_ms=lease))
def receipt(e,consumer=CONSUMER):
    return ACTIVE.ok("inbox.receive",dict(S,event_id=e["id"],consumer_id=consumer))["inbox_id"]
def ack(s,c,inbox):
    return s.ok("outbox.acknowledge",dict(S,event_id=c["id"],consumer_id=CONSUMER,attempt_count=c["attempt_count"],inbox_id=inbox))
def raw_event_sql(e):
    return ("INSERT INTO hyperfide.outbox_events(organisation_id,run_id,id,aggregate_type,aggregate_id,aggregate_version,event_type,payload) VALUES("+
        ",".join(map(q,[e["organisation_id"],e["run_id"],e["id"],e["aggregate_type"],e["aggregate_id"],e["aggregate_version"],e["event_type"],json.dumps(e["payload"])]))+");"+        "INSERT INTO hyperfide.event_deliveries(organisation_id,run_id,event_id,consumer_id) VALUES("+",".join(map(q,[S["organisation_id"],S["run_id"],e["id"],CONSUMER]))+");")
class Session:
    def __init__(self):
        self.p=subprocess.Popen(["psql","-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-d",env()["PGDATABASE"]],
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env())
    def call(self,text):
        self.p.stdin.write(text+"\nSELECT '__DOMAIN06_DONE__';\n");self.p.stdin.flush();out=[]
        while True:
            line=self.p.stdout.readline()
            if not line:raise AssertionError("Concurrent PostgreSQL session ended unexpectedly")
            if line.strip()=="__DOMAIN06_DONE__":return "\n".join(out)
            out.append(line.strip())
    def close(self):
        self.p.stdin.close()
        try:self.p.wait(timeout=5)
        except subprocess.TimeoutExpired:self.p.kill();self.p.wait()
def suite61(s):
    check("outbox.real-service",lambda:expect(s.ok("outbox.describe")["global_cursor"] is False,"Global cursor was enabled"))
    check("outbox.module-copy-integrity",lambda:expect(s.module_equal,"Fixture changed actual compiled modules"))
    def runtime_role():
        actual=s.ok("fixture.runtime-role",S)
        expect(actual["role"]==s.runtime_role and all(actual[key] is False for key in ["rolsuper","rolcreatedb","rolcreaterole","migrations_mutable"]),
            "Actual HTTPS SQL handler retained migration/superuser credentials")
    check("outbox.least-privilege-runtime",runtime_role)
    e=event(1001)
    check("outbox.enqueue-committed",lambda:expect(s.ok("outbox.enqueue",e)["obligations"]==1,"No actual obligation"))
    check("outbox.idempotent-replay",lambda:expect(s.ok("outbox.enqueue",e)["replayed"] is True,"Replay changed event"))
    check("outbox.conflicting-payload",lambda:s.reject("outbox.enqueue",dict(e,payload={"different":True}),"EVENT_IDEMPOTENCY_CONFLICT"))
    check("outbox.aggregate-version-unique",lambda:s.reject("outbox.enqueue",dict(e,id=uid(1002),event_type="different.event"),"EVENT_IDEMPOTENCY_CONFLICT"))
    check("outbox.reject-unknown-fields",lambda:s.reject("outbox.enqueue",dict(e,sql="SELECT 1"),"EVENT_INPUT_INVALID"))
    check("outbox.require-buffered-bootstrap",lambda:s.reject("outbox.consumer.register",dict(S,id=uid(601),consumer_key="late",critical=False,state="ACTIVE"),"EVENT_BOOTSTRAP_REQUIRED"))
    c=claim(s)[0]
    check("outbox.actual-claim",lambda:expect(c["id"]==e["id"] and c["attempt_count"]=="1","Wrong committed event claimed"))
    check("outbox.stale-generation",lambda:s.reject("outbox.acknowledge",dict(S,event_id=e["id"],consumer_id=CONSUMER,attempt_count="2",inbox_id=uid(9999)),"EVENT_STALE_CLAIM"))
    check("outbox.refuse-unproven-ack",lambda:s.reject("outbox.acknowledge",dict(S,event_id=e["id"],consumer_id=CONSUMER,attempt_count="1",inbox_id=uid(9999)),"EVENT_RECEIPT_REQUIRED"))
    inbox=receipt(e)
    check("outbox.durable-receipt-ack",lambda:expect(ack(s,c,inbox)["acknowledged"],"Durable receipt not acknowledged"))
    check("outbox.ack-replay",lambda:expect(ack(s,c,inbox)["replayed"],"Ack replay not stable"))
    check("outbox.ack-terminal",lambda:s.reject("outbox.retry",dict(S,event_id=e["id"],consumer_id=CONSUMER,attempt_count="1",delay_ms=0,error="retry"),"EVENT_ALREADY_ACKNOWLEDGED"))
    e2=event(1010);s.ok("outbox.enqueue",e2);old=claim(s,50)[0];sql("SELECT pg_sleep(0.1);");fresh=claim(s)[0]
    check("outbox.expired-claim-recovered",lambda:expect(old["id"]==fresh["id"] and fresh["attempt_count"]=="2","Expired generation not recovered"))
    check("outbox.expired-ack-refused",lambda:s.reject("outbox.acknowledge",dict(S,event_id=e2["id"],consumer_id=CONSUMER,attempt_count=old["attempt_count"],inbox_id=uid(8888)),"EVENT_STALE_CLAIM"))
    check("outbox.retry-retained",lambda:expect(s.ok("outbox.retry",dict(S,event_id=e2["id"],consumer_id=CONSUMER,attempt_count=fresh["attempt_count"],delay_ms=0,error="DEPENDENCY_UNAVAILABLE"))["pending"],"Retry erased obligation"))
    third=claim(s)[0];ack(s,third,receipt(e2))
    for n in range(1020,1024):s.ok("outbox.enqueue",event(n))
    def concurrent_claims():
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            results=list(pool.map(lambda _:claim(s,300000,2),range(2)))
        ids=[r["id"] for rows in results for r in rows]
        expect(len(ids)==4 and len(set(ids))==4,"Concurrent pollers claimed duplicates or skipped pending work")
    check("outbox.concurrent-disjoint-claims",concurrent_claims)
    before=sql("SELECT state_version FROM hyperfide.runs WHERE id="+q(S["run_id"])+";")
    rollback=event(1030)
    check("outbox.atomic-rollback-refused",lambda:s.reject("fixture.atomic",{"event":rollback,"rollback":True}))
    check("outbox.atomic-rollback-observed",lambda:expect(sql("SELECT state_version FROM hyperfide.runs WHERE id="+q(S["run_id"])+";")==before and
        sql("SELECT count(*) FROM hyperfide.outbox_events WHERE id="+q(rollback["id"])+";")=="0","Failed domain mutation or event persisted"))
    def late_lower():
        sql("CREATE SEQUENCE public.fixture_commit_sequence;")
        a=Session()
        try:
            a.call("BEGIN;");low=a.call("SELECT nextval('public.fixture_commit_sequence');").strip()
            late=event(1040);late["payload"]["allocated_sequence"]=low;a.call(raw_event_sql(late))
            high=sql("SELECT nextval('public.fixture_commit_sequence');")
            early=event(1041);early["payload"]["allocated_sequence"]=high
            sql("BEGIN;"+raw_event_sql(early)+"COMMIT;")
            first=claim(s)
            expect([r["id"] for r in first]==[early["id"]] and int(low)<int(high),"Oracle did not establish inverted allocation/visibility")
            a.call("COMMIT;");second=claim(s)
            expect([r["id"] for r in second]==[late["id"]],"Late lower allocation was skipped")
        finally:a.close()
    check("outbox.late-lower-sequence",late_lower)
    s.ok("outbox.consumer.register",dict(S,id=uid(601),consumer_key="private-other-session",critical=True,state="BUFFERING"))
    private=event(1050)
    check("outbox.targeted-private-delivery",lambda:expect(s.ok("fixture.selected",{"event":private,"consumer_ids":[CONSUMER]})["obligations"]==1 and
        sql("SELECT count(*) FROM hyperfide.event_deliveries WHERE event_id="+q(private["id"])+" AND consumer_id="+q(uid(601))+";")=="0","Private payload was broadcast to another critical consumer"))
    check("outbox.recipient-replay-conflict",lambda:s.reject("fixture.selected",{"event":private,"consumer_ids":[uid(601)]},"EVENT_IDEMPOTENCY_CONFLICT"))
    check("outbox.unregistered-recipient-refused",lambda:s.reject("fixture.selected",{"event":event(1051),"consumer_ids":[uid(699)]},"EVENT_CONSUMER_REQUIRED"))

    # These principals/session rows come from the actual14 fixture; native CLI observation is outside this component receipt.
    leader=s.add_principal("leader","LEADER");other=s.add_principal("otherleader","LEADER");session=leader["actor_id"]
    human=uid(610);notice=uid(611)
    for consumer,namespace in [(human,"human_intent"),(notice,"fleet_notification")]:
        s.ok("outbox.consumer.register",dict(S,id=consumer,consumer_key="session:"+session+":"+namespace,critical=True,state="BUFFERING"))
    binding=dict(S,session_id=session,consumer_id=human,namespace="human_intent")
    check("outbox.binding-real-session",lambda:expect(s.ok("outbox.consumer.bind-session",binding)["session_id"]==session,"No typed registered recipient binding"))
    check("outbox.binding-replay",lambda:expect(s.ok("outbox.consumer.bind-session",binding)["replayed"],"Binding replay changed the edge"))
    check("outbox.binding-separate-namespaces",lambda:expect(s.ok("outbox.consumer.bind-session",dict(binding,consumer_id=notice,namespace="fleet_notification"))["consumer_id"]==notice,
        "Different trusted namespaces forced a shared consumer"))
    check("outbox.binding-no-implicit-activation",lambda:expect(sql("SELECT state FROM hyperfide.event_consumers WHERE id="+q(human))=="BUFFERING","Binding fabricated snapshot activation"))
    check("outbox.binding-real-self-proof",lambda:expect(s.invoke("outbox.consumer.bind-session",binding,component="6.1",key="leader")[1].get("ok") is True,"Actual signed self binding failed"))
    check("outbox.binding-other-session-refused",lambda:expect(s.invoke("outbox.consumer.bind-session",binding,component="6.1",key="otherleader")[1].get("error",{}).get("code")=="AUTH_SCOPE_DENIED","Another real principal claimed recipient ownership"))
    check("outbox.binding-wrong-key-refused",lambda:s.reject("outbox.consumer.bind-session",dict(binding,consumer_id=CONSUMER),"EVENT_BINDING_INVALID"))
    check("outbox.binding-unknown-namespace-refused",lambda:s.reject("outbox.consumer.bind-session",dict(binding,namespace="arbitrary"),"EVENT_NAMESPACE_INVALID"))
    check("outbox.binding-resolve-exact-namespace",lambda:expect(s.ok("outbox.consumer.resolve-session",dict(S,session_id=session,namespace="fleet_notification"))["consumer_id"]==notice,"Resolution crossed the namespace"))
    def immutable_binding():
        p=subprocess.run(["psql","-X","-q","-v","ON_ERROR_STOP=1","-d",database()],input="DELETE FROM hyperfide.event_session_bindings WHERE consumer_id="+q(human),text=True,capture_output=True,env=env(),timeout=30)
        expect(p.returncode!=0 and "immutable history cannot be deleted" in p.stderr,"Typed binding history was deleted")
    check("outbox.binding-history-immutable",immutable_binding)
    sql("UPDATE hyperfide.agent_sessions SET state='DISCONNECTED',state_version=state_version+1 WHERE id="+q(session))
    check("outbox.binding-disconnected-standing-queue",lambda:expect(s.ok("outbox.consumer.resolve-session",dict(S,session_id=session,namespace="human_intent"))["session_state"]=="DISCONNECTED","Disconnected standing recipient was silently replaced"))
    sql("UPDATE hyperfide.agent_sessions SET state='STOPPED',state_version=state_version+1 WHERE id="+q(session))
    check("outbox.binding-stopped-recipient-held",lambda:s.reject("outbox.consumer.resolve-session",dict(S,session_id=session,namespace="human_intent")))
    check("outbox.binding-retained-source-history",lambda:expect(s.ok("fixture.binding",dict(S,consumer_id=human))["session_state"]=="STOPPED","Stopped binding history was erased or granted current authority"))

def suite62(s):
    e1=event(2001,aggregate=2000);e2=event(2002,version="2",aggregate=2000)
    s.ok("outbox.enqueue",e2)
    check("inbox.real-service",lambda:expect(s.ok("inbox.describe")["duplicate_effects"] is False,"Dedupe contract missing"))
    check("inbox.missing-history-resnapshot",lambda:expect(s.ok("inbox.receive",dict(S,event_id=e2["id"],consumer_id=CONSUMER))["status"]=="RESNAPSHOT_REQUIRED","Truncated history was silently accepted"))
    s.ok("outbox.enqueue",e1)
    check("inbox.reorder-gap",lambda:expect(s.ok("inbox.receive",dict(S,event_id=e2["id"],consumer_id=CONSUMER))["status"]=="GAP","Out-of-order effect was applied"))
    first=s.ok("inbox.receive",dict(S,event_id=e1["id"],consumer_id=CONSUMER))
    check("inbox.expected-version-applied",lambda:expect(first["status"]=="APPLIED" and first["inbox_id"],"Expected event not durably received"))
    check("inbox.duplicate-no-effect",lambda:expect(s.ok("inbox.receive",dict(S,event_id=e1["id"],consumer_id=CONSUMER))["status"]=="DUPLICATE","Replay reapplied effect"))
    check("inbox.gap-recovered",lambda:expect(s.ok("inbox.receive",dict(S,event_id=e2["id"],consumer_id=CONSUMER))["status"]=="APPLIED","Deferred event did not apply after gap recovery"))
    check("inbox.two-durable-receipts",lambda:expect(sql("SELECT count(*) FROM hyperfide.command_inbox WHERE operation='event.receive';")=="2","Inbox effect count differs"))
    check("inbox.cross-consumer-refused",lambda:s.reject("inbox.receive",dict(S,event_id=e1["id"],consumer_id=uid(602)),"INBOX_EVENT_NOT_FOUND"))
    check("inbox.cross-organisation-refused",lambda:s.reject("inbox.receive",dict(S,organisation_id=uid(100),event_id=e1["id"],consumer_id=CONSUMER),"AUTH_SCOPE_DENIED"))
    terminal=event(2011,aggregate=2010,event_type="aggregate.completed");next_event=event(2012,version="2",aggregate=2010)
    s.ok("outbox.enqueue",terminal);s.ok("outbox.enqueue",next_event);s.ok("inbox.receive",dict(S,event_id=terminal["id"],consumer_id=CONSUMER))
    check("inbox.terminal-nonregression",lambda:s.reject("inbox.receive",dict(S,event_id=next_event["id"],consumer_id=CONSUMER),"INBOX_TERMINAL"))
    for e in [event(2022,version="2",aggregate=2020),event(2021,aggregate=2020)]:s.ok("outbox.enqueue",e)
    check("inbox.ordered-replay",lambda:expect([r["status"] for r in s.ok("inbox.replay",dict(S,consumer_id=CONSUMER,aggregate_type="fixture",aggregate_id=uid(2020),limit=64))["results"]]==["APPLIED","APPLIED"],"Replay did not restore aggregate order"))
    check("inbox.source-provenance-preserved",lambda:expect(json.loads(sql("SELECT payload::text FROM hyperfide.outbox_events WHERE id="+q(e1["id"])+";"))==e1["payload"],"Receiver overwrote source provenance"))

    check("inbox.concurrent-duplicate-single-effect",lambda:concurrent_duplicate(s))

    late=uid(603);boot=uid(2040);e=event(2041,aggregate=2040)
    s.ok("outbox.consumer.register",dict(S,id=late,consumer_key="snapshot-reader",critical=False,state="BUFFERING"))
    s.ok("fixture.selected",{"event":e,"consumer_ids":[late]})
    check("inbox.buffering-cannot-apply",lambda:s.reject("inbox.receive",dict(S,event_id=e["id"],consumer_id=late),"INBOX_EVENT_NOT_FOUND"))
    boot_input=dict(S,bootstrap_id=boot,consumer_id=late,aggregate_types=["fixture"],limit=64)
    check("inbox.bootstrap-bound-retains-buffer",lambda:s.reject("fixture.bootstrap",dict(boot_input,limit=1),"INBOX_SNAPSHOT_BOUND"))
    booted=s.ok("fixture.bootstrap",boot_input)
    check("inbox.trusted-bootstrap-activates",lambda:expect(booted["activated"] and booted["covered_deliveries"]==1 and
        sql("SELECT state FROM hyperfide.event_consumers WHERE id="+q(late))=="ACTIVE","Snapshot did not atomically install baseline"))
    check("inbox.bootstrap-replay",lambda:expect(s.ok("fixture.bootstrap",boot_input)["replayed"],"Snapshot replay rebuilt its projection"))
    check("inbox.snapshot-covered-delivery",lambda:expect(s.ok("inbox.receive",dict(S,event_id=e["id"],consumer_id=late))["status"]=="DUPLICATE","Snapshot-covered event reapplied"))
    next_e=event(2042,version="2",aggregate=2040);s.ok("fixture.selected",{"event":next_e,"consumer_ids":[late]})
    check("inbox.bootstrap-then-live-event",lambda:expect(s.ok("inbox.receive",dict(S,event_id=next_e["id"],consumer_id=late))["status"]=="APPLIED","Live event did not follow primary snapshot baseline"))

    source=dict(event(2051),aggregate_type="human_command",event_type="leader.intent.requested",
        payload={"leader_generation":"1","target_session_id":uid(850),"authority_epoch":s.ids["epoch"],"message":"original fixture user intent"})
    adopted=dict(event(2052),aggregate_type="human_intent_transfer",event_type="leader.intent.adopted",
        payload={"leader_generation":"2","target_session_id":uid(851),"authority_epoch":s.ids["epoch"],"supersedes_event_id":source["id"],"original_event_id":source["id"],"original_intent":source["payload"]})
    s.ok("fixture.selected",{"event":source,"consumer_ids":[CONSUMER]})
    s.ok("fixture.selected",{"event":adopted,"consumer_ids":[late]})
    transfer=dict(S,transfer_id=uid(2500),original_event_id=source["id"],original_consumer_id=CONSUMER,
        replacement_event_id=adopted["id"],replacement_consumer_id=late)
    check("inbox.supersession-sql-contract",lambda:expect(s.ok("fixture.supersede",transfer)["task_completed"] is False,
        "SQL supersession claimed applied main-agent work"))
    check("inbox.supersession-preserves-pending-replacement",lambda:expect(sql("SELECT state FROM hyperfide.event_deliveries WHERE event_id="+q(source["id"])+" AND consumer_id="+q(CONSUMER))=="ACKNOWLEDGED" and
        sql("SELECT state FROM hyperfide.event_deliveries WHERE event_id="+q(adopted["id"])+" AND consumer_id="+q(late))=="PENDING","Transfer lost replacement or failed to retire old route"))
    check("inbox.supersession-replay",lambda:expect(s.ok("fixture.supersede",transfer)["replayed"],"Transfer replay duplicated the edge"))
    branched=dict(adopted,id=uid(2053),aggregate_id=uid(2053),payload=dict(adopted["payload"],leader_generation="3"))
    s.ok("fixture.selected",{"event":branched,"consumer_ids":[late]})
    check("inbox.supersession-branch-refused",lambda:s.reject("fixture.supersede",dict(transfer,transfer_id=uid(2501),replacement_event_id=branched["id"]),"INBOX_SUPERSESSION_CONFLICT"))
    wrong=dict(adopted,id=uid(2054),aggregate_id=uid(2054),payload=dict(adopted["payload"],supersedes_event_id=uid(999)))
    s.ok("fixture.selected",{"event":wrong,"consumer_ids":[late]})
    check("inbox.supersession-source-reference-refused",lambda:s.reject("fixture.supersede",dict(transfer,transfer_id=uid(2502),replacement_event_id=wrong["id"]),"INBOX_SUPERSESSION_INVALID"))
    chained=dict(adopted,id=uid(2055),aggregate_id=uid(2055),payload=dict(adopted["payload"],leader_generation="3",supersedes_event_id=adopted["id"],original_intent=source["payload"]))
    s.ok("fixture.selected",{"event":chained,"consumer_ids":[late]})
    check("inbox.supersession-same-recipient-new-generation",lambda:expect(s.ok("fixture.supersede",dict(transfer,transfer_id=uid(2503),original_event_id=adopted["id"],original_consumer_id=late,replacement_event_id=chained["id"],replacement_consumer_id=late))["source_preserved"],
        "Proved newer-generation chain with same standing recipient was rejected"))
    check("inbox.supersession-immutable-original",lambda:expect(json.loads(sql("SELECT payload::text FROM hyperfide.outbox_events WHERE id="+q(source["id"])))==source["payload"],
        "Adoption relabelled original human intent"))

    pending=dict(source,id=uid(2061),aggregate_id=uid(2061))
    replacement=dict(adopted,id=uid(2062),aggregate_id=uid(2062),payload=dict(adopted["payload"],supersedes_event_id=pending["id"],original_event_id=pending["id"]))
    s.ok("fixture.selected",{"event":pending,"consumer_ids":[CONSUMER]})
    s.ok("fixture.selected",{"event":replacement,"consumer_ids":[late]})
    admitted=s.ok("inbox.receive",dict(S,event_id=pending["id"],consumer_id=CONSUMER))
    receipt_before=sql("SELECT row_to_json(c)::text FROM hyperfide.command_inbox c WHERE operation='event.receive' AND principal_scope="+q(CONSUMER)+" AND idempotency_key="+q(pending["id"]))
    s.ok("fixture.supersede",dict(transfer,transfer_id=uid(2504),original_event_id=pending["id"],replacement_event_id=replacement["id"]))
    check("inbox.supersession-preserves-prior-admission",lambda:expect(receipt_before==sql("SELECT row_to_json(c)::text FROM hyperfide.command_inbox c WHERE operation='event.receive' AND principal_scope="+q(CONSUMER)+" AND idempotency_key="+q(pending["id"])) and admitted["inbox_id"],
        "Route transfer rewrote admission receipt or treated it as logical processing"))

def concurrent_duplicate(s):
    e=event(2031,aggregate=2030);s.ok("outbox.enqueue",e)
    before=int(sql("SELECT state_version FROM hyperfide.runs WHERE id="+q(S["run_id"])))
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        results=list(pool.map(lambda _:s.ok("fixture.effect",dict(S,event_id=e["id"],consumer_id=CONSUMER)),range(2)))
    expect(sorted(x["status"] for x in results)==["APPLIED","DUPLICATE"],"Concurrent duplicate did not return stable receipt")
    expect(int(sql("SELECT state_version FROM hyperfide.runs WHERE id="+q(S["run_id"])))==before+1,"Duplicate reapplied linked effect")
def seed_native_attempt(f):
    i=f.ids;org=i["organisation"];run=i["run"];sandbox=i["sandbox"];epoch=i["epoch"]
    text="BEGIN;"
    text+="INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES("+",".join(map(q,[org,run,uid(6),"native-fixture"]))+",1);"
    text+="INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) VALUES("+",".join(map(q,[org,run,uid(7),"native-task",uid(6),i["spec"],"sha256:"+"a"*64,"{}"]))+",1);"
    text+="INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind,state) VALUES("+",".join(map(q,[org,uid(10),sandbox,"agent-0","1","AGENT","READY"]))+");"
    text+="INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,execution_state,compute_authority,sandbox_id,slot_id,sandbox_boot_generation,lease_expires_at) VALUES("+",".join(map(q,[org,run,uid(30),uid(7),"1",epoch,"sha256:"+"a"*64,"RUNNING","CURRENT",sandbox,uid(10),"1"]))+",clock_timestamp()+interval '10 minutes');"
    text+="UPDATE hyperfide.tasks SET generation=1,current_attempt_id="+q(uid(30))+",state_version=state_version+1 WHERE id="+q(uid(7))+";"
    text+="INSERT INTO hyperfide.compute_leases(organisation_id,run_id,id,attempt_id,attempt_generation,authority_epoch,sandbox_boot_generation,expires_at) VALUES("+",".join(map(q,[org,run,uid(40),uid(30),"1",epoch,"1"]))+",clock_timestamp()+interval '10 minutes');COMMIT;"
    f.sql(text)
    return {"organisation_id":org,"run_id":run,"attempt_id":uid(30),"attempt_generation":"1","authority_epoch":epoch,"sandbox_boot_generation":"1"}
def command(n,kind):
    body={"launch_id":uid(700)}
    if kind=="START":body.update(slot_id=uid(10),agent_session_id=uid(701),connector_plan_digest="sha256:"+"b"*64)
    if kind=="STEER":body.update(request_id=uid(n+5000),frame_b64=base64.urlsafe_b64encode(b"steer").decode().rstrip("="))
    return dict(S,id=uid(n),attempt_id=uid(30),attempt_generation="1",authority_epoch=ACTIVE.ids["epoch"],sandbox_boot_generation="1",kind=kind,body=body)
def control(s,mode,operation,expected=None):
    value={"scope_kind":"ATTEMPT","scope_id":uid(30),"mode":mode,"operation_id":uid(operation),"reason":"registered component control test"}
    if expected is not None:value.update(expected_generation=str(expected),resume=mode=="ACTIVE")
    return s.ok("fixture.control",dict(S,control=value))
def suite63(s):
    # Older unrelated obligations must not become a native boot's snapshot baseline.
    for n,label in [(610,"human-private"),(611,"notification-private")]:
        s.ok("outbox.consumer.register",dict(S,id=uid(n),consumer_key=label,critical=True,state="ACTIVE"))
    s.ok("fixture.selected",{"event":event(2900),"consumer_ids":[uid(610),uid(611)]})
    seed_native_attempt(s);s.enroll_runner();start=command(3001,"START")
    check("instructions.missing-native-binding-refused",lambda:s.reject("instructions.issue",start,"INSTRUCTION_CONSUMER_REQUIRED"))
    registration=dict(S,consumer_id=CONSUMER)
    check("instructions.bootstrap-interruption-refused",lambda:s.reject("fixture.native-registration-rollback",registration))
    check("instructions.bootstrap-interruption-atomic",lambda:expect(sql("SELECT (SELECT count(*) FROM hyperfide.event_consumers WHERE id="+q(CONSUMER)+")+(SELECT count(*) FROM hyperfide.event_runner_bindings WHERE consumer_id="+q(CONSUMER)+")+(SELECT count(*) FROM hyperfide.command_inbox WHERE operation='instruction.consumer-genesis' AND principal_scope="+q(CONSUMER)+")")=="0","Interrupted native bootstrap left an active consumer, binding or receipt"))
    def crash_bootstrap():
        old=s.child;disconnected=False
        try:s.ok("fixture.native-registration-crash",registration)
        except Exception:disconnected=True
        old.wait(timeout=10);expect(disconnected and old.returncode==-signal.SIGKILL,"Bootstrap process did not actually die before COMMIT")
        s.child=None
        expect(sql("SELECT (SELECT count(*) FROM hyperfide.event_consumers WHERE id="+q(CONSUMER)+")+(SELECT count(*) FROM hyperfide.event_runner_bindings WHERE consumer_id="+q(CONSUMER)+")+(SELECT count(*) FROM hyperfide.command_inbox WHERE operation='instruction.consumer-genesis' AND principal_scope="+q(CONSUMER)+")")=="0","SIGKILL left a partial native activation")
        s.start()
    check("instructions.bootstrap-sigkill-before-commit",crash_bootstrap)
    registered=s.ok("instructions.consumer.register",registration)
    check("instructions.late-native-genesis-preserves-other-streams",lambda:expect(sql("SELECT count(*) FROM hyperfide.event_deliveries WHERE event_id="+q(uid(2900))+" AND state='PENDING'")=="2","Native genesis consumed unrelated historical delivery obligations"))
    check("instructions.actual-native-bootstrap",lambda:expect(registered["consumer_state"]=="ACTIVE" and registered["boot_id"]==s.ids["boot"] and registered["execution_authority"] is False,"Authenticated native genesis did not bind the actual boot"))
    check("instructions.native-bootstrap-recovery-reference",lambda:expect(s.ok("fixture.snapshot",dict(S,limit=64))["runner_consumers"][0]["bootstrap_receipt_id"]==registered["bootstrap_receipt_id"],"Primary recovery lost the actual immutable native binding receipt"))
    check("instructions.native-bootstrap-exact-replay",lambda:expect(s.ok("instructions.consumer.register",registration)["replayed"],"Existing boot history was replaced"))
    check("instructions.native-bootstrap-retarget-refused",lambda:s.reject("instructions.consumer.register",dict(S,consumer_id=uid(609)),"INSTRUCTION_CONSUMER_CONFLICT"))
    check("instructions.native-bootstrap-caller-boot-refused",lambda:s.reject("instructions.consumer.register",dict(registration,boot_id=uid(999)),"EVENT_INPUT_INVALID"))
    check("instructions.native-bootstrap-nonrunner-refused",lambda:s.reject("instructions.consumer.register",registration,"AUTH_ROLE_DENIED",runner=False))
    actors={name:s.add_principal(name,role) for name,role in [("oldleader","LEADER"),("currentleader","LEADER"),("manager","FEATURE_MANAGER"),("othermanager","FEATURE_MANAGER")]}
    def actor_call(name,action,value,component="6.3",expected=None):
        status,response=s.invoke(action,value,component=component,key=name,credential=s.ids[name])
        if expected:
            expect(response.get("ok") is False and response.get("error",{}).get("code")==expected,"Unexpected hierarchy-bound refusal: "+str(response))
        else:
            expect(status==200 and response.get("ok"),"Actual hierarchy-bound operation failed: "+str(response))
            return response["result"]
    actor_call("oldleader","hierarchy.leader.acquire",{"idempotency_key":str(uuid.uuid4()),"expected_generation":"0","reason":"actual instruction boundary fixture"},component="3.1")
    actor_call("currentleader","hierarchy.leader.acquire",{"idempotency_key":str(uuid.uuid4()),"expected_generation":"1","reason":"actual selected leader replacement"},component="3.1")
    actor_call("currentleader","hierarchy.package.configure",{"idempotency_key":str(uuid.uuid4()),"leader_generation":"2","package_id":uid(6),"feature_key":"native-fixture","allocation_policy":"WAVE"},component="3.1")
    actor_call("currentleader","hierarchy.package.assign",{"idempotency_key":str(uuid.uuid4()),"leader_generation":"2","package_id":uid(6),"expected_generation":"1","manager_session_id":actors["manager"]["actor_id"]},component="3.1")
    check("instructions.other-manager-refused",lambda:actor_call("othermanager","instructions.issue",start,expected="PACKAGE_OWNER_MISMATCH"))
    check("instructions.former-leader-refused",lambda:actor_call("oldleader","instructions.issue",start,expected="LEADER_GENERATION_STALE"))
    check("instructions.refused-actor-no-start-obligation",lambda:expect(sql("SELECT count(*) FROM hyperfide.outbox_events WHERE aggregate_type='attempt.instructions'")=="0","Refused actor committed a START"))
    check("instructions.actual-owning-manager-start",lambda:expect(actor_call("manager","instructions.issue",start)["obligations"]==1,"Actual assigned manager could not issue its START"))
    check("instructions.actual-selected-leader-replay",lambda:expect(actor_call("currentleader","instructions.issue",start)["replayed"],"Current selected leader could not inspect/replay its exact instruction"))
    lineage=sql("SELECT row_to_json(a)::text FROM hyperfide.attempts a WHERE id="+q(uid(30)))
    proposed=actor_call("currentleader","hierarchy.package.handoff.propose",{"idempotency_key":str(uuid.uuid4()),"leader_generation":"2","package_ids":[uid(6)],"expected_generations":{uid(6):"2"},"successor_id":actors["othermanager"]["actor_id"],"context":{"summary":"actual manager transfer while native START remains immutable","decision_refs":[],"pending_instruction_refs":[],"native_session_refs":[]}},component="3.1")
    check("instructions.actual-acknowledged-manager-handoff",lambda:expect(actor_call("othermanager","hierarchy.package.handoff.acknowledge",{"idempotency_key":str(uuid.uuid4()),"leader_generation":"2","handoff_id":proposed["handoff_id"]},component="3.1")["ownership_changed"],"Acknowledged actual handoff did not transfer current ownership"))
    check("instructions.former-manager-replay-refused",lambda:actor_call("manager","instructions.issue",start,expected="PACKAGE_OWNER_MISMATCH"))
    check("instructions.successor-manager-exact-replay",lambda:expect(actor_call("othermanager","instructions.issue",start)["replayed"],"Actual successor manager could not replay the same committed START"))
    check("instructions.handoff-preserves-attempt-lineage",lambda:expect(lineage==sql("SELECT row_to_json(a)::text FROM hyperfide.attempts a WHERE id="+q(uid(30))),"Current package handoff rewrote historical native attempt lineage"))
    check("instructions.exact-native-recipient-only",lambda:expect(sql("SELECT count(*)::text||','||min(consumer_id::text) FROM hyperfide.event_deliveries WHERE event_id="+q(start["id"]))=="1,"+CONSUMER,"START was broadcast to unrelated standing inboxes"))
    check("instructions.real-service",lambda:expect(s.ok("instructions.describe")["execution"]=="native-connector-required","Acceptance claimed physical execution"))
    check("instructions.stable-start",lambda:expect(s.ok("instructions.issue",start)["obligations"]==1,"Start obligation missing"))
    check("instructions.start-replay",lambda:expect(s.ok("instructions.issue",start)["replayed"],"Replay created new start"))
    check("instructions.duplicate-logical-start-refused",lambda:s.reject("instructions.issue",command(3002,"START"),"INSTRUCTION_START_EXISTS"))
    check("instructions.conflicting-command-refused",lambda:s.reject("instructions.issue",dict(start,body=dict(start["body"],connector_plan_digest="sha256:"+"c"*64)),"INSTRUCTION_IDEMPOTENCY_CONFLICT"))
    check("instructions.extra-native-body-refused",lambda:s.reject("instructions.issue",dict(command(3003,"START"),body=dict(start["body"],shell="true")),"EVENT_INPUT_INVALID"))
    check("instructions.wrong-slot-refused",lambda:s.reject("instructions.issue",dict(command(3004,"START"),body=dict(start["body"],slot_id=uid(999))),"INSTRUCTION_STALE_AUTHORITY"))
    for field,value,label in [("attempt_generation","2","generation"),("authority_epoch",uid(99),"epoch"),("sandbox_boot_generation","2","boot")]:
        check("instructions.stale-"+label,lambda f=field,v=value:s.reject("instructions.issue",dict(command(3010,"STEER"),**{f:v}),"INSTRUCTION_STALE_AUTHORITY"))
    check("instructions.unsupported-kind",lambda:s.reject("instructions.issue",dict(command(3010,"STEER"),kind="SHELL"),"INSTRUCTION_INPUT_INVALID"))
    check("instructions.native-frame-budget-refused",lambda:s.reject("instructions.issue",dict(command(3010,"STEER"),body=dict(command(3010,"STEER")["body"],frame_b64=base64.urlsafe_b64encode(b"x"*4097).decode().rstrip("="))),"INSTRUCTION_INPUT_INVALID"))
    check("instructions.padded-steer-refused",lambda:s.reject("instructions.issue",dict(command(3010,"STEER"),body=dict(command(3010,"STEER")["body"],frame_b64="YQ==")),"INSTRUCTION_INPUT_INVALID"))
    control(s,"PAUSE",860)
    check("instructions.pause-defers-start-admission",lambda:s.reject("instructions.accept",dict(S,event_id=start["id"],consumer_id=CONSUMER),"EXECUTION_HELD"))
    check("instructions.pause-no-completed-start-receipt",lambda:expect(sql("SELECT count(*) FROM hyperfide.command_inbox WHERE operation='instruction.spool'")=="0","PAUSE created a completed start receipt"))
    control(s,"ACTIVE",861,1)
    def accept(c):return s.ok("instructions.accept",dict(S,event_id=c["id"],consumer_id=CONSUMER))
    check("instructions.start-durably-accepted",lambda:expect(accept(start)["result"]["execution"]=="PENDING_NATIVE_CONNECTOR","Central admission invented a process"))
    def retained_bootstrap():
        before=sql("SELECT result::text FROM hyperfide.command_inbox WHERE operation='instruction.spool' AND idempotency_key="+q(start["id"]))
        replay=s.ok("instructions.consumer.register",registration)
        expect(replay["replayed"] and replay["bootstrap_receipt_id"]==registered["bootstrap_receipt_id"] and before==sql("SELECT result::text FROM hyperfide.command_inbox WHERE operation='instruction.spool' AND idempotency_key="+q(start["id"])),"Existing boot registration reset its immutable history or actual spool")
    check("instructions.native-registration-preserves-history",retained_bootstrap)
    control(s,"PAUSE",862,2)
    check("instructions.pause-defers-queued-handoff",lambda:s.reject("instructions.handoff",dict(S,event_id=start["id"],consumer_id=CONSUMER),"EXECUTION_HELD"))
    control(s,"ACTIVE",863,3)
    packet=s.ok("instructions.handoff",dict(S,event_id=start["id"],consumer_id=CONSUMER))
    check("instructions.resume-preserves-command",lambda:expect(packet["command_id"]==start["id"],"Verified resume replaced committed command identity"))
    def native_packet():
        decoded=base64.urlsafe_b64decode(packet["payload_base64url"]+"="*((-len(packet["payload_base64url"]))%4))
        expect(packet["accepted"] and packet["command_id"]==start["id"]==packet["operation_id"] and packet["sandbox_id"]==s.ids["sandbox"] and
            packet["boot_id"]==s.ids["boot"] and packet["sequence"]=="1" and packet["payload_digest"]=="sha256:"+hashlib.sha256(decoded).hexdigest() and
            json.loads(decoded)==start["body"],"Native target tuple or exact bytes were not bound")
    check("instructions.native-handoff-binding",native_packet)
    check("instructions.lease-budget-fresh",lambda:expect(0<packet["remaining_lease_ms"]<=300000 and packet["lease_expires_at"]>packet["observed_at"],"No conservative live lease budget"))
    check("instructions.operator-cannot-impersonate-runner",lambda:s.reject("instructions.handoff",dict(S,event_id=start["id"],consumer_id=CONSUMER),"AUTH_ROLE_DENIED",runner=False))
    base={key:packet[key] for key in ["organisation_id","run_id","command_id","operation_id","attempt_id","attempt_generation","authority_epoch","sandbox_id","boot_id","sandbox_boot_generation","sequence","payload_digest"]}
    report=dict(base,ledger_receipt_id=uid(800),ledger_version="1",state="ACCEPTED",observed_process=None)
    check("instructions.native-ack-recorded",lambda:expect(s.ok("instructions.ack",report)["authority"]=="NONE","Native observation gained task authority"))
    observed=s.ok("instructions.lookup-native",dict(S,launch_id=start["body"]["launch_id"]))
    check("instructions.native-recorded-launch-reader",lambda:expect(observed["command_id"]==start["id"] and
        observed["runner_ack"]["ledger_receipt_id"]==report["ledger_receipt_id"] and observed["runner_ack"]["credential_id"]==s.runner_credential and
        observed["authority"]=="NONE" and observed["current_target"],"Launch reader lost actual authenticated ledger binding or granted compute"))
    check("instructions.lookup-forged-role-refused",lambda:s.reject("fixture.native-forged",dict(S,launch_id=uid(700))))
    s.add_principal("observer","PROVISIONER")
    def internal_lookup(value):
        status,response=s.invoke("fixture.native-lookup",value,component="fixture.events",key="observer",credential=s.ids["observer"])
        return status,response
    def provisioner_lookup():
        status,response=internal_lookup(dict(S,launch_id=uid(700)))
        expect(status==200 and response.get("ok") and response["result"]["runner_ack"]["credential_id"]==s.runner_credential and response["result"]["authority"]=="NONE","Genuine scoped provisioner observation failed")
    check("instructions.lookup-genuine-provisioner-observation",provisioner_lookup)
    check("instructions.lookup-cross-run-refused",lambda:expect(internal_lookup(dict(S,run_id=uid(999),launch_id=uid(700)))[1].get("ok") is False,"Cross-run observation accepted"))
    state_sql="SELECT result::text FROM hyperfide.command_inbox WHERE operation='instruction.runner-state' AND idempotency_key="+q(start["id"])
    original_state=json.loads(sql(state_sql))
    def mismatched_state(field,value):
        changed=dict(original_state,**{field:value})
        sql("UPDATE hyperfide.command_inbox SET result="+q(json.dumps(changed))+"::jsonb,state_version=state_version+1 WHERE operation='instruction.runner-state' AND idempotency_key="+q(start["id"]))
        try:s.reject("instructions.lookup-native",dict(S,launch_id=uid(700)),"INSTRUCTION_OBSERVATION_INVALID")
        finally:sql("UPDATE hyperfide.command_inbox SET result="+q(json.dumps(original_state))+"::jsonb,state_version=state_version+1 WHERE operation='instruction.runner-state' AND idempotency_key="+q(start["id"]))
    check("instructions.lookup-attempt-mismatch-refused",lambda:mismatched_state("attempt_id",uid(999)))
    check("instructions.lookup-state-mismatch-refused",lambda:mismatched_state("state","EXECUTING"))
    check("instructions.lookup-digest-mismatch-refused",lambda:mismatched_state("payload_digest","sha256:"+"f"*64))
    check("instructions.native-ack-replay",lambda:expect(s.ok("instructions.ack",report)["replayed"],"Lost native ACK duplicated receipt"))
    check("instructions.native-ack-conflict",lambda:s.reject("instructions.ack",dict(report,state="UNCERTAIN"),"INSTRUCTION_ACK_CONFLICT"))
    check("instructions.native-ack-target-refused",lambda:s.reject("instructions.ack",dict(report,sandbox_id=uid(999)),"INSTRUCTION_ACK_INVALID"))
    process={"os_boot_id":uid(801),"pid":42,"start_time":"1000","pgid":42}
    def start_index(aggregate):
        statement="INSERT INTO hyperfide.outbox_events(organisation_id,run_id,id,aggregate_type,aggregate_id,aggregate_version,event_type,payload) SELECT organisation_id,run_id,"+q(uid(3980+aggregate))+",aggregate_type,"+q(uid(30 if aggregate==0 else 9998))+",99,event_type,payload FROM hyperfide.outbox_events WHERE id="+q(start["id"])
        p=subprocess.run(["psql","-X","-q","-v","ON_ERROR_STOP=1","-d",database()],input=statement,text=True,capture_output=True,env=env(),timeout=30)
        expect(p.returncode!=0 and "duplicate key value" in p.stderr,"Trusted SQL bypassed the native START identity index")
    check("instructions.database-one-start-per-attempt",lambda:start_index(0))
    check("instructions.database-one-launch-per-run",lambda:start_index(1))
    check("instructions.generic-protected-emission-refused",lambda:s.reject("outbox.enqueue",dict(S,id=uid(3999),aggregate_type="attempt.instructions",aggregate_id=uid(30),aggregate_version="9",event_type="instruction.start",payload={}),"EVENT_TRUSTED_HANDLER_REQUIRED"))
    check("instructions.native-executing-observation",lambda:expect(s.ok("instructions.ack",dict(report,ledger_version="2",state="EXECUTING",observed_process=process))["task_qualified"] is False,"Observed process qualified task"))
    check("instructions.native-state-regression-refused",lambda:s.reject("instructions.ack",dict(report,ledger_version="3"),"INSTRUCTION_ACK_REGRESSION"))
    check("instructions.native-process-rebinding-refused",lambda:s.reject("instructions.ack",dict(report,ledger_version="3",state="EXECUTING",observed_process=dict(process,pid=43)),"INSTRUCTION_ACK_CONFLICT"))
    check("instructions.uncertainty-retains-process-pin",lambda:expect(s.ok("instructions.ack",dict(report,ledger_version="3",state="UNCERTAIN"))["recorded"],"Uncertainty observation failed"))
    check("instructions.uncertain-process-rebinding-refused",lambda:s.reject("instructions.ack",dict(report,ledger_version="4",state="EXECUTING",observed_process=dict(process,pid=43)),"INSTRUCTION_ACK_CONFLICT"))
    steer=command(3020,"STEER");cancel=command(3030,"CANCEL")
    s.ok("instructions.issue",steer);control(s,"PAUSE",864,4)
    check("instructions.pause-allows-cancel-cleanup",lambda:expect(s.ok("instructions.issue",cancel)["obligations"]==1,"PAUSE blocked cleanup or invented completion"))
    check("instructions.typed-replay",lambda:expect([r["status"] for r in s.ok("instructions.replay",dict(S,attempt_id=uid(30),consumer_id=CONSUMER,limit=64))["results"]]==["APPLIED","APPLIED"],"Typed replay skipped generation-bound handler"))
    control(s,"ACTIVE",865,5)
    check("instructions.cancel-fences-future-input",lambda:s.reject("instructions.issue",command(3040,"STEER"),"INSTRUCTION_CANCELLED"))
    check("instructions.accepted-start-cannot-respawn",lambda:expect(accept(start)["status"]=="DUPLICATE" and s.ok("instructions.handoff",dict(S,event_id=start["id"],consumer_id=CONSUMER))["accepted"] is False,"Native start escaped cancellation"))
    check("instructions.late-steer-suppressed",lambda:expect(accept(steer)["result"]["disposition"]=="SUPPRESSED_BY_CANCELLATION","Late steering escaped cancellation"))
    check("instructions.cancel-durably-accepted",lambda:expect(accept(cancel)["result"]["execution"]=="PENDING_NATIVE_CONNECTOR","Receipt invented external cancellation"))
    check("instructions.lost-ack-deduplicated",lambda:expect(accept(cancel)["status"]=="DUPLICATE","Cancellation appended twice"))
    check("instructions.spool-bounded-identities",lambda:expect(sql("SELECT count(*) FROM hyperfide.command_inbox WHERE operation='instruction.spool';")=="3","Instruction appended more than once"))
    check("instructions.generic-inbox-bypass-refused",lambda:s.reject("inbox.receive",dict(S,event_id=cancel["id"],consumer_id=CONSUMER),"INBOX_TRUSTED_HANDLER_REQUIRED"))
    sql("UPDATE hyperfide.compute_leases SET expires_at=clock_timestamp()-interval '1 second',state_version=state_version+1 WHERE id="+q(uid(40))+";")
    check("instructions.expired-compute-can-report-terminal",lambda:expect(s.ok("instructions.ack",dict(report,ledger_version="4",state="TERMINAL",observed_process=process))["authority"]=="NONE","Expired worker observation was lost or gained authority"))
    check("instructions.expired-cancel-has-zero-budget",lambda:expect(s.ok("instructions.handoff",dict(S,event_id=cancel["id"],consumer_id=CONSUMER))["remaining_lease_ms"]==0,"Cleanup granted compute budget"))
    sql("UPDATE hyperfide.runs SET state='STOPPING',state_version=state_version+1 WHERE id="+q(S["run_id"]))
    check("instructions.closing-cancel-handoff",lambda:expect(s.ok("instructions.handoff",dict(S,event_id=cancel["id"],consumer_id=CONSUMER))["remaining_lease_ms"]==0,"Closing cleanup was denied or granted compute"))
    check("instructions.closing-start-refused",lambda:s.reject("instructions.handoff",dict(S,event_id=start["id"],consumer_id=CONSUMER),"AUTH_RUN_CLOSED"))
    check("instructions.closing-terminal-observation",lambda:expect(s.ok("instructions.ack",dict(report,ledger_version="5",state="TERMINAL",observed_process=process))["authority"]=="NONE","Closing observation granted compute or lost actual terminal receipt"))
    sql("UPDATE hyperfide.runs SET state='RUNNING',state_version=state_version+1 WHERE id="+q(S["run_id"]))
    sql("UPDATE hyperfide.sandboxes SET boot_generation=2,state_version=state_version+1 WHERE id="+q(s.ids["sandbox"])+";")
    check("instructions.stale-native-boot-refused",lambda:s.reject("instructions.handoff",dict(S,event_id=cancel["id"],consumer_id=CONSUMER)))
    check("instructions.stale-boot-registration-refused",lambda:s.reject("instructions.consumer.register",dict(S,consumer_id=uid(612))))
def suite64(s):
    for n in [4001,4002,4003]:s.ok("outbox.enqueue",event(n))
    check("recovery.real-service",lambda:expect(s.ok("recovery.describe")["notifications"]=="wakeups-only","Notification became authority"))
    info=s.ok("recovery.inspect",dict(S,consumer_id=CONSUMER))
    check("recovery.lost-notification-discoverable",lambda:expect(sum(int(r["discoverable"]) for r in info["queues"])==3,"Durable work needed a stream notification"))
    first=s.ok("recovery.claim",dict(S,consumer_id=CONSUMER,limit=64,lease_ms=50));s.stop();s.start();sql("SELECT pg_sleep(0.1);")
    restarted=s.ok("recovery.claim",dict(S,consumer_id=CONSUMER,limit=64,lease_ms=5000))
    check("recovery.controller-restart",lambda:expect({e["id"] for e in first}=={e["id"] for e in restarted} and all(e["attempt_count"]=="2" for e in restarted),"Restart lost or replaced obligations"))
    for e in restarted:
        r=s.ok("inbox.receive",dict(S,event_id=e["id"],consumer_id=CONSUMER));ack(s,e,r["inbox_id"])
    check("recovery.confirmed-acks-only",lambda:expect(claim(s)==[],"Acknowledged obligations were redelivered"))
    s.ok("outbox.enqueue",event(4010))
    result=s.ok("fixture.dispatch",{"config":dict(S,consumer_id=CONSUMER,batch_size=64,lease_ms=5000,poll_ms=10,retry_ms=0),
        "lose_first_ack":True,"poll":True})
    check("recovery.after-send-before-ack",lambda:expect(result["sends"]==2 and result["first"]["pending"]==1,"Lost acknowledgement was not redelivered"))
    check("recovery.receiver-effect-once",lambda:expect(sql("SELECT count(*) FROM hyperfide.command_inbox WHERE operation='event.receive' AND idempotency_key="+q(uid(4010))+";")=="1","Retry duplicated durable receiver effect"))
    check("recovery.periodic-poll-without-wakeup",lambda:expect(claim(s)==[],"Periodic polling did not finish durable acknowledgement"))
    check("recovery.unknown-outcome-retains-identity",lambda:expect(sql("SELECT attempt_count FROM hyperfide.event_deliveries WHERE event_id="+q(uid(4010))+";")=="2","Unknown result replaced the command identity"))
    snapshot=s.ok("fixture.snapshot",dict(S,limit=1))
    check("recovery.snapshot-bounded",lambda:expect(snapshot["source"]=="primary-transaction" and len(snapshot["cursor_and_instruction_records"])==1 and snapshot["truncated"]["cursor_and_instruction_records"],"Recovery snapshot was unbounded or concealed truncation"))
    check("recovery.snapshot-no-raw-receiver-payload",lambda:expect(all("result" not in row and row["result_payload_included"] is False and row["result_reference"]["inbox_id"]==row["id"] and
        len(json.dumps(row["metadata"]))<512 for row in snapshot["cursor_and_instruction_records"]) and snapshot["record_projection"]=="bounded-metadata-with-retained-inbox-reference",
        "Recovery copied raw instruction/receiver payloads instead of bounded metadata references"))
    s.ok("outbox.enqueue",event(4020))
    hung=s.ok("fixture.hung",{"config":dict(S,consumer_id=CONSUMER,batch_size=1,lease_ms=100,poll_ms=10,retry_ms=0)})
    check("recovery.unresponsive-adapter-bounded",lambda:expect(hung["result"]["pending"]==1 and hung["elapsed_ms"]<3000,"Unresponsive adapter prevented bounded shutdown"))

    def crash_recover(number,after):
        # Each fault boundary owns a real bootstrapped consumer; unrelated expired work must not choose the killed effect.
        consumer=uid(number+10000)
        s.ok("outbox.consumer.register",dict(S,id=consumer,consumer_key="crash-boundary-"+str(number),critical=True,state="BUFFERING"))
        s.ok("fixture.bootstrap",dict(S,bootstrap_id=uid(number+20000),consumer_id=consumer,aggregate_types=["fixture"],limit=128))
        e=event(number);s.ok("fixture.selected",{"event":e,"consumer_ids":[consumer]})
        old=s.child;disconnected=False
        try:s.ok("fixture.crash",{"config":dict(S,consumer_id=consumer,batch_size=1,lease_ms=1000,poll_ms=10,retry_ms=0),"expected_event_id":e["id"],"after_receive":after})
        except Exception:disconnected=True
        old.wait(timeout=10);expect(disconnected and old.returncode==-signal.SIGKILL,"Fixture did not actually kill its dispatcher process")
        s.child=None
        expect(sql("SELECT count(*) FROM hyperfide.command_inbox WHERE operation='event.receive' AND idempotency_key="+q(e["id"])+" AND principal_scope="+q(consumer))==("1" if after else "0"),"Crash boundary did not match committed receiver state")
        s.start();sql("SELECT pg_sleep(1.1)")
        restarted=s.ok("fixture.dispatch",{"config":dict(S,consumer_id=consumer,batch_size=1,lease_ms=5000,poll_ms=10,retry_ms=0),"poll":True})
        expect(restarted["sends"]==1 and sql("SELECT state FROM hyperfide.event_deliveries WHERE event_id="+q(e["id"])+" AND consumer_id="+q(consumer))=="ACKNOWLEDGED" and
            sql("SELECT count(*) FROM hyperfide.command_inbox WHERE operation='event.receive' AND idempotency_key="+q(e["id"])+" AND principal_scope="+q(consumer))=="1","Crash recovery lost identity or duplicated receiver effect")
    sql("SELECT pg_sleep(0.2)")
    check("recovery.sigkill-before-receiver-commit",lambda:crash_recover(4030,False))
    check("recovery.sigkill-after-receiver-commit",lambda:crash_recover(4040,True))
    daemon_lifecycle(s)

def daemon_lifecycle(s):
    key=s.path/"dispatch-service.pem"
    subprocess.run(["openssl","genpkey","-algorithm","Ed25519","-out",str(key)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);key.chmod(0o600)
    public=subprocess.check_output(["openssl","pkey","-in",str(key),"-pubout","-outform","DER"],stderr=subprocess.DEVNULL)[-32:]
    service_id=str(uuid.uuid4())
    status,issued=s.invoke("identity.service.issue",{"credential_id":service_id,"actor_id":str(uuid.uuid4()),"role":"DISPATCH",
        "public_key_b64":base64.urlsafe_b64encode(public).decode().rstrip("="),
        "allowed_actions":["identity.describe","identity.principal.renew","outbox.claim","outbox.acknowledge","outbox.retry","fixture.worker-admit"],"ttl_seconds":300},component="14.1")
    check("recovery.daemon-real-service-identity",lambda:expect(status==200 and issued.get("ok") and issued["result"]["role"]=="DISPATCH","Actual operator service issuance failed"))
    with socket.socket() as sock:sock.bind(("127.0.0.1",0));port=sock.getsockname()[1]
    origin="https://localhost:"+str(port)
    identity_config=s.path/"dispatch-identity.json";value=json.loads(s.identity_config.read_text());value["origin"]=origin;identity_config.write_text(json.dumps(value));identity_config.chmod(0o600)
    consumer=uid(640)
    s.ok("outbox.consumer.register",dict(S,id=consumer,consumer_key="isolated-production-dispatch",critical=True,state="BUFFERING"))
    s.ok("fixture.bootstrap",dict(S,bootstrap_id=uid(641),consumer_id=consumer,aggregate_types=["fixture"],limit=128))
    config=s.path/"dispatch-worker.json"
    config.write_text(json.dumps(dict(S,credential_id=service_id,key_file=str(key),ca_file=str(s.ca),control_origin=s.origin,
        consumer_ids=[consumer],routes=[{"aggregate_type":"fixture","event_type":"fixture.changed","component":"fixture.events","action":"fixture.worker-admit","input_mode":"DELIVERY"}],
        poll_ms=20,retry_ms=50,lease_ms=2000,batch_size=2,request_timeout_ms=1000,credential_ttl_seconds=300,credential_renewal_ms=1000)));config.chmod(0o600)
    process=None;dispatches=[];control_processes=[]
    def start_dispatch():
        nonlocal process
        env=s.env.copy();env["HF_IDENTITY_CONFIG_FILE"]=str(identity_config);env["HF_EVENT_DISPATCH_CONFIG"]=str(config)
        process=subprocess.Popen(["node",str(s.runtime_root/"services/hyperfide/dist/dispatch.js"),"--policy",str(s.policy),"--spec-revision","fixture-identity-v1","--components",str(s.components),
            "--module-root",str(s.runtime_root/"services/hyperfide/dist"),"--mode","https","--host","127.0.0.1","--port",str(port),"--tls-cert",str(s.ca),"--tls-key",str(s.tlskey)],
            cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        descriptor=target()/"resource.json";record=json.loads(descriptor.read_text());record["dispatcher_process"]={"pid":process.pid,
            "start_time":Path("/proc/"+str(process.pid)+"/stat").read_text().split()[21],"boot_id":Path("/proc/sys/kernel/random/boot_id").read_text().strip()};descriptor.write_text(json.dumps(record)+"\n")
        dispatches.append(record["dispatcher_process"])
        deadline=time.monotonic()+15;lines=[]
        while time.monotonic()<deadline:
            ready,_,_=select.select([process.stderr],[],[],0.1)
            if ready:
                line=process.stderr.readline();lines.append(line)
                if '"event":"ready"' in line:return
            if process.poll() is not None:break
        raise AssertionError("Actual dispatch daemon did not become ready: "+"".join(lines)[:1500])
    def stop_dispatch(kill=False):
        nonlocal process
        if process:
            if kill:process.kill()
            else:process.send_signal(signal.SIGTERM)
            out,err=process.communicate(timeout=8)
            expect(process.returncode==(-signal.SIGKILL if kill else 0),"Dispatch termination failed: "+err[:1000]);process=None
    def wait_for(predicate,message):
        deadline=time.monotonic()+12
        while time.monotonic()<deadline:
            if predicate():return
            time.sleep(.05)
        raise AssertionError(message)
    def describe_dispatch():
        old_origin,old_port=s.origin,s.port
        try:
            s.origin,s.port=origin,port
            status,response=s.invoke("recovery.describe",{},component="6.4")
            expect(status==200 and response.get("ok"),"Actual dispatch worker description failed")
            return response["result"]["worker"]
        finally:s.origin,s.port=old_origin,old_port
    unknown=event(4050,event_type="fixture.no-handler");work=event(4060)
    s.ok("fixture.selected",{"event":unknown,"consumer_ids":[consumer]});s.ok("fixture.selected",{"event":work,"consumer_ids":[consumer]})
    try:
        start_dispatch()
        check("recovery.daemon-separate-process-stdin-eof",lambda:expect(process.pid!=s.child.pid and process.poll() is None,"Worker did not survive DEVNULL stdin as a separate service"))
        old=s.child;control_processes.append({k:v for k,v in json.loads((target()/"resource.json").read_text()).items() if k in ("pid","start_time","boot_id")})
        wait_for(lambda:sql("SELECT count(*) FROM hyperfide.command_inbox WHERE operation='event.receive' AND idempotency_key="+q(work["id"]))=="1","Daemon never reached actual committed receiver")
        old.wait(timeout=10);s.child=None
        marker=json.loads((s.path/"worker-after-commit-crash").read_text())
        expect(marker["event_id"]==work["id"] and marker["status"]=="APPLIED" and marker["inbox_id"],"Unexpected receiver crash boundary: "+json.dumps(marker))
        check("recovery.daemon-after-commit-response-loss",lambda:expect(old.returncode==-signal.SIGKILL and sql("SELECT state FROM hyperfide.event_deliveries WHERE event_id="+q(work["id"]))!="ACKNOWLEDGED","Lost network response was falsely acknowledged"))
        stop_dispatch(True)
        s.start();control_processes.append({k:v for k,v in json.loads((target()/"resource.json").read_text()).items() if k in ("pid","start_time","boot_id")});start_dispatch()
        wait_for(lambda:sql("SELECT state FROM hyperfide.event_deliveries WHERE event_id="+q(work["id"]))=="ACKNOWLEDGED","Restarted daemon did not reconcile the original obligation")
        check("recovery.daemon-restart-stable-effect",lambda:expect(sql("SELECT count(*) FROM hyperfide.command_inbox WHERE operation='event.receive' AND idempotency_key="+q(work["id"]))=="1" and
            int(sql("SELECT attempt_count FROM hyperfide.event_deliveries WHERE event_id="+q(work["id"])))>=2,"Daemon restart duplicated effect or replaced delivery identity"))
        check("recovery.daemon-missing-handler-held",lambda:expect(sql("SELECT state FROM hyperfide.event_deliveries WHERE event_id="+q(unknown["id"]))!="ACKNOWLEDGED" and
            sql("SELECT count(*) FROM hyperfide.command_inbox WHERE operation='event.receive' AND idempotency_key="+q(unknown["id"]))=="0","Unknown event route was acknowledged without its handler"))
        check("recovery.daemon-real-runtime-status",lambda:expect(describe_dispatch()["transport"]=="signed-HTTPS" and describe_dispatch()["acknowledged"]>=1,"Actual worker counters did not reflect committed ACK"))
        check("recovery.daemon-renews-service-not-compute",lambda:expect(int(sql("SELECT credential_version FROM hyperfide.identity_principals WHERE credential_id="+q(service_id)))>=2 and
            sql("SELECT count(*) FROM hyperfide.identity_operation_results WHERE scope_id="+q(service_id)+" AND operation='identity.principal.renew' AND response->'compute_lease_renewed'='false'::jsonb")!="0","Service identity renewal did not use actual guarded noncompute path"))
        stop_dispatch()
        held=event(4070);s.ok("fixture.selected",{"event":held,"consumer_ids":[consumer]})
        actual_config=json.loads(config.read_text());wrong=dict(actual_config,credential_id=s.ids["operator"],key_file=str(s.keys["operator"]["path"]))
        config.write_text(json.dumps(wrong));start_dispatch()
        wait_for(lambda:describe_dispatch()["state"]=="RETRYING","Wrong-role worker did not refuse its identity")
        check("recovery.daemon-no-operator-fallback",lambda:expect(sql("SELECT attempt_count FROM hyperfide.event_deliveries WHERE event_id="+q(held["id"]))=="0","Worker used OPERATOR identity as fallback"))
        stop_dispatch();config.write_text(json.dumps(actual_config))
        version=sql("SELECT credential_version FROM hyperfide.identity_principals WHERE credential_id="+q(service_id))
        status,response=s.invoke("identity.principal.revoke",{"credential_id":service_id,"expected_version":version},component="14.1")
        expect(status==200 and response.get("ok"),"Actual service identity revocation failed")
        start_dispatch();wait_for(lambda:describe_dispatch()["state"]=="RETRYING","Revoked worker did not stop admission")
        check("recovery.daemon-revocation-holds-work",lambda:expect(sql("SELECT attempt_count FROM hyperfide.event_deliveries WHERE event_id="+q(held["id"]))=="0" and
            sql("SELECT count(*) FROM hyperfide.command_inbox WHERE operation='event.receive' AND idempotency_key="+q(held["id"]))=="0","Revoked service delivered or acknowledged work"))
        (target()/"daemon-observations.json").write_text(json.dumps({"scope":"separate-control-dispatch-components","transport":"actual-signed-HTTPS","stdin":"DEVNULL",
            "service_credential_id":service_id,"control_processes":control_processes,"dispatch_processes":dispatches,"source_event_id":work["id"],
            "receiver_receipts":json.loads(sql("SELECT coalesce(json_agg(json_build_object('inbox_id',id,'state',state,'request_digest',request_digest)),'[]'::json)::text FROM hyperfide.command_inbox WHERE operation='event.receive' AND idempotency_key="+q(work["id"]))),
            "delivery":json.loads(sql("SELECT row_to_json(d)::text FROM (SELECT event_id,consumer_id,state,attempt_count,acknowledged_at FROM hyperfide.event_deliveries WHERE event_id="+q(work["id"])+") d")),
            "unregistered_event_id":unknown["id"],"revoked_identity_event_id":held["id"],"task_completion_authority":False,"native_execution":"NOT_CLAIMED"},sort_keys=True)+"\n")
    finally:stop_dispatch()

def main(task="6.1"):
    global TASK,ACTIVE,S
    TASK=task
    if "--cleanup" in sys.argv:return cleanup()
    service=Service();ACTIVE=service;S={"organisation_id":service.ids["organisation"],"run_id":service.ids["run"]}
    try:
        if task!="6.3":service.ok("outbox.consumer.register",dict(S,id=CONSUMER,consumer_key="fixture-dispatch",critical=True,state="ACTIVE"))
        {"6.1":suite61,"6.2":suite62,"6.3":suite63,"6.4":suite64}[task](service)
        observations={"scope":"task-component","task":task,"assertion_ids":IDS,"failed_ids":FAILED,"service_operations":OBS,
            "postgresql_version":sql("SHOW server_version;"),"transport":"actual-signed-HTTPS","full_case_status":"INCOMPLETE"}
        (target()/"observations.json").write_text(json.dumps(observations,sort_keys=True)+"\n")
    finally:
        service.close();ACTIVE=None
    return 1 if FAILED else 0
if __name__=="__main__":sys.exit(main())
