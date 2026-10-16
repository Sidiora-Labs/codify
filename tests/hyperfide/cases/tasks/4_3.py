#!/usr/bin/env python3
"""Actual signed packet reads against owned PostgreSQL physical replication.

The trusted operator grants only pg_catalog topology observation functions.
Accepted packet inputs come from the real hierarchy fixture and registered API.
No replica read grants ownership, publication, or execution authority.
"""
from __future__ import annotations
import concurrent.futures,copy,hashlib,hmac,importlib.util,json,os,re,socket,subprocess,sys,time
from pathlib import Path
from urllib.parse import parse_qsl,urlencode,urlsplit,urlunsplit
ROOT=Path(__file__).resolve().parents[4]
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
packets=module("hf43_packets",ROOT/"tests/hyperfide/cases/tasks/3_2.py")
physical=module("hf43_physical",ROOT/"tests/hyperfide/cases/support/postgres_cluster.py")
FAILED=[];IDS=[];OBS=[]
RESOURCE="hf-task-4.3-postgres"
def expect(value,message):
 if not value:raise AssertionError(message)
def check(identity,operation):
 IDS.append(identity)
 try:operation();actual="observed"
 except Exception as error:FAILED.append(identity);actual=type(error).__name__+": "+str(error)
 print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False)
def sha(data):return "sha256:"+hashlib.sha256(data).hexdigest()
def output():
 p=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/task43-direct"))/"replica43";p.mkdir(parents=True,exist_ok=True);return p
def socket_up(path):
 with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as s:
  s.settimeout(.2)
  try:s.connect(str(path));return True
  except (FileNotFoundError,ConnectionRefusedError,socket.timeout):return False
def cleanup():
 ledger=output()/"resources.json"
 if not ledger.exists():
  print(json.dumps({"type":"cleanup","complete":True,"resources":[]}));return 0
 item=json.loads(ledger.read_text());root=Path(item["root"])
 expect(str(root).startswith("/tmp/hyperfide/hf-pg-") and "/" not in root.name,"owned cluster root malformed")
 absent=not root.exists() and not any(socket_up(Path(p)) for p in item["sockets"])
 result={"root_absent":not root.exists(),"sockets_unreachable":not any(socket_up(Path(p)) for p in item["sockets"])}
 (output()/"absence.json").write_text(canonical(result)+"\n")
 print(json.dumps({"type":"cleanup","complete":absent,"resources":[{"id":RESOURCE,"status":"deleted" if absent else "unknown","observed_absent":absent,"evidence_artifact":"replica43/absence.json"}]}),flush=True)
 return 0 if absent else 1
def routed(url,path):
 u=urlsplit(url);q=dict(parse_qsl(u.query));q["host"]=str(path);return urlunsplit((u.scheme,u.netloc,u.path,urlencode(q),u.fragment))
