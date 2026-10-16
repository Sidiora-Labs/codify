#!/usr/bin/env python3
"""Probability validation is exercised through the real registered service."""
import ast
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import sys
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location("decision_adapter_probe",Path(__file__).with_name("20_1.py"))
shared=importlib.util.module_from_spec(spec);spec.loader.exec_module(shared)
IDS=["decision.result.noul-half","decision.result.noul-ninety","decision.result.choice-raw","decision.result.normalization-explicit",
 "decision.result.score-weighted","decision.result.bad-mass","decision.result.wrong-options","decision.result.wrong-choice",
 "decision.result.score-contradiction","decision.result.wrong-legend","decision.result.missing-answer",
 "decision.result.extra-answer","decision.result.wrong-type","decision.result.nan","decision.result.out-of-range",
 "decision.result.provider-confidence","decision.result.preview-untrusted","decision.result.missing-calibration",
 "decision.result.fixture-abstention","decision.result.forged-attestation","decision.result.identity-schema","decision.result.prepared-preserved","decision.result.forged-prepared"]
ACTIONS=["decision.result.validate","decision.result.evaluate"]
def request(kind="noul"):
 q={"type":kind,"instructions":"Synthetic rubric"}
 if kind=="choice":q["criteria"]={"a":"first","b":"second"}
 if kind=="score":q["criteria"]=["low","medium","high"]
 return {"state":"synthetic bounded source","questions":{"q":q}}
def response(kind="noul"):
 answer={"type":kind,"noul":.9}
 if kind=="choice":answer={"type":"choice","choice":"a","probabilities":{"a":.8,"b":.2},"confidence":.6}
 if kind=="score":answer={"type":"score","score":1.1,"probabilities":{"0":.1,"1":.7,"2":.2},"legend":{"0":"low","1":"medium","2":"high"},"confidence":.55}
 return {"model":"span-02","answers":{"q":answer},"usage":{"input_tokens":10,"output_tokens":0}}
def identity():
 return {"decision_id":"synthetic-20.2","packet_hash":"sha256:"+"a"*64,"purpose":"synthetic-review","rubric_version":"fixture-v1",
  "revision":{"spec_revision":"spec-v1","repository_commits":{"repo":"b"*40},"graph_revision":None,"contract_revisions":{},
   "event_watermark":"event-1","ownership_generation":None}}
