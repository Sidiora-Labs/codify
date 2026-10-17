#!/usr/bin/env python3
"""Task 21.3 component variant: the ranking module through the service, the actual
signed finding-registry linkage, and the native guard/readiness/memory/recap consumers
migrated onto the explicit 21.4 purpose path. Bounded fixtures only: no live model,
scheduler or full-case qualification, and no advisory output is ever treated as authority."""
from __future__ import annotations
import base64,http.server,importlib.util,json,os,re,ssl,subprocess,sys,tempfile,threading,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location("domain21_tests",Path(__file__).with_name("21_4.py"))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
PURPOSES={1:"guard",2:"readiness",4:"memory",5:"recap"}
RESULTS=[]
def emit(identity,good,message):
 RESULTS.append(good)
 print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":"observed" if good else message[:800]}),flush=True)
def check(identity,fn):
 try:good,message=fn()
 except Exception as error:good,message=False,type(error).__name__+": "+str(error)
 emit(identity,good,message)

def admin(sql,values=()):
 # Superuser fixture connection; only reads catalogue state for the cleanup proof.
 script="const {createRequire}=require('module'),pg=createRequire(process.argv[1]+'/services/hyperfide/package.json')('pg');(async()=>{const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();try{const r=await c.query(process.argv[2],JSON.parse(process.argv[3]));process.stdout.write(JSON.stringify(r.rows))}finally{await c.end()}})().catch(e=>{process.stderr.write(String(e.message));process.exitCode=1})"
 r=subprocess.run(["node","-e",script,str(ROOT),sql,json.dumps(list(values))],cwd=ROOT,env={**os.environ,**module.environment()},capture_output=True,text=True,timeout=20)
 if r.returncode:raise RuntimeError("catalogue query failed: "+r.stderr[:400])
 return json.loads(r.stdout)
def owned_identities():
 rows=admin("SELECT 'database:'||datname AS n FROM pg_database WHERE datname ~ '^hf_identity_[0-9a-f]{32}$' UNION ALL SELECT 'role:'||rolname FROM pg_roles WHERE rolname ~ '^hf_ir_[0-9a-f]{32}$'")
 return {row["n"] for row in rows}

def component_probe():
 """The 21.3 component through the established service entrypoint and direct module API."""
 env=module.environment();env["HF_FIXTURE_ROOT"]=str(ROOT)
 with tempfile.TemporaryDirectory(prefix="hf-domain21-") as directory:
  linked=module.service_probe("21.3",env,Path(directory))
  def purposes():
   # Same linked service and approved policy; the consumer purpose policy is observable through describe.
   d=Path(directory);request={"id":"domain21-purposes","component":"21.3","action":"decision.ranking.describe","input":{}}
   r=subprocess.run(["node",str(ROOT/"services/hyperfide/dist/control.js"),"--policy",str(d/"policy.json"),"--spec-revision","domain21-reviewed-spec","--components",str(d/"components"),"--module-root",str(d/"modules")],input=json.dumps(request)+"\n",cwd=ROOT,env=env,text=True,capture_output=True,timeout=30)
   rows=[json.loads(line) for line in r.stdout.splitlines() if line.strip()]
   result=rows[0].get("result",{}) if len(rows)==1 and rows[0].get("ok") is True else {}
   expected={name:{"actions":["decision.legacy."+name+".submit","decision.legacy."+name+".result"],"fallback":fallback,"authority":"NONE"} for name,fallback in (("guard","COLLECTED_ORDER"),("readiness","OMITTED"),("memory","UNCLASSIFIED"),("recap","UNDECIDED"))}
   return result.get("consumer_purposes")==expected and result.get("local_consumers")=="LEGACY_UNCHANGED" and result.get("authority")=="NONE","consumer purpose policy not observable through the service: "+str(rows)[:600]
  check("ranking.consumer-purpose-policy",purposes)
  script=Path(directory)/"probe.mjs";script.write_text(module.NODE)
  result=subprocess.run(["node",str(script),"21.3"],cwd=ROOT,env=env,text=True,capture_output=True,timeout=120)
  print(result.stdout,end="",flush=True)
  if result.returncode and result.stderr:print(result.stderr[-2000:],file=sys.stderr)
  return result.returncode if linked else 1

