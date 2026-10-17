import {createHash} from 'node:crypto';
import type {ComponentContext} from '../components/registry.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import type {ProviderDestructionPreflight} from '../providers/pools.js';
import {isProviderIntentCapability} from '../providers/reconcile.js';
import {FoundationError} from '../policy/programme.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function uuid(value:string):void{if(typeof value!=='string'||!UUID.test(value))throw new FoundationError('DESTRUCTION_SCOPE_INVALID','Canonical destruction scope is required');}
/** Read-only custody proof. A worked boot needs a separately sealed current
 * workspace/checkpoint closure; an older checkpoint cannot prove no later edits. */
export const readArtifactDestructionPreflight:ProviderDestructionPreflight=async(tx,input)=>{
 assertPrimaryTransaction(tx);
 uuid(input.organisation_id);uuid(input.run_id);uuid(input.sandbox_id);uuid(input.operation_id);
 if(typeof input.boot_generation!=='string'||!/^[1-9][0-9]{0,18}$/.test(input.boot_generation)||BigInt(input.boot_generation)>9223372036854775807n)
  throw new FoundationError('DESTRUCTION_SCOPE_INVALID','Canonical current boot is required');
 const result=await tx.query<{id:string;pool_id:string;native_sandbox_id:string|null;boot_generation:string;work_admitted:boolean;boot_id:string;authority_epoch:string}>(
  'SELECT s.id,s.pool_id,s.native_sandbox_id,s.boot_generation::text,s.work_admitted,b.boot_id,r.authority_epoch FROM hyperfide.sandboxes s JOIN hyperfide.sandbox_boots b ON b.organisation_id=s.organisation_id AND b.sandbox_id=s.id AND b.boot_generation=s.boot_generation JOIN hyperfide.runs r ON r.organisation_id=s.organisation_id AND r.id=$2 WHERE s.organisation_id=$1 AND s.id=$3 AND s.boot_generation=$4 FOR UPDATE OF s FOR SHARE OF b,r',
  [input.organisation_id,input.run_id,input.sandbox_id,input.boot_generation]);
 const row=result.rows[0];if(!row||!row.native_sandbox_id||row.work_admitted)return null;
 const history=await tx.query<{worked:boolean}>(
  'SELECT EXISTS(SELECT 1 FROM hyperfide.attempts WHERE organisation_id=$1 AND sandbox_id=$2) OR EXISTS(SELECT 1 FROM hyperfide.workspaces WHERE organisation_id=$1 AND sandbox_id=$2) OR EXISTS(SELECT 1 FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND sandbox_id=$2) OR EXISTS(SELECT 1 FROM hyperfide.provider_remote_operations WHERE organisation_id=$1 AND sandbox_id=$2) AS worked',
  [input.organisation_id,input.sandbox_id]);
 if(history.rows[0]?.worked!==false)return null;
 const clock=await tx.query<{observed_at:Date}>('SELECT clock_timestamp() AS observed_at');
 const observed=clock.rows[0]?.observed_at;if(!(observed instanceof Date)||!Number.isFinite(observed.getTime()))throw new FoundationError('DESTRUCTION_PRIMARY_CLOCK_INVALID','Current primary clock is unavailable');
 const binding={schema_version:1,kind:'NEVER_WORKED_SANDBOX',organisation_id:input.organisation_id,run_id:input.run_id,sandbox_id:input.sandbox_id,boot_generation:input.boot_generation,boot_id:row.boot_id,native_sandbox_id:row.native_sandbox_id,pool_id:row.pool_id,authority_epoch:row.authority_epoch,operation_id:input.operation_id,work_admitted:false,historical_attempts:false,historical_workspaces:false,historical_sessions:false,historical_remote_operations:false};
 return {evidence_digest:'sha256:'+createHash('sha256').update(JSON.stringify(binding)).digest('hex'),observed_at:observed.toISOString()};
};
export function registerArtifactDestructionPreflight(context:ComponentContext):void{
 const provider=context.dependencies.require('8.3','provider.intents.v1',isProviderIntentCapability);
 const release=provider.registerDestructionPreflight(readArtifactDestructionPreflight);
 if(context.signal.aborted)release();else context.signal.addEventListener('abort',release,{once:true});
}
