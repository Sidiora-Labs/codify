import pg from 'pg';
import {FoundationError} from '../policy/programme.js';

export class StorageError extends FoundationError {
  constructor(code:string,message:string,public readonly outcome:'aborted'|'unknown'='aborted',
    public readonly attempts=0,public readonly retryable=false){super(code,message);}
}
export interface QuerySession {
  query<R extends pg.QueryResultRow=pg.QueryResultRow>(text:string,values?:readonly unknown[]):Promise<pg.QueryResult<R>>;
  remainingMs():number;
  readonly signal:AbortSignal;
}
declare const primaryBrand:unique symbol;
export interface PrimaryTransaction extends QuerySession {readonly [primaryBrand]:true;copyFrom(sql:string,bytes:Uint8Array):Promise<{rowCount:number}>}
const livePrimary=new WeakSet<object>();
export function assertPrimaryTransaction(value:unknown):asserts value is PrimaryTransaction {
  if(typeof value!=='object'||value===null||!livePrimary.has(value))
    throw new StorageError('TX_CLOSED','A live primary transaction capability is required');
}
export interface TransactionOptions {
  timeoutMs?:number;maxRetries?:number;signal?:AbortSignal;
  guard?:(transaction:PrimaryTransaction)=>void|Promise<void>;
}
export interface DatabaseLease {client:pg.PoolClient;signal:AbortSignal;release(destroy?:boolean):void}
export interface PrimaryConnectionSource {
  commitMode?(): 'on'|'remote_apply';
  validateCommit?(client:pg.PoolClient):Promise<void>;
  acquirePrimary(deadline:number,signal?:AbortSignal):Promise<DatabaseLease>;
}
export function deadlineFrom(timeoutMs=5000):number {
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)
    throw new StorageError('DATABASE_CONFIG_INVALID','Transaction timeout must be from 1 to 30000 milliseconds');
  return performance.now()+timeoutMs;
}
function codeOf(error:unknown):string {
  return typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';
}
export async function bounded<T>(promise:Promise<T>,deadline:number,signal?:AbortSignal):Promise<T>{
  // Observe already-started work even when cancellation wins before the race attaches.
  void promise.catch(()=>{});
  if(signal?.aborted)throw new StorageError('TX_TIMEOUT','Operation was cancelled');
  const remaining=Math.ceil(deadline-performance.now());
  if(remaining<=0)throw new StorageError('TX_TIMEOUT','Operation deadline expired');
  let timer:ReturnType<typeof setTimeout>|undefined;
  let abort:(()=>void)|undefined;
  const limit=new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>reject(new StorageError('TX_TIMEOUT','Operation deadline expired')),remaining);
    abort=()=>reject(new StorageError('TX_TIMEOUT','Operation was cancelled'));
    signal?.addEventListener('abort',abort,{once:true});
  });
  try{return await Promise.race([promise,limit]);}
  finally{if(timer)clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);}
}
// Trusted callbacks still cannot accidentally escape the broker's transaction boundary.
export function assertTransactionStatement(sql:string):void{
  let state:'normal'|'single'|'double'|'line'|'block'|'dollar'='normal',depth=0,tag='',plain='',ended=false,escapeString=false;
  for(let i=0;i<sql.length;i++){
    const c=sql[i]!,next=sql[i+1];
    if(state==='line'){if(c==='\n'){state='normal';plain+=' ';}continue;}
    if(state==='block'){
      if(c==='/'&&next==='*'){depth++;i++;}else if(c==='*'&&next==='/'){depth--;i++;if(!depth)state='normal';}continue;
    }
    if(state==='single'){
      if(c==='\\'){if(!escapeString)throw new StorageError('INVALID_REQUEST','Backslash literals require parameters or explicit E strings');i++;continue;}
      if(c==="'"){if(next==="'")i++;else state='normal';}continue;
    }
    if(state==='double'){if(c==='"'){if(next==='"')i++;else state='normal';}continue;}
    if(state==='dollar'){if(sql.startsWith(tag,i)){i+=tag.length-1;state='normal';}continue;}
    if(c==='-'&&next==='-'){state='line';plain+=' ';i++;continue;}
    if(c==='/'&&next==='*'){state='block';depth=1;plain+=' ';i++;continue;}
    if(/\s/.test(c)){plain+=' ';continue;}
    if(c===';'){if(ended)throw new StorageError('INVALID_REQUEST','Multiple SQL statements are forbidden');ended=true;continue;}
    if(ended)throw new StorageError('INVALID_REQUEST','Multiple SQL statements are forbidden');
    if(c==="'"){escapeString=i>0&&/[eE]/.test(sql[i-1]!)&&(i<2||!/[A-Za-z0-9_$]/.test(sql[i-2]!));state='single';plain+=' VALUE ';continue;}
    if(c==='"'){state='double';plain+=' IDENT ';continue;}
    if(c==='$'){
      const match=/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if(match){tag=match[0];state='dollar';i+=tag.length-1;plain+=' VALUE ';continue;}
    }
    plain+=c.toUpperCase();
  }
  if(!['normal','line'].includes(state))throw new StorageError('INVALID_REQUEST','Unterminated SQL token');
  const first=/^[A-Z]+/.exec(plain.trimStart())?.[0];
  if(!first||['BEGIN','START','COMMIT','END','ROLLBACK','ABORT','SAVEPOINT','RELEASE','PREPARE','SET','RESET','DISCARD','VACUUM'].includes(first))
    throw new StorageError('INVALID_REQUEST','Transaction and session control are owned by the gateway');
}
interface CopyConnection {sendCopyFromChunk(chunk:Buffer):void;endCopyFrom():void}
class BoundedCopyInput extends pg.Query {
  constructor(sql:string,private readonly bytes:Buffer){super(sql);}
  handleCopyInResponse(connection:CopyConnection):void{
    for(let offset=0;offset<this.bytes.length;offset+=65536)connection.sendCopyFromChunk(this.bytes.subarray(offset,offset+65536));
    connection.endCopyFrom();
  }
}
export class TransactionGateway {
  constructor(private readonly source:PrimaryConnectionSource){}
  async withPrimaryTransaction<T>(options:TransactionOptions,operation:(tx:PrimaryTransaction)=>Promise<T>|T):Promise<T>{
    const deadline=deadlineFrom(options.timeoutMs),retries=options.maxRetries??2;
    if(!Number.isSafeInteger(retries)||retries<0||retries>5)
      throw new StorageError('DATABASE_CONFIG_INVALID','maxRetries must be an integer from 0 to 5');
    for(let attempt=1;;attempt++){
      if(attempt>1){
        // SSI peers can outlive several immediate retries. Yield without a lease
        // so they can commit, and jitter retries to avoid repeating the collision.
        const delay=Math.min(1000,100*2**(attempt-2))*(1+Math.random());
        let timer:ReturnType<typeof setTimeout>|undefined;
        try{await bounded(new Promise<void>(resolve=>{timer=setTimeout(resolve,delay);}),deadline,options.signal);}
        finally{if(timer)clearTimeout(timer);}
      }
      let lease:DatabaseLease|undefined,handle:PrimaryTransaction|undefined;
      let phase:'acquire'|'begin'|'body'|'commit'|'committed'='acquire';
      let healthy=true;
      try{
        lease=await this.source.acquirePrimary(deadline,options.signal);
        const client=lease.client;
        const status=await client.query<{recovery:boolean;readonly:boolean}>(
          "SELECT pg_is_in_recovery() AS recovery,current_setting('default_transaction_read_only')::boolean AS readonly");
        if(status.rows[0]?.recovery||status.rows[0]?.readonly)
          throw new StorageError('PRIMARY_REQUIRED','Writable primary authority is required');
        phase='begin';
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE');
        const remaining=Math.max(1,Math.floor(deadline-performance.now()));
        await client.query("SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true),set_config('idle_in_transaction_session_timeout',$1,true)",[String(remaining)]);
        let active=true;
        const tx=Object.freeze({
          query:async<R extends pg.QueryResultRow=pg.QueryResultRow>(text:string,values?:readonly unknown[]):Promise<pg.QueryResult<R>>=>{
            if(!active||!livePrimary.has(tx))throw new StorageError('TX_CLOSED','Transaction capability has expired');
            if(typeof text!=='string'||!text.trim())throw new StorageError('INVALID_REQUEST','SQL text is required');
            assertTransactionStatement(text);
            return bounded(client.query<R>(text,values?[...values]:undefined),deadline,lease!.signal);
          },
          copyFrom:async(sql:string,bytes:Uint8Array):Promise<{rowCount:number}>=>{
            if(!active||!livePrimary.has(tx))throw new StorageError('TX_CLOSED','Transaction capability has expired');
            if(typeof sql!=='string'||sql.length>16384||!/^[\s]*COPY\b[\s\S]*\bFROM\s+STDIN(?:\s+WITH\b[\s\S]*)?\s*$/i.test(sql)||
                /;|\bPROGRAM\b/i.test(sql)||!(bytes instanceof Uint8Array)||bytes.byteLength>16*1024*1024)
              throw new StorageError('INVALID_REQUEST','COPY requires bounded bytes and one FROM STDIN statement');
            const query=new BoundedCopyInput(sql,Buffer.from(bytes));
            const result=new Promise<{rowCount:number}>((resolve,reject)=>{
              query.once('error',reject);query.once('end',(value:pg.QueryResult)=>resolve({rowCount:value.rowCount??0}));
              client.query(query);
            });
            return bounded(result,deadline,lease!.signal);
          },
          remainingMs:()=>Math.max(0,Math.floor(deadline-performance.now())),signal:lease.signal
        }) as PrimaryTransaction;
        handle=tx;livePrimary.add(tx);phase='body';
        let value:T;
        try{
          if(options.guard)await bounded(Promise.resolve().then(()=>options.guard!(tx)),deadline,lease.signal);
          value=await bounded(Promise.resolve().then(()=>operation(tx)),deadline,lease.signal);
        }finally{active=false;livePrimary.delete(tx);}
        // Restore the selected durability floor immediately before commit; callers cannot retain a weaker session setting.
        await client.query("SELECT set_config('synchronous_commit',$1,true)",[this.source.commitMode?.()??'on']);
        if(this.source.validateCommit)await this.source.validateCommit(client);
        phase='commit';
        await client.query('COMMIT');
        phase='committed';
        return value;
      }catch(error){
        const code=codeOf(error),knownAbort=code==='40001'||code==='40P01';
        const serverError=typeof error==='object'&&error!==null&&'severity' in error&&typeof error.severity==='string';
        if(phase==='commit'&&!knownAbort&&!serverError){
          healthy=false;
          throw new StorageError('COMMIT_AMBIGUOUS','Commit acknowledgement was lost; reconcile the durable operation identity before retry','unknown',attempt,false);
        }
        if(lease&&phase!=='acquire'&&phase!=='committed'){
          try{await bounded(lease.client.query('ROLLBACK'),deadline,lease.signal);}catch{healthy=false;}
        }
        if(knownAbort){
          if(attempt<=retries&&deadline>performance.now()&&!options.signal?.aborted)continue;
          throw new StorageError('TX_RETRY_EXHAUSTED','Known-aborted transaction retry budget exhausted','aborted',attempt,true);
        }
        if(error instanceof StorageError||error instanceof FoundationError)throw error;
        if(code==='57014'||code==='55P03')throw new StorageError('TX_TIMEOUT','Database deadline or lock timeout expired','aborted',attempt);
        healthy=false;
        throw new StorageError('DB_UNAVAILABLE','Primary transaction failed ('+( /^[0-9A-Z]{5}$/.test(code)?code:'connection')+')','aborted',attempt);
      }finally{
        if(handle)livePrimary.delete(handle);
        lease?.release(!healthy||lease.signal.aborted);
      }
    }
  }
}
