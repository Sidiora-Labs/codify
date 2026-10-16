import {createHash,createHmac} from 'node:crypto';
import type pg from 'pg';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError} from '../policy/programme.js';
import {assertInvocation} from '../transport/protocol.js';
import type {InvocationContext} from '../transport/protocol.js';
import type {PrimaryTransaction,QuerySession} from '../storage/transactions.js';

const MAX_OBJECT=256*1024,MAX_MANIFEST=512*1024,MAX_CHUNKS=4096;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST=/^sha256:[0-9a-f]{64}$/;
const BACKEND='s3-v1';
export const ARTIFACT_ACTIONS=Object.freeze(['artifact.object.put','artifact.object.read','artifact.object.inspect','artifact.object.reconcile','artifact.manifest.commit','artifact.manifest.read','artifact.pending.list'] as const);
type Scope={organisation_id:string;run_id:string};
type Invocation={principal:{organisation_id:string;run_id:string;role:string};guard:(tx:QuerySession)=>Promise<void>;signal:AbortSignal};
type RequestContext=ComponentContext&{invocation?:Invocation};
type Retention={retention_class:string;retention_until:string|null;retention_hold:boolean};
type Artifact=Scope&Retention&{id:string;digest:string;size_bytes:string;storage_backend:string;storage_key:string;status:string;state_version:string;completed_at:Date|null};
type Chunk={sequence:number;artifact_id:string;digest:string;size_bytes:string;offset_bytes:string};
type Manifest=Scope&{schema_version:1;kind:'chunk-manifest';expected_chunks:number;total_size_bytes:string;content_digest:string;complete:true;truncated:false;missing_ranges:never[];chunks:Chunk[]};
type Config={endpoint:URL;region:string;bucket:string;access:string;secret:string;token:string|undefined;organisation:string;runs:ReadonlySet<string>};
type Observation={availability:'VERIFIED';bytes:Buffer}|{availability:'ABSENT'|'UNKNOWN'};
const hash=(bytes:Buffer|string)=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
function fail(code:string,message:string):never{throw new FoundationError(code,message);}
function fields(input:unknown,required:readonly string[],optional:readonly string[]=[]):Record<string,unknown>{
 if(!input||typeof input!=='object'||Array.isArray(input))fail('ARTIFACT_INPUT_INVALID','Expected an object');
 const value=input as Record<string,unknown>;
 if(required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>![...required,...optional].includes(key)))fail('ARTIFACT_INPUT_INVALID','Artifact fields do not match the operation');
 return value;
}
function uuid(value:unknown):string{if(typeof value!=='string'||!UUID.test(value))fail('ARTIFACT_INPUT_INVALID','Expected a canonical UUID');return value;}
function digest(value:unknown):string{if(typeof value!=='string'||!DIGEST.test(value))fail('ARTIFACT_INPUT_INVALID','Expected a SHA-256 digest');return value;}
function decimal(value:unknown,max=BigInt(MAX_OBJECT)):string{
 if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value)||value.length>24||BigInt(value)>max)fail('ARTIFACT_INPUT_INVALID','Invalid bounded byte quantity');
 return value;
}
const scopeKeys=['organisation_id','run_id'] as const;
const retentionKeys=['retention_class','retention_until','retention_hold'] as const;
function retention(value:Record<string,unknown>):Retention{
 if(typeof value.retention_class!=='string'||!['EPHEMERAL','RUN','RELEASE','LEGAL_HOLD'].includes(value.retention_class)||typeof value.retention_hold!=='boolean')fail('ARTIFACT_INPUT_INVALID','Invalid retention policy');
 const until=value.retention_until;
 if(until!==null&&(typeof until!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(until)||!Number.isFinite(Date.parse(until))||new Date(until).toISOString()!==until))fail('ARTIFACT_INPUT_INVALID','Invalid retention deadline');
 if(value.retention_class==='LEGAL_HOLD'&&!value.retention_hold)fail('ARTIFACT_INPUT_INVALID','Legal hold requires an active hold');
 return {retention_class:value.retention_class,retention_until:until as string|null,retention_hold:value.retention_hold};
}
function configuration(env:Readonly<NodeJS.ProcessEnv>):Config{
 try{
 const required=(name:string)=>{const value=env[name];if(!value||value.length>16384||/[\x00-\x1f\x7f]/.test(value))throw new Error();return value;};
 const endpoint=new URL(required('HF_ARTIFACT_S3_ENDPOINT'));
 if(endpoint.username||endpoint.password||endpoint.pathname!=='/'||endpoint.search||endpoint.hash)throw new Error();
 const loopback=['127.0.0.1','[::1]'].includes(endpoint.hostname);
 if(endpoint.protocol!=='https:'&&!(endpoint.protocol==='http:'&&loopback&&env.HF_ARTIFACT_ALLOW_LOOPBACK_HTTP==='1'))throw new Error();
 const region=required('HF_ARTIFACT_S3_REGION'),bucket=required('HF_ARTIFACT_S3_BUCKET');
 if(!/^[a-z0-9][a-z0-9-]{0,62}$/.test(region)||!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)||bucket.includes('..'))throw new Error();
 const organisation=uuid(required('HF_ARTIFACT_ORGANISATION_ID'));
 const runValues:unknown=JSON.parse(required('HF_ARTIFACT_ALLOWED_RUN_IDS'));
 if(!Array.isArray(runValues)||!runValues.length||runValues.length>10000)throw new Error();
 const runs=new Set(runValues.map(uuid));if(runs.size!==runValues.length)throw new Error();
 const token=env.HF_ARTIFACT_S3_SESSION_TOKEN;if(token!==undefined&&(!token||token.length>16384||/[\x00-\x1f\x7f]/.test(token)))throw new Error();
 return {endpoint,region,bucket,access:required('HF_ARTIFACT_S3_ACCESS_KEY_ID'),secret:required('HF_ARTIFACT_S3_SECRET_ACCESS_KEY'),token,organisation,runs};
 }catch{fail('ARTIFACT_CONFIG_INVALID','Trusted artifact backend configuration is invalid');}
}
function keyOf(scope:Scope,value:string,manifest=false):string{return 'hyperfide/v1/'+scope.organisation_id+'/'+scope.run_id+(manifest?'/manifests':'')+'/sha256/'+value.slice(7);}
function hmac(key:Buffer|string,value:string):Buffer{return createHmac('sha256',key).update(value).digest();}
function encode(value:string):string{return encodeURIComponent(value).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());}
/** Requests use a fixed trusted origin and never follow redirects with credentials. */
class S3 {
 constructor(private readonly config:Config,private readonly signal:AbortSignal){}
 private async request(method:'GET'|'PUT',key:string,body?:Buffer):Promise<Response>{
 const c=this.config,now=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),day=now.slice(0,8);
 const pathname='/'+encode(c.bucket)+'/'+key.split('/').map(encode).join('/');
 const url=new URL(pathname,c.endpoint),payload=createHash('sha256').update(body??Buffer.alloc(0)).digest('hex');
 const headers:Record<string,string>={'host':url.host,'x-amz-content-sha256':payload,'x-amz-date':now};
 if(c.token)headers['x-amz-security-token']=c.token;
 if(method==='PUT')headers['if-none-match']='*';
 const names=Object.keys(headers).sort(),canonicalHeaders=names.map(name=>name+':'+headers[name]!.trim()+'\n').join('');
 const canonical=[method,pathname,'',canonicalHeaders,names.join(';'),payload].join('\n');
 const credentialScope=day+'/'+c.region+'/s3/aws4_request';
 const toSign='AWS4-HMAC-SHA256\n'+now+'\n'+credentialScope+'\n'+createHash('sha256').update(canonical).digest('hex');
 const signing=hmac(hmac(hmac(hmac('AWS4'+c.secret,day),c.region),'s3'),'aws4_request');
 headers.authorization='AWS4-HMAC-SHA256 Credential='+c.access+'/'+credentialScope+', SignedHeaders='+names.join(';')+', Signature='+hmac(signing,toSign).toString('hex');
 return fetch(url,{method,headers,...(body===undefined?{}:{body:new Uint8Array(body)}),redirect:'manual',signal:AbortSignal.any([this.signal,AbortSignal.timeout(10000)])});
 }
 async put(key:string,bytes:Buffer):Promise<'ACKNOWLEDGED'|'EXISTS'|'UNKNOWN'>{
 try{
 const response=await this.request('PUT',key,bytes);await response.body?.cancel();
 if(response.status>=200&&response.status<300)return 'ACKNOWLEDGED';
 if(response.status===412)return 'EXISTS';
 if(response.status===409||response.status===429||response.status>=500)return 'UNKNOWN';
 fail('ARTIFACT_BACKEND_REJECTED','Object backend rejected the upload');
 }catch(error){if(error instanceof FoundationError)throw error;return 'UNKNOWN';}
 }
 async observe(key:string,expectedDigest:string,size:string):Promise<Observation>{
 const max=Number(size);
 if(!Number.isSafeInteger(max)||max<0||max>MAX_MANIFEST)fail('ARTIFACT_INTEGRITY','Stored object exceeds supported bounds');
 for(let attempt=0;attempt<2;attempt++){
 try{
 const response=await this.request('GET',key);
 if(response.status===404){await response.body?.cancel();return {availability:'ABSENT'};}
 if(response.status===429||response.status>=500){await response.body?.cancel();if(attempt===0)continue;return {availability:'UNKNOWN'};}
 if(response.status!==200){await response.body?.cancel();fail('ARTIFACT_BACKEND_REJECTED','Object backend rejected retrieval');}
 const length=response.headers.get('content-length');
 if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||BigInt(length)!==BigInt(size))){await response.body?.cancel();fail('ARTIFACT_INTEGRITY','Stored object length does not match');}
 if(!response.body)fail('ARTIFACT_INTEGRITY','Object response has no body');
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let received=0;
 try{for(;;){const next=await reader.read();if(next.done)break;received+=next.value.length;if(received>max){await reader.cancel();fail('ARTIFACT_INTEGRITY','Stored object exceeds declared length');}parts.push(next.value);}}
 finally{reader.releaseLock();}
 const bytes=Buffer.concat(parts);
 if(received!==max||hash(bytes)!==expectedDigest)fail('ARTIFACT_INTEGRITY','Stored object checksum or length does not match');
 return {availability:'VERIFIED',bytes};
 }catch(error){if(error instanceof FoundationError)throw error;if(attempt===1)return {availability:'UNKNOWN'};}
 }
 return {availability:'UNKNOWN'};
 }
}
const selected='organisation_id,run_id,id,digest,size_bytes::text,storage_backend,storage_key,status,retention_class,retention_until,retention_hold,state_version::text,completed_at';
function iso(value:Date|string|null):string|null{return value===null?null:new Date(value).toISOString();}
function publicArtifact(row:Artifact):unknown{return {artifact_id:row.id,organisation_id:row.organisation_id,run_id:row.run_id,digest:row.digest,size_bytes:row.size_bytes,storage_backend:row.storage_backend,storage_key:row.storage_key,status:row.status,retention_class:row.retention_class,retention_until:iso(row.retention_until),retention_hold:row.retention_hold,state_version:row.state_version};}
function receipt(row:Artifact):unknown{
 if(row.status!=='COMPLETE'||!row.completed_at)return null;
 const binding={schema_version:1,organisation_id:row.organisation_id,run_id:row.run_id,artifact_id:row.id,digest:row.digest,size_bytes:row.size_bytes,storage_backend:row.storage_backend,storage_key:row.storage_key,completed_at:iso(row.completed_at)};
 return {...binding,receipt_id:hash(JSON.stringify(binding))};
}
function envelope(row:Artifact,availability:'VERIFIED'|'ABSENT'|'UNKNOWN',extra:Record<string,unknown>={}):Record<string,unknown>{
 return {outcome:availability==='VERIFIED'&&row.status==='COMPLETE'?'SUCCEEDED':'UNKNOWN',availability,artifact:publicArtifact(row),receipt:availability==='VERIFIED'?receipt(row):null,authority:'NONE',live_qualification:'NOT_EVALUATED',...extra};
}
export class ArtifactStore{
 private configValue:Config|undefined;
 constructor(private readonly context:RequestContext){}
 private config():Config{return this.configValue??=configuration(this.context.env);}
 private scope(value:Record<string,unknown>):Scope{
 const scope={organisation_id:uuid(value.organisation_id),run_id:uuid(value.run_id)},config=this.config();
 if(scope.organisation_id!==config.organisation||!config.runs.has(scope.run_id))fail('ARTIFACT_SCOPE_DENIED','Artifact scope is not permitted');
 const invocation=this.context.invocation;
 if(invocation){
 if(typeof invocation.guard!=='function'||!invocation.principal||invocation.principal.organisation_id!==scope.organisation_id||invocation.principal.run_id!==scope.run_id)fail('ARTIFACT_SCOPE_DENIED','Verified caller scope differs from artifact scope');
 if(invocation.signal.aborted)fail('AUTH_REQUIRED','Artifact caller authority is no longer active');
 }else fail('AUTH_REQUIRED','Artifact operation requires verified caller authority');
 return scope;
 }
 private backend():S3{return new S3(this.config(),AbortSignal.any([this.context.signal,this.context.invocation?.signal??this.context.signal]));}
 private async transaction<T>(operation:(client:PrimaryTransaction)=>Promise<T>):Promise<T>{
 const invocation=this.context.invocation;
 if(!invocation)fail('AUTH_REQUIRED','Artifact operation requires verified caller authority');
 return this.context.resources.gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:2,signal:invocation.signal,guard:tx=>invocation.guard(tx)},async tx=>{
 const result=await operation(tx);
 await invocation.guard(tx);
 return result;
 });
 }
 private async load(scope:Scope,id:string,client?:QuerySession):Promise<Artifact>{
 if(!client)return this.transaction(tx=>this.load(scope,id,tx));
 const result=await client.query<Artifact>('SELECT '+selected+' FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[scope.organisation_id,scope.run_id,id]);
 const row=result.rows[0];if(!row)fail('ARTIFACT_NOT_FOUND','Artifact is not registered in this scope');
 if(row.storage_backend!==BACKEND||(row.storage_key!==keyOf(scope,row.digest)&&row.storage_key!==keyOf(scope,row.digest,true)))fail('ARTIFACT_BINDING_CONFLICT','Artifact backend binding differs');
 return row;
 }
 private same(row:Artifact,size:string,policy:Retention,manifest:boolean):void{
 if(row.size_bytes!==size||row.storage_backend!==BACKEND||row.storage_key!==keyOf(row,row.digest,manifest)||row.retention_class!==policy.retention_class||iso(row.retention_until)!==policy.retention_until||row.retention_hold!==policy.retention_hold)fail('ARTIFACT_BINDING_CONFLICT','Immutable artifact registration differs');
 if(!['PENDING','COMPLETE'].includes(row.status))fail('ARTIFACT_NOT_COMPLETE','Artifact is unavailable');
 }
 private async intent(scope:Scope,value:string,size:string,policy:Retention,manifest:boolean):Promise<{row:Artifact;created:boolean}>{
 return this.transaction(async client=>{
 const result=await client.query<Artifact>('INSERT INTO hyperfide.artifacts(organisation_id,run_id,digest,size_bytes,storage_backend,storage_key,retention_class,retention_until,retention_hold) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(organisation_id,run_id,digest) DO NOTHING RETURNING '+selected,[scope.organisation_id,scope.run_id,value,size,BACKEND,keyOf(scope,value,manifest),policy.retention_class,policy.retention_until,policy.retention_hold]);
 const created=!!result.rows[0];
 const row=result.rows[0]??(await client.query<Artifact>('SELECT '+selected+' FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND digest=$3',[scope.organisation_id,scope.run_id,value])).rows[0];
 if(!row)fail('ARTIFACT_DATABASE_UNAVAILABLE','Artifact upload intent could not be established');
 this.same(row,size,policy,manifest);return {row,created};
 });
 }
 private async complete(row:Artifact,client?:PrimaryTransaction):Promise<Artifact>{
 if(!client)return this.transaction(tx=>this.complete(row,tx));
 const result=await client.query<Artifact>("UPDATE hyperfide.artifacts SET status='COMPLETE',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND status='PENDING' RETURNING "+selected,[row.organisation_id,row.run_id,row.id]);
 const actual=result.rows[0]??await this.load(row,row.id,client);
 if(actual.status!=='COMPLETE')fail('ARTIFACT_NOT_COMPLETE','Artifact cannot become complete');
 return actual;
 }
 private async store(scope:Scope,bytes:Buffer,policy:Retention,manifest=false):Promise<{row:Artifact;observation:Observation}>{
 const value=hash(bytes),pending=await this.intent(scope,value,String(bytes.length),policy,manifest),backend=this.backend();
 // Existing/uncertain uploads are inspected first. Only a confirmed absence permits a conditional same-key upload.
 let observation:Observation= pending.created?{availability:'ABSENT'}:await backend.observe(pending.row.storage_key,value,String(bytes.length));
 if(observation.availability==='ABSENT'){
 if(pending.row.status==='COMPLETE')fail('ARTIFACT_INTEGRITY','A registered complete object is missing');
 await backend.put(pending.row.storage_key,bytes);
 observation=await backend.observe(pending.row.storage_key,value,String(bytes.length));
 }
 if(observation.availability==='VERIFIED'&&!manifest)pending.row=await this.complete(pending.row);
 return {row:pending.row,observation};
 }
 private async put(input:unknown):Promise<unknown>{
 const value=fields(input,[...scopeKeys,'digest','size_bytes','data_base64',...retentionKeys]),scope=this.scope(value),identity=digest(value.digest),size=decimal(value.size_bytes),policy=retention(value);
 if(typeof value.data_base64!=='string'||value.data_base64.length>Math.ceil(MAX_OBJECT/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data_base64))fail('ARTIFACT_INPUT_INVALID','Invalid canonical base64 object');
 const bytes=Buffer.from(value.data_base64,'base64');
 if(bytes.toString('base64')!==value.data_base64||String(bytes.length)!==size||hash(bytes)!==identity)fail('ARTIFACT_INTEGRITY','Upload bytes do not match identity and size');
 const result=await this.store(scope,bytes,policy);return envelope(result.row,result.observation.availability);
 }
 private async object(input:unknown,operation:'read'|'inspect'|'reconcile'|'manifest'):Promise<unknown>{
 const value=fields(input,[...scopeKeys,'artifact_id']),scope=this.scope(value),row=await this.load(scope,uuid(value.artifact_id));
 if(['QUARANTINED','DELETED'].includes(row.status))fail('ARTIFACT_NOT_COMPLETE','Artifact is unavailable');
 if(operation==='read'&&BigInt(row.size_bytes)>BigInt(MAX_OBJECT))fail('ARTIFACT_INPUT_INVALID','Use manifest retrieval for a large manifest');
 const observation=await this.backend().observe(row.storage_key,row.digest,row.size_bytes);
 if(observation.availability!=='VERIFIED')return envelope(row,observation.availability);
 // Manifest promotion requires validated child references; generic reconciliation cannot bypass them.
 let current=row;
 const edgeCount=await this.transaction(tx=>tx.query<{count:string}>('SELECT count(*)::text AS count FROM hyperfide.artifact_dependencies WHERE organisation_id=$1 AND run_id=$2 AND parent_artifact_id=$3',[scope.organisation_id,scope.run_id,row.id]));
 if(operation==='reconcile'&&row.status==='PENDING'){
 if(row.storage_key===keyOf(scope,row.digest,true)||edgeCount.rows[0]!.count!=='0')fail('ARTIFACT_NOT_COMPLETE','Resume manifest commit to validate chunk closure');
 current=await this.complete(row);
 }
 if(operation==='read'&&current.status!=='COMPLETE')fail('ARTIFACT_NOT_COMPLETE','Object is not complete');
 if(operation==='manifest'||row.storage_key===keyOf(scope,row.digest,true)){
 if(current.status!=='COMPLETE')fail('ARTIFACT_NOT_COMPLETE','Manifest is not complete');
 const parsed=this.parseManifestBytes(observation.bytes,scope);
 const edges=await this.edges(scope,current.id);
 this.sameEdges(parsed.chunks,edges);
 await this.verifyChunks(scope,parsed);
 return envelope(current,'VERIFIED',{manifest:parsed,manifest_digest:current.digest,content_digest:parsed.content_digest,chunk_count:parsed.chunks.length});
 }
 return envelope(current,'VERIFIED',operation==='read'?{data_base64:observation.bytes.toString('base64')}:{});
 }
 private parseManifest(value:Record<string,unknown>,scope:Scope):Manifest{
 if(value.complete!==true||value.truncated!==false||!Array.isArray(value.missing_ranges)||value.missing_ranges.length!==0||!Number.isInteger(value.expected_chunks)||Number(value.expected_chunks)<0||Number(value.expected_chunks)>MAX_CHUNKS||!Array.isArray(value.chunks)||value.chunks.length!==value.expected_chunks)fail('ARTIFACT_MANIFEST_INVALID','Manifest is not a complete bounded chunk sequence');
 const total=decimal(value.total_size_bytes,BigInt(MAX_CHUNKS)*BigInt(MAX_OBJECT)),contentDigest=digest(value.content_digest);
 let offset=0n;
 const chunks=value.chunks.map((raw,index)=>{
 const chunk=fields(raw,['sequence','artifact_id','digest','size_bytes','offset_bytes']);
 if(chunk.sequence!==index)fail('ARTIFACT_MANIFEST_INVALID','Chunk sequence is not contiguous');
 const bytes=decimal(chunk.size_bytes),position=decimal(chunk.offset_bytes,BigInt(MAX_CHUNKS)*BigInt(MAX_OBJECT));
 if(BigInt(position)!==offset)fail('ARTIFACT_MANIFEST_INVALID','Chunk offsets are not contiguous');
 offset+=BigInt(bytes);
 return {sequence:index,artifact_id:uuid(chunk.artifact_id),digest:digest(chunk.digest),size_bytes:bytes,offset_bytes:position};
 });
 if(String(offset)!==total)fail('ARTIFACT_MANIFEST_INVALID','Manifest total differs from chunk sizes');
 return {schema_version:1,kind:'chunk-manifest',...scope,expected_chunks:chunks.length,total_size_bytes:total,content_digest:contentDigest,complete:true,truncated:false,missing_ranges:[],chunks};
 }
 private parseManifestBytes(bytes:Buffer,scope:Scope):Manifest{
 let raw:unknown;try{raw=JSON.parse(bytes.toString('utf8'));}catch{fail('ARTIFACT_MANIFEST_INVALID','Object is not a manifest');}
 const value=fields(raw,[...scopeKeys,'schema_version','kind','expected_chunks','total_size_bytes','content_digest','complete','truncated','missing_ranges','chunks']);
 if(value.schema_version!==1||value.kind!=='chunk-manifest'||value.organisation_id!==scope.organisation_id||value.run_id!==scope.run_id)fail('ARTIFACT_MANIFEST_INVALID','Manifest identity differs');
 const manifest=this.parseManifest(value,scope);
 if(JSON.stringify(manifest)!==bytes.toString('utf8'))fail('ARTIFACT_MANIFEST_INVALID','Manifest is not canonical');
 return manifest;
 }
 private async verifyChunks(scope:Scope,manifest:Manifest):Promise<void>{
 const hasher=createHash('sha256');
 for(const chunk of manifest.chunks){
 const row=await this.load(scope,chunk.artifact_id);
 if(row.status!=='COMPLETE'||row.digest!==chunk.digest||row.size_bytes!==chunk.size_bytes)fail('ARTIFACT_MANIFEST_INVALID','Referenced chunk is not complete or differs');
 const observed=await this.backend().observe(row.storage_key,row.digest,row.size_bytes);
 if(observed.availability!=='VERIFIED')fail('ARTIFACT_NOT_COMPLETE','Referenced chunk is unavailable');
 hasher.update(observed.bytes);
 }
 if('sha256:'+hasher.digest('hex')!==manifest.content_digest)fail('ARTIFACT_INTEGRITY','Concatenated content checksum differs');
 }
 private async edges(scope:Scope,parent:string,client?:QuerySession):Promise<Chunk[]>{
 if(!client)return this.transaction(tx=>this.edges(scope,parent,tx));
 const result=await client.query<{sequence:number;child_artifact_id:string;offset_bytes:string;size_bytes:string;digest:string}>('SELECT d.sequence,d.child_artifact_id,d.offset_bytes::text,d.size_bytes::text,a.digest FROM hyperfide.artifact_dependencies d JOIN hyperfide.artifacts a ON a.organisation_id=d.organisation_id AND a.run_id=d.run_id AND a.id=d.child_artifact_id WHERE d.organisation_id=$1 AND d.run_id=$2 AND d.parent_artifact_id=$3 ORDER BY d.sequence',[scope.organisation_id,scope.run_id,parent]);
 return result.rows.map(row=>({sequence:row.sequence,artifact_id:row.child_artifact_id,digest:row.digest,size_bytes:row.size_bytes,offset_bytes:row.offset_bytes}));
 }
 private sameEdges(chunks:Chunk[],edges:Chunk[]):void{if(JSON.stringify(chunks)!==JSON.stringify(edges))fail('ARTIFACT_BINDING_CONFLICT','Manifest dependency closure differs');}
 private async commit(input:unknown):Promise<unknown>{
 const value=fields(input,[...scopeKeys,'expected_chunks','total_size_bytes','content_digest','complete','truncated','missing_ranges','chunks',...retentionKeys]),scope=this.scope(value),policy=retention(value),manifest=this.parseManifest(value,scope);
 const bytes=Buffer.from(JSON.stringify(manifest));
 if(bytes.length>MAX_MANIFEST)fail('ARTIFACT_MANIFEST_INVALID','Manifest exceeds transport bounds');
 await this.verifyChunks(scope,manifest);
 const stored=await this.store(scope,bytes,policy,true);
 if(stored.observation.availability!=='VERIFIED')return envelope(stored.row,stored.observation.availability);
 let row=stored.row;
 row=await this.transaction(async client=>{
 const ids=[row.id,...manifest.chunks.map(chunk=>chunk.artifact_id)].sort();
 await client.query('SELECT id FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR UPDATE',[scope.organisation_id,scope.run_id,ids]);
 row=await this.load(scope,row.id,client);
 const existing=await this.edges(scope,row.id,client);
 if(row.status==='COMPLETE')this.sameEdges(manifest.chunks,existing);
 else if(row.status==='PENDING'){
 if(existing.length)this.sameEdges(manifest.chunks,existing);
 else for(const chunk of manifest.chunks)await client.query('INSERT INTO hyperfide.artifact_dependencies(organisation_id,run_id,parent_artifact_id,child_artifact_id,sequence,offset_bytes,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7)',[scope.organisation_id,scope.run_id,row.id,chunk.artifact_id,chunk.sequence,chunk.offset_bytes,chunk.size_bytes]);
 for(const chunk of manifest.chunks){const child=await this.load(scope,chunk.artifact_id,client);if(child.status!=='COMPLETE'||child.digest!==chunk.digest||child.size_bytes!==chunk.size_bytes)fail('ARTIFACT_NOT_COMPLETE','A chunk changed before manifest completion');}
 row=await this.complete(row,client);
 }else fail('ARTIFACT_NOT_COMPLETE','Manifest is unavailable');
 return row;
 });
 return envelope(row,'VERIFIED',{manifest_digest:row.digest,content_digest:manifest.content_digest,chunk_count:manifest.chunks.length});
 }
 private async pending(input:unknown):Promise<unknown>{
 const value=fields(input,scopeKeys,['limit','after_artifact_id']),scope=this.scope(value),limit=value.limit??100;
 if(typeof limit!=='number'||!Number.isInteger(limit)||limit<1||limit>1000)fail('ARTIFACT_INPUT_INVALID','Invalid inventory limit');
 const after=value.after_artifact_id===undefined?null:uuid(value.after_artifact_id);
 const rows=await this.transaction(tx=>tx.query<Artifact>("SELECT "+selected+" FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND status='PENDING' AND ($3::uuid IS NULL OR id>$3::uuid) ORDER BY id LIMIT $4",[scope.organisation_id,scope.run_id,after,limit+1]));
 return {artifacts:rows.rows.slice(0,limit).map(publicArtifact),next_cursor:rows.rows.length>limit?rows.rows[limit-1]!.id:null,destructive_action:false,authority:'NONE',live_qualification:'NOT_EVALUATED'};
 }
 async invoke(action:string,input:unknown,context?:ComponentContext|InvocationContext):Promise<unknown>{
 const actor=context?('principal' in context?context:context.invocation):this.context.invocation;
 assertInvocation(actor);
 if(actor!==this.context.invocation)return new ArtifactStore({...this.context,invocation:actor}).invoke(action,input);
 assertInvocation(this.context.invocation);
 if(this.context.signal.aborted)fail('ARTIFACT_NOT_COMPLETE','Artifact service is shutting down');
 try{
 const result=await (async()=>{switch(action){
 case 'artifact.object.put':return await this.put(input);
 case 'artifact.object.read':return await this.object(input,'read');
 case 'artifact.object.inspect':return await this.object(input,'inspect');
 case 'artifact.object.reconcile':return await this.object(input,'reconcile');
 case 'artifact.manifest.commit':return await this.commit(input);
 case 'artifact.manifest.read':return await this.object(input,'manifest');
 case 'artifact.pending.list':return await this.pending(input);
 default:fail('ARTIFACT_INPUT_INVALID','Unknown artifact operation');
 }})();
 if(this.context.invocation)await this.transaction(async()=>undefined);
 return result;
 }catch(error){if(error instanceof FoundationError)throw error;fail('ARTIFACT_DATABASE_UNAVAILABLE','Artifact metadata operation failed; reconcile before retry');}
 }
 close():void{/* Shared PostgreSQL pool lifecycle belongs to the storage resource owner. */}
}
export interface ArtifactStoreCapability{invoke(action:string,input:unknown,context:ComponentContext|InvocationContext):Promise<unknown>}
export function isArtifactStoreCapability(value:unknown):value is ArtifactStoreCapability{return !!value&&typeof value==='object'&&'invoke' in value&&typeof value.invoke==='function';}
export function createArtifactStore(context:ComponentContext):ArtifactStore{return new ArtifactStore(context);}
export function createComponent(context:ComponentContext):Component{
 const store=createArtifactStore(context),actions=Object.fromEntries(ARTIFACT_ACTIONS.map(action=>[action,(input:unknown,invocationContext:ComponentContext)=>store.invoke(action,input,invocationContext)]));
 return {apiVersion:1,actions,capabilities:{'artifact.store.v1':Object.freeze({invoke:(action:string,input:unknown,ctx:ComponentContext|InvocationContext)=>store.invoke(action,input,ctx)})},close:()=>store.close()};
}
