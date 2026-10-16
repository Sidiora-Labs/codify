#!/usr/bin/env python3
from pathlib import Path
import sys,json
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/"tests/hyperfide/support"))
from identity_fixture import IdentityFixture,RESULTS,check,expect,uid,b64,sha
def main():
    fixture=IdentityFixture()
    try:
        f=fixture
        check("identity.https.authenticated-describe",lambda:expect(f.invoke("identity.describe",{})[1].get("ok") is True,"authenticated describe rejected"))
        check("identity.stdin-eof-daemon",lambda:expect(f.child.poll() is None,"closed stdin stopped listener"))
        body=f.operation("14.1","identity.describe",{})
        nonce=uid()
        check("identity.nonce.first",lambda:expect(f.request(body,nonce=nonce)[1].get("ok") is True,"first nonce rejected"))
        check("identity.nonce.replay",lambda:expect(f.request(body,nonce=nonce)[1].get("error",{}).get("code")=="AUTH_REPLAY","nonce replay accepted"))
        check("identity.proof.wrong-key",lambda:expect(f.request(body,key="other",credential=f.ids["operator"])[1].get("ok") is False,"wrong key accepted"))
        check("identity.proof.expired-time",lambda:expect(f.request(body,seconds="1")[1].get("ok") is False,"old proof accepted"))
        wrong=f.operation("14.1","identity.describe",{},run=uid())
        check("identity.scope.wrong-run",lambda:expect(f.request(wrong)[1].get("ok") is False,"cross-run request accepted"))
        bad=dict(body);bad["payload_digest"]=sha(b"changed")
        check("identity.digest.tampering",lambda:expect(f.request(bad)[1].get("ok") is False,"wrong digest accepted"))
        check("identity.json.duplicate-key",lambda:expect(f.request(b'{"protocol_version":1,"protocol_version":1}')[1].get("ok") is False,"duplicate JSON key accepted"))
        check("identity.encoding.invalid-utf8",lambda:expect(f.request(b"\xff")[1].get("ok") is False,"invalid UTF8 accepted"))
        check("identity.role.forged-provisioner",lambda:expect(f.invoke("identity.binding.observe",{})[1].get("ok") is False,"operator forged provisioner action"))
        check("identity.provider.binding",lambda:expect(f.bind()[1].get("ok") is True,"trusted provisioning observation rejected"))
        issue=f.issue()
        check("identity.grant.issue",lambda:expect(issue[1].get("ok") is True,"grant issue failed"))
        enrolled=f.enrollment()
        response=f.request(enrolled,key="runner",endpoint="/v1/enroll",credential=f.grant)
        check("identity.enrollment.real",lambda:expect(response[1].get("ok") is True,"enrollment failed"))
        credential=response[1].get("result",{}).get("credential_id")
        repeat=f.request(enrolled,key="runner",endpoint="/v1/enroll",credential=f.grant)
        check("identity.enrollment.exact-replay",lambda:expect(repeat[1].get("result",{}).get("credential_id")==credential,"enrollment duplicated identity"))
        check("identity.runner.authenticated",lambda:expect(f.request(f.operation("14.1","identity.describe",{}),key="runner",credential=credential)[1].get("ok") is True,"runner credential failed"))
        report=f.request(f.operation("14.1","identity.runner.register",{"preparation_digest":f.preparation,"inventory":[]}),key="runner",credential=credential)
        check("identity.runner.register",lambda:expect(report[1].get("ok") is True,"runner registration failed"))
        heartbeat=f.request(f.operation("14.1","identity.runner.heartbeat",{"expected_version":"1"}),key="runner",credential=credential)
        check("identity.runner.heartbeat",lambda:expect(heartbeat[1].get("ok") is True,"runner heartbeat failed"))
        check("identity.runner.stale-version",lambda:expect(f.request(f.operation("14.1","identity.runner.heartbeat",{"expected_version":"1"}),key="runner",credential=credential)[1].get("ok") is False,"stale runner status accepted"))
        check("identity.runner.role-escalation",lambda:expect(f.request(f.operation("14.1","identity.grant.issue",{}),key="runner",credential=credential)[1].get("ok") is False,"runner issued grant"))
        duplicate=f.enrollment("other")
        check("identity.enrollment.clone-quarantine",lambda:expect(f.request(duplicate,key="other",endpoint="/v1/enroll",credential=f.grant)[1].get("error",{}).get("code")=="ENROLLMENT_QUARANTINED","cloned key not quarantined"))
        check("identity.credential.quarantine-enforced",lambda:expect(f.request(f.operation("14.1","identity.describe",{}),key="runner",credential=credential)[1].get("ok") is False,"quarantined credential remained usable"))
        f.stop();f.start()
        check("identity.restart.no-reactivation",lambda:expect(f.request(f.operation("14.1","identity.describe",{}),key="runner",credential=credential)[1].get("ok") is False,"restart reactivated quarantined identity"))
        check("identity.secret.absent-database",lambda:expect(b64(f.secret) not in json.dumps(f.sql("SELECT row_to_json(g) AS value FROM hyperfide.identity_enrollment_grants g")),"reusable grant secret persisted"))
        watcher=f.add_principal("watcher","COMMIT_WATCHER")
        check("identity.fixture.registered-watcher",lambda:expect(f.invoke("identity.describe",{},key="watcher")[1].get("result",{}).get("principal",{}).get("actor_id")==watcher["actor_id"],"registered watcher actor binding failed"))
        check("identity.fixture.reviewer-no-compute-attempt",lambda:expect(f.invoke("identity.describe",{},key="watcher")[1].get("result",{}).get("principal",{}).get("attempt_id") is None,"reviewer inherited coding compute attempt"))
        def existing_database():
            try:
                other=IdentityFixture(database=f.database)
            except AssertionError:
                expect(f.invoke("identity.describe",{})[1].get("ok") is True,"failed constructor removed a pre-existing database")
            else:
                other.close();raise AssertionError("pre-existing database was accepted")
        check("identity.fixture.database-ownership",existing_database)
        check("identity.shutdown.orderly",lambda:f.stop())
    finally:fixture.close()
    return int(any(actual!="observed" for _,actual in RESULTS))
if __name__=="__main__":raise SystemExit(main())
