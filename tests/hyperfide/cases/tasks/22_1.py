#!/usr/bin/env python3
"""Evaluation provenance/holdout component probes; all evidence is synthetic."""
import copy, hashlib, json, os, select, shutil, subprocess, sys, tempfile
from pathlib import Path
from datetime import datetime, timezone, timedelta

ROOT=Path(__file__).resolve().parents[4]
FAILED=[]
IDS=[]
def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode()
def digest(value):
    return "sha256:"+hashlib.sha256(canonical(value)).hexdigest()
def utc(value):
    return value.isoformat(timespec="milliseconds").replace("+00:00","Z")
def require(value,message):
    if not value: raise AssertionError(message)
def check(identity,callback):
    IDS.append(identity)
    try:
        callback()
        actual="observed"
    except Exception as error:
        FAILED.append(identity)
        actual=type(error).__name__+": "+str(error)
    print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)

ACTIONS={
 "22.1":["evaluation.dataset.build","evaluation.dataset.inspect","evaluation.dataset.packet"],
 "22.2":["evaluation.calibrate","evaluation.scorecard"],
 "22.3":["evaluation.trial.create","evaluation.trial.report"],
 "22.4":["evaluation.promotion.assess","evaluation.drift.check","evaluation.selfhost.optional"],
}
NODE_KEYGEN="""
const fs=require('fs'),crypto=require('crypto'),out=process.argv[1],keys={};
for(const name of ['packet','label','prediction','approval','qualification']){
 const pair=crypto.generateKeyPairSync('ed25519');
 fs.writeFileSync(out+'/'+name+'.pem',pair.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
 keys[name]={public_key:pair.publicKey.export({type:'spki',format:'pem'}),evidence_class:'synthetic',
 kinds:{packet:['decision_packet','independent_label'],label:['independent_label'],
 prediction:['prediction_observation','trial_observation'],approval:['trial_approval','promotion_policy'],
 qualification:['route_qualification','invariant_qualification','selfhost_qualification']}[name]};
}
keys.packet_alias={...keys.packet};
fs.copyFileSync(out+'/packet.pem',out+'/packet_alias.pem');fs.chmodSync(out+'/packet_alias.pem',0o600);
process.stdout.write(JSON.stringify(keys));
"""
NODE_SIGN="""
const fs=require('fs'),crypto=require('crypto');
const envelope=JSON.parse(fs.readFileSync(0,'utf8'));
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 if(v!==null&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
 return JSON.stringify(v);}
const signature=crypto.sign(null,Buffer.from(canonical(envelope.body)),fs.readFileSync(process.argv[1]));
process.stdout.write(JSON.stringify({...envelope,signature:signature.toString('base64')}));
"""
class Fixture:
    def __init__(self,base):
        self.base=Path(base);self.store=self.base/"store";self.store.mkdir(mode=0o700)
        self.node=subprocess.check_output(["node","-p","process.execPath"],text=True).strip()
        keys=json.loads(subprocess.check_output([self.node,"-e",NODE_KEYGEN,str(self.base)],text=True))
        self.components=self.base/"components";self.components.mkdir()
        for task in ACTIONS:
            shutil.copyfile(ROOT/f"services/hyperfide/components/{task}.json",self.components/f"{task}.json")
        actions=[value for values in ACTIONS.values()for value in values]
        policy={"schema_version":1,"programme_id":"evaluation-fixture","repository":"fixture/repo",
          "spec_revision":"evaluation-fixture-v1","policy_revision":1,"status":"ACTIVE",
          "approval":{"decision":"APPROVED","record_id":"synthetic-component-only","spec_revision":"evaluation-fixture-v1","policy_revision":1},
          "allowed_roles":["control"],"allowed_actions":["programme.activate"]+actions}
        self.policy=self.base/"policy.json";self.policy.write_text(json.dumps(policy))
        env=dict(os.environ,HYPERFIDE_EVAL_STORE=str(self.store),HYPERFIDE_EVAL_TRUSTED_KEYS=json.dumps(keys))
        self.stderr=(self.base/"service.stderr").open("w+")
        self.service=subprocess.Popen([self.node,str(ROOT/"services/hyperfide/dist/control.js"),"--policy",str(self.policy),
          "--spec-revision","evaluation-fixture-v1","--components",str(self.components),
          "--module-root",str(ROOT/"services/hyperfide/dist")],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=self.stderr,text=True,env=env)
        self.sequence=0;self.now=datetime.now(timezone.utc)
        self.cases=[self.make_case(i)for i in range(15)]
    def close(self):
        if self.service.stdin:self.service.stdin.close()
        try:self.service.wait(timeout=5)
        except subprocess.TimeoutExpired:self.service.kill();self.service.wait(timeout=5)
        self.stderr.close()
    def sign(self,kind,payload,key="packet",observed=None):
        body={"schema_version":1,"kind":kind,"evidence_class":"synthetic","observed_at":observed or utc(self.now),
          "subject_digest":digest(payload),"payload":payload}
        return self.resign({"body":body,"key_id":key},key)
    def resign(self,envelope,key=None):
        key=key or envelope["key_id"]
        return json.loads(subprocess.check_output([self.node,"-e",NODE_SIGN,str(self.base/(key+".pem"))],input=json.dumps(envelope),text=True))
    def make_case(self,i,target="yes"):
        decision=self.now-timedelta(hours=1)+timedelta(seconds=i*10)
        content="historical source "+str(i)
        packet={"case_id":f"case-{i:03}","incident_id":f"incident-{i:03}","feature_id":f"feature-{i:03}",
          "repository_id":f"repository-{i:03}","purpose":"defect_detection","decision_at":utc(decision),"watermark":str(i+10),
          "choices":["no","yes"],"language":"typescript","task_family":"api_correctness","context_tokens":100+i,
          "sources":[{"source_id":f"source-{i:03}","available_at":utc(decision-timedelta(seconds=2)),
            "event_sequence":str(i),"content_digest":digest(content),"content":content,"kind":"source"}]}
        label={"case_id":packet["case_id"],"packet_digest":digest(packet),"target":target,"label_kind":"synthetic",
          "reviewer_ids":["fixture-oracle"],"evidence_refs":["future-fix-label-only-sentinel"],"verification_digest":None,
          "adjudicated_at":utc(decision+timedelta(seconds=1))}
        return {"packet":self.sign("decision_packet",packet,observed=utc(decision-timedelta(seconds=1))),
          "label":self.sign("independent_label",label,"label",utc(decision+timedelta(seconds=2)))}
    def changed_case(self,pair,callback):
        pair=copy.deepcopy(pair);callback(pair["packet"]["body"]["payload"])
        pair["packet"]["body"]["subject_digest"]=digest(pair["packet"]["body"]["payload"])
        pair["packet"]=self.resign(pair["packet"])
        pair["label"]["body"]["payload"]["packet_digest"]=digest(pair["packet"]["body"]["payload"])
        pair["label"]["body"]["subject_digest"]=digest(pair["label"]["body"]["payload"])
        pair["label"]=self.resign(pair["label"]);return pair
    def ask(self,action,value,ok=True):
        self.sequence+=1
        component=next(k for k,v in ACTIONS.items()if action in v)
        self.service.stdin.write(json.dumps({"id":str(self.sequence),"component":component,"action":action,"input":value})+"\n")
        self.service.stdin.flush()
        ready,_,_=select.select([self.service.stdout],[],[],15)
        require(ready,"service response timed out")
        line=self.service.stdout.readline()
        require(line,"service exited before response")
        response=json.loads(line)
        require(response.get("ok")is ok,"unexpected service result: "+str(response))
        return response.get("result")if ok else response["error"]
    def dataset(self,cases=None,name="fixture-dataset",ok=True):
        return self.ask("evaluation.dataset.build",{"name":name,"split_seed":"frozen-split-v1","cases":cases or self.cases},ok)
    def profile(self,identity,model=None):
        return {"id":identity,"model":model or identity,"route":"fixture/native","purpose":"defect_detection","rubric":digest("fixture-rubric")}
    def predictions(self,cases,profiles,wrong_baseline=False,abstain_last=False):
        result=[]
        for i,pair in enumerate(cases):
            packet=pair["packet"]["body"]["payload"]
            for p in profiles:
                abstain=abstain_last and i==len(cases)-1 and p["id"]=="ultra"
                wrong=wrong_baseline and p["id"]=="baseline"
                payload={"case_id":packet["case_id"],"packet_digest":digest(packet),"profile":p,
                  "probabilities":{"no":0.8 if wrong else 0.2,"yes":0.2 if wrong else 0.8},
                  "decision":None if abstain else "no"if wrong else"yes","status":"abstained"if abstain else"ok",
                  "latency_ms":10+i,"attempts":2,"input_tokens":1000,"cost_microusd":20,"usage_class":"actual"}
                result.append(self.sign("prediction_observation",payload,"prediction"))
        return result

