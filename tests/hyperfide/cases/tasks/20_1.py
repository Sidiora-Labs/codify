#!/usr/bin/env python3
"""Decision adapter component checks use an actual service and synthetic HTTP only."""
import copy
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import sys

ROOT=Path(__file__).resolve().parents[4]
IDS=[
 "decision.routes.identities","decision.routes.qualification-unknown","decision.prepare.native-span",
 "decision.prepare.native-jev","decision.prepare.native-ultra","decision.prepare.gateway",
 "decision.prepare.unknown-route","decision.prepare.unknown-fields","decision.prepare.empty-questions",
 "decision.prepare.choice-option-cap","decision.prepare.score-cardinality","decision.prepare.number-disabled",
 "decision.prepare.box-disabled","decision.prepare.media-not-stripped","decision.transport.span-fixture",
 "decision.transport.jev-fixture","decision.transport.ultra-fixture","decision.transport.missing-credential",
 "decision.transport.unqualified","decision.transport.wrong-model","decision.transport.wrong-answer",
 "decision.transport.duplicate-json","decision.transport.nonfinite-json","decision.transport.failed-usage",
 "decision.transport.http-auth","decision.transport.http-overload-one-send","decision.transport.timeout",
 "decision.configuration.legacy-preserved","decision.transport.escaped-credential","decision.prepare.extensions-reserved",
]
ACTIONS=["decision.routes.describe","decision.adapter.prepare","decision.adapter.invoke","decision.configuration.migrate"]

def expect(condition,message):
 if not condition:raise AssertionError(message)

def request():
 return {"state":{"source":"synthetic fixture"},"questions":{"urgent":{"type":"noul","instructions":"Does this need review?"}}}

class Fixture:
 def __init__(self,base,component="20.1",actions=None):
  self.path=Path(base);self.components=self.path/"components";self.components.mkdir()
  shutil_copy=ROOT/"services/hyperfide/components"/(component+".json")
  (self.components/shutil_copy.name).write_bytes(shutil_copy.read_bytes())
  self.actions=actions or ACTIONS
  self.policy={"schema_version":1,"programme_id":"decision-component-fixture","repository":"synthetic/repository",
   "spec_revision":"fixture-spec","policy_revision":1,"status":"ACTIVE",
   "approval":{"decision":"APPROVED","record_id":"synthetic-approval","spec_revision":"fixture-spec","policy_revision":1},
   "allowed_roles":["control"],"allowed_actions":["programme.activate",*self.actions]}
  self.policy_path=self.path/"policy.json";self.policy_path.write_text(json.dumps(self.policy))
  self.component=component
 def invoke(self,action,input=None,env=None,timeout=10):
  environment=os.environ.copy()
  for key in list(environment):
   if key.startswith("HYPERFIDE_DECISION_"):environment.pop(key)
  if env:environment.update(env)
  result=subprocess.run(["node",str(ROOT/"services/hyperfide/dist/control.js"),"--policy",str(self.policy_path),
   "--spec-revision","fixture-spec","--components",str(self.components),"--module-root",str(ROOT/"services/hyperfide/dist")],
   input=json.dumps({"id":"decision-test","component":self.component,"action":action,"input":input or {}})+"\n",
   text=True,capture_output=True,env=environment,timeout=timeout,cwd=ROOT)
  rows=[json.loads(l) for l in result.stdout.splitlines() if l.strip()]
  expect(len(rows)==1,f"missing service response: {result.returncode} {result.stderr} {result.stdout}")
  return result,rows[0]

