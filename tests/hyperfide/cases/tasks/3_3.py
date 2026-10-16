#!/usr/bin/env python3
"""Scoped hierarchy observations through actual signed HTTPS and PostgreSQL."""
from __future__ import annotations
import importlib.util,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
s=importlib.util.spec_from_file_location("hf_hierarchy_view_fixture",ROOT/"tests/hyperfide/cases/tasks/3_1.py");m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
FAILED=[]
def expect(value,message):
 if not value:raise AssertionError(message)
def check(identity,fn):
 try:fn();actual="observed"
 except Exception as e:FAILED.append(identity);actual=type(e).__name__+": "+str(e)
 print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
def setup(f):
 i=f.ids
 for n in range(120):
  f.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,2,$9)",[i["organisation"],i["run"],m.uid(),"alpha.view."+str(n).zfill(3),i["package2"],i["spec"],m.sha(b"view-criteria"),json.dumps({"feature_key":"alpha","purpose":"Bounded view fixture"}),"BLOCKED" if n<20 else "PENDING"])
def main():
 f=m.HierarchyFixture(extra_components=("3.3",),extra_setup=setup);i=f.ids;state={}
 base={"leader_generation":"1","page_size":100,"max_bytes":262144}
 try:
  def read():
   state.update(f.ok("hierarchy.view",base,component="3.3"));expect(state["authority"]=="NONE" and state["provenance"]["source"]=="POSTGRESQL_PRIMARY","Observation asserted authority or omitted provenance")
  check("views.primary.signed",read)
  check("views.aggregate-totals",lambda:expect(state["total_tasks"]=="122" and state["blocking_task_count"]=="20" and state["has_blocking_exceptions"] is True,"Bounded rows hid total or blocking counts"))
  check("views.page-bounded",lambda:expect(len(state["tasks"])==100 and state["page"]["has_more"] is True and state["omitted_context"]["tasks"]=="22","Page did not preserve bounded/omitted semantics"))
  def budget():
   result=f.ok("hierarchy.view",dict(base,max_bytes=4096),component="3.3")
   expect(len(json.dumps(result,sort_keys=True,separators=(",",":")).encode())<=4096 and len(result["tasks"])>=1 and result["blocking_task_count"]=="20" and result["has_blocking_exceptions"] is True,"Budget lost complete task or mandatory blocking totals")
  check("views.budget-preserves-mandatory",budget)
  manager=dict(base,package_id=i["package2"],package_generation="2")
  check("views.manager-scoped",lambda:expect(all(t["feature_package_id"]==i["package2"] for t in f.ok("hierarchy.view",manager,key="manager",component="3.3")["tasks"]),"Manager view leaked another package"))
  check("views.manager-unscoped-denied",lambda:f.reject("hierarchy.view",base,"PACKAGE_REQUIRED",key="manager",component="3.3"))
  check("views.unowned-package-denied",lambda:f.reject("hierarchy.view",dict(base,package_id=i["wave_package"],package_generation="2"),"PACKAGE_OWNER_MISMATCH",key="manager",component="3.3"))
  check("views.stale-package-generation",lambda:f.reject("hierarchy.view",dict(manager,package_generation="1"),"PACKAGE_GENERATION_STALE",key="manager",component="3.3"))
  check("views.unsupported-role-denied",lambda:f.reject("hierarchy.view",base,"ROLE_DENIED",key="watcher",component="3.3"))
  check("views.cursor-requires-pins",lambda:f.reject("hierarchy.view",dict(base,after_task_key=state["page"]["next_task_key"]),"VIEW_CURSOR_UNPINNED",component="3.3"))
  cursor=dict(base,after_task_key=state["page"]["next_task_key"],expected_spec_generation=state["page"]["spec_generation"],expected_run_version=state["page"]["run_state_version"])
  check("views.cursor-continuation",lambda:expect(len(f.ok("hierarchy.view",cursor,component="3.3")["tasks"])==22,"Continuation omitted or duplicated rows"))
  f.sql("UPDATE hyperfide.runs SET state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[i["organisation"],i["run"]])
  check("views.cursor-stale-refused",lambda:f.reject("hierarchy.view",cursor,"VIEW_CURSOR_STALE",component="3.3"))
  check("views.request-scope-spoof-refused",lambda:f.reject("hierarchy.view",dict(base,run_id=m.uid()),"INVALID_REQUEST",component="3.3"))
  check("views.invalid-budget-refused",lambda:f.reject("hierarchy.view",dict(base,max_bytes=4095),"INVALID_REQUEST",component="3.3"))
 finally:
  database=f.database;path=f.path;f.close()
  check("views.cleanup.observed",lambda:expect(not path.exists() and f.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[database],admin=True)[0]["n"]==0,"Fixture remains"))
 return 1 if FAILED else 0
if __name__=="__main__":
 if "--cleanup" in sys.argv:print(json.dumps({"type":"cleanup","complete":True,"resources":[]}));raise SystemExit(0)
 raise SystemExit(main())
