// Task 12.4: native preparation-stage receipt verification (pure, no authority).
// Run: node --test tests/hyperfide/support/preparation_receipts.test.mjs (after the service build).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const {verifyPreparationReceipt,PREPARATION_STAGE_ROOT}=await import(pathToFileURL(path.join(root,'services/hyperfide/dist/runner/preparation_receipts.js')).href);
const sha=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
function fixture(){
 const operation_id=randomUUID(),stage_root=PREPARATION_STAGE_ROOT+operation_id,node=sha('node'),recipe=sha('recipe');
 const argv=['/usr/bin/node','/opt/recipes/prepare.mjs','--job-context',stage_root+'/context.json'];
 const plan={operation_id,plan_digest:sha('plan'),argv,executable_digest:node,workspace_path:'/srv/slots/a/worktree',uid:62001,gid:62001};
 const receipt={execution_plane:'REMOTE',operation_id,plan_digest:plan.plan_digest,executable_digest:node,preparation_stage:{stage_root,context_path:stage_root+'/context.json',context_digest:sha('context'),out_root:stage_root+'/out',diagnostics_root:stage_root+'/diagnostics',workspace_path:plan.workspace_path,node_path:argv[0],node_digest:node,recipe_path:argv[1],recipe_digest:recipe,uid:62001,gid:62001}};
 return {plan,receipt};
}
const bytes=v=>Buffer.from(JSON.stringify(v));
const refused=(fn,code)=>assert.throws(fn,e=>e.code===code);
test('exact operation-scoped receipt verifies with its byte digest',()=>{
 const {plan,receipt}=fixture(),raw=bytes(receipt),verified=verifyPreparationReceipt(raw,plan);
 assert.equal(verified.receipt_digest,sha(raw));assert.equal(verified.stage.context_path,plan.argv[3]);
});
test('receipt for another operation or plan is refused',()=>{
 const {plan,receipt}=fixture();
 refused(()=>verifyPreparationReceipt(bytes({...receipt,operation_id:randomUUID()}),plan),'PREPARATION_RECEIPT_MISMATCH');
 refused(()=>verifyPreparationReceipt(bytes({...receipt,plan_digest:sha('other')}),plan),'PREPARATION_RECEIPT_MISMATCH');
});
test('stage layout outside the operation root is refused',()=>{
 const {plan,receipt}=fixture();
 refused(()=>verifyPreparationReceipt(bytes({...receipt,preparation_stage:{...receipt.preparation_stage,out_root:'/tmp/out'}}),plan),'PREPARATION_RECEIPT_MISMATCH');
});
test('recipe/node substitution and slot retargeting are refused',()=>{
 const {plan,receipt}=fixture();
 refused(()=>verifyPreparationReceipt(bytes({...receipt,preparation_stage:{...receipt.preparation_stage,recipe_path:'/bin/sh'}}),plan),'PREPARATION_RECEIPT_MISMATCH');
 refused(()=>verifyPreparationReceipt(bytes({...receipt,preparation_stage:{...receipt.preparation_stage,uid:0}}),plan),'PREPARATION_RECEIPT_INVALID');
 refused(()=>verifyPreparationReceipt(bytes({...receipt,preparation_stage:{...receipt.preparation_stage,workspace_path:'/etc'}}),plan),'PREPARATION_RECEIPT_MISMATCH');
});
test('missing, extra or malformed stage evidence is refused',()=>{
 const {plan,receipt}=fixture();
 refused(()=>verifyPreparationReceipt(bytes({...receipt,preparation_stage:undefined}),plan),'PREPARATION_RECEIPT_INVALID');
 assert.throws(()=>verifyPreparationReceipt(bytes({...receipt,preparation_stage:{...receipt.preparation_stage,authority:'GRANTED'}}),plan));
 assert.throws(()=>verifyPreparationReceipt(Buffer.from('{"a":1,"a":2}'),plan));
 refused(()=>verifyPreparationReceipt(Buffer.alloc(0),plan),'PREPARATION_RECEIPT_INVALID');
});
