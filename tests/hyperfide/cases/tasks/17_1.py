#!/usr/bin/env python3
"""Real Git/PostgreSQL watcher-obligation component tests; no frontier review claims."""
from __future__ import annotations
import ast,copy,hashlib,json,os
from pathlib import Path
import subprocess,sys,tempfile
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[4]/"tests/hyperfide/support"))
from identity_fixture import IdentityFixture
from urllib.parse import urlsplit,urlunsplit

ROOT=Path(__file__).resolve().parents[4]
ORG="00000000-0000-4000-8000-000000000001"
RUN="00000000-0000-4000-8000-000000000005"
REPOSITORY="00000000-0000-4000-8000-000000000003"
SCOPE={"organisation_id":ORG,"run_id":RUN}
DIGEST="sha256:"+"a"*64
FAILED=[]
IDS=[
"review.policy.ten-distinct-watchers","review.policy.reject-nine","review.policy.reject-duplicate-session",
"review.policy.reject-unapproved-sharding","review.policy.reject-request-approval",
"review.discovery.actual-first-batch","review.discovery.actual-second-batch","review.discovery.replay",
"review.coverage.every-watcher-per-commit","review.coverage.no-completion-from-counts",
"review.coverage.detect-missing-obligation","review.coverage.repair-obligation",
"review.discovery.history-rewrite","review.discovery.preserve-history",
"review.policy.replacement-generation","review.coverage.old-policy-stale",
"review.discovery.untagged-visible","review.discovery.empty-commit-covered",
"review.api.reject-checkout-path","review.api.cross-run-refused"
]
def xid(n):return f"00000000-0000-4000-8000-{n:012x}"
def expect(value,message):
 if not value:raise AssertionError(message)
def check(identity,callback):
 try:callback();actual="observed"
 except Exception as error:actual=f"{type(error).__name__}: {error}";FAILED.append(identity)
 print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
def database(task):
 path=evidence_dir(task)/"fixture-database.json"
 return json.loads(path.read_text())["database"] if path.exists() else "hf_review_"+task.replace(".","_")
def database_env(task,maintenance=False):
 env=os.environ.copy();name="postgres" if maintenance else database(task);env["PGDATABASE"]=name
 url=urlsplit(env["DATABASE_URL"]);env["DATABASE_URL"]=urlunsplit((url.scheme,url.netloc,"/"+name,url.query,url.fragment))
 return env
def sql(task,statement,maintenance=False,allow_error=False):
 result=subprocess.run(["psql","-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-v","VERBOSITY=verbose","-d","postgres" if maintenance else database(task)],
 input=statement,text=True,capture_output=True,env=database_env(task,maintenance),timeout=30)
 if not allow_error:
  expect(result.returncode==0,"fixture PostgreSQL failure: "+" | ".join(x for x in result.stderr.splitlines() if x.startswith(("ERROR:","CONTEXT:")))[:1200])
 return result
def evidence_dir(task):
 path=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR",f"/tmp/hyperfide/review-{task}-standalone"))/"review";path.mkdir(parents=True,exist_ok=True);return path
def cleanup(task):
 try:
  name=database(task);expect(name.startswith("hf_identity_") and len(name)==44 or name in ["hf_review_17_"+str(n) for n in range(1,5)],"unapproved fixture database")
  sql(task,"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='"+name+"' AND pid<>pg_backend_pid();",maintenance=True)
  sql(task,'DROP DATABASE IF EXISTS "'+name+'";',maintenance=True)
  absent=not sql(task,"SELECT datname FROM pg_database WHERE datname='"+name+"';",maintenance=True).stdout.strip()
  (evidence_dir(task)/"database-absence.json").write_text(json.dumps({"database":name,"observed_absent":absent})+"\n")
  print(json.dumps({"type":"cleanup","complete":absent,"resources":[{"id":"hf-review-"+task+"-database","status":"deleted" if absent else "unknown","observed_absent":absent,"evidence_artifact":"review/database-absence.json"}]}),flush=True)
  return 0 if absent else 1
 except Exception:
  print(json.dumps({"type":"cleanup","complete":False,"resources":[{"id":"hf-review-"+task+"-database","status":"unknown"}]}),flush=True);return 1
