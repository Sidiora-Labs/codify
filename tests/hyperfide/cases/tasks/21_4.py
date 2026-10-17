#!/usr/bin/env python3
"""Domain21 bounded component tests; no live model, scheduler or HA qualification."""
from __future__ import annotations
import importlib.util,json,os,shlex,shutil,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
NODE="\nimport fs from 'node:fs';\nimport path from 'node:path';\nimport {createRequire} from 'node:module';\nimport {pathToFileURL} from 'node:url';\nconst ROOT=process.env.HF_FIXTURE_ROOT,task=process.argv[2];\nconst require=createRequire(ROOT+'/services/hyperfide/package.json'),pg=require('pg');\nconst load=module=>import(pathToFileURL(ROOT+'/services/hyperfide/dist/'+module+'.js').href);\nconst A=await load('decisions/audit'),S=task==='21.1'?await load('decisions/spec_critique'):null,R=task==='21.2'?await load('decisions/recovery'):null,K=task==='21.3'?await load('decisions/ranking'):null;\nlet failed=0;const checks=[];\nconst expect=(condition,message)=>{if(!condition)throw Error(message)};\nconst reject=(fn,code)=>{try{fn()}catch(e){if(e.code===code)return;throw Error('wrong refusal: '+e.code)}throw Error('accepted invalid input')};\nconst check=async(id,fn)=>{let actual='observed';try{await fn()}catch(e){actual=String(e.code||e.name)+': '+String(e.message).slice(0,500);failed++}checks.push({type:'assertion',id,expected:'observed',actual});console.log(JSON.stringify(checks.at(-1)))};\nconst clone=x=>JSON.parse(JSON.stringify(x)),id=n=>'40000000-0000-0000-0000-'+String(n).padStart(12,'0'),hash='sha256:'+'a'.repeat(64);\nconst document={parsed:{sections:[{name:'req.1',line:1,fields:{ac_1:{key:'ac_1',raw:'\"Mandatory contract\"',value:'Mandatory contract',line:2}}},{name:'task.1',line:3,fields:{verify_cmd:{raw:'\"make check\"',value:'make check',line:4},requires:{raw:'[]',value:[],line:5}}}]}};\nconst clause=S?S.clauseState(document,[{section:'req.1',field:'ac_1'}],hash):null;\nif(task==='21.1'){\n await check('critique.source-linked',()=>expect(clause.clauses[0].source_digest===hash&&clause.clauses[0].line===2,'source identity lost'));\n await check('critique.mandatory-contract',()=>expect(clause.mandatory_task_contracts[0].fields.verify_cmd.value==='make check','verify command dropped'));\n await check('critique.missing-clause',()=>reject(()=>S.clauseState(document,[{section:'req.9',field:'ac_1'}],hash),'DECISION_SOURCE_MISSING'));\n await check('critique.duplicate-clause',()=>reject(()=>S.clauseState(document,[{section:'req.1',field:'ac_1'},{section:'req.1',field:'ac_1'}],hash),'DECISION_INVALID'));\n const finding={category:'missing_proof',clause_id:'req.1/ac_1',finding:'Need consumer test',proposed_change:'Add a test criterion',source_refs:['req.1/ac_1']};\n await check('critique.valid-proposal',()=>expect(S.validateCritique({findings:[finding]},clause).length===1,'valid critique refused'));\n await check('critique.outside-source',()=>reject(()=>S.validateCritique({findings:[{...finding,source_refs:['req.9/ac_1']}]},clause),'DECISION_SOURCE_MISSING'));\n await check('critique.authority-injection',()=>reject(()=>S.validateCritique({findings:[{...finding,release_dependencies:true}]},clause),'DECISION_INVALID'));\n const analysis={schema_version:1,proposal_digest:hash,accepted:false,dispatch_authority:false,status:'STRUCTURALLY_VALID',diagnostics:[],impact:{added:[],changed:['1'],retired:[],affected_task_ids:[id(20)],global_intent_changed:false,external_dependents:[]},structural:{status:'VALID',edges:[{from:'1',to:'2'}],diagnostics:[]}};\n await check('critique.validation-nonaccepting',()=>{const result=S.amendmentSummary(analysis);expect(result.accepted===false&&result.dispatch_authority===false&&result.status==='STRUCTURALLY_VALID','validation changed acceptance authority')});\n await check('critique.validation-authority-forgery',()=>reject(()=>S.amendmentSummary({...analysis,accepted:true}),'DECISION_VALIDATION_INVALID'));\n await check('critique.validation-dispatch-forgery',()=>reject(()=>S.amendmentSummary({...analysis,dispatch_authority:true}),'DECISION_VALIDATION_INVALID'));\n await check('critique.validation-full-impact-digest',()=>{const actual=S.amendmentSummary(analysis);expect(actual.impact_digest===A.digest(analysis.impact)&&actual.analysis_digest===A.digest(analysis),'full validation/impact digest differs')});\n await check('critique.validation-bounded-impact',()=>{const large={...analysis,impact:{...analysis.impact,changed:Array.from({length:300},(_,i)=>String(i))}};const result=S.amendmentSummary(large);expect(result.impact.changed.length===128&&result.impact.counts.changed===300&&result.impact.truncated===true&&result.impact_digest===A.digest(large.impact),'bounded presentation lost full impact identity')});\n await check('critique.source-immutable',()=>{const before=A.canonical(document);S.validateCritique({findings:[finding]},clause);expect(before===A.canonical(document),'accepted source mutated')});\n}\nif(task==='21.2'){\n const state={allowed_actions:[...R.RECOVERY_ACTIONS],retry_permitted:true,frontier_profile_ids:['frontier-long'],waiting_for_capacity:false};\n const advice={action:'retry_same',reason:'Environment repair observed',changes:['dependency installed'],frontier_profile_id:null};\n await check('recovery.valid-bounded',()=>expect(R.recoveryAdvice(advice,state).action==='retry_same','bounded advice refused'));\n await check('recovery.no-changed-condition',()=>reject(()=>R.recoveryAdvice({...advice,changes:[]},state),'DECISION_ACTION_DENIED'));\n await check('recovery.exhausted-budget',()=>reject(()=>R.recoveryAdvice(advice,{...state,retry_permitted:false}),'DECISION_ACTION_DENIED'));\n await check('recovery.capacity-is-wait',()=>reject(()=>R.recoveryAdvice(advice,{...state,waiting_for_capacity:true}),'DECISION_ACTION_DENIED'));\n await check('recovery.frontier-only',()=>reject(()=>R.recoveryAdvice({...advice,action:'change_frontier_profile',frontier_profile_id:'cheap-worker'},state),'DECISION_ACTION_DENIED'));\n await check('recovery.forbidden-action',()=>reject(()=>R.recoveryAdvice({...advice,action:'skip_test'},state),'DECISION_ACTION_DENIED'));\n await check('recovery.no-authority-fields',()=>reject(()=>R.recoveryAdvice({...advice,grant_lease:true},state),'DECISION_INVALID'));\n await check('recovery.outage-fallback',()=>expect(R.recoveryFallback(state,'unavailable').action==='insufficient_evidence','outage invented advice'));\n await check('recovery.fallback-advisory',()=>expect(R.recoveryFallback({...state,waiting_for_capacity:true},'expired').authority==='NONE','fallback grants authority'));\n}\nif(task==='21.3'){\n const context=(id,kind)=>({id,kind,content:id,source_digest:hash});\n const state=K.rankingState({eligible_choices:[{id:'a',frontier_profile_id:'frontier-long',packet_digest:hash,priority:2},{id:'b',frontier_profile_id:'frontier-short',packet_digest:hash,priority:1}],\n mandatory_context:[context('c','criterion'),context('v','verify_command'),context('s','constraint')],optional_context:[context('o','memory')],findings:[{id:'f1',evidence:['e1']},{id:'f2',evidence:['e2']}],required_reviewers:['r1','r2'],revision_bindings:{}});\n const advice={choice_order:['b','a'],optional_context_order:[],relationships:[{left:'f1',right:'f2',reason:'May share producer'}],reviewer_suggestions:['r1']};\n await check('ranking.eligible-order',()=>expect(K.rankAdvice(advice,state).choice_order[0]==='b','eligible ordering lost'));\n await check('ranking.reject-ineligible',()=>reject(()=>K.rankAdvice({...advice,choice_order:['x','a']},state),'DECISION_ACTION_DENIED'));\n await check('ranking.reject-missing-choice',()=>reject(()=>K.rankAdvice({...advice,choice_order:['a']},state),'DECISION_INVALID'));\n await check('ranking.mandatory-preserved',()=>expect(A.canonical(K.rankAdvice(advice,state).mandatory_context)===A.canonical(state.mandatory_context),'mandatory context changed'));\n await check('ranking.all-reviewers-preserved',()=>expect(K.rankAdvice(advice,state).required_reviewers.length===2,'review coverage reduced'));\n await check('ranking.original-findings-preserved',()=>expect(A.canonical(K.rankAdvice(advice,state).original_findings)===A.canonical(state.findings),'source findings merged'));\n await check('ranking.unknown-finding',()=>reject(()=>K.rankAdvice({...advice,relationships:[{left:'f1',right:'missing',reason:'merge'}]},state),'DECISION_SOURCE_MISSING'));\n await check('ranking.incomplete-intent',()=>reject(()=>K.rankingState({...state,mandatory_context:[state.mandatory_context[0]]}),'DECISION_INVALID'));\n await check('ranking.shortlist-bound',()=>reject(()=>K.rankingState({...state,eligible_choices:Array.from({length:9},(_,i)=>({...state.eligible_choices[0],id:'x'+i}))}),'DECISION_INVALID'));\n await check('ranking.typed-noul',()=>{const values={non_authoritative:true,answers:{'choice.0':{type:'noul',value:0.1},'choice.1':{type:'noul',value:0.9},'context.0':{type:'noul',value:0.6},'finding.0':{type:'noul',value:0.3},'finding.1':{type:'noul',value:0.8}}};expect(K.rankTyped(values,state).choice_order[0]==='b','typed distributions were not ranked');expect(K.rankingQuestions(state)['choice.0'].type==='noul','request schema incompatible')});\n await check('ranking.finding-snapshot-flat-contract',()=>{const scope={organisation_id:id(1),run_id:id(4)},body={...scope,findings:[],observations:[],next_finding_id:null,next_observation_id:null,qualifies_findings:false},result=K.findingSnapshot({...body,context_digest:A.digest(body)},scope);expect(result.availability==='AVAILABLE'&&result.snapshot.organisation_id===scope.organisation_id,'actual flat producer scope was rejected')});\n await check('ranking.finding-snapshot-scope-and-digest',()=>{const scope={organisation_id:id(1),run_id:id(4)},body={...scope,findings:[],observations:[],next_finding_id:null,next_observation_id:null,qualifies_findings:false},snapshot={...body,context_digest:A.digest(body)};reject(()=>K.findingSnapshot({...snapshot,organisation_id:id(99)},scope),'DECISION_INVALID');reject(()=>K.findingSnapshot({...snapshot,context_digest:hash},scope),'DECISION_INVALID')});\n await check('ranking.finding-observation-identities',()=>{const context={availability:'AVAILABLE',snapshot:{findings:[{finding_id:id(31),evidence:['preserved']}],observations:[{observation_id:id(31),finding_id:null,evidence_id:id(32)}]}},before=A.canonical(context),items=K.findingAdviceEntries(context);expect(items.length===2&&items[0].id!==items[1].id&&A.canonical(context)===before,'finding and immutable observation were merged or changed')});\n await check('ranking.finding-shortlist-bound',()=>{const snapshot={findings:Array.from({length:8},(_,n)=>({finding_id:id(40+n)})),observations:Array.from({length:8},(_,n)=>({observation_id:id(60+n)}))};expect(K.findingAdviceEntries({availability:'AVAILABLE',snapshot}).length===8&&snapshot.observations.length===8,'bounded ranking dropped source inventory')});\n await check('ranking.finding-unavailable-explicit',()=>expect(K.findingAdviceEntries({availability:'UNAVAILABLE',reason:'reader absent'}).length===0,'missing registry invented findings'));\n await check('ranking.deterministic-fallback',()=>expect(A.canonical(K.deterministicRanking(state).choice_order)==='[\"a\",\"b\"]','fallback is unstable'));\n}\nif(task==='21.4'){\n const {ResourceContainer}=await load('storage/runtime'),resources=new ResourceContainer('control',process.env,new AbortController().signal);\n const scope={organisation_id:id(1),run_id:id(4)},controller=new AbortController(),ctx={role:'control',env:process.env,signal:controller.signal,resources};\n let guards=0;ctx.invocation={principal:{...scope,allowed_actions:['decision.audit.record','decision.audit.capture','decision.audit.inspect','decision.audit.outcome','decision.spec.packet','decision.spec.propose']},operation:{protocol_version:1},payload:{action:'fixture',run_id:scope.run_id},signal:controller.signal,guard:async tx=>{guards++;await tx.query('SELECT id FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2',[scope.organisation_id,scope.run_id])}};\n const audit=A.createComponent(ctx),call=async(component,action,data)=>component.actions[action]({scope,...data},{...ctx,invocation:{...ctx.invocation,payload:{action,run_id:scope.run_id}}});\n let packet,record;\n try{\n await check('audit.packet-primary',async()=>{packet=await resources.gateway.withPrimaryTransaction({guard:tx=>ctx.invocation.guard(tx)},tx=>A.storePacket(tx,scope,'spec_critique',{clauses:[],mandatory_task_contracts:[]}));expect(packet.authority==='NONE'&&packet.state.primary_revision.spec_generation==='1'&&packet.revision.spec_revision===id(3),'packet is not revision bound')});\n record={id:id(5),packet_id:packet.id,packet_hash:packet.packet_hash,rubric_version:'r1',calibration_version:'uncalibrated',adapter_version:'fixture-v1',requested_model:'fixture-model',returned_model:'fixture-model',route:'fixture',\n status:'abstained',raw_output:{retained_response:'synthetic bounded fixture'},interpretation:{findings:[]},attempts:[{route:'fixture',status:'unavailable'}],latency_ms:3,usage:{source:'observed',input_tokens:3},cost:{source:'unknown',amount:null},action:{authority:'NONE',applied:false,recommendation:null},rejection_reason:'no calibration'};\n await check('audit.common-packet-hash',()=>{const {packet_hash,...body}=packet;expect(A.digest(body)===packet_hash&&Object.keys(packet.revision).sort().join(',')==='contract_revisions,event_watermark,graph_revision,ownership_generation,repository_commits,spec_revision','packet differs from actual durable job contract')});\n await check('audit.append-real-database',async()=>expect((await call(audit,'decision.audit.record',{record})).status==='abstained','audit not persisted'));\n await check('audit.semantic-write-preserves-business-pins',async()=>{await A.withAuthority({...ctx,invocation:{...ctx.invocation,payload:{action:'decision.audit.inspect',run_id:scope.run_id}}},scope,'decision.audit.inspect',async tx=>{const fresh=await A.loadPacket(tx,scope,packet.id);const row=(await tx.query('SELECT semantic_generation::text AS generation,state_version::text AS version FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2',[scope.organisation_id,scope.run_id])).rows[0];expect(BigInt(row.generation)>1n&&row.version===packet.state.primary_revision.state_version&&fresh.packet_hash===packet.packet_hash,'synchronization fence invalidated unchanged business intent')})});\n await check('audit.replay-idempotent',async()=>{await call(audit,'decision.audit.record',{record});const row=await resources.gateway.withPrimaryTransaction({},tx=>tx.query('SELECT count(*)::int AS n FROM hyperfide.decision_audits'));expect(row.rows[0].n===1,'replay duplicated audit')});\n await check('audit.replay-conflict',async()=>{try{await call(audit,'decision.audit.record',{record:{...record,latency_ms:8}})}catch(e){expect(e.code==='DECISION_CONFLICT','wrong replay refusal');return}throw Error('replay changed data')});\n await check('audit.inspect-complete',async()=>{const result=await call(audit,'decision.audit.inspect',{id:record.id});expect(result.payload.raw_output.retained_response&&result.payload.attempts.length===1&&result.authority==='NONE','audit lost replay context')});\n await check('audit.wire-result-untrusted',async()=>{try{await call(audit,'decision.audit.record',{record:{...record,id:id(9),status:'accepted_advice'}})}catch(e){expect(e.code==='DECISION_RESULT_REQUIRED','wrong untrusted result refusal');return}throw Error('forged accepted advice')});\n await check('audit.cross-scope-refused',async()=>{try{await audit.actions['decision.audit.inspect']({scope:{...scope,organisation_id:id(99)},id:record.id},ctx)}catch(e){expect(e.code==='AUTH_FORBIDDEN','scope crossed guard');return}throw Error('scope accepted')});\n await check('audit.missing-invocation',async()=>{try{await audit.actions['decision.audit.inspect']({scope,id:record.id},{...ctx,invocation:undefined})}catch(e){expect(e.code==='AUTH_REQUIRED','missing authentication accepted');return}throw Error('missing context accepted')});\n await check('audit.guard-inside-primary',()=>expect(guards>=4,'guard did not run for operations'));\n await check('audit.semantic-barrier-before-identity',async()=>{\n  const blocker=new pg.Client({connectionString:process.env.DATABASE_URL}),observer=new pg.Client({connectionString:process.env.DATABASE_URL});let pending,guardEntered=false;\n  await blocker.connect();await observer.connect();\n  try{\n   await blocker.query('BEGIN');await blocker.query(\"SET LOCAL lock_timeout='500ms'\");\n   await blocker.query('SELECT id FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR UPDATE',[scope.organisation_id,scope.run_id]);\n   const guarded={...ctx,invocation:{...ctx.invocation,payload:{action:'decision.audit.inspect',run_id:scope.run_id},guard:async tx=>{guardEntered=true;await tx.query('SELECT id FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',[scope.organisation_id,scope.run_id])}}};\n   pending=A.withAuthority(guarded,scope,'decision.audit.inspect',async()=>true).then(value=>({value}),error=>({error}));\n   const deadline=Date.now()+2000;let waiting=false;\n   while(Date.now()<deadline){const locks=await observer.query(\"SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT semantic_generation::text AS generation FROM hyperfide.runs%'\");if(locks.rowCount){waiting=true;break}await new Promise(resolve=>setTimeout(resolve,10))}\n   expect(waiting&&!guardEntered,'identity row lock preceded the semantic barrier');\n   await blocker.query('UPDATE hyperfide.runs SET state_version=state_version WHERE organisation_id=$1 AND id=$2',[scope.organisation_id,scope.run_id]);\n   await blocker.query('ROLLBACK');const result=await pending;expect(result.value===true&&guardEntered&&!result.error,'reader failed after ordered writer release');\n  }finally{await blocker.query('ROLLBACK').catch(()=>{});if(pending)await pending;await blocker.end();await observer.end()}\n });\n\n await check('audit.secret-rejected',()=>reject(()=>A.validateAudit({...record,raw_output:{authorization:'Bearer super-secret-token-value'}}),'DECISION_SECRET'));\n await check('audit.authority-rejected',()=>reject(()=>A.validateAudit({...record,action:{authority:'LEASE',applied:true,recommendation:'claim'}}),'DECISION_AUTHORITY_DENIED'));\n await check('audit.strict-json-null-prototypes',()=>{const convert=value=>Array.isArray(value)?value.map(convert):value&&typeof value==='object'?Object.assign(Object.create(null),Object.fromEntries(Object.entries(value).map(([k,v])=>[k,convert(v)]))):value;expect(A.validateAudit(convert(record)).id===record.id,'strict signed JSON rejected')});\n await check('audit.null-unknown-preserved',()=>expect(A.validateAudit({...record,calibration_version:null,returned_model:null}).returned_model===null,'unknown model replaced'));\n await check('audit.outcome-persist',async()=>{await call(audit,'decision.audit.outcome',{id:id(8),audit_id:record.id,outcome:{observed_kind:'policy_rejection',source_id:'fixture-reference',source_digest:hash,occurred_at:new Date().toISOString(),action_taken:'manager_review',details:{trust:'supplied reference; no qualification authority'}}});expect((await call(audit,'decision.audit.inspect',{id:record.id})).outcomes.length===1,'outcome not retained')});\n await check('audit.capture-trusted-job',async()=>{const {id:unused,packet_id:unused2,action:unused3,...fields}=record;const completed={...fields,decision_id:id(7),calibration_version:'synthetic-calibration-fixture',status:'accepted_advice',authority:'NONE',interpretation:{answers:{},non_authoritative:true}};const trusted={...ctx,invocation:{...ctx.invocation,payload:{action:'decision.audit.capture',run_id:scope.run_id}},dependencies:{require:(dependency,name,guard)=>{const jobs={completedAudit:async()=>({available:true,payload:completed})};expect(dependency==='20.4'&&name==='decision.jobs.v1'&&guard(jobs),'wrong actual dependency seam');return jobs}}};const result=await audit.actions['decision.audit.capture']({scope,decision_id:id(7),packet_id:packet.id},trusted);expect(result.status==='accepted_advice'&&result.authority==='NONE','trusted job capture failed')});\n\n await check('audit.freshness-skips-document',async()=>{await resources.gateway.withPrimaryTransaction({},async tx=>{const light=await A.currentRevision(tx,scope),full=await A.currentRevision(tx,scope,true);expect(!('document' in light)&&!('source_content' in light)&&full.document.parsed.sections.length===2,'freshness loaded whole accepted source')})});\n await check('audit.outcome-cursor-bounded',async()=>{\n  await resources.gateway.withPrimaryTransaction({},async tx=>{for(let n=20;n<30;n++)await tx.query(\"INSERT INTO hyperfide.decision_outcomes(organisation_id,run_id,id,audit_id,payload,payload_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)\",[scope.organisation_id,scope.run_id,id(n),record.id,{details:'x'.repeat(100000)},hash,'2026-10-16T00:00:00.123456Z']);});\n  let after,seen=new Set(),pages=0;\n  do{const page=await call(audit,'decision.audit.inspect',{id:record.id,...(after?{after}:{})});expect(page.outcomes.length<=8&&Buffer.byteLength(JSON.stringify(page.outcomes))<=262144,'outcome page exceeded budget');for(const row of page.outcomes){expect(!seen.has(row.id),'cursor duplicated outcome');seen.add(row.id);}after=page.next_after;expect(page.has_more===!!after,'continuation mismatch');pages++;expect(pages<=11,'cursor did not advance');}while(after);\n  expect(seen.size===11&&pages>1,'cursor dropped immutable outcomes');\n });\n await check('audit.required-isolation-guards',async()=>{const result=await resources.gateway.withPrimaryTransaction({},tx=>tx.query(\"SELECT count(*)::int n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='hyperfide' AND c.relname=ANY($1::text[]) AND p.proname='require_authority_isolation' AND NOT t.tgisinternal AND t.tgenabled<>'D'\",[['decision_packets','decision_audits','decision_proposals','decision_outcomes']]));expect(result.rows[0].n===4,'advisory authority table missing required guard')});\n await check('audit.repeatable-read-refused',async()=>{const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');try{await client.query('INSERT INTO hyperfide.decision_packets SELECT * FROM hyperfide.decision_packets LIMIT 1')}catch(e){expect(e.code==='25001','wrong unsupported-isolation refusal: '+e.code);return}throw Error('repeatable-read advisory mutation accepted')}finally{await client.query('ROLLBACK');await client.end()}});\n await check('audit.outcome-index-present',async()=>{const rows=await resources.gateway.withPrimaryTransaction({},tx=>tx.query(\"SELECT indexname FROM pg_indexes WHERE schemaname='hyperfide' AND tablename='decision_outcomes' AND indexname='decision_outcomes_audit_cursor'\"));expect(rows.rowCount===1,'audit cursor index absent')});\n await check('audit.outcome-cross-audit-replay',async()=>{const result=await call(audit,'decision.audit.inspect',{id:record.id});const first=result.outcomes.find(row=>row.id===id(8))??(await resources.gateway.withPrimaryTransaction({},tx=>tx.query('SELECT payload FROM hyperfide.decision_outcomes WHERE id=$1',[id(8)]))).rows[0];try{await call(audit,'decision.audit.outcome',{id:id(8),audit_id:id(7),outcome:first.payload})}catch(e){expect(e.code==='DECISION_CONFLICT','wrong cross-audit replay refusal');return}throw Error('outcome identity rebound to another audit')});\n await check('audit.secret-in-free-text',()=>reject(()=>A.validateAudit({...record,raw_output:{text:'provider response api_key=credential-value-hidden'}}),'DECISION_SECRET'));\n await check('audit.sql-history-immutable',async()=>{const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();try{try{await client.query('UPDATE hyperfide.decision_audits SET status=$1 WHERE id=$2',['accepted_advice',record.id])}catch(e){expect(e.code==='23514','wrong immutable refusal: '+e.code);return}throw Error('audit history mutated')}finally{await client.end()}});\n await check('audit.stale-packet-refused',async()=>{await resources.gateway.withPrimaryTransaction({},tx=>tx.query('UPDATE hyperfide.runs SET state_version=state_version+1 WHERE id=$1',[scope.run_id]));try{await resources.gateway.withPrimaryTransaction({guard:tx=>ctx.invocation.guard(tx)},tx=>A.auditFor(tx,scope,record.id,'spec_critique'))}catch(e){expect(e.code==='DECISION_STALE','stale packet reached action');return}throw Error('stale advice accepted')});\n await check('audit.accepted-intent-unchanged',async()=>{const row=await resources.gateway.withPrimaryTransaction({},tx=>tx.query('SELECT source_content FROM hyperfide.spec_revisions WHERE id=$1',[id(3)]));expect(row.rows[0].source_content==='fixture source\\n','source modified')});\n }finally{await resources.close()}\n}\nprocess.exitCode=failed?1:0;\n"
def storage_helper():
 spec=importlib.util.spec_from_file_location("storage_fixture",ROOT/"tests/hyperfide/cases/tasks/4_1.py")
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 module.DATABASE="hf_task_21_4_qualification";module.RESOURCE="hf-task-21.4-database"
 return module
