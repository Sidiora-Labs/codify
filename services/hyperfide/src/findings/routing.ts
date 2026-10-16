import type {Component,ComponentContext} from '../components/registry.js';
import {admin,decimal,digest,emit,fail,fields,finding,manager,record,text,uuid,withFindingTransaction} from './registry.js';
import type {FindingTransaction} from './registry.js';

async function owner(value:FindingTransaction,packageId:string):Promise<Record<string,any>>{
 const rows=await value.tx.query('SELECT p.id,p.manager_session_id,h.owner_generation::text,s.state AS manager_state,s.role AS manager_role FROM hyperfide.feature_packages p LEFT JOIN hyperfide.hierarchy_packages h ON h.organisation_id=p.organisation_id AND h.run_id=p.run_id AND h.package_id=p.id LEFT JOIN hyperfide.agent_sessions s ON s.organisation_id=p.organisation_id AND s.run_id=p.run_id AND s.id=p.manager_session_id WHERE p.organisation_id=$1 AND p.run_id=$2 AND p.id=$3 FOR SHARE OF p',[value.scope.organisation_id,value.scope.run_id,packageId]);
 if(rows.rows.length!==1)fail('OWNER_NOT_FOUND','Accountable package does not exist in this run');
 if(rows.rows[0]!.owner_generation!==null)await value.tx.query('SELECT package_id FROM hyperfide.hierarchy_packages WHERE organisation_id=$1 AND run_id=$2 AND package_id=$3 FOR SHARE',[value.scope.organisation_id,value.scope.run_id,packageId]);
 return rows.rows[0]!;
}
async function route(value:FindingTransaction,input:unknown,explicit=false):Promise<Record<string,unknown>>{
 const p=record(input);fields(p,['finding_id','request_id','expected_state_version'],explicit?['package_id','reason']:[]);
 if(explicit&&(!Object.hasOwn(p,'package_id')||!Object.hasOwn(p,'reason')))fail('INVALID_REQUEST','Leader assignment requires package and rationale');
 await admin(value);
 const findingId=uuid(p.finding_id),requestId=uuid(p.request_id),expected=decimal(p.expected_state_version),packetDigest=digest(p),{tx,scope}=value;
 const f=await finding(tx,scope,findingId,true);
 if(f.phase==='DUPLICATE')fail('CANONICAL_TARGET_REQUIRED','A duplicate alias cannot acquire independent routing or repair authority');if(['RESOLVED','ACCEPTED_EXCEPTION','NOT_REPRODUCED'].includes(f.phase))fail('FINDING_CLOSED','A closed finding must first be reopened by current evidence');
 const old=await tx.query('SELECT * FROM hyperfide.finding_routes WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3',[scope.organisation_id,scope.run_id,requestId]);
 if(old.rows.length){if(old.rows[0]!.request_digest!==packetDigest)fail('IDEMPOTENCY_CONFLICT','Routing request was reused with different intent');return {route:old.rows[0],replayed:true};}
 if(String(f.registry_version)!==expected)fail('STALE_FINDING','Finding changed since routing context was read');
 const origin=await tx.query('SELECT a.task_id,t.feature_package_id FROM hyperfide.attempts a JOIN hyperfide.tasks t ON t.organisation_id=a.organisation_id AND t.run_id=a.run_id AND t.id=a.task_id WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.id=$3 AND a.task_id=$4 FOR SHARE OF a,t',[scope.organisation_id,scope.run_id,f.origin_attempt_id,f.origin_task_id]);
 if(origin.rows.length!==1)fail('ORIGIN_INVALID','Reviewed revision does not have a valid introducing task attempt');
 const packageId=explicit?uuid(p.package_id):String(f.owner_package_id),responsible=await owner(value,packageId);
 const active=responsible.manager_session_id&&responsible.owner_generation&&['REGISTERED','RUNNING'].includes(responsible.manager_state)&&responsible.manager_role==='FEATURE_MANAGER';
 const collaborators=(f.collaborator_package_ids as string[]).filter(id=>id!==packageId).sort();
 const snapshots=[];
 for(const id of collaborators){const row=await owner(value,id);snapshots.push({package_id:id,manager_session_id:row.manager_session_id,owner_generation:row.owner_generation});}
 const latest=await tx.query('SELECT COALESCE(max(generation),0)::text AS generation FROM hyperfide.finding_routes WHERE organisation_id=$1 AND run_id=$2 AND finding_id=$3',[scope.organisation_id,scope.run_id,findingId]);
 const generation=(BigInt(latest.rows[0]!.generation)+1n).toString();
 const reason=explicit?text(p.reason,'routing rationale'):active?'Reviewed commit and origin attempt resolve to the current accountable package manager':'Current manager is unavailable; durable leader routing is required';
 const result=await tx.query('INSERT INTO hyperfide.finding_routes(organisation_id,run_id,finding_id,request_id,request_digest,generation,owner_package_id,owner_generation,manager_session_id,leader_queue,reason,collaborator_package_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING *',[scope.organisation_id,scope.run_id,findingId,requestId,packetDigest,generation,packageId,active?responsible.owner_generation:null,active?responsible.manager_session_id:null,!active,reason,JSON.stringify(collaborators)]);
 const current=result.rows[0]!;
 for(const peer of snapshots)await tx.query('INSERT INTO hyperfide.finding_route_collaborators(organisation_id,run_id,route_id,package_id,manager_session_id,owner_generation) VALUES($1,$2,$3,$4,$5,$6)',[scope.organisation_id,scope.run_id,current.id,peer.package_id,peer.manager_session_id,peer.owner_generation]);
 await tx.query('UPDATE hyperfide.findings SET owner_package_id=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[scope.organisation_id,scope.run_id,findingId,packageId]);
 await tx.query('UPDATE hyperfide.finding_registry_records SET phase=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND finding_id=$3',[scope.organisation_id,scope.run_id,findingId,['REPAIRING','READY_FOR_RECHECK'].includes(f.phase)?f.phase:active?'ASSIGNED':'TRIAGED']);
 await emit(tx,scope,findingId,(BigInt(expected)+1n).toString(),'finding.routed',{finding_id:findingId,route_id:current.id,generation,leader_queue:!active});
 return {route:current,collaborators:snapshots,replayed:false};
}
async function acknowledge(value:FindingTransaction,input:unknown,collaborator=false):Promise<Record<string,unknown>>{
 const p=record(input);fields(p,['route_id','generation','owner_generation'],collaborator?['package_id']:[]);
 if(collaborator&&!Object.hasOwn(p,'package_id'))fail('INVALID_REQUEST','Collaborator acknowledgement requires package identity');
 const routeId=uuid(p.route_id),generation=decimal(p.generation),ownerGeneration=decimal(p.owner_generation),{tx,scope}=value;
 const routes=await tx.query('SELECT * FROM hyperfide.finding_routes WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[scope.organisation_id,scope.run_id,routeId]);
 if(routes.rows.length!==1)fail('ROUTE_NOT_FOUND','Route does not exist in this run');const routed=routes.rows[0]!;
 await finding(tx,scope,routed.finding_id,true);
 const latest=await tx.query('SELECT id FROM hyperfide.finding_routes WHERE organisation_id=$1 AND run_id=$2 AND finding_id=$3 ORDER BY generation DESC LIMIT 1',[scope.organisation_id,scope.run_id,routed.finding_id]);
 if(latest.rows[0]?.id!==routeId||String(routed.generation)!==generation)fail('STALE_ROUTE','A newer route supersedes this acknowledgement');
 const packageId=collaborator?uuid(p.package_id):String(routed.owner_package_id);
 const current=await owner(value,packageId);
 if(current.manager_session_id!==value.principal.actor_id||current.owner_generation!==ownerGeneration||!['REGISTERED','RUNNING'].includes(current.manager_state))fail('STALE_OWNER','Acknowledgement requires the current live manager generation');
 if(collaborator){
  const snapshot=await tx.query('SELECT * FROM hyperfide.finding_route_collaborators WHERE organisation_id=$1 AND run_id=$2 AND route_id=$3 AND package_id=$4',[scope.organisation_id,scope.run_id,routeId,packageId]);
  if(snapshot.rows[0]?.manager_session_id!==value.principal.actor_id||String(snapshot.rows[0]?.owner_generation)!==ownerGeneration)fail('STALE_ROUTE','Collaborator ownership changed after routing');
  await tx.query('INSERT INTO hyperfide.finding_collaborator_acknowledgements(organisation_id,run_id,route_id,package_id,actor_id,owner_generation) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[scope.organisation_id,scope.run_id,routeId,packageId,value.principal.actor_id,ownerGeneration]);
 }else{
  if(routed.leader_queue||routed.manager_session_id!==value.principal.actor_id||String(routed.owner_generation)!==ownerGeneration)fail('STALE_ROUTE','Route is not assigned to this current owner');
  await tx.query('INSERT INTO hyperfide.finding_route_acknowledgements(organisation_id,run_id,route_id,actor_id,generation,owner_generation) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[scope.organisation_id,scope.run_id,routeId,value.principal.actor_id,generation,ownerGeneration]);
  await tx.query('UPDATE hyperfide.findings SET state=\'ACKNOWLEDGED\',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state=\'OPEN\'',[scope.organisation_id,scope.run_id,routed.finding_id]);
 }
 return {acknowledged:true,route_id:routeId,generation,owner_generation:ownerGeneration,package_id:packageId};
}
export function createComponent(_context:ComponentContext):Component{return {apiVersion:1,actions:{
 'finding.route':(input,context)=>withFindingTransaction(context,'finding.route',value=>route(value,input)),
 'finding.route.assign':(input,context)=>withFindingTransaction(context,'finding.route.assign',value=>route(value,input,true)),
 'finding.route.acknowledge':(input,context)=>withFindingTransaction(context,'finding.route.acknowledge',value=>acknowledge(value,input)),
 'finding.route.collaborator.acknowledge':(input,context)=>withFindingTransaction(context,'finding.route.collaborator.acknowledge',value=>acknowledge(value,input,true))
}};}
