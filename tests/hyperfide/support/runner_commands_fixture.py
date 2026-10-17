#!/usr/bin/env python3
"""Actual06 signed HTTPS/PG command delivery checks.
Native reports here are explicit component-fixture receipts, not live execution
or whole RUNNER qualification. Integrated daemon/native tests are separate.
"""
from __future__ import annotations
import importlib.util,json,os,signal,sqlite3,sys,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
module=importlib.util.spec_from_file_location("actual_events_fixture",ROOT/"tests/hyperfide/cases/tasks/6_1.py")
base=importlib.util.module_from_spec(module);module.loader.exec_module(base)
base.TASK="6.3"
FAILURES=[];COUNT=0
def check(name,fn):
 global COUNT
 COUNT+=1
 try:fn();actual="observed"
 except Exception as error:actual=type(error).__name__+": "+str(error);FAILURES.append(name)
 print(json.dumps({"type":"assertion","id":"runner-poll."+name,"expected":"observed","actual":actual}),flush=True)
def expect(value,message):base.expect(value,message)
class Service(base.Service):
 def __init__(self):super().__init__(include_instructions=True)
 def enroll_runner(self):
  expect(self.bind()[1].get("ok") is True,"Actual trusted provider binding failed")
  allowed=["identity.describe","instructions.handoff","instructions.ack","instructions.lookup-native","instructions.consumer.register","instructions.runner.poll"]
  result=self.invoke("identity.grant.issue",{"grant_id":self.grant,"provisioning_intent_id":self.ids["intent"],
   "verifier":base.identity.sha(self.secret),"allowed_actions":allowed,"ttl_seconds":300})
  expect(result[1].get("ok") is True,"Actual one-time grant failed: "+str(result[1].get("error")))
  enrolled=self.request(self.enrollment(),key="runner",endpoint="/v1/enroll",credential=self.grant)
  expect(enrolled[1].get("ok") is True,"Actual RUNNER enrollment failed")
  self.runner_credential=enrolled[1]["result"]["credential_id"]
 def poll(self,limit=16):
  return self.ok("instructions.runner.poll",dict(base.S,limit=limit,lease_ms=1000),runner=True)
def setup():
 f=Service();base.ACTIVE=f;base.S={"organisation_id":f.ids["organisation"],"run_id":f.ids["run"]}
 base.seed_native_attempt(f);f.enroll_runner();return f
def register(f):return f.ok("instructions.consumer.register",dict(base.S,consumer_id=base.CONSUMER),runner=True)
def due():time.sleep(1.08)
def state(f,event):return f.sql("SELECT state FROM hyperfide.event_deliveries WHERE event_id=$1 AND consumer_id=$2",[event,base.CONSUMER])[0]["state"]
def issue(f,n,kind):
 c=base.command(n,kind);f.ok("instructions.issue",c);return c
def basic():
 f=setup()
 try:
  check("missing-consumer-refused",lambda:f.reject("instructions.runner.poll",dict(base.S,limit=1,lease_ms=1000),"INSTRUCTION_CONSUMER_REQUIRED",runner=True))
  registered=register(f)
  check("actual-boot-registration",lambda:expect(registered["boot_id"]==f.ids["boot"] and not registered["execution_authority"],"Actual consumer identity differs"))
  check("empty-no-authority",lambda:expect(f.poll()["commands"]==[] and f.poll()["execution_authority"] is False,"Empty poll acquired authority"))
  check("operator-cannot-poll",lambda:f.reject("instructions.runner.poll",dict(base.S,limit=1,lease_ms=1000),"AUTH_ROLE_DENIED",runner=False))
  check("caller-consumer-refused",lambda:f.reject("instructions.runner.poll",dict(base.S,limit=1,lease_ms=1000,consumer_id=base.CONSUMER),"EVENT_INPUT_INVALID",runner=True))
  check("caller-boot-refused",lambda:f.reject("instructions.runner.poll",dict(base.S,limit=1,lease_ms=1000,boot_id=base.uid(999)),"EVENT_INPUT_INVALID",runner=True))
  check("cross-run-refused",lambda:f.reject("instructions.runner.poll",dict(base.S,run_id=base.uid(999),limit=1,lease_ms=1000),"AUTH_SCOPE_DENIED",runner=True))
  check("unbounded-limit-refused",lambda:f.reject("instructions.runner.poll",dict(base.S,limit=17,lease_ms=1000),"EVENT_INPUT_INVALID",runner=True))
  c=issue(f,9001,"START");first=f.poll();command=first["commands"][0];packet=command["packet"]
  check("typed-current-native-handoff",lambda:expect(len(first["commands"])==1 and packet["command_id"]==c["id"] and packet["sandbox_id"]==f.ids["sandbox"] and packet["boot_id"]==f.ids["boot"] and first["consumer_id"]==base.CONSUMER,"Poll changed native target"))
  check("admission-never-delivery-ack",lambda:expect(state(f,c["id"])=="DELIVERING" and not first["execution_authority"] and not first["task_qualified"],"Central admission closed native debt"))
  old=f.child;old.kill();old.wait(timeout=8);f.child=None;f.start();due();second=f.poll()["commands"][0]
  check("actual-service-restart-stable-command",lambda:expect(second["event_id"]==command["event_id"] and second["inbox_id"]==command["inbox_id"] and second["packet"]["payload_digest"]==packet["payload_digest"] and int(second["attempt_count"])>int(command["attempt_count"]),"Restart replaced immutable command or receiver effect"))
  check("restart-no-second-spool",lambda:expect(f.sql("SELECT count(*)::int AS n FROM hyperfide.command_inbox WHERE operation='instruction.spool'")[0]["n"]==1,"Restart spooled twice"))
  report={k:packet[k] for k in ["organisation_id","run_id","command_id","operation_id","attempt_id","attempt_generation","authority_epoch","sandbox_id","boot_id","sandbox_boot_generation","sequence","payload_digest"]}
  report.update(ledger_receipt_id=c["id"],ledger_version="1",state="ACCEPTED",observed_process=None)
  # This is a real fsynced test ledger and a genuine signed RUNNER report. It
  # intentionally claims local intent only; no process or native12 proof.
  ledger=f.path/"fixture-native-receipts.sqlite"
  db=sqlite3.connect(ledger);db.execute("PRAGMA synchronous=FULL");db.execute("CREATE TABLE receipts(command TEXT PRIMARY KEY,payload TEXT NOT NULL)")
  db.execute("INSERT INTO receipts VALUES(?,?)",(c["id"],json.dumps(report,sort_keys=True)));db.commit();db.close();ledger.chmod(0o600)
  ack=f.ok("instructions.ack",report,runner=True)
  check("signed-fixture-native-intent-observation",lambda:expect(ack["recorded"] and ack["authority"]=="NONE" and not ack["task_qualified"],"Observation promoted authority"))
  due();closed=f.poll()
  check("native-ledger-required-for-delivery-close",lambda:expect(state(f,c["id"])=="ACKNOWLEDGED" and any(x["status"]=="NATIVE_LEDGER_OBSERVED" for x in closed["observations"]) and closed["commands"]==[],"Actual authenticated ledger report did not close exact delivery"))
  check("acked-delivery-absorbing",lambda:expect(f.poll()["commands"]==[] and state(f,c["id"])=="ACKNOWLEDGED","ACK replay resurrected command"))
  f.sql("UPDATE hyperfide.sandboxes SET boot_generation=2,state_version=state_version+1 WHERE id=$1",[f.ids["sandbox"]])
  check("old-boot-poll-refused",lambda:f.reject("instructions.runner.poll",dict(base.S,limit=1,lease_ms=1000),runner=True))
 finally:f.close()
