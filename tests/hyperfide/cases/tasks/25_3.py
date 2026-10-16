#!/usr/bin/env python3
"""Observe native CLI/MCP against actual signed HTTPS/PostgreSQL authority. Synthetic data only."""
import json,os,subprocess,tempfile,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4];FAILED=[];IDS=[];CLEANUP=[]
def artifacts():
 p=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/domain25-client-tests"))/"client";p.mkdir(parents=True,exist_ok=True);return p
def cleanup():
 file=artifacts()/"cleanup.json";records=json.loads(file.read_text()) if file.is_file() else []
 complete=len(records)==4 and all(r.get("observed_absent") is True for r in records)
 print(json.dumps({"type":"cleanup","complete":complete,"resources":[{"id":r["id"],"status":"deleted" if r["observed_absent"] else "unknown","observed_absent":r["observed_absent"],"evidence_artifact":"client/cleanup.json"} for r in records]}));return 0 if complete else 1
def close_fixture(f,resource):
 import socket
 database=f.database;role=f.runtime_role;port=f.port;root=f.path
 f.close()
 absent=not f.sql("SELECT datname FROM pg_database WHERE datname=$1",[database],admin=True) and not f.sql("SELECT rolname FROM pg_roles WHERE rolname=$1",[role],admin=True)
 with socket.socket() as sock:sock.settimeout(1);listener_absent=sock.connect_ex(("127.0.0.1",port))!=0
 CLEANUP.append({"id":resource,"observed_absent":bool(absent and listener_absent and not root.exists()),"database_observed_absent":bool(absent),"https_observed_absent":listener_absent,"private_root_observed_absent":not root.exists()})
 expect(CLEANUP[-1]["observed_absent"],"owned native service fixture retained database/role/listener/private files")
def expect(v,m):
 if not v:raise AssertionError(m)
def check(name,fn):
 IDS.append(name)
 try:fn();actual="observed"
 except Exception as e:FAILED.append(name);actual=type(e).__name__+": "+str(e)
 print(json.dumps({"type":"assertion","id":name,"expected":"observed","actual":actual}),flush=True)
def main():
 with tempfile.TemporaryDirectory(prefix="hf-client-") as tmp:
  base=Path(tmp);distributed=base/"distributed";distributed.mkdir();plain=base/"local";plain.mkdir();(distributed/".hyperfide").mkdir()
  marker=distributed/".hyperfide/authority.json"
  descriptor={"schema_version":1,"mode":"distributed","authority_epoch":"10000000-0000-0000-0000-000000000001"}
  marker.write_text(json.dumps(descriptor));marker.chmod(0o600)
  def run(args,root=plain,mode=None,config=None):
   e=os.environ.copy()
   for key in ["HYPERFIDE_MODE","HYPERFIDE_AUTHORITY_DESCRIPTOR","DATABASE_URL","ANTHROPIC_API_KEY","OPENAI_API_KEY"]:e.pop(key,None)
   if mode is not None:e["HYPERFIDE_MODE"]=mode
   if config is not None:e["HYPERFIDE_AUTHORITY_DESCRIPTOR"]=str(config)
   return subprocess.run([str(ROOT/"cg")]+args,cwd=root,env=e,capture_output=True,text=True,timeout=20)
  def blocked(args,code,root=distributed,mode=None,config=None):
   p=run(args,root,mode,config);expect(p.returncode==78,"operation reached legacy dispatch: "+str(args))
   r=json.loads(p.stderr.strip());expect(r["error"]["code"]==code and r["local_fallback"] is False,"wrong authority refusal")
   expect(not (root/".codegraph").exists(),"legacy state created before authority check")
  check("client.local.version",lambda:expect(run(["version"]).returncode==0,"local version requires remote credentials"))
  check("client.local.help",lambda:expect(run(["help"]).returncode==0,"local help requires remote credentials"))
  check("client.offline.local-version",lambda:expect(run(["version"],mode="offline").returncode==0,"offline local version unavailable"))
  check("client.offline.local-spec",lambda:expect(run(["spec","status"],mode="offline").returncode!=78,"explicit offline local scope blocked"))
  for command in [["init"],["spec","claim","1"],["spec","done","1","--force"],["spec","run"],["mcp"],["hook","post-edit"],["work","legacy-update"],["docs","legacy-close"],["projection"],["serve"],["fleet","up"]]:
   check("client.distributed."+command[0]+("-"+command[1] if len(command)>1 else ""),lambda command=command:blocked(command,"TRANSPORT_CONFIG_REQUIRED" if command[0]=="mcp" else "DISTRIBUTED_COMMAND_UNSUPPORTED"))
  check("client.offline.remote-denied",lambda:blocked(["spec","claim","1"],"OFFLINE_AUTHORITY_UNAVAILABLE",mode="offline"))
  check("client.downgrade-denied",lambda:blocked(["spec","claim","1"],"AUTHORITY_MODE_INVALID",mode="local"))
  check("client.bad-mode",lambda:blocked(["init"],"AUTHORITY_MODE_INVALID",root=plain,mode="unknown"))
  check("client.distributed-without-descriptor",lambda:blocked(["init"],"AUTHORITY_MODE_INVALID",root=plain,mode="distributed"))
  check("client.explicit-root-denied",lambda:blocked(["spec","status","--root",str(distributed)],"DISTRIBUTED_TRANSPORT_REQUIRED",root=plain))
  check("client.explicit-descriptor",lambda:blocked(["init"],"DISTRIBUTED_COMMAND_UNSUPPORTED",root=plain,config=marker))
  marker.chmod(0o644)
  check("client.public-descriptor-denied",lambda:blocked(["init"],"AUTHORITY_MODE_INVALID"))
  marker.chmod(0o600);marker.write_text('{"schema_version":1,"mode":"distributed","mode":"local","authority_epoch":"10000000-0000-0000-0000-000000000001"}')
  check("client.duplicate-descriptor-denied",lambda:blocked(["init"],"AUTHORITY_MODE_INVALID"))
  marker.unlink();marker.symlink_to(base/"private-marker");(base/"private-marker").write_text(json.dumps(descriptor));(base/"private-marker").chmod(0o600)
  check("client.symlink-descriptor-denied",lambda:blocked(["init"],"AUTHORITY_MODE_INVALID"))
 protected_reader_checks()
 network_checks()
 mapping_checks()
 business_unknown_checks()
 check('client.cleanup.actual-absence',lambda:expect(len(CLEANUP)==4 and all(r['observed_absent'] for r in CLEANUP),'native fixture cleanup incomplete'))
 (artifacts()/'cleanup.json').write_text(json.dumps(CLEANUP,sort_keys=True))
 (artifacts()/'observations.json').write_text(json.dumps({'scope':'task-component','assertion_ids':IDS,'failed_ids':FAILED,'full_cases_qualified':False},sort_keys=True))
 return 1 if FAILED else 0


