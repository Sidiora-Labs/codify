import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from '../policy/programme.js';
import {invocationOf} from '../identity/enrollment.js';
import {boundedText,canonical,contentDigest,digest,fields,invalid,inspectDocumentationClosure,sha256,stringList,uuid,persistReleaseArtifact,type RecordValue} from '../docs/closure.js';
import {loadReleaseContract,validateTraceability,type ReleaseContract} from './traceability.js';

export interface VerifiedReleaseEvidence{
 reference:string;receipt_digest:string;scope:'task-component'|'full-case'|'campaign';case_ids:string[];
 assertion_ids:string[];outcome:'PASS';full_case_status:string;implementation_revision:string;source_manifest_digest:string;
 gate_kinds:string[];resources:{id:string;state:'CLEANED'|'RETAINED';owner:string|null;expires_at:string|null;retention_authorised:boolean;observed_at:string}[];
}
export interface ReleaseInventory{
 schema_version:1;contract_digest:string;implementation_revision:string;source_manifest_digest:string;
 clause_evidence:{clause:string;task_ids:string[];case_ids:string[];evidence_refs:string[]}[];
 case_evidence:{case_id:string;evidence_ref:string}[];gate_evidence:{kind:string;evidence_refs:string[]}[];
 resource_ids:string[];unsupported_features:{feature:string;reason:string}[];
}
export const RELEASE_GATES=Object.freeze(['task','candidate','programme','policy','docs','restore','rollback','cleanup','traceability','checker_selftest']);
function exact(a:string[],b:string[]):boolean{return canonical([...a].sort())===canonical([...b].sort());}
function values(v:unknown,min=0,max=100000):unknown[]{if(!Array.isArray(v)||v.length<min||v.length>max)invalid('Invalid release inventory list');return v;}
function parse(value:unknown):ReleaseInventory{
 const p=fields(value,['schema_version','contract_digest','implementation_revision','source_manifest_digest','clause_evidence','case_evidence','gate_evidence','resource_ids','unsupported_features']);
 if(p.schema_version!==1)invalid('Unknown release inventory schema');
 const revision=boundedText(p.implementation_revision,64);if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision))invalid('Exact implementation Git revision required');
 const clauses=values(p.clause_evidence,1).map(v=>{const c=fields(v,['clause','task_ids','case_ids','evidence_refs']);return {clause:boundedText(c.clause),task_ids:stringList(c.task_ids),case_ids:stringList(c.case_ids),evidence_refs:stringList(c.evidence_refs)};});
 const cases=values(p.case_evidence,1).map(v=>{const c=fields(v,['case_id','evidence_ref']);return {case_id:boundedText(c.case_id),evidence_ref:boundedText(c.evidence_ref)};});
 const gates=values(p.gate_evidence,1).map(v=>{const g=fields(v,['kind','evidence_refs']);return {kind:boundedText(g.kind),evidence_refs:stringList(g.evidence_refs)};});
 const unsupported=values(p.unsupported_features).map(v=>{const x=fields(v,['feature','reason']);return {feature:boundedText(x.feature),reason:boundedText(x.reason,4096)};});
 return {schema_version:1,contract_digest:digest(p.contract_digest),implementation_revision:revision,source_manifest_digest:digest(p.source_manifest_digest),
 clause_evidence:clauses,case_evidence:cases,gate_evidence:gates,resource_ids:stringList(p.resource_ids,0),unsupported_features:unsupported};
}
export function validateReadinessInventory(contract:ReleaseContract,value:unknown,evidence:ReadonlyMap<string,VerifiedReleaseEvidence>):RecordValue{
 validateTraceability(contract);
 const inventory=parse(value),reasons:string[]=[];
 if(inventory.contract_digest!==contract.contract_digest)reasons.push('contract_revision_changed');
 const expectedCases=Object.keys(contract.cases),expectedClauses=contract.clauses;
 if(!exact(inventory.clause_evidence.map(x=>x.clause),expectedClauses))reasons.push('clause_inventory_incomplete_or_duplicate');
 if(!exact(inventory.case_evidence.map(x=>x.case_id),expectedCases))reasons.push('case_inventory_incomplete_or_duplicate');
 if(!exact(inventory.gate_evidence.map(x=>x.kind),[...RELEASE_GATES]))reasons.push('gate_inventory_incomplete_or_duplicate');
 const used=new Set<string>();
 const verified=(reference:string):VerifiedReleaseEvidence|null=>{
 used.add(reference);const e=evidence.get(reference);
 if(!e){reasons.push('missing_evidence:'+reference);return null;}
 if(e.reference!==reference||e.outcome!=='PASS'||e.implementation_revision!==inventory.implementation_revision||e.source_manifest_digest!==inventory.source_manifest_digest){reasons.push('stale_or_failed_evidence:'+reference);return null;}
 digest(e.receipt_digest);return e;
 };
 for(const selected of inventory.case_evidence){
 const expected=contract.cases[selected.case_id],e=verified(selected.evidence_ref);
 if(!expected){reasons.push('unknown_case:'+selected.case_id);continue;}
 if(!expected.full_assertion_ids.length){reasons.push('full_case_inventory_unregistered:'+selected.case_id);continue;}
 if(e&&(e.scope==='task-component'||e.full_case_status!=='PASS'||!e.case_ids.includes(selected.case_id)||expected.full_assertion_ids.some(a=>!e.assertion_ids.includes(a))))reasons.push('full_case_not_qualified:'+selected.case_id);
 }
 for(const clause of inventory.clause_evidence){
 const mapping=contract.mappings.find(m=>m.id===clause.clause);
 if(!mapping||!exact(mapping.task_ids,clause.task_ids)||!exact(mapping.acceptance_ids,clause.case_ids)){reasons.push('invalid_clause_mapping:'+clause.clause);continue;}
 const refs=clause.evidence_refs.map(verified).filter((e):e is VerifiedReleaseEvidence=>e!==null);
 if(mapping.acceptance_ids.some(c=>!refs.some(e=>e.scope!=='task-component'&&e.full_case_status==='PASS'&&e.case_ids.includes(c))))reasons.push('clause_evidence_incomplete:'+clause.clause);
 }
 for(const gate of inventory.gate_evidence){
 for(const reference of gate.evidence_refs){
 const e=verified(reference);if(!e)continue;
 if(!e.gate_kinds.includes(gate.kind))reasons.push('wrong_gate_evidence:'+gate.kind);
 if(!['checker_selftest','traceability'].includes(gate.kind)&&(e.scope==='task-component'||e.full_case_status!=='PASS'))reasons.push('gate_requires_full_qualification:'+gate.kind);
 }
 }
 const resources=new Map<string,VerifiedReleaseEvidence['resources'][number]>();
 for(const reference of used)for(const resource of evidence.get(reference)?.resources??[]){
 const old=resources.get(resource.id);
 if(old&&canonical(old)!==canonical(resource)&&Date.parse(old.observed_at)===Date.parse(resource.observed_at))reasons.push('contradictory_resource_state:'+resource.id);
 if(!Number.isFinite(Date.parse(resource.observed_at)))reasons.push('resource_observation_time_missing:'+resource.id);
 if(!old||Date.parse(resource.observed_at)>=Date.parse(old.observed_at))resources.set(resource.id,resource);
 }
 if(!exact(inventory.resource_ids,[...resources.keys()]))reasons.push('resource_inventory_incomplete');
 for(const r of resources.values())if(r.state!=='CLEANED'&&(r.state!=='RETAINED'||!r.retention_authorised||!r.owner||!r.expires_at||!Number.isFinite(Date.parse(r.expires_at))||Date.parse(r.expires_at)<=Date.now()))reasons.push('unexplained_or_expired_resource:'+r.id);
 if(new Set(inventory.unsupported_features.map(x=>x.feature)).size!==inventory.unsupported_features.length)reasons.push('duplicate_unsupported_feature');
 // An excluded feature cannot simultaneously be presented as a qualified clause or case.
 for(const x of inventory.unsupported_features)if(expectedClauses.includes(x.feature)||x.feature in contract.cases)reasons.push('unsupported_feature_claimed_as_supported:'+x.feature);
 return {complete:reasons.length===0,reasons:[...new Set(reasons)],contract_digest:contract.contract_digest,inventory_digest:contentDigest(inventory),
 clauses_checked:expectedClauses.length,cases_checked:expectedCases.length,gate_kinds:[...RELEASE_GATES],
 evidence_receipts:[...used].sort().map(r=>({reference:r,receipt_digest:evidence.get(r)?.receipt_digest??null})),
 checker_result_is_release_authority:false,seal_requires_self_digest:false};
}
interface CampaignReference{reference:string;evidence_root:string;campaign:string;receipt_id:string;receipt_digest:string;gate_kinds:string[]}
async function protectedReleaseFile(filename:string,maximum:number):Promise<Buffer>{
 if(!path.isAbsolute(filename)||path.normalize(filename)!==filename)invalid('Protected absolute release asset required');
 const owner=process.getuid?.()??0;let ancestor=path.dirname(filename);
 for(;;){const st=await fs.lstat(ancestor);const sticky=st.uid===0&&(st.mode&0o1000)!==0;
 if(!st.isDirectory()||st.isSymbolicLink()||(st.uid!==0&&st.uid!==owner)||((st.mode&0o022)!==0&&!sticky))invalid('Release asset ancestry is not protected');
 if(ancestor==='/')break;ancestor=path.dirname(ancestor);}
 const fd=await fs.open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const before=await fd.stat({bigint:true});if(!before.isFile()||(before.uid!==0n&&before.uid!==BigInt(owner))||(before.mode&0o022n)!==0n||before.nlink!==1n||before.size<1n||before.size>BigInt(maximum))invalid('Release asset is not a protected bounded regular file');
 const buffer=Buffer.alloc(maximum+1);let size=0;
 while(size<buffer.length){const read=await fd.read(buffer,size,buffer.length-size,null);if(!read.bytesRead)break;size+=read.bytesRead;}
 const after=await fd.stat({bigint:true});if(size>maximum||BigInt(size)!==before.size||['dev','ino','mode','uid','gid','nlink','size','mtimeNs','ctimeNs'].some(k=>before[k as keyof typeof before]!==after[k as keyof typeof after]))invalid('Release asset changed while reading');
 return buffer.subarray(0,size);}finally{await fd.close();}
}
const PORTABLE_RELEASE_CHECK=String.raw`
import fcntl, hashlib, importlib.util, json, os, pathlib, sys
assets, root, campaign = map(pathlib.Path, sys.argv[1:4])
receipt = sys.argv[4]
sys.path.insert(0, str(assets))
from proof_relocation import guard_staging
def require(ok, message):
    if not ok:
        raise ValueError(message)
guard_staging(root, require)
require(campaign.is_relative_to(root) and campaign.is_dir(), 'campaign outside private admission stage')
relocation = root / 'trusted-relocation.json'
require(relocation.is_file() and not relocation.is_symlink(), 'portable relocation policy required')
descriptor = os.open(root / '.inspection.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
try:
    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    guard_staging(root, require)
    spec = importlib.util.spec_from_file_location('qualified_release_inspector', assets / 'inspect-proof.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    checked, tool = module.canonical_check(campaign, receipt, relocation)
    require(checked.get('observed_outcome') == 'PASS', 'canonical proof is not PASS')
    print(json.dumps(checked, sort_keys=True))
finally:
    os.close(descriptor)
`;
/** Byte consistency only. The deployment owns both the admission stage and the
 * qualified assets; no request may choose executable code or grant release authority. */
