#!/usr/bin/env python3
"""Actual signed-HTTPS/PostgreSQL behavioural-contract component assertions."""
from pathlib import Path
import copy,importlib.util,json,sys,tempfile
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location("review_fixture",ROOT/"tests/hyperfide/cases/tasks/17_1.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
IDS=["contract.publish.all-behaviour-facets","contract.publish.exact-replay","contract.publish.immutable-revision",
"contract.impact.units-with-unchanged-signature","contract.impact.cross-repository-consumers","contract.impact.missing-graph-explicit",
"contract.impact.unknown-authentication","contract.impact.unrun-not-proof","contract.source.cross-run-refused",
"contract.source.tree-refused","contract.coverage.no-proof-no-completion","contract.api.caller-outcome-refused"]
IDS+=["contract.impact.operational-invariants","contract.facets.missing-operational-refused"]
def main():
 with tempfile.TemporaryDirectory(prefix="hf-contract-") as folder:
  f=m.Fixture("17.2",Path(folder),["17.1","17.2"])
  try:
   f.configure();f.discover();identity=f.identity
   consumer=m.xid(0x400);identity.sql("INSERT INTO hyperfide.repositories(organisation_id,project_id,id,name,url) VALUES($1,$2,$3,'consumer','https://example.invalid/consumer.git')",[m.ORG,identity.ids["project"],consumer])
   identity.sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES($1,$2,$3)",[m.ORG,consumer,f.pinned])
   identity.sql("INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES($1,$2,$3,$4,'refs/heads/main')",[m.ORG,m.RUN,consumer,f.pinned])
   facets={key:{"status":"DEFINED","definition":{"behaviour":"fixed"}} for key in ["schema","signatures","errors","authentication","state","units","precision","ordering","idempotency","compatibility","operational_invariants"]}
   before={"producer":{"repository_id":m.REPOSITORY,"source_object_id":f.first,"symbol_ids":[]},"consumers":[{"repository_id":consumer,"source_object_id":f.pinned,"symbol_ids":[]}],"facets":facets,"scenario_templates":[{"template_id":"system.units","assertion_ids":["units.consumer-correct"]}]}
   def publish(body,revision="1",key="prices"):
    return f.ok("review.contract.publish",dict(m.SCOPE,owner_package_id=m.xid(0x300),contract_key=key,revision=revision,definition=body),component="17.2")
   results={}
   m.check(IDS[0],lambda:results.update(first=publish(before)))
   m.check(IDS[1],lambda:m.expect(publish(before)["contract_id"]==results["first"]["contract_id"],"contract replay changed identity"))
   changed=copy.deepcopy(before);changed["facets"]["units"]["definition"]={"behaviour":"dollars"}
   m.check(IDS[2],lambda:f.reject("review.contract.publish",dict(m.SCOPE,owner_package_id=m.xid(0x300),contract_key="prices",revision="1",definition=changed),"CONTRACT_REVISION_CONFLICT",component="17.2"))
   publish(changed,"2")
   impact=f.ok("review.contract.impact",dict(m.SCOPE,contract_key="prices",baseline_revision="1",candidate_revision="2"),component="17.2")
   m.check(IDS[3],lambda:m.expect(impact["changed_facets"]==["units"] and impact["unchanged_signatures"] is True,"unchanged signature concealed unit change"))
   m.check(IDS[4],lambda:m.expect(any(point["repository_id"]==consumer and point["source_object_id"]==f.pinned for point in impact["affected_consumers"]),"explicit cross-repo consumer lost"))
   m.check(IDS[5],lambda:m.expect(impact["analysis_complete"] is False and "GRAPH_SNAPSHOT_REQUIRED" in impact["limitations"],"missing graph presented complete"))
   unknown=copy.deepcopy(changed);unknown["facets"]["authentication"]={"status":"UNKNOWN","definition":None};publish(unknown,"3")
   observed=f.ok("review.contract.impact",dict(m.SCOPE,contract_key="prices",baseline_revision="2",candidate_revision="3"),component="17.2")
   m.check(IDS[6],lambda:m.expect("authentication" in observed["unknown_facets"] and observed["analysis_complete"] is False,"unknown auth semantics hidden"))
   operational=copy.deepcopy(unknown);operational["facets"]["operational_invariants"]["definition"]={"behaviour":"bounded-timeout-and-cleanup"}
   publish(operational,"4")
   ops=f.ok("review.contract.impact",dict(m.SCOPE,contract_key="prices",baseline_revision="3",candidate_revision="4"),component="17.2")
   m.check(IDS[12],lambda:m.expect(ops["changed_facets"]==["operational_invariants"] and ops["unchanged_signatures"] is True,"operational invariant change was hidden"))
   missing=copy.deepcopy(before);del missing["facets"]["operational_invariants"]
   m.check(IDS[13],lambda:f.reject("review.contract.publish",dict(m.SCOPE,owner_package_id=m.xid(0x300),contract_key="missing-operations",revision="1",definition=missing),"REVIEW_INPUT_INVALID",component="17.2"))

   m.check(IDS[7],lambda:m.expect(impact["qualification_status"]=="UNRUN" and impact["requires_behavioural_qualification"] is True,"declaration substituted for execution"))
   bad=copy.deepcopy(before);bad["producer"]["repository_id"]=m.xid(0xdead)
   m.check(IDS[8],lambda:f.reject("review.contract.publish",dict(m.SCOPE,owner_package_id=m.xid(0x300),contract_key="invalid",revision="1",definition=bad),"CONTRACT_SOURCE_INVALID",component="17.2"))
   tree="f"*40;identity.sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id,object_type) VALUES($1,$2,$3,'tree')",[m.ORG,m.REPOSITORY,tree]);bad=copy.deepcopy(before);bad["producer"]["source_object_id"]=tree
   m.check(IDS[9],lambda:f.reject("review.contract.publish",dict(m.SCOPE,owner_package_id=m.xid(0x300),contract_key="invalid",revision="1",definition=bad),"CONTRACT_SOURCE_INVALID",component="17.2"))
   coverage=f.ok("review.contract.coverage",dict(m.SCOPE,contract_ids=[results["first"]["contract_id"]],repository_id=m.REPOSITORY,source_object_id=f.first,candidate_digest=m.DIGEST,input_manifest_digest=m.DIGEST),component="17.2")
   m.check(IDS[10],lambda:m.expect(coverage["status"]!="COMPLETE" and coverage["proofs"]==[],"unexecuted contract admitted coverage"))
   m.check(IDS[11],lambda:f.reject("review.contract.publish",dict(m.SCOPE,owner_package_id=m.xid(0x300),contract_key="forged",revision="1",definition=before,passed=True),"REVIEW_INPUT_INVALID",component="17.2"))
  finally:f.identity.close();f.save(m.FAILED)
 return int(bool(m.FAILED))
if __name__=="__main__":raise SystemExit(m.cleanup("17.2") if "--cleanup" in sys.argv else main())
