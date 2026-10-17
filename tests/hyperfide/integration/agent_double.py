#!/usr/bin/env python3
"""Controlled agent-process double for the task16.1 connected-stack probe.

Explicitly selected stand-in for a native coding agent: it never calls a model provider.
It holds only its delegated WORKER key, signs one submission.submit operation itself and sends
it over real TLS through the configured network segment, then reports completion text and an
exit status. Neither the completion text nor the exit status is qualification evidence.
"""
import base64,hashlib,http.client,json,os,ssl,subprocess,sys,time,uuid
from pathlib import Path
SIGN_JS="""const fs=require('fs'),crypto=require('crypto');process.stdout.write(crypto.sign(null,fs.readFileSync(0),fs.readFileSync(process.argv[1])).toString('base64url'));"""
def sha(data):return "sha256:"+hashlib.sha256(data).hexdigest()
def b64(data):return base64.urlsafe_b64encode(data).decode().rstrip("=")
def canonical(value):return json.dumps(value,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode()
def main():
    config=json.loads(Path(sys.argv[1]).read_text())
    if config.get("variant")!="connected-stack/controlled-doubles":raise SystemExit("explicit controlled-double selection required")
    stat=Path("/proc/self/stat").read_text().rsplit(")",1)[1].split()
    identity={"pid":os.getpid(),"start":stat[19],"boot_id":Path("/proc/sys/kernel/random/boot_id").read_text().strip()}
    payload=canonical({"run_id":config["run_id"],"component":"16.1","action":"submission.submit","input":config["input"],"expected_version":None,"authority":config["authority"]})
    operation={"protocol_version":1,"operation_id":config["operation_id"],"idempotency_key":config["input"]["request_id"],"payload_digest":sha(payload),
               "correlation_id":config["correlation_id"],"causation_id":None,"payload_b64":b64(payload)}
    raw=canonical(operation);seconds=str(int(time.time()));nonce=str(uuid.uuid4())
    message=("\n".join(("HYPERFIDE-REQUEST-V1","POST","/v1/invoke",config["origin"],config["credential_id"],seconds,nonce,sha(raw),""))).encode()
    signature=subprocess.check_output(["node","--input-type=commonjs","-e",SIGN_JS,config["key_path"]],input=message,timeout=15).decode()
    headers={"Content-Type":"application/json","HF-Request-Time":seconds,"HF-Request-Nonce":nonce,"HF-Request-Signature":signature,"HF-Credential-Id":config["credential_id"]}
    report={"type":"agent-double","variant":config["variant"],"process":identity,"completion_text":"TASK COMPLETE: all checks passed","claimed_exit":0}
    connection=http.client.HTTPSConnection("localhost",config["port"],context=ssl.create_default_context(cafile=config["ca"]),timeout=30)
    try:
        connection.request("POST","/v1/invoke",raw,headers);response=connection.getresponse()
        report.update(status=response.status,response=json.loads(response.read()))
        code=0
    except (OSError,http.client.HTTPException) as error:
        report.update(transport_error=type(error).__name__);code=3
    finally:connection.close()
    print(json.dumps(report),flush=True)
    return code
if __name__=="__main__":sys.exit(main())
