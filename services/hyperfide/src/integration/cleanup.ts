import fs from 'node:fs/promises';
import path from 'node:path';
import type {DB,IntegrationConfig,Scope} from './candidates.js';
import {git,keys,obj,scope,tx,values} from './candidates.js';

/** Idempotent cleanup for terminal or abandoned integration candidates/jobs.
 * Only leftovers this service can observe and remove are reported as removed;
 * anything it cannot reach or must not touch yet is explicit debt, never success. */
export interface CleanupDebt {kind:string;resource:string;reason:string}
const REF_PREFIX='refs/hyperfide/integration/';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BUNDLE=/^candidate-transfer-([0-9a-f-]{36})\.bundle$/;
const TERMINAL_JOB=['SUCCEEDED','FAILED','CANCELLED'],ACTIVE_JOB=['RUNNING','OUTCOME_UNKNOWN'],TERMINAL_CANDIDATE=['FAILED','CANCELLED','PUBLISHED'];

/** Reservations held only by terminal integration jobs return to the resource
 * authority (RELEASE_PENDING; the resource reconciler confirms quiescence). */
export async function releaseTerminalReservations(db:DB,s:Scope,jobId?:string):Promise<string[]>{
 const released=await db.query(`UPDATE hyperfide.reservations r SET state='RELEASE_PENDING',state_version=r.state_version+1
 WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.state IN('PROVISIONING','ALLOCATED') AND r.attempt_id IS NULL
 AND EXISTS(SELECT 1 FROM hyperfide.integration_jobs j WHERE j.organisation_id=r.organisation_id AND j.run_id=r.run_id AND j.reservation_id=r.id AND j.state=ANY($3::text[]) AND ($5::uuid IS NULL OR j.id=$5))
 AND NOT EXISTS(SELECT 1 FROM hyperfide.integration_jobs j WHERE j.organisation_id=r.organisation_id AND j.run_id=r.run_id AND j.reservation_id=r.id AND j.state=ANY($4::text[]))
 AND NOT EXISTS(SELECT 1 FROM hyperfide.integration_scope_jobs j WHERE j.organisation_id=r.organisation_id AND j.run_id=r.run_id AND j.reservation_id=r.id AND j.state=ANY($4::text[]))
 RETURNING r.id`,[...values(s),TERMINAL_JOB,ACTIVE_JOB,jobId??null]);
 return released.rows.map(r=>String(r.id)).sort();
}
async function refs(directory:string):Promise<string[]>{
 const listed=await git(directory,['for-each-ref','--format=%(refname)',REF_PREFIX]);return listed.split('\n').filter(Boolean);
}
export async function cleanupIntegration(pool:DB,cfg:IntegrationConfig,input:unknown):Promise<unknown>{
 const v=obj(input);keys(v,['organisation_id','run_id']);const s=scope(v);
 const observed=await tx(pool,async db=>{
  const released=await releaseTerminalReservations(db,s);
  const active=(await db.query("SELECT request_id,execution_manifest FROM hyperfide.integration_preparations WHERE organisation_id=$1 AND state IN('PREPARING','OUTCOME_UNKNOWN')",[s.organisation_id])).rows;
  const busyRepositories=new Set<string>(),busyCandidates=new Set<string>();
  for(const p of active)for(const entry of Array.isArray(p.execution_manifest)?p.execution_manifest:[]){busyRepositories.add(String(entry?.repository_id));busyCandidates.add(String(entry?.candidate_id));}
  const running=(await db.query("SELECT j.id,j.reservation_id,j.state,j.execution_manifest,c.state AS candidate_state,m.manifest->'required_gates' AS gates,EXTRACT(EPOCH FROM clock_timestamp()-j.created_at)*1000 AS age_ms FROM hyperfide.integration_jobs j JOIN hyperfide.integration_candidates c ON c.organisation_id=j.organisation_id AND c.run_id=j.run_id AND c.id=j.candidate_id JOIN hyperfide.integration_candidate_manifests m ON m.organisation_id=c.organisation_id AND m.run_id=c.run_id AND m.candidate_id=c.id WHERE j.organisation_id=$1 AND j.run_id=$2 AND j.state=ANY($3::text[]) ORDER BY j.id",[...values(s),ACTIVE_JOB])).rows;
  const debt:CleanupDebt[]=[];
  for(const job of running){
   const budget=(Array.isArray(job.gates)?job.gates:[]).reduce((sum:number,g:Record<string,unknown>)=>sum+Number(g?.timeout_ms??0)+60000,0);
   if(!TERMINAL_CANDIDATE.includes(job.candidate_state)&&Number(job.age_ms)<=budget)continue;
   // A remote process that never reported cleanup may still hold its runner
   // workspace; the control host cannot observe or remove it.
   debt.push({kind:'REMOTE_JOB_OUTCOME_UNKNOWN',resource:'integration_job:'+job.id,reason:'Abandoned '+job.state+' job; remote outcome/cleanup unobserved; reservation '+job.reservation_id+' stays held until integration.candidate.reconcile settles it'});
   for(const entry of Array.isArray(job.execution_manifest)?job.execution_manifest:[]){const operation=entry?.remote?.plan?.operation_id;if(typeof operation==='string'&&UUID.test(operation))debt.push({kind:'REMOTE_WORKSPACE_UNREACHABLE',resource:'/tmp/hyperfide/integration-'+operation,reason:'Remote runner workspace is not reachable from the control host'});}
  }
  return {released,busyRepositories,busyCandidates,debt};
 });
 const debt=observed.debt,deletedRefs:{repository_id:string;directory:string;ref:string}[]=[],removedPaths:string[]=[];
 for(const r of cfg.repositories){
  for(const directory of [r.path,...(r.receive_path?[r.receive_path]:[])]){
   let leftovers:string[];
   try{leftovers=(await refs(directory)).filter(ref=>UUID.test(ref.slice(REF_PREFIX.length)));}
   catch(error){debt.push({kind:'GIT_REPOSITORY_UNREACHABLE',resource:directory,reason:String((error as Error).message).slice(0,300)});continue;}
   for(const ref of leftovers){
    if(observed.busyRepositories.has(r.repository_id)){debt.push({kind:'CANDIDATE_REF_IN_USE',resource:directory+':'+ref,reason:'Repository has an unsettled candidate preparation'});continue;}
    try{await git(directory,['update-ref','-d',ref]);}catch{/* absence is re-observed below */}
    if((await refs(directory).catch(()=>[ref])).includes(ref))debt.push({kind:'CANDIDATE_REF_PRESENT',resource:directory+':'+ref,reason:'Ref deletion was not observed'});
    else deletedRefs.push({repository_id:r.repository_id,directory,ref});
   }
  }
 }
 let entries:string[]=[];
 try{entries=(await fs.readdir(cfg.root)).sort();}catch(error){debt.push({kind:'CANDIDATE_ROOT_UNREACHABLE',resource:cfg.root,reason:String((error as Error).message).slice(0,300)});}
 for(const name of entries){
  const match=BUNDLE.exec(name);if(!match||!UUID.test(match[1]!))continue;const filename=path.join(cfg.root,name);
  if(observed.busyCandidates.has(match[1]!)){debt.push({kind:'CANDIDATE_TRANSFER_IN_USE',resource:filename,reason:'Candidate preparation is unsettled'});continue;}
  await fs.rm(filename,{force:true}).catch(()=>undefined);
  if(await fs.lstat(filename).then(()=>true,()=>false))debt.push({kind:'CANDIDATE_TRANSFER_PRESENT',resource:filename,reason:'Removal was not observed'});else removedPaths.push(filename);
 }
 return {organisation_id:s.organisation_id,run_id:s.run_id,complete:debt.length===0,deleted_refs:deletedRefs,removed_paths:removedPaths,released_reservations:observed.released.map(id=>({reservation_id:id,state:'RELEASE_PENDING',resources_still_counted:true})),debt};
}
