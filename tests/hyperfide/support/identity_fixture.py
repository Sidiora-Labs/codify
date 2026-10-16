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
(async()=>{const q=JSON.parse(fs.readFileSync(0,'utf8')),c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();try{const r=await c.query(q.sql,q.values);process.stdout.write(JSON.stringify(r.rows??[]));}finally{await c.end();}})().catch(e=>{process.stderr.write(JSON.stringify({code:e.code??'SQL_ERROR',message:e.message}));process.exitCode=1;});"""
SIGN_JS="""const fs=require('fs'),crypto=require('crypto');process.stdout.write(crypto.sign(null,fs.readFileSync(0),fs.readFileSync(process.argv[1])).toString('base64url'));"""
class IdentityFixture:
    def __init__(self,extra_components=(),extra_env=None,extra_setup=None,components=None,database=None):
        self.folder=tempfile.TemporaryDirectory(prefix="hyperfide-identity-")
        self.path=Path(self.folder.name);self.child=None;self.database=database or "hf_identity_"+uuid.uuid4().hex;self.database_created=False
        if not re.fullmatch(r"hf_[a-z0-9_]{1,59}",self.database):self.folder.cleanup();raise ValueError("Owned bounded hf_ database name required")
        self.base_url=os.environ.get("DATABASE_URL")
        if not self.base_url:raise RuntimeError("DATABASE_URL required for actual PostgreSQL fixture")
        from urllib.parse import urlsplit,urlunsplit
        u=urlsplit(self.base_url);self.url=urlunsplit((u.scheme,u.netloc,"/"+self.database,u.query,u.fragment))
        self.env=os.environ.copy();self.env["DATABASE_URL"]=self.url
        self.ids={name:uid() for name in ("organisation","project","spec","run","epoch","pool","sandbox","intent","operator","provisioner")}
        self.secret=os.urandom(32);self.grant=uid();self.preparation=sha(b"prepared-fixture-v1")
        try:
            self.sql('CREATE DATABASE "'+self.database+'"',admin=True)
            self.database_created=True
            core=(ROOT/"services/hyperfide/migrations/0001-authority.sql").read_bytes()
            identity=(ROOT/"services/hyperfide/migrations/0014-enrollment.sql").read_bytes()
            self.sql("BEGIN;\n"+core.decode()+"\nINSERT INTO hyperfide.schema_migrations(version,name,checksum) VALUES(1,'0001-authority','"+sha(core)+"');\n"+identity.decode()+"\nINSERT INTO hyperfide.schema_migrations(version,name,checksum) VALUES(14,'0014-enrollment','"+sha(identity)+"');\nCOMMIT;")
            i=self.ids
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
            names=list(components or ("1.4","4.1","4.2","14.1"))+list(extra_components)
            actions=["programme.activate","programme.provision","programme.dispatch"]
            for name in dict.fromkeys(names):
                fragment=ROOT/("services/hyperfide/components/"+name+".json")
                shutil.copyfile(fragment,self.components/(name+".json"))
                actions+=json.loads(fragment.read_text())["actions"]
            self.actions=list(dict.fromkeys(actions))
            expiry=time.strftime("%Y-%m-%dT%H:%M:%S.000Z",time.gmtime(time.time()+3600))
            records=[]
            for name,role in (("operator","OPERATOR"),("provisioner","PROVISIONER")):
                records.append({"credential_id":i[name],"organisation_id":i["organisation"],"run_id":i["run"],"actor_id":i[name],"role":role,"public_key_b64":self.keys[name]["public_key_b64"],"deployment_epoch":i["epoch"],"allowed_actions":self.actions,"expires_at":expiry})
            self.identity_config=self.path/"identity.json"
            self.identity_config.write_text(json.dumps({"schema_version":1,"origin":self.origin,"clock_skew_seconds":30,"grant_ttl_seconds":300,"credential_ttl_seconds":3600,"principals":records}))
            policy={"schema_version":1,"programme_id":i["run"],"repository":"fixture/repository","spec_revision":"fixture-identity-v1","policy_revision":1,"status":"ACTIVE","approval":{"decision":"APPROVED","record_id":"fixture-approved","spec_revision":"fixture-identity-v1","policy_revision":1},"allowed_roles":["control","provisioner","dispatch"],"allowed_actions":self.actions}
            self.policy=self.path/"policy.json";self.policy.write_text(json.dumps(policy))
            self.env["HF_IDENTITY_CONFIG_FILE"]=str(self.identity_config)
            if extra_env:self.env.update(extra_env)
            if extra_setup:extra_setup(self)
            self.start()
        except BaseException:
            self.close();raise
    def sql(self,sql,values=None,admin=False):
        env=self.env.copy();env["DATABASE_URL"]=self.base_url if admin else self.url
        result=subprocess.run(["node","--input-type=commonjs","-e",SQL_JS],input=json.dumps({"sql":sql,"values":values or []}),text=True,cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
        expect(result.returncode==0,"PostgreSQL fixture query failed: "+result.stderr[:1000])
        return json.loads(result.stdout)
    def start(self):
        argv=["node",str(ROOT/"services/hyperfide/dist/control.js"),"--policy",str(self.policy),"--spec-revision","fixture-identity-v1","--components",str(self.components),"--module-root",str(ROOT/"services/hyperfide/dist"),"--mode","https","--host","127.0.0.1","--port",str(self.port),"--tls-cert",str(self.ca),"--tls-key",str(self.tlskey)]
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
        try:self.stop()
        finally:
            try:
                if self.database_created:self.sql('DROP DATABASE IF EXISTS "'+self.database+'" WITH (FORCE)',admin=True)
            finally:self.database_created=False;self.folder.cleanup()
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
    def invoke(self,action,input,component="14.1",key="operator",**kwargs):
        return self.request(self.operation(component,action,input),key=key,**kwargs)
    def bind(self):
        return self.invoke("identity.binding.observe",{"provisioning_intent_id":self.ids["intent"],"sandbox_id":self.ids["sandbox"],"boot_generation":"1","boot_id":self.ids["boot"],"native_sandbox_id":"fixture-resource","observation_digest":sha(b"provider-observation"),"expected_version":"1"},key="provisioner")
    def issue(self,grant=None,ttl=300):
        return self.invoke("identity.grant.issue",{"grant_id":grant or self.grant,"provisioning_intent_id":self.ids["intent"],"verifier":sha(self.secret),"allowed_actions":["identity.describe","identity.runner.register","identity.runner.heartbeat"],"ttl_seconds":ttl})
    def enrollment(self,key="runner",boot=None):
        payload=canonical({"run_id":self.ids["run"],"provisioning_intent_id":self.ids["intent"],"sandbox_id":self.ids["sandbox"],"boot_generation":"1","boot_id":boot or self.ids["boot"],"public_key_b64":self.keys[key]["public_key_b64"]})
        return {"protocol_version":1,"operation_id":uid(),"idempotency_key":uid(),"payload_digest":sha(payload),"correlation_id":uid(),"causation_id":None,"payload_b64":b64(payload)}