def signed_probe():
 """Actual signed HTTPS+PG composition of 21.3 with the named finding-registry (18.1);
 the scheduler is explicitly unavailable, so no ranking candidate may be manufactured."""
 try:return module.signed_authority_probe(include_findings=True)
 except Exception as error:
  emit("signed21.setup",False,type(error).__name__+": "+str(error));return 1

DRIVER=r'''#include <stdio.h>
#include <stdlib.h>
int hf_decision_advice(int purpose,const char *observation,char **advice);
int main(int argc,char **argv){if(argc!=3)return 2;char *a=NULL;int r=hf_decision_advice(atoi(argv[1]),argv[2],&a);printf("{\"routed\":%d,\"advice\":%s}\n",r,a?a:"null");free(a);return 0;}
'''

class FakeAuthority:
 """Loopback TLS authority for transport/policy correctness only. It answers the client's
 identity probe and scripted decision.legacy responses; it is never a model or 21.4 qualification."""
 def __init__(self,folder,run,credential):
  self.folder=folder;self.run=run;self.credential=credential;self.mode="advice";self.seen=[]
  self.cert=folder/"fake-ca.pem";self.key=folder/"fake-key.pem"
  subprocess.run(["openssl","req","-x509","-newkey","rsa:2048","-sha256","-nodes","-keyout",str(self.key),"-out",str(self.cert),"-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost,IP:127.0.0.1","-days","1"],check=True,capture_output=True)
  fake=self
  class Handler(http.server.BaseHTTPRequestHandler):
   def log_message(self,*args):pass
   def do_POST(self):
    envelope=json.loads(self.rfile.read(int(self.headers.get("Content-Length","0"))))
    payload=json.loads(base64.urlsafe_b64decode(envelope["payload_b64"]+"="*(-len(envelope["payload_b64"])%4)))
    operation=envelope["operation_id"];action=payload["action"];fake.seen.append({"component":payload["component"],"action":action,"input":payload["input"],"run_id":payload["run_id"]})
    body={"protocol_version":1,"id":operation,"operation_id":operation,"ok":True}
    if action=="identity.describe":body["result"]={"principal":{"run_id":fake.run,"credential_id":fake.credential}}
    elif action.endswith(".submit"):
     if fake.mode=="malformed":body["result"]={"status":"queued"}
     elif fake.mode=="refused":body={"protocol_version":1,"id":operation,"operation_id":operation,"ok":False,"error":{"code":"DECISION_PURPOSE_UNSUPPORTED"}}
     else:body["result"]={"decision_id":"50000000-0000-0000-0000-000000000001","authority":"NONE"}
    else:
     if fake.mode=="late":time.sleep(2.6)
     advice={"scores":[3,0,4]}
     result={"status":"accepted_advice","authority":"NONE","applied":False,"advice":advice}
     if fake.mode=="authority":result["authority"]="OWNER"
     if fake.mode=="applied":result["applied"]=True
     body["result"]=result
    data=json.dumps(body).encode()
    try:
     self.send_response(200);self.send_header("Content-Type","application/json");self.send_header("Content-Length",str(len(data)));self.end_headers();self.wfile.write(data)
    except OSError:pass
  self.server=http.server.ThreadingHTTPServer(("127.0.0.1",0),Handler)
  context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(self.cert,self.key)
  self.server.socket=context.wrap_socket(self.server.socket,server_side=True)
  self.port=self.server.server_address[1];self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
 def close(self):self.server.shutdown();self.server.server_close()

