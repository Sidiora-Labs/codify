import {FoundationError} from '../policy/programme.js';
import {assertPrimaryTransaction} from './transactions.js';
import type {PrimaryTransaction} from './transactions.js';

export interface SemanticDispositionScope {readonly organisation_id:string;readonly run_id:string}
export interface SemanticDispositionReceipt extends SemanticDispositionScope {
 readonly generation:string;readonly mode:'READ'|'WRITE';
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const held=new WeakMap<PrimaryTransaction,Map<string,{mode:'READ'|'WRITE';promise:Promise<SemanticDispositionReceipt>}>>();
/** This is a snapshot conflict fence, not actor authorisation.
 * Select WRITE before invoking any guard that locks runs FOR SHARE. A later
 * READ reuses WRITE; READ cannot be upgraded. All disposition writers must
 * participate before mutation. SERIALIZABLE retries belong to the gateway.
 */
async function fence(tx:PrimaryTransaction,scope:SemanticDispositionScope,mode:'READ'|'WRITE'):Promise<SemanticDispositionReceipt>{
 assertPrimaryTransaction(tx);
 if(!scope||!UUID.test(scope.organisation_id)||!UUID.test(scope.run_id))
  throw new FoundationError('INVALID_REQUEST','Exact semantic disposition run scope is required');
 const key=scope.organisation_id+':'+scope.run_id;
 const cached=held.get(tx)?.get(key);
 if(cached){
  if(cached.mode==='READ'&&mode==='WRITE')throw new FoundationError('SEMANTIC_FENCE_ORDER','Choose WRITE before any READ disposition or run SHARE guard');
  return cached.promise;
 }
 let scopes=held.get(tx);if(!scopes){scopes=new Map();held.set(tx,scopes);}
 if(scopes.size>=128)throw new FoundationError('SEMANTIC_SCOPE_LIMIT','One transaction may fence at most128 run scopes');
 const promise=Promise.resolve().then(async()=>{
 const isolation=(await tx.query<{isolation:string}>("SELECT current_setting('transaction_isolation') AS isolation")).rows[0]?.isolation;
 if(isolation!=='serializable')throw new FoundationError('SEMANTIC_ISOLATION_REQUIRED','Semantic freshness requires the genuine SERIALIZABLE primary gateway');
 const row=(await tx.query<{generation:string}>(mode==='WRITE'?
  'UPDATE hyperfide.runs SET semantic_generation=semantic_generation+1 WHERE organisation_id=$1 AND id=$2 RETURNING semantic_generation::text AS generation':
  'SELECT semantic_generation::text AS generation FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',
  [scope.organisation_id,scope.run_id])).rows[0];
 if(!row)throw new FoundationError('SEMANTIC_RUN_MISSING','No existing run may be admitted without its disposition generation fence');
 if(!/^[1-9][0-9]*$/.test(row.generation))throw new FoundationError('SEMANTIC_FENCE_INVALID','Disposition generation must be a positive primary bigint');
 const receipt=Object.freeze({organisation_id:scope.organisation_id,run_id:scope.run_id,generation:row.generation,mode});
 return receipt;
 });
 scopes.set(key,{mode,promise});
 return promise;
}
export function readSemanticDisposition(tx:PrimaryTransaction,scope:SemanticDispositionScope):Promise<SemanticDispositionReceipt>{return fence(tx,scope,'READ');}
export function writeSemanticDisposition(tx:PrimaryTransaction,scope:SemanticDispositionScope):Promise<SemanticDispositionReceipt>{return fence(tx,scope,'WRITE');}
