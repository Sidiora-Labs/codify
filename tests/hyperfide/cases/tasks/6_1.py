#!/usr/bin/env python3
"""Real PostgreSQL, signed HTTPS and native instruction boundary tests."""
from __future__ import annotations
import concurrent.futures,base64,hashlib,importlib.util,json,os,re,shutil,signal,subprocess,sys,tempfile,time,uuid
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
    for kind in ["database","process","directory"]:
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
        directory=record.get("directory")
        if directory:
            p=Path(directory)
            expect(p.parent==Path(tempfile.gettempdir()) and p.name.startswith("hyperfide-identity-"),"Unexpected fixture cleanup path")
            shutil.rmtree(p,ignore_errors=True)
        observed=[absent,not pid or not Path("/proc/"+str(pid)).exists(),not directory or not Path(directory).exists()]
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
import {enqueue,lockRun,authorizedRun} from './events/outbox.js';
import {receive,bootstrapConsumer} from './events/inbox.js';
import {DurableDispatcher,recoverySnapshot} from './events/recovery.js';
export function createComponent(ctx) {
 const g=ctx.dependencies.require('4.2','storage.transactions.v1',v=>typeof v?.withPrimaryTransaction==='function');
 const auth=(context,input,op)=>authorizedRun(g,context,input,['OPERATOR'],op);
 return {apiVersion:1,actions:{
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
 }};
}
"""
class Service(identity.IdentityFixture):
    def __init__(self):
        super().__init__(extra_components=("6.1","6.2","6.3","6.4"),extra_setup=self.prepare,database=database())
    def prepare(self,f):
        self.runtime_root=self.path/"runtime";module=self.runtime_root/"services/hyperfide/dist"
        module.parent.mkdir(parents=True)
        shutil.copytree(ROOT/"services/hyperfide/dist",module)
        shutil.copytree(ROOT/"services/hyperfide/migrations",module.parent/"migrations")
        (module.parent/"node_modules").symlink_to(ROOT/"services/hyperfide/node_modules",target_is_directory=True)
        self.module_equal=all(hashlib.sha256(p.read_bytes()).digest()==hashlib.sha256((module/p.relative_to(ROOT/"services/hyperfide/dist")).read_bytes()).digest()
            for p in (ROOT/"services/hyperfide/dist").rglob("*") if p.is_file())
        (module/"fixture.js").write_text(FIXTURE)
        (module/"package.json").write_text('{"type":"module"}')
        actions=["fixture.atomic","fixture.selected","fixture.effect","fixture.snapshot","fixture.hung","fixture.dispatch","fixture.bootstrap"]
        fragment={"schema_version":1,"id":"fixture.events","task":"6.1","roles":["control"],"module":"fixture.js","entry":"createComponent",
            "api_version":1,"actions":actions,"requires":["4.2","6.1","6.2","6.4"]}
        (self.components/"fixture.json").write_text(json.dumps(fragment))
        self.actions+=actions
        for path in [self.policy,self.identity_config]:
            value=json.loads(path.read_text())
            if path==self.policy:value["allowed_actions"]=self.actions
            else:
                for record in value["principals"]:record["allowed_actions"]=self.actions
            path.write_text(json.dumps(value))
        for role in ("CONTROL","PROVISIONER","DISPATCH"):
            for prefix in ("HF_PG_","HYPERFIDE_PG_"):self.env[prefix+role+"_PRIMARY_DATABASE_URL"]=self.url
    def start(self):
        original=identity.ROOT
        try:
            identity.ROOT=self.runtime_root
            super().start()
        finally:identity.ROOT=original
        pid=self.child.pid
        record={"database":self.database,"directory":str(self.path),"pid":pid,
            "start_time":Path("/proc/"+str(pid)+"/stat").read_text().split()[21],
            "boot_id":Path("/proc/sys/kernel/random/boot_id").read_text().strip()}
        (target()/"resource.json").write_text(json.dumps(record)+"\n")
    def request_action(self,action,value,runner=None):
        component={"outbox":"6.1","inbox":"6.2","instructions":"6.3","recovery":"6.4","fixture":"fixture.events"}[action.split(".")[0]]
        value={**S,**value} if action.startswith("fixture.") else value
        use_runner=action in ("instructions.handoff","instructions.ack") if runner is None else runner
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
            "allowed_actions":["identity.describe","instructions.handoff","instructions.ack"],"ttl_seconds":300})
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
def suite63(s):
    seed_native_attempt(s);s.enroll_runner();start=command(3001,"START")
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
    check("instructions.padded-steer-refused",lambda:s.reject("instructions.issue",dict(command(3010,"STEER"),body=dict(command(3010,"STEER")["body"],frame_b64="YQ==")),"INSTRUCTION_INPUT_INVALID"))
    def accept(c):return s.ok("instructions.accept",dict(S,event_id=c["id"],consumer_id=CONSUMER))
    check("instructions.start-durably-accepted",lambda:expect(accept(start)["result"]["execution"]=="PENDING_NATIVE_CONNECTOR","Central admission invented a process"))
    packet=s.ok("instructions.handoff",dict(S,event_id=start["id"],consumer_id=CONSUMER))
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
    check("instructions.native-ack-replay",lambda:expect(s.ok("instructions.ack",report)["replayed"],"Lost native ACK duplicated receipt"))
    check("instructions.native-ack-conflict",lambda:s.reject("instructions.ack",dict(report,state="UNCERTAIN"),"INSTRUCTION_ACK_CONFLICT"))
    check("instructions.native-ack-target-refused",lambda:s.reject("instructions.ack",dict(report,sandbox_id=uid(999)),"INSTRUCTION_ACK_INVALID"))
    process={"os_boot_id":uid(801),"pid":42,"start_time":"1000","pgid":42}
    check("instructions.native-executing-observation",lambda:expect(s.ok("instructions.ack",dict(report,ledger_version="2",state="EXECUTING",observed_process=process))["task_qualified"] is False,"Observed process qualified task"))
    check("instructions.native-state-regression-refused",lambda:s.reject("instructions.ack",dict(report,ledger_version="3"),"INSTRUCTION_ACK_REGRESSION"))
    check("instructions.native-process-rebinding-refused",lambda:s.reject("instructions.ack",dict(report,ledger_version="3",state="EXECUTING",observed_process=dict(process,pid=43)),"INSTRUCTION_ACK_CONFLICT"))
    steer=command(3020,"STEER");cancel=command(3030,"CANCEL")
    s.ok("instructions.issue",steer);s.ok("instructions.issue",cancel)
    check("instructions.cancel-fences-future-input",lambda:s.reject("instructions.issue",command(3040,"STEER"),"INSTRUCTION_CANCELLED"))
    check("instructions.typed-replay",lambda:expect([r["status"] for r in s.ok("instructions.replay",dict(S,attempt_id=uid(30),consumer_id=CONSUMER,limit=64))["results"]]==["APPLIED","APPLIED"],"Typed replay skipped generation-bound handler"))
    check("instructions.accepted-start-cannot-respawn",lambda:expect(accept(start)["status"]=="DUPLICATE" and s.ok("instructions.handoff",dict(S,event_id=start["id"],consumer_id=CONSUMER))["accepted"] is False,"Native start escaped cancellation"))
    check("instructions.late-steer-suppressed",lambda:expect(accept(steer)["result"]["disposition"]=="SUPPRESSED_BY_CANCELLATION","Late steering escaped cancellation"))
    check("instructions.cancel-durably-accepted",lambda:expect(accept(cancel)["result"]["execution"]=="PENDING_NATIVE_CONNECTOR","Receipt invented external cancellation"))
    check("instructions.lost-ack-deduplicated",lambda:expect(accept(cancel)["status"]=="DUPLICATE","Cancellation appended twice"))
    check("instructions.spool-bounded-identities",lambda:expect(sql("SELECT count(*) FROM hyperfide.command_inbox WHERE operation='instruction.spool';")=="3","Instruction appended more than once"))
    check("instructions.generic-inbox-bypass-refused",lambda:s.reject("inbox.receive",dict(S,event_id=cancel["id"],consumer_id=CONSUMER),"INBOX_TRUSTED_HANDLER_REQUIRED"))
    sql("UPDATE hyperfide.compute_leases SET expires_at=clock_timestamp()-interval '1 second',state_version=state_version+1 WHERE id="+q(uid(40))+";")
    check("instructions.expired-compute-can-report-terminal",lambda:expect(s.ok("instructions.ack",dict(report,ledger_version="3",state="TERMINAL",observed_process=process))["authority"]=="NONE","Expired worker observation was lost or gained authority"))
    check("instructions.expired-cancel-has-zero-budget",lambda:expect(s.ok("instructions.handoff",dict(S,event_id=cancel["id"],consumer_id=CONSUMER))["remaining_lease_ms"]==0,"Cleanup granted compute budget"))
    sql("UPDATE hyperfide.sandboxes SET boot_generation=2,state_version=state_version+1 WHERE id="+q(s.ids["sandbox"])+";")
    check("instructions.stale-native-boot-refused",lambda:s.reject("instructions.handoff",dict(S,event_id=cancel["id"],consumer_id=CONSUMER)))
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
    s.ok("outbox.enqueue",event(4020))
    hung=s.ok("fixture.hung",{"config":dict(S,consumer_id=CONSUMER,batch_size=1,lease_ms=100,poll_ms=10,retry_ms=0)})
    check("recovery.unresponsive-adapter-bounded",lambda:expect(hung["result"]["pending"]==1 and hung["elapsed_ms"]<3000,"Unresponsive adapter prevented bounded shutdown"))

def main(task="6.1"):
    global TASK,ACTIVE,S
    TASK=task
    if "--cleanup" in sys.argv:return cleanup()
    service=Service();ACTIVE=service;S={"organisation_id":service.ids["organisation"],"run_id":service.ids["run"]}
    try:
        service.ok("outbox.consumer.register",dict(S,id=CONSUMER,consumer_key="fixture-dispatch",critical=True,state="ACTIVE"))
        {"6.1":suite61,"6.2":suite62,"6.3":suite63,"6.4":suite64}[task](service)
        observations={"scope":"task-component","task":task,"assertion_ids":IDS,"failed_ids":FAILED,"service_operations":OBS,
            "postgresql_version":sql("SHOW server_version;"),"transport":"actual-signed-HTTPS","full_case_status":"INCOMPLETE"}
        (target()/"observations.json").write_text(json.dumps(observations,sort_keys=True)+"\n")
    finally:
        service.close();ACTIVE=None
    return 1 if FAILED else 0
if __name__=="__main__":sys.exit(main())