def native_probe():
 """The migrated C consumers' shared purpose-path adapter (src/recap.c hf_decision_advice)."""
 build=subprocess.run(["make","-s","build/libcg.a"],cwd=ROOT,capture_output=True,text=True,timeout=600)
 if build.returncode:
  for name in ("local-mode-unchanged","offline-deterministic","real-service-fallback","purpose-path-routed","authority-claim-refused","applied-advice-refused","malformed-response-abstains","deadline-abstains"):
   emit("native21."+name,False,"native build failed: "+build.stderr[-600:])
  return 1
 identity_spec=importlib.util.spec_from_file_location("native21_identity_fixture",ROOT/"tests/hyperfide/support/identity_fixture.py")
 identity=importlib.util.module_from_spec(identity_spec);identity_spec.loader.exec_module(identity)
 failed=0
 with tempfile.TemporaryDirectory(prefix="hf-native21-") as folder:
  folder=Path(folder);(folder/"driver.c").write_text(DRIVER);driver=folder/"driver"
  libraries=subprocess.run(["python3","scripts/hyperfide-native-components.py","--libraries"],cwd=ROOT,capture_output=True,text=True,check=True).stdout.split()
  subprocess.run(["cc","-std=gnu11","-o",str(driver),str(folder/"driver.c"),str(ROOT/"build/libcg.a"),"-lsqlite3","-lpthread","-lm","-lcurl","-lcrypto",*libraries],cwd=ROOT,check=True,capture_output=True,timeout=180)
  base={k:v for k,v in os.environ.items() if not k.startswith(("HYPERFIDE_","CG_","CODIFY_","OPENROUTER"))}
  def ask(purpose,env,observation='{"fixture":true}'):
   started=time.monotonic()
   r=subprocess.run([str(driver),str(purpose),observation],cwd=folder,env=env,capture_output=True,text=True,timeout=20)
   if r.returncode:raise AssertionError("driver failed: "+r.stderr[-400:])
   return json.loads(r.stdout),r.stderr,time.monotonic()-started
  def descriptor(epoch):
   marker=folder/"authority.json";marker.write_text(json.dumps({"schema_version":1,"mode":"distributed","authority_epoch":epoch}));marker.chmod(0o600);return marker
  def local():
   # No descriptor anywhere above the private folder: the legacy local path is selected unchanged.
   answers=[ask(p,base)[0] for p in PURPOSES]
   return all(a=={"routed":-1,"advice":None} for a in answers),"local mode did not keep the legacy path: "+str(answers)
  check("native21.local-mode-unchanged",local)
  def offline():
   env={**base,"HYPERFIDE_MODE":"offline","HYPERFIDE_AUTHORITY_DESCRIPTOR":str(descriptor("60000000-0000-0000-0000-000000000001"))}
   answers=[ask(p,env) for p in PURPOSES]
   return all(a=={"routed":0,"advice":None} and "deterministic outcome kept" in e for a,e,_ in answers),"offline distributed advice was not an explicit deterministic fallback: "+str(answers)
  check("native21.offline-deterministic",offline)
  # Actual identity HTTPS service: 21.4 does not expose decision.legacy.* yet, so every purpose must abstain.
  fixture=None
  try:
   fixture=identity.IdentityFixture()
   config=folder/"transport.json";config.write_text(json.dumps({"origin":fixture.origin,"ca_file":str(fixture.ca),"key_path":str(fixture.keys["operator"]["path"]),"credential_id":fixture.ids["operator"],"timeout_ms":1500,"run_id":fixture.ids["run"]}));config.chmod(0o600)
   env={**base,"HYPERFIDE_MODE":"distributed","HYPERFIDE_AUTHORITY_DESCRIPTOR":str(descriptor(fixture.ids["epoch"])),"HYPERFIDE_TRANSPORT_CONFIG":str(config)}
   def real():
    answers=[ask(p,env) for p in PURPOSES]
    # The identity probe and transport must succeed; only the authority's refusal of the unexposed action is a valid abstention.
    local=("TRANSPORT_CONFIG","ADVISORY_CONTEXT_REQUIRED","ADVISORY_SUBJECT_MISMATCH","AUTHORITY_TRANSPORT_FAILED","ADVISORY_INPUT_INVALID")
    return all(a=={"routed":0,"advice":None} and "deterministic outcome kept" in e and not any(code in e for code in local) for a,e,_ in answers),"real service without decision.legacy.* produced advice or failed locally: "+str(answers)
   check("native21.real-service-fallback",real)
  except Exception as error:emit("native21.real-service-fallback",False,type(error).__name__+": "+str(error))
  finally:
   if fixture:
    database,role=fixture.database,fixture.runtime_role;fixture.close()
    owned.update({"database:"+database,"role:"+role})
  fake=FakeAuthority(folder,"70000000-0000-0000-0000-000000000001","70000000-0000-0000-0000-000000000002")
  try:
   config=folder/"fake-transport.json";config.write_text(json.dumps({"origin":"https://localhost:"+str(fake.port),"ca_file":str(fake.cert),"key_path":str(folder/"fake-signing.pem"),"credential_id":fake.credential,"timeout_ms":5000,"run_id":fake.run}));config.chmod(0o600)
   subprocess.run(["openssl","genpkey","-algorithm","Ed25519","-out",str(folder/"fake-signing.pem")],check=True,capture_output=True);(folder/"fake-signing.pem").chmod(0o600)
   env={**base,"HYPERFIDE_MODE":"distributed","HYPERFIDE_AUTHORITY_DESCRIPTOR":str(descriptor("70000000-0000-0000-0000-000000000003")),"HYPERFIDE_TRANSPORT_CONFIG":str(config)}
   def routed():
    observed=[]
    for purpose,name in PURPOSES.items():
     fake.mode="advice";fake.seen.clear()
     answer,_,_=ask(purpose,env,'{"findings":[{"kind":"contract","path":"src/a.c","line":1,"detail":"d"}]}')
     actions=[(s["component"],s["action"]) for s in fake.seen]
     submit=next((s for s in fake.seen if s["action"].endswith(".submit")),{})
     result=next((s for s in fake.seen if s["action"].endswith(".result")),{})
     observed.append(answer["routed"]==1 and answer["advice"]=={"scores":[3,0,4]} and actions==[("14.1","identity.describe"),("21.4","decision.legacy."+name+".submit"),("14.1","identity.describe"),("21.4","decision.legacy."+name+".result")] and submit.get("input",{}).get("purpose")==name and submit["input"].get("observation",{}).get("findings",[{}])[0].get("path")=="src/a.c" and result.get("input")=={"decision_id":"50000000-0000-0000-0000-000000000001"} and all(s["run_id"]==fake.run for s in fake.seen))
    return all(observed),"explicit purpose path was not used exactly: "+str(observed)
   check("native21.purpose-path-routed",routed)
   def refused(mode,code):
    def run():
     fake.mode=mode;answers=[ask(p,env) for p in PURPOSES]
     return all(a=={"routed":0,"advice":None} and code in e for a,e,_ in answers),mode+" response was not refused explicitly: "+str(answers)
    return run
   check("native21.authority-claim-refused",refused("authority","ADVISORY_AUTHORITY_REFUSED"))
   check("native21.applied-advice-refused",refused("applied","ADVISORY_AUTHORITY_REFUSED"))
   def malformed():
    good,message=refused("malformed","ADVISORY_MALFORMED")()
    if not good:return good,message
    return refused("refused","DECISION_PURPOSE_UNSUPPORTED")()
   check("native21.malformed-response-abstains",malformed)
   def late():
    fake.mode="late";answer,error,elapsed=ask(1,env)
    return answer=={"routed":0,"advice":None} and "deterministic outcome kept" in error and elapsed<4.5,"late advice was not bounded by the advisory deadline: "+str((answer,error,elapsed))
   check("native21.deadline-abstains",late)
  finally:fake.close()
 return 0

owned=set()
def main():
 os.environ.update({k:v for k,v in module.environment().items() if k.startswith("PG") or k=="DATABASE_URL"})
 before=owned_identities()
 status=0
 try:
  status|=component_probe()!=0
  signed_status=signed_probe()
  status|=signed_status!=0
  status|=native_probe()!=0
  if signed_status==0:emit("signed21.setup",True,"")
 finally:
  # Identity fixtures are self-cleaned by close(); prove no owned database/role survives.
  after=owned_identities();leaked=sorted((after-before)|(owned&after))
  print(json.dumps({"type":"cleanup","complete":not leaked,"resources":[],"self_cleaned":{"kind":"identity-fixture databases and runtime roles","observed_absent":not leaked,"leaked":leaked}}),flush=True)
  if leaked:status=1
 return int(status or not all(RESULTS))

if __name__=="__main__":
 if "--cleanup" in sys.argv:print(json.dumps({"type":"cleanup","complete":True,"resources":[]}));sys.exit(0)
 sys.exit(main())
