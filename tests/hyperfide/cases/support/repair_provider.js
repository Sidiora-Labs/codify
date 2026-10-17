import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const digest=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
// Controlled provider transport only. Commands and receipts are the real native
// product; the executor authenticates, claims, verifies and signs every result.
export function createComponent(ctx){
 let verifyBinding;
 const execution={registerRunnerBindingVerifier(reader){verifyBinding=reader;return ()=>{verifyBinding=undefined;};},
  async executeBound(request,signal,invocation){
   await ctx.resources.gateway.withPrimaryTransaction({timeoutMs:5000,guard:invocation.guard},async tx=>{
    if(!verifyBinding||!await verifyBinding(tx,request.binding,request))throw Error('Unverified controlled provider target');
   });
   const child=spawn(request.argv[0],request.argv.slice(1),{cwd:request.cwd,env:{PATH:process.env.PATH},signal,stdio:['ignore','pipe','pipe']});
   const stdout=[],stderr=[];
   child.stdout.on('data',b=>stdout.push(b));child.stderr.on('data',b=>stderr.push(b));
   const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal}));});
   const out=Buffer.concat(stdout),err=Buffer.concat(stderr),spool=digest(Buffer.concat([out,err]));
   if(exit.code!==0)process.stderr.write(JSON.stringify({native_exit:exit.code,stdout:out.toString(),stderr:err.toString()})+'\n');
   return {outcome:exit.code===0?'SUCCEEDED':'FAILED',process_ref:'pid:'+child.pid,evidence_digest:spool,
    provider_process_termination_confirmed:true,captured:{complete:true,exit_code:exit.code,stdout:out,stderr:err,spool_digest:spool}};
  }};
 return {apiVersion:1,capabilities:{'provider.execution.v1':execution},actions:{'provider.remote.execute-bound':()=>{throw Error('Factory capability required');}}};
}
