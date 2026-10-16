#!/usr/bin/env python3
from pathlib import Path
import sys,json,subprocess,os,time
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/"tests/hyperfide/support"))
from identity_fixture import IdentityFixture,RESULTS,check,expect,uid,b64,sha
def main():
    fixture=IdentityFixture()
    try:
        f=fixture
        check("identity.https.authenticated-describe",lambda:expect(f.invoke("identity.describe",{})[1].get("ok") is True,"authenticated describe rejected"))
        check("identity.stdin-eof-daemon",lambda:expect(f.child.poll() is None,"closed stdin stopped listener"))
        body=f.operation("14.1","identity.describe",{})
        nonce=uid()
        check("identity.nonce.first",lambda:expect(f.request(body,nonce=nonce)[1].get("ok") is True,"first nonce rejected"))
        check("identity.nonce.replay",lambda:expect(f.request(body,nonce=nonce)[1].get("error",{}).get("code")=="AUTH_REPLAY","nonce replay accepted"))
        check("identity.proof.wrong-key",lambda:expect(f.request(body,key="other",credential=f.ids["operator"])[1].get("ok") is False,"wrong key accepted"))
        check("identity.proof.expired-time",lambda:expect(f.request(body,seconds="1")[1].get("ok") is False,"old proof accepted"))
        wrong=f.operation("14.1","identity.describe",{},run=uid())
        check("identity.scope.wrong-run",lambda:expect(f.request(wrong)[1].get("ok") is False,"cross-run request accepted"))
        bad=dict(body);bad["payload_digest"]=sha(b"changed")
        check("identity.digest.tampering",lambda:expect(f.request(bad)[1].get("ok") is False,"wrong digest accepted"))
        check("identity.json.duplicate-key",lambda:expect(f.request(b'{"protocol_version":1,"protocol_version":1}')[1].get("ok") is False,"duplicate JSON key accepted"))
        check("identity.encoding.invalid-utf8",lambda:expect(f.request(b"\xff")[1].get("ok") is False,"invalid UTF8 accepted"))
        check("identity.role.forged-provisioner",lambda:expect(f.invoke("identity.binding.observe",{})[1].get("ok") is False,"operator forged provisioner action"))
        check("identity.provider.binding",lambda:expect(f.bind()[1].get("ok") is True,"trusted provisioning observation rejected"))
        issue=f.issue()
        check("identity.grant.issue",lambda:expect(issue[1].get("ok") is True,"grant issue failed"))
        enrolled=f.enrollment()
        response=f.request(enrolled,key="runner",endpoint="/v1/enroll",credential=f.grant)
        check("identity.enrollment.real",lambda:expect(response[1].get("ok") is True,"enrollment failed"))
        credential=response[1].get("result",{}).get("credential_id")
        repeat=f.request(enrolled,key="runner",endpoint="/v1/enroll",credential=f.grant)
        check("identity.enrollment.exact-replay",lambda:expect(repeat[1].get("result",{}).get("credential_id")==credential,"enrollment duplicated identity"))
        check("identity.runner.authenticated",lambda:expect(f.request(f.operation("14.1","identity.describe",{}),key="runner",credential=credential)[1].get("ok") is True,"runner credential failed"))
        report=f.request(f.operation("14.1","identity.runner.register",{"preparation_digest":f.preparation,"inventory":[]}),key="runner",credential=credential)
        check("identity.runner.register",lambda:expect(report[1].get("ok") is True,"runner registration failed"))
        heartbeat=f.request(f.operation("14.1","identity.runner.heartbeat",{"expected_version":"1"}),key="runner",credential=credential)
        check("identity.runner.heartbeat",lambda:expect(heartbeat[1].get("ok") is True,"runner heartbeat failed"))
        check("identity.runner.stale-version",lambda:expect(f.request(f.operation("14.1","identity.runner.heartbeat",{"expected_version":"1"}),key="runner",credential=credential)[1].get("ok") is False,"stale runner status accepted"))
        check("identity.runner.role-escalation",lambda:expect(f.request(f.operation("14.1","identity.grant.issue",{}),key="runner",credential=credential)[1].get("ok") is False,"runner issued grant"))
        duplicate=f.enrollment("other")
        check("identity.enrollment.clone-quarantine",lambda:expect(f.request(duplicate,key="other",endpoint="/v1/enroll",credential=f.grant)[1].get("error",{}).get("code")=="ENROLLMENT_QUARANTINED","cloned key not quarantined"))
        check("identity.credential.quarantine-enforced",lambda:expect(f.request(f.operation("14.1","identity.describe",{}),key="runner",credential=credential)[1].get("ok") is False,"quarantined credential remained usable"))
        f.stop();f.start()
        check("identity.restart.no-reactivation",lambda:expect(f.request(f.operation("14.1","identity.describe",{}),key="runner",credential=credential)[1].get("ok") is False,"restart reactivated quarantined identity"))
        check("identity.secret.absent-database",lambda:expect(b64(f.secret) not in json.dumps(f.sql("SELECT row_to_json(g) AS value FROM hyperfide.identity_enrollment_grants g")),"reusable grant secret persisted"))
        watcher=f.add_principal("watcher","COMMIT_WATCHER")
        check("identity.fixture.registered-watcher",lambda:expect(f.invoke("identity.describe",{},key="watcher")[1].get("result",{}).get("principal",{}).get("actor_id")==watcher["actor_id"],"registered watcher actor binding failed"))
        check("identity.fixture.reviewer-no-compute-attempt",lambda:expect(f.invoke("identity.describe",{},key="watcher")[1].get("result",{}).get("principal",{}).get("attempt_id") is None,"reviewer inherited coding compute attempt"))
        def existing_database():
            try:
                other=IdentityFixture(database=f.database)
            except AssertionError:
                expect(f.invoke("identity.describe",{})[1].get("ok") is True,"failed constructor removed a pre-existing database")
            else:
                other.close();raise AssertionError("pre-existing database was accepted")
        check("identity.fixture.database-ownership",existing_database)
        f.close()
        f=IdentityFixture();fixture=f
        f.bootstrap_runner()
        slot=uid();session=uid();i=f.ids
        f.sql("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind) VALUES($1,$2,$3,'review-slot',1,'REVIEW')",[i["organisation"],slot,i["sandbox"]])
        f.sql("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id,slot_id,sandbox_id,sandbox_boot_generation) VALUES($1,$2,$3,'COMMIT_WATCHER','fixture','fixture',$4,$5,$6,1)",[i["organisation"],i["run"],session,uid(),slot,i["sandbox"]])
        def fresh_runner(target):
            from identity_fixture import canonical
            body=f.operation("14.1","identity.describe",{});raw=canonical(body);seconds=str(int(time.time()));nonce=uid()
            signature=f.sign("provisioner",("\n".join(("HYPERFIDE-REQUEST-V1","POST","/v1/invoke",f.origin,i["provisioner"],seconds,nonce,sha(raw),""))).encode())
            args={"components":str(f.components),"policy":str(f.policy),"body":b64(raw),"headers":["HF-Credential-Id",i["provisioner"],"HF-Request-Time",seconds,"HF-Request-Nonce",nonce,"HF-Request-Signature",signature],"target":target}
            script="""import fs from 'node:fs';import {ComponentRegistry} from './services/hyperfide/dist/components/registry.js';import {validatePolicy} from './services/hyperfide/dist/policy/programme.js';const a=JSON.parse(fs.readFileSync(0,'utf8')),c=new AbortController(),r=new ComponentRegistry({role:'control',env:process.env,signal:c.signal,policy:validatePolicy(JSON.parse(fs.readFileSync(a.policy,'utf8')),'fixture-identity-v1','control')});try{await r.load(a.components,process.cwd()+'/services/hyperfide/dist');const auth=r.resolveCapability('14.1','identity.authority',v=>typeof v.verifyFreshRunner==='function'),i=await auth.authenticate(Buffer.from(a.body,'base64url'),a.headers,c.signal),g=r.resolveCapability('4.2','storage.transactions.v1',v=>typeof v.withPrimaryTransaction==='function');const observation=await g.withPrimaryTransaction({timeoutMs:5000,guard:i.guard},tx=>auth.verifyFreshRunner(i,tx,a.target));process.stdout.write(JSON.stringify({ok:true,result:observation}));}catch(e){process.stdout.write(JSON.stringify({ok:false,error:{code:e.code??'ERROR'}}));}finally{await r.close();}"""
            result=subprocess.run(["node","--input-type=module","-e",script],input=json.dumps(args),cwd=ROOT,env=f.env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=20)
            expect(result.returncode==0,"actual fresh enrollment process failed: "+result.stderr[:800]);return json.loads(result.stdout)
        observed_after=f.sql("SELECT clock_timestamp() AS now")[0]["now"]
        expect(f.invoke("identity.runner.register",{"preparation_digest":f.preparation,"inventory":[]},key="runner")[1].get("ok") is True,"real runner registration failed")
        target={"sandbox_id":i["sandbox"],"boot_id":i["boot"],"boot_generation":"1","provisioning_intent_id":i["intent"],"credential_id":i["runner"],"observed_after":observed_after}
        check("identity.runner-fresh.actual-signed-observation",lambda:expect(fresh_runner(target).get("result",{}).get("authority")=="NONE","actual registration lineage verification failed"))
        check("identity.runner-fresh.wrong-boot-denied",lambda:expect(fresh_runner({**target,"boot_id":uid()}).get("ok") is False,"fresh lookup accepted wrong boot"))
        check("identity.runner-fresh.wrong-grant-denied",lambda:expect(fresh_runner({**target,"grant_id":uid()}).get("ok") is False,"fresh lookup accepted wrong grant lineage"))
        check("identity.runner-fresh.old-observation-denied",lambda:expect(fresh_runner({**target,"observed_after":time.strftime("%Y-%m-%dT%H:%M:%S.000Z",time.gmtime(time.time()+60))}).get("ok") is False,"old signed heartbeat accepted as fresh"))
        renewal=f.invoke("identity.principal.renew",{"ttl_seconds":600},key="runner")[1]
        check("identity.renew.platform-only",lambda:expect(renewal.get("result",{}).get("credential_version")=="2" and renewal.get("result",{}).get("compute_lease_renewed") is False,"platform renewal failed or claimed compute renewal"))
        check("identity.renew.same-key-still-authenticates",lambda:expect(f.invoke("identity.describe",{},key="runner")[1].get("ok") is True,"renewal invalidated current key/id"))
        check("identity.renew.ttl-ceiling",lambda:expect(f.invoke("identity.principal.renew",{"ttl_seconds":3601},key="runner")[1].get("ok") is False,"renewal exceeded configured ceiling"))
        delegated=f.delegate_principal("reviewer",session)
        principal=f.invoke("identity.describe",{},key="reviewer")[1].get("result",{}).get("principal",{})
        check("identity.delegate.boot-bound-reviewer",lambda:expect(principal.get("sandbox_id")==i["sandbox"] and principal.get("boot_id")==i["boot"] and principal.get("attempt_id") is None,"reviewer boot/job identity invalid"))
        f.sql("UPDATE hyperfide.agent_sessions SET state='STOPPED',state_version=state_version+1 WHERE id=$1",[session])
        check("identity.delegate.stopped-session-denied",lambda:expect(f.invoke("identity.describe",{},key="reviewer")[1].get("ok") is False,"stopped session retained authority"))
        f.sql("UPDATE hyperfide.agent_sessions SET state='REGISTERED',state_version=state_version+1 WHERE id=$1",[session])
        package=uid();task=uid();attempt=uid();worker_slot=uid();worker_session=uid()
        f.sql("INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES($1,$2,$3,'identity-worker',1)",[i["organisation"],i["run"],package])
        f.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) VALUES($1,$2,$3,'identity-worker',$4,$5,$6,'{}',1)",[i["organisation"],i["run"],task,package,i["spec"],sha(b"criteria")])
        f.sql("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind) VALUES($1,$2,$3,'worker-slot',1,'AGENT')",[i["organisation"],worker_slot,i["sandbox"]])
        f.sql("INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,compute_authority,sandbox_id,slot_id,sandbox_boot_generation,lease_expires_at) VALUES($1,$2,$3,$4,1,$5,$6,'CURRENT',$7,$8,1,clock_timestamp()+interval '5 minutes')",[i["organisation"],i["run"],attempt,task,i["epoch"],sha(b"input"),i["sandbox"],worker_slot])
        f.sql("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id,slot_id,sandbox_id,sandbox_boot_generation,attempt_id) VALUES($1,$2,$3,'WORKER','fixture','fixture',$4,$5,$6,1,$7)",[i["organisation"],i["run"],worker_session,uid(),worker_slot,i["sandbox"],attempt])
        f.delegate_principal("worker",worker_session)
        lease_before=f.sql("SELECT lease_expires_at FROM hyperfide.attempts WHERE id=$1",[attempt])[0]["lease_expires_at"]
        renewed_worker=f.invoke("identity.principal.renew",{"ttl_seconds":600},key="worker")[1]
        check("identity.renew.worker-compute-lease-unchanged",lambda:expect(renewed_worker.get("ok") is True and f.sql("SELECT lease_expires_at FROM hyperfide.attempts WHERE id=$1",[attempt])[0]["lease_expires_at"]==lease_before,"identity renewal changed compute lease"))

        check("identity.delegate.current-implementation-worker",lambda:expect(f.invoke("identity.describe",{},key="worker")[1].get("result",{}).get("principal",{}).get("attempt_id")==attempt,"worker lacks genuine attempt binding"))
        f.sql("UPDATE hyperfide.attempts SET compute_authority='RELEASED',state_version=state_version+1 WHERE id=$1",[attempt])
        # A read-only identity description may use current identity; mutation requires strict compute authority.
        check("identity.delegate.released-worker-mutation-denied",lambda:expect(f.invoke("identity.runner.register",{"preparation_digest":f.preparation,"inventory":[]},key="worker")[1].get("error",{}).get("code")=="AUTH_STALE_ATTEMPT","released worker reached a mutation"))
        def expiry_crossing_lock():
            f.sql("UPDATE hyperfide.identity_principals SET expires_at=clock_timestamp()+interval '1 second' WHERE credential_id=$1",[f.ids["reviewer"]])
            js="const pg=require('./services/hyperfide/node_modules/pg');(async()=>{const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();await c.query('BEGIN');await c.query('SELECT id FROM hyperfide.agent_sessions WHERE id=$1 FOR UPDATE',[process.argv[1]]);process.stdout.write('locked\\n');await new Promise(r=>setTimeout(r,2200));await c.query('ROLLBACK');await c.end();})().catch(e=>{console.error(e);process.exit(1)});"
            held=subprocess.Popen(["node","-e",js,session],cwd=ROOT,env=f.env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            expect(held.stdout.readline().strip()=="locked","test did not acquire real row lock")
            response=f.invoke("identity.describe",{},key="reviewer")[1]
            held.communicate(timeout=5)
            expect(response.get("error",{}).get("code")=="AUTH_EXPIRED","identity expired during lock wait was admitted: "+json.dumps(response))
        check("identity.expiry.after-row-lock",expiry_crossing_lock)
        f.sql("UPDATE hyperfide.runs SET state='STOPPING',state_version=state_version+1 WHERE id=$1",[i["run"]])
        f.stop();f.start()
        check("identity.closing.restart-retains-supervision",lambda:expect(f.invoke("identity.describe",{})[1].get("ok") is True,"closing run prevented authenticated supervision/restart"))
        check("identity.closing.new-grant-denied",lambda:expect(f.issue(grant=uid())[1].get("error",{}).get("code")=="AUTH_RUN_CLOSED","closing run admitted new runner grant"))
        f.close();f=IdentityFixture();fixture=f
        def no_runtime_seed():
            f.stop();config=json.loads(f.identity_config.read_text());bad={**config["principals"][0],"credential_id":uid(),"actor_id":uid()};config["principals"].append(bad);f.identity_config.write_text(json.dumps(config))
            rejected=False
            try:f.start()
            except AssertionError:
                rejected=True
                if f.child:f.child.wait(timeout=5);f.child=None
            finally:
                config["principals"].pop();f.identity_config.write_text(json.dumps(config))
            expect(rejected,"runtime config silently issued a new principal")
            expect(not f.sql("SELECT credential_id FROM hyperfide.identity_principals WHERE credential_id=$1",[bad["credential_id"]]),"runtime created missing identity")
            f.start()
        check("identity.bootstrap.config-cannot-issue",no_runtime_seed)
        f.sql("UPDATE hyperfide.authority_epochs SET state='REVOKED' WHERE deployment_id=$1",[f.ids["deployment"]])
        f.sql("INSERT INTO hyperfide.authority_epochs(deployment_id,epoch,previous_epoch,state,fence_id,proof_digest) VALUES($1,$2,$3,'ACTIVE','declared-test-rotation',$4)",[f.ids["deployment"],uid(),f.ids["epoch"],sha(b"declared fixture epoch rotation")])
        check("identity.global-epoch.stale-run-and-key-denied",lambda:expect(f.invoke("identity.describe",{})[1].get("error",{}).get("code")=="STALE_AUTHORITY","matching stale run/key bypassed deployment epoch"))
        check("identity.shutdown.orderly",lambda:f.stop())
    finally:fixture.close()
    return int(any(actual!="observed" for _,actual in RESULTS))
if __name__=="__main__":raise SystemExit(main())
