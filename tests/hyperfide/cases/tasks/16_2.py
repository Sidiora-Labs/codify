#!/usr/bin/env python3
"""Task16.2 gate-execution and legacy-history assertions layered on the shared domain16 driver.

The shared driver keeps authority, primary-capability, preparation and signed HTTPS boundaries.
This shim adds executable-gate receipt semantics (do_1, V-056) and forced/proof-text history
isolation (do_2, V-013); none of it establishes physical remote execution qualification."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

# Fixture commits must not leave detached git auto-maintenance children behind the probe.
os.environ.update({"GIT_CONFIG_COUNT":"2","GIT_CONFIG_KEY_0":"maintenance.auto","GIT_CONFIG_VALUE_0":"false",
                   "GIT_CONFIG_KEY_1":"gc.auto","GIT_CONFIG_VALUE_1":"0"})
spec=importlib.util.spec_from_file_location("assurance_bounded",Path(__file__).with_name("16_1.py"))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
ROOT=module.ROOT
emit=module.emit

def gate_cases():
    """Actual compiled executor decisions with a controlled runner.remote.v1 double behind 12.4."""
    results=module.node("""
const m=await import('./services/hyperfide/dist/assurance/executor.js');
const p=await import('./services/hyperfide/dist/transport/protocol.js');
const id=()=>crypto.randomUUID(),sha=c=>'sha256:'+c.repeat(64),out=(...a)=>console.log(JSON.stringify(a.length>1?{key:a[0],valid:a[1]}:a[0]));
const org=id(),run=id(),verifier=id(),sandbox=id();
let remoteCalls=0;
const remote={prepare:async()=>{remoteCalls++;throw new Error('prepare must not run');},execute:async()=>{remoteCalls++;throw new Error('execute must not run');}};
const context=signal=>({env:{},dependencies:{require:(owner,capability,predicate)=>{
  if(owner==='12.4'&&capability==='runner.remote.v1'&&predicate(remote))return remote;throw new Error('unlinked '+capability);}},
 invocation:p.authenticatedInvocation({principal:{organisation_id:org,run_id:run,actor_id:verifier,sandbox_id:sandbox,role:'VERIFIER',boot_id:id(),boot_generation:'1'},
  operation:{idempotency_key:id()},payload:{},signal,guard:async()=>{},identityGuard:async()=>{},continuationGuard:async()=>{}})});
const job={id:id(),organisation_id:org,run_id:run,lease_generation:'1',custody:{task_id:id()}};
const check={id:'unit',argv:['npm','test'],timeout_ms:1000,required_artifacts:['reports/junit.xml'],input_keys:['source'],executable_digest:sha('e')};
const snapshot=checks=>({policy:{checks},manifest:{source_object_id:'a'.repeat(40)},inputs:{source:sha('s')}});
async function code(call){try{await call();return null;}catch(error){return error.code??error.message;}}
out('zero-checks',await code(()=>m.runRegisteredChecks(context(new AbortController().signal),job,snapshot([])))==='QUALIFICATION_PROOF_INCOMPLETE'&&remoteCalls===0);
const aborted=new AbortController();aborted.abort();
out('interrupted',await code(()=>m.runRegisteredChecks(context(aborted.signal),job,snapshot([check])))==='QUALIFICATION_INTERRUPTED'&&remoteCalls===0);
const complete={status:'COMPLETED',outcome:'SUCCEEDED',exit_code:0,signal:null,timed_out:false,interrupted:false,output_complete:true,
 cleanup_status:'CONFIRMED',cleanup:{complete:true,observed_process_absent:true},started_at:'2026-01-01T00:00:00Z',ended_at:'2026-01-01T00:00:01Z',duration_ms:1000};
const kept=[{path:'reports/junit.xml',artifact_id:id(),digest:sha('d'),size_bytes:'12',storage_kind:'OBJECT'}];
const verdict=(raw,files=kept)=>m.judgeCheck(raw,check.required_artifacts,files);
const source='a'.repeat(40),row=(v,extra={})=>({check_id:'unit',source_object_id:source,outcome:v.outcome,reasons:v.reasons,...extra});
const failing=(key,raw,files,reason)=>{const v=verdict(raw,files),s=m.qualificationOutcome(['unit'],[row(v)],source);
 out(key,v.outcome==='FAIL'&&v.reasons.some(r=>r.startsWith(reason))&&s.outcome==='FAIL'&&s.unmet[0].check_id==='unit'&&s.unmet[0].reasons.some(r=>r.startsWith(reason)));};