def protected_reader_checks():
 import shutil
 expect(os.geteuid()==0,"actual root-to-nonroot credential test requires isolated root worker")
 with tempfile.TemporaryDirectory(prefix="hf-protected-reader-") as temporary:
  base=Path(temporary);base.chmod(0o755);auth=base/"auth";auth.mkdir(mode=0o750);os.chown(auth,0,33025)
  source=base/"probe.c";binary=base/"probe"
  source.write_text('#include "transport.h"\n#include "client.h"\n#include <stdlib.h>\n#include <string.h>\nint main(int n,char **v){if(n!=3)return 2;if(!strcmp(v[1],"decision-invalid"))return hf_client_decision_invoke(HF_DECISION_GUARD,HF_DECISION_SUBMIT,"{}",NULL,NULL,NULL,2000,stdout,stderr)==78?0:1;char *b=0;size_t z=0;int ok=0;if(!strcmp(v[1],"read"))ok=hf_protected_read(v[2],32768,&b,&z);else if(!strcmp(v[1],"private"))ok=hf_private_read(v[2],32768,&b,&z);else if(!strcmp(v[1],"config")){HfTransportConfig c;ok=hf_transport_config(v[2],&c);}else if(!strcmp(v[1],"sign")){char sig[87];ok=hf_transport_sign(v[2],"HYPERFIDE-REQUEST-V1","/v1/invoke","https://localhost","10000000-0000-0000-0000-000000000001","1","10000000-0000-0000-0000-000000000002","{}",sig);}free(b);return ok?0:1;}\n')
  subprocess.run(["cc","-Wall","-Wextra","-Werror","-O2","-I",str(ROOT/"src/hyperfide"),str(source),str(ROOT/"src/hyperfide/transport.c"),str(ROOT/"src/hyperfide/client.c"),"-lcurl","-lcrypto","-lpthread","-o",str(binary)],check=True,capture_output=True);binary.chmod(0o755)
  def drop(gid=33025):
   os.setgroups([]);os.setresgid(gid,gid,gid);os.setresuid(33025,33025,33025)
  def run(mode,p,gid=33025):
   return subprocess.run([str(binary),mode,str(p)],preexec_fn=lambda:drop(gid),capture_output=True,timeout=10).returncode
  file=auth/"protected";file.write_text('{"canary":"protected"}');file.chmod(0o640);os.chown(file,0,33025)
  check("client.protected.nonroot-primary-gid",lambda:expect(run("read",file)==0,"root-owned primary-GID read refused"))
  check("client.decision.null-operation-refused",lambda:expect(run("decision-invalid",file)==0,"invalid decision operation reached transport or crashed"))
  check("client.protected.private-state-remains-private",lambda:expect(run("private",file)!=0,"strict supervisor state reader acquired group mode"))
  def foreign_group():
   os.chown(file,0,33026)
   try:expect(run("read",file)!=0,"foreign primary GID allowed")
   finally:os.chown(file,0,33025)
  check("client.protected.foreign-gid-refused",foreign_group)
  def supplementary_only():
   def supplemental():
    os.setgroups([33025]);os.setresgid(33026,33026,33026);os.setresuid(33025,33025,33025)
   p=subprocess.run([str(binary),"read",str(file)],preexec_fn=supplemental,capture_output=True,timeout=10)
   expect(p.returncode!=0,"supplementary GID granted credential authority")
  check("client.protected.supplementary-gid-refused",supplementary_only)
  def writable_parent():
   auth.chmod(0o770)
   try:expect(run("read",file)!=0,"group-writable credential ancestor accepted")
   finally:auth.chmod(0o750)
  check("client.protected.writable-parent-refused",writable_parent)
  def mutable_owner_parent():
   os.chown(auth,33025,33025)
   try:expect(run("read",file)!=0,"child-owned ancestor permitted root-group immutable credential replacement")
   finally:os.chown(auth,0,33025)
  check("client.protected.child-owned-parent-refused",mutable_owner_parent)
  def symlink_parent():
   moved=base/"auth-real";auth.rename(moved);auth.symlink_to(moved,target_is_directory=True)
   try:expect(run("read",file)!=0,"symlink credential ancestor accepted")
   finally:auth.unlink();moved.rename(auth)
  check("client.protected.symlink-parent-refused",symlink_parent)
  def hardlink():
   link=auth/"alias";os.link(file,link)
   try:expect(run("read",file)!=0,"hardlinked credential accepted")
   finally:link.unlink()
  check("client.protected.hardlinked-file-refused",hardlink)
  key=auth/"key.pem"
  subprocess.run(["openssl","genpkey","-algorithm","ED25519","-out",str(key)],check=True,capture_output=True);key.chmod(0o640);os.chown(key,0,33025)
  config=auth/"config.json";config.write_text(json.dumps({"origin":"https://localhost","key_path":str(key),"credential_id":"10000000-0000-0000-0000-000000000001","run_id":"10000000-0000-0000-0000-000000000004"}));config.chmod(0o640);os.chown(config,0,33025)
  check("client.protected.transport-config-nonroot",lambda:expect(run("config",config)==0,"actual transport config did not use protected reader"))
  def malformed_run_context():
   original=config.read_bytes();value=json.loads(original);value["run_id"]="invented-env-run";config.write_text(json.dumps(value))
   try:expect(run("config",config)!=0,"noncanonical protected run context accepted")
   finally:config.write_bytes(original)
  check("client.protected.transport-run-context-refused",malformed_run_context)
  check("client.protected.signing-key-nonroot",lambda:expect(run("sign",key)==0,"actual Ed25519 signing key did not use protected reader"))
  key.chmod(0o660)
  check("client.protected.signing-key-write-refused",lambda:expect(run("sign",key)!=0,"group-writable signing key accepted"));key.chmod(0o640)
  child=base/"child";child.mkdir(mode=0o700);os.chown(child,33025,33025);owned=child/"private";owned.write_text("private");owned.chmod(0o600);os.chown(owned,33025,33025)
  check("client.protected.owner-private-preserved",lambda:expect(run("read",owned)==0,"existing actualowner0600 contract broken"))
  native=base/"cg";shutil.copyfile(ROOT/"cg",native);native.chmod(0o755)
  marker=auth/"authority.json";marker.write_text(json.dumps({"schema_version":1,"mode":"distributed","authority_epoch":"10000000-0000-0000-0000-000000000001"}));marker.chmod(0o640);os.chown(marker,0,33025)
  policy=auth/"mcp.json";policy.write_text(json.dumps({"schema_version":1,"allowed_tools":["spec_status"],"bootstrap_catalog":True,"target_session_id":"10000000-0000-0000-0000-000000000003","run_id":"10000000-0000-0000-0000-000000000004","target_role":"LEADER"}));policy.chmod(0o640);os.chown(policy,0,33025)
  environment={k:v for k,v in os.environ.items() if not k.startswith(("HYPERFIDE_","CG_","CODIFY_"))};environment.update(HYPERFIDE_MODE="distributed",HYPERFIDE_AUTHORITY_DESCRIPTOR=str(marker),HYPERFIDE_MCP_TOOL_POLICY_FILE=str(policy),HYPERFIDE_TRANSPORT_CONFIG=str(auth/"pending-transport.json"))
  def catalog():
   requests=[{"jsonrpc":"2.0","id":1,"method":"tools/list"},{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"spec_status","arguments":{"input":{},"run_id":"10000000-0000-0000-0000-000000000004","operation_id":"10000000-0000-0000-0000-000000000005","idempotency_key":"10000000-0000-0000-0000-000000000006","correlation_id":"10000000-0000-0000-0000-000000000007"}}}]
   p=subprocess.run([str(native),"mcp"],cwd=base,env=environment,preexec_fn=drop,input="".join(json.dumps(r)+"\n" for r in requests),text=True,capture_output=True,timeout=15)
   replies=[json.loads(line) for line in p.stdout.splitlines()]
   expect(p.returncode==0 and [t["name"] for t in replies[0]["result"]["tools"]]==["spec_status"],"actual nonroot catalog could not read immutable root policy: "+str((p.returncode,p.stdout,p.stderr)))
   expect(replies[1]["result"]["isError"] is True,"bootstrap catalog granted an unattached target credential")
   expect(not (base/".codegraph").exists(),"nonroot distributed bridge reached local SQLite")
  check("client.protected.mcp-nonroot-root-policy",catalog)