def suppressed():
 f=setup()
 try:
  register(f);a=issue(f,9101,"START");b=issue(f,9102,"STEER");base.control(f,"PAUSE",9801);c=issue(f,9103,"CANCEL")
  result=f.poll()
  check("pause-cancel-progresses-ordered-stream",lambda:expect([x["event_id"] for x in result["commands"]]==[c["id"]],"Blocked advance prevented exact cleanup"))
  check("suppressed-start-and-steer-closed-server-only",lambda:expect(state(f,a["id"])=="ACKNOWLEDGED" and state(f,b["id"])=="ACKNOWLEDGED" and all(x["status"]=="SERVER_SUPPRESSED" and x["native_delivery_observed"] is False for x in result["observations"]),"Suppression invented native delivery"))
  check("cancel-retains-native-debt",lambda:expect(state(f,c["id"])=="DELIVERING" and result["commands"][0]["packet"]["kind"]=="CANCEL" and result["commands"][0]["packet"]["execution"]=="PENDING_NATIVE_CONNECTOR","Cleanup handoff invented physical completion"))
  check("suppression-preserves-real-receipts",lambda:expect(f.sql("SELECT count(*)::int AS n FROM hyperfide.command_inbox WHERE operation='instruction.spool'")[0]["n"]==3 and f.sql("SELECT count(*)::int AS n FROM hyperfide.command_inbox WHERE operation='instruction.runner-state'")[0]["n"]==0,"Server suppression forged native ledger"))
 finally:f.close()
def historical():
 f=setup()
 try:
  register(f);a=issue(f,9201,"START");f.poll()
  before=f.sql("SELECT result FROM hyperfide.command_inbox WHERE operation='instruction.spool' AND idempotency_key=$1",[a["id"]])[0]["result"]
  b=issue(f,9202,"STEER");base.control(f,"PAUSE",9802);c=issue(f,9203,"CANCEL");due()
  first=f.poll(limit=1)
  check("fresh-suppression-before-prior-native-debt",lambda:expect(any(x["event_id"]==b["id"] and x["status"]=="SERVER_SUPPRESSED" for x in first["observations"]),"Earlier native debt starved fresh ordered receipt"))
  second=f.poll(limit=1)
  check("limit-one-cancel-not-starved",lambda:expect(len(second["commands"])==1 and second["commands"][0]["event_id"]==c["id"],"Limit-one poll could not discover cancellation"))
  third=f.poll(limit=1)
  check("historical-admission-not-reinterpreted",lambda:expect(any(x["event_id"]==a["id"] and x["status"]=="PRIOR_ADMISSION_RETAINS_NATIVE_UNCERTAINTY" and not x["delivery_acknowledged"] for x in third["observations"]) and state(f,a["id"])=="DELIVERING","Historical accepted START was rewritten as never started"))
  after=f.sql("SELECT result FROM hyperfide.command_inbox WHERE operation='instruction.spool' AND idempotency_key=$1",[a["id"]])[0]["result"]
  check("immutable-historical-admission-bytes",lambda:expect(before==after and before["accepted"] is True,"Cancellation mutated historical admission"))
 finally:f.close()
def main():
 try:basic();suppressed();historical()
 except Exception as error:
  print(json.dumps({"type":"fatal","error":type(error).__name__+": "+str(error)}),flush=True);return 1
 print(json.dumps({"type":"cleanup","resources":[],"complete":True,"assertions":COUNT,"full_case_status":"INCOMPLETE"}),flush=True)
 return int(bool(FAILURES))
if __name__=="__main__":sys.exit(main())