class Fixture:
 def __init__(self,task,base,components=None,extra_setup=None):
  self.extra_setup=extra_setup
  self.task=task;self.base=base;self.repo=base/"repository";self.repo.mkdir()
  self.events=[];self.commits=[]
  self.git("init","--initial-branch=main","--object-format=sha1")
  self.git("config","user.name","Review Fixture");self.git("config","user.email","fixture@example.invalid")
  self.git("config","commit.gpgsign","false");self.git("config","core.hooksPath","/dev/null")
  self.commit("base","price=100");self.pinned=self.git("rev-parse","HEAD").strip()
  self.first=self.commit("[spec:fixture/1.1] change units","price=100; units=cents")
  self.second=self.commit("[spec:fixture/1.1] change error order","price=100; units=cents; errors=auth-first")
  self.component_ids=components or ["17.1"]
  catalog={v["id"]:path.stem for path in (ROOT/"services/hyperfide/components").glob("*.json") if "id" in (v:=json.loads(path.read_text()))}
  linked=set(self.component_ids)
  def add_dependencies(name):
   for dep in json.loads((ROOT/f"services/hyperfide/components/{name}.json").read_text())["requires"]:
    filename=catalog[dep]
    if filename not in linked:linked.add(filename);add_dependencies(filename)
  for name in self.component_ids:add_dependencies(name)
  self.linked_components=linked
  self.identity=IdentityFixture(extra_components=sorted(linked),extra_env={
   "HYPERFIDE_REVIEW_ALLOWED_ROOT":str(base),
   "HYPERFIDE_REVIEW_REPOSITORIES":json.dumps({REPOSITORY:{"path":str(self.repo),"refs":["refs/heads/main"]}})},extra_setup=self.setup)
  self.watcher_policy={"revision":"1","mode":"ALL_COMMITS","watchers":[{"watcher_id":f"watcher-{n}","reviewer_session_id":xid(0x200+n),"rubric_digest":DIGEST,"review_class":f"class-{n}","path_prefixes":[]} for n in range(10)]}
  self.policy_digest=None
 def setup(self,f):
  global ORG,RUN,SCOPE
  ORG=f.ids["organisation"];RUN=f.ids["run"];SCOPE={"organisation_id":ORG,"run_id":RUN}
  (evidence_dir(self.task)/"fixture-database.json").write_text(json.dumps({"database":f.database})+"\n")
  self.preparing_identity=f
  migrations=["0002-spec","0004-durability"]
  if "5.1" in self.linked_components:migrations+=["0003-hierarchy","0032-execution-packets","0005-scheduling"]
  if any(name.startswith("7.") for name in self.linked_components):migrations+=["0007-graph"]
  if "12.1" in self.linked_components:migrations+=["0008-provider-coordination","0012-runner-registry"]
  for name in migrations:
   raw=(ROOT/("services/hyperfide/migrations/"+name+".sql")).read_bytes();version=int(name[:4])
   f.sql(raw.decode()+"\nINSERT INTO hyperfide.schema_migrations(version,name,checksum) VALUES("+str(version)+",'"+name+"','sha256:"+hashlib.sha256(raw).hexdigest()+"');")
  f.sql((ROOT/"services/hyperfide/migrations/0017-review.sql").read_text())
  f.sql("INSERT INTO hyperfide.repositories(organisation_id,project_id,id,name,url) VALUES($1,$2,$3,'review-fixture','https://example.invalid/review.git')",[ORG,f.ids["project"],REPOSITORY])
  f.sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES($1,$2,$3)",[ORG,REPOSITORY,self.pinned])
  f.sql("INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES($1,$2,$3,$4,'refs/heads/main')",[ORG,RUN,REPOSITORY,self.pinned])
  f.sql("INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES($1,$2,$3,'review-fixture',1)",[ORG,RUN,xid(0x300)])
  f.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) VALUES($1,$2,$3,'1.1',$4,$5,$6,'{}',1)",[ORG,RUN,xid(0x301),xid(0x300),f.ids["spec"],DIGEST])
  for number in range(10):self.session(number)
  if self.extra_setup:self.extra_setup(self,f)
 def git(self,*args):
  result=subprocess.run(["git",*args],cwd=self.repo,capture_output=True,text=True,timeout=20)
  expect(result.returncode==0,"fixture Git operation failed");return result.stdout
 def commit(self,message,body=None):
  if body is not None:(self.repo/"api.txt").write_text(body+"\n");self.git("add","api.txt")
  self.git("commit","--allow-empty","-m",message);commit=self.git("rev-parse","HEAD").strip();self.commits.append(commit);return commit
 def session(self,number):
  f=getattr(self,"preparing_identity",None)
  if self.task in ["17.3","17.4"] and f:
   slot=xid(0x600+number);kind="REVIEW" if self.task=="17.3" else "TEST"
   f.sql("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind) VALUES($1,$2,$3,$4,1,$5)",[ORG,slot,f.ids["sandbox"],"watcher-"+str(number),kind])
   f.sql("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id,slot_id,sandbox_id,sandbox_boot_generation) VALUES($1,$2,$3,'COMMIT_WATCHER','fixture','fixture',$4,$5,$6,1)",[ORG,RUN,xid(0x200+number),"watcher-"+str(number),slot,f.ids["sandbox"]])
  else:
   sql(self.task,"INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id) VALUES('"+ORG+"','"+RUN+"','"+xid(0x200+number)+"','COMMIT_WATCHER','fixture','fixture','watcher-"+str(number)+"');")
 def request(self,action,value=None,component="17.1",extra_env=None,key="operator"):
  if extra_env:
   self.identity.stop();self.identity.env.update(extra_env);self.identity.start()
  status,result=self.identity.invoke(action,value or {},component=component,key=key)
  self.events.append({"action":action,"http_status":status,"ok":result.get("ok"),"error_code":result.get("error",{}).get("code")})
  return SimpleNamespace(returncode=0 if result.get("ok") else 1),result
 def ok(self,action,value,**kwargs):
  child,result=self.request(action,value,**kwargs);expect(child.returncode==0 and result.get("ok") is True,"positive service operation refused: "+str(result.get("error")));return result["result"]
 def reject(self,action,value,code,**kwargs):
  child,result=self.request(action,value,**kwargs);expect(child.returncode!=0 and result.get("error",{}).get("code")==code,"wrong refusal: "+str(result.get("error")))
 def configure(self,policy=None,extra_env=None):
  result=self.ok("review.policy.configure",dict(SCOPE,policy=policy or self.watcher_policy),extra_env=extra_env)
  self.policy_digest=result["policy_digest"];return result
 def discover(self,batch=64):
  return self.ok("review.commits.discover",dict(SCOPE,repository_id=REPOSITORY,batch_size=batch))
 def coverage(self,commit,**fields):
  return self.ok("review.coverage.inspect",dict(SCOPE,repository_id=REPOSITORY,source_object_id=commit,**fields))
 def save(self,failed):
  (evidence_dir(self.task)/"observations.json").write_text(json.dumps({"task":self.task,"scope":"task-component","frontier_reviews":0,"service_operations":self.events,"failed_ids":failed},sort_keys=True)+"\n")
