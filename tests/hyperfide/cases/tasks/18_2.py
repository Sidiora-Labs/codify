#!/usr/bin/env python3
"""Actual signed finding API plus controlled loopback HTTP; never contacts GitHub."""
from __future__ import annotations
import base64,concurrent.futures,copy,hashlib,hmac,http.server,importlib.util,json,sys,threading
from pathlib import Path
spec=importlib.util.spec_from_file_location('finding_test_fixture',Path(__file__).with_name('18_1.py'));common=importlib.util.module_from_spec(spec);spec.loader.exec_module(common)
from types import SimpleNamespace
check=common.check;expect=common.expect;uid=common.uid
class GitHubFixture:
    def __init__(self):
        state=self;self.issues=[];self.posts=0;self.gets=0;self.fail=False;self.lose_next=True;self.before_get=None
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def reply(self,code,value):
                raw=json.dumps(value).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
            def do_GET(self):
                state.gets+=1
                callback=state.before_get;state.before_get=None
                if callback:callback()
                if state.fail:return self.reply(503,{'message':'controlled fixture outage'})
                return self.reply(200,state.issues)
            def do_POST(self):
                state.posts+=1;payload=json.loads(self.rfile.read(int(self.headers['Content-Length'])));value=dict(payload,number=len(state.issues)+1,state='open',updated_at='2030-01-01T00:00:00Z');state.issues.append(value)
                if state.lose_next:
                    state.lose_next=False;self.close_connection=True;self.connection.close();return
                self.reply(201,value)
            def do_PATCH(self):
                payload=json.loads(self.rfile.read(int(self.headers['Content-Length'])));index=int(self.path.rsplit('/',1)[1])-1;state.issues[index].update(payload,updated_at='2030-01-02T00:00:00Z');self.reply(200,state.issues[index])
        self.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
    def close(self):self.server.shutdown();self.server.server_close();self.thread.join(5);expect(not self.thread.is_alive(),'Loopback HTTP server did not stop')
