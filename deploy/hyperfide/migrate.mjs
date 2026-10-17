#!/usr/bin/env node
/** Explicit operator job delegates the sole 4.4 migrator. No SQL is authored here. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function fail(code){throw Object.assign(new Error(code),{code});}
async function regular(filename,privateFile=false){
 const st=await fs.lstat(filename);
 if(!st.isFile()||st.isSymbolicLink()||privateFile&&(st.uid!==process.getuid?.()||(st.mode&0o077)!==0))fail('MIGRATION_JOB_INPUT_INVALID');
 return filename;
}
async function main(){
 const options={};let action;
 for(let i=2;i<process.argv.length;i++){
 const arg=process.argv[i];
 if(arg==='--apply'||arg==='--inspect'){if(action)fail('MIGRATION_JOB_INPUT_INVALID');action=arg==='--apply'?'storage.migrations.apply':'storage.migrations.inspect';continue;}
 if(!['--release-root','--policy-file','--spec-revision','--operation-id'].includes(arg)||options[arg]!==undefined||!process.argv[i+1])fail('MIGRATION_JOB_INPUT_INVALID');
 options[arg]=process.argv[++i];
 }
 if(!action||Object.keys(options).length!==4||!uuid.test(options['--operation-id'])||!path.isAbsolute(options['--release-root'])||!path.isAbsolute(options['--policy-file'])||!options['--spec-revision']||options['--spec-revision'].length>256||/[\x00-\x1f]/.test(options['--spec-revision']))fail('MIGRATION_JOB_INPUT_INVALID');
 const root=await fs.realpath(options['--release-root']),node=await regular(path.join(root,'runtime/node')),entry=await regular(path.join(root,'services/dist/control.js')),policy=await regular(options['--policy-file'],true);
 if(!process.env.DATABASE_URL||!process.env.HYPERFIDE_MIGRATION_DATABASE_URL)fail('MIGRATION_JOB_CREDENTIAL_REQUIRED');
 const area=await fs.mkdtemp(path.join(os.tmpdir(),'hyperfide-migration-job-'));await fs.chmod(area,0o700);
 let child;
 try{
 for(const id of ['4.2','4.4']){
 const source=await regular(path.join(root,'services/components',id+'.json'));
 const bytes=await fs.readFile(source);if(bytes.length>65536)fail('MIGRATION_JOB_INPUT_INVALID');
 const fragment=JSON.parse(bytes.toString('utf8'));
 if(fragment.id!==id||fragment.api_version!==1||!Array.isArray(fragment.requires)||fragment.requires.some(value=>value!=='4.2'))fail('MIGRATION_JOB_INPUT_INVALID');
 await fs.writeFile(path.join(area,id+'.json'),bytes,{mode:0o600,flag:'wx'});
 }
 const env={LANG:'C.UTF-8',TZ:'UTC',HYPERFIDE_MIGRATION_JOB:'1',HYPERFIDE_MIGRATION_TIMEOUT_MS:'30000',LD_LIBRARY_PATH:path.join(root,'lib/hyperfide')};
 for(const key of ['DATABASE_URL','HYPERFIDE_MIGRATION_DATABASE_URL','PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE','PGSSLROOTCERT','PGSSLCERT','PGSSLKEY'])if(process.env[key]!==undefined)env[key]=process.env[key];
 const args=[entry,'--policy',policy,'--spec-revision',options['--spec-revision'],'--components',area,'--module-root',path.join(root,'services/dist')];
 child=spawn(node,args,{cwd:root,env,stdio:['pipe','pipe','pipe'],shell:false});
 const output=[];let bytes=0,invalid=false,timedOut=false,stderrBytes=0;
 child.stdout.on('data',part=>{bytes+=part.length;if(bytes>1024*1024){invalid=true;child.kill('SIGTERM');}else output.push(part);});
 child.stderr.on('data',part=>{stderrBytes+=part.length;if(stderrBytes>1024*1024){invalid=true;child.kill('SIGTERM');}});
 child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({id:options['--operation-id'],component:'4.4',action,input:{}})+'\n');
 let hardKill;
 const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');hardKill=setTimeout(()=>child.kill('SIGKILL'),5000);},45000);
 const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));}).finally(()=>{clearTimeout(timer);if(hardKill)clearTimeout(hardKill);});
 if(timedOut||invalid||exit.code===null)fail('MIGRATION_JOB_OUTCOME_UNKNOWN');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(output));const lines=text.trim().split('\n');
 if(lines.length!==1)fail('MIGRATION_JOB_OUTCOME_UNKNOWN');
 let response;try{response=JSON.parse(lines[0]);}catch{fail('MIGRATION_JOB_OUTCOME_UNKNOWN');}
 if(response.id!==options['--operation-id']||typeof response.ok!=='boolean')fail('MIGRATION_JOB_OUTCOME_UNKNOWN');
 if(response.ok!==true){
 const code=typeof response.error?.code==='string'&&/^[A-Z0-9_]{1,128}$/.test(response.error.code)?response.error.code:'MIGRATION_JOB_OUTCOME_UNKNOWN';
 const unknown=code.includes('AMBIGUOUS')||code.includes('UNKNOWN');
 process.stdout.write(JSON.stringify({ok:false,outcome:unknown?'UNKNOWN':'FAILED',operation_id:options['--operation-id'],error:{code},automatic_replay:false,reconcile:'INSPECT_EXACT_MIGRATION_LEDGER',authority_activated:false})+'\n');return unknown?75:1;
 }
 if(exit.code!==0||response.result?.outcome==='UNKNOWN')fail('MIGRATION_JOB_OUTCOME_UNKNOWN');
 process.stdout.write(JSON.stringify({ok:true,outcome:'SUCCEEDED',operation_id:options['--operation-id'],action,receipt:response.result,authority_activated:false,build_on_supervision_host:false})+'\n');return 0;
 }finally{
 if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
 await fs.rm(area,{recursive:true,force:true});
 }
}
try{process.exitCode=await main();}
catch(error){
 const code=typeof error?.code==='string'&&/^[A-Z0-9_]{1,128}$/.test(error.code)?error.code:'MIGRATION_JOB_OUTCOME_UNKNOWN',unknown=code.includes('UNKNOWN')||code.includes('AMBIGUOUS');
 process.stdout.write(JSON.stringify({ok:false,outcome:unknown?'UNKNOWN':'FAILED',error:{code},automatic_replay:false,reconcile:'INSPECT_EXACT_MIGRATION_LEDGER',authority_activated:false})+'\n');process.exitCode=unknown?75:1;
}