class Fixture:
 def __init__(self):
  self.c=None;self.f=None;self.promoted=False
  try:
   self.c=physical.PostgresCluster();c=self.c
   (output()/"resources.json").write_text(canonical({"resource_id":RESOURCE,"root":str(c.root),"sockets":[str(c.socket/(".s.PGSQL."+str(c.port))),str(c.replica_socket/(".s.PGSQL."+str(c.port)))]})+"\n")
   original={k:os.environ.get(k) for k in ("DATABASE_URL","PGHOST","PGPORT","PGUSER")}
   os.environ.update(DATABASE_URL=c.url(),PGHOST=str(c.socket),PGPORT=str(c.port),PGUSER="hf_operator")
   self.repo=c.root/"source";self.repo.mkdir();self.scratch=c.root/"graph-scratch";self.scratch.mkdir()
   def git(*args):return subprocess.check_output(["git",*args],cwd=self.repo,stderr=subprocess.PIPE,text=True).strip()
   git("init","-q");git("config","user.name","Hyperfide component fixture");git("config","user.email","fixture@example.invalid")
   git("config","maintenance.auto","false");git("config","gc.auto","0");git("config","gc.autoDetach","false")
   (self.repo/"owned.c").write_text("/* @contract Preserve the value. */\nint value(int input) { return input + 1; }\nint consume(void) { return value(2); }\n")
   git("add","owned.c");git("commit","-qm","pin native replica source")
   self.commit=git("rev-parse","HEAD");self.tree=git("rev-parse","HEAD^{tree}")
   config=c.root/"graph.json"
   def setup(f):
    config.write_text(canonical({"schema_version":1,"execution_role":"REMOTE","scratch_root":str(self.scratch),"cg_binary":str(ROOT/"cg"),"cg_digest":sha((ROOT/"cg").read_bytes()),"repositories":{f.ids["repository"]:str(self.repo)},"max_total_bytes":8388608,"max_rows":10000,"chunk_bytes":131072}))
   try:self.f=packets.PacketFixture(extra_components=("4.3","7.1"),extra_setup=setup,source_object_id=self.commit,extra_env={"HYPERFIDE_CAUSAL_BARRIER_KEY":os.urandom(32).hex(),"HYPERFIDE_GRAPH_CONFIG":str(config)})
   finally:
    for key,value in original.items():
     if value is None:os.environ.pop(key,None)
     else:os.environ[key]=value
   f=self.f
   created=f.create_packet();self.created={k:created[k] for k in ("packet_id","digest","mandatory_digest","packet")};self.digest=self.created["digest"];self.authority_snapshot=f.snapshot()
   self.runtime_version=c.sql("SELECT version()")
   # This is explicit operator setup, not a runtime role elevation.
   f.sql("REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_system(),pg_catalog.pg_control_checkpoint() FROM PUBLIC")
   f.sql('GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system(),pg_catalog.pg_control_checkpoint() TO "'+f.runtime_role+'"')
   self.graph1=self.publish_graph("1","0");self.graph_packet1=self.graph_packet(self.graph1,"1")
   self.graph2=self.publish_graph("2","1");self.graph_packet2=self.graph_packet(self.graph2,"2")
   self.authority_snapshot=f.snapshot()
   self.barrier=self.ok("storage.packet.barrier",{"digest":self.digest})
   self.graph_barrier1=self.ok("storage.packet.barrier",{"digest":self.graph_packet1["digest"]})
   self.graph_barrier2=self.ok("storage.packet.barrier",{"digest":self.graph_packet2["digest"]})
   c.replicate()
   f.stop();f.env["HYPERFIDE_CONTROL_REPLICA_DATABASE_URL"]=routed(f.runtime_url,c.replica_socket);f.start()
  except BaseException:
   self.close();raise
 def graph(self,component,action,value):
  return self.f.ok(action,value,key="operator",component=component)
 def publish_graph(self,generation,expected):
  f=self.f;i=f.ids
  scoped=lambda **v:dict(organisation_id=i["organisation"],run_id=i["run"],authority_epoch=i["epoch"],**v)
  manifest=self.graph("7.1","graph.extract.create",dict(organisation_id=i["organisation"],run_id=i["run"],repository_id=i["repository"],commit=self.commit,tree=self.tree,generation=generation,configuration={"build_flags":[],"resolver_digest":sha(b"replica-native-resolver"),"generated_manifest_digest":sha(b"replica-native-generated")}))
  expect(manifest["complete"] is True and manifest["identity"]["commit"]==self.commit,"Actual scanner source mismatch")
  build=self.graph("7.2","graph.ingest.create",scoped(bundles=[manifest]))["build_id"]
  for n in range(len(manifest["chunks"])):
   chunk=self.graph("7.1","graph.extract.read-chunk",{"bundle_digest":manifest["bundle_digest"],"index":n})
   self.graph("7.2","graph.ingest.chunk",scoped(build_id=build,bundle_digest=manifest["bundle_digest"],chunk=chunk))
  self.graph("7.2","graph.ingest.seal",scoped(build_id=build))
  for _ in range(100):
   if self.graph("7.2","graph.ingest.resolve",scoped(build_id=build,limit=32))["state"]=="READY":break
  else:raise AssertionError("Actual graph resolution did not finish")
  return self.graph("7.3","graph.publish.commit",scoped(build_id=build,channel="replica-packet",expected_generation=expected,operation_id=packets.uid()))
 def graph_packet(self,manifest,label):
  f=self.f;i=f.ids;task=packets.uid();criteria=sha(("replica-required-graph-"+label).encode())
  definition=copy.deepcopy(f.packet_definition);definition["graph_inputs"]={"required":True,"manifest_id":manifest["manifest_id"],"reason":None}
  f.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) VALUES($1,$2,$3,$4,$5,$6,$7,$8,2)",[i["organisation"],i["run"],task,"alpha.replica-graph-"+label,i["package2"],i["spec"],criteria,json.dumps(definition)])
  policy=copy.deepcopy(f.packet_proof);policy["criteria_digest"]=criteria
  f.sql("INSERT INTO hyperfide.proof_registries(organisation_id,run_id,task_id,spec_generation,spec_revision_id,criteria_digest,registry_digest,policy) VALUES($1,$2,$3,1,$4,$5,$6,$7)",[i["organisation"],i["run"],task,i["spec"],criteria,packets.identity(policy),json.dumps(policy)])
  made=f.create_packet(task_id=task,idempotency_key="replica-required-graph-"+label)
  return {k:made[k] for k in ("packet_id","digest","mandatory_digest","packet")}
 def request(self,action,value,key="manager"):
  status,response=self.f.invoke(action,value,component="4.3",key=key)
  OBS.append({"action":action,"http_status":status,"ok":response.get("ok"),"code":response.get("error",{}).get("code")})
  return status,response
 def ok(self,action,value,key="manager"):
  status,response=self.request(action,value,key)
  expect(status==200 and response.get("ok") is True,"Actual signed packet route refused: "+json.dumps(response.get("error",{})))
  return response["result"]
 def reject(self,action,value,code=None,key="manager"):
  _,response=self.request(action,value,key);expect(response.get("ok") is False,"Invalid signed packet read succeeded")
  if code:expect(response.get("error",{}).get("code")==code,"Expected "+code+", observed "+json.dumps(response))
  return response
 def read(self,**overrides):return self.ok("storage.packet.read",dict(digest=self.digest,barrier=self.barrier,**overrides))
 def signed_barrier(self,**changes):
  b=dict(self.barrier,**changes)
  names=["schema_version","deployment_id","system_id","timeline","authority_epoch","organisation_id","run_id","digest","lsn","issued_at","expires_at"]
  payload=json.dumps([[n,b[n]] for n in names],separators=(",",":"),ensure_ascii=False)
  b["signature"]=hmac.new(bytes.fromhex(self.f.env["HYPERFIDE_CAUSAL_BARRIER_KEY"]),("HYPERFIDE-CAUSAL-BARRIER-V1\n"+payload).encode(),hashlib.sha256).hexdigest();return b
 def promote(self):
  f=self.f;c=self.c;f.stop();c.stop(c.primary);c.promote();self.promoted=True
  f.url=routed(f.url,c.replica_socket);f.base_url=routed(f.base_url,c.replica_socket);f.runtime_url=routed(f.runtime_url,c.replica_socket)
  f.env["DATABASE_URL"]=f.runtime_url
  for role in ("CONTROL","PROVISIONER","DISPATCH"):f.env["HYPERFIDE_"+role+"_PRIMARY_DATABASE_URL"]=f.runtime_url
  f.start()
 def close(self):
  error=None
  if self.f:
   try:self.f.close()
   except BaseException as e:error=e
   finally:self.f=None
  if self.c:
   try:
    expect(self.c.close(),"Owned physical PostgreSQL cluster remains")
    (output()/"cluster-commands.json").write_text(canonical(self.c.logs)+"\n")
   finally:self.c=None
  if error:raise error