def main():
    if '--cleanup' in sys.argv:return common.cleanup('18.2')
    github=GitHubFixture();secret='fixture-webhook-secret-with-32-bytes';env={'HF_GITHUB_REQUESTS_APPROVED':'true','HF_GITHUB_API_URL':'http://127.0.0.1:'+str(github.server.server_port)+'/','HF_GITHUB_ALLOW_LOOPBACK':'true','HF_GITHUB_TOKEN':'synthetic-local-token','HF_GITHUB_MARKER_SECRET':'synthetic-marker-secret-with-32-bytes','HF_GITHUB_WEBHOOK_SECRET':secret}
    f=common.fixture('18.2',extra=('18.2',),env=env)
    def call(action,payload):return common.call(f,action,payload,component='finding-github')
    def reject(action,payload,code=None):return common.reject(f,action,payload,code,component='finding-github')
    try:
        fid=common.finding(f)['finding_id'];packet={'finding_id':fid,'request_id':uid(),'owner':'fixture','repository':'repository','title':'Synthetic actionable finding','body':'Reviewed synthetic public projection','kind':'CREATE'};op=call('finding.github.enqueue',packet)
        check('findings.github.durable-enqueue',lambda:expect(op['state']=='PENDING' and github.posts==0))
        check('findings.github.enqueue-idempotent',lambda:expect(call('finding.github.enqueue',packet)['operation_id']==op['operation_id']))
        check('findings.github.public-intent-and-order-immutable',lambda:common.assert_sql_refused(f,'UPDATE hyperfide.finding_github_operations SET operation_sequence=999'))
        check('findings.github.conflicting-intent-refused',lambda:reject('finding.github.enqueue',dict(packet,title='Changed public intent'),'IDEMPOTENCY_CONFLICT'))
        check('findings.github.reserved-marker-refused',lambda:reject('finding.github.enqueue',dict(packet,request_id=uid(),body='hyperfide-finding:forged'),'INVALID_REQUEST'))
        check('findings.github.due-inventory',lambda:expect(call('finding.github.due',{})['operations']==[{'operation_id':op['operation_id']}]))
        check('findings.github.distinct-create-identity-refused',lambda:reject('finding.github.enqueue',dict(packet,request_id=uid()),'GITHUB_CREATE_ALREADY_REGISTERED'))
        second_fid=common.finding(f,common.observation(f,'parallel-create'))['finding_id']
        parallel_packets=[dict(packet,finding_id=second_fid,request_id=uid()) for _ in range(2)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            attempts=list(pool.map(lambda value:f.invoke('finding.github.enqueue',value,component='finding-github'),parallel_packets))
        check('findings.github.parallel-create-one-durable-intent',lambda:expect(sum(body.get('ok') is True for _,body in attempts)==1 and sum(body.get('error',{}).get('code')=='GITHUB_CREATE_ALREADY_REGISTERED' for _,body in attempts)==1))
        update=call('finding.github.enqueue',dict(packet,request_id=uid(),kind='UPDATE',title='Later immutable public intent'))
        check('findings.github.out-of-order-update-no-network',lambda:ordered_refusal(reject,update,github))
        lost=call('finding.github.dispatch',{'operation_id':op['operation_id']})
        check('findings.github.lost-create-ack-unknown',lambda:expect(lost['state']=='UNKNOWN' and github.posts==1))
        f.sql('UPDATE hyperfide.finding_github_operations SET next_attempt_at=clock_timestamp()-interval \'1 second\' WHERE id=$1',[op['operation_id']])
        repaired=call('finding.github.dispatch',{'operation_id':op['operation_id']})
        check('findings.github.marker-reconciles-lost-ack',lambda:expect(repaired['state']=='ACKNOWLEDGED' and repaired['issue_number']==1))
        check('findings.github.no-duplicate-post',lambda:expect(github.posts==1 and len(github.issues)==1))
        check('findings.github.ack-replay-no-network',lambda:ack_replay(call,op,github))
        def delivery(issue,identity=None,signature=None):
            raw=json.dumps({'repository':{'full_name':'fixture/repository'},'issue':issue},separators=(',',':')).encode();return {'delivery_id':identity or uid(),'event_type':'issues','signature':signature or 'sha256='+hmac.new(secret.encode(),raw,hashlib.sha256).hexdigest(),'raw_body_base64':base64.b64encode(raw).decode()}
        closed=dict(github.issues[0],state='closed',updated_at='2030-01-03T00:00:00Z');received=delivery(closed)
        check('findings.github.invalid-webhook-signature',lambda:reject('finding.github.webhook',dict(received,signature='sha256:'+'0'*64),'WEBHOOK_SIGNATURE_INVALID'))
        check('findings.github.authenticated-webhook-inbox',lambda:expect(call('finding.github.webhook',received)['replayed'] is False))
        check('findings.github.webhook-duplicate',lambda:expect(call('finding.github.webhook',received)['replayed'] is True))
        conflicting=delivery(dict(closed,title='Different signed payload'),identity=received['delivery_id'])
        check('findings.github.webhook-delivery-conflict',lambda:reject('finding.github.webhook',conflicting,'DELIVERY_CONFLICT'))
        process={'delivery_id':received['delivery_id'],'repository_id':f.x['repository'],'owner':'fixture','repository':'repository'}
        check('findings.github.inbox-process',lambda:expect(call('finding.github.process-delivery',process)['external_state']=='closed'))
        check('findings.github.external-close-not-resolution',lambda:expect(common.call(f,'finding.inspect',{'finding_id':fid})['finding']['phase']=='OPEN'))
        stale=delivery(dict(github.issues[0],updated_at='2030-01-02T00:00:00Z'));call('finding.github.webhook',stale)
        check('findings.github.stale-event-ignored',lambda:expect(call('finding.github.process-delivery',dict(process,delivery_id=stale['delivery_id']))['ignored_stale'] is True))
        ambiguous=delivery(dict(closed,title='Same timestamp conflicting content'));call('finding.github.webhook',ambiguous)
        check('findings.github.equal-timestamp-conflict',lambda:reject('finding.github.process-delivery',dict(process,delivery_id=ambiguous['delivery_id']),'GITHUB_ORDER_UNCERTAIN'))
        github.issues=[dict(closed),{'number':2,'title':'External issue','body':'No internal marker','state':'open','updated_at':'2030-01-04T00:00:00Z'}]
        reconcile={'repository_id':f.x['repository'],'owner':'fixture','repository':'repository'};polled=call('finding.github.reconcile',reconcile)
        check('findings.github.reconciliation-finds-external-issue',lambda:expect(polled['reconciled'] is True and f.sql('SELECT count(*)::text AS n FROM hyperfide.finding_external_intake')[0]['n']=='1'))
        check('findings.github.ten-minute-next-poll',lambda:expect(polled['next_interval_seconds']==600 and f.sql("SELECT abs(extract(epoch FROM next_poll_at-last_success_at)-600)<0.1 AS bounded FROM hyperfide.finding_github_checkpoints")[0]['bounded'] is True))
        check('findings.github.not-due-no-api-call',lambda:not_due(call,reconcile,github))
        checkpoint=f.sql('SELECT updated_since FROM hyperfide.finding_github_checkpoints')[0]['updated_since'];f.sql('UPDATE hyperfide.finding_github_checkpoints SET next_poll_at=clock_timestamp()-interval \'1 second\'');github.fail=True;outage=call('finding.github.reconcile',reconcile)
        check('findings.github.outage-preserves-checkpoint',lambda:expect(outage['reconciled'] is False and f.sql('SELECT updated_since FROM hyperfide.finding_github_checkpoints')[0]['updated_since']==checkpoint))
        check('findings.github.outage-backlog-visible',lambda:expect(call('finding.github.status',{})['reconciliation'][0]['last_error_code']=='GITHUB_HTTP_503'))
        check('findings.github.loopback-only-observation',lambda:expect(github.server.server_address[0]=='127.0.0.1' and github.posts==1))
        github.fail=False
        slow_fid=common.finding(f,common.observation(f,'expired-dispatch-authority'))['finding_id'];slow=call('finding.github.enqueue',dict(packet,finding_id=slow_fid,request_id=uid()))
        github.before_get=lambda:f.sql("UPDATE hyperfide.finding_github_operations SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[slow['operation_id']]);before=github.posts;_,response=f.invoke('finding.github.dispatch',{'operation_id':slow['operation_id']},component='finding-github')
        check('findings.github.expired-lease-before-write-refused',lambda:expect(response.get('ok') is False and github.posts==before))
        revoked_fid=common.finding(f,common.observation(f,'revoked-dispatch-authority'))['finding_id'];revoked=call('finding.github.enqueue',dict(packet,finding_id=revoked_fid,request_id=uid()))
        github.before_get=lambda:f.sql("UPDATE hyperfide.identity_principals SET state='REVOKED',credential_version=credential_version+1 WHERE credential_id=$1",[f.ids['operator']]);before=github.posts;_,response=f.invoke('finding.github.dispatch',{'operation_id':revoked['operation_id']},component='finding-github')
        check('findings.github.revoked-principal-before-write-refused',lambda:expect(response.get('ok') is False and github.posts==before))

    finally:
        try:f.close()
        finally:github.close()
    return int(any(actual!='observed' for _,actual in common.RESULTS))
def ordered_refusal(reject,op,github):
    before=(github.posts,github.gets);reject('finding.github.dispatch',{'operation_id':op['operation_id']},'OPERATION_ORDER_BLOCKED');expect((github.posts,github.gets)==before)
def ack_replay(call,op,github):
    count=github.gets;result=call('finding.github.dispatch',{'operation_id':op['operation_id']});expect(result['replayed'] is True and github.gets==count)
def not_due(call,payload,github):
    count=github.gets;result=call('finding.github.reconcile',payload);expect(result['reason']=='NOT_DUE' and github.gets==count)
if __name__=='__main__':raise SystemExit(main())
