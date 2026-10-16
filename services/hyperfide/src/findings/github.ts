import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import {admin,canonical,digest,emit,fail,fields,finding,manager,record,text,uuid,withFindingTransaction} from './registry.js';
import type {FindingScope,FindingTransaction} from './registry.js';

class GitHubFailure extends Error {constructor(public readonly code:string,public readonly uncertain=false){super(code);}}
interface Issue {number:number;title:string;body:string;state:'open'|'closed';updated_at:string;pull_request?:unknown}
function issue(value:unknown):Issue{
 const p=record(value);if(typeof p.number!=='number'||!Number.isSafeInteger(p.number)||p.number<1||typeof p.title!=='string'||typeof p.body!=='string'&&p.body!==null||!['open','closed'].includes(String(p.state))||typeof p.updated_at!=='string'||!Number.isFinite(Date.parse(p.updated_at)))fail('GITHUB_INVALID_RESPONSE','GitHub returned an invalid issue record');
 return {number:p.number,title:p.title,body:p.body??'',state:p.state,updated_at:p.updated_at,...(p.pull_request?{pull_request:true}:{})} as Issue;
}
function repository(value:unknown):string{const out=text(value,'GitHub repository name',100);if(!/^[A-Za-z0-9_.-]+$/.test(out)||out==='.'||out==='..')fail('INVALID_REQUEST','Invalid GitHub repository identity');return out;}
function marker(env:Readonly<NodeJS.ProcessEnv>,scope:FindingScope,findingId:string,repositoryId:string):string{
 const secret=env.HF_GITHUB_MARKER_SECRET;if(!secret||Buffer.byteLength(secret)<32||Buffer.byteLength(secret)>4096)fail('GITHUB_CONFIG_REQUIRED','A separate bounded marker signing secret is required');
 const signature=createHmac('sha256',secret).update([scope.organisation_id,scope.run_id,repositoryId,findingId].join(':')).digest('hex');
 return '<!-- hyperfide-finding:'+findingId+':'+signature+' -->';
}
export class GitHubClient {
 readonly base:URL;readonly token:string;
 constructor(readonly env:Readonly<NodeJS.ProcessEnv>){
  if(env.HF_GITHUB_REQUESTS_APPROVED!=='true')fail('EXTERNAL_ACTION_NOT_APPROVED','GitHub network actions require explicit deployment approval');
  try{this.base=new URL(env.HF_GITHUB_API_URL??'https://api.github.com/');}catch{fail('GITHUB_CONFIG_INVALID','GitHub endpoint is invalid');}
  const loopback=['127.0.0.1','[::1]','localhost'].includes(this.base.hostname)&&env.HF_GITHUB_ALLOW_LOOPBACK==='true';
  const hosts=(env.HF_GITHUB_ALLOWED_HOSTS??'api.github.com').split(',');
  if(this.base.username||this.base.password||this.base.search||this.base.hash||!this.base.pathname.endsWith('/')||!(loopback&&this.base.protocol==='http:'||this.base.protocol==='https:'&&hosts.includes(this.base.hostname)))fail('GITHUB_CONFIG_INVALID','GitHub endpoint must be an explicitly permitted HTTPS origin');
  this.token=text(env.HF_GITHUB_TOKEN,'GitHub scoped credential',16384);
 }
 async request(method:string,relative:string,payload?:unknown):Promise<{data:unknown;link:string|null}>{
  const url=new URL(relative,this.base);if(url.origin!==this.base.origin||!url.pathname.startsWith(this.base.pathname))throw new GitHubFailure('GITHUB_UNSAFE_PAGINATION');
  let response:Response;
  try{response=await fetch(url,{method,redirect:'error',headers:{accept:'application/vnd.github+json',authorization:'Bearer '+this.token,'x-github-api-version':'2022-11-28',...(payload===undefined?{}:{'content-type':'application/json'})},...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:AbortSignal.timeout(10000)});}catch{throw new GitHubFailure('GITHUB_UNAVAILABLE',method!=='GET');}
  if(response.status===429||response.status===403&&response.headers.get('x-ratelimit-remaining')==='0'){await response.body?.cancel();throw new GitHubFailure('GITHUB_RATE_LIMITED',method!=='GET');}
  if(!response.ok){await response.body?.cancel();throw new GitHubFailure('GITHUB_HTTP_'+response.status,method!=='GET'&&response.status>=500);}
  const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  try{if(reader)for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.length;if(bytes>1048576){await reader.cancel();throw new GitHubFailure('GITHUB_RESPONSE_TOO_LARGE',method!=='GET');}chunks.push(next.value);}}
  catch(error){if(error instanceof GitHubFailure)throw error;throw new GitHubFailure('GITHUB_UNAVAILABLE',method!=='GET');}
  try{return {data:JSON.parse(Buffer.concat(chunks).toString('utf8')),link:response.headers.get('link')};}catch{throw new GitHubFailure('GITHUB_INVALID_RESPONSE',method!=='GET');}
 }
 async issues(owner:string,name:string,since:string):Promise<Issue[]>{
  let next='repos/'+encodeURIComponent(owner)+'/'+encodeURIComponent(name)+'/issues?state=all&sort=updated&direction=asc&per_page=100&since='+encodeURIComponent(since);const seen=new Set<string>(),result:Issue[]=[];
  for(let page=0;next;page++){
   if(page>=50||seen.has(next))throw new GitHubFailure('GITHUB_PAGINATION_INCOMPLETE');seen.add(next);
   const response=await this.request('GET',next);if(!Array.isArray(response.data))throw new GitHubFailure('GITHUB_INVALID_RESPONSE');
   for(const value of response.data){const parsed=issue(value);if(!parsed.pull_request)result.push(parsed);}
   next='';if(response.link){const match=response.link.match(/<([^>]+)>;\s*rel="next"/);if(match)next=match[1]!;}
  }
  return result;
 }
}
async function enqueue(value:FindingTransaction,input:unknown):Promise<Record<string,unknown>>{
 const p=record(input);fields(p,['finding_id','request_id','owner','repository','title','body','kind']);
 const id=uuid(p.finding_id),requestId=uuid(p.request_id),f=await finding(value.tx,value.scope,id,true);await manager(value,String(f.owner_package_id));
 const owner=repository(p.owner),name=repository(p.repository),title=text(p.title,'public issue title',256),body=text(p.body,'reviewed public issue body',48000);
 if(!['CREATE','UPDATE'].includes(String(p.kind))||body.includes('hyperfide-finding:'))fail('INVALID_REQUEST','Invalid projection kind or reserved marker in public text');
 const payload={title,body:body+'\n\n'+marker(value.context.env,value.scope,id,String(f.repository_id))},packet=digest({...p,payload});
 await value.tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[value.scope.organisation_id+':'+value.scope.run_id+':github-enqueue:'+requestId]);
 const previous=await value.tx.query('SELECT id,payload_digest,state FROM hyperfide.finding_github_operations WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3',[value.scope.organisation_id,value.scope.run_id,requestId]);
 if(previous.rows.length){if(previous.rows[0]!.payload_digest!==packet)fail('IDEMPOTENCY_CONFLICT','GitHub operation identity was reused with different public intent');return {operation_id:previous.rows[0]!.id,state:previous.rows[0]!.state,replayed:true};}
 // Canonical findings have one creation intent; a different request cannot race another POST.
 if(p.kind==='CREATE'){const prior=await value.tx.query('SELECT 1 FROM hyperfide.finding_github_operations WHERE organisation_id=$1 AND run_id=$2 AND finding_id=$3 AND kind=\'CREATE\' UNION ALL SELECT 1 FROM hyperfide.finding_github_mappings WHERE organisation_id=$1 AND run_id=$2 AND finding_id=$3',[value.scope.organisation_id,value.scope.run_id,id]);if(prior.rows.length)fail('GITHUB_CREATE_ALREADY_REGISTERED','Canonical finding already has a creation operation or mapping');}
 const created=await value.tx.query('INSERT INTO hyperfide.finding_github_operations(organisation_id,run_id,finding_id,request_id,payload_digest,repository_id,owner_name,repository_name,kind,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING id',[value.scope.organisation_id,value.scope.run_id,id,requestId,packet,f.repository_id,owner,name,p.kind,JSON.stringify(payload)]);
 return {operation_id:created.rows[0]!.id,state:'PENDING',replayed:false};
}
async function saveIssue(value:FindingTransaction,repositoryId:string,owner:string,name:string,external:Issue):Promise<Record<string,unknown>>{
 const {tx,scope}=value;const matches=[...external.body.matchAll(/<!-- hyperfide-finding:([0-9a-f-]{36}):([0-9a-f]{64}) -->/g)];let findingId:string|undefined;
 for(const match of matches){const candidate=uuid(match[1]);if(match[0]===marker(value.context.env,scope,candidate,repositoryId)){if(findingId&&findingId!==candidate)fail('GITHUB_AMBIGUOUS_MARKER','Issue contains multiple canonical finding identities');findingId=candidate;}}
 if(findingId){
  const f=await finding(tx,scope,findingId);if(f.repository_id!==repositoryId)fail('SCOPE_MISMATCH','External marker belongs to another repository');
  const current=await tx.query('SELECT issue_number,external_updated_at,external_payload_digest FROM hyperfide.finding_github_mappings WHERE organisation_id=$1 AND run_id=$2 AND finding_id=$3 FOR UPDATE',[scope.organisation_id,scope.run_id,findingId]);
  const payloadDigest=digest(external);
  if(current.rows.length){
   if(String(current.rows[0]!.issue_number)!==String(external.number))fail('GITHUB_AMBIGUOUS_MAPPING','More than one external issue carries the canonical marker');
   const previous=Date.parse(current.rows[0]!.external_updated_at),incoming=Date.parse(external.updated_at);
   if(incoming<previous)return {finding_id:findingId,ignored_stale:true};
   if(incoming===previous&&current.rows[0]!.external_payload_digest!==payloadDigest)fail('GITHUB_ORDER_UNCERTAIN','Equal-timestamp conflicting events require reconciliation');
  }
  await tx.query('INSERT INTO hyperfide.finding_github_mappings(organisation_id,run_id,finding_id,repository_id,owner_name,repository_name,issue_number,external_updated_at,external_state,external_payload_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(organisation_id,run_id,finding_id) DO UPDATE SET external_updated_at=EXCLUDED.external_updated_at,external_state=EXCLUDED.external_state,external_payload_digest=EXCLUDED.external_payload_digest',[scope.organisation_id,scope.run_id,findingId,repositoryId,owner,name,external.number,external.updated_at,external.state,payloadDigest]);
  // External closed state is descriptive. It never changes internal finding resolution.
  return {finding_id:findingId,issue_number:external.number,external_state:external.state};
 }
 await tx.query('INSERT INTO hyperfide.finding_external_intake(organisation_id,run_id,repository_id,issue_number,external_updated_at,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(organisation_id,run_id,repository_id,issue_number) DO UPDATE SET external_updated_at=EXCLUDED.external_updated_at,payload=EXCLUDED.payload WHERE finding_external_intake.external_updated_at<EXCLUDED.external_updated_at',[scope.organisation_id,scope.run_id,repositoryId,external.number,external.updated_at,JSON.stringify(external)]);
 return {intake:true,issue_number:external.number};
}
async function dispatch(context:ComponentContext,input:unknown):Promise<Record<string,unknown>>{
 const p=record(input);fields(p,['operation_id']);const id=uuid(p.operation_id),client=new GitHubClient(context.env);
 const claimed=await withFindingTransaction<Record<string,any>>(context,'finding.github.dispatch',async value=>{
  await admin(value);const rows=await value.tx.query('SELECT *,lease_expires_at>clock_timestamp() AS live,next_attempt_at<=clock_timestamp() AS ready FROM hyperfide.finding_github_operations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[value.scope.organisation_id,value.scope.run_id,id]);
  if(rows.rows.length!==1)fail('OPERATION_NOT_FOUND','GitHub operation does not exist in this run');const op=rows.rows[0]!;
  if(op.state==='ACKNOWLEDGED')return {...op,done:true};if(op.state==='FAILED')fail('OPERATION_FAILED','Failed operation requires explicit review');if(['PENDING','UNKNOWN'].includes(op.state)&&!op.ready)fail('OPERATION_NOT_DUE','Durable retry backoff has not elapsed');if(op.state==='IN_FLIGHT'&&op.live)fail('OPERATION_BUSY','GitHub operation is held by another live dispatch');
  const earlier=await value.tx.query('SELECT 1 FROM hyperfide.finding_github_operations WHERE organisation_id=$1 AND run_id=$2 AND finding_id=$3 AND operation_sequence<$4 AND state<>\'ACKNOWLEDGED\' LIMIT 1',[value.scope.organisation_id,value.scope.run_id,op.finding_id,String(op.operation_sequence)]);if(earlier.rows.length)fail('OPERATION_ORDER_BLOCKED','Earlier public intent must be independently acknowledged before another dispatch');
  const unknown=op.state==='UNKNOWN'||op.state==='IN_FLIGHT';
  const updated=await value.tx.query('UPDATE hyperfide.finding_github_operations SET state=\'IN_FLIGHT\',generation=generation+1,lease_owner=$4,lease_expires_at=clock_timestamp()+interval \'60 seconds\',attempt_count=attempt_count+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 RETURNING generation::text',[value.scope.organisation_id,value.scope.run_id,id,value.principal.actor_id]);
  return {...op,scope:value.scope,unknown,generation:updated.rows[0]!.generation};
 });
 if(claimed.done)return {operation_id:id,state:'ACKNOWLEDGED',replayed:true};
 let found:Issue|undefined,failure:string|undefined,uncertain=claimed.unknown;
 try{
  const list=await client.issues(claimed.owner_name,claimed.repository_name,new Date(Date.parse(claimed.created_at)-300000).toISOString());
  const expected=marker(context.env,claimed.scope,claimed.finding_id,claimed.repository_id),matching=list.filter(row=>row.body.includes(expected));
  if(matching.length>1)throw new GitHubFailure('GITHUB_AMBIGUOUS_MAPPING',true);found=matching[0];
  if(claimed.kind==='CREATE'){
   if(!found&&!claimed.unknown){uncertain=true;found=issue((await client.request('POST','repos/'+claimed.owner_name+'/'+claimed.repository_name+'/issues',claimed.payload)).data);}
   if(!found){failure='GITHUB_CREATE_OUTCOME_UNKNOWN';uncertain=true;}
  }else{
   if(!found)throw new GitHubFailure('GITHUB_MAPPING_NOT_FOUND',true);
   if(claimed.unknown){if(found.title!==claimed.payload.title||found.body!==claimed.payload.body){failure='GITHUB_UPDATE_OUTCOME_UNKNOWN';uncertain=true;}}
   else {uncertain=true;found=issue((await client.request('PATCH','repos/'+claimed.owner_name+'/'+claimed.repository_name+'/issues/'+found.number,claimed.payload)).data);}
  }
  if(found&&(found.title!==claimed.payload.title||found.body!==claimed.payload.body)){failure='GITHUB_PUBLIC_INTENT_DIFFERENT';uncertain=true;}
 }catch(error){failure=error instanceof GitHubFailure?error.code:'GITHUB_UNAVAILABLE';uncertain=uncertain||error instanceof GitHubFailure&&error.uncertain;}
 return withFindingTransaction(context,'finding.github.dispatch',async value=>{
  await admin(value);const locked=await value.tx.query('SELECT *,lease_expires_at>clock_timestamp() AS lease_live FROM hyperfide.finding_github_operations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[value.scope.organisation_id,value.scope.run_id,id]);const current=locked.rows[0];
  if(!current||String(current.generation)!==claimed.generation||current.lease_owner!==value.principal.actor_id||current.state!=='IN_FLIGHT'||!current.lease_live)fail('STALE_OPERATION','Remote result belongs to a superseded dispatch generation');
  if(!failure&&found)await saveIssue(value,current.repository_id,current.owner_name,current.repository_name,found);
  const state=!failure&&found?'ACKNOWLEDGED':uncertain?'UNKNOWN':'PENDING';
  await value.tx.query('UPDATE hyperfide.finding_github_operations SET state=$4,issue_number=$5,last_error_code=$6,lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=clock_timestamp()+interval \'60 seconds\' WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[value.scope.organisation_id,value.scope.run_id,id,state,found?.number??null,failure??null]);
  return {operation_id:id,state,issue_number:found?.number??null,error_code:failure??null};
 });
}
async function webhook(value:FindingTransaction,input:unknown):Promise<Record<string,unknown>>{
 const p=record(input);fields(p,['delivery_id','event_type','signature','raw_body_base64']);
 const delivery=text(p.delivery_id,'delivery identity',200),event=text(p.event_type,'GitHub event',64),encoded=text(p.raw_body_base64,'raw webhook body',1000000),secret=value.context.env.HF_GITHUB_WEBHOOK_SECRET;
 if(!secret||Buffer.byteLength(secret)<32||Buffer.byteLength(secret)>4096)fail('GITHUB_CONFIG_REQUIRED','A separate webhook authentication secret is required');
 if(!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)||encoded.length%4!==0)fail('INVALID_REQUEST','Webhook body must be canonical base64');
 const raw=Buffer.from(encoded,'base64');if(raw.toString('base64')!==encoded)fail('INVALID_REQUEST','Webhook body encoding is not canonical');
 const wanted=Buffer.from('sha256='+createHmac('sha256',secret).update(raw).digest('hex')),given=Buffer.from(typeof p.signature==='string'?p.signature:'');
 if(wanted.length!==given.length||!timingSafeEqual(wanted,given))fail('WEBHOOK_SIGNATURE_INVALID','Webhook signature was not accepted');
 let payload:unknown;try{payload=JSON.parse(raw.toString('utf8'));}catch{return fail('INVALID_REQUEST','Webhook body is invalid JSON');}
 const bodyDigest='sha256:'+createHash('sha256').update(raw).digest('hex');
 await value.tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[value.scope.organisation_id+':'+value.scope.run_id+':github-delivery:'+delivery]);
 const prior=await value.tx.query('SELECT body_digest,state FROM hyperfide.finding_github_deliveries WHERE organisation_id=$1 AND run_id=$2 AND delivery_id=$3 FOR UPDATE',[value.scope.organisation_id,value.scope.run_id,delivery]);
 if(prior.rows.length){if(prior.rows[0]!.body_digest!==bodyDigest)fail('DELIVERY_CONFLICT','Delivery identity was reused with different signed bytes');return {accepted:true,delivery_id:delivery,state:prior.rows[0]!.state,replayed:true};}
 await value.tx.query('INSERT INTO hyperfide.finding_github_deliveries(organisation_id,run_id,delivery_id,body_digest,event_type,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[value.scope.organisation_id,value.scope.run_id,delivery,bodyDigest,event,JSON.stringify(payload)]);
 return {accepted:true,delivery_id:delivery,state:'PENDING',replayed:false};
}
async function processDelivery(value:FindingTransaction,input:unknown):Promise<Record<string,unknown>>{
 const p=record(input);fields(p,['delivery_id','repository_id','owner','repository']);await admin(value);
 const delivery=text(p.delivery_id,'delivery identity',200),repoId=uuid(p.repository_id),owner=repository(p.owner),name=repository(p.repository);
 const rows=await value.tx.query('SELECT * FROM hyperfide.finding_github_deliveries WHERE organisation_id=$1 AND run_id=$2 AND delivery_id=$3 FOR UPDATE',[value.scope.organisation_id,value.scope.run_id,delivery]);
 if(rows.rows.length!==1)fail('DELIVERY_NOT_FOUND','Delivery was not received in this run');const row=rows.rows[0]!;if(row.state==='PROCESSED')return {processed:true,replayed:true};
 const payload=record(row.payload),externalRepo=record(payload.repository);
 if(externalRepo.full_name!==owner+'/'+name)fail('SCOPE_MISMATCH','Webhook repository does not match configured projection');
 if(row.event_type!=='issues')fail('UNSUPPORTED_EVENT','Only issue webhooks are registered for finding projection');
 const result=await saveIssue(value,repoId,owner,name,issue(payload.issue));
 await value.tx.query('UPDATE hyperfide.finding_github_deliveries SET state=\'PROCESSED\',processed_at=clock_timestamp(),error_code=NULL WHERE organisation_id=$1 AND run_id=$2 AND delivery_id=$3',[value.scope.organisation_id,value.scope.run_id,delivery]);
 return {processed:true,replayed:false,...result};
}
async function reconcile(context:ComponentContext,input:unknown):Promise<Record<string,unknown>>{
 const p=record(input);fields(p,['repository_id','owner','repository']);const repoId=uuid(p.repository_id),owner=repository(p.owner),name=repository(p.repository);
 const snapshot=await withFindingTransaction(context,'finding.github.reconcile',async value=>{
  await admin(value);const scoped=await value.tx.query('SELECT repository_id FROM hyperfide.run_repositories WHERE organisation_id=$1 AND run_id=$2 AND repository_id=$3 FOR SHARE',[value.scope.organisation_id,value.scope.run_id,repoId]);if(!scoped.rows.length)fail('SCOPE_MISMATCH','Repository does not belong to this run');
  await value.tx.query('INSERT INTO hyperfide.finding_github_checkpoints(organisation_id,run_id,repository_id,owner_name,repository_name) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[value.scope.organisation_id,value.scope.run_id,repoId,owner,name]);
  const rows=await value.tx.query('SELECT *,next_poll_at>clock_timestamp() AS deferred FROM hyperfide.finding_github_checkpoints WHERE organisation_id=$1 AND run_id=$2 AND repository_id=$3 FOR UPDATE',[value.scope.organisation_id,value.scope.run_id,repoId]);const row=rows.rows[0]!;if(row.owner_name!==owner||row.repository_name!==name)fail('SCOPE_MISMATCH','Repository projection identity is already pinned');return row;
 });
 if(snapshot.deferred)return {reconciled:false,reason:'NOT_DUE',next_poll_at:snapshot.next_poll_at};
 let external:Issue[];try{external=await new GitHubClient(context.env).issues(owner,name,new Date(Date.parse(snapshot.updated_since)-300000).toISOString());}catch(error){
  const code=error instanceof GitHubFailure?error.code:'GITHUB_UNAVAILABLE';await withFindingTransaction(context,'finding.github.reconcile',async value=>{await admin(value);await value.tx.query('UPDATE hyperfide.finding_github_checkpoints SET last_error_code=$4,next_poll_at=clock_timestamp()+interval \'10 minutes\' WHERE organisation_id=$1 AND run_id=$2 AND repository_id=$3',[value.scope.organisation_id,value.scope.run_id,repoId,code]);return null;});return {reconciled:false,error_code:code};
 }
 return withFindingTransaction(context,'finding.github.reconcile',async value=>{
  await admin(value);await value.tx.query('SELECT repository_id FROM hyperfide.finding_github_checkpoints WHERE organisation_id=$1 AND run_id=$2 AND repository_id=$3 FOR UPDATE',[value.scope.organisation_id,value.scope.run_id,repoId]);
  let newest=Date.parse(snapshot.updated_since);for(const row of external){await saveIssue(value,repoId,owner,name,row);newest=Math.max(newest,Date.parse(row.updated_at));}
  await value.tx.query('UPDATE hyperfide.finding_github_checkpoints SET updated_since=GREATEST(updated_since,$4::timestamptz),last_success_at=clock_timestamp(),next_poll_at=clock_timestamp()+interval \'10 minutes\',last_error_code=NULL WHERE organisation_id=$1 AND run_id=$2 AND repository_id=$3',[value.scope.organisation_id,value.scope.run_id,repoId,new Date(newest).toISOString()]);return {reconciled:true,issues_observed:external.length,next_interval_seconds:600};
 });
}
export function createComponent(_context:ComponentContext):Component{return {apiVersion:1,actions:{
 'finding.github.enqueue':(input,context)=>withFindingTransaction(context,'finding.github.enqueue',value=>enqueue(value,input)),
 'finding.github.dispatch':(input,context)=>dispatch(context,input),
 'finding.github.webhook':(input,context)=>withFindingTransaction(context,'finding.github.webhook',value=>webhook(value,input)),
 'finding.github.process-delivery':(input,context)=>withFindingTransaction(context,'finding.github.process-delivery',value=>processDelivery(value,input)),
 'finding.github.due':(input,context)=>withFindingTransaction(context,'finding.github.due',async value=>{
  const p=record(input);fields(p,[],['limit']);await admin(value);const limit=p.limit===undefined?50:p.limit;if(typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('INVALID_REQUEST','Due inventory limit must be from 1 to 100');
  const parameters=[value.scope.organisation_id,value.scope.run_id,limit];
  const operations=await value.tx.query(`SELECT id AS operation_id FROM hyperfide.finding_github_operations WHERE organisation_id=$1 AND run_id=$2 AND ((state IN ('PENDING','UNKNOWN') AND next_attempt_at<=clock_timestamp()) OR (state='IN_FLIGHT' AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp()))) ORDER BY next_attempt_at,id LIMIT $3`,parameters);
  const checkpoints=await value.tx.query('SELECT repository_id,owner_name,repository_name FROM hyperfide.finding_github_checkpoints WHERE organisation_id=$1 AND run_id=$2 AND next_poll_at<=clock_timestamp() ORDER BY next_poll_at,repository_id LIMIT $3',parameters);
  const deliveries=await value.tx.query(`SELECT d.delivery_id,c.repository_id,c.owner_name,c.repository_name FROM hyperfide.finding_github_deliveries d JOIN hyperfide.finding_github_checkpoints c ON c.organisation_id=d.organisation_id AND c.run_id=d.run_id AND (d.payload#>>'{repository,full_name}')=c.owner_name||'/'||c.repository_name WHERE d.organisation_id=$1 AND d.run_id=$2 AND d.state='PENDING' ORDER BY d.received_at,d.delivery_id LIMIT $3`,parameters);
  return {operations:operations.rows,reconciliation:checkpoints.rows,deliveries:deliveries.rows,interval_seconds:600};
 }),
 'finding.github.status':(input,context)=>withFindingTransaction(context,'finding.github.status',async value=>{
  const p=record(input);fields(p,[],['operation_id','request_id','delivery_id','repository_id']);await admin(value);if(Object.keys(p).length>1)fail('INVALID_REQUEST','Status accepts at most one exact identity selector');const scope=[value.scope.organisation_id,value.scope.run_id];
  if(Object.hasOwn(p,'operation_id')||Object.hasOwn(p,'request_id')){const column=Object.hasOwn(p,'operation_id')?'id':'request_id',id=uuid(p.operation_id??p.request_id);const rows=await value.tx.query('SELECT id AS operation_id,request_id,state,generation::text,attempt_count::text,lease_owner,lease_expires_at,next_attempt_at,issue_number::text,last_error_code FROM hyperfide.finding_github_operations WHERE organisation_id=$1 AND run_id=$2 AND '+column+'=$3',[...scope,id]);return {kind:'operation',found:rows.rows.length===1,operation:rows.rows[0]??null};}
  if(Object.hasOwn(p,'delivery_id')){const id=text(p.delivery_id,'delivery identity',200);const rows=await value.tx.query('SELECT delivery_id,state,error_code,received_at,processed_at FROM hyperfide.finding_github_deliveries WHERE organisation_id=$1 AND run_id=$2 AND delivery_id=$3',[...scope,id]);return {kind:'delivery',found:rows.rows.length===1,delivery:rows.rows[0]??null};}
  if(Object.hasOwn(p,'repository_id')){const id=uuid(p.repository_id);const rows=await value.tx.query('SELECT repository_id,owner_name,repository_name,updated_since,next_poll_at,last_success_at,last_error_code FROM hyperfide.finding_github_checkpoints WHERE organisation_id=$1 AND run_id=$2 AND repository_id=$3',[...scope,id]);return {kind:'checkpoint',found:rows.rows.length===1,checkpoint:rows.rows[0]??null};}
  const outbox=await value.tx.query('SELECT state,count(*)::text AS count FROM hyperfide.finding_github_operations WHERE organisation_id=$1 AND run_id=$2 GROUP BY state',scope);const inbox=await value.tx.query('SELECT state,count(*)::text AS count FROM hyperfide.finding_github_deliveries WHERE organisation_id=$1 AND run_id=$2 GROUP BY state',scope);const polls=await value.tx.query('SELECT repository_id,next_poll_at,last_success_at,last_error_code FROM hyperfide.finding_github_checkpoints WHERE organisation_id=$1 AND run_id=$2 ORDER BY repository_id LIMIT 101',scope);return {outbox:outbox.rows,inbox:inbox.rows,reconciliation:polls.rows.slice(0,100),checkpoints_truncated:polls.rows.length>100,baseline_interval_seconds:600};
 }),
 'finding.github.reconcile':(input,context)=>reconcile(context,input)
}};}