def main():
 failed=[]
 with tempfile.TemporaryDirectory(prefix="hf20-results-")as temporary:
  fixture=shared.Fixture(temporary,"20.2",ACTIONS)
  (fixture.components/"20.1.json").write_bytes((ROOT/"services/hyperfide/components/20.1.json").read_bytes())
  def check(i,fn):
   try:fn();actual="observed"
   except Exception as error:actual=f"{type(error).__name__}: {error}";failed.append(i)
   print(json.dumps({"type":"assertion","id":i,"expected":"observed","actual":actual}),flush=True)
  def validate(req,res):
   p,r=fixture.invoke("decision.result.validate",{"route_id":"span-native","request":req,"response":res})
   shared.expect(p.returncode==0 and r.get("ok")is True,f"validation failed {r} {p.stderr}")
   return r["result"]
  def reject(req,res):
   p,r=fixture.invoke("decision.result.validate",{"route_id":"span-native","request":req,"response":res})
   shared.expect(p.returncode!=0 and r.get("ok")is False,f"invalid response accepted {r}")
  def half():
   r=response();r["answers"]["q"]["noul"]=.5;v=validate(request(),r)["answers"]["q"]
   shared.expect(v["value"]==.5 and v["derived"]["decision_probability"]==.5 and v["derived"]["legacy_margin"]==0,"Noul half semantic scales conflated")
  check(IDS[0],half)
  def ninety():
   v=validate(request(),response())["answers"]["q"]
   shared.expect(v["derived"]["decision_probability"]==.9 and abs(v["derived"]["legacy_margin"]-.8)<1e-12 and v["provider_confidence"]is None,"Noul scales conflated")
  check(IDS[1],ninety)
  check(IDS[2],lambda:shared.expect(validate(request("choice"),response("choice"))["answers"]["q"]["raw_probabilities"]=={"a":.8,"b":.2},"raw distribution lost"))
  def normalization():
   r=response("choice");r["answers"]["q"]["probabilities"]={"a":.8001,"b":.1994};v=validate(request("choice"),r)["answers"]["q"]
   shared.expect(v["raw_probabilities"]==r["answers"]["q"]["probabilities"] and v["normalization"]["applied"]is True and abs(sum(v["normalized_probabilities"].values())-1)<1e-12,"normalization hidden or raw overwritten")
  check(IDS[3],normalization)
  check(IDS[4],lambda:shared.expect(validate(request("score"),response("score"))["answers"]["q"]["value"]==1.1,"weighted score lost"))
  negatives=[]
  r=response("choice");r["answers"]["q"]["probabilities"]={"a":.9,"b":.9};negatives.append((request("choice"),r))
  r=response("choice");r["answers"]["q"]["probabilities"]={"a":.8,"unknown":.2};negatives.append((request("choice"),r))
  r=response("choice");r["answers"]["q"]["choice"]="b";negatives.append((request("choice"),r))
  r=response("score");r["answers"]["q"]["score"]=2;negatives.append((request("score"),r))
  r=response("score");r["answers"]["q"]["legend"]["1"]="changed";negatives.append((request("score"),r))
  r=response();r["answers"]={};negatives.append((request(),r))
  r=response();r["answers"]["extra"]={"type":"noul","noul":.1};negatives.append((request(),r))
  r=response();r["answers"]["q"]["type"]="choice";negatives.append((request(),r))
  r=response();r["answers"]["q"]["noul"]=float("nan");negatives.append((request(),r))
  r=response();r["answers"]["q"]["noul"]=1.01;negatives.append((request(),r))
  r=response("choice");r["answers"]["q"]["confidence"]=-.1;negatives.append((request("choice"),r))
  for i,(req,res)in enumerate(negatives,5):check(IDS[i],lambda req=req,res=res:reject(req,res))
  def preview():
   v=validate(request(),response())
   shared.expect(v["status"]=="abstained" and v["abstention_reason"]=="untrusted-response-preview" and v["authority"]=="advisory-only","wire preview granted authority")
  check(IDS[16],preview)
  def evaluate(calibration=False):
   http=shared.HTTPFixture()
   try:
    env=http.env()
    if calibration:env["HYPERFIDE_DECISION_CALIBRATIONS"]=json.dumps([{"version":"fixture-cal","purpose":"synthetic-review","route_id":"span-native","returned_model":"span-02","rubric_version":"fixture-v1","minimum_concentration":.5,"qualification_ref":"synthetic-only"}])
    p,r=fixture.invoke("decision.result.evaluate",{"route_id":"span-native","request":shared.request(),"identity":identity(),"timeout_ms":1000},env)
    shared.expect(p.returncode==0 and r.get("ok")is True,f"evaluation failed {r}")
    v=r["result"];shared.expect(v["status"]=="abstained" and v["transport"]["qualification"]=="fixture","fixture activated live advice")
    if not calibration:shared.expect(v["calibration_version"]is None,"unprovided calibration fabricated")
   finally:http.close()
  check(IDS[17],lambda:evaluate(False));check(IDS[18],lambda:evaluate(True))
  def attestation():
   script="""import {assertValidatedDecision} from './services/hyperfide/dist/decisions/results.js';
let rejected=false;try{assertValidatedDecision({identity:{decision_id:'x',packet_hash:'sha256:x'},status:'accepted_advice'},{decision_id:'x',packet_hash:'sha256:x'});}catch(e){rejected=e.code==='DECISION_UNTRUSTED';}
if(!rejected)process.exit(1);
console.log('untrusted record rejected');
"""
   p=subprocess.run(["node","--input-type=module","-e",script],cwd=ROOT,text=True,capture_output=True,timeout=10)
   shared.expect(p.returncode==0 and "untrusted record rejected"in p.stdout,"JSON forged private transport attestation")
  check(IDS[19],attestation)
  def invalid_identity():
   bad=identity();bad["revision"]["repository_commits"]["repo"]="floating-main"
   p,r=fixture.invoke("decision.result.evaluate",{"route_id":"span-native","request":shared.request(),"identity":bad,"timeout_ms":1000})
   shared.expect(p.returncode!=0 and r["error"]["code"]=="DECISION_SCHEMA","floating revision identity accepted")
  check(IDS[20],invalid_identity)
  def prepared_transport(forged=False):
   http=shared.HTTPFixture()
   try:
    script="""import {prepare} from './services/hyperfide/dist/decisions/adapters.js';
import {evaluatePreparedDecision,assertValidatedDecision} from './services/hyperfide/dist/decisions/results.js';
const source=JSON.parse(process.env.TEST_REQUEST),identity=JSON.parse(process.env.TEST_IDENTITY);
let prepared=prepare('span-native',source,{body:{reasoning:{mode:'on',budget_ms:100},images:['synthetic-internal-preservation-sentinel']}});
if(process.env.TEST_FORGED==='true')prepared=JSON.parse(JSON.stringify(prepared));
try {
 const result=await evaluatePreparedDecision(prepared,identity,process.env,{timeout_ms:1000});
 assertValidatedDecision(result,identity);
 if(!result.raw_response.answers.urgent||result.status!=='abstained')process.exit(2);
 console.log('validated');
}catch(e){if(process.env.TEST_FORGED==='true'&&e.code==='DECISION_SCHEMA')console.log('forgery rejected');else throw e;}
"""
    import os
    env=os.environ.copy();env.update(http.env());env['TEST_REQUEST']=json.dumps(shared.request());env['TEST_IDENTITY']=json.dumps(identity());env['TEST_FORGED']='true'if forged else'false'
    cp=subprocess.run(['node','--input-type=module','-e',script],cwd=ROOT,env=env,text=True,capture_output=True,timeout=10)
    shared.expect(cp.returncode==0,f'prepared evaluation failed {cp.stderr}')
    if forged:shared.expect(not http.received and 'forgery rejected'in cp.stdout,'forged prepared request reached transport')
    else:shared.expect(len(http.received)==1 and http.received[0]['body']['reasoning']['budget_ms']==100 and http.received[0]['body']['images']==['synthetic-internal-preservation-sentinel'],'prepared extension was stripped')
   finally:http.close()
  check(IDS[21],lambda:prepared_transport(False));check(IDS[22],lambda:prepared_transport(True))
 print(json.dumps({"type":"cleanup","resources":[],"complete":True}),flush=True)
 return 1 if failed else 0
if __name__=="__main__":sys.exit(main())
