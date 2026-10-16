#!/usr/bin/env python3
"""Task23.2: real authenticated profile/resource accounting, not provider capacity acceptance."""
import importlib.util,json,os,sys,time
from pathlib import Path
spec=importlib.util.spec_from_file_location("observability_fixture",Path(__file__).with_name("23_1.py"))
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
DIMENSIONS=["SANDBOX","AGENT_SESSION","CPU_MILLIS","MEMORY_BYTES","DISK_BYTES","BUILD","LINK","TEST","EXCLUSIVE_SERVICE","INDEX","MODEL_REQUEST","MODEL_TOKEN","PROVIDER_API"]
def main():
 h.set_task("23.2")
 if "--cleanup" in sys.argv:return h.cleanup()
 try:
  with h.Fixture("23.2",["23.2"]) as f:
   def profile(n,density):
    return {"id":h.uid(n),"profile_key":"density-"+str(density),"revision":"1","declared_agents_per_sandbox":density,"dimensions":[{"dimension":d,"configured_limit":str(1000 if d=="CPU_MILLIS" else 100),"declared_reservation":str(100*density if d=="CPU_MILLIS" else 1),**({"window_ms":60000} if d in ["MODEL_REQUEST","MODEL_TOKEN","PROVIDER_API"] else {})} for d in DIMENSIONS]}
   profiles=[profile(200+i,d) for i,d in enumerate([2,4,8])]
   h.check("observability.resources.dimensions",lambda:h.expect(f.ok("23.2","fleet.resources.describe")["dimensions"]==DIMENSIONS))
   for i,p in enumerate(profiles):
    h.check("observability.resources.profile-density-"+str(p["declared_agents_per_sandbox"]),lambda p=p:h.expect(f.ok("23.2","fleet.resources.profile.put",p)["replayed"] is False))
   h.check("observability.resources.profile-replay",lambda:h.expect(f.ok("23.2","fleet.resources.profile.put",profiles[0])["replayed"]))
   h.check("observability.resources.profile-conflict",lambda:f.reject("23.2","fleet.resources.profile.put",dict(profiles[0],declared_agents_per_sandbox=3),"OBSERVABILITY_CONFLICT"))
   h.check("observability.resources.unknown-dimension",lambda:f.reject("23.2","fleet.resources.profile.put",dict(profile(210,1),dimensions=[{"dimension":"ANY_AGENT","configured_limit":"1","declared_reservation":"1"}]),"OBSERVABILITY_INPUT_INVALID"))
   h.check("observability.resources.duplicate-dimension",lambda:f.reject("23.2","fleet.resources.profile.put",dict(profile(211,1),dimensions=[profiles[0]["dimensions"][0]]*2),"OBSERVABILITY_INPUT_INVALID"))
   h.check("observability.resources.reservation-over-limit",lambda:f.reject("23.2","fleet.resources.profile.put",dict(profile(212,1),dimensions=[{"dimension":"CPU_MILLIS","configured_limit":"1","declared_reservation":"2"}]),"OBSERVABILITY_INPUT_INVALID"))
   h.check("observability.resources.numeric-quantity-denied",lambda:f.reject("23.2","fleet.resources.profile.put",dict(profile(213,1),dimensions=[{"dimension":"CPU_MILLIS","configured_limit":1,"declared_reservation":"0"}]),"OBSERVABILITY_INPUT_INVALID"))
   h.check("observability.resources.unobserved-unknown",lambda:h.expect(f.ok("23.2","fleet.resources.snapshot")["measurements"]==[]))
   now=time.strftime("%Y-%m-%dT%H:%M:%S.000Z",time.gmtime())
   sample={"profile_id":profiles[0]["id"],"subject_id":h.SANDBOX,"dimension":"CPU_MILLIS","value":"1001","observed_at":now,"producer_sequence":"1","origin":"REPLAY","source_digest":h.DIGEST,"source_artifact_id":h.ARTIFACT}
   h.check("observability.resources.record-saturation",lambda:h.expect(f.ok("23.2","fleet.resources.observe",{"samples":[sample]})["recorded"]==1))
   h.check("observability.resources.simulated-origin-visible",lambda:h.expect(f.ok("23.2","fleet.resources.snapshot")["measurements"][0]["simulation"] is True))
   h.check("observability.resources.saturation-distinct",lambda:h.expect(f.ok("23.2","fleet.resources.snapshot")["measurements"][0]["utilisation_status"]=="SATURATED"))
   h.check("observability.resources.report-not-verification",lambda:h.expect(f.ok("23.2","fleet.resources.snapshot")["measurements"][0]["independently_verified"] is False))
   h.check("observability.resources.sample-replay",lambda:h.expect(f.ok("23.2","fleet.resources.observe",{"samples":[sample]})["replayed"]==1))
   h.check("observability.resources.sample-conflict",lambda:f.reject("23.2","fleet.resources.observe",{"samples":[dict(sample,value="999")]},"OBSERVABILITY_CONFLICT"))
   h.check("observability.resources.duplicate-batch-key",lambda:f.reject("23.2","fleet.resources.observe",{"samples":[sample,sample]},"OBSERVABILITY_INPUT_INVALID"))
   h.check("observability.resources.batch-bound",lambda:f.reject("23.2","fleet.resources.observe",{"samples":[sample]*101},"OBSERVABILITY_INPUT_INVALID"))
   h.check("observability.resources.absent-artifact-denied",lambda:f.reject("23.2","fleet.resources.observe",{"samples":[dict(sample,producer_sequence="2",source_artifact_id=h.uid(999))]},"OBSERVABILITY_EVIDENCE_UNAVAILABLE"))
   h.check("observability.resources.untrusted-producer-denied",lambda:f.reject("23.2","fleet.resources.observe",{"samples":[dict(sample,producer_sequence="2")]},"OBSERVABILITY_PRODUCER_FORBIDDEN",role="VERIFIER"))
   def stale():
    old=dict(sample,producer_sequence="2",observed_at=time.strftime("%Y-%m-%dT%H:%M:%S.000Z",time.gmtime(time.time()-60)))
    f.ok("23.2","fleet.resources.observe",{"samples":[old]})
    h.expect(f.ok("23.2","fleet.resources.snapshot")["measurements"][0]["utilisation_status"]=="STALE")
   h.check("observability.resources.stale-not-saturation",stale)
   h.check("observability.resources.old-sequence-denied",lambda:f.reject("23.2","fleet.resources.observe",{"samples":[sample]},"OBSERVABILITY_STALE_OBSERVATION"))
   def distinct():
    r=f.ok("23.2","fleet.resources.snapshot");h.expect(r["uniform_agent_capacity_assumed"] is False and r["prepared_spares_are_running_sessions"] is False and sum(int(x["count"]) for x in r["registered_sessions"])==2 and len(r["profiles"])==3)
   h.check("observability.resources.profile-density-not-session-count",distinct)
   h.check("observability.resources.observation-not-admission",lambda:h.expect(f.ok("23.2","fleet.resources.snapshot")["admission_authority"] is False))
   h.check("observability.resources.cross-run-denied",lambda:f.reject("23.2","fleet.resources.snapshot",{},run=h.RUN2))
  return h.finish()
 except Exception as e:print(json.dumps({"type":"fatal","error":type(e).__name__+": "+str(e)}),flush=True);return 1
if __name__=="__main__":raise SystemExit(main())
