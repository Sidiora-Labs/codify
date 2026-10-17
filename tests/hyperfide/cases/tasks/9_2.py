#!/usr/bin/env python3
"""Task9.2 explicit runtime profiles; provider fixtures do not qualify live hosts."""
import importlib,json,subprocess,sys,tempfile
from pathlib import Path
c=importlib.import_module("9_1")
IDS=[
 "railway.profile.valid","railway.profile.no-secret-response","railway.profile.digest-tamper",
 "railway.profile.cross-environment","railway.profile.cross-region","railway.profile.memory-canonical",
 "railway.profile.memory-overflow","railway.profile.cpu-fraction","railway.profile.persistent-volume-unsupported",
 "railway.profile.domain-requires-private","railway.profile.domain-duplicates","railway.profile.raw-secret-refused",
 "railway.profile.admin-token-refused","railway.profile.explicit-fields","railway.profile.observe-matching",
 "railway.profile.observe-drift","railway.profile.resources-unproven","railway.profile.variables-unproven",
 "railway.profile.sdk-explicit-apply","railway.profile.restore-region-omitted","railway.profile.checkpoint-wire-key",
 "railway.profile.build-runtime-separated","railway.profile.secret-inventory"
]
def main():
 if sys.argv[1:]==["--inventory"]:print(json.dumps(IDS));return 0
 complete=False
 with tempfile.TemporaryDirectory(prefix="hyperfide-railway92-") as folder:
  fixture=c.Fixture(folder);service=c.Service(folder,fixture)
  try:
   invoke=lambda p:c.result(service.call("9.2","railway.profile.validate",{"profile":p}))
   c.check(IDS[0],lambda:c.expect(invoke(c.profile())["valid"] is True,"valid profile"))
   c.check(IDS[1],lambda:c.expect("secret-ref:git-1" not in json.dumps(invoke(c.profile())),"secret response content"))
   c.check(IDS[2],lambda:c.reject(service.call("9.2","railway.profile.validate",
      {"profile":c.alter(c.profile(),["idle_timeout_minutes"],15)})))
   mutations=[
    (IDS[3],["source","environment_id"],"other-env"),(IDS[4],["source","region"],"other-region"),
    (IDS[5],["resources","memory_bytes"],"01"),(IDS[6],["resources","memory_bytes"],"9223372036854775808"),
    (IDS[7],["resources","cpu_millis"],1.5),(IDS[8],["resources","persistent_volume_bytes"],"1000"),
    (IDS[9],["domains"],[{"port":80,"prefix":"preview"}]),
    (IDS[10],["domains"],[{"port":80,"prefix":"preview"},{"port":80,"prefix":"another"}]),
    (IDS[11],["runtime_variables","GIT_TOKEN"],{"kind":"PUBLIC","value":"fixture-canary-secret"}),
    (IDS[12],["runtime_variables","RAILWAY_API_TOKEN"],{"kind":"SECRET_REFERENCE","value":"secret-ref:admin"})]
   for identity,path,value in mutations:
    payload=c.resign_profile(c.alter(c.profile(),path,value))
    c.check(identity,lambda payload=payload:c.reject(service.call("9.2","railway.profile.validate",{"profile":payload})))
   missing=c.profile();del missing["idle_timeout_minutes"]
   c.check(IDS[13],lambda:c.reject(service.call("9.2","railway.profile.validate",{"profile":missing})))
   observe=lambda row:c.result(service.call("9.2","railway.profile.observe",{"profile":c.profile(),"observed":row}))
   c.check(IDS[14],lambda:c.expect(observe(c.observed())["provider_configuration_matches"] is True,"matching provider config"))
   c.check(IDS[15],lambda:c.expect(observe(c.observed()|{"idleTimeoutMinutes":60})["provider_configuration_matches"] is False,"configuration drift"))
   c.check(IDS[16],lambda:c.expect(observe(c.observed())["resources_verified"] is False and
      observe(c.observed())["runner_attestation_required"] is True,"SDK lacks resource readback"))
   c.check(IDS[17],lambda:c.expect(observe(c.observed())["variables_verified"] is False,"SDK lacks env readback"))
   config=Path(folder)/"input.json";config.write_text(json.dumps({"profile":c.profile(),"config":fixture.config}))
   js=r"""
import fs from 'node:fs';
import {RailwayClient} from './services/hyperfide/dist/providers/railway/preparation.js';
import {validateRuntimeProfile,runtimeOptions,runtimeGraphQLInput} from './services/hyperfide/dist/providers/railway/profile.js';
const data=JSON.parse(fs.readFileSync(process.argv[1]));
const profile=validateRuntimeProfile(data.profile),client=new RailwayClient(data.config,{HF_RAILWAY_FIXTURE_TOKEN:'fake'});
const refs=[];
const options=await runtimeOptions(profile,client,async values=>{refs.push(values);return {GIT_TOKEN:'fixture-worker-secret'};},new AbortController().signal);
const wire=runtimeGraphQLInput(profile,options);
let inventoryRejected=false;
try{await runtimeOptions(profile,client,async()=>({GIT_TOKEN:'fixture',EXTRA:'unrequested'}),new AbortController().signal);}
catch{inventoryRejected=true;}
process.stdout.write(JSON.stringify({
 explicit:options.resources.cpu===1.5&&options.resources.memoryGB===4.294967296&&options.idleTimeoutMinutes===0&&
 options.networkIsolation==='ISOLATED'&&Array.isArray(options.domains)&&options.domains.length===0&&options.env.CI==='true',
 restoreRegionOmitted:!Object.hasOwn(options,'region')&&!Object.hasOwn(wire,'region'),
 checkpointWire:wire.template?.name==='checkpoint-key-1'&&!Object.hasOwn(wire,'checkpointName'),
 separate:!Object.hasOwn(options.env,'BUILD_MODE')&&options.env.GIT_TOKEN==='fixture-worker-secret'&&refs[0].GIT_TOKEN==='secret-ref:git-1',
 inventoryRejected
}));
"""
   raw=subprocess.run(["node","--input-type=module","-e",js,str(config)],cwd=c.ROOT,capture_output=True,text=True,timeout=30)
   c.expect(raw.returncode==0,raw.stderr);values=json.loads(raw.stdout)
   for identity,key in [(IDS[18],"explicit"),(IDS[19],"restoreRegionOmitted"),(IDS[20],"checkpointWire"),
                        (IDS[21],"separate"),(IDS[22],"inventoryRejected")]:
    c.check(identity,lambda key=key:c.expect(values[key] is True,key))
   service.close();fixture.close();complete=True
  finally:
   if service.process.poll() is None:service.process.kill();service.process.wait()
   if not complete:fixture.close()
   print(json.dumps({"type":"cleanup","resources":[],"complete":complete}),flush=True)
 return 1 if c.FAILED or not complete else 0
if __name__=="__main__":sys.exit(main())