export async function checkReleaseCampaign(evidenceRoot:string,campaign:string,receipt:string,context:Pick<ComponentContext,'env'|'signal'>):Promise<RecordValue>{
 uuid(receipt);
 if(!path.isAbsolute(evidenceRoot)||!path.isAbsolute(campaign)||path.resolve(evidenceRoot)!==evidenceRoot||path.resolve(campaign)!==campaign||await fs.realpath(evidenceRoot)!==evidenceRoot||await fs.realpath(campaign)!==campaign||!path.relative(evidenceRoot,campaign)||path.relative(evidenceRoot,campaign)==='..'||path.relative(evidenceRoot,campaign).startsWith('..'+path.sep)||path.isAbsolute(path.relative(evidenceRoot,campaign)))invalid('Invalid private release stage/campaign');
 const repository=path.resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
 const assets=context.env.HYPERFIDE_RELEASE_QUALIFIED_PROOF_ROOT??path.join(repository,'tests/hyperfide');
 if(!path.isAbsolute(assets)||await fs.realpath(assets)!==assets)invalid('Qualified proof assets must have an exact protected path');
 const pins=await Promise.all(['inspect-proof.py','check-evidence.py','proof_relocation.py','registry.json'].map(async name=>({name,bytes:await protectedReleaseFile(path.join(assets,name),1024*1024)})));
 const python=await fs.realpath(context.env.HYPERFIDE_RELEASE_PYTHON??'/usr/bin/python3');
 await protectedReleaseFile(python,64*1024*1024);
 const checked=await new Promise<RecordValue>((resolve,reject)=>execFile(python,['-I','-B','-c',PORTABLE_RELEASE_CHECK,assets,evidenceRoot,campaign,receipt],{timeout:150000,maxBuffer:1024*1024,signal:context.signal,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'}},(error,out)=>{
 if(error){reject(new FoundationError('RELEASE_EVIDENCE_INVALID','Canonical portable checker refused a release proof'));return;}
 try{const result=JSON.parse(out) as unknown;if(!object(result)||result.checked!==true||result.observed_outcome!=='PASS')invalid('Independent evidence outcome is not PASS');resolve(result);}catch{reject(new FoundationError('RELEASE_EVIDENCE_INVALID','Invalid independent checker result'));}
 }));
 for(const pin of pins)if(!(await protectedReleaseFile(path.join(assets,pin.name),1024*1024)).equals(pin.bytes))invalid('Qualified proof assets changed during inspection');
 return checked;
}
export async function loadReleaseAdmissionIndex(context:Pick<ComponentContext,'env'>,scope:{organisation_id:string;run_id:string}):Promise<CampaignReference[]>{
 const configured=context.env.HYPERFIDE_RELEASE_EVIDENCE_INDEX;
 if(!configured||!path.isAbsolute(configured))throw new FoundationError('RELEASE_EVIDENCE_UNAVAILABLE','Trusted scoped release evidence index is required');
 const raw=JSON.parse((await protectedReleaseFile(configured,16*1024*1024)).toString('utf8')) as unknown;
 const index=fields(raw,['schema_version','organisation_id','run_id','entries']);
 if(index.schema_version!==2||index.organisation_id!==scope.organisation_id||index.run_id!==scope.run_id)invalid('Release evidence scope mismatch');
 const entries=values(index.entries).map(v=>{const r=fields(v,['reference','evidence_root','campaign','receipt_id','receipt_digest','gate_kinds']);return {reference:boundedText(r.reference),evidence_root:boundedText(r.evidence_root,4096),campaign:boundedText(r.campaign,4096),receipt_id:uuid(r.receipt_id),receipt_digest:digest(r.receipt_digest),gate_kinds:stringList(r.gate_kinds,0)};});
 if(new Set(entries.map(e=>e.reference)).size!==entries.length)invalid('Duplicate trusted evidence reference');
 return entries;
}
async function trustedEvidence(context:ComponentContext,scope:{organisation_id:string;run_id:string},references:string[]):Promise<Map<string,VerifiedReleaseEvidence>>{
 // This index is trusted deployment input maintained after authoritative admission,
 // never a request field. The final seal additionally recomputes the live programme gate.
 const entries=await loadReleaseAdmissionIndex(context,scope);
 const result=new Map<string,VerifiedReleaseEvidence>();
 for(const reference of references){
 const entry=entries.find(e=>e.reference===reference);if(!entry)invalid('Evidence is not in the trusted admission index');
 if(!path.isAbsolute(entry.campaign)||await fs.realpath(entry.campaign)!==entry.campaign)invalid('Invalid immutable campaign root');
 const checked=await checkReleaseCampaign(entry.evidence_root,entry.campaign,entry.receipt_id,context);
 const receiptBytes=await fs.readFile(path.join(entry.campaign,'receipts',entry.receipt_id+'.json'));
 if(sha256(receiptBytes)!==entry.receipt_digest||checked.receipt_sha256!==entry.receipt_digest.slice(7))invalid('Anchored release receipt bytes changed');
 const receipt=JSON.parse(receiptBytes.toString('utf8')) as unknown;
 const manifest=pinnedCampaignManifest(receipt,await fs.readFile(path.join(entry.campaign,'manifest.json')));
 if(!object(receipt)||!object(receipt.source)||!object(manifest)||!object(manifest.policy)||!Array.isArray(receipt.assertions)||!object(receipt.cleanup))invalid('Incomplete canonical receipt source');
 const resources:VerifiedReleaseEvidence['resources']=[];
 if(Array.isArray(receipt.cleanup.resources))for(const value of receipt.cleanup.resources){
 if(!object(value)||typeof value.id!=='string')invalid('Incomplete release resource observation');
 resources.push({id:value.id,state:value.status==='deleted'?'CLEANED':'RETAINED',owner:typeof value.owner==='string'?value.owner:null,expires_at:typeof value.expiry==='string'?value.expiry:null,retention_authorised:object(manifest.approval)&&manifest.approval.allow_retained_resources===true,observed_at:boundedText(receipt.sealed_at)});
 }
 const selected=stringList(manifest.case_ids);
 if(!['task-component','full-case','campaign'].includes(String(checked.scope)))invalid('Unknown canonical receipt scope');
 result.set(reference,{reference,receipt_digest:entry.receipt_digest,scope:checked.scope as VerifiedReleaseEvidence['scope'],case_ids:selected,
 assertion_ids:receipt.assertions.map(a=>{if(!object(a)||a.status!=='PASS')invalid('Unpassed release assertion');return boundedText(a.id);}),outcome:'PASS',
 full_case_status:boundedText(checked.full_case_status),implementation_revision:boundedText(receipt.source.commit),source_manifest_digest:digest(manifest.policy.source_manifest_digest),
 gate_kinds:entry.gate_kinds,resources});
 }return result;
}
export async function assessReleaseReadiness(input:unknown,context:ComponentContext):Promise<RecordValue>{
 const r=fields(input,['inventory']),inventory=parse(r.inventory),i=invocationOf(context);
 const scope={organisation_id:i.principal.organisation_id,run_id:i.principal.run_id};
 const references=[...new Set([...inventory.case_evidence.map(e=>e.evidence_ref),...inventory.clause_evidence.flatMap(e=>e.evidence_refs),...inventory.gate_evidence.flatMap(e=>e.evidence_refs)])];
 // Admission is checked first so absent trusted evidence is reported as such; the contract is still validated before any result.
 const verified=await trustedEvidence(context,scope,references),loaded=await loadReleaseContract(),validation=validateReadinessInventory(loaded.contract,inventory,verified);
 if(validation.complete!==true)return {...validation,ready:false,sealed:false,scope:'RELEASE_READINESS',grants_authority:false};
 const url=new URL('../integration/closure.js',import.meta.url);
 let external:unknown;try{external=await import(url.href);}catch{throw new FoundationError('RELEASE_DEPENDENCY_UNAVAILABLE','Actual programme closure inspector is required');}
 if(!object(external)||typeof external.inspectProgrammeClosure!=='function')throw new FoundationError('RELEASE_DEPENDENCY_UNAVAILABLE','Actual programme closure inspector is required');
 const inspect=external.inspectProgrammeClosure as (db:unknown,invocation:unknown)=>Promise<unknown>;
 const observed=await context.resources.gateway.withPrimaryTransaction({signal:i.signal,guard:tx=>i.guard(tx)},async tx=>{
 const current=await inspect(tx,i);if(!object(current)||typeof current.ready!=='boolean')invalid('Invalid authoritative programme inspection');
 if(current.ready!==true||current.outcome!=='PASS'||current.source_manifest_digest!==inventory.source_manifest_digest)return {ready:false,programme:current};
 const docs=await inspectDocumentationClosure(tx,scope,{spec_revision_id:uuid(current.spec_revision_id),spec_generation:boundedText(current.spec_generation),programme_manifest_digest:digest(current.input_manifest_digest),source_manifest_digest:inventory.source_manifest_digest});
 return {ready:docs.closed,programme:current,documentation:docs};
 });
 return {...validation,...observed,sealed:false,scope:'RELEASE_READINESS',grants_authority:false,receipt_requires_durable_artifact:true};
}
export async function sealReleaseReadiness(input:unknown,context:ComponentContext):Promise<RecordValue>{
 const request=fields(input,['inventory']),inventory=parse(request.inventory),i=invocationOf(context);
 const scope={organisation_id:i.principal.organisation_id,run_id:i.principal.run_id};
 const first=await assessReleaseReadiness(input,context);
 if(first.ready!==true)return {...first,sealed:false};
 if(!object(first.programme)||!object(first.documentation))invalid('Authoritative readiness observations are required');
 const programme=first.programme;
 const record={schema_version:1,kind:'release_readiness',scope,implementation_revision:inventory.implementation_revision,
 source_manifest_digest:inventory.source_manifest_digest,programme_manifest_digest:digest(programme.input_manifest_digest),
 spec_revision_id:uuid(programme.spec_revision_id),spec_generation:boundedText(programme.spec_generation),
 contract_digest:inventory.contract_digest,inventory_digest:contentDigest(inventory),assessment:first,
 self_digest_required:false,full_product_qualification_claimed:false};
 const bytes=canonical(record),hash=sha256(bytes);
 // Artifact I/O precedes the final short authority transaction; an uploaded orphan is not a seal.
 const retained=await persistReleaseArtifact(context,'release_readiness',record);
 if(!object(retained.artifact))invalid('Durable release artifact is missing');
 const artifactID=uuid(retained.artifact.artifact_id),artifactDigest=digest(retained.artifact.digest);
 const repeated=await assessReleaseReadiness(input,context);
 if(repeated.ready!==true||canonical(repeated.programme)!==canonical(programme)||canonical(repeated.documentation)!==canonical(first.documentation))throw new FoundationError('RELEASE_STALE','Release inputs changed while persisting the artifact');
 const imported=await import(new URL('../integration/closure.js',import.meta.url).href) as RecordValue;
 if(typeof imported.inspectProgrammeClosure!=='function')invalid('Authoritative programme inspector is required');
 const inspect=imported.inspectProgrammeClosure as (db:unknown,invocation:unknown)=>Promise<unknown>;
 return context.resources.gateway.withPrimaryTransaction({signal:i.signal,guard:tx=>i.guard(tx)},async tx=>{
 const run=(await tx.query('SELECT spec_revision_id,spec_generation::text,authority_epoch FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',[scope.organisation_id,scope.run_id])).rows[0];
 if(!run||run.spec_revision_id!==record.spec_revision_id||run.spec_generation!==record.spec_generation)throw new FoundationError('RELEASE_STALE','Accepted release revision changed');
 const current=await inspect(tx,i);
 if(!object(current)||current.ready!==true||current.outcome!=='PASS'||current.input_manifest_digest!==record.programme_manifest_digest||current.source_manifest_digest!==record.source_manifest_digest)throw new FoundationError('RELEASE_STALE','Current programme authority no longer permits release');
 const docs=await inspectDocumentationClosure(tx,scope,{spec_revision_id:record.spec_revision_id,spec_generation:record.spec_generation,programme_manifest_digest:record.programme_manifest_digest,source_manifest_digest:record.source_manifest_digest});
 if(!docs.closed||canonical(docs)!==canonical(first.documentation))throw new FoundationError('RELEASE_STALE','Current documentation closure changed');
 const artifact=(await tx.query("SELECT digest,status FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE",[scope.organisation_id,scope.run_id,artifactID])).rows[0];
 if(!artifact||artifact.status!=='COMPLETE'||artifact.digest!==artifactDigest)invalid('Release artifact is not durably COMPLETE');
 const loaded=await loadReleaseContract();if(loaded.contract.contract_digest!==record.contract_digest)throw new FoundationError('RELEASE_STALE','Public release contract changed');
 const inserted=await tx.query("INSERT INTO hyperfide.release_records(organisation_id,run_id,spec_revision_id,spec_generation,authority_epoch,source_manifest_digest,programme_manifest_digest,contract_digest,inventory_digest,record_digest,artifact_id,artifact_digest,canonical_content,payload)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text,$13::text::jsonb)ON CONFLICT(organisation_id,run_id,record_digest)DO NOTHING RETURNING id",[scope.organisation_id,scope.run_id,record.spec_revision_id,record.spec_generation,run.authority_epoch,record.source_manifest_digest,record.programme_manifest_digest,record.contract_digest,record.inventory_digest,hash,artifactID,artifactDigest,bytes]);
 const id=inserted.rows[0]?.id??(await tx.query("SELECT id FROM hyperfide.release_records WHERE organisation_id=$1 AND run_id=$2 AND record_digest=$3",[scope.organisation_id,scope.run_id,hash])).rows[0]?.id;
 if(!id)invalid('Release seal persistence could not be independently retrieved');
 return {ready:true,sealed:true,receipt_id:id,record_digest:hash,artifact_id:artifactID,artifact_digest:artifactDigest,source_manifest_digest:record.source_manifest_digest,programme_manifest_digest:record.programme_manifest_digest,scope:'RELEASE_READINESS',self_qualification_only:false,product_campaigns_are_separate:true};
 });
}
export function createComponent(_context:ComponentContext):Component{
 return {apiVersion:1,actions:{'release.readiness.assess':assessReleaseReadiness,'release.readiness.seal':sealReleaseReadiness}};
}

export function pinnedCampaignManifest(receipt:unknown,bytes:Uint8Array):RecordValue{
 if(!object(receipt)||typeof receipt.manifest_sha256!=='string'||!/^[a-f0-9]{64}$/.test(receipt.manifest_sha256)||sha256(bytes).slice(7)!==receipt.manifest_sha256)throw new FoundationError('RELEASE_EVIDENCE_INVALID','Campaign manifest bytes differ from the anchored receipt');
 const value=JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
 if(!object(value))invalid('Canonical campaign manifest must be an object');
 return value;
}
