#!/usr/bin/env python3
"""Task16.4 assurance validity: shared bounded driver plus signed-HTTPS invalidation/requalification behaviour."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import uuid
spec=importlib.util.spec_from_file_location("assurance_bounded",Path(__file__).with_name("16_1.py"))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

BEHAVIOUR="16.4-behaviour"
INPUT_KEYS=["source","dependency","toolchain","configuration","graph","contract"]
# Registered evidence classes: every assurance input has at least one consumer.
CHECKS=[{"id":"unit","input_keys":["source","dependency"]},
        {"id":"build","input_keys":["toolchain","configuration"]},
        {"id":"graph-contract","input_keys":["source","graph","contract"]}]
# Reuse-rule fixture: no registered check consumes the contract input.
PARTIAL=[{"id":"unit","input_keys":["source","dependency"]},
         {"id":"build","input_keys":["toolchain","configuration","graph"]}]

def sha(text):return "sha256:"+hashlib.sha256(text.encode()).hexdigest()
def lit(value):
    if value is None:return "NULL"
    if not isinstance(value,str):value=json.dumps(value,separators=(",",":"),sort_keys=True)
    return "'"+value.replace("'","''")+"'"

@contextlib.contextmanager
def behaviour_task():
    original=module.TASK
    module.TASK=BEHAVIOUR
    try:yield
    finally:module.TASK=original

def record_path():
    return module.directory()/("signed-resource-"+BEHAVIOUR+".json")

class Behaviour:
    """Seeds immutable custody/receipt history in an owned database and drives the actual HTTPS component."""
    def __init__(self,fixture):
        self.f=fixture;i=fixture.ids
        self.org,self.run,self.epoch=i["organisation"],i["run"],i["epoch"]
        self.repository,self.package,self.slot=str(uuid.uuid4()),str(uuid.uuid4()),str(uuid.uuid4())
        self.worker=str(uuid.uuid4())
        self.sql(f"""
INSERT INTO hyperfide.repositories(organisation_id,id,project_id,name,url) VALUES({lit(self.org)},{lit(self.repository)},{lit(i['project'])},'validity','https://example.invalid/validity.git');
INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES({lit(self.org)},{lit(self.repository)},repeat('a',40));
INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES({lit(self.org)},{lit(self.run)},{lit(self.repository)},repeat('a',40),'refs/heads/main');
INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES({lit(self.org)},{lit(self.run)},{lit(self.package)},'validity',1);
INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind) VALUES({lit(self.org)},{lit(self.slot)},{lit(i['sandbox'])},'validity-worker',1,'AGENT');
""")
    def sql(self,text):return self.f.sql(text)
    def one(self,text):
        rows=self.f.sql(text)
        return rows[0] if rows else None
    def seed(self,authority="ACTIVE",checks=CHECKS,task_state="QUALIFIED",running=False):
        """One accepted PASS: custody, applicability CURRENT, one historical independent receipt."""
        o,r=lit(self.org),lit(self.run)
        task,attempt,custody,lease=(str(uuid.uuid4()) for _ in range(4))
        job,evidence,artifact,source_artifact,evidence_artifact=(str(uuid.uuid4()) for _ in range(5))
        criteria=sha("criteria:"+task)
        inputs={key:sha(key+":accepted:"+task) for key in INPUT_KEYS}
        receipt={"outcome":"PASS","custody_id":custody,"job_id":job,"input_manifest":inputs,"fixture":"historical independent receipt"}
        artifacts="".join(f"INSERT INTO hyperfide.artifacts(organisation_id,run_id,id,digest,size_bytes,storage_backend,storage_key,status) VALUES({o},{r},{lit(a)},{lit(sha('artifact:'+a))},1,'fixture',{lit('validity/'+a)},'COMPLETE');\n"
                          for a in (artifact,source_artifact,evidence_artifact))
        extra=""
        if running:
            # Superseded worker-era qualification lease and a pending requalification that invalidation must fence.
            extra=f"""