def network_checks():
 sys.path.insert(0,str(ROOT/"tests/hyperfide/support"))
 from identity_fixture import IdentityFixture,uid,sha
 fixture=IdentityFixture()
 try:
  config=fixture.path/"native-transport.json"
  config.write_text(json.dumps({"origin":fixture.origin,"ca_file":str(fixture.ca),"key_path":str(fixture.keys["operator"]["path"]),"credential_id":fixture.ids["operator"],"timeout_ms":5000}));config.chmod(0o600)
  environment=os.environ.copy();environment["HYPERFIDE_TRANSPORT_CONFIG"]=str(config);environment.pop("HYPERFIDE_MODE",None);environment.pop("HYPERFIDE_AUTHORITY_DESCRIPTOR",None)
  def invoke(action,value,operation=None):
   operation=operation or fixture.operation("14.1",action,value)
   payload=json.loads(__import__("base64").urlsafe_b64decode(operation["payload_b64"]+"=="))
   filename=fixture.path/"native-payload.json";filename.write_text(json.dumps(payload))
   args=[str(ROOT/"cg"),"authority","invoke","--payload-file",str(filename),"--operation-id",operation["operation_id"],"--idempotency-key",operation["idempotency_key"],"--correlation-id",operation["correlation_id"]]
   process=subprocess.run(args,cwd=fixture.path,env=environment,capture_output=True,text=True,timeout=15)
   return process,json.loads(process.stdout) if process.stdout.strip() else None,operation,args
  def describe():
   p,r,op,_=invoke("identity.describe",{})
   expect(p.returncode==0 and r["ok"] is True and r["operation_id"]==op["operation_id"],"real signed native call failed")
   expect(r["result"]["principal"]["credential_id"]==fixture.ids["operator"],"native response lost authenticated principal")
   expect(fixture.sql("SELECT credential_id FROM hyperfide.identity_principals WHERE credential_id=$1",[fixture.ids["operator"]])[0]["credential_id"]==r["result"]["principal"]["credential_id"],"native response does not match actual DB")
  check("client.https.real-principal",describe)
  status,binding=fixture.bind();expect(status==200 and binding["ok"],"real provider binding fixture failed")
  grant=uid();value={"grant_id":grant,"provisioning_intent_id":fixture.ids["intent"],"verifier":sha(fixture.secret),"allowed_actions":["identity.describe"],"ttl_seconds":300}
  op=fixture.operation("14.1","identity.grant.issue",value)
  saved={}
  def mutate():
   p,r,_,args=invoke("identity.grant.issue",value,op);saved.update(response=r,args=args)
   expect(p.returncode==0 and r["ok"] is True,"native authenticated mutation failed")
   expect(len(fixture.sql("SELECT id FROM hyperfide.identity_enrollment_grants WHERE id=$1",[grant]))==1,"signed native mutation did not commit")
  check("client.https.real-database-mutation",mutate)
  def replay():
   p,r,_,_=invoke("identity.grant.issue",value,op)
   expect(p.returncode==0 and r["result"]==saved["response"]["result"],"stable native operation replay changed result")
   expect(len(fixture.sql("SELECT id FROM hyperfide.identity_enrollment_grants WHERE id=$1",[grant]))==1,"replay duplicated effect")
  check("client.https.idempotent-replay",replay)
  def wrong_origin():
   environment["HYPERFIDE_AUTHORITY_URL"]="https://wrong.invalid"
   p,_,_,_=invoke("identity.describe",{})
   expect(p.returncode==78 and json.loads(p.stderr)["error"]["code"]=="AUTHORITY_ORIGIN_CONFLICT","origin conflict was sent")
   environment.pop("HYPERFIDE_AUTHORITY_URL",None)
  check("client.https.origin-conflict",wrong_origin)

  def mcp():
   marker=fixture.path/"authority.json";marker.write_text(json.dumps({"schema_version":1,"mode":"distributed","authority_epoch":fixture.ids["epoch"]}));marker.chmod(0o600)
   e=environment.copy();e["HYPERFIDE_MODE"]="distributed";e["HYPERFIDE_AUTHORITY_DESCRIPTOR"]=str(marker)
   payload={"run_id":fixture.ids["run"],"component":"14.1","action":"identity.describe","input":{},"expected_version":None,"authority":None}
   requests=[{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}},{"jsonrpc":"2.0","id":2,"method":"tools/list"},{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"authority_invoke","arguments":{"payload":payload,"operation_id":uid(),"idempotency_key":uid(),"correlation_id":uid()}}}]
   p=subprocess.run([str(ROOT/"cg"),"mcp"],cwd=fixture.path,env=e,input="".join(json.dumps(r)+"\n" for r in requests),capture_output=True,text=True,timeout=20)
   replies=[json.loads(r) for r in p.stdout.splitlines()]
   expect(p.returncode==0 and len(replies)==3,"distributed MCP did not remain a valid JSON-RPC server")
   expect(replies[0]["result"]["serverInfo"]["name"]=="Hyperfide","MCP identity differs")
   expect(any(t["name"]=="authority_invoke" for t in replies[1]["result"]["tools"]),"MCP omitted authenticated tool")
   expect(replies[2]["result"]["isError"] is False,"MCP actual signed HTTPS call failed")
   result=json.loads(replies[2]["result"]["content"][0]["text"])
   expect(result["ok"] and result["result"]["principal"]["credential_id"]==fixture.ids["operator"],"MCP did not return real scoped principal")
   expect(not (fixture.path/".codegraph").exists(),"distributed MCP opened legacy SQLite")
  check("client.mcp.real-signed-authority",mcp)
  def unknown_ack():
   import http.server,http.client,ssl,socket,threading
   old_origin=fixture.origin
   observed={"requests":0,"accepted":False};lock=threading.Lock()
   backend_context=ssl.create_default_context(cafile=str(fixture.ca))
   backend_port=fixture.port
   class Proxy(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_POST(self):
     with lock:observed["requests"]+=1
     size=int(self.headers.get("Content-Length","0"));expect(0<size<=1024*1024,"invalid proxy body bound")
     raw=self.rfile.read(size)
     headers={k:v for k,v in self.headers.items() if k.lower() not in ("connection","content-length","transfer-encoding")}
     headers["Host"]="localhost:"+str(proxy.server_port)
     conn=http.client.HTTPSConnection("localhost",backend_port,context=backend_context,timeout=8)
     try:
      conn.request("POST",self.path,raw,headers);r=conn.getresponse();body=r.read()
      with lock:observed["accepted"]=r.status==200 and json.loads(body).get("ok") is True
     finally:conn.close()
     try:self.connection.shutdown(socket.SHUT_RDWR)
     except OSError:pass
     self.connection.close() # Drop only after the actual authority acknowledged its committed result.
   proxy=http.server.ThreadingHTTPServer(("127.0.0.1",0),Proxy);proxy.daemon_threads=True
   tls=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);tls.load_cert_chain(str(fixture.ca),str(fixture.tlskey));proxy.socket=tls.wrap_socket(proxy.socket,server_side=True)
   thread=threading.Thread(target=proxy.serve_forever,daemon=True)
   front="https://localhost:"+str(proxy.server_port)
   try:
    fixture.stop();identity=json.loads(fixture.identity_config.read_text());identity["origin"]=front;fixture.identity_config.write_text(json.dumps(identity));fixture.origin=front;fixture.start()
    cfg=json.loads(config.read_text());cfg["origin"]=front;config.write_text(json.dumps(cfg));config.chmod(0o600)
    thread.start()
    identifier=uid();value={"grant_id":identifier,"provisioning_intent_id":fixture.ids["intent"],"verifier":sha(fixture.secret),"allowed_actions":["identity.describe"],"ttl_seconds":300}
    process,response,op,_=invoke("identity.grant.issue",value)
    expect(process.returncode==75 and response is None,"lost accepted acknowledgement was not UNKNOWN")
    error=json.loads(process.stderr);expect(error["error"]["code"]=="AUTHORITY_OUTCOME_UNKNOWN" and error["operation_id"]==op["operation_id"] and error["automatic_replay"] is False,"unknown operation identity lost")
    expect(observed=={"requests":1,"accepted":True},"native transport replayed or loss happened before authority acceptance")
    expect(len(fixture.sql("SELECT id FROM hyperfide.identity_enrollment_grants WHERE id=$1",[identifier]))==1,"dropped acknowledgement did not retain actual committed effect")
   finally:
    if thread.is_alive():proxy.shutdown();thread.join(timeout=3)
    proxy.server_close()
    fixture.stop();identity=json.loads(fixture.identity_config.read_text());identity["origin"]=old_origin;fixture.identity_config.write_text(json.dumps(identity));fixture.origin=old_origin;fixture.start()
    cfg=json.loads(config.read_text());cfg["origin"]=old_origin;config.write_text(json.dumps(cfg));config.chmod(0o600)
  check("client.https.accepted-ack-loss-unknown",unknown_ack)
  def revoked():
   fixture.sql("UPDATE hyperfide.identity_principals SET state='REVOKED',credential_version=credential_version+1 WHERE credential_id=$1",[fixture.ids["operator"]])
   p,r,_,_=invoke("identity.describe",{})
   expect(p.returncode!=0 and r and r["ok"] is False,"revoked credential accepted")
  check("client.https.revoked-principal",revoked)
 finally:close_fixture(fixture,'hf-task25.3-network')



