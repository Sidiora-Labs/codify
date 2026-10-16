#!/usr/bin/env python3
"""Real PostgreSQL/HTTPS/Ed25519 identity fixture and task14.1 component probe.

Import IdentityFixture from this module for downstream registered service tests.
Fixtures create their own database, CA/key material and trusted service principals;
ordinary requests always pass the real production TLS/authentication path.
"""
from __future__ import annotations
import base64, hashlib, http.client, importlib.util, json, os, re, select, shutil, signal, socket, ssl, subprocess, sys, tempfile, time, uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
RESULTS=[]
def sha(data):return "sha256:"+hashlib.sha256(data).hexdigest()
def b64(data):return base64.urlsafe_b64encode(data).decode().rstrip("=")
def uid():return str(uuid.uuid4())
def canonical(value):return json.dumps(value,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode()
def expect(value,message):
    if not value:raise AssertionError(message)
def check(name,callback):
    try:callback();actual="observed"
    except Exception as error:actual=type(error).__name__+": "+str(error)
    RESULTS.append((name,actual))
    print(json.dumps({"type":"assertion","id":name,"expected":"observed","actual":actual}),flush=True)
SQL_JS="""const fs=require('fs'),{createRequire}=require('module'),pg=createRequire(process.cwd()+'/services/hyperfide/package.json')('pg');
(async()=>{const q=JSON.parse(fs.readFileSync(0,'utf8')),c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();try{if(q.serial)await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');try{const r=await c.query(q.sql,q.values);if(q.serial)await c.query('COMMIT');process.stdout.write(JSON.stringify(r.rows??[]));}catch(e){if(q.serial)await c.query('ROLLBACK');throw e;}}finally{await c.end();}})().catch(e=>{process.stderr.write(JSON.stringify({code:e.code??'SQL_ERROR',message:e.message}));process.exitCode=1;});"""
SIGN_JS="""const fs=require('fs'),crypto=require('crypto');process.stdout.write(crypto.sign(null,fs.readFileSync(0),fs.readFileSync(process.argv[1])).toString('base64url'));"""
class IdentityFixture:
    def __init__(self,extra_components=(),extra_env=None,extra_setup=None,components=None,database=None,service_role="control",extra_actions=()):
        if service_role not in ("control","provisioner","dispatch"):raise ValueError("Known service role required")
        if not isinstance(extra_actions,(list,tuple)) or len(extra_actions)>256 or any(not isinstance(a,str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9._-]{0,127}',a) for a in extra_actions):raise ValueError('Finite reviewed fixture extra_actions required')
        self.service_role=service_role
        self.folder=tempfile.TemporaryDirectory(prefix="hyperfide-identity-")
        self.path=Path(self.folder.name);self.child=None;self.database=database or "hf_identity_"+uuid.uuid4().hex;self.database_created=False;self.runtime_role="hf_ir_"+uuid.uuid4().hex;self.runtime_role_created=False
        if not re.fullmatch(r"hf_[a-z0-9_]{1,59}",self.database):self.folder.cleanup();raise ValueError("Owned bounded hf_ database name required")
        self.base_url=os.environ.get("DATABASE_URL")
        if not self.base_url:raise RuntimeError("DATABASE_URL required for actual PostgreSQL fixture")
        from urllib.parse import urlsplit,urlunsplit
        u=urlsplit(self.base_url);self.url=urlunsplit((u.scheme,u.netloc,"/"+self.database,u.query,u.fragment))
        self.env=os.environ.copy();self.env["DATABASE_URL"]=self.url
        self.ids={name:uid() for name in ("organisation","project","spec","run","epoch","pool","sandbox","intent","operator","provisioner","deployment")}
        self.secret=os.urandom(32);self.grant=uid();self.preparation=sha(b"prepared-fixture-v1")
        try:
            self.sql('CREATE DATABASE "'+self.database+'"',admin=True)
            self.database_created=True
            _record_fixture(self)
            # Actual04 migration engine applies the complete trusted source release. This is fixture DDL, never a handler route.
            migrate="""import {createResourceContainer} from './services/hyperfide/dist/storage/runtime.js';import {MigrationCoordinator} from './services/hyperfide/dist/storage/durability.js';const signal=new AbortController().signal,env={...process.env,HYPERFIDE_MIGRATION_DATABASE_URL:process.env.DATABASE_URL};const r=createResourceContainer({role:'control',env,signal});try{await new MigrationCoordinator(r).apply({timeoutMs:30000,signal});}finally{await r.close();}"""
            result=subprocess.run(["node","--input-type=module","-e",migrate],cwd=ROOT,env=self.env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=40)
            expect(result.returncode==0,"Actual trusted fixture migration failed: "+result.stderr[:1200])
            i=self.ids
            self.authority_journal=self.path/'authority-journal';self.authority_journal.mkdir(mode=0o700)
            self.env['HYPERFIDE_DEPLOYMENT_ID']=i['deployment'];self.env['HYPERFIDE_AUTHORITY_JOURNAL_DIR']=str(self.authority_journal)
            activate="""import fs from 'node:fs/promises';import {randomUUID} from 'node:crypto';import {createResourceContainer} from './services/hyperfide/dist/storage/runtime.js';import {AuthorityStore,lookupAuthorityActivation,assertExternalAuthorityCurrent} from './services/hyperfide/dist/storage/durability.js';import {FileExternalAuthorityJournal} from './services/hyperfide/dist/storage/authority_journal.js';import {hash} from './services/hyperfide/dist/transport/protocol.js';const signal=new AbortController().signal,r=createResourceContainer({role:'control',env:process.env,signal}),deployment=process.env.HYPERFIDE_DEPLOYMENT_ID,journal=new FileExternalAuthorityJournal(process.env.HYPERFIDE_AUTHORITY_JOURNAL_DIR,i=>lookupAuthorityActivation(r,i));try{const identity=(await r.observe({preferReplica:false},async s=>{const db=(await s.query('SELECT current_database() AS name,oid::text AS oid,pg_postmaster_start_time()::text AS postmaster,pg_is_in_recovery() AS recovery FROM pg_database WHERE datname=current_database()')).rows[0],system=(await s.query('SELECT system_identifier::text AS system_identifier FROM pg_control_system()')).rows[0],prior=(await s.query('SELECT count(*)::int AS n FROM hyperfide.authority_epochs WHERE deployment_id=$1',[deployment])).rows[0];if(db.name!==process.argv[1]||db.recovery||prior.n!==0)throw Error('Fresh owned database/deployment precondition failed');return {...db,...system};})).value;if((await fs.readdir(process.env.HYPERFIDE_AUTHORITY_JOURNAL_DIR)).length)throw Error('Fresh external journal precondition failed');const fencer={isolate:async input=>{if(input.source_epoch!==null||input.deployment_id!==deployment)throw Error('Fixture cannot fence an existing predecessor');const now=Date.now(),receipt={deployment_id:deployment,operation_id:input.operation_id,source_epoch:null,fence_id:randomUUID(),isolated_writer:'owned-database:'+identity.system_identifier+':'+identity.oid+':'+identity.postmaster,observed_at:new Date(now).toISOString(),expires_at:new Date(now+25000).toISOString(),evidence_digest:hash(JSON.stringify({kind:'COMPONENT_FIXTURE_PRECONDITION',claim:'no deployment predecessor by fixture construction',identity}))};await fs.writeFile(process.env.HYPERFIDE_AUTHORITY_JOURNAL_DIR+'/fixture-writer-observation.json',JSON.stringify(receipt),{mode:0o600});return receipt;}},a=new AuthorityStore(r,deployment,journal),result=await a.activate({operation_id:randomUUID(),expected_previous_epoch:null},fencer);await assertExternalAuthorityCurrent(r,journal,{deployment_id:deployment});process.stdout.write(JSON.stringify(result));}finally{await r.close();}"""
            result=subprocess.run(['node','--input-type=module','-e',activate,self.database],cwd=ROOT,env=self.env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=40)
            expect(result.returncode==0,'Actual fixture external journal activation failed: '+result.stderr[:1200]);i['epoch']=json.loads(result.stdout)['epoch']
            self.sql("INSERT INTO hyperfide.organisations(id,name) VALUES($1,'identity-fixture')",[i["organisation"]])
            self.sql("INSERT INTO hyperfide.projects(organisation_id,id,name) VALUES($1,$2,'identity-fixture')",[i["organisation"],i["project"]])
            self.sql("INSERT INTO hyperfide.spec_revisions(organisation_id,id,project_id,source_digest,source_content,document,schema_version) VALUES($1,$2,$3,$4,'fixture','{}',1)",[i["organisation"],i["spec"],i["project"],sha(b"fixture")])
            self.sql("INSERT INTO hyperfide.runs(organisation_id,id,project_id,spec_revision_id,policy_digest,authority_epoch,state) VALUES($1,$2,$3,$4,$5,$6,'RUNNING')",[i["organisation"],i["run"],i["project"],i["spec"],sha(b"policy"),i["epoch"]])
            self.sql("INSERT INTO hyperfide.provider_pools(organisation_id,id,provider,account_key,environment_key,region) VALUES($1,$2,'fixture','fixture','fixture','fixture')",[i["organisation"],i["pool"]])
            self.sql("INSERT INTO hyperfide.sandboxes(organisation_id,id,pool_id,native_sandbox_id,observed_state,preparation_digest) VALUES($1,$2,$3,'fixture-resource','RUNNING',$4)",[i["organisation"],i["sandbox"],i["pool"],self.preparation])
            self.ids["boot"]=self.sql("SELECT boot_id FROM hyperfide.sandbox_boots WHERE organisation_id=$1 AND sandbox_id=$2",[i["organisation"],i["sandbox"]])[0]["boot_id"]
            self.keys={}
            for name in ("operator","provisioner","runner","other"):
                key=self.path/(name+".pem")
                subprocess.run(["openssl","genpkey","-algorithm","Ed25519","-out",str(key)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                key.chmod(0o600)
                public=subprocess.check_output(["openssl","pkey","-in",str(key),"-pubout","-outform","DER"],stderr=subprocess.DEVNULL)
                self.keys[name]={"path":key,"public_key_b64":b64(public[-32:])}
            self.ca=self.path/"ca.pem";self.tlskey=self.path/"tls.pem"
            subprocess.run(["openssl","req","-x509","-newkey","rsa:2048","-sha256","-nodes","-keyout",str(self.tlskey),"-out",str(self.ca),"-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost,IP:127.0.0.1","-days","1"],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            self.tlskey.chmod(0o600)
            with socket.socket() as sock:sock.bind(("127.0.0.1",0));self.port=sock.getsockname()[1]
            self.origin="https://localhost:"+str(self.port)
            self.components=self.path/"components";self.components.mkdir()
            defaults=("1.4","4.1","4.2","4.4","14.1") if service_role=="control" else ("1.4","4.2","4.4","14.1")
            names=list(components or defaults)+list(extra_components)
            actions=["programme.activate","programme.provision","programme.dispatch"]+list(extra_actions)
            for name in dict.fromkeys(names):
                fragment=ROOT/("services/hyperfide/components/"+name+".json")
                shutil.copyfile(fragment,self.components/(name+".json"))
                actions+=json.loads(fragment.read_text())["actions"]
            self.actions=list(dict.fromkeys(actions))
            expiry=time.strftime("%Y-%m-%dT%H:%M:%S.000Z",time.gmtime(time.time()+3600))
            records=[]
            for name,role in (("operator","OPERATOR"),("provisioner","PROVISIONER")):
                records.append({"credential_id":i[name],"organisation_id":i["organisation"],"run_id":i["run"],"actor_id":i[name],"role":role,"public_key_b64":self.keys[name]["public_key_b64"],"deployment_epoch":i["epoch"],"allowed_actions":self.actions,"expires_at":expiry})
            # Test-only real public-key issuance precondition; production startup config cannot create identities.
            for record in records:self.seed_fixture_principal(record)
            self.identity_config=self.path/"identity.json"
            self.identity_config.write_text(json.dumps({"schema_version":1,"origin":self.origin,"clock_skew_seconds":30,"grant_ttl_seconds":300,"credential_ttl_seconds":3600,"principals":records}))
            policy={"schema_version":1,"programme_id":i["run"],"repository":"fixture/repository","spec_revision":"fixture-identity-v1","policy_revision":1,"status":"ACTIVE","approval":{"decision":"APPROVED","record_id":"fixture-approved","spec_revision":"fixture-identity-v1","policy_revision":1},"allowed_roles":["control","provisioner","dispatch"],"allowed_actions":self.actions}
            self.policy=self.path/"policy.json";self.policy.write_text(json.dumps(policy))
            self.env["HF_IDENTITY_CONFIG_FILE"]=str(self.identity_config)
            if extra_env:self.env.update(extra_env)
            if extra_setup:extra_setup(self)
            # The HTTPS runtime uses an actual least-privilege DB role; migration credentials never enter it.
            password=base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("=")
            self.sql('CREATE ROLE "'+self.runtime_role+'" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD \''+password+'\'',admin=True)
            self.runtime_role_created=True
            _record_fixture(self)
            self.sql('GRANT CONNECT ON DATABASE "'+self.database+'" TO "'+self.runtime_role+'"')
            self.sql('GRANT USAGE ON SCHEMA hyperfide TO "'+self.runtime_role+'"; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA hyperfide TO "'+self.runtime_role+'"; REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON hyperfide.schema_migrations FROM "'+self.runtime_role+'"')
            from urllib.parse import quote
            u=urlsplit(self.url);host=u.netloc.rsplit("@",1)[-1] or "localhost"
            self.runtime_url=urlunsplit((u.scheme,quote(self.runtime_role)+":"+quote(password)+"@"+host,u.path,u.query,u.fragment))
            self.env["DATABASE_URL"]=self.runtime_url
            for role in ("CONTROL","PROVISIONER","DISPATCH"):self.env["HYPERFIDE_"+role+"_PRIMARY_DATABASE_URL"]=self.runtime_url
            self.env["HYPERFIDE_DEPLOYMENT_ID"]=i["deployment"];self.env["HYPERFIDE_REQUIRE_SYNC_REPLICA"]="0"
            self.env.pop("HYPERFIDE_MIGRATION_DATABASE_URL",None);self.env.pop("HYPERFIDE_MIGRATION_JOB",None)
            _record_fixture(self)
            self.start()
        except BaseException:
            self.close();raise
    def sql(self,sql,values=None,admin=False,serial=True):
        env=self.env.copy();env["DATABASE_URL"]=self.base_url if admin else self.url
        result=subprocess.run(["node","--input-type=commonjs","-e",SQL_JS],input=json.dumps({"sql":sql,"values":values or [],"serial":serial and not admin}),text=True,cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
        expect(result.returncode==0,"PostgreSQL fixture query failed: "+result.stderr[:1000])
        return json.loads(result.stdout)
    def start(self):
        argv=["node",str(ROOT/("services/hyperfide/dist/"+self.service_role+".js")),"--policy",str(self.policy),"--spec-revision","fixture-identity-v1","--components",str(self.components),"--module-root",str(ROOT/"services/hyperfide/dist"),"--mode","https","--host","127.0.0.1","--port",str(self.port),"--tls-cert",str(self.ca),"--tls-key",str(self.tlskey)]
        self.child=subprocess.Popen(argv,cwd=ROOT,env=self.env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        deadline=time.monotonic()+15;lines=[]
        while time.monotonic()<deadline:
            ready,_,_=select.select([self.child.stderr],[],[],0.1)
            if ready:
                line=self.child.stderr.readline();lines.append(line)
                if '"event":"ready"' in line:return
            if self.child.poll() is not None:break
        raise AssertionError("Actual HTTPS service did not become ready: "+"".join(lines)[:1500])
    def stop(self):
        if self.child:
            self.child.send_signal(signal.SIGTERM)
            try:out,err=self.child.communicate(timeout=8)
            except subprocess.TimeoutExpired:self.child.kill();out,err=self.child.communicate();raise AssertionError("Service did not stop within deadline")
            expect(self.child.returncode==0,"Service termination failed: "+err[:1000])
            self.child=None
    def close(self):
        _record_fixture(self)
        try:self.stop()
        finally:
            try:
                if self.database_created:self.sql('DROP DATABASE IF EXISTS "'+self.database+'" WITH (FORCE)',admin=True)
                if self.runtime_role_created:self.sql('DROP ROLE "'+self.runtime_role+'"',admin=True)
            finally:self.database_created=False;self.runtime_role_created=False;self.folder.cleanup()
    def seed_fixture_principal(self,record):
        self.sql("INSERT INTO hyperfide.identity_principals(credential_id,organisation_id,run_id,actor_id,role,public_key_b64,deployment_epoch,allowed_actions,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[record[k] for k in ("credential_id","organisation_id","run_id","actor_id","role","public_key_b64","deployment_epoch","allowed_actions","expires_at")])
    def apply_migration(self,name):
        file=ROOT/("services/hyperfide/migrations/"+name+".sql")
        expected=sha(file.read_bytes());version=int(name.split("-",1)[0])
        row=self.sql("SELECT name,checksum FROM hyperfide.schema_migrations WHERE version=$1",[version])
        expect(len(row)==1 and row[0]["name"]==name and row[0]["checksum"]==expected,"Actual complete-release fixture migration is not pinned: "+name)
    def add_principal(self,name,role,actor_id=None):
        if not re.fullmatch(r"[a-z][a-z0-9_-]{0,63}",name) or name in self.keys:raise ValueError("Fresh fixture principal name required")
        agents=("LEADER","FEATURE_MANAGER","COMMIT_WATCHER","ISSUE_WATCHER","VERIFIER","INTEGRATOR","INDEXER")
        if role=="WORKER":raise ValueError("WORKER requires actual runner delegation/current implementation attempt")
        self.stop()
        key=self.path/(name+".pem")
        subprocess.run(["openssl","genpkey","-algorithm","Ed25519","-out",str(key)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);key.chmod(0o600)
        public=subprocess.check_output(["openssl","pkey","-in",str(key),"-pubout","-outform","DER"],stderr=subprocess.DEVNULL)
        self.keys[name]={"path":key,"public_key_b64":b64(public[-32:])};self.ids[name]=uid()
        actor=actor_id or uid()
        if role in agents and actor_id is None:
            self.sql("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id) VALUES($1,$2,$3,$4,'fixture','fixture',$5)",[self.ids["organisation"],self.ids["run"],actor,role,uid()])
        config=json.loads(self.identity_config.read_text())
        config["principals"].append({"credential_id":self.ids[name],"organisation_id":self.ids["organisation"],"run_id":self.ids["run"],"actor_id":actor,"role":role,"public_key_b64":self.keys[name]["public_key_b64"],"deployment_epoch":self.ids["epoch"],"allowed_actions":self.actions,"expires_at":time.strftime("%Y-%m-%dT%H:%M:%S.000Z",time.gmtime(time.time()+3600))})
        self.seed_fixture_principal(config["principals"][-1])
        self.identity_config.write_text(json.dumps(config));self.start()
        return {"credential_id":self.ids[name],"actor_id":actor,"role":role}
    def operation(self,component,action,input,run=None,authority=None,expected_version=None,operation=None):
        payload=canonical({"run_id":run or self.ids["run"],"component":component,"action":action,"input":input,"expected_version":expected_version,"authority":authority})
        return operation or {"protocol_version":1,"operation_id":uid(),"idempotency_key":uid(),"payload_digest":sha(payload),"correlation_id":uid(),"causation_id":None,"payload_b64":b64(payload)}
    def sign(self,key,message):
        return subprocess.check_output(["node","--input-type=commonjs","-e",SIGN_JS,str(self.keys[key]["path"])],input=message,cwd=ROOT).decode()
    def request(self,body,key="operator",endpoint="/v1/invoke",credential=None,nonce=None,seconds=None,headers=None,ca=None):
        raw=body if isinstance(body,bytes) else canonical(body)
        ident=credential or self.ids[key];seconds=seconds or str(int(time.time()));nonce=nonce or uid()
        domain="HYPERFIDE-ENROLL-V1" if endpoint=="/v1/enroll" else "HYPERFIDE-REQUEST-V1"
        message=("\n".join((domain,"POST",endpoint,self.origin,ident,seconds,nonce,sha(raw),""))).encode()
        proof={"Content-Type":"application/json","HF-Request-Time":seconds,"HF-Request-Nonce":nonce,"HF-Request-Signature":self.sign(key,message)}
        if endpoint=="/v1/enroll":proof["Authorization"]="HyperfideGrant "+ident+"."+b64(self.secret)
        else:proof["HF-Credential-Id"]=ident
        if headers:proof.update(headers)
        context=ssl.create_default_context(cafile=str(ca or self.ca))
        conn=http.client.HTTPSConnection("localhost",self.port,context=context,timeout=10)
        try:conn.request("POST",endpoint,raw,proof);response=conn.getresponse();data=response.read();return response.status,json.loads(data)
        finally:conn.close()
    def invoke(self,action,input,component="14.1",key="operator",authority=None,**kwargs):
        authority=authority or getattr(self,"authorities",{}).get(key)
        return self.request(self.operation(component,action,input,authority=authority),key=key,**kwargs)
    def bind(self):
        return self.invoke("identity.binding.observe",{"provisioning_intent_id":self.ids["intent"],"sandbox_id":self.ids["sandbox"],"boot_generation":"1","boot_id":self.ids["boot"],"native_sandbox_id":"fixture-resource","observation_digest":sha(b"provider-observation"),"expected_version":"1"},key="provisioner")
    def issue(self,grant=None,ttl=300,actions=None):
        return self.invoke("identity.grant.issue",{"grant_id":grant or self.grant,"provisioning_intent_id":self.ids["intent"],"verifier":sha(self.secret),"allowed_actions":actions or ["identity.describe","identity.runner.register","identity.runner.heartbeat"],"ttl_seconds":ttl})
    def enrollment(self,key="runner",boot=None):
        payload=canonical({"run_id":self.ids["run"],"provisioning_intent_id":self.ids["intent"],"sandbox_id":self.ids["sandbox"],"boot_generation":"1","boot_id":boot or self.ids["boot"],"public_key_b64":self.keys[key]["public_key_b64"]})
        return {"protocol_version":1,"operation_id":uid(),"idempotency_key":uid(),"payload_digest":sha(payload),"correlation_id":uid(),"causation_id":None,"payload_b64":b64(payload)}

# Runner delegation uses the production enrollment and registered-session APIs.
def _bootstrap_runner(self,actions=None):
    expect(self.bind()[1].get("ok") is True,"trusted fixture binding failed")
    expect(self.issue(actions=actions or self.actions)[1].get("ok") is True,"runner grant issue failed")
    response=self.request(self.enrollment(),key="runner",endpoint="/v1/enroll",credential=self.grant)[1]
    expect(response.get("ok") is True,"actual runner enrollment failed")
    self.ids["runner"]=response["result"]["credential_id"]
    return response["result"]
def _delegate_principal(self,name,session_id,allowed_actions=None):
    if name in self.keys:raise ValueError("Fresh principal name required")
    key=self.path/(name+".pem")
    subprocess.run(["openssl","genpkey","-algorithm","Ed25519","-out",str(key)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);key.chmod(0o600)
    public=subprocess.check_output(["openssl","pkey","-in",str(key),"-pubout","-outform","DER"],stderr=subprocess.DEVNULL)
    self.keys[name]={"path":key,"public_key_b64":b64(public[-32:])}
    response=self.invoke("identity.principal.delegate",{"session_id":session_id,"public_key_b64":self.keys[name]["public_key_b64"],"allowed_actions":allowed_actions or self.actions,"ttl_seconds":600},key="runner")[1]
    expect(response.get("ok") is True,"actual runner delegation failed: "+json.dumps(response))
    self.ids[name]=response["result"]["credential_id"]
    if response["result"]["authority"]["attempt_id"] is not None:
        if not hasattr(self,"authorities"):self.authorities={}
        self.authorities[name]=response["result"]["authority"]
    return response["result"]
IdentityFixture.bootstrap_runner=_bootstrap_runner
IdentityFixture.delegate_principal=_delegate_principal



# Only domain14's registered drivers enable this retained, non-secret resource ledger.
def _evidence_base():
    task=os.environ.get('HYPERFIDE_IDENTITY_EVIDENCE_TASK')
    if task not in ('14.1','14.2','14.3','14.4'):return None
    campaign=os.environ.get('HYPERFIDE_CAMPAIGN_DIR')
    if not campaign:return None
    base=Path(campaign)/'identity14';base.mkdir(parents=True,exist_ok=True)
    return base

def _record_fixture(fixture):
    base=_evidence_base()
    if base is None:return
    file=base/'resources.json'
    rows=json.loads(file.read_text()) if file.exists() else []
    row=next((x for x in rows if x['database']==fixture.database),None)
    if row is None:
        row={'database':fixture.database,'runtime_role':fixture.runtime_role,'path':str(fixture.path),'database_owned':False,'runtime_role_owned':False,'ports':[]};rows.append(row)
    row['database_owned']=row['database_owned'] or fixture.database_created
    row['runtime_role_owned']=row['runtime_role_owned'] or fixture.runtime_role_created
    row['ports']=sorted(set(row['ports']+[p for p in [getattr(fixture,'port',None),*getattr(fixture,'evidence_extra_ports',[])] if p is not None]))
    temporary=base/'resources.tmp';temporary.write_text(json.dumps(rows,sort_keys=True)+'\n');temporary.replace(file)

def write_identity_observations():
    base=_evidence_base()
    if base is not None:
        (base/'observations.json').write_text(json.dumps({'scope':'task-component','assertions':[{'id':name,'actual':actual} for name,actual in RESULTS],'vendor_qualification':'UNRUN','physical_fencing_qualification':'UNRUN'},sort_keys=True)+'\n')

def cleanup_identity_evidence(task):
    os.environ['HYPERFIDE_IDENTITY_EVIDENCE_TASK']=task;base=_evidence_base()
    if base is None:raise RuntimeError('An explicit campaign directory is required for independent cleanup')
    file=base/'resources.json'
    if not file.exists():raise RuntimeError('Actual owned-resource inventory is missing')
    rows=json.loads(file.read_text());observed=[]
    def admin(sql,values=()):
        result=subprocess.run(['node','--input-type=commonjs','-e',SQL_JS],cwd=ROOT,env=os.environ.copy(),input=json.dumps({'sql':sql,'values':list(values),'serial':False}),text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
        expect(result.returncode==0,'Independent fixture cleanup query failed: '+result.stderr[:500]);return json.loads(result.stdout)
    for row in rows:
        database=row['database'];role=row['runtime_role'];directory=Path(row['path'])
        if not re.fullmatch(r'hf_identity_[0-9a-f]{32}',database) or not re.fullmatch(r'hf_ir_[0-9a-f]{32}',role) or directory.parent!=Path(tempfile.gettempdir()) or not directory.name.startswith('hyperfide-identity-'):
            raise RuntimeError('Resource inventory is not an owned domain14 fixture')
        if row['database_owned']:admin('DROP DATABASE IF EXISTS "'+database+'" WITH (FORCE)')
        if row['runtime_role_owned']:admin('DROP ROLE IF EXISTS "'+role+'"')
        # The native runner cannot outlive the supervised probe; the harness independently rejects surviving descendants.
        if directory.exists():shutil.rmtree(directory)
        state=admin('SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1) AS database_present,EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$2) AS role_present',[database,role])[0]
        ports=[]
        for port in row['ports']:
            if not isinstance(port,int) or isinstance(port,bool) or not 1<=port<=65535:raise RuntimeError('Invalid fixture listener identity')
            with socket.socket() as probe:
                probe.settimeout(.2);absent=probe.connect_ex(('127.0.0.1',port))!=0
            ports.append({'port':port,'absent':absent})
        observed.append({'database':database,'runtime_role':role,'database_absent':not state['database_present'],'runtime_role_absent':not state['role_present'],'private_path_absent':not directory.exists(),'listeners':ports})
    complete=bool(observed) and all(r['database_absent'] and r['runtime_role_absent'] and r['private_path_absent'] and all(p['absent'] for p in r['listeners']) for r in observed)
    artifact='identity14/resource-absence.json';(base/'resource-absence.json').write_text(json.dumps({'complete':complete,'observations':observed},sort_keys=True)+'\n')
    print(json.dumps({'type':'cleanup','complete':complete,'resources':[{'id':'hf-task-'+task+'-fixtures','status':'deleted' if complete else 'unknown','observed_absent':complete,'evidence_artifact':artifact}]}),flush=True)
    return 0 if complete else 1
