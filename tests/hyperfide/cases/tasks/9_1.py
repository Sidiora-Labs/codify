#!/usr/bin/env python3
"""Railway component fixtures. Provider responses are simulated, not live qualification."""
from __future__ import annotations
import base64
import copy
import hashlib
import http.server
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime,timedelta,timezone

ROOT=Path(__file__).resolve().parents[4]
DIGEST="sha256:"+"1"*64
OTHER="sha256:"+"2"*64
SCOPE={"organisation_id":"org-1","pool_id":"pool-1","provider":"railway","provider_account_id":"account-1",
       "environment_id":"environment-1","region":"region-1","configuration_digest":DIGEST}
RESOURCE={"native_sandbox_id":"sandbox-1","sandbox_boot_generation":"7"}
ACTIONS=[
 "railway.preparation.describe","railway.preparation.reference.verify","railway.preparation.restore.observe",
 "railway.preparation.checkpoint.resolve","railway.profile.validate","railway.profile.observe",
 "railway.process.describe","railway.process.start","railway.process.inspect","railway.process.stdin",
 "railway.process.detach","railway.process.stop","railway.process.spool.verify",
 "railway.reconciliation.create","railway.inventory.list","railway.sessions.list"
]
FAILED=[]

def clone(v): return copy.deepcopy(v)
def sha(data): return "sha256:"+hashlib.sha256(data).hexdigest()
def digest(v): return sha(json.dumps(v,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode())
def utc(delta=0): return (datetime.now(timezone.utc)+timedelta(seconds=delta)).isoformat(timespec="milliseconds").replace("+00:00","Z")
def expect(condition,detail):
 if not condition: raise AssertionError(detail)
def check(identity,callback):
 try:
  callback()
  actual="observed"
 except Exception as e:
  actual=f"{type(e).__name__}: {e}"
  FAILED.append(identity)
 print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
def result(row):
 expect(row.get("ok") is True,row)
 return row["result"]
def reject(row):
 expect(row.get("ok") is False and row.get("error",{}).get("code")=="HANDLER_FAILED",row)
def alter(v,path,value):
 out=clone(v)
 cur=out
 for p in path[:-1]:cur=cur[p]
 cur[path[-1]]=value
 return out
def base():
 return {"schema_version":1,"provider":"railway","scope":clone(SCOPE),"preparation_digest":DIGEST,
         "checkpoint":{"id":"checkpoint-ID-1","key":"checkpoint-key-1"},"disk_only":True,
         "source_boot_id":"boot-source-1","captured_at":"2026-10-16T10:00:00.000Z"}
def profile():
 body={"schema_version":1,"scope":clone(SCOPE),"preparation_digest":DIGEST,
       "source":{"kind":"CHECKPOINT","reference":"checkpoint-key-1","environment_id":"environment-1","region":"region-1"},
       "resources":{"cpu_millis":1500,"memory_bytes":"4294967296","disk_bytes":"1024","persistent_volume_bytes":"0"},
       "idle_timeout_minutes":0,"network":"ISOLATED","domains":[],
       "runtime_variables":{"CI":{"kind":"PUBLIC","value":"true"},
                            "GIT_TOKEN":{"kind":"SECRET_REFERENCE","value":"secret-ref:git-1"}},
       "build_variables":{"BUILD_MODE":"release"}}
 body["digest"]=digest(body)
 return body
def resign_profile(v):
 v=clone(v)
 v.pop("digest",None)
 v["digest"]=digest(v)
 return v
def observed():
 return {"id":"sandbox-1","status":"RUNNING","networkIsolation":"ISOLATED","environmentId":"environment-1",
         "region":"region-1","idleTimeoutMinutes":0,"createdAt":"2026-10-16T10:00:00.000Z","domains":[]}
def operation(kind,identity,params=None):
 defaults={
 "execute":{"argv":["python3","-c","print('fixture')"],"cwd":"/tmp","env_refs":{},"stdin":False,"durable":True,
            "process_timeout_ms":None,"wait_timeout_ms":10000},
 "stop":{"process_ref":"fixture-session","signal":"KILL"},
 "create":{"preparation_reference":"prepared-1","resources":clone(profile()["resources"]),"network":"ISOLATED","stdin_required":False},
 "observe":{},"list":{"cursor":None,"page_size":100},"destroy":{"reason":"fixture cleanup"}}
 op={"schema_version":1,"kind":kind,"scope":clone(SCOPE),"deadline_at":utc(3600),
     "identity":{"operation_id":identity,"idempotency_key":"idempotency-"+identity,"payload_digest":"",
                 "correlation_id":"correlation-1","causation_id":"causation-1"},
     "resource":None if kind in ["create","list"] else clone(RESOURCE),
     "preparation_digest":DIGEST if kind=="create" else None,
     "parameters":clone(params if params is not None else defaults[kind])}
 op["identity"]["payload_digest"]=digest({k:op[k] for k in ["kind","scope","resource","preparation_digest","deadline_at","parameters"]})
 return op

class Fixture:
 def __init__(self,directory):
  self.directory=Path(directory);self.requests=[];self.state={"mode":"normal","pages":1,"session_pages":1}
  owner=self
  class Handler(http.server.BaseHTTPRequestHandler):
   def log_message(self,*args):pass
   def do_POST(self):
    raw=json.loads(self.rfile.read(int(self.headers["content-length"])))
    owner.requests.append(raw)
    query=raw["query"];variables=raw.get("variables",{});mode=owner.state["mode"]
    if "generateShellToken" in query:data={"generateShellToken":"fixture-jwt"}
    elif "sandboxTemplateBuild" in query:data={"sandboxTemplateBuild":{"id":"fixture-build-ID","status":"READY"}}
    elif "sandboxCheckpointCreate" in query:
     data={"sandboxCheckpointCreate":{"id":"captured-checkpoint-ID","key":variables["name"],
            "environmentId":"environment-1","createdAt":utc()}}
    elif "sandboxCheckpoints" in query:
     rows=[{"id":"checkpoint-ID-1","key":"checkpoint-key-1","environmentId":"environment-1","createdAt":utc()}]
     if mode=="checkpoint-duplicate":rows.append(clone(rows[0])|{"id":"another-ID"})
     if mode=="checkpoint-wrong-env":rows[0]["environmentId"]="environment-other"
     data={"sandboxCheckpoints":rows}
    elif "sandboxCreate" in query:
     owner.state["creates"]=owner.state.get("creates",0)+1
     if mode=="lost-create-response":
      self.connection.shutdown(2);self.connection.close();return
     row=observed()|{"status":"CREATING"}
     if mode=="create-wrong-region":row["region"]="region-other"
     data={"sandboxCreate":row}
    elif "sandboxDestroy" in query:data={"sandboxDestroy":True}
    elif "sandboxSessions" in query:
     if mode=="sessions-unavailable":data={"sandboxSessions":None}
     else:
      index=0 if variables.get("after") is None else int(variables["after"].split("-")[-1])
      count=owner.state.get("session_pages",1)
      if hasattr(owner,"ws_state") and owner.ws_state.exists():
       state=json.loads(owner.ws_state.read_text())
       nodes=[{"node":{"name":name,"kind":"EXEC","attached":False,"command":item["command"],"createdAt":utc(),
          "foregroundActive":None,"runState":{"running":item["running"],"exitCode":item["exit_code"] or 0,"exitedAt":None}}}
          for name,item in state.get("sessions",{}).items()]
      else:nodes=[{"node":{"name":"session-"+str(index),"kind":"EXEC","attached":False,"command":"fixture","createdAt":utc(),
              "foregroundActive":None,"runState":{"running":True,"exitCode":0,"exitedAt":None}}}]
      more=index+1<count
      data={"sandboxSessions":{"edges":nodes,"pageInfo":{"hasNextPage":more,"endCursor":"session-page-"+str(index+1) if more else None}}}
    elif "sandboxes(" in query:
     index=0 if variables.get("after") is None else int(variables["after"].split("-")[-1])
     count=owner.state.get("pages",1)
     node=observed()|{"id":"sandbox-"+str(index)}
     if mode=="wrong-placement":node["environmentId"]="environment-other"
     if mode=="duplicate-inventory":node["id"]="duplicate"
     more=index+1<count
     token="inventory-page-"+str(index+1) if more else None
     if mode=="cursor-cycle" and more:token="inventory-page-1"
     data={"sandboxes":{"edges":[{"node":node}],"pageInfo":{"hasNextPage":more,"endCursor":token}}}
    else:
     data={"sandbox":None if mode=="destroyed" else observed()}
    body=json.dumps({"data":data}).encode()
    self.send_response(200);self.send_header("content-type","application/json");self.send_header("content-length",str(len(body)))
    self.end_headers();self.wfile.write(body)
  self.server=http.server.ThreadingHTTPServer(("127.0.0.1",0),Handler)
  self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
  self.config={"schema_version":1,"mode":"component-fixture","endpoint":"http://127.0.0.1:"+str(self.server.server_port)+"/graphql",
    "environment_id":"environment-1","region":"region-1","account_id":"account-1","token_env":"HF_RAILWAY_FIXTURE_TOKEN",
    "auth_type":"bearer","preparation_root":str(self.directory/"preparation"),"request_timeout_ms":10000,"exec_ws_endpoint":None}
  self.config_path=self.directory/"railway-config.json";self.write_config()
 def write_config(self):
  self.config_path.write_text(json.dumps(self.config));self.config_path.chmod(0o600)
 def close(self):self.server.shutdown();self.server.server_close();self.thread.join(timeout=5)

class Service:
 def __init__(self,directory,fixture):
  self.directory=Path(directory);self.fixture=fixture;self.sequence=0;self.had_error=False
  policy={"schema_version":1,"programme_id":"railway-component-fixture","repository":"fixture/repository",
   "spec_revision":"fixture-revision","policy_revision":1,"status":"ACTIVE",
   "approval":{"decision":"APPROVED","record_id":"fixture-approval","spec_revision":"fixture-revision","policy_revision":1},
   "allowed_roles":["provisioner"],"allowed_actions":["programme.provision"]+ACTIONS}
  filename=self.directory/("policy-"+str(time.monotonic_ns())+".json");filename.write_text(json.dumps(policy))
  self.stderr=(self.directory/("stderr-"+str(time.monotonic_ns()))).open("w+")
  environment=os.environ.copy()
  environment.update(HF_RAILWAY_CONFIG=str(fixture.config_path),HF_RAILWAY_FIXTURE_TOKEN="not-a-real-credential",
                     HF_RAILWAY_PROCESS_ROOT=str(self.directory/"spool"))
  self.process=subprocess.Popen(["node","services/hyperfide/dist/provisioner.js","--policy",str(filename),
    "--spec-revision","fixture-revision"],cwd=ROOT,env=environment,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
    stderr=self.stderr,text=True,start_new_session=True)
 def call(self,component,action,payload):
  self.sequence+=1;identity="request-"+str(self.sequence)
  self.process.stdin.write(json.dumps({"id":identity,"component":component,"action":action,"input":payload})+"\n")
  self.process.stdin.flush()
  ready,_,_=select.select([self.process.stdout],[],[],40)
  expect(bool(ready),"provisioner response deadline")
  line=self.process.stdout.readline()
  expect(bool(line),"service ended before response")
  row=json.loads(line);expect(row.get("id")==identity,row)
  if row.get("ok") is False:self.had_error=True
  return row
 def close(self):
  if self.process.poll() is None:
   self.process.stdin.close();self.process.wait(timeout=15)
  expect(self.process.returncode==(1 if self.had_error else 0),f"service exit{self.process.returncode}")
  expect(self.process.stdout.read()=="","extra protocol output")
  self.process.stdout.close();self.stderr.seek(0);errors=self.stderr.read();self.stderr.close()
  expect(errors=="",errors)

WS_SOURCE=r"""
import http from 'node:http';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(process.argv[2]+'/services/hyperfide/package.json');
const {WebSocketServer}=require('ws');
const statePath=process.argv[3],readyPath=process.argv[4],modePath=process.argv[5];
const server=http.createServer(),wss=new WebSocketServer({server});
const sessions=new Map();
const log=value=>fs.appendFileSync(statePath+'.events',JSON.stringify(value)+'\n');
const save=()=>fs.writeFileSync(statePath,JSON.stringify({sessions:Object.fromEntries([...sessions].map(([name,s])=>
 [name,{pid:s.child.pid,command:s.command,running:s.running,exit_code:s.exit}]))}));
const output=(s,kind,data)=>{const frame=Buffer.concat([Buffer.from([kind]),data]);for(const ws of s.clients)
 if(ws.readyState===1)ws.send(frame);};
wss.on('connection',ws=>{
 let session;
 ws.on('message',(data,binary)=>{
  if(binary){if(session&&data[0]===2){session.child.stdin.write(data.subarray(1));ws.send(JSON.stringify({type:'stdin_credit',data:{chunks:1}}));}return;}
  const message=JSON.parse(String(data));log({frame:message.type,data:message.data});
  if(message.type==='exec_hello'){
   const mode=JSON.parse(fs.readFileSync(modePath));
   if(mode.unsupported){ws.close(1000);return;}
   ws.send(JSON.stringify({type:'exec_capabilities',data:{version:2,stdin_chunk_bytes:16384,stdin_chunks:64}}));
  }else if(message.type==='init_exec'){
   const details=message.data;
   const name=details.durable_session_name||'session-'+String(sessions.size+1);
   session=sessions.get(name);
   if(!session){
    const child=spawn('sh',['-c',details.command],{cwd:details.cwd||'/tmp',env:{...process.env,...details.env},detached:true});
    session={child,command:details.command,clients:new Set(),running:true,exit:null};sessions.set(name,session);
    const bound=session;
    child.stdout.on('data',data=>output(bound,1,data));child.stderr.on('data',data=>output(bound,3,data));
    child.on('close',(code,signal)=>{log({exit:true,code,signal,pid:child.pid});bound.running=false;bound.exit=code===null?-1:code;save();
     for(const client of bound.clients)if(client.readyState===1)client.send(JSON.stringify({type:'exit',data:{exit_code:bound.exit}}));});
   }
   session.clients.add(ws);save();
   ws.send(JSON.stringify({type:'durable_session',data:{durable_session_name:name}}));
   if(!session.running)ws.send(JSON.stringify({type:'exit',data:{exit_code:session.exit}}));
  }else if(message.type==='stdin_close'){session?.child.stdin.end();}
  else if(message.type==='signal'&&session?.running){try{log({signal:message.data.signal,pid:session.child.pid});if(!JSON.parse(fs.readFileSync(modePath)).ignore_signals)process.kill(-session.child.pid,'SIG'+message.data.signal);}catch(error){log({killError:String(error)});}}
 });
 ws.on('close',()=>session?.clients.delete(ws));
});
const stop=async()=>{
 const pending=[];
 for(const s of sessions.values())if(s.running){pending.push(new Promise(resolve=>s.child.once('close',resolve)));
  try{process.kill(-s.child.pid,'SIGKILL');}catch{}}
 for(const client of wss.clients)client.terminate();
 await Promise.race([Promise.all(pending),new Promise(resolve=>setTimeout(resolve,2000))]);
 save();wss.close();server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),3000).unref();
};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
server.listen(0,'127.0.0.1',()=>{save();fs.writeFileSync(readyPath,JSON.stringify({port:server.address().port}));});
"""
class WebSocketFixture:
 def __init__(self,directory,fixture):
  self.directory=Path(directory);self.state=self.directory/"ws-state.json";self.ready=self.directory/"ws-ready.json"
  self.mode=self.directory/"ws-mode.json";self.mode.write_text('{"unsupported":false}')
  script=self.directory/"provider-fixture.mjs";script.write_text(WS_SOURCE)
  self.stderr=(self.directory/"ws.stderr").open("w+")
  self.process=subprocess.Popen(["node",str(script),str(ROOT),str(self.state),str(self.ready),str(self.mode)],
    cwd=ROOT,stdout=subprocess.PIPE,stderr=self.stderr,text=True,start_new_session=True)
  deadline=time.monotonic()+15
  while not self.ready.exists() and time.monotonic()<deadline:
   expect(self.process.poll() is None,"websocket fixture failed");time.sleep(.02)
  expect(self.ready.exists(),"websocket fixture readiness")
  fixture.config["exec_ws_endpoint"]="ws://127.0.0.1:"+str(json.loads(self.ready.read_text())["port"])+"/exec"
  fixture.write_config();fixture.ws_state=self.state
 def snapshot(self):return json.loads(self.state.read_text())
 def close(self):
  self.process.terminate();self.process.wait(timeout=10)
  expect(self.process.returncode==0,"websocket fixture cleanup failed")
  self.process.stdout.close();self.stderr.seek(0);errors=self.stderr.read();self.stderr.close()
  expect(errors=="",errors)
  for item in self.snapshot()["sessions"].values():
   try:os.kill(item["pid"],0)
   except ProcessLookupError:continue
   raise AssertionError("fixture child still exists")

def main():
 ids=["railway.preparation.pin","railway.preparation.valid-reference","railway.preparation.environment-affinity",
      "railway.preparation.region-affinity","railway.preparation.changed-content","railway.preparation.id-and-key",
      "railway.preparation.disk-only","railway.preparation.fresh-enrollment","railway.preparation.copied-boot-refused",
      "railway.preparation.restore-content","railway.preparation.restore-region","railway.preparation.real-checkpoint-lookup",
      "railway.preparation.checkpoint-id-not-key","railway.preparation.ambiguous-key","railway.preparation.cross-environment-key",
      "railway.preparation.no-mutation","railway.preparation.bounded-response-stream",
      "railway.preparation.lock-before-quiescence","railway.preparation.quiescence-through-capture",
      "railway.preparation.release-on-refusal","railway.preparation.pinned-sdk-template","railway.preparation.recipe-mismatch"]
 if sys.argv[1:]==["--inventory"]:print(json.dumps(ids));return 0
 complete=False
 with tempfile.TemporaryDirectory(prefix="hyperfide-railway91-") as folder:
  fixture=Fixture(folder);service=Service(folder,fixture)
  try:
   def describe():
    value=result(service.call("9.1","railway.preparation.describe",{}))
    expect(value["sdk"]["sdk_version"]=="3.16.0" and value["clone"]=="DISK_ONLY" and
           value["enrollment"]=="FRESH_REQUIRED" and value["authority"]=="NONE",value)
   check(ids[0],describe)
   payload={"base":base(),"scope":clone(SCOPE),"preparation_digest":DIGEST}
   check(ids[1],lambda:expect(result(service.call("9.1","railway.preparation.reference.verify",payload))["valid"] is True,"valid reference"))
   for identity,path,value in [(ids[2],["base","scope","environment_id"],"other-env"),(ids[3],["base","scope","region"],"other-region"),
                              (ids[4],["preparation_digest"],OTHER),(ids[5],["base","checkpoint","id"],""),(ids[6],["base","disk_only"],False)]:
    check(identity,lambda path=path,value=value:reject(service.call("9.1","railway.preparation.reference.verify",alter(payload,path,value))))
   restore=payload|{"child":{"native_sandbox_id":"new-sandbox","boot_id":"new-boot","environment_id":"environment-1",
                             "region":"region-1","preparation_digest":DIGEST}}
   check(ids[7],lambda:expect(result(service.call("9.1","railway.preparation.restore.observe",restore))==
       {"enrollment_required":True,"process_memory_restored":False,"authority":"NONE","boot_id":"new-boot"},"fresh restore"))
   for identity,path,value in [(ids[8],["child","boot_id"],"boot-source-1"),(ids[9],["child","preparation_digest"],OTHER),
                              (ids[10],["child","region"],"other-region")]:
    check(identity,lambda path=path,value=value:reject(service.call("9.1","railway.preparation.restore.observe",alter(restore,path,value))))
   lookup=lambda:result(service.call("9.1","railway.preparation.checkpoint.resolve",{"key":"checkpoint-key-1"}))
   check(ids[11],lambda:expect(lookup()["mode"]=="component-fixture","fixture provenance"))
   check(ids[12],lambda:expect(lookup()["id"]=="checkpoint-ID-1" and lookup()["key"]=="checkpoint-key-1","ID/key distinction"))
   fixture.state["mode"]="checkpoint-duplicate"
   check(ids[13],lambda:reject(service.call("9.1","railway.preparation.checkpoint.resolve",{"key":"checkpoint-key-1"})))
   fixture.state["mode"]="checkpoint-wrong-env"
   check(ids[14],lambda:reject(service.call("9.1","railway.preparation.checkpoint.resolve",{"key":"checkpoint-key-1"})))
   check(ids[15],lambda:expect(all("mutation" not in row["query"] for row in fixture.requests),"unexpected mutation"))
   fixture.state["mode"]="normal"
   preparation=__import__("importlib").import_module("11_1")
   prep=preparation.Fixture(Path(folder)/"prepared-input")
   pinned_recipe={"commands":["printf prepared"],"build_env":{"BUILD_MODE":"release"}}
   (prep.candidate/"recipe.sh").write_text(json.dumps(pinned_recipe))
   prep.profile["recipe"]=prep.pin("recipe.sh")
   manifest=prep.create()
   input_path=Path(folder)/"capture-input.json"
   input_path.write_text(json.dumps({"config":fixture.config,"manifest":manifest,"scope":SCOPE,
      "allowed_root":str(prep.allowed),"policy":json.loads(prep.policy_file.read_text()),"scan_policy":preparation.SCAN,
      "recipe":pinned_recipe}))
   script=r"""
import fs from 'node:fs';
import {RailwayClient,capturePreparedBase,buildRailwayTemplate} from './services/hyperfide/dist/providers/railway/preparation.js';
const data=JSON.parse(fs.readFileSync(process.argv[1])),events=[];
const ctx={role:'provisioner',policy:data.policy,signal:new AbortController().signal,
 env:{...process.env,HF_PREPARATION_ALLOWED_ROOT:data.allowed_root}};
const client=new RailwayClient(data.config,{HF_RAILWAY_FIXTURE_TOKEN:'fixture'});
const hooks={
 withPreparationLock:async(digest,fn)=>{events.push('waiting');await new Promise(r=>setTimeout(r,5));events.push('locked');
  try{return await fn();}finally{events.push('unlocked');}},
 quiesceAndVerify:async()=>{if(events.at(-1)!=='locked')throw new Error('quiescence ran before lock');events.push('quiesced');
  return {boot_id:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),preparation_digest:data.manifest.digest,
   assertHeld:async()=>{events.push('held');},release:async()=>{events.push('released');}};},
 persistCheckpoint:async()=>{events.push('persisted');}
};
await capturePreparedBase(client,{sandbox_id:'source-sandbox',scope:data.scope,manifest:data.manifest,
 candidate_path:'candidate',scan_policy:data.scan_policy},ctx,hooks);
const good=[...events];events.length=0;
let rejected=false;
try{await capturePreparedBase(client,{sandbox_id:'source-sandbox',scope:data.scope,manifest:data.manifest,
 candidate_path:'candidate',scan_policy:data.scan_policy},ctx,{...hooks,quiesceAndVerify:async()=>{
  events.push('quiesced');return {boot_id:'fixture-boot',preparation_digest:data.manifest.digest,
   assertHeld:async()=>{throw new Error('authenticated fence lost');},release:async()=>{events.push('released');}};
 }});}catch{rejected=true;}
await buildRailwayTemplate(client,{candidate_path:'candidate',manifest:data.manifest,scan_policy:data.scan_policy,
 scope:data.scope,...data.recipe},ctx);
let recipeRejected=false;
try{await buildRailwayTemplate(client,{candidate_path:'candidate',manifest:data.manifest,scan_policy:data.scan_policy,
 scope:data.scope,commands:['unapproved command'],build_env:data.recipe.build_env},ctx);}catch{recipeRejected=true;}
let pulled=0,cancelled=false;
const tooLarge=new RailwayClient(data.config,{HF_RAILWAY_FIXTURE_TOKEN:'fixture'},async()=>new Response(new ReadableStream({
 pull(controller){pulled++;if(pulled>400)controller.close();else controller.enqueue(new Uint8Array(65536));},
 cancel(){cancelled=true;}
},{highWaterMark:0})));
let largeRejected=false;try{await tooLarge.request('query Fixture',{});}catch{largeRejected=true;}
process.stdout.write(JSON.stringify({good,rejected,failureEvents:events,recipeRejected,largeRejected,pulled,cancelled}));
"""
   command=subprocess.run(["node","--input-type=module","-e",script,str(input_path)],cwd=ROOT,capture_output=True,text=True,timeout=40)
   expect(command.returncode==0,command.stderr)
   observed=json.loads(command.stdout)
   check(ids[16],lambda:expect(observed["largeRejected"] and observed["cancelled"] and observed["pulled"]<400,
      "oversized response was fully consumed"))
   check(ids[17],lambda:expect(observed["good"][:3]==["waiting","locked","quiesced"],"quiescence before lock"))
   check(ids[18],lambda:expect(observed["good"]==["waiting","locked","quiesced","held","held","persisted","released","unlocked"],
      "quiescence/fence not held through capture"))
   check(ids[19],lambda:expect(observed["rejected"] and observed["failureEvents"]==["waiting","locked","quiesced","released","unlocked"],
      "failed fence was not released"))
   check(ids[20],lambda:expect(any("sandboxTemplateBuild" in row["query"] for row in fixture.requests),"pinned SDK build absent"))
   check(ids[21],lambda:expect(observed["recipeRejected"],"unapproved recipe execution"))
   service.close();fixture.close();complete=True
  finally:
   if service.process.poll() is None:service.process.kill();service.process.wait()
   if not complete:fixture.close()
   print(json.dumps({"type":"cleanup","resources":[],"complete":complete}),flush=True)
 return 1 if FAILED or not complete else 0
if __name__=="__main__":sys.exit(main())
