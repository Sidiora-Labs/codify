#!/usr/bin/env python3
"""Task21.1 advisory clause critique component variant; no live model or full-case qualification.

Service-level evidence comes from the shared domain21 drivers in 21_4.py (owned by 21.4): the
signed HTTPS+PostgreSQL authority probe with the actual 2.3 amendment validator and the durable
20.4 job probe. 21.1 declares the `spec-revisions` component, so every closure built here
carries the actual 2.x spec fragments; the identity fixture is extended in-process, never edited.
"""
from pathlib import Path
import importlib.machinery,importlib.util,json,os,shutil,subprocess,sys,tempfile
spec=importlib.util.spec_from_file_location("domain21_tests",Path(__file__).with_name("21_4.py"))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
ROOT=module.ROOT;COMPONENTS=ROOT/"services/hyperfide/components"
IDENTITY=(ROOT/"tests/hyperfide/support/identity_fixture.py").resolve()
TEMP_PREFIXES=("hyperfide-identity-","hf-domain21-","hf-task21-1-")
OWNED_DATABASES="datname LIKE 'hf\\_identity\\_%'";OWNED_ROLES="rolname LIKE 'hf\\_ir\\_%'"

def fragments():
 table={}
 for path in COMPONENTS.glob("*.json"):
  if path.name=="schema.json":continue
  table[json.loads(path.read_text())["id"]]=path
 return table

def spec_closure():
 """Actual declared closure of 21.1 except 20.4, which stays an explicit unavailable stub (pending)."""
 table=fragments();seen=[];pending=["21.1"]
 while pending:
  ident=pending.pop()
  if ident in seen or ident=="20.4":continue
  if ident not in table:raise RuntimeError("Declared component dependency has no fragment: "+ident)
  seen.append(ident);pending+=json.loads(table[ident].read_text())["requires"]
 return seen,table

def linkage_probe():
 """Actual signed HTTPS+PG control service; 20.4 is an explicit unavailable stub, 2.x is the real spec closure."""
 identity_spec=importlib.util.spec_from_file_location("task21_1_identity_fixture",IDENTITY)
 identity=importlib.util.module_from_spec(identity_spec);identity_spec.loader.exec_module(identity)
 closure,table=spec_closure();names=tuple(table[ident].stem for ident in closure)
 with tempfile.TemporaryDirectory(prefix="hf-task21-1-link-") as folder:
  fixture_root=Path(folder);service=fixture_root/"services/hyperfide";service.mkdir(parents=True)
  shutil.copytree(ROOT/"services/hyperfide/dist",service/"dist");shutil.copytree(ROOT/"services/hyperfide/migrations",service/"migrations")
  shutil.copytree(COMPONENTS,service/"components");shutil.copyfile(ROOT/"services/hyperfide/package.json",service/"package.json")
  (service/"node_modules").symlink_to(ROOT/"services/hyperfide/node_modules",target_is_directory=True)
  (service/"dist/fixture-unavailable-jobs.js").write_text("export function createComponent(){return {apiVersion:1,capabilities:{'decision.jobs.v1':{registerPurpose(){},completedAudit(){return {available:false,reason:'missing'}}}},actions:{'fixture.jobs.describe':()=>({authority:'NONE',qualification:'UNAVAILABLE_PRODUCER_FIXTURE'})}}}")
  (service/"components/20.4.json").write_text(json.dumps({"schema_version":1,"id":"20.4","task":"20.4","roles":["control"],"module":"fixture-unavailable-jobs.js","entry":"createComponent","api_version":1,"actions":["fixture.jobs.describe"],"requires":[]}))
  identity.ROOT=fixture_root
  def linked():
   identity.expect("spec-revisions" in closure,"21.1 no longer declares the 2.3 validator component")
   fixture=identity.IdentityFixture(extra_components=("20.4",)+names)
   try:
    body=fixture.invoke("decision.spec.describe",{},component="21.1")[1];result=body.get("result",{})
    identity.expect(body.get("ok") is True and result.get("authority")=="NONE" and result.get("accepted_intent_mutable") is False and result.get("explicit_replacement_validation")=="actual_spec_amendment_validator","service refused linked module: "+str(body)[:800])
   finally:fixture.close()
  identity.check("critique.service-linked",linked)
  def fails_closed():
   try:fixture=identity.IdentityFixture(extra_components=("20.4",)+tuple(name for name in names if json.loads((COMPONENTS/(name+".json")).read_text())["id"]!="spec-revisions"))
   except Exception as error:
    identity.expect("Missing component dependency" in str(error),"service failed for another reason: "+str(error)[:800]);return
   fixture.close();raise AssertionError("closure without the 2.3 validator component loaded")
  identity.check("critique.spec-revisions-required",fails_closed)
 return int(any(actual!="observed" for _,actual in identity.RESULTS))