def cases(f):
 def configure():
  result=f.configure();expect(result["watchers"]==10 and result["mode"]=="ALL_COMMITS","configured watcher policy not exact")
 check(IDS[0],configure)
 v=copy.deepcopy(f.watcher_policy);v["watchers"].pop()
 check(IDS[1],lambda:f.reject("review.policy.configure",dict(SCOPE,policy=v),"REVIEW_POLICY_INVALID"))
 v=copy.deepcopy(f.watcher_policy);v["watchers"][1]["reviewer_session_id"]=v["watchers"][0]["reviewer_session_id"]
 check(IDS[2],lambda:f.reject("review.policy.configure",dict(SCOPE,policy=v),"REVIEW_POLICY_INVALID"))
 v=copy.deepcopy(f.watcher_policy);v["mode"]="SPECIALIST"
 for watcher in v["watchers"]:watcher["path_prefixes"]=["api.txt"]
 check(IDS[3],lambda:f.reject("review.policy.configure",dict(SCOPE,policy=v),"REVIEW_SHARDING_APPROVAL_REQUIRED"))
 check(IDS[4],lambda:f.reject("review.policy.configure",dict(SCOPE,policy=v,approved=True),"REVIEW_INPUT_INVALID"))
 def first():
  result=f.discover(1);expect(result["discovered"]==1 and result["remaining"]==1 and result["complete"] is False and result["obligations_created"]==10,"first real Git batch lost obligations")
 check(IDS[5],first)
 def second():
  result=f.discover(1);expect(result["discovered"]==1 and result["remaining"]==0 and result["complete"] is True and result["obligations_created"]==10,"second real Git batch incomplete")
 check(IDS[6],second)
 def replay():
  result=f.discover();expect(result["discovered"]==0 and result["obligations_created"]==0,"discovery replay duplicated durable work")
 check(IDS[7],replay)
 def all_watchers():
  result=f.coverage(f.second);expect(result["required"]==10 and result["complete"]==0 and len(result["missing"])==10 and result["status"]=="INCOMPLETE","all-watcher default omitted obligations")
  expect(sql(f.task,"SELECT count(*) FROM hyperfide.review_obligations;").stdout.strip()=="20","database obligation count differs")
 check(IDS[8],all_watchers)
 check(IDS[9],lambda:f.reject("review.coverage.inspect",dict(SCOPE,repository_id=REPOSITORY,source_object_id=f.second,complete=True),"REVIEW_INPUT_INVALID"))
 def omission():
  sql(f.task,"DELETE FROM hyperfide.review_obligations WHERE source_object_id='"+f.second+"' AND watcher_id='watcher-0';")
  result=f.coverage(f.second);expect(result["required"]==10 and any(v["reason"]=="OBLIGATION_MISSING" for v in result["missing"]),"missing obligation inflated coverage")
 check(IDS[10],omission)
 def repair():
  expect(f.discover()["obligations_created"]==1,"discovery did not restore missing durable obligation")
 check(IDS[11],repair)
 def rewrite():
  f.git("reset","--hard",f.pinned);f.rewritten=f.commit("[spec:fixture/1.1] rewritten history","price=7")
  result=f.discover();expect(len(result["rewrites"])==1 and result["discovered"]==1,"history rewrite not recorded")
 check(IDS[12],rewrite)
 def history():
  expect(sql(f.task,"SELECT count(*) FROM hyperfide.review_commits;").stdout.strip()=="3","rewriting a ref discarded commit history")
  expect(sql(f.task,"SELECT count(*) FROM hyperfide.review_obligations;").stdout.strip()=="30","rewriting a ref discarded obligations")
 check(IDS[13],history)
 old=f.policy_digest
 def replace():
  f.session(20);v=copy.deepcopy(f.watcher_policy);v["revision"]="2";v["watchers"][0]["reviewer_session_id"]=xid(0x214)
  result=f.configure(v);expect(result["policy_digest"]!=old,"watcher replacement reused prior policy identity")
  expect(f.discover()["obligations_created"]==30,"replacement policy omitted historical commits")
 check(IDS[14],replace)
 def old_stale():
  result=f.coverage(f.first,policy_digest=old,candidate_digest=DIGEST,input_manifest_digest=DIGEST)
  expect(result["status"]=="STALE" and result["complete"]==0,"old watcher policy granted current coverage")
 check(IDS[15],old_stale)
 def untagged():
  commit=f.commit("untagged real change","price=9");result=f.discover()
  expect(commit in result["unattributed"] and result["obligations_created"]==10,"unattributed commit escaped watcher coverage")
 check(IDS[16],untagged)
 def empty():
  commit=f.commit("[spec:fixture/1.1] metadata only");result=f.discover()
  expect(result["discovered"]==1 and f.coverage(commit)["required"]==10,"empty commit escaped default watchers")
 check(IDS[17],empty)
 check(IDS[18],lambda:f.reject("review.commits.discover",dict(SCOPE,repository_id=REPOSITORY,checkout_path="/root"),"REVIEW_INPUT_INVALID"))
 check(IDS[19],lambda:f.reject("review.commits.discover",dict(SCOPE,run_id=xid(404),repository_id=REPOSITORY),"REVIEW_SCOPE_DENIED"))
def main():
 with tempfile.TemporaryDirectory(prefix="hf-review-17-1-") as temp:
  f=Fixture("17.1",Path(temp))
  try:cases(f)
  finally:
   f.identity.close();f.save(FAILED)
 return 1 if FAILED else 0
if __name__=="__main__":sys.exit(cleanup("17.1") if "--cleanup" in sys.argv else main())