PROBE_RESOURCE="hf-task-21.4-probe-fixtures"
def probe_inventory_file():
 return storage_helper().observation_dir()/"probe-fixtures.json"
def track_probe_fixtures(identity_module):
 # Each real HTTPS+PG probe owns a random hf_identity_ database and hf_ir_ role; record them before any test step.
 original=identity_module._record_fixture
 def record(fixture):
  original(fixture)
  file=probe_inventory_file();rows=json.loads(file.read_text()) if file.exists() else []
  if not any(row["database"]==fixture.database for row in rows):
   rows.append({"database":fixture.database,"runtime_role":fixture.runtime_role,"path":str(fixture.path)});file.write_text(json.dumps(rows,sort_keys=True)+"\n")
 identity_module._record_fixture=record
def cleanup_probe_fixtures(helper):
 import re
 file=probe_inventory_file();rows=json.loads(file.read_text()) if file.exists() else [];observed=[]
 for row in rows:
  database,role,path=row["database"],row["runtime_role"],Path(row["path"])
  if not re.fullmatch(r"hf_identity_[0-9a-f]{32}",database) or not re.fullmatch(r"hf_ir_[0-9a-f]{32}",role) or path.parent!=Path(tempfile.gettempdir()) or not path.name.startswith("hyperfide-identity-"):
   raise RuntimeError("Probe inventory is not an owned domain21 fixture")
  helper.sql('DROP DATABASE IF EXISTS "'+database+'" WITH (FORCE);',database="postgres")
  helper.sql('DROP ROLE IF EXISTS "'+role+'";',database="postgres")
  if path.exists():shutil.rmtree(path)
  present=helper.sql("SELECT (SELECT count(*) FROM pg_database WHERE datname='"+database+"')+(SELECT count(*) FROM pg_roles WHERE rolname='"+role+"');",database="postgres").stdout.strip()
  observed.append({"database":database,"runtime_role":role,"database_and_role_absent":present=="0","private_path_absent":not path.exists()})
 complete=all(item["database_and_role_absent"] and item["private_path_absent"] for item in observed)
 (helper.observation_dir()/"probe-fixture-absence.json").write_text(json.dumps({"resource":PROBE_RESOURCE,"complete":complete,"observations":observed,"observer":"PostgreSQL pg_database/pg_roles query after DROP"},sort_keys=True)+"\n")
 if complete:file.write_text("[]\n")
 return {"id":PROBE_RESOURCE,"status":"deleted" if complete else "unknown","observed_absent":complete,"evidence_artifact":"storage/probe-fixture-absence.json"}