failing('missing-artifact',complete,[{path:'reports/junit.xml',status:'MISSING'}],'REQUIRED_ARTIFACT_MISSING');
failing('artifact-absent-from-inventory',complete,[],'REQUIRED_ARTIFACT_MISSING');
failing('unknown-status',{...complete,status:'UNKNOWN',outcome:undefined},kept,'REMOTE_STATUS_NOT_COMPLETED');
failing('skipped',{...complete,outcome:'SKIPPED'},kept,'REMOTE_OUTCOME_NOT_SUCCEEDED');
failing('empty-output',{...complete,output_complete:undefined},kept,'OUTPUT_INCOMPLETE');
failing('failed-child',{...complete,outcome:'FAILED',exit_code:1},kept,'EXIT_STATUS_NOT_ZERO');
failing('signal-interrupted',{...complete,signal:'SIGTERM',interrupted:true},kept,'INTERRUPTED_OR_UNKNOWN');
failing('partial-cleanup',{...complete,cleanup_status:'PARTIAL',cleanup:{complete:false,observed_process_absent:true}},kept,'CLEANUP_NOT_CONFIRMED');
const pass=row(verdict(complete));
const summary=(required,rows,reason)=>{const s=m.qualificationOutcome(required,rows,source);return s.outcome==='FAIL'&&s.unmet.some(u=>u.reasons.includes(reason));};
out('missing-check',summary(['unit','lint'],[pass],'REQUIRED_CHECK_MISSING'));
out('unknown-check',summary(['unit'],[pass,{...pass,check_id:'fabricated'}],'UNKNOWN_CHECK'));
out('duplicate-result',summary(['unit'],[pass,pass],'DUPLICATE_CHECK_RESULT'));
out('stale-revision',summary(['unit'],[{...pass,source_object_id:'b'.repeat(40)}],'STALE_SOURCE_REVISION'));
out('no-required-checks',summary([],[],'NO_REQUIRED_CHECKS'));
const admitted={policy:{checks:[check]},inputs:{source:sha('s')}};
out('policy-stale',await code(()=>m.assertSnapshotCurrent(admitted,{...admitted,policy:{checks:[{...check,argv:['true']}]}}))==='QUALIFICATION_POLICY_STALE');
out('input-stale',await code(()=>m.assertSnapshotCurrent(admitted,{...admitted,inputs:{source:sha('t')}}))==='QUALIFICATION_INPUT_STALE');
const plan={operation_id:id(),session_id:id(),cwd:'.',environment:{LANG:'C.UTF-8',LC_ALL:'C.UTF-8'},environment_digest:sha('f'),policy_digest:sha('9')};
const observed={boot_id:id(),slot_id:id(),slot_generation:'1',boot_generation:'1',source_state_digest:sha('7'),workspace_path:'/workspace'};
const manifest={source_manifest_digest:sha('8'),source_object_id:source,source_tree_id:'c'.repeat(40),repository_id:id()};
const raw={...complete,execution_plane:'REMOTE',truncated:false,operation_id:plan.operation_id,session_id:plan.session_id,sandbox_id:sandbox,boot_id:observed.boot_id,
 slot_id:observed.slot_id,slot_generation:'1',native_resource_id:'native',process_ref:'pid:1',start_identity:'start',argv:check.argv,cwd:'.',
 source_manifest_digest:manifest.source_manifest_digest,source_object_id:source,source_tree_id:manifest.source_tree_id,source_digest:manifest.source_manifest_digest,
 source_provenance_digest:sha('s'),source_state_digest:observed.source_state_digest,policy_digest:plan.policy_digest,executable_digest:check.executable_digest,
 environment_digest:plan.environment_digest,repository_id:manifest.repository_id,organisation_id:org,run_id:run,boot_generation:'1',spool_digest:sha('5')};
const binding={plan,observed,check,snapshot:{manifest,inputs:{source:sha('s')}},sandbox_id:sandbox,scope:[org,run]};
out('unrelated-command',await code(()=>m.assertRemoteBinding({...raw,argv:['true']},binding))==='QUALIFICATION_REMOTE_BINDING_INVALID'&&
 await code(()=>m.assertRemoteBinding(raw,binding))===null);
