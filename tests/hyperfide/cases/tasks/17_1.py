#!/usr/bin/env python3
"""Real Git/PostgreSQL watcher-obligation component tests; no frontier review claims."""
from __future__ import annotations
import ast,copy,hashlib,json,os
from pathlib import Path
import subprocess,sys,tempfile
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
def database(task):return "hf_review_"+task.replace(".","_")
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
  name=database(task);expect(name in [database(f"17.{n}") for n in range(1,5)],"unapproved fixture database")
  sql(task,"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='"+name+"' AND pid<>pg_backend_pid();",maintenance=True)
  sql(task,'DROP DATABASE IF EXISTS "'+name+'";',maintenance=True)
  absent=not sql(task,"SELECT datname FROM pg_database WHERE datname='"+name+"';",maintenance=True).stdout.strip()
  (evidence_dir(task)/"database-absence.json").write_text(json.dumps({"database":name,"observed_absent":absent})+"\n")
  print(json.dumps({"type":"cleanup","complete":absent,"resources":[{"id":"hf-review-"+task+"-database","status":"deleted" if absent else "unknown","observed_absent":absent,"evidence_artifact":"review/database-absence.json"}]}),flush=True)
  return 0 if absent else 1
 except Exception:
  print(json.dumps({"type":"cleanup","complete":False,"resources":[{"id":"hf-review-"+task+"-database","status":"unknown"}]}),flush=True);return 1
class Fixture:
 def __init__(self,task,base,components=None):
  self.task=task;self.base=base;self.repo=base/"repository";self.repo.mkdir()
  self.events=[];self.commits=[]
  self.git("init","--initial-branch=main","--object-format=sha1")
  self.git("config","user.name","Review Fixture");self.git("config","user.email","fixture@example.invalid")
  self.git("config","commit.gpgsign","false");self.git("config","core.hooksPath","/dev/null")
  self.commit("base","price=100")
  self.pinned=self.git("rev-parse","HEAD").strip()
  self.first=self.commit("[spec:fixture/1.1] change units","price=100; units=cents")
  self.second=self.commit("[spec:fixture/1.1] change error order","price=100; units=cents; errors=auth-first")
  sql(task,'CREATE DATABASE "'+database(task)+'";',maintenance=True)
  sql(task,(ROOT/"services/hyperfide/migrations/0001-authority.sql").read_text())
  sql(task,(ROOT/"services/hyperfide/migrations/0017-review.sql").read_text())
  tree=ast.parse((ROOT/"tests/hyperfide/cases/tasks/4_1.py").read_text())
  seed=next(ast.literal_eval(node.value) for node in tree.body if isinstance(node,ast.Assign) and any(isinstance(name,ast.Name) and name.id=="SEED" for name in node.targets))
  sql(task,seed.replace("repeat('a',40)","'"+self.pinned+"'"))
  for number in range(10):self.session(number)
  self.policy={"schema_version":1,"programme_id":"review-fixture","repository":"fixture/repository","spec_revision":"review-spec","policy_revision":1,"status":"ACTIVE",
    "approval":{"decision":"APPROVED","record_id":"fixture-owner","spec_revision":"review-spec","policy_revision":1},
    "allowed_roles":["control"],"allowed_actions":["programme.activate"]}
  self.component_ids=components or ["1.4","4.1","17.1"]
  self.component_dir=base/"components";self.component_dir.mkdir()
  for identity in self.component_ids:
   p=ROOT/f"services/hyperfide/components/{identity}.json";declaration=json.loads(p.read_text())
   self.policy["allowed_actions"]+=declaration["actions"];(self.component_dir/p.name).write_bytes(p.read_bytes())
  self.policy_path=base/"policy.json";self.policy_path.write_text(json.dumps(self.policy))
  self.watcher_policy={"revision":"1","mode":"ALL_COMMITS","watchers":[{"watcher_id":f"watcher-{n}","reviewer_session_id":xid(0x200+n),"rubric_digest":DIGEST,"review_class":f"class-{n}","path_prefixes":[]} for n in range(10)]}
  self.policy_digest=None
 def git(self,*args):
  result=subprocess.run(["git",*args],cwd=self.repo,capture_output=True,text=True,timeout=20)
  expect(result.returncode==0,"fixture Git operation failed");return result.stdout
 def commit(self,message,body=None):
  if body is not None:(self.repo/"api.txt").write_text(body+"\n");self.git("add","api.txt")
  self.git("commit","--allow-empty","-m",message);commit=self.git("rev-parse","HEAD").strip();self.commits.append(commit);return commit
 def session(self,number):
  sql(self.task,"INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id) VALUES('"+ORG+"','"+RUN+"','"+xid(0x200+number)+"','COMMIT_WATCHER','fixture','fixture','watcher-"+str(number)+"');")
 def request(self,action,value=None,component="17.1",extra_env=None):
  env=database_env(self.task);env.update({"HYPERFIDE_REVIEW_ALLOWED_ROOT":str(self.base),
   "HYPERFIDE_REVIEW_REPOSITORIES":json.dumps({REPOSITORY:{"path":str(self.repo),"refs":["refs/heads/main"]}})})
  if extra_env:env.update(extra_env)
  child=subprocess.run(["node",str(ROOT/"services/hyperfide/dist/control.js"),"--policy",str(self.policy_path),"--spec-revision","review-spec","--components",str(self.component_dir),"--module-root",str(ROOT/"services/hyperfide/dist")],
   cwd=ROOT,env=env,input=json.dumps({"id":"review-test","component":component,"action":action,"input":value or {}})+"\n",text=True,capture_output=True,timeout=60)
  lines=[line for line in child.stdout.splitlines() if line.strip()]
  expect(len(lines)==1,"actual service did not emit one JSONL response: "+child.stderr[:400])
  result=json.loads(lines[0]);self.events.append({"action":action,"ok":result.get("ok"),"error_code":result.get("error",{}).get("code")})
  return child,result
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
 check(IDS[19],lambda:f.reject("review.commits.discover",dict(SCOPE,run_id=xid(404),repository_id=REPOSITORY),"REVIEW_SCOPE_INVALID"))
def main():
 with tempfile.TemporaryDirectory(prefix="hf-review-17-1-") as temp:
  f=Fixture("17.1",Path(temp))
  try:cases(f)
  finally:f.save(FAILED)
 return 1 if FAILED else 0
if __name__=="__main__":sys.exit(cleanup("17.1") if "--cleanup" in sys.argv else main())