def cleanup_task():
 # Exactly one cleanup event covers the disposable database and every probe-owned fixture.
 import contextlib,io
 helper=storage_helper();captured=io.StringIO()
 with contextlib.redirect_stdout(captured):status=helper.cleanup()
 events=[json.loads(line) for line in captured.getvalue().splitlines() if line.strip().startswith("{")]
 resources=[r for event in events if event.get("type")=="cleanup" for r in event.get("resources",[])]
 try:probe=cleanup_probe_fixtures(helper)
 except Exception:probe={"id":PROBE_RESOURCE,"status":"unknown"}
 resources.append(probe)
 complete=status==0 and len(resources)==2 and all(r.get("observed_absent") is True for r in resources)
 print(json.dumps({"type":"cleanup","complete":complete,"resources":resources}),flush=True)
 return 0 if complete else 1
def environment():
 env=os.environ.copy()
 reference=Path(env.get("HYPERFIDE_TEST_PG_ENV","/tmp/hyperfide/postgres/fixture.env"))
 if "DATABASE_URL" not in env and reference.is_file():
  for line in reference.read_text().splitlines():
   tokens=shlex.split(line)
   if tokens and tokens[0]=="export":tokens=tokens[1:]
   if len(tokens)==1 and "=" in tokens[0]:
    key,value=tokens[0].split("=",1)
    if key.startswith("PG") or key=="DATABASE_URL":env[key]=value
 return env
