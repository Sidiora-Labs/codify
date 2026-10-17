import fs from 'node:fs/promises';
import {constants as C} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createResourceContainer} from './storage/runtime.js';
import {bootstrapAcceptedIntentWithGateway} from './spec/bootstrap.js';
import type {SpecScope} from './spec/import.js';
import {issueOfflineOperator,assertBootstrapExternalAuthority} from './bootstrap_identity.js';
import {recoverBootstrapOperator} from './bootstrap_recovery.js';
import {exact,fail,strictJSON,uuid} from './transport/protocol.js';

async function privateInput(filename:string):Promise<Buffer>{
 if(!path.isAbsolute(filename)||filename.split('/').some(part=>part==='.'||part==='..'))fail('BOOTSTRAP_INPUT_INVALID','An absolute private input file is required');
 let directory=await fs.open('/',C.O_RDONLY|C.O_DIRECTORY|C.O_NOFOLLOW);
 try{
  const parts=filename.split('/').filter(Boolean),leaf=parts.pop()!;
  for(const part of parts){const next=await fs.open('/proc/self/fd/'+directory.fd+'/'+part,C.O_RDONLY|C.O_DIRECTORY|C.O_NOFOLLOW);await directory.close();directory=next;}
  const file=await fs.open('/proc/self/fd/'+directory.fd+'/'+leaf,C.O_RDONLY|C.O_NOFOLLOW|C.O_NONBLOCK);
  try{
   const before=await file.stat({bigint:true});
   if(!before.isFile()||before.nlink!==1n||before.size>2097152n||(Number(before.mode)&0o077)!==0||Number(before.uid)!==process.getuid?.())
    fail('BOOTSTRAP_INPUT_INVALID','Input must be a bounded private owner file');
   const bytes=await file.readFile(),after=await file.stat({bigint:true});
   if(before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)fail('BOOTSTRAP_INPUT_CHANGED','Input changed during inspection');
   return bytes;
  }finally{await file.close();}
 }finally{await directory.close();}
}
async function recoverCommand(input:unknown,policy:{deployment_id:string;max_ttl_ms:number;journal_dir:string},env:Readonly<NodeJS.ProcessEnv>,signal?:AbortSignal):Promise<unknown>{
 exact(input,['schema_version','scope','recovery']);
 if(input.schema_version!==1)fail('INVALID_REQUEST','Unsupported bootstrap recovery input version');
 exact(input.scope,['organisation_id','run_id','authority_epoch']);
 exact(input.recovery,['recovery_id','previous_credential_id','reason','credential_id','actor_id','public_key_b64','allowed_actions','expires_at']);
 const controller=new AbortController(),stop=()=>controller.abort();
 if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',stop,{once:true});
 const resources=createResourceContainer({role:'control',env,signal:controller.signal});
 try{
  const credential=await recoverBootstrapOperator(resources,{...input.scope,...input.recovery},policy,controller.signal);
  return {schema_version:1,recovery:credential,private_key_created:false,services_activated:false};
 }finally{controller.abort();signal?.removeEventListener('abort',stop);await resources.close();}
}
export async function bootstrapCommand(args:readonly string[],env:Readonly<NodeJS.ProcessEnv>=Object.freeze({...process.env}),signal?:AbortSignal):Promise<unknown>{
 const recover=args.length===3&&args[0]==='--recover';
 if(recover)args=args.slice(1);
 if(args.length!==2||args[0]!=='--input')fail('INVALID_REQUEST','Usage: hyperfide bootstrap [--recover] --input /absolute/private.json');
 if(env.HYPERFIDE_MODE==='offline'||env.HYPERFIDE_MODE==='local')fail('PRIMARY_REQUIRED','Offline observation or local mode cannot issue authority');
 const deployment=env.HYPERFIDE_DEPLOYMENT_ID,ttl=env.HYPERFIDE_BOOTSTRAP_MAX_TTL_MS,root=env.HYPERFIDE_BOOTSTRAP_SOURCE_ROOT,journalDir=env.HYPERFIDE_AUTHORITY_JOURNAL_DIR;
 if(!uuid(deployment)||!ttl||!/^[1-9][0-9]*$/.test(ttl)||!Number.isSafeInteger(Number(ttl))||Number(ttl)>2147483647||
    !root||!path.isAbsolute(root)||!journalDir||!path.isAbsolute(journalDir))fail('BOOTSTRAP_POLICY_REQUIRED','Trusted deployment, source root and bounded expiry policy are required');
 const input=strictJSON(await privateInput(args[1]!),2097152);
 if(recover)return recoverCommand(input,{deployment_id:deployment,max_ttl_ms:Number(ttl),journal_dir:journalDir},env,signal);
 exact(input,['schema_version','scope','metadata','accepted_intent','credential']);
 if(input.schema_version!==1)fail('INVALID_REQUEST','Unsupported bootstrap input version');
 exact(input.scope,['organisation_id','project_id','run_id','authority_epoch','allowed_actions']);
 const s=input.scope;
 if(!uuid(s.organisation_id)||!uuid(s.project_id)||!uuid(s.run_id)||!uuid(s.authority_epoch)||
    !Array.isArray(s.allowed_actions)||s.allowed_actions.some(x=>typeof x!=='string'))fail('INVALID_REQUEST','Explicit accepted-intent scope is required');
 exact(input.credential,['credential_id','actor_id','public_key_b64','allowed_actions','expires_at']);
 const scope:SpecScope={organisation_id:s.organisation_id,project_id:s.project_id,run_id:s.run_id,authority_epoch:s.authority_epoch,root,allowed_actions:s.allowed_actions as string[]};
 const controller=new AbortController(),stop=()=>controller.abort();
 if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',stop,{once:true});
 const resources=createResourceContainer({role:'control',env,signal:controller.signal});
 try{
  // Importer owns the accepted-intent transaction. Issuance rechecks that exact result in its own primary transaction.
  const authorityPolicy={deployment_id:deployment,max_ttl_ms:Number(ttl),journal_dir:journalDir};
  await assertBootstrapExternalAuthority(resources,authorityPolicy,controller.signal);
  const accepted=await bootstrapAcceptedIntentWithGateway(resources.gateway,scope,input.metadata,input.accepted_intent,deployment);
  if(typeof accepted!=='object'||accepted===null||!('revision_digest' in accepted)||typeof accepted.revision_digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(accepted.revision_digest))fail('BOOTSTRAP_IMPORT_RESULT_INVALID','Accepted importer result must contain its exact verified revision digest');
  const credential=await issueOfflineOperator(resources,{
   ...input.credential,organisation_id:scope.organisation_id,run_id:scope.run_id,deployment_epoch:scope.authority_epoch,
   accepted_revision_digest:accepted.revision_digest
  },authorityPolicy,controller.signal);
  return {schema_version:1,accepted_intent:accepted,credential,private_key_created:false,services_activated:false};
 }finally{controller.abort();signal?.removeEventListener('abort',stop);await resources.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGTERM',stop);process.once('SIGINT',stop);
 try{process.stdout.write(JSON.stringify({ok:true,result:await bootstrapCommand(process.argv.slice(2),Object.freeze({...process.env}),controller.signal)})+'\n');}
 catch(error){const code=typeof error==='object'&&error!==null&&'code' in error&&typeof error.code==='string'?error.code:'BOOTSTRAP_FAILED';
  process.stderr.write(JSON.stringify({ok:false,error:{code},local_fallback:false})+'\n');process.exitCode=78;}
 finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
