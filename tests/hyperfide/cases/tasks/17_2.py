#!/usr/bin/env python3
"""Actual signed-HTTPS/PostgreSQL behavioural-contract component assertions."""
from pathlib import Path
import copy,hashlib,importlib.util,json,os,sys,tempfile,uuid
# Fixture commits must not detach git auto-maintenance: orphans outlive the probe and fail owned-process cleanup.
for number,(key,value) in enumerate([("gc.auto","0"),("maintenance.auto","false")]):os.environ["GIT_CONFIG_KEY_%d"%number]=key;os.environ["GIT_CONFIG_VALUE_%d"%number]=value
os.environ["GIT_CONFIG_COUNT"]="2"
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location("review_fixture",ROOT/"tests/hyperfide/cases/tasks/17_1.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
IDS=["contract.publish.all-behaviour-facets","contract.publish.exact-replay","contract.publish.immutable-revision",
"contract.impact.units-with-unchanged-signature","contract.impact.cross-repository-consumers","contract.impact.missing-graph-explicit",
"contract.impact.unknown-authentication","contract.impact.unrun-not-proof","contract.source.cross-run-refused",
"contract.source.tree-refused","contract.coverage.no-proof-no-completion","contract.api.caller-outcome-refused"]
IDS+=["contract.impact.operational-invariants","contract.facets.missing-operational-refused"]
IDS+=["contract.impact.stale-price-unchanged-signature","contract.impact.error-order-unchanged-signature","contract.impact.idempotency-unchanged-signature",
"contract.reproductions.cross-component","contract.reproductions.missing-template-explicit","contract.impact.unchanged-consumer-included",
"contract.graph.callers-become-consumers","contract.graph.unknown-edges-incomplete","contract.graph.producer-source-unbound","contract.graph.snapshot-unavailable-explicit"]
def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"))
def seed_graph(f,tag,sources,symbols,edges,unresolved=False):
 """Seed one PUBLISHED exact graph snapshot (7.x schema) through operator fixture SQL; returns manifest and symbol ids."""
 sql=f.identity.sql;org,run=m.ORG,m.RUN;build=str(uuid.uuid4());manifest_id=str(uuid.uuid4());digest=lambda text:"sha256:"+hashlib.sha256(text.encode()).hexdigest()
 sql("INSERT INTO hyperfide.graph_builds(organisation_id,run_id,id,input_digest,source_manifest_digest,parser_digest,schema_digest,config_digest,state) VALUES($1,$2,$3,$4,$4,$4,$4,$4,'PUBLISHED')",[org,run,build,digest("build:"+tag)])
 files={};ids={}
 for repository,commit in sources:
  identity={"organisation_id":org,"run_id":run,"repository_id":repository,"commit":commit,"source_kind":"COMMIT","overlay_digest":None,"generation":"1"}
  body={"complete":True,"coverage":{"files":1},"counts":{"files":1},"identity":identity,"tag":tag};text=canonical(body);artifact=str(uuid.uuid4())
  sql("INSERT INTO hyperfide.artifacts(organisation_id,run_id,id,digest,size_bytes,storage_backend,storage_key,status,completed_at) VALUES($1,$2,$3,$4,$5,'fixture',$6,'COMPLETE',clock_timestamp())",[org,run,artifact,digest(text),len(text.encode()),"graph/"+tag+"/"+repository])
  sql("INSERT INTO hyperfide.graph_bundle_inputs(organisation_id,run_id,graph_id,bundle_digest,identity,manifest,manifest_text,artifact_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[org,run,build,digest(text),canonical(identity),text,text,artifact])
  blob=str(uuid.uuid4());files[repository]=str(uuid.uuid4())
  sql("INSERT INTO hyperfide.parse_blobs(organisation_id,run_id,id,content_digest,parser_digest,language,parser_version,facts_artifact_id) VALUES($1,$2,$3,$4,$4,'text','fixture-1',$5)",[org,run,blob,digest(text),artifact])
  sql("INSERT INTO hyperfide.graph_files(organisation_id,run_id,id,graph_id,repository_id,source_object_id,path,content_digest,parse_blob_id) VALUES($1,$2,$3,$4,$5,$6,'api.txt',$7,$8)",[org,run,files[repository],build,repository,commit,digest(text),blob])
 for number,(name,repository) in enumerate(symbols):
  ids[name]=str(uuid.uuid4())
  sql("INSERT INTO hyperfide.graph_symbols(organisation_id,run_id,id,graph_id,file_id,symbol_key,name,kind,start_byte,end_byte) VALUES($1,$2,$3,$4,$5,$6,$6,'function',$7,$7)",[org,run,ids[name],build,files[repository],name,number])
 for caller,callee in edges:
  sql("INSERT INTO hyperfide.graph_edges(organisation_id,run_id,graph_id,source_symbol_id,target_symbol_id,kind) VALUES($1,$2,$3,$4,$5,'calls')",[org,run,build,ids[caller],ids[callee]])
 if unresolved:
  sql("INSERT INTO hyperfide.graph_references(organisation_id,run_id,graph_id,file_id,reference_key,name,resolution_state,start_byte,end_byte) VALUES($1,$2,$3,$4,'dynamic-dispatch','priceFeed','UNRESOLVED',0,0)",[org,run,build,next(iter(files.values()))])
 sql("INSERT INTO hyperfide.graph_manifests(organisation_id,run_id,id,build_id,manifest_digest,source_manifest_digest,file_count,symbol_count,reference_count,edge_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",[org,run,manifest_id,build,digest("manifest:"+tag),digest("build:"+tag),len(files),len(symbols),1 if unresolved else 0,len(edges)])
 return manifest_id,ids
def behavioural(f,publish,before,consumer,identity):
 impact=lambda key,a,b,**kw:f.ok("review.contract.impact",dict(m.SCOPE,contract_key=key,baseline_revision=a,candidate_revision=b,**kw),component="17.2")
 def mutate(key,changes,revision="2",base=None):
  body=copy.deepcopy(base or before)
  for facet,definition in changes.items():body["facets"][facet]["definition"]=definition
  publish(body,revision,key);return body
 def unchanged_signature(key,changes,expected):
  publish(copy.deepcopy(before),"1",key)
  mutate(key,changes);result=impact(key,"1","2")
  m.expect(result["changed_facets"]==expected and result["behavioural_facets_changed"]==expected,"behavioural change hidden: "+json.dumps(result["changed_facets"]))
  m.expect(result["unchanged_signatures"] is True and result["requires_behavioural_qualification"] is True and result["qualification_status"]=="UNRUN","unchanged signature suppressed behavioural review")
  m.expect([finding["facet"] for finding in result["findings"]]==expected and all(finding["signature_unchanged"] and finding["kind"]=="BEHAVIOURAL" for finding in result["findings"]),"finding omitted unchanged-signature defect")
  return result
 # do_2: stale-price (staleness duration + precision), error-order and idempotency defects behind identical signatures.
 m.check(IDS[14],lambda:unchanged_signature("stale-price",{"state":{"max_price_age_seconds":300},"precision":{"decimal_places":2,"rounding":"HALF_EVEN"}},["state","precision"]))
 m.check(IDS[15],lambda:unchanged_signature("error-order",{"errors":{"first":"RATE_LIMITED","then":"UNAUTHENTICATED"},"ordering":{"events":"price-before-ack"}},["errors","ordering"]))
 state={}
 m.check(IDS[16],lambda:state.update(idem=unchanged_signature("idempotency",{"idempotency":{"retry":"at-least-once","dedupe_key":None}},["idempotency"])))
 def reproductions():
  result=state["idem"];templates=before["scenario_templates"]
  m.expect(result["required_reproductions"]==templates,"required reproductions differ from candidate templates")
  m.expect([(r["template_id"],r["assertion_ids"]) for r in result["reproductions"]]==[(t["template_id"],t["assertion_ids"]) for t in templates],"reproduction lost its template assertions")
  for r in result["reproductions"]:
   m.expect(r["producer"]["baseline"]["repository_id"]==m.REPOSITORY and r["producer"]["candidate"]["source_object_id"]==f.first,"reproduction does not pin the producer side")
   m.expect(any(c["repository_id"]==consumer for c in r["consumers"]) and r["facets"]==["idempotency"] and r["status"]=="UNRUN","reproduction does not pin the consumer side")
  finding=result["findings"][0]
  m.expect(finding["producer"]["candidate"]["repository_id"]==m.REPOSITORY and any(c["repository_id"]==consumer for c in finding["consumers"]) and finding["reproducer_template_ids"]==["system.units"] and finding["status"]=="REPRODUCTION_REQUIRED","finding does not link both sides and a reproducer")
 m.check(IDS[17],reproductions)
 def no_template():
  empty=copy.deepcopy(before);empty["scenario_templates"]=[];publish(empty,"1","no-template")
  mutate("no-template",{"units":{"behaviour":"dollars"}},base=empty);result=impact("no-template","1","2")
  m.expect("EXECUTABLE_REPRODUCTIONS_REQUIRED" in result["limitations"] and result["required_reproductions"]==[] and result["reproductions"]==[],"missing reproducer not explicit")
  m.expect(result["findings"][0]["status"]=="REPRODUCER_MISSING","finding claimed a reproducer that does not exist")
 m.check(IDS[18],no_template)
 def unchanged_consumer():
  result=state["idem"];point=[c for c in result["affected_consumers"] if c["repository_id"]==consumer and c["source_object_id"]==f.pinned]
  m.expect(len(point)==1 and sorted(point[0]["origins"])==["BASELINE","CANDIDATE"],"unchanged consumer of changed behaviour was dropped")
  m.expect({"repository_id":consumer,"source_object_id":f.pinned} in result["unchanged_consumers"],"unchanged consumer not reported")
 m.check(IDS[19],unchanged_consumer)
 # do_2 + V-034: real 7.4 traversal over published exact snapshots.
 sources=[(m.REPOSITORY,f.first),(consumer,f.pinned)];symbols=[("quotePrice",m.REPOSITORY),("renderTotal",consumer),("checkout",consumer)]
 edges=[("renderTotal","quotePrice"),("checkout","renderTotal")]
 complete,ids=seed_graph(f,"complete",sources,symbols,edges)
 unknown,unknown_ids=seed_graph(f,"unknown-edges",sources,symbols,edges,unresolved=True)
 graph_body=copy.deepcopy(before);graph_body["consumers"]=[]
 def graph_contract(key,symbol_ids,producer=f.first):
  body=copy.deepcopy(graph_body);body["producer"]={"repository_id":m.REPOSITORY,"source_object_id":producer,"symbol_ids":symbol_ids}
  publish(body,"1",key);mutate(key,{"precision":{"decimal_places":4}},base=body)
 def callers():
  graph_contract("graph-complete",[ids["quotePrice"]]);result=impact("graph-complete","1","2",graph_manifest_id=complete)
  found=[c for c in result["affected_consumers"] if c["repository_id"]==consumer and c["source_object_id"]==f.pinned]
  m.expect(len(found)==1 and sorted(found[0]["symbol_ids"])==sorted([ids["renderTotal"],ids["checkout"]]) and found[0]["origins"]==["GRAPH"],"graph callers missing from affected consumers: "+json.dumps(result["affected_consumers"]))
  m.expect(result["graph"]["manifest_id"]==complete and result["analysis_complete"] is True and not any(l.startswith("GRAPH_") for l in result["limitations"]),"complete exact graph not used: "+json.dumps(result["limitations"]))
  m.expect({"repository_id":consumer,"source_object_id":f.pinned} in result["unchanged_consumers"] and result["changed_facets"]==["precision"],"undeclared unchanged consumer omitted")
 m.check(IDS[20],callers)
 def unknown_edges():
  graph_contract("graph-unknown",[unknown_ids["quotePrice"]]);result=impact("graph-unknown","1","2",graph_manifest_id=unknown)
  m.expect(len(result["graph"]["unknown_references"])==1 and result["analysis_complete"] is False and "GRAPH_CONSUMERS_INCOMPLETE" in result["limitations"],"unknown graph edges presented complete")
  m.expect(any(c["repository_id"]==consumer for c in result["affected_consumers"]),"resolved callers lost alongside unknown edges")
 m.check(IDS[21],unknown_edges)
 def unbound():
  graph_contract("graph-unbound",[ids["quotePrice"]],producer=f.second);result=impact("graph-unbound","1","2",graph_manifest_id=complete)
  m.expect("GRAPH_PRODUCER_SOURCE_UNBOUND" in result["limitations"] and "GRAPH_CONSUMERS_INCOMPLETE" in result["limitations"] and result["analysis_complete"] is False,"graph of another producer revision accepted")
 m.check(IDS[22],unbound)
 def unavailable():
  result=impact("graph-complete","1","2",graph_manifest_id=m.xid(0xbad))
  m.expect("GRAPH_SNAPSHOT_UNAVAILABLE" in result["limitations"] and result["graph"]["error_code"] and result["analysis_complete"] is False,"missing graph snapshot presented complete")
 m.check(IDS[23],unavailable)
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
   behavioural(f,publish,before,consumer,identity)
  finally:f.identity.close();f.save(m.FAILED)
 return int(bool(m.FAILED))
if __name__=="__main__":raise SystemExit(m.cleanup("17.2") if "--cleanup" in sys.argv else main())
