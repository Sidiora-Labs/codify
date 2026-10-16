import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { FoundationError, object } from '../policy/programme.js';
import type { Component, ComponentContext } from '../components/registry.js';

export type Obj = Record<string, unknown>;
export type EvidenceClass = 'live' | 'synthetic';
export function fail(message: string): never { throw new FoundationError('EVALUATION_INVALID', message); }
export function fields(value: unknown, required: string[], optional: string[] = []): Obj {
  if (!object(value) || required.some(k => !Object.hasOwn(value, k)) ||
      Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) fail('Unexpected or missing evaluation fields');
  return value;
}
export function text(value: unknown, max = 256): string {
  if (typeof value !== 'string' || !value.length || value.length > max || value.includes('\0')) fail('Invalid bounded string');
  return value;
}
export function id(value: unknown): string {
  const valueText = text(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(valueText)) fail('Invalid identity');
  return valueText;
}
export function finite(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail('Invalid finite number');
  return value;
}
export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = finite(value, min, max); if (!Number.isSafeInteger(n)) fail('Invalid integer'); return n;
}
export function list(value: unknown, min = 0, max = 10000): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail('Invalid bounded list');
  return value;
}
export function strings(value: unknown, min = 0, max = 10000): string[] {
  const result = list(value, min, max).map(v => id(v));
  if (new Set(result).size !== result.length) fail('Duplicate identity');
  return result;
}
export function time(value: unknown): string {
  const result = text(value, 32), numeric = Date.parse(result);
  if (!Number.isFinite(numeric) || new Date(numeric).toISOString() !== result) fail('Canonical UTC timestamp required');
  return result;
}
export function hash(value: unknown): string {
  const result = text(value, 71); if (!/^sha256:[a-f0-9]{64}$/.test(result)) fail('Invalid content digest'); return result;
}
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return fail('Non-JSON evaluation value');
}
export function digest(value: unknown): string { return 'sha256:' + createHash('sha256').update(canonical(value)).digest('hex'); }
export interface Verified { payload: Obj; key: string; evidence_class: EvidenceClass; observed_at: string; receipt_digest: string }
export function attestation(context: ComponentContext, value: unknown, kind: string): Verified {
  const envelope = fields(value, ['body','key_id','signature']);
  const body = fields(envelope.body, ['schema_version','kind','evidence_class','observed_at','subject_digest','payload']);
  if (body.schema_version !== 1 || body.kind !== kind || !['live','synthetic'].includes(String(body.evidence_class))) fail('Wrong attestation type');
  const observed = time(body.observed_at);
  if (Date.parse(observed) > Date.now() + 1000) fail('Future attestation');
  const payload = body.payload; if (!object(payload) || hash(body.subject_digest) !== digest(payload)) fail('Attestation subject mismatch');
  const keyID = id(envelope.key_id);
  let keys: unknown;
  try { keys = JSON.parse(context.env.HYPERFIDE_EVAL_TRUSTED_KEYS ?? ''); } catch { fail('Trusted evaluation keys required'); }
  if (!object(keys) || Object.keys(keys).length > 128 || !Object.hasOwn(keys, keyID)) fail('Untrusted evidence key');
  const key = fields(keys[keyID], ['public_key','evidence_class','kinds']);
  if (key.evidence_class !== body.evidence_class || !strings(key.kinds, 1, 32).includes(kind)) fail('Evidence key capability/class mismatch');
  const encoded = text(envelope.signature, 128);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail('Invalid signature encoding');
  const signature = Buffer.from(encoded, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== encoded) fail('Invalid Ed25519 signature');
  let signerFingerprint:string;
  try {
    const publicKey = createPublicKey(text(key.public_key, 8192));
    if (publicKey.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(canonical(body)), publicKey, signature)) fail('Invalid evidence signature');
    signerFingerprint='sha256:'+createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
  } catch { fail('Invalid evidence signature'); }
  return { payload, key: signerFingerprint, evidence_class: body.evidence_class as EvidenceClass, observed_at: observed, receipt_digest: digest(value) };
}
export interface Artifact<T = Obj> { schema_version: 1; kind: string; payload: T }
export class EvaluationStore {
  constructor(private context: ComponentContext) {}
  private async directory(): Promise<string> {
    const configured = this.context.env.HYPERFIDE_EVAL_STORE;
    if (!configured || !path.isAbsolute(configured)) fail('Trusted absolute evaluation artifact store required');
    const absolute = path.resolve(configured);
    let current = path.parse(absolute).root;
    for (const segment of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      const info = await fs.lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) fail('Evaluation store path must contain real directories');
    }
    return absolute;
  }
  async put<T>(kind: string, payload: T): Promise<string> {
    const artifact: Artifact<T> = { schema_version: 1, kind, payload };
    const identity = digest(artifact), root = await this.directory(), destination = path.join(root, identity.slice(7) + '.json');
    const bytes = canonical(artifact);
    if (Buffer.byteLength(bytes) > 64*1024*1024) fail('Evaluation artifact too large');
    const temporary = path.join(root, '.' + randomUUID());
    const fd = await fs.open(temporary, 'wx', 0o600);
    try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
    try {
      try { await fs.link(temporary, destination); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; await this.get(identity, kind); }
      const dir = await fs.open(root, 'r'); try { await dir.sync(); } finally { await dir.close(); }
    } finally { await fs.unlink(temporary); }
    return identity;
  }
  async get<T = Obj>(identity: unknown, kind: string): Promise<T> {
    const key = hash(identity), file = path.join(await this.directory(), key.slice(7) + '.json'), info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64*1024*1024) fail('Invalid evaluation artifact');
    const raw = await fs.readFile(file, 'utf8'); let value: unknown;
    try { value = JSON.parse(raw); } catch { return fail('Corrupt evaluation artifact'); }
    const record = fields(value, ['schema_version','kind','payload']);
    if (record.schema_version !== 1 || record.kind !== kind || digest(record) !== key || raw !== canonical(record)) fail('Artifact digest/type mismatch');
    return record.payload as T;
  }
}
export interface Packet {
  case_id: string; incident_id: string; feature_id: string; repository_id: string;
  purpose: string; decision_at: string; watermark: string; choices: string[];
  language: string; task_family: string; context_tokens: number;
  sources: {source_id:string; available_at:string; event_sequence:string; content_digest:string; content:string; kind:string}[];
}
export interface DatasetRow { packet: Packet; target: string | null; split: 'train'|'calibration'|'holdout'; packet_digest:string; label_digest:string; evidence_class:EvidenceClass; label_kind:string; label_key:string; group_id:string }
export interface Dataset {
  name:string; purpose:string; split_seed:string; rows:DatasetRow[]; holdout_digest:string;
  evidence_class:'live'|'synthetic'|'mixed'; counts:Record<string,number>; group_count:number;
}
function sequence(value: unknown): string {
  const result = text(value, 40); if (!/^(0|[1-9][0-9]*)$/.test(result)) fail('Canonical event sequence required'); return result;
}
function parsePacket(v: unknown): Packet {
  const p = fields(v, ['case_id','incident_id','feature_id','repository_id','purpose','decision_at','watermark','choices','language','task_family','context_tokens','sources']);
  const decision = time(p.decision_at), watermark = sequence(p.watermark), choices = strings(p.choices,2,128);
  const sources = list(p.sources,1,1000).map(source => {
    const s = fields(source,['source_id','available_at','event_sequence','content_digest','content','kind']);
    const available = time(s.available_at), seq = sequence(s.event_sequence), content = text(s.content,1024*1024);
    if (Date.parse(available)>Date.parse(decision) || BigInt(seq)>BigInt(watermark) || !['source','event','decision_input'].includes(String(s.kind))) fail('Temporal/typed packet leakage');
    if (hash(s.content_digest)!==digest(content)) fail('Source bytes differ from recorded digest');
    return {source_id:id(s.source_id),available_at:available,event_sequence:seq,content_digest:hash(s.content_digest),content,kind:String(s.kind)};
  });
  if (new Set(sources.map(s=>s.source_id)).size!==sources.length) fail('Duplicate packet source');
  return {case_id:id(p.case_id),incident_id:id(p.incident_id),feature_id:id(p.feature_id),repository_id:id(p.repository_id),
    purpose:id(p.purpose),decision_at:decision,watermark,choices,language:id(p.language),task_family:id(p.task_family),
    context_tokens:integer(p.context_tokens,0,10000000),sources};
}
export async function buildDataset(input: unknown, context: ComponentContext): Promise<Obj> {
  const request = fields(input,['name','split_seed','cases']), rows:DatasetRow[]=[];
  const packets = new Set<string>(), seenCases = new Set<string>();
  for (const value of list(request.cases,3,10000)) {
    const pair = fields(value,['packet','label']);
    const receipt = attestation(context,pair.packet,'decision_packet'), packet = parsePacket(receipt.payload);
    if (Date.parse(receipt.observed_at)>Date.parse(packet.decision_at) || packet.sources.some(s=>Date.parse(s.available_at)>Date.parse(receipt.observed_at))) fail('Packet sources were not available by its recording/decision time');
    const packetHash=digest(packet), labelReceipt=attestation(context,pair.label,'independent_label');
    const label=fields(labelReceipt.payload,['case_id','packet_digest','target','label_kind','reviewer_ids','evidence_refs','verification_digest','adjudicated_at']);
    if (id(label.case_id)!==packet.case_id || hash(label.packet_digest)!==packetHash) fail('Label is not bound to this packet');
    const reviewers=strings(label.reviewer_ids,1,32); strings(label.evidence_refs,1,100);
    const labelKind=text(label.label_kind);
    if (!['human_adjudicated','executable_reproduction','synthetic'].includes(labelKind)) fail('Unknown label provenance');
    if (labelKind==='human_adjudicated' && reviewers.length<2) fail('Independent human adjudication required');
    if (labelKind==='executable_reproduction') hash(label.verification_digest);
    else if (label.verification_digest!==null) hash(label.verification_digest);
    if ((labelKind==='synthetic') !== (labelReceipt.evidence_class==='synthetic')) fail('Synthetic labels cannot claim human/live provenance');
    if (labelReceipt.key===receipt.key) fail('Label producer must be independent of packet producer');
    if (Date.parse(time(label.adjudicated_at))<Date.parse(packet.decision_at) || Date.parse(time(label.adjudicated_at))>Date.parse(labelReceipt.observed_at)) fail('Invalid label chronology');
    const target=label.target===null?null:id(label.target);
    if (target!==null && !packet.choices.includes(target)) fail('Label outside packet choices');
    if (seenCases.has(packet.case_id) || packets.has(packetHash)) fail('Duplicate case/packet');
    seenCases.add(packet.case_id);packets.add(packetHash);
    rows.push({packet,target,split:'train',packet_digest:packetHash,label_digest:labelReceipt.receipt_digest,
      evidence_class:receipt.evidence_class==='live'&&labelReceipt.evidence_class==='live'?'live':'synthetic',
      label_kind:labelKind,label_key:labelReceipt.key,group_id:''});
  }
  if (new Set(rows.map(r=>r.packet.purpose)).size!==1) fail('A dataset must have one explicit decision purpose');
  // Connected components prevent incident/feature/repository/near-duplicate leakage.
  const parent=rows.map((_,i)=>i), find=(i:number):number=>{while(parent[i]!==i)i=parent[i]!;return i;};
  const owners=new Map<string,number>();
  rows.forEach((r,i)=>{
    const keys=['incident:'+r.packet.incident_id,'feature:'+r.packet.feature_id,'repo:'+r.packet.repository_id,
      'near:'+digest(r.packet.sources.map(s=>s.content.normalize('NFKC').replace(/\s+/gu,' ').trim()).sort())];
    for(const key of keys){const old=owners.get(key);if(old!==undefined)parent[find(i)]=find(old);else owners.set(key,i);}
  });
  const groups=new Map<number,DatasetRow[]>();
  rows.forEach((r,i)=>{const k=find(i);groups.set(k,[...(groups.get(k)??[]),r]);});
  if(groups.size<3)fail('At least three independent groups are required');
  const seed=id(request.split_seed);
  const ordered=[...groups.values()].sort((a,b)=>
    Math.max(...a.map(r=>Date.parse(r.packet.decision_at)))-Math.max(...b.map(r=>Date.parse(r.packet.decision_at))) ||
    digest([seed,a.map(r=>r.packet.case_id).sort()]).localeCompare(digest([seed,b.map(r=>r.packet.case_id).sort()])));
  const train=Math.min(ordered.length-2,Math.max(1,Math.floor(ordered.length*.6)));
  const cal=Math.min(ordered.length-train-1,Math.max(1,Math.floor(ordered.length*.2)));
  ordered.forEach((group,index)=>{const groupID=digest(group.map(r=>r.packet.case_id).sort());group.forEach(r=>{r.split=index<train?'train':index<train+cal?'calibration':'holdout';r.group_id=groupID;});});
  const boundary=(split:string,fn:(...values:number[])=>number)=>fn(...rows.filter(r=>r.split===split).map(r=>Date.parse(r.packet.decision_at)));
  if(boundary('train',Math.max)>boundary('calibration',Math.min)||boundary('calibration',Math.max)>boundary('holdout',Math.min))fail('Group time ranges overlap split boundaries');
  rows.sort((a,b)=>a.packet.case_id.localeCompare(b.packet.case_id));
  const classes=new Set(rows.map(r=>r.evidence_class));
  const dataset:Dataset={name:id(request.name),purpose:rows[0]!.packet.purpose,split_seed:seed,rows,
    holdout_digest:digest(rows.filter(r=>r.split==='holdout')),evidence_class:classes.size===1?[...classes][0]!:'mixed',
    counts:Object.fromEntries(['train','calibration','holdout'].map(s=>[s,rows.filter(r=>r.split===s).length])),group_count:groups.size};
  const artifact_id=await new EvaluationStore(context).put('dataset',dataset);
  return {artifact_id,name:dataset.name,purpose:dataset.purpose,counts:dataset.counts,group_count:dataset.group_count,
    holdout_digest:dataset.holdout_digest,evidence_class:dataset.evidence_class,live_performance_claim:false};
}
export function createComponent(_context:ComponentContext):Component {
  return {apiVersion:1,actions:{
    'evaluation.dataset.build':buildDataset,
    'evaluation.dataset.inspect':async(input,ctx)=>{
      const r=fields(input,['dataset_id']),d=await new EvaluationStore(ctx).get<Dataset>(r.dataset_id,'dataset');
      return {dataset_id:hash(r.dataset_id),name:d.name,purpose:d.purpose,counts:d.counts,group_count:d.group_count,holdout_digest:d.holdout_digest,evidence_class:d.evidence_class};
    },
    'evaluation.dataset.packet':async(input,ctx)=>{
      const r=fields(input,['dataset_id','case_id']),d=await new EvaluationStore(ctx).get<Dataset>(r.dataset_id,'dataset');
      const row=d.rows.find(v=>v.packet.case_id===id(r.case_id));
      if(!row)fail('Unknown case');
      if(row.split==='holdout')throw new FoundationError('HOLDOUT_SEALED','Holdout inputs/labels are not development context');
      return {packet:row.packet,split:row.split,packet_digest:row.packet_digest};
    }
  }};
}
