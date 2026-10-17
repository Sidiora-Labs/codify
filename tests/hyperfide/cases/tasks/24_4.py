#!/usr/bin/env python3
from pathlib import Path
import importlib.util,sys
spec=importlib.util.spec_from_file_location("recovery_common",Path(__file__).with_name("24_1.py"));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def tests(f):
 m.check("recovery.drill.real-process",lambda:m.expect(f.ok("recovery.drill.describe",{})["targets"]=="PROPOSED_UNTIL_MEASURED"))
 for n,scenario in enumerate(["DATABASE","OBJECT","GIT","PROVIDER","AUTH","FULL_DISK","RESTORE"]):
  request={"scope":m.SCOPE,"operation_id":m.uid(50+n),"scenario":scenario,"proposed_rpo_ms":0,"proposed_rto_ms":300000}
  result=f.ok("recovery.drill.plan",request)
  m.check("recovery.drill.proposed-"+scenario.lower(),lambda result=result:m.expect(result["state"]=="PROPOSED" and result["qualified"] is False and result["measured_rto_ms"] is None))
 m.check("recovery.drill.no-invented-measurements",lambda:m.expect(m.sql("SELECT count(*) FROM hyperfide.recovery_drill_runs WHERE measured_rto_ms IS NOT NULL;")=="0"))
 request={"scope":m.SCOPE,"operation_id":m.uid(50),"scenario":"DATABASE","proposed_rpo_ms":0,"proposed_rto_ms":300000}
 inspected=f.ok("recovery.drill.inspect",{"scope":m.SCOPE,"operation_id":m.uid(50)})
 m.check("recovery.drill.primary-inspection",lambda:m.expect(inspected["source"]=="primary-transaction" and inspected["drill"]["state"]=="PROPOSED" and inspected["replay_disruptive_execution"] is False))
 m.check("recovery.drill.plan-replay",lambda:m.expect(f.ok("recovery.drill.plan",request)["state"]=="PROPOSED"))
 m.check("recovery.drill.plan-conflict",lambda:f.rejected("recovery.drill.plan",{**request,"proposed_rto_ms":1},"RECOVERY_IDEMPOTENCY_CONFLICT"))
 m.check("recovery.drill.unqualified-probe-refusal",lambda:f.rejected("recovery.drill.execute",{"scope":m.SCOPE,"operation_id":m.uid(50)},"RECOVERY_DEPENDENCY_UNAVAILABLE"))
 m.check("recovery.drill.reject-self-reported-proof",lambda:f.rejected("recovery.drill.execute",{"scope":m.SCOPE,"operation_id":m.uid(50),"recovered":True},"RECOVERY_INPUT_INVALID"))
 m.check("recovery.drill.reject-negative-target",lambda:f.rejected("recovery.drill.plan",{**request,"operation_id":m.uid(99),"proposed_rpo_ms":-1},"RECOVERY_INPUT_INVALID"))
 m.check("recovery.drill.stale-epoch",lambda:f.rejected("recovery.drill.plan",{**request,"operation_id":m.uid(98),"scope":{**m.SCOPE,"authority_epoch":m.uid(98)}},"RECOVERY_STALE_EPOCH"))
if __name__=="__main__":sys.exit(m.run("24.4",tests))
