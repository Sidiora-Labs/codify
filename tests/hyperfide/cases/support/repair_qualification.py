"""Independent native qualification on a controlled provider transport."""
from __future__ import annotations
import base64
import copy
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time


class RepairQualification:
    def __init__(self, submission, c):
        self.submission, self.c = submission, c
        self.child = None
        self.operation = None

    def profile(self, f, key, commit):
        c, i = self.c, f.ids
        profile = copy.deepcopy(f.sql('SELECT manifest FROM hyperfide.environment_profiles WHERE id=$1', [i[key+'_profile']])[0]['manifest']['profile'])
        profile['profile_id'] = c.uid()
        operating_system = dict(line.split('=', 1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
        profile['os'] = dict(distribution=operating_system['ID'].strip('"'), version=operating_system['VERSION_ID'].strip('"'), architecture=os.uname().machine)
        version = subprocess.check_output(['/usr/bin/git', '--version'], text=True).strip().split()[-1]
        for group in ('toolchains', 'native_agents', 'connectors', 'system_packages'):
            profile[group] = [dict(name='git', version=version)]
        profile.update(package_managers=[], supervisor=dict(name='git', version=version), hyperfide=dict(version=version),
                       credential_references=[], required_capabilities=['execute', 'transfer'])
        profile['recipe'] = dict(path='prepare.json', digest=c.sha((self.submission.repository/'prepare.json').read_bytes()))
        profile['preparation_evidence'] = [dict(path='scan.json', digest=c.sha((self.submission.repository/'scan.json').read_bytes()))]
        profile['package_managers'] = [dict(name='git', version=version, locks=profile['preparation_evidence'])]
        self.scan = dict(secret_canaries=['repair-secret-canary'], identity_canaries=['repair-identity-canary'], lease_canaries=['repair-lease-canary'])
        program = """import fs from 'node:fs';import {createManifest} from './services/hyperfide/dist/preparation/manifests.js';
const v=JSON.parse(fs.readFileSync(0,'utf8'));console.log(JSON.stringify(await createManifest(v.input,{env:{HF_PREPARATION_ALLOWED_ROOT:v.root},signal:new AbortController().signal})));"""
        manifest = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', program], cwd=c.ROOT,
            input=json.dumps(dict(root=str(self.submission.repository.parent), input=dict(candidate_path=self.submission.repository.name, profile=profile, scan_policy=self.scan))).encode()))
        c.insert(f, 'environment_profiles', dict(organisation_id=i['organisation'], id=profile['profile_id'], provider='fixture', runtime_platform='linux', content_digest=manifest['digest'], manifest=manifest))
        pool,sandbox,slot=[c.uid() for _ in range(3)]
        c.insert(f,'provider_pools',dict(organisation_id=i['organisation'],id=pool,provider='fixture',account_key='fixture',environment_key='repair-fixture',region='fixture',profile_id=profile['profile_id']))
        c.insert(f,'sandboxes',dict(organisation_id=i['organisation'],id=sandbox,pool_id=pool,native_sandbox_id='repair-fixture-resource',observed_state='RUNNING',preparation_digest=manifest['digest']))
        c.insert(f,'worker_slots',dict(organisation_id=i['organisation'],id=slot,sandbox_id=sandbox,slot_key='repair-profile',boot_generation='1',capacity_kind='AGENT',state='READY'))
        i[key+'_profile'],i[key+'_pool'],i[key+'_sandbox'],i[key+'_slot']=profile['profile_id'],pool,sandbox,slot
        return manifest['digest']

    def install(self,scheduler):
        self.packet=scheduler.packet
        self.original_profile=self.packet.prepared_slot
        def prepared(f,key,commit):
            self.original_profile(f,key,commit)
            return self.profile(f,key,commit)
        self.packet.prepared_slot=prepared

    def setup(self,f):
        c,i=self.c,f.ids
        f.actions.extend(['provider.remote.execute-bound','runner.executor.describe'])
        policy=json.loads(f.policy.read_text());policy['allowed_actions']=f.actions;f.policy.write_text(json.dumps(policy))
        config=json.loads(f.identity_config.read_text())
        for principal in config['principals']:
            principal['allowed_actions']=f.actions
            f.sql('UPDATE hyperfide.identity_principals SET allowed_actions=$2 WHERE credential_id=$1', [principal['credential_id'], f.actions])
        f.identity_config.write_text(json.dumps(config))
        executable=Path('/usr/bin/python3').resolve()
        script="from pathlib import Path; import sys; value=Path("+json.dumps(i['repository']+'/src/claim-a.ts')+").read_text(); Path('fixture').mkdir(exist_ok=True); Path('fixture/stdout.log').write_text(value); print(value,end=''); sys.exit(0 if value=='repaired result\\n' else 1)"
        f.repair_check=dict(id='finding-repaired', argv=[str(executable),'-c',script], executable_digest=c.sha(executable.read_bytes()), timeout_ms=5000,
                            required_artifacts=['fixture/stdout.log'], input_keys=['source','dependency','toolchain','configuration','graph','contract'])

    def put(self, f, data):
        return f.ok('artifact.object.put', self.c.scoped(f, digest=self.c.sha(data), size_bytes=str(len(data)), data_base64=base64.b64encode(data).decode(),
                    retention_class='RUN', retention_until=None, retention_hold=False), component='15.2')

    def start(self, f):
        c,i=self.c,f.ids
        root=Path('/run')/('hyperfide-qualification-'+c.uid());root.mkdir(mode=0o711);self.root=root
        state=root/'state';state.mkdir(mode=0o700)
        slot=root/'slot';slot.mkdir(mode=0o700);os.chown(slot,65533,65533)
        for name in ('home','tmp'):
            directory=slot/name;directory.mkdir(mode=0o700);os.chown(directory,65533,65533)
        sandbox,boot,slot_id,session=[c.uid() for _ in range(4)]
        c.insert(f,'sandboxes',dict(organisation_id=i['organisation'],id=sandbox,pool_id=i['pool'],native_sandbox_id='independent-repair-verifier',observed_state='RUNNING',preparation_digest=f.preparation))
        boot=f.sql('SELECT boot_id FROM hyperfide.sandbox_boots WHERE sandbox_id=$1',[sandbox])[0]['boot_id']
        self.target=dict(sandbox=sandbox, boot=boot, slot=slot_id, session=session)
        c.insert(f,'worker_slots',dict(organisation_id=i['organisation'],id=slot_id,sandbox_id=sandbox,slot_key='independent-verifier',boot_generation='1',capacity_kind='TEST',state='READY'))
        c.insert(f,'agent_sessions',c.scoped(f,id=session,role='VERIFIER',connector='fixture',account_key='fixture',native_session_id=c.uid(),sandbox_id=sandbox,slot_id=slot_id,sandbox_boot_generation='1',state='RUNNING'))
        # Explicit fixture identity issuance; every following operation uses signed HTTPS.
        verifier=c.uid();i['independent_verifier']=verifier
        verifier_key=f.path/'independent-verifier.pem'
        subprocess.run(['openssl','genpkey','-algorithm','Ed25519','-out',str(verifier_key)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);verifier_key.chmod(0o600)
        verifier_public=subprocess.check_output(['openssl','pkey','-in',str(verifier_key),'-pubout','-outform','DER'],stderr=subprocess.DEVNULL)
        verifier_public64=base64.urlsafe_b64encode(verifier_public[-32:]).decode().rstrip('=')
        f.keys['independent_verifier']=dict(path=verifier_key,public_key_b64=verifier_public64)
        principal=dict(credential_id=verifier,organisation_id=i['organisation'],run_id=i['run'],actor_id=session,role='VERIFIER',public_key_b64=verifier_public64,
            deployment_epoch=i['epoch'],allowed_actions=f.actions,expires_at='2099-01-01T00:00:00.000Z')
        f.seed_fixture_principal(principal)
        f.sql('UPDATE hyperfide.identity_principals SET sandbox_id=$2,boot_id=$3,boot_generation=1 WHERE credential_id=$1',[i['independent_verifier'],sandbox,boot])
        runner=c.uid();i['qualification_runner']=runner
        key=f.path/'qualification-runner.pem'
        subprocess.run(['openssl','genpkey','-algorithm','Ed25519','-out',str(key)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);key.chmod(0o600)
        public=subprocess.check_output(['openssl','pkey','-in',str(key),'-pubout','-outform','DER'],stderr=subprocess.DEVNULL)
        public64=base64.urlsafe_b64encode(public[-32:]).decode().rstrip('=')
        f.keys['qualification_runner']=dict(path=key,public_key_b64=public64)
        f.sql("INSERT INTO hyperfide.identity_principals(credential_id,organisation_id,run_id,actor_id,role,public_key_b64,deployment_epoch,allowed_actions,expires_at,sandbox_id,boot_id,boot_generation) VALUES($1,$2,$3,$1,'RUNNER',$4,$5,$6,'2099-01-01T00:00:00Z',$7,$8,1)",
            [runner,i['organisation'],i['run'],public64,i['epoch'],f.actions,sandbox,boot])
        release=root/'release';release.mkdir(mode=0o755)
        native=release/'hyperfide-native';shutil.copyfile(c.ROOT/'build/hyperfide-native',native);native.chmod(0o755)
        node=Path(subprocess.check_output(['node','-p','process.execPath'],text=True).strip()).resolve()
        released_node=release/'node';shutil.copyfile(node,released_node);released_node.chmod(0o755);node=released_node
        for name in ('result_recipe.js','manifests.js','effective.js'):
            shutil.copyfile(c.ROOT/'services/hyperfide/dist/preparation'/name,release/name)
        recipe=release/'result_recipe.js'
        git_output=subprocess.check_output(['/usr/bin/git','--version'])
        trusted=dict(native_path=str(native),scan=self.scan,credentials=dict(schema_version=1,records=[]),
            tools=dict(bindings=[dict(name=name,version=git_output.decode().strip().split()[-1],executable='/usr/bin/git',argv=['--version'],output_digest=c.sha(git_output)) for name in ('git','hyperfide')]))
        context=self.put(f,json.dumps(trusted).encode())['artifact']
        pins=dict(node_path=str(node),node_digest=c.sha(node.read_bytes()),recipe_path=str(recipe),recipe_digest=c.sha(recipe.read_bytes()),native_path=str(native),native_digest=c.sha(native.read_bytes()),
            base_root=str(root),max_stage_bytes='16777216',readiness_context=dict(artifact_id=context['artifact_id'],digest=context['digest'],size_bytes=str(context['size_bytes'])),
            sealing=dict(node_path=str(node),node_digest=c.sha(node.read_bytes()),script_path=str(recipe),script_digest=c.sha(recipe.read_bytes()),module_closure=[dict(path=str(module),digest=c.sha(module.read_bytes())) for module in (recipe,recipe.parent/'manifests.js',recipe.parent/'effective.js')]))
        self.recipes={'environment.prepare.v1':pins}
        deployment=dict(schema_version=1,policies=[dict(organisation_id=i['organisation'],run_id=i['run'],authority_epoch=i['epoch'],base_profiles=[dict(profile_id=i['profile'],preparation_digest=f.preparation)],recipes=self.recipes)])
        policy_path=root/'recipes.json';policy_path.write_text(json.dumps(deployment));policy_path.chmod(0o600)
        f.env.update(HF_RUNNER_PREPARATION_RECIPES_FILE=str(policy_path),HF_RUNNER_PREPARATION_RECIPES_DIGEST=c.sha(policy_path.read_bytes()))
        # Lower08 requires the current accepted pool configuration for derived-profile lineage.
        config=dict(pool=dict(preparation_digest=f.preparation))
        f.sql('INSERT INTO hyperfide.provider_pool_configurations(organisation_id,pool_id,configuration_digest,document,active) VALUES($1,$2,$3,$4,true)',[i['organisation'],i['pool'],c.sha(json.dumps(config,sort_keys=True,separators=(',',':')).encode()),json.dumps(config)])
        transport=root/'transport.json';transport.write_text(json.dumps(dict(origin=f.origin,ca_file=str(f.ca),key_path=str(key),credential_id=runner,timeout_ms=5000)));transport.chmod(0o600)
        self.runner_config=state/'runner.json';self.readiness_env=state/'readiness-env.json'
        self.runner_config.write_text(json.dumps(dict(organisation_id=i['organisation'],run_id=i['run'],sandbox_id=sandbox,boot_id=boot,boot_generation='1',state_dir=str(state),slot_root=str(slot),connector_plan_path=str(state/'unused-plan.json'),consumer_id=c.uid(),transport_config=str(transport),readiness_env_path=str(self.readiness_env),preparation_recipes=self.recipes)));self.runner_config.chmod(0o600)
        binding=dict(session_id=session,slot_id=slot_id,repository_id=i['repository'],state_dir=str(state),runner_binary=str(native),workspace_path=str(slot/'workspace'),home_path=str(slot/'home'),tmp_path=str(slot/'tmp'),
            runner_binary_digest=c.sha(native.read_bytes()),preparation_digest=f.preparation,slot_generation='1',uid=65533,gid=65533,preparation_recipes=self.recipes)
        self.binding=binding
        f.stop();f.start()
        f.ok('identity.runner.register',dict(preparation_digest=f.preparation,inventory=[binding]),key='qualification_runner',component='14.1')
        f.ok('runner.registry.prepare',binding,key='qualification_runner',component='12.1')
        budget=dict(organisation_id=i['organisation'],sandbox_id=sandbox,sandbox_boot_generation='1',qualification_id=c.uid(),evidence_digest=c.sha(b'explicit independent fixture budget'),source='OPERATOR_FIXED',
            hard_limits=dict(cpu_millis='8000',memory_bytes='17179869184',disk_bytes='34359738368'),headroom=dict(cpu_millis='1000',memory_bytes='1073741824',disk_bytes='0'))
        c.expect('result' in f.primary('return claims.qualifySandboxBudget(tx,data.budget);',dict(budget=budget)),'Independent budget qualification failed')
        self.start_executor(f)

    def start_executor(self,f):
        c=self.c;root=self.root
        components=root/'components';components.mkdir()
        for name in ('1.4','4.2','4.4','14.1','15.2','12.4-executor'):
            shutil.copyfile(c.ROOT/'services/hyperfide/components'/ (name+'.json'),components/(name+'.json'))
        provider=dict(schema_version=1,id='8.3',task='8.3',roles=['provisioner'],module='tests/hyperfide/cases/support/repair_provider.js',entry='createComponent',api_version=1,actions=['provider.remote.execute-bound'],requires=['4.2','14.1'])
        # All production fragments use their built modules under the repository root.
        for fragment in components.glob('*.json'):
            body=json.loads(fragment.read_text());body['module']='services/hyperfide/dist/'+body['module'];fragment.write_text(json.dumps(body))
        (components/'8.3.json').write_text(json.dumps(provider))
        config=root/'executor.json';config.write_text(json.dumps(dict(schema_version=1,principals=[dict(credential_id=f.ids['provisioner'],key_path=str(f.keys['provisioner']['path']))],concurrency=1)));config.chmod(0o600)
        env=dict(f.env,HF_RUNNER_EXECUTOR_CONFIG_FILE=str(config));port=socket.socket();port.bind(('127.0.0.1',0));self.port=port.getsockname()[1];port.close()
        self.log=root/'executor.log';log=open(self.log,'w')
        try:self.child=subprocess.Popen(['node',str(c.ROOT/'services/hyperfide/dist/provisioner.js'),'--policy',str(f.policy),'--spec-revision','fixture-identity-v1','--components',str(components),'--module-root',str(c.ROOT),
            '--mode','https','--host','127.0.0.1','--port',str(self.port),'--tls-cert',str(f.ca),'--tls-key',str(f.tlskey)],cwd=c.ROOT,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=log)
        finally:log.close()
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            if '"event":"ready"' in self.log.read_text():return
            if self.child.poll() is not None:break
            time.sleep(.1)
        raise AssertionError('Independent executor failed: '+self.log.read_text())

    def allocate(self,f,kind):
        c,i=self.c,f.ids;t=self.target
        request=c.uid()
        queued=f.ok('scheduler.resources.queue',c.scoped(f,request_id=request,pool_id=i['pool'],job_kind=kind,priority=0,wait_reason='CAPACITY',deadline_ms=300000,
            dimensions=f.capacity(kind),authority_epoch=i['epoch'],leader_generation='1',package_generation='2',task_id=i['task_a'],package_id=i['package']),key='manager',component='5.4')
        admitted=f.ok('scheduler.resources.admit',c.scoped(f,waiter_id=queued['waiter_id'],pool_id=i['pool'],authority_epoch=i['epoch'],leader_generation='1',package_generation='2',package_id=i['package']),key='manager',component='5.4')
        c.expect(admitted.get('admitted') is True,'Independent '+kind+' resources were not admitted: '+str(admitted))
        reservation=f.sql('SELECT r.id FROM hyperfide.reservations r JOIN hyperfide.capacity_accounts a ON a.id=r.capacity_account_id WHERE r.request_id=$1 AND a.dimension=$2',[request,kind])[0]['id']
        binding=c.scoped(f,task_id=i['task_a'],job_kind=kind,reservation_id=reservation,slot_id=t['slot'],sandbox_id=t['sandbox'],sandbox_boot_generation='1',assignee_session_id=t['session'])
        result=f.primary('return claims.bindJobReservation(tx,data.binding);',dict(binding=binding))
        c.expect('result' in result,'Independent binding failed: '+str(result));return reservation

    def qualify(self,f):
        c,i=self.c,f.ids;self.start(f)
        job=f.repair_submission['job_id'];reservation=self.allocate(f,'PREPARATION')
        bundle=self.root/'source.bundle';self.submission.git('bundle','create',str(bundle),'--all')
        source=self.put(f,bundle.read_bytes())['artifact'];policy=self.put(f,(self.submission.repository/'prepare.json').read_bytes())['artifact']
        self.operation=c.uid()
        payload=c.scoped(f,job_id=job,request_id=self.operation,session_id=self.target['session'],reservation_id=reservation,
            recipe_policy_artifact_id=policy['artifact_id'],source_bundles=[dict(repository_key=i['repository'],artifact_id=source['artifact_id'],storage_kind='object')],timeout_ms=60000)
        operation=f.operation('16.2','qualification.preparation.plan',payload)
        operation['idempotency_key']=self.operation
        status,body=f.request(operation,key='operator')
        c.expect(status==200 and body.get('ok') is True,'Preparation plan refused: '+str(body))
        allocation=f.sql('SELECT id FROM hyperfide.resource_job_allocations WHERE reservation_id=$1',[reservation])[0]['id']
        target=c.scoped(f,target_binding_id=allocation,preparation_operation_id=self.operation,reservation_id=reservation)
        for changed in (dict(target,target_binding_id=c.uid()),dict(target,preparation_operation_id=c.uid())):
            refused=f.primary('return claims.readPreparationTarget(tx,data.target);',dict(target=changed))
            c.expect(refused.get('result','missing') is None,'Scheduler exposed a different preparation target')
        try:prepared=f.ok('qualification.preparation.execute',c.scoped(f,operation_id=self.operation),key='independent_verifier',component='16.2')
        except Exception as error:
            port=f.port
            try:
                f.port=self.port
                report=f.invoke('runner.executor.describe',{},key='provisioner',component='12.4-executor')[1]
            finally:f.port=port
            detail=str(error)
            if detail.startswith('Actual signed service refused: '):
                detail=json.dumps(json.loads(detail.removeprefix('Actual signed service refused: ')).get('error',{}))
            raise AssertionError(detail+'; executor='+json.dumps(report.get('result',report))+'; log='+self.log.read_text()) from error
        allowed=('HF_PREPARATION_WORKSPACE_ROOT','HF_PREPARATION_BASE_ROOT','HF_PREPARATION_MANIFEST_ROOT','HF_READINESS_MODULE_PATH','HF_READINESS_MODULE_DIGEST','HF_READINESS_NODE_EXECUTABLE','HF_READINESS_NODE_DIGEST',
            'HF_READINESS_SCAN_POLICY_FILE','HF_READINESS_TOOL_BINDINGS_FILE','HF_CREDENTIAL_AVAILABILITY_FILE','HF_INVOCATION_SCOPE_FILE','HF_READINESS_DIAGNOSTICS_ROOT','HF_READINESS_WORKSPACE_MANIFEST_FILE','HF_RUNNER_WORKSPACE_DIGEST')
        self.readiness_env.write_text(json.dumps({key:prepared['readiness_environment'][key] for key in allowed}));self.readiness_env.chmod(0o600)
        reservation=self.allocate(f,'TEST')
        version=f.sql('SELECT state_version::text AS v FROM hyperfide.qualification_jobs WHERE id=$1',[job])[0]['v']
        assigned=f.ok('qualification.job.assign',c.scoped(f,job_id=job,expected_state_version=version,verifier_id=self.target['session'],sandbox_id=self.target['sandbox'],slot_id=self.target['slot'],
            sandbox_boot_generation='1',reservation_id=reservation,environment_digest=prepared['environment_digest']),key='operator',component='16.2')
        claimed=f.ok('qualification.job.claim',c.scoped(f,job_id=job,expected_state_version=assigned['state_version']),key='independent_verifier',component='16.2')
        result=f.ok('qualification.execute',c.scoped(f,job_id=job,lease_generation=claimed['lease_generation']),key='independent_verifier',component='16.2')
        c.expect(result['receipt']['outcome']=='PASS','Independent registered repair check failed: '+str(result))
        custody=f.repair_submission['submission']
        version=f.sql('SELECT state_version::text AS v FROM hyperfide.submission_custodies WHERE id=$1',[custody['id']])[0]['v']
        accepted=f.ok('qualification.accept',c.scoped(f,submission_id=custody['id'],custody_generation=custody['custody_generation'],expected_state_version=version),key='operator',component='16.3')
        c.expect(accepted['qualified'] is True,'Current independent proof did not qualify the repaired custody')
        c.expect(f.sql('SELECT evidence_id FROM hyperfide.submission_evidence WHERE custody_id=$1',[custody['id']])==[dict(evidence_id=result['evidence_id'])],
            'Acceptance must attach the actual independent evidence to its exact custody')
        replayed=f.ok('qualification.preparation.execute',c.scoped(f,operation_id=self.operation),key='independent_verifier',component='16.2')
        c.expect(replayed['replayed'] is True and replayed['receipt_digest']==prepared['receipt_digest'] and
            f.sql('SELECT count(*)::int AS n FROM hyperfide.assurance_effective_result_inputs WHERE job_id=$1',[job])[0]['n']==1,
            'Prepared-result replay must reuse the immutable measurement without executing again')
        return result

    def reproduce(self,f,repair_id):
        c=self.c
        payload=c.scoped(f,request_id=c.uid(),repair_id=repair_id,template_id='finding-repaired')
        f.reject('review.reproduction.repair.record',payload,'REVIEW_ROLE_DENIED',key='operator',component='17.4')
        f.reject('review.reproduction.repair.record',dict(payload,outcome='FAIL'),'REVIEW_INPUT_INVALID',key='independent_verifier',component='17.4')
        recorded=f.ok('review.reproduction.repair.record',payload,key='independent_verifier',component='17.4')
        again=f.ok('review.reproduction.repair.record',payload,key='independent_verifier',component='17.4')
        c.expect(again['plan_id']==recorded['plan_id'] and again['replayed'] is True,'Observed-pair retry created a second proof')
        proof=f.ok('review.reproduction.inspect',c.scoped(f,plan_id=recorded['plan_id']),key='operator',component='17.4')
        c.expect(proof['status']=='COMPLETE' and proof['original']['outcome']=='FAIL' and proof['repaired']['outcome']=='PASS','Native original/repaired counterfactual is incomplete: '+str(proof))
        c.expect(proof['original']['source_set']==[dict(repository_id=f.ids['repository'],source_object_id=self.submission.baseline)] and
            proof['repaired']['source_set']==[dict(repository_id=f.ids['repository'],source_object_id=self.submission.head)],'Counterfactual proof changed the exact original or repaired revision')
        return recorded['plan_id']

    def close(self):
        if hasattr(self,'packet'):self.packet.prepared_slot=self.original_profile
        if self.child and self.child.poll() is None:
            self.child.terminate()
            try:self.child.wait(timeout=10)
            except subprocess.TimeoutExpired:self.child.kill();self.child.wait(timeout=5)
        if self.operation:
            shutil.rmtree('/run/hyperfide-stage/'+self.operation,ignore_errors=True)
        if hasattr(self,'root'):shutil.rmtree(self.root,ignore_errors=True)