class HTTPFixture:
 def __init__(self,mode="valid"):
  self.mode=mode;self.received=[]
  outer=self
  class Handler(BaseHTTPRequestHandler):
   def log_message(self,*args):pass
   def do_POST(self):
    body=json.loads(self.rfile.read(int(self.headers["content-length"])))
    outer.received.append({"path":self.path,"headers":dict(self.headers),"body":body})
    if outer.mode=="timeout":
     import time;time.sleep(2)
    answers={}
    for key,q in body["questions"].items():
     if q["type"]=="noul":answers[key]={"type":"noul","noul":.7}
     elif q["type"]=="choice":
      keys=list(q["criteria"]);answers[key]={"type":"choice","choice":keys[0],"confidence":1,"probabilities":{k:float(k==keys[0]) for k in keys}}
     else:
      levels=q["criteria"];answers[key]={"type":"score","score":0,"confidence":1,"legend":{str(i):x for i,x in enumerate(levels)},"probabilities":{str(i):float(i==0) for i in range(len(levels))}}
    response={"model":body["model"],"answers":answers,"usage":{"input_tokens":11,"output_tokens":0}}
    if outer.mode=="wrong-model":response["model"]="unqualified-model-version"
    if outer.mode=="wrong-answer":response["answers"]={"other":{"type":"noul","noul":.7}}
    if outer.mode=="failed-usage":response["usage"]["input_tokens"]=-1
    if outer.mode=="escaped-credential":response["secret_note"]="synthetic-fixture-credential"
    encoded=json.dumps(response).encode()
    if outer.mode=="escaped-credential":encoded=encoded.replace(b"synthetic",b"syntheti"+bytes([92])+b"u0063")
    if outer.mode=="duplicate-json":encoded=b'{"model":"span-02","model":"span-02","answers":{},"usage":{}}'
    if outer.mode=="nonfinite-json":encoded=b'{"model":"span-02","answers":{"urgent":{"type":"noul","noul":1e400}},"usage":{"input_tokens":1,"output_tokens":0}}'
    status=401 if outer.mode=="auth" else 503 if outer.mode=="overload" else 200
    self.send_response(status);self.send_header("Content-Type","application/json");self.end_headers()
    try:self.wfile.write(encoded)
    except (BrokenPipeError,ConnectionResetError):pass
  self.server=ThreadingHTTPServer(("127.0.0.1",0),Handler)
  self.server.daemon_threads=False
  self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
 def env(self,route="span-native",model="span-02"):
  config={route:{"enabled":True,"mode":"fixture","qualification_ref":"synthetic-http-contract-only",
    "credential_env":"HYPERFIDE_DECISION_FIXTURE_KEY","endpoint":f"http://127.0.0.1:{self.server.server_port}/decisions",
    "max_body_bytes":65536,"returned_models":[model]}}
  return {"HYPERFIDE_DECISION_ROUTES":json.dumps(config),"HYPERFIDE_DECISION_FIXTURE_KEY":"synthetic-fixture-credential"}
 def close(self):
  self.server.shutdown();self.server.server_close();self.thread.join(timeout=3)