def mapping_checks():
 sys.path.insert(0,str(ROOT/"tests/hyperfide/support"))
 from identity_fixture import IdentityFixture,uid,sha
 def setup(f):
  f.apply_migration('0023-observability')
 fixture=IdentityFixture(extra_components=["23.1"],extra_setup=setup)
 try:
  config=fixture.path/"native-status-transport.json";config.write_text(json.dumps({"origin":fixture.origin,"ca_file":str(fixture.ca),"key_path":str(fixture.keys["operator"]["path"]),"credential_id":fixture.ids["operator"],"timeout_ms":5000}));config.chmod(0o600)
  marker=fixture.path/"status-authority.json";marker.write_text(json.dumps({"schema_version":1,"mode":"distributed","authority_epoch":fixture.ids["epoch"]}));marker.chmod(0o600)
  environment=os.environ.copy();environment.update(HYPERFIDE_MODE="distributed",HYPERFIDE_AUTHORITY_DESCRIPTOR=str(marker),HYPERFIDE_TRANSPORT_CONFIG=str(config));environment.pop("HYPERFIDE_AUTHORITY_URL",None)
  expected=fixture.sql("SELECT id,state,state_version::text FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2",[fixture.ids["organisation"],fixture.ids["run"]])[0]
  def verify(result):
   value=result["result"]
   expect(result["ok"] and value["run"]["id"]==expected["id"] and value["run"]["state"]==expected["state"] and str(value["run"]["state_version"])==expected["state_version"],"finite route result differs from actual primary run")
   expect(value["freshness"]["route"]=="PRIMARY","finite route lost primary provenance")
   expect(not (fixture.path/".codegraph").exists(),"finite distributed route opened SQLite")
  def cli():
   filename=fixture.path/"status-input.json";filename.write_text("{}")
   args=[str(ROOT/"cg"),"fleet","status","--input-file",str(filename),"--run-id",fixture.ids["run"],"--operation-id",uid(),"--idempotency-key",uid(),"--correlation-id",uid()]
   p=subprocess.run(args,cwd=fixture.path,env=environment,capture_output=True,text=True,timeout=20)
   expect(p.returncode==0,"finite CLI fleet status rejected: "+p.stderr[:200]);verify(json.loads(p.stdout))
  check("client.mapping.fleet-status-real-primary",cli)
  def mcp():
   request={"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fleet_status","arguments":{"run_id":fixture.ids["run"],"input":{},"operation_id":uid(),"idempotency_key":uid(),"correlation_id":uid()}}}
   p=subprocess.run([str(ROOT/"cg"),"mcp"],cwd=fixture.path,env=environment,input=json.dumps(request)+"\n",capture_output=True,text=True,timeout=20)
   r=json.loads(p.stdout);expect(p.returncode==0 and not r["result"]["isError"],"finite MCP fleet status rejected");verify(json.loads(r["result"]["content"][0]["text"]))
  check("client.mapping.mcp-fleet-status-real-primary",mcp)
  policy=fixture.path/"mcp-tool-policy.json";policy.write_text(json.dumps({"schema_version":1,"allowed_tools":["fleet_status"]}));policy.chmod(0o600)
  restricted=environment.copy();restricted["HYPERFIDE_MCP_TOOL_POLICY_FILE"]=str(policy)
  def tool(name,id):
   return {"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":name,"arguments":{"run_id":fixture.ids["run"],"input":{},"operation_id":uid(),"idempotency_key":uid(),"correlation_id":uid()}}}
  def finite_policy():
   requests=[{"jsonrpc":"2.0","id":1,"method":"tools/list"},tool("fleet_status",2),tool("authority_invoke",3),tool("human_submit",4)]
   p=subprocess.run([str(ROOT/"cg"),"mcp"],cwd=fixture.path,env=restricted,input="".join(json.dumps(r)+"\n" for r in requests),capture_output=True,text=True,timeout=20)
   replies=[json.loads(r) for r in p.stdout.splitlines()]
   expect(p.returncode==0 and [t["name"] for t in replies[0]["result"]["tools"]]==["fleet_status"],"tool policy did not filter catalog exactly")
   verify(json.loads(replies[1]["result"]["content"][0]["text"]))
   expect(replies[2]["error"]["code"]==-32601 and replies[3]["error"]["code"]==-32601,"denied generic or unlisted authority tool executed")
  check("client.mcp.trusted-finite-tool-policy",finite_policy)
  def bad_policy(fields,mode=0o600):
   policy.write_text(json.dumps(fields));policy.chmod(mode)
   p=subprocess.run([str(ROOT/"cg"),"mcp"],cwd=fixture.path,env=restricted,input="",capture_output=True,text=True,timeout=10)
   expect(p.returncode==78 and json.loads(p.stderr)["error"]["code"]=="MCP_TOOL_POLICY_INVALID","invalid trusted policy admitted")
   policy.write_text(json.dumps({"schema_version":1,"allowed_tools":["fleet_status"]}));policy.chmod(0o600)
  check("client.mcp.public-tool-policy-refused",lambda:bad_policy({"schema_version":1,"allowed_tools":["fleet_status"]},0o644))
  check("client.mcp.unknown-tool-policy-refused",lambda:bad_policy({"schema_version":1,"allowed_tools":["build_project"]}))
  check("client.mcp.duplicate-tool-policy-refused",lambda:bad_policy({"schema_version":1,"allowed_tools":["fleet_status","fleet_status"]}))
  check("client.mcp.bootstrap-generic-escape-refused",lambda:bad_policy({"schema_version":1,"allowed_tools":["authority_invoke"],"bootstrap_catalog":True}))
  def bootstrap():
   policy.write_text(json.dumps({"schema_version":1,"allowed_tools":["fleet_status"],"bootstrap_catalog":True,"target_session_id":fixture.ids["operator"],"run_id":fixture.ids["run"],"target_role":"OPERATOR"}))
   pending=fixture.path/"pending-target-transport.json";e=restricted.copy();e["HYPERFIDE_TRANSPORT_CONFIG"]=str(pending)
   p=subprocess.Popen([str(ROOT/"cg"),"mcp"],cwd=fixture.path,env=e,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
   def exchange(value):
    p.stdin.write(json.dumps(value)+"\n");p.stdin.flush()
    import select
    expect(select.select([p.stdout],[],[],15)[0],"bootstrap MCP response deadline exceeded")
    return json.loads(p.stdout.readline())
   try:
    initialized=exchange({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}})
    listed=exchange({"jsonrpc":"2.0","id":2,"method":"tools/list"})
    expect(initialized["result"]["serverInfo"]["name"]=="Hyperfide" and [t["name"] for t in listed["result"]["tools"]]==["fleet_status"],"credential-free bounded catalog failed")
    refused=exchange(tool("fleet_status",3))
    expect(refused["result"]["isError"] and json.loads(refused["result"]["content"][0]["text"])["error"]["code"]=="TRANSPORT_CONFIG_REQUIRED","bootstrap call acquired authority before target credential attachment")
    pending.write_bytes(config.read_bytes());pending.chmod(0o600)
    actual=exchange(tool("fleet_status",4));expect(not actual["result"]["isError"],"same MCP process did not reload attached target credential")
    verify(json.loads(actual["result"]["content"][0]["text"]))
   finally:
    p.stdin.close();p.wait(timeout=10)
    expect(p.returncode==0,"bootstrap MCP process failed shutdown")
    pending.unlink(missing_ok=True)
    policy.write_text(json.dumps({"schema_version":1,"allowed_tools":["fleet_status"]}))
  check("client.mcp.bootstrap-catalog-then-real-credential-attach",bootstrap)
  def wrong_subject():
   policy.write_text(json.dumps({"schema_version":1,"allowed_tools":["fleet_status"],"target_session_id":uid(),"run_id":fixture.ids["run"],"target_role":"LEADER"}))
   p=subprocess.run([str(ROOT/"cg"),"mcp"],cwd=fixture.path,env=restricted,input=json.dumps(tool("fleet_status",1))+"\n",capture_output=True,text=True,timeout=20)
   r=json.loads(p.stdout)
   expect(p.returncode==0 and r["result"]["isError"] and json.loads(r["result"]["content"][0]["text"])["error"]["code"]=="AUTHORITY_SUBJECT_MISMATCH","operator credential acquired supervisor authority")
   policy.write_text(json.dumps({"schema_version":1,"allowed_tools":["fleet_status"]}))
  check("client.mcp.wrong-supervisor-credential-refused",wrong_subject)

  def nonroot_signed():
   import shutil
   with tempfile.TemporaryDirectory(prefix="hf-nonroot-signed-") as directory:
    root=Path(directory);root.chmod(0o755);secure=root/"auth";secure.mkdir(mode=0o750);os.chown(secure,0,33025)
    native=root/"cg";shutil.copyfile(ROOT/"cg",native);native.chmod(0o755)
    key=secure/"key.pem";key.write_bytes(fixture.keys["operator"]["path"].read_bytes())
    ca=secure/"ca.pem";ca.write_bytes(fixture.ca.read_bytes())
    descriptor=secure/"authority.json";descriptor.write_bytes(marker.read_bytes())
    credential=secure/"transport.json";credential.write_text(json.dumps({"origin":fixture.origin,"ca_file":str(ca),"key_path":str(key),"credential_id":fixture.ids["operator"],"timeout_ms":5000}))
    toolpolicy=secure/"policy.json";toolpolicy.write_text(json.dumps({"schema_version":1,"allowed_tools":["fleet_status"],"target_session_id":fixture.ids["operator"],"run_id":fixture.ids["run"],"target_role":"OPERATOR"}))
    for file in [key,ca,descriptor,credential,toolpolicy]:file.chmod(0o640);os.chown(file,0,33025)
    def drop():
     os.setgroups([]);os.setresgid(33025,33025,33025);os.setresuid(33025,33025,33025)
    e={k:v for k,v in os.environ.items() if not k.startswith(("HYPERFIDE_","CG_","CODIFY_"))}
    e.update(HYPERFIDE_MODE="distributed",HYPERFIDE_AUTHORITY_DESCRIPTOR=str(descriptor),HYPERFIDE_TRANSPORT_CONFIG=str(credential),HYPERFIDE_MCP_TOOL_POLICY_FILE=str(toolpolicy))
    requests=[{"jsonrpc":"2.0","id":1,"method":"tools/list"},tool("fleet_status",2),tool("authority_invoke",3)]
    p=subprocess.run([str(native),"mcp"],cwd=root,env=e,preexec_fn=drop,input="".join(json.dumps(r)+"\n" for r in requests),capture_output=True,text=True,timeout=25)
    replies=[json.loads(line) for line in p.stdout.splitlines()]
    expect(p.returncode==0 and len(replies)==3 and [t["name"] for t in replies[0]["result"]["tools"]]==["fleet_status"],"actual nonroot finite MCP catalog failed")
    expect(replies[1]["result"]["isError"] is False,"actual nonroot root-protected credential did not reach signed HTTPS: "+str(replies[1]))
    verify(json.loads(replies[1]["result"]["content"][0]["text"]))
    expect(replies[2]["error"]["code"]==-32601,"nonroot protected policy granted generic operator escape")
    os.chown(ca,33025,33025);ca.chmod(0o600)
    denied=subprocess.run([str(native),"mcp"],cwd=root,env=e,preexec_fn=drop,input=json.dumps(tool("fleet_status",4))+"\n",capture_output=True,text=True,timeout=20)
    reply=json.loads(denied.stdout)
    expect(denied.returncode==0 and reply["result"]["isError"] is True,"child-mutable TLS trust anchor was accepted")
    os.chown(ca,0,33025);ca.chmod(0o640)
    expect(not (root/".codegraph").exists(),"nonroot signed bridge opened local SQLite")
  check("client.protected.mcp-nonroot-signed-primary",nonroot_signed)

 finally:close_fixture(fixture,'hf-task25.3-mapping')

