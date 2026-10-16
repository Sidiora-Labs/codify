#!/usr/bin/env python3
"""Qualify the readiness checker with controlled inventories; never claim an actual release."""
import json,runpy,sys
from pathlib import Path
H=runpy.run_path(str(Path(__file__).with_name("28_2.py")))
fixture=H["fixture"];call=H["call"];check=H["check"];require=H["require"];node=H["node"];FAILED=H["FAILED"]
NODE_BASE="""
import{loadReleaseContract}from'./services/hyperfide/dist/release/traceability.js';
import{validateReadinessInventory,RELEASE_GATES}from'./services/hyperfide/dist/release/readiness.js';
import{contentDigest}from'./services/hyperfide/dist/docs/closure.js';
const{contract:live}=await loadReleaseContract();const c=structuredClone(live);
for(const[k,v]of Object.entries(c.cases))v.full_assertion_ids=['synthetic.assertion.'+k];
c.contract_digest=contentDigest({fixture_only:true,contract:c});
const revision='f'.repeat(40),source=contentDigest('synthetic-source-manifest');
const e=new Map(),names=Object.keys(c.cases);
for(const name of names)e.set(name,{reference:name,receipt_digest:contentDigest('synthetic-receipt-'+name),scope:'full-case',case_ids:[name],
 assertion_ids:c.cases[name].full_assertion_ids,outcome:'PASS',full_case_status:'PASS',implementation_revision:revision,source_manifest_digest:source,
 gate_kinds:[...RELEASE_GATES],resources:[]});
e.get(names[0]).resources=[{id:'fixture-resource',state:'CLEANED',owner:null,expires_at:null,retention_authorised:false,observed_at:new Date(Date.now()-1000).toISOString()}];
e.set('checker',{...e.get(names[0]),reference:'checker',scope:'task-component',full_case_status:'INCOMPLETE',gate_kinds:['checker_selftest'],resources:[]});
const p={schema_version:1,contract_digest:c.contract_digest,implementation_revision:revision,source_manifest_digest:source,
 clause_evidence:c.mappings.map(m=>({clause:m.id,task_ids:m.task_ids,case_ids:m.acceptance_ids,evidence_refs:m.acceptance_ids})),
 case_evidence:names.map(n=>({case_id:n,evidence_ref:n})),gate_evidence:RELEASE_GATES.map(kind=>({kind,evidence_refs:[kind==='checker_selftest'?'checker':names[0]]})),
 resource_ids:['fixture-resource'],unsupported_features:[]};
"""
def controlled(change="",positive=False):
    suffix=change+";let result;try{result=validateReadinessInventory(c,p,e)}catch(error){if("+str(positive).lower()+")throw error;process.exit(0)}if(result.complete!=="+str(positive).lower()+")throw Error('unexpected controlled result '+JSON.stringify(result));if("+str(positive).lower()+"&&(result.checker_result_is_release_authority!==false||result.seal_requires_self_digest!==false))throw Error('checker selftest claimed authority');"
    result=node(NODE_BASE+suffix);require(result.returncode==0,result.stderr)
