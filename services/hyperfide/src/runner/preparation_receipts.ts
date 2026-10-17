import type {PrimaryTransaction} from '../storage/transactions.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import type {InvocationContext} from '../transport/protocol.js';
import {DIGEST,exact,fail,hash,strictJSON,uuid} from '../transport/protocol.js';
import {object} from '../policy/programme.js';

/* Native preparation-stage receipts (job.c -> hf_runner_stage_preparation).
 * The native job receipt carries the exact stage layout and pinned recipe/node
 * digests; these are checked against the committed PREPARATION plan before the
 * receipt is persisted. A receipt never grants readiness or execution authority. */
export const PREPARATION_STAGE_ROOT='/run/hyperfide-stage/';
const STAGE_KEYS=['stage_root','context_path','context_digest','out_root','diagnostics_root','workspace_path','node_path','node_digest','recipe_path','recipe_digest','uid','gid'] as const;
export interface PreparationStageReceipt {
 stage_root:string;context_path:string;context_digest:string;out_root:string;diagnostics_root:string;workspace_path:string;
 node_path:string;node_digest:string;recipe_path:string;recipe_digest:string;uid:number;gid:number;
}
export interface PreparationReceiptPlan {operation_id:string;plan_digest:string;argv:readonly string[];executable_digest:string;workspace_path?:string;uid?:number;gid?:number}
export interface VerifiedPreparationReceipt {receipt:Record<string,unknown>;stage:PreparationStageReceipt;receipt_digest:string}
function absolute(v:unknown):v is string{return typeof v==='string'&&v.startsWith('/')&&!v.includes('\0')&&v.split('/').slice(1).every(p=>p!==''&&p!=='.'&&p!=='..');}
function digest(v:unknown):v is string{return typeof v==='string'&&DIGEST.test(v);}

/** Pure verification shared by the 12.4 preparation capability and the receipt store. */
export function verifyPreparationReceipt(bytes:Buffer,plan:PreparationReceiptPlan):VerifiedPreparationReceipt{
 if(!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>1048576)fail('PREPARATION_RECEIPT_INVALID','Bounded native receipt bytes required');
 const receipt=strictJSON(bytes,1048576);
 if(!object(receipt)||!uuid(plan.operation_id)||!digest(plan.plan_digest)||!Array.isArray(plan.argv)||plan.argv.length<4||!digest(plan.executable_digest))fail('PREPARATION_RECEIPT_INVALID','Native receipt object and committed plan required');
 if(receipt.execution_plane!=='REMOTE'||receipt.operation_id!==plan.operation_id||receipt.plan_digest!==plan.plan_digest||receipt.executable_digest!==plan.executable_digest)fail('PREPARATION_RECEIPT_MISMATCH','Receipt is not bound to the committed preparation operation');
 const stage=receipt.preparation_stage;
 if(!object(stage))fail('PREPARATION_RECEIPT_INVALID','Native preparation stage evidence required');
 exact(stage,STAGE_KEYS);
 const root=PREPARATION_STAGE_ROOT+plan.operation_id;
 if(stage.stage_root!==root||stage.context_path!==root+'/context.json'||stage.out_root!==root+'/out'||stage.diagnostics_root!==root+'/diagnostics')fail('PREPARATION_RECEIPT_MISMATCH','Stage layout differs from the operation-scoped root');
 if(!absolute(stage.workspace_path)||!absolute(stage.node_path)||!absolute(stage.recipe_path)||![stage.context_digest,stage.node_digest,stage.recipe_digest].every(digest)||!Number.isSafeInteger(stage.uid)||Number(stage.uid)<1||!Number.isSafeInteger(stage.gid)||Number(stage.gid)<1)fail('PREPARATION_RECEIPT_INVALID','Exact stage paths, digests and slot identity required');
 if(stage.node_path!==plan.argv[0]||stage.recipe_path!==plan.argv[1]||plan.argv[2]!=='--job-context'||plan.argv[3]!==stage.context_path||stage.node_digest!==plan.executable_digest)fail('PREPARATION_RECEIPT_MISMATCH','Stage node/recipe/context differ from the committed argv');
 if(plan.workspace_path!==undefined&&stage.workspace_path!==plan.workspace_path||plan.uid!==undefined&&stage.uid!==plan.uid||plan.gid!==undefined&&stage.gid!==plan.gid)fail('PREPARATION_RECEIPT_MISMATCH','Stage target differs from the reserved slot');
 return {receipt,stage:stage as unknown as PreparationStageReceipt,receipt_digest:hash(bytes)};
}