INSERT INTO hyperfide.qualification_jobs(organisation_id,run_id,id,custody_id,custody_generation,rubric_digest,state,lease_generation,lease_owner,lease_expires_at) VALUES({o},{r},{lit(running['job'])},{lit(custody)},1,{lit(sha('rubric'))},'RUNNING',1,{lit(self.worker)},clock_timestamp()+interval '30 minutes');
INSERT INTO hyperfide.requalification_operations(organisation_id,run_id,id,custody_id,custody_generation,qualification_job_id,request_id,input_manifest_digest) VALUES({o},{r},{lit(running['operation'])},{lit(custody)},1,{lit(running['job'])},{lit(str(uuid.uuid4()))},{lit(sha('prior-inputs'))});
"""
        self.sql(f"""
INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) VALUES({o},{r},{lit(task)},{lit('validity.'+task[:8])},{lit(self.package)},{lit(self.f.ids['spec'])},{lit(criteria)},'{{}}',1);
INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,execution_state,compute_authority,sandbox_id,slot_id,sandbox_boot_generation) VALUES({o},{r},{lit(attempt)},{lit(task)},1,{lit(self.epoch)},{lit(sha('packet'))},'SUBMITTED','RELEASED',{lit(self.f.ids['sandbox'])},{lit(self.slot)},1);
INSERT INTO hyperfide.compute_leases(organisation_id,run_id,id,attempt_id,attempt_generation,authority_epoch,sandbox_boot_generation,expires_at,state) VALUES({o},{r},{lit(lease)},{lit(attempt)},1,{lit(self.epoch)},1,clock_timestamp()+interval '30 minutes','RELEASED');
INSERT INTO hyperfide.submission_custodies(organisation_id,run_id,id,task_id,source_attempt_id,source_generation,custody_generation,authority_epoch,repository_id,source_object_id,source_manifest_digest,evidence_manifest_digest,criteria_digest,authority,qualification_outcome) VALUES({o},{r},{lit(custody)},{lit(task)},{lit(attempt)},1,1,{lit(self.epoch)},{lit(self.repository)},repeat('a',40),{lit(sha('source-manifest'))},{lit(sha('evidence-manifest'))},{lit(criteria)},{lit(authority)},'PASS');
UPDATE hyperfide.tasks SET state={lit(task_state)},current_custody_id={lit(custody) if authority=='ACTIVE' else 'NULL'},current_attempt_id={lit(attempt)},generation=1,state_version=state_version+1 WHERE organisation_id={o} AND run_id={r} AND id={lit(task)};
{artifacts}INSERT INTO hyperfide.evidence(organisation_id,run_id,id,attempt_id,attempt_generation,repository_id,source_object_id,criteria_digest,manifest_digest,artifact_id) VALUES({o},{r},{lit(evidence)},{lit(attempt)},1,{lit(self.repository)},repeat('a',40),{lit(criteria)},{lit(sha('evidence-manifest'))},{lit(evidence_artifact)});
INSERT INTO hyperfide.assurance_submissions(organisation_id,run_id,custody_id,request_id,request_digest,manifest,policy,source_artifact_id,evidence_artifact_id) VALUES({o},{r},{lit(custody)},{lit(str(uuid.uuid4()))},{lit(sha('request'))},{lit({'repository_id':self.repository,'source_object_id':'a'*40,'source_tree_id':'b'*40,'source_manifest_digest':sha('source-manifest')})},{lit({'checks':checks,'clauses':[],'rubric_digest':sha('rubric'),'criteria_digest':criteria,'spec_revision_id':self.f.ids['spec'],'spec_generation':1})},{lit(source_artifact)},{lit(evidence_artifact)});
INSERT INTO hyperfide.assurance_applicability(organisation_id,run_id,custody_id,applicability,input_manifest,current_receipt_digest) VALUES({o},{r},{lit(custody)},'CURRENT',{lit(inputs)},{lit(sha(json.dumps(receipt,sort_keys=True)))});
INSERT INTO hyperfide.qualification_jobs(organisation_id,run_id,id,custody_id,custody_generation,rubric_digest,state,lease_generation,outcome) VALUES({o},{r},{lit(job)},{lit(custody)},1,{lit(sha('rubric'))},'SUCCEEDED',1,'PASS');
INSERT INTO hyperfide.assurance_job_receipts(organisation_id,run_id,job_id,lease_generation,verifier_id,environment_digest,receipt_digest,evidence_id,receipt_artifact_id,receipt) VALUES({o},{r},{lit(job)},1,{lit(str(uuid.uuid4()))},{lit(sha('environment'))},{lit(sha(json.dumps(receipt,sort_keys=True)))},{lit(evidence)},{lit(artifact)},{lit(receipt)});
{extra}""")
        return {"task":task,"attempt":attempt,"custody":custody,"lease":lease,"job":job,"inputs":inputs}
    def snapshot(self,seeded):
        o,r,c=lit(self.org),lit(self.run),lit(seeded["custody"])
        return self.one(f"""SELECT a.applicability,a.state_version::text AS version,a.input_manifest,a.reasons,
 c.authority,c.qualification_outcome,c.state_version::text AS custody_version,t.state AS task_state,
 (SELECT json_agg(json_build_object('job',p.job_id,'digest',p.receipt_digest) ORDER BY p.job_id) FROM hyperfide.assurance_job_receipts p JOIN hyperfide.qualification_jobs q ON q.organisation_id=p.organisation_id AND q.run_id=p.run_id AND q.id=p.job_id WHERE q.organisation_id={o} AND q.run_id={r} AND q.custody_id={c}) AS receipts,
 (SELECT json_agg(json_build_object('id',q.id,'state',q.state,'lease_generation',q.lease_generation::text,'lease_owner',q.lease_owner) ORDER BY q.id) FROM hyperfide.qualification_jobs q WHERE q.organisation_id={o} AND q.run_id={r} AND q.custody_id={c}) AS jobs,
 (SELECT json_agg(json_build_object('id',q.id,'state',q.state) ORDER BY q.id) FROM hyperfide.requalification_operations q WHERE q.organisation_id={o} AND q.run_id={r} AND q.custody_id={c}) AS operations,
 (SELECT count(*)::text FROM hyperfide.assurance_invalidations i WHERE i.organisation_id={o} AND i.run_id={r} AND i.custody_id={c}) AS invalidations,
 (SELECT json_build_object('compute_authority',x.compute_authority,'execution_state',x.execution_state,'version',x.state_version::text) FROM hyperfide.attempts x WHERE x.organisation_id={o} AND x.run_id={r} AND x.id={lit(seeded['attempt'])}) AS attempt,
 (SELECT json_build_object('state',l.state,'version',l.state_version::text) FROM hyperfide.compute_leases l WHERE l.organisation_id={o} AND l.run_id={r} AND l.id={lit(seeded['lease'])}) AS lease,
 (SELECT count(*)::text FROM hyperfide.submission_custodies s WHERE s.organisation_id={o} AND s.run_id={r} AND s.task_id={lit(seeded['task'])} AND s.authority='ACTIVE') AS active_custodies
 FROM hyperfide.assurance_applicability a JOIN hyperfide.submission_custodies c ON c.organisation_id=a.organisation_id AND c.run_id=a.run_id AND c.id=a.custody_id
 JOIN hyperfide.tasks t ON t.organisation_id=c.organisation_id AND t.run_id=c.run_id AND t.id=c.task_id
 WHERE a.organisation_id={o} AND a.run_id={r} AND a.custody_id={c}""")
    def call(self,action,payload,request_id=None):
        operation=self.f.operation("16.4",action,payload)
        if request_id:operation["idempotency_key"]=request_id
        status,response=self.f.request(operation,key="operator")
        if status!=200:raise AssertionError("Unexpected HTTPS status for "+action+": "+str(status))
        if response.get("ok") is True:return response.get("result"),None
        return None,response.get("error",{}).get("code")
    def invalidate(self,seeded,changes,version="1",request_id=None,extra=None):
        request_id=request_id or str(uuid.uuid4())
        payload=dict({"organisation_id":self.org,"run_id":self.run,"submission_id":seeded["custody"],"request_id":request_id,
                      "expected_state_version":version,"changes":changes},**(extra or {}))
        return self.call("assurance.invalidate",payload,request_id)
    def inspect(self,seeded):
        return self.call("assurance.validity.inspect",{"organisation_id":self.org,"run_id":self.run,"submission_id":seeded["custody"]})

def expected_affected(checks,keys):
    return [check["id"] for check in checks if any(key in check["input_keys"] for key in keys)]

def check(key,predicate):
    """A malformed or missing observed field is a failed observation, never a crash before emission."""
    try:actual=predicate() is True
    except (KeyError,TypeError,IndexError,AttributeError):actual=False
    module.emit(key,actual)

def behaviour_cases(b):
    # Implementation progress, recorded applicability and history are separate before any change.
    seeded=b.seed()
    inspected,code=b.inspect(seeded)
    check("assurance.16.4.inspect.separated",lambda:code is None and inspected["implementation_progress"]=="QUALIFIED" and
         inspected["recorded_applicability"]=="CURRENT" and inspected["historical_receipt_count"]=="1" and
         inspected["original_compute_authority"]=="NOT_USED" and inspected["released_custody_resurrected"] is False)
    # Each relevant input changes independently after an accepted PASS.
    for key in INPUT_KEYS:
        seeded=b.seed();before=b.snapshot(seeded)
        result,code=b.invalidate(seeded,{key:sha(key+":changed:"+seeded["task"])})
        after=b.snapshot(seeded);inspected,inspect_code=b.inspect(seeded)
        affected=expected_affected(CHECKS,[key])
        reuse={row["input"]:row["disposition"] for row in (result or {}).get("evidence_reuse",[])}
        check("assurance.16.4.invalidate."+key,lambda:code is None and inspect_code is None and
             result["applicability"]=="STALE" and result["affected_checks"]==affected and
             reuse=={k:("INVALIDATES" if k==key else "UNCHANGED") for k in INPUT_KEYS} and
             after["applicability"]=="STALE" and after["version"]=="2" and
             after["input_manifest"][key]==sha(key+":changed:"+seeded["task"]) and
             all(after["input_manifest"][k]==seeded["inputs"][k] for k in INPUT_KEYS if k!=key) and
             [row["input"] for row in after["reasons"]]==[key] and after["reasons"][0]["affected_checks"]==affected and
             after["receipts"]==before["receipts"] and after["qualification_outcome"]=="PASS" and
             inspected["historical_receipt_count"]=="1" and inspected["recorded_applicability"]=="STALE" and
             inspected["implementation_progress"]=="STALE" and after["task_state"]=="STALE" and
             result["historical_receipts_preserved"] is True and result["compute_authority_restored"] is False)
    # A key outside the assurance input contract is ignored, with its reason reported.
    seeded=b.seed();before=b.snapshot(seeded)
    result,code=b.invalidate(seeded,{"documentation":sha("docs:"+seeded["task"])})
    after=b.snapshot(seeded)
    check("assurance.16.4.irrelevant.non-assurance-input",lambda:code is None and result["applicability"]=="CURRENT" and
         result["affected_checks"]==[] and result["ignored_inputs"]==[{"input":"documentation","disposition":"IGNORED","reason":"NOT_AN_ASSURANCE_INPUT"}] and
         all(row["disposition"]=="UNCHANGED" for row in result["evidence_reuse"]) and result["scheduling_outcome"]=="NOT_REQUIRED" and
         {k:after[k] for k in ("applicability","version","input_manifest","task_state","receipts","jobs")}==
         {k:before[k] for k in ("applicability","version","input_manifest","task_state","receipts","jobs")} and after["invalidations"]=="1")
    # An assurance input that no registered evidence class consumes is reused, not invalidated.
    pending={"job":str(uuid.uuid4()),"operation":str(uuid.uuid4())}
    seeded=b.seed(checks=PARTIAL,running=pending);before=b.snapshot(seeded)
    result,code=b.invalidate(seeded,{"contract":sha("contract:changed:"+seeded["task"])})
    after=b.snapshot(seeded)
    reuse={row["input"]:row for row in (result or {}).get("evidence_reuse",[])}
    check("assurance.16.4.irrelevant.unconsumed-input",lambda:code is None and result["applicability"]=="CURRENT" and
         result["affected_checks"]==[] and reuse["contract"]["disposition"]=="REUSED" and
         reuse["contract"]["reason"]=="NO_REGISTERED_CHECK_CONSUMES_INPUT" and reuse["contract"]["registered_consumers"]==[] and
         all(reuse[k]["disposition"]=="UNCHANGED" and reuse[k]["registered_consumers"]==expected_affected(PARTIAL,[k]) for k in INPUT_KEYS if k!="contract") and
         result["scheduling_outcome"]=="NOT_REQUIRED" and result["requalification_id"] is None and
         {k:after[k] for k in ("applicability","version","input_manifest","task_state","receipts","jobs","operations")}==
         {k:before[k] for k in ("applicability","version","input_manifest","task_state","receipts","jobs","operations")})
    # The same identical change is idempotent; a different change under the same identity conflicts.
    seeded=b.seed();request=str(uuid.uuid4());changes={"dependency":sha("dependency:replay:"+seeded["task"])}
    first,first_code=b.invalidate(seeded,changes,request_id=request);middle=b.snapshot(seeded)
    replay,replay_code=b.invalidate(seeded,changes,request_id=request);after=b.snapshot(seeded)
    check("assurance.16.4.idempotency.replay",lambda:first_code is None and replay_code is None and first["replayed"] is False and
         replay["replayed"] is True and replay["affected_checks"]==first["affected_checks"]==["unit"] and
         middle==after and after["invalidations"]=="1" and after["version"]=="2")
    conflict,conflict_code=b.invalidate(seeded,{"dependency":sha("dependency:other:"+seeded["task"])},request_id=request)
    check("assurance.16.4.idempotency.conflict",lambda:conflict is None and conflict_code=="QUALIFICATION_IDEMPOTENCY_CONFLICT" and b.snapshot(seeded)==after)
    # After terminal integration released custody: invalidate without resurrecting custody or worker compute authority.
    prior={"job":str(uuid.uuid4()),"operation":str(uuid.uuid4())}
    seeded=b.seed(authority="RELEASED",task_state="INTEGRATED",running=prior);before=b.snapshot(seeded)
    result,code=b.invalidate(seeded,{"source":sha("source:integrated-change:"+seeded["task"])})
    after=b.snapshot(seeded);inspected,inspect_code=b.inspect(seeded)
    check("assurance.16.4.released.stale-without-resurrection",lambda:code is None and inspect_code is None and
         result["applicability"]=="STALE" and result["custody_authority"]=="RELEASED" and result["compute_authority_restored"] is False and
         after["applicability"]=="STALE" and after["authority"]=="RELEASED" and after["custody_version"]==before["custody_version"] and
         after["active_custodies"]=="0" and after["attempt"]==before["attempt"]=={"compute_authority":"RELEASED","execution_state":"SUBMITTED","version":"1"} and
         after["lease"]==before["lease"]=={"state":"RELEASED","version":"1"} and after["task_state"]=="INTEGRATED" and
         after["receipts"]==before["receipts"] and after["qualification_outcome"]=="PASS" and
         inspected["implementation_progress"]=="INTEGRATED" and inspected["recorded_applicability"]=="STALE" and
         inspected["released_custody_resurrected"] is False and inspected["original_compute_authority"]=="NOT_USED")
    jobs={row["id"]:row for row in after["jobs"]}
    check("assurance.16.4.released.stale-generation-fenced",lambda:jobs[prior["job"]]=={"id":prior["job"],"state":"CANCELLED","lease_generation":"2","lease_owner":None} and
         jobs[seeded["job"]]["state"]=="SUCCEEDED" and after["operations"]==[{"id":prior["operation"],"state":"CANCELLED"}])
    # Requalification is only a fresh coordinator operation from immutable inputs; nothing is rescheduled from released authority.
    check("assurance.16.4.released.fresh-operation-required",lambda:result["scheduling_outcome"]=="BLOCKED" and
         result["requalification_blocked_reason"]=="QUALIFICATION_PACKET_REQUIRED" and result["requalification_id"] is None and
         result["invalidation_durable"] is True and after["operations"]==[{"id":prior["operation"],"state":"CANCELLED"}])
    unknown,unknown_code=b.invalidate(seeded,{},version="2",extra={"input_packet_digest":sha("absent-packet:"+seeded["task"])})
    final=b.snapshot(seeded)
    check("assurance.16.4.released.unknown-packet-refused",lambda:unknown_code is None and unknown["scheduling_outcome"]=="BLOCKED" and
         unknown["requalification_id"] is None and unknown["requalification_blocked_reason"] not in (None,"") and
         final["operations"]==after["operations"] and final["authority"]=="RELEASED" and final["attempt"]==before["attempt"] and final["lease"]==before["lease"])
    accepted,accept_code=b.call("assurance.requalification.accept",{"organisation_id":b.org,"run_id":b.run,"operation_id":prior["operation"],"expected_state_version":final["version"]})
    check("assurance.16.4.released.cancelled-operation-refused",lambda:accepted is None and accept_code=="QUALIFICATION_PROOF_INCOMPLETE" and
         b.snapshot(seeded)==final)

def run_behaviour():
    sys.path.insert(0,str(module.ROOT/"tests/hyperfide/support"))
    from identity_fixture import IdentityFixture
    fragments={}
    for path in (module.ROOT/"services/hyperfide/components").glob("*.json"):
        value=json.loads(path.read_text())
        if "id" in value:fragments[value["id"]]=(path.stem,value)
    selected=set()
    def include(key):
        if key in selected:return
        selected.add(key)
        for dependency in fragments[key][1]["requires"]:include(dependency)
    include("16.4")
    names=[fragments[key][0] for key in sorted(selected)]
    with behaviour_task():record=record_path()
    state={"database":"hf_assurance_16_4_behaviour_"+uuid.uuid4().hex[:16],"pid":None,"start":None,"closed":False}
    record.write_text(json.dumps(state))
    class OwnedFixture(IdentityFixture):
        def __init__(self,**kwargs):
            try:super().__init__(**kwargs)
            finally:
                for attribute,key in (("runtime_role","runtime_role"),("path","folder"),("port","port")):
                    value=getattr(self,attribute,None)
                    if value is not None:state[key]=str(value) if key=="folder" else value
                child=getattr(self,"child",None)
                if child is not None:
                    state["pid"]=child.pid
                    stat=Path("/proc/"+str(child.pid)+"/stat")
                    if stat.exists():state["start"]=stat.read_text().split()[21]
                record.write_text(json.dumps(state))
    fixture=None
    try:
        fixture=OwnedFixture(extra_components=names,extra_env={"HYPERFIDE_REQUIRE_SYNC_REPLICA":"0"},database=state["database"])
        behaviour_cases(Behaviour(fixture))
    finally:
        if fixture is not None:
            fixture.close();state["closed"]=True;record.write_text(json.dumps(state))

original_primary=module.primary_cases
def primary_cases():
    original_primary()
    if module.TASK=="16.4":run_behaviour()
module.primary_cases=primary_cases

def cleanup_behaviour():
    if module.TASK!="16.4":return []
    with behaviour_task():return module.cleanup_signed()
module.cleanup_git=cleanup_behaviour

if "--cleanup" not in sys.argv:
    # Only the registered independent cleanup command reports the single observed cleanup event.
    original_cleanup=module.cleanup
    def quiet_cleanup(*args, **kwargs):
        with contextlib.redirect_stdout(io.StringIO()):return original_cleanup(*args, **kwargs)
    module.cleanup=quiet_cleanup

raise SystemExit(module.main("16.4"))
