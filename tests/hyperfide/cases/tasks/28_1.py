#!/usr/bin/env python3
"""Execute documented preparation/auth/checker workflows remotely; unsupported operations stay explicit."""
import json,runpy,subprocess,sys
from pathlib import Path
H=runpy.run_path(str(Path(__file__).with_name("28_2.py")))
ROOT=H["ROOT"];IdentityFixture=H["IdentityFixture"];check=H["check"];require=H["require"];FAILED=H["FAILED"]
def main():
    H["configure_task"]("28.1")
    guide=(ROOT/"docs/hyperfide/operations.md").read_text()
    check("operations.support-state-explicit",lambda:require("does not announce a production release"in guide and"not measured throughput"in guide and"unregistered"in guide,"guide overstates qualification"))
    check("operations.roles-and-schematics",lambda:require("```mermaid"in guide and all(x in guide for x in["Human","Leader","Feature managers","PostgreSQL primary","sandboxes","Publication gateway"]),"role distribution incomplete"))
    check("operations.no-supervisor-builds",lambda:require("never on the leadership server"in guide and"No remote build occurs inside a PostgreSQL transaction"in guide,"build placement contract absent"))
    check("operations.required-areas",lambda:require(all(x.lower()in guide.lower()for x in["migrations","secrets","execution","verification","publication","Documentation","recovery","retention","SQLite","cg compatibility","troubleshooting"]),"operational domain omitted"))
    check("operations.docs-exit-not-authority",lambda:require("Connector success"in guide and"baseline"in guide and"Persistence failure aborts closure"in guide,"docs falsely closes on exit"))
    check("operations.actual-node-profile",lambda:require(subprocess.check_output(["node","--version"],text=True).strip()=="v24.22.0","wrong execution runtime"))
    def checker_help():
        p=subprocess.run(["python3","tests/hyperfide/check-evidence.py","--help"],cwd=ROOT,capture_output=True,text=True)
        require(p.returncode==0 and"--campaign"in p.stdout,"documented independent checker interface unavailable")
    check("operations.actual-checker-interface",checker_help)
    def qualifier_help():
        p=subprocess.run(["python3","tests/hyperfide/qualify.py","--help"],cwd=ROOT,capture_output=True,text=True)
        require(p.returncode==0 and"--manifest"in p.stdout and"--case"in p.stdout,"documented canonical qualifier interface unavailable")
    check("operations.actual-qualifier-interface",qualifier_help)
    f=IdentityFixture()
    try:
        def authenticated():
            status,result=f.invoke("identity.describe",{})
            require(status==200 and result.get("ok")is True,"documented authenticated service unavailable")
        check("operations.actual-authenticated-startup",authenticated)
        def request_cannot_approve():
            operation=f.operation("14.1","identity.describe",{})
            operation["approved"]=True
            status,result=f.request(operation)
            require(status!=200 and result.get("ok")is False,"malformed request changed trusted startup admission")
        check("operations.actual-request-approval-refused",request_cannot_approve)
        def wrong_scope():
            operation=f.operation("14.1","identity.describe",{},run=str(__import__("uuid").uuid4()))
            status,result=f.request(operation)
            require(status!=200 and result.get("ok")is False,"request bypassed current run scope")
        check("operations.actual-cross-run-refused",wrong_scope)
        def restart():
            f.stop();f.start();authenticated()
        check("operations.actual-service-restart",restart)
    finally:f.close()
    H["cleanup_event"]("28.1")
    return 1 if FAILED else 0
if __name__=="__main__":sys.exit(H["cleanup_only"]("28.1")if "--cleanup"in sys.argv else main())