/** Persist a verified receipt for an existing committed PREPARATION operation. Idempotent by digest. */
export async function recordPreparationReceipt(tx:PrimaryTransaction,i:InvocationContext,v:unknown):Promise<Record<string,unknown>>{
 assertPrimaryTransaction(tx);
 if(i.principal.role!=='RUNNER')fail('ROLE_DENIED','Only the bound runner reports native preparation receipts');
 exact(v,['operation_id','receipt_base64']);
 if(!uuid(v.operation_id)||typeof v.receipt_base64!=='string'||v.receipt_base64.length>1398104)fail('INVALID_REQUEST','Operation and canonical base64 receipt required');
 const bytes=Buffer.from(v.receipt_base64,'base64');if(bytes.toString('base64')!==v.receipt_base64)fail('INVALID_REQUEST','Canonical base64 receipt required');
 const p=i.principal,row=(await tx.query('SELECT operation_id,job_class,state,plan,plan_digest FROM hyperfide.runner_remote_jobs WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 FOR SHARE',[p.organisation_id,p.run_id,v.operation_id])).rows[0];
 if(!row||row.job_class!=='PREPARATION'||!['CLAIMED','COMPLETED','UNKNOWN'].includes(row.state)||!object(row.plan)||!object(row.plan.request)||!object(row.plan.binding))fail('PREPARATION_OPERATION_UNKNOWN','A claimed committed preparation operation is required');
 const request=row.plan.request as Record<string,any>,binding=row.plan.binding as Record<string,any>;
 if(binding.sandbox_id!==p.sandbox_id||String(binding.boot_generation)!==p.boot_generation)fail('PREPARATION_SCOPE_DENIED','Receipt belongs to another runner boot');
 const verified=verifyPreparationReceipt(bytes,{operation_id:row.operation_id,plan_digest:row.plan_digest,argv:request.argv,executable_digest:request.executable_digest,workspace_path:binding.workspace_path,uid:binding.uid,gid:binding.gid});
 const s=verified.stage;
 await tx.query('INSERT INTO hyperfide.runner_preparation_receipts(organisation_id,run_id,operation_id,receipt,receipt_digest,plan_digest,context_digest,node_digest,recipe_digest,stage_root,workspace_path,recorded_by_credential_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING',[p.organisation_id,p.run_id,row.operation_id,JSON.stringify(verified.receipt),verified.receipt_digest,row.plan_digest,s.context_digest,s.node_digest,s.recipe_digest,s.stage_root,s.workspace_path,p.credential_id]);
 const stored=(await readPreparationReceipt(tx,{organisation_id:p.organisation_id,run_id:p.run_id,operation_id:row.operation_id}))!;
 if(stored.receipt_digest!==verified.receipt_digest)fail('PREPARATION_RECEIPT_CONFLICT','A different native receipt is already recorded for this operation');
 return {...stored,verified:true,authority:'NONE'};
}
export async function readPreparationReceipt(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string;operation_id:string}):Promise<Record<string,unknown>|null>{
 assertPrimaryTransaction(tx);
 const row=(await tx.query('SELECT operation_id,receipt_digest,plan_digest,context_digest,node_digest,recipe_digest,stage_root,workspace_path,recorded_at FROM hyperfide.runner_preparation_receipts WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3',[scope.organisation_id,scope.run_id,scope.operation_id])).rows[0];
 return row?{...row,recorded_at:new Date(row.recorded_at).toISOString()}:null;
}
