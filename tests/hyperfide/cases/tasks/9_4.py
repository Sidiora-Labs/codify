#!/usr/bin/env python3
"""Task9.4 actual adapter code against explicitly simulated scoped provider APIs."""
import importlib,json,subprocess,sys,tempfile
from pathlib import Path
c=importlib.import_module("9_1")
IDS=[
 "railway.inventory.all-pages","railway.inventory.last-page","railway.inventory.partial-limit",
 "railway.inventory.no-absence-authority","railway.inventory.cursor-cycle","railway.inventory.duplicate-resource",
 "railway.inventory.scope-mismatch","railway.sessions.exceeds-sdk-page-cap","railway.sessions.partial-limit",
 "railway.sessions.unavailable-not-empty","railway.reconcile.unique-enrolled-candidate","railway.reconcile.marker-not-authority",
 "railway.reconcile.ambiguous-candidates","railway.reconcile.partial-inventory","railway.reconcile.no-blind-retry",
 "railway.reconcile.excludes-baseline","railway.adapter.actual-early-id","railway.adapter.early-id-before-observation",
 "railway.adapter.database-ambiguity-keeps-id","railway.adapter.lost-response-is-unknown","railway.adapter.no-implicit-create-retry",
 "railway.adapter.destroy-awaits-terminal","railway.adapter.destroy-confirmed","railway.adapter.expired-before-dispatch","railway.adapter.malformed-observation-keeps-id"
]
def main():
 if sys.argv[1:]==["--inventory"]:print(json.dumps(IDS[:19]+IDS[24:]+IDS[19:24]));return 0
 complete=False
 with tempfile.TemporaryDirectory(prefix="hyperfide-railway94-") as folder:
  fixture=c.Fixture(folder);service=c.Service(folder,fixture)
  try:
   inventory=lambda limit:c.result(service.call("9.4","railway.inventory.list",{"scope":c.SCOPE,"max_pages":limit}))
   fixture.state["pages"]=30
   data=inventory(100)
   c.check(IDS[0],lambda:c.expect(len(data["pages"])==30 and data["enumeration_complete"] is True,"complete pagination"))
   c.check(IDS[1],lambda:c.expect(data["pages"][-1]["items"][0]["native_sandbox_id"]=="sandbox-29","last page omitted"))
   c.check(IDS[2],lambda:c.expect(inventory(2)["enumeration_complete"] is False,"truncated inventory reported complete"))
   c.check(IDS[3],lambda:c.expect(data["absence_authorized"] is False and data["mode"]=="component-fixture",
      "declared provider inventory cannot grant absence authority"))
   fixture.state["mode"]="cursor-cycle"
   c.check(IDS[4],lambda:c.reject(service.call("9.4","railway.inventory.list",{"scope":c.SCOPE,"max_pages":100})))
   fixture.state["mode"]="duplicate-inventory"
   c.check(IDS[5],lambda:c.reject(service.call("9.4","railway.inventory.list",{"scope":c.SCOPE,"max_pages":100})))
   fixture.state["mode"]="wrong-placement"
   c.check(IDS[6],lambda:c.reject(service.call("9.4","railway.inventory.list",{"scope":c.SCOPE,"max_pages":100})))
   fixture.state.update(mode="normal",session_pages=30)
   sessions=lambda limit:c.result(service.call("9.4","railway.sessions.list",{"sandbox_id":"sandbox-1","max_pages":limit}))
   c.check(IDS[7],lambda:c.expect(len(sessions(100)["sessions"])==30 and sessions(100)["enumeration_complete"] is True,
      "SDK20-page limit leaked into adapter"))
   c.check(IDS[8],lambda:c.expect(sessions(2)["enumeration_complete"] is False,"session truncation reported complete"))
   fixture.state["mode"]="sessions-unavailable"
   c.check(IDS[9],lambda:c.expect(sessions(100)["available"] is False and sessions(100)["enumeration_complete"] is False,
      "unavailable sessions treated as empty complete"))
   request={"operation_id":"create-op","baseline_ids":["existing"],"inventory_complete":True,
            "candidates":[{"native_sandbox_id":"candidate-1","marker_operation_id":"create-op","authenticated_enrollment":True}]}
   reconcile=lambda p:c.result(service.call("9.4","railway.reconciliation.create",p))
   c.check(IDS[10],lambda:c.expect(reconcile(request)["decision"]=="ADOPT_CANDIDATE" and
      reconcile(request)["authority"]=="NONE","unique candidate data"))
   c.check(IDS[11],lambda:c.expect(reconcile(c.alter(request,["candidates",0,"authenticated_enrollment"],False))["decision"]==
      "QUARANTINE","plain operation marker granted adoption"))
   ambiguous=clone=request|{"candidates":request["candidates"]+[{"native_sandbox_id":"candidate-2",
      "marker_operation_id":"create-op","authenticated_enrollment":True}]}
   c.check(IDS[12],lambda:c.expect(reconcile(ambiguous)["decision"]=="QUARANTINE","ambiguous creation adopted"))
   c.check(IDS[13],lambda:c.expect(reconcile(request|{"inventory_complete":False})["decision"]=="QUARANTINE","partial adoption"))
   c.check(IDS[14],lambda:c.expect(all(reconcile(item)["retry_create"] is False for item in
      [request,ambiguous,request|{"candidates":[]}]),"blind create retry"))
   c.check(IDS[15],lambda:c.expect(reconcile(request|{"baseline_ids":["candidate-1"]})["decision"]=="NO_MATCH",
      "preexisting sandbox adopted"))
   driver=Path(folder)/"driver-input.json"
   params={"profile":c.profile(),"config":fixture.config,"base":c.base(),"create":c.operation("create","new-create"),
           "destroy":c.operation("destroy","destroy-op"),"spool":str(Path(folder)/"adapter-spool"),"fail_persist":False}
   js=r"""
import fs from 'node:fs';
import {RailwayClient} from './services/hyperfide/dist/providers/railway/preparation.js';
import {createRailwayAdapter} from './services/hyperfide/dist/providers/railway/reconciliation.js';
import {RailwaySessionSpool} from './services/hyperfide/dist/providers/railway/processes.js';
const data=JSON.parse(fs.readFileSync(process.argv[1])),events=[];
const client=new RailwayClient(data.config,{HF_RAILWAY_FIXTURE_TOKEN:'not-real'});
const adapter=createRailwayAdapter(client,{
 persistence:{
  assignedBootGeneration:async()=>{events.push('assigned-generation');return '17';},
  persistEarlyResource:async(op,id)=>{events.push('early-id:'+id);if(data.fail_persist)throw new Error('fixture DB commit response lost');
   return {native_sandbox_id:id,sandbox_boot_generation:'17'};},
  recordObservation:async(op,outcome)=>{events.push('observation:'+outcome.status);}
 },
 runtimeProfile:async()=>data.profile,preparedBase:async()=>data.base,
 credentials:async()=>({GIT_TOKEN:'fixture-worker-value'}),sessions:new RailwaySessionSpool(data.spool)
});
const op=data.operation||data.create;
const result=await adapter[op.kind](op);
process.stdout.write(JSON.stringify({outcome:result,events}));
"""
   def adapter(operation=None,fail=False):
    params["operation"]=operation or params["create"];params["fail_persist"]=fail
    driver.write_text(json.dumps(params))
    run=subprocess.run(["node","--input-type=module","-e",js,str(driver)],cwd=c.ROOT,capture_output=True,text=True,timeout=30)
    c.expect(run.returncode==0,run.stderr)
    return json.loads(run.stdout)
   fixture.state["mode"]="normal"
   good=adapter()
   c.check(IDS[16],lambda:c.expect(good["outcome"]["status"]=="SUCCEEDED" and good["outcome"]["resource"]==
      {"native_sandbox_id":"sandbox-1","sandbox_boot_generation":"17"},"database assigned generation"))
   c.check(IDS[17],lambda:c.expect(good["events"]==["assigned-generation","early-id:sandbox-1","observation:SUCCEEDED"],
      good["events"]))
   ambiguous_db=adapter(fail=True)
   c.check(IDS[18],lambda:c.expect(ambiguous_db["outcome"]["status"]=="UNKNOWN" and
      ambiguous_db["outcome"]["resource"]=={"native_sandbox_id":"sandbox-1","sandbox_boot_generation":"17"} and
      ambiguous_db["outcome"]["retry"]=="AFTER_RECONCILIATION","early ID lost on DB uncertainty"))
   fixture.state["mode"]="create-wrong-region"
   malformed=adapter()
   c.check(IDS[24],lambda:c.expect(malformed["outcome"]["status"]=="UNKNOWN" and
      malformed["outcome"]["resource"]=={"native_sandbox_id":"sandbox-1","sandbox_boot_generation":"17"} and
      malformed["events"]==["assigned-generation","early-id:sandbox-1","observation:UNKNOWN"],
      "malformed returned placement lost the submitted resource ID"))
   fixture.state["mode"]="lost-create-response";before=fixture.state.get("creates",0)
   lost=adapter()
   c.check(IDS[19],lambda:c.expect(lost["outcome"]["status"]=="UNKNOWN" and lost["outcome"]["acceptance"]=="UNKNOWN" and
      lost["outcome"]["resource"] is None,"lost response became rejection/success"))
   c.check(IDS[20],lambda:c.expect(fixture.state["creates"]==before+1,"adapter retried ambiguous create"))
   fixture.state["mode"]="normal"
   pending=adapter(params["destroy"])
   c.check(IDS[21],lambda:c.expect(pending["outcome"]["status"]=="UNKNOWN","destroy request freed allocation before observation"))
   fixture.state["mode"]="destroyed"
   deleted=adapter(params["destroy"])
   c.check(IDS[22],lambda:c.expect(deleted["outcome"]["status"]=="SUCCEEDED" and deleted["outcome"]["result"]==
      {"deletion":"CONFIRMED"},"terminal deletion unconfirmed"))
   expired=c.alter(params["create"],["deadline_at"],"2020-01-01T00:00:00.000Z")
   expired["identity"]["payload_digest"]=c.digest({k:expired[k] for k in
      ["kind","scope","resource","preparation_digest","deadline_at","parameters"]})
   before=len(fixture.requests);denied=adapter(expired)
   c.check(IDS[23],lambda:c.expect(denied["outcome"]["status"]=="FAILED" and denied["outcome"]["acceptance"]==
      "CONFIRMED_REJECTED" and len(fixture.requests)==before,"expired dispatch reached provider"))
   service.close();fixture.close();complete=True
  finally:
   if service.process.poll() is None:service.process.kill();service.process.wait()
   if not complete:fixture.close()
   print(json.dumps({"type":"cleanup","resources":[],"complete":complete}),flush=True)
 return 1 if c.FAILED or not complete else 0
if __name__=="__main__":sys.exit(main())
