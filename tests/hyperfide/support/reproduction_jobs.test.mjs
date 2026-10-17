import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {bindReproductionInputs,createReproductionJobInputReader,reproductionJobRequest} from '../../../services/hyperfide/dist/runner/reproduction_jobs.js';
import {createResourceContainer} from '../../../services/hyperfide/dist/storage/runtime.js';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const digest=n=>'sha256:'+createHash('sha256').update(String(n)).digest('hex');
const denied=e=>e?.code==='REPRODUCTION_INPUT_AUTHORITY_DENIED';
function fixture(){
 const request={job_namespace:'REPRODUCTION',job_id:id(1),lease_generation:'2',reservation_id:id(3),input_manifest_digest:digest('manifest'),environment_digest:digest('environment')};
 const scope={organisation_id:id(4),run_id:id(5)};
 const authority={authority:'EXPECTED_AUTHORITY',namespace:'REPRODUCTION',...scope,job_id:request.job_id,lease_generation:request.lease_generation,reservation_id:request.reservation_id,input_manifest_digest:request.input_manifest_digest,
 input_packet_digest:digest('packet'),input_manifest:Object.fromEntries(['dependency','toolchain','configuration','graph','contract'].map(role=>[role,{digest:digest(role)}])),
 repository_id:id(6),source_manifest_digest:digest('physical-envelope'),source_object_id:'a'.repeat(40),source_tree_id:'b'.repeat(40),profile_id:id(7),profile_digest:digest('profile'),environment_digest:request.environment_digest,
 sandbox_id:id(8),sandbox_boot_generation:'9',slot_id:id(10),recorded_runner_session_id:id(11),recorded_runner_boot_id:id(12),recorded_runner_slot_generation:'13',custody_id:id(14),custody_generation:'15'};
 const prepared={...structuredClone(authority),runner_session_id:id(11),preparation_digest:digest('prepared-files'),source_state_digest:digest('source-state'),workspace_digest:digest('workspace'),receipt_digest:digest('retained-receipt'),
 boot_id:id(12),boot_generation:'9',slot_generation:'13'};
 return {request,scope,authority,prepared};
}
test('synthetic immutable authority join returns EXPECTED_AUTHORITY only',()=>{
 const f=fixture(),result=bindReproductionInputs(f.authority,f.prepared,f.request,f.scope);
 assert.equal(result.authority,'EXPECTED_AUTHORITY');assert.equal(result.status,undefined);assert.equal(result.namespace,'REPRODUCTION');assert.ok(Object.isFrozen(result));
 f.prepared.input_manifest.graph.digest=digest('changed-after-bind');assert.notEqual(result.input_manifest.graph.digest,f.prepared.input_manifest.graph.digest);
});
test('missing retained preparation fails closed without borrowing source measurements',()=>{
 const f=fixture();assert.equal(bindReproductionInputs(f.authority,null,f.request,f.scope),null);
});
for(const namespace of [undefined,'QUALIFICATION','CANDIDATE','CHECKPOINT','PREWARM','reproduction']){
 test('explicit reproduction namespace required: '+String(namespace),()=>{const f=fixture();f.request.job_namespace=namespace;assert.throws(()=>reproductionJobRequest(f.request),denied);});
}
for(const [field,value] of [['job_id',id(99)],['lease_generation','03'],['reservation_id',''],['input_manifest_digest','bad'],['environment_digest','bad'],['readiness_digest',digest('caller-observation')]]){
 test('request refuses '+field,()=>{const f=fixture();f.request[field]=value;if(field==='job_id')assert.throws(()=>bindReproductionInputs(f.authority,f.prepared,f.request,f.scope),denied);else assert.throws(()=>reproductionJobRequest(f.request),denied);});
}
for(const field of ['organisation_id','run_id','job_id','lease_generation','reservation_id','input_manifest_digest','input_packet_digest','repository_id','source_manifest_digest','source_object_id','source_tree_id','profile_id','profile_digest','environment_digest','custody_id','custody_generation','sandbox_id','boot_generation','slot_id','runner_session_id','boot_id','slot_generation']){
 test('retained preparation cannot substitute '+field,()=>{const f=fixture();f.prepared[field]=field.endsWith('_digest')?digest('other'):field.endsWith('_id')?id(98):'999';assert.throws(()=>bindReproductionInputs(f.authority,f.prepared,f.request,f.scope),denied);});
}
test('all five exact role objects remain bound',()=>{const f=fixture();f.prepared.input_manifest.graph.digest=digest('other-graph');assert.throws(()=>bindReproductionInputs(f.authority,f.prepared,f.request,f.scope),denied);});
test('scalar role digest cannot replace accepted role object',()=>{const f=fixture();f.authority.input_manifest.graph=digest('graph');assert.throws(()=>bindReproductionInputs(f.authority,f.prepared,f.request,f.scope),denied);});
test('a VERIFIED assertion cannot replace retained expected authority',()=>{const f=fixture();f.prepared.authority='VERIFIED';assert.throws(()=>bindReproductionInputs(f.authority,f.prepared,f.request,f.scope),denied);});
test('unbranded SQL client cannot invoke either producer',async()=>{
 const f=fixture();let calls=0;const reader=createReproductionJobInputReader(async()=>{calls++;return f.authority;},async()=>{calls++;return f.prepared;});
 await assert.rejects(reader({query:async()=>({rows:[]})},{},f.request),e=>e?.code==='TX_CLOSED');assert.equal(calls,0);
});
test('genuine PostgreSQL primary transaction rejects forged invocation before producer lookup',async()=>{
 assert.ok(process.env.DATABASE_URL,'DATABASE_URL required; the real selected boundary test never skips');
 const f=fixture();let calls=0;const reader=createReproductionJobInputReader(async()=>{calls++;return f.authority;},async()=>{calls++;return f.prepared;});
 const resources=createResourceContainer({role:'control',env:process.env,signal:new AbortController().signal});
 try{await resources.gateway.withPrimaryTransaction({timeoutMs:5000},async tx=>{await assert.rejects(reader(tx,{principal:f.scope,guard:async()=>{}},f.request),e=>e?.code==='AUTH_REQUIRED');});}
 finally{await resources.close();}
 assert.equal(calls,0);
});