const positive=verdict(complete),command=m.commandRecord(check,plan,observed,raw),total=m.qualificationOutcome(['unit'],[row(positive,{command,artifacts:kept})],source);
out('positive-receipt',positive.outcome==='PASS'&&positive.reasons.length===0&&total.outcome==='PASS'&&total.unmet.length===0&&
 JSON.stringify(command.argv)===JSON.stringify(check.argv)&&command.environment_digest===plan.environment_digest&&command.exit_code===0&&
 command.environment.LC_ALL==='C.UTF-8'&&kept.every(a=>/^sha256:[0-9a-f]{64}$/.test(a.digest)&&a.artifact_id));
""")
    expected=["zero-checks","interrupted","missing-artifact","artifact-absent-from-inventory","unknown-status","skipped","empty-output",
              "failed-child","signal-interrupted","partial-cleanup","missing-check","unknown-check","duplicate-result","stale-revision",
              "no-required-checks","policy-stale","input-stale","unrelated-command","positive-receipt"]
    if [row["key"] for row in results]!=expected:raise AssertionError("Incomplete gate decision inventory")
    for row in results:emit("assurance.16.2.gate."+row["key"],row["valid"])

def harness_case():
    """V-056: relay the read-only task27.1 harness self-qualification as one observed assertion."""
    result=subprocess.run([sys.executable,str(ROOT/"tests/hyperfide/selftest_harness.py")],cwd=ROOT,text=True,
                          capture_output=True,timeout=240)
    emit("assurance.16.2.harness.false-success-traps",result.returncode==0 and result.stderr.rstrip().endswith("OK"))

KVX="""[meta]
slug = "legacy-forced"

[task.legacy.1]
title = "Forced done legacy task"
status = "done"
wave = 1

[task.legacy.2]
title = "Dependent of forced done task"
status = "pending"
wave = 2
requires = ["legacy.1"]
"""

def history_cases(fixture):
    """do_2: forced-done KVX status and proof-text-only claims stay history and release nothing."""
    import hashlib
    org,run,project=fixture.ids["organisation"],fixture.ids["run"],fixture.ids["project"]
    folder=fixture.path/"kvx";folder.mkdir()
    data=KVX.encode();(folder/"spec.kvx").write_bytes(data)
    repository,commit,legacy_run=str(uuid.uuid4()),"d"*40,str(uuid.uuid4())
    fixture.sql("INSERT INTO hyperfide.repositories(organisation_id,id,project_id,name,url) VALUES($1,$2,$3,'legacy','https://example.invalid/legacy.git')",[org,repository,project])
    fixture.sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES($1,$2,$3)",[org,repository,commit])
    envelope={"run_id":legacy_run,"source":{"relative_path":"spec.kvx","sha256":hashlib.sha256(data).hexdigest(),"size_bytes":str(len(data))},
        "repositories":[{"repository_id":repository,"source_object_id":commit,"integration_ref":"refs/heads/main"}],
        "allowed_actions":["programme.activate"],"closure_policy":{"required_evidence":["gate"],"required_review_roles":["reviewer"],"publication":"AFTER_QUALIFICATION"},"provenance":None}
    scope={"organisation_id":org,"project_id":project,"run_id":legacy_run,"authority_epoch":fixture.ids["epoch"],"root":str(folder),"allowed_actions":["programme.activate"]}
    env=dict(os.environ,DATABASE_URL=fixture.url)
    program="""