def main():
 f=None;state={}
 try:
  check("replica.fixture.real-signed-packet-and-physical-standby",lambda:state.update(fixture=Fixture()))
  if "fixture" not in state:return 1
  f=state["fixture"]
  def replica():
   state["replica"]=f.read();r=state["replica"]
   expect(r["route"]=="replica" and r["freshness"]=="causal-snapshot","Actual physical standby route not selected")
   expect(r["packet"]==f.created and r["packet"]["digest"]==f.digest,"Replica substituted packet content")
   expect(r["authority"]=="NONE" and r["execution_authority"] is False,"Snapshot granted authority")
   expect(r["replica_evidence"]["checked_before_snapshot"] is True,"Replay check did not precede snapshot")
  check("replica.causal-exact-packet",replica)
  check("replica.actual-snapshot-watermark",lambda:expect(state["replica"]["snapshot"] and state["replica"]["replica_evidence"]["replay_lsn"],"Snapshot/replay provenance missing"))
  check("replica.primary-request-keeps-immutable-packet",lambda:expect(f.read(preferReplica=False)["packet"]==f.created,"Primary changed packet"))
  check("replica.no-barrier-falls-back-explicitly",lambda:expect(f.ok("storage.packet.read",{"digest":f.digest})["fallback"]=="barrier-required-for-replica","Unbarriered request used implicit replica"))
  check("replica.reject-absent-packet",lambda:f.reject("storage.packet.read",{"digest":sha(b"missing-packet"),"barrier":f.barrier},"PACKET_UNAVAILABLE"))
  check("replica.reject-malformed-digest",lambda:f.reject("storage.packet.read",{"digest":"latest"},"INVALID_REQUEST"))
  check("replica.reject-tampered-signature",lambda:f.reject("storage.packet.read",{"digest":f.digest,"barrier":dict(f.barrier,signature="0"*64)},"BARRIER_INVALID"))
  check("replica.reject-foreign-run-barrier",lambda:f.reject("storage.packet.read",{"digest":f.digest,"barrier":dict(f.barrier,run_id=packets.uid())},"BARRIER_INVALID"))
  check("replica.reject-obsolete-cluster-barrier",lambda:f.reject("storage.packet.read",{"digest":f.digest,"barrier":f.signed_barrier(system_id="1")},"BARRIER_OBSOLETE"))
  check("replica.reject-expired-barrier",lambda:f.reject("storage.packet.read",{"digest":f.digest,"barrier":f.signed_barrier(issued_at="2020-01-01T00:00:00.000Z",expires_at="2020-01-01T00:01:00.000Z")},"BARRIER_EXPIRED"))
  check("replica.reject-negative-wait",lambda:f.reject("storage.packet.read",{"digest":f.digest,"waitMs":-1},"INVALID_REQUEST"))
  check("replica.reject-unavailable-graph-pin",lambda:f.reject("storage.packet.read",{"digest":f.digest,"barrier":f.barrier,"expected_graph_manifest_digest":sha(b"missing-graph")},"PACKET_PIN_MISMATCH"))
  check("replica.explicit-no-required-graph-pin",lambda:expect(f.read(expected_graph_manifest_digest=None)["packet"]==f.created,"Declared unavailable graph was relabelled"))
  def graph_exact(which):
   packet=getattr(f,"graph_packet"+which);barrier=getattr(f,"graph_barrier"+which)
   required=packet["packet"]["mandatory"]["inputs"]["graph"]
   expect(required["required"] and required["source_set"][0]["commit"]==f.commit,"Actual graph source pins missing")
   r=f.ok("storage.packet.read",{"digest":packet["digest"],"barrier":barrier,"expected_graph_manifest_digest":required["manifest_digest"]})
   expect(r["route"]=="replica" and r["packet"]==packet,"Replica changed exact graph generation")
  check("replica.native-graph-generation-one-remains-pinned",lambda:graph_exact("1"))
  check("replica.native-graph-generation-two-remains-pinned",lambda:graph_exact("2"))
  def graph_mixed():
   expected=f.graph_packet2["packet"]["mandatory"]["inputs"]["graph"]["manifest_digest"]
   f.reject("storage.packet.read",{"digest":f.graph_packet1["digest"],"barrier":f.graph_barrier1,"expected_graph_manifest_digest":expected},"PACKET_PIN_MISMATCH")
  check("replica.native-mixed-graph-generation-refused",graph_mixed)
  check("replica.native-graph-post-error-snapshot-clean",lambda:graph_exact("1"))
  check("replica.reject-other-manager-scope",lambda:f.reject("storage.packet.read",{"digest":f.digest,"barrier":f.barrier},key="manager2"))
  check("replica.reject-provider-role",lambda:f.reject("storage.packet.read",{"digest":f.digest,"barrier":f.barrier},code="ROLE_DENIED",key="provisioner"))
  def privilege():
   role=f.f.runtime_role
   f.f.sql('REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_system() FROM "'+role+'"')
   try:
    expect(f.f.sql("SELECT has_function_privilege($1,'pg_catalog.pg_control_system()','EXECUTE') AS allowed",[role])[0]["allowed"] is False,"Negative fixture retained an effective topology privilege")
    f.reject("storage.packet.barrier",{"digest":f.digest},"TOPOLOGY_PRIVILEGE_REQUIRED")
   finally:f.f.sql('GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO "'+role+'"')
  check("replica.missing-runtime-topology-privilege-explicit",privilege)
  def lag():
   f.c.sql("SELECT pg_wal_replay_pause()",replica=True)
   expect(f.c.sql("SELECT pg_is_wal_replay_paused()",replica=True)=="t","Standby replay was not actually paused")
   created=f.f.create_packet(idempotency_key="replica-lag-new",attempt_id=packets.uid());state["new"]={k:created[k] for k in ("packet_id","digest","mandatory_digest","packet")}
   state["new_barrier"]=f.ok("storage.packet.barrier",{"digest":state["new"]["digest"]})
   r=f.ok("storage.packet.read",{"digest":state["new"]["digest"],"barrier":state["new_barrier"],"waitMs":25})
   expect(r["route"]=="primary" and r["fallback"]=="REPLICA_LAG","Actual lag did not cause explicit primary fallback")
   expect(r["packet"]==state["new"],"Lag fallback mixed immutable packets")
  check("replica.real-paused-replay-fallback",lag)
  def wait():
   def resume():time.sleep(.75);f.c.sql("SELECT pg_wal_replay_resume()",replica=True)
   with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
    resumed=pool.submit(resume)
    r=f.ok("storage.packet.read",{"digest":state["new"]["digest"],"barrier":state["new_barrier"],"waitMs":2000})
    resumed.result(timeout=5)
   expect(r["route"]=="replica" and r["packet"]==state["new"],"Replay recovery did not yield exact replica snapshot")
   expect(r["replica_evidence"]["observations"]>1,"No actual replay wait was observed")
   OBS.append({"observation":"actual-replay-wait","evidence":r["replica_evidence"]})
  check("replica.wait-before-snapshot-real-resume",wait)
  check("replica.reject-barrier-for-different-packet",lambda:f.reject("storage.packet.read",{"digest":state["new"]["digest"],"barrier":f.barrier},"BARRIER_INVALID"))
  check("replica.old-packet-stays-old-after-new-packet",lambda:expect(f.read()["packet"]==f.created,"Latest packet was silently substituted"))
  def unavailable():
   f.f.stop();original=f.f.env["HYPERFIDE_CONTROL_REPLICA_DATABASE_URL"]
   f.f.env["HYPERFIDE_CONTROL_REPLICA_DATABASE_URL"]=routed(original,f.c.root/"missing-socket");f.f.start()
   try:
    r=f.read();expect(r["route"]=="primary" and r["packet"]==f.created and r["fallback"],"Unavailable replica did not explicitly fall back")
   finally:f.f.stop();f.f.env["HYPERFIDE_CONTROL_REPLICA_DATABASE_URL"]=original;f.f.start()
  check("replica.unavailable-route-falls-back-primary",unavailable)
  def promoted():
   f.promote();f.reject("storage.packet.read",{"digest":f.digest,"barrier":f.barrier},"BARRIER_OBSOLETE")
  check("replica.real-promotion-invalidates-old-timeline-barrier",promoted)
  def promoted_fallback():
   fresh=f.ok("storage.packet.barrier",{"digest":f.digest})
   expect(fresh["timeline"]!=f.barrier["timeline"],"Actual promotion did not change timeline")
   r=f.ok("storage.packet.read",{"digest":f.digest,"barrier":fresh})
   expect(r["route"]=="primary" and r["fallback"]=="REPLICA_REQUIRED" and r["packet"]==f.created,"Promoted route was treated as read replica or changed packet")
  check("replica.promoted-read-endpoint-refused-and-primary-fallback",promoted_fallback)
  def nonowner():
   row=f.f.sql("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname=$1",[f.f.runtime_role])[0]
   expect(not any(row.values()),"Read runtime was elevated to an operator")
  check("replica.runtime-remains-nonoperator",nonowner)
  check("replica.reads-do-not-mutate-work-authority",lambda:expect(f.f.snapshot()==f.authority_snapshot,"Packet reads changed task/attempt/lease/session/custody/finding authority"))
  (output()/"observations.json").write_text(canonical({"scope":"task-component","postgres":f.runtime_version,"barrier":f.barrier,"observations":OBS,"assertion_count":len(IDS),"failures":FAILED,"physical_replication":True,"authority":"NONE","failover_scope":"Actual isolated promotion tests topology invalidation; production writer fencing remains separate4.4 qualification"})+"\n")
  return 1 if FAILED else 0
 finally:
  if f:f.close()
if __name__=="__main__":raise SystemExit(cleanup() if "--cleanup" in sys.argv else main())
