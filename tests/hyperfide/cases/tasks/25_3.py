#!/usr/bin/env python3
"""Observe authority routing through the actual public binary; no live authority."""
import json,os,subprocess,tempfile,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4];FAILED=[];IDS=[]
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
  for command in [["init"],["spec","claim","1"],["spec","done","1","--force"],["spec","run"],["mcp"],["hook","post-edit"],["work","update"],["docs","close"],["projection"],["serve"],["fleet","up"]]:
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
 network_checks()
 return 1 if FAILED else 0

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
 finally:fixture.close()
if __name__=="__main__":sys.exit(main())