import {ResourceContainer} from './services/hyperfide/dist/storage/runtime.js';
import {importRunTransaction} from './services/hyperfide/dist/spec/import.js';
import {createComponent} from './services/hyperfide/dist/assurance/executor.js';
import {authenticatedInvocation} from './services/hyperfide/dist/transport/protocol.js';
const scope=%s,envelope=%s;
const resources=new ResourceContainer('control',{...process.env,HYPERFIDE_CONTROL_DATABASE_URL:process.env.DATABASE_URL},new AbortController().signal);
try{
 await resources.gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:0},tx=>importRunTransaction(tx,scope,envelope));
 const ids=await resources.gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:0},async tx=>{
  const rows=(await tx.query("SELECT task_key,id,state,definition FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 ORDER BY task_key",[scope.organisation_id,scope.run_id])).rows;
  const [legacy,dependent]=rows;
  await tx.query("INSERT INTO hyperfide.task_dependencies(organisation_id,run_id,task_id,predecessor_run_id,predecessor_task_id,milestone) VALUES($1,$2,$3,$2,$4,'QUALIFIED')",[scope.organisation_id,scope.run_id,dependent.id,legacy.id]);
  const blocked=(await tx.query("SELECT count(*)::int AS n FROM hyperfide.task_dependencies d JOIN hyperfide.tasks p ON p.organisation_id=d.organisation_id AND p.run_id=d.predecessor_run_id AND p.id=d.predecessor_task_id WHERE d.organisation_id=$1 AND d.run_id=$2 AND d.task_id=$3 AND d.milestone='QUALIFIED' AND p.state NOT IN ('QUALIFIED','INTEGRATING','INTEGRATED')",[scope.organisation_id,scope.run_id,dependent.id])).rows[0].n;
  return {legacy,dependent,blocked};
 });
 const component=createComponent({});
 const invocation=authenticatedInvocation({principal:{organisation_id:scope.organisation_id,run_id:scope.run_id,actor_id:crypto.randomUUID(),role:'OPERATOR'},
  operation:{idempotency_key:crypto.randomUUID()},payload:{},signal:new AbortController().signal,guard:async()=>{},identityGuard:async()=>{},continuationGuard:async()=>{}});
 const view=await component.actions['qualification.history.inspect']({organisation_id:scope.organisation_id,run_id:scope.run_id,task_id:ids.legacy.id},{resources,invocation});
 console.log(JSON.stringify({ids,view}));
}finally{await resources.close();}
""" % (json.dumps(scope),json.dumps(envelope))
    process=subprocess.run(["node","--input-type=module","-e",program],cwd=ROOT,env=env,text=True,capture_output=True,timeout=45)
    if process.returncode:raise RuntimeError("Actual KVX forced-status probe failed: "+process.stderr[-1500:])
    observed=json.loads(process.stdout.strip().splitlines()[-1])
    ids,view=observed["ids"],observed["view"]
    emit("assurance.16.2.history.kvx-forced-done-unqualified",
         ids["legacy"]["task_key"]=="legacy.1" and ids["legacy"]["definition"].get("declared_status")=="done" and
         ids["legacy"]["definition"].get("history_only") is True and ids["legacy"]["state"]=="PENDING" and
         view["qualified"] is False and view["task_state"]=="PENDING" and view["historical"]["declared_status"]=="done" and
         "FORCED_DECLARED_STATUS" in view["historical"]["signals"] and view["historical"]["authoritative"] is False and
         view["current_evidence"]["passing_receipts"]=="0")
    emit("assurance.16.2.history.kvx-dependent-ineligible",
         ids["blocked"]==1 and view["releases_dependent_work"] is False and view["blocked_dependents"]==[ids["dependent"]["id"]] and
         ids["dependent"]["state"]=="PENDING")
    # Signed HTTPS: a proof-text-only claim and a forced/agent/exit-zero claim imported into the fixture run.
    package,task=str(uuid.uuid4()),str(uuid.uuid4())
    fixture.sql("INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES($1,$2,$3,'legacy16_2',1)",[org,run,package])
    fixture.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) VALUES($1,$2,$3,'legacy16_2',$4,$5,$6,$7,1)",
                [org,run,task,package,fixture.ids["spec"],"sha256:"+"c"*64,json.dumps({"declared_status":"done","history_only":True})])
    def imported(claim):
        status,response=fixture.invoke("qualification.history.import",{"organisation_id":org,"run_id":run,"task_id":task,
            "provenance":"legacy task16.2 fixture import","legacy_claim":claim},component="16.2")
        result=response.get("result") if status==200 and response.get("ok") is True else None
        return result if isinstance(result,dict) else {}
    proof=imported({"proof_text":"All verification passed; see attached summary."})
    emit("assurance.16.2.history.proof-text-history-only",
         proof.get("imported") is True and proof.get("qualification")=="HISTORY_ONLY" and proof.get("authoritative") is False and
         proof.get("releases_dependent_work") is False and proof.get("signals")==["PROOF_TEXT"])
    forced=imported({"status":"done","force":True,"agent_message":"Task complete","exit_code":0})
    emit("assurance.16.2.history.forced-claim-history-only",
         forced.get("qualification")=="HISTORY_ONLY" and forced.get("releases_dependent_work") is False and
         set(forced.get("signals",[]))=={"FORCED_STATUS","FORCE_FLAG","AGENT_MESSAGE","UNBOUND_EXIT_STATUS"})
    counts=fixture.sql("SELECT (SELECT count(*) FROM hyperfide.submission_custodies WHERE organisation_id=$1 AND run_id=$2)::text AS custody,"
                       "(SELECT count(*) FROM hyperfide.qualification_jobs WHERE organisation_id=$1 AND run_id=$2)::text AS jobs,"
                       "(SELECT count(*) FROM hyperfide.assurance_job_receipts WHERE organisation_id=$1 AND run_id=$2)::text AS receipts,"
                       "(SELECT count(*) FROM hyperfide.assurance_history WHERE organisation_id=$1 AND run_id=$2 AND task_id=$3)::text AS history,"
                       "(SELECT state FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3) AS state",[org,run,task])
    emit("assurance.16.2.history.no-qualification-rows",counts==[{"custody":"0","jobs":"0","receipts":"0","history":"2","state":"PENDING"}])
    status,response=fixture.invoke("qualification.history.inspect",{"organisation_id":org,"run_id":run,"task_id":task},component="16.2")
    view=response.get("result",{}) if status==200 and response.get("ok") is True else {}
    emit("assurance.16.2.history.inspect-distinguishes",
         view.get("qualified") is False and view.get("releases_dependent_work") is False and
         view.get("historical",{}).get("imported_claims")==2 and view.get("historical",{}).get("authoritative") is False and
         "FORCED_DECLARED_STATUS" in view.get("historical",{}).get("signals",[]) and "PROOF_TEXT" in view.get("historical",{}).get("signals",[]) and
         view.get("current_evidence",{}).get("receipts")=="0" and view.get("current_evidence",{}).get("task_qualified") is False)

def install_history_hook():
    sys.path.insert(0,str(ROOT/"tests/hyperfide/support"))
    import identity_fixture
    original=identity_fixture.IdentityFixture.close
    def close(self):
        # Runs inside the shared signed fixture lifetime, before its database, service and files are removed.
        try:
            if module.TASK=="16.2" and not getattr(self,"_history_observed",False) and getattr(self,"child",None) is not None:
                self._history_observed=True
                history_cases(self)
        finally:
            original(self)
    identity_fixture.IdentityFixture.close=close

def history_authority_cases():
    """The task-owned history view refuses absent and forged invocations like every other 16.2 action."""
    value={"organisation_id":str(uuid.uuid4()),"run_id":str(uuid.uuid4()),"task_id":str(uuid.uuid4())}
    results=module.node("""