def service_probe(task,env,directory):
 modules=directory/"modules";shutil.copytree(ROOT/"services/hyperfide/dist",modules)
 (modules/"package.json").write_text('{"type":"module"}')
 (directory/"node_modules").symlink_to(ROOT/"services/hyperfide/node_modules",target_is_directory=True)
 components=directory/"components";components.mkdir()
 for identity in set(["4.2","21.4",task]):
  shutil.copyfile(ROOT/("services/hyperfide/components/"+identity+".json"),components/(identity+".json"))
 if task in ["21.1","21.2","21.3","21.4"]:
  (modules/"unavailable-jobs.js").write_text("export function createComponent(){return {apiVersion:1,capabilities:{'decision.jobs.v1':{registerPurpose(){},completedAudit(){return {available:false,reason:'missing'}}}},actions:{'fixture.jobs.unavailable':()=>{throw Error('Not a model job qualification')}}}}")
  (components/"20.4.json").write_text(json.dumps({"schema_version":1,"id":"20.4","task":"20.4","roles":["control"],"module":"unavailable-jobs.js","entry":"createComponent","api_version":1,"actions":["fixture.jobs.unavailable"],"requires":[]}))
 if task=="21.2":
  (modules/"unavailable-admission.js").write_text("export function createComponent(){return {apiVersion:1,capabilities:{'agent.admission.v1':{recoveryContextInTransaction(){throw Error('Native admission is deliberately unavailable in this linkage fixture')}}},actions:{'fixture.admission.unavailable':()=>({authority:'NONE'})}}}")
  (components/"13.4.json").write_text(json.dumps({"schema_version":1,"id":"13.4","task":"13.4","roles":["control"],"module":"unavailable-admission.js","entry":"createComponent","api_version":1,"actions":["fixture.admission.unavailable"],"requires":[]}))
 if task=="21.2":
  (modules/"unavailable-assurance.js").write_text("export function createComponent(){return {apiVersion:1,capabilities:{'assurance.execution.v1':{inspectExecutionReceipt(){throw Error('Assurance is deliberately unavailable in this linkage fixture')}}},actions:{'fixture.assurance.unavailable':()=>({authority:'NONE'})}}}")
  (components/"16.2.json").write_text(json.dumps({"schema_version":1,"id":"16.2","task":"16.2","roles":["control"],"module":"unavailable-assurance.js","entry":"createComponent","api_version":1,"actions":["fixture.assurance.unavailable"],"requires":[]}))
 if task=="21.3":
  # Only registry linkage is exercised here; this dependency fixture grants no eligibility.
  (modules/"unavailable-scheduler.js").write_text("export function createComponent(){return {apiVersion:1,actions:{'fixture.scheduler.unavailable':()=>{throw Error('Not a scheduler qualification')}}}}")
  (components/"5.4.json").write_text(json.dumps({"schema_version":1,"id":"5.4","task":"5.4","roles":["control"],"module":"unavailable-scheduler.js","entry":"createComponent","api_version":1,"actions":["fixture.scheduler.unavailable"],"requires":[]}))
 if task=="21.3":
  (modules/"unavailable-findings.js").write_text("export function createComponent(){return {apiVersion:1,actions:{'fixture.findings.unavailable':()=>({authority:'NONE',availability:'UNAVAILABLE'})}}}")
  (components/"18.1.json").write_text(json.dumps({"schema_version":1,"id":"finding-registry","task":"18.1","roles":["control"],"module":"unavailable-findings.js","entry":"createComponent","api_version":1,"actions":["fixture.findings.unavailable"],"requires":[]}))
 prefix={"21.1":"decision.spec","21.2":"decision.recovery","21.3":"decision.ranking","21.4":"decision.audit"}[task]
 fragment=json.loads((components/(task+".json")).read_text())
 policy={"schema_version":1,"programme_id":"domain21-registry-fixture","repository":"fixture/repository","spec_revision":"domain21-reviewed-spec","policy_revision":1,"status":"ACTIVE","approval":{"decision":"APPROVED","record_id":"implementation-authorised","spec_revision":"domain21-reviewed-spec","policy_revision":1},"allowed_roles":["control"],"allowed_actions":["programme.activate",prefix+".describe"]}
 policy_file=directory/"policy.json";policy_file.write_text(json.dumps(policy))
 request={"id":"domain21-linkage","component":task,"action":prefix+".describe","input":{}}
 result=subprocess.run(["node",str(ROOT/"services/hyperfide/dist/control.js"),"--policy",str(policy_file),"--spec-revision",policy["spec_revision"],"--components",str(components),"--module-root",str(modules)],input=json.dumps(request)+"\n",cwd=ROOT,env=env,text=True,capture_output=True,timeout=30)
 rows=[json.loads(line) for line in result.stdout.splitlines() if line.strip()]
 identity={"21.1":"critique","21.2":"recovery","21.3":"ranking","21.4":"audit"}[task]+".service-linked"
 good=result.returncode==0 and len(rows)==1 and rows[0].get("ok") is True and (rows[0].get("result",{}).get("authority")=="NONE")
 print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":"observed" if good else "service refused linked module: "+str(rows)}),flush=True)
 return good
def run_task(task):
 env=environment();os.environ.update({k:v for k,v in env.items() if k.startswith("PG") or k=="DATABASE_URL"})
 if "--cleanup" in sys.argv:
  if task=="21.4":return cleanup_task()
  print(json.dumps({"type":"cleanup","complete":True,"resources":[]}));return 0
 helper=storage_helper() if task=="21.4" else None
 try:
  if helper:
   helper.sql('CREATE DATABASE "'+helper.DATABASE+'";',database="postgres")
   ddl=(ROOT/"services/hyperfide/migrations/0001-authority.sql").read_text()+(ROOT/"services/hyperfide/migrations/0004-durability.sql").read_text()+(ROOT/"services/hyperfide/migrations/0021-decisions.sql").read_text()
   document={"parsed":{"sections":[{"name":"req.1","line":1,"fields":{"ac_1":{"key":"ac_1","raw":"\"Mandatory contract\"","value":"Mandatory contract","line":2}}},{"name":"task.1","line":3,"fields":{"verify_cmd":{"key":"verify_cmd","raw":"\"make check\"","value":"make check","line":4},"requires":{"key":"requires","raw":"[]","value":[],"line":5}}}]}}
   def uid(n):return "40000000-0000-0000-0000-"+str(n).zfill(12)
   sql="BEGIN ISOLATION LEVEL SERIALIZABLE;"+ddl
   sql+="INSERT INTO hyperfide.organisations(id,name) VALUES('"+uid(1)+"','domain21-fixture');"
   sql+="INSERT INTO hyperfide.projects(organisation_id,id,name) VALUES('"+uid(1)+"','"+uid(2)+"','fixture');"
   source="fixture source\\n"
   sql+="INSERT INTO hyperfide.spec_revisions(organisation_id,id,project_id,source_content,source_digest,document,schema_version) VALUES('"+uid(1)+"','"+uid(3)+"','"+uid(2)+"',E'"+source+"','sha256:'||encode(sha256(convert_to(E'"+source+"','UTF8')),'hex'),'"+json.dumps(document).replace("'","''")+"',1);"
   sql+="INSERT INTO hyperfide.runs(organisation_id,id,project_id,spec_revision_id,policy_digest,authority_epoch) VALUES('"+uid(1)+"','"+uid(4)+"','"+uid(2)+"','"+uid(3)+"','sha256:"+("a"*64)+"','"+uid(6)+"');COMMIT;"
   helper.sql(sql,database=helper.DATABASE);env=helper.database_env(helper.DATABASE)
  env["HF_FIXTURE_ROOT"]=str(ROOT)
  with tempfile.TemporaryDirectory(prefix="hf-domain21-") as directory:
   linked=service_probe(task,env,Path(directory))
   script=Path(directory)/"probe.mjs";script.write_text(NODE)
   result=subprocess.run(["node",str(script),task],cwd=ROOT,env=env,text=True,capture_output=True,timeout=120)
   print(result.stdout,end="",flush=True)
   if result.returncode and result.stderr:print(result.stderr[-2000:],file=sys.stderr)
   status=result.returncode if linked else 1
  if task=="21.4":
   # do_3 gate: real signed HTTPS service and a real 20.4 job flow, beyond the direct component object.
   signed=signed_authority_probe(include_legacy=True)
   durable=durable_job_probe()
   status=status or signed or durable
  return status
 finally:
  if helper:
   if "HYPERFIDE_RECEIPT_ID" not in os.environ and cleanup_task()!=0:raise RuntimeError("Disposable database cleanup failed")
  else:print(json.dumps({"type":"cleanup","complete":True,"resources":[]}),flush=True)