def function_probe(env):
 """The 21.4 driver's 21.1 branch, minus its own service linkage (which predates spec-revisions)."""
 contract_checks="""
 await check('critique.validation-active-impact',()=>{
  for(const size of [0,1,129]){
   const impact={...analysis.impact,revalidation:Array.from({length:size},(_,i)=>({task_id:id(i),state:'RUNNING'})),unaffected_active_task_ids:Array.from({length:size},(_,i)=>id(i))};
   const result=S.amendmentSummary({...analysis,impact});
   for(const key of ['revalidation','unaffected_active_task_ids'])expect(A.canonical(result.impact[key])===A.canonical(impact[key].slice(0,128))&&result.impact.counts[key]===size,'active impact projection differs');
   expect(result.impact.truncated===(size>128)&&result.impact_digest===A.digest(impact)&&result.analysis_digest===A.digest({...analysis,impact})&&result.accepted===false&&result.dispatch_authority===false,'active impact digest or authority differs');
  }
 });
 await check('critique.validation-unknown-fields',()=>{
  reject(()=>S.amendmentSummary({...analysis,unknown:true}),'DECISION_VALIDATION_INVALID');
  reject(()=>S.amendmentSummary({...analysis,impact:{...analysis.impact,unknown:[]}}),'DECISION_VALIDATION_INVALID');
 });
 """
 script_source=module.NODE.replace(" await check('critique.source-immutable'",contract_checks+" await check('critique.source-immutable'",1)
 with tempfile.TemporaryDirectory(prefix="hf-task21-1-fn-") as folder:
  script=Path(folder)/"probe.mjs";script.write_text(script_source)
  result=subprocess.run(["node",str(script),"21.1"],cwd=ROOT,env={**env,"HF_FIXTURE_ROOT":str(ROOT)},text=True,capture_output=True,timeout=120)
 print(result.stdout,end="",flush=True)
 if result.returncode and result.stderr:print(result.stderr[-2000:],file=sys.stderr)
 return result.returncode==0

def include_spec_closure():
 """Every identity fixture built by the shared probes also installs the 21.1 spec closure fragments."""
 closure=tuple(ident for ident in spec_closure()[0] if ident not in ("21.1","21.4","4.2"))
 names=tuple(dict.fromkeys(fragments()[ident].stem for ident in closure))
 original=importlib.machinery.SourceFileLoader.exec_module
 def exec_module(loader,target):
  original(loader,target)
  if Path(loader.path).resolve()!=IDENTITY:return
  base=target.IdentityFixture.__init__
  def init(fixture,*args,extra_components=(),**kwargs):base(fixture,*args,extra_components=tuple(extra_components)+names,**kwargs)
  target.IdentityFixture.__init__=init
 importlib.machinery.SourceFileLoader.exec_module=exec_module

def child_probe(kind,env):
 result=subprocess.run([sys.executable,str(Path(__file__).resolve()),"--probe",kind],cwd=ROOT,env=env,text=True,capture_output=True,timeout=200)
 stray=0
 for line in result.stdout.splitlines():
  try:event=json.loads(line)
  except ValueError:continue
  if not isinstance(event,dict):continue
  if event.get("type")=="assertion":print(json.dumps(event),flush=True)
  elif event.get("type")=="cleanup":stray+=1
 if result.returncode and result.stderr:print(result.stderr[-2000:],file=sys.stderr)
 return result.returncode==0,stray

def psql(env,query):
 result=subprocess.run(["psql","-XAtq","-d",env["DATABASE_URL"],"-c",query],env=env,text=True,capture_output=True,timeout=20)
 if result.returncode:raise RuntimeError("Fixture ownership query failed: "+result.stderr[-500:])
 return set(line for line in result.stdout.splitlines() if line)

def owned(env):
 temp=set(p.name for p in Path(tempfile.gettempdir()).iterdir() if p.name.startswith(TEMP_PREFIXES))
 return {"databases":psql(env,"SELECT datname FROM pg_database WHERE "+OWNED_DATABASES),"roles":psql(env,"SELECT rolname FROM pg_roles WHERE "+OWNED_ROLES),"paths":temp}

def main():
 env=module.environment();os.environ.update({k:v for k,v in env.items() if k.startswith("PG") or k=="DATABASE_URL"})
 if "--probe" in sys.argv:
  kind=sys.argv[sys.argv.index("--probe")+1]
  if kind=="linkage":return linkage_probe()
  include_spec_closure()
  return module.signed_authority_probe(include_amendment=True) if kind=="signed" else module.durable_job_probe()
 before=owned(env);status=1;stray=0
 try:
  linked,extra=child_probe("linkage",env);stray+=extra
  functional=function_probe(env)
  signed,extra=child_probe("signed",env);stray+=extra
  jobs,extra=child_probe("jobs",env);stray+=extra
  status=0 if linked and functional and signed and jobs else 1
 finally:
  # Probes self-clean their disposable databases/roles/paths; this single event proves the absence.
  after=owned(env);leaked={key:sorted(after[key]-before[key]) for key in after}
  complete=not any(leaked.values()) and stray==0
  print(json.dumps({"type":"cleanup","complete":complete,"resources":[],"self_cleaned":{"leaked":leaked,"stray_cleanup_events":stray,"observed_absent":complete}}),flush=True)
 return status if complete else 1

if __name__=="__main__":sys.exit(main())
