#!/usr/bin/env python3
from pathlib import Path
import sys,json,subprocess,os,time
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/"tests/hyperfide/support"))
from identity_fixture import IdentityFixture,RESULTS,check,expect,uid,b64,sha
def service_rpc_probe(f):
    import socket,select,signal
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    f.evidence_extra_ports=[port]
    origin='https://localhost:'+str(port);config=json.loads(f.identity_config.read_text());config['origin']=origin
    file=f.path/'provisioner-identity.json';file.write_text(json.dumps(config));file.chmod(0o600)
    env=f.env.copy();env['HF_IDENTITY_CONFIG_FILE']=str(file)
    argv=['node',str(ROOT/'services/hyperfide/dist/provisioner.js'),'--policy',str(f.policy),'--spec-revision','fixture-identity-v1','--components',str(f.components),'--module-root',str(ROOT/'services/hyperfide/dist'),'--mode','https','--host','127.0.0.1','--port',str(port),'--tls-cert',str(f.ca),'--tls-key',str(f.tlskey)]
    child=subprocess.Popen(argv,cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        deadline=time.monotonic()+15;ready=False;lines=[]
        while time.monotonic()<deadline:
            readers,_,_=select.select([child.stderr],[],[],0.1)
            if readers:
                line=child.stderr.readline();lines.append(line)
                if '"event":"ready"' in line:ready=True;break
            if child.poll() is not None:break
        expect(ready,'Actual provisioner HTTPS peer failed: '+''.join(lines)[:800])
        from identity_fixture import canonical,b64
        body=f.operation('14.1','identity.describe',{});raw=canonical(body);seconds=str(int(time.time()));nonce=uid()
        headers=['HF-Credential-Id',f.ids['operator'],'HF-Request-Time',seconds,'HF-Request-Nonce',nonce,'HF-Request-Signature',f.sign('operator',('\n'.join(('HYPERFIDE-REQUEST-V1','POST','/v1/invoke',f.origin,f.ids['operator'],seconds,nonce,sha(raw),''))).encode())]
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));unused=sock.getsockname()[1]
        args={'components':str(f.components),'policy':str(f.policy),'body':b64(raw),'headers':headers,'origin':origin,'ca':str(f.ca),'key':str(f.keys['provisioner']['path']),'credential':f.ids['provisioner'],'run':f.ids['run'],'command':f.operation('14.1','identity.describe',{}),'denied':f.operation('14.1','identity.principal.revoke',{}),'unreachable':'https://localhost:'+str(unused)}
        script="import fs from 'node:fs';import {ComponentRegistry} from './services/hyperfide/dist/components/registry.js';import {validatePolicy} from './services/hyperfide/dist/policy/programme.js';import {createServiceClient} from './services/hyperfide/dist/transport/http.js';const a=JSON.parse(fs.readFileSync(0,'utf8')),c=new AbortController(),policy=validatePolicy(JSON.parse(fs.readFileSync(a.policy,'utf8')),'fixture-identity-v1','control'),r=new ComponentRegistry({role:'control',env:process.env,signal:c.signal,policy});try{await r.load(a.components,process.cwd()+'/services/hyperfide/dist');const auth=r.resolveCapability('14.1','identity.authority',v=>typeof v.authenticate==='function'),i=await auth.authenticate(Buffer.from(a.body,'base64url'),a.headers,c.signal),config={origin:a.origin,caFile:a.ca,keyFile:a.key,credentialId:a.credential,runId:a.run,routes:{'identity.describe':{roles:['OPERATOR'],components:['14.1'],actions:['identity.describe']}},timeoutMs:2000,maxConcurrent:2},gateway=r.resolveCapability('4.2','storage.resources.v1',v=>!!v?.gateway).gateway;const command=x=>{const {payload_b64,...operation}=x;return{operation,payloadBytes:Buffer.from(payload_b64,'base64url')}};const client=await createServiceClient(config,gateway);auth.sealTrustedRegistrations();let late=false;try{auth.installMainSessionVerifier({verify:async()=>{throw Error('must never run')}})}catch(e){late=e.code==='IDENTITY_REGISTRY_SEALED'}let route=false,forged=false;const response=await client.invoke(i,command(a.command));try{await client.invoke(i,command(a.denied))}catch(e){route=e.code==='AUTH_SCOPE_DENIED'}try{await client.invoke({...i},command(a.command))}catch(e){forged=e.code==='AUTH_REQUIRED'}const dead=await createServiceClient({...config,origin:a.unreachable},gateway),unknown=await dead.invoke(i,command(a.command));process.stdout.write(JSON.stringify({role:response.transport==='RESPONSE'&&response.body.ok&&response.body.result.principal.role,late,matching:response.transport==='RESPONSE'&&response.body.operation_id===a.command.operation_id,route,forged,unknown:unknown.transport==='UNKNOWN'}));}finally{c.abort();await r.close();}"
        process=subprocess.run(['node','--input-type=module','-e',script],input=json.dumps(args),cwd=ROOT,env=f.env,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
        expect(process.returncode==0,'Actual authenticated service client failed: '+process.stderr[:800]);data=json.loads(process.stdout)
        check('identity.service-rpc.actual-provisioner-principal',lambda:expect(data['role']=='PROVISIONER','RPC reused caller identity rather than real scoped service credential'))
        check('identity.main.startup-verifier-registry-sealed',lambda:expect(data['late'],'MAIN verifier could be replaced after listener readiness'))
        check('identity.service-rpc.operation-binding',lambda:expect(data['matching'],'RPC response lost operation binding'))
        check('identity.service-rpc.fixed-route-denial',lambda:expect(data['route'],'RPC expanded configured destination action'))
        check('identity.service-rpc.forged-context-denial',lambda:expect(data['forged'],'RPC accepted structural principal'))
        check('identity.service-rpc.unreachable-is-unknown',lambda:expect(data['unknown'],'Transport failure claimed success/replay safety'))
    finally:
        child.send_signal(signal.SIGTERM)
        try:_,err=child.communicate(timeout=8)
        except subprocess.TimeoutExpired:child.kill();child.communicate();raise AssertionError('RPC peer failed bounded shutdown')
        expect(child.returncode==0,'RPC peer termination failed: '+err[:500])

def main():
    from identity_fixture import cleanup_identity_evidence,write_identity_observations
    os.environ["HYPERFIDE_IDENTITY_EVIDENCE_TASK"]="14.1"
    if "--cleanup" in sys.argv:return cleanup_identity_evidence("14.1")
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
        heartbeat=f.request(f.operation("14.1","identity.runner.heartbeat",{"expected_version":"1"},expected_version="1"),key="runner",credential=credential)
        check("identity.runner.heartbeat",lambda:expect(heartbeat[1].get("ok") is True,"runner heartbeat failed"))
        divergent=f.request(f.operation("14.1","identity.runner.heartbeat",{"expected_version":"2"},expected_version="1"),key="runner",credential=credential)
        check("identity.envelope.expected-version-bound",lambda:expect(divergent[1].get("ok") is False and divergent[1].get("error",{}).get("code")=="VERSION_CONFLICT" and f.sql("SELECT state_version::text AS v FROM hyperfide.identity_runner_status WHERE credential_id=$1",[credential])[0]["v"]=="2","divergent signed expected_version reached the action"))
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
            js="""
const pg=require('./services/hyperfide/node_modules/pg');
(async()=>{
 const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();
 try{
  await c.query("UPDATE hyperfide.identity_principals SET expires_at=clock_timestamp()+interval '2 seconds' WHERE credential_id=$1",[process.argv[2]]);
  await c.query('BEGIN');
  await c.query('SELECT id FROM hyperfide.agent_sessions WHERE id=$1 FOR UPDATE',[process.argv[1]]);
  process.stdout.write('locked\\n');
  const deadline=Date.now()+3000;let blocked=false;
  while(Date.now()<deadline){
   const r=await c.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pg_backend_pid()=ANY(pg_blocking_pids(pid))) AS blocked');
   if(r.rows[0].blocked){blocked=true;break;}
   await new Promise(r=>setTimeout(r,10));
  }
  if(!blocked)throw Error('Request never waited on the session row lock');
  await c.query("SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM expires_at-clock_timestamp()))::double precision) FROM hyperfide.identity_principals WHERE credential_id=$1",[process.argv[2]]);
  await c.query('ROLLBACK');
 }finally{await c.end();}
})().catch(e=>{console.error(e);process.exitCode=1});
"""
            held=subprocess.Popen(["node","-e",js,session,f.ids["reviewer"]],cwd=ROOT,env=f.env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            try:
                expect(held.stdout.readline().strip()=="locked","test did not acquire real row lock")
                response=f.invoke("identity.describe",{},key="reviewer")[1]
                _,error=held.communicate(timeout=5)
                expect(held.returncode==0,"Expiry lock process failed: "+error)
                expect(response.get("error",{}).get("code")=="AUTH_EXPIRED","identity expired during lock wait was admitted: "+json.dumps(response))
                check("identity.expiry.before-row-lock",lambda:expect(f.invoke("identity.describe",{},key="reviewer")[1].get("error",{}).get("code")=="AUTH_EXPIRED","already expired credential returned a different refusal"))
                f.sql("UPDATE hyperfide.identity_principals SET state='REVOKED' WHERE credential_id=$1",[f.ids["reviewer"]])
                check("identity.expiry.revoked-credential",lambda:expect(f.invoke("identity.describe",{},key="reviewer")[1].get("error",{}).get("code")=="AUTH_EXPIRED","revocation changed expired credential refusal"))
            finally:
                if held.poll() is None:held.kill();held.communicate()
        check("identity.expiry.after-row-lock",expiry_crossing_lock)
        def global_expiry_lock():
            f.add_principal('globalexpiring','OPERATOR')
            f.sql("UPDATE hyperfide.identity_principals SET expires_at=clock_timestamp()+interval '800 milliseconds' WHERE credential_id=$1",[f.ids['globalexpiring']])
            held_script="const {createRequire}=require('module'),pg=createRequire(process.cwd()+'/services/hyperfide/package.json')('pg');(async()=>{const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();try{await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await c.query('SELECT epoch FROM hyperfide.authority_epochs WHERE deployment_id=$1 FOR UPDATE',[process.argv[1]]);process.stdout.write('locked\\n');await c.query('SELECT pg_sleep(1.3)');await c.query('COMMIT');}finally{await c.end();}})().catch(e=>{process.stderr.write(e.code||'ERROR');process.exitCode=1});"
            held=subprocess.Popen(['node','--input-type=commonjs','-e',held_script,f.ids['deployment']],cwd=ROOT,env=f.env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            try:
                expect(held.stdout.readline().strip()=='locked','Global epoch test lock missing')
                response=f.invoke('identity.describe',{},key='globalexpiring')[1]
                _,error=held.communicate(timeout=5);expect(held.returncode==0,'Global lock process failed: '+error)
                expect(response.get('error',{}).get('code') in ['AUTH_EXPIRED','AUTH_REVOKED'],'Credential expiring across global authority lock was admitted: '+json.dumps(response))
            finally:
                if held.poll() is None:held.kill();held.communicate()
                config=json.loads(f.identity_config.read_text());config['principals']=[x for x in config['principals'] if x['credential_id']!=f.ids['globalexpiring']];f.identity_config.write_text(json.dumps(config))
        check('identity.expiry.after-global-authority-lock',global_expiry_lock)
        main_request={'session_id':uid(),'public_key_b64':f.keys['other']['public_key_b64'],'allowed_actions':['identity.describe'],'ttl_seconds':300}
        check('identity.main.missing-real-verifier-refused',lambda:expect(f.invoke('identity.main.issue',main_request)[1].get('error',{}).get('code')=='MAIN_VERIFIER_REQUIRED','MAIN credential issued without observed host/native verifier'))
        check('identity.main.nonoperator-refused',lambda:expect(f.invoke('identity.main.issue',main_request,key='provisioner')[1].get('error',{}).get('code')=='ROLE_DENIED','Provisioner minted MAIN supervisor authority'))
        service_rpc_probe(f)
        f.sql("UPDATE hyperfide.runs SET state='STOPPING',state_version=state_version+1 WHERE id=$1",[i["run"]])
        f.stop();f.start()
        check("identity.closing.restart-retains-supervision",lambda:expect(f.invoke("identity.describe",{})[1].get("ok") is True,"closing run prevented authenticated supervision/restart"))
        check("identity.closing.new-grant-denied",lambda:expect(f.issue(grant=uid())[1].get("error",{}).get("code")=="AUTH_RUN_CLOSED","closing run admitted new runner grant"))
        f.sql("UPDATE hyperfide.runs SET state='PAUSED',state_version=state_version+1 WHERE id=$1",[i["run"]])
        paused_before=f.sql("SELECT credential_id,public_key_b64,credential_version FROM hyperfide.identity_principals WHERE credential_id=$1",[i["provisioner"]])[0]
        paused_renew=f.invoke("identity.principal.renew",{"ttl_seconds":600},key="provisioner")[1]
        check("identity.renew.paused-service-same-id-key",lambda:expect(paused_renew.get("ok") is True and paused_renew["result"]["compute_lease_renewed"] is False and f.sql("SELECT credential_id,public_key_b64 FROM hyperfide.identity_principals WHERE credential_id=$1",[i["provisioner"]])[0]=={"credential_id":paused_before["credential_id"],"public_key_b64":paused_before["public_key_b64"]},"Paused service renewal expanded authority or changed key/id"))
        check("identity.renew.paused-service-no-admission",lambda:expect(f.bind()[1].get("error",{}).get("code")=="AUTH_RUN_CLOSED","Renewed service advanced paused work"))
        check("identity.renew.paused-operator-denied",lambda:expect(f.invoke("identity.principal.renew",{"ttl_seconds":600})[1].get("error",{}).get("code")=="AUTH_RUN_CLOSED","Operator gained unapproved paused renewal"))
        check("identity.renew.paused-runner-denied",lambda:expect(f.invoke("identity.principal.renew",{"ttl_seconds":600},key="runner")[1].get("error",{}).get("code")=="AUTH_RUN_CLOSED","Runner renewed without persisted cleanup proof"))
        f.sql("UPDATE hyperfide.identity_principals SET state='REVOKED',credential_version=credential_version+1 WHERE credential_id=$1",[i["provisioner"]])
        check("identity.renew.paused-revocation-absolute",lambda:expect(f.invoke("identity.principal.renew",{"ttl_seconds":600},key="provisioner")[1].get("error",{}).get("code")=="AUTH_REVOKED","Revoked service renewed while paused"))
        f.close();f=IdentityFixture();fixture=f
        def renewal_expiry_during_lock_upgrade():
            from concurrent.futures import ThreadPoolExecutor
            credential=f.ids['provisioner']
            f.sql("UPDATE hyperfide.identity_principals SET expires_at=clock_timestamp()+interval '2 seconds' WHERE credential_id=$1",[credential])
            with ThreadPoolExecutor(max_workers=1) as pool:
                hold=pool.submit(f.sql,"WITH locked AS MATERIALIZED (SELECT credential_id FROM hyperfide.identity_principals WHERE credential_id=$1 FOR SHARE) SELECT pg_sleep(3) FROM locked /* identity-renew-lock-holder */",[credential])
                deadline=time.monotonic()+2
                while time.monotonic()<deadline:
                    observed=f.sql("SELECT 1 FROM pg_stat_activity WHERE query LIKE '%identity-renew-lock-holder%' AND wait_event='PgSleep'")
                    if observed:break
                expect(bool(observed),'Actual shared credential row lock was not observed')
                answer=f.invoke('identity.principal.renew',{'ttl_seconds':600},key='provisioner')[1]
                hold.result(timeout=8)
            row=f.sql("SELECT credential_version::text,expires_at<clock_timestamp() AS expired FROM hyperfide.identity_principals WHERE credential_id=$1",[credential])[0]
            expect(answer.get('ok') is False and answer.get('error',{}).get('code') in ('AUTH_REVOKED','AUTH_EXPIRED') and row=={'credential_version':'1','expired':True},'Credential expired during actual lock upgrade but renewal revived it')
        check('identity.renew.expiry-after-exclusive-row-lock',renewal_expiry_during_lock_upgrade)
        f.sql("UPDATE hyperfide.runs SET state='SUCCEEDED',state_version=state_version+1 WHERE id=$1",[f.ids['run']])
        check('identity.succeeded-run.new-grant-denied',lambda:expect(f.issue(grant=uid())[1].get('error',{}).get('code')=='AUTH_RUN_CLOSED','Succeeded run admitted new authority'))
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
        def missing_journal_refuses():
            f.stop();head=f.authority_journal/(f.ids['deployment']+'.authority.json');hidden=f.path/'held-authority-head';head.rename(hidden)
            rejected=False
            try:
                try:f.start()
                except AssertionError:
                    rejected=True
                    if f.child:f.child.communicate(timeout=5);f.child=None
            finally:hidden.rename(head)
            expect(rejected,'Runtime accepted database rows without its actual external authority journal')
            f.start()
        check('identity.journal.missing-head-refuses-readiness',missing_journal_refuses)
        expect(f.bind()[1].get('ok') is True and f.issue()[1].get('ok') is True,'Current grant fixture setup failed')
        # Corrupt only the fixture's run/key/grant snapshot to an old epoch; do not manufacture an activated journal head.
        stale=uid()
        f.sql('WITH changed_run AS (UPDATE hyperfide.runs SET authority_epoch=$2,state_version=state_version+1 WHERE id=$1 RETURNING id),changed_keys AS (UPDATE hyperfide.identity_principals SET deployment_epoch=$2 WHERE run_id=$1 RETURNING credential_id) UPDATE hyperfide.identity_enrollment_grants SET deployment_epoch=$2 WHERE run_id=$1',[f.ids['run'],stale])
        check("identity.global-epoch.stale-run-and-key-denied",lambda:expect(f.invoke("identity.describe",{})[1].get("error",{}).get("code")=="STALE_AUTHORITY","matching stale run/key bypassed deployment epoch"))
        check('identity.enroll.stale-global-epoch-denied',lambda:expect(f.request(f.enrollment(),key='runner',endpoint='/v1/enroll',credential=f.grant)[1].get('error',{}).get('code')=='STALE_AUTHORITY','Old global epoch minted runner identity'))
        check("identity.shutdown.orderly",lambda:f.stop())
    finally:fixture.close()
    write_identity_observations()
    return int(any(actual!="observed" for _,actual in RESULTS))
if __name__=="__main__":raise SystemExit(main())