def ensure_semantic_fence_schema(f,service=None):
 # Trusted fixture setup applies actual pinned SQL, never handler DDL or an invented generation column.
 service=service or ROOT/"services/hyperfide"
 import hashlib
 migration=(service/"migrations/0004-durability.sql").read_bytes()
 present=f.sql("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='hyperfide' AND table_name='runs' AND column_name='semantic_generation') AS present")[0]["present"]
 if not present:f.sql(migration.decode())
 checksum="sha256:"+hashlib.sha256(migration).hexdigest()
 recorded=f.sql("SELECT checksum FROM hyperfide.schema_migrations WHERE name='0004-durability'")
 if recorded and recorded[0]["checksum"]!=checksum:raise RuntimeError("Fixture semantic migration checksum mismatch")
 if not recorded:f.sql("INSERT INTO hyperfide.schema_migrations(version,name,checksum) VALUES(4,'0004-durability',$1)",[checksum])


def apply_advisory_fixture_migration(f,name,service=None):
 # Trusted fixture only: verify the full-release ledger or apply these exact source bytes once.
 import hashlib
 service=service or ROOT/"services/hyperfide"
 data=(service/"migrations"/(name+".sql")).read_bytes()
 checksum="sha256:"+hashlib.sha256(data).hexdigest()
 existing=f.sql("SELECT name,checksum FROM hyperfide.schema_migrations WHERE version=$1",[int(name.split("-",1)[0])])
 if existing:
  if len(existing)!=1 or existing[0]["name"]!=name or existing[0]["checksum"]!=checksum:raise RuntimeError("Fixture migration pin mismatch: "+name)
  return
 f.sql(data.decode())
 f.sql("INSERT INTO hyperfide.schema_migrations(version,name,checksum) VALUES($1,$2,$3)",[int(name.split("-",1)[0]),name,checksum])



def seed_advisory_amendment_source(f,service):
 """Trusted accepted fixture compiled by the actual source importer; no validation result is supplied."""
 import hashlib,uuid
 source='[meta]\nslug = "advisory-fixture"\n[req.1]\nac_1 = "Required consumer contract"\n[acceptance.1]\nreq = "1.1"\nchecks = ["actual-check"]\n[task.1]\nwave = 1\nfeature = "fixture"\nreqs = ["1.1"]\nverify_cmd = "printf accepted"\nartifacts = ["proof.json"]\nacceptance_ids = ["1"]\nrequires = []\ntouches = ["src/a.ts"]\n[task.2]\nwave = 2\nfeature = "fixture"\nreqs = ["1.1"]\nverify_cmd = "printf accepted"\nartifacts = ["proof.json"]\nacceptance_ids = ["1"]\nrequires = ["1"]\ntouches = ["src/b.ts"]\n'
 executable=str(Path(sys.executable).resolve())
 source+='\n[proof]\nrubric_digest = '+json.dumps("sha256:"+hashlib.sha256(b"advisory-fixture-rubric").hexdigest())+'\n[proof.check.actual-check]\n'+''.join(key+' = '+json.dumps(value)+'\n' for key,value in {"argv":[executable,"-c","raise SystemExit(1)",""],"executable_digest":"sha256:"+hashlib.sha256(Path(executable).read_bytes()).hexdigest(),"timeout_ms":600000,"required_artifacts":["proof.json"],"input_keys":["source"]}.items())
 f.ids["repository"]=str(uuid.uuid4());f.ids["accepted_spec"]=str(uuid.uuid4())
 f.sql("INSERT INTO hyperfide.repositories(organisation_id,project_id,id,name,url,object_format) VALUES($1,$2,$3,'advisory-fixture','https://example.invalid/advisory.git','sha1')",[f.ids["organisation"],f.ids["project"],f.ids["repository"]])
 f.sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id,object_type) VALUES($1,$2,$3,'commit')",[f.ids["organisation"],f.ids["repository"],"a"*40])
 f.source=source;f.closure={"required_evidence":["actual-check"],"required_review_roles":["VERIFIER"],"publication":"AFTER_QUALIFICATION"}
 f.env["HF_SPEC_ALLOWED_ROOT"]=str(f.path)
 (f.path/"approved.kvx").write_text(source)
 envelope={"run_id":f.ids["run"],"source":{"relative_path":"approved.kvx","sha256":hashlib.sha256(source.encode()).hexdigest(),"size_bytes":str(len(source.encode()))},"repositories":[{"repository_id":f.ids["repository"],"source_object_id":"a"*40,"integration_ref":"refs/heads/main"}],"allowed_actions":f.actions,"closure_policy":f.closure,"provenance":None}
 scope={"organisation_id":f.ids["organisation"],"project_id":f.ids["project"],"run_id":f.ids["run"],"authority_epoch":f.ids["epoch"],"root":str(f.path),"allowed_actions":f.actions}
 script="import fs from 'node:fs';import{prepareAcceptedIntent}from "+json.dumps((service/"dist/spec/import.js").as_uri())+";const q=JSON.parse(fs.readFileSync(0,'utf8')),p=await prepareAcceptedIntent(q.scope,q.envelope);process.stdout.write(JSON.stringify({document:p.document,tasks:p.tasks,revision_digest:p.revision_digest}));"
 r=subprocess.run(["node","--input-type=module","-e",script],input=json.dumps({"scope":scope,"envelope":envelope}),cwd=ROOT,env=f.env,text=True,capture_output=True,timeout=20)
 if r.returncode:raise AssertionError("Actual accepted fixture preparation failed: "+r.stderr[-1200:])
 prepared=json.loads(r.stdout);revision=f.ids["accepted_spec"];source_digest="sha256:"+hashlib.sha256(source.encode()).hexdigest()
 f.sql("INSERT INTO hyperfide.spec_revisions(organisation_id,id,project_id,source_digest,source_content,document,schema_version,revision_digest) VALUES($1,$2,$3,$4,$5,$6,1,$7)",[f.ids["organisation"],revision,f.ids["project"],source_digest,source,prepared["document"],prepared["revision_digest"]])
 f.sql("INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) VALUES($1,$2,2,$3)",[f.ids["organisation"],f.ids["run"],revision])
 f.sql("UPDATE hyperfide.runs SET spec_revision_id=$3,spec_generation=2,state='PENDING_VALIDATION',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[f.ids["organisation"],f.ids["run"],revision])
 f.sql("INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES($1,$2,$3,$4,'refs/heads/main')",[f.ids["organisation"],f.ids["run"],f.ids["repository"],"a"*40])
 packages={}
 for task in prepared["tasks"]:
  if task["package_key"] not in packages:
   packages[task["package_key"]]=str(uuid.uuid4())
   f.sql("INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES($1,$2,$3,$4,$5)",[f.ids["organisation"],f.ids["run"],packages[task["package_key"]],task["package_key"],task["wave"]])
  f.ids["task"+task["key"]]=str(uuid.uuid4())
  definition={"schema_version":1,"section":task["section"],"feature_key":task["feature_key"],"declared_wave":task["declared_wave"],"runtime_wave_offset":prepared["document"]["runtime_wave_offset"],"declared_status":None,"history_only":True}
  criteria="sha256:"+hashlib.sha256(json.dumps({"source_digest":source_digest,"reqs":task["section"]["fields"]["reqs"]["value"]},sort_keys=True,separators=(",",":")).encode()).hexdigest()
  f.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,spec_generation,criteria_digest,definition,wave,state) VALUES($1,$2,$3,$4,$5,$6,2,$7,$8,$9,'PENDING')",[f.ids["organisation"],f.ids["run"],f.ids["task"+task["key"]],task["key"],packages[task["package_key"]],revision,criteria,definition,task["wave"]])