def main():
    with tempfile.TemporaryDirectory(prefix="hyperfide-eval-dataset-")as directory:
        f=Fixture(directory)
        try:
            result=f.dataset()
            check("evaluation.dataset.actual-roundtrip",lambda:require(result["counts"]=={"train":9,"calibration":3,"holdout":3},"wrong split counts"))
            check("evaluation.dataset.synthetic-explicit",lambda:require(result["evidence_class"]=="synthetic"and result["live_performance_claim"]is False,"synthetic data misclassified"))
            check("evaluation.dataset.permutation-stability",lambda:require(f.dataset(list(reversed(f.cases)))["artifact_id"]==result["artifact_id"],"unstable dataset identity"))
            check("evaluation.dataset.sealed-holdout",lambda:require(f.ask("evaluation.dataset.packet",{"dataset_id":result["artifact_id"],"case_id":"case-014"},False)["code"]=="HOLDOUT_SEALED","holdout exposed"))
            def inspect_packet():
                packet=f.ask("evaluation.dataset.packet",{"dataset_id":result["artifact_id"],"case_id":"case-000"})
                require("target"not in json.dumps(packet)and"future-fix-label-only-sentinel"not in json.dumps(packet),"label leaked into packet")
            check("evaluation.dataset.labels-excluded",inspect_packet)
            changes=[
              ("future-source",lambda p:p["sources"][0].update(available_at=utc(f.now))),
              ("future-watermark",lambda p:p["sources"][0].update(event_sequence="9999")),
              ("wrong-source-digest",lambda p:p["sources"][0].update(content_digest=digest("wrong"))),
              ("label-source-kind",lambda p:p["sources"][0].update(kind="label")),
              ("unknown-packet-field",lambda p:p.update(future_fix="not historical")),
            ]
            for name,callback in changes:
                def reject(callback=callback):
                    cases=copy.deepcopy(f.cases);cases[0]=f.changed_case(cases[0],callback);f.dataset(cases,ok=False)
                check("evaluation.dataset.reject-"+name,reject)
            def late_receipt():
                cases=copy.deepcopy(f.cases);case=cases[0]
                case["packet"]["body"]["observed_at"]=utc(f.now)
                case["packet"]=f.resign(case["packet"]);f.dataset(cases,ok=False)
            check("evaluation.dataset.reject-late-recording",late_receipt)
            def source_after_receipt():
                cases=copy.deepcopy(f.cases)
                def later(p):
                    p["sources"][0]["available_at"]=p["decision_at"]
                cases[0]=f.changed_case(cases[0],later);f.dataset(cases,ok=False)
            check("evaluation.dataset.reject-source-after-recording",source_after_receipt)
            def signer_alias():
                cases=copy.deepcopy(f.cases)
                label=cases[0]["label"];label["key_id"]="packet_alias"
                cases[0]["label"]=f.resign(label,"packet_alias");f.dataset(cases,ok=False)
            check("evaluation.dataset.reject-signer-alias-independence",signer_alias)
            def normalized_duplicate():
                cases=[f.changed_case(pair,lambda p:p["sources"][0].update(content="Repeated  source\\ntext",content_digest=digest("Repeated  source\\ntext")))for pair in f.cases]
                f.dataset(cases,ok=False)
            check("evaluation.dataset.reject-normalized-duplicate-leakage",normalized_duplicate)
            def forged_live():
                cases=copy.deepcopy(f.cases);cases[0]["label"]["body"]["evidence_class"]="live"
                cases[0]["label"]=f.resign(cases[0]["label"]);f.dataset(cases,ok=False)
            check("evaluation.dataset.reject-forged-live",forged_live)
            def invented_human():
                cases=copy.deepcopy(f.cases);label=cases[0]["label"]
                label["body"]["payload"].update(label_kind="human_adjudicated",reviewer_ids=["invented-one","invented-two"])
                label["body"]["subject_digest"]=digest(label["body"]["payload"])
                cases[0]["label"]=f.resign(label);f.dataset(cases,ok=False)
            check("evaluation.dataset.reject-invented-human-label",invented_human)
            def wrong_label_binding():
                cases=copy.deepcopy(f.cases);label=cases[0]["label"]
                label["body"]["payload"]["packet_digest"]=digest("wrong")
                label["body"]["subject_digest"]=digest(label["body"]["payload"])
                cases[0]["label"]=f.resign(label);f.dataset(cases,ok=False)
            check("evaluation.dataset.reject-label-rebinding",wrong_label_binding)
            def shared_group():
                cases=[f.changed_case(pair,lambda p:p.update(repository_id="shared-repository"))for pair in f.cases]
                f.dataset(cases,ok=False)
            check("evaluation.dataset.reject-insufficient-independent-groups",shared_group)
            def overlapping_group():
                cases=copy.deepcopy(f.cases);cases[-1]=f.changed_case(cases[-1],lambda p:p.update(feature_id="feature-000"))
                f.dataset(cases,ok=False)
            check("evaluation.dataset.reject-cross-time-group-overlap",overlapping_group)
            def duplicate():
                cases=copy.deepcopy(f.cases);cases[-1]=cases[0];f.dataset(cases,ok=False)
            check("evaluation.dataset.reject-duplicate-case",duplicate)
            def uncertain():
                cases=copy.deepcopy(f.cases);cases[10]=f.make_case(10,None)
                value=f.dataset(cases,name="uncertain-dataset")
                require(value["evidence_class"]=="synthetic","uncertainty silently became truth")
            check("evaluation.dataset.uncertain-label-preserved",uncertain)
            def tamper():
                artifact=f.store/(result["artifact_id"][7:]+".json")
                artifact.write_text(artifact.read_text()+" ")
                f.ask("evaluation.dataset.inspect",{"dataset_id":result["artifact_id"]},False)
            check("evaluation.dataset.reject-artifact-tamper",tamper)
        finally:f.close()
    print(json.dumps({"type":"cleanup","resources":[],"complete":True}),flush=True)
    return 1 if FAILED else 0
if __name__=="__main__":sys.exit(main())