def main():
    H["configure_task"]("28.3")
    check("readiness.controlled-complete-inventory",lambda:controlled(positive=True))
    changes={
      "missing-case":"p.case_evidence.pop()",
      "missing-clause":"p.clause_evidence.pop()",
      "duplicate-case":"p.case_evidence.push(p.case_evidence[0])",
      "missing-gate":"p.gate_evidence.pop()",
      "component-is-not-full-case":"e.get(names[0]).scope='task-component';e.get(names[0]).full_case_status='INCOMPLETE'",
      "missing-assertion":"e.get(names[0]).assertion_ids=[]",
      "stale-commit":"e.get(names[0]).implementation_revision='a'.repeat(40)",
      "stale-source-manifest":"e.get(names[0]).source_manifest_digest=contentDigest('other-source')",
      "tampered-contract":"p.contract_digest=contentDigest('tampered')",
      "unknown-proof":"p.case_evidence[0].evidence_ref='absent'",
      "wrong-gate-proof":"e.get(names[0]).gate_kinds=[]",
      "omitted-resource":"p.resource_ids=[]",
      "unexplained-retention":"Object.assign(e.get(names[0]).resources[0],{state:'RETAINED',owner:null,expires_at:null,retention_authorised:false})",
      "expired-retention":"Object.assign(e.get(names[0]).resources[0],{state:'RETAINED',owner:'fixture-owner',expires_at:'2020-01-01T00:00:00.000Z',retention_authorised:true})",
      "wrong-clause-owner":"p.clause_evidence[0].task_ids=['999.1']",
      "missing-native-registration":"c.cases[names[0]].full_assertion_ids=[]",
      "force-override":"p.force=true",
      "recursive-seal-input":"p.seal_digest=contentDigest('self-reference')",
    }
    for name,change in changes.items():check("readiness.reject-"+name,lambda change=change:controlled(change))
    check("readiness.explicit-current-retention",lambda:controlled("Object.assign(e.get(names[0]).resources[0],{state:'RETAINED',owner:'fixture-owner',expires_at:new Date(Date.now()+60000).toISOString(),retention_authorised:true})",True))
    check("readiness.observed-later-cleanup",lambda:controlled("Object.assign(e.get(names[0]).resources[0],{state:'RETAINED',owner:'fixture-owner',expires_at:new Date(Date.now()+60000).toISOString(),retention_authorised:true});e.get(names[1]).resources=[{id:'fixture-resource',state:'CLEANED',owner:null,expires_at:null,retention_authorised:false,observed_at:new Date().toISOString()}]",True))
    def manifest_binding(tampered):
        script="import{pinnedCampaignManifest}from'./services/hyperfide/dist/release/readiness.js';import{sha256}from'./services/hyperfide/dist/docs/closure.js';const original=Buffer.from(JSON.stringify({policy:{source_manifest_digest:'sha256:'+('a'.repeat(64))}}));const receipt={manifest_sha256:sha256(original).slice(7)};const bytes="+("Buffer.from(JSON.stringify({policy:{source_manifest_digest:'sha256:'+('b'.repeat(64))}}))"if tampered else"original")+";try{const result=pinnedCampaignManifest(receipt,bytes);if("+str(tampered).lower()+")throw Error('tampered manifest accepted')}catch(e){if(!"+str(tampered).lower()+"||e.code!=='RELEASE_EVIDENCE_INVALID')throw e}"
        result=node(script);require(result.returncode==0,"manifest byte binding violated: "+result.stderr)
    check("readiness.exact-manifest-byte-binding",lambda:manifest_binding(False))
    check("readiness.reject-manifest-changed-after-checker",lambda:manifest_binding(True))
    f=fixture(("15.2","28.4","28.3"))
    try:
        current=call(f,"release.traceability.contract",{},component="28.4")
        live=current["contract"]
        inventory={"schema_version":1,"contract_digest":live["contract_digest"],"implementation_revision":"f"*40,"source_manifest_digest":H["digest"]("synthetic-source"),
          "clause_evidence":[{"clause":m["id"],"task_ids":m["task_ids"],"case_ids":m["acceptance_ids"],"evidence_refs":["unadmitted"]}for m in live["mappings"]],
          "case_evidence":[{"case_id":name,"evidence_ref":"unadmitted"}for name in live["cases"]],
          "gate_evidence":[{"kind":k,"evidence_refs":["unadmitted"]}for k in["task","candidate","programme","policy","docs","restore","rollback","cleanup","traceability","checker_selftest"]],
          "resource_ids":[],"unsupported_features":[]}
        def no_unadmitted():
            error=call(f,"release.readiness.assess",{"inventory":inventory},component="28.3",ok=False)
            require(error.get("code")=="RELEASE_EVIDENCE_UNAVAILABLE","caller evidence substituted for authoritative admission")
        check("readiness.actual-service-refuses-unadmitted-proof",no_unadmitted)
        check("readiness.actual-service-rejects-empty-inventory",lambda:call(f,"release.readiness.assess",{"inventory":{}},component="28.3",ok=False))
        def seal_unadmitted():
            error=call(f,"release.readiness.seal",{"inventory":inventory},component="28.3",ok=False)
            require(error.get("code")=="RELEASE_EVIDENCE_UNAVAILABLE","seal bypassed trusted evidence admission")
            rows=f.sql("SELECT count(*)::int AS n FROM hyperfide.release_records")
            require(rows[0]["n"]==0,"held seal wrote an authority record")
        check("readiness.actual-seal-refuses-unadmitted-proof",seal_unadmitted)
        def seal_guard():
            rows=f.sql("SELECT tgname FROM pg_trigger WHERE tgrelid='hyperfide.release_records'::regclass AND NOT tgisinternal ORDER BY tgname")
            require([r["tgname"]for r in rows]==["aaa_supported_isolation","immutable_documentation"],"release seal lacks isolation or immutability")
        check("readiness.actual-seal-table-guarded",seal_guard)
    finally:f.close()
    H["cleanup_event"]("28.3")
    return 1 if FAILED else 0
if __name__=="__main__":sys.exit(H["cleanup_only"]("28.3")if "--cleanup"in sys.argv else main())
