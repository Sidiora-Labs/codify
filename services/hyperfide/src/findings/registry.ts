import {createHash} from 'node:crypto';
import type pg from 'pg';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from '../policy/programme.js';
import {getPool,databaseError} from '../storage/schema.js';

export interface FindingScope {organisation_id:string;run_id:string;repository_id?:string;source_object_id?:string}
export interface FindingPrincipal {credential_id:string;actor_id:string;organisation_id:string;run_id:string;deployment_epoch:string;role:string;allowed_actions:readonly string[]}
export interface FindingInvocation {principal:FindingPrincipal;operation:string;guard(tx:pg.PoolClient):Promise<void>}
export interface FindingTransaction {tx:pg.PoolClient;scope:FindingScope;principal:FindingPrincipal;context:ComponentContext}
export function fail(code:string,message:string):never {throw new FoundationError(code,message);}
export function record(value:unknown):Record<string,unknown>{if(!object(value))fail('INVALID_REQUEST','A bounded object is required');return value;}
export function fields(value:Record<string,unknown>,required:string[],optional:string[]=[]):void{
 if(required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>![...required,...optional].includes(key)))fail('INVALID_REQUEST','Fields do not match the versioned finding contract');
}
export function text(value:unknown,label:string,max=4096):string{if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\0'))fail('INVALID_REQUEST','Invalid '+label);return value;}
export function uuid(value:unknown):string{const out=text(value,'UUID',36);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(out))fail('INVALID_REQUEST','A UUID is required');return out.toLowerCase();}
export function decimal(value:unknown):string{if(typeof value!=='string'||!/^[1-9][0-9]{0,18}$/.test(value)||BigInt(value)>9223372036854775807n)fail('INVALID_REQUEST','A canonical positive decimal is required');return value;}
export function digestValue(value:unknown):string{if(typeof value!=='string'||!/^sha256:[0-9a-f]{64}$/.test(value))fail('INVALID_REQUEST','A SHA256 content identity is required');return value;}
export function oid(value:unknown):string{if(typeof value!=='string'||!/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(value))fail('INVALID_REQUEST','A Git object identity is required');return value;}
export function ids(value:unknown,max=128):string[]{if(!Array.isArray(value)||value.length>max)fail('INVALID_REQUEST','A bounded UUID array is required');const result=value.map(uuid);if(new Set(result).size!==result.length)fail('INVALID_REQUEST','Duplicate UUIDs are not allowed');return result;}
export function canonical(value:unknown):string{
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(object(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 return fail('INVALID_REQUEST','Only JSON values are supported');
}
export function digest(value:unknown):string{return 'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');}
export async function invocation(context:ComponentContext,action:string):Promise<FindingInvocation>{
 const value=(context as unknown as {invocation?:FindingInvocation}).invocation;
 if(!value||!value.principal||typeof value.guard!=='function')fail('AUTH_REQUIRED','Authenticated invocation context is required');
 let authenticate:unknown;try{authenticate=(await import(new URL('../transport/protocol.js',import.meta.url).href)).assertInvocation;}catch{fail('DEPENDENCY_NOT_READY','The actual identity authority module is required');}
 if(typeof authenticate!=='function')fail('DEPENDENCY_NOT_READY','The actual identity authority brand is required');authenticate(value);
 const principal=value.principal;
 uuid(principal.credential_id);uuid(principal.actor_id);uuid(principal.organisation_id);uuid(principal.run_id);uuid(principal.deployment_epoch);
 if(value.operation!==action||principal.run_id!==context.policy.programme_id||!Array.isArray(principal.allowed_actions)||!principal.allowed_actions.includes(action))fail('AUTH_DENIED','Invocation is not authorised for this run and operation');
 return value;
}
export async function readiness(tx:pg.PoolClient):Promise<void>{
 const result=await tx.query("SELECT to_regclass('hyperfide.finding_registry_records')::text AS installed,pg_is_in_recovery() AS replica");
 if(result.rows[0]?.replica)fail('PRIMARY_REQUIRED','Finding authority requires the PostgreSQL primary');
 if(!result.rows[0]?.installed)fail('MIGRATION_REQUIRED','The domain18 additive migration must be applied by the migration runner');
}
export async function withFindingTransaction<T>(context:ComponentContext,action:string,fn:(value:FindingTransaction)=>Promise<T>):Promise<T>{
 const call=await invocation(context,action),principal=call.principal;
 const tx=await getPool(context.env).connect();
 try{
  await tx.query('BEGIN ISOLATION LEVEL READ COMMITTED');await readiness(tx);await call.guard(tx);
  const scope={organisation_id:principal.organisation_id,run_id:principal.run_id};
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[scope.organisation_id+':'+scope.run_id+':finding-disposition']);
  const run=await tx.query('SELECT authority_epoch FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',[scope.organisation_id,scope.run_id]);
  if(run.rows.length!==1||run.rows[0]!.authority_epoch!==principal.deployment_epoch)fail('STALE_AUTHORITY','Run authority epoch does not match the authenticated deployment');
  const result=await fn({tx,scope,principal,context});await call.guard(tx);await tx.query('COMMIT');return result;
 }catch(error){try{await tx.query('ROLLBACK');}catch{/* An unknown transaction outcome is not success. */}
  if(error instanceof FoundationError)throw error;
  if(object(error)&&error.code==='42P01')fail('DEPENDENCY_NOT_READY','A required authority module migration is missing');
  throw databaseError(error);
 }finally{tx.release();}
}
export async function admin(value:FindingTransaction):Promise<void>{
 if(['OPERATOR','COORDINATOR'].includes(value.principal.role))return;
 const result=await value.tx.query('SELECT leader_session_id FROM hyperfide.hierarchy_leaders WHERE organisation_id=$1 AND run_id=$2 AND authority_epoch=$3 FOR SHARE',[value.scope.organisation_id,value.scope.run_id,value.principal.deployment_epoch]);
 if(value.principal.role!=='LEADER'||result.rows[0]?.leader_session_id!==value.principal.actor_id)fail('AUTH_DENIED','Current programme leader or approved coordinator authority is required');
}
export async function manager(value:FindingTransaction,packageId:string):Promise<void>{
 if(['OPERATOR','COORDINATOR','LEADER'].includes(value.principal.role)){await admin(value);return;}
 const result=await value.tx.query('SELECT manager_session_id FROM hyperfide.feature_packages WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',[value.scope.organisation_id,value.scope.run_id,packageId]);
 if(result.rows[0]?.manager_session_id!==value.principal.actor_id)fail('AUTH_DENIED','Only the current accountable manager may mutate this finding');
}
export async function emit(tx:pg.PoolClient,scope:FindingScope,findingId:string,version:string,event:string,payload:Record<string,unknown>):Promise<void>{
 await tx.query('INSERT INTO hyperfide.outbox_events(organisation_id,run_id,aggregate_type,aggregate_id,aggregate_version,event_type,payload) VALUES($1,$2,\'finding\',$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING',[scope.organisation_id,scope.run_id,findingId,version,event,JSON.stringify(payload)]);
}
export async function finding(tx:pg.PoolClient,scope:FindingScope,id:string,lock=false):Promise<Record<string,any>>{
 const result=await tx.query('SELECT f.*,r.phase,r.origin_task_id,r.origin_attempt_id,r.resolution_condition,r.resolution_digest,r.collaborator_package_ids,r.state_version AS registry_version,r.first_observed_at,r.last_observed_at FROM hyperfide.findings f JOIN hyperfide.finding_registry_records r ON r.organisation_id=f.organisation_id AND r.run_id=f.run_id AND r.finding_id=f.id WHERE f.organisation_id=$1 AND f.run_id=$2 AND f.id=$3'+(lock?' FOR UPDATE OF f,r':''),[scope.organisation_id,scope.run_id,id]);
 if(result.rows.length!==1)fail('FINDING_NOT_FOUND','Finding does not exist in the authenticated run');return result.rows[0]!;
}
export async function admittedEvidence(tx:pg.PoolClient,scope:FindingScope,evidenceIds:string[],repositoryId?:string,sourceObjectId?:string):Promise<void>{
 if(!evidenceIds.length)fail('EVIDENCE_REQUIRED','Admitted evidence is required');
 const result=await tx.query('SELECT id,repository_id,source_object_id,admission_state FROM hyperfide.evidence WHERE organisation_id=$1 AND run_id=$2 AND id=ANY($3::uuid[]) FOR SHARE',[scope.organisation_id,scope.run_id,evidenceIds]);
 if(result.rows.length!==evidenceIds.length||result.rows.some(row=>row.admission_state!=='ADMITTED'||repositoryId&&row.repository_id!==repositoryId||sourceObjectId&&row.source_object_id!==sourceObjectId))fail('EVIDENCE_INVALID','Evidence is missing, stale or bound to different inputs');
}
function resolution(value:unknown):Record<string,unknown>{
 const out=record(value);fields(out,['condition_id','criteria_digest','rubric_digest','requires_original_failure','required_contract_ids']);
 text(out.condition_id,'condition identity',128);digestValue(out.criteria_digest);digestValue(out.rubric_digest);ids(out.required_contract_ids);
 if(typeof out.requires_original_failure!=='boolean'||Buffer.byteLength(canonical(out))>65536)fail('INVALID_REQUEST','Invalid bounded resolution condition');return out;
}
export async function acceptedResolution(tx:pg.PoolClient,scope:FindingScope,taskId:string,repositoryId:string,input:unknown):Promise<Record<string,unknown>>{
 const condition=resolution(input);const task=await tx.query('SELECT criteria_digest,spec_generation::text,spec_revision_id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',[scope.organisation_id,scope.run_id,taskId]);if(task.rows.length!==1)fail('ORIGIN_INVALID','Resolution origin task is absent');
 let load:unknown;try{load=(await import(new URL('../spec/obligations.js',import.meta.url).href)).loadProofObligations;}catch{fail('DEPENDENCY_NOT_READY','Accepted proof registry authority is required');}if(typeof load!=='function')fail('DEPENDENCY_NOT_READY','Accepted proof registry inspector is absent');
 const accepted=record(await load(tx,{organisation_id:scope.organisation_id,run_id:scope.run_id,task_id:taskId,spec_generation:task.rows[0]!.spec_generation,spec_revision_id:task.rows[0]!.spec_revision_id})),policy=record(accepted.policy);
 if(accepted.criteria_digest!==condition.criteria_digest||task.rows[0]!.criteria_digest!==condition.criteria_digest||policy.rubric_digest!==condition.rubric_digest||policy.repository_id!==repositoryId)fail('CONDITION_MISMATCH','Resolution must use accepted criterion, rubric and repository identities');
 const obligations=Array.isArray(accepted.obligations)?accepted.obligations.map(record):[];const matched=obligations.filter(item=>item.clause_id===condition.condition_id||Array.isArray(item.required_checks)&&item.required_checks.includes(condition.condition_id));if(!matched.length)fail('CONDITION_MISMATCH','Resolution condition is not an accepted clause or executable check');
 const checks=[...new Set(matched.flatMap(item=>Array.isArray(item.required_checks)?item.required_checks.map(value=>text(value,'accepted check identity',128)):[]))].sort();
 // Executable repair conditions cannot waive the original-failure counterfactual.
 if(condition.requires_original_failure!==(checks.length>0))fail('CONDITION_MISMATCH','Recorded resolution cannot waive accepted executable counterfactual proof');
 const contractDigests=Array.isArray(policy.contract_digests)?policy.contract_digests.map(digestValue):[];const contracts=await tx.query('SELECT id,criteria_digest FROM (SELECT DISTINCT ON(contract_key) id,criteria_digest FROM hyperfide.contracts WHERE organisation_id=$1 AND run_id=$2 ORDER BY contract_key,revision DESC) current_contracts WHERE criteria_digest=ANY($3::text[]) ORDER BY id',[scope.organisation_id,scope.run_id,contractDigests]);if(contracts.rows.length!==contractDigests.length||new Set(contracts.rows.map(row=>row.criteria_digest)).size!==contractDigests.length)fail('CONDITION_MISMATCH','Accepted affected contract identities are missing or ambiguous');const requiredContracts=contracts.rows.map(row=>String(row.id)).sort();if(canonical(requiredContracts)!==canonical((condition.required_contract_ids as string[]).slice().sort()))fail('CONDITION_MISMATCH','All accepted affected contract obligations must be preserved');
 return {...condition,required_contract_ids:requiredContracts,proof_registry_digest:accepted.registry_digest,required_check_ids:checks};
}
export async function revalidateResolution(tx:pg.PoolClient,scope:FindingScope,f:Record<string,any>):Promise<void>{const stored=record(f.resolution_condition);const input=Object.fromEntries(['condition_id','criteria_digest','rubric_digest','requires_original_failure','required_contract_ids'].map(key=>[key,stored[key]]));const current=await acceptedResolution(tx,scope,String(f.origin_task_id),String(f.repository_id),input);if(canonical(current)!==canonical(stored))fail('RESOLUTION_CONDITION_CHANGED','Accepted resolution obligations are no longer current');}
export async function reportFinding(value:FindingTransaction,input:unknown):Promise<Record<string,unknown>>{
 const payload=record(input);fields(payload,['observation_id','resolution_condition'],['collaborator_package_ids']);
 const observationId=uuid(payload.observation_id),requestedCondition=resolution(payload.resolution_condition),collaborators=ids(payload.collaborator_package_ids??[]).sort();
 const {tx,scope,principal}=value;
 await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[scope.organisation_id+':'+scope.run_id+':finding-report:'+observationId]);
 const observation=await tx.query('SELECT o.*,r.rubric_digest,r.input_manifest_digest,r.candidate_digest,r.outcome FROM hyperfide.review_observations o JOIN hyperfide.review_receipts r ON r.organisation_id=o.organisation_id AND r.run_id=o.run_id AND r.id=o.review_receipt_id WHERE o.organisation_id=$1 AND o.run_id=$2 AND o.id=$3 FOR SHARE OF o,r',[scope.organisation_id,scope.run_id,observationId]);
 if(observation.rows.length!==1||observation.rows[0]!.outcome!=='FINDINGS')fail('OBSERVATION_INVALID','An immutable admitted finding observation is required');
 const observed=observation.rows[0]!;
 if(observed.observer_session_id!==principal.actor_id)await admin(value);
 await admittedEvidence(tx,scope,[observed.evidence_id],observed.repository_id,observed.source_object_id);
 const task=await tx.query('SELECT t.feature_package_id,t.criteria_digest FROM hyperfide.tasks t JOIN hyperfide.attempts a ON a.organisation_id=t.organisation_id AND a.run_id=t.run_id AND a.task_id=t.id WHERE t.organisation_id=$1 AND t.run_id=$2 AND t.id=$3 AND a.id=$4 FOR SHARE OF t,a',[scope.organisation_id,scope.run_id,observed.origin_task_id,observed.origin_attempt_id]);
 if(task.rows.length!==1)fail('ORIGIN_INVALID','Observation origin must identify an existing scoped task attempt');
 const condition=await acceptedResolution(tx,scope,String(observed.origin_task_id),String(observed.repository_id),requestedCondition);
 const packages=await tx.query('SELECT id FROM hyperfide.feature_packages WHERE organisation_id=$1 AND run_id=$2 AND id=ANY($3::uuid[]) FOR SHARE',[scope.organisation_id,scope.run_id,collaborators]);
 if(packages.rows.length!==collaborators.length)fail('SCOPE_MISMATCH','Collaborators must belong to the same run');
 const conditionDigest=digest(condition),requestDigest=digest({observation_id:observationId,resolution_condition:condition,collaborator_package_ids:collaborators});
 const previous=await tx.query('SELECT finding_id,report_digest FROM hyperfide.finding_registry_reports WHERE organisation_id=$1 AND run_id=$2 AND observation_id=$3',[scope.organisation_id,scope.run_id,observationId]);
 if(previous.rows.length){if(previous.rows[0]!.report_digest!==requestDigest)fail('IDEMPOTENCY_CONFLICT','Observation was already recorded with different finding intent');return {finding_id:previous.rows[0]!.finding_id,observation_id:observationId,replayed:true,deduplicated:true};}
 const fingerprint=digest({repository_id:observed.repository_id,source_object_id:observed.source_object_id,contract_id:observed.contract_id??null,failure_fingerprint:observed.failure_fingerprint,resolution_digest:conditionDigest});
 await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[scope.organisation_id+':'+scope.run_id+':finding-key:'+fingerprint]);
 const existing=await tx.query('SELECT id,state_version FROM hyperfide.findings WHERE organisation_id=$1 AND run_id=$2 AND dedup_digest=$3 FOR UPDATE',[scope.organisation_id,scope.run_id,fingerprint]);
 let findingId:string,reopened=false;
 if(existing.rows.length){
  findingId=existing.rows[0]!.id;
  const canonicalTarget=await tx.query('WITH RECURSIVE chain(id) AS (SELECT $3::uuid UNION SELECT d.target_finding_id FROM hyperfide.finding_duplicate_links d JOIN chain c ON c.id=d.source_finding_id WHERE d.organisation_id=$1 AND d.run_id=$2) SELECT id FROM chain WHERE NOT EXISTS(SELECT 1 FROM hyperfide.finding_duplicate_links d WHERE d.organisation_id=$1 AND d.run_id=$2 AND d.source_finding_id=chain.id)',[scope.organisation_id,scope.run_id,findingId]);
  if(canonicalTarget.rows.length!==1)fail('DUPLICATE_CYCLE','Canonical duplicate target is not uniquely resolvable');findingId=canonicalTarget.rows[0]!.id;
  const prior=await finding(tx,scope,findingId,true);reopened=['RESOLVED','NOT_REPRODUCED','ACCEPTED_EXCEPTION'].includes(prior.phase);
  const ranks=['INFO','WARNING','ERROR','CRITICAL'];const severity=ranks.indexOf(observed.severity)>ranks.indexOf(prior.severity)?observed.severity:prior.severity;
  await tx.query('UPDATE hyperfide.findings SET severity=$4,state=CASE WHEN $5 THEN \'OPEN\' ELSE state END,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[scope.organisation_id,scope.run_id,findingId,severity,reopened]);
  await tx.query('UPDATE hyperfide.finding_registry_records SET phase=CASE WHEN $4 THEN \'REOPENED\' ELSE phase END,last_observed_at=clock_timestamp(),state_version=state_version+1,collaborator_package_ids=(SELECT COALESCE(jsonb_agg(DISTINCT v),\'[]\'::jsonb) FROM jsonb_array_elements(collaborator_package_ids||$5::jsonb) AS e(v)) WHERE organisation_id=$1 AND run_id=$2 AND finding_id=$3',[scope.organisation_id,scope.run_id,findingId,reopened,JSON.stringify(collaborators)]);
 }else{
  const created=await tx.query('INSERT INTO hyperfide.findings(organisation_id,run_id,dedup_digest,owner_package_id,contract_id,repository_id,source_object_id,severity,summary) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',[scope.organisation_id,scope.run_id,fingerprint,task.rows[0]!.feature_package_id,observed.contract_id??null,observed.repository_id,observed.source_object_id,observed.severity,text(observed.summary,'finding summary',4096)]);
  findingId=created.rows[0]!.id;
  await tx.query('INSERT INTO hyperfide.finding_registry_records(organisation_id,run_id,finding_id,origin_task_id,origin_attempt_id,resolution_condition,resolution_digest,collaborator_package_ids,first_observed_at,last_observed_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,clock_timestamp(),clock_timestamp())',[scope.organisation_id,scope.run_id,findingId,observed.origin_task_id,observed.origin_attempt_id,JSON.stringify(condition),conditionDigest,JSON.stringify(collaborators)]);
 }
 await tx.query('INSERT INTO hyperfide.finding_registry_reports(organisation_id,run_id,observation_id,finding_id,report_digest,review_receipt_id,evidence_id,observer_session_id,report) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',[scope.organisation_id,scope.run_id,observationId,findingId,requestDigest,observed.review_receipt_id,observed.evidence_id,observed.observer_session_id,JSON.stringify(observed)]);
 await tx.query('INSERT INTO hyperfide.finding_observations(organisation_id,run_id,id,finding_id,evidence_id,observer_session_id) VALUES($1,$2,$3,$4,$5,$6)',[scope.organisation_id,scope.run_id,observationId,findingId,observed.evidence_id,observed.observer_session_id]);
 const current=await finding(tx,scope,findingId);
 await emit(tx,scope,findingId,String(current.registry_version),reopened?'finding.reopened':'finding.observed',{finding_id:findingId,observation_id:observationId});
 return {finding_id:findingId,observation_id:observationId,replayed:false,deduplicated:existing.rows.length>0,reopened,phase:current.phase,state_version:String(current.registry_version)};
}
export async function inspectBlockingFindings(tx:pg.PoolClient,scope:FindingScope):Promise<{clear:boolean;blockers:Record<string,unknown>[]} >{
 await readiness(tx);uuid(scope.organisation_id);uuid(scope.run_id);if(scope.repository_id)uuid(scope.repository_id);if(scope.source_object_id)oid(scope.source_object_id);
 await tx.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))',[scope.organisation_id+':'+scope.run_id+':finding-disposition']);
 // Earlier unresolved revisions remain blocking; a candidate commit alone never disposes of them.
 const rows=await tx.query('SELECT f.id AS finding_id,f.severity,r.phase,r.state_version::text,f.source_object_id,r.resolution_digest FROM hyperfide.findings f JOIN hyperfide.finding_registry_records r ON r.organisation_id=f.organisation_id AND r.run_id=f.run_id AND r.finding_id=f.id WHERE f.organisation_id=$1 AND f.run_id=$2 AND ($3::uuid IS NULL OR f.repository_id=$3) AND f.severity IN (\'ERROR\',\'CRITICAL\') AND r.phase<>\'DUPLICATE\' ORDER BY f.id',[scope.organisation_id,scope.run_id,scope.repository_id??null]);
 const untriaged=await tx.query('SELECT o.id AS observation_id,o.severity,o.source_object_id FROM hyperfide.review_observations o LEFT JOIN hyperfide.finding_registry_reports r ON r.organisation_id=o.organisation_id AND r.run_id=o.run_id AND r.observation_id=o.id WHERE o.organisation_id=$1 AND o.run_id=$2 AND ($3::uuid IS NULL OR o.repository_id=$3) AND o.severity IN (\'ERROR\',\'CRITICAL\') AND r.observation_id IS NULL ORDER BY o.id',[scope.organisation_id,scope.run_id,scope.repository_id??null]);
 const orphaned=await tx.query('SELECT f.id AS finding_id,f.severity,f.source_object_id FROM hyperfide.findings f LEFT JOIN hyperfide.finding_registry_records r ON r.organisation_id=f.organisation_id AND r.run_id=f.run_id AND r.finding_id=f.id WHERE f.organisation_id=$1 AND f.run_id=$2 AND ($3::uuid IS NULL OR f.repository_id=$3) AND f.severity IN (\'ERROR\',\'CRITICAL\') AND r.finding_id IS NULL ORDER BY f.id',[scope.organisation_id,scope.run_id,scope.repository_id??null]);
 const blockers:Record<string,unknown>[]=[...untriaged.rows.map(row=>({...row,reason:'UNTRIAGED_BLOCKING_OBSERVATION'})),...orphaned.rows.map(row=>({...row,reason:'CANONICAL_DISPOSITION_MISSING'}))];for(const row of rows.rows){if(row.phase==='RESOLVED'){try{const check=(await import(new URL('./remediation.js',import.meta.url).href)).inspectFindingResolution;if(typeof check!=='function'||(await check(tx,scope,row.finding_id)).current!==true)blockers.push({...row,reason:'RESOLUTION_PROOF_STALE_OR_UNAVAILABLE'});}catch{blockers.push({...row,reason:'RESOLUTION_PROOF_STALE_OR_UNAVAILABLE'});}}else blockers.push(row);}return {clear:blockers.length===0,blockers};
}
async function confirmDuplicate(value:FindingTransaction,input:unknown):Promise<Record<string,unknown>>{
 const p=record(input);fields(p,['source_finding_id','target_finding_id','reason','evidence_ids','expected_state_version']);await admin(value);
 const sourceId=uuid(p.source_finding_id),targetId=uuid(p.target_finding_id),evidenceIds=ids(p.evidence_ids);if(sourceId===targetId)fail('INVALID_REQUEST','A finding cannot duplicate itself');
 const reason=text(p.reason,'duplicate rationale'),version=decimal(p.expected_state_version),{tx,scope}=value;
 for(const id of [sourceId,targetId].sort())await finding(tx,scope,id,true);
 const source=await finding(tx,scope,sourceId),target=await finding(tx,scope,targetId);
 if(source.repository_id!==target.repository_id)fail('SCOPE_MISMATCH','Cross-repository findings cannot be silently consolidated');
 const loop=await tx.query('WITH RECURSIVE chain AS (SELECT target_finding_id FROM hyperfide.finding_duplicate_links WHERE organisation_id=$1 AND run_id=$2 AND source_finding_id=$3 UNION SELECT d.target_finding_id FROM hyperfide.finding_duplicate_links d JOIN chain c ON d.source_finding_id=c.target_finding_id WHERE d.organisation_id=$1 AND d.run_id=$2) SELECT 1 FROM chain WHERE target_finding_id=$4',[scope.organisation_id,scope.run_id,targetId,sourceId]);
 if(loop.rows.length)fail('DUPLICATE_CYCLE','Duplicate relationships cannot form cycles');
 await admittedEvidence(tx,scope,evidenceIds);
 const prior=await tx.query('SELECT target_finding_id,reason,evidence_ids FROM hyperfide.finding_duplicate_links WHERE organisation_id=$1 AND run_id=$2 AND source_finding_id=$3',[scope.organisation_id,scope.run_id,sourceId]);
 if(prior.rows.length){if(prior.rows[0]!.target_finding_id!==targetId||prior.rows[0]!.reason!==reason||canonical(prior.rows[0]!.evidence_ids)!==canonical(evidenceIds))fail('IDEMPOTENCY_CONFLICT','Duplicate disposition already differs');return {source_finding_id:sourceId,target_finding_id:targetId,replayed:true};}
 if(String(source.registry_version)!==version)fail('STALE_FINDING','Finding changed since duplicate review');
 if(source.resolution_digest!==target.resolution_digest)fail('CONDITION_MISMATCH','Different resolution obligations cannot be discarded by duplicate consolidation');
 if(target.phase==='DUPLICATE')fail('DUPLICATE_TARGET_NOT_CANONICAL','Select the current canonical target before consolidating observations');
 const severities=['INFO','WARNING','ERROR','CRITICAL'];if(severities.indexOf(String(source.severity))>severities.indexOf(String(target.severity)))await tx.query('UPDATE hyperfide.findings SET severity=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[scope.organisation_id,scope.run_id,targetId,source.severity]);
 if(['RESOLVED','NOT_REPRODUCED','ACCEPTED_EXCEPTION'].includes(target.phase)&&!['RESOLVED','DUPLICATE'].includes(source.phase)){
  await tx.query('UPDATE hyperfide.finding_registry_records SET phase=\'REOPENED\',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND finding_id=$3',[scope.organisation_id,scope.run_id,targetId]);
  await tx.query('UPDATE hyperfide.findings SET state=\'OPEN\',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[scope.organisation_id,scope.run_id,targetId]);
  await emit(tx,scope,targetId,(BigInt(target.registry_version)+1n).toString(),'finding.reopened',{finding_id:targetId,source_finding_id:sourceId});
 }
 await tx.query('INSERT INTO hyperfide.finding_duplicate_links(organisation_id,run_id,source_finding_id,target_finding_id,actor_id,reason,evidence_ids,actor_role,credential_id) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)',[scope.organisation_id,scope.run_id,sourceId,targetId,value.principal.actor_id,reason,JSON.stringify(evidenceIds),value.principal.role,value.principal.credential_id]);
 await tx.query('UPDATE hyperfide.finding_registry_records SET phase=\'DUPLICATE\',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND finding_id=$3',[scope.organisation_id,scope.run_id,sourceId]);
 await emit(tx,scope,sourceId,(BigInt(version)+1n).toString(),'finding.duplicate-confirmed',{source_finding_id:sourceId,target_finding_id:targetId});
 return {source_finding_id:sourceId,target_finding_id:targetId,replayed:false};
}
export function createComponent(_context:ComponentContext):Component{return {apiVersion:1,actions:{
 'finding.report':(input,context)=>withFindingTransaction(context,'finding.report',value=>reportFinding(value,input)),
 'finding.inspect':(input,context)=>withFindingTransaction(context,'finding.inspect',async value=>{const p=record(input);fields(p,['finding_id']);const row=await finding(value.tx,value.scope,uuid(p.finding_id));const reports=await value.tx.query('SELECT observation_id,review_receipt_id,evidence_id,observer_session_id,recorded_at FROM hyperfide.finding_registry_reports WHERE organisation_id=$1 AND run_id=$2 AND finding_id=$3 ORDER BY recorded_at,observation_id',[value.scope.organisation_id,value.scope.run_id,row.id]);return {finding:row,reports:reports.rows};}),
 'finding.blockers.inspect':(input,context)=>withFindingTransaction(context,'finding.blockers.inspect',async value=>{const p=record(input);fields(p,[],['repository_id']);return inspectBlockingFindings(value.tx,{...value.scope,...(p.repository_id===undefined?{}:{repository_id:uuid(p.repository_id)})});}),
 'finding.list':(input,context)=>withFindingTransaction(context,'finding.list',async value=>{const p=record(input);fields(p,[],['after_id','limit']);const limit=p.limit===undefined?50:p.limit;if(typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('INVALID_REQUEST','Limit must be an integer from1to100');const after=p.after_id===undefined?null:uuid(p.after_id);const rows=await value.tx.query('SELECT f.id,f.repository_id,f.source_object_id,f.severity,f.summary,r.phase,r.state_version::text FROM hyperfide.findings f JOIN hyperfide.finding_registry_records r ON r.organisation_id=f.organisation_id AND r.run_id=f.run_id AND r.finding_id=f.id WHERE f.organisation_id=$1 AND f.run_id=$2 AND ($3::uuid IS NULL OR f.id>$3) ORDER BY f.id LIMIT $4',[value.scope.organisation_id,value.scope.run_id,after,limit+1]);return {findings:rows.rows.slice(0,limit),next_after_id:rows.rows.length>limit?rows.rows[limit-1]!.id:null};}),
 'finding.duplicate.confirm':(input,context)=>withFindingTransaction(context,'finding.duplicate.confirm',value=>confirmDuplicate(value,input))
}};}
