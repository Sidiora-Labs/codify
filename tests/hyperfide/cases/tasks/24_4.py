#!/usr/bin/env python3
"""Registered recovery drill tests: proposed then measured RPO/RTO through the real control service.

DATABASE/RESTORE use the isolated PostgreSQL18 producer; OBJECT/GIT/AUTH/FULL_DISK/PROVIDER use owned
local fixtures (PROVIDER is a loopback fake: live Railway/Blaxel rehearsal is BLOCKED). Component scope only.
"""
from pathlib import Path
import hashlib,importlib.util,json,os,shutil,sys,tempfile,time
spec=importlib.util.spec_from_file_location("recovery_common",Path(__file__).with_name("24_1.py"));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ROOT=Path(__file__).resolve().parents[4]
SCENARIOS=["DATABASE","OBJECT","GIT","PROVIDER","AUTH","FULL_DISK","RESTORE"]
RPO="ACKNOWLEDGED_ID_LOSS_COUNT_ONLY_NO_TIME_BOUND_INFERRED"
PROFILE={}
def profile_setup():
 producer=ROOT/"tests/hyperfide/cases/support/postgres_drills.py"
 python=os.path.realpath("/usr/bin/python3") if os.path.exists("/usr/bin/python3") else os.path.realpath(sys.executable)
 folder=Path(tempfile.mkdtemp(prefix="hf-drill-profile-",dir="/tmp"));folder.chmod(0o700)
 evidence=Path(os.path.realpath(m.observation_dir()))/"drill-evidence"
 shutil.rmtree(evidence,ignore_errors=True);evidence.mkdir(mode=0o700);evidence.chmod(0o700)
 value={"schema_version":1,"scope":"ISOLATED_POSTGRESQL_FIXTURE","python_path":python,"producer_path":str(producer),
  "producer_sha256":hashlib.sha256(producer.read_bytes()).hexdigest(),"evidence_directory":str(evidence),"timeout_ms":240000}
 path=folder/"profile.json";path.write_text(json.dumps(value));path.chmod(0o600)
 PROFILE.update(folder=folder,path=path,evidence=evidence,value=value)
 os.environ["HYPERFIDE_RECOVERY_PROBE_PROFILE"]=str(path)
def execute(f,op):return f.ok("recovery.drill.execute",{"scope":m.SCOPE,"operation_id":op})
def wait(f,op,deadline=240):
 end=time.monotonic()+deadline
 while True:
  row=f.ok("recovery.drill.inspect",{"scope":m.SCOPE,"operation_id":op})
  if row["terminal"] or time.monotonic()>end:return row
  time.sleep(.5)
def retained(op,expected):
 manifest=PROFILE["evidence"]/op/"evidence.json"
 return manifest.is_file() and "sha256:"+hashlib.sha256(manifest.read_bytes()).hexdigest()==expected