def signed_authority_probe(include_findings=False,include_amendment=False,include_legacy=False):
 """Real14 HTTPS+PG boundary;20 dependency intentionally unavailable, not model/job proof."""
 import hashlib,uuid
 identity_path=ROOT/"tests/hyperfide/support/identity_fixture.py"
 spec=importlib.util.spec_from_file_location("domain21_real_identity_fixture",identity_path)
 identity=importlib.util.module_from_spec(spec);spec.loader.exec_module(identity)
 track_probe_fixtures(identity)
 original_environment=os.environ.copy()
 os.environ.update(environment())
 try:
  with tempfile.TemporaryDirectory(prefix="hf-domain21-signed-") as folder:
   fixture_root=Path(folder);service=fixture_root/"services/hyperfide";service.mkdir(parents=True)
   shutil.copytree(ROOT/"services/hyperfide/dist",service/"dist")
   shutil.copytree(ROOT/"services/hyperfide/migrations",service/"migrations")
   if include_amendment:
    # Separate bounded component fixture: actual required schemas only, never a full-release receipt.
    required={"0001-authority.sql","0002-spec.sql","0004-durability.sql","0014-enrollment.sql","0021-decisions.sql","0202-spec-dependencies.sql"}
    for migration in (service/"migrations").glob("*.sql"):
     if migration.name not in required:migration.unlink()
   shutil.copytree(ROOT/"services/hyperfide/components",service/"components")
   shutil.copyfile(ROOT/"services/hyperfide/package.json",service/"package.json")
   (service/"node_modules").symlink_to(ROOT/"services/hyperfide/node_modules",target_is_directory=True)
   (service/"dist/fixture-unavailable-jobs.js").write_text("export function createComponent(){return {apiVersion:1,capabilities:{'decision.jobs.v1':{registerPurpose(){},completedAudit(){return {available:false,reason:'missing'}}}},actions:{'fixture.jobs.describe':()=>({authority:'NONE',qualification:'UNAVAILABLE_PRODUCER_FIXTURE'})}}}")
   (service/"components/20.4.json").write_text(json.dumps({"schema_version":1,"id":"20.4","task":"20.4","roles":["control"],"module":"fixture-unavailable-jobs.js","entry":"createComponent","api_version":1,"actions":["fixture.jobs.describe"],"requires":[]}))
   if include_findings:
    (service/"dist/fixture-unavailable-scheduler.js").write_text("export function createComponent(){return {apiVersion:1,capabilities:{'scheduler.resources.v1':{eligibleTasks:async()=>({availability:'UNAVAILABLE',reason:'EXPLICIT_UNAVAILABLE_SCHEDULER_FIXTURE',authority:'CANDIDATE_DISCOVERY'})}},actions:{'fixture.scheduler.describe':()=>({authority:'NONE',qualification:'UNAVAILABLE_PRODUCER_FIXTURE'})}}}")
    (service/"components/5.4.json").write_text(json.dumps({"schema_version":1,"id":"5.4","task":"5.4","roles":["control"],"module":"fixture-unavailable-scheduler.js","entry":"createComponent","api_version":1,"actions":["fixture.scheduler.describe"],"requires":[]}))
   identity.ROOT=fixture_root
   def setup(f):
    ensure_semantic_fence_schema(f,service)
    if include_findings:
     for name in ["0002-spec","0003-hierarchy","0017-review","0018-findings"]:
      apply_advisory_fixture_migration(f,name,service)
    apply_advisory_fixture_migration(f,"0021-decisions",service)
    if include_amendment:
     apply_advisory_fixture_migration(f,"0002-spec",service)
     apply_advisory_fixture_migration(f,"0202-spec-dependencies",service)
     seed_advisory_amendment_source(f,service)
     return
    revision=str(uuid.uuid4());f.ids["accepted_spec"]=revision
    source="Approved source-linked clause"
    document={"parsed":{"sections":[{"name":"req.1","line":1,"fields":{"ac_1":{"key":"ac_1","raw":'"Required consumer contract"',"value":"Required consumer contract","line":2}}}]}}
    f.sql("INSERT INTO hyperfide.spec_revisions(organisation_id,id,project_id,source_digest,source_content,document,schema_version) VALUES($1,$2,$3,$4,$5,$6,1)",[f.ids["organisation"],revision,f.ids["project"],identity.sha(source.encode()),source,document])
    f.sql("INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) VALUES($1,$2,2,$3)",[f.ids["organisation"],f.ids["run"],revision])
    f.sql("UPDATE hyperfide.runs SET spec_revision_id=$3,spec_generation=2,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[f.ids["organisation"],f.ids["run"],revision])
   finding_extra=("18.1","21.3","5.4")+(("3.1",) if "3.1" in json.loads((service/"components/18.1.json").read_text())["requires"] else ()) if include_findings else ()
   fixture=identity.IdentityFixture(extra_components=("20.4","21.4","21.1")+finding_extra,extra_setup=setup)
   try:
    f=fixture;scope={"organisation_id":f.ids["organisation"],"run_id":f.ids["run"]}
    def call(action,data,component="21.4",**kwargs):return f.invoke(action,{"scope":scope,**data},component=component,**kwargs)[1]
    packet_result=call("decision.spec.packet",{"clauses":[{"section":"req.1","field":"ac_1"}]},"21.1")
    if include_amendment:
     packet=packet_result["result"]
     def amendment(source):
      (f.path/"replacement.kvx").write_text(source)
      return {"run_id":f.ids["run"],"base_spec_revision_id":f.ids["accepted_spec"],"base_spec_generation":"2","state_version":"2","purpose":"REPLAN","reason":"Explicit fixture replacement; never accepted","replacement":{"run_id":f.ids["run"],"source":{"relative_path":"replacement.kvx","sha256":hashlib.sha256(source.encode()).hexdigest(),"size_bytes":str(len(source.encode()))},"repositories":[{"repository_id":f.ids["repository"],"source_object_id":"a"*40,"integration_ref":"refs/heads/main"}],"allowed_actions":f.actions,"closure_policy":f.closure,"provenance":None}}
     def analyse(source):
      return call("decision.spec.amendment.check",{"packet_id":packet["id"],"amendment":amendment(source)},"21.1")
     def positive():
      r=analyse(f.source.replace("[task.1]","[task.1]\ntitle = \"Replanned implementation\""))
      identity.expect(r.get("ok") is True,"Actual ordinary validation failed: "+str(r.get("error",{}).get("code")))
      result=r["result"];v=result["validation"]
      identity.expect(v["status"]=="STRUCTURALLY_VALID" and v["accepted"] is False and v["dispatch_authority"] is False and result["applied"] is False and set(v["impact"]["affected_task_ids"])=={f.ids["task1"],f.ids["task2"]},"Actual transitive impact/nonacceptance lost")
     identity.check("signed21.actual-amendment-validator-positive",positive)
     def invalid_graph():
      r=analyse(f.source.replace('requires = ["1"]','requires = ["missing"]'))
      identity.expect(r.get("ok") is True and r["result"]["validation"]["status"]=="INVALID","Invalid dependency became validated proposal")
     identity.check("signed21.actual-amendment-invalid-graph",invalid_graph)
     def weakened():
      r=analyse(f.source.replace("printf accepted","true"))
      identity.expect(r.get("ok") is True and r["result"]["validation"]["status"]=="INVALID" and any(d["code"]=="ACCEPTED_TASK_CHECK_CANNOT_BE_WEAKENED" for d in r["result"]["validation"]["diagnostics"]),"Accepted verification weakened")
     identity.check("signed21.actual-amendment-command-weakening",weakened)
     def stale():
      request=amendment(f.source);request["base_spec_generation"]="1"
      r=call("decision.spec.amendment.check",{"packet_id":packet["id"],"amendment":request},"21.1")
      identity.expect(r.get("ok") is False and r["error"]["code"]=="DECISION_STALE","Caller substituted amendment base")
     identity.check("signed21.actual-amendment-packet-base-fence",stale)
     def wrong_digest():
      request=amendment(f.source);request["replacement"]["source"]["sha256"]="f"*64
      r=call("decision.spec.amendment.check",{"packet_id":packet["id"],"amendment":request},"21.1")
      identity.expect(r.get("ok") is False and r["error"]["code"]=="DIGEST_MISMATCH","Unpinned replacement source trusted")
     identity.check("signed21.actual-amendment-source-digest",wrong_digest)
     def untouched():
      r=f.sql("SELECT spec_revision_id,spec_generation::text FROM hyperfide.runs WHERE id=$1",[f.ids["run"]])[0]
      identity.expect(r["spec_revision_id"]==f.ids["accepted_spec"] and r["spec_generation"]=="2" and f.sql("SELECT count(*)::int n FROM hyperfide.decision_proposals")[0]["n"]==0 and f.sql("SELECT count(*)::int n FROM hyperfide.tasks WHERE state<>'PENDING'")[0]["n"]==0,"Analysis accepted intent or released tasks")
     identity.check("signed21.actual-amendment-never-accepts",untouched)
    if include_findings:
     identity.check("signed21.actual-finding-component-linked",lambda:identity.expect(call("decision.ranking.describe",{},component="21.3").get("ok") is True,"actual named finding-registry component did not compose"))
     def read_context():
      body=f.invoke("finding.context.read",{"limit":8},component="finding-registry")[1]
      result=body.get("result",{})
      identity.expect(body.get("ok") is True and result.get("findings")==[] and result.get("observations")==[] and result.get("qualifies_findings") is False and result.get("context_digest","").startswith("sha256:"),"actual empty registry provenance reader failed: "+str(body.get("error",{}).get("code")))
      script="import fs from 'node:fs';import {findingSnapshot,findingAdviceEntries} from "+json.dumps((service/"dist/decisions/ranking.js").as_uri())+";const data=JSON.parse(fs.readFileSync(0,'utf8'));const actual=findingSnapshot(data.snapshot,data.scope);if(actual.availability!=='AVAILABLE'||findingAdviceEntries(actual).length!==0)throw Error('Actual producer output failed consumer contract');"
      observed=subprocess.run(["node","--input-type=module","-e",script],input=json.dumps({"snapshot":result,"scope":scope}),cwd=ROOT,env=f.env,text=True,capture_output=True,timeout=15)
      identity.expect(observed.returncode==0,"Actual finding output rejected by ranking adapter: "+observed.stderr[-1000:])

     identity.check("signed21.actual-finding-context-reader",read_context)
     def no_eligibility():
      result=call("decision.ranking.packet",{"pool_id":f.ids["pool"],"profile_id":None},component="21.3").get("result",{})
      identity.expect(result.get("status")=="UNAVAILABLE" and result.get("reason")=="EXPLICIT_UNAVAILABLE_SCHEDULER_FIXTURE" and not f.sql("SELECT id FROM hyperfide.decision_packets WHERE purpose='ranking'"),"unavailable scheduler manufactured ranking authority")
     identity.check("signed21.no-fabricated-ranking-candidate",no_eligibility)
    identity.check("signed21.actual-packet",lambda:identity.expect(packet_result.get("ok") is True,"actual signed clause packet refused: "+str(packet_result.get("error",{}))))
    if packet_result.get("ok") is not True:return 1
    packet=packet_result["result"];audit_id=str(uuid.uuid4())
    record={"id":audit_id,"packet_id":packet["id"],"packet_hash":packet["packet_hash"],"rubric_version":"fixture-rubric","calibration_version":None,"adapter_version":"unavailable-fixture","requested_model":"fixture","returned_model":None,"route":"fixture","status":"unavailable","raw_output":{"available":False,"reason":"producer intentionally absent"},"interpretation":{},"attempts":[],"latency_ms":0,"usage":{"source":"unknown"},"cost":{"source":"unknown"},"action":{"authority":"NONE","applied":False,"recommendation":None},"rejection_reason":"No model transport in this signed authority fixture"}
    identity.check("signed21.strict-null-json-record",lambda:identity.expect(call("decision.audit.record",{"record":record}).get("ok") is True,"signed null-prototype record refused"))
    identity.check("signed21.real-primary-inspect",lambda:identity.expect(call("decision.audit.inspect",{"id":audit_id}).get("result",{}).get("payload",{}).get("returned_model","missing") is None,"unknown observed model was invented"))
    identity.check("signed21.wire-advice-refused",lambda:identity.expect(call("decision.audit.record",{"record":{**record,"id":str(uuid.uuid4()),"status":"accepted_advice"}}).get("error",{}).get("code")=="DECISION_RESULT_REQUIRED","wire assertion gained advice trust"))
    wrong={**scope,"organisation_id":str(uuid.uuid4())}
    identity.check("signed21.cross-scope-refused",lambda:identity.expect(f.invoke("decision.audit.inspect",{"scope":wrong,"id":audit_id},component="21.4")[1].get("ok") is False,"cross organisation accepted"))
    identity.check("signed21.wrong-key-refused",lambda:identity.expect(f.request(f.operation("21.4","decision.audit.inspect",{"scope":scope,"id":audit_id}),key="other",credential=f.ids["operator"])[1].get("ok") is False,"wrong signing key accepted"))
    identity.check("signed21.missing-producer-abstains",lambda:identity.expect(call("decision.audit.capture",{"decision_id":str(uuid.uuid4()),"packet_id":packet["id"]}).get("error",{}).get("code")=="DECISION_RESULT_UNAVAILABLE","missing producer generated advice"))
    secret={**record,"id":str(uuid.uuid4()),"raw_output":{"text":"api_key=planted-private-value"}}
    identity.check("signed21.secret-not-persisted",lambda:identity.expect(call("decision.audit.record",{"record":secret}).get("error",{}).get("code")=="DECISION_SECRET" and not f.sql("SELECT id FROM hyperfide.decision_audits WHERE id=$1",[secret["id"]]),"credential-shaped output reached audit history"))
    if include_legacy:
     # 20.4 fixture exposes no submit capability: legacy client actions must abstain deterministically with authority NONE.
     expected_legacy=[f"decision.legacy.{p}.{phase}" for p in ("guard","readiness","triage","memory","recap") for phase in ("submit","result")]
     def legacy_declared():
      fragment=json.loads((service/"components/21.4.json").read_text())
      described=call("decision.audit.describe",{}).get("result",{})
      identity.expect(all(a in fragment["actions"] for a in expected_legacy) and described.get("legacy",{}).get("actions")==expected_legacy and described["legacy"]["authority"]=="NONE","legacy client actions are not declared/served")
      for action in expected_legacy:
       body=f.invoke(action,{},component="21.4")[1]
       identity.expect(body.get("ok") is False and body.get("error",{}).get("code")=="DECISION_INVALID","legacy action is not served by 21.4: "+action+" "+str(body.get("error")))
     identity.check("audit.legacy-actions-declared",legacy_declared)
     legacy_state={}
     def legacy_abstains():
      r=f.invoke("decision.legacy.guard.submit",{"observation":{"guard":"fixture-check","changed_paths":["src/a.c"]}},component="21.4")[1]
      identity.expect(r.get("ok") is True,"legacy submit failed: "+str(r.get("error")))
      result=r["result"];legacy_state.update(result)
      identity.expect(result["status"]=="unavailable" and result["reason"]=="decision-jobs-unavailable" and result["decision_id"] is None and result["authority"]=="NONE" and result["applied"] is False and result["recommendation"] is None,"missing jobs producer did not abstain: "+str(result))
      stored=f.sql("SELECT status,payload FROM hyperfide.decision_audits WHERE packet_id=$1",[result["packet_id"]])
      identity.expect(len(stored)==1 and stored[0]["status"]=="unavailable" and stored[0]["payload"]["action"]=={"authority":"NONE","applied":False,"recommendation":None} and stored[0]["payload"]["rubric_version"]=="hyperfide.legacy.guard.v1" and isinstance(stored[0]["payload"]["latency_ms"],(int,float)),"abstention audit record incomplete")
      identity.expect(not f.sql("SELECT 1 FROM hyperfide.decision_audits WHERE status='accepted_advice'"),"abstention produced accepted advice")
     identity.check("audit.legacy-submit-abstains-without-provider",legacy_abstains)
     def legacy_result():
      r=f.invoke("decision.legacy.guard.result",{"decision_id":str(uuid.uuid4()),"packet_id":legacy_state["packet_id"]},component="21.4")[1]
      identity.expect(r.get("ok") is True,"legacy result failed: "+str(r.get("error")))
      result=r["result"]
      identity.expect(result["status"]=="unavailable" and result["authority"]=="NONE" and result["applied"] is False and result["recommendation"] is None and result["leases"]==[] and result["waived_evidence"]==[] and result["publication"] is None and result["audit"] is None,"legacy result implied authority: "+str(result))
      wrong=f.invoke("decision.legacy.triage.result",{"decision_id":str(uuid.uuid4()),"packet_id":legacy_state["packet_id"]},component="21.4")[1]
      identity.expect(wrong.get("ok") is False and wrong["error"]["code"]=="DECISION_PURPOSE_MISMATCH","legacy result crossed purposes")
     identity.check("audit.legacy-result-no-authority",legacy_result)
     def legacy_input():
      before=f.sql("SELECT count(*)::int n FROM hyperfide.decision_packets")[0]["n"]
      r=f.invoke("decision.legacy.memory.submit",{"observation":{"note":"password=planted-private-value"}},component="21.4")[1]
      identity.expect(r.get("ok") is False and r["error"]["code"]=="DECISION_SECRET" and f.sql("SELECT count(*)::int n FROM hyperfide.decision_packets")[0]["n"]==before,"legacy observation secret reached a packet")
      r=f.invoke("decision.legacy.memory.submit",{"observation":{"note":"fine"},"authority":{"lease":"x"}},component="21.4")[1]
      identity.expect(r.get("ok") is False and r["error"]["code"]=="DECISION_INVALID","legacy wire authority field accepted")
     identity.check("audit.legacy-input-bounded",legacy_input)
     def no_grants():
      lease={**record,"id":str(uuid.uuid4()),"action":{"authority":"NONE","applied":False,"recommendation":{"lease_id":str(uuid.uuid4())}}}
      publish={**record,"id":str(uuid.uuid4()),"action":{"authority":"NONE","applied":False,"recommendation":None,"publish":"refs/heads/main"}}
      waive={**record,"id":str(uuid.uuid4()),"action":{"authority":"NONE","applied":False,"recommendation":{"nested":[{"waived_evidence":["actual-check"]}]}}}
      for row in (lease,publish,waive):
       r=call("decision.audit.record",{"record":row})
       identity.expect(r.get("ok") is False and r["error"]["code"]=="DECISION_AUTHORITY_DENIED" and not f.sql("SELECT 1 FROM hyperfide.decision_audits WHERE id=$1",[row["id"]]),"advisory record supplied a lease, waiver or publication: "+str(r.get("error")))
     identity.check("audit.advice-cannot-grant",no_grants)
    f.stop();f.start()
    identity.check("signed21.restart-history",lambda:identity.expect(call("decision.audit.inspect",{"id":audit_id}).get("result",{}).get("payload",{}).get("id")==audit_id,"actual service restart lost audit history"))
    identity.check("signed21.accepted-intent-preserved",lambda:identity.expect(f.sql("SELECT source_content FROM hyperfide.spec_revisions WHERE id=$1",[f.ids["accepted_spec"]])[0]["source_content"]==(f.source if include_amendment else "Approved source-linked clause"),"advice changed accepted intent"))
   finally:fixture.close()
   return int(any(actual!="observed" for _,actual in identity.RESULTS))
 finally:
  os.environ.clear();os.environ.update(original_environment)


def durable_job_probe():
 """Actual20/21/14/6/PG flow; controlled loopback provider, no live-model qualification."""
 import copy,importlib.util,json,os,shutil,uuid
 original_environment=os.environ.copy();os.environ.update(environment())
 spec=importlib.util.spec_from_file_location("domain21_actual_jobs_fixture",ROOT/"tests/hyperfide/cases/tasks/20_4.py")
 jobs=importlib.util.module_from_spec(spec);spec.loader.exec_module(jobs)
 track_probe_fixtures(jobs.identity)
 failed=[]
 def check(name,fn):
  try:fn();actual="observed"
  except Exception as error:failed.append(name);actual=type(error).__name__+": "+str(error)
  print(json.dumps({"type":"assertion","id":name,"expected":"observed","actual":actual}),flush=True)
 class AdvisoryFixture(jobs.Fixture):
  def start(self):
   if not getattr(self,"advisory_prepared",False):
    ensure_semantic_fence_schema(self)
    apply_advisory_fixture_migration(self,"0021-decisions")
    added=[]
    for ident in ["21.4","21.1"]:
     fragment=ROOT/("services/hyperfide/components/"+ident+".json")
     shutil.copyfile(fragment,self.components/(ident+".json"));added+=json.loads(fragment.read_text())["actions"]
    policy=json.loads(self.policy.read_text());policy["allowed_actions"]+=added;self.policy.write_text(json.dumps(policy))
    config=json.loads(self.identity_config.read_text())
    for principal in config["principals"]:
     principal["allowed_actions"]+=added
     self.sql("UPDATE hyperfide.identity_principals SET allowed_actions=$1 WHERE credential_id=$2 AND organisation_id=$3 AND run_id=$4",[principal["allowed_actions"],principal["credential_id"],self.ids["organisation"],self.ids["run"]])
    self.identity_config.write_text(json.dumps(config));self.actions+=added
    self.ids["accepted_spec"]=jobs.uid()
    source="Approved exact advisory source"
    document={"parsed":{"sections":[{"name":"req.1","line":1,"fields":{"ac_1":{"key":"ac_1","raw":'"Verify consumer contract"',"value":"Verify consumer contract","line":2}}}]}}
    self.sql("INSERT INTO hyperfide.spec_revisions(organisation_id,id,project_id,source_digest,source_content,document,schema_version) VALUES($1,$2,$3,$4,$5,$6,1)",[self.ids["organisation"],self.ids["accepted_spec"],self.ids["project"],"sha256:"+__import__("hashlib").sha256(source.encode()).hexdigest(),source,document])
    self.sql("INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) VALUES($1,$2,2,$3)",[self.ids["organisation"],self.ids["run"],self.ids["accepted_spec"]])
    self.sql("UPDATE hyperfide.runs SET spec_revision_id=$3,spec_generation=2,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[self.ids["organisation"],self.ids["run"],self.ids["accepted_spec"]])
    self.advisory_prepared=True
   super().start()
 fixture=None
 try:
  fixture=AdvisoryFixture(settings={"allowed_purposes":{"fixture-review":["span-native"],"spec_critique":["span-native"],"legacy.guard":["span-native"]}})
  f=fixture;scope={"organisation_id":f.ids["organisation"],"run_id":f.ids["run"]}
  packet=f.call("decision.spec.packet",{"scope":scope,"clauses":[{"section":"req.1","field":"ac_1"}]},component="21.1")
  check("jobs21.common-revision-packet",lambda:jobs.expect(packet["revision"]["spec_revision"]==f.ids["accepted_spec"] and packet["state"]["primary_revision"]["spec_generation"]=="2","canonical packet lost accepted pins"))
  submission={"purpose":"spec_critique","input":{"packet_id":packet["id"]},"route_ids":["span-native"],"deadline_ms":10000,"mode":"background"}
  admitted=f.call("decision.jobs.submit",submission);decision=admitted["decision_id"]
  check("jobs21.actual-durable-admission",lambda:jobs.expect(admitted["state"]=="QUEUED" and not f.provider.received,"submission was not durable/provider-free"))
  stored=f.sql("SELECT packet_hash,packet FROM hyperfide.decision_jobs WHERE id=$1",[decision])[0]
  check("jobs21.exact-common-hash",lambda:jobs.expect(stored["packet_hash"]==packet["packet_hash"] and "packet_hash"not in stored["packet"],"own audit and durable job bind different packets"))
  result=f.process(decision)
  check("jobs21.actual-provider-typed-questions",lambda:jobs.expect(len(f.provider.received)==1 and len(f.provider.received[0]["questions"])==5 and "Verify consumer contract"in json.dumps(f.provider.received[0]["state"]),"actual provider transport lost clause/questions"))
  payload=result["result"]["payload"]
  check("jobs21.no-calibration-abstains",lambda:jobs.expect(payload["status"]=="abstained" and payload["calibration_version"]is None,"uncalibrated fixture became authoritative advice"))
  audit=f.call("decision.audit.capture",{"scope":scope,"decision_id":decision,"packet_id":packet["id"]},component="21.4")
  check("jobs21.capture-real-server-result",lambda:jobs.expect(audit["id"]==decision and audit["packet_hash"]==stored["packet_hash"] and len(audit["raw_output"]["answers"])==5 and audit["authority"]=="NONE","server-owned result failed immutable audit capture"))
  check("jobs21.actual-abstention-flags",lambda:jobs.expect(f.call("decision.spec.flags",{"scope":scope,"audit_id":decision},component="21.1")["status"]=="ABSTAINED","uncalibrated answers became findings"))
  check("jobs21.actual-abstention-proposal",lambda:jobs.expect(f.call("decision.spec.propose",{"scope":scope,"audit_id":decision,"findings":[]},component="21.1")["state"]=="ABSTAINED" and not f.sql("SELECT id FROM hyperfide.decision_proposals"),"uncalibrated result mutated accepted proposal authority"))
  inspected=f.call("decision.audit.inspect",{"scope":scope,"id":decision},component="21.4")
  check("jobs21.raw-provenance-preserved",lambda:jobs.expect(inspected["payload"]["returned_model"]=="span-02" and inspected["payload"]["cost"]["invoice_reconciled"]is False and inspected["payload"]["action"]["applied"]is False,"raw model/cost/action provenance was invented"))
  forged=copy.deepcopy(audit);forged.pop("authority",None);forged["id"]=jobs.uid();forged["status"]="accepted_advice"
  check("jobs21.wire-trust-refused",lambda:f.reject("decision.audit.record",{"scope":scope,"record":forged},"DECISION_RESULT_REQUIRED",component="21.4"))
  def legacy_real():
   r=f.call("decision.legacy.guard.submit",{"observation":{"guard":"fixture-check","changed_paths":["src/a.c"]}},component="21.4")
   jobs.expect(r["status"]=="QUEUED" and r["decision_id"] and r["authority"]=="NONE" and r["applied"] is False and r["audit"] is None,"legacy submit did not admit a durable 20.4 job: "+str(r))
   job=f.sql("SELECT purpose,packet_hash,route_ids,mode FROM hyperfide.decision_jobs WHERE id=$1",[r["decision_id"]])
   jobs.expect(len(job)==1 and job[0]["purpose"]=="legacy.guard" and job[0]["packet_hash"]==r["packet_hash"] and job[0]["route_ids"]==["span-native"] and job[0]["mode"]=="online","legacy job lost packet/route/deadline binding")
   pending=f.call("decision.legacy.guard.result",{"decision_id":r["decision_id"],"packet_id":r["packet_id"]},component="21.4")
   jobs.expect(pending["status"]=="pending" and pending["audit"] is None and pending["authority"]=="NONE","queued legacy job reported a result")
   f.process(r["decision_id"])
   done=f.call("decision.legacy.guard.result",{"decision_id":r["decision_id"],"packet_id":r["packet_id"]},component="21.4")
   audit=done["audit"]
   jobs.expect(done["status"]=="abstained" and audit["id"]==r["decision_id"] and audit["packet_hash"]==r["packet_hash"] and audit["returned_model"]=="span-02" and audit["action"]=={"authority":"NONE","applied":False,"recommendation":None} and done["recommendation"] is None and done["leases"]==[] and done["publication"] is None,"legacy result did not capture the server-owned audit: "+str(done))
   again=f.call("decision.legacy.guard.result",{"decision_id":r["decision_id"],"packet_id":r["packet_id"]},component="21.4")
   jobs.expect(again["audit"]==audit and len(f.sql("SELECT id FROM hyperfide.decision_audits WHERE id=$1",[r["decision_id"]]))==1,"legacy result replay changed history")
  check("jobs21.legacy-submit-real-job",legacy_real)
  def legacy_egress():
   before=f.sql("SELECT count(*)::int n FROM hyperfide.decision_jobs")[0]["n"]
   r=f.call("decision.legacy.recap.submit",{"observation":{"recap":"fixture"}},component="21.4")
   jobs.expect(r["status"]=="unsupported" and r["reason"]=="egress-denied" and r["decision_id"] is None and r["authority"]=="NONE","egress-denied legacy purpose was submitted: "+str(r))
   jobs.expect(f.sql("SELECT count(*)::int n FROM hyperfide.decision_jobs")[0]["n"]==before,"egress-denied purpose created a durable job")
  check("jobs21.legacy-egress-denied-abstains",legacy_egress)
  def egress_never_accepted():
   sent=len(f.provider.received)
   denied=f.call("decision.spec.packet",{"scope":scope,"clauses":[{"section":"req.1","field":"ac_1"}]},component="21.1")
   f.reject("decision.jobs.submit",{"purpose":"spec_critique","input":{"packet_id":denied["id"]},"route_ids":["jev-native"],"deadline_ms":10000,"mode":"background"},"DECISION_EGRESS_DENIED")
   jobs.expect(not f.sql("SELECT id FROM hyperfide.decision_jobs WHERE packet_hash=$1",[denied["packet_hash"]]) and len(f.provider.received)==sent,"egress-denied job was admitted or sent")
   f.reject("decision.audit.capture",{"scope":scope,"decision_id":jobs.uid(),"packet_id":denied["id"]},"DECISION_RESULT_UNAVAILABLE",component="21.4")
   forged={"id":jobs.uid(),"packet_id":denied["id"],"packet_hash":denied["packet_hash"],"rubric_version":"hyperfide.spec_critique.v1","calibration_version":"forged","adapter_version":"forged","requested_model":"jev-1.14.0","returned_model":"jev-1.14.0","route":"jev-native","status":"accepted_advice","raw_output":{},"interpretation":{},"attempts":[],"latency_ms":1,"usage":{},"cost":{},"action":{"authority":"NONE","applied":False,"recommendation":{}},"rejection_reason":None}
   f.reject("decision.audit.record",{"scope":scope,"record":forged},"DECISION_RESULT_REQUIRED",component="21.4")
   jobs.expect(not f.sql("SELECT id FROM hyperfide.decision_audits WHERE packet_id=$1 OR status='accepted_advice'",[denied["id"]]),"egress-denied route produced accepted advice")
  check("jobs21.egress-denied-never-accepted",egress_never_accepted)
  f.advance()
  check("jobs21.stale-real-job-capture",lambda:f.reject("decision.audit.capture",{"scope":scope,"decision_id":decision,"packet_id":packet["id"]},"DECISION_STALE",component="21.4"))
  check("jobs21.accepted-source-preserved",lambda:jobs.expect(f.sql("SELECT source_content FROM hyperfide.spec_revisions WHERE id=$1",[f.ids["accepted_spec"]])[0]["source_content"]=="Approved exact advisory source","job advice changed accepted source"))
 except Exception as error:check("jobs21.setup",lambda:(_ for _ in()).throw(error))
 finally:
  if fixture:fixture.close()
  os.environ.clear();os.environ.update(original_environment)
 return int(bool(failed))

if __name__=="__main__":sys.exit(run_task("21.4"))
