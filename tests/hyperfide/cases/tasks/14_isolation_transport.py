#!/usr/bin/env python3
"""Isolation transport boundary checks with actual14 Ed25519 permits and real TLS.
The callback is explicitly a transport reference fixture. It proves neither
actual24 durable replay custody nor08 provider/host isolation; those need their
own integrated production-handler qualification.
"""
import json,os,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
PROGRAM=r"""
import fs from 'node:fs/promises';
import https from 'node:https';
import net from 'node:net';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [root,base]=process.argv.slice(2);
const transport=await import(pathToFileURL(root+'/services/hyperfide/dist/transport/isolation.js'));
const identity=await import(pathToFileURL(root+'/services/hyperfide/dist/identity/credentials.js'));
const {startIsolationHttpTransport,createIsolationHttpClient}=transport;
const {issueIsolationPermit,loadIsolationPermitVerifier,assertIsolationPermit}=identity;
for(const key of Object.keys(process.env))if(key==='DATABASE_URL'||key.startsWith('PG')||key==='HF_IDENTITY_CONFIG_FILE')delete process.env[key];
const failures=[],ids=[],observations=[],listeners=[];
async function check(id,fn){ids.push(id);try{await fn();console.log(JSON.stringify({type:'assertion',id,expected:'observed',actual:'observed'}));}catch(error){failures.push(id);console.log(JSON.stringify({type:'assertion',id,expected:'observed',actual:'failed:'+String(error?.code??error?.name??'unknown')}));}}
function expect(value){if(!value)throw new Error('Observed contract differs');}
const uid=n=>'14020000-0000-4000-8000-'+String(n).padStart(12,'0');
const deployment=uid(1),operation=uid(2),org=uid(3),run=uid(4),epoch=uid(5),topology='sha256:'+'a'.repeat(64),resourceTopology='sha256:'+'b'.repeat(64);
const pair=generateKeyPairSync('ed25519'),privateFile=base+'/issuer.pem';
await fs.writeFile(privateFile,pair.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
const config=base+'/verifier.json';await fs.writeFile(config,JSON.stringify({schema_version:1,issuers:[{key_id:'fixture-operator',public_key_b64:pair.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64url')}]}),{mode:0o600});
const verifier=await loadIsolationPermitVerifier(config);
function claims(patch={}){return {schema_version:1,purpose:'EXTERNAL_WRITER_ISOLATION_ONLY',deployment_id:deployment,operation_id:operation,organisation_id:org,run_id:run,source_epoch:epoch,topology_digest:topology,resources:[{reference_key:'writer-primary',topology_digest:resourceTopology}],issued_at:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),nonce:uid(20),...patch};}
const canonical=v=>JSON.stringify(v===null||typeof v!=='object'?v:Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])));
function rawSigned(value,keyId='fixture-operator'){
 const payload=Buffer.from(canonical(value));const digest='sha256:'+createHash('sha256').update(payload).digest('hex');
 const signature=sign(null,Buffer.from('HYPERFIDE-ISOLATION-PERMIT-V1\n'+keyId+'\n'+digest+'\n'),pair.privateKey);
 return canonical({schema_version:1,key_id:keyId,payload_b64:payload.toString('base64url'),signature_b64:signature.toString('base64url')});
}
const permit=await issueIsolationPermit(claims(),{key_id:'fixture-operator',private_key_file:privateFile});
const expected={deployment_id:deployment,operation_id:operation,organisation_id:org,run_id:run,source_epoch:epoch,topology_digest:topology,resource_reference:'writer-primary',resource_topology_digest:resourceTopology};
function receipt(){return {deployment_id:deployment,operation_id:operation,fence_id:'transport-reference-fixture',source_epoch:epoch,isolated_writer:'fixture-only-no-physical-isolation',observed_at:new Date().toISOString(),expires_at:new Date(Date.now()+20000).toISOString(),evidence_digest:'sha256:'+'c'.repeat(64)};}
async function port(){const s=net.createServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});const n=s.address().port;await new Promise(resolve=>s.close(resolve));return n;}
const cert=base+'/cert.pem',key=base+'/key.pem',ca=await fs.readFile(cert);
let effects=0,mode='NORMAL',release,entered;
async function dispatch(proof,signal){
 assertIsolationPermit(proof,expected);
 if(mode==='HOLD')await new Promise(resolve=>{release=resolve;entered?.();signal.addEventListener('abort',resolve,{once:true});});
 if(signal.aborted)throw new Error('cancelled reference callback');
 effects++;const value=receipt();
 if(mode==='BAD_RECEIPT')value.operation_id=uid(99);
 if(mode==='EXPIRED_RECEIPT')value.expires_at=new Date(Date.now()-1).toISOString();
 return value;
}
async function start(extra={}){
 const p=await port(),origin='https://127.0.0.1:'+p,controller=new AbortController();
 const instance=await startIsolationHttpTransport({origin,host:'127.0.0.1',port:p,certificate:cert,privateKey:key,signal:controller.signal,verifier,dispatch,...extra});
 const client=await createIsolationHttpClient({origin,caFile:cert,deadlineMs:3000,maxConcurrent:2});
 listeners.push({instance,controller,port:p});return {instance,controller,port:p,origin,client};
}
async function absent(p){const socket=net.connect(p,'127.0.0.1');return await new Promise(resolve=>{socket.once('connect',()=>{socket.destroy();resolve(false);});socket.once('error',()=>resolve(true));});}
async function raw(target,{route='/v1/isolation',body=Buffer.from(JSON.stringify({schema_version:1,permit_envelope:permit})),headers={},method='POST'}={}){
 return await new Promise(resolve=>{
  const req=https.request(new URL(route,target.origin),{method,ca,rejectUnauthorized:true,minVersion:'TLSv1.3',agent:false,headers:{'Content-Type':'application/json','Content-Length':body.length,...headers}},res=>{
   const data=[];res.on('data',part=>data.push(part));res.once('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(data).toString())});}catch{resolve({status:res.statusCode,body:null});}});
  });req.once('error',()=>resolve({status:0,body:null}));req.end(body);
 });
}
const server=await start({deadlineMs:1000,maxConcurrent:1});
try{
 await check('isolation.transport.outage-startup-no-db',async()=>expect(!process.env.DATABASE_URL&&server.instance.address===server.origin));
 await check('isolation.transport.actual-ed25519-tls-roundtrip',async()=>{const before=effects;const result=await server.client.isolate(permit,new AbortController().signal);expect(result.outcome==='SUCCEEDED'&&result.receipt.operation_id===operation&&effects===before+1);});
 for(const [name,patch]of [['epoch',{source_epoch:uid(40)}],['topology',{topology_digest:'sha256:'+'d'.repeat(64)}],['resource',{resources:[{reference_key:'writer-other',topology_digest:resourceTopology}]}],['operation',{operation_id:uid(41)}],['organisation',{organisation_id:uid(42)}],['run',{run_id:uid(43)}]]){
  await check('isolation.transport.fixed-'+name+'-scope',async()=>{const before=effects;const value=await issueIsolationPermit(claims(patch),{key_id:'fixture-operator',private_key_file:privateFile});const result=await server.client.isolate(value,new AbortController().signal);expect(result.outcome!=='SUCCEEDED'&&effects===before);});
 }
 await check('isolation.transport.issuer-rejected',async()=>{const value=await issueIsolationPermit(claims(),{key_id:'untrusted-operator',private_key_file:privateFile});const result=await server.client.isolate(value,new AbortController().signal);expect(result.outcome==='REJECTED');});
 await check('isolation.transport.signature-rejected',async()=>{const value=JSON.parse(permit);value.signature_b64=(value.signature_b64[0]==='A'?'B':'A')+value.signature_b64.slice(1);expect((await server.client.isolate(canonical(value),new AbortController().signal)).outcome==='REJECTED');});
 await check('isolation.transport.purpose-rejected',async()=>{const before=effects;const result=await raw(server,{body:Buffer.from(JSON.stringify({schema_version:1,permit_envelope:rawSigned(claims({purpose:'ACTIVATE_AUTHORITY'}))}))});expect(result.body?.outcome==='REJECTED'&&effects===before);});
 await check('isolation.transport.expiry-rejected',async()=>expect((await server.client.isolate(rawSigned(claims({issued_at:new Date(Date.now()-2000).toISOString(),expires_at:new Date(Date.now()-1000).toISOString()})),new AbortController().signal)).outcome==='REJECTED'));
 await check('isolation.transport.nonce-shape-rejected',async()=>expect((await server.client.isolate(rawSigned(claims({nonce:'not-a-nonce'})),new AbortController().signal)).outcome==='REJECTED'));
 await check('isolation.transport.no-normal-auth-route',async()=>{const result=await raw(server,{route:'/v1/invoke'});expect(result.body?.outcome==='REJECTED'&&result.body?.code==='ISOLATION_ROUTE_INVALID');});
 await check('isolation.transport.no-enrollment-route',async()=>expect((await raw(server,{route:'/v1/enroll'})).body?.outcome==='REJECTED'));
 await check('isolation.transport.closed-request-fields',async()=>expect((await raw(server,{body:Buffer.from(JSON.stringify({schema_version:1,permit_envelope:permit,component:'14.1'}))})).body?.outcome==='REJECTED'));
 await check('isolation.transport.duplicate-json-rejected',async()=>expect((await raw(server,{body:Buffer.from('{"schema_version":1,"schema_version":1,"permit_envelope":'+JSON.stringify(permit)+'}') })).body?.outcome==='REJECTED'));
 await check('isolation.transport.duplicate-headers-rejected',async()=>expect((await raw(server,{headers:{'Content-Type':['application/json','application/json']}})).body?.outcome==='REJECTED'));
 await check('isolation.transport.body-bound',async()=>expect((await raw(server,{body:Buffer.alloc(131073,65)})).status===413));
 await check('isolation.transport.invalid-utf8-rejected',async()=>expect((await raw(server,{body:Buffer.from([255,254,253])})).body?.outcome==='REJECTED'));
 await check('isolation.transport.bad-ca-never-success',async()=>{const client=await createIsolationHttpClient({origin:server.origin,caFile:base+'/bad-cert.pem',deadlineMs:500});const before=effects;expect((await client.isolate(permit,new AbortController().signal)).outcome==='UNKNOWN'&&effects===before);});
 await check('isolation.transport.expired-receipt-never-success',async()=>{mode='EXPIRED_RECEIPT';try{expect((await server.client.isolate(permit,new AbortController().signal)).outcome==='UNKNOWN');}finally{mode='NORMAL';}});
 await check('isolation.transport.wrong-operation-receipt-never-success',async()=>{mode='BAD_RECEIPT';try{expect((await server.client.isolate(permit,new AbortController().signal)).outcome==='UNKNOWN');}finally{mode='NORMAL';}});
 await check('isolation.transport.private-brand-required',async()=>{
  let calls=0;const verified=verifier.verifySigned(permit);const forged=await start({verifier:{verifySigned:()=>({...verified})},dispatch:async()=>{calls++;return receipt();}});
  try{const result=await forged.client.isolate(permit,new AbortController().signal);expect(result.outcome==='REJECTED'&&calls===0);}finally{await forged.instance.close();}
 });
 await check('isolation.transport.verified-permit-digest-bound',async()=>{
  let calls=0;const other=verifier.verifySigned(rawSigned(claims({nonce:uid(44)})));const mismatch=await start({verifier:{verifySigned:()=>other},dispatch:async()=>{calls++;return receipt();}});
  try{expect((await mismatch.client.isolate(permit,new AbortController().signal)).outcome==='REJECTED'&&calls===0);}finally{await mismatch.instance.close();}
 });
 await check('isolation.transport.server-concurrency-bounded',async()=>{
  mode='HOLD';let ready;const begun=new Promise(resolve=>ready=resolve);entered=ready;const first=server.client.isolate(permit,new AbortController().signal);await begun;
  try{const second=await server.client.isolate(permit,new AbortController().signal);expect(second.outcome==='REJECTED'&&second.code==='ISOLATION_ADMISSION_BUSY');}finally{mode='NORMAL';release();entered=undefined;await first;}
 });
 await check('isolation.transport.after-send-abort-unknown',async()=>{
  mode='HOLD';let ready;const begun=new Promise(resolve=>ready=resolve);entered=ready;const cancel=new AbortController();const pending=server.client.isolate(permit,cancel.signal);await begun;cancel.abort();
  try{expect((await pending).outcome==='UNKNOWN');}finally{mode='NORMAL';release();entered=undefined;}
 });
 await check('isolation.transport.pre-send-abort-rejected',async()=>{const cancel=new AbortController();cancel.abort();expect((await server.client.isolate(permit,cancel.signal)).outcome==='REJECTED');});
 await check('isolation.transport.deadline-unknown',async()=>{
  let finish;const slow=await start({deadlineMs:100,dispatch:async()=>new Promise(resolve=>{finish=()=>resolve(receipt());})});
  try{expect((await slow.client.isolate(permit,new AbortController().signal)).outcome==='UNKNOWN');}finally{finish();await new Promise(resolve=>setImmediate(resolve));await slow.instance.close();}
 });
 await check('isolation.transport.noncooperative-dispatch-retains-admission',async()=>{
  let calls=0,finish;const slow=await start({deadlineMs:100,maxConcurrent:1,dispatch:async()=>{calls++;return await new Promise(resolve=>{finish=()=>resolve(receipt());});}});
  try{
   expect((await slow.client.isolate(permit,new AbortController().signal)).outcome==='UNKNOWN'&&calls===1);
   const next=await issueIsolationPermit(claims({nonce:uid(45)}),{key_id:'fixture-operator',private_key_file:privateFile});
   const denied=await slow.client.isolate(next,new AbortController().signal);
   expect(denied.outcome==='REJECTED'&&denied.code==='ISOLATION_ADMISSION_BUSY'&&calls===1);
  }finally{finish();await new Promise(resolve=>setImmediate(resolve));await slow.instance.close();}
 });
 await check('isolation.transport.shutdown-reports-live-dispatch',async()=>{
  let finish;const slow=await start({deadlineMs:100,maxConcurrent:1,dispatch:async()=>new Promise(resolve=>{finish=()=>resolve(receipt());})});
  try{
   expect((await slow.client.isolate(permit,new AbortController().signal)).outcome==='UNKNOWN');
   let incomplete=false;try{await slow.instance.close();}catch(error){incomplete=error?.code==='ISOLATION_SHUTDOWN_INCOMPLETE';}
   expect(incomplete&&await absent(slow.port));
  }finally{finish();await new Promise(resolve=>setImmediate(resolve));await slow.instance.close();}
 });
 await check('isolation.transport.private-key-permissions',async()=>{
  const unsafe=base+'/unsafe-key.pem';await fs.copyFile(key,unsafe);await fs.chmod(unsafe,0o644);let refused=false;
  try{await start({privateKey:unsafe});}catch(error){refused=error?.code==='ISOLATION_TLS_CONFIG';}expect(refused);
 });
 await check('isolation.transport.symlink-tls-rejected',async()=>{
  const linked=base+'/linked-cert.pem';await fs.symlink(cert,linked);let refused=false;
  try{await start({certificate:linked});}catch(error){refused=error?.code==='ISOLATION_TLS_CONFIG';}expect(refused);
 });
 await check('isolation.transport.no-redirect',async()=>{
  let hits=0;const targetPort=await port(),target=https.createServer({cert:ca,key:await fs.readFile(key)},(_req,res)=>{hits++;res.end('{}');});
  await new Promise(resolve=>target.listen(targetPort,'127.0.0.1',resolve));
  const redirectPort=await port(),redirect=https.createServer({cert:ca,key:await fs.readFile(key)},(_req,res)=>{res.writeHead(307,{Location:'https://127.0.0.1:'+targetPort+'/v1/isolation','Content-Type':'application/json'});res.end('{}');});
  await new Promise(resolve=>redirect.listen(redirectPort,'127.0.0.1',resolve));
  try{const client=await createIsolationHttpClient({origin:'https://127.0.0.1:'+redirectPort,caFile:cert});expect((await client.isolate(permit,new AbortController().signal)).outcome==='UNKNOWN'&&hits===0);}
  finally{target.closeAllConnections();redirect.closeAllConnections();await Promise.all([new Promise(resolve=>target.close(resolve)),new Promise(resolve=>redirect.close(resolve))]);expect(await absent(targetPort)&&await absent(redirectPort));}
 });
 await check('isolation.transport.http200-false-never-fence',async()=>{
  const p=await port(),fake=https.createServer({cert:ca,key:await fs.readFile(key)},(_req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end('{"schema_version":1,"ok":false}');});
  await new Promise(resolve=>fake.listen(p,'127.0.0.1',resolve));
  try{const client=await createIsolationHttpClient({origin:'https://127.0.0.1:'+p,caFile:cert});expect((await client.isolate(permit,new AbortController().signal)).outcome==='UNKNOWN');}
  finally{fake.closeAllConnections();await new Promise(resolve=>fake.close(resolve));expect(await absent(p));}
 });
}finally{
 for(const listener of listeners){await listener.instance.close();expect(await absent(listener.port));observations.push({port:listener.port,observed_absent:true});}
 await fs.writeFile(base+'/observations.json',JSON.stringify({scope:'transport-component',production_dispatch:'NOT_QUALIFIED_REFERENCE_FIXTURE_ONLY',actual24_08_journal_provider_qualification:'UNRUN',database_required:false,assertion_ids:ids,failed:failures,listeners:observations})+'\n');
}
if(failures.length)process.exitCode=1;
"""
def main():
 out=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/isolation14-transport"))/"transport"
 out.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory(prefix="hf-isolation-transport-") as temp:
  base=Path(temp)
  for stem in ["","bad-"]:
   subprocess.run(["openssl","req","-x509","-newkey","rsa:2048","-nodes","-keyout",str(base/(stem+"key.pem")),"-out",str(base/(stem+"cert.pem")),"-days","1","-subj","/CN=127.0.0.1","-addext","subjectAltName=IP:127.0.0.1"],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
   os.chmod(base/(stem+"key.pem"),0o600)
  script=base/"transport.mjs";script.write_text(PROGRAM)
  result=subprocess.run(["node",str(script),str(ROOT),str(base)],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=180)
  print(result.stdout,end="")
  (out/"stdout.jsonl").write_text(result.stdout)
  (out/"stderr.log").write_text(result.stderr)
  observations=base/"observations.json"
  if observations.exists():(out/"observations.json").write_bytes(observations.read_bytes())
  else:print(json.dumps({"type":"fatal","code":"ISOLATION_TEST_DID_NOT_CLOSE"}))
  return result.returncode
if __name__=="__main__":raise SystemExit(main())