def tests(f):
 described=f.ok("recovery.drill.describe",{})
 m.check("recovery.drill.real-process",lambda:m.expect(described["targets"]=="PROPOSED_UNTIL_MEASURED"))
 m.check("recovery.drill.rpo-label",lambda:m.expect(described["rpo_measurement"]==RPO and described["measured_rpo_ms"] is None and described["scenario_scopes"]["PROVIDER"]=="PROVIDER_FAKE_LOOPBACK"))
 ops={}
 for n,scenario in enumerate(SCENARIOS):
  ops[scenario]=m.uid(50+n)
  request={"scope":m.SCOPE,"operation_id":ops[scenario],"scenario":scenario,"proposed_rpo_ms":0,"proposed_rto_ms":300000}
  result=f.ok("recovery.drill.plan",request)
  m.check("recovery.drill.proposed-"+scenario.lower(),lambda result=result:m.expect(result["state"]=="PROPOSED" and result["qualified"] is False and result["measured_rto_ms"] is None and result["rpo_measurement"]==RPO))
 m.check("recovery.drill.no-invented-measurements",lambda:m.expect(m.sql("SELECT count(*) FROM hyperfide.recovery_drill_runs WHERE measured_rto_ms IS NOT NULL;")=="0"))
 request={"scope":m.SCOPE,"operation_id":ops["DATABASE"],"scenario":"DATABASE","proposed_rpo_ms":0,"proposed_rto_ms":300000}
 inspected=f.ok("recovery.drill.inspect",{"scope":m.SCOPE,"operation_id":ops["DATABASE"]})
 m.check("recovery.drill.primary-inspection",lambda:m.expect(inspected["source"]=="primary-transaction" and inspected["drill"]["state"]=="PROPOSED" and inspected["replay_disruptive_execution"] is False))
 m.check("recovery.drill.plan-replay",lambda:m.expect(f.ok("recovery.drill.plan",request)["state"]=="PROPOSED"))
 m.check("recovery.drill.plan-conflict",lambda:f.rejected("recovery.drill.plan",{**request,"proposed_rto_ms":1},"RECOVERY_IDEMPOTENCY_CONFLICT"))
 state=lambda op:m.sql("SELECT state FROM hyperfide.recovery_drill_runs WHERE operation_id='"+op+"';")
 def unconfigured():
  moved=PROFILE["path"].with_name("profile.removed");PROFILE["path"].rename(moved)
  try:f.rejected("recovery.drill.execute",{"scope":m.SCOPE,"operation_id":ops["DATABASE"]},"RECOVERY_PROBE_NOT_CONFIGURED")
  finally:moved.rename(PROFILE["path"])
  m.expect(state(ops["DATABASE"])=="PROPOSED","Refused execution changed drill state")
 m.check("recovery.drill.unconfigured-profile-refusal",unconfigured)
 def tampered():
  PROFILE["path"].write_text(json.dumps({**PROFILE["value"],"producer_sha256":"0"*64}))
  try:f.rejected("recovery.drill.execute",{"scope":m.SCOPE,"operation_id":ops["DATABASE"]},"RECOVERY_PROBE_NOT_CONFIGURED")
  finally:PROFILE["path"].write_text(json.dumps(PROFILE["value"]))
  m.expect(state(ops["DATABASE"])=="PROPOSED","Refused execution changed drill state")
 m.check("recovery.drill.tampered-profile-refusal",tampered)
 m.check("recovery.drill.reject-self-reported-proof",lambda:f.rejected("recovery.drill.execute",{"scope":m.SCOPE,"operation_id":ops["DATABASE"],"recovered":True},"RECOVERY_INPUT_INVALID"))
 m.check("recovery.drill.reject-negative-target",lambda:f.rejected("recovery.drill.plan",{**request,"operation_id":m.uid(99),"proposed_rpo_ms":-1},"RECOVERY_INPUT_INVALID"))
 m.check("recovery.drill.stale-epoch",lambda:f.rejected("recovery.drill.plan",{**request,"operation_id":m.uid(98),"scope":{**m.SCOPE,"authority_epoch":m.uid(98)}},"RECOVERY_STALE_EPOCH"))
 # Disruptive drills run asynchronously in the registered service, one at a time; inspection observes the outcome.
 started={};rows={}
 for scenario in SCENARIOS:
  started[scenario]=execute(f,ops[scenario]);rows[scenario]=wait(f,ops[scenario])
 m.check("recovery.drill.execute-async",lambda:m.expect(all(started[s]["state"]=="RUNNING" and started[s]["poll"]=="recovery.drill.inspect" and started[s]["requires_reconciliation_before_resume"] is True for s in SCENARIOS)))
 def measured(scenario):
  row=rows[scenario];d=row["drill"]
  if scenario=="FULL_DISK" and d["state"]=="FAILED":
   # Unprivileged sandboxes cannot mount the bounded quota: recorded as UNVERIFIED, never as measured.
   m.expect(d["limits"].startswith("UNVERIFIED_PRIVILEGE") and d["measured_rto_ms"] is not None,"Full-disk refusal lacks explicit UNVERIFIED label");return
  m.expect(d["state"]=="MEASURED",scenario+" drill not measured: "+json.dumps(d,default=str)[:600])
  m.expect(d["measured_rto_ms"] is not None and int(d["measured_rto_ms"])>=0 and int(d["proposed_rto_ms"])==300000,"RTO not measured separately from proposal")
  m.expect(d["recovery_epoch"] and d["recovery_epoch"]!=d["source_epoch"]==m.SCOPE["authority_epoch"],"Recovery epoch reused")
  m.expect(int(d["acknowledged_count"])>0 and int(d["acknowledged_loss_count"])==0 and int(d["recovered_count"])>=int(d["acknowledged_count"]),"Acknowledged identities lost")
  m.expect(row["measured_rpo_ms"] is None and row["rpo_measurement"]==RPO and row["qualified"] is False,"RPO label or qualification claim changed")
  m.expect(retained(ops[scenario],d["evidence_digest"]),"Evidence digest differs from retained bytes")
 for scenario in SCENARIOS:
  m.check("recovery.drill.measured-"+scenario.lower(),lambda scenario=scenario:measured(scenario))
 m.check("recovery.drill.provider-fake-scope",lambda:m.expect(rows["PROVIDER"]["drill"]["limits"].startswith("PROVIDER_FAKE_LOOPBACK") and "BLOCKED" in rows["PROVIDER"]["drill"]["limits"]))
 def no_replay():
  before=sorted(p.name for p in PROFILE["evidence"].iterdir())
  replay=execute(f,ops["DATABASE"])
  m.expect(replay["replayed"] is True and replay["replay_disruptive_execution"] is False and replay["drill"]["evidence_digest"]==rows["DATABASE"]["drill"]["evidence_digest"],"Measured drill was not replayed from record")
  m.expect(sorted(p.name for p in PROFILE["evidence"].iterdir())==before,"Replay ran a new disruptive probe")
 m.check("recovery.drill.no-disruptive-replay",no_replay)
 workers=lambda s:(rows[s]["drill"]["reconciliation"] or {}).get("stale_workers",{})
 m.check("recovery.drill.database-old-epoch-fenced",lambda:m.expect(workers("DATABASE").get("presented",0)>=1 and workers("DATABASE")["fenced"]==workers("DATABASE")["presented"] and workers("DATABASE")["current_accepted"] is True))
 restore=rows["RESTORE"]["drill"]
 m.check("recovery.drill.restore-stale-worker-fenced",lambda:f.rejected("recovery.drill.accept_result",{"scope":m.SCOPE,"operation_id":ops["RESTORE"],"worker_epoch":restore["source_epoch"],"result_digest":m.D},"RECOVERY_STALE_WORKER_FENCED"))
 def blocked():
  m.expect(rows["RESTORE"]["requires_reconciliation_before_resume"] is True,"Resume not blocked after restore")
  f.rejected("recovery.drill.accept_result",{"scope":m.SCOPE,"operation_id":ops["RESTORE"],"worker_epoch":restore["recovery_epoch"],"result_digest":m.D},"RECOVERY_RECONCILIATION_REQUIRED")
 m.check("recovery.drill.restore-requires-reconciliation",blocked)
 def reconciled():
  value=f.ok("recovery.drill.reconcile",{"scope":m.SCOPE,"operation_id":ops["RESTORE"]});r=value["reconciliation"]
  m.expect(value["resume_authorized"] is True and value["authorized_epoch"]==restore["recovery_epoch"] and restore["source_epoch"] in value["fenced_epochs"],"Resume authority not bound to recovered epoch")
  m.expect(r["stale_workers"]["presented"]>=2 and r["stale_workers"]["fenced"]==r["stale_workers"]["presented"],"Pre-restore workers not fenced")
  m.expect(r["external_effects"]["orphans_removed"]>=1 and r["external_effects"]["adopted"]>=1 and r["external_effects"]["unresolved"]==0,"Provider inventory/outstanding operations not reconciled")
 m.check("recovery.drill.restore-reconciled",reconciled)
 m.check("recovery.drill.restore-current-worker-accepted",lambda:m.expect(f.ok("recovery.drill.accept_result",{"scope":m.SCOPE,"operation_id":ops["RESTORE"],"worker_epoch":restore["recovery_epoch"],"result_digest":m.D})["accepted"] is True))
 def all_reconciled():
  for scenario in SCENARIOS:
   if scenario=="RESTORE" or rows[scenario]["drill"]["state"]!="MEASURED":continue
   value=f.ok("recovery.drill.reconcile",{"scope":m.SCOPE,"operation_id":ops[scenario]})
   m.expect(value["resume_authorized"] is True and value["reconciliation"]["external_effects"]["unresolved"]==0,scenario+" not reconciled")
 m.check("recovery.drill.all-scenarios-reconciled",all_reconciled)
 unplanned={"scope":m.SCOPE,"operation_id":m.uid(60),"scenario":"OBJECT","proposed_rpo_ms":0,"proposed_rto_ms":60000}
 f.ok("recovery.drill.plan",unplanned)
 m.check("recovery.drill.reconcile-unmeasured-refused",lambda:f.rejected("recovery.drill.reconcile",{"scope":m.SCOPE,"operation_id":m.uid(60)},"RECOVERY_RECONCILIATION_REQUIRED"))
 def incomplete():
  m.sql("UPDATE hyperfide.recovery_drill_runs SET resume_state='BLOCKED',reconciliation=jsonb_set(reconciliation,'{external_effects,unresolved}','1') WHERE operation_id='"+ops["OBJECT"]+"';")
  f.rejected("recovery.drill.reconcile",{"scope":m.SCOPE,"operation_id":ops["OBJECT"]},"RECOVERY_RECONCILIATION_INCOMPLETE")
  f.rejected("recovery.drill.accept_result",{"scope":m.SCOPE,"operation_id":ops["OBJECT"],"worker_epoch":rows["OBJECT"]["drill"]["recovery_epoch"],"result_digest":m.D},"RECOVERY_RECONCILIATION_REQUIRED")
 m.check("recovery.drill.incomplete-reconciliation-refused",incomplete)
 def identity_expiry():
  # Credential expiry against the actual identity fixture: the expired operator is refused, renewal restores access.
  credential=f.identity.ids["operator"]
  m.sql("UPDATE hyperfide.identity_principals SET expires_at=clock_timestamp()-interval '1 minute' WHERE credential_id='"+credential+"';")
  try:
   refused=f.request("recovery.drill.describe",{})
   m.expect(refused.get("ok") is False,"Expired credential was accepted: "+json.dumps(refused)[:300])
  finally:m.sql("UPDATE hyperfide.identity_principals SET expires_at=clock_timestamp()+interval '1 hour' WHERE credential_id='"+credential+"';")
  m.expect(f.ok("recovery.drill.describe",{})["targets"]=="PROPOSED_UNTIL_MEASURED","Renewed credential was not accepted")
 m.check("recovery.drill.auth-identity-expiry",identity_expiry)
 index={s:{"operation_id":ops[s],"drill":rows[s]["drill"],"evidence":sorted(p.name for p in (PROFILE["evidence"]/ops[s]).iterdir()) if (PROFILE["evidence"]/ops[s]).is_dir() else []} for s in SCENARIOS}
 m.observation_dir().joinpath("drill-evidence.json").write_text(json.dumps({"schema_version":1,"rpo_measurement":RPO,"scope":"task-component","drills":index},default=str,indent=1)+"\n")
def main():
 m.TASK="24.4"
 if sys.argv[1:]==["--cleanup"]:return 0 if m.cleanup() else 1
 if sys.argv[1:]:raise SystemExit("unsupported argument")
 fixture=None
 try:
  profile_setup();fixture=m.setup("24.4");tests(fixture)
 finally:
  if fixture:fixture.close()
  if PROFILE.get("folder"):shutil.rmtree(PROFILE["folder"],ignore_errors=True)
 # The registered cleanup_argv owns database removal and the single cleanup event.
 return 1 if m.FAILED else 0
if __name__=="__main__":sys.exit(main())