def business_unknown_checks():
 sys.path.insert(0,str(ROOT/"tests/hyperfide/support"))
 from identity_fixture import IdentityFixture,uid,sha
 import importlib.util,base64
 spec=importlib.util.spec_from_file_location("client_actual_artifact_fixture",ROOT/"tests/hyperfide/cases/tasks/15_2.py")
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 backend=module.ObjectFixture()
 fixture=None
 try:
  def setup(f):
   f.env.update(HF_ARTIFACT_S3_ENDPOINT=backend.endpoint,HF_ARTIFACT_ALLOW_LOOPBACK_HTTP="1",HF_ARTIFACT_S3_REGION=module.REGION,HF_ARTIFACT_S3_BUCKET=module.BUCKET,HF_ARTIFACT_S3_ACCESS_KEY_ID=module.KEY,HF_ARTIFACT_S3_SECRET_ACCESS_KEY=module.SECRET,HF_ARTIFACT_S3_SESSION_TOKEN=module.TOKEN,HF_ARTIFACT_ORGANISATION_ID=f.ids["organisation"],HF_ARTIFACT_ALLOWED_RUN_IDS=json.dumps([f.ids["run"]]))
  fixture=IdentityFixture(extra_components=["15.2"],extra_setup=setup)
  module.ORG=fixture.ids["organisation"];module.RUN=fixture.ids["run"]
  module.SCOPE={"organisation_id":module.ORG,"run_id":module.RUN}
  config=fixture.path/"artifact-native.json";config.write_text(json.dumps({"origin":fixture.origin,"ca_file":str(fixture.ca),"key_path":str(fixture.keys["operator"]["path"]),"credential_id":fixture.ids["operator"],"timeout_ms":5000}));config.chmod(0o600)
  marker=fixture.path/"artifact-authority.json";marker.write_text(json.dumps({"schema_version":1,"mode":"distributed","authority_epoch":fixture.ids["epoch"]}));marker.chmod(0o600)
  environment=os.environ.copy();environment.update(HYPERFIDE_MODE="distributed",HYPERFIDE_AUTHORITY_DESCRIPTOR=str(marker),HYPERFIDE_TRANSPORT_CONFIG=str(config));environment.pop("HYPERFIDE_AUTHORITY_URL",None);environment.pop("HYPERFIDE_MCP_TOOL_POLICY_FILE",None)
  def payload(data):
   return {"run_id":fixture.ids["run"],"component":"15.2","action":"artifact.object.put","input":{"organisation_id":fixture.ids["organisation"],"run_id":fixture.ids["run"],"digest":sha(data),"size_bytes":str(len(data)),"data_base64":base64.b64encode(data).decode(),"retention_class":"RUN","retention_until":None,"retention_hold":False},"expected_version":None,"authority":None}
  def observed(result,data):
   expect(result["ok"] is True and result["result"]["outcome"]=="UNKNOWN" and result["result"]["artifact"]["status"]=="PENDING" and result["result"]["receipt"] is None,"real15.2 backend refusal did not preserve explicit UNKNOWN")
   rows=fixture.sql("SELECT status,completed_at FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND digest=$3",[fixture.ids["organisation"],fixture.ids["run"],sha(data)])
   expect(len(rows)==1 and rows[0]["status"]=="PENDING" and rows[0]["completed_at"] is None,"native UNKNOWN differs from direct primary pending intent")
   events=[e for e in backend.events if e["path"]==backend.key(data) and e["method"]=="PUT"]
   expect(len(events)==1 and events[0]["signature_verified"],"native caller blindly replayed unknown artifact upload")
  def cli_unknown():
   data=b"real native business UNKNOWN";backend.set_mode(data,"reject")
   filename=fixture.path/"artifact-payload.json";filename.write_text(json.dumps(payload(data)))
   operation=uid();key=uid()
   p=subprocess.run([str(ROOT/"cg"),"authority","invoke","--payload-file",str(filename),"--operation-id",operation,"--idempotency-key",key,"--correlation-id",uid()],cwd=fixture.path,env=environment,capture_output=True,text=True,timeout=20)
   expect(p.returncode==75,"HTTP200 business UNKNOWN exit mismatch: "+str((p.returncode,p.stdout,p.stderr)))
   observed(json.loads(p.stdout),data)
   error=json.loads(p.stderr);expect(error["automatic_replay"] is False and error["operation_id"]==operation and error["idempotency_key"]==key,"business UNKNOWN reconciliation identity lost")
  check("client.https.business-unknown-exit75-real-pending",cli_unknown)
  def mcp_unknown():
   data=b"real MCP business UNKNOWN";backend.set_mode(data,"reject")
   request={"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"authority_invoke","arguments":{"payload":payload(data),"operation_id":uid(),"idempotency_key":uid(),"correlation_id":uid()}}}
   p=subprocess.run([str(ROOT/"cg"),"mcp"],cwd=fixture.path,env=environment,input=json.dumps(request)+"\n",capture_output=True,text=True,timeout=20)
   response=json.loads(p.stdout);expect(p.returncode==0 and response["result"]["isError"] is True,"HTTP200 business UNKNOWN MCP mismatch: "+str((p.returncode,p.stdout,p.stderr)))
   observed(json.loads(response["result"]["content"][0]["text"]),data)
  check("client.mcp.business-unknown-error-real-pending",mcp_unknown)
 finally:
  if fixture:close_fixture(fixture,'hf-task25.3-business')
  absent=backend.stop()
  CLEANUP.append({'id':'hf-task25.3-object-backend','observed_absent':absent})
  expect(absent,"owned artifact fault fixture retained a listener")

if __name__=="__main__":sys.exit(cleanup() if "--cleanup" in sys.argv else main())