def run_checks(fixture,emit=True):
 failures=[]
 def check(identity,fn):
  try:fn();actual="observed"
  except Exception as error:actual=f"{type(error).__name__}: {error}";failures.append(identity)
  if emit:print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
 def success(action,input=None,env=None):
  process,payload=fixture.invoke(action,input,env)
  expect(process.returncode==0 and payload.get("ok") is True,f"service failed {payload} {process.stderr}")
  return payload["result"]
 def rejected(input,code="DECISION_SCHEMA"):
  process,payload=fixture.invoke("decision.adapter.prepare",input)
  expect(process.returncode!=0 and payload.get("error",{}).get("code")==code,f"did not reject: {payload}")
 def routes():
  rows=success("decision.routes.describe")["routes"]
  models={r["id"]:r["model"] for r in rows}
  expect(models["span-native"]=="span-02" and models["jev-native"]=="jev-1.14.0" and models["ultra-native"]=="d1-ultra","native model identities drifted")
  expect({r["endpoint"] for r in rows if r["route_class"]=="gateway"}=={"https://openrouter.ai/api/alpha/decisions"},"gateway endpoint conflated with native")
 check(IDS[0],routes)
 def unknown_qualification():
  rows=success("decision.routes.describe")["routes"]
  expect(all(r["live_qualification"]=="UNQUALIFIED" for r in rows),"fixture adapter claimed live qualification")
  ultra=next(r for r in rows if r["id"]=="ultra-native")
  expect(ultra["context_request_tokens"] is None,"unknown direct Ultra context became gateway limit")
 check(IDS[1],unknown_qualification)
 for identity,rid,model in [(IDS[2],"span-native","span-02"),(IDS[3],"jev-native","jev-1.14.0"),(IDS[4],"ultra-native","d1-ultra"),(IDS[5],"span-openrouter","respan/span-02")]:
  def prepared(rid=rid,model=model):
   value=success("decision.adapter.prepare",{"route_id":rid,"request":request()})
   expect(value["body"]["model"]==model and value["body"]["questions"]==request()["questions"],"request schema changed")
   expect("Authorization" not in value["headers"],"credential exposed in prepared preview")
  check(identity,prepared)
 check(IDS[6],lambda:rejected({"route_id":"unknown","request":request()},"DECISION_UNSUPPORTED"))
 bad=request();bad["unknown"]=True;check(IDS[7],lambda:rejected({"route_id":"span-native","request":bad}))
 check(IDS[8],lambda:rejected({"route_id":"span-native","request":{"state":"fixture","questions":{}}}))
 choice=request();choice["questions"]["urgent"]={"type":"choice","instructions":"choose","criteria":{str(i):str(i) for i in range(256)}}
 check(IDS[9],lambda:rejected({"route_id":"jev-native","request":choice},"DECISION_UNSUPPORTED"))
 score=request();score["questions"]["urgent"]={"type":"score","instructions":"rate","criteria":["one"]}
 check(IDS[10],lambda:rejected({"route_id":"span-native","request":score}))
 for identity,kind in [(IDS[11],"number"),(IDS[12],"box")]:
  q=request();q["questions"]["urgent"]={"type":kind,"instructions":"unsupported until explicitly qualified"}
  check(identity,lambda q=q:rejected({"route_id":"span-native","request":q},"DECISION_UNSUPPORTED"))
 media=request();media["images"]=["data:image/png;base64,AAAA"]
 check(IDS[13],lambda:rejected({"route_id":"span-native","request":media}))
 for identity,rid,model in [(IDS[14],"span-native","span-02"),(IDS[15],"jev-native","jev-1.14.0"),(IDS[16],"ultra-native","d1-ultra")]:
  def transport(rid=rid,model=model):
   http=HTTPFixture()
   try:
    value=success("decision.adapter.invoke",{"route_id":rid,"request":request(),"timeout_ms":1000},http.env(rid,model))
    expect(value["qualification"]=="fixture" and value["returned_model"]==model and value["response"]["answers"]["urgent"]["noul"]==.7,"typed transport mismatch")
    expect(len(http.received)==1 and http.received[0]["body"]["model"]==model,"actual HTTP request mismatch")
   finally:http.close()
  check(identity,transport)
 def missing_credential():
  http=HTTPFixture()
  try:
   env=http.env();env.pop("HYPERFIDE_DECISION_FIXTURE_KEY")
   process,payload=fixture.invoke("decision.adapter.invoke",{"route_id":"span-native","request":request(),"timeout_ms":1000},env)
   expect(process.returncode!=0 and payload["error"]["code"]=="DECISION_CREDENTIAL" and not http.received,"missing credential sent network request")
  finally:http.close()
 check(IDS[17],missing_credential)
 def unqualified():
  process,payload=fixture.invoke("decision.adapter.invoke",{"route_id":"span-native","request":request(),"timeout_ms":1000})
  expect(process.returncode!=0 and payload["ok"] is False,"unqualified live route activated")
 check(IDS[18],unqualified)
 for identity,mode,code in [(IDS[19],"wrong-model","DECISION_MODEL_CHANGED"),(IDS[20],"wrong-answer","DECISION_RESPONSE"),(IDS[21],"duplicate-json","DECISION_SCHEMA"),(IDS[22],"nonfinite-json","DECISION_SCHEMA"),(IDS[23],"failed-usage","DECISION_SCHEMA"),(IDS[24],"auth","DECISION_CREDENTIAL"),(IDS[25],"overload","DECISION_HTTP"),(IDS[26],"timeout","DECISION_TIMEOUT")]:
  def negative(mode=mode,code=code):
   http=HTTPFixture(mode)
   try:
    process,payload=fixture.invoke("decision.adapter.invoke",{"route_id":"span-native","request":request(),"timeout_ms":1000},http.env())
    expect(process.returncode!=0 and payload["error"]["code"]==code,f"malformed/failed response accepted: {payload}")
    expect(len(http.received)==1,"adapter silently retried transport")
    expect("synthetic-fixture-credential" not in process.stdout+process.stderr,"credential leaked")
   finally:http.close()
  check(identity,negative)
 def legacy():
  value=success("decision.configuration.migrate",env={"CG_JEV_MODEL":"historical-model","CG_RECAP_DECIDE_MODEL":"historical-recap"})
  expect(value["legacy_jev"]["model"]=="historical-model" and value["legacy_recap"]["model"]=="historical-recap" and value["model_upgrade_automatic"] is False,"legacy configuration silently upgraded")
 check(IDS[27],legacy)
 check(IDS[28],lambda:negative("escaped-credential","DECISION_RESPONSE"))
 def reserved():
  script="""import {prepare} from './services/hyperfide/dist/decisions/adapters.js';
const request={state:'synthetic',questions:{q:{type:'noul',instructions:'question'}}};
for(const extensions of [{body:{model:'forged-model'}},{body:{state:'forged-state'}},{body:{questions:{}}},{headers:{Authorization:'forged'}}]){
let rejected=false;try{prepare('span-native',request,extensions);}catch(e){rejected=e.code==='DECISION_SCHEMA';}
if(!rejected)process.exit(1);
}
console.log('reserved fields rejected');
"""
  process=subprocess.run(["node","--input-type=module","-e",script],cwd=ROOT,text=True,capture_output=True,timeout=10)
  expect(process.returncode==0 and "reserved fields rejected"in process.stdout,"extension overwrote validated fields")
 check(IDS[29],reserved)
 return failures

def main():
 with tempfile.TemporaryDirectory(prefix="hf20-adapter-") as temporary:
  failed=run_checks(Fixture(temporary))
 print(json.dumps({"type":"cleanup","resources":[],"complete":True}),flush=True)
 return 1 if failed else 0
if __name__=="__main__":sys.exit(main())