const module=await import('./services/hyperfide/dist/assurance/executor.js');
const input=%s,component=module.createComponent({});
for(const [kind,context] of [['absent',{}],['forged',{invocation:{principal:{...input,role:'OPERATOR',actor_id:input.task_id},guard:async()=>{},identityGuard:async()=>{},operation:{idempotency_key:input.task_id},signal:new AbortController().signal}}]]){
 let code=null,accepted=false;
 try{await component.actions['qualification.history.inspect'](input,context);accepted=true;}catch(error){code=error.code??error.name;}
 console.log(JSON.stringify({kind,code,accepted}));
}
""" % json.dumps(value))
    if len(results)!=2:raise AssertionError("Incomplete history view negative inventory")
    for row in results:
        emit("assurance.16.2.auth."+row["kind"]+".qualification.history.inspect",row["code"]=="AUTH_REQUIRED" and row["accepted"] is False)

def install_cases():
    original_authority=module.authority_cases
    def authority_cases():
        original_authority()
        history_authority_cases()
    module.authority_cases=authority_cases
    original_primary=module.primary_cases
    def primary_cases():
        original_primary()
        gate_cases()
        harness_case()
    module.primary_cases=primary_cases
    install_history_hook()
    if "--cleanup" not in sys.argv:
        # The registered --cleanup run reports the single observed cleanup event; the in-run cleanup stays silent.
        original_cleanup=module.cleanup
        def cleanup(report=False):
            with contextlib.redirect_stdout(io.StringIO()):
                return original_cleanup(report=report)
        module.cleanup=cleanup

install_cases()
raise SystemExit(module.main("16.2"))
